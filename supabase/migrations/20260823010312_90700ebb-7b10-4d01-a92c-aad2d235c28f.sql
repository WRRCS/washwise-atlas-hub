-- 1. invoices: managers may create/update; only owners may delete
DROP POLICY IF EXISTS "Staff manage invoices" ON public.invoices;
CREATE POLICY "Staff insert invoices" ON public.invoices
  FOR INSERT TO authenticated
  WITH CHECK (is_owner_or_manager() AND tenant_id = current_tenant_id());
CREATE POLICY "Staff update invoices" ON public.invoices
  FOR UPDATE TO authenticated
  USING (is_owner_or_manager() AND tenant_id = current_tenant_id())
  WITH CHECK (is_owner_or_manager() AND tenant_id = current_tenant_id());
CREATE POLICY "Owners delete invoices" ON public.invoices
  FOR DELETE TO authenticated
  USING (is_owner() AND tenant_id = current_tenant_id());

-- 2. push_subscriptions: tenant scope on read/update/delete too
DROP POLICY IF EXISTS "push_subs_user_own" ON public.push_subscriptions;
CREATE POLICY "push_subs_user_own" ON public.push_subscriptions
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND tenant_id = current_tenant_id())
  WITH CHECK (user_id = auth.uid() AND tenant_id = current_tenant_id());

-- 3. sms_messages: restrict policies to authenticated role
DROP POLICY IF EXISTS "sms_messages_select_own_tenant" ON public.sms_messages;
DROP POLICY IF EXISTS "sms_messages_insert_own_tenant" ON public.sms_messages;
DROP POLICY IF EXISTS "sms_messages_update_own_tenant" ON public.sms_messages;
CREATE POLICY "sms_messages_select_own_tenant" ON public.sms_messages
  FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "sms_messages_insert_own_tenant" ON public.sms_messages
  FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "sms_messages_update_own_tenant" ON public.sms_messages
  FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- 4. user_roles: restrict role visibility policy to authenticated role
DROP POLICY IF EXISTS "Users can see own roles" ON public.user_roles;
CREATE POLICY "Users can see own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR (is_owner() AND tenant_id = current_tenant_id()));

