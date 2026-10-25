CREATE TABLE public.job_sop_confirmations (job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE, employee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, tenant_id uuid NOT NULL REFERENCES public.tenants(id), confirmed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (job_id,employee_id));
GRANT SELECT ON public.job_sop_confirmations TO authenticated;
GRANT ALL ON public.job_sop_confirmations TO service_role;
ALTER TABLE public.job_sop_confirmations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own appointment acknowledgment or manage tenant" ON public.job_sop_confirmations FOR SELECT TO authenticated USING (tenant_id=public.current_tenant_id() AND (employee_id=auth.uid() OR public.is_owner_or_manager()));
INSERT INTO public.job_sop_confirmations(job_id,employee_id,tenant_id,confirmed_at) SELECT j.id,j.sop_confirmed_by,j.tenant_id,j.sop_confirmed_at FROM public.jobs j JOIN public.profiles p ON p.id=j.sop_confirmed_by AND p.tenant_id=j.tenant_id WHERE j.sop_confirmed_by IS NOT NULL AND j.sop_confirmed_at IS NOT NULL;
CREATE OR REPLACE FUNCTION public.confirm_job_sop(_job uuid,_confirmed boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE tid uuid;
BEGIN
 SELECT j.tenant_id INTO tid FROM public.jobs j WHERE j.id=_job AND j.tenant_id=public.current_tenant_id() AND (j.assigned_to=auth.uid() OR public.is_owner_or_manager() OR EXISTS(SELECT 1 FROM public.job_employees je WHERE je.job_id=j.id AND je.employee_id=auth.uid()));
 IF tid IS NULL THEN RAISE EXCEPTION 'Not allowed'; END IF;
 IF _confirmed THEN INSERT INTO public.job_sop_confirmations(job_id,employee_id,tenant_id,confirmed_at) VALUES(_job,auth.uid(),tid,now()) ON CONFLICT(job_id,employee_id) DO UPDATE SET confirmed_at=excluded.confirmed_at;
 ELSE DELETE FROM public.job_sop_confirmations WHERE job_id=_job AND employee_id=auth.uid(); END IF;
END; $function$;
REVOKE ALL ON FUNCTION public.confirm_job_sop(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_job_sop(uuid,boolean) TO authenticated;
COMMENT ON COLUMN public.jobs.sop_confirmed_at IS 'DEPRECATED: per-cleaner acknowledgments are in job_sop_confirmations; retained as legacy evidence';
COMMENT ON COLUMN public.jobs.sop_confirmed_by IS 'DEPRECATED: per-cleaner acknowledgments are in job_sop_confirmations; retained as legacy evidence';