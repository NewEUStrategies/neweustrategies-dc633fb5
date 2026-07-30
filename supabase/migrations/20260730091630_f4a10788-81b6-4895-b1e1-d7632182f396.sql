ALTER TABLE public.payment_webhook_events
  DROP CONSTRAINT IF EXISTS payment_webhook_events_status_check;
ALTER TABLE public.payment_webhook_events
  ADD CONSTRAINT payment_webhook_events_status_check
  CHECK (status IN ('received','processed','skipped','failed','ignored'));

ALTER TABLE public.donations
  DROP CONSTRAINT IF EXISTS donations_provider_check;
ALTER TABLE public.donations
  ADD CONSTRAINT donations_provider_check
  CHECK (provider IN ('stripe','paddle','mock'));

CREATE INDEX IF NOT EXISTS payment_webhook_events_type_idx
  ON public.payment_webhook_events (event_type, created_at DESC);