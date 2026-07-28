-- 1) podcasts: explicit WITH CHECK tenant guard
DROP POLICY IF EXISTS "podcasts_tenant_update" ON public.podcasts;
CREATE POLICY "podcasts_tenant_update" ON public.podcasts
FOR UPDATE TO authenticated
USING (
  tenant_id = current_tenant_id()
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'editor'::app_role)
    OR (has_role(auth.uid(), 'author'::app_role) AND author_id = auth.uid())
  )
)
WITH CHECK (
  tenant_id = current_tenant_id()
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'editor'::app_role)
    OR (has_role(auth.uid(), 'author'::app_role) AND author_id = auth.uid())
  )
);

-- 2) staff write policies: restrict role scope to authenticated
DROP POLICY IF EXISTS "campaigns_staff_update" ON public.newsletter_campaigns;
CREATE POLICY "campaigns_staff_update" ON public.newsletter_campaigns
FOR UPDATE TO authenticated
USING (tenant_id = current_tenant_id() AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role)))
WITH CHECK (tenant_id = current_tenant_id() AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role)));

DROP POLICY IF EXISTS "newsletter_settings staff update" ON public.newsletter_settings;
CREATE POLICY "newsletter_settings staff update" ON public.newsletter_settings
FOR UPDATE TO authenticated
USING (tenant_id = current_tenant_id() AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role)))
WITH CHECK (tenant_id = current_tenant_id() AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role)));

DROP POLICY IF EXISTS "plans staff update" ON public.access_plans;
CREATE POLICY "plans staff update" ON public.access_plans
FOR UPDATE TO authenticated
USING (tenant_id = current_tenant_id() AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role)))
WITH CHECK (tenant_id = current_tenant_id() AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role)));

DROP POLICY IF EXISTS "pls staff update" ON public.post_layout_settings;
CREATE POLICY "pls staff update" ON public.post_layout_settings
FOR UPDATE TO authenticated
USING (tenant_id = current_tenant_id() AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role)))
WITH CHECK (tenant_id = current_tenant_id() AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role)));

DROP POLICY IF EXISTS "Admins manage archive layout settings" ON public.archive_layout_settings;
CREATE POLICY "Admins manage archive layout settings" ON public.archive_layout_settings
FOR ALL TO authenticated
USING (tenant_id = current_tenant_id() AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)))
WITH CHECK (tenant_id = current_tenant_id() AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));