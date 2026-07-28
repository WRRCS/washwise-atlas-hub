
-- 1. reminder_preferences table
CREATE TABLE public.reminder_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  lead_minutes INTEGER[] NOT NULL DEFAULT ARRAY[1440, 60]::INTEGER[],
  channels TEXT[] NOT NULL DEFAULT ARRAY['push']::TEXT[],
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reminder_prefs_one_owner CHECK (
    (user_id IS NOT NULL AND client_id IS NULL) OR
    (user_id IS NULL AND client_id IS NOT NULL)
  ),
  CONSTRAINT reminder_prefs_channels_ck CHECK (
    channels <@ ARRAY['sms','email','push']::TEXT[] AND array_length(channels, 1) >= 1
  ),
  CONSTRAINT reminder_prefs_lead_ck CHECK (
    array_length(lead_minutes, 1) >= 1
    AND array_length(lead_minutes, 1) <= 6
  )
);

CREATE UNIQUE INDEX reminder_prefs_user_unique
  ON public.reminder_preferences(tenant_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX reminder_prefs_client_unique
  ON public.reminder_preferences(tenant_id, client_id) WHERE client_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reminder_preferences TO authenticated;
GRANT ALL ON public.reminder_preferences TO service_role;

ALTER TABLE public.reminder_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reminder_prefs_self_read"
  ON public.reminder_preferences FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (user_id = auth.uid() OR public.is_owner())
  );

CREATE POLICY "reminder_prefs_self_write"
  ON public.reminder_preferences FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (user_id = auth.uid() OR public.is_owner())
  );

CREATE POLICY "reminder_prefs_self_update"
  ON public.reminder_preferences FOR UPDATE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (user_id = auth.uid() OR public.is_owner())
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (user_id = auth.uid() OR public.is_owner())
  );

CREATE POLICY "reminder_prefs_owner_delete"
  ON public.reminder_preferences FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner());

CREATE TRIGGER reminder_prefs_updated_at
  BEFORE UPDATE ON public.reminder_preferences
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 2. Seed employee reminder template per existing tenant
INSERT INTO public.notification_templates (tenant_id, name, channel, subject, body, is_active)
SELECT t.id, 'appointment_reminder_employee', 'push', 'Upcoming job',
  'Reminder: {{service_name}} for {{client_name}} at {{scheduled_start}}', true
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.notification_templates nt
  WHERE nt.tenant_id = t.id AND nt.name = 'appointment_reminder_employee'
);

-- 3. Rewrite reminder trigger to fan out per recipient preferences
CREATE OR REPLACE FUNCTION public.tg_enqueue_appointment_reminder()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tenant_lead_hours INT;
  _lead_min INT;
  _channel TEXT;
  _send_at TIMESTAMPTZ;
  _prefs public.reminder_preferences%ROWTYPE;
  _emp RECORD;
