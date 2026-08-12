-- pgTAP: WARSTWA INTENCJI, KOMPLETNOSC PROFILU I SEMANTYKA KATALOGU OSOB
-- (migracje 20260807141000 / 20260807142000 / 20260807143000 / 20260807144000).
--
-- Weryfikowane wlasnosci:
--   1. Katalog intencji: CHECK kolumny `open_to` odsiewa kody spoza
--      nes_profile_open_to_catalog(), sufit 6 pozycji dziala.
--   2. Kompletnosc: nes_profile_completeness_row liczy 0 dla pustego wiersza
--      i 100 dla pelnego (wagi sumuja sie do 100 - to samo pokrywa bramka
--      TypeScriptowa, tu chodzi o SQL); trigger UTRZYMUJE kolumne
--      profiles.completeness_score i NADPISUJE wartosc podana przez klienta;
--      progi jakosciowe (bio, "czego szukam") realnie odcinaja krotkie wpisy;
--      zmiana w tabeli DZIECI (umiejetnosci) odswieza wynik.
--   3. intent_updated_at stempluje sie przy zmianie warstwy intencji, a nie
--      przy dowolnej edycji profilu.
--   4. discovery_search v3 wciaga tekst intencji, wiec katalog znajduje
--      "konsorcjum Horizon" bez warstwy wektorowej.
--   5. Fasety: people_filter_options zwraca faseta `open_to` z licznikami.
--   6. search_people v3: filtr `p_open_to`, projekcja intencji i kompletnosci,
--      degradacja bez wektora zapytania (zachowanie jak v2).
--   7. Kolejka wektorow: profiles_needing_embeddings pomija profile ponizej
--      progu kompletnosci i profile niewidoczne; prune usuwa wektor po
--      opt-oucie z katalogu; ACL (klient bez EXECUTE, bez SELECT na tabeli).
--   8. Petla zwrotna sugestii: dismiss usuwa osobe z connection_suggestions,
--      restore ja przywraca, licznik zgadza sie z tabela; connection_statuses
--      i connection_suggestions zwracaja jawny STOPIEN sieci.
--   9. Alerty zapisanych wyszukiwan dla encji 'people': nowy profil ponad
--      znakiem wodnym wysyla sygnal, drugi przebieg milczy.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(36);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('be111111-1111-1111-1111-111111111111'::uuid, 'tenant-be1', 'Tenant BE1');

INSERT INTO auth.users (id, email) VALUES
  ('be000000-0000-0000-0000-0000000000aa'::uuid, 'a@be.test'),
  ('be000000-0000-0000-0000-0000000000bb'::uuid, 'b@be.test'),
  ('be000000-0000-0000-0000-0000000000cc'::uuid, 'c@be.test'),
  ('be000000-0000-0000-0000-0000000000dd'::uuid, 'd@be.test');

-- A: wolajacy. B: pelny profil z intencja. C: profil szkicowy. D: pomost.
INSERT INTO public.profiles (id, email, display_name, tenant_id, discoverable) VALUES
  ('be000000-0000-0000-0000-0000000000aa'::uuid, 'a@be.test', 'Ala BE',
   'be111111-1111-1111-1111-111111111111'::uuid, true),
  ('be000000-0000-0000-0000-0000000000bb'::uuid, 'b@be.test', 'Bartek BE',
   'be111111-1111-1111-1111-111111111111'::uuid, true),
  ('be000000-0000-0000-0000-0000000000cc'::uuid, 'c@be.test', 'Celina BE',
   'be111111-1111-1111-1111-111111111111'::uuid, true),
  ('be000000-0000-0000-0000-0000000000dd'::uuid, 'd@be.test', 'Dorota BE',
   'be111111-1111-1111-1111-111111111111'::uuid, true);

