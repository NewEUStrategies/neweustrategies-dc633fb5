-- ============================================================================
-- 10_sessions - AGENDA WYDARZENIA: SESJE, SCIEZKI, SALE, PRELEGENCI, ZAPISY
--
-- PO CO TEN PLIK ISTNIEJE
-- Migracja 20260823140000_event_sessions.sql zaklada piec tabel
-- (`event_tracks`, `event_rooms`, `event_sessions`, `event_session_speakers`,
-- `event_session_signups`), DWADZIESCIA funkcji, jeden trigger walidacyjny
-- i jedno ograniczenie EXCLUDE. Bramki tekstowe widza w tym pliku sam SQL;
-- NIE widza tego, co ten SQL ROBI:
--   * czy `EXCLUDE ... gist (tenant_id =, room_id =, time_range &&)` naprawde
--     odrzuca dwie sesje w jednej sali o zachodzacych godzinach, czy jest
--     ozdoba bez klasy operatorow;
--   * czy kolumna generowana `time_range` jest naprawde niezapisywalna i czy
--     jej wartosc zgadza sie z `starts_at`/`ends_at`;
--   * czy trigger `tg_event_sessions_validate` odpala na kazdej sciezce zapisu,
--     czy tylko w formularzu;
--   * czy klucze obce POTROJNE `(tenant_id, event_id, track_id/room_id)`
--     faktycznie odrzucaja sciezke i sale z innego wydarzenia;
--   * czy `event_agenda` oddaje TYLKO sesje opublikowane i TYLKO z najemcy
--     z naglowka - to jedna funkcja stoi miedzy agenda a wyciekiem;
--   * czy limit miejsc jest egzekwowany, czy jest napisem.
--
-- CZEGO TEN PLIK NIE SPRAWDZA
--   * NIE sprawdza wyscigow. Trzy serializacje `event_session_signup`
--     (`FOR UPDATE` na sesji, `pg_advisory_xact_lock` na parze
--     wydarzenie-uczestnik, `UNIQUE (tenant_id, session_id, user_id)`) sa
--     widoczne tylko przy DWOCH rownoleglych sesjach bazodanowych, a caly ten
--     plik biegnie w JEDNEJ transakcji. Sprawdzamy SKUTEK regul (limit, lista
--     rezerwowa, kolizja czasowa), nie ich odpornosc na rownoleglosc.
--   * NIE sprawdza rejestru uczestnikow (`event_people`, `event_registrations`
--     z 20260823150000), sponsorow, frontu, odprawy ani spotkan - to zakres
--     plikow 20_ .. 60_.
--   * NIE sprawdza wydajnosci ani planow zapytan - baza jest pusta, wiec
--     indeksy sa tu tylko schematem.
--   * NIE sprawdza zachowania warstw czlonkowskich. `has_tier_rank()` jest
--     w harnessie atrapa czytajaca GUC, wiec sprawdzamy PROG na sesji, a nie
--     to, skad ranga sie bierze.
--   * NIE sprawdza tresci powiadomien - modul emituje zdarzenie domenowe
--     i na tym konczy sie jego odpowiedzialnosc; tu liczymy tylko, ze
--     zdarzenie POWSTALO.
--
-- SPRZATANIE. Caly plik pracuje w jednej transakcji zakonczonej ROLLBACK-iem,
-- wiec nie zostawia po sobie ani wiersza (kontrakt kazdego pliku
-- w runtime_test.d).
-- ============================================================================

\echo '== 10 sesje: agenda, kolizje, walidacja, zapisy, izolacja =='

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. ATRAPA PLATFORMOWA, KTOREJ BRAKUJE W harness.sql
--
-- `admin_event_session_signup_set` liczy prog warstwy uczestnika przez
-- `public.user_tier_rank(uuid, uuid)` - funkcje PLATFORMY z 20260713174428,
-- ktorej harness NIE stawia (jej migracja nie nalezy do modulu Wydarzen, wiec
-- selektor po tresci jej nie wciaga). PL/pgSQL przygotowuje wyrazenie `IF`
-- w calosci, wiec bez tej funkcji cala funkcja panelu jest NIEWYWOLYWALNA -
-- takze dla sesji bez progu warstwy (sprawdzone: `function
-- public.user_tier_rank(uuid, uuid) does not exist` przy min_tier_rank = 0).
--
-- To jest LUKA HARNESSU, nie blad migracji: na produkcji funkcja istnieje.
-- Atrapa siedzi TUTAJ, a nie w harness.sql, bo tego pliku nie wolno mi ruszac;
-- powstaje WARUNKOWO (gdy harness dorobi wlasna, uzyta bedzie tamta) i ginie
-- razem z ROLLBACK-iem. Ksztalt: ranga z GUC `nes.tier_rank`, czyli ta sama
-- atrapa co `current_tier_rank()` - dzieki temu prog warstwy da sie przestawic
-- funkcja `act_as` i asercja o progu potrafi byc czerwona w OBIE strony.
-- Gdyby atrapa zwracala stale zero, "prog warstwy obowiazuje organizatora"
-- przechodzilo by zawsze i nie bylo by testem.
-- ---------------------------------------------------------------------------
-- Sprawdzamy DOKLADNA sygnature `(uuid, uuid)`, a nie sama nazwe: funkcja
-- o tej nazwie i innej liczbie parametrow nie zaspokoi wywolania z migracji,
-- a asercja na nazwie przepuscilaby ja jako "jest".
DO $$
BEGIN
  IF to_regprocedure('public.user_tier_rank(uuid, uuid)') IS NULL THEN
    EXECUTE $f$
      CREATE FUNCTION public.user_tier_rank(p_user uuid, p_tenant uuid DEFAULT NULL)
      RETURNS integer LANGUAGE sql STABLE AS $b$
        SELECT COALESCE(NULLIF(current_setting('nes.tier_rank', true), '')::integer, 0)
      $b$
    $f$;
  END IF;
END $$;

SELECT pg_temp.assert(
  to_regprocedure('public.user_tier_rank(uuid, uuid)') IS NOT NULL,
  '10/sesje: user_tier_rank(uuid, uuid) jest dostepny (atrapa platformowa albo prawdziwa funkcja)');

-- ---------------------------------------------------------------------------
-- 1. DANE STARTOWE - DWOCH NAJEMCOW O IDENTYCZNYM KSZTALCIE
--
-- Najemca A to `public_tenant_id()` harnessu (11111111-...). Najemca B dostaje
-- wydarzenie o TYM SAMYM SLUGU, wlasnego redaktora, wlasna sciezke, sale,
-- sesje i prelegenta. Identyczny slug jest tu celowy i jest sercem testu
-- izolacji: `event_agenda('agenda-kongres')` to DOKLADNIE to samo zapytanie
-- dla obu najemcow i musi oddac dwa rozlaczne zbiory wierszy. Gdyby slugi sie
-- roznily, test mierzylby filtr po slugu, a nie granice najemcy.
-- ---------------------------------------------------------------------------
INSERT INTO public.tenants (id, name, slug) VALUES
  ('22222222-2222-2222-2222-222222222222', 'Tenant B', 'tb')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('e0000000-0000-0000-0000-0000000000a1', 'red.a@sesje.test'),
  ('e0000000-0000-0000-0000-0000000000b1', 'red.b@sesje.test'),
  ('e0000000-0000-0000-0000-00000000000e', 'tylko.redaktor@sesje.test'),
  ('c0000000-0000-0000-0000-0000000000a1', 'czlonek1.a@sesje.test'),
  ('c0000000-0000-0000-0000-0000000000a2', 'czlonek2.a@sesje.test'),
  ('c0000000-0000-0000-0000-0000000000a3', 'czlonek3.a@sesje.test'),
  ('50000000-0000-0000-0000-0000000000a1', 'prelegent1.a@sesje.test'),
  ('50000000-0000-0000-0000-0000000000a2', 'prelegent2.a@sesje.test'),
  ('50000000-0000-0000-0000-0000000000b1', 'prelegent1.b@sesje.test');

