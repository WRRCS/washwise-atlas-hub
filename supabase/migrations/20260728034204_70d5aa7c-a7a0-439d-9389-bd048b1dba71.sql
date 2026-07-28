
-- =========================================================================
-- CLIENT PORTAL
-- =========================================================================

-- 1. client_messages: two-way messaging between client and business
CREATE TABLE public.client_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  sender_type text NOT NULL CHECK (sender_type IN ('client', 'business')),
  sender_user_id uuid,
  body text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_client_messages_client ON public.client_messages(client_id, created_at DESC);
CREATE INDEX idx_client_messages_tenant ON public.client_messages(tenant_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_messages TO authenticated;
GRANT ALL ON public.client_messages TO service_role;

ALTER TABLE public.client_messages ENABLE ROW LEVEL SECURITY;

-- Staff (owners/employees on the tenant) can see and manage messages for their tenant
CREATE POLICY "Staff read client_messages" ON public.client_messages
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "Staff insert client_messages" ON public.client_messages
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND sender_type = 'business');
CREATE POLICY "Staff update client_messages" ON public.client_messages
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id());

-- 2. client_service_requests: requests submitted through the portal
CREATE TABLE public.client_service_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  service_type_id uuid REFERENCES public.service_types(id) ON DELETE SET NULL,
  requested_date date,
  notes text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','scheduled','declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_service_requests_tenant ON public.client_service_requests(tenant_id, created_at DESC);
CREATE TRIGGER trg_client_service_requests_updated
  BEFORE UPDATE ON public.client_service_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_service_requests TO authenticated;
GRANT ALL ON public.client_service_requests TO service_role;

ALTER TABLE public.client_service_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read service requests" ON public.client_service_requests
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "Staff update service requests" ON public.client_service_requests
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id());

-- 3. Update handle_new_user to skip staff profile/role for portal clients
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _default_tenant UUID := '00000000-0000-0000-0000-000000000001';
  _tenant UUID;
  _business_name TEXT := NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'signup_business_name','')), '');
  _plan_tier TEXT := COALESCE(NULLIF(NEW.raw_user_meta_data->>'signup_plan_tier',''), 'starter');
  _slug TEXT;
  _is_first BOOLEAN;
  _is_portal_client BOOLEAN := COALESCE((NEW.raw_user_meta_data->>'portal_client')::boolean, false);
BEGIN
  -- Portal clients do NOT become staff — they interact only through portal RPCs
  IF _is_portal_client THEN
    RETURN NEW;
  END IF;

  IF _business_name IS NOT NULL THEN
    _slug := lower(regexp_replace(_business_name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(md5(NEW.id::text),1,6);
    IF _plan_tier NOT IN ('starter','growth','scale') THEN _plan_tier := 'starter'; END IF;

    INSERT INTO public.tenants (name, slug, plan_tier, onboarding_completed, business_email)
      VALUES (_business_name, _slug, _plan_tier, false, NEW.email)
      RETURNING id INTO _tenant;

    INSERT INTO public.profiles (id, tenant_id, full_name, email)
      VALUES (NEW.id, _tenant,
              COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)),
              NEW.email);

    INSERT INTO public.user_roles (user_id, tenant_id, role)
      VALUES (NEW.id, _tenant, 'owner'::app_role);
  ELSE
    _tenant := _default_tenant;
    INSERT INTO public.profiles (id, tenant_id, full_name, email)
      VALUES (NEW.id, _tenant,
              COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)),
              NEW.email);

    SELECT NOT EXISTS(SELECT 1 FROM public.user_roles WHERE tenant_id = _tenant) INTO _is_first;

    INSERT INTO public.user_roles (user_id, tenant_id, role)
      VALUES (NEW.id, _tenant,
              CASE WHEN _is_first THEN 'owner'::app_role ELSE 'employee'::app_role END);
  END IF;

  RETURN NEW;
END $function$;

-- 4. Portal RPCs

-- Check if an email is a known client (used before sending magic link)
CREATE OR REPLACE FUNCTION public.portal_email_is_client(_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clients
    WHERE lower(email) = lower(_email) AND is_active = true
  );
$$;

-- Return everything the signed-in portal user should see
CREATE OR REPLACE FUNCTION public.portal_get_data()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _email text;
  _client_ids uuid[];
