-- Clients get schedule notices only when an owner/manager presses "Send schedule to clients".
CREATE OR REPLACE FUNCTION public.tg_enqueue_push_job_scheduled()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  -- Intentionally no automatic client notice; see client_schedule_sends.
  RETURN NEW;
END;
$function$;
COMMENT ON FUNCTION public.tg_enqueue_push_job_scheduled() IS 'DEPRECATED: clients are only told about schedules through the manual Send schedule to clients action.';

CREATE OR REPLACE FUNCTION public.tg_enqueue_appointment_reminder()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _emp RECORD;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    DELETE FROM public.notifications
      WHERE tenant_id = NEW.tenant_id
        AND template_name IN ('appointment_reminder_client', 'appointment_reminder_employee')
        AND status = 'pending'
        AND (payload->>'job_id')::uuid = NEW.id;
  END IF;
  IF NEW.status IN ('canceled', 'completed') THEN RETURN NEW; END IF;
  -- No automatic client reminders: schedule changes never notify clients.
  FOR _emp IN SELECT je.employee_id, je.scheduled_start FROM public.job_employees je WHERE je.job_id = NEW.id LOOP
    PERFORM public._enqueue_employee_appointment_reminder(NEW.tenant_id, NEW.id, _emp.employee_id, COALESCE(_emp.scheduled_start, NEW.scheduled_start));
  END LOOP;
  RETURN NEW;
END $function$;

CREATE TABLE public.client_schedule_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  fingerprint text NOT NULL,
  body text NOT NULL,
  sent_to text,
  sent_by uuid NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX client_schedule_sends_lookup ON public.client_schedule_sends (tenant_id, period_start, client_id, sent_at DESC);
GRANT SELECT, INSERT ON public.client_schedule_sends TO authenticated;
GRANT ALL ON public.client_schedule_sends TO service_role;
ALTER TABLE public.client_schedule_sends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Managers read schedule sends" ON public.client_schedule_sends FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager());
CREATE POLICY "Managers record schedule sends" ON public.client_schedule_sends FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager() AND sent_by = auth.uid());