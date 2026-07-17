-- ============================================================================
-- Sieć kontaktów (połączenia osoba <-> osoba, wzór LinkedIn) - wyłącznie dla
-- zarejestrowanych użytkowników tego samego tenanta.
--
-- Architektura (zgodna z konwencjami platformy):
--   * public.user_connections - jeden wiersz na parę (unikalny indeks na
--     LEAST/GREATEST), statusy: pending -> accepted | declined.
--   * ZERO grantów SELECT/INSERT/UPDATE/DELETE dla klientów - cała powierzchnia
--     to RPC SECURITY DEFINER (wzorzec event_rsvps/notifications). Dzięki temu
--     odmowa (declined) jest NIEWIDOCZNA dla zapraszającego: jego zaproszenie
--     wygląda na wciąż oczekujące (prywatność jak na LinkedIn), a baza nie
--     zdradza statusu nawet przy bezpośrednim SELECT.
--   * Krzyżujące się zaproszenia = automatyczna akceptacja (obie strony
--     wyraziły intencję). Dotyczy też pary "A zaprosił, B odrzucił, B jednak
--     zaprasza A" - zgoda A wciąż stoi (nie wycofał zaproszenia).
--   * Blokada (user_blocks) uniemożliwia zaproszenie w obie strony, a nowa
--     blokada zrywa istniejące połączenie/zaproszenie (spójność między
--     modułami czatu i sieci).
--   * tenant_id pinowany triggerem z profilu zapraszającego; obie strony muszą
--     należeć do tego samego tenanta (wzorzec get_or_create_direct_conversation).
--   * Powiadomienia: nowy rodzaj 'connection' (enabled_connection w
--     notification_preferences) + licznik user_pending_counters
--     'connections_pending' (badge na żywo przez istniejący Realtime).
--
-- Idempotentne.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Tabela połączeń
-- ----------------------------------------------------------------------------
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

COMMENT ON TABLE public.user_connections IS
  'Połączenia w sieci kontaktów (para użytkowników w obrębie tenanta). '
  'Dostęp wyłącznie przez RPC - brak grantów dla klientów, by nie ujawniać '
  'statusu declined zapraszającemu.';
COMMENT ON COLUMN public.user_connections.message IS
  'Opcjonalna notka do zaproszenia (max 300 znaków), widoczna dla adresata.';

-- Jedna relacja na parę niezależnie od kierunku.
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

-- Świadomie ŻADNYCH polityk ani grantów dla anon/authenticated: RLS bez
-- polityk = deny-all, a service_role omija RLS. Cała powierzchnia to RPC.
REVOKE ALL ON public.user_connections FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.user_connections TO service_role;

-- ----------------------------------------------------------------------------
-- 2) Guard: pinowanie tenanta, niezmienność pary, legalne przejścia statusów
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_user_connections_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req_tenant uuid;
  v_addr_tenant uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT tenant_id INTO v_req_tenant FROM public.profiles WHERE id = NEW.requester_id;
    SELECT tenant_id INTO v_addr_tenant FROM public.profiles WHERE id = NEW.addressee_id;
    IF v_req_tenant IS NULL OR v_addr_tenant IS NULL
       OR v_req_tenant IS DISTINCT FROM v_addr_tenant THEN
      RAISE EXCEPTION 'connections: parties must share a tenant';
    END IF;
    NEW.tenant_id := v_req_tenant;                -- pinowanie tenant_id
    IF NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'connections: new request must start as pending';
    END IF;
    NEW.message := NULLIF(btrim(NEW.message), '');
    NEW.responded_at := NULL;
    RETURN NEW;
  END IF;

  -- UPDATE: para i tenant są niezmienne; dozwolone wyłącznie przejścia
  -- pending->accepted, pending->declined, declined->accepted (krzyżówka).
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
      RAISE EXCEPTION 'connections: illegal status transition % -> %',
        OLD.status, NEW.status;
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

-- ----------------------------------------------------------------------------
-- 3) Powiadomienia: rodzaj 'connection' (+ preferencja enabled_connection)
-- ----------------------------------------------------------------------------
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS enabled_connection boolean NOT NULL DEFAULT true;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('system','comment','follow','subscription','content',
                  'security','message','tracker','connection'))
  NOT VALID;

-- enqueue_notification: dopnij gałąź 'connection' do mapy preferencji.
-- (Wierna kopia najnowszego ciała z 20260714120000 + jedna linia CASE.)
CREATE OR REPLACE FUNCTION public.enqueue_notification(
  p_user_id uuid, p_kind text,
  p_title_pl text, p_title_en text,
  p_body_pl text DEFAULT NULL::text, p_body_en text DEFAULT NULL::text,
  p_href text DEFAULT NULL::text, p_icon text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_id uuid;
  v_enabled boolean;
BEGIN
  IF p_user_id IS NULL OR p_kind IS NULL OR btrim(p_kind) = '' THEN
    RETURN NULL;
  END IF;

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
             ELSE true
           END
      INTO v_enabled
      FROM public.notification_preferences np
     WHERE np.user_id = p_user_id;
    IF v_enabled IS FALSE THEN
      RETURN NULL;
    END IF;
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = p_user_id;
  IF v_tenant IS NULL THEN
    v_tenant := COALESCE(public.public_tenant_id(), public.current_tenant_id());
  END IF;
  IF v_tenant IS NULL THEN
    SELECT id INTO v_tenant FROM public.tenants ORDER BY created_at ASC LIMIT 1;
  END IF;
  IF v_tenant IS NULL THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.user_id = p_user_id
      AND n.kind = p_kind
      AND COALESCE(n.href, '') = COALESCE(p_href, '')
      AND n.created_at > now() - interval '5 minutes'
  ) THEN
    RETURN NULL;
  END IF;

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
  )
  RETURNING id INTO v_id;

  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;

-- Trigger powiadomień: nowe zaproszenie -> adresat; akceptacja -> zapraszający.
-- Odmowa świadomie NIE generuje powiadomienia (cicha, jak na LinkedIn).
CREATE OR REPLACE FUNCTION public.tg_user_connections_notify()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    SELECT COALESCE(
             NULLIF(btrim(p.display_name), ''),
             NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
             'User')
      INTO v_name FROM public.profiles p WHERE p.id = NEW.requester_id;
    PERFORM public.enqueue_notification(
      NEW.addressee_id, 'connection',
      v_name || ' zaprasza Cię do sieci kontaktów',
      v_name || ' invited you to connect',
      NEW.message, NEW.message,
      '/network?tab=received&c=' || NEW.id::text, 'user-plus');
  ELSIF TG_OP = 'UPDATE'
        AND OLD.status IS DISTINCT FROM 'accepted'
        AND NEW.status = 'accepted' THEN
    SELECT COALESCE(
             NULLIF(btrim(p.display_name), ''),
             NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
             'User')
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

-- ----------------------------------------------------------------------------
-- 4) Licznik oczekujących zaproszeń (badge na żywo bez COUNT(*))
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_user_connections_counters()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_pending boolean := TG_OP <> 'INSERT' AND OLD.status = 'pending';
  v_new_pending boolean := TG_OP <> 'DELETE' AND NEW.status = 'pending';
BEGIN
  IF v_old_pending AND NOT v_new_pending THEN
    PERFORM public.bump_user_counter(OLD.tenant_id, OLD.addressee_id,
                                     'connections_pending', -1);
  ELSIF v_new_pending AND NOT v_old_pending THEN
    PERFORM public.bump_user_counter(NEW.tenant_id, NEW.addressee_id,
                                     'connections_pending', 1);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS user_connections_counters_trg ON public.user_connections;
CREATE TRIGGER user_connections_counters_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.user_connections
  FOR EACH ROW EXECUTE FUNCTION public.tg_user_connections_counters();

-- recompute_user_pending_counters: dopnij connections_pending (wierna kopia
-- najnowszego ciała z 20260711220826 + jedna gałąź).
CREATE OR REPLACE FUNCTION public.recompute_user_pending_counters(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_notifications integer;
  v_chat integer;
  v_connections integer;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = p_user_id;
  IF v_tenant IS NULL THEN RETURN; END IF;

  SELECT count(*)::integer INTO v_notifications
    FROM public.notifications WHERE user_id = p_user_id AND read_at IS NULL;
  SELECT COALESCE(sum(unread_count), 0)::integer INTO v_chat
    FROM public.conversation_participants WHERE user_id = p_user_id;
  SELECT count(*)::integer INTO v_connections
    FROM public.user_connections
   WHERE addressee_id = p_user_id AND status = 'pending';

  INSERT INTO public.user_pending_counters (tenant_id, user_id, counter_key, value)
  VALUES
    (v_tenant, p_user_id, 'notifications_unread', v_notifications),
    (v_tenant, p_user_id, 'chat_unread', v_chat),
    (v_tenant, p_user_id, 'connections_pending', v_connections)
  ON CONFLICT (user_id, counter_key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = now();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recompute_user_pending_counters(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_user_pending_counters(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 5) Spójność z blokadami: nowa blokada zrywa relację w dowolnym statusie
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_user_blocks_sever_connection()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
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

-- ----------------------------------------------------------------------------
-- 6) RPC mutacji: zaproszenie / odpowiedź / wycofanie / usunięcie
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.connection_request(
  p_user_id uuid,
  p_message text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_peer_tenant uuid;
  v_peer_discoverable boolean;
  v_row public.user_connections%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'connections: authentication required';
  END IF;
  IF p_user_id IS NULL OR p_user_id = v_uid THEN
    RAISE EXCEPTION 'connections: invalid peer';
  END IF;
  IF public.is_blocked_pair(v_uid, p_user_id) THEN
    RAISE EXCEPTION 'connections: blocked';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_uid;
  SELECT tenant_id, discoverable INTO v_peer_tenant, v_peer_discoverable
    FROM public.profiles WHERE id = p_user_id;
  IF v_tenant IS NULL OR v_peer_tenant IS NULL OR v_tenant <> v_peer_tenant THEN
    RAISE EXCEPTION 'connections: peer not available';
  END IF;

  -- Blokada wyścigu dwóch krzyżujących się zaproszeń: serializacja na parze.
  SELECT * INTO v_row
    FROM public.user_connections c
   WHERE LEAST(c.requester_id, c.addressee_id) = LEAST(v_uid, p_user_id)
     AND GREATEST(c.requester_id, c.addressee_id) = GREATEST(v_uid, p_user_id)
   FOR UPDATE;

  IF FOUND THEN
    IF v_row.status = 'accepted' THEN
      RETURN v_row.id;                                   -- już połączeni
    END IF;
    IF v_row.requester_id = v_uid THEN
      RETURN v_row.id;   -- moje zaproszenie już czeka (declined wygląda tak samo)
    END IF;
    -- Druga strona zapraszała/zapraszała wcześniej mnie -> obopólna intencja.
    UPDATE public.user_connections
       SET status = 'accepted', responded_at = now()
     WHERE id = v_row.id;
    RETURN v_row.id;
  END IF;

  -- Świeże zaproszenie wymaga widoczności adresata w katalogu osób.
  IF NOT COALESCE(v_peer_discoverable, false) THEN
    RAISE EXCEPTION 'connections: peer not available';
  END IF;

  -- Rate limit po stronie DB (klient pisze przez RPC): 30 zaproszeń / 24h.
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
    -- Wyścig krzyżujących się świeżych zaproszeń: przegrany INSERT trafia na
    -- unikalny indeks pary - to obopólna intencja, więc akceptujemy.
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

CREATE OR REPLACE FUNCTION public.connection_respond(
  p_connection_id uuid,
  p_accept boolean
)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.user_connections%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'connections: authentication required';
  END IF;
  SELECT * INTO v_row FROM public.user_connections
   WHERE id = p_connection_id AND addressee_id = v_uid AND status = 'pending'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'connections: request not found';
  END IF;
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
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'connections: authentication required';
  END IF;
  -- Wycofać można oczekujące ORAZ (niewidocznie odrzucone) własne zaproszenie.
  DELETE FROM public.user_connections
   WHERE id = p_connection_id AND requester_id = v_uid
     AND status IN ('pending', 'declined');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'connections: request not found';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.connection_remove(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'connections: authentication required';
  END IF;
  DELETE FROM public.user_connections c
   WHERE c.status = 'accepted'
     AND LEAST(c.requester_id, c.addressee_id) = LEAST(v_uid, p_user_id)
     AND GREATEST(c.requester_id, c.addressee_id) = GREATEST(v_uid, p_user_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'connections: connection not found';
  END IF;
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

-- ----------------------------------------------------------------------------
-- 7) RPC odczytu: moja sieć, zaproszenia, statusy, liczniki
-- ----------------------------------------------------------------------------
-- Uwaga projektowa: funkcje zwracają wyłącznie kolumny profili objęte
-- publicznym grantem SELECT (bez email/prefs), więc SECURITY DEFINER nie
-- poszerza realnie widoczności danych.
CREATE OR REPLACE FUNCTION public.my_connections(
  p_query text DEFAULT '',
  p_limit integer DEFAULT 24,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  connection_id uuid,
  user_id uuid,
  display_name text,
  avatar_url text,
  job_title text,
  current_company text,
  specialization text,
  location text,
  slug text,
  verified boolean,
  connected_at timestamptz,
  total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH q AS (
    SELECT
      unaccent(lower(btrim(COALESCE(p_query, '')))) AS raw,
      replace(replace(replace(
        unaccent(lower(btrim(COALESCE(p_query, '')))),
        '\', '\\'), '%', '\%'), '_', '\_') AS esc
  )
  SELECT
    c.id AS connection_id,
    p.id AS user_id,
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
    c.responded_at AS connected_at,
    count(*) OVER () AS total_count
  FROM public.user_connections c
  JOIN public.profiles p
    ON p.id = CASE WHEN c.requester_id = auth.uid()
                   THEN c.addressee_id ELSE c.requester_id END,
       q
  WHERE auth.uid() IS NOT NULL
    AND c.status = 'accepted'
    AND auth.uid() IN (c.requester_id, c.addressee_id)
    AND (q.raw = '' OR COALESCE(p.discovery_search, '') LIKE '%' || q.esc || '%')
  ORDER BY
    CASE WHEN q.raw <> ''
         THEN similarity(COALESCE(p.discovery_search, ''), q.raw) ELSE 0 END DESC,
    lower(COALESCE(
      NULLIF(btrim(p.display_name), ''),
      concat_ws(' ', p.first_name, p.last_name)
    )) ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 50)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$$;

CREATE OR REPLACE FUNCTION public.my_connection_requests(
  p_direction text DEFAULT 'in',
  p_limit integer DEFAULT 24,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  connection_id uuid,
  user_id uuid,
  display_name text,
  avatar_url text,
  job_title text,
  current_company text,
  specialization text,
  location text,
  slug text,
  verified boolean,
  message text,
  requested_at timestamptz,
  total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  -- 'in'  = oczekujące zaproszenia do mnie;
  -- 'out' = moje wysłane; declined celowo prezentowane jak pending
  --         (odmowa jest niewidoczna dla zapraszającego).
  SELECT
    c.id AS connection_id,
    p.id AS user_id,
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
    c.message,
    c.created_at AS requested_at,
    count(*) OVER () AS total_count
  FROM public.user_connections c
  JOIN public.profiles p
    ON p.id = CASE WHEN p_direction = 'in' THEN c.requester_id ELSE c.addressee_id END
  WHERE auth.uid() IS NOT NULL
    AND (
      (p_direction = 'in'  AND c.addressee_id = auth.uid() AND c.status = 'pending')
      OR
      (p_direction = 'out' AND c.requester_id = auth.uid()
        AND c.status IN ('pending', 'declined'))
    )
  ORDER BY c.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 50)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$$;

-- Status relacji wołającego z partią widocznych profili (np. strona /people).
-- Brak wiersza = brak relacji. Mapowanie chroni prywatność odmowy:
--   accepted -> 'connected'; pending/declined (ja zapraszałem) -> 'pending_out';
--   pending (mnie zaproszono) -> 'pending_in'; declined (ja odmówiłem) -> brak.
CREATE OR REPLACE FUNCTION public.connection_statuses(p_user_ids uuid[])
RETURNS TABLE (user_id uuid, connection_id uuid, status text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    other.id AS user_id,
    c.id AS connection_id,
    CASE
      WHEN c.status = 'accepted' THEN 'connected'
      WHEN c.requester_id = auth.uid() THEN 'pending_out'
      ELSE 'pending_in'
    END AS status
  FROM unnest(p_user_ids[1:200]) AS other(id)
  JOIN public.user_connections c
    ON LEAST(c.requester_id, c.addressee_id) = LEAST(auth.uid(), other.id)
   AND GREATEST(c.requester_id, c.addressee_id) = GREATEST(auth.uid(), other.id)
  WHERE auth.uid() IS NOT NULL
    AND other.id <> auth.uid()
    AND NOT (c.status = 'declined' AND c.addressee_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.my_network_counts()
RETURNS TABLE (connections bigint, pending_in bigint, pending_out bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    count(*) FILTER (WHERE c.status = 'accepted') AS connections,
    count(*) FILTER (WHERE c.status = 'pending'
                       AND c.addressee_id = auth.uid()) AS pending_in,
    count(*) FILTER (WHERE c.status IN ('pending', 'declined')
                       AND c.requester_id = auth.uid()) AS pending_out
  FROM public.user_connections c
  WHERE auth.uid() IS NOT NULL
    AND auth.uid() IN (c.requester_id, c.addressee_id)
$$;

-- ----------------------------------------------------------------------------
-- 8) Sugestie "osoby, które możesz znać" (wspólne kontakty + afiniczność)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.connection_suggestions(p_limit integer DEFAULT 12)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  job_title text,
  current_company text,
  specialization text,
  location text,
  slug text,
  verified boolean,
  mutual_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT p.id, p.tenant_id, p.current_company, p.specialization, p.location
      FROM public.profiles p
     WHERE p.id = auth.uid()
  ),
  mine AS (  -- moi zaakceptowani rozmówcy
    SELECT CASE WHEN c.requester_id = me.id THEN c.addressee_id
                ELSE c.requester_id END AS peer
      FROM public.user_connections c, me
     WHERE c.status = 'accepted' AND me.id IN (c.requester_id, c.addressee_id)
  ),
  related AS (  -- ktokolwiek z JAKĄKOLWIEK relacją ze mną (odpada z sugestii)
    SELECT CASE WHEN c.requester_id = me.id THEN c.addressee_id
                ELSE c.requester_id END AS uid
      FROM public.user_connections c, me
     WHERE me.id IN (c.requester_id, c.addressee_id)
  ),
  cand AS (
    SELECT p.*, me.current_company AS my_company,
           me.specialization AS my_specialization, me.location AS my_location,
           me.id AS my_id
      FROM public.profiles p, me
     WHERE p.tenant_id = me.tenant_id
       AND p.discoverable
       AND p.id <> me.id
       AND NOT EXISTS (SELECT 1 FROM related r WHERE r.uid = p.id)
       AND NOT public.is_blocked_pair(me.id, p.id)
  ),
  scored AS (
    SELECT
      cand.id,
      cand.display_name, cand.first_name, cand.last_name,
      cand.avatar_url, cand.job_title, cand.current_company,
      cand.specialization, cand.location, cand.slug, cand.verified_at,
      (SELECT count(*)
         FROM mine m
         JOIN public.user_connections c2
           ON c2.status = 'accepted'
          AND ((c2.requester_id = m.peer AND c2.addressee_id = cand.id)
            OR (c2.addressee_id = m.peer AND c2.requester_id = cand.id))
      ) AS mutual_count,
      (CASE WHEN COALESCE(btrim(cand.current_company), '') <> ''
              AND lower(btrim(cand.current_company))
                  = lower(btrim(COALESCE(cand.my_company, ''))) THEN 2 ELSE 0 END
       + CASE WHEN COALESCE(btrim(cand.specialization), '') <> ''
              AND lower(btrim(cand.specialization))
                  = lower(btrim(COALESCE(cand.my_specialization, ''))) THEN 2 ELSE 0 END
       + CASE WHEN COALESCE(btrim(cand.location), '') <> ''
              AND lower(btrim(cand.location))
                  = lower(btrim(COALESCE(cand.my_location, ''))) THEN 1 ELSE 0 END
      ) AS affinity
    FROM cand
  )
  SELECT
    s.id AS user_id,
    COALESCE(
      NULLIF(btrim(s.display_name), ''),
      NULLIF(btrim(concat_ws(' ', s.first_name, s.last_name)), ''),
      'User'
    ) AS display_name,
    s.avatar_url,
    s.job_title,
    s.current_company,
    s.specialization,
    s.location,
    s.slug,
    (s.verified_at IS NOT NULL) AS verified,
    s.mutual_count
  FROM scored s
  WHERE auth.uid() IS NOT NULL
  ORDER BY (s.mutual_count * 3 + s.affinity) DESC, s.mutual_count DESC,
           lower(COALESCE(NULLIF(btrim(s.display_name), ''),
                          concat_ws(' ', s.first_name, s.last_name))) ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 24)
$$;

REVOKE EXECUTE ON FUNCTION public.my_connections(text, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_connection_requests(text, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.connection_statuses(uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_network_counts() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.connection_suggestions(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_connections(text, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_connection_requests(text, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.connection_statuses(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_network_counts() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.connection_suggestions(integer) TO authenticated, service_role;
