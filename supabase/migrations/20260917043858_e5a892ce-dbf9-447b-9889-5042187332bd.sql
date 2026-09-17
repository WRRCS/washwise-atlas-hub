DROP TRIGGER IF EXISTS hold_client_emails ON public.notifications;
DROP FUNCTION IF EXISTS public.tg_hold_client_emails();

ALTER TABLE public.client_messages
  ADD COLUMN IF NOT EXISTS retracted_at timestamptz,
  ADD COLUMN IF NOT EXISTS retracted_by uuid;

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
      FROM public.invoices i
      WHERE i.client_id = ANY(_client_ids) AND i.status <> 'draft'), '[]'::jsonb),
    'messages', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', m.id, 'client_id', m.client_id, 'sender_type', m.sender_type,
        'body', m.body, 'created_at', m.created_at, 'read_at', m.read_at
      ) ORDER BY m.created_at ASC)
      FROM public.client_messages m
      WHERE m.client_id = ANY(_client_ids) AND m.retracted_at IS NULL), '[]'::jsonb),
    'requests', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'client_id', r.client_id, 'status', r.status,
        'requested_date', r.requested_date, 'notes', r.notes,
        'service_type_id', r.service_type_id, 'created_at', r.created_at
      ) ORDER BY r.created_at DESC)
      FROM public.client_service_requests r WHERE r.client_id = ANY(_client_ids)), '[]'::jsonb)
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.portal_get_data() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_get_data() TO authenticated;