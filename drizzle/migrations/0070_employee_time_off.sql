CREATE TABLE public.employee_time_off (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT 'unpaid' CHECK (category IN ('paid','unpaid')),
  reason text NOT NULL DEFAULT 'vacation' CHECK (reason IN ('vacation','sick','personal','appointment','family','other')),
  note text CHECK (note IS NULL OR length(note) <= 1000),
  start_date date NOT NULL,
  end_date date NOT NULL,
  all_day boolean NOT NULL DEFAULT true,
  start_time time,
  end_time time,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  hours numeric(6,2) NOT NULL DEFAULT 0 CHECK (hours >= 0 AND hours <= 2000),
  time_off_request_id uuid UNIQUE REFERENCES public.time_off_requests(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_time_off_dates CHECK (end_date >= start_date AND ends_at > starts_at),
  CONSTRAINT employee_time_off_partial CHECK (all_day OR (start_date = end_date AND start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time))
);

CREATE INDEX employee_time_off_tenant_range ON public.employee_time_off (tenant_id, starts_at, ends_at);
CREATE INDEX employee_time_off_employee ON public.employee_time_off (employee_id, starts_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_time_off TO authenticated;
GRANT ALL ON public.employee_time_off TO service_role;

ALTER TABLE public.employee_time_off ENABLE ROW LEVEL SECURITY;

CREATE POLICY time_off_read ON public.employee_time_off FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND (employee_id = auth.uid() OR public.is_owner_or_manager()));
CREATE POLICY time_off_insert ON public.employee_time_off FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager()
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = employee_id AND p.tenant_id = public.current_tenant_id()));
CREATE POLICY time_off_update ON public.employee_time_off FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager()
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = employee_id AND p.tenant_id = public.current_tenant_id()));
CREATE POLICY time_off_delete ON public.employee_time_off FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager());

CREATE TRIGGER employee_time_off_updated_at BEFORE UPDATE ON public.employee_time_off
  FOR EACH ROW EXECUTE FUNCTION public.set_voice_updated_at();