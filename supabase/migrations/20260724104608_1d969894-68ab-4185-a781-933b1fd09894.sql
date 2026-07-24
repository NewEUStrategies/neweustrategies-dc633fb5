DROP POLICY IF EXISTS "bookmarks owner select" ON public.user_bookmarks;
CREATE POLICY "bookmarks owner select" ON public.user_bookmarks
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "bookmarks owner insert" ON public.user_bookmarks;
CREATE POLICY "bookmarks owner insert" ON public.user_bookmarks
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "bookmarks owner delete" ON public.user_bookmarks;
CREATE POLICY "bookmarks owner delete" ON public.user_bookmarks
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND tenant_id = public.current_tenant_id());