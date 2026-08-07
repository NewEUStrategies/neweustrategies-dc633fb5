-- 1) club_list: strona + total_count -----------------------------------------
DROP FUNCTION IF EXISTS public.club_list();
CREATE OR REPLACE FUNCTION public.club_list(p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, slug text, name_pl text, name_en text, tagline_pl text, tagline_en text,
   icon text, accent_color text, cover_image_url text, visibility text, join_policy text,
   min_tier_rank integer, policy_area text, status text, member_count integer, group_count integer,
   thread_count integer, last_activity_at timestamp with time zone, my_role text, my_status text,
   can_read boolean, total_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH me AS (
    SELECT p.id AS uid, p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()
  ),
  scope AS (
    SELECT COALESCE((SELECT tenant_id FROM me), public.public_tenant_id()) AS tenant_id
  ),
  visible AS (
    SELECT
      c.id, c.slug, c.name_pl, c.name_en, c.tagline_pl, c.tagline_en, c.icon, c.accent_color,
      c.cover_image_url, c.visibility, c.join_policy, c.min_tier_rank, c.policy_area, c.status,
      c.member_count, c.group_count, c.thread_count, c.last_activity_at,
      public.club_effective_member_role(m.role, m.role_expires_at) AS my_role,
      m.status AS my_status,
      cap.can_read,
      (m.user_id IS NOT NULL) AS is_mine
    FROM public.clubs c
    CROSS JOIN scope s
    LEFT JOIN public.club_members m
      ON m.club_id = c.id AND m.user_id = auth.uid() AND m.status = 'active'
    CROSS JOIN LATERAL public.club_capabilities(c.id, NULL, auth.uid()) cap
    WHERE c.tenant_id = s.tenant_id
      AND c.status = 'active'
      AND (c.visibility IN ('public', 'members', 'private') OR cap.can_read)
      AND (auth.uid() IS NOT NULL OR c.visibility = 'public')
  )
  SELECT
    v.id, v.slug, v.name_pl, v.name_en, v.tagline_pl, v.tagline_en, v.icon, v.accent_color,
    v.cover_image_url, v.visibility, v.join_policy, v.min_tier_rank, v.policy_area, v.status,
    v.member_count, v.group_count, v.thread_count, v.last_activity_at,
    v.my_role, v.my_status, v.can_read,
    count(*) OVER () AS total_count
  FROM visible v
  ORDER BY v.is_mine DESC, v.last_activity_at DESC NULLS LAST, lower(v.name_pl) ASC
  LIMIT GREATEST(COALESCE(p_limit, 100), 1)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$function$;

-- 2) club_replies_list: strona + total_count ---------------------------------
DROP FUNCTION IF EXISTS public.club_replies_list(uuid, text);
CREATE OR REPLACE FUNCTION public.club_replies_list(
  p_thread_id uuid,
  p_sort text DEFAULT 'chronological'::text,
  p_limit integer DEFAULT 200,
  p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, parent_id uuid, depth smallint, body text, status text, is_anonymous boolean,
   author_id uuid, author_name text, author_avatar text, author_slug text, author_alias text,
   posted_by_admin_name text, reaction_count integer, created_at timestamp with time zone,
   edited_at timestamp with time zone, is_resolution boolean, total_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      CASE WHEN r.is_anonymous OR th.attribution = 'chatham' THEN NULL ELSE r.author_id END AS author_id,
      CASE WHEN r.is_anonymous OR th.attribution = 'chatham' THEN NULL
           ELSE COALESCE(NULLIF(btrim(p.display_name), ''), 'User') END AS author_name,
      CASE WHEN r.is_anonymous OR th.attribution = 'chatham' OR p.hide_avatar THEN NULL
           ELSE p.avatar_url END AS author_avatar,
      CASE WHEN r.is_anonymous OR th.attribution = 'chatham' THEN NULL ELSE p.slug END AS author_slug,
      CASE WHEN r.is_anonymous OR th.attribution = 'chatham'
           THEN public.club_author_alias(r.thread_id, r.author_id) ELSE NULL END AS author_alias,
      NULLIF(btrim(pa.display_name), '') AS posted_by_admin_name,
      r.reaction_count, r.created_at, r.edited_at,
      (th.resolved_reply_id = r.id) AS is_resolution
    FROM public.club_replies r
    CROSS JOIN thread th
    CROSS JOIN cap
    LEFT JOIN public.profiles p ON p.id = r.author_id
    LEFT JOIN public.profiles pa ON pa.id = r.posted_by_admin_id
    WHERE r.thread_id = p_thread_id
      AND cap.can_read
      AND (
        r.status = 'visible'
        OR cap.can_moderate
        OR (r.status = 'pending' AND r.author_id = auth.uid())
      )
  )
  SELECT
    rows.id, rows.parent_id, rows.depth, rows.body, rows.status, rows.is_anonymous,
    rows.author_id, rows.author_name, rows.author_avatar, rows.author_slug, rows.author_alias,
    rows.posted_by_admin_name, rows.reaction_count, rows.created_at, rows.edited_at,
    rows.is_resolution,
    count(*) OVER () AS total_count
  FROM rows
  ORDER BY
    rows.is_resolution DESC NULLS LAST,
    CASE WHEN p_sort = 'best' THEN rows.reaction_count ELSE 0 END DESC,
    rows.created_at ASC,
    rows.id ASC
  LIMIT GREATEST(COALESCE(p_limit, 200), 1)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$function$;

