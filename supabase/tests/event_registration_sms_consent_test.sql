-- pgTAP: zgoda na SMS per zgloszenie i pisarz preferencji (REG-09 / REG-10,
-- migracja 20261012131100_event_registration_sms_consent).
--
-- CO PRZYPINA:
--   * notify_sms domyslnie false, backfill bez stempla na false, CHECK
--     `event_registrations_notify_sms_consented` (zwalidowany - zaden stary
--     wiersz nie zostal z „zgoda" bez stempla);
--   * `event_registration_set_channels`: wlaczenie SMS wymaga sms_consent =
--     true i numeru, stempluje zgode (via account|token); remind_* maja
--     pisarza; scisle typy boolean; klucz przez resolver A1 (wygasly ->
--     manage_expired, zamkniete -> already_closed przy wlaczaniu - samo
--     wylaczenie przechodzi, przeglad R67; obcy najemca -> not_found);
--   * zmiana CYFR numeru osoby zdejmuje zgode na wszystkich jej zgloszeniach,
--     zmiana formatu - nie;
--   * `event_registration_preferences`: ksztalt bez numeru (tylko 3 ostatnie
--     cyfry), ta sama tozsamosc co pisarz, odmowy wartoscia;
--   * ACL i sciezka (pgcrypto) obu RPC.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test event_registration_sms_consent
BEGIN;
SELECT plan(44);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('5c0a0000-0000-0000-0000-0000000000aa', 'smsc-a', 'SMS consent A', 'smsc-a.example'),
  ('5c0b0000-0000-0000-0000-0000000000bb', 'smsc-b', 'SMS consent B', 'smsc-b.example');

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('5c000000-0000-0000-0000-0000000000c1', 'smsc-owner@example.org', now()),
  ('5c000000-0000-0000-0000-0000000000c2', 'smsc-stranger@example.org', now());

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('5c000000-0000-0000-0000-0000000000c1', 'smsc-owner@example.org', 'Wlasciciel', '5c0a0000-0000-0000-0000-0000000000aa'),
  ('5c000000-0000-0000-0000-0000000000c2', 'smsc-stranger@example.org', 'Obcy', '5c0a0000-0000-0000-0000-0000000000aa');

-- E1 trwa za 10 dni (SMS organizatora wlaczone), E2 juz sie skonczylo,
-- E3 nalezy do najemcy B.
INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, status, registration_mode) VALUES
  ('5c100000-0000-0000-0000-000000000001', '5c0a0000-0000-0000-0000-0000000000aa', 'smsc-e1',
   'SMS E1', 'SMS E1', now() + interval '10 days', NULL, 'published', 'form'),
  ('5c100000-0000-0000-0000-000000000002', '5c0a0000-0000-0000-0000-0000000000aa', 'smsc-e2',
   'SMS E2', 'SMS E2', now() - interval '2 days', now() - interval '1 hour', 'published', 'form'),
  ('5c100000-0000-0000-0000-000000000003', '5c0b0000-0000-0000-0000-0000000000bb', 'smsc-e3',
   'SMS E3', 'SMS E3', now() + interval '10 days', NULL, 'published', 'form');

INSERT INTO public.event_participant_settings (tenant_id, event_id, reminder_sms_enabled) VALUES
  ('5c0a0000-0000-0000-0000-0000000000aa', '5c100000-0000-0000-0000-000000000001', true);

INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name, phone) VALUES
  ('5c300000-0000-0000-0000-000000000001', '5c0a0000-0000-0000-0000-0000000000aa',
   '5c000000-0000-0000-0000-0000000000c1', 'smsc-owner@example.org', 'Ola', 'Wlascicielka', '600 100 200'),
  ('5c300000-0000-0000-0000-000000000002', '5c0a0000-0000-0000-0000-0000000000aa', NULL,
   'smsc-guest@example.org', 'Gosia', 'Gosc', '+48 601 222 333'),
  ('5c300000-0000-0000-0000-000000000003', '5c0a0000-0000-0000-0000-0000000000aa', NULL,
   'smsc-nophone@example.org', 'Nina', 'Bez Numeru', NULL),
  ('5c300000-0000-0000-0000-000000000004', '5c0b0000-0000-0000-0000-0000000000bb', NULL,
   'smsc-b@example.org', 'Bea', 'Obca', '602 333 444'),
  ('5c300000-0000-0000-0000-000000000005', '5c0a0000-0000-0000-0000-0000000000aa', NULL,
   'smsc-ended@example.org', 'Ewa', 'Po Koncu', '603 444 555'),
  ('5c300000-0000-0000-0000-000000000006', '5c0a0000-0000-0000-0000-0000000000aa', NULL,
   'smsc-closed@example.org', 'Zofia', 'Zamknieta', '604 555 666');

-- Bez kolumn notify_* - wiersze dostaja DEFAULT-y. Klucze: 32 znaki base64url.
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, status, registration_mode, payment_status, manage_token_hash, cancelled_at) VALUES
  ('5c400000-0000-0000-0000-000000000001', '5c0a0000-0000-0000-0000-0000000000aa', '5c100000-0000-0000-0000-000000000001',
   '5c300000-0000-0000-0000-000000000001', 'approved', 'form', 'not_required', NULL, NULL),
  ('5c400000-0000-0000-0000-000000000002', '5c0a0000-0000-0000-0000-0000000000aa', '5c100000-0000-0000-0000-000000000001',
   '5c300000-0000-0000-0000-000000000002', 'approved', 'form', 'not_required',
   encode(extensions.digest(rpad('smsc-t2', 32, 'x'), 'sha256'), 'hex'), NULL),
  ('5c400000-0000-0000-0000-000000000003', '5c0a0000-0000-0000-0000-0000000000aa', '5c100000-0000-0000-0000-000000000001',
   '5c300000-0000-0000-0000-000000000003', 'approved', 'form', 'not_required',
   encode(extensions.digest(rpad('smsc-t3', 32, 'x'), 'sha256'), 'hex'), NULL),
  ('5c400000-0000-0000-0000-000000000004', '5c0b0000-0000-0000-0000-0000000000bb', '5c100000-0000-0000-0000-000000000003',
   '5c300000-0000-0000-0000-000000000004', 'approved', 'form', 'not_required',
   encode(extensions.digest(rpad('smsc-t4', 32, 'x'), 'sha256'), 'hex'), NULL),
  ('5c400000-0000-0000-0000-000000000005', '5c0a0000-0000-0000-0000-0000000000aa', '5c100000-0000-0000-0000-000000000002',
   '5c300000-0000-0000-0000-000000000005', 'approved', 'form', 'not_required',
   encode(extensions.digest(rpad('smsc-t5', 32, 'x'), 'sha256'), 'hex'), NULL),
  ('5c400000-0000-0000-0000-000000000006', '5c0a0000-0000-0000-0000-0000000000aa', '5c100000-0000-0000-0000-000000000001',
   '5c300000-0000-0000-0000-000000000006', 'cancelled', 'form', 'not_required',
   encode(extensions.digest(rpad('smsc-t6', 32, 'x'), 'sha256'), 'hex'), now());

-- ── 1-5. Kolumna, backfill, CHECK ────────────────────────────────────────────
SELECT col_default_is('public', 'event_registrations', 'notify_sms', 'false',
  'notify_sms: DEFAULT false (zgody nikt nie zbieral)');
SELECT is((SELECT notify_sms FROM public.event_registrations WHERE id = '5c400000-0000-0000-0000-000000000001'), false,
  'notify_sms: nowe zgloszenie bez jawnej zgody ma SMS wylaczony');
SELECT ok((SELECT convalidated FROM pg_constraint
            WHERE conrelid = 'public.event_registrations'::regclass
              AND conname = 'event_registrations_notify_sms_consented'),
  'CHECK event_registrations_notify_sms_consented istnieje i jest zwalidowany (backfill przed CHECK)');
