ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS share_phone_with_team boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.staff_directory()
 RETURNS TABLE(id uuid, tenant_id uuid, full_name text, avatar_url text, is_active boolean, email text, phone text, hourly_rate_cents integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _contacts boolean := public.is_owner() OR public.has_employee_permission('can_view_employee_contacts');
  _wages boolean := public.is_owner() OR public.has_employee_permission('can_view_wages');
BEGIN
  IF auth.uid() IS NULL OR _tenant IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT p.id, p.tenant_id, p.full_name, p.avatar_url, p.is_active,
         CASE WHEN _contacts OR p.id = auth.uid() THEN p.email ELSE NULL END,
         CASE WHEN _contacts OR p.id = auth.uid()
                   OR (p.share_phone_with_team AND p.is_active IS NOT FALSE)
              THEN p.phone ELSE NULL END,
         CASE WHEN _wages OR p.id = auth.uid() THEN p.hourly_rate_cents ELSE NULL END
  FROM public.profiles p
  WHERE p.tenant_id = _tenant
  ORDER BY p.full_name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.my_phone_sharing()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object('phone', p.phone, 'share', p.share_phone_with_team)
  FROM public.profiles p
  WHERE p.id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.set_my_phone_sharing(_share boolean, _phone text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _clean text := nullif(btrim(coalesce(_phone, '')), '');
  _row public.profiles%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;
  IF _clean IS NOT NULL AND length(_clean) > 30 THEN
    RAISE EXCEPTION 'Phone number is too long';
  END IF;
  UPDATE public.profiles p
     SET phone = CASE WHEN _phone IS NULL THEN p.phone ELSE _clean END,
         share_phone_with_team = _share
   WHERE p.id = auth.uid()
  RETURNING * INTO _row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;
  IF _row.share_phone_with_team AND _row.phone IS NULL THEN
    UPDATE public.profiles SET share_phone_with_team = false WHERE id = auth.uid();
    RAISE EXCEPTION 'Add your phone number before sharing it';
  END IF;
  RETURN jsonb_build_object('phone', _row.phone, 'share', _row.share_phone_with_team);
END;
$function$;

REVOKE ALL ON FUNCTION public.my_phone_sharing() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_my_phone_sharing(boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_phone_sharing() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_my_phone_sharing(boolean, text) TO authenticated, service_role;