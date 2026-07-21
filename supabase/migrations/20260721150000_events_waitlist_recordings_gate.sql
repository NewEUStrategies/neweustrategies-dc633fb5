-- ============================================================================
-- WYDARZENIA: lista rezerwowa przy pełnej sali + nagrania za bramką warstwy.
--
-- 1) LISTA REZERWOWA (event_rsvps.status += 'waitlist'):
--    * rsvp_event nie odrzuca już chętnych przy komplecie ('events: full') -
--      zapisuje ich na listę rezerwową FIFO (waitlisted_at, pozycja stabilna
--      przy ponowieniach). Wejście na listę wyłącznie przez RPC; klient nadal
--      wysyła tylko going/interested/cancelled - degradację do 'waitlist'
--      rozstrzyga serwer pod blokadą wiersza wydarzenia (bez wyścigu).
--    * Zwolnienie miejsca (rezygnacja z 'going' albo zwiększenie capacity)
--      awansuje najstarszą osobę z listy: promote_event_waitlist() pod tą samą
--      blokadą + powiadomienie 'content' (enqueue_notification szanuje
--      preferencje odbiorcy). Awans zeruje reminded_at, więc przypomnienie
--      <24 h nadal zadziała.
--    * get_event_rsvp_counts zwraca dodatkowo licznik waitlist; własną pozycję
--      podaje get_event_waitlist_position (wiersze RSVP są owner-only).
--    * get_event_access: nowy powód 'waitlisted' (link do transmisji nadal
--      wymaga 'going' - lista rezerwowa nie daje wejściówki).
--
-- 2) NAGRANIA ZA BRAMKĄ WARSTWY (flaga features 'recordings'):
--    * Benefit "Nagrania z wydarzeń" z cennika (tiery member+) był deklaratywny
--      - get_event_access oddawał recording_url każdemu, kto przeszedł próg
--      rangi wydarzenia. Teraz nagranie wymaga flagi recordings (lub staff),
--      dokładnie jak pro_briefings/qa_priority w 20260713200000.
--    * Nowa kolumna wyniku watch_reason ('ok'/'none'/'auth_required'/
--      'tier_required') pozwala UI pokazać właściwy upsell zamiast zgadywać.
--
-- Wszystko idempotentne.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Domena statusów RSVP + znacznik kolejki FIFO
-- ----------------------------------------------------------------------------
ALTER TABLE public.event_rsvps
  ADD COLUMN IF NOT EXISTS waitlisted_at timestamptz;

ALTER TABLE public.event_rsvps
  DROP CONSTRAINT IF EXISTS event_rsvps_status_check;
ALTER TABLE public.event_rsvps
  ADD CONSTRAINT event_rsvps_status_check
  CHECK (status IN ('going', 'interested', 'cancelled', 'waitlist'));

-- Spójność: wiersz na liście rezerwowej zawsze zna swój czas wejścia do kolejki.
ALTER TABLE public.event_rsvps
  DROP CONSTRAINT IF EXISTS event_rsvps_waitlist_marker_check;
