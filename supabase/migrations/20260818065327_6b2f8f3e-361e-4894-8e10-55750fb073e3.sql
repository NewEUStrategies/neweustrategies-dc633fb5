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
  'Zalogowany odczyt wydarzen: opublikowane, w tenancie publicznym zadania i wylacznie te, do ktorych uzytkownik sie KWALIFIKUJE wg tej samej bramki co rsvp_event/get_event_access (members-briefing = flaga pro_briefings; members = ranga >= GREATEST(min_tier_rank,1); public = ranga >= min_tier_rank; inne visibility zamkniete). Redakcja czyta przez osobna polityke "events staff read".';

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

  SELECT er.status INTO v_prev
    FROM public.event_rsvps er
   WHERE er.event_id = p_event_id AND er.user_id = v_user;

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