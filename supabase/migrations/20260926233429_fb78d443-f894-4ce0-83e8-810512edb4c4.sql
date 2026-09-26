ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS secondary_phone text,
  ADD COLUMN IF NOT EXISTS lead_source text;
GRANT SELECT (company_name) ON public.clients TO authenticated;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS sop_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS sop_confirmed_by uuid;

CREATE OR REPLACE FUNCTION public.client_private_extras(_client uuid)
RETURNS TABLE (secondary_phone text, lead_source text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.secondary_phone, c.lead_source FROM public.clients c
  WHERE c.id = _client AND c.tenant_id = public.current_tenant_id() AND public.is_owner_or_manager();
$$;
REVOKE EXECUTE ON FUNCTION public.client_private_extras(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_private_extras(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_job_sop(_job uuid, _confirmed boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.jobs j WHERE j.id = _job AND j.tenant_id = public.current_tenant_id()
      AND (j.assigned_to = auth.uid() OR public.is_owner_or_manager()
           OR EXISTS (SELECT 1 FROM public.job_employees je WHERE je.job_id = j.id AND je.employee_id = auth.uid()))
  ) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  UPDATE public.jobs SET sop_confirmed_at = CASE WHEN _confirmed THEN now() END,
    sop_confirmed_by = CASE WHEN _confirmed THEN auth.uid() END WHERE id = _job;
END; $$;
REVOKE EXECUTE ON FUNCTION public.confirm_job_sop(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_job_sop(uuid, boolean) TO authenticated;