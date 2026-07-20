
CREATE OR REPLACE FUNCTION public._suggest_score(_q text, _a text, _b text)
RETURNS real
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'extensions'
AS $$
  WITH s AS (
    SELECT
      unaccent(lower(coalesce(_a, ''))) AS a,
      unaccent(lower(coalesce(_b, ''))) AS b,
      _q AS q,
      length(_q) AS qlen
  )
  SELECT GREATEST(
    CASE WHEN s.a = s.q OR s.b = s.q THEN 5.0 ELSE 0 END,
    CASE WHEN s.a LIKE s.q || '%' OR s.b LIKE s.q || '%' THEN 4.0 ELSE 0 END,
    CASE WHEN s.a ~ ('(^|[^[:alnum:]])' || regexp_replace(s.q, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g'))
           OR s.b ~ ('(^|[^[:alnum:]])' || regexp_replace(s.q, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g'))
      THEN 3.0 ELSE 0 END,
    CASE WHEN s.qlen >= 3 AND (position(s.q in s.a) > 0 OR position(s.q in s.b) > 0)
      THEN 2.0 ELSE 0 END,
    CASE WHEN s.qlen >= 4 THEN
      GREATEST(
        CASE WHEN similarity(s.q, s.a) >= 0.6 THEN similarity(s.q, s.a) ELSE 0 END,
        CASE WHEN similarity(s.q, s.b) >= 0.6 THEN similarity(s.q, s.b) ELSE 0 END
      )
    ELSE 0 END
  )::real
  FROM s;
$$;

GRANT EXECUTE ON FUNCTION public._suggest_score(text, text, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.search_autosuggest(_q text, _limit integer DEFAULT 8)
 RETURNS TABLE(kind text, id uuid, slug text, label_pl text, label_en text, parent_page_id uuid, score real)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH ctx AS (
    SELECT coalesce(public.current_tenant_id(), public.public_tenant_id()) AS tid
  ),
  nq AS (
    SELECT
      unaccent(lower(btrim(coalesce(_q, '')))) AS q,
      length(unaccent(lower(btrim(coalesce(_q, ''))))) AS qlen
  ),
  scored AS (
    SELECT
      coalesce(c.kind, 'category')::text AS kind,
      c.id, c.slug, c.name_pl AS label_pl, c.name_en AS label_en,
      NULL::uuid AS parent_page_id,
      public._suggest_score(nq.q, c.name_pl, c.name_en) AS score
    FROM public.categories c, ctx, nq
    WHERE nq.qlen >= 2 AND c.tenant_id = ctx.tid

    UNION ALL
    SELECT 'author'::text, pr.id, pr.slug,
      coalesce(pr.display_name, 'Autor'),
      coalesce(pr.display_name, 'Author'),
      NULL::uuid,
      public._suggest_score(nq.q, pr.display_name, pr.display_name)
    FROM public.profiles pr, ctx, nq
    WHERE nq.qlen >= 2
      AND pr.discoverable = true
      AND pr.tenant_id = ctx.tid
      AND EXISTS (
        SELECT 1 FROM public.posts p
        WHERE p.author_id = pr.id AND p.tenant_id = ctx.tid
          AND p.status = 'published' AND p.deleted_at IS NULL
      )

    UNION ALL
    SELECT 'post'::text, p.id, p.slug, p.title_pl, p.title_en, p.parent_page_id,
      public._suggest_score(nq.q, p.title_pl, p.title_en)
    FROM public.posts p, ctx, nq
    WHERE nq.qlen >= 2
      AND p.tenant_id = ctx.tid
      AND p.status = 'published'
      AND p.deleted_at IS NULL
  )
  SELECT kind, id, slug, label_pl, label_en, parent_page_id, score::real
  FROM scored
  WHERE score > 0
  ORDER BY score DESC, label_pl
  LIMIT GREATEST(LEAST(_limit, 20), 1);
$function$;

GRANT EXECUTE ON FUNCTION public.search_autosuggest(text, integer) TO anon, authenticated, service_role;
