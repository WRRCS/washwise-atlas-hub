CREATE OR REPLACE FUNCTION public.release_time_off_to_open_shifts(_employee uuid, _jobs uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := public.current_tenant_id(); n integer := 0; r record;
BEGIN
  IF auth.uid() IS NULL OR t IS NULL OR NOT public.is_owner_or_manager() THEN
    RAISE EXCEPTION 'Only owners and managers can move cleanings to open shifts';
  END IF;
  FOR r IN
    SELECT j.id, j.published_at FROM public.jobs j
      JOIN public.job_employees je ON je.job_id = j.id AND je.employee_id = _employee
     WHERE j.tenant_id = t AND j.id = ANY(_jobs) AND j.status = 'scheduled' AND j.scheduled_start > now()
       AND NOT EXISTS (SELECT 1 FROM public.job_visits v WHERE v.job_id = j.id AND v.employee_id = _employee)
       AND NOT EXISTS (SELECT 1 FROM public.time_entries te WHERE te.job_id = j.id AND te.user_id = _employee)
       AND NOT EXISTS (SELECT 1 FROM public.job_photos p WHERE p.job_id = j.id AND p.uploaded_by = _employee)
       AND NOT EXISTS (SELECT 1 FROM public.job_sop_confirmations c WHERE c.job_id = j.id AND c.employee_id = _employee)
     FOR UPDATE OF j
  LOOP
    DELETE FROM public.job_employees WHERE job_id = r.id AND employee_id = _employee;
    DELETE FROM public.job_sop_items WHERE job_id = r.id AND employee_id = _employee AND completed = false;
    UPDATE public.jobs SET open_spots = LEAST(open_spots + 1, 20),
      assigned_to = CASE WHEN assigned_to = _employee
        THEN (SELECT x.employee_id FROM public.job_employees x WHERE x.job_id = r.id ORDER BY x.created_at LIMIT 1)
        ELSE assigned_to END,
      published_at = r.published_at
    WHERE id = r.id;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.release_time_off_to_open_shifts(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_time_off_to_open_shifts(uuid, uuid[]) TO authenticated;