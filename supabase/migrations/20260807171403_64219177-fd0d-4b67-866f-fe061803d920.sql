CREATE TABLE IF NOT EXISTS public.club_anonymity_salts (
  tenant_id  uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  salt       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.club_anonymity_salts IS
  'Sekret solacy pseudonimy Chatham House, jeden na tenanta. RPC-only i bez grantow - wyciek tej wartosci odwraca anonimowosc calego archiwum.';
ALTER TABLE public.club_anonymity_salts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_anonymity_salts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.club_anonymity_salts TO service_role;
CREATE OR REPLACE FUNCTION public.club_anonymity_salt(_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_salt text;
BEGIN
  SELECT salt INTO v_salt FROM public.club_anonymity_salts WHERE tenant_id = _tenant_id;
  IF v_salt IS NOT NULL THEN
    RETURN v_salt;
  END IF;
  INSERT INTO public.club_anonymity_salts (tenant_id, salt)
  VALUES (_tenant_id, encode(gen_random_bytes(32), 'hex'))
  ON CONFLICT (tenant_id) DO NOTHING;
  SELECT salt INTO v_salt FROM public.club_anonymity_salts WHERE tenant_id = _tenant_id;
  RETURN v_salt;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.club_anonymity_salt(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_anonymity_salt(uuid) TO service_role;
DROP FUNCTION IF EXISTS public.club_author_alias(uuid, uuid);
CREATE FUNCTION public.club_author_alias(_thread_id uuid, _author_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_salt   text;
  v_idx    integer;
BEGIN
  IF _author_id IS NULL OR _thread_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT t.tenant_id INTO v_tenant FROM public.club_threads t WHERE t.id = _thread_id;
  IF v_tenant IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT s.salt INTO v_salt FROM public.club_anonymity_salts s WHERE s.tenant_id = v_tenant;
  IF v_salt IS NULL THEN
    RETURN 'A?';
  END IF;
  v_idx := 1 + (abs(hashtextextended(_thread_id::text || ':' || _author_id::text || ':' || v_salt, 42)) % 26);
  RETURN 'A' || (('{A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R,S,T,U,V,W,X,Y,Z}'::text[])[v_idx]);
END;
$$;
COMMENT ON FUNCTION public.club_author_alias(uuid, uuid) IS
  'Pseudonim Chatham House: osolony per watek ORAZ sekretem per tenant, BEZ grantu dla klienta.';
REVOKE EXECUTE ON FUNCTION public.club_author_alias(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_author_alias(uuid, uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.club_ensure_anonymity_salt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.club_anonymity_salt(NEW.tenant_id);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS clubs_ensure_salt_tg ON public.clubs;
CREATE TRIGGER clubs_ensure_salt_tg
  AFTER INSERT ON public.clubs
  FOR EACH ROW EXECUTE FUNCTION public.club_ensure_anonymity_salt();
INSERT INTO public.club_anonymity_salts (tenant_id, salt)
SELECT DISTINCT c.tenant_id, encode(gen_random_bytes(32), 'hex')
  FROM public.clubs c
ON CONFLICT (tenant_id) DO NOTHING;
CREATE OR REPLACE FUNCTION public.club_effective_member_role(
  _role text, _role_expires_at timestamptz
)
RETURNS text
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _role IS NULL THEN NULL
    WHEN _role IN ('lead', 'moderator')
         AND _role_expires_at IS NOT NULL
         AND _role_expires_at <= now()
      THEN 'member'
    ELSE _role
  END;
$$;
COMMENT ON FUNCTION public.club_effective_member_role(text, timestamptz) IS
  'Rola po uwzglednieniu kadencji. STABLE, nie IMMUTABLE: czyta now().';
REVOKE EXECUTE ON FUNCTION public.club_effective_member_role(text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_effective_member_role(text, timestamptz)
  TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.club_capabilities(
  _club_id uuid,
  _group_id uuid DEFAULT NULL,
  _user_id uuid DEFAULT auth.uid()
)
RETURNS TABLE (
  can_read          boolean,
  can_post_thread   boolean,
  can_reply         boolean,
  can_react         boolean,
  can_moderate      boolean,
  can_manage        boolean,
  can_invite        boolean,
  can_see_members   boolean,
  can_reveal_author boolean,
  effective_role    text,
  reason            text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club        public.clubs%ROWTYPE;
  v_group       public.club_groups%ROWTYPE;
  v_member      public.club_members%ROWTYPE;
  v_caller      uuid := auth.uid();
  v_is_admin    boolean;
  v_is_editor   boolean;
  v_home_tenant uuid;
  v_role        text;
  v_visibility  text;
  v_who_can_post text;
  v_min_tier    integer;
  v_reason      text := NULL;
  v_read        boolean := false;
  v_group_open  boolean := true;
BEGIN
  SELECT * INTO v_club FROM public.clubs c WHERE c.id = _club_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                        'non_member'::text, 'not_found'::text;
    RETURN;
  END IF;
  IF _user_id IS DISTINCT FROM v_caller
     AND NOT (public.is_club_admin(v_caller) AND v_club.tenant_id = public.current_tenant_id())
  THEN
    _user_id := v_caller;
  END IF;
  v_is_admin  := public.is_club_admin(_user_id);
  v_is_editor := _user_id IS NOT NULL AND public.has_role(_user_id, 'editor');
  SELECT p.tenant_id INTO v_home_tenant FROM public.profiles p WHERE p.id = _user_id;
  IF _user_id IS NULL THEN
    IF v_club.visibility = 'public' AND v_club.status = 'active'
       AND v_club.tenant_id = public.public_tenant_id() THEN
      RETURN QUERY SELECT true, false, false, false, false, false, false, false, false,
                          'non_member'::text, NULL::text;
    ELSE
      RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                          'non_member'::text, 'auth_required'::text;
    END IF;
    RETURN;
  END IF;
  IF v_home_tenant IS NULL OR v_home_tenant <> v_club.tenant_id THEN
    RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                        'non_member'::text, 'not_found'::text;
    RETURN;
  END IF;
  IF _group_id IS NOT NULL THEN
    SELECT * INTO v_group FROM public.club_groups g
     WHERE g.id = _group_id AND g.club_id = _club_id;
    IF NOT FOUND THEN
      RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                          'non_member'::text, 'not_found'::text;
      RETURN;
    END IF;
  END IF;
  SELECT * INTO v_member FROM public.club_members m
   WHERE m.club_id = _club_id AND m.user_id = _user_id;
  IF FOUND AND v_member.status = 'banned' THEN
    RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                        'banned'::text, 'banned'::text;
    RETURN;
  END IF;
  v_role := CASE
    WHEN v_member.id IS NULL OR v_member.status <> 'active' THEN 'non_member'
    ELSE public.club_effective_member_role(v_member.role, v_member.role_expires_at)
  END;
  IF v_club.visibility = 'secret' AND v_role = 'non_member' AND NOT v_is_admin THEN
    RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                        'non_member'::text, 'not_found'::text;
    RETURN;
  END IF;
  IF v_club.status <> 'active' AND NOT v_is_admin THEN
    RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                        v_role,
                        CASE WHEN v_club.status = 'draft' THEN 'not_open_yet' ELSE 'archived' END;
    RETURN;
  END IF;
  v_visibility   := COALESCE(v_group.visibility, v_club.visibility);
  v_who_can_post := COALESCE(v_group.who_can_post, v_club.who_can_post);
  v_min_tier     := COALESCE(v_group.min_tier_rank, v_club.min_tier_rank);
  IF _group_id IS NOT NULL AND NOT v_is_admin THEN
    IF v_group.status IN ('draft', 'archived') THEN
      v_group_open := false;
      v_reason := CASE WHEN v_group.status = 'draft' THEN 'not_open_yet' ELSE 'archived' END;
    ELSIF v_group.status = 'frozen' THEN
      v_group_open := false;
      v_reason := 'group_frozen';
    ELSIF v_group.opens_at IS NOT NULL AND v_group.opens_at > now() THEN
      v_group_open := false;
      v_reason := 'not_open_yet';
    ELSIF v_group.closes_at IS NOT NULL AND v_group.closes_at <= now() THEN
      v_group_open := false;
      v_reason := 'window_closed';
    END IF;
  END IF;
  IF v_min_tier > 0 AND NOT v_is_admin AND v_role = 'non_member' THEN
    IF _user_id = v_caller THEN
      IF NOT public.has_tier_rank(v_min_tier) THEN
        RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                            v_role, 'tier_too_low'::text;
        RETURN;
      END IF;
    ELSE
      v_reason := COALESCE(v_reason, 'tier_unknown');
    END IF;
  END IF;
  v_read := CASE
    WHEN v_is_admin THEN true
    WHEN v_role <> 'non_member' THEN true
    WHEN v_visibility IN ('public', 'members') THEN true
    ELSE false
  END;
  IF NOT v_read AND v_reason IS NULL THEN
    v_reason := 'not_member';
  END IF;
  IF v_reason IS NULL
     AND v_role IN ('member', 'observer')
     AND COALESCE(v_group.moderation_mode, v_club.moderation_mode) = 'pre' THEN
    v_reason := 'pre_moderation';
  END IF;
  RETURN QUERY SELECT
    v_read,
    CASE
      WHEN v_is_admin THEN true
      WHEN NOT v_read OR NOT v_group_open THEN false
      WHEN v_role IN ('lead', 'moderator') THEN true
      WHEN v_who_can_post = 'staff_only' THEN v_is_editor
      WHEN v_who_can_post = 'moderators' THEN false
      WHEN v_who_can_post = 'members' THEN v_role = 'member' OR v_is_editor
      ELSE false
    END,
    CASE
      WHEN v_is_admin THEN true
      WHEN NOT v_read OR NOT v_group_open THEN false
      WHEN v_role IN ('lead', 'moderator', 'member') THEN true
      WHEN v_is_editor AND v_read THEN true
      ELSE false
    END,
    CASE
      WHEN v_is_admin THEN true
      WHEN NOT v_read OR NOT v_group_open THEN false
      WHEN v_role IN ('lead', 'moderator', 'member') THEN true
      WHEN v_is_editor AND v_read THEN true
      ELSE false
    END,
    (v_is_admin OR (v_read AND v_role IN ('lead', 'moderator'))),
    v_is_admin,
    (v_is_admin OR (v_read AND v_role = 'lead')),
    v_read,
    v_is_admin,
    v_role,
    v_reason;
END;
$$;
COMMENT ON FUNCTION public.club_capabilities(uuid, uuid, uuid) IS
  'JEDYNE zrodlo prawdy o dostepie. Parametr _user_id honorowany WYLACZNIE dla samego siebie albo dla staffu.';
REVOKE EXECUTE ON FUNCTION public.club_capabilities(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_capabilities(uuid, uuid, uuid)
  TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.club_set_role(
  p_club_id uuid, p_user_id uuid, p_role text, p_expires_at timestamptz DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_caps   record;
  v_target_role text;
  v_hit    integer;
BEGIN
  IF p_role NOT IN ('lead','moderator','member','observer') THEN
    RAISE EXCEPTION 'clubs: invalid club role %', p_role USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.clubs c WHERE c.id = p_club_id AND c.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_caps FROM public.club_capabilities(p_club_id, NULL, v_uid);
  IF p_role IN ('lead','moderator') AND NOT public.is_club_admin(v_uid) THEN
    RAISE EXCEPTION 'clubs: elevated role requires admin' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_club_admin(v_uid) OR v_caps.effective_role = 'lead') THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT m.role INTO v_target_role FROM public.club_members m
   WHERE m.club_id = p_club_id AND m.user_id = p_user_id;
  IF NOT public.is_club_admin(v_uid)
     AND COALESCE(v_target_role, 'member') IN ('lead','moderator') THEN
    RAISE EXCEPTION 'clubs: only an admin can change an elevated role'
      USING ERRCODE = '42501';
  END IF;
  UPDATE public.club_members
     SET role = p_role, role_expires_at = p_expires_at
   WHERE club_id = p_club_id AND user_id = p_user_id;
  GET DIAGNOSTICS v_hit = ROW_COUNT;
  IF v_hit = 0 THEN
    RETURN false;
  END IF;
  INSERT INTO public.club_moderation_log (
    tenant_id, club_id, moderator_id, action, target_type, target_id, reason
  ) VALUES (v_tenant, p_club_id, v_uid, 'role_change', 'member', p_user_id, p_role);
  RETURN true;
END;
$$;
COMMENT ON FUNCTION public.club_set_role(uuid, uuid, text, timestamptz) IS
  'Zmiana roli klubowej, skalowana po tenancie wolajacego.';
REVOKE EXECUTE ON FUNCTION public.club_set_role(uuid, uuid, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_set_role(uuid, uuid, text, timestamptz)
  TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.club_ban_member(
  p_club_id uuid, p_user_id uuid, p_banned boolean, p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_caps   record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.clubs c WHERE c.id = p_club_id AND c.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;
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
                              THEN NULLIF(btrim(COALESCE(p_reason, '')), '') ELSE NULL END
   WHERE club_id = p_club_id AND user_id = p_user_id;
  INSERT INTO public.club_moderation_log (
    tenant_id, club_id, moderator_id, action, target_type, target_id, reason
  ) VALUES (v_tenant, p_club_id, v_uid,
            CASE WHEN p_banned THEN 'ban' ELSE 'unban' END,
            'member', p_user_id, NULLIF(btrim(COALESCE(p_reason, '')), ''));
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.club_ban_member(uuid, uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_ban_member(uuid, uuid, boolean, text)
  TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.tg_user_invitations_enroll_club()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_club_id uuid;
  v_role    text;
BEGIN
  IF NEW.status <> 'accepted'::public.invitation_status
     OR (OLD.status IS NOT NULL AND OLD.status = 'accepted'::public.invitation_status) THEN
    RETURN NEW;
  END IF;
  IF NEW.auth_user_id IS NULL OR COALESCE(NEW.source, '') <> 'club' THEN
    RETURN NEW;
  END IF;
  v_club_id := NULLIF(NEW.metadata->>'club_id', '')::uuid;
  v_role    := COALESCE(NULLIF(NEW.metadata->>'club_role', ''), 'member');
  IF v_club_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF v_role NOT IN ('lead', 'moderator', 'member', 'observer') THEN
    v_role := 'member';
  END IF;
  INSERT INTO public.club_members (
    tenant_id, club_id, user_id, role, status, invited_by, invite_source
  )
  SELECT c.tenant_id, c.id, NEW.auth_user_id, v_role, 'active', NEW.invited_by, 'email'
    FROM public.clubs c
   WHERE c.id = v_club_id AND c.tenant_id = NEW.tenant_id
  ON CONFLICT (club_id, user_id) DO NOTHING;
  RETURN NEW;
END; $$;
DROP FUNCTION IF EXISTS public.admin_club_segment_preview(uuid, jsonb);
CREATE FUNCTION public.admin_club_segment_preview(p_club_id uuid, p_rule jsonb)
RETURNS TABLE (matched integer, already_member integer, blocked integer, will_send integer)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
  WITH guard AS (
    SELECT c.id AS club_id, c.tenant_id
      FROM public.clubs c
     WHERE c.id = p_club_id
       AND public.is_club_admin(auth.uid())
       AND c.tenant_id = public.current_tenant_id()
  ),
  cand AS (
    SELECT DISTINCT b.user_id FROM public.profile_badges b JOIN guard g ON true
      JOIN public.profiles p ON p.id = b.user_id AND p.tenant_id = g.tenant_id
     WHERE p_rule->>'kind' = 'badge' AND b.badge = p_rule->>'badge'
    UNION
    SELECT DISTINCT f.user_id FROM public.eu_policy_follows f JOIN guard g ON true
      JOIN public.profiles p ON p.id = f.user_id AND p.tenant_id = g.tenant_id
     WHERE p_rule->>'kind' = 'policy_follow'
       AND f.item_id = NULLIF(p_rule->>'item_id','')::uuid
    UNION
    SELECT DISTINCT r.user_id FROM public.event_rsvps r JOIN guard g ON true
      JOIN public.profiles p ON p.id = r.user_id AND p.tenant_id = g.tenant_id
     WHERE p_rule->>'kind' = 'event_rsvp'
       AND r.event_id = NULLIF(p_rule->>'event_id','')::uuid
       AND r.status IN ('going','interested')
    UNION
    SELECT DISTINCT m.user_id FROM public.club_members m JOIN guard g ON true
      JOIN public.clubs oc ON oc.id = m.club_id AND oc.tenant_id = g.tenant_id
     WHERE p_rule->>'kind' = 'other_club'
       AND m.club_id = NULLIF(p_rule->>'club_id','')::uuid AND m.status = 'active'
    UNION
    SELECT p.id FROM public.profiles p JOIN guard g ON p.tenant_id = g.tenant_id
     WHERE p_rule->>'kind' = 'specialization' AND p.discoverable
       AND lower(btrim(COALESCE(p.specialization,''))) = lower(btrim(COALESCE(p_rule->>'value','')))
  ),
  agg AS (
    SELECT
      count(*)::int AS matched,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM public.club_members m
         WHERE m.club_id = p_club_id AND m.user_id = cand.user_id
           AND m.status IN ('active','pending','invited','banned')))::int AS already_member,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM public.notification_preferences np
         WHERE np.user_id = cand.user_id AND np.enabled_club IS FALSE))::int AS blocked
    FROM cand
  )
  SELECT matched, already_member, blocked,
         GREATEST(matched - already_member - blocked, 0)
    FROM agg
$$;
COMMENT ON FUNCTION public.admin_club_segment_preview(uuid, jsonb) IS
  'Podglad liczebnosci segmentu PRZED wysylka.';
REVOKE EXECUTE ON FUNCTION public.admin_club_segment_preview(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_segment_preview(uuid, jsonb)
  TO authenticated, service_role;
DROP FUNCTION IF EXISTS public.admin_club_moderation_queue(uuid);
CREATE FUNCTION public.admin_club_moderation_queue(p_club_id uuid)
RETURNS TABLE (
  target_type text, target_id uuid, thread_slug text, title text,
  body text, author_name text, is_anonymous boolean, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH club AS (
    SELECT c.* FROM public.clubs c
     WHERE c.id = p_club_id
       AND public.is_club_admin(auth.uid())
       AND c.tenant_id = public.current_tenant_id()
  )
  SELECT 'thread'::text, t.id, t.slug, t.title, t.body,
         CASE WHEN t.is_anonymous
                OR COALESCE(g.attribution_mode, cl.attribution_mode) = 'chatham'
              THEN NULL
              ELSE COALESCE(NULLIF(btrim(p.display_name), ''), 'User') END,
         (t.is_anonymous OR COALESCE(g.attribution_mode, cl.attribution_mode) = 'chatham'),
         t.created_at
    FROM public.club_threads t
    JOIN club cl ON cl.id = t.club_id
    JOIN public.club_groups g ON g.id = t.group_id
    LEFT JOIN public.profiles p ON p.id = t.author_id
   WHERE t.status = 'pending'
  UNION ALL
  SELECT 'reply'::text, r.id, t.slug, t.title, r.body,
         CASE WHEN r.is_anonymous
                OR COALESCE(g.attribution_mode, cl.attribution_mode) = 'chatham'
              THEN NULL
              ELSE COALESCE(NULLIF(btrim(p.display_name), ''), 'User') END,
         (r.is_anonymous OR COALESCE(g.attribution_mode, cl.attribution_mode) = 'chatham'),
         r.created_at
    FROM public.club_replies r
    JOIN public.club_threads t ON t.id = r.thread_id
    JOIN club cl ON cl.id = r.club_id
    JOIN public.club_groups g ON g.id = t.group_id
    LEFT JOIN public.profiles p ON p.id = r.author_id
   WHERE r.status = 'pending'
  ORDER BY created_at ASC
$$;
COMMENT ON FUNCTION public.admin_club_moderation_queue(uuid) IS
  'Kolejka premoderacji. Autor wpisu anonimowego NIE jest tu ujawniany.';
REVOKE EXECUTE ON FUNCTION public.admin_club_moderation_queue(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_moderation_queue(uuid)
  TO authenticated, service_role;
DROP FUNCTION IF EXISTS public.admin_club_threads(uuid, uuid, text, text, text, integer, integer);
CREATE FUNCTION public.admin_club_threads(
  p_club_id  uuid,
  p_group_id uuid DEFAULT NULL,
  p_status   text DEFAULT NULL,
  p_kind     text DEFAULT NULL,
  p_search   text DEFAULT NULL,
  p_limit    integer DEFAULT 50,
  p_offset   integer DEFAULT 0
)
RETURNS TABLE (
  id uuid, slug text, title text, kind text, status text,
  group_id uuid, group_name_pl text, group_name_en text,
  author_id uuid, author_name text, posted_by_admin_name text,
  is_anonymous boolean, attribution_mode text,
  reply_count integer, participant_count integer, reaction_count integer,
  pinned_at timestamptz, locked_at timestamptz,
  last_reply_at timestamptz, created_at timestamptz,
  total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH rows AS (
    SELECT
      t.id, t.slug, t.title, t.kind, t.status,
      t.group_id, g.name_pl AS g_pl, g.name_en AS g_en,
      t.author_id,
      COALESCE(NULLIF(btrim(p.display_name), ''), 'User') AS a_name,
      NULLIF(btrim(pa.display_name), '') AS pb_name,
      t.is_anonymous,
      COALESCE(g.attribution_mode, c.attribution_mode) AS attr,
      t.reply_count, t.participant_count, t.reaction_count,
      t.pinned_at, t.locked_at, t.last_reply_at, t.created_at
    FROM public.club_threads t
    JOIN public.clubs c ON c.id = t.club_id
    JOIN public.club_groups g ON g.id = t.group_id
    LEFT JOIN public.profiles p ON p.id = t.author_id
    LEFT JOIN public.profiles pa ON pa.id = t.posted_by_admin_id
    WHERE t.club_id = p_club_id
      AND public.is_club_admin(auth.uid())
      AND c.tenant_id = public.current_tenant_id()
      AND (p_group_id IS NULL OR t.group_id = p_group_id)
      AND (p_status IS NULL OR t.status = p_status)
      AND (p_kind IS NULL OR t.kind = p_kind)
      AND (p_search IS NULL OR btrim(p_search) = ''
           OR t.title ILIKE '%' || btrim(p_search) || '%')
  )
  SELECT r.*, count(*) OVER () AS total_count
  FROM rows r
  ORDER BY (r.pinned_at IS NOT NULL) DESC,
           COALESCE(r.last_reply_at, r.created_at) DESC, r.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$$;
REVOKE EXECUTE ON FUNCTION public.admin_club_threads(uuid, uuid, text, text, text, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_threads(uuid, uuid, text, text, text, integer, integer)
  TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.club_subscribe_thread(p_thread_id uuid, p_state text)
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
  IF p_state NOT IN ('subscribed', 'muted') THEN
    RAISE EXCEPTION 'clubs: invalid subscription state %', p_state USING ERRCODE = '22023';
  END IF;
  SELECT t.club_id, t.group_id INTO v_club, v_group
    FROM public.club_threads t WHERE t.id = p_thread_id;
  IF v_club IS NULL THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_caps FROM public.club_capabilities(v_club, v_group, v_uid);
  IF NOT COALESCE(v_caps.can_read, false) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.club_thread_subscriptions (thread_id, user_id, state)
  VALUES (p_thread_id, v_uid, p_state)
  ON CONFLICT (thread_id, user_id) DO UPDATE SET state = EXCLUDED.state;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.club_subscribe_thread(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_subscribe_thread(uuid, text)
  TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.club_invite_quota_ok(_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := CASE WHEN public.is_club_admin(_user_id) THEN 200 ELSE 20 END;
  v_used  integer;
BEGIN
  SELECT
    (SELECT count(*) FROM public.club_invitations
      WHERE inviter_id = _user_id AND created_at > now() - interval '24 hours')
  + (SELECT count(*) FROM public.user_invitations
      WHERE invited_by = _user_id AND source = 'club'
        AND created_at > now() - interval '24 hours')
  INTO v_used;
  RETURN v_used < v_limit;
END;
$$;
COMMENT ON FUNCTION public.club_invite_quota_ok(uuid) IS
  'Dzienny limit zaproszen liczony przez OBIE sciezki - bezposrednia i e-mailowa.';
REVOKE EXECUTE ON FUNCTION public.club_invite_quota_ok(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_invite_quota_ok(uuid) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.club_thread_hotness(
  _quality_reactions integer, _reply_count integer, _participant_count integer,
  _stance_count integer, _created_at timestamptz
)
RETURNS numeric
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT (
    COALESCE(_quality_reactions, 0) * 3 + COALESCE(_reply_count, 0) * 2
    + COALESCE(_participant_count, 0) * 2 + COALESCE(_stance_count, 0)
  )::numeric
  / power(GREATEST(EXTRACT(EPOCH FROM (now() - _created_at)) / 3600.0, 0) + 2, 1.5);
$$;
REVOKE EXECUTE ON FUNCTION public.club_thread_hotness(integer, integer, integer, integer, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_thread_hotness(integer, integer, integer, integer, timestamptz)
  TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.club_thread_quality_score(_thread_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int
    FROM public.club_reactions r
   WHERE r.kind IN ('insightful', 'evidence')
     AND (
       (r.target_type = 'thread' AND r.target_id = _thread_id)
       OR (r.target_type = 'reply' AND r.target_id IN
           (SELECT id FROM public.club_replies WHERE thread_id = _thread_id))
     )
$$;
REVOKE EXECUTE ON FUNCTION public.club_thread_quality_score(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_thread_quality_score(uuid) TO authenticated, service_role;