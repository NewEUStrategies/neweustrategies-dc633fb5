ALTER TABLE public.archive_layout_settings
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;

UPDATE public.archive_layout_settings
   SET tenant_id = (SELECT id FROM public.tenants WHERE is_default = true LIMIT 1)
 WHERE tenant_id IS NULL;

ALTER TABLE public.archive_layout_settings
  ALTER COLUMN tenant_id SET NOT NULL,
  ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();

ALTER TABLE public.archive_layout_settings
  DROP CONSTRAINT IF EXISTS archive_layout_settings_archive_type_key;

CREATE UNIQUE INDEX IF NOT EXISTS archive_layout_settings_tenant_type_key
  ON public.archive_layout_settings (tenant_id, archive_type);

CREATE INDEX IF NOT EXISTS archive_layout_settings_tenant_idx
  ON public.archive_layout_settings (tenant_id);

DROP POLICY IF EXISTS "Archive layout settings are viewable by everyone" ON public.archive_layout_settings;
DROP POLICY IF EXISTS "Only admins can modify archive layout settings" ON public.archive_layout_settings;

CREATE POLICY "Archive layout settings are readable by tenant scope"
  ON public.archive_layout_settings
  FOR SELECT
  USING (tenant_id = public.public_tenant_id());

CREATE POLICY "Admins manage archive layout settings"
  ON public.archive_layout_settings
  FOR ALL
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin'::app_role)
         OR public.has_role(auth.uid(), 'super_admin'::app_role))
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin'::app_role)
         OR public.has_role(auth.uid(), 'super_admin'::app_role))
  );