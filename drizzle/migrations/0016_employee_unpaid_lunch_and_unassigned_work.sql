CREATE TABLE public.work_clock_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id), user_id uuid NOT NULL REFERENCES public.profiles(id),
 kind text NOT NULL CHECK (kind IN ('work','lunch')), started_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz,
 description text NOT NULL, job_id uuid REFERENCES public.jobs(id), resume_job_id uuid REFERENCES public.jobs(id), resume_visit_job_id uuid REFERENCES public.jobs(id),
 CHECK (ended_at IS NULL OR ended_at >= started_at), CHECK (kind <> 'work' OR length(trim(description)) >= 3)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_clock_entries TO authenticated;
GRANT ALL ON public.work_clock_entries TO service_role;
ALTER TABLE public.work_clock_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY clock_read ON public.work_clock_entries FOR SELECT TO authenticated USING (tenant_id=public.current_tenant_id() AND (user_id=auth.uid() OR public.is_owner_or_manager()));
CREATE POLICY clock_own ON public.work_clock_entries FOR ALL TO authenticated USING (tenant_id=public.current_tenant_id() AND user_id=auth.uid() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_active)) WITH CHECK (tenant_id=public.current_tenant_id() AND user_id=auth.uid() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_active));
CREATE POLICY clock_manager ON public.work_clock_entries FOR ALL TO authenticated USING (tenant_id=public.current_tenant_id() AND public.is_owner_or_manager()) WITH CHECK (tenant_id=public.current_tenant_id() AND public.is_owner_or_manager());
CREATE POLICY time_manager_read ON public.time_entries FOR SELECT TO authenticated USING (tenant_id=public.current_tenant_id() AND public.is_owner_or_manager());
CREATE INDEX work_clock_user_start ON public.work_clock_entries(user_id,started_at);
CREATE OR REPLACE FUNCTION public.guard_employee_clock() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM 1 FROM public.profiles WHERE id=NEW.user_id FOR UPDATE;
 IF NEW.ended_at IS NOT NULL AND NEW.ended_at < NEW.started_at THEN RAISE EXCEPTION 'End time must be after start time'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=NEW.user_id AND tenant_id=NEW.tenant_id AND is_active) THEN RAISE EXCEPTION 'Employee is not authorized to clock in'; END IF;
 IF TG_TABLE_NAME='work_clock_entries' AND NEW.job_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.jobs WHERE id=NEW.job_id AND tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'Appointment not found'; END IF;
 IF EXISTS(SELECT 1 FROM public.time_entries e WHERE e.user_id=NEW.user_id AND NOT (TG_TABLE_NAME='time_entries' AND e.id=NEW.id) AND (e.ended_at IS NULL OR e.ended_at>NEW.started_at) AND (NEW.ended_at IS NULL OR e.started_at<NEW.ended_at)) OR EXISTS(SELECT 1 FROM public.work_clock_entries e WHERE e.user_id=NEW.user_id AND NOT (TG_TABLE_NAME='work_clock_entries' AND e.id=NEW.id) AND (e.ended_at IS NULL OR e.ended_at>NEW.started_at) AND (NEW.ended_at IS NULL OR e.started_at<NEW.ended_at)) THEN RAISE EXCEPTION 'Work, drive and unpaid lunch cannot overlap'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_time_clock BEFORE INSERT OR UPDATE OF started_at,ended_at,user_id ON public.time_entries FOR EACH ROW EXECUTE FUNCTION public.guard_employee_clock();
