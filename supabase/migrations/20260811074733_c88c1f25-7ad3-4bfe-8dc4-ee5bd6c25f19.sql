CREATE OR REPLACE FUNCTION public.club_create_thread(p_group_id uuid, p_title text, p_body text, p_kind text DEFAULT 'discussion'::text, p_anonymous boolean DEFAULT false, p_anchor_type text DEFAULT NULL::text, p_anchor_id text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_lock_replies boolean DEFAULT false, p_topic text DEFAULT NULL::text, p_icon text DEFAULT NULL::text, p_attribution_mode text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, slug text, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_group     public.club_groups%ROWTYPE;
  v_club      public.clubs%ROWTYPE;
  v_caps      record;
  v_attr      text;
  v_mod       text;
  v_status    text;
  v_slug      text;
  v_base      text;
  v_n         integer := 0;
  v_recent    integer;
  v_id        uuid;
  v_key       text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_topic     text := NULLIF(btrim(COALESCE(p_topic, '')), '');
  v_icon      text := NULLIF(btrim(lower(COALESCE(p_icon, ''))), '');
  v_prior     jsonb;
  v_thread_attr text := NULLIF(btrim(lower(COALESCE(p_attribution_mode, ''))), '');
  v_base_attr text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('discussion','question','position','resource','announcement','poll') THEN
    RAISE EXCEPTION 'clubs: invalid thread kind %', p_kind USING ERRCODE = '22023';
  END IF;
  IF NOT public.club_topic_valid(v_topic) THEN
    RAISE EXCEPTION 'clubs: invalid topic %', v_topic USING ERRCODE = '22023';
  END IF;
  IF v_icon IS NOT NULL AND (v_icon !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR length(v_icon) > 48) THEN
    RAISE EXCEPTION 'clubs: invalid icon %', v_icon USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_group FROM public.club_groups g WHERE g.id = p_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_club FROM public.clubs c WHERE c.id = v_group.club_id;

  IF v_key IS NOT NULL THEN
    SELECT ci.result INTO v_prior
      FROM public.command_idempotency ci
     WHERE ci.tenant_id = v_club.tenant_id
       AND ci.idempotency_key = v_key
       AND ci.command = 'club_create_thread'
       AND ci.status = 'succeeded';
    IF v_prior IS NOT NULL THEN
      id := (v_prior->>'id')::uuid;
      slug := v_prior->>'slug';
      status := v_prior->>'status';
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  SELECT * INTO v_caps FROM public.club_capabilities(v_group.club_id, p_group_id, v_uid);
  IF NOT COALESCE(v_caps.can_post_thread, false) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_kind = 'announcement' AND NOT COALESCE(v_caps.can_moderate, false) THEN
    RAISE EXCEPTION 'clubs: announcement requires moderator' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(p_lock_replies, false) AND NOT COALESCE(v_caps.can_moderate, false) THEN
    RAISE EXCEPTION 'clubs: locking replies requires moderator' USING ERRCODE = '42501';
  END IF;

  IF p_kind = 'resource' AND NULLIF(btrim(COALESCE(p_anchor_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'clubs: resource requires an anchor' USING ERRCODE = '22023';
  END IF;

  v_base_attr := COALESCE(v_group.attribution_mode, v_club.attribution_mode);

  IF v_thread_attr IS NOT NULL THEN
    IF v_thread_attr NOT IN ('attributed','chatham','anonymous_allowed') THEN
      RAISE EXCEPTION 'clubs: invalid attribution mode %', v_thread_attr USING ERRCODE = '22023';
    END IF;
    IF v_base_attr = 'chatham' AND v_thread_attr <> 'chatham'
       AND NOT COALESCE(v_caps.can_moderate, false) THEN
      RAISE EXCEPTION 'clubs: attribution cannot be relaxed' USING ERRCODE = '42501';
    END IF;
    IF v_base_attr = 'attributed' AND v_thread_attr <> 'attributed'
       AND NOT COALESCE(v_caps.can_moderate, false) THEN
      RAISE EXCEPTION 'clubs: anonymous posting disabled' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_attr := COALESCE(v_thread_attr, v_base_attr);
  IF p_anonymous AND v_attr = 'attributed' THEN
    RAISE EXCEPTION 'clubs: anonymous posting disabled' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('club_create_thread:' || v_uid::text));

  IF v_key IS NOT NULL THEN
    SELECT ci.result INTO v_prior
      FROM public.command_idempotency ci
     WHERE ci.tenant_id = v_club.tenant_id
       AND ci.idempotency_key = v_key
       AND ci.command = 'club_create_thread'
       AND ci.status = 'succeeded';
    IF v_prior IS NOT NULL THEN
      id := (v_prior->>'id')::uuid;
      slug := v_prior->>'slug';
      status := v_prior->>'status';
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  SELECT count(*)::int INTO v_recent FROM public.club_threads
   WHERE author_id = v_uid AND created_at > now() - interval '24 hours';
  IF v_recent >= 10 THEN
    RAISE EXCEPTION 'clubs: thread rate limit' USING ERRCODE = '42901';
  END IF;

  v_mod := COALESCE(v_group.moderation_mode, v_club.moderation_mode);
  v_status := CASE
    WHEN v_caps.can_moderate THEN 'open'
    WHEN v_mod = 'pre' THEN 'pending'
    WHEN v_mod = 'trusted' AND v_caps.reason = 'pre_moderation' THEN 'pending'
    ELSE 'open'
  END;

  v_base := NULLIF(regexp_replace(
              lower(unaccent(btrim(p_title))), '[^a-z0-9]+', '-', 'g'
            ), '');
  v_base := btrim(COALESCE(v_base, 'temat'), '-');
  v_base := left(v_base, 60);
  v_slug := v_base;
  WHILE EXISTS (SELECT 1 FROM public.club_threads
                 WHERE club_id = v_group.club_id AND club_threads.slug = v_slug) LOOP
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n::text;
  END LOOP;

  INSERT INTO public.club_threads (
    tenant_id, club_id, group_id, author_id, slug, title, body, kind, status,
    is_anonymous, anchor_type, anchor_id, topic, icon, locked_at, attribution_mode
  ) VALUES (
    v_club.tenant_id, v_group.club_id, p_group_id, v_uid, v_slug,
    btrim(p_title), btrim(p_body), p_kind, v_status,
    COALESCE(p_anonymous, false),
    NULLIF(p_anchor_type, ''), NULLIF(btrim(COALESCE(p_anchor_id, '')), ''),
    COALESCE(v_topic, NULLIF(btrim(COALESCE(v_club.policy_area, '')), '')),
    v_icon,
    CASE WHEN COALESCE(p_lock_replies, false) THEN now() ELSE NULL END,
    v_thread_attr
  )
  RETURNING club_threads.id INTO v_id;

  IF v_key IS NOT NULL THEN
    INSERT INTO public.command_idempotency (
      tenant_id, idempotency_key, command, actor_id, status, result, completed_at
    ) VALUES (
      v_club.tenant_id, v_key, 'club_create_thread', v_uid, 'succeeded',
      jsonb_build_object('id', v_id, 'slug', v_slug, 'status', v_status), now()
    )
    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING;
  END IF;

  id := v_id; slug := v_slug; status := v_status;
  RETURN NEXT;
END;
$function$;

COMMENT ON FUNCTION public.club_create_thread(uuid,text,text,text,boolean,text,text,text,boolean,text,text,text) IS
  'Zakladanie watku. p_attribution_mode ustawia anonimowosc UCZESTNIKOW rozmowy; wolno wylacznie zaostrzyc zasade dziedziczona z dzialu, poluzowanie wymaga prowadzenia klubu. Definicja jawna (wczesniej skladana dynamicznie) - patrz bramka check:rpc-contract.';

REVOKE EXECUTE ON FUNCTION public.club_create_thread(uuid,text,text,text,boolean,text,text,text,boolean,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.club_create_thread(uuid,text,text,text,boolean,text,text,text,boolean,text,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.club_create_thread(uuid,text,text,text,boolean,text,text,text,boolean,text,text,text) TO authenticated, service_role;