INSERT INTO public.profiles (id, tenant_id, display_name, slug) VALUES
  ('e0000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Redaktor A', 'red-a'),
  ('e0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'Redaktor B', 'red-b'),
  ('e0000000-0000-0000-0000-00000000000e', '11111111-1111-1111-1111-111111111111', 'Tylko Redaktor', 'tylko-red'),
  ('c0000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Czlonek Jeden', 'czlonek-1'),
  ('c0000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'Czlonek Dwa', 'czlonek-2'),
  ('c0000000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'Czlonek Trzy', 'czlonek-3'),
  ('50000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Prelegent A1', 'prelegent-a1'),
  ('50000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'Prelegent A2', 'prelegent-a2'),
  ('50000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'Prelegent B1', 'prelegent-b1');

INSERT INTO public.user_roles (user_id, role) VALUES
  ('e0000000-0000-0000-0000-0000000000a1', 'admin'),
  ('e0000000-0000-0000-0000-0000000000b1', 'admin'),
  ('e0000000-0000-0000-0000-00000000000e', 'editor');

INSERT INTO public.speaker_profiles (id, tenant_id, user_id, headline_pl, headline_en, is_public) VALUES
  ('59000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '50000000-0000-0000-0000-0000000000a1', 'Dyrektor programu', 'Programme director', true),
  -- Prelegent NIEPUBLICZNY: `event_agenda` filtruje obsade po `is_public`,
  -- wiec bez tego wiersza ten filtr nie mialby czego nie pokazac.
  ('59000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   '50000000-0000-0000-0000-0000000000a2', 'Analityk', 'Analyst', false),
  ('59000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222',
   '50000000-0000-0000-0000-0000000000b1', 'Prelegent B', 'Speaker B', true);

-- Wydarzenia. Okno najemcy A: 2026-09-01 08:00 .. 2026-09-02 20:00 (+02).
INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, status, starts_at, ends_at) VALUES
  ('e5000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'agenda-kongres', 'Kongres A', 'Congress A', 'published',
   '2026-09-01 08:00+02', '2026-09-02 20:00+02'),
  -- Wydarzenie ROBOCZE tego samego najemcy: sesja w nim opublikowana NIE JEST
  -- trescia publiczna (polityka wiaze widocznosc przez rodzica).
  ('e5000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   'agenda-szkic', 'Szkic A', 'Draft A', 'draft',
   '2026-09-01 08:00+02', '2026-09-02 20:00+02'),
  -- Wydarzenie BEZ konca: gorna granica walidacji jest sprawdzana tylko wtedy,
  -- gdy wydarzenie zna swoj koniec (`events.ends_at` jest nullowalne).
  ('e5000000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111',
   'agenda-bez-konca', 'Bez konca', 'Open ended', 'published',
   '2026-09-01 08:00+02', NULL),
  -- Najemca B, TEN SAM SLUG co wydarzenie A.
  ('e5000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222',
   'agenda-kongres', 'Kongres B', 'Congress B', 'published',
   '2026-09-01 08:00+02', '2026-09-02 20:00+02');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.events WHERE slug = 'agenda-kongres') = 2,
  '10/sesje: dwa wydarzenia o tym samym slugu w dwoch najemcach (baza testu izolacji)');

-- ---------------------------------------------------------------------------
-- 2. PANEL: SCIEZKI I SALE
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('e0000000-0000-0000-0000-0000000000a1',
                      '11111111-1111-1111-1111-111111111111');

SELECT pg_temp.assert(
  public.admin_event_track_save(jsonb_build_object(
    'event_id', 'e5000000-0000-0000-0000-0000000000a1',
    'key', 'cyber', 'name_pl', 'Cyberbezpieczenstwo', 'name_en', 'Cybersecurity',
    'accent_color', '#1155aa', 'sort_order', 10)) IS NOT NULL,
  '10/sesje: RPC panelu zaklada sciezke tematyczna');

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_track_save(jsonb_build_object(
       'event_id', 'e5000000-0000-0000-0000-0000000000a1',
       'key', 'Cyber Bezpieczenstwo', 'name_pl', 'Zly klucz', 'name_en', 'Bad key'))$q$,
  'invalid_key',
  '10/sesje: klucz sciezki poza formatem ^[a-z][a-z0-9_]{1,48}$ jest odrzucany');

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_track_save(jsonb_build_object(
       'event_id', 'e5000000-0000-0000-0000-0000000000a1',
       'key', 'cyber', 'name_pl', 'Duplikat', 'name_en', 'Duplicate'))$q$,
  'event_tracks_event_key_unique',
  '10/sesje: drugi raz ten sam klucz sciezki w jednym wydarzeniu jest odrzucany');

-- Sale: dwie w wydarzeniu A (fixed id, bo wskazuja na nie asercje ponizej),
-- jedna w wydarzeniu roboczym (cel testu klucza obcego potrojnego).
INSERT INTO public.event_rooms (id, tenant_id, event_id, name, capacity, floor) VALUES
  ('a6000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'e5000000-0000-0000-0000-0000000000a1', 'Sala Warszawa', 50, 'Parter'),
  ('a6000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'e5000000-0000-0000-0000-0000000000a1', 'Sala Krakow', 20, NULL),
  ('a6000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'e5000000-0000-0000-0000-0000000000a2', 'Sala Szkicowa', 10, NULL),
  ('a6000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222',
   'e5000000-0000-0000-0000-0000000000b1', 'Sala Obca', 30, NULL);

-- Sciezka w wydarzeniu roboczym - ten sam cel: klucz obcy potrojny.
INSERT INTO public.event_tracks (id, tenant_id, event_id, key, name_pl, name_en) VALUES
  ('a7000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'e5000000-0000-0000-0000-0000000000a2', 'szkic', 'Sciezka szkicu', 'Draft track'),
  ('a7000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222',
   'e5000000-0000-0000-0000-0000000000b1', 'obca', 'Sciezka obca', 'Foreign track');

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_room_save(jsonb_build_object(
       'event_id', 'e5000000-0000-0000-0000-0000000000a1', 'name', '  sala warszawa '))$q$,
  'event_rooms_event_name_unique',
  '10/sesje: sala o tej samej nazwie po lower(btrim()) jest odrzucana');

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_room_save(jsonb_build_object(
       'event_id', 'e5000000-0000-0000-0000-0000000000a1', 'name', 'Foyer', 'capacity', 0))$q$,
  'invalid_capacity',
  '10/sesje: pojemnosc sali rowna zero jest odrzucana');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_rooms_list('e5000000-0000-0000-0000-0000000000a1')) = 2
  AND (SELECT count(*) FROM public.admin_event_tracks_list('e5000000-0000-0000-0000-0000000000a1')) = 1,
  '10/sesje: listy panelu oddaja sale i sciezki TEGO wydarzenia, bez sasiednich');

-- ---------------------------------------------------------------------------
-- 3. SESJE: KOLUMNA GENEROWANA `time_range`
--
-- Trzy asercje, bo trzy rozne rzeczy moga sie zlamac: wartosc (czy przedzial
-- zgadza sie z godzinami), domkniecie (czy jest POLOTWARTY - od tego zalezy,
-- czy sesje styk w styk koliduja) i niezapisywalnosc (kolumna generowana,
-- ktora da sie nadpisac, jest zwykla kolumna z myloca nazwa).
-- ---------------------------------------------------------------------------
INSERT INTO public.event_sessions (
  id, tenant_id, event_id, track_id, room_id, title_pl, title_en,
  starts_at, ends_at, status, sort_order
) VALUES (
  'aa000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'e5000000-0000-0000-0000-0000000000a1',
  (SELECT id FROM public.event_tracks WHERE key = 'cyber'),
  'a6000000-0000-0000-0000-000000000001',
  'Otwarcie', 'Opening', '2026-09-01 09:00+02', '2026-09-01 10:00+02', 'published', 10);

SELECT pg_temp.assert(
  (SELECT time_range = tstzrange('2026-09-01 09:00+02', '2026-09-01 10:00+02', '[)')
     FROM public.event_sessions WHERE id = 'aa000000-0000-0000-0000-000000000001'),
  '10/sesje: time_range zgadza sie z poczatkiem i koncem sesji');

SELECT pg_temp.assert(
  (SELECT lower_inc(time_range) AND NOT upper_inc(time_range)
     AND lower(time_range) = starts_at AND upper(time_range) = ends_at
     FROM public.event_sessions WHERE id = 'aa000000-0000-0000-0000-000000000001'),
  '10/sesje: time_range jest POLOTWARTY [starts_at, ends_at)');

SELECT pg_temp.assert_raises_like(
  $q$UPDATE public.event_sessions
       SET time_range = tstzrange('2026-09-01 00:00+02', '2026-09-01 01:00+02', '[)')
     WHERE id = 'aa000000-0000-0000-0000-000000000001'$q$,
  'can only be updated to DEFAULT',
  '10/sesje: proba zapisu do kolumny generowanej time_range jest odrzucana (UPDATE)');

SELECT pg_temp.assert_raises_like(
  $q$INSERT INTO public.event_sessions
       (tenant_id, event_id, title_pl, title_en, starts_at, ends_at, time_range)
     VALUES ('11111111-1111-1111-1111-111111111111',
             'e5000000-0000-0000-0000-0000000000a1', 'Zapis wprost', 'Direct write',
             '2026-09-01 11:00+02', '2026-09-01 12:00+02',
             tstzrange('2026-09-01 00:00+02', '2026-09-01 01:00+02', '[)'))$q$,
  'non-DEFAULT value',
  '10/sesje: proba zapisu do kolumny generowanej time_range jest odrzucana (INSERT)');

-- Wartosc jedzie za godzinami, a nie zostaje na starej.
UPDATE public.event_sessions SET ends_at = '2026-09-01 10:30+02'
 WHERE id = 'aa000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert(
  (SELECT upper(time_range) = '2026-09-01 10:30+02'::timestamptz
     FROM public.event_sessions WHERE id = 'aa000000-0000-0000-0000-000000000001'),
  '10/sesje: time_range przelicza sie po zmianie godziny konca');
UPDATE public.event_sessions SET ends_at = '2026-09-01 10:00+02'
 WHERE id = 'aa000000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------------------
-- 4. KOLIZJA SALI - OGRANICZENIE EXCLUDE
--
-- Asercje ida OBOK RPC, wprost na tabele, bo `admin_event_session_save` ma
-- WLASNE sprawdzenie kolizji (komunikat `room_conflict`) i przechwytuje
-- `exclusion_violation`. Test wolajacy tylko RPC nie odroznilby ograniczenia
-- dzialajacego od ograniczenia NIEISTNIEJACEGO - komunikat bylby ten sam.
-- Dlatego: raz wprost na tabele (ograniczenie), raz przez RPC (komunikat).
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_raises_like(
  $q$INSERT INTO public.event_sessions
       (tenant_id, event_id, room_id, title_pl, title_en, starts_at, ends_at, status)
     VALUES ('11111111-1111-1111-1111-111111111111',
             'e5000000-0000-0000-0000-0000000000a1',
             'a6000000-0000-0000-0000-000000000001', 'Kolizja', 'Clash',
             '2026-09-01 09:30+02', '2026-09-01 10:30+02', 'draft')$q$,
  'event_sessions_room_no_overlap',
  '10/sesje: EXCLUDE odrzuca druga sesje w tej samej sali o zachodzacych godzinach');

-- Ograniczenie obejmuje TAKZE sesje robocze (WHERE status <> 'cancelled'):
-- kolizja ma bolec przy wpisywaniu agendy, nie przy publikacji. Powyzsza
-- asercja wstawiala wlasnie `draft` - ta sprawdza druga strone: sesja
-- ODWOLANA nachodzic MOZE, bo wypadla z zakresu ograniczenia.
INSERT INTO public.event_sessions (
  id, tenant_id, event_id, room_id, title_pl, title_en, starts_at, ends_at,
  status, cancelled_at
) VALUES (
  'aa000000-0000-0000-0000-000000000090', '11111111-1111-1111-1111-111111111111',
  'e5000000-0000-0000-0000-0000000000a1', 'a6000000-0000-0000-0000-000000000001',
  'Odwolana kolizja', 'Cancelled clash', '2026-09-01 09:30+02', '2026-09-01 10:30+02',
  'cancelled', now());

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sessions
    WHERE id = 'aa000000-0000-0000-0000-000000000090') = 1,
  '10/sesje: sesja ODWOLANA moze nachodzic na inna w tej samej sali (zakres EXCLUDE)');

-- Styk w styk: [09:00,10:00) i [10:00,11:00) nie koliduja. Gdyby przedzial byl
-- domkniety, ta asercja byla by czerwona - i o tym jest cala decyzja `'[)'`.
INSERT INTO public.event_sessions (
  id, tenant_id, event_id, room_id, title_pl, title_en, starts_at, ends_at, status, sort_order
) VALUES (
  'aa000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
  'e5000000-0000-0000-0000-0000000000a1', 'a6000000-0000-0000-0000-000000000001',
  'Panel poludniowy', 'Noon panel', '2026-09-01 10:00+02', '2026-09-01 11:00+02', 'published', 20);

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sessions
    WHERE room_id = 'a6000000-0000-0000-0000-000000000001' AND status = 'published') = 2,
  '10/sesje: sesje styk w styk w jednej sali sa dozwolone (przedzial polotwarty)');

-- Sesja BEZ sali nie podlega ograniczeniu (WHERE room_id IS NOT NULL) - dwie
-- nachodzace sesje bez sali sa legalne. Bez tej asercji nie wiedzielibysmy,
-- czy warunek czastkowy ograniczenia w ogole cokolwiek zawezal.
INSERT INTO public.event_sessions (
  id, tenant_id, event_id, title_pl, title_en, starts_at, ends_at, status
) VALUES
  ('aa000000-0000-0000-0000-000000000091', '11111111-1111-1111-1111-111111111111',
   'e5000000-0000-0000-0000-0000000000a1', 'Bez sali jeden', 'No room one',
   '2026-09-01 12:00+02', '2026-09-01 13:00+02', 'draft'),
  ('aa000000-0000-0000-0000-000000000092', '11111111-1111-1111-1111-111111111111',
   'e5000000-0000-0000-0000-0000000000a1', 'Bez sali dwa', 'No room two',
   '2026-09-01 12:30+02', '2026-09-01 13:30+02', 'draft');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sessions WHERE room_id IS NULL
     AND event_id = 'e5000000-0000-0000-0000-0000000000a1') = 2,
  '10/sesje: dwie nachodzace sesje BEZ sali sa dozwolone (warunek czastkowy EXCLUDE)');

-- Ta sama godzina, INNA sala: dozwolone. Sesja rownolegla z limitem miejsc
-- jest jednoczesnie fixture dla calej sekcji zapisow.
SELECT pg_temp.assert(
  public.admin_event_session_save(jsonb_build_object(
    'event_id', 'e5000000-0000-0000-0000-0000000000a1',
    'title_pl', 'Panel rownolegly', 'title_en', 'Parallel panel',
    'starts_at', '2026-09-01 09:30+02', 'ends_at', '2026-09-01 10:30+02',
    'room_id', 'a6000000-0000-0000-0000-000000000002',
    'requires_signup', true, 'capacity', 1, 'status', 'published')) IS NOT NULL,
  '10/sesje: sesja w tych samych godzinach w INNEJ sali jest przyjmowana');

-- RPC: ten sam konflikt, ale komunikat dla czlowieka.
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_session_save(jsonb_build_object(
       'event_id', 'e5000000-0000-0000-0000-0000000000a1',
       'title_pl', 'Kolizja przez RPC', 'title_en', 'Clash via RPC',
       'starts_at', '2026-09-01 09:15+02', 'ends_at', '2026-09-01 09:45+02',
       'room_id', 'a6000000-0000-0000-0000-000000000001'))$q$,
  'room_conflict',
  '10/sesje: RPC panelu tlumaczy kolizje sali na komunikat room_conflict');

-- Edycja sesji NIE moze kolidowac ze SOBA (warunek `s.id <> v_id`) - bez tego
-- kazda zmiana opisu sesji z sala byla by "kolizja z soba".
SELECT pg_temp.assert(
  public.admin_event_session_save(jsonb_build_object(
    'id', 'aa000000-0000-0000-0000-000000000001',
    'description_pl', 'Opis otwarcia', 'description_en', 'Opening description'))
    = 'aa000000-0000-0000-0000-000000000001',
  '10/sesje: edycja sesji z sala nie koliduje sama ze soba');

-- Edycja czesciowa: pole nieobecne w payloadzie zostaje bez zmiany.
SELECT public.admin_event_session_save(jsonb_build_object(
  'id', 'aa000000-0000-0000-0000-000000000001', 'sort_order', 15));
SELECT pg_temp.assert(
  (SELECT description_pl FROM public.event_sessions
    WHERE id = 'aa000000-0000-0000-0000-000000000001') = 'Opis otwarcia',
  '10/sesje: edycja czesciowa zachowuje pola nieobecne w payloadzie');

-- Przepiecie sesji do innego wydarzenia jest zabronione jawnie.
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_session_save(jsonb_build_object(
       'id', 'aa000000-0000-0000-0000-000000000001',
       'event_id', 'e5000000-0000-0000-0000-0000000000a2'))$q$,
  'event_immutable',
  '10/sesje: sesji nie da sie przepiac do innego wydarzenia');

-- ---------------------------------------------------------------------------
-- 5. TRIGGER WALIDACYJNY tg_event_sessions_validate
--
-- Cztery warunki, ktorych nie da sie zapisac jako CHECK, bo dotykaja INNYCH
-- WIERSZY. Kazdy sprawdzany DWOMA drogami tam, gdzie drogi sa dwie: przez RPC
-- (komunikat) i wprost na tabele (czy trigger obowiazuje takze import, klon
-- i COPY, a nie tylko formularz).
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_raises_like(
  $q$INSERT INTO public.event_sessions
       (tenant_id, event_id, title_pl, title_en, starts_at, ends_at)
     VALUES ('11111111-1111-1111-1111-111111111111',
             'e5000000-0000-0000-0000-0000000000a1', 'Za wczesnie', 'Too early',
             '2026-08-31 09:00+02', '2026-08-31 10:00+02')$q$,
  'session_before_event',
  '10/sesje: trigger odrzuca sesje przed poczatkiem wydarzenia (zapis wprost)');

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_session_save(jsonb_build_object(
       'event_id', 'e5000000-0000-0000-0000-0000000000a1',
       'title_pl', 'Za pozno', 'title_en', 'Too late',
       'starts_at', '2026-09-03 09:00+02', 'ends_at', '2026-09-03 10:00+02'))$q$,
  'session_after_event',
  '10/sesje: trigger odrzuca sesje po koncu wydarzenia (przez RPC panelu)');

-- Wydarzenie bez konca: gorna granica NIE jest sprawdzana. To jest zachowanie,
-- ktore migracja opisuje wprost - i ktore trzeba przetestowac, zeby nie stalo
-- sie regresja przy pierwszym "uszczelnieniu" walidacji.
SELECT pg_temp.assert(
  public.admin_event_session_save(jsonb_build_object(
    'event_id', 'e5000000-0000-0000-0000-0000000000a3',
    'title_pl', 'Rok pozniej', 'title_en', 'A year later',
    'starts_at', '2027-09-01 09:00+02', 'ends_at', '2027-09-01 10:00+02')) IS NOT NULL,
  '10/sesje: wydarzenie bez daty konca nie ma gornej granicy walidacji');

-- Dolna granica obowiazuje TAKZE wydarzenie bez konca.
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_session_save(jsonb_build_object(
       'event_id', 'e5000000-0000-0000-0000-0000000000a3',
       'title_pl', 'Przed startem', 'title_en', 'Before start',
       'starts_at', '2026-08-01 09:00+02', 'ends_at', '2026-08-01 10:00+02'))$q$,
  'session_before_event',
  '10/sesje: dolna granica walidacji obowiazuje takze wydarzenie bez konca');

