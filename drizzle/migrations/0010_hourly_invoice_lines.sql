ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS hourly_rate_cents integer NOT NULL DEFAULT 4500;
ALTER TABLE public.invoice_line_items ADD COLUMN IF NOT EXISTS hours numeric(7,2);
ALTER TABLE public.invoice_line_items ADD COLUMN IF NOT EXISTS hours_manual boolean NOT NULL DEFAULT false;
GRANT SELECT (hourly_rate_cents) ON public.tenants TO authenticated;

CREATE OR REPLACE FUNCTION public.recalc_invoice_totals(_invoice uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.invoices i SET
    subtotal_cents = s.total, total_cents = s.total + COALESCE(i.surcharge_cents,0),
    amount_cents = s.total + COALESCE(i.surcharge_cents,0)
  FROM (SELECT COALESCE(sum(line_total_cents),0)::int total FROM public.invoice_line_items WHERE invoice_id = _invoice) s
  WHERE i.id = _invoice;
$$;

CREATE OR REPLACE FUNCTION public.recalc_job_hours(_job uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _hrs numeric; r record;
BEGIN
  SELECT round(COALESCE(sum(extract(epoch FROM (COALESCE(ended_at, started_at) - started_at))),0)/3600.0, 2)
    INTO _hrs FROM public.time_entries WHERE job_id = _job;
  FOR r IN SELECT li.id, li.invoice_id, li.unit_price_cents FROM public.invoice_line_items li
           JOIN public.invoices i ON i.id = li.invoice_id
           WHERE li.job_id = _job AND li.hours IS NOT NULL AND NOT li.hours_manual AND i.status = 'draft'
  LOOP
    UPDATE public.invoice_line_items SET hours = _hrs, line_total_cents = round(_hrs * unit_price_cents)::int WHERE id = r.id;
    PERFORM public.recalc_invoice_totals(r.invoice_id);
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION public.recalc_job_hours(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.recalc_invoice_totals(uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.tg_time_entry_recalc_hours() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.recalc_job_hours(COALESCE(NEW.job_id, OLD.job_id));
  IF TG_OP = 'UPDATE' AND OLD.job_id IS DISTINCT FROM NEW.job_id THEN PERFORM public.recalc_job_hours(OLD.job_id); END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS time_entry_recalc_hours ON public.time_entries;
CREATE TRIGGER time_entry_recalc_hours AFTER INSERT OR UPDATE OR DELETE ON public.time_entries
  FOR EACH ROW EXECUTE FUNCTION public.tg_time_entry_recalc_hours();

CREATE OR REPLACE FUNCTION public.tg_auto_invoice_on_complete()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _svc_name text; _invoice_id uuid; _number text; _svc_date date; _terms int;
  _monthly boolean; _month date; _sort int; _hourly boolean; _rate int; _unit int; _hrs numeric;
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    IF EXISTS (SELECT 1 FROM public.invoices WHERE job_id = NEW.id)
       OR EXISTS (SELECT 1 FROM public.invoice_line_items WHERE job_id = NEW.id) THEN
      RETURN NEW;
    END IF;
    SELECT name INTO _svc_name FROM public.service_types WHERE id = NEW.service_type_id;
    _svc_date := (NEW.scheduled_start AT TIME ZONE 'America/Los_Angeles')::date;
    SELECT COALESCE((SELECT c.payment_terms_days FROM public.clients c WHERE c.id = NEW.client_id),
             (SELECT t.payment_terms_days FROM public.tenants t WHERE t.id = NEW.tenant_id), 14) INTO _terms;
    SELECT COALESCE(c.bill_monthly, false) INTO _monthly FROM public.clients c WHERE c.id = NEW.client_id;
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
          currency, issue_date, due_date, payment_terms_days, cleanings_count, bundle_month)
        VALUES (NEW.tenant_id, NEW.client_id, NULL, _number, 'draft', 0, 0, 0, 0, 'usd',
          (_month + interval '1 month' - interval '1 day')::date,
          (_month + interval '1 month' - interval '1 day' + (_terms || ' days')::interval)::date, _terms, 0, _month)
        RETURNING id INTO _invoice_id;
      END IF;
      SELECT COALESCE(max(sort_order) + 1, 0) INTO _sort FROM public.invoice_line_items WHERE invoice_id = _invoice_id;
    ELSE
      _number := public.next_invoice_number(NEW.tenant_id);
      INSERT INTO public.invoices (tenant_id, client_id, job_id, number, status, amount_cents, subtotal_cents, surcharge_cents, total_cents,
        currency, issue_date, due_date, payment_terms_days)
      VALUES (NEW.tenant_id, NEW.client_id, NEW.id, _number, 'draft', 0, 0, 0, 0, 'usd',
        CURRENT_DATE, CURRENT_DATE + (_terms || ' days')::interval, _terms)
      RETURNING id INTO _invoice_id;
      _sort := 0;
    END IF;

    INSERT INTO public.invoice_line_items (invoice_id, tenant_id, job_id, description, quantity, unit_price_cents, line_total_cents, service_date, sort_order, hours)
    VALUES (_invoice_id, NEW.tenant_id, NEW.id,
      COALESCE(_svc_name, 'Cleaning') || ' — ' || to_char(_svc_date, 'FMMonth FMDD, YYYY'),
      1, _unit, CASE WHEN _hourly THEN 0 ELSE _unit END, _svc_date, _sort, _hrs);
    IF _hourly THEN PERFORM public.recalc_job_hours(NEW.id); END IF;
    PERFORM public.recalc_invoice_totals(_invoice_id);
    IF _monthly THEN
      UPDATE public.invoices SET cleanings_count = (SELECT count(*) FROM public.invoice_line_items WHERE invoice_id = _invoice_id) WHERE id = _invoice_id;
    END IF;
  END IF;
  RETURN NEW;
END $function$;