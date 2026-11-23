CREATE OR REPLACE FUNCTION public.stuck_job_photo_uploads(p_after timestamptz, p_before timestamptz)
RETURNS TABLE(name text, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
  SELECT o.name, o.created_at
  FROM storage.objects o
  WHERE o.bucket_id = 'job-photos'
    AND o.created_at >= p_after
    AND o.created_at < p_before
    AND split_part(o.name, '/', 4) ~ '^([0-9a-f-]{36}|staff)-p-'
    AND NOT EXISTS (SELECT 1 FROM public.job_photos p WHERE p.storage_path = o.name)
  ORDER BY o.created_at
  LIMIT 500
$$;
REVOKE ALL ON FUNCTION public.stuck_job_photo_uploads(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stuck_job_photo_uploads(timestamptz, timestamptz) TO service_role;