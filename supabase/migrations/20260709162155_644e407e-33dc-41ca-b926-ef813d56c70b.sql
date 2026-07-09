
-- Revenue by month (from paid invoices)
CREATE OR REPLACE FUNCTION public.get_revenue_by_month(_from DATE, _to DATE)
RETURNS TABLE (
  month TEXT,
  total_revenue_cents BIGINT,
  invoice_count BIGINT,
  avg_invoice_cents NUMERIC,
  by_service_type JSONB
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _tid UUID := public.current_tenant_id();
BEGIN
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
END $$;

GRANT EXECUTE ON FUNCTION public.get_revenue_by_month(DATE, DATE) TO authenticated;

-- Employee productivity
CREATE OR REPLACE FUNCTION public.get_employee_productivity(_from DATE, _to DATE)
RETURNS TABLE (
  employee_id UUID,
  full_name TEXT,
  jobs_completed_count BIGINT,
  total_hours_worked NUMERIC,
  avg_job_duration_minutes NUMERIC,
  revenue_attributed_cents BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _tid UUID := public.current_tenant_id();
BEGIN
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
END $$;

GRANT EXECUTE ON FUNCTION public.get_employee_productivity(DATE, DATE) TO authenticated;

-- Client retention (all-time stats)
CREATE OR REPLACE FUNCTION public.get_client_retention()
RETURNS TABLE (
  client_id UUID,
  full_name TEXT,
  first_service_date DATE,
  last_service_date DATE,
  total_jobs_count BIGINT,
  lifetime_revenue_cents BIGINT,
  is_recurring BOOLEAN,
  months_active_count BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _tid UUID := public.current_tenant_id();
BEGIN
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
END $$;

GRANT EXECUTE ON FUNCTION public.get_client_retention() TO authenticated;

-- Inventory usage by month + item
CREATE OR REPLACE FUNCTION public.get_inventory_usage_detail(_from DATE, _to DATE)
RETURNS TABLE (
  month TEXT,
  item_id UUID,
  item_name TEXT,
  item_unit TEXT,
  units_used NUMERIC,
  total_cost_cents BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _tid UUID := public.current_tenant_id();
BEGIN
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
END $$;

GRANT EXECUTE ON FUNCTION public.get_inventory_usage_detail(DATE, DATE) TO authenticated;
