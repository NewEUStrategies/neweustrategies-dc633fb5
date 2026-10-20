-- pgTAP: RODO księgi MRR - pełna anonimizacja po usunięciu konta (I9b,
-- migracja 20261020160400; decyzja właściciela 2026-10-20, Z-07 / Z-S2-03).
--
-- CO PRZYPINA:
--   * po usunięciu konta ŻADEN wiersz `mrr_movements`,
--     `subscription_state_history`, `dunning_cycles` i `revenue_event_marks`
--     najemcy nie zawiera uid, e-maila ani identyfikatorów operatora tej
--     osoby (subskrypcji `sub_`, klienta `cus_`, zdarzenia `evt_`, ceny
--     osadzonej spoza katalogu) ani starego identyfikatora subskrypcji;
--   * ZOSTAJĄ: kwoty, waluta, daty, tier_key, segment, rodzaj i powód ruchu,
--     cena katalogowa; identyfikator subskrypcji wymieniony na losowy -
--     JEDEN dla historii, ruchów i cykli tej subskrypcji;
--   * Σ `delta_minor` zamkniętych miesięcy bez zmian;
--   * znaczniki konta (`quota`, `trial_ending` subskrypcji,
--     `retention_abandoned` odpowiedzi) usunięte, znaczniki innej osoby -
--     nie; dane innej osoby nietknięte;
--   * domknięcie wstecz (`_revenue_ledger_redact_orphans`): ślad
--     subskrypcji usuniętej przed I9b zredagowany, druga runda zwraca 0;
--   * ACL: funkcje bez EXECUTE dla ról API.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test hub_i9b_revenue_ledger_erasure
BEGIN;
SELECT plan(14);

-- ── Fikstura ─────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name)
VALUES ('19b40000-0000-4000-8000-0000000000a1', 'i9b-erasure', 'I9b Erasure');
INSERT INTO auth.users (id, email) VALUES
  ('19b40000-0000-4000-8000-00000000c001', 'usuwany@i9b-erasure.test'),
  ('19b40000-0000-4000-8000-00000000c002', 'zostaje@i9b-erasure.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('19b40000-0000-4000-8000-00000000c001', 'usuwany@i9b-erasure.test', 'Usuwany',
   '19b40000-0000-4000-8000-0000000000a1'),
  ('19b40000-0000-4000-8000-00000000c002', 'zostaje@i9b-erasure.test', 'Zostaje',
   '19b40000-0000-4000-8000-0000000000a1');

-- Osoba usuwana: plan katalogowy (ruch, historia, windykacja) i darowizna
-- cykliczna ceną osadzoną (historia z ceną spoza katalogu).
INSERT INTO public.subscriptions (id, tenant_id, user_id, provider_subscription_id, provider_customer_id,
  product_id, price_id, status, environment, unit_amount_minor, currency, last_event_id)
VALUES
  ('19b40000-0000-4000-8000-0000000005a1', '19b40000-0000-4000-8000-0000000000a1',
   '19b40000-0000-4000-8000-00000000c001', 'sub_i9b_a1', 'cus_i9b_a1', 'plan_plus', 'plus_monthly',
   'active', 'live', 3900, 'PLN', 'evt_i9b_a1_1'),
  ('19b40000-0000-4000-8000-0000000005a2', '19b40000-0000-4000-8000-0000000000a1',
   '19b40000-0000-4000-8000-00000000c001', 'sub_i9b_a2', 'cus_i9b_a1', 'prod_donation',
   'price_i9b_inline_a2', 'active', 'live', 5000, 'PLN', 'evt_i9b_a2_1');
UPDATE public.subscriptions SET payment_failure_count = 1, status = 'past_due', last_event_id = 'evt_i9b_a1_2'
 WHERE id = '19b40000-0000-4000-8000-0000000005a1';
-- Osoba zostająca.
INSERT INTO public.subscriptions (id, tenant_id, user_id, provider_subscription_id, provider_customer_id,
  product_id, price_id, status, environment, unit_amount_minor, currency, last_event_id)
