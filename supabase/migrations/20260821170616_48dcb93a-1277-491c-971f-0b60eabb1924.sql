-- Templates for new tenants
CREATE OR REPLACE FUNCTION public.tg_seed_push_templates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  INSERT INTO public.notification_templates (tenant_id, name, channel, subject, body, is_active)
  VALUES
    (NEW.id, 'push_job_assigned', 'push', 'New job assigned', 'You were assigned to {{service_name}} at {{client_name}} on {{scheduled_start}}.', true),
    (NEW.id, 'push_job_reminder', 'push', 'Job starting soon', '{{service_name}} at {{client_name}} starts at {{scheduled_start}}.', true),
    (NEW.id, 'push_job_status',   'push', 'Job update',        '{{service_name}} for {{client_name}} is now {{status}}.', true),
    (NEW.id, 'push_job_rescheduled', 'push', 'Schedule changed', '{{service_name}} at {{client_name}} moved to {{scheduled_start}}.', true),
    (NEW.id, 'push_schedule_published', 'push', 'Schedule published', 'Your shift {{service_name}} at {{client_name}} is set for {{scheduled_start}}.', true),
    (NEW.id, 'push_client_scheduled', 'push', 'Cleaning scheduled', 'Your {{service_name}} is scheduled for {{scheduled_start}}.', true),
    (NEW.id, 'push_client_on_the_way', 'push', 'On the way', 'Your cleaner is on the way for {{service_name}}.', true),
    (NEW.id, 'push_client_completed', 'push', 'Cleaning complete', 'Your {{service_name}} on {{completed_at}} is complete. Thanks!', true),
    (NEW.id, 'push_client_invoice',   'push', 'New invoice',    'Invoice {{invoice_number}} for {{total}} is ready to view.', true),
    (NEW.id, 'push_time_off_decision',  'push',  'Time off {{decision}}',
      'Your time off {{start_date}} – {{end_date}} was {{decision}}.', true),
    (NEW.id, 'email_time_off_decision', 'email', 'Time off request {{decision}}',
      '<p>Hi {{employee_name}},</p><p>Your time off request for <strong>{{start_date}} – {{end_date}}</strong> was <strong>{{decision}}</strong>.</p><p>Reason submitted: {{reason}}</p>', true),
    (NEW.id, 'push_shift_swap_decision',  'push',  'Shift swap {{decision}}',
      'Your shift swap for {{job_label}} was {{decision}}.', true),
    (NEW.id, 'email_shift_swap_decision', 'email', 'Shift swap request {{decision}}',
      '<p>Hi {{employee_name}},</p><p>Your shift swap request for <strong>{{job_label}}</strong> was <strong>{{decision}}</strong>.</p><p>Reason: {{reason}}</p>', true)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$fn$;

-- Backfill templates for existing tenants
INSERT INTO public.notification_templates (tenant_id, name, channel, subject, body, is_active)
SELECT t.id, 'push_job_rescheduled', 'push', 'Schedule changed',
       '{{service_name}} at {{client_name}} moved to {{scheduled_start}}.', true
FROM public.tenants t
ON CONFLICT DO NOTHING;

INSERT INTO public.notification_templates (tenant_id, name, channel, subject, body, is_active)
SELECT t.id, 'push_schedule_published', 'push', 'Schedule published',
       'Your shift {{service_name}} at {{client_name}} is set for {{scheduled_start}}.', true
FROM public.tenants t
ON CONFLICT DO NOTHING;

-- Notify assigned employees when a job is moved to a new time
CREATE OR REPLACE FUNCTION public.tg_enqueue_push_job_rescheduled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  svc text;
  cli text;
  emp record;
BEGIN
  IF NEW.scheduled_start IS NOT DISTINCT FROM OLD.scheduled_start THEN
    RETURN NEW;
  END IF;
  SELECT name INTO svc FROM public.service_types WHERE id = NEW.service_type_id;
  cli := public._client_name(NEW.client_id);
  FOR emp IN SELECT employee_id FROM public.job_employees WHERE job_id = NEW.id LOOP
    PERFORM public.enqueue_notification(
      NEW.tenant_id, 'employee', emp.employee_id, 'push', 'push_job_rescheduled',
      jsonb_build_object(
        'service_name', COALESCE(svc, 'Job'),
        'client_name', cli,
        'scheduled_start', to_char(NEW.scheduled_start AT TIME ZONE 'UTC', 'Dy, Mon DD "at" HH12:MI AM'),
        'job_id', NEW.id::text
      ),
      now()
    );
  END LOOP;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.tg_enqueue_push_job_rescheduled() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_push_job_rescheduled ON public.jobs;
CREATE TRIGGER trg_push_job_rescheduled
AFTER UPDATE OF scheduled_start ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.tg_enqueue_push_job_rescheduled();

-- Notify assigned employees when the schedule is published
CREATE OR REPLACE FUNCTION public.tg_enqueue_push_schedule_published()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  svc text;
  cli text;
  emp record;
BEGIN
  IF NEW.published_at IS NULL OR OLD.published_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT name INTO svc FROM public.service_types WHERE id = NEW.service_type_id;
  cli := public._client_name(NEW.client_id);
  FOR emp IN SELECT employee_id FROM public.job_employees WHERE job_id = NEW.id LOOP
    PERFORM public.enqueue_notification(
      NEW.tenant_id, 'employee', emp.employee_id, 'push', 'push_schedule_published',
      jsonb_build_object(
        'service_name', COALESCE(svc, 'Job'),
        'client_name', cli,
        'scheduled_start', to_char(NEW.scheduled_start AT TIME ZONE 'UTC', 'Dy, Mon DD "at" HH12:MI AM'),
        'job_id', NEW.id::text
      ),
      now()
    );
  END LOOP;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.tg_enqueue_push_schedule_published() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_push_schedule_published ON public.jobs;
CREATE TRIGGER trg_push_schedule_published
AFTER UPDATE OF published_at ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.tg_enqueue_push_schedule_published();