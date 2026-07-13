
-- 1. New columns on tenants for Business Profile
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS legal_name text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'America/New_York',
  ADD COLUMN IF NOT EXISTS invoice_prefix text,
  ADD COLUMN IF NOT EXISTS invoice_footer text,
  ADD COLUMN IF NOT EXISTS payment_terms_days integer DEFAULT 14,
  ADD COLUMN IF NOT EXISTS late_fee_percent numeric(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS primary_color text DEFAULT '#0b6e4f';

-- 2. subscription_invoices table (renewal receipts from Stripe)
CREATE TABLE IF NOT EXISTS public.subscription_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  stripe_invoice_id text NOT NULL UNIQUE,
  stripe_subscription_id text,
  stripe_customer_id text,
  amount_paid_cents integer NOT NULL DEFAULT 0,
  amount_due_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL,
  hosted_invoice_url text,
  invoice_pdf text,
  period_start timestamptz,
  period_end timestamptz,
  environment text NOT NULL DEFAULT 'sandbox',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sub_invoices_tenant ON public.subscription_invoices(tenant_id, created_at DESC);

GRANT SELECT ON public.subscription_invoices TO authenticated;
GRANT ALL ON public.subscription_invoices TO service_role;

ALTER TABLE public.subscription_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners can view their tenant's subscription invoices" ON public.subscription_invoices;
CREATE POLICY "Owners can view their tenant's subscription invoices"
  ON public.subscription_invoices FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'owner'::app_role));

DROP POLICY IF EXISTS "Super admin can view all subscription invoices" ON public.subscription_invoices;
CREATE POLICY "Super admin can view all subscription invoices"
  ON public.subscription_invoices FOR SELECT
  TO authenticated
  USING (public.is_super_admin());

DROP TRIGGER IF EXISTS trg_subscription_invoices_updated_at ON public.subscription_invoices;
CREATE TRIGGER trg_subscription_invoices_updated_at
  BEFORE UPDATE ON public.subscription_invoices
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 3. get_my_billing_summary now filters by environment when provided
CREATE OR REPLACE FUNCTION public.get_my_billing_summary(_environment text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _tid UUID := public.current_tenant_id();
  _plan TEXT;
  _sub JSONB;
  _invoices JSONB;
BEGIN
  IF _tid IS NULL THEN RAISE EXCEPTION 'No tenant'; END IF;
  SELECT plan_tier INTO _plan FROM public.tenants WHERE id = _tid;

  SELECT to_jsonb(s.*) INTO _sub FROM public.tenant_subscriptions s
    WHERE s.tenant_id = _tid
      AND s.status IN ('active','trialing','past_due','canceled','unpaid','incomplete')
      AND (_environment IS NULL OR s.environment = _environment)
    ORDER BY s.created_at DESC LIMIT 1;

  SELECT COALESCE(jsonb_agg(to_jsonb(si.*) ORDER BY si.created_at DESC), '[]'::jsonb)
    INTO _invoices
    FROM (
      SELECT * FROM public.subscription_invoices
       WHERE tenant_id = _tid
         AND (_environment IS NULL OR environment = _environment)
       ORDER BY created_at DESC
       LIMIT 24
    ) si;

  RETURN jsonb_build_object(
    'tenant_id', _tid,
    'plan_tier', _plan,
    'limits', (SELECT to_jsonb(pl.*) FROM public.plan_limits pl WHERE pl.plan_tier = _plan),
    'usage', public.get_tenant_usage(_tid),
    'subscription', _sub,
    'invoices', _invoices,
    'all_plans', (SELECT jsonb_agg(to_jsonb(pl.*) ORDER BY pl.sort_order) FROM public.plan_limits pl)
  );
END $function$;

-- 4. preview_plan_change RPC — reports blocking overages before switching plans
CREATE OR REPLACE FUNCTION public.preview_plan_change(_target_tier text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _tid UUID := public.current_tenant_id();
  _limits RECORD;
  _usage JSONB;
  _blocking JSONB := '[]'::jsonb;
  _ac INTEGER; _mj INTEGER; _emp INTEGER;
BEGIN
  IF _tid IS NULL THEN RAISE EXCEPTION 'No tenant'; END IF;
  SELECT * INTO _limits FROM public.plan_limits WHERE plan_tier = _target_tier;
  IF _limits IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unknown plan');
  END IF;

  _usage := public.get_tenant_usage(_tid);
  _ac := (_usage->>'active_clients')::int;
  _mj := (_usage->>'monthly_jobs')::int;
  _emp := (_usage->>'employees')::int;

  IF _limits.max_active_clients IS NOT NULL AND _ac > _limits.max_active_clients THEN
    _blocking := _blocking || jsonb_build_object('limit','active_clients','current',_ac,'allowed',_limits.max_active_clients);
  END IF;
  IF _limits.max_monthly_jobs IS NOT NULL AND _mj > _limits.max_monthly_jobs THEN
    _blocking := _blocking || jsonb_build_object('limit','monthly_jobs','current',_mj,'allowed',_limits.max_monthly_jobs);
  END IF;
  IF _limits.max_employees IS NOT NULL AND _emp > _limits.max_employees THEN
    _blocking := _blocking || jsonb_build_object('limit','employees','current',_emp,'allowed',_limits.max_employees);
  END IF;

  RETURN jsonb_build_object(
    'ok', jsonb_array_length(_blocking) = 0,
    'target_tier', _target_tier,
    'blocking', _blocking
  );
END $function$;

GRANT EXECUTE ON FUNCTION public.preview_plan_change(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_billing_summary(text) TO authenticated;
