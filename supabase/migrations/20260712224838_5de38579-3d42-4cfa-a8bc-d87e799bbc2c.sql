-- ============================================================================
-- SPOŁECZNOŚĆ 2/10: profile_badges
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.profile_badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  badge text NOT NULL CHECK (badge IN ('verified', 'expert', 'contributor', 'staff')),
  note text,
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, badge)
);

CREATE INDEX IF NOT EXISTS idx_profile_badges_user ON public.profile_badges (tenant_id, user_id);

GRANT SELECT ON public.profile_badges TO anon, authenticated;
GRANT INSERT, DELETE ON public.profile_badges TO authenticated;
GRANT ALL ON public.profile_badges TO service_role;
ALTER TABLE public.profile_badges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "badges public read" ON public.profile_badges;
CREATE POLICY "badges public read" ON public.profile_badges
  FOR SELECT TO anon, authenticated
  USING (tenant_id = (SELECT public.public_tenant_id()));

DROP POLICY IF EXISTS "badges admin insert" ON public.profile_badges;
CREATE POLICY "badges admin insert" ON public.profile_badges
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id())
    AND public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "badges admin delete" ON public.profile_badges;
CREATE POLICY "badges admin delete" ON public.profile_badges
  FOR DELETE TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id())
    AND public.has_role((SELECT auth.uid()), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.tg_profile_badges_granted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_label_pl text; v_label_en text;
BEGIN
  IF NEW.granted_by IS NULL THEN NEW.granted_by := auth.uid(); END IF;
  v_label_pl := CASE NEW.badge
    WHEN 'verified' THEN 'Zweryfikowany profil'
    WHEN 'expert' THEN 'Ekspert'
    WHEN 'contributor' THEN 'Autor gościnny'
    WHEN 'staff' THEN 'Zespół redakcji' END;
  v_label_en := CASE NEW.badge
    WHEN 'verified' THEN 'Verified profile'
    WHEN 'expert' THEN 'Expert'
    WHEN 'contributor' THEN 'Guest contributor'
    WHEN 'staff' THEN 'Editorial staff' END;
  PERFORM public.enqueue_notification(NEW.user_id, 'system',
    'Otrzymujesz odznakę: ' || v_label_pl,
    'You received a badge: ' || v_label_en,
    'Odznaka jest widoczna przy Twoim profilu i w katalogu osób.',
    'The badge is visible on your profile and in the people directory.',
    '/profile', 'BadgeCheck');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profile_badges_granted ON public.profile_badges;
CREATE TRIGGER profile_badges_granted
  BEFORE INSERT ON public.profile_badges
  FOR EACH ROW EXECUTE FUNCTION public.tg_profile_badges_granted();

-- ============================================================================
-- SPOŁECZNOŚĆ 5/10: rozmowy grupowe
-- ============================================================================

ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_title_check;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_title_check
  CHECK (title IS NULL OR length(btrim(title)) BETWEEN 2 AND 80);

ALTER TABLE public.conversation_participants
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'member';
ALTER TABLE public.conversation_participants
  DROP CONSTRAINT IF EXISTS conversation_participants_role_check;
ALTER TABLE public.conversation_participants
  ADD CONSTRAINT conversation_participants_role_check
  CHECK (role IN ('owner', 'member'));

CREATE OR REPLACE FUNCTION public.filter_group_candidates(p_inviter uuid, p_candidates uuid[])
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(array_agg(c.id), '{}'::uuid[])
    FROM (
      SELECT DISTINCT p.id
        FROM unnest(p_candidates) AS cand(id)
        JOIN public.profiles p ON p.id = cand.id
        JOIN public.profiles inv ON inv.id = p_inviter
        LEFT JOIN public.notification_preferences np ON np.user_id = p.id
       WHERE p.id <> p_inviter
         AND p.tenant_id = inv.tenant_id
         AND NOT public.is_blocked_pair(p_inviter, p.id)
         AND COALESCE(np.allow_messages_from, 'everyone') <> 'nobody'
         AND (COALESCE(np.allow_messages_from, 'everyone') = 'everyone'
              OR EXISTS (SELECT 1 FROM public.conversation_participants a
                          JOIN public.conversation_participants b ON b.conversation_id = a.conversation_id
                         WHERE a.user_id = p_inviter AND b.user_id = p.id))
    ) c;
$$;

REVOKE EXECUTE ON FUNCTION public.filter_group_candidates(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.filter_group_candidates(uuid, uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.create_group_conversation(p_title text, p_member_ids uuid[])
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_title text := btrim(COALESCE(p_title, ''));
  v_members uuid[];
  v_conv uuid;
  v_m uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'chat: authentication required'; END IF;
  IF length(v_title) < 2 OR length(v_title) > 80 THEN RAISE EXCEPTION 'chat: invalid group title'; END IF;
  IF p_member_ids IS NULL OR array_length(p_member_ids, 1) IS NULL THEN RAISE EXCEPTION 'chat: members required'; END IF;
  IF array_length(p_member_ids, 1) > 49 THEN RAISE EXCEPTION 'chat: too many members'; END IF;
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_user;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'chat: profile missing'; END IF;
  v_members := public.filter_group_candidates(v_user, p_member_ids);
  IF array_length(v_members, 1) IS NULL THEN RAISE EXCEPTION 'chat: no eligible members'; END IF;
  INSERT INTO public.conversations (tenant_id, kind, created_by, title, last_message_at)
  VALUES (v_tenant, 'group', v_user, v_title, now()) RETURNING id INTO v_conv;
  INSERT INTO public.conversation_participants (conversation_id, user_id, tenant_id, role)
  VALUES (v_conv, v_user, v_tenant, 'owner');
  FOREACH v_m IN ARRAY v_members LOOP
    INSERT INTO public.conversation_participants (conversation_id, user_id, tenant_id, role)
    VALUES (v_conv, v_m, v_tenant, 'member')
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
    PERFORM public.enqueue_notification(v_m, 'message',
      'Dodano Cię do kręgu: ' || v_title,
      'You were added to the circle: ' || v_title,
      NULL, NULL, '/messages?c=' || v_conv::text, 'UsersRound');
  END LOOP;
  RETURN v_conv;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_group_conversation(text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_group_conversation(text, uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.add_group_members(p_conversation_id uuid, p_member_ids uuid[])
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_conv public.conversations%ROWTYPE;
  v_members uuid[]; v_m uuid; v_added integer := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'chat: authentication required'; END IF;
  SELECT * INTO v_conv FROM public.conversations WHERE id = p_conversation_id;
  IF NOT FOUND OR v_conv.kind <> 'group' THEN RAISE EXCEPTION 'chat: group not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.conversation_participants
                  WHERE conversation_id = p_conversation_id AND user_id = v_user AND role = 'owner') THEN
    RAISE EXCEPTION 'chat: owner required';
  END IF;
  v_members := public.filter_group_candidates(v_user, p_member_ids);
  FOREACH v_m IN ARRAY COALESCE(v_members, '{}'::uuid[]) LOOP
    INSERT INTO public.conversation_participants (conversation_id, user_id, tenant_id, role)
    VALUES (p_conversation_id, v_m, v_conv.tenant_id, 'member')
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
    IF FOUND THEN
      v_added := v_added + 1;
      PERFORM public.enqueue_notification(v_m, 'message',
        'Dodano Cię do kręgu: ' || COALESCE(v_conv.title, 'Krąg'),
        'You were added to the circle: ' || COALESCE(v_conv.title, 'Circle'),
        NULL, NULL, '/messages?c=' || p_conversation_id::text, 'UsersRound');
    END IF;
  END LOOP;
  RETURN v_added;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.add_group_members(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_group_members(uuid, uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.leave_group_conversation(p_conversation_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_user uuid := auth.uid(); v_kind text; v_was_owner boolean; v_next uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'chat: authentication required'; END IF;
  SELECT kind INTO v_kind FROM public.conversations WHERE id = p_conversation_id;
  IF NOT FOUND OR v_kind <> 'group' THEN RAISE EXCEPTION 'chat: group not found'; END IF;
  DELETE FROM public.conversation_participants
   WHERE conversation_id = p_conversation_id AND user_id = v_user
  RETURNING role = 'owner' INTO v_was_owner;
  IF v_was_owner IS NULL THEN RAISE EXCEPTION 'chat: not a participant'; END IF;
  SELECT user_id INTO v_next FROM public.conversation_participants
   WHERE conversation_id = p_conversation_id ORDER BY created_at ASC LIMIT 1;
  IF v_next IS NULL THEN
    DELETE FROM public.conversations WHERE id = p_conversation_id;
  ELSIF v_was_owner THEN
    UPDATE public.conversation_participants SET role = 'owner'
     WHERE conversation_id = p_conversation_id AND user_id = v_next;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.leave_group_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_group_conversation(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rename_group_conversation(p_conversation_id uuid, p_title text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_user uuid := auth.uid(); v_title text := btrim(COALESCE(p_title, ''));
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'chat: authentication required'; END IF;
  IF length(v_title) < 2 OR length(v_title) > 80 THEN RAISE EXCEPTION 'chat: invalid group title'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.conversation_participants
                  WHERE conversation_id = p_conversation_id AND user_id = v_user AND role = 'owner') THEN
    RAISE EXCEPTION 'chat: owner required';
  END IF;
  UPDATE public.conversations SET title = v_title
   WHERE id = p_conversation_id AND kind = 'group';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rename_group_conversation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rename_group_conversation(uuid, text) TO authenticated, service_role;

UPDATE public.conversation_participants cp SET role = 'owner'
  FROM public.conversations c
 WHERE c.id = cp.conversation_id AND c.kind = 'group'
   AND c.created_by = cp.user_id AND cp.role <> 'owner';

-- ============================================================================
-- SPOŁECZNOŚĆ 6/10: sesje Q&A
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
  USING (status <> 'draft' AND tenant_id = (SELECT public.public_tenant_id()));

DROP POLICY IF EXISTS "qa sessions staff all" ON public.qa_sessions;
CREATE POLICY "qa sessions staff all" ON public.qa_sessions
  FOR ALL TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id())
    AND (public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id())
    AND (public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)));

DROP POLICY IF EXISTS "qa sessions host read" ON public.qa_sessions;
CREATE POLICY "qa sessions host read" ON public.qa_sessions
  FOR SELECT TO authenticated USING (host_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "qa sessions host update" ON public.qa_sessions;
CREATE POLICY "qa sessions host update" ON public.qa_sessions
  FOR UPDATE TO authenticated
  USING (host_user_id = (SELECT auth.uid()))
  WITH CHECK (host_user_id = (SELECT auth.uid()));

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

CREATE INDEX IF NOT EXISTS idx_qa_questions_session ON public.qa_questions (session_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qa_questions_user ON public.qa_questions (user_id, created_at DESC);

DROP TRIGGER IF EXISTS qa_questions_set_updated_at ON public.qa_questions;
CREATE TRIGGER qa_questions_set_updated_at
  BEFORE UPDATE ON public.qa_questions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT (id, tenant_id, session_id, author_display, is_anonymous, body, status,
  answer_body, answered_by, answered_at, created_at, updated_at) ON public.qa_questions TO anon, authenticated;
GRANT UPDATE ON public.qa_questions TO authenticated;
GRANT ALL ON public.qa_questions TO service_role;
ALTER TABLE public.qa_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "qa questions public read" ON public.qa_questions;
CREATE POLICY "qa questions public read" ON public.qa_questions
  FOR SELECT TO anon, authenticated
  USING (status IN ('approved', 'answered') AND tenant_id = (SELECT public.public_tenant_id()));

DROP POLICY IF EXISTS "qa questions staff read" ON public.qa_questions;
CREATE POLICY "qa questions staff read" ON public.qa_questions
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id())
    AND (public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)));

DROP POLICY IF EXISTS "qa questions host read" ON public.qa_questions;
CREATE POLICY "qa questions host read" ON public.qa_questions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.qa_sessions s
                  WHERE s.id = session_id AND s.host_user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "qa questions moderate" ON public.qa_questions;
CREATE POLICY "qa questions moderate" ON public.qa_questions
  FOR UPDATE TO authenticated
  USING ((tenant_id = (SELECT public.current_tenant_id())
        AND (public.has_role((SELECT auth.uid()), 'admin'::app_role)
          OR public.has_role((SELECT auth.uid()), 'editor'::app_role)))
      OR EXISTS (SELECT 1 FROM public.qa_sessions s
                  WHERE s.id = session_id AND s.host_user_id = (SELECT auth.uid())))
  WITH CHECK ((tenant_id = (SELECT public.current_tenant_id())
        AND (public.has_role((SELECT auth.uid()), 'admin'::app_role)
          OR public.has_role((SELECT auth.uid()), 'editor'::app_role)))
      OR EXISTS (SELECT 1 FROM public.qa_sessions s
                  WHERE s.id = session_id AND s.host_user_id = (SELECT auth.uid())));

CREATE OR REPLACE FUNCTION public.ask_qa_question(p_session_id uuid, p_body text, p_anonymous boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_session public.qa_sessions%ROWTYPE;
  v_recent integer; v_display text; v_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'qa: authentication required'; END IF;
  SELECT * INTO v_session FROM public.qa_sessions
   WHERE id = p_session_id AND tenant_id = public.public_tenant_id();
  IF NOT FOUND OR v_session.status <> 'open' THEN RAISE EXCEPTION 'qa: session closed'; END IF;
  SELECT count(*) INTO v_recent FROM public.qa_questions
   WHERE session_id = p_session_id AND user_id = v_user AND created_at > now() - interval '1 hour';
  IF v_recent >= 5 THEN RAISE EXCEPTION 'qa: rate limited'; END IF;
  IF NOT p_anonymous THEN
    SELECT COALESCE(NULLIF(btrim(display_name), ''), split_part(email, '@', 1))
      INTO v_display FROM public.profiles WHERE id = v_user;
  END IF;
  INSERT INTO public.qa_questions (tenant_id, session_id, user_id, author_display, is_anonymous, body)
  VALUES (v_session.tenant_id, p_session_id, v_user, v_display, p_anonymous, btrim(p_body))
  RETURNING id INTO v_id;
  PERFORM public.enqueue_notification(v_session.host_user_id, 'system',
    'Nowe pytanie w sesji: ' || v_session.title_pl,
    'New question in session: ' || v_session.title_en,
    left(btrim(p_body), 140), left(btrim(p_body), 140),
    '/qa/' || v_session.slug, 'MessageCircleQuestion');
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ask_qa_question(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ask_qa_question(uuid, text, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_qa_question_ids(p_session_id uuid)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(array_agg(id), '{}'::uuid[])
    FROM public.qa_questions WHERE session_id = p_session_id AND user_id = auth.uid();
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_qa_question_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_qa_question_ids(uuid) TO authenticated, service_role;

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
  WITH CHECK (user_id = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.qa_questions q
                 WHERE q.id = qa_question_votes.question_id
                   AND q.status IN ('approved', 'answered')
                   AND q.tenant_id = qa_question_votes.tenant_id));

DROP POLICY IF EXISTS "qa votes own delete" ON public.qa_question_votes;
CREATE POLICY "qa votes own delete" ON public.qa_question_votes
  FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.tg_qa_question_answered()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_slug text; v_title_pl text; v_title_en text;
BEGIN
  IF NEW.status = 'answered' AND OLD.status <> 'answered' THEN
    IF NEW.answered_at IS NULL THEN NEW.answered_at := now(); END IF;
    IF NEW.answered_by IS NULL THEN NEW.answered_by := auth.uid(); END IF;
    SELECT slug, title_pl, title_en INTO v_slug, v_title_pl, v_title_en
      FROM public.qa_sessions WHERE id = NEW.session_id;
    PERFORM public.enqueue_notification(NEW.user_id, 'content',
      'Ekspert odpowiedział na Twoje pytanie',
      'The expert answered your question',
      v_title_pl, v_title_en,
      '/qa/' || v_slug, 'MessageCircleReply');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS qa_question_answered ON public.qa_questions;
CREATE TRIGGER qa_question_answered
  BEFORE UPDATE ON public.qa_questions
  FOR EACH ROW EXECUTE FUNCTION public.tg_qa_question_answered();

-- ============================================================================
-- SPOŁECZNOŚĆ 7/10: tracker legislacji UE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.eu_policy_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  title_pl text NOT NULL,
  title_en text NOT NULL,
  summary_pl text,
  summary_en text,
  policy_area text NOT NULL DEFAULT 'general'
    CHECK (policy_area IN ('general', 'energy', 'digital', 'security',
                           'enlargement', 'economy', 'cohesion', 'climate', 'trade', 'migration')),
  stage text NOT NULL DEFAULT 'proposal'
    CHECK (stage IN ('proposal', 'parliament', 'council', 'trilogue',
                     'adopted', 'in_force', 'rejected', 'withdrawn')),
  importance integer NOT NULL DEFAULT 2 CHECK (importance BETWEEN 1 AND 3),
  reference text,
  source_url text,
  next_milestone_pl text,
  next_milestone_en text,
  next_milestone_at date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug),
  CHECK (slug ~ '^[a-z0-9-]{3,120}$'),
  CHECK (btrim(title_pl) <> '' AND btrim(title_en) <> '')
);

CREATE INDEX IF NOT EXISTS idx_eu_policy_items_tenant
  ON public.eu_policy_items (tenant_id, status, policy_area, stage);

DROP TRIGGER IF EXISTS eu_policy_items_set_updated_at ON public.eu_policy_items;
CREATE TRIGGER eu_policy_items_set_updated_at
  BEFORE UPDATE ON public.eu_policy_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON public.eu_policy_items TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.eu_policy_items TO authenticated;
GRANT ALL ON public.eu_policy_items TO service_role;
ALTER TABLE public.eu_policy_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "policy items public read" ON public.eu_policy_items;
CREATE POLICY "policy items public read" ON public.eu_policy_items
  FOR SELECT TO anon, authenticated
  USING (status = 'published' AND tenant_id = (SELECT public.public_tenant_id()));

DROP POLICY IF EXISTS "policy items staff all" ON public.eu_policy_items;
CREATE POLICY "policy items staff all" ON public.eu_policy_items
  FOR ALL TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id())
    AND (public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id())
    AND (public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)));

CREATE TABLE IF NOT EXISTS public.eu_policy_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.eu_policy_items(id) ON DELETE CASCADE,
  note_pl text NOT NULL CHECK (length(btrim(note_pl)) BETWEEN 3 AND 2000),
  note_en text NOT NULL CHECK (length(btrim(note_en)) BETWEEN 3 AND 2000),
  stage_from text,
  stage_to text CHECK (stage_to IS NULL OR stage_to IN ('proposal', 'parliament', 'council',
         'trilogue', 'adopted', 'in_force', 'rejected', 'withdrawn')),
  source_url text,
  happened_on date NOT NULL DEFAULT CURRENT_DATE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eu_policy_updates_item
  ON public.eu_policy_updates (item_id, happened_on DESC, created_at DESC);

GRANT SELECT ON public.eu_policy_updates TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.eu_policy_updates TO authenticated;
GRANT ALL ON public.eu_policy_updates TO service_role;
ALTER TABLE public.eu_policy_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "policy updates public read" ON public.eu_policy_updates;
CREATE POLICY "policy updates public read" ON public.eu_policy_updates
  FOR SELECT TO anon, authenticated
  USING (tenant_id = (SELECT public.public_tenant_id())
    AND EXISTS (SELECT 1 FROM public.eu_policy_items i
                 WHERE i.id = eu_policy_updates.item_id AND i.status = 'published'));

DROP POLICY IF EXISTS "policy updates staff all" ON public.eu_policy_updates;
CREATE POLICY "policy updates staff all" ON public.eu_policy_updates
  FOR ALL TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id())
    AND (public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id())
    AND (public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)));

