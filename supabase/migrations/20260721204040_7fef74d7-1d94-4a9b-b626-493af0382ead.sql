
-- Helper: czy dwie osoby są w zaakceptowanej sieci kontaktów (dowolny kierunek).
CREATE OR REPLACE FUNCTION public.is_connected_pair(_a uuid, _b uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_connections uc
    WHERE uc.status = 'accepted'
      AND (
        (uc.requester_id = _a AND uc.addressee_id = _b)
        OR (uc.requester_id = _b AND uc.addressee_id = _a)
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_connected_pair(uuid, uuid) TO authenticated;

-- search_people: super_admin widzi wszystkich; pozostali tylko zaakceptowane kontakty.
CREATE OR REPLACE FUNCTION public.search_people(
  p_query text DEFAULT NULL::text,
  p_specialization text DEFAULT NULL::text,
  p_company text DEFAULT NULL::text,
  p_location text DEFAULT NULL::text,
  p_limit integer DEFAULT 24,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(id uuid, display_name text, avatar_url text, job_title text, current_company text, specialization text, location text, slug text, total_count bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH me AS (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()),
  is_admin AS (SELECT public.is_super_admin(auth.uid()) AS ok),
  base AS (
    SELECT p.id, p.display_name, p.avatar_url, p.job_title,
           p.current_company, p.specialization, p.location, p.slug
    FROM public.profiles p, me, is_admin
    WHERE p.discoverable = true
      AND p.tenant_id = me.tenant_id
      AND p.id <> auth.uid()
      AND (
        is_admin.ok
        OR EXISTS (
          SELECT 1 FROM public.user_connections uc
          WHERE uc.status = 'accepted'
            AND (
              (uc.requester_id = auth.uid() AND uc.addressee_id = p.id)
              OR (uc.addressee_id = auth.uid() AND uc.requester_id = p.id)
            )
        )
      )
      AND (p_specialization IS NULL OR p.specialization = p_specialization)
      AND (p_company IS NULL OR p.current_company = p_company)
      AND (p_location IS NULL OR p.location = p_location)
      AND (
        coalesce(p_query, '') = ''
        OR p.display_name    ILIKE '%' || p_query || '%'
        OR p.first_name      ILIKE '%' || p_query || '%'
        OR p.last_name       ILIKE '%' || p_query || '%'
        OR p.job_title       ILIKE '%' || p_query || '%'
        OR p.current_company ILIKE '%' || p_query || '%'
        OR p.specialization  ILIKE '%' || p_query || '%'
        OR p.location        ILIKE '%' || p_query || '%'
      )
  ),
  counted AS (SELECT count(*) AS c FROM base)
  SELECT b.id, b.display_name, b.avatar_url, b.job_title,
         b.current_company, b.specialization, b.location, b.slug,
         (SELECT c FROM counted) AS total_count
  FROM base b
  ORDER BY b.display_name NULLS LAST
  OFFSET GREATEST(p_offset, 0)
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;

-- get_or_create_direct_conversation: wymaga zaakceptowanego kontaktu (poza super_adminem).
CREATE OR REPLACE FUNCTION public.get_or_create_direct_conversation(p_peer_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_peer_tenant uuid;
  v_peer_discoverable boolean;
  v_key text;
  v_conversation uuid;
  v_is_admin boolean;
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

  -- Sieć kontaktów: musi istnieć zaakceptowane połączenie (chyba że super_admin).
  IF NOT v_is_admin AND NOT public.is_connected_pair(v_uid, p_peer_id) THEN
    RAISE EXCEPTION 'chat: not in your network';
  END IF;

  v_key := v_tenant::text || ':' || LEAST(v_uid, p_peer_id)::text || ':' || GREATEST(v_uid, p_peer_id)::text;
  SELECT id INTO v_conversation FROM public.conversations WHERE direct_key = v_key;

  IF v_conversation IS NULL THEN
    IF NOT v_is_admin THEN
      IF NOT COALESCE(v_peer_discoverable, false) THEN
        RAISE EXCEPTION 'chat: peer not available';
      END IF;
      IF public.chat_allow_messages_from(p_peer_id) NOT IN ('everyone','contacts') THEN
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
  END IF;

  RETURN v_conversation;
END;
$$;
