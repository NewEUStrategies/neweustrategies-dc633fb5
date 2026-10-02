-- events-harness: include
-- ============================================================================
-- STAN MIEJSC WYDARZENIA: JEDNA REGULA LICZENIA DLA STRONY I BRAMKI SPRZEDAZY.
--
-- BLIZNIAK w pasie drizzle: `drizzle/migrations/0129_event_seat_state_single_source.sql`
-- (ten sam SQL wykonywalny, wpis w `src/lib/ci/migrationLaneParity.ts`).
-- Produkcja dostaje te poprawke dopiero po zastosowaniu go z panelu Lovable.
--
-- DEFEKT. Strona wydarzenia pokazywala DWIE rozne liczby wolnych miejsc:
--   * naglowek (`event_page_header` -> `seats_left`) liczy regula
--     `_event_page_seats_left` (20260824094815): MNIEJSZA z puli zapisow
--     (`event_registrations`) i puli legacy (`event_rsvps`), bo obie sciezki
--     zapisu sa zywe;
--   * karta „Zostalo N miejsc" i bramka sprzedazy biletu
--     (`src/lib/events/ticket.server.ts`) liczyly WYLACZNIE pule legacy przez
--     `get_event_rsvp_counts`.
-- Przy wydarzeniu, ktore zapelnialo sie formularzem zgloszen, strona mowila
-- „wolne miejsca", a kasa sprzedawala bilet legacy na miejsce, ktorego nie ma.
-- Odwrotny kierunek tez: naglowek „brak miejsc" obok karty „zostalo 40".
--
-- NAPRAWA. `event_seat_state` oddaje stan miejsc JEDNEGO wydarzenia i liczy
-- `seats_left` WYLACZNIE przez `_event_page_seats_left` - tej samej funkcji
-- uzywa naglowek, wiec obie liczby nie maja jak sie rozjechac. `going` to
-- miejsca zajete wedlug tej samej reguly (wieksza z dwoch pul), zeby
-- `capacity - going = seats_left` zachodzilo zawsze, gdy limit istnieje.
--
-- NAJEMCA. Odczyt publiczny i zalogowany: `public_tenant_id()` (host
-- poswiadczony na krawedzi). Rola serwisowa (webhook platnosci sprawdza
-- nadsprzedaz PO pobraniu pieniedzy) nie niesie hosta, wiec `public_tenant_id()`
-- wskazalby najemce domyslnego i wydarzenie innego najemcy wygladaloby na
-- „bez limitu" - zwrot za nieistniejace miejsce nigdy by nie wyszedl. Dla tej
-- jednej roli najemca pochodzi z wiersza wydarzenia; klient anon/authenticated
-- nie ma jak sie pod nia podszyc (rozpoznanie po GUC ustawianych przez PostgREST,
-- jak w `payment_orders_guard_status`, 20260929095900).
--
-- WIDOCZNOSC. Tylko wydarzenie opublikowane - jak w `get_event_rsvp_counts`
-- i `event_page_header`. Brak wiersza = wydarzenie niewidoczne, a nie „zero".
-- ============================================================================

CREATE OR REPLACE FUNCTION public.event_seat_state(p_event_id uuid)
RETURNS TABLE (
  event_id uuid,
  capacity integer,
  seats_left integer,
  going integer,
  waitlist integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claims text := NULLIF(current_setting('request.jwt.claims', true), '');
  v_service boolean :=
       COALESCE(current_setting('role', true), '') = 'service_role'
    OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    OR (v_claims IS NOT NULL AND (v_claims::jsonb ->> 'role') = 'service_role');
  v_tenant uuid;
  v_event public.events;
  v_rsvp_going integer;
  v_rsvp_waitlist integer;
  v_reg_used integer;
  v_reg_waitlist integer;
BEGIN
  IF p_event_id IS NULL THEN
    RETURN;
  END IF;

  IF v_service THEN
    SELECT e.tenant_id INTO v_tenant FROM public.events e WHERE e.id = p_event_id;
  ELSE
    v_tenant := public.public_tenant_id();
  END IF;
  IF v_tenant IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_event
  FROM public.events e
  WHERE e.id = p_event_id
    AND e.tenant_id = v_tenant
    AND e.status = 'published';
  IF v_event.id IS NULL THEN
    RETURN;
  END IF;

  SELECT count(*) FILTER (WHERE r.status = 'going')::integer,
         count(*) FILTER (WHERE r.status = 'waitlist')::integer
    INTO v_rsvp_going, v_rsvp_waitlist
  FROM public.event_rsvps r
  WHERE r.tenant_id = v_tenant AND r.event_id = v_event.id;

  SELECT count(*) FILTER (WHERE g.status IN ('approved', 'attended', 'no_show'))::integer,
         count(*) FILTER (WHERE g.status = 'waitlist')::integer
    INTO v_reg_used, v_reg_waitlist
  FROM public.event_registrations g
  WHERE g.tenant_id = v_tenant AND g.event_id = v_event.id;

  RETURN QUERY
  SELECT
    v_event.id,
    v_event.capacity,
    public._event_page_seats_left(v_tenant, v_event.id),
    GREATEST(COALESCE(v_rsvp_going, 0), COALESCE(v_reg_used, 0)),
    COALESCE(v_rsvp_waitlist, 0) + COALESCE(v_reg_waitlist, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.event_seat_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_seat_state(uuid) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_seat_state(uuid) IS
  'Stan miejsc opublikowanego wydarzenia dla strony publicznej i bramki sprzedazy biletu. seats_left WYLACZNIE przez _event_page_seats_left (ta sama regula co event_page_header), going = miejsca zajete wedlug tej reguly (wieksza z pul zapisow i legacy), waitlist = suma obu kolejek. NULL seats_left = bez limitu. Najemca: public_tenant_id(), dla roli serwisowej - z wiersza wydarzenia. Liczy, nie rezerwuje.';