-- 3) admin_club_moderation_queue: strona + total_count ------------------------
DROP FUNCTION IF EXISTS public.admin_club_moderation_queue(uuid);
CREATE OR REPLACE FUNCTION public.admin_club_moderation_queue(
  p_club_id uuid,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0)
 RETURNS TABLE(target_type text, target_id uuid, thread_slug text, title text, body text,
   author_name text, is_anonymous boolean, created_at timestamp with time zone, total_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH club AS (
    SELECT c.* FROM public.clubs c
     WHERE c.id = p_club_id
       AND public.is_club_admin(auth.uid())
       AND c.tenant_id = public.current_tenant_id()
  ),
  queue AS (
    SELECT 'thread'::text AS target_type, t.id AS target_id, t.slug AS thread_slug,
           t.title, t.body,
           CASE WHEN t.is_anonymous
                  OR COALESCE(g.attribution_mode, cl.attribution_mode) = 'chatham'
                THEN NULL
                ELSE COALESCE(NULLIF(btrim(p.display_name), ''), 'User') END AS author_name,
           (t.is_anonymous OR COALESCE(g.attribution_mode, cl.attribution_mode) = 'chatham') AS is_anonymous,
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
  )
  SELECT q.target_type, q.target_id, q.thread_slug, q.title, q.body,
         q.author_name, q.is_anonymous, q.created_at,
         count(*) OVER () AS total_count
    FROM queue q
   ORDER BY q.created_at ASC
   LIMIT GREATEST(COALESCE(p_limit, 50), 1)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$function$;

-- 4) admin_club_group_delete: kasowanie grupy z przeniesieniem tematów --------
CREATE OR REPLACE FUNCTION public.admin_club_group_delete(
  p_group_id uuid,
  p_move_to_group_id uuid DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_tenant  uuid := public.current_tenant_id();
  v_club_id uuid;
  v_target  uuid;
  v_moved   integer := 0;
BEGIN
  IF NOT public.is_club_admin(v_uid) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT g.club_id INTO v_club_id
    FROM public.club_groups g
    JOIN public.clubs c ON c.id = g.club_id
   WHERE g.id = p_group_id AND c.tenant_id = v_tenant;
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;

  -- Cel przeniesienia musi należeć do TEGO SAMEGO klubu - inaczej kasowanie
  -- grupy byłoby cichym kanałem przerzucania wątków między klubami.
  IF p_move_to_group_id IS NOT NULL THEN
    SELECT g.id INTO v_target
      FROM public.club_groups g
     WHERE g.id = p_move_to_group_id AND g.club_id = v_club_id AND g.id <> p_group_id;
    IF v_target IS NULL THEN
      RAISE EXCEPTION 'clubs: invalid target group' USING ERRCODE = '22023';
    END IF;
  ELSE
    SELECT g.id INTO v_target
      FROM public.club_groups g
     WHERE g.club_id = v_club_id AND g.id <> p_group_id
     ORDER BY g.sort_order ASC, g.created_at ASC
     LIMIT 1;
    IF v_target IS NULL THEN
      RAISE EXCEPTION 'clubs: last group cannot be deleted' USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.club_threads SET group_id = v_target
   WHERE group_id = p_group_id;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  DELETE FROM public.club_groups WHERE id = p_group_id;

  INSERT INTO public.club_moderation_log (tenant_id, club_id, actor_id, action, target_type, target_id, reason)
  VALUES (v_tenant, v_club_id, v_uid, 'group_delete', 'group', p_group_id,
          format('moved %s threads to %s', v_moved, v_target));

  RETURN v_moved;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_club_group_delete(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_group_delete(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.club_list(integer, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_replies_list(uuid, text, integer, integer) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_club_moderation_queue(uuid, integer, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_moderation_queue(uuid, integer, integer) TO authenticated;