-- ============================================================================
-- PODCAST: PONOWNE ZASTOSOWANIE 20260725090500 (METADANE APPLE PODCASTS).
--
-- INCYDENT (zmierzony 2026-10-09). `/podcasts` odpowiadala HTTP 200 z
-- `cache-control: private, no-store` i komunikatem "Nie udalo sie zaladowac
-- podcastow" przy KAZDYM zadaniu - takze Googlebota. Zapytanie listy
-- najnowszych odcinkow (`latestPodcastsQueryOptions`, PODCAST_FIELDS) konczylo
-- sie na produkcyjnym PostgREST natychmiastowym bledem:
--
--   400 {"code":"42703","message":"column podcasts.explicit does not exist"}
--
-- Sondy anonimowe tego samego dnia: `podcasts.explicit`,
-- `podcasts.episode_type`, `podcast_shows.itunes_author` i
-- `podcast_settings.itunes_category` -> 42703; kolumny sprzed tej migracji
-- (`chapters`, `show_id`, `program_id`) -> 200. Migracja 20260725090500 NIGDY
-- nie wykonala sie na produkcji: nie ma jej kopii z pipeline'u (zadnego
-- bliznika z UUID w nazwie), a `src/integrations/supabase/types.ts`,
-- generowany z produkcyjnej bazy i przegenerowany jeszcze 2026-09-21, nie zna
-- zadnej z jej 20 kolumn - ta sama lista siedzi jako "zamrozony dlug" w
-- `scripts/check-generated-types-freshness.ts`, czytana dotad jako nieswieze
-- typy, a nie jako brakujaca migracja.
--
-- DLACZEGO ZADNA BRAMKA TEGO NIE ZLAPALA. Migracja dodaje wylacznie KOLUMNY:
-- kontrakt obiektowy (`check:db-contract`) sprawdza tabele, widoki i RPC,
-- a rejestr (`check:migration-ledger`) egzekwuje wersje dopiero od baseline
-- 20260825230232. Kontrakt TS <-> SQL (pgTAP) biegnie na bazie odtworzonej
-- z migracji, w ktorej kolumny sa. Ten plik ma wersje POWYZEJ baseline, wiec
-- bramka rejestru po wdrozeniu potwierdzi, ze tym razem SQL faktycznie poszedl.
--
-- SKUTKI BRAKU (poza katalogiem /podcasts): strona odcinka, kanaly RSS
-- (/podcast/rss.xml, /podcasts/{show}/rss.xml), sekcje podcastow na stronach
-- kategorii i autora oraz panel /admin/podcasts - wszystkie czytaja te kolumny.
--
-- CO ROBI. Te same instrukcje co 20260725090500 (kanal sieciowy, program,
-- odcinek; wartosci domyslne i CHECK bez zmian), plus przeladowanie cache'u
-- schematu PostgREST, zeby nowe kolumny byly widoczne bez restartu API.
-- Uzasadnienie domenowe (wymagania Apple Podcasts Connect, taksonomia
-- kategorii walidowana w aplikacji) zostaje w pliku oryginalu.
--
-- IDEMPOTENTNA: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS przed ADD.
-- Na bazie, ktora 20260725090500 juz ma (CI, swieza replika), nie zmienia nic.
-- ============================================================================

-- 1. Kanal sieciowy (singleton per tenant)
ALTER TABLE public.podcast_settings
  ADD COLUMN IF NOT EXISTS itunes_author       text,
  ADD COLUMN IF NOT EXISTS itunes_owner_name   text,
  ADD COLUMN IF NOT EXISTS itunes_owner_email  text,
  ADD COLUMN IF NOT EXISTS itunes_category     text NOT NULL DEFAULT 'News',
  ADD COLUMN IF NOT EXISTS itunes_subcategory  text DEFAULT 'Politics',
  ADD COLUMN IF NOT EXISTS itunes_explicit     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS itunes_type         text NOT NULL DEFAULT 'episodic',
  ADD COLUMN IF NOT EXISTS itunes_image_url    text,
  ADD COLUMN IF NOT EXISTS itunes_copyright    text;

ALTER TABLE public.podcast_settings
  DROP CONSTRAINT IF EXISTS podcast_settings_itunes_type_check;
ALTER TABLE public.podcast_settings
  ADD CONSTRAINT podcast_settings_itunes_type_check
  CHECK (itunes_type IN ('episodic', 'serial'));

COMMENT ON COLUMN public.podcast_settings.itunes_owner_email IS
  'E-mail wlasciciela kanalu (<itunes:owner><itunes:email>). Apple wysyla na niego kod weryfikacyjny przy przejmowaniu kanalu w Podcasts Connect - bez tego nie da sie potwierdzic wlasnosci.';
COMMENT ON COLUMN public.podcast_settings.itunes_category IS
  'Kategoria z zamknietej taksonomii Apple (walidacja: src/lib/seo/applePodcastCategories.ts). Wymagana przez Apple na poziomie <channel>.';
COMMENT ON COLUMN public.podcast_settings.itunes_image_url IS
  'Okladka kanalu (<itunes:image>) - wymagana, kwadrat 1400x1400..3000x3000 px, JPEG/PNG. Program moze ja nadpisac wlasna okladka.';

-- 2. Program (kanal per seria)
ALTER TABLE public.podcast_shows
  ADD COLUMN IF NOT EXISTS itunes_author       text,
  ADD COLUMN IF NOT EXISTS itunes_owner_name   text,
  ADD COLUMN IF NOT EXISTS itunes_owner_email  text,
  ADD COLUMN IF NOT EXISTS itunes_category     text,
  ADD COLUMN IF NOT EXISTS itunes_subcategory  text,
  ADD COLUMN IF NOT EXISTS itunes_explicit     boolean,
  ADD COLUMN IF NOT EXISTS itunes_type         text,
  ADD COLUMN IF NOT EXISTS itunes_complete     boolean NOT NULL DEFAULT false;

ALTER TABLE public.podcast_shows
  DROP CONSTRAINT IF EXISTS podcast_shows_itunes_type_check;
ALTER TABLE public.podcast_shows
  ADD CONSTRAINT podcast_shows_itunes_type_check
  CHECK (itunes_type IS NULL OR itunes_type IN ('episodic', 'serial'));

COMMENT ON COLUMN public.podcast_shows.itunes_explicit IS
  'Nadpisanie <itunes:explicit> dla tego programu. NULL = dziedzicz z podcast_settings.';
COMMENT ON COLUMN public.podcast_shows.itunes_complete IS
  'Program zakonczony (<itunes:complete>yes</itunes:complete>) - Apple przestaje szukac nowych odcinkow.';

-- 3. Odcinek
ALTER TABLE public.podcasts
  ADD COLUMN IF NOT EXISTS explicit     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS episode_type text NOT NULL DEFAULT 'full';

ALTER TABLE public.podcasts
  DROP CONSTRAINT IF EXISTS podcasts_episode_type_check;
ALTER TABLE public.podcasts
  ADD CONSTRAINT podcasts_episode_type_check
  CHECK (episode_type IN ('full', 'trailer', 'bonus'));

COMMENT ON COLUMN public.podcasts.episode_type IS
  '<itunes:episodeType>: full (odcinek), trailer (zwiastun), bonus (material dodatkowy).';
COMMENT ON COLUMN public.podcasts.explicit IS
  '<itunes:explicit> na poziomie odcinka. Apple traktuje brak wartosci jak dziedziczenie z kanalu, my zapisujemy jawnie.';

-- 4. Cache schematu PostgREST: bez tego API przez chwile dalej odpowiada 42703.
NOTIFY pgrst, 'reload schema';
