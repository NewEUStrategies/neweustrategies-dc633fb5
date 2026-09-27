-- ============================================================================
-- 51_onsite_offline - TRYB OFFLINE SKANERA: LISTA NA URZADZENIU, POLA DECYZJI
--                     OFFLINE, ZEGAR, OKNO 72 H, KONFLIKTY I OBECNOSC W CRM
--
-- PO CO TEN PLIK ISTNIEJE
-- Migracja 20260926150000_event_scanner_offline.sql swiadomie ZNOSI zasade Z2
-- ("plaszczyzna urzadzenia nie zwraca listy osob") i przepisuje trzy funkcje
-- zapisu odprawy. Obie rzeczy sa nie do sprawdzenia przegladem tekstu:
--   (1) lista offline to dane osobowe na telefonie wolontariusza - bez zgody
--       administratora, dla obcego najemcy albo z e-mailem w srodku MUSI sie
--       nie dac jej pobrac, a kazde pelne pobranie MUSI zostawic slad;
--   (2) przepisane `_event_checkin_write`, `event_checkin_record`
--       i `event_lead_scan_record` musza zachowac stare zachowanie (replay,
--       repeat, blokada po serii pomylek NA ZYWO) i dolozyc nowe: zegar
--       przyciety do now(), skan sprzed 8 dni odrzucony trwalym kodem, pola
--       offline dopisane eskalujaco, okno 72 h po terminie poswiadczenia;
--   (3) trigger obecnosci wzbogaca ISTNIEJACY kontakt CRM i nigdy nie
--       zaklada nowego ani nie cofa odprawy.
--
-- CZEGO TEN PLIK NIE SPRAWDZA
--   * decyzji offline po stronie telefonu (`scannerRoster.decideOffline`) -
--     to tabela parytetu w testach jednostkowych;
--   * samego mostu CRM (14_crm_bridge) - tu tylko jego wywolanie z triggera;
--   * reszty plaszczyzny urzadzenia sprawdzanej w 50_onsite.
--
-- SPRZATANIE. Caly plik pracuje w JEDNEJ transakcji zakonczonej ROLLBACK-iem.
-- UWAGA NA CZAS: now() jest w transakcji stale, wiec "zmiany od `since`"
-- sprawdzamy na wierszach, ktorym wczesniej cofnelismy `updated_at`.
-- ============================================================================

\echo '== 51 skaner offline: lista, pola offline, zegar, okno 72 h, CRM =='

BEGIN;

