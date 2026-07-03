
CREATE POLICY "Staff read job photos in tenant"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'job-photos'
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

CREATE POLICY "Staff upload job photos in tenant"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'job-photos'
    AND (storage.foldername(name))[1] = public.current_tenant_id()::text
    AND owner = auth.uid()
  );

CREATE POLICY "Owner delete own job photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'job-photos'
    AND owner = auth.uid()
  );
