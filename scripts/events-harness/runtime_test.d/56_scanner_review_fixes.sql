-- ============================================================================
-- 56_scanner_review_fixes - SKANER: POPRAWKI PO PRZEGLADZIE UTWARDZENIA
--
-- PO CO TEN PLIK ISTNIEJE
-- Migracje 20261013111000 .. 20261013111300 zamykaja potwierdzone ustalenia
-- przegladu 20261013110500 .. 20261013110900. Kazde ma tu swoj dowod:
--   R0/R11  stary klient (bez znacznika kolejki) po terminie na urzadzeniu,
--           ktore nigdy nie zadeklarowalo nowego klienta -> przyjety; urzadzenie
--           z deklaracja (client_caps albo wazny znacznik) bez znacznika ->
--           device_expired, ze znacznikiem -> przyjety; deklaracji nie da sie
--           cofnac;
--   R4      skan z kolejki kodu zastapionego PO chwili skanu jest zapisem kodu
--           waznego (wiersz, obecnosc, polityka deny dziala dalej); kod martwy
--           juz w chwili skanu, a wpuszczony offline, zostawia prawdziwa odmowe
--           denied_code_superseded (konflikt admitted_offline). Od F4
--           (20261013112000) czas skanu musi potwierdzic znacznik kolejki
--           urzadzenia - skany z kolejki w sekcji 3 go niosa; czasy
--           podrobione sprawdza 57_scanner_final_fixes.sql;
--   R5      identyfikator zapisu oczekujacego bez biletu nie przezywa
--           anulowania (code_superseded, nie granted);
--   R6      in -> out -> in (w oknie) -> in przy deny: trzecie to NOWE wejscie,
--           czwarte - denied_already_inside; EXCLUDE dalej odbija druga zgode
--           tego samego przejscia;
--   R7      klon edycji kopiuje reentry_policy;
--   R8      bramka tylko-wejscie z deny: wejscie drugiego dnia (czas
--           wydarzenia) przechodzi, drugie tego samego dnia nie; odprawa
--           reczna na stanowisku jawnie obchodzi odmowe (reentry_override);
--   R9      skan z kolejki nie odbija sie od POZNIEJSZEGO wejscia: zgoda +
--           konflikt double_entry, ktory znika, gdy dotrze wyjscie; wynik nie
--           zalezy od kolejnosci synchronizacji;
--   R10     usuniecie konta pracownika, ktory odprawial, drukowal i skanowal
--           lead, przechodzi, a wiersze historii zostaja; rejestr kluczy
--           obcych SET NULL, ktorych kolumna stoi w CHECK-u;
--   R12     100 nieznanych kodow z kolejki blokuje SAMA kolejke - skan na zywo
--           dziala dalej; wznowienie zdejmuje blokade kolejki;
--   panel   admin_event_scanner_devices_list oddaje liczniki i stan kolejki.
--
-- CZEGO TEN PLIK NIE SPRAWDZA
--   * klienta skanera (lustro reguly offline, przechowywanie znacznika) - tor B1;
--   * przyciecia istniejacych danych w migracji (pusta baza replayu).
--
-- CZAS. now() jest w transakcji stale. Wydarzenia tego pliku dostaja strefe
-- o stalym przesunieciu, w ktorej TERAZ jest okolo poludnia - granica dnia
-- (polnoc czasu wydarzenia, R8) jest wiec deterministyczna niezaleznie od
-- godziny przebiegu.
--
-- SPRZATANIE. Caly plik pracuje w JEDNEJ transakcji zakonczonej ROLLBACK-iem.
-- ============================================================================

\echo '== 56 poprawki skanera po przegladzie: R0..R12 =='

BEGIN;

-- ---------------------------------------------------------------------------
-- SEKCJA 0: SCENOGRAFIA
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('56a00000-0000-0000-0000-0000000000a1', 'b2.admin@example.org'),
  ('56a00000-0000-0000-0000-0000000000a5', 'b2.staff@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('56a00000-0000-0000-0000-0000000000a1', 'admin', '11111111-1111-1111-1111-111111111111'),
  ('56a00000-0000-0000-0000-0000000000a5', 'admin', '11111111-1111-1111-1111-111111111111')
ON CONFLICT DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, display_name, slug) VALUES
  ('56a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Admin 56', 'b2-admin-56'),
  ('56a00000-0000-0000-0000-0000000000a5', '11111111-1111-1111-1111-111111111111', 'Stefan Stanowisko', 'b2-staff-56')
ON CONFLICT (id) DO NOTHING;

CREATE TEMP TABLE b2_ctx (k text PRIMARY KEY, v text) ON COMMIT DROP;
INSERT INTO b2_ctx VALUES ('tz', (
  SELECT CASE WHEN s.o >= 0 THEN 'Etc/GMT-' || s.o ELSE 'Etc/GMT+' || (-s.o) END
  FROM (SELECT 12 - extract(hour FROM now() AT TIME ZONE 'UTC')::integer AS o) s));

INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, status,
   registration_mode, registration_flow, timezone)