-- ---------------------------------------------------------------------------
-- SEKCJA 0: SCENOGRAFIA
-- ---------------------------------------------------------------------------
INSERT INTO public.tenants (id, name, slug) VALUES
  ('51000000-0000-0000-0000-0000000000b0', 'Tenant 51 B', 't51b')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('51a00000-0000-0000-0000-0000000000a1', 'offline.admin@example.org'),
  ('51a00000-0000-0000-0000-0000000000a2', 'offline.redaktor@example.org'),
  ('51a00000-0000-0000-0000-0000000000a3', 'offline.uzytkownik@example.org'),
  ('51a00000-0000-0000-0000-0000000000a4', 'offline.super@example.org'),
  ('51a00000-0000-0000-0000-0000000000b1', 'offline.admin.b@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('51a00000-0000-0000-0000-0000000000a1', 'admin', '11111111-1111-1111-1111-111111111111'),
  ('51a00000-0000-0000-0000-0000000000a2', 'editor', '11111111-1111-1111-1111-111111111111'),
  ('51a00000-0000-0000-0000-0000000000a4', 'super_admin', '11111111-1111-1111-1111-111111111111'),
  ('51a00000-0000-0000-0000-0000000000b1', 'admin', '51000000-0000-0000-0000-0000000000b0')
ON CONFLICT DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, display_name, slug) VALUES
  ('51a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Admin 51', 'off-admin'),
  ('51a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'Redaktor 51', 'off-redaktor'),
  ('51a00000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'Uzytkownik 51', 'off-uzytkownik'),
  ('51a00000-0000-0000-0000-0000000000a4', '11111111-1111-1111-1111-111111111111', 'Super 51', 'off-super'),
  ('51a00000-0000-0000-0000-0000000000b1', '51000000-0000-0000-0000-0000000000b0', 'Admin 51 B', 'off-admin-b')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, status,
   registration_mode, registration_flow)
VALUES
  ('51e00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'offline-51', 'Kongres offline', 'Offline congress',
   now() + interval '1 day', 'published', 'rsvp', 'instant'),
  ('51e00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   'offline-51-inny', 'Inne wydarzenie', 'Other event',
   now() + interval '5 days', 'published', 'rsvp', 'instant'),
  ('51e00000-0000-0000-0000-0000000000b1', '51000000-0000-0000-0000-0000000000b0',
   'offline-51-b', 'Kongres B', 'Congress B',
   now() + interval '1 day', 'published', 'rsvp', 'instant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_checkpoints
  (id, tenant_id, event_id, name_pl, name_en, kind, direction_mode,
   access_mode, dedupe_window_seconds)
VALUES
  ('51c00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '51e00000-0000-0000-0000-0000000000a1', 'Brama offline', 'Offline gate',
   'event_entry', 'in_out', 'control', 60),
  ('51c00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   '51e00000-0000-0000-0000-0000000000a1', 'Sala liczona', 'Tracked room',
   'catering', 'in_only', 'track', 60),
  ('51c00000-0000-0000-0000-0000000000b1', '51000000-0000-0000-0000-0000000000b0',
   '51e00000-0000-0000-0000-0000000000b1', 'Brama B', 'Gate B',
   'event_entry', 'in_out', 'control', 60)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.crm_companies (id, tenant_id, name) VALUES
  ('51f00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Sponsor 51')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_sponsors (id, tenant_id, event_id, company_id, snapshot_name) VALUES
  ('51500000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '51e00000-0000-0000-0000-0000000000a1', '51f00000-0000-0000-0000-0000000000a1', 'Sponsor 51')
ON CONFLICT (id) DO NOTHING;

-- Osoby: p1 zatwierdzona z kontaktem CRM, p2 oczekujaca, p3 anulowana,
-- p4 zatwierdzona BEZ kontaktu CRM, p5 w innym wydarzeniu, p6 anulowana
-- pozniej (tombstone delty), p7 anulowana po pobraniu listy (konflikt),
-- p8 do testow zegara i okna 72 h, pB w najemcy B.
INSERT INTO public.event_people
  (id, tenant_id, first_name, last_name, email, phone, job_title, company_text, source)
VALUES
  ('51700000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Olga', 'Obecna', 'olga.obecna@example.org', '+48501000001', 'CTO', 'Alfa', 'organizer'),
  ('51700000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Piotr', 'Oczekujacy', 'piotr.ocz@example.org', '+48501000002', 'CFO', 'Beta', 'organizer'),
  ('51700000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'Anna', 'Anulowana', 'anna.anul@example.org', NULL, NULL, NULL, 'organizer'),
  ('51700000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'Bogdan', 'Bezkontaktu', 'bogdan.bez@example.org', NULL, NULL, NULL, 'organizer'),
  ('51700000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   'Ewa', 'Inna', 'ewa.inna@example.org', NULL, NULL, NULL, 'organizer'),
  ('51700000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
   'Kamil', 'Pozniej', 'kamil.poz@example.org', NULL, NULL, NULL, 'organizer'),
  ('51700000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111',
   'Konrad', 'Konflikt', 'konrad.konf@example.org', NULL, NULL, NULL, 'organizer'),
  ('51700000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111',
   'Zenon', 'Zegar', 'zenon.zegar@example.org', NULL, NULL, NULL, 'organizer'),
  ('51700000-0000-0000-0000-0000000000b1', '51000000-0000-0000-0000-0000000000b0',
   'Beata', 'Obca', 'beata.obca@example.org', NULL, NULL, NULL, 'organizer')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, status, registration_mode, qr_token_hash, qr_issued_at)
VALUES
  ('51300000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '51e00000-0000-0000-0000-0000000000a1', '51700000-0000-0000-0000-000000000001',
   'approved', 'rsvp', encode(extensions.digest('qr51-olga-00000000001', 'sha256'), 'hex'), now()),
  ('51300000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '51e00000-0000-0000-0000-0000000000a1', '51700000-0000-0000-0000-000000000002',
   'pending', 'rsvp', encode(extensions.digest('qr51-piotr-0000000001', 'sha256'), 'hex'), now()),
  ('51300000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   '51e00000-0000-0000-0000-0000000000a1', '51700000-0000-0000-0000-000000000003',
   'approved', 'rsvp', encode(extensions.digest('qr51-anna-00000000001', 'sha256'), 'hex'), now()),
  ('51300000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   '51e00000-0000-0000-0000-0000000000a1', '51700000-0000-0000-0000-000000000004',
   'approved', 'rsvp', encode(extensions.digest('qr51-bogdan-000000001', 'sha256'), 'hex'), now()),
  ('51300000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   '51e00000-0000-0000-0000-0000000000a2', '51700000-0000-0000-0000-000000000005',
   'approved', 'rsvp', encode(extensions.digest('qr51-ewa-000000000001', 'sha256'), 'hex'), now()),
  ('51300000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
   '51e00000-0000-0000-0000-0000000000a1', '51700000-0000-0000-0000-000000000006',
   'approved', 'rsvp', encode(extensions.digest('qr51-kamil-0000000001', 'sha256'), 'hex'), now()),
  ('51300000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111',
   '51e00000-0000-0000-0000-0000000000a1', '51700000-0000-0000-0000-000000000007',
   'approved', 'rsvp', encode(extensions.digest('qr51-konrad-000000001', 'sha256'), 'hex'), now()),
  ('51300000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111',
   '51e00000-0000-0000-0000-0000000000a1', '51700000-0000-0000-0000-000000000008',
   'approved', 'rsvp', encode(extensions.digest('qr51-zenon-0000000001', 'sha256'), 'hex'), now()),
  ('51300000-0000-0000-0000-0000000000b1', '51000000-0000-0000-0000-0000000000b0',
   '51e00000-0000-0000-0000-0000000000b1', '51700000-0000-0000-0000-0000000000b1',
   'approved', 'rsvp', encode(extensions.digest('qr51-beata-0000000001', 'sha256'), 'hex'), now())
ON CONFLICT (id) DO NOTHING;

-- Kontakt CRM TYLKO dla p1 - p4 nie ma kontaktu i most bez `p_create` go
-- nie zalozy.
INSERT INTO public.crm_leads (id, tenant_id, email, first_name, last_name, source_type, tags)
VALUES
  ('51d00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'olga.obecna@example.org', 'Olga', 'Obecna', 'newsletter', ARRAY['lista:energia'])
ON CONFLICT (id) DO NOTHING;

-- Poswiadczenia: D1 z lista offline, D2 bez zgody, D3 stoiskowe, D4 wygasle
-- godzine temu (okno 72 h), D5 wygasle 80 h temu, D6 uniewaznione, D7 do
-- blokady na zywo, D8 zapauzowane, D9 stoiskowe wygasle w oknie, DB najemcy B.
INSERT INTO public.event_scanner_devices
  (id, tenant_id, event_id, checkpoint_id, sponsor_id, label, token_hash, token_prefix,
   scopes, is_active, expires_at, revoked_at, offline_roster)
VALUES
  ('51d10000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '51e00000-0000-0000-0000-0000000000a1', NULL, NULL, 'Offline 1',
   encode(extensions.digest('tok51-offline-000001', 'sha256'), 'hex'), 'tok51-of',
   ARRAY['checkin']::text[], true, now() + interval '2 days', NULL, true),
  ('51d10000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '51e00000-0000-0000-0000-0000000000a1', NULL, NULL, 'Bez listy',
   encode(extensions.digest('tok51-bezlisty-00001', 'sha256'), 'hex'), 'tok51-be',
   ARRAY['checkin']::text[], true, now() + interval '2 days', NULL, false),
  ('51d10000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   '51e00000-0000-0000-0000-0000000000a1', NULL, '51500000-0000-0000-0000-0000000000a1',
   'Stoisko 51', encode(extensions.digest('tok51-stoisko-00001', 'sha256'), 'hex'), 'tok51-st',
   ARRAY['lead']::text[], true, now() + interval '2 days', NULL, false),
  ('51d10000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   '51e00000-0000-0000-0000-0000000000a1', NULL, NULL, 'Wygasle w oknie',
   encode(extensions.digest('tok51-wygasle-00001', 'sha256'), 'hex'), 'tok51-wy',
   ARRAY['checkin']::text[], true, now() - interval '1 hour', NULL, true),
  ('51d10000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   '51e00000-0000-0000-0000-0000000000a1', NULL, NULL, 'Wygasle dawno',
   encode(extensions.digest('tok51-dawno-0000001', 'sha256'), 'hex'), 'tok51-da',
   ARRAY['checkin']::text[], true, now() - interval '80 hours', NULL, false),
  ('51d10000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
   '51e00000-0000-0000-0000-0000000000a1', NULL, NULL, 'Uniewaznione',
   encode(extensions.digest('tok51-cofniete-00001', 'sha256'), 'hex'), 'tok51-co',
   ARRAY['checkin']::text[], false, now() + interval '2 days', now() - interval '1 hour', false),
  ('51d10000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111',
   '51e00000-0000-0000-0000-0000000000a1', NULL, NULL, 'Na zywo',
   encode(extensions.digest('tok51-nazywo-000001', 'sha256'), 'hex'), 'tok51-na',
   ARRAY['checkin']::text[], true, now() + interval '2 days', NULL, false),
  ('51d10000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111',
   '51e00000-0000-0000-0000-0000000000a1', NULL, NULL, 'Pauza',
   encode(extensions.digest('tok51-pauza-0000001', 'sha256'), 'hex'), 'tok51-pa',
   ARRAY['checkin']::text[], false, now() - interval '1 hour', NULL, false),
  ('51d10000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111',
   '51e00000-0000-0000-0000-0000000000a1', NULL, '51500000-0000-0000-0000-0000000000a1',
   'Stoisko wygasle', encode(extensions.digest('tok51-stoiskowyg-01', 'sha256'), 'hex'), 'tok51-sw',
   ARRAY['lead']::text[], true, now() - interval '1 hour', NULL, false),
  ('51d10000-0000-0000-0000-0000000000b1', '51000000-0000-0000-0000-0000000000b0',
   '51e00000-0000-0000-0000-0000000000b1', NULL, NULL, 'Offline B',
   encode(extensions.digest('tok51-offline-b-001', 'sha256'), 'hex'), 'tok51-ob',
   ARRAY['checkin']::text[], true, now() + interval '2 days', NULL, true)
ON CONFLICT (id) DO NOTHING;

-- Cofamy `updated_at` calej scenografii o dwie godziny (triggery dotykajace
-- `updated_at` wylaczone na czas tej jednej zmiany) - dzieki temu delta
-- "od pelnego pobrania" widzi WYLACZNIE to, co zmienimy pozniej.
ALTER TABLE public.event_registrations DISABLE TRIGGER USER;
ALTER TABLE public.event_people DISABLE TRIGGER USER;
ALTER TABLE public.event_groups DISABLE TRIGGER USER;
UPDATE public.event_registrations SET status = 'cancelled', cancelled_at = now() - interval '3 hours'
 WHERE id = '51300000-0000-0000-0000-000000000003';
UPDATE public.event_registrations SET updated_at = now() - interval '2 hours'
 WHERE id::text LIKE '51300000-%';
UPDATE public.event_people SET updated_at = now() - interval '2 hours'
 WHERE id::text LIKE '51700000-%';
UPDATE public.event_groups SET updated_at = now() - interval '2 hours'
 WHERE event_id IN ('51e00000-0000-0000-0000-0000000000a1', '51e00000-0000-0000-0000-0000000000b1');
ALTER TABLE public.event_groups ENABLE TRIGGER USER;
ALTER TABLE public.event_people ENABLE TRIGGER USER;
ALTER TABLE public.event_registrations ENABLE TRIGGER USER;

-- ---------------------------------------------------------------------------
-- SEKCJA 1: SCHEMAT I GRANTY
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'event_scanner_devices'
      AND column_name IN ('offline_roster', 'roster_downloaded_at', 'roster_download_count')) = 3
  AND (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'event_checkins'
      AND column_name IN ('offline_admitted', 'offline_outcome', 'roster_generated_at')) = 3,
  '51/schemat: kolumny listy offline na urzadzeniu i decyzji offline w dzienniku');

SELECT pg_temp.assert(
  (SELECT column_default = 'false' AND is_nullable = 'NO'
     FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'event_scanner_devices'
      AND column_name = 'offline_roster'),
  '51/schemat: lista offline jest DOMYSLNIE wylaczona (zgoda administratora)');

SELECT pg_temp.assert(
  has_column_privilege('authenticated', 'public.event_scanner_devices', 'offline_roster', 'SELECT')
  AND has_column_privilege('authenticated', 'public.event_scanner_devices', 'roster_downloaded_at', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'public.event_scanner_devices', 'token_hash', 'SELECT'),
  '51/granty: panel czyta kolumny listy offline, hasz tokenu nadal odciety');

SELECT pg_temp.assert(
  has_function_privilege('anon', 'public.event_scanner_roster(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._event_scanner_device_auth_sync(text, text, timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_scanner_device_auth_sync(text, text, timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_event_scanner_device_set_offline(jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_event_scanner_device_set_offline(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.tg_event_registrations_attended_crm()', 'EXECUTE'),
  '51/granty: lista dla plaszczyzny urzadzenia, bramka synchronizacji i trigger tylko wewnatrz bazy');

SELECT pg_temp.assert(
  NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'admin_event_checkins_list' AND p.pronargs = 10
  )
  AND EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'admin_event_checkins_list' AND p.pronargs = 11
  ),
  '51/schemat: dziennik odpraw ma JEDNA wersje (11 argumentow) - bez niejednoznacznego przeciazenia');

SELECT pg_temp.assert_raises_like($q$
  INSERT INTO public.event_checkins
    (tenant_id, event_id, checkpoint_id, person_id, direction, result, source,
     dedupe_range, device_id, offline_admitted, offline_outcome)
  VALUES ('11111111-1111-1111-1111-111111111111', '51e00000-0000-0000-0000-0000000000a1',
          '51c00000-0000-0000-0000-0000000000a1', '51700000-0000-0000-0000-000000000001',
          'out', 'granted', 'qr_code', 'empty'::tstzrange,
          '51d10000-0000-0000-0000-000000000001', true, 'wymyslony')
$q$, 'event_checkins_offline_outcome_values',
  '51/ODMOWA: nieznany wynik offline odbija sie od CHECK-a');

SELECT pg_temp.assert_raises_like($q$
  INSERT INTO public.event_checkins
    (tenant_id, event_id, checkpoint_id, person_id, direction, result, source,
     dedupe_range, device_id, offline_admitted, offline_outcome)
  VALUES ('11111111-1111-1111-1111-111111111111', '51e00000-0000-0000-0000-0000000000a1',
          '51c00000-0000-0000-0000-0000000000a1', '51700000-0000-0000-0000-000000000001',
          'out', 'granted', 'qr_code', 'empty'::tstzrange,
          '51d10000-0000-0000-0000-000000000001', true, NULL)
$q$, 'event_checkins_offline_pair',
  '51/ODMOWA: decyzja offline bez wyniku offline (i odwrotnie) jest niespojna');

-- ---------------------------------------------------------------------------
-- SEKCJA 2: KONFIGURACJA SKANERA - ZEGAR SERWERA I STAN LISTY
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb;
BEGIN
  v := public.event_scanner_bootstrap(jsonb_build_object('device_token', 'tok51-offline-000001'));
  PERFORM pg_temp.assert((v->>'server_now')::timestamptz = now(),
    '51/bootstrap: odpowiedz niesie zegar serwera (przesuniecie zegara urzadzenia)');
  PERFORM pg_temp.assert((v->>'offline_roster')::boolean AND v ? 'roster_downloaded_at',
    '51/bootstrap: urzadzenie ze zgoda wie, ze moze pobrac liste offline');

  v := public.event_scanner_bootstrap(jsonb_build_object('device_token', 'tok51-bezlisty-00001'));
  PERFORM pg_temp.assert(NOT (v->>'offline_roster')::boolean,
    '51/bootstrap: urzadzenie bez zgody widzi offline_roster = false');
END $$;

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_scanner_bootstrap(jsonb_build_object('device_token', 'tok51-wygasle-00001'))
$q$, 'device_expired',
  '51/bootstrap: wygasle poswiadczenie NIE dostaje konfiguracji (okno 72 h dotyczy tylko synchronizacji)');

-- ---------------------------------------------------------------------------
-- SEKCJA 3: LISTA OFFLINE - BRAMKA
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_scanner_roster(jsonb_build_object('device_token', 'tok51-bezlisty-00001'))
$q$, 'roster_disabled',
  '51/lista: urzadzenie BEZ zgody administratora nie pobierze listy osob');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_scanner_roster(jsonb_build_object('device_token', 'tok51-stoisko-00001'))
$q$, 'device_scope_missing',
  '51/lista: poswiadczenie stoiskowe (bez zakresu checkin) nie pobierze listy');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_scanner_roster(jsonb_build_object('device_token', 'tok51-nieznany-0001'))
$q$, 'invalid_device_token',
  '51/lista: token nieznany odrzucony');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_scanner_roster(jsonb_build_object('device_token', 'tok51-cofniete-00001'))
$q$, 'device_revoked',
  '51/lista: poswiadczenie uniewaznione nie pobierze listy');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_scanner_roster(jsonb_build_object('device_token', 'tok51-wygasle-00001'))
$q$, 'device_expired',
  '51/lista: poswiadczenie po terminie nie pobierze listy (NAWET w oknie 72 h)');

-- ---------------------------------------------------------------------------
-- SEKCJA 4: LISTA OFFLINE - PELNE POBRANIE, MINIMUM DANYCH, AUDYT, DLAWIK
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t51_state (k text PRIMARY KEY, v text) ON COMMIT DROP;

DO $$
DECLARE
  v jsonb;
  v_keys text[];
  v_row jsonb;
BEGIN
  v := public.event_scanner_roster(jsonb_build_object('device_token', 'tok51-offline-000001'));
  INSERT INTO t51_state VALUES ('full_generated_at', v->>'generated_at');

  PERFORM pg_temp.assert((v->>'full')::boolean AND v->>'next_after' IS NULL,
    '51/lista: pierwsze pobranie jest PELNE i miesci sie na jednej stronie');

  -- Aktywne zapisy z tokenem TEGO wydarzenia: p1, p2, p4, p6, p7, p8.
  PERFORM pg_temp.assert(jsonb_array_length(v->'rows') = 6 AND (v->>'total')::integer = 6,
    '51/lista: pelna lista = aktywne zapisy z tokenem tego wydarzenia (bez anulowanych)');
  PERFORM pg_temp.assert(jsonb_array_length(v->'removed') = 0,
    '51/lista: pelne pobranie nie ma usunietych');

  PERFORM pg_temp.assert(NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v->'rows') x
       WHERE x->>'r' IN ('51300000-0000-0000-0000-000000000003',
                         '51300000-0000-0000-0000-000000000005',
                         '51300000-0000-0000-0000-0000000000b1')),
    '51/lista: bez zapisu anulowanego, zapisu z innego wydarzenia i zapisu obcego najemcy');

  SELECT x INTO v_row FROM jsonb_array_elements(v->'rows') x
   WHERE x->>'r' = '51300000-0000-0000-0000-000000000001';
  PERFORM pg_temp.assert(
    v_row->>'h' = encode(extensions.digest('qr51-olga-00000000001', 'sha256'), 'hex')
    AND v_row->>'s' = 'approved' AND v_row->>'fn' = 'Olga' AND v_row->>'co' = 'Alfa'
    AND (v_row->>'bp')::boolean = false,
    '51/lista: wiersz niesie SKROT tokenu (nie token), status, imie i firme');

  SELECT array_agg(k ORDER BY k) INTO v_keys
    FROM (SELECT DISTINCT jsonb_object_keys(x) AS k FROM jsonb_array_elements(v->'rows') x) s;
  PERFORM pg_temp.assert(
    v_keys = ARRAY['bp', 'co', 'fn', 'g_en', 'g_pl', 'gc', 'h', 'ln', 'r', 's', 't_en', 't_pl'],
    '51/PRYWATNOSC: wiersz listy ma DOKLADNIE minimalne pola - bez e-maila, telefonu, stanowiska i id osoby');
  PERFORM pg_temp.assert(
    position('@' IN v::text) = 0 AND position('+4850' IN v::text) = 0
    AND position('CTO' IN v::text) = 0,
    '51/PRYWATNOSC: w calej odpowiedzi nie ma adresu e-mail, telefonu ani stanowiska');
  PERFORM pg_temp.assert(position('qr51-olga' IN v::text) = 0,
    '51/bezpieczenstwo: jawny token biletu nie wystepuje w odpowiedzi');
END $$;

SELECT pg_temp.assert(
  (SELECT roster_download_count = 1 AND roster_downloaded_at = now()
     FROM public.event_scanner_devices WHERE id = '51d10000-0000-0000-0000-000000000001'),
  '51/audyt: pelne pobranie podbija licznik i stempluje chwile pobrania');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.domain_events
    WHERE event_type = 'event_scanner_device.roster_downloaded.v1'
      AND aggregate_id = '51d10000-0000-0000-0000-000000000001'
      AND actor_id IS NULL
      AND (payload->>'rows')::integer = 6
      AND payload->>'event_id' = '51e00000-0000-0000-0000-0000000000a1') = 1,
  '51/audyt: pelne pobranie zostawia zdarzenie roster_downloaded.v1 (aktor NULL, liczba wierszy)');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_scanner_roster(jsonb_build_object('device_token', 'tok51-offline-000001'))
$q$, 'roster_throttled',
  '51/dlawik: drugie pelne pobranie w ciagu 30 s jest odrzucone');

SELECT pg_temp.assert(
  (SELECT roster_download_count FROM public.event_scanner_devices
    WHERE id = '51d10000-0000-0000-0000-000000000001') = 1,
  '51/dlawik: odrzucone pobranie nie podbija licznika');

-- STRONICOWANIE: limit 2, kolejne strony po `after`, bez dlawika w obrebie pobrania.
DO $$
DECLARE v1 jsonb; v2 jsonb; v3 jsonb; v4 jsonb;
BEGIN
  v1 := public.event_scanner_roster(jsonb_build_object(
    'device_token', 'tok51-offline-000001', 'after', '00000000-0000-0000-0000-000000000000', 'limit', 2));
  PERFORM pg_temp.assert(jsonb_array_length(v1->'rows') = 2
      AND v1->>'next_after' = v1->'rows'->1->>'r',
    '51/strony: pelna strona oddaje kursor = ostatni identyfikator zapisu');
  v2 := public.event_scanner_roster(jsonb_build_object(
    'device_token', 'tok51-offline-000001', 'after', v1->>'next_after', 'limit', 2));
  v3 := public.event_scanner_roster(jsonb_build_object(
    'device_token', 'tok51-offline-000001', 'after', v2->>'next_after', 'limit', 2));
  v4 := public.event_scanner_roster(jsonb_build_object(
    'device_token', 'tok51-offline-000001', 'after', v3->>'next_after', 'limit', 2));
  PERFORM pg_temp.assert(
    jsonb_array_length(v2->'rows') = 2 AND jsonb_array_length(v3->'rows') = 2
    AND jsonb_array_length(v4->'rows') = 0 AND v4->>'next_after' IS NULL,
    '51/strony: trzy pelne strony po 2 i pusta czwarta bez kursora');
  PERFORM pg_temp.assert((v1->'rows'->0->>'r') < (v2->'rows'->0->>'r')
      AND (v2->'rows'->1->>'r') < (v3->'rows'->0->>'r'),
    '51/strony: strony ida rosnaco po identyfikatorze, bez nakladania');
  PERFORM pg_temp.assert(v2->>'total' IS NULL,
    '51/strony: kolejna strona nie liczy calosci i nie audytuje drugi raz');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.domain_events
      WHERE event_type = 'event_scanner_device.roster_downloaded.v1'
        AND aggregate_id = '51d10000-0000-0000-0000-000000000001') = 1,
    '51/strony: jedno pobranie = jedno zdarzenie audytowe');
END $$;

-- Kolejna strona PO 10 minutach od startu pobrania nie przejdzie - inaczej
-- "strona od zera" bylaby pelnym pobraniem bez audytu.
DO $$
BEGIN
  UPDATE public.event_scanner_devices SET roster_downloaded_at = now() - interval '11 minutes'
   WHERE id = '51d10000-0000-0000-0000-000000000001';
  PERFORM pg_temp.assert_raises_like($q$
    SELECT public.event_scanner_roster(jsonb_build_object(
      'device_token', 'tok51-offline-000001', 'after', '00000000-0000-0000-0000-000000000000'))
  $q$, 'roster_resync_required',
    '51/dlawik: strona bez swiezego startu pelnego pobrania wymaga nowego startu');
  UPDATE public.event_scanner_devices SET roster_downloaded_at = now()
   WHERE id = '51d10000-0000-0000-0000-000000000001';
END $$;

-- ---------------------------------------------------------------------------
-- SEKCJA 5: LISTA OFFLINE - DELTA Z USUNIETYMI
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb; v_since text := (SELECT s.v FROM t51_state s WHERE s.k = 'full_generated_at');
BEGIN
  -- Zmiany po pelnym pobraniu: p2 zatwierdzone, p6 anulowane.
  UPDATE public.event_registrations SET status = 'approved'
   WHERE id = '51300000-0000-0000-0000-000000000002';
  UPDATE public.event_registrations SET status = 'cancelled', cancelled_at = now()
   WHERE id = '51300000-0000-0000-0000-000000000006';

  v := public.event_scanner_roster(jsonb_build_object(
    'device_token', 'tok51-offline-000001', 'since', v_since));
  PERFORM pg_temp.assert(NOT (v->>'full')::boolean,
    '51/delta: odpowiedz z `since` jest przyrostowa');
  PERFORM pg_temp.assert(
    jsonb_array_length(v->'rows') = 1
    AND v->'rows'->0->>'r' = '51300000-0000-0000-0000-000000000002'
    AND v->'rows'->0->>'s' = 'approved',
    '51/delta: oddaje WYLACZNIE zapis zmieniony od pelnego pobrania, z nowym statusem');
  PERFORM pg_temp.assert(v->'removed' = '["51300000-0000-0000-0000-000000000006"]'::jsonb,
    '51/delta: anulowany zapis wraca jako usuniety (tombstone), bez danych osoby');
END $$;

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_scanner_roster(jsonb_build_object(
    'device_token', 'tok51-offline-000001', 'since', '1970-01-01T00:00:00Z'))
$q$, 'roster_resync_required',
  '51/delta: "delta od 1970" (obejscie audytu) wymaga pelnego pobrania');

-- Pelne pobranie starsze niz 6 h: delta nie widzi wierszy usunietych
-- kaskadowo (RODO), wiec baza wymusza pelna liste.
DO $$
DECLARE v_prev timestamptz;
BEGIN
  SELECT roster_downloaded_at INTO v_prev FROM public.event_scanner_devices
   WHERE id = '51d10000-0000-0000-0000-000000000001';
  UPDATE public.event_scanner_devices SET roster_downloaded_at = now() - interval '7 hours'
   WHERE id = '51d10000-0000-0000-0000-000000000001';
  PERFORM pg_temp.assert_raises_like($q$
    SELECT public.event_scanner_roster(jsonb_build_object(
      'device_token', 'tok51-offline-000001', 'since', now() - interval '1 minute'))
  $q$, 'roster_resync_required',
    '51/delta: po 6 godzinach od pelnego pobrania delta wymaga pelnej listy');
  UPDATE public.event_scanner_devices SET roster_downloaded_at = v_prev
   WHERE id = '51d10000-0000-0000-0000-000000000001';
END $$;

