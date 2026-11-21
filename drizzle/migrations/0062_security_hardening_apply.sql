ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS pay_token text NOT NULL
  DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));
COMMENT ON COLUMN public.invoices.pay_token IS 'Secret that must accompany the public /pay link for this invoice.';

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles r
    WHERE r.user_id = _user_id AND r.role = _role
      AND (
        auth.uid() IS NULL
        OR _user_id = auth.uid()
        OR r.tenant_id IN (SELECT me.tenant_id FROM public.user_roles me WHERE me.user_id = auth.uid())
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.next_invoice_number(_tenant uuid, _issue_date date)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _year text := EXTRACT(YEAR FROM COALESCE(_issue_date, (now() AT TIME ZONE 'America/Los_Angeles')::date))::int::text;
  _max int;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND tenant_id = _tenant
  ) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('invoice-number:' || _tenant::text || ':' || _year));
  SELECT MAX(substring(number FROM length(_year) + 2)::int)
    INTO _max
    FROM public.invoices
   WHERE tenant_id = _tenant
     AND number ~ ('^' || _year || '-[0-9]{4,9}$');
  RETURN _year || '-' || (GREATEST(COALESCE(_max, 1000), 1000) + 1)::text;
END $$;

REVOKE EXECUTE ON FUNCTION public.recalc_job_hours(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalc_invoice_totals(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.portal_email_is_client(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.portal_verified_email()
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT lower(u.email) FROM auth.users u
  WHERE u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL;
$$;
REVOKE EXECUTE ON FUNCTION public.portal_verified_email() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.portal_send_message(_client_id uuid, _body text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _email text; _tenant uuid; _id uuid;
BEGIN
  IF _body IS NULL OR length(trim(_body)) = 0 THEN RAISE EXCEPTION 'Message body required'; END IF;
  _email := public.portal_verified_email();
  IF _email IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT tenant_id INTO _tenant FROM public.clients
    WHERE id = _client_id AND lower(email) = _email AND is_active = true;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Client not accessible'; END IF;
  INSERT INTO public.client_messages (tenant_id, client_id, sender_type, sender_user_id, body)
    VALUES (_tenant, _client_id, 'client', auth.uid(), _body)
    RETURNING id INTO _id;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.portal_request_service(_client_id uuid, _service_type_id uuid, _requested_date date, _notes text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _email text; _tenant uuid; _id uuid;
BEGIN
  _email := public.portal_verified_email();
  IF _email IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT tenant_id INTO _tenant FROM public.clients
    WHERE id = _client_id AND lower(email) = _email AND is_active = true;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Client not accessible'; END IF;
  INSERT INTO public.client_service_requests (tenant_id, client_id, service_type_id, requested_date, notes)
    VALUES (_tenant, _client_id, _service_type_id, _requested_date, _notes)
    RETURNING id INTO _id;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.portal_get_reminder_prefs(_client_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _email text; _client public.clients%ROWTYPE; _prefs public.reminder_preferences%ROWTYPE;
BEGIN
  _email := public.portal_verified_email();
  SELECT * INTO _client FROM public.clients WHERE id = _client_id;
  IF _email IS NULL OR NOT FOUND OR lower(_client.email) IS DISTINCT FROM _email THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  SELECT * INTO _prefs FROM public.reminder_preferences
    WHERE tenant_id = _client.tenant_id AND client_id = _client_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('enabled', true, 'lead_minutes', to_jsonb(ARRAY[1440, 60]::INT[]),
      'channels', to_jsonb(ARRAY['email']::TEXT[]), 'is_default', true);
  END IF;
  RETURN jsonb_build_object('enabled', _prefs.enabled, 'lead_minutes', to_jsonb(_prefs.lead_minutes),
    'channels', to_jsonb(_prefs.channels), 'is_default', false);
END $$;

CREATE OR REPLACE FUNCTION public.portal_upsert_reminder_prefs(_client_id uuid, _lead_minutes integer[], _channels text[], _enabled boolean)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _email text; _client public.clients%ROWTYPE;
BEGIN
  _email := public.portal_verified_email();
  SELECT * INTO _client FROM public.clients WHERE id = _client_id;
  IF _email IS NULL OR NOT FOUND OR lower(_client.email) IS DISTINCT FROM _email OR NOT _client.is_active THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF NOT (_channels <@ ARRAY['sms','email','push']::TEXT[]) OR array_length(_channels, 1) IS NULL THEN
    RAISE EXCEPTION 'invalid_channels';
  END IF;
  IF array_length(_lead_minutes, 1) IS NULL OR array_length(_lead_minutes, 1) > 6 THEN
    RAISE EXCEPTION 'invalid_lead_minutes';
  END IF;
  INSERT INTO public.reminder_preferences (tenant_id, client_id, lead_minutes, channels, enabled)
    VALUES (_client.tenant_id, _client_id, _lead_minutes, _channels, _enabled)
    ON CONFLICT (tenant_id, client_id) DO UPDATE
      SET lead_minutes = EXCLUDED.lead_minutes, channels = EXCLUDED.channels,
          enabled = EXCLUDED.enabled, updated_at = now();
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.portal_save_push_subscription(_endpoint text, _p256dh text, _auth text, _user_agent text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE em text; cli record; sub_id uuid;
BEGIN
  em := public.portal_verified_email();
  IF em IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT id, tenant_id INTO cli FROM public.clients
    WHERE lower(email) = em AND is_active = true ORDER BY created_at DESC LIMIT 1;
  IF cli.id IS NULL THEN RAISE EXCEPTION 'not a client'; END IF;
  INSERT INTO public.push_subscriptions (tenant_id, client_id, endpoint, p256dh, auth, user_agent)
  VALUES (cli.tenant_id, cli.id, _endpoint, _p256dh, _auth, _user_agent)
  ON CONFLICT (endpoint) DO UPDATE
    SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
        client_id = EXCLUDED.client_id, tenant_id = EXCLUDED.tenant_id,
        user_agent = EXCLUDED.user_agent, last_used_at = now()
  RETURNING id INTO sub_id;
  RETURN sub_id;
END $$;

CREATE OR REPLACE FUNCTION public.portal_delete_push_subscription(_endpoint text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE em text;
BEGIN
  em := public.portal_verified_email();
  IF em IS NULL THEN RETURN; END IF;
  DELETE FROM public.push_subscriptions ps USING public.clients c
   WHERE ps.endpoint = _endpoint AND ps.client_id = c.id AND lower(c.email) = em;
END $$;

CREATE OR REPLACE FUNCTION public.portal_get_data()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _email text; _client_ids uuid[];
BEGIN
  _email := public.portal_verified_email();
  IF _email IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT COALESCE(array_agg(id), '{}') INTO _client_ids
  FROM public.clients WHERE lower(email) = _email AND is_active = true;
  IF array_length(_client_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('clients', '[]'::jsonb, 'jobs', '[]'::jsonb, 'invoices', '[]'::jsonb,
      'messages', '[]'::jsonb, 'requests', '[]'::jsonb, 'tenants', '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object(
    'clients', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'tenant_id', c.tenant_id, 'first_name', c.first_name, 'last_name', c.last_name,
        'email', c.email, 'phone', c.phone, 'service_address', c.service_address
      )) FROM public.clients c WHERE c.id = ANY(_client_ids)), '[]'::jsonb),
    'tenants', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'business_email', t.business_email,
        'business_phone', t.business_phone, 'logo_url', t.logo_url, 'primary_color', t.primary_color
      )) FROM public.tenants t WHERE t.id IN (SELECT tenant_id FROM public.clients WHERE id = ANY(_client_ids))), '[]'::jsonb),
    'jobs', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', j.id, 'client_id', j.client_id, 'status', j.status,
        'scheduled_start', j.scheduled_start, 'scheduled_end', j.scheduled_end, 'actual_end', j.actual_end,
        'service_name', st.name, 'price_cents', j.price_cents
      ) ORDER BY j.scheduled_start DESC)
      FROM public.jobs j LEFT JOIN public.service_types st ON st.id = j.service_type_id
      WHERE j.client_id = ANY(_client_ids)), '[]'::jsonb),
    'invoices', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', i.id, 'number', i.number, 'status', i.status, 'total_cents', i.total_cents,
        'issue_date', i.issue_date, 'due_date', i.due_date, 'paid_at', i.paid_at,
        'pay_link', i.pay_link, 'pay_token', i.pay_token, 'client_id', i.client_id
      ) ORDER BY i.issue_date DESC)
      FROM public.invoices i WHERE i.client_id = ANY(_client_ids) AND i.status <> 'draft'), '[]'::jsonb),
    'messages', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', m.id, 'client_id', m.client_id, 'sender_type', m.sender_type,
        'body', m.body, 'created_at', m.created_at, 'read_at', m.read_at
      ) ORDER BY m.created_at ASC)
      FROM public.client_messages m WHERE m.client_id = ANY(_client_ids) AND m.retracted_at IS NULL), '[]'::jsonb),
    'requests', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'client_id', r.client_id, 'status', r.status, 'requested_date', r.requested_date,
        'notes', r.notes, 'service_type_id', r.service_type_id, 'created_at', r.created_at
      ) ORDER BY r.created_at DESC)
      FROM public.client_service_requests r WHERE r.client_id = ANY(_client_ids)), '[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _default_tenant UUID := '00000000-0000-0000-0000-000000000001';
  _tenant UUID;
  _business_name TEXT := NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'signup_business_name','')), '');
  _plan_tier TEXT := COALESCE(NULLIF(NEW.raw_user_meta_data->>'signup_plan_tier',''), 'starter');
  _slug TEXT;
  _is_first BOOLEAN;
  _is_portal_client BOOLEAN := COALESCE((NEW.raw_user_meta_data->>'portal_client')::boolean, false);
  _allowed_tenant UUID;
  _allowed BOOLEAN;
