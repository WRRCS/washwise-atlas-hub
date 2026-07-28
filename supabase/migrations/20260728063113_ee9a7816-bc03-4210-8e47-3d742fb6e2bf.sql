-- Seed decision templates for existing tenants (push + email)
INSERT INTO public.notification_templates (tenant_id, name, channel, subject, body, is_active)
SELECT t.id, tpl.name, tpl.channel::notification_channel, tpl.subject, tpl.body, true
FROM public.tenants t
CROSS JOIN (VALUES
  ('push_time_off_decision',  'push',  'Time off {{decision}}',
   'Your time off {{start_date}} – {{end_date}} was {{decision}}.'),
  ('email_time_off_decision', 'email', 'Time off request {{decision}}',
   '<p>Hi {{employee_name}},</p><p>Your time off request for <strong>{{start_date}} – {{end_date}}</strong> was <strong>{{decision}}</strong>.</p><p>Reason submitted: {{reason}}</p>'),
  ('push_shift_swap_decision',  'push',  'Shift swap {{decision}}',
   'Your shift swap for {{job_label}} was {{decision}}.'),
  ('email_shift_swap_decision', 'email', 'Shift swap request {{decision}}',
   '<p>Hi {{employee_name}},</p><p>Your shift swap request for <strong>{{job_label}}</strong> was <strong>{{decision}}</strong>.</p><p>Reason: {{reason}}</p>')
) AS tpl(name, channel, subject, body)
ON CONFLICT DO NOTHING;

-- Extend new-tenant seed function to include the new templates
CREATE OR REPLACE FUNCTION public.tg_seed_push_templates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notification_templates (tenant_id, name, channel, subject, body, is_active)
  VALUES
    (NEW.id, 'push_job_assigned', 'push', 'New job assigned', 'You were assigned to {{service_name}} at {{client_name}} on {{scheduled_start}}.', true),
    (NEW.id, 'push_job_reminder', 'push', 'Job starting soon', '{{service_name}} at {{client_name}} starts at {{scheduled_start}}.', true),
    (NEW.id, 'push_job_status',   'push', 'Job update',        '{{service_name}} for {{client_name}} is now {{status}}.', true),
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
$$;

REVOKE EXECUTE ON FUNCTION public.tg_seed_push_templates() FROM PUBLIC, anon, authenticated;

-- Time-off decision trigger: notify employee + all owners/managers
CREATE OR REPLACE FUNCTION public.tg_notify_time_off_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  emp_name text;
  payload jsonb;
  leader record;
BEGIN
  IF NEW.status = OLD.status OR NEW.status NOT IN ('approved','denied') THEN
    RETURN NEW;
  END IF;
  SELECT full_name INTO emp_name FROM profiles WHERE id = NEW.employee_id;
  payload := jsonb_build_object(
    'decision',      NEW.status,
    'start_date',    to_char(NEW.start_date, 'Mon DD, YYYY'),
    'end_date',      to_char(NEW.end_date,   'Mon DD, YYYY'),
    'reason',        COALESCE(NEW.reason, ''),
    'employee_name', COALESCE(emp_name, 'there'),
    'request_id',    NEW.id::text
  );
  -- Employee gets push + email
  PERFORM public.enqueue_notification(NEW.tenant_id, 'employee', NEW.employee_id, 'push',  'push_time_off_decision',  payload, now());
  PERFORM public.enqueue_notification(NEW.tenant_id, 'employee', NEW.employee_id, 'email', 'email_time_off_decision', payload, now());
  -- Owners and managers get push + email
  FOR leader IN
    SELECT ur.user_id FROM user_roles ur
    WHERE ur.tenant_id = NEW.tenant_id AND ur.role IN ('owner','manager')
  LOOP
    PERFORM public.enqueue_notification(NEW.tenant_id, 'owner', leader.user_id, 'push',  'push_time_off_decision',  payload, now());
    PERFORM public.enqueue_notification(NEW.tenant_id, 'owner', leader.user_id, 'email', 'email_time_off_decision', payload, now());
  END LOOP;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_notify_time_off_decision() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_time_off_decision ON public.time_off_requests;
CREATE TRIGGER trg_notify_time_off_decision
AFTER UPDATE OF status ON public.time_off_requests
FOR EACH ROW EXECUTE FUNCTION public.tg_notify_time_off_decision();

-- Shift-swap decision trigger: notify requesting employee + all owners/managers
CREATE OR REPLACE FUNCTION public.tg_notify_shift_swap_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  emp_name text;
  j record;
  svc text;
  cli text;
  job_label text;
  payload jsonb;
  leader record;
BEGIN
  IF NEW.status = OLD.status OR NEW.status NOT IN ('approved','denied') THEN
    RETURN NEW;
  END IF;
  SELECT full_name INTO emp_name FROM profiles WHERE id = NEW.requesting_employee_id;
  SELECT jobs.scheduled_start, jobs.client_id, st.name AS svc_name INTO j
  FROM jobs LEFT JOIN service_types st ON st.id = jobs.service_type_id
  WHERE jobs.id = NEW.job_id;
  svc := COALESCE(j.svc_name, 'Job');
  cli := public._client_name(j.client_id);
  job_label := svc || ' — ' || cli || ' on ' ||
    to_char(COALESCE(j.scheduled_start, now()) AT TIME ZONE 'UTC', 'Mon DD "at" HH12:MI AM');

  payload := jsonb_build_object(
    'decision',      NEW.status,
    'job_label',     job_label,
    'reason',        COALESCE(NEW.reason, ''),
    'employee_name', COALESCE(emp_name, 'there'),
    'job_id',        NEW.job_id::text,
    'request_id',    NEW.id::text
  );

  PERFORM public.enqueue_notification(NEW.tenant_id, 'employee', NEW.requesting_employee_id, 'push',  'push_shift_swap_decision',  payload, now());
  PERFORM public.enqueue_notification(NEW.tenant_id, 'employee', NEW.requesting_employee_id, 'email', 'email_shift_swap_decision', payload, now());
  FOR leader IN
    SELECT ur.user_id FROM user_roles ur
    WHERE ur.tenant_id = NEW.tenant_id AND ur.role IN ('owner','manager')
  LOOP
    PERFORM public.enqueue_notification(NEW.tenant_id, 'owner', leader.user_id, 'push',  'push_shift_swap_decision',  payload, now());
    PERFORM public.enqueue_notification(NEW.tenant_id, 'owner', leader.user_id, 'email', 'email_shift_swap_decision', payload, now());
  END LOOP;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_notify_shift_swap_decision() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_shift_swap_decision ON public.shift_swap_requests;
CREATE TRIGGER trg_notify_shift_swap_decision
AFTER UPDATE OF status ON public.shift_swap_requests
FOR EACH ROW EXECUTE FUNCTION public.tg_notify_shift_swap_decision();