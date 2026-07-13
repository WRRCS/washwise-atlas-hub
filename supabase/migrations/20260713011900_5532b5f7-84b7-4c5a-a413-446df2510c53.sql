-- Revoke EXECUTE on trigger functions from authenticated/anon/PUBLIC.
-- These fire automatically as triggers under the table owner; direct RPC access is unnecessary.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname LIKE 'tg\_%'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated;',
                   r.proname, r.args);
  END LOOP;
END $$;

-- Revoke EXECUTE on internal-only helpers that are called from other SECURITY DEFINER
-- functions or triggers, not directly by the client.
REVOKE EXECUTE ON FUNCTION public.enqueue_notification(uuid, notification_recipient_type, uuid, notification_channel, text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_platform_action(text, uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.next_invoice_number(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_tenant_usage(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._client_name(uuid) FROM PUBLIC, anon, authenticated;