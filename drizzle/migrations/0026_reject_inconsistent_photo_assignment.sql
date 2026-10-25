CREATE OR REPLACE FUNCTION public.enforce_job_photo_upload_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE assignment_id uuid; actor uuid := auth.uid(); expected_prefix text;
BEGIN
IF TG_OP='UPDATE' THEN
IF NEW.job_id IS DISTINCT FROM OLD.job_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by OR NEW.storage_path IS DISTINCT FROM OLD.storage_path OR NEW.cleaner_assignment_id IS DISTINCT FROM OLD.cleaner_assignment_id THEN RAISE EXCEPTION 'Photo appointment and uploader identity cannot be changed'; END IF;
RETURN NEW;
END IF;
IF NEW.uploaded_by IS NULL OR NEW.job_id IS NULL OR NEW.tenant_id IS NULL OR NEW.storage_path IS NULL OR NEW.storage_path='' THEN RAISE EXCEPTION 'Photo ownership is missing. Please reopen the appointment and upload again.'; END IF;
IF actor IS NOT NULL AND NEW.uploaded_by IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Photo uploader does not match your login'; END IF;
IF NOT EXISTS(SELECT 1 FROM public.jobs j WHERE j.id=NEW.job_id AND j.tenant_id=NEW.tenant_id) OR NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=NEW.uploaded_by AND p.tenant_id=NEW.tenant_id AND p.is_active) THEN RAISE EXCEPTION 'Photo appointment or employee ownership is inconsistent'; END IF;
expected_prefix := NEW.tenant_id::text || '/' || NEW.job_id::text || '/' || NEW.uploaded_by::text || '/';
IF left(NEW.storage_path,length(expected_prefix)) IS DISTINCT FROM expected_prefix OR array_length(string_to_array(NEW.storage_path,'/'),1) IS DISTINCT FROM 4 OR split_part(NEW.storage_path,'/',4) IN ('','.','..') THEN RAISE EXCEPTION 'Photo upload belongs to a different cleaner or appointment. Please upload again.'; END IF;
SELECT je.id INTO assignment_id FROM public.job_employees je WHERE je.job_id=NEW.job_id AND je.employee_id=NEW.uploaded_by AND je.tenant_id=NEW.tenant_id;
IF assignment_id IS NULL THEN
IF NOT EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id=NEW.uploaded_by AND ur.tenant_id=NEW.tenant_id AND ur.role IN ('owner','manager')) THEN RAISE EXCEPTION 'You are not assigned to this appointment'; END IF;
IF NEW.cleaner_assignment_id IS NOT NULL OR split_part(NEW.storage_path,'/',4) NOT LIKE 'staff-%' THEN RAISE EXCEPTION 'Photo cleaner assignment is inconsistent'; END IF;
ELSE
IF NEW.cleaner_assignment_id IS NOT NULL AND NEW.cleaner_assignment_id IS DISTINCT FROM assignment_id THEN RAISE EXCEPTION 'Photo cleaner assignment is inconsistent'; END IF;
IF left(split_part(NEW.storage_path,'/',4),37) IS DISTINCT FROM assignment_id::text || '-' THEN RAISE EXCEPTION 'Cleaner assignment changed during upload. Reopen the appointment and upload again.'; END IF;
END IF;
NEW.cleaner_assignment_id := assignment_id;
NEW.attribution_review_reason := NULL;
RETURN NEW;
END $$;