VALUES
  ('56e00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'b2-56-a', 'Kongres 56', 'Congress 56', now() - interval '2 days', now() + interval '1 day',
   'published', 'rsvp', 'instant', (SELECT v FROM b2_ctx WHERE k = 'tz')),
  ('56e00000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111',
   'b2-56-klon-zrodlo', 'Edycja 2026', 'Edition 2026', now() + interval '10 days', NULL,
   'published', 'rsvp', 'instant', (SELECT v FROM b2_ctx WHERE k = 'tz')),
  ('56e00000-0000-0000-0000-0000000000b2', '11111111-1111-1111-1111-111111111111',
   'b2-56-klon-cel', 'Edycja 2027', 'Edition 2027', now() + interval '375 days', NULL,
   'draft', 'rsvp', 'instant', (SELECT v FROM b2_ctx WHERE k = 'tz'))
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.crm_companies (id, tenant_id, name) VALUES
  ('56f00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Firma 56')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_sponsors (id, tenant_id, event_id, company_id, snapshot_name) VALUES
  ('56500000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '56e00000-0000-0000-0000-0000000000a1', '56f00000-0000-0000-0000-0000000000a1', 'Sponsor 56')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_badge_templates (id, tenant_id, event_id, name, is_default) VALUES
  ('56b00000-0000-0000-0000-0000000000f1', '11111111-1111-1111-1111-111111111111',
   '56e00000-0000-0000-0000-0000000000a1', 'Szablon 56', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_checkpoints
  (id, tenant_id, event_id, name_pl, name_en, kind, direction_mode, access_mode,
   reentry_policy, dedupe_window_seconds)
VALUES
  ('56c00000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111',
   '56e00000-0000-0000-0000-0000000000a1', 'Brama R6', 'Gate R6',
   'event_entry', 'in_out', 'control', 'deny', 60),
  ('56c00000-0000-0000-0000-0000000000c2', '11111111-1111-1111-1111-111111111111',
   '56e00000-0000-0000-0000-0000000000a1', 'Bramka dzienna', 'Daily turnstile',
   'event_entry', 'in_only', 'control', 'deny', 60),
  ('56c00000-0000-0000-0000-0000000000c3', '11111111-1111-1111-1111-111111111111',
   '56e00000-0000-0000-0000-0000000000a1', 'Brama R9', 'Gate R9',
   'event_entry', 'in_out', 'control', 'deny', 60),
  ('56c00000-0000-0000-0000-0000000000c4', '11111111-1111-1111-1111-111111111111',
   '56e00000-0000-0000-0000-0000000000a1', 'Brama R4', 'Gate R4',
   'event_entry', 'in_out', 'control', 'deny', 60),
  ('56c00000-0000-0000-0000-0000000000c5', '11111111-1111-1111-1111-111111111111',
   '56e00000-0000-0000-0000-0000000000a1', 'Brama ogolna', 'General gate',
   'event_entry', 'in_only', 'control', 'allow', 60),
  ('56c00000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111',
   '56e00000-0000-0000-0000-0000000000b1', 'Wejscie bez powrotu', 'No re-entry gate',
   'event_entry', 'in_only', 'control', 'deny', 90),
  ('56c00000-0000-0000-0000-0000000000b2', '11111111-1111-1111-1111-111111111111',
   '56e00000-0000-0000-0000-0000000000b1', 'Wejscie z powrotem', 'Re-entry gate',
   'event_entry', 'in_out', 'control', 'allow', 60)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_people (id, tenant_id, first_name, last_name, email, source) VALUES
  ('56700000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Rafal', 'Wraca', 'r6@example.org', 'organizer'),
  ('56700000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Dagmara', 'Dwudniowa', 'r8a@example.org', 'organizer'),
  ('56700000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Mikolaj', 'Polnoc', 'r8b@example.org', 'organizer'),
  ('56700000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Oskar', 'Obejscie', 'r8c@example.org', 'organizer'),
  ('56700000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Wiktor', 'Kolejka', 'r9a@example.org', 'organizer'),
  ('56700000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Wanda', 'Odwrotnie', 'r9b@example.org', 'organizer'),
  ('56700000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'Olga', 'Przedruk', 'r4a@example.org', 'organizer'),
  ('56700000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'Zenon', 'Martwy', 'r4b@example.org', 'organizer'),
  ('56700000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'Piotr', 'Anulowany', 'r5a@example.org', 'organizer'),
  ('56700000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Hanna', 'Stary', 'r0@example.org', 'organizer'),
  ('56700000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Beata', 'Stanowisko', 'r10@example.org', 'organizer'),
  ('56700000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'Kamil', 'Nazywo', 'r12@example.org', 'organizer'),
  ('56700000-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111', 'Daria', 'Import', 'r5b@example.org', 'organizer')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, status, registration_mode, qr_token_hash, qr_issued_at)
SELECT ('56300000-0000-0000-0000-0000000000' || x.n)::uuid, '11111111-1111-1111-1111-111111111111',
       '56e00000-0000-0000-0000-0000000000a1', ('56700000-0000-0000-0000-0000000000' || x.n)::uuid,
       'approved', 'rsvp', encode(extensions.digest('qr56-osoba-' || x.n || '-000001', 'sha256'), 'hex'), now()
FROM (VALUES ('01'), ('02'), ('03'), ('04'), ('05'), ('06'), ('07'), ('08'), ('0a'), ('0b'), ('0c')) AS x(n)
ON CONFLICT (id) DO NOTHING;

-- R5: zapis OCZEKUJACY bez biletu (preprint identyfikatorow przed decyzja).
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, status, registration_mode)
VALUES
  ('56300000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111',
   '56e00000-0000-0000-0000-0000000000a1', '56700000-0000-0000-0000-000000000009',
   'pending', 'rsvp')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_scanner_devices
  (id, tenant_id, event_id, sponsor_id, label, token_hash, token_prefix,
   scopes, is_active, expires_at, offline_roster)
VALUES
  ('56d00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '56e00000-0000-0000-0000-0000000000a1', NULL, 'Brama 1',
   encode(extensions.digest('tok56-brama-00000001', 'sha256'), 'hex'), 'tok56-b1',
   ARRAY['checkin']::text[], true, now() + interval '2 days', true),
  ('56d00000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '56e00000-0000-0000-0000-0000000000a1', NULL, 'Brama 2',
   encode(extensions.digest('tok56-brama-00000002', 'sha256'), 'hex'), 'tok56-b2',
   ARRAY['checkin']::text[], true, now() + interval '2 days', false),
  ('56d00000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   '56e00000-0000-0000-0000-0000000000a1', NULL, 'Stary klient - wygasle',
   encode(extensions.digest('tok56-starywyg-00001', 'sha256'), 'hex'), 'tok56-sw',
   ARRAY['checkin']::text[], true, now() - interval '1 hour', false),
  ('56d00000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   '56e00000-0000-0000-0000-0000000000a1', '56500000-0000-0000-0000-0000000000a1',
   'Stoisko stary klient - wygasle',
   encode(extensions.digest('tok56-stoiskowyg-001', 'sha256'), 'hex'), 'tok56-lw',
   ARRAY['lead']::text[], true, now() - interval '1 hour', false),
  ('56d00000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   '56e00000-0000-0000-0000-0000000000a1', NULL, 'Nowy klient',
   encode(extensions.digest('tok56-nowyklient-001', 'sha256'), 'hex'), 'tok56-nk',
   ARRAY['checkin']::text[], true, now() + interval '2 days', false),
  ('56d00000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
   '56e00000-0000-0000-0000-0000000000a1', NULL, 'Znacznik z kolejki',
   encode(extensions.digest('tok56-znacznik-00001', 'sha256'), 'hex'), 'tok56-zk',
   ARRAY['checkin']::text[], true, now() + interval '2 days', false),
  ('56d00000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111',
   '56e00000-0000-0000-0000-0000000000a1', NULL, 'Stary klient - dawno wygasle',
   encode(extensions.digest('tok56-dawnowyg-00001', 'sha256'), 'hex'), 'tok56-dw',
   ARRAY['checkin']::text[], true, now() - interval '80 hours', false),
  ('56d00000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111',
   '56e00000-0000-0000-0000-0000000000a1', NULL, 'Kolejka R12',
   encode(extensions.digest('tok56-kolejka-000001', 'sha256'), 'hex'), 'tok56-kr',
   ARRAY['checkin']::text[], true, now() + interval '2 days', false),
  ('56d00000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111',
   '56e00000-0000-0000-0000-0000000000a1', '56500000-0000-0000-0000-0000000000a1', 'Stoisko 56',
   encode(extensions.digest('tok56-stoisko-000001', 'sha256'), 'hex'), 'tok56-st',
   ARRAY['lead']::text[], true, now() + interval '2 days', false)
ON CONFLICT (id) DO NOTHING;

CREATE TEMP TABLE b2_codes (k text PRIMARY KEY, v text) ON COMMIT DROP;

-- ---------------------------------------------------------------------------
-- SEKCJA 1 (R0/R11): ZNACZNIK KOLEJKI - SCIEZKA PRZEJSCIOWA I DEKLARACJA
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.act_as(NULL, NULL);

  -- Dokladnie ten ladunek, ktory buduje dzisiejszy scannerApi: queued, czas
  -- skanu sprzed terminu, BEZ queue_marker.
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-starywyg-00001', 'code', 'qr56-osoba-0a-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c5', 'direction', 'in',
    'client_scan_uid', 'scan56-r0-stary-01',
    'device_scanned_at', now() - interval '2 hours', 'queued', true));
  PERFORM pg_temp.assert(v->>'outcome' = 'granted' AND v->'person' = 'null'::jsonb
      AND NOT (v ? 'queue_marker'),
    '56/R0 GOTOWE: stary klient po terminie (urzadzenie bez deklaracji) - skan z kolejki BEZ znacznika przyjety sciezka przejsciowa, bez karty osoby');

  v := public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok56-stoiskowyg-001', 'code', 'qr56-osoba-0a-000001',
    'device_scanned_at', now() - interval '2 hours', 'queued', true));
  PERFORM pg_temp.assert(v->>'outcome' = 'saved' AND v->'person' = 'null'::jsonb,
    '56/R0: stary klient stoiska po terminie - lead z kolejki BEZ znacznika przyjety');

  PERFORM pg_temp.assert(
    (SELECT queue_marker_required_at IS NULL FROM public.event_scanner_devices
      WHERE id = '56d00000-0000-0000-0000-000000000003'),
    '56/R0: skan starego klienta NIE przestawia urzadzenia na scisla regule');
END $$;

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-starywyg-00001', 'code', 'qr56-osoba-0a-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c5',
    'device_scanned_at', now() - interval '2 hours', 'queued', true,
    'queue_marker', repeat('A', 54)))
$q$, 'device_expired',
  '56/R0: ladunek z PODROBIONYM znacznikiem nie korzysta ze sciezki przejsciowej -> device_expired');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-starywyg-00001', 'code', 'qr56-osoba-0a-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c5',
    'device_scanned_at', now() - interval '2 hours'))
$q$, 'device_expired',
  '56/R0: sciezka przejsciowa nie otwiera skanu NA ZYWO po terminie');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-starywyg-00001', 'code', 'qr56-osoba-0a-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c5',
    'device_scanned_at', now() - interval '10 minutes', 'queued', true))
$q$, 'device_expired',
  '56/R0: sciezka przejsciowa nie przyjmuje skanu z chwili PO terminie');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-dawnowyg-00001', 'code', 'qr56-osoba-0a-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c5',
    'device_scanned_at', now() - interval '81 hours', 'queued', true))
$q$, 'device_expired',
  '56/R0: sciezka przejsciowa konczy sie 72 h po terminie');

-- Deklaracja nowego klienta w bootstrapie, ktorej nie da sie cofnac.
DO $$
DECLARE v jsonb; v_dev public.event_scanner_devices;
BEGIN
  PERFORM pg_temp.act_as(NULL, NULL);

  v := public.event_scanner_bootstrap(jsonb_build_object('device_token', 'tok56-brama-00000002'));
  PERFORM pg_temp.assert(NOT (v->>'queue_marker_required')::boolean
      AND (SELECT queue_marker_required_at IS NULL FROM public.event_scanner_devices
            WHERE id = '56d00000-0000-0000-0000-000000000002'),
    '56/R11: bootstrap BEZ client_caps (stary klient) nie przestawia urzadzenia i mowi queue_marker_required = false');

  v := public.event_scanner_bootstrap(jsonb_build_object(
    'device_token', 'tok56-nowyklient-001', 'client_caps', jsonb_build_array('queue_marker', 'roster_badge')));
  SELECT * INTO v_dev FROM public.event_scanner_devices WHERE id = '56d00000-0000-0000-0000-000000000005';
  PERFORM pg_temp.assert((v->>'queue_marker_required')::boolean
      AND v_dev.queue_marker_required_at = now(),
    '56/R11: bootstrap z client_caps ["queue_marker"] przestawia urzadzenie na scisla regule i to oglasza');

  v := public.event_scanner_bootstrap(jsonb_build_object(
    'device_token', 'tok56-nowyklient-001', 'client_caps', '[]'::jsonb));
  PERFORM pg_temp.assert((v->>'queue_marker_required')::boolean
      AND (SELECT queue_marker_required_at = now() FROM public.event_scanner_devices
            WHERE id = '56d00000-0000-0000-0000-000000000005'),
    '56/R11: deklaracji nie da sie cofnac ladunkiem bez client_caps (brak obnizenia)');

  -- Lista offline tez przyjmuje deklaracje.
  v := public.event_scanner_roster(jsonb_build_object(
    'device_token', 'tok56-brama-00000001', 'client_caps', jsonb_build_array('queue_marker')));
  PERFORM pg_temp.assert((v->>'queue_marker_required')::boolean
      AND (SELECT queue_marker_required_at IS NOT NULL FROM public.event_scanner_devices
            WHERE id = '56d00000-0000-0000-0000-000000000001'),
    '56/R11: lista offline z client_caps ["queue_marker"] przestawia urzadzenie i to oglasza');

  -- Termin mija (scenariusz: wydarzenie sie skonczylo, kolejka czeka).
  INSERT INTO b2_codes VALUES ('marker_d5', public._event_scanner_queue_marker(
    v_dev.id, v_dev.queue_secret, now() - interval '3 hours'));
  UPDATE public.event_scanner_devices SET expires_at = now() - interval '1 hour'
   WHERE id = '56d00000-0000-0000-0000-000000000005';
