ALTER TABLE public.user_read_history
  ALTER COLUMN tenant_id SET DEFAULT COALESCE(public.current_tenant_id(), public.public_tenant_id());

DROP POLICY IF EXISTS "read_history owner select" ON public.user_read_history;
CREATE POLICY "read_history owner select" ON public.user_read_history
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  );

DROP POLICY IF EXISTS "read_history owner insert" ON public.user_read_history;
CREATE POLICY "read_history owner insert" ON public.user_read_history
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  );

DROP POLICY IF EXISTS "read_history owner update" ON public.user_read_history;
CREATE POLICY "read_history owner update" ON public.user_read_history
  FOR UPDATE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  );

DROP POLICY IF EXISTS "read_history owner delete" ON public.user_read_history;
CREATE POLICY "read_history owner delete" ON public.user_read_history
  FOR DELETE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  );

DROP POLICY IF EXISTS "personality_history_owner_read" ON public.personality_result_history;
CREATE POLICY "personality_history_owner_read" ON public.personality_result_history
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  );

COMMENT ON TABLE public.user_read_history IS
  'Historia czytania wpisow. Plaszczyzna wlasciciela jest tenant-scoped od 20260831170000 (odczyt i zapis).';
COMMENT ON TABLE public.personality_result_history IS
  'Historia wynikow testu osobowosci. Odczyt wlasciciela jest tenant-scoped od 20260831170000.';