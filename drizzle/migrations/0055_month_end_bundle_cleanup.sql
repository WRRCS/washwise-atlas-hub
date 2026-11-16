DO $mig$
DECLARE
  _clients uuid[] := ARRAY[
    '41b32d45-452a-4168-95f4-449bad6810f2','1b19716d-8ad2-4c40-ae86-e86235dffd88',
    '52c39eb8-eb95-4bcd-a442-a68a265dc163','6916f0d4-7a29-4825-b379-baf84bf78374',
    '4c65605d-ef07-4a20-9816-ceeba8662161','0eed6d7b-d5ea-4a92-8025-ae1d9a4708ba',
    '0a514cc9-2b1a-40b6-b8f3-ec9cc7d59f8a','02699f69-d38d-44b4-af34-871088488d32']::uuid[];
  r record;
BEGIN
  DELETE FROM public.invoice_line_items l USING public.invoices i, public.jobs j
   WHERE l.invoice_id = i.id AND i.client_id = ANY(_clients) AND i.status = 'draft' AND i.bundle_month IS NOT NULL
     AND j.id = l.job_id
     AND EXISTS (
       SELECT 1 FROM public.invoice_line_items l2 JOIN public.jobs j2 ON j2.id = l2.job_id
        WHERE l2.invoice_id = l.invoice_id AND l2.id <> l.id
          AND (j2.property_id IS NULL OR j.property_id IS NULL OR j2.property_id = j.property_id)
          AND j2.scheduled_start = j.scheduled_start
          AND l2.line_total_cents = l.line_total_cents
          AND (j2.created_at, j2.id) < (j.created_at, j.id));

  FOR r IN SELECT id, client_id FROM public.invoices
            WHERE client_id = ANY(_clients) AND status = 'draft' AND bundle_month IS NOT NULL LOOP
    PERFORM public.recalc_invoice_totals(r.id);
    UPDATE public.invoices i SET
      cleanings_count = (SELECT count(*) FROM public.invoice_line_items l WHERE l.invoice_id = i.id),
      property_id = COALESCE(i.property_id, (
        SELECT CASE WHEN count(*) = 1 THEN min(p.id::text)::uuid END
          FROM public.client_properties p WHERE p.client_id = r.client_id))
    WHERE i.id = r.id;
  END LOOP;
END
$mig$;