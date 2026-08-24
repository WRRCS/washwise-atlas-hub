
-- Seed templates for existing tenants
INSERT INTO public.notification_templates (tenant_id, name, channel, subject, body, is_active)
SELECT t.id, 'push_client_message', 'push', 'New message from {{client_name}}', '{{preview}}', true
FROM public.tenants t
ON CONFLICT DO NOTHING;

INSERT INTO public.notification_templates (tenant_id, name, channel, subject, body, is_active)
SELECT t.id, 'email_client_message', 'email', 'New client message from {{client_name}}',
  '<p>{{client_name}} sent a new message through the client portal:</p><blockquote>{{body}}</blockquote><p>Reply from the Client chat page in the app.</p>', true
FROM public.tenants t
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.tg_notify_client_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cli text;
  to_email text;
  payload jsonb;
  leader record;
  notified boolean := false;
BEGIN
  IF NEW.sender_type <> 'client' THEN
    RETURN NEW;
  END IF;

  cli := public._client_name(NEW.client_id);
  SELECT COALESCE(business_email, 'info@WashRinseRepeatCleaning.com')
    INTO to_email FROM public.tenants WHERE id = NEW.tenant_id;

  payload := jsonb_build_object(
    'client_id',   NEW.client_id::text,
    'client_name', COALESCE(cli, 'A client'),
    'body',        NEW.body,
    'preview',     left(NEW.body, 140),
    'to_email',    to_email
  );

  FOR leader IN
    SELECT ur.user_id FROM public.user_roles ur
    WHERE ur.tenant_id = NEW.tenant_id AND ur.role IN ('owner','manager')
  LOOP
    PERFORM public.enqueue_notification(NEW.tenant_id, 'owner', leader.user_id, 'push', 'push_client_message', payload, now());
    IF NOT notified THEN
      PERFORM public.enqueue_notification(NEW.tenant_id, 'owner', leader.user_id, 'email', 'email_client_message', payload, now());
      notified := true;
    END IF;
  END LOOP;

  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.tg_notify_client_message() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_client_message ON public.client_messages;
CREATE TRIGGER trg_notify_client_message
AFTER INSERT ON public.client_messages
FOR EACH ROW EXECUTE FUNCTION public.tg_notify_client_message();