BEGIN
  IF NEW.status IN ('canceled', 'completed') THEN
    RETURN NEW;
  END IF;

  -- On any change, drop future pending reminders for this job so we can re-enqueue
  IF TG_OP = 'UPDATE' THEN
    DELETE FROM public.notifications
      WHERE tenant_id = NEW.tenant_id
        AND template_name IN ('appointment_reminder_client', 'appointment_reminder_employee')
        AND status = 'pending'
        AND (payload->>'job_id')::uuid = NEW.id;
  END IF;

  SELECT reminder_lead_hours INTO _tenant_lead_hours FROM public.tenants WHERE id = NEW.tenant_id;

  -- Client reminders
  SELECT * INTO _prefs FROM public.reminder_preferences
    WHERE tenant_id = NEW.tenant_id AND client_id = NEW.client_id;

  IF FOUND AND _prefs.enabled THEN
    FOREACH _lead_min IN ARRAY _prefs.lead_minutes LOOP
      _send_at := NEW.scheduled_start - (_lead_min || ' minutes')::interval;
      IF _send_at > now() THEN
        FOREACH _channel IN ARRAY _prefs.channels LOOP
          PERFORM public.enqueue_notification(
            NEW.tenant_id, 'client', NEW.client_id, _channel::notification_channel,
            'appointment_reminder_client',
            jsonb_build_object('job_id', NEW.id, 'scheduled_start', NEW.scheduled_start, 'lead_minutes', _lead_min),
            _send_at
          );
        END LOOP;
      END IF;
    END LOOP;
  ELSIF NOT FOUND THEN
    -- Fallback to tenant default (single SMS reminder), preserves legacy behaviour
    _send_at := NEW.scheduled_start - (COALESCE(_tenant_lead_hours, 24) || ' hours')::interval;
    IF _send_at > now() THEN
      PERFORM public.enqueue_notification(
        NEW.tenant_id, 'client', NEW.client_id, 'sms',
        'appointment_reminder_client',
        jsonb_build_object('job_id', NEW.id, 'scheduled_start', NEW.scheduled_start),
        _send_at
      );
    END IF;
  END IF;

  -- Employee reminders (one per assigned employee, per their prefs)
  FOR _emp IN
    SELECT je.employee_id FROM public.job_employees je WHERE je.job_id = NEW.id
  LOOP
    SELECT * INTO _prefs FROM public.reminder_preferences
      WHERE tenant_id = NEW.tenant_id AND user_id = _emp.employee_id;
    IF FOUND AND _prefs.enabled THEN
      FOREACH _lead_min IN ARRAY _prefs.lead_minutes LOOP
        _send_at := NEW.scheduled_start - (_lead_min || ' minutes')::interval;
        IF _send_at > now() THEN
          FOREACH _channel IN ARRAY _prefs.channels LOOP
            PERFORM public.enqueue_notification(
              NEW.tenant_id, 'employee', _emp.employee_id, _channel::notification_channel,
              'appointment_reminder_employee',
              jsonb_build_object('job_id', NEW.id, 'scheduled_start', NEW.scheduled_start, 'lead_minutes', _lead_min),
              _send_at
            );
          END LOOP;
        END IF;
      END LOOP;
    ELSIF NOT FOUND THEN
      -- Default employee reminder: 1 hour before, via push
      _send_at := NEW.scheduled_start - INTERVAL '1 hour';
      IF _send_at > now() THEN
        PERFORM public.enqueue_notification(
          NEW.tenant_id, 'employee', _emp.employee_id, 'push',
          'appointment_reminder_employee',
          jsonb_build_object('job_id', NEW.id, 'scheduled_start', NEW.scheduled_start),
          _send_at
        );
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.tg_enqueue_appointment_reminder() FROM PUBLIC, anon, authenticated;

-- 4. Enqueue reminders when an employee is newly assigned to an existing job
CREATE OR REPLACE FUNCTION public.tg_enqueue_reminder_on_assign()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _job public.jobs%ROWTYPE;
  _prefs public.reminder_preferences%ROWTYPE;
  _lead_min INT;
  _channel TEXT;
  _send_at TIMESTAMPTZ;
BEGIN
  SELECT * INTO _job FROM public.jobs WHERE id = NEW.job_id;
  IF NOT FOUND OR _job.status IN ('canceled', 'completed') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO _prefs FROM public.reminder_preferences
    WHERE tenant_id = NEW.tenant_id AND user_id = NEW.employee_id;

  IF FOUND AND _prefs.enabled THEN
    FOREACH _lead_min IN ARRAY _prefs.lead_minutes LOOP
      _send_at := _job.scheduled_start - (_lead_min || ' minutes')::interval;
      IF _send_at > now() THEN
        FOREACH _channel IN ARRAY _prefs.channels LOOP
          PERFORM public.enqueue_notification(
            NEW.tenant_id, 'employee', NEW.employee_id, _channel::notification_channel,
            'appointment_reminder_employee',
            jsonb_build_object('job_id', _job.id, 'scheduled_start', _job.scheduled_start, 'lead_minutes', _lead_min),
            _send_at
          );
        END LOOP;
      END IF;
    END LOOP;
  ELSIF NOT FOUND THEN
    _send_at := _job.scheduled_start - INTERVAL '1 hour';
    IF _send_at > now() THEN
      PERFORM public.enqueue_notification(
        NEW.tenant_id, 'employee', NEW.employee_id, 'push',
        'appointment_reminder_employee',
        jsonb_build_object('job_id', _job.id, 'scheduled_start', _job.scheduled_start),
        _send_at
      );
    END IF;
  END IF;

  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.tg_enqueue_reminder_on_assign() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_job_employee_reminder ON public.job_employees;
