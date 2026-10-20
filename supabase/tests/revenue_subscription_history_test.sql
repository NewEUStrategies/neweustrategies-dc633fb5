-- pgTAP: księga MRR - historia stanów, ruchy po delcie, windykacja, zdarzenia
-- billingu i RODO przy usunięciu konta (S2, migracja 20261020110100).
--
-- CO PRZYPINA:
--   * klasyfikacja PO DELCIE, nie po randze: `plus_monthly` (39 zł) ->
--     `plus_annual` (32,50 zł/mies.) = `contraction` (pułapka rangi);
--   * pauza = `churn` z `reason = 'paused'` + `status_changed {paused: true}`,
--     wznowienie = `reactivation` (`resumed`), trial -> płatny = `new`
--     (`trial_converted`), trial sam w sobie bez ruchu;
--   * zmiana waluty = `churn` w starej + `new` w nowej (`currency_switch`);
--   * idempotencja: wiersz historii z tym samym `dedupe_key` (to samo zdarzenie
--     operatora i ten sam stan) nie powstaje drugi raz i nie daje ruchu;
--   * cena nieznana katalogowi w stanie płatnym: historia z MRR NULL, saldo bez
--     zmian (zero nie udaje wyniku);
--   * windykacja: 0 -> 1 otwiera cykl (MRR zagrożone = saldo), kolejna porażka
--     zwiększa `failures`, powrót = `recovered` + `payment_recovered.v1`,
--     anulowanie przy otwartym cyklu = `lost` + `churn` `unpaid`;
--   * sandbox pisze księgę swojego środowiska, ale NIE emituje zdarzeń;
--   * izolacja awarii szyny: `emit_domain_event` podmieniona w transakcji na
--     rzucającą - zapis subskrypcji i ruch przechodzą, ślad w
--     `domain_event_emit_errors`;
--   * Z-07: usunięcie konta nie zmienia Σ `delta_minor` zamkniętych miesięcy,
--     dopisuje odejście salda bez `user_id`, anonimizuje historię, ruchy
--     i cykle, domyka otwarty cykl jako `lost` (od I9b identyfikator
--     subskrypcji w księdze jest wymieniany na losowy - pełna redakcja:
--     hub_i9b_revenue_ledger_erasure_test);
--   * `subscription.renewed.v1` - raz, tylko faktura odnowienia live bez
--     zamówienia (także `open` -> `paid`), payload bez PII; dwóch najemców.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test revenue_subscription_history
BEGIN;
SELECT plan(38);

-- ── Fixture ──────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('d2020000-0000-0000-0000-0000000000a0', 'hub-s2-hist-a', 'Hub S2 historia A'),
  ('d2020000-0000-0000-0000-0000000000b0', 'hub-s2-hist-b', 'Hub S2 historia B');

INSERT INTO auth.users (id, email) VALUES
  ('d2020000-0000-0000-0000-00000000a101', 'c1@hub-s2-hist.test'),
  ('d2020000-0000-0000-0000-00000000a102', 'c2@hub-s2-hist.test'),
  ('d2020000-0000-0000-0000-00000000a103', 'c3@hub-s2-hist.test'),
  ('d2020000-0000-0000-0000-00000000a104', 'c4@hub-s2-hist.test'),
  ('d2020000-0000-0000-0000-00000000b101', 'b1@hub-s2-hist.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('d2020000-0000-0000-0000-00000000a101', 'c1@hub-s2-hist.test', 'C1', 'd2020000-0000-0000-0000-0000000000a0'),
  ('d2020000-0000-0000-0000-00000000a102', 'c2@hub-s2-hist.test', 'C2', 'd2020000-0000-0000-0000-0000000000a0'),
  ('d2020000-0000-0000-0000-00000000a103', 'c3@hub-s2-hist.test', 'C3', 'd2020000-0000-0000-0000-0000000000a0'),
  ('d2020000-0000-0000-0000-00000000a104', 'c4@hub-s2-hist.test', 'C4', 'd2020000-0000-0000-0000-0000000000a0'),
  ('d2020000-0000-0000-0000-00000000b101', 'b1@hub-s2-hist.test', 'B1', 'd2020000-0000-0000-0000-0000000000b0');

CREATE FUNCTION pg_temp.sub_moves(p_sub uuid) RETURNS text LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(kind || ':' || reason || ':' || delta_minor || ':' || currency, ',' ORDER BY id), '')
    FROM public.mrr_movements WHERE subscription_id = p_sub
$$;
CREATE FUNCTION pg_temp.sub_events(p_sub uuid, p_type text) RETURNS integer LANGUAGE sql AS $$
  SELECT count(*)::integer FROM public.domain_events
   WHERE aggregate_id = p_sub::text AND event_type = p_type
$$;

-- ── 1. Atrybuty i granty ─────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public.tg_subscriptions_revenue_history()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.tg_subscriptions_revenue_history()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.tg_billing_documents_renewed_emit()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.tg_billing_documents_renewed_emit()', 'EXECUTE'),
  'acl: funkcje wyzwalaczy bez EXECUTE dla anon i authenticated');
SELECT ok(
  (SELECT bool_and(p.prosecdef AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%pg_temp%'))
     FROM pg_proc p
    WHERE p.oid IN ('public.tg_subscriptions_revenue_history()'::regprocedure,
                    'public.tg_billing_documents_renewed_emit()'::regprocedure)),
  'atrybuty: SECURITY DEFINER i search_path z pg_temp');
SELECT ok(
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_subscriptions_revenue_history'
           AND tgrelid = 'public.subscriptions'::regclass AND NOT tgisinternal)
  AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_billing_documents_renewed_emit'
               AND tgrelid = 'public.billing_documents'::regclass AND NOT tgisinternal),
  'wyzwalacze: księga na subscriptions, odnowienie na billing_documents');

-- ── 2. Nowy klient, pułapka rangi, pauza, wznowienie ───────────────────────
INSERT INTO public.subscriptions (id, tenant_id, user_id, provider_subscription_id, provider_customer_id,
  product_id, price_id, status, environment, unit_amount_minor, currency, last_event_id)
VALUES ('d2020000-0000-0000-0000-0000000005a1', 'd2020000-0000-0000-0000-0000000000a0',
        'd2020000-0000-0000-0000-00000000a101', 'sub_hist_a1', 'cus_hist_a1', 'plan_plus', 'plus_monthly',
        'active', 'live', 3900, 'PLN', 'evt_a1_1');
SELECT is(pg_temp.sub_moves('d2020000-0000-0000-0000-0000000005a1'), 'new:signup:3900:PLN',
  'nowy: 0 -> 39 zł = new/signup');
SELECT results_eq(
  $$ SELECT mrr_before_minor, mrr_after_minor, mrr_basis, status_before, status_after
       FROM public.subscription_state_history WHERE subscription_id = 'd2020000-0000-0000-0000-0000000005a1' $$,
  $$ VALUES (0, 3900, 'provider'::text, NULL::text, 'active'::text) $$,
  'historia: MRR przed/po i podstawa kwoty (migawka operatora)');

UPDATE public.subscriptions SET price_id = 'plus_annual', unit_amount_minor = 39000, last_event_id = 'evt_a1_2'
 WHERE id = 'd2020000-0000-0000-0000-0000000005a1';
SELECT is(pg_temp.sub_moves('d2020000-0000-0000-0000-0000000005a1'),
  'new:signup:3900:PLN,contraction:plan_change:-650:PLN',
  'pułapka rangi: plus_monthly -> plus_annual (wyższa ranga, niższe MRR) = contraction');

UPDATE public.subscriptions SET status = 'paused', pause_collection_behavior = 'void', last_event_id = 'evt_a1_3'
 WHERE id = 'd2020000-0000-0000-0000-0000000005a1';
