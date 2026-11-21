-- Cleaners (non-owner/manager) may only record arrive / finish on cleanings:
-- status forward moves plus start/finish times at the current moment.
CREATE OR REPLACE FUNCTION public.guard_employee_job_billing()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
DECLARE
  _allowed text[] := ARRAY['status','actual_start','actual_end','updated_at'];
BEGIN
  IF current_user <> 'authenticated' OR public.is_owner_or_manager() THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - _allowed) IS DISTINCT FROM (to_jsonb(OLD) - _allowed) THEN
    RAISE EXCEPTION 'Only owners and managers can change cleaning details' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'scheduled' AND NEW.status IN ('in_progress','completed'))
    OR (OLD.status = 'in_progress' AND NEW.status = 'completed')
  ) THEN
    RAISE EXCEPTION 'Only owners and managers can change a cleaning to that status' USING ERRCODE = '42501';
  END IF;
  IF NEW.actual_start IS DISTINCT FROM OLD.actual_start
     AND (NEW.actual_start IS NULL OR abs(extract(epoch FROM (NEW.actual_start - now()))) > 300) THEN
    RAISE EXCEPTION 'Start time is recorded at the current time; ask a manager to correct it' USING ERRCODE = '42501';
  END IF;
  IF NEW.actual_end IS DISTINCT FROM OLD.actual_end
     AND (NEW.actual_end IS NULL OR abs(extract(epoch FROM (NEW.actual_end - now()))) > 300) THEN
    RAISE EXCEPTION 'Finish time is recorded at the current time; ask a manager to correct it' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION public.guard_employee_job_billing() IS 'Cleaners may only move status forward and record start/finish at the current time; all other cleaning edits are owner/manager only.';

-- Business text conversations: owners and managers only.
DROP POLICY IF EXISTS sms_messages_select_own_tenant ON public.sms_messages;
DROP POLICY IF EXISTS sms_messages_update_own_tenant ON public.sms_messages;
DROP POLICY IF EXISTS sms_messages_insert_own_tenant ON public.sms_messages;
CREATE POLICY sms_messages_select_managers ON public.sms_messages FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager());
CREATE POLICY sms_messages_update_managers ON public.sms_messages FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager());
CREATE POLICY sms_messages_insert_managers ON public.sms_messages FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager()
              AND direction = 'outbound' AND sent_by = auth.uid());