-- IZOLACJA NAJEMCY: lista urzadzenia B zna tylko zapisy najemcy B.
DO $$
DECLARE v jsonb;
BEGIN
  v := public.event_scanner_roster(jsonb_build_object('device_token', 'tok51-offline-b-001'));
  PERFORM pg_temp.assert(
    jsonb_array_length(v->'rows') = 1
    AND v->'rows'->0->>'r' = '51300000-0000-0000-0000-0000000000b1',
    '51/IZOLACJA: urzadzenie najemcy B widzi wylacznie zapis najemcy B');
END $$;

-- ---------------------------------------------------------------------------
-- SEKCJA 6: ZAPIS ODPRAWY Z POLAMI OFFLINE
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb; v_row public.event_checkins;
BEGIN
  -- ONLINE (bez pol offline): kolumny offline zostaja puste - stare zachowanie.
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok51-offline-000001', 'code', 'qr51-bogdan-000000001',
    'checkpoint_id', '51c00000-0000-0000-0000-0000000000a1',
    'client_scan_uid', 'scan51-bogdan-01'));
  SELECT * INTO v_row FROM public.event_checkins WHERE id = (v->>'checkin_id')::uuid;
  PERFORM pg_temp.assert(v->>'outcome' = 'granted' AND v_row.offline_admitted IS NULL
      AND v_row.offline_outcome IS NULL AND v_row.roster_generated_at IS NULL,
    '51/online: skan bez pol offline zostawia kolumny offline puste');

  -- OFFLINE WPUSZCZONY i potwierdzony przez serwer.
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok51-offline-000001', 'code', 'qr51-olga-00000000001',
    'checkpoint_id', '51c00000-0000-0000-0000-0000000000a1',
    'client_scan_uid', 'scan51-olga-0001',
    'device_scanned_at', now() - interval '10 minutes',
    'queued', true,
    'offline_admitted', true, 'offline_outcome', 'granted',
    'roster_generated_at', now() - interval '20 minutes'));
  SELECT * INTO v_row FROM public.event_checkins WHERE id = (v->>'checkin_id')::uuid;
  PERFORM pg_temp.assert(v->>'outcome' = 'granted' AND (v->>'admit')::boolean,
    '51/offline: skan z decyzja offline przechodzi normalnym zapisem odprawy');
  PERFORM pg_temp.assert(v_row.offline_admitted AND v_row.offline_outcome = 'granted'
      AND v_row.roster_generated_at = now() - interval '20 minutes',
    '51/offline: decyzja urzadzenia i wersja listy sa utrwalone w wierszu dziennika');
  PERFORM pg_temp.assert(v_row.device_scanned_at = now() - interval '10 minutes',
    '51/offline: czas skanu z urzadzenia (przeszly) trafia do dziennika bez zmian');

  -- REPLAY tego samego skanu z INNYMI polami: wiersz sie nie zmienia.
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok51-offline-000001', 'code', 'qr51-olga-00000000001',
    'checkpoint_id', '51c00000-0000-0000-0000-0000000000a1',
    'client_scan_uid', 'scan51-olga-0001',
    'offline_admitted', false, 'offline_outcome', 'denied_direction'));
  SELECT * INTO v_row FROM public.event_checkins WHERE id = (v->>'checkin_id')::uuid;
  PERFORM pg_temp.assert(v->>'outcome' = 'replay' AND v_row.offline_admitted
      AND v_row.offline_outcome = 'granted',
    '51/offline: ponowna wysylka nie cofa decyzji offline (dopisanie tylko eskalujace)');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_checkins WHERE client_scan_uid = 'scan51-olga-0001') = 1,
    '51/offline: replay nie tworzy drugiego wiersza');

  -- `offline_admitted` bez `offline_outcome` jest ignorowane (para spojna).
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok51-offline-000001', 'code', 'qr51-olga-00000000001',
    'checkpoint_id', '51c00000-0000-0000-0000-0000000000a1', 'direction', 'out',
    'client_scan_uid', 'scan51-olga-0002', 'offline_admitted', true));
  SELECT * INTO v_row FROM public.event_checkins WHERE id = (v->>'checkin_id')::uuid;
  PERFORM pg_temp.assert(v_row.offline_admitted IS NULL AND v_row.offline_outcome IS NULL,
    '51/offline: sama flaga bez wyniku offline nie zapisuje polowicznej decyzji');
END $$;

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok51-offline-000001', 'code', 'qr51-olga-00000000001',
    'checkpoint_id', '51c00000-0000-0000-0000-0000000000a1',
    'offline_admitted', true, 'offline_outcome', 'zgaduje'))
$q$, 'invalid_payload',
  '51/ODMOWA: nieznany wynik offline to trwaly blad ladunku (invalid_payload)');

-- KONFLIKT: zapis anulowany po pobraniu listy, urzadzenie wpuscilo offline.
DO $$
DECLARE v jsonb; v_row public.event_checkins;
BEGIN
  UPDATE public.event_registrations SET status = 'cancelled', cancelled_at = now()
   WHERE id = '51300000-0000-0000-0000-000000000007';
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok51-offline-000001', 'code', 'qr51-konrad-000000001',
    'checkpoint_id', '51c00000-0000-0000-0000-0000000000a1',
    'client_scan_uid', 'scan51-konrad-01',
    'device_scanned_at', now() - interval '5 minutes',
    'offline_admitted', true, 'offline_outcome', 'granted'));
  SELECT * INTO v_row FROM public.event_checkins WHERE id = (v->>'checkin_id')::uuid;
  PERFORM pg_temp.assert(v->>'outcome' = 'denied_not_registered' AND NOT (v->>'admit')::boolean,
    '51/konflikt: serwer odmawia zapisowi anulowanemu po pobraniu listy');
  PERFORM pg_temp.assert(v_row.offline_admitted AND v_row.result = 'denied_not_registered',
    '51/konflikt: wiersz odmowy pamieta, ze urzadzenie WPUSCILO bez sieci');
  PERFORM pg_temp.assert(
    (SELECT attended_at IS NULL FROM public.event_registrations
      WHERE id = '51300000-0000-0000-0000-000000000007'),
    '51/konflikt: konflikt NIE stempluje obecnosci - decyduje czlowiek');
END $$;

-- ESKALACJA NA POWTORZENIU: odmowa online, potem wpuszczenie offline w oknie.
DO $$
DECLARE v jsonb; v_first uuid; v_row public.event_checkins;
BEGIN
  UPDATE public.event_registrations SET status = 'pending'
   WHERE id = '51300000-0000-0000-0000-000000000002';
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok51-offline-000001', 'code', 'qr51-piotr-0000000001',
    'checkpoint_id', '51c00000-0000-0000-0000-0000000000a1',
    'client_scan_uid', 'scan51-piotr-01'));
  v_first := (v->>'checkin_id')::uuid;
  PERFORM pg_temp.assert(v->>'outcome' = 'denied_registration_status',
    '51/eskalacja: zapis oczekujacy jest odmowa online');

  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok51-offline-000001', 'code', 'qr51-piotr-0000000001',
    'checkpoint_id', '51c00000-0000-0000-0000-0000000000a1',
    'client_scan_uid', 'scan51-piotr-02',
    'offline_admitted', true, 'offline_outcome', 'granted'));
  SELECT * INTO v_row FROM public.event_checkins WHERE id = v_first;
  PERFORM pg_temp.assert(v->>'outcome' = 'repeat' AND (v->>'checkin_id')::uuid = v_first,
    '51/eskalacja: drugi skan w oknie jest powtorzeniem pierwszego wiersza');
  PERFORM pg_temp.assert(v_row.offline_admitted AND v_row.offline_outcome = 'granted',
    '51/eskalacja: powtorzenie eskaluje wiersz do "wpuszczony offline" - konflikt jest widoczny');
END $$;

-- ---------------------------------------------------------------------------
-- SEKCJA 7: ZEGAR URZADZENIA
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb; v_row public.event_checkins;
BEGIN
  -- Zegar spieszy sie o 10 minut: dawniej CHECK device_time_sane wywracal
  -- zapis bledem bez prefiksu (klient ponawial w nieskonczonosc).
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok51-offline-000001', 'code', 'qr51-zenon-0000000001',
    'checkpoint_id', '51c00000-0000-0000-0000-0000000000a1',
    'client_scan_uid', 'scan51-zenon-01',
    'device_scanned_at', now() + interval '10 minutes'));
  SELECT * INTO v_row FROM public.event_checkins WHERE id = (v->>'checkin_id')::uuid;
  PERFORM pg_temp.assert(v->>'outcome' = 'granted' AND v_row.device_scanned_at = now(),
    '51/zegar: czas z przyszlosci jest przyciety do chwili serwera, zapis przechodzi');
  PERFORM pg_temp.assert(
    (SELECT attended_at FROM public.event_registrations
      WHERE id = '51300000-0000-0000-0000-000000000008') = now(),
    '51/zegar: obecnosc stemplowana przycietym czasem, nie czasem z przyszlosci');
END $$;

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok51-offline-000001', 'code', 'qr51-zenon-0000000001',
    'checkpoint_id', '51c00000-0000-0000-0000-0000000000a1', 'direction', 'out',
    'client_scan_uid', 'scan51-zenon-02',
    'device_scanned_at', now() - interval '8 days'))
$q$, 'device_time_out_of_range',
  '51/zegar: skan sprzed 8 dni odbija sie TRWALYM kodem, nie bledem CHECK-a');

-- ---------------------------------------------------------------------------
-- SEKCJA 8: SERIA NIEZNANYCH KODOW Z KOLEJKI NIE BLOKUJE URZADZENIA
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb; i integer; v_dev public.event_scanner_devices;
BEGIN
  FOR i IN 1..25 LOOP
    v := public.event_checkin_record(jsonb_build_object(
      'device_token', 'tok51-offline-000001', 'code', 'stary-bilet-' || i,
      'checkpoint_id', '51c00000-0000-0000-0000-0000000000a1',
      'device_scanned_at', now() - interval '30 minutes', 'queued', true));
  END LOOP;
  SELECT * INTO v_dev FROM public.event_scanner_devices WHERE id = '51d10000-0000-0000-0000-000000000001';
  PERFORM pg_temp.assert(v->>'outcome' = 'unknown_code' AND NOT (v->>'device_locked')::boolean,
    '51/kolejka: nieznany kod z kolejki nie wpuszcza i nie blokuje');
  PERFORM pg_temp.assert(v_dev.locked_until IS NULL AND v_dev.fail_window_count = 0,
    '51/kolejka: 25 nieznanych kodow z kolejki NIE blokuje urzadzenia (okno nietkniete)');
  PERFORM pg_temp.assert(v_dev.failed_scan_count = 25,
    '51/kolejka: licznik monotoniczny nadal liczy kazdy nieznany kod (sygnal dla panelu)');

  -- Kontrast: to samo NA ZYWO blokuje po 20 (stare zachowanie zostaje).
  FOR i IN 1..20 LOOP
    v := public.event_checkin_record(jsonb_build_object(
      'device_token', 'tok51-nazywo-000001', 'code', 'zgadywany-' || i,
      'checkpoint_id', '51c00000-0000-0000-0000-0000000000a1'));
  END LOOP;
  PERFORM pg_temp.assert((v->>'device_locked')::boolean
      AND (SELECT locked_until > now() FROM public.event_scanner_devices
            WHERE id = '51d10000-0000-0000-0000-000000000007'),
    '51/zywo: 20 nieznanych kodow na zywo nadal blokuje urzadzenie');

  -- Skan leadu z kolejki: ta sama regula.
  FOR i IN 1..21 LOOP
    v := public.event_lead_scan_record(jsonb_build_object(
      'device_token', 'tok51-stoisko-00001', 'code', 'lead-stary-' || i, 'queued', true));
  END LOOP;
  PERFORM pg_temp.assert(
    (SELECT locked_until IS NULL AND failed_scan_count = 21 FROM public.event_scanner_devices
      WHERE id = '51d10000-0000-0000-0000-000000000003'),
    '51/kolejka: nieznane kody leadow z kolejki tez nie blokuja stoiska');
