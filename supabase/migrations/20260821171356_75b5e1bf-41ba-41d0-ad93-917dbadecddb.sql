DROP POLICY IF EXISTS "tenant_read_specs" ON public.property_specs;
DROP POLICY IF EXISTS "tenant_write_specs" ON public.property_specs;
DROP POLICY IF EXISTS "Staff insert property_specs" ON public.property_specs;
DROP POLICY IF EXISTS "Staff update property_specs" ON public.property_specs;

CREATE OR REPLACE FUNCTION public.can_view_client_specs(_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_owner_or_manager()
      OR EXISTS (
        SELECT 1
        FROM public.jobs j
        JOIN public.job_employees je ON je.job_id = j.id
        WHERE j.client_id = _client_id
          AND j.tenant_id = public.current_tenant_id()
          AND je.employee_id = auth.uid()
      );
$$;

REVOKE ALL ON FUNCTION public.can_view_client_specs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_client_specs(uuid) TO authenticated;

CREATE POLICY "specs_select_scoped" ON public.property_specs
FOR SELECT TO authenticated
USING (tenant_id = public.current_tenant_id() AND public.can_view_client_specs(client_id));

CREATE POLICY "specs_insert_managers" ON public.property_specs
FOR INSERT TO authenticated
WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager());

CREATE POLICY "specs_update_managers" ON public.property_specs
FOR UPDATE TO authenticated
USING (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager())
WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager());

CREATE POLICY "specs_delete_managers" ON public.property_specs
FOR DELETE TO authenticated
USING (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager());