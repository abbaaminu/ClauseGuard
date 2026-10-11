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
  result jsonb;
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

  FOR result IN SELECT value FROM jsonb_array_elements(p_results)
  LOOP
    IF jsonb_typeof(result) IS DISTINCT FROM 'object'
       OR jsonb_typeof(result->'category') IS DISTINCT FROM 'string'
       OR length(result->>'category') NOT BETWEEN 1 AND 200
       OR result->>'status' IS NULL
       OR result->>'status' NOT IN ('passed', 'flagged', 'missing')
       OR result->>'critical_level' IS NULL
       OR result->>'critical_level' NOT IN ('low', 'medium', 'high')
       OR jsonb_typeof(COALESCE(result->'contract_snippet', '""'::jsonb)) IS DISTINCT FROM 'string'
       OR length(COALESCE(result->>'contract_snippet', '')) > 5000
       OR jsonb_typeof(COALESCE(result->'alternative_suggestion', '""'::jsonb)) IS DISTINCT FROM 'string'
       OR length(COALESCE(result->>'alternative_suggestion', '')) > 5000
       OR jsonb_typeof(COALESCE(result->'description', '""'::jsonb)) IS DISTINCT FROM 'string'
       OR length(COALESCE(result->>'description', '')) > 5000 THEN
      RAISE EXCEPTION 'audit result contains invalid or oversized fields';
    END IF;

    IF result->>'contract_snippet' <> ''
       AND strpos(contract_text, result->>'contract_snippet') = 0 THEN
      RAISE EXCEPTION 'audit result snippet is not verbatim contract text';
    END IF;
  END LOOP;

  IF (
    SELECT count(DISTINCT result->>'category')
    FROM jsonb_array_elements(p_results) AS items(result)
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
    result->>'category',
    (result->>'status')::public.audit_status,
    (result->>'critical_level')::public.critical_level,
    COALESCE(result->>'contract_snippet', ''),
    COALESCE(result->>'alternative_suggestion', ''),
    COALESCE(result->>'description', '')
  FROM jsonb_array_elements(p_results) AS items(result);

  UPDATE public.contracts
  SET status = 'completed', risk_score = p_risk_score
  WHERE id = p_contract_id AND status = 'processing';
END;
$$;

REVOKE ALL ON FUNCTION public.complete_contract_audit(uuid, jsonb, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_contract_audit(uuid, jsonb, integer)
  TO service_role;
