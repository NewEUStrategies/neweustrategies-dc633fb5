CREATE INDEX IF NOT EXISTS club_threads_unanswered_idx
  ON public.club_threads (club_id, status, created_at DESC, id DESC)
  WHERE reply_count = 0;

CREATE INDEX IF NOT EXISTS club_threads_author_idx
  ON public.club_threads (author_id, club_id, created_at DESC)
  WHERE author_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.club_threads_list(
  p_club_id uuid, p_group_id uuid DEFAULT NULL, p_sort text DEFAULT 'hot',
  p_kind text DEFAULT NULL, p_cursor text DEFAULT NULL, p_limit integer DEFAULT 20
)
RETURNS TABLE (
  id uuid, slug text, title text, kind text, status text,
  group_id uuid, group_name_pl text, group_name_en text,
  anchor_type text, anchor_id text,
  is_anonymous boolean, author_id uuid, author_name text,
  author_avatar text, author_slug text, author_alias text,
  posted_by_admin_name text,
  reply_count integer, participant_count integer, reaction_count integer,
  pinned_at timestamptz, last_reply_at timestamptz, created_at timestamptz,
  hotness numeric, cursor_value text, excerpt text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH sort AS (
    SELECT CASE
             WHEN p_sort IN ('new', 'unanswered', 'top', 'mine', 'subscribed')
               THEN p_sort
             ELSE 'hot'
           END AS mode
  ),
  cap AS (
    SELECT * FROM public.club_capabilities(p_club_id, p_group_id, auth.uid())
  ),
  visible AS (
    SELECT t.*, g.name_pl AS g_pl, g.name_en AS g_en,
           COALESCE(g.attribution_mode, cl.attribution_mode) AS attribution,
           (CASE WHEN t.pinned_at IS NOT NULL AND s.mode IN ('hot', 'new')
                 THEN '1' ELSE '0' END) AS pin_key
      FROM public.club_threads t
      JOIN public.club_groups g ON g.id = t.group_id
      JOIN public.clubs cl ON cl.id = t.club_id
      CROSS JOIN cap
      CROSS JOIN sort s
     WHERE t.club_id = p_club_id
       AND cap.can_read
       AND (p_group_id IS NULL OR t.group_id = p_group_id)
       AND (p_kind IS NULL OR t.kind = p_kind)
       AND (t.status IN ('open','resolved','dormant','locked')
            OR cap.can_moderate
            OR (t.status = 'pending' AND t.author_id = auth.uid()))
       AND (g.status NOT IN ('draft','archived') OR cap.can_manage)
       AND (s.mode <> 'unanswered' OR t.reply_count = 0)
       AND (s.mode <> 'top' OR t.created_at > now() - interval '30 days')
       AND (s.mode <> 'mine'
            OR (auth.uid() IS NOT NULL AND t.author_id = auth.uid()))
       AND (s.mode <> 'subscribed'
            OR EXISTS (SELECT 1 FROM public.club_thread_subscriptions cs
                        WHERE cs.thread_id = t.id
                          AND cs.user_id = auth.uid()
                          AND cs.state = 'subscribed'))
  ),
  keyed AS (
    SELECT v.*,
           v.pin_key || '|' ||
           CASE s.mode
             WHEN 'new' THEN
               to_char(COALESCE(v.last_reply_at, v.created_at), 'YYYYMMDDHH24MISSMS')
             WHEN 'subscribed' THEN
               to_char(COALESCE(v.last_reply_at, v.created_at), 'YYYYMMDDHH24MISSMS')
             WHEN 'unanswered' THEN to_char(v.created_at, 'YYYYMMDDHH24MISSMS')
             WHEN 'mine' THEN to_char(v.created_at, 'YYYYMMDDHH24MISSMS')
             WHEN 'top' THEN lpad(GREATEST(v.reaction_count, 0)::text, 10, '0')
             ELSE to_char(v.hotness, 'FM0000000000.0000000000')
           END || '|' || v.id::text AS ckey
      FROM visible v
      CROSS JOIN sort s
  )
  SELECT
    k.id, k.slug, k.title, k.kind, k.status,
    k.group_id, k.g_pl, k.g_en, k.anchor_type, k.anchor_id, k.is_anonymous,
    CASE WHEN k.is_anonymous OR k.attribution = 'chatham' THEN NULL ELSE k.author_id END,
    CASE WHEN k.is_anonymous OR k.attribution = 'chatham' THEN NULL
         ELSE COALESCE(NULLIF(btrim(p.display_name), ''),
                       NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'User') END,
    CASE WHEN k.is_anonymous OR k.attribution = 'chatham' OR p.hide_avatar THEN NULL
         ELSE p.avatar_url END,
    CASE WHEN k.is_anonymous OR k.attribution = 'chatham' THEN NULL ELSE p.slug END,
    CASE WHEN k.is_anonymous OR k.attribution = 'chatham'
         THEN public.club_author_alias(k.id, k.author_id) ELSE NULL END,
    NULLIF(btrim(pa.display_name), ''),
    k.reply_count, k.participant_count, k.reaction_count,
    k.pinned_at, k.last_reply_at, k.created_at, k.hotness, k.ckey,
    left(k.body, 280)
  FROM keyed k
  LEFT JOIN public.profiles p ON p.id = k.author_id
  LEFT JOIN public.profiles pa ON pa.id = k.posted_by_admin_id
  WHERE p_cursor IS NULL OR k.ckey < p_cursor
  ORDER BY k.ckey DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
$$;

COMMENT ON FUNCTION public.club_threads_list(uuid, uuid, text, text, text, integer) IS
  'Lista tematow klubu. Szesc sortow: hot (ranking), new (ostatnia aktywnosc), unanswered (bez odpowiedzi), top (reakcje z 30 dni), mine (moje), subscribed (sledzone). Kursor niesie przypiecie, klucz sortu i id - tiebreaker jest obowiazkowy, bo bez niego strona gubi wiersze o rownym kluczu.';

REVOKE EXECUTE ON FUNCTION
  public.club_threads_list(uuid, uuid, text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.club_threads_list(uuid, uuid, text, text, text, integer)
  TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.club_replies_list(uuid, text, integer, integer);

CREATE FUNCTION public.club_replies_list(
  p_thread_id uuid, p_sort text DEFAULT 'chronological',
  p_limit integer DEFAULT 200, p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid, parent_id uuid, depth smallint, body text, status text,
  is_anonymous boolean, author_id uuid, author_name text,
  author_avatar text, author_slug text, author_alias text,
  posted_by_admin_name text,
  reaction_count integer, created_at timestamptz, edited_at timestamptz,
  is_resolution boolean, author_stance text, total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH thread AS (
    SELECT t.*, COALESCE(g.attribution_mode, c.attribution_mode) AS attribution
      FROM public.club_threads t
      JOIN public.club_groups g ON g.id = t.group_id
      JOIN public.clubs c ON c.id = t.club_id
     WHERE t.id = p_thread_id
  ),
  cap AS (
    SELECT * FROM public.club_capabilities(
      (SELECT club_id FROM thread), (SELECT group_id FROM thread), auth.uid())
  ),
  rows AS (
    SELECT
      r.id, r.parent_id, r.depth, r.body, r.status, r.is_anonymous,
      CASE WHEN r.is_anonymous OR th.attribution = 'chatham' THEN NULL ELSE r.author_id END AS a_id,
      CASE WHEN r.is_anonymous OR th.attribution = 'chatham' THEN NULL
           ELSE COALESCE(NULLIF(btrim(p.display_name), ''), 'User') END AS a_name,
      CASE WHEN r.is_anonymous OR th.attribution = 'chatham' OR p.hide_avatar THEN NULL
           ELSE p.avatar_url END AS a_avatar,
      CASE WHEN r.is_anonymous OR th.attribution = 'chatham' THEN NULL ELSE p.slug END AS a_slug,
      CASE WHEN r.is_anonymous OR th.attribution = 'chatham'
           THEN public.club_author_alias(r.thread_id, r.author_id) ELSE NULL END AS a_alias,
      NULLIF(btrim(pa.display_name), '') AS pb_name,
      r.reaction_count, r.created_at, r.edited_at,
      (th.resolved_reply_id = r.id) AS is_res,
      CASE WHEN th.kind = 'position'
                AND NOT r.is_anonymous
                AND th.attribution IS DISTINCT FROM 'chatham'
           THEN st.stance ELSE NULL END AS a_stance
    FROM public.club_replies r
    CROSS JOIN thread th
    CROSS JOIN cap
    LEFT JOIN public.profiles p ON p.id = r.author_id
    LEFT JOIN public.profiles pa ON pa.id = r.posted_by_admin_id
    LEFT JOIN public.club_stances st
           ON st.thread_id = r.thread_id AND st.user_id = r.author_id
    WHERE r.thread_id = p_thread_id
      AND cap.can_read
      AND (th.status IN ('open', 'resolved', 'dormant', 'locked')
           OR cap.can_moderate
           OR (th.status = 'pending' AND th.author_id = auth.uid()))
      AND (r.status = 'visible' OR cap.can_moderate
           OR (r.status = 'pending' AND r.author_id = auth.uid()))
  )
  SELECT r.*, count(*) OVER () AS total_count
  FROM rows r
  ORDER BY
    r.is_res DESC NULLS LAST,
    CASE WHEN p_sort = 'best' THEN r.reaction_count ELSE 0 END DESC,
    CASE WHEN p_sort = 'stance' THEN
      CASE r.a_stance WHEN 'support' THEN 0 WHEN 'oppose' THEN 1
                      WHEN 'abstain' THEN 2 ELSE 3 END
      ELSE 0 END ASC,
    r.created_at ASC, r.id ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$$;

COMMENT ON FUNCTION public.club_replies_list(uuid, text, integer, integer) IS
  'Odpowiedzi watku z paginacja. Trzy porzadki: chronological (deliberacja jest sekwencja), best (po reakcjach), stance (mapa sporu - wymaga watku typu position). Stanowisko autora nie wychodzi pod regula Chatham House ani przy wpisie anonimowym.';

REVOKE EXECUTE ON FUNCTION public.club_replies_list(uuid, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_replies_list(uuid, text, integer, integer)
  TO anon, authenticated, service_role;

ALTER TABLE public.club_members
  ADD COLUMN IF NOT EXISTS unread_count integer NOT NULL DEFAULT 0
    CHECK (unread_count >= 0);

COMMENT ON COLUMN public.club_members.unread_count IS
  'Nieprzeczytane wpisy w tym klubie od last_read_at. Utrzymywane triggerem; suma po czlonkostwach jedzie do user_pending_counters."club_unread".';

CREATE OR REPLACE FUNCTION public.club_bump_unread(
  p_club_id uuid, p_actor_id uuid
)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_club_id IS NULL THEN RETURN; END IF;

  WITH bumped AS (
    UPDATE public.club_members m
       SET unread_count = m.unread_count + 1
     WHERE m.club_id = p_club_id
       AND m.status = 'active'
       AND m.user_id IS DISTINCT FROM p_actor_id
       AND m.notify_level <> 'none'
    RETURNING m.tenant_id, m.user_id
  )
  INSERT INTO public.user_pending_counters (tenant_id, user_id, counter_key, value)
  SELECT b.tenant_id, b.user_id, 'club_unread', 1 FROM bumped b
  ON CONFLICT (user_id, counter_key) DO UPDATE
    SET value = public.user_pending_counters.value + 1, updated_at = now();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_bump_unread(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_bump_unread(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_club_threads_unread()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'open' THEN
    PERFORM public.club_bump_unread(NEW.club_id, COALESCE(NEW.author_id, NEW.posted_by_admin_id));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_club_replies_unread()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'visible' THEN
    PERFORM public.club_bump_unread(NEW.club_id, COALESCE(NEW.author_id, NEW.posted_by_admin_id));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS club_threads_unread_tg ON public.club_threads;
CREATE TRIGGER club_threads_unread_tg
  AFTER INSERT ON public.club_threads
  FOR EACH ROW EXECUTE FUNCTION public.tg_club_threads_unread();

DROP TRIGGER IF EXISTS club_replies_unread_tg ON public.club_replies;
CREATE TRIGGER club_replies_unread_tg
  AFTER INSERT ON public.club_replies
  FOR EACH ROW EXECUTE FUNCTION public.tg_club_replies_unread();

DROP FUNCTION IF EXISTS public.club_my_memberships();

CREATE FUNCTION public.club_my_memberships()
RETURNS TABLE (
  club_id uuid, slug text, name_pl text, name_en text, icon text,
  accent_color text, role text, status text, notify_level text,
  role_expires_at timestamptz, last_read_at timestamptz,
  member_count integer, thread_count integer, last_activity_at timestamptz,
  unread_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id, c.slug, c.name_pl, c.name_en, c.icon, c.accent_color,
    public.club_effective_member_role(m.role, m.role_expires_at),
    m.status, m.notify_level, m.role_expires_at, m.last_read_at,
    c.member_count, c.thread_count, c.last_activity_at,
    CASE WHEN m.notify_level = 'none' THEN 0 ELSE m.unread_count END
  FROM public.club_members m
  JOIN public.clubs c ON c.id = m.club_id
  JOIN public.profiles p ON p.id = m.user_id
  WHERE m.user_id = auth.uid()
    AND auth.uid() IS NOT NULL
    AND m.status IN ('active', 'pending', 'invited')
    AND c.status <> 'archived'
    AND c.tenant_id = p.tenant_id
  ORDER BY (m.status = 'active') DESC, c.last_activity_at DESC NULLS LAST
$$;

COMMENT ON FUNCTION public.club_my_memberships() IS
  'Kluby wolajacego (aktywne, oczekujace, zaproszenia) - jedno zapytanie dla nawigacji, razem z liczba nieprzeczytanych wpisow w kazdym z nich.';

REVOKE EXECUTE ON FUNCTION public.club_my_memberships() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_my_memberships() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_mark_read(p_club_id uuid)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_tenant uuid;
  v_old    integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT m.tenant_id, m.unread_count INTO v_tenant, v_old
    FROM public.club_members m
   WHERE m.club_id = p_club_id AND m.user_id = v_uid
   FOR UPDATE;

  IF v_tenant IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.club_members
     SET unread_count = 0, last_read_at = now()
   WHERE club_id = p_club_id AND user_id = v_uid;

  IF COALESCE(v_old, 0) > 0 THEN
    PERFORM public.bump_user_counter(v_tenant, v_uid, 'club_unread', -v_old);
  END IF;

  RETURN COALESCE(v_old, 0);
END;
$$;

COMMENT ON FUNCTION public.club_mark_read(uuid) IS
  'Zeruje nieprzeczytane jednego klubu i odejmuje jego wklad od licznika globalnego. Zwraca liczbe wpisow, ktore byly nieprzeczytane.';

REVOKE EXECUTE ON FUNCTION public.club_mark_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_mark_read(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.recompute_user_pending_counters(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_notifications integer;
  v_chat integer;
  v_connections integer;
  v_club integer;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = p_user_id;
  IF v_tenant IS NULL THEN RETURN; END IF;

  SELECT count(*)::integer INTO v_notifications
    FROM public.notifications WHERE user_id = p_user_id AND read_at IS NULL;
  SELECT COALESCE(sum(unread_count), 0)::integer INTO v_chat
    FROM public.conversation_participants WHERE user_id = p_user_id;
  SELECT count(*)::integer INTO v_connections
    FROM public.user_connections WHERE addressee_id = p_user_id AND status = 'pending';
  SELECT COALESCE(sum(m.unread_count), 0)::integer INTO v_club
    FROM public.club_members m
   WHERE m.user_id = p_user_id AND m.status = 'active' AND m.notify_level <> 'none';

  INSERT INTO public.user_pending_counters (tenant_id, user_id, counter_key, value)
  VALUES
    (v_tenant, p_user_id, 'notifications_unread', v_notifications),
    (v_tenant, p_user_id, 'chat_unread', v_chat),
    (v_tenant, p_user_id, 'connections_pending', v_connections),
    (v_tenant, p_user_id, 'club_unread', v_club)
  ON CONFLICT (user_id, counter_key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = now();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recompute_user_pending_counters(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_user_pending_counters(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.club_report_content(
  p_target_type text,
  p_target_id uuid,
  p_reason text,
  p_details text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_tenant   uuid;
  v_club     uuid;
  v_group    uuid;
  v_author   uuid;
  v_caps     record;
  v_report   uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_target_type NOT IN ('thread', 'reply') THEN
    RAISE EXCEPTION 'clubs: invalid target' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN
     ('spam', 'harassment', 'impersonation', 'inappropriate', 'other') THEN
    RAISE EXCEPTION 'clubs: invalid reason' USING ERRCODE = '22023';
  END IF;

  IF p_target_type = 'thread' THEN
    SELECT t.tenant_id, t.club_id, t.group_id, t.author_id
      INTO v_tenant, v_club, v_group, v_author
      FROM public.club_threads t WHERE t.id = p_target_id;
  ELSE
    SELECT r.tenant_id, r.club_id, t.group_id, r.author_id
      INTO v_tenant, v_club, v_group, v_author
      FROM public.club_replies r
      JOIN public.club_threads t ON t.id = r.thread_id
     WHERE r.id = p_target_id;
  END IF;

  IF v_club IS NULL THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_caps FROM public.club_capabilities(v_club, v_group, v_uid);
  IF NOT COALESCE(v_caps.can_read, false) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_author IS NOT NULL AND v_author = v_uid THEN
    RAISE EXCEPTION 'clubs: invalid target' USING ERRCODE = '22023';
  END IF;

  IF v_author IS NOT NULL THEN
    SELECT ur.id INTO v_report FROM public.user_reports ur
     WHERE ur.reporter_id = v_uid AND ur.reported_id = v_author AND ur.status = 'open';
    IF v_report IS NULL THEN
      INSERT INTO public.user_reports (tenant_id, reporter_id, reported_id, reason, details)
      VALUES (v_tenant, v_uid, v_author, p_reason,
              NULLIF(btrim(COALESCE(p_details, '')), ''))
      RETURNING id INTO v_report;
    END IF;
  END IF;

  INSERT INTO public.club_moderation_log (
    tenant_id, club_id, moderator_id, action, target_type, target_id, reason
  ) VALUES (
    v_tenant, v_club, v_uid, 'report', p_target_type, p_target_id,
    p_reason || COALESCE(': ' || NULLIF(btrim(COALESCE(p_details, '')), ''), '')
  );

  RETURN v_report;
END;
$$;

COMMENT ON FUNCTION public.club_report_content(text, uuid, text, text) IS
  'Zgloszenie wpisu klubowego. Wskazuje TRESC, nie osobe - autor jest rozwiazywany w bazie i nigdy nie wraca do wolajacego, wiec zgloszenie dziala tak samo pod regula Chatham House.';

REVOKE EXECUTE ON FUNCTION public.club_report_content(text, uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_report_content(text, uuid, text, text)
  TO authenticated, service_role;

ALTER TABLE public.club_moderation_log
  DROP CONSTRAINT IF EXISTS club_moderation_log_action_check;
ALTER TABLE public.club_moderation_log
  ADD CONSTRAINT club_moderation_log_action_check
  CHECK (action IN ('approve', 'hide', 'delete', 'restore', 'lock', 'unlock',
                    'pin', 'unpin', 'ban', 'unban', 'reveal_author',
                    'role_change', 'post_on_behalf', 'move', 'edit',
                    'member_add', 'group_delete', 'report'));

CREATE OR REPLACE FUNCTION public.club_anchor_suggest(
  p_query text,
  p_anchor_type text DEFAULT NULL,
  p_limit integer DEFAULT 8
)
RETURNS TABLE (
  anchor_type text, anchor_id text, label_pl text, label_en text, hint text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH q AS (
    SELECT '%' || btrim(COALESCE(p_query, '')) || '%' AS like_pattern,
           length(btrim(COALESCE(p_query, ''))) AS len,
           public.current_tenant_id() AS tenant
  )
  (
    SELECT 'eu_policy_item'::text, i.id::text, i.title_pl, i.title_en, i.stage
      FROM public.eu_policy_items i, q
     WHERE q.len >= 2
       AND i.tenant_id = q.tenant
       AND (p_anchor_type IS NULL OR p_anchor_type = 'eu_policy_item')
       AND i.status = 'published'
       AND (i.title_pl ILIKE q.like_pattern OR i.title_en ILIKE q.like_pattern)
     ORDER BY i.updated_at DESC NULLS LAST
     LIMIT GREATEST(COALESCE(p_limit, 8), 1)
  )
  UNION ALL
  (
    SELECT 'post'::text, p.id::text, p.title_pl, p.title_en, p.slug
      FROM public.posts p, q
     WHERE q.len >= 2
       AND p.tenant_id = q.tenant
       AND (p_anchor_type IS NULL OR p_anchor_type = 'post')
       AND p.status = 'published'
       AND p.deleted_at IS NULL
       AND (p.title_pl ILIKE q.like_pattern OR p.title_en ILIKE q.like_pattern)
     ORDER BY p.published_at DESC NULLS LAST
     LIMIT GREATEST(COALESCE(p_limit, 8), 1)
  )
  UNION ALL
  (
    SELECT 'event'::text, e.id::text, e.title_pl, e.title_en, e.slug
      FROM public.events e, q
     WHERE q.len >= 2
       AND e.tenant_id = q.tenant
       AND (p_anchor_type IS NULL OR p_anchor_type = 'event')
       AND e.status = 'published'
       AND (e.title_pl ILIKE q.like_pattern OR e.title_en ILIKE q.like_pattern)
     ORDER BY e.starts_at DESC NULLS LAST
     LIMIT GREATEST(COALESCE(p_limit, 8), 1)
  )
$$;

COMMENT ON FUNCTION public.club_anchor_suggest(text, text, integer) IS
  'Podpowiedzi kotwicy dla kompozytora watku: akty prawne, opublikowane wpisy i wydarzenia tenantu wolajacego.';

REVOKE EXECUTE ON FUNCTION public.club_anchor_suggest(text, text, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_anchor_suggest(text, text, integer)
  TO authenticated, service_role;