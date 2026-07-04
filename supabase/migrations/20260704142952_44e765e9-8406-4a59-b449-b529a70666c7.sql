
-- 1) builder_template_revisions: require staff on INSERT
DROP POLICY IF EXISTS "btr_insert_tenant" ON public.builder_template_revisions;
CREATE POLICY "btr_insert_tenant_staff"
  ON public.builder_template_revisions
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.is_staff()
  );

-- 2) custom_crop_sizes: require admin/editor on writes
DROP POLICY IF EXISTS "Tenant members can insert crop sizes" ON public.custom_crop_sizes;
DROP POLICY IF EXISTS "Tenant members can update crop sizes" ON public.custom_crop_sizes;
DROP POLICY IF EXISTS "Tenant members can delete crop sizes" ON public.custom_crop_sizes;

CREATE POLICY "Staff can insert crop sizes"
  ON public.custom_crop_sizes
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin'::app_role)
         OR public.has_role(auth.uid(), 'editor'::app_role))
  );

CREATE POLICY "Staff can update crop sizes"
  ON public.custom_crop_sizes
  FOR UPDATE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin'::app_role)
         OR public.has_role(auth.uid(), 'editor'::app_role))
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin'::app_role)
         OR public.has_role(auth.uid(), 'editor'::app_role))
  );

CREATE POLICY "Staff can delete crop sizes"
  ON public.custom_crop_sizes
  FOR DELETE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin'::app_role)
         OR public.has_role(auth.uid(), 'editor'::app_role))
  );

-- 3+4) live_blog_entries: fix cross-tenant leak + restrict writes to staff
DROP POLICY IF EXISTS "Public can read live blog entries for published posts" ON public.live_blog_entries;
DROP POLICY IF EXISTS "Tenant members can insert live blog entries" ON public.live_blog_entries;
DROP POLICY IF EXISTS "Tenant members can update their live blog entries" ON public.live_blog_entries;
DROP POLICY IF EXISTS "Tenant members can delete their live blog entries" ON public.live_blog_entries;

CREATE POLICY "Public can read live blog entries for published posts"
  ON public.live_blog_entries
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.id = live_blog_entries.post_id
        AND p.status = 'published'::post_status
        AND p.deleted_at IS NULL
        AND p.tenant_id = public.public_tenant_id()
        AND live_blog_entries.tenant_id = p.tenant_id
    )
  );

CREATE POLICY "Staff can insert live blog entries"
  ON public.live_blog_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.is_staff()
  );

CREATE POLICY "Staff can update live blog entries"
  ON public.live_blog_entries
  FOR UPDATE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND public.is_staff()
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.is_staff()
  );

CREATE POLICY "Staff can delete live blog entries"
  ON public.live_blog_entries
  FOR DELETE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND public.is_staff()
  );

-- 5) podcasts: restrict tenant-wide read to staff (public read policy already exists for published)
DROP POLICY IF EXISTS "podcasts_tenant_read_own" ON public.podcasts;
CREATE POLICY "podcasts_staff_read_all"
  ON public.podcasts
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND public.is_staff()
  );

-- 6) web_stories: restrict tenant-wide read to staff
DROP POLICY IF EXISTS "web_stories tenant read all" ON public.web_stories;
CREATE POLICY "web_stories staff read all"
  ON public.web_stories
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND public.is_staff()
  );

-- 7) profiles PII: revoke sensitive columns from anon and authenticated,
-- restrict tenant-wide read policy to staff. Own row remains fully readable
-- via public.get_own_profile() (SECURITY DEFINER).
REVOKE SELECT (phone, contact_email, location, first_name, last_name, gender)
  ON public.profiles FROM anon;
REVOKE SELECT (phone, contact_email, location, first_name, last_name, gender)
  ON public.profiles FROM authenticated;

DROP POLICY IF EXISTS "Profiles authenticated read" ON public.profiles;
CREATE POLICY "Profiles authenticated read"
  ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR (tenant_id = public.current_tenant_id() AND public.is_staff())
  );
