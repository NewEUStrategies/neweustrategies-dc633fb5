-- pgTAP: poprawki przegladu R67 - SMS/przypomnienia i QR/klucze (REG-10,
-- REG-12, REG-17; migracje 20261012182000_event_sms_optout_phone_consent,
-- 20261012182100_event_scanner_not_entry_code,
-- 20261012182200_email_dlq_redact_unsubscribe_url).
--
-- CO PRZYPINA:
--   1. Wycofanie zawsze mozliwe: `event_registration_set_channels` kluczem
--      zgloszenia zamknietego (cel 'act' -> closed) albo po koncu wydarzenia
--      (expired) przyjmuje zadanie, ktore WYLACZNIE wylacza (kazdy obecny
--      przelacznik false, bez sms_consent); kazde wlaczenie - takze „true"
--      bez zmiany stanu i sama zgoda - nadal dostaje already_closed /
--      manage_expired. Obcy klucz i obcy najemca -> not_found jak dotad.
--   2. Zgoda na numer, ktory POKAZANO: `phone_hint` (napis albo null) przy
--      wlaczaniu SMS porownany z biezaca podpowiedzia (3 ostatnie cyfry) ->
--      phone_changed; scenariusz TOCTOU: podglad -> zmiana numeru w tle ->
--      potwierdzenie ze stara podpowiedzia. Bez klucza (stary front) - bez
--      porownania. Przy wylaczaniu podpowiedz nie gra roli.
--   3. Zgoda zwiazana z ADRESATEM SMS-a: `_event_phone_sms_destination` =
--      lustro `normalizePhone` (src/lib/notify/sms.server.ts); trigger
--      zdejmuje zgode, gdy zmienia sie znormalizowany adresat ('+' toggle:
--      '+601234567' -> '601234567' to inny abonent), a zostawia ja przy samej
--      zmianie zapisu ('601234567' -> '+48 601 234 567', '0048…' -> '+48…').
--   4. Skaner: numer potwierdzenia `NES-XXXX-XXXX` i adres http(s) -> wynik
--      `not_entry_code` we WSZYSTKICH czterech RPC skanu, bez licznika
--      nieudanych rozpoznan, bez wiersza w dzienniku; 25 takich skanow nie
--      blokuje urzadzenia. Kontrapunkt: nieznany kod nadal liczy sie do
--      blokady, prawdziwy kod biletu wpuszcza.
--   5. DLQ poczty bez `unsubscribe_url` (redakcja i zaleglosc w prune).
--
-- Kazdy blok oblewa sie na ciele sprzed migracji (dowod mutacji:
-- scratchpad/review/R67-fix-notes.md).
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test event_sms_scanner_r67
BEGIN;
SELECT plan(53);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('c6700000-0000-0000-0000-0000000000aa', 'r67t-a', 'R67 A', 'r67t-a.example'),
  ('c6700000-0000-0000-0000-0000000000bb', 'r67t-b', 'R67 B', 'r67t-b.example');

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('c6700000-0000-0000-0000-0000000000c1', 'r67t-owner@example.org', now());
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('c6700000-0000-0000-0000-0000000000c1', 'r67t-owner@example.org', 'Wlasciciel', 'c6700000-0000-0000-0000-0000000000aa');

-- E1 za 10 dni, E2 po koncu, E3 u najemcy B.
INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, status,
                           registration_mode, registration_flow) VALUES
  ('c6710000-0000-0000-0000-000000000001', 'c6700000-0000-0000-0000-0000000000aa', 'r67t-e1',
   'R67 E1', 'R67 E1', now() + interval '10 days', NULL, 'published', 'form', 'instant'),
  ('c6710000-0000-0000-0000-000000000002', 'c6700000-0000-0000-0000-0000000000aa', 'r67t-e2',
   'R67 E2', 'R67 E2', now() - interval '2 days', now() - interval '1 hour', 'published', 'form', 'instant'),
  ('c6710000-0000-0000-0000-000000000003', 'c6700000-0000-0000-0000-0000000000bb', 'r67t-e3',
   'R67 E3', 'R67 E3', now() + interval '10 days', NULL, 'published', 'form', 'instant');