SELECT is(
  (SELECT kind || ':' || reason || ':' || delta_minor FROM public.mrr_movements
    WHERE subscription_id = 'd2020000-0000-0000-0000-0000000005a1' ORDER BY id DESC LIMIT 1),
  'churn:paused:-3250',
  'pauza = churn z reason=paused (nie canceled - bez fałszywego win-backu)');
SELECT is(
  (SELECT (payload->>'paused')::boolean FROM public.domain_events
    WHERE aggregate_id = 'd2020000-0000-0000-0000-0000000005a1'
      AND event_type = 'billing_subscription.status_changed.v1' AND payload->>'new_status' = 'paused'),
  true,
  'pauza: status_changed.v1 z paused=true');

UPDATE public.subscriptions SET status = 'active', pause_collection_behavior = NULL, last_event_id = 'evt_a1_4'
 WHERE id = 'd2020000-0000-0000-0000-0000000005a1';
SELECT is(
  (SELECT kind || ':' || reason || ':' || delta_minor FROM public.mrr_movements
    WHERE subscription_id = 'd2020000-0000-0000-0000-0000000005a1' ORDER BY id DESC LIMIT 1),
  'reactivation:resumed:3250',
  'wznowienie = reactivation/resumed');

-- ── 3. Zmiana waluty ─────────────────────────────────────────────────────────
UPDATE public.subscriptions SET currency = 'EUR', unit_amount_minor = 9600, last_event_id = 'evt_a1_5'
 WHERE id = 'd2020000-0000-0000-0000-0000000005a1';
SELECT is(
  (SELECT string_agg(kind || ':' || reason || ':' || delta_minor || ':' || currency, ',' ORDER BY id)
     FROM (SELECT * FROM public.mrr_movements WHERE subscription_id = 'd2020000-0000-0000-0000-0000000005a1'
            ORDER BY id DESC LIMIT 2) t),
  'churn:currency_switch:-3250:PLN,new:currency_switch:800:EUR',
  'waluta: churn w PLN + new w EUR (currency_switch), kwoty nie sumowane między walutami');
SELECT is(
  (SELECT count(*)::integer FROM public.mrr_movements
    WHERE subscription_id = 'd2020000-0000-0000-0000-0000000005a1' AND reason = 'currency_switch' AND history_id IS NULL),
  1,
  'waluta: drugi ruch bez history_id (jeden wiersz historii = jeden ruch)');
SELECT results_eq(
  $$ SELECT currency, sum(delta_minor)::integer FROM public.mrr_movements
      WHERE subscription_id = 'd2020000-0000-0000-0000-0000000005a1' GROUP BY currency ORDER BY currency $$,
  $$ VALUES ('EUR'::text, 800), ('PLN'::text, 0) $$,
  'waluta: saldo PLN zamknięte, EUR otwarte');

-- ── 4. Idempotencja (ten sam dedupe_key) i aktualizacja bez znaczenia ─────
-- Wiersz historii, który zapisałaby powtórka zdarzenia `evt_a1_6`
-- (rezygnacja na koniec okresu), jest już w księdze - trigger go nie dubluje.
INSERT INTO public.subscription_state_history (tenant_id, subscription_id, user_id, environment,
  source_event_id, status_before, status_after, price_id_before, price_id_after, quantity_before,
  quantity_after, paused_after, cancel_at_period_end_after, payment_failure_count_after,
  mrr_before_minor, mrr_after_minor, currency, mrr_basis, dedupe_key)
SELECT s.tenant_id, s.id, s.user_id, s.environment, 'evt_a1_6', s.status, s.status, s.price_id, s.price_id,
       s.quantity, s.quantity, false, true, 0, 800, 800, 'EUR', 'provider',
       s.id::text || ':evt_a1_6:' || md5(concat_ws('|', s.status, s.price_id, s.quantity, true,
         s.pause_collection_behavior, s.payment_failure_count, s.unit_amount_minor, s.currency,
         s.discount_minor_per_period, s.discount_ends_at, s.environment))
  FROM public.subscriptions s WHERE s.id = 'd2020000-0000-0000-0000-0000000005a1';
