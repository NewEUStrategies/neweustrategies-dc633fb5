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
    -- Autorzy/eksperci: wszystkie widoczne profile w bieżącym tenantcie,
    -- nawet bez opublikowanych postów (żeby wyszukiwarka znajdowała osoby
    -- takie jak Agata / Max, tak samo jak /people i /network).
    SELECT 'author'::text, pr.id, pr.slug,
      coalesce(pr.display_name, 'Autor'),
      coalesce(pr.display_name, 'Author'),
      NULL::uuid,
      public._suggest_score(nq.q, pr.display_name, pr.display_name)
    FROM public.profiles pr, ctx, nq
    WHERE nq.qlen >= 2
      AND pr.discoverable = true
      AND pr.tenant_id = ctx.tid

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