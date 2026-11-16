-- Month-end-only billing: monthly clients collect every completed cleaning on one draft that names its property.
CREATE OR REPLACE FUNCTION public.tg_auto_invoice_on_complete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _svc_name text; _invoice_id uuid; _number text; _svc_date date; _terms int;
  _monthly boolean; _month date; _sort int; _hourly boolean; _rate int; _unit int; _hrs numeric;
  _prop_label text; _prop_address text; _details text;
  _msg text; _terms_text text; _prop_rate int;
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
    SELECT t.invoice_message_default, t.invoice_terms_default INTO _msg, _terms_text
      FROM public.tenants t WHERE t.id = NEW.tenant_id;
    IF NEW.property_id IS NOT NULL THEN
      SELECT p.label, p.address, CASE WHEN p.pricing_type = 'hourly' AND COALESCE(p.price_cents,0) > 0 THEN p.price_cents END
        INTO _prop_label, _prop_address, _prop_rate
        FROM public.client_properties p
        WHERE p.id = NEW.property_id AND p.client_id = NEW.client_id AND p.tenant_id = NEW.tenant_id;
    END IF;
    _details := NULLIF(trim(both ' ' from
      concat_ws(' — ', NULLIF(COALESCE(_prop_label, ''), ''), NULLIF(replace(COALESCE(_prop_address, ''), E'\n', ', '), ''))), '');
    _hourly := COALESCE(NEW.price_cents, 0) = 0;
    SELECT COALESCE(hourly_rate_cents, 4500) INTO _rate FROM public.tenants WHERE id = NEW.tenant_id;
    _rate := COALESCE(_prop_rate, _rate, 4500);
    _unit := CASE WHEN _hourly THEN _rate ELSE NEW.price_cents END;
    _hrs := CASE WHEN _hourly THEN 0 ELSE NULL END;

    IF _monthly THEN
      _month := date_trunc('month', _svc_date)::date;
      SELECT id INTO _invoice_id FROM public.invoices
        WHERE client_id = NEW.client_id AND bundle_month = _month AND status = 'draft' ORDER BY created_at LIMIT 1;
      IF _invoice_id IS NULL THEN
        _number := public.next_invoice_number(NEW.tenant_id, (_month + interval '1 month' - interval '1 day')::date);
        INSERT INTO public.invoices (tenant_id, client_id, job_id, number, status, amount_cents, subtotal_cents, surcharge_cents, total_cents,
          currency, issue_date, due_date, payment_terms_days, cleanings_count, bundle_month,
          subject, client_message, terms_text, property_id)
        VALUES (NEW.tenant_id, NEW.client_id, NULL, _number, 'draft', 0, 0, 0, 0, 'usd',
          (_month + interval '1 month' - interval '1 day')::date,
          (_month + interval '1 month' - interval '1 day' + (_terms || ' days')::interval)::date, _terms, 0, _month,
          'Monthly cleaning services', _msg, _terms_text, NEW.property_id)
        RETURNING id INTO _invoice_id;
      END IF;
      SELECT COALESCE(max(sort_order) + 1, 0) INTO _sort FROM public.invoice_line_items WHERE invoice_id = _invoice_id;
    ELSE
      _number := public.next_invoice_number(NEW.tenant_id, CURRENT_DATE);
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
      -- The month-end invoice names its property only while every cleaning on it is at that property.
      UPDATE public.invoices SET property_id = NULL WHERE id = _invoice_id AND property_id IS DISTINCT FROM NEW.property_id;
    END IF;
  END IF;
  RETURN NEW;
END $function$;

REVOKE EXECUTE ON FUNCTION public.tg_auto_invoice_on_complete() FROM PUBLIC, anon, authenticated;

-- Clients hear about an invoice only once staff send it, never when a draft is made.
CREATE OR REPLACE FUNCTION public.tg_enqueue_push_invoice()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.client_id IS NULL OR NEW.status IS DISTINCT FROM 'sent' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM 'sent' THEN RETURN NEW; END IF;
  PERFORM public.enqueue_notification(
    NEW.tenant_id, 'client', NEW.client_id, 'push', 'push_client_invoice',
    jsonb_build_object('invoice_number', NEW.number, 'total', '$' || (NEW.total_cents::numeric / 100)::text),
    now()
  );
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.tg_enqueue_push_invoice() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_push_invoice_created ON public.invoices;
DROP TRIGGER IF EXISTS trg_push_invoice_sent ON public.invoices;
CREATE TRIGGER trg_push_invoice_sent AFTER INSERT OR UPDATE OF status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.tg_enqueue_push_invoice();
UPDATE public.notifications n SET recalled_at = now(), error = 'suppressed: invoice still a draft'
  FROM public.invoices i
  WHERE n.template_name = 'push_client_invoice' AND n.status = 'pending' AND n.recalled_at IS NULL
    AND i.client_id = n.recipient_id AND i.number = n.payload->>'invoice_number' AND i.status = 'draft';

-- Leslie's month-end-only clients: Olsen Auto Body, Marcon Metal, Birch Bay Water & Sewer, Chuckanut Bay Foods,
-- Angela Leja, John & Nancy (Barton), Jennica, Bobbie Chalou.
DO $mig$
DECLARE
  _clients uuid[] := ARRAY[
    '41b32d45-452a-4168-95f4-449bad6810f2','1b19716d-8ad2-4c40-ae86-e86235dffd88',
    '52c39eb8-eb95-4bcd-a442-a68a265dc163','6916f0d4-7a29-4825-b379-baf84bf78374',
    '4c65605d-ef07-4a20-9816-ceeba8662161','0eed6d7b-d5ea-4a92-8025-ae1d9a4708ba',
    '0a514cc9-2b1a-40b6-b8f3-ec9cc7d59f8a','02699f69-d38d-44b4-af34-871088488d32']::uuid[];
  r record; _bundle uuid; _num text; _terms int; _msg text; _terms_text text; _last date; _sort int; _prop uuid;
