-- ============================================================================
-- 97_speaker_bio_gate - PRZELACZNIK „POKAZ OPIS SCENICZNY” UKRYWA OPIS,
--                       A NIE ODSLANIA GO Z DRUGIEGO REJESTRU.
--
-- PO CO TEN PLIK ISTNIEJE
--
-- `event_speakers_public` z 20260826180000 dolaczala nakladke sceniczna
-- Z FILTREM `AND sp.is_public`, a biografie wybierala jako
-- `COALESCE(sp.bio_pl, pe.bio_pl)`. Zlozenie tych dwoch faktow dawalo
-- zachowanie ODWROTNE do etykiety w panelu: wylaczenie „Pokaz opis sceniczny”
-- ukrywalo bio z NAKLADKI i w tej samej chwili ODSLANIALO bio z KARTOTEKI
-- `event_people` - ten sam tekst o tej samej osobie, tylko z drugiego rejestru.
-- Funkcja ma `GRANT EXECUTE ... TO anon`, wiec czytal go kazdy gosc.
--
-- Naglowek tamtej migracji (linie 773-776) opisywal kontrakt POPRAWNIE
-- („ukrywa OPIS SCENICZNY, a nie osobe”), wiec bramka tekstowa nie miala jak
-- tego zobaczyc - komentarz i kod mowily dwie rozne rzeczy, a zgodne byly
-- tylko na papierze. Napraw wnosi 20260827150000_event_speakers_public_bio_gate.
--
-- CZEGO TU DOWODZIMY - piec rzeczy, kazda z drugim bokiem:
--   (1) nakladka NIEPUBLICZNA osoby BEZ konta nie oddaje bio, MIMO ze kartoteka
--       je ma (to jest ta linia, ktora dzis przecieka);
--   (2) ta sama osoba NADAL WRACA jako wiersz, z nazwiskiem i zdjeciem - bramka
--       ukrywa OPIS, nie OSOBE. Bez tej asercji „naprawa” przez wyrzucenie
--       wiersza z listy tez byla by zielona, a byla by innym defektem;
--   (3) nakladka PUBLICZNA osoby bez konta ODDAJE bio z kartoteki - regresja:
--       bramka nie moze zabrac biografii, ktora ma byc widoczna (to zachowanie
--       utrwala tez 40_speakers, tu stoi jawnie obok swojego drugiego boku);
--   (4) prelegent Z KONTEM i publiczna nakladka oddaje bio z nakladki;
--   (5) prelegent Z KONTEM i nakladka niepubliczna nie oddaje bio - to dzialalo
--       JUZ PRZED naprawa (konto nie ma wiersza w `event_people`, wiec fallback
--       nie mial na co zejsc). Asercja pilnuje, zeby przepisanie CALEGO ciala
--       funkcji `CREATE OR REPLACE`-em tego nie zepsulo po drodze.
--
-- SPRZATANIE. Caly plik pracuje w transakcji zakonczonej ROLLBACK-iem.
-- ============================================================================

\echo '== 97 bramka biografii: is_public ukrywa OPIS, nie OSOBE =='

BEGIN;

