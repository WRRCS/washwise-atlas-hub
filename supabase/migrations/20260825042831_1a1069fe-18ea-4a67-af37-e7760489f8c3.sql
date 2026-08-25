-- ============ Owner/manager gate helper ============
CREATE OR REPLACE FUNCTION public._reports_guard()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR public.current_tenant_id() IS NULL OR NOT public.is_owner_or_manager() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._reports_can_cpni()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.is_owner() OR public.has_employee_permission('can_view_client_cpni');
$$;

-- ============ Transaction list ============
CREATE OR REPLACE FUNCTION public.report_transactions(_from date, _to date)
RETURNS TABLE(
  kind text, occurred_on date, client_id uuid, client_name text,
  invoice_id uuid, invoice_number text, job_id uuid,
  method text, amount_cents bigint, status text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _tid uuid;
BEGIN
  PERFORM public._reports_guard();
  _tid := public.current_tenant_id();
  RETURN QUERY
  SELECT 'invoice'::text, i.issue_date, i.client_id, public._client_name(i.client_id),
         i.id, i.number, i.job_id, NULL::text, i.total_cents::bigint, i.status::text
    FROM public.invoices i
   WHERE i.tenant_id = _tid AND i.issue_date BETWEEN _from AND _to
  UNION ALL
  SELECT 'payment'::text, (p.processed_at AT TIME ZONE 'UTC')::date, i.client_id, public._client_name(i.client_id),
         i.id, i.number, i.job_id, p.provider::text, (-p.amount_cents)::bigint, p.status::text
    FROM public.payments p
    JOIN public.invoices i ON i.id = p.invoice_id
   WHERE p.tenant_id = _tid AND p.processed_at IS NOT NULL
     AND (p.processed_at AT TIME ZONE 'UTC')::date BETWEEN _from AND _to
   ORDER BY 2 DESC;
END $$;

-- ============ Invoices report ============
CREATE OR REPLACE FUNCTION public.report_invoices(_from date, _to date)
RETURNS TABLE(
  id uuid, number text, client_id uuid, client_name text,
  client_email text, client_phone text, billing_address text,
  status text, subtotal_cents bigint, total_cents bigint, paid_cents bigint,
  issue_date date, due_date date, sent_at timestamptz, paid_at timestamptz, job_id uuid
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _tid uuid; _cpni boolean;
BEGIN
  PERFORM public._reports_guard();
  _tid := public.current_tenant_id();
  _cpni := public._reports_can_cpni();
  RETURN QUERY
  SELECT i.id, i.number, i.client_id, public._client_name(i.client_id),
         CASE WHEN _cpni THEN c.email END,
         CASE WHEN _cpni THEN c.phone END,
         CASE WHEN _cpni THEN c.billing_address END,
         i.status::text, i.subtotal_cents::bigint, i.total_cents::bigint,
         COALESCE((SELECT SUM(p.amount_cents) FROM public.payments p
                    WHERE p.invoice_id = i.id AND p.status = 'succeeded'), 0)::bigint,
         i.issue_date, i.due_date, i.sent_at, i.paid_at, i.job_id
    FROM public.invoices i
    LEFT JOIN public.clients c ON c.id = i.client_id
   WHERE i.tenant_id = _tid AND i.issue_date BETWEEN _from AND _to
   ORDER BY i.issue_date DESC, i.created_at DESC;
END $$;

-- ============ Client balance summary ============
CREATE OR REPLACE FUNCTION public.report_client_balances()
RETURNS TABLE(
  client_id uuid, client_name text, email text, phone text,
  invoiced_cents bigint, paid_cents bigint, balance_cents bigint, late_balance_cents bigint,
  invoice_count bigint, last_invoice_date date, last_paid_at timestamptz, avg_payment_days numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _tid uuid; _cpni boolean;
BEGIN
  PERFORM public._reports_guard();
  _tid := public.current_tenant_id();
  _cpni := public._reports_can_cpni();
  RETURN QUERY
  WITH inv AS (
    SELECT i.client_id,
           SUM(i.total_cents)::bigint AS invoiced,
           SUM(CASE WHEN i.status = 'paid' THEN i.total_cents ELSE 0 END)::bigint AS paid,
           SUM(CASE WHEN i.status IN ('sent','overdue') THEN i.total_cents ELSE 0 END)::bigint AS outstanding,
           SUM(CASE WHEN i.status = 'overdue' OR (i.status = 'sent' AND i.due_date < CURRENT_DATE)
                    THEN i.total_cents ELSE 0 END)::bigint AS late,
           COUNT(*)::bigint AS cnt,
           MAX(i.issue_date) AS last_inv,
           MAX(i.paid_at) AS last_paid,
           AVG(CASE WHEN i.paid_at IS NOT NULL
                    THEN EXTRACT(EPOCH FROM (i.paid_at - i.issue_date::timestamptz)) / 86400.0 END)::numeric AS avg_days
      FROM public.invoices i
     WHERE i.tenant_id = _tid AND i.status <> 'cancelled'
     GROUP BY i.client_id
  )
  SELECT c.id,
         COALESCE(NULLIF(TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')), ''), 'Unknown'),
         CASE WHEN _cpni THEN c.email END,
         CASE WHEN _cpni THEN c.phone END,
         COALESCE(inv.invoiced,0), COALESCE(inv.paid,0),
         COALESCE(inv.outstanding,0), COALESCE(inv.late,0),
         COALESCE(inv.cnt,0), inv.last_inv, inv.last_paid, ROUND(COALESCE(inv.avg_days,0), 1)
    FROM public.clients c
    LEFT JOIN inv ON inv.client_id = c.id
   WHERE c.tenant_id = _tid
   ORDER BY COALESCE(inv.outstanding,0) DESC, 2;
END $$;

-- ============ Client directory ============
CREATE OR REPLACE FUNCTION public.report_client_directory()
RETURNS TABLE(
  client_id uuid, first_name text, last_name text, client_name text,
  email text, phone text, billing_address text, service_address text,
  is_active boolean, is_airbnb_host boolean, created_at timestamptz,
  properties jsonb, jobs_count bigint, last_job_at timestamptz, lifetime_revenue_cents bigint,
  has_sop boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _tid uuid; _cpni boolean;
BEGIN
  PERFORM public._reports_guard();
  _tid := public.current_tenant_id();
  _cpni := public._reports_can_cpni();
  RETURN QUERY
  SELECT c.id, c.first_name, c.last_name,
         COALESCE(NULLIF(TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')), ''), 'Unknown'),
         CASE WHEN _cpni THEN c.email END,
         CASE WHEN _cpni THEN c.phone END,
         CASE WHEN _cpni THEN c.billing_address END,
         c.service_address, c.is_active, c.is_airbnb_host, c.created_at,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id', cp.id, 'label', cp.label, 'address', cp.address, 'is_primary', cp.is_primary) ORDER BY cp.is_primary DESC, cp.label)
                     FROM public.client_properties cp WHERE cp.client_id = c.id AND cp.is_active), '[]'::jsonb),
         (SELECT COUNT(*) FROM public.jobs j WHERE j.client_id = c.id)::bigint,
         (SELECT MAX(j.scheduled_start) FROM public.jobs j WHERE j.client_id = c.id),
         COALESCE((SELECT SUM(i.total_cents) FROM public.invoices i WHERE i.client_id = c.id AND i.status = 'paid'), 0)::bigint,
         (COALESCE(NULLIF(TRIM(COALESCE(c.client_sop,'')), ''), NULL) IS NOT NULL)
    FROM public.clients c
   WHERE c.tenant_id = _tid
   ORDER BY 4;
END $$;

-- ============ Timesheets ============
CREATE OR REPLACE FUNCTION public.report_timesheets(_from date, _to date)
RETURNS TABLE(
  entry_id uuid, user_id uuid, full_name text, work_date date,
  started_at timestamptz, ended_at timestamptz, hours numeric,
  job_id uuid, job_label text, note text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _tid uuid;
BEGIN
  PERFORM public._reports_guard();
  _tid := public.current_tenant_id();
  RETURN QUERY
  SELECT te.id, te.user_id, p.full_name, (te.started_at AT TIME ZONE 'UTC')::date,
         te.started_at, te.ended_at,
         ROUND(COALESCE(EXTRACT(EPOCH FROM (te.ended_at - te.started_at)) / 3600.0, 0)::numeric, 2),
         te.job_id,
         CASE WHEN te.job_id IS NULL THEN 'General'
              ELSE COALESCE(st.name, 'Job') || ' — ' || public._client_name(j.client_id) END,
         te.notes
    FROM public.time_entries te
    LEFT JOIN public.profiles p ON p.id = te.user_id
    LEFT JOIN public.jobs j ON j.id = te.job_id
    LEFT JOIN public.service_types st ON st.id = j.service_type_id
   WHERE te.tenant_id = _tid
     AND (te.started_at AT TIME ZONE 'UTC')::date BETWEEN _from AND _to
   ORDER BY p.full_name, te.started_at;
END $$;

-- ============ Client communications ============
CREATE OR REPLACE FUNCTION public.report_client_communications(_from date, _to date)
RETURNS TABLE(
  sent_on timestamptz, client_id uuid, client_name text,
  channel text, direction text, subject text, status text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _tid uuid;
BEGIN
  PERFORM public._reports_guard();
  _tid := public.current_tenant_id();
  RETURN QUERY
  SELECT COALESCE(n.sent_at, n.scheduled_for), n.recipient_id, public._client_name(n.recipient_id),
         n.channel::text, 'out'::text,
         COALESCE(n.payload->>'subject', n.template_name), n.status::text
    FROM public.notifications n
   WHERE n.tenant_id = _tid AND n.recipient_type = 'client'
     AND COALESCE(n.sent_at, n.scheduled_for)::date BETWEEN _from AND _to
  UNION ALL
  SELECT s.created_at, s.client_id, public._client_name(s.client_id),
         'sms'::text, s.direction, LEFT(COALESCE(s.body,''), 140), COALESCE(s.status,'')
    FROM public.sms_messages s
   WHERE s.tenant_id = _tid AND s.created_at::date BETWEEN _from AND _to
  UNION ALL
  SELECT m.created_at, m.client_id, public._client_name(m.client_id),
         'portal'::text, CASE WHEN m.sender_type = 'client' THEN 'in' ELSE 'out' END,
         LEFT(COALESCE(m.body,''), 140), CASE WHEN m.read_at IS NULL THEN 'unread' ELSE 'read' END
    FROM public.client_messages m
   WHERE m.tenant_id = _tid AND m.created_at::date BETWEEN _from AND _to
   ORDER BY 1 DESC;
END $$;

-- ============ Single client account ============
CREATE OR REPLACE FUNCTION public.report_client_account(_client_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _tid uuid; _cpni boolean; _c public.clients%ROWTYPE;
BEGIN
  PERFORM public._reports_guard();
  _tid := public.current_tenant_id();
  _cpni := public._reports_can_cpni();
  SELECT * INTO _c FROM public.clients WHERE id = _client_id AND tenant_id = _tid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client not found'; END IF;

  RETURN jsonb_build_object(
    'client', jsonb_build_object(
      'id', _c.id,
      'name', COALESCE(NULLIF(TRIM(COALESCE(_c.first_name,'') || ' ' || COALESCE(_c.last_name,'')), ''), 'Unknown'),
      'first_name', _c.first_name, 'last_name', _c.last_name,
      'service_address', _c.service_address,
      'is_active', _c.is_active, 'is_airbnb_host', _c.is_airbnb_host,
      'created_at', _c.created_at,
      'email', CASE WHEN _cpni THEN _c.email END,
      'phone', CASE WHEN _cpni THEN _c.phone END,
      'billing_address', CASE WHEN _cpni THEN _c.billing_address END,
      'cpni_visible', _cpni
    ),
    'sop', _c.client_sop,
    'specs', COALESCE((SELECT to_jsonb(ps.*) FROM public.property_specs ps WHERE ps.client_id = _c.id LIMIT 1), 'null'::jsonb),
    'properties', COALESCE((SELECT jsonb_agg(to_jsonb(cp.*) ORDER BY cp.is_primary DESC, cp.label)
                              FROM public.client_properties cp WHERE cp.client_id = _c.id), '[]'::jsonb),
    'notes', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', cn.id, 'note', cn.note, 'created_at', cn.created_at) ORDER BY cn.created_at DESC)
                         FROM public.client_notes cn WHERE cn.client_id = _c.id), '[]'::jsonb),
    'jobs', COALESCE((SELECT jsonb_agg(jsonb_build_object(
              'id', j.id, 'status', j.status, 'scheduled_start', j.scheduled_start, 'scheduled_end', j.scheduled_end,
              'actual_start', j.actual_start, 'actual_end', j.actual_end,
              'service_name', st.name, 'price_cents', j.price_cents,
              'crew', COALESCE((SELECT string_agg(pr.full_name, ', ') FROM public.job_employees je
                                  JOIN public.profiles pr ON pr.id = je.employee_id WHERE je.job_id = j.id), '')
            ) ORDER BY j.scheduled_start DESC)
            FROM public.jobs j LEFT JOIN public.service_types st ON st.id = j.service_type_id
           WHERE j.client_id = _c.id), '[]'::jsonb),
    'invoices', COALESCE((SELECT jsonb_agg(jsonb_build_object(
              'id', i.id, 'number', i.number, 'status', i.status, 'total_cents', i.total_cents,
              'issue_date', i.issue_date, 'due_date', i.due_date, 'paid_at', i.paid_at
            ) ORDER BY i.issue_date DESC)
            FROM public.invoices i WHERE i.client_id = _c.id), '[]'::jsonb),
    'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
              'id', p.id, 'provider', p.provider, 'amount_cents', p.amount_cents, 'status', p.status,
              'processed_at', p.processed_at, 'note', p.note, 'invoice_number', i.number
            ) ORDER BY p.processed_at DESC NULLS LAST)
            FROM public.payments p JOIN public.invoices i ON i.id = p.invoice_id
           WHERE i.client_id = _c.id), '[]'::jsonb),
    'communications', COALESCE((SELECT jsonb_agg(x ORDER BY x->>'at' DESC) FROM (
              SELECT jsonb_build_object('at', COALESCE(n.sent_at, n.scheduled_for), 'channel', n.channel::text,
                                        'direction', 'out', 'subject', COALESCE(n.payload->>'subject', n.template_name),
                                        'status', n.status::text) AS x
                FROM public.notifications n
               WHERE n.tenant_id = _tid AND n.recipient_type = 'client' AND n.recipient_id = _c.id
               UNION ALL
              SELECT jsonb_build_object('at', s.created_at, 'channel', 'sms', 'direction', s.direction,
                                        'subject', LEFT(COALESCE(s.body,''), 140), 'status', COALESCE(s.status,''))
                FROM public.sms_messages s WHERE s.client_id = _c.id
               UNION ALL
              SELECT jsonb_build_object('at', m.created_at, 'channel', 'portal',
                                        'direction', CASE WHEN m.sender_type='client' THEN 'in' ELSE 'out' END,
                                        'subject', LEFT(COALESCE(m.body,''), 140),
                                        'status', CASE WHEN m.read_at IS NULL THEN 'unread' ELSE 'read' END)
                FROM public.client_messages m WHERE m.client_id = _c.id
            ) q), '[]'::jsonb),
    'totals', jsonb_build_object(
      'invoiced_cents', COALESCE((SELECT SUM(i.total_cents) FROM public.invoices i WHERE i.client_id = _c.id AND i.status <> 'cancelled'), 0),
      'paid_cents', COALESCE((SELECT SUM(i.total_cents) FROM public.invoices i WHERE i.client_id = _c.id AND i.status = 'paid'), 0),
      'outstanding_cents', COALESCE((SELECT SUM(i.total_cents) FROM public.invoices i WHERE i.client_id = _c.id AND i.status IN ('sent','overdue')), 0),
      'jobs_count', (SELECT COUNT(*) FROM public.jobs j WHERE j.client_id = _c.id)
    )
  );
END $$;

-- Access: signed-in staff only; each function self-checks owner/manager.
REVOKE ALL ON FUNCTION public._reports_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._reports_can_cpni() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.report_transactions(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.report_invoices(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.report_client_balances() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.report_client_directory() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.report_timesheets(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.report_client_communications(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.report_client_account(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.report_transactions(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_invoices(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_client_balances() TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_client_directory() TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_timesheets(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_client_communications(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_client_account(uuid) TO authenticated;