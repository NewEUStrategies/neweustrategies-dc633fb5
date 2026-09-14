CREATE INDEX IF NOT EXISTS related_post_clicks_tenant_viewer_window_idx
  ON public.related_post_clicks (tenant_id, viewer_hash, clicked_at DESC);

COMMENT ON INDEX public.related_post_clicks_tenant_viewer_window_idx IS
  'Rate-limit beacona rekomendacji: tenant_id + viewer_hash + okno czasu. Dokladne odwzorowanie predykatu z /api/public/related-click.';