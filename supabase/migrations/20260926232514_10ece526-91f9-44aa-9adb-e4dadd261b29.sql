CREATE TABLE public.job_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  arrived_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_visits_emp_idx ON public.job_visits(employee_id, arrived_at);
CREATE INDEX job_visits_job_idx ON public.job_visits(job_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_visits TO authenticated;
GRANT ALL ON public.job_visits TO service_role;
ALTER TABLE public.job_visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Employees read own visits, managers read all" ON public.job_visits
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND (employee_id = auth.uid() OR public.is_owner_or_manager()));
CREATE POLICY "Employees log own visits" ON public.job_visits
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND employee_id = auth.uid());
CREATE POLICY "Employees update own visits, managers any" ON public.job_visits
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND (employee_id = auth.uid() OR public.is_owner_or_manager()))
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "Managers delete visits" ON public.job_visits
  FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager());
CREATE TRIGGER set_job_visits_updated_at BEFORE UPDATE ON public.job_visits
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();