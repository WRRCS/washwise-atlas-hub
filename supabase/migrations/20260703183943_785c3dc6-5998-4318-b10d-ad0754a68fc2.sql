
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS qbo_id TEXT,
  ADD COLUMN IF NOT EXISTS qbo_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qbo_sync_error TEXT;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS qbo_customer_id TEXT;

CREATE INDEX IF NOT EXISTS invoices_qbo_sync_error_idx
  ON public.invoices (tenant_id) WHERE qbo_sync_error IS NOT NULL;
