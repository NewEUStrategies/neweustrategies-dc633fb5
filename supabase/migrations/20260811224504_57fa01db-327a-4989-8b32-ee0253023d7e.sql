CREATE OR REPLACE FUNCTION public.is_nes_staff(_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT _user_id IS NOT NULL
     AND (
       public.has_role(_user_id, 'admin')
       OR public.has_role(_user_id, 'super_admin')
       OR public.has_role(_user_id, 'editor')
       OR public.has_role(_user_id, 'author')
       OR EXISTS (
         SELECT 1 FROM public.profiles p
          WHERE p.id = _user_id
            AND lower(COALESCE(p.email, '')) LIKE '%@neweuropeanstrategies.com'
       )
     );
$function$;

GRANT EXECUTE ON FUNCTION public.is_nes_staff(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_capabilities(_club_id uuid, _group_id uuid DEFAULT NULL::uuid, _user_id uuid DEFAULT auth.uid())
 RETURNS TABLE(can_read boolean, can_post_thread boolean, can_reply boolean, can_react boolean, can_moderate boolean, can_manage boolean, can_invite boolean, can_see_members boolean, can_reveal_author boolean, effective_role text, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_club        public.clubs%ROWTYPE;
  v_group       public.club_groups%ROWTYPE;
  v_member      public.club_members%ROWTYPE;
  v_caller      uuid := auth.uid();
  v_is_admin    boolean;
  v_is_editor   boolean;
  v_is_staff    boolean;
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
  v_is_staff  := public.is_nes_staff(_user_id);
  v_is_editor := _user_id IS NOT NULL AND (public.has_role(_user_id, 'editor') OR v_is_staff);
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
  IF v_club.visibility = 'secret' AND v_role = 'non_member' AND NOT v_is_admin AND NOT v_is_staff THEN
    RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                        'non_member'::text, 'not_found'::text;
    RETURN;
  END IF;
  IF v_club.status <> 'active' AND NOT v_is_admin AND NOT v_is_staff THEN
    RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                        v_role,
                        CASE WHEN v_club.status = 'draft' THEN 'not_open_yet' ELSE 'archived' END;
    RETURN;
  END IF;
  v_visibility   := COALESCE(v_group.visibility, v_club.visibility);
  v_who_can_post := COALESCE(v_group.who_can_post, v_club.who_can_post);
  v_min_tier     := COALESCE(v_group.min_tier_rank, v_club.min_tier_rank);
  IF _group_id IS NOT NULL AND NOT v_is_admin AND NOT v_is_staff THEN
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
  IF v_min_tier > 0 AND NOT v_is_admin AND NOT v_is_staff AND v_role = 'non_member' THEN
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
    WHEN v_is_admin OR v_is_staff THEN true
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
      ELSE v_is_staff
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
$function$;