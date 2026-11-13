-- Owner/manager timesheet line edit to ANY client location. Reuses that location's
-- appointment on the line's day when one exists; otherwise creates one for the
-- clocked times assigned to the cleaner. Creation and the edit commit together.
CREATE OR REPLACE FUNCTION public.admin_quick_edit_visit_at_place(_visit uuid, _employee uuid, _expected jsonb, _client uuid, _property uuid, _arrived timestamptz, _left timestamptz, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  tid uuid := public.current_tenant_id();
  tz text;
  day_start timestamptz; day_end timestamptz;
  c public.clients%ROWTYPE;
  p public.client_properties%ROWTYPE;
  job uuid; svc uuid; steps jsonb; price integer;
  addr text; lbl text;
  created boolean := false;
  vid uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_owner_or_manager() THEN RAISE EXCEPTION 'Only owners and managers can correct timesheets'; END IF;
  IF _arrived IS NULL THEN RAISE EXCEPTION 'Enter a clock-in time'; END IF;
  SELECT * INTO c FROM public.clients WHERE id = _client AND tenant_id = tid;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Client not found'; END IF;
  IF _property IS NOT NULL THEN
    SELECT * INTO p FROM public.client_properties WHERE id = _property AND client_id = _client AND tenant_id = tid;
    IF p.id IS NULL THEN RAISE EXCEPTION 'Select a property belonging to this client'; END IF;
  END IF;

  SELECT COALESCE(NULLIF(timezone, ''), 'America/Los_Angeles') INTO tz FROM public.tenants WHERE id = tid;
  day_start := ((_arrived AT TIME ZONE tz)::date)::timestamp AT TIME ZONE tz;
  day_end := (((_arrived AT TIME ZONE tz)::date) + 1)::timestamp AT TIME ZONE tz;

  SELECT j.id INTO job FROM public.jobs j
   WHERE j.tenant_id = tid AND j.client_id = _client AND j.property_id IS NOT DISTINCT FROM _property
     AND j.status <> 'canceled' AND j.scheduled_start >= day_start AND j.scheduled_start < day_end
   ORDER BY abs(extract(epoch FROM j.scheduled_start - _arrived)) LIMIT 1;

  IF job IS NULL THEN
    addr := COALESCE(NULLIF(btrim(p.address), ''), NULLIF(btrim(c.service_address), ''));
    lbl := CASE WHEN p.id IS NOT NULL THEN p.label END;
    IF addr IS NULL THEN RAISE EXCEPTION 'This client has no service address yet. Add one on the client page first'; END IF;
    svc := p.default_service_type_id;
    IF svc IS NULL THEN
      SELECT j.service_type_id INTO svc FROM public.jobs j
       WHERE j.tenant_id = tid AND j.client_id = _client AND (_property IS NULL OR j.property_id = _property)
       ORDER BY j.scheduled_start DESC LIMIT 1;
    END IF;
    IF svc IS NULL THEN
      SELECT s.id INTO svc FROM public.service_types s WHERE s.tenant_id = tid AND s.active
       ORDER BY (s.kind = 'residential') DESC, s.name LIMIT 1;
    END IF;
    IF svc IS NULL THEN RAISE EXCEPTION 'Add a service type before adding appointments'; END IF;
    SELECT s.sop_steps, s.default_price_cents INTO steps, price FROM public.service_types s WHERE s.id = svc;
    price := COALESCE(p.price_cents, price, 0);

    INSERT INTO public.jobs(tenant_id, client_id, property_id, service_address, service_location_label, service_type_id,
                            scheduled_start, scheduled_end, assigned_to, price_cents, published_at, notes)
    VALUES (tid, _client, _property, addr, lbl, svc, _arrived, COALESCE(_left, _arrived + interval '2 hours'),
            _employee, price, now(), 'Added from the timesheet')
    RETURNING id INTO job;
    INSERT INTO public.job_employees(tenant_id, job_id, employee_id) VALUES (tid, job, _employee);
    IF jsonb_typeof(steps) = 'array' THEN
      INSERT INTO public.job_sop_items(tenant_id, job_id, position, label)
      SELECT tid, job, (e.ord - 1)::int, e.val FROM jsonb_array_elements_text(steps) WITH ORDINALITY AS e(val, ord);
    END IF;
    created := true;
  END IF;

  vid := public.admin_quick_edit_visit(_visit, _employee, _expected, job, _arrived, _left, _reason);
  RETURN jsonb_build_object('visit_id', vid, 'job_id', job, 'created', created);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_quick_edit_visit_at_place(uuid, uuid, jsonb, uuid, uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_quick_edit_visit_at_place(uuid, uuid, jsonb, uuid, uuid, timestamptz, timestamptz, text) TO authenticated;