SELECT is((SELECT count(*)::int FROM public.event_registrations
            WHERE notify_sms AND remind_sms_consent_at IS NULL), 0,
  'backfill: zadne zgloszenie nie ma notify_sms bez stempla zgody');
SELECT throws_ok(
  $$UPDATE public.event_registrations SET notify_sms = true WHERE id = '5c400000-0000-0000-0000-000000000001'$$,
  '23514', NULL, 'CHECK: notify_sms = true bez stempla zgody odrzucone');

-- ── 6-8. ACL i sciezka ───────────────────────────────────────────────────────
SELECT ok(
  has_function_privilege('anon', 'public.event_registration_set_channels(jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.event_registration_set_channels(jsonb)', 'EXECUTE')
  AND has_function_privilege('anon', 'public.event_registration_preferences(jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.event_registration_preferences(jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.event_registration_preferences(jsonb)', 'EXECUTE'),
  'acl: pisarz i odczyt dla anon (klucz z maila) i authenticated (konto)');
SELECT ok((
  SELECT bool_and(EXISTS (
           SELECT 1 FROM unnest(p.proconfig) c
            WHERE c LIKE 'search_path=%' AND c LIKE '%extensions%' AND c LIKE '%pg_temp%'))
    FROM pg_proc p
   WHERE p.oid IN ('public.event_registration_set_channels(jsonb)'::regprocedure,
                   'public.event_registration_preferences(jsonb)'::regprocedure)),
  'search_path: obie funkcje z extensions i pg_temp (kontrakt pgcrypto)');
SELECT ok(
  NOT has_function_privilege('anon', 'public._tg_event_people_phone_revokes_sms()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._tg_event_people_phone_revokes_sms()', 'EXECUTE'),
  'acl: funkcja triggera numeru bez EXECUTE dla klienta');

-- ── 9-21. Sciezka konta ──────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"5c000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  public.event_registration_set_channels(jsonb_build_object(
    'registration_id', '5c400000-0000-0000-0000-000000000001', 'remind_email', false)) ->> 'remind_email',
  'false', 'konto: remind_email ma pisarza (REG-09 - wczesniej nikt nie pisal remind_*)');
SELECT throws_ok(
  $$SELECT public.event_registration_set_channels(jsonb_build_object(
      'registration_id', '5c400000-0000-0000-0000-000000000001', 'notify_sms', true))$$,
  'P0001', 'sms_consent_required: enabling SMS needs explicit consent',
  'REG-10: wlaczenie SMS bez zgody -> sms_consent_required');
SELECT throws_ok(
  $$SELECT public.event_registration_set_channels(jsonb_build_object(
      'registration_id', '5c400000-0000-0000-0000-000000000001', 'notify_sms', true, 'sms_consent', false))$$,
  'P0001', 'sms_consent_required: enabling SMS needs explicit consent',
  'REG-10: sms_consent = false to nie zgoda');
SELECT throws_ok(
  $$SELECT public.event_registration_set_channels(jsonb_build_object(
      'registration_id', '5c400000-0000-0000-0000-000000000001', 'notify_sms', 'true', 'sms_consent', true))$$,
  'P0001', 'invalid_payload: notify_sms must be boolean',
  'scisle typy: napis "true" to nie boolean (stare ::boolean go przyjmowalo)');
SELECT throws_ok(
  $$SELECT public.event_registration_set_channels(jsonb_build_object(
      'registration_id', '5c400000-0000-0000-0000-000000000001', 'remind_push', 'yes'))$$,
  'P0001', 'invalid_payload: remind_push must be boolean',
  'scisle typy: "yes" -> invalid_payload zamiast 22P02');
SELECT throws_ok(
  $$SELECT public.event_registration_set_channels(jsonb_build_object(
      'registration_id', '5c400000-0000-0000-0000-000000000001', 'sms_consent', true))$$,
  'P0001', 'invalid_payload: nothing to change',
  'sama zgoda bez przelacznika -> nothing to change');

