CREATE OR REPLACE FUNCTION public.resync_employee_appointment_reminders(_user_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid;
  _link record;
  _n integer := 0;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT tenant_id INTO _tenant FROM public.profiles WHERE id = _caller;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'No tenant'; END IF;
  IF _user_ids IS NULL OR array_length(_user_ids, 1) IS NULL THEN RETURN 0; END IF;
  -- People may resync only themselves; owners/managers with team access may resync their team.
  IF NOT (_user_ids <@ ARRAY[_caller] OR public.has_employee_permission('can_manage_clients_employees')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  DELETE FROM public.notifications n
   WHERE n.tenant_id = _tenant
     AND n.template_name = 'appointment_reminder_employee'
     AND n.recipient_type = 'employee'
     AND n.recipient_id = ANY(_user_ids)
     AND n.status = 'pending'
     AND n.delivery_claimed_at IS NULL;

  FOR _link IN
    SELECT je.employee_id, j.id AS job_id, COALESCE(je.scheduled_start, j.scheduled_start) AS start_at
      FROM public.job_employees je
      JOIN public.jobs j ON j.id = je.job_id
      JOIN public.profiles p ON p.id = je.employee_id AND p.tenant_id = _tenant
     WHERE j.tenant_id = _tenant
       AND je.employee_id = ANY(_user_ids)
       AND j.status NOT IN ('canceled', 'completed')
       AND COALESCE(je.scheduled_start, j.scheduled_start) > now()
  LOOP
    PERFORM public._enqueue_employee_appointment_reminder(_tenant, _link.job_id, _link.employee_id, _link.start_at);
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;

REVOKE EXECUTE ON FUNCTION public.resync_employee_appointment_reminders(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resync_employee_appointment_reminders(uuid[]) TO authenticated;