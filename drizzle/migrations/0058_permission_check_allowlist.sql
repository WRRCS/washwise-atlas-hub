CREATE OR REPLACE FUNCTION public.has_employee_permission(_flag text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _p public.employee_permissions%ROWTYPE;
BEGIN
  IF public.is_owner() THEN RETURN true; END IF;
  -- Only answers about the signed-in user, and only for known permission flags (no dynamic SQL).
  SELECT * INTO _p FROM public.employee_permissions WHERE employee_id = auth.uid() LIMIT 1;
  IF NOT FOUND THEN RETURN false; END IF;
  RETURN COALESCE(CASE _flag
    WHEN 'can_view_employee_contacts' THEN _p.can_view_employee_contacts
    WHEN 'can_view_pricing' THEN _p.can_view_pricing
    WHEN 'can_view_client_cpni' THEN _p.can_view_client_cpni
    WHEN 'can_schedule' THEN _p.can_schedule
    WHEN 'can_manage_clients_employees' THEN _p.can_manage_clients_employees
    WHEN 'can_view_wages' THEN _p.can_view_wages
    ELSE false
  END, false);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.has_employee_permission(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_employee_permission(text) TO authenticated, service_role;