CREATE TABLE IF NOT EXISTS public.eu_policy_follows (
  item_id uuid NOT NULL REFERENCES public.eu_policy_items(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_eu_policy_follows_user ON public.eu_policy_follows (user_id);

GRANT SELECT, INSERT, DELETE ON public.eu_policy_follows TO authenticated;
GRANT ALL ON public.eu_policy_follows TO service_role;
ALTER TABLE public.eu_policy_follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "policy follows owner all" ON public.eu_policy_follows;
CREATE POLICY "policy follows owner all" ON public.eu_policy_follows
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.eu_policy_items i
                 WHERE i.id = eu_policy_follows.item_id
                   AND i.status = 'published'
                   AND i.tenant_id = eu_policy_follows.tenant_id));

CREATE OR REPLACE FUNCTION public.get_policy_follower_counts(p_item_ids uuid[])
RETURNS TABLE (item_id uuid, followers integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT f.item_id, count(*)::integer
    FROM public.eu_policy_follows f
    JOIN public.eu_policy_items i ON i.id = f.item_id
   WHERE f.item_id = ANY (p_item_ids)
     AND i.tenant_id = public.public_tenant_id()
     AND i.status = 'published'
   GROUP BY f.item_id;
$$;

REVOKE EXECUTE ON FUNCTION public.get_policy_follower_counts(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_policy_follower_counts(uuid[]) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_eu_policy_update_applied()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_item public.eu_policy_items%ROWTYPE; v_row record;
BEGIN
  SELECT * INTO v_item FROM public.eu_policy_items WHERE id = NEW.item_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  NEW.tenant_id := v_item.tenant_id;
  IF NEW.created_by IS NULL THEN NEW.created_by := auth.uid(); END IF;
  IF NEW.stage_to IS NOT NULL AND NEW.stage_to <> v_item.stage THEN
    NEW.stage_from := v_item.stage;
    UPDATE public.eu_policy_items SET stage = NEW.stage_to WHERE id = NEW.item_id;
  END IF;
  IF v_item.status = 'published' THEN
    FOR v_row IN SELECT user_id FROM public.eu_policy_follows WHERE item_id = NEW.item_id LOOP
      PERFORM public.enqueue_notification(v_row.user_id, 'content',
        'Aktualizacja dossier: ' || v_item.title_pl,
        'Dossier update: ' || v_item.title_en,
        left(btrim(NEW.note_pl), 160), left(btrim(NEW.note_en), 160),
        '/tracker/' || v_item.slug, 'Landmark');
    END LOOP;
    PERFORM public.emit_domain_event(v_item.tenant_id, 'eu_policy_item', v_item.id::text, 'policy.updated.v1',
      jsonb_build_object('slug', v_item.slug, 'stage_to', NEW.stage_to,
        'title_pl', v_item.title_pl, 'title_en', v_item.title_en));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'tracker: update fan-out failed: %', SQLERRM; RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS eu_policy_update_applied ON public.eu_policy_updates;
CREATE TRIGGER eu_policy_update_applied
  BEFORE INSERT ON public.eu_policy_updates
  FOR EACH ROW EXECUTE FUNCTION public.tg_eu_policy_update_applied();

-- ============================================================================
-- SPOŁECZNOŚĆ 8/10: ankiety + program kontrybutorów
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  question_pl text NOT NULL,
  question_en text NOT NULL,
  options jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  post_id uuid REFERENCES public.posts(id) ON DELETE SET NULL,
  ends_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (btrim(question_pl) <> '' AND btrim(question_en) <> ''),
  CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) BETWEEN 2 AND 8)
);