UPDATE public.subscriptions SET cancel_at_period_end = true, last_event_id = 'evt_a1_6'
 WHERE id = 'd2020000-0000-0000-0000-0000000005a1';
SELECT is(
  (SELECT count(*)::integer FROM public.subscription_state_history
    WHERE subscription_id = 'd2020000-0000-0000-0000-0000000005a1' AND source_event_id = 'evt_a1_6'),
  1,
  'idempotencja: jeden wiersz historii na dedupe_key (powtórka zdarzenia)');
SELECT is(
  (SELECT count(*)::integer FROM public.mrr_movements WHERE subscription_id = 'd2020000-0000-0000-0000-0000000005a1'),
  6,
  'idempotencja: powtórka nie dopisuje ruchu; rezygnacja na koniec okresu nie zmienia MRR');
UPDATE public.subscriptions SET last_event_at = now(), updated_at = now()
 WHERE id = 'd2020000-0000-0000-0000-0000000005a1';
SELECT is(
  (SELECT count(*)::integer FROM public.subscription_state_history WHERE subscription_id = 'd2020000-0000-0000-0000-0000000005a1'),
  6,
  'strażnik zdarzeń (last_event_at) nie tworzy historii');

-- ── 5. Trial, cena nieznana ─────────────────────────────────────────────────
INSERT INTO public.subscriptions (id, tenant_id, user_id, provider_subscription_id, provider_customer_id,
  product_id, price_id, status, environment, last_event_id, trial_ends_at)
VALUES ('d2020000-0000-0000-0000-0000000005a2', 'd2020000-0000-0000-0000-0000000000a0',
        'd2020000-0000-0000-0000-00000000a102', 'sub_hist_a2', 'cus_hist_a2', 'plan_pro', 'pro_monthly',
        'trialing', 'live', 'evt_a2_1', now() + interval '5 days');
SELECT is(pg_temp.sub_moves('d2020000-0000-0000-0000-0000000005a2'), '',
  'trial: bez ruchu (to jeszcze nie przychód)');
UPDATE public.subscriptions SET status = 'active', last_event_id = 'evt_a2_2'
 WHERE id = 'd2020000-0000-0000-0000-0000000005a2';
SELECT is(pg_temp.sub_moves('d2020000-0000-0000-0000-0000000005a2'), 'new:trial_converted:11900:PLN',
  'trial -> płatny = new/trial_converted (kwota z katalogu, D-05)');
SELECT is(
  (SELECT mrr_basis FROM public.subscription_state_history
    WHERE subscription_id = 'd2020000-0000-0000-0000-0000000005a2' ORDER BY id DESC LIMIT 1),
  'catalog',
  'D-05: bez migawki operatora historia zapisuje basis=catalog jawnie');
UPDATE public.subscriptions SET price_id = 'cena_spoza_katalogu', last_event_id = 'evt_a2_3'
 WHERE id = 'd2020000-0000-0000-0000-0000000005a2';
SELECT ok(
  (SELECT mrr_after_minor IS NULL FROM public.subscription_state_history
    WHERE subscription_id = 'd2020000-0000-0000-0000-0000000005a2' ORDER BY id DESC LIMIT 1)
  AND pg_temp.sub_moves('d2020000-0000-0000-0000-0000000005a2') = 'new:trial_converted:11900:PLN',
  'cena nieznana w stanie płatnym: historia z MRR NULL, saldo bez zmian');

-- ── 6. Windykacja ────────────────────────────────────────────────────────────
UPDATE public.subscriptions SET price_id = 'pro_monthly', status = 'past_due', payment_failure_count = 1,
       first_payment_failed_at = now(), last_event_id = 'evt_a2_4'
 WHERE id = 'd2020000-0000-0000-0000-0000000005a2';
