-- pgTAP: PRZYPOMNIENIA UCZESTNIKA F2 NA PELNYM LANCUCHU MIGRACJI
-- (migracja 20261003140000_event_participant_reminders.sql).
--
-- Co dowodzi ten plik:
--   * glowne przypomnienie (run_event_reminders) idzie rodzajem 'event', wiec
--     obejmuje je przelacznik „Wydarzenia" (enabled_event), TTL 1 h push i
--     wykluczenie z digestu - zrodlo funkcji nie emituje juz 'content';
--   * ustawienia organizatora maja konsumenta: terminy (najmniejszy nalezny),
--     wylacznik przypomnien, przypomnienia o sesjach, SMS;
--   * preferencje zgloszenia (remind_email / remind_push / remind_sessions),
--     status i oplata biletu, zapis sprzed chwili terminu;
--   * same RSVP dostaja dzwonek, konto ze zgloszeniem nie dostaje dwoch;
--   * cisza nocna odracza dzwonek z wyprzedzeniem > 60 min, e-mail nie czeka;
--   * dziennik doreczen deduplikuje (drugi przebieg = 0), przesuniety start
--     daje nowy klucz, wpis failed wraca do partii;
--   * digest nie wybiera kandydata z samymi przypomnieniami i nie liczy ich
--     do limitu pozycji;
--   * ACL: nowe funkcje wylacznie dla service_role.
--
-- Czas: wszystkie chwile sa wzgledne wobec now() (stalej w transakcji).
-- Uruchamianie: `bun run test:pgtap-local all event_participant_reminders`.

BEGIN;
SELECT plan(44);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Fikstury ────────────────────────────────────────────────────────────────
INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('f6a00000-0000-0000-0000-0000000000aa', 'pf-reminders-a', 'PF Reminders A', 'pf-reminders-a.example');

INSERT INTO auth.users (id, email) VALUES
  ('f6000000-0000-0000-0000-000000000001', 'rem-holder@example.org'),
  ('f6000000-0000-0000-0000-000000000002', 'rem-rsvp@example.org'),
  ('f6000000-0000-0000-0000-000000000003', 'rem-muted@example.org'),
  ('f6000000-0000-0000-0000-000000000005', 'rem-signup-only@example.org'),
  ('f6000000-0000-0000-0000-000000000006', 'rem-night@example.org'),
  ('f6000000-0000-0000-0000-000000000007', 'rem-legacy@example.org'),
  ('f6000000-0000-0000-0000-000000000009', 'rem-digest-event@example.org'),
  ('f6000000-0000-0000-0000-000000000010', 'rem-digest-mixed@example.org');

INSERT INTO public.profiles (id, email, display_name, tenant_id)
SELECT u.id, u.email, split_part(u.email, '@', 1), 'f6a00000-0000-0000-0000-0000000000aa'
  FROM auth.users u
 WHERE u.id::text LIKE 'f6000000-%';

-- U3 wylaczyl rodzaj „Wydarzenia"; U9/U10 maja digest dzienny.
INSERT INTO public.notification_preferences (user_id, tenant_id, enabled_event, email_digest) VALUES
  ('f6000000-0000-0000-0000-000000000003', 'f6a00000-0000-0000-0000-0000000000aa', false, 'off'),
  ('f6000000-0000-0000-0000-000000000009', 'f6a00000-0000-0000-0000-0000000000aa', true, 'daily'),
  ('f6000000-0000-0000-0000-000000000010', 'f6a00000-0000-0000-0000-0000000000aa', true, 'daily');

-- Strefa, w ktorej jest TERAZ okolo 02:00 (cisza nocna), i ktora za 5 h bedzie
-- po 07:00 - asercje ciszy nie zaleza od godziny uruchomienia testu.
CREATE FUNCTION pg_temp.night_zone() RETURNS text LANGUAGE sql STABLE AS $fn$
  WITH h AS (SELECT extract(hour FROM now() AT TIME ZONE 'UTC')::int AS utc_hour),
       o AS (SELECT CASE WHEN ((2 - utc_hour + 24) % 24) > 12
                         THEN ((2 - utc_hour + 24) % 24) - 24
                         ELSE (2 - utc_hour + 24) % 24 END AS off FROM h)
  SELECT CASE WHEN off > 0 THEN 'Etc/GMT-' || off
              WHEN off < 0 THEN 'Etc/GMT+' || (-off)
              ELSE 'Etc/GMT' END
    FROM o;
$fn$;

-- E1: start za 30 min, domyslne terminy {1440, 60} -> nalezny wylacznie 60.
-- E2: start za 30 min, przypomnienia WYLACZONE przez organizatora.
-- E3: start za 30 min, jedyny termin 15 min -> jeszcze nienalezny.
-- E4: trwa (start wczoraj), sesja S1 za 10 min.
-- E5: start za 8 h w strefie nocnej, termin 600 min (> 60) -> cisza odracza dzwonek.
-- E6: start za 30 min, konto po starym skanerze (reminded_at po chwili terminu).
INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, timezone, status, location) VALUES
  ('f6100000-0000-0000-0000-000000000001', 'f6a00000-0000-0000-0000-0000000000aa',
   'rem-e1', 'Przypomnienia E1', 'Reminders E1', now() + interval '30 minutes', NULL, 'UTC', 'published', 'Sala A'),
  ('f6100000-0000-0000-0000-000000000002', 'f6a00000-0000-0000-0000-0000000000aa',
   'rem-e2', 'Przypomnienia E2', 'Reminders E2', now() + interval '30 minutes', NULL, 'UTC', 'published', NULL),
  ('f6100000-0000-0000-0000-000000000003', 'f6a00000-0000-0000-0000-0000000000aa',
   'rem-e3', 'Przypomnienia E3', 'Reminders E3', now() + interval '30 minutes', NULL, 'UTC', 'published', NULL),
  ('f6100000-0000-0000-0000-000000000004', 'f6a00000-0000-0000-0000-0000000000aa',
   'rem-e4', 'Kongres E4', 'Congress E4', now() - interval '1 day', now() + interval '1 day', 'UTC', 'published', NULL),
  ('f6100000-0000-0000-0000-000000000005', 'f6a00000-0000-0000-0000-0000000000aa',
   'rem-e5', 'Nocne E5', 'Night E5', now() + interval '8 hours', NULL, pg_temp.night_zone(), 'published', NULL),
  ('f6100000-0000-0000-0000-000000000006', 'f6a00000-0000-0000-0000-0000000000aa',
   'rem-e6', 'Przejscie E6', 'Transition E6', now() + interval '30 minutes', NULL, 'UTC', 'published', NULL);

INSERT INTO public.event_participant_settings
  (tenant_id, event_id, reminders_enabled, reminder_event_leads_minutes, reminder_sms_enabled) VALUES
  ('f6a00000-0000-0000-0000-0000000000aa', 'f6100000-0000-0000-0000-000000000001', true, '{1440,60}', true),
  ('f6a00000-0000-0000-0000-0000000000aa', 'f6100000-0000-0000-0000-000000000002', false, '{1440,60}', false),
  ('f6a00000-0000-0000-0000-0000000000aa', 'f6100000-0000-0000-0000-000000000003', true, '{15}', false),
  ('f6a00000-0000-0000-0000-0000000000aa', 'f6100000-0000-0000-0000-000000000005', true, '{600}', false);

INSERT INTO public.event_rooms (id, tenant_id, event_id, name) VALUES
  ('f6300000-0000-0000-0000-000000000001', 'f6a00000-0000-0000-0000-0000000000aa',
   'f6100000-0000-0000-0000-000000000004', 'Sala Kolumnowa');

INSERT INTO public.event_sessions (id, tenant_id, event_id, room_id, title_pl, title_en, starts_at, ends_at, status) VALUES
  ('f6200000-0000-0000-0000-000000000001', 'f6a00000-0000-0000-0000-0000000000aa',
   'f6100000-0000-0000-0000-000000000004', 'f6300000-0000-0000-0000-000000000001',
   'Panel otwarcia', 'Opening panel', now() + interval '10 minutes', now() + interval '70 minutes', 'published');

