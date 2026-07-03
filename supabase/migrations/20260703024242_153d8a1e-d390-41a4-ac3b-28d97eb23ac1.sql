
-- Extend invoice_status
ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'overdue';
ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'cancelled';

-- Extend invoices table
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS issue_date date NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS subtotal_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS surcharge_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS card_surcharge boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cleanings_count integer,
  ADD COLUMN IF NOT EXISTS bundle_month date;

-- Line items
CREATE TABLE IF NOT EXISTS public.invoice_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  description text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  unit_price_cents integer NOT NULL DEFAULT 0,
  line_total_cents integer NOT NULL DEFAULT 0,
  service_date date,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_line_items TO authenticated;
GRANT ALL ON public.invoice_line_items TO service_role;

ALTER TABLE public.invoice_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant staff can view line items"
  ON public.invoice_line_items FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "tenant staff can insert line items"
  ON public.invoice_line_items FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "tenant staff can update line items"
  ON public.invoice_line_items FOR UPDATE
  TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "tenant staff can delete line items"
  ON public.invoice_line_items FOR DELETE
  TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE INDEX IF NOT EXISTS invoice_line_items_invoice_idx ON public.invoice_line_items(invoice_id);

-- Invoice number generator (per tenant per year)
CREATE OR REPLACE FUNCTION public.next_invoice_number(_tenant uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _year int := EXTRACT(YEAR FROM CURRENT_DATE)::int;
  _prefix text := 'WRR-' || _year::text || '-';
  _max int;
  _next int;
BEGIN
  SELECT COALESCE(MAX(NULLIF(regexp_replace(number, '^' || _prefix, ''), '')::int), 0)
    INTO _max
    FROM public.invoices
   WHERE tenant_id = _tenant
     AND number LIKE _prefix || '%';
  _next := _max + 1;
  RETURN _prefix || lpad(_next::text, 3, '0');
END $$;

-- Auto-invoice on job completion
CREATE OR REPLACE FUNCTION public.tg_auto_invoice_on_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _svc_name text;
  _invoice_id uuid;
  _number text;
  _svc_date date;
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    -- Skip if invoice already exists for this job
    IF EXISTS (SELECT 1 FROM public.invoices WHERE job_id = NEW.id) THEN
      RETURN NEW;
    END IF;

    SELECT name INTO _svc_name FROM public.service_types WHERE id = NEW.service_type_id;
    _svc_date := (NEW.scheduled_start AT TIME ZONE 'UTC')::date;
    _number := public.next_invoice_number(NEW.tenant_id);

    INSERT INTO public.invoices (
      tenant_id, client_id, job_id, number, status,
      amount_cents, subtotal_cents, surcharge_cents, total_cents,
      currency, issue_date, due_date
    ) VALUES (
      NEW.tenant_id, NEW.client_id, NEW.id, _number, 'draft',
      NEW.price_cents, NEW.price_cents, 0, NEW.price_cents,
      'usd', CURRENT_DATE, CURRENT_DATE + INTERVAL '14 days'
    )
    RETURNING id INTO _invoice_id;

    INSERT INTO public.invoice_line_items (
      invoice_id, tenant_id, description, quantity, unit_price_cents, line_total_cents, service_date, sort_order
    ) VALUES (
      _invoice_id, NEW.tenant_id,
      COALESCE(_svc_name, 'Cleaning') || ' — ' || to_char(_svc_date, 'FMMonth FMDD, YYYY'),
      1, NEW.price_cents, NEW.price_cents, _svc_date, 0
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS jobs_auto_invoice ON public.jobs;
CREATE TRIGGER jobs_auto_invoice
  AFTER UPDATE OF status ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_auto_invoice_on_complete();

-- Backfill total_cents for existing rows
UPDATE public.invoices SET total_cents = amount_cents, subtotal_cents = amount_cents WHERE total_cents = 0 AND amount_cents > 0;
