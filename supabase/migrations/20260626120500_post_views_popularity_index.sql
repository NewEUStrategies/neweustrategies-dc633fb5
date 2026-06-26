-- Composite index for the popularity aggregation shared by trending_posts() and
-- popular_post_ids(): both JOIN post_views ON post_id, filter viewed_at to a
-- recent window, then GROUP BY post_id and count.
--
-- The existing indexes cannot serve that shape efficiently:
--   * post_views_post_idx (post_id)                       - no viewed_at range
--   * post_views_viewed_at_idx (viewed_at)                - no per-post grouping
--   * post_views_post_viewer_idx (post_id, viewer_hash,   - viewer_hash sits
--       viewed_at)                                          between the two
--       columns we need, so the viewed_at range predicate is not usable.
--
-- (post_id, viewed_at DESC) lets the planner seek by post and range-scan the
-- window per post (or aggregate post-ordered) - the natural index for both
-- functions. IF NOT EXISTS keeps the migration idempotent.
CREATE INDEX IF NOT EXISTS post_views_post_viewed_idx
  ON public.post_views (post_id, viewed_at DESC);
