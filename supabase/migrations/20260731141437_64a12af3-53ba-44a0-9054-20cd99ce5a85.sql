-- 1) introduction_requests: dodaj zakres tenanta do polityki odczytu
DROP POLICY IF EXISTS intro_read ON public.introduction_requests;
CREATE POLICY intro_read ON public.introduction_requests
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      (SELECT auth.uid()) = requester_id
      OR (SELECT auth.uid()) = bridge_id
      OR (SELECT auth.uid()) = target_id
    )
  );

-- 2) user_connections: dodaj zakres tenanta (także dla ścieżki administracyjnej)
DROP POLICY IF EXISTS user_connections_self_read ON public.user_connections;
CREATE POLICY user_connections_self_read ON public.user_connections
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      (SELECT auth.uid()) = requester_id
      OR (SELECT auth.uid()) = addressee_id
      OR public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'super_admin'::app_role)
    )
  );

-- 3) storage: członkowie z wystarczającym poziomem mogą pobierać pliki
DROP POLICY IF EXISTS "member resources member read" ON storage.objects;
CREATE POLICY "member resources member read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'member-resources'
    AND (storage.foldername(name))[1] = (public.current_tenant_id())::text
    AND EXISTS (
      SELECT 1
      FROM public.member_resources mr
      WHERE mr.file_path = storage.objects.name
        AND mr.published
        AND mr.tenant_id = (SELECT public.current_tenant_id())
        AND public.has_tier_rank(mr.min_tier_rank)
    )
  );