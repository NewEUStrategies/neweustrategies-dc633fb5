-- pgTAP: przepływ anulowania - zdarzenia, skaner porzuceń, skuteczność oferty
-- (S2, migracja 20261020110600; CHECK `reason_label` z I0, Z-09).
--
-- CO PRZYPINA:
--   * wiersz `started` z `reason_label IS NULL` przechodzi CHECK i emituje
--     `retention_flow.started.v1` (payload: identyfikatory);
--   * CHECK odrzuca `saved`/`canceled` bez powodu albo z pustym (23514);
--   * Z-09: „Anuluj mimo to" przed wyborem powodu = `canceled` z powodem
--     `not_given` - przechodzi CHECK bez jego zmiany, `reason_key = not_given`;
--   * `started` -> `saved` = `retention_flow.completed.v1` z `outcome`,
--     `offer_shown`, `offer_accepted`; payload bez komentarza i treści powodu;
--     wiersz bez `outcome` (kod sprzed S2) nie emituje;
--   * skaner: `started` starszy niż 24 h -> `abandoned` (bez powodu) +
--     zdarzenie + znacznik, młodszy zostaje; powtórka = 0;
--   * `admin_revenue_retention_offers`: liczności, save rate brutto
--     (uratowane / decyzje) i netto (bez tych, którzy odeszli później, w
--     mianowniku także porzucone), powody bez `not_given`, odpowiedzi sprzed
--     S2; editor 42501; dwóch najemców; granty.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test retention_flow
BEGIN;
SELECT plan(20);

-- ── Fixture ──────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO public.tenants (id, slug, name) VALUES
  ('d2060000-0000-0000-0000-0000000000a0', 'hub-s2-ret-a', 'Hub S2 retencja A'),
  ('d2060000-0000-0000-0000-0000000000b0', 'hub-s2-ret-b', 'Hub S2 retencja B');
INSERT INTO auth.users (id, email) VALUES
  ('d2060000-0000-0000-0000-00000000a001', 'admin-a@hub-s2-ret.test'),
  ('d2060000-0000-0000-0000-00000000a002', 'editor-a@hub-s2-ret.test'),
  ('d2060000-0000-0000-0000-00000000b001', 'admin-b@hub-s2-ret.test'),
  ('d2060000-0000-0000-0000-00000000b101', 'ub@hub-s2-ret.test');
INSERT INTO auth.users (id, email)
SELECT ('d2060000-0000-0000-0000-00000000a10' || n)::uuid, 'u' || n || '@hub-s2-ret.test' FROM generate_series(1, 6) n;
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('d2060000-0000-0000-0000-00000000a001', 'admin-a@hub-s2-ret.test', 'Admin A', 'd2060000-0000-0000-0000-0000000000a0'),
  ('d2060000-0000-0000-0000-00000000a002', 'editor-a@hub-s2-ret.test', 'Editor A', 'd2060000-0000-0000-0000-0000000000a0'),
  ('d2060000-0000-0000-0000-00000000b001', 'admin-b@hub-s2-ret.test', 'Admin B', 'd2060000-0000-0000-0000-0000000000b0'),
  ('d2060000-0000-0000-0000-00000000b101', 'ub@hub-s2-ret.test', 'UB', 'd2060000-0000-0000-0000-0000000000b0');
INSERT INTO public.profiles (id, email, display_name, tenant_id)
SELECT ('d2060000-0000-0000-0000-00000000a10' || n)::uuid, 'u' || n || '@hub-s2-ret.test', 'U' || n,
       'd2060000-0000-0000-0000-0000000000a0'
  FROM generate_series(1, 6) n;
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('d2060000-0000-0000-0000-00000000a001', 'admin', 'd2060000-0000-0000-0000-0000000000a0'),
  ('d2060000-0000-0000-0000-00000000a002', 'editor', 'd2060000-0000-0000-0000-0000000000a0'),
  ('d2060000-0000-0000-0000-00000000b001', 'admin', 'd2060000-0000-0000-0000-0000000000b0');
INSERT INTO public.retention_reasons (id, tenant_id, label_pl, label_en) VALUES
  ('d2060000-0000-0000-0000-0000000009a1', 'd2060000-0000-0000-0000-0000000000a0', 'Za mało czasu', 'Not enough time');

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;
CREATE TEMP TABLE res (name text PRIMARY KEY, r jsonb) ON COMMIT DROP;
GRANT SELECT, INSERT ON res TO authenticated;

-- ── 1. Granty ────────────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.tg_retention_feedback_emit()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.tg_retention_feedback_emit()', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.run_retention_flow_scanner()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.run_retention_flow_scanner()', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_revenue_retention_offers(timestamptz, timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_revenue_retention_offers(timestamptz, timestamptz)', 'EXECUTE'),
  'acl: wyzwalacz bez EXECUTE, skaner tylko service_role, RPC dla authenticated (nie anon)');

-- ── 2. started bez powodu, CHECK przy decyzji ──────────────────────────────
SELECT lives_ok(
  $$ INSERT INTO public.retention_feedback (id, tenant_id, user_id, subscription_id, reason_label, outcome, flow_started_at)
     VALUES ('d2060000-0000-0000-0000-0000000007a1', 'd2060000-0000-0000-0000-0000000000a0',
             'd2060000-0000-0000-0000-00000000a101', 'd2060000-0000-0000-0000-0000000005a1', NULL, 'started', now()) $$,
  'started: wiersz bez powodu przechodzi CHECK I0');
SELECT is(
  (SELECT string_agg(k, ',' ORDER BY k) FROM public.domain_events e, jsonb_object_keys(e.payload) k
    WHERE e.event_type = 'retention_flow.started.v1' AND e.aggregate_id = 'd2060000-0000-0000-0000-0000000007a1'),
  'feedback_id,subscription_id,user_id',
  'started: retention_flow.started.v1 z samymi identyfikatorami');
SELECT throws_ok(
  $$ UPDATE public.retention_feedback SET outcome = 'saved' WHERE id = 'd2060000-0000-0000-0000-0000000007a1' $$,
  '23514', NULL, 'CHECK: saved bez powodu -> 23514');
SELECT throws_ok(
  $$ UPDATE public.retention_feedback SET outcome = 'canceled', reason_label = '  '
      WHERE id = 'd2060000-0000-0000-0000-0000000007a1' $$,
  '23514', NULL, 'CHECK: canceled z pustym powodem -> 23514');

-- f2: przepływ porzucony 30 h temu; f3: started -> saved (oferta przyjęta).
INSERT INTO public.retention_feedback (id, tenant_id, user_id, subscription_id, reason_label, outcome, flow_started_at, created_at)
VALUES ('d2060000-0000-0000-0000-0000000007a2', 'd2060000-0000-0000-0000-0000000000a0', 'd2060000-0000-0000-0000-00000000a102',
        'd2060000-0000-0000-0000-0000000005a2', NULL, 'started', now() - interval '30 hours', now() - interval '30 hours'),
       ('d2060000-0000-0000-0000-0000000007a3', 'd2060000-0000-0000-0000-0000000000a0', 'd2060000-0000-0000-0000-00000000a103',
        'd2060000-0000-0000-0000-0000000005a3', NULL, 'started', now() - interval '2 days', now() - interval '2 days');
UPDATE public.retention_feedback
   SET outcome = 'saved', reason_id = 'd2060000-0000-0000-0000-0000000009a1', reason_label = 'Za mało czasu',
       comment = 'Prywatny komentarz z numerem 600 000 000', offer_shown = true, offer_accepted = true
 WHERE id = 'd2060000-0000-0000-0000-0000000007a3';
SELECT results_eq(
  $$ SELECT payload->>'outcome', payload->>'reason_key', (payload->>'offer_shown')::boolean, (payload->>'offer_accepted')::boolean
       FROM public.domain_events WHERE event_type = 'retention_flow.completed.v1'
        AND aggregate_id = 'd2060000-0000-0000-0000-0000000007a3' $$,
  $$ VALUES ('saved'::text, 'd2060000-0000-0000-0000-0000000009a1'::text, true, true) $$,
  'started -> saved: retention_flow.completed.v1 z wynikiem, kluczem powodu i ofertą');
SELECT is_empty(
  $$ SELECT k FROM public.domain_events e, jsonb_object_keys(e.payload) k
      WHERE e.event_type LIKE 'retention_flow.%' AND e.tenant_id = 'd2060000-0000-0000-0000-0000000000a0'
        AND k IN ('comment', 'reason_label', 'email', 'name', 'body', 'token', 'phone', 'note') $$,
  'payload: bez komentarza, treści powodu i PII');

-- f4: uratowany, ale odszedł później; f5: Z-09 „Anuluj mimo to"; f6: anulowany
-- z powodem po pokazanej ofercie; f7: odpowiedź sprzed S2 (bez outcome).
SELECT lives_ok(
  $$ INSERT INTO public.retention_feedback (id, tenant_id, user_id, subscription_id, reason_id, reason_label, outcome,
       offer_shown, offer_accepted, flow_started_at, created_at) VALUES
     ('d2060000-0000-0000-0000-0000000007a4', 'd2060000-0000-0000-0000-0000000000a0', 'd2060000-0000-0000-0000-00000000a104',
      'd2060000-0000-0000-0000-0000000005a4', NULL, 'Za drogo', 'saved', true, true, now() - interval '3 days', now() - interval '3 days'),
     ('d2060000-0000-0000-0000-0000000007a5', 'd2060000-0000-0000-0000-0000000000a0', 'd2060000-0000-0000-0000-00000000a105',
      'd2060000-0000-0000-0000-0000000005a5', NULL, 'not_given', 'canceled', false, false, now() - interval '1 day', now() - interval '1 day'),
     ('d2060000-0000-0000-0000-0000000007a6', 'd2060000-0000-0000-0000-0000000000a0', 'd2060000-0000-0000-0000-00000000a106',
      'd2060000-0000-0000-0000-0000000005a6', 'd2060000-0000-0000-0000-0000000009a1', 'Za mało czasu', 'canceled', true, false,
      now() - interval '1 day', now() - interval '1 day') $$,
  'Z-09: canceled z powodem „not_given" przechodzi CHECK I0 bez jego zmiany');
SELECT is(
  (SELECT payload->>'reason_key' FROM public.domain_events WHERE event_type = 'retention_flow.completed.v1'
    AND aggregate_id = 'd2060000-0000-0000-0000-0000000007a5'),
  'not_given',
  'Z-09: reason_key = not_given (osobno od powodów z katalogu)');
INSERT INTO public.retention_feedback (id, tenant_id, user_id, subscription_id, reason_label, created_at)
VALUES ('d2060000-0000-0000-0000-0000000007a7', 'd2060000-0000-0000-0000-0000000000a0', 'd2060000-0000-0000-0000-00000000a101',
        'd2060000-0000-0000-0000-0000000005a1', 'Stara ankieta', now() - interval '3 days');
SELECT is(
  (SELECT count(*)::integer FROM public.domain_events WHERE aggregate_id = 'd2060000-0000-0000-0000-0000000007a7'),
  0,
  'wiersz bez outcome (kod sprzed S2) nie emituje');
INSERT INTO public.retention_feedback (tenant_id, user_id, reason_label, outcome, flow_started_at)
VALUES ('d2060000-0000-0000-0000-0000000000b0', 'd2060000-0000-0000-0000-00000000b101', 'Inny', 'saved', now() - interval '1 day');
-- f4 odszedł później (ruch churn po przepływie).
INSERT INTO public.mrr_movements (tenant_id, subscription_id, user_id, environment, occurred_at, kind, reason,
  mrr_before_minor, mrr_after_minor, currency, segment)
VALUES ('d2060000-0000-0000-0000-0000000000a0', 'd2060000-0000-0000-0000-0000000005a4', 'd2060000-0000-0000-0000-00000000a104',
        'live', now() - interval '1 day', 'churn', 'canceled', 3900, 0, 'PLN', 'b2c_individual');

-- ── 3. Skaner porzuceń ───────────────────────────────────────────────────────
SELECT is(public.run_retention_flow_scanner(), '{"abandoned": 1}'::jsonb,
  'skaner: jeden przepływ started > 24 h domknięty');
SELECT results_eq(
  $$ SELECT id::text, outcome, reason_label IS NULL FROM public.retention_feedback
      WHERE id IN ('d2060000-0000-0000-0000-0000000007a1', 'd2060000-0000-0000-0000-0000000007a2') ORDER BY id $$,
  $$ VALUES ('d2060000-0000-0000-0000-0000000007a1'::text, 'started'::text, true),
            ('d2060000-0000-0000-0000-0000000007a2'::text, 'abandoned'::text, true) $$,
  'skaner: porzucony bez powodu (CHECK I0 dopuszcza), świeży zostaje started');
SELECT ok(
  EXISTS (SELECT 1 FROM public.domain_events WHERE event_type = 'retention_flow.completed.v1'
           AND aggregate_id = 'd2060000-0000-0000-0000-0000000007a2' AND payload->>'outcome' = 'abandoned'
           AND payload->'reason_key' = 'null'::jsonb)
  AND EXISTS (SELECT 1 FROM public.revenue_event_marks WHERE kind = 'retention_abandoned'
               AND ref = 'd2060000-0000-0000-0000-0000000007a2'),
  'skaner: zdarzenie completed (abandoned) i znacznik');
SELECT is(public.run_retention_flow_scanner(), '{"abandoned": 0}'::jsonb, 'skaner: powtórka nic nie zmienia');

-- ── 4. Skuteczność przepływu ────────────────────────────────────────────────
SELECT pg_temp.as_user('d2060000-0000-0000-0000-00000000a002');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.admin_revenue_retention_offers(now() - interval '7 days', now() + interval '1 day') $$,
  '42501', 'forbidden', 'rola: editor nie czyta skuteczności oferty (42501)');
SELECT pg_temp.as_user('d2060000-0000-0000-0000-00000000a001');
INSERT INTO res SELECT 'a', public.admin_revenue_retention_offers(now() - interval '7 days', now() + interval '1 day');
SELECT pg_temp.as_user('d2060000-0000-0000-0000-00000000b001');
INSERT INTO res SELECT 'b', public.admin_revenue_retention_offers(now() - interval '7 days', now() + interval '1 day');
RESET ROLE;

SELECT set_eq($$ SELECT jsonb_object_keys(r) FROM res WHERE name = 'a' $$,
  ARRAY['since', 'until', 'flows_started', 'saved', 'canceled', 'abandoned', 'open', 'offers_shown', 'offers_accepted',
        'save_rate_gross', 'save_rate_net', 'reason_not_given', 'legacy_responses', 'reasons'],
  'kształt: RETENTION_OFFERS_KEYS.root');
SELECT results_eq(
  $$ SELECT (r->>'flows_started')::int, (r->>'saved')::int, (r->>'canceled')::int, (r->>'abandoned')::int,
            (r->>'open')::int, (r->>'offers_shown')::int, (r->>'offers_accepted')::int,
            (r->>'reason_not_given')::int, (r->>'legacy_responses')::int
       FROM res WHERE name = 'a' $$,
  $$ VALUES (6, 2, 2, 1, 1, 3, 2, 1, 1) $$,
  'skuteczność: liczności przepływów i ofert');
SELECT results_eq(
  $$ SELECT (r->>'save_rate_gross')::numeric, (r->>'save_rate_net')::numeric FROM res WHERE name = 'a' $$,
  $$ VALUES (0.5::numeric, 0.2::numeric) $$,
  'skuteczność: brutto 2/4 decyzji, netto 1/5 (bez odejść po przepływie, z porzuconymi)');
SELECT set_eq(
  $$ SELECT (x->>'reason_label') || ':' || (x->>'responses') FROM res, jsonb_array_elements(r -> 'reasons') x WHERE name = 'a' $$,
  ARRAY['Za mało czasu:2', 'Za drogo:1', 'Stara ankieta:1'],
  'skuteczność: powody bez „not_given", z odpowiedziami sprzed S2');
SELECT ok((SELECT (r->>'flows_started')::int = 1 AND (r->>'saved')::int = 1 FROM res WHERE name = 'b'),
  'najemcy: admin B widzi wyłącznie swoje przepływy');

SELECT * FROM finish();
ROLLBACK;