BEGIN
  IF _is_portal_client THEN RETURN NEW; END IF;

  IF _business_name IS NOT NULL THEN
    _slug := lower(regexp_replace(_business_name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(md5(NEW.id::text),1,6);
    IF _plan_tier NOT IN ('starter','growth','scale') THEN _plan_tier := 'starter'; END IF;
    INSERT INTO public.tenants (name, slug, plan_tier, onboarding_completed, business_email)
      VALUES (_business_name, _slug, _plan_tier, false, NEW.email) RETURNING id INTO _tenant;
    INSERT INTO public.profiles (id, tenant_id, full_name, email)
      VALUES (NEW.id, _tenant, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)), NEW.email);
    INSERT INTO public.user_roles (user_id, tenant_id, role) VALUES (NEW.id, _tenant, 'owner'::app_role);
    RETURN NEW;
  END IF;

  SELECT true, a.tenant_id INTO _allowed, _allowed_tenant
  FROM public.allowed_signins a WHERE a.email = lower(NEW.email) LIMIT 1;
  IF NOT COALESCE(_allowed, false) OR NEW.email_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'This app is invitation only. Ask your manager for an invite link.' USING ERRCODE = '42501';
  END IF;

  _tenant := COALESCE(_allowed_tenant, _default_tenant);

  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.id) THEN
    UPDATE public.profiles SET email = COALESCE(email, NEW.email) WHERE id = NEW.id;
    RETURN NEW;
  END IF;

  INSERT INTO public.profiles (id, tenant_id, full_name, email)
    VALUES (NEW.id, _tenant, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)), NEW.email);
  SELECT NOT EXISTS(SELECT 1 FROM public.user_roles WHERE tenant_id = _tenant) INTO _is_first;
  INSERT INTO public.user_roles (user_id, tenant_id, role)
    VALUES (NEW.id, _tenant, CASE WHEN _is_first THEN 'owner'::app_role ELSE 'employee'::app_role END);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.guard_employee_job_billing()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  IF current_user = 'authenticated' AND NOT public.is_owner_or_manager() AND (
       NEW.price_cents IS DISTINCT FROM OLD.price_cents
    OR NEW.client_id IS DISTINCT FROM OLD.client_id
    OR NEW.property_id IS DISTINCT FROM OLD.property_id
    OR NEW.service_type_id IS DISTINCT FROM OLD.service_type_id
    OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
  ) THEN
    RAISE EXCEPTION 'Only owners and managers can change pricing or who/where a cleaning is for' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_employee_job_billing ON public.jobs;
