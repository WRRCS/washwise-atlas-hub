ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS subscription_status_changed_at timestamptz;

CREATE OR REPLACE FUNCTION public.tg_tenant_subscription_status_stamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.subscription_status IS DISTINCT FROM OLD.subscription_status THEN
    NEW.subscription_status_changed_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_tenants_subscription_status_stamp ON public.tenants;
CREATE TRIGGER tg_tenants_subscription_status_stamp
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.tg_tenant_subscription_status_stamp();

UPDATE public.tenants
   SET subscription_status_changed_at = COALESCE(subscription_status_changed_at, created_at)
 WHERE subscription_status IS NOT NULL AND subscription_status_changed_at IS NULL;

CREATE OR REPLACE FUNCTION public.tg_enforce_client_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _cap INTEGER;
  _plan TEXT;
  _used INTEGER;
BEGIN
  SELECT t.plan_tier INTO _plan FROM public.tenants t WHERE t.id = NEW.tenant_id;
  SELECT pl.max_active_clients INTO _cap FROM public.plan_limits pl WHERE pl.plan_tier = _plan;
  IF _cap IS NULL THEN RETURN NEW; END IF;
  SELECT COUNT(*) INTO _used FROM public.clients
    WHERE tenant_id = NEW.tenant_id AND is_active = true;
  IF _used >= _cap THEN
    RAISE EXCEPTION 'Active client limit reached (% of % on the % plan). Upgrade to add more clients.',
      _used, _cap, initcap(_plan)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_clients_enforce_limit ON public.clients;
CREATE TRIGGER tg_clients_enforce_limit
  BEFORE INSERT ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.tg_enforce_client_limit();

CREATE OR REPLACE FUNCTION public.tg_enforce_employee_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _cap INTEGER;
  _plan TEXT;
  _used INTEGER;
BEGIN
  IF NEW.role <> 'employee'::app_role THEN RETURN NEW; END IF;
  SELECT t.plan_tier INTO _plan FROM public.tenants t WHERE t.id = NEW.tenant_id;
  SELECT pl.max_employees INTO _cap FROM public.plan_limits pl WHERE pl.plan_tier = _plan;
  IF _cap IS NULL THEN RETURN NEW; END IF;
  SELECT COUNT(DISTINCT user_id) INTO _used FROM public.user_roles
    WHERE tenant_id = NEW.tenant_id AND role = 'employee'::app_role;
  IF _used >= _cap THEN
    RAISE EXCEPTION 'Employee limit reached (% of % on the % plan). Upgrade to invite more employees.',
      _used, _cap, initcap(_plan)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_user_roles_enforce_employee_limit ON public.user_roles;
CREATE TRIGGER tg_user_roles_enforce_employee_limit
  BEFORE INSERT ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.tg_enforce_employee_limit();

CREATE OR REPLACE FUNCTION public.get_my_subscription_gate()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tid UUID := public.current_tenant_id();
  _status TEXT;
  _changed_at TIMESTAMPTZ;
BEGIN
  IF _tid IS NULL THEN RETURN NULL; END IF;
  SELECT subscription_status, subscription_status_changed_at
    INTO _status, _changed_at
    FROM public.tenants WHERE id = _tid;
  RETURN jsonb_build_object(
    'subscription_status', _status,
    'subscription_status_changed_at', _changed_at,
    'grace_days', 7
  );
END $$;

REVOKE ALL ON FUNCTION public.get_my_subscription_gate() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_subscription_gate() TO authenticated;