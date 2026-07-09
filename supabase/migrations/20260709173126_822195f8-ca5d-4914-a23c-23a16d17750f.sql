INSERT INTO public.user_roles (user_id, role, tenant_id)
SELECT u.id, 'owner'::app_role, '00000000-0000-0000-0000-000000000001'::uuid
FROM auth.users u
WHERE u.email = 'info@washrinserepeatcleaning.com'
AND NOT EXISTS (
  SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role = 'owner'::app_role
);