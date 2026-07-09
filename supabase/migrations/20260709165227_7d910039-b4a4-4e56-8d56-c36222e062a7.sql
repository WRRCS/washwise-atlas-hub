
-- Tenant onboarding + plan tier columns
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS business_email text,
  ADD COLUMN IF NOT EXISTS business_phone text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/New_York',
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'en-US',
  ADD COLUMN IF NOT EXISTS plan_tier text NOT NULL DEFAULT 'starter',
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS business_hours jsonb,
  ADD COLUMN IF NOT EXISTS quiet_hours jsonb,
  ADD COLUMN IF NOT EXISTS signed_up_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_plan_tier_check;
ALTER TABLE public.tenants ADD CONSTRAINT tenants_plan_tier_check
  CHECK (plan_tier IN ('starter','growth','scale'));

-- Backfill existing tenants as already onboarded so current users are not forced through the wizard
UPDATE public.tenants SET onboarding_completed = true WHERE onboarding_completed = false;

-- Rewrite handle_new_user to create a fresh tenant when signup metadata says so
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
BEGIN
  IF _business_name IS NOT NULL THEN
    -- Fresh tenant for new SaaS signup
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
  ELSE
    -- Legacy path: join the default tenant (existing single-tenant behavior)
    _tenant := _default_tenant;

    INSERT INTO public.profiles (id, tenant_id, full_name, email)
      VALUES (NEW.id, _tenant,
              COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)),
              NEW.email);

    SELECT NOT EXISTS(SELECT 1 FROM public.user_roles WHERE tenant_id = _tenant) INTO _is_first;

    INSERT INTO public.user_roles (user_id, tenant_id, role)
      VALUES (NEW.id, _tenant,
              CASE WHEN _is_first THEN 'owner'::app_role ELSE 'employee'::app_role END);
  END IF;

  RETURN NEW;
END $function$;

-- Helper for the onboarding gate
CREATE OR REPLACE FUNCTION public.current_tenant_onboarding_completed()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT t.onboarding_completed
    FROM public.profiles p
    JOIN public.tenants t ON t.id = p.tenant_id
   WHERE p.id = auth.uid()
   LIMIT 1;
$$;
