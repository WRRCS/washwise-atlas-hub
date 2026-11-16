-- Employees only see cleanings that are published (or already being worked / finished).
CREATE OR REPLACE FUNCTION public.job_visible_to_staff(_job uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_owner_or_manager() OR EXISTS (
    SELECT 1 FROM public.jobs j
    WHERE j.id = _job AND j.tenant_id = public.current_tenant_id()
      AND (j.published_at IS NOT NULL OR j.status IN ('in_progress', 'completed'))
  )
$$;
REVOKE EXECUTE ON FUNCTION public.job_visible_to_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_visible_to_staff(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Tenant staff read all jobs" ON public.jobs;
CREATE POLICY "Tenant staff read published jobs" ON public.jobs
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
    AND (public.is_owner_or_manager() OR published_at IS NOT NULL OR status IN ('in_progress', 'completed')));

DROP POLICY IF EXISTS "Assigned via job_employees read jobs" ON public.jobs;
CREATE POLICY "Assigned via job_employees read jobs" ON public.jobs
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
    AND (published_at IS NOT NULL OR status IN ('in_progress', 'completed'))
    AND EXISTS (SELECT 1 FROM public.job_employees je WHERE je.job_id = jobs.id AND je.employee_id = auth.uid()));

DROP POLICY IF EXISTS "Employees read their jobs" ON public.jobs;
CREATE POLICY "Employees read their jobs" ON public.jobs
  FOR SELECT TO authenticated
  USING (assigned_to = auth.uid() AND tenant_id = public.current_tenant_id()
    AND (published_at IS NOT NULL OR status IN ('in_progress', 'completed')));

DROP POLICY IF EXISTS "Tenant read job_employees" ON public.job_employees;
CREATE POLICY "Tenant read visible job_employees" ON public.job_employees
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.job_visible_to_staff(job_id));

-- A manager's change to a published, upcoming cleaning hides it again until it is republished.
CREATE OR REPLACE FUNCTION public.tg_job_unpublish_on_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.published_at IS NULL OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN RETURN NEW; END IF;
  IF OLD.status <> 'scheduled' OR NEW.status <> 'scheduled' OR OLD.scheduled_end <= now() THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL OR NOT public.is_owner_or_manager() THEN RETURN NEW; END IF;
  IF NEW.scheduled_start IS DISTINCT FROM OLD.scheduled_start
     OR NEW.scheduled_end IS DISTINCT FROM OLD.scheduled_end
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.property_id IS DISTINCT FROM OLD.property_id
     OR NEW.service_address IS DISTINCT FROM OLD.service_address
     OR NEW.service_type_id IS DISTINCT FROM OLD.service_type_id
     OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    NEW.published_at := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_0_unpublish_on_change ON public.jobs;
CREATE TRIGGER trg_0_unpublish_on_change BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_job_unpublish_on_change();

CREATE OR REPLACE FUNCTION public.tg_job_employees_unpublish()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE jid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN jid := OLD.job_id; ELSE jid := NEW.job_id; END IF;
  IF TG_OP = 'UPDATE' AND NEW.scheduled_start IS NOT DISTINCT FROM OLD.scheduled_start
     AND NEW.scheduled_end IS NOT DISTINCT FROM OLD.scheduled_end THEN RETURN NEW; END IF;
  IF auth.uid() IS NOT NULL AND public.is_owner_or_manager() THEN
    UPDATE public.jobs SET published_at = NULL
     WHERE id = jid AND published_at IS NOT NULL AND status = 'scheduled' AND scheduled_end > now();
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.tg_job_employees_unpublish() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_0_unpublish_on_assignment ON public.job_employees;
CREATE TRIGGER trg_0_unpublish_on_assignment AFTER INSERT OR DELETE OR UPDATE OF scheduled_start, scheduled_end ON public.job_employees
  FOR EACH ROW EXECUTE FUNCTION public.tg_job_employees_unpublish();

-- No team alerts or reminders for cleanings that aren't published.
CREATE OR REPLACE FUNCTION public.tg_enqueue_push_job_assigned()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  j record;
  svc text;
  cli text;
