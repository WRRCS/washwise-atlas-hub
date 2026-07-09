
CREATE TABLE public.platform_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  target_entity_type TEXT,
  target_entity_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.platform_audit_log TO authenticated;
GRANT ALL ON public.platform_audit_log TO service_role;
ALTER TABLE public.platform_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admins view audit log" ON public.platform_audit_log
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'super_admin'));
CREATE INDEX idx_platform_audit_created_at ON public.platform_audit_log(created_at DESC);
CREATE INDEX idx_platform_audit_actor ON public.platform_audit_log(actor_id);
CREATE INDEX idx_platform_audit_tenant ON public.platform_audit_log(target_tenant_id);

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.has_role(auth.uid(), 'super_admin'); $$;
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM anon;

CREATE OR REPLACE FUNCTION public.log_platform_action(
  _action TEXT, _tenant UUID DEFAULT NULL, _entity_type TEXT DEFAULT NULL,
  _entity_id UUID DEFAULT NULL, _metadata JSONB DEFAULT '{}'::jsonb
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _id UUID;
BEGIN
  INSERT INTO public.platform_audit_log (actor_id, action, target_tenant_id, target_entity_type, target_entity_id, metadata)
  VALUES (auth.uid(), _action, _tenant, _entity_type, _entity_id, COALESCE(_metadata,'{}'::jsonb))
  RETURNING id INTO _id;
  RETURN _id;
END $$;
REVOKE EXECUTE ON FUNCTION public.log_platform_action(TEXT,UUID,TEXT,UUID,JSONB) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_tenants()
RETURNS TABLE(
  id UUID, name TEXT, slug TEXT, plan_tier TEXT, onboarding_completed BOOLEAN,
  business_email TEXT, created_at TIMESTAMPTZ,
  user_count BIGINT, client_count BIGINT, job_count BIGINT,
  paid_invoice_count BIGINT, total_revenue_cents BIGINT, last_activity_at TIMESTAMPTZ
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  RETURN QUERY
  SELECT t.id, t.name, t.slug, t.plan_tier, t.onboarding_completed, t.business_email, t.created_at,
    (SELECT COUNT(*) FROM public.profiles p WHERE p.tenant_id = t.id)::BIGINT,
    (SELECT COUNT(*) FROM public.clients c WHERE c.tenant_id = t.id)::BIGINT,
    (SELECT COUNT(*) FROM public.jobs j WHERE j.tenant_id = t.id)::BIGINT,
    (SELECT COUNT(*) FROM public.invoices i WHERE i.tenant_id = t.id AND i.status='paid')::BIGINT,
    COALESCE((SELECT SUM(i.total_cents) FROM public.invoices i WHERE i.tenant_id = t.id AND i.status='paid'),0)::BIGINT,
    (SELECT MAX(a.created_at) FROM public.activity_log a WHERE a.tenant_id = t.id)
  FROM public.tenants t ORDER BY t.created_at DESC;
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_list_tenants() FROM anon;

CREATE OR REPLACE FUNCTION public.admin_get_tenant(_tenant UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _result JSONB;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  PERFORM public.log_platform_action('view_tenant', _tenant, 'tenant', _tenant, '{}'::jsonb);
  SELECT jsonb_build_object(
    'tenant', to_jsonb(t.*),
    'users', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'full_name', p.full_name, 'email', p.email,
        'role', (SELECT role FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.tenant_id = t.id LIMIT 1)
      )) FROM public.profiles p WHERE p.tenant_id = t.id), '[]'::jsonb),
    'stats', jsonb_build_object(
      'clients', (SELECT COUNT(*) FROM public.clients WHERE tenant_id = t.id),
      'jobs', (SELECT COUNT(*) FROM public.jobs WHERE tenant_id = t.id),
      'jobs_completed', (SELECT COUNT(*) FROM public.jobs WHERE tenant_id = t.id AND status='completed'),
      'invoices', (SELECT COUNT(*) FROM public.invoices WHERE tenant_id = t.id),
      'paid_revenue_cents', COALESCE((SELECT SUM(total_cents) FROM public.invoices WHERE tenant_id = t.id AND status='paid'),0),
      'outstanding_cents', COALESCE((SELECT SUM(total_cents) FROM public.invoices WHERE tenant_id = t.id AND status IN ('sent','overdue')),0),
      'employees', (SELECT COUNT(*) FROM public.user_roles WHERE tenant_id = t.id AND role='employee'),
      'service_types', (SELECT COUNT(*) FROM public.service_types WHERE tenant_id = t.id)
    ),
    'recent_activity', COALESCE((SELECT jsonb_agg(to_jsonb(a.*)) FROM (
      SELECT * FROM public.activity_log WHERE tenant_id = t.id ORDER BY created_at DESC LIMIT 25
    ) a), '[]'::jsonb)
  ) INTO _result FROM public.tenants t WHERE t.id = _tenant;
  RETURN _result;
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_get_tenant(UUID) FROM anon;

CREATE OR REPLACE FUNCTION public.admin_platform_stats()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  RETURN jsonb_build_object(
    'tenants_total', (SELECT COUNT(*) FROM public.tenants),
    'tenants_onboarded', (SELECT COUNT(*) FROM public.tenants WHERE onboarding_completed),
    'tenants_by_plan', COALESCE((SELECT jsonb_object_agg(plan_tier, cnt) FROM (
      SELECT plan_tier, COUNT(*) AS cnt FROM public.tenants GROUP BY plan_tier
    ) x), '{}'::jsonb),
    'users_total', (SELECT COUNT(*) FROM public.profiles),
    'jobs_total', (SELECT COUNT(*) FROM public.jobs),
    'jobs_last_30d', (SELECT COUNT(*) FROM public.jobs WHERE created_at > now() - interval '30 days'),
    'revenue_total_cents', COALESCE((SELECT SUM(total_cents) FROM public.invoices WHERE status='paid'),0),
    'revenue_last_30d_cents', COALESCE((SELECT SUM(total_cents) FROM public.invoices WHERE status='paid' AND paid_at > now() - interval '30 days'),0),
    'signups_last_30d', (SELECT COUNT(*) FROM public.tenants WHERE created_at > now() - interval '30 days')
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_platform_stats() FROM anon;
