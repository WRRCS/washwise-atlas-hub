
CREATE OR REPLACE FUNCTION public.portal_save_push_subscription(
  _endpoint text, _p256dh text, _auth text, _user_agent text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  em text;
  cli record;
  sub_id uuid;
BEGIN
  em := (SELECT lower(email) FROM auth.users WHERE id = auth.uid());
  IF em IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT id, tenant_id INTO cli FROM public.clients
    WHERE lower(email) = em AND is_active = true
    ORDER BY created_at DESC LIMIT 1;
  IF cli.id IS NULL THEN RAISE EXCEPTION 'not a client'; END IF;

  INSERT INTO public.push_subscriptions (tenant_id, client_id, endpoint, p256dh, auth, user_agent)
  VALUES (cli.tenant_id, cli.id, _endpoint, _p256dh, _auth, _user_agent)
  ON CONFLICT (endpoint) DO UPDATE
    SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
        client_id = EXCLUDED.client_id, tenant_id = EXCLUDED.tenant_id,
        user_agent = EXCLUDED.user_agent, last_used_at = now()
  RETURNING id INTO sub_id;
  RETURN sub_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_delete_push_subscription(_endpoint text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE em text;
BEGIN
  em := (SELECT lower(email) FROM auth.users WHERE id = auth.uid());
  IF em IS NULL THEN RETURN; END IF;
  DELETE FROM public.push_subscriptions ps
   USING public.clients c
   WHERE ps.endpoint = _endpoint
     AND ps.client_id = c.id
     AND lower(c.email) = em;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.portal_save_push_subscription(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_save_push_subscription(text, text, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.portal_delete_push_subscription(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_delete_push_subscription(text) TO authenticated;
