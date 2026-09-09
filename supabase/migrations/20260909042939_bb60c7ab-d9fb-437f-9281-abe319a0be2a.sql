CREATE OR REPLACE FUNCTION public.tg_profiles_protect_privileged_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_owner() THEN
    RETURN NEW;
  END IF;

  -- Always locked for non-owners
  NEW.id := OLD.id;
  NEW.tenant_id := OLD.tenant_id;
  NEW.hourly_rate_cents := OLD.hourly_rate_cents;

  -- Managers with employee-management permission may activate/deactivate
  -- other people, but never themselves.
  IF NOT (OLD.id <> auth.uid()
          AND public.has_employee_permission('can_manage_clients_employees')) THEN
    NEW.is_active := OLD.is_active;
  END IF;

  RETURN NEW;
END;
$$;