END $$;

-- ---------------------------------------------------------------------------
-- SEKCJA 9: OKNO 72 H PO TERMINIE POSWIADCZENIA
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb;
BEGIN
  -- Olga zgadza sie na przekazanie danych partnerom - bez tego lead i tak
  -- nie oddaje tozsamosci, wiec asercje "bez danych w oknie" bylyby puste.
  UPDATE public.event_people SET consent_partner_sharing_at = now() - interval '1 day'
   WHERE id = '51700000-0000-0000-0000-000000000001';

  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok51-wygasle-00001', 'code', 'qr51-olga-00000000001',
    'checkpoint_id', '51c00000-0000-0000-0000-0000000000a2',
    'client_scan_uid', 'scan51-grace-01',
    'device_scanned_at', now() - interval '2 hours', 'queued', true));
  PERFORM pg_temp.assert(v->>'outcome' = 'granted',
    '51/okno: skan sprzed terminu z urzadzenia wygaslego godzine temu jest przyjety');
  PERFORM pg_temp.assert(v->'person' = 'null'::jsonb,
    '51/okno: odprawa przyjeta WYLACZNIE dzieki oknu nie oddaje karty osoby wygaslemu urzadzeniu');

  v := public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok51-stoiskowyg-01', 'code', 'qr51-olga-00000000001',
    'device_scanned_at', now() - interval '2 hours', 'queued', true));
  PERFORM pg_temp.assert(v->>'outcome' = 'saved',
    '51/okno: lead sprzed terminu z wygaslego stoiska jest przyjety');
  PERFORM pg_temp.assert((v->>'consent')::boolean AND v->'person' = 'null'::jsonb
      AND position('olga.obecna@example.org' IN v::text) = 0
      AND position('+48501000001' IN v::text) = 0,
    '51/PRYWATNOSC: lead w oknie 72 h zapisany ze zgoda, ale BEZ e-maila i telefonu na wygaslym stoisku');

  -- Kontrapunkt: to samo na WAZNYM stoisku oddaje dane (zgoda jest), wiec
  -- to okno, a nie brak zgody, chowa je powyzej.
  v := public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok51-stoisko-00001', 'code', 'qr51-olga-00000000001'));
  PERFORM pg_temp.assert(v->'person'->>'email' = 'olga.obecna@example.org'
      AND v->'person'->>'phone' = '+48501000001',
    '51/okno: wazne poswiadczenie stoiska z ta sama zgoda dostaje e-mail i telefon (kontrapunkt)');
END $$;

-- Skan NA ZYWO (bez `queued`) z czasem wstecznym nie korzysta z okna -
-- wczesniej wystarczylo podac stara date, zeby wygasle stoisko dalej
-- pobieralo dane kontaktowe uczestnikow.
SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok51-stoiskowyg-01', 'code', 'qr51-olga-00000000001',
    'device_scanned_at', now() - interval '2 hours'))
$q$, 'device_expired',
  '51/okno: lead na zywo z czasem wstecznym z wygaslego stoiska jest odrzucony (okno tylko dla kolejki)');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok51-wygasle-00001', 'code', 'qr51-olga-00000000001',
    'checkpoint_id', '51c00000-0000-0000-0000-0000000000a2',
    'client_scan_uid', 'scan51-grace-live',
    'device_scanned_at', now() - interval '2 hours'))
$q$, 'device_expired',
  '51/okno: odprawa na zywo z czasem wstecznym z wygaslego urzadzenia jest odrzucona');

-- Decyzja offline oznacza kolejke nawet bez flagi `queued` - okno dziala.
DO $$
DECLARE v jsonb;
BEGIN
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok51-wygasle-00001', 'code', 'qr51-olga-00000000001',
    'checkpoint_id', '51c00000-0000-0000-0000-0000000000a2', 'direction', 'in',
    'client_scan_uid', 'scan51-grace-02',
    'device_scanned_at', now() - interval '90 minutes',
    'offline_admitted', true, 'offline_outcome', 'granted'));
  PERFORM pg_temp.assert(v->>'outcome' IN ('granted', 'repeat') AND v->'person' = 'null'::jsonb,
    '51/okno: skan z decyzja offline to skan z kolejki - okno 72 h, bez karty osoby');
END $$;

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok51-wygasle-00001', 'code', 'qr51-olga-00000000001',
    'checkpoint_id', '51c00000-0000-0000-0000-0000000000a1',
    'device_scanned_at', now()))
$q$, 'device_expired',
  '51/okno: skan PO terminie z wygaslego urzadzenia jest odrzucony');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok51-wygasle-00001', 'code', 'qr51-olga-00000000001',
    'checkpoint_id', '51c00000-0000-0000-0000-0000000000a1'))
$q$, 'device_expired',
  '51/okno: skan bez czasu urzadzenia nie korzysta z okna');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok51-dawno-0000001', 'code', 'qr51-olga-00000000001',
    'checkpoint_id', '51c00000-0000-0000-0000-0000000000a1',
    'device_scanned_at', now() - interval '90 hours'))
$q$, 'device_expired',
  '51/okno: po 72 h od terminu nie ma juz synchronizacji');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok51-cofniete-00001', 'code', 'qr51-olga-00000000001',
    'checkpoint_id', '51c00000-0000-0000-0000-0000000000a1',
    'device_scanned_at', now() - interval '2 hours'))
$q$, 'device_revoked',
  '51/okno: uniewaznienie zostaje twarda odmowa, takze dla starego skanu');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok51-pauza-0000001', 'code', 'qr51-olga-00000000001',
    'checkpoint_id', '51c00000-0000-0000-0000-0000000000a1',
    'device_scanned_at', now() - interval '2 hours'))
$q$, 'device_inactive',
  '51/okno: pauza zostaje twarda odmowa, takze w oknie');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok51-stoiskowyg-01', 'code', 'qr51-olga-00000000001'))
$q$, 'device_expired',
  '51/okno: lead bez czasu skanu z wygaslego stoiska jest odrzucony');

-- ---------------------------------------------------------------------------
-- SEKCJA 10: PANEL - WYDANIE, ZGODA, LISTY, ROLE
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb; v_id uuid;
BEGIN
  PERFORM pg_temp.act_as('51a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');

  v := public.admin_event_scanner_device_issue(jsonb_build_object(
    'event_id', '51e00000-0000-0000-0000-0000000000a1', 'label', 'Nowy offline',
    'scopes', jsonb_build_array('checkin'), 'offline_roster', true));
  v_id := (v->>'device_id')::uuid;
  PERFORM pg_temp.assert((v->>'offline_roster')::boolean
      AND (SELECT offline_roster FROM public.event_scanner_devices WHERE id = v_id),
    '51/panel: wydanie z lista offline zapisuje zgode na urzadzeniu');
  PERFORM pg_temp.assert(
    (SELECT (payload->>'offline_roster')::boolean FROM public.domain_events
      WHERE event_type = 'event_scanner_device.issued.v1' AND aggregate_id = v_id::text),
    '51/panel: zdarzenie wydania mowi, ze urzadzenie dostalo zgode na liste');

  v := public.admin_event_scanner_device_issue(jsonb_build_object(
    'event_id', '51e00000-0000-0000-0000-0000000000a1', 'label', 'Stoisko bez listy',
    'scopes', jsonb_build_array('lead'), 'sponsor_id', '51500000-0000-0000-0000-0000000000a1',
    'offline_roster', true));
  PERFORM pg_temp.assert(NOT (v->>'offline_roster')::boolean,
    '51/panel: bez zakresu checkin zgoda na liste jest odrzucana po cichu (dane nie jada na zapas)');

  -- Wlaczenie na urzadzeniu bez zgody: zmiana + zdarzenie z aktorem.
  PERFORM public.admin_event_scanner_device_set_offline(jsonb_build_object(
    'device_id', '51d10000-0000-0000-0000-000000000002', 'offline_roster', true));
  PERFORM pg_temp.assert(
    (SELECT offline_roster FROM public.event_scanner_devices WHERE id = '51d10000-0000-0000-0000-000000000002')
    AND (SELECT count(*) FROM public.domain_events
          WHERE event_type = 'event_scanner_device.offline_changed.v1'
            AND aggregate_id = '51d10000-0000-0000-0000-000000000002'
            AND actor_id = '51a00000-0000-0000-0000-0000000000a1'
            AND (payload->>'offline_roster')::boolean) = 1,
    '51/panel: wlaczenie listy offline zapisuje zgode i zdarzenie z aktorem');

  -- Powtorne ustawienie tej samej wartosci nie emituje zdarzenia.
  PERFORM public.admin_event_scanner_device_set_offline(jsonb_build_object(
    'device_id', '51d10000-0000-0000-0000-000000000002', 'offline_roster', true));
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.domain_events
      WHERE event_type = 'event_scanner_device.offline_changed.v1'
        AND aggregate_id = '51d10000-0000-0000-0000-000000000002') = 1,
    '51/panel: ustawienie bez zmiany nie produkuje zdarzenia');

  -- Wylaczenie na D1: nastepne pobranie listy konczy sie roster_disabled.
  PERFORM public.admin_event_scanner_device_set_offline(jsonb_build_object(
    'device_id', '51d10000-0000-0000-0000-000000000001', 'offline_roster', false));
  PERFORM pg_temp.assert_raises_like($q$
    SELECT public.event_scanner_roster(jsonb_build_object(
      'device_token', 'tok51-offline-000001', 'since', now()))
  $q$, 'roster_disabled',
    '51/panel: wylaczenie zgody odcina urzadzenie od listy (takze od delty)');
END $$;

SELECT pg_temp.act_as('51a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.admin_event_scanner_device_set_offline(jsonb_build_object(
    'device_id', '51d10000-0000-0000-0000-000000000006', 'offline_roster', true))