END $$;

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-nowyklient-001', 'code', 'qr56-osoba-0a-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c5',
    'device_scanned_at', now() - interval '2 hours', 'queued', true))
$q$, 'device_expired',
  '56/R11 GOTOWE: urzadzenie z deklaracja - skan z kolejki BEZ znacznika po terminie -> device_expired');

DO $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.act_as(NULL, NULL);
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-nowyklient-001', 'code', 'qr56-osoba-0c-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c5',
    'client_scan_uid', 'scan56-r11-marker-01',
    'device_scanned_at', now() - interval '2 hours', 'queued', true,
    'queue_marker', (SELECT k.v FROM b2_codes k WHERE k.k = 'marker_d5')));
  PERFORM pg_temp.assert(v->>'outcome' = 'granted' AND v->'person' = 'null'::jsonb,
    '56/R11 GOTOWE: urzadzenie z deklaracja - skan z kolejki ZE znacznikiem sprzed terminu przyjety');
END $$;

-- Deklaracja przez WAZNY znacznik w skanie z kolejki (przed terminem).
DO $$
DECLARE v jsonb; v_dev public.event_scanner_devices;
BEGIN
  PERFORM pg_temp.act_as(NULL, NULL);
  SELECT * INTO v_dev FROM public.event_scanner_devices WHERE id = '56d00000-0000-0000-0000-000000000006';
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-znacznik-00001', 'code', 'qr56-osoba-0c-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c5',
    'client_scan_uid', 'scan56-r11-queue-01',
    'device_scanned_at', now() - interval '5 minutes', 'queued', true,
    'queue_marker', public._event_scanner_queue_marker(v_dev.id, v_dev.queue_secret, now() - interval '10 minutes')));
  PERFORM pg_temp.assert(v->>'outcome' IN ('granted', 'repeat')
      AND (SELECT queue_marker_required_at = now() FROM public.event_scanner_devices
            WHERE id = '56d00000-0000-0000-0000-000000000006'),
    '56/R11: skan z kolejki z WAZNYM znacznikiem przestawia urzadzenie na scisla regule');

  UPDATE public.event_scanner_devices SET expires_at = now() - interval '1 hour'
   WHERE id = '56d00000-0000-0000-0000-000000000006';
END $$;

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-znacznik-00001', 'code', 'qr56-osoba-0c-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c5',
    'device_scanned_at', now() - interval '2 hours', 'queued', true))
$q$, 'device_expired',
  '56/R11: urzadzenie przestawione waznym znacznikiem nie wraca do starej reguly po terminie');

-- ---------------------------------------------------------------------------
-- SEKCJA 2 (R12): BLOKADA KOLEJKI NIE BLOKUJE SKANOWANIA NA ZYWO
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb; i integer; v_dev public.event_scanner_devices;
BEGIN
  PERFORM pg_temp.act_as(NULL, NULL);
  -- Kolejka z trzech godzin pracy bez sieci, wyslana jednym rzutem.
  FOR i IN 1..100 LOOP
    v := public.event_checkin_record(jsonb_build_object(
      'device_token', 'tok56-kolejka-000001', 'code', 'obcy-bilet-56-' || i,
      'checkpoint_id', '56c00000-0000-0000-0000-0000000000c5',
      'device_scanned_at', now() - interval '3 hours' + make_interval(secs => i * 108),
      'queued', true));
  END LOOP;
  SELECT * INTO v_dev FROM public.event_scanner_devices WHERE id = '56d00000-0000-0000-0000-000000000008';
  PERFORM pg_temp.assert((v->>'queue_locked')::boolean AND NOT (v->>'device_locked')::boolean
      AND v_dev.queue_locked_until = now() + interval '30 minutes'
      AND v_dev.locked_until IS NULL AND v_dev.fail_window_count = 0
      AND v_dev.queue_fail_window_count = 100,
    '56/R12: setny nieznany kod z kolejki blokuje SAMA kolejke (queue_locked = true, device_locked = false)');

  -- GOTOWE, GDY: zaraz po blokadzie kolejki skan NA ZYWO waznego biletu dziala.
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-kolejka-000001', 'code', 'qr56-osoba-0c-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c5',
    'client_scan_uid', 'scan56-r12-live-01'));
  PERFORM pg_temp.assert(v->>'outcome' IN ('granted', 'repeat') AND (v->>'admit')::boolean,
    '56/R12 GOTOWE: blokada kolejki NIE zatrzymuje skanowania na zywo - wazny bilet wpuszcza');

  v := public.event_checkin_resolve(jsonb_build_object(
    'device_token', 'tok56-kolejka-000001', 'code', 'qr56-osoba-0c-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c5'));
  PERFORM pg_temp.assert(v->>'outcome' = 'granted',
    '56/R12: podglad na zywo tez dziala w czasie blokady kolejki');

  -- Na zywo obowiazuje dalej wlasne okno (20 w 10 minut), osobno od kolejki.
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-kolejka-000001', 'code', 'obcy-na-zywo-56',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c5'));
  PERFORM pg_temp.assert(v->>'outcome' = 'unknown_code' AND NOT (v->>'device_locked')::boolean
      AND NOT (v->>'queue_locked')::boolean
      AND (SELECT fail_window_count = 1 FROM public.event_scanner_devices
            WHERE id = '56d00000-0000-0000-0000-000000000008'),
    '56/R12: nieznany kod na zywo liczy sie do okna NA ZYWO (enumeracja nadal ograniczona)');
END $$;

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-kolejka-000001', 'code', 'qr56-osoba-0c-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c5',
    'device_scanned_at', now() - interval '20 minutes', 'queued', true))
$q$, 'device_locked: queue sync',
  '56/R12: kolejka czeka (device_locked - glowa przejsciowa dla klienta kolejki)');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-kolejka-000001', 'code', 'obcy-bez-czasu',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c5', 'queued', true))
$q$, 'device_locked: queue sync',
  '56/R12: skan z kolejki BEZ czasu urzadzenia nie omija blokady kolejki (brak furtki do zgadywania)');

