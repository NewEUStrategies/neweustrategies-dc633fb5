-- ============================================================================
-- HUB EKSPERTA (wzorzec profili think-tank): ekspert jako pełnoprawny obiekt
-- systemowy, nie tekstowe pole "autor". Profil /author/$slug staje się
-- hubem treściowym agregującym WSZYSTKIE relacje eksperta:
--
--   ekspert ── publikacje (posts.author_id + post_authors — współautorstwo)
--          ├── wydarzenia (events.host_user_id + event_speakers)
--          ├── podcasty   (podcasts.author_id)
--          ├── programy   (program_members → programs; też projekty
--          │               i departamenty — kolumna kind)
--          ├── obszary    (expert_expertise_areas → expertise_areas)
--          ├── regiony    (przez materiały: post_regions / *.region_id)
--          └── media      (media_mentions — "W mediach" / In the News)
--
-- Filtry materiałów (typ / temat / region / data / program-departament)
-- działają na złączeniach, nie na polach tekstowych.
--
-- Status eksperta: odznaka 'expert' w profile_badges (nadawana przez admina)
-- + publiczny author_profiles (is_public). Brak drugiego źródła prawdy.
--
-- Wszystko idempotentne (IF NOT EXISTS / DROP POLICY IF EXISTS / ON CONFLICT).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. PROGRAMS - programy badawcze, projekty i departamenty
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name_pl text NOT NULL,
  name_en text NOT NULL,
  kind text NOT NULL DEFAULT 'program'
    CHECK (kind IN ('program', 'project', 'department')),
  description_pl text,
  description_en text,
  cover_url text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug),
  CHECK (slug ~ '^[a-z0-9-]{2,80}$'),
  CHECK (btrim(name_pl) <> '' AND btrim(name_en) <> '')
);

CREATE INDEX IF NOT EXISTS idx_programs_tenant_active
  ON public.programs (tenant_id, sort_order) WHERE is_active;

DROP TRIGGER IF EXISTS programs_set_updated_at ON public.programs;
CREATE TRIGGER programs_set_updated_at
  BEFORE UPDATE ON public.programs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON public.programs TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.programs TO authenticated;
GRANT ALL ON public.programs TO service_role;
ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "programs public read" ON public.programs;
CREATE POLICY "programs public read" ON public.programs
  FOR SELECT TO anon, authenticated
  USING (tenant_id = (SELECT public.public_tenant_id()));

DROP POLICY IF EXISTS "programs staff write" ON public.programs;
CREATE POLICY "programs staff write" ON public.programs
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

-- ---------------------------------------------------------------------------
-- 2. PROGRAM_MEMBERS - funkcja eksperta w programie ("Dyrektor", "Senior
--    Fellow"...). Widoczne w nagłówku profilu jako funkcje organizacyjne.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.program_members (
  program_id uuid NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_pl text,
  role_en text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (program_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_program_members_user
  ON public.program_members (user_id);

GRANT SELECT ON public.program_members TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.program_members TO authenticated;
GRANT ALL ON public.program_members TO service_role;
ALTER TABLE public.program_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "program_members public read" ON public.program_members;
CREATE POLICY "program_members public read" ON public.program_members
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "program_members staff write" ON public.program_members;
CREATE POLICY "program_members staff write" ON public.program_members
  FOR ALL TO authenticated
  USING (
    public.has_role((SELECT auth.uid()), 'admin'::app_role)
    OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
  )
  WITH CHECK (
    public.has_role((SELECT auth.uid()), 'admin'::app_role)
    OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
  );

-- ---------------------------------------------------------------------------
-- 3. Relacje materiał ↔ program (wpisy wiele-do-wielu; podcasty i wydarzenia
--    pojedynczą kolumną - jeden program na odcinek/wydarzenie).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.post_programs (
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, program_id)
);
CREATE INDEX IF NOT EXISTS idx_post_programs_program
  ON public.post_programs (program_id);

GRANT SELECT ON public.post_programs TO anon, authenticated;
GRANT INSERT, DELETE ON public.post_programs TO authenticated;
GRANT ALL ON public.post_programs TO service_role;
ALTER TABLE public.post_programs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "post_programs public read" ON public.post_programs;
CREATE POLICY "post_programs public read" ON public.post_programs
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "post_programs staff manage" ON public.post_programs;
CREATE POLICY "post_programs staff manage" ON public.post_programs
  FOR ALL TO authenticated
  USING (
    public.has_role((SELECT auth.uid()), 'admin'::app_role)
    OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    OR public.has_role((SELECT auth.uid()), 'author'::app_role)
  )
  WITH CHECK (
    public.has_role((SELECT auth.uid()), 'admin'::app_role)
    OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    OR public.has_role((SELECT auth.uid()), 'author'::app_role)
  );

ALTER TABLE public.podcasts
  ADD COLUMN IF NOT EXISTS program_id uuid REFERENCES public.programs(id) ON DELETE SET NULL;
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS program_id uuid REFERENCES public.programs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_podcasts_program ON public.podcasts (program_id)
  WHERE program_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_program ON public.events (program_id)
  WHERE program_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. REGIONS - taksonomia regionów + relacje z materiałami
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.regions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name_pl text NOT NULL,
  name_en text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug),
  CHECK (slug ~ '^[a-z0-9-]{2,80}$')
);

GRANT SELECT ON public.regions TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.regions TO authenticated;
GRANT ALL ON public.regions TO service_role;
ALTER TABLE public.regions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "regions public read" ON public.regions;
CREATE POLICY "regions public read" ON public.regions
  FOR SELECT TO anon, authenticated
  USING (tenant_id = (SELECT public.public_tenant_id()));

DROP POLICY IF EXISTS "regions staff write" ON public.regions;
CREATE POLICY "regions staff write" ON public.regions
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

CREATE TABLE IF NOT EXISTS public.post_regions (
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  region_id uuid NOT NULL REFERENCES public.regions(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, region_id)
);
CREATE INDEX IF NOT EXISTS idx_post_regions_region
  ON public.post_regions (region_id);

GRANT SELECT ON public.post_regions TO anon, authenticated;
GRANT INSERT, DELETE ON public.post_regions TO authenticated;
GRANT ALL ON public.post_regions TO service_role;
ALTER TABLE public.post_regions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "post_regions public read" ON public.post_regions;
CREATE POLICY "post_regions public read" ON public.post_regions
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "post_regions staff manage" ON public.post_regions;
CREATE POLICY "post_regions staff manage" ON public.post_regions
  FOR ALL TO authenticated
  USING (
    public.has_role((SELECT auth.uid()), 'admin'::app_role)
    OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    OR public.has_role((SELECT auth.uid()), 'author'::app_role)
  )
  WITH CHECK (
    public.has_role((SELECT auth.uid()), 'admin'::app_role)
    OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    OR public.has_role((SELECT auth.uid()), 'author'::app_role)
  );

ALTER TABLE public.podcasts
  ADD COLUMN IF NOT EXISTS region_id uuid REFERENCES public.regions(id) ON DELETE SET NULL;
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS region_id uuid REFERENCES public.regions(id) ON DELETE SET NULL;

-- events ma granty KOLUMNOWE - nowe kolumny wymagają jawnego rozszerzenia
-- (bez tego anon/authenticated nie odczytają program_id/region_id).
GRANT SELECT (program_id, region_id) ON public.events TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Współautorzy wpisów i prelegenci wydarzeń - profil agreguje także
--    materiały, w których ekspert nie jest głównym autorem/gospodarzem.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.post_authors (
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_post_authors_user
  ON public.post_authors (user_id);

GRANT SELECT ON public.post_authors TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.post_authors TO authenticated;
GRANT ALL ON public.post_authors TO service_role;
ALTER TABLE public.post_authors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "post_authors public read" ON public.post_authors;
CREATE POLICY "post_authors public read" ON public.post_authors
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "post_authors staff manage" ON public.post_authors;
CREATE POLICY "post_authors staff manage" ON public.post_authors
  FOR ALL TO authenticated
  USING (
    public.has_role((SELECT auth.uid()), 'admin'::app_role)
    OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    OR public.has_role((SELECT auth.uid()), 'author'::app_role)
  )
  WITH CHECK (
    public.has_role((SELECT auth.uid()), 'admin'::app_role)
    OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    OR public.has_role((SELECT auth.uid()), 'author'::app_role)
  );

CREATE TABLE IF NOT EXISTS public.event_speakers (
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_event_speakers_user
  ON public.event_speakers (user_id);

GRANT SELECT ON public.event_speakers TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.event_speakers TO authenticated;
GRANT ALL ON public.event_speakers TO service_role;
ALTER TABLE public.event_speakers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_speakers public read" ON public.event_speakers;
CREATE POLICY "event_speakers public read" ON public.event_speakers
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "event_speakers staff manage" ON public.event_speakers;
CREATE POLICY "event_speakers staff manage" ON public.event_speakers
  FOR ALL TO authenticated
  USING (
    public.has_role((SELECT auth.uid()), 'admin'::app_role)
    OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
  )
  WITH CHECK (
    public.has_role((SELECT auth.uid()), 'admin'::app_role)
    OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
  );

-- ---------------------------------------------------------------------------
-- 6. EXPERTISE_AREAS - obszary ekspertyzy (taksonomia) + przypisania eksperta
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.expertise_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name_pl text NOT NULL,
  name_en text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug),
  CHECK (slug ~ '^[a-z0-9-]{2,80}$')
);

GRANT SELECT ON public.expertise_areas TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.expertise_areas TO authenticated;
GRANT ALL ON public.expertise_areas TO service_role;
ALTER TABLE public.expertise_areas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expertise_areas public read" ON public.expertise_areas;
CREATE POLICY "expertise_areas public read" ON public.expertise_areas
  FOR SELECT TO anon, authenticated
  USING (tenant_id = (SELECT public.public_tenant_id()));

DROP POLICY IF EXISTS "expertise_areas staff write" ON public.expertise_areas;
CREATE POLICY "expertise_areas staff write" ON public.expertise_areas
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

CREATE TABLE IF NOT EXISTS public.expert_expertise_areas (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  area_id uuid NOT NULL REFERENCES public.expertise_areas(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, area_id)
);
CREATE INDEX IF NOT EXISTS idx_expert_expertise_areas_area
  ON public.expert_expertise_areas (area_id);

GRANT SELECT ON public.expert_expertise_areas TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.expert_expertise_areas TO authenticated;
GRANT ALL ON public.expert_expertise_areas TO service_role;
ALTER TABLE public.expert_expertise_areas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expert_areas public read" ON public.expert_expertise_areas;
CREATE POLICY "expert_areas public read" ON public.expert_expertise_areas
  FOR SELECT USING (true);

-- Ekspert zarządza własnymi obszarami; admin/editor - wszystkimi.
DROP POLICY IF EXISTS "expert_areas owner manage" ON public.expert_expertise_areas;
CREATE POLICY "expert_areas owner manage" ON public.expert_expertise_areas
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "expert_areas staff manage" ON public.expert_expertise_areas;
CREATE POLICY "expert_areas staff manage" ON public.expert_expertise_areas
  FOR ALL TO authenticated
  USING (
    public.has_role((SELECT auth.uid()), 'admin'::app_role)
    OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
  )
  WITH CHECK (
    public.has_role((SELECT auth.uid()), 'admin'::app_role)
    OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
  );

-- ---------------------------------------------------------------------------
-- 7. MEDIA_MENTIONS - "W mediach": cytowania, wywiady, wystąpienia
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.media_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  outlet text NOT NULL,
  title text NOT NULL,
  url text,
  kind text NOT NULL DEFAULT 'quote'
    CHECK (kind IN ('quote', 'interview', 'appearance', 'oped', 'podcast_guest')),
  language text,
  published_on date NOT NULL,
  is_public boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (btrim(outlet) <> '' AND btrim(title) <> ''),
  CHECK (url IS NULL OR url ~ '^https?://')
);

CREATE INDEX IF NOT EXISTS idx_media_mentions_user
  ON public.media_mentions (user_id, published_on DESC);

DROP TRIGGER IF EXISTS media_mentions_set_updated_at ON public.media_mentions;
CREATE TRIGGER media_mentions_set_updated_at
  BEFORE UPDATE ON public.media_mentions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON public.media_mentions TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.media_mentions TO authenticated;
GRANT ALL ON public.media_mentions TO service_role;
ALTER TABLE public.media_mentions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "media_mentions public read" ON public.media_mentions;
CREATE POLICY "media_mentions public read" ON public.media_mentions
  FOR SELECT TO anon, authenticated
  USING (is_public = true AND tenant_id = (SELECT public.public_tenant_id()));

DROP POLICY IF EXISTS "media_mentions owner read" ON public.media_mentions;
CREATE POLICY "media_mentions owner read" ON public.media_mentions
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "media_mentions owner manage" ON public.media_mentions;
CREATE POLICY "media_mentions owner manage" ON public.media_mentions
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "media_mentions staff manage" ON public.media_mentions;
CREATE POLICY "media_mentions staff manage" ON public.media_mentions
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

-- ---------------------------------------------------------------------------
-- 8. AUTHOR_PROFILES - pola huba eksperta: pełna biografia, funkcje
--    organizacyjne (poza programami), kontakt dla mediów.
--    Kontakt dla mediów jest CELOWO publiczny (dziennikarze bez logowania);
--    prywatny telefon (phone) pozostaje odcięty od anon (migracja 20260713074738).
-- ---------------------------------------------------------------------------
ALTER TABLE public.author_profiles
  ADD COLUMN IF NOT EXISTS full_bio_pl text,
  ADD COLUMN IF NOT EXISTS full_bio_en text,
  ADD COLUMN IF NOT EXISTS org_functions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS media_contact_name text,
  ADD COLUMN IF NOT EXISTS media_contact_email text,
  ADD COLUMN IF NOT EXISTS media_contact_phone text;

-- ---------------------------------------------------------------------------
-- 9. SEED taksonomii dla publicznego tenanta (idempotentnie po slugach).
--    Programy NIE są seedowane w migracji - to treść organizacji (admin CRUD).
-- ---------------------------------------------------------------------------
INSERT INTO public.regions (tenant_id, slug, name_pl, name_en, sort_order)
SELECT public.public_tenant_id(), v.slug, v.name_pl, v.name_en, v.ord
FROM (VALUES
  ('unia-europejska',            'Unia Europejska',              'European Union',              10),
  ('europa-srodkowo-wschodnia',  'Europa Środkowo-Wschodnia',    'Central and Eastern Europe',  20),
  ('europa-zachodnia',           'Europa Zachodnia',             'Western Europe',              30),
  ('balkany-zachodnie',          'Bałkany Zachodnie',            'Western Balkans',             40),
  ('europa-wschodnia-kaukaz',    'Europa Wschodnia i Kaukaz',    'Eastern Europe and Caucasus', 50),
  ('rosja',                      'Rosja',                        'Russia',                      60),
  ('stany-zjednoczone',          'Stany Zjednoczone',            'United States',               70),
  ('chiny-indo-pacyfik',         'Chiny i Indo-Pacyfik',         'China and Indo-Pacific',      80),
  ('bliski-wschod-afryka-pln',   'Bliski Wschód i Afryka Płn.',  'Middle East and North Africa', 90),
  ('afryka-subsaharyjska',       'Afryka Subsaharyjska',         'Sub-Saharan Africa',          100),
  ('ameryka-lacinska',           'Ameryka Łacińska',             'Latin America',               110),
  ('arktyka',                    'Arktyka',                      'Arctic',                      120)
) AS v(slug, name_pl, name_en, ord)
WHERE public.public_tenant_id() IS NOT NULL
ON CONFLICT (tenant_id, slug) DO NOTHING;

