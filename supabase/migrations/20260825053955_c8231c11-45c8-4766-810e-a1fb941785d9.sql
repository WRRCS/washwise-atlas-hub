-- client_notes: reads stay tenant-wide, writes require client-management rights
DROP POLICY IF EXISTS "tenant_write_notes" ON public.client_notes;
CREATE POLICY "client_mgmt_write_notes" ON public.client_notes
  FOR ALL TO authenticated
  USING (tenant_id = current_tenant_id() AND (is_owner_or_manager() OR has_client_mgmt_permission()))
  WITH CHECK (tenant_id = current_tenant_id() AND (is_owner_or_manager() OR has_client_mgmt_permission()));

-- client_photos: same treatment
DROP POLICY IF EXISTS "tenant_write_photos" ON public.client_photos;
CREATE POLICY "client_mgmt_write_photos" ON public.client_photos
  FOR ALL TO authenticated
  USING (tenant_id = current_tenant_id() AND (is_owner_or_manager() OR has_client_mgmt_permission()))
  WITH CHECK (tenant_id = current_tenant_id() AND (is_owner_or_manager() OR has_client_mgmt_permission()));

-- inventory_transactions: managers can adjust freely; employees only log usage on their own jobs
DROP POLICY IF EXISTS "tenant members insert inventory tx" ON public.inventory_transactions;
CREATE POLICY "scoped insert inventory tx" ON public.inventory_transactions
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND (
      is_owner_or_manager()
      OR (
        job_id IS NOT NULL
        AND created_by = auth.uid()
        AND EXISTS (
          SELECT 1 FROM public.job_employees je
          WHERE je.job_id = inventory_transactions.job_id
            AND je.employee_id = auth.uid()
        )
      )
    )
  );

-- notifications: only owners/managers may enqueue (triggers use SECURITY DEFINER helpers)
DROP POLICY IF EXISTS "tenant staff insert notifications" ON public.notifications;
CREATE POLICY "managers insert notifications" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_tenant_id() AND is_owner_or_manager());

-- profiles: hide wage and contact columns from direct table reads
REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (id, tenant_id, full_name, avatar_url, is_active, created_at, updated_at) ON public.profiles TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;