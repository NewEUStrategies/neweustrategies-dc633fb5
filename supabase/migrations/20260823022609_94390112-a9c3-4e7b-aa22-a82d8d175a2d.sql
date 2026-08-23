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
    LEFT JOIN public.post_views v
      ON v.post_id = p.id
     AND v.viewed_at > now() - make_interval(days => GREATEST(_days, 1))
   WHERE p.status = 'published'
     AND p.deleted_at IS NULL
     AND p.tenant_id = public.public_tenant_id()
   GROUP BY p.id
   ORDER BY count(v.id) DESC, p.published_at DESC NULLS LAST
   LIMIT GREATEST(LEAST(_limit, 50), 1);
$$;

REVOKE ALL ON FUNCTION public.trending_posts(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trending_posts(int, int)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.trending_posts(int, int) IS
  'Top published posts of the CURRENT PUBLIC TENANT (host-aware public_tenant_id) ranked by post_views over the last _days, filled up with newest posts without views, capped at _limit (hard max 50). SECURITY DEFINER: re-enforces tenant + published + not-deleted itself.';