INSERT INTO public.expertise_areas (tenant_id, slug, name_pl, name_en, sort_order)
SELECT public.public_tenant_id(), v.slug, v.name_pl, v.name_en, v.ord
FROM (VALUES
  ('bezpieczenstwo-obrona',      'Bezpieczeństwo i obrona',        'Security and Defence',           10),
  ('polityka-rozszerzenia',      'Polityka rozszerzenia UE',       'EU Enlargement Policy',          20),
  ('polityka-wschodnia',         'Polityka wschodnia',             'Eastern Policy',                 30),
  ('energia-klimat',             'Energia i klimat',               'Energy and Climate',             40),
  ('gospodarka-cyfrowa-ai',      'Gospodarka cyfrowa i AI',        'Digital Economy and AI',         50),
  ('cyberbezpieczenstwo',        'Cyberbezpieczeństwo',            'Cybersecurity',                  60),
  ('handel-miedzynarodowy',      'Handel międzynarodowy',          'International Trade',            70),
  ('migracje',                   'Migracje',                       'Migration',                      80),
  ('praworzadnosc',              'Praworządność',                  'Rule of Law',                    90),
  ('stosunki-transatlantyckie',  'Stosunki transatlantyckie',      'Transatlantic Relations',        100),
  ('budzet-ue-fundusze',         'Budżet UE i fundusze',           'EU Budget and Funds',            110),
  ('polityka-przemyslowa',       'Polityka przemysłowa',           'Industrial Policy',              120)
) AS v(slug, name_pl, name_en, ord)
WHERE public.public_tenant_id() IS NOT NULL
ON CONFLICT (tenant_id, slug) DO NOTHING;

-- ============================================================================
-- SCALONE Z: 20260714130000_faceted_archive_search.sql
--
-- Supabase CLI bierze `version` z prefiksu nazwy pliku, więc DWA pliki o tym
-- samym znaczniku czasu wywalają `duplicate key value violates unique
-- constraint "schema_migrations_pkey"` i przerywają CAŁY `supabase db start` -
-- to dlatego job pgtap w CI nie dobiegał nawet do pierwszego testu. Treść
-- poniżej jest przeniesiona BEZ ZMIAN, w tej samej kolejności, w jakiej CLI
-- stosował pliki (leksykograficznie), więc semantyka migracji się nie zmienia,
-- a każda wersja występuje dokładnie raz (produkcja nie widzi nowych wersji i
-- niczego nie stosuje ponownie).
-- ============================================================================

