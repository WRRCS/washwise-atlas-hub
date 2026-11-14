CREATE TABLE public.staff_invites (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  status text NOT NULL CHECK (status IN ('sent','failed','unknown','revoked')),
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  message_id text,
  error text,
  invited_by uuid,
  revoked_at timestamptz
);
GRANT SELECT ON public.staff_invites TO authenticated;
GRANT ALL ON public.staff_invites TO service_role;
ALTER TABLE public.staff_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owners and managers view their team invites"
  ON public.staff_invites FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager());