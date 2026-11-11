ALTER TABLE public.sops ADD COLUMN IF NOT EXISTS name_uk text;
ALTER TABLE public.sops ADD COLUMN IF NOT EXISTS description_uk text;
COMMENT ON COLUMN public.sops.name_uk IS 'Ukrainian SOP name shown to Ukrainian-language users; falls back to name';
COMMENT ON COLUMN public.sops.description_uk IS 'Ukrainian SOP description shown to Ukrainian-language users; falls back to description';