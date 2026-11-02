ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS property_type text;
COMMENT ON COLUMN public.jobs.property_type IS 'Appointment property-type snapshot, separate from service type. Existing appointments are not rewritten when property type changes.';
CREATE OR REPLACE FUNCTION public.tg_job_property_type() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE p public.client_properties%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.property_id IS NOT DISTINCT FROM OLD.property_id THEN RETURN NEW; END IF;
    NEW.property_type := NULL;
  END IF;
  IF NEW.property_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO p FROM public.client_properties WHERE id = NEW.property_id AND client_id = NEW.client_id AND tenant_id = NEW.tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Select a property belonging to this client'; END IF;
  IF NULLIF(btrim(p.property_type), '') IS NULL AND NULLIF(btrim(NEW.property_type), '') IS NOT NULL THEN
    IF auth.uid() IS NOT NULL AND NOT public.is_owner_or_manager() THEN RAISE EXCEPTION 'Only owners and managers can save property types'; END IF;
    IF length(btrim(NEW.property_type)) > 60 THEN RAISE EXCEPTION 'Property type must be 60 characters or fewer'; END IF;
    UPDATE public.client_properties SET property_type = btrim(NEW.property_type) WHERE id = p.id;
    NEW.property_type := btrim(NEW.property_type);
  ELSE
    NEW.property_type := NULLIF(btrim(p.property_type), '');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS job_property_type_snapshot ON public.jobs;
CREATE TRIGGER job_property_type_snapshot BEFORE INSERT OR UPDATE OF property_id ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.tg_job_property_type();