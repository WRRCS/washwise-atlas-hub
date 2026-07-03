
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS is_recurring boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recurrence_rule text,
  ADD COLUMN IF NOT EXISTS recurrence_end date,
  ADD COLUMN IF NOT EXISTS recurrence_group_id uuid;

CREATE TABLE IF NOT EXISTS public.job_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, employee_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_employees TO authenticated;
GRANT ALL ON public.job_employees TO service_role;

ALTER TABLE public.job_employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant read job_employees" ON public.job_employees
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "Owner manage job_employees" ON public.job_employees
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());

CREATE POLICY "Staff insert job_employees" ON public.job_employees
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE INDEX IF NOT EXISTS job_employees_job_idx ON public.job_employees(job_id);
CREATE INDEX IF NOT EXISTS job_employees_emp_idx ON public.job_employees(employee_id);