INSERT INTO public.event_people (id, tenant_id, user_id, email, phone, first_name, last_name) VALUES
  ('f6400000-0000-0000-0000-000000000001', 'f6a00000-0000-0000-0000-0000000000aa',
   'f6000000-0000-0000-0000-000000000001', 'rem-holder@example.org', NULL, 'Anna', 'Holder'),
  ('f6400000-0000-0000-0000-000000000002', 'f6a00000-0000-0000-0000-0000000000aa',
   NULL, 'rem-guest@example.org', NULL, 'Gosc', 'Bezkonta'),
  ('f6400000-0000-0000-0000-000000000003', 'f6a00000-0000-0000-0000-0000000000aa',
   'f6000000-0000-0000-0000-000000000003', 'rem-muted@example.org', NULL, 'Cicha', 'Osoba'),
  ('f6400000-0000-0000-0000-000000000004', 'f6a00000-0000-0000-0000-0000000000aa',
   NULL, 'rem-late@example.org', NULL, 'Spozniony', 'Zapis'),
  ('f6400000-0000-0000-0000-000000000005', 'f6a00000-0000-0000-0000-0000000000aa',
   NULL, 'rem-pending@example.org', NULL, 'Czeka', 'Decyzja'),
  ('f6400000-0000-0000-0000-000000000006', 'f6a00000-0000-0000-0000-0000000000aa',
   NULL, 'rem-optout@example.org', NULL, 'Bez', 'Przypomnien'),
  ('f6400000-0000-0000-0000-000000000007', 'f6a00000-0000-0000-0000-0000000000aa',
   NULL, 'rem-sms@example.org', '+48600100200', 'Sms', 'Zgoda'),
  ('f6400000-0000-0000-0000-000000000008', 'f6a00000-0000-0000-0000-0000000000aa',
   NULL, 'rem-disabled@example.org', NULL, 'Wylaczone', 'Wydarzenie'),
  ('f6400000-0000-0000-0000-000000000009', 'f6a00000-0000-0000-0000-0000000000aa',
   NULL, 'rem-early@example.org', NULL, 'Za', 'Wczesnie'),
  ('f6400000-0000-0000-0000-000000000010', 'f6a00000-0000-0000-0000-0000000000aa',
   'f6000000-0000-0000-0000-000000000006', 'rem-night@example.org', NULL, 'Nocny', 'Marek'),
  ('f6400000-0000-0000-0000-000000000011', 'f6a00000-0000-0000-0000-0000000000aa',
   'f6000000-0000-0000-0000-000000000007', 'rem-legacy@example.org', NULL, 'Stary', 'Skaner');

INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, registration_mode, status, payment_status, created_at,
   remind_email, remind_push, remind_sms, remind_sms_consent_at, remind_sms_consent_via) VALUES
  -- E1: konto (email + dzwonek)
  ('f6500000-0000-0000-0000-000000000001', 'f6a00000-0000-0000-0000-0000000000aa', 'f6100000-0000-0000-0000-000000000001',
   'f6400000-0000-0000-0000-000000000001', 'form', 'approved', 'not_required', now() - interval '2 days', true, true, false, NULL, NULL),
  -- E1: bez konta (tylko email)
  ('f6500000-0000-0000-0000-000000000002', 'f6a00000-0000-0000-0000-0000000000aa', 'f6100000-0000-0000-0000-000000000001',
   'f6400000-0000-0000-0000-000000000002', 'form', 'approved', 'paid', now() - interval '2 days', true, true, false, NULL, NULL),
  -- E1: konto z wylaczonym rodzajem event (dzwonek pominiety, email idzie)
  ('f6500000-0000-0000-0000-000000000003', 'f6a00000-0000-0000-0000-0000000000aa', 'f6100000-0000-0000-0000-000000000001',
   'f6400000-0000-0000-0000-000000000003', 'form', 'approved', 'not_required', now() - interval '2 days', true, true, false, NULL, NULL),
  -- E1: zapis 10 min temu, PO chwili terminu 60 min -> nic
  ('f6500000-0000-0000-0000-000000000004', 'f6a00000-0000-0000-0000-0000000000aa', 'f6100000-0000-0000-0000-000000000001',
   'f6400000-0000-0000-0000-000000000004', 'form', 'approved', 'not_required', now() - interval '10 minutes', true, true, false, NULL, NULL),
  -- E1: zgloszenie bez decyzji -> nic
  ('f6500000-0000-0000-0000-000000000005', 'f6a00000-0000-0000-0000-0000000000aa', 'f6100000-0000-0000-0000-000000000001',
   'f6400000-0000-0000-0000-000000000005', 'form', 'pending', 'not_required', now() - interval '2 days', true, true, false, NULL, NULL),
  -- E1: uczestnik wylaczyl e-mail i dzwonek -> nic
  ('f6500000-0000-0000-0000-000000000006', 'f6a00000-0000-0000-0000-0000000000aa', 'f6100000-0000-0000-0000-000000000001',
   'f6400000-0000-0000-0000-000000000006', 'form', 'approved', 'not_required', now() - interval '2 days', false, false, false, NULL, NULL),
  -- E1: SMS ze zgoda i numerem
  ('f6500000-0000-0000-0000-000000000007', 'f6a00000-0000-0000-0000-0000000000aa', 'f6100000-0000-0000-0000-000000000001',
   'f6400000-0000-0000-0000-000000000007', 'form', 'approved', 'not_required', now() - interval '2 days', true, false, true, now() - interval '2 days', 'token'),
  -- E2: przypomnienia wylaczone przez organizatora -> nic
  ('f6500000-0000-0000-0000-000000000008', 'f6a00000-0000-0000-0000-0000000000aa', 'f6100000-0000-0000-0000-000000000002',
   'f6400000-0000-0000-0000-000000000008', 'form', 'approved', 'not_required', now() - interval '2 days', true, true, false, NULL, NULL),
  -- E3: termin 15 min jeszcze nie nadszedl -> nic
  ('f6500000-0000-0000-0000-000000000009', 'f6a00000-0000-0000-0000-0000000000aa', 'f6100000-0000-0000-0000-000000000003',
   'f6400000-0000-0000-0000-000000000009', 'form', 'approved', 'not_required', now() - interval '2 days', true, true, false, NULL, NULL),
  -- E4: konto posiadacza (sesja z zakladki)
  ('f6500000-0000-0000-0000-000000000010', 'f6a00000-0000-0000-0000-0000000000aa', 'f6100000-0000-0000-0000-000000000004',
   'f6400000-0000-0000-0000-000000000001', 'form', 'approved', 'not_required', now() - interval '3 days', true, true, false, NULL, NULL),
  -- E5: konto w strefie nocnej
  ('f6500000-0000-0000-0000-000000000011', 'f6a00000-0000-0000-0000-0000000000aa', 'f6100000-0000-0000-0000-000000000005',
   'f6400000-0000-0000-0000-000000000010', 'form', 'approved', 'not_required', now() - interval '2 days', true, true, false, NULL, NULL),
  -- E6: konto po starym skanerze
  ('f6500000-0000-0000-0000-000000000012', 'f6a00000-0000-0000-0000-0000000000aa', 'f6100000-0000-0000-0000-000000000006',
   'f6400000-0000-0000-0000-000000000011', 'form', 'approved', 'not_required', now() - interval '2 days', true, true, false, NULL, NULL);

-- RSVP: samo RSVP (U2), projekcja RSVP posiadacza E1 (U1) i stary skaner (U7,
-- przypomnienie wyslane 10 min temu, czyli PO chwili terminu 60 min).
INSERT INTO public.event_rsvps (tenant_id, event_id, user_id, status, created_at, reminded_at) VALUES
  ('f6a00000-0000-0000-0000-0000000000aa', 'f6100000-0000-0000-0000-000000000001',
   'f6000000-0000-0000-0000-000000000002', 'going', now() - interval '2 days', NULL),
  ('f6a00000-0000-0000-0000-0000000000aa', 'f6100000-0000-0000-0000-000000000001',
   'f6000000-0000-0000-0000-000000000001', 'going', now() - interval '2 days', NULL),
  ('f6a00000-0000-0000-0000-0000000000aa', 'f6100000-0000-0000-0000-000000000006',
   'f6000000-0000-0000-0000-000000000007', 'going', now() - interval '2 days', now() - interval '10 minutes');

-- Plan sesji: zakladka posiadacza (wczoraj) i zapis konta BEZ biletu na E4.
INSERT INTO public.event_session_saves (tenant_id, event_id, session_id, user_id, created_at) VALUES
  ('f6a00000-0000-0000-0000-0000000000aa', 'f6100000-0000-0000-0000-000000000004',
   'f6200000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-000000000001', now() - interval '1 day');
