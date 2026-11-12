CREATE OR REPLACE FUNCTION public.record_job_arrival(_job uuid)
RETURNS public.job_visits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE uid uuid := auth.uid(); tid uuid; j public.jobs%ROWTYPE; v public.job_visits%ROWTYPE; stamp timestamptz := clock_timestamp();
BEGIN
  -- Serialize arrivals per employee so repeated or simultaneous taps record one visit.
  SELECT tenant_id INTO tid FROM public.profiles WHERE id = uid AND is_active FOR UPDATE;
  IF tid IS NULL THEN RAISE EXCEPTION 'You are not authorized for this appointment'; END IF;
  SELECT * INTO j FROM public.jobs WHERE id = _job;
  IF j.id IS NULL OR j.tenant_id <> tid OR j.status = 'canceled' OR NOT (
       public.is_owner_or_manager() OR j.assigned_to = uid
       OR EXISTS (SELECT 1 FROM public.job_employees je WHERE je.job_id = _job AND je.employee_id = uid)
     ) THEN
    RAISE EXCEPTION 'You are not authorized for this appointment';
  END IF;
  SELECT * INTO v FROM public.job_visits WHERE employee_id = uid AND job_id = _job AND left_at IS NULL ORDER BY arrived_at DESC LIMIT 1;
  IF v.id IS NOT NULL THEN RETURN v; END IF;
  UPDATE public.job_visits SET left_at = stamp WHERE employee_id = uid AND left_at IS NULL;
  INSERT INTO public.job_visits(tenant_id, job_id, employee_id, arrived_at) VALUES (tid, _job, uid, stamp) RETURNING * INTO v;
  RETURN v;
END $function$;

REVOKE ALL ON FUNCTION public.record_job_arrival(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_job_arrival(uuid) TO authenticated;