CREATE POLICY "staff read invoices" ON public.invoices
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id());

CREATE POLICY "owners delete invoices" ON public.invoices
  FOR DELETE TO authenticated
  USING (is_owner() AND tenant_id = current_tenant_id());

CREATE POLICY "Assigned employee inserts sop" ON public.job_sop_items
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = job_sop_items.job_id AND j.assigned_to = auth.uid()
    )
  );

CREATE POLICY "Assigned employee deletes sop" ON public.job_sop_items
  FOR DELETE TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = job_sop_items.job_id AND j.assigned_to = auth.uid()
    )
  );

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

REVOKE ALL ON FUNCTION public.current_tenant_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated;

REVOKE ALL ON FUNCTION public.is_owner() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._client_name(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.next_invoice_number(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_notification(uuid, public.notification_recipient_type, uuid, public.notification_channel, text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_activity_client_created() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_activity_invoice_created() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_activity_invoice_paid() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_activity_job_created() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_activity_job_completed() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_notify_job_completed() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_notify_invoice_sent() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_enqueue_appointment_reminder() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_payment_mark_invoice_paid() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_auto_invoice_on_complete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_inventory_apply_tx() FROM PUBLIC, anon, authenticated;