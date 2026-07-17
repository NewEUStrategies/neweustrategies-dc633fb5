-- ============================================================================
-- Sieć kontaktów v2 - domknięcia produktowe po pierwszej iteracji
-- (20260717123000):
--
--   1) Prywatność zaproszeń: notification_preferences.allow_connections_from
--      ('everyone' | 'mutual' | 'nobody') egzekwowane w connection_request -
--      odmowa jest nieodróżnialna od niewidocznego profilu ('peer not
--      available'), więc ustawienie nie zdradza się samo.
--   2) connection_statuses v2: wiersz dla KAŻDEGO pytanego id (także 'none'),
--      liczba wspólnych kontaktów (dowód społeczny na kartach) i can_invite
--      (UI chowa przycisk, gdy zaproszenie i tak zostałoby odrzucone).
--   3) connection_suggestions v2: scoring rozszerzony o wspólne dossier
--      (eu_policy_follows) i wspólne wydarzenia (event_rsvps) + przepisanie
--      skorelowanych podzapytań na agregacje JOIN/GROUP BY (skala).
--   4) policy_item_followers: "kto jeszcze śledzi ten plik" - widoczni
--      (discoverable) obserwujący dossier w tenancie wołającego.
--   5) Grupa wydarzenia: events.conversation_id + create_event_group
--      (host/staff) - trwała grupa czatu dla uczestników RSVP 'going'.
--   6) Zgłoszenia użytkowników: user_reports (RPC-only) + kolejka staffu
--      (licznik tenant_pending_counters 'user_reports_open').
--   7) admin_network_stats: metryki sieci per tenant (staff).
--
-- Wszystko idempotentne. Zmiany kolumn wyjściowych funkcji robione przez
-- DROP FUNCTION (lekcja 42P13 z audytu 2026-07-11).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Prywatność zaproszeń
-- ----------------------------------------------------------------------------
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS allow_connections_from text NOT NULL DEFAULT 'everyone';

DO $$ BEGIN
  ALTER TABLE public.notification_preferences
    ADD CONSTRAINT notification_preferences_allow_connections_from_check
    CHECK (allow_connections_from IN ('everyone', 'mutual', 'nobody'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.notification_preferences.allow_connections_from IS
  'Kto może wysłać zaproszenie do sieci: everyone / mutual (wymagany wspólny '
  'kontakt) / nobody. Egzekwowane w connection_request.';

-- Test dopuszczalności ŚWIEŻEGO zaproszenia _requester -> _target.
-- SECURITY DEFINER, bo preferencje adresata nie są czytelne dla klientów;
-- wołane wyłącznie z innych funkcji definer (bez grantu dla authenticated).
CREATE OR REPLACE FUNCTION public.connections_allowed_from(_target uuid, _requester uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE COALESCE(
      (SELECT np.allow_connections_from
         FROM public.notification_preferences np
        WHERE np.user_id = _target),
      'everyone')
    WHEN 'nobody' THEN false
    WHEN 'mutual' THEN EXISTS (
      SELECT 1
        FROM public.user_connections c1
        JOIN public.user_connections c2
          ON c2.status = 'accepted'
         AND _target IN (c2.requester_id, c2.addressee_id)
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

REVOKE EXECUTE ON FUNCTION public.connections_allowed_from(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.connections_allowed_from(uuid, uuid) TO service_role;

-- connection_request: dopięcie testu allow_connections_from dla świeżych
-- zaproszeń (istniejące wiersze - idempotencja i auto-akceptacja - bez zmian:
-- krzyżująca się intencja to wcześniejsza, własna decyzja adresata).
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
    -- Druga strona zapraszała wcześniej mnie -> obopólna intencja.
    UPDATE public.user_connections
       SET status = 'accepted', responded_at = now()
     WHERE id = v_row.id;
    RETURN v_row.id;
  END IF;

  -- Świeże zaproszenie: widoczność adresata + jego polityka przyjmowania.
  -- Ten sam wyjątek dla obu odmów - ustawienie prywatności nie zdradza się.
  IF NOT COALESCE(v_peer_discoverable, false)
     OR NOT public.connections_allowed_from(p_user_id, v_uid) THEN
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

-- ----------------------------------------------------------------------------
-- 2) connection_statuses v2: 'none' + wspólne kontakty + can_invite
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.connection_statuses(uuid[]);

CREATE FUNCTION public.connection_statuses(p_user_ids uuid[])
RETURNS TABLE (
  user_id uuid,
  connection_id uuid,
  status text,
  mutual_count bigint,
  can_invite boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT p.id AS uid, p.tenant_id
      FROM public.profiles p
     WHERE p.id = auth.uid()
  ),
  ids AS (
    SELECT DISTINCT other.id
      FROM unnest(p_user_ids[1:200]) AS other(id), me
     WHERE other.id IS NOT NULL AND other.id <> me.uid
  ),
  mine AS (  -- moi zaakceptowani rozmówcy
    SELECT CASE WHEN c.requester_id = me.uid THEN c.addressee_id
                ELSE c.requester_id END AS peer
      FROM public.user_connections c, me
     WHERE c.status = 'accepted' AND me.uid IN (c.requester_id, c.addressee_id)
  ),
  mutual AS (  -- wspólne kontakty per pytany id (agregacja, bez korelacji)
    SELECT i.id AS uid, count(*) AS cnt
      FROM ids i
      JOIN public.user_connections c
        ON c.status = 'accepted' AND i.id IN (c.requester_id, c.addressee_id)
      JOIN mine m
        ON m.peer = CASE WHEN c.requester_id = i.id
                         THEN c.addressee_id ELSE c.requester_id END
     GROUP BY i.id
  ),
  rel AS (  -- istniejący wiersz relacji ze mną (o ile jest)
    SELECT i.id AS uid, c.id AS connection_id, c.status, c.requester_id, c.addressee_id
      FROM ids i
      CROSS JOIN me
      JOIN public.user_connections c
        ON LEAST(c.requester_id, c.addressee_id) = LEAST(me.uid, i.id)
       AND GREATEST(c.requester_id, c.addressee_id) = GREATEST(me.uid, i.id)
  )
  SELECT
    i.id AS user_id,
    CASE
      -- Odmowa, którą JA wydałem, prezentuje się jak brak relacji.
      WHEN r.status = 'declined' AND r.addressee_id = me.uid THEN NULL
      ELSE r.connection_id
    END AS connection_id,
    CASE
      WHEN r.status = 'accepted' THEN 'connected'
      WHEN r.status = 'declined' AND r.addressee_id = me.uid THEN 'none'
      WHEN r.status IS NOT NULL AND r.requester_id = me.uid THEN 'pending_out'
      WHEN r.status = 'pending' THEN 'pending_in'
      ELSE 'none'
    END AS status,
    COALESCE(mu.cnt, 0) AS mutual_count,
    -- can_invite: czy świeże zaproszenie ma sens (UI chowa przycisk zamiast
    -- serwować odmowę). Dla istniejącej relacji (poza moją cichą odmową)
    -- decyduje maszyna stanów, nie ten test.
    CASE
      WHEN r.status IS NOT NULL
           AND NOT (r.status = 'declined' AND r.addressee_id = me.uid)
        THEN false
      WHEN r.status = 'declined' AND r.addressee_id = me.uid
        THEN true    -- moja cicha odmowa: mogę sam zainicjować (auto-akceptacja)
      ELSE (
        SELECT p.discoverable
               AND p.tenant_id = me.tenant_id
               AND NOT public.is_blocked_pair(me.uid, i.id)
               AND public.connections_allowed_from(i.id, me.uid)
          FROM public.profiles p WHERE p.id = i.id
      )
    END AS can_invite
  FROM ids i
  CROSS JOIN me
  LEFT JOIN rel r ON r.uid = i.id
  LEFT JOIN mutual mu ON mu.uid = i.id
  WHERE auth.uid() IS NOT NULL
$$;

REVOKE EXECUTE ON FUNCTION public.connection_statuses(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.connection_statuses(uuid[]) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3) connection_suggestions v2: wspólne dossier + wspólne wydarzenia,
--    agregacje JOIN/GROUP BY zamiast skorelowanych podzapytań (skala)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.connection_suggestions(integer);

CREATE FUNCTION public.connection_suggestions(p_limit integer DEFAULT 12)
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
  mutual_count bigint,
  shared_follows bigint,
  shared_events bigint
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
  -- Drugi stopień: kontakty moich kontaktów, policzone jedną agregacją.
  mutual AS (
    SELECT x.other_id AS uid, count(*) AS cnt
      FROM (
        SELECT CASE WHEN c.requester_id = m.peer THEN c.addressee_id
                    ELSE c.requester_id END AS other_id
          FROM mine m
          JOIN public.user_connections c
            ON c.status = 'accepted' AND m.peer IN (c.requester_id, c.addressee_id)
      ) x, me
     WHERE x.other_id <> me.id
     GROUP BY x.other_id
  ),
  -- Wspólne dossier trackera: rytuał "żywego dossier" jako sygnał sieci.
  shared_follows AS (
    SELECT f2.user_id AS uid, count(*) AS cnt
      FROM public.eu_policy_follows f1
      JOIN public.eu_policy_follows f2
        ON f2.item_id = f1.item_id AND f2.user_id <> f1.user_id, me
     WHERE f1.user_id = me.id
     GROUP BY f2.user_id
  ),
  -- Wspólne wydarzenia (going/interested): "byliście w tym samym pokoju".
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
     WHERE p.tenant_id = me.tenant_id
       AND p.discoverable
       AND p.id <> me.id
       AND NOT EXISTS (SELECT 1 FROM related r WHERE r.uid = p.id)
       AND NOT public.is_blocked_pair(me.id, p.id)
       AND public.connections_allowed_from(p.id, me.id)
  )
  SELECT
    c.id AS user_id,
    COALESCE(
      NULLIF(btrim(c.display_name), ''),
      NULLIF(btrim(concat_ws(' ', c.first_name, c.last_name)), ''),
      'User'
    ) AS display_name,
    c.avatar_url,
    c.job_title,
    c.current_company,
    c.specialization,
    c.location,
    c.slug,
    (c.verified_at IS NOT NULL) AS verified,
    COALESCE(mu.cnt, 0) AS mutual_count,
    COALESCE(sf.cnt, 0) AS shared_follows,
    COALESCE(se.cnt, 0) AS shared_events
  FROM cand c
  LEFT JOIN mutual mu ON mu.uid = c.id
  LEFT JOIN shared_follows sf ON sf.uid = c.id
  LEFT JOIN shared_events se ON se.uid = c.id
  WHERE auth.uid() IS NOT NULL
  ORDER BY
    -- Wspólne kontakty ważą najmocniej; sygnały treściowe z sufitem (LEAST),
    -- żeby jeden "power-follower" nie zdominował rankingu.
    (COALESCE(mu.cnt, 0) * 3
     + LEAST(COALESCE(sf.cnt, 0), 5) * 2
     + LEAST(COALESCE(se.cnt, 0), 5) * 2
     + CASE WHEN COALESCE(btrim(c.current_company), '') <> ''
            AND lower(btrim(c.current_company))
                = lower(btrim(COALESCE(c.my_company, ''))) THEN 2 ELSE 0 END
     + CASE WHEN COALESCE(btrim(c.specialization), '') <> ''
            AND lower(btrim(c.specialization))
                = lower(btrim(COALESCE(c.my_specialization, ''))) THEN 2 ELSE 0 END
     + CASE WHEN COALESCE(btrim(c.location), '') <> ''
            AND lower(btrim(c.location))
                = lower(btrim(COALESCE(c.my_location, ''))) THEN 1 ELSE 0 END
    ) DESC,
    COALESCE(mu.cnt, 0) DESC,
    lower(COALESCE(NULLIF(btrim(c.display_name), ''),
                   concat_ws(' ', c.first_name, c.last_name))) ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 24)
$$;

REVOKE EXECUTE ON FUNCTION public.connection_suggestions(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.connection_suggestions(integer) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4) "Kto jeszcze śledzi ten plik": widoczni obserwujący dossier
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.policy_item_followers(
  p_item_id uuid,
  p_limit integer DEFAULT 12
)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  job_title text,
  current_company text,
  slug text,
  verified boolean,
  total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  -- Tylko zarejestrowani, tylko opublikowane dossier we własnym tenancie,
  -- tylko profile z opt-in discoverable (ta sama zasada co katalog osób).
  SELECT
    p.id AS user_id,
    COALESCE(
      NULLIF(btrim(p.display_name), ''),
      NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
      'User'
    ) AS display_name,
    p.avatar_url,
    p.job_title,
    p.current_company,
    p.slug,
    (p.verified_at IS NOT NULL) AS verified,
    count(*) OVER () AS total_count
  FROM public.eu_policy_follows f
  JOIN public.eu_policy_items i ON i.id = f.item_id
  JOIN public.profiles p ON p.id = f.user_id
  WHERE auth.uid() IS NOT NULL
    AND f.item_id = p_item_id
    AND i.status = 'published'
    AND i.tenant_id = (SELECT pr.tenant_id FROM public.profiles pr WHERE pr.id = auth.uid())
    AND p.discoverable
    AND p.id <> auth.uid()
    AND p.tenant_id = i.tenant_id
  ORDER BY f.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 24)
$$;

REVOKE EXECUTE ON FUNCTION public.policy_item_followers(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.policy_item_followers(uuid, integer)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5) Wydarzenie jako iskra: trwała grupa czatu dla uczestników RSVP
-- ----------------------------------------------------------------------------
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS conversation_id uuid
    REFERENCES public.conversations(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.events.conversation_id IS
  'Grupa czatu uczestników utworzona przez create_event_group (host/staff). '
  'Konwersja jednorazowego uczestnika w stałego członka społeczności.';

CREATE OR REPLACE FUNCTION public.create_event_group(p_event_id uuid)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_members uuid[];
  v_title text;
  v_conv uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'events: authentication required';
  END IF;

  SELECT * INTO v_event FROM public.events
   WHERE id = p_event_id
   FOR UPDATE;                       -- serializacja podwójnego kliknięcia
  IF NOT FOUND
     OR v_event.tenant_id IS DISTINCT FROM
        (SELECT p.tenant_id FROM public.profiles p WHERE p.id = v_uid) THEN
    RAISE EXCEPTION 'events: event not found';
  END IF;
  IF v_event.status = 'draft' THEN
    RAISE EXCEPTION 'events: event not published';
  END IF;
  IF v_event.host_user_id IS DISTINCT FROM v_uid AND NOT public.is_staff() THEN
    RAISE EXCEPTION 'events: host or staff role required';
  END IF;

  IF v_event.conversation_id IS NOT NULL THEN
    RETURN v_event.conversation_id;  -- idempotencja
  END IF;

  -- Uczestnicy 'going' poza wołającym; limit kręgu (49) z create_group_conversation.
  SELECT COALESCE(array_agg(user_id), '{}') INTO v_members FROM (
    SELECT r.user_id
      FROM public.event_rsvps r
     WHERE r.event_id = p_event_id AND r.status = 'going' AND r.user_id <> v_uid
     ORDER BY r.created_at ASC
     LIMIT 49
  ) going;
  IF COALESCE(array_length(v_members, 1), 0) = 0 THEN
    RAISE EXCEPTION 'events: no attendees to invite';
  END IF;

  v_title := left(btrim(COALESCE(NULLIF(v_event.title_pl, ''), v_event.title_en, 'Event')), 80);
  IF length(v_title) < 2 THEN
    v_title := 'Event';
  END IF;

  -- Reużycie kręgów czatu: filtr kandydatów (blokady, allow_messages_from),
  -- powiadomienia o dodaniu i rola ownera dla wołającego - jedna implementacja.
  v_conv := public.create_group_conversation(v_title, v_members);

  UPDATE public.events SET conversation_id = v_conv WHERE id = p_event_id;
  RETURN v_conv;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_event_group(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_event_group(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6) Zgłoszenia użytkowników (moderacja profesjonalnej społeczności)
-- ----------------------------------------------------------------------------
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

COMMENT ON TABLE public.user_reports IS
  'Zgłoszenia użytkowników do moderacji (spam/nękanie/podszywanie). RPC-only: '
  'report_user dla członków, admin_list/resolve_user_reports dla staffu.';

CREATE INDEX IF NOT EXISTS idx_user_reports_tenant_status
  ON public.user_reports (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_reports_reported
  ON public.user_reports (reported_id);

ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_reports FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.user_reports TO service_role;

-- Licznik kolejki staffu (badge na żywo jak comments_pending).
CREATE OR REPLACE FUNCTION public.tg_user_reports_counters()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
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

-- Zgłoszenie: rate limit 5/24h, dedup otwartego zgłoszenia tej samej pary.
CREATE OR REPLACE FUNCTION public.report_user(
  p_user_id uuid,
  p_reason text,
  p_details text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_target_tenant uuid;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'reports: authentication required';
  END IF;
  IF p_user_id IS NULL OR p_user_id = v_uid THEN
    RAISE EXCEPTION 'reports: invalid target';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN
     ('spam', 'harassment', 'impersonation', 'inappropriate', 'other') THEN
    RAISE EXCEPTION 'reports: invalid reason';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_uid;
  SELECT tenant_id INTO v_target_tenant FROM public.profiles WHERE id = p_user_id;
  IF v_tenant IS NULL OR v_target_tenant IS NULL OR v_tenant <> v_target_tenant THEN
    RAISE EXCEPTION 'reports: target not available';
  END IF;

  -- Dedup: jedno otwarte zgłoszenie pary wystarczy (zwracamy istniejące).
  SELECT id INTO v_id FROM public.user_reports
   WHERE reporter_id = v_uid AND reported_id = p_user_id AND status = 'open';
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  IF (SELECT count(*) FROM public.user_reports
       WHERE reporter_id = v_uid
         AND created_at > now() - interval '1 day') >= 5 THEN
    RAISE EXCEPTION 'reports: rate limited';
  END IF;

  INSERT INTO public.user_reports (tenant_id, reporter_id, reported_id, reason, details)
  VALUES (v_tenant, v_uid, p_user_id, p_reason,
          NULLIF(left(btrim(COALESCE(p_details, '')), 1000), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Kolejka staffu: lista + rozstrzygnięcie (tenant wołającego).
CREATE OR REPLACE FUNCTION public.admin_list_user_reports(
  p_status text DEFAULT 'open',
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  reporter_id uuid,
  reporter_name text,
  reported_id uuid,
  reported_name text,
  reason text,
  details text,
  status text,
  created_at timestamptz,
  resolved_at timestamptz,
  resolution_note text,
  total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.id,
    r.reporter_id,
    COALESCE(NULLIF(btrim(pr.display_name), ''), 'User') AS reporter_name,
    r.reported_id,
    COALESCE(NULLIF(btrim(pd.display_name), ''), 'User') AS reported_name,
    r.reason,
    r.details,
    r.status,
    r.created_at,
    r.resolved_at,
    r.resolution_note,
    count(*) OVER () AS total_count
  FROM public.user_reports r
  LEFT JOIN public.profiles pr ON pr.id = r.reporter_id
  LEFT JOIN public.profiles pd ON pd.id = r.reported_id
  WHERE auth.uid() IS NOT NULL
    AND public.is_staff()
    AND r.tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid())
    AND (COALESCE(btrim(p_status), '') = '' OR r.status = p_status)
  ORDER BY r.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$$;

CREATE OR REPLACE FUNCTION public.admin_resolve_user_report(
  p_report_id uuid,
  p_action text,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.is_staff() THEN
    RAISE EXCEPTION 'reports: staff role required';
  END IF;
  IF p_action NOT IN ('resolved', 'dismissed') THEN
    RAISE EXCEPTION 'reports: invalid action';
  END IF;
  UPDATE public.user_reports r
     SET status = p_action,
         resolved_by = v_uid,
         resolved_at = now(),
         resolution_note = NULLIF(left(btrim(COALESCE(p_note, '')), 1000), '')
   WHERE r.id = p_report_id
     AND r.status = 'open'
     AND r.tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = v_uid);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reports: report not found';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.report_user(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_user_reports(text, integer, integer)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_resolve_user_report(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_user(uuid, text, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_user_reports(text, integer, integer)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_resolve_user_report(uuid, text, text)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7) Metryki sieci per tenant (staff) - "społeczność, nie audytorium"
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_network_stats()
RETURNS TABLE (
  connections_total bigint,
  pending_total bigint,
  invites_30d bigint,
  accepted_30d bigint,
  responded_30d bigint,
  members_with_connection bigint,
  avg_hours_to_accept_30d numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH scope AS (
    SELECT c.*
      FROM public.user_connections c
     WHERE auth.uid() IS NOT NULL
       AND public.is_staff()
       AND c.tenant_id =
           (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid())
  )
  SELECT
    count(*) FILTER (WHERE status = 'accepted') AS connections_total,
    count(*) FILTER (WHERE status = 'pending') AS pending_total,
    count(*) FILTER (WHERE created_at > now() - interval '30 days') AS invites_30d,
    count(*) FILTER (WHERE status = 'accepted'
                       AND responded_at > now() - interval '30 days') AS accepted_30d,
    count(*) FILTER (WHERE status IN ('accepted', 'declined')
                       AND responded_at > now() - interval '30 days') AS responded_30d,
    (SELECT count(DISTINCT u) FROM (
       SELECT requester_id AS u FROM scope WHERE status = 'accepted'
       UNION
       SELECT addressee_id FROM scope WHERE status = 'accepted'
     ) members) AS members_with_connection,
    round((EXTRACT(epoch FROM avg(responded_at - created_at)
             FILTER (WHERE status = 'accepted'
                       AND responded_at > now() - interval '30 days'))
           / 3600.0)::numeric, 1) AS avg_hours_to_accept_30d
  FROM scope
$$;

REVOKE EXECUTE ON FUNCTION public.admin_network_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_network_stats() TO authenticated, service_role;
