-- ============================================================================
-- STRAZNIK KOLEJNOSCI ZDARZEN SUBSKRYPCJI: IDENTYFIKATOR OSTATNIEGO ZDARZENIA
-- (audyt PAY-02, PAY-10).
--
-- DEFEKT. Webhook operatora platnosci (`src/lib/billing/webhookDispatch.server.ts`,
-- `claimSubscriptionEvent`) przesuwal `subscriptions.last_event_at` PRZED
-- skutkami zdarzenia warunkiem `last_event_at < occurredAt`. Gdy skutki padly
-- (np. przejsciowy blad zapisu uprawnienia po odnowieniu), ponowna dostawa TEGO
-- SAMEGO zdarzenia widziala rowny znacznik i konczyla sie `skipped` - status
-- `failed` w dzienniku nadpisywalo `skipped`, operator przestawal ponawiac,
-- a klient tracil dostep, za ktory zaplacil. Druga klasa: Stripe podaje czas
-- zdarzenia z rozdzielczoscia SEKUNDY, wiec drugie, INNE zdarzenie z ta sama
-- sekunda (np. `created` + `updated` przy jednej kasie) bylo pomijane jako
-- "spoznione".
--
-- ZMIANA. Kolumna `last_event_id` - identyfikator zdarzenia operatora
-- (`evt_...`, albo syntetyczny `reconcile_...`), ktorego skutki ROZPOCZETO przy
-- znaczniku `last_event_at`. Straznik zapisuje pare (znacznik, identyfikator)
-- jednym warunkowym UPDATE i rozstrzyga po niej:
--   * znacznik nowszy                  -> zdarzenie swieze, przetwarzamy,
--   * ten sam znacznik, ten sam id     -> ponowienie TEGO zdarzenia (dostawa po
--                                         500, panel, zamiatarka) - przetwarzamy
--                                         ponownie, skutki sa idempotentne,
--   * ten sam znacznik, inny id        -> remis w obrebie sekundy: stan bierzemy
--                                         z API operatora, a kolumna dostaje
--                                         `tie:<id>`, wiec KAZDE kolejne zdarzenie
--                                         z ta sekunda tez idzie po stan z API,
--   * znacznik starszy                 -> `skipped`.
--
-- ZAJECIE PORZADKUJE ZAJECIA, NIE SKUTKI (przeglad 1.0 / 1.3). Stan
-- subskrypcji (status, cena, okres) webhook zapisuje NA KONCU obslugi,
-- warunkiem `last_event_at = <znacznik> AND last_event_id = <id zajecia>`.
-- Zero trafionych wierszy = nowsze zdarzenie przejelo wiersz w trakcie
-- skutkow; uprawnienie wyrownuje wtedy stan z API operatora. Powtorka po
-- porazce skutkow widzi wiec POPRZEDNI status i cene (przejscia nie gina).
-- Synchronizacja na zadanie zapisuje identyfikator `self-sync:<sub>:<sekunda>`
-- ze znacznikiem o sekunde wczesniejszym niz jej odczyt u operatora.
--
-- UPRAWNIENIA BEZ ZMIAN. Pisarzem jest wylacznie webhook pod rola serwisowa
-- (`GRANT ALL ... TO service_role`, 20260729072626); `authenticated` czyta
-- wlasny wiersz polityka wlasciciela. Kolumna nie niesie danych osobowych -
-- to identyfikator zdarzenia operatora, tej samej klasy co `last_event_at`.
--
-- KOLEJNOSC WDROZENIA: NAJPIERW MIGRACJA. Kod zapisuje `last_event_id`
-- w kazdym zajeciu zdarzenia - bez kolumny PostgREST odrzuca UPDATE (PGRST204)
-- i kazde zdarzenie subskrypcji konczy sie `failed` (operator ponawia, nic
-- nie ginie, ale dostep stoi do wdrozenia migracji).
-- IDEMPOTENTNA: ADD COLUMN IF NOT EXISTS, COMMENT ON.
-- ============================================================================

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS last_event_id text;

COMMENT ON COLUMN public.subscriptions.last_event_id IS
  'Identyfikator zdarzenia operatora (evt_... / reconcile_...), ktorego skutki rozpoczeto przy last_event_at. Ten sam znacznik i ten sam identyfikator = ponowienie tego zdarzenia (przetwarzamy ponownie); ten sam znacznik i inny identyfikator = remis w obrebie sekundy (stan z API operatora, zapis tie:<id>). Pisze wylacznie webhook (rola serwisowa).';

COMMENT ON COLUMN public.subscriptions.last_event_at IS
  'occurred_at najnowszego zdarzenia operatora, ktorego skutki ROZPOCZETO - straznik kolejnosci (out-of-order webhooks). Razem z last_event_id odroznia ponowienie tego samego zdarzenia od spoznionego.';
