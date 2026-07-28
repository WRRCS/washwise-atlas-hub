
-- 1. Add 'manager' to app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'manager';

-- 2. New permission toggles
ALTER TABLE public.employee_permissions
  ADD COLUMN IF NOT EXISTS can_view_client_cpni boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_schedule boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_manage_clients_employees boolean NOT NULL DEFAULT false;

-- 3. Rename Zoe's profile back
UPDATE public.profiles
SET full_name = 'Zoe Casanova'
WHERE email = 'info@washrinserepeatcleaning.com';

-- 4. Allow placeholder profiles without an auth.users row
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_fkey;

-- 5. Insert name-only placeholder employees into the tenant
DO $$
DECLARE
  t_id uuid := '00000000-0000-0000-0000-000000000001';
  emp_name text;
  new_id uuid;
BEGIN
  ALTER TABLE public.user_roles DISABLE TRIGGER tg_user_roles_enforce_employee_limit;
  FOREACH emp_name IN ARRAY ARRAY['Alina Horiunenko','Barbra Elder','Dalton Inkster','Lina Bak','Nelia Kahan']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE tenant_id = t_id AND full_name = emp_name) THEN
      new_id := gen_random_uuid();
      INSERT INTO public.profiles (id, tenant_id, full_name, is_active)
        VALUES (new_id, t_id, emp_name, true);
      INSERT INTO public.user_roles (user_id, tenant_id, role)
        VALUES (new_id, t_id, 'employee');
    END IF;
  END LOOP;
  ALTER TABLE public.user_roles ENABLE TRIGGER tg_user_roles_enforce_employee_limit;
END $$;
