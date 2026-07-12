-- ============================================================================
-- SPOŁECZNOŚĆ 6/10: sesje Q&A / AMA z ekspertami.
--
-- Format "zadaj pytanie ekspertowi": sesja (host = ekspert, opcjonalnie
-- spięta z wydarzeniem lub wpisem), pytania z moderacją i głosami społeczności.
--
--   * qa_questions.user_id NIE jest grantowane klientom (kolumnowe granty) -
--     pytania mogą być anonimowe w duchu Chatham House Rule; publiczny widok
--     zna tylko author_display (migawka nazwy przy zadaniu pytania, pusta dla
--     anonimowych). "Moje pytania" rozstrzyga RPC get_my_qa_question_ids.
--   * ask_qa_question: rate limit 5 pytań/h per użytkownik per sesja (w DB),
--     tylko sesje 'open'; host dostaje powiadomienie.
--   * Głosy: 1 per użytkownik per pytanie, tylko na zaakceptowane pytania;
--     licznik przez agregat PostgREST (qa_question_votes(count)).
--   * Odpowiedź (staff lub host) -> trigger powiadamia autora pytania.
--
-- Wszystko idempotentne.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.qa_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  title_pl text NOT NULL,
  title_en text NOT NULL,
  intro_pl text,
  intro_en text,
  host_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  post_id uuid REFERENCES public.posts(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'open', 'answering', 'closed')),
  opens_at timestamptz,
  closes_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug),
  CHECK (slug ~ '^[a-z0-9-]{3,120}$'),
  CHECK (btrim(title_pl) <> '' AND btrim(title_en) <> '')
);

CREATE INDEX IF NOT EXISTS idx_qa_sessions_tenant_status
  ON public.qa_sessions (tenant_id, status, created_at DESC);

DROP TRIGGER IF EXISTS qa_sessions_set_updated_at ON public.qa_sessions;
CREATE TRIGGER qa_sessions_set_updated_at
  BEFORE UPDATE ON public.qa_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON public.qa_sessions TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.qa_sessions TO authenticated;
GRANT ALL ON public.qa_sessions TO service_role;
ALTER TABLE public.qa_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "qa sessions public read" ON public.qa_sessions;
CREATE POLICY "qa sessions public read" ON public.qa_sessions
  FOR SELECT TO anon, authenticated
  USING (
    status <> 'draft'
    AND tenant_id = (SELECT public.public_tenant_id())
  );

DROP POLICY IF EXISTS "qa sessions staff all" ON public.qa_sessions;
CREATE POLICY "qa sessions staff all" ON public.qa_sessions
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

-- Host widzi też swoje sesje robocze i może zmieniać status/odpowiedzi.
DROP POLICY IF EXISTS "qa sessions host read" ON public.qa_sessions;
CREATE POLICY "qa sessions host read" ON public.qa_sessions
  FOR SELECT TO authenticated
  USING (host_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "qa sessions host update" ON public.qa_sessions;
CREATE POLICY "qa sessions host update" ON public.qa_sessions
  FOR UPDATE TO authenticated
  USING (host_user_id = (SELECT auth.uid()))
  WITH CHECK (host_user_id = (SELECT auth.uid()));

-- ----------------------------------------------------------------------------
-- Pytania (user_id niedostępny dla klientów - granty kolumnowe)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.qa_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.qa_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_display text,
  is_anonymous boolean NOT NULL DEFAULT false,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 5 AND 2000),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'answered')),
  answer_body text,
  answered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  answered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qa_questions_session
  ON public.qa_questions (session_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qa_questions_user
  ON public.qa_questions (user_id, created_at DESC);

DROP TRIGGER IF EXISTS qa_questions_set_updated_at ON public.qa_questions;
CREATE TRIGGER qa_questions_set_updated_at
  BEFORE UPDATE ON public.qa_questions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT (
  id, tenant_id, session_id, author_display, is_anonymous, body, status,
  answer_body, answered_by, answered_at, created_at, updated_at
) ON public.qa_questions TO anon, authenticated;
GRANT UPDATE ON public.qa_questions TO authenticated;
GRANT ALL ON public.qa_questions TO service_role;
ALTER TABLE public.qa_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "qa questions public read" ON public.qa_questions;
CREATE POLICY "qa questions public read" ON public.qa_questions
  FOR SELECT TO anon, authenticated
  USING (
    status IN ('approved', 'answered')
    AND tenant_id = (SELECT public.public_tenant_id())
  );

DROP POLICY IF EXISTS "qa questions staff read" ON public.qa_questions;
CREATE POLICY "qa questions staff read" ON public.qa_questions
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

DROP POLICY IF EXISTS "qa questions host read" ON public.qa_questions;
CREATE POLICY "qa questions host read" ON public.qa_questions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.qa_sessions s
       WHERE s.id = session_id AND s.host_user_id = (SELECT auth.uid())
    )
  );

