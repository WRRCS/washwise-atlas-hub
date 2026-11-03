-- Auto-generated invoices (job completion) use the same fields as the redesigned editor:
-- subject, selected service property, line details, reusable message/terms defaults.
CREATE OR REPLACE FUNCTION public.tg_auto_invoice_on_complete()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _svc_name text; _invoice_id uuid; _number text; _svc_date date; _terms int;
  _monthly boolean; _month date; _sort int; _hourly boolean; _rate int; _unit int; _hrs numeric;
  _prop_label text; _prop_address text; _details text;
  _msg text; _terms_text text;
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    -- Duplicate guard: retried completion, reopen+recomplete, or a second cleaner
    -- finishing the same job must never create a second invoice.
    IF EXISTS (SELECT 1 FROM public.invoices WHERE job_id = NEW.id)
       OR EXISTS (SELECT 1 FROM public.invoice_line_items WHERE job_id = NEW.id) THEN
      RETURN NEW;
    END IF;
    SELECT name INTO _svc_name FROM public.service_types WHERE id = NEW.service_type_id;
    _svc_date := (NEW.scheduled_start AT TIME ZONE 'America/Los_Angeles')::date;
    SELECT COALESCE((SELECT c.payment_terms_days FROM public.clients c WHERE c.id = NEW.client_id),
             (SELECT t.payment_terms_days FROM public.tenants t WHERE t.id = NEW.tenant_id), 14) INTO _terms;
    SELECT COALESCE(c.bill_monthly, false) INTO _monthly FROM public.clients c WHERE c.id = NEW.client_id;
    SELECT t.invoice_message_default, t.invoice_terms_default INTO _msg, _terms_text
      FROM public.tenants t WHERE t.id = NEW.tenant_id;
    -- The appointment's selected property, not the client's default address.
    IF NEW.property_id IS NOT NULL THEN
      SELECT p.label, p.address INTO _prop_label, _prop_address
        FROM public.client_properties p
        WHERE p.id = NEW.property_id AND p.client_id = NEW.client_id AND p.tenant_id = NEW.tenant_id;
    END IF;
    _details := NULLIF(trim(both ' ' from
      concat_ws(' — ', NULLIF(COALESCE(_prop_label, ''), ''), NULLIF(replace(COALESCE(_prop_address, ''), E'\n', ', '), ''))), '');
    _hourly := COALESCE(NEW.price_cents, 0) = 0;
    SELECT COALESCE(hourly_rate_cents, 4500) INTO _rate FROM public.tenants WHERE id = NEW.tenant_id;
    _unit := CASE WHEN _hourly THEN COALESCE(_rate,4500) ELSE NEW.price_cents END;
    _hrs := CASE WHEN _hourly THEN 0 ELSE NULL END;

    IF _monthly THEN
      _month := date_trunc('month', _svc_date)::date;
      SELECT id INTO _invoice_id FROM public.invoices
        WHERE client_id = NEW.client_id AND bundle_month = _month AND status = 'draft' ORDER BY created_at LIMIT 1;
      IF _invoice_id IS NULL THEN
        _number := public.next_invoice_number(NEW.tenant_id);
        INSERT INTO public.invoices (tenant_id, client_id, job_id, number, status, amount_cents, subtotal_cents, surcharge_cents, total_cents,
          currency, issue_date, due_date, payment_terms_days, cleanings_count, bundle_month,
          subject, client_message, terms_text)
        VALUES (NEW.tenant_id, NEW.client_id, NULL, _number, 'draft', 0, 0, 0, 0, 'usd',
          (_month + interval '1 month' - interval '1 day')::date,
          (_month + interval '1 month' - interval '1 day' + (_terms || ' days')::interval)::date, _terms, 0, _month,
          'Monthly cleaning services', _msg, _terms_text)
        RETURNING id INTO _invoice_id;
      END IF;
      SELECT COALESCE(max(sort_order) + 1, 0) INTO _sort FROM public.invoice_line_items WHERE invoice_id = _invoice_id;
    ELSE
      _number := public.next_invoice_number(NEW.tenant_id);
      INSERT INTO public.invoices (tenant_id, client_id, job_id, number, status, amount_cents, subtotal_cents, surcharge_cents, total_cents,
        currency, issue_date, due_date, payment_terms_days,
        subject, property_id, client_message, terms_text)
      VALUES (NEW.tenant_id, NEW.client_id, NEW.id, _number, 'draft', 0, 0, 0, 0, 'usd',
        CURRENT_DATE, CURRENT_DATE + (_terms || ' days')::interval, _terms,
        COALESCE(_svc_name, 'For Services Rendered'), NEW.property_id, _msg, _terms_text)
      RETURNING id INTO _invoice_id;
      _sort := 0;
    END IF;

    INSERT INTO public.invoice_line_items (invoice_id, tenant_id, job_id, description, details, quantity, unit_price_cents, line_total_cents, service_date, sort_order, hours)
    VALUES (_invoice_id, NEW.tenant_id, NEW.id,
      COALESCE(_svc_name, 'Cleaning') || ' — ' || to_char(_svc_date, 'FMMonth FMDD, YYYY'),
      _details,
      1, _unit, CASE WHEN _hourly THEN 0 ELSE _unit END, _svc_date, _sort, _hrs);
    IF _hourly THEN PERFORM public.recalc_job_hours(NEW.id); END IF;
    PERFORM public.recalc_invoice_totals(_invoice_id);
    IF _monthly THEN
      UPDATE public.invoices SET cleanings_count = (SELECT count(*) FROM public.invoice_line_items WHERE invoice_id = _invoice_id) WHERE id = _invoice_id;
    END IF;
  END IF;
  RETURN NEW;
END $function$;