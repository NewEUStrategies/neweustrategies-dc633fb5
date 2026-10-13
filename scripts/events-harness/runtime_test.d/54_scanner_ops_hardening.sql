-- ============================================================================
-- 54_scanner_ops_hardening - UTWARDZENIE SKANERA: DRUK NIE ZABIJA BILETOW,
--                            PONOWNE WEJSCIE, KLUCZE OBCE SET NULL, OKNO
--                            KOLEJKI, ZGODA PARTNERSKA W SKANIE LEADU
--
-- PO CO TEN PLIK ISTNIEJE
-- Migracje 20261012110000 .. 20261012110400 zamykaja cztery ustalenia audytu
-- operacyjnego i konsumuja fundament zgody per zgloszenie (20261012090000).
-- Kazde ma tu swoj test "gotowe, gdy":
--   OPS-04  druk -> skan starego kodu x25 NIE blokuje urzadzenia i daje
--           rozpoznawalny wynik (code_superseded); bilet z portfela po druku
--           identyfikatora nadal wpuszcza;
--   OPS-08  dwa wejscia poza oknem idempotencji przy polityce deny ->
--           denied_already_inside; powtorzone pikniecie nadal repeat; skan
--           z kolejki wpuszczony offline zapisuje sie jako konflikt, a nie
--           "granted x2";
--   OPS-11  usuniecie sponsora i punktu kontrolnego, ktore maja uniewaznione
--           urzadzenie, przechodzi; w schemacie nie zostal ANI JEDEN zlozony
--           klucz obcy SET NULL bez listy kolumn;
--   OPS-12  skan z kolejki po terminie BEZ znacznika kolejki na urzadzeniu,
--           ktore zadeklarowalo klienta ze znacznikiem -> device_expired
--           (sciezka przejsciowa starych klientow: 56_scanner_review_fixes);
--           nieznane kody z kolejki maja wlasny prog; termin poswiadczenia
--           najpozniej 7 dni po koncu wydarzenia;
--   OPS-01  zgoda u A -> brak zgody u B -> skan stoiska u B: person NULL;
--           zgoda u A, wycofanie, zapis na C bez zgody, skan u C: person NULL;
--           skan ze zgoda nadal oddaje dane.
--
-- CZEGO TEN PLIK NIE SPRAWDZA
--   * klienta skanera (decyzja offline, kolejka, ekran) - to tor S3;
--   * przyciecia istniejacych poswiadczen w migracji (UPDATE na pustej bazie
--     replayu niczego nie dotyka);
--   * stalocasowosci porownania podpisu znacznika.
--
-- SPRZATANIE. Caly plik pracuje w JEDNEJ transakcji zakonczonej ROLLBACK-iem.
-- now() jest w transakcji stale - czasy skanow podajemy wzgledem niego.
-- ============================================================================

\echo '== 54 utwardzenie skanera: OPS-04, OPS-08, OPS-11, OPS-12, OPS-01 =='

BEGIN;

-- ---------------------------------------------------------------------------
-- SEKCJA 0: SCENOGRAFIA
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('54a00000-0000-0000-0000-0000000000a1', 'ops54.admin@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('54a00000-0000-0000-0000-0000000000a1', 'admin', '11111111-1111-1111-1111-111111111111')
ON CONFLICT DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, display_name, slug) VALUES
  ('54a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Admin 54', 'ops54-admin')
ON CONFLICT (id) DO NOTHING;

-- A: glowne wydarzenie; B i C: zgoda per zgloszenie; D: skonczone 10 dni
-- temu (termin poswiadczenia); E: kaskada usuniecia wydarzenia.
INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, status,
   registration_mode, registration_flow)
VALUES
  ('54e00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'ops54-a', 'Kongres A', 'Congress A', now() + interval '1 day', NULL,
   'published', 'rsvp', 'instant'),
  ('54e00000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111',
   'ops54-b', 'Kongres B', 'Congress B', now() + interval '3 days', NULL,
   'published', 'rsvp', 'instant'),
  ('54e00000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111',
   'ops54-c', 'Kongres C', 'Congress C', now() + interval '5 days', NULL,
   'published', 'rsvp', 'instant'),
  ('54e00000-0000-0000-0000-0000000000d1', '11111111-1111-1111-1111-111111111111',
   'ops54-d', 'Kongres D', 'Congress D', now() - interval '20 days', now() - interval '10 days',
   'published', 'rsvp', 'instant'),
  ('54e00000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111',
   'ops54-e', 'Kongres E', 'Congress E', now() + interval '1 day', NULL,
   'published', 'rsvp', 'instant')
ON CONFLICT (id) DO NOTHING;

-- 20261012111000 (R8): stan "w srodku" zeruje sie o polnocy CZASU WYDARZENIA.
-- Skany tego pliku leza w ostatniej godzinie; strefa o stalym przesunieciu,
-- w ktorej TERAZ jest okolo poludnia, trzyma je w jednym dniu lokalnym
-- niezaleznie od godziny przebiegu (w Europe/Warsaw przebieg tuz po polnocy
-- rozcinalby sekwencje wejsc Bolka i Darka na dwa dni).
UPDATE public.events
   SET timezone = (
     SELECT CASE WHEN s.o >= 0 THEN 'Etc/GMT-' || s.o ELSE 'Etc/GMT+' || (-s.o) END
     FROM (SELECT 12 - extract(hour FROM now() AT TIME ZONE 'UTC')::integer AS o) s)
 WHERE id IN ('54e00000-0000-0000-0000-0000000000a1', '54e00000-0000-0000-0000-0000000000b1',
              '54e00000-0000-0000-0000-0000000000c1', '54e00000-0000-0000-0000-0000000000d1',
              '54e00000-0000-0000-0000-0000000000e1');