-- Limit miejsc ponad pojemnosc sali (Sala Krakow ma 20).
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_session_save(jsonb_build_object(
       'event_id', 'e5000000-0000-0000-0000-0000000000a1',
       'title_pl', 'Za duzy limit', 'title_en', 'Limit too big',
       'starts_at', '2026-09-01 14:00+02', 'ends_at', '2026-09-01 15:00+02',
       'room_id', 'a6000000-0000-0000-0000-000000000002',
       'requires_signup', true, 'capacity', 100))$q$,
  'capacity_over_room',
  '10/sesje: trigger odrzuca limit miejsc wyzszy od pojemnosci sali');

-- Limit RowNY pojemnosci sali przechodzi (warunek jest `>`, nie `>=`).
SELECT pg_temp.assert(
  public.admin_event_session_save(jsonb_build_object(
    'event_id', 'e5000000-0000-0000-0000-0000000000a1',
    'title_pl', 'Limit rowny sali', 'title_en', 'Limit equals room',
    'starts_at', '2026-09-01 14:00+02', 'ends_at', '2026-09-01 15:00+02',
    'room_id', 'a6000000-0000-0000-0000-000000000002',
    'requires_signup', true, 'capacity', 20)) IS NOT NULL,
  '10/sesje: limit miejsc ROWNY pojemnosci sali jest przyjmowany');

-- Limit miejsc bez wlaczonego zapisu: CHECK tabeli, nie trigger.
SELECT pg_temp.assert_raises_like(
  $q$INSERT INTO public.event_sessions
       (tenant_id, event_id, title_pl, title_en, starts_at, ends_at, capacity)
     VALUES ('11111111-1111-1111-1111-111111111111',
             'e5000000-0000-0000-0000-0000000000a1', 'Limit bez zapisu', 'Limit no signup',
             '2026-09-01 16:00+02', '2026-09-01 17:00+02', 10)$q$,
  'event_sessions_capacity_needs_signup',
  '10/sesje: CHECK odrzuca limit miejsc przy wylaczonym zapisie (zapis wprost)');

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_session_save(jsonb_build_object(
       'event_id', 'e5000000-0000-0000-0000-0000000000a1',
       'title_pl', 'Limit bez zapisu RPC', 'title_en', 'Limit no signup RPC',
       'starts_at', '2026-09-01 16:00+02', 'ends_at', '2026-09-01 17:00+02',
       'capacity', 10))$q$,
  'capacity_requires_signup',
  '10/sesje: RPC panelu odrzuca limit miejsc przy wylaczonym zapisie');

-- Gniezdzenie jednopoziomowe.
SELECT public.admin_event_session_save(jsonb_build_object(
  'event_id', 'e5000000-0000-0000-0000-0000000000a1',
  'title_pl', 'Podsesja', 'title_en', 'Sub session',
  'starts_at', '2026-09-01 10:05+02', 'ends_at', '2026-09-01 10:25+02',
  'parent_session_id', 'aa000000-0000-0000-0000-000000000002'));

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sessions
    WHERE parent_session_id = 'aa000000-0000-0000-0000-000000000002') = 1,
  '10/sesje: podsesja pod blokiem nadrzednym jest przyjmowana');

SELECT pg_temp.assert_raises_like(
  format($q$SELECT public.admin_event_session_save(jsonb_build_object(
              'event_id', 'e5000000-0000-0000-0000-0000000000a1',
              'title_pl', 'Wnuk', 'title_en', 'Grandchild',
              'starts_at', '2026-09-01 10:06+02', 'ends_at', '2026-09-01 10:10+02',
              'parent_session_id', %L))$q$,
         (SELECT id FROM public.event_sessions WHERE title_pl = 'Podsesja')),
  'parent_depth',
  '10/sesje: trigger odrzuca drugi poziom gniezdzenia (podsesja nie jest rodzicem)');

-- Sesja sama sobie rodzicem: CHECK `event_sessions_parent_not_self`.
SELECT pg_temp.assert_raises_like(
  $q$UPDATE public.event_sessions
       SET parent_session_id = 'aa000000-0000-0000-0000-000000000001'
     WHERE id = 'aa000000-0000-0000-0000-000000000001'$q$,
  'event_sessions_parent_not_self',
  '10/sesje: sesja nie moze byc rodzicem samej siebie');

-- TRIGGER ODPALA TYLKO NA WYMIENIONYCH KOLUMNACH. To jest decyzja migracji
-- (`UPDATE OF event_id, starts_at, ends_at, capacity, room_id,
-- parent_session_id`), a nie przeoczenie: zwezenie okna wydarzenia PO wpisaniu
-- agendy nie ma cofac istniejacych sesji - rozjechanie raportuje
-- `admin_event_agenda_conflicts`. Asercja opisuje to, co JEST, w obie strony.
UPDATE public.events SET ends_at = '2026-09-01 11:00+02'
 WHERE id = 'e5000000-0000-0000-0000-0000000000a1';

-- Gdyby trigger odpalal na kazdej kolumnie, ten UPDATE przewrocilby caly plik
-- na `session_after_event` - i to jest cala tresc tej asercji.
UPDATE public.event_sessions SET title_pl = 'Panel poludniowy (zmiana)'
 WHERE id = 'aa000000-0000-0000-0000-000000000002';

SELECT pg_temp.assert(
  (SELECT title_pl FROM public.event_sessions
    WHERE id = 'aa000000-0000-0000-0000-000000000002') = 'Panel poludniowy (zmiana)',
  '10/sesje: zwezenie okna wydarzenia nie blokuje edycji tytulu istniejacej sesji');

SELECT pg_temp.assert_raises_like(
  $q$UPDATE public.event_sessions SET starts_at = '2026-09-01 12:00+02',
                                      ends_at = '2026-09-01 13:00+02'
     WHERE id = 'aa000000-0000-0000-0000-000000000002'$q$,
  'session_after_event',
  '10/sesje: dotkniecie godzin sesji po zwezeniu okna URUCHAMIA walidacje');

UPDATE public.events SET ends_at = '2026-09-02 20:00+02'
 WHERE id = 'e5000000-0000-0000-0000-0000000000a1';
UPDATE public.event_sessions SET title_pl = 'Panel poludniowy'
 WHERE id = 'aa000000-0000-0000-0000-000000000002';

-- ---------------------------------------------------------------------------
-- 6. KLUCZE OBCE POTROJNE: SCIEZKA I SALA Z INNEGO WYDARZENIA
--
-- Klucz `(tenant_id, event_id, track_id)` jest jedynym miejscem, ktore pilnuje
-- "sciezka z TEGO wydarzenia". Bez niego sesja kongresu wrzesniowego mogla by
-- wskazywac sciezke kongresu listopadowego, a agenda pokazywalaby kolor
-- i nazwe z obcego wydarzenia. Sprawdzamy WPROST na tabele - RPC ma wlasne
-- komunikaty (`track_not_found` / `room_not_found`) i sam nie dowodzi, ze
-- klucz istnieje.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_raises_like(
  $q$INSERT INTO public.event_sessions
       (tenant_id, event_id, track_id, title_pl, title_en, starts_at, ends_at)
     VALUES ('11111111-1111-1111-1111-111111111111',
             'e5000000-0000-0000-0000-0000000000a1',
             'a7000000-0000-0000-0000-000000000002',
             'Obca sciezka', 'Foreign track', '2026-09-01 17:00+02', '2026-09-01 18:00+02')$q$,
  'event_sessions_track_fk',
  '10/sesje: klucz obcy zlozony odrzuca sciezke z INNEGO wydarzenia');

SELECT pg_temp.assert_raises_like(
  $q$INSERT INTO public.event_sessions
       (tenant_id, event_id, room_id, title_pl, title_en, starts_at, ends_at)
     VALUES ('11111111-1111-1111-1111-111111111111',
             'e5000000-0000-0000-0000-0000000000a1',
             'a6000000-0000-0000-0000-000000000003',
             'Obca sala', 'Foreign room', '2026-09-01 17:00+02', '2026-09-01 18:00+02')$q$,
  'event_sessions_room_fk',
  '10/sesje: klucz obcy zlozony odrzuca sale z INNEGO wydarzenia');

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_session_save(jsonb_build_object(
       'event_id', 'e5000000-0000-0000-0000-0000000000a1',
       'title_pl', 'Obca sciezka RPC', 'title_en', 'Foreign track RPC',
       'starts_at', '2026-09-01 17:00+02', 'ends_at', '2026-09-01 18:00+02',
       'track_id', 'a7000000-0000-0000-0000-000000000002'))$q$,
  'track_not_found',
  '10/sesje: RPC panelu odrzuca sciezke z innego wydarzenia z nazwa pola');

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_session_save(jsonb_build_object(
       'event_id', 'e5000000-0000-0000-0000-0000000000a1',
       'title_pl', 'Obca sala RPC', 'title_en', 'Foreign room RPC',
       'starts_at', '2026-09-01 17:00+02', 'ends_at', '2026-09-01 18:00+02',
       'room_id', 'a6000000-0000-0000-0000-000000000003'))$q$,
  'room_not_found',
  '10/sesje: RPC panelu odrzuca sale z innego wydarzenia z nazwa pola');

-- Rodzic z innego wydarzenia: ten sam klucz potrojny na `parent_session_id`.
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_session_save(jsonb_build_object(
       'event_id', 'e5000000-0000-0000-0000-0000000000a3',
       'title_pl', 'Obcy rodzic', 'title_en', 'Foreign parent',
       'starts_at', '2026-09-01 17:00+02', 'ends_at', '2026-09-01 18:00+02',
       'parent_session_id', 'aa000000-0000-0000-0000-000000000001'))$q$,
  'parent_not_found',
  '10/sesje: RPC panelu odrzuca rodzica z innego wydarzenia');

-- Wiersz wskazujacy wydarzenie OBCEGO NAJEMCY. Trigger walidacyjny odpala
-- PRZED sprawdzeniem klucza obcego, wiec komunikatem jest `not_found`
-- (wydarzenia nie ma w TYM najemcy) - i to jest droga, ktora chcemy widziec.
SELECT pg_temp.assert_raises_like(
  $q$INSERT INTO public.event_sessions
       (tenant_id, event_id, title_pl, title_en, starts_at, ends_at)
     VALUES ('11111111-1111-1111-1111-111111111111',
             'e5000000-0000-0000-0000-0000000000b1',
             'Podmiana najemcy', 'Tenant swap', '2026-09-01 09:00+02', '2026-09-01 10:00+02')$q$,
  'not_found',
  '10/sesje: sesja wskazujaca wydarzenie OBCEGO najemcy jest odrzucana');

-- ---------------------------------------------------------------------------
-- 7. OBSADA SESJI I KOLIZJA PRELEGENTA
--
-- ODPOWIEDZ NA PYTANIE "CZY MIGRACJA BLOKUJE KOLIZJE PRELEGENTA": blokuje ja
-- w RPC `admin_event_session_speakers_set`, a NIE ograniczeniem bazy.
-- Ograniczenie EXCLUDE na obsadzie wymagaloby zdublowania przedzialu czasu
-- w wierszu obsady (naglowek migracji, punkt 2). Konsekwencja jest opisana
-- wprost: kolizje mozna wytworzyc PRZESUWAJAC GODZINY juz obsadzonej sesji,
-- i wtedy lapie ja tylko raport kolizji. Testujemy oba stany - blokade zapisu
-- I dziure, ktora migracja przyznaje - bo test, ktory milczy o dziurze,
-- zamienia decyzje projektowa w przypadek.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  public.admin_event_session_speakers_set(jsonb_build_object(
    'session_id', 'aa000000-0000-0000-0000-000000000001',
    'speakers', jsonb_build_array(
      jsonb_build_object('speaker_profile_id', '59000000-0000-0000-0000-0000000000a1',
                         'role', 'moderator'),
      jsonb_build_object('speaker_profile_id', '59000000-0000-0000-0000-0000000000a2',
                         'role', 'panelist')))) = 2,
  '10/sesje: obsada sesji ustawiana wsadowo (dwie osoby)');

-- Zastapienie CALEJ obsady: nieobecni w payloadzie sa kasowani.
--
-- UWAGA NA JEDNA INSTRUKCJE. Wywolanie mutujace i zapytanie kontrolne MUSZA
-- byc w dwoch osobnych instrukcjach: w jednym SELECT-cie podzapytanie liczace
-- wiersze biegnie na migawce z POCZATKU instrukcji, wiec nie widzi tego, co
-- funkcja wlasnie skasowala - i asercja mierzyla by stan sprzed wywolania.
SELECT pg_temp.assert(
  public.admin_event_session_speakers_set(jsonb_build_object(
    'session_id', 'aa000000-0000-0000-0000-000000000001',
    'speakers', jsonb_build_array(
      jsonb_build_object('speaker_profile_id', '59000000-0000-0000-0000-0000000000a1',
                         'role', 'speaker', 'sort_order', 5)))) = 1,
  '10/sesje: zastapienie obsady zwraca liczbe wierszy z payloadu');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_session_speakers
    WHERE session_id = 'aa000000-0000-0000-0000-000000000001') = 1
  AND (SELECT count(*) FROM public.event_session_speakers
        WHERE session_id = 'aa000000-0000-0000-0000-000000000001'
          AND speaker_profile_id = '59000000-0000-0000-0000-0000000000a2') = 0,
  '10/sesje: zastapienie obsady kasuje wiersze nieobecne w payloadzie');

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_session_speakers_set(jsonb_build_object(
       'session_id', 'aa000000-0000-0000-0000-000000000001',
       'speakers', jsonb_build_array(
         jsonb_build_object('speaker_profile_id', '59000000-0000-0000-0000-0000000000a1',
                            'role', 'sekretarz'))))$q$,
  'invalid_role',
  '10/sesje: rola obsady poza katalogiem czterech wartosci jest odrzucana');

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_session_speakers_set(jsonb_build_object(
       'session_id', 'aa000000-0000-0000-0000-000000000001',
       'speakers', jsonb_build_object('speaker_profile_id',
                                      '59000000-0000-0000-0000-0000000000a1')))$q$,
  'invalid_payload',
  '10/sesje: obsada podana jako obiekt zamiast tablicy jest odrzucana');

-- Kolizja prelegenta: Otwarcie [09:00,10:00) nachodzi na Panel rownolegly
-- [09:30,10:30), a prelegent A1 jest juz w Otwarciu z rola `speaker`.
SELECT pg_temp.assert_raises_like(
  format($q$SELECT public.admin_event_session_speakers_set(jsonb_build_object(
              'session_id', %L,
              'speakers', jsonb_build_array(
                jsonb_build_object('speaker_profile_id',
                                   '59000000-0000-0000-0000-0000000000a1'))))$q$,
         (SELECT id FROM public.event_sessions WHERE title_pl = 'Panel rownolegly')),
  'speaker_overlap',
  '10/sesje: RPC odrzuca tego samego prelegenta w dwoch nachodzacych sesjach');

-- Furtka pierwsza: rola `host` ma zwolnienie z definicji.
SELECT pg_temp.assert(
  public.admin_event_session_speakers_set(jsonb_build_object(
    'session_id', (SELECT id FROM public.event_sessions WHERE title_pl = 'Panel rownolegly'),
    'speakers', jsonb_build_array(
      jsonb_build_object('speaker_profile_id', '59000000-0000-0000-0000-0000000000a1',
                         'role', 'host')))) = 1,
  '10/sesje: rola host omija blokade kolizji prelegenta');

-- Furtka druga: jawne `allow_overlap`.
SELECT pg_temp.assert(
  public.admin_event_session_speakers_set(jsonb_build_object(
    'session_id', (SELECT id FROM public.event_sessions WHERE title_pl = 'Panel rownolegly'),
    'speakers', jsonb_build_array(
      jsonb_build_object('speaker_profile_id', '59000000-0000-0000-0000-0000000000a1',
                         'role', 'speaker', 'allow_overlap', true)))) = 1,
  '10/sesje: allow_overlap omija blokade kolizji prelegenta');

-- Profil prelegenta OBCEGO najemcy: RPC ma na to wlasny komunikat, a pod nim
-- stoi klucz obcy zlozony `(tenant_id, speaker_profile_id)` z ograniczeniem
-- `speaker_profiles_tenant_id_key`, ktore ta migracja dodaje.
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_session_speakers_set(jsonb_build_object(
       'session_id', 'aa000000-0000-0000-0000-000000000001',
       'speakers', jsonb_build_array(
         jsonb_build_object('speaker_profile_id',
                            '59000000-0000-0000-0000-0000000000b1'))))$q$,
  'speaker_not_found',
  '10/sesje: prelegent z OBCEGO najemcy nie wchodzi do obsady');

SELECT pg_temp.assert(
  (SELECT count(*) FROM pg_constraint
    WHERE conname = 'speaker_profiles_tenant_id_key'
      AND conrelid = 'public.speaker_profiles'::regclass) = 1,
  '10/sesje: migracja dodala speaker_profiles_tenant_id_key (cel klucza obcego obsady)');

-- Wiersz obsady podpiety pod OBCE wydarzenie: klucz obcy potrojny
-- `(tenant_id, event_id, session_id)`.
SELECT pg_temp.assert_raises_like(
  $q$INSERT INTO public.event_session_speakers
       (tenant_id, event_id, session_id, speaker_profile_id)
     VALUES ('11111111-1111-1111-1111-111111111111',
             'e5000000-0000-0000-0000-0000000000a2',
             'aa000000-0000-0000-0000-000000000001',
             '59000000-0000-0000-0000-0000000000a2')$q$,
  'event_session_speakers_session_fk',
  '10/sesje: klucz obcy potrojny odrzuca obsade podpieta pod obce wydarzenie');

-- ---------------------------------------------------------------------------
-- 8. ZAPISY NA SESJE: LIMIT MIEJSC, LISTA REZERWOWA, KOLIZJA UCZESTNIKA
--
-- `Panel rownolegly` ma `capacity = 1`, wiec caly proces (miejsce, lista
-- rezerwowa, awans) da sie sprawdzic na dwoch uczestnikach.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('c0000000-0000-0000-0000-0000000000a1',
                      '11111111-1111-1111-1111-111111111111');

SELECT pg_temp.assert(
  (public.event_session_signup(jsonb_build_object(
     'session_id', (SELECT id FROM public.event_sessions WHERE title_pl = 'Panel rownolegly')))
   ->>'status') = 'registered',
  '10/sesje: pierwszy zapis zajmuje jedyne miejsce');

SELECT pg_temp.assert(
  (SELECT (public.event_session_signup(jsonb_build_object(
     'session_id', (SELECT id FROM public.event_sessions WHERE title_pl = 'Panel rownolegly')))
   ->>'seats_left')::integer) = 0,
  '10/sesje: po zajeciu jedynego miejsca seats_left jest zerem');

-- Dwuklik nie tworzy drugiego miejsca (UNIQUE + wyliczanie zajetosci BEZ
-- wlasnego wiersza).
SELECT pg_temp.assert(
  (SELECT (public.event_session_signup(jsonb_build_object(
     'session_id', (SELECT id FROM public.event_sessions WHERE title_pl = 'Panel rownolegly')))
   ->>'registered')::integer) = 1,
  '10/sesje: powtorny zapis tej samej osoby jest idempotentny');

SELECT pg_temp.act_as('c0000000-0000-0000-0000-0000000000a2',
                      '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert(
  (public.event_session_signup(jsonb_build_object(
     'session_id', (SELECT id FROM public.event_sessions WHERE title_pl = 'Panel rownolegly')))
   ->>'status') = 'waitlist',
  '10/sesje: ZAPIS PONAD LIMIT laduje na liscie rezerwowej, a nie zajmuje miejsca');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_session_signups
    WHERE session_id = (SELECT id FROM public.event_sessions WHERE title_pl = 'Panel rownolegly')
      AND status = 'registered') = 1,
  '10/sesje: limit miejsc jest egzekwowany - jeden wiersz `registered` na jedno miejsce');

-- Trzeci uczestnik: druga pozycja na liscie rezerwowej (FIFO po registered_at).
SELECT pg_temp.act_as('c0000000-0000-0000-0000-0000000000a3',
                      '11111111-1111-1111-1111-111111111111');
SELECT public.event_session_signup(jsonb_build_object(
  'session_id', (SELECT id FROM public.event_sessions WHERE title_pl = 'Panel rownolegly')));

-- KOLEJNOSC NA LISCIE REZERWOWEJ TRZEBA WYMUSIC JAWNIE, A NIE ZALOZYC.
-- `event_session_signup` stempluje `registered_at` przez `now()`, a `now()` to
-- czas TRANSAKCJI - wiec wszystkie zapisy zrobione w tym pliku maja jeden
-- i ten sam stempel, a rozstrzyga dopiero `g.id`, czyli losowy uuid. Na
-- produkcji zapisy przychodza w osobnych transakcjach i stemple sa rozne;
-- tutaj bez tego UPDATE-u asercja o FIFO byla by LOSOWA (sprawdzone: raz
-- zielona, raz czerwona). Rozsuwamy stemple, zeby test mierzyl regule awansu,
-- a nie generator uuid.
UPDATE public.event_session_signups
   SET registered_at = timestamptz '2026-08-01 10:00+02'
 WHERE user_id = 'c0000000-0000-0000-0000-0000000000a2';
UPDATE public.event_session_signups
   SET registered_at = timestamptz '2026-08-01 11:00+02'
 WHERE user_id = 'c0000000-0000-0000-0000-0000000000a3';

-- Pozycje w kolejce oddaje lista PANELU, wiec na chwile wchodzimy jako redaktor.
SELECT pg_temp.act_as('e0000000-0000-0000-0000-0000000000a1',
                      '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert(
  (SELECT waitlist_position FROM public.admin_event_session_signups_list(
     (SELECT id FROM public.event_sessions WHERE title_pl = 'Panel rownolegly'))
    WHERE user_id = 'c0000000-0000-0000-0000-0000000000a3') = 2,
  '10/sesje: pozycja na liscie rezerwowej jest liczona FIFO po registered_at');

-- Rezygnacja osoby Z MIEJSCEM awansuje NAJSTARSZY wiersz z listy rezerwowej.
SELECT pg_temp.act_as('c0000000-0000-0000-0000-0000000000a1',
                      '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert(
  (public.event_session_signup(jsonb_build_object(
     'session_id', (SELECT id FROM public.event_sessions WHERE title_pl = 'Panel rownolegly'),
     'status', 'cancelled'))->>'promoted')::boolean,
  '10/sesje: rezygnacja osoby z miejscem awansuje kogos z listy rezerwowej');

SELECT pg_temp.assert(
  (SELECT status FROM public.event_session_signups
    WHERE session_id = (SELECT id FROM public.event_sessions WHERE title_pl = 'Panel rownolegly')
      AND user_id = 'c0000000-0000-0000-0000-0000000000a2') = 'registered'
  AND (SELECT status FROM public.event_session_signups
        WHERE session_id = (SELECT id FROM public.event_sessions WHERE title_pl = 'Panel rownolegly')
          AND user_id = 'c0000000-0000-0000-0000-0000000000a3') = 'waitlist',
  '10/sesje: awansuje NAJSTARSZY wiersz listy rezerwowej, nie dowolny (FIFO)');

-- Rezygnacja z listy rezerwowej NIE zwalnia miejsca, wiec nie awansuje nikogo.
SELECT pg_temp.act_as('c0000000-0000-0000-0000-0000000000a3',
                      '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert(
  (public.event_session_signup(jsonb_build_object(
     'session_id', (SELECT id FROM public.event_sessions WHERE title_pl = 'Panel rownolegly'),
     'status', 'cancelled'))->>'promoted')::boolean = false,
  '10/sesje: rezygnacja z listy rezerwowej nie awansuje nikogo');

-- Sesja bez wlaczonego zapisu.
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.event_session_signup(jsonb_build_object(
       'session_id', 'aa000000-0000-0000-0000-000000000001'))$q$,
  'signup_disabled',
  '10/sesje: zapis na sesje z wylaczonym zapisem jest odrzucany');

-- Sesja ROBOCZA nie przyjmuje zapisow (plaszczyzna tresci widzi tylko
-- `published`).
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.event_session_signup(jsonb_build_object(
       'session_id', 'aa000000-0000-0000-0000-000000000091'))$q$,
  'not_found',
  '10/sesje: sesja robocza nie przyjmuje zapisow uczestnika');

-- Sesja z limitem ZERO: limit 0 znaczy "nikt nie ma miejsca", a nie
-- "bez limitu". To jest roznica miedzy NULL i 0 na tej kolumnie.
SELECT pg_temp.act_as('e0000000-0000-0000-0000-0000000000a1',
                      '11111111-1111-1111-1111-111111111111');
SELECT public.admin_event_session_save(jsonb_build_object(
  'event_id', 'e5000000-0000-0000-0000-0000000000a1',
  'title_pl', 'Zero miejsc', 'title_en', 'Zero seats',
  'starts_at', '2026-09-02 08:00+02', 'ends_at', '2026-09-02 09:00+02',
  'requires_signup', true, 'capacity', 0, 'status', 'published'));

SELECT pg_temp.act_as('c0000000-0000-0000-0000-0000000000a1',
                      '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert(
  (public.event_session_signup(jsonb_build_object(
     'session_id', (SELECT id FROM public.event_sessions WHERE title_pl = 'Zero miejsc')))
   ->>'status') = 'waitlist',
  '10/sesje: limit ZERO to brak miejsc, nie brak limitu - zapis idzie na liste');

-- Prog warstwy czlonkowskiej na sesji.
SELECT pg_temp.act_as('e0000000-0000-0000-0000-0000000000a1',
                      '11111111-1111-1111-1111-111111111111');
SELECT public.admin_event_session_save(jsonb_build_object(
  'event_id', 'e5000000-0000-0000-0000-0000000000a1',
  'title_pl', 'Sesja dla Pro', 'title_en', 'Pro session',
  'starts_at', '2026-09-02 10:00+02', 'ends_at', '2026-09-02 11:00+02',
  'requires_signup', true, 'min_tier_rank', 20, 'status', 'published'));

SELECT pg_temp.act_as('c0000000-0000-0000-0000-0000000000a1',
                      '11111111-1111-1111-1111-111111111111', 0);
SELECT pg_temp.assert_raises_like(
  format($q$SELECT public.event_session_signup(jsonb_build_object('session_id', %L))$q$,
         (SELECT id FROM public.event_sessions WHERE title_pl = 'Sesja dla Pro')),
  'tier_required',
  '10/sesje: prog warstwy blokuje zapis uczestnika o zbyt niskiej randze');

SELECT pg_temp.act_as('c0000000-0000-0000-0000-0000000000a1',
                      '11111111-1111-1111-1111-111111111111', 20);
SELECT pg_temp.assert(
  (public.event_session_signup(jsonb_build_object(
     'session_id', (SELECT id FROM public.event_sessions WHERE title_pl = 'Sesja dla Pro')))
   ->>'status') = 'registered',
  '10/sesje: po osiagnieciu wymaganej rangi ten sam zapis przechodzi (kontrapunkt)');

-- Kolizja czasowa uczestnika: obie sesje z `allow_overlap = false`.
SELECT pg_temp.act_as('e0000000-0000-0000-0000-0000000000a1',
                      '11111111-1111-1111-1111-111111111111');
SELECT public.admin_event_session_save(jsonb_build_object(
  'event_id', 'e5000000-0000-0000-0000-0000000000a1',
  'title_pl', 'Warsztat A', 'title_en', 'Workshop A',
  'starts_at', '2026-09-02 13:00+02', 'ends_at', '2026-09-02 15:00+02',
  'requires_signup', true, 'allow_overlap', false, 'status', 'published'));
SELECT public.admin_event_session_save(jsonb_build_object(
  'event_id', 'e5000000-0000-0000-0000-0000000000a1',
  'title_pl', 'Warsztat B', 'title_en', 'Workshop B',
  'starts_at', '2026-09-02 14:00+02', 'ends_at', '2026-09-02 16:00+02',
  'requires_signup', true, 'allow_overlap', false, 'status', 'published'));
