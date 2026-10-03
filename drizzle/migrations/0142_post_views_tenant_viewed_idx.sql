CREATE INDEX IF NOT EXISTS post_views_tenant_viewed_idx
  ON public.post_views (tenant_id, viewed_at DESC);

COMMENT ON INDEX public.post_views_tenant_viewed_idx IS
  'Okno odslon najemcy: tenant_id = ? AND viewed_at >= ? [AND viewed_at <= ?] ORDER BY viewed_at DESC - audytorium (getAudienceSegments), admin_dashboard_content, analytics_semantic_snapshot, related_posts_signals. Przejmuje role post_views_tenant_idx (jego prefiks).';

DROP INDEX IF EXISTS public.post_views_tenant_idx;
