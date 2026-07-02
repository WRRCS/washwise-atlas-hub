
-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('owner', 'employee');
CREATE TYPE public.job_status AS ENUM ('scheduled', 'in_progress', 'completed', 'canceled');
CREATE TYPE public.invoice_status AS ENUM ('draft', 'sent', 'paid', 'void');
CREATE TYPE public.service_kind AS ENUM ('airbnb_turnover','move_in','move_out','residential','apartment_move_in','apartment_move_out','commercial');

-- ============ TENANTS ============
CREATE TABLE public.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tenants TO authenticated;
GRANT ALL ON public.tenants TO service_role;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- Seed the single tenant
INSERT INTO public.tenants (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000001', 'Wash Rinse Repeat Cleaning', 'wash-rinse-repeat');

-- ============ PROFILES (staff) ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ============ USER ROLES ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE (user_id, tenant_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Helper functions (SECURITY DEFINER to avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'owner');
$$;

-- Profile RLS
CREATE POLICY "Staff can see profiles in tenant" ON public.profiles
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "User can update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (id = auth.uid());
CREATE POLICY "Owner can manage profiles" ON public.profiles
  FOR ALL TO authenticated USING (public.is_owner() AND tenant_id = public.current_tenant_id())
  WITH CHECK (public.is_owner() AND tenant_id = public.current_tenant_id());

-- Tenant RLS
CREATE POLICY "Staff can see own tenant" ON public.tenants
  FOR SELECT TO authenticated USING (id = public.current_tenant_id());

-- User roles RLS
CREATE POLICY "Users can see own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_owner());
CREATE POLICY "Owners manage roles" ON public.user_roles
  FOR ALL TO authenticated USING (public.is_owner() AND tenant_id = public.current_tenant_id())
  WITH CHECK (public.is_owner() AND tenant_id = public.current_tenant_id());

-- ============ SERVICE TYPES ============
CREATE TABLE public.service_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind service_kind NOT NULL,
  name TEXT NOT NULL,
  default_duration_minutes INT NOT NULL DEFAULT 120,
  default_price_cents INT NOT NULL DEFAULT 15000,
  sop_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_types TO authenticated;
GRANT ALL ON public.service_types TO service_role;
ALTER TABLE public.service_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read service types" ON public.service_types
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "Owners manage service types" ON public.service_types
  FOR ALL TO authenticated USING (public.is_owner() AND tenant_id = public.current_tenant_id())
  WITH CHECK (public.is_owner() AND tenant_id = public.current_tenant_id());

-- ============ CLIENTS ============
CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read clients" ON public.clients
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "Owners manage clients" ON public.clients
  FOR ALL TO authenticated USING (public.is_owner() AND tenant_id = public.current_tenant_id())
  WITH CHECK (public.is_owner() AND tenant_id = public.current_tenant_id());

-- ============ PROPERTIES ============
CREATE TABLE public.properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  nickname TEXT,
  address_line1 TEXT NOT NULL,
  address_line2 TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  access_notes TEXT,
  bedrooms INT,
  bathrooms NUMERIC,
  square_feet INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.properties TO authenticated;
GRANT ALL ON public.properties TO service_role;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read properties" ON public.properties
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "Owners manage properties" ON public.properties
  FOR ALL TO authenticated USING (public.is_owner() AND tenant_id = public.current_tenant_id())
  WITH CHECK (public.is_owner() AND tenant_id = public.current_tenant_id());

-- ============ JOBS ============
CREATE TABLE public.jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
  service_type_id UUID NOT NULL REFERENCES public.service_types(id) ON DELETE RESTRICT,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status job_status NOT NULL DEFAULT 'scheduled',
  scheduled_start TIMESTAMPTZ NOT NULL,
  scheduled_end TIMESTAMPTZ NOT NULL,
  actual_start TIMESTAMPTZ,
  actual_end TIMESTAMPTZ,
  price_cents INT NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX jobs_tenant_start_idx ON public.jobs(tenant_id, scheduled_start);
CREATE INDEX jobs_assigned_idx ON public.jobs(assigned_to);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jobs TO authenticated;
GRANT ALL ON public.jobs TO service_role;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read all jobs" ON public.jobs
  FOR SELECT TO authenticated USING (public.is_owner() AND tenant_id = public.current_tenant_id());
CREATE POLICY "Employees read their jobs" ON public.jobs
  FOR SELECT TO authenticated USING (assigned_to = auth.uid() AND tenant_id = public.current_tenant_id());
CREATE POLICY "Owners manage jobs" ON public.jobs
  FOR ALL TO authenticated USING (public.is_owner() AND tenant_id = public.current_tenant_id())
  WITH CHECK (public.is_owner() AND tenant_id = public.current_tenant_id());
CREATE POLICY "Employees update their jobs" ON public.jobs
  FOR UPDATE TO authenticated USING (assigned_to = auth.uid() AND tenant_id = public.current_tenant_id())
  WITH CHECK (assigned_to = auth.uid() AND tenant_id = public.current_tenant_id());

-- ============ JOB SOP ITEMS ============
CREATE TABLE public.job_sop_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  position INT NOT NULL,
  label TEXT NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES auth.users(id)
);
CREATE INDEX job_sop_items_job_idx ON public.job_sop_items(job_id, position);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_sop_items TO authenticated;
GRANT ALL ON public.job_sop_items TO service_role;
ALTER TABLE public.job_sop_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage sop" ON public.job_sop_items
  FOR ALL TO authenticated USING (public.is_owner() AND tenant_id = public.current_tenant_id())
  WITH CHECK (public.is_owner() AND tenant_id = public.current_tenant_id());
CREATE POLICY "Assigned employee reads sop" ON public.job_sop_items
  FOR SELECT TO authenticated USING (
    tenant_id = public.current_tenant_id() AND
    EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_id AND j.assigned_to = auth.uid())
  );
CREATE POLICY "Assigned employee updates sop" ON public.job_sop_items
  FOR UPDATE TO authenticated USING (
    tenant_id = public.current_tenant_id() AND
    EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_id AND j.assigned_to = auth.uid())
  ) WITH CHECK (tenant_id = public.current_tenant_id());

-- ============ TIME ENTRIES ============
CREATE TABLE public.time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.time_entries TO authenticated;
GRANT ALL ON public.time_entries TO service_role;
ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read time" ON public.time_entries
  FOR SELECT TO authenticated USING (public.is_owner() AND tenant_id = public.current_tenant_id());
CREATE POLICY "Users manage own time" ON public.time_entries
  FOR ALL TO authenticated USING (user_id = auth.uid() AND tenant_id = public.current_tenant_id())
  WITH CHECK (user_id = auth.uid() AND tenant_id = public.current_tenant_id());

-- ============ INVOICES ============
CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  number TEXT NOT NULL,
  status invoice_status NOT NULL DEFAULT 'draft',
  amount_cents INT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  pay_link TEXT,
  sent_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage invoices" ON public.invoices
  FOR ALL TO authenticated USING (public.is_owner() AND tenant_id = public.current_tenant_id())
  WITH CHECK (public.is_owner() AND tenant_id = public.current_tenant_id());

-- ============ TRIGGERS ============
CREATE OR REPLACE FUNCTION public.tg_set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER clients_updated BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER jobs_updated BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Auto-create profile on signup, default to Wash Rinse Repeat tenant + employee role.
-- (Owners can promote via user_roles table.)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tenant UUID := '00000000-0000-0000-0000-000000000001';
  _is_first BOOLEAN;
BEGIN
  INSERT INTO public.profiles (id, tenant_id, full_name, email)
  VALUES (NEW.id, _tenant,
          COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)),
          NEW.email);

  SELECT NOT EXISTS(SELECT 1 FROM public.user_roles WHERE tenant_id = _tenant) INTO _is_first;

  INSERT INTO public.user_roles (user_id, tenant_id, role)
  VALUES (NEW.id, _tenant, CASE WHEN _is_first THEN 'owner'::app_role ELSE 'employee'::app_role END);

  RETURN NEW;
END $$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ SEED SERVICE TYPES ============
INSERT INTO public.service_types (tenant_id, kind, name, default_duration_minutes, default_price_cents, sop_steps) VALUES
('00000000-0000-0000-0000-000000000001','airbnb_turnover','Airbnb Turnover',150,18500,
  '["Strip all bed linens and towels","Start laundry cycle 1 (whites)","Sanitize all high-touch surfaces","Restock coffee and tea station","Check for guest left-behinds","Make beds with fresh linens","Vacuum all floors","Mop hard surfaces","Clean bathrooms","Restock toiletries","Final walkthrough photos","Lock up and confirm"]'::jsonb),
('00000000-0000-0000-0000-000000000001','move_in','Move-in Clean',240,32500,
  '["Wipe inside cabinets","Deep clean kitchen appliances","Sanitize bathrooms","Dust all surfaces","Clean windows interior","Vacuum + mop all floors","Wipe baseboards"]'::jsonb),
('00000000-0000-0000-0000-000000000001','move_out','Move-out Clean',240,32500,
  '["Empty all cabinets","Degrease oven and stovetop","Clean refrigerator inside/out","Scrub bathrooms","Wipe walls and baseboards","Vacuum + mop","Trash removal","Final photos"]'::jsonb),
('00000000-0000-0000-0000-000000000001','residential','Residential Clean',120,15000,
  '["Dust surfaces","Sanitize kitchen counters","Clean bathrooms","Vacuum carpets","Mop hard floors","Empty trash"]'::jsonb),
('00000000-0000-0000-0000-000000000001','apartment_move_in','Apartment Move-in',180,22500,
  '["Wipe cabinets inside","Clean appliances","Sanitize bathrooms","Dust surfaces","Vacuum + mop","Wipe baseboards"]'::jsonb),
('00000000-0000-0000-0000-000000000001','apartment_move_out','Apartment Move-out',180,22500,
  '["Empty cabinets","Clean oven and fridge","Scrub bathrooms","Wipe walls","Vacuum + mop","Remove trash"]'::jsonb),
('00000000-0000-0000-0000-000000000001','commercial','Commercial Clean',180,25000,
  '["Empty all trash bins","Sanitize desks and shared surfaces","Clean restrooms fully","Vacuum common areas","Mop hard floors","Restock supplies","Lock up"]'::jsonb);
