ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS recalled_at timestamptz,
  ADD COLUMN IF NOT EXISTS recalled_by uuid;

CREATE INDEX IF NOT EXISTS notifications_recall_idx
  ON public.notifications (tenant_id, status, scheduled_for)
  WHERE recalled_at IS NULL;

CREATE OR REPLACE FUNCTION public.tg_hold_client_emails()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.channel = 'email'
     AND NEW.recipient_type = 'client'
     AND COALESCE(NEW.scheduled_for, now()) < now() + interval '10 minutes' THEN
    NEW.scheduled_for := now() + interval '10 minutes';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS hold_client_emails ON public.notifications;
CREATE TRIGGER hold_client_emails
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.tg_hold_client_emails();