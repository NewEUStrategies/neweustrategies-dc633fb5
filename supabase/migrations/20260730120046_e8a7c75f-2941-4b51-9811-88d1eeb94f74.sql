DROP POLICY IF EXISTS "related_post_clicks public insert" ON public.related_post_clicks;

CREATE POLICY "related_post_clicks public insert"
ON public.related_post_clicks
FOR INSERT
TO anon, authenticated
WITH CHECK (
  (user_id IS NULL OR user_id = auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.posts p
    WHERE p.id = related_post_clicks.source_post_id
      AND p.tenant_id = related_post_clicks.tenant_id
  )
  AND EXISTS (
    SELECT 1 FROM public.posts p
    WHERE p.id = related_post_clicks.target_post_id
      AND p.tenant_id = related_post_clicks.tenant_id
  )
);