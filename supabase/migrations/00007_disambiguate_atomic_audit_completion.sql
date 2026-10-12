CREATE OR REPLACE FUNCTION public.complete_contract_audit(
  p_contract_id uuid,
  p_results jsonb,
  p_risk_score integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  contract_text text;
  audit_item jsonb;
BEGIN
  IF jsonb_typeof(p_results) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'audit results must be a JSON array';
  END IF;

  IF jsonb_array_length(p_results) < 1 OR jsonb_array_length(p_results) > 20 THEN
    RAISE EXCEPTION 'audit results must be an array containing at most 20 items';
  END IF;

  IF p_risk_score IS NULL OR p_risk_score < 0 OR p_risk_score > 100 THEN
    RAISE EXCEPTION 'risk score must be between 0 and 100';
  END IF;

  SELECT file_content INTO contract_text
  FROM public.contracts
  WHERE id = p_contract_id AND status = 'processing'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'contract is not in processing state';
  END IF;

  FOR audit_item IN SELECT value FROM jsonb_array_elements(p_results)
  LOOP
    IF jsonb_typeof(audit_item) IS DISTINCT FROM 'object'
       OR jsonb_typeof(audit_item->'category') IS DISTINCT FROM 'string'
       OR length(audit_item->>'category') NOT BETWEEN 1 AND 200
       OR audit_item->>'status' IS NULL
       OR audit_item->>'status' NOT IN ('passed', 'flagged', 'missing')
       OR audit_item->>'critical_level' IS NULL
       OR audit_item->>'critical_level' NOT IN ('low', 'medium', 'high')
       OR jsonb_typeof(COALESCE(audit_item->'contract_snippet', '""'::jsonb)) IS DISTINCT FROM 'string'
       OR length(COALESCE(audit_item->>'contract_snippet', '')) > 5000
       OR jsonb_typeof(COALESCE(audit_item->'alternative_suggestion', '""'::jsonb)) IS DISTINCT FROM 'string'
       OR length(COALESCE(audit_item->>'alternative_suggestion', '')) > 5000
       OR jsonb_typeof(COALESCE(audit_item->'description', '""'::jsonb)) IS DISTINCT FROM 'string'
       OR length(COALESCE(audit_item->>'description', '')) > 5000 THEN
      RAISE EXCEPTION 'audit result contains invalid or oversized fields';
    END IF;

    IF audit_item->>'contract_snippet' <> ''
       AND strpos(contract_text, audit_item->>'contract_snippet') = 0 THEN
      RAISE EXCEPTION 'audit result snippet is not verbatim contract text';
    END IF;
  END LOOP;

  IF (
    SELECT count(DISTINCT items.item->>'category')
    FROM jsonb_array_elements(p_results) AS items(item)
  ) <> jsonb_array_length(p_results) THEN
    RAISE EXCEPTION 'audit result categories must be unique';
  END IF;

  DELETE FROM public.audit_results
  WHERE contract_id = p_contract_id;

  INSERT INTO public.audit_results (
    contract_id,
    category,
    status,
    critical_level,
    contract_snippet,
    alternative_suggestion,
    description
  )
  SELECT
    p_contract_id,
    items.item->>'category',
    (items.item->>'status')::public.audit_status,
    (items.item->>'critical_level')::public.critical_level,
    COALESCE(items.item->>'contract_snippet', ''),
    COALESCE(items.item->>'alternative_suggestion', ''),
    COALESCE(items.item->>'description', '')
  FROM jsonb_array_elements(p_results) AS items(item);

  UPDATE public.contracts
  SET status = 'completed', risk_score = p_risk_score
  WHERE id = p_contract_id AND status = 'processing';
END;
$$;

REVOKE ALL ON FUNCTION public.complete_contract_audit(uuid, jsonb, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_contract_audit(uuid, jsonb, integer)
  TO service_role;