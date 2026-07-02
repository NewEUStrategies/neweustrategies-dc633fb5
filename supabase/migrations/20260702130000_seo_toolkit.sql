-- ============================================================================
-- SEO toolkit: per-entity SEO fields, redirect manager, 404 monitor.
--
-- 1. posts/pages get Yoast-class SEO columns (bilingual title/description,
--    canonical override, robots noindex, social-image override and the
--    admin-generated OG card URL).
-- 2. `redirects` - the redirect manager backing store. Matched server-side by
--    the request middleware (service role), managed by admins/editors in
--    /admin/redirects. Critical for the WordPress migration: old permalinks
--    keep resolving after the URL structure changes.
-- 3. `seo_404_hits` - lightweight 404 monitor so editors can spot broken
--    legacy URLs after the migration and convert them into redirects.
-- ============================================================================

-- ---------- 1. Per-entity SEO fields ----------

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS seo_title_pl text,
  ADD COLUMN IF NOT EXISTS seo_title_en text,
  ADD COLUMN IF NOT EXISTS seo_description_pl text,
  ADD COLUMN IF NOT EXISTS seo_description_en text,
  ADD COLUMN IF NOT EXISTS seo_canonical_url text,
  ADD COLUMN IF NOT EXISTS seo_noindex boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS seo_og_image_url text,
  ADD COLUMN IF NOT EXISTS og_image_generated_url text;

ALTER TABLE public.pages
  ADD COLUMN IF NOT EXISTS seo_title_pl text,
  ADD COLUMN IF NOT EXISTS seo_title_en text,
  ADD COLUMN IF NOT EXISTS seo_description_pl text,
  ADD COLUMN IF NOT EXISTS seo_description_en text,
  ADD COLUMN IF NOT EXISTS seo_canonical_url text,
  ADD COLUMN IF NOT EXISTS seo_noindex boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS seo_og_image_url text,
  ADD COLUMN IF NOT EXISTS og_image_generated_url text;

-- ---------- 2. Redirect manager ----------

CREATE TABLE IF NOT EXISTS public.redirects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Normalized source: leading slash, no trailing slash (except "/"), lowercase
  -- path; may carry a query string for WP-style shortlinks ("/?p=123").
  source_path text NOT NULL,
  -- Absolute path ("/new-url") or absolute URL ("https://other.example/x").
  target_path text NOT NULL,
  status_code int NOT NULL DEFAULT 301,
  is_enabled boolean NOT NULL DEFAULT true,
  -- Origin of the entry, for the admin list: manual | slug_change | wp_import | csv_import | quick_404
  source text NOT NULL DEFAULT 'manual',
  note text,
  hit_count bigint NOT NULL DEFAULT 0,
  last_hit_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT redirects_source_path_key UNIQUE (source_path),
  CONSTRAINT redirects_status_code_check CHECK (status_code IN (301, 302, 307, 308, 410)),
  CONSTRAINT redirects_source_path_len CHECK (char_length(source_path) BETWEEN 1 AND 2048),
  CONSTRAINT redirects_target_path_len CHECK (char_length(target_path) BETWEEN 1 AND 2048),
  CONSTRAINT redirects_not_self CHECK (source_path <> target_path)
);

CREATE INDEX IF NOT EXISTS redirects_enabled_idx ON public.redirects (is_enabled) WHERE is_enabled;

CREATE TRIGGER redirects_set_updated BEFORE UPDATE ON public.redirects
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Reads happen server-side with the service role (request middleware); the
-- admin UI reads/writes as an authenticated staff user.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.redirects TO authenticated;
GRANT ALL ON public.redirects TO service_role;

ALTER TABLE public.redirects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff reads redirects" ON public.redirects FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor')
  );
CREATE POLICY "Staff inserts redirects" ON public.redirects FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor')
  );
CREATE POLICY "Staff updates redirects" ON public.redirects FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor')
  );
CREATE POLICY "Staff deletes redirects" ON public.redirects FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor')
  );

-- Atomic, fire-and-forget hit counter (called with the service role from the
-- redirect middleware; never blocks the redirect response).
CREATE OR REPLACE FUNCTION public.record_redirect_hit(_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.redirects
  SET hit_count = hit_count + 1, last_hit_at = now()
  WHERE id = _id;
$$;

REVOKE ALL ON FUNCTION public.record_redirect_hit(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_redirect_hit(uuid) TO service_role;

-- ---------- 3. 404 monitor ----------

CREATE TABLE IF NOT EXISTS public.seo_404_hits (
  -- Normalized path (may include a query string), capped by the recorder.
  path text PRIMARY KEY,
  hits bigint NOT NULL DEFAULT 1,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  last_referrer text
);

GRANT SELECT, DELETE ON public.seo_404_hits TO authenticated;
GRANT ALL ON public.seo_404_hits TO service_role;

ALTER TABLE public.seo_404_hits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff reads 404 hits" ON public.seo_404_hits FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor')
  );
CREATE POLICY "Staff deletes 404 hits" ON public.seo_404_hits FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor')
  );

-- Upsert-with-increment; keyed by path so the table stays tiny even under
-- crawler noise. Called fire-and-forget with the service role.
CREATE OR REPLACE FUNCTION public.record_seo_404(_path text, _referrer text DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.seo_404_hits AS h (path, last_referrer)
  VALUES (left(_path, 500), left(_referrer, 500))
  ON CONFLICT (path) DO UPDATE
  SET hits = h.hits + 1,
      last_seen = now(),
      last_referrer = COALESCE(EXCLUDED.last_referrer, h.last_referrer);
$$;

REVOKE ALL ON FUNCTION public.record_seo_404(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_seo_404(text, text) TO service_role;
