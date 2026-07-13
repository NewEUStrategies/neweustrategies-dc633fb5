DROP POLICY IF EXISTS "member resources staff read" ON storage.objects;
CREATE POLICY "member resources staff read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id='member-resources' AND (public.has_role((SELECT auth.uid()),'admin'::app_role) OR public.has_role((SELECT auth.uid()),'editor'::app_role)));

DROP POLICY IF EXISTS "member resources staff insert" ON storage.objects;
CREATE POLICY "member resources staff insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='member-resources' AND (public.has_role((SELECT auth.uid()),'admin'::app_role) OR public.has_role((SELECT auth.uid()),'editor'::app_role)));

DROP POLICY IF EXISTS "member resources staff delete" ON storage.objects;
CREATE POLICY "member resources staff delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id='member-resources' AND (public.has_role((SELECT auth.uid()),'admin'::app_role) OR public.has_role((SELECT auth.uid()),'editor'::app_role)));