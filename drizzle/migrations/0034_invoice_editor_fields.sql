-- Invoice editor: subject, service property, discount, tax, client message, terms
ALTER TABLE public.invoices
  ADD COLUMN subject TEXT,
  ADD COLUMN property_id UUID REFERENCES public.client_properties(id),
  ADD COLUMN discount_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN tax_rate_bp INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN tax_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN client_message TEXT,
  ADD COLUMN terms_text TEXT;

-- Line items gain a beneath-the-name details text; description stays the line name
ALTER TABLE public.invoice_line_items ADD COLUMN details TEXT;

-- Reusable business defaults for the client message and contract/disclaimer
ALTER TABLE public.tenants
  ADD COLUMN invoice_message_default TEXT,
  ADD COLUMN invoice_terms_default TEXT;

-- Totals now account for discount and tax in addition to the card surcharge
CREATE OR REPLACE FUNCTION public.recalc_invoice_totals(_invoice uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.invoices i SET
    subtotal_cents = s.total,
    tax_cents = ROUND(GREATEST(s.total - COALESCE(i.discount_cents, 0), 0) * COALESCE(i.tax_rate_bp, 0) / 10000.0)::int,
    total_cents = GREATEST(s.total - COALESCE(i.discount_cents, 0), 0)
      + ROUND(GREATEST(s.total - COALESCE(i.discount_cents, 0), 0) * COALESCE(i.tax_rate_bp, 0) / 10000.0)::int
      + COALESCE(i.surcharge_cents, 0),
    amount_cents = GREATEST(s.total - COALESCE(i.discount_cents, 0), 0)
      + ROUND(GREATEST(s.total - COALESCE(i.discount_cents, 0), 0) * COALESCE(i.tax_rate_bp, 0) / 10000.0)::int
      + COALESCE(i.surcharge_cents, 0)
  FROM (SELECT COALESCE(sum(line_total_cents), 0)::int total FROM public.invoice_line_items WHERE invoice_id = _invoice) s
  WHERE i.id = _invoice;
$function$;