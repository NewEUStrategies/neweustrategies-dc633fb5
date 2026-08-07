CREATE OR REPLACE FUNCTION public.is_club_admin(_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL
     AND (public.has_role(_user_id, 'admin')
          OR public.has_role(_user_id, 'super_admin'));
$$;
COMMENT ON FUNCTION public.is_club_admin(uuid) IS
  'Bramka struktury Discussion Club: admin LUB super_admin. Inwariant super_admin >= admin - nigdy nie rozwijac inline (lekcja profiles_guard_verification, audyt 2026-08-06).';
REVOKE EXECUTE ON FUNCTION public.is_club_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_club_admin(uuid) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.clubs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug              text NOT NULL,
  name_pl           text NOT NULL,
  name_en           text NOT NULL,
  tagline_pl        text,
  tagline_en        text,
  description_pl    text,
  description_en    text,
  icon              text NOT NULL DEFAULT 'MessagesSquare',
  accent_color      text,
  cover_image_url   text,
  visibility        text NOT NULL DEFAULT 'members'
                    CHECK (visibility IN ('public', 'members', 'private', 'secret')),
  join_policy       text NOT NULL DEFAULT 'request'
                    CHECK (join_policy IN ('open', 'request', 'invite')),
  min_tier_rank     integer NOT NULL DEFAULT 0 CHECK (min_tier_rank >= 0),
  attribution_mode  text NOT NULL DEFAULT 'attributed'
                    CHECK (attribution_mode IN ('attributed', 'chatham', 'anonymous_allowed')),
  who_can_post      text NOT NULL DEFAULT 'moderators'
                    CHECK (who_can_post IN ('members', 'moderators', 'staff_only')),
  moderation_mode   text NOT NULL DEFAULT 'trusted'
                    CHECK (moderation_mode IN ('post', 'pre', 'trusted')),
  policy_area       text,
  rules_pl          text,
  rules_en          text,
  status            text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'active', 'archived')),
  member_count      integer NOT NULL DEFAULT 0,
  group_count       integer NOT NULL DEFAULT 0,
  thread_count      integer NOT NULL DEFAULT 0,
  last_activity_at  timestamptz,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clubs_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT clubs_name_pl_len CHECK (char_length(btrim(name_pl)) BETWEEN 2 AND 120),
  CONSTRAINT clubs_name_en_len CHECK (char_length(btrim(name_en)) BETWEEN 2 AND 120)
);
CREATE UNIQUE INDEX IF NOT EXISTS clubs_tenant_slug_key
  ON public.clubs (tenant_id, slug);
CREATE INDEX IF NOT EXISTS clubs_tenant_status_idx
  ON public.clubs (tenant_id, status, visibility);
CREATE INDEX IF NOT EXISTS clubs_tenant_activity_idx
  ON public.clubs (tenant_id, last_activity_at DESC NULLS LAST);
COMMENT ON TABLE public.clubs IS
  'Discussion Club: przestrzen z czlonkostwem. RPC-only (brak grantow klienta). Widocznosc i polityka wstepu to osobne osie.';
COMMENT ON COLUMN public.clubs.who_can_post IS
  'Kto zaklada temat. Domyslnie moderators - przejscie na members jest decyzja produktowa, nie zmiana architektury (V2 par. 0).';
COMMENT ON COLUMN public.clubs.attribution_mode IS
  'attributed | chatham (regula Chatham House) | anonymous_allowed. Egzekwowane w warstwie projekcji, nie w interfejsie (etap A3+).';

