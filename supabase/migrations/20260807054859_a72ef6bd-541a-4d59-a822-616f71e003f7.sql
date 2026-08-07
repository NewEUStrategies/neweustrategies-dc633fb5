CREATE OR REPLACE FUNCTION public.discovery_search_norm(_q text)
RETURNS text
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path TO 'public', 'extensions'
AS $$
  SELECT unaccent(lower(btrim(COALESCE(_q, ''))))
$$;
COMMENT ON FUNCTION public.discovery_search_norm(text) IS
  'Normalizuje fraze do postaci kolumny profiles.discovery_search (btrim -> lower -> unaccent). Jedyne zrodlo prawdy dla wyszukiwarki osob i wyszukiwarki odbiorcow czatu.';

CREATE OR REPLACE FUNCTION public.like_escape(_s text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'pg_catalog'
AS $$
  SELECT replace(replace(replace(COALESCE(_s, ''), '\', '\\'), '%', '\%'), '_', '\_')
$$;
COMMENT ON FUNCTION public.like_escape(text) IS
  'Zamienia %, _ i \ we frazie uzytkownika na literaly wzorca LIKE.';

REVOKE ALL ON FUNCTION public.discovery_search_norm(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.like_escape(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.discovery_search_norm(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.like_escape(text) TO anon, authenticated, service_role;

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS profiles_discovery_trgm_idx
  ON public.profiles USING gin (discovery_search extensions.gin_trgm_ops)
  WHERE discoverable;

CREATE INDEX IF NOT EXISTS profiles_tenant_discoverable_name_idx
  ON public.profiles (tenant_id, lower(display_name))
  WHERE discoverable;

DROP FUNCTION IF EXISTS public.search_chat_contacts(text, integer);

CREATE FUNCTION public.search_chat_contacts(
  p_query text DEFAULT NULL::text,
  p_limit integer DEFAULT 24
)
RETURNS TABLE(
  id uuid,
  display_name text,
  avatar_url text,
  job_title text,
  current_company text,
  specialization text,
  location text,
  slug text,
  verified boolean,
  total_count bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
  WITH me AS (
    SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()
  ),
  is_admin AS (
    SELECT public.is_super_admin(auth.uid()) AS ok
  ),
  q AS (
    SELECT n.raw, public.like_escape(n.raw) AS esc
    FROM (SELECT public.discovery_search_norm(p_query) AS raw) n
  ),
  base AS (
    SELECT
      p.id,
      COALESCE(
        NULLIF(btrim(p.display_name), ''),
        NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
        'User'
      ) AS display_name,
      p.avatar_url,
      p.job_title,
      p.current_company,
      p.specialization,
      p.location,
      p.slug,
      (p.verified_at IS NOT NULL) AS verified,
      p.discovery_search
    FROM public.profiles p, me, is_admin, q
    WHERE auth.uid() IS NOT NULL
      AND p.discoverable
      AND p.tenant_id = me.tenant_id
      AND p.id <> auth.uid()
      AND (is_admin.ok OR public.is_connected_pair(auth.uid(), p.id))
      AND (q.raw = '' OR p.discovery_search LIKE '%' || q.esc || '%')
  ),
  counted AS (SELECT count(*) AS c FROM base)
  SELECT
    b.id,
    b.display_name,
    b.avatar_url,
    b.job_title,
    b.current_company,
    b.specialization,
    b.location,
    b.slug,
    b.verified,
    (SELECT c FROM counted) AS total_count
  FROM base b, q
  ORDER BY
    (q.raw <> '' AND b.discovery_search LIKE q.esc || '%') DESC,
    CASE WHEN q.raw <> '' THEN similarity(b.discovery_search, q.raw) ELSE 0 END DESC,
    lower(b.display_name) ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 100);
$$;

COMMENT ON FUNCTION public.search_chat_contacts(text, integer) IS
  'Wyszukiwarka ODBIORCOW czatu: discoverable + ten sam tenant + zaakceptowane polaczenie (super_admin widzi wszystkich). Dopasowanie po profiles.discovery_search (indeks GIN pg_trgm), fraza escapowana przez like_escape.';

REVOKE ALL ON FUNCTION public.search_chat_contacts(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_chat_contacts(text, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.search_people(
  p_query text DEFAULT '',
  p_specialization text DEFAULT NULL,
  p_company text DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0,
  p_job_title text DEFAULT NULL,
  p_verified_only boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  display_name text,
  avatar_url text,
  job_title text,
  current_company text,
  specialization text,
  location text,
  slug text,
  verified boolean,
  total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH q AS (
    SELECT n.raw, public.like_escape(n.raw) AS esc
    FROM (SELECT public.discovery_search_norm(p_query) AS raw) n
  )
  SELECT
    p.id,
    COALESCE(
      NULLIF(btrim(p.display_name), ''),
      NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
      'User'
    ) AS display_name,
    p.avatar_url,
    p.job_title,
    p.current_company,
    p.specialization,
    p.location,
    p.slug,
    (p.verified_at IS NOT NULL) AS verified,
    count(*) OVER () AS total_count
  FROM public.profiles p, q
  WHERE auth.uid() IS NOT NULL
    AND p.discoverable
    AND p.id <> auth.uid()
    AND p.tenant_id = (SELECT pr.tenant_id FROM public.profiles pr WHERE pr.id = auth.uid())
    AND (q.raw = '' OR p.discovery_search LIKE '%' || q.esc || '%')
    AND (COALESCE(btrim(p_specialization), '') = ''
         OR lower(btrim(p.specialization)) = lower(btrim(p_specialization)))
    AND (COALESCE(btrim(p_company), '') = ''
         OR lower(btrim(p.current_company)) = lower(btrim(p_company)))
    AND (COALESCE(btrim(p_location), '') = ''
         OR lower(btrim(p.location)) = lower(btrim(p_location)))
    AND (COALESCE(btrim(p_job_title), '') = ''
         OR lower(btrim(p.job_title)) = lower(btrim(p_job_title)))
    AND (NOT COALESCE(p_verified_only, false) OR p.verified_at IS NOT NULL)
  ORDER BY
    (q.raw <> '' AND p.discovery_search LIKE q.esc || '%') DESC,
    CASE WHEN q.raw <> '' THEN similarity(p.discovery_search, q.raw) ELSE 0 END DESC,
    lower(COALESCE(
      NULLIF(btrim(p.display_name), ''),
      concat_ws(' ', p.first_name, p.last_name)
    )) ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$$;

REVOKE ALL ON FUNCTION public.search_people(text, text, text, text, integer, integer, text, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_people(text, text, text, text, integer, integer, text, boolean)
  TO authenticated, service_role;

ALTER TABLE public.notification_preferences
  DROP CONSTRAINT IF EXISTS notification_preferences_allow_messages_from_check;

ALTER TABLE public.notification_preferences
  ADD CONSTRAINT notification_preferences_allow_messages_from_check
  CHECK (allow_messages_from IN ('everyone', 'contacts', 'existing', 'nobody'));

COMMENT ON COLUMN public.notification_preferences.allow_messages_from IS
  'Kto moze ZACZAC nowy watek: everyone > contacts (zaakceptowane polaczenie) > existing (wspolny watek juz istnieje) > nobody. Egzekwuje public.chat_accepts_new_thread.';

CREATE OR REPLACE FUNCTION public.chat_accepts_new_thread(_initiator uuid, _peer uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT _initiator IS NOT NULL
     AND _peer IS NOT NULL
     AND _initiator <> _peer
     AND CASE public.chat_allow_messages_from(_peer)
           WHEN 'everyone' THEN true
           WHEN 'contacts' THEN public.is_connected_pair(_initiator, _peer)
           WHEN 'existing' THEN EXISTS (
             SELECT 1
               FROM public.conversation_participants a
               JOIN public.conversation_participants b
                 ON b.conversation_id = a.conversation_id
              WHERE a.user_id = _initiator
                AND b.user_id = _peer
           )
           WHEN 'nobody' THEN false
           ELSE false
         END;
$$;

COMMENT ON FUNCTION public.chat_accepts_new_thread(uuid, uuid) IS
  'Czy _peer godzi sie, by _initiator ZACZAL z nim nowy watek (DM albo krag), zgodnie z allow_messages_from. Nieznana wartosc odrzucana (fail-closed).';

REVOKE ALL ON FUNCTION public.chat_accepts_new_thread(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_accepts_new_thread(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_or_create_direct_conversation(p_peer_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid; v_peer_tenant uuid; v_peer_discoverable boolean;
  v_key text; v_conversation uuid; v_is_admin boolean; v_features jsonb;
  v_created boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'chat: authentication required'; END IF;
  IF p_peer_id IS NULL OR p_peer_id = v_uid THEN RAISE EXCEPTION 'chat: invalid peer'; END IF;
  IF public.is_blocked_pair(v_uid, p_peer_id) THEN RAISE EXCEPTION 'chat: blocked'; END IF;

  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_uid;
  SELECT tenant_id, discoverable INTO v_peer_tenant, v_peer_discoverable
    FROM public.profiles WHERE id = p_peer_id;
  IF v_tenant IS NULL OR v_peer_tenant IS NULL OR v_tenant <> v_peer_tenant THEN
    RAISE EXCEPTION 'chat: peer not available';
  END IF;

  v_is_admin := public.is_super_admin(v_uid);

  IF NOT v_is_admin AND NOT public.is_connected_pair(v_uid, p_peer_id) THEN
    RAISE EXCEPTION 'chat: not in your network';
  END IF;

  IF NOT v_is_admin THEN
    v_features := public.my_effective_tier_features();

    IF NOT public.is_expert_user(v_uid, v_tenant)
       AND NOT public.is_vip_user(v_uid, v_tenant)
       AND COALESCE((v_features ->> 'chat_enabled')::boolean, false) = false THEN
      RAISE EXCEPTION 'chat: tier disabled';
    END IF;

    IF public.is_gated_recipient(p_peer_id, v_tenant)
       AND NOT public.is_expert_user(v_uid, v_tenant)
       AND NOT public.is_vip_user(v_uid, v_tenant)
       AND COALESCE((v_features ->> 'chat_direct_gated')::boolean, false) = false THEN
      RAISE EXCEPTION 'chat: expert requires inmail';
    END IF;
  END IF;

  v_key := v_tenant::text || ':' || LEAST(v_uid, p_peer_id)::text || ':' || GREATEST(v_uid, p_peer_id)::text;
  SELECT id INTO v_conversation FROM public.conversations WHERE direct_key = v_key;

  IF v_conversation IS NULL THEN
    IF NOT v_is_admin THEN
      IF NOT COALESCE(v_peer_discoverable, false) THEN
        RAISE EXCEPTION 'chat: peer not available';
      END IF;
      IF NOT public.chat_accepts_new_thread(v_uid, p_peer_id) THEN
        RAISE EXCEPTION 'chat: peer not available';
      END IF;
    END IF;
    INSERT INTO public.conversations (tenant_id, kind, direct_key, created_by)
    VALUES (v_tenant, 'direct', v_key, v_uid)
    ON CONFLICT (direct_key) WHERE direct_key IS NOT NULL DO UPDATE SET updated_at = now()
    RETURNING id INTO v_conversation;
    INSERT INTO public.conversation_participants (conversation_id, tenant_id, user_id)
    VALUES (v_conversation, v_tenant, v_uid), (v_conversation, v_tenant, p_peer_id)
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
    v_created := true;
  END IF;

  IF NOT v_created THEN
    UPDATE public.conversation_participants
       SET archived_at = NULL,
           updated_at = now()
     WHERE conversation_id = v_conversation
       AND user_id = v_uid
       AND archived_at IS NOT NULL;

    UPDATE public.conversations
       SET updated_at = now()
     WHERE id = v_conversation;
  END IF;

  RETURN v_conversation;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_or_create_direct_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_direct_conversation(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.filter_group_candidates(p_inviter uuid, p_candidates uuid[])
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(array_agg(c.id), '{}'::uuid[])
    FROM (
      SELECT DISTINCT p.id
        FROM unnest(p_candidates) AS cand(id)
        JOIN public.profiles p ON p.id = cand.id
        JOIN public.profiles inv ON inv.id = p_inviter
       WHERE p.id <> p_inviter
         AND p.tenant_id = inv.tenant_id
         AND NOT public.is_blocked_pair(p_inviter, p.id)
         AND public.chat_accepts_new_thread(p_inviter, p.id)
    ) c;
$$;

COMMENT ON FUNCTION public.filter_group_candidates(uuid, uuid[]) IS
  'Kandydaci na czlonkow kregu: ten sam tenant, brak blokady, zgoda odbiorcy wg chat_accepts_new_thread.';

REVOKE EXECUTE ON FUNCTION public.filter_group_candidates(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.filter_group_candidates(uuid, uuid[]) TO service_role;