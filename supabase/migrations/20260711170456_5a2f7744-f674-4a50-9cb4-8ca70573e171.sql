ALTER TABLE public.payment_orders
  ADD COLUMN IF NOT EXISTS provider_subscription_id text;

CREATE INDEX IF NOT EXISTS idx_payment_orders_subscription
  ON public.payment_orders (provider_subscription_id);