$q$, 'device_revoked',
  '51/panel: uniewaznione poswiadczenie nie dostanie listy offline');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.admin_event_scanner_device_set_offline(jsonb_build_object(
    'device_id', '51d10000-0000-0000-0000-000000000003', 'offline_roster', true))
$q$, 'invalid_scopes',
  '51/panel: lista offline wymaga zakresu checkin');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.admin_event_scanner_device_set_offline(jsonb_build_object(
    'device_id', '51d10000-0000-0000-0000-0000000000b1', 'offline_roster', false))
$q$, 'not_found',
  '51/IZOLACJA: admin A nie dotknie urzadzenia najemcy B');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.admin_event_scanner_device_set_offline('{}'::jsonb)
$q$, 'invalid_payload',
  '51/panel: bez device_id jest blad ladunku');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.admin_event_scanner_device_set_offline(jsonb_build_object(
    'device_id', '51d10000-0000-0000-0000-000000000002'))
$q$, 'offline_roster is required',
  '51/panel: brak jawnej wartosci zgody NIE wylacza listy po cichu - jest bledem ladunku');

DO $$
DECLARE v_row record;
BEGIN
  SELECT * INTO v_row FROM public.admin_event_scanner_devices_list('51e00000-0000-0000-0000-0000000000a1') d
   WHERE d.id = '51d10000-0000-0000-0000-000000000002';
  PERFORM pg_temp.assert(v_row.offline_roster AND v_row.roster_download_count = 0
      AND v_row.roster_downloaded_at IS NULL,
    '51/panel: lista urzadzen pokazuje zgode i (brak) pobrania listy');
  SELECT * INTO v_row FROM public.admin_event_scanner_devices_list('51e00000-0000-0000-0000-0000000000a1') d
   WHERE d.id = '51d10000-0000-0000-0000-000000000001';
  PERFORM pg_temp.assert(NOT v_row.offline_roster AND v_row.roster_download_count = 1
      AND v_row.roster_downloaded_at IS NOT NULL,
    '51/panel: wylaczona zgoda zostawia historie pobran');

  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.admin_event_checkins_list(
      '51e00000-0000-0000-0000-0000000000a1', p_conflicts_only => true)) = 2
    AND (SELECT bool_and(conflict) FROM public.admin_event_checkins_list(
      '51e00000-0000-0000-0000-0000000000a1', p_conflicts_only => true))
    AND (SELECT count(*) FROM public.admin_event_checkins_list(
      '51e00000-0000-0000-0000-0000000000a1', p_conflicts_only => true) c
        WHERE c.person_id IN ('51700000-0000-0000-0000-000000000007',
                              '51700000-0000-0000-0000-000000000002')) = 2,
    '51/panel: filtr konfliktow oddaje dokladnie dwa wiersze (anulowany po liscie, eskalacja)');

  SELECT * INTO v_row FROM public.admin_event_checkins_list('51e00000-0000-0000-0000-0000000000a1') c
   WHERE c.person_id = '51700000-0000-0000-0000-000000000001' AND c.direction = 'in'
     AND c.checkpoint_id = '51c00000-0000-0000-0000-0000000000a1';
  PERFORM pg_temp.assert(v_row.offline_admitted AND v_row.offline_outcome = 'granted'
      AND NOT v_row.conflict,
    '51/panel: wpuszczony offline i potwierdzony przez serwer to NIE konflikt');

  -- Punkt `track`: odmowa z powodu statusu i tak wpuszcza, wiec to nie konflikt.
  UPDATE public.event_registrations SET status = 'pending'
   WHERE id = '51300000-0000-0000-0000-000000000004';
  -- Urzadzenie "na zywo" zablokowane w sekcji 8 - zdejmujemy blokade tak,
  -- jak robi to administrator (okno i blokada), licznik monotoniczny zostaje.
  UPDATE public.event_scanner_devices
     SET locked_until = NULL, fail_window_count = 0, fail_window_started_at = NULL
   WHERE id = '51d10000-0000-0000-0000-000000000007';
  PERFORM public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok51-nazywo-000001', 'code', 'qr51-bogdan-000000001',
    'checkpoint_id', '51c00000-0000-0000-0000-0000000000a2',
    'offline_admitted', true, 'offline_outcome', 'denied_registration_status'));
  SELECT * INTO v_row FROM public.admin_event_checkins_list('51e00000-0000-0000-0000-0000000000a1') c
   WHERE c.person_id = '51700000-0000-0000-0000-000000000004'
     AND c.checkpoint_id = '51c00000-0000-0000-0000-0000000000a2';
  PERFORM pg_temp.assert(v_row.result = 'denied_registration_status' AND v_row.offline_admitted
      AND NOT v_row.conflict,
    '51/panel: na punkcie track odmowa statusu wpuszcza - wpuszczenie offline nie jest konfliktem');
END $$;

-- ROLE: redaktor, zwykly uzytkownik i anonim nie maja dostepu do panelu.
SELECT pg_temp.act_as('51a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert_raises_like($q$
  SELECT public.admin_event_scanner_device_set_offline(jsonb_build_object(
    'device_id', '51d10000-0000-0000-0000-000000000002', 'offline_roster', false))
$q$, 'forbidden', '51/role: redaktor nie zmieni zgody na liste offline');
SELECT pg_temp.assert_raises_like($q$
  SELECT count(*) FROM public.admin_event_scanner_devices_list('51e00000-0000-0000-0000-0000000000a1')
$q$, 'forbidden', '51/role: redaktor nie czyta listy urzadzen');
SELECT pg_temp.assert_raises_like($q$
  SELECT count(*) FROM public.admin_event_checkins_list('51e00000-0000-0000-0000-0000000000a1')
$q$, 'forbidden', '51/role: redaktor nie czyta dziennika odpraw');
SELECT pg_temp.assert_raises_like($q$
  SELECT public.admin_event_scanner_device_issue(jsonb_build_object(
    'event_id', '51e00000-0000-0000-0000-0000000000a1', 'label', 'Redaktor'))
$q$, 'forbidden', '51/role: redaktor nie wyda poswiadczenia');

SELECT pg_temp.act_as('51a00000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert_raises_like($q$
  SELECT public.admin_event_scanner_device_set_offline(jsonb_build_object(
    'device_id', '51d10000-0000-0000-0000-000000000002', 'offline_roster', false))
$q$, 'forbidden', '51/role: zwykly uzytkownik nie zmieni zgody na liste offline');

SELECT pg_temp.act_as(NULL, NULL);
SELECT pg_temp.assert_raises_like($q$
  SELECT public.admin_event_scanner_device_set_offline(jsonb_build_object(
    'device_id', '51d10000-0000-0000-0000-000000000002', 'offline_roster', false))
$q$, 'forbidden', '51/role: anonim nie zmieni zgody na liste offline');

-- SUPER_ADMIN przechodzi bramke modulu (poprzednie cialo z assert_admin_tenant go odbijalo).
DO $$
BEGIN
  PERFORM pg_temp.act_as('51a00000-0000-0000-0000-0000000000a4', '11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.admin_event_scanner_devices_list('51e00000-0000-0000-0000-0000000000a1')) >= 9,
    '51/role: super_admin czyta liste urzadzen (bramka assert_event_admin_tenant)');
  PERFORM pg_temp.assert(public.admin_event_scanner_device_set_offline(jsonb_build_object(
    'device_id', '51d10000-0000-0000-0000-000000000002', 'offline_roster', false)),
    '51/role: super_admin zmienia zgode na liste offline');

  -- IZOLACJA: admin B nie widzi urzadzen ani dziennika najemcy A.
  PERFORM pg_temp.act_as('51a00000-0000-0000-0000-0000000000b1', '51000000-0000-0000-0000-0000000000b0');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.admin_event_scanner_devices_list('51e00000-0000-0000-0000-0000000000a1')) = 0
    AND (SELECT count(*) FROM public.admin_event_checkins_list('51e00000-0000-0000-0000-0000000000a1')) = 0
    AND (SELECT count(*) FROM public.admin_event_scanner_devices_list('51e00000-0000-0000-0000-0000000000b1')) = 1,
    '51/IZOLACJA: admin B widzi wylacznie urzadzenia swojego najemcy');
END $$;

-- RLS: polityka odczytu urzadzen nadal wiaze najemce - kolumny offline
-- czyta admin A, redaktor nie widzi wierszy.
SELECT pg_temp.act_as('51a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_scanner_devices
    WHERE event_id = '51e00000-0000-0000-0000-0000000000a1' AND offline_roster) >= 1
  AND (SELECT count(*) FROM public.event_scanner_devices
        WHERE tenant_id = '51000000-0000-0000-0000-0000000000b0') = 0,
  '51/RLS: admin A czyta kolumny listy offline tylko swojego najemcy');
RESET ROLE;
SELECT pg_temp.act_as('51a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_scanner_devices
    WHERE event_id = '51e00000-0000-0000-0000-0000000000a1') = 0,
  '51/RLS: redaktor nie widzi poswiadczen urzadzen');
RESET ROLE;
SELECT pg_temp.act_as(NULL, NULL);