INSERT INTO public.crm_companies (id, tenant_id, name) VALUES
  ('54f00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Firma 54 Alfa'),
  ('54f00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'Firma 54 Beta'),
  ('54f00000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'Firma 54 Gamma')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_sponsors (id, tenant_id, event_id, company_id, snapshot_name) VALUES
  -- SP_DEL: do usuniecia (urzadzenie uniewaznione + zywe + lead).
  ('54500000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000a1', '54f00000-0000-0000-0000-0000000000a1', 'Sponsor do usuniecia'),
  -- SP_BOOTH: ma stanowisko firmy.
  ('54500000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000a1', '54f00000-0000-0000-0000-0000000000a2', 'Sponsor ze stoiskiem'),
  -- SP_A: stoisko leadow na A.
  ('54500000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000a1', '54f00000-0000-0000-0000-0000000000a3', 'Sponsor A'),
  ('54500000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000b1', '54f00000-0000-0000-0000-0000000000a1', 'Sponsor B'),
  ('54500000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000c1', '54f00000-0000-0000-0000-0000000000a1', 'Sponsor C'),
  ('54500000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000e1', '54f00000-0000-0000-0000-0000000000a1', 'Sponsor E')
ON CONFLICT (id) DO NOTHING;

-- Domyslny szablon identyfikatora - kiosk drukuje tylko z szablonem.
INSERT INTO public.event_badge_templates (id, tenant_id, event_id, name, is_default) VALUES
  ('54b00000-0000-0000-0000-0000000000f1', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000a1', 'Szablon 54', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_rooms (id, tenant_id, event_id, name) VALUES
  ('54b00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000a1', 'Sala 54')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_checkpoints
  (id, tenant_id, event_id, name_pl, name_en, kind, direction_mode, access_mode,
   reentry_policy, dedupe_window_seconds, room_id, sponsor_id)
VALUES
  ('54c00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000a1', 'Brama deny', 'Gate deny',
   'event_entry', 'in_out', 'control', 'deny', 60, NULL, NULL),
  ('54c00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000a1', 'Brama allow', 'Gate allow',
   'event_entry', 'in_only', 'control', 'allow', 60, '54b00000-0000-0000-0000-0000000000a1', NULL),
  ('54c00000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000a1', 'Brama kolejki', 'Queue gate',
   'event_entry', 'in_only', 'control', 'deny', 60, NULL, NULL),
  ('54c00000-0000-0000-0000-0000000000a4', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000a1', 'Strefa do usuniecia', 'Zone to delete',
   'zone', 'in_only', 'control', 'allow', 60, NULL, NULL),
  ('54c00000-0000-0000-0000-0000000000a5', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000a1', 'Strefa usuwana wprost', 'Zone deleted directly',
   'zone', 'in_only', 'control', 'allow', 60, NULL, NULL),
  ('54c00000-0000-0000-0000-0000000000a6', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000a1', 'Stoisko Beta', 'Beta booth',
   'company_booth', 'in_only', 'track', 'allow', 60, NULL, '54500000-0000-0000-0000-0000000000a2'),
  ('54c00000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000e1', 'Stoisko E', 'Booth E',
   'company_booth', 'in_only', 'track', 'allow', 60, NULL, '54500000-0000-0000-0000-0000000000e1')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_people
  (id, tenant_id, first_name, last_name, email, phone, source)
VALUES
  ('54700000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Ala', 'Badge', 'ala.badge@example.org', NULL, 'organizer'),
  ('54700000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Bolek', 'Wraca', 'bolek.wraca@example.org', NULL, 'organizer'),
  ('54700000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'Cezary', 'Dozwolony', 'cezary.dozw@example.org', NULL, 'organizer'),
  ('54700000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'Darek', 'Kolejka', 'darek.kol@example.org', NULL, 'organizer'),
  ('54700000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   'Ewa', 'Zgubila', 'ewa.zgub@example.org', NULL, 'organizer'),
  ('54700000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
   'Filip', 'Zwrot', 'filip.zwrot@example.org', NULL, 'organizer'),
  ('54700000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111',
   'Celina', 'Zgoda', 'celina.zgoda@example.org', '+48540000007', 'organizer'),
  ('54700000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111',
   'Dorota', 'Wycofana', 'dorota.wyc@example.org', '+48540000008', 'organizer'),
  ('54700000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111',
   'Grzegorz', 'Odeslany', 'grzegorz.ods@example.org', NULL, 'organizer'),
  ('54700000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111',
   'Hanna', 'Termin', 'hanna.termin@example.org', NULL, 'organizer'),
  ('54700000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111',
   'Igor', 'Pakiet', 'igor.pakiet@example.org', NULL, 'organizer')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, status, registration_mode, qr_token_hash, qr_issued_at)
VALUES
  ('54300000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000a1', '54700000-0000-0000-0000-000000000001',
   'approved', 'rsvp', encode(extensions.digest('qr54-ala-000000000001', 'sha256'), 'hex'), now()),
  ('54300000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000a1', '54700000-0000-0000-0000-000000000002',
   'approved', 'rsvp', encode(extensions.digest('qr54-bolek-0000000001', 'sha256'), 'hex'), now()),
  ('54300000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000a1', '54700000-0000-0000-0000-000000000003',
   'approved', 'rsvp', encode(extensions.digest('qr54-cezary-000000001', 'sha256'), 'hex'), now()),
  ('54300000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000a1', '54700000-0000-0000-0000-000000000004',
   'approved', 'rsvp', encode(extensions.digest('qr54-darek-0000000001', 'sha256'), 'hex'), now()),
  ('54300000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000a1', '54700000-0000-0000-0000-000000000005',
   'approved', 'rsvp', encode(extensions.digest('qr54-ewa-00000000001', 'sha256'), 'hex'), now()),
  ('54300000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000a1', '54700000-0000-0000-0000-000000000006',
   'approved', 'rsvp', encode(extensions.digest('qr54-filip-0000000001', 'sha256'), 'hex'), now()),
  ('54300000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000a1', '54700000-0000-0000-0000-000000000007',
   'approved', 'rsvp', encode(extensions.digest('qr54-celina-a-0000001', 'sha256'), 'hex'), now()),
  ('54300000-0000-0000-0000-000000000017', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000b1', '54700000-0000-0000-0000-000000000007',
   'approved', 'rsvp', encode(extensions.digest('qr54-celina-b-0000001', 'sha256'), 'hex'), now()),
  ('54300000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000a1', '54700000-0000-0000-0000-000000000008',
   'approved', 'rsvp', encode(extensions.digest('qr54-dorota-a-0000001', 'sha256'), 'hex'), now()),
  ('54300000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000a1', '54700000-0000-0000-0000-000000000009',
   'approved', 'rsvp', encode(extensions.digest('qr54-grzegorz-000001', 'sha256'), 'hex'), now()),
  ('54300000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000a1', '54700000-0000-0000-0000-00000000000a',
   'approved', 'rsvp', encode(extensions.digest('qr54-hanna-0000000001', 'sha256'), 'hex'), now())
ON CONFLICT (id) DO NOTHING;

-- Poswiadczenia urzadzen (tokeny czytelne, w bazie sam hasz).
INSERT INTO public.event_scanner_devices
  (id, tenant_id, event_id, checkpoint_id, sponsor_id, label, token_hash, token_prefix,
   scopes, is_active, expires_at, revoked_at, offline_roster)
VALUES
  ('54d00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000a1', NULL, NULL, 'Brama 1',
   encode(extensions.digest('tok54-brama-00000001', 'sha256'), 'hex'), 'tok54-br',
   ARRAY['checkin']::text[], true, now() + interval '2 days', NULL, true),
  ('54d00000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000a1', NULL, NULL, 'Brama 2',
   encode(extensions.digest('tok54-brama-00000002', 'sha256'), 'hex'), 'tok54-b2',
   ARRAY['checkin']::text[], true, now() + interval '2 days', NULL, false),
  ('54d00000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000a1', NULL, NULL, 'Wygasle godzine temu',
   encode(extensions.digest('tok54-wygasle-000001', 'sha256'), 'hex'), 'tok54-wy',
   ARRAY['checkin']::text[], true, now() - interval '1 hour', NULL, false),
  ('54d00000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000a1', NULL, NULL, 'Kolejka',
   encode(extensions.digest('tok54-kolejka-000001', 'sha256'), 'hex'), 'tok54-ko',
   ARRAY['checkin']::text[], true, now() + interval '2 days', NULL, false),
  ('54d00000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000a1', NULL, '54500000-0000-0000-0000-0000000000a3', 'Stoisko A',
   encode(extensions.digest('tok54-lead-a-0000001', 'sha256'), 'hex'), 'tok54-la',
   ARRAY['lead']::text[], true, now() + interval '2 days', NULL, false),
  ('54d00000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000b1', NULL, '54500000-0000-0000-0000-0000000000b1', 'Stoisko B',
   encode(extensions.digest('tok54-lead-b-0000001', 'sha256'), 'hex'), 'tok54-lb',
   ARRAY['lead']::text[], true, now() + interval '4 days', NULL, false),
  ('54d00000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000c1', NULL, '54500000-0000-0000-0000-0000000000c1', 'Stoisko C',
   encode(extensions.digest('tok54-lead-c-0000001', 'sha256'), 'hex'), 'tok54-lc',
   ARRAY['lead']::text[], true, now() + interval '6 days', NULL, false),
  ('54d00000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000a1', NULL, NULL, 'Kiosk',
   encode(extensions.digest('tok54-kiosk-00000001', 'sha256'), 'hex'), 'tok54-ki',
   ARRAY['badge_print']::text[], true, now() + interval '2 days', NULL, false),
  ('54d00000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000a1', NULL, '54500000-0000-0000-0000-0000000000a1',
   'Stoisko usuwane - uniewaznione',
   encode(extensions.digest('tok54-spdel-rev-0001', 'sha256'), 'hex'), 'tok54-sr',
   ARRAY['lead']::text[], false, now() + interval '2 days', now() - interval '1 hour', false),
  ('54d00000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000a1', NULL, '54500000-0000-0000-0000-0000000000a1',
   'Stoisko usuwane - zywe',
   encode(extensions.digest('tok54-spdel-live-001', 'sha256'), 'hex'), 'tok54-sl',
   ARRAY['lead']::text[], true, now() + interval '2 days', NULL, false),
  ('54d00000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000a1', '54c00000-0000-0000-0000-0000000000a4', NULL,
   'Strefa - uniewaznione',
   encode(extensions.digest('tok54-cpdel-rev-0001', 'sha256'), 'hex'), 'tok54-cr',
   ARRAY['checkin']::text[], false, now() + interval '2 days', now() - interval '1 hour', false),
  ('54d00000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000a1', '54c00000-0000-0000-0000-0000000000a5', NULL,
   'Strefa - zywe',
   encode(extensions.digest('tok54-cpdel-live-001', 'sha256'), 'hex'), 'tok54-cl',
   ARRAY['checkin']::text[], true, now() + interval '2 days', NULL, false),
  ('54d00000-0000-0000-0000-00000000000e', '11111111-1111-1111-1111-111111111111',
   '54e00000-0000-0000-0000-0000000000e1', '54c00000-0000-0000-0000-0000000000e1',
   '54500000-0000-0000-0000-0000000000e1', 'Stoisko E',
   encode(extensions.digest('tok54-lead-e-0000001', 'sha256'), 'hex'), 'tok54-le',
   ARRAY['lead', 'checkin']::text[], true, now() + interval '2 days', NULL, false)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- SEKCJA 1 (OPS-04): DRUK IDENTYFIKATORA NIE UNIEWAZNIA BILETU, STARY
--                    IDENTYFIKATOR x25 NIE BLOKUJE BRAMKI
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE ops54_codes (k text PRIMARY KEY, v text) ON COMMIT DROP;

DO $$
DECLARE
  v jsonb;
  v_card jsonb;
  v_ticket_hash text := encode(extensions.digest('qr54-ala-000000000001', 'sha256'), 'hex');
  v_reg public.event_registrations;
BEGIN
  PERFORM pg_temp.act_as('54a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');

  v := public.admin_event_badge_batch(jsonb_build_object(
    'event_id', '54e00000-0000-0000-0000-0000000000a1',
    'person_ids', jsonb_build_array('54700000-0000-0000-0000-000000000001')));
  v_card := v->'badges'->0;
  INSERT INTO ops54_codes VALUES ('ala_t1', v_card->>'qr_code');

  SELECT * INTO v_reg FROM public.event_registrations WHERE id = '54300000-0000-0000-0000-000000000001';
  PERFORM pg_temp.assert(v_reg.qr_token_hash = v_ticket_hash,
    '54/OPS-04: druk identyfikatora NIE zmienia kodu biletu (e-mail, Apple, Google)');
  PERFORM pg_temp.assert(
    v_card->>'qr_code' IS NOT NULL
    AND v_reg.badge_token_hash = encode(extensions.digest(v_card->>'qr_code', 'sha256'), 'hex')
    AND v_reg.badge_issued_at IS NOT NULL
    AND v_card->>'credential' = 'badge'
    AND NOT (v_card->>'badge_reissued')::boolean,
    '54/OPS-04: identyfikator dostaje WLASNE poswiadczenie (badge_token_hash), pierwszy druk');
END $$;

DO $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.act_as(NULL, NULL);

  -- Bilet z portfela po druku nadal wpuszcza.
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok54-brama-00000001', 'code', 'qr54-ala-000000000001',
    'checkpoint_id', '54c00000-0000-0000-0000-0000000000a2',
    'client_scan_uid', 'scan54-ala-bilet-01'));
  PERFORM pg_temp.assert(v->>'outcome' = 'granted' AND (v->>'admit')::boolean
      AND v->>'credential' = 'ticket',
    '54/OPS-04: bilet z e-maila/portfela po druku identyfikatora WPUSZCZA (nie unknown_code)');

  -- Wydrukowany identyfikator tez jest rozpoznawany.
  v := public.event_checkin_resolve(jsonb_build_object(
    'device_token', 'tok54-brama-00000001',
    'code', (SELECT k.v FROM ops54_codes k WHERE k.k = 'ala_t1'),
    'checkpoint_id', '54c00000-0000-0000-0000-0000000000a2'));
  PERFORM pg_temp.assert(v->>'credential' = 'badge'
      AND v->>'outcome' NOT IN ('unknown_code', 'code_superseded')
      AND v->'person'->>'first_name' = 'Ala',
    '54/OPS-04: kod z identyfikatora rozpoznaje te sama osobe (credential = badge)');
END $$;

DO $$
DECLARE v jsonb; v_card jsonb; v_sup public.event_superseded_codes;
BEGIN
  PERFORM pg_temp.act_as('54a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');

  -- Przedruk: rotuje TYLKO identyfikator.
  v := public.admin_event_badge_batch(jsonb_build_object(
    'event_id', '54e00000-0000-0000-0000-0000000000a1',
    'person_ids', jsonb_build_array('54700000-0000-0000-0000-000000000001')));
  v_card := v->'badges'->0;
  INSERT INTO ops54_codes VALUES ('ala_t2', v_card->>'qr_code');

  PERFORM pg_temp.assert((v_card->>'badge_reissued')::boolean
      AND v_card->>'qr_code' <> (SELECT k.v FROM ops54_codes k WHERE k.k = 'ala_t1'),
    '54/OPS-04: przedruk wydaje NOWY kod identyfikatora i mowi, ze poprzedni zastapil');

  SELECT * INTO v_sup FROM public.event_superseded_codes
   WHERE code_hash = encode(extensions.digest((SELECT k.v FROM ops54_codes k WHERE k.k = 'ala_t1'), 'sha256'), 'hex');
  PERFORM pg_temp.assert(v_sup.credential = 'badge' AND v_sup.reason = 'reissued'
      AND v_sup.registration_id = '54300000-0000-0000-0000-000000000001'
      AND v_sup.tenant_id = '11111111-1111-1111-1111-111111111111',
    '54/OPS-04: stary kod identyfikatora trafia do rejestru zastapionych (badge, reissued)');
  PERFORM pg_temp.assert(
    (SELECT qr_token_hash FROM public.event_registrations WHERE id = '54300000-0000-0000-0000-000000000001')
      = encode(extensions.digest('qr54-ala-000000000001', 'sha256'), 'hex'),
    '54/OPS-04: przedruk nadal nie rusza biletu');
END $$;

-- GOTOWE, GDY: druk -> skan starego kodu x25 nie blokuje urzadzenia.
DO $$
DECLARE v jsonb; i integer; v_dev public.event_scanner_devices;
BEGIN
  PERFORM pg_temp.act_as(NULL, NULL);
  FOR i IN 1..25 LOOP
    v := public.event_checkin_record(jsonb_build_object(
      'device_token', 'tok54-brama-00000001',
      'code', (SELECT k.v FROM ops54_codes k WHERE k.k = 'ala_t1'),
      'checkpoint_id', '54c00000-0000-0000-0000-0000000000a2'));
    IF v->>'outcome' <> 'code_superseded' OR (v->>'device_locked')::boolean THEN
      RAISE EXCEPTION 'ASERCJA NIESPELNIONA: 54/OPS-04: skan % starego identyfikatora dal %', i, v;
    END IF;
  END LOOP;

  SELECT * INTO v_dev FROM public.event_scanner_devices WHERE id = '54d00000-0000-0000-0000-000000000001';
  PERFORM pg_temp.assert(v_dev.locked_until IS NULL AND v_dev.fail_window_count = 0
      AND v_dev.failed_scan_count = 0,
    '54/OPS-04 GOTOWE: 25 skanow zastapionego kodu NIE blokuje urzadzenia i nie liczy sie do okna');
  PERFORM pg_temp.assert(v_dev.superseded_scan_count = 25,
    '54/OPS-04: kazdy skan kodu zastapionego jest policzony osobno (superseded_scan_count)');
  PERFORM pg_temp.assert(NOT (v->>'admit')::boolean
      AND v->'superseded'->>'credential' = 'badge'
      AND v->'superseded'->>'reason' = 'reissued'
      AND (v->'superseded'->>'superseded_at') IS NOT NULL
      AND v->>'display_name' = 'Ala Badge'
      AND v->'person'->>'first_name' = 'Ala'
      AND v->>'queue_marker' IS NOT NULL,
    '54/OPS-04: code_superseded to odmowa z imieniem osoby i chwila zastapienia dla operatora');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_checkins
      WHERE person_id = '54700000-0000-0000-0000-000000000001') = 1,
    '54/OPS-04: skan kodu zastapionego NIE zaklada wiersza w dzienniku odpraw');

  -- Kontrapunkt: naprawde nieznany kod zachowuje sie jak dotad.
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok54-brama-00000001', 'code', 'kod-ktorego-nigdy-nie-bylo',
    'checkpoint_id', '54c00000-0000-0000-0000-0000000000a2'));
  PERFORM pg_temp.assert(v->>'outcome' = 'unknown_code'
      AND (SELECT fail_window_count = 1 AND failed_scan_count = 1 FROM public.event_scanner_devices
            WHERE id = '54d00000-0000-0000-0000-000000000001'),
    '54/OPS-04: kod naprawde nieznany nadal liczy sie do okna blokady (bez zmian)');

  -- Nowy identyfikator wpuszcza, bilet tez.
  v := public.event_checkin_resolve(jsonb_build_object(
    'device_token', 'tok54-brama-00000002',
    'code', (SELECT k.v FROM ops54_codes k WHERE k.k = 'ala_t2'),
    'checkpoint_id', '54c00000-0000-0000-0000-0000000000a2'));
  PERFORM pg_temp.assert(v->>'credential' = 'badge' AND v->>'outcome' <> 'code_superseded',
    '54/OPS-04: nowy kod identyfikatora jest wazny');

  -- Stoisko: kod zastapiony bez leada i BEZ tozsamosci.
  v := public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok54-lead-a-0000001',
    'code', (SELECT k.v FROM ops54_codes k WHERE k.k = 'ala_t1')));
  PERFORM pg_temp.assert(v->>'outcome' = 'code_superseded' AND v->'person' = 'null'::jsonb
      AND v->'display_name' = 'null'::jsonb
      AND NOT EXISTS (SELECT 1 FROM public.event_lead_scans
                       WHERE person_id = '54700000-0000-0000-0000-000000000001'),
    '54/OPS-04: stoisko - kod zastapiony nie tworzy leada i nie oddaje tozsamosci');

  -- Kiosk: kod zastapiony nie drukuje, nowy drukuje.
  v := public.event_badge_print_record(jsonb_build_object(
    'device_token', 'tok54-kiosk-00000001',
    'code', (SELECT k.v FROM ops54_codes k WHERE k.k = 'ala_t1')));
  PERFORM pg_temp.assert(v->>'outcome' = 'code_superseded'
      AND NOT EXISTS (SELECT 1 FROM public.event_badge_prints
                       WHERE person_id = '54700000-0000-0000-0000-000000000001'),
    '54/OPS-04: kiosk - kod zastapiony nie zapisuje wydruku');
  v := public.event_badge_print_record(jsonb_build_object(
    'device_token', 'tok54-kiosk-00000001',
    'code', (SELECT k.v FROM ops54_codes k WHERE k.k = 'ala_t2')));
  PERFORM pg_temp.assert(v->>'outcome' IN ('printed'),
    '54/OPS-04: kiosk - wazny kod identyfikatora drukuje (kontrapunkt)');
