ALTER TABLE public.payment_webhook_events
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS duration_ms integer;

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_created_at
  ON public.payment_webhook_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_status
  ON public.payment_webhook_events (status, created_at DESC);