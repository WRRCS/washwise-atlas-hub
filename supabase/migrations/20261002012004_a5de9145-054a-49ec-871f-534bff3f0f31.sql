-- Team message alerts
INSERT INTO public.notification_templates (tenant_id, name, channel, subject, body, is_active)
SELECT t.id, 'push_team_message', 'push', 'New message from {{sender_name}}', '{{preview}}', true
FROM public.tenants t
WHERE NOT EXISTS (SELECT 1 FROM public.notification_templates nt WHERE nt.tenant_id = t.id AND nt.name = 'push_team_message');

UPDATE public.notification_templates SET subject = 'New job photos', body = '{{uploader_name}} added {{photo_type}} photos for {{client_name}}.'
WHERE name = 'push_job_photo';

CREATE OR REPLACE FUNCTION public.tg_notify_team_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sender text;
  payload jsonb;
  r record;
BEGIN
  SELECT full_name INTO sender FROM public.profiles WHERE id = NEW.sender_id;
  payload := jsonb_build_object('sender_name', COALESCE(sender, 'A team member'), 'preview', left(NEW.body, 140));
  FOR r IN
    SELECT DISTINCT uid FROM (
      SELECT NEW.recipient_id AS uid WHERE NEW.recipient_id IS NOT NULL
      UNION
      SELECT ur.user_id FROM public.user_roles ur
      WHERE ur.tenant_id = NEW.tenant_id AND ur.role IN ('owner','manager')
    ) s WHERE uid IS NOT NULL AND uid IS DISTINCT FROM NEW.sender_id
  LOOP
    PERFORM public.enqueue_notification(NEW.tenant_id, 'owner', r.uid, 'push', 'push_team_message', payload, now());
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_team_message ON public.team_messages;
CREATE TRIGGER trg_notify_team_message AFTER INSERT ON public.team_messages
FOR EACH ROW EXECUTE FUNCTION public.tg_notify_team_message();

-- Photo alerts: one alert per job per few minutes, not one per photo
CREATE OR REPLACE FUNCTION public.tg_notify_job_photo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cli text;
  uploader text;
  payload jsonb;
  leader record;
BEGIN
  SELECT public._client_name(j.client_id) INTO cli FROM public.jobs j WHERE j.id = NEW.job_id;
  SELECT full_name INTO uploader FROM public.profiles WHERE id = NEW.uploaded_by;
  payload := jsonb_build_object(
    'job_id', NEW.job_id::text,
    'client_name', COALESCE(cli, 'a job'),
    'photo_type', NEW.photo_type,
    'uploader_name', COALESCE(uploader, 'A team member')
  );
  FOR leader IN
    SELECT ur.user_id FROM public.user_roles ur
    WHERE ur.tenant_id = NEW.tenant_id AND ur.role IN ('owner','manager')
      AND ur.user_id IS DISTINCT FROM NEW.uploaded_by
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.recipient_id = leader.user_id AND n.template_name = 'push_job_photo'
        AND n.payload->>'job_id' = NEW.job_id::text
        AND n.created_at > now() - interval '5 minutes'
    ) THEN
      PERFORM public.enqueue_notification(NEW.tenant_id, 'owner', leader.user_id, 'push', 'push_job_photo', payload, now());
    END IF;
  END LOOP;
  RETURN NEW;
END $$;