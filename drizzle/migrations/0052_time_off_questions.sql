ALTER TABLE public.time_off_requests
  ADD COLUMN IF NOT EXISTS owner_question text,
  ADD COLUMN IF NOT EXISTS questioned_at timestamptz,
  ADD COLUMN IF NOT EXISTS questioned_by uuid,
  ADD COLUMN IF NOT EXISTS employee_reply text,
  ADD COLUMN IF NOT EXISTS replied_at timestamptz,
  ADD COLUMN IF NOT EXISTS reason_en text,
  ADD COLUMN IF NOT EXISTS employee_reply_en text;

CREATE OR REPLACE FUNCTION public.reply_time_off_question(_id uuid, _reply text)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _at timestamptz := now();
  _n int;
BEGIN
  IF _reply IS NULL OR length(trim(_reply)) = 0 THEN RAISE EXCEPTION 'Reply required'; END IF;
  IF length(_reply) > 2000 THEN RAISE EXCEPTION 'Reply is too long'; END IF;
  UPDATE public.time_off_requests
     SET employee_reply = trim(_reply), replied_at = _at, employee_reply_en = NULL
   WHERE id = _id
     AND employee_id = auth.uid()
     AND tenant_id = public.current_tenant_id()
     AND owner_question IS NOT NULL
     AND status = 'pending';
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n = 0 THEN RAISE EXCEPTION 'This request has no open question'; END IF;
  RETURN _at;
END $$;

REVOKE EXECUTE ON FUNCTION public.reply_time_off_question(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reply_time_off_question(uuid, text) TO authenticated;