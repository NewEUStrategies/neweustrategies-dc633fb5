-- pgTAP: scenariusz Z-S2-01 (§16.5) po stronie księgi MRR - to, co
-- w trybie testowym Stripe właściciel sprawdzał w tabelach po webhookach
-- (I9b, część B, decyzja właściciela 2026-10-20, zgoda delegowana).
--
-- Webhook operatora zapisuje migawkę subskrypcji (`subscriptions`), a księgę
-- prowadzi wyzwalacz S2 (`tg_subscriptions_revenue_history`). Ten plik
-- odtwarza zapisy webhooka z kolejnych kroków instrukcji:
--   krok 3  zakup planu miesięcznego: kwota i waluta wypełnione, rabat 0,
--           JEDEN ruch `new`;
--   krok 5  kupon retencyjny -30% dopięty u operatora: ruch `contraction`
--           z powodem `discount` (rabat obniża MRR);
--   krok 6  rezygnacja na koniec okresu: zdarzenie `status_changed.v1`
--           z `cancel_at_period_end = true`, BEZ ruchu MRR (klient płaci do
--           końca opłaconego okresu - churn zapisze dopiero koniec);
--   krok 7  wznowienie: zdarzenie z `cancel_at_period_end = false`, bez ruchu.
-- Sam przepływ (`retention_feedback`, oferta, klucze idempotencji) - vitest
-- (`functions.stripeBoundary.test.ts`) i `retention_flow_test.sql`.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test hub_i9b_retention_scenario
BEGIN;
SELECT plan(8);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name)
VALUES ('19b40000-0000-4000-8000-0000000000a1', 'i9b-retention', 'I9b Retencja');
INSERT INTO auth.users (id, email)
VALUES ('19b40000-0000-4000-8000-00000000a101', 'klient@i9b-retention.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id)
VALUES ('19b40000-0000-4000-8000-00000000a101', 'klient@i9b-retention.test', 'Klient',
        '19b40000-0000-4000-8000-0000000000a1');

CREATE FUNCTION pg_temp.moves() RETURNS text LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(kind || ':' || reason || ':' || delta_minor || ':' || currency, ',' ORDER BY id), '')
    FROM public.mrr_movements WHERE subscription_id = '19b40000-0000-4000-8000-0000000005a1'
$$;
-- Zdarzenia jednej transakcji mają ten sam `created_at` - liczymy flagi,
-- zamiast polegać na kolejności.
CREATE FUNCTION pg_temp.cancel_flags() RETURNS text LANGUAGE sql AS $$
  SELECT 'true=' || count(*) FILTER (WHERE payload ->> 'cancel_at_period_end' = 'true')
      || ',false=' || count(*) FILTER (WHERE payload ->> 'cancel_at_period_end' = 'false')
    FROM public.domain_events
   WHERE aggregate_id = '19b40000-0000-4000-8000-0000000005a1'
     AND event_type = 'billing_subscription.status_changed.v1'
$$;

-- ── Krok 3: zakup planu miesięcznego (webhook `customer.subscription.created`) ──
-- `plus_monthly` - cena z lustra katalogu (20261020110000), plan miesięczny.
INSERT INTO public.subscriptions (id, tenant_id, user_id, provider_subscription_id, provider_customer_id,
  product_id, price_id, status, environment, unit_amount_minor, currency, last_event_id)
VALUES ('19b40000-0000-4000-8000-0000000005a1', '19b40000-0000-4000-8000-0000000000a1',
        '19b40000-0000-4000-8000-00000000a101', 'sub_i9b_ret', 'cus_i9b_ret', 'plan_plus',
        'plus_monthly', 'active', 'live', 3900, 'PLN', 'evt_ret_1');
SELECT results_eq(
  $$ SELECT unit_amount_minor, currency, discount_minor_per_period
       FROM public.subscriptions WHERE id = '19b40000-0000-4000-8000-0000000005a1' $$,
  $$ VALUES (3900, 'PLN'::text, 0) $$,
  'krok 3: kwota i waluta z migawki, rabat 0');
SELECT is(pg_temp.moves(), 'new:signup:3900:PLN', 'krok 3: jeden ruch new (signup)');

-- ── Krok 5: kupon retencyjny -30% na 3 miesiące (webhook z rozwiniętym rabatem) ──
UPDATE public.subscriptions
   SET discount_minor_per_period = 1170, discount_ends_at = now() + interval '3 months',
       last_event_id = 'evt_ret_2'
 WHERE id = '19b40000-0000-4000-8000-0000000005a1';
SELECT is(pg_temp.moves(), 'new:signup:3900:PLN,contraction:discount:-1170:PLN',
  'krok 5: rabat retencyjny = contraction z powodem discount (-30% z 39 zł)');
SELECT is(
  (SELECT mrr_after_minor FROM public.subscription_state_history
    WHERE subscription_id = '19b40000-0000-4000-8000-0000000005a1' ORDER BY id DESC LIMIT 1),
  2730, 'krok 5: MRR po rabacie 27,30 zł');

-- ── Krok 6: „Anuluj mimo to" - rezygnacja na koniec okresu ──
UPDATE public.subscriptions SET cancel_at_period_end = true, last_event_id = 'evt_ret_3'
 WHERE id = '19b40000-0000-4000-8000-0000000005a1';
SELECT is(pg_temp.moves(), 'new:signup:3900:PLN,contraction:discount:-1170:PLN',
  'krok 6: rezygnacja na koniec okresu NIE jest ruchem MRR (klient płaci do końca okresu)');
SELECT is(pg_temp.cancel_flags(), 'true=1,false=1',
  'krok 6: status_changed.v1 z cancel_at_period_end = true (wyzwalacz maila i ścieżek)');

-- ── Krok 7: „Wznów subskrypcję" ──
UPDATE public.subscriptions SET cancel_at_period_end = false, last_event_id = 'evt_ret_4'
 WHERE id = '19b40000-0000-4000-8000-0000000005a1';
SELECT is(pg_temp.cancel_flags(), 'true=1,false=2',
  'krok 7: wznowienie - status_changed.v1 z cancel_at_period_end = false');
SELECT is(pg_temp.moves(), 'new:signup:3900:PLN,contraction:discount:-1170:PLN',
  'krok 7: wznowienie bez ruchu MRR');

SELECT * FROM finish();
ROLLBACK;
