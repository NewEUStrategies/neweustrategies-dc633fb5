ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS cover_position_y smallint NOT NULL DEFAULT 50 CHECK (cover_position_y BETWEEN 0 AND 100);

DROP FUNCTION IF EXISTS public.club_view(text);
CREATE OR REPLACE FUNCTION public.club_view(p_slug text)
 RETURNS TABLE(id uuid, slug text, name_pl text, name_en text, tagline_pl text, tagline_en text, description_pl text, description_en text, rules_pl text, rules_en text, icon text, accent_color text, cover_image_url text, cover_position_y smallint, visibility text, join_policy text, min_tier_rank integer, attribution_mode text, who_can_post text, moderation_mode text, policy_area text, status text, layout text, member_count integer, group_count integer, thread_count integer, last_activity_at timestamp with time zone, created_at timestamp with time zone, my_role text, my_status text, rules_accepted_at timestamp with time zone, can_read boolean, can_post_thread boolean, can_reply boolean, can_moderate boolean, can_manage boolean, can_invite boolean, can_see_members boolean, reason text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH scope AS (SELECT COALESCE((SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()), public.public_tenant_id()) AS tenant_id),
  found AS (SELECT c.* FROM public.clubs c CROSS JOIN scope s WHERE c.slug = p_slug AND c.tenant_id = s.tenant_id)
  SELECT f.id, f.slug, f.name_pl, f.name_en, f.tagline_pl, f.tagline_en, f.description_pl, f.description_en, f.rules_pl, f.rules_en, f.icon, f.accent_color, f.cover_image_url, f.cover_position_y, f.visibility, f.join_policy, f.min_tier_rank, f.attribution_mode, f.who_can_post, f.moderation_mode, f.policy_area, f.status, f.layout, f.member_count, f.group_count, f.thread_count, f.last_activity_at, f.created_at, public.club_effective_member_role(m.role, m.role_expires_at), m.status, m.rules_accepted_at, cap.can_read, cap.can_post_thread, cap.can_reply, cap.can_moderate, cap.can_manage, cap.can_invite, cap.can_see_members, cap.reason
  FROM found f LEFT JOIN public.club_members m ON m.club_id = f.id AND m.user_id = auth.uid() CROSS JOIN LATERAL public.club_capabilities(f.id, NULL, auth.uid()) cap WHERE cap.reason IS DISTINCT FROM 'not_found'
$function$;

DROP FUNCTION IF EXISTS public.club_list(integer, integer);
CREATE OR REPLACE FUNCTION public.club_list(p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, slug text, name_pl text, name_en text, tagline_pl text, tagline_en text, icon text, accent_color text, cover_image_url text, cover_position_y smallint, visibility text, join_policy text, min_tier_rank integer, policy_area text, status text, member_count integer, group_count integer, thread_count integer, last_activity_at timestamp with time zone, my_role text, my_status text, can_read boolean, total_count bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH me AS (SELECT p.id AS uid, p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()),
  scope AS (SELECT COALESCE((SELECT tenant_id FROM me), public.public_tenant_id()) AS tenant_id),
  visible AS (
    SELECT c.id, c.slug, c.name_pl, c.name_en, c.tagline_pl, c.tagline_en, c.icon, c.accent_color, c.cover_image_url, c.cover_position_y, c.visibility, c.join_policy, c.min_tier_rank, c.policy_area, c.status, c.member_count, c.group_count, c.thread_count, c.last_activity_at, public.club_effective_member_role(m.role, m.role_expires_at) AS my_role, m.status AS my_status, cap.can_read, (m.user_id IS NOT NULL) AS is_mine
    FROM public.clubs c CROSS JOIN scope s LEFT JOIN public.club_members m ON m.club_id = c.id AND m.user_id = auth.uid() AND m.status = 'active' CROSS JOIN LATERAL public.club_capabilities(c.id, NULL, auth.uid()) cap
    WHERE c.tenant_id = s.tenant_id AND c.status = 'active' AND (c.visibility IN ('public', 'members', 'private') OR cap.can_read) AND (auth.uid() IS NOT NULL OR c.visibility = 'public')
  )
  SELECT v.id, v.slug, v.name_pl, v.name_en, v.tagline_pl, v.tagline_en, v.icon, v.accent_color, v.cover_image_url, v.cover_position_y, v.visibility, v.join_policy, v.min_tier_rank, v.policy_area, v.status, v.member_count, v.group_count, v.thread_count, v.last_activity_at, v.my_role, v.my_status, v.can_read, count(*) OVER () AS total_count
  FROM visible v ORDER BY v.is_mine DESC, v.last_activity_at DESC NULLS LAST, lower(v.name_pl) ASC LIMIT GREATEST(COALESCE(p_limit, 100), 1) OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$function$;

DROP FUNCTION IF EXISTS public.club_list_by_specialization(text, integer, integer);
CREATE OR REPLACE FUNCTION public.club_list_by_specialization(p_slug text, p_limit integer DEFAULT 60, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, slug text, name_pl text, name_en text, tagline_pl text, tagline_en text, icon text, accent_color text, cover_image_url text, cover_position_y smallint, visibility text, join_policy text, min_tier_rank integer, policy_area text, specialization_slug text, status text, member_count integer, group_count integer, thread_count integer, last_activity_at timestamp with time zone, my_role text, my_status text, can_read boolean, total_count bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH scope AS (SELECT COALESCE(public._caller_tenant(), public.public_tenant_id()) AS tenant_id),
  visible AS (
    SELECT c.id, c.slug, c.name_pl, c.name_en, c.tagline_pl, c.tagline_en, c.icon, c.accent_color, c.cover_image_url, c.cover_position_y, c.visibility, c.join_policy, c.min_tier_rank, c.policy_area, c.specialization_slug, c.status, c.member_count, c.group_count, c.thread_count, c.last_activity_at, public.club_effective_member_role(m.role, m.role_expires_at) AS my_role, m.status AS my_status, cap.can_read, (m.user_id IS NOT NULL) AS is_mine
    FROM public.clubs c CROSS JOIN scope s LEFT JOIN public.club_members m ON m.club_id = c.id AND m.user_id = auth.uid() AND m.status = 'active' CROSS JOIN LATERAL public.club_capabilities(c.id, NULL, auth.uid()) cap
    WHERE c.tenant_id = s.tenant_id AND c.status = 'active' AND c.specialization_slug = btrim(p_slug) AND (auth.uid() IS NOT NULL OR c.visibility = 'public')
  )
  SELECT v.id, v.slug, v.name_pl, v.name_en, v.tagline_pl, v.tagline_en, v.icon, v.accent_color, v.cover_image_url, v.cover_position_y, v.visibility, v.join_policy, v.min_tier_rank, v.policy_area, v.specialization_slug, v.status, v.member_count, v.group_count, v.thread_count, v.last_activity_at, v.my_role, v.my_status, v.can_read, count(*) OVER () AS total_count
  FROM visible v ORDER BY v.is_mine DESC, v.last_activity_at DESC NULLS LAST, lower(v.name_pl) ASC LIMIT GREATEST(COALESCE(p_limit, 60), 1) OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$function$;

DROP FUNCTION IF EXISTS public.club_activity_feed(integer, text, text, integer);
CREATE OR REPLACE FUNCTION public.club_activity_feed(p_limit integer DEFAULT 12, p_sort text DEFAULT 'new'::text, p_policy_area text DEFAULT NULL::text, p_per_club integer DEFAULT 3)
 RETURNS TABLE(thread_id uuid, thread_slug text, title text, kind text, status text, excerpt text, club_id uuid, club_slug text, club_name_pl text, club_name_en text, club_policy_area text, club_cover_image_url text, club_cover_position_y smallint, group_name_pl text, group_name_en text, is_anonymous boolean, author_name text, author_alias text, reply_count integer, participant_count integer, last_reply_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH lim AS (SELECT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 30) AS n, LEAST(GREATEST(COALESCE(p_per_club, 3), 1), 10) AS per_club),
  scope AS (SELECT COALESCE((SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()), public.public_tenant_id()) AS tenant_id),
  candidate AS (SELECT c.id, c.slug, c.name_pl, c.name_en, c.policy_area, c.cover_image_url, c.cover_position_y, c.attribution_mode FROM public.clubs c CROSS JOIN scope s LEFT JOIN public.club_members m ON m.club_id = c.id AND m.user_id = auth.uid() AND m.status = 'active' WHERE c.tenant_id = s.tenant_id AND c.status = 'active' AND (p_policy_area IS NULL OR c.policy_area = p_policy_area) AND (c.visibility <> 'secret' OR m.user_id IS NOT NULL OR public.is_club_admin(auth.uid())) ORDER BY c.last_activity_at DESC NULLS LAST LIMIT 50),
  readable AS (SELECT c.id AS club_id, c.slug AS club_slug, c.name_pl AS club_pl, c.name_en AS club_en, c.policy_area, c.cover_image_url, c.cover_position_y, g.id AS group_id, g.name_pl AS group_pl, g.name_en AS group_en, COALESCE(g.attribution_mode, c.attribution_mode) AS attribution FROM candidate c JOIN public.club_groups g ON g.club_id = c.id CROSS JOIN LATERAL public.club_capabilities(c.id, g.id, auth.uid()) cap WHERE cap.can_read AND (g.status NOT IN ('draft', 'archived') OR cap.can_manage)),
  picked AS (SELECT r.*, t.id AS t_id, t.slug AS t_slug, t.title, t.kind, t.status, t.body, t.is_anonymous, t.author_id, t.reply_count, t.participant_count, t.last_reply_at, t.created_at, t.hotness FROM readable r CROSS JOIN lim JOIN LATERAL (SELECT t.* FROM public.club_threads t WHERE t.group_id = r.group_id AND t.status IN ('open', 'resolved', 'dormant', 'locked') ORDER BY CASE WHEN p_sort = 'hot' THEN t.hotness END DESC NULLS LAST, CASE WHEN p_sort = 'hot' THEN NULL ELSE COALESCE(t.last_reply_at, t.created_at) END DESC NULLS LAST, t.id DESC LIMIT lim.per_club) t ON true),
  ranked AS (SELECT k.*, row_number() OVER (PARTITION BY k.club_id ORDER BY CASE WHEN p_sort = 'hot' THEN k.hotness END DESC NULLS LAST, CASE WHEN p_sort = 'hot' THEN NULL ELSE COALESCE(k.last_reply_at, k.created_at) END DESC NULLS LAST, k.t_id DESC) AS rn FROM picked k)
  SELECT k.t_id, k.t_slug, k.title, k.kind, k.status, left(k.body, 200), k.club_id, k.club_slug, k.club_pl, k.club_en, k.policy_area, k.cover_image_url, k.cover_position_y, k.group_pl, k.group_en, k.is_anonymous,
    CASE WHEN k.is_anonymous OR k.attribution = 'chatham' THEN NULL ELSE COALESCE(NULLIF(btrim(p.display_name), ''), NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'User') END,
    CASE WHEN k.is_anonymous OR k.attribution = 'chatham' THEN public.club_author_alias(k.t_id, k.author_id) ELSE NULL END,
    k.reply_count, k.participant_count, k.last_reply_at, k.created_at
  FROM ranked k LEFT JOIN public.profiles p ON p.id = k.author_id WHERE k.rn <= (SELECT per_club FROM lim) ORDER BY CASE WHEN p_sort = 'hot' THEN k.hotness END DESC NULLS LAST, CASE WHEN p_sort = 'hot' THEN NULL ELSE COALESCE(k.last_reply_at, k.created_at) END DESC NULLS LAST, k.t_id DESC LIMIT (SELECT n FROM lim)
$function$;

DROP FUNCTION IF EXISTS public.club_update_settings(uuid, jsonb);
CREATE OR REPLACE FUNCTION public.club_update_settings(p_club_id uuid, p jsonb)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_tenant uuid := public.current_tenant_id(); v_caps record; v_hit integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'clubs: sign in required' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = p_club_id AND c.tenant_id = v_tenant) THEN RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_caps FROM public.club_capabilities(p_club_id, NULL, v_uid);
  IF NOT (public.is_club_admin(v_uid) OR v_caps.effective_role = 'lead') THEN RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501'; END IF;
  IF (p ? 'join_policy') AND COALESCE(p->>'join_policy', '') NOT IN ('open', 'request', 'invite') THEN RAISE EXCEPTION 'clubs: invalid join policy' USING ERRCODE = '22023'; END IF;
  IF (p ? 'who_can_post') AND COALESCE(p->>'who_can_post', '') NOT IN ('members', 'moderators', 'staff_only') THEN RAISE EXCEPTION 'clubs: invalid who_can_post' USING ERRCODE = '22023'; END IF;
  IF (p ? 'layout') AND COALESCE(p->>'layout', '') NOT IN ('list', 'cards', 'magazine') THEN RAISE EXCEPTION 'clubs: invalid layout' USING ERRCODE = '22023'; END IF;
  IF (p ? 'cover_position_y') AND (jsonb_typeof(p->'cover_position_y') <> 'number' OR (p->>'cover_position_y')::smallint NOT BETWEEN 0 AND 100) THEN RAISE EXCEPTION 'clubs: invalid cover position' USING ERRCODE = '22023'; END IF;
  UPDATE public.clubs c SET
    name_pl = COALESCE(NULLIF(btrim(p->>'name_pl'), ''), c.name_pl),
    name_en = COALESCE(NULLIF(btrim(p->>'name_en'), ''), c.name_en),
    tagline_pl = CASE WHEN p ? 'tagline_pl' THEN NULLIF(btrim(p->>'tagline_pl'), '') ELSE c.tagline_pl END,
    tagline_en = CASE WHEN p ? 'tagline_en' THEN NULLIF(btrim(p->>'tagline_en'), '') ELSE c.tagline_en END,
    description_pl = CASE WHEN p ? 'description_pl' THEN NULLIF(btrim(p->>'description_pl'), '') ELSE c.description_pl END,
    description_en = CASE WHEN p ? 'description_en' THEN NULLIF(btrim(p->>'description_en'), '') ELSE c.description_en END,
    rules_pl = CASE WHEN p ? 'rules_pl' THEN NULLIF(btrim(p->>'rules_pl'), '') ELSE c.rules_pl END,
    rules_en = CASE WHEN p ? 'rules_en' THEN NULLIF(btrim(p->>'rules_en'), '') ELSE c.rules_en END,
    icon = COALESCE(NULLIF(btrim(p->>'icon'), ''), c.icon),
    accent_color = CASE WHEN p ? 'accent_color' THEN NULLIF(btrim(p->>'accent_color'), '') ELSE c.accent_color END,
    cover_image_url = CASE WHEN p ? 'cover_image_url' THEN NULLIF(btrim(p->>'cover_image_url'), '') ELSE c.cover_image_url END,
    cover_position_y = CASE WHEN p ? 'cover_position_y' THEN (p->>'cover_position_y')::smallint ELSE c.cover_position_y END,
    policy_area = CASE WHEN p ? 'policy_area' THEN NULLIF(btrim(p->>'policy_area'), '') ELSE c.policy_area END,
    layout = COALESCE(NULLIF(p->>'layout', ''), c.layout),
    who_can_post = COALESCE(NULLIF(p->>'who_can_post', ''), c.who_can_post),
    join_policy = COALESCE(NULLIF(p->>'join_policy', ''), c.join_policy),
    updated_at = now()
  WHERE c.id = p_club_id AND c.tenant_id = v_tenant;
  GET DIAGNOSTICS v_hit = ROW_COUNT;
  IF v_hit = 0 THEN RETURN false; END IF;
  INSERT INTO public.club_moderation_log (tenant_id, club_id, moderator_id, action, target_type, target_id, reason) VALUES (v_tenant, p_club_id, v_uid, 'club_updated', 'club', p_club_id, left(COALESCE((SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(p) AS k), ''), 500));
  RETURN true;
END;
$function$;

DROP FUNCTION IF EXISTS public.club_set_cover_position(uuid, smallint);
CREATE OR REPLACE FUNCTION public.club_set_cover_position(p_club_id uuid, p_position_y smallint)
 RETURNS smallint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_club public.clubs%ROWTYPE; v_caps record; v_val smallint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_club FROM public.clubs WHERE id = p_club_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_caps FROM public.club_capabilities(v_club.id, NULL, v_uid);
  IF NOT COALESCE(v_caps.can_moderate, false) AND NOT public.has_role(v_uid, 'admin'::app_role) THEN RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501'; END IF;
  v_val := GREATEST(0::smallint, LEAST(100::smallint, COALESCE(p_position_y, 50)::smallint));
  UPDATE public.clubs SET cover_position_y = v_val WHERE id = p_club_id;
  RETURN v_val;
END;
$function$;
