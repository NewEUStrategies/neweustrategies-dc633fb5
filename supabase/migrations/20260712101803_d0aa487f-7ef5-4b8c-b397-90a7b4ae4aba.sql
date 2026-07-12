CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.search_query_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL,
  q text NOT NULL,
  lang text NOT NULL DEFAULT 'pl',
  results int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.search_query_log TO service_role;

ALTER TABLE public.search_query_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS search_query_log_tenant_created_idx
  ON public.search_query_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS search_query_log_tenant_q_idx
  ON public.search_query_log (tenant_id, q);

CREATE OR REPLACE FUNCTION public.log_search_query(
  _q text, _lang text DEFAULT 'pl', _results int DEFAULT 0
) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_tid uuid; v_q text; v_recent int;
BEGIN
  v_q := left(btrim(lower(coalesce(_q, ''))), 120);
  IF length(v_q) < 2 THEN RETURN; END IF;
  v_tid := coalesce(public.current_tenant_id(), public.public_tenant_id());
  IF v_tid IS NULL THEN RETURN; END IF;
  SELECT count(*) INTO v_recent FROM public.search_query_log
   WHERE tenant_id = v_tid AND created_at > now() - interval '1 minute';
  IF v_recent >= 120 THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.search_query_log
     WHERE tenant_id = v_tid AND q = v_q
       AND created_at > now() - interval '10 seconds') THEN RETURN; END IF;
  INSERT INTO public.search_query_log (tenant_id, q, lang, results)
  VALUES (v_tid, v_q, CASE WHEN _lang = 'en' THEN 'en' ELSE 'pl' END,
          GREATEST(coalesce(_results, 0), 0));
END; $$;

GRANT EXECUTE ON FUNCTION public.log_search_query(text, text, int) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.popular_searches(
  _days int DEFAULT 30, _limit int DEFAULT 6
) RETURNS TABLE (q text, cnt bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH ctx AS (SELECT coalesce(public.current_tenant_id(), public.public_tenant_id()) AS tid)
  SELECT l.q, count(*) AS cnt
    FROM public.search_query_log l, ctx
   WHERE l.tenant_id = ctx.tid
     AND l.created_at > now() - make_interval(days => GREATEST(LEAST(_days, 365), 1))
     AND l.results > 0 AND length(l.q) >= 3
   GROUP BY l.q ORDER BY cnt DESC, l.q
   LIMIT GREATEST(LEAST(_limit, 12), 1);
$$;

GRANT EXECUTE ON FUNCTION public.popular_searches(int, int) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.search_suggest(
  _q text, _limit int DEFAULT 5
) RETURNS TABLE (id uuid, slug text, title_pl text, title_en text, sim real)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH ctx AS (SELECT coalesce(public.current_tenant_id(), public.public_tenant_id()) AS tid),
  nq AS (SELECT public.unaccent(lower(btrim(coalesce(_q, '')))) AS q)
  SELECT p.id, p.slug, p.title_pl, p.title_en,
         GREATEST(
           extensions.word_similarity(nq.q, public.unaccent(lower(coalesce(p.title_pl, '')))),
           extensions.word_similarity(nq.q, public.unaccent(lower(coalesce(p.title_en, ''))))
         )::real AS sim
    FROM public.posts p, ctx, nq
   WHERE length(nq.q) >= 3
     AND p.status = 'published' AND p.deleted_at IS NULL
     AND p.tenant_id = ctx.tid
     AND GREATEST(
           extensions.word_similarity(nq.q, public.unaccent(lower(coalesce(p.title_pl, '')))),
           extensions.word_similarity(nq.q, public.unaccent(lower(coalesce(p.title_en, ''))))
         ) > 0.35
   ORDER BY sim DESC, p.published_at DESC NULLS LAST
   LIMIT GREATEST(LEAST(_limit, 10), 1);
$$;

GRANT EXECUTE ON FUNCTION public.search_suggest(text, int) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.search_posts(text, int, uuid, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.search_posts(
  _q text, _limit int DEFAULT 80, _author uuid DEFAULT NULL,
  _date_from timestamptz DEFAULT NULL, _date_to timestamptz DEFAULT NULL,
  _category uuid DEFAULT NULL
) RETURNS TABLE (
  id uuid, slug text, title_pl text, title_en text,
  excerpt_pl text, excerpt_en text, cover_image_url text,
  published_at timestamptz, parent_page_id uuid, author_id uuid, rank real,
  headline_pl text, headline_en text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH ctx AS (SELECT coalesce(public.current_tenant_id(), public.public_tenant_id()) AS tid),
  tq AS (SELECT public.nes_search_tsquery(_q) AS q)
  SELECT p.id, p.slug, p.title_pl, p.title_en, p.excerpt_pl, p.excerpt_en,
         p.cover_image_url, p.published_at, p.parent_page_id, p.author_id,
         ts_rank_cd(p.search_vector, tq.q)::real AS rank,
         ts_headline('simple',
           left(coalesce(p.excerpt_pl, '') || ' ' ||
                regexp_replace(coalesce(p.content_pl, ''), '<[^>]+>', ' ', 'g'), 4000),
           tq.q,
           'StartSel=[[[, StopSel=]]], MaxWords=28, MinWords=12, ShortWord=2, MaxFragments=1'
         ) AS headline_pl,
         ts_headline('simple',
           left(coalesce(p.excerpt_en, '') || ' ' ||
                regexp_replace(coalesce(p.content_en, ''), '<[^>]+>', ' ', 'g'), 4000),
           tq.q,
           'StartSel=[[[, StopSel=]]], MaxWords=28, MinWords=12, ShortWord=2, MaxFragments=1'
         ) AS headline_en
    FROM public.posts p, tq, ctx
   WHERE tq.q IS NOT NULL
     AND p.search_vector @@ tq.q
     AND p.status = 'published' AND p.deleted_at IS NULL
     AND p.tenant_id = ctx.tid
     AND (_author IS NULL OR p.author_id = _author)
     AND (_date_from IS NULL OR p.published_at >= _date_from)
     AND (_date_to IS NULL OR p.published_at <= _date_to)
     AND (_category IS NULL OR EXISTS (
           SELECT 1 FROM public.post_categories pc
            WHERE pc.post_id = p.id AND pc.category_id = _category))
   ORDER BY rank DESC, p.published_at DESC NULLS LAST
   LIMIT GREATEST(LEAST(_limit, 200), 1);
$$;

GRANT EXECUTE ON FUNCTION
  public.search_posts(text, int, uuid, timestamptz, timestamptz, uuid)
  TO anon, authenticated;