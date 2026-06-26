
-- 1. categories / tags: scope public reads to the public tenant
DROP POLICY IF EXISTS "Categories public read" ON public.categories;
CREATE POLICY "Categories public read" ON public.categories
  FOR SELECT
  USING (tenant_id = public.public_tenant_id());

DROP POLICY IF EXISTS "Tags public read" ON public.tags;
CREATE POLICY "Tags public read" ON public.tags
  FOR SELECT
  USING (tenant_id = public.public_tenant_id());

-- 2. contact_messages: add tenant_id and tenant-scope all policies
ALTER TABLE public.contact_messages
  ADD COLUMN IF NOT EXISTS tenant_id uuid NOT NULL DEFAULT public.public_tenant_id();
CREATE INDEX IF NOT EXISTS contact_messages_tenant_idx ON public.contact_messages(tenant_id);

DROP POLICY IF EXISTS "Admins and editors can read contact messages" ON public.contact_messages;
CREATE POLICY "Admins and editors can read contact messages" ON public.contact_messages
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'editor'::app_role))
  );

DROP POLICY IF EXISTS "Admins and editors can update contact messages" ON public.contact_messages;
CREATE POLICY "Admins and editors can update contact messages" ON public.contact_messages
  FOR UPDATE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'editor'::app_role))
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'editor'::app_role))
  );

DROP POLICY IF EXISTS "Admins can delete contact messages" ON public.contact_messages;
CREATE POLICY "Admins can delete contact messages" ON public.contact_messages
  FOR DELETE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );

DROP POLICY IF EXISTS "Anyone can submit a contact message" ON public.contact_messages;
CREATE POLICY "Anyone can submit a contact message" ON public.contact_messages
  FOR INSERT
  WITH CHECK (tenant_id = public.public_tenant_id());

-- 3. profiles: restrict anon to author rows and revoke sensitive columns
DROP POLICY IF EXISTS "Profiles anon public read" ON public.profiles;
CREATE POLICY "Profiles anon public authors" ON public.profiles
  FOR SELECT TO anon
  USING (slug IS NOT NULL);
REVOKE SELECT (email, prefs) ON public.profiles FROM anon;

-- 4. site_settings: tenant scoping
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS tenant_id uuid NOT NULL DEFAULT public.public_tenant_id();
CREATE INDEX IF NOT EXISTS site_settings_tenant_idx ON public.site_settings(tenant_id);

DROP POLICY IF EXISTS "site_settings public read" ON public.site_settings;
CREATE POLICY "site_settings public read" ON public.site_settings
  FOR SELECT
  USING (tenant_id = public.public_tenant_id());

DROP POLICY IF EXISTS "site_settings admin insert" ON public.site_settings;
CREATE POLICY "site_settings admin insert" ON public.site_settings
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );

DROP POLICY IF EXISTS "site_settings admin update" ON public.site_settings;
CREATE POLICY "site_settings admin update" ON public.site_settings
  FOR UPDATE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND public.has_role(auth.uid(), 'admin'::app_role)
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );

-- 5. post_views: drop the always-true ALL policy; record_post_view is SECURITY DEFINER
DROP POLICY IF EXISTS "post_views service write" ON public.post_views;
CREATE POLICY "post_views admin read tenant" ON public.post_views
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );

-- 6. SECURITY DEFINER mitigation: switch helper to INVOKER where safe
ALTER FUNCTION public.current_tenant_id() SECURITY INVOKER;