SELECT ok((
  SELECT (v->>'notify_sms')::boolean AND v->>'sms_consent_via' = 'account'
         AND (v->>'sms_consent_at')::timestamptz = now()
    FROM (SELECT public.event_registration_set_channels(jsonb_build_object(
            'registration_id', '5c400000-0000-0000-0000-000000000001',
            'notify_sms', true, 'sms_consent', true,
            -- Klucz najemcy w ladunku jest ignorowany - najemca z sesji.
            'tenant_id', '5c0b0000-0000-0000-0000-0000000000bb')) AS v) x),
  'REG-10: zgoda + numer -> notify_sms true, stempel now(), via account');
SELECT ok(
  public.event_registration_set_channels(jsonb_build_object(
    'registration_id', '5c400000-0000-0000-0000-000000000001', 'notify_sms', false)) ->> 'sms_consent_at' IS NOT NULL,
  'wylaczenie SMS zostawia stempel jako slad ostatniej zgody');
SELECT throws_ok(
  $$SELECT public.event_registration_set_channels(jsonb_build_object(
      'registration_id', '5c400000-0000-0000-0000-000000000001', 'notify_sms', true))$$,
  'P0001', 'sms_consent_required: enabling SMS needs explicit consent',
  'ponowne wlaczenie znow pyta o zgode (stary stempel nie wystarcza)');
SELECT ok((
  SELECT (v->>'remind_sms')::boolean AND (v->>'notify_sms')::boolean
    FROM (SELECT public.event_registration_set_channels(jsonb_build_object(
            'registration_id', '5c400000-0000-0000-0000-000000000001',
            'notify_sms', true, 'remind_sms', true, 'sms_consent', true)) AS v) x),
  'konto: notify_sms i remind_sms razem ze zgoda');

SELECT set_config('request.jwt.claims',
  '{"sub":"5c000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT public.event_registration_set_channels(jsonb_build_object(
      'registration_id', '5c400000-0000-0000-0000-000000000001', 'notify_email', false))$$,
  'P0001', 'not_found: registration does not exist',
  'obce konto -> not_found');

SELECT set_config('request.headers', '{"x-tenant-host":"smsc-a.example"}', true);
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT public.event_registration_set_channels(jsonb_build_object(
      'registration_id', '5c400000-0000-0000-0000-000000000001', 'notify_email', false))$$,
  'P0001', 'auth_required: registration_id with session or manage_token is required',
  'anon z samym identyfikatorem -> auth_required');
SELECT throws_ok(
  $$SELECT public.event_registration_set_channels(jsonb_build_object(
      'registration_id', 'not-a-uuid', 'notify_email', false))$$,
  'P0001', 'auth_required: registration_id with session or manage_token is required',
  'identyfikator spoza ksztaltu uuid -> auth_required, nie 22P02');

-- ── 22-28. Sciezka klucza (gosc) ─────────────────────────────────────────────
SELECT ok((
  SELECT (v->>'remind_sms')::boolean AND v->>'sms_consent_via' = 'token' AND NOT (v->>'notify_sms')::boolean
    FROM (SELECT public.event_registration_set_channels(jsonb_build_object(
            'manage_token', rpad('smsc-t2', 32, 'x'), 'remind_sms', true, 'sms_consent', true)) AS v) x),
  'klucz: remind_sms ze zgoda -> stempel via token');
SELECT throws_ok(
  $$SELECT public.event_registration_set_channels(jsonb_build_object(
      'manage_token', rpad('smsc-t3', 32, 'x'), 'notify_sms', true, 'sms_consent', true))$$,
  'P0001', 'phone_required: registration has no phone number',
  'klucz: osoba bez numeru -> phone_required');