-- Trzecia sesja w tym samym czasie, ale Z pozwoleniem na nakladanie -
-- kontrapunkt, ktory dowodzi, ze regula dziala miedzy PARAMI bez furtki,
-- a nie miedzy dowolnymi dwiema sesjami o wspolnej godzinie.
SELECT public.admin_event_session_save(jsonb_build_object(
  'event_id', 'e5000000-0000-0000-0000-0000000000a1',
  'title_pl', 'Warsztat C', 'title_en', 'Workshop C',
  'starts_at', '2026-09-02 14:30+02', 'ends_at', '2026-09-02 15:30+02',
  'requires_signup', true, 'allow_overlap', true, 'status', 'published'));

SELECT pg_temp.act_as('c0000000-0000-0000-0000-0000000000a2',
                      '11111111-1111-1111-1111-111111111111');
SELECT public.event_session_signup(jsonb_build_object(
  'session_id', (SELECT id FROM public.event_sessions WHERE title_pl = 'Warsztat A')));

SELECT pg_temp.assert_raises_like(
  format($q$SELECT public.event_session_signup(jsonb_build_object('session_id', %L))$q$,
         (SELECT id FROM public.event_sessions WHERE title_pl = 'Warsztat B')),
  'overlap_conflict',
  '10/sesje: podwojny zapis na dwie nachodzace sesje bez furtki jest odrzucany');

SELECT pg_temp.assert(
  (public.event_session_signup(jsonb_build_object(
     'session_id', (SELECT id FROM public.event_sessions WHERE title_pl = 'Warsztat C')))
   ->>'status') = 'registered',
  '10/sesje: sesja z allow_overlap przyjmuje zapis w tej samej godzinie (kontrapunkt)');

-- Anonim nie zapisuje sie na nic.
SELECT pg_temp.act_as(NULL, '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert_raises_like(
  format($q$SELECT public.event_session_signup(jsonb_build_object('session_id', %L))$q$,
         (SELECT id FROM public.event_sessions WHERE title_pl = 'Warsztat C')),
  'authentication required',
  '10/sesje: anonim nie zapisze sie na sesje');

-- ---------------------------------------------------------------------------
-- 9. PUBLICZNA AGENDA: TYLKO OPUBLIKOWANE, TYLKO ZE SWOJEGO NAJEMCY
-- ---------------------------------------------------------------------------
-- Sesja robocza, sesja odwolana i sesja zamknieta - trzy stany, ktore agenda
-- traktuje inaczej.
SELECT pg_temp.act_as('e0000000-0000-0000-0000-0000000000a1',
                      '11111111-1111-1111-1111-111111111111');
SELECT public.admin_event_session_save(jsonb_build_object(
  'event_id', 'e5000000-0000-0000-0000-0000000000a1',
  'title_pl', 'Kolacja zamknieta', 'title_en', 'Closed dinner',
  'starts_at', '2026-09-01 19:00+02', 'ends_at', '2026-09-01 20:30+02',
  'is_private', true, 'requires_signup', true, 'status', 'published'));
SELECT public.admin_event_session_save(jsonb_build_object(
  'event_id', 'e5000000-0000-0000-0000-0000000000a1',
  'title_pl', 'Punkt odwolany', 'title_en', 'Cancelled item',
  'starts_at', '2026-09-02 18:00+02', 'ends_at', '2026-09-02 19:00+02',
  'status', 'cancelled'));
-- Sesja OPUBLIKOWANA w wydarzeniu ROBOCZYM - nie jest trescia publiczna.
SELECT public.admin_event_session_save(jsonb_build_object(
  'event_id', 'e5000000-0000-0000-0000-0000000000a2',
  'title_pl', 'Sesja w szkicu', 'title_en', 'Session in draft',
  'starts_at', '2026-09-01 09:00+02', 'ends_at', '2026-09-01 10:00+02',
  'status', 'published'));

-- Obsada najemcy B, zeby agenda B nie byla pusta (kontrapunkt izolacji).
INSERT INTO public.event_sessions (
  id, tenant_id, event_id, room_id, track_id, title_pl, title_en,
  starts_at, ends_at, status
) VALUES (
  'bb000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
  'e5000000-0000-0000-0000-0000000000b1', 'a6000000-0000-0000-0000-0000000000b1',
  'a7000000-0000-0000-0000-0000000000b1', 'Sesja obca', 'Foreign session',
  '2026-09-01 09:00+02', '2026-09-01 10:00+02', 'published');
INSERT INTO public.event_session_speakers (tenant_id, event_id, session_id, speaker_profile_id)
VALUES ('22222222-2222-2222-2222-222222222222', 'e5000000-0000-0000-0000-0000000000b1',
        'bb000000-0000-0000-0000-000000000001', '59000000-0000-0000-0000-0000000000b1');

SELECT pg_temp.act_as(NULL, '11111111-1111-1111-1111-111111111111');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_agenda('agenda-kongres')
    WHERE status = 'draft') = 0
  AND (SELECT count(*) FROM public.event_agenda('agenda-kongres')
        WHERE title_pl = 'Kolacja zamknieta') = 0,
  '10/sesje: agenda publiczna nie oddaje sesji roboczych ani zamknietych');

SELECT pg_temp.assert(
  (SELECT access_state FROM public.event_agenda('agenda-kongres')
    WHERE title_pl = 'Punkt odwolany') = 'cancelled',
  '10/sesje: sesja ODWOLANA zostaje w agendzie z access_state = cancelled');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_agenda('agenda-szkic')) = 0,
  '10/sesje: agenda wydarzenia ROBOCZEGO jest pusta, mimo sesji opublikowanej');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_agenda('nie-ma-takiego-wydarzenia')) = 0,
  '10/sesje: agenda nieistniejacego wydarzenia jest pusta, a nie bledna');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_agenda('agenda-kongres')
    WHERE title_pl = 'Otwarcie' AND access_state = 'open') = 1,
  '10/sesje: sesja bez zapisow ma access_state = open');

SELECT pg_temp.assert(
  (SELECT access_state FROM public.event_agenda('agenda-kongres')
    WHERE title_pl = 'Zero miejsc') = 'full',
  '10/sesje: sesja z zajetymi wszystkimi miejscami ma access_state = full');

SELECT pg_temp.assert(
  (SELECT access_state FROM public.event_agenda('agenda-kongres')
    WHERE title_pl = 'Sesja dla Pro') = 'tier_required',
  '10/sesje: prog warstwy daje access_state = tier_required dla anonima');

-- Adresow transmisji w agendzie NIE MA - i to jest kontrakt typu zwracanego,
-- nie tylko dobra wola zapytania.
SELECT pg_temp.assert_raises_like(
  $q$SELECT stream_url FROM public.event_agenda('agenda-kongres')$q$,
  'stream_url',
  '10/sesje: agenda publiczna nie ma kolumny stream_url (adres nie wychodzi)');

-- Obsada w agendzie: tylko profile PUBLICZNE.
SELECT pg_temp.assert(
  (SELECT jsonb_array_length(speakers) FROM public.event_agenda('agenda-kongres')
    WHERE title_pl = 'Otwarcie') = 1,
  '10/sesje: agenda oddaje obsade tylko z profili publicznych (is_public)');

-- Zapisany widzi swoj stan; sesja zamknieta staje sie dla niego widoczna.
SELECT pg_temp.act_as('e0000000-0000-0000-0000-0000000000a1',
                      '11111111-1111-1111-1111-111111111111');
SELECT public.admin_event_session_signup_set(jsonb_build_object(
  'session_id', (SELECT id FROM public.event_sessions WHERE title_pl = 'Kolacja zamknieta'),
  'user_id', 'c0000000-0000-0000-0000-0000000000a1'));

SELECT pg_temp.act_as('c0000000-0000-0000-0000-0000000000a1',
                      '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert(
  (SELECT access_state FROM public.event_agenda('agenda-kongres')
    WHERE title_pl = 'Kolacja zamknieta') = 'signed_up',
  '10/sesje: zapisany widzi sesje ZAMKNIETA z access_state = signed_up (kontrapunkt)');

SELECT pg_temp.act_as('c0000000-0000-0000-0000-0000000000a3',
                      '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_agenda('agenda-kongres')
    WHERE title_pl = 'Kolacja zamknieta') = 0,
  '10/sesje: uczestnik BEZ zapisu nie widzi sesji zamknietej');

-- ---------------------------------------------------------------------------
-- 10. IZOLACJA NAJEMCOW - NAJWAZNIEJSZA CZESC TEGO PLIKU
--
-- Dwa najemce, TO SAMO wywolanie, dwa rozlaczne zbiory wierszy - i za kazdym
-- razem KONTRAPUNKT, ze wlasne wiersze sa widoczne. Bez kontrapunktu test nie
-- odroznia izolacji od blokady: przy odmowie wszystkiego obie polowy
-- przechodza na pustym wyniku.
--
-- Plaszczyzna TRESCI (`event_agenda`, `event_session_access`) skaluje sie po
-- `public_tenant_id()`, czyli po GUC `nes.public_tenant` - dlatego tu, i tylko
-- tu, przestawiamy go wprost. Plaszczyzna PANELU stoi na tenancie DOMOWYM
-- z `profiles`, wiec dla niej wystarcza zmiana aktora.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as(NULL, '11111111-1111-1111-1111-111111111111');
SELECT set_config('nes.public_tenant', '11111111-1111-1111-1111-111111111111', false);

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_agenda('agenda-kongres')
    WHERE title_pl = 'Sesja obca') = 0,
  '10/izolacja: agenda najemcy A nie oddaje ANI JEDNEGO wiersza najemcy B');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_agenda('agenda-kongres')
    WHERE title_pl = 'Otwarcie') = 1,
  '10/izolacja: agenda najemcy A oddaje SWOJE wiersze (kontrapunkt strony A)');

SELECT set_config('nes.public_tenant', '22222222-2222-2222-2222-222222222222', false);

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_agenda('agenda-kongres')
    WHERE title_pl <> 'Sesja obca') = 0,
  '10/izolacja: agenda najemcy B nie oddaje ANI JEDNEGO wiersza najemcy A');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_agenda('agenda-kongres')
    WHERE title_pl = 'Sesja obca') = 1,
  '10/izolacja: agenda najemcy B oddaje SWOJ wiersz (kontrapunkt strony B)');

-- Obsada w agendzie B: prelegent B, nigdy prelegent A.
SELECT pg_temp.assert(
  (SELECT speakers->0->>'display_name' FROM public.event_agenda('agenda-kongres')
    WHERE title_pl = 'Sesja obca') = 'Prelegent B1',
  '10/izolacja: obsada w agendzie B jest z najemcy B, nie z A');

-- `event_session_access` - ta sama funkcja, sesja obcego najemcy.
SELECT pg_temp.assert(
  (public.event_session_access('aa000000-0000-0000-0000-000000000001')->>'reason') = 'not_found',
  '10/izolacja: event_session_access w najemcy B nie widzi sesji najemcy A');

SELECT set_config('nes.public_tenant', '11111111-1111-1111-1111-111111111111', false);

SELECT pg_temp.assert(
  (public.event_session_access('bb000000-0000-0000-0000-000000000001')->>'reason') = 'not_found',
  '10/izolacja: event_session_access w najemcy A nie widzi sesji najemcy B');

SELECT pg_temp.assert(
  (public.event_session_access('aa000000-0000-0000-0000-000000000001')->>'reason') = 'granted',
  '10/izolacja: event_session_access oddaje SWOJA sesje (kontrapunkt)');

-- Panel: kazda funkcja listujaca po kolei. Redaktor A z identyfikatorem
-- wydarzenia najemcy B musi dostac PUSTO, a nie wiersze.
SELECT pg_temp.act_as('e0000000-0000-0000-0000-0000000000a1',
                      '11111111-1111-1111-1111-111111111111');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_tracks_list('e5000000-0000-0000-0000-0000000000b1')) = 0,
  '10/izolacja: admin_event_tracks_list nie oddaje sciezek obcego najemcy');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_rooms_list('e5000000-0000-0000-0000-0000000000b1')) = 0,
  '10/izolacja: admin_event_rooms_list nie oddaje sal obcego najemcy');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_sessions_list('e5000000-0000-0000-0000-0000000000b1')) = 0,
  '10/izolacja: admin_event_sessions_list nie oddaje sesji obcego najemcy');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_session_detail(
     'bb000000-0000-0000-0000-000000000001')) = 0,
  '10/izolacja: admin_event_session_detail nie oddaje sesji obcego najemcy');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_session_signups_list(
     'bb000000-0000-0000-0000-000000000001')) = 0,
  '10/izolacja: admin_event_session_signups_list nie oddaje zapisow obcego najemcy');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_agenda_conflicts(
     'e5000000-0000-0000-0000-0000000000b1')) = 0,
  '10/izolacja: admin_event_agenda_conflicts nie raportuje agendy obcego najemcy');

-- Kontrapunkty: redaktor B widzi SWOJE wiersze tymi samymi funkcjami.
SELECT pg_temp.act_as('e0000000-0000-0000-0000-0000000000b1',
                      '22222222-2222-2222-2222-222222222222');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_tracks_list('e5000000-0000-0000-0000-0000000000b1')) = 1
  AND (SELECT count(*) FROM public.admin_event_rooms_list('e5000000-0000-0000-0000-0000000000b1')) = 1
  AND (SELECT count(*) FROM public.admin_event_sessions_list('e5000000-0000-0000-0000-0000000000b1')) = 1
  AND (SELECT count(*) FROM public.admin_event_session_detail('bb000000-0000-0000-0000-000000000001')) = 1,
  '10/izolacja: redaktor B widzi SWOJE sciezki, sale, sesje i detal (kontrapunkt)');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_sessions_list('e5000000-0000-0000-0000-0000000000a1')) = 0,
  '10/izolacja: redaktor B nie widzi ANI JEDNEJ sesji najemcy A');