-- ---------------------------------------------------------------------------
-- SEKCJA 10b: ODMOWA OFFLINE NIE STAJE SIE OBECNOSCIA (review #33)
--
-- Urzadzenie bez sieci ODESLALO czlowieka (kod spoza listy: bilet wydany po
-- pobraniu listy; status "oczekujace" na liscie, a zapis przyjety pozniej),
-- a serwer po synchronizacji by go wpuscil. Wczesniej zapis dostawal zgode:
-- attended_at, tag CRM i oblozenie punktu dla kogos, kto nie wszedl - a na
-- tym stoja certyfikaty obecnosci (#406). Teraz wiersz trzyma odmowe bramki,
-- wynik serwera jest w offline_server_result, a panel pokazuje konflikt
-- "odeslany offline".
-- ---------------------------------------------------------------------------
INSERT INTO public.event_sessions
  (id, tenant_id, event_id, title_pl, title_en, starts_at, ends_at, status, sort_order)
VALUES
  ('51500000-0000-0000-0000-00000000005a', '11111111-1111-1111-1111-111111111111',
   '51e00000-0000-0000-0000-0000000000a1', 'Sesja plenarna', 'Plenary session',
   now() + interval '1 day', now() + interval '1 day 1 hour', 'published', 10)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_checkpoints
  (id, tenant_id, event_id, session_id, name_pl, name_en, kind, direction_mode,
   access_mode, dedupe_window_seconds)
VALUES
  ('51c00000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111',
   '51e00000-0000-0000-0000-0000000000a1', '51500000-0000-0000-0000-00000000005a',
   'Sesja plenarna', 'Plenary session', 'session', 'in_only', 'control', 60)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_people
  (id, tenant_id, first_name, last_name, email, company_text, source)
VALUES
  ('51700000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111',
   'Wiktor', 'Walkin', 'wiktor.walkin@example.org', 'Gamma', 'organizer'),
  ('51700000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111',
   'Dorota', 'Doszla', 'dorota.doszla@example.org', NULL, 'organizer')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, status, registration_mode, qr_token_hash, qr_issued_at)
VALUES
  ('51300000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111',
   '51e00000-0000-0000-0000-0000000000a1', '51700000-0000-0000-0000-000000000009',
   'approved', 'rsvp', encode(extensions.digest('qr51-wiktor-000000001', 'sha256'), 'hex'), now()),
  ('51300000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111',
   '51e00000-0000-0000-0000-0000000000a1', '51700000-0000-0000-0000-000000000010',
   'approved', 'rsvp', encode(extensions.digest('qr51-dorota-000000001', 'sha256'), 'hex'), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.crm_leads (id, tenant_id, email, first_name, last_name, source_type, tags)
VALUES
  ('51d00000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111',
   'wiktor.walkin@example.org', 'Wiktor', 'Walkin', 'newsletter', ARRAY['lista:energia'])
ON CONFLICT (id) DO NOTHING;

CREATE TEMP TABLE t51_occ (k text PRIMARY KEY, v integer) ON COMMIT DROP;
INSERT INTO t51_occ VALUES
  ('gate', public._event_checkpoint_occupancy('11111111-1111-1111-1111-111111111111',
     '51c00000-0000-0000-0000-0000000000a1')),
  ('session', public._event_checkpoint_occupancy('11111111-1111-1111-1111-111111111111',
     '51c00000-0000-0000-0000-0000000000a3'));

DO $$
DECLARE v jsonb; v_row public.event_checkins; v_reg public.event_registrations;
BEGIN
  -- Kod spoza listy offline (bilet wydany po pobraniu), serwer go zna.
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok51-offline-000001', 'code', 'qr51-wiktor-000000001',
    'checkpoint_id', '51c00000-0000-0000-0000-0000000000a1',
    'client_scan_uid', 'scan51-wiktor-01',
    'device_scanned_at', now() - interval '15 minutes', 'queued', true,
    'offline_admitted', false, 'offline_outcome', 'unknown_code',
    'roster_generated_at', now() - interval '40 minutes'));
  SELECT * INTO v_row FROM public.event_checkins WHERE id = (v->>'checkin_id')::uuid;
  SELECT * INTO v_reg FROM public.event_registrations
   WHERE id = '51300000-0000-0000-0000-000000000009';

  PERFORM pg_temp.assert(NOT (v->>'admit')::boolean AND (v->>'server_admit')::boolean
      AND v->>'outcome' = 'denied_not_registered',
    '51/odmowa offline: odpowiedz mowi "bramka odeslala" (admit false) i "serwer by wpuscil" (server_admit)');
  PERFORM pg_temp.assert(v_row.result = 'denied_not_registered'
      AND v_row.offline_server_result = 'granted'
      AND v_row.offline_admitted = false AND v_row.offline_outcome = 'unknown_code'
      AND v_row.registration_id = '51300000-0000-0000-0000-000000000009',
    '51/odmowa offline: wiersz trzyma odmowe bramki, a wynik serwera w offline_server_result');
  PERFORM pg_temp.assert(v_reg.attended_at IS NULL AND v_reg.status = 'approved',
    '51/odmowa offline: czlowiek odeslany od bramki NIE staje sie obecny (attended_at pusty, status bez zmian)');
  PERFORM pg_temp.assert(
    NOT (SELECT 'attended:offline-51' = ANY (tags) FROM public.crm_leads
          WHERE id = '51d00000-0000-0000-0000-000000000009')
    AND NOT EXISTS (SELECT 1 FROM public.audit_log
                     WHERE action = 'event.checkin.attended'
                       AND entity_id = '51d00000-0000-0000-0000-000000000009'),
    '51/odmowa offline: brak tagu obecnosci i wpisu osi czasu w CRM');
  PERFORM pg_temp.assert(
    public._event_checkpoint_occupancy('11111111-1111-1111-1111-111111111111',
      '51c00000-0000-0000-0000-0000000000a1') = (SELECT o.v FROM t51_occ o WHERE o.k = 'gate'),
    '51/odmowa offline: oblozenie punktu bez zmian (liczy tylko zgody)');

  -- Ponowna wysylka: ten sam wiersz, ta sama odpowiedz.
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok51-offline-000001', 'code', 'qr51-wiktor-000000001',
    'checkpoint_id', '51c00000-0000-0000-0000-0000000000a1',
    'client_scan_uid', 'scan51-wiktor-01', 'queued', true,
    'offline_admitted', false, 'offline_outcome', 'unknown_code'));
  PERFORM pg_temp.assert(v->>'outcome' = 'replay' AND (v->>'checkin_id')::uuid = v_row.id
      AND NOT (v->>'admit')::boolean AND (v->>'server_admit')::boolean,
    '51/odmowa offline: replay oddaje ten sam wiersz i nadal mowi "serwer by wpuscil"');

  -- Sesja: lista mowila "oczekujace", zapis przyjeto pozniej. Obecnosc na
  -- sesji (podstawa certyfikatu "sessions_min") NIE moze powstac.
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok51-offline-000001', 'code', 'qr51-dorota-000000001',
    'checkpoint_id', '51c00000-0000-0000-0000-0000000000a3',
    'client_scan_uid', 'scan51-dorota-01',
    'device_scanned_at', now() - interval '10 minutes', 'queued', true,
    'offline_admitted', false, 'offline_outcome', 'denied_registration_status'));
  PERFORM pg_temp.assert(v->>'result' = 'denied_registration_status' AND (v->>'server_admit')::boolean,
    '51/odmowa offline: sesja - wiersz z odmowa statusu z listy, serwer by wpuscil');
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.event_checkins
                 WHERE person_id = '51700000-0000-0000-0000-000000000010' AND result = 'granted')
    AND (SELECT attended_at IS NULL FROM public.event_registrations
          WHERE id = '51300000-0000-0000-0000-000000000010')
    AND public._event_checkpoint_occupancy('11111111-1111-1111-1111-111111111111',
      '51c00000-0000-0000-0000-0000000000a3') = (SELECT o.v FROM t51_occ o WHERE o.k = 'session'),
    '51/odmowa offline: brak zgody na sesji, brak obecnosci i oblozenie sesji bez zmian');

  -- Odmowa offline, ktora serwer POTWIERDZA (zapis anulowany) - bez konfliktu.
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok51-offline-000001', 'code', 'qr51-anna-00000000001',
    'checkpoint_id', '51c00000-0000-0000-0000-0000000000a1',
    'client_scan_uid', 'scan51-anna-off-01', 'queued', true,
    'device_scanned_at', now() - interval '12 minutes',
    'offline_admitted', false, 'offline_outcome', 'unknown_code'));
  SELECT * INTO v_row FROM public.event_checkins WHERE id = (v->>'checkin_id')::uuid;
  PERFORM pg_temp.assert(v_row.result = 'denied_not_registered'
      AND v_row.offline_server_result = 'denied_not_registered'
      AND NOT (v->>'server_admit')::boolean,
    '51/odmowa offline: serwer tez odmawia - wynik serwera zapisany, bez zgody');

  -- Kontrapunkt: ta sama osoba wraca do bramki i skan NA ZYWO ja wpuszcza -
  -- dopiero teraz obecnosc, tagi event:/attended: i wpis osi czasu.
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok51-offline-000001', 'code', 'qr51-wiktor-000000001',
    'checkpoint_id', '51c00000-0000-0000-0000-0000000000a1',
    'client_scan_uid', 'scan51-wiktor-02'));
  PERFORM pg_temp.assert(v->>'outcome' = 'granted' AND (v->>'admit')::boolean
      AND (v->>'server_admit')::boolean
      AND (SELECT attended_at IS NOT NULL FROM public.event_registrations
            WHERE id = '51300000-0000-0000-0000-000000000009'),
    '51/odmowa offline: wejscie na zywo po odeslaniu to zwykla zgoda ze stemplem obecnosci');
  PERFORM pg_temp.assert(
    (SELECT 'event:offline-51' = ANY (tags) AND 'attended:offline-51' = ANY (tags)
       FROM public.crm_leads WHERE id = '51d00000-0000-0000-0000-000000000009'),
    '51/CRM: obecnosc dopisuje tagi event:<slug> i attended:<slug>');
END $$;

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok51-offline-000001', 'code', 'qr51-dorota-000000001',
    'checkpoint_id', '51c00000-0000-0000-0000-0000000000a1',
    'client_scan_uid', 'scan51-dorota-02', 'queued', true,
    'offline_admitted', false, 'offline_outcome', 'granted'))
$q$, 'invalid_payload',
  '51/ODMOWA: "zgoda offline, ale nie wpuscilem" to ladunek sprzeczny (invalid_payload)');

SELECT pg_temp.assert_raises_like($q$
  SELECT public._event_checkin_write(
    '11111111-1111-1111-1111-111111111111', '51e00000-0000-0000-0000-0000000000a1',
    '51c00000-0000-0000-0000-0000000000a1', '51700000-0000-0000-0000-000000000010',
    'in', 'qr_code', '51d10000-0000-0000-0000-000000000001', NULL, 'scan51-dorota-03',
    NULL, NULL, 'granted')
$q$, 'invalid_payload',
  '51/ODMOWA: zapis przyjmuje jako odmowe offline wylacznie wynik odmowy');

DO $$
BEGIN
  PERFORM pg_temp.act_as('51a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.admin_event_checkins_list(
      '51e00000-0000-0000-0000-0000000000a1', p_conflicts_only => true) c
      WHERE c.conflict_kind = 'denied_offline' AND c.conflict
        AND c.offline_server_result = 'granted'
        AND c.person_id IN ('51700000-0000-0000-0000-000000000009',
                            '51700000-0000-0000-0000-000000000010')) = 2
    AND (SELECT count(*) FROM public.admin_event_checkins_list(
      '51e00000-0000-0000-0000-0000000000a1', p_conflicts_only => true) c
      WHERE c.conflict_kind = 'admitted_offline') = 2
    AND (SELECT count(*) FROM public.admin_event_checkins_list(
      '51e00000-0000-0000-0000-0000000000a1', p_conflicts_only => true) c
      WHERE c.conflict_kind IS NULL OR NOT c.conflict) = 0,
    '51/panel: filtr konfliktow oddaje OBA rodzaje - dwa "odeslany offline" i dwa "wpuszczony offline"');
  PERFORM pg_temp.assert(
    (SELECT c.conflict_kind IS NULL AND NOT c.conflict
       FROM public.admin_event_checkins_list('51e00000-0000-0000-0000-0000000000a1') c
      WHERE c.person_id = '51700000-0000-0000-0000-000000000003'
        AND c.offline_outcome = 'unknown_code'),
    '51/panel: odmowa offline potwierdzona przez serwer to NIE konflikt');
  PERFORM pg_temp.act_as(NULL, NULL);
