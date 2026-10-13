ALTER TABLE public.organizations
  ADD COLUMN plan_tier text NOT NULL DEFAULT 'free'
    CHECK (plan_tier IN ('free', 'starter', 'pro')),
  ADD COLUMN billing_status text NOT NULL DEFAULT 'free'
    CHECK (billing_status IN ('free', 'active', 'trialing', 'past_due', 'canceled')),
  ADD COLUMN paddle_customer_id text UNIQUE,
  ADD COLUMN paddle_subscription_id text UNIQUE,
  ADD COLUMN paddle_event_at timestamptz,
  ADD COLUMN billing_period_end timestamptz,
  ADD COLUMN free_audits_used integer NOT NULL DEFAULT 0
    CHECK (free_audits_used >= 0),
  ADD COLUMN monthly_audits_used integer NOT NULL DEFAULT 0
    CHECK (monthly_audits_used >= 0),
  ADD COLUMN usage_period_start timestamptz NOT NULL DEFAULT date_trunc('month', now());

CREATE TABLE public.contract_audit_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_type text NOT NULL CHECK (usage_type IN ('initial', 'rerun')),
  consumed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_contract_audit_usage_org_time
  ON public.contract_audit_usage (organization_id, consumed_at DESC);
ALTER TABLE public.contract_audit_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contract_audit_usage FROM PUBLIC, anon, authenticated;

CREATE TABLE public.contract_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
  file_url text NOT NULL DEFAULT '',
  file_content text NOT NULL CHECK (length(file_content) BETWEEN 1 AND 100000),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO storage.buckets (id, name, public)
VALUES ('contract-versions', 'contract-versions', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "org_upload_contract_versions" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'contract-versions'
    AND (storage.foldername(name))[1] = public.auth_org_id()::text
  );
CREATE POLICY "org_view_contract_versions" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'contract-versions'
    AND (storage.foldername(name))[1] = public.auth_org_id()::text
  );
CREATE POLICY "org_delete_contract_versions" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'contract-versions'
    AND (storage.foldername(name))[1] = public.auth_org_id()::text
  );

CREATE INDEX idx_contract_versions_contract_time
  ON public.contract_versions (contract_id, created_at DESC);
ALTER TABLE public.contract_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contract_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.contract_versions TO authenticated;
CREATE POLICY "org_select_contract_versions" ON public.contract_versions
  FOR SELECT USING (organization_id = public.auth_org_id());
CREATE POLICY "org_insert_contract_versions" ON public.contract_versions
  FOR INSERT WITH CHECK (
    organization_id = public.auth_org_id()
    AND user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.contracts
      WHERE contracts.id = contract_id
        AND contracts.organization_id = public.auth_org_id()
    )
  );

CREATE OR REPLACE FUNCTION public.enforce_contract_version_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.file_url NOT LIKE NEW.organization_id::text || '/%' THEN
    RAISE EXCEPTION 'revision storage path must belong to the contract organization';
  END IF;
  IF lower(NEW.file_name) LIKE '%.docx'
     AND NOT EXISTS (
       SELECT 1 FROM public.organizations
       WHERE id = NEW.organization_id AND plan_tier = 'pro'
         AND billing_status IN ('active', 'trialing')
     ) THEN
    RAISE EXCEPTION 'DOCX extraction is available on the Pro plan';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_contract_version_plan
  BEFORE INSERT ON public.contract_versions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_contract_version_plan();