-- Redaktor B nie zapisze sesji w wydarzeniu najemcy A.
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_session_save(jsonb_build_object(
       'event_id', 'e5000000-0000-0000-0000-0000000000a1',
       'title_pl', 'Wtargniecie', 'title_en', 'Intrusion',
       'starts_at', '2026-09-01 09:00+02', 'ends_at', '2026-09-01 10:00+02'))$q$,
  'not_found',
  '10/izolacja: redaktor B nie zapisze sesji w wydarzeniu najemcy A');

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_session_speakers_set(jsonb_build_object(
       'session_id', 'aa000000-0000-0000-0000-000000000001',
       'speakers', jsonb_build_array(
         jsonb_build_object('speaker_profile_id',
                            '59000000-0000-0000-0000-0000000000b1'))))$q$,
  'not_found',
  '10/izolacja: redaktor B nie obsadzi sesji najemcy A');

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_session_delete('aa000000-0000-0000-0000-000000000001')$q$,
  'not_found',
  '10/izolacja: redaktor B nie usunie sesji najemcy A');

-- IZOLACJA NA POZIOMIE POLITYK RLS, nie tylko funkcji SECURITY DEFINER.
-- RLS nie obowiazuje superuzytkownika, wiec bez `SET ROLE` te asercje
-- przechodzilyby ZAWSZE.
SELECT pg_temp.act_as('e0000000-0000-0000-0000-0000000000a1',
                      '11111111-1111-1111-1111-111111111111');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sessions
    WHERE tenant_id = '22222222-2222-2222-2222-222222222222') = 0
  AND (SELECT count(*) FROM public.event_tracks
        WHERE tenant_id = '22222222-2222-2222-2222-222222222222') = 0
  AND (SELECT count(*) FROM public.event_rooms
        WHERE tenant_id = '22222222-2222-2222-2222-222222222222') = 0
  AND (SELECT count(*) FROM public.event_session_speakers
        WHERE tenant_id = '22222222-2222-2222-2222-222222222222') = 0,
  '10/izolacja: RLS - redaktor A nie widzi ANI JEDNEGO wiersza najemcy B na czterech tabelach');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sessions
    WHERE tenant_id = '11111111-1111-1111-1111-111111111111') > 0,
  '10/izolacja: RLS - redaktor A widzi SWOJE sesje (kontrapunkt dla RLS)');
RESET ROLE;

-- DWIE PLASZCZYZNY SUMUJA SIE DLA ZALOGOWANEGO. Polityki `..._public_read`
-- i `..._staff_read` sa alternatywa, wiec redaktor B wchodzacy na DOMENE A
-- zobaczy opublikowana agende A - i to nie jest wyciek, tylko tresc publiczna
-- tej domeny. Granica najemcy jest wiec granica NAGLOWKA, a nie roli: zeby
-- zmierzyc izolacje, trzeba przestawic OBA GUC-i, `nes.tenant` (plaszczyzna
-- redakcyjna) i `nes.public_tenant` (plaszczyzna tresci). Asercja bez tego
-- przestawienia byla by czerwona z poprawnego powodu - i to sprawdzilismy.
SELECT pg_temp.act_as('e0000000-0000-0000-0000-0000000000b1',
                      '22222222-2222-2222-2222-222222222222');
SELECT set_config('nes.public_tenant', '22222222-2222-2222-2222-222222222222', false);
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sessions
    WHERE tenant_id = '11111111-1111-1111-1111-111111111111') = 0
  AND (SELECT count(*) FROM public.event_sessions
        WHERE tenant_id = '22222222-2222-2222-2222-222222222222') = 1,
  '10/izolacja: RLS - redaktor B na domenie B nie widzi sesji A, widzi swoja');
RESET ROLE;
SELECT set_config('nes.public_tenant', '11111111-1111-1111-1111-111111111111', false);

-- Uczestnik widzi WLASNY zapis i ani jednego cudzego.
SELECT pg_temp.act_as('c0000000-0000-0000-0000-0000000000a2',
                      '11111111-1111-1111-1111-111111111111');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_session_signups) > 0
  AND (SELECT count(*) FROM public.event_session_signups
        WHERE user_id <> 'c0000000-0000-0000-0000-0000000000a2') = 0,
  '10/izolacja: RLS - uczestnik widzi wylacznie SWOJE zapisy na sesje');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 11. GRANTY: SEKRET NIE WYCHODZI, ZAPIS WPROST NIE WCHODZI
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as(NULL, '11111111-1111-1111-1111-111111111111');
SET ROLE anon;
SELECT pg_temp.assert_raises_like(
  $q$SELECT stream_url FROM public.event_sessions LIMIT 1$q$,
  'permission denied',
  '10/sesje: anon nie ma grantu kolumnowego na stream_url');
SELECT pg_temp.assert_raises_like(
  $q$SELECT recording_url FROM public.event_sessions LIMIT 1$q$,
  'permission denied',
  '10/sesje: anon nie ma grantu kolumnowego na recording_url');
SELECT pg_temp.assert_raises_like(
  $q$SELECT count(*) FROM public.event_session_signups$q$,
  'permission denied',
  '10/sesje: anon nie ma grantu na tabele zapisow na sesje');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sessions
    WHERE title_pl = 'Otwarcie') = 1,
  '10/sesje: anon widzi kolumny publiczne opublikowanej sesji (kontrapunkt grantu)');
RESET ROLE;

SELECT pg_temp.act_as('e0000000-0000-0000-0000-0000000000a1',
                      '11111111-1111-1111-1111-111111111111');
SET ROLE authenticated;
SELECT pg_temp.assert_raises_like(
  $q$INSERT INTO public.event_sessions
       (tenant_id, event_id, title_pl, title_en, starts_at, ends_at)
     VALUES ('11111111-1111-1111-1111-111111111111',
             'e5000000-0000-0000-0000-0000000000a1', 'Wprost', 'Direct',
             '2026-09-01 17:00+02', '2026-09-01 18:00+02')$q$,
  'permission denied',
  '10/sesje: redaktor nie zapisze sesji wprost, omijajac RPC');
SELECT pg_temp.assert_raises_like(
  $q$INSERT INTO public.event_tracks (tenant_id, event_id, key, name_pl, name_en)
     VALUES ('11111111-1111-1111-1111-111111111111',
             'e5000000-0000-0000-0000-0000000000a1', 'wprost', 'Wprost', 'Direct')$q$,
  'permission denied',
  '10/sesje: redaktor nie zapisze sciezki wprost');
SELECT pg_temp.assert_raises_like(
  $q$INSERT INTO public.event_rooms (tenant_id, event_id, name)
     VALUES ('11111111-1111-1111-1111-111111111111',
             'e5000000-0000-0000-0000-0000000000a1', 'Sala Wprost')$q$,
  'permission denied',
  '10/sesje: redaktor nie zapisze sali wprost');
SELECT pg_temp.assert_raises_like(
  $q$INSERT INTO public.event_session_speakers
       (tenant_id, event_id, session_id, speaker_profile_id)
     VALUES ('11111111-1111-1111-1111-111111111111',
             'e5000000-0000-0000-0000-0000000000a1',
             'aa000000-0000-0000-0000-000000000001',
             '59000000-0000-0000-0000-0000000000a2')$q$,
  'permission denied',
  '10/sesje: redaktor nie zapisze obsady wprost');
SELECT pg_temp.assert_raises_like(
  $q$INSERT INTO public.event_session_signups (tenant_id, event_id, session_id, user_id)
     VALUES ('11111111-1111-1111-1111-111111111111',
             'e5000000-0000-0000-0000-0000000000a1',
             'aa000000-0000-0000-0000-000000000001',
             'c0000000-0000-0000-0000-0000000000a1')$q$,
  'permission denied',
  '10/sesje: nikt nie zapisze wiersza zapisu wprost, omijajac blokade wiersza');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 12. BRAMKA ROLI PANELU
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('c0000000-0000-0000-0000-0000000000a1',
                      '11111111-1111-1111-1111-111111111111');
-- ---------------------------------------------------------------------------
-- AGENDA JEST ADMINISTRACYJNA. Decyzja wlasciciela produktu z 2026-08-24:
-- szesc podmodulow (agenda, zapisy, sponsorzy, obsluga na miejscu, regulaminy,
-- gielda spotkan) przestaje byc dostepnych dla roli `editor`. Migracja
-- 20260824090000 zamyka to w bazie, a nie w ekranie - komponent React
-- zatrzymuje tylko tego, kto go widzi, a RPC mozna zawolac z konsoli.
--
-- BEZ TEJ ASERCJI ZMIANA NIE MIALABY TESTU. Aktor ma role `editor` i nic poza
-- nia: gdyby bramka wrocila kiedys do `assert_editor_tenant()` w starym
-- znaczeniu, ten wiersz zrobi sie czerwony, a nie przejdzie po cichu.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('e0000000-0000-0000-0000-00000000000e',
                      '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert_raises_like(
  $q$SELECT count(*) FROM public.admin_event_sessions_list(
       'e5000000-0000-0000-0000-0000000000a1')$q$,
  'admin role required',
  '10/sesje/ROLA: REDAKTOR nie wchodzi do panelu agendy - podmodul jest administracyjny');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_session_save(jsonb_build_object(
       'event_id','e5000000-0000-0000-0000-0000000000a1',
       'title_pl','Proba','title_en','Attempt',
       'starts_at', now()::text, 'ends_at', (now() + interval '1 hour')::text))$q$,
  'admin role required',
  '10/sesje/ROLA: REDAKTOR nie zapisze sesji - odmowa dotyczy takze zapisu, nie tylko odczytu');

SELECT pg_temp.act_as('c0000000-0000-0000-0000-0000000000a1',
                      '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert_raises_like(
  $q$SELECT count(*) FROM public.admin_event_sessions_list(
       'e5000000-0000-0000-0000-0000000000a1')$q$,
  'admin role required',
  '10/sesje: uczestnik bez roli redakcyjnej nie wchodzi do panelu agendy');

SELECT pg_temp.act_as(NULL, '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert_raises_like(
  $q$SELECT count(*) FROM public.admin_event_sessions_list(
       'e5000000-0000-0000-0000-0000000000a1')$q$,
  'authentication required',
  '10/sesje: anonim nie wchodzi do panelu agendy');

-- ---------------------------------------------------------------------------
-- 13. DOSTEP DO TRANSMISJI I NAGRANIA
--
-- Dwa zasoby, dwie rozne bramki: transmisja wymaga rangi warstwy I zapisu,
-- nagranie tylko rangi warstwy.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('e0000000-0000-0000-0000-0000000000a1',
                      '11111111-1111-1111-1111-111111111111');
SELECT public.admin_event_session_save(jsonb_build_object(
  'event_id', 'e5000000-0000-0000-0000-0000000000a1',
  'title_pl', 'Transmisja', 'title_en', 'Live',
  'starts_at', '2026-09-02 17:00+02', 'ends_at', '2026-09-02 18:00+02',
  'format', 'online', 'requires_signup', true, 'status', 'published',
  'stream_url', 'https://stream.example.org/a',
  'recording_url', 'https://vod.example.org/a'));

SELECT pg_temp.assert(
  (SELECT has_stream AND has_recording FROM public.admin_event_sessions_list(
     'e5000000-0000-0000-0000-0000000000a1') WHERE title_pl = 'Transmisja'),
  '10/sesje: lista panelu oddaje FLAGI transmisji i nagrania');

SELECT pg_temp.assert(
  (SELECT stream_url FROM public.admin_event_session_detail(
     (SELECT id FROM public.event_sessions WHERE title_pl = 'Transmisja')))
    = 'https://stream.example.org/a',
  '10/sesje: detal panelu oddaje ADRES transmisji (formularz edytuje wartosc)');

SELECT pg_temp.assert_raises_like(
  $q$SELECT stream_url FROM public.admin_event_sessions_list(
       'e5000000-0000-0000-0000-0000000000a1')$q$,
  'stream_url',
  '10/sesje: lista panelu nie ma kolumny stream_url (mniej miejsc z sekretem)');

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_session_save(jsonb_build_object(
       'event_id', 'e5000000-0000-0000-0000-0000000000a1',
       'title_pl', 'Niebezpieczna', 'title_en', 'Unsafe',
       'starts_at', '2026-09-02 19:00+02', 'ends_at', '2026-09-02 19:30+02',
       'stream_url', 'http://niebezpieczny.example.org'))$q$,
  'invalid_stream_url',
  '10/sesje: adres transmisji bez https jest odrzucany przez RPC');

SELECT pg_temp.assert_raises_like(
  $q$UPDATE public.event_sessions SET stream_url = 'http://wprost.example.org'
     WHERE id = 'aa000000-0000-0000-0000-000000000001'$q$,
  'event_sessions_stream_url_https',
  '10/sesje: CHECK odrzuca adres transmisji bez https takze przy zapisie wprost');

SELECT pg_temp.act_as('c0000000-0000-0000-0000-0000000000a3',
                      '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert(
  (public.event_session_access(
     (SELECT id FROM public.event_sessions WHERE title_pl = 'Transmisja'))
   ->>'can_stream')::boolean = false,
  '10/sesje: bez zapisu transmisja jest zamknieta');

SELECT pg_temp.assert(
  (public.event_session_access(
     (SELECT id FROM public.event_sessions WHERE title_pl = 'Transmisja'))
   ->>'recording_url') = 'https://vod.example.org/a',
  '10/sesje: nagranie jest dostepne BEZ zapisu (doktryna rozdzielenia zasobow)');

SELECT pg_temp.assert(
  (public.event_session_access(
     (SELECT id FROM public.event_sessions WHERE title_pl = 'Transmisja'))
   ->>'stream_url') IS NULL,
  '10/sesje: adres transmisji nie wychodzi w odpowiedzi dla osoby bez zapisu');

SELECT public.event_session_signup(jsonb_build_object(
  'session_id', (SELECT id FROM public.event_sessions WHERE title_pl = 'Transmisja')));