-- ---------------------------------------------------------------------------
-- Katalog intencji: CHECK i sufit
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$UPDATE public.profiles SET open_to = ARRAY['nie_ma_takiego_kodu']
     WHERE id = 'be000000-0000-0000-0000-0000000000bb'::uuid$$,
  '23514',
  NULL,
  'kod spoza katalogu intencji odrzucany przez CHECK'
);

SELECT throws_ok(
  $$UPDATE public.profiles
       SET open_to = ARRAY['consortium','partnership','advisory','speaking',
                           'co_authoring','mentoring','hiring']
     WHERE id = 'be000000-0000-0000-0000-0000000000bb'::uuid$$,
  '23514',
  NULL,
  'sufit 6 intencji egzekwowany przez CHECK'
);

SELECT lives_ok(
  $$UPDATE public.profiles SET open_to = ARRAY['consortium','advisory']
     WHERE id = 'be000000-0000-0000-0000-0000000000bb'::uuid$$,
  'poprawny zestaw intencji przechodzi'
);

-- ---------------------------------------------------------------------------
-- Kompletnosc: funkcja czysta
-- ---------------------------------------------------------------------------
SELECT is(
  public.nes_profile_completeness_row(
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    '{}'::text[], NULL, NULL, 0, 0, 0),
  0::smallint,
  'pusty wiersz to 0 punktow kompletnosci'
);

SELECT is(
  public.nes_profile_completeness_row(
    'https://x.test/a.png', 'Ala BE', 'Ala', 'BE',
    'Head of EU Affairs', 'NES', 'Bruksela', 'CBAM',
    repeat('x', 120), NULL,
    ARRAY['consortium'],
    'Szukam partnerow do konsorcjum Horizon w obszarze CBAM i handlu.', NULL,
    3, 1, 1),
  100::smallint,
  'pelny wiersz to 100 punktow (wagi sumuja sie do 100)'
);

SELECT is(
  public.nes_profile_completeness_row(
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    'Ekspert.', NULL,
    '{}'::text[], 'Kontaktu.', NULL, 2, 0, 0),
  0::smallint,
  'progi jakosciowe odcinaja krotkie bio, krotka intencje i 2 umiejetnosci'
);

-- ---------------------------------------------------------------------------
-- Kompletnosc: kolumna utrzymywana triggerem
-- ---------------------------------------------------------------------------
UPDATE public.profiles
   SET avatar_url = 'https://x.test/b.png',
       job_title = 'Policy Director',
       current_company = 'NES',
       location = 'Bruksela',
       specialization = 'CBAM',
       bio_pl = repeat('opis ', 40),
       seeking_pl = 'Szukam partnerow do konsorcjum Horizon w obszarze CBAM i handlu.',
       -- Klient probuje podac wynik sam: trigger MUSI go nadpisac.
       completeness_score = 99
 WHERE id = 'be000000-0000-0000-0000-0000000000bb'::uuid;

SELECT is(
  (SELECT p.completeness_score FROM public.profiles p
    WHERE p.id = 'be000000-0000-0000-0000-0000000000bb'::uuid),
  -- avatar 10 + nazwa 8 + stanowisko 8 + firma 6 + lokalizacja 6 +
  -- specjalizacja 6 + bio 14 + intencja 10 + "czego szukam" 12 = 80.
  80::smallint,
  'trigger liczy kompletnosc z wiersza i NADPISUJE wartosc klienta'
);

INSERT INTO public.profile_skills (tenant_id, user_id, label) VALUES
  ('be111111-1111-1111-1111-111111111111'::uuid,
   'be000000-0000-0000-0000-0000000000bb'::uuid, 'CBAM'),
  ('be111111-1111-1111-1111-111111111111'::uuid,
   'be000000-0000-0000-0000-0000000000bb'::uuid, 'Handel UE'),
  ('be111111-1111-1111-1111-111111111111'::uuid,
   'be000000-0000-0000-0000-0000000000bb'::uuid, 'Prawo UE');

