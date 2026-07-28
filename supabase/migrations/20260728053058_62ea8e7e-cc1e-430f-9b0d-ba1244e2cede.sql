
-- Pay rate on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS hourly_rate_cents integer NOT NULL DEFAULT 0;

-- Published flag on jobs (draft schedule vs published)
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

-- Unavailability blocks
CREATE TABLE IF NOT EXISTS public.employee_unavailability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  all_day boolean NOT NULL DEFAULT false,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_unavailability TO authenticated;
GRANT ALL ON public.employee_unavailability TO service_role;

ALTER TABLE public.employee_unavailability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "unavail_tenant_read" ON public.employee_unavailability
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "unavail_owner_write" ON public.employee_unavailability
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND (public.is_owner() OR employee_id = auth.uid()))
  WITH CHECK (tenant_id = public.current_tenant_id() AND (public.is_owner() OR employee_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_unavail_tenant_emp_time
  ON public.employee_unavailability (tenant_id, employee_id, starts_at);

CREATE TRIGGER trg_unavail_updated_at
  BEFORE UPDATE ON public.employee_unavailability
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Placeholder clients for historical labels
INSERT INTO public.clients (tenant_id, first_name, last_name, is_active, is_airbnb_host)
SELECT '00000000-0000-0000-0000-000000000001'::uuid, 'APT Move Out', '(TBD)', true, false
WHERE NOT EXISTS (SELECT 1 FROM public.clients WHERE tenant_id='00000000-0000-0000-0000-000000000001' AND first_name='APT Move Out');

INSERT INTO public.clients (tenant_id, first_name, last_name, is_active, is_airbnb_host)
SELECT '00000000-0000-0000-0000-000000000001'::uuid, 'Deep Clean', '(TBD)', true, false
WHERE NOT EXISTS (SELECT 1 FROM public.clients WHERE tenant_id='00000000-0000-0000-0000-000000000001' AND first_name='Deep Clean');

INSERT INTO public.clients (tenant_id, first_name, last_name, is_active, is_airbnb_host)
SELECT '00000000-0000-0000-0000-000000000001'::uuid, 'Airbnb', 'A-Frame', true, true
WHERE NOT EXISTS (SELECT 1 FROM public.clients WHERE tenant_id='00000000-0000-0000-0000-000000000001' AND first_name='Airbnb' AND last_name='A-Frame');