CREATE OR REPLACE FUNCTION public.consume_organization_audit_credit(
  p_organization_id uuid,
  p_contract_id uuid,
  p_user_id uuid,
  p_usage_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  org public.organizations%ROWTYPE;
  plan_limit integer;
  current_period_start timestamptz := date_trunc('month', now());
BEGIN
  SELECT * INTO org
  FROM public.organizations
  WHERE id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization was not found';
  END IF;

  IF org.plan_tier IN ('starter', 'pro')
     AND org.billing_status IN ('active', 'trialing') THEN
    plan_limit := CASE org.plan_tier WHEN 'starter' THEN 25 ELSE 150 END;
    IF org.usage_period_start < current_period_start THEN
      org.monthly_audits_used := 0;
      UPDATE public.organizations
      SET monthly_audits_used = 0,
          usage_period_start = current_period_start
      WHERE id = p_organization_id;
    END IF;

    IF org.monthly_audits_used >= plan_limit THEN
      RAISE EXCEPTION 'AUDIT_QUOTA_EXCEEDED: % plan monthly limit reached', initcap(org.plan_tier);
    END IF;

    UPDATE public.organizations
    SET monthly_audits_used = monthly_audits_used + 1
    WHERE id = p_organization_id
    RETURNING * INTO org;
  ELSE
    IF org.free_audits_used >= 3 THEN
      RAISE EXCEPTION 'AUDIT_QUOTA_EXCEEDED: free audit credits exhausted';
    END IF;

    UPDATE public.organizations
    SET free_audits_used = free_audits_used + 1
    WHERE id = p_organization_id
    RETURNING * INTO org;
  END IF;

  INSERT INTO public.contract_audit_usage (
    organization_id, contract_id, user_id, usage_type
  ) VALUES (p_organization_id, p_contract_id, p_user_id, p_usage_type);

  RETURN jsonb_build_object(
    'plan_tier', org.plan_tier,
    'billing_status', org.billing_status,
    'free_audits_used', org.free_audits_used,
    'free_audits_remaining', greatest(0, 3 - org.free_audits_used),
    'monthly_audits_used', org.monthly_audits_used,
    'monthly_audits_limit', CASE org.plan_tier
      WHEN 'starter' THEN 25 WHEN 'pro' THEN 150 ELSE 0 END,
    'monthly_audits_remaining', CASE org.plan_tier
      WHEN 'starter' THEN greatest(0, 25 - org.monthly_audits_used)
      WHEN 'pro' THEN greatest(0, 150 - org.monthly_audits_used)
      ELSE 0 END,
    'usage_period_start', org.usage_period_start
  );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_organization_audit_credit(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_contract_for_audit(
  p_file_name text,
  p_file_url text,
  p_file_content text,
  p_playbook_id uuid DEFAULT NULL
)
RETURNS public.contracts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_organization_id uuid;
  new_contract public.contracts%ROWTYPE;
  selected_playbook_is_system boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication is required to upload a contract';
  END IF;
  IF p_file_name IS NULL OR length(p_file_name) NOT BETWEEN 1 AND 255
     OR p_file_url IS NULL OR length(p_file_url) > 1024
     OR p_file_content IS NULL OR length(btrim(p_file_content)) = 0
     OR length(p_file_content) > 100000 THEN
    RAISE EXCEPTION 'contract file name, storage path, or extracted text is invalid';
  END IF;

  SELECT organization_id INTO current_organization_id
  FROM public.profiles WHERE id = auth.uid();
  IF current_organization_id IS NULL THEN
    RAISE EXCEPTION 'organization profile is unavailable';
  END IF;
  IF p_file_url NOT LIKE current_organization_id::text || '/%' THEN
    RAISE EXCEPTION 'contract storage path must belong to the current organization';
  END IF;

  IF lower(p_file_name) LIKE '%.docx'
     AND NOT EXISTS (
       SELECT 1 FROM public.organizations
       WHERE id = current_organization_id
         AND plan_tier = 'pro'
         AND billing_status IN ('active', 'trialing')
     ) THEN
    RAISE EXCEPTION 'DOCX extraction is available on the Pro plan';
  END IF;

  IF p_playbook_id IS NOT NULL THEN
    SELECT is_system INTO selected_playbook_is_system
    FROM public.playbooks
    WHERE id = p_playbook_id
      AND (is_system = true OR organization_id = current_organization_id);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'selected playbook is not available in this organization';
    END IF;
    IF selected_playbook_is_system IS FALSE
       AND NOT EXISTS (
         SELECT 1 FROM public.organizations
         WHERE id = current_organization_id AND plan_tier = 'pro'
           AND billing_status IN ('active', 'trialing')
       ) THEN
      RAISE EXCEPTION 'Custom playbooks are available on the Pro plan';
    END IF;
  END IF;

  INSERT INTO public.contracts (
    user_id, organization_id, file_name, file_url, file_content, playbook_id
  ) VALUES (
    auth.uid(), current_organization_id, p_file_name, p_file_url, p_file_content, p_playbook_id
  )
  RETURNING * INTO new_contract;

  PERFORM public.consume_organization_audit_credit(
    current_organization_id, new_contract.id, auth.uid(), 'initial'
  );
  RETURN new_contract;
END;
$$;

REVOKE ALL ON FUNCTION public.create_contract_for_audit(text, text, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_contract_for_audit(text, text, text, uuid)
  TO authenticated;
REVOKE INSERT ON public.contracts FROM authenticated;
REVOKE UPDATE ON public.contracts FROM authenticated;

CREATE OR REPLACE FUNCTION public.claim_contract_audit(p_contract_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_contract public.contracts%ROWTYPE;
  is_initial boolean;
  contract_playbook_is_system boolean;
  org_plan text;
BEGIN
  SELECT * INTO target_contract
  FROM public.contracts
  WHERE id = p_contract_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'contract was not found';
  END IF;
  IF target_contract.status = 'processing' THEN
    RAISE EXCEPTION 'contract is already being audited';
  END IF;
  IF target_contract.status NOT IN ('uploaded', 'failed', 'completed') THEN
    RAISE EXCEPTION 'contract cannot be audited from its current state';
  END IF;

  SELECT is_system INTO contract_playbook_is_system
  FROM public.playbooks WHERE id = target_contract.playbook_id;
  IF target_contract.playbook_id IS NOT NULL
     AND contract_playbook_is_system IS FALSE THEN
    SELECT plan_tier INTO org_plan FROM public.organizations
    WHERE id = target_contract.organization_id AND billing_status IN ('active', 'trialing');
    IF org_plan IS DISTINCT FROM 'pro' THEN
      RAISE EXCEPTION 'Custom playbooks are available on the Pro plan';
    END IF;
  END IF;

  is_initial := target_contract.status = 'uploaded'
    AND EXISTS (
      SELECT 1 FROM public.contract_audit_usage
      WHERE contract_id = p_contract_id AND usage_type = 'initial'
    );

  IF NOT is_initial THEN
    PERFORM public.consume_organization_audit_credit(
      target_contract.organization_id, target_contract.id, target_contract.user_id, 'rerun'
    );
  END IF;

  UPDATE public.contracts SET status = 'processing' WHERE id = p_contract_id;
  RETURN jsonb_build_object('contract_id', p_contract_id, 'claimed', true);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_contract_audit(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_contract_audit(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_audit_usage()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  usage_row public.organizations%ROWTYPE;
  monthly_limit integer;
  is_paid boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication is required';
  END IF;

  SELECT organizations.* INTO usage_row
  FROM public.organizations
  JOIN public.profiles ON profiles.organization_id = organizations.id
  WHERE profiles.id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization profile is unavailable';
  END IF;

  is_paid := usage_row.plan_tier IN ('starter', 'pro')
    AND usage_row.billing_status IN ('active', 'trialing');
  monthly_limit := CASE usage_row.plan_tier WHEN 'starter' THEN 25 WHEN 'pro' THEN 150 ELSE 0 END;

  RETURN jsonb_build_object(
    'plan_tier', usage_row.plan_tier,
    'billing_status', usage_row.billing_status,
    'free_audits_used', usage_row.free_audits_used,
    'free_audits_remaining', CASE WHEN is_paid THEN 0 ELSE greatest(0, 3 - usage_row.free_audits_used) END,
    'monthly_audits_used', CASE WHEN usage_row.usage_period_start >= date_trunc('month', now())
      THEN usage_row.monthly_audits_used ELSE 0 END,
    'monthly_audits_limit', CASE WHEN is_paid THEN monthly_limit ELSE 0 END,
    'monthly_audits_remaining', CASE WHEN is_paid THEN greatest(0,
      monthly_limit - CASE WHEN usage_row.usage_period_start >= date_trunc('month', now())
        THEN usage_row.monthly_audits_used ELSE 0 END) ELSE 0 END,
    'can_upload', CASE WHEN is_paid THEN
      CASE WHEN usage_row.usage_period_start >= date_trunc('month', now())
        THEN usage_row.monthly_audits_used < monthly_limit ELSE TRUE END
      ELSE usage_row.free_audits_used < 3 END,
    'can_use_custom_playbooks', usage_row.plan_tier = 'pro'
      AND usage_row.billing_status IN ('active', 'trialing'),
    'can_invite_team', usage_row.plan_tier = 'pro'
      AND usage_row.billing_status IN ('active', 'trialing')
      AND usage_row.owner_id = auth.uid(),
    'is_workspace_owner', usage_row.owner_id = auth.uid()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_audit_usage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_audit_usage() TO authenticated;

CREATE OR REPLACE FUNCTION public.can_upload_contract()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organizations
    WHERE id = public.auth_org_id()
      AND CASE
        WHEN plan_tier IN ('starter', 'pro') AND billing_status IN ('active', 'trialing') THEN
          usage_period_start < date_trunc('month', now())
          OR monthly_audits_used < CASE plan_tier WHEN 'starter' THEN 25 ELSE 150 END
        ELSE free_audits_used < 3
      END
  )
$$;

REVOKE ALL ON FUNCTION public.can_upload_contract() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_upload_contract() TO authenticated;

DROP POLICY IF EXISTS "org_upload_contract_files" ON storage.objects;
CREATE POLICY "org_upload_contract_files" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'contracts'
    AND (storage.foldername(name))[1] = public.auth_org_id()::text
    AND public.can_upload_contract()
  );

CREATE OR REPLACE FUNCTION public.enforce_pro_playbooks()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.is_system THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = NEW.organization_id AND plan_tier = 'pro'
      AND billing_status IN ('active', 'trialing')
  ) THEN
    RAISE EXCEPTION 'Custom playbooks are available on the Pro plan';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_pro_playbooks
  BEFORE INSERT OR UPDATE ON public.playbooks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_pro_playbooks();

CREATE TABLE public.paddle_webhook_events (
  event_id text PRIMARY KEY,
  occurred_at timestamptz NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.paddle_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paddle_webhook_events FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_paddle_subscription(
  p_event_id text,
  p_organization_id uuid,
  p_customer_id text,
  p_subscription_id text,
  p_status text,
  p_price_id text,
  p_starter_price_id text,
  p_pro_price_id text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_occurred_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_organization_id uuid;
  current_event_at timestamptz;
  next_tier text;
BEGIN
  IF p_event_id IS NULL OR length(p_event_id) > 255
     OR p_status NOT IN ('active', 'trialing', 'past_due', 'canceled', 'paused')
     OR p_occurred_at IS NULL THEN
    RAISE EXCEPTION 'invalid Paddle subscription event';
  END IF;

  INSERT INTO public.paddle_webhook_events (event_id, occurred_at)
  VALUES (p_event_id, p_occurred_at)
  ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  target_organization_id := p_organization_id;
  IF target_organization_id IS NULL THEN
    SELECT id INTO target_organization_id
    FROM public.organizations WHERE paddle_customer_id = p_customer_id;
  END IF;
  IF target_organization_id IS NULL THEN
    RAISE EXCEPTION 'Paddle event does not identify a ClauseGuard organization';
  END IF;

  SELECT paddle_event_at INTO current_event_at
  FROM public.organizations WHERE id = target_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization not found for Paddle event';
  END IF;
  IF current_event_at IS NOT NULL AND current_event_at >= p_occurred_at THEN
    RETURN;
  END IF;

  next_tier := CASE
    WHEN p_price_id = p_starter_price_id THEN 'starter'
    WHEN p_price_id = p_pro_price_id THEN 'pro'
    ELSE 'free'
  END;
  IF p_status IN ('active', 'trialing') AND next_tier = 'free' THEN
    RAISE EXCEPTION 'Paddle subscription price is not configured for a ClauseGuard plan';
  END IF;

  UPDATE public.organizations
  SET plan_tier = CASE WHEN p_status IN ('active', 'trialing') THEN next_tier ELSE 'free' END,
      billing_status = CASE WHEN p_status = 'paused' THEN 'canceled' ELSE p_status END,
      paddle_customer_id = COALESCE(p_customer_id, paddle_customer_id),
      paddle_subscription_id = CASE WHEN p_status IN ('canceled', 'paused')
        THEN NULL ELSE COALESCE(p_subscription_id, paddle_subscription_id) END,
      paddle_event_at = p_occurred_at,
      usage_period_start = COALESCE(p_period_start, usage_period_start),
      billing_period_end = COALESCE(p_period_end, billing_period_end),
      monthly_audits_used = CASE WHEN p_period_start IS NOT NULL
        AND p_period_start > usage_period_start THEN 0 ELSE monthly_audits_used END
  WHERE id = target_organization_id;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_paddle_subscription(
  text, uuid, text, text, text, text, text, text, timestamptz, timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_paddle_subscription(
  text, uuid, text, text, text, text, text, text, timestamptz, timestamptz, timestamptz
) TO service_role;

CREATE OR REPLACE FUNCTION public.create_organization_invite(
  p_valid_days integer DEFAULT 7,
  p_max_uses integer DEFAULT 10
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_organization_id uuid;
  invite_code text;
BEGIN
  SELECT organization_id INTO current_organization_id
  FROM public.profiles WHERE id = auth.uid();
  IF current_organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = current_organization_id AND owner_id = auth.uid()
      AND plan_tier = 'pro' AND billing_status IN ('active', 'trialing')
  ) THEN
    RAISE EXCEPTION 'Team collaboration invites are available on the Pro plan to workspace owners';
  END IF;
  IF p_valid_days IS NULL OR p_valid_days NOT BETWEEN 1 AND 30
     OR p_max_uses IS NULL OR p_max_uses NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'invite validity must be 1-30 days and usage limit must be 1-50';
  END IF;

  invite_code := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.organization_invites (
    invite_hash, organization_id, created_by, expires_at, max_uses
  ) VALUES (
    md5(invite_code), current_organization_id, auth.uid(),
    now() + make_interval(days => p_valid_days), p_max_uses
  );
  RETURN invite_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  requested_invite_code text;
  target_organization_id uuid;
  organization_display_name text;
BEGIN
  requested_invite_code := lower(btrim(COALESCE(NEW.raw_user_meta_data->>'organization_invite_code', '')));

  IF requested_invite_code <> '' THEN
    IF length(requested_invite_code) > 64 THEN
      RAISE EXCEPTION 'organization invite code is invalid or expired';
    END IF;
    SELECT organization_id INTO target_organization_id
    FROM public.organization_invites
    WHERE invite_hash = md5(requested_invite_code)
      AND expires_at > now()
      AND accepted_count < max_uses
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'organization invite code is invalid, expired, or fully used';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.organizations
      WHERE id = target_organization_id AND plan_tier = 'pro'
        AND billing_status IN ('active', 'trialing')
    ) THEN
      RAISE EXCEPTION 'This workspace requires an active Pro subscription';
    END IF;
    UPDATE public.organization_invites
    SET accepted_count = accepted_count + 1
    WHERE invite_hash = md5(requested_invite_code);
    SELECT name INTO organization_display_name
    FROM public.organizations WHERE id = target_organization_id;
  ELSE
    organization_display_name := COALESCE(
      NULLIF(btrim(NEW.raw_user_meta_data->>'organization_name'), ''),
      'Untitled Organization'
    );
    INSERT INTO public.organizations (name, owner_id)
    VALUES (organization_display_name, NEW.id)
    RETURNING id INTO target_organization_id;
  END IF;

  INSERT INTO public.profiles (id, email, organization_name, organization_id)
  VALUES (NEW.id, NEW.email, organization_display_name, target_organization_id)
  ON CONFLICT (id) DO NOTHING;
  NEW.raw_user_meta_data := NEW.raw_user_meta_data - 'organization_invite_code';
  RETURN NEW;
END;
$$;
