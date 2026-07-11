
-- Scope owner SELECT on user_roles to current tenant
DROP POLICY IF EXISTS "Users can see own roles" ON public.user_roles;
CREATE POLICY "Users can see own roles" ON public.user_roles
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR (is_owner() AND tenant_id = current_tenant_id())
  );

-- Revoke EXECUTE on trigger functions from anon/public (triggers still fire)
REVOKE EXECUTE ON FUNCTION public.tg_enforce_client_limit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_enforce_employee_limit() FROM PUBLIC, anon, authenticated;

-- Revoke EXECUTE from authenticated on internal helpers (used in RLS/definer chains, not RPC)
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_owner() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.current_tenant_id() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.current_tenant_onboarding_completed() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_tenant_usage(uuid) FROM PUBLIC, anon, authenticated;
