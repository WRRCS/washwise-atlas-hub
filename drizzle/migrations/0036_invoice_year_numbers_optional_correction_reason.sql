CREATE OR REPLACE FUNCTION public.admin_correct_timesheet(_employee uuid, _job uuid, _from timestamp with time zone, _to timestamp with time zone, _original jsonb, _records jsonb, _visits jsonb, _status text, _reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE tid uuid:=public.current_tenant_id(); current_records jsonb; current_visits jsonb; current_attendance jsonb; original_all jsonb; corrected_all jsonb; item jsonb; old_record jsonb; rid uuid; st timestamptz; en timestamptz; jid uuid; kind_value text; source_value text; result uuid; temp_time public.time_entries%ROWTYPE; temp_clock public.work_clock_entries%ROWTYPE; temp_visit public.job_visits%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_owner_or_manager() THEN RAISE EXCEPTION 'Only owners and managers can correct timesheets'; END IF;
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
 IF _records IS NULL OR _visits IS NULL OR jsonb_typeof(_records)<>'array' OR jsonb_typeof(_visits)<>'array' OR jsonb_array_length(_records)>100 OR jsonb_array_length(_visits)>50 THEN RAISE EXCEPTION 'Invalid interval collection'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(_records) r GROUP BY r->>'id' HAVING count(*)>1) OR EXISTS(SELECT 1 FROM jsonb_array_elements(_visits) r GROUP BY r->>'id' HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate interval identifiers'; END IF;
 IF _status IS NULL OR _status NOT IN ('worked','no_show','missing_punch') THEN RAISE EXCEPTION 'Select attendance status'; END IF;
 -- Delete only the reviewed records inside this transaction; preserve their full rows when reinserted below.
 DELETE FROM public.time_entries WHERE id IN (SELECT (r->>'id')::uuid FROM jsonb_array_elements(current_records) r WHERE r->>'source'='time');
 DELETE FROM public.work_clock_entries WHERE id IN (SELECT (r->>'id')::uuid FROM jsonb_array_elements(current_records) r WHERE r->>'source'='clock');
 DELETE FROM public.job_visits WHERE id IN (SELECT (r->>'id')::uuid FROM jsonb_array_elements(current_visits) r);
 FOR item IN SELECT value FROM jsonb_array_elements(_records) LOOP
  rid:=(item->>'id')::uuid; st:=(item->>'started_at')::timestamptz; en:=(item->>'ended_at')::timestamptz; jid:=(item->>'job_id')::uuid; kind_value:=item->>'kind'; source_value:=item->>'source';
  IF rid IS NULL OR st IS NULL OR (en IS NOT NULL AND en<=st) THEN RAISE EXCEPTION 'End time must be after start time'; END IF;
  IF rid IS NULL OR kind_value IS NULL OR source_value IS NULL OR kind_value NOT IN ('work','drive','lunch') OR source_value NOT IN ('time','clock') THEN RAISE EXCEPTION 'Invalid interval type'; END IF;
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
  IF rid IS NULL OR st IS NULL OR (en IS NOT NULL AND en<=st) THEN RAISE EXCEPTION 'Leave time must be after arrival'; END IF;
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
 INSERT INTO public.timesheet_correction_history(tenant_id,employee_id,job_id,editor_id,reason,original_values,corrected_values) VALUES(tid,_employee,_job,auth.uid(),coalesce(btrim(_reason),''),original_all,corrected_all) RETURNING id INTO result;
 RETURN result;
END;
$function$;

-- Invoice numbers are <invoice-date year>-<4+ digit sequence>, starting each year at 1001.
CREATE OR REPLACE FUNCTION public.next_invoice_number(_tenant uuid, _issue_date date)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _year text := EXTRACT(YEAR FROM COALESCE(_issue_date, (now() AT TIME ZONE 'America/Los_Angeles')::date))::int::text;
  _max int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('invoice-number:' || _tenant::text || ':' || _year));
  SELECT MAX(substring(number FROM length(_year) + 2)::int)
    INTO _max
    FROM public.invoices
   WHERE tenant_id = _tenant
     AND number ~ ('^' || _year || '-[0-9]{4,9}$');
  RETURN _year || '-' || (GREATEST(COALESCE(_max, 1000), 1000) + 1)::text;
END $function$;

CREATE OR REPLACE FUNCTION public.next_invoice_number(_tenant uuid)
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.next_invoice_number(_tenant, (now() AT TIME ZONE 'America/Los_Angeles')::date);
$function$;