SELECT pg_temp.assert(
  (public.event_session_access(
     (SELECT id FROM public.event_sessions WHERE title_pl = 'Transmisja'))
   ->>'stream_url') = 'https://stream.example.org/a',
  '10/sesje: po zapisie adres transmisji wychodzi (kontrapunkt)');

-- Prog warstwy zamyka OBA zasoby.
SELECT pg_temp.act_as('c0000000-0000-0000-0000-0000000000a3',
                      '11111111-1111-1111-1111-111111111111', 0);
SELECT pg_temp.assert(
  (public.event_session_access(
     (SELECT id FROM public.event_sessions WHERE title_pl = 'Sesja dla Pro'))
   ->>'reason') = 'tier_required',
  '10/sesje: prog warstwy zamyka dostep do sesji przed pytaniem o zapis');

-- ---------------------------------------------------------------------------
-- 14. KOLEJNOSC, STATUSY WSADOWE, SZYNA ZDARZEN
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('e0000000-0000-0000-0000-0000000000a1',
                      '11111111-1111-1111-1111-111111111111');

SELECT pg_temp.assert(
  public.admin_event_sessions_reorder(jsonb_build_object(
    'items', jsonb_build_array(jsonb_build_object(
      'id', 'aa000000-0000-0000-0000-000000000001', 'sort_order', 5)))) = 1,
  '10/sesje: wsadowa zmiana kolejnosci raportuje jeden przestawiony wiersz');

SELECT pg_temp.assert(
  (SELECT sort_order FROM public.event_sessions
    WHERE id = 'aa000000-0000-0000-0000-000000000001') = 5,
  '10/sesje: wsadowa zmiana kolejnosci przestawia dokladnie wskazany wiersz');

SELECT pg_temp.assert(
  public.admin_event_sessions_reorder(jsonb_build_object(
    'items', jsonb_build_array(jsonb_build_object(
      'id', 'bb000000-0000-0000-0000-000000000001', 'sort_order', 1)))) = 0,
  '10/sesje: obce id w payloadzie kolejnosci jest pomijane, a nie wykonywane');

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_sessions_reorder(jsonb_build_object('items', 'nie-tablica'))$q$,
  'invalid_payload',
  '10/sesje: kolejnosc podana nie-tablica jest odrzucana');

-- Publikacja wsadowa: liczba zmienionych wierszy, stempel i zdarzenie domenowe.
SELECT pg_temp.assert(
  public.admin_event_sessions_set_status(jsonb_build_object(
    'ids', jsonb_build_array('aa000000-0000-0000-0000-000000000091',
                             'aa000000-0000-0000-0000-000000000092'),
    'status', 'published')) = 2,
  '10/sesje: publikacja wsadowa zmienia dokladnie wskazane sesje');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sessions
    WHERE id IN ('aa000000-0000-0000-0000-000000000091',
                 'aa000000-0000-0000-0000-000000000092')
      AND status = 'published' AND published_at IS NOT NULL) = 2,
  '10/sesje: publikacja stempluje published_at');

SELECT pg_temp.assert(
  public.admin_event_sessions_set_status(jsonb_build_object(
    'ids', jsonb_build_array('aa000000-0000-0000-0000-000000000091',
                             'aa000000-0000-0000-0000-000000000092'),
    'status', 'published')) = 0,
  '10/sesje: powtorna publikacja tych samych sesji nie zmienia niczego (idempotencja)');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.domain_events
    WHERE aggregate_type = 'event_session'
      AND event_type = 'event_session.published.v1'
      AND aggregate_id IN ('aa000000-0000-0000-0000-000000000091',
                           'aa000000-0000-0000-0000-000000000092')) = 2,
  '10/sesje: publikacja emituje zdarzenie domenowe event_session.published.v1');

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_sessions_set_status(jsonb_build_object(
       'ids', jsonb_build_array('aa000000-0000-0000-0000-000000000091'),
       'status', 'archiwum'))$q$,
  'invalid_status',
  '10/sesje: status poza katalogiem trzech wartosci jest odrzucany');

-- Odwolanie wsadowe stempluje cancelled_at i emituje wlasne zdarzenie.
SELECT pg_temp.assert(
  public.admin_event_sessions_set_status(jsonb_build_object(
    'ids', jsonb_build_array('aa000000-0000-0000-0000-000000000092'),
    'status', 'cancelled')) = 1,
  '10/sesje: odwolanie wsadowe zmienia wskazana sesje');

SELECT pg_temp.assert(
  (SELECT cancelled_at IS NOT NULL FROM public.event_sessions
    WHERE id = 'aa000000-0000-0000-0000-000000000092')
  AND (SELECT count(*) FROM public.domain_events
        WHERE event_type = 'event_session.cancelled.v1'
          AND aggregate_id = 'aa000000-0000-0000-0000-000000000092') = 1,
  '10/sesje: odwolanie wsadowe stempluje cancelled_at i emituje zdarzenie');

-- ---------------------------------------------------------------------------
-- 14b. FILTRY LISTY PANELU I WALIDACJA PAYLOADU
--
-- Filtr, ktory nie filtruje, jest gorszy od braku filtru: panel pokazuje
-- pelna liste i twierdzi, ze jest zawezona. Kazdy z czterech parametrow
-- `admin_event_sessions_list` ma wiec asercje ZAWEZAJACA i - dla statusu -
-- kontrapunkt na wartosci `all`.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_sessions_list(
     'e5000000-0000-0000-0000-0000000000a1', NULL, NULL, 'published')) <
  (SELECT count(*) FROM public.admin_event_sessions_list(
     'e5000000-0000-0000-0000-0000000000a1', NULL, NULL, 'all')),
  '10/sesje: filtr statusu na liscie panelu naprawde zaweza wynik');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_sessions_list(
     'e5000000-0000-0000-0000-0000000000a1', NULL, NULL, NULL) ) =
  (SELECT count(*) FROM public.admin_event_sessions_list(
     'e5000000-0000-0000-0000-0000000000a1', NULL, NULL, 'all')),
  '10/sesje: brak filtru statusu znaczy to samo co all');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_sessions_list(
     'e5000000-0000-0000-0000-0000000000a1',
     (SELECT id FROM public.event_tracks WHERE key = 'cyber')) ) = 1,
  '10/sesje: filtr sciezki oddaje tylko sesje tej sciezki');

-- W Sali Warszawa siedza trzy sesje: dwie opublikowane styk w styk i jedna
-- odwolana (ta, ktora wolno bylo nalozyc). Filtr sali nie patrzy na status,
-- wiec liczba jest trzy - i wlasnie ta liczba odroznia filtr dzialajacy od
-- filtru, ktory oddaje cala agende.
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_sessions_list(
     'e5000000-0000-0000-0000-0000000000a1', NULL,
     'a6000000-0000-0000-0000-000000000001')) = 3
  AND (SELECT count(*) FROM public.admin_event_sessions_list(
        'e5000000-0000-0000-0000-0000000000a1', NULL,
        'a6000000-0000-0000-0000-000000000002')) = 2,
  '10/sesje: filtr sali oddaje tylko sesje z tej sali');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_sessions_list(
     'e5000000-0000-0000-0000-0000000000a1', NULL, NULL, 'all', 'Otwarcie')) = 1
  AND (SELECT count(*) FROM public.admin_event_sessions_list(
        'e5000000-0000-0000-0000-0000000000a1', NULL, NULL, 'all',
        'nie-ma-takiego-tytulu')) = 0,
  '10/sesje: szukanie po frazie zaweza liste i nie oddaje nic na brak trafienia');

-- Liczby wyliczane: minuty trwania sesji i minuty zajetosci sali. Obie sa
-- policzone z przedzialow, wiec obie da sie zlamac zmiana wzoru.
SELECT pg_temp.assert(
  (SELECT duration_minutes FROM public.admin_event_sessions_list(
     'e5000000-0000-0000-0000-0000000000a1') WHERE title_pl = 'Otwarcie') = 60,
  '10/sesje: lista panelu liczy dlugosc sesji w minutach');

SELECT pg_temp.assert(
  (SELECT booked_minutes FROM public.admin_event_rooms_list(
     'e5000000-0000-0000-0000-0000000000a1')
    WHERE id = 'a6000000-0000-0000-0000-000000000001') = 120,
  '10/sesje: lista sal liczy sume minut zajetosci sali');

SELECT pg_temp.assert(
  (SELECT sessions_count FROM public.admin_event_tracks_list(
     'e5000000-0000-0000-0000-0000000000a1')
    WHERE key = 'cyber') = 1,
  '10/sesje: lista sciezek liczy sesje przypisane do sciezki');

-- Walidacja payloadu zapisu sesji: cztery odmowy, kazda z wlasnym kodem.
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_session_save(jsonb_build_object(
       'event_id', 'e5000000-0000-0000-0000-0000000000a1',
       'title_pl', 'Zly format', 'title_en', 'Bad format',
       'starts_at', '2026-09-02 07:00+02', 'ends_at', '2026-09-02 07:30+02',
       'format', 'teleportacja'))$q$,
  'invalid_format',
  '10/sesje: format sesji poza katalogiem trzech wartosci jest odrzucany');

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_session_save(jsonb_build_object(
       'event_id', 'e5000000-0000-0000-0000-0000000000a1',
       'title_pl', 'Zly status', 'title_en', 'Bad status',
       'starts_at', '2026-09-02 07:00+02', 'ends_at', '2026-09-02 07:30+02',
       'status', 'archiwum'))$q$,
  'invalid_status',
  '10/sesje: status sesji poza katalogiem trzech wartosci jest odrzucany');

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_session_save(jsonb_build_object(
       'event_id', 'e5000000-0000-0000-0000-0000000000a1',
       'title_pl', 'Odwrotnie', 'title_en', 'Backwards',
       'starts_at', '2026-09-02 09:00+02', 'ends_at', '2026-09-02 08:00+02'))$q$,
  'invalid_times',
  '10/sesje: koniec sesji przed jej poczatkiem jest odrzucany');

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_session_save(jsonb_build_object(
       'event_id', 'e5000000-0000-0000-0000-0000000000a1',
       'title_pl', 'Bez angielskiego',
       'starts_at', '2026-09-02 07:00+02', 'ends_at', '2026-09-02 07:30+02'))$q$,
  'invalid_titles',
  '10/sesje: nowa sesja bez obu tytulow jest odrzucana');

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_session_save(jsonb_build_object(
       'title_pl', 'Bez wydarzenia', 'title_en', 'No event',
       'starts_at', '2026-09-02 07:00+02', 'ends_at', '2026-09-02 07:30+02'))$q$,
  'invalid_event',
  '10/sesje: sesja bez wskazanego wydarzenia jest odrzucana');

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_session_save(jsonb_build_object(
       'event_id', 'e5000000-0000-0000-0000-0000000000a1',
       'title_pl', 'Ujemna ranga', 'title_en', 'Negative rank',
       'starts_at', '2026-09-02 07:00+02', 'ends_at', '2026-09-02 07:30+02',
       'min_tier_rank', -1))$q$,
  'invalid_tier_rank',
  '10/sesje: ujemny prog warstwy jest odrzucany');

-- Wylaczenie sciezki (`is_active = false`) jest OZNACZENIEM, nie usunieciem:
-- sesje juz przypisane zostaja, a lista panelu nadal je pokazuje. Gdyby
-- wylaczenie kasowalo przypisania, redaktor tracilby agende jednym klikiem.
SELECT public.admin_event_track_save(jsonb_build_object(
  'id', (SELECT id FROM public.event_tracks WHERE key = 'cyber'),
  'name_pl', 'Cyberbezpieczenstwo', 'name_en', 'Cybersecurity',
  'is_active', false));

SELECT pg_temp.assert(
  (SELECT NOT is_active AND sessions_count = 1
     FROM public.admin_event_tracks_list('e5000000-0000-0000-0000-0000000000a1')
    WHERE key = 'cyber'),
  '10/sesje: wylaczenie sciezki nie odpina od niej sesji');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sessions
    WHERE track_id = (SELECT id FROM public.event_tracks WHERE key = 'cyber')) = 1,
  '10/sesje: sesja zostaje przypisana do wylaczonej sciezki');

-- ---------------------------------------------------------------------------
-- 15. USUWANIE: CO JEST CHRONIONE PRZED KASKADA
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_raises_like(
  format($q$SELECT public.admin_event_session_delete(%L)$q$,
         (SELECT id FROM public.event_sessions WHERE title_pl = 'Panel rownolegly')),
  'session_has_signups',
  '10/sesje: sesji z zapisami nie da sie usunac (droga to odwolanie)');

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_room_delete('a6000000-0000-0000-0000-000000000001')$q$,
  'room_in_use',
  '10/sesje: sali w uzyciu nie da sie usunac');

SELECT pg_temp.assert_raises_like(
  format($q$SELECT public.admin_event_track_delete(%L)$q$,
         (SELECT id FROM public.event_tracks WHERE key = 'cyber')),
  'track_in_use',
  '10/sesje: sciezki w uzyciu nie da sie usunac');

-- Obnizenie pojemnosci sali ponizej limitu sesji, ktore z niej korzystaja.
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_room_save(jsonb_build_object(
       'id', 'a6000000-0000-0000-0000-000000000002',
       'name', 'Sala Krakow', 'capacity', 5))$q$,
  'capacity_below_sessions',
  '10/sesje: pojemnosci sali nie da sie obnizyc ponizej limitu miejsc sesji');

-- Sesja BEZ zapisow da sie usunac - kontrapunkt, ktory odroznia ochrone
-- od blokady wszystkiego.
SELECT pg_temp.assert(
  public.admin_event_session_delete('aa000000-0000-0000-0000-000000000092'),
  '10/sesje: sesje bez zapisow da sie usunac (kontrapunkt)');

-- To samo dla sali i sciezki NIEUZYWANEJ: odmowa dotyczy uzycia, nie operacji.
SELECT public.admin_event_room_save(jsonb_build_object(
  'event_id', 'e5000000-0000-0000-0000-0000000000a1', 'name', 'Foyer Puste'));
