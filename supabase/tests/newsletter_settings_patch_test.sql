-- pgTAP: zapis ustawień newslettera grupą kolumn + zdarzenia subskrybentów
-- (S1, migracja 20261020100100).
--
-- CO PRZYPINA:
--   * role: autor -> 42501, editor i admin zapisują; ACL (anon bez EXECUTE,
--     authenticated i service_role z EXECUTE);
--   * biała lista per grupa: kolumna spoza grupy -> 22023
--     `column_not_in_group:<kol>` i ZERO zmian; nieznana grupa, patch nie-obiekt,
--     wartość złego typu -> 22023;
--   * brak wiersza + token NULL -> INSERT dla najemcy z domyślnymi + patch;
--     token NULL przy istniejącym wierszu i stary token -> 40001 `stale_write`;
--   * sekwencja A (grupa `overview`) -> B (grupa `popup`, token odświeżony):
--     obie zmiany są w wierszu, B nie nadpisał kolumn A; patch bez zmian nie
--     robi UPDATE (ten sam `updated_at`, `changed = []`, brak zdarzenia);
--   * izolacja najemców: zapis admina B ląduje w wierszu B, wiersz A nietknięty;
--   * `newsletter_settings.changed.v1` z NAZWAMI kolumn (bez wartości);
--   * subskrybenci: payloady `subscribed/confirmed/unsubscribed` bez zmian
--     (regresja), `resubscribed.v1` dokładnie raz przy powrocie (wprost i przez
--     double opt-in), nie przy innych UPDATE, bez PII w payloadzie.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test newsletter_settings_patch
BEGIN;
SELECT plan(38);

-- ── Fixture ──────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('c2000000-0000-0000-0000-0000000000a0', 'hub-s1-nl-a', 'Hub S1 newsletter A'),
  ('c2000000-0000-0000-0000-0000000000b0', 'hub-s1-nl-b', 'Hub S1 newsletter B');

INSERT INTO auth.users (id, email) VALUES
  ('c2000000-0000-0000-0000-00000000a001', 'admin-a@hub-s1-nl.test'),
  ('c2000000-0000-0000-0000-00000000a002', 'editor-a@hub-s1-nl.test'),
  ('c2000000-0000-0000-0000-00000000a003', 'author-a@hub-s1-nl.test'),
  ('c2000000-0000-0000-0000-00000000b001', 'admin-b@hub-s1-nl.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('c2000000-0000-0000-0000-00000000a001', 'admin-a@hub-s1-nl.test', 'Admin A', 'c2000000-0000-0000-0000-0000000000a0'),
  ('c2000000-0000-0000-0000-00000000a002', 'editor-a@hub-s1-nl.test', 'Editor A', 'c2000000-0000-0000-0000-0000000000a0'),
  ('c2000000-0000-0000-0000-00000000a003', 'author-a@hub-s1-nl.test', 'Author A', 'c2000000-0000-0000-0000-0000000000a0'),
  ('c2000000-0000-0000-0000-00000000b001', 'admin-b@hub-s1-nl.test', 'Admin B', 'c2000000-0000-0000-0000-0000000000b0');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('c2000000-0000-0000-0000-00000000a001', 'admin', 'c2000000-0000-0000-0000-0000000000a0'),
  ('c2000000-0000-0000-0000-00000000a002', 'editor', 'c2000000-0000-0000-0000-0000000000a0'),
  ('c2000000-0000-0000-0000-00000000a003', 'author', 'c2000000-0000-0000-0000-0000000000a0'),
  ('c2000000-0000-0000-0000-00000000b001', 'admin', 'c2000000-0000-0000-0000-0000000000b0');

DELETE FROM public.newsletter_settings WHERE tenant_id IN ('c2000000-0000-0000-0000-0000000000a0', 'c2000000-0000-0000-0000-0000000000b0');

-- Zdarzenia ZUŻYWANE (ten sam `created_at` w jednej transakcji - kolejność po
-- czasie nic nie mówi): `ev_take` zwraca jeszcze niewidziane i je oznacza.
CREATE TEMP TABLE ev_seen (id uuid PRIMARY KEY) ON COMMIT DROP;
CREATE FUNCTION pg_temp.ev_take(p_type text) RETURNS SETOF public.domain_events LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH fresh AS (
    SELECT e.* FROM public.domain_events e
     WHERE e.event_type = p_type
       AND e.tenant_id IN ('c2000000-0000-0000-0000-0000000000a0', 'c2000000-0000-0000-0000-0000000000b0')
       AND NOT EXISTS (SELECT 1 FROM ev_seen s WHERE s.id = e.id)
  ), mark AS (
    INSERT INTO ev_seen (id) SELECT f.id FROM fresh f
  )
  SELECT * FROM fresh;
END;
$$;
CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;
CREATE TEMP TABLE tok (name text PRIMARY KEY, ts timestamptz) ON COMMIT DROP;
GRANT SELECT, INSERT ON tok TO authenticated;

-- ── 1. Role i ACL ────────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public.admin_newsletter_settings_patch(text, jsonb, timestamptz)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_newsletter_settings_patch(text, jsonb, timestamptz)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.admin_newsletter_settings_patch(text, jsonb, timestamptz)', 'EXECUTE'),
  'acl: RPC dla authenticated i service_role, nie dla anon');