VALUES ('19b40000-0000-4000-8000-0000000005b1', '19b40000-0000-4000-8000-0000000000a1',
        '19b40000-0000-4000-8000-00000000c002', 'sub_i9b_b1', 'cus_i9b_b1', 'plan_pro', 'pro_monthly',
        'active', 'live', 11900, 'PLN', 'evt_i9b_b1_1');

-- Ruchy osoby usuwanej w ZAMKNIĘTYM miesiącu (wstecz od dziś).
UPDATE public.mrr_movements SET occurred_at = date_trunc('month', now()) - interval '20 days'
 WHERE subscription_id = '19b40000-0000-4000-8000-0000000005a1';

-- Znaczniki: limit artykułów i trial osoby usuwanej, porzucona ankieta,
-- limit osoby zostającej.
INSERT INTO public.retention_feedback (id, tenant_id, user_id, outcome)
VALUES ('19b40000-0000-4000-8000-0000000000fb', '19b40000-0000-4000-8000-0000000000a1',
        '19b40000-0000-4000-8000-00000000c001', 'abandoned');
INSERT INTO public.revenue_event_marks (tenant_id, kind, ref) VALUES
  ('19b40000-0000-4000-8000-0000000000a1', 'quota', '19b40000-0000-4000-8000-00000000c001:2026-09'),
  ('19b40000-0000-4000-8000-0000000000a1', 'trial_ending', '19b40000-0000-4000-8000-0000000005a1:2026-09-01'),
  ('19b40000-0000-4000-8000-0000000000a1', 'retention_abandoned', '19b40000-0000-4000-8000-0000000000fb'),
  ('19b40000-0000-4000-8000-0000000000a1', 'quota', '19b40000-0000-4000-8000-00000000c002:2026-09');

CREATE TEMP TABLE closed_before ON COMMIT DROP AS
  SELECT currency, sum(delta_minor) AS s FROM public.mrr_movements
   WHERE tenant_id = '19b40000-0000-4000-8000-0000000000a1' AND environment = 'live'
     AND occurred_at < date_trunc('month', now())
   GROUP BY currency;
CREATE TEMP TABLE a1_rows ON COMMIT DROP AS
  SELECT 'h' AS t, id::text AS id FROM public.subscription_state_history
   WHERE subscription_id = '19b40000-0000-4000-8000-0000000005a1'
  UNION ALL
  SELECT 'm', id::text FROM public.mrr_movements WHERE subscription_id = '19b40000-0000-4000-8000-0000000005a1'
  UNION ALL
  SELECT 'd', id::text FROM public.dunning_cycles WHERE subscription_id = '19b40000-0000-4000-8000-0000000005a1';

-- Ślady w JSON jednego najemcy: wszystkie kolumny wszystkich wierszy księgi.
CREATE FUNCTION pg_temp.ledger_text() RETURNS text LANGUAGE sql AS $$
  SELECT concat_ws(' ',
    (SELECT string_agg(row_to_json(h)::text, ' ') FROM public.subscription_state_history h
      WHERE h.tenant_id = '19b40000-0000-4000-8000-0000000000a1'),
    (SELECT string_agg(row_to_json(m)::text, ' ') FROM public.mrr_movements m
      WHERE m.tenant_id = '19b40000-0000-4000-8000-0000000000a1'
        AND m.subscription_id IS DISTINCT FROM '19b40000-0000-4000-8000-0000000005b1'),
    (SELECT string_agg(row_to_json(d)::text, ' ') FROM public.dunning_cycles d
      WHERE d.tenant_id = '19b40000-0000-4000-8000-0000000000a1'),
    (SELECT string_agg(row_to_json(k)::text, ' ') FROM public.revenue_event_marks k
      WHERE k.tenant_id = '19b40000-0000-4000-8000-0000000000a1'
        AND k.ref NOT LIKE '19b40000-0000-4000-8000-00000000c002:%'))
$$;