-- Fasetowe wyszukiwanie i filtrowanie archiwum (wzorzec think-tank/RUSI/Brookings).
--
-- Zakres:
--   1. Kontrolowane wymiary taksonomii: categories.kind
--      (category = specjalizacja, pub_type = typ publikacji, region z hierarchią
--      państw przez parent_id, topic = temat, project, series) - wszystko na
--      istniejącym pivocie post_categories i istniejącym RLS kategorii.
--   2. Lekki stemmer polskiej fleksji (nes_pl_light_stem) wpięty w
--      nes_search_tsquery: "bezpieczeństwa" trafia "bezpieczeństwo" itd.
--   3. search_posts v3: fraza OPCJONALNA (czyste przeglądanie archiwum),
--      filtry po termach (AND, z ekspansją hierarchii), formacie, języku,
--      dostępności (content_access.mode), zakresie dat; sortowanie
--      trafność/najnowsze/najpopularniejsze; dokładny total_count;
--      fallback trigramowy przy zerze wyników FTS (tolerancja literówek).
--   4. search_facets: liczniki fasetowe liczone w SQL po PEŁNYM zbiorze
--      trafień (nie po przyciętym oknie jak dotąd po stronie klienta).
--   5. search_autosuggest: podpowiedzi autorów, terminów (w tym państw)
--      i publikacji dla pola frazy.
--   6. saved_searches: zapisane wyszukiwania zalogowanych użytkowników
--      (RLS właściciela, wzorzec user_bookmarks).
--
-- Konwencje jak w 20260628210000_fulltext_search.sql i 20260712110000:
--   * SECURITY DEFINER + tenant rozstrzygany WYŁĄCZNIE serwerowo,
--   * search_path = public, extensions (unaccent/pg_trgm żyją w extensions),
--   * addytywne kolumny wyników - starszy klient czyta te, które zna.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. WYMIARY TAKSONOMII -------------------------------------------------------
-- Jedna tabela kontrolowanych słowników zamiast czterech nowych: istniejące
-- categories dostają "kind" (wymiar) i "parent_id" (hierarchia region ->
-- państwo, jak w taksonomii Brookings). Dotychczasowe wiersze zostają
-- specjalizacjami (kind='category'), pivot post_categories obsługuje wszystko.

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'category';
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.categories(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE public.categories
    ADD CONSTRAINT categories_kind_check
    CHECK (kind IN ('category','pub_type','region','topic','project','series'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.categories
    ADD CONSTRAINT categories_parent_not_self
    CHECK (parent_id IS NULL OR parent_id <> id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS categories_tenant_kind_idx
  ON public.categories (tenant_id, kind);
CREATE INDEX IF NOT EXISTS categories_parent_idx
  ON public.categories (parent_id) WHERE parent_id IS NOT NULL;

-- Indeks pod fasety/filtry: pivot czytany od strony kategorii.
CREATE INDEX IF NOT EXISTS post_categories_category_idx
  ON public.post_categories (category_id, post_id);

-- Startowy słownik typów publikacji dla tenanta publicznego (wzorzec OSW:
-- analizy, komentarze, raporty). Edytorzy mogą go dowolnie zmieniać w panelu;
-- WHERE NOT EXISTS -> migracja nie wskrzesza ręcznie usuniętych terminów.
INSERT INTO public.categories (tenant_id, slug, name_pl, name_en, kind)
SELECT public.public_tenant_id(), s.slug, s.pl, s.en, 'pub_type'
  FROM (VALUES
    ('analiza',   'Analiza',   'Analysis'),
    ('komentarz', 'Komentarz', 'Commentary'),
    ('raport',    'Raport',    'Report'),
    ('wywiad',    'Wywiad',    'Interview'),
    ('podcast',   'Podcast',   'Podcast')
  ) AS s(slug, pl, en)
 WHERE public.public_tenant_id() IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.categories c
      WHERE c.tenant_id = public.public_tenant_id() AND c.slug = s.slug
   );

-- 2. POLSKA FLEKSJA -----------------------------------------------------------
-- Konserwatywny "light stemmer": zdejmuje typowe końcówki fleksyjne z termu
-- zapytania (już po unaccent/lower/sanityzacji), wymagając rdzenia >= 4 znaków.
-- W połączeniu z dopasowaniem prefiksowym (`:*`) po stronie indeksu pokrywa to
-- obie strony odmiany: zapytanie "bezpieczeństwa" -> rdzeń "bezpieczenstw"
-- trafia "bezpieczeństwo/bezpieczeństwem/...", a zapytanie w mianowniku trafia
-- dopełniacz w treści. Rdzeń jest zawsze OR-owany z surowym termem, więc błędne
-- ucięcie nigdy nie ZAWĘŻA wyników.

CREATE OR REPLACE FUNCTION public.nes_pl_light_stem(_term text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  -- Końcówki na tekście po unaccent, od najbardziej specyficznych. Tylko
  -- fleksja rzeczownikowo-przymiotnikowa; celowo bez końcówek słowotwórczych.
  v_suffixes text[] := ARRAY[
    'iego','iemu','iach','iami',
    'ego','emu','ymi','imi','ych','ich','iej','ami','ach','owi','iom','iow',
    'om','ow','em','ie','ia','iu','ii','ej','ym','im','mi',
    'a','e','i','o','u','y'
  ];
  v_s text;
BEGIN
  IF _term IS NULL OR length(_term) < 5 THEN
    RETURN _term;
  END IF;
  FOREACH v_s IN ARRAY v_suffixes LOOP
    IF length(_term) - length(v_s) >= 4 AND right(_term, length(v_s)) = v_s THEN
      RETURN left(_term, length(_term) - length(v_s));
    END IF;
  END LOOP;
  RETURN _term;
END;
$$;

-- nes_search_tsquery v2: każdy term jako (surowy:* | rdzeń:*), termy AND-em.
-- Kontrakt z 20260628210000 zachowany: unaccent+lower, sanityzacja [a-z0-9],
-- puste wejście -> NULL; gdy rdzeń == surowy term, emitujemy pojedynczy
-- prefiks (identyczny zapis tsquery jak w v1).
CREATE OR REPLACE FUNCTION public.nes_search_tsquery(_q text)
RETURNS tsquery
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_terms text;
BEGIN
  SELECT string_agg(
           CASE WHEN stem <> term
                THEN '(' || term || ':* | ' || stem || ':*)'
                ELSE term || ':*'
           END, ' & ')
    INTO v_terms
    FROM (
      SELECT term, public.nes_pl_light_stem(term) AS stem
      FROM (
        SELECT regexp_replace(unaccent(lower(w)), '[^a-z0-9]', '', 'g') AS term
        FROM unnest(regexp_split_to_array(coalesce(_q, ''), '\s+')) AS w
      ) raw
      WHERE term <> ''
    ) s;

  IF v_terms IS NULL OR v_terms = '' THEN
    RETURN NULL;
  END IF;

  RETURN to_tsquery('simple', v_terms);
EXCEPTION WHEN others THEN
  -- Awaryjnie: nigdy nie wywracaj wyszukiwarki na egzotycznym wejściu.
  RETURN plainto_tsquery('simple', unaccent(lower(coalesce(_q, ''))));
END;
$$;

-- 3. search_posts v3 ----------------------------------------------------------
-- Zmiana kształtu wyniku (total_count, access_mode, post_format, fuzzy)
-- wymaga DROP + CREATE. Kolumny addytywne; dotychczasowi wywołujący
-- (SearchOverlay, MCP, /search) przekazują nazwane podzbiory parametrów,
-- więc nowe DEFAULT-y niczego nie psują.
--
-- Budowa: base (wąskie kolumny + wszystkie filtry poza frazą) -> fts / trgm
-- (literówki) / browse (pusta fraza = przeglądanie archiwum) -> ranked
-- (okno total_count + row_number wg sortu) -> page (LIMIT) -> dopiero dla
-- strony wyników dołączamy treść i liczymy ts_headline (kosztowne rzeczy
-- nigdy nie dotykają całego archiwum).

DROP FUNCTION IF EXISTS public.search_posts(text, int, uuid, timestamptz, timestamptz, uuid);

CREATE OR REPLACE FUNCTION public.search_posts(
  _q text DEFAULT NULL,
  _limit int DEFAULT 80,
  _author uuid DEFAULT NULL,
  _date_from timestamptz DEFAULT NULL,
  _date_to timestamptz DEFAULT NULL,
  _category uuid DEFAULT NULL,
  _terms uuid[] DEFAULT NULL,
  _format text DEFAULT NULL,
  _lang text DEFAULT NULL,
  _access text DEFAULT NULL,
  _sort text DEFAULT 'relevance'
)
RETURNS TABLE (
  id uuid, slug text, title_pl text, title_en text,
  excerpt_pl text, excerpt_en text, cover_image_url text,
  published_at timestamptz, parent_page_id uuid, author_id uuid, rank real,
  headline_pl text, headline_en text,
  post_format text, access_mode text, fuzzy boolean, total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH RECURSIVE ctx AS (
    -- Tenant rozstrzygany WYŁĄCZNIE serwerowo (jak w v1/v2).
    SELECT coalesce(public.current_tenant_id(), public.public_tenant_id()) AS tid
  ),
  tq AS (SELECT public.nes_search_tsquery(_q) AS q),
  nq AS (SELECT unaccent(lower(btrim(coalesce(_q, '')))) AS q),
  -- Hierarchia termów: wybrany term dopasowuje też wszystkich potomków
  -- (region "Europa Wschodnia" obejmuje przypięte pod niego państwa).
  term_tree AS (
    SELECT t.term_id AS root, t.term_id AS match_id, 0 AS depth
      FROM unnest(coalesce(_terms, '{}'::uuid[])) AS t(term_id)
    UNION ALL
    SELECT tt.root, c.id, tt.depth + 1
      FROM public.categories c
      JOIN term_tree tt ON c.parent_id = tt.match_id
     WHERE tt.depth < 10 -- tama na ewentualny cykl parent↔dziecko w danych
  ),
  -- Zbiór po WSZYSTKICH filtrach poza frazą (wąskie kolumny - CTE jest
  -- materializowane, więc nie wleczemy przez nie treści ani JSONB).
  base AS (
    SELECT p.id, p.slug, p.title_pl, p.title_en, p.excerpt_pl, p.excerpt_en,
           p.cover_image_url, p.published_at, p.parent_page_id, p.author_id,
           p.post_format, p.search_vector,
           coalesce(ca.mode::text, 'public') AS eff_access
      FROM public.posts p
      JOIN ctx ON p.tenant_id = ctx.tid
      LEFT JOIN public.content_access ca
        ON ca.entity_type = 'post' AND ca.entity_id = p.id
     WHERE p.status = 'published'
       AND p.deleted_at IS NULL
       AND (_author IS NULL OR p.author_id = _author)
       AND (_date_from IS NULL OR p.published_at >= _date_from)
       AND (_date_to IS NULL OR p.published_at <= _date_to)
       AND (_category IS NULL OR EXISTS (
             SELECT 1 FROM public.post_categories pc
              WHERE pc.post_id = p.id AND pc.category_id = _category))
       AND (_format IS NULL OR p.post_format = _format)
       AND (_lang IS NULL
            OR (_lang = 'pl' AND btrim(p.title_pl) <> '')
            OR (_lang = 'en' AND btrim(p.title_en) <> ''))
       AND (_access IS NULL OR coalesce(ca.mode::text, 'public') = _access)
       AND (_terms IS NULL OR NOT EXISTS (
             SELECT 1 FROM unnest(_terms) AS req(term_id)
              WHERE NOT EXISTS (
                SELECT 1 FROM public.post_categories pc
                JOIN term_tree tt
                  ON tt.match_id = pc.category_id AND tt.root = req.term_id
                WHERE pc.post_id = p.id)))
  ),
  fts AS (
    SELECT b.*, ts_rank_cd(b.search_vector, tq.q)::real AS rank, false AS fuzzy
      FROM base b, tq
     WHERE tq.q IS NOT NULL AND b.search_vector @@ tq.q
  ),
  -- Tolerancja literówek: gdy FTS (z prefiksami i stemmingiem) nic nie znalazł,
  -- dopasowanie trigramowe po tytułach ratuje frazy typu "geopolityks".
  trgm AS (
    SELECT b.*,
           GREATEST(
             word_similarity(nq.q, unaccent(lower(coalesce(b.title_pl, '')))),
             word_similarity(nq.q, unaccent(lower(coalesce(b.title_en, ''))))
           )::real AS rank,
           true AS fuzzy
      FROM base b, nq
     WHERE length(nq.q) >= 4
       AND NOT EXISTS (SELECT 1 FROM fts)
       AND GREATEST(
             word_similarity(nq.q, unaccent(lower(coalesce(b.title_pl, '')))),
             word_similarity(nq.q, unaccent(lower(coalesce(b.title_en, ''))))
           ) > 0.3
  ),
  -- Tryb przeglądania archiwum: bez frazy zwracamy cały przefiltrowany zbiór.
  browse AS (
    SELECT b.*, 0::real AS rank, false AS fuzzy
      FROM base b, nq
     WHERE nq.q = ''
  ),
  hits AS (
    SELECT * FROM fts
    UNION ALL SELECT * FROM trgm
    UNION ALL SELECT * FROM browse
  ),
  pop AS (
    -- Agregat liczony tylko, gdy sortujemy popularnością (inaczej pusty).
    SELECT v.post_id, count(*) AS views
      FROM public.post_views v
     WHERE _sort = 'popular'
       AND v.viewed_at > now() - interval '90 days'
     GROUP BY v.post_id
  ),
  ranked AS (
    SELECT h.id, h.slug, h.title_pl, h.title_en, h.excerpt_pl, h.excerpt_en,
           h.cover_image_url, h.published_at, h.parent_page_id, h.author_id,
           h.post_format, h.eff_access, h.rank, h.fuzzy,
           (count(*) OVER ())::bigint AS total_count,
           row_number() OVER (ORDER BY
             CASE WHEN _sort = 'popular' THEN coalesce(pop.views, 0) END DESC NULLS LAST,
             CASE WHEN coalesce(_sort, 'relevance') NOT IN ('newest','popular') THEN h.rank END DESC NULLS LAST,
             h.published_at DESC NULLS LAST,
             h.id
           ) AS rn
      FROM hits h
      LEFT JOIN pop ON pop.post_id = h.id
  ),
  page AS (
    SELECT * FROM ranked WHERE rn <= GREATEST(LEAST(_limit, 200), 1)
  )
  -- Treść i ts_headline dopiero dla wierszy strony wyników (<= 200).
  SELECT pg.id, pg.slug, pg.title_pl, pg.title_en, pg.excerpt_pl, pg.excerpt_en,
         pg.cover_image_url, pg.published_at, pg.parent_page_id, pg.author_id,
         pg.rank,
         CASE WHEN tq.q IS NOT NULL AND NOT pg.fuzzy THEN ts_headline(
           'simple',
           left(coalesce(pg.excerpt_pl, '') || ' ' ||
                regexp_replace(coalesce(p.content_pl, ''), '<[^>]+>', ' ', 'g'), 4000),
           tq.q,
           'StartSel=[[[, StopSel=]]], MaxWords=28, MinWords=12, ShortWord=2, MaxFragments=1'
         ) END AS headline_pl,
         CASE WHEN tq.q IS NOT NULL AND NOT pg.fuzzy THEN ts_headline(
           'simple',
           left(coalesce(pg.excerpt_en, '') || ' ' ||
                regexp_replace(coalesce(p.content_en, ''), '<[^>]+>', ' ', 'g'), 4000),
           tq.q,
           'StartSel=[[[, StopSel=]]], MaxWords=28, MinWords=12, ShortWord=2, MaxFragments=1'
         ) END AS headline_en,
         pg.post_format, pg.eff_access AS access_mode, pg.fuzzy, pg.total_count
    FROM page pg
    JOIN public.posts p ON p.id = pg.id
    CROSS JOIN tq
   ORDER BY pg.rn;
$$;

REVOKE ALL ON FUNCTION public.search_posts(
  text, int, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_posts(
  text, int, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text, text
) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.search_posts(
  text, int, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text, text
) IS
  'Fasetowe wyszukiwanie archiwum: fraza opcjonalna (tryb przeglądania), '
  'filtry po termach taksonomii (AND, z hierarchią), autorze, formacie, języku, '
  'dostępności i datach; sort relevance/newest/popular; total_count w każdym '
  'wierszu; fallback trigramowy (fuzzy=true) przy zerze wyników FTS.';

-- 4. FASETY -------------------------------------------------------------------
-- Liczniki liczone po PEŁNYM zbiorze trafień (ta sama logika dopasowania co
-- search_posts), nie po przyciętym oknie. Semantyka drill-down: aktywne filtry
-- zawężają wszystkie fasety; odznaczenie (chip) przywraca szerszy zbiór.

CREATE OR REPLACE FUNCTION public.search_facets(
  _q text DEFAULT NULL,
  _author uuid DEFAULT NULL,
  _date_from timestamptz DEFAULT NULL,
  _date_to timestamptz DEFAULT NULL,
  _category uuid DEFAULT NULL,
  _terms uuid[] DEFAULT NULL,
  _format text DEFAULT NULL,
  _lang text DEFAULT NULL,
  _access text DEFAULT NULL
)
RETURNS TABLE (
  dim text, id uuid, slug text, label_pl text, label_en text,
  parent_id uuid, cnt bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH RECURSIVE ctx AS (
    SELECT coalesce(public.current_tenant_id(), public.public_tenant_id()) AS tid
  ),
  tq AS (SELECT public.nes_search_tsquery(_q) AS q),
  nq AS (SELECT unaccent(lower(btrim(coalesce(_q, '')))) AS q),
  term_tree AS (
    SELECT t.term_id AS root, t.term_id AS match_id, 0 AS depth
      FROM unnest(coalesce(_terms, '{}'::uuid[])) AS t(term_id)
    UNION ALL
    SELECT tt.root, c.id, tt.depth + 1
      FROM public.categories c
      JOIN term_tree tt ON c.parent_id = tt.match_id
     WHERE tt.depth < 10 -- tama na ewentualny cykl parent↔dziecko w danych
  ),
  base AS (
    SELECT p.id, p.author_id, p.post_format, p.published_at,
           p.title_pl, p.title_en, p.search_vector,
           coalesce(ca.mode::text, 'public') AS eff_access
      FROM public.posts p
      JOIN ctx ON p.tenant_id = ctx.tid
      LEFT JOIN public.content_access ca
        ON ca.entity_type = 'post' AND ca.entity_id = p.id
     WHERE p.status = 'published'
       AND p.deleted_at IS NULL
       AND (_author IS NULL OR p.author_id = _author)
       AND (_date_from IS NULL OR p.published_at >= _date_from)
       AND (_date_to IS NULL OR p.published_at <= _date_to)
       AND (_category IS NULL OR EXISTS (
             SELECT 1 FROM public.post_categories pc
              WHERE pc.post_id = p.id AND pc.category_id = _category))
       AND (_format IS NULL OR p.post_format = _format)
       AND (_lang IS NULL
            OR (_lang = 'pl' AND btrim(p.title_pl) <> '')
            OR (_lang = 'en' AND btrim(p.title_en) <> ''))
       AND (_access IS NULL OR coalesce(ca.mode::text, 'public') = _access)
       AND (_terms IS NULL OR NOT EXISTS (
             SELECT 1 FROM unnest(_terms) AS req(term_id)
              WHERE NOT EXISTS (
                SELECT 1 FROM public.post_categories pc
                JOIN term_tree tt
                  ON tt.match_id = pc.category_id AND tt.root = req.term_id
                WHERE pc.post_id = p.id)))
  ),
  fts AS (
    SELECT b.* FROM base b, tq WHERE tq.q IS NOT NULL AND b.search_vector @@ tq.q
  ),
  trgm AS (
    SELECT b.*
      FROM base b, nq
     WHERE length(nq.q) >= 4
       AND NOT EXISTS (SELECT 1 FROM fts)
       AND GREATEST(
             word_similarity(nq.q, unaccent(lower(coalesce(b.title_pl, '')))),
             word_similarity(nq.q, unaccent(lower(coalesce(b.title_en, ''))))
           ) > 0.3
  ),
  browse AS (
    SELECT b.* FROM base b, nq WHERE nq.q = ''
  ),
  matched AS (
    SELECT * FROM fts
    UNION ALL SELECT * FROM trgm
    UNION ALL SELECT * FROM browse
  ),
  -- Pełne drzewo słownika tenanta (każdy term jako korzeń + jego potomkowie),
  -- żeby liczniki rodziców (regionów) rolowały państwa bez podwójnego liczenia.
  vocab_tree AS (
    SELECT c.id AS root, c.id AS match_id, 0 AS depth
      FROM public.categories c, ctx
     WHERE c.tenant_id = ctx.tid
    UNION ALL
    SELECT vt.root, c.id, vt.depth + 1
      FROM public.categories c
      JOIN vocab_tree vt ON c.parent_id = vt.match_id
     WHERE vt.depth < 10 -- tama na ewentualny cykl parent↔dziecko w danych
  )
  -- Terminy wszystkich wymiarów (dim = kind).
  SELECT c.kind AS dim, c.id, c.slug, c.name_pl AS label_pl, c.name_en AS label_en,
         c.parent_id, count(DISTINCT m.id) AS cnt
    FROM matched m
    JOIN public.post_categories pc ON pc.post_id = m.id
    JOIN vocab_tree vt ON vt.match_id = pc.category_id
    JOIN public.categories c ON c.id = vt.root
   GROUP BY c.kind, c.id, c.slug, c.name_pl, c.name_en, c.parent_id
  UNION ALL
  -- Autorzy (tylko nie-wrażliwe display_name).
  SELECT 'author', pr.id, pr.slug, coalesce(pr.display_name, 'Autor'),
         coalesce(pr.display_name, 'Author'), NULL, count(*)::bigint
    FROM matched m
    JOIN public.profiles pr ON pr.id = m.author_id
   GROUP BY pr.id, pr.slug, pr.display_name
  UNION ALL
  -- Format treści (post_format; etykiety tłumaczy klient).
  SELECT 'format', NULL, m.post_format, m.post_format, m.post_format, NULL,
         count(*)::bigint
    FROM matched m
   GROUP BY m.post_format
  UNION ALL
  -- Język: wpis "dostępny po polsku/angielsku" (kryterium jak filtr _lang).
  SELECT 'lang', NULL, l.code, l.code, l.code, NULL, count(*)::bigint
    FROM matched m
    CROSS JOIN LATERAL (
      SELECT 'pl'::text AS code WHERE btrim(m.title_pl) <> ''
      UNION ALL
      SELECT 'en' WHERE btrim(m.title_en) <> ''
    ) l
   GROUP BY l.code
  UNION ALL
  -- Dostępność: publiczna / z kontem / członkowska (content_access.mode).
  SELECT 'access', NULL, m.eff_access, m.eff_access, m.eff_access, NULL,
         count(*)::bigint
    FROM matched m
   GROUP BY m.eff_access
  UNION ALL
  -- Rok publikacji (szybkie zawężanie daty jak w archiwum OSW).
  SELECT 'year', NULL, y.year_slug, y.year_slug, y.year_slug, NULL,
         count(*)::bigint
    FROM (
      SELECT extract(year FROM m.published_at)::int::text AS year_slug
        FROM matched m
       WHERE m.published_at IS NOT NULL
    ) y
   GROUP BY y.year_slug;
$$;

REVOKE ALL ON FUNCTION public.search_facets(
  text, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_facets(
  text, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text
) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.search_facets(
  text, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text
) IS
  'Liczniki fasetowe dla /search liczone po pełnym zbiorze trafień: terminy '
  'taksonomii (dim = kind, z rolowaniem hierarchii), autorzy, format, język, '
  'dostępność i rok publikacji.';

-- 5. AUTOSUGGEST --------------------------------------------------------------
-- Podpowiedzi pod polem frazy: autorzy, terminy słowników (w tym państwa
-- i regiony) oraz tytuły publikacji. Prefiks przed trigramem, potem alfabet.

CREATE OR REPLACE FUNCTION public.search_autosuggest(
  _q text,
  _limit int DEFAULT 8
)
RETURNS TABLE (
  kind text, id uuid, slug text, label_pl text, label_en text,
  parent_page_id uuid, score real
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH ctx AS (
    SELECT coalesce(public.current_tenant_id(), public.public_tenant_id()) AS tid
  ),
  nq AS (SELECT unaccent(lower(btrim(coalesce(_q, '')))) AS q),
  cand AS (
    -- Terminy kontrolowanych słowników (kind jako rodzaj podpowiedzi).
    SELECT c.kind, c.id, c.slug, c.name_pl AS label_pl, c.name_en AS label_en,
           NULL::uuid AS parent_page_id,
           GREATEST(
             word_similarity(nq.q, unaccent(lower(c.name_pl))),
             word_similarity(nq.q, unaccent(lower(c.name_en)))
           ) + CASE WHEN unaccent(lower(c.name_pl)) LIKE nq.q || '%'
                      OR unaccent(lower(c.name_en)) LIKE nq.q || '%'
                    THEN 1.0 ELSE 0.0 END AS score
      FROM public.categories c, ctx, nq
     WHERE length(nq.q) >= 2 AND c.tenant_id = ctx.tid
    UNION ALL
    -- Autorzy: tylko osoby z opublikowanym dorobkiem w tenancie.
    SELECT 'author', pr.id, pr.slug, coalesce(pr.display_name, 'Autor'),
           coalesce(pr.display_name, 'Author'), NULL,
           word_similarity(nq.q, unaccent(lower(coalesce(pr.display_name, ''))))
           + CASE WHEN unaccent(lower(coalesce(pr.display_name, ''))) LIKE nq.q || '%'
                  THEN 1.0 ELSE 0.0 END
      FROM public.profiles pr, ctx, nq
     WHERE length(nq.q) >= 2
       AND EXISTS (
             SELECT 1 FROM public.posts p
              WHERE p.author_id = pr.id AND p.tenant_id = ctx.tid
                AND p.status = 'published' AND p.deleted_at IS NULL)
    UNION ALL
    -- Publikacje: tytuły opublikowanych wpisów.
    SELECT 'post', p.id, p.slug, p.title_pl, p.title_en, p.parent_page_id,
           GREATEST(
             word_similarity(nq.q, unaccent(lower(coalesce(p.title_pl, '')))),
             word_similarity(nq.q, unaccent(lower(coalesce(p.title_en, ''))))
           ) + CASE WHEN unaccent(lower(coalesce(p.title_pl, ''))) LIKE nq.q || '%'
                      OR unaccent(lower(coalesce(p.title_en, ''))) LIKE nq.q || '%'
                    THEN 1.0 ELSE 0.0 END
      FROM public.posts p, ctx, nq
     WHERE length(nq.q) >= 2
       AND p.tenant_id = ctx.tid
       AND p.status = 'published'
       AND p.deleted_at IS NULL
  )
  SELECT kind, id, slug, label_pl, label_en, parent_page_id, score::real
    FROM cand
   WHERE score > 0.3
   ORDER BY score DESC, label_pl
   LIMIT GREATEST(LEAST(_limit, 20), 1);
$$;

REVOKE ALL ON FUNCTION public.search_autosuggest(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_autosuggest(text, int)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.search_autosuggest(text, int) IS
  'Autosuggest wyszukiwarki: autorzy, terminy taksonomii (w tym państwa) '
  'i tytuły publikacji; prefiks boostowany ponad podobieństwo trigramowe.';

-- 6. ZAPISANE WYSZUKIWANIA ----------------------------------------------------
-- Wzorzec user_bookmarks: wiersz należy do użytkownika, RLS właściciela,
-- params jako jsonb (kształt waliduje klient; URL i tak jest źródłem prawdy).

CREATE TABLE IF NOT EXISTS public.saved_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tenant_id uuid NOT NULL DEFAULT current_tenant_id(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_searches TO authenticated;
GRANT ALL ON public.saved_searches TO service_role;

ALTER TABLE public.saved_searches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saved_searches owner select" ON public.saved_searches;
CREATE POLICY "saved_searches owner select" ON public.saved_searches
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "saved_searches owner insert" ON public.saved_searches;
CREATE POLICY "saved_searches owner insert" ON public.saved_searches
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "saved_searches owner update" ON public.saved_searches;
CREATE POLICY "saved_searches owner update" ON public.saved_searches
  FOR UPDATE TO authenticated USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "saved_searches owner delete" ON public.saved_searches;
CREATE POLICY "saved_searches owner delete" ON public.saved_searches
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_saved_searches_user
  ON public.saved_searches (user_id, created_at DESC);

-- ============================================================================
-- SCALONE Z: 20260714130000_membership_digital_product.sql
--
-- Supabase CLI bierze `version` z prefiksu nazwy pliku, więc DWA pliki o tym
-- samym znaczniku czasu wywalają `duplicate key value violates unique
-- constraint "schema_migrations_pkey"` i przerywają CAŁY `supabase db start` -
-- to dlatego job pgtap w CI nie dobiegał nawet do pierwszego testu. Treść
-- poniżej jest przeniesiona BEZ ZMIAN, w tej samej kolejności, w jakiej CLI
-- stosował pliki (leksykograficznie), więc semantyka migracji się nie zmienia,
-- a każda wersja występuje dokładnie raz (produkcja nie widzi nowych wersji i
-- niczego nie stosuje ponownie).
-- ============================================================================

-- ============================================================================
-- CZŁONKOSTWO JAKO KONKRETNY PRODUKT CYFROWY (wzorzec Chatham House / RUSI).
--
-- Członkostwo przestaje być "badge na profilu": każda warstwa to pakiet praw,
-- o które pyta system (odblokowanie publikacji, pierwszeństwo rejestracji,
-- wydarzenia zamknięte, pobieranie materiałów, historia uczestnictwa).
--
-- Drabinka (rank):
--   reader     0  konto bezpłatne - zapisywanie i personalizacja
--   supporter  5  wspierający - darowizny i aktualizacje (nadanie automatyczne
--                 z darowizny zalogowanego użytkownika, 12 mies.)
--   member    10  członek indywidualny - zamknięte treści i wydarzenia
--   pro       20  członek ekspercki - dodatkowo grupy robocze i priorytet Q&A
--   corporate 30  członek korporacyjny - wiele kont (miejsca), briefingi
--   partner   40  partner strategiczny - relacja instytucjonalna
--
-- Nowe źródła warstwy (obok subskrypcji planu):
--   membership_grants      nadania poza planem: manual (admin, sprzedaż
--                          fakturowa eksperckich/partnerskich) i donation
--                          (trigger na donations nadaje 'supporter').
--   member_organizations   członkostwo korporacyjne/partnerskie: organizacja
--   + organization_seats   z limitem miejsc; miejsce (zaproszone e-mailem,
--                          odbierane po zalogowaniu) nadaje warstwę organizacji.
--
-- current_membership_tier() rozstrzyga: max(subskrypcje, nadania, miejsca)
-- -> warstwa domyślna -> wbudowany fallback. Bramki (has_tier_rank /
-- has_tier_feature / RLS) działają bez zmian - widzą po prostu wyższą rangę.
--
-- Konkretne prawa dodane tutaj:
--   * wydarzenia: okno rejestracji (rsvp_opens_at) z wcześniejszym dostępem
--     dla członków (early_rsvp_rank) - pierwszeństwo rejestracji,
--   * biblioteka materiałów (member_resources, prywatny bucket) z bramką
--     rangi i logiem pobrań (resource_downloads) - pobieranie materiałów,
--   * historia uczestnictwa: my_event_participation / my_resource_downloads,
--   * personalizacja komunikacji: segment kampanii newslettera po minimalnej
--     warstwie (newsletter_min_tier_emails).
--
-- Wszystko idempotentne.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Drabinka warstw: seed 6 warstw (nowe tenanty) + dosianie brakujących
--    i ostrożna aktualizacja copy istniejących (tylko nietknięte przez admina).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_membership_tiers(p_tenant uuid)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.membership_tiers
    (tenant_id, key, rank, name_pl, name_en, description_pl, description_en,
     benefits, features, is_default, sort_order)
  SELECT p_tenant, v.key, v.rank, v.name_pl, v.name_en, v.desc_pl, v.desc_en,
         v.benefits, v.features, v.is_default, v.sort_order
    FROM (VALUES
      ('reader', 0,
       'Konto bezpłatne', 'Free account',
       'Zapisywanie i personalizacja: zakładki, obserwowanie tematów i udział w dyskusjach.',
       'Saving and personalisation: bookmarks, topic follows and joining the discussion.',
       '[{"pl":"Zapisywanie materiałów i lista do przeczytania","en":"Saved items and a reading list"},
         {"pl":"Personalizacja: zainteresowania i obserwowane tematy","en":"Personalisation: interests and followed topics"},
         {"pl":"Udział w dyskusjach i ankietach","en":"Join discussions and polls"}]'::jsonb,
       '{}'::jsonb, true, 0),
      ('supporter', 5,
       'Wspierający', 'Supporter',
       'Darowizna wspiera niezależność instytutu; wspierający otrzymują dedykowane aktualizacje.',
       'A donation supports the institute''s independence; supporters receive dedicated updates.',
       '[{"pl":"Wszystko z konta bezpłatnego","en":"Everything in the free account"},
         {"pl":"Aktualizacje i podsumowania dla wspierających","en":"Supporter updates and briefings"},
         {"pl":"Status wspierającego przez 12 miesięcy od darowizny","en":"Supporter status for 12 months after a donation"}]'::jsonb,
       '{"supporter_updates": true}'::jsonb, false, 5),
      ('member', 10,
       'Członek indywidualny', 'Individual member',
       'Zamknięte treści i wydarzenia: pełny dostęp do analiz, briefingów i biblioteki materiałów.',
       'Closed content and events: full access to analyses, briefings and the members'' library.',
       '[{"pl":"Wszystkie analizy premium","en":"All premium analyses"},
         {"pl":"Wydarzenia i briefingi dla członków","en":"Member events and briefings"},
         {"pl":"Pierwszeństwo rejestracji na wydarzenia","en":"Priority event registration"},
         {"pl":"Biblioteka materiałów do pobrania","en":"Downloadable members'' library"},
         {"pl":"Nagrania z wydarzeń","en":"Event recordings"}]'::jsonb,
       '{"events_members": true, "recordings": true, "member_library": true}'::jsonb, false, 10),
      ('pro', 20,
       'Członek ekspercki', 'Expert member',
       'Dla ekspertów i profesjonalistów public affairs: wszystko z członkostwa indywidualnego plus grupy robocze.',
       'For experts and public-affairs professionals: everything in individual membership plus working groups.',
       '[{"pl":"Wszystko z członkostwa indywidualnego","en":"Everything in individual membership"},
         {"pl":"Udział w grupach roboczych","en":"Participation in working groups"},
         {"pl":"Priorytet pytań w sesjach Q&A","en":"Priority in expert Q&A"},
         {"pl":"Zamknięte briefingi eksperckie","en":"Closed-door expert briefings"},
         {"pl":"Tracker legislacyjny z alertami","en":"Legislative tracker with alerts"}]'::jsonb,
       '{"events_members": true, "recordings": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "member_library": true}'::jsonb,
       false, 20),
      ('corporate', 30,
       'Członek korporacyjny', 'Corporate member',
       'Dla instytucji i firm: wiele kont dla zespołu oraz briefingi i wydarzenia dla członków.',
       'For institutions and companies: multiple team seats plus member briefings and events.',
       '[{"pl":"Wiele kont dla zespołu (miejsca w organizacji)","en":"Multiple team accounts (organisation seats)"},
         {"pl":"Wszystko z członkostwa eksperckiego","en":"Everything in expert membership"},
         {"pl":"Briefingi i wydarzenia dla członków","en":"Member briefings and events"},
         {"pl":"Wspólna biblioteka materiałów","en":"Shared members'' library"}]'::jsonb,
       '{"events_members": true, "recordings": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "member_library": true, "corporate_seats": true}'::jsonb,
       false, 30),
      ('partner', 40,
       'Partner strategiczny', 'Strategic partner',
       'Relacja instytucjonalna: partnerstwo programowe, dedykowane briefingi i wspólne projekty.',
       'An institutional relationship: programme partnership, dedicated briefings and joint projects.',
       '[{"pl":"Wszystko z członkostwa korporacyjnego","en":"Everything in corporate membership"},
         {"pl":"Relacja instytucjonalna i wspólne projekty","en":"Institutional relationship and joint projects"},
         {"pl":"Dedykowane briefingi dla partnera","en":"Dedicated partner briefings"}]'::jsonb,
       '{"events_members": true, "recordings": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "member_library": true, "corporate_seats": true, "strategic_partner": true}'::jsonb,
       false, 40)
    ) AS v(key, rank, name_pl, name_en, desc_pl, desc_en, benefits, features, is_default, sort_order)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.membership_tiers mt
      WHERE mt.tenant_id = p_tenant AND mt.key = v.key
   );
$$;

REVOKE EXECUTE ON FUNCTION public.seed_membership_tiers(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_membership_tiers(uuid) TO service_role;

-- Dosianie brakujących warstw (supporter/corporate/partner) istniejącym tenantom.
DO $$
DECLARE v_t uuid;
BEGIN
  FOR v_t IN SELECT id FROM public.tenants LOOP
    PERFORM public.seed_membership_tiers(v_t);
  END LOOP;
END $$;

-- Aktualizacja copy WYŁĄCZNIE tam, gdzie admin nie zmienił seedów (dokładne
-- dopasowanie starych wartości) - członkostwo ma komunikować konkretne prawa.
UPDATE public.membership_tiers
   SET name_pl = 'Konto bezpłatne', name_en = 'Free account',
       description_pl = 'Zapisywanie i personalizacja: zakładki, obserwowanie tematów i udział w dyskusjach.',
       description_en = 'Saving and personalisation: bookmarks, topic follows and joining the discussion.'
 WHERE key = 'reader' AND name_pl = 'Czytelnik' AND name_en = 'Reader';

UPDATE public.membership_tiers
   SET name_pl = 'Członek indywidualny', name_en = 'Individual member'
 WHERE key = 'member' AND name_pl = 'Członek' AND name_en = 'Member';

UPDATE public.membership_tiers
   SET name_pl = 'Członek ekspercki', name_en = 'Expert member'
 WHERE key = 'pro' AND name_pl = 'Pro' AND name_en = 'Pro';

-- Flagi maszynowe dokładane addytywnie (nie nadpisują edycji admina).
UPDATE public.membership_tiers
   SET features = features || '{"member_library": true}'::jsonb
 WHERE key IN ('member', 'pro') AND NOT (features ? 'member_library');

UPDATE public.membership_tiers
   SET features = features || '{"working_groups": true}'::jsonb
 WHERE key = 'pro' AND NOT (features ? 'working_groups');

-- ----------------------------------------------------------------------------
-- 2) membership_grants: nadania warstwy poza planem sprzedażowym.
--    source='manual'   - admin (sprzedaż fakturowa, komplementarne),
--    source='donation' - automat z darowizny (patrz trigger niżej).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.membership_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tier_key text NOT NULL,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'donation', 'import')),
  source_donation_id uuid REFERENCES public.donations(id) ON DELETE SET NULL,
  note text CHECK (note IS NULL OR length(btrim(note)) <= 300),
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, tier_key)
    REFERENCES public.membership_tiers (tenant_id, key)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CHECK (expires_at IS NULL OR expires_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_membership_grants_user
  ON public.membership_grants (user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_membership_grants_tenant
  ON public.membership_grants (tenant_id, created_at DESC);
-- Jedno aktywne nadanie z darowizn per (tenant, user) - kolejne darowizny
-- przedłużają to samo nadanie zamiast mnożyć wiersze.
CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_grants_donation
  ON public.membership_grants (tenant_id, user_id)
  WHERE source = 'donation' AND revoked_at IS NULL;

DROP TRIGGER IF EXISTS membership_grants_set_updated_at ON public.membership_grants;
CREATE TRIGGER membership_grants_set_updated_at
  BEFORE UPDATE ON public.membership_grants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON public.membership_grants TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.membership_grants TO authenticated;
GRANT ALL ON public.membership_grants TO service_role;
ALTER TABLE public.membership_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "grants own read" ON public.membership_grants;
CREATE POLICY "grants own read" ON public.membership_grants
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "grants admin read" ON public.membership_grants;
CREATE POLICY "grants admin read" ON public.membership_grants
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND public.has_role((SELECT auth.uid()), 'admin'::app_role)
  );

DROP POLICY IF EXISTS "grants admin write" ON public.membership_grants;
CREATE POLICY "grants admin write" ON public.membership_grants
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND public.has_role((SELECT auth.uid()), 'admin'::app_role)
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND public.has_role((SELECT auth.uid()), 'admin'::app_role)
  );

-- Nadanie po e-mailu (admin nie zna uuid użytkownika; profile e-maili są PII).
-- p_months NULL = bezterminowo.
CREATE OR REPLACE FUNCTION public.admin_grant_membership(
  p_email text,
  p_tier_key text,
  p_months integer DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_admin_tenant();
  v_user uuid;
  v_id uuid;
BEGIN
  IF p_months IS NOT NULL AND (p_months < 1 OR p_months > 120) THEN
    RAISE EXCEPTION 'grants: months out of range';
  END IF;
  SELECT u.id INTO v_user FROM auth.users u
   WHERE lower(u.email) = lower(btrim(p_email)) LIMIT 1;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'grants: user not found';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.membership_tiers
     WHERE tenant_id = v_tenant AND key = p_tier_key AND active
  ) THEN
    RAISE EXCEPTION 'grants: tier not found';
  END IF;

  INSERT INTO public.membership_grants
    (tenant_id, user_id, tier_key, source, note, granted_by, expires_at)
  VALUES
    (v_tenant, v_user, p_tier_key, 'manual', NULLIF(btrim(COALESCE(p_note, '')), ''),
     auth.uid(),
     CASE WHEN p_months IS NULL THEN NULL ELSE now() + make_interval(months => p_months) END)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_grant_membership(text, text, integer, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_grant_membership(text, text, integer, text)
  TO authenticated, service_role;

-- Lista nadań z tożsamością odbiorcy (e-mail z auth.users - definer,
-- bo kolumna profiles.email jest odcięta grantem PII).
CREATE OR REPLACE FUNCTION public.admin_list_membership_grants()
RETURNS TABLE (
  id uuid, user_id uuid, email text, display_name text, tier_key text,
  source text, note text, starts_at timestamptz, expires_at timestamptz,
  revoked_at timestamptz, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT mg.id, mg.user_id, u.email, p.display_name, mg.tier_key,
         mg.source, mg.note, mg.starts_at, mg.expires_at, mg.revoked_at, mg.created_at
    FROM public.membership_grants mg
    JOIN auth.users u ON u.id = mg.user_id
    LEFT JOIN public.profiles p ON p.id = mg.user_id
   WHERE mg.tenant_id = public.assert_admin_tenant()
   ORDER BY mg.created_at DESC
   LIMIT 500;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_list_membership_grants() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_membership_grants() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3) Darowizny -> status wspierającego.
--    donations.user_id (opcjonalny; ustawiany, gdy darczyńca był zalogowany).
--    Zapłacona darowizna nadaje/przedłuża 'supporter' o 12 miesięcy;
--    refund cofa nadanie związane z tą darowizną.
-- ----------------------------------------------------------------------------
ALTER TABLE public.donations
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_donations_user
  ON public.donations (user_id) WHERE user_id IS NOT NULL;

-- Darczyńca widzi własne darowizny ("Twoje wsparcie" w hubie członkostwa).
DROP POLICY IF EXISTS "donations own read" ON public.donations;
CREATE POLICY "donations own read" ON public.donations
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.tg_donations_grant_supporter()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grant public.membership_grants%ROWTYPE;
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Refund cofa nadanie powiązane z tą darowizną (bez odejmowania miesięcy
  -- z wcześniejszych darowizn - świadome uproszczenie księgowe).
  IF TG_OP = 'UPDATE' AND NEW.status = 'refunded' AND OLD.status = 'paid' THEN
    UPDATE public.membership_grants
       SET revoked_at = now()
     WHERE source_donation_id = NEW.id AND revoked_at IS NULL;
    RETURN NEW;
  END IF;

  IF NEW.status <> 'paid' THEN
    RETURN NEW;
  END IF;
  -- Tenant bez warstwy 'supporter' (usunięta w panelu) = brak automatu.
  IF NOT EXISTS (
    SELECT 1 FROM public.membership_tiers
     WHERE tenant_id = NEW.tenant_id AND key = 'supporter' AND active
  ) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_grant
    FROM public.membership_grants
   WHERE tenant_id = NEW.tenant_id AND user_id = NEW.user_id
     AND source = 'donation' AND revoked_at IS NULL
   FOR UPDATE;

  IF FOUND THEN
    UPDATE public.membership_grants
       SET expires_at = GREATEST(COALESCE(v_grant.expires_at, now()), now())
                        + interval '12 months',
           source_donation_id = NEW.id
     WHERE id = v_grant.id;
  ELSE
    INSERT INTO public.membership_grants
      (tenant_id, user_id, tier_key, source, source_donation_id, expires_at)
    VALUES
      (NEW.tenant_id, NEW.user_id, 'supporter', 'donation', NEW.id,
       now() + interval '12 months');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS donations_grant_supporter ON public.donations;
CREATE TRIGGER donations_grant_supporter
  AFTER INSERT OR UPDATE OF status, user_id ON public.donations
  FOR EACH ROW EXECUTE FUNCTION public.tg_donations_grant_supporter();

-- ----------------------------------------------------------------------------
-- 4) Członkostwo korporacyjne: organizacja + miejsca (wiele kont).
--    Sprzedaż odbywa się poza samoobsługą (kontakt/faktura) - organizację
--    zakłada admin; właściciel miejsca 'owner' zarządza resztą miejsc.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.member_organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  tier_key text NOT NULL DEFAULT 'corporate',
  seats_limit integer NOT NULL DEFAULT 5 CHECK (seats_limit BETWEEN 1 AND 500),
  contact_email text CHECK (
    contact_email IS NULL OR contact_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  note text CHECK (note IS NULL OR length(btrim(note)) <= 500),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, tier_key)
    REFERENCES public.membership_tiers (tenant_id, key) ON UPDATE CASCADE,
  CHECK (expires_at IS NULL OR expires_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_member_orgs_tenant
  ON public.member_organizations (tenant_id, created_at DESC);

DROP TRIGGER IF EXISTS member_orgs_set_updated_at ON public.member_organizations;
CREATE TRIGGER member_orgs_set_updated_at
  BEFORE UPDATE ON public.member_organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.organization_seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.member_organizations(id) ON DELETE CASCADE,
  invited_email text NOT NULL CHECK (
    invited_email = lower(btrim(invited_email))
    AND invited_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, invited_email)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_seats_user
  ON public.organization_seats (org_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_org_seats_user
  ON public.organization_seats (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_org_seats_email
  ON public.organization_seats (invited_email);

-- Właściciel miejsca w organizacji? (SECURITY DEFINER, bo polityka RLS na
-- organization_seats nie może odpytywać samej siebie - rekursja RLS.)
CREATE OR REPLACE FUNCTION public.is_org_owner(p_org uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_seats os
     WHERE os.org_id = p_org AND os.user_id = auth.uid() AND os.role = 'owner'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_org_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_org_owner(uuid) TO authenticated, service_role;

GRANT SELECT ON public.member_organizations TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.member_organizations TO authenticated;
GRANT ALL ON public.member_organizations TO service_role;
ALTER TABLE public.member_organizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orgs admin all" ON public.member_organizations;
CREATE POLICY "orgs admin all" ON public.member_organizations
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND public.has_role((SELECT auth.uid()), 'admin'::app_role)
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND public.has_role((SELECT auth.uid()), 'admin'::app_role)
  );

-- Posiadacz miejsca widzi własną organizację (nazwa/limit/status do huba).
DROP POLICY IF EXISTS "orgs seat read" ON public.member_organizations;
CREATE POLICY "orgs seat read" ON public.member_organizations
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.organization_seats os
     WHERE os.org_id = member_organizations.id
       AND os.user_id = (SELECT auth.uid())
  ));

GRANT SELECT ON public.organization_seats TO authenticated;
GRANT UPDATE, DELETE ON public.organization_seats TO authenticated;
GRANT ALL ON public.organization_seats TO service_role;
ALTER TABLE public.organization_seats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "seats admin all" ON public.organization_seats;
CREATE POLICY "seats admin all" ON public.organization_seats
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND public.has_role((SELECT auth.uid()), 'admin'::app_role)
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND public.has_role((SELECT auth.uid()), 'admin'::app_role)
  );

DROP POLICY IF EXISTS "seats own read" ON public.organization_seats;
CREATE POLICY "seats own read" ON public.organization_seats
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "seats owner read" ON public.organization_seats;
CREATE POLICY "seats owner read" ON public.organization_seats
  FOR SELECT TO authenticated
  USING (public.is_org_owner(org_id));

-- Właściciel usuwa miejsca swojej organizacji (poza miejscami 'owner').
DROP POLICY IF EXISTS "seats owner delete" ON public.organization_seats;
CREATE POLICY "seats owner delete" ON public.organization_seats
  FOR DELETE TO authenticated
  USING (public.is_org_owner(org_id) AND role <> 'owner');

-- Dodanie miejsca: limit egzekwowany pod blokadą wiersza organizacji.
-- Jeśli konto o tym e-mailu już istnieje, miejsce jest od razu odebrane.
CREATE OR REPLACE FUNCTION public.org_add_seat(
  p_org uuid,
  p_email text,
  p_role text DEFAULT 'member'
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org public.member_organizations%ROWTYPE;
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_user uuid;
  v_used integer;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'orgs: authentication required';
  END IF;
  IF p_role NOT IN ('owner', 'member') THEN
    RAISE EXCEPTION 'orgs: invalid role';
  END IF;
  IF v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'orgs: invalid email';
  END IF;

  SELECT * INTO v_org FROM public.member_organizations
   WHERE id = p_org FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'orgs: not found';
  END IF;
  IF NOT (public.has_role(v_uid, 'admin'::app_role) OR public.is_org_owner(p_org)) THEN
    RAISE EXCEPTION 'orgs: not allowed';
  END IF;
  -- Rolę 'owner' nadaje wyłącznie admin (właściciel nie mnoży właścicieli).
  IF p_role = 'owner' AND NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'orgs: not allowed';
  END IF;
  IF v_org.status <> 'active' THEN
    RAISE EXCEPTION 'orgs: organization inactive';
  END IF;

  SELECT count(*) INTO v_used FROM public.organization_seats WHERE org_id = p_org;
  IF v_used >= v_org.seats_limit THEN
    RAISE EXCEPTION 'orgs: seats limit reached';
  END IF;

  SELECT u.id INTO v_user FROM auth.users u WHERE lower(u.email) = v_email LIMIT 1;

  INSERT INTO public.organization_seats
    (tenant_id, org_id, invited_email, user_id, role, claimed_at)
  VALUES
    (v_org.tenant_id, p_org, v_email, v_user, p_role,
     CASE WHEN v_user IS NULL THEN NULL ELSE now() END)
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'orgs: seat exists';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.org_add_seat(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_add_seat(uuid, text, text) TO authenticated, service_role;

-- Odebranie zaproszonych miejsc po zalogowaniu (dopasowanie po e-mailu konta).
CREATE OR REPLACE FUNCTION public.claim_my_org_seats()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_count integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN 0;
  END IF;
  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = v_uid;
  IF v_email IS NULL THEN
    RETURN 0;
  END IF;
  -- uq_org_seats_user: jeśli user zdążył już zająć inne miejsce w tej samej
  -- organizacji, duplikat jest pomijany (WHERE NOT EXISTS).
  UPDATE public.organization_seats os
     SET user_id = v_uid, claimed_at = now()
   WHERE os.user_id IS NULL
     AND os.invited_email = v_email
     AND NOT EXISTS (
       SELECT 1 FROM public.organization_seats dup
        WHERE dup.org_id = os.org_id AND dup.user_id = v_uid
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_my_org_seats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_my_org_seats() TO authenticated, service_role;

-- Organizacja wołającego (najwyższa warstwa, gdy miejsc jest kilka) do huba.
CREATE OR REPLACE FUNCTION public.my_organization()
RETURNS TABLE (
  org_id uuid, name text, tier_key text, my_role text, status text,
  seats_limit integer, seats_used integer, starts_at timestamptz, expires_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT mo.id, mo.name, mo.tier_key, os.role, mo.status,
         mo.seats_limit,
         (SELECT count(*)::integer FROM public.organization_seats s WHERE s.org_id = mo.id),
         mo.starts_at, mo.expires_at
    FROM public.organization_seats os
    JOIN public.member_organizations mo ON mo.id = os.org_id
    LEFT JOIN public.membership_tiers mt
      ON mt.tenant_id = mo.tenant_id AND mt.key = mo.tier_key
   WHERE os.user_id = auth.uid()
     AND mo.tenant_id = COALESCE(public.public_tenant_id(), public.current_tenant_id())
   ORDER BY COALESCE(mt.rank, 0) DESC, mo.created_at ASC
   LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.my_organization() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_organization() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5) Rozstrzyganie warstwy v2: subskrypcje ∪ nadania ∪ miejsca w organizacjach.
--    Sygnatury bez zmian - wszystkie bramki (has_tier_rank / has_tier_feature
--    / RLS wydarzeń / paywall) automatycznie honorują nowe źródła.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_membership_tier()
RETURNS TABLE (key text, rank integer, name_pl text, name_en text, features jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH t AS (
    SELECT COALESCE(public.public_tenant_id(), public.current_tenant_id()) AS tid
  ),
  entitled AS (
    -- 1) aktywne subskrypcje płatne (plan -> tier_key)
    SELECT mt.key, mt.rank, mt.name_pl, mt.name_en, mt.features
      FROM public.user_subscriptions us
      JOIN public.access_plans ap ON ap.id = us.plan_id
      JOIN t ON ap.tenant_id = t.tid
      JOIN public.membership_tiers mt
        ON mt.tenant_id = ap.tenant_id AND mt.key = ap.tier_key AND mt.active
     WHERE us.user_id = auth.uid()
       AND us.status = 'active'
       AND (us.current_period_end IS NULL OR us.current_period_end > now())
    UNION ALL
    -- 2) nadania poza planem (manualne / z darowizny)
    SELECT mt.key, mt.rank, mt.name_pl, mt.name_en, mt.features
      FROM public.membership_grants mg
      JOIN t ON mg.tenant_id = t.tid
      JOIN public.membership_tiers mt
        ON mt.tenant_id = mg.tenant_id AND mt.key = mg.tier_key AND mt.active
     WHERE mg.user_id = auth.uid()
       AND mg.revoked_at IS NULL
       AND mg.starts_at <= now()
       AND (mg.expires_at IS NULL OR mg.expires_at > now())
    UNION ALL
    -- 3) miejsca w aktywnych organizacjach (korporacyjne / partnerskie)
    SELECT mt.key, mt.rank, mt.name_pl, mt.name_en, mt.features
      FROM public.organization_seats os
      JOIN public.member_organizations mo ON mo.id = os.org_id
      JOIN t ON mo.tenant_id = t.tid
      JOIN public.membership_tiers mt
        ON mt.tenant_id = mo.tenant_id AND mt.key = mo.tier_key AND mt.active
     WHERE os.user_id = auth.uid()
       AND mo.status = 'active'
       AND mo.starts_at <= now()
       AND (mo.expires_at IS NULL OR mo.expires_at > now())
  ),
  best AS (
    SELECT * FROM entitled ORDER BY rank DESC LIMIT 1
  ),
  def AS (
    SELECT mt.key, mt.rank, mt.name_pl, mt.name_en, mt.features
      FROM public.membership_tiers mt
      JOIN t ON mt.tenant_id = t.tid
     WHERE mt.is_default AND mt.active
     LIMIT 1
  )
  SELECT * FROM best
  UNION ALL
  SELECT * FROM def WHERE NOT EXISTS (SELECT 1 FROM best)
  UNION ALL
  SELECT 'reader', 0, 'Konto bezpłatne', 'Free account', '{}'::jsonb
   WHERE NOT EXISTS (SELECT 1 FROM best)
     AND NOT EXISTS (SELECT 1 FROM def);
$$;

-- Flaga warstwy KONKRETNEGO użytkownika (Q&A priorytet itd.) - te same trzy
-- źródła co current_membership_tier, ale dla wskazanego usera (service/definer).
CREATE OR REPLACE FUNCTION public.user_has_tier_feature(p_user uuid, _feature text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_subscriptions us
      JOIN public.access_plans ap ON ap.id = us.plan_id
      JOIN public.membership_tiers mt
        ON mt.tenant_id = ap.tenant_id AND mt.key = ap.tier_key AND mt.active
     WHERE us.user_id = p_user AND us.status = 'active'
       AND (us.current_period_end IS NULL OR us.current_period_end > now())
       AND (mt.features ->> _feature)::boolean IS TRUE
  ) OR EXISTS (
    SELECT 1 FROM public.membership_grants mg
      JOIN public.membership_tiers mt
        ON mt.tenant_id = mg.tenant_id AND mt.key = mg.tier_key AND mt.active
     WHERE mg.user_id = p_user AND mg.revoked_at IS NULL
       AND mg.starts_at <= now()
       AND (mg.expires_at IS NULL OR mg.expires_at > now())
       AND (mt.features ->> _feature)::boolean IS TRUE
  ) OR EXISTS (
    SELECT 1 FROM public.organization_seats os
      JOIN public.member_organizations mo ON mo.id = os.org_id
      JOIN public.membership_tiers mt
        ON mt.tenant_id = mo.tenant_id AND mt.key = mo.tier_key AND mt.active
     WHERE os.user_id = p_user AND mo.status = 'active'
       AND mo.starts_at <= now()
       AND (mo.expires_at IS NULL OR mo.expires_at > now())
       AND (mt.features ->> _feature)::boolean IS TRUE
  );
$$;

REVOKE EXECUTE ON FUNCTION public.user_has_tier_feature(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_tier_feature(uuid, text) TO service_role;

-- Ranga warstwy KONKRETNEGO użytkownika w danym tenancie (server fn pobrań,
-- segmentacja newslettera). Fallback: warstwa domyślna tenantu, inaczej 0.
CREATE OR REPLACE FUNCTION public.user_tier_rank(p_user uuid, p_tenant uuid DEFAULT NULL)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH t AS (
    SELECT COALESCE(p_tenant, public.public_tenant_id(), public.current_tenant_id()) AS tid
  ),
  entitled AS (
    SELECT mt.rank
      FROM public.user_subscriptions us
      JOIN public.access_plans ap ON ap.id = us.plan_id
      JOIN t ON ap.tenant_id = t.tid
      JOIN public.membership_tiers mt
        ON mt.tenant_id = ap.tenant_id AND mt.key = ap.tier_key AND mt.active
     WHERE us.user_id = p_user AND us.status = 'active'
       AND (us.current_period_end IS NULL OR us.current_period_end > now())
    UNION ALL
    SELECT mt.rank
      FROM public.membership_grants mg
      JOIN t ON mg.tenant_id = t.tid
      JOIN public.membership_tiers mt
        ON mt.tenant_id = mg.tenant_id AND mt.key = mg.tier_key AND mt.active
     WHERE mg.user_id = p_user AND mg.revoked_at IS NULL
       AND mg.starts_at <= now()
       AND (mg.expires_at IS NULL OR mg.expires_at > now())
    UNION ALL
    SELECT mt.rank
      FROM public.organization_seats os
      JOIN public.member_organizations mo ON mo.id = os.org_id
      JOIN t ON mo.tenant_id = t.tid
      JOIN public.membership_tiers mt
        ON mt.tenant_id = mo.tenant_id AND mt.key = mo.tier_key AND mt.active
     WHERE os.user_id = p_user AND mo.status = 'active'
       AND mo.starts_at <= now()
       AND (mo.expires_at IS NULL OR mo.expires_at > now())
  )
  SELECT COALESCE(
    (SELECT max(rank) FROM entitled),
    (SELECT mt.rank FROM public.membership_tiers mt JOIN t ON mt.tenant_id = t.tid
      WHERE mt.is_default AND mt.active LIMIT 1),
    0
  );
$$;

REVOKE EXECUTE ON FUNCTION public.user_tier_rank(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_tier_rank(uuid, uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 6) Pierwszeństwo rejestracji na wydarzenia.
--    rsvp_opens_at   - kiedy rejestracja otwiera się dla wszystkich
--                      (NULL = od publikacji),
--    early_rsvp_rank - ranga warstwy, która może rejestrować się wcześniej
--                      (NULL = nikt przed rsvp_opens_at).
-- ----------------------------------------------------------------------------
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS rsvp_opens_at timestamptz;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS early_rsvp_rank integer;
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_early_rsvp_rank_check;
ALTER TABLE public.events ADD CONSTRAINT events_early_rsvp_rank_check
  CHECK (early_rsvp_rank IS NULL OR early_rsvp_rank >= 0);

-- Granty kolumnowe są addytywne - dokładamy TYLKO nowe kolumny (join_url
-- i recording_url pozostają odcięte).
GRANT SELECT (rsvp_opens_at, early_rsvp_rank) ON public.events TO anon, authenticated;

-- rsvp_event: pełna definicja z 20260713200000 (bramka briefingów Pro,
-- efektywny próg rangi, limit miejsc pod FOR UPDATE) + okno rejestracji.
CREATE OR REPLACE FUNCTION public.rsvp_event(p_event_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_going integer;
  v_min_rank integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'events: authentication required'; END IF;
  IF p_status NOT IN ('going', 'interested', 'cancelled') THEN
    RAISE EXCEPTION 'events: invalid status';
  END IF;
  SELECT * INTO v_event FROM public.events
   WHERE id = p_event_id AND tenant_id = public.public_tenant_id() AND status = 'published'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'events: not found'; END IF;

  IF v_event.visibility = 'members' THEN
    IF v_event.kind = 'briefing' THEN
      IF NOT public.has_tier_feature('pro_briefings') THEN
        RAISE EXCEPTION 'events: membership required';
      END IF;
    ELSE
      v_min_rank := GREATEST(COALESCE(v_event.min_tier_rank, 0), 1);
      IF NOT public.has_tier_rank(v_min_rank) THEN
        RAISE EXCEPTION 'events: membership required';
      END IF;
    END IF;
  END IF;

  -- Pierwszeństwo rejestracji: przed rsvp_opens_at zapisują się wyłącznie
  -- członkowie o randze >= early_rsvp_rank. Anulowanie zawsze dozwolone.
  IF p_status <> 'cancelled'
     AND v_event.rsvp_opens_at IS NOT NULL
     AND now() < v_event.rsvp_opens_at THEN
    IF v_event.early_rsvp_rank IS NULL
       OR NOT public.has_tier_rank(v_event.early_rsvp_rank) THEN
      RAISE EXCEPTION 'events: rsvp not open';
    END IF;
  END IF;

  IF p_status = 'going' AND v_event.capacity IS NOT NULL THEN
    SELECT count(*) INTO v_going FROM public.event_rsvps
     WHERE event_id = p_event_id AND status = 'going' AND user_id <> v_user;
    IF v_going >= v_event.capacity THEN RAISE EXCEPTION 'events: full'; END IF;
  END IF;

  INSERT INTO public.event_rsvps (tenant_id, event_id, user_id, status)
  VALUES (v_event.tenant_id, p_event_id, v_user, p_status)
  ON CONFLICT (event_id, user_id) DO UPDATE SET status = EXCLUDED.status, updated_at = now();

  SELECT count(*) INTO v_going FROM public.event_rsvps WHERE event_id = p_event_id AND status = 'going';
  RETURN jsonb_build_object('status', p_status, 'going', v_going);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rsvp_event(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rsvp_event(uuid, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7) Biblioteka materiałów członkowskich (pobieranie materiałów).
--    Metadane publiczne (teaser z kłódką); plik w PRYWATNYM buckecie
--    'member-resources' - jedyna droga to authorize_resource_download
--    (bramka rangi + log pobrania) i podpisany URL po stronie serwera.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.member_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  title_pl text NOT NULL,
  title_en text NOT NULL,
  description_pl text,
  description_en text,
  category text NOT NULL DEFAULT 'report'
    CHECK (category IN ('report', 'brief', 'transcript', 'slides', 'data', 'other')),
  file_path text NOT NULL CHECK (file_path ~ '^[A-Za-z0-9][A-Za-z0-9/._-]{2,299}$'),
  file_name text NOT NULL CHECK (length(btrim(file_name)) BETWEEN 1 AND 200),
  file_size bigint CHECK (file_size IS NULL OR file_size > 0),
  mime_type text,
  min_tier_rank integer NOT NULL DEFAULT 10 CHECK (min_tier_rank >= 0),
  published boolean NOT NULL DEFAULT false,
  download_count integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (btrim(title_pl) <> '' AND btrim(title_en) <> '')
);

CREATE INDEX IF NOT EXISTS idx_member_resources_tenant
  ON public.member_resources (tenant_id, sort_order, created_at DESC) WHERE published;

DROP TRIGGER IF EXISTS member_resources_set_updated_at ON public.member_resources;
CREATE TRIGGER member_resources_set_updated_at
  BEFORE UPDATE ON public.member_resources
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON public.member_resources TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.member_resources TO authenticated;
GRANT ALL ON public.member_resources TO service_role;
ALTER TABLE public.member_resources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "resources public read" ON public.member_resources;
CREATE POLICY "resources public read" ON public.member_resources
  FOR SELECT TO anon, authenticated
  USING (published AND tenant_id = (SELECT public.public_tenant_id()));

DROP POLICY IF EXISTS "resources staff read" ON public.member_resources;
CREATE POLICY "resources staff read" ON public.member_resources
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

DROP POLICY IF EXISTS "resources staff write" ON public.member_resources;
CREATE POLICY "resources staff write" ON public.member_resources
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

-- Log pobrań = historia uczestnictwa + licznik popularności.
CREATE TABLE IF NOT EXISTS public.resource_downloads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  resource_id uuid NOT NULL REFERENCES public.member_resources(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resource_downloads_user
  ON public.resource_downloads (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resource_downloads_resource
  ON public.resource_downloads (resource_id);

GRANT SELECT ON public.resource_downloads TO authenticated;
GRANT ALL ON public.resource_downloads TO service_role;
ALTER TABLE public.resource_downloads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "downloads own read" ON public.resource_downloads;
CREATE POLICY "downloads own read" ON public.resource_downloads
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "downloads admin read" ON public.resource_downloads;
CREATE POLICY "downloads admin read" ON public.resource_downloads
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND public.has_role((SELECT auth.uid()), 'admin'::app_role)
  );

CREATE OR REPLACE FUNCTION public.tg_resource_download_count()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.member_resources
     SET download_count = download_count + 1
   WHERE id = NEW.resource_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS resource_downloads_count ON public.resource_downloads;
CREATE TRIGGER resource_downloads_count
  AFTER INSERT ON public.resource_downloads
  FOR EACH ROW EXECUTE FUNCTION public.tg_resource_download_count();

-- Autoryzacja pobrania: published + ranga warstwy (staff bez bramki),
-- log w resource_downloads. Server fn zamienia file_path na podpisany URL.
CREATE OR REPLACE FUNCTION public.authorize_resource_download(p_resource uuid)
RETURNS TABLE (file_path text, file_name text, mime_type text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_res public.member_resources%ROWTYPE;
  v_staff boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'resources: authentication required';
  END IF;
  SELECT * INTO v_res FROM public.member_resources
   WHERE id = p_resource
     AND tenant_id = COALESCE(public.public_tenant_id(), public.current_tenant_id());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'resources: not found';
  END IF;
  v_staff := public.has_role(v_user, 'admin'::app_role)
             OR public.has_role(v_user, 'editor'::app_role);
  IF NOT v_res.published AND NOT v_staff THEN
    RAISE EXCEPTION 'resources: not found';
  END IF;
  IF NOT v_staff AND NOT public.has_tier_rank(v_res.min_tier_rank) THEN
    RAISE EXCEPTION 'resources: tier required';
  END IF;

  INSERT INTO public.resource_downloads (tenant_id, resource_id, user_id)
  VALUES (v_res.tenant_id, v_res.id, v_user);

  RETURN QUERY SELECT v_res.file_path, v_res.file_name, v_res.mime_type;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.authorize_resource_download(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.authorize_resource_download(uuid) TO authenticated, service_role;

-- Prywatny bucket na pliki biblioteki; zapis wyłącznie staff (upload z panelu),
-- odczyt kliencki brak - pobrania idą podpisanym URL-em (service role).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('member-resources', 'member-resources', false, 52428800, NULL)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "member resources staff read" ON storage.objects;
CREATE POLICY "member resources staff read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'member-resources'
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

DROP POLICY IF EXISTS "member resources staff insert" ON storage.objects;
CREATE POLICY "member resources staff insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'member-resources'
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

DROP POLICY IF EXISTS "member resources staff delete" ON storage.objects;
CREATE POLICY "member resources staff delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'member-resources'
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

-- ----------------------------------------------------------------------------
-- 8) Historia uczestnictwa (widok własny użytkownika).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_event_participation()
RETURNS TABLE (
  event_id uuid, slug text, title_pl text, title_en text, kind text,
  starts_at timestamptz, ends_at timestamptz, event_status text,
  rsvp_status text, rsvp_updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id, e.slug, e.title_pl, e.title_en, e.kind,
         e.starts_at, e.ends_at, e.status,
         r.status, r.updated_at
    FROM public.event_rsvps r
    JOIN public.events e ON e.id = r.event_id
   WHERE r.user_id = auth.uid()
     AND e.tenant_id = COALESCE(public.public_tenant_id(), public.current_tenant_id())
   ORDER BY e.starts_at DESC
   LIMIT 200;
$$;

REVOKE EXECUTE ON FUNCTION public.my_event_participation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_event_participation() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.my_resource_downloads()
RETURNS TABLE (
  resource_id uuid, title_pl text, title_en text, category text,
  downloaded_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (rd.resource_id)
         rd.resource_id, mr.title_pl, mr.title_en, mr.category, rd.created_at
    FROM public.resource_downloads rd
    JOIN public.member_resources mr ON mr.id = rd.resource_id
   WHERE rd.user_id = auth.uid()
   ORDER BY rd.resource_id, rd.created_at DESC
   LIMIT 200;
$$;

REVOKE EXECUTE ON FUNCTION public.my_resource_downloads() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_resource_downloads() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 9) Personalizacja komunikacji: segment newslettera po minimalnej warstwie.
--    Zwraca (lower) e-maile kont o randze >= p_min w tenancie kampanii;
--    potok wysyłki przecina z listą subskrybentów. Per-user user_tier_rank
--    jest O(n) po kontach - przy skali NES (tysiące) wystarczające.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.newsletter_min_tier_emails(p_tenant uuid, p_min integer)
RETURNS TABLE (email text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT lower(u.email)
    FROM auth.users u
   WHERE u.email IS NOT NULL
     AND public.user_tier_rank(u.id, p_tenant) >= COALESCE(p_min, 0);
$$;

REVOKE EXECUTE ON FUNCTION public.newsletter_min_tier_emails(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.newsletter_min_tier_emails(uuid, integer) TO service_role;

-- ============================================================================
-- SCALONE Z: 20260714130000_podcast_network.sql
--
-- Supabase CLI bierze `version` z prefiksu nazwy pliku, więc DWA pliki o tym
-- samym znaczniku czasu wywalają `duplicate key value violates unique
-- constraint "schema_migrations_pkey"` i przerywają CAŁY `supabase db start` -
-- to dlatego job pgtap w CI nie dobiegał nawet do pierwszego testu. Treść
-- poniżej jest przeniesiona BEZ ZMIAN, w tej samej kolejności, w jakiej CLI
-- stosował pliki (leksykograficznie), więc semantyka migracji się nie zmienia,
-- a każda wersja występuje dokładnie raz (produkcja nie widzi nowych wersji i
-- niczego nie stosuje ponownie).
-- ============================================================================

-- Podcast jako sieć programów (wzorzec RUSI/think-tank), nie płaska lista plików.
--
--   program podcastowy (podcast_shows)
--   ├── sezony ── odcinki        (podcasts.show_id + season/episode_number)
--   ├── prowadzący / goście      (podcast_episode_people, opcjonalnie profil)
--   ├── tematy / specjalizacje   (podcasts.category_id -> categories)
--   ├── rozdziały                (podcasts.chapters   jsonb)
--   ├── cytaty do udostępnienia  (podcasts.quotes     jsonb)
--   └── źródła i materiały       (podcasts.resources  jsonb)
--
-- Wszystko addytywne: istniejące odcinki działają dalej bez programu
-- (show_id NULL), a globalny kanał RSS pozostaje bez zmian.

-- =========================================================
-- 1) podcast_shows (programy / serie)
-- =========================================================
CREATE TABLE IF NOT EXISTS public.podcast_shows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  title_pl text NOT NULL,
  title_en text NOT NULL DEFAULT '',
  description_pl text NOT NULL DEFAULT '',
  description_en text NOT NULL DEFAULT '',
  cover_image_url text,
  -- Linki subskrypcji katalogów per program (globalne pozostają w podcast_settings).
  spotify_url text,
  apple_url text,
  youtube_url text,
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (tenant_id, slug)
);

GRANT SELECT ON public.podcast_shows TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.podcast_shows TO authenticated;
GRANT ALL ON public.podcast_shows TO service_role;

ALTER TABLE public.podcast_shows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "podcast_shows_public_read" ON public.podcast_shows;
CREATE POLICY "podcast_shows_public_read"
  ON public.podcast_shows FOR SELECT
  TO anon, authenticated
  USING (status = 'published' AND deleted_at IS NULL);

DROP POLICY IF EXISTS "podcast_shows_staff_read_all" ON public.podcast_shows;
CREATE POLICY "podcast_shows_staff_read_all"
  ON public.podcast_shows FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor') OR public.has_role(auth.uid(),'author'))
  );

DROP POLICY IF EXISTS "podcast_shows_editor_insert" ON public.podcast_shows;
CREATE POLICY "podcast_shows_editor_insert"
  ON public.podcast_shows FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor'))
  );

DROP POLICY IF EXISTS "podcast_shows_editor_update" ON public.podcast_shows;
CREATE POLICY "podcast_shows_editor_update"
  ON public.podcast_shows FOR UPDATE
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor'))
  );

DROP POLICY IF EXISTS "podcast_shows_editor_delete" ON public.podcast_shows;
CREATE POLICY "podcast_shows_editor_delete"
  ON public.podcast_shows FOR DELETE
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor'))
  );

DROP TRIGGER IF EXISTS set_podcast_shows_updated_at ON public.podcast_shows;
CREATE TRIGGER set_podcast_shows_updated_at
  BEFORE UPDATE ON public.podcast_shows
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS podcast_shows_tenant_sort_idx
  ON public.podcast_shows (tenant_id, sort_order, title_pl)
  WHERE deleted_at IS NULL;

-- =========================================================
-- 2) podcasts: przypięcie do programu + warstwy odcinka
-- =========================================================
ALTER TABLE public.podcasts
  ADD COLUMN show_id uuid REFERENCES public.podcast_shows(id) ON DELETE SET NULL,
  ADD COLUMN category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  ADD COLUMN chapters jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(chapters) = 'array'),
  ADD COLUMN quotes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(quotes) = 'array'),
  ADD COLUMN resources jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(resources) = 'array');