INSERT INTO public.event_session_signups (tenant_id, event_id, session_id, user_id, status, registered_at) VALUES
  ('f6a00000-0000-0000-0000-0000000000aa', 'f6100000-0000-0000-0000-000000000004',
   'f6200000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-000000000005', 'registered', now() - interval '1 day');

-- ── 1-3. Zrodlo producenta: rodzaj 'event', nigdy 'content' ─────────────────
SELECT ok(
  pg_get_functiondef('public.run_event_reminders()'::regprocedure)
    ~ 'enqueue_notification\(\s*c\.user_id,\s*''event''',
  'run_event_reminders kolejkuje dzwonek rodzajem event (przelacznik Wydarzenia, TTL 1 h, poza digestem)');
SELECT ok(
  pg_get_functiondef('public.run_event_reminders()'::regprocedure) !~ '''content''',
  'run_event_reminders nie emituje juz rodzaju content');
SELECT ok(
  pg_get_functiondef('public.run_event_reminders()'::regprocedure)
    ~ '_event_reminder_candidates',
  'run_event_reminders czyta nalezne przypomnienia ze wspolnego skanera (ustawienia organizatora)');

-- ── 4-14. Dzwonki ───────────────────────────────────────────────────────────
SELECT is(public.run_event_reminders(), 3,
  'dzwonki: posiadacz E1, samo RSVP E1 i sesja z planu E4 (wylaczony rodzaj event pominiety)');

SELECT is(
  (SELECT count(*)::int FROM public.notifications n
    WHERE n.user_id::text LIKE 'f6000000-%' AND n.kind = 'content'),
  0, 'zaden dzwonek przypomnienia nie ma rodzaju content');

SELECT results_eq(
  $$SELECT n.href FROM public.notifications n
     WHERE n.user_id = 'f6000000-0000-0000-0000-000000000001' AND n.kind = 'event'
     ORDER BY n.href$$,
  ARRAY['/events/rem-e1',
        '/events/rem-e4/me?tab=schedule#event-session-f6200000-0000-0000-0000-000000000001'],
  'posiadacz dostaje JEDEN dzwonek o E1 (bez duplikatu przez projekcje RSVP) i jeden o sesji');

SELECT is(
  (SELECT n.icon FROM public.notifications n
    WHERE n.user_id = 'f6000000-0000-0000-0000-000000000002' AND n.kind = 'event'),
  'calendar-clock', 'samo RSVP dostaje dzwonek z ikona z listy kuratorskiej');

SELECT is(
  (SELECT count(*)::int FROM public.notifications n
    WHERE n.user_id = 'f6000000-0000-0000-0000-000000000003' AND n.kind = 'event'),
  0, 'enabled_event=false: przelacznik Wydarzenia tlumi przypomnienie');

SELECT is(
  (SELECT d.status || '/' || d.detail FROM public.event_message_deliveries d
    WHERE d.dedupe_key LIKE 'er:f6500000-0000-0000-0000-000000000003:inapp:%'),
  'skipped/not_enqueued', 'wyciszony dzwonek zostaje w dzienniku jako pominiety');

SELECT is(
  (SELECT array_agg(DISTINCT d.lead_minutes) FROM public.event_message_deliveries d
    WHERE d.event_id = 'f6100000-0000-0000-0000-000000000001'),
  ARRAY[60], 'nalezny tylko najmniejszy termin (60), bez zaleglego 1440');

SELECT ok(
  (SELECT bool_and(v.reminded_at IS NOT NULL) FROM public.event_rsvps v
    WHERE v.event_id = 'f6100000-0000-0000-0000-000000000001'),
  'wyslany dzwonek stempluje event_rsvps.reminded_at (samo RSVP i projekcja posiadacza)');

SELECT is(public.run_event_reminders(), 0, 'drugi przebieg nie wysyla nic (dziennik deduplikuje)');

SELECT is(
  (SELECT count(*)::int FROM public.event_message_deliveries d
    WHERE d.event_id IN ('f6100000-0000-0000-0000-000000000002', 'f6100000-0000-0000-0000-000000000003')),
  0, 'wylaczone przypomnienia (E2) i nienalezny termin (E3) nie daja wpisow');

