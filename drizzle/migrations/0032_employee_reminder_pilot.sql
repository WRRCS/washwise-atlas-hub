CREATE TABLE public.employee_reminder_pilots (
 tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),
 participant_ids uuid[] NOT NULL DEFAULT '{}',
 delivery_enabled boolean NOT NULL DEFAULT false,
 before_enabled boolean NOT NULL DEFAULT true,
 start_enabled boolean NOT NULL DEFAULT true,
 followup_enabled boolean NOT NULL DEFAULT true,
 before_minutes integer NOT NULL DEFAULT 15 CHECK(before_minutes BETWEEN 0 AND 120),
 followup_minutes integer NOT NULL DEFAULT 5 CHECK(followup_minutes BETWEEN 0 AND 120),
 channel text NOT NULL DEFAULT 'push' CHECK(channel IN ('push','email')),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(cardinality(participant_ids) IN (0,2))
);
GRANT SELECT, INSERT, UPDATE ON public.employee_reminder_pilots TO authenticated;
GRANT ALL ON public.employee_reminder_pilots TO service_role;
ALTER TABLE public.employee_reminder_pilots ENABLE ROW LEVEL SECURITY;
CREATE POLICY pilot_read ON public.employee_reminder_pilots FOR SELECT TO authenticated USING(tenant_id=public.current_tenant_id() AND (public.is_owner_or_manager() OR auth.uid()=ANY(participant_ids)));
CREATE POLICY pilot_manage ON public.employee_reminder_pilots FOR ALL TO authenticated USING(tenant_id=public.current_tenant_id() AND public.is_owner_or_manager()) WITH CHECK(tenant_id=public.current_tenant_id() AND public.is_owner_or_manager());
CREATE FUNCTION public.validate_employee_reminder_pilot() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF cardinality(NEW.participant_ids)=2 AND (NEW.participant_ids[1]=NEW.participant_ids[2] OR (SELECT count(*) FROM public.profiles p WHERE p.id=ANY(NEW.participant_ids) AND p.tenant_id=NEW.tenant_id AND p.is_active AND EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p.id AND r.role='employee'))<>2) THEN RAISE EXCEPTION 'Select two distinct active employee accounts in this business'; END IF;
 IF NEW.delivery_enabled THEN RAISE EXCEPTION 'Pilot delivery remains locked until controlled phone testing is authorized'; END IF;
 NEW.updated_at=now(); RETURN NEW;
END $$;
CREATE TRIGGER validate_employee_reminder_pilot BEFORE INSERT OR UPDATE ON public.employee_reminder_pilots FOR EACH ROW EXECUTE FUNCTION public.validate_employee_reminder_pilot();
ALTER TABLE public.push_subscriptions ADD COLUMN device_id uuid, ADD COLUMN permission_state text, ADD COLUMN registration_checked_at timestamptz;
CREATE TABLE public.employee_reminder_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id), user_id uuid NOT NULL REFERENCES public.profiles(id), job_id uuid NOT NULL REFERENCES public.jobs(id), scheduled_start timestamptz NOT NULL, reminder_key text NOT NULL UNIQUE, stage text NOT NULL CHECK(stage IN ('before','start','followup')), action text NOT NULL CHECK(action IN ('clock_in','arrival')), channel text NOT NULL CHECK(channel IN ('push','email')), attempted_at timestamptz NOT NULL DEFAULT now(), accepted_at timestamptz, status text NOT NULL DEFAULT 'attempted' CHECK(status IN ('attempted','accepted','failed','suppressed')), error text
);
GRANT SELECT ON public.employee_reminder_attempts TO authenticated;
GRANT ALL ON public.employee_reminder_attempts TO service_role;
ALTER TABLE public.employee_reminder_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY reminder_attempt_read ON public.employee_reminder_attempts FOR SELECT TO authenticated USING(tenant_id=public.current_tenant_id() AND (user_id=auth.uid() OR public.is_owner_or_manager()));
CREATE TABLE public.employee_reminder_device_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), attempt_id uuid NOT NULL REFERENCES public.employee_reminder_attempts(id), tenant_id uuid NOT NULL REFERENCES public.tenants(id), user_id uuid NOT NULL REFERENCES public.profiles(id), device_id uuid, subscription_id uuid, attempted_at timestamptz NOT NULL DEFAULT now(), accepted_at timestamptz, status text NOT NULL CHECK(status IN ('attempted','accepted','failed','suppressed')), error text
);
GRANT SELECT ON public.employee_reminder_device_attempts TO authenticated;
GRANT ALL ON public.employee_reminder_device_attempts TO service_role;
ALTER TABLE public.employee_reminder_device_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY reminder_device_attempt_read ON public.employee_reminder_device_attempts FOR SELECT TO authenticated USING(tenant_id=public.current_tenant_id() AND (user_id=auth.uid() OR public.is_owner_or_manager()));
CREATE POLICY pilot_device_read ON public.push_subscriptions FOR SELECT TO authenticated USING(tenant_id=public.current_tenant_id() AND public.is_owner_or_manager() AND EXISTS(SELECT 1 FROM public.employee_reminder_pilots p WHERE p.tenant_id=push_subscriptions.tenant_id AND push_subscriptions.user_id=ANY(p.participant_ids)));
CREATE FUNCTION public.claim_employee_reminder(_tenant uuid,_user uuid,_job uuid,_start timestamptz,_key text,_stage text,_action text,_channel text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result uuid;
BEGIN
 PERFORM 1 FROM public.profiles WHERE id=_user AND tenant_id=_tenant AND is_active FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.employee_reminder_pilots WHERE tenant_id=_tenant AND delivery_enabled AND _user=ANY(participant_ids) AND channel=_channel) THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.jobs j WHERE j.id=_job AND j.tenant_id=_tenant AND j.scheduled_start=_start AND j.status IN ('scheduled','in_progress') AND j.scheduled_end>now() AND (j.assigned_to=_user OR EXISTS(SELECT 1 FROM public.job_employees e WHERE e.job_id=j.id AND e.employee_id=_user))) THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM public.work_clock_entries WHERE user_id=_user AND ended_at IS NULL AND kind='lunch') OR EXISTS(SELECT 1 FROM public.job_visits WHERE job_id=_job AND employee_id=_user) THEN RETURN NULL; END IF;
 IF _action='clock_in' AND (EXISTS(SELECT 1 FROM public.time_entries WHERE user_id=_user AND ended_at IS NULL) OR EXISTS(SELECT 1 FROM public.work_clock_entries WHERE user_id=_user AND ended_at IS NULL AND kind='work')) THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM public.employee_reminder_attempts WHERE user_id=_user AND attempted_at>now()-interval '10 minutes') OR (SELECT count(*) FROM public.employee_reminder_attempts WHERE user_id=_user AND job_id=_job AND scheduled_start=_start)>=3 THEN RETURN NULL; END IF;
 INSERT INTO public.employee_reminder_attempts(tenant_id,user_id,job_id,scheduled_start,reminder_key,stage,action,channel) VALUES(_tenant,_user,_job,_start,_key,_stage,_action,_channel) ON CONFLICT(reminder_key) DO NOTHING RETURNING id INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.claim_employee_reminder(uuid,uuid,uuid,timestamptz,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_employee_reminder(uuid,uuid,uuid,timestamptz,text,text,text,text) TO service_role;
COMMENT ON TABLE public.employee_reminder_pilots IS 'Exactly two explicitly selected employees; broader rollout and reminder delivery locked pending authorized real-phone pilot testing.';