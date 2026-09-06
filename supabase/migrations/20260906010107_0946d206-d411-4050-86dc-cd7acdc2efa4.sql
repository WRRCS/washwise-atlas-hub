-- Recreate the CPNI helper with an extra return column.
DROP FUNCTION IF EXISTS public.client_contact_info(uuid[]) CASCADE;

-- Limit authenticated users to non-sensitive columns on clients.
-- CPNI (email, phone, billing_address) and internal SOP notes (client_sop) must be
-- read through the permission-checked SECURITY DEFINER function instead.
REVOKE ALL ON public.clients FROM authenticated;
GRANT SELECT (id, tenant_id, first_name, last_name, service_address, is_active, color, created_at, updated_at) ON public.clients TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;

-- Extend the CPNI helper so owners/managers can also retrieve the internal SOP
-- without needing broad column access on the clients table.
CREATE OR REPLACE FUNCTION public.client_contact_info(_ids uuid[] DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  email text,
  phone text,
  billing_address text,
  client_sop text
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
  SELECT c.id, c.email, c.phone, c.billing_address, c.client_sop
  FROM public.clients c
  WHERE c.tenant_id = _tenant
    AND (_ids IS NULL OR c.id = ANY(_ids));
END;
$$;
GRANT EXECUTE ON FUNCTION public.client_contact_info(uuid[]) TO authenticated;

-- Enforce the visibility column on client_notes. Management-only notes are only
-- readable by owners, managers, or users granted client-management permission.
DROP POLICY IF EXISTS "tenant_read_notes" ON public.client_notes;
CREATE POLICY "tenant_read_notes" ON public.client_notes
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (
      visibility IN ('team', 'client')
      OR public.is_owner_or_manager()
      OR public.has_client_mgmt_permission()
    )
  );