COMMENT ON COLUMN public.podcasts.chapters IS
  'Rozdziały odcinka: [{"start": s, "title_pl": "...", "title_en": "..."}]';
COMMENT ON COLUMN public.podcasts.quotes IS
  'Cytaty do udostępnienia: [{"text_pl": "...", "text_en": "...", "attribution": "..."}]';
COMMENT ON COLUMN public.podcasts.resources IS
  'Źródła i materiały: [{"label_pl": "...", "label_en": "...", "url": "...", "kind": "source"|"related"}]';

-- Strona programu: odcinki per program w porządku sezon/numer.
CREATE INDEX IF NOT EXISTS podcasts_show_season_episode_idx
  ON public.podcasts (tenant_id, show_id, season DESC NULLS LAST, episode_number DESC NULLS LAST)
  WHERE deleted_at IS NULL;

-- Agregacja na stronie specjalizacji (kategorii).
CREATE INDEX IF NOT EXISTS podcasts_category_pub_idx
  ON public.podcasts (category_id, published_at DESC NULLS LAST)
  WHERE deleted_at IS NULL AND status = 'published';

-- =========================================================
-- 3) podcast_episode_people (prowadzący i goście odcinka)
-- =========================================================
-- profile_id łączy z profilem eksperta (agregacja na /author/$slug);
-- goście zewnętrzni funkcjonują po display_name + opcjonalnym URL.
CREATE TABLE IF NOT EXISTS public.podcast_episode_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  episode_id uuid NOT NULL REFERENCES public.podcasts(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  display_name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'guest' CHECK (role IN ('host','guest')),
  url text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Osoba bez profilu musi mieć przynajmniej nazwisko.
  CHECK (profile_id IS NOT NULL OR btrim(display_name) <> '')
);

