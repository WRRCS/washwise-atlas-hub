
-- Activity log table
CREATE TABLE public.activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.activity_log TO authenticated;
GRANT ALL ON public.activity_log TO service_role;

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members can read activity"
  ON public.activity_log FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "tenant members can insert activity"
  ON public.activity_log FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE INDEX idx_activity_log_tenant_created ON public.activity_log(tenant_id, created_at DESC);

-- Helper: get client full name
CREATE OR REPLACE FUNCTION public._client_name(_client_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(NULLIF(TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')), ''), 'Unknown')
  FROM public.clients WHERE id = _client_id;
$$;

-- Trigger: job created
CREATE OR REPLACE FUNCTION public.tg_activity_job_created()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.activity_log (tenant_id, actor_id, action_type, entity_type, entity_id, description)
  VALUES (
    NEW.tenant_id, auth.uid(), 'job_created', 'job', NEW.id,
    'New job scheduled for ' || public._client_name(NEW.client_id) ||
    ' on ' || to_char(NEW.scheduled_start AT TIME ZONE 'UTC', 'FMMon FMDD, YYYY')
  );
  RETURN NEW;
END $$;

CREATE TRIGGER trg_activity_job_created
AFTER INSERT ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.tg_activity_job_created();

-- Trigger: job completed
CREATE OR REPLACE FUNCTION public.tg_activity_job_completed()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _emp TEXT;
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    SELECT string_agg(p.full_name, ', ') INTO _emp
      FROM public.job_employees je JOIN public.profiles p ON p.id = je.employee_id
      WHERE je.job_id = NEW.id;
    INSERT INTO public.activity_log (tenant_id, actor_id, action_type, entity_type, entity_id, description)
    VALUES (
      NEW.tenant_id, auth.uid(), 'job_completed', 'job', NEW.id,
      COALESCE(_emp, 'A cleaner') || ' completed job for ' || public._client_name(NEW.client_id)
    );
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_activity_job_completed
AFTER UPDATE ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.tg_activity_job_completed();

-- Trigger: invoice created
CREATE OR REPLACE FUNCTION public.tg_activity_invoice_created()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.activity_log (tenant_id, actor_id, action_type, entity_type, entity_id, description)
  VALUES (
    NEW.tenant_id, auth.uid(), 'invoice_created', 'invoice', NEW.id,
    'Invoice ' || NEW.number || ' created for ' || public._client_name(NEW.client_id)
  );
  RETURN NEW;
END $$;

CREATE TRIGGER trg_activity_invoice_created
AFTER INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.tg_activity_invoice_created();

-- Trigger: invoice paid
CREATE OR REPLACE FUNCTION public.tg_activity_invoice_paid()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' THEN
    INSERT INTO public.activity_log (tenant_id, actor_id, action_type, entity_type, entity_id, description)
    VALUES (
      NEW.tenant_id, auth.uid(), 'invoice_paid', 'invoice', NEW.id,
      'Invoice ' || NEW.number || ' paid by ' || public._client_name(NEW.client_id)
    );
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_activity_invoice_paid
AFTER UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.tg_activity_invoice_paid();

-- Trigger: client created
CREATE OR REPLACE FUNCTION public.tg_activity_client_created()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.activity_log (tenant_id, actor_id, action_type, entity_type, entity_id, description)
  VALUES (
    NEW.tenant_id, auth.uid(), 'client_created', 'client', NEW.id,
    'New client added: ' || COALESCE(NULLIF(TRIM(COALESCE(NEW.first_name,'') || ' ' || COALESCE(NEW.last_name,'')), ''), 'Unknown')
  );
  RETURN NEW;
END $$;

CREATE TRIGGER trg_activity_client_created
AFTER INSERT ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.tg_activity_client_created();
