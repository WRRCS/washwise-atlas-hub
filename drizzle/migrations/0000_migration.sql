CREATE TABLE public.photo_share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  job_id uuid NOT NULL,
  photo_type text,
  photo_ids uuid[],
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days'
);
GRANT SELECT, INSERT ON public.photo_share_links TO authenticated;
GRANT ALL ON public.photo_share_links TO service_role;
ALTER TABLE public.photo_share_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Managers create share links" ON public.photo_share_links FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.is_owner_or_manager() AND tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "Managers view share links" ON public.photo_share_links FOR SELECT TO authenticated
  USING (public.is_owner_or_manager() AND tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));