SELECT pg_temp.as_user('c2000000-0000-0000-0000-00000000a003');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.admin_newsletter_settings_patch('overview', '{"mode":"popup"}', NULL) $$,
  '42501', 'forbidden', 'role: autor nie zapisuje ustawień newslettera (42501)');
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.newsletter_settings WHERE tenant_id = 'c2000000-0000-0000-0000-0000000000a0'),
  0, 'role: odrzucony autor nie założył wiersza');

-- ── 2. Walidacja (editor) ────────────────────────────────────────────────────
SELECT pg_temp.as_user('c2000000-0000-0000-0000-00000000a002');
SELECT throws_ok(
  $$ SELECT public.admin_newsletter_settings_patch('sidebar', '{"mode":"popup"}', NULL) $$,
  '22023', 'unknown_group', 'walidacja: nieznana grupa -> 22023 unknown_group');
SELECT throws_ok(
  $$ SELECT public.admin_newsletter_settings_patch('overview', '["mode"]', NULL) $$,
  '22023', 'invalid_patch', 'walidacja: patch niebędący obiektem -> 22023 invalid_patch');
SELECT throws_ok(
  $$ SELECT public.admin_newsletter_settings_patch('overview', '{"mode":"popup","popup_title_pl":"X"}', NULL) $$,
  '22023', 'column_not_in_group:popup_title_pl',
  'biała lista: kolumna spoza grupy overview -> 22023 column_not_in_group');
SELECT throws_ok(
  $$ SELECT public.admin_newsletter_settings_patch('registration', '{"popup_fields":[],"popup_doc":{}}', NULL) $$,
  '22023', 'column_not_in_group:popup_doc',
  'biała lista: grupa registration przyjmuje wyłącznie popup_fields');
SELECT throws_ok(
  $$ SELECT public.admin_newsletter_settings_patch('builder', '{"inline_doc":{},"heading_pl":"X"}', NULL) $$,
  '22023', 'column_not_in_group:heading_pl',
  'biała lista: grupa builder nie pisze tekstów formularza inline');
SELECT throws_ok(
  $$ SELECT public.admin_newsletter_settings_patch('overview', '{"popup_delay_seconds":"za chwilę"}', NULL) $$,
  '22023', 'invalid_value:popup_delay_seconds',
  'walidacja: wartość złego typu -> 22023 invalid_value:<kolumna>');
SELECT is(
  (SELECT count(*)::int FROM public.newsletter_settings WHERE tenant_id = 'c2000000-0000-0000-0000-0000000000a0'),
  0, 'walidacja: odrzucone patche niczego nie zapisały');

