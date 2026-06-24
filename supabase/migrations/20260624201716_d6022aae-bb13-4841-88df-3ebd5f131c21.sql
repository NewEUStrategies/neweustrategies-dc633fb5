
-- =========================================================
-- 1) podcasts (episodes)
-- =========================================================
CREATE TABLE public.podcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  title_pl text NOT NULL,
  title_en text NOT NULL DEFAULT '',
  excerpt_pl text NOT NULL DEFAULT '',
  excerpt_en text NOT NULL DEFAULT '',
  show_notes_pl text NOT NULL DEFAULT '',
  show_notes_en text NOT NULL DEFAULT '',
  transcript_pl text NOT NULL DEFAULT '',
  transcript_en text NOT NULL DEFAULT '',
  audio_url text NOT NULL,
  duration_seconds integer NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  episode_number integer,
  season integer,
  cover_image_url text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  published_at timestamptz,
  author_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (tenant_id, slug)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.podcasts TO authenticated;
GRANT SELECT ON public.podcasts TO anon;
GRANT ALL ON public.podcasts TO service_role;

ALTER TABLE public.podcasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "podcasts_public_read"
  ON public.podcasts FOR SELECT
  TO anon, authenticated
  USING (status = 'published' AND deleted_at IS NULL);

CREATE POLICY "podcasts_tenant_read_own"
  ON public.podcasts FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "podcasts_tenant_insert"
  ON public.podcasts FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor') OR public.has_role(auth.uid(),'author'))
  );

CREATE POLICY "podcasts_tenant_update"
  ON public.podcasts FOR UPDATE
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor') OR (public.has_role(auth.uid(),'author') AND author_id = auth.uid()))
  );

CREATE POLICY "podcasts_tenant_delete"
  ON public.podcasts FOR DELETE
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor'))
  );

CREATE TRIGGER set_podcasts_updated_at
  BEFORE UPDATE ON public.podcasts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX podcasts_tenant_status_pub_idx
  ON public.podcasts (tenant_id, status, published_at DESC NULLS LAST)
  WHERE deleted_at IS NULL;

-- =========================================================
-- 2) podcast_settings (singleton per tenant)
-- =========================================================
CREATE TABLE public.podcast_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  default_player_variant text NOT NULL DEFAULT 'full' CHECK (default_player_variant IN ('mini','full','sticky')),
  autoplay_next boolean NOT NULL DEFAULT false,
  show_speed_control boolean NOT NULL DEFAULT true,
  spotify_url text,
  apple_url text,
  google_url text,
  rss_url text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

GRANT SELECT ON public.podcast_settings TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.podcast_settings TO authenticated;
GRANT ALL ON public.podcast_settings TO service_role;

ALTER TABLE public.podcast_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "podcast_settings_public_read"
  ON public.podcast_settings FOR SELECT
  TO anon, authenticated USING (true);

CREATE POLICY "podcast_settings_admin_write"
  ON public.podcast_settings FOR ALL
  TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(),'admin'))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(),'admin'));

CREATE TRIGGER set_podcast_settings_updated_at
  BEFORE UPDATE ON public.podcast_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