CREATE INDEX IF NOT EXISTS idx_polls_tenant_status ON public.polls (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_polls_post ON public.polls (post_id) WHERE post_id IS NOT NULL;

DROP TRIGGER IF EXISTS polls_set_updated_at ON public.polls;
CREATE TRIGGER polls_set_updated_at
  BEFORE UPDATE ON public.polls
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON public.polls TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.polls TO authenticated;
GRANT ALL ON public.polls TO service_role;
ALTER TABLE public.polls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "polls public read" ON public.polls;
CREATE POLICY "polls public read" ON public.polls
  FOR SELECT TO anon, authenticated
  USING (status IN ('open', 'closed') AND tenant_id = (SELECT public.public_tenant_id()));

DROP POLICY IF EXISTS "polls staff all" ON public.polls;
CREATE POLICY "polls staff all" ON public.polls
  FOR ALL TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id())
    AND (public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id())
    AND (public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)));

CREATE TABLE IF NOT EXISTS public.poll_votes (
  poll_id uuid NOT NULL REFERENCES public.polls(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  option_idx integer NOT NULL CHECK (option_idx >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (poll_id, user_id)
);

DROP TRIGGER IF EXISTS poll_votes_set_updated_at ON public.poll_votes;
CREATE TRIGGER poll_votes_set_updated_at
  BEFORE UPDATE ON public.poll_votes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON public.poll_votes TO authenticated;
GRANT ALL ON public.poll_votes TO service_role;
ALTER TABLE public.poll_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "poll votes own read" ON public.poll_votes;
CREATE POLICY "poll votes own read" ON public.poll_votes
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.get_poll_results(p_poll_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_poll public.polls%ROWTYPE;
  v_my integer; v_staff boolean := false; v_counts jsonb; v_total integer;
BEGIN
  SELECT * INTO v_poll FROM public.polls
   WHERE id = p_poll_id AND tenant_id = public.public_tenant_id();
  IF NOT FOUND OR v_poll.status = 'draft' THEN RAISE EXCEPTION 'polls: not found'; END IF;
  IF v_user IS NOT NULL THEN
    SELECT option_idx INTO v_my FROM public.poll_votes WHERE poll_id = p_poll_id AND user_id = v_user;
    v_staff := public.has_role(v_user, 'admin'::app_role) OR public.has_role(v_user, 'editor'::app_role);
  END IF;
  IF v_my IS NULL AND v_poll.status <> 'closed' AND NOT v_staff THEN
    RETURN jsonb_build_object('visible', false, 'my_vote', NULL);
  END IF;
  SELECT COALESCE(jsonb_object_agg(idx::text, cnt), '{}'::jsonb),
         COALESCE(sum(cnt), 0)::integer
    INTO v_counts, v_total
    FROM (SELECT option_idx AS idx, count(*)::integer AS cnt
            FROM public.poll_votes WHERE poll_id = p_poll_id GROUP BY option_idx) c;
  RETURN jsonb_build_object('visible', true, 'my_vote', v_my, 'total', v_total, 'counts', v_counts);
END;
$$;

CREATE OR REPLACE FUNCTION public.vote_poll(p_poll_id uuid, p_option_idx integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_user uuid := auth.uid(); v_poll public.polls%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'polls: authentication required'; END IF;
  SELECT * INTO v_poll FROM public.polls
   WHERE id = p_poll_id AND tenant_id = public.public_tenant_id();
  IF NOT FOUND OR v_poll.status <> 'open'
     OR (v_poll.ends_at IS NOT NULL AND v_poll.ends_at < now()) THEN
    RAISE EXCEPTION 'polls: closed';
  END IF;
  IF p_option_idx IS NULL OR p_option_idx < 0
     OR p_option_idx >= jsonb_array_length(v_poll.options) THEN
    RAISE EXCEPTION 'polls: invalid option';
  END IF;
  INSERT INTO public.poll_votes (poll_id, user_id, tenant_id, option_idx)
  VALUES (p_poll_id, v_user, v_poll.tenant_id, p_option_idx)
  ON CONFLICT (poll_id, user_id)
  DO UPDATE SET option_idx = EXCLUDED.option_idx, updated_at = now();
  RETURN public.get_poll_results(p_poll_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.vote_poll(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vote_poll(uuid, integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_poll_results(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_poll_results(uuid) TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.contributor_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 5 AND 200),
  pitch text NOT NULL CHECK (length(btrim(pitch)) BETWEEN 50 AND 5000),
  language text NOT NULL DEFAULT 'pl' CHECK (language IN ('pl', 'en')),
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'in_review', 'accepted', 'rejected')),
  editor_note text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contributor_submissions_tenant
  ON public.contributor_submissions (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contributor_submissions_user
  ON public.contributor_submissions (user_id, created_at DESC);

DROP TRIGGER IF EXISTS contributor_submissions_set_updated_at ON public.contributor_submissions;
CREATE TRIGGER contributor_submissions_set_updated_at
  BEFORE UPDATE ON public.contributor_submissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT, INSERT ON public.contributor_submissions TO authenticated;
GRANT UPDATE ON public.contributor_submissions TO authenticated;
GRANT ALL ON public.contributor_submissions TO service_role;
ALTER TABLE public.contributor_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "submissions own read" ON public.contributor_submissions;
CREATE POLICY "submissions own read" ON public.contributor_submissions
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "submissions own insert" ON public.contributor_submissions;
CREATE POLICY "submissions own insert" ON public.contributor_submissions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND status = 'submitted');

DROP POLICY IF EXISTS "submissions staff read" ON public.contributor_submissions;
CREATE POLICY "submissions staff read" ON public.contributor_submissions
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id())
    AND (public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)));

DROP POLICY IF EXISTS "submissions staff update" ON public.contributor_submissions;
CREATE POLICY "submissions staff update" ON public.contributor_submissions
  FOR UPDATE TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id())
    AND (public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id())
    AND (public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)));

