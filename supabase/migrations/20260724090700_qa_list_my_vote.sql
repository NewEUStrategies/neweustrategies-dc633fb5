-- ============================================================================
-- FIX (P1 UX/parytet): list_qa_questions zwraca teraz `my_vote` (czy biezacy
-- uzytkownik juz zaglosowal na dane pytanie) - parytet z ankietami (PollCard
-- ma `my_vote`). Bez tego przycisk glosu w Q&A nie mial stanu „zaglosowano"
-- (brak aria-pressed), a ponowny klik byl cicho ignorowany (duplikat PK), wiec
-- uzytkownik nie wiedzial, czy jego glos sie zaliczyl.
--
-- Zmiana sygnatury (nowa kolumna zwracana) wymaga DROP + CREATE.
-- ============================================================================

DROP FUNCTION IF EXISTS public.list_qa_questions(uuid);

CREATE FUNCTION public.list_qa_questions(p_session_id uuid)
RETURNS TABLE (
  id uuid,
  session_id uuid,
  author_display text,
  is_anonymous boolean,
  body text,
  status text,
  answer_body text,
  answered_at timestamptz,
  created_at timestamptz,
  votes bigint,
  is_priority boolean,
  my_vote boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    q.id,
    q.session_id,
    q.author_display,
    q.is_anonymous,
    q.body,
    q.status,
    q.answer_body,
    q.answered_at,
    q.created_at,
    COALESCE(v.votes, 0) AS votes,
    public.user_has_tier_feature(q.user_id, 'qa_priority') AS is_priority,
    -- auth.uid() = biezacy wolajacy (SECURITY DEFINER nie zmienia auth.uid());
    -- dla anonima NULL -> EXISTS = false.
    EXISTS (
      SELECT 1 FROM public.qa_question_votes qv
       WHERE qv.question_id = q.id AND qv.user_id = auth.uid()
    ) AS my_vote
  FROM public.qa_questions q
  LEFT JOIN LATERAL (
    SELECT count(*) AS votes
      FROM public.qa_question_votes qv
     WHERE qv.question_id = q.id
  ) v ON true
  WHERE q.session_id = p_session_id
    AND q.tenant_id = public.public_tenant_id()
    AND q.status IN ('approved', 'answered')
  ORDER BY
    public.user_has_tier_feature(q.user_id, 'qa_priority') DESC,
    COALESCE(v.votes, 0) DESC,
    q.created_at ASC
  LIMIT 500;
$$;

REVOKE EXECUTE ON FUNCTION public.list_qa_questions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_qa_questions(uuid) TO anon, authenticated, service_role;
