CREATE TABLE public.property_inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.client_properties(id) ON DELETE CASCADE,
  name text NOT NULL,
  name_uk text,
  kind text NOT NULL DEFAULT 'level' CHECK (kind IN ('level','count')),
  unit text,
  unit_uk text,
  position integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, name)
);
CREATE INDEX property_inventory_items_property_idx ON public.property_inventory_items(property_id, position);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_inventory_items TO authenticated;
GRANT ALL ON public.property_inventory_items TO service_role;
ALTER TABLE public.property_inventory_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant reads property inventory items" ON public.property_inventory_items
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "Staff manage property inventory items" ON public.property_inventory_items
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager());

CREATE TABLE public.job_inventory_checks (
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.property_inventory_items(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  level text CHECK (level IN ('high','med','low','out')),
  quantity integer CHECK (quantity >= 0 AND quantity <= 9999),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, item_id)
);

GRANT SELECT ON public.job_inventory_checks TO authenticated;
GRANT ALL ON public.job_inventory_checks TO service_role;
ALTER TABLE public.job_inventory_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Assigned cleaners and staff read inventory checks" ON public.job_inventory_checks
  FOR SELECT TO authenticated USING (
    tenant_id = public.current_tenant_id() AND (
      public.is_owner_or_manager()
      OR EXISTS (SELECT 1 FROM public.job_employees je WHERE je.job_id = job_inventory_checks.job_id AND je.employee_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_inventory_checks.job_id AND j.assigned_to = auth.uid())
    )
  );

CREATE OR REPLACE FUNCTION public.save_job_inventory(_job uuid, _item uuid, _level text, _quantity integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _tenant uuid := public.current_tenant_id();
  _j record;
  _i record;
BEGIN
  IF _uid IS NULL OR _tenant IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  SELECT id, tenant_id, property_id, status, assigned_to INTO _j FROM public.jobs WHERE id = _job;
  IF _j.id IS NULL OR _j.tenant_id <> _tenant THEN RAISE EXCEPTION 'Appointment not found'; END IF;
  IF _j.status = 'canceled' THEN RAISE EXCEPTION 'This appointment was canceled'; END IF;
  IF NOT (public.is_owner_or_manager()
          OR _j.assigned_to = _uid
          OR EXISTS (SELECT 1 FROM public.job_employees je WHERE je.job_id = _job AND je.employee_id = _uid)) THEN
    RAISE EXCEPTION 'Only cleaners on this appointment can update its inventory';
  END IF;
  SELECT id, tenant_id, property_id, kind, is_active INTO _i FROM public.property_inventory_items WHERE id = _item;
  IF _i.id IS NULL OR _i.tenant_id <> _tenant OR _i.property_id IS DISTINCT FROM _j.property_id THEN
    RAISE EXCEPTION 'This item is not on this property''s inventory';
  END IF;
  IF _i.kind = 'level' THEN
    IF _quantity IS NOT NULL THEN RAISE EXCEPTION 'Choose High, Med, Low or Out for this item'; END IF;
    IF _level IS NOT NULL AND _level NOT IN ('high','med','low','out') THEN RAISE EXCEPTION 'Choose High, Med, Low or Out for this item'; END IF;
  ELSE
    IF _level IS NOT NULL THEN RAISE EXCEPTION 'Type the number for this item'; END IF;
    IF _quantity IS NOT NULL AND (_quantity < 0 OR _quantity > 9999) THEN RAISE EXCEPTION 'Type a whole number from 0 to 9999'; END IF;
  END IF;
  IF _level IS NULL AND _quantity IS NULL THEN
    DELETE FROM public.job_inventory_checks WHERE job_id = _job AND item_id = _item;
    RETURN;
  END IF;
  INSERT INTO public.job_inventory_checks (job_id, item_id, tenant_id, level, quantity, updated_by, updated_at)
  VALUES (_job, _item, _tenant, _level, _quantity, _uid, now())
  ON CONFLICT (job_id, item_id) DO UPDATE
    SET level = EXCLUDED.level, quantity = EXCLUDED.quantity, updated_by = EXCLUDED.updated_by, updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.save_job_inventory(uuid, uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_job_inventory(uuid, uuid, text, integer) TO authenticated;