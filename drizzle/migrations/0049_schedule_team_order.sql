CREATE TABLE public.schedule_team_order (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_ids uuid[] NOT NULL DEFAULT '{}',
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.schedule_team_order TO authenticated;
GRANT ALL ON public.schedule_team_order TO service_role;
ALTER TABLE public.schedule_team_order ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Team reads schedule order" ON public.schedule_team_order FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "Managers create schedule order" ON public.schedule_team_order FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager() AND updated_by = auth.uid());
CREATE POLICY "Managers change schedule order" ON public.schedule_team_order FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager() AND updated_by = auth.uid());