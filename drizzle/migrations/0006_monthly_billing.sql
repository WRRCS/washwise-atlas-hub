ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS bill_monthly boolean NOT NULL DEFAULT false;
ALTER TABLE public.invoice_line_items ADD COLUMN IF NOT EXISTS job_id uuid;
CREATE INDEX IF NOT EXISTS invoice_line_items_job_id_idx ON public.invoice_line_items(job_id);

CREATE OR REPLACE FUNCTION public.tg_auto_invoice_on_complete()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _svc_name text; _invoice_id uuid; _number text; _svc_date date; _terms int;
  _monthly boolean; _month date; _sort int;
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    IF EXISTS (SELECT 1 FROM public.invoices WHERE job_id = NEW.id)
       OR EXISTS (SELECT 1 FROM public.invoice_line_items WHERE job_id = NEW.id) THEN
      RETURN NEW;
    END IF;

    SELECT name INTO _svc_name FROM public.service_types WHERE id = NEW.service_type_id;
    _svc_date := (NEW.scheduled_start AT TIME ZONE 'America/Los_Angeles')::date;
    SELECT COALESCE(
             (SELECT c.payment_terms_days FROM public.clients c WHERE c.id = NEW.client_id),
             (SELECT t.payment_terms_days FROM public.tenants t WHERE t.id = NEW.tenant_id), 14)
      INTO _terms;
    SELECT COALESCE(c.bill_monthly, false) INTO _monthly FROM public.clients c WHERE c.id = NEW.client_id;

    IF _monthly THEN
      _month := date_trunc('month', _svc_date)::date;
      SELECT id INTO _invoice_id FROM public.invoices
        WHERE client_id = NEW.client_id AND bundle_month = _month AND status = 'draft'
        ORDER BY created_at LIMIT 1;
      IF _invoice_id IS NULL THEN
        _number := public.next_invoice_number(NEW.tenant_id);
        INSERT INTO public.invoices (
          tenant_id, client_id, job_id, number, status, amount_cents, subtotal_cents, surcharge_cents, total_cents,
          currency, issue_date, due_date, payment_terms_days, cleanings_count, bundle_month
        ) VALUES (
          NEW.tenant_id, NEW.client_id, NULL, _number, 'draft', 0, 0, 0, 0,
          'usd', (_month + interval '1 month' - interval '1 day')::date,
          (_month + interval '1 month' - interval '1 day' + (_terms || ' days')::interval)::date, _terms, 0, _month
        ) RETURNING id INTO _invoice_id;
      END IF;
      SELECT COALESCE(max(sort_order) + 1, 0) INTO _sort FROM public.invoice_line_items WHERE invoice_id = _invoice_id;
      INSERT INTO public.invoice_line_items (
        invoice_id, tenant_id, job_id, description, quantity, unit_price_cents, line_total_cents, service_date, sort_order
      ) VALUES (
        _invoice_id, NEW.tenant_id, NEW.id,
        COALESCE(_svc_name, 'Cleaning') || ' — ' || to_char(_svc_date, 'FMMonth FMDD, YYYY'),
        1, COALESCE(NEW.price_cents, 0), COALESCE(NEW.price_cents, 0), _svc_date, _sort
      );
      UPDATE public.invoices i SET
        subtotal_cents = s.total, total_cents = s.total + COALESCE(i.surcharge_cents, 0),
        amount_cents = s.total + COALESCE(i.surcharge_cents, 0), cleanings_count = s.cnt
      FROM (SELECT COALESCE(sum(line_total_cents), 0)::int total, count(*)::int cnt
            FROM public.invoice_line_items WHERE invoice_id = _invoice_id) s
      WHERE i.id = _invoice_id;
      RETURN NEW;
    END IF;

    _number := public.next_invoice_number(NEW.tenant_id);
    INSERT INTO public.invoices (
      tenant_id, client_id, job_id, number, status, amount_cents, subtotal_cents, surcharge_cents, total_cents,
      currency, issue_date, due_date, payment_terms_days
    ) VALUES (
      NEW.tenant_id, NEW.client_id, NEW.id, _number, 'draft',
      NEW.price_cents, NEW.price_cents, 0, NEW.price_cents,
      'usd', CURRENT_DATE, CURRENT_DATE + (_terms || ' days')::interval, _terms
    ) RETURNING id INTO _invoice_id;
    INSERT INTO public.invoice_line_items (
      invoice_id, tenant_id, job_id, description, quantity, unit_price_cents, line_total_cents, service_date, sort_order
    ) VALUES (
      _invoice_id, NEW.tenant_id, NEW.id,
      COALESCE(_svc_name, 'Cleaning') || ' — ' || to_char(_svc_date, 'FMMonth FMDD, YYYY'),
      1, NEW.price_cents, NEW.price_cents, _svc_date, 0
    );
  END IF;
  RETURN NEW;
END $function$;
REVOKE EXECUTE ON FUNCTION public.tg_auto_invoice_on_complete() FROM PUBLIC, anon, authenticated;