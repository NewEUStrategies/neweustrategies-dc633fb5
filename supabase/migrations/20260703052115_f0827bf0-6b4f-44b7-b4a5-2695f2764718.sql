
DROP POLICY IF EXISTS "plans public read" ON public.access_plans;
CREATE POLICY "plans public read" ON public.access_plans
  FOR SELECT
  USING (
    (active = true AND tenant_id = public.public_tenant_id())
    OR (
      tenant_id = public.current_tenant_id()
      AND (public.has_role(auth.uid(), 'admin'::app_role)
        OR public.has_role(auth.uid(), 'editor'::app_role))
    )
  );

DROP POLICY IF EXISTS "Public can read active ad_placements" ON public.ad_placements;
CREATE POLICY "Public can read active ad_placements" ON public.ad_placements
  FOR SELECT
  USING (
    tenant_id = public.public_tenant_id()
    AND active = true
    AND (starts_at IS NULL OR starts_at <= now())
    AND (ends_at IS NULL OR ends_at > now())
  );

DROP POLICY IF EXISTS "Public can read active ad_slots" ON public.ad_slots;
CREATE POLICY "Public can read active ad_slots" ON public.ad_slots
  FOR SELECT
  USING (
    tenant_id = public.public_tenant_id()
    AND status = 'active'::ad_slot_status
  );

DROP POLICY IF EXISTS "global widgets public read" ON public.builder_global_widgets;
CREATE POLICY "global widgets public read" ON public.builder_global_widgets
  FOR SELECT
  USING (tenant_id = public.public_tenant_id());

DROP POLICY IF EXISTS "popups public read active" ON public.builder_popups;
CREATE POLICY "popups public read active" ON public.builder_popups
  FOR SELECT
  USING (
    tenant_id = public.public_tenant_id()
    AND status = 'active'::builder_popup_status
  );

DROP POLICY IF EXISTS "content_access public read" ON public.content_access;
CREATE POLICY "content_access public read" ON public.content_access
  FOR SELECT
  USING (tenant_id = public.public_tenant_id());

DROP POLICY IF EXISTS "Public can read crop sizes" ON public.custom_crop_sizes;
CREATE POLICY "Public can read crop sizes" ON public.custom_crop_sizes
  FOR SELECT
  USING (tenant_id = public.public_tenant_id());

DROP POLICY IF EXISTS "Icon library is publicly readable" ON public.icon_library;
CREATE POLICY "Icon library is publicly readable" ON public.icon_library
  FOR SELECT
  USING (tenant_id = public.public_tenant_id());

DROP POLICY IF EXISTS "media public read" ON public.media;
CREATE POLICY "media public read" ON public.media
  FOR SELECT
  USING (tenant_id = public.public_tenant_id());

DROP POLICY IF EXISTS "newsletter_settings public read" ON public.newsletter_settings;
CREATE POLICY "newsletter_settings public read" ON public.newsletter_settings
  FOR SELECT
  USING (tenant_id = public.public_tenant_id());

DROP POLICY IF EXISTS "newsletter public subscribe" ON public.newsletter_subscribers;
CREATE POLICY "newsletter public subscribe" ON public.newsletter_subscribers
  FOR INSERT
  WITH CHECK (
    tenant_id = public.public_tenant_id()
    AND email IS NOT NULL
  );

DROP POLICY IF EXISTS "podcast_settings_public_read" ON public.podcast_settings;
CREATE POLICY "podcast_settings_public_read" ON public.podcast_settings
  FOR SELECT
  USING (tenant_id = public.public_tenant_id());

DROP POLICY IF EXISTS "podcasts_public_read" ON public.podcasts;
CREATE POLICY "podcasts_public_read" ON public.podcasts
  FOR SELECT
  USING (
    tenant_id = public.public_tenant_id()
    AND status = 'published'
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS "post_categories public read" ON public.post_categories;
CREATE POLICY "post_categories public read" ON public.post_categories
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.id = post_categories.post_id
        AND p.tenant_id = public.public_tenant_id()
        AND p.status = 'published'
        AND p.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Custom meta defs are publicly readable" ON public.post_custom_meta_defs;
CREATE POLICY "Custom meta defs are publicly readable" ON public.post_custom_meta_defs
  FOR SELECT
  USING (tenant_id = public.public_tenant_id());

DROP POLICY IF EXISTS "pls public read" ON public.post_layout_settings;
CREATE POLICY "pls public read" ON public.post_layout_settings
  FOR SELECT
  USING (tenant_id = public.public_tenant_id());

DROP POLICY IF EXISTS "post_sidebar_layouts public read" ON public.post_sidebar_layouts;
CREATE POLICY "post_sidebar_layouts public read" ON public.post_sidebar_layouts
  FOR SELECT
  USING (tenant_id = public.public_tenant_id());

DROP POLICY IF EXISTS "post_tags public read" ON public.post_tags;
CREATE POLICY "post_tags public read" ON public.post_tags
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.id = post_tags.post_id
        AND p.tenant_id = public.public_tenant_id()
        AND p.status = 'published'
        AND p.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Related posts config is publicly readable" ON public.related_posts_config;
CREATE POLICY "Related posts config is publicly readable" ON public.related_posts_config
  FOR SELECT
  USING (tenant_id = public.public_tenant_id());

DROP POLICY IF EXISTS "design_tokens public read" ON public.site_design_tokens;
CREATE POLICY "design_tokens public read" ON public.site_design_tokens
  FOR SELECT
  USING (tenant_id = public.public_tenant_id());

DROP POLICY IF EXISTS "web_stories public read published" ON public.web_stories;
CREATE POLICY "web_stories public read published" ON public.web_stories
  FOR SELECT
  USING (
    tenant_id = public.public_tenant_id()
    AND status = 'published'
  );

DROP POLICY IF EXISTS "experiment events public insert" ON public.builder_experiment_events;
CREATE POLICY "experiment events public insert" ON public.builder_experiment_events
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.builder_experiments e
      WHERE e.id = builder_experiment_events.experiment_id
        AND e.tenant_id = public.public_tenant_id()
    )
  );

ALTER FUNCTION public.nes_jsonb_text(jsonb) SET search_path = public, pg_temp;
ALTER FUNCTION public.web_vitals_daily_p75(timestamp with time zone) SET search_path = public, pg_temp;
