-- ============ CLIENT PORTAL (magic-link auth, appointments, requests) ============
-- The client portal is NOT authenticated via Supabase Auth (auth.uid()) — clients
-- never get a Supabase user account. Instead it uses its own passwordless
-- session mechanism, validated server-side against these tables via the
-- service-role client (same trust model as the public Twilio webhooks).
-- Only tokens/hashes are stored, never the raw email link or session value.

CREATE TABLE public.client_portal_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_client_portal_tokens_client ON public.client_portal_tokens(client_id);

CREATE TABLE public.client_portal_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_client_portal_sessions_client ON public.client_portal_sessions(client_id);

-- No RLS policies granted to `authenticated` on these two tables on purpose —
-- clients have no Supabase session, and staff never need to read raw tokens.
-- Only the service_role (server-side, via supabaseAdmin) touches them.
ALTER TABLE public.client_portal_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_portal_sessions ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.client_portal_tokens TO service_role;
GRANT ALL ON public.client_portal_sessions TO service_role;

-- ============ CLIENT SPECIAL REQUESTS ============
-- A client submits a request against an upcoming appointment (e.g. "clean the
-- patio furniture"); it lands in a manager review queue rather than touching
-- the job directly — a manager approves it onto the job's notes or dismisses it.
CREATE TABLE public.client_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'dismissed')),
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_client_requests_tenant_status ON public.client_requests(tenant_id, status, created_at);

GRANT SELECT, INSERT, UPDATE ON public.client_requests TO authenticated;
GRANT ALL ON public.client_requests TO service_role;
ALTER TABLE public.client_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read tenant requests" ON public.client_requests
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "Staff update tenant requests" ON public.client_requests
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
-- No client-side INSERT policy — requests are created by the portal server
-- functions via supabaseAdmin, same trust model as the tokens/sessions above.

-- ============ PORTAL MESSAGES SHARE THE STAFF SHARED INBOX ============
-- Client portal messages land in the same sms_messages table/thread the
-- managers already use for texting, tagged by channel, so there's one
-- conversation per client no matter how they reach out.
ALTER TABLE public.sms_messages
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms', 'portal'));
ALTER TABLE public.sms_messages ALTER COLUMN from_number DROP NOT NULL;
ALTER TABLE public.sms_messages ALTER COLUMN to_number DROP NOT NULL;
-- from_number/to_number stay NOT NULL-in-practice for channel='sms' rows
-- (enforced in application code); portal-channel rows have no phone number.