END $$;

-- Lista offline: skrot identyfikatora i skroty zastapione.
DO $$
DECLARE v jsonb; v_row jsonb;
BEGIN
  v := public.event_scanner_roster(jsonb_build_object('device_token', 'tok54-brama-00000001'));
  SELECT x INTO v_row FROM jsonb_array_elements(v->'rows') x
   WHERE x->>'r' = '54300000-0000-0000-0000-000000000001';
  PERFORM pg_temp.assert(
    v_row->>'h' = encode(extensions.digest('qr54-ala-000000000001', 'sha256'), 'hex')
    AND v_row->>'bh' = encode(extensions.digest((SELECT k.v FROM ops54_codes k WHERE k.k = 'ala_t2'), 'sha256'), 'hex')
    AND (v_row->'sh') ? encode(extensions.digest((SELECT k.v FROM ops54_codes k WHERE k.k = 'ala_t1'), 'sha256'), 'hex'),
    '54/OPS-04: lista offline niesie bilet (h), identyfikator (bh) i kody zastapione (sh)');
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM jsonb_array_elements(v->'checkpoints') c
             WHERE c->>'id' = '54c00000-0000-0000-0000-0000000000a1'
               AND c->>'reentry_policy' = 'deny')
    AND v->>'queue_marker' IS NOT NULL,
    '54/OPS-08/12: lista offline niesie polityke ponownego wejscia punktow i znacznik kolejki');
END $$;

