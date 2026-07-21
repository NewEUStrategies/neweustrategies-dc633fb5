
-- 1) content_access_public: flip to security_invoker, tighten anon column grants + policy
ALTER VIEW public.content_access_public SET (security_invoker = on);

DROP POLICY IF EXISTS "content_access public read" ON public.content_access;
CREATE POLICY "content_access public read" ON public.content_access
  FOR SELECT TO anon
  USING (tenant_id = public_tenant_id());

REVOKE SELECT ON public.content_access FROM anon;
GRANT SELECT (
  id, tenant_id, entity_type, entity_id, mode, plan_ids,
  one_time_price_cents, one_time_currency, teaser_pl, teaser_en,
  created_at, updated_at, metering_policy
) ON public.content_access TO anon;

-- 2) author_profiles: enforce tenant_id in owner insert/update policies
DROP POLICY IF EXISTS "Owners can insert own author profile" ON public.author_profiles;
CREATE POLICY "Owners can insert own author profile" ON public.author_profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "Owners can update own author profile" ON public.author_profiles;
CREATE POLICY "Owners can update own author profile" ON public.author_profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND tenant_id = current_tenant_id())
  WITH CHECK (auth.uid() = user_id AND tenant_id = current_tenant_id());

-- 3) profiles: prevent self-assignment of arbitrary tenant_id at policy level.
--    (Triggers already pin tenant_id; add defense-in-depth WITH CHECK.)
DROP POLICY IF EXISTS "Users insert own profile" ON public.profiles;
CREATE POLICY "Users insert own profile" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = id
    AND tenant_id IS NOT NULL
    AND (current_tenant_id() IS NULL OR tenant_id = current_tenant_id())
  );

DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id AND tenant_id = current_tenant_id());

-- 4) Defense-in-depth tenant filters on owner self-scoped policies
DROP POLICY IF EXISTS user_blocks_owner_select ON public.user_blocks;
CREATE POLICY user_blocks_owner_select ON public.user_blocks
  FOR SELECT TO authenticated
  USING (blocker_id = auth.uid() AND tenant_id = current_tenant_id());

DROP POLICY IF EXISTS user_blocks_owner_delete ON public.user_blocks;
CREATE POLICY user_blocks_owner_delete ON public.user_blocks
  FOR DELETE TO authenticated
  USING (blocker_id = auth.uid() AND tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "qa questions own read pending" ON public.qa_questions;
CREATE POLICY "qa questions own read pending" ON public.qa_questions
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND tenant_id = current_tenant_id());