CREATE OR REPLACE FUNCTION public.tg_contributor_submissions_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_recent integer; v_admin record;
BEGIN
  SELECT count(*) INTO v_recent FROM public.contributor_submissions
   WHERE user_id = NEW.user_id AND created_at > now() - interval '24 hours';
  IF v_recent >= 3 THEN RAISE EXCEPTION 'submissions: rate limited'; END IF;
  FOR v_admin IN
    SELECT ur.user_id FROM public.user_roles ur
      JOIN public.profiles p ON p.id = ur.user_id
     WHERE ur.role = 'admin'::app_role AND p.tenant_id = NEW.tenant_id LIMIT 20
  LOOP
    PERFORM public.enqueue_notification(v_admin.user_id, 'system',
      'Nowe zgłoszenie tekstu gościnnego',
      'New guest-essay submission',
      left(btrim(NEW.title), 140), left(btrim(NEW.title), 140),
      '/admin/submissions', 'FilePen');
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contributor_submissions_created ON public.contributor_submissions;
CREATE TRIGGER contributor_submissions_created
  BEFORE INSERT ON public.contributor_submissions
  FOR EACH ROW EXECUTE FUNCTION public.tg_contributor_submissions_created();

CREATE OR REPLACE FUNCTION public.tg_contributor_submissions_reviewed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.status <> OLD.status AND NEW.status IN ('accepted', 'rejected', 'in_review') THEN
    IF NEW.reviewed_by IS NULL THEN NEW.reviewed_by := auth.uid(); END IF;
    IF NEW.status IN ('accepted', 'rejected') AND NEW.reviewed_at IS NULL THEN NEW.reviewed_at := now(); END IF;
    IF NEW.status = 'accepted' THEN
      INSERT INTO public.profile_badges (tenant_id, user_id, badge, note, granted_by)
      VALUES (NEW.tenant_id, NEW.user_id, 'contributor',
              'Przyjęte zgłoszenie: ' || left(NEW.title, 120), NEW.reviewed_by)
      ON CONFLICT (tenant_id, user_id, badge) DO NOTHING;
      PERFORM public.enqueue_notification(NEW.user_id, 'system',
        'Zgłoszenie przyjęte: ' || left(NEW.title, 120),
        'Submission accepted: ' || left(NEW.title, 120),
        'Redakcja skontaktuje się w sprawie dalszych kroków.',
        'The editors will follow up on next steps.',
        '/contribute', 'FileCheck');
    ELSIF NEW.status = 'rejected' THEN
      PERFORM public.enqueue_notification(NEW.user_id, 'system',
        'Zgłoszenie odrzucone: ' || left(NEW.title, 120),
        'Submission declined: ' || left(NEW.title, 120),
        NULLIF(btrim(COALESCE(NEW.editor_note, '')), ''),
        NULLIF(btrim(COALESCE(NEW.editor_note, '')), ''),
        '/contribute', 'FileX');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contributor_submissions_reviewed ON public.contributor_submissions;
