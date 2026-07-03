
-- 1. Backfill service_address on clients from first property, split name
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS billing_address text,
  ADD COLUMN IF NOT EXISTS service_address text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

UPDATE public.clients c
SET first_name = COALESCE(first_name, split_part(name, ' ', 1)),
    last_name  = COALESCE(last_name, NULLIF(regexp_replace(name, '^\S+\s*', ''), ''));

-- Pull first property address into clients.service_address (if properties exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='properties') THEN
    EXECUTE $sql$
      UPDATE public.clients c
      SET service_address = p.addr
      FROM (
        SELECT DISTINCT ON (client_id) client_id,
          concat_ws(', ',
            NULLIF(address_line1,''),
            NULLIF(address_line2,''),
            NULLIF(city,''),
            NULLIF(state,''),
            NULLIF(postal_code,'')
          ) AS addr
        FROM public.properties
        ORDER BY client_id, created_at NULLS LAST
      ) p
      WHERE p.client_id = c.id AND c.service_address IS NULL
    $sql$;
  END IF;
END $$;

-- Now drop old columns/table
ALTER TABLE public.clients DROP COLUMN IF EXISTS name;
ALTER TABLE public.clients DROP COLUMN IF EXISTS notes;
DROP TABLE IF EXISTS public.properties CASCADE;

-- 2. property_specs
CREATE TABLE public.property_specs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  square_footage int,
  bedrooms int,
  bathrooms numeric(3,1),
  key_location text,
  access_notes text,
  pets text,
  parking_notes text,
  special_instructions text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_specs TO authenticated;
GRANT ALL ON public.property_specs TO service_role;
ALTER TABLE public.property_specs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_read_specs" ON public.property_specs FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "tenant_write_specs" ON public.property_specs FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE TRIGGER trg_property_specs_updated BEFORE UPDATE ON public.property_specs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 3. client_notes
CREATE TABLE public.client_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  note text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_notes TO authenticated;
GRANT ALL ON public.client_notes TO service_role;
ALTER TABLE public.client_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_read_notes" ON public.client_notes FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "tenant_write_notes" ON public.client_notes FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- 4. client_photos
CREATE TABLE public.client_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  caption text,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_photos TO authenticated;
GRANT ALL ON public.client_photos TO service_role;
ALTER TABLE public.client_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_read_photos" ON public.client_photos FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "tenant_write_photos" ON public.client_photos FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- 5. Storage policies for client-photos bucket (tenant-isolated by folder = tenant_id)
CREATE POLICY "client_photos_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'client-photos' AND (storage.foldername(name))[1] = public.current_tenant_id()::text);
CREATE POLICY "client_photos_write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'client-photos' AND (storage.foldername(name))[1] = public.current_tenant_id()::text);
CREATE POLICY "client_photos_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'client-photos' AND (storage.foldername(name))[1] = public.current_tenant_id()::text);
CREATE POLICY "client_photos_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'client-photos' AND (storage.foldername(name))[1] = public.current_tenant_id()::text);
