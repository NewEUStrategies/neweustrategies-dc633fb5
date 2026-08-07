-- ============================================================================
-- LUKI POCHODNE: (a) SUGESTIE BEZ PĘTLI ZWROTNEJ, (b) DRUGI STOPIEŃ LICZONY,
-- ALE NIGDZIE NIE POKAZANY.
--
-- (a) connection_suggestions (v2, 20260717170000) odsiewa wyłącznie osoby
--     z ISTNIEJĄCĄ relacją (`related`). Osoba, którą użytkownik świadomie
--     pominął, wracała przy każdym wejściu na zakładkę - w nieskończoność,
--     bo "nie, dziękuję" nie miało gdzie się zapisać. Ranking uczył się
--     wyłącznie z danych, nigdy z decyzji.
--     Ukrycie jest TRWAŁE i ODWRACALNE: kto raz odrzucił, nie musi tego
--     robić drugi raz, a kto się rozmyślił, przywraca całą listę jednym
--     ruchem (restore_connection_suggestions). Bez daty wygaśnięcia -
--     "przypomnę Ci o tym za miesiąc" to dokładnie to zachowanie, które
--     miało zniknąć.
--
-- (b) Drugi stopień był liczony w CTE `mutual` w OBU funkcjach
--     (connection_statuses, connection_suggestions), ale wychodził na
--     zewnątrz wyłącznie jako `mutual_count`, więc interfejs musiał sam
--     zgadywać, co ta liczba znaczy dla odległości w sieci - i nie zgadywał.
--     Teraz stopień jest JAWNĄ kolumną z jedną definicją w bazie:
--       1 - połączeni bezpośrednio,
--       2 - co najmniej jeden wspólny kontakt,
--       3 - brak ścieżki w zasięgu dwóch skoków ("3+").
--     Klient renderuje odznakę, a nie interpretuje.
--
-- Wszystko idempotentne. Zmiany kolumn wyjściowych przez DROP FUNCTION
-- (lekcja 42P13 z audytu 2026-07-11).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Pamięć decyzji "nie, dziękuję"
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.connection_suggestion_dismissals (
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dismissed_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, dismissed_user_id),
  CHECK (user_id <> dismissed_user_id)
);

COMMENT ON TABLE public.connection_suggestion_dismissals IS
  'Sugestie odrzucone przez użytkownika ("nie, dziękuję"). Wyłącznie przez RPC: dismiss_connection_suggestion / restore_connection_suggestions.';

CREATE INDEX IF NOT EXISTS connection_suggestion_dismissals_tenant_idx
  ON public.connection_suggestion_dismissals (tenant_id, user_id);

ALTER TABLE public.connection_suggestion_dismissals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.connection_suggestion_dismissals FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.connection_suggestion_dismissals TO service_role;
-- Bez polityk klienckich: tabela jest RPC-only (wzorzec user_connections).
-- Decyzja o pominięciu kogoś jest prywatna - pominięty nie może jej odczytać.

CREATE OR REPLACE FUNCTION public.dismiss_connection_suggestion(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_peer_tenant uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'connections: authentication required';
  END IF;
  IF p_user_id IS NULL OR p_user_id = v_uid THEN
    RAISE EXCEPTION 'connections: invalid peer';
  END IF;

  SELECT tenant_id INTO v_tenant      FROM public.profiles WHERE id = v_uid;
  SELECT tenant_id INTO v_peer_tenant FROM public.profiles WHERE id = p_user_id;
  IF v_tenant IS NULL OR v_peer_tenant IS NULL OR v_tenant <> v_peer_tenant THEN
    RAISE EXCEPTION 'connections: peer not available';
  END IF;

  INSERT INTO public.connection_suggestion_dismissals (user_id, dismissed_user_id, tenant_id)
  VALUES (v_uid, p_user_id, v_tenant)
  ON CONFLICT (user_id, dismissed_user_id) DO NOTHING;
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.dismiss_connection_suggestion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_connection_suggestion(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.restore_connection_suggestions()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_removed integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'connections: authentication required';
  END IF;
  DELETE FROM public.connection_suggestion_dismissals WHERE user_id = v_uid;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  RETURN v_removed;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.restore_connection_suggestions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_connection_suggestions()
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.my_dismissed_suggestions_count()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int
    FROM public.connection_suggestion_dismissals d
   WHERE auth.uid() IS NOT NULL
     AND d.user_id = auth.uid();
$$;

REVOKE EXECUTE ON FUNCTION public.my_dismissed_suggestions_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_dismissed_suggestions_count()
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2) connection_statuses v3: jawny stopień sieci
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.connection_statuses(uuid[]);

CREATE FUNCTION public.connection_statuses(p_user_ids uuid[])
RETURNS TABLE (
  user_id uuid,
  connection_id uuid,
  status text,
  mutual_count bigint,
  can_invite boolean,
  degree smallint
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
    END AS can_invite,
    -- Stopień sieci: 1 bezpośrednio, 2 przez wspólny kontakt, 3 dalej ("3+").
    -- Jedna definicja dla całego interfejsu - patrz nagłówek migracji.
    CASE
      WHEN r.status = 'accepted' THEN 1
      WHEN COALESCE(mu.cnt, 0) > 0 THEN 2
      ELSE 3
    END::smallint AS degree
  FROM ids i
  CROSS JOIN me
  LEFT JOIN rel r ON r.uid = i.id
  LEFT JOIN mutual mu ON mu.uid = i.id
  WHERE auth.uid() IS NOT NULL
$$;

COMMENT ON FUNCTION public.connection_statuses(uuid[]) IS
  'Relacja wołającego z partią profili: status, wspólne kontakty, dopuszczalność świeżego zaproszenia i STOPIEŃ sieci (1/2/3+).';

REVOKE EXECUTE ON FUNCTION public.connection_statuses(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.connection_statuses(uuid[]) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3) connection_suggestions v3: pamięć decyzji + stopień + kompletność
--
-- Nowe względem v2:
--   * odsiew `dismissed` (pętla zwrotna),
--   * jawna kolumna `degree`,
--   * `completeness_score` i `open_to` w projekcji: karta sugestii ma czym
--     uzasadnić rekomendację ("otwarty na konsorcja"), a ranking premiuje
--     profile, które da się przeczytać. Waga kompletności jest CELOWO mała
--     (dzielona przez 25, czyli 0-4 punkty) - to tiebreaker, nie sygnał
--     wypierający wspólne kontakty.
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
  dismissed AS (  -- decyzja "nie, dziękuję" - odpada do czasu przywrócenia
    SELECT d.dismissed_user_id AS uid
      FROM public.connection_suggestion_dismissals d, me
     WHERE d.user_id = me.id
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
    -- Sugestia nigdy nie jest 1. stopniem (relacje odpadają w `related`).
    CASE WHEN COALESCE(mu.cnt, 0) > 0 THEN 2 ELSE 3 END::smallint AS degree,
    c.open_to,
    c.completeness_score
  FROM cand c
  LEFT JOIN mutual mu ON mu.uid = c.id
  LEFT JOIN shared_follows sf ON sf.uid = c.id
  LEFT JOIN shared_events se ON se.uid = c.id
  WHERE auth.uid() IS NOT NULL
  ORDER BY
    -- Wspólne kontakty ważą najmocniej; sygnały treściowe z sufitem (LEAST),
    -- żeby jeden "power-follower" nie zdominował rankingu. Zbieżność intencji
    -- (obie strony otwarte na to samo) waży jak wspólna firma - to jest
    -- powód rozmowy, nie ozdoba profilu.
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
     + CASE WHEN c.open_to && COALESCE(c.my_open_to, '{}'::text[]) THEN 2 ELSE 0 END
     + (COALESCE(c.completeness_score, 0) / 25)
    ) DESC,
    COALESCE(mu.cnt, 0) DESC,
    lower(COALESCE(NULLIF(btrim(c.display_name), ''),
                   concat_ws(' ', c.first_name, c.last_name))) ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 24)
$$;

COMMENT ON FUNCTION public.connection_suggestions(integer) IS
  '"Osoby, które możesz znać": wspólne kontakty + wspólne dossier/wydarzenia + zbieżność intencji, z odsiewem świadomie odrzuconych (connection_suggestion_dismissals) i jawnym stopniem sieci.';

REVOKE EXECUTE ON FUNCTION public.connection_suggestions(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.connection_suggestions(integer) TO authenticated, service_role;
