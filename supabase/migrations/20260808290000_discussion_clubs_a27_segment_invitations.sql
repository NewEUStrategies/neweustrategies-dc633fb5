-- ============================================================================
-- Kluby dyskusyjne - etap A27: sciezka D (zaproszenia segmentowe) domknieta
--
-- BLAD, KTORY TO NAPRAWIA. Specyfikacja zna cztery sciezki zapraszania:
-- A (osoba z platformy), B (e-mail), C (link), D (segment wyliczony regula).
-- Sciezka D miala TABELE (`club_segment_rules` z triggerem pinujacym tenanta),
-- miala RPC PODGLADU (`admin_club_segment_preview` liczacy matched /
-- already_member / blocked / will_send) - i nie miala funkcji, ktora cokolwiek
-- WYSYLA. Nie miala tez ani jednego wolajacego po stronie klienta.
--
-- To jest gorszy stan niz brak funkcji: podglad bez wykonania to licznik,
-- ktory mowi "wysle 137 zaproszen" i nie ma przycisku. Tabela regul istniala
-- po to, "zeby kampanie zapraszajaca dalo sie powtorzyc" - kampanie, ktorej
-- nie dalo sie przeprowadzic ani raz.
--
-- JEDNO ZRODLO KANDYDATOW. Najwiekszym ryzykiem takiej pary (podglad +
-- wykonanie) jest ROZJAZD: podglad liczy jeden zbior, wysylka bierze inny,
-- a administrator dowiaduje sie o tym po fakcie, z cudzych skrzynek. Dlatego
-- rozwiazywanie reguly wychodzi do `club_segment_candidate_ids`, a obie
-- funkcje wolaja JA, zamiast powtarzac te sama piatke galezi.
--
-- ODSIEW JEST TEZ WSPOLNY. `club_segment_recipients` liczy, kto realnie
-- dostanie zaproszenie: bez obecnych i zbanowanych czlonkow, bez osob
-- z wylaczonymi powiadomieniami klubowymi, bez blokad miedzy uzytkownikami
-- (V2 par. 3.5 - zaproszenie NIGDY nie omija `user_blocks`) i bez tych, ktorzy
-- odrzucili zaproszenie w ciagu 90 dni. Podglad pokazuje dokladnie te liczbe,
-- ktora wysylka zrealizuje.
--
-- POPRAWKA W SAMYM PODGLADZIE. Poprzednia wersja liczyla `blocked` wylacznie
-- po `notification_preferences.enabled_club IS FALSE`, wiec pomijala blokady
-- miedzy uzytkownikami i okno 90 dni - `will_send` bylo zawyzone. Teraz obie
-- liczby wychodza z tego samego odsiewu.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Rozwiazanie reguly na zbior kandydatow
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_segment_candidate_ids(p_rule jsonb)
RETURNS TABLE (user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH ctx AS (
    SELECT public.current_tenant_id() AS tenant, p_rule->>'kind' AS kind
  )
  SELECT DISTINCT b.user_id
    FROM public.profile_badges b
    JOIN public.profiles p ON p.id = b.user_id
    CROSS JOIN ctx
   WHERE ctx.kind = 'badge' AND p.tenant_id = ctx.tenant AND b.badge = p_rule->>'badge'
  UNION
  SELECT DISTINCT f.user_id
    FROM public.eu_policy_follows f
    JOIN public.profiles p ON p.id = f.user_id
    CROSS JOIN ctx
   WHERE ctx.kind = 'policy_follow' AND p.tenant_id = ctx.tenant
     AND f.item_id = NULLIF(p_rule->>'item_id', '')::uuid
  UNION
  SELECT DISTINCT r.user_id
    FROM public.event_rsvps r
    JOIN public.profiles p ON p.id = r.user_id
    CROSS JOIN ctx
   WHERE ctx.kind = 'event_rsvp' AND p.tenant_id = ctx.tenant
     AND r.event_id = NULLIF(p_rule->>'event_id', '')::uuid
     AND r.status IN ('going', 'interested')
  UNION
  SELECT DISTINCT m.user_id
    FROM public.club_members m
    JOIN public.clubs c ON c.id = m.club_id
    CROSS JOIN ctx
   WHERE ctx.kind = 'other_club' AND c.tenant_id = ctx.tenant
     AND m.club_id = NULLIF(p_rule->>'club_id', '')::uuid
     AND m.status = 'active'
  UNION
  -- `discoverable` jest tu warunkiem, nie ozdoba: osoba ukryta w katalogu nie
  -- chce byc znajdowana po specjalizacji, a kampania segmentowa jest wlasnie
  -- znajdowaniem po specjalizacji.
  SELECT p.id
    FROM public.profiles p
    CROSS JOIN ctx
   WHERE ctx.kind = 'specialization' AND p.tenant_id = ctx.tenant AND p.discoverable
     AND lower(btrim(COALESCE(p.specialization, ''))) = lower(btrim(COALESCE(p_rule->>'value', '')))
$$;

COMMENT ON FUNCTION public.club_segment_candidate_ids(jsonb) IS
  'Rozwiazuje regule segmentu na zbior osob. JEDYNE zrodlo kandydatow - podglad i wysylka wolaja ta funkcje, zeby licznik nie mogl sie rozjechac z tym, co realnie poszlo.';

-- BEZ grantu dla `authenticated`, i to jest istota sprawy: ta funkcja
-- ENUMERUJE OSOBY po odznace, obserwowanym akcie prawnym, udziale
-- w wydarzeniu, czlonkostwie w innym klubie i specjalizacji. Wystawiona
-- zalogowanym byla by gotowym narzedziem do zbierania list. Wolaja ja
-- wylacznie `admin_club_segment_preview` i `admin_club_invite_segment` - obie
-- SECURITY DEFINER z bramka `is_club_admin`, wiec cialo wykonuje sie
-- z uprawnieniami wlasciciela i grant dla wolajacego nie jest potrzebny.
REVOKE EXECUTE ON FUNCTION public.club_segment_candidate_ids(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_segment_candidate_ids(jsonb) TO service_role;

-- ----------------------------------------------------------------------------
-- 2) Odsiew: kto REALNIE dostanie zaproszenie
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_segment_recipients(p_club_id uuid, p_rule jsonb)
RETURNS TABLE (user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.user_id
    FROM public.club_segment_candidate_ids(p_rule) c
   WHERE NOT EXISTS (
           SELECT 1 FROM public.club_members m
            WHERE m.club_id = p_club_id AND m.user_id = c.user_id
              AND m.status IN ('active', 'pending', 'invited', 'banned')
         )
     AND NOT EXISTS (
           SELECT 1 FROM public.notification_preferences np
            WHERE np.user_id = c.user_id AND np.enabled_club IS FALSE
         )
     -- Odrzucenie zaproszenia jest odpowiedzia, nie brakiem odpowiedzi.
     -- Kampania segmentowa nie ma prawa jej ignorowac przez 90 dni - inaczej
     -- "nie, dziekuje" znaczyloby "zapytaj mnie znowu w przyszlym tygodniu".
     AND NOT EXISTS (
           SELECT 1 FROM public.club_invitations i
            WHERE i.club_id = p_club_id AND i.invitee_id = c.user_id
              AND i.status = 'declined'
              AND i.responded_at > now() - interval '90 days'
         )
     AND NOT public.is_blocked_pair(auth.uid(), c.user_id)
$$;

COMMENT ON FUNCTION public.club_segment_recipients(uuid, jsonb) IS
  'Kandydaci po odsiewie: bez czlonkow i zbanowanych, bez wylaczonych powiadomien klubowych, bez blokad miedzy uzytkownikami i bez osob, ktore odmowily w ciagu 90 dni.';

-- Jak wyzej: odsiew jest tym samym narzedziem enumeracji, tylko krotszym.
REVOKE EXECUTE ON FUNCTION public.club_segment_recipients(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_segment_recipients(uuid, jsonb) TO service_role;

-- ----------------------------------------------------------------------------
-- 3) Podglad - przepisany na wspolny odsiew
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_club_segment_preview(p_club_id uuid, p_rule jsonb)
RETURNS TABLE (matched integer, already_member integer, blocked integer, will_send integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_matched integer := 0;
  v_member  integer := 0;
  v_send    integer := 0;
BEGIN
  IF NOT public.is_club_admin(auth.uid()) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::int INTO v_matched FROM public.club_segment_candidate_ids(p_rule);

  SELECT count(*)::int INTO v_member
    FROM public.club_segment_candidate_ids(p_rule) c
    JOIN public.club_members m ON m.user_id = c.user_id AND m.club_id = p_club_id
   WHERE m.status IN ('active', 'pending', 'invited', 'banned');

  SELECT count(*)::int INTO v_send
    FROM public.club_segment_recipients(p_club_id, p_rule);

  -- `blocked` jest RESZTA, a nie osobnym zapytaniem: dzieki temu trzy liczby
  -- zawsze sie sumuja do `matched`, cokolwiek dojdzie do odsiewu w przyszlosci.
  RETURN QUERY SELECT v_matched, v_member, GREATEST(v_matched - v_member - v_send, 0), v_send;
END;
$$;

COMMENT ON FUNCTION public.admin_club_segment_preview(uuid, jsonb) IS
  'Podglad kampanii segmentowej. Liczy z tego samego odsiewu, co admin_club_invite_segment - licznik i wysylka nie moga sie rozjechac. `blocked` jest reszta, wiec trzy liczby sumuja sie do `matched`.';

REVOKE EXECUTE ON FUNCTION public.admin_club_segment_preview(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_segment_preview(uuid, jsonb)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4) Wykonanie kampanii
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_club_invite_segment(
  p_club_id   uuid,
  p_rule      jsonb,
  p_role      text DEFAULT 'member',
  p_message   text DEFAULT NULL,
  p_group_id  uuid DEFAULT NULL,
  p_save_rule boolean DEFAULT true,
  p_max       integer DEFAULT 500
)
RETURNS TABLE (invited integer, rule_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_tenant  uuid;
  v_count   integer := 0;
  v_rule    uuid;
  v_cap     integer := LEAST(GREATEST(COALESCE(p_max, 500), 1), 2000);
BEGIN
  IF NOT public.is_club_admin(v_uid) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('lead', 'moderator', 'member', 'observer') THEN
    RAISE EXCEPTION 'clubs: invalid club role %', p_role USING ERRCODE = '22023';
  END IF;

  SELECT c.tenant_id INTO v_tenant FROM public.clubs c WHERE c.id = p_club_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;

  -- Serializacja per KLUB. Dwie kampanie puszczone rownolegle na ten sam klub
  -- czytalyby ten sam odsiew i obie policzylyby te same osoby jako "do
  -- wyslania" - `ON CONFLICT` uratowalby baze, ale licznik zwrocony
  -- administratorowi klamalby o dwukrotnosci.
  PERFORM pg_advisory_xact_lock(hashtext('club_invite_segment:' || p_club_id::text));

  WITH picked AS (
    SELECT r.user_id
      FROM public.club_segment_recipients(p_club_id, p_rule) r
     LIMIT v_cap
  ),
  ins AS (
    INSERT INTO public.club_invitations (
      tenant_id, club_id, group_id, inviter_id, invitee_id, club_role, message
    )
    SELECT v_tenant, p_club_id, p_group_id, v_uid, p.user_id, p_role,
           NULLIF(btrim(COALESCE(p_message, '')), '')
      FROM picked p
    ON CONFLICT (club_id, invitee_id) WHERE status = 'pending' DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int INTO v_count FROM ins;

  -- Regula zapisuje sie PO wysylce i tylko wtedy, gdy cokolwiek poszlo: wpis
  -- w `club_segment_rules` ma znaczyc "ta kampania sie odbyla", a nie "ktos
  -- kliknal podglad".
  --
  -- `name` jest NOT NULL, a `club_role` ma wlasny CHECK BEZ 'lead' (kampania
  -- masowa nie mianuje prowadzacych). `last_run_at`/`last_sent` sa czescia
  -- kontraktu tabeli - "zeby kampanie dalo sie powtorzyc" znaczy takze "zeby
  -- bylo widac, kiedy poszla i do ilu osob".
  IF COALESCE(p_save_rule, true) AND v_count > 0 THEN
    INSERT INTO public.club_segment_rules (
      tenant_id, club_id, name, rule, club_role, last_run_at, last_sent, created_by
    ) VALUES (
      v_tenant, p_club_id,
      COALESCE(NULLIF(btrim(p_rule->>'name'), ''),
               'segment: ' || COALESCE(p_rule->>'kind', '?')),
      p_rule,
      CASE WHEN p_role = 'lead' THEN 'member' ELSE p_role END,
      now(), v_count, v_uid
    )
    RETURNING id INTO v_rule;
  END IF;

  IF v_count > 0 THEN
    INSERT INTO public.club_moderation_log (
      tenant_id, club_id, moderator_id, action, target_type, target_id, reason
    ) VALUES (
      v_tenant, p_club_id, v_uid, 'invite_segment', 'club', p_club_id,
      'segment: ' || COALESCE(p_rule->>'kind', '?') || ', invited: ' || v_count::text
    );
  END IF;

  invited := v_count;
  rule_id := v_rule;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.admin_club_invite_segment(uuid, jsonb, text, text, uuid, boolean, integer) IS
  'Sciezka D: kampania zapraszajaca na zbior wyliczony regula. Odsiew wspolny z podgladem, blokada advisory per klub (rownolegla kampania nie moze zawyzyc licznika), regula zapisuje sie dopiero po realnej wysylce.';

REVOKE EXECUTE ON FUNCTION
  public.admin_club_invite_segment(uuid, jsonb, text, text, uuid, boolean, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.admin_club_invite_segment(uuid, jsonb, text, text, uuid, boolean, integer)
  TO authenticated, service_role;

-- Slownik akcji dziennika moderacji musi znac nowa akcje - inaczej wpis
-- odbija sie o CHECK i cala kampania wywala sie PO wyslaniu zaproszen.
ALTER TABLE public.club_moderation_log
  DROP CONSTRAINT IF EXISTS club_moderation_log_action_check;
ALTER TABLE public.club_moderation_log
  ADD CONSTRAINT club_moderation_log_action_check
  CHECK (action IN ('approve', 'hide', 'delete', 'restore', 'lock', 'unlock',
                    'pin', 'unpin', 'ban', 'unban', 'reveal_author',
                    'role_change', 'post_on_behalf', 'move', 'edit',
                    'member_add', 'group_delete', 'report', 'invite_segment'));
