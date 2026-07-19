
-- Storage media: require staff role
DROP POLICY IF EXISTS "media tenant delete" ON storage.objects;
DROP POLICY IF EXISTS "media tenant delete storage" ON storage.objects;
DROP POLICY IF EXISTS "media tenant update" ON storage.objects;
DROP POLICY IF EXISTS "media tenant update storage" ON storage.objects;

CREATE POLICY "media tenant delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'media'
    AND storage_path_tenant(name) = current_tenant_id()
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'editor')
      OR public.has_role(auth.uid(), 'author')
    )
  );

CREATE POLICY "media tenant update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'media'
    AND storage_path_tenant(name) = current_tenant_id()
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'editor')
      OR public.has_role(auth.uid(), 'author')
    )
  );

-- Profiles: hide sensitive columns from anon
REVOKE SELECT (email, phone, contact_email, prefs) ON public.profiles FROM anon;