SELECT results_eq(
  $$ SELECT outcome, failures, mrr_at_risk_minor, currency FROM public.dunning_cycles
      WHERE subscription_id = 'd2020000-0000-0000-0000-0000000005a2' $$,
  $$ VALUES ('open'::text, 1, 11900, 'PLN'::text) $$,
  'windykacja: 0 -> 1 otwiera cykl z MRR zagrożonym = saldo');
SELECT is(pg_temp.sub_events('d2020000-0000-0000-0000-0000000005a2', 'billing_subscription.payment_failed.v1'), 1,
  'windykacja: payment_failed.v1 raz');
UPDATE public.subscriptions SET payment_failure_count = 2, last_event_id = 'evt_a2_5'
 WHERE id = 'd2020000-0000-0000-0000-0000000005a2';
SELECT is((SELECT failures FROM public.dunning_cycles WHERE subscription_id = 'd2020000-0000-0000-0000-0000000005a2'), 2,
  'windykacja: druga porażka zwiększa failures, nie otwiera nowego cyklu');
UPDATE public.subscriptions SET payment_failure_count = 0, status = 'active', first_payment_failed_at = NULL,
       last_event_id = 'evt_a2_6'
 WHERE id = 'd2020000-0000-0000-0000-0000000005a2';
SELECT ok(
  (SELECT outcome = 'recovered' AND recovered_at IS NOT NULL FROM public.dunning_cycles
    WHERE subscription_id = 'd2020000-0000-0000-0000-0000000005a2')
  AND pg_temp.sub_events('d2020000-0000-0000-0000-0000000005a2', 'billing_subscription.payment_recovered.v1') = 1,
  'windykacja: powrót do 0 przy active = recovered + payment_recovered.v1');
SELECT is(pg_temp.sub_moves('d2020000-0000-0000-0000-0000000005a2'), 'new:trial_converted:11900:PLN',
  'windykacja: past_due to wciąż klient - bez ruchu MRR');

UPDATE public.subscriptions SET payment_failure_count = 1, status = 'past_due', first_payment_failed_at = now(),
       last_event_id = 'evt_a2_7'
 WHERE id = 'd2020000-0000-0000-0000-0000000005a2';
UPDATE public.subscriptions SET status = 'canceled', last_event_id = 'evt_a2_8'
 WHERE id = 'd2020000-0000-0000-0000-0000000005a2';
SELECT ok(
  (SELECT count(*) = 2 AND count(*) FILTER (WHERE outcome = 'lost' AND lost_at IS NOT NULL) = 1
     FROM public.dunning_cycles WHERE subscription_id = 'd2020000-0000-0000-0000-0000000005a2')
  AND (SELECT reason FROM public.mrr_movements WHERE subscription_id = 'd2020000-0000-0000-0000-0000000005a2'
        ORDER BY id DESC LIMIT 1) = 'unpaid',
  'windykacja: anulowanie przy otwartym cyklu = lost + churn/unpaid');

-- ── 7. Sandbox: księga środowiska, bez zdarzeń ──────────────────────────────
INSERT INTO public.subscriptions (id, tenant_id, user_id, provider_subscription_id, provider_customer_id,
  product_id, price_id, status, environment, unit_amount_minor, currency, last_event_id)
VALUES ('d2020000-0000-0000-0000-0000000005a3', 'd2020000-0000-0000-0000-0000000000a0',
        'd2020000-0000-0000-0000-00000000a103', 'sub_hist_a3', 'cus_hist_a3', 'plan_plus', 'plus_monthly',
        'active', 'sandbox', 3900, 'PLN', 'evt_a3_1');
UPDATE public.subscriptions SET payment_failure_count = 1, status = 'past_due', last_event_id = 'evt_a3_2'
 WHERE id = 'd2020000-0000-0000-0000-0000000005a3';
