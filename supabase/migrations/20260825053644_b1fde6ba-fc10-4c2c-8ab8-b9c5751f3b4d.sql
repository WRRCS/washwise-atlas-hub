ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_assigned_to_fkey;
UPDATE public.jobs j SET assigned_to = NULL WHERE assigned_to IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = j.assigned_to);
ALTER TABLE public.jobs ADD CONSTRAINT jobs_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.profiles(id) ON DELETE SET NULL;