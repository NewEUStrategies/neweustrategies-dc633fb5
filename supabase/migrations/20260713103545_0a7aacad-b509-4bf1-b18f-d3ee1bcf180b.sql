
-- media_folders: SELECT wymagane staff role (admin/editor/author) w tym tenancie,
-- spójne z insert/update/delete. Zdejmuje ekspozycję struktury folderów dla
-- anonim/zwykłych zalogowanych użytkowników.
DROP POLICY IF EXISTS "media_folders tenant select" ON public.media_folders;
CREATE POLICY "media_folders tenant select" ON public.media_folders
  FOR SELECT TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'editor'::app_role)
      OR has_role(auth.uid(), 'author'::app_role)
    )
  );

-- name_dictionary: to globalny slownik lookupowy uzywany przez content tools;
-- ograniczamy odczyt do staff (super_admin zarzadza, staff czyta do asystentow
-- edycyjnych). Odbiera odczyt szerokiej publicznosci authenticated bez roli.
DROP POLICY IF EXISTS "Authenticated can read names" ON public.name_dictionary;
CREATE POLICY "Staff can read names" ON public.name_dictionary
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'editor'::app_role)
    OR has_role(auth.uid(), 'author'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  );

-- podcast_settings: usuwamy nadmiarowa galaz OR tenant_id = current_tenant_id()
-- - staff czyta wlasny tenant przez podcast_settings_admin_write (ALL); public
-- czyta tylko wybrany tenant publiczny (public_tenant_id()).
DROP POLICY IF EXISTS podcast_settings_public_read ON public.podcast_settings;
CREATE POLICY podcast_settings_public_read ON public.podcast_settings
  FOR SELECT TO anon, authenticated
  USING (tenant_id = public_tenant_id());