SELECT ok(
  (SELECT environment FROM public.mrr_movements WHERE subscription_id = 'd2020000-0000-0000-0000-0000000005a3') = 'sandbox'
  AND NOT EXISTS (SELECT 1 FROM public.domain_events WHERE aggregate_id = 'd2020000-0000-0000-0000-0000000005a3'),
  'sandbox: ruch w swoim środowisku, zero zdarzeń na szynie');

-- ── 8. Rezygnacja na koniec okresu: zdarzenie, bez ruchu ────────────────────
SELECT ok(
  EXISTS (SELECT 1 FROM public.domain_events
           WHERE aggregate_id = 'd2020000-0000-0000-0000-0000000005a1'
             AND event_type = 'billing_subscription.status_changed.v1'
             AND (payload->>'cancel_at_period_end')::boolean),
  'cancel_at_period_end: status_changed.v1 z flagą (zdarzenie niezależne od deduplikacji księgi)');
SELECT is_empty(
  $$ SELECT k FROM public.domain_events e, jsonb_object_keys(e.payload) k
      WHERE e.event_type LIKE 'billing_subscription.%'
        AND e.tenant_id = 'd2020000-0000-0000-0000-0000000000a0'
        AND k IN ('email', 'name', 'body', 'token', 'phone', 'note') $$,
  'payload billing_subscription.*: bez PII');

-- ── 9. Izolacja awarii szyny ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.emit_domain_event(
  p_tenant_id uuid, p_aggregate_type text, p_aggregate_id text, p_event_type text,
  p_payload jsonb DEFAULT '{}'::jsonb, p_actor_id uuid DEFAULT NULL, p_suppress_actor boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'szyna niedostępna (test)' USING ERRCODE = 'XX000';
END;
$$;
SELECT lives_ok(
  $$ INSERT INTO public.subscriptions (id, tenant_id, user_id, provider_subscription_id, provider_customer_id,
       product_id, price_id, status, environment, unit_amount_minor, currency, last_event_id)
     VALUES ('d2020000-0000-0000-0000-0000000005a4', 'd2020000-0000-0000-0000-0000000000a0',
             'd2020000-0000-0000-0000-00000000a104', 'sub_hist_a4', 'cus_hist_a4', 'plan_plus', 'plus_monthly',
             'active', 'live', 3900, 'PLN', 'evt_a4_1') $$,
  'awaria szyny: zapis webhooka przechodzi');
SELECT ok(
  pg_temp.sub_moves('d2020000-0000-0000-0000-0000000005a4') = 'new:signup:3900:PLN'
  AND EXISTS (SELECT 1 FROM public.domain_event_emit_errors
               WHERE tenant_id = 'd2020000-0000-0000-0000-0000000000a0'
                 AND source = 'tg_subscriptions_revenue_history'
                 AND event_type = 'billing_subscription.status_changed.v1'),
  'awaria szyny: księga zapisana, ślad w domain_event_emit_errors');
SELECT is(
  (SELECT count(*)::integer FROM public.domain_event_emit_errors
    WHERE tenant_id = 'd2020000-0000-0000-0000-0000000000a0' AND event_type = 'ledger'),
  0,
  'księga bez błędów na fiksturze');

-- ── 10. Z-07: usunięcie konta nie zmienia zamkniętych miesięcy ─────────────
-- Ruchy klienta 1 przesunięte do zamkniętego miesiąca (wstecz od dziś).
UPDATE public.mrr_movements SET occurred_at = date_trunc('month', now()) - interval '20 days'
 WHERE subscription_id = 'd2020000-0000-0000-0000-0000000005a1';
UPDATE public.subscriptions SET payment_failure_count = 1, status = 'past_due', last_event_id = 'evt_a1_8'
 WHERE id = 'd2020000-0000-0000-0000-0000000005a1';
CREATE TEMP TABLE closed_before ON COMMIT DROP AS
  SELECT currency, sum(delta_minor) AS s FROM public.mrr_movements
   WHERE tenant_id = 'd2020000-0000-0000-0000-0000000000a0' AND environment = 'live'
     AND occurred_at < date_trunc('month', now())
   GROUP BY currency;
CREATE TEMP TABLE a1_rows ON COMMIT DROP AS
  SELECT id FROM public.mrr_movements WHERE subscription_id = 'd2020000-0000-0000-0000-0000000005a1';
DELETE FROM auth.users WHERE id = 'd2020000-0000-0000-0000-00000000a101';
-- Redakcja RODO I9b (20261020160400): identyfikator subskrypcji w księdze
-- zostaje wymieniony na losowy (wspólny dla historii, ruchów i cykli) - wiersze
-- odnajdujemy po ich `id` sprzed usunięcia.
CREATE TEMP TABLE a1_new ON COMMIT DROP AS
  SELECT DISTINCT m.subscription_id AS sub FROM public.mrr_movements m JOIN a1_rows r ON r.id = m.id;
SELECT results_eq(
  $$ SELECT currency, sum(delta_minor) FROM public.mrr_movements
      WHERE tenant_id = 'd2020000-0000-0000-0000-0000000000a0' AND environment = 'live'
        AND occurred_at < date_trunc('month', now())
      GROUP BY currency ORDER BY currency $$,
  $$ SELECT currency, s FROM closed_before ORDER BY currency $$,
  'Z-07: Σ delta_minor zamkniętych miesięcy bez zmian po usunięciu konta');
SELECT ok(
  (SELECT count(*) FROM a1_new) = 1
  AND (SELECT kind || ':' || reason || ':' || delta_minor || ':' || currency FROM public.mrr_movements
        WHERE subscription_id = (SELECT sub FROM a1_new) ORDER BY id DESC LIMIT 1) = 'churn:canceled:-800:EUR'
  AND (SELECT sum(delta_minor) FROM public.mrr_movements WHERE subscription_id = (SELECT sub FROM a1_new)) = 0,
  'Z-07: odejście otwartego salda zapisane przy usunięciu (saldo 0)');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.mrr_movements WHERE subscription_id = (SELECT sub FROM a1_new) AND user_id IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM public.subscription_state_history WHERE subscription_id = (SELECT sub FROM a1_new) AND user_id IS NOT NULL)
  AND (SELECT count(*) FROM public.subscription_state_history WHERE subscription_id = (SELECT sub FROM a1_new)) > 0
  AND NOT EXISTS (SELECT 1 FROM public.dunning_cycles WHERE subscription_id = (SELECT sub FROM a1_new)
                   AND (user_id IS NOT NULL OR outcome <> 'lost'))
  AND (SELECT count(*) FROM public.dunning_cycles WHERE subscription_id = (SELECT sub FROM a1_new)) > 0,
  'Z-07: historia, ruchy i cykle zostają bez user_id; otwarty cykl domknięty jako lost');

