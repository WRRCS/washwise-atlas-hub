CREATE TABLE public.client_properties (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  address TEXT NOT NULL,
  notes TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX client_properties_client_idx ON public.client_properties(client_id);
CREATE INDEX client_properties_tenant_idx ON public.client_properties(tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_properties TO authenticated;
GRANT ALL ON public.client_properties TO service_role;

ALTER TABLE public.client_properties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_properties_select_tenant" ON public.client_properties
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "client_properties_owner_write" ON public.client_properties
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());

CREATE TRIGGER trg_client_properties_updated_at
  BEFORE UPDATE ON public.client_properties
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Link jobs to the specific property (existing column, no FK yet)
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_property_id_fkey
  FOREIGN KEY (property_id) REFERENCES public.client_properties(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS jobs_property_idx ON public.jobs(property_id);