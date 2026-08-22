-- ============================================================================
-- REGUŁA CHATHAM HOUSE JAKO BENEFIT PROGOWY (LUKA Z AUDYTU, ROZDZIAŁ 4)
--
-- `events.chatham_house boolean NOT NULL DEFAULT false` istnieje od migracji
-- modułu wydarzeń (20260713093000). Nie czyta go ŻADNA bramka - kolumna jest
-- dziś czystą etykietą redakcyjną. Katalog członkostw v6.1 nie odwołuje się do
-- niej ani razu, mimo że reguła Chatham House jest głównym argumentem za
-- wartością klubów i Decision Labów, a instytut buduje na niej tożsamość.
--
-- Ta migracja robi z niej benefit: spotkanie prowadzone w regule Chatham House
-- wymaga flagi `chatham_house_events`. Uzasadnienie nie jest marketingowe,
-- tylko wprost wynika z tego, czym ta reguła jest - uczestnik wolno cytować
-- treść, ale nie autora, i to zobowiązanie ma sens WYŁĄCZNIE w kręgu, który
-- zna swój skład. Wpuszczanie tam każdego, kto spełnia próg rangi wydarzenia
-- otwartego, jest sprzeczne z samą regułą, a nie tylko z cennikiem.
--
-- Bramka jest dopisana, nie zastępuje istniejącej: wydarzenie w regule Chatham
-- House musi nadal spełnić bramkę rangi / flagi `pro_briefings` i bramkę
-- biletową (20260822091000). Flaga tylko domyka krąg.
--
-- PRZY OKAZJI: przywrócona bramka okna rejestracji. Redefinicja `rsvp_event`
-- odsłoniła regresję z 20260721072715 - kontrola `rsvp_opens_at` /
-- `early_rsvp_rank` istniała w 20260714130000 i zniknęła przy przepisaniu ciała
-- na kolejkę rezerwową. Skoro i tak przenosimy całe ciało, przenosimy je
-- KOMPLETNE; szczegóły przy samym bloku.
--
-- LIMIT MIEJSC (`events.capacity`) świadomie NIE dostaje osobnej bramki:
-- mechanizm ekskluzywności już działa - `rsvp_event` przenosi na listę
-- rezerwową po wyczerpaniu limitu, a `assertSeatAvailable` blokuje sprzedaż
-- biletu ponad stan. Luka z audytu jest tu wyłącznie SPRZEDAŻOWA: katalog nie
-- używa limitu jako argumentu. To korekta w katalogu, nie w kodzie - i taką
-- zostaje, bo dokładanie drugiego mechanizmu do działającego byłoby regresją.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Flaga w katalogu warstw. Reguła Chatham House zaczyna się na progu Pro
--    (klub dyskusyjny), tak jak zamknięte briefingi - poniżej nie ma kręgu,
--    który by ją unosił.
-- ----------------------------------------------------------------------------
UPDATE public.membership_tiers
   SET features = COALESCE(features, '{}'::jsonb)
                  || jsonb_build_object('chatham_house_events', true)
 WHERE key IN ('pro', 'vip', 'team', 'ngo', 'corporate',
               'partner', 'partner_general', 'presidents_circle')
   AND NOT (features ? 'chatham_house_events');