CREATE TRIGGER trg_job_employee_reminder
  AFTER INSERT ON public.job_employees
  FOR EACH ROW EXECUTE FUNCTION public.tg_enqueue_reminder_on_assign();

-- Clear pending reminders for an employee removed from a job
CREATE OR REPLACE FUNCTION public.tg_clear_reminder_on_unassign()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.notifications
    WHERE tenant_id = OLD.tenant_id
      AND template_name = 'appointment_reminder_employee'
      AND recipient_type = 'employee'
      AND recipient_id = OLD.employee_id
      AND status = 'pending'
      AND (payload->>'job_id')::uuid = OLD.job_id;
  RETURN OLD;
END $$;

REVOKE EXECUTE ON FUNCTION public.tg_clear_reminder_on_unassign() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_job_employee_reminder_clear ON public.job_employees;
CREATE TRIGGER trg_job_employee_reminder_clear
  AFTER DELETE ON public.job_employees
  FOR EACH ROW EXECUTE FUNCTION public.tg_clear_reminder_on_unassign();

-- 5. Portal RPCs for clients to manage their own reminder preferences
CREATE OR REPLACE FUNCTION public.portal_get_reminder_prefs(_client_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _email TEXT;
  _client public.clients%ROWTYPE;
  _prefs public.reminder_preferences%ROWTYPE;
BEGIN
  _email := lower((auth.jwt() ->> 'email'));
  SELECT * INTO _client FROM public.clients WHERE id = _client_id;
  IF NOT FOUND OR lower(_client.email) IS DISTINCT FROM _email THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT * INTO _prefs FROM public.reminder_preferences
    WHERE tenant_id = _client.tenant_id AND client_id = _client_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'enabled', true,
      'lead_minutes', to_jsonb(ARRAY[1440, 60]::INT[]),
      'channels', to_jsonb(ARRAY['email']::TEXT[]),
      'is_default', true
    );
  END IF;

  RETURN jsonb_build_object(
    'enabled', _prefs.enabled,
    'lead_minutes', to_jsonb(_prefs.lead_minutes),
    'channels', to_jsonb(_prefs.channels),
    'is_default', false
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.portal_get_reminder_prefs(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_get_reminder_prefs(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.portal_upsert_reminder_prefs(
  _client_id UUID,
  _lead_minutes INT[],
  _channels TEXT[],
  _enabled BOOLEAN
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _email TEXT;
  _client public.clients%ROWTYPE;
BEGIN
  _email := lower((auth.jwt() ->> 'email'));
  SELECT * INTO _client FROM public.clients WHERE id = _client_id;
  IF NOT FOUND OR lower(_client.email) IS DISTINCT FROM _email THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF NOT (_channels <@ ARRAY['sms','email','push']::TEXT[]) OR array_length(_channels, 1) IS NULL THEN
    RAISE EXCEPTION 'invalid_channels';
  END IF;
  IF array_length(_lead_minutes, 1) IS NULL OR array_length(_lead_minutes, 1) > 6 THEN
    RAISE EXCEPTION 'invalid_lead_minutes';
  END IF;

  INSERT INTO public.reminder_preferences (tenant_id, client_id, lead_minutes, channels, enabled)
    VALUES (_client.tenant_id, _client_id, _lead_minutes, _channels, _enabled)
    ON CONFLICT (tenant_id, client_id) DO UPDATE
      SET lead_minutes = EXCLUDED.lead_minutes,
          channels = EXCLUDED.channels,
          enabled = EXCLUDED.enabled,
          updated_at = now();

  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE EXECUTE ON FUNCTION public.portal_upsert_reminder_prefs(UUID, INT[], TEXT[], BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_upsert_reminder_prefs(UUID, INT[], TEXT[], BOOLEAN) TO authenticated;
