-- Ikona tematu: nazwa ikony Lucide w kebab-case (katalog po stronie aplikacji).
-- Baza NIE zna listy ikon - pilnuje wylacznie ksztaltu, zeby do kolumny nie
-- trafil dowolny tekst od uzytkownika.
ALTER TABLE public.club_threads
  ADD COLUMN IF NOT EXISTS icon text;

ALTER TABLE public.club_threads
  DROP CONSTRAINT IF EXISTS club_threads_icon_shape;
ALTER TABLE public.club_threads
  ADD CONSTRAINT club_threads_icon_shape
  CHECK (icon IS NULL OR (icon ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(icon) <= 48));

-- club_create_thread: dodatkowy parametr p_icon. Sygnatura sie zmienia, wiec
-- stara wersja musi zniknac - dwa przeciazenia daja PostgREST niejednoznacznosc.
DROP FUNCTION IF EXISTS public.club_create_thread(uuid, text, text, text, boolean, text, text, text, boolean, text);

CREATE FUNCTION public.club_create_thread(
  p_group_id uuid,
  p_title text,
  p_body text,
  p_kind text DEFAULT 'discussion',
  p_anonymous boolean DEFAULT false,
  p_anchor_type text DEFAULT NULL,
  p_anchor_id text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_lock_replies boolean DEFAULT false,
  p_topic text DEFAULT NULL,
  p_icon text DEFAULT NULL
)
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
    is_anonymous, anchor_type, anchor_id, topic, icon, locked_at
  ) VALUES (
    v_club.tenant_id, v_group.club_id, p_group_id, v_uid, v_slug,
    btrim(p_title), btrim(p_body), p_kind, v_status,
    COALESCE(p_anonymous, false),
    NULLIF(p_anchor_type, ''), NULLIF(btrim(COALESCE(p_anchor_id, '')), ''),
    COALESCE(v_topic, NULLIF(btrim(COALESCE(v_club.policy_area, '')), '')),
    v_icon,
    CASE WHEN COALESCE(p_lock_replies, false) THEN now() ELSE NULL END
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

GRANT EXECUTE ON FUNCTION public.club_create_thread(uuid, text, text, text, boolean, text, text, text, boolean, text, text)
  TO anon, authenticated, service_role;

-- Widok watku: dokladamy kolumne icon na koncu zbioru wynikowego.
DROP FUNCTION IF EXISTS public.club_thread_view(uuid, text);

CREATE FUNCTION public.club_thread_view(p_club_id uuid, p_slug text)
RETURNS TABLE(id uuid, club_id uuid, group_id uuid, slug text, title text, body text, kind text, status text, anchor_type text, anchor_id text, is_anonymous boolean, author_id uuid, author_name text, author_avatar text, author_slug text, author_alias text, posted_by_admin_name text, reply_count integer, participant_count integer, reaction_count integer, pinned_at timestamp with time zone, locked_at timestamp with time zone, resolved_reply_id uuid, created_at timestamp with time zone, edited_at timestamp with time zone, attribution_mode text, poll_id uuid, can_reply boolean, can_moderate boolean, reason text, topic text, icon text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    t.id, t.club_id, t.group_id, t.slug,
    t.title, t.body, t.kind, t.status,
    t.anchor_type, t.anchor_id,
    t.is_anonymous,
    CASE WHEN t.is_anonymous OR attr.mode = 'chatham' THEN NULL ELSE t.author_id END,
    CASE WHEN t.is_anonymous OR attr.mode = 'chatham' THEN NULL
         ELSE COALESCE(NULLIF(btrim(p.display_name), ''), 'User') END,
    CASE WHEN t.is_anonymous OR attr.mode = 'chatham' OR p.hide_avatar THEN NULL
         ELSE p.avatar_url END,
    CASE WHEN t.is_anonymous OR attr.mode = 'chatham' THEN NULL ELSE p.slug END,
    CASE WHEN t.is_anonymous OR attr.mode = 'chatham'
         THEN public.club_author_alias(t.id, t.author_id) ELSE NULL END,
    NULLIF(btrim(pa.display_name), ''),
    t.reply_count, t.participant_count, t.reaction_count,
    t.pinned_at, t.locked_at, t.resolved_reply_id,
    t.created_at, t.edited_at,
    attr.mode,
    CASE WHEN t.kind = 'poll' THEN t.poll_id ELSE NULL END,
    (cap.can_reply AND t.locked_at IS NULL AND t.status NOT IN ('locked', 'hidden', 'deleted')),
    cap.can_moderate,
    cap.reason,
    t.topic,
    t.icon
  FROM public.club_threads t
  JOIN public.club_groups g ON g.id = t.group_id
  JOIN public.clubs c ON c.id = t.club_id
  CROSS JOIN LATERAL (SELECT COALESCE(g.attribution_mode, c.attribution_mode) AS mode) attr
  CROSS JOIN LATERAL public.club_capabilities(t.club_id, t.group_id, auth.uid()) cap
  LEFT JOIN public.profiles p ON p.id = t.author_id
  LEFT JOIN public.profiles pa ON pa.id = t.posted_by_admin_id
  WHERE t.club_id = p_club_id
    AND t.slug = p_slug
    AND cap.can_read
    AND (
      t.status IN ('open', 'resolved', 'dormant', 'locked')
      OR cap.can_moderate
      OR (t.status = 'pending' AND t.author_id = auth.uid())
    )
$function$;

GRANT EXECUTE ON FUNCTION public.club_thread_view(uuid, text) TO anon, authenticated, service_role;

-- Lista watkow: ta sama kolumna, zeby strumien klubu mogl narysowac ikone bez
-- dodatkowego zapytania na kazdy wiersz.
DROP FUNCTION IF EXISTS public.club_threads_list(uuid, uuid, text, text, text, integer, text, boolean, boolean, text);

CREATE FUNCTION public.club_threads_list(p_club_id uuid, p_group_id uuid DEFAULT NULL::uuid, p_sort text DEFAULT 'hot'::text, p_kind text DEFAULT NULL::text, p_cursor text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_status text DEFAULT NULL::text, p_anchored boolean DEFAULT NULL::boolean, p_unread_only boolean DEFAULT false, p_topic text DEFAULT NULL::text)
RETURNS TABLE(id uuid, slug text, title text, kind text, status text, group_id uuid, group_name_pl text, group_name_en text, anchor_type text, anchor_id text, anchor_label text, is_anonymous boolean, author_id uuid, author_name text, author_avatar text, author_slug text, author_alias text, posted_by_admin_name text, reply_count integer, participant_count integer, reaction_count integer, insightful_count integer, pinned_at timestamp with time zone, last_reply_at timestamp with time zone, created_at timestamp with time zone, hotness numeric, is_unread boolean, cursor_value text, excerpt text, topic text, icon text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  seen AS (
    SELECT m.last_read_at
      FROM public.club_members m
     WHERE m.club_id = p_club_id
       AND auth.uid() IS NOT NULL
       AND m.user_id = auth.uid()
  ),
  visible AS (
    SELECT t.*, g.name_pl AS g_pl, g.name_en AS g_en,
           COALESCE(g.attribution_mode, cl.attribution_mode) AS attribution,
           (auth.uid() IS NOT NULL
            AND t.author_id IS DISTINCT FROM auth.uid()
            AND COALESCE(t.last_reply_at, t.created_at)
                > COALESCE((SELECT last_read_at FROM seen), '-infinity'::timestamptz)
           ) AS unread,
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
       AND (NULLIF(btrim(COALESCE(p_topic, '')), '') IS NULL
            OR t.topic = btrim(p_topic))
       AND (t.status IN ('open','resolved','dormant','locked')
            OR cap.can_moderate
            OR (t.status = 'pending' AND t.author_id = auth.uid()))
       AND (g.status NOT IN ('draft','archived') OR cap.can_manage)
       AND (p_status IS NULL OR t.status = p_status)
       AND (p_anchored IS NULL OR (t.anchor_id IS NOT NULL) = p_anchored)
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
  filtered AS (
    SELECT v.* FROM visible v
     WHERE NOT COALESCE(p_unread_only, false) OR v.unread
  ),
  keyed AS (
    SELECT f.*,
           f.pin_key || '|' ||
           CASE s.mode
             WHEN 'new' THEN
               to_char(COALESCE(f.last_reply_at, f.created_at), 'YYYYMMDDHH24MISSMS')
             WHEN 'subscribed' THEN
               to_char(COALESCE(f.last_reply_at, f.created_at), 'YYYYMMDDHH24MISSMS')
             WHEN 'unanswered' THEN to_char(f.created_at, 'YYYYMMDDHH24MISSMS')
             WHEN 'mine' THEN to_char(f.created_at, 'YYYYMMDDHH24MISSMS')
             WHEN 'top' THEN lpad(GREATEST(f.reaction_count, 0)::text, 10, '0')
             ELSE to_char(f.hotness, 'FM0000000000.0000000000')
           END || '|' || f.id::text AS ckey
      FROM filtered f
      CROSS JOIN sort s
  ),
  page AS (
    SELECT k.* FROM keyed k
     WHERE p_cursor IS NULL OR k.ckey < p_cursor
     ORDER BY k.ckey DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
  )
  SELECT
    k.id, k.slug, k.title, k.kind, k.status,
    k.group_id, k.g_pl, k.g_en,
    k.anchor_type, k.anchor_id,
    public.club_anchor_label(k.anchor_type, k.anchor_id),
    k.is_anonymous,
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
    COALESCE((SELECT count(*)::int FROM public.club_reactions rx
               WHERE rx.target_type = 'thread' AND rx.target_id = k.id
                 AND rx.kind = 'insightful'), 0),
    k.pinned_at, k.last_reply_at, k.created_at, k.hotness, k.unread, k.ckey,
    left(k.body, 280),
    k.topic,
    k.icon
  FROM page k
  LEFT JOIN public.profiles p ON p.id = k.author_id
  LEFT JOIN public.profiles pa ON pa.id = k.posted_by_admin_id
  ORDER BY k.ckey DESC
$function$;

GRANT EXECUTE ON FUNCTION public.club_threads_list(uuid, uuid, text, text, text, integer, text, boolean, boolean, text) TO anon, authenticated, service_role;