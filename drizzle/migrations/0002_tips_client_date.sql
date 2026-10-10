ALTER TABLE public.tips ADD COLUMN client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL;
ALTER TABLE public.tips ADD COLUMN clean_date date;