SELECT is(
  (SELECT p.completeness_score FROM public.profiles p
    WHERE p.id = 'be000000-0000-0000-0000-0000000000bb'::uuid),
  90::smallint,
  'trzecia umiejetnosc podnosi kompletnosc (trigger tabeli dzieci dziala)'
);

-- ---------------------------------------------------------------------------
-- intent_updated_at: stempel TYLKO przy zmianie warstwy intencji
-- ---------------------------------------------------------------------------
SELECT ok(
  (SELECT p.intent_updated_at IS NOT NULL FROM public.profiles p
    WHERE p.id = 'be000000-0000-0000-0000-0000000000bb'::uuid),
  'zmiana intencji stempluje intent_updated_at'
);

UPDATE public.profiles SET intent_updated_at = now() - interval '30 days'
 WHERE id = 'be000000-0000-0000-0000-0000000000bb'::uuid;
UPDATE public.profiles SET phone = '+48000000000'
 WHERE id = 'be000000-0000-0000-0000-0000000000bb'::uuid;

SELECT ok(
  (SELECT p.intent_updated_at < now() - interval '1 day' FROM public.profiles p
    WHERE p.id = 'be000000-0000-0000-0000-0000000000bb'::uuid),
  'edycja pola poza intencja NIE odswieza intent_updated_at'
);

-- ---------------------------------------------------------------------------
-- discovery_search v3: tekst intencji jest szukalny bez warstwy wektorowej
-- ---------------------------------------------------------------------------
SELECT matches(
  (SELECT p.discovery_search FROM public.profiles p
    WHERE p.id = 'be000000-0000-0000-0000-0000000000bb'::uuid),
  'konsorcjum horizon',
  'discovery_search zawiera znormalizowany tekst intencji'
);

-- ---------------------------------------------------------------------------
-- Fasety i search_people v3 (kontekst: wolajacy A)
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"be000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

SELECT is(
  (SELECT o.cnt::int FROM public.people_filter_options() o
    WHERE o.field = 'open_to' AND o.value = 'consortium'),
  1,
  'people_filter_options zwraca faseta open_to z licznikiem'
);

SELECT is(
  (SELECT count(*)::int FROM public.search_people(
     '', NULL, NULL, NULL, 20, 0, NULL, false, ARRAY['consortium'], NULL) sp),
  1,
  'p_open_to zaweza katalog do osob z ta intencja'
);

SELECT is(
  (SELECT count(*)::int FROM public.search_people(
     '', NULL, NULL, NULL, 20, 0, NULL, false, ARRAY['media'], NULL) sp),
  0,
  'intencja bez trafien zwraca pusty zbior (a nie caly katalog)'
);

SELECT is(
  (SELECT sp.open_to FROM public.search_people(
     'horizon', NULL, NULL, NULL, 20, 0, NULL, false, NULL, NULL) sp),
  ARRAY['consortium','advisory'],
  'projekcja katalogu niesie intencje profilu'
);

SELECT is(
  (SELECT sp.completeness_score FROM public.search_people(
     'horizon', NULL, NULL, NULL, 20, 0, NULL, false, NULL, NULL) sp),
  90::smallint,
  'projekcja katalogu niesie kompletnosc profilu'
);

SELECT is(
  (SELECT count(*)::int FROM public.search_people(
     'konsorcjum', NULL, NULL, NULL, 20, 0, NULL, false, NULL, NULL) sp),
  1,
  'bez wektora zapytania katalog dziala na czystym trigramie (degradacja)'
);

-- ---------------------------------------------------------------------------
-- Kolejka wektorow profili
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', NULL, true);

SELECT is(
  (SELECT count(*)::int FROM public.profiles_needing_embeddings(50, 40) q
    WHERE q.profile_id = 'be000000-0000-0000-0000-0000000000bb'::uuid),
  1,
  'profil powyzej progu kompletnosci wchodzi do kolejki wektorow'
);

