-- media_mentions: owner plane must be tenant-scoped (read + write)
ALTER TABLE public.media_mentions
  ALTER COLUMN tenant_id SET DEFAULT COALESCE(public.current_tenant_id(), public.public_tenant_id());

DROP POLICY IF EXISTS "media_mentions owner read" ON public.media_mentions;
CREATE POLICY "media_mentions owner read" ON public.media_mentions
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  );

DROP POLICY IF EXISTS "media_mentions owner manage" ON public.media_mentions;
CREATE POLICY "media_mentions owner manage" ON public.media_mentions
  FOR ALL TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  );

-- saved_searches: owner plane tenant-scoped
DROP POLICY IF EXISTS "saved_searches owner select" ON public.saved_searches;
CREATE POLICY "saved_searches owner select" ON public.saved_searches
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  );

DROP POLICY IF EXISTS "saved_searches owner insert" ON public.saved_searches;
CREATE POLICY "saved_searches owner insert" ON public.saved_searches
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  );

DROP POLICY IF EXISTS "saved_searches owner update" ON public.saved_searches;
CREATE POLICY "saved_searches owner update" ON public.saved_searches
  FOR UPDATE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  );

DROP POLICY IF EXISTS "saved_searches owner delete" ON public.saved_searches;
CREATE POLICY "saved_searches owner delete" ON public.saved_searches
  FOR DELETE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  );

-- user_follows: owner plane tenant-scoped
DROP POLICY IF EXISTS "follows owner select" ON public.user_follows;
CREATE POLICY "follows owner select" ON public.user_follows
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  );

DROP POLICY IF EXISTS "follows owner insert" ON public.user_follows;
CREATE POLICY "follows owner insert" ON public.user_follows
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  );

DROP POLICY IF EXISTS "follows owner delete" ON public.user_follows;
CREATE POLICY "follows owner delete" ON public.user_follows
  FOR DELETE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  );