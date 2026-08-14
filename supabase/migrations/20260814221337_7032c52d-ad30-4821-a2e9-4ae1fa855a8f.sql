-- 1. billing_profiles
DROP POLICY IF EXISTS "billing owner delete" ON public.billing_profiles;
CREATE POLICY "billing owner delete" ON public.billing_profiles
  FOR DELETE TO authenticated
  USING (user_id = (select auth.uid()) AND tenant_id = (select public.current_tenant_id()));

DROP POLICY IF EXISTS "billing owner read" ON public.billing_profiles;
CREATE POLICY "billing owner read" ON public.billing_profiles
  FOR SELECT TO authenticated
  USING (
    (user_id = (select auth.uid()) AND tenant_id = (select public.current_tenant_id()))
    OR (tenant_id = (select public.current_tenant_id()) AND public.has_role((select auth.uid()), 'admin'::public.app_role))
  );

-- 2. eu_policy_follows: USING wiązane tak samo jak WITH CHECK (tenant dossier)
DROP POLICY IF EXISTS "policy follows owner all" ON public.eu_policy_follows;
CREATE POLICY "policy follows owner all" ON public.eu_policy_follows
  FOR ALL TO authenticated
  USING (
    user_id = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.eu_policy_items i
      WHERE i.id = eu_policy_follows.item_id
        AND i.tenant_id = eu_policy_follows.tenant_id
    )
  )
  WITH CHECK (
    user_id = (select auth.uid())
    AND public.has_tier_feature('regulatory_monitoring'::text)
    AND EXISTS (
      SELECT 1 FROM public.eu_policy_items i
      WHERE i.id = eu_policy_follows.item_id
        AND i.status = 'published'::text
        AND i.tenant_id = eu_policy_follows.tenant_id
    )
  );

-- 3. message_stars
DROP POLICY IF EXISTS "message_stars_own_delete" ON public.message_stars;
CREATE POLICY "message_stars_own_delete" ON public.message_stars
  FOR DELETE TO authenticated
  USING (
    user_id = (select auth.uid())
    AND tenant_id = (select public.current_tenant_id())
  );

-- 4. notification_preferences: tenant domowy z profilu (spójnie z INSERT/UPDATE WITH CHECK)
DROP POLICY IF EXISTS "own prefs select" ON public.notification_preferences;
CREATE POLICY "own prefs select" ON public.notification_preferences
  FOR SELECT TO authenticated
  USING (
    user_id = (select auth.uid())
    AND tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = (select auth.uid()))
  );

DROP POLICY IF EXISTS "own prefs update" ON public.notification_preferences;
CREATE POLICY "own prefs update" ON public.notification_preferences
  FOR UPDATE TO authenticated
  USING (
    user_id = (select auth.uid())
    AND tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = (select auth.uid()))
  )
  WITH CHECK (
    user_id = (select auth.uid())
    AND tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = (select auth.uid()))
  );

DROP POLICY IF EXISTS "own prefs delete" ON public.notification_preferences;
CREATE POLICY "own prefs delete" ON public.notification_preferences
  FOR DELETE TO authenticated
  USING (
    user_id = (select auth.uid())
    AND tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = (select auth.uid()))
  );

-- 5. payment_orders
DROP POLICY IF EXISTS "orders owner read" ON public.payment_orders;
CREATE POLICY "orders owner read" ON public.payment_orders
  FOR SELECT TO authenticated
  USING (
    (user_id = (select auth.uid()) AND tenant_id = (select public.current_tenant_id()))
    OR (tenant_id = (select public.current_tenant_id()) AND public.has_role((select auth.uid()), 'admin'::public.app_role))
  );

-- 6. qa_question_votes: tenant głosu = tenant pytania (jak w INSERT)
DROP POLICY IF EXISTS "qa votes own read" ON public.qa_question_votes;
CREATE POLICY "qa votes own read" ON public.qa_question_votes
  FOR SELECT TO authenticated
  USING (
    user_id = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.qa_questions q
      WHERE q.id = qa_question_votes.question_id
        AND q.tenant_id = qa_question_votes.tenant_id
    )
  );

DROP POLICY IF EXISTS "qa votes own delete" ON public.qa_question_votes;
CREATE POLICY "qa votes own delete" ON public.qa_question_votes
  FOR DELETE TO authenticated
  USING (
    user_id = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.qa_questions q
      WHERE q.id = qa_question_votes.question_id
        AND q.tenant_id = qa_question_votes.tenant_id
    )
  );

-- 7. qa_questions: gałąź hosta wiąże tenanta pytania z tenantem sesji
DROP POLICY IF EXISTS "qa questions host read" ON public.qa_questions;
CREATE POLICY "qa questions host read" ON public.qa_questions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.qa_sessions s
      WHERE s.id = qa_questions.session_id
        AND s.host_user_id = (select auth.uid())
        AND s.tenant_id = qa_questions.tenant_id
    )
  );

DROP POLICY IF EXISTS "qa questions moderate" ON public.qa_questions;
CREATE POLICY "qa questions moderate" ON public.qa_questions
  FOR UPDATE TO authenticated
  USING (
    (
      tenant_id = (select public.current_tenant_id())
      AND (
        public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_role((select auth.uid()), 'editor'::public.app_role)
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.qa_sessions s
      WHERE s.id = qa_questions.session_id
        AND s.host_user_id = (select auth.uid())
        AND s.tenant_id = qa_questions.tenant_id
    )
  )
  WITH CHECK (
    (
      tenant_id = (select public.current_tenant_id())
      AND (
        public.has_role((select auth.uid()), 'admin'::public.app_role)
        OR public.has_role((select auth.uid()), 'editor'::public.app_role)
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.qa_sessions s
      WHERE s.id = qa_questions.session_id
        AND s.host_user_id = (select auth.uid())
        AND s.tenant_id = qa_questions.tenant_id
    )
  );