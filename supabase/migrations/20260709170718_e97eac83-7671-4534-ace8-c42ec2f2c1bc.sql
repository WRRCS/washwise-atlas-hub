
CREATE TABLE public.plan_limits (
  plan_tier TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  price_cents_monthly INTEGER NOT NULL,
  stripe_price_id TEXT,
  max_active_clients INTEGER,
  max_monthly_jobs INTEGER,
  max_employees INTEGER,
  ai_tokens_monthly INTEGER,
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.plan_limits TO authenticated, anon;
GRANT ALL ON public.plan_limits TO service_role;
ALTER TABLE public.plan_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read plan limits" ON public.plan_limits FOR SELECT USING (true);
CREATE TRIGGER plan_limits_updated_at BEFORE UPDATE ON public.plan_limits
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

INSERT INTO public.plan_limits (plan_tier, display_name, price_cents_monthly, stripe_price_id, max_active_clients, max_monthly_jobs, max_employees, ai_tokens_monthly, features, sort_order) VALUES
  ('starter', 'Starter', 4900, 'atlas_starter_monthly', 100, 50, 3, 100000,
   '{"reports":"basic","integrations":false,"ai_assistant":false,"priority_support":false}'::jsonb, 10),
  ('growth', 'Growth', 9900, 'atlas_growth_monthly', NULL, 250, 10, 500000,
   '{"reports":"advanced","integrations":true,"ai_assistant":true,"priority_support":false}'::jsonb, 20),
  ('scale', 'Scale', 19900, 'atlas_scale_monthly', NULL, NULL, NULL, 2500000,
   '{"reports":"advanced","integrations":true,"ai_assistant":true,"priority_support":true}'::jsonb, 30);

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS subscription_status TEXT;

CREATE TABLE public.tenant_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT NOT NULL,
  price_id TEXT NOT NULL,
  plan_tier TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  environment TEXT NOT NULL DEFAULT 'sandbox',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tenant_subscriptions TO authenticated;
GRANT ALL ON public.tenant_subscriptions TO service_role;
ALTER TABLE public.tenant_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners view own subscription" ON public.tenant_subscriptions
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'owner'));
CREATE POLICY "Super admins view all subscriptions" ON public.tenant_subscriptions
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE INDEX idx_tenant_subs_tenant ON public.tenant_subscriptions(tenant_id);
CREATE INDEX idx_tenant_subs_stripe ON public.tenant_subscriptions(stripe_subscription_id);
CREATE TRIGGER tenant_subs_updated_at BEFORE UPDATE ON public.tenant_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE OR REPLACE FUNCTION public.get_tenant_usage(_tenant UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'active_clients', (SELECT COUNT(*) FROM public.clients WHERE tenant_id = _tenant),
    'monthly_jobs', (SELECT COUNT(*) FROM public.jobs
                       WHERE tenant_id = _tenant
                         AND created_at >= date_trunc('month', now())),
    'employees', (SELECT COUNT(DISTINCT user_id) FROM public.user_roles
                    WHERE tenant_id = _tenant AND role = 'employee'),
    'ai_tokens_used_month', COALESCE((SELECT SUM(total_tokens) FROM public.ai_usage_log
                                         WHERE tenant_id = _tenant
                                           AND created_at >= date_trunc('month', now())), 0)
  );
$$;
REVOKE EXECUTE ON FUNCTION public.get_tenant_usage(UUID) FROM anon;

CREATE OR REPLACE FUNCTION public.get_my_billing_summary()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _tid UUID := public.current_tenant_id();
  _plan TEXT;
  _sub JSONB;
BEGIN
  IF _tid IS NULL THEN RAISE EXCEPTION 'No tenant'; END IF;
  SELECT plan_tier INTO _plan FROM public.tenants WHERE id = _tid;
  SELECT to_jsonb(s.*) INTO _sub FROM public.tenant_subscriptions s
    WHERE s.tenant_id = _tid AND s.status IN ('active','trialing','past_due','canceled')
    ORDER BY s.created_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    'tenant_id', _tid,
    'plan_tier', _plan,
    'limits', (SELECT to_jsonb(pl.*) FROM public.plan_limits pl WHERE pl.plan_tier = _plan),
    'usage', public.get_tenant_usage(_tid),
    'subscription', _sub,
    'all_plans', (SELECT jsonb_agg(to_jsonb(pl.*) ORDER BY pl.sort_order) FROM public.plan_limits pl)
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.get_my_billing_summary() FROM anon;

CREATE OR REPLACE FUNCTION public.tg_enforce_job_limit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _cap INTEGER;
  _plan TEXT;
  _used INTEGER;
BEGIN
  SELECT t.plan_tier INTO _plan FROM public.tenants t WHERE t.id = NEW.tenant_id;
  SELECT pl.max_monthly_jobs INTO _cap FROM public.plan_limits pl WHERE pl.plan_tier = _plan;
  IF _cap IS NULL THEN RETURN NEW; END IF;
  SELECT COUNT(*) INTO _used FROM public.jobs
    WHERE tenant_id = NEW.tenant_id AND created_at >= date_trunc('month', now());
  IF _used >= _cap THEN
    RAISE EXCEPTION 'Monthly job limit reached (% of % on the % plan). Upgrade to add more jobs.',
      _used, _cap, initcap(_plan)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_job_limit ON public.jobs;
CREATE TRIGGER trg_enforce_job_limit BEFORE INSERT ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_enforce_job_limit();
