
-- Media folders (virtual, tenant-scoped). folder_path columns on media reference these logical paths.
-- Path convention: always starts and ends with '/'. Root = '/'.

ALTER TABLE public.media
  ADD COLUMN IF NOT EXISTS folder_path text NOT NULL DEFAULT '/';

CREATE INDEX IF NOT EXISTS media_tenant_folder_idx ON public.media (tenant_id, folder_path);

CREATE TABLE IF NOT EXISTS public.media_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  path text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, path),
  CHECK (path LIKE '/%' AND path LIKE '%/')
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_folders TO authenticated;
GRANT ALL ON public.media_folders TO service_role;

ALTER TABLE public.media_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "media_folders tenant select" ON public.media_folders
  FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY "media_folders tenant insert" ON public.media_folders
  FOR INSERT WITH CHECK (
    tenant_id = current_tenant_id() AND
    (has_role(auth.uid(), 'admin'::app_role)
     OR has_role(auth.uid(), 'editor'::app_role)
     OR has_role(auth.uid(), 'author'::app_role))
  );
CREATE POLICY "media_folders tenant update" ON public.media_folders
  FOR UPDATE USING (
    tenant_id = current_tenant_id() AND
    (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
  );
CREATE POLICY "media_folders tenant delete" ON public.media_folders
  FOR DELETE USING (
    tenant_id = current_tenant_id() AND
    (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
  );
