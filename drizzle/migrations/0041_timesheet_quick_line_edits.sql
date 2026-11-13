-- Owner/manager one-step edits of a single timesheet line (one appointment visit).
-- Moves the paid clock edge with the line when they started/ended together, so a
-- forgotten clock-in/out is fixed with one change. Every change is audited.
CREATE OR REPLACE FUNCTION public.admin_quick_edit_visit(_visit uuid, _employee uuid, _expected jsonb, _job uuid, _arrived timestamptz, _left timestamptz, _reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  tid uuid := public.current_tenant_id();
  v public.job_visits%ROWTYPE;
  old_v jsonb; new_v jsonb; old_p jsonb; new_p jsonb;
  ref_start timestamptz; ref_end timestamptz;
  p_id uuid; p_src text; p_start timestamptz; p_end timestamptz; p_job uuid;
  new_start timestamptz; new_end timestamptz;
  edge interval := interval '2 minutes';
  vid uuid; result uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_owner_or_manager() THEN RAISE EXCEPTION 'Only owners and managers can correct timesheets'; END IF;
  PERFORM 1 FROM public.profiles WHERE id = _employee AND tenant_id = tid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;
  IF _arrived IS NULL THEN RAISE EXCEPTION 'Enter a clock-in time'; END IF;
  IF _left IS NOT NULL AND _left <= _arrived THEN RAISE EXCEPTION 'Clock-out must be after clock-in'; END IF;
  IF _left IS NOT NULL AND _left - _arrived > interval '24 hours' THEN RAISE EXCEPTION 'One line cannot be longer than 24 hours'; END IF;
  IF _job IS NULL OR NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = _job AND tenant_id = tid AND status <> 'canceled') THEN RAISE EXCEPTION 'Appointment not found'; END IF;

  IF _visit IS NOT NULL THEN
    SELECT * INTO v FROM public.job_visits WHERE id = _visit AND tenant_id = tid AND employee_id = _employee;
    IF v.id IS NULL THEN RAISE EXCEPTION 'This line was already removed. Close and reopen the timesheet'; END IF;
    IF v.job_id::text IS DISTINCT FROM (_expected->>'job_id')
       OR v.arrived_at IS DISTINCT FROM (_expected->>'arrived_at')::timestamptz
       OR v.left_at IS DISTINCT FROM (_expected->>'left_at')::timestamptz THEN
      RAISE EXCEPTION 'Timesheet changed since opening. Close and reopen before correcting';
    END IF;
    old_v := to_jsonb(v);
    ref_start := v.arrived_at; ref_end := v.left_at;
  ELSE
    ref_start := _arrived; ref_end := _left;
  END IF;

  IF EXISTS (SELECT 1 FROM public.job_visits o WHERE o.employee_id = _employee AND o.id IS DISTINCT FROM _visit
             AND (o.left_at IS NULL OR o.left_at > _arrived) AND (_left IS NULL OR o.arrived_at < _left)) THEN
    RAISE EXCEPTION 'These times overlap another line for this cleaner. Delete the repeated line first';
  END IF;

  -- The paid clock interval that holds this line (the one containing its arrival), else any overlapping one.
  SELECT x.id, x.src, x.started_at, x.ended_at, x.job_id INTO p_id, p_src, p_start, p_end, p_job FROM (
    SELECT t.id, 'time' src, t.started_at, t.ended_at, t.job_id FROM public.time_entries t WHERE t.user_id = _employee AND t.tenant_id = tid
    UNION ALL
    SELECT w.id, 'clock', w.started_at, w.ended_at, w.job_id FROM public.work_clock_entries w WHERE w.user_id = _employee AND w.tenant_id = tid AND w.kind = 'work' AND w.activity_type = 'work'
  ) x
  WHERE x.started_at <= ref_start + edge AND (x.ended_at IS NULL OR x.ended_at >= ref_start)
  ORDER BY x.started_at DESC LIMIT 1;
  IF p_id IS NULL THEN
    SELECT x.id, x.src, x.started_at, x.ended_at, x.job_id INTO p_id, p_src, p_start, p_end, p_job FROM (
      SELECT t.id, 'time' src, t.started_at, t.ended_at, t.job_id FROM public.time_entries t WHERE t.user_id = _employee AND t.tenant_id = tid
      UNION ALL
      SELECT w.id, 'clock', w.started_at, w.ended_at, w.job_id FROM public.work_clock_entries w WHERE w.user_id = _employee AND w.tenant_id = tid AND w.kind = 'work' AND w.activity_type = 'work'
    ) x
    WHERE (x.ended_at IS NULL OR x.ended_at > _arrived) AND (_left IS NULL OR x.started_at < _left)
    ORDER BY x.started_at LIMIT 1;
  END IF;

  -- Save the line itself.
  IF _visit IS NOT NULL THEN
    UPDATE public.job_visits SET job_id = _job, arrived_at = _arrived, left_at = _left WHERE id = _visit RETURNING * INTO v;
  ELSE
    INSERT INTO public.job_visits(tenant_id, job_id, employee_id, arrived_at, left_at) VALUES (tid, _job, _employee, _arrived, _left) RETURNING * INTO v;
  END IF;
  vid := v.id; new_v := to_jsonb(v);

  IF p_id IS NULL THEN
    INSERT INTO public.time_entries(tenant_id, user_id, job_id, started_at, ended_at) VALUES (tid, _employee, _job, _arrived, _left) RETURNING to_jsonb(time_entries.*) INTO new_p;
  ELSE
    IF p_src = 'time' THEN SELECT to_jsonb(t) INTO old_p FROM public.time_entries t WHERE t.id = p_id;
    ELSE SELECT to_jsonb(w) INTO old_p FROM public.work_clock_entries w WHERE w.id = p_id; END IF;
    new_start := p_start; new_end := p_end;
    -- Clock-in edge.
    IF _arrived < p_start THEN new_start := _arrived;
    ELSIF old_v IS NOT NULL AND p_start BETWEEN (old_v->>'arrived_at')::timestamptz - edge AND (old_v->>'arrived_at')::timestamptz + edge
      AND NOT EXISTS (SELECT 1 FROM public.job_visits o WHERE o.employee_id = _employee AND o.id <> vid AND o.arrived_at < _arrived AND (o.left_at IS NULL OR o.left_at > p_start)) THEN
      new_start := _arrived;
    END IF;
    -- Clock-out edge.
    IF _left IS NULL THEN
      IF p_end IS NOT NULL THEN RAISE EXCEPTION 'Enter a clock-out time'; END IF;
    ELSIF p_end IS NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.job_visits o WHERE o.employee_id = _employee AND o.id <> vid AND o.arrived_at >= _arrived) THEN new_end := _left; END IF;
    ELSIF _left > p_end THEN new_end := _left;
    ELSIF old_v IS NOT NULL AND old_v->>'left_at' IS NOT NULL
      AND p_end BETWEEN (old_v->>'left_at')::timestamptz - edge AND (old_v->>'left_at')::timestamptz + edge
      AND NOT EXISTS (SELECT 1 FROM public.job_visits o WHERE o.employee_id = _employee AND o.id <> vid AND o.arrived_at < p_end AND (o.left_at IS NULL OR o.left_at > _left)) THEN
      new_end := _left;
    END IF;
    IF p_src = 'time' THEN
      UPDATE public.time_entries SET started_at = new_start, ended_at = new_end,
        job_id = CASE WHEN old_v IS NOT NULL AND p_job::text = old_v->>'job_id'
                       AND NOT EXISTS (SELECT 1 FROM public.job_visits o WHERE o.employee_id = _employee AND o.id <> vid AND o.job_id = p_job AND o.arrived_at < coalesce(new_end, 'infinity') AND (o.left_at IS NULL OR o.left_at > new_start))
                      THEN _job ELSE p_job END
      WHERE id = p_id RETURNING to_jsonb(time_entries.*) INTO new_p;
    ELSE
      UPDATE public.work_clock_entries SET started_at = new_start, ended_at = new_end WHERE id = p_id RETURNING to_jsonb(work_clock_entries.*) INTO new_p;
    END IF;
  END IF;

  -- Paid time must hold the whole line.
  IF NOT EXISTS (
    SELECT 1 FROM public.time_entries t WHERE t.user_id = _employee AND t.started_at <= _arrived AND (t.ended_at IS NULL OR (_left IS NOT NULL AND t.ended_at >= _left))
    UNION ALL
    SELECT 1 FROM public.work_clock_entries w WHERE w.user_id = _employee AND w.kind = 'work' AND w.activity_type = 'work' AND w.started_at <= _arrived AND (w.ended_at IS NULL OR (_left IS NOT NULL AND w.ended_at >= _left))
  ) THEN
    RAISE EXCEPTION 'Paid clock time cannot cover these times (lunch or another clock record is in the way). Use More corrections';
  END IF;

  UPDATE public.attendance_corrections SET status = 'worked', updated_by = auth.uid(), updated_at = now()
   WHERE job_id = _job AND employee_id = _employee AND tenant_id = tid AND status <> 'worked';

  INSERT INTO public.timesheet_correction_history(tenant_id, employee_id, job_id, editor_id, reason, original_values, corrected_values)
  VALUES (tid, _employee, _job, auth.uid(), coalesce(btrim(_reason), ''),
          jsonb_build_object('action', 'quick_edit', 'visit', old_v, 'paid', old_p),
          jsonb_build_object('action', 'quick_edit', 'visit', new_v, 'paid', new_p))
  RETURNING id INTO result;
  RETURN result;
