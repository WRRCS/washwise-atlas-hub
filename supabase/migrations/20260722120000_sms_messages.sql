-- ============ SMS MESSAGES (two-way client texting, shared inbox) ============
CREATE TABLE public.sms_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_number TEXT NOT NULL,
  to_number TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
    -- inbound: received | outbound: queued -> sent -> delivered | failed
  twilio_sid TEXT,
  sent_by UUID REFERENCES auth.users(id),  -- who sent it (null for inbound/client messages)
  read_at TIMESTAMPTZ,                      -- null = unread, for the inbox unread badge
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sms_messages_tenant_client ON public.sms_messages(tenant_id, client_id, created_at);
CREATE INDEX idx_sms_messages_unread ON public.sms_messages(tenant_id) WHERE read_at IS NULL;
CREATE INDEX idx_sms_messages_tenant_from ON public.sms_messages(tenant_id, from_number);
CREATE INDEX idx_sms_messages_twilio_sid ON public.sms_messages(twilio_sid) WHERE twilio_sid IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON public.sms_messages TO authenticated;
GRANT ALL ON public.sms_messages TO service_role;

ALTER TABLE public.sms_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read tenant sms" ON public.sms_messages
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());

CREATE POLICY "Staff send sms" ON public.sms_messages
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND direction = 'outbound');

CREATE POLICY "Staff mark read" ON public.sms_messages
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- Reuses the existing per-tenant number: voice_agent_config.twilio_phone_number
-- already stores the tenant's Twilio number. SMS shares the same number
-- (Twilio numbers support both Voice and SMS on one number).
--
-- NOTE on phone matching: clients.phone is free-text (e.g. "(555) 555-0100"),
-- while Twilio always sends From/To in E.164 (+15555550100). Client matching
-- is done in application code (src/lib/phone.ts: normalizePhoneE164), not in
-- SQL, so we don't need to alter the existing clients table or its indexes.
