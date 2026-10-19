-- pgTAP: emitery zmian ustawień (S1, migracja 20261020100000).
--
-- CO PRZYPINA:
--   * każdy z 5 emiterów (`metering_settings`, `checkout_settings`,
--     `retention_settings`, `content_access`, `retention_reasons`) tworzy
--     REALNY wiersz `domain_events` - typ, agregat, `aggregate_id`, payload
--     i aktor (`auth.uid()` sesji zapisującej);
--   * `keys` niesie NAZWY kolumn (posortowane), nigdy wartości; przy INSERT
--     wszystkie ustawione, przy UPDATE tylko zmienione;
--   * UPDATE bez zmiany wartości (zapis pełnym wierszem z panelu) nie emituje;
--   * `content_access`: zmiana samego skrótu hasła emituje (zmienia dostęp),
--     ale payload nie niesie hasła ani podpowiedzi; DELETE emituje `op=delete`;
--   * zdarzenie trafia do najemcy WIERSZA (dwóch najemców);
--   * awaria szyny: `emit_domain_event` podmieniona W TRANSAKCJI na wersję
--     rzucającą (produkcyjna połyka błędy sama - V10) -> zapis źródłowy
--     przechodzi, a w `domain_event_emit_errors` zostaje wiersz ze `source`
--     = nazwa emitera i typem zdarzenia (kontrakt Z-02);
--   * atrybuty i ACL wyzwalaczy (SECURITY DEFINER, search_path z pg_temp,
--     brak EXECUTE dla ról API).
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test hub_settings_events
BEGIN;
SELECT plan(32);

-- ── Fixture: dwóch najemców, admin A (aktor), admin B ───────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('c1000000-0000-0000-0000-0000000000a0', 'hub-s1-ev-a', 'Hub S1 zdarzenia A'),
  ('c1000000-0000-0000-0000-0000000000b0', 'hub-s1-ev-b', 'Hub S1 zdarzenia B');

