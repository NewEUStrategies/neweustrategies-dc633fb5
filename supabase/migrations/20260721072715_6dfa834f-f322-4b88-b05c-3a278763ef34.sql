-- ============================================================================
-- PR #57: events waitlist + recordings gate, QA session summary, community reputation
-- ============================================================================

-- ============================================================================
-- 1) event_rsvps: waitlist FIFO
-- ============================================================================
ALTER TABLE public.event_rsvps
  ADD COLUMN IF NOT EXISTS waitlisted_at timestamptz;

ALTER TABLE public.event_rsvps
  DROP CONSTRAINT IF EXISTS event_rsvps_status_check;
ALTER TABLE public.event_rsvps
  ADD CONSTRAINT event_rsvps_status_check
  CHECK (status IN ('going', 'interested', 'cancelled', 'waitlist'));

ALTER TABLE public.event_rsvps
  DROP CONSTRAINT IF EXISTS event_rsvps_waitlist_marker_check;
ALTER TABLE public.event_rsvps
  ADD CONSTRAINT event_rsvps_waitlist_marker_check
  CHECK (status <> 'waitlist' OR waitlisted_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_event_rsvps_waitlist_fifo
  ON public.event_rsvps (event_id, waitlisted_at)
  WHERE status = 'waitlist';

CREATE OR REPLACE FUNCTION public.promote_event_waitlist(p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_row record;
  v_going integer;
  v_promoted integer := 0;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.status <> 'published' THEN RETURN 0; END IF;

  LOOP
    IF v_event.capacity IS NOT NULL THEN
      SELECT count(*) INTO v_going FROM public.event_rsvps
       WHERE event_id = p_event_id AND status = 'going';
      EXIT WHEN v_going >= v_event.capacity;
    END IF;

    SELECT * INTO v_row FROM public.event_rsvps
     WHERE event_id = p_event_id AND status = 'waitlist'
     ORDER BY waitlisted_at ASC, created_at ASC
     LIMIT 1 FOR UPDATE;
    EXIT WHEN NOT FOUND;

    UPDATE public.event_rsvps
       SET status = 'going', waitlisted_at = NULL, reminded_at = NULL, updated_at = now()
     WHERE id = v_row.id;

    PERFORM public.enqueue_notification(
      v_row.user_id, 'content',
      'Masz miejsce: ' || v_event.title_pl,
      'You have a seat: ' || v_event.title_en,
      'Zwolniło się miejsce i Twój zapis z listy rezerwowej został potwierdzony.',
      'A seat opened up and your waitlist spot has been confirmed.',
      '/events/' || v_event.slug, 'CalendarCheck'
    );
    v_promoted := v_promoted + 1;
  END LOOP;
  RETURN v_promoted;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.promote_event_waitlist(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_event_waitlist(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.rsvp_event(p_event_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_prev text;
  v_going integer;
  v_waitlist integer;
  v_position integer;
  v_min_rank integer;
  v_result_status text := p_status;
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

  SELECT er.status INTO v_prev FROM public.event_rsvps er
   WHERE er.event_id = p_event_id AND er.user_id = v_user;

  IF p_status = 'going' AND v_event.capacity IS NOT NULL
     AND COALESCE(v_prev, '') <> 'going' THEN
    SELECT count(*) INTO v_going FROM public.event_rsvps
     WHERE event_id = p_event_id AND status = 'going';
    IF v_going >= v_event.capacity THEN v_result_status := 'waitlist'; END IF;
  END IF;

  INSERT INTO public.event_rsvps (tenant_id, event_id, user_id, status, waitlisted_at)
  VALUES (v_event.tenant_id, p_event_id, v_user, v_result_status,
    CASE WHEN v_result_status = 'waitlist' THEN clock_timestamp() END)
  ON CONFLICT (event_id, user_id) DO UPDATE SET
    status = EXCLUDED.status,
    waitlisted_at = CASE
      WHEN EXCLUDED.status = 'waitlist'
        THEN COALESCE(event_rsvps.waitlisted_at, clock_timestamp())
      ELSE NULL
    END,
    updated_at = now();

  IF v_prev = 'going' AND v_result_status <> 'going' THEN
    PERFORM public.promote_event_waitlist(p_event_id);
  END IF;

  SELECT count(*) FILTER (WHERE er.status = 'going'),
         count(*) FILTER (WHERE er.status = 'waitlist')
    INTO v_going, v_waitlist
    FROM public.event_rsvps er WHERE er.event_id = p_event_id;

  IF v_result_status = 'waitlist' THEN
    SELECT count(*) INTO v_position FROM public.event_rsvps er
     WHERE er.event_id = p_event_id AND er.status = 'waitlist'
       AND er.waitlisted_at <= (
         SELECT mine.waitlisted_at FROM public.event_rsvps mine
          WHERE mine.event_id = p_event_id AND mine.user_id = v_user);
  END IF;

  RETURN jsonb_build_object('status', v_result_status, 'going', v_going,
    'waitlist', v_waitlist, 'waitlist_position', v_position);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rsvp_event(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rsvp_event(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_event_waitlist_position(p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_mine timestamptz;
  v_position integer;
BEGIN
  IF v_user IS NULL THEN RETURN NULL; END IF;
  SELECT er.waitlisted_at INTO v_mine
    FROM public.event_rsvps er JOIN public.events e ON e.id = er.event_id
   WHERE er.event_id = p_event_id AND er.user_id = v_user
     AND er.status = 'waitlist' AND e.tenant_id = public.public_tenant_id();
  IF v_mine IS NULL THEN RETURN NULL; END IF;
  SELECT count(*) INTO v_position FROM public.event_rsvps er
   WHERE er.event_id = p_event_id AND er.status = 'waitlist'
     AND er.waitlisted_at <= v_mine;
  RETURN v_position;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_event_waitlist_position(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_waitlist_position(uuid) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.get_event_rsvp_counts(uuid[]);
CREATE FUNCTION public.get_event_rsvp_counts(p_event_ids uuid[])
RETURNS TABLE (event_id uuid, going integer, interested integer, waitlist integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.event_id,
         count(*) FILTER (WHERE r.status = 'going')::integer,
         count(*) FILTER (WHERE r.status = 'interested')::integer,
         count(*) FILTER (WHERE r.status = 'waitlist')::integer
    FROM public.event_rsvps r JOIN public.events e ON e.id = r.event_id
   WHERE r.event_id = ANY (p_event_ids)
     AND e.tenant_id = public.public_tenant_id()
     AND e.status = 'published'
   GROUP BY r.event_id;
$$;
REVOKE EXECUTE ON FUNCTION public.get_event_rsvp_counts(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_rsvp_counts(uuid[]) TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.get_event_access(uuid);
CREATE FUNCTION public.get_event_access(p_event_id uuid)
RETURNS TABLE (can_join boolean, join_url text, can_watch boolean,
  recording_url text, reason text, watch_reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_staff boolean := false;
  v_allowed boolean;
  v_can_watch boolean;
  v_rsvp text;
BEGIN
  SELECT * INTO v_event FROM public.events
   WHERE id = p_event_id AND tenant_id = public.public_tenant_id();
  IF NOT FOUND OR v_event.status <> 'published' THEN
    RETURN QUERY SELECT false, NULL::text, false, NULL::text, 'not_found', 'not_found';
    RETURN;
  END IF;

  IF v_user IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, false, NULL::text, 'auth_required',
      CASE WHEN v_event.recording_url IS NULL THEN 'none' ELSE 'auth_required' END;
    RETURN;
  END IF;

  v_staff := public.has_role(v_user, 'admin'::app_role)
          OR public.has_role(v_user, 'editor'::app_role);
  SELECT er.status INTO v_rsvp FROM public.event_rsvps er
   WHERE er.event_id = p_event_id AND er.user_id = v_user;

  IF v_staff THEN v_allowed := true;
  ELSIF v_event.visibility = 'members' AND v_event.kind = 'briefing' THEN
    v_allowed := public.has_tier_feature('pro_briefings');
  ELSIF v_event.visibility = 'members' THEN
    v_allowed := public.has_tier_rank(GREATEST(COALESCE(v_event.min_tier_rank, 0), 1));
  ELSE
    v_allowed := public.has_tier_rank(COALESCE(v_event.min_tier_rank, 0));
  END IF;

  IF NOT v_allowed THEN
    RETURN QUERY SELECT false, NULL::text, false, NULL::text, 'tier_required',
      CASE WHEN v_event.recording_url IS NULL THEN 'none' ELSE 'tier_required' END;
    RETURN;
  END IF;

  v_can_watch := v_event.recording_url IS NOT NULL
             AND (v_staff OR public.has_tier_feature('recordings'));

  RETURN QUERY SELECT
    (v_staff OR v_rsvp = 'going') AND v_event.join_url IS NOT NULL,
    CASE WHEN (v_staff OR v_rsvp = 'going') THEN v_event.join_url END,
    v_can_watch,
    CASE WHEN v_can_watch THEN v_event.recording_url END,
    CASE WHEN v_rsvp = 'going' OR v_staff THEN 'ok'
         WHEN v_rsvp = 'waitlist' THEN 'waitlisted'
         ELSE 'rsvp_required' END,
    CASE WHEN v_event.recording_url IS NULL THEN 'none'
         WHEN v_can_watch THEN 'ok' ELSE 'tier_required' END;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_event_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_access(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_events_capacity_promote()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'published'
     AND (NEW.capacity IS NULL OR NEW.capacity > COALESCE(OLD.capacity, NEW.capacity)) THEN
    PERFORM public.promote_event_waitlist(NEW.id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'events: waitlist promotion failed: %', SQLERRM;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS events_capacity_promote ON public.events;
CREATE TRIGGER events_capacity_promote
  AFTER UPDATE OF capacity ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.tg_events_capacity_promote();

-- ============================================================================
-- 2) Q&A: publish session summary as a blog post
-- ============================================================================
CREATE OR REPLACE FUNCTION public.qa_escape_html(p_text text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT replace(replace(replace(replace(replace(COALESCE(p_text, ''),
    '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;');
$$;
REVOKE EXECUTE ON FUNCTION public.qa_escape_html(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qa_escape_html(text) TO service_role;

CREATE OR REPLACE FUNCTION public.qa_text_to_html(p_text text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT '<p>' || replace(public.qa_escape_html(btrim(p_text)), E'\n', '<br />') || '</p>';
$$;
REVOKE EXECUTE ON FUNCTION public.qa_text_to_html(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qa_text_to_html(text) TO service_role;

CREATE OR REPLACE FUNCTION public.publish_qa_session_summary(
  p_session_id uuid, p_publish boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_session public.qa_sessions%ROWTYPE;
  v_staff boolean;
  v_q record;
  v_n integer := 0;
  v_body_pl text := '';
  v_body_en text := '';
  v_author_pl text;
  v_author_en text;
  v_slug text;
  v_post_id uuid;
  v_parent_page uuid;
  v_was_published boolean := false;
  v_status public.post_status;
  v_notified uuid[];
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'qa: authentication required'; END IF;

  SELECT * INTO v_session FROM public.qa_sessions
   WHERE id = p_session_id AND tenant_id = public.public_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'qa: session not found'; END IF;

  v_staff := public.has_role(v_user, 'admin'::app_role)
          OR public.has_role(v_user, 'editor'::app_role);
  IF NOT v_staff AND v_session.host_user_id <> v_user THEN
    RAISE EXCEPTION 'qa: not allowed';
  END IF;

  IF p_publish AND NOT public.can_publish_content(v_user) THEN
    RAISE EXCEPTION 'qa: publish requires editorial role';
  END IF;

  IF v_session.status NOT IN ('answering', 'closed') THEN
    RAISE EXCEPTION 'qa: session not summarizable';
  END IF;

  IF COALESCE(btrim(v_session.intro_pl), '') <> '' THEN
    v_body_pl := public.qa_text_to_html(v_session.intro_pl);
  END IF;
  IF COALESCE(btrim(v_session.intro_en), '') <> '' THEN
    v_body_en := public.qa_text_to_html(v_session.intro_en);
  END IF;

  FOR v_q IN
    SELECT q.body, q.answer_body, q.author_display, q.is_anonymous, q.user_id
      FROM public.qa_questions q
      LEFT JOIN LATERAL (
        SELECT count(*) AS votes FROM public.qa_question_votes qv
         WHERE qv.question_id = q.id
      ) v ON true
     WHERE q.session_id = p_session_id AND q.status = 'answered'
       AND COALESCE(btrim(q.answer_body), '') <> ''
     ORDER BY v.votes DESC, q.created_at ASC LIMIT 200
  LOOP
    v_n := v_n + 1;
    v_author_pl := CASE
      WHEN v_q.is_anonymous OR COALESCE(btrim(v_q.author_display), '') = ''
        THEN 'Anonimowo' ELSE public.qa_escape_html(v_q.author_display) END;
    v_author_en := CASE
      WHEN v_q.is_anonymous OR COALESCE(btrim(v_q.author_display), '') = ''
        THEN 'Anonymous' ELSE public.qa_escape_html(v_q.author_display) END;

    v_body_pl := v_body_pl
      || '<h3>Pytanie ' || v_n || '</h3>'
      || '<blockquote>' || public.qa_text_to_html(v_q.body)
      || '<p><cite>- ' || v_author_pl || '</cite></p></blockquote>'
      || public.qa_text_to_html(v_q.answer_body);
    v_body_en := v_body_en
      || '<h3>Question ' || v_n || '</h3>'
      || '<blockquote>' || public.qa_text_to_html(v_q.body)
      || '<p><cite>- ' || v_author_en || '</cite></p></blockquote>'
      || public.qa_text_to_html(v_q.answer_body);

    v_notified := array_append(v_notified, v_q.user_id);
  END LOOP;

  IF v_n = 0 THEN RAISE EXCEPTION 'qa: no answered questions'; END IF;

  v_slug := 'qa-' || v_session.slug || '-podsumowanie';

  v_post_id := v_session.post_id;
  IF v_post_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.posts p WHERE p.id = v_post_id) THEN
    v_post_id := NULL;
  END IF;
  IF v_post_id IS NULL THEN
    SELECT p.id INTO v_post_id FROM public.posts p
     WHERE p.tenant_id = v_session.tenant_id AND p.slug = v_slug;
  END IF;

  IF v_post_id IS NULL THEN
    SELECT pg.id INTO v_parent_page FROM public.pages pg
     WHERE pg.tenant_id = v_session.tenant_id AND pg.slug = 'blog'
       AND pg.parent_id IS NULL AND pg.deleted_at IS NULL
     ORDER BY pg.created_at ASC LIMIT 1;
    IF v_parent_page IS NULL THEN
      SELECT pg.id INTO v_parent_page FROM public.pages pg
       WHERE pg.tenant_id = v_session.tenant_id AND pg.parent_id IS NULL
         AND pg.deleted_at IS NULL
       ORDER BY pg.created_at ASC LIMIT 1;
    END IF;
    IF v_parent_page IS NULL THEN
      RAISE EXCEPTION 'qa: no parent page for summary post';
    END IF;

    INSERT INTO public.posts (
      tenant_id, slug, parent_page_id, author_id, status, editor,
      title_pl, title_en, excerpt_pl, excerpt_en, content_pl, content_en, published_at)
    VALUES (v_session.tenant_id, v_slug, v_parent_page,
      COALESCE(v_session.host_user_id, v_user),
      CASE WHEN p_publish THEN 'published' ELSE 'draft' END::public.post_status,
      'richtext'::public.editor_type,
      'Q&A: ' || v_session.title_pl || ' - podsumowanie',
      'Q&A: ' || v_session.title_en || ' - recap',
      'Najważniejsze pytania społeczności i odpowiedzi eksperta z sesji Q&A.',
      'The community''s top questions and the expert''s answers from the Q&A session.',
      v_body_pl, v_body_en,
      CASE WHEN p_publish THEN now() END)
    RETURNING id INTO v_post_id;
  ELSE
    SELECT p.status = 'published' INTO v_was_published
      FROM public.posts p WHERE p.id = v_post_id;
    UPDATE public.posts
       SET title_pl = 'Q&A: ' || v_session.title_pl || ' - podsumowanie',
           title_en = 'Q&A: ' || v_session.title_en || ' - recap',
           content_pl = v_body_pl, content_en = v_body_en,
           status = CASE WHEN p_publish OR v_was_published THEN 'published'::public.post_status
                         ELSE status END,
           published_at = CASE WHEN p_publish OR v_was_published THEN COALESCE(published_at, now())
                               ELSE published_at END,
           deleted_at = NULL, updated_at = now()
     WHERE id = v_post_id;
  END IF;

  UPDATE public.qa_sessions SET post_id = v_post_id, updated_at = now()
   WHERE id = p_session_id;

  SELECT p.status INTO v_status FROM public.posts p WHERE p.id = v_post_id;

  IF p_publish AND NOT v_was_published THEN
    PERFORM public.enqueue_notification(
      u.user_id, 'content',
      'Podsumowanie sesji Q&A jest już dostępne',
      'The Q&A session recap is now available',
      v_session.title_pl, v_session.title_en,
      '/post/' || v_slug, 'BookOpenCheck')
    FROM (SELECT DISTINCT unnest(v_notified) AS user_id) u
    WHERE u.user_id IS NOT NULL;
  END IF;

  RETURN jsonb_build_object('post_id', v_post_id, 'slug', v_slug,
    'status', v_status, 'questions', v_n);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.publish_qa_session_summary(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_qa_session_summary(uuid, boolean) TO authenticated, service_role;

-- ============================================================================
-- 3) Community reputation / contributor leaderboard
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_poll_votes_user
  ON public.poll_votes (user_id, updated_at DESC);

CREATE OR REPLACE FUNCTION public.contribution_scores(p_since timestamptz)
RETURNS TABLE (user_id uuid, points integer, breakdown jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH src AS (
    SELECT q.user_id, 'qa_answered'::text AS kind, count(*)::integer AS n
      FROM public.qa_questions q
     WHERE q.tenant_id = public.public_tenant_id()
       AND q.status = 'answered' AND q.created_at >= p_since
     GROUP BY q.user_id
    UNION ALL
    SELECT q.user_id, 'qa_approved', count(*)::integer
      FROM public.qa_questions q
     WHERE q.tenant_id = public.public_tenant_id()
       AND q.status = 'approved' AND q.created_at >= p_since
     GROUP BY q.user_id
    UNION ALL
    SELECT q.user_id, 'qa_votes_received', count(*)::integer
      FROM public.qa_question_votes qv
      JOIN public.qa_questions q ON q.id = qv.question_id
     WHERE q.tenant_id = public.public_tenant_id()
       AND qv.created_at >= p_since
     GROUP BY q.user_id
    UNION ALL
    SELECT r.user_id, 'events_attended', count(*)::integer
      FROM public.event_rsvps r JOIN public.events e ON e.id = r.event_id
     WHERE e.tenant_id = public.public_tenant_id()
       AND e.status = 'published' AND r.status = 'going'
       AND e.starts_at < now() AND e.starts_at >= p_since
     GROUP BY r.user_id
    UNION ALL
    SELECT c.user_id, 'comments', count(*)::integer
      FROM public.comments c
     WHERE c.tenant_id = public.public_tenant_id()
       AND c.status = 'approved' AND c.user_id IS NOT NULL
       AND c.created_at >= p_since
     GROUP BY c.user_id
    UNION ALL
    SELECT pv.user_id, 'poll_votes', count(*)::integer
      FROM public.poll_votes pv
     WHERE pv.tenant_id = public.public_tenant_id()
       AND pv.updated_at >= p_since
     GROUP BY pv.user_id
    UNION ALL
    SELECT cs.user_id, 'submissions_accepted', count(*)::integer
      FROM public.contributor_submissions cs
     WHERE cs.tenant_id = public.public_tenant_id()
       AND cs.status = 'accepted' AND cs.updated_at >= p_since
     GROUP BY cs.user_id
    UNION ALL
    SELECT pb.user_id, 'badge_' || pb.badge, 1
      FROM public.profile_badges pb
     WHERE pb.tenant_id = public.public_tenant_id()
       AND pb.badge IN ('expert', 'contributor', 'verified')
  ),
  weighted AS (
    SELECT src.user_id, src.kind, src.n,
           src.n * CASE src.kind
             WHEN 'qa_answered' THEN 10 WHEN 'qa_approved' THEN 3
             WHEN 'qa_votes_received' THEN 2 WHEN 'events_attended' THEN 5
             WHEN 'comments' THEN 2 WHEN 'poll_votes' THEN 1
             WHEN 'submissions_accepted' THEN 25
             WHEN 'badge_expert' THEN 50 WHEN 'badge_contributor' THEN 30
             WHEN 'badge_verified' THEN 10 ELSE 0
           END AS pts
      FROM src
  )
  SELECT w.user_id, sum(w.pts)::integer AS points,
         jsonb_object_agg(w.kind, jsonb_build_object('count', w.n, 'points', w.pts)) AS breakdown
    FROM weighted w GROUP BY w.user_id;
$$;
REVOKE EXECUTE ON FUNCTION public.contribution_scores(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contribution_scores(timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.get_contributor_leaderboard(
  p_days integer DEFAULT 90, p_limit integer DEFAULT 20)
RETURNS TABLE (board_position integer, user_id uuid, display_name text,
  avatar_url text, slug text, points integer, breakdown jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 90), 7), 365);
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'reputation: authentication required'; END IF;

  RETURN QUERY
  SELECT row_number() OVER (ORDER BY s.points DESC, p.display_name ASC NULLS LAST)::integer,
         s.user_id,
         COALESCE(NULLIF(btrim(p.display_name), ''), split_part(p.email, '@', 1)),
         p.avatar_url, p.slug, s.points, s.breakdown
    FROM public.contribution_scores(now() - make_interval(days => v_days)) s
    JOIN public.profiles p
      ON p.id = s.user_id AND p.tenant_id = public.public_tenant_id()
   WHERE p.discoverable = true
     AND NOT public.user_is_editorial(s.user_id)
     AND s.points > 0
   ORDER BY s.points DESC, p.display_name ASC NULLS LAST
   LIMIT v_limit;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_contributor_leaderboard(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_contributor_leaderboard(integer, integer)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_reputation(p_days integer DEFAULT 90)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 90), 7), 365);
  v_since timestamptz := now() - make_interval(days => v_days);
  v_points integer := 0;
  v_breakdown jsonb := '{}'::jsonb;
  v_discoverable boolean := false;
  v_editorial boolean;
  v_position integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'reputation: authentication required'; END IF;

  SELECT s.points, s.breakdown INTO v_points, v_breakdown
    FROM public.contribution_scores(v_since) s WHERE s.user_id = v_user;

  SELECT COALESCE(p.discoverable, false) INTO v_discoverable
    FROM public.profiles p
   WHERE p.id = v_user AND p.tenant_id = public.public_tenant_id();

  v_editorial := public.user_is_editorial(v_user);

  IF v_discoverable AND NOT v_editorial AND COALESCE(v_points, 0) > 0 THEN
    SELECT count(*) + 1 INTO v_position
      FROM public.contribution_scores(v_since) s
      JOIN public.profiles p
        ON p.id = s.user_id AND p.tenant_id = public.public_tenant_id()
     WHERE p.discoverable = true
       AND NOT public.user_is_editorial(s.user_id)
       AND s.points > COALESCE(v_points, 0);
  END IF;

  RETURN jsonb_build_object(
    'points', COALESCE(v_points, 0),
    'breakdown', COALESCE(v_breakdown, '{}'::jsonb),
    'window_days', v_days,
    'board_visible', v_discoverable AND NOT v_editorial,
    'position', v_position);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_reputation(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_reputation(integer) TO authenticated, service_role;