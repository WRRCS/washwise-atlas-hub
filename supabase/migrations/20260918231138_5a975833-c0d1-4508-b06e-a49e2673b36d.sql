CREATE TABLE public.caddy_template_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'each',
  default_qty numeric NOT NULL DEFAULT 1,
  inventory_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.caddy_template_items TO authenticated;
GRANT ALL ON public.caddy_template_items TO service_role;
ALTER TABLE public.caddy_template_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "caddy_template_select" ON public.caddy_template_items
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "caddy_template_write" ON public.caddy_template_items
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager());

CREATE TABLE public.employee_caddy_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  template_item_id uuid REFERENCES public.caddy_template_items(id) ON DELETE SET NULL,
  inventory_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'each',
  qty numeric NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX employee_caddy_items_employee_idx ON public.employee_caddy_items(employee_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_caddy_items TO authenticated;
GRANT ALL ON public.employee_caddy_items TO service_role;
ALTER TABLE public.employee_caddy_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "caddy_items_select" ON public.employee_caddy_items
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND (employee_id = auth.uid() OR public.is_owner_or_manager()));
CREATE POLICY "caddy_items_insert" ON public.employee_caddy_items
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND (employee_id = auth.uid() OR public.is_owner_or_manager()));
CREATE POLICY "caddy_items_update" ON public.employee_caddy_items
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND (employee_id = auth.uid() OR public.is_owner_or_manager()))
  WITH CHECK (tenant_id = public.current_tenant_id() AND (employee_id = auth.uid() OR public.is_owner_or_manager()));
CREATE POLICY "caddy_items_delete" ON public.employee_caddy_items
  FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND (employee_id = auth.uid() OR public.is_owner_or_manager()));

CREATE TRIGGER caddy_template_items_updated_at BEFORE UPDATE ON public.caddy_template_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER employee_caddy_items_updated_at BEFORE UPDATE ON public.employee_caddy_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();