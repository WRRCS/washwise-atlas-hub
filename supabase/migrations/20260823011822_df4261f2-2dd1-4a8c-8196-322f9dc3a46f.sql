-- 1) Column-level lockdown for the signed-in role
REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (id, tenant_id, full_name, avatar_url, is_active, created_at, updated_at)
  ON public.profiles TO authenticated;

REVOKE SELECT ON public.clients FROM authenticated;
GRANT SELECT (id, tenant_id, first_name, last_name, service_address, is_active,
              is_airbnb_host, color, client_sop, created_at, updated_at)
  ON public.clients TO authenticated;

-- 2) Self-service profile lookup (always allowed for your own row)
CREATE OR REPLACE FUNCTION public.my_profile()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', p.id,
    'tenant_id', p.tenant_id,
    'full_name', p.full_name,
    'email', p.email,
    'phone', p.phone,
    'avatar_url', p.avatar_url,
    'hourly_rate_cents', p.hourly_rate_cents,
    'is_active', p.is_active
  )
  FROM public.profiles p
  WHERE p.id = auth.uid();
$$;

-- 3) Permission-filtered staff directory
CREATE OR REPLACE FUNCTION public.staff_directory()
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  full_name text,
  avatar_url text,
  is_active boolean,
  email text,
  phone text,
  hourly_rate_cents integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _owner boolean := public.is_owner();
  _contacts boolean := public.is_owner() OR public.has_employee_permission('can_view_employee_contacts');
  _wages boolean := public.is_owner() OR public.has_employee_permission('can_view_wages');
BEGIN
  IF auth.uid() IS NULL OR _tenant IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT p.id, p.tenant_id, p.full_name, p.avatar_url, p.is_active,
         CASE WHEN _contacts OR p.id = auth.uid() THEN p.email ELSE NULL END,
         CASE WHEN _contacts OR p.id = auth.uid() THEN p.phone ELSE NULL END,
         CASE WHEN _wages OR p.id = auth.uid() THEN p.hourly_rate_cents ELSE NULL END
  FROM public.profiles p
  WHERE p.tenant_id = _tenant
  ORDER BY p.full_name;
END;
$$;

-- 4) Permission-gated client contact info (CPNI)
CREATE OR REPLACE FUNCTION public.client_contact_info(_ids uuid[] DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  email text,
  phone text,
  billing_address text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
BEGIN
  IF auth.uid() IS NULL OR _tenant IS NULL THEN
    RETURN;
  END IF;
  IF NOT (public.is_owner() OR public.has_employee_permission('can_view_client_cpni')) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT c.id, c.email, c.phone, c.billing_address
  FROM public.clients c
  WHERE c.tenant_id = _tenant
    AND (_ids IS NULL OR c.id = ANY(_ids));
END;
$$;

REVOKE ALL ON FUNCTION public.my_profile() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_directory() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.client_contact_info(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_directory() TO authenticated;
GRANT EXECUTE ON FUNCTION public.client_contact_info(uuid[]) TO authenticated;

-- 5) Only owners may grant permissions
DROP POLICY IF EXISTS "Staff manage employee permissions" ON public.employee_permissions;
DROP POLICY IF EXISTS "Owners manage employee permissions" ON public.employee_permissions;
DROP POLICY IF EXISTS "Employees read own permissions" ON public.employee_permissions;

CREATE POLICY "Owners manage employee permissions"
  ON public.employee_permissions FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());

CREATE POLICY "Members read permissions in tenant"
  ON public.employee_permissions FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());