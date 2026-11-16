CREATE OR REPLACE FUNCTION public.tg_enqueue_push_job_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emp record;
  svc text;
  cli text;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  SELECT name INTO svc FROM service_types WHERE id = NEW.service_type_id;
  svc := COALESCE(svc, 'Job');
  cli := public._client_name(NEW.client_id);

  FOR emp IN SELECT employee_id FROM job_employees WHERE job_id = NEW.id LOOP
    PERFORM public.enqueue_notification(
      NEW.tenant_id, 'employee', emp.employee_id, 'push', 'push_job_status',
      jsonb_build_object('service_name', svc, 'client_name', cli, 'status', NEW.status::text, 'job_id', NEW.id::text),
      now()
    );
  END LOOP;
  -- No automatic client notices ("on the way" / "cleaning complete"):
  -- clients only hear from the business when staff approve a send.
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_notify_invoice_sent()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- The approved invoice email is delivered directly by Review & send;
  -- never queue a second, unreviewed client email here.
  RETURN NEW;
END $function$;

-- Cancel any client notice still waiting in the queue so none can go out later.
UPDATE public.notifications
   SET status = 'failed', error = 'Canceled: client notices require owner approval'
 WHERE recipient_type = 'client' AND status = 'pending';