BEGIN
  UPDATE public.clients SET bill_monthly = true WHERE id = ANY(_clients);

  -- $0 lines left on unsent drafts for cleanings that were deleted.
  DELETE FROM public.invoice_line_items l USING public.invoices i
   WHERE l.invoice_id = i.id AND i.client_id = ANY(_clients) AND i.status = 'draft' AND i.bundle_month IS NULL
     AND COALESCE(l.line_total_cents, 0) = 0
     AND (l.job_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = l.job_id));

  -- Move every line from unsent per-visit drafts onto that month's single draft, keeping prices and hours as saved.
  FOR r IN
    SELECT l.id AS line_id, i.tenant_id, i.client_id, l.job_id,
           date_trunc('month', COALESCE(l.service_date, i.issue_date))::date AS m
      FROM public.invoice_line_items l JOIN public.invoices i ON i.id = l.invoice_id
     WHERE i.client_id = ANY(_clients) AND i.status = 'draft' AND i.bundle_month IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.invoice_id = i.id)
     ORDER BY i.client_id, COALESCE(l.service_date, i.issue_date), l.created_at
  LOOP
    SELECT id INTO _bundle FROM public.invoices
     WHERE client_id = r.client_id AND bundle_month = r.m AND status = 'draft' ORDER BY created_at LIMIT 1;
    IF _bundle IS NULL THEN
      SELECT COALESCE(c.payment_terms_days, t.payment_terms_days, 14), t.invoice_message_default, t.invoice_terms_default
        INTO _terms, _msg, _terms_text
        FROM public.clients c JOIN public.tenants t ON t.id = c.tenant_id WHERE c.id = r.client_id;
      _last := (r.m + interval '1 month' - interval '1 day')::date;
      SELECT property_id INTO _prop FROM public.jobs WHERE id = r.job_id;
      _num := public.next_invoice_number(r.tenant_id, _last);
      INSERT INTO public.invoices (tenant_id, client_id, job_id, number, status, amount_cents, subtotal_cents, surcharge_cents, total_cents,
        currency, issue_date, due_date, payment_terms_days, cleanings_count, bundle_month, subject, client_message, terms_text, property_id)
      VALUES (r.tenant_id, r.client_id, NULL, _num, 'draft', 0, 0, 0, 0, 'usd', _last,
        (_last + (_terms || ' days')::interval)::date, _terms, 0, r.m, 'Monthly cleaning services', _msg, _terms_text, _prop)
      RETURNING id INTO _bundle;
    END IF;
    SELECT COALESCE(max(sort_order) + 1, 0) INTO _sort FROM public.invoice_line_items WHERE invoice_id = _bundle;
    UPDATE public.invoice_line_items SET invoice_id = _bundle, sort_order = _sort WHERE id = r.line_id;
  END LOOP;

  DELETE FROM public.invoices i
   WHERE i.client_id = ANY(_clients) AND i.status = 'draft' AND i.bundle_month IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.invoice_line_items l WHERE l.invoice_id = i.id)
     AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.invoice_id = i.id)
     AND NOT EXISTS (SELECT 1 FROM public.tips t WHERE t.invoice_id = i.id);

  -- Older duplicate copies of one cleaning (same place, same start, same price) bill once.
  DELETE FROM public.invoice_line_items l USING public.invoices i, public.jobs j
   WHERE l.invoice_id = i.id AND i.client_id = ANY(_clients) AND i.status = 'draft' AND i.bundle_month IS NOT NULL
     AND j.id = l.job_id
     AND EXISTS (
       SELECT 1 FROM public.invoice_line_items l2 JOIN public.jobs j2 ON j2.id = l2.job_id
        WHERE l2.invoice_id = l.invoice_id AND l2.id <> l.id
          AND j2.property_id IS NOT DISTINCT FROM j.property_id AND j2.scheduled_start = j.scheduled_start
          AND l2.line_total_cents = l.line_total_cents
          AND (j2.created_at, j2.id) < (j.created_at, j.id));

  FOR r IN SELECT id FROM public.invoices WHERE client_id = ANY(_clients) AND status = 'draft' AND bundle_month IS NOT NULL LOOP
    PERFORM public.recalc_invoice_totals(r.id);
    UPDATE public.invoices i SET
      cleanings_count = (SELECT count(*) FROM public.invoice_line_items l WHERE l.invoice_id = i.id),
      property_id = COALESCE(i.property_id, (
        SELECT CASE WHEN count(DISTINCT j.property_id) = 1 AND bool_and(j.property_id IS NOT NULL) THEN min(j.property_id::text)::uuid END
          FROM public.invoice_line_items l JOIN public.jobs j ON j.id = l.job_id WHERE l.invoice_id = i.id))
    WHERE i.id = r.id;
  END LOOP;

  -- No "cleaning complete" message drafts for month-end-only clients.
  UPDATE public.client_message_drafts SET status = 'discarded', updated_at = now()
   WHERE client_id = ANY(_clients) AND status = 'draft';
END
$mig$;