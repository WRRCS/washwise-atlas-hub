ALTER TABLE public.employee_reminder_pilots ADD COLUMN IF NOT EXISTS rollout_all boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.validate_employee_reminder_pilot() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.rollout_all THEN
  NEW.participant_ids := '{}';
 ELSE
  IF cardinality(NEW.participant_ids)=2 AND (NEW.participant_ids[1]=NEW.participant_ids[2] OR (SELECT count(*) FROM public.profiles p WHERE p.id=ANY(NEW.participant_ids) AND p.tenant_id=NEW.tenant_id AND p.is_active AND EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p.id AND r.role='employee'))<>2) THEN RAISE EXCEPTION 'Select two distinct active employee accounts in this business'; END IF;
  IF NEW.delivery_enabled THEN RAISE EXCEPTION 'Reminder delivery requires the all-employee rollout'; END IF;
 END IF;
 NEW.updated_at=now(); RETURN NEW;
END $$;

DROP POLICY IF EXISTS pilot_read ON public.employee_reminder_pilots;
CREATE POLICY pilot_read ON public.employee_reminder_pilots FOR SELECT TO authenticated USING(tenant_id=public.current_tenant_id() AND (public.is_owner_or_manager() OR auth.uid()=ANY(participant_ids) OR (rollout_all AND public.has_role(auth.uid(),'employee'))));

DROP POLICY IF EXISTS pilot_device_read ON public.push_subscriptions;
CREATE POLICY pilot_device_read ON public.push_subscriptions FOR SELECT TO authenticated USING(tenant_id=public.current_tenant_id() AND public.is_owner_or_manager() AND EXISTS(SELECT 1 FROM public.employee_reminder_pilots p WHERE p.tenant_id=push_subscriptions.tenant_id AND (push_subscriptions.user_id=ANY(p.participant_ids) OR (p.rollout_all AND public.has_role(push_subscriptions.user_id,'employee')))));

CREATE OR REPLACE FUNCTION public.claim_employee_reminder(_tenant uuid, _user uuid, _job uuid, _start timestamp with time zone, _key text, _stage text, _action text, _channel text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE result uuid;
BEGIN
 PERFORM 1 FROM public.profiles WHERE id=_user AND tenant_id=_tenant AND is_active FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user AND role='employee') THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.employee_reminder_pilots WHERE tenant_id=_tenant AND delivery_enabled AND (rollout_all OR _user=ANY(participant_ids)) AND channel=_channel) THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.jobs j WHERE j.id=_job AND j.tenant_id=_tenant AND j.scheduled_start=_start AND j.status IN ('scheduled','in_progress') AND (j.published_at IS NOT NULL OR j.status='in_progress') AND j.scheduled_end>now() AND (j.assigned_to=_user OR EXISTS(SELECT 1 FROM public.job_employees e WHERE e.job_id=j.id AND e.employee_id=_user))) THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM public.work_clock_entries WHERE user_id=_user AND ended_at IS NULL AND kind='lunch') OR EXISTS(SELECT 1 FROM public.job_visits WHERE job_id=_job AND employee_id=_user) THEN RETURN NULL; END IF;
 IF _action='clock_in' AND (EXISTS(SELECT 1 FROM public.time_entries WHERE user_id=_user AND ended_at IS NULL) OR EXISTS(SELECT 1 FROM public.work_clock_entries WHERE user_id=_user AND ended_at IS NULL AND kind='work')) THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM public.employee_reminder_attempts WHERE user_id=_user AND attempted_at>now()-interval '10 minutes') OR (SELECT count(*) FROM public.employee_reminder_attempts WHERE user_id=_user AND job_id=_job AND scheduled_start=_start)>=3 THEN RETURN NULL; END IF;
 INSERT INTO public.employee_reminder_attempts(tenant_id,user_id,job_id,scheduled_start,reminder_key,stage,action,channel) VALUES(_tenant,_user,_job,_start,_key,_stage,_action,_channel) ON CONFLICT(reminder_key) DO NOTHING RETURNING id INTO result;
 RETURN result;
END $function$;
REVOKE ALL ON FUNCTION public.claim_employee_reminder(uuid,uuid,uuid,timestamptz,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_employee_reminder(uuid,uuid,uuid,timestamptz,text,text,text,text) TO service_role;

UPDATE public.employee_reminder_pilots SET rollout_all=true, delivery_enabled=true, participant_ids='{}' WHERE tenant_id='00000000-0000-0000-0000-000000000001';

COMMENT ON TABLE public.employee_reminder_pilots IS 'Employee clock-in/arrival reminder settings per business. rollout_all=true sends to every active employee; the legacy two-person pilot mode cannot deliver.';