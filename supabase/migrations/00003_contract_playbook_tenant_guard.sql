CREATE OR REPLACE FUNCTION public.ensure_contract_playbook_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  playbook_org_id uuid;
  playbook_is_system boolean;
BEGIN
  IF NEW.playbook_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT organization_id, is_system
    INTO playbook_org_id, playbook_is_system
    FROM public.playbooks
    WHERE id = NEW.playbook_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'playbook % does not exist', NEW.playbook_id;
  END IF;

  IF NOT playbook_is_system AND playbook_org_id IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'contract and playbook must belong to the same organization';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_contract_playbook_org
  BEFORE INSERT OR UPDATE OF organization_id, playbook_id ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.ensure_contract_playbook_org();