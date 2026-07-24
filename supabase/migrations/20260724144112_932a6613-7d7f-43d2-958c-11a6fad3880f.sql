-- 1) author_profiles: remove direct anon/authenticated public SELECT on base table.
--    App reads public data via public.author_profiles_public (curated view).
DROP POLICY IF EXISTS "Public can view public author profiles" ON public.author_profiles;

-- 2) personality_results: drop broad public policy; expose only summary via curated view.
DROP POLICY IF EXISTS "public read personality" ON public.personality_results;

DROP VIEW IF EXISTS public.personality_results_public;
CREATE VIEW public.personality_results_public
WITH (security_invoker = off, security_barrier = true)
AS
SELECT
  pr.user_id,
  pr.openness,
  pr.conscientiousness,
  pr.extraversion,
  pr.agreeableness,
  pr.neuroticism,
  pr.taken_at
FROM public.personality_results pr
WHERE public.profile_is_public(pr.user_id);

GRANT SELECT ON public.personality_results_public TO anon, authenticated;

-- 3) profile_cv_files: require authentication for public CV downloads (no anon).
DROP POLICY IF EXISTS "public read current cv" ON public.profile_cv_files;
CREATE POLICY "public read current cv"
  ON public.profile_cv_files
  FOR SELECT
  TO authenticated
  USING (is_current AND public.profile_is_public(user_id));

-- 4) b2b_coupon_redemptions: use current_tenant_id() for owner-scoped reads.
DROP POLICY IF EXISTS "b2b_coupon_redemptions_own_select" ON public.b2b_coupon_redemptions;
CREATE POLICY "b2b_coupon_redemptions_own_select"
  ON public.b2b_coupon_redemptions
  FOR SELECT
  TO authenticated
  USING (tenant_id = current_tenant_id() AND user_id = auth.uid());

-- 5) profile_skill_endorsements: scope reads to public profiles or participants.
DROP POLICY IF EXISTS "endorse_read" ON public.profile_skill_endorsements;
CREATE POLICY "endorse_read"
  ON public.profile_skill_endorsements
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (
      recipient_id = auth.uid()
      OR endorser_id = auth.uid()
      OR public.profile_is_public(recipient_id)
    )
  );