-- Fix similarity() schema reference and re-run full migration idempotently.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS discovery_search text;

CREATE INDEX IF NOT EXISTS idx_profiles_discovery_search_trgm
  ON public.profiles USING gin (discovery_search extensions.gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.profiles_discovery_search_refresh()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.discovery_search := public.unaccent(lower(concat_ws(' ',
    NEW.display_name, NEW.first_name, NEW.last_name,
    NEW.job_title, NEW.current_company, NEW.specialization, NEW.location, NEW.slug
  )));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_discovery_search_trg ON public.profiles;
CREATE TRIGGER profiles_discovery_search_trg
  BEFORE INSERT OR UPDATE OF display_name, first_name, last_name,
    job_title, current_company, specialization, location, slug
  ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_discovery_search_refresh();

UPDATE public.profiles
   SET discovery_search = public.unaccent(lower(concat_ws(' ',
     display_name, first_name, last_name,
     job_title, current_company, specialization, location, slug)))
 WHERE discovery_search IS NULL;

-- PART 1: user_connections
CREATE TABLE IF NOT EXISTS public.user_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  addressee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined')),
  message text CHECK (message IS NULL OR char_length(message) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CHECK (requester_id <> addressee_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS user_connections_pair_uq
  ON public.user_connections (
    LEAST(requester_id, addressee_id),
    GREATEST(requester_id, addressee_id)
  );
CREATE INDEX IF NOT EXISTS idx_user_connections_addressee
  ON public.user_connections (addressee_id, status);
CREATE INDEX IF NOT EXISTS idx_user_connections_requester
  ON public.user_connections (requester_id, status);
CREATE INDEX IF NOT EXISTS idx_user_connections_tenant
  ON public.user_connections (tenant_id);

ALTER TABLE public.user_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_connections FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.user_connections TO service_role;

CREATE OR REPLACE FUNCTION public.tg_user_connections_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req_tenant uuid; v_addr_tenant uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT tenant_id INTO v_req_tenant FROM public.profiles WHERE id = NEW.requester_id;
    SELECT tenant_id INTO v_addr_tenant FROM public.profiles WHERE id = NEW.addressee_id;
    IF v_req_tenant IS NULL OR v_addr_tenant IS NULL
       OR v_req_tenant IS DISTINCT FROM v_addr_tenant THEN
      RAISE EXCEPTION 'connections: parties must share a tenant';
    END IF;
    NEW.tenant_id := v_req_tenant;
    IF NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'connections: new request must start as pending';
    END IF;
    NEW.message := NULLIF(btrim(NEW.message), '');
    NEW.responded_at := NULL;
    RETURN NEW;
  END IF;
  IF NEW.requester_id IS DISTINCT FROM OLD.requester_id
     OR NEW.addressee_id IS DISTINCT FROM OLD.addressee_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'connections: parties and tenant are immutable';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'pending' AND NEW.status IN ('accepted', 'declined'))
      OR (OLD.status = 'declined' AND NEW.status = 'accepted')
    ) THEN
      RAISE EXCEPTION 'connections: illegal status transition % -> %', OLD.status, NEW.status;
    END IF;
    NEW.responded_at := COALESCE(NEW.responded_at, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_connections_guard_trg ON public.user_connections;
CREATE TRIGGER user_connections_guard_trg
  BEFORE INSERT OR UPDATE ON public.user_connections
  FOR EACH ROW EXECUTE FUNCTION public.tg_user_connections_guard();

-- PART 2: notification prefs
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS enabled_connection boolean NOT NULL DEFAULT true;
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS allow_connections_from text NOT NULL DEFAULT 'everyone';

DO $$ BEGIN
  ALTER TABLE public.notification_preferences
    ADD CONSTRAINT notification_preferences_allow_connections_from_check
    CHECK (allow_connections_from IN ('everyone', 'mutual', 'nobody'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('system','comment','follow','subscription','content',
                  'security','message','tracker','connection'))
  NOT VALID;

CREATE OR REPLACE FUNCTION public.enqueue_notification(
  p_user_id uuid, p_kind text, p_title_pl text, p_title_en text,
  p_body_pl text DEFAULT NULL::text, p_body_en text DEFAULT NULL::text,
  p_href text DEFAULT NULL::text, p_icon text DEFAULT NULL::text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_tenant uuid; v_id uuid; v_enabled boolean;
BEGIN
  IF p_user_id IS NULL OR p_kind IS NULL OR btrim(p_kind) = '' THEN RETURN NULL; END IF;
  IF p_kind <> 'security' THEN
    SELECT CASE p_kind
             WHEN 'message'      THEN np.enabled_message
             WHEN 'comment'      THEN np.enabled_comment
             WHEN 'follow'       THEN np.enabled_follow
             WHEN 'subscription' THEN np.enabled_subscription
             WHEN 'content'      THEN np.enabled_content
             WHEN 'system'       THEN np.enabled_system
             WHEN 'tracker'      THEN np.enabled_tracker
             WHEN 'connection'   THEN np.enabled_connection
             ELSE true END
      INTO v_enabled FROM public.notification_preferences np WHERE np.user_id = p_user_id;
    IF v_enabled IS FALSE THEN RETURN NULL; END IF;
  END IF;
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = p_user_id;
  IF v_tenant IS NULL THEN
    v_tenant := COALESCE(public.public_tenant_id(), public.current_tenant_id());
  END IF;
  IF v_tenant IS NULL THEN
    SELECT id INTO v_tenant FROM public.tenants ORDER BY created_at ASC LIMIT 1;
  END IF;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.notifications n
    WHERE n.user_id = p_user_id AND n.kind = p_kind
      AND COALESCE(n.href, '') = COALESCE(p_href, '')
      AND n.created_at > now() - interval '5 minutes') THEN RETURN NULL; END IF;
  INSERT INTO public.notifications (
    user_id, tenant_id, kind, title_pl, title_en, body_pl, body_en, href, icon
  ) VALUES (
    p_user_id, v_tenant, p_kind,
    COALESCE(NULLIF(btrim(p_title_pl), ''), NULLIF(btrim(p_title_en), ''), p_kind),
    NULLIF(btrim(p_title_en), ''),
    NULLIF(btrim(p_body_pl), ''),
    NULLIF(btrim(p_body_en), ''),
    NULLIF(btrim(p_href), ''),
    NULLIF(btrim(p_icon), '')
  ) RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_user_connections_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_name text;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    SELECT COALESCE(NULLIF(btrim(p.display_name), ''),
             NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'User')
      INTO v_name FROM public.profiles p WHERE p.id = NEW.requester_id;
    PERFORM public.enqueue_notification(
      NEW.addressee_id, 'connection',
      v_name || ' zaprasza Cię do sieci kontaktów',
      v_name || ' invited you to connect',
      NEW.message, NEW.message,
      '/network?tab=received&c=' || NEW.id::text, 'user-plus');
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'accepted' AND NEW.status = 'accepted' THEN
    SELECT COALESCE(NULLIF(btrim(p.display_name), ''),
             NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'User')
      INTO v_name FROM public.profiles p WHERE p.id = NEW.addressee_id;
    PERFORM public.enqueue_notification(
      NEW.requester_id, 'connection',
      v_name || ' jest teraz w Twojej sieci kontaktów',
      v_name || ' is now in your network',
      NULL, NULL,
      '/network?c=' || NEW.id::text, 'users');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_connections_notify_trg ON public.user_connections;
CREATE TRIGGER user_connections_notify_trg
  AFTER INSERT OR UPDATE ON public.user_connections
  FOR EACH ROW EXECUTE FUNCTION public.tg_user_connections_notify();

CREATE OR REPLACE FUNCTION public.tg_user_connections_counters()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old_pending boolean := TG_OP <> 'INSERT' AND OLD.status = 'pending';
  v_new_pending boolean := TG_OP <> 'DELETE' AND NEW.status = 'pending';
BEGIN
  IF v_old_pending AND NOT v_new_pending THEN
    PERFORM public.bump_user_counter(OLD.tenant_id, OLD.addressee_id, 'connections_pending', -1);
  ELSIF v_new_pending AND NOT v_old_pending THEN
    PERFORM public.bump_user_counter(NEW.tenant_id, NEW.addressee_id, 'connections_pending', 1);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS user_connections_counters_trg ON public.user_connections;
CREATE TRIGGER user_connections_counters_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.user_connections
  FOR EACH ROW EXECUTE FUNCTION public.tg_user_connections_counters();

CREATE OR REPLACE FUNCTION public.recompute_user_pending_counters(p_user_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid; v_notifications integer; v_chat integer; v_connections integer;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = p_user_id;
  IF v_tenant IS NULL THEN RETURN; END IF;
  SELECT count(*)::integer INTO v_notifications
    FROM public.notifications WHERE user_id = p_user_id AND read_at IS NULL;
  SELECT COALESCE(sum(unread_count), 0)::integer INTO v_chat
    FROM public.conversation_participants WHERE user_id = p_user_id;
  SELECT count(*)::integer INTO v_connections
    FROM public.user_connections WHERE addressee_id = p_user_id AND status = 'pending';
  INSERT INTO public.user_pending_counters (tenant_id, user_id, counter_key, value)
  VALUES
    (v_tenant, p_user_id, 'notifications_unread', v_notifications),
    (v_tenant, p_user_id, 'chat_unread', v_chat),
    (v_tenant, p_user_id, 'connections_pending', v_connections)
  ON CONFLICT (user_id, counter_key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = now();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recompute_user_pending_counters(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_user_pending_counters(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_user_blocks_sever_connection()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.user_connections c
   WHERE LEAST(c.requester_id, c.addressee_id) = LEAST(NEW.blocker_id, NEW.blocked_id)
     AND GREATEST(c.requester_id, c.addressee_id) = GREATEST(NEW.blocker_id, NEW.blocked_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_blocks_sever_connection_trg ON public.user_blocks;
CREATE TRIGGER user_blocks_sever_connection_trg
  AFTER INSERT ON public.user_blocks
  FOR EACH ROW EXECUTE FUNCTION public.tg_user_blocks_sever_connection();

CREATE OR REPLACE FUNCTION public.connections_allowed_from(_target uuid, _requester uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE COALESCE(
      (SELECT np.allow_connections_from FROM public.notification_preferences np
        WHERE np.user_id = _target), 'everyone')
    WHEN 'nobody' THEN false
    WHEN 'mutual' THEN EXISTS (
      SELECT 1 FROM public.user_connections c1
        JOIN public.user_connections c2
          ON c2.status = 'accepted' AND _target IN (c2.requester_id, c2.addressee_id)
       WHERE c1.status = 'accepted'
         AND _requester IN (c1.requester_id, c1.addressee_id)
         AND CASE WHEN c1.requester_id = _requester
                  THEN c1.addressee_id ELSE c1.requester_id END
             = CASE WHEN c2.requester_id = _target
                    THEN c2.addressee_id ELSE c2.requester_id END
    )
    ELSE true
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.connections_allowed_from(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.connections_allowed_from(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.connection_request(p_user_id uuid, p_message text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_tenant uuid; v_peer_tenant uuid;
  v_peer_discoverable boolean; v_row public.user_connections%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'connections: authentication required'; END IF;
  IF p_user_id IS NULL OR p_user_id = v_uid THEN RAISE EXCEPTION 'connections: invalid peer'; END IF;
  IF public.is_blocked_pair(v_uid, p_user_id) THEN RAISE EXCEPTION 'connections: blocked'; END IF;
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_uid;
  SELECT tenant_id, discoverable INTO v_peer_tenant, v_peer_discoverable
    FROM public.profiles WHERE id = p_user_id;
  IF v_tenant IS NULL OR v_peer_tenant IS NULL OR v_tenant <> v_peer_tenant THEN
    RAISE EXCEPTION 'connections: peer not available';
  END IF;
  SELECT * INTO v_row FROM public.user_connections c
   WHERE LEAST(c.requester_id, c.addressee_id) = LEAST(v_uid, p_user_id)
     AND GREATEST(c.requester_id, c.addressee_id) = GREATEST(v_uid, p_user_id)
   FOR UPDATE;
  IF FOUND THEN
    IF v_row.status = 'accepted' THEN RETURN v_row.id; END IF;
    IF v_row.requester_id = v_uid THEN RETURN v_row.id; END IF;
    UPDATE public.user_connections SET status = 'accepted', responded_at = now() WHERE id = v_row.id;
    RETURN v_row.id;
  END IF;
  IF NOT COALESCE(v_peer_discoverable, false)
     OR NOT public.connections_allowed_from(p_user_id, v_uid) THEN
    RAISE EXCEPTION 'connections: peer not available';
  END IF;
  IF (SELECT count(*) FROM public.user_connections c
       WHERE c.requester_id = v_uid
         AND c.created_at > now() - interval '1 day') >= 30 THEN
    RAISE EXCEPTION 'connections: rate limited';
  END IF;
  BEGIN
    INSERT INTO public.user_connections (tenant_id, requester_id, addressee_id, message)
    VALUES (v_tenant, v_uid, p_user_id, NULLIF(left(btrim(COALESCE(p_message, '')), 300), ''))
    RETURNING id INTO v_row.id;
  EXCEPTION WHEN unique_violation THEN
    UPDATE public.user_connections c
       SET status = 'accepted', responded_at = now()
     WHERE LEAST(c.requester_id, c.addressee_id) = LEAST(v_uid, p_user_id)
       AND GREATEST(c.requester_id, c.addressee_id) = GREATEST(v_uid, p_user_id)
       AND c.status = 'pending' AND c.addressee_id = v_uid
    RETURNING c.id INTO v_row.id;
    IF v_row.id IS NULL THEN
      SELECT c.id INTO v_row.id FROM public.user_connections c
       WHERE LEAST(c.requester_id, c.addressee_id) = LEAST(v_uid, p_user_id)
         AND GREATEST(c.requester_id, c.addressee_id) = GREATEST(v_uid, p_user_id);
    END IF;
  END;
  RETURN v_row.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.connection_respond(p_connection_id uuid, p_accept boolean)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_row public.user_connections%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'connections: authentication required'; END IF;
  SELECT * INTO v_row FROM public.user_connections
   WHERE id = p_connection_id AND addressee_id = v_uid AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'connections: request not found'; END IF;
  IF p_accept AND public.is_blocked_pair(v_row.requester_id, v_row.addressee_id) THEN
    RAISE EXCEPTION 'connections: blocked';
  END IF;
  UPDATE public.user_connections
     SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
         responded_at = now()
   WHERE id = p_connection_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.connection_cancel(p_connection_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'connections: authentication required'; END IF;
  DELETE FROM public.user_connections
   WHERE id = p_connection_id AND requester_id = v_uid AND status IN ('pending', 'declined');
  IF NOT FOUND THEN RAISE EXCEPTION 'connections: request not found'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.connection_remove(p_user_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'connections: authentication required'; END IF;
  DELETE FROM public.user_connections c
   WHERE c.status = 'accepted'
     AND LEAST(c.requester_id, c.addressee_id) = LEAST(v_uid, p_user_id)
     AND GREATEST(c.requester_id, c.addressee_id) = GREATEST(v_uid, p_user_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'connections: connection not found'; END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.connection_request(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.connection_respond(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.connection_cancel(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.connection_remove(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.connection_request(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.connection_respond(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.connection_cancel(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.connection_remove(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.my_connections(
  p_query text DEFAULT '', p_limit integer DEFAULT 24, p_offset integer DEFAULT 0
) RETURNS TABLE (
  connection_id uuid, user_id uuid, display_name text, avatar_url text,
  job_title text, current_company text, specialization text, location text,
  slug text, verified boolean, connected_at timestamptz, total_count bigint
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  WITH q AS (
    SELECT
      unaccent(lower(btrim(COALESCE(p_query, '')))) AS raw,
      replace(replace(replace(unaccent(lower(btrim(COALESCE(p_query, '')))),
        '\', '\\'), '%', '\%'), '_', '\_') AS esc
  )
  SELECT
    c.id, p.id,
    COALESCE(NULLIF(btrim(p.display_name), ''),
      NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'User'),
    p.avatar_url, p.job_title, p.current_company, p.specialization,
    p.location, p.slug, (p.verified_at IS NOT NULL), c.responded_at,
    count(*) OVER ()
  FROM public.user_connections c
  JOIN public.profiles p
    ON p.id = CASE WHEN c.requester_id = auth.uid() THEN c.addressee_id ELSE c.requester_id END,
    q
  WHERE auth.uid() IS NOT NULL AND c.status = 'accepted'
    AND auth.uid() IN (c.requester_id, c.addressee_id)
    AND (q.raw = '' OR COALESCE(p.discovery_search, '') LIKE '%' || q.esc || '%')
  ORDER BY
    CASE WHEN q.raw <> '' THEN similarity(COALESCE(p.discovery_search, ''), q.raw) ELSE 0 END DESC,
    lower(COALESCE(NULLIF(btrim(p.display_name), ''),
                   concat_ws(' ', p.first_name, p.last_name))) ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 50)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$$;

CREATE OR REPLACE FUNCTION public.my_connection_requests(
  p_direction text DEFAULT 'in', p_limit integer DEFAULT 24, p_offset integer DEFAULT 0
) RETURNS TABLE (
  connection_id uuid, user_id uuid, display_name text, avatar_url text,
  job_title text, current_company text, specialization text, location text,
  slug text, verified boolean, message text, requested_at timestamptz, total_count bigint
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    c.id, p.id,
    COALESCE(NULLIF(btrim(p.display_name), ''),
      NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'User'),
    p.avatar_url, p.job_title, p.current_company, p.specialization,
    p.location, p.slug, (p.verified_at IS NOT NULL),
    c.message, c.created_at, count(*) OVER ()
  FROM public.user_connections c
  JOIN public.profiles p
    ON p.id = CASE WHEN p_direction = 'in' THEN c.requester_id ELSE c.addressee_id END
  WHERE auth.uid() IS NOT NULL
    AND (
      (p_direction = 'in'  AND c.addressee_id = auth.uid() AND c.status = 'pending')
      OR
      (p_direction = 'out' AND c.requester_id = auth.uid() AND c.status IN ('pending', 'declined'))
    )
  ORDER BY c.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 50)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$$;

DROP FUNCTION IF EXISTS public.connection_statuses(uuid[]);
CREATE FUNCTION public.connection_statuses(p_user_ids uuid[])
RETURNS TABLE (user_id uuid, connection_id uuid, status text, mutual_count bigint, can_invite boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (
    SELECT p.id AS uid, p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()
  ),
  ids AS (
    SELECT DISTINCT other.id
      FROM unnest(p_user_ids[1:200]) AS other(id), me
     WHERE other.id IS NOT NULL AND other.id <> me.uid
  ),
  mine AS (
    SELECT CASE WHEN c.requester_id = me.uid THEN c.addressee_id ELSE c.requester_id END AS peer
      FROM public.user_connections c, me
     WHERE c.status = 'accepted' AND me.uid IN (c.requester_id, c.addressee_id)
  ),
  mutual AS (
    SELECT i.id AS uid, count(*) AS cnt
      FROM ids i
      JOIN public.user_connections c
        ON c.status = 'accepted' AND i.id IN (c.requester_id, c.addressee_id)
      JOIN mine m
        ON m.peer = CASE WHEN c.requester_id = i.id THEN c.addressee_id ELSE c.requester_id END
     GROUP BY i.id
  ),
  rel AS (
    SELECT i.id AS uid, c.id AS connection_id, c.status, c.requester_id, c.addressee_id
      FROM ids i CROSS JOIN me
      JOIN public.user_connections c
        ON LEAST(c.requester_id, c.addressee_id) = LEAST(me.uid, i.id)
       AND GREATEST(c.requester_id, c.addressee_id) = GREATEST(me.uid, i.id)
  )
  SELECT
    i.id,
    CASE WHEN r.status = 'declined' AND r.addressee_id = me.uid THEN NULL ELSE r.connection_id END,
    CASE
      WHEN r.status = 'accepted' THEN 'connected'
      WHEN r.status = 'declined' AND r.addressee_id = me.uid THEN 'none'
      WHEN r.status IS NOT NULL AND r.requester_id = me.uid THEN 'pending_out'
      WHEN r.status = 'pending' THEN 'pending_in'
      ELSE 'none'
    END,
    COALESCE(mu.cnt, 0),
    CASE
      WHEN r.status IS NOT NULL
           AND NOT (r.status = 'declined' AND r.addressee_id = me.uid) THEN false
      WHEN r.status = 'declined' AND r.addressee_id = me.uid THEN true
      ELSE (
        SELECT p.discoverable AND p.tenant_id = me.tenant_id
               AND NOT public.is_blocked_pair(me.uid, i.id)
               AND public.connections_allowed_from(i.id, me.uid)
          FROM public.profiles p WHERE p.id = i.id
      )
    END
  FROM ids i CROSS JOIN me
  LEFT JOIN rel r ON r.uid = i.id
  LEFT JOIN mutual mu ON mu.uid = i.id
  WHERE auth.uid() IS NOT NULL
$$;

REVOKE EXECUTE ON FUNCTION public.connection_statuses(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.connection_statuses(uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.my_network_counts()
RETURNS TABLE (connections bigint, pending_in bigint, pending_out bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    count(*) FILTER (WHERE c.status = 'accepted'),
    count(*) FILTER (WHERE c.status = 'pending' AND c.addressee_id = auth.uid()),
    count(*) FILTER (WHERE c.status IN ('pending', 'declined') AND c.requester_id = auth.uid())
  FROM public.user_connections c
  WHERE auth.uid() IS NOT NULL AND auth.uid() IN (c.requester_id, c.addressee_id)
$$;

DROP FUNCTION IF EXISTS public.connection_suggestions(integer);
CREATE FUNCTION public.connection_suggestions(p_limit integer DEFAULT 12)
RETURNS TABLE (
  user_id uuid, display_name text, avatar_url text, job_title text,
  current_company text, specialization text, location text, slug text,
  verified boolean, mutual_count bigint, shared_follows bigint, shared_events bigint
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (
    SELECT p.id, p.tenant_id, p.current_company, p.specialization, p.location
      FROM public.profiles p WHERE p.id = auth.uid()
  ),
  mine AS (
    SELECT CASE WHEN c.requester_id = me.id THEN c.addressee_id ELSE c.requester_id END AS peer
      FROM public.user_connections c, me
     WHERE c.status = 'accepted' AND me.id IN (c.requester_id, c.addressee_id)
  ),
  related AS (
    SELECT CASE WHEN c.requester_id = me.id THEN c.addressee_id ELSE c.requester_id END AS uid
      FROM public.user_connections c, me
     WHERE me.id IN (c.requester_id, c.addressee_id)
  ),
  mutual AS (
    SELECT x.other_id AS uid, count(*) AS cnt
      FROM (
        SELECT CASE WHEN c.requester_id = m.peer THEN c.addressee_id ELSE c.requester_id END AS other_id
          FROM mine m
          JOIN public.user_connections c
            ON c.status = 'accepted' AND m.peer IN (c.requester_id, c.addressee_id)
      ) x, me
     WHERE x.other_id <> me.id
     GROUP BY x.other_id
  ),
  shared_follows AS (
    SELECT f2.user_id AS uid, count(*) AS cnt
      FROM public.eu_policy_follows f1
      JOIN public.eu_policy_follows f2
        ON f2.item_id = f1.item_id AND f2.user_id <> f1.user_id, me
     WHERE f1.user_id = me.id
     GROUP BY f2.user_id
  ),
  shared_events AS (
    SELECT r2.user_id AS uid, count(*) AS cnt
      FROM public.event_rsvps r1
      JOIN public.event_rsvps r2
        ON r2.event_id = r1.event_id AND r2.user_id <> r1.user_id, me
     WHERE r1.user_id = me.id
       AND r1.status IN ('going', 'interested')
       AND r2.status IN ('going', 'interested')
     GROUP BY r2.user_id
  ),
  cand AS (
    SELECT p.*, me.id AS my_id, me.current_company AS my_company,
           me.specialization AS my_specialization, me.location AS my_location
      FROM public.profiles p, me
     WHERE p.tenant_id = me.tenant_id AND p.discoverable AND p.id <> me.id
       AND NOT EXISTS (SELECT 1 FROM related r WHERE r.uid = p.id)
       AND NOT public.is_blocked_pair(me.id, p.id)
       AND public.connections_allowed_from(p.id, me.id)
  )
  SELECT
    c.id,
    COALESCE(NULLIF(btrim(c.display_name), ''),
      NULLIF(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), 'User'),
    c.avatar_url, c.job_title, c.current_company, c.specialization,
    c.location, c.slug, (c.verified_at IS NOT NULL),
    COALESCE(mu.cnt, 0), COALESCE(sf.cnt, 0), COALESCE(se.cnt, 0)
  FROM cand c
  LEFT JOIN mutual mu ON mu.uid = c.id
  LEFT JOIN shared_follows sf ON sf.uid = c.id
  LEFT JOIN shared_events se ON se.uid = c.id
  WHERE auth.uid() IS NOT NULL
  ORDER BY
    (COALESCE(mu.cnt, 0) * 3
     + LEAST(COALESCE(sf.cnt, 0), 5) * 2
     + LEAST(COALESCE(se.cnt, 0), 5) * 2
     + CASE WHEN COALESCE(btrim(c.current_company), '') <> ''
            AND lower(btrim(c.current_company)) = lower(btrim(COALESCE(c.my_company, ''))) THEN 2 ELSE 0 END
     + CASE WHEN COALESCE(btrim(c.specialization), '') <> ''
            AND lower(btrim(c.specialization)) = lower(btrim(COALESCE(c.my_specialization, ''))) THEN 2 ELSE 0 END
     + CASE WHEN COALESCE(btrim(c.location), '') <> ''
            AND lower(btrim(c.location)) = lower(btrim(COALESCE(c.my_location, ''))) THEN 1 ELSE 0 END
    ) DESC,
    COALESCE(mu.cnt, 0) DESC,
    lower(COALESCE(NULLIF(btrim(c.display_name), ''),
                   concat_ws(' ', c.first_name, c.last_name))) ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 24)
$$;

REVOKE EXECUTE ON FUNCTION public.my_connections(text, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_connection_requests(text, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_network_counts() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.connection_suggestions(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_connections(text, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_connection_requests(text, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_network_counts() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.connection_suggestions(integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.policy_item_followers(
  p_item_id uuid, p_limit integer DEFAULT 12
) RETURNS TABLE (
  user_id uuid, display_name text, avatar_url text, job_title text,
  current_company text, slug text, verified boolean, total_count bigint
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    p.id,
    COALESCE(NULLIF(btrim(p.display_name), ''),
      NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'User'),
    p.avatar_url, p.job_title, p.current_company, p.slug,
    (p.verified_at IS NOT NULL), count(*) OVER ()
  FROM public.eu_policy_follows f
  JOIN public.eu_policy_items i ON i.id = f.item_id
  JOIN public.profiles p ON p.id = f.user_id
  WHERE auth.uid() IS NOT NULL
    AND f.item_id = p_item_id
    AND i.status = 'published'
    AND i.tenant_id = (SELECT pr.tenant_id FROM public.profiles pr WHERE pr.id = auth.uid())
    AND p.discoverable AND p.id <> auth.uid() AND p.tenant_id = i.tenant_id
  ORDER BY f.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 24)
$$;

REVOKE EXECUTE ON FUNCTION public.policy_item_followers(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.policy_item_followers(uuid, integer) TO authenticated, service_role;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS conversation_id uuid
    REFERENCES public.conversations(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.create_event_group(p_event_id uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid(); v_event public.events%ROWTYPE;
  v_members uuid[]; v_title text; v_conv uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'events: authentication required'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.tenant_id IS DISTINCT FROM
        (SELECT p.tenant_id FROM public.profiles p WHERE p.id = v_uid) THEN
    RAISE EXCEPTION 'events: event not found';
  END IF;
  IF v_event.status = 'draft' THEN RAISE EXCEPTION 'events: event not published'; END IF;
  IF v_event.host_user_id IS DISTINCT FROM v_uid AND NOT public.is_staff() THEN
    RAISE EXCEPTION 'events: host or staff role required';
  END IF;
  IF v_event.conversation_id IS NOT NULL THEN RETURN v_event.conversation_id; END IF;
  SELECT COALESCE(array_agg(user_id), '{}') INTO v_members FROM (
    SELECT r.user_id FROM public.event_rsvps r
     WHERE r.event_id = p_event_id AND r.status = 'going' AND r.user_id <> v_uid
     ORDER BY r.created_at ASC LIMIT 49
  ) going;
  IF COALESCE(array_length(v_members, 1), 0) = 0 THEN
    RAISE EXCEPTION 'events: no attendees to invite';
  END IF;
  v_title := left(btrim(COALESCE(NULLIF(v_event.title_pl, ''), v_event.title_en, 'Event')), 80);
  IF length(v_title) < 2 THEN v_title := 'Event'; END IF;
  v_conv := public.create_group_conversation(v_title, v_members);
  UPDATE public.events SET conversation_id = v_conv WHERE id = p_event_id;
  RETURN v_conv;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_event_group(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_event_group(uuid) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.user_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reported_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL
    CHECK (reason IN ('spam', 'harassment', 'impersonation', 'inappropriate', 'other')),
  details text CHECK (details IS NULL OR char_length(details) <= 1000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (reporter_id <> reported_id)
);

CREATE INDEX IF NOT EXISTS idx_user_reports_tenant_status
  ON public.user_reports (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_reports_reported
  ON public.user_reports (reported_id);

ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_reports FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.user_reports TO service_role;

CREATE OR REPLACE FUNCTION public.tg_user_reports_counters()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old_open boolean := TG_OP <> 'INSERT' AND OLD.status = 'open';
  v_new_open boolean := TG_OP <> 'DELETE' AND NEW.status = 'open';
BEGIN
  IF v_old_open AND NOT v_new_open THEN
    PERFORM public.bump_tenant_counter(OLD.tenant_id, 'user_reports_open', -1);
  ELSIF v_new_open AND NOT v_old_open THEN
    PERFORM public.bump_tenant_counter(NEW.tenant_id, 'user_reports_open', 1);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS user_reports_counters_trg ON public.user_reports;
CREATE TRIGGER user_reports_counters_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.user_reports
  FOR EACH ROW EXECUTE FUNCTION public.tg_user_reports_counters();

CREATE OR REPLACE FUNCTION public.report_user(
  p_user_id uuid, p_reason text, p_details text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_tenant uuid; v_target_tenant uuid; v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'reports: authentication required'; END IF;
  IF p_user_id IS NULL OR p_user_id = v_uid THEN RAISE EXCEPTION 'reports: invalid target'; END IF;
  IF p_reason IS NULL OR p_reason NOT IN
     ('spam', 'harassment', 'impersonation', 'inappropriate', 'other') THEN
    RAISE EXCEPTION 'reports: invalid reason';
  END IF;
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_uid;
  SELECT tenant_id INTO v_target_tenant FROM public.profiles WHERE id = p_user_id;
  IF v_tenant IS NULL OR v_target_tenant IS NULL OR v_tenant <> v_target_tenant THEN
    RAISE EXCEPTION 'reports: target not available';
  END IF;
  SELECT id INTO v_id FROM public.user_reports
   WHERE reporter_id = v_uid AND reported_id = p_user_id AND status = 'open';
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  IF (SELECT count(*) FROM public.user_reports
       WHERE reporter_id = v_uid AND created_at > now() - interval '1 day') >= 5 THEN
    RAISE EXCEPTION 'reports: rate limited';
  END IF;
  INSERT INTO public.user_reports (tenant_id, reporter_id, reported_id, reason, details)
  VALUES (v_tenant, v_uid, p_user_id, p_reason,
          NULLIF(left(btrim(COALESCE(p_details, '')), 1000), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_user_reports(
  p_status text DEFAULT 'open', p_limit integer DEFAULT 50, p_offset integer DEFAULT 0
) RETURNS TABLE (
  id uuid, reporter_id uuid, reporter_name text, reported_id uuid, reported_name text,
  reason text, details text, status text, created_at timestamptz,
  resolved_at timestamptz, resolution_note text, total_count bigint
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    r.id, r.reporter_id,
    COALESCE(NULLIF(btrim(pr.display_name), ''), 'User'),
    r.reported_id,
    COALESCE(NULLIF(btrim(pd.display_name), ''), 'User'),
    r.reason, r.details, r.status, r.created_at, r.resolved_at, r.resolution_note,
    count(*) OVER ()
  FROM public.user_reports r
  LEFT JOIN public.profiles pr ON pr.id = r.reporter_id
  LEFT JOIN public.profiles pd ON pd.id = r.reported_id
  WHERE auth.uid() IS NOT NULL AND public.is_staff()
    AND r.tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid())
    AND (COALESCE(btrim(p_status), '') = '' OR r.status = p_status)
  ORDER BY r.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$$;

CREATE OR REPLACE FUNCTION public.admin_resolve_user_report(
  p_report_id uuid, p_action text, p_note text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.is_staff() THEN
    RAISE EXCEPTION 'reports: staff role required';
  END IF;
  IF p_action NOT IN ('resolved', 'dismissed') THEN
    RAISE EXCEPTION 'reports: invalid action';
  END IF;
  UPDATE public.user_reports r
     SET status = p_action, resolved_by = v_uid, resolved_at = now(),
         resolution_note = NULLIF(left(btrim(COALESCE(p_note, '')), 1000), '')
   WHERE r.id = p_report_id AND r.status = 'open'
     AND r.tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = v_uid);
  IF NOT FOUND THEN RAISE EXCEPTION 'reports: report not found'; END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.report_user(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_user_reports(text, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_resolve_user_report(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_user(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_user_reports(text, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_resolve_user_report(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_network_stats()
RETURNS TABLE (
  connections_total bigint, pending_total bigint, invites_30d bigint,
  accepted_30d bigint, responded_30d bigint, members_with_connection bigint,
  avg_hours_to_accept_30d numeric
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH scope AS (
    SELECT c.* FROM public.user_connections c
     WHERE auth.uid() IS NOT NULL AND public.is_staff()
       AND c.tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid())
  )
  SELECT
    count(*) FILTER (WHERE status = 'accepted'),
    count(*) FILTER (WHERE status = 'pending'),
    count(*) FILTER (WHERE created_at > now() - interval '30 days'),
    count(*) FILTER (WHERE status = 'accepted' AND responded_at > now() - interval '30 days'),
    count(*) FILTER (WHERE status IN ('accepted', 'declined') AND responded_at > now() - interval '30 days'),
    (SELECT count(DISTINCT u) FROM (
       SELECT requester_id AS u FROM scope WHERE status = 'accepted'
       UNION SELECT addressee_id FROM scope WHERE status = 'accepted'
     ) members),
    round((EXTRACT(epoch FROM avg(responded_at - created_at)
             FILTER (WHERE status = 'accepted' AND responded_at > now() - interval '30 days'))
           / 3600.0)::numeric, 1)
  FROM scope
$$;

REVOKE EXECUTE ON FUNCTION public.admin_network_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_network_stats() TO authenticated, service_role;
