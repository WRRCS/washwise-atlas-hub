
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS is_airbnb_host BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS external_source TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS external_metadata JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS uidx_jobs_external
  ON public.jobs (tenant_id, external_source, external_id)
  WHERE external_source IS NOT NULL AND external_id IS NOT NULL;

CREATE TABLE public.integration_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  error_message TEXT NOT NULL,
  inbound_payload JSONB,
  resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_integration_errors_tenant ON public.integration_errors(tenant_id, created_at DESC);
GRANT SELECT, UPDATE ON public.integration_errors TO authenticated;
GRANT ALL ON public.integration_errors TO service_role;
ALTER TABLE public.integration_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read tenant errors"
  ON public.integration_errors FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "Owners resolve tenant errors"
  ON public.integration_errors FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'owner'))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'owner'));

INSERT INTO public.service_types (tenant_id, kind, name, default_duration_minutes, default_price_cents, active)
SELECT t.id, 'airbnb_turnover'::service_kind, 'Airbnb Turnover', 180, 12000, true
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.service_types s
   WHERE s.tenant_id = t.id AND lower(s.name) = 'airbnb turnover'
);
