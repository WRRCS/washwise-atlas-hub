-- 1) Voice tables: restrict to owners/managers
DROP POLICY IF EXISTS "Tenant members can manage voice config" ON public.voice_agent_config;
DROP POLICY IF EXISTS "Tenant members can view voice config" ON public.voice_agent_config;
DROP POLICY IF EXISTS "Tenant members can view call turns" ON public.voice_call_turns;
DROP POLICY IF EXISTS "Tenant members can view voice calls" ON public.voice_calls;
DROP POLICY IF EXISTS "Tenant members can update voice calls" ON public.voice_calls;
DROP POLICY IF EXISTS "Tenant members can delete voice calls" ON public.voice_calls;

CREATE POLICY "Owners and managers manage voice config"
  ON public.voice_agent_config FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager());

CREATE POLICY "Owners and managers view call turns"
  ON public.voice_call_turns FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager());

CREATE POLICY "Owners and managers view voice calls"
  ON public.voice_calls FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager());

CREATE POLICY "Owners and managers update voice calls"
  ON public.voice_calls FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager());

CREATE POLICY "Owners and managers delete voice calls"
  ON public.voice_calls FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager());

-- 2) team_messages: recipients may only set read_at
CREATE OR REPLACE FUNCTION public.tg_team_messages_read_only_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.sender_id IS DISTINCT FROM auth.uid() THEN
    NEW.id := OLD.id;
    NEW.tenant_id := OLD.tenant_id;
    NEW.sender_id := OLD.sender_id;
    NEW.recipient_id := OLD.recipient_id;
    NEW.body := OLD.body;
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS team_messages_read_only_update ON public.team_messages;
CREATE TRIGGER team_messages_read_only_update
  BEFORE UPDATE ON public.team_messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_team_messages_read_only_update();

-- 3) Revoke EXECUTE on internal SECURITY DEFINER helpers
REVOKE EXECUTE ON FUNCTION public.has_employee_permission(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_owner_or_manager() FROM anon;
REVOKE EXECUTE ON FUNCTION public.current_tenant_id() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.current_tenant_onboarding_completed() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_client_mgmt_permission() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM anon, authenticated;