-- ── 3. INSERT przy braku wiersza ─────────────────────────────────────────────
SET LOCAL ROLE authenticated;
INSERT INTO tok (name, ts)
SELECT 'insert', (public.admin_newsletter_settings_patch(
  'overview', '{"mode":"popup","sender_name":"Redakcja NES"}', NULL) ->> 'updated_at')::timestamptz;
RESET ROLE;
SELECT results_eq(
  $$ SELECT mode, sender_name, heading_pl, updated_by FROM public.newsletter_settings
      WHERE tenant_id = 'c2000000-0000-0000-0000-0000000000a0' $$,
  $$ VALUES ('popup', 'Redakcja NES', 'Zapisz się do newslettera', 'c2000000-0000-0000-0000-00000000a002'::uuid) $$,
  'insert: brak wiersza -> editor zakłada wiersz najemcy z patchem, reszta z domyślnych, updated_by = editor');
SELECT ok(
  (SELECT ts FROM tok WHERE name = 'insert') = (SELECT updated_at FROM public.newsletter_settings
     WHERE tenant_id = 'c2000000-0000-0000-0000-0000000000a0'),
  'insert: RPC zwraca token updated_at zapisanego wiersza');
SELECT results_eq(
  $$ SELECT payload->>'op', payload->'keys' ? 'mode', payload->'keys' ? 'heading_pl',
            position('Redakcja' IN payload::text) = 0, actor_id
       FROM pg_temp.ev_take('newsletter_settings.changed.v1') $$,
  $$ VALUES ('insert', true, true, true, 'c2000000-0000-0000-0000-00000000a002'::uuid) $$,
  'zdarzenie: INSERT -> jedno newsletter_settings.changed.v1 z nazwami kolumn, bez wartości');
SELECT throws_ok(
  $$ SELECT public.admin_newsletter_settings_patch('overview', '{"mode":"inline"}', NULL) $$,
  '40001', 'stale_write', 'cas: token NULL przy istniejącym wierszu -> 40001 (ktoś założył wiersz)');

-- Przesuwamy token w przeszłość (wyzwalacz updated_at wyłączony na moment),
-- żeby „stary" token różnił się od bieżącego także w jednej transakcji testu.
ALTER TABLE public.newsletter_settings DISABLE TRIGGER newsletter_settings_set_updated_at;
UPDATE public.newsletter_settings SET updated_at = '2026-01-01 10:00:00+00'
 WHERE tenant_id = 'c2000000-0000-0000-0000-0000000000a0';
ALTER TABLE public.newsletter_settings ENABLE TRIGGER newsletter_settings_set_updated_at;
SELECT is_empty($$ SELECT 1 FROM pg_temp.ev_take('newsletter_settings.changed.v1') $$,
  'zdarzenie: sam dotyk updated_at nie emituje');

-- ── 4. Sekwencja A (overview) -> B (popup) ───────────────────────────────────
INSERT INTO tok (name, ts)
SELECT 'a', (public.admin_newsletter_settings_patch(
  'overview', '{"mode":"both","double_opt_in":true}', '2026-01-01 10:00:00+00') ->> 'updated_at')::timestamptz;
SELECT ok((SELECT ts FROM tok WHERE name = 'a') <> '2026-01-01 10:00:00+00'::timestamptz,
  'cas A: zapis z aktualnym tokenem przechodzi i zwraca nowy token');
SELECT throws_ok(
  $$ SELECT public.admin_newsletter_settings_patch('popup', '{"popup_title_pl":"Druga karta"}', '2026-01-01 10:00:00+00') $$,
  '40001', 'stale_write', 'cas: druga karta ze starym tokenem -> 40001 stale_write');
SELECT is(
  public.admin_newsletter_settings_patch('popup',
    '{"popup_title_pl":"Druga karta","popup_enabled":false,"popup_mailing_lists":[{"id":"ekonomia","label_pl":"Ekonomia","label_en":"Economy"}]}',
    (SELECT ts FROM tok WHERE name = 'a')) -> 'changed',
  '["popup_mailing_lists","popup_title_pl"]'::jsonb,
  'cas B: odświeżony token -> zapis; changed = tylko kolumny o nowej wartości (popup_enabled bez zmiany)');
SELECT results_eq(
  $$ SELECT mode, double_opt_in, popup_title_pl, popup_mailing_lists -> 0 ->> 'id'
       FROM public.newsletter_settings WHERE tenant_id = 'c2000000-0000-0000-0000-0000000000a0' $$,
  $$ VALUES ('both', true, 'Druga karta', 'ekonomia') $$,
  'sekwencja A->B: obie zmiany w wierszu, B nie nadpisał kolumn A');
SELECT results_eq(
  $$ SELECT payload FROM pg_temp.ev_take('newsletter_settings.changed.v1') ORDER BY payload::text $$,
  $$ VALUES ('{"op":"update","keys":["double_opt_in","mode"]}'::jsonb),
            ('{"op":"update","keys":["popup_mailing_lists","popup_title_pl"]}'::jsonb) $$,
  'zdarzenie: dwa UPDATE -> dwa zdarzenia, keys = posortowane nazwy zmienionych kolumn');

-- ── 5. Patch bez zmian ───────────────────────────────────────────────────────
INSERT INTO tok (name, ts) SELECT 'before_noop', updated_at FROM public.newsletter_settings
 WHERE tenant_id = 'c2000000-0000-0000-0000-0000000000a0';
SELECT is(
  public.admin_newsletter_settings_patch('overview', '{"mode":"both"}', (SELECT ts FROM tok WHERE name = 'before_noop')),
  jsonb_build_object('updated_at', (SELECT ts FROM tok WHERE name = 'before_noop'), 'changed', '[]'::jsonb),
  'noop: patch bez zmiany wartości zwraca bieżący token i changed = []');
SELECT is_empty($$ SELECT 1 FROM pg_temp.ev_take('newsletter_settings.changed.v1') $$,
  'noop: brak zdarzenia');

-- ── 6. Admin A zapisuje; izolacja najemców ──────────────────────────────────
SELECT pg_temp.as_user('c2000000-0000-0000-0000-00000000a001');
SELECT lives_ok(
  $$ SELECT public.admin_newsletter_settings_patch('inline', '{"heading_pl":"Bądź na bieżąco"}',
       (SELECT updated_at FROM public.newsletter_settings WHERE tenant_id = 'c2000000-0000-0000-0000-0000000000a0')) $$,
  'role: admin zapisuje grupę inline');
SELECT pg_temp.as_user('c2000000-0000-0000-0000-00000000b001');
SELECT lives_ok(
  $$ SELECT public.admin_newsletter_settings_patch('overview', '{"mode":"off"}', NULL) $$,
  'izolacja: admin B zakłada WŁASNY wiersz (najemca z sesji, nie z parametru)');
SELECT results_eq(
  $$ SELECT tenant_id, mode, heading_pl FROM public.newsletter_settings
      WHERE tenant_id IN ('c2000000-0000-0000-0000-0000000000a0', 'c2000000-0000-0000-0000-0000000000b0')
      ORDER BY tenant_id $$,
  $$ VALUES ('c2000000-0000-0000-0000-0000000000a0'::uuid, 'both', 'Bądź na bieżąco'),
            ('c2000000-0000-0000-0000-0000000000b0'::uuid, 'off', 'Zapisz się do newslettera') $$,
  'izolacja: zapis B tylko w wierszu B, wiersz A nietknięty');
SELECT results_eq(
  $$ SELECT tenant_id, payload->>'op' FROM pg_temp.ev_take('newsletter_settings.changed.v1') ORDER BY tenant_id $$,
  $$ VALUES ('c2000000-0000-0000-0000-0000000000a0'::uuid, 'update'),
            ('c2000000-0000-0000-0000-0000000000b0'::uuid, 'insert') $$,
  'izolacja: zdarzenia przypięte do najemcy wiersza');

-- Kompletność grup: każda kolumna tabeli (poza tenant_id, updated_at,
-- updated_by) jest zapisywalna przez co najmniej jedną grupę. Nowa kolumna
-- bez grupy byłaby po cichu niezapisywalna z panelu. Patch bieżącą wartością
-- jest no-opem, więc pętla niczego nie zmienia.
CREATE FUNCTION pg_temp.ungrouped_columns() RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE
  v_col text;
  v_group text;
  v_found boolean;
  v_row jsonb;