-- Osoby: 01 gosc (zgloszenie otwarte - podpowiedz), 02 gosc ze zgoda na
-- zgloszeniu anulowanym, 03 gosc ze zgoda po koncu wydarzenia, 04 odrzucony,
-- 05 wlasciciel konta, 06 osoba najemcy B, 10..15 - numery do triggera.
INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name, phone) VALUES
  ('c6730000-0000-0000-0000-000000000001', 'c6700000-0000-0000-0000-0000000000aa', NULL,
   'r67t-open@example.org', 'Ola', 'Otwarta', '600 100 200'),
  ('c6730000-0000-0000-0000-000000000002', 'c6700000-0000-0000-0000-0000000000aa', NULL,
   'r67t-cancelled@example.org', 'Celina', 'Anulowana', '601 111 222'),
  ('c6730000-0000-0000-0000-000000000003', 'c6700000-0000-0000-0000-0000000000aa', NULL,
   'r67t-ended@example.org', 'Ewa', 'Po Koncu', '602 222 333'),
  ('c6730000-0000-0000-0000-000000000004', 'c6700000-0000-0000-0000-0000000000aa', NULL,
   'r67t-rejected@example.org', 'Roza', 'Odrzucona', '603 333 444'),
  ('c6730000-0000-0000-0000-000000000005', 'c6700000-0000-0000-0000-0000000000aa',
   'c6700000-0000-0000-0000-0000000000c1', 'r67t-owner@example.org', 'Wanda', 'Wlascicielka', '604 444 555'),
  ('c6730000-0000-0000-0000-000000000006', 'c6700000-0000-0000-0000-0000000000bb', NULL,
   'r67t-b@example.org', 'Bea', 'Obca', '605 555 666'),
  ('c6730000-0000-0000-0000-000000000010', 'c6700000-0000-0000-0000-0000000000aa', NULL,
   'r67t-plus@example.org', 'Pola', 'Plus', '+601234567'),
  ('c6730000-0000-0000-0000-000000000011', 'c6700000-0000-0000-0000-0000000000aa', NULL,
   'r67t-bare@example.org', 'Bogna', 'Goly', '601234567'),
  ('c6730000-0000-0000-0000-000000000012', 'c6700000-0000-0000-0000-0000000000aa', NULL,
   'r67t-intl@example.org', 'Iga', 'Zero Zero', '0048 602 000 111'),
  ('c6730000-0000-0000-0000-000000000013', 'c6700000-0000-0000-0000-0000000000aa', NULL,
   'r67t-digits@example.org', 'Dora', 'Cyfra', '603 000 111'),
  ('c6730000-0000-0000-0000-000000000014', 'c6700000-0000-0000-0000-0000000000aa', NULL,
   'r67t-short@example.org', 'Kora', 'Krotki', '12-34'),
  ('c6730000-0000-0000-0000-000000000015', 'c6700000-0000-0000-0000-0000000000aa', NULL,
   'r67t-short2@example.org', 'Lena', 'Krotki', '12-34');

-- Zgloszenia. Klucze: 32 znaki base64url (rpad), w bazie tylko sha256.
-- Zgoda na SMS (notify_sms + stempel) tam, gdzie chodzi o jej wycofanie.
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, status, registration_mode, payment_status, cancelled_at,
   notify_sms, remind_sms, remind_sms_consent_at, remind_sms_consent_via, manage_token_hash) VALUES
  ('c6740000-0000-0000-0000-000000000001', 'c6700000-0000-0000-0000-0000000000aa', 'c6710000-0000-0000-0000-000000000001',
   'c6730000-0000-0000-0000-000000000001', 'approved', 'form', 'not_required', NULL,
   false, false, NULL, NULL, encode(extensions.digest(rpad('r67t-open', 32, 'x'), 'sha256'), 'hex')),
  ('c6740000-0000-0000-0000-000000000002', 'c6700000-0000-0000-0000-0000000000aa', 'c6710000-0000-0000-0000-000000000001',
   'c6730000-0000-0000-0000-000000000002', 'cancelled', 'form', 'paid', now(),
   true, true, now() - interval '3 days', 'token', encode(extensions.digest(rpad('r67t-cancelled', 32, 'x'), 'sha256'), 'hex')),
  ('c6740000-0000-0000-0000-000000000003', 'c6700000-0000-0000-0000-0000000000aa', 'c6710000-0000-0000-0000-000000000002',
   'c6730000-0000-0000-0000-000000000003', 'approved', 'form', 'not_required', NULL,
   true, true, now() - interval '5 days', 'token', encode(extensions.digest(rpad('r67t-ended', 32, 'x'), 'sha256'), 'hex')),
  ('c6740000-0000-0000-0000-000000000004', 'c6700000-0000-0000-0000-0000000000aa', 'c6710000-0000-0000-0000-000000000001',
   'c6730000-0000-0000-0000-000000000004', 'rejected', 'form', 'not_required', NULL,
   false, false, NULL, NULL, encode(extensions.digest(rpad('r67t-rejected', 32, 'x'), 'sha256'), 'hex')),
  ('c6740000-0000-0000-0000-000000000005', 'c6700000-0000-0000-0000-0000000000aa', 'c6710000-0000-0000-0000-000000000001',
   'c6730000-0000-0000-0000-000000000005', 'approved', 'form', 'not_required', NULL,
   false, false, NULL, NULL, NULL),
  ('c6740000-0000-0000-0000-000000000006', 'c6700000-0000-0000-0000-0000000000bb', 'c6710000-0000-0000-0000-000000000003',
   'c6730000-0000-0000-0000-000000000006', 'cancelled', 'form', 'not_required', now(),
   false, false, NULL, NULL, encode(extensions.digest(rpad('r67t-tenant-b', 32, 'x'), 'sha256'), 'hex'));

INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, status, registration_mode, payment_status,
   notify_sms, remind_sms, remind_sms_consent_at, remind_sms_consent_via)
SELECT ('c6740000-0000-0000-0000-0000000000' || right(p.id::text, 2))::uuid, p.tenant_id,
       'c6710000-0000-0000-0000-000000000001', p.id, 'approved', 'form', 'not_required',
       true, true, now() - interval '1 day', 'account'
  FROM public.event_people p
 WHERE p.id::text LIKE 'c6730000-0000-0000-0000-0000000000_%'
   AND right(p.id::text, 2) IN ('10', '11', '12', '13', '14', '15');

-- Czy zgloszenie ma jeszcze zgode na SMS (oba przelaczniki i stempel).
CREATE FUNCTION pg_temp.r67_consented(_reg text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT notify_sms AND remind_sms AND remind_sms_consent_at IS NOT NULL
    FROM public.event_registrations WHERE id = ('c6740000-0000-0000-0000-0000000000' || _reg)::uuid
$$;
CREATE FUNCTION pg_temp.r67_revoked(_reg text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT NOT notify_sms AND NOT remind_sms AND remind_sms_consent_at IS NULL AND remind_sms_consent_via IS NULL
    FROM public.event_registrations WHERE id = ('c6740000-0000-0000-0000-0000000000' || _reg)::uuid
$$;

-- Wywolanie, ktore NIE przerywa pliku: blad wraca jako {"error": ...}. Dzieki
-- temu stare cialo (dowod mutacji) daje czytelne `not ok`, a nie urwany plik.
CREATE FUNCTION pg_temp.r67_try(_sql text) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v jsonb;
BEGIN
  EXECUTE _sql INTO v;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', SQLERRM);
END $$;

-- ── 1-2. ACL pomocnikow ──────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public._event_phone_sms_destination(text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_phone_sms_destination(text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._event_phone_sms_destination(text)', 'EXECUTE'),
  'acl: _event_phone_sms_destination tylko service_role (pomocnik triggera)');
SELECT ok(
  NOT has_function_privilege('anon', 'public._event_scan_is_not_entry_code(text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_scan_is_not_entry_code(text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._event_scan_is_not_entry_code(text)', 'EXECUTE'),
  'acl: _event_scan_is_not_entry_code tylko service_role (pomocnik RPC skanu)');

-- ── 3. Adresat SMS-a = lustro normalizePhone ─────────────────────────────────
-- Te same przypadki przypina vitest `normalizePhone` (sms.server.test.ts).
SELECT is((
  SELECT string_agg(format('%s -> %s (oczekiwano %s)', quote_nullable(v.input),
                           quote_nullable(public._event_phone_sms_destination(v.input)),
                           quote_nullable(v.expected)), '; ')
    FROM (VALUES
      ('+48 600-100-200', '+48600100200'),
      ('0048600100200', '+48600100200'),
      ('600100200', '+48600100200'),
      ('(600) 100 200', '+48600100200'),
      (E'600\t100\u00a0200', '+48600100200'),
      (E'\u2009+48 600 100 200\ufeff', '+48600100200'),
      ('+601234567', '+601234567'),
      ('601234567', '+48601234567'),
      ('+44 20 7946 0958', '+442079460958'),
      ('12345', NULL),
      ('', NULL),
      (NULL, NULL),
      ('+0123456789', NULL),
      ('6001002001', NULL),
      ('+48 600 100 200 ext 5', NULL),
      ('600.100.200', NULL)) AS v(input, expected)
   WHERE public._event_phone_sms_destination(v.input) IS DISTINCT FROM v.expected),
  NULL, 'adresat SMS: _event_phone_sms_destination daje to samo co normalizePhone');

-- ── 4-9. Zgoda zwiazana z adresatem (trigger) ────────────────────────────────
UPDATE public.event_people SET phone = '601234567' WHERE id = 'c6730000-0000-0000-0000-000000000010';
SELECT ok(pg_temp.r67_revoked('10'),
  'REG-10 (R67): ''+601234567'' -> ''601234567'' (te same cyfry, inny abonent +48601234567) zdejmuje zgode');
UPDATE public.event_people SET phone = '+48 601 234 567' WHERE id = 'c6730000-0000-0000-0000-000000000011';
SELECT ok(pg_temp.r67_consented('11'),
  'R67: ''601234567'' -> ''+48 601 234 567'' to ten sam adresat - zgoda zostaje');
UPDATE public.event_people SET phone = '+48602000111' WHERE id = 'c6730000-0000-0000-0000-000000000012';
SELECT ok(pg_temp.r67_consented('12'),
  'R67: ''0048 602 000 111'' -> ''+48602000111'' to ten sam adresat - zgoda zostaje');
UPDATE public.event_people SET phone = '603 000 112' WHERE id = 'c6730000-0000-0000-0000-000000000013';
SELECT ok(pg_temp.r67_revoked('13'),
  'REG-10: zmiana cyfr (inny adresat) zdejmuje zgode');
UPDATE public.event_people SET phone = '1234' WHERE id = 'c6730000-0000-0000-0000-000000000014';
SELECT ok(pg_temp.r67_consented('14'),
  'bez adresata po obu stronach decyduja cyfry: ''12-34'' -> ''1234'' zostawia zgode');
UPDATE public.event_people SET phone = '1235' WHERE id = 'c6730000-0000-0000-0000-000000000015';
SELECT ok(pg_temp.r67_revoked('15'),
  'bez adresata po obu stronach decyduja cyfry: ''12-34'' -> ''1235'' zdejmuje zgode');

-- ── 10-24. Wycofanie kluczem zamknietym i wygaslym ───────────────────────────
SELECT set_config('request.headers', '{"x-tenant-host":"r67t-a.example"}', true);
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;

SELECT is((
  SELECT COALESCE(v->'error', jsonb_build_object('notify_sms', v->'notify_sms', 'remind_sms', v->'remind_sms',
                                                 'notify_email', v->'notify_email'))
    FROM (SELECT pg_temp.r67_try(format('SELECT public.event_registration_set_channels(%L::jsonb)',
            jsonb_build_object('manage_token', rpad('r67t-cancelled', 32, 'x'),
                               'notify_sms', false, 'remind_sms', false))) AS v) x),
  '{"notify_sms": false, "remind_sms": false, "notify_email": true}'::jsonb,
  'REG-10/17 (R67): klucz zgloszenia ANULOWANEGO wylacza SMS (bylo: already_closed)');
RESET ROLE;
SELECT ok((SELECT NOT notify_sms AND NOT remind_sms AND remind_sms_consent_at IS NOT NULL
             FROM public.event_registrations WHERE id = 'c6740000-0000-0000-0000-000000000002'),
  'R67: po wycofaniu readChannels nie widzi zgody (notify_sms=false); stempel zostaje jako slad');
SET LOCAL ROLE anon;
SELECT is(
  pg_temp.r67_try(format('SELECT public.event_registration_set_channels(%L::jsonb)', jsonb_build_object(
    'manage_token', rpad('r67t-cancelled', 32, 'x'), 'notify_email', false))) ->> 'notify_email',
  'false', 'R67: klucz zgloszenia anulowanego wylacza e-maile (notify_email)');
SELECT throws_ok(
  $$SELECT public.event_registration_set_channels(jsonb_build_object(
      'manage_token', rpad('r67t-cancelled', 32, 'x'), 'notify_sms', true, 'sms_consent', true))$$,
  'P0001', 'already_closed: this registration is already closed',
  'R67: klucz zamkniety - wlaczenie SMS nadal odrzucone');
SELECT throws_ok(
  $$SELECT public.event_registration_set_channels(jsonb_build_object(
      'manage_token', rpad('r67t-cancelled', 32, 'x'), 'remind_push', true))$$,
  'P0001', 'already_closed: this registration is already closed',
  'R67: klucz zamkniety - „true" bez zmiany stanu to nie wycofanie (remind_push domyslnie true)');
SELECT throws_ok(
  $$SELECT public.event_registration_set_channels(jsonb_build_object(
      'manage_token', rpad('r67t-cancelled', 32, 'x'), 'notify_sms', false, 'sms_consent', true))$$,
  'P0001', 'already_closed: this registration is already closed',
  'R67: klucz zamkniety - sms_consent w ladunku to nie wycofanie');
SELECT is(
  pg_temp.r67_try(format('SELECT public.event_registration_set_channels(%L::jsonb)', jsonb_build_object(
    'manage_token', rpad('r67t-rejected', 32, 'x'), 'notify_email', false, 'remind_email', false,
    'remind_push', false, 'remind_sessions', false))) ->> 'remind_sessions',
  'false', 'R67: klucz zgloszenia ODRZUCONEGO - komplet wylaczen przechodzi');

SELECT is((
  SELECT COALESCE(v->'error', jsonb_build_object('notify_sms', v->'notify_sms', 'remind_sms', v->'remind_sms'))
    FROM (SELECT pg_temp.r67_try(format('SELECT public.event_registration_set_channels(%L::jsonb)',
            jsonb_build_object('manage_token', rpad('r67t-ended', 32, 'x'), 'notify_sms', false, 'remind_sms', false,
                               -- Podpowiedz przy WYLACZANIU nie gra roli.
                               'phone_hint', '000'))) AS v) x),
  '{"notify_sms": false, "remind_sms": false}'::jsonb,
  'REG-10/17 (R67): klucz po KONCU wydarzenia wylacza SMS (bylo: manage_expired)');
SELECT is(
  pg_temp.r67_try(format('SELECT public.event_registration_set_channels(%L::jsonb)', jsonb_build_object(
    'manage_token', rpad('r67t-ended', 32, 'x'), 'notify_email', false))) ->> 'notify_email',
  'false', 'R67: klucz po koncu wydarzenia wylacza e-maile');
SELECT throws_ok(
  $$SELECT public.event_registration_set_channels(jsonb_build_object(
      'manage_token', rpad('r67t-ended', 32, 'x'), 'remind_sms', true, 'sms_consent', true))$$,
  'P0001', 'manage_expired: this management link expired when the event ended',
  'R67: klucz wygasly - wlaczenie SMS nadal odrzucone');
SELECT throws_ok(
  $$SELECT public.event_registration_set_channels(jsonb_build_object(
      'manage_token', rpad('r67t-ended', 32, 'x'), 'remind_email', true))$$,
  'P0001', 'manage_expired: this management link expired when the event ended',
  'R67: klucz wygasly - „true" bez zmiany stanu odrzucone');
SELECT throws_ok(
  $$SELECT public.event_registration_set_channels(jsonb_build_object(
      'manage_token', rpad('r67t-unknown', 32, 'x'), 'notify_sms', false))$$,
  'P0001', 'not_found: registration does not exist',
  'R67: wycofanie nieznanym kluczem -> not_found (bez wyroczni)');
SELECT throws_ok(
  $$SELECT public.event_registration_set_channels(jsonb_build_object(
      'manage_token', rpad('r67t-tenant-b', 32, 'x'), 'notify_sms', false))$$,
  'P0001', 'not_found: registration does not exist',
  'R67: wycofanie kluczem zamknietego zgloszenia najemcy B pod hostem A -> not_found');
SELECT throws_ok(
  $$SELECT public.event_registration_set_channels(jsonb_build_object(
      'manage_token', rpad('r67t-cancelled', 32, 'x'), 'notify_sms', 'false'))$$,
  'P0001', 'invalid_payload: notify_sms must be boolean',
  'R67: wycofanie nadal wymaga scislego boolean');
RESET ROLE;
SELECT ok((SELECT notify_email AND NOT notify_sms
             FROM public.event_registrations WHERE id = 'c6740000-0000-0000-0000-000000000006'),
  'R67: zgloszenie najemcy B nietkniete przez probe pod hostem A');
SELECT set_config('request.headers', '{"x-tenant-host":"r67t-b.example"}', true);
SET LOCAL ROLE anon;
SELECT is(
  pg_temp.r67_try(format('SELECT public.event_registration_set_channels(%L::jsonb)', jsonb_build_object(
    'manage_token', rpad('r67t-tenant-b', 32, 'x'), 'notify_email', false))) ->> 'notify_email',
  'false', 'R67: kontrapunkt - ten sam klucz wycofuje pod hostem wlasnego najemcy');
RESET ROLE;

-- ── 25-33. Zgoda na numer, ktory POKAZANO (phone_hint) ───────────────────────
SELECT set_config('request.headers', '{"x-tenant-host":"r67t-a.example"}', true);
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT public.event_registration_set_channels(jsonb_build_object(
      'manage_token', rpad('r67t-open', 32, 'x'), 'notify_sms', true, 'sms_consent', true, 'phone_hint', '999'))$$,
  'P0001', 'phone_changed: the phone number changed since the consent was shown',
  'R67: podpowiedz niezgodna z numerem -> phone_changed');
SELECT throws_ok(
  $$SELECT public.event_registration_set_channels(jsonb_build_object(
      'manage_token', rpad('r67t-open', 32, 'x'), 'notify_sms', true, 'sms_consent', true, 'phone_hint', null))$$,
  'P0001', 'phone_changed: the phone number changed since the consent was shown',
  'R67: jawny null („okno nie pokazalo cyfr"), a numer ma cyfry -> phone_changed');
SELECT throws_ok(
  $$SELECT public.event_registration_set_channels(jsonb_build_object(
      'manage_token', rpad('r67t-open', 32, 'x'), 'notify_sms', true, 'sms_consent', true, 'phone_hint', 200))$$,
  'P0001', 'invalid_payload: phone_hint must be a string',
  'R67: podpowiedz liczba -> invalid_payload');
RESET ROLE;
SELECT ok(pg_temp.r67_revoked('01'),
  'R67: odmowa phone_changed nie zostawia zgody ani przelacznikow');
SET LOCAL ROLE anon;

-- TOCTOU: okno zgody pokazuje „200", organizator zmienia numer w tle,
-- uczestnik klika „Zgadzam sie" z podpowiedzia, ktora widzial.
SELECT is(
  public.event_registration_preferences(jsonb_build_object('manage_token', rpad('r67t-open', 32, 'x'))) ->> 'phone_hint',
  '200', 'R67: okno zgody pokazuje podpowiedz „200"');
RESET ROLE;
UPDATE public.event_people SET phone = '600 100 999' WHERE id = 'c6730000-0000-0000-0000-000000000001';
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT public.event_registration_set_channels(jsonb_build_object(
      'manage_token', rpad('r67t-open', 32, 'x'), 'notify_sms', true, 'remind_sms', true,
      'sms_consent', true, 'phone_hint', '200'))$$,
  'P0001', 'phone_changed: the phone number changed since the consent was shown',
  'REG-10 (R67) TOCTOU: numer zmieniony miedzy oknem a potwierdzeniem -> phone_changed, nie zgoda na nowy numer');
SELECT ok((
  SELECT COALESCE((v->>'notify_sms')::boolean AND v->>'sms_consent_via' = 'token', false)
    FROM (SELECT pg_temp.r67_try(format('SELECT public.event_registration_set_channels(%L::jsonb)',
            jsonb_build_object('manage_token', rpad('r67t-open', 32, 'x'), 'notify_sms', true,
                               'sms_consent', true, 'phone_hint', '999'))) AS v) x),
  'R67: podpowiedz zgodna z biezacym numerem -> zgoda, stempel via token');
SELECT ok((
  SELECT COALESCE((v->>'remind_sms')::boolean, false)
    FROM (SELECT pg_temp.r67_try(format('SELECT public.event_registration_set_channels(%L::jsonb)',
            jsonb_build_object('manage_token', rpad('r67t-open', 32, 'x'), 'remind_sms', true,
                               'sms_consent', true))) AS v) x),
  'R67: bez klucza phone_hint (stary front) - bez porownania');
RESET ROLE;

SELECT set_config('request.jwt.claims',
  '{"sub":"c6700000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.event_registration_set_channels(jsonb_build_object(
      'registration_id', 'c6740000-0000-0000-0000-000000000005', 'notify_sms', true,
      'sms_consent', true, 'phone_hint', '554'))$$,
  'P0001', 'phone_changed: the phone number changed since the consent was shown',
  'R67: sciezka konta porownuje podpowiedz tak samo');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.headers', '', true);

