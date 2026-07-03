
ALTER TABLE public.time_entries ADD COLUMN IF NOT EXISTS notes TEXT;

-- Employees can read jobs where they are in job_employees
CREATE POLICY "Assigned via job_employees read jobs" ON public.jobs
  FOR SELECT TO authenticated USING (
    tenant_id = public.current_tenant_id() AND
    EXISTS (SELECT 1 FROM public.job_employees je WHERE je.job_id = jobs.id AND je.employee_id = auth.uid())
  );

-- Employees can update status of jobs they're assigned to via job_employees
CREATE POLICY "Assigned via job_employees update jobs" ON public.jobs
  FOR UPDATE TO authenticated USING (
    tenant_id = public.current_tenant_id() AND
    EXISTS (SELECT 1 FROM public.job_employees je WHERE je.job_id = jobs.id AND je.employee_id = auth.uid())
  ) WITH CHECK (tenant_id = public.current_tenant_id());