DO $$
DECLARE v_row record;
BEGIN
  PERFORM pg_temp.act_as('56a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  SELECT * INTO v_row FROM public.admin_event_scanner_devices_list('56e00000-0000-0000-0000-0000000000a1') l
   WHERE l.id = '56d00000-0000-0000-0000-000000000008';
  PERFORM pg_temp.assert(v_row.state = 'active'
      AND v_row.queue_locked_until = now() + interval '30 minutes'
      AND v_row.queue_fail_window_count = 100
      AND v_row.queue_fail_window_started_at = now()
      AND v_row.superseded_scan_count = 0
      AND v_row.queue_marker_required_at IS NULL,
    '56/panel: lista urzadzen pokazuje blokade kolejki OSOBNO (stan na zywo active) i okno kolejki');

  PERFORM public.admin_event_scanner_device_set_active(jsonb_build_object(
    'device_id', '56d00000-0000-0000-0000-000000000008', 'is_active', true));
  PERFORM pg_temp.assert(
    (SELECT queue_locked_until IS NULL AND queue_fail_window_count = 0
       FROM public.event_scanner_devices WHERE id = '56d00000-0000-0000-0000-000000000008'),
    '56/R12: wznowienie zdejmuje blokade kolejki');

  PERFORM pg_temp.act_as(NULL, NULL);
  PERFORM pg_temp.assert(
    (public.event_checkin_record(jsonb_build_object(
      'device_token', 'tok56-kolejka-000001', 'code', 'qr56-osoba-0c-000001',
      'checkpoint_id', '56c00000-0000-0000-0000-0000000000c5',
      'client_scan_uid', 'scan56-r12-after-resume',
      'device_scanned_at', now() - interval '20 minutes', 'queued', true)))->>'outcome'
      IN ('granted', 'repeat'),
    '56/R12: po wznowieniu kolejka znowu sie synchronizuje');
END $$;

-- ---------------------------------------------------------------------------
-- SEKCJA 3 (R4): KOD ZASTAPIONY PO CHWILI SKANU / JUZ MARTWY W CHWILI SKANU
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb; v_card jsonb;
BEGIN
  PERFORM pg_temp.act_as('56a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  v := public.admin_event_badge_batch(jsonb_build_object(
    'event_id', '56e00000-0000-0000-0000-0000000000a1',
    'person_ids', jsonb_build_array('56700000-0000-0000-0000-000000000007')));
  INSERT INTO b2_codes VALUES ('olga_b1', v->'badges'->0->>'qr_code');
  -- Przedruk (zgubiony identyfikator) - poprzedni zastapiony TERAZ.
  v := public.admin_event_badge_batch(jsonb_build_object(
    'event_id', '56e00000-0000-0000-0000-0000000000a1',
    'person_ids', jsonb_build_array('56700000-0000-0000-0000-000000000007')));
  INSERT INTO b2_codes VALUES ('olga_b2', v->'badges'->0->>'qr_code');

  -- F4 (20261013112000): wyjatek R4 wymaga potwierdzonego czasu skanu. Scena
  -- zgodna z czasem: pierwszy identyfikator Olgi wydrukowano godzine temu,
  -- poswiadczenia bramki i stoiska wydano wczoraj, a pozycje kolejki niosa
  -- znacznik z ostatniej odpowiedzi przed utrata sieci (20 minut temu).
  UPDATE public.event_superseded_codes SET issued_at = now() - interval '1 hour'
   WHERE code_hash = encode(extensions.digest(
     (SELECT k.v FROM b2_codes k WHERE k.k = 'olga_b1'), 'sha256'), 'hex');
  UPDATE public.event_scanner_devices SET created_at = now() - interval '1 day'
   WHERE id IN ('56d00000-0000-0000-0000-000000000001', '56d00000-0000-0000-0000-000000000009');
  INSERT INTO b2_codes
  SELECT 'marker_' || d.id::text,
         public._event_scanner_queue_marker(d.id, d.queue_secret, now() - interval '20 minutes')
    FROM public.event_scanner_devices d
   WHERE d.id IN ('56d00000-0000-0000-0000-000000000001', '56d00000-0000-0000-0000-000000000009');

  PERFORM pg_temp.act_as(NULL, NULL);
  -- Bramka bez sieci wpuscila Olge 10 minut temu starym identyfikatorem.
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-brama-00000001',
    'code', (SELECT k.v FROM b2_codes k WHERE k.k = 'olga_b1'),
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c4', 'direction', 'in',
    'client_scan_uid', 'scan56-r4-olga-01', 'device_scanned_at', now() - interval '10 minutes',
    'queued', true, 'offline_admitted', true, 'offline_outcome', 'granted',
    'queue_marker', (SELECT k.v FROM b2_codes k
                      WHERE k.k = 'marker_56d00000-0000-0000-0000-000000000001')));
  PERFORM pg_temp.assert(v->>'outcome' = 'granted' AND (v->>'admit')::boolean
      AND v->>'credential' = 'badge'
      AND (SELECT result = 'granted' AND offline_admitted FROM public.event_checkins
            WHERE id = (v->>'checkin_id')::uuid)
      AND (SELECT attended_at = now() - interval '10 minutes' FROM public.event_registrations
            WHERE id = '56300000-0000-0000-0000-000000000007'),
    '56/R4 GOTOWE: skan z kolejki kodu zastapionego PO chwili skanu - wiersz zgody i obecnosc (decyzja na chwile skanu)');

  -- Polityka deny dziala dalej: wazny bilet Olgi nie wpuszcza drugi raz.
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-brama-00000002', 'code', 'qr56-osoba-07-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c4', 'direction', 'in',
    'client_scan_uid', 'scan56-r4-olga-02'));
  PERFORM pg_temp.assert(v->>'outcome' = 'denied_already_inside'
      AND (v->>'reentry_previous_at')::timestamptz = now() - interval '10 minutes',
    '56/R4: po zapisie skanu sprzed przedruku deny dalej odmawia drugiego wejscia (brak obejscia OPS-08)');

  -- Lead zeskanowany przed przedrukiem zostaje zapisany; na zywo stary kod - nie.
  v := public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok56-stoisko-000001',
    'code', (SELECT k.v FROM b2_codes k WHERE k.k = 'olga_b1'),
    'device_scanned_at', now() - interval '10 minutes', 'queued', true,
    'queue_marker', (SELECT k.v FROM b2_codes k
                      WHERE k.k = 'marker_56d00000-0000-0000-0000-000000000009')));
  PERFORM pg_temp.assert(v->>'outcome' = 'saved'
      AND EXISTS (SELECT 1 FROM public.event_lead_scans
                   WHERE person_id = '56700000-0000-0000-0000-000000000007'
                     AND sponsor_id = '56500000-0000-0000-0000-0000000000a1'),
    '56/R4: lead z kolejki zeskanowany PRZED przedrukiem jest zapisany');
  v := public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok56-stoisko-000001',
    'code', (SELECT k.v FROM b2_codes k WHERE k.k = 'olga_b1')));
  PERFORM pg_temp.assert(v->>'outcome' = 'code_superseded',
    '56/R4: ten sam stary kod NA ZYWO to code_superseded (kontrapunkt)');

  -- Zenon: bilet uniewazniony godzine temu, bramka bez sieci wpuscila go
  -- starym biletem 30 minut temu - kod byl martwy juz w chwili skanu.
  PERFORM pg_temp.act_as('56a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  PERFORM public.admin_event_registration_code_invalidate(jsonb_build_object(
    'registration_id', '56300000-0000-0000-0000-000000000008', 'credential', 'ticket'));
  UPDATE public.event_superseded_codes SET superseded_at = now() - interval '1 hour'
   WHERE code_hash = encode(extensions.digest('qr56-osoba-08-000001', 'sha256'), 'hex');

  PERFORM pg_temp.act_as(NULL, NULL);
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-brama-00000001', 'code', 'qr56-osoba-08-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c5',
    'client_scan_uid', 'scan56-r4-zenon-01', 'device_scanned_at', now() - interval '30 minutes',
    'queued', true, 'offline_admitted', true, 'offline_outcome', 'granted'));
  INSERT INTO b2_codes VALUES ('zenon_row', v->>'checkin_id');
  PERFORM pg_temp.assert(v->>'outcome' = 'denied_code_superseded'
      AND NOT (v->>'admit')::boolean AND NOT (v->>'server_admit')::boolean
      AND v->'superseded'->>'reason' = 'invalidated'
      AND v->'superseded'->>'credential' = 'ticket'
      AND (SELECT result = 'denied_code_superseded' AND offline_admitted
                  AND offline_outcome = 'granted'
             FROM public.event_checkins WHERE id = (v->>'checkin_id')::uuid)
      AND (SELECT attended_at IS NULL FROM public.event_registrations
            WHERE id = '56300000-0000-0000-0000-000000000008'),
    '56/R4 GOTOWE: wpuszczenie offline kodu martwego JUZ w chwili skanu zostawia prawdziwy wiersz odmowy (denied_code_superseded), bez obecnosci');

  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-brama-00000001', 'code', 'qr56-osoba-08-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c5',
    'client_scan_uid', 'scan56-r4-zenon-02', 'device_scanned_at', now() - interval '20 minutes',
    'queued', true, 'offline_admitted', false, 'offline_outcome', 'unknown_code'));
  PERFORM pg_temp.assert(v->>'outcome' = 'code_superseded'
      AND (SELECT count(*) FROM public.event_checkins
            WHERE person_id = '56700000-0000-0000-0000-000000000008') = 1,
    '56/R4: odeslanie offline kodu martwego w chwili skanu - jak dotad code_superseded bez wiersza (nikt nie wszedl)');

  PERFORM pg_temp.act_as('56a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.assert(
    (SELECT l.conflict AND l.conflict_kind = 'admitted_offline' AND l.result = 'denied_code_superseded'
       FROM public.admin_event_checkins_list('56e00000-0000-0000-0000-0000000000a1',
              NULL, NULL, NULL, NULL, NULL, NULL, NULL, 200, 0, true) l
      WHERE l.id = (SELECT k.v FROM b2_codes k WHERE k.k = 'zenon_row')::uuid),
    '56/R4: dziennik panelu pokazuje wpuszczenie martwego kodu jako konflikt admitted_offline');
END $$;

