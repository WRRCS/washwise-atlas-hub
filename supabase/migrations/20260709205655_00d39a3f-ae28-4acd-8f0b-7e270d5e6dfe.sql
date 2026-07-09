
-- 1) Restrict integrations SELECT policy to authenticated role
DROP POLICY IF EXISTS "owners read integrations" ON public.integrations;
CREATE POLICY "owners read integrations" ON public.integrations
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner());

-- 2) Tighten job-photos DELETE storage policy to include tenant folder check
DROP POLICY IF EXISTS "Owner delete own job photos" ON storage.objects;
CREATE POLICY "Owner delete own job photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'job-photos'
    AND owner = auth.uid()
    AND (storage.foldername(name))[1] = (public.current_tenant_id())::text
  );

-- 3) Revoke EXECUTE on SECURITY DEFINER functions that should not be
-- callable directly by signed-in users. These are all invoked from
-- triggers or from other SECURITY DEFINER functions, so removing
-- EXECUTE from PUBLIC/anon/authenticated does not affect app behavior.
DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'public.tg_set_updated_at()',
    'public.tg_activity_invoice_paid()',
    'public.tg_activity_client_created()',
    'public.tg_activity_invoice_created()',
    'public.tg_activity_job_created()',
    'public.tg_activity_job_completed()',
    'public.tg_notify_job_completed()',
    'public.tg_notify_invoice_sent()',
    'public.tg_enqueue_appointment_reminder()',
    'public.tg_payment_mark_invoice_paid()',
    'public.tg_auto_invoice_on_complete()',
    'public.tg_auto_inventory_on_complete()',
    'public.tg_inventory_tx_validate()',
    'public.tg_inventory_apply_tx()',
    'public.tg_enforce_job_limit()',
    'public.set_voice_updated_at()',
    'public.handle_new_user()',
    'public.enqueue_notification(uuid, notification_recipient_type, uuid, notification_channel, text, jsonb, timestamptz)',
    'public.log_platform_action(text, uuid, text, uuid, jsonb)',
    'public._client_name(uuid)',
    'public.next_invoice_number(uuid)'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
  END LOOP;
END $$;