SELECT ok(
  pg_temp.ledger_text() LIKE '%evt_i9b_a1%' AND pg_temp.ledger_text() LIKE '%19b40000-0000-4000-8000-00000000c001%',
  'fikstura: przed usunięciem księga niesie zdarzenia operatora i uid osoby');

-- ── Usunięcie konta (wyzwalacz I9b na auth.users włączony) ─────────────────
ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_deleted_redact_revenue;
DELETE FROM auth.users WHERE id = '19b40000-0000-4000-8000-00000000c001';

SELECT results_eq(
  $$ SELECT currency, sum(delta_minor) FROM public.mrr_movements
      WHERE tenant_id = '19b40000-0000-4000-8000-0000000000a1' AND environment = 'live'
        AND occurred_at < date_trunc('month', now())
      GROUP BY currency ORDER BY currency $$,
  $$ SELECT currency, s FROM closed_before ORDER BY currency $$,
  'Σ delta_minor zamkniętych miesięcy bez zmian po usunięciu konta');

SELECT is(
  (SELECT string_agg(p, ', ' ORDER BY p) FROM unnest(ARRAY[
     '19b40000-0000-4000-8000-00000000c001', 'usuwany@i9b-erasure', 'sub_i9b_a', 'cus_i9b_a',
     'evt_i9b_a', 'price_i9b_inline', '19b40000-0000-4000-8000-0000000005a1',
     '19b40000-0000-4000-8000-0000000005a2', '19b40000-0000-4000-8000-0000000000fb']) p
    WHERE pg_temp.ledger_text() LIKE '%' || p || '%'),
  NULL,
  'po usunięciu: żaden wiersz księgi i znaczników nie zawiera uid, e-maila, sub_/cus_/evt_, ceny osadzonej ani starego id subskrypcji');

SELECT is(
  (SELECT count(*)::int FROM a1_rows r
    WHERE (r.t = 'h' AND EXISTS (SELECT 1 FROM public.subscription_state_history h WHERE h.id::text = r.id))
       OR (r.t = 'm' AND EXISTS (SELECT 1 FROM public.mrr_movements m WHERE m.id::text = r.id))
       OR (r.t = 'd' AND EXISTS (SELECT 1 FROM public.dunning_cycles d WHERE d.id::text = r.id))),
  (SELECT count(*)::int FROM a1_rows),
  'akceptacja: zanonimizowane ruchy, historia i cykle windykacji ZOSTAJĄ');

SELECT is(
  (SELECT count(DISTINCT x.sub)::int FROM (
     SELECT h.subscription_id AS sub FROM public.subscription_state_history h JOIN a1_rows r ON r.t = 'h' AND r.id = h.id::text
     UNION ALL
     SELECT m.subscription_id FROM public.mrr_movements m JOIN a1_rows r ON r.t = 'm' AND r.id = m.id::text
     UNION ALL
     SELECT d.subscription_id FROM public.dunning_cycles d JOIN a1_rows r ON r.t = 'd' AND r.id = d.id::text) x),
  1,
  'nowy identyfikator subskrypcji wspólny dla historii, ruchów i cykli (kohorty i saldo per subskrypcja działają)');

SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.subscription_state_history
               WHERE tenant_id = '19b40000-0000-4000-8000-0000000000a1'
                 AND subscription_id <> '19b40000-0000-4000-8000-0000000005b1'
                 AND (dedupe_key NOT LIKE 'redacted:%' OR source_event_id IS NOT NULL OR user_id IS NOT NULL)),
  'historia: dedupe_key = redacted:<id>, bez zdarzenia operatora i bez user_id');

SELECT results_eq(
  $$ SELECT DISTINCT price_id_after FROM public.subscription_state_history h
      WHERE h.tenant_id = '19b40000-0000-4000-8000-0000000000a1'
        AND h.subscription_id <> '19b40000-0000-4000-8000-0000000005b1'
        AND h.status_after <> 'deleted'
      ORDER BY 1 NULLS LAST $$,
  $$ VALUES ('plus_monthly'::text), (NULL::text) $$,
  'cena katalogowa (opis planu) zostaje, cena osadzona darowizny -> NULL');

