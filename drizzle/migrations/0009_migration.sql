ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS allow_card boolean NOT NULL DEFAULT true, ADD COLUMN IF NOT EXISTS allow_venmo boolean NOT NULL DEFAULT true;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS pays_by_check boolean NOT NULL DEFAULT false;
GRANT SELECT (allow_card, allow_venmo), UPDATE (allow_card, allow_venmo) ON public.invoices TO authenticated;
GRANT SELECT (pays_by_check), UPDATE (pays_by_check) ON public.clients TO authenticated;