DROP POLICY IF EXISTS "staff read integrations" ON public.integrations;
CREATE POLICY "owners read integrations" ON public.integrations
  FOR SELECT USING (tenant_id = public.current_tenant_id() AND public.is_owner());