CREATE TRIGGER contributor_submissions_reviewed
  BEFORE UPDATE ON public.contributor_submissions
  FOR EACH ROW EXECUTE FUNCTION public.tg_contributor_submissions_reviewed();

-- ============================================================================
-- SPOŁECZNOŚĆ 10/10: przegląd zaangażowania
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_engagement_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_active_7 integer; v_active_30 integer; v_result jsonb;
BEGIN
  IF v_user IS NULL OR v_tenant IS NULL
     OR NOT (public.has_role(v_user, 'admin'::app_role)
             OR public.has_role(v_user, 'editor'::app_role)) THEN
    RAISE EXCEPTION 'engagement: staff only';
  END IF;
  WITH activity AS (
    SELECT m.sender_id AS user_id, m.created_at FROM public.messages m
     WHERE m.tenant_id = v_tenant AND m.created_at > now() - interval '30 days'
    UNION ALL
    SELECT c.user_id, c.created_at FROM public.comments c
     WHERE c.tenant_id = v_tenant AND c.created_at > now() - interval '30 days'
    UNION ALL
    SELECT r.user_id, r.updated_at FROM public.event_rsvps r
     WHERE r.tenant_id = v_tenant AND r.updated_at > now() - interval '30 days'
    UNION ALL
    SELECT pv.user_id, pv.updated_at FROM public.poll_votes pv
     WHERE pv.tenant_id = v_tenant AND pv.updated_at > now() - interval '30 days'
    UNION ALL
    SELECT q.user_id, q.created_at FROM public.qa_questions q
     WHERE q.tenant_id = v_tenant AND q.created_at > now() - interval '30 days'
    UNION ALL
    SELECT f.user_id, f.created_at FROM public.eu_policy_follows f
     WHERE f.tenant_id = v_tenant AND f.created_at > now() - interval '30 days'
  )
  SELECT count(DISTINCT user_id) FILTER (WHERE created_at > now() - interval '7 days'),
         count(DISTINCT user_id)
    INTO v_active_7, v_active_30 FROM activity;

  SELECT jsonb_build_object(
    'members_total', (SELECT count(*) FROM public.profiles p WHERE p.tenant_id = v_tenant),
    'members_new_30d', (SELECT count(*) FROM public.profiles p
       WHERE p.tenant_id = v_tenant AND p.created_at > now() - interval '30 days'),
    'active_7d', COALESCE(v_active_7, 0),
    'active_30d', COALESCE(v_active_30, 0),
    'subscriptions_active', (SELECT count(*) FROM public.user_subscriptions us
        JOIN public.access_plans ap ON ap.id = us.plan_id
       WHERE ap.tenant_id = v_tenant AND us.status = 'active'
         AND (us.current_period_end IS NULL OR us.current_period_end > now())),
    'tier_distribution', (SELECT COALESCE(jsonb_object_agg(t.key, t.cnt), '{}'::jsonb)
        FROM (SELECT COALESCE(ap.tier_key, 'member') AS key, count(DISTINCT us.user_id) AS cnt
                FROM public.user_subscriptions us
                JOIN public.access_plans ap ON ap.id = us.plan_id
               WHERE ap.tenant_id = v_tenant AND us.status = 'active'
                 AND (us.current_period_end IS NULL OR us.current_period_end > now())
               GROUP BY COALESCE(ap.tier_key, 'member')) t),
    'push_optin', (SELECT count(DISTINCT ps.user_id) FROM public.push_subscriptions ps
        JOIN public.profiles p ON p.id = ps.user_id
       WHERE p.tenant_id = v_tenant AND ps.failed_at IS NULL),
    'digest_optin', (SELECT count(*) FROM public.notification_preferences np
        JOIN public.profiles p ON p.id = np.user_id
       WHERE p.tenant_id = v_tenant AND np.email_digest <> 'off'),
    'events_upcoming', (SELECT count(*) FROM public.events e
       WHERE e.tenant_id = v_tenant AND e.status = 'published' AND e.starts_at > now()),
    'rsvps_upcoming', (SELECT count(*) FROM public.event_rsvps r
        JOIN public.events e ON e.id = r.event_id
       WHERE e.tenant_id = v_tenant AND e.status = 'published'
         AND e.starts_at > now() AND r.status = 'going'),
    'qa_open_questions', (SELECT count(*) FROM public.qa_questions q
       WHERE q.tenant_id = v_tenant AND q.status = 'pending'),
    'poll_votes_30d', (SELECT count(*) FROM public.poll_votes pv
       WHERE pv.tenant_id = v_tenant AND pv.updated_at > now() - interval '30 days'),
    'submissions_pending', (SELECT count(*) FROM public.contributor_submissions cs
       WHERE cs.tenant_id = v_tenant AND cs.status IN ('submitted', 'in_review')),
    'tracker_follows', (SELECT count(*) FROM public.eu_policy_follows f WHERE f.tenant_id = v_tenant),
    'top_upcoming_events', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'slug', e.slug, 'title_pl', e.title_pl, 'title_en', e.title_en,
               'starts_at', e.starts_at, 'going', COALESCE(g.going, 0)
             ) ORDER BY e.starts_at ASC), '[]'::jsonb)
        FROM (SELECT * FROM public.events e
               WHERE e.tenant_id = v_tenant AND e.status = 'published'
                 AND e.starts_at > now() ORDER BY e.starts_at ASC LIMIT 5) e
        LEFT JOIN LATERAL (SELECT count(*)::integer AS going FROM public.event_rsvps r
                            WHERE r.event_id = e.id AND r.status = 'going') g ON true)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_engagement_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_engagement_overview() TO authenticated, service_role;