SELECT is(
  (SELECT count(*)::int FROM public.event_message_deliveries d
    WHERE d.registration_id IN ('f6500000-0000-0000-0000-000000000004',
                                'f6500000-0000-0000-0000-000000000005',
                                'f6500000-0000-0000-0000-000000000006')),
  0, 'zapis po chwili terminu, zgloszenie bez decyzji i uczestnik bez kanalow - bez wpisow');

SELECT is(
  (SELECT count(*)::int FROM public.event_message_deliveries d
    WHERE d.user_id = 'f6000000-0000-0000-0000-000000000005'),
  0, 'zapis na sesje bez biletu na wydarzenie nie daje przypomnienia o sesji');

-- ── 15-16. Cisza nocna ──────────────────────────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM public.event_message_deliveries d
    WHERE d.event_id = 'f6100000-0000-0000-0000-000000000005' AND d.channel = 'inapp'),
  0, 'cisza nocna odracza dzwonek z wyprzedzeniem > 60 min');
SELECT is(
  (SELECT count(*)::int FROM public._event_reminder_candidates(now() + interval '5 hours', ARRAY['inapp'], 100) k
    WHERE k.event_id = 'f6100000-0000-0000-0000-000000000005'),
  1, 'odroczony dzwonek wraca po 07:00 czasu wydarzenia (odroczenie, nie utrata)');

-- ── 17. Przejscie ze starego skanera ────────────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM public.event_message_deliveries d
    WHERE d.event_id = 'f6100000-0000-0000-0000-000000000006' AND d.channel = 'inapp'),
  0, 'konto przypomniane przez stary skaner po chwili terminu nie dostaje drugiego dzwonka');

-- ── 18-27. Partia e-mail/SMS zadania F2 ─────────────────────────────────────
CREATE TEMP TABLE claim1 ON COMMIT DROP AS
  SELECT x FROM jsonb_array_elements(public._event_reminders_claim(50, false)) AS x;

SELECT is(
  (SELECT array_agg(x->>'dedupe_key' ORDER BY x->>'dedupe_key') FROM claim1),
  ARRAY(SELECT k FROM unnest(ARRAY[
    'er:f6500000-0000-0000-0000-000000000001:email:60:' || floor(extract(epoch FROM now() + interval '30 minutes'))::bigint,
    'er:f6500000-0000-0000-0000-000000000002:email:60:' || floor(extract(epoch FROM now() + interval '30 minutes'))::bigint,
    'er:f6500000-0000-0000-0000-000000000003:email:60:' || floor(extract(epoch FROM now() + interval '30 minutes'))::bigint,
    'er:f6500000-0000-0000-0000-000000000007:email:60:' || floor(extract(epoch FROM now() + interval '30 minutes'))::bigint,
    'er:f6500000-0000-0000-0000-000000000011:email:600:' || floor(extract(epoch FROM now() + interval '8 hours'))::bigint,
    'er:f6500000-0000-0000-0000-000000000012:email:60:' || floor(extract(epoch FROM now() + interval '30 minutes'))::bigint,
    'sr:f6200000-0000-0000-0000-000000000001:f6000000-0000-0000-0000-000000000001:email:15:'
      || floor(extract(epoch FROM now() + interval '10 minutes'))::bigint]) AS k ORDER BY k),
  'partia e-mail: E1 (bez spoznionego, bez decyzji, bez wypisanego), noc E5 (e-mail nie czeka), E6 i sesja');

SELECT ok(
  (SELECT bool_and((x->>'delivery_id') IS NOT NULL AND x->>'channel' = 'email') FROM claim1),
  'kazda pozycja niesie identyfikator rezerwacji i kanal email');

SELECT is(
  (SELECT count(*)::int FROM public.event_message_deliveries d
    WHERE d.id IN (SELECT (x->>'delivery_id')::uuid FROM claim1) AND d.status = 'claimed'),
  7, 'pozycje partii sa zarezerwowane w dzienniku (status claimed)');

SELECT is(
  (SELECT x->>'phone' FROM claim1
    WHERE x->>'registration_id' = 'f6500000-0000-0000-0000-000000000007'),
  NULL, 'numer telefonu nie wychodzi z partii dla kanalu email');

