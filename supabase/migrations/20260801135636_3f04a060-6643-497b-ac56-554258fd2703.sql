ALTER TABLE public.payment_orders
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'live'
  CHECK (environment IN ('sandbox', 'live'));

CREATE INDEX IF NOT EXISTS payment_orders_environment_idx
  ON public.payment_orders (environment);