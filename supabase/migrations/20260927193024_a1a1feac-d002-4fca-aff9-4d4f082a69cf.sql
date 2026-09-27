CREATE TABLE public.tips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  payment_id uuid REFERENCES public.payments(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  employee_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  amount_cents integer NOT NULL,
  source text NOT NULL DEFAULT 'overpayment',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tips_tenant_idx ON public.tips(tenant_id, created_at DESC);
CREATE INDEX tips_employee_idx ON public.tips(employee_id);
CREATE INDEX tips_payment_idx ON public.tips(payment_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tips TO authenticated;
GRANT ALL ON public.tips TO service_role;
ALTER TABLE public.tips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "managers manage tips" ON public.tips FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_owner_or_manager());
CREATE POLICY "employees view own tips" ON public.tips FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND employee_id = auth.uid());
CREATE TRIGGER tips_updated_at BEFORE UPDATE ON public.tips FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Anything paid above the invoice total (card fee included) becomes a tip, split evenly.
CREATE OR REPLACE FUNCTION public.tg_record_tip_from_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inv record;
  paid bigint;
  already bigint;
  extra bigint;
  n int;
  share int;
  remainder int;
  emp record;
  i int := 0;
BEGIN
  IF NEW.status <> 'succeeded' OR NEW.invoice_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'succeeded' THEN RETURN NEW; END IF;
  SELECT id, tenant_id, job_id, COALESCE(total_cents, amount_cents, 0) AS total INTO inv
    FROM public.invoices WHERE id = NEW.invoice_id;
  IF inv.id IS NULL THEN RETURN NEW; END IF;
  SELECT COALESCE(sum(amount_cents),0) INTO paid FROM public.payments
    WHERE invoice_id = inv.id AND status = 'succeeded';
  SELECT COALESCE(sum(amount_cents),0) INTO already FROM public.tips
    WHERE invoice_id = inv.id AND source = 'overpayment';
  extra := paid - inv.total - already;
  IF extra <= 0 THEN RETURN NEW; END IF;
  SELECT count(*) INTO n FROM public.job_employees WHERE job_id = inv.job_id;
  IF inv.job_id IS NULL OR n = 0 THEN
    INSERT INTO public.tips(tenant_id, payment_id, invoice_id, job_id, employee_id, amount_cents, note)
    VALUES (inv.tenant_id, NEW.id, inv.id, inv.job_id, NULL, extra, 'No cleaner on this job — assign it');
    RETURN NEW;
  END IF;
  share := extra / n;
  remainder := extra - share * n;
  FOR emp IN SELECT employee_id FROM public.job_employees WHERE job_id = inv.job_id ORDER BY employee_id LOOP
    i := i + 1;
    INSERT INTO public.tips(tenant_id, payment_id, invoice_id, job_id, employee_id, amount_cents)
    VALUES (inv.tenant_id, NEW.id, inv.id, inv.job_id, emp.employee_id,
            share + CASE WHEN i <= remainder THEN 1 ELSE 0 END);
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tg_record_tip_from_payment() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER payments_record_tip AFTER INSERT OR UPDATE OF status ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_record_tip_from_payment();

-- Client draft channel
ALTER TABLE public.client_message_drafts ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'portal';

-- Per-job alerts respect the publish choice
CREATE OR REPLACE FUNCTION public.tg_enqueue_push_schedule_published()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  svc text; cli text; emp record;
  mode text := COALESCE(NULLIF(current_setting('app.publish_notify', true), ''), 'impacted');
BEGIN
  IF NEW.published_at IS NULL OR OLD.published_at IS NOT NULL THEN RETURN NEW; END IF;
  IF mode <> 'impacted' THEN RETURN NEW; END IF;
  SELECT name INTO svc FROM public.service_types WHERE id = NEW.service_type_id;
  cli := public._client_name(NEW.client_id);
  FOR emp IN SELECT employee_id FROM public.job_employees WHERE job_id = NEW.id LOOP
    PERFORM public.enqueue_notification(
      NEW.tenant_id, 'employee', emp.employee_id, 'push', 'push_schedule_published',
      jsonb_build_object('service_name', COALESCE(svc, 'Job'), 'client_name', cli,
        'scheduled_start', to_char(NEW.scheduled_start AT TIME ZONE 'UTC', 'Dy, Mon DD "at" HH12:MI AM'),
        'job_id', NEW.id::text), now());
  END LOOP;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.publish_schedule(_from timestamptz, _to timestamptz, _notify text, _client_channel text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t uuid := public.current_tenant_id();
  ids uuid[];
  emp record;
  cl record;
  drafts int := 0;
BEGIN
  IF NOT public.is_owner_or_manager() THEN RAISE EXCEPTION 'Only owners and managers can publish'; END IF;
  IF _notify NOT IN ('everyone','impacted','none') THEN RAISE EXCEPTION 'Bad notify option'; END IF;
  IF _client_channel NOT IN ('none','email','sms') THEN RAISE EXCEPTION 'Bad client option'; END IF;
  PERFORM set_config('app.publish_notify', _notify, true);
  WITH u AS (
    UPDATE public.jobs SET published_at = now()
    WHERE tenant_id = t AND published_at IS NULL AND scheduled_start >= _from AND scheduled_start < _to
    RETURNING id)
  SELECT array_agg(id) INTO ids FROM u;
  IF ids IS NULL THEN RETURN jsonb_build_object('count', 0, 'drafts', 0); END IF;

  IF _notify = 'everyone' THEN
    FOR emp IN SELECT p.id FROM public.profiles p WHERE p.tenant_id = t AND p.is_active LOOP
      PERFORM public.enqueue_notification(t, 'employee', emp.id, 'push', 'push_schedule_published',
        jsonb_build_object('service_name', 'Schedule', 'client_name', 'The team',
          'scheduled_start', to_char(_from AT TIME ZONE 'UTC', 'Mon DD'), 'job_id', ''), now());
    END LOOP;
  END IF;

  IF _client_channel <> 'none' THEN
    FOR cl IN
      SELECT j.client_id,
        string_agg(to_char(j.scheduled_start AT TIME ZONE COALESCE(tn.timezone,'America/Los_Angeles'), 'Dy Mon DD, HH12:MI AM')
          || ' — ' || COALESCE(s.name,'Cleaning'), E'\n' ORDER BY j.scheduled_start) AS lines
      FROM public.jobs j
      LEFT JOIN public.service_types s ON s.id = j.service_type_id
      LEFT JOIN public.tenants tn ON tn.id = j.tenant_id
      WHERE j.id = ANY(ids) AND j.client_id IS NOT NULL AND j.status <> 'canceled'
      GROUP BY j.client_id
    LOOP
      INSERT INTO public.client_message_drafts(tenant_id, client_id, subject, body, status, created_by, channel)
      VALUES (t, cl.client_id, 'Your upcoming cleaning schedule',
        'Hi ' || COALESCE(public._client_name(cl.client_id),'there') || E',\n\nHere are your upcoming appointments:\n' || cl.lines || E'\n\nReply if anything needs to change. Thank you!',
        'draft', auth.uid(), _client_channel);
      drafts := drafts + 1;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('count', array_length(ids,1), 'drafts', drafts);
END $$;
REVOKE ALL ON FUNCTION public.publish_schedule(timestamptz,timestamptz,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_schedule(timestamptz,timestamptz,text,text) TO authenticated;