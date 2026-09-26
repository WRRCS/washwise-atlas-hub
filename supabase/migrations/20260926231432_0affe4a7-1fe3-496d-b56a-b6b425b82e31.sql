CREATE TABLE public.employee_job_details (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  start_date date,
  job_title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_job_details TO authenticated;
GRANT ALL ON public.employee_job_details TO service_role;
ALTER TABLE public.employee_job_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage employee job details" ON public.employee_job_details
  FOR ALL TO authenticated
  USING (public.is_owner() AND tenant_id = public.current_tenant_id())
  WITH CHECK (public.is_owner() AND tenant_id = public.current_tenant_id());
CREATE TRIGGER set_employee_job_details_updated_at BEFORE UPDATE ON public.employee_job_details
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();