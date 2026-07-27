DELETE FROM public.user_roles WHERE user_id = (SELECT id FROM auth.users WHERE email = 'info@washrinserepeatcleaning.com') AND role = 'owner';
INSERT INTO public.user_roles (user_id, tenant_id, role)
SELECT p.id, p.tenant_id, 'employee'::app_role FROM public.profiles p JOIN auth.users u ON u.id = p.id WHERE u.email = 'info@washrinserepeatcleaning.com'
AND NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = 'employee');