
-- 1) Profiles: block self-service edits of wage / status / tenant fields
CREATE OR REPLACE FUNCTION public.tg_profiles_protect_privileged_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_owner() THEN
    NEW.id := OLD.id;
    NEW.tenant_id := OLD.tenant_id;
    NEW.hourly_rate_cents := OLD.hourly_rate_cents;
    NEW.is_active := OLD.is_active;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_privileged_fields ON public.profiles;
CREATE TRIGGER profiles_protect_privileged_fields
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.tg_profiles_protect_privileged_fields();

-- 2) Team messages: only the read marker is updatable by signed-in users
REVOKE UPDATE ON public.team_messages FROM authenticated;
GRANT UPDATE (read_at) ON public.team_messages TO authenticated;

-- 3) SMS: track sender and restrict staff inserts to their own outbound messages
ALTER TABLE public.sms_messages
  ADD COLUMN IF NOT EXISTS sent_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

DROP POLICY IF EXISTS sms_messages_insert_own_tenant ON public.sms_messages;
CREATE POLICY sms_messages_insert_own_tenant
ON public.sms_messages
FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND direction = 'outbound'
  AND sent_by = auth.uid()
);