SELECT is(
  (SELECT count(*)::int FROM public.profiles_needing_embeddings(50, 40) q
    WHERE q.profile_id = 'be000000-0000-0000-0000-0000000000cc'::uuid),
  0,
  'profil szkicowy (ponizej progu) NIE dostaje wektora'
);

SELECT matches(
  (SELECT q.embed_text FROM public.profiles_needing_embeddings(50, 40) q
    WHERE q.profile_id = 'be000000-0000-0000-0000-0000000000bb'::uuid),
  'Horizon',
  'tekst zrodlowy wektora zawiera intencje profilu'
);

-- Wektor jest, profil wychodzi z katalogu -> prune go zabiera.
INSERT INTO public.profile_embeddings (profile_id, tenant_id, content_hash, embedding)
SELECT 'be000000-0000-0000-0000-0000000000bb'::uuid,
       'be111111-1111-1111-1111-111111111111'::uuid,
       'hash-x',
       -- pgvector przyjmuje literal w NAWIASACH KWADRATOWYCH ('[0.01,...]').
       -- `array_fill(...)::text` daje literal tablicy Postgresa ('{0.01,...}'),
       -- ktorego rzutowanie na vector konczy sie bledem "malformed vector
       -- literal" - transakcja abortowala i 16 z 36 asercji tego pliku nie
       -- startowalo ani razu.
       ('[' || array_to_string(array_fill(0.01::real, ARRAY[768]), ',') || ']')::extensions.vector(768);

UPDATE public.profiles SET discoverable = false
 WHERE id = 'be000000-0000-0000-0000-0000000000bb'::uuid;

SELECT is(
  public.prune_profile_embeddings(),
  1,
  'opt-out z katalogu usuwa wektor profilu'
);

UPDATE public.profiles SET discoverable = true
 WHERE id = 'be000000-0000-0000-0000-0000000000bb'::uuid;

