-- ============ FIX: sms_messages RLS regression from duplicate migration ============
-- 20260801184452_97a56711-792d-4467-bdc3-3224539335a0.sql redefined sms_messages
-- with `create table if not exists`, so it was a no-op if the table already
-- existed -- but it unconditionally added three permissive RLS policies with no
-- `direction` check on INSERT. Live-schema introspection (via the project's
-- PostgREST OpenAPI doc) confirms the deployed table has `read_by`, not
-- `sent_by` -- i.e. it matches this second migration's column set, meaning
-- 20260722120000_sms_messages.sql's CREATE TABLE (and its stricter policies)
-- never actually ran against the live database. This migration does not assume
-- either policy set is currently in effect -- it drops both possible names and
-- creates one correct set, so it's safe regardless of which history actually
-- applied.

DROP POLICY IF EXISTS "Staff read tenant sms" ON public.sms_messages;
DROP POLICY IF EXISTS "Staff send sms" ON public.sms_messages;
DROP POLICY IF EXISTS "Staff mark read" ON public.sms_messages;
DROP POLICY IF EXISTS "sms_messages_select_own_tenant" ON public.sms_messages;
DROP POLICY IF EXISTS "sms_messages_insert_own_tenant" ON public.sms_messages;
DROP POLICY IF EXISTS "sms_messages_update_own_tenant" ON public.sms_messages;

CREATE POLICY "sms_messages_select_own_tenant"
  ON public.sms_messages FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

-- Staff may only insert outbound messages -- inbound rows must come from the
-- signature-verified Twilio webhook (service_role), never from an authenticated
-- staff session. Without this check, a staff user could insert a row with
-- direction = 'inbound' and spoof a client-originated message.
CREATE POLICY "sms_messages_insert_own_tenant"
  ON public.sms_messages FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND direction = 'outbound');

CREATE POLICY "sms_messages_update_own_tenant"
  ON public.sms_messages FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP INDEX IF EXISTS public.idx_sms_messages_tenant_created;
DROP INDEX IF EXISTS public.idx_sms_messages_client;
CREATE INDEX IF NOT EXISTS idx_sms_messages_tenant_client ON public.sms_messages(tenant_id, client_id, created_at);
