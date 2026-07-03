
-- Enums
CREATE TYPE public.notification_recipient_type AS ENUM ('client', 'employee', 'owner');
CREATE TYPE public.notification_channel AS ENUM ('sms', 'email');
CREATE TYPE public.notification_status AS ENUM ('pending', 'sent', 'failed');

-- Templates table
CREATE TABLE public.notification_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  channel public.notification_channel NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_templates TO authenticated;
GRANT ALL ON public.notification_templates TO service_role;
ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant staff read templates" ON public.notification_templates
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "owners manage templates" ON public.notification_templates
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());

CREATE TRIGGER trg_notification_templates_updated
  BEFORE UPDATE ON public.notification_templates
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Notifications queue
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  recipient_type public.notification_recipient_type NOT NULL,
  recipient_id UUID NOT NULL,
  channel public.notification_channel NOT NULL,
  template_name TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  status public.notification_status NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant staff read notifications" ON public.notifications
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "tenant staff insert notifications" ON public.notifications
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "owners update notifications" ON public.notifications
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());

CREATE INDEX idx_notifications_pending ON public.notifications (scheduled_for) WHERE status = 'pending';
CREATE INDEX idx_notifications_tenant ON public.notifications (tenant_id, created_at DESC);

CREATE TRIGGER trg_notifications_updated
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Tenant settings: reminder lead time
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS reminder_lead_hours INT NOT NULL DEFAULT 24;

-- Enqueue helper
CREATE OR REPLACE FUNCTION public.enqueue_notification(
  _tenant UUID,
  _recipient_type public.notification_recipient_type,
  _recipient_id UUID,
  _channel public.notification_channel,
  _template_name TEXT,
  _payload JSONB,
  _scheduled_for TIMESTAMPTZ DEFAULT now()
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _id UUID;
  _active BOOLEAN;
BEGIN
  SELECT is_active INTO _active FROM public.notification_templates
    WHERE tenant_id = _tenant AND name = _template_name;
  IF _active IS DISTINCT FROM TRUE THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.notifications (tenant_id, recipient_type, recipient_id, channel, template_name, payload, scheduled_for)
  VALUES (_tenant, _recipient_type, _recipient_id, _channel, _template_name, COALESCE(_payload, '{}'::jsonb), _scheduled_for)
  RETURNING id INTO _id;
  RETURN _id;
END $$;

-- Job scheduled -> queue client appointment reminder (and reschedule on updates)
CREATE OR REPLACE FUNCTION public.tg_enqueue_appointment_reminder()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _lead INT;
  _send_at TIMESTAMPTZ;
BEGIN
  IF NEW.status = 'canceled' OR NEW.status = 'completed' THEN
    RETURN NEW;
  END IF;
  SELECT reminder_lead_hours INTO _lead FROM public.tenants WHERE id = NEW.tenant_id;
  _send_at := NEW.scheduled_start - (COALESCE(_lead, 24) || ' hours')::interval;
  IF TG_OP = 'UPDATE' THEN
    -- drop future pending reminders for this job before re-enqueueing
    DELETE FROM public.notifications
      WHERE tenant_id = NEW.tenant_id
        AND template_name = 'appointment_reminder_client'
        AND status = 'pending'
        AND (payload->>'job_id')::uuid = NEW.id;
  END IF;
  IF _send_at > now() THEN
    PERFORM public.enqueue_notification(
      NEW.tenant_id, 'client', NEW.client_id, 'sms',
      'appointment_reminder_client',
      jsonb_build_object('job_id', NEW.id, 'scheduled_start', NEW.scheduled_start),
      _send_at
    );
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_job_reminder_ins
  AFTER INSERT ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_enqueue_appointment_reminder();
CREATE TRIGGER trg_job_reminder_upd
  AFTER UPDATE OF scheduled_start, status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_enqueue_appointment_reminder();

-- Job completed -> notify owners
CREATE OR REPLACE FUNCTION public.tg_notify_job_completed()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _owner RECORD;
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    FOR _owner IN
      SELECT user_id FROM public.user_roles WHERE tenant_id = NEW.tenant_id AND role = 'owner'
    LOOP
      PERFORM public.enqueue_notification(
        NEW.tenant_id, 'owner', _owner.user_id, 'email',
        'job_completed_owner',
        jsonb_build_object('job_id', NEW.id, 'client_id', NEW.client_id, 'completed_at', now())
      );
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_job_completed_notify
  AFTER UPDATE OF status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_job_completed();

-- Invoice sent -> notify client
CREATE OR REPLACE FUNCTION public.tg_notify_invoice_sent()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'sent' AND OLD.status IS DISTINCT FROM 'sent' THEN
    PERFORM public.enqueue_notification(
      NEW.tenant_id, 'client', NEW.client_id, 'email',
      'invoice_sent_client',
      jsonb_build_object('invoice_id', NEW.id, 'number', NEW.number, 'total_cents', NEW.total_cents, 'due_date', NEW.due_date)
    );
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_invoice_sent_notify
  AFTER UPDATE OF status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_invoice_sent();

-- Seed default templates for existing tenants
INSERT INTO public.notification_templates (tenant_id, name, channel, subject, body)
SELECT t.id, v.name, v.channel::public.notification_channel, v.subject, v.body
FROM public.tenants t
CROSS JOIN (VALUES
  ('appointment_reminder_client', 'sms', NULL,
   'Hi {{client_first_name}}, this is Wash Rinse Repeat Cleaning reminding you of your {{service_name}} appointment on {{scheduled_start}}. Reply STOP to opt out.'),
  ('invoice_sent_client', 'email', 'Invoice {{invoice_number}} from Wash Rinse Repeat Cleaning',
   'Hi {{client_first_name}},\n\nYour invoice {{invoice_number}} for {{total}} is ready. Due {{due_date}}.\n\nPay online: {{pay_link}}\n\nThanks,\nWash Rinse Repeat Cleaning'),
  ('invoice_overdue_client', 'email', 'Reminder: invoice {{invoice_number}} is past due',
   'Hi {{client_first_name}},\n\nJust a friendly reminder that invoice {{invoice_number}} for {{total}} was due on {{due_date}}.\n\nPay online: {{pay_link}}\n\nThanks,\nWash Rinse Repeat Cleaning'),
  ('job_completed_owner', 'email', 'Job completed: {{client_name}} — {{service_name}}',
   '{{employee_name}} marked the {{service_name}} for {{client_name}} complete at {{completed_at}}.\n\nView job: {{job_link}}'),
  ('job_late_clockin_owner', 'email', 'Late clock-in: {{employee_name}} — {{client_name}}',
   '{{employee_name}} has not clocked in for the {{service_name}} at {{client_name}} scheduled for {{scheduled_start}}.\n\nView job: {{job_link}}')
) AS v(name, channel, subject, body)
ON CONFLICT (tenant_id, name) DO NOTHING;
