-- Podcast jako sieć programów (wzorzec RUSI/CSIS), nie płaska lista plików.
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
CREATE TABLE public.podcast_shows (
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

CREATE POLICY "podcast_shows_public_read"
  ON public.podcast_shows FOR SELECT
  TO anon, authenticated
  USING (status = 'published' AND deleted_at IS NULL);

CREATE POLICY "podcast_shows_staff_read_all"
  ON public.podcast_shows FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor') OR public.has_role(auth.uid(),'author'))
  );

CREATE POLICY "podcast_shows_editor_insert"
  ON public.podcast_shows FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor'))
  );

CREATE POLICY "podcast_shows_editor_update"
  ON public.podcast_shows FOR UPDATE
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor'))
  );

CREATE POLICY "podcast_shows_editor_delete"
  ON public.podcast_shows FOR DELETE
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor'))
  );

CREATE TRIGGER set_podcast_shows_updated_at
  BEFORE UPDATE ON public.podcast_shows
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX podcast_shows_tenant_sort_idx
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
CREATE INDEX podcasts_show_season_episode_idx
  ON public.podcasts (tenant_id, show_id, season DESC NULLS LAST, episode_number DESC NULLS LAST)
  WHERE deleted_at IS NULL;

-- Agregacja na stronie specjalizacji (kategorii).
CREATE INDEX podcasts_category_pub_idx
  ON public.podcasts (category_id, published_at DESC NULLS LAST)
  WHERE deleted_at IS NULL AND status = 'published';

-- =========================================================
-- 3) podcast_episode_people (prowadzący i goście odcinka)
-- =========================================================
-- profile_id łączy z profilem eksperta (agregacja na /author/$slug);
-- goście zewnętrzni funkcjonują po display_name + opcjonalnym URL.
CREATE TABLE public.podcast_episode_people (
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
CREATE POLICY "podcast_people_public_read"
  ON public.podcast_episode_people FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.podcasts p
      WHERE p.id = episode_id AND p.status = 'published' AND p.deleted_at IS NULL
    )
  );

CREATE POLICY "podcast_people_staff_read_all"
  ON public.podcast_episode_people FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor') OR public.has_role(auth.uid(),'author'))
  );

-- Zapis zgodny z regułami odcinków: admin/redaktor zawsze, autor tylko przy
-- własnym odcinku.
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

CREATE INDEX podcast_people_episode_idx
  ON public.podcast_episode_people (episode_id, sort_order);

-- Agregacja odcinków na profilu eksperta.
CREATE INDEX podcast_people_profile_idx
  ON public.podcast_episode_people (profile_id)
  WHERE profile_id IS NOT NULL;
