-- ============================================================================
-- 60_meetings - GIELDA SPOTKAN: SIATKA SLOTOW, OKNA DOSTEPNOSCI
--               I TRZY OGRANICZENIA WYLACZNOSCI
--
-- PO CO TEN PLIK ISTNIEJE
-- Migracja 20260823190000_event_meetings.sql byla odtwarzana przez harness bez
-- ani jednej asercji zachowania. Podmodul stoi na TRZECH OGRANICZENIACH EXCLUDE,
-- ktorych nie da sie potwierdzic czytaniem SQL-a jako tekstu:
--   (A) `event_meetings_table_no_overlap` - jedno MIEJSCE PRZY STOLIKU nie
--       obsluguje dwoch zajetych spotkan w tym samym czasie;
--   (B) `event_meeting_attendees_no_overlap` - jeden CZLOWIEK nie ma dwoch
--       zajetych spotkan w tym samym czasie (nosnikiem jest projekcja
--       utrzymywana triggerem, bo na samym spotkaniu tego nie da sie wyrazic);
--   (C) `event_meeting_availability_no_overlap` - okna dostepnosci jednego
--       uczestnika sa rozlaczne, TAKZE zamkniete z otwartymi.
-- Do tego dochodzi walidacja terminu: slot musi lezec W SIATCE liczonej
-- z konfiguracji gieldy, a nie byc dowolnym przedzialem, i musi miescic sie
-- w otwartym oknie OBU stron.
--
-- DLACZEGO ASERCJE IDA GOLYM INSERT-em, A NIE PRZEZ RPC
-- Ograniczenia z tego pliku sa OSTATNIA bramka - RPC gieldy odsiewa kolizje
-- wczesniej i wlasnie dlatego nie da sie ich przez RPC wywolac. Test, ktory
-- dotyka tylko RPC, potwierdza uprzejmosc interfejsu, a nie gwarancje bazy:
-- w dniu, w ktorym ktos doda druga sciezke zapisu (import, panel, zadanie
-- w tle), zostana wylacznie te ograniczenia.
--
-- CZEGO TEN PLIK NIE SPRAWDZA
--   * nie sprawdza czterech regul widocznosci gieldy (`_event_meeting_can_invite`)
--     ani limitow zaproszen - te maja swoja bramke w warstwie RPC;
--   * nie sprawdza wspolbieznosci (dwie sesje serwera) - kolizja jest tu
--     wymuszana sekwencyjnie;
--   * nie sprawdza obslugi na miejscu (50_) ani zapisow (20_).
--
-- SPRZATANIE. Caly plik pracuje w JEDNEJ transakcji zakonczonej ROLLBACK-iem.
-- ============================================================================

\echo '== 60 spotkania: siatka slotow, okna dostepnosci, wylacznosc miejsca =='

BEGIN;

