-- ============================================================================
-- PODCAST RSS: metadane wymagane przez Apple Podcasts Connect.
--
-- Kanal /podcast/rss.xml i /podcasts/{show}/rss.xml nie przechodzil walidacji
-- Apple - brakowalo WSZYSTKICH tagow, ktore Apple oznacza jako wymagane na
-- poziomie <channel>, poza <title>, <description> i <language>:
--
--   * <itunes:category>  - wymagany; bez niego kanal nie zostanie przyjety,
--   * <itunes:explicit>  - wymagany; brak = odrzucenie,
--   * <itunes:image>     - wymagany (1400x1400..3000x3000 JPEG/PNG);
--                          /podcast/rss.xml nie przekazywal go WCALE (builder
--                          mial pole opcjonalne, a trasa go nie ustawiala),
--   * <itunes:owner>     - e-mail wlasciciela; Apple wysyla na niego kod
--                          weryfikacyjny przy przejmowaniu kanalu, wiec bez
--                          niego nie da sie potwierdzic wlasnosci,
--   * <itunes:author>    - nazwa wydawcy prezentowana w katalogu.
--
-- Nie bylo tez gdzie tego zapisac - `podcast_settings` trzymalo wylacznie
-- ustawienia odtwarzacza i linki do katalogow, a `podcast_shows` opisy PL/EN.
-- Migracja dokleja te pola na obu poziomach (kanal sieciowy + per program) oraz
-- `explicit` / `episode_type` na odcinku (Apple: <itunes:explicit> i
-- <itunes:episodeType> full|trailer|bonus na <item>).
--
-- Wartosci per program NADPISUJA globalne - kazdy program moze miec innego
-- prowadzacego i inna kategorie, a globalne sluza jako sensowny domyslny.
--
-- Kategorie: Apple przyjmuje WYLACZNIE wartosci ze swojej zamknietej taksonomii
-- (np. "News" + podkategoria "Politics"). Walidacje trzyma warstwa aplikacji
-- (`src/lib/seo/applePodcastCategories.ts` - jedna lista dla buildera RSS i dla
-- selecta w /admin/podcasts), a nie CHECK w bazie: taksonomia Apple zmienia sie
-- niezaleznie od naszych migracji, a nieznana wartosc ma degradowac do
-- domyslnej, nie blokowac zapisu odcinka.
-- ============================================================================

-- ── 1. Kanal sieciowy (singleton per tenant) ────────────────────────────────
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

-- ── 2. Program (kanal per seria) ────────────────────────────────────────────
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

-- ── 3. Odcinek ──────────────────────────────────────────────────────────────
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
