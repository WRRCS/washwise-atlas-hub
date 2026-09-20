ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS invoice_series text;

UPDATE public.tenants SET invoice_series = '2026' WHERE invoice_series IS NULL;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS payment_terms_days smallint;

ALTER TABLE public.clients
  ADD CONSTRAINT clients_payment_terms_days_chk CHECK (payment_terms_days IS NULL OR (payment_terms_days >= 0 AND payment_terms_days <= 365)) NOT VALID;

GRANT SELECT (payment_terms_days), INSERT (payment_terms_days), UPDATE (payment_terms_days) ON public.clients TO authenticated;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payment_terms_days smallint;

UPDATE public.invoices SET payment_terms_days = GREATEST(0, (due_date - issue_date))
  WHERE payment_terms_days IS NULL AND due_date IS NOT NULL AND issue_date IS NOT NULL;

CREATE OR REPLACE FUNCTION public.next_invoice_number(_tenant uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _pfx text;
  _series text;
  _prefix text;
  _max int;
BEGIN
  SELECT NULLIF(btrim(COALESCE(invoice_prefix, '')), ''),
         NULLIF(btrim(COALESCE(invoice_series, '')), '')
    INTO _pfx, _series
    FROM public.tenants WHERE id = _tenant;

  _pfx := COALESCE(_pfx, 'WRR');
  _series := COALESCE(_series, EXTRACT(YEAR FROM CURRENT_DATE)::text);
  _prefix := _pfx || '-' || _series || '-';

  SELECT COALESCE(MAX(NULLIF(regexp_replace(number, '^' || _prefix, ''), '')::int), 0)
    INTO _max
    FROM public.invoices
   WHERE tenant_id = _tenant
     AND number LIKE _prefix || '%'
     AND regexp_replace(number, '^' || _prefix, '') ~ '^[0-9]+$';

  RETURN _prefix || lpad((_max + 1)::text, 3, '0');
END $function$;

CREATE OR REPLACE FUNCTION public.tg_auto_invoice_on_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _svc_name text;
  _invoice_id uuid;
  _number text;
  _svc_date date;
  _terms int;
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    IF EXISTS (SELECT 1 FROM public.invoices WHERE job_id = NEW.id) THEN
      RETURN NEW;
    END IF;

    SELECT name INTO _svc_name FROM public.service_types WHERE id = NEW.service_type_id;
    _svc_date := (NEW.scheduled_start AT TIME ZONE 'UTC')::date;
    _number := public.next_invoice_number(NEW.tenant_id);

    SELECT COALESCE(
             (SELECT c.payment_terms_days FROM public.clients c WHERE c.id = NEW.client_id),
             (SELECT t.payment_terms_days FROM public.tenants t WHERE t.id = NEW.tenant_id),
             14)
      INTO _terms;

    INSERT INTO public.invoices (
      tenant_id, client_id, job_id, number, status,
      amount_cents, subtotal_cents, surcharge_cents, total_cents,
      currency, issue_date, due_date, payment_terms_days
    ) VALUES (
      NEW.tenant_id, NEW.client_id, NEW.id, _number, 'draft',
      NEW.price_cents, NEW.price_cents, 0, NEW.price_cents,
      'usd', CURRENT_DATE, CURRENT_DATE + (_terms || ' days')::interval, _terms
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
END $function$;