ALTER TABLE public.work_clock_entries ADD COLUMN IF NOT EXISTS activity_type text NOT NULL DEFAULT 'work';
CREATE TABLE IF NOT EXISTS public.attendance_corrections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id), job_id uuid NOT NULL REFERENCES public.jobs(id), employee_id uuid NOT NULL REFERENCES public.profiles(id), status text NOT NULL CHECK(status IN ('worked','no_show','missing_punch')), updated_by uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(job_id,employee_id)
);
GRANT SELECT ON public.attendance_corrections TO authenticated;
GRANT ALL ON public.attendance_corrections TO service_role;
ALTER TABLE public.attendance_corrections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_read ON public.attendance_corrections;
CREATE POLICY attendance_read ON public.attendance_corrections FOR SELECT TO authenticated USING(tenant_id=public.current_tenant_id() AND (employee_id=auth.uid() OR public.is_owner_or_manager()));
CREATE TABLE IF NOT EXISTS public.timesheet_correction_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id), employee_id uuid NOT NULL REFERENCES public.profiles(id), job_id uuid REFERENCES public.jobs(id), editor_id uuid NOT NULL, corrected_at timestamptz NOT NULL DEFAULT now(), reason text NOT NULL, original_values jsonb NOT NULL, corrected_values jsonb NOT NULL
);
GRANT SELECT ON public.timesheet_correction_history TO authenticated;
GRANT ALL ON public.timesheet_correction_history TO service_role;
ALTER TABLE public.timesheet_correction_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS correction_history_read ON public.timesheet_correction_history;
CREATE POLICY correction_history_read ON public.timesheet_correction_history FOR SELECT TO authenticated USING(tenant_id=public.current_tenant_id() AND public.is_owner_or_manager());
CREATE OR REPLACE FUNCTION public.admin_correct_timesheet(_employee uuid,_job uuid,_from timestamptz,_to timestamptz,_original jsonb,_records jsonb,_visits jsonb,_status text,_reason text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE tid uuid:=public.current_tenant_id(); current_records jsonb; current_visits jsonb; current_attendance jsonb; original_all jsonb; corrected_all jsonb; item jsonb; old_record jsonb; rid uuid; st timestamptz; en timestamptz; jid uuid; kind_value text; source_value text; result uuid; temp_time public.time_entries%ROWTYPE; temp_clock public.work_clock_entries%ROWTYPE; temp_visit public.job_visits%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_owner_or_manager() THEN RAISE EXCEPTION 'Only owners and managers can correct timesheets'; END IF;
 IF length(btrim(coalesce(_reason,'')))<3 THEN RAISE EXCEPTION 'Enter a correction reason'; END IF;
 IF _from IS NULL OR _to IS NULL OR _to<=_from THEN RAISE EXCEPTION 'Invalid review date window'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=_employee AND tenant_id=tid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;
 IF _job IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.jobs WHERE id=_job AND tenant_id=tid) THEN RAISE EXCEPTION 'Appointment not found'; END IF;
 SELECT coalesce(jsonb_agg(r ORDER BY r->>'source',r->>'id'),'[]'::jsonb) INTO current_records FROM (
 SELECT to_jsonb(t)||jsonb_build_object('source','time') r FROM public.time_entries t WHERE t.tenant_id=tid AND t.user_id=_employee AND t.started_at<_to AND (t.ended_at IS NULL OR t.ended_at>_from)
 UNION ALL SELECT to_jsonb(w)||jsonb_build_object('source','clock') FROM public.work_clock_entries w WHERE w.tenant_id=tid AND w.user_id=_employee AND w.started_at<_to AND (w.ended_at IS NULL OR w.ended_at>_from)
 ) records;
 SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.id),'[]'::jsonb) INTO current_visits FROM public.job_visits v WHERE v.tenant_id=tid AND v.employee_id=_employee AND v.job_id=_job AND v.arrived_at<_to AND (v.left_at IS NULL OR v.left_at>_from);
 SELECT to_jsonb(a) INTO current_attendance FROM public.attendance_corrections a WHERE a.job_id=_job AND a.employee_id=_employee AND a.tenant_id=tid;
 original_all:=jsonb_build_object('records',current_records,'visits',current_visits,'attendance',current_attendance);
 IF original_all IS DISTINCT FROM _original THEN RAISE EXCEPTION 'Timesheet changed since opening. Close and reopen before correcting'; END IF;
 IF jsonb_typeof(_records)<>'array' OR jsonb_typeof(_visits)<>'array' OR jsonb_array_length(_records)>100 OR jsonb_array_length(_visits)>50 THEN RAISE EXCEPTION 'Invalid interval collection'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(_records) r GROUP BY r->>'id' HAVING count(*)>1) OR EXISTS(SELECT 1 FROM jsonb_array_elements(_visits) r GROUP BY r->>'id' HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate interval identifiers'; END IF;
 IF _status NOT IN ('worked','no_show','missing_punch') THEN RAISE EXCEPTION 'Select attendance status'; END IF;
 -- Delete only the reviewed records inside this transaction; preserve their full rows when reinserted below.
 DELETE FROM public.time_entries WHERE id IN (SELECT (r->>'id')::uuid FROM jsonb_array_elements(current_records) r WHERE r->>'source'='time');
 DELETE FROM public.work_clock_entries WHERE id IN (SELECT (r->>'id')::uuid FROM jsonb_array_elements(current_records) r WHERE r->>'source'='clock');
 DELETE FROM public.job_visits WHERE id IN (SELECT (r->>'id')::uuid FROM jsonb_array_elements(current_visits) r);
 FOR item IN SELECT value FROM jsonb_array_elements(_records) LOOP
  rid:=(item->>'id')::uuid; st:=(item->>'started_at')::timestamptz; en:=(item->>'ended_at')::timestamptz; jid:=(item->>'job_id')::uuid; kind_value:=item->>'kind'; source_value:=item->>'source';
  IF st IS NULL OR (en IS NOT NULL AND en<=st) THEN RAISE EXCEPTION 'End time must be after start time'; END IF;
  IF kind_value NOT IN ('work','drive','lunch') OR source_value NOT IN ('time','clock') THEN RAISE EXCEPTION 'Invalid interval type'; END IF;
  IF jid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.jobs WHERE id=jid AND tenant_id=tid) THEN RAISE EXCEPTION 'Appointment not found'; END IF;
  IF _status='no_show' AND _job IS NOT NULL AND jid=_job AND kind_value<>'lunch' THEN RAISE EXCEPTION 'Confirmed no-show cannot contain work or drive hours for this appointment'; END IF;
  SELECT r INTO old_record FROM jsonb_array_elements(current_records) r WHERE r->>'id'=rid::text AND r->>'source'=source_value;
  IF old_record IS NULL AND (EXISTS(SELECT 1 FROM public.time_entries WHERE id=rid) OR EXISTS(SELECT 1 FROM public.work_clock_entries WHERE id=rid)) THEN RAISE EXCEPTION 'Interval identifier belongs to another record'; END IF;
  IF source_value='time' THEN
   IF jid IS NULL OR kind_value<>'work' THEN RAISE EXCEPTION 'Scheduled clock records require a job and work type; use an unscheduled interval for other work'; END IF;
   IF old_record IS NULL THEN
    INSERT INTO public.time_entries(id,tenant_id,user_id,job_id,started_at,ended_at,notes) VALUES(rid,tid,_employee,jid,st,en,item->>'description');
   ELSE
    temp_time:=jsonb_populate_record(NULL::public.time_entries,old_record); temp_time.started_at:=st;temp_time.ended_at:=en;temp_time.job_id:=jid;temp_time.notes:=item->>'description'; INSERT INTO public.time_entries SELECT(temp_time).*;
   END IF;
  ELSE
   IF length(btrim(coalesce(item->>'description','')))<3 THEN RAISE EXCEPTION 'Enter a short work or lunch description'; END IF;
   IF old_record IS NULL THEN
    INSERT INTO public.work_clock_entries(id,tenant_id,user_id,kind,activity_type,description,job_id,started_at,ended_at) VALUES(rid,tid,_employee,CASE WHEN kind_value='lunch' THEN 'lunch' ELSE 'work' END,CASE WHEN kind_value='drive' THEN 'drive' ELSE 'work' END,item->>'description',jid,st,en);
   ELSE
    temp_clock:=jsonb_populate_record(NULL::public.work_clock_entries,old_record);temp_clock.started_at:=st;temp_clock.ended_at:=en;temp_clock.job_id:=jid;temp_clock.kind:=CASE WHEN kind_value='lunch' THEN 'lunch' ELSE 'work' END;temp_clock.activity_type:=CASE WHEN kind_value='drive' THEN 'drive' ELSE 'work' END;temp_clock.description:=item->>'description';INSERT INTO public.work_clock_entries SELECT(temp_clock).*;
   END IF;
  END IF;
 END LOOP;
 IF _job IS NULL AND jsonb_array_length(_visits)>0 THEN RAISE EXCEPTION 'Select an appointment for arrival intervals'; END IF;
 IF _status='no_show' AND jsonb_array_length(_visits)>0 THEN RAISE EXCEPTION 'Confirmed no-show cannot contain arrival intervals'; END IF;
 IF _job IS NOT NULL AND _status='worked' AND jsonb_array_length(_visits)=0 THEN RAISE EXCEPTION 'Enter actual arrival times or choose missing punch'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(_visits) LOOP
  rid:=(item->>'id')::uuid; st:=(item->>'arrived_at')::timestamptz;en:=(item->>'left_at')::timestamptz;
  IF st IS NULL OR (en IS NOT NULL AND en<=st) THEN RAISE EXCEPTION 'Leave time must be after arrival'; END IF;
  IF EXISTS(SELECT 1 FROM public.job_visits WHERE id=rid OR (employee_id=_employee AND (left_at IS NULL OR left_at>st) AND (en IS NULL OR arrived_at<en))) THEN RAISE EXCEPTION 'Arrival intervals overlap another visit'; END IF;
  SELECT r INTO old_record FROM jsonb_array_elements(current_visits) r WHERE r->>'id'=rid::text;
  IF old_record IS NULL THEN INSERT INTO public.job_visits(id,tenant_id,employee_id,job_id,arrived_at,left_at) VALUES(rid,tid,_employee,_job,st,en);
  ELSE temp_visit:=jsonb_populate_record(NULL::public.job_visits,old_record);temp_visit.arrived_at:=st;temp_visit.left_at:=en;INSERT INTO public.job_visits SELECT(temp_visit).*; END IF;
 END LOOP;
 -- Paid time and arrival are distinct views, never two additions to pay. Ensure recorded work covers visits.
 IF EXISTS(SELECT 1 FROM public.job_visits v WHERE v.tenant_id=tid AND v.employee_id=_employee AND v.job_id=_job AND v.arrived_at<_to AND (v.left_at IS NULL OR v.left_at>_from) AND NOT EXISTS(
 SELECT 1 FROM public.time_entries t WHERE t.user_id=_employee AND t.started_at<=v.arrived_at AND (t.ended_at IS NULL OR (v.left_at IS NOT NULL AND t.ended_at>=v.left_at))
 UNION ALL SELECT 1 FROM public.work_clock_entries w WHERE w.user_id=_employee AND w.kind='work' AND w.activity_type='work' AND w.started_at<=v.arrived_at AND (w.ended_at IS NULL OR (v.left_at IS NOT NULL AND w.ended_at>=v.left_at))
 )) THEN RAISE EXCEPTION 'Each arrival interval must be covered by a paid work interval; split work and arrival around lunch'; END IF;
 IF _job IS NOT NULL THEN INSERT INTO public.attendance_corrections(tenant_id,job_id,employee_id,status,updated_by) VALUES(tid,_job,_employee,_status,auth.uid()) ON CONFLICT(job_id,employee_id) DO UPDATE SET status=excluded.status,updated_by=excluded.updated_by,updated_at=now(); END IF;
 corrected_all:=jsonb_build_object('records',_records,'visits',_visits,'status',_status);
 INSERT INTO public.timesheet_correction_history(tenant_id,employee_id,job_id,editor_id,reason,original_values,corrected_values) VALUES(tid,_employee,_job,auth.uid(),btrim(_reason),original_all,corrected_all) RETURNING id INTO result;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_correct_timesheet(uuid,uuid,timestamptz,timestamptz,jsonb,jsonb,jsonb,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_correct_timesheet(uuid,uuid,timestamptz,timestamptz,jsonb,jsonb,jsonb,text,text) TO authenticated;