-- ---------------------------------------------------------------------------
-- SEKCJA 1: SCENOGRAFIA
--
-- Jedno wydarzenie najemcy A, gielda w strefie UTC (strefa stala, zeby siatka
-- byla policzalna w tescie bez zaleznosci od czasu letniego), slot 30 minut bez
-- przerwy, dzien 09:00-17:00. Jeden stolik o DWOCH miejscach - pojemnosc wieksza
-- niz jeden jest tu konieczna, bo inaczej nie da sie odroznic "zajete miejsce"
-- od "zajety stolik". Trzech uczestnikow z pelnodniowymi oknami dostepnosci.
--
-- Drugi najemca istnieje wylacznie po to, zeby asercja o izolacji miala czego
-- NIE MOC wskazac.
-- ---------------------------------------------------------------------------
INSERT INTO public.tenants (id, name, slug)
VALUES ('60bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Tenant B (spotkania)', 'tb-meet')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('60a11111-0000-0000-0000-000000000001', 'meet.admin@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role) VALUES
  ('60a11111-0000-0000-0000-000000000001', 'admin')
ON CONFLICT DO NOTHING;

INSERT INTO public.profiles (id, tenant_id) VALUES
  ('60a11111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, status,
   registration_mode, registration_flow)
VALUES
  ('60e00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'meet-a', 'Gielda spotkan', 'Meeting exchange',
   now() + interval '3 days', 'published', 'rsvp', 'instant'),
  ('60e00000-0000-0000-0000-0000000000b1', '60bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'meet-b', 'Gielda najemcy B', 'Exchange B',
   now() + interval '3 days', 'published', 'rsvp', 'instant')
ON CONFLICT (id) DO NOTHING;

-- Dzien gieldy i siatka slotow. Trzymamy je w tabeli tymczasowej, bo asercje
-- odmowy sklejaja SQL tekstowo i musza wstawiac gotowa chwile, a nie wyrazenie.
CREATE TEMP TABLE meet_q (k text PRIMARY KEY, ts timestamptz) ON COMMIT DROP;

INSERT INTO public.event_meeting_settings
  (tenant_id, event_id, is_enabled, slot_minutes, break_minutes,
   day_start_time, day_end_time, meeting_days, timezone)
VALUES ('11111111-1111-1111-1111-111111111111',
        '60e00000-0000-0000-0000-0000000000a1', true, 30, 0,
        '09:00', '17:00', ARRAY[(current_date + 3)]::date[], 'UTC');

INSERT INTO meet_q (k, ts)
SELECT 'slot1_start', ((current_date + 3) + time '09:00') AT TIME ZONE 'UTC'
UNION ALL SELECT 'slot1_end', ((current_date + 3) + time '09:30') AT TIME ZONE 'UTC'
UNION ALL SELECT 'slot2_start', ((current_date + 3) + time '10:00') AT TIME ZONE 'UTC'
UNION ALL SELECT 'slot2_end', ((current_date + 3) + time '10:30') AT TIME ZONE 'UTC'
UNION ALL SELECT 'slot3_start', ((current_date + 3) + time '11:00') AT TIME ZONE 'UTC'
UNION ALL SELECT 'slot3_end', ((current_date + 3) + time '11:30') AT TIME ZONE 'UTC'
UNION ALL SELECT 'off_grid_start', ((current_date + 3) + time '09:07') AT TIME ZONE 'UTC'
UNION ALL SELECT 'off_grid_end', ((current_date + 3) + time '09:37') AT TIME ZONE 'UTC'
UNION ALL SELECT 'late_start', ((current_date + 3) + time '16:00') AT TIME ZONE 'UTC'
UNION ALL SELECT 'late_end', ((current_date + 3) + time '16:30') AT TIME ZONE 'UTC'
UNION ALL SELECT 'window_start', ((current_date + 3) + time '09:00') AT TIME ZONE 'UTC'
UNION ALL SELECT 'window_end', ((current_date + 3) + time '13:00') AT TIME ZONE 'UTC';

INSERT INTO public.event_meeting_tables
  (id, tenant_id, event_id, label, capacity, is_active)
VALUES
  ('60700000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '60e00000-0000-0000-0000-0000000000a1', 'Stolik 1', 2, true),
  ('60700000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   '60e00000-0000-0000-0000-0000000000a1', 'Stolik 2', 2, true),
  ('60700000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111',
   '60e00000-0000-0000-0000-0000000000a1', 'Stolik wylaczony', 1, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_people (id, tenant_id, first_name, last_name, email, source) VALUES
  ('60800000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'Jan', 'Pierwszy', 'jan.pierwszy@example.org', 'organizer'),
  ('60800000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   'Ewa', 'Druga', 'ewa.druga@example.org', 'organizer'),
  ('60800000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111',
   'Olga', 'Trzecia', 'olga.trzecia@example.org', 'organizer'),
  ('60800000-0000-0000-0000-0000000000b1', '60bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'Obcy', 'Najemca', 'obcy@example.org', 'organizer')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, status, registration_mode)
VALUES
  ('60900000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '60e00000-0000-0000-0000-0000000000a1', '60800000-0000-0000-0000-0000000000a1',
   'approved', 'rsvp'),
  ('60900000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   '60e00000-0000-0000-0000-0000000000a1', '60800000-0000-0000-0000-0000000000a2',
   'approved', 'rsvp'),
  ('60900000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111',
   '60e00000-0000-0000-0000-0000000000a1', '60800000-0000-0000-0000-0000000000a3',
   'approved', 'rsvp'),
  ('60900000-0000-0000-0000-0000000000b1', '60bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '60e00000-0000-0000-0000-0000000000b1', '60800000-0000-0000-0000-0000000000b1',
   'approved', 'rsvp')
ON CONFLICT (id) DO NOTHING;

-- Okna dostepnosci 09:00-13:00 dla calej trojki.
INSERT INTO public.event_meeting_availability
  (tenant_id, event_id, registration_id, starts_at, ends_at, is_open)
SELECT '11111111-1111-1111-1111-111111111111',
       '60e00000-0000-0000-0000-0000000000a1',
       r.id,
       (SELECT ts FROM meet_q WHERE k = 'window_start'),
       (SELECT ts FROM meet_q WHERE k = 'window_end'),
       true
FROM (VALUES ('60900000-0000-0000-0000-0000000000a1'::uuid),
             ('60900000-0000-0000-0000-0000000000a2'::uuid),
             ('60900000-0000-0000-0000-0000000000a3'::uuid)) AS r(id);

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_meeting_availability
    WHERE event_id = '60e00000-0000-0000-0000-0000000000a1') = 3,
  '60/scenografia: trzy okna dostepnosci, po jednym na uczestnika');

-- ---------------------------------------------------------------------------
-- SEKCJA 2: OKNA DOSTEPNOSCI SA ROZLACZNE (ograniczenie C)
--
-- Dwa nakladajace sie okna daja DWIE SPRZECZNE odpowiedzi na pytanie "czy
-- o 11:00 przyjmujesz zaproszenia", a lista wolnych terminow musialaby zgadywac.
-- Ograniczenie jest BEZWARUNKOWE, wiec okno ZAMKNIETE tez koliduje z otwartym -
-- i to jest osobna asercja, bo to najlatwiejsza regula do zgubienia przy
-- dopisywaniu klauzuli WHERE.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_start timestamptz := (SELECT ts FROM meet_q WHERE k = 'window_start');
  v_end   timestamptz := (SELECT ts FROM meet_q WHERE k = 'window_end');
BEGIN
  PERFORM pg_temp.assert_raises_like(format($q$
    INSERT INTO public.event_meeting_availability
      (tenant_id, event_id, registration_id, starts_at, ends_at, is_open)
    VALUES ('11111111-1111-1111-1111-111111111111',
            '60e00000-0000-0000-0000-0000000000a1',
            '60900000-0000-0000-0000-0000000000a1', %L, %L, true)
  $q$, v_start + interval '1 hour', v_end + interval '1 hour'),
    'event_meeting_availability_no_overlap',
    '60/ODMOWA: drugie NAKLADAJACE SIE okno dostepnosci tej samej osoby');

  PERFORM pg_temp.assert_raises_like(format($q$
    INSERT INTO public.event_meeting_availability
      (tenant_id, event_id, registration_id, starts_at, ends_at, is_open)
    VALUES ('11111111-1111-1111-1111-111111111111',
            '60e00000-0000-0000-0000-0000000000a1',
            '60900000-0000-0000-0000-0000000000a1', %L, %L, false)
  $q$, v_start + interval '2 hours', v_end),
    'event_meeting_availability_no_overlap',
    '60/ODMOWA: okno ZAMKNIETE tez koliduje z otwartym (ograniczenie bezwarunkowe)');

  -- KONTRAPUNKT: okno rozlaczne przechodzi - inaczej asercja wyzej nie odroznia
  -- ograniczenia od blokady zapisu.
  INSERT INTO public.event_meeting_availability
    (tenant_id, event_id, registration_id, starts_at, ends_at, is_open)
  VALUES ('11111111-1111-1111-1111-111111111111',
          '60e00000-0000-0000-0000-0000000000a1',
          '60900000-0000-0000-0000-0000000000a1',
          v_end, v_end + interval '2 hours', true);

  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_meeting_availability
      WHERE registration_id = '60900000-0000-0000-0000-0000000000a1') = 2,
    '60/KONTRAPUNKT: okno ROZLACZNE tej samej osoby jest przyjmowane');
END $$;

-- ---------------------------------------------------------------------------
-- SEKCJA 3: SLOT MUSI LEZEC W SIATCE I W OKNACH OBU STRON
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_off_s timestamptz := (SELECT ts FROM meet_q WHERE k = 'off_grid_start');
  v_off_e timestamptz := (SELECT ts FROM meet_q WHERE k = 'off_grid_end');
  v_late_s timestamptz := (SELECT ts FROM meet_q WHERE k = 'late_start');
  v_late_e timestamptz := (SELECT ts FROM meet_q WHERE k = 'late_end');
BEGIN
  PERFORM pg_temp.assert_raises_like(format($q$
    INSERT INTO public.event_meetings
      (tenant_id, event_id, requester_registration_id, invitee_registration_id,
       starts_at, ends_at, status, expires_at, responded_at)
    VALUES ('11111111-1111-1111-1111-111111111111',
            '60e00000-0000-0000-0000-0000000000a1',
            '60900000-0000-0000-0000-0000000000a1',
            '60900000-0000-0000-0000-0000000000a2', %L, %L, 'invited', now() + interval '1 day', NULL)
  $q$, v_off_s, v_off_e), 'slot_not_in_grid',
    '60/ODMOWA: termin POZA SIATKA slotow (09:07) jest odrzucany');

  -- Slot 16:00-16:30 JEST w siatce, ale lezy poza oknem dostepnosci (do 13:00
  -- i od 13:00 do 15:00 dla pierwszego uczestnika, drugi nie ma tam nic).
  PERFORM pg_temp.assert_raises_like(format($q$
    INSERT INTO public.event_meetings
      (tenant_id, event_id, requester_registration_id, invitee_registration_id,
       starts_at, ends_at, status, expires_at, responded_at)
    VALUES ('11111111-1111-1111-1111-111111111111',
            '60e00000-0000-0000-0000-0000000000a1',
            '60900000-0000-0000-0000-0000000000a1',
            '60900000-0000-0000-0000-0000000000a2', %L, %L, 'invited', now() + interval '1 day', NULL)
  $q$, v_late_s, v_late_e), 'unavailable',
    '60/ODMOWA: slot w siatce, ale POZA OKNEM dostepnosci strony');
END $$;

-- ---------------------------------------------------------------------------
-- SEKCJA 4: WYLACZNOSC MIEJSCA PRZY STOLIKU (ograniczenie A)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_s timestamptz := (SELECT ts FROM meet_q WHERE k = 'slot1_start');
  v_e timestamptz := (SELECT ts FROM meet_q WHERE k = 'slot1_end');
BEGIN
  INSERT INTO public.event_meetings
    (id, tenant_id, event_id, requester_registration_id, invitee_registration_id,
     starts_at, ends_at, table_id, table_seat, status, expires_at, responded_at)
  VALUES ('60100000-0000-0000-0000-000000000001',
          '11111111-1111-1111-1111-111111111111',
          '60e00000-0000-0000-0000-0000000000a1',
          '60900000-0000-0000-0000-0000000000a1',
          '60900000-0000-0000-0000-0000000000a2',
          v_s, v_e, '60700000-0000-0000-0000-0000000000a1', 1,
          'accepted', now() + interval '1 day', now());

  PERFORM pg_temp.assert(true,
    '60/spotkanie: przyjete spotkanie na miejscu 1 stolika 1 zostalo zapisane');

  -- TO SAMO MIEJSCE, TEN SAM SLOT, inna para -> ograniczenie A.
  PERFORM pg_temp.assert_raises_like(format($q$
    INSERT INTO public.event_meetings
      (tenant_id, event_id, requester_registration_id, invitee_registration_id,
       starts_at, ends_at, table_id, table_seat, status, expires_at, responded_at)
    VALUES ('11111111-1111-1111-1111-111111111111',
            '60e00000-0000-0000-0000-0000000000a1',
            '60900000-0000-0000-0000-0000000000a3',
            '60900000-0000-0000-0000-0000000000a2', %L, %L,
            '60700000-0000-0000-0000-0000000000a1', 1, 'accepted', now() + interval '1 day', now())
  $q$, v_s, v_e), 'event_meetings_table_no_overlap',
    '60/ODMOWA: dwa spotkania na JEDNYM MIEJSCU przy stoliku w tym samym oknie');

  -- DRUGIE MIEJSCE tego samego stolika jest wolne - pojemnosc 2.
  INSERT INTO public.event_meetings
    (id, tenant_id, event_id, requester_registration_id, invitee_registration_id,
     starts_at, ends_at, table_id, table_seat, status, expires_at, responded_at)
  VALUES ('60100000-0000-0000-0000-000000000002',
          '11111111-1111-1111-1111-111111111111',
          '60e00000-0000-0000-0000-0000000000a1',
          '60900000-0000-0000-0000-0000000000a3',
          '60900000-0000-0000-0000-0000000000a2',
          v_s, v_e, '60700000-0000-0000-0000-0000000000a1', 2,
          'invited', now() + interval '1 day', NULL);

  PERFORM pg_temp.assert(true,
    '60/KONTRAPUNKT: drugie MIEJSCE tego samego stolika w tym slocie jest wolne');

  -- Numer miejsca poza pojemnoscia stolika.
  PERFORM pg_temp.assert_raises_like(format($q$
    INSERT INTO public.event_meetings
      (tenant_id, event_id, requester_registration_id, invitee_registration_id,
       starts_at, ends_at, table_id, table_seat, status, expires_at, responded_at)
    VALUES ('11111111-1111-1111-1111-111111111111',
            '60e00000-0000-0000-0000-0000000000a1',
            '60900000-0000-0000-0000-0000000000a3',
            '60900000-0000-0000-0000-0000000000a1', %L, %L,
            '60700000-0000-0000-0000-0000000000a1', 3, 'invited', now() + interval '1 day', NULL)
  $q$, v_s, v_e), 'table_seat_out_of_range',
    '60/ODMOWA: numer miejsca wiekszy niz pojemnosc stolika');

  -- Stolik WYLACZONY nie przyjmuje nowych spotkan.
  PERFORM pg_temp.assert_raises_like(format($q$
    INSERT INTO public.event_meetings
      (tenant_id, event_id, requester_registration_id, invitee_registration_id,
       starts_at, ends_at, table_id, table_seat, status, expires_at, responded_at)
    VALUES ('11111111-1111-1111-1111-111111111111',
            '60e00000-0000-0000-0000-0000000000a1',
            '60900000-0000-0000-0000-0000000000a3',
            '60900000-0000-0000-0000-0000000000a1', %L, %L,
            '60700000-0000-0000-0000-0000000000a3', 1, 'invited', now() + interval '1 day', NULL)
  $q$, v_s, v_e), 'table_inactive',
    '60/ODMOWA: stolik wylaczony nie przyjmuje nowych spotkan');
END $$;

-- STAN NIEZAJETY nie rezerwuje miejsca. Ograniczenie jest CZESCIOWE po statusie:
-- zaproszenie bez odpowiedzi trzyma slot w interfejsie, nie w bazie.
DO $$
DECLARE
  v_s timestamptz := (SELECT ts FROM meet_q WHERE k = 'slot2_start');
  v_e timestamptz := (SELECT ts FROM meet_q WHERE k = 'slot2_end');
BEGIN
  INSERT INTO public.event_meetings
    (id, tenant_id, event_id, requester_registration_id, invitee_registration_id,
     starts_at, ends_at, table_id, table_seat, status, expires_at, responded_at)
  VALUES ('60100000-0000-0000-0000-000000000003',
          '11111111-1111-1111-1111-111111111111',
          '60e00000-0000-0000-0000-0000000000a1',
          '60900000-0000-0000-0000-0000000000a1',
          '60900000-0000-0000-0000-0000000000a2',
          v_s, v_e, '60700000-0000-0000-0000-0000000000a2', 1,
          'invited', now() + interval '1 day', NULL);

  INSERT INTO public.event_meetings
    (id, tenant_id, event_id, requester_registration_id, invitee_registration_id,
     starts_at, ends_at, table_id, table_seat, status, expires_at, responded_at)
  VALUES ('60100000-0000-0000-0000-000000000004',
          '11111111-1111-1111-1111-111111111111',
          '60e00000-0000-0000-0000-0000000000a1',
          '60900000-0000-0000-0000-0000000000a3',
          '60900000-0000-0000-0000-0000000000a1',
          v_s, v_e, '60700000-0000-0000-0000-0000000000a2', 1,
          'invited', now() + interval '1 day', NULL);

  PERFORM pg_temp.assert(true,
    '60/wylacznosc: dwa ZAPROSZENIA bez odpowiedzi moga dzielic to samo miejsce');

  -- ...ale przyjecie DRUGIEGO z nich juz nie przejdzie.
  UPDATE public.event_meetings SET status = 'accepted', responded_at = now()
   WHERE id = '60100000-0000-0000-0000-000000000003';

  PERFORM pg_temp.assert_raises_like($q$
    UPDATE public.event_meetings SET status = 'accepted', responded_at = now()
     WHERE id = '60100000-0000-0000-0000-000000000004'
  $q$, 'no_overlap',
    '60/ODMOWA: przyjecie DRUGIEGO zaproszenia na to samo miejsce jest odrzucane');
END $$;

-- ---------------------------------------------------------------------------
-- SEKCJA 5: JEDEN CZLOWIEK, JEDNO SPOTKANIE W DANEJ CHWILI (ograniczenie B)
--
-- Nosnikiem jest projekcja `event_meeting_attendees` utrzymywana triggerem.
-- Najpierw sprawdzamy, ze projekcja W OGOLE POWSTAJE - bez niej ograniczenie
-- nie ma na czym stac, a zaden blad tekstowy tego nie pokaze.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_meeting_attendees
    WHERE meeting_id = '60100000-0000-0000-0000-000000000001') = 2,
  '60/projekcja: przyjete spotkanie ma DWA wiersze uczestnictwa (obie strony)');

SELECT pg_temp.assert(
  (SELECT bool_and(status = 'accepted') FROM public.event_meeting_attendees
    WHERE meeting_id = '60100000-0000-0000-0000-000000000001'),
  '60/projekcja: stan spotkania jest skopiowany do obu wierszy uczestnictwa');

DO $$
DECLARE
  v_s timestamptz := (SELECT ts FROM meet_q WHERE k = 'slot1_start');
  v_e timestamptz := (SELECT ts FROM meet_q WHERE k = 'slot1_end');
BEGIN
  -- Uczestnik 1 ma juz PRZYJETE spotkanie w slocie 1 (stolik 1, miejsce 1).
  -- Drugie przyjete spotkanie tej samej osoby w tym samym czasie - przy INNYM
  -- stoliku, wiec ograniczenie A nie zadziala - odbija sie od projekcji.
  PERFORM pg_temp.assert_raises_like(format($q$
    INSERT INTO public.event_meetings
      (tenant_id, event_id, requester_registration_id, invitee_registration_id,
       starts_at, ends_at, table_id, table_seat, status, expires_at, responded_at)
    VALUES ('11111111-1111-1111-1111-111111111111',
            '60e00000-0000-0000-0000-0000000000a1',
            '60900000-0000-0000-0000-0000000000a1',
            '60900000-0000-0000-0000-0000000000a3', %L, %L,
            '60700000-0000-0000-0000-0000000000a2', 2, 'accepted', now() + interval '1 day', now())
  $q$, v_s, v_e), 'event_meeting_attendees_no_overlap',
    '60/ODMOWA: jedna osoba na DWOCH przyjetych spotkaniach w tym samym oknie');

  -- KONTRAPUNKT: ta sama para w INNYM slocie przechodzi.
  INSERT INTO public.event_meetings
    (id, tenant_id, event_id, requester_registration_id, invitee_registration_id,
     starts_at, ends_at, status, expires_at, responded_at)
  VALUES ('60100000-0000-0000-0000-000000000005',
          '11111111-1111-1111-1111-111111111111',
          '60e00000-0000-0000-0000-0000000000a1',
          '60900000-0000-0000-0000-0000000000a1',
          '60900000-0000-0000-0000-0000000000a3',
          (SELECT ts FROM meet_q WHERE k = 'slot3_start'),
          (SELECT ts FROM meet_q WHERE k = 'slot3_end'),
          'accepted', now() + interval '1 day', now());

  PERFORM pg_temp.assert(true,
    '60/KONTRAPUNKT: ta sama osoba w INNYM slocie umawia sie bez przeszkod');
END $$;

-- ODWOLANIE ZWALNIA TERMIN. Bez tej asercji nie wiadomo, czy ograniczenie
-- czesciowe czyta stan BIEZACY, czy zamraza pierwszy zapis.
DO $$
DECLARE
  v_s timestamptz := (SELECT ts FROM meet_q WHERE k = 'slot1_start');
  v_e timestamptz := (SELECT ts FROM meet_q WHERE k = 'slot1_end');
BEGIN
  UPDATE public.event_meetings
     SET status = 'cancelled', cancelled_at = now(), cancelled_side = 'requester'
   WHERE id = '60100000-0000-0000-0000-000000000001';

  PERFORM pg_temp.assert(
    (SELECT bool_and(status = 'cancelled') FROM public.event_meeting_attendees
      WHERE meeting_id = '60100000-0000-0000-0000-000000000001'),
    '60/projekcja: odwolanie spotkania przepisuje stan do obu wierszy uczestnictwa');

  INSERT INTO public.event_meetings
    (id, tenant_id, event_id, requester_registration_id, invitee_registration_id,
     starts_at, ends_at, table_id, table_seat, status, expires_at, responded_at)
  VALUES ('60100000-0000-0000-0000-000000000006',
          '11111111-1111-1111-1111-111111111111',
          '60e00000-0000-0000-0000-0000000000a1',
          '60900000-0000-0000-0000-0000000000a3',
          '60900000-0000-0000-0000-0000000000a1',
          v_s, v_e, '60700000-0000-0000-0000-0000000000a1', 1,
          'accepted', now() + interval '1 day', now());

  PERFORM pg_temp.assert(true,
    '60/wylacznosc: ODWOLANE spotkanie zwalnia miejsce i termin dla nastepnego');
END $$;

-- ---------------------------------------------------------------------------
-- SEKCJA 6: TOZSAMOSC SPOTKANIA I IZOLACJA NAJEMCY
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_raises_like($q$
  UPDATE public.event_meetings
     SET invitee_registration_id = '60900000-0000-0000-0000-0000000000a2'
   WHERE id = '60100000-0000-0000-0000-000000000005'
$q$, 'meeting_identity_immutable',
  '60/ODMOWA: przepiecie spotkania na innego czlowieka zaciera slad i jest zabronione');

DO $$
DECLARE
  v_s timestamptz := (SELECT ts FROM meet_q WHERE k = 'slot3_start');
  v_e timestamptz := (SELECT ts FROM meet_q WHERE k = 'slot3_end');
BEGIN
  PERFORM pg_temp.assert_raises_like(format($q$
    INSERT INTO public.event_meetings
      (tenant_id, event_id, requester_registration_id, invitee_registration_id,
       starts_at, ends_at, status, expires_at, responded_at)
    VALUES ('11111111-1111-1111-1111-111111111111',
            '60e00000-0000-0000-0000-0000000000a1',
            '60900000-0000-0000-0000-0000000000a2',
            '60900000-0000-0000-0000-0000000000a2', %L, %L,
            'invited', now() + interval '1 day', NULL)
  $q$, v_s, v_e), 'event_meetings_no_self',
    '60/ODMOWA: spotkanie z samym soba jest odrzucane');
END $$;

DO $$
DECLARE
  v_s timestamptz := (SELECT ts FROM meet_q WHERE k = 'slot2_start');
  v_e timestamptz := (SELECT ts FROM meet_q WHERE k = 'slot2_end');
BEGIN
  PERFORM pg_temp.assert_raises_like(format($q$
    INSERT INTO public.event_meetings
      (tenant_id, event_id, requester_registration_id, invitee_registration_id,
       starts_at, ends_at, status, expires_at, responded_at)
    VALUES ('11111111-1111-1111-1111-111111111111',
            '60e00000-0000-0000-0000-0000000000a1',
            '60900000-0000-0000-0000-0000000000a2',
            '60900000-0000-0000-0000-0000000000b1', %L, %L, 'invited', now() + interval '1 day', NULL)
  $q$, v_s, v_e), 'fk',
    '60/IZOLACJA: spotkanie najemcy A nie moze wskazac zapisu najemcy B');

  PERFORM pg_temp.assert_raises_like(format($q$
    INSERT INTO public.event_meeting_availability
      (tenant_id, event_id, registration_id, starts_at, ends_at, is_open)
    VALUES ('11111111-1111-1111-1111-111111111111',
            '60e00000-0000-0000-0000-0000000000a1',
            '60900000-0000-0000-0000-0000000000b1', %L, %L, true)
  $q$, v_s, v_e + interval '1 hour'), 'fk',
    '60/IZOLACJA: okno dostepnosci najemcy A nie moze wskazac zapisu najemcy B');
END $$;

-- ---------------------------------------------------------------------------
-- SEKCJA 7: STRUKTURA
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  (SELECT count(*) FROM pg_constraint
    WHERE contype = 'x'
      AND conname IN ('event_meetings_table_no_overlap',
                      'event_meeting_attendees_no_overlap',
                      'event_meeting_availability_no_overlap')) = 3,
  '60/struktura: wszystkie TRZY ograniczenia wylacznosci istnieja w bazie');

SELECT pg_temp.assert(
  (SELECT count(*) FROM pg_index i
     JOIN pg_class c ON c.oid = i.indrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = i.indkey[0]
    WHERE n.nspname = 'public'
      AND c.relname IN ('event_meeting_tables', 'event_meeting_settings',
                        'event_meeting_availability', 'event_meetings',
                        'event_meeting_attendees')
      AND NOT i.indisprimary
      AND a.attname <> 'tenant_id') = 0,
  '60/struktura: kazdy indeks wtorny podmodulu ma tenant_id na pierwszej pozycji');

SELECT pg_temp.act_as(NULL, NULL);

ROLLBACK;

\echo '== 60 spotkania: koniec =='