SELECT is(
  (SELECT (x->>'event_title_pl') || '|' || (x->>'event_location') || '|' || (x->>'event_timezone') || '|' || (x->>'lang')
     FROM claim1 WHERE x->>'registration_id' = 'f6500000-0000-0000-0000-000000000001' AND x->>'kind' = 'event_reminder'),
  'Przypomnienia E1|Sala A|UTC|pl', 'pozycja wydarzenia niesie tytul, miejsce, strefe i jezyk odbiorcy');

SELECT is(
  (SELECT (x->>'session_title_pl') || '|' || (x->>'room_name') || '|' || (x->>'event_slug')
     FROM claim1 WHERE x->>'kind' = 'session_reminder'),
  'Panel otwarcia|Sala Kolumnowa|rem-e4', 'pozycja sesji niesie tytul sesji, sale i adres wydarzenia');

SELECT is(jsonb_array_length(public._event_reminders_claim(50, false)), 0,
  'druga partia jest pusta - zarezerwowanych nie bierze ponownie');

CREATE TEMP TABLE claim_sms ON COMMIT DROP AS
  SELECT x FROM jsonb_array_elements(public._event_reminders_claim(50, true)) AS x;

SELECT is(
  (SELECT string_agg((x->>'channel') || ':' || (x->>'registration_id') || ':' || (x->>'phone'), ',') FROM claim_sms),
  'sms:f6500000-0000-0000-0000-000000000007:+48600100200',
  'SMS tylko przy wlaczonym kanale, zgodzie uczestnika i ustawieniu organizatora; numer tylko dla sms');

SELECT is(
  (SELECT count(*)::int FROM public.event_message_deliveries d
    WHERE d.registration_id = 'f6500000-0000-0000-0000-000000000011' AND d.channel = 'sms'),
  0, 'SMS nie wychodzi bez ustawienia organizatora (E5)');

-- ── 28-33. Zamkniecie partii jednym RPC ─────────────────────────────────────
SELECT throws_ok(
  $$SELECT public._event_delivery_confirm_many('{"id":"x"}'::jsonb)$$,
  'P0001', 'invalid_payload: items must be a JSON array',
  'confirm_many: ladunek musi byc tablica');

SELECT throws_ok(
  format($$SELECT public._event_delivery_confirm_many('[{"id":"%s","status":"sent"},{"id":"zle","status":"sent"}]'::jsonb)$$,
         (SELECT x->>'delivery_id' FROM claim1 LIMIT 1)),
  'P0001', 'invalid_payload: each item needs id (uuid) and status sent|skipped|failed',
  'confirm_many: zly element odrzuca CALA partie');

SELECT is(
  (SELECT count(*)::int FROM public.event_message_deliveries d
    WHERE d.id IN (SELECT (x->>'delivery_id')::uuid FROM claim1) AND d.status = 'claimed'),
  7, 'po odrzuconej partii zaden wpis nie zostal zamkniety');

SELECT is(
  public._event_delivery_confirm_many((
    SELECT jsonb_agg(jsonb_build_object(
             'id', x->>'delivery_id',
             'status', CASE WHEN x->>'registration_id' = 'f6500000-0000-0000-0000-000000000002'
                            THEN 'failed' ELSE 'sent' END,
             'detail', CASE WHEN x->>'registration_id' = 'f6500000-0000-0000-0000-000000000002'
                            THEN 'send_error' END))
      FROM claim1)),
  7, 'confirm_many zamyka cala partie jednym wywolaniem');

SELECT is(
  (SELECT count(*)::int FROM public.event_message_deliveries d
    WHERE d.id IN (SELECT (x->>'delivery_id')::uuid FROM claim1) AND d.status = 'sent' AND d.sent_at IS NOT NULL),
  6, 'wpisy sent maja stempel sent_at');

SELECT is(
  (SELECT string_agg((x->>'registration_id') || ':' || (x->>'channel'), ',')
     FROM jsonb_array_elements(public._event_reminders_claim(50, false)) AS x),
  'f6500000-0000-0000-0000-000000000002:email',
  'wpis failed wraca do kolejnej partii (proba < 3)');