CREATE TABLE IF NOT EXISTS public.club_groups (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  club_id           uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  slug              text NOT NULL,
  name_pl           text NOT NULL,
  name_en           text NOT NULL,
  description_pl    text,
  description_en    text,
  icon              text,
  accent_color      text,
  sort_order        integer NOT NULL DEFAULT 0,
  visibility        text CHECK (visibility IN ('members', 'private', 'secret')),
  who_can_post      text CHECK (who_can_post IN ('members', 'moderators', 'staff_only')),
  moderation_mode   text CHECK (moderation_mode IN ('post', 'pre', 'trusted')),
  min_tier_rank     integer CHECK (min_tier_rank IS NULL OR min_tier_rank >= 0),
  attribution_mode  text CHECK (attribution_mode IN ('attributed', 'chatham', 'anonymous_allowed')),
  opens_at          timestamptz,
  closes_at         timestamptz,
  status            text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'scheduled', 'active', 'frozen', 'archived')),
  anchor_type       text CHECK (anchor_type IN ('eu_policy_item', 'post', 'event', 'research_program')),
  anchor_id         text,
  thread_count      integer NOT NULL DEFAULT 0,
  last_activity_at  timestamptz,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT club_groups_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT club_groups_name_pl_len CHECK (char_length(btrim(name_pl)) BETWEEN 2 AND 120),
  CONSTRAINT club_groups_name_en_len CHECK (char_length(btrim(name_en)) BETWEEN 2 AND 120),
  CONSTRAINT club_groups_window_sane CHECK (opens_at IS NULL OR closes_at IS NULL OR closes_at > opens_at),
  CONSTRAINT club_groups_anchor_pair CHECK ((anchor_type IS NULL) = (anchor_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS club_groups_club_slug_key
  ON public.club_groups (club_id, slug);
CREATE INDEX IF NOT EXISTS club_groups_club_order_idx
  ON public.club_groups (club_id, sort_order, created_at);
CREATE INDEX IF NOT EXISTS club_groups_tenant_idx
  ON public.club_groups (tenant_id, club_id);
CREATE INDEX IF NOT EXISTS club_groups_anchor_idx
  ON public.club_groups (anchor_type, anchor_id) WHERE anchor_id IS NOT NULL;
COMMENT ON TABLE public.club_groups IS
  'Dzial tematyczny wewnatrz klubu. NULL w kolumnie ustawienia = dziedzicz z klubu (jawna deklaracja, nie brak danych).';

CREATE TABLE IF NOT EXISTS public.club_members (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  club_id           uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role              text NOT NULL DEFAULT 'member'
                    CHECK (role IN ('lead', 'moderator', 'member', 'observer')),
  status            text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'pending', 'invited', 'banned', 'left')),
  notify_level      text NOT NULL DEFAULT 'digest'
                    CHECK (notify_level IN ('all', 'mentions', 'digest', 'none')),
  role_expires_at   timestamptz,
  rules_accepted_at timestamptz,
  invited_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invite_source     text NOT NULL DEFAULT 'direct'
                    CHECK (invite_source IN ('direct', 'email', 'link', 'segment', 'auto', 'self')),
  banned_reason     text,
  joined_at         timestamptz NOT NULL DEFAULT now(),
  last_read_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT club_members_club_user_key UNIQUE (club_id, user_id)
);
CREATE INDEX IF NOT EXISTS club_members_user_active_idx
  ON public.club_members (user_id, status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS club_members_club_role_idx
  ON public.club_members (club_id, status, role);
CREATE INDEX IF NOT EXISTS club_members_tenant_idx
  ON public.club_members (tenant_id, club_id);
CREATE INDEX IF NOT EXISTS club_members_role_expiry_idx
  ON public.club_members (role_expires_at) WHERE role_expires_at IS NOT NULL;
COMMENT ON TABLE public.club_members IS
  'Czlonkostwo w klubie. Rola klubowa to OSOBNA os od public.app_role - nigdy ich nie mieszac (V2 par. 3.2).';
COMMENT ON COLUMN public.club_members.role_expires_at IS
  'Kadencja roli. Czytana przy kazdym wyliczeniu zdolnosci, nie tylko przez job - wygasla rola nie daje uprawnien nawet zanim job ja sprzatnie.';

ALTER TABLE public.clubs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_groups  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clubs        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.club_groups  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.club_members FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.clubs        TO service_role;
GRANT ALL ON public.club_groups  TO service_role;
GRANT ALL ON public.club_members TO service_role;

CREATE OR REPLACE FUNCTION public.clubs_pin_tenant()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.tenant_id := OLD.tenant_id;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS clubs_pin_tenant_tg ON public.clubs;
CREATE TRIGGER clubs_pin_tenant_tg
  BEFORE UPDATE ON public.clubs
  FOR EACH ROW EXECUTE FUNCTION public.clubs_pin_tenant();

CREATE OR REPLACE FUNCTION public.club_child_pin_tenant()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT c.tenant_id INTO v_tenant FROM public.clubs c WHERE c.id = NEW.club_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'clubs: unknown club %', NEW.club_id USING ERRCODE = '23503';
  END IF;
  NEW.tenant_id := v_tenant;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS club_groups_pin_tenant_tg ON public.club_groups;
CREATE TRIGGER club_groups_pin_tenant_tg
  BEFORE INSERT OR UPDATE ON public.club_groups
  FOR EACH ROW EXECUTE FUNCTION public.club_child_pin_tenant();
DROP TRIGGER IF EXISTS club_members_pin_tenant_tg ON public.club_members;
CREATE TRIGGER club_members_pin_tenant_tg
  BEFORE INSERT OR UPDATE ON public.club_members
  FOR EACH ROW EXECUTE FUNCTION public.club_child_pin_tenant();

DROP TRIGGER IF EXISTS clubs_set_updated_tg ON public.clubs;
CREATE TRIGGER clubs_set_updated_tg BEFORE UPDATE ON public.clubs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS club_groups_set_updated_tg ON public.club_groups;
CREATE TRIGGER club_groups_set_updated_tg BEFORE UPDATE ON public.club_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS club_members_set_updated_tg ON public.club_members;
CREATE TRIGGER club_members_set_updated_tg BEFORE UPDATE ON public.club_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.club_members_sync_count()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_club uuid := COALESCE(NEW.club_id, OLD.club_id);
BEGIN
  UPDATE public.clubs c
     SET member_count = (
           SELECT count(*)::int FROM public.club_members m
            WHERE m.club_id = v_club AND m.status = 'active'
         )
   WHERE c.id = v_club;
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS club_members_sync_count_tg ON public.club_members;
CREATE TRIGGER club_members_sync_count_tg
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.club_members
  FOR EACH ROW EXECUTE FUNCTION public.club_members_sync_count();

CREATE OR REPLACE FUNCTION public.club_groups_sync_count()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_club uuid := COALESCE(NEW.club_id, OLD.club_id);
BEGIN
  UPDATE public.clubs c
     SET group_count = (
           SELECT count(*)::int FROM public.club_groups g
            WHERE g.club_id = v_club AND g.status <> 'archived'
         )
   WHERE c.id = v_club;
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS club_groups_sync_count_tg ON public.club_groups;
CREATE TRIGGER club_groups_sync_count_tg
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.club_groups
  FOR EACH ROW EXECUTE FUNCTION public.club_groups_sync_count();

CREATE OR REPLACE FUNCTION public.club_effective_member_role(
  _role text, _role_expires_at timestamptz
)
RETURNS text
LANGUAGE sql IMMUTABLE
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
  'Rola po uwzglednieniu kadencji. Wygasla rola podniesiona spada do member natychmiast, nie po przebiegu joba.';
REVOKE EXECUTE ON FUNCTION public.club_effective_member_role(text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_effective_member_role(text, timestamptz)
  TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.club_capabilities(uuid, uuid, uuid);
CREATE FUNCTION public.club_capabilities(
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
  v_is_admin    boolean := public.is_club_admin(_user_id);
  v_is_editor   boolean := _user_id IS NOT NULL AND public.has_role(_user_id, 'editor');
  v_home_tenant uuid;
  v_role        text;
  v_visibility  text;
  v_who_can_post text;
  v_min_tier    integer;
  v_reason      text := NULL;
  v_read        boolean := false;
  v_group_open  boolean := true;
BEGIN
  SELECT * INTO v_club FROM public.clubs WHERE id = _club_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                        'non_member'::text, 'not_found'::text;
    RETURN;
  END IF;
  SELECT p.tenant_id INTO v_home_tenant FROM public.profiles p WHERE p.id = _user_id;
  IF _user_id IS NULL THEN
    IF v_club.visibility = 'public' AND v_club.status = 'active' THEN
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
    SELECT * INTO v_group FROM public.club_groups
     WHERE id = _group_id AND club_id = _club_id;
    IF NOT FOUND THEN
      RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                          'non_member'::text, 'not_found'::text;
      RETURN;
    END IF;
  END IF;
  SELECT * INTO v_member FROM public.club_members
   WHERE club_id = _club_id AND user_id = _user_id;
  IF FOUND AND v_member.status = 'banned' THEN
    RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                        'banned'::text, 'banned'::text;
    RETURN;
  END IF;
  v_role := CASE
    WHEN v_member.id IS NULL OR v_member.status <> 'active' THEN 'non_member'
    ELSE public.club_effective_member_role(v_member.role, v_member.role_expires_at)
  END;
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
    IF NOT public.has_tier_rank(v_min_tier) THEN
      RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                          v_role, 'tier_too_low'::text;
      RETURN;
    END IF;
  END IF;
  v_read := CASE
    WHEN v_is_admin THEN true
    WHEN v_role <> 'non_member' THEN true
    WHEN v_visibility = 'public'  THEN v_club.status = 'active'
    WHEN v_visibility = 'members' THEN v_club.status = 'active'
    WHEN v_visibility = 'private' THEN false
    ELSE false
  END;
  IF NOT v_read AND v_reason IS NULL THEN
    v_reason := CASE
      WHEN v_visibility = 'secret' THEN 'not_found'
      WHEN v_club.status = 'draft' THEN 'not_open_yet'
      WHEN v_club.status = 'archived' THEN 'archived'
      ELSE 'not_member'
    END;
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
  'JEDYNE zrodlo prawdy o dostepie do klubu/grupy. Kazdy RPC modulu wola ta funkcje - zadnej bramki nie pisze sie inline. Pole reason zasila UI kodem powodu (not_member, tier_too_low, group_frozen, banned, pre_moderation, not_open_yet, window_closed, archived, auth_required, not_found).';
REVOKE EXECUTE ON FUNCTION public.club_capabilities(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_capabilities(uuid, uuid, uuid)
  TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.club_list();
CREATE FUNCTION public.club_list()
RETURNS TABLE (
  id uuid, slug text, name_pl text, name_en text,
  tagline_pl text, tagline_en text, icon text, accent_color text,
  cover_image_url text, visibility text, join_policy text,
  min_tier_rank integer, policy_area text, status text,
  member_count integer, group_count integer, thread_count integer,
  last_activity_at timestamptz,
  my_role text, my_status text, can_read boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT p.id AS uid, p.tenant_id
      FROM public.profiles p WHERE p.id = auth.uid()
  ),
  scope AS (
    SELECT COALESCE((SELECT tenant_id FROM me), public.public_tenant_id()) AS tenant_id
  )
  SELECT
    c.id, c.slug, c.name_pl, c.name_en,
    c.tagline_pl, c.tagline_en, c.icon, c.accent_color,
    c.cover_image_url, c.visibility, c.join_policy,
    c.min_tier_rank, c.policy_area, c.status,
    c.member_count, c.group_count, c.thread_count,
    c.last_activity_at,
    public.club_effective_member_role(m.role, m.role_expires_at) AS my_role,
    m.status AS my_status,
    cap.can_read
  FROM public.clubs c
  CROSS JOIN scope s
  LEFT JOIN public.club_members m
    ON m.club_id = c.id AND m.user_id = auth.uid() AND m.status = 'active'
  CROSS JOIN LATERAL public.club_capabilities(c.id, NULL, auth.uid()) cap
  WHERE c.tenant_id = s.tenant_id
    AND c.status = 'active'
    AND (
      c.visibility IN ('public', 'members', 'private')
      OR cap.can_read
    )
    AND (auth.uid() IS NOT NULL OR c.visibility = 'public')
  ORDER BY
    (m.user_id IS NOT NULL) DESC,
    c.last_activity_at DESC NULLS LAST,
    lower(c.name_pl) ASC
$$;
COMMENT ON FUNCTION public.club_list() IS
  'Kluby widoczne dla wolajacego. private = karta bez tresci, secret = niewidoczny dla obcych. Widocznosc liczy club_capabilities, nie ta funkcja.';
REVOKE EXECUTE ON FUNCTION public.club_list() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_list() TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.club_view(text);
CREATE FUNCTION public.club_view(p_slug text)
RETURNS TABLE (
  id uuid, slug text, name_pl text, name_en text,
  tagline_pl text, tagline_en text, description_pl text, description_en text,
  rules_pl text, rules_en text,
  icon text, accent_color text, cover_image_url text,
  visibility text, join_policy text, min_tier_rank integer,
  attribution_mode text, who_can_post text, moderation_mode text,
  policy_area text, status text,
  member_count integer, group_count integer, thread_count integer,
  last_activity_at timestamptz, created_at timestamptz,
  my_role text, my_status text, rules_accepted_at timestamptz,
  can_read boolean, can_post_thread boolean, can_reply boolean,
  can_moderate boolean, can_manage boolean, can_invite boolean,
  can_see_members boolean, reason text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH scope AS (
    SELECT COALESCE(
      (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()),
      public.public_tenant_id()
    ) AS tenant_id
  ),
  target AS (
    SELECT c.* FROM public.clubs c CROSS JOIN scope s
     WHERE c.tenant_id = s.tenant_id AND c.slug = p_slug
  )
  SELECT
    t.id, t.slug, t.name_pl, t.name_en,
    t.tagline_pl, t.tagline_en, t.description_pl, t.description_en,
    t.rules_pl, t.rules_en,
    t.icon, t.accent_color, t.cover_image_url,
    t.visibility, t.join_policy, t.min_tier_rank,
    t.attribution_mode, t.who_can_post, t.moderation_mode,
    t.policy_area, t.status,
    t.member_count, t.group_count, t.thread_count,
    t.last_activity_at, t.created_at,
    public.club_effective_member_role(m.role, m.role_expires_at) AS my_role,
    m.status AS my_status,
    m.rules_accepted_at,
    cap.can_read, cap.can_post_thread, cap.can_reply,
    cap.can_moderate, cap.can_manage, cap.can_invite,
    cap.can_see_members, cap.reason
  FROM target t
  LEFT JOIN public.club_members m
    ON m.club_id = t.id AND m.user_id = auth.uid()
  CROSS JOIN LATERAL public.club_capabilities(t.id, NULL, auth.uid()) cap
  WHERE cap.can_read OR t.visibility IN ('public', 'members', 'private')
$$;
COMMENT ON FUNCTION public.club_view(text) IS
  'Karta klubu po slugu wraz z pelnym zestawem zdolnosci wolajacego. Secret bez dostepu zwraca zero wierszy (404, nie 403).';
REVOKE EXECUTE ON FUNCTION public.club_view(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_view(text) TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.club_groups_list(uuid);
CREATE FUNCTION public.club_groups_list(p_club_id uuid)
RETURNS TABLE (
  id uuid, club_id uuid, slug text, name_pl text, name_en text,
  description_pl text, description_en text, icon text, accent_color text,
  sort_order integer, status text,
  opens_at timestamptz, closes_at timestamptz,
  anchor_type text, anchor_id text,
  thread_count integer, last_activity_at timestamptz,
  visibility text, visibility_inherited boolean,
  who_can_post text, who_can_post_inherited boolean,
  moderation_mode text, moderation_mode_inherited boolean,
  min_tier_rank integer, min_tier_rank_inherited boolean,
  attribution_mode text, attribution_mode_inherited boolean,
  can_read boolean, can_post_thread boolean, reason text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    g.id, g.club_id, g.slug, g.name_pl, g.name_en,
    g.description_pl, g.description_en, g.icon, g.accent_color,
    g.sort_order, g.status,
    g.opens_at, g.closes_at,
    g.anchor_type, g.anchor_id,
    g.thread_count, g.last_activity_at,
    COALESCE(g.visibility, c.visibility),          (g.visibility IS NULL),
    COALESCE(g.who_can_post, c.who_can_post),      (g.who_can_post IS NULL),
    COALESCE(g.moderation_mode, c.moderation_mode),(g.moderation_mode IS NULL),
    COALESCE(g.min_tier_rank, c.min_tier_rank),    (g.min_tier_rank IS NULL),
    COALESCE(g.attribution_mode, c.attribution_mode), (g.attribution_mode IS NULL),
    cap.can_read, cap.can_post_thread, cap.reason
  FROM public.club_groups g
  JOIN public.clubs c ON c.id = g.club_id
  CROSS JOIN LATERAL public.club_capabilities(g.club_id, g.id, auth.uid()) cap
  WHERE g.club_id = p_club_id
    AND cap.can_read
    AND (g.status NOT IN ('draft', 'archived') OR cap.can_manage)
  ORDER BY g.sort_order ASC, g.created_at ASC
$$;
COMMENT ON FUNCTION public.club_groups_list(uuid) IS
  'Grupy klubu z ROZWIAZANYM dziedziczeniem: kolumna wartosci efektywnej + flaga *_inherited. Regula dziedziczenia zyje w bazie, nie w kliencie.';
REVOKE EXECUTE ON FUNCTION public.club_groups_list(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_groups_list(uuid) TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.club_my_memberships();
CREATE FUNCTION public.club_my_memberships()
RETURNS TABLE (
  club_id uuid, slug text, name_pl text, name_en text, icon text,
  accent_color text, role text, status text, notify_level text,
  role_expires_at timestamptz, last_read_at timestamptz,
  member_count integer, thread_count integer, last_activity_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id, c.slug, c.name_pl, c.name_en, c.icon, c.accent_color,
    public.club_effective_member_role(m.role, m.role_expires_at),
    m.status, m.notify_level, m.role_expires_at, m.last_read_at,
    c.member_count, c.thread_count, c.last_activity_at
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
  'Kluby wolajacego (aktywne, oczekujace, zaproszenia) - jedno zapytanie dla nawigacji.';
REVOKE EXECUTE ON FUNCTION public.club_my_memberships() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_my_memberships() TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.club_members_list(uuid, text, integer, integer);
CREATE FUNCTION public.club_members_list(
  p_club_id uuid,
  p_status text DEFAULT 'active',
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  user_id uuid, display_name text, avatar_url text, slug text,
  job_title text, current_company text, verified boolean,
  role text, status text, joined_at timestamptz,
  role_expires_at timestamptz, invite_source text, total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH cap AS (
    SELECT * FROM public.club_capabilities(p_club_id, NULL, auth.uid())
  ),
  rows AS (
    SELECT
      m.user_id,
      COALESCE(
        NULLIF(btrim(p.display_name), ''),
        NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
        'User'
      ) AS display_name,
      CASE WHEN p.hide_avatar THEN NULL ELSE p.avatar_url END AS avatar_url,
      p.slug, p.job_title, p.current_company,
      (p.verified_at IS NOT NULL) AS verified,
      public.club_effective_member_role(m.role, m.role_expires_at) AS role,
      m.status, m.joined_at, m.role_expires_at, m.invite_source
    FROM public.club_members m
    JOIN public.profiles p ON p.id = m.user_id
    JOIN public.clubs c ON c.id = m.club_id
    CROSS JOIN cap
    WHERE m.club_id = p_club_id
      AND cap.can_see_members
      AND p.tenant_id = c.tenant_id
      AND (p_status IS NULL OR m.status = p_status)
      AND (p.discoverable OR cap.can_manage OR m.user_id = auth.uid())
  )
  SELECT r.*, count(*) OVER () AS total_count
  FROM rows r
  ORDER BY
    CASE r.role WHEN 'lead' THEN 0 WHEN 'moderator' THEN 1
                WHEN 'member' THEN 2 ELSE 3 END,
    lower(r.display_name) ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$$;
COMMENT ON FUNCTION public.club_members_list(uuid, text, integer, integer) IS
  'Czlonkowie klubu z paginacja i total_count w tym samym wierszu (bez drugiego zapytania). Respektuje discoverable - zarzadzajacy widzi komplet.';
REVOKE EXECUTE ON FUNCTION public.club_members_list(uuid, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_members_list(uuid, text, integer, integer)
  TO authenticated, service_role;