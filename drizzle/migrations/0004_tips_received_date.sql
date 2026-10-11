ALTER TABLE public.tips ADD COLUMN IF NOT EXISTS received_date date;
UPDATE public.tips SET received_date = (created_at AT TIME ZONE 'America/Los_Angeles')::date WHERE received_date IS NULL;