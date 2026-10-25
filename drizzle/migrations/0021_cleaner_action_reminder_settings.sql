CREATE TABLE public.cleaner_action_reminder_settings (
 user_id uuid PRIMARY KEY REFERENCES public.profiles(id),tenant_id uuid NOT NULL REFERENCES public.tenants(id),enabled boolean NOT NULL DEFAULT false,clock_in_minutes_before integer NOT NULL DEFAULT 15 CHECK(clock_in_minutes_before BETWEEN 0 AND 120),arrival_minutes_after integer NOT NULL DEFAULT 5 CHECK(arrival_minutes_after BETWEEN 0 AND 120),channels text[] NOT NULL DEFAULT ARRAY['push']::text[] CHECK(channels <@ ARRAY['push']::text[] AND cardinality(channels)=1),updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT,UPDATE ON public.cleaner_action_reminder_settings TO authenticated;
GRANT ALL ON public.cleaner_action_reminder_settings TO service_role;
ALTER TABLE public.cleaner_action_reminder_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY action_reminders_read ON public.cleaner_action_reminder_settings FOR SELECT TO authenticated USING(tenant_id=public.current_tenant_id() AND (user_id=auth.uid() OR public.is_owner_or_manager()));
CREATE POLICY action_reminders_write ON public.cleaner_action_reminder_settings FOR ALL TO authenticated USING(tenant_id=public.current_tenant_id() AND (user_id=auth.uid() OR public.is_owner_or_manager())) WITH CHECK(tenant_id=public.current_tenant_id() AND (user_id=auth.uid() OR public.is_owner_or_manager()) AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=user_id AND p.tenant_id=tenant_id AND p.is_active));
ALTER TABLE public.notifications ADD COLUMN action_reminder_key text;
ALTER TABLE public.notifications ADD COLUMN delivery_claimed_at timestamptz;
CREATE UNIQUE INDEX notification_action_reminder_key ON public.notifications(action_reminder_key) WHERE action_reminder_key IS NOT NULL;
COMMENT ON TABLE public.cleaner_action_reminder_settings IS 'Opt-in clock-in and arrival action reminders. Only configured Web Push delivery is supported; email and SMS are not enabled here.';