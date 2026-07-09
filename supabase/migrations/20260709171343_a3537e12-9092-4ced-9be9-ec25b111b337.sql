
-- Lock down EXECUTE on public schema functions; grant only what clients need.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- RLS helpers (invoked during policy evaluation by authenticated users)
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_tenant_onboarding_completed() TO authenticated;
GRANT EXECUTE ON FUNCTION public._client_name(uuid) TO authenticated;

-- Client-callable RPCs (each performs internal authorization / tenant scoping)
GRANT EXECUTE ON FUNCTION public.admin_list_tenants() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_tenant(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_platform_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_platform_action(text, uuid, text, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_billing_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_usage(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_revenue_by_month(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_employee_productivity(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_client_retention() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_inventory_usage_detail(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_gps(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_invoice_number(uuid) TO authenticated;

-- Service-role only (called from server-side admin/webhook code)
GRANT EXECUTE ON FUNCTION public.enqueue_notification(uuid, notification_recipient_type, uuid, notification_channel, text, jsonb, timestamptz) TO service_role;

-- All trigger functions (tg_*, handle_new_user, update_updated_at_column) require no grants;
-- they execute as part of trigger firing under the table owner's privileges.
