
CREATE TABLE public.service_type_inventory_recipes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  service_type_id UUID NOT NULL REFERENCES public.service_types(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  quantity_per_job NUMERIC NOT NULL DEFAULT 0 CHECK (quantity_per_job >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_type_id, inventory_item_id)
);
CREATE INDEX idx_recipes_tenant ON public.service_type_inventory_recipes(tenant_id);
CREATE INDEX idx_recipes_service ON public.service_type_inventory_recipes(service_type_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_type_inventory_recipes TO authenticated;
GRANT ALL ON public.service_type_inventory_recipes TO service_role;

ALTER TABLE public.service_type_inventory_recipes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recipes_select_tenant" ON public.service_type_inventory_recipes
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "recipes_owner_write" ON public.service_type_inventory_recipes
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'owner'))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'owner'));

CREATE TRIGGER tg_recipes_updated_at BEFORE UPDATE ON public.service_type_inventory_recipes
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Seed defaults using per-row inserts via a helper CTE-style approach
INSERT INTO public.service_type_inventory_recipes (tenant_id, service_type_id, inventory_item_id, quantity_per_job)
SELECT '00000000-0000-0000-0000-000000000001'::uuid, s.id, i.id, seed.qty
FROM (VALUES
  ('Airbnb Turnover','All-purpose cleaner',0.25),
  ('Airbnb Turnover','Glass cleaner',0.1),
  ('Airbnb Turnover','Microfiber cloths (pack of 12)',0.5),
  ('Airbnb Turnover','Paper towels',2),
  ('Airbnb Turnover','Trash bags — 13 gallon (box of 100)',0.02),

  ('Move-in Clean','All-purpose cleaner',0.5),
  ('Move-in Clean','Disinfectant',0.25),
  ('Move-in Clean','Microfiber cloths (pack of 12)',1),
  ('Move-in Clean','Paper towels',4),
  ('Move-in Clean','Trash bags — 55 gallon (box of 50)',0.08),

  ('Move-out Clean','All-purpose cleaner',0.5),
  ('Move-out Clean','Disinfectant',0.25),
  ('Move-out Clean','Microfiber cloths (pack of 12)',1),
  ('Move-out Clean','Paper towels',4),
  ('Move-out Clean','Trash bags — 55 gallon (box of 50)',0.08),

  ('Apartment Move-in','All-purpose cleaner',0.5),
  ('Apartment Move-in','Disinfectant',0.25),
  ('Apartment Move-in','Microfiber cloths (pack of 12)',1),
  ('Apartment Move-in','Paper towels',4),
  ('Apartment Move-in','Trash bags — 55 gallon (box of 50)',0.08),

  ('Apartment Move-out','All-purpose cleaner',0.5),
  ('Apartment Move-out','Disinfectant',0.25),
  ('Apartment Move-out','Microfiber cloths (pack of 12)',1),
  ('Apartment Move-out','Paper towels',4),
  ('Apartment Move-out','Trash bags — 55 gallon (box of 50)',0.08),

  ('Residential Clean','All-purpose cleaner',0.25),
  ('Residential Clean','Glass cleaner',0.1),
  ('Residential Clean','Microfiber cloths (pack of 12)',0.25),
  ('Residential Clean','Paper towels',1),

  ('Commercial Clean','All-purpose cleaner',0.5),
  ('Commercial Clean','Disinfectant',0.5),
  ('Commercial Clean','Microfiber cloths (pack of 12)',1),
  ('Commercial Clean','Paper towels',3)
) AS seed(service_name, item_name, qty)
JOIN public.service_types s ON s.name = seed.service_name
JOIN public.inventory_items i ON i.name = seed.item_name
ON CONFLICT (service_type_id, inventory_item_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.tg_auto_inventory_on_complete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    IF EXISTS (SELECT 1 FROM public.inventory_transactions WHERE job_id = NEW.id AND reason = 'job_usage') THEN
      RETURN NEW;
    END IF;
    INSERT INTO public.inventory_transactions (tenant_id, item_id, change_amount, reason, job_id, notes)
    SELECT NEW.tenant_id, r.inventory_item_id, -r.quantity_per_job, 'job_usage', NEW.id, 'auto: recipe'
      FROM public.service_type_inventory_recipes r
     WHERE r.service_type_id = NEW.service_type_id AND r.quantity_per_job > 0;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_auto_inventory_on_complete ON public.jobs;
CREATE TRIGGER tg_auto_inventory_on_complete
  AFTER UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_auto_inventory_on_complete();
