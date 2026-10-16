CREATE OR REPLACE FUNCTION public.recalc_job_hours(_job uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _hrs numeric; r record;
BEGIN
  SELECT round(COALESCE(sum(extract(epoch FROM (left_at - arrived_at))),0)/3600.0, 2)
    INTO _hrs FROM public.job_visits WHERE job_id = _job AND left_at IS NOT NULL;
  FOR r IN SELECT li.id, li.invoice_id, li.unit_price_cents FROM public.invoice_line_items li
           JOIN public.invoices i ON i.id = li.invoice_id
           WHERE li.job_id = _job AND li.hours IS NOT NULL AND NOT li.hours_manual AND i.status = 'draft'
  LOOP
    UPDATE public.invoice_line_items SET hours = _hrs, line_total_cents = round(_hrs * unit_price_cents)::int WHERE id = r.id;
    PERFORM public.recalc_invoice_totals(r.invoice_id);
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION public.recalc_job_hours(uuid) FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS time_entry_recalc_hours ON public.time_entries;
DROP TRIGGER IF EXISTS job_visit_recalc_hours ON public.job_visits;
CREATE TRIGGER job_visit_recalc_hours AFTER INSERT OR UPDATE OR DELETE ON public.job_visits
  FOR EACH ROW EXECUTE FUNCTION public.tg_time_entry_recalc_hours();