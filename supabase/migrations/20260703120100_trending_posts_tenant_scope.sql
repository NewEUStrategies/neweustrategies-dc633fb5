-- ============================================================================
-- trending_posts: stop leaking posts across tenants (re-audit N1).
--
-- The function is SECURITY DEFINER (bypasses RLS) and is EXECUTE-granted to
-- anon - but unlike its twin popular_post_ids (20260626120000) it never
-- re-enforced the tenant, so the header "Trending" ticker aggregated the
-- published posts of EVERY tenant. Same shape as the twin now:
-- SECURITY DEFINER + fixed search_path, re-enforces tenant + published +
-- not-deleted itself (defence in depth), EXECUTE revoked from PUBLIC and
-- granted to the app roles.
--
-- public_tenant_id() is host-aware since 20260703120000, so "the tenant" is
-- the tenant of the site being browsed - each domain gets its own trending
-- list from one shared function.
-- ============================================================================

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
     AND p.tenant_id = public.public_tenant_id()
     AND v.viewed_at > now() - make_interval(days => GREATEST(_days, 1))
   GROUP BY p.id
   ORDER BY views_count DESC, p.published_at DESC NULLS LAST
   LIMIT GREATEST(LEAST(_limit, 50), 1);
$$;

REVOKE ALL ON FUNCTION public.trending_posts(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trending_posts(int, int)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.trending_posts(int, int) IS
  'Top published posts of the CURRENT PUBLIC TENANT (host-aware '
  'public_tenant_id) by post_views count over the last _days, capped at '
  '_limit (hard max 50). SECURITY DEFINER: re-enforces tenant + published + '
  'not-deleted itself, exactly like popular_post_ids. Backs the header '
  '"Trending" ticker.';