GRANT SELECT ON public.podcast_episode_people TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.podcast_episode_people TO authenticated;
GRANT ALL ON public.podcast_episode_people TO service_role;

ALTER TABLE public.podcast_episode_people ENABLE ROW LEVEL SECURITY;

-- Publicznie widoczni są wyłącznie uczestnicy opublikowanych odcinków
-- (predykat zgodny z podcasts_public_read - szkice nie wyciekają).
DROP POLICY IF EXISTS "podcast_people_public_read" ON public.podcast_episode_people;
CREATE POLICY "podcast_people_public_read"
  ON public.podcast_episode_people FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.podcasts p
      WHERE p.id = episode_id AND p.status = 'published' AND p.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "podcast_people_staff_read_all" ON public.podcast_episode_people;
CREATE POLICY "podcast_people_staff_read_all"
  ON public.podcast_episode_people FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor') OR public.has_role(auth.uid(),'author'))
  );

-- Zapis zgodny z regułami odcinków: admin/redaktor zawsze, autor tylko przy
-- własnym odcinku.
DROP POLICY IF EXISTS "podcast_people_staff_write" ON public.podcast_episode_people;
CREATE POLICY "podcast_people_staff_write"
  ON public.podcast_episode_people FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (
      public.has_role(auth.uid(),'admin')
      OR public.has_role(auth.uid(),'editor')
      OR (
        public.has_role(auth.uid(),'author')
        AND EXISTS (
          SELECT 1 FROM public.podcasts p
          WHERE p.id = episode_id AND p.tenant_id = public.current_tenant_id() AND p.author_id = auth.uid()
        )
      )
    )
  );

