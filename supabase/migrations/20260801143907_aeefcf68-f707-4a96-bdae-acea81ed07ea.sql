REVOKE SELECT ON public.qa_questions FROM anon, authenticated;

GRANT SELECT (
  id, tenant_id, session_id, author_display, is_anonymous, body, status,
  answer_body, answered_by, answered_at, created_at, updated_at
) ON public.qa_questions TO anon, authenticated;

GRANT ALL ON public.qa_questions TO service_role;