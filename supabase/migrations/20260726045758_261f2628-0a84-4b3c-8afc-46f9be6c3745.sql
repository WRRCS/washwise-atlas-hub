
-- 1) employee_permissions
CREATE TABLE public.employee_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  can_view_employee_contacts boolean NOT NULL DEFAULT false,
  can_view_pricing boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_permissions TO authenticated;
GRANT ALL ON public.employee_permissions TO service_role;
ALTER TABLE public.employee_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage employee_permissions"
  ON public.employee_permissions FOR ALL
  TO authenticated
  USING (is_owner() AND tenant_id = current_tenant_id())
  WITH CHECK (is_owner() AND tenant_id = current_tenant_id());
CREATE TRIGGER employee_permissions_set_updated_at
  BEFORE UPDATE ON public.employee_permissions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 2) team_messages
CREATE TABLE public.team_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX team_messages_tenant_recipient_idx ON public.team_messages(tenant_id, recipient_id, created_at DESC);
CREATE INDEX team_messages_tenant_sender_idx ON public.team_messages(tenant_id, sender_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_messages TO authenticated;
GRANT ALL ON public.team_messages TO service_role;
ALTER TABLE public.team_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant members send team messages"
  ON public.team_messages FOR INSERT
  TO authenticated
  WITH CHECK (sender_id = auth.uid() AND tenant_id = current_tenant_id());
CREATE POLICY "Tenant members read own team messages"
  ON public.team_messages FOR SELECT
  TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (recipient_id = auth.uid() OR recipient_id IS NULL OR sender_id = auth.uid())
  );
CREATE POLICY "Recipient marks team message read"
  ON public.team_messages FOR UPDATE
  TO authenticated
  USING (tenant_id = current_tenant_id() AND (recipient_id = auth.uid() OR (recipient_id IS NULL AND sender_id <> auth.uid())))
  WITH CHECK (tenant_id = current_tenant_id());

-- 3) time_off_requests
CREATE TABLE public.time_off_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.time_off_requests TO authenticated;
GRANT ALL ON public.time_off_requests TO service_role;
ALTER TABLE public.time_off_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Employees read own time off"
  ON public.time_off_requests FOR SELECT
  TO authenticated
  USING (tenant_id = current_tenant_id() AND (employee_id = auth.uid() OR is_owner()));
CREATE POLICY "Employees create own time off"
  ON public.time_off_requests FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = current_tenant_id() AND employee_id = auth.uid());
CREATE POLICY "Owners update time off status"
  ON public.time_off_requests FOR UPDATE
  TO authenticated
  USING (is_owner() AND tenant_id = current_tenant_id())
  WITH CHECK (is_owner() AND tenant_id = current_tenant_id());
CREATE POLICY "Owners delete time off"
  ON public.time_off_requests FOR DELETE
  TO authenticated
  USING (is_owner() AND tenant_id = current_tenant_id());

-- 4) shift_swap_requests
CREATE TABLE public.shift_swap_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  requesting_employee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  proposed_covering_employee_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shift_swap_requests TO authenticated;
GRANT ALL ON public.shift_swap_requests TO service_role;
ALTER TABLE public.shift_swap_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Employees read own or covering shift swaps"
  ON public.shift_swap_requests FOR SELECT
  TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (requesting_employee_id = auth.uid() OR proposed_covering_employee_id = auth.uid() OR is_owner())
  );
CREATE POLICY "Employees create own shift swap"
  ON public.shift_swap_requests FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = current_tenant_id() AND requesting_employee_id = auth.uid());
CREATE POLICY "Owners update shift swap status"
  ON public.shift_swap_requests FOR UPDATE
  TO authenticated
  USING (is_owner() AND tenant_id = current_tenant_id())
  WITH CHECK (is_owner() AND tenant_id = current_tenant_id());
CREATE POLICY "Owners delete shift swap"
  ON public.shift_swap_requests FOR DELETE
  TO authenticated
  USING (is_owner() AND tenant_id = current_tenant_id());

-- 5) Lock down clients/invoices for employees
-- Clients: replace the wide staff-read with owner-full + employee-only-assigned
DROP POLICY IF EXISTS "Staff read clients" ON public.clients;
DROP POLICY IF EXISTS "Staff update clients" ON public.clients;
DROP POLICY IF EXISTS "Staff insert clients" ON public.clients;

CREATE POLICY "Owners read all clients"
  ON public.clients FOR SELECT
  TO authenticated
  USING (is_owner() AND tenant_id = current_tenant_id());

CREATE POLICY "Employees read assigned clients"
  ON public.clients FOR SELECT
  TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.jobs j
      JOIN public.job_employees je ON je.job_id = j.id
      WHERE j.client_id = clients.id
        AND je.employee_id = auth.uid()
    )
  );

-- Invoices: owners only for SELECT (staff read removed)
DROP POLICY IF EXISTS "staff read invoices" ON public.invoices;
CREATE POLICY "Owners read invoices"
  ON public.invoices FOR SELECT
  TO authenticated
  USING (is_owner() AND tenant_id = current_tenant_id());

-- Invoice line items: owners only for SELECT
DROP POLICY IF EXISTS "tenant staff can view line items" ON public.invoice_line_items;
CREATE POLICY "Owners read line items"
  ON public.invoice_line_items FOR SELECT
  TO authenticated
  USING (is_owner() AND tenant_id = current_tenant_id());
