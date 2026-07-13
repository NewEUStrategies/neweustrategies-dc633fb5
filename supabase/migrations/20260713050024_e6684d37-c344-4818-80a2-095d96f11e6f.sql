
-- event_rsvps: user manages own
CREATE POLICY "rsvps own insert" ON public.event_rsvps FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND tenant_id = (SELECT public_tenant_id()));
CREATE POLICY "rsvps own update" ON public.event_rsvps FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "rsvps own delete" ON public.event_rsvps FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- poll_votes: user manages own vote
CREATE POLICY "poll votes own insert" ON public.poll_votes FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND tenant_id = (SELECT public_tenant_id()));
CREATE POLICY "poll votes own update" ON public.poll_votes FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "poll votes own delete" ON public.poll_votes FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- qa_questions: user submits pending questions
CREATE POLICY "qa questions own insert" ON public.qa_questions FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public_tenant_id())
    AND status = 'pending'
  );
CREATE POLICY "qa questions own read pending" ON public.qa_questions FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- qa_question_votes: user manages own
CREATE POLICY "qa votes own insert plus" ON public.qa_question_votes FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND tenant_id = (SELECT public_tenant_id()));
