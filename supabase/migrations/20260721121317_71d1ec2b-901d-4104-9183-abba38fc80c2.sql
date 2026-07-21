
-- 1) content_access: hide password hash/hints from anon (public view already excludes them)
REVOKE SELECT (password_hash, password_hint_pl, password_hint_en) ON public.content_access FROM anon;

-- 2) B2B coupon staff policies must scope by caller's own tenant, not host-derived public tenant
DROP POLICY IF EXISTS "b2b_coupon_campaigns_staff_all" ON public.b2b_coupon_campaigns;
CREATE POLICY "b2b_coupon_campaigns_staff_all" ON public.b2b_coupon_campaigns
  FOR ALL TO authenticated
  USING ((tenant_id = current_tenant_id()) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role)))
  WITH CHECK ((tenant_id = current_tenant_id()) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role)));

DROP POLICY IF EXISTS "b2b_coupons_staff_all" ON public.b2b_coupons;
CREATE POLICY "b2b_coupons_staff_all" ON public.b2b_coupons
  FOR ALL TO authenticated
  USING ((tenant_id = current_tenant_id()) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role)))
  WITH CHECK ((tenant_id = current_tenant_id()) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role)));

DROP POLICY IF EXISTS "b2b_coupon_redemptions_staff_select" ON public.b2b_coupon_redemptions;
CREATE POLICY "b2b_coupon_redemptions_staff_select" ON public.b2b_coupon_redemptions
  FOR SELECT TO authenticated
  USING ((tenant_id = current_tenant_id()) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role)));

DROP POLICY IF EXISTS "metering_event_log_staff_select" ON public.metering_event_log;
CREATE POLICY "metering_event_log_staff_select" ON public.metering_event_log
  FOR SELECT TO authenticated
  USING ((tenant_id = current_tenant_id()) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role)));

-- 3) job_runner_settings: hide plaintext secret from any client role; only service_role reads it
REVOKE SELECT (secret) ON public.job_runner_settings FROM authenticated;
REVOKE SELECT (secret) ON public.job_runner_settings FROM anon;
