ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS open_spots smallint NOT NULL DEFAULT 0;
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_open_spots_range;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_open_spots_range CHECK (open_spots BETWEEN 0 AND 20);

-- Take an archived team member off their upcoming cleanings and open a spot on each.
CREATE OR REPLACE FUNCTION public.release_staff_to_open_shifts(_employee uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t uuid := public.current_tenant_id();
  n integer := 0;
  r record;
BEGIN
  IF auth.uid() IS NULL OR t IS NULL
     OR NOT (public.is_owner_or_manager() OR public.has_employee_permission('can_manage_clients_employees')) THEN
    RAISE EXCEPTION 'Only owners and managers can move cleanings to open shifts';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _employee AND tenant_id = t AND is_active = false) THEN
    RAISE EXCEPTION 'Archive this team member first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _employee AND role = 'owner') THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT j.id, j.published_at
      FROM public.jobs j
      JOIN public.job_employees je ON je.job_id = j.id AND je.employee_id = _employee
     WHERE j.tenant_id = t
       AND j.status = 'scheduled'
       AND j.scheduled_start > now()
       AND NOT EXISTS (SELECT 1 FROM public.job_visits v WHERE v.job_id = j.id AND v.employee_id = _employee)
       AND NOT EXISTS (SELECT 1 FROM public.time_entries te WHERE te.job_id = j.id AND te.user_id = _employee)
       AND NOT EXISTS (SELECT 1 FROM public.job_photos p WHERE p.job_id = j.id AND p.uploaded_by = _employee)
       AND NOT EXISTS (SELECT 1 FROM public.job_sop_confirmations c WHERE c.job_id = j.id AND c.employee_id = _employee)
       AND NOT EXISTS (SELECT 1 FROM public.job_sop_items s WHERE s.job_id = j.id AND s.employee_id = _employee AND s.completed)
     FOR UPDATE OF j
  LOOP
    DELETE FROM public.job_employees WHERE job_id = r.id AND employee_id = _employee;
    DELETE FROM public.job_sop_items WHERE job_id = r.id AND employee_id = _employee AND completed = false;
    -- Removing a cleaner normally hides a published cleaning; here it stays
    -- exactly as visible as before so the team can pick the spot up.
    UPDATE public.jobs SET
      open_spots = LEAST(open_spots + 1, 20),
      assigned_to = CASE WHEN assigned_to = _employee
        THEN (SELECT x.employee_id FROM public.job_employees x WHERE x.job_id = r.id ORDER BY x.created_at LIMIT 1)
        ELSE assigned_to END,
      published_at = r.published_at
    WHERE id = r.id;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- Pick up an open cleaning (fully open, or an open spot on a shared one).
CREATE OR REPLACE FUNCTION public.claim_open_shift(_job uuid, _employee uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t uuid := public.current_tenant_id();
  mgr boolean := public.is_owner_or_manager();
  j record;
  crew integer;
BEGIN
  IF auth.uid() IS NULL OR t IS NULL THEN RAISE EXCEPTION 'Please sign in'; END IF;
  IF NOT mgr AND _employee IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'You can only pick up shifts for yourself';
  END IF;
  SELECT id, tenant_id, assigned_to, status, open_spots, published_at
    INTO j FROM public.jobs WHERE id = _job FOR UPDATE;
  IF NOT FOUND OR j.tenant_id <> t OR j.status NOT IN ('scheduled', 'in_progress')
     OR (NOT mgr AND j.published_at IS NULL) THEN
    RAISE EXCEPTION 'Shift not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _employee AND tenant_id = t AND is_active IS DISTINCT FROM false) THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;
  IF EXISTS (SELECT 1 FROM public.job_employees WHERE job_id = _job AND employee_id = _employee) THEN
    RAISE EXCEPTION 'Already on this cleaning';
  END IF;
  SELECT count(*) INTO crew FROM public.job_employees WHERE job_id = _job;
  IF j.open_spots <= 0 AND (crew > 0 OR j.assigned_to IS NOT NULL) THEN
    RAISE EXCEPTION 'Someone already has this shift';
  END IF;

  INSERT INTO public.job_employees (job_id, employee_id, tenant_id) VALUES (_job, _employee, t);
  UPDATE public.jobs SET
    open_spots = GREATEST(open_spots - 1, 0),
    assigned_to = COALESCE(assigned_to, _employee),
    published_at = j.published_at
  WHERE id = _job;
END $$;

REVOKE ALL ON FUNCTION public.release_staff_to_open_shifts(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_open_shift(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_staff_to_open_shifts(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_open_shift(uuid, uuid) TO authenticated;