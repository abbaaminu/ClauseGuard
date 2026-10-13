ALTER TABLE public.organizations
  ADD COLUMN owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

WITH first_members AS (
  SELECT DISTINCT ON (organization_id) organization_id, id
  FROM public.profiles
  WHERE organization_id IS NOT NULL
  ORDER BY organization_id, created_at, id
)
UPDATE public.organizations AS organizations
SET owner_id = first_members.id
FROM first_members
WHERE organizations.id = first_members.organization_id;

CREATE TABLE public.organization_invites (
  invite_hash text PRIMARY KEY CHECK (invite_hash ~ '^[0-9a-f]{32}$'),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  max_uses integer NOT NULL CHECK (max_uses BETWEEN 1 AND 50),
  accepted_count integer NOT NULL DEFAULT 0 CHECK (accepted_count BETWEEN 0 AND max_uses),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.organization_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organization_invites FROM PUBLIC, anon, authenticated;

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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication is required to create an organization invite';
  END IF;

  SELECT organization_id INTO current_organization_id
  FROM public.profiles
  WHERE id = auth.uid();

  IF current_organization_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.organizations
    WHERE id = current_organization_id AND owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'only the organization owner can create invite codes';
  END IF;

    IF p_valid_days IS NULL OR p_valid_days NOT BETWEEN 1 AND 30
      OR p_max_uses IS NULL OR p_max_uses NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'invite validity must be 1-30 days and usage limit must be 1-50';
  END IF;

  invite_code := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.organization_invites (
    invite_hash,
    organization_id,
    created_by,
    expires_at,
    max_uses
  ) VALUES (
    md5(invite_code),
    current_organization_id,
    auth.uid(),
    now() + make_interval(days => p_valid_days),
    p_max_uses
  );

  RETURN invite_code;
END;
$$;

REVOKE ALL ON FUNCTION public.create_organization_invite(integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_organization_invite(integer, integer)
  TO authenticated;

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

    UPDATE public.organization_invites
    SET accepted_count = accepted_count + 1
    WHERE invite_hash = md5(requested_invite_code);

    SELECT name INTO organization_display_name
    FROM public.organizations
    WHERE id = target_organization_id;
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