-- Jawne uniewaznienie zgubionego biletu i identyfikatora.
DO $$
DECLARE v jsonb; v_new text;
BEGIN
  PERFORM pg_temp.act_as('54a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  v := public.admin_event_registration_code_invalidate(jsonb_build_object(
    'registration_id', '54300000-0000-0000-0000-000000000005', 'credential', 'ticket'));
  v_new := v->>'code';
  PERFORM pg_temp.assert(v_new IS NOT NULL AND v->>'credential' = 'ticket'
      AND (SELECT qr_token_hash FROM public.event_registrations WHERE id = '54300000-0000-0000-0000-000000000005')
        = encode(extensions.digest(v_new, 'sha256'), 'hex'),
    '54/OPS-04: uniewaznienie zgubionego biletu wydaje nowy kod i oddaje go RAZ');
  PERFORM pg_temp.assert(
    (SELECT reason FROM public.event_superseded_codes
      WHERE code_hash = encode(extensions.digest('qr54-ewa-00000000001', 'sha256'), 'hex')) = 'invalidated'
    AND EXISTS (SELECT 1 FROM public.domain_events
                 WHERE event_type = 'event.registration.code_invalidated.v1'
                   AND aggregate_id = '54300000-0000-0000-0000-000000000005'
                   AND actor_id = '54a00000-0000-0000-0000-0000000000a1'),
    '54/OPS-04: stary bilet ma powod invalidated, a uniewaznienie zdarzenie z aktorem');

  PERFORM pg_temp.assert_raises_like($q$
    SELECT public.admin_event_registration_code_invalidate(jsonb_build_object(
      'registration_id', '54300000-0000-0000-0000-000000000005', 'credential', 'badge'))
  $q$, 'badge_not_issued', '54/OPS-04: nie ma czego uniewaznic - identyfikatora nie wydrukowano');
  PERFORM pg_temp.assert_raises_like($q$
    SELECT public.admin_event_registration_code_invalidate(jsonb_build_object(
      'registration_id', '54300000-0000-0000-0000-000000000005', 'credential', 'wallet'))
  $q$, 'invalid_payload', '54/OPS-04: nieznany rodzaj poswiadczenia odrzucony');

  -- Zgubiony identyfikator Ali: zdjety, przedruk wyda nowy.
  v := public.admin_event_registration_code_invalidate(jsonb_build_object(
    'registration_id', '54300000-0000-0000-0000-000000000001', 'credential', 'badge'));
  PERFORM pg_temp.assert(v->'code' = 'null'::jsonb
      AND (SELECT badge_token_hash IS NULL FROM public.event_registrations
            WHERE id = '54300000-0000-0000-0000-000000000001'),
    '54/OPS-04: uniewaznienie identyfikatora zdejmuje jego kod (bez nowej wartosci jawnej)');

  PERFORM pg_temp.act_as(NULL, NULL);
  PERFORM pg_temp.assert_raises_like($q$
    SELECT public.admin_event_registration_code_invalidate(jsonb_build_object(
      'registration_id', '54300000-0000-0000-0000-000000000005', 'credential', 'ticket'))
  $q$, 'forbidden', '54/OPS-04: anonim nie uniewazni kodu');

  v := public.event_checkin_resolve(jsonb_build_object(
    'device_token', 'tok54-brama-00000002', 'code', 'qr54-ewa-00000000001',
    'checkpoint_id', '54c00000-0000-0000-0000-0000000000a2'));
  PERFORM pg_temp.assert(v->>'outcome' = 'code_superseded'
      AND v->'superseded'->>'credential' = 'ticket'
      AND v->'superseded'->>'reason' = 'invalidated'
      AND v->'checkpoint'->>'id' = '54c00000-0000-0000-0000-0000000000a2',
    '54/OPS-04: stary bilet (np. przepustka portfela) daje code_superseded, nie unknown_code');
  v := public.event_checkin_resolve(jsonb_build_object(
    'device_token', 'tok54-brama-00000002',
    'code', (SELECT k.v FROM ops54_codes k WHERE k.k = 'ala_t2'),
    'checkpoint_id', '54c00000-0000-0000-0000-0000000000a2'));
  PERFORM pg_temp.assert(v->>'outcome' = 'code_superseded'
      AND v->'superseded'->>'reason' = 'invalidated',
    '54/OPS-04: uniewazniony identyfikator daje code_superseded z powodem invalidated');
END $$;

-- Identyfikator nie wpuszcza dluzej niz bilet (zwrot czysci oba).
DO $$
DECLARE v jsonb; v_card jsonb;
BEGIN
  PERFORM pg_temp.act_as('54a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  v := public.admin_event_badge_batch(jsonb_build_object(
    'event_id', '54e00000-0000-0000-0000-0000000000a1',
    'person_ids', jsonb_build_array('54700000-0000-0000-0000-000000000006')));
  v_card := v->'badges'->0;
  INSERT INTO ops54_codes VALUES ('filip_badge', v_card->>'qr_code');

  -- Zwrot w dowolnej sciezce czysci kod biletu (np. payments_apply_event_ticket_outcome).
  UPDATE public.event_registrations SET qr_token_hash = NULL
   WHERE id = '54300000-0000-0000-0000-000000000006';

  PERFORM pg_temp.assert(
    (SELECT badge_token_hash IS NULL AND badge_issued_at IS NULL FROM public.event_registrations
      WHERE id = '54300000-0000-0000-0000-000000000006')
    AND (SELECT count(*) FROM public.event_superseded_codes
          WHERE registration_id = '54300000-0000-0000-0000-000000000006' AND reason = 'revoked') = 2,
    '54/OPS-04: wyczyszczony bilet zdejmuje identyfikator; oba kody zastapione (revoked)');

  PERFORM pg_temp.act_as(NULL, NULL);
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok54-brama-00000002',
    'code', (SELECT k.v FROM ops54_codes k WHERE k.k = 'filip_badge'),
    'checkpoint_id', '54c00000-0000-0000-0000-0000000000a2'));
  PERFORM pg_temp.assert(v->>'outcome' = 'code_superseded' AND v->'superseded'->>'reason' = 'revoked',
    '54/OPS-04: identyfikator po zwrocie biletu nie wpuszcza (code_superseded, revoked)');
END $$;

-- ---------------------------------------------------------------------------
-- SEKCJA 2 (OPS-08): PONOWNE WEJSCIE
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.act_as(NULL, NULL);

  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok54-brama-00000002', 'code', 'qr54-bolek-0000000001',
    'checkpoint_id', '54c00000-0000-0000-0000-0000000000a1', 'direction', 'in',
    'client_scan_uid', 'scan54-bolek-001', 'device_scanned_at', now() - interval '30 minutes'));
  PERFORM pg_temp.assert(v->>'outcome' = 'granted' AND NOT (v->>'reentry')::boolean
      AND v->'checkpoint'->>'reentry_policy' = 'deny',
    '54/OPS-08: pierwsze wejscie przy polityce deny wpuszcza (reentry = false)');

  -- Podwojne pikniecie w oknie idempotencji: nadal repeat, nie odmowa.
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok54-brama-00000002', 'code', 'qr54-bolek-0000000001',
    'checkpoint_id', '54c00000-0000-0000-0000-0000000000a1', 'direction', 'in',
    'client_scan_uid', 'scan54-bolek-002',
    'device_scanned_at', now() - interval '30 minutes' + interval '20 seconds'));
  PERFORM pg_temp.assert(v->>'outcome' = 'repeat' AND (v->>'admit')::boolean,
    '54/OPS-08: powtorzone pikniecie w oknie to repeat tego samego wejscia');

  -- GOTOWE, GDY: drugie wejscie poza oknem przy polityce deny -> odmowa.
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok54-brama-00000002', 'code', 'qr54-bolek-0000000001',
    'checkpoint_id', '54c00000-0000-0000-0000-0000000000a1', 'direction', 'in',
    'client_scan_uid', 'scan54-bolek-003', 'device_scanned_at', now() - interval '20 minutes'));
  PERFORM pg_temp.assert(v->>'outcome' = 'denied_already_inside'
      AND v->>'result' = 'denied_already_inside'
      AND NOT (v->>'admit')::boolean
      AND (v->>'reentry')::boolean
      AND (v->>'reentry_previous_at')::timestamptz = now() - interval '30 minutes',
    '54/OPS-08 GOTOWE: drugie wejscie poza oknem przy deny -> denied_already_inside z chwila poprzedniego');

  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok54-brama-00000002', 'code', 'qr54-bolek-0000000001',
    'checkpoint_id', '54c00000-0000-0000-0000-0000000000a1', 'direction', 'in',
    'client_scan_uid', 'scan54-bolek-004',
    'device_scanned_at', now() - interval '20 minutes' + interval '10 seconds'));
  PERFORM pg_temp.assert(v->>'outcome' = 'repeat' AND v->>'result' = 'denied_already_inside',
    '54/OPS-08: powtorzona odmowa w oknie to repeat odmowy, nie nowy wiersz');

  -- Wyjscie zeruje stan: kolejne wejscie wpuszcza.
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok54-brama-00000002', 'code', 'qr54-bolek-0000000001',
    'checkpoint_id', '54c00000-0000-0000-0000-0000000000a1', 'direction', 'out',
    'client_scan_uid', 'scan54-bolek-005', 'device_scanned_at', now() - interval '10 minutes'));
  PERFORM pg_temp.assert(v->>'outcome' = 'granted' AND NOT (v->>'reentry')::boolean,
    '54/OPS-08: wyjscie przechodzi i nie jest ponownym wejsciem');
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok54-brama-00000002', 'code', 'qr54-bolek-0000000001',
    'checkpoint_id', '54c00000-0000-0000-0000-0000000000a1', 'direction', 'in',
    'client_scan_uid', 'scan54-bolek-006', 'device_scanned_at', now() - interval '5 minutes'));
  PERFORM pg_temp.assert(v->>'outcome' = 'granted' AND NOT (v->>'reentry')::boolean,
    '54/OPS-08: wejscie po wyjsciu wpuszcza (polityka deny nie blokuje powrotu)');

  -- Podglad: osoba w srodku.
  v := public.event_checkin_resolve(jsonb_build_object(
    'device_token', 'tok54-brama-00000002', 'code', 'qr54-bolek-0000000001',
    'checkpoint_id', '54c00000-0000-0000-0000-0000000000a1', 'direction', 'in'));
  PERFORM pg_temp.assert(v->>'outcome' = 'denied_already_inside' AND NOT (v->>'admit')::boolean
      AND (v->>'reentry')::boolean
      AND (v->>'reentry_previous_at')::timestamptz = now() - interval '5 minutes'
      AND v->'checkpoint'->>'reentry_policy' = 'deny',
    '54/OPS-08: podglad mowi to samo co zapis (denied_already_inside, reentry_previous_at)');

  PERFORM pg_temp.assert(
    (SELECT count(*) FILTER (WHERE result = 'granted' AND direction = 'in') = 2
        AND count(*) FILTER (WHERE result = 'denied_already_inside') = 1
        AND count(*) FILTER (WHERE direction = 'out') = 1
       FROM public.event_checkins
      WHERE person_id = '54700000-0000-0000-0000-000000000002'),
    '54/OPS-08: dziennik: 2 wejscia (przed i po wyjsciu), 1 odmowa, 1 wyjscie - bez duplikatow');

  -- Polityka allow: ponowne wejscie wpuszcza, ale jest JAWNIE oznaczone.
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok54-brama-00000002', 'code', 'qr54-cezary-000000001',
    'checkpoint_id', '54c00000-0000-0000-0000-0000000000a2',
    'client_scan_uid', 'scan54-cezary-001', 'device_scanned_at', now() - interval '30 minutes'));
  PERFORM pg_temp.assert(v->>'outcome' = 'granted' AND NOT (v->>'reentry')::boolean,
    '54/OPS-08: allow - pierwsze wejscie bez flagi');
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok54-brama-00000002', 'code', 'qr54-cezary-000000001',
    'checkpoint_id', '54c00000-0000-0000-0000-0000000000a2',
    'client_scan_uid', 'scan54-cezary-002', 'device_scanned_at', now() - interval '20 minutes'));
  PERFORM pg_temp.assert(v->>'outcome' = 'granted' AND (v->>'admit')::boolean
      AND (v->>'reentry')::boolean
      AND (v->>'reentry_previous_at')::timestamptz = now() - interval '30 minutes'
      AND v->'checkpoint'->>'reentry_policy' = 'allow',
    '54/OPS-08: allow - ponowne wejscie wpuszcza z flaga reentry = true i chwila poprzedniego');
