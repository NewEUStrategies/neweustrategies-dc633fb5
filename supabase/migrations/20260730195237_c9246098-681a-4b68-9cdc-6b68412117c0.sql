ALTER TABLE public.payment_integration_state
  ADD COLUMN IF NOT EXISTS catalog_fingerprint text;