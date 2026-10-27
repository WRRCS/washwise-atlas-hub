-- Revocation: NULL = active; set when an admin revokes the link
ALTER TABLE public.photo_share_links ADD COLUMN revoked_at timestamptz;
COMMENT ON COLUMN public.photo_share_links.revoked_at IS 'Set when an admin revokes the link; revoked links stop serving photos immediately';

-- New links never expire (far-future sentinel); column and NOT NULL untouched
ALTER TABLE public.photo_share_links ALTER COLUMN expires_at SET DEFAULT '9999-12-31 00:00:00+00';

-- Backfill ONLY currently-active links; expired links stay expired
UPDATE public.photo_share_links SET expires_at = '9999-12-31 00:00:00+00' WHERE expires_at > now();

-- Lock everything except revoked_at and expires_at (future columns included)
CREATE OR REPLACE FUNCTION public.guard_photo_share_link_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF to_jsonb(NEW) - 'revoked_at' - 'expires_at' IS DISTINCT FROM to_jsonb(OLD) - 'revoked_at' - 'expires_at' THEN
    RAISE EXCEPTION 'Only revocation status may be changed on a photo share link';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tg_photo_share_link_guard ON public.photo_share_links;
CREATE TRIGGER tg_photo_share_link_guard BEFORE UPDATE ON public.photo_share_links
  FOR EACH ROW EXECUTE FUNCTION public.guard_photo_share_link_update();

-- Only owners/managers of the same tenant can update (revoke/reactivate)
GRANT UPDATE ON public.photo_share_links TO authenticated;
DROP POLICY IF EXISTS "Managers revoke share links" ON public.photo_share_links;
CREATE POLICY "Managers revoke share links" ON public.photo_share_links FOR UPDATE TO authenticated
  USING (public.is_owner_or_manager() AND tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK (public.is_owner_or_manager() AND tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));