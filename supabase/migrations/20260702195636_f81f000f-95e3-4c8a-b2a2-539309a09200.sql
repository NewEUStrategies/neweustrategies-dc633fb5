-- Per-entity SEO fields on posts/pages
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

-- Redirect manager
CREATE TABLE IF NOT EXISTS public.redirects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_path text NOT NULL,
  target_path text NOT NULL,
  status_code int NOT NULL DEFAULT 301,
  is_enabled boolean NOT NULL DEFAULT true,
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.redirects TO authenticated;
GRANT ALL ON public.redirects TO service_role;

ALTER TABLE public.redirects ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS redirects_set_updated ON public.redirects;
CREATE TRIGGER redirects_set_updated BEFORE UPDATE ON public.redirects
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP POLICY IF EXISTS "Staff reads redirects" ON public.redirects;
CREATE POLICY "Staff reads redirects" ON public.redirects FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));
DROP POLICY IF EXISTS "Staff inserts redirects" ON public.redirects;
CREATE POLICY "Staff inserts redirects" ON public.redirects FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));
DROP POLICY IF EXISTS "Staff updates redirects" ON public.redirects;
CREATE POLICY "Staff updates redirects" ON public.redirects FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));
DROP POLICY IF EXISTS "Staff deletes redirects" ON public.redirects;
CREATE POLICY "Staff deletes redirects" ON public.redirects FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));

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

-- 404 monitor
CREATE TABLE IF NOT EXISTS public.seo_404_hits (
  path text PRIMARY KEY,
  hits bigint NOT NULL DEFAULT 1,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  last_referrer text
);

GRANT SELECT, DELETE ON public.seo_404_hits TO authenticated;
GRANT ALL ON public.seo_404_hits TO service_role;

ALTER TABLE public.seo_404_hits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff reads 404 hits" ON public.seo_404_hits;
CREATE POLICY "Staff reads 404 hits" ON public.seo_404_hits FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));
DROP POLICY IF EXISTS "Staff deletes 404 hits" ON public.seo_404_hits;
CREATE POLICY "Staff deletes 404 hits" ON public.seo_404_hits FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));

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