-- ── 34. Przesuniety start = nowe przypomnienie ──────────────────────────────
UPDATE public.events SET starts_at = starts_at + interval '5 minutes'
 WHERE id = 'f6100000-0000-0000-0000-000000000001';
SELECT is(
  (SELECT count(*)::int FROM public._event_reminder_candidates(now(), ARRAY['email'], 100) k
    WHERE k.registration_id = 'f6500000-0000-0000-0000-000000000001'),
  1, 'przesuniety start wydarzenia daje nowy klucz i ponowne przypomnienie');

-- ── 35-38. Digest bez przypomnien ───────────────────────────────────────────
-- Powitalne powiadomienia kont z fikstury (trigger profilu) sa tu szumem.
UPDATE public.notifications SET read_at = now()
 WHERE user_id IN ('f6000000-0000-0000-0000-000000000009', 'f6000000-0000-0000-0000-000000000010');
INSERT INTO public.notifications (user_id, tenant_id, kind, title_pl, title_en, href) VALUES
  ('f6000000-0000-0000-0000-000000000009', 'f6a00000-0000-0000-0000-0000000000aa', 'event', 'Przypomnienie', 'Reminder', '/events/x'),
  ('f6000000-0000-0000-0000-000000000010', 'f6a00000-0000-0000-0000-0000000000aa', 'event', 'Przypomnienie', 'Reminder', '/events/y'),
  ('f6000000-0000-0000-0000-000000000010', 'f6a00000-0000-0000-0000-0000000000aa', 'content', 'Nowy wpis', 'New post', '/p/z');

CREATE TEMP TABLE digests ON COMMIT DROP AS
  SELECT d.* FROM public.claim_due_digests('daily', 200) d
   WHERE d.user_id IN ('f6000000-0000-0000-0000-000000000009', 'f6000000-0000-0000-0000-000000000010');

SELECT is(
  (SELECT array_agg(user_id::text ORDER BY user_id) FROM digests),
  ARRAY['f6000000-0000-0000-0000-000000000010'],
  'digest: konto z samymi przypomnieniami nie jest kandydatem');
SELECT is(
  (SELECT np.digest_last_sent_at FROM public.notification_preferences np
    WHERE np.user_id = 'f6000000-0000-0000-0000-000000000009'),
  NULL, 'digest: konto z samymi przypomnieniami nie traci okna digestu');
SELECT is(
  (SELECT jsonb_path_query_array(items, '$[*].kind') FROM digests
    WHERE user_id = 'f6000000-0000-0000-0000-000000000010'),
  '["content"]'::jsonb, 'digest: przypomnienie nie zajmuje miejsca w pozycjach');
SELECT ok(
  pg_get_functiondef('public.claim_due_digests(text,integer)'::regprocedure) ~ 'pg_temp',
  'claim_due_digests: search_path z pg_temp');

-- ── 39-44. ACL: wylacznie service_role ──────────────────────────────────────
SELECT ok(NOT has_function_privilege('authenticated', 'public._event_reminder_candidates(timestamptz,text[],integer)', 'EXECUTE'),
  'authenticated nie wykona _event_reminder_candidates');
SELECT ok(NOT has_function_privilege('authenticated', 'public._event_reminders_claim(integer,boolean)', 'EXECUTE'),
  'authenticated nie wykona _event_reminders_claim');
SELECT ok(NOT has_function_privilege('anon', 'public._event_delivery_confirm_many(jsonb)', 'EXECUTE'),
  'anon nie wykona _event_delivery_confirm_many');
SELECT ok(NOT has_function_privilege('authenticated', 'public.run_event_reminders()', 'EXECUTE'),
  'authenticated nie wykona run_event_reminders');
SELECT ok(
  has_function_privilege('service_role', 'public._event_reminders_claim(integer,boolean)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._event_delivery_confirm_many(jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.run_event_reminders()', 'EXECUTE'),
  'service_role wykonuje funkcje zadania F2');
SELECT ok(
  (SELECT bool_and(p.proconfig::text ~ 'pg_temp') FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('_event_reminder_candidates', '_event_reminders_claim',
                       '_event_delivery_confirm_many', 'run_event_reminders')),
  'nowe funkcje SECURITY DEFINER maja search_path z pg_temp');

SELECT * FROM finish();
ROLLBACK;
