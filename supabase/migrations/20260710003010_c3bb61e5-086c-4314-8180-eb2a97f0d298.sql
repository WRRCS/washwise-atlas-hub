
DROP FUNCTION IF EXISTS public.save_qbo_integration(uuid, text, text, text, jsonb);

DROP INDEX IF EXISTS public.invoices_qbo_sync_error_idx;

ALTER TABLE public.invoices
  DROP COLUMN IF EXISTS qbo_id,
  DROP COLUMN IF EXISTS qbo_synced_at,
  DROP COLUMN IF EXISTS qbo_sync_error;

ALTER TABLE public.clients
  DROP COLUMN IF EXISTS qbo_customer_id;

DELETE FROM public.integrations WHERE provider = 'quickbooks';
