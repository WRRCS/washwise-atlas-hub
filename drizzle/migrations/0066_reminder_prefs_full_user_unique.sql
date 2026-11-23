CREATE UNIQUE INDEX IF NOT EXISTS reminder_prefs_tenant_user_key
  ON public.reminder_preferences (tenant_id, user_id);
DROP INDEX IF EXISTS public.reminder_prefs_user_unique;