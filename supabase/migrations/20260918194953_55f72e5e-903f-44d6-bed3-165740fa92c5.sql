CREATE TABLE IF NOT EXISTS public.allowed_signins (
  email text PRIMARY KEY,
  tenant_id uuid,
  invited_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.allowed_signins TO authenticated;
GRANT ALL ON public.allowed_signins TO service_role;

ALTER TABLE public.allowed_signins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff can view their tenant allowlist" ON public.allowed_signins;
CREATE POLICY "staff can view their tenant allowlist"
  ON public.allowed_signins FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

-- Backfill: everyone who already has an account stays allowed.
INSERT INTO public.allowed_signins (email, tenant_id)
SELECT lower(p.email), p.tenant_id
FROM public.profiles p
WHERE p.email IS NOT NULL AND p.email <> ''
ON CONFLICT (email) DO NOTHING;

INSERT INTO public.allowed_signins (email)
SELECT lower(u.email) FROM auth.users u WHERE u.email IS NOT NULL AND u.email <> ''
ON CONFLICT (email) DO NOTHING;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _default_tenant UUID := '00000000-0000-0000-0000-000000000001';
  _tenant UUID;
  _business_name TEXT := NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'signup_business_name','')), '');
  _plan_tier TEXT := COALESCE(NULLIF(NEW.raw_user_meta_data->>'signup_plan_tier',''), 'starter');
  _slug TEXT;
  _is_first BOOLEAN;
  _is_portal_client BOOLEAN := COALESCE((NEW.raw_user_meta_data->>'portal_client')::boolean, false);
  _allowed_tenant UUID;
  _allowed BOOLEAN;
BEGIN
  -- Portal clients do NOT become staff — they interact only through portal RPCs
  IF _is_portal_client THEN
    RETURN NEW;
  END IF;

  IF _business_name IS NOT NULL THEN
    _slug := lower(regexp_replace(_business_name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(md5(NEW.id::text),1,6);
    IF _plan_tier NOT IN ('starter','growth','scale') THEN _plan_tier := 'starter'; END IF;

    INSERT INTO public.tenants (name, slug, plan_tier, onboarding_completed, business_email)
      VALUES (_business_name, _slug, _plan_tier, false, NEW.email)
      RETURNING id INTO _tenant;

    INSERT INTO public.profiles (id, tenant_id, full_name, email)
      VALUES (NEW.id, _tenant,
              COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)),
              NEW.email);

    INSERT INTO public.user_roles (user_id, tenant_id, role)
      VALUES (NEW.id, _tenant, 'owner'::app_role);

    RETURN NEW;
  END IF;

  -- Invitation-only: the email must be on the allowlist before an account
  -- can become staff. Uninvited sign-ups (e.g. random Google logins) fail.
  SELECT true, a.tenant_id INTO _allowed, _allowed_tenant
  FROM public.allowed_signins a
  WHERE a.email = lower(NEW.email)
  LIMIT 1;

  IF NOT COALESCE(_allowed, false) THEN
    RAISE EXCEPTION 'This app is invitation only. Ask your manager for an invite link.'
      USING ERRCODE = '42501';
  END IF;

  _tenant := COALESCE(_allowed_tenant, _default_tenant);

  INSERT INTO public.profiles (id, tenant_id, full_name, email)
    VALUES (NEW.id, _tenant,
            COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)),
            NEW.email);

  SELECT NOT EXISTS(SELECT 1 FROM public.user_roles WHERE tenant_id = _tenant) INTO _is_first;

  INSERT INTO public.user_roles (user_id, tenant_id, role)
    VALUES (NEW.id, _tenant,
            CASE WHEN _is_first THEN 'owner'::app_role ELSE 'employee'::app_role END);

  RETURN NEW;
END $function$;