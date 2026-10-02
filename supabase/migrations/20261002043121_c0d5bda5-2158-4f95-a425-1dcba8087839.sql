ALTER TABLE public.client_properties ADD COLUMN IF NOT EXISTS sop text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS photo_ids uuid[] NOT NULL DEFAULT '{}';
UPDATE public.client_properties p SET sop = c.client_sop
FROM public.clients c
WHERE p.client_id = c.id AND p.is_primary AND p.sop IS NULL AND c.client_sop IS NOT NULL AND btrim(c.client_sop) <> '';