SELECT results_eq(
  $$ SELECT m.kind, m.reason, m.tier_key_after, m.segment, m.currency, m.delta_minor
       FROM public.mrr_movements m JOIN a1_rows r ON r.t = 'm' AND r.id = m.id::text
      ORDER BY m.id $$,
  $$ VALUES ('new'::text, 'signup'::text, 'member'::text, 'b2c_individual'::text, 'PLN'::text, 3900) $$,
  'zostają: rodzaj, powód z katalogu, tier_key, segment, waluta, kwota');

SELECT is(
  (SELECT string_agg(kind || '=' || ref, ', ' ORDER BY kind) FROM public.revenue_event_marks
    WHERE tenant_id = '19b40000-0000-4000-8000-0000000000a1'),
  'quota=19b40000-0000-4000-8000-00000000c002:2026-09',
  'znaczniki konta usunięte (quota, trial_ending, retention_abandoned), znacznik innej osoby zostaje');

SELECT ok(
  (SELECT bool_and(user_id = '19b40000-0000-4000-8000-00000000c002') FROM public.mrr_movements
    WHERE subscription_id = '19b40000-0000-4000-8000-0000000005b1')
  AND (SELECT count(*) FROM public.subscription_state_history
        WHERE subscription_id = '19b40000-0000-4000-8000-0000000005b1' AND source_event_id = 'evt_i9b_b1_1') = 1,
  'dane osoby zostającej nietknięte (uid, zdarzenie operatora)');

-- ── Domknięcie wstecz ───────────────────────────────────────────────────────
-- Subskrypcja usunięta „przed I9b": wyzwalacz redakcji wyłączony na czas
-- odtworzenia stanu (S2 zeruje tylko user_id).
INSERT INTO public.subscriptions (id, tenant_id, user_id, provider_subscription_id, provider_customer_id,
  product_id, price_id, status, environment, unit_amount_minor, currency, last_event_id)
VALUES ('19b40000-0000-4000-8000-0000000005b2', '19b40000-0000-4000-8000-0000000000a1',
        '19b40000-0000-4000-8000-00000000c002', 'sub_i9b_b2', 'cus_i9b_b1', 'plan_plus', 'plus_monthly',
        'active', 'live', 3900, 'PLN', 'evt_i9b_b2_1');
ALTER TABLE public.subscriptions DISABLE TRIGGER trg_subscriptions_revenue_redact;
DELETE FROM public.subscriptions WHERE id = '19b40000-0000-4000-8000-0000000005b2';
ALTER TABLE public.subscriptions ENABLE TRIGGER trg_subscriptions_revenue_redact;
SELECT ok(
  pg_temp.ledger_text() LIKE '%evt_i9b_b2_1%',
  'wstecz: ślad zdarzenia operatora subskrypcji usuniętej przed I9b w księdze');
SELECT ok(
  public._revenue_ledger_redact_orphans() > 0 AND pg_temp.ledger_text() NOT LIKE '%evt_i9b_b2%'
  AND pg_temp.ledger_text() NOT LIKE '%19b40000-0000-4000-8000-0000000005b2%',
  'wstecz: domknięcie redaguje osierocony ślad (zdarzenie i stary identyfikator)');
SELECT is(public._revenue_ledger_redact_orphans(), 0, 'wstecz: druga runda nic nie zmienia');

SELECT ok(
  NOT has_function_privilege('anon', 'public._revenue_ledger_redact_subscription(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._revenue_ledger_redact_subscription(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public._revenue_ledger_redact_subscription(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._revenue_ledger_redact_orphans()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.tg_subscriptions_revenue_redact()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.tg_auth_users_revenue_redact()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.tg_auth_users_revenue_redact()', 'EXECUTE'),
  'acl: redakcja i wyzwalacze bez EXECUTE dla ról API');

SELECT * FROM finish();
ROLLBACK;