BEGIN
  SELECT jobs.*, st.name AS svc_name INTO j
  FROM jobs LEFT JOIN service_types st ON st.id = jobs.service_type_id
  WHERE jobs.id = NEW.job_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF j.published_at IS NULL THEN RETURN NEW; END IF;
  svc := COALESCE(j.svc_name, 'Job');
  cli := public._client_name(j.client_id);
  PERFORM public.enqueue_notification(
    NEW.tenant_id, 'employee', NEW.employee_id, 'push', 'push_job_assigned',
    jsonb_build_object(
      'service_name', svc,
      'client_name', cli,
      'scheduled_start', to_char(j.scheduled_start AT TIME ZONE 'UTC', 'Dy, Mon DD "at" HH12:MI AM'),
      'job_id', j.id::text
    ),
    now()
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_enqueue_push_job_rescheduled()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE svc text; cli text; emp record;
BEGIN
  IF NEW.scheduled_start IS NOT DISTINCT FROM OLD.scheduled_start THEN RETURN NEW; END IF;
  IF NEW.published_at IS NULL THEN RETURN NEW; END IF;
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

CREATE OR REPLACE FUNCTION public.tg_cleaner_hours_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF _job.published_at IS NULL THEN RETURN NEW; END IF;
  SELECT name INTO svc FROM public.service_types WHERE id = _job.service_type_id;
  PERFORM public.enqueue_notification(NEW.tenant_id, 'employee', NEW.employee_id, 'push', 'push_job_rescheduled',
    jsonb_build_object('service_name', COALESCE(svc, 'Job'), 'client_name', public._client_name(_job.client_id),
      'scheduled_start', to_char(new_eff AT TIME ZONE 'UTC', 'Dy, Mon DD "at" HH12:MI AM'),
      'job_id', NEW.job_id::text), now());
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public._enqueue_employee_appointment_reminder(_tenant uuid, _job uuid, _employee uuid, _start timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _prefs public.reminder_preferences%ROWTYPE; _lead_min int; _channel text; _send_at timestamptz;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = _job AND (published_at IS NOT NULL OR status = 'in_progress')) THEN RETURN; END IF;
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
END $function$;

-- Publishing (or un-publishing) refreshes that cleaning's team reminders.
DROP TRIGGER IF EXISTS trg_job_reminder_publish ON public.jobs;
CREATE TRIGGER trg_job_reminder_publish AFTER UPDATE OF published_at ON public.jobs
  FOR EACH ROW WHEN (OLD.published_at IS DISTINCT FROM NEW.published_at)
  EXECUTE FUNCTION public.tg_enqueue_appointment_reminder();

CREATE OR REPLACE FUNCTION public.claim_employee_reminder(_tenant uuid, _user uuid, _job uuid, _start timestamp with time zone, _key text, _stage text, _action text, _channel text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE result uuid;
BEGIN
 PERFORM 1 FROM public.profiles WHERE id=_user AND tenant_id=_tenant AND is_active FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.employee_reminder_pilots WHERE tenant_id=_tenant AND delivery_enabled AND _user=ANY(participant_ids) AND channel=_channel) THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.jobs j WHERE j.id=_job AND j.tenant_id=_tenant AND j.scheduled_start=_start AND j.status IN ('scheduled','in_progress') AND (j.published_at IS NOT NULL OR j.status='in_progress') AND j.scheduled_end>now() AND (j.assigned_to=_user OR EXISTS(SELECT 1 FROM public.job_employees e WHERE e.job_id=j.id AND e.employee_id=_user))) THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM public.work_clock_entries WHERE user_id=_user AND ended_at IS NULL AND kind='lunch') OR EXISTS(SELECT 1 FROM public.job_visits WHERE job_id=_job AND employee_id=_user) THEN RETURN NULL; END IF;
 IF _action='clock_in' AND (EXISTS(SELECT 1 FROM public.time_entries WHERE user_id=_user AND ended_at IS NULL) OR EXISTS(SELECT 1 FROM public.work_clock_entries WHERE user_id=_user AND ended_at IS NULL AND kind='work')) THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM public.employee_reminder_attempts WHERE user_id=_user AND attempted_at>now()-interval '10 minutes') OR (SELECT count(*) FROM public.employee_reminder_attempts WHERE user_id=_user AND job_id=_job AND scheduled_start=_start)>=3 THEN RETURN NULL; END IF;
 INSERT INTO public.employee_reminder_attempts(tenant_id,user_id,job_id,scheduled_start,reminder_key,stage,action,channel) VALUES(_tenant,_user,_job,_start,_key,_stage,_action,_channel) ON CONFLICT(reminder_key) DO NOTHING RETURNING id INTO result;
 RETURN result;
END $function$;

-- Reminders already waiting for unpublished cleanings are withdrawn.
UPDATE public.notifications n SET status = 'failed', error = 'withdrawn: appointment not published'
 WHERE n.status = 'pending' AND n.recipient_type = 'employee'
   AND n.template_name IN ('appointment_reminder_employee', 'push_job_assigned', 'push_job_rescheduled')
   AND (n.payload->>'job_id') ~ '^[0-9a-f-]{36}$'
   AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = (n.payload->>'job_id')::uuid AND j.published_at IS NULL AND j.status = 'scheduled');