SELECT pg_temp.assert(
  public.admin_event_room_delete(
    (SELECT id FROM public.event_rooms WHERE name = 'Foyer Puste')),
  '10/sesje: sale bez sesji da sie usunac (kontrapunkt dla room_in_use)');

SELECT public.admin_event_track_save(jsonb_build_object(
  'event_id', 'e5000000-0000-0000-0000-0000000000a1',
  'key', 'klimat', 'name_pl', 'Klimat', 'name_en', 'Climate'));
SELECT pg_temp.assert(
  public.admin_event_track_delete(
    (SELECT id FROM public.event_tracks WHERE key = 'klimat')),
  '10/sesje: sciezke bez sesji da sie usunac (kontrapunkt dla track_in_use)');

-- Kaskada wydarzenia: cala agenda ginie razem z wydarzeniem.
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sessions
    WHERE event_id = 'e5000000-0000-0000-0000-0000000000a1') > 0,
  '10/sesje: przed kaskada agenda wydarzenia nie jest pusta');

DELETE FROM public.events WHERE id = 'e5000000-0000-0000-0000-0000000000a1';

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sessions
    WHERE event_id = 'e5000000-0000-0000-0000-0000000000a1') = 0
  AND (SELECT count(*) FROM public.event_tracks
        WHERE event_id = 'e5000000-0000-0000-0000-0000000000a1') = 0
  AND (SELECT count(*) FROM public.event_rooms
        WHERE event_id = 'e5000000-0000-0000-0000-0000000000a1') = 0
  AND (SELECT count(*) FROM public.event_session_speakers
        WHERE event_id = 'e5000000-0000-0000-0000-0000000000a1') = 0
  AND (SELECT count(*) FROM public.event_session_signups
        WHERE event_id = 'e5000000-0000-0000-0000-0000000000a1') = 0,
  '10/sesje: usuniecie wydarzenia kaskaduje na CALA agende (piec tabel)');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sessions
    WHERE tenant_id = '22222222-2222-2222-2222-222222222222') = 1,
  '10/sesje: kaskada nie dotknela agendy innego wydarzenia ani najemcy');

-- ---------------------------------------------------------------------------
-- 16. RAPORT KOLIZJI AGENDY
--
-- Trzy z czterech rodzajow kolizji powstaja PO zapisie sesji, bez udzialu
-- redaktora sesji - i zaden trigger ich nie zlapie, bo zmiana nie dotyczy jej
-- wiersza. Dlatego raport jest jedynym miejscem, ktore o nich mowi, i dlatego
-- kazdy rodzaj musi miec asercje.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('e0000000-0000-0000-0000-0000000000a1',
                      '11111111-1111-1111-1111-111111111111');

INSERT INTO public.event_rooms (id, tenant_id, event_id, name, capacity) VALUES
  ('a6000000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111',
   'e5000000-0000-0000-0000-0000000000a3', 'Sala Raportowa', 40);

SELECT public.admin_event_session_save(jsonb_build_object(
  'event_id', 'e5000000-0000-0000-0000-0000000000a3',
  'title_pl', 'Raport jeden', 'title_en', 'Report one',
  'starts_at', '2026-09-05 09:00+02', 'ends_at', '2026-09-05 10:00+02',
  'room_id', 'a6000000-0000-0000-0000-000000000010',
  'requires_signup', true, 'capacity', 40, 'status', 'published'));
SELECT public.admin_event_session_save(jsonb_build_object(
  'event_id', 'e5000000-0000-0000-0000-0000000000a3',
  'title_pl', 'Raport dwa', 'title_en', 'Report two',
  'starts_at', '2026-09-05 09:30+02', 'ends_at', '2026-09-05 10:30+02',
  'requires_signup', true, 'status', 'published'));

-- Obsada tej samej osoby w dwoch sesjach, ktore JESZCZE nie nachodza.
SELECT public.admin_event_session_speakers_set(jsonb_build_object(
  'session_id', (SELECT id FROM public.event_sessions WHERE title_pl = 'Raport jeden'),
  'speakers', jsonb_build_array(jsonb_build_object(
    'speaker_profile_id', '59000000-0000-0000-0000-0000000000a1'))));
SELECT public.admin_event_session_save(jsonb_build_object(
  'id', (SELECT id FROM public.event_sessions WHERE title_pl = 'Raport dwa'),
  'starts_at', '2026-09-06 09:00+02', 'ends_at', '2026-09-06 10:00+02'));
SELECT public.admin_event_session_speakers_set(jsonb_build_object(
  'session_id', (SELECT id FROM public.event_sessions WHERE title_pl = 'Raport dwa'),
  'speakers', jsonb_build_array(jsonb_build_object(
    'speaker_profile_id', '59000000-0000-0000-0000-0000000000a1'))));

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_agenda_conflicts(
     'e5000000-0000-0000-0000-0000000000a3') WHERE kind = 'speaker_overlap') = 0,
  '10/sesje: raport milczy, dopoki sesje tego samego prelegenta nie nachodza');

-- DZIURA, KTORA MIGRACJA PRZYZNAJE: przesuniecie godzin JUZ OBSADZONEJ sesji
-- tworzy kolizje prelegenta, bo `admin_event_session_save` obsady nie sprawdza.
-- Zapis PRZECHODZI, a kolizje widzi wylacznie raport.
SELECT pg_temp.assert(
  public.admin_event_session_save(jsonb_build_object(
    'id', (SELECT id FROM public.event_sessions WHERE title_pl = 'Raport dwa'),
    'starts_at', '2026-09-05 09:30+02', 'ends_at', '2026-09-05 10:30+02'))
    IS NOT NULL,
  '10/sesje: przesuniecie godzin obsadzonej sesji NIE jest blokowane (decyzja migracji)');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_agenda_conflicts(
     'e5000000-0000-0000-0000-0000000000a3') WHERE kind = 'speaker_overlap') = 1,
  '10/sesje: raport lapie kolizje prelegenta wytworzona przesunieciem godzin');

SELECT pg_temp.assert(
  (SELECT subject_name FROM public.admin_event_agenda_conflicts(
     'e5000000-0000-0000-0000-0000000000a3') WHERE kind = 'speaker_overlap')
    = 'Prelegent A1',
  '10/sesje: raport nazywa PRELEGENTA, ktorego dotyczy kolizja');

-- Para kolizji jest raportowana RAZ, nie dwa razy (warunek a.id < b.id).
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_agenda_conflicts(
     'e5000000-0000-0000-0000-0000000000a3') WHERE kind = 'speaker_overlap') = 1,
  '10/sesje: para kolizji prelegenta jest w raporcie raz, nie dwa razy');

-- Sesja poza oknem wydarzenia: zwezamy okno PO wpisaniu agendy.
UPDATE public.events SET ends_at = '2026-09-04 20:00+02'
 WHERE id = 'e5000000-0000-0000-0000-0000000000a3';
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_agenda_conflicts(
     'e5000000-0000-0000-0000-0000000000a3') WHERE kind = 'outside_event_window') >= 1,
  '10/sesje: raport lapie sesje poza oknem wydarzenia po zwezeniu okna');
UPDATE public.events SET ends_at = NULL
 WHERE id = 'e5000000-0000-0000-0000-0000000000a3';

-- Limit miejsc ponad pojemnosc sali: obnizamy sale PO zapisie sesji. Zapis
-- wprost, bo RPC sali ma na to wlasna odmowe (`capacity_below_sessions`) -
-- a chcemy stanu, ktory RPC nie dopusci, a dane moga miec z innej drogi.
UPDATE public.event_rooms SET capacity = 10
 WHERE id = 'a6000000-0000-0000-0000-000000000010';
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_agenda_conflicts(
     'e5000000-0000-0000-0000-0000000000a3') WHERE kind = 'capacity_over_room') = 1,
  '10/sesje: raport lapie limit miejsc ponad pojemnosc sali po obnizeniu sali');

-- Zapisow wiecej niz miejsc: furtka `force` organizatora.
SELECT public.admin_event_session_save(jsonb_build_object(
  'id', (SELECT id FROM public.event_sessions WHERE title_pl = 'Raport jeden'),
  'capacity', 1));

SELECT pg_temp.assert(
  (public.admin_event_session_signup_set(jsonb_build_object(
     'session_id', (SELECT id FROM public.event_sessions WHERE title_pl = 'Raport jeden'),
     'user_id', 'c0000000-0000-0000-0000-0000000000a1'))->>'status') = 'registered',
  '10/sesje: organizator zapisuje uczestnika na sesje');

SELECT pg_temp.assert(
  (SELECT added_by_staff FROM public.admin_event_session_signups_list(
     (SELECT id FROM public.event_sessions WHERE title_pl = 'Raport jeden'))
    WHERE user_id = 'c0000000-0000-0000-0000-0000000000a1'),
  '10/sesje: zapis zrobiony przez organizatora ma flage added_by_staff');

SELECT pg_temp.assert_raises_like(
  format($q$SELECT public.admin_event_session_signup_set(jsonb_build_object(
              'session_id', %L, 'user_id', 'c0000000-0000-0000-0000-0000000000a2'))$q$,
         (SELECT id FROM public.event_sessions WHERE title_pl = 'Raport jeden')),
  'session_full',
  '10/sesje: LIMIT MIEJSC obowiazuje takze organizatora - bez furtki nie przejdzie');

SELECT pg_temp.assert(
  (public.admin_event_session_signup_set(jsonb_build_object(
     'session_id', (SELECT id FROM public.event_sessions WHERE title_pl = 'Raport jeden'),
     'user_id', 'c0000000-0000-0000-0000-0000000000a2', 'force', true))
   ->>'over_capacity')::boolean,
  '10/sesje: jawna furtka force przekracza limit i przyznaje sie do tego');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_agenda_conflicts(
     'e5000000-0000-0000-0000-0000000000a3') WHERE kind = 'overbooked') = 1,
  '10/sesje: swiadome przekroczenie limitu jest WIDOCZNE w raporcie jako overbooked');

-- Uczestnik bez profilu w tym najemcy nie da sie zapisac przez organizatora.
SELECT pg_temp.assert_raises_like(
  format($q$SELECT public.admin_event_session_signup_set(jsonb_build_object(
              'session_id', %L, 'user_id', 'e0000000-0000-0000-0000-0000000000b1'))$q$,
         (SELECT id FROM public.event_sessions WHERE title_pl = 'Raport jeden')),
  'person_not_found',
  '10/sesje: organizator nie zapisze konta z INNEGO najemcy');

-- Wypisanie przez organizatora awansuje z listy rezerwowej.
SELECT public.admin_event_session_signup_set(jsonb_build_object(
  'session_id', (SELECT id FROM public.event_sessions WHERE title_pl = 'Raport jeden'),
  'user_id', 'c0000000-0000-0000-0000-0000000000a2', 'status', 'waitlist'));
SELECT pg_temp.assert(
  (public.admin_event_session_signup_set(jsonb_build_object(
     'session_id', (SELECT id FROM public.event_sessions WHERE title_pl = 'Raport jeden'),
     'user_id', 'c0000000-0000-0000-0000-0000000000a1', 'status', 'cancelled'))
   ->>'promoted')::boolean,
  '10/sesje: wypisanie przez organizatora awansuje osobe z listy rezerwowej');

SELECT pg_temp.assert(
  (SELECT waitlist_position FROM public.admin_event_session_signups_list(
     (SELECT id FROM public.event_sessions WHERE title_pl = 'Raport jeden'))
    WHERE user_id = 'c0000000-0000-0000-0000-0000000000a1') IS NULL,
  '10/sesje: pozycja na liscie rezerwowej jest liczona tylko dla statusu waitlist');

-- Prog warstwy obowiazuje TAKZE organizatora (droga przez user_tier_rank).
SELECT public.admin_event_session_save(jsonb_build_object(
  'id', (SELECT id FROM public.event_sessions WHERE title_pl = 'Raport dwa'),
  'min_tier_rank', 20, 'requires_signup', true));
SELECT pg_temp.act_as('e0000000-0000-0000-0000-0000000000a1',
                      '11111111-1111-1111-1111-111111111111', 0);
SELECT pg_temp.assert_raises_like(
  format($q$SELECT public.admin_event_session_signup_set(jsonb_build_object(
              'session_id', %L, 'user_id', 'c0000000-0000-0000-0000-0000000000a1'))$q$,
         (SELECT id FROM public.event_sessions WHERE title_pl = 'Raport dwa')),
  'tier_required',
  '10/sesje: PROG WARSTWY obowiazuje takze organizatora - zapis ponad prog jest odrzucany');

SELECT pg_temp.act_as('e0000000-0000-0000-0000-0000000000a1',
                      '11111111-1111-1111-1111-111111111111', 20);
SELECT pg_temp.assert(
  (public.admin_event_session_signup_set(jsonb_build_object(
     'session_id', (SELECT id FROM public.event_sessions WHERE title_pl = 'Raport dwa'),
     'user_id', 'c0000000-0000-0000-0000-0000000000a1'))->>'status') = 'registered',
  '10/sesje: po osiagnieciu progu ten sam zapis organizatora przechodzi (kontrapunkt)');

-- Sesja `Rok pozniej` nalezy do wydarzenia bez konca i zapisow nie przyjmuje
-- (`requires_signup` domyslnie false). Wiersz zapisu na takiej sesji nic nie
-- znaczy, wiec panel go nie zaklada - takze organizatorowi.
SELECT pg_temp.assert_raises_like(
  format($q$SELECT public.admin_event_session_signup_set(jsonb_build_object(
              'session_id', %L, 'user_id', 'c0000000-0000-0000-0000-0000000000a1'))$q$,
         (SELECT id FROM public.event_sessions WHERE title_pl = 'Rok pozniej')),
  'signup_disabled',
  '10/sesje: organizator nie zapisze nikogo na sesje, ktora zapisow nie przyjmuje');

-- ---------------------------------------------------------------------------
-- 17. SPRZATANIE
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as(NULL, NULL);
SELECT set_config('nes.public_tenant', '', false);

ROLLBACK;

\echo '== 10 sesje: koniec =='
