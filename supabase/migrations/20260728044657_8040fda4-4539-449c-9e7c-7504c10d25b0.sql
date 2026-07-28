
-- push_subscriptions table
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_sub_owner_ck CHECK ((user_id IS NOT NULL) OR (client_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS push_subs_user_idx ON public.push_subscriptions(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS push_subs_client_idx ON public.push_subscriptions(client_id) WHERE client_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "push_subs_user_own"
  ON public.push_subscriptions
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND tenant_id = public.current_tenant_id());

-- Seed push templates for every existing tenant
INSERT INTO public.notification_templates (tenant_id, name, channel, subject, body, is_active)
SELECT t.id, tpl.name, 'push'::notification_channel, tpl.subject, tpl.body, true
FROM public.tenants t
CROSS JOIN (VALUES
  ('push_job_assigned', 'New job assigned', 'You were assigned to {{service_name}} at {{client_name}} on {{scheduled_start}}.'),
  ('push_job_reminder', 'Job starting soon', '{{service_name}} at {{client_name}} starts at {{scheduled_start}}.'),
  ('push_job_status',   'Job update',        '{{service_name}} for {{client_name}} is now {{status}}.'),
  ('push_client_scheduled', 'Cleaning scheduled', 'Your {{service_name}} is scheduled for {{scheduled_start}}.'),
  ('push_client_on_the_way', 'On the way', 'Your cleaner is on the way for {{service_name}}.'),
  ('push_client_completed', 'Cleaning complete', 'Your {{service_name}} on {{completed_at}} is complete. Thanks!'),
  ('push_client_invoice',   'New invoice',    'Invoice {{invoice_number}} for {{total}} is ready to view.')
) AS tpl(name, subject, body)
ON CONFLICT DO NOTHING;

-- Trigger to seed templates for new tenants
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
    (NEW.id, 'push_client_invoice',   'push', 'New invoice',    'Invoice {{invoice_number}} for {{total}} is ready to view.', true)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_seed_push_templates() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_seed_push_templates ON public.tenants;
CREATE TRIGGER trg_seed_push_templates
AFTER INSERT ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.tg_seed_push_templates();

-- Job assigned trigger
CREATE OR REPLACE FUNCTION public.tg_enqueue_push_job_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  j record;
  svc text;
  cli text;
BEGIN
  SELECT jobs.*, st.name AS svc_name INTO j
  FROM jobs LEFT JOIN service_types st ON st.id = jobs.service_type_id
  WHERE jobs.id = NEW.job_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
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
$$;

REVOKE EXECUTE ON FUNCTION public.tg_enqueue_push_job_assigned() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_push_job_assigned ON public.job_employees;
CREATE TRIGGER trg_push_job_assigned
AFTER INSERT ON public.job_employees
FOR EACH ROW EXECUTE FUNCTION public.tg_enqueue_push_job_assigned();

-- Job status change trigger
CREATE OR REPLACE FUNCTION public.tg_enqueue_push_job_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  IF NEW.status = 'in_progress' THEN
    PERFORM public.enqueue_notification(
      NEW.tenant_id, 'client', NEW.client_id, 'push', 'push_client_on_the_way',
      jsonb_build_object('service_name', svc),
      now()
    );
  ELSIF NEW.status = 'completed' THEN
    PERFORM public.enqueue_notification(
      NEW.tenant_id, 'client', NEW.client_id, 'push', 'push_client_completed',
      jsonb_build_object('service_name', svc, 'completed_at', to_char(COALESCE(NEW.actual_end, now()) AT TIME ZONE 'UTC', 'Mon DD "at" HH12:MI AM')),
      now()
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_enqueue_push_job_status() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_push_job_status ON public.jobs;
CREATE TRIGGER trg_push_job_status
AFTER UPDATE OF status ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.tg_enqueue_push_job_status();

-- Job scheduled (insert) trigger
CREATE OR REPLACE FUNCTION public.tg_enqueue_push_job_scheduled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE svc text;
BEGIN
  SELECT name INTO svc FROM service_types WHERE id = NEW.service_type_id;
  PERFORM public.enqueue_notification(
    NEW.tenant_id, 'client', NEW.client_id, 'push', 'push_client_scheduled',
    jsonb_build_object(
      'service_name', COALESCE(svc, 'Cleaning'),
      'scheduled_start', to_char(NEW.scheduled_start AT TIME ZONE 'UTC', 'Dy, Mon DD "at" HH12:MI AM')
    ),
    now()
  );
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_enqueue_push_job_scheduled() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_push_job_scheduled ON public.jobs;
CREATE TRIGGER trg_push_job_scheduled
AFTER INSERT ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.tg_enqueue_push_job_scheduled();

-- Invoice created trigger
CREATE OR REPLACE FUNCTION public.tg_enqueue_push_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.client_id IS NULL THEN RETURN NEW; END IF;
  PERFORM public.enqueue_notification(
    NEW.tenant_id, 'client', NEW.client_id, 'push', 'push_client_invoice',
    jsonb_build_object(
      'invoice_number', NEW.number,
      'total', '$' || (NEW.total_cents::numeric / 100)::text
    ),
    now()
  );
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_enqueue_push_invoice() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_push_invoice_created ON public.invoices;
CREATE TRIGGER trg_push_invoice_created
AFTER INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.tg_enqueue_push_invoice();