DROP POLICY IF EXISTS "podcast_people_staff_update" ON public.podcast_episode_people;
CREATE POLICY "podcast_people_staff_update"
  ON public.podcast_episode_people FOR UPDATE
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (
      public.has_role(auth.uid(),'admin')
      OR public.has_role(auth.uid(),'editor')
      OR (
        public.has_role(auth.uid(),'author')
        AND EXISTS (
          SELECT 1 FROM public.podcasts p
          WHERE p.id = episode_id AND p.tenant_id = public.current_tenant_id() AND p.author_id = auth.uid()
        )
      )
    )
  );

DROP POLICY IF EXISTS "podcast_people_staff_delete" ON public.podcast_episode_people;
CREATE POLICY "podcast_people_staff_delete"
  ON public.podcast_episode_people FOR DELETE
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (
      public.has_role(auth.uid(),'admin')
      OR public.has_role(auth.uid(),'editor')
      OR (
        public.has_role(auth.uid(),'author')
        AND EXISTS (
          SELECT 1 FROM public.podcasts p
          WHERE p.id = episode_id AND p.tenant_id = public.current_tenant_id() AND p.author_id = auth.uid()
        )
      )
    )
  );

CREATE INDEX IF NOT EXISTS podcast_people_episode_idx
  ON public.podcast_episode_people (episode_id, sort_order);