-- ---------------------------------------------------------------------------
-- ATRAPY SPOZA MODULU, ZAKLADANE W TEJ TRANSAKCJI (i cofane ROLLBACK-iem)
--
-- Ten sam blok, co w 40_speakers i z tego samego powodu: `event_speakers_public`
-- czyta CZTERY obiekty nalezace do innych modulow (`speaker_profiles`
-- w wersji pelnej, `author_profiles`, `profile_badges` i legacy
-- `event_speakers`), a `harness.sql` stawia tylko wezsza `speaker_profiles`.
-- Duplikacja jest SWIADOMA: transakcja 40_speakers konczy sie ROLLBACK-iem,
-- wiec jej atrapy NIE ISTNIEJA dla tego pliku, a kolejnosc plikow w petli nie
-- moze byc zaleznoscia (`--only 97_` musi dzialac samodzielnie).
--
-- KSZTALT PRZEPISANY Z ORYGINALOW (20260713091000:19-25, 20260714130000:287-292,
-- 20260727200000:31-66) - atrapa szersza od produkcji przepuszczalaby blad,
-- ktory na produkcji wywali 42703 albo 42P01.
-- ---------------------------------------------------------------------------
ALTER TABLE public.speaker_profiles
  ADD COLUMN IF NOT EXISTS topics_pl text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS topics_en text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS languages text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS talks_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating numeric(2,1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reviews_count integer NOT NULL DEFAULT 0;

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

-- Atrapa musi byc PRAWDZIWA, nie deklarowana: literowka w nazwie kolumny wyzej
-- dawalaby cichy brak, a kolejne asercje mowilyby o czyms innym, niz mysla.
SELECT pg_temp.assert(
  (SELECT count(*) = 3 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'speaker_profiles'
      AND column_name IN ('topics_pl', 'languages', 'talks_count')),
  '97 atrapa: speaker_profiles ma kolumny czytane przez event_speakers_public');

SELECT pg_temp.assert(
  (SELECT count(*) = 3 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND c.relname IN ('author_profiles', 'profile_badges', 'event_speakers')),
  '97 atrapa: trzy tabele spoza modulu stoja');

-- ---------------------------------------------------------------------------
-- SCENOGRAFIA: CZTERY KOMBINACJE (konto / kartoteka) x (is_public t / f)
--
-- Wpisy zakladamy WPROST, a nie przez `admin_event_speaker_upsert`: tamta droga
-- ma wlasny plik asercji (40_speakers), a tutaj przedmiotem dowodu jest SAMA
-- PROJEKCJA PUBLICZNA. Seed przez RPC wnosilby do dowodu bramke administracyjna
-- i przy jej zmianie ten plik czerwienil by sie z powodu, o ktorym nie mowi.
--
-- BIO SIEDZI W OBU REJESTRACH ROZNE. `event_people.bio_pl` jest wpisem
-- z kartoteki („Ekonomista, kartoteka.”), `speaker_profiles.bio_pl` - wersja
-- sceniczna („Wersja sceniczna.”). Gdyby oba mialy ten sam napis, asercja
-- nie odroznialaby „bio wyszlo z nakladki” od „bio wyszlo z kartoteki” - a to
-- jest cala tresc tego defektu.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('97a00000-0000-0000-0000-0000000000c1', 'bio.konto.jawny@example.org'),
  ('97a00000-0000-0000-0000-0000000000c2', 'bio.konto.ukryty@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, display_name, slug) VALUES
  ('97a00000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111',
   'Cezary Jawny', 'bio-cezary-jawny'),
  ('97a00000-0000-0000-0000-0000000000c2', '11111111-1111-1111-1111-111111111111',
   'Dorota Ukryta', 'bio-dorota-ukryta')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status) VALUES
  ('97e00000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111',
   'bio-kongres', 'Kongres bio', 'Bio congress', now() + interval '20 days', 'published')
ON CONFLICT (id) DO NOTHING;

-- Dwie OSOBY BEZ KONTA. Obie maja bio w kartotece i obie maja zdjecie -
-- roznia sie WYLACZNIE flaga na nakladce, wiec kazda roznica w wyniku funkcji
-- jest przypisana tej fladze i niczemu innemu.
INSERT INTO public.event_people
  (id, tenant_id, first_name, last_name, email, job_title, company_text, photo_url, bio_pl, bio_en)
VALUES
  ('97700000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111',
   'Anna', 'Ukrywana', 'anna.ukrywana@example.org', 'Profesorka', 'SGH',
   'https://cdn.example.org/anna.jpg',
   'Ekonomistka, kartoteka.', 'Economist, registry.'),
  ('97700000-0000-0000-0000-0000000000b2', '11111111-1111-1111-1111-111111111111',
   'Bartosz', 'Jawny', 'bartosz.jawny@example.org', 'Prezes', 'NES',
   'https://cdn.example.org/bartosz.jpg',
   'Prezes, kartoteka.', 'CEO, registry.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.speaker_profiles
  (id, tenant_id, user_id, person_id, headline_pl, bio_pl, bio_en, is_public)
VALUES
  -- (1)(2) BEZ konta, opis sceniczny WYLACZONY. Nakladka nie ma wlasnego bio -
  -- gdyby miala, nie dowiedzielibysmy sie, ktore zrodlo przeciekalo.
  ('97500000-0000-0000-0000-0000000000f1', '11111111-1111-1111-1111-111111111111',
   NULL, '97700000-0000-0000-0000-0000000000b1', 'Panel o bankowosci', NULL, NULL, false),
  -- (3) BEZ konta, opis sceniczny WLACZONY, bio TYLKO w kartotece.
  ('97500000-0000-0000-0000-0000000000f2', '11111111-1111-1111-1111-111111111111',
   NULL, '97700000-0000-0000-0000-0000000000b2', 'Panel o energii', NULL, NULL, true),
  -- (4) Z kontem, opis sceniczny WLACZONY, bio W NAKLADCE.
  ('97500000-0000-0000-0000-0000000000f3', '11111111-1111-1111-1111-111111111111',
   '97a00000-0000-0000-0000-0000000000c1', NULL, 'Panel o rynkach',
   'Wersja sceniczna jawna.', 'Stage version, public.', true),
  -- (5) Z kontem, opis sceniczny WYLACZONY, bio W NAKLADCE.
  ('97500000-0000-0000-0000-0000000000f4', '11111111-1111-1111-1111-111111111111',
   '97a00000-0000-0000-0000-0000000000c2', NULL, 'Panel o obronnosci',
   'Wersja sceniczna ukryta.', 'Stage version, hidden.', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_speaker_entries (tenant_id, event_id, speaker_profile_id, sort_order) VALUES
  ('11111111-1111-1111-1111-111111111111', '97e00000-0000-0000-0000-0000000000e1',
   '97500000-0000-0000-0000-0000000000f1', 0),
  ('11111111-1111-1111-1111-111111111111', '97e00000-0000-0000-0000-0000000000e1',
   '97500000-0000-0000-0000-0000000000f2', 1),
  ('11111111-1111-1111-1111-111111111111', '97e00000-0000-0000-0000-0000000000e1',
   '97500000-0000-0000-0000-0000000000f3', 2),
  ('11111111-1111-1111-1111-111111111111', '97e00000-0000-0000-0000-0000000000e1',
   '97500000-0000-0000-0000-0000000000f4', 3)
ON CONFLICT (tenant_id, event_id, speaker_profile_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- BRAMKA BIOGRAFII, WIDZIANA OCZAMI ANONIMA
--
-- Aktorem jest ANONIM, bo to jest plaszczyzna TRESCI i wlasnie ten aktor ma
-- `GRANT EXECUTE`. Asercja wykonana jako administrator dowodzilaby czegos
-- innego, niz mowi jej nazwa.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE r record; v_n integer;
BEGIN
  PERFORM pg_temp.act_as();  -- anonim

  SELECT count(*) INTO v_n
    FROM public.event_speakers_public(jsonb_build_object('slug', 'bio-kongres'));
  PERFORM pg_temp.assert(v_n = 4,
    '97 front: cztery karty (dwie osoby bez konta, dwa konta) - dostano: ' || v_n);

  -- (1) TO JEST TA LINIA, KTORA PRZECIEKALA. Nakladka niepubliczna, bio wpisane
  -- WYLACZNIE w kartotece - przed naprawa `COALESCE` schodzil na `pe.bio_pl`
  -- i oddawal tekst, ktorego ukrycie obiecywala etykieta przelacznika.
  SELECT * INTO r FROM public.event_speakers_public(jsonb_build_object('slug', 'bio-kongres'))
   WHERE person_id = '97700000-0000-0000-0000-0000000000b1';
  PERFORM pg_temp.assert(r.bio_pl IS NULL,
    '97 bramka: opis WYLACZONY nie oddaje bio z kartoteki (dostano: '
      || COALESCE(r.bio_pl, '<NULL>') || ')');
  PERFORM pg_temp.assert(r.bio_en IS NULL,
    '97 bramka: to samo w drugim jezyku - bio_en tez nie wychodzi');

  -- (2) DRUGI BOK BRAMKI. „Naprawa” polegajaca na wyrzuceniu wiersza z listy
  -- zdalaby asercje (1) i byla by innym defektem: kontrakt migracji mowi
  -- „ukrywa OPIS SCENICZNY, a nie osobe”, a o obecnosci na liscie decyduje WPIS
  -- do rejestru prelegentow, nie flaga nakladki.
  PERFORM pg_temp.assert(r.display_name = 'Anna Ukrywana',
    '97 bramka: osoba ZOSTAJE na liscie z nazwiskiem z kartoteki');
  PERFORM pg_temp.assert(r.avatar_url = 'https://cdn.example.org/anna.jpg',
    '97 bramka: zdjecie idzie BEZ WARUNKU - flaga ukrywa opis, nie osobe');
  -- Stanowisko i firma to IDENTYFIKACJA („kto to jest”), nie opis sceniczny
  -- („o czym bedzie mowic”) - granica SWIADOMA, opisana w naglowku
  -- 20260827150000. Asercja stoi tu po to, zeby jej ewentualne przesuniecie
  -- bylo DECYZJA, a nie skutkiem ubocznym.
  PERFORM pg_temp.assert(r.job_title = 'Profesorka' AND r.company = 'SGH',
    '97 granica: stanowisko i firma ida bez warunku (identyfikacja, nie opis)');
  -- Naglowek i tematy czytaja WYLACZNIE `sp.*`, wiec przy nietrafionym join-ie
  -- sa puste SAME Z SIEBIE - bez ani jednego `CASE`.
  PERFORM pg_temp.assert(r.headline_pl IS NULL,
    '97 bramka: rola sceniczna z niepublicznej nakladki nie wychodzi');
  PERFORM pg_temp.assert(r.topics_pl = '{}'::text[] AND r.languages = '{}'::text[],
    '97 bramka: tematy i jezyki z niepublicznej nakladki nie wychodza');

  -- (3) REGRESJA W DRUGA STRONE. Bramka nie moze zabrac biografii, ktora ma
  -- byc widoczna: nakladka PUBLICZNA bez wlasnego bio dalej schodzi na kartoteke.
  SELECT * INTO r FROM public.event_speakers_public(jsonb_build_object('slug', 'bio-kongres'))
   WHERE person_id = '97700000-0000-0000-0000-0000000000b2';
  PERFORM pg_temp.assert(r.bio_pl = 'Prezes, kartoteka.',
    '97 regresja: opis WLACZONY oddaje bio z kartoteki (dostano: '
      || COALESCE(r.bio_pl, '<NULL>') || ')');
  PERFORM pg_temp.assert(r.bio_en = 'CEO, registry.',
    '97 regresja: to samo w drugim jezyku');
  PERFORM pg_temp.assert(r.headline_pl = 'Panel o energii',
    '97 regresja: rola sceniczna z publicznej nakladki wychodzi');

  -- (4) KONTO Z PUBLICZNA NAKLADKA - bio z nakladki, bez zmian.
  SELECT * INTO r FROM public.event_speakers_public(jsonb_build_object('slug', 'bio-kongres'))
   WHERE user_id = '97a00000-0000-0000-0000-0000000000c1';
  PERFORM pg_temp.assert(r.bio_pl = 'Wersja sceniczna jawna.',
    '97 konto: publiczna nakladka oddaje wlasne bio (dostano: '
      || COALESCE(r.bio_pl, '<NULL>') || ')');

  -- (5) KONTO Z NAKLADKA NIEPUBLICZNA - dzialalo JUZ PRZED naprawa (konto nie
  -- ma wiersza w `event_people`, wiec fallback nie mial na co zejsc). Asercja
  -- pilnuje, zeby przepisanie CALEGO ciala funkcji tego nie zepsulo po drodze.
  SELECT * INTO r FROM public.event_speakers_public(jsonb_build_object('slug', 'bio-kongres'))
   WHERE user_id = '97a00000-0000-0000-0000-0000000000c2';
  PERFORM pg_temp.assert(r.bio_pl IS NULL AND r.bio_en IS NULL,
    '97 konto: niepubliczna nakladka nie oddaje bio (dostano: '
      || COALESCE(r.bio_pl, '<NULL>') || ')');
  PERFORM pg_temp.assert(r.display_name = 'Dorota Ukryta',
    '97 konto: osoba z niepubliczna nakladka ZOSTAJE na liscie');
END $do$;

-- ---------------------------------------------------------------------------
-- KONTAKT DO OSOBY BEZ KONTA NIE MA NA TEJ PLASZCZYZNIE KONSUMENTA
--
-- `event_people` niesie `email` i `phone`. Gdyby ktorekolwiek z nich weszlo
-- kiedys do `RETURNS TABLE` tej funkcji, byl by to wyciek POWAZNIEJSZY od
-- naprawianego: adres i telefon nie maja na stronie publicznej zadnego
-- odbiorcy, a `GRANT EXECUTE ... TO anon` oddawal by je kazdemu.
--
-- Asercja czyta KATALOG, a nie wynik: pyta o KSZTALT kontraktu, wiec czerwieni
-- sie w chwili dopisania kolumny, a nie dopiero wtedy, gdy jakis wiersz ma
-- wypelniony telefon.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  (SELECT count(*) = 0
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN unnest(p.proargnames) AS a(name) ON true
    WHERE n.nspname = 'public'
      AND p.proname = 'event_speakers_public'
      AND a.name ~* '(email|phone|telefon)'),
  '97 kontrakt: event_speakers_public NIE oddaje ani email, ani phone');

-- Liczba kolumn wyniku jest czescia kontraktu (`check:rpc-contract` i widget
-- buildera): przepisanie ciala `CREATE OR REPLACE`-em nie moze jej ruszyc.
SELECT pg_temp.assert(
  (SELECT count(*) = 22
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN unnest(p.proargnames) AS a(name) ON true
    WHERE n.nspname = 'public' AND p.proname = 'event_speakers_public'),
  '97 kontrakt: sygnatura + 21 kolumn RETURNS TABLE bez zmian');

ROLLBACK;
