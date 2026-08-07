CREATE TABLE IF NOT EXISTS public.club_moderation_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  club_id      uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  moderator_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action       text NOT NULL
               CHECK (action IN ('approve', 'hide', 'delete', 'lock', 'unlock',
                                 'pin', 'unpin', 'ban', 'unban', 'reveal_author',
                                 'role_change')),
  target_type  text NOT NULL CHECK (target_type IN ('thread', 'reply', 'member')),
  target_id    uuid NOT NULL,
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS club_moderation_log_club_idx
  ON public.club_moderation_log (club_id, created_at DESC);
CREATE INDEX IF NOT EXISTS club_moderation_log_target_idx
  ON public.club_moderation_log (target_type, target_id);
ALTER TABLE public.club_moderation_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_moderation_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.club_moderation_log TO service_role;
DROP TRIGGER IF EXISTS club_moderation_log_pin_tenant_tg ON public.club_moderation_log;
CREATE TRIGGER club_moderation_log_pin_tenant_tg
  BEFORE INSERT OR UPDATE ON public.club_moderation_log
  FOR EACH ROW EXECUTE FUNCTION public.club_child_pin_tenant();

CREATE OR REPLACE FUNCTION public.club_moderate(
  p_target_type text,
  p_target_id   uuid,
  p_action      text,
  p_reason      text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_club  uuid;
  v_group uuid;
  v_caps  record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_target_type NOT IN ('thread', 'reply') THEN
    RAISE EXCEPTION 'clubs: invalid target type' USING ERRCODE = '22023';
  END IF;
  IF p_action NOT IN ('approve','hide','delete','lock','unlock','pin','unpin') THEN
    RAISE EXCEPTION 'clubs: invalid moderation action %', p_action USING ERRCODE = '22023';
  END IF;
  IF p_target_type = 'reply' AND p_action IN ('lock','unlock','pin','unpin') THEN
    RAISE EXCEPTION 'clubs: action not applicable to a reply' USING ERRCODE = '22023';
  END IF;
  IF p_target_type = 'thread' THEN
    SELECT club_id, group_id INTO v_club, v_group FROM public.club_threads WHERE id = p_target_id;
  ELSE
    SELECT t.club_id, t.group_id INTO v_club, v_group
      FROM public.club_replies r JOIN public.club_threads t ON t.id = r.thread_id
     WHERE r.id = p_target_id;
  END IF;
  IF v_club IS NULL THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_caps FROM public.club_capabilities(v_club, v_group, v_uid);
  IF NOT COALESCE(v_caps.can_moderate, false) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_target_type = 'thread' THEN
    UPDATE public.club_threads SET
      status = CASE p_action
                 WHEN 'approve' THEN 'open'
                 WHEN 'hide'    THEN 'hidden'
                 WHEN 'delete'  THEN 'deleted'
                 WHEN 'lock'    THEN 'locked'
                 WHEN 'unlock'  THEN 'open'
                 ELSE status END,
      locked_at = CASE p_action
                    WHEN 'lock'   THEN now()
                    WHEN 'unlock' THEN NULL
                    ELSE locked_at END,
      pinned_at = CASE p_action
                    WHEN 'pin'   THEN now()
                    WHEN 'unpin' THEN NULL
                    ELSE pinned_at END
    WHERE id = p_target_id;
  ELSE
    UPDATE public.club_replies SET
      status = CASE p_action
                 WHEN 'approve' THEN 'visible'
                 WHEN 'hide'    THEN 'hidden'
                 WHEN 'delete'  THEN 'deleted'
                 ELSE status END
    WHERE id = p_target_id;
  END IF;
  INSERT INTO public.club_moderation_log (
    tenant_id, club_id, moderator_id, action, target_type, target_id, reason
  )
  SELECT c.tenant_id, v_club, v_uid, p_action, p_target_type, p_target_id,
         NULLIF(btrim(COALESCE(p_reason, '')), '')
    FROM public.clubs c WHERE c.id = v_club;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.club_moderate(text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_moderate(text, uuid, text, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_ban_member(
  p_club_id uuid, p_user_id uuid, p_banned boolean, p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_caps record;
BEGIN
  SELECT * INTO v_caps FROM public.club_capabilities(p_club_id, NULL, v_uid);
  IF NOT COALESCE(v_caps.can_moderate, false) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_banned AND (
       public.is_club_admin(p_user_id)
       OR EXISTS (SELECT 1 FROM public.club_members m
                   WHERE m.club_id = p_club_id AND m.user_id = p_user_id
                     AND m.role = 'lead' AND m.status = 'active')
     ) AND NOT public.is_club_admin(v_uid) THEN
    RAISE EXCEPTION 'clubs: cannot ban a lead or staff member' USING ERRCODE = '42501';
  END IF;
  UPDATE public.club_members
     SET status = CASE WHEN p_banned THEN 'banned' ELSE 'active' END,
         banned_reason = CASE WHEN p_banned
                              THEN NULLIF(btrim(COALESCE(p_reason, '')), '')
                              ELSE NULL END
   WHERE club_id = p_club_id AND user_id = p_user_id;
  INSERT INTO public.club_moderation_log (
    tenant_id, club_id, moderator_id, action, target_type, target_id, reason
  )
  SELECT c.tenant_id, p_club_id, v_uid,
         CASE WHEN p_banned THEN 'ban' ELSE 'unban' END,
         'member', p_user_id, NULLIF(btrim(COALESCE(p_reason, '')), '')
    FROM public.clubs c WHERE c.id = p_club_id;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.club_ban_member(uuid, uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_ban_member(uuid, uuid, boolean, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_set_role(
  p_club_id uuid, p_user_id uuid, p_role text, p_expires_at timestamptz DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_caps record;
BEGIN
  IF p_role NOT IN ('lead','moderator','member','observer') THEN
    RAISE EXCEPTION 'clubs: invalid club role %', p_role USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_caps FROM public.club_capabilities(p_club_id, NULL, v_uid);
  IF p_role IN ('lead','moderator') AND NOT public.is_club_admin(v_uid) THEN
    RAISE EXCEPTION 'clubs: elevated role requires admin' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_club_admin(v_uid) OR v_caps.effective_role = 'lead') THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.club_members
     SET role = p_role, role_expires_at = p_expires_at
   WHERE club_id = p_club_id AND user_id = p_user_id;
  INSERT INTO public.club_moderation_log (
    tenant_id, club_id, moderator_id, action, target_type, target_id, reason
  )
  SELECT c.tenant_id, p_club_id, v_uid, 'role_change', 'member', p_user_id, p_role
    FROM public.clubs c WHERE c.id = p_club_id;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.club_set_role(uuid, uuid, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_set_role(uuid, uuid, text, timestamptz)
  TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.club_moderator_reveal_author(text, uuid, text);
CREATE FUNCTION public.club_moderator_reveal_author(
  p_target_type text, p_target_id uuid, p_reason text
)
RETURNS TABLE (author_id uuid, display_name text, profile_slug text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_club   uuid;
  v_group  uuid;
  v_author uuid;
  v_caps   record;
BEGIN
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'clubs: a reason is required to reveal an author'
      USING ERRCODE = '22023';
  END IF;
  IF p_target_type = 'thread' THEN
    SELECT club_id, group_id, club_threads.author_id INTO v_club, v_group, v_author
      FROM public.club_threads WHERE id = p_target_id;
  ELSIF p_target_type = 'reply' THEN
    SELECT t.club_id, t.group_id, r.author_id INTO v_club, v_group, v_author
      FROM public.club_replies r JOIN public.club_threads t ON t.id = r.thread_id
     WHERE r.id = p_target_id;
  ELSE
    RAISE EXCEPTION 'clubs: invalid target type' USING ERRCODE = '22023';
  END IF;
  IF v_club IS NULL THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_caps FROM public.club_capabilities(v_club, v_group, v_uid);
  IF NOT COALESCE(v_caps.can_reveal_author, false) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.club_moderation_log (
    tenant_id, club_id, moderator_id, action, target_type, target_id, reason
  )
  SELECT c.tenant_id, v_club, v_uid, 'reveal_author', p_target_type, p_target_id, btrim(p_reason)
    FROM public.clubs c WHERE c.id = v_club;
  INSERT INTO public.audit_log (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  SELECT c.tenant_id, v_uid, 'club.reveal_author', p_target_type, p_target_id,
         jsonb_build_object('club_id', v_club, 'reason', btrim(p_reason),
                            'revealed_user', v_author)
    FROM public.clubs c WHERE c.id = v_club;
  RETURN QUERY
    SELECT p.id,
           COALESCE(NULLIF(btrim(p.display_name), ''), 'User'),
           p.slug
      FROM public.profiles p WHERE p.id = v_author;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.club_moderator_reveal_author(text, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_moderator_reveal_author(text, uuid, text)
  TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.admin_club_moderation_queue(uuid);
CREATE FUNCTION public.admin_club_moderation_queue(p_club_id uuid)
RETURNS TABLE (
  target_type text, target_id uuid, thread_slug text, title text,
  body text, author_name text, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'thread'::text, t.id, t.slug, t.title, t.body,
         COALESCE(NULLIF(btrim(p.display_name), ''), 'User'), t.created_at
    FROM public.club_threads t
    JOIN public.clubs c ON c.id = t.club_id
    LEFT JOIN public.profiles p ON p.id = t.author_id
   WHERE t.club_id = p_club_id AND t.status = 'pending'
     AND public.is_club_admin(auth.uid())
     AND c.tenant_id = public.current_tenant_id()
  UNION ALL
  SELECT 'reply'::text, r.id, t.slug, t.title, r.body,
         COALESCE(NULLIF(btrim(p.display_name), ''), 'User'), r.created_at
    FROM public.club_replies r
    JOIN public.club_threads t ON t.id = r.thread_id
    JOIN public.clubs c ON c.id = r.club_id
    LEFT JOIN public.profiles p ON p.id = r.author_id
   WHERE r.club_id = p_club_id AND r.status = 'pending'
     AND public.is_club_admin(auth.uid())
     AND c.tenant_id = public.current_tenant_id()
  ORDER BY created_at ASC
$$;
REVOKE EXECUTE ON FUNCTION public.admin_club_moderation_queue(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_moderation_queue(uuid)
  TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.admin_club_moderation_log(uuid, integer);
CREATE FUNCTION public.admin_club_moderation_log(p_club_id uuid, p_limit integer DEFAULT 100)
RETURNS TABLE (
  id uuid, action text, target_type text, target_id uuid,
  moderator_name text, reason text, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id, l.action, l.target_type, l.target_id,
         COALESCE(NULLIF(btrim(p.display_name), ''), 'User'), l.reason, l.created_at
    FROM public.club_moderation_log l
    JOIN public.clubs c ON c.id = l.club_id
    LEFT JOIN public.profiles p ON p.id = l.moderator_id
   WHERE l.club_id = p_club_id
     AND public.is_club_admin(auth.uid())
     AND c.tenant_id = public.current_tenant_id()
   ORDER BY l.created_at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)
$$;
REVOKE EXECUTE ON FUNCTION public.admin_club_moderation_log(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_moderation_log(uuid, integer)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_scheduler_tick()
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opened   integer := 0;
  v_closed   integer := 0;
  v_roles    integer := 0;
  v_invites  integer := 0;
  v_dormant  integer := 0;
  v_hotness  integer := 0;
BEGIN
  UPDATE public.club_groups
     SET status = 'active'
   WHERE status = 'scheduled' AND opens_at IS NOT NULL AND opens_at <= now();
  GET DIAGNOSTICS v_opened = ROW_COUNT;
  UPDATE public.club_groups
     SET status = 'frozen'
   WHERE status = 'active' AND closes_at IS NOT NULL AND closes_at <= now();
  GET DIAGNOSTICS v_closed = ROW_COUNT;
  UPDATE public.club_members
     SET role = 'member', role_expires_at = NULL
   WHERE role IN ('lead', 'moderator')
     AND role_expires_at IS NOT NULL AND role_expires_at <= now();
  GET DIAGNOSTICS v_roles = ROW_COUNT;
  UPDATE public.club_invitations
     SET status = 'expired'
   WHERE status = 'pending' AND expires_at <= now();
  GET DIAGNOSTICS v_invites = ROW_COUNT;
  UPDATE public.club_invite_links
     SET revoked_at = now()
   WHERE revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at <= now();
  v_dormant := public.club_threads_mark_dormant(500);
  v_hotness := public.club_threads_refresh_hotness(1000);
  RETURN jsonb_build_object(
    'groups_opened', v_opened,
    'groups_closed', v_closed,
    'roles_expired', v_roles,
    'invitations_expired', v_invites,
    'threads_dormant', v_dormant,
    'hotness_refreshed', v_hotness
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.club_scheduler_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_scheduler_tick() TO service_role;

DROP FUNCTION IF EXISTS public.admin_club_pending_counts();
CREATE FUNCTION public.admin_club_pending_counts()
RETURNS TABLE (moderation_pending integer, join_requests integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT count(*)::int FROM public.club_threads t
       JOIN public.clubs c ON c.id = t.club_id
      WHERE t.status = 'pending' AND c.tenant_id = public.current_tenant_id())
    + (SELECT count(*)::int FROM public.club_replies r
         JOIN public.clubs c ON c.id = r.club_id
        WHERE r.status = 'pending' AND c.tenant_id = public.current_tenant_id()),
    (SELECT count(*)::int FROM public.club_members m
       JOIN public.clubs c ON c.id = m.club_id
      WHERE m.status = 'pending' AND c.tenant_id = public.current_tenant_id())
  WHERE public.is_club_admin(auth.uid())
$$;
REVOKE EXECUTE ON FUNCTION public.admin_club_pending_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_pending_counts()
  TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.admin_club_segment_preview(uuid, jsonb);
CREATE FUNCTION public.admin_club_segment_preview(p_club_id uuid, p_rule jsonb)
RETURNS TABLE (matched integer, already_member integer, blocked integer, will_send integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant  uuid := public.current_tenant_id();
  v_kind    text := p_rule->>'kind';
  v_matched integer := 0;
  v_member  integer := 0;
  v_blocked integer := 0;
BEGIN
  IF NOT public.is_club_admin(auth.uid()) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  CREATE TEMP TABLE IF NOT EXISTS club_segment_candidates (user_id uuid PRIMARY KEY)
    ON COMMIT DROP;
  DELETE FROM club_segment_candidates;
  IF v_kind = 'badge' THEN
    INSERT INTO club_segment_candidates
    SELECT DISTINCT b.user_id FROM public.profile_badges b
      JOIN public.profiles p ON p.id = b.user_id
     WHERE p.tenant_id = v_tenant AND b.badge = p_rule->>'badge';
  ELSIF v_kind = 'policy_follow' THEN
    INSERT INTO club_segment_candidates
    SELECT DISTINCT f.user_id FROM public.eu_policy_follows f
      JOIN public.profiles p ON p.id = f.user_id
     WHERE p.tenant_id = v_tenant AND f.item_id = (p_rule->>'item_id')::uuid;
  ELSIF v_kind = 'event_rsvp' THEN
    INSERT INTO club_segment_candidates
    SELECT DISTINCT r.user_id FROM public.event_rsvps r
      JOIN public.profiles p ON p.id = r.user_id
     WHERE p.tenant_id = v_tenant AND r.event_id = (p_rule->>'event_id')::uuid
       AND r.status IN ('going', 'interested');
  ELSIF v_kind = 'other_club' THEN
    INSERT INTO club_segment_candidates
    SELECT DISTINCT m.user_id FROM public.club_members m
      JOIN public.clubs c ON c.id = m.club_id
     WHERE c.tenant_id = v_tenant AND m.club_id = (p_rule->>'club_id')::uuid
       AND m.status = 'active';
  ELSIF v_kind = 'specialization' THEN
    INSERT INTO club_segment_candidates
    SELECT p.id FROM public.profiles p
     WHERE p.tenant_id = v_tenant AND p.discoverable
       AND lower(btrim(COALESCE(p.specialization, ''))) = lower(btrim(p_rule->>'value'));
  ELSE
    RETURN QUERY SELECT 0, 0, 0, 0;
    RETURN;
  END IF;
  SELECT count(*)::int INTO v_matched FROM club_segment_candidates;
  SELECT count(*)::int INTO v_member
    FROM club_segment_candidates s
    JOIN public.club_members m ON m.user_id = s.user_id AND m.club_id = p_club_id
   WHERE m.status IN ('active', 'pending', 'invited', 'banned');
  SELECT count(*)::int INTO v_blocked
    FROM club_segment_candidates s
    JOIN public.notification_preferences np ON np.user_id = s.user_id
   WHERE np.enabled_club IS FALSE;
  RETURN QUERY SELECT
    v_matched, v_member, v_blocked,
    GREATEST(v_matched - v_member - v_blocked, 0);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_club_segment_preview(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_segment_preview(uuid, jsonb)
  TO authenticated, service_role;