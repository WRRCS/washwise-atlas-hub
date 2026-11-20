DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT j.id AS job_id, j.published_at, je.employee_id
      FROM public.jobs j
      JOIN public.job_employees je ON je.job_id = j.id
      JOIN public.profiles p ON p.id = je.employee_id AND p.tenant_id = j.tenant_id AND p.is_active = false
     WHERE j.status = 'scheduled'
       AND j.scheduled_start > now()
       AND NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = je.employee_id AND ur.role = 'owner')
       AND NOT EXISTS (SELECT 1 FROM public.job_visits v WHERE v.job_id = j.id AND v.employee_id = je.employee_id)
       AND NOT EXISTS (SELECT 1 FROM public.time_entries te WHERE te.job_id = j.id AND te.user_id = je.employee_id)
       AND NOT EXISTS (SELECT 1 FROM public.job_photos ph WHERE ph.job_id = j.id AND ph.uploaded_by = je.employee_id)
       AND NOT EXISTS (SELECT 1 FROM public.job_sop_confirmations c WHERE c.job_id = j.id AND c.employee_id = je.employee_id)
       AND NOT EXISTS (SELECT 1 FROM public.job_sop_items s WHERE s.job_id = j.id AND s.employee_id = je.employee_id AND s.completed)
  LOOP
    DELETE FROM public.job_employees WHERE job_id = r.job_id AND employee_id = r.employee_id;
    DELETE FROM public.job_sop_items WHERE job_id = r.job_id AND employee_id = r.employee_id AND completed = false;
    UPDATE public.jobs SET
      open_spots = LEAST(open_spots + 1, 20),
      assigned_to = CASE WHEN assigned_to = r.employee_id
        THEN (SELECT x.employee_id FROM public.job_employees x WHERE x.job_id = r.job_id ORDER BY x.created_at LIMIT 1)
        ELSE assigned_to END,
      published_at = r.published_at
    WHERE id = r.job_id;
  END LOOP;
END $$;