-- Moderacja/odpowiedzi: staff tenantu lub host sesji.
DROP POLICY IF EXISTS "qa questions moderate" ON public.qa_questions;
CREATE POLICY "qa questions moderate" ON public.qa_questions
  FOR UPDATE TO authenticated
  USING (
    (
      tenant_id = (SELECT public.current_tenant_id())
      AND (
        public.has_role((SELECT auth.uid()), 'admin'::app_role)
        OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.qa_sessions s
       WHERE s.id = session_id AND s.host_user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    (
      tenant_id = (SELECT public.current_tenant_id())
      AND (
        public.has_role((SELECT auth.uid()), 'admin'::app_role)
        OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.qa_sessions s
       WHERE s.id = session_id AND s.host_user_id = (SELECT auth.uid())
    )
  );

-- ----------------------------------------------------------------------------
-- Zadawanie pytań wyłącznie przez RPC (walidacja + rate limit + migawka autora)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ask_qa_question(
  p_session_id uuid,
  p_body text,
  p_anonymous boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_session public.qa_sessions%ROWTYPE;
  v_recent integer;
  v_display text;
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'qa: authentication required';
  END IF;

  SELECT * INTO v_session
    FROM public.qa_sessions
   WHERE id = p_session_id AND tenant_id = public.public_tenant_id();
  IF NOT FOUND OR v_session.status <> 'open' THEN
    RAISE EXCEPTION 'qa: session closed';
  END IF;

  SELECT count(*) INTO v_recent
    FROM public.qa_questions
   WHERE session_id = p_session_id
     AND user_id = v_user
     AND created_at > now() - interval '1 hour';
  IF v_recent >= 5 THEN
    RAISE EXCEPTION 'qa: rate limited';
  END IF;

  IF NOT p_anonymous THEN
    SELECT COALESCE(NULLIF(btrim(display_name), ''), split_part(email, '@', 1))
      INTO v_display
      FROM public.profiles WHERE id = v_user;
  END IF;

  INSERT INTO public.qa_questions
    (tenant_id, session_id, user_id, author_display, is_anonymous, body)
  VALUES
    (v_session.tenant_id, p_session_id, v_user, v_display, p_anonymous, btrim(p_body))
  RETURNING id INTO v_id;

  PERFORM public.enqueue_notification(
    v_session.host_user_id,
    'system',
    'Nowe pytanie w sesji: ' || v_session.title_pl,
    'New question in session: ' || v_session.title_en,
    left(btrim(p_body), 140),
    left(btrim(p_body), 140),
    '/qa/' || v_session.slug,
    'MessageCircleQuestion'
  );

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ask_qa_question(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ask_qa_question(uuid, text, boolean) TO authenticated, service_role;

-- "Moje pytania" bez ujawniania user_id w tabeli.
CREATE OR REPLACE FUNCTION public.get_my_qa_question_ids(p_session_id uuid)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(id), '{}'::uuid[])
    FROM public.qa_questions
   WHERE session_id = p_session_id AND user_id = auth.uid();
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_qa_question_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_qa_question_ids(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Głosy na pytania
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.qa_question_votes (
  question_id uuid NOT NULL REFERENCES public.qa_questions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (question_id, user_id)
);

GRANT SELECT, INSERT, DELETE ON public.qa_question_votes TO authenticated;
GRANT SELECT ON public.qa_question_votes TO anon;
GRANT ALL ON public.qa_question_votes TO service_role;
ALTER TABLE public.qa_question_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "qa votes public read" ON public.qa_question_votes;
CREATE POLICY "qa votes public read" ON public.qa_question_votes
  FOR SELECT TO anon, authenticated
  USING (tenant_id = (SELECT public.public_tenant_id()));

DROP POLICY IF EXISTS "qa votes own insert" ON public.qa_question_votes;
CREATE POLICY "qa votes own insert" ON public.qa_question_votes
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.qa_questions q
       WHERE q.id = qa_question_votes.question_id
         AND q.status IN ('approved', 'answered')
         AND q.tenant_id = qa_question_votes.tenant_id
    )
  );

DROP POLICY IF EXISTS "qa votes own delete" ON public.qa_question_votes;
CREATE POLICY "qa votes own delete" ON public.qa_question_votes
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ----------------------------------------------------------------------------
-- Odpowiedź -> powiadomienie autora pytania
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_qa_question_answered()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug text;
  v_title_pl text;
  v_title_en text;
BEGIN
  IF NEW.status = 'answered' AND OLD.status <> 'answered' THEN
    IF NEW.answered_at IS NULL THEN
      NEW.answered_at := now();
    END IF;
    IF NEW.answered_by IS NULL THEN
      NEW.answered_by := auth.uid();
    END IF;

    SELECT slug, title_pl, title_en INTO v_slug, v_title_pl, v_title_en
      FROM public.qa_sessions WHERE id = NEW.session_id;

    PERFORM public.enqueue_notification(
      NEW.user_id,
      'content',
      'Ekspert odpowiedział na Twoje pytanie',
      'The expert answered your question',
      v_title_pl,
      v_title_en,
      '/qa/' || v_slug,
      'MessageCircleReply'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS qa_question_answered ON public.qa_questions;
CREATE TRIGGER qa_question_answered
  BEFORE UPDATE ON public.qa_questions
  FOR EACH ROW EXECUTE FUNCTION public.tg_qa_question_answered();