-- ── 34-50. Skaner: numer potwierdzenia i adres poza licznikiem blokady ───────
INSERT INTO public.event_checkpoints (id, tenant_id, event_id, name_pl, name_en, kind, direction_mode,
                                      access_mode, dedupe_window_seconds) VALUES
  ('c6750000-0000-0000-0000-000000000001', 'c6700000-0000-0000-0000-0000000000aa', 'c6710000-0000-0000-0000-000000000001',
   'Brama', 'Gate', 'event_entry', 'in_out', 'control', 60);
INSERT INTO public.crm_companies (id, tenant_id, name) VALUES
  ('c6760000-0000-0000-0000-000000000001', 'c6700000-0000-0000-0000-0000000000aa', 'R67 Sponsor');
INSERT INTO public.event_sponsors (id, tenant_id, event_id, company_id, snapshot_name) VALUES
  ('c6770000-0000-0000-0000-000000000001', 'c6700000-0000-0000-0000-0000000000aa', 'c6710000-0000-0000-0000-000000000001',
   'c6760000-0000-0000-0000-000000000001', 'R67 Sponsor');
INSERT INTO public.event_scanner_devices (id, tenant_id, event_id, checkpoint_id, sponsor_id, label, token_hash,
                                          token_prefix, scopes, is_active, expires_at, revoked_at) VALUES
  ('c6780000-0000-0000-0000-000000000001', 'c6700000-0000-0000-0000-0000000000aa', 'c6710000-0000-0000-0000-000000000001',
   'c6750000-0000-0000-0000-000000000001', NULL, 'R67 brama',
   encode(extensions.digest('tok-r67t-gate-00001', 'sha256'), 'hex'), 'tok-r67t', ARRAY['checkin', 'badge_print']::text[],
   true, now() + interval '2 days', NULL),
  ('c6780000-0000-0000-0000-000000000002', 'c6700000-0000-0000-0000-0000000000aa', 'c6710000-0000-0000-0000-000000000001',
   NULL, 'c6770000-0000-0000-0000-000000000001', 'R67 stoisko',
   encode(extensions.digest('tok-r67t-lead-00001', 'sha256'), 'hex'), 'tok-r67t', ARRAY['lead']::text[],
   true, now() + interval '2 days', NULL);
