
-- ============================================================================
-- Module H: Post views counter + Trending support
-- ============================================================================
-- post_views: append-only log (one row per recorded view).
-- record_post_view(): SECURITY DEFINER, anti-spam window (5 min per viewer hash).
-- trending_posts: aggregated SELECT used by the "Trending" section in Header.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.post_views (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  viewer_hash text NOT NULL,
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  viewed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS post_views_post_idx        ON public.post_views(post_id);
CREATE INDEX IF NOT EXISTS post_views_tenant_idx      ON public.post_views(tenant_id);
CREATE INDEX IF NOT EXISTS post_views_viewed_at_idx   ON public.post_views(viewed_at DESC);
CREATE INDEX IF NOT EXISTS post_views_post_viewer_idx ON public.post_views(post_id, viewer_hash, viewed_at DESC);

GRANT SELECT ON public.post_views TO authenticated, anon;
GRANT ALL    ON public.post_views TO service_role;

ALTER TABLE public.post_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "post_views public read"
  ON public.post_views FOR SELECT TO authenticated, anon
  USING (true);

CREATE POLICY "post_views service write"
  ON public.post_views FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Server-side recorder: dedupes a (post, viewer) tuple inside a 5-min window.
CREATE OR REPLACE FUNCTION public.record_post_view(_post_id uuid, _viewer_hash text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_recent boolean;
BEGIN
  IF _post_id IS NULL OR _viewer_hash IS NULL OR length(_viewer_hash) < 8 THEN
    RETURN;
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.posts WHERE id = _post_id;
  IF v_tenant IS NULL THEN RETURN; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.post_views
     WHERE post_id = _post_id
       AND viewer_hash = _viewer_hash
       AND viewed_at > now() - interval '5 minutes'
  ) INTO v_recent;

  IF v_recent THEN RETURN; END IF;

  INSERT INTO public.post_views (post_id, tenant_id, viewer_hash, user_id)
  VALUES (_post_id, v_tenant, _viewer_hash, auth.uid());
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_post_view(uuid, text) TO authenticated, anon;

-- Trending: top published posts of the last N days by view count.
CREATE OR REPLACE FUNCTION public.trending_posts(_days int DEFAULT 7, _limit int DEFAULT 10)
RETURNS TABLE (
  id uuid, slug text, title_pl text, title_en text,
  cover_image_url text, published_at timestamptz,
  parent_page_id uuid, views_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.slug, p.title_pl, p.title_en,
         p.cover_image_url, p.published_at, p.parent_page_id,
         count(v.id) AS views_count
    FROM public.posts p
    JOIN public.post_views v ON v.post_id = p.id
   WHERE p.status = 'published'
     AND p.deleted_at IS NULL
     AND v.viewed_at > now() - make_interval(days => GREATEST(_days, 1))
   GROUP BY p.id
   ORDER BY views_count DESC, p.published_at DESC NULLS LAST
   LIMIT GREATEST(LEAST(_limit, 50), 1);
$$;

GRANT EXECUTE ON FUNCTION public.trending_posts(int, int) TO authenticated, anon;

-- ============================================================================
-- Fonts storage: re-use existing public "media" bucket under tenant/fonts/*.
-- No new bucket needed; tenant scoping is already enforced by existing policies.
-- ============================================================================
