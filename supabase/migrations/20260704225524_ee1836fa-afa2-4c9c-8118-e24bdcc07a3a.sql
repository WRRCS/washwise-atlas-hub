-- Lead status enum
DO $$ BEGIN
  CREATE TYPE public.lead_status AS ENUM ('new','contacted','qualified','won','lost');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'godaddy_website',
  status public.lead_status NOT NULL DEFAULT 'new',
  assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  service_interest TEXT,
  notes TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_contacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX leads_tenant_status_idx ON public.leads (tenant_id, status);
CREATE INDEX leads_tenant_created_idx ON public.leads (tenant_id, created_at DESC);
CREATE INDEX leads_client_idx ON public.leads (client_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage leads"
  ON public.leads
  FOR ALL
  TO authenticated
  USING (public.is_owner() AND tenant_id = public.current_tenant_id())
  WITH CHECK (public.is_owner() AND tenant_id = public.current_tenant_id());

CREATE POLICY "Employees view assigned leads"
  ON public.leads
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND assigned_to = auth.uid()
  );

CREATE TRIGGER leads_set_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