-- Przeglad R67: samo WYLACZENIE przechodzi na kluczu wygaslym i zamknietym
-- (supabase/tests/event_sms_scanner_r67_test.sql); kazde wlaczenie - nie.
SELECT throws_ok(
  $$SELECT public.event_registration_set_channels(jsonb_build_object(
      'manage_token', rpad('smsc-t5', 32, 'x'), 'notify_email', true))$$,
  'P0001', 'manage_expired: this management link expired when the event ended',
  'REG-17: klucz po koncu wydarzenia, wlaczenie -> manage_expired');
SELECT throws_ok(
  $$SELECT public.event_registration_set_channels(jsonb_build_object(
      'manage_token', rpad('smsc-t6', 32, 'x'), 'notify_email', true))$$,
  'P0001', 'already_closed: this registration is already closed',
  'REG-17: klucz anulowanego zgloszenia, wlaczenie -> already_closed');
SELECT throws_ok(
  $$SELECT public.event_registration_set_channels(jsonb_build_object(
      'manage_token', rpad('smsc-zz', 32, 'x'), 'notify_email', false))$$,
  'P0001', 'not_found: registration does not exist',
  'klucz nieznany -> not_found');
SELECT throws_ok(
  $$SELECT public.event_registration_set_channels(jsonb_build_object(
      'manage_token', rpad('smsc-t4', 32, 'x'), 'notify_email', false))$$,
  'P0001', 'not_found: registration does not exist',
  'klucz zgloszenia najemcy B pod hostem A -> not_found');
SELECT set_config('request.headers', '{"x-tenant-host":"smsc-b.example"}', true);
SELECT throws_ok(
  $$SELECT public.event_registration_set_channels(jsonb_build_object(
      'manage_token', rpad('smsc-t2', 32, 'x'), 'notify_email', false))$$,
  'P0001', 'not_found: registration does not exist',
  'klucz zgloszenia najemcy A pod hostem B -> not_found');

-- ── 29-37. Odczyt preferencji ────────────────────────────────────────────────
SELECT set_config('request.headers', '{"x-tenant-host":"smsc-a.example"}', true);
SELECT ok((
  SELECT (v->>'ok')::boolean AND v->>'phone_hint' = '333' AND (v->>'has_phone')::boolean
         AND NOT (v->>'has_account')::boolean AND v->>'sms_consent_via' = 'token'
         AND (v->>'remind_sms')::boolean AND NOT (v->>'notify_sms')::boolean
         AND (v->>'reminder_sms_enabled')::boolean AND (v->>'reminders_enabled')::boolean
         AND v->>'event_slug' = 'smsc-e1' AND v->>'status' = 'approved'
    FROM (SELECT public.event_registration_preferences(
            jsonb_build_object('manage_token', rpad('smsc-t2', 32, 'x'))) AS v) x),
  'preferencje (klucz): komplet przelacznikow, zgoda, flagi organizatora, phone_hint = 3 ostatnie cyfry');
SELECT ok((
  SELECT NOT (v ? 'phone') AND v::text NOT LIKE '%601%' AND v::text NOT LIKE '%222%'
    FROM (SELECT public.event_registration_preferences(
            jsonb_build_object('manage_token', rpad('smsc-t2', 32, 'x'))) AS v) x),
  'preferencje: numer nie wychodzi - ani klucz phone, ani cyfry poza podpowiedzia');
SELECT is(
  public.event_registration_preferences(jsonb_build_object('manage_token', rpad('smsc-t5', 32, 'x'))),
  '{"ok": false, "reason": "expired"}'::jsonb,
  'preferencje: klucz po koncu wydarzenia -> {ok:false, reason:expired}');
SELECT is(
  public.event_registration_preferences(jsonb_build_object('manage_token', rpad('smsc-t6', 32, 'x'))) ->> 'status',
  'cancelled', 'preferencje: podglad (cel view) dziala po anulowaniu');
SELECT is(
  public.event_registration_preferences(jsonb_build_object('manage_token', rpad('smsc-t4', 32, 'x'))),
  '{"ok": false, "reason": "not_found"}'::jsonb,
  'preferencje: klucz obcego najemcy -> not_found');
