
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS stripe_session_id text,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS stripe_charge_id text,
  ADD COLUMN IF NOT EXISTS payment_method_details jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS payments_stripe_session_id_key ON public.payments(stripe_session_id) WHERE stripe_session_id IS NOT NULL;
