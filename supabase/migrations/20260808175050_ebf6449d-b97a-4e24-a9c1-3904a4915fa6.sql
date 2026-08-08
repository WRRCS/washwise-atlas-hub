-- 1. RLS policy helpers must be executable by the roles that policies run as.
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_client_mgmt_permission() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_owner_or_manager() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

-- 2. Internal-only SECURITY DEFINER helpers stay revoked from client roles.
REVOKE EXECUTE ON FUNCTION public.enqueue_notification(uuid, public.notification_recipient_type, uuid, public.notification_channel, text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_platform_action(text, uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.purge_expired_gps(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_tenant_usage(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.next_invoice_number(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._client_name(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_get_tenant(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_tenants() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_platform_stats() FROM PUBLIC, anon;

-- 3. Scheduled push job: authenticate with a private secret header.
SELECT cron.unschedule(1);
SELECT cron.schedule(
  'process-push-notifications',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--d344868a-ce88-407a-a141-0f3d42ef0e99.lovable.app/api/public/hooks/process-push',
    headers := '{"Content-Type":"application/json","x-cron-secret":"ec06d78d2f62f03cd14a07af616efaad9b0c31c295dd6bff60d3f570ca2f631a"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);