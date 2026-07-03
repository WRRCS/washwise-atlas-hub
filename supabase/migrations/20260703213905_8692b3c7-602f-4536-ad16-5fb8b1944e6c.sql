
-- 1. profiles: prevent tenant_id / id escalation
DROP POLICY IF EXISTS "User can update own profile" ON public.profiles;
CREATE POLICY "User can update own profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (
  id = auth.uid()
  AND tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
);

-- 2. jobs: tighten WITH CHECK for job_employees-assigned update
DROP POLICY IF EXISTS "Assigned via job_employees update jobs" ON public.jobs;
CREATE POLICY "Assigned via job_employees update jobs"
ON public.jobs
FOR UPDATE
TO authenticated
USING (
  tenant_id = current_tenant_id()
  AND EXISTS (SELECT 1 FROM public.job_employees je WHERE je.job_id = jobs.id AND je.employee_id = auth.uid())
)
WITH CHECK (
  tenant_id = current_tenant_id()
  AND EXISTS (SELECT 1 FROM public.job_employees je WHERE je.job_id = jobs.id AND je.employee_id = auth.uid())
);

-- 3. job_sop_items: mirror USING in WITH CHECK
DROP POLICY IF EXISTS "Assigned employee updates sop" ON public.job_sop_items;
CREATE POLICY "Assigned employee updates sop"
ON public.job_sop_items
FOR UPDATE
TO authenticated
USING (
  tenant_id = current_tenant_id()
  AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_sop_items.job_id AND j.assigned_to = auth.uid())
)
WITH CHECK (
  tenant_id = current_tenant_id()
  AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_sop_items.job_id AND j.assigned_to = auth.uid())
);

-- 4. Revoke EXECUTE on SECURITY DEFINER functions that should not be user-callable.
-- Keep executable for RLS helpers: is_owner, has_role, current_tenant_id, _client_name (used inside definer triggers only — revoke).
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
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
REVOKE EXECUTE ON FUNCTION public.tg_inventory_apply_tx() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_inventory_tx_validate() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_notification(uuid, notification_recipient_type, uuid, notification_channel, text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.next_invoice_number(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._client_name(uuid) FROM PUBLIC, anon, authenticated;