END $$;

-- Skan z kolejki a wejscie na zywo tego samego kodu: zadne "granted x2" nie
-- znika bez sladu.
--
-- ZMIANA ZAMIERZONA (20261012111000, R9): dotad skan z kolejki SPRZED wejscia
-- na zywo (-40 min wobec -35 min) byl zapisywany jako denied_already_inside
-- na podstawie POZNIEJSZEGO wejscia - nieprawdziwie (to bylo pierwsze
-- wejscie), a przy wyjsciu jeszcze w drodze z tej samej kolejki byl to
-- falszywy konflikt zalezny od kolejnosci synchronizacji. Teraz ocena widzi
-- tylko skany WCZESNIEJSZE: skan -40 min to prawdziwa zgoda (wpuszczono
-- offline), a para dwoch wejsc bez wyjscia pomiedzy jest konfliktem
-- double_entry w dzienniku panelu. Prawdziwie DRUGIE wejscie z kolejki
-- (wczesniejsze wejscie bez wyjscia, zsynchronizowane pozniej z innego
-- urzadzenia) nadal zapisuje sie jako denied_already_inside + admitted_offline.
DO $$
DECLARE v jsonb; v_row public.event_checkins; v_list record; v_live uuid; v_second uuid;
BEGIN
  PERFORM pg_temp.act_as(NULL, NULL);
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok54-brama-00000002', 'code', 'qr54-darek-0000000001',
    'checkpoint_id', '54c00000-0000-0000-0000-0000000000a3',
    'client_scan_uid', 'scan54-darek-live', 'device_scanned_at', now() - interval '35 minutes'));
  PERFORM pg_temp.assert(v->>'outcome' = 'granted',
    '54/OPS-08: wejscie na zywo przez urzadzenie 2');
  v_live := (v->>'checkin_id')::uuid;

  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok54-brama-00000001', 'code', 'qr54-darek-0000000001',
    'checkpoint_id', '54c00000-0000-0000-0000-0000000000a3',
    'client_scan_uid', 'scan54-darek-offline', 'device_scanned_at', now() - interval '40 minutes',
    'queued', true, 'offline_admitted', true, 'offline_outcome', 'granted',
    'roster_generated_at', now() - interval '1 hour'));
  SELECT * INTO v_row FROM public.event_checkins WHERE id = (v->>'checkin_id')::uuid;
  PERFORM pg_temp.assert(v->>'outcome' = 'granted' AND (v->>'admit')::boolean
      AND NOT (v->>'reentry')::boolean AND v->'reentry_previous_at' = 'null'::jsonb
      AND v_row.result = 'granted' AND v_row.offline_admitted
      AND v_row.offline_outcome = 'granted',
    '54/OPS-08 (R9): kolejka - wejscie SPRZED wejscia na zywo zapisane PRAWDZIWIE jako zgoda (nie odbija sie od pozniejszego skanu, reentry_previous_at nie wskazuje przyszlosci)');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_checkins
      WHERE person_id = '54700000-0000-0000-0000-000000000004'
        AND checkpoint_id = '54c00000-0000-0000-0000-0000000000a3'
        AND result = 'granted' AND direction = 'in') = 2,
    '54/OPS-08 (R9): oba fizyczne wejscia tego kodu sa w dzienniku - nic nie znika po cichu');

  PERFORM pg_temp.act_as('54a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.admin_event_checkins_list(
      '54e00000-0000-0000-0000-0000000000a1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 50, 0, true) l
      WHERE l.id IN (v_row.id, v_live) AND l.conflict AND l.conflict_kind = 'double_entry') = 2,
    '54/OPS-08 (R9): dziennik panelu pokazuje konflikt double_entry na OBU wierszach pary - organizator wie o podwojnym wejsciu');

  -- Prawdziwie drugie wejscie: wczesniejsze wejscie (-35 min) bez wyjscia,
  -- skan z kolejki innego urzadzenia pozniej (-30 min), wpuszczony offline.
  PERFORM pg_temp.act_as(NULL, NULL);
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok54-brama-00000001', 'code', 'qr54-darek-0000000001',
    'checkpoint_id', '54c00000-0000-0000-0000-0000000000a3',
    'client_scan_uid', 'scan54-darek-offline-2', 'device_scanned_at', now() - interval '30 minutes',
    'queued', true, 'offline_admitted', true, 'offline_outcome', 'granted',
    'roster_generated_at', now() - interval '1 hour'));
  SELECT * INTO v_row FROM public.event_checkins WHERE id = (v->>'checkin_id')::uuid;
  v_second := v_row.id;
  PERFORM pg_temp.assert(v->>'outcome' = 'denied_already_inside' AND (v->>'reentry')::boolean
      AND (v->>'reentry_previous_at')::timestamptz = now() - interval '35 minutes'
      AND v_row.result = 'denied_already_inside' AND v_row.offline_admitted
      AND v_row.offline_outcome = 'granted',
    '54/OPS-08: kolejka - prawdziwie DRUGIE wejscie tego kodu zapisane PRAWDZIWIE (odmowa serwera + wpuszczono offline)');

  PERFORM pg_temp.act_as('54a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  SELECT * INTO v_list FROM public.admin_event_checkins_list(
    '54e00000-0000-0000-0000-0000000000a1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 50, 0, true) l
   WHERE l.id = v_second;
  PERFORM pg_temp.assert(v_list.conflict AND v_list.conflict_kind = 'admitted_offline',
    '54/OPS-08: dziennik panelu pokazuje konflikt admitted_offline - organizator wie o podwojnym wejsciu');

  -- Ta sama osoba przy dwoch urzadzeniach w oknie idempotencji: skan z kolejki
  -- SPRZED skanu na zywo (okna zachodza) to powtorzenie, nie blad EXCLUDE.
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok54-brama-00000002', 'code', 'qr54-darek-0000000001',
    'checkpoint_id', '54c00000-0000-0000-0000-0000000000a2',
    'client_scan_uid', 'scan54-darek-twin-live', 'device_scanned_at', now() - interval '8 minutes'));
  PERFORM pg_temp.assert(v->>'outcome' = 'granted', '54/OPS-08: wejscie na zywo (punkt allow)');
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok54-brama-00000001', 'code', 'qr54-darek-0000000001',
    'checkpoint_id', '54c00000-0000-0000-0000-0000000000a2',
    'client_scan_uid', 'scan54-darek-twin-queued', 'queued', true,
    'device_scanned_at', now() - interval '8 minutes' - interval '30 seconds'));
  PERFORM pg_temp.assert(v->>'outcome' = 'repeat' AND (v->>'admit')::boolean
      AND NOT (v->>'reentry')::boolean
      AND (SELECT count(*) FROM public.event_checkins
            WHERE person_id = '54700000-0000-0000-0000-000000000004'
              AND checkpoint_id = '54c00000-0000-0000-0000-0000000000a2') = 1,
    '54/OPS-08: skan z kolejki w oknie POZNIEJSZEGO wejscia to repeat tamtego wiersza (bez bledu EXCLUDE, bez flagi reentry)');

  -- Odmowa bramki offline "juz w srodku", a serwer by wpuscil: wygrywa bramka.
  PERFORM pg_temp.act_as(NULL, NULL);
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok54-brama-00000001', 'code', 'qr54-grzegorz-000001',
    'checkpoint_id', '54c00000-0000-0000-0000-0000000000a3',
    'client_scan_uid', 'scan54-grzegorz-off', 'device_scanned_at', now() - interval '15 minutes',
    'queued', true, 'offline_admitted', false, 'offline_outcome', 'denied_already_inside'));
  SELECT * INTO v_row FROM public.event_checkins WHERE id = (v->>'checkin_id')::uuid;
  PERFORM pg_temp.assert(v_row.result = 'denied_already_inside'
      AND v_row.offline_server_result = 'granted'
      AND (v->>'server_admit')::boolean AND NOT (v->>'admit')::boolean
      AND (SELECT attended_at IS NULL FROM public.event_registrations
            WHERE id = '54300000-0000-0000-0000-000000000009'),
    '54/OPS-08: odmowa offline denied_already_inside jest przyjeta i nie stempluje obecnosci');
END $$;