-- Agregacja odcinków na profilu eksperta.
CREATE INDEX IF NOT EXISTS podcast_people_profile_idx
  ON public.podcast_episode_people (profile_id)
  WHERE profile_id IS NOT NULL;

-- ============================================================================
-- SCALONE Z: 20260714130000_research_programs.sql
--
-- Supabase CLI bierze `version` z prefiksu nazwy pliku, więc DWA pliki o tym
-- samym znaczniku czasu wywalają `duplicate key value violates unique
-- constraint "schema_migrations_pkey"` i przerywają CAŁY `supabase db start` -
-- to dlatego job pgtap w CI nie dobiegał nawet do pierwszego testu. Treść
-- poniżej jest przeniesiona BEZ ZMIAN, w tej samej kolejności, w jakiej CLI
-- stosował pliki (leksykograficznie), więc semantyka migracji się nie zmienia,
-- a każda wersja występuje dokładnie raz (produkcja nie widzi nowych wersji i
-- niczego nie stosuje ponownie).
-- ============================================================================

-- ============================================================================
-- Programy badawcze / specjalizacje (wzorzec think-tank/RUSI).
--
-- Program badawczy jest nadrzednym kontenerem - nie kategoria tresci.
-- Ma wlasna teze, zakres, zespol, projekty, kuratorowane tresci (raporty
-- flagowe, podcasty, wydarzenia), partnerow i dane kontaktowe, oraz wlasna
-- identyfikacje wizualna w granicach systemu marki (ikona lucide + akcent).
--
--   research_programs          rdzen: teza (tagline), zakres badan (scope),
--                              pytania badawcze (jsonb [{pl,en}]), ikona,
--                              kolor akcentu, kategoria (agregacja publikacji),
--                              lider/zespol przez _members, kontakt.
--   research_program_members   zespol programu (profil + rola + is_lead).
--   research_program_projects  projekty programu (status: planned/active/
--                              completed, opcjonalny link).
--   research_program_partners  partnerzy (logo + link).
--   research_program_items     kuracja tresci: raport flagowy (post),
--                              podcast, wydarzenie - dokladnie jedna FK.
--
-- Publikacje "najnowsze" NIE sa kuratorowane: plyna automatycznie przez
-- category_id -> post_categories -> posts (published). Kuracja dotyczy
-- tylko raportow flagowych, podcastow i wydarzen (brak taksonomii tam).
--
-- Zespol czytany jest przez RPC get_program_members (SECURITY DEFINER,
-- tylko bezpieczne pola profilu, tylko opublikowane programy publicznego
-- tenanta) - niezaleznie od polityk RLS na profiles.
--
-- Wszystko idempotentne.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.research_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name_pl text NOT NULL,
  name_en text NOT NULL,
  tagline_pl text,
  tagline_en text,
  scope_pl text,
  scope_en text,
  research_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  icon text NOT NULL DEFAULT 'Compass',
  accent_color text NOT NULL DEFAULT '#1e3a8a',
  hero_image_url text,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  contact_email text,
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug),
  CHECK (slug ~ '^[a-z0-9-]{3,120}$'),
  CHECK (btrim(name_pl) <> '' AND btrim(name_en) <> ''),
  CHECK (accent_color ~* '^#[0-9a-f]{6}$'),
  CHECK (jsonb_typeof(research_questions) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_research_programs_tenant
  ON public.research_programs (tenant_id, status, sort_order);

DROP TRIGGER IF EXISTS research_programs_set_updated_at ON public.research_programs;
CREATE TRIGGER research_programs_set_updated_at
  BEFORE UPDATE ON public.research_programs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON public.research_programs TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.research_programs TO authenticated;
GRANT ALL ON public.research_programs TO service_role;
ALTER TABLE public.research_programs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "research programs public read" ON public.research_programs;
CREATE POLICY "research programs public read" ON public.research_programs
  FOR SELECT TO anon, authenticated
  USING (status = 'published' AND tenant_id = (SELECT public.public_tenant_id()));

DROP POLICY IF EXISTS "research programs staff all" ON public.research_programs;
CREATE POLICY "research programs staff all" ON public.research_programs
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

-- ----------------------------------------------------------------------------
-- Tenant dziecka zawsze dziedziczony z programu (klient nie moze go sfalszowac).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_research_program_child_tenant()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant
    FROM public.research_programs
   WHERE id = NEW.program_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'research program % not found', NEW.program_id;
  END IF;
  NEW.tenant_id := v_tenant;
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- Zespol programu
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.research_program_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.research_programs(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  member_role_pl text,
  member_role_en text,
  is_lead boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_research_program_members_program
  ON public.research_program_members (program_id, sort_order);

DROP TRIGGER IF EXISTS research_program_members_tenant ON public.research_program_members;
CREATE TRIGGER research_program_members_tenant
  BEFORE INSERT ON public.research_program_members
  FOR EACH ROW EXECUTE FUNCTION public.tg_research_program_child_tenant();

GRANT SELECT ON public.research_program_members TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.research_program_members TO authenticated;
GRANT ALL ON public.research_program_members TO service_role;
ALTER TABLE public.research_program_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "program members public read" ON public.research_program_members;
CREATE POLICY "program members public read" ON public.research_program_members
  FOR SELECT TO anon, authenticated
  USING (
    tenant_id = (SELECT public.public_tenant_id())
    AND EXISTS (
      SELECT 1 FROM public.research_programs p
       WHERE p.id = research_program_members.program_id AND p.status = 'published'
    )
  );

DROP POLICY IF EXISTS "program members staff all" ON public.research_program_members;
CREATE POLICY "program members staff all" ON public.research_program_members
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

-- ----------------------------------------------------------------------------
-- Projekty programu
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.research_program_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.research_programs(id) ON DELETE CASCADE,
  name_pl text NOT NULL,
  name_en text NOT NULL,
  summary_pl text,
  summary_en text,
  project_status text NOT NULL DEFAULT 'active'
    CHECK (project_status IN ('planned', 'active', 'completed')),
  url text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (btrim(name_pl) <> '' AND btrim(name_en) <> '')
);

CREATE INDEX IF NOT EXISTS idx_research_program_projects_program
  ON public.research_program_projects (program_id, sort_order);

DROP TRIGGER IF EXISTS research_program_projects_set_updated_at ON public.research_program_projects;
CREATE TRIGGER research_program_projects_set_updated_at
  BEFORE UPDATE ON public.research_program_projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS research_program_projects_tenant ON public.research_program_projects;
CREATE TRIGGER research_program_projects_tenant
  BEFORE INSERT ON public.research_program_projects
  FOR EACH ROW EXECUTE FUNCTION public.tg_research_program_child_tenant();

GRANT SELECT ON public.research_program_projects TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.research_program_projects TO authenticated;
GRANT ALL ON public.research_program_projects TO service_role;
ALTER TABLE public.research_program_projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "program projects public read" ON public.research_program_projects;
CREATE POLICY "program projects public read" ON public.research_program_projects
  FOR SELECT TO anon, authenticated
  USING (
    tenant_id = (SELECT public.public_tenant_id())
    AND EXISTS (
      SELECT 1 FROM public.research_programs p
       WHERE p.id = research_program_projects.program_id AND p.status = 'published'
    )
  );

DROP POLICY IF EXISTS "program projects staff all" ON public.research_program_projects;
CREATE POLICY "program projects staff all" ON public.research_program_projects
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

-- ----------------------------------------------------------------------------
-- Partnerzy programu
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.research_program_partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.research_programs(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (btrim(name) <> ''),
  logo_url text,
  url text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_research_program_partners_program
  ON public.research_program_partners (program_id, sort_order);

DROP TRIGGER IF EXISTS research_program_partners_tenant ON public.research_program_partners;
CREATE TRIGGER research_program_partners_tenant
  BEFORE INSERT ON public.research_program_partners
  FOR EACH ROW EXECUTE FUNCTION public.tg_research_program_child_tenant();

GRANT SELECT ON public.research_program_partners TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.research_program_partners TO authenticated;
GRANT ALL ON public.research_program_partners TO service_role;
ALTER TABLE public.research_program_partners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "program partners public read" ON public.research_program_partners;
CREATE POLICY "program partners public read" ON public.research_program_partners
  FOR SELECT TO anon, authenticated
  USING (
    tenant_id = (SELECT public.public_tenant_id())
    AND EXISTS (
      SELECT 1 FROM public.research_programs p
       WHERE p.id = research_program_partners.program_id AND p.status = 'published'
    )
  );

DROP POLICY IF EXISTS "program partners staff all" ON public.research_program_partners;
CREATE POLICY "program partners staff all" ON public.research_program_partners
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

-- ----------------------------------------------------------------------------
-- Kuratorowane tresci programu (raport flagowy / podcast / wydarzenie)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.research_program_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.research_programs(id) ON DELETE CASCADE,
  item_type text NOT NULL CHECK (item_type IN ('flagship_post', 'podcast', 'event')),
  post_id uuid REFERENCES public.posts(id) ON DELETE CASCADE,
  podcast_id uuid REFERENCES public.podcasts(id) ON DELETE CASCADE,
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (item_type = 'flagship_post' AND post_id IS NOT NULL AND podcast_id IS NULL AND event_id IS NULL)
    OR (item_type = 'podcast' AND podcast_id IS NOT NULL AND post_id IS NULL AND event_id IS NULL)
    OR (item_type = 'event' AND event_id IS NOT NULL AND post_id IS NULL AND podcast_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_research_program_items_program
  ON public.research_program_items (program_id, item_type, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS uq_research_program_items_post
  ON public.research_program_items (program_id, post_id) WHERE post_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_research_program_items_podcast
  ON public.research_program_items (program_id, podcast_id) WHERE podcast_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_research_program_items_event
  ON public.research_program_items (program_id, event_id) WHERE event_id IS NOT NULL;

DROP TRIGGER IF EXISTS research_program_items_tenant ON public.research_program_items;
CREATE TRIGGER research_program_items_tenant
  BEFORE INSERT ON public.research_program_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_research_program_child_tenant();

GRANT SELECT ON public.research_program_items TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.research_program_items TO authenticated;
GRANT ALL ON public.research_program_items TO service_role;
ALTER TABLE public.research_program_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "program items public read" ON public.research_program_items;
CREATE POLICY "program items public read" ON public.research_program_items
  FOR SELECT TO anon, authenticated
  USING (
    tenant_id = (SELECT public.public_tenant_id())
    AND EXISTS (
      SELECT 1 FROM public.research_programs p
       WHERE p.id = research_program_items.program_id AND p.status = 'published'
    )
  );

DROP POLICY IF EXISTS "program items staff all" ON public.research_program_items;
CREATE POLICY "program items staff all" ON public.research_program_items
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

-- ----------------------------------------------------------------------------
-- Zespol programu przez RPC: tylko bezpieczne pola profilu, tylko
-- opublikowane programy publicznego tenanta (niezaleznie od RLS profiles).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_program_members(p_program_ids uuid[])
RETURNS TABLE (
  program_id uuid,
  profile_id uuid,
  display_name text,
  avatar_url text,
  job_title text,
  profile_slug text,
  member_role_pl text,
  member_role_en text,
  is_lead boolean,
  sort_order integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.program_id,
         m.profile_id,
         COALESCE(NULLIF(btrim(pr.display_name), ''),
                  NULLIF(btrim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
                  'NES') AS display_name,
         pr.avatar_url,
         pr.job_title,
         pr.slug AS profile_slug,
         m.member_role_pl,
         m.member_role_en,
         m.is_lead,
         m.sort_order
    FROM public.research_program_members m
    JOIN public.research_programs p ON p.id = m.program_id
    JOIN public.profiles pr ON pr.id = m.profile_id
   WHERE m.program_id = ANY (p_program_ids)
     AND p.tenant_id = public.public_tenant_id()
     AND p.status = 'published'
   ORDER BY m.is_lead DESC, m.sort_order, m.created_at;
$$;

REVOKE EXECUTE ON FUNCTION public.get_program_members(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_program_members(uuid[])
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Seed: szesc specjalizacji NES dla domyslnego tenanta (idempotentnie).
-- Tresc jest redakcyjna i edytowalna w /admin/programs; kategorie sa
-- podpinane best-effort po slugu (NULL, gdy kategoria nie istnieje).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants WHERE is_default LIMIT 1;
  IF v_tenant IS NULL THEN
    SELECT id INTO v_tenant FROM public.tenants WHERE slug = 'nes' LIMIT 1;
  END IF;
  IF v_tenant IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.research_programs (
    tenant_id, slug, name_pl, name_en, tagline_pl, tagline_en,
    scope_pl, scope_en, research_questions, icon, accent_color,
    category_id, sort_order, status
  )
  VALUES
    (
      v_tenant, 'geopolityka-i-dyplomacja',
      'Geopolityka i dyplomacja', 'Geopolitics & Diplomacy',
      'Europa w świecie rywalizacji mocarstw: mapujemy interesy, koalicje i dźwignie wpływu, zanim staną się faktami dokonanymi.',
      'Europe in an age of great-power rivalry: we map interests, coalitions and levers of influence before they become faits accomplis.',
      'Program bada pozycję Europy Środkowej i całej UE w zmieniającym się ładzie międzynarodowym: politykę zagraniczną państw członkowskich, relacje transatlantyckie, politykę wschodnią i rozszerzenie, oraz instrumenty dyplomacji publicznej i gospodarczej.',
      'The programme examines the position of Central Europe and the EU in a shifting international order: member-state foreign policies, transatlantic relations, Eastern policy and enlargement, and the instruments of public and economic diplomacy.',
      '[{"pl":"Jak UE może utrzymać podmiotowość między USA a Chinami?","en":"How can the EU retain agency between the US and China?"},{"pl":"Jaka architektura bezpieczeństwa powstanie na wschodniej flance po wojnie w Ukrainie?","en":"What security architecture will emerge on the eastern flank after the war in Ukraine?"},{"pl":"Które koalicje wewnątrz UE realnie decydują o polityce zagranicznej?","en":"Which intra-EU coalitions actually shape foreign policy?"}]'::jsonb,
      'Globe', '#1e3a8a',
      (SELECT id FROM public.categories WHERE tenant_id = v_tenant AND slug IN ('geopolityka', 'polityka-europejska') ORDER BY slug = 'geopolityka' DESC LIMIT 1),
      1, 'published'
    ),
    (
      v_tenant, 'bezpieczenstwo-i-obronnosc',
      'Bezpieczeństwo i obronność', 'Security & Defence',
      'Od zdolności wojskowych po odporność społeczną: analizujemy, czego naprawdę wymaga obrona Europy.',
      'From military capabilities to societal resilience: we analyse what defending Europe actually requires.',
      'Program obejmuje politykę obronną NATO i UE, rozwój zdolności i przemysłu obronnego, odstraszanie konwencjonalne i nuklearne, bezpieczeństwo hybrydowe, cyberbezpieczeństwo oraz odporność infrastruktury krytycznej.',
      'The programme covers NATO and EU defence policy, capability development and the defence industry, conventional and nuclear deterrence, hybrid threats, cybersecurity and the resilience of critical infrastructure.',
      '[{"pl":"Jak sfinansować i zorganizować europejskie zbrojenia na dekadę?","en":"How should Europe finance and organise a decade of rearmament?"},{"pl":"Co odstrasza Rosję: zdolności, obecność czy determinacja polityczna?","en":"What deters Russia: capabilities, presence or political resolve?"},{"pl":"Jak chronić infrastrukturę krytyczną przed sabotażem i atakami hybrydowymi?","en":"How to protect critical infrastructure from sabotage and hybrid attacks?"}]'::jsonb,
      'Shield', '#9f1239',
      (SELECT id FROM public.categories WHERE tenant_id = v_tenant AND slug IN ('bezpieczenstwo', 'obronnosc') ORDER BY slug = 'bezpieczenstwo' DESC LIMIT 1),
      2, 'published'
    ),
    (
      v_tenant, 'gospodarka-i-handel',
      'Gospodarka i handel', 'Economy & Trade',
      'Konkurencyjność, łańcuchy dostaw i polityka przemysłowa: gospodarcze fundamenty pozycji Europy.',
      'Competitiveness, supply chains and industrial policy: the economic foundations of Europe''s position.',
      'Program analizuje politykę gospodarczą UE i państw członkowskich: jednolity rynek, politykę przemysłową i pomoc publiczną, handel międzynarodowy i instrumenty ekonomicznego bezpieczeństwa, finanse publiczne oraz konkurencyjność regionu.',
      'The programme analyses EU and member-state economic policy: the single market, industrial policy and state aid, international trade and economic-security instruments, public finances and the region''s competitiveness.',
      '[{"pl":"Jak pogodzić zieloną transformację z konkurencyjnością przemysłu?","en":"How to reconcile the green transition with industrial competitiveness?"},{"pl":"Gdzie przebiegają granice de-riskingu wobec Chin?","en":"Where are the limits of de-risking from China?"},{"pl":"Czy Europa Środkowa utknie w pułapce średniego dochodu?","en":"Will Central Europe get stuck in the middle-income trap?"}]'::jsonb,
      'TrendingUp', '#065f46',
      (SELECT id FROM public.categories WHERE tenant_id = v_tenant AND slug IN ('gospodarka', 'handel') ORDER BY slug = 'gospodarka' DESC LIMIT 1),
      3, 'published'
    ),
    (
      v_tenant, 'technologia-i-cyfryzacja',
      'Technologia i cyfryzacja', 'Technology & Digital',
      'AI, dane i suwerenność technologiczna: kto ustala reguły cyfrowej Europy?',
      'AI, data and tech sovereignty: who writes the rules of digital Europe?',
      'Program bada politykę technologiczną UE: regulacje AI i platform (AI Act, DSA/DMA), suwerenność technologiczną i półprzewodniki, cyberprzestrzeń jako domenę rywalizacji oraz wpływ technologii na demokrację i rynek pracy.',
      'The programme studies EU technology policy: AI and platform regulation (AI Act, DSA/DMA), tech sovereignty and semiconductors, cyberspace as a domain of rivalry, and technology''s impact on democracy and labour markets.',
      '[{"pl":"Czy regulacje UE budują przewagę, czy zależność technologiczną?","en":"Do EU regulations build advantage or technological dependence?"},{"pl":"Jak Europa może realnie konkurować w AI i półprzewodnikach?","en":"How can Europe genuinely compete in AI and semiconductors?"},{"pl":"Jak bronić infosfery przed dezinformacją bez cenzury?","en":"How to defend the information space from disinformation without censorship?"}]'::jsonb,
      'Cpu', '#6d28d9',
      (SELECT id FROM public.categories WHERE tenant_id = v_tenant AND slug IN ('technologia', 'cyfryzacja') ORDER BY slug = 'technologia' DESC LIMIT 1),
      4, 'published'
    ),
    (
      v_tenant, 'energia-i-klimat',
      'Energia i klimat', 'Energy & Climate',
      'Bezpieczeństwo energetyczne i transformacja: jak odejść od paliw kopalnych, nie tracąc przemysłu i spójności społecznej.',
      'Energy security and transition: how to move beyond fossil fuels without losing industry or social cohesion.',
      'Program obejmuje bezpieczeństwo energetyczne regionu, transformację energetyczną i politykę klimatyczną UE (Fit for 55, ETS), energetykę jądrową i OZE, rynki energii oraz geopolitykę surowców krytycznych.',
      'The programme covers regional energy security, the energy transition and EU climate policy (Fit for 55, ETS), nuclear and renewables, energy markets and the geopolitics of critical raw materials.',
      '[{"pl":"Jak zapewnić stabilne i tanie dostawy energii w trakcie transformacji?","en":"How to keep energy secure and affordable through the transition?"},{"pl":"Jaka jest realna rola atomu w miksie energetycznym Europy Środkowej?","en":"What is the realistic role of nuclear in Central Europe''s energy mix?"},{"pl":"Kto kontroluje surowce krytyczne dla transformacji?","en":"Who controls the raw materials critical to the transition?"}]'::jsonb,
      'Zap', '#b45309',
      (SELECT id FROM public.categories WHERE tenant_id = v_tenant AND slug IN ('energia', 'energetyka', 'klimat') ORDER BY slug = 'energia' DESC LIMIT 1),
      5, 'published'
    ),
    (
      v_tenant, 'transport-i-infrastruktura',
      'Transport i infrastruktura', 'Transport & Infrastructure',
      'Korytarze, porty i mobilność wojskowa: infrastruktura jako twarda waluta geopolityki.',
      'Corridors, ports and military mobility: infrastructure as the hard currency of geopolitics.',
      'Program bada politykę transportową i infrastrukturalną: sieci TEN-T i korytarze transportowe, mobilność wojskową, porty i logistykę, kolej i lotnictwo, oraz infrastrukturę jako narzędzie integracji regionu Trójmorza.',
      'The programme examines transport and infrastructure policy: TEN-T networks and corridors, military mobility, ports and logistics, rail and aviation, and infrastructure as a tool of Three Seas regional integration.',
      '[{"pl":"Które korytarze transportowe zdecydują o pozycji regionu?","en":"Which transport corridors will define the region''s position?"},{"pl":"Jak przyspieszyć mobilność wojskową na osi północ-południe?","en":"How to accelerate military mobility along the north-south axis?"},{"pl":"Jak finansować infrastrukturę strategiczną poza cyklem politycznym?","en":"How to finance strategic infrastructure beyond the political cycle?"}]'::jsonb,
      'Route', '#0e7490',
      (SELECT id FROM public.categories WHERE tenant_id = v_tenant AND slug IN ('transport', 'infrastruktura') ORDER BY slug = 'transport' DESC LIMIT 1),
      6, 'published'
    )
  ON CONFLICT (tenant_id, slug) DO NOTHING;
END $$;
