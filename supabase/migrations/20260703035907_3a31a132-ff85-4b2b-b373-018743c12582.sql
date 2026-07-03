
-- ============ inventory_items ============
CREATE TABLE public.inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT,
  unit TEXT NOT NULL DEFAULT 'each',
  quantity_on_hand NUMERIC NOT NULL DEFAULT 0,
  reorder_threshold NUMERIC NOT NULL DEFAULT 0,
  cost_per_unit_cents INTEGER NOT NULL DEFAULT 0,
  vendor_name TEXT,
  vendor_sku TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_items TO authenticated;
GRANT ALL ON public.inventory_items TO service_role;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members can view inventory items"
  ON public.inventory_items FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "owners manage inventory items"
  ON public.inventory_items FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());

CREATE TRIGGER trg_inventory_items_updated_at
  BEFORE UPDATE ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX idx_inventory_items_tenant ON public.inventory_items(tenant_id) WHERE is_active;

-- ============ inventory_transactions ============
CREATE TABLE public.inventory_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  change_amount NUMERIC NOT NULL,
  reason TEXT NOT NULL DEFAULT 'manual_adjustment',
  job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_transactions TO authenticated;
GRANT ALL ON public.inventory_transactions TO service_role;
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members view inventory tx"
  ON public.inventory_transactions FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "tenant members insert inventory tx"
  ON public.inventory_transactions FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "owners can delete inventory tx"
  ON public.inventory_transactions FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner());

CREATE INDEX idx_inventory_tx_item ON public.inventory_transactions(item_id, created_at DESC);
CREATE INDEX idx_inventory_tx_tenant ON public.inventory_transactions(tenant_id, created_at DESC);

-- Reason validation via trigger (avoid CHECK-with-domain rules)
CREATE OR REPLACE FUNCTION public.tg_inventory_tx_validate()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.reason NOT IN ('restock','job_usage','manual_adjustment','waste') THEN
    RAISE EXCEPTION 'Invalid reason: %', NEW.reason;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_inventory_tx_validate
  BEFORE INSERT OR UPDATE ON public.inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION public.tg_inventory_tx_validate();

-- Keep quantity_on_hand in sync
CREATE OR REPLACE FUNCTION public.tg_inventory_apply_tx()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.inventory_items
    SET quantity_on_hand = GREATEST(0, quantity_on_hand + NEW.change_amount)
    WHERE id = NEW.item_id;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_inventory_apply_tx
  AFTER INSERT ON public.inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION public.tg_inventory_apply_tx();

-- ============ Seed default items for Wash Rinse Repeat tenant ============
INSERT INTO public.inventory_items (tenant_id, name, unit, quantity_on_hand, reorder_threshold, cost_per_unit_cents)
VALUES
  ('00000000-0000-0000-0000-000000000001','All-purpose cleaner','gallon',0,2,0),
  ('00000000-0000-0000-0000-000000000001','Glass cleaner','bottle',0,3,0),
  ('00000000-0000-0000-0000-000000000001','Disinfectant','gallon',0,2,0),
  ('00000000-0000-0000-0000-000000000001','Microfiber cloths (pack of 12)','pack',0,2,0),
  ('00000000-0000-0000-0000-000000000001','Paper towels','roll',0,6,0),
  ('00000000-0000-0000-0000-000000000001','Trash bags — 13 gallon (box of 100)','box',0,1,0),
  ('00000000-0000-0000-0000-000000000001','Trash bags — 55 gallon (box of 50)','box',0,1,0),
  ('00000000-0000-0000-0000-000000000001','Toilet bowl cleaner','bottle',0,3,0),
  ('00000000-0000-0000-0000-000000000001','Floor cleaner','gallon',0,2,0),
  ('00000000-0000-0000-0000-000000000001','Vacuum bags (pack of 5)','pack',0,2,0),
  ('00000000-0000-0000-0000-000000000001','Sponges (pack of 6)','pack',0,2,0),
  ('00000000-0000-0000-0000-000000000001','Rubber gloves (box of 100)','box',0,1,0);
