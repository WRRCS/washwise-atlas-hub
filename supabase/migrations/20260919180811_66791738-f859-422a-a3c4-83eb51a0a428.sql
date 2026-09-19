
CREATE POLICY "Tenant staff read all jobs" ON public.jobs
FOR SELECT TO authenticated
USING (tenant_id = public.current_tenant_id());

ALTER TABLE public.employee_caddy_items
  ADD COLUMN IF NOT EXISTS level_pct smallint NOT NULL DEFAULT 100
  CHECK (level_pct >= 0 AND level_pct <= 100);

GRANT SELECT (level_pct), UPDATE (level_pct), INSERT (level_pct) ON public.employee_caddy_items TO authenticated;