-- 5. SECURITY DEFINER report functions: enforce owner/manager inside the function
CREATE OR REPLACE FUNCTION public.get_client_retention()
 RETURNS TABLE(client_id uuid, full_name text, first_service_date date, last_service_date date, total_jobs_count bigint, lifetime_revenue_cents bigint, is_recurring boolean, months_active_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _tid UUID := public.current_tenant_id();
BEGIN
  IF _tid IS NULL OR NOT public.is_owner_or_manager() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
  WITH job_agg AS (
    SELECT j.client_id,
           MIN(j.scheduled_start)::date AS first_d,
           MAX(j.scheduled_start)::date AS last_d,
           COUNT(*) FILTER (WHERE j.status = 'completed') AS jobs_done,
           COUNT(DISTINCT date_trunc('month', j.scheduled_start))::BIGINT AS months_active
    FROM public.jobs j
    WHERE j.tenant_id = _tid
    GROUP BY j.client_id
  ),
  rev AS (
    SELECT i.client_id, SUM(i.total_cents)::BIGINT AS total_rev
    FROM public.invoices i
    WHERE i.tenant_id = _tid AND i.status = 'paid'
    GROUP BY i.client_id
  )
  SELECT c.id AS client_id,
         NULLIF(TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')), '') AS full_name,
         ja.first_d,
         ja.last_d,
         COALESCE(ja.jobs_done, 0)::BIGINT,
         COALESCE(r.total_rev, 0)::BIGINT,
         COALESCE(ja.jobs_done, 0) >= 2 AS is_recurring,
         COALESCE(ja.months_active, 0)::BIGINT
  FROM public.clients c
  LEFT JOIN job_agg ja ON ja.client_id = c.id
  LEFT JOIN rev r ON r.client_id = c.id
  WHERE c.tenant_id = _tid
  ORDER BY COALESCE(r.total_rev, 0) DESC;
END $function$;

CREATE OR REPLACE FUNCTION public.get_employee_productivity(_from date, _to date)
 RETURNS TABLE(employee_id uuid, full_name text, jobs_completed_count bigint, total_hours_worked numeric, avg_job_duration_minutes numeric, revenue_attributed_cents bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _tid UUID := public.current_tenant_id();
BEGIN
  IF _tid IS NULL OR NOT public.is_owner_or_manager() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
  WITH jobs_done AS (
    SELECT j.id, j.price_cents, j.actual_start, j.actual_end,
           (SELECT COUNT(*) FROM public.job_employees je2 WHERE je2.job_id = j.id) AS crew_size
    FROM public.jobs j
    WHERE j.tenant_id = _tid
      AND j.status = 'completed'
      AND j.actual_end IS NOT NULL
      AND j.actual_end::date >= _from AND j.actual_end::date <= _to
  ),
  emp_rev AS (
    SELECT je.employee_id,
           SUM(CASE WHEN jd.crew_size > 0 THEN jd.price_cents / jd.crew_size ELSE 0 END)::BIGINT AS revenue_cents,
           COUNT(DISTINCT jd.id) AS jobs_done
    FROM public.job_employees je
    JOIN jobs_done jd ON jd.id = je.job_id
    GROUP BY je.employee_id
  ),
  hours AS (
    SELECT te.user_id AS employee_id,
           SUM(EXTRACT(EPOCH FROM (te.ended_at - te.started_at)) / 3600.0)::NUMERIC AS total_hours,
           AVG(EXTRACT(EPOCH FROM (te.ended_at - te.started_at)) / 60.0)::NUMERIC AS avg_min
    FROM public.time_entries te
    WHERE te.tenant_id = _tid
      AND te.ended_at IS NOT NULL
      AND te.ended_at::date >= _from AND te.ended_at::date <= _to
    GROUP BY te.user_id
  )
  SELECT p.id AS employee_id,
         p.full_name,
         COALESCE(er.jobs_done, 0)::BIGINT,
         COALESCE(h.total_hours, 0)::NUMERIC,
         COALESCE(h.avg_min, 0)::NUMERIC,
         COALESCE(er.revenue_cents, 0)::BIGINT
  FROM public.profiles p
  LEFT JOIN emp_rev er ON er.employee_id = p.id
  LEFT JOIN hours h ON h.employee_id = p.id
  WHERE p.tenant_id = _tid
    AND (er.jobs_done IS NOT NULL OR h.total_hours IS NOT NULL)
  ORDER BY p.full_name;
END $function$;

CREATE OR REPLACE FUNCTION public.get_inventory_usage_detail(_from date, _to date)
 RETURNS TABLE(month text, item_id uuid, item_name text, item_unit text, units_used numeric, total_cost_cents bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _tid UUID := public.current_tenant_id();
BEGIN
  IF _tid IS NULL OR NOT public.is_owner_or_manager() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
  SELECT to_char(date_trunc('month', tx.created_at), 'YYYY-MM') AS month,
         i.id AS item_id,
         i.name AS item_name,
         i.unit AS item_unit,
         SUM(ABS(tx.change_amount))::NUMERIC AS units_used,
         SUM(ABS(tx.change_amount) * i.cost_per_unit_cents)::BIGINT AS total_cost_cents
  FROM public.inventory_transactions tx
  JOIN public.inventory_items i ON i.id = tx.item_id
  WHERE tx.tenant_id = _tid
    AND tx.reason = 'job_usage'
    AND tx.created_at::date >= _from AND tx.created_at::date <= _to
  GROUP BY 1, 2, 3, 4
  ORDER BY 1, item_name;
END $function$;

CREATE OR REPLACE FUNCTION public.get_revenue_by_month(_from date, _to date)
 RETURNS TABLE(month text, total_revenue_cents bigint, invoice_count bigint, avg_invoice_cents numeric, by_service_type jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _tid UUID := public.current_tenant_id();
BEGIN
  IF _tid IS NULL OR NOT public.is_owner_or_manager() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
  WITH paid AS (
    SELECT i.id, i.total_cents, i.paid_at, j.service_type_id
    FROM public.invoices i
    LEFT JOIN public.jobs j ON j.id = i.job_id
    WHERE i.tenant_id = _tid
      AND i.status = 'paid'
      AND i.paid_at IS NOT NULL
      AND i.paid_at::date >= _from
      AND i.paid_at::date <= _to
  ),
  by_svc AS (
    SELECT to_char(date_trunc('month', p.paid_at), 'YYYY-MM') AS m,
           COALESCE(s.name, 'Uncategorized') AS svc_name,
           SUM(p.total_cents) AS rev
    FROM paid p LEFT JOIN public.service_types s ON s.id = p.service_type_id
    GROUP BY 1, 2
  ),
  svc_agg AS (
    SELECT m, jsonb_object_agg(svc_name, rev) AS by_service_type
    FROM by_svc GROUP BY m
  )
  SELECT to_char(date_trunc('month', p.paid_at), 'YYYY-MM') AS month,
         SUM(p.total_cents)::BIGINT AS total_revenue_cents,
         COUNT(*)::BIGINT AS invoice_count,
         AVG(p.total_cents)::NUMERIC AS avg_invoice_cents,
         COALESCE(sa.by_service_type, '{}'::jsonb) AS by_service_type
  FROM paid p
  LEFT JOIN svc_agg sa ON sa.m = to_char(date_trunc('month', p.paid_at), 'YYYY-MM')
  GROUP BY 1, sa.by_service_type
  ORDER BY 1;
END $function$;