-- ----------------------------------------------------------------------------
-- 2) Bramka wejścia. Ciało rsvp_event przeniesione z 20260822091000; jedyna
--    zmiana to blok Chatham House dopisany zaraz za bramką rangi.
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
  v_paid boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'events: authentication required';
  END IF;
  IF p_status NOT IN ('going', 'interested', 'cancelled') THEN
    RAISE EXCEPTION 'events: invalid status';
  END IF;

  -- FOR UPDATE serializuje rownolegle RSVP - licznik miejsc i kolejka
  -- rezerwowa nie moga sie scigac.
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
    -- Public (i kazde przyszle visibility) z progiem rangi: ta sama galaz
    -- ELSE co w get_event_access - zapis nie moze omijac bramki odczytu.
    RAISE EXCEPTION 'events: membership required';
  END IF;

  -- Reguła Chatham House domyka krąg NIEZALEŻNIE od widoczności wydarzenia:
  -- spotkanie może być zapowiedziane publicznie, ale wejść na nie może tylko
  -- ten, kogo obejmuje zobowiązanie.
  IF v_event.chatham_house AND NOT public.has_tier_feature('chatham_house_events') THEN
    RAISE EXCEPTION 'events: chatham house membership required';
  END IF;

  -- PRZYWRÓCONA BRAMKA OKNA REJESTRACJI (regresja z 20260721072715).
  --
  -- Pierwszeństwo rejestracji istniało w 20260714130000 i zniknęło przy
  -- przepisaniu funkcji na kolejkę rezerwową - nie świadomie, tylko przy
  -- przenoszeniu ciała. Od tamtej pory okno rejestracji było blokadą WYŁĄCZNIE
  -- kliencką (`events.$slug.tsx` chowa przyciski), a komentarz w tym samym
  -- pliku UI zapewniał, że „twardo egzekwuje to rsvp_event". Każdy, kto wołał
  -- RPC bezpośrednio, zapisywał się na wydarzenie przed otwarciem zapisów -
  -- czyli omijał dokładnie ten benefit, który `early_rsvp_rank` sprzedaje.
  -- Anulowanie zostaje zawsze dozwolone.
  IF p_status <> 'cancelled'
     AND v_event.rsvp_opens_at IS NOT NULL
     AND now() < v_event.rsvp_opens_at THEN
    IF v_event.early_rsvp_rank IS NULL
       OR NOT public.has_tier_rank(v_event.early_rsvp_rank) THEN
      RAISE EXCEPTION 'events: rsvp not open';
    END IF;
  END IF;

  SELECT er.status INTO v_prev
    FROM public.event_rsvps er
   WHERE er.event_id = p_event_id AND er.user_id = v_user;

  -- BRAMKA BILETOWA. Sama ranga nigdy nie wystarczała do wejścia na wydarzenie
  -- płatne - tyle że do 20260822091000 nikt o to nie pytał. Wejście daje albo
  -- opłacone zamówienie, albo bilet wliczony w plan.
  IF p_status = 'going'
     AND COALESCE(v_event.ticket_price_cents, 0) > 0
     AND COALESCE(v_prev, '') <> 'going' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.payment_orders po
       WHERE po.user_id = v_user
         AND po.status = 'paid'
         AND po.metadata ->> 'event_id' = p_event_id::text
    ) INTO v_paid;
    IF NOT v_paid AND NOT public.claim_included_event_ticket(p_event_id) THEN
      RAISE EXCEPTION 'events: ticket required';
    END IF;
  END IF;

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

  INSERT INTO public.event_rsvps (tenant_id, event_id, user_id, status, waitlisted_at)
  VALUES (
    v_event.tenant_id, p_event_id, v_user, v_result_status,
    CASE WHEN v_result_status = 'waitlist' THEN clock_timestamp() END
  )
  ON CONFLICT (event_id, user_id)
  DO UPDATE SET
    status = EXCLUDED.status,
    waitlisted_at = CASE
      WHEN EXCLUDED.status = 'waitlist'
        THEN COALESCE(event_rsvps.waitlisted_at, clock_timestamp())
      ELSE NULL
    END,
    updated_at = now();

  IF v_prev = 'going' AND v_result_status <> 'going' THEN
    PERFORM public.promote_event_waitlist(p_event_id);
  END IF;

  -- Rezygnacja zwalnia bilet z puli. Trafienie na listę rezerwową też - miejsce
  -- nie zostało przyznane, więc benefit nie może zostać spalony.
  IF v_result_status <> 'going' THEN
    PERFORM public.release_included_event_ticket(p_event_id, v_user);
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

