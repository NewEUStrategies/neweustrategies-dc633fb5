-- ============================================================================
-- HUB EKSPERTA (wzorzec profili CSIS): ekspert jako pełnoprawny obiekt
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
