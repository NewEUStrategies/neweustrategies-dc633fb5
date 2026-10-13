ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS last_event_id text;

COMMENT ON COLUMN public.subscriptions.last_event_id IS
  'Identyfikator zdarzenia operatora (evt_... / reconcile_...), ktorego skutki rozpoczeto przy last_event_at. Ten sam znacznik i ten sam identyfikator = ponowienie tego zdarzenia (przetwarzamy ponownie); ten sam znacznik i inny identyfikator = remis w obrebie sekundy (stan z API operatora, zapis tie:<id>). Pisze wylacznie webhook (rola serwisowa).';

COMMENT ON COLUMN public.subscriptions.last_event_at IS
  'occurred_at najnowszego zdarzenia operatora, ktorego skutki ROZPOCZETO - straznik kolejnosci (out-of-order webhooks). Razem z last_event_id odroznia ponowienie tego samego zdarzenia od spoznionego.';