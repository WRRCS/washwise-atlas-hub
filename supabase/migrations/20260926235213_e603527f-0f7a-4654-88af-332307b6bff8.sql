DROP FUNCTION public.client_private_extras(uuid);
CREATE FUNCTION public.client_private_extras(_client uuid)
RETURNS TABLE (secondary_phone text, lead_source text, secondary_email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.secondary_phone, c.lead_source, c.secondary_email FROM public.clients c
  WHERE c.id = _client AND c.tenant_id = public.current_tenant_id() AND public.is_owner_or_manager();
$$;
REVOKE EXECUTE ON FUNCTION public.client_private_extras(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_private_extras(uuid) TO authenticated;