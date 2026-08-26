-- ============================================================================
-- 40_speakers - PRELEGENT BEZ KONTA: KARTOTEKA JAKO PODMIOT WYSTAPIENIA
--
-- PO CO TEN PLIK ISTNIEJE
-- Do migracji `20260826180000_event_speaker_person.sql` rejestr prelegentow
-- FIZYCZNIE nie dopuszczal osoby bez konta: `event_speakers` ma
-- `user_id NOT NULL REFERENCES auth.users`, `PRIMARY KEY (event_id, user_id)`
-- i zero `tenant_id`, a `speaker_profiles.user_id` byl NOT NULL. Ekran panelu
-- mial jedno pole wejsciowe - droplista, ktora jest wyszukiwarka ISTNIEJACYCH
-- KONT. Czyli „zaloz prelegenta i wpisz jego szczegoly" bylo niedostepne
-- Z DEFINICJI. W danych referencyjnych wzorca 21 z 21 prelegentow NIE MA
-- konta, wiec brakowalo sciezki dla przypadku TYPOWEGO.
--
-- CZEGO TU DOWODZIMY - piec rzeczy, kazda z drugim bokiem:
--   (a) da sie zalozyc osobe BEZ konta i podpiac ja do wydarzenia JEDNYM
--       wywolaniem, a powtorzenie po tym samym adresie DOPASOWUJE osobe
--       zamiast tworzyc druga;
--   (b) `event_speakers_public` ODDAJE ta osobe dla wydarzenia opublikowanego
--       (LEFT JOIN po `profiles`, nie INNER - przez INNER wypadala
--       bezwarunkowo) i NIE oddaje jej dla szkicu;
--   (c) CHECK `speaker_profiles_subject_xor` odrzuca wiersz z OBOMA
--       identyfikatorami i wiersz z ZADNYM;
--   (d) redaktor dostaje NAZWANY blad z kazdej z czterech funkcji panelu,
--       a anonim - inny, tez nazwany;
--   (e) polityki nowej tabeli przechodza asercje kontraktu modulu
--       (`admin OR is_super_admin`, nigdy `editor`) i klient nie ma na niej
--       grantu zapisu.
--
-- DLACZEGO CZESC ASERCJI CZYTA KATALOG. Harness pracuje jako wlasciciel bazy,
-- a wlasciciel OMIJA RLS - „czy redaktor to zobaczy" zwrocilo by tu wynik
-- pozytywny niezaleznie od tresci polityki (patrz naglowek 80_admin_only).
-- Dlatego uprawnienia RPC sprawdzamy WYKONANIEM (bramka jest w ciele
-- funkcji, wiec dziala takze dla wlasciciela), a polityki - katalogiem.
--
-- SPRZATANIE. Caly plik pracuje w transakcji zakonczonej ROLLBACK-iem.
-- ============================================================================

\echo '== 40 prelegenci: osoba bez konta, projekcja publiczna, bramka =='

BEGIN;

