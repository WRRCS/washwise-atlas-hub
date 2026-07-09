
-- 1. Tenant GPS settings
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS track_gps boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gps_retention_days integer NOT NULL DEFAULT 90;

-- Allow owners to update their own tenant row (needed for GPS settings toggle)
DROP POLICY IF EXISTS "Owners update own tenant" ON public.tenants;
CREATE POLICY "Owners update own tenant" ON public.tenants
  FOR UPDATE TO authenticated
  USING (id = public.current_tenant_id() AND public.is_owner())
  WITH CHECK (id = public.current_tenant_id() AND public.is_owner());

-- 2. Add GPS columns to time_entries
ALTER TABLE public.time_entries
  ADD COLUMN IF NOT EXISTS clock_in_latitude numeric,
  ADD COLUMN IF NOT EXISTS clock_in_longitude numeric,
  ADD COLUMN IF NOT EXISTS clock_in_accuracy_meters numeric,
  ADD COLUMN IF NOT EXISTS clock_out_latitude numeric,
  ADD COLUMN IF NOT EXISTS clock_out_longitude numeric,
  ADD COLUMN IF NOT EXISTS clock_out_accuracy_meters numeric,
  ADD COLUMN IF NOT EXISTS consent_given_at timestamptz;

-- 3. GPS consent log
CREATE TABLE IF NOT EXISTS public.gps_consent_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  consent_given_at timestamptz NOT NULL DEFAULT now(),
  consent_method text NOT NULL CHECK (consent_method IN ('explicit_opt_in','denied','device_permission_denied')),
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.gps_consent_log TO authenticated;
GRANT ALL ON public.gps_consent_log TO service_role;

ALTER TABLE public.gps_consent_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees insert own consent" ON public.gps_consent_log
  FOR INSERT TO authenticated
  WITH CHECK (employee_id = auth.uid() AND tenant_id = public.current_tenant_id());

CREATE POLICY "Employees read own consent" ON public.gps_consent_log
  FOR SELECT TO authenticated
  USING (employee_id = auth.uid() AND tenant_id = public.current_tenant_id());

CREATE POLICY "Owners read tenant consent" ON public.gps_consent_log
  FOR SELECT TO authenticated
  USING (public.is_owner() AND tenant_id = public.current_tenant_id());

-- 4. Retention purge function (owner-callable; deletes GPS coords older than retention window)
CREATE OR REPLACE FUNCTION public.purge_expired_gps(_tenant uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _days integer;
  _cutoff timestamptz;
  _count integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'owner') THEN
    RAISE EXCEPTION 'Only owners may purge GPS data';
  END IF;
  IF _tenant <> public.current_tenant_id() THEN
    RAISE EXCEPTION 'Cannot purge other tenants';
  END IF;
  SELECT gps_retention_days INTO _days FROM public.tenants WHERE id = _tenant;
  _cutoff := now() - (COALESCE(_days, 90) || ' days')::interval;

  UPDATE public.time_entries
     SET clock_in_latitude = NULL,
         clock_in_longitude = NULL,
         clock_in_accuracy_meters = NULL,
         clock_out_latitude = NULL,
         clock_out_longitude = NULL,
         clock_out_accuracy_meters = NULL
   WHERE tenant_id = _tenant
     AND started_at < _cutoff
     AND (clock_in_latitude IS NOT NULL OR clock_out_latitude IS NOT NULL);
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END $$;

REVOKE ALL ON FUNCTION public.purge_expired_gps(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.purge_expired_gps(uuid) TO authenticated;