-- Panel: polityka w liscie i zapisie, deny tylko w trybie control.
DO $$
DECLARE v_id uuid; v_row record;
BEGIN
  PERFORM pg_temp.act_as('54a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  v_id := public.admin_event_checkpoint_save(jsonb_build_object(
    'event_id', '54e00000-0000-0000-0000-0000000000a1', 'name_pl', 'Nowa brama', 'name_en', 'New gate',
    'kind', 'event_entry', 'access_mode', 'control', 'reentry_policy', 'deny'));
  SELECT * INTO v_row FROM public.admin_event_checkpoints_list('54e00000-0000-0000-0000-0000000000a1') l
   WHERE l.id = v_id;
  PERFORM pg_temp.assert(v_row.reentry_policy = 'deny',
    '54/OPS-08: zapis punktu z polityka deny i lista ja zwraca');

  PERFORM public.admin_event_checkpoint_save(jsonb_build_object(
    'id', v_id, 'name_pl', 'Nowa brama', 'name_en', 'New gate', 'kind', 'event_entry',
    'access_mode', 'track'));
  PERFORM pg_temp.assert(
    (SELECT reentry_policy FROM public.event_checkpoints WHERE id = v_id) = 'allow',
    '54/OPS-08: przejscie na tryb track czysci polityke deny (wiazanie spoza trybu)');

  PERFORM pg_temp.assert_raises_like(format($q$
    SELECT public.admin_event_checkpoint_save(jsonb_build_object(
      'id', %L, 'name_pl', 'Nowa brama', 'name_en', 'New gate', 'kind', 'event_entry',
      'reentry_policy', 'czasem'))
  $q$, v_id), 'invalid_payload', '54/OPS-08: nieznana polityka odrzucona');

  PERFORM pg_temp.assert_raises_like(format($q$
    UPDATE public.event_checkpoints SET reentry_policy = 'deny' WHERE id = %L
  $q$, v_id), 'event_checkpoints_reentry_needs_control',
    '54/OPS-08: CHECK - deny bez trybu control odrzucone w silniku');
END $$;

-- ---------------------------------------------------------------------------
-- SEKCJA 3 (OPS-12): OKNO KOLEJKI ZE ZNACZNIKIEM, WLASNY PROG, TERMIN
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb; v_at timestamptz; v_dev public.event_scanner_devices;
BEGIN
  PERFORM pg_temp.act_as(NULL, NULL);
  SELECT * INTO v_dev FROM public.event_scanner_devices WHERE id = '54d00000-0000-0000-0000-000000000001';

  v := public.event_scanner_bootstrap(jsonb_build_object('device_token', 'tok54-brama-00000001'));
  v_at := public._event_scanner_queue_marker_at(v_dev.id, v_dev.queue_secret, v->>'queue_marker');
  PERFORM pg_temp.assert(v_at IS NOT NULL AND v_at BETWEEN now() - interval '1 second' AND now()
      AND (v->>'queue_marker_valid_until')::timestamptz <= v_dev.expires_at
      AND (v->>'queue_marker_valid_until')::timestamptz > now(),
    '54/OPS-12: bootstrap oddaje znacznik kolejki podpisany sekretem TEGO urzadzenia');
  PERFORM pg_temp.assert(position(v_dev.queue_secret IN v::text) = 0
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(v->'checkpoints') c
                   WHERE c->>'id' = '54c00000-0000-0000-0000-0000000000a1' AND c->>'reentry_policy' = 'deny'),
    '54/OPS-12/08: bootstrap nie zdradza sekretu i niesie polityke ponownego wejscia');
  PERFORM pg_temp.assert(
    public._event_scanner_queue_marker_at(
      '54d00000-0000-0000-0000-000000000002',
      (SELECT queue_secret FROM public.event_scanner_devices WHERE id = '54d00000-0000-0000-0000-000000000002'),
      v->>'queue_marker') IS NULL,
    '54/OPS-12: znacznik jednego urzadzenia nie weryfikuje sie dla innego');
END $$;

SELECT pg_temp.assert(
  NOT has_column_privilege('authenticated', 'public.event_scanner_devices', 'queue_secret', 'SELECT')
  AND NOT has_column_privilege('anon', 'public.event_scanner_devices', 'queue_secret', 'SELECT')
  AND has_column_privilege('authenticated', 'public.event_scanner_devices', 'superseded_scan_count', 'SELECT')
  AND NOT has_function_privilege('anon', 'public._event_scanner_queue_marker(uuid, text, timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_scanner_code_lookup(uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._event_scanner_device_auth_sync(text, text, timestamptz, text)', 'EXECUTE'),
  '54/OPS-12: sekret kolejki bez grantu kolumnowego, funkcje pomocnicze tylko dla service_role');

-- ZMIANA ZAMIERZONA (20261012111100, R0/R11): scisla regula znacznika
-- obowiazuje urzadzenie, ktore zadeklarowalo klienta przechowujacego
-- znacznik (queue_marker_required_at - bootstrap z client_caps albo wazny
-- znacznik). Urzadzenie, ktore NIGDY tego nie zrobilo (stara wersja skanera),
-- przechodzi sciezka przejsciowa - sprawdza ja 56_scanner_review_fixes.
-- Ponizsze asercje dotycza wiec urzadzenia, ktore deklaracje zlozylo przed
-- terminem; ich tresc jest bez zmian.
UPDATE public.event_scanner_devices
   SET queue_marker_required_at = now() - interval '2 days'
 WHERE id = '54d00000-0000-0000-0000-000000000003';

-- GOTOWE, GDY: queued = true po terminie bez znacznika (urzadzenie
-- z klientem ze znacznikiem) -> device_expired.
SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok54-wygasle-000001', 'code', 'qr54-hanna-0000000001',
    'checkpoint_id', '54c00000-0000-0000-0000-0000000000a2',
    'client_scan_uid', 'scan54-hanna-nomark',
    'device_scanned_at', now() - interval '2 hours', 'queued', true))
$q$, 'device_expired',
  '54/OPS-12 GOTOWE: skan z kolejki po terminie BEZ znacznika kolejki (urzadzenie z klientem ze znacznikiem) -> device_expired');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok54-wygasle-000001', 'code', 'qr54-hanna-0000000001',
    'checkpoint_id', '54c00000-0000-0000-0000-0000000000a2',
    'device_scanned_at', now() - interval '2 hours', 'queued', true,
    'queue_marker', repeat('A', 54)))
$q$, 'device_expired',
  '54/OPS-12: podrobiony znacznik kolejki -> device_expired');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok54-wygasle-000001', 'code', 'qr54-hanna-0000000001',
    'checkpoint_id', '54c00000-0000-0000-0000-0000000000a2',
    'device_scanned_at', now() - interval '2 hours', 'queued', true,
    'queue_marker', public._event_scanner_queue_marker(
      '54d00000-0000-0000-0000-000000000002',
      (SELECT queue_secret FROM public.event_scanner_devices WHERE id = '54d00000-0000-0000-0000-000000000002'),
      now() - interval '3 hours')))
$q$, 'device_expired',
  '54/OPS-12: znacznik INNEGO urzadzenia -> device_expired');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok54-wygasle-000001', 'code', 'qr54-hanna-0000000001',
    'checkpoint_id', '54c00000-0000-0000-0000-0000000000a2',
    'device_scanned_at', now() - interval '2 hours', 'queued', true,
    'queue_marker', public._event_scanner_queue_marker(
      '54d00000-0000-0000-0000-000000000003',
      (SELECT queue_secret FROM public.event_scanner_devices WHERE id = '54d00000-0000-0000-0000-000000000003'),
      now() - interval '30 minutes')))
$q$, 'device_expired',
  '54/OPS-12: znacznik wydany PO terminie -> device_expired');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok54-wygasle-000001', 'code', 'qr54-hanna-0000000001',
    'checkpoint_id', '54c00000-0000-0000-0000-0000000000a2',
    'device_scanned_at', now() - interval '2 hours', 'queued', true,
    'queue_marker', public._event_scanner_queue_marker(
      '54d00000-0000-0000-0000-000000000003',
      (SELECT queue_secret FROM public.event_scanner_devices WHERE id = '54d00000-0000-0000-0000-000000000003'),
      now() - interval '30 hours')))
$q$, 'device_expired',
  '54/OPS-12: skan ponad 24 h po wydaniu znacznika (horyzont pracy bez sieci) -> device_expired');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok54-wygasle-000001', 'code', 'qr54-hanna-0000000001',
    'checkpoint_id', '54c00000-0000-0000-0000-0000000000a2',
    'device_scanned_at', now() - interval '3 hours 20 minutes', 'queued', true,
    'queue_marker', public._event_scanner_queue_marker(
      '54d00000-0000-0000-0000-000000000003',
      (SELECT queue_secret FROM public.event_scanner_devices WHERE id = '54d00000-0000-0000-0000-000000000003'),
      now() - interval '3 hours')))
$q$, 'device_expired',
  '54/OPS-12: czas skanu wczesniej niz znacznik minus 15 min tolerancji -> device_expired');

DO $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.act_as(NULL, NULL);
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok54-wygasle-000001', 'code', 'qr54-hanna-0000000001',
    'checkpoint_id', '54c00000-0000-0000-0000-0000000000a2',
    'client_scan_uid', 'scan54-hanna-mark',
    'device_scanned_at', now() - interval '2 hours', 'queued', true,
    'queue_marker', public._event_scanner_queue_marker(
      '54d00000-0000-0000-0000-000000000003',
      (SELECT queue_secret FROM public.event_scanner_devices WHERE id = '54d00000-0000-0000-0000-000000000003'),
      now() - interval '3 hours')));
  PERFORM pg_temp.assert(v->>'outcome' = 'granted' AND v->'person' = 'null'::jsonb
      AND NOT (v ? 'queue_marker'),
    '54/OPS-12: wazny znacznik sprzed terminu - skan z kolejki przyjety w oknie 72 h, bez karty osoby i bez nowego znacznika');

  -- Przed terminem bez zmian: stary klient bez znacznika dziala.
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok54-kolejka-000001', 'code', 'qr54-hanna-0000000001',
    'checkpoint_id', '54c00000-0000-0000-0000-0000000000a2',
    'client_scan_uid', 'scan54-hanna-old-client',
    'device_scanned_at', now() - interval '1 hour', 'queued', true));
  PERFORM pg_temp.assert(v->>'outcome' IN ('granted', 'repeat') AND v->>'queue_marker' IS NOT NULL,
    '54/OPS-12: przed terminem skan z kolejki bez znacznika przechodzi (stary klient) i dostaje znacznik');
