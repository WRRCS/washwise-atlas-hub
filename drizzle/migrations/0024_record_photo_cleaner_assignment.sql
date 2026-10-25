ALTER TABLE public.job_photos ADD COLUMN IF NOT EXISTS cleaner_assignment_id uuid;
COMMENT ON COLUMN public.job_photos.cleaner_assignment_id IS 'Assignment identity at upload time; retained as evidence if the cleaner is later unassigned. Legacy association is not independent uploader evidence.';
UPDATE public.job_photos p SET cleaner_assignment_id=je.id FROM public.job_employees je WHERE je.job_id=p.job_id AND je.employee_id=p.uploaded_by AND je.tenant_id=p.tenant_id AND p.cleaner_assignment_id IS NULL;
CREATE OR REPLACE FUNCTION public.enforce_job_photo_upload_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE assignment_id uuid;
BEGIN
IF TG_OP='UPDATE' AND (NEW.job_id IS DISTINCT FROM OLD.job_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by OR NEW.storage_path IS DISTINCT FROM OLD.storage_path OR NEW.cleaner_assignment_id IS DISTINCT FROM OLD.cleaner_assignment_id) THEN RAISE EXCEPTION 'Photo appointment and uploader identity cannot be changed'; END IF;
IF TG_OP='INSERT' AND auth.uid() IS NOT NULL THEN
IF NEW.uploaded_by IS DISTINCT FROM auth.uid() OR split_part(NEW.storage_path,'/',1) <> NEW.tenant_id::text OR split_part(NEW.storage_path,'/',2) <> NEW.job_id::text OR split_part(NEW.storage_path,'/',3) <> auth.uid()::text OR array_length(string_to_array(NEW.storage_path,'/'),1) <> 4 THEN RAISE EXCEPTION 'Photo upload belongs to a different cleaner or appointment. Please upload again.'; END IF;
SELECT je.id INTO assignment_id FROM public.job_employees je WHERE je.job_id=NEW.job_id AND je.employee_id=auth.uid() AND je.tenant_id=NEW.tenant_id;
IF assignment_id IS NULL AND NOT public.is_owner_or_manager() THEN RAISE EXCEPTION 'You are not assigned to this appointment'; END IF;
NEW.cleaner_assignment_id := assignment_id;
NEW.attribution_review_reason := NULL;
END IF;
RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS enforce_job_photo_upload_identity ON public.job_photos;
CREATE TRIGGER enforce_job_photo_upload_identity BEFORE INSERT OR UPDATE ON public.job_photos FOR EACH ROW EXECUTE FUNCTION public.enforce_job_photo_upload_identity();