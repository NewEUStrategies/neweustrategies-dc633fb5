-- events-harness: include
-- STAN MIEJSC WYDARZENIA: JEDNA REGULA LICZENIA DLA STRONY I BRAMKI SPRZEDAZY.
-- BLIZNIAK: drizzle/migrations/0131_event_seat_state_single_source.sql

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