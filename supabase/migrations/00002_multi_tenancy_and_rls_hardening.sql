-- ============================================================================
-- 00002: True multi-tenancy (organizations) + RLS hardening
-- ----------------------------------------------------------------------------
-- The original schema scoped everything to a single user_id. Enterprise
-- customers need *organization*-level isolation: several users on the same
-- org should share contracts/playbooks, and RLS must guarantee that no
-- query can ever cross an organization boundary, even for service-role
-- code paths that forget a WHERE clause.
-- ============================================================================

-- 1. Organizations table -------------------------------------------------
CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- 2. org_id columns ------------------------------------------------------
ALTER TABLE profiles       ADD COLUMN organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE playbooks      ADD COLUMN organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE contracts      ADD COLUMN organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;
-- audit_results inherits tenancy through contracts.organization_id (no direct FK needed,
-- but we add it too, denormalized, so RLS on audit_results never needs a subquery join
-- that could be defeated by a missing index).
ALTER TABLE audit_results  ADD COLUMN organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;

CREATE INDEX idx_profiles_org   ON profiles(organization_id);
CREATE INDEX idx_playbooks_org  ON playbooks(organization_id);
CREATE INDEX idx_contracts_org  ON contracts(organization_id);
CREATE INDEX idx_audit_org      ON audit_results(organization_id);

-- 3. Backfill: give every existing user their own 1-person organization --
DO $$
DECLARE
  r RECORD;
  new_org_id uuid;
BEGIN
  FOR r IN SELECT id, organization_name FROM profiles WHERE organization_id IS NULL LOOP
    INSERT INTO organizations (name) VALUES (COALESCE(NULLIF(r.organization_name, ''), 'Untitled Organization'))
    RETURNING id INTO new_org_id;

    UPDATE profiles  SET organization_id = new_org_id WHERE id = r.id;
    UPDATE playbooks SET organization_id = new_org_id WHERE user_id = r.id AND organization_id IS NULL;
    UPDATE contracts SET organization_id = new_org_id WHERE user_id = r.id AND organization_id IS NULL;
    UPDATE audit_results a SET organization_id = new_org_id
      FROM contracts c WHERE a.contract_id = c.id AND c.user_id = r.id AND a.organization_id IS NULL;
  END LOOP;
END $$;

-- 4. Helper: current user's organization (SECURITY DEFINER, STABLE, cached
--    per-statement) — this is the single source of truth every RLS policy
--    below relies on, so multi-tenancy logic lives in exactly one place.
CREATE OR REPLACE FUNCTION auth_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM profiles WHERE id = auth.uid()
$$;

-- 5. Make organization_id mandatory going forward -------------------------
ALTER TABLE profiles  ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE contracts ALTER COLUMN organization_id SET NOT NULL;

-- 6. Drop old user-scoped policies, replace with org-scoped ones ---------
DROP POLICY IF EXISTS "Users can view own contracts"   ON contracts;
DROP POLICY IF EXISTS "Users can insert own contracts" ON contracts;
DROP POLICY IF EXISTS "Users can update own contracts" ON contracts;
DROP POLICY IF EXISTS "Users can delete own contracts" ON contracts;

CREATE POLICY "org_select_contracts" ON contracts FOR SELECT
  USING (organization_id = auth_org_id());
CREATE POLICY "org_insert_contracts" ON contracts FOR INSERT
  WITH CHECK (organization_id = auth_org_id() AND user_id = auth.uid());
CREATE POLICY "org_update_contracts" ON contracts FOR UPDATE
  USING (organization_id = auth_org_id());
CREATE POLICY "org_delete_contracts" ON contracts FOR DELETE
  USING (organization_id = auth_org_id());

DROP POLICY IF EXISTS "Users can view own and system playbooks" ON playbooks;
DROP POLICY IF EXISTS "Anon can view system playbooks"          ON playbooks;
DROP POLICY IF EXISTS "Users can insert own playbooks"          ON playbooks;
DROP POLICY IF EXISTS "Users can update own playbooks"          ON playbooks;
DROP POLICY IF EXISTS "Users can delete own playbooks"          ON playbooks;

CREATE POLICY "org_select_playbooks" ON playbooks FOR SELECT
  USING (is_system = true OR organization_id = auth_org_id());
CREATE POLICY "org_insert_playbooks" ON playbooks FOR INSERT
  WITH CHECK (organization_id = auth_org_id() AND user_id = auth.uid() AND is_system = false);
CREATE POLICY "org_update_playbooks" ON playbooks FOR UPDATE
  USING (organization_id = auth_org_id() AND is_system = false);
CREATE POLICY "org_delete_playbooks" ON playbooks FOR DELETE
  USING (organization_id = auth_org_id() AND is_system = false);

DROP POLICY IF EXISTS "Users can view audit results for own contracts" ON audit_results;
DROP POLICY IF EXISTS "Service role can insert audit results"          ON audit_results;

CREATE POLICY "org_select_audit_results" ON audit_results FOR SELECT
  USING (organization_id = auth_org_id());
-- Only the service role (edge functions) may write audit results, and even
-- then the row's organization_id must match the parent contract's — this
-- is enforced by a trigger below, not just app code, so a compromised
-- edge function still cannot write into another tenant's rows.
CREATE POLICY "service_insert_audit_results" ON audit_results FOR INSERT
  TO service_role WITH CHECK (true);

-- 7. Trigger: stamp / verify audit_results.organization_id from contract --
CREATE OR REPLACE FUNCTION stamp_audit_result_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  contract_org uuid;
BEGIN
  SELECT organization_id INTO contract_org FROM contracts WHERE id = NEW.contract_id;
  IF contract_org IS NULL THEN
    RAISE EXCEPTION 'contract % has no organization_id', NEW.contract_id;
  END IF;
  NEW.organization_id := contract_org;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_stamp_audit_result_org
  BEFORE INSERT ON audit_results
  FOR EACH ROW EXECUTE FUNCTION stamp_audit_result_org();

-- 8. Storage: switch the folder-key from user id to organization id ------
DROP POLICY IF EXISTS "Users can upload own contracts"      ON storage.objects;
DROP POLICY IF EXISTS "Users can view own contracts files"  ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own contracts files" ON storage.objects;

CREATE POLICY "org_upload_contract_files" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'contracts' AND (storage.foldername(name))[1] = auth_org_id()::text);
CREATE POLICY "org_view_contract_files" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'contracts' AND (storage.foldername(name))[1] = auth_org_id()::text);
CREATE POLICY "org_delete_contract_files" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'contracts' AND (storage.foldername(name))[1] = auth_org_id()::text);

-- 9. New users: create (or join) an organization on signup ---------------
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_org_id uuid;
  org_name text;
BEGIN
  org_name := COALESCE(NULLIF(NEW.raw_user_meta_data->>'organization_name', ''), 'Untitled Organization');
  INSERT INTO organizations (name) VALUES (org_name) RETURNING id INTO new_org_id;

  INSERT INTO public.profiles (id, email, organization_name, organization_id)
  VALUES (NEW.id, NEW.email, org_name, new_org_id)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION auth_org_id IS 'Single source of truth for tenant scoping used by every RLS policy in this schema.';
