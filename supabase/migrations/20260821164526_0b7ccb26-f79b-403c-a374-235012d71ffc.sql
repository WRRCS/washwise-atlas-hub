WITH src AS (
  SELECT * FROM public.jobs
  WHERE scheduled_start >= '2026-07-27T00:00:00Z' AND scheduled_start < '2026-08-03T00:00:00Z'
), ins AS (
  INSERT INTO public.jobs (tenant_id, client_id, property_id, service_type_id, assigned_to, status, scheduled_start, scheduled_end, price_cents, notes, published_at)
  SELECT tenant_id, client_id, property_id, service_type_id, assigned_to, 'scheduled'::job_status,
         scheduled_start + interval '21 days', scheduled_end + interval '21 days',
         price_cents, notes, now()
  FROM src
  RETURNING id, client_id, scheduled_start
)
INSERT INTO public.job_employees (job_id, employee_id, tenant_id)
SELECT i.id, je.employee_id, j.tenant_id
FROM ins i
JOIN src j ON j.client_id = i.client_id AND j.scheduled_start + interval '21 days' = i.scheduled_start
JOIN public.job_employees je ON je.job_id = j.id
ON CONFLICT DO NOTHING;