-- Revoke EXECUTE from public/authenticated/anon on internal-only SECURITY DEFINER helpers.
-- These are used internally by triggers or other definer functions and should not be callable via the API.
REVOKE ALL ON FUNCTION public._client_name(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.next_invoice_number(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.current_tenant_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.current_tenant_onboarding_completed() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_tenant_usage(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_platform_action(text, uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- Ensure service_role retains access for server-side usage
GRANT EXECUTE ON FUNCTION public._client_name(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.next_invoice_number(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO service_role;
GRANT EXECUTE ON FUNCTION public.current_tenant_onboarding_completed() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_tenant_usage(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO service_role;
GRANT EXECUTE ON FUNCTION public.log_platform_action(text, uuid, text, uuid, jsonb) TO service_role;