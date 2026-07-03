
-- ============ sops ============
CREATE TABLE public.sops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  service_type_id UUID NOT NULL REFERENCES public.service_types(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sops_tenant_service_idx ON public.sops(tenant_id, service_type_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sops TO authenticated;
GRANT ALL ON public.sops TO service_role;

ALTER TABLE public.sops ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sops_select_tenant" ON public.sops FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "sops_owner_insert" ON public.sops FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());
CREATE POLICY "sops_owner_update" ON public.sops FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());
CREATE POLICY "sops_owner_delete" ON public.sops FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner());

CREATE TRIGGER sops_updated_at BEFORE UPDATE ON public.sops
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============ sop_steps ============
CREATE TABLE public.sop_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sop_id UUID NOT NULL REFERENCES public.sops(id) ON DELETE CASCADE,
  step_number INT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  reference_photo_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sop_steps_sop_idx ON public.sop_steps(sop_id, step_number);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sop_steps TO authenticated;
GRANT ALL ON public.sop_steps TO service_role;

ALTER TABLE public.sop_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sop_steps_select_tenant" ON public.sop_steps FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "sop_steps_owner_insert" ON public.sop_steps FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());
CREATE POLICY "sop_steps_owner_update" ON public.sop_steps FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());
CREATE POLICY "sop_steps_owner_delete" ON public.sop_steps FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner());

-- ============ sop_attachments ============
CREATE TABLE public.sop_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sop_id UUID NOT NULL REFERENCES public.sops(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  caption TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by UUID REFERENCES auth.users(id)
);
CREATE INDEX sop_attachments_sop_idx ON public.sop_attachments(sop_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sop_attachments TO authenticated;
GRANT ALL ON public.sop_attachments TO service_role;

ALTER TABLE public.sop_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sop_attachments_select_tenant" ON public.sop_attachments FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "sop_attachments_owner_insert" ON public.sop_attachments FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());
CREATE POLICY "sop_attachments_owner_update" ON public.sop_attachments FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());
CREATE POLICY "sop_attachments_owner_delete" ON public.sop_attachments FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner());

-- ============ sop_reviews ============
CREATE TABLE public.sop_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sop_id UUID NOT NULL REFERENCES public.sops(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID REFERENCES public.jobs(id) ON DELETE CASCADE,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sop_reviews_job_idx ON public.sop_reviews(job_id, employee_id);
CREATE INDEX sop_reviews_sop_idx ON public.sop_reviews(sop_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sop_reviews TO authenticated;
GRANT ALL ON public.sop_reviews TO service_role;

ALTER TABLE public.sop_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sop_reviews_select_tenant" ON public.sop_reviews FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
    AND (public.is_owner() OR employee_id = auth.uid()));
CREATE POLICY "sop_reviews_self_insert" ON public.sop_reviews FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND employee_id = auth.uid());