-- ── 11. Dwóch najemców ───────────────────────────────────────────────────────
INSERT INTO public.subscriptions (id, tenant_id, user_id, provider_subscription_id, provider_customer_id,
  product_id, price_id, status, environment, unit_amount_minor, currency, last_event_id)
VALUES ('d2020000-0000-0000-0000-0000000005b1', 'd2020000-0000-0000-0000-0000000000b0',
        'd2020000-0000-0000-0000-00000000b101', 'sub_hist_b1', 'cus_hist_b1', 'plan_plus', 'plus_monthly',
        'active', 'live', 3900, 'PLN', 'evt_b1_1');
SELECT ok(
  (SELECT tenant_id FROM public.mrr_movements WHERE subscription_id = 'd2020000-0000-0000-0000-0000000005b1')
    = 'd2020000-0000-0000-0000-0000000000b0'
  AND (SELECT count(*) FROM public.mrr_movements
        WHERE tenant_id = 'd2020000-0000-0000-0000-0000000000b0') = 1,
  'najemcy: ruch w najemcy WIERSZA subskrypcji');

-- ── 12. subscription.renewed.v1 ──────────────────────────────────────────────
-- Szyna z powrotem produkcyjna (przywrócona definicja z 20260808190000).
CREATE OR REPLACE FUNCTION public.emit_domain_event(
  p_tenant_id uuid, p_aggregate_type text, p_aggregate_id text, p_event_type text,
  p_payload jsonb DEFAULT '{}'::jsonb, p_actor_id uuid DEFAULT NULL, p_suppress_actor boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.domain_events (tenant_id, aggregate_type, aggregate_id, event_type, payload, actor_id)
  VALUES (p_tenant_id, p_aggregate_type, p_aggregate_id, p_event_type, COALESCE(p_payload, '{}'::jsonb),
          CASE WHEN p_suppress_actor THEN NULL ELSE p_actor_id END)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
INSERT INTO public.user_subscriptions (id, tenant_id, user_id, plan_id, status)
SELECT 'd2020000-0000-0000-0000-0000000006a4', 'd2020000-0000-0000-0000-0000000000a0',
       'd2020000-0000-0000-0000-00000000a104', p.id, 'active'
  FROM public.access_plans p
 WHERE p.tenant_id = 'd2020000-0000-0000-0000-0000000000a0' AND p.tier_key = 'member' AND p.interval = 'month'
 LIMIT 1;
INSERT INTO public.billing_documents (id, tenant_id, user_id, subscription_id, order_id, kind, status,
  provider, provider_document_id, amount_cents, currency, environment) VALUES
  ('d2020000-0000-0000-0000-0000000007a1', 'd2020000-0000-0000-0000-0000000000a0', 'd2020000-0000-0000-0000-00000000a104',
   'd2020000-0000-0000-0000-0000000006a4', NULL, 'invoice', 'paid', 'stripe', 'in_hist_1', 3900, 'PLN', 'live'),
  ('d2020000-0000-0000-0000-0000000007a2', 'd2020000-0000-0000-0000-0000000000a0', 'd2020000-0000-0000-0000-00000000a104',
   'd2020000-0000-0000-0000-0000000006a4', NULL, 'invoice', 'paid', 'stripe', 'in_hist_2', 3900, 'PLN', 'sandbox'),
  ('d2020000-0000-0000-0000-0000000007a3', 'd2020000-0000-0000-0000-0000000000a0', 'd2020000-0000-0000-0000-00000000a104',
   'd2020000-0000-0000-0000-0000000006a4', NULL, 'invoice', 'open', 'stripe', 'in_hist_3', 3900, 'PLN', 'live');
SELECT is(
  (SELECT count(*)::integer FROM public.domain_events
    WHERE event_type = 'subscription.renewed.v1' AND aggregate_id = 'd2020000-0000-0000-0000-0000000006a4'),
  1,
  'renewed: faktura live opłacona = 1 zdarzenie; sandbox i open bez zdarzenia');
UPDATE public.billing_documents SET status = 'paid' WHERE id = 'd2020000-0000-0000-0000-0000000007a3';
UPDATE public.billing_documents SET status = 'paid', hosted_url = 'https://example.test/x'
 WHERE id = 'd2020000-0000-0000-0000-0000000007a3';
SELECT is(
  (SELECT count(*)::integer FROM public.domain_events
    WHERE event_type = 'subscription.renewed.v1' AND payload->>'document_id' = 'd2020000-0000-0000-0000-0000000007a3'),
  1,
  'renewed: open -> paid emituje raz (kolejne aktualizacje nie dublują)');
SELECT is(
  (SELECT jsonb_object_keys_sorted FROM (
     SELECT string_agg(k, ',' ORDER BY k) AS jsonb_object_keys_sorted
       FROM public.domain_events e, jsonb_object_keys(e.payload) k
      WHERE e.event_type = 'subscription.renewed.v1' AND e.payload->>'document_id' = 'd2020000-0000-0000-0000-0000000007a1') t),
  'document_id,subscription_id,user_id',
  'renewed: payload = identyfikatory (bez kwot i PII)');

SELECT * FROM finish();
ROLLBACK;
