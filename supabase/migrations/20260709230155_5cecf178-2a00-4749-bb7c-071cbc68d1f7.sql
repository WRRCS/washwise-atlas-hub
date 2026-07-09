
-- Restrict invoice line item writes to owners
DROP POLICY IF EXISTS "tenant staff can insert line items" ON public.invoice_line_items;
DROP POLICY IF EXISTS "tenant staff can update line items" ON public.invoice_line_items;
DROP POLICY IF EXISTS "tenant staff can delete line items" ON public.invoice_line_items;

CREATE POLICY "Owners insert line items" ON public.invoice_line_items
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_tenant_id() AND is_owner());

CREATE POLICY "Owners update line items" ON public.invoice_line_items
  FOR UPDATE TO authenticated
  USING (tenant_id = current_tenant_id() AND is_owner())
  WITH CHECK (tenant_id = current_tenant_id() AND is_owner());

CREATE POLICY "Owners delete line items" ON public.invoice_line_items
  FOR DELETE TO authenticated
  USING (tenant_id = current_tenant_id() AND is_owner());

-- Restrict job_employees inserts to owners only (prevents self-assignment escalation)
DROP POLICY IF EXISTS "Staff insert job_employees" ON public.job_employees;

-- Lock down save_qbo_integration: only service_role (used by server callback) can execute
REVOKE EXECUTE ON FUNCTION public.save_qbo_integration(uuid, text, text, text, jsonb) FROM anon, authenticated, PUBLIC;
