
DO $$ BEGIN
  CREATE TYPE public.photo_type AS ENUM ('before', 'after', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.job_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  storage_path TEXT NOT NULL,
  caption TEXT,
  photo_type public.photo_type NOT NULL DEFAULT 'other',
  taken_at TIMESTAMPTZ,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.job_photos(job_id);
CREATE INDEX ON public.job_photos(tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_photos TO authenticated;
GRANT ALL ON public.job_photos TO service_role;

ALTER TABLE public.job_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage all job photos in tenant"
  ON public.job_photos FOR ALL TO authenticated
  USING (public.is_owner() AND tenant_id = public.current_tenant_id())
  WITH CHECK (public.is_owner() AND tenant_id = public.current_tenant_id());

CREATE POLICY "Employees view photos for their jobs"
  ON public.job_photos FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.job_employees je
      WHERE je.job_id = job_photos.job_id AND je.employee_id = auth.uid()
    )
  );

CREATE POLICY "Employees insert photos for their jobs"
  ON public.job_photos FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND uploaded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.job_employees je
      WHERE je.job_id = job_photos.job_id AND je.employee_id = auth.uid()
    )
  );

CREATE POLICY "Uploader can delete own photo"
  ON public.job_photos FOR DELETE TO authenticated
  USING (uploaded_by = auth.uid() AND tenant_id = public.current_tenant_id());

CREATE TRIGGER trg_job_photos_updated_at
  BEFORE UPDATE ON public.job_photos
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.photo_share_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  photo_id UUID NOT NULL REFERENCES public.job_photos(id) ON DELETE CASCADE,
  shared_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  shared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.photo_share_log(job_id);
CREATE INDEX ON public.photo_share_log(photo_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.photo_share_log TO authenticated;
GRANT ALL ON public.photo_share_log TO service_role;

ALTER TABLE public.photo_share_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage all share logs in tenant"
  ON public.photo_share_log FOR ALL TO authenticated
  USING (public.is_owner() AND tenant_id = public.current_tenant_id())
  WITH CHECK (public.is_owner() AND tenant_id = public.current_tenant_id());

CREATE POLICY "Employees log shares for their jobs"
  ON public.photo_share_log FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND shared_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.job_employees je
      WHERE je.job_id = photo_share_log.job_id AND je.employee_id = auth.uid()
    )
  );

CREATE POLICY "Employees view share logs for their jobs"
  ON public.photo_share_log FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.job_employees je
      WHERE je.job_id = photo_share_log.job_id AND je.employee_id = auth.uid()
    )
  );
