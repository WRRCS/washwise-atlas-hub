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
  owner_id uuid;
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

  -- In-app push: owners AND managers
  FOR leader IN
    SELECT ur.user_id FROM public.user_roles ur
    WHERE ur.tenant_id = NEW.tenant_id AND ur.role IN ('owner','manager')
  LOOP
    PERFORM public.enqueue_notification(NEW.tenant_id, 'owner', leader.user_id, 'push', 'push_client_message', payload, now());
  END LOOP;

  -- Email alert: owners only (single send to the business inbox)
  SELECT ur.user_id INTO owner_id
  FROM public.user_roles ur
  WHERE ur.tenant_id = NEW.tenant_id AND ur.role = 'owner'
  LIMIT 1;

  IF owner_id IS NOT NULL THEN
    PERFORM public.enqueue_notification(NEW.tenant_id, 'owner', owner_id, 'email', 'email_client_message', payload, now());
  END IF;

  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.tg_notify_client_message() FROM PUBLIC, anon, authenticated;