END $$;

-- ---------------------------------------------------------------------------
-- SEKCJA 10c: LISTA OFFLINE A GOSCIE GRUPY I PONOWNA WYSYLKA BILETU
--
-- Kaskada prowadzacego (20260926100000/120000/180000) i ponowna wysylka
-- (admin_event_ticket_resend + _event_issue_ticket_codes) zmieniaja zapisy
-- ZA PLECAMI listy offline. Delta musi to widziec: gosc zamkniety razem
-- z anulowanym prowadzacym wypada (`removed`), nowy kod po ponownej wysylce
-- wraca jako nowy skrot `h`, a gosc oczekujacy z kodem jest na liscie jako
-- `pending` (urzadzenie go odprawi odmowa statusu).
-- ---------------------------------------------------------------------------
INSERT INTO public.event_scanner_devices
  (id, tenant_id, event_id, checkpoint_id, sponsor_id, label, token_hash, token_prefix,
   scopes, is_active, expires_at, revoked_at, offline_roster)
VALUES
  ('51d10000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111',
   '51e00000-0000-0000-0000-0000000000a1', NULL, NULL, 'Grupa offline',
   encode(extensions.digest('tok51-grupa-0000001', 'sha256'), 'hex'), 'tok51-gr',
   ARRAY['checkin']::text[], true, now() + interval '2 days', NULL, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_people
  (id, tenant_id, first_name, last_name, email, source)
VALUES
  ('51700000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111',
   'Lena', 'Lider', 'lena.lider@example.org', 'organizer'),
  ('51700000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111',
   'Gustaw', 'Gosc', 'gustaw.gosc@example.org', 'organizer'),
  ('51700000-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111',
   'Pola', 'Pending', 'pola.pending@example.org', 'organizer'),
  ('51700000-0000-0000-0000-000000000014', '11111111-1111-1111-1111-111111111111',
   'Roman', 'Ponowny', 'roman.ponowny@example.org', 'organizer')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, status, registration_mode, payment_status,
   group_lead_registration_id, qr_token_hash, qr_issued_at, ticket_code_sent_at)
VALUES
  ('51300000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111',
   '51e00000-0000-0000-0000-0000000000a1', '51700000-0000-0000-0000-000000000011',
   'approved', 'rsvp', 'not_required', NULL,
   encode(extensions.digest('qr51-lena-00000000001', 'sha256'), 'hex'), now(), now() - interval '1 hour'),
  ('51300000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111',
   '51e00000-0000-0000-0000-0000000000a1', '51700000-0000-0000-0000-000000000012',
   'approved', 'rsvp', 'not_required', '51300000-0000-0000-0000-000000000011',
   encode(extensions.digest('qr51-gustaw-000000001', 'sha256'), 'hex'), now(), now() - interval '1 hour'),
  ('51300000-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111',
   '51e00000-0000-0000-0000-0000000000a1', '51700000-0000-0000-0000-000000000013',
   'pending', 'rsvp', 'not_required', '51300000-0000-0000-0000-000000000011',
   encode(extensions.digest('qr51-pola-00000000001', 'sha256'), 'hex'), now(), NULL),
  ('51300000-0000-0000-0000-000000000014', '11111111-1111-1111-1111-111111111111',
   '51e00000-0000-0000-0000-0000000000a1', '51700000-0000-0000-0000-000000000014',
   'approved', 'rsvp', 'not_required', NULL,
   encode(extensions.digest('qr51-roman-0000000001', 'sha256'), 'hex'), now(), now() - interval '1 hour')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_full jsonb;
  v_delta jsonb;
  v_row jsonb;
  v_old_hash text;
  v_new_hash text;
BEGIN
  v_full := public.event_scanner_roster(jsonb_build_object('device_token', 'tok51-grupa-0000001'));
  SELECT x INTO v_row FROM jsonb_array_elements(v_full->'rows') x
   WHERE x->>'r' = '51300000-0000-0000-0000-000000000013';
  PERFORM pg_temp.assert(v_row->>'s' = 'pending'
      AND v_row->>'h' = encode(extensions.digest('qr51-pola-00000000001', 'sha256'), 'hex'),
    '51/grupa: gosc oczekujacy z kodem jest na liscie jako pending (offline dostanie odmowe statusu)');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM jsonb_array_elements(v_full->'rows') x
      WHERE x->>'r' IN ('51300000-0000-0000-0000-000000000011',
                        '51300000-0000-0000-0000-000000000012',
                        '51300000-0000-0000-0000-000000000014')) = 3,
    '51/grupa: prowadzacy, przyjety gosc i uczestnik solo sa na pelnej liscie');

  -- Prowadzacy anuluje: kaskada zamyka czekajacego i przyjetego goscia.
  UPDATE public.event_registrations
     SET status = 'cancelled', cancelled_at = now()
   WHERE id = '51300000-0000-0000-0000-000000000011';

  -- Ponowna wysylka biletu uczestnika solo: nowy kod przy nastepnym wydaniu.
  SELECT qr_token_hash INTO v_old_hash FROM public.event_registrations
   WHERE id = '51300000-0000-0000-0000-000000000014';
  PERFORM pg_temp.act_as('51a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  PERFORM public.admin_event_ticket_resend('51300000-0000-0000-0000-000000000014', false);
  PERFORM pg_temp.act_as(NULL, NULL);
  PERFORM public._event_issue_ticket_codes('51300000-0000-0000-0000-000000000014');
  SELECT qr_token_hash INTO v_new_hash FROM public.event_registrations
   WHERE id = '51300000-0000-0000-0000-000000000014';
  PERFORM pg_temp.assert(v_new_hash IS NOT NULL AND v_new_hash <> v_old_hash,
    '51/grupa: punkt wyjscia - ponowna wysylka wydala nowy kod');

  v_delta := public.event_scanner_roster(jsonb_build_object(
    'device_token', 'tok51-grupa-0000001', 'since', v_full->>'generated_at'));
  PERFORM pg_temp.assert(
    v_delta->'removed' @> '["51300000-0000-0000-0000-000000000011", "51300000-0000-0000-0000-000000000012", "51300000-0000-0000-0000-000000000013"]'::jsonb
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_delta->'rows') x
       WHERE x->>'r' IN ('51300000-0000-0000-0000-000000000011',
                         '51300000-0000-0000-0000-000000000012',
                         '51300000-0000-0000-0000-000000000013')),
    '51/grupa: anulowany prowadzacy i jego goscie (przyjety i oczekujacy) wypadaja w delcie jako removed');
  SELECT x INTO v_row FROM jsonb_array_elements(v_delta->'rows') x
   WHERE x->>'r' = '51300000-0000-0000-0000-000000000014';
  PERFORM pg_temp.assert(v_row->>'h' = v_new_hash AND v_row->>'s' = 'approved',
    '51/grupa: po ponownej wysylce delta niesie NOWY skrot kodu (stary bilet przestaje pasowac offline)');
END $$;

-- ---------------------------------------------------------------------------
-- SEKCJA 11: CRM - SYGNAL OBECNOSCI (TYLKO AKTUALIZACJA ISTNIEJACEGO)
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  (SELECT 'attended:offline-51' = ANY (tags) AND 'event:offline-51' = ANY (tags)
          AND 'lista:energia' = ANY (tags)
     FROM public.crm_leads WHERE id = '51d00000-0000-0000-0000-000000000001'),
  '51/CRM: obecnosc dopisuje tagi event:<slug> i attended:<slug> do ISTNIEJACEGO kontaktu (stare tagi zostaja)');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.audit_log
    WHERE action = 'event.checkin.attended'
      AND entity_type = 'crm_lead'
      AND entity_id = '51d00000-0000-0000-0000-000000000001'
      AND metadata->>'event_slug' = 'offline-51'
      AND metadata->>'summary_pl' = 'Odprawa na wydarzeniu: Kongres offline'
      AND metadata->>'summary_en' = 'Checked in at the event: Offline congress'
      AND metadata->>'registration_id' = '51300000-0000-0000-0000-000000000001') = 1,
  '51/CRM: jeden wpis osi czasu event.checkin.attended z kontraktem metadanych');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.crm_leads WHERE lower(email) = 'bogdan.bez@example.org') = 0
  AND (SELECT sync_status = 'skipped' AND last_error = 'lead_not_found' AND last_create = false
         FROM public.event_person_crm_links
        WHERE person_id = '51700000-0000-0000-0000-000000000004'),
  '51/CRM: obecnosc osoby BEZ kontaktu nie zaklada kontaktu (p_create => false)');

SELECT pg_temp.assert(
  (SELECT source_type FROM public.crm_leads WHERE id = '51d00000-0000-0000-0000-000000000001')
    = 'event_participant',
  '51/CRM: segment kontaktu rosnie do event_participant (ranga wyzsza niz newsletter)');

-- Drugie wejscie tej samej osoby nie dubluje wpisu (attended_at juz jest).
DO $$
BEGIN
  PERFORM public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok51-nazywo-000001', 'code', 'qr51-olga-00000000001',
    'checkpoint_id', '51c00000-0000-0000-0000-0000000000a1', 'direction', 'in',
    'client_scan_uid', 'scan51-olga-0003',
    'device_scanned_at', now() - interval '1 minute'));
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.audit_log
      WHERE action = 'event.checkin.attended'
        AND entity_id = '51d00000-0000-0000-0000-000000000001') = 1,
    '51/CRM: kolejna odprawa tej samej osoby nie dubluje wpisu osi czasu');
END $$;

-- AWARIA CRM NIE COFA ODPRAWY: most podmieniony na rzucajacy (w tej
-- transakcji; ROLLBACK przywraca oryginal).
CREATE OR REPLACE FUNCTION public._event_person_crm_sync(
  p_tenant uuid, p_person_id uuid, p_source_type text, p_source_label text,
  p_tags text[] DEFAULT '{}'::text[], p_custom jsonb DEFAULT '{}'::jsonb,
  p_create boolean DEFAULT true, p_audit_action text DEFAULT NULL,
  p_audit_meta jsonb DEFAULT '{}'::jsonb
) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'crm_down: simulated bridge failure';
END $$;

DO $$
DECLARE v jsonb;
BEGIN
  UPDATE public.event_registrations SET status = 'approved'
   WHERE id = '51300000-0000-0000-0000-000000000002';
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok51-nazywo-000001', 'code', 'qr51-piotr-0000000001',
    'checkpoint_id', '51c00000-0000-0000-0000-0000000000a2',
    'client_scan_uid', 'scan51-piotr-crm'));
  PERFORM pg_temp.assert(v->>'outcome' = 'granted'
      AND (SELECT attended_at IS NOT NULL FROM public.event_registrations
            WHERE id = '51300000-0000-0000-0000-000000000002'),
    '51/CRM: rzucajacy most NIE cofa odprawy ani stempla obecnosci');
END $$;

ROLLBACK;