-- ----------------------------------------------------------------------------
-- 3) Bramka odczytu. `get_event_access` musi mówić to samo, co `rsvp_event` -
--    inaczej wydarzenie w regule Chatham House oddawałoby `join_url` komuś,
--    komu zapis by odmówił. Ciało przeniesione z 20260724100000, dopisany
--    jeden warunek i jeden powód odmowy.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_event_access(p_event_id uuid)
RETURNS TABLE (
  can_join boolean,
  join_url text,
  can_watch boolean,
  recording_url text,
  reason text,
  watch_reason text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_staff boolean := false;
  v_allowed boolean;
  v_can_watch boolean;
  v_rsvp text;
BEGIN
  SELECT * INTO v_event
    FROM public.events
   WHERE id = p_event_id AND tenant_id = public.public_tenant_id();
  IF NOT FOUND OR v_event.status <> 'published' THEN
    RETURN QUERY SELECT false, NULL::text, false, NULL::text, 'not_found', 'not_found';
    RETURN;
  END IF;

  IF v_user IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, false, NULL::text, 'auth_required',
      CASE WHEN v_event.recording_url IS NULL THEN 'none' ELSE 'auth_required' END;
    RETURN;
  END IF;

  -- FIX: bypass staffu tylko gdy przeglądany tenant JEST tenantem domowym staffu
  -- (inaczej admin tenanta A widziałby join/recording tenanta B przez nagłówek).
  v_staff := v_event.tenant_id = public.current_tenant_id()
         AND (public.has_role(v_user, 'admin'::app_role)
              OR public.has_role(v_user, 'editor'::app_role));
  SELECT er.status INTO v_rsvp
    FROM public.event_rsvps er
   WHERE er.event_id = p_event_id AND er.user_id = v_user;

  -- Ta sama bramka co w rsvp_event: members-briefing wymaga flagi
  -- pro_briefings; pozostałe members - efektywnej rangi (min. 1).
  IF v_staff THEN
    v_allowed := true;
  ELSIF v_event.visibility = 'members' AND v_event.kind = 'briefing' THEN
    v_allowed := public.has_tier_feature('pro_briefings');
  ELSIF v_event.visibility = 'members' THEN
    v_allowed := public.has_tier_rank(GREATEST(COALESCE(v_event.min_tier_rank, 0), 1));
  ELSE
    v_allowed := public.has_tier_rank(COALESCE(v_event.min_tier_rank, 0));
  END IF;

  -- Reguła Chatham House - ten sam warunek co przy zapisie.
  IF v_allowed AND NOT v_staff AND v_event.chatham_house THEN
    v_allowed := public.has_tier_feature('chatham_house_events');
  END IF;

  IF NOT v_allowed THEN
    RETURN QUERY SELECT false, NULL::text, false, NULL::text, 'tier_required',
      CASE WHEN v_event.recording_url IS NULL THEN 'none' ELSE 'tier_required' END;
    RETURN;
  END IF;

  -- Nagrania: benefit warstwy (flaga recordings), nie sama ranga wydarzenia -
  -- URL nie opuszcza bazy bez uprawnienia. Spotkanie w regule Chatham House
  -- nie oddaje nagrania nikomu poza kręgiem - warunek wyżej już to załatwił.
  v_can_watch := v_event.recording_url IS NOT NULL
             AND (v_staff OR public.has_tier_feature('recordings'));

  RETURN QUERY SELECT
    (v_staff OR v_rsvp = 'going') AND v_event.join_url IS NOT NULL,
    CASE WHEN (v_staff OR v_rsvp = 'going') THEN v_event.join_url END,
    v_can_watch,
    CASE WHEN v_can_watch THEN v_event.recording_url END,
    CASE
      WHEN v_rsvp = 'going' OR v_staff THEN 'ok'
      WHEN v_rsvp = 'waitlist' THEN 'waitlisted'
      ELSE 'rsvp_required'
    END,
    CASE
      WHEN v_event.recording_url IS NULL THEN 'none'
      WHEN v_can_watch THEN 'ok'
      ELSE 'tier_required'
    END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_event_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_access(uuid) TO anon, authenticated, service_role;

COMMENT ON COLUMN public.events.chatham_house IS
  'Spotkanie prowadzone w regule Chatham House. Od 20260822092000 jest to BRAMKA, nie etykieta: wejście i nagranie wymagają flagi features chatham_house_events (próg Pro i wyżej).';