SELECT is(
  public.event_registration_preferences(jsonb_build_object('registration_id', '5c400000-0000-0000-0000-000000000001')),
  '{"ok": false, "reason": "not_found"}'::jsonb,
  'preferencje: anon z samym identyfikatorem -> not_found');
SELECT is(
  public.event_registration_preferences(jsonb_build_object('manage_token', rpad('smsc-t3', 32, 'x'))) ->> 'has_phone',
  'false', 'preferencje: osoba bez numeru -> has_phone false');

SELECT set_config('request.headers', '', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"5c000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT ok((
  SELECT (v->>'ok')::boolean AND (v->>'has_account')::boolean AND v->>'phone_hint' = '200'
         AND v->>'sms_consent_via' = 'account' AND NOT (v->>'remind_email')::boolean
    FROM (SELECT public.event_registration_preferences(
            jsonb_build_object('registration_id', '5c400000-0000-0000-0000-000000000001')) AS v) x),
  'preferencje (konto): wlasciciel widzi swoje przelaczniki i podpowiedz numeru');
SELECT set_config('request.jwt.claims',
  '{"sub":"5c000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
SELECT is(
  public.event_registration_preferences(jsonb_build_object('registration_id', '5c400000-0000-0000-0000-000000000001')),
  '{"ok": false, "reason": "not_found"}'::jsonb,
  'preferencje: obce konto -> not_found (bez wyroczni)');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- ── 38-44. Zgoda zwiazana z numerem ──────────────────────────────────────────
UPDATE public.event_people SET phone = '600-100-200' WHERE id = '5c300000-0000-0000-0000-000000000001';
SELECT ok((SELECT notify_sms AND remind_sms AND remind_sms_consent_at IS NOT NULL
             FROM public.event_registrations WHERE id = '5c400000-0000-0000-0000-000000000001'),
  'numer: zmiana samego formatu zostawia zgode');

UPDATE public.event_people SET phone = '600 100 201' WHERE id = '5c300000-0000-0000-0000-000000000001';
SELECT ok((SELECT NOT notify_sms AND NOT remind_sms AND remind_sms_consent_at IS NULL AND remind_sms_consent_via IS NULL
             FROM public.event_registrations WHERE id = '5c400000-0000-0000-0000-000000000001'),
  'REG-10: zmiana cyfr numeru zdejmuje notify_sms, remind_sms i stempel');
SELECT ok((SELECT remind_sms AND remind_sms_consent_at IS NOT NULL
             FROM public.event_registrations WHERE id = '5c400000-0000-0000-0000-000000000002'),
  'numer: zgloszenia innej osoby bez zmian');
SELECT ok((SELECT notify_email AND NOT remind_email
             FROM public.event_registrations WHERE id = '5c400000-0000-0000-0000-000000000001'),
  'numer: inne przelaczniki zostaja (tylko SMS wraca do zgody)');

UPDATE public.event_people SET phone = NULL WHERE id = '5c300000-0000-0000-0000-000000000002';
SELECT ok((SELECT NOT remind_sms AND remind_sms_consent_at IS NULL
             FROM public.event_registrations WHERE id = '5c400000-0000-0000-0000-000000000002'),
  'numer: usuniecie numeru zdejmuje zgode');

SELECT ok(
  pg_get_functiondef('public._event_reminder_candidates(timestamptz, text[], integer)'::regprocedure)
    LIKE '%r.notify_sms AND r.remind_sms AND r.remind_sms_consent_at IS NOT NULL%',
  'przypomnienia SMS czytaja ten sam stempel zgody co kanal transakcyjny');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_trigger
   WHERE tgrelid = 'public.event_people'::regclass
     AND tgname = 'event_people_phone_revokes_sms'
     AND tgfoid = 'public._tg_event_people_phone_revokes_sms()'::regprocedure),
  'trigger event_people_phone_revokes_sms na event_people');

SELECT set_config('request.headers', '', true);
SELECT * FROM finish();
ROLLBACK;