REVOKE ALL ON FUNCTION public.next_invoice_number(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_invoice_number(uuid, date) TO authenticated, service_role;

COMMENT ON COLUMN public.tenants.invoice_prefix IS 'DEPRECATED: invoice numbers are now <invoice year>-<sequence from 1001>';
COMMENT ON COLUMN public.tenants.invoice_series IS 'DEPRECATED: invoice numbers are now <invoice year>-<sequence from 1001>';

CREATE OR REPLACE FUNCTION public.tg_auto_invoice_on_complete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _svc_name text; _invoice_id uuid; _number text; _svc_date date; _terms int;
  _monthly boolean; _month date; _sort int; _hourly boolean; _rate int; _unit int; _hrs numeric;
  _prop_label text; _prop_address text; _details text;
  _msg text; _terms_text text;
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    -- Duplicate guard: retried completion, reopen+recomplete, or a second cleaner
    -- finishing the same job must never create a second invoice.
    IF EXISTS (SELECT 1 FROM public.invoices WHERE job_id = NEW.id)
       OR EXISTS (SELECT 1 FROM public.invoice_line_items WHERE job_id = NEW.id) THEN
      RETURN NEW;
    END IF;
    SELECT name INTO _svc_name FROM public.service_types WHERE id = NEW.service_type_id;
    _svc_date := (NEW.scheduled_start AT TIME ZONE 'America/Los_Angeles')::date;
    SELECT COALESCE((SELECT c.payment_terms_days FROM public.clients c WHERE c.id = NEW.client_id),
             (SELECT t.payment_terms_days FROM public.tenants t WHERE t.id = NEW.tenant_id), 14) INTO _terms;
    SELECT COALESCE(c.bill_monthly, false) INTO _monthly FROM public.clients c WHERE c.id = NEW.client_id;
    SELECT t.invoice_message_default, t.invoice_terms_default INTO _msg, _terms_text
      FROM public.tenants t WHERE t.id = NEW.tenant_id;
    -- The appointment's selected property, not the client's default address.
    IF NEW.property_id IS NOT NULL THEN
      SELECT p.label, p.address INTO _prop_label, _prop_address
        FROM public.client_properties p
        WHERE p.id = NEW.property_id AND p.client_id = NEW.client_id AND p.tenant_id = NEW.tenant_id;
    END IF;
    _details := NULLIF(trim(both ' ' from
      concat_ws(' — ', NULLIF(COALESCE(_prop_label, ''), ''), NULLIF(replace(COALESCE(_prop_address, ''), E'\n', ', '), ''))), '');
    _hourly := COALESCE(NEW.price_cents, 0) = 0;
    SELECT COALESCE(hourly_rate_cents, 4500) INTO _rate FROM public.tenants WHERE id = NEW.tenant_id;
    _unit := CASE WHEN _hourly THEN COALESCE(_rate,4500) ELSE NEW.price_cents END;
    _hrs := CASE WHEN _hourly THEN 0 ELSE NULL END;

    IF _monthly THEN
      _month := date_trunc('month', _svc_date)::date;
      SELECT id INTO _invoice_id FROM public.invoices
        WHERE client_id = NEW.client_id AND bundle_month = _month AND status = 'draft' ORDER BY created_at LIMIT 1;
      IF _invoice_id IS NULL THEN
        _number := public.next_invoice_number(NEW.tenant_id, (_month + interval '1 month' - interval '1 day')::date);
        INSERT INTO public.invoices (tenant_id, client_id, job_id, number, status, amount_cents, subtotal_cents, surcharge_cents, total_cents,
          currency, issue_date, due_date, payment_terms_days, cleanings_count, bundle_month,
          subject, client_message, terms_text)
        VALUES (NEW.tenant_id, NEW.client_id, NULL, _number, 'draft', 0, 0, 0, 0, 'usd',
          (_month + interval '1 month' - interval '1 day')::date,
          (_month + interval '1 month' - interval '1 day' + (_terms || ' days')::interval)::date, _terms, 0, _month,
          'Monthly cleaning services', _msg, _terms_text)
        RETURNING id INTO _invoice_id;
      END IF;
      SELECT COALESCE(max(sort_order) + 1, 0) INTO _sort FROM public.invoice_line_items WHERE invoice_id = _invoice_id;
    ELSE
      _number := public.next_invoice_number(NEW.tenant_id, CURRENT_DATE);
      INSERT INTO public.invoices (tenant_id, client_id, job_id, number, status, amount_cents, subtotal_cents, surcharge_cents, total_cents,
        currency, issue_date, due_date, payment_terms_days,
        subject, property_id, client_message, terms_text)
      VALUES (NEW.tenant_id, NEW.client_id, NEW.id, _number, 'draft', 0, 0, 0, 0, 'usd',
        CURRENT_DATE, CURRENT_DATE + (_terms || ' days')::interval, _terms,
        COALESCE(_svc_name, 'For Services Rendered'), NEW.property_id, _msg, _terms_text)
      RETURNING id INTO _invoice_id;
      _sort := 0;
    END IF;

    INSERT INTO public.invoice_line_items (invoice_id, tenant_id, job_id, description, details, quantity, unit_price_cents, line_total_cents, service_date, sort_order, hours)
    VALUES (_invoice_id, NEW.tenant_id, NEW.id,
      COALESCE(_svc_name, 'Cleaning') || ' — ' || to_char(_svc_date, 'FMMonth FMDD, YYYY'),
      _details,
      1, _unit, CASE WHEN _hourly THEN 0 ELSE _unit END, _svc_date, _sort, _hrs);
    IF _hourly THEN PERFORM public.recalc_job_hours(NEW.id); END IF;
    PERFORM public.recalc_invoice_totals(_invoice_id);
    IF _monthly THEN
      UPDATE public.invoices SET cleanings_count = (SELECT count(*) FROM public.invoice_line_items WHERE invoice_id = _invoice_id) WHERE id = _invoice_id;
    END IF;
  END IF;
  RETURN NEW;
END $function$;