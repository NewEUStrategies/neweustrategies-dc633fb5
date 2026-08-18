-- ============================================================================
-- KAŻDY ZALOGOWANY CZYTAŁ PEŁNY WIERSZ WYDARZEŃ BRAMKOWANYCH WARSTWĄ
--
-- Polityka "events member read" (20260803191905) pytała wyłącznie o
-- `status = 'published'` i tenanta - o `visibility` i `min_tier_rank` nie
-- pytała wcale, inaczej niż bliźniacza polityka anon. Darmowe konto (reader,
-- rank 0) omijało więc bramkę warstw jednym GET-em do Data API: wiersz
-- wydarzenia members / z progiem rangi schodził w całości - miejsce
-- spotkania, opis, prowadzący, limit miejsc, cena biletu (`location`,
-- `capacity`, `ticket_price_cents`, ...). Sekrety transmisji (`join_url`,
-- `recording_url`) chronił osobno grant kolumnowy z 20260803191905, ale
-- wszystko poza nimi - nic.
--
-- Anon dostał właściwą bramkę już w 20260803191905 i 20260812103500;
-- authenticated został wtedy celowo szeroki, żeby strona wydarzenia mogła
-- pokazać upsell zamiast 404. Tyle że upsell potrzebuje najwyżej tytułu
-- i terminu, a polityka oddawała też dane będące benefitem członkostwa
-- (gdzie, za ile, z kim) - benefit znów był sprzedawany i rozdawany naraz,
-- tym razem każdemu, kto założył bezpłatne konto.
--
-- Zalogowany czyta teraz tę samą definicję "kwalifikuje się", którą
-- egzekwują rsvp_event i get_event_access (20260721150000, 20260724100000):
--
--   * members + briefing  -> FLAGA features `pro_briefings` (sama ranga nie
--                            wystarcza, dokładnie jak w RPC),
--   * members (pozostałe) -> ranga >= GREATEST(COALESCE(min_tier_rank,0),1)
--                            (members z domyślną rangą 0 też jest bramkowane),
--   * public              -> ranga >= COALESCE(min_tier_rank,0)
--                            (niebramkowane widzi każdy zalogowany, rank 0
--                            spełnia próg 0),
--   * inna visibility     -> zamknięte (ELSE false: przyszłe np. 'invite'
--                            domyka się samo, jak w polityce anon).
--
-- `(SELECT public.current_tier_rank()) >= próg` zamiast
-- `public.has_tier_rank(próg)` per wiersz: definicja ta sama (has_tier_rank
-- to `current_tier_rank() >= COALESCE(_min,0)`, a próg nigdy nie jest NULL),
-- ale skalar w podzapytaniu Postgres liczy RAZ na zapytanie (InitPlan),
-- nie 200 razy na listę /events. Flaga briefingów tak samo. Wzorzec jak
-- `(SELECT public.public_tenant_id())` obok.
--
-- Konsekwencje:
--   * redakcja: nietknięta - "events staff read" (20260713093000) dalej daje
--     adminowi/edytorowi pełen odczyt w swoim tenancie, a panel i tak czyta
--     przez admin_list_events/admin_get_event (SECURITY DEFINER);
--   * kasa biletów: checkout czyta wiersz przez RLS użytkownika
--     (checkout.functions.ts), więc bilet na wydarzenie poza własną warstwą
--     kończy się `ticket_not_available` - spójnie z rsvp_event, które i tak
--     odmówiłoby zapisu;
--   * strona /events/$slug: konto bez warstwy nie zobaczy już wiersza
--     wydarzenia members (dotąd: karta z upsellem po `tier_required`
--     z get_event_access). To celowy koszt - upsell nie może stać na
--     wierszu, którego treść sama jest benefitem. Samo get_event_access
--     zwraca `tier_required` bez zmian, gdy ktoś zna id wydarzenia.
-- ============================================================================

DROP POLICY IF EXISTS "events member read" ON public.events;
CREATE POLICY "events member read" ON public.events
  FOR SELECT TO authenticated
  USING (
    status = 'published'
    AND tenant_id = (SELECT public.public_tenant_id())
    AND CASE
      WHEN visibility = 'members' AND kind = 'briefing'
        THEN (SELECT public.has_tier_feature('pro_briefings'))
      WHEN visibility = 'members'
        THEN (SELECT public.current_tier_rank()) >= GREATEST(COALESCE(min_tier_rank, 0), 1)
      WHEN visibility = 'public'
        THEN (SELECT public.current_tier_rank()) >= COALESCE(min_tier_rank, 0)
      ELSE false
    END
  );

COMMENT ON POLICY "events member read" ON public.events IS
  'Zalogowany odczyt wydarzeń: opublikowane, w tenancie publicznym żądania i wyłącznie te, do których użytkownik się KWALIFIKUJE wg tej samej bramki co rsvp_event/get_event_access (members-briefing = flaga pro_briefings; members = ranga >= GREATEST(min_tier_rank,1); public = ranga >= min_tier_rank; inne visibility zamknięte). Redakcja czyta przez osobną politykę "events staff read".';

