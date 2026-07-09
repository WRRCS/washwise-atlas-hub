
-- Revoke default PUBLIC/authenticated EXECUTE on SECURITY DEFINER helpers and triggers.
-- Trigger functions do NOT need EXECUTE grants to fire; internal helpers should not
-- be callable via the Data API by signed-in users. Only whitelisted RPCs are re-granted.

-- Trigger functions (never called directly)
REVOKE EXECUTE ON FUNCTION public.tg_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_activity_invoice_paid() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_activity_client_created() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_activity_invoice_created() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_activity_job_created() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_activity_job_completed() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_notify_job_completed() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_notify_invoice_sent() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_enqueue_appointment_reminder() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_payment_mark_invoice_paid() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_auto_invoice_on_complete() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_auto_inventory_on_complete() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_inventory_apply_tx() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_inventory_tx_validate() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_enforce_job_limit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_voice_updated_at() FROM PUBLIC, anon, authenticated;

-- Internal helpers (used by RLS policies / other definer fns; do not need direct EXECUTE by clients)
REVOKE EXECUTE ON FUNCTION public._client_name(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_notification(uuid, notification_recipient_type, uuid, notification_channel, text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.next_invoice_number(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_platform_action(text, uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- Helpers used by RLS policies must remain callable via policy evaluation.
-- Policies invoke them under the querying role, so grant EXECUTE back to authenticated.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_tenant_onboarding_completed() TO authenticated;

-- Whitelisted RPCs intentionally callable by signed-in users
GRANT EXECUTE ON FUNCTION public.get_client_retention() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_revenue_by_month(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_employee_productivity(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_inventory_usage_detail(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_billing_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_usage(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_gps(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_platform_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_tenants() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_tenant(uuid) TO authenticated;
