-- Refund scoping (audit): charge.refunded cancelował WSZYSTKIE aktywne
-- subskrypcje użytkownika (filtr tylko po user_id + status='active') zamiast tej
-- jednej opłaconej refundowanym zamówieniem. Brakowało powiązania zamówienie ->
-- subskrypcja: user_subscriptions.external_ref = (stripe subscription id ||
-- session id), ale payment_orders tego nie przechowywało.
--
-- Dodajemy provider_subscription_id (analogicznie do provider_session_id /
-- provider_intent_id); webhook zapisuje tu external_ref subskrypcji przy
-- checkout.session.completed, a charge.refunded zawęża anulowanie do tej
-- konkretnej subskrypcji.
ALTER TABLE public.payment_orders
  ADD COLUMN IF NOT EXISTS provider_subscription_id text;

CREATE INDEX IF NOT EXISTS idx_payment_orders_subscription
  ON public.payment_orders (provider_subscription_id);