BEGIN
  SELECT to_jsonb(s) INTO v_row FROM public.newsletter_settings s WHERE s.tenant_id = public.current_tenant_id();
  FOR v_col IN
    SELECT c.column_name::text FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.table_name = 'newsletter_settings'
       AND c.column_name NOT IN ('tenant_id', 'updated_at', 'updated_by')
  LOOP
    v_found := false;
    FOREACH v_group IN ARRAY ARRAY['overview', 'popup', 'registration', 'builder', 'inline'] LOOP
      BEGIN
        PERFORM public.admin_newsletter_settings_patch(
          v_group, jsonb_build_object(v_col, v_row -> v_col), (v_row ->> 'updated_at')::timestamptz);
        v_found := true;
        EXIT;
      EXCEPTION WHEN invalid_parameter_value THEN
        NULL;
      END;
    END LOOP;
    IF NOT v_found THEN
      RETURN NEXT v_col;
    END IF;
  END LOOP;
END;
$$;
SELECT is_empty($$ SELECT * FROM pg_temp.ungrouped_columns() $$,
  'grupy: każda kolumna newsletter_settings należy do co najmniej jednej grupy');

-- ── 7. Subskrybenci: regresja payloadów i powrót po wypisie ─────────────────
-- Ciało emitera przekazuje `email` jak dotąd, ale wyzwalacz
-- `domain_events_redact_payload` (20260729123407) zdejmuje go przed zapisem -
-- regresja przypina więc to, co faktycznie ląduje w szynie.
INSERT INTO public.newsletter_subscribers (id, tenant_id, email, first_name, last_name, language, status, source, user_id)
VALUES ('c2000000-0000-0000-0000-0000000005a1', 'c2000000-0000-0000-0000-0000000000a0', 'ola@hub-s1-nl.test',
        'Ola', 'Nowak', 'pl', 'pending', 'popup', 'c2000000-0000-0000-0000-00000000a002');
SELECT results_eq(
  $$ SELECT payload FROM pg_temp.ev_take('newsletter_subscriber.subscribed.v1') $$,
  $$ VALUES ('{"first_name":"Ola","last_name":"Nowak","language":"pl","status":"pending","source":"popup"}'::jsonb) $$,
  'regresja: subscribed.v1 - payload bez zmian');

UPDATE public.newsletter_subscribers SET status = 'subscribed', confirmed_at = now()
 WHERE id = 'c2000000-0000-0000-0000-0000000005a1';
SELECT results_eq(
  $$ SELECT payload FROM pg_temp.ev_take('newsletter_subscriber.confirmed.v1') $$,
  $$ VALUES ('{"first_name":"Ola","last_name":"Nowak","language":"pl","source":"popup"}'::jsonb) $$,
  'regresja: confirmed.v1 - payload bez zmian');
SELECT is_empty($$ SELECT 1 FROM pg_temp.ev_take('newsletter_subscriber.resubscribed.v1') $$,
  'powrót: pierwsze potwierdzenie (bez wcześniejszego wypisu) to NIE powrót');

UPDATE public.newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = now()
 WHERE id = 'c2000000-0000-0000-0000-0000000005a1';
SELECT results_eq(
  $$ SELECT payload FROM pg_temp.ev_take('newsletter_subscriber.unsubscribed.v1') $$,
  $$ VALUES ('{}'::jsonb) $$,
  'regresja: unsubscribed.v1 - payload bez zmian (jedyny klucz `email` zdjęty przez redakcję szyny)');

-- Zapis publiczny bez double opt-in: status wraca, `unsubscribed_at` zostaje.
UPDATE public.newsletter_subscribers SET status = 'subscribed'
 WHERE id = 'c2000000-0000-0000-0000-0000000005a1';