BEGIN
  SELECT lower(email) INTO _email FROM auth.users WHERE id = auth.uid();
  IF _email IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT COALESCE(array_agg(id), '{}') INTO _client_ids
  FROM public.clients WHERE lower(email) = _email AND is_active = true;

  IF array_length(_client_ids, 1) IS NULL THEN
    RETURN jsonb_build_object(
      'clients', '[]'::jsonb, 'jobs', '[]'::jsonb, 'invoices', '[]'::jsonb,
      'messages', '[]'::jsonb, 'requests', '[]'::jsonb, 'tenants', '[]'::jsonb
    );
  END IF;

  RETURN jsonb_build_object(
    'clients', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'tenant_id', c.tenant_id,
        'first_name', c.first_name, 'last_name', c.last_name,
        'email', c.email, 'phone', c.phone,
        'service_address', c.service_address
      )) FROM public.clients c WHERE c.id = ANY(_client_ids)), '[]'::jsonb),
    'tenants', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'business_email', t.business_email,
        'business_phone', t.business_phone, 'logo_url', t.logo_url,
        'primary_color', t.primary_color
      )) FROM public.tenants t WHERE t.id IN (SELECT tenant_id FROM public.clients WHERE id = ANY(_client_ids))), '[]'::jsonb),
    'jobs', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', j.id, 'client_id', j.client_id, 'status', j.status,
        'scheduled_start', j.scheduled_start, 'scheduled_end', j.scheduled_end,
        'actual_end', j.actual_end,
        'service_name', st.name, 'price_cents', j.price_cents
      ) ORDER BY j.scheduled_start DESC)
      FROM public.jobs j LEFT JOIN public.service_types st ON st.id = j.service_type_id
      WHERE j.client_id = ANY(_client_ids)), '[]'::jsonb),
    'invoices', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', i.id, 'number', i.number, 'status', i.status,
        'total_cents', i.total_cents, 'issue_date', i.issue_date,
        'due_date', i.due_date, 'paid_at', i.paid_at, 'pay_link', i.pay_link,
        'client_id', i.client_id
      ) ORDER BY i.issue_date DESC)
      FROM public.invoices i WHERE i.client_id = ANY(_client_ids)), '[]'::jsonb),
    'messages', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', m.id, 'client_id', m.client_id, 'sender_type', m.sender_type,
        'body', m.body, 'created_at', m.created_at, 'read_at', m.read_at
      ) ORDER BY m.created_at ASC)
      FROM public.client_messages m WHERE m.client_id = ANY(_client_ids)), '[]'::jsonb),
    'requests', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'client_id', r.client_id, 'status', r.status,
        'requested_date', r.requested_date, 'notes', r.notes,
        'service_type_id', r.service_type_id, 'created_at', r.created_at
      ) ORDER BY r.created_at DESC)
      FROM public.client_service_requests r WHERE r.client_id = ANY(_client_ids)), '[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION public.portal_send_message(_client_id uuid, _body text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _email text;
  _tenant uuid;
  _id uuid;
BEGIN
  IF _body IS NULL OR length(trim(_body)) = 0 THEN RAISE EXCEPTION 'Message body required'; END IF;
  SELECT lower(email) INTO _email FROM auth.users WHERE id = auth.uid();
  IF _email IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT tenant_id INTO _tenant FROM public.clients
    WHERE id = _client_id AND lower(email) = _email AND is_active = true;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Client not accessible'; END IF;
  INSERT INTO public.client_messages (tenant_id, client_id, sender_type, sender_user_id, body)
    VALUES (_tenant, _client_id, 'client', auth.uid(), _body)
    RETURNING id INTO _id;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.portal_request_service(
  _client_id uuid, _service_type_id uuid, _requested_date date, _notes text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _email text;
  _tenant uuid;
  _id uuid;
BEGIN
  SELECT lower(email) INTO _email FROM auth.users WHERE id = auth.uid();
  IF _email IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT tenant_id INTO _tenant FROM public.clients
    WHERE id = _client_id AND lower(email) = _email AND is_active = true;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Client not accessible'; END IF;
  INSERT INTO public.client_service_requests (tenant_id, client_id, service_type_id, requested_date, notes)
    VALUES (_tenant, _client_id, _service_type_id, _requested_date, _notes)
    RETURNING id INTO _id;
  RETURN _id;
END $$;

-- Grants — portal RPCs must be callable by any authenticated user (portal or staff)
REVOKE EXECUTE ON FUNCTION public.portal_email_is_client(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.portal_get_data() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.portal_send_message(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.portal_request_service(uuid, uuid, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_email_is_client(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_get_data() TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_send_message(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_request_service(uuid, uuid, date, text) TO authenticated;
