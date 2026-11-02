CREATE OR REPLACE FUNCTION public.report_timesheets(_from date,_to date) RETURNS TABLE(entry_id uuid,user_id uuid,full_name text,work_date date,started_at timestamptz,ended_at timestamptz,hours numeric,job_id uuid,job_label text,note text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE tid uuid;
BEGIN
 PERFORM public._reports_guard();tid:=public.current_tenant_id();
 RETURN QUERY
 WITH paid AS (
 SELECT te.id,te.user_id,te.started_at,te.ended_at,te.job_id,te.notes AS description,'work'::text AS activity FROM public.time_entries te WHERE te.tenant_id=tid
 UNION ALL SELECT w.id,w.user_id,w.started_at,w.ended_at,w.job_id,w.description,w.activity_type FROM public.work_clock_entries w WHERE w.tenant_id=tid AND w.kind='work'
 ), days AS (SELECT d::date AS day FROM generate_series(_from::timestamp,_to::timestamp,'1 day') d)
 SELECT e.id,e.user_id,p.full_name,d.day,e.started_at,e.ended_at,
 round((extract(epoch FROM (least(coalesce(e.ended_at,now()),(d.day+1)::timestamp AT TIME ZONE 'America/Los_Angeles')-greatest(e.started_at,d.day::timestamp AT TIME ZONE 'America/Los_Angeles')))/3600)::numeric,2),e.job_id,
 CASE WHEN e.activity='drive' THEN 'Drive' WHEN e.job_id IS NULL THEN 'Unscheduled work' ELSE coalesce(st.name,'Job')||' — '||public._client_name(j.client_id) END,e.description
 FROM paid e JOIN days d ON e.started_at<((d.day+1)::timestamp AT TIME ZONE 'America/Los_Angeles') AND coalesce(e.ended_at,now())>(d.day::timestamp AT TIME ZONE 'America/Los_Angeles')
 LEFT JOIN public.profiles p ON p.id=e.user_id LEFT JOIN public.jobs j ON j.id=e.job_id LEFT JOIN public.service_types st ON st.id=j.service_type_id ORDER BY p.full_name,d.day,e.started_at;
END;
$$;