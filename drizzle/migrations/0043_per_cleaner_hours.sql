-- Each cleaner on a shared cleaning can have their own scheduled hours.
-- NULL means the cleaner follows the cleaning's own time.
ALTER TABLE public.job_employees
  ADD COLUMN IF NOT EXISTS scheduled_start timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_end timestamptz;
ALTER TABLE public.job_employees
  ADD CONSTRAINT job_employees_own_hours_check CHECK (
    (scheduled_start IS NULL AND scheduled_end IS NULL)
    OR (scheduled_start IS NOT NULL AND scheduled_end IS NOT NULL AND scheduled_end > scheduled_start)
  );
COMMENT ON COLUMN public.job_employees.scheduled_start IS 'This cleaner''s own scheduled start; NULL = follow jobs.scheduled_start';
COMMENT ON COLUMN public.job_employees.scheduled_end IS 'This cleaner''s own scheduled end; NULL = follow jobs.scheduled_end';

-- One employee appointment reminder for a cleaner at a given start.
CREATE OR REPLACE FUNCTION public._enqueue_employee_appointment_reminder(_tenant uuid, _job uuid, _employee uuid, _start timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _prefs public.reminder_preferences%ROWTYPE; _lead_min int; _channel text; _send_at timestamptz;
BEGIN
  SELECT * INTO _prefs FROM public.reminder_preferences WHERE tenant_id = _tenant AND user_id = _employee;
  IF FOUND AND _prefs.enabled THEN
    FOREACH _lead_min IN ARRAY _prefs.lead_minutes LOOP
      _send_at := _start - (_lead_min || ' minutes')::interval;
      IF _send_at > now() THEN
        FOREACH _channel IN ARRAY _prefs.channels LOOP
          PERFORM public.enqueue_notification(_tenant, 'employee', _employee, _channel::notification_channel,
            'appointment_reminder_employee',
            jsonb_build_object('job_id', _job, 'scheduled_start', _start, 'lead_minutes', _lead_min), _send_at);
        END LOOP;
      END IF;
    END LOOP;
  ELSIF NOT FOUND THEN
    _send_at := _start - INTERVAL '1 hour';
    IF _send_at > now() THEN
      PERFORM public.enqueue_notification(_tenant, 'employee', _employee, 'push',
        'appointment_reminder_employee', jsonb_build_object('job_id', _job, 'scheduled_start', _start), _send_at);
    END IF;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._enqueue_employee_appointment_reminder(uuid, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;

-- Appointment reminders: employees are reminded for their own start.
CREATE OR REPLACE FUNCTION public.tg_enqueue_appointment_reminder()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant_lead_hours INT; _lead_min INT; _channel TEXT; _send_at TIMESTAMPTZ;
  _prefs public.reminder_preferences%ROWTYPE; _emp RECORD;
BEGIN
  IF NEW.status IN ('canceled', 'completed') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    DELETE FROM public.notifications
      WHERE tenant_id = NEW.tenant_id
        AND template_name IN ('appointment_reminder_client', 'appointment_reminder_employee')
        AND status = 'pending'
        AND (payload->>'job_id')::uuid = NEW.id;
  END IF;
  SELECT reminder_lead_hours INTO _tenant_lead_hours FROM public.tenants WHERE id = NEW.tenant_id;
  SELECT * INTO _prefs FROM public.reminder_preferences WHERE tenant_id = NEW.tenant_id AND client_id = NEW.client_id;
  IF FOUND AND _prefs.enabled THEN
    FOREACH _lead_min IN ARRAY _prefs.lead_minutes LOOP
      _send_at := NEW.scheduled_start - (_lead_min || ' minutes')::interval;
      IF _send_at > now() THEN
        FOREACH _channel IN ARRAY _prefs.channels LOOP
          PERFORM public.enqueue_notification(NEW.tenant_id, 'client', NEW.client_id, _channel::notification_channel,
            'appointment_reminder_client',
            jsonb_build_object('job_id', NEW.id, 'scheduled_start', NEW.scheduled_start, 'lead_minutes', _lead_min), _send_at);
        END LOOP;
      END IF;
    END LOOP;
  ELSIF NOT FOUND THEN
    _send_at := NEW.scheduled_start - (COALESCE(_tenant_lead_hours, 24) || ' hours')::interval;
    IF _send_at > now() THEN
      PERFORM public.enqueue_notification(NEW.tenant_id, 'client', NEW.client_id, 'sms',
        'appointment_reminder_client', jsonb_build_object('job_id', NEW.id, 'scheduled_start', NEW.scheduled_start), _send_at);
    END IF;
  END IF;
  FOR _emp IN SELECT je.employee_id, je.scheduled_start FROM public.job_employees je WHERE je.job_id = NEW.id LOOP
    PERFORM public._enqueue_employee_appointment_reminder(NEW.tenant_id, NEW.id, _emp.employee_id, COALESCE(_emp.scheduled_start, NEW.scheduled_start));
  END LOOP;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.tg_enqueue_reminder_on_assign()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _job public.jobs%ROWTYPE;
BEGIN
  SELECT * INTO _job FROM public.jobs WHERE id = NEW.job_id;
  IF NOT FOUND OR _job.status IN ('canceled', 'completed') THEN RETURN NEW; END IF;
  PERFORM public._enqueue_employee_appointment_reminder(NEW.tenant_id, _job.id, NEW.employee_id, COALESCE(NEW.scheduled_start, _job.scheduled_start));
  RETURN NEW;
END $function$;

-- Whole-cleaning reschedule pushes only reach cleaners following the cleaning's time;
-- cleaners with their own hours are told by the job_employees trigger below.
CREATE OR REPLACE FUNCTION public.tg_enqueue_push_job_rescheduled()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE svc text; cli text; emp record;
BEGIN
  IF NEW.scheduled_start IS NOT DISTINCT FROM OLD.scheduled_start THEN RETURN NEW; END IF;
  IF current_setting('app.cleaner_hours_edit', true) = 'on' THEN RETURN NEW; END IF;
  SELECT name INTO svc FROM public.service_types WHERE id = NEW.service_type_id;
  cli := public._client_name(NEW.client_id);
  FOR emp IN SELECT employee_id FROM public.job_employees WHERE job_id = NEW.id AND scheduled_start IS NULL LOOP
    PERFORM public.enqueue_notification(NEW.tenant_id, 'employee', emp.employee_id, 'push', 'push_job_rescheduled',
      jsonb_build_object('service_name', COALESCE(svc, 'Job'), 'client_name', cli,
        'scheduled_start', to_char(NEW.scheduled_start AT TIME ZONE 'UTC', 'Dy, Mon DD "at" HH12:MI AM'),
        'job_id', NEW.id::text), now());
  END LOOP;
  RETURN NEW;
END $function$;

-- When a cleaner's own start changes, refresh only that cleaner's reminder and tell only them.
CREATE OR REPLACE FUNCTION public.tg_cleaner_hours_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _job public.jobs%ROWTYPE; old_eff timestamptz; new_eff timestamptz; svc text;
BEGIN
  SELECT * INTO _job FROM public.jobs WHERE id = NEW.job_id;
  IF NOT FOUND OR _job.status IN ('canceled', 'completed') THEN RETURN NEW; END IF;
  old_eff := COALESCE(OLD.scheduled_start, _job.scheduled_start);
  new_eff := COALESCE(NEW.scheduled_start, _job.scheduled_start);
  IF old_eff IS NOT DISTINCT FROM new_eff THEN RETURN NEW; END IF;
  DELETE FROM public.notifications
    WHERE tenant_id = NEW.tenant_id AND template_name = 'appointment_reminder_employee' AND status = 'pending'
      AND recipient_id = NEW.employee_id AND (payload->>'job_id')::uuid = NEW.job_id;
  PERFORM public._enqueue_employee_appointment_reminder(NEW.tenant_id, NEW.job_id, NEW.employee_id, new_eff);
  SELECT name INTO svc FROM public.service_types WHERE id = _job.service_type_id;
  PERFORM public.enqueue_notification(NEW.tenant_id, 'employee', NEW.employee_id, 'push', 'push_job_rescheduled',
    jsonb_build_object('service_name', COALESCE(svc, 'Job'), 'client_name', public._client_name(_job.client_id),
      'scheduled_start', to_char(new_eff AT TIME ZONE 'UTC', 'Dy, Mon DD "at" HH12:MI AM'),
      'job_id', NEW.job_id::text), now());
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_cleaner_hours_changed ON public.job_employees;
CREATE TRIGGER trg_cleaner_hours_changed AFTER UPDATE OF scheduled_start, scheduled_end ON public.job_employees
  FOR EACH ROW EXECUTE FUNCTION public.tg_cleaner_hours_changed();

-- Moving the whole cleaning carries each cleaner's own hours along, kept inside the cleaning.
CREATE OR REPLACE FUNCTION public.tg_job_shift_cleaner_hours()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE delta interval;
BEGIN
  IF current_setting('app.cleaner_hours_edit', true) = 'on' THEN RETURN NEW; END IF;
  IF NEW.scheduled_start IS NOT DISTINCT FROM OLD.scheduled_start AND NEW.scheduled_end IS NOT DISTINCT FROM OLD.scheduled_end THEN RETURN NEW; END IF;
  delta := NEW.scheduled_start - OLD.scheduled_start;
  UPDATE public.job_employees je SET
    scheduled_start = CASE WHEN least(je.scheduled_end + delta, NEW.scheduled_end) > greatest(je.scheduled_start + delta, NEW.scheduled_start)
                           THEN greatest(je.scheduled_start + delta, NEW.scheduled_start) END,
    scheduled_end   = CASE WHEN least(je.scheduled_end + delta, NEW.scheduled_end) > greatest(je.scheduled_start + delta, NEW.scheduled_start)
                           THEN least(je.scheduled_end + delta, NEW.scheduled_end) END
  WHERE je.job_id = NEW.id AND je.scheduled_start IS NOT NULL;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_job_shift_cleaner_hours ON public.jobs;
CREATE TRIGGER trg_job_shift_cleaner_hours AFTER UPDATE OF scheduled_start, scheduled_end ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_job_shift_cleaner_hours();

-- Owner/manager: change one cleaner's hours on a cleaning without touching anyone else.
-- The cleaning's overall time only grows to cover the cleaner, and the caller is told when it did.
CREATE OR REPLACE FUNCTION public.set_cleaner_hours(_job uuid, _employee uuid, _start timestamptz, _end timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j public.jobs%ROWTYPE; n int; new_start timestamptz; new_end timestamptz;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_owner_or_manager() THEN RAISE EXCEPTION 'Only owners and managers can change the schedule'; END IF;
  IF _start IS NULL OR _end IS NULL OR _end <= _start THEN RAISE EXCEPTION 'The end time must be after the start time'; END IF;
  IF _end - _start > interval '24 hours' THEN RAISE EXCEPTION 'A cleaner''s hours can''t be longer than 24 hours'; END IF;
  SELECT * INTO j FROM public.jobs WHERE id = _job FOR UPDATE;
  IF NOT FOUND OR j.tenant_id IS DISTINCT FROM public.current_tenant_id() THEN RAISE EXCEPTION 'Appointment not found'; END IF;
  IF j.status = 'canceled' THEN RAISE EXCEPTION 'This appointment was canceled'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.job_employees WHERE job_id = _job AND employee_id = _employee) THEN
    RAISE EXCEPTION 'That cleaner is not on this appointment';
  END IF;
  SELECT count(*) INTO n FROM public.job_employees WHERE job_id = _job;

  IF n = 1 THEN
    -- Only cleaner: their hours are the cleaning's hours.
    UPDATE public.job_employees SET scheduled_start = NULL, scheduled_end = NULL WHERE job_id = _job;
    UPDATE public.jobs SET scheduled_start = _start, scheduled_end = _end WHERE id = _job;
    RETURN jsonb_build_object('single', true, 'grew', false,
      'old_start', j.scheduled_start, 'old_end', j.scheduled_end, 'new_start', _start, 'new_end', _end);
  END IF;

  -- Pin everyone else's current hours so nothing about them changes.
  UPDATE public.job_employees SET scheduled_start = j.scheduled_start, scheduled_end = j.scheduled_end
    WHERE job_id = _job AND scheduled_start IS NULL AND employee_id <> _employee;
  UPDATE public.job_employees SET scheduled_start = _start, scheduled_end = _end
    WHERE job_id = _job AND employee_id = _employee;

  new_start := least(j.scheduled_start, _start);
  new_end := greatest(j.scheduled_end, _end);
  IF new_start <> j.scheduled_start OR new_end <> j.scheduled_end THEN
    PERFORM set_config('app.cleaner_hours_edit', 'on', true);
    UPDATE public.jobs SET scheduled_start = new_start, scheduled_end = new_end WHERE id = _job;
    PERFORM set_config('app.cleaner_hours_edit', '', true);
  END IF;
  RETURN jsonb_build_object('single', false, 'grew', new_start <> j.scheduled_start OR new_end <> j.scheduled_end,
    'old_start', j.scheduled_start, 'old_end', j.scheduled_end, 'new_start', new_start, 'new_end', new_end);
END $$;
REVOKE ALL ON FUNCTION public.set_cleaner_hours(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_cleaner_hours(uuid, uuid, timestamptz, timestamptz) TO authenticated;