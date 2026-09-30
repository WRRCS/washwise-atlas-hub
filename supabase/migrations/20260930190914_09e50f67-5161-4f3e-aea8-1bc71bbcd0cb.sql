-- Hand-logged leads (phone call, text, Airbnb/VRBO message, referral) need to live in the
-- pipeline BEFORE a client record exists, so staff can log them in one step.
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT;

COMMENT ON COLUMN public.leads.name IS 'Contact name captured when the lead was logged by hand, before any client record exists.';
COMMENT ON COLUMN public.leads.email IS 'Lead email captured at logging time (may not yet belong to a client record).';
COMMENT ON COLUMN public.leads.phone IS 'Lead phone captured at logging time (may not yet belong to a client record).';

-- Backfill from any lead whose raw webhook payload already carried the contact.
UPDATE public.leads
   SET name = NULLIF(TRIM(COALESCE(payload->>'name', payload->>'full_name', '')), '')
 WHERE name IS NULL;

UPDATE public.leads
   SET email = NULLIF(TRIM(COALESCE(payload->>'email', '')), '')
 WHERE email IS NULL;

UPDATE public.leads
   SET phone = NULLIF(TRIM(COALESCE(payload->>'phone', '')), '')
 WHERE phone IS NULL;

-- Keeps the pipeline screens fast as leads accumulate.
CREATE INDEX IF NOT EXISTS leads_tenant_status_created_idx
  ON public.leads (tenant_id, status, created_at DESC);