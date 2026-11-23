CREATE UNIQUE INDEX IF NOT EXISTS reminder_prefs_tenant_client_key
  ON public.reminder_preferences (tenant_id, client_id);
DROP INDEX IF EXISTS public.reminder_prefs_client_unique;