
-- 1) voice_agent_config
CREATE TABLE public.voice_agent_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  greeting TEXT NOT NULL DEFAULT 'Hello, thanks for calling. How can I help you today?',
  system_prompt TEXT NOT NULL DEFAULT 'You are a friendly AI receptionist for a service business. Collect the caller''s name, phone, address, and what they need. Be brief and natural.',
  voice TEXT NOT NULL DEFAULT 'Polly.Joanna',
  language TEXT NOT NULL DEFAULT 'en-US',
  forward_number TEXT,
  business_hours JSONB NOT NULL DEFAULT '{"mon":["08:00","18:00"],"tue":["08:00","18:00"],"wed":["08:00","18:00"],"thu":["08:00","18:00"],"fri":["08:00","18:00"]}'::jsonb,
  twilio_phone_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.voice_agent_config TO authenticated;
GRANT ALL ON public.voice_agent_config TO service_role;

ALTER TABLE public.voice_agent_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view voice config"
  ON public.voice_agent_config FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant members can manage voice config"
  ON public.voice_agent_config FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

-- 2) voice_calls
CREATE TABLE public.voice_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  call_sid TEXT NOT NULL UNIQUE,
  from_number TEXT,
  to_number TEXT,
  direction TEXT NOT NULL DEFAULT 'inbound',
  status TEXT NOT NULL DEFAULT 'in-progress',
  duration_sec INTEGER,
  recording_url TEXT,
  recording_sid TEXT,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  summary TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX voice_calls_tenant_started_idx ON public.voice_calls(tenant_id, started_at DESC);
CREATE INDEX voice_calls_lead_idx ON public.voice_calls(lead_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.voice_calls TO authenticated;
GRANT ALL ON public.voice_calls TO service_role;

ALTER TABLE public.voice_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view voice calls"
  ON public.voice_calls FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant members can update voice calls"
  ON public.voice_calls FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant members can delete voice calls"
  ON public.voice_calls FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

-- 3) voice_call_turns
CREATE TABLE public.voice_call_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL REFERENCES public.voice_calls(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content TEXT,
  tool_name TEXT,
  tool_args JSONB,
  tool_result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX voice_call_turns_call_seq_idx ON public.voice_call_turns(call_id, seq);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.voice_call_turns TO authenticated;
GRANT ALL ON public.voice_call_turns TO service_role;

ALTER TABLE public.voice_call_turns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view call turns"
  ON public.voice_call_turns FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

-- updated_at triggers (reuse existing function if present)
CREATE OR REPLACE FUNCTION public.set_voice_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_voice_agent_config_updated
  BEFORE UPDATE ON public.voice_agent_config
  FOR EACH ROW EXECUTE FUNCTION public.set_voice_updated_at();

CREATE TRIGGER trg_voice_calls_updated
  BEFORE UPDATE ON public.voice_calls
  FOR EACH ROW EXECUTE FUNCTION public.set_voice_updated_at();
