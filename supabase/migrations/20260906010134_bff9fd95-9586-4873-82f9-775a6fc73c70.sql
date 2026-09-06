REVOKE ALL ON FUNCTION public.client_contact_info(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_contact_info(uuid[]) TO authenticated;