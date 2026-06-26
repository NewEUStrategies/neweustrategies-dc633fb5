-- Server-side popularity aggregation for the builder post-list "popular" order.
--
-- Before: the post-list widget (orderBy = "popular") pulled the ENTIRE
-- user_read_history window down to the client and counted in JS. Two faults:
--   1. Performance - an unbounded full-table read that scales with traffic and,
--      sitting in an above-the-fold widget, could stall the whole SSR render.
--   2. Correctness - user_read_history RLS limits every caller to their OWN rows
--      ("read_history owner select" => user_id = auth.uid()); anonymous public
--      visitors see none. So "popular" returned an empty list on public pages,
--      or a single user's personal history, never true site-wide popularity.
--
-- Fix: aggregate post_views (the anonymous, hashed view counter that already
-- backs trending_posts) inside a SECURITY DEFINER function, scoped to the public
-- tenant, returning only an ordered list of post ids. The widget then intersects
-- those ids with its own category / tag / author filters - no behaviour lost,
-- the O(views) work moves into Postgres behind a hard LIMIT, and popularity is
-- finally computed across all viewers instead of one RLS-restricted caller.
--
-- Security: SECURITY DEFINER + fixed search_path; re-enforces tenant + published
-- + not-deleted (defence in depth); returns ids only (no viewer/PII columns);
-- EXECUTE revoked from PUBLIC and granted to the app roles, exactly like
-- get_entity_content and trending_posts.

CREATE OR REPLACE FUNCTION public.popular_post_ids(
  _days int DEFAULT 30,
  _limit int DEFAULT 200
)
RETURNS TABLE (post_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id
    FROM public.posts p
    JOIN public.post_views v ON v.post_id = p.id
   WHERE p.status = 'published'
     AND p.deleted_at IS NULL
     AND p.tenant_id = public.public_tenant_id()
     AND v.viewed_at > now() - make_interval(days => GREATEST(_days, 1))
   GROUP BY p.id
   ORDER BY count(v.id) DESC, p.published_at DESC NULLS LAST
   LIMIT GREATEST(LEAST(_limit, 500), 1);
$$;

REVOKE ALL ON FUNCTION public.popular_post_ids(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.popular_post_ids(int, int)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.popular_post_ids(int, int) IS
  'Published post ids for the current public tenant ordered by post_views count '
  'over the last _days, capped at _limit (hard max 500). SECURITY DEFINER so it '
  'aggregates across all viewers while re-enforcing tenant + published + '
  'not-deleted. Backs the builder post-list "popular" ordering and replaces an '
  'unbounded client-side scan of user_read_history.';
