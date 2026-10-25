CREATE OR REPLACE FUNCTION public.correct_clock_record(_id uuid,_start timestamptz,_end timestamptz,_job uuid,_description text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE w public.work_clock_entries%ROWTYPE; p uuid; n uuid; pt text; nt text;
BEGIN
 IF NOT public.is_owner_or_manager() THEN RAISE EXCEPTION 'Only owners and managers can correct time'; END IF;
 SELECT * INTO w FROM public.work_clock_entries WHERE id=_id AND tenant_id=public.current_tenant_id();
 IF w.id IS NULL THEN RAISE EXCEPTION 'Clock record not found'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=w.user_id FOR UPDATE;
 IF _end < _start THEN RAISE EXCEPTION 'End time must be after start'; END IF;
 IF _job IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.jobs WHERE id=_job AND tenant_id=w.tenant_id) THEN RAISE EXCEPTION 'Appointment not found'; END IF;
 IF w.kind='lunch' THEN
  SELECT id,'time' INTO p,pt FROM public.time_entries WHERE user_id=w.user_id AND ended_at=w.started_at LIMIT 1;
  IF p IS NULL THEN SELECT id,'clock' INTO p,pt FROM public.work_clock_entries WHERE user_id=w.user_id AND ended_at=w.started_at AND kind='work' LIMIT 1; END IF;
  SELECT id,'time' INTO n,nt FROM public.time_entries WHERE user_id=w.user_id AND started_at=w.ended_at LIMIT 1;
  IF n IS NULL THEN SELECT id,'clock' INTO n,nt FROM public.work_clock_entries WHERE user_id=w.user_id AND started_at=w.ended_at AND kind='work' LIMIT 1; END IF;
  IF n IS NOT NULL AND _end IS NULL THEN RAISE EXCEPTION 'Cannot reopen lunch while resumed work exists'; END IF;
  -- Temporarily remove only this lunch inside the transaction so adjacent paid edges can move safely.
  DELETE FROM public.work_clock_entries WHERE id=w.id;
  IF pt='time' THEN UPDATE public.time_entries SET ended_at=_start WHERE id=p; ELSIF pt='clock' THEN UPDATE public.work_clock_entries SET ended_at=_start WHERE id=p; END IF;
  IF nt='time' THEN UPDATE public.time_entries SET started_at=_end WHERE id=n; ELSIF nt='clock' THEN UPDATE public.work_clock_entries SET started_at=_end WHERE id=n; END IF;
  UPDATE public.job_visits SET left_at=_start WHERE employee_id=w.user_id AND left_at=w.started_at;
  UPDATE public.job_visits SET arrived_at=_end WHERE employee_id=w.user_id AND arrived_at=w.ended_at;
  w.started_at:=_start; w.ended_at:=_end; w.description:=_description;
  INSERT INTO public.work_clock_entries SELECT (w).*;
 ELSE
  UPDATE public.work_clock_entries SET started_at=_start,ended_at=_end,job_id=_job,description=_description WHERE id=w.id;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.correct_clock_record(uuid,timestamptz,timestamptz,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.correct_clock_record(uuid,timestamptz,timestamptz,uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.report_timesheets(_from date,_to date) RETURNS TABLE(entry_id uuid,user_id uuid,full_name text,work_date date,started_at timestamptz,ended_at timestamptz,hours numeric,job_id uuid,job_label text,note text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE tid uuid;
BEGIN
 PERFORM public._reports_guard(); tid:=public.current_tenant_id();
 RETURN QUERY
 SELECT e.id,e.user_id,p.full_name,(e.started_at AT TIME ZONE 'America/Los_Angeles')::date,e.started_at,e.ended_at,
 round(coalesce(extract(epoch FROM (e.ended_at-e.started_at))/3600.0,0)::numeric,2),e.job_id,
 CASE WHEN e.job_id IS NULL THEN 'Unassigned work' ELSE coalesce(st.name,'Job')||' — '||public._client_name(j.client_id) END,e.notes
 FROM (SELECT te.id,te.user_id,te.started_at,te.ended_at,te.job_id,te.notes FROM public.time_entries te WHERE te.tenant_id=tid
 UNION ALL SELECT w.id,w.user_id,w.started_at,w.ended_at,w.job_id,w.description FROM public.work_clock_entries w WHERE w.tenant_id=tid AND w.kind='work') e
 LEFT JOIN public.profiles p ON p.id=e.user_id LEFT JOIN public.jobs j ON j.id=e.job_id LEFT JOIN public.service_types st ON st.id=j.service_type_id
 WHERE (e.started_at AT TIME ZONE 'America/Los_Angeles')::date BETWEEN _from AND _to ORDER BY p.full_name,e.started_at;
END $$;