END $$;

-- Nieznane kody z kolejki: wlasny prog (100 w 60 minut).
DO $$
DECLARE v jsonb; i integer; v_dev public.event_scanner_devices;
BEGIN
  PERFORM pg_temp.act_as(NULL, NULL);
  FOR i IN 1..99 LOOP
    v := public.event_checkin_record(jsonb_build_object(
      'device_token', 'tok54-kolejka-000001', 'code', 'zgadywany-z-kolejki-' || i,
      'checkpoint_id', '54c00000-0000-0000-0000-0000000000a2',
      'device_scanned_at', now() - interval '10 minutes', 'queued', true));
  END LOOP;
  SELECT * INTO v_dev FROM public.event_scanner_devices WHERE id = '54d00000-0000-0000-0000-000000000004';
  PERFORM pg_temp.assert(NOT (v->>'device_locked')::boolean AND v_dev.locked_until IS NULL
      AND v_dev.queue_fail_window_count = 99 AND v_dev.fail_window_count = 0,
    '54/OPS-12: 99 nieznanych kodow z kolejki - jeszcze bez blokady, okno na zywo nietkniete');

  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok54-kolejka-000001', 'code', 'zgadywany-z-kolejki-100',
    'checkpoint_id', '54c00000-0000-0000-0000-0000000000a2',
    'device_scanned_at', now() - interval '10 minutes', 'queued', true));
  -- ZMIANA ZAMIERZONA (20261012111100, R12): blokada z kolejki zatrzymuje
  -- SAMA kolejke (queue_locked_until), nie skanowanie na zywo (locked_until).
  PERFORM pg_temp.assert((v->>'queue_locked')::boolean AND NOT (v->>'device_locked')::boolean
      AND (SELECT queue_locked_until > now() AND locked_until IS NULL
             FROM public.event_scanner_devices
            WHERE id = '54d00000-0000-0000-0000-000000000004')
      AND EXISTS (SELECT 1 FROM public.domain_events
                   WHERE event_type = 'event_scanner_device.locked.v1'
                     AND aggregate_id = '54d00000-0000-0000-0000-000000000004'
                     AND payload->>'source' = 'queue'
                     AND payload->>'scope' = 'queue_sync'),
    '54/OPS-12 (R12): setny nieznany kod z kolejki blokuje SAMA kolejke (queue_locked_until, zdarzenie locked.v1 ze zrodlem queue); blokada na zywo nietknieta');

  PERFORM pg_temp.assert_raises_like($q$
    SELECT public.event_checkin_record(jsonb_build_object(
      'device_token', 'tok54-kolejka-000001', 'code', 'qr54-hanna-0000000001',
      'checkpoint_id', '54c00000-0000-0000-0000-0000000000a2', 'queued', true,
      'device_scanned_at', now() - interval '5 minutes'))
  $q$, 'device_locked', '54/OPS-12: zablokowane urzadzenie nie synchronizuje kolejki');

  PERFORM pg_temp.act_as('54a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  PERFORM public.admin_event_scanner_device_set_active(jsonb_build_object(
    'device_id', '54d00000-0000-0000-0000-000000000004', 'is_active', true));
  PERFORM pg_temp.assert(
    (SELECT locked_until IS NULL AND queue_locked_until IS NULL
       AND queue_fail_window_count = 0 AND queue_fail_window_started_at IS NULL
       AND failed_scan_count = 100
      FROM public.event_scanner_devices WHERE id = '54d00000-0000-0000-0000-000000000004'),
    '54/OPS-12: wznowienie zdejmuje blokade (takze kolejki) i czysci okno kolejki (licznik monotoniczny zostaje)');
END $$;

-- Termin poswiadczenia: najpozniej 7 dni po koncu wydarzenia.
DO $$
DECLARE v jsonb; v_limit timestamptz;
BEGIN
  PERFORM pg_temp.act_as('54a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  v_limit := now() + interval '1 day' + interval '1 day' + interval '7 days';

  PERFORM pg_temp.assert_raises_like($q$
    SELECT public.admin_event_scanner_device_issue(jsonb_build_object(
      'event_id', '54e00000-0000-0000-0000-0000000000a1', 'label', 'Za dlugo',
      'expires_at', now() + interval '30 days'))
  $q$, 'expiry_too_late', '54/OPS-12: termin poswiadczenia ponad koniec wydarzenia + 7 dni odrzucony');

  v := public.admin_event_scanner_device_issue(jsonb_build_object(
    'event_id', '54e00000-0000-0000-0000-0000000000a1', 'label', 'W granicy',
    'expires_at', now() + interval '5 days'));
  PERFORM pg_temp.assert((v->>'expires_at')::timestamptz = now() + interval '5 days'
      AND (v->>'expires_at_limit')::timestamptz = v_limit,
    '54/OPS-12: termin w granicy przyjety, odpowiedz podaje granice');

  v := public.admin_event_scanner_device_issue(jsonb_build_object(
    'event_id', '54e00000-0000-0000-0000-0000000000a1', 'label', 'Domyslny'));
  PERFORM pg_temp.assert((v->>'expires_at')::timestamptz <= v_limit
      AND (v->>'expires_at')::timestamptz > now(),
    '54/OPS-12: domyslny termin miesci sie w granicy');

  PERFORM pg_temp.assert_raises_like($q$
    SELECT public.admin_event_scanner_device_issue(jsonb_build_object(
      'event_id', '54e00000-0000-0000-0000-0000000000d1', 'label', 'Stare wydarzenie'))
  $q$, 'expiry_too_late', '54/OPS-12: wydarzenie skonczone ponad tydzien temu nie dostaje poswiadczenia');
END $$;

-- ---------------------------------------------------------------------------
-- SEKCJA 4 (OPS-11): KLUCZE OBCE SET NULL I USUWANIE
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND c.contype = 'f'
      AND c.confdeltype = 'n'
      AND array_length(c.conkey, 1) > 1
      AND pg_get_constraintdef(c.oid) !~ 'SET NULL \('
  ),
  '54/OPS-11: w schemacie nie ma ANI JEDNEGO zlozonego klucza obcego SET NULL bez listy kolumn');
-- Rozszerzenie (20261012111000, R10): klucze obce SET NULL, ktorych zerowana
-- kolumna stoi w CHECK-u (takze jednokolumnowe, np. aktor -> auth.users),
-- pilnuje przejrzany rejestr w 56_scanner_review_fixes.

DO $$
DECLARE v_dev public.event_scanner_devices;
BEGIN
  PERFORM pg_temp.act_as(NULL, NULL);
  -- Lead przez zywe urzadzenie usuwanego sponsora i lead wskazujacy punkt.
  PERFORM public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok54-spdel-live-001', 'code', 'qr54-bolek-0000000001'));
  INSERT INTO public.event_lead_scans
    (tenant_id, event_id, sponsor_id, person_id, registration_id, checkpoint_id, device_id)
  VALUES ('11111111-1111-1111-1111-111111111111', '54e00000-0000-0000-0000-0000000000a1',
          '54500000-0000-0000-0000-0000000000a3', '54700000-0000-0000-0000-000000000003',
          '54300000-0000-0000-0000-000000000003', '54c00000-0000-0000-0000-0000000000a4',
          '54d00000-0000-0000-0000-000000000005');

  PERFORM pg_temp.act_as('54a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');

  -- GOTOWE, GDY: usuniecie punktu z uniewaznionym urzadzeniem.
  PERFORM pg_temp.assert(public.admin_event_checkpoint_delete('54c00000-0000-0000-0000-0000000000a4'),
    '54/OPS-11 GOTOWE: punkt z uniewaznionym urzadzeniem i leadem daje sie usunac');
  SELECT * INTO v_dev FROM public.event_scanner_devices WHERE id = '54d00000-0000-0000-0000-00000000000b';
  PERFORM pg_temp.assert(v_dev.id IS NOT NULL AND v_dev.checkpoint_id IS NULL
      AND v_dev.tenant_id = '11111111-1111-1111-1111-111111111111'
      AND v_dev.event_id = '54e00000-0000-0000-0000-0000000000a1',
    '54/OPS-11: urzadzenie zostaje (historia), traci TYLKO wskazanie punktu - najemca i wydarzenie nietkniete');
  PERFORM pg_temp.assert(
    (SELECT checkpoint_id IS NULL AND sponsor_id = '54500000-0000-0000-0000-0000000000a3'
       FROM public.event_lead_scans WHERE person_id = '54700000-0000-0000-0000-000000000003'),
    '54/OPS-11: lead traci tylko wskazanie punktu');

  -- Siatka bezpieczenstwa: zywe urzadzenie przypiete do punktu usunietego
  -- inna sciezka zostaje uniewaznione, nie poszerzone na cale wydarzenie.
  DELETE FROM public.event_checkpoints WHERE id = '54c00000-0000-0000-0000-0000000000a5';
  SELECT * INTO v_dev FROM public.event_scanner_devices WHERE id = '54d00000-0000-0000-0000-00000000000c';
  PERFORM pg_temp.assert(v_dev.checkpoint_id IS NULL AND v_dev.revoked_at IS NOT NULL
      AND NOT v_dev.is_active,
    '54/OPS-11: zywe urzadzenie, ktore stracilo przypiety punkt, jest uniewaznione (nie obsluguje wszystkich punktow)');

  -- GOTOWE, GDY: usuniecie sponsora z uniewaznionym urzadzeniem.
  PERFORM pg_temp.assert(public.admin_event_sponsor_delete('54500000-0000-0000-0000-0000000000a1'),
    '54/OPS-11 GOTOWE: sponsor z uniewaznionym i zywym urzadzeniem daje sie usunac');
  SELECT * INTO v_dev FROM public.event_scanner_devices WHERE id = '54d00000-0000-0000-0000-00000000000a';
  PERFORM pg_temp.assert(v_dev.sponsor_id IS NULL AND v_dev.revoked_at IS NOT NULL
      AND v_dev.revoked_by = '54a00000-0000-0000-0000-0000000000a1'
      AND NOT v_dev.is_active AND v_dev.scopes = ARRAY['lead']::text[]
      AND v_dev.tenant_id = '11111111-1111-1111-1111-111111111111',
    '54/OPS-11: zywe urzadzenie sponsora uniewaznione PRZED usunieciem (z aktorem), zakres zostaje jako historia');
  PERFORM pg_temp.assert(
    (SELECT sponsor_id IS NULL FROM public.event_scanner_devices WHERE id = '54d00000-0000-0000-0000-000000000009')
    AND NOT EXISTS (SELECT 1 FROM public.event_lead_scans WHERE sponsor_id = '54500000-0000-0000-0000-0000000000a1')
    AND EXISTS (SELECT 1 FROM public.domain_events
                 WHERE event_type = 'event_scanner_device.revoked.v1'
                   AND aggregate_id = '54d00000-0000-0000-0000-00000000000a'
                   AND payload->>'reason' = 'sponsor_deleted'),
    '54/OPS-11: uniewaznione urzadzenie traci sponsora, leady sponsora odchodza kaskada, jest zdarzenie revoked.v1');

  PERFORM pg_temp.assert_raises_like($q$
    SELECT public.admin_event_sponsor_delete('54500000-0000-0000-0000-0000000000a2')
  $q$, 'sponsor_has_checkpoints', '54/OPS-11: stanowisko firmy blokuje usuniecie sponsora czytelnym kodem');

  -- Sala z punktem kontrolnym: SET NULL (room_id) dziala.
  PERFORM public.admin_event_room_delete('54b00000-0000-0000-0000-0000000000a1');
  PERFORM pg_temp.assert(
    (SELECT room_id IS NULL AND tenant_id = '11111111-1111-1111-1111-111111111111'
       FROM public.event_checkpoints WHERE id = '54c00000-0000-0000-0000-0000000000a2'),
    '54/OPS-11: usuniecie sali zdejmuje tylko wskazanie sali z punktu');
