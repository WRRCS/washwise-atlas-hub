
CREATE POLICY "sop_photos_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'sop-photos'
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text);

CREATE POLICY "sop_photos_owner_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'sop-photos'
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
    AND public.is_owner());

CREATE POLICY "sop_photos_owner_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'sop-photos'
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
    AND public.is_owner());

CREATE POLICY "sop_photos_owner_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'sop-photos'
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
    AND public.is_owner());
