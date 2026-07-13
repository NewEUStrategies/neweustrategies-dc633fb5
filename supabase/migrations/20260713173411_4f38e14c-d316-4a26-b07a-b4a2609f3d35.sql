-- Faceted archive search (PR #24) - applying pending migration to database.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

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

CREATE INDEX IF NOT EXISTS post_categories_category_idx
  ON public.post_categories (category_id, post_id);

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

CREATE OR REPLACE FUNCTION public.nes_pl_light_stem(_term text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
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
  RETURN plainto_tsquery('simple', unaccent(lower(coalesce(_q, ''))));
END;
$$;

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
     WHERE tt.depth < 10
  ),
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
    SELECT b.*, ts_rank(b.search_vector, tq.q)::real AS rank, false AS fuzzy
      FROM base b, tq
     WHERE tq.q IS NOT NULL AND b.search_vector @@ tq.q
  ),
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
     WHERE tt.depth < 10
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
  vocab_tree AS (
    SELECT c.id AS root, c.id AS match_id, 0 AS depth
      FROM public.categories c, ctx
     WHERE c.tenant_id = ctx.tid
    UNION ALL
    SELECT vt.root, c.id, vt.depth + 1
      FROM public.categories c
      JOIN vocab_tree vt ON c.parent_id = vt.match_id
     WHERE vt.depth < 10
  )
  SELECT c.kind AS dim, c.id, c.slug, c.name_pl AS label_pl, c.name_en AS label_en,
         c.parent_id, count(DISTINCT m.id) AS cnt
    FROM matched m
    JOIN public.post_categories pc ON pc.post_id = m.id
    JOIN vocab_tree vt ON vt.match_id = pc.category_id
    JOIN public.categories c ON c.id = vt.root
   GROUP BY c.kind, c.id, c.slug, c.name_pl, c.name_en, c.parent_id
  UNION ALL
  SELECT 'author', pr.id, pr.slug, coalesce(pr.display_name, 'Autor'),
         coalesce(pr.display_name, 'Author'), NULL, count(*)::bigint
    FROM matched m
    JOIN public.profiles pr ON pr.id = m.author_id
   GROUP BY pr.id, pr.slug, pr.display_name
  UNION ALL
  SELECT 'format', NULL, m.post_format, m.post_format, m.post_format, NULL,
         count(*)::bigint
    FROM matched m
   GROUP BY m.post_format
  UNION ALL
  SELECT 'lang', NULL, l.code, l.code, l.code, NULL, count(*)::bigint
    FROM matched m
    CROSS JOIN LATERAL (
      SELECT 'pl'::text AS code WHERE btrim(m.title_pl) <> ''
      UNION ALL
      SELECT 'en' WHERE btrim(m.title_en) <> ''
    ) l
   GROUP BY l.code
  UNION ALL
  SELECT 'access', NULL, m.eff_access, m.eff_access, m.eff_access, NULL,
         count(*)::bigint
    FROM matched m
   GROUP BY m.eff_access
  UNION ALL
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
DROP POLICY IF EXISTS "saved_searches owner insert" ON public.saved_searches;
DROP POLICY IF EXISTS "saved_searches owner update" ON public.saved_searches;
DROP POLICY IF EXISTS "saved_searches owner delete" ON public.saved_searches;

CREATE POLICY "saved_searches owner select" ON public.saved_searches
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "saved_searches owner insert" ON public.saved_searches
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "saved_searches owner update" ON public.saved_searches
  FOR UPDATE TO authenticated USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "saved_searches owner delete" ON public.saved_searches
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_saved_searches_user
  ON public.saved_searches (user_id, created_at DESC);