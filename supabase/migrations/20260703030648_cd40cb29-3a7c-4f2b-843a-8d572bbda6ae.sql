
CREATE TYPE public.integration_provider AS ENUM ('quickbooks', 'stripe', 'venmo', 'godaddy', 'turno');
CREATE TYPE public.payment_provider AS ENUM ('venmo', 'card', 'ach', 'manual');
CREATE TYPE public.payment_status AS ENUM ('pending', 'succeeded', 'failed', 'refunded');

CREATE TABLE public.integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider public.integration_provider NOT NULL,
  is_connected BOOLEAN NOT NULL DEFAULT false,
  connected_at TIMESTAMPTZ,
  access_token TEXT,
  refresh_token TEXT,
  external_account_id TEXT,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.integrations TO authenticated;
GRANT ALL ON public.integrations TO service_role;
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read integrations" ON public.integrations
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "owners manage integrations" ON public.integrations
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());

CREATE TRIGGER trg_integrations_updated
  BEFORE UPDATE ON public.integrations
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  provider public.payment_provider NOT NULL,
  amount_cents INT NOT NULL,
  surcharge_cents INT NOT NULL DEFAULT 0,
  net_to_business_cents INT NOT NULL,
  external_transaction_id TEXT,
  status public.payment_status NOT NULL DEFAULT 'pending',
  processed_at TIMESTAMPTZ,
  note TEXT,
  recorded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read payments" ON public.payments
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "staff insert payments" ON public.payments
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "owners update payments" ON public.payments
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());

CREATE INDEX idx_payments_invoice ON public.payments (invoice_id);

CREATE TRIGGER trg_payments_updated
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Auto-mark invoice paid when a payment succeeds
CREATE OR REPLACE FUNCTION public.tg_payment_mark_invoice_paid()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'succeeded' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'succeeded') THEN
    UPDATE public.invoices
      SET status = 'paid', paid_at = COALESCE(NEW.processed_at, now())
      WHERE id = NEW.invoice_id AND status <> 'paid';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_payment_success_mark_paid
  AFTER INSERT OR UPDATE OF status ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_payment_mark_invoice_paid();

-- Seed provider rows for every existing tenant
INSERT INTO public.integrations (tenant_id, provider)
SELECT t.id, p::public.integration_provider
FROM public.tenants t
CROSS JOIN (VALUES ('quickbooks'),('stripe'),('venmo'),('godaddy'),('turno')) AS pv(p)
ON CONFLICT (tenant_id, provider) DO NOTHING;
