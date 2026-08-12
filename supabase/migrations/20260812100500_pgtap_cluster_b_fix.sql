-- ============================================================================
-- STOPIEŃ ODDALENIA I MOST: scalenie dwóch rozjechanych kontraktów
-- (connection_statuses / connection_suggestions).
--
-- Stan zastany w bazie pochodzi z 20260807143000_connection_suggestion_feedback,
-- która przepisała OBIE funkcje od nowa na bazie wersji v2 (20260717170000).
-- Jej nagłówek opisuje `degree` jako świeży dodatek („liczony w CTE mutual, ale
-- wychodzi tylko jako mutual_count"), czyli stan sprzed 20260807100000
-- _connection_degree - a ponieważ sortuje się PÓŹNIEJ, jej DROP FUNCTION +
-- CREATE FUNCTION skasowały to, co 20260807100000 wprowadziła:
--
--   1) kolumny mostu (bridge_id / bridge_name / bridge_avatar / bridge_slug)
--      w OBU funkcjach - a z nimi całą powierzchnię „przez kogo": prośbę
--      o wprowadzenie (request_introduction), etykietę „2° · przez Annę Nowak"
--      i regułę prywatności mostu;
--   2) semantykę `degree`: zamiast 0/1/2/3 (0 = poza zasięgiem) w bazie został
--      wariant 1/2/„3+", w którym KAŻDA osoba bez wspólnego kontaktu - także
--      profil bez ani jednej krawędzi i profil z obcego tenanta - wraca jako
--      degree = 3.
--
-- Punkt 2 jest widoczny dla użytkownika jako nieprawdziwe twierdzenie o jego
-- sieci: interfejs renderuje dla degree = 3 opis „Kontakt 3. stopnia - dwa
-- kroki od Twojej sieci" / „two steps from your network"
-- (src/lib/i18n-network.ts), a klient traktuje 0 jako „nic nie twierdzimy"
-- i wtedy odznaki nie pokazuje (isDegreeVisible w src/lib/network/degree.ts).
-- Kontrakt kliencki (ConnectionDegree = 0 | 1 | 2 | 3 + BridgeColumns w
-- src/lib/network/degree.ts, kolumny mostu w src/integrations/supabase/types.ts
-- dla obu RPC) opisuje SUMĘ obu migracji - i tę sumę odtwarza ten plik:
--
--   * z 20260807100000: degree 0/1/2/3, spacer po grafie do trzeciego stopnia,
--     most 1. stopnia z regułą prywatności (nazywamy WYŁĄCZNIE własny kontakt
--     z opt-inem `discoverable`; środkowy węzeł ścieżki 3. stopnia zostaje
--     nieujawniony) oraz punkt rankingowy za 3. stopień;
--   * z 20260807143000: odsiew świadomie odrzuconych sugestii
--     (connection_suggestion_dismissals), kolumny `open_to` i
--     `completeness_score` w projekcji sugestii i ich składniki rankingu.
--
-- Forward-only i idempotentne. Zmiana listy kolumn wyjściowych wymaga
-- DROP FUNCTION (42P13).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) connection_statuses: stopień 0/1/2/3 + most 1. stopnia
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.connection_statuses(uuid[]);

CREATE FUNCTION public.connection_statuses(p_user_ids uuid[])
RETURNS TABLE (
  user_id uuid,
  connection_id uuid,
  status text,
  mutual_count bigint,
  can_invite boolean,
  degree smallint,
  bridge_id uuid,
  bridge_name text,
  bridge_avatar text,
  bridge_slug text
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
  mine AS (  -- moi zaakceptowani rozmówcy (1. stopień) + „od kiedy"
    SELECT CASE WHEN c.requester_id = me.uid THEN c.addressee_id
                ELSE c.requester_id END AS peer,
           c.responded_at AS since
      FROM public.user_connections c, me
     WHERE c.status = 'accepted' AND me.uid IN (c.requester_id, c.addressee_id)
  ),
  peer_edges AS (  -- krawędzie osób PYTANYCH (partia z jednej strony listy)
    SELECT i.id AS uid,
           CASE WHEN c.requester_id = i.id THEN c.addressee_id
                ELSE c.requester_id END AS other
      FROM ids i
      JOIN public.user_connections c
        ON c.status = 'accepted' AND i.id IN (c.requester_id, c.addressee_id)
  ),
  second_pairs AS (  -- (osoba w 2. stopniu, mój kontakt-most, od kiedy)
    SELECT CASE WHEN c.requester_id = m.peer THEN c.addressee_id
                ELSE c.requester_id END AS uid,
           m.peer AS via,
           m.since AS via_since
      FROM mine m
      JOIN public.user_connections c
        ON c.status = 'accepted' AND m.peer IN (c.requester_id, c.addressee_id)
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
    END AS can_invite,
    -- Stopień: 1 połączeni, 2 wspólny kontakt, 3 dwa skoki od mojej sieci,
    -- 0 poza zasięgiem. Zero jest osobną wartością, bo interfejs pokazuje
    -- odznakę WYŁĄCZNIE dla 1/2/3 - „3+" dla obcej osoby byłoby twierdzeniem
    -- o sieci, którego graf nie potwierdza.
    (CASE
      WHEN r.status = 'accepted' THEN 1
      WHEN COALESCE(mu.cnt, 0) > 0 THEN 2
      WHEN b3.reachable THEN 3
      ELSE 0
    END)::smallint AS degree,
    -- Most: wyłącznie MÓJ kontakt 1. stopnia z opt-inem discoverable.
    -- 1. stopień nie ma mostu (nie ma czego mostkować), 0. też nie.
    CASE WHEN r.status = 'accepted' THEN NULL
         WHEN COALESCE(mu.cnt, 0) > 0 THEN b2.via_id
         WHEN b3.reachable THEN b3.via_id END AS bridge_id,
    CASE WHEN r.status = 'accepted' THEN NULL
         WHEN COALESCE(mu.cnt, 0) > 0 THEN b2.via_name
         WHEN b3.reachable THEN b3.via_name END AS bridge_name,
    CASE WHEN r.status = 'accepted' THEN NULL
         WHEN COALESCE(mu.cnt, 0) > 0 THEN b2.via_avatar
         WHEN b3.reachable THEN b3.via_avatar END AS bridge_avatar,
    CASE WHEN r.status = 'accepted' THEN NULL
         WHEN COALESCE(mu.cnt, 0) > 0 THEN b2.via_slug
         WHEN b3.reachable THEN b3.via_slug END AS bridge_slug
  FROM ids i
  CROSS JOIN me
  LEFT JOIN rel r ON r.uid = i.id
  LEFT JOIN mutual mu ON mu.uid = i.id
  -- Most 2. stopnia: wspólny kontakt. Kolejność deterministyczna i sensowna
  -- produktowo - najpierw ten, kogo znam NAJDŁUŻEJ (największa szansa, że
  -- realnie zrobi wprowadzenie), potem alfabetycznie.
  LEFT JOIN LATERAL (
    SELECT pb.id AS via_id,
           COALESCE(NULLIF(btrim(pb.display_name), ''),
                    NULLIF(btrim(concat_ws(' ', pb.first_name, pb.last_name)), ''),
                    'User') AS via_name,
           pb.avatar_url AS via_avatar,
           pb.slug AS via_slug
      FROM second_pairs sp
      JOIN public.profiles pb ON pb.id = sp.via
     WHERE sp.uid = i.id
       AND pb.discoverable
       AND pb.tenant_id = me.tenant_id
     ORDER BY sp.via_since ASC NULLS LAST,
              lower(COALESCE(NULLIF(btrim(pb.display_name), ''),
                             concat_ws(' ', pb.first_name, pb.last_name))) ASC,
              pb.id ASC
     LIMIT 1
  ) b2 ON true
  -- 3. stopień: mój kontakt -> jego kontakt (spoza mojej sieci) -> pytany.
  -- `reachable` jest niezależne od discoverable (dystans to fakt grafu),
  -- ale NAZWA mostu już nie - stąd sortowanie „discoverable najpierw"
  -- i wyzerowanie pól tożsamości, gdy najlepszy most jest ukryty.
  LEFT JOIN LATERAL (
    SELECT true AS reachable,
           CASE WHEN pb.discoverable THEN pb.id END AS via_id,
           CASE WHEN pb.discoverable THEN
             COALESCE(NULLIF(btrim(pb.display_name), ''),
                      NULLIF(btrim(concat_ws(' ', pb.first_name, pb.last_name)), ''),
                      'User') END AS via_name,
           CASE WHEN pb.discoverable THEN pb.avatar_url END AS via_avatar,
           CASE WHEN pb.discoverable THEN pb.slug END AS via_slug
      FROM peer_edges pe
      JOIN second_pairs sp ON sp.uid = pe.other
      JOIN public.profiles pb ON pb.id = sp.via
     WHERE pe.uid = i.id
       AND pe.other <> me.uid
       AND NOT EXISTS (SELECT 1 FROM mine m WHERE m.peer = pe.other)
       AND pb.tenant_id = me.tenant_id
     ORDER BY (pb.discoverable) DESC,
              sp.via_since ASC NULLS LAST,
              pb.id ASC
     LIMIT 1
  ) b3 ON true
  WHERE auth.uid() IS NOT NULL
$$;

COMMENT ON FUNCTION public.connection_statuses(uuid[]) IS
  'Stan relacji + STOPIEŃ ODDALENIA (0/1/2/3) i most 1. stopnia dla partii '
  'profili. Most nazywamy tylko dla własnych kontaktów z opt-inem discoverable; '
  'środkowy węzeł ścieżki 3. stopnia pozostaje anonimowy.';

REVOKE EXECUTE ON FUNCTION public.connection_statuses(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.connection_statuses(uuid[]) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2) connection_suggestions: ten sam stopień i most + pamięć decyzji,
--    intencje (`open_to`) i kompletność profilu w rankingu
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
  shared_events bigint,
  degree smallint,
  bridge_id uuid,
  bridge_name text,
  bridge_avatar text,
  bridge_slug text,
  open_to text[],
  completeness_score smallint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT p.id, p.tenant_id, p.current_company, p.specialization, p.location, p.open_to
      FROM public.profiles p
     WHERE p.id = auth.uid()
  ),
  mine AS (  -- moi zaakceptowani rozmówcy + „od kiedy"
    SELECT CASE WHEN c.requester_id = me.id THEN c.addressee_id
                ELSE c.requester_id END AS peer,
           c.responded_at AS since
      FROM public.user_connections c, me
     WHERE c.status = 'accepted' AND me.id IN (c.requester_id, c.addressee_id)
  ),
  related AS (  -- ktokolwiek z JAKĄKOLWIEK relacją ze mną (odpada z sugestii)
    SELECT CASE WHEN c.requester_id = me.id THEN c.addressee_id
                ELSE c.requester_id END AS uid
      FROM public.user_connections c, me
     WHERE me.id IN (c.requester_id, c.addressee_id)
  ),
  dismissed AS (  -- decyzja „nie, dziękuję" - odpada do czasu przywrócenia
    SELECT d.dismissed_user_id AS uid
      FROM public.connection_suggestion_dismissals d, me
     WHERE d.user_id = me.id
  ),
  second_pairs AS (  -- (osoba w 2. stopniu, mój kontakt-most, od kiedy)
    SELECT CASE WHEN c.requester_id = m.peer THEN c.addressee_id
                ELSE c.requester_id END AS uid,
           m.peer AS via,
           m.since AS via_since
      FROM mine m
      JOIN public.user_connections c
        ON c.status = 'accepted' AND m.peer IN (c.requester_id, c.addressee_id)
  ),
  -- Drugi stopień: kontakty moich kontaktów, policzone jedną agregacją.
  mutual AS (
    SELECT sp.uid, count(*) AS cnt
      FROM second_pairs sp, me
     WHERE sp.uid <> me.id
     GROUP BY sp.uid
  ),
  -- Most 2. stopnia (jeden na osobę, deterministycznie: najdłużej znany).
  bridge2 AS (
    SELECT DISTINCT ON (sp.uid)
           sp.uid,
           pb.id AS via_id,
           COALESCE(NULLIF(btrim(pb.display_name), ''),
                    NULLIF(btrim(concat_ws(' ', pb.first_name, pb.last_name)), ''),
                    'User') AS via_name,
           pb.avatar_url AS via_avatar,
           pb.slug AS via_slug
      FROM second_pairs sp
      JOIN public.profiles pb ON pb.id = sp.via
      CROSS JOIN me
     WHERE pb.discoverable
       AND pb.tenant_id = me.tenant_id
     ORDER BY sp.uid,
              sp.via_since ASC NULLS LAST,
              lower(COALESCE(NULLIF(btrim(pb.display_name), ''),
                             concat_ws(' ', pb.first_name, pb.last_name))) ASC,
              pb.id ASC
  ),
  -- Trzeci stopień: jeszcze jeden przeskok z węzłów RZECZYWIŚCIE drugiego
  -- stopnia (bez mnie i bez moich kontaktów - tam droga jest krótsza).
  third_pairs AS (
    SELECT CASE WHEN c.requester_id = sp.uid THEN c.addressee_id
                ELSE c.requester_id END AS uid,
           sp.via,
           sp.via_since
      FROM second_pairs sp
      CROSS JOIN me
      JOIN public.user_connections c
        ON c.status = 'accepted' AND sp.uid IN (c.requester_id, c.addressee_id)
     WHERE sp.uid <> me.id
       AND NOT EXISTS (SELECT 1 FROM mine m WHERE m.peer = sp.uid)
  ),
  third_reach AS (
    SELECT DISTINCT tp.uid FROM third_pairs tp
  ),
  bridge3 AS (
    SELECT DISTINCT ON (tp.uid)
           tp.uid,
           pb.id AS via_id,
           COALESCE(NULLIF(btrim(pb.display_name), ''),
                    NULLIF(btrim(concat_ws(' ', pb.first_name, pb.last_name)), ''),
                    'User') AS via_name,
           pb.avatar_url AS via_avatar,
           pb.slug AS via_slug
      FROM third_pairs tp
      JOIN public.profiles pb ON pb.id = tp.via
      CROSS JOIN me
     WHERE pb.discoverable
       AND pb.tenant_id = me.tenant_id
     ORDER BY tp.uid,
              tp.via_since ASC NULLS LAST,
              pb.id ASC
  ),
  -- Wspólne dossier trackera: rytuał „żywego dossier" jako sygnał sieci.
  shared_follows AS (
    SELECT f2.user_id AS uid, count(*) AS cnt
      FROM public.eu_policy_follows f1
      JOIN public.eu_policy_follows f2
        ON f2.item_id = f1.item_id AND f2.user_id <> f1.user_id, me
     WHERE f1.user_id = me.id
     GROUP BY f2.user_id
  ),
  -- Wspólne wydarzenia (going/interested): „byliście w tym samym pokoju".
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
           me.specialization AS my_specialization, me.location AS my_location,
           me.open_to AS my_open_to
      FROM public.profiles p, me
     WHERE p.tenant_id = me.tenant_id
       AND p.discoverable
       AND p.id <> me.id
       AND NOT EXISTS (SELECT 1 FROM related r WHERE r.uid = p.id)
       AND NOT EXISTS (SELECT 1 FROM dismissed x WHERE x.uid = p.id)
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
    COALESCE(se.cnt, 0) AS shared_events,
    -- Sugestia nigdy nie jest 1. stopniem (relacje odpadają w `related`);
    -- 0 zostaje dla osoby, do której nie ma ścieżki w zasięgu trzech skoków.
    (CASE
      WHEN COALESCE(mu.cnt, 0) > 0 THEN 2
      WHEN t3.uid IS NOT NULL THEN 3
      ELSE 0
    END)::smallint AS degree,
    CASE WHEN COALESCE(mu.cnt, 0) > 0 THEN b2.via_id
         WHEN t3.uid IS NOT NULL THEN b3.via_id END AS bridge_id,
    CASE WHEN COALESCE(mu.cnt, 0) > 0 THEN b2.via_name
         WHEN t3.uid IS NOT NULL THEN b3.via_name END AS bridge_name,
    CASE WHEN COALESCE(mu.cnt, 0) > 0 THEN b2.via_avatar
         WHEN t3.uid IS NOT NULL THEN b3.via_avatar END AS bridge_avatar,
    CASE WHEN COALESCE(mu.cnt, 0) > 0 THEN b2.via_slug
         WHEN t3.uid IS NOT NULL THEN b3.via_slug END AS bridge_slug,
    c.open_to,
    c.completeness_score
  FROM cand c
  LEFT JOIN mutual mu ON mu.uid = c.id
  LEFT JOIN shared_follows sf ON sf.uid = c.id
  LEFT JOIN shared_events se ON se.uid = c.id
  LEFT JOIN third_reach t3 ON t3.uid = c.id
  LEFT JOIN bridge2 b2 ON b2.uid = c.id
  LEFT JOIN bridge3 b3 ON b3.uid = c.id
  WHERE auth.uid() IS NOT NULL
  ORDER BY
    -- Wspólne kontakty ważą najmocniej; sygnały treściowe z sufitem (LEAST),
    -- żeby jeden „power-follower" nie zdominował rankingu. Trzeci stopień
    -- dokłada jeden punkt: bliżej niż nieznajomy, dalej niż wspólny kontakt.
    -- Zbieżność intencji waży jak wspólna firma (powód rozmowy), a
    -- kompletność profilu jest tiebreakerem (0-4 punkty).
    (COALESCE(mu.cnt, 0) * 3
     + LEAST(COALESCE(sf.cnt, 0), 5) * 2
     + LEAST(COALESCE(se.cnt, 0), 5) * 2
     + CASE WHEN t3.uid IS NOT NULL AND COALESCE(mu.cnt, 0) = 0 THEN 1 ELSE 0 END
     + CASE WHEN COALESCE(btrim(c.current_company), '') <> ''
            AND lower(btrim(c.current_company))
                = lower(btrim(COALESCE(c.my_company, ''))) THEN 2 ELSE 0 END
     + CASE WHEN COALESCE(btrim(c.specialization), '') <> ''
            AND lower(btrim(c.specialization))
                = lower(btrim(COALESCE(c.my_specialization, ''))) THEN 2 ELSE 0 END
     + CASE WHEN COALESCE(btrim(c.location), '') <> ''
            AND lower(btrim(c.location))
                = lower(btrim(COALESCE(c.my_location, ''))) THEN 1 ELSE 0 END
     + CASE WHEN c.open_to && COALESCE(c.my_open_to, '{}'::text[]) THEN 2 ELSE 0 END
     + (COALESCE(c.completeness_score, 0) / 25)
    ) DESC,
    COALESCE(mu.cnt, 0) DESC,
    lower(COALESCE(NULLIF(btrim(c.display_name), ''),
                   concat_ws(' ', c.first_name, c.last_name))) ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 24)
$$;

COMMENT ON FUNCTION public.connection_suggestions(integer) IS
  '„Osoby, które możesz znać" + STOPIEŃ ODDALENIA (0/2/3) i most 1. stopnia, '
  'z odsiewem świadomie odrzuconych (connection_suggestion_dismissals) oraz '
  'zbieżnością intencji i kompletnością profilu w rankingu. Trzeci stopień '
  'dokłada punkt, ale nigdy nie przebija wspólnego kontaktu.';

REVOKE EXECUTE ON FUNCTION public.connection_suggestions(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.connection_suggestions(integer) TO authenticated, service_role;