CREATE TRIGGER guard_employee_job_billing BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.guard_employee_job_billing();

CREATE OR REPLACE FUNCTION public.guard_employee_visit_times()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  IF current_user <> 'authenticated' OR public.is_owner_or_manager() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.arrived_at IS NULL OR abs(extract(epoch FROM (NEW.arrived_at - now()))) > 300 OR NEW.left_at IS NOT NULL THEN
      RAISE EXCEPTION 'Visits start at the current time' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.arrived_at IS DISTINCT FROM OLD.arrived_at
     OR NEW.job_id IS DISTINCT FROM OLD.job_id
     OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'Only owners and managers can change visit details' USING ERRCODE = '42501';
  END IF;
  IF NEW.left_at IS DISTINCT FROM OLD.left_at THEN
    IF OLD.left_at IS NOT NULL OR NEW.left_at IS NULL
       OR abs(extract(epoch FROM (NEW.left_at - now()))) > 300 OR NEW.left_at < OLD.arrived_at THEN
      RAISE EXCEPTION 'Leave time is recorded at the current time; ask a manager to correct it' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_employee_visit_times ON public.job_visits;
CREATE TRIGGER guard_employee_visit_times BEFORE INSERT OR UPDATE ON public.job_visits
  FOR EACH ROW EXECUTE FUNCTION public.guard_employee_visit_times();