CREATE TRIGGER guard_work_clock BEFORE INSERT OR UPDATE ON public.work_clock_entries FOR EACH ROW EXECUTE FUNCTION public.guard_employee_clock();
CREATE OR REPLACE FUNCTION public.guard_visit_lunch() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM 1 FROM public.profiles WHERE id=NEW.employee_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.work_clock_entries e WHERE e.user_id=NEW.employee_id AND e.kind='lunch' AND (e.ended_at IS NULL OR e.ended_at>NEW.arrived_at) AND (NEW.left_at IS NULL OR e.started_at<NEW.left_at)) THEN RAISE EXCEPTION 'End unpaid lunch before recording work at an appointment'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_visit_lunch BEFORE INSERT OR UPDATE OF arrived_at,left_at ON public.job_visits FOR EACH ROW EXECUTE FUNCTION public.guard_visit_lunch();
CREATE OR REPLACE FUNCTION public.employee_clock_action(_action text, _description text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid:=auth.uid(); tid uuid; e public.time_entries%ROWTYPE; w public.work_clock_entries%ROWTYPE; v uuid; stamp timestamptz:=clock_timestamp(); result uuid;
BEGIN
 SELECT tenant_id INTO tid FROM public.profiles WHERE id=uid AND is_active FOR UPDATE;
 IF tid IS NULL OR NOT (public.has_role(uid,'employee') OR public.is_owner_or_manager()) THEN RAISE EXCEPTION 'Not authorized to clock in'; END IF;
 SELECT * INTO e FROM public.time_entries WHERE user_id=uid AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1;
 SELECT * INTO w FROM public.work_clock_entries WHERE user_id=uid AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1;
 IF _action='start_work' THEN
  IF e.id IS NOT NULL OR w.id IS NOT NULL THEN RAISE EXCEPTION 'You already have an active work or lunch session'; END IF;
  IF length(trim(coalesce(_description,'')))<3 THEN RAISE EXCEPTION 'Enter a short work description'; END IF;
  INSERT INTO public.work_clock_entries(tenant_id,user_id,kind,description,started_at) VALUES(tid,uid,'work',trim(_description),stamp) RETURNING id INTO result;
 ELSIF _action='start_lunch' THEN
  IF w.kind='lunch' THEN RAISE EXCEPTION 'You are already on unpaid lunch'; END IF;
  IF e.id IS NULL AND w.id IS NULL THEN RAISE EXCEPTION 'Clock in before starting unpaid lunch'; END IF;
  SELECT job_id INTO v FROM public.job_visits WHERE employee_id=uid AND left_at IS NULL ORDER BY arrived_at DESC LIMIT 1;
  UPDATE public.job_visits SET left_at=stamp WHERE employee_id=uid AND left_at IS NULL;
  UPDATE public.time_entries SET ended_at=stamp WHERE id=e.id;
  UPDATE public.work_clock_entries SET ended_at=stamp WHERE id=w.id;
  INSERT INTO public.work_clock_entries(tenant_id,user_id,kind,description,started_at,resume_job_id,resume_visit_job_id) VALUES(tid,uid,'lunch',coalesce(w.description,e.notes,'Work'),stamp,e.job_id,v) RETURNING id INTO result;
 ELSIF _action='end_lunch' THEN
  IF w.id IS NULL OR w.kind<>'lunch' THEN RAISE EXCEPTION 'No unpaid lunch is active'; END IF;
  UPDATE public.work_clock_entries SET ended_at=stamp WHERE id=w.id;
  IF w.resume_job_id IS NOT NULL THEN
   INSERT INTO public.time_entries(tenant_id,user_id,job_id,started_at,notes) VALUES(tid,uid,w.resume_job_id,stamp,w.description) RETURNING id INTO result;
  ELSE
   INSERT INTO public.work_clock_entries(tenant_id,user_id,kind,description,started_at) VALUES(tid,uid,'work',w.description,stamp) RETURNING id INTO result;
  END IF;
  IF w.resume_visit_job_id IS NOT NULL THEN
   INSERT INTO public.job_visits(tenant_id,employee_id,job_id,arrived_at) VALUES(tid,uid,w.resume_visit_job_id,stamp);
  END IF;
 ELSIF _action='clock_out' THEN
  IF w.kind='lunch' THEN RAISE EXCEPTION 'End lunch explicitly before clocking out; no lunch end time will be guessed'; END IF;
  UPDATE public.job_visits SET left_at=stamp WHERE employee_id=uid AND left_at IS NULL;
  UPDATE public.time_entries SET ended_at=stamp WHERE id=e.id;
  UPDATE public.work_clock_entries SET ended_at=stamp WHERE id=w.id;
  result:=coalesce(e.id,w.id);
 ELSE RAISE EXCEPTION 'Unknown clock action'; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.employee_clock_action(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.employee_clock_action(text,text) TO authenticated;
COMMENT ON TABLE public.work_clock_entries IS 'Explicit unpaid lunches and described work without a scheduled appointment. Paid scheduled work remains in time_entries; lunch splits paid intervals and must never be deducted again.';