SELECT ok(
  NOT has_table_privilege('anon', 'public.profile_embeddings', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.profile_embeddings', 'SELECT'),
  'profile_embeddings bez odczytu dla klientow (surowe wektory zostaja w bazie)'
);

SELECT ok(
  NOT has_function_privilege('authenticated',
    'public.profiles_needing_embeddings(integer, integer)', 'EXECUTE'),
  'kolejka indeksera wylacznie dla service_role'
);

SELECT ok(
  has_function_privilege('authenticated',
    'public.semantic_search_profiles(double precision[], integer)', 'EXECUTE'),
  'zapytanie semantyczne dostepne dla zalogowanego (RLS zaweza wiersze)'
);

-- ---------------------------------------------------------------------------
-- Petla zwrotna sugestii + jawny stopien sieci
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"be000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

-- A-D i D-B zaakceptowane, wiec B jest 2. stopniem dla A.
INSERT INTO public.user_connections (tenant_id, requester_id, addressee_id, status) VALUES
  ('be111111-1111-1111-1111-111111111111'::uuid,
   'be000000-0000-0000-0000-0000000000aa'::uuid,
   'be000000-0000-0000-0000-0000000000dd'::uuid, 'pending'),
  ('be111111-1111-1111-1111-111111111111'::uuid,
   'be000000-0000-0000-0000-0000000000dd'::uuid,
   'be000000-0000-0000-0000-0000000000bb'::uuid, 'pending');
UPDATE public.user_connections SET status = 'accepted'
 WHERE tenant_id = 'be111111-1111-1111-1111-111111111111'::uuid;

SELECT is(
  (SELECT cs.degree FROM public.connection_statuses(
     ARRAY['be000000-0000-0000-0000-0000000000dd'::uuid]) cs),
  1::smallint,
  'connection_statuses: polaczenie bezposrednie to 1. stopien'
);

SELECT is(
  (SELECT cs.degree FROM public.connection_statuses(
     ARRAY['be000000-0000-0000-0000-0000000000bb'::uuid]) cs),
  2::smallint,
  'connection_statuses: wspolny kontakt to 2. stopien'
);

-- Profil `cc` nie ma ANI JEDNEJ krawedzi, wiec nie jest "3. stopniem" - jest
-- POZA ZASIEGIEM, co funkcja raportuje jako 0. Ta asercja oczekiwala wczesniej
-- 3 i utrwalala regresje z 20260807143000, w ktorej KAZDA osoba bez wspolnego
-- kontaktu wracala jako degree=3, a interfejs pisal o niej "dwa kroki od Twojej
-- sieci" (naprawione w 20260812100500). Sprzecznosc byla niewidoczna, bo plik
-- przerywal na 20. tescie i ta asercja nigdy sie nie uruchomila.
-- Kontrakt 0/1/2/3 jest przybity niezaleznie w connection_degree_test.sql:187.
SELECT is(
  (SELECT cs.degree FROM public.connection_statuses(
     ARRAY['be000000-0000-0000-0000-0000000000cc'::uuid]) cs),
  0::smallint,
  'connection_statuses: brak sciezki to poza zasiegiem (0), a nie 3. stopien'
);

SELECT is(
  (SELECT s.degree FROM public.connection_suggestions(24) s
    WHERE s.user_id = 'be000000-0000-0000-0000-0000000000bb'::uuid),
  2::smallint,
  'connection_suggestions zwraca jawny stopien sieci'
);

SELECT ok(
  public.dismiss_connection_suggestion('be000000-0000-0000-0000-0000000000bb'::uuid),
  'dismiss_connection_suggestion zapisuje decyzje'
);

SELECT is(
  (SELECT count(*)::int FROM public.connection_suggestions(24) s
    WHERE s.user_id = 'be000000-0000-0000-0000-0000000000bb'::uuid),
  0,
  'odrzucona osoba NIE wraca do sugestii'
);

SELECT is(
  public.my_dismissed_suggestions_count(),
  1,
  'licznik ukrytych sugestii zgadza sie z tabela'
);

SELECT is(
  public.restore_connection_suggestions(),
  1,
  'restore_connection_suggestions czysci liste i zwraca liczbe przywroconych'
);

SELECT is(
  (SELECT count(*)::int FROM public.connection_suggestions(24) s
    WHERE s.user_id = 'be000000-0000-0000-0000-0000000000bb'::uuid),
  1,
  'po przywroceniu osoba wraca do sugestii'
);

-- ---------------------------------------------------------------------------
-- Alerty zapisanych wyszukiwan: encja 'people'
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', NULL, true);

DELETE FROM public.notifications;

INSERT INTO public.saved_searches
  (id, user_id, tenant_id, name, params, entity, alert_enabled,
   last_seen_profile_at, url)
VALUES
  ('be555555-0000-0000-0000-000000000001'::uuid,
   'be000000-0000-0000-0000-0000000000aa'::uuid,
   'be111111-1111-1111-1111-111111111111'::uuid,
   'Konsorcja CBAM',
   jsonb_build_object('q', 'horizon', 'open', 'consortium'),
   'people', true,
   now() - interval '7 days',
   '/people?open=consortium&q=horizon');

SELECT is(
  public.run_saved_search_alerts(),
  1,
  'galaz people wysyla sygnal o profilu pasujacym ponad znakiem wodnym'
);

SELECT matches(
  (SELECT n.title_pl FROM public.notifications n
    WHERE n.user_id = 'be000000-0000-0000-0000-0000000000aa'::uuid
      AND n.kind = 'saved_search' LIMIT 1),
  'Nowe osoby',
  'tresc alertu mowi o OSOBACH, nie o publikacjach'
);

SELECT is(
  public.run_saved_search_alerts(),
  0,
  'drugi przebieg milczy (znak wodny przesuniety)'
);

SELECT * FROM finish();
ROLLBACK;
