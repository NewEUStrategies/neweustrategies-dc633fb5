-- Community RPC alignment + tier feature enforcement

CREATE OR REPLACE FUNCTION public.has_tier_feature(_feature text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((SELECT (t.features ->> _feature)::boolean FROM public.current_membership_tier() AS t LIMIT 1), false);
$$;
REVOKE EXECUTE ON FUNCTION public.has_tier_feature(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_tier_feature(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.user_has_tier_feature(p_user uuid, _feature text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_subscriptions us
      JOIN public.access_plans ap ON ap.id = us.plan_id
      JOIN public.membership_tiers mt ON mt.tenant_id = ap.tenant_id AND mt.key = ap.tier_key AND mt.active
     WHERE us.user_id = p_user AND us.status = 'active'
       AND (us.current_period_end IS NULL OR us.current_period_end > now())
       AND (mt.features ->> _feature)::boolean IS TRUE
  );
$$;
REVOKE EXECUTE ON FUNCTION public.user_has_tier_feature(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_tier_feature(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.rsvp_event(p_event_id uuid, p_status text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_going integer;
  v_min_rank integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'events: authentication required'; END IF;
  IF p_status NOT IN ('going', 'interested', 'cancelled') THEN
    RAISE EXCEPTION 'events: invalid status';
  END IF;
  SELECT * INTO v_event FROM public.events
   WHERE id = p_event_id AND tenant_id = public.public_tenant_id() AND status = 'published'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'events: not found'; END IF;

  IF v_event.visibility = 'members' THEN
    IF v_event.kind = 'briefing' THEN
      IF NOT public.has_tier_feature('pro_briefings') THEN
        RAISE EXCEPTION 'events: membership required';
      END IF;
    ELSE
      v_min_rank := GREATEST(COALESCE(v_event.min_tier_rank, 0), 1);
      IF NOT public.has_tier_rank(v_min_rank) THEN
        RAISE EXCEPTION 'events: membership required';
      END IF;
    END IF;
  END IF;

  IF p_status = 'going' AND v_event.capacity IS NOT NULL THEN
    SELECT count(*) INTO v_going FROM public.event_rsvps
     WHERE event_id = p_event_id AND status = 'going' AND user_id <> v_user;
    IF v_going >= v_event.capacity THEN RAISE EXCEPTION 'events: full'; END IF;
  END IF;

  INSERT INTO public.event_rsvps (tenant_id, event_id, user_id, status)
  VALUES (v_event.tenant_id, p_event_id, v_user, p_status)
  ON CONFLICT (event_id, user_id) DO UPDATE SET status = EXCLUDED.status, updated_at = now();

  SELECT count(*) INTO v_going FROM public.event_rsvps WHERE event_id = p_event_id AND status = 'going';
  RETURN jsonb_build_object('status', p_status, 'going', v_going);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rsvp_event(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rsvp_event(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_event_access(p_event_id uuid)
RETURNS TABLE (can_join boolean, join_url text, can_watch boolean, recording_url text, reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_staff boolean := false;
  v_allowed boolean;
  v_rsvp text;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id AND tenant_id = public.public_tenant_id();
  IF NOT FOUND OR v_event.status <> 'published' THEN
    RETURN QUERY SELECT false, NULL::text, false, NULL::text, 'not_found'; RETURN;
  END IF;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, false, NULL::text, 'auth_required'; RETURN;
  END IF;
  v_staff := public.has_role(v_user, 'admin'::app_role) OR public.has_role(v_user, 'editor'::app_role);
  SELECT er.status INTO v_rsvp FROM public.event_rsvps er WHERE er.event_id = p_event_id AND er.user_id = v_user;

  IF v_staff THEN
    v_allowed := true;
  ELSIF v_event.visibility = 'members' AND v_event.kind = 'briefing' THEN
    v_allowed := public.has_tier_feature('pro_briefings');
  ELSIF v_event.visibility = 'members' THEN
    v_allowed := public.has_tier_rank(GREATEST(COALESCE(v_event.min_tier_rank, 0), 1));
  ELSE
    v_allowed := public.has_tier_rank(COALESCE(v_event.min_tier_rank, 0));
  END IF;

  IF NOT v_allowed THEN
    RETURN QUERY SELECT false, NULL::text, false, NULL::text, 'tier_required'; RETURN;
  END IF;

  RETURN QUERY SELECT
    (v_staff OR v_rsvp = 'going') AND v_event.join_url IS NOT NULL,
    CASE WHEN (v_staff OR v_rsvp = 'going') THEN v_event.join_url END,
    v_event.recording_url IS NOT NULL,
    v_event.recording_url,
    CASE WHEN v_rsvp = 'going' OR v_staff THEN 'ok' ELSE 'rsvp_required' END;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_event_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_access(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_qa_questions(p_session_id uuid)
RETURNS TABLE (
  id uuid, session_id uuid, author_display text, is_anonymous boolean,
  body text, status text, answer_body text, answered_at timestamptz,
  created_at timestamptz, votes bigint, is_priority boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT q.id, q.session_id, q.author_display, q.is_anonymous, q.body, q.status,
         q.answer_body, q.answered_at, q.created_at,
         COALESCE(v.votes, 0) AS votes,
         public.user_has_tier_feature(q.user_id, 'qa_priority') AS is_priority
    FROM public.qa_questions q
    LEFT JOIN LATERAL (
      SELECT count(*) AS votes FROM public.qa_question_votes qv WHERE qv.question_id = q.id
    ) v ON true
   WHERE q.session_id = p_session_id
     AND q.tenant_id = public.public_tenant_id()
     AND q.status IN ('approved', 'answered')
   ORDER BY public.user_has_tier_feature(q.user_id, 'qa_priority') DESC,
            COALESCE(v.votes, 0) DESC,
            q.created_at ASC
   LIMIT 500;
$$;
REVOKE EXECUTE ON FUNCTION public.list_qa_questions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_qa_questions(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_poll_results_bulk(p_poll_ids uuid[])
RETURNS TABLE (poll_id uuid, result jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p.id, public.get_poll_results(p.id)
    FROM public.polls p
   WHERE p.id = ANY (COALESCE(p_poll_ids, '{}'::uuid[]))
     AND p.tenant_id = public.public_tenant_id()
     AND p.status IN ('open', 'closed');
$$;
REVOKE EXECUTE ON FUNCTION public.get_poll_results_bulk(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_poll_results_bulk(uuid[]) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "rsvps own insert" ON public.event_rsvps;
DROP POLICY IF EXISTS "rsvps own update" ON public.event_rsvps;
DROP POLICY IF EXISTS "rsvps own delete" ON public.event_rsvps;
DROP POLICY IF EXISTS "poll votes own insert" ON public.poll_votes;
DROP POLICY IF EXISTS "poll votes own update" ON public.poll_votes;
DROP POLICY IF EXISTS "poll votes own delete" ON public.poll_votes;
DROP POLICY IF EXISTS "qa questions own insert" ON public.qa_questions;
DROP POLICY IF EXISTS "qa votes own insert plus" ON public.qa_question_votes;

REVOKE INSERT, UPDATE, DELETE ON public.event_rsvps FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.poll_votes FROM authenticated;

CREATE OR REPLACE FUNCTION public.user_is_editorial(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
     WHERE ur.user_id = p_user
       AND ur.role IN ('admin'::app_role, 'editor'::app_role, 'author'::app_role, 'super_admin'::app_role)
  );
$$;
REVOKE ALL ON FUNCTION public.user_is_editorial(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_is_editorial(uuid) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Profiles anon public authors" ON public.profiles;
CREATE POLICY "Profiles anon public authors" ON public.profiles
  FOR SELECT TO anon
  USING (
    slug IS NOT NULL
    AND tenant_id = public.public_tenant_id()
    AND public.user_is_editorial(id)
  );

ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_kind_check;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_kind_check CHECK (kind IN ('direct', 'group'));

CREATE OR REPLACE FUNCTION public.tg_messages_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_recent integer;
  v_kind text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.conversation_participants cp
    WHERE cp.conversation_id = NEW.conversation_id
      AND cp.user_id <> NEW.sender_id
      AND public.is_blocked_pair(NEW.sender_id, cp.user_id)
  ) THEN
    RAISE EXCEPTION 'chat: blocked';
  END IF;

  SELECT c.kind INTO v_kind FROM public.conversations c WHERE c.id = NEW.conversation_id;

  IF COALESCE(v_kind, 'direct') = 'direct' AND EXISTS (
    SELECT 1 FROM public.conversation_participants cp
    WHERE cp.conversation_id = NEW.conversation_id
      AND cp.tenant_id = NEW.tenant_id
      AND cp.user_id <> NEW.sender_id
      AND public.chat_allow_messages_from(cp.user_id) = 'nobody'
  ) THEN
    RAISE EXCEPTION 'chat: recipient unavailable';
  END IF;

  SELECT count(*) INTO v_recent
  FROM public.messages m
  WHERE m.sender_id = NEW.sender_id
    AND m.created_at > now() - interval '60 seconds';
  IF v_recent >= 30 THEN
    RAISE EXCEPTION 'chat: rate limited';
  END IF;

  RETURN NEW;
END;
$$;
