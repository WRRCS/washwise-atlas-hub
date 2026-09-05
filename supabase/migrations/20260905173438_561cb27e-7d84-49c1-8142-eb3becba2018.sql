CREATE OR REPLACE FUNCTION public.get_sales_summary(_from date, _to date)
 RETURNS TABLE(day date, sales_cents bigint, labor_cost_cents bigint, labor_hours numeric, labor_pct_of_sales numeric, jobs_completed_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public._reports_guard();
  return query
  select d.day::date as day,
         coalesce(s.sales_cents, 0)::bigint as sales_cents,
         round(coalesce(l.labor_cost_cents, 0))::bigint as labor_cost_cents,
         round(coalesce(l.labor_hours, 0)::numeric, 2) as labor_hours,
         case when coalesce(s.sales_cents, 0) > 0
              then round(coalesce(l.labor_cost_cents, 0)::numeric / s.sales_cents::numeric * 100, 2)
              else case when coalesce(l.labor_cost_cents, 0) > 0 then 100 else 0 end
         end::numeric as labor_pct_of_sales,
         coalesce(s.jobs_completed_count, 0)::bigint as jobs_completed_count
  from generate_series(_from, _to, interval '1 day') as d(day)
  left join (
    select (coalesce(j.actual_end, j.scheduled_start))::date as day,
           sum(coalesce(j.price_cents, 0))::bigint as sales_cents,
           count(*)::bigint as jobs_completed_count
    from jobs j
    where j.tenant_id = public.current_tenant_id()
      and j.status = 'completed'
      and (coalesce(j.actual_end, j.scheduled_start))::date between _from and _to
    group by 1
  ) s on s.day = d.day::date
  left join (
    select te.started_at::date as day,
           sum(extract(epoch from (coalesce(te.ended_at, now()) - te.started_at)) / 3600.0)::numeric as labor_hours,
           sum(extract(epoch from (coalesce(te.ended_at, now()) - te.started_at)) / 3600.0
               * coalesce(p.hourly_rate_cents, 0))::numeric as labor_cost_cents
    from time_entries te
    join profiles p on p.id = te.user_id and p.tenant_id = te.tenant_id
    where te.tenant_id = public.current_tenant_id()
      and te.started_at::date between _from and _to
    group by 1
  ) l on l.day = d.day::date
  order by d.day;
end;
$function$;