-- ---------------------------------------------------------------------------
-- ATRAPY SPOZA MODULU, ZAKLADANE W TEJ TRANSAKCJI (i cofane ROLLBACK-iem)
--
-- `event_speakers_public` czyta trzy obiekty NALEZACE DO INNEGO MODULU (hub
-- ekspertow, 20260727200000 i 20260713091000): pelna `speaker_profiles`,
-- `author_profiles` i `profile_badges`. `harness.sql` stawia `speaker_profiles`
-- w wersji WEZSZEJ (tozsamosc + naglowek + widocznosc), a pozostalych dwoch
-- nie ma wcale - bo do tej pory zaden plik asercji modulu Wydarzen ich nie
-- potrzebowal.
--
-- DLACZEGO TUTAJ, A NIE W `harness.sql`. Ten plik jest wspoldzielony przez
-- wszystkich autorow harnessu i w chwili pisania byl edytowany rownolegle;
-- dopisanie do niego trzech obiektow to kolizja na pliku, ktora nikomu nie
-- pomaga. Transakcja tego pliku i tak konczy sie ROLLBACK-iem, wiec atrapa
-- zalozona tu NIE ISTNIEJE dla zadnego innego pliku asercji - a `IF NOT
-- EXISTS` sprawia, ze gdy `harness.sql` kiedys te obiekty dostanie, ten blok
-- stanie sie pustym przebiegiem, a nie konfliktem.
--
-- KSZTALT JEST PRZEPISANY Z ORYGINALOW (20260709143613:2-23,
-- 20260713091000:19-25, 20260727200000:31-66) - atrapa szersza od produkcji
-- przepuszczalaby blad, ktory na produkcji wywali 42703 albo 42P01.
-- ---------------------------------------------------------------------------
ALTER TABLE public.speaker_profiles
  ADD COLUMN IF NOT EXISTS topics_pl text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS topics_en text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS languages text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS talks_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating numeric(2,1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reviews_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS crm_lead_id uuid;

CREATE TABLE IF NOT EXISTS public.author_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  avatar_url text,
  job_title text,
  company text,
  is_public boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- LEGACY `event_speakers` (20260714130000:287-292). Harness modulu Wydarzen
-- jej NIE MA - powstaje w migracji huba ekspertow, ktorej selektor harnessu nie
-- lapie. A to wlasnie ta tabela jest przedmiotem UNION-a w obu nowych
-- projekcjach: bez niej dowod „legacy nie znika" nie istnieje.
-- PK (event_id, user_id) i ZERO tenant_id - dokladnie ta wlasnosc, ktora
-- uniemozliwia wpisanie tu osoby bez konta.
CREATE TABLE IF NOT EXISTS public.event_speakers (
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.profile_badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  badge text NOT NULL CHECK (badge IN ('verified', 'expert', 'contributor', 'staff')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, badge)
);

-- Atrapa musi byc PRAWDZIWA, nie deklarowana: bez tej asercji literowka
-- w nazwie kolumny wyzej dawalaby cichy brak i kolejne asercje mowilyby
-- o czyms innym, niz mysla.
SELECT pg_temp.assert(
  (SELECT count(*) = 3 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'speaker_profiles'
      AND column_name IN ('topics_pl', 'languages', 'talks_count')),
  'atrapa: speaker_profiles ma kolumny czytane przez event_speakers_public');

SELECT pg_temp.assert(
  (SELECT count(*) = 3 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND c.relname IN ('author_profiles', 'profile_badges', 'event_speakers')),
  'atrapa: trzy tabele spoza modulu stoja (author_profiles, profile_badges, event_speakers)');

-- ---------------------------------------------------------------------------
-- Scenografia. Dwa wydarzenia (opublikowane i szkic), administrator,
-- redaktor, jedno KONTO prelegenta wpisane STARYM rejestrem (dowod, ze UNION
-- w projekcji publicznej nie gubi dotychczasowych) i grupa uczestnikow.
-- ---------------------------------------------------------------------------
INSERT INTO public.tenants (id, name, slug) VALUES
  ('40000000-0000-0000-0000-0000000000b0', 'Tenant B (prelegenci)', 'tb-spk')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('40a00000-0000-0000-0000-0000000000a1', 'spk.admin.a@example.org'),
  ('40a00000-0000-0000-0000-0000000000a2', 'spk.editor.a@example.org'),
  ('40a00000-0000-0000-0000-0000000000a3', 'spk.konto.a@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role) VALUES
  ('40a00000-0000-0000-0000-0000000000a1', 'admin'),
  ('40a00000-0000-0000-0000-0000000000a2', 'editor')
ON CONFLICT DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, display_name, slug) VALUES
  ('40a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'Administrator', 'spk-admin'),
  ('40a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   'Redaktor', 'spk-redaktor'),
  ('40a00000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111',
   'Anna Konto', 'anna-konto')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status) VALUES
  ('40e00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'spk-kongres', 'Kongres', 'Congress', now() + interval '30 days', 'published'),
  ('40e00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   'spk-szkic', 'Szkic', 'Draft', now() + interval '60 days', 'draft')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_groups (id, tenant_id, event_id, key, name_pl, name_en) VALUES
  ('40900000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '40e00000-0000-0000-0000-0000000000a1', 'prelegenci', 'Prelegenci', 'Speakers')
ON CONFLICT (id) DO NOTHING;

-- Rzad LEGACY: prelegent z kontem, wpisany starym rejestrem `event_speakers`.
INSERT INTO public.event_speakers (event_id, user_id, sort_order) VALUES
  ('40e00000-0000-0000-0000-0000000000a1', '40a00000-0000-0000-0000-0000000000a3', 0)
ON CONFLICT DO NOTHING;

INSERT INTO public.author_profiles (user_id, tenant_id, job_title, company, is_public) VALUES
  ('40a00000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111',
   'Dyrektorka', 'NES', true)
ON CONFLICT (user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- (a) OSOBA BEZ KONTA POWSTAJE I ZOSTAJE PODPIETA - JEDNYM ZAPISEM
--
-- Rozbicie na dwa wywolania z klienta zostawialoby po bledzie sieci osobe
-- w kartotece bez wystapienia - smiec, ktorego redaktor nie widzi w zadnym
-- ekranie. Dlatego to jest JEDNA funkcja i jedna transakcja.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_res     jsonb;
  v_person  uuid;
  v_profile uuid;
  v_txt     text;
BEGIN
  PERFORM pg_temp.act_as('40a00000-0000-0000-0000-0000000000a1',
                         '11111111-1111-1111-1111-111111111111');

  v_res := public.admin_event_speaker_upsert(jsonb_build_object(
    'event_id',   '40e00000-0000-0000-0000-0000000000a1',
    'group_id',   '40900000-0000-0000-0000-0000000000a1',
    -- Adres wchodzi Z BIALYMI ZNAKAMI i WIELKA LITERA: dopasowanie idzie po
    -- `email_norm` (kolumna wyliczana lower+btrim), nie po tym, co wpisano.
    'email',      '  Lech.Kurklinski@SGH.example ',
    'first_name', '  Lech ',
    'last_name',  'Kurklinski',
    'job_title',  'Profesor',
    'company_text', 'Szkola Glowna Handlowa',
    'photo_url',  'https://cdn.example.org/lech.jpg',
    'bio_pl',     'Ekonomista.',
    'headline_pl', 'Panel o bankowosci',
    'topics_pl',  jsonb_build_array('  bankowosc  ', 'regulacje', '   '),
    'languages',  jsonb_build_array('pl', 'en'),
    'phone',      '+48 22 000 00 00',
    'social_profile_url', 'https://www.example.org/in/lech'
  ));

  v_person  := (v_res->>'person_id')::uuid;
  v_profile := (v_res->>'speaker_profile_id')::uuid;

  PERFORM pg_temp.assert(v_person IS NOT NULL AND v_profile IS NOT NULL
                         AND (v_res->>'entry_id') IS NOT NULL,
    'prelegenci: jedno wywolanie zwraca osobe, nakladke I wpis wydarzenia');

  PERFORM pg_temp.assert(
    (SELECT sp.user_id IS NULL AND sp.person_id = v_person
       FROM public.speaker_profiles sp WHERE sp.id = v_profile),
    'prelegenci: nakladka wskazuje OSOBE (person_id), user_id jest NULL');

  SELECT pe.email_norm INTO v_txt FROM public.event_people pe WHERE pe.id = v_person;
  PERFORM pg_temp.assert(v_txt = 'lech.kurklinski@sgh.example',
    'prelegenci: adres znormalizowany do email_norm (dostano: ' || COALESCE(v_txt, 'NULL') || ')');

  -- ZGODY. Popup organizatora zapisuje WYLACZNIE podstawe przetwarzania.
  -- Zgody marketingowej ani partnerskiej organizator nie moze udzielic za
  -- kogos - to byla by zgoda pozorna, wiec tych stempli NIE MA byc.
  PERFORM pg_temp.assert(
    (SELECT pe.source = 'organizer'
        AND pe.consent_data_processing_at IS NOT NULL
        AND pe.consent_marketing_at IS NULL
        AND pe.consent_partner_sharing_at IS NULL
       FROM public.event_people pe WHERE pe.id = v_person),
    'prelegenci: source=organizer i TYLKO zgoda na przetwarzanie danych');

  PERFORM pg_temp.assert(
    (SELECT count(*) = 1 FROM public.event_group_members m
      WHERE m.person_id = v_person
        AND m.group_id = '40900000-0000-0000-0000-0000000000a1'),
    'prelegenci: osoba dopisana do wskazanej grupy uczestnikow');

  -- Tablice: obciete biale znaki, odsiane puste. Element „   " w wejsciu jest
  -- celowy - bez odsiania na profilu wisialby pusty chip.
  PERFORM pg_temp.assert(
    (SELECT sp.topics_pl = ARRAY['bankowosc', 'regulacje']
        AND sp.languages = ARRAY['pl', 'en']
       FROM public.speaker_profiles sp WHERE sp.id = v_profile),
    'prelegenci: tematy i jezyki obciete i bez pustych elementow');

  -- Klucz NIEOBECNY nie rusza tablicy (patch), a `[]` ja czysci. Bez tego
  -- rozroznienia nie da sie usunac ostatniego tematu.
  PERFORM public.admin_event_speaker_upsert(jsonb_build_object(
    'event_id', '40e00000-0000-0000-0000-0000000000a1', 'person_id', v_person));
  PERFORM pg_temp.assert(
    (SELECT sp.topics_pl = ARRAY['bankowosc', 'regulacje']
       FROM public.speaker_profiles sp WHERE sp.id = v_profile),
    'prelegenci: payload bez klucza topics_pl NIE czysci tematow');

  PERFORM public.admin_event_speaker_upsert(jsonb_build_object(
    'event_id', '40e00000-0000-0000-0000-0000000000a1', 'person_id', v_person,
    'topics_pl', '[]'::jsonb));
  PERFORM pg_temp.assert(
    (SELECT sp.topics_pl = '{}'::text[]
       FROM public.speaker_profiles sp WHERE sp.id = v_profile),
    'prelegenci: jawna pusta tablica CZYSCI tematy');

  -- POWTORKA po tym samym adresie: DOPASOWANIE, nie duplikat. Bez tego dwa
  -- klikniecia w popupie daja dwie karty jednego czlowieka.
  v_res := public.admin_event_speaker_upsert(jsonb_build_object(
    'event_id',   '40e00000-0000-0000-0000-0000000000a1',
    'email',      'LECH.KURKLINSKI@sgh.example',
    'first_name', 'Lech',
    'last_name',  'Kurklinski',
    'job_title',  'Profesor zwyczajny'
  ));
  PERFORM pg_temp.assert((v_res->>'person_id')::uuid = v_person,
    'prelegenci: powtorka po email_norm dopasowuje OSOBE, nie tworzy drugiej');
  PERFORM pg_temp.assert(
    (SELECT count(*) = 1 FROM public.event_speaker_entries en
      WHERE en.event_id = '40e00000-0000-0000-0000-0000000000a1'),
    'prelegenci: powtorka nie tworzy drugiego wpisu wydarzenia');

  -- PATCH, nie nadpisanie: klucz nieobecny w payloadzie zostawia kolumne.
  -- Popup nie jest jedynym pisarzem tej kartoteki (rejestracja, skan leada),
  -- wiec puste pole formularza nie moze wymazac telefonu.
  PERFORM pg_temp.assert(
    (SELECT pe.job_title = 'Profesor zwyczajny' AND pe.phone = '+48 22 000 00 00'
       FROM public.event_people pe WHERE pe.id = v_person),
    'prelegenci: PATCH nadpisuje podane pole i NIE rusza pominietego');

  -- Lista panelu: oba rejestry w jednej liscie, bez duplikatu.
  PERFORM pg_temp.assert(
    (SELECT count(*) = 2 FROM public.admin_event_speakers_list(
       '40e00000-0000-0000-0000-0000000000a1')),
    'prelegenci: lista panelu sklada nowy rejestr i legacy w dwa wiersze');

  PERFORM pg_temp.assert(
    (SELECT l.display_name = 'Lech Kurklinski' AND l.is_legacy = false
       FROM public.admin_event_speakers_list('40e00000-0000-0000-0000-0000000000a1') l
      WHERE l.person_id IS NOT NULL),
    'prelegenci: lista panelu sklada nazwisko osoby BEZ konta z kartoteki');

  PERFORM pg_temp.assert(
    (SELECT l.display_name = 'Anna Konto' AND l.entry_id IS NULL AND l.is_legacy
       FROM public.admin_event_speakers_list('40e00000-0000-0000-0000-0000000000a1') l
      WHERE l.is_legacy),
    'prelegenci: rzad legacy jest oznaczony (entry_id NULL)');

  -- Osoba wpisana takze na SZKIC - potrzebna do asercji (b).
  PERFORM public.admin_event_speaker_upsert(jsonb_build_object(
    'event_id',  '40e00000-0000-0000-0000-0000000000a2',
    'person_id', v_person));
END $do$;

-- ---------------------------------------------------------------------------
-- (b) PROJEKCJA PUBLICZNA NIE GUBI OSOBY BEZ KONTA
--
-- `get_public_speakers` ma `JOIN public.profiles p ON p.id = b.user_id`
-- (INNER, 20260727200000:193-195): prelegent bez konta wypadal z listy
-- BEZWARUNKOWO, bez bledu i bez sladu w logu - strona pokazywala pusta sekcje,
-- a redaktor widzial w panelu piecioro prelegentow.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE r record; v_n integer;
BEGIN
  PERFORM pg_temp.act_as();  -- anonim, plaszczyzna TRESCI

  SELECT count(*) INTO v_n
    FROM public.event_speakers_public(jsonb_build_object('slug', 'spk-kongres'));
  PERFORM pg_temp.assert(v_n = 2,
    'front: dwie karty - osoba bez konta ORAZ rzad legacy (dostano: ' || v_n || ')');

  SELECT * INTO r FROM public.event_speakers_public(jsonb_build_object('slug', 'spk-kongres'))
   WHERE person_id IS NOT NULL;
  PERFORM pg_temp.assert(r.user_id IS NULL AND r.display_name = 'Lech Kurklinski',
    'front: nazwisko osoby bez konta zlozone z kartoteki (first || last)');
  PERFORM pg_temp.assert(r.avatar_url = 'https://cdn.example.org/lech.jpg',
    'front: awatar z event_people.photo_url');
  PERFORM pg_temp.assert(r.job_title = 'Profesor zwyczajny'
                         AND r.company = 'Szkola Glowna Handlowa',
    'front: stanowisko i firma z kartoteki (COALESCE po author_profiles)');
  PERFORM pg_temp.assert(r.headline_pl = 'Panel o bankowosci' AND r.bio_pl = 'Ekonomista.',
    'front: rola sceniczna z nakladki, bio z kartoteki przez COALESCE');

  SELECT * INTO r FROM public.event_speakers_public(jsonb_build_object('slug', 'spk-kongres'))
   WHERE user_id IS NOT NULL;
  PERFORM pg_temp.assert(r.display_name = 'Anna Konto' AND r.job_title = 'Dyrektorka',
    'front: rzad LEGACY zostaje na liscie, stanowisko z author_profiles');

  SELECT count(*) INTO v_n
    FROM public.event_speakers_public(jsonb_build_object(
      'event_id', '40e00000-0000-0000-0000-0000000000a1'));
  PERFORM pg_temp.assert(v_n = 2, 'front: tryb event_id daje ten sam wynik co slug');

  -- SZKIC NIE MA STRONY PUBLICZNEJ. To jest ten trzeci, cichy warunek, o ktorym
  -- panel do tej pory MILCZAL - dlatego ekran prelegentow dostal plakietke.
  SELECT count(*) INTO v_n
    FROM public.event_speakers_public(jsonb_build_object('slug', 'spk-szkic'));
  PERFORM pg_temp.assert(v_n = 0,
    'front: SZKIC oddaje zero kart, mimo wpisanego prelegenta');

  -- Izolacja najemcow: naglowek hosta obcego najemcy nie widzi naszej listy.
  PERFORM pg_temp.act_as(NULL, NULL);
  PERFORM set_config('nes.public_tenant', '40000000-0000-0000-0000-0000000000b0', false);
  SELECT count(*) INTO v_n
    FROM public.event_speakers_public(jsonb_build_object('slug', 'spk-kongres'));
  PERFORM pg_temp.assert(v_n = 0, 'front: obcy najemca w naglowku dostaje zero wierszy');
  PERFORM set_config('nes.public_tenant', '', false);
END $do$;

-- ---------------------------------------------------------------------------
-- (c) NAKLADKA MA DOKLADNIE JEDEN PODMIOT
--
-- Wiersz z oboma identyfikatorami to dwie tozsamosci jednej karty (czyj
-- headline?), wiersz z zadnym - sierota, ktorej nie da sie ani pokazac, ani
-- usunac po wlascicielu.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_raises_like(
  $$INSERT INTO public.speaker_profiles (tenant_id, user_id, person_id)
    SELECT '11111111-1111-1111-1111-111111111111',
           '40a00000-0000-0000-0000-0000000000a3', pe.id
      FROM public.event_people pe WHERE pe.email_norm = 'lech.kurklinski@sgh.example'$$,
  'speaker_profiles_subject_xor',
  'XOR: wiersz z OBOMA identyfikatorami odrzucony');

SELECT pg_temp.assert_raises_like(
  $$INSERT INTO public.speaker_profiles (tenant_id)
    VALUES ('11111111-1111-1111-1111-111111111111')$$,
  'speaker_profiles_subject_xor',
  'XOR: wiersz BEZ zadnego identyfikatora odrzucony');

SELECT pg_temp.assert_raises_like(
  $$INSERT INTO public.speaker_profiles (tenant_id, person_id)
    SELECT '11111111-1111-1111-1111-111111111111', pe.id
      FROM public.event_people pe WHERE pe.email_norm = 'lech.kurklinski@sgh.example'$$,
  'speaker_profiles_tenant_person_uniq',
  'XOR: czesciowy UNIQUE blokuje druga nakladke tej samej osoby');

-- Wiele NULL-i w istniejacym `UNIQUE (tenant_id, user_id)` wspolistnieje -
-- na tym stoi cala mozliwosc trzymania setki osob bez konta w jednej tabeli.
DO $do$
DECLARE v_p2 uuid;
BEGIN
  INSERT INTO public.event_people (tenant_id, first_name, last_name)
  VALUES ('11111111-1111-1111-1111-111111111111', 'Jan', 'Bez-Adresu')
  RETURNING id INTO v_p2;
  INSERT INTO public.speaker_profiles (tenant_id, person_id)
  VALUES ('11111111-1111-1111-1111-111111111111', v_p2);
  PERFORM pg_temp.assert(
    (SELECT count(*) >= 2 FROM public.speaker_profiles sp WHERE sp.user_id IS NULL),
    'XOR: dwie nakladki z user_id = NULL wspolistnieja (wiele NULL w UNIQUE)');
END $do$;

-- ZGODNOSC WSTECZ. `admin_upsert_speaker_profile` (20260727200000) stoi na
-- `ON CONFLICT (tenant_id, user_id) DO UPDATE`. `DROP NOT NULL` na `user_id`
-- mogl wysadzic ten upsert na dwa sposoby: usuwajac ograniczenie (wtedy
-- 42P10 „no unique or exclusion constraint matching") albo zamieniajac je na
-- indeks czesciowy (wtedy to samo). Asercja idzie WPROST na ograniczenie,
-- a nie przez tamta funkcje: harness modulu Wydarzen jej nie ma (powstaje
-- w migracji huba ekspertow, ktorej selektor nie lapie), a przedmiotem dowodu
-- jest ograniczenie, nie cialo tamtej funkcji.
DO $do$
DECLARE v_headline text;
BEGIN
  INSERT INTO public.speaker_profiles (tenant_id, user_id, headline_pl)
  VALUES ('11111111-1111-1111-1111-111111111111',
          '40a00000-0000-0000-0000-0000000000a3', 'Stara sciezka')
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET headline_pl = EXCLUDED.headline_pl;

  SELECT sp.headline_pl INTO v_headline FROM public.speaker_profiles sp
   WHERE sp.user_id = '40a00000-0000-0000-0000-0000000000a3';
  PERFORM pg_temp.assert(v_headline = 'Stara sciezka',
    'zgodnosc: ON CONFLICT (tenant_id, user_id) dziala po DROP NOT NULL');
END $do$;

SELECT pg_temp.assert(
  (SELECT count(*) = 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.speaker_profiles'::regclass
      AND c.contype = 'u'
      AND c.conkey = ARRAY[
        (SELECT a.attnum FROM pg_attribute a
          WHERE a.attrelid = 'public.speaker_profiles'::regclass AND a.attname = 'tenant_id'),
        (SELECT a.attnum FROM pg_attribute a
          WHERE a.attrelid = 'public.speaker_profiles'::regclass AND a.attname = 'user_id')
      ]::smallint[]),
  'zgodnosc: ograniczenie UNIQUE (tenant_id, user_id) NADAL istnieje');

-- ---------------------------------------------------------------------------
-- (d) BRAMKA: REDAKTOR I ANONIM DOSTAJA NAZWANY BLAD
--
-- Kontrakt modulu (20260824090000): `admin` ALBO `super_admin`, NIGDY
-- `editor`. Cichy NULL zamiast wyjatku w SECURITY DEFINER znaczylby zapytanie
-- bez wlasciciela, czyli odczyt poza najemca.
-- ---------------------------------------------------------------------------
DO $do$ BEGIN
  PERFORM pg_temp.act_as('40a00000-0000-0000-0000-0000000000a2',
                         '11111111-1111-1111-1111-111111111111');
END $do$;

SELECT pg_temp.assert_raises_like(
  $$SELECT public.admin_event_speaker_upsert(jsonb_build_object(
      'event_id', '40e00000-0000-0000-0000-0000000000a1',
      'first_name', 'X', 'last_name', 'Y'))$$,
  'admin role required',
  'bramka: redaktor NIE zaklada prelegenta');

SELECT pg_temp.assert_raises_like(
  $$SELECT * FROM public.admin_event_speakers_list('40e00000-0000-0000-0000-0000000000a1')$$,
  'admin role required',
  'bramka: redaktor NIE czyta listy prelegentow');

SELECT pg_temp.assert_raises_like(
  $$SELECT public.admin_event_speaker_remove(jsonb_build_object(
      'event_id', '40e00000-0000-0000-0000-0000000000a1',
      'user_id', '40a00000-0000-0000-0000-0000000000a3'))$$,
  'admin role required',
  'bramka: redaktor NIE zdejmuje prelegenta');

SELECT pg_temp.assert_raises_like(
  $$SELECT public.admin_event_speaker_reorder(jsonb_build_object(
      'event_id', '40e00000-0000-0000-0000-0000000000a1', 'items', '[]'::jsonb))$$,
  'admin role required',
  'bramka: redaktor NIE zmienia kolejnosci');

DO $do$ BEGIN PERFORM pg_temp.act_as(); END $do$;

SELECT pg_temp.assert_raises_like(
  $$SELECT public.admin_event_speaker_upsert('{}'::jsonb)$$,
  'authentication required',
  'bramka: anonim dostaje INNY nazwany blad, PRZED walidacja payloadu');

-- ---------------------------------------------------------------------------
-- (e) NOWA TABELA STOI POD KONTRAKTEM RLS MODULU
--
-- Te same predykaty, ktorych pilnuje `supabase/tests/event_admin_only_contract
-- _test.sql` - zawezone do nowej tabeli, zeby blad wskazywal winowajce.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  (SELECT c.relrowsecurity FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'event_speaker_entries'),
  'RLS: event_speaker_entries ma wlaczone row level security');

SELECT pg_temp.assert(
  NOT EXISTS (
    SELECT 1 FROM pg_policies p
     WHERE p.schemaname = 'public' AND p.tablename = 'event_speaker_entries'
       AND (COALESCE(p.qual, '') || ' ' || COALESCE(p.with_check, '')) ~ '''editor'''
  ),
  'RLS: zadna polityka event_speaker_entries nie wymienia roli editor');

SELECT pg_temp.assert(
  (SELECT count(*) = 1 FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = 'event_speaker_entries'
      AND (COALESCE(p.qual, '') || ' ' || COALESCE(p.with_check, '')) ~ 'is_super_admin'),
  'RLS: polityka event_speaker_entries stoi na admin + is_super_admin');

-- Zapis WYLACZNIE przez RPC: polityka INSERT/UPDATE/DELETE nie istnieje, wiec
-- grant zapisu dla klienta byl by druga, szersza droga do tych wierszy.
SELECT pg_temp.assert(
  NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants g
     WHERE g.table_schema = 'public' AND g.table_name = 'event_speaker_entries'
       AND g.grantee IN ('anon', 'authenticated')
       AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
  ),
  'granty: klient nie ma INSERT/UPDATE/DELETE na event_speaker_entries');

-- Klucze obce ZLOZONE po najemcy: bez nich wiersz moglby wskazac wydarzenie
-- albo prelegenta obcego najemcy, a to jest granica obszaru roboczego firmy.
SELECT pg_temp.assert(
  (SELECT count(*) = 2 FROM pg_constraint c
    WHERE c.conrelid = 'public.event_speaker_entries'::regclass
      AND c.contype = 'f'
      AND array_length(c.conkey, 1) = 2),
  'schemat: oba klucze obce nowej tabeli sa ZLOZONE po (tenant_id, ...)');

-- ---------------------------------------------------------------------------
-- KOLEJNOSC I USUNIECIE - druga polowa powierzchni panelu.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE v_profile uuid; v_n integer;
BEGIN
  PERFORM pg_temp.act_as('40a00000-0000-0000-0000-0000000000a1',
                         '11111111-1111-1111-1111-111111111111');

  SELECT l.speaker_profile_id INTO v_profile
    FROM public.admin_event_speakers_list('40e00000-0000-0000-0000-0000000000a1') l
   WHERE l.person_id IS NOT NULL;

  -- Przenumerowanie CALEJ listy, nie zamiana dwoch wartosci: rzedy legacy maja
  -- `sort_order` DEFAULT 0, wiec zamiana dwoch rownych wartosci jest no-op.
  SELECT public.admin_event_speaker_reorder(jsonb_build_object(
    'event_id', '40e00000-0000-0000-0000-0000000000a1',
    'items', jsonb_build_array(
      jsonb_build_object('speaker_profile_id', v_profile),
      jsonb_build_object('user_id', '40a00000-0000-0000-0000-0000000000a3'))
  )) INTO v_n;
  PERFORM pg_temp.assert(
    (SELECT en.sort_order = 0 FROM public.event_speaker_entries en
      WHERE en.speaker_profile_id = v_profile
        AND en.event_id = '40e00000-0000-0000-0000-0000000000a1'),
    'kolejnosc: przenumerowanie ustawia sort_order = indeks');

  -- Usuniecie zdejmuje prelegenta z WYDARZENIA, a nie z platformy: kartoteka
  -- jest dokumentem obecnosci, a ta sama osoba wystepuje na kolejnych.
  PERFORM pg_temp.assert(
    public.admin_event_speaker_remove(jsonb_build_object(
      'event_id', '40e00000-0000-0000-0000-0000000000a1',
      'speaker_profile_id', v_profile)),
    'usuniecie: zdejmuje wpis osoby BEZ konta po speaker_profile_id');
  PERFORM pg_temp.assert(
    (SELECT count(*) = 1 FROM public.event_people pe
      WHERE pe.email_norm = 'lech.kurklinski@sgh.example'),
    'usuniecie: wiersz kartoteki ZOSTAJE po zdjeciu z wydarzenia');

  -- Usuniecie po koncie zdejmuje TAKZE rzad legacy, inaczej osoba wraca
  -- po odswiezeniu z drugiego rejestru.
  PERFORM pg_temp.assert(
    public.admin_event_speaker_remove(jsonb_build_object(
      'event_id', '40e00000-0000-0000-0000-0000000000a1',
      'user_id', '40a00000-0000-0000-0000-0000000000a3')),
    'usuniecie: po user_id zdejmuje wpis nowy I rzad legacy');
  PERFORM pg_temp.assert(
    (SELECT count(*) = 0 FROM public.admin_event_speakers_list(
       '40e00000-0000-0000-0000-0000000000a1')),
    'usuniecie: lista wydarzenia jest pusta, nikt nie wraca z drugiego rejestru');
END $do$;

-- ---------------------------------------------------------------------------
-- WALIDACJA PAYLOADU I GRANICE NAJEMCY - kazda odmowa ma SWOJ powod.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_raises_like(
  $$SELECT public.admin_event_speaker_upsert(
      jsonb_build_object('first_name', 'A', 'last_name', 'B'))$$,
  'event_id is required',
  'payload: brak event_id odrzucony z nazwanym powodem');

SELECT pg_temp.assert_raises_like(
  $$SELECT public.admin_event_speaker_upsert(
      jsonb_build_object('event_id', '40e00000-0000-0000-0000-0000000000a1'))$$,
  'first_name and last_name are required',
  'payload: brak imienia i nazwiska odrzucony z nazwanym powodem');

SELECT pg_temp.assert_raises_like(
  $$SELECT public.admin_event_speaker_upsert(jsonb_build_object(
      'event_id', gen_random_uuid(), 'first_name', 'A', 'last_name', 'B'))$$,
  'event not found in tenant',
  'najemca: obce wydarzenie odrzucone z nazwanym powodem');

SELECT pg_temp.assert_raises_like(
  $$SELECT public.admin_event_speaker_upsert(jsonb_build_object(
      'event_id', '40e00000-0000-0000-0000-0000000000a1',
      'user_id', gen_random_uuid()))$$,
  'profile not found in tenant',
  'najemca: obce konto odrzucone z nazwanym powodem');

SELECT pg_temp.assert_raises_like(
  $$SELECT public.admin_event_speaker_upsert(jsonb_build_object(
      'event_id', '40e00000-0000-0000-0000-0000000000a1',
      'group_id', gen_random_uuid(),
      'first_name', 'A', 'last_name', 'B'))$$,
  'group not found in event',
  'wydarzenie: obca grupa odrzucona z nazwanym powodem');

-- Zdjecie idzie do atrybutu `src` na stronie z https, wiec adres bez
-- szyfrowania nie tyle brzydko wyglada, co NIE ISTNIEJE dla przegladarki.
SELECT pg_temp.assert_raises_like(
  $$SELECT public.admin_event_speaker_upsert(jsonb_build_object(
      'event_id', '40e00000-0000-0000-0000-0000000000a1',
      'first_name', 'Ktos', 'last_name', 'Bez-Https',
      'photo_url', 'http://cdn.example.org/x.jpg'))$$,
  'event_people_photo_url_https',
  'CHECK: photo_url bez https odrzucony');

ROLLBACK;
