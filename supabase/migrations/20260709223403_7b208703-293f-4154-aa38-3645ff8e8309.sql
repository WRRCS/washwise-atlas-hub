CREATE OR REPLACE FUNCTION public.save_qbo_integration(
  _tenant uuid,
  _realm_id text,
  _access_token text,
  _refresh_token text,
  _settings jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.integrations (tenant_id, provider, is_connected, connected_at, external_account_id, access_token, refresh_token, settings)
  VALUES (_tenant, 'quickbooks', true, now(), _realm_id, _access_token, _refresh_token, COALESCE(_settings,'{}'::jsonb))
  ON CONFLICT (tenant_id, provider) DO UPDATE
    SET is_connected = true,
        connected_at = now(),
        external_account_id = EXCLUDED.external_account_id,
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        settings = EXCLUDED.settings,
        updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.save_qbo_integration(uuid, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_qbo_integration(uuid, text, text, text, jsonb) TO anon, authenticated, service_role;