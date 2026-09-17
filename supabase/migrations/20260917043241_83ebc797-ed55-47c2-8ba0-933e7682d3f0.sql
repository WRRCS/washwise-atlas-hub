DROP POLICY IF EXISTS "owners update notifications" ON public.notifications;
CREATE POLICY "owners and managers update notifications" ON public.notifications
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager());