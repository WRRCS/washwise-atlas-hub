
-- Helper: is caller allowed to manage clients & employees (owner OR manager with the toggle)?
CREATE OR REPLACE FUNCTION public.has_client_mgmt_permission()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_owner()
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      LEFT JOIN public.employee_permissions ep
        ON ep.employee_id = ur.user_id
       AND ep.tenant_id = ur.tenant_id
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'manager'
        AND COALESCE(ep.can_manage_clients_employees, false) = true
    );
$$;

REVOKE EXECUTE ON FUNCTION public.has_client_mgmt_permission() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_client_mgmt_permission() TO authenticated;

-- Replace the client_messages staff policies with owner/manager-scoped ones
DROP POLICY IF EXISTS "Staff read client_messages" ON public.client_messages;
DROP POLICY IF EXISTS "Staff insert client_messages" ON public.client_messages;
DROP POLICY IF EXISTS "Staff update client_messages" ON public.client_messages;

CREATE POLICY "Client-mgmt read client_messages" ON public.client_messages
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND public.has_client_mgmt_permission()
  );

CREATE POLICY "Client-mgmt insert client_messages" ON public.client_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND sender_type = 'business'
    AND public.has_client_mgmt_permission()
  );

CREATE POLICY "Client-mgmt update client_messages" ON public.client_messages
  FOR UPDATE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND public.has_client_mgmt_permission()
  );
