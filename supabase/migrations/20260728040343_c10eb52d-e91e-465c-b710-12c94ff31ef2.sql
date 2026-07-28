
-- 1) Revoke EXECUTE on definer functions from anon (and authenticated where safe).
-- Portal RPCs require an authenticated magic-link session — remove anon access.
REVOKE EXECUTE ON FUNCTION public.portal_email_is_client(text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.portal_get_data() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.portal_send_message(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.portal_request_service(uuid, uuid, date, text) FROM anon, PUBLIC;

-- Billing / plan RPCs are for signed-in tenant owners only.
REVOKE EXECUTE ON FUNCTION public.get_my_billing_summary() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_billing_summary(text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_subscription_gate() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.preview_plan_change(text) FROM anon, PUBLIC;

-- Reports / analytics: signed-in staff only.
REVOKE EXECUTE ON FUNCTION public.get_client_retention() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_employee_productivity(date, date) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_inventory_usage_detail(date, date) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_revenue_by_month(date, date) FROM anon, PUBLIC;

-- Super-admin RPCs: revoke from anon and authenticated — server functions call them
-- via the service role, and each function already re-checks super_admin internally.
REVOKE EXECUTE ON FUNCTION public.admin_get_tenant(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_tenants() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_platform_stats() FROM anon, authenticated, PUBLIC;

-- Purge is an owner-only maintenance op invoked via server code.
REVOKE EXECUTE ON FUNCTION public.purge_expired_gps(uuid) FROM anon, authenticated, PUBLIC;

-- 2) Payments: only owners may insert.
DROP POLICY IF EXISTS "staff insert payments" ON public.payments;
CREATE POLICY "owners insert payments" ON public.payments
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner());

-- 3) Storage: replace tenant-only job-photos policies with per-job assignment checks.
-- Path layout is `${tenant_id}/${job_id}/...`, so foldername[2] = job_id.
DROP POLICY IF EXISTS "Staff read job photos in tenant" ON storage.objects;
DROP POLICY IF EXISTS "Staff upload job photos in tenant" ON storage.objects;

CREATE POLICY "Staff read assigned job photos" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'job-photos'
    AND (storage.foldername(name))[1] = (public.current_tenant_id())::text
    AND (
      public.is_owner()
      OR EXISTS (
        SELECT 1 FROM public.job_employees je
         WHERE je.job_id::text = (storage.foldername(name))[2]
           AND je.employee_id = auth.uid()
      )
    )
  );

CREATE POLICY "Staff upload assigned job photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'job-photos'
    AND (storage.foldername(name))[1] = (public.current_tenant_id())::text
    AND owner = auth.uid()
    AND (
      public.is_owner()
      OR EXISTS (
        SELECT 1 FROM public.job_employees je
         WHERE je.job_id::text = (storage.foldername(name))[2]
           AND je.employee_id = auth.uid()
      )
    )
  );