ALTER TABLE public.event_rsvps
  ADD CONSTRAINT event_rsvps_waitlist_marker_check
  CHECK (status <> 'waitlist' OR waitlisted_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_event_rsvps_waitlist_fifo
  ON public.event_rsvps (event_id, waitlisted_at)
  WHERE status = 'waitlist';

-- ----------------------------------------------------------------------------
-- 2) Awans z listy rezerwowej (wewnętrzne; wołane pod blokadą wydarzenia)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.promote_event_waitlist(p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_row record;
  v_going integer;
  v_promoted integer := 0;
BEGIN
  -- Blokada wiersza wydarzenia: awanse serializowane z rsvp_event.
  SELECT * INTO v_event
    FROM public.events
   WHERE id = p_event_id
     FOR UPDATE;
  IF NOT FOUND OR v_event.status <> 'published' THEN
    RETURN 0;
  END IF;

  LOOP
    IF v_event.capacity IS NOT NULL THEN
      SELECT count(*) INTO v_going
        FROM public.event_rsvps
       WHERE event_id = p_event_id AND status = 'going';
      EXIT WHEN v_going >= v_event.capacity;
    END IF;

    SELECT * INTO v_row
      FROM public.event_rsvps
     WHERE event_id = p_event_id AND status = 'waitlist'
     ORDER BY waitlisted_at ASC, created_at ASC
     LIMIT 1
     FOR UPDATE;
    EXIT WHEN NOT FOUND;

    -- reminded_at = NULL: awansowany dostanie jeszcze przypomnienie <24 h.
    UPDATE public.event_rsvps
       SET status = 'going', waitlisted_at = NULL, reminded_at = NULL, updated_at = now()
     WHERE id = v_row.id;

    PERFORM public.enqueue_notification(
      v_row.user_id,
      'content',
      'Masz miejsce: ' || v_event.title_pl,
      'You have a seat: ' || v_event.title_en,
      'Zwolniło się miejsce i Twój zapis z listy rezerwowej został potwierdzony.',
      'A seat opened up and your waitlist spot has been confirmed.',
      '/events/' || v_event.slug,
      'CalendarCheck'
    );
    v_promoted := v_promoted + 1;
  END LOOP;

  RETURN v_promoted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.promote_event_waitlist(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_event_waitlist(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 3) rsvp_event: komplet -> lista rezerwowa; rezygnacja -> awans następnego
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

-- ----------------------------------------------------------------------------
-- 4) Własna pozycja w kolejce (wiersze RSVP są owner-only, liczby przez RPC)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_event_waitlist_position(p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_mine timestamptz;
  v_position integer;
BEGIN
  IF v_user IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT er.waitlisted_at INTO v_mine
    FROM public.event_rsvps er
    JOIN public.events e ON e.id = er.event_id
   WHERE er.event_id = p_event_id
     AND er.user_id = v_user
     AND er.status = 'waitlist'
     AND e.tenant_id = public.public_tenant_id();
  IF v_mine IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO v_position
    FROM public.event_rsvps er
   WHERE er.event_id = p_event_id
     AND er.status = 'waitlist'
     AND er.waitlisted_at <= v_mine;
  RETURN v_position;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_event_waitlist_position(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_waitlist_position(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5) Liczniki RSVP z kolejką rezerwową (zmiana sygnatury -> DROP + CREATE)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_event_rsvp_counts(uuid[]);
CREATE FUNCTION public.get_event_rsvp_counts(p_event_ids uuid[])
RETURNS TABLE (event_id uuid, going integer, interested integer, waitlist integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.event_id,
         count(*) FILTER (WHERE r.status = 'going')::integer,
         count(*) FILTER (WHERE r.status = 'interested')::integer,
         count(*) FILTER (WHERE r.status = 'waitlist')::integer
    FROM public.event_rsvps r
    JOIN public.events e ON e.id = r.event_id
   WHERE r.event_id = ANY (p_event_ids)
     AND e.tenant_id = public.public_tenant_id()
     AND e.status = 'published'
   GROUP BY r.event_id;
$$;

REVOKE EXECUTE ON FUNCTION public.get_event_rsvp_counts(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_rsvp_counts(uuid[])
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6) get_event_access: 'waitlisted' + nagrania za flagą recordings
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_event_access(uuid);
CREATE FUNCTION public.get_event_access(p_event_id uuid)
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

  v_staff := public.has_role(v_user, 'admin'::app_role)
          OR public.has_role(v_user, 'editor'::app_role);
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

  IF NOT v_allowed THEN
    RETURN QUERY SELECT false, NULL::text, false, NULL::text, 'tier_required',
      CASE WHEN v_event.recording_url IS NULL THEN 'none' ELSE 'tier_required' END;
    RETURN;
  END IF;

  -- Nagrania: benefit warstwy (flaga recordings), nie sama ranga wydarzenia -
  -- URL nie opuszcza bazy bez uprawnienia.
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

-- ----------------------------------------------------------------------------
-- 7) Zwiększenie capacity (lub zdjęcie limitu) awansuje kolejkę
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_events_capacity_promote()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'published'
     AND (NEW.capacity IS NULL OR NEW.capacity > COALESCE(OLD.capacity, NEW.capacity)) THEN
    PERFORM public.promote_event_waitlist(NEW.id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'events: waitlist promotion failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS events_capacity_promote ON public.events;
CREATE TRIGGER events_capacity_promote
  AFTER UPDATE OF capacity ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.tg_events_capacity_promote();
