ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS service_address text, ADD COLUMN IF NOT EXISTS service_location_label text, ADD COLUMN IF NOT EXISTS location_needs_review boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.jobs.service_address IS 'Appointment-specific service address snapshot; never use client default on read.';
UPDATE public.jobs j SET service_address = p.address, service_location_label = p.label, location_needs_review = false FROM public.client_properties p WHERE j.property_id = p.id AND j.client_id = p.client_id AND j.tenant_id = p.tenant_id;
UPDATE public.jobs SET location_needs_review = true WHERE NULLIF(trim(service_address), '') IS NULL;
CREATE OR REPLACE FUNCTION public.tg_job_location_snapshot() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.client_properties%ROWTYPE;
BEGIN
 IF TG_OP = 'INSERT' OR NEW.property_id IS DISTINCT FROM OLD.property_id OR NEW.client_id IS DISTINCT FROM OLD.client_id THEN
  IF NEW.property_id IS NOT NULL THEN
   SELECT * INTO p FROM public.client_properties WHERE id = NEW.property_id AND client_id = NEW.client_id AND tenant_id = NEW.tenant_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Selected property does not belong to this client'; END IF;
   IF TG_OP = 'UPDATE' OR NULLIF(trim(NEW.service_address), '') IS NULL THEN NEW.service_address := p.address; NEW.service_location_label := p.label; END IF;
  END IF;
  IF NULLIF(trim(NEW.service_address), '') IS NULL THEN RAISE EXCEPTION 'Select a service location before saving this appointment'; END IF;
 END IF;
 NEW.location_needs_review := NULLIF(trim(NEW.service_address), '') IS NULL;
 RETURN NEW;
END $$;
CREATE TRIGGER job_location_snapshot BEFORE INSERT OR UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.tg_job_location_snapshot();
CREATE OR REPLACE FUNCTION public.tg_notification_job_location() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j public.jobs%ROWTYPE;
BEGIN
 IF NEW.payload->>'job_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
  SELECT * INTO j FROM public.jobs WHERE id = (NEW.payload->>'job_id')::uuid AND tenant_id = NEW.tenant_id;
  IF FOUND THEN NEW.payload := NEW.payload || jsonb_build_object('service_address', j.service_address, 'property_name', j.service_location_label, 'location', concat_ws(' — ', j.service_location_label, j.service_address)); END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notification_job_location BEFORE INSERT OR UPDATE OF payload ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.tg_notification_job_location();
UPDATE public.notifications n SET payload = n.payload || jsonb_build_object('service_address', j.service_address, 'property_name', j.service_location_label, 'location', concat_ws(' — ', j.service_location_label, j.service_address)) FROM public.jobs j WHERE n.tenant_id = j.tenant_id AND n.payload->>'job_id' = j.id::text AND n.status = 'pending';
CREATE OR REPLACE FUNCTION public.tg_refresh_pending_job_location() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF NEW.service_address IS DISTINCT FROM OLD.service_address OR NEW.service_location_label IS DISTINCT FROM OLD.service_location_label THEN
  UPDATE public.notifications SET payload = payload || jsonb_build_object('service_address', NEW.service_address, 'property_name', NEW.service_location_label, 'location', concat_ws(' — ', NEW.service_location_label, NEW.service_address)) WHERE tenant_id = NEW.tenant_id AND payload->>'job_id' = NEW.id::text AND status = 'pending';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER refresh_pending_job_location AFTER UPDATE OF service_address, service_location_label ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.tg_refresh_pending_job_location();