SELECT results_eq(
  $$ SELECT aggregate_type, aggregate_id, payload FROM pg_temp.ev_take('newsletter_subscriber.resubscribed.v1') $$,
  $$ VALUES ('newsletter_subscriber', 'c2000000-0000-0000-0000-0000000005a1',
             '{"subscriber_id":"c2000000-0000-0000-0000-0000000005a1","source":"popup","user_id":"c2000000-0000-0000-0000-00000000a002"}'::jsonb) $$,
  'powrót: unsubscribed -> subscribed emituje resubscribed.v1 raz, payload bez PII');

UPDATE public.newsletter_subscribers SET first_name = 'Aleksandra'
 WHERE id = 'c2000000-0000-0000-0000-0000000005a1';
UPDATE public.newsletter_subscribers SET language = 'en'
 WHERE id = 'c2000000-0000-0000-0000-0000000005a1';
SELECT is_empty($$ SELECT 1 FROM pg_temp.ev_take('newsletter_subscriber.resubscribed.v1') $$,
  'powrót: kolejne UPDATE wiersza z historią wypisu nie emitują ponownie');

-- Double opt-in po wypisie: zgłoszenie (pending) to jeszcze nie powrót,
-- potwierdzenie - tak (i jest też confirmed.v1).
INSERT INTO public.newsletter_subscribers (id, tenant_id, email, language, status, source, unsubscribed_at)
VALUES ('c2000000-0000-0000-0000-0000000005a2', 'c2000000-0000-0000-0000-0000000000a0', 'jan@hub-s1-nl.test',
        'pl', 'unsubscribed', 'import', now() - interval '30 days');
UPDATE public.newsletter_subscribers SET status = 'pending', source = 'newsletter-form'
 WHERE id = 'c2000000-0000-0000-0000-0000000005a2';
SELECT is_empty(
  $$ SELECT 1 FROM pg_temp.ev_take('newsletter_subscriber.resubscribed.v1') WHERE aggregate_id = 'c2000000-0000-0000-0000-0000000005a2' $$,
  'powrót DOI: samo zgłoszenie (pending) nie emituje');
UPDATE public.newsletter_subscribers SET status = 'subscribed', confirmed_at = now()
 WHERE id = 'c2000000-0000-0000-0000-0000000005a2';
SELECT results_eq(
  $$ SELECT payload FROM pg_temp.ev_take('newsletter_subscriber.resubscribed.v1') $$,
  $$ VALUES ('{"subscriber_id":"c2000000-0000-0000-0000-0000000005a2","source":"newsletter-form","user_id":null}'::jsonb) $$,
  'powrót DOI: potwierdzenie po wypisie emituje resubscribed.v1');
SELECT is(
  (SELECT count(*)::int FROM pg_temp.ev_take('newsletter_subscriber.confirmed.v1') WHERE aggregate_id = 'c2000000-0000-0000-0000-0000000005a2'),
  1, 'powrót DOI: to samo potwierdzenie emituje też confirmed.v1 (osobny warunek)');

-- Zdjęcie blokady przez operatora (`email_suppression_release`): wiersz wraca
-- z wyzerowanym `unsubscribed_at`.
UPDATE public.newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = now()
 WHERE id = 'c2000000-0000-0000-0000-0000000005a2';
UPDATE public.newsletter_subscribers SET status = 'subscribed', unsubscribed_at = NULL
 WHERE id = 'c2000000-0000-0000-0000-0000000005a2';
SELECT is(
  (SELECT count(*)::int FROM pg_temp.ev_take('newsletter_subscriber.resubscribed.v1')),
  1, 'powrót operatora: unsubscribed -> subscribed z wyzerowaniem daty emituje raz');

SELECT is_empty(
  $$ SELECT 1 FROM public.domain_event_emit_errors
      WHERE source IN ('tg_newsletter_settings_emit', 'tg_newsletter_subscribers_emit_events')
        AND tenant_id IN ('c2000000-0000-0000-0000-0000000000a0', 'c2000000-0000-0000-0000-0000000000b0') $$,
  'zdrowa szyna: emitery newslettera bez śladów awarii');

SELECT * FROM finish();
ROLLBACK;
