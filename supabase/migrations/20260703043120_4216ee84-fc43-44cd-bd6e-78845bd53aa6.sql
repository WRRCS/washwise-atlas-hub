
CREATE TYPE public.email_trigger_event AS ENUM (
  'booking_confirmation','appointment_reminder','invoice_sent','invoice_overdue','job_completed_thankyou','review_request'
);

CREATE TABLE public.quote_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  service_type_id uuid REFERENCES public.service_types(id) ON DELETE SET NULL,
  header_html text NOT NULL DEFAULT '',
  body_html text NOT NULL DEFAULT '',
  footer_html text NOT NULL DEFAULT '',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quote_templates TO authenticated;
GRANT ALL ON public.quote_templates TO service_role;
ALTER TABLE public.quote_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quote_templates tenant read" ON public.quote_templates FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "quote_templates owner write" ON public.quote_templates FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());
CREATE TRIGGER trg_qt_updated BEFORE UPDATE ON public.quote_templates FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE UNIQUE INDEX quote_templates_default_per_service ON public.quote_templates(tenant_id, COALESCE(service_type_id::text,'__general__')) WHERE is_default;

CREATE TABLE public.email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  trigger_event public.email_trigger_event NOT NULL,
  subject text NOT NULL DEFAULT '',
  body_html text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_templates TO authenticated;
GRANT ALL ON public.email_templates TO service_role;
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "email_templates tenant read" ON public.email_templates FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "email_templates owner write" ON public.email_templates FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());
CREATE TRIGGER trg_et_updated BEFORE UPDATE ON public.email_templates FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.client_template_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  quote_template_id uuid REFERENCES public.quote_templates(id) ON DELETE SET NULL,
  email_template_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_template_preferences TO authenticated;
GRANT ALL ON public.client_template_preferences TO service_role;
ALTER TABLE public.client_template_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ctp tenant read" ON public.client_template_preferences FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "ctp owner write" ON public.client_template_preferences FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());
CREATE TRIGGER trg_ctp_updated BEFORE UPDATE ON public.client_template_preferences FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