-- Kod biletu z maila („Twoj bilet") - 32 znaki jak `_event_new_qr_token()`.
UPDATE public.event_registrations
   SET qr_token_hash = encode(extensions.digest('r67tQrTokenFromTicketMail_000001', 'sha256'), 'hex'),
       qr_issued_at = now()
 WHERE id = 'c6740000-0000-0000-0000-000000000005';

CREATE FUNCTION pg_temp.r67_device(_id text) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('failed', failed_scan_count, 'window', fail_window_count,
                            'locked', locked_until IS NOT NULL AND locked_until > now())
    FROM public.event_scanner_devices WHERE id = ('c6780000-0000-0000-0000-00000000000' || _id)::uuid
$$;

SELECT is((
  SELECT string_agg(format('%s -> %s', quote_nullable(v.input), public._event_scan_is_not_entry_code(v.input)), '; ')
    FROM (VALUES
      ('NES-AB12-CD34', true),
      ('nes-ab12-cd34', true),
      (E' \u00a0NES-AB12-CD34\n', true),
      ('https://neweuropeanstrategies.com/events/x?ticket=NES-AB12-CD34', true),
      ('HTTP://example.org/pair?t=abc', true),
      ('r67tQrTokenFromTicketMail_000001', false),
      ('NES-AB12-CDI4', false),
      ('NES-AB12-CD345', false),
      ('ftp://example.org', false),
      ('kod-ktorego-nie-ma', false),
      ('', false),
      (NULL, false)) AS v(input, expected)
   WHERE public._event_scan_is_not_entry_code(v.input) IS DISTINCT FROM v.expected),
  NULL, 'skaner: regula not_entry_code = classifyScannedCode (NES-XXXX-XXXX bez I/O, http(s)://)');

SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT is(
  public.event_checkin_record(jsonb_build_object('device_token', 'tok-r67t-gate-00001', 'code', 'NES-AB12-CD34',
                                                 'client_scan_uid', 'r67t-scan-1')) - 'person' - 'result',
  '{"outcome": "not_entry_code", "admit": false, "device_locked": false}'::jsonb,
  'REG-12 (R67): odprawa - numer potwierdzenia z karty -> not_entry_code');
SELECT is(
  public.event_checkin_record(jsonb_build_object('device_token', 'tok-r67t-gate-00001',
    'code', 'https://neweuropeanstrategies.com/events/r67t-e1?ticket=NES-AB12-CD34')) ->> 'outcome',
  'not_entry_code', 'REG-12 (R67): odprawa - dawny QR karty (adres) -> not_entry_code');
SELECT is(
  public.event_checkin_record(jsonb_build_object('device_token', 'tok-r67t-gate-00001', 'code', 'nes-ab12-cd34',
    'queued', true, 'device_scanned_at', now() - interval '1 minute')) ->> 'outcome',
  'not_entry_code', 'R67: odprawa z kolejki offline - not_entry_code (bez licznika monotonicznego)');
SELECT is(
  public.event_checkin_resolve(jsonb_build_object('device_token', 'tok-r67t-gate-00001', 'code', 'NES-AB12-CD34'))
    ->> 'outcome',
  'not_entry_code', 'REG-12 (R67): rozpoznanie bez zapisu -> not_entry_code');
SELECT is(
  public.event_lead_scan_record(jsonb_build_object('device_token', 'tok-r67t-lead-00001', 'code', 'NES-AB12-CD34')),
  '{"outcome": "not_entry_code", "device_locked": false, "person": null}'::jsonb,
  'REG-12 (R67): skan leada -> not_entry_code');
SELECT is(
  public.event_badge_print_record(jsonb_build_object('device_token', 'tok-r67t-gate-00001',
    'code', 'https://neweuropeanstrategies.com/events/r67t-e1?ticket=NES-AB12-CD34')),
  '{"outcome": "not_entry_code", "device_locked": false}'::jsonb,
  'REG-12 (R67): wydruk identyfikatora -> not_entry_code');
RESET ROLE;

SELECT is(pg_temp.r67_device('1'), '{"failed": 0, "window": 0, "locked": false}'::jsonb,
  'REG-12 (R67): bramka - licznik nieudanych rozpoznan nietkniety (odprawa, kolejka, rozpoznanie, wydruk)');
SELECT is(pg_temp.r67_device('2'), '{"failed": 0, "window": 0, "locked": false}'::jsonb,
  'REG-12 (R67): stoisko - licznik nietkniety');
SELECT is((SELECT count(*)::int FROM public.event_checkins WHERE event_id = 'c6710000-0000-0000-0000-000000000001'), 0,
  'R67: not_entry_code nie zostawia wiersza w dzienniku odpraw');

SET LOCAL ROLE anon;
DO $$
DECLARE
  i integer;
  v jsonb;
  v_bad integer := 0;
BEGIN
  FOR i IN 1..25 LOOP
    v := pg_temp.r67_try(format('SELECT public.event_checkin_record(%L::jsonb)', jsonb_build_object(
      'device_token', 'tok-r67t-gate-00001',
      'code', CASE WHEN i % 2 = 0
                THEN 'https://neweuropeanstrategies.com/events/r67t-e1?ticket=NES-' || lpad(i::text, 4, '0') || '-ABCD'
                ELSE 'NES-' || lpad(i::text, 4, '0') || '-ABCD' END,
      'client_scan_uid', 'r67t-burst-' || i)));
    IF v->>'outcome' IS DISTINCT FROM 'not_entry_code' THEN
      v_bad := v_bad + 1;
    END IF;
  END LOOP;
  PERFORM set_config('r67t.burst_bad', v_bad::text, true);
END $$;
RESET ROLE;
SELECT is(current_setting('r67t.burst_bad'), '0', 'R67: 25 skanow starych kart - kazdy not_entry_code');
SELECT is(pg_temp.r67_device('1'), '{"failed": 0, "window": 0, "locked": false}'::jsonb,
  'REG-12 (R67): 25 skanow starych kart przy bramce nie blokuje urzadzenia (prog 20 w 10 minut)');

SET LOCAL ROLE anon;
SELECT ok((
  SELECT COALESCE(v->>'outcome' = 'granted' AND (v->>'admit')::boolean, false)
    FROM (SELECT pg_temp.r67_try(format('SELECT public.event_checkin_record(%L::jsonb)', jsonb_build_object(
            'device_token', 'tok-r67t-gate-00001', 'code', 'r67tQrTokenFromTicketMail_000001',
            'client_scan_uid', 'r67t-real-1'))) AS v) x),
  'R67 kontrapunkt: kod biletu z maila wpuszcza');
SELECT is(
  pg_temp.r67_try(format('SELECT public.event_checkin_record(%L::jsonb)', jsonb_build_object(
    'device_token', 'tok-r67t-gate-00001', 'code', 'kod-ktorego-nie-ma-r67t'))) ->> 'outcome',
  'unknown_code', 'R67 kontrapunkt: nieznany kod nadal unknown_code');
SELECT is(
  pg_temp.r67_try(format('SELECT public.event_checkin_resolve(%L::jsonb)', jsonb_build_object(
    'device_token', 'tok-r67t-gate-00001', 'code', 'inny-kod-ktorego-nie-ma'))) ->> 'outcome',
  'unknown_code', 'R67 kontrapunkt: rozpoznanie nieznanego kodu - unknown_code');
RESET ROLE;
SELECT is(pg_temp.r67_device('1'), '{"failed": 2, "window": 2, "locked": false}'::jsonb,
  'R67 kontrapunkt: nieznany kod nadal liczy sie do blokady (zgadywanie kodow nie omija licznika)');
SELECT set_config('request.jwt.claims', '', true);

-- ── 51-53. DLQ poczty bez adresu wypisu ───────────────────────────────────────
-- Tresc kolejki niezaleznie od ukladu pgmq: atrapa lokalna (jedna tabela)
-- albo prawdziwe pgmq w CI (tabela na kolejke) - jak w email_dlq_redaction_test.
CREATE FUNCTION pg_temp.r67_queue(_q text) RETURNS SETOF jsonb
LANGUAGE plpgsql AS $$
BEGIN
  IF to_regclass('pgmq.q_messages') IS NOT NULL THEN
    RETURN QUERY EXECUTE
      'SELECT message FROM pgmq.q_messages WHERE queue_name = $1 ORDER BY msg_id' USING _q;
  ELSE
    RETURN QUERY EXECUTE format('SELECT message FROM pgmq.%I ORDER BY msg_id', 'q_' || _q);
  END IF;
END $$;

SELECT ok(NOT (public._email_dlq_redact(jsonb_build_object(
    'message_id', 'r67t-dlq-1', 'to', 'x@example.org', 'html', '<p>x</p>',
    'unsubscribe_url', 'https://x/api/public/newsletter/unsubscribe?token=NEWSLETTER-SECRET'), now())
  ? 'unsubscribe_url'),
  'REG-17 (R67): _email_dlq_redact usuwa unsubscribe_url (adres wypisu z kluczem)');

-- Zaleglosc zredagowana starym cialem: bez tresci, ale z adresem wypisu.
SELECT pgmq.send('transactional_emails_dlq', jsonb_build_object(
  'message_id', 'r67t-dlq-legacy', 'to', 'legacy@example.org', 'redacted', true,
  'unsubscribe_url', 'https://x/api/public/newsletter/unsubscribe?token=LEGACY-SECRET',
  'dlq_at', to_jsonb(now() - interval '3 days')));
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT ok((public.email_dlq_prune(interval '30 days', 1000) ->> 'redacted')::int >= 1,
  'R67: prune liczy zaleglosc z samym unsubscribe_url jako redakcje');
RESET ROLE;
SELECT ok((
  SELECT bool_and(NOT (m ? 'unsubscribe_url') AND m::text NOT LIKE '%LEGACY-SECRET%')
         AND count(*) = 1
         AND (min(m->>'dlq_at'))::timestamptz = now() - interval '3 days'
    FROM pg_temp.r67_queue('transactional_emails_dlq') m
   WHERE m->>'message_id' = 'r67t-dlq-legacy'),
  'REG-17 (R67): zaleglosc z adresem wypisu zredagowana, wiek zachowany');

SELECT set_config('request.jwt.claims', '', true);
SELECT * FROM finish();
ROLLBACK;
