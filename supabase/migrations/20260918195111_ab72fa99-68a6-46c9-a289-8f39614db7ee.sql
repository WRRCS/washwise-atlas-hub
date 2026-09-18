CREATE TABLE IF NOT EXISTS public.client_message_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  subject text NOT NULL DEFAULT 'Your cleaning is complete',
  body text NOT NULL DEFAULT '',
  photo_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft',
  created_by uuid,
  sent_at timestamptz,
  sent_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_message_drafts_tenant_status_idx
  ON public.client_message_drafts (tenant_id, status, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_message_drafts TO authenticated;
GRANT ALL ON public.client_message_drafts TO service_role;

ALTER TABLE public.client_message_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "managers view job complete drafts" ON public.client_message_drafts;
CREATE POLICY "managers view job complete drafts"
  ON public.client_message_drafts FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager'))
  );

DROP POLICY IF EXISTS "staff create job complete drafts" ON public.client_message_drafts;
CREATE POLICY "staff create job complete drafts"
  ON public.client_message_drafts FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "managers edit job complete drafts" ON public.client_message_drafts;
CREATE POLICY "managers edit job complete drafts"
  ON public.client_message_drafts FOR UPDATE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager'))
  )
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "managers delete job complete drafts" ON public.client_message_drafts;
CREATE POLICY "managers delete job complete drafts"
  ON public.client_message_drafts FOR DELETE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'manager'))
  );