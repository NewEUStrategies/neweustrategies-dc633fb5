
DROP POLICY IF EXISTS "Media bucket public read" ON storage.objects;
CREATE POLICY "Media bucket staff list" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'media' AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor') OR public.has_role(auth.uid(), 'author')));