END $$;

SELECT pg_temp.act_as(NULL, NULL);
SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok54-spdel-live-001', 'code', 'qr54-cezary-000000001'))
$q$, 'device_revoked', '54/OPS-11: poswiadczenie usunietego sponsora nie zbiera juz leadow');

-- Miejsce z pakietu wraca do puli, gdy zapis znika (np. usuniecie osoby RODO).
DO $$
BEGIN
  INSERT INTO public.event_ticket_types (id, tenant_id, event_id, key, name_pl, name_en) VALUES
    ('54600000-0000-0000-0000-0000000000f1', '11111111-1111-1111-1111-111111111111',
     '54e00000-0000-0000-0000-0000000000a1', 'bilet_54', 'Bilet', 'Ticket');
  INSERT INTO public.event_ticket_packages (id, tenant_id, event_id, ticket_type_id, key, name_pl, name_en, seats) VALUES
    ('54600000-0000-0000-0000-0000000000f2', '11111111-1111-1111-1111-111111111111',
     '54e00000-0000-0000-0000-0000000000a1', '54600000-0000-0000-0000-0000000000f1',
     'pakiet_54', 'Pakiet', 'Package', 5);
  INSERT INTO public.event_package_orders (id, tenant_id, event_id, package_id, buyer_email, seats_total) VALUES
    ('54600000-0000-0000-0000-0000000000f3', '11111111-1111-1111-1111-111111111111',
     '54e00000-0000-0000-0000-0000000000a1', '54600000-0000-0000-0000-0000000000f2',
     'kupiec54@example.org', 5);
  INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, status, registration_mode) VALUES
    ('54300000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111',
     '54e00000-0000-0000-0000-0000000000a1', '54700000-0000-0000-0000-00000000000b', 'approved', 'rsvp');
  INSERT INTO public.event_package_seats (id, tenant_id, event_id, package_order_id, registration_id, assigned_at) VALUES
    ('54600000-0000-0000-0000-0000000000f4', '11111111-1111-1111-1111-111111111111',
     '54e00000-0000-0000-0000-0000000000a1', '54600000-0000-0000-0000-0000000000f3',
     '54300000-0000-0000-0000-00000000000b', now());

  DELETE FROM public.event_people WHERE id = '54700000-0000-0000-0000-00000000000b';

  PERFORM pg_temp.assert(
    (SELECT registration_id IS NULL AND assigned_at IS NULL AND tenant_id IS NOT NULL
       FROM public.event_package_seats WHERE id = '54600000-0000-0000-0000-0000000000f4')
    AND (SELECT seats_assigned = 0 FROM public.event_package_orders
          WHERE id = '54600000-0000-0000-0000-0000000000f3'),
    '54/OPS-11: usuniecie osoby zwalnia miejsce z pakietu (SET NULL (registration_id) + stempel)');
END $$;

-- Kaskada usuniecia WYDARZENIA ze stanowiskiem, sponsorem i urzadzeniem.
DO $$
BEGIN
  DELETE FROM public.events WHERE id = '54e00000-0000-0000-0000-0000000000e1';
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.event_sponsors WHERE event_id = '54e00000-0000-0000-0000-0000000000e1')
    AND NOT EXISTS (SELECT 1 FROM public.event_checkpoints WHERE event_id = '54e00000-0000-0000-0000-0000000000e1')
    AND NOT EXISTS (SELECT 1 FROM public.event_scanner_devices WHERE event_id = '54e00000-0000-0000-0000-0000000000e1'),
    '54/OPS-11: usuniecie wydarzenia ze stanowiskiem i urzadzeniem stoiska przechodzi kaskada');
END $$;

-- ---------------------------------------------------------------------------
-- SEKCJA 5 (OPS-01): ZGODA PARTNERSKA PER ZGLOSZENIE W SKANIE LEADU
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.act_as(NULL, NULL);

  -- Celina: zgoda przy A (stempel osoby + zgloszenie A), BEZ zgody przy B.
  UPDATE public.event_people SET consent_partner_sharing_at = now() - interval '2 days'
   WHERE id = '54700000-0000-0000-0000-000000000007';
  UPDATE public.event_registrations SET consent_partner_sharing_at = now() - interval '2 days'
   WHERE id = '54300000-0000-0000-0000-000000000007';

  v := public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok54-lead-b-0000001', 'code', 'qr54-celina-b-0000001'));
  PERFORM pg_temp.assert(v->>'outcome' = 'saved' AND NOT (v->>'consent')::boolean
      AND v->'person' = 'null'::jsonb
      AND position('celina.zgoda@example.org' IN v::text) = 0
      AND (SELECT consent_snapshot_at IS NULL FROM public.event_lead_scans
            WHERE id = (v->>'lead_id')::uuid),
    '54/OPS-01 GOTOWE: zgoda u A -> brak zgody u B -> skan stoiska u B: person = NULL');

  v := public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok54-lead-a-0000001', 'code', 'qr54-celina-a-0000001'));
  PERFORM pg_temp.assert(v->>'outcome' = 'saved' AND (v->>'consent')::boolean
      AND v->'person'->>'email' = 'celina.zgoda@example.org'
      AND v->'person'->>'phone' = '+48540000007',
    '54/OPS-01 GOTOWE: skan ze zgoda na TO wydarzenie nadal oddaje dane osoby');

  -- Dorota: zgoda u A, wycofanie, zapis na C bez zgody (stary event_register
  -- zerowal globalne wycofanie przy kazdym zapisie).
  UPDATE public.event_people SET consent_partner_sharing_at = now() - interval '3 days'
   WHERE id = '54700000-0000-0000-0000-000000000008';
  UPDATE public.event_registrations
     SET consent_partner_sharing_at = now() - interval '3 days',
         consent_partner_withdrawn_at = now() - interval '2 days'
   WHERE id = '54300000-0000-0000-0000-000000000008';
  UPDATE public.event_people SET consent_withdrawn_at = NULL
   WHERE id = '54700000-0000-0000-0000-000000000008';
  INSERT INTO public.event_registrations
    (id, tenant_id, event_id, person_id, status, registration_mode, qr_token_hash, qr_issued_at)
  VALUES
    ('54300000-0000-0000-0000-000000000018', '11111111-1111-1111-1111-111111111111',
     '54e00000-0000-0000-0000-0000000000c1', '54700000-0000-0000-0000-000000000008',
     'approved', 'rsvp', encode(extensions.digest('qr54-dorota-c-0000001', 'sha256'), 'hex'), now());

  v := public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok54-lead-c-0000001', 'code', 'qr54-dorota-c-0000001'));
  PERFORM pg_temp.assert(v->>'outcome' = 'saved' AND NOT (v->>'consent')::boolean
      AND v->'person' = 'null'::jsonb
      AND position('dorota.wyc@example.org' IN v::text) = 0,
    '54/OPS-01 GOTOWE: zgoda u A, wycofanie, zapis na C bez zgody, skan u C: person = NULL');

  -- I skan u A tez juz nie oddaje danych: zgode wycofano.
  v := public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok54-lead-a-0000001', 'code', 'qr54-dorota-a-0000001'));
  PERFORM pg_temp.assert(NOT (v->>'consent')::boolean AND v->'person' = 'null'::jsonb,
    '54/OPS-01: wycofana zgoda w zgloszeniu A nie wraca po zapisie na inne wydarzenie');
END $$;

\echo '== 54 utwardzenie skanera: koniec =='

ROLLBACK;