END $function$;

-- Remove one timesheet line (e.g. a repeated tap). Paid time is removed only when that
-- clock interval belonged to this line alone; otherwise paid hours are unchanged.
CREATE OR REPLACE FUNCTION public.admin_delete_visit(_visit uuid, _expected jsonb, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  tid uuid := public.current_tenant_id();
  v public.job_visits%ROWTYPE;
  edge interval := interval '2 minutes';
  p public.time_entries%ROWTYPE;
  removed jsonb; result uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_owner_or_manager() THEN RAISE EXCEPTION 'Only owners and managers can correct timesheets'; END IF;
  SELECT * INTO v FROM public.job_visits WHERE id = _visit AND tenant_id = tid;
  IF v.id IS NULL THEN RAISE EXCEPTION 'This line was already removed. Close and reopen the timesheet'; END IF;
  PERFORM 1 FROM public.profiles WHERE id = v.employee_id FOR UPDATE;
  SELECT * INTO v FROM public.job_visits WHERE id = _visit;
  IF v.job_id::text IS DISTINCT FROM (_expected->>'job_id')
     OR v.arrived_at IS DISTINCT FROM (_expected->>'arrived_at')::timestamptz
     OR v.left_at IS DISTINCT FROM (_expected->>'left_at')::timestamptz THEN
    RAISE EXCEPTION 'Timesheet changed since opening. Close and reopen before correcting';
  END IF;

  SELECT * INTO p FROM public.time_entries t
   WHERE t.user_id = v.employee_id AND t.tenant_id = tid
     AND t.started_at <= v.arrived_at + edge AND (t.ended_at IS NULL OR t.ended_at >= v.arrived_at)
   ORDER BY t.started_at DESC LIMIT 1;

  DELETE FROM public.job_visits WHERE id = _visit;

  IF p.id IS NOT NULL
     AND p.started_at BETWEEN v.arrived_at - edge AND v.arrived_at + edge
     AND ((p.ended_at IS NULL AND v.left_at IS NULL) OR (p.ended_at IS NOT NULL AND v.left_at IS NOT NULL AND p.ended_at BETWEEN v.left_at - edge AND v.left_at + edge))
     AND NOT EXISTS (SELECT 1 FROM public.job_visits o WHERE o.employee_id = v.employee_id AND o.arrived_at < coalesce(p.ended_at, 'infinity') AND (o.left_at IS NULL OR o.left_at > p.started_at)) THEN
    removed := to_jsonb(p);
    DELETE FROM public.time_entries WHERE id = p.id;
  END IF;

  INSERT INTO public.timesheet_correction_history(tenant_id, employee_id, job_id, editor_id, reason, original_values, corrected_values)
  VALUES (tid, v.employee_id, v.job_id, auth.uid(), coalesce(btrim(_reason), ''),
          jsonb_build_object('action', 'delete_line', 'visit', to_jsonb(v), 'paid', removed),
          jsonb_build_object('action', 'delete_line', 'visit', NULL, 'paid_removed', removed IS NOT NULL))
  RETURNING id INTO result;
  RETURN jsonb_build_object('id', result, 'paid_removed', removed IS NOT NULL);
END $function$;

REVOKE ALL ON FUNCTION public.admin_quick_edit_visit(uuid, uuid, jsonb, uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_delete_visit(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_quick_edit_visit(uuid, uuid, jsonb, uuid, timestamptz, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_visit(uuid, jsonb, text) TO authenticated;