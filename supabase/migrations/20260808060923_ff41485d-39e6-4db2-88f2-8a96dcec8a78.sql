CREATE OR REPLACE FUNCTION public.club_mention_visible_to(
  p_source_type text, p_source_id text, p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club  uuid;
  v_group uuid;
BEGIN
  IF p_source_type NOT IN ('club_thread', 'club_reply') THEN
    RETURN true;
  END IF;
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF p_source_type = 'club_thread' THEN
    SELECT t.club_id, t.group_id INTO v_club, v_group
      FROM public.club_threads t WHERE t.id = p_source_id::uuid;
  ELSE
    SELECT r.club_id, t.group_id INTO v_club, v_group
      FROM public.club_replies r
      JOIN public.club_threads t ON t.id = r.thread_id
     WHERE r.id = p_source_id::uuid;
  END IF;

  IF v_club IS NULL THEN
    RETURN false;
  END IF;

  RETURN COALESCE(
    (SELECT can_read FROM public.club_capabilities(v_club, v_group, p_user_id)),
    false
  );
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

COMMENT ON FUNCTION public.club_mention_visible_to(text, text, uuid) IS
  'Czy wskazana osoba moze dostac powiadomienie o wzmiance w tym zrodle. Dla zrodel klubowych liczy club_capabilities. Dla pozostalych zrodel zawsze true.';

REVOKE EXECUTE ON FUNCTION public.club_mention_visible_to(text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_mention_visible_to(text, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.process_mentions(
  p_tenant_id uuid,
  p_source_type text,
  p_source_id text,
  p_body text,
  p_actor_id uuid,
  p_kind text,
  p_href text,
  p_actor_label text DEFAULT NULL,
  p_record_actor boolean DEFAULT true
)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug text;
  v_profile record;
  v_actor_name text;
  v_count integer := 0;
BEGIN
  IF p_body IS NULL OR position('@' in p_body) = 0 THEN
    RETURN 0;
  END IF;

  IF p_actor_label IS NOT NULL AND btrim(p_actor_label) <> '' THEN
    v_actor_name := btrim(p_actor_label);
  ELSE
    SELECT COALESCE(NULLIF(btrim(display_name), ''), 'Ktoś')
      INTO v_actor_name FROM public.profiles WHERE id = p_actor_id;
    v_actor_name := COALESCE(v_actor_name, 'Ktoś');
  END IF;

  FOR v_slug IN
    SELECT DISTINCT lower(m[1])
    FROM regexp_matches(p_body, '(?:^|[^a-zA-Z0-9@._-])@([a-zA-Z0-9][a-zA-Z0-9_-]{1,63})', 'g') AS m
    LIMIT 10
  LOOP
    SELECT id, display_name INTO v_profile
      FROM public.profiles
     WHERE tenant_id = p_tenant_id AND slug = v_slug;
    IF v_profile.id IS NULL OR v_profile.id = p_actor_id THEN
      CONTINUE;
    END IF;

    IF NOT public.club_mention_visible_to(p_source_type, p_source_id, v_profile.id) THEN
      CONTINUE;
    END IF;

    PERFORM public.add_cross_reference(
      p_tenant_id, p_source_type, p_source_id,
      'profile', v_profile.id::text, 'mention',
      CASE WHEN p_record_actor THEN p_actor_id ELSE NULL END
    );

    PERFORM public.enqueue_notification(
      v_profile.id,
      p_kind,
      v_actor_name || ' wspomniał(a) o Tobie',
      v_actor_name || ' mentioned you',
      NULL, NULL,
      p_href,
      'at-sign'
    );

    PERFORM public.emit_domain_event(
      p_tenant_id, p_source_type, p_source_id, 'mention.created.v1',
      jsonb_build_object(
        'mentioned_user_id', v_profile.id,
        'actor_id', CASE WHEN p_record_actor THEN to_jsonb(p_actor_id) ELSE 'null'::jsonb END,
        'source_type', p_source_type
      ),
      p_suppress_actor => NOT p_record_actor
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
EXCEPTION WHEN OTHERS THEN
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION
  public.process_mentions(uuid, text, text, text, uuid, text, text, text, boolean) IS
  'Parsuje @wzmianki, dokłada krawędź w cross_references, kolejkuje powiadomienie i emituje mention.created.v1. Dla źródeł klubowych respektuje widoczność klubu.';

DROP FUNCTION IF EXISTS public.club_create_thread(uuid, text, text, text, boolean, text, text);

CREATE FUNCTION public.club_create_thread(
  p_group_id        uuid,
  p_title           text,
  p_body            text,
  p_kind            text DEFAULT 'discussion',
  p_anonymous       boolean DEFAULT false,
  p_anchor_type     text DEFAULT NULL,
  p_anchor_id       text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS TABLE (id uuid, slug text, status text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
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
  v_prior     jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('discussion','question','position','resource','announcement','poll') THEN
    RAISE EXCEPTION 'clubs: invalid thread kind %', p_kind USING ERRCODE = '22023';
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

  IF p_kind = 'resource' AND NULLIF(btrim(COALESCE(p_anchor_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'clubs: resource requires an anchor' USING ERRCODE = '22023';
  END IF;

  v_attr := COALESCE(v_group.attribution_mode, v_club.attribution_mode);
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
    is_anonymous, anchor_type, anchor_id
  ) VALUES (
    v_club.tenant_id, v_group.club_id, p_group_id, v_uid, v_slug,
    btrim(p_title), btrim(p_body), p_kind, v_status,
    COALESCE(p_anonymous, false),
    NULLIF(p_anchor_type, ''), NULLIF(btrim(COALESCE(p_anchor_id, '')), '')
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
$$;

COMMENT ON FUNCTION
  public.club_create_thread(uuid, text, text, text, boolean, text, text, text) IS
  'Zaklada temat. Klucz idempotencji jest OPCJONALNY: z nim powtorka zwraca zapamietany watek zamiast zakladac drugi.';

REVOKE EXECUTE ON FUNCTION
  public.club_create_thread(uuid, text, text, text, boolean, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.club_create_thread(uuid, text, text, text, boolean, text, text, text)
  TO authenticated, service_role;