-- ---------------------------------------------------------------------------
-- SEKCJA 4 (R5): IDENTYFIKATOR NIE PRZEZYWA ANULOWANIA ZAPISU
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.act_as('56a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  v := public.admin_event_badge_batch(jsonb_build_object(
    'event_id', '56e00000-0000-0000-0000-0000000000a1',
    'person_ids', jsonb_build_array('56700000-0000-0000-0000-000000000009')));
  INSERT INTO b2_codes VALUES ('piotr_badge', v->'badges'->0->>'qr_code');
  PERFORM pg_temp.assert(v->'badges'->0->>'qr_code' IS NOT NULL
      AND (SELECT badge_token_hash IS NOT NULL AND qr_token_hash IS NULL
             FROM public.event_registrations WHERE id = '56300000-0000-0000-0000-000000000009'),
    '56/R5: scenografia - identyfikator wydrukowany do zapisu oczekujacego bez biletu');

  PERFORM public.admin_event_registration_decide(jsonb_build_object(
    'registration_id', '56300000-0000-0000-0000-000000000009', 'action', 'cancel'));
  PERFORM pg_temp.assert(
    (SELECT status = 'cancelled' AND badge_token_hash IS NULL AND badge_issued_at IS NULL
       FROM public.event_registrations WHERE id = '56300000-0000-0000-0000-000000000009')
    AND (SELECT credential = 'badge' AND reason = 'revoked' FROM public.event_superseded_codes
          WHERE code_hash = encode(extensions.digest(
            (SELECT k.v FROM b2_codes k WHERE k.k = 'piotr_badge'), 'sha256'), 'hex')),
    '56/R5: anulowanie zapisu BEZ biletu zdejmuje identyfikator i zapisuje go jako revoked');

  -- Ta sama osoba ma potem INNY aktywny zapis - stary identyfikator nie
  -- moze go "pozyczyc".
  INSERT INTO public.event_registrations
    (id, tenant_id, event_id, person_id, status, registration_mode, qr_token_hash, qr_issued_at)
  VALUES ('56300000-0000-0000-0000-000000000019', '11111111-1111-1111-1111-111111111111',
          '56e00000-0000-0000-0000-0000000000a1', '56700000-0000-0000-0000-000000000009',
          'approved', 'rsvp', encode(extensions.digest('qr56-piotr-nowy-0001', 'sha256'), 'hex'), now());

  PERFORM pg_temp.act_as(NULL, NULL);
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-brama-00000002',
    'code', (SELECT k.v FROM b2_codes k WHERE k.k = 'piotr_badge'),
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c5'));
  PERFORM pg_temp.assert(v->>'outcome' = 'code_superseded' AND NOT (v->>'admit')::boolean
      AND v->'superseded'->>'reason' = 'revoked' AND v->'superseded'->>'credential' = 'badge'
      AND NOT EXISTS (SELECT 1 FROM public.event_checkins
                       WHERE person_id = '56700000-0000-0000-0000-000000000009'),
    '56/R5 GOTOWE: zapis oczekujacy z wydrukowanym identyfikatorem -> anulowanie -> skan identyfikatora = code_superseded (nie granted)');

  -- Siatka bezpieczenstwa: identyfikator na zapisie anulowanym zapisanym
  -- z pominieciem UPDATE (import) tez jest zastapiony.
  INSERT INTO public.event_registrations
    (id, tenant_id, event_id, person_id, status, registration_mode, cancelled_at,
     badge_token_hash, badge_issued_at)
  VALUES ('56300000-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111',
          '56e00000-0000-0000-0000-0000000000a1', '56700000-0000-0000-0000-00000000000d',
          'cancelled', 'rsvp', now() - interval '1 day',
          encode(extensions.digest('badge56-import-00001', 'sha256'), 'hex'), now() - interval '2 days');
  PERFORM pg_temp.assert(
    (SELECT superseded AND superseded_reason = 'revoked' AND credential = 'badge'
            AND superseded_at = now() - interval '1 day'
       FROM public._event_scanner_code_lookup('11111111-1111-1111-1111-111111111111', 'badge56-import-00001')),
    '56/R5: wyszukiwanie traktuje identyfikator zapisu anulowanego jako revoked (takze bez triggera)');
END $$;

-- ---------------------------------------------------------------------------
-- SEKCJA 5 (R6): WEJSCIE PO WYJSCIU W OKNIE POWTORZEN TO NOWE WEJSCIE
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb; v_third uuid; v_row public.event_checkins;
BEGIN
  PERFORM pg_temp.act_as(NULL, NULL);
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-brama-00000002', 'code', 'qr56-osoba-01-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c1', 'direction', 'in',
    'client_scan_uid', 'scan56-r6-01', 'device_scanned_at', now() - interval '200 seconds'));
  PERFORM pg_temp.assert(v->>'outcome' = 'granted', '56/R6: wejscie (-200 s)');
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-brama-00000002', 'code', 'qr56-osoba-01-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c1', 'direction', 'out',
    'client_scan_uid', 'scan56-r6-02', 'device_scanned_at', now() - interval '180 seconds'));
  PERFORM pg_temp.assert(v->>'outcome' = 'granted', '56/R6: wyjscie (-180 s)');

  -- Ktos inny z tym samym kodem wchodzi 40 s po pierwszym wejsciu - W OKNIE
  -- powtorzen tamtego wejscia, ale PO wyjsciu.
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-brama-00000001', 'code', 'qr56-osoba-01-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c1', 'direction', 'in',
    'client_scan_uid', 'scan56-r6-03', 'device_scanned_at', now() - interval '160 seconds'));
  v_third := (v->>'checkin_id')::uuid;
  SELECT * INTO v_row FROM public.event_checkins WHERE id = v_third;
  PERFORM pg_temp.assert(v->>'outcome' = 'granted' AND (v->>'admit')::boolean
      AND NOT (v->>'reentry')::boolean
      AND v_row.occurred_at = now() - interval '160 seconds' AND v_row.repeat_count = 0
      AND lower(v_row.dedupe_range) = now() - interval '140 seconds'
      AND upper(v_row.dedupe_range) = now() - interval '100 seconds',
    '56/R6 GOTOWE: wejscie po wyjsciu w oknie poprzedniego wejscia to NOWY wiersz (okno przyciete do konca okna poprzedniego), nie repeat');

  -- Podwojne pikniecie TEGO wejscia nadal jest powtorzeniem.
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-brama-00000001', 'code', 'qr56-osoba-01-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c1', 'direction', 'in',
    'client_scan_uid', 'scan56-r6-04', 'device_scanned_at', now() - interval '150 seconds'));
  PERFORM pg_temp.assert(v->>'outcome' = 'repeat' AND (v->>'checkin_id')::uuid = v_third,
    '56/R6: pikniecie 10 s po nowym wejsciu to repeat TEGO wejscia (nie pierwszego)');

  -- Kolejne wejscie bez wyjscia: odmowa, poprzednie wejscie wskazane prawdziwie.
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-brama-00000002', 'code', 'qr56-osoba-01-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c1', 'direction', 'in',
    'client_scan_uid', 'scan56-r6-05', 'device_scanned_at', now() - interval '100 seconds'));
  PERFORM pg_temp.assert(v->>'outcome' = 'denied_already_inside' AND NOT (v->>'admit')::boolean
      AND (v->>'reentry_previous_at')::timestamptz = now() - interval '160 seconds',
    '56/R6 GOTOWE: in -> out -> in (w oknie) -> in przy deny: czwarte to denied_already_inside - jeden kod nie wpuszcza dwoch osob');

  PERFORM pg_temp.assert(
    (SELECT count(*) FILTER (WHERE direction = 'in' AND result = 'granted') = 2
        AND count(*) FILTER (WHERE direction = 'out' AND result = 'granted') = 1
        AND count(*) FILTER (WHERE result = 'denied_already_inside') = 1
       FROM public.event_checkins
      WHERE person_id = '56700000-0000-0000-0000-000000000001'),
    '56/R6: dziennik: dwa wejscia, jedno wyjscie, jedna odmowa - zadne wejscie nie znika');
  PERFORM pg_temp.assert(public._event_checkpoint_occupancy(
      '11111111-1111-1111-1111-111111111111', '56c00000-0000-0000-0000-0000000000c1') = 1,
    '56/R6: obecnosc w punkcie liczy osobe w srodku');
END $$;

-- EXCLUDE nadal odbija druga zgode TEGO SAMEGO przejscia (bez wyjscia pomiedzy).
SELECT pg_temp.assert_raises_like($q$
  INSERT INTO public.event_checkins
    (tenant_id, event_id, checkpoint_id, person_id, registration_id,
     direction, result, source, scanned_at, device_scanned_at, dedupe_range, device_id)
  VALUES ('11111111-1111-1111-1111-111111111111', '56e00000-0000-0000-0000-0000000000a1',
          '56c00000-0000-0000-0000-0000000000c1', '56700000-0000-0000-0000-000000000001',
          '56300000-0000-0000-0000-000000000001', 'in', 'granted', 'qr_code', now(),
          now() - interval '155 seconds', 'empty'::tstzrange,
          '56d00000-0000-0000-0000-000000000002')
$q$, 'event_checkins_no_double_in',
  '56/R6/ODMOWA: druga zgoda tego samego przejscia odbija sie od EXCLUDE (okno liczy trigger, nie wstawiajacy)');

-- ---------------------------------------------------------------------------
-- SEKCJA 6 (R8): DZIEN CZASU WYDARZENIA I JAWNE OBEJSCIE STANOWISKA
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb; v_day_start timestamptz;
BEGIN
  PERFORM pg_temp.act_as(NULL, NULL);

  -- Dagmara: dzien 1, potem dzien 2 na bramce tylko-wejscie z deny.
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-brama-00000002', 'code', 'qr56-osoba-02-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c2',
    'client_scan_uid', 'scan56-r8-d1', 'device_scanned_at', now() - interval '1 day'));
  PERFORM pg_temp.assert(v->>'outcome' = 'granted', '56/R8: wejscie dnia 1');

  v := public.event_checkin_resolve(jsonb_build_object(
    'device_token', 'tok56-brama-00000002', 'code', 'qr56-osoba-02-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c2'));
  PERFORM pg_temp.assert(v->>'outcome' = 'granted' AND NOT (v->>'reentry')::boolean,
    '56/R8: podglad dnia 2 - wejscie z dnia 1 nie trzyma osoby "w srodku"');

  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-brama-00000002', 'code', 'qr56-osoba-02-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c2',
    'client_scan_uid', 'scan56-r8-d2a', 'device_scanned_at', now() - interval '30 minutes'));
  PERFORM pg_temp.assert(v->>'outcome' = 'granted' AND (v->>'admit')::boolean
      AND NOT (v->>'reentry')::boolean,
    '56/R8 GOTOWE: bramka tylko-wejscie z deny - wejscie DNIA 2 (czas wydarzenia) wpuszcza');

  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-brama-00000002', 'code', 'qr56-osoba-02-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c2',
    'client_scan_uid', 'scan56-r8-d2b', 'device_scanned_at', now() - interval '10 minutes'));
  PERFORM pg_temp.assert(v->>'outcome' = 'denied_already_inside' AND NOT (v->>'admit')::boolean
      AND (v->>'reentry_previous_at')::timestamptz = now() - interval '30 minutes',
    '56/R8 GOTOWE: drugie wejscie TEGO SAMEGO dnia - denied_already_inside (jedno wejscie dziennie)');

  -- Mikolaj: granica dnia to polnoc w strefie WYDARZENIA.
  v_day_start := public._event_checkin_day_start(
    '11111111-1111-1111-1111-111111111111', '56e00000-0000-0000-0000-0000000000a1', now());
  PERFORM pg_temp.assert(
    v_day_start = date_trunc('day', now() AT TIME ZONE (SELECT k.v FROM b2_ctx k WHERE k.k = 'tz'))
                    AT TIME ZONE (SELECT k.v FROM b2_ctx k WHERE k.k = 'tz')
    AND v_day_start < now() - interval '11 hours',
    '56/R8: poczatek dnia liczy strefa czasowa wydarzenia');
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-brama-00000002', 'code', 'qr56-osoba-03-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c2',
    'client_scan_uid', 'scan56-r8-mid-a', 'device_scanned_at', v_day_start - interval '30 minutes'));
  PERFORM pg_temp.assert(v->>'outcome' = 'granted', '56/R8: wejscie 30 min przed polnoca czasu wydarzenia');
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-brama-00000002', 'code', 'qr56-osoba-03-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c2',
    'client_scan_uid', 'scan56-r8-mid-b', 'device_scanned_at', v_day_start + interval '30 minutes'));
  PERFORM pg_temp.assert(v->>'outcome' = 'granted' AND NOT (v->>'reentry')::boolean,
    '56/R8: wejscie 30 min po polnocy czasu wydarzenia to nowy dzien - wpuszcza');

  -- Oskar: w srodku, bramka odmawia, stanowisko jawnie obchodzi odmowe.
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-brama-00000002', 'code', 'qr56-osoba-04-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c2',
    'client_scan_uid', 'scan56-r8-osk-1', 'device_scanned_at', now() - interval '40 minutes'));
  PERFORM pg_temp.assert(v->>'outcome' = 'granted', '56/R8: Oskar wchodzi');
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-brama-00000002', 'code', 'qr56-osoba-04-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c2',
    'client_scan_uid', 'scan56-r8-osk-2', 'device_scanned_at', now() - interval '20 minutes'));
  PERFORM pg_temp.assert(v->>'outcome' = 'denied_already_inside',
    '56/R8: bramka odmawia Oskarowi (wyszedl bocznym wyjsciem, ktorego dziennik nie zna)');

  PERFORM pg_temp.act_as('56a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  v := public.admin_event_checkin_manual(jsonb_build_object(
    'event_id', '56e00000-0000-0000-0000-0000000000a1',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c2',
    'person_id', '56700000-0000-0000-0000-000000000004',
    'source', 'name_search', 'client_scan_uid', 'desk56-osk-override'));
  PERFORM pg_temp.assert(v->>'outcome' = 'granted' AND (v->>'admit')::boolean
      AND (v->>'reentry_override')::boolean AND (v->>'reentry')::boolean
      AND (v->>'reentry_previous_at')::timestamptz = now() - interval '40 minutes'
      AND (SELECT operator_user_id = '56a00000-0000-0000-0000-0000000000a1' AND device_id IS NULL
                  AND reentry_override AND result = 'granted' AND source = 'name_search'
             FROM public.event_checkins WHERE id = (v->>'checkin_id')::uuid),
    '56/R8 GOTOWE: odprawa reczna na stanowisku omija odmowe JAWNIE - zgoda z operatorem i znacznikiem reentry_override');
  PERFORM pg_temp.assert(
    (SELECT l.reentry_override AND NOT l.conflict
       FROM public.admin_event_checkins_list('56e00000-0000-0000-0000-0000000000a1',
              NULL, NULL, NULL, NULL, NULL, NULL, NULL, 200, 0, false) l
      WHERE l.id = (v->>'checkin_id')::uuid),
    '56/R8: dziennik panelu pokazuje obejscie (reentry_override) i NIE liczy go jako konfliktu');

  -- Zwykla odprawa reczna osoby, ktorej nie ma w srodku, nie jest obejsciem.
  v := public.admin_event_checkin_manual(jsonb_build_object(
    'event_id', '56e00000-0000-0000-0000-0000000000a1',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c2',
    'person_id', '56700000-0000-0000-0000-00000000000c',
    'client_scan_uid', 'desk56-kamil-plain'));
  PERFORM pg_temp.assert(v->>'outcome' = 'granted' AND NOT (v->>'reentry_override')::boolean,
    '56/R8: odprawa reczna bez odmowy nie dostaje znacznika obejscia');
END $$;

SELECT pg_temp.act_as(NULL, NULL);
SELECT pg_temp.assert_raises_like($q$
  SELECT public._event_checkin_write(
    '11111111-1111-1111-1111-111111111111', '56e00000-0000-0000-0000-0000000000a1',
    '56c00000-0000-0000-0000-0000000000c2', '56700000-0000-0000-0000-000000000004',
    'in', 'qr_code', '56d00000-0000-0000-0000-000000000002', NULL, NULL, NULL, NULL,
    NULL, true, NULL)
$q$, 'invalid_payload',
  '56/R8/ODMOWA: urzadzenie nie moze zapisac obejscia odmowy (tylko operator stanowiska)');

SELECT pg_temp.assert_raises_like($q$
  INSERT INTO public.event_checkins
    (tenant_id, event_id, checkpoint_id, person_id, direction, result, source,
     scanned_at, dedupe_range, device_id, reentry_override)
  VALUES ('11111111-1111-1111-1111-111111111111', '56e00000-0000-0000-0000-0000000000a1',
          '56c00000-0000-0000-0000-0000000000c2', '56700000-0000-0000-0000-000000000004',
          'in', 'granted', 'qr_code', now() - interval '5 hours', 'empty'::tstzrange,
          '56d00000-0000-0000-0000-000000000002', true)
$q$, 'event_checkins_reentry_override_desk',
  '56/R8/ODMOWA: CHECK - znacznik obejscia tylko na wierszu stanowiska (bez urzadzenia)');

-- ---------------------------------------------------------------------------
-- SEKCJA 7 (R9): SKAN Z KOLEJKI NIE ODBIJA SIE OD POZNIEJSZEGO WEJSCIA
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb; v_q_in uuid; v_live_in uuid;
BEGIN
  PERFORM pg_temp.act_as(NULL, NULL);
  -- Wiktor: brama na zywo (urzadzenie 2) - wejscie, wyjscie, wejscie.
  PERFORM public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-brama-00000002', 'code', 'qr56-osoba-05-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c3', 'direction', 'in',
    'client_scan_uid', 'scan56-r9-l1', 'device_scanned_at', now() - interval '60 minutes'));
  PERFORM public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-brama-00000002', 'code', 'qr56-osoba-05-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c3', 'direction', 'out',
    'client_scan_uid', 'scan56-r9-l2', 'device_scanned_at', now() - interval '50 minutes'));
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-brama-00000002', 'code', 'qr56-osoba-05-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c3', 'direction', 'in',
    'client_scan_uid', 'scan56-r9-l3', 'device_scanned_at', now() - interval '20 minutes'));
  v_live_in := (v->>'checkin_id')::uuid;
  PERFORM pg_temp.assert(v->>'outcome' = 'granted', '56/R9: scenografia - trzy skany na zywo');

  -- Kolejka urzadzenia 1 w kolejnosci skanow (jak scannerOutbox): wejscie
  -- -40 min (wpuszczone offline) przychodzi PRZED swoim wyjsciem -30 min.
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-brama-00000001', 'code', 'qr56-osoba-05-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c3', 'direction', 'in',
    'client_scan_uid', 'scan56-r9-q1', 'device_scanned_at', now() - interval '40 minutes',
    'queued', true, 'offline_admitted', true, 'offline_outcome', 'granted'));
  v_q_in := (v->>'checkin_id')::uuid;
  PERFORM pg_temp.assert(v->>'outcome' = 'granted' AND (v->>'admit')::boolean
      AND NOT (v->>'reentry')::boolean AND v->'reentry_previous_at' = 'null'::jsonb
      AND (SELECT result = 'granted' AND offline_admitted FROM public.event_checkins WHERE id = v_q_in),
    '56/R9 GOTOWE: wejscie z kolejki oceniane bez POZNIEJSZEGO wejscia - zapisane prawdziwie jako zgoda (wpuszczono offline), reentry_previous_at nie wskazuje przyszlosci');

  PERFORM pg_temp.act_as('56a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.assert(
    (SELECT count(*) FILTER (WHERE l.conflict_kind = 'double_entry' AND l.id IN (v_q_in, v_live_in)) = 2
        AND count(*) = 2
       FROM public.admin_event_checkins_list('56e00000-0000-0000-0000-0000000000a1',
              '56c00000-0000-0000-0000-0000000000c3', NULL, NULL, NULL, NULL, NULL, NULL, 200, 0, true) l
      WHERE l.person_id = '56700000-0000-0000-0000-000000000005'),
    '56/R9: dopoki wyjscie z kolejki nie dotarlo, dziennik pokazuje mozliwe podwojne wejscie (double_entry na obu wierszach pary)');

  PERFORM pg_temp.act_as(NULL, NULL);
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-brama-00000001', 'code', 'qr56-osoba-05-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c3', 'direction', 'out',
    'client_scan_uid', 'scan56-r9-q2', 'device_scanned_at', now() - interval '30 minutes',
    'queued', true, 'offline_admitted', true, 'offline_outcome', 'granted'));
  PERFORM pg_temp.assert(v->>'outcome' = 'granted', '56/R9: wyjscie z kolejki dociera');

  PERFORM pg_temp.act_as('56a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.admin_event_checkins_list('56e00000-0000-0000-0000-0000000000a1',
              '56c00000-0000-0000-0000-0000000000c3', NULL, NULL, NULL, NULL, NULL, NULL, 200, 0, true) l
                 WHERE l.person_id = '56700000-0000-0000-0000-000000000005'),
    '56/R9: po dotarciu wyjscia konflikt znika sam - osoba weszla i wyszla normalnie');

  -- Wanda: te same skany, kolejka w ODWROTNEJ kolejnosci - ten sam wynik.
  PERFORM pg_temp.act_as(NULL, NULL);
  PERFORM public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-brama-00000002', 'code', 'qr56-osoba-06-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c3', 'direction', 'in',
    'client_scan_uid', 'scan56-r9b-l1', 'device_scanned_at', now() - interval '60 minutes'));
  PERFORM public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-brama-00000002', 'code', 'qr56-osoba-06-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c3', 'direction', 'out',
    'client_scan_uid', 'scan56-r9b-l2', 'device_scanned_at', now() - interval '50 minutes'));
  PERFORM public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-brama-00000002', 'code', 'qr56-osoba-06-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c3', 'direction', 'in',
    'client_scan_uid', 'scan56-r9b-l3', 'device_scanned_at', now() - interval '20 minutes'));
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-brama-00000001', 'code', 'qr56-osoba-06-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c3', 'direction', 'out',
    'client_scan_uid', 'scan56-r9b-q2', 'device_scanned_at', now() - interval '30 minutes',
    'queued', true, 'offline_admitted', true, 'offline_outcome', 'granted'));
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok56-brama-00000001', 'code', 'qr56-osoba-06-000001',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c3', 'direction', 'in',
    'client_scan_uid', 'scan56-r9b-q1', 'device_scanned_at', now() - interval '40 minutes',
    'queued', true, 'offline_admitted', true, 'offline_outcome', 'granted'));
  PERFORM pg_temp.assert(v->>'outcome' = 'granted' AND NOT (v->>'reentry')::boolean,
    '56/R9: kolejka w odwrotnej kolejnosci daje ten sam zapis (wynik nie zalezy od kolejnosci synchronizacji)');

  PERFORM pg_temp.act_as('56a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.admin_event_checkins_list('56e00000-0000-0000-0000-0000000000a1',
              '56c00000-0000-0000-0000-0000000000c3', NULL, NULL, NULL, NULL, NULL, NULL, 200, 0, true) l
                 WHERE l.person_id = '56700000-0000-0000-0000-000000000006')
    AND (SELECT count(*) FROM public.event_checkins
          WHERE person_id = '56700000-0000-0000-0000-000000000006' AND result = 'granted') = 5,
    '56/R9: w odwrotnej kolejnosci tez brak falszywego konfliktu, wszystkie piec przejsc zapisane');
END $$;

-- ---------------------------------------------------------------------------
-- SEKCJA 8 (R7): KLON EDYCJI ZACHOWUJE POLITYKE PONOWNEGO WEJSCIA
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb;
BEGIN
  v := public._event_clone_onsite(
    '11111111-1111-1111-1111-111111111111', '56e00000-0000-0000-0000-0000000000b1',
    '56e00000-0000-0000-0000-0000000000b2', '{}'::jsonb);
  PERFORM pg_temp.assert((v->'copied'->>'checkpoints')::integer = 2,
    '56/R7: scenografia - klon kopiuje oba punkty');
  PERFORM pg_temp.assert(
    (SELECT reentry_policy = 'deny' AND access_mode = 'control' AND direction_mode = 'in_only'
            AND dedupe_window_seconds = 90
       FROM public.event_checkpoints
      WHERE id = public._event_clone_id('56e00000-0000-0000-0000-0000000000b2',
                                        '56c00000-0000-0000-0000-0000000000b1')),
    '56/R7 GOTOWE: klon edycji zachowuje "Blokuj ponowne wejscie" (reentry_policy = deny)');
  PERFORM pg_temp.assert(
    (SELECT reentry_policy = 'allow' FROM public.event_checkpoints
      WHERE id = public._event_clone_id('56e00000-0000-0000-0000-0000000000b2',
                                        '56c00000-0000-0000-0000-0000000000b2')),
    '56/R7: punkt z allow zostaje allow (kontrapunkt)');
END $$;

-- ---------------------------------------------------------------------------
-- SEKCJA 9 (R10): USUNIECIE KONTA PRACOWNIKA ZOSTAWIA HISTORIE
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb; v_checkin uuid; v_print uuid; v_lead uuid;
BEGIN
  -- Stefan (admin stanowiska) odprawia recznie i drukuje identyfikator.
  PERFORM pg_temp.act_as('56a00000-0000-0000-0000-0000000000a5', '11111111-1111-1111-1111-111111111111');
  v := public.admin_event_checkin_manual(jsonb_build_object(
    'event_id', '56e00000-0000-0000-0000-0000000000a1',
    'checkpoint_id', '56c00000-0000-0000-0000-0000000000c5',
    'person_id', '56700000-0000-0000-0000-00000000000b',
    'client_scan_uid', 'desk56-stefan-0001'));
  v_checkin := (v->>'checkin_id')::uuid;
  v := public.admin_event_badge_print_record(jsonb_build_object(
    'event_id', '56e00000-0000-0000-0000-0000000000a1',
    'person_id', '56700000-0000-0000-0000-00000000000b'));
  SELECT id INTO v_print FROM public.event_badge_prints
   WHERE printed_by = '56a00000-0000-0000-0000-0000000000a5';
  -- Lead zebrany przez zalogowanego uzytkownika (zadna funkcja go dzis nie
  -- zapisuje, ale kolumna i klucz obcy istnieja - dowod na wierszu).
  INSERT INTO public.event_lead_scans
    (tenant_id, event_id, sponsor_id, person_id, registration_id, scanned_by_user_id)
  VALUES ('11111111-1111-1111-1111-111111111111', '56e00000-0000-0000-0000-0000000000a1',
          '56500000-0000-0000-0000-0000000000a1', '56700000-0000-0000-0000-00000000000b',
          '56300000-0000-0000-0000-00000000000b', '56a00000-0000-0000-0000-0000000000a5')
  RETURNING id INTO v_lead;

  PERFORM pg_temp.assert(v_checkin IS NOT NULL AND v_print IS NOT NULL AND v_lead IS NOT NULL
      AND (SELECT operator_user_id = '56a00000-0000-0000-0000-0000000000a5'
             FROM public.event_checkins WHERE id = v_checkin),
    '56/R10: scenografia - odprawa reczna, wydruk i lead z aktorem-uzytkownikiem');

  PERFORM pg_temp.act_as(NULL, NULL);
  -- GOTOWE, GDY: usuniecie konta przechodzi (dotad 23514 na actor_exactly_one).
  DELETE FROM auth.users WHERE id = '56a00000-0000-0000-0000-0000000000a5';

  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM auth.users WHERE id = '56a00000-0000-0000-0000-0000000000a5')
    AND (SELECT operator_user_id IS NULL AND device_id IS NULL AND actor_deleted_at = now()
                AND result = 'granted'
           FROM public.event_checkins WHERE id = v_checkin)
    AND (SELECT printed_by IS NULL AND actor_deleted_at = now()
           FROM public.event_badge_prints WHERE id = v_print)
    AND (SELECT scanned_by_user_id IS NULL AND actor_deleted_at = now()
           FROM public.event_lead_scans WHERE id = v_lead),
    '56/R10 GOTOWE: usuniecie konta pracownika przechodzi; odprawa, wydruk i lead zostaja z actor_deleted_at');
END $$;

SELECT pg_temp.assert_raises_like($q$
  INSERT INTO public.event_checkins
    (tenant_id, event_id, checkpoint_id, person_id, direction, result, source,
     scanned_at, dedupe_range)
  VALUES ('11111111-1111-1111-1111-111111111111', '56e00000-0000-0000-0000-0000000000a1',
          '56c00000-0000-0000-0000-0000000000c5', '56700000-0000-0000-0000-00000000000b',
          'out', 'denied_direction', 'manual_entry', now() - interval '6 hours', 'empty'::tstzrange)
$q$, 'event_checkins_actor_exactly_one',
  '56/R10/ODMOWA: wiersz BEZ aktora i bez stempla usuniecia konta nadal odrzucony');

SELECT pg_temp.assert_raises_like($q$
  INSERT INTO public.event_badge_prints
    (tenant_id, event_id, person_id, template_version, printed_by, device_id)
  VALUES ('11111111-1111-1111-1111-111111111111', '56e00000-0000-0000-0000-0000000000a1',
          '56700000-0000-0000-0000-00000000000b', 1,
          '56a00000-0000-0000-0000-0000000000a1', '56d00000-0000-0000-0000-000000000002')
$q$, 'event_badge_prints_actor_exactly_one',
  '56/R10/ODMOWA: dwoch aktorow naraz nadal odrzucone');

-- REJESTR (rozszerzenie asercji OPS-11 z 54): kazdy klucz obcy SET NULL /
-- SET DEFAULT, ktorego zerowana kolumna stoi w CHECK-u, musi byc tu
-- przejrzany i zaklasyfikowany:
--   null_ok    - CHECK jest spelniony przy NULL w tej kolumnie;
--   repaired   - trigger BEFORE UPDATE na tej kolumnie naprawia wiersz
--                (sprawdzane nizej: trigger musi istniec);
--   handoff    - zagrozenie poza ta zmiana, zgloszone dalej (dzis zaden
--                wpis; ostatni - events / discussion_club_id - naprawiony
--                w 20261013112200, dowod zachowania w 57, sekcja B2).
-- Nowa para (nowy SET NULL na kolumnie z CHECK-iem albo nowy CHECK na
-- kolumnie zerowanej) czerwieni bramke do czasu przegladu.
CREATE TEMP TABLE b2_setnull_register (tbl text, chk text, col text, kind text) ON COMMIT DROP;
INSERT INTO b2_setnull_register VALUES
  ('events', 'events_previous_edition_not_self', 'previous_edition_id', 'null_ok'),
  ('events', 'events_discussion_group_needs_club', 'discussion_group_id', 'null_ok'),
  ('events', 'events_discussion_group_needs_club', 'discussion_club_id', 'repaired'),
  ('b2b_coupon_redemptions', 'b2b_coupon_redemptions_one_order_kind', 'order_id', 'null_ok'),
  ('b2b_coupon_redemptions', 'b2b_coupon_redemptions_one_order_kind', 'package_order_id', 'null_ok'),
  ('event_registrations', 'event_registrations_decision_dated', 'decided_by', 'null_ok'),
  ('event_meetings', 'event_meetings_responder_dated', 'responded_by', 'null_ok'),
  ('event_cfp_submissions', 'event_cfp_submissions_decision_dated', 'decided_by', 'null_ok'),
  ('event_invoice_sources', 'event_invoice_sources_single_ref', 'package_order_id', 'null_ok'),
  ('event_invoice_sources', 'event_invoice_sources_single_ref', 'registration_id', 'null_ok'),
  ('event_seats', 'event_seats_hold_only_when_held', 'hold_company_id', 'null_ok'),
  ('event_seats', 'event_seats_hold_only_when_held', 'hold_package_order_id', 'null_ok'),
  ('event_seats', 'event_seats_hold_only_when_held', 'hold_sponsor_id', 'null_ok'),
  ('event_scanner_devices', 'event_scanner_devices_lead_needs_sponsor', 'sponsor_id', 'repaired'),
  ('event_package_seats', 'event_package_seats_assigned_stamp', 'registration_id', 'repaired'),
  ('event_checkins', 'event_checkins_actor_exactly_one', 'operator_user_id', 'repaired'),
  ('event_badge_prints', 'event_badge_prints_actor_exactly_one', 'printed_by', 'repaired'),
  ('event_lead_scans', 'event_lead_scans_actor_exactly_one', 'scanned_by_user_id', 'repaired');

CREATE TEMP VIEW b2_setnull_pairs AS
  WITH fk AS (
    SELECT c.conrelid, COALESCE(c.confdelsetcols, c.conkey) AS cols
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND c.contype = 'f' AND c.confdeltype IN ('n', 'd')
  )
  SELECT DISTINCT t.relname::text AS tbl, ck.conname::text AS chk, a.attname::text AS col, a.attnum
  FROM fk
  JOIN pg_class t ON t.oid = fk.conrelid
  JOIN pg_constraint ck ON ck.conrelid = fk.conrelid AND ck.contype = 'c'
  JOIN pg_attribute a ON a.attrelid = fk.conrelid AND a.attnum = ANY (fk.cols)
  WHERE a.attnum = ANY (ck.conkey);

SELECT pg_temp.assert(
  NOT EXISTS (
    SELECT p.tbl, p.chk, p.col FROM b2_setnull_pairs p
    EXCEPT SELECT r.tbl, r.chk, r.col FROM b2_setnull_register r
  )
  AND NOT EXISTS (
    SELECT r.tbl, r.chk, r.col FROM b2_setnull_register r
    EXCEPT SELECT p.tbl, p.chk, p.col FROM b2_setnull_pairs p
  ),
  '56/R10 (OPS-11+): kazdy klucz obcy SET NULL, ktorego kolumna stoi w CHECK-u, jest w przejrzanym rejestrze (nowa para czerwieni bramke)');

SELECT pg_temp.assert(
  NOT EXISTS (
    SELECT 1
    FROM b2_setnull_register r
    JOIN b2_setnull_pairs p ON p.tbl = r.tbl AND p.chk = r.chk AND p.col = r.col
    WHERE r.kind = 'repaired'
      AND NOT EXISTS (
        SELECT 1 FROM pg_trigger tg
        JOIN pg_class t ON t.oid = tg.tgrelid
        WHERE t.relname = r.tbl
          AND NOT tg.tgisinternal
          AND (tg.tgtype & 2) <> 0   -- BEFORE
          AND (tg.tgtype & 1) <> 0   -- FOR EACH ROW
          AND (tg.tgtype & 16) <> 0  -- UPDATE
          AND p.attnum = ANY (tg.tgattr::int2[])
      )
  ),
  '56/R10 (OPS-11+): para "repaired" ma trigger BEFORE UPDATE OF <kolumna>, ktory naprawia wiersz przy SET NULL');

-- ---------------------------------------------------------------------------
-- SEKCJA 10 (panel): LISTA URZADZEN - LICZNIKI I DEKLARACJA
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_row record;
BEGIN
  PERFORM pg_temp.act_as('56a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  SELECT * INTO v_row FROM public.admin_event_scanner_devices_list('56e00000-0000-0000-0000-0000000000a1') l
   WHERE l.id = '56d00000-0000-0000-0000-000000000001';
  PERFORM pg_temp.assert(v_row.queue_marker_required_at = now()
      AND v_row.superseded_scan_count = 2
      AND v_row.queue_locked_until IS NULL
      AND v_row.queue_fail_window_count = 0,
    '56/panel: lista urzadzen oddaje deklaracje klienta ze znacznikiem i licznik kodow zastapionych');
  SELECT * INTO v_row FROM public.admin_event_scanner_devices_list('56e00000-0000-0000-0000-0000000000a1') l
   WHERE l.id = '56d00000-0000-0000-0000-000000000003';
  PERFORM pg_temp.assert(v_row.queue_marker_required_at IS NULL AND v_row.state = 'expired',
    '56/panel: urzadzenie ze starym klientem widac po braku deklaracji');

  PERFORM pg_temp.act_as(NULL, NULL);
  PERFORM pg_temp.assert_raises_like($q$
    SELECT * FROM public.admin_event_scanner_devices_list('56e00000-0000-0000-0000-0000000000a1')
  $q$, 'forbidden', '56/panel: anonim nie czyta listy urzadzen');
END $$;

SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public._event_checkin_write(uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, timestamptz, text, text, boolean, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_checkin_write(uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, timestamptz, text, text, boolean, text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._event_checkin_write(uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, timestamptz, text, text, boolean, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_scanner_device_note_caps(uuid, uuid, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._event_checkin_crossed(uuid, uuid, uuid, text, timestamptz, timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._event_checkin_day_start(uuid, uuid, timestamptz)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_event_scanner_devices_list(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_event_scanner_devices_list(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_event_checkins_list(uuid, uuid, text, text, text, text, timestamptz, timestamptz, integer, integer, boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_event_checkins_list(uuid, uuid, text, text, text, text, timestamptz, timestamptz, integer, integer, boolean)', 'EXECUTE')
  AND has_column_privilege('authenticated', 'public.event_scanner_devices', 'queue_locked_until', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'public.event_scanner_devices', 'queue_secret', 'SELECT'),
  '56/ACL: funkcje pomocnicze tylko dla service_role, panel dla authenticated (bez anon), sekret kolejki dalej bez grantu');

\echo '== 56 poprawki skanera po przegladzie: koniec =='

ROLLBACK;
