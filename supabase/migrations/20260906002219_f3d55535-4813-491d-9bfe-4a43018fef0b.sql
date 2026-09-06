ALTER TABLE public.client_notes
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'management',
  ADD COLUMN IF NOT EXISTS property_id uuid REFERENCES public.client_properties(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE public.client_notes
    ADD CONSTRAINT client_notes_visibility_check CHECK (visibility IN ('management','team','client'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.client_properties
  ADD COLUMN IF NOT EXISTS property_type text,
  ADD COLUMN IF NOT EXISTS service_frequency text;