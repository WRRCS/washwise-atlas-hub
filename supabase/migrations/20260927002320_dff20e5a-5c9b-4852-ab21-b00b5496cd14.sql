-- Template for the new alert (all existing tenants)
INSERT INTO public.notification_templates (tenant_id, name, channel, subject, body, is_active)
SELECT t.id, 'push_job_photo', 'push', 'New job photo',
       '{{uploader_name}} added a {{photo_type}} photo for {{client_name}}.', true
FROM public.tenants t
ON CONFLICT DO NOTHING;

-- Notify owners/managers when a job photo is added
CREATE OR REPLACE FUNCTION public.tg_notify_job_photo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cli text;
  uploader text;
  payload jsonb;
  leader record;
BEGIN
  SELECT public._client_name(j.client_id) INTO cli
    FROM public.jobs j WHERE j.id = NEW.job_id;
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
    PERFORM public.enqueue_notification(NEW.tenant_id, 'owner', leader.user_id, 'push', 'push_job_photo', payload, now());
  END LOOP;

  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.tg_notify_job_photo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_job_photo ON public.job_photos;
CREATE TRIGGER trg_notify_job_photo
AFTER INSERT ON public.job_photos
FOR EACH ROW EXECUTE FUNCTION public.tg_notify_job_photo();