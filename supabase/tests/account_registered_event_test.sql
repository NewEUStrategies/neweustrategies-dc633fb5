-- pgTAP: zdarzenie rejestracji konta (S3, migracja 20261020120000).
--
-- CO PRZYPINA:
--   * INSERT do `profiles` tworzy REALNY wiersz `domain_events`
--     `account.registered.v1` w najemcy PROFILU (dwóch najemców), agregat
--     `account`, `aggregate_id` = id konta, bez aktora (rejestracja nie ma
--     sesji; konto niesie `aggregate_id` i `payload.user_id`);
--   * `signup_source` z białej listy przechodzi, spoza listy i brak = `unknown`;
--   * `marketing_opt_in` wyłącznie jawne `true` (napis „tak" = false);
--   * `has_attribution` z obecności klucza UTM;
--   * payload BEZ PII: dokładnie 4 klucze, bez e-maila i nazwiska;
--   * awaria szyny (emitter podmieniony w transakcji na rzucający) nie
--     przerywa rejestracji i zostawia ślad w `domain_event_emit_errors`;
--   * wyzwalacz bez EXECUTE dla ról API.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test account_registered
BEGIN;
SELECT plan(12);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('c3000000-0000-0000-0000-0000000000a0', 'hub-s3-acc-a', 'Hub S3 konto A'),
  ('c3000000-0000-0000-0000-0000000000b0', 'hub-s3-acc-b', 'Hub S3 konto B');

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('c3000000-0000-0000-0000-00000000a001', 'popup@hub-s3-acc.test',
   '{"signup_source":"popup","marketing_opt_in":true,"utm_source":"newsletter","first_name":"Jan"}'),
  ('c3000000-0000-0000-0000-00000000a002', 'weird@hub-s3-acc.test',
   '{"signup_source":"<script>alert(1)</script>","marketing_opt_in":"tak"}'),
  ('c3000000-0000-0000-0000-00000000b001', 'paywall@hub-s3-acc.test',
   '{"signup_source":"paywall","marketing_opt_in":false}'),
  ('c3000000-0000-0000-0000-00000000b002', 'bare@hub-s3-acc.test', NULL);

DELETE FROM public.domain_events
 WHERE tenant_id IN ('c3000000-0000-0000-0000-0000000000a0', 'c3000000-0000-0000-0000-0000000000b0');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('c3000000-0000-0000-0000-00000000a001', 'popup@hub-s3-acc.test', 'Jan Popup', 'c3000000-0000-0000-0000-0000000000a0'),
  ('c3000000-0000-0000-0000-00000000a002', 'weird@hub-s3-acc.test', 'Weird', 'c3000000-0000-0000-0000-0000000000a0'),
  ('c3000000-0000-0000-0000-00000000b001', 'paywall@hub-s3-acc.test', 'Paywall', 'c3000000-0000-0000-0000-0000000000b0'),
  ('c3000000-0000-0000-0000-00000000b002', 'bare@hub-s3-acc.test', 'Bare', 'c3000000-0000-0000-0000-0000000000b0');

-- 1-2. Realny wiersz z białą listą, zgodą i atrybucją.
SELECT results_eq(
  $$ SELECT tenant_id, aggregate_type, aggregate_id, actor_id, payload
       FROM public.domain_events
      WHERE event_type = 'account.registered.v1'
        AND aggregate_id = 'c3000000-0000-0000-0000-00000000a001' $$,
  $$ VALUES ('c3000000-0000-0000-0000-0000000000a0'::uuid, 'account',
             'c3000000-0000-0000-0000-00000000a001',
             NULL::uuid,
             '{"user_id":"c3000000-0000-0000-0000-00000000a001","signup_source":"popup","marketing_opt_in":true,"has_attribution":true}'::jsonb) $$,
  'popup: realne zdarzenie w najemcy profilu, bez aktora, payload z białej listy');

SELECT results_eq(
  $$ SELECT payload ->> 'signup_source', (payload ->> 'marketing_opt_in')::boolean,
            (payload ->> 'has_attribution')::boolean
       FROM public.domain_events
      WHERE event_type = 'account.registered.v1'
        AND aggregate_id = 'c3000000-0000-0000-0000-00000000a002' $$,
  $$ VALUES ('unknown', false, false) $$,
  'źródło spoza listy -> unknown; zgoda „tak" (nie true) -> false');

-- 3. Drugi najemca: zdarzenie trafia do SWOJEGO najemcy.
SELECT results_eq(
  $$ SELECT tenant_id, payload ->> 'signup_source'
       FROM public.domain_events
      WHERE event_type = 'account.registered.v1'
        AND aggregate_id = 'c3000000-0000-0000-0000-00000000b001' $$,
  $$ VALUES ('c3000000-0000-0000-0000-0000000000b0'::uuid, 'paywall') $$,
  'najemca B: zdarzenie w najemcy B, źródło paywall');

-- 4. Brak metadanych -> unknown, bez zgody i atrybucji.
SELECT results_eq(
  $$ SELECT payload FROM public.domain_events
      WHERE event_type = 'account.registered.v1'
        AND aggregate_id = 'c3000000-0000-0000-0000-00000000b002' $$,
  $$ VALUES ('{"user_id":"c3000000-0000-0000-0000-00000000b002","signup_source":"unknown","marketing_opt_in":false,"has_attribution":false}'::jsonb) $$,
  'konto bez metadanych: unknown, bez zgody, bez atrybucji');

-- 5. Jedno zdarzenie na konto.
SELECT is(
  (SELECT count(*)::int FROM public.domain_events
    WHERE event_type = 'account.registered.v1'
      AND tenant_id IN ('c3000000-0000-0000-0000-0000000000a0', 'c3000000-0000-0000-0000-0000000000b0')),
  4, 'cztery konta = cztery zdarzenia (jedno na INSERT)');

-- 6-7. Brak PII: dokładnie cztery klucze, bez e-maila ani imienia.
SELECT set_eq(
  $$ SELECT DISTINCT jsonb_object_keys(payload) FROM public.domain_events
      WHERE event_type = 'account.registered.v1'
        AND tenant_id IN ('c3000000-0000-0000-0000-0000000000a0', 'c3000000-0000-0000-0000-0000000000b0') $$,
  ARRAY['user_id', 'signup_source', 'marketing_opt_in', 'has_attribution'],
  'payload: wyłącznie user_id, signup_source, marketing_opt_in, has_attribution');
SELECT is_empty(
  $$ SELECT 1 FROM public.domain_events
      WHERE event_type = 'account.registered.v1'
        AND tenant_id IN ('c3000000-0000-0000-0000-0000000000a0', 'c3000000-0000-0000-0000-0000000000b0')
        AND (payload::text ILIKE '%@hub-s3-acc.test%' OR payload::text ILIKE '%Jan%'
             OR payload::text ILIKE '%script%') $$,
  'payload nie niesie e-maila, imienia ani surowej wartości z formularza');

-- 8. UPDATE profilu nie emituje rejestracji.
UPDATE public.profiles SET display_name = 'Jan Zmieniony'
 WHERE id = 'c3000000-0000-0000-0000-00000000a001';
SELECT is(
  (SELECT count(*)::int FROM public.domain_events
    WHERE event_type = 'account.registered.v1'
      AND aggregate_id = 'c3000000-0000-0000-0000-00000000a001'),
  1, 'UPDATE profilu nie emituje drugiego account.registered.v1');

-- 9-10. Awaria szyny: rejestracja przechodzi, ślad zostaje.
CREATE OR REPLACE FUNCTION public.emit_domain_event(
  p_tenant_id uuid, p_aggregate_type text, p_aggregate_id text, p_event_type text,
  p_payload jsonb DEFAULT '{}'::jsonb, p_actor_id uuid DEFAULT NULL, p_suppress_actor boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'bus down' USING ERRCODE = 'P0001';
END;
$$;

INSERT INTO auth.users (id, email) VALUES ('c3000000-0000-0000-0000-00000000a003', 'down@hub-s3-acc.test');
SELECT lives_ok(
  $$ INSERT INTO public.profiles (id, email, display_name, tenant_id)
     VALUES ('c3000000-0000-0000-0000-00000000a003', 'down@hub-s3-acc.test', 'Down',
             'c3000000-0000-0000-0000-0000000000a0') $$,
  'awaria emit_domain_event nie przerywa INSERT profilu');
SELECT results_eq(
  $$ SELECT source, event_type, sqlstate FROM public.domain_event_emit_errors
      WHERE tenant_id = 'c3000000-0000-0000-0000-0000000000a0'
        AND source = 'tg_profiles_account_registered_emit' $$,
  $$ VALUES ('tg_profiles_account_registered_emit', 'account.registered.v1', 'P0001') $$,
  'awaria zostawia wiersz w domain_event_emit_errors (Z-02)');

-- 11-12. Atrybuty i ACL wyzwalacza.
SELECT ok(
  (SELECT p.prosecdef AND 'search_path=public, pg_temp' = ANY (p.proconfig)
     FROM pg_proc p WHERE p.oid = 'public.tg_profiles_account_registered_emit()'::regprocedure),
  'wyzwalacz: SECURITY DEFINER z search_path public, pg_temp');
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.tg_profiles_account_registered_emit()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.tg_profiles_account_registered_emit()', 'EXECUTE'),
  'wyzwalacz bez EXECUTE dla anon i authenticated');

SELECT * FROM finish();
ROLLBACK;
