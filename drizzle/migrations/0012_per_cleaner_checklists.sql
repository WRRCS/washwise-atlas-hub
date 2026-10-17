ALTER TABLE public.job_sop_items ADD COLUMN employee_id UUID NULL;
COMMENT ON COLUMN public.job_sop_items.employee_id IS 'NULL = shared template/legacy row; set = that cleaner''s own checklist copy';
CREATE INDEX job_sop_items_employee_idx ON public.job_sop_items(job_id, employee_id);

-- Employees may only touch their OWN checklist copies (employee_id = auth.uid()),
-- and only on jobs they are assigned to (job_employees or jobs.assigned_to).
DROP POLICY IF EXISTS "Assigned employee updates sop" ON public.job_sop_items;
CREATE POLICY "Employee updates own sop items" ON public.job_sop_items
  FOR UPDATE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND employee_id = auth.uid()
    AND (
      EXISTS (SELECT 1 FROM public.job_employees je WHERE je.job_id = job_sop_items.job_id AND je.employee_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_sop_items.job_id AND j.assigned_to = auth.uid())
    )
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND employee_id = auth.uid()
    AND (
      EXISTS (SELECT 1 FROM public.job_employees je WHERE je.job_id = job_sop_items.job_id AND je.employee_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_sop_items.job_id AND j.assigned_to = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Assigned employee inserts sop" ON public.job_sop_items;
CREATE POLICY "Employee inserts own sop items" ON public.job_sop_items
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND employee_id = auth.uid()
    AND (
      EXISTS (SELECT 1 FROM public.job_employees je WHERE je.job_id = job_sop_items.job_id AND je.employee_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_sop_items.job_id AND j.assigned_to = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Assigned employee deletes sop" ON public.job_sop_items;
CREATE POLICY "Employee deletes own sop items" ON public.job_sop_items
  FOR DELETE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND employee_id = auth.uid()
    AND (
      EXISTS (SELECT 1 FROM public.job_employees je WHERE je.job_id = job_sop_items.job_id AND je.employee_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_sop_items.job_id AND j.assigned_to = auth.uid())
    )
  );