-- ----------------------------------------------------------------------------
-- rsvp_event: ta sama bramka także przy ZAPISIE (domknięcie z recenzji PR).
--
-- Dotychczasowa wersja (20260721150000) sprawdzała warstwę WYŁĄCZNIE w gałęzi
-- visibility = 'members'. Wydarzenie public z progiem rangi (min_tier_rank>0)
-- nie miało w RPC żadnej bramki, więc rank 0, który zna UUID wydarzenia
-- (np. zapamiętany sprzed zmiany planu), mógł przez SECURITY DEFINER ominąć
-- nową politykę SELECT: zapisać się 'going' i skonsumować miejsce na
-- wydarzeniu, którego nie widzi i do którego get_event_access odmawia
-- dostępu - bo tam gałąź ELSE bramkuje rangą od zawsze (20260713070949:102,
-- 20260724100000:656). Klient tak samo: events.$slug.tsx liczy próg także
-- dla public (membersOnly ? max(rank,1) : min_tier_rank).
--
-- Jedyna zmiana w ciele: gałąź ELSIF dla pozostałych visibility - parytet
-- z get_event_access. Wydarzenia z progiem 0 wchodzą jak dotąd
-- (has_tier_rank(0) jest zawsze prawdą dla zalogowanego), members i briefing
-- bez zmian, reszta ciała (FOR UPDATE, komplet -> waitlist FIFO, awans przy
-- rezygnacji) przepisana 1:1 z 20260721150000.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rsvp_event(p_event_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_prev text;
  v_going integer;
  v_waitlist integer;
  v_position integer;
  v_min_rank integer;
  v_result_status text := p_status;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'events: authentication required';
  END IF;
  IF p_status NOT IN ('going', 'interested', 'cancelled') THEN
    RAISE EXCEPTION 'events: invalid status';
  END IF;

  -- FOR UPDATE serializuje równoległe RSVP - licznik miejsc i kolejka
  -- rezerwowa nie mogą się ścigać.
  SELECT * INTO v_event
    FROM public.events
   WHERE id = p_event_id
     AND tenant_id = public.public_tenant_id()
     AND status = 'published'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'events: not found';
  END IF;

  IF v_event.visibility = 'members' THEN
    -- Briefing Pro: o wstępie decyduje flaga features, nie sam rank -
    -- benefity "pro_briefings" z cennika są egzekwowane, nie deklaratywne.
    IF v_event.kind = 'briefing' THEN
      IF NOT public.has_tier_feature('pro_briefings') THEN
        RAISE EXCEPTION 'events: membership required';
      END IF;
    ELSE
      v_min_rank := GREATEST(COALESCE(v_event.min_tier_rank, 0), 1);
      IF NOT public.has_tier_rank(v_min_rank) THEN
        RAISE EXCEPTION 'events: membership required';
      END IF;
    END IF;
  ELSIF NOT public.has_tier_rank(COALESCE(v_event.min_tier_rank, 0)) THEN
    -- Public (i każde przyszłe visibility) z progiem rangi: ta sama gałąź
    -- ELSE co w get_event_access - zapis nie może omijać bramki odczytu.
    RAISE EXCEPTION 'events: membership required';
  END IF;

  SELECT er.status INTO v_prev
    FROM public.event_rsvps er
   WHERE er.event_id = p_event_id AND er.user_id = v_user;

  -- Komplet miejsc nie odrzuca chętnego - degraduje 'going' do 'waitlist'.
  -- Kto już jest 'going', nigdy nie spada do kolejki (idempotencja ponowień).
  IF p_status = 'going'
     AND v_event.capacity IS NOT NULL
     AND COALESCE(v_prev, '') <> 'going' THEN
    SELECT count(*) INTO v_going
      FROM public.event_rsvps
     WHERE event_id = p_event_id AND status = 'going';
    IF v_going >= v_event.capacity THEN
      v_result_status := 'waitlist';
    END IF;
  END IF;

  -- clock_timestamp(): now() jest zamrożone per transakcja, a kolejka FIFO
  -- potrzebuje ścisłej monotonii; realną kolejność przybycia i tak
  -- serializuje blokada FOR UPDATE wiersza wydarzenia.
  INSERT INTO public.event_rsvps (tenant_id, event_id, user_id, status, waitlisted_at)
  VALUES (
    v_event.tenant_id, p_event_id, v_user, v_result_status,
    CASE WHEN v_result_status = 'waitlist' THEN clock_timestamp() END
  )
  ON CONFLICT (event_id, user_id)
  DO UPDATE SET
    status = EXCLUDED.status,
    -- FIFO: ponowienie zapisu na listę nie resetuje pozycji w kolejce.
    waitlisted_at = CASE
      WHEN EXCLUDED.status = 'waitlist'
        THEN COALESCE(event_rsvps.waitlisted_at, clock_timestamp())
      ELSE NULL
    END,
    updated_at = now();

  -- Zwolnione miejsce (odejście z 'going') awansuje czoło kolejki.
  IF v_prev = 'going' AND v_result_status <> 'going' THEN
    PERFORM public.promote_event_waitlist(p_event_id);
  END IF;

  SELECT count(*) FILTER (WHERE er.status = 'going'),
         count(*) FILTER (WHERE er.status = 'waitlist')
    INTO v_going, v_waitlist
    FROM public.event_rsvps er
   WHERE er.event_id = p_event_id;

  IF v_result_status = 'waitlist' THEN
    SELECT count(*) INTO v_position
      FROM public.event_rsvps er
     WHERE er.event_id = p_event_id
       AND er.status = 'waitlist'
       AND er.waitlisted_at <= (
         SELECT mine.waitlisted_at
           FROM public.event_rsvps mine
          WHERE mine.event_id = p_event_id AND mine.user_id = v_user
       );
  END IF;

  RETURN jsonb_build_object(
    'status', v_result_status,
    'going', v_going,
    'waitlist', v_waitlist,
    'waitlist_position', v_position
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rsvp_event(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rsvp_event(uuid, text) TO authenticated, service_role;
