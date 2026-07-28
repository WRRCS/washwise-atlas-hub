
-- 1) Add the new wages toggle to employee_permissions
ALTER TABLE public.employee_permissions
  ADD COLUMN IF NOT EXISTS can_view_wages boolean NOT NULL DEFAULT false;

-- 2) Helper: owner OR manager
CREATE OR REPLACE FUNCTION public.is_owner_or_manager()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('owner','manager')
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_owner_or_manager() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_owner_or_manager() TO authenticated;

-- Helper: does the current user have a specific employee_permissions flag?
CREATE OR REPLACE FUNCTION public.has_employee_permission(_flag text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _val boolean;
BEGIN
  IF public.is_owner() THEN RETURN true; END IF;
  EXECUTE format(
    'SELECT COALESCE((SELECT %I FROM public.employee_permissions WHERE employee_id = auth.uid() LIMIT 1), false)',
    _flag
  ) INTO _val;
  RETURN COALESCE(_val, false);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.has_employee_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_employee_permission(text) TO authenticated;

-- 3) Swap ownership-gated policies to allow managers as well

-- clients
DROP POLICY IF EXISTS "Owners manage clients" ON public.clients;
DROP POLICY IF EXISTS "Owners read all clients" ON public.clients;
CREATE POLICY "Staff manage clients" ON public.clients
  FOR ALL TO authenticated
  USING (public.is_owner_or_manager() AND tenant_id = public.current_tenant_id())
  WITH CHECK (public.is_owner_or_manager() AND tenant_id = public.current_tenant_id());
CREATE POLICY "Staff read all clients" ON public.clients
  FOR SELECT TO authenticated
  USING (public.is_owner_or_manager() AND tenant_id = public.current_tenant_id());

-- client_properties
DROP POLICY IF EXISTS "client_properties_owner_write" ON public.client_properties;
CREATE POLICY "client_properties_staff_write" ON public.client_properties
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager());

-- jobs
DROP POLICY IF EXISTS "Owners manage jobs" ON public.jobs;
DROP POLICY IF EXISTS "Owners read all jobs" ON public.jobs;
CREATE POLICY "Staff manage jobs" ON public.jobs
  FOR ALL TO authenticated
  USING (public.is_owner_or_manager() AND tenant_id = public.current_tenant_id())
  WITH CHECK (public.is_owner_or_manager() AND tenant_id = public.current_tenant_id());
CREATE POLICY "Staff read all jobs" ON public.jobs
  FOR SELECT TO authenticated
  USING (public.is_owner_or_manager() AND tenant_id = public.current_tenant_id());

-- job_employees
DROP POLICY IF EXISTS "Owner manage job_employees" ON public.job_employees;
CREATE POLICY "Staff manage job_employees" ON public.job_employees
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager());

-- job_sop_items
DROP POLICY IF EXISTS "Owners manage sop" ON public.job_sop_items;
CREATE POLICY "Staff manage sop" ON public.job_sop_items
  FOR ALL TO authenticated
  USING (public.is_owner_or_manager() AND tenant_id = public.current_tenant_id())
  WITH CHECK (public.is_owner_or_manager() AND tenant_id = public.current_tenant_id());

-- job_photos
DROP POLICY IF EXISTS "Owners manage all job photos in tenant" ON public.job_photos;
CREATE POLICY "Staff manage all job photos in tenant" ON public.job_photos
  FOR ALL TO authenticated
  USING (public.is_owner_or_manager() AND tenant_id = public.current_tenant_id())
  WITH CHECK (public.is_owner_or_manager() AND tenant_id = public.current_tenant_id());

-- invoices
DROP POLICY IF EXISTS "Owners manage invoices" ON public.invoices;
DROP POLICY IF EXISTS "Owners read invoices" ON public.invoices;
DROP POLICY IF EXISTS "owners delete invoices" ON public.invoices;
CREATE POLICY "Staff manage invoices" ON public.invoices
  FOR ALL TO authenticated
  USING (public.is_owner_or_manager() AND tenant_id = public.current_tenant_id())
  WITH CHECK (public.is_owner_or_manager() AND tenant_id = public.current_tenant_id());
CREATE POLICY "Staff read invoices" ON public.invoices
  FOR SELECT TO authenticated
  USING (public.is_owner_or_manager() AND tenant_id = public.current_tenant_id());

-- invoice_line_items
DROP POLICY IF EXISTS "Owners delete line items" ON public.invoice_line_items;
DROP POLICY IF EXISTS "Owners insert line items" ON public.invoice_line_items;
DROP POLICY IF EXISTS "Owners read line items" ON public.invoice_line_items;
DROP POLICY IF EXISTS "Owners update line items" ON public.invoice_line_items;
CREATE POLICY "Staff read line items" ON public.invoice_line_items
  FOR SELECT TO authenticated
  USING (public.is_owner_or_manager() AND tenant_id = public.current_tenant_id());
CREATE POLICY "Staff insert line items" ON public.invoice_line_items
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager());
CREATE POLICY "Staff update line items" ON public.invoice_line_items
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager());
CREATE POLICY "Staff delete line items" ON public.invoice_line_items
  FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager());

-- service_types
DROP POLICY IF EXISTS "Owners manage service types" ON public.service_types;
DROP POLICY IF EXISTS "Staff insert service_types" ON public.service_types;
DROP POLICY IF EXISTS "Staff update service_types" ON public.service_types;
DROP POLICY IF EXISTS "Staff delete service_types" ON public.service_types;
CREATE POLICY "Staff manage service types" ON public.service_types
  FOR ALL TO authenticated
  USING (public.is_owner_or_manager() AND tenant_id = public.current_tenant_id())
  WITH CHECK (public.is_owner_or_manager() AND tenant_id = public.current_tenant_id());

-- sops
DROP POLICY IF EXISTS "sops_owner_delete" ON public.sops;
DROP POLICY IF EXISTS "sops_owner_insert" ON public.sops;
DROP POLICY IF EXISTS "sops_owner_update" ON public.sops;
CREATE POLICY "sops_staff_write" ON public.sops
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager());

-- sop_steps
DROP POLICY IF EXISTS "sop_steps_owner_delete" ON public.sop_steps;
DROP POLICY IF EXISTS "sop_steps_owner_insert" ON public.sop_steps;
DROP POLICY IF EXISTS "sop_steps_owner_update" ON public.sop_steps;
CREATE POLICY "sop_steps_staff_write" ON public.sop_steps
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager());

-- leads
DROP POLICY IF EXISTS "Owners manage leads" ON public.leads;
CREATE POLICY "Staff manage leads" ON public.leads
  FOR ALL TO authenticated
  USING (public.is_owner_or_manager() AND tenant_id = public.current_tenant_id())
  WITH CHECK (public.is_owner_or_manager() AND tenant_id = public.current_tenant_id());

-- inventory_items
DROP POLICY IF EXISTS "owners manage inventory items" ON public.inventory_items;
CREATE POLICY "staff manage inventory items" ON public.inventory_items
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager());

-- inventory_transactions
DROP POLICY IF EXISTS "owners can delete inventory tx" ON public.inventory_transactions;
CREATE POLICY "staff can delete inventory tx" ON public.inventory_transactions
  FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager());

-- payments
DROP POLICY IF EXISTS "owners insert payments" ON public.payments;
DROP POLICY IF EXISTS "owners update payments" ON public.payments;
CREATE POLICY "staff insert payments" ON public.payments
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager());
CREATE POLICY "staff update payments" ON public.payments
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager());