INSERT INTO auth.users (id, email) VALUES
  ('c1000000-0000-0000-0000-00000000a001', 'admin-a@hub-s1-ev.test'),
  ('c1000000-0000-0000-0000-00000000b001', 'admin-b@hub-s1-ev.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('c1000000-0000-0000-0000-00000000a001', 'admin-a@hub-s1-ev.test', 'Admin A', 'c1000000-0000-0000-0000-0000000000a0'),
  ('c1000000-0000-0000-0000-00000000b001', 'admin-b@hub-s1-ev.test', 'Admin B', 'c1000000-0000-0000-0000-0000000000b0');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('c1000000-0000-0000-0000-00000000a001', 'admin', 'c1000000-0000-0000-0000-0000000000a0'),
  ('c1000000-0000-0000-0000-00000000b001', 'admin', 'c1000000-0000-0000-0000-0000000000b0');

-- Wiersze ustawień mogły powstać przy zakładaniu najemcy (seedy) - test
-- zaczyna od czystej karty, żeby INSERT był naprawdę pierwszym zapisem.
DELETE FROM public.metering_settings WHERE tenant_id IN ('c1000000-0000-0000-0000-0000000000a0', 'c1000000-0000-0000-0000-0000000000b0');
DELETE FROM public.checkout_settings WHERE tenant_id IN ('c1000000-0000-0000-0000-0000000000a0', 'c1000000-0000-0000-0000-0000000000b0');
DELETE FROM public.retention_settings WHERE tenant_id IN ('c1000000-0000-0000-0000-0000000000a0', 'c1000000-0000-0000-0000-0000000000b0');
DELETE FROM public.retention_reasons WHERE tenant_id IN ('c1000000-0000-0000-0000-0000000000a0', 'c1000000-0000-0000-0000-0000000000b0');
DELETE FROM public.domain_events WHERE tenant_id IN ('c1000000-0000-0000-0000-0000000000a0', 'c1000000-0000-0000-0000-0000000000b0');

-- Aktor: admin A (emitery biorą domyślnego aktora z `auth.uid()`).
SELECT set_config('request.jwt.claims',
  '{"sub":"c1000000-0000-0000-0000-00000000a001","role":"authenticated"}', true);

-- Wszystko dzieje się w JEDNEJ transakcji, więc `created_at` zdarzeń jest
-- równe (now()) - kolejność po czasie nic nie mówi. Zamiast „ostatniego"
-- zdarzenia test ZUŻYWA nowe: `ev_take` zwraca zdarzenia typu jeszcze nie
-- widziane i oznacza je jako widziane, więc `results_eq` na nim przypina
-- jednocześnie treść i liczbę (dokładnie jedno nowe zdarzenie).
CREATE TEMP TABLE ev_seen (id uuid PRIMARY KEY) ON COMMIT DROP;
CREATE FUNCTION pg_temp.ev_take(p_type text) RETURNS SETOF public.domain_events LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH fresh AS (
    SELECT e.* FROM public.domain_events e
     WHERE e.event_type = p_type
       AND e.tenant_id IN ('c1000000-0000-0000-0000-0000000000a0', 'c1000000-0000-0000-0000-0000000000b0')
       AND NOT EXISTS (SELECT 1 FROM ev_seen s WHERE s.id = e.id)
  ), mark AS (
    INSERT INTO ev_seen (id) SELECT f.id FROM fresh f
  )
  SELECT * FROM fresh;
END;
$$;

-- ── 1. metering_settings ─────────────────────────────────────────────────────
INSERT INTO public.metering_settings (tenant_id, member_monthly_limit)
VALUES ('c1000000-0000-0000-0000-0000000000a0', 17);

SELECT results_eq(
  $$ SELECT tenant_id, aggregate_type, aggregate_id, payload, actor_id
       FROM pg_temp.ev_take('metering_settings.changed.v1') $$,
  $$ VALUES ('c1000000-0000-0000-0000-0000000000a0'::uuid, 'metering_settings',
             'c1000000-0000-0000-0000-0000000000a0',
             '{"op":"insert","keys":["anon_monthly_limit","enabled","member_monthly_limit","meter_members","meter_paid","show_counter"]}'::jsonb,
             'c1000000-0000-0000-0000-00000000a001'::uuid) $$,
  'metering: INSERT -> jedno realne zdarzenie z nazwami ustawionych kolumn i aktorem z sesji');

UPDATE public.metering_settings SET member_monthly_limit = 9, updated_by = 'c1000000-0000-0000-0000-00000000a001'
 WHERE tenant_id = 'c1000000-0000-0000-0000-0000000000a0';
SELECT results_eq(
  $$ SELECT payload FROM pg_temp.ev_take('metering_settings.changed.v1') $$,
  $$ VALUES ('{"op":"update","keys":["member_monthly_limit"]}'::jsonb) $$,
  'metering: UPDATE -> keys = tylko zmieniona kolumna (bez updated_by i updated_at)');
SELECT is_empty(
  $$ SELECT 1 FROM public.domain_events
      WHERE event_type = 'metering_settings.changed.v1'
        AND tenant_id = 'c1000000-0000-0000-0000-0000000000a0'
        AND (position('17' IN payload::text) > 0 OR position('9' IN payload->>'keys') > 0) $$,
  'metering: payload niesie NAZWY kolumn, nigdy wartości (ani 17, ani 9)');

UPDATE public.metering_settings SET enabled = enabled, member_monthly_limit = member_monthly_limit
 WHERE tenant_id = 'c1000000-0000-0000-0000-0000000000a0';
SELECT is_empty(
  $$ SELECT 1 FROM pg_temp.ev_take('metering_settings.changed.v1') $$,
  'metering: zapis pełnym wierszem bez zmiany wartości NIE emituje');

-- ── 2. checkout_settings ─────────────────────────────────────────────────────
INSERT INTO public.checkout_settings (tenant_id) VALUES ('c1000000-0000-0000-0000-0000000000a0');
SELECT results_eq(
  $$ SELECT aggregate_type, aggregate_id, payload->>'op', payload->'keys' ? 'abandon_after_minutes'
       FROM pg_temp.ev_take('checkout_settings.changed.v1') $$,
  $$ VALUES ('checkout_settings', 'c1000000-0000-0000-0000-0000000000a0', 'insert', true) $$,
  'checkout: INSERT -> zdarzenie agregatu najemcy z kluczami kolumn');

UPDATE public.checkout_settings SET allow_promotion_codes = true, abandon_after_minutes = 60
 WHERE tenant_id = 'c1000000-0000-0000-0000-0000000000a0';
SELECT results_eq(
  $$ SELECT payload FROM pg_temp.ev_take('checkout_settings.changed.v1') $$,
  $$ VALUES ('{"op":"update","keys":["abandon_after_minutes","allow_promotion_codes"]}'::jsonb) $$,
  'checkout: UPDATE -> posortowane nazwy dwóch zmienionych kolumn');

UPDATE public.checkout_settings SET allow_promotion_codes = true
 WHERE tenant_id = 'c1000000-0000-0000-0000-0000000000a0';
SELECT is_empty(
  $$ SELECT 1 FROM pg_temp.ev_take('checkout_settings.changed.v1') $$,
  'checkout: UPDATE na tę samą wartość nie emituje');

-- ── 3. retention_settings ────────────────────────────────────────────────────
INSERT INTO public.retention_settings (tenant_id, discount_pct)
VALUES ('c1000000-0000-0000-0000-0000000000a0', 25);
SELECT results_eq(
  $$ SELECT aggregate_type, payload->>'op' FROM pg_temp.ev_take('retention_settings.changed.v1') $$,
  $$ VALUES ('retention_settings', 'insert') $$,
  'retencja: INSERT -> jedno zdarzenie');
UPDATE public.retention_settings SET discount_pct = 35
 WHERE tenant_id = 'c1000000-0000-0000-0000-0000000000a0';
SELECT results_eq(
  $$ SELECT aggregate_type, aggregate_id, payload, actor_id
       FROM pg_temp.ev_take('retention_settings.changed.v1') $$,
  $$ VALUES ('retention_settings', 'c1000000-0000-0000-0000-0000000000a0',
             '{"op":"update","keys":["discount_pct"]}'::jsonb,
             'c1000000-0000-0000-0000-00000000a001'::uuid) $$,
  'retencja: UPDATE -> zdarzenie z nazwą zmienionej kolumny i aktorem');

-- ── 4. content_access ────────────────────────────────────────────────────────
INSERT INTO public.content_access (id, tenant_id, entity_type, entity_id, mode, metering_policy, password_hash, password_hint_pl)
VALUES ('c1000000-0000-0000-0000-0000000001a0', 'c1000000-0000-0000-0000-0000000000a0', 'post',
        'c1000000-0000-0000-0000-0000000009a0', 'password', 'exempt', 'skrot-hasla-alfa', 'podpowiedz-alfa');
SELECT results_eq(
  $$ SELECT aggregate_type, aggregate_id, payload, actor_id
       FROM pg_temp.ev_take('content_access.changed.v1') $$,
  $$ VALUES ('content_access', 'c1000000-0000-0000-0000-0000000001a0',
             '{"entity_type":"post","entity_id":"c1000000-0000-0000-0000-0000000009a0","mode":"password","metering_policy":"exempt","op":"insert"}'::jsonb,
             'c1000000-0000-0000-0000-00000000a001'::uuid) $$,
  'dostęp: INSERT -> agregat = id reguły, payload {entity_type, entity_id, mode, metering_policy, op}');

UPDATE public.content_access SET password_hash = 'skrot-hasla-beta'
 WHERE id = 'c1000000-0000-0000-0000-0000000001a0';
SELECT results_eq(
  $$ SELECT payload->>'op' FROM pg_temp.ev_take('content_access.changed.v1') $$,
  $$ VALUES ('update') $$,
  'dostęp: zmiana samego hasła emituje (zmienia, kto widzi treść)');
SELECT is_empty(
  $$ SELECT 1 FROM public.domain_events
      WHERE event_type = 'content_access.changed.v1'
        AND (position('skrot-hasla' IN payload::text) > 0 OR position('podpowiedz' IN payload::text) > 0
             OR payload ? 'password_hash' OR payload ? 'password_hint_pl') $$,
  'dostęp: payload bez skrótu hasła i podpowiedzi');

UPDATE public.content_access SET mode = mode, metering_policy = metering_policy
 WHERE id = 'c1000000-0000-0000-0000-0000000001a0';
SELECT is_empty(
  $$ SELECT 1 FROM pg_temp.ev_take('content_access.changed.v1') $$,
  'dostęp: UPDATE bez zmiany (tylko nowy updated_at) nie emituje');

INSERT INTO public.content_access (id, tenant_id, entity_type, entity_id, mode)
VALUES ('c1000000-0000-0000-0000-0000000001b0', 'c1000000-0000-0000-0000-0000000000b0', 'page',
        'c1000000-0000-0000-0000-0000000009b0', 'members');
SELECT results_eq(
  $$ SELECT tenant_id FROM pg_temp.ev_take('content_access.changed.v1') $$,
  $$ VALUES ('c1000000-0000-0000-0000-0000000000b0'::uuid) $$,
  'dostęp: zdarzenie ląduje w najemcy WIERSZA (B), nie aktora');

DELETE FROM public.content_access WHERE id = 'c1000000-0000-0000-0000-0000000001b0';
SELECT results_eq(
  $$ SELECT aggregate_id, payload->>'op', payload->>'mode'
       FROM pg_temp.ev_take('content_access.changed.v1') $$,
  $$ VALUES ('c1000000-0000-0000-0000-0000000001b0', 'delete', 'members') $$,
  'dostęp: DELETE -> zdarzenie ze stanem usuniętej reguły i op=delete');

-- ── 5. retention_reasons ─────────────────────────────────────────────────────
INSERT INTO public.retention_reasons (id, tenant_id, label_pl, label_en)
VALUES ('c1000000-0000-0000-0000-0000000002a0', 'c1000000-0000-0000-0000-0000000000a0', 'Za drogo', 'Too expensive');
SELECT results_eq(
  $$ SELECT aggregate_type, aggregate_id, payload, actor_id
       FROM pg_temp.ev_take('retention_reason.changed.v1') $$,
  $$ VALUES ('retention_reason', 'c1000000-0000-0000-0000-0000000002a0',
             '{"reason_id":"c1000000-0000-0000-0000-0000000002a0","op":"insert"}'::jsonb,
             'c1000000-0000-0000-0000-00000000a001'::uuid) $$,
  'powody: INSERT -> zdarzenie {reason_id, op} bez etykiet');

UPDATE public.retention_reasons SET label_pl = label_pl WHERE id = 'c1000000-0000-0000-0000-0000000002a0';
SELECT is_empty(
  $$ SELECT 1 FROM pg_temp.ev_take('retention_reason.changed.v1') $$,
  'powody: UPDATE bez zmiany nie emituje');

UPDATE public.retention_reasons SET active = false WHERE id = 'c1000000-0000-0000-0000-0000000002a0';
SELECT results_eq(
  $$ SELECT payload->>'op' FROM pg_temp.ev_take('retention_reason.changed.v1') $$,
  $$ VALUES ('update') $$,
  'powody: wyłączenie powodu emituje update');
DELETE FROM public.retention_reasons WHERE id = 'c1000000-0000-0000-0000-0000000002a0';
SELECT results_eq(
  $$ SELECT payload->>'op' FROM pg_temp.ev_take('retention_reason.changed.v1') $$,
  $$ VALUES ('delete') $$,
  'powody: usunięcie emituje delete');

-- ── 6. Brak zbędnych śladów awarii przy zdrowej szynie ──────────────────────
SELECT is(
  (SELECT count(*)::int FROM public.domain_event_emit_errors
    WHERE source IN ('tg_metering_settings_emit', 'tg_checkout_settings_emit', 'tg_retention_settings_emit',
                     'tg_content_access_emit', 'tg_retention_reasons_emit')
      AND tenant_id IN ('c1000000-0000-0000-0000-0000000000a0', 'c1000000-0000-0000-0000-0000000000b0')),
  0,
  'zdrowa szyna: żaden emiter nie zostawił śladu awarii');

-- ── 7. Atrybuty i ACL wyzwalaczy ─────────────────────────────────────────────
SELECT ok(
  (SELECT bool_and(p.prosecdef AND EXISTS (
            SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%pg_temp%'))
     FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('tg_metering_settings_emit', 'tg_checkout_settings_emit', 'tg_retention_settings_emit',
                        'tg_content_access_emit', 'tg_retention_reasons_emit')),
  'atrybuty: 5 emiterów SECURITY DEFINER ze ścieżką z pg_temp');
SELECT is_empty(
  $$ SELECT p.proname || ' -> ' || r FROM pg_proc p
       CROSS JOIN unnest(ARRAY['anon', 'authenticated', 'service_role']) r
      WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN ('tg_metering_settings_emit', 'tg_checkout_settings_emit', 'tg_retention_settings_emit',
                          'tg_content_access_emit', 'tg_retention_reasons_emit')
        AND has_function_privilege(r, p.oid, 'EXECUTE') $$,
  'acl: wyzwalacze bez EXECUTE dla anon, authenticated i service_role');
SELECT set_eq(
  $$ SELECT t.tgname::text FROM pg_trigger t
      WHERE NOT t.tgisinternal
        AND t.tgname IN ('trg_metering_settings_emit', 'trg_checkout_settings_emit', 'trg_retention_settings_emit',
                         'trg_content_access_emit', 'trg_retention_reasons_emit') $$,
  $$ VALUES ('trg_metering_settings_emit'), ('trg_checkout_settings_emit'), ('trg_retention_settings_emit'),
            ('trg_content_access_emit'), ('trg_retention_reasons_emit') $$,
  'wyzwalacze: wszystkie 5 podpiętych');

-- ── 8. Awaria szyny: zapis przechodzi, ślad zostaje ─────────────────────────
-- Produkcyjna `emit_domain_event` połyka własne błędy (V10), więc awarię
-- symulujemy podmianą W TRANSAKCJI testu (ROLLBACK ją cofa).
CREATE OR REPLACE FUNCTION public.emit_domain_event(
  p_tenant_id uuid, p_aggregate_type text, p_aggregate_id text, p_event_type text,
  p_payload jsonb DEFAULT '{}'::jsonb, p_actor_id uuid DEFAULT NULL, p_suppress_actor boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'szyna niedostępna (test)' USING ERRCODE = 'XX000';
END;
$$;

SELECT lives_ok(
  $$ UPDATE public.metering_settings SET member_monthly_limit = 11
      WHERE tenant_id = 'c1000000-0000-0000-0000-0000000000a0' $$,
  'awaria: zapis licznika przechodzi mimo padniętej szyny');
SELECT is(
  (SELECT member_monthly_limit FROM public.metering_settings WHERE tenant_id = 'c1000000-0000-0000-0000-0000000000a0'),
  11,
  'awaria: wartość licznika zapisana');

UPDATE public.checkout_settings SET allow_promotion_codes = false
 WHERE tenant_id = 'c1000000-0000-0000-0000-0000000000a0';
UPDATE public.retention_settings SET discount_pct = 40
 WHERE tenant_id = 'c1000000-0000-0000-0000-0000000000a0';
SELECT lives_ok(
  $$ UPDATE public.content_access SET mode = 'members'
      WHERE id = 'c1000000-0000-0000-0000-0000000001a0' $$,
  'awaria: zapis reguły dostępu przechodzi');
SELECT lives_ok(
  $$ INSERT INTO public.retention_reasons (tenant_id, label_pl, label_en)
     VALUES ('c1000000-0000-0000-0000-0000000000b0', 'Brak czasu', 'No time') $$,
  'awaria: zapis powodu odejścia przechodzi');

SELECT set_eq(
  $$ SELECT source, event_type, sqlstate FROM public.domain_event_emit_errors
      WHERE tenant_id IN ('c1000000-0000-0000-0000-0000000000a0', 'c1000000-0000-0000-0000-0000000000b0') $$,
  $$ VALUES ('tg_metering_settings_emit', 'metering_settings.changed.v1', 'XX000'),
            ('tg_checkout_settings_emit', 'checkout_settings.changed.v1', 'XX000'),
            ('tg_retention_settings_emit', 'retention_settings.changed.v1', 'XX000'),
            ('tg_content_access_emit', 'content_access.changed.v1', 'XX000'),
            ('tg_retention_reasons_emit', 'retention_reason.changed.v1', 'XX000') $$,
  'awaria: każdy z 5 emiterów zostawił ślad (source = nazwa emitera, typ, SQLSTATE)');
SELECT is(
  (SELECT tenant_id FROM public.domain_event_emit_errors WHERE source = 'tg_retention_reasons_emit'
    AND tenant_id IN ('c1000000-0000-0000-0000-0000000000a0', 'c1000000-0000-0000-0000-0000000000b0')),
  'c1000000-0000-0000-0000-0000000000b0'::uuid,
  'awaria: ślad przypięty do najemcy wiersza');
SELECT is(
  (SELECT error FROM public.domain_event_emit_errors WHERE source = 'tg_content_access_emit'
    AND tenant_id = 'c1000000-0000-0000-0000-0000000000a0'),
  'szyna niedostępna (test)',
  'awaria: ślad niesie komunikat błędu (SQLERRM)');
SELECT is(
  (SELECT mode::text FROM public.content_access WHERE id = 'c1000000-0000-0000-0000-0000000001a0'),
  'members',
  'awaria: reguła dostępu zapisana mimo awarii emitera');
SELECT is(
  (SELECT count(*)::int FROM public.retention_reasons WHERE tenant_id = 'c1000000-0000-0000-0000-0000000000b0'),
  1,
  'awaria: powód odejścia zapisany mimo awarii emitera');

SELECT * FROM finish();
ROLLBACK;
