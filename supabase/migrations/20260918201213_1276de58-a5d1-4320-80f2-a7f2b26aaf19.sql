ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS language text;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_language_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_language_check CHECK (language IS NULL OR language IN ('en','uk'));
ALTER TABLE public.sop_steps ADD COLUMN IF NOT EXISTS title_uk text;
ALTER TABLE public.sop_steps ADD COLUMN IF NOT EXISTS description_uk text;
ALTER TABLE public.job_sop_items ADD COLUMN IF NOT EXISTS label_uk text;