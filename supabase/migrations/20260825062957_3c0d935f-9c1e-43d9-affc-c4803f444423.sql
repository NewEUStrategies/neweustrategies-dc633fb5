DROP FUNCTION IF EXISTS public._event_meeting_groups(uuid, uuid, uuid);
CREATE FUNCTION public._event_meeting_groups(
  _tenant uuid,
  _event_id uuid,
  _registration_id uuid
)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH own AS (
    SELECT r.group_id
    FROM public.event_registrations r
    WHERE r.tenant_id = _tenant
      AND r.event_id = _event_id
      AND r.id = _registration_id
      AND r.group_id IS NOT NULL
    UNION
    SELECT m.group_id
    FROM public.event_group_members m
    JOIN public.event_registrations r
      ON r.tenant_id = m.tenant_id
     AND r.person_id = m.person_id
     AND r.event_id = m.event_id
    WHERE m.tenant_id = _tenant
      AND m.event_id = _event_id
      AND r.id = _registration_id
  )
  SELECT o.group_id FROM own o
  UNION
  SELECT g.id
  FROM public.event_groups g
  WHERE g.tenant_id = _tenant
    AND g.event_id = _event_id
    AND g.is_default
    AND NOT EXISTS (SELECT 1 FROM own);
$$;

REVOKE ALL ON FUNCTION public._event_meeting_groups(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_meeting_groups(uuid, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_meeting_groups(uuid, uuid, uuid) IS
  'Grupy uczestnika: podstawowa z zapisu plus dodatkowe z event_group_members. Zapis bez grup dziedziczy grupe domyslna wydarzenia. Pomocnik wewnetrzny.';

DROP FUNCTION IF EXISTS public._event_meeting_slot_valid(uuid, uuid, timestamptz, timestamptz);
CREATE FUNCTION public._event_meeting_slot_valid(
  _tenant uuid,
  _event_id uuid,
  _starts timestamptz,
  _ends timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.event_meeting_settings s
    CROSS JOIN unnest(s.meeting_days) AS d(dd)
    CROSS JOIN generate_series(
      ((d.dd + s.day_start_time) AT TIME ZONE s.timezone),
      ((d.dd + s.day_end_time) AT TIME ZONE s.timezone) - make_interval(mins => s.slot_minutes),
      make_interval(mins => s.slot_minutes + s.break_minutes)
    ) AS g(slot_start)
    WHERE s.tenant_id = _tenant
      AND s.event_id = _event_id
      AND g.slot_start = _starts
      AND g.slot_start + make_interval(mins => s.slot_minutes) = _ends
  );
$$;

REVOKE ALL ON FUNCTION public._event_meeting_slot_valid(uuid, uuid, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_meeting_slot_valid(uuid, uuid, timestamptz, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public._event_meeting_slot_valid(uuid, uuid, timestamptz, timestamptz) IS
  'Czy przedzial jest slotem siatki gieldy tego wydarzenia. Siatka liczona z konfiguracji, nie z tabeli wierszy. Pomocnik wewnetrzny.';

DROP FUNCTION IF EXISTS public._event_meeting_available(uuid, uuid, uuid, timestamptz, timestamptz);
CREATE FUNCTION public._event_meeting_available(
  _tenant uuid,
  _event_id uuid,
  _registration_id uuid,
  _starts timestamptz,
  _ends timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.event_meeting_availability a
    WHERE a.tenant_id = _tenant
      AND a.event_id = _event_id
      AND a.registration_id = _registration_id
      AND a.is_open
      AND a.time_range @> tstzrange(_starts, _ends, '[)')
  );
$$;

REVOKE ALL ON FUNCTION public._event_meeting_available(uuid, uuid, uuid, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_meeting_available(uuid, uuid, uuid, timestamptz, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public._event_meeting_available(uuid, uuid, uuid, timestamptz, timestamptz) IS
  'Czy uczestnik ma OTWARTE okno dostepnosci zawierajace CALY podany przedzial. Pomocnik wewnetrzny.';

DROP FUNCTION IF EXISTS public._event_meeting_can_invite(uuid, uuid, uuid, uuid);
CREATE FUNCTION public._event_meeting_can_invite(
  _tenant uuid,
  _event_id uuid,
  _from_registration_id uuid,
  _to_registration_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_visibility text;
  v_enabled boolean;
  v_from_can_meet boolean;
  v_to_can_meet boolean;
BEGIN
  IF _from_registration_id = _to_registration_id THEN
    RETURN 'self_invite';
  END IF;

  SELECT s.is_enabled, s.visibility INTO v_enabled, v_visibility
  FROM public.event_meeting_settings s
  WHERE s.tenant_id = _tenant AND s.event_id = _event_id;

  IF v_visibility IS NULL OR NOT v_enabled THEN
    RETURN 'meetings_disabled';
  END IF;

  IF v_visibility = 'disabled' THEN
    RETURN 'exchange_rule_closed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.event_registrations r
    WHERE r.tenant_id = _tenant AND r.event_id = _event_id
      AND r.id = _from_registration_id
      AND r.status IN ('approved', 'attended')
  ) THEN
    RETURN 'requester_not_participating';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.event_registrations r
    WHERE r.tenant_id = _tenant AND r.event_id = _event_id
      AND r.id = _to_registration_id
      AND r.status IN ('approved', 'attended')
  ) THEN
    RETURN 'invitee_not_participating';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public._event_meeting_groups(_tenant, _event_id, _from_registration_id) AS mg(group_id)
    JOIN public.event_groups g ON g.id = mg.group_id AND g.tenant_id = _tenant
    WHERE g.can_meet
  ) INTO v_from_can_meet;

  IF NOT v_from_can_meet THEN
    RETURN 'requester_group_cannot_meet';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public._event_meeting_groups(_tenant, _event_id, _to_registration_id) AS mg(group_id)
    JOIN public.event_groups g ON g.id = mg.group_id AND g.tenant_id = _tenant
    WHERE g.can_meet
  ) INTO v_to_can_meet;

  IF NOT v_to_can_meet THEN
    RETURN 'invitee_group_cannot_meet';
  END IF;

  IF v_visibility = 'groups' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public._event_meeting_groups(_tenant, _event_id, _from_registration_id) AS mg(group_id)
      JOIN public.event_meeting_rule_groups rg
        ON rg.group_id = mg.group_id
       AND rg.tenant_id = _tenant
       AND rg.event_id = _event_id
       AND rg.side = 'requester'
    ) THEN
      RETURN 'requester_group_not_allowed';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public._event_meeting_groups(_tenant, _event_id, _to_registration_id) AS mg(group_id)
      JOIN public.event_meeting_rule_groups rg
        ON rg.group_id = mg.group_id
       AND rg.tenant_id = _tenant
       AND rg.event_id = _event_id
       AND rg.side = 'invitee'
    ) THEN
      RETURN 'invitee_group_not_allowed';
    END IF;
  END IF;

  IF v_visibility = 'sponsors_to_attendees' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public._event_meeting_groups(_tenant, _event_id, _from_registration_id) AS mg(group_id)
      JOIN public.event_groups g ON g.id = mg.group_id AND g.tenant_id = _tenant
      WHERE g.can_lead_retrieval
    ) THEN
      RETURN 'requester_not_sponsor';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public._event_meeting_can_invite(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_meeting_can_invite(uuid, uuid, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_meeting_can_invite(uuid, uuid, uuid, uuid) IS
  'NULL gdy wolno zaprosic, w przeciwnym razie KLUCZ bledu do slownika i18n. Egzekwuje cztery reguly widocznosci gieldy i uprawnienie can_meet obu stron. Pomocnik wewnetrzny.';

DROP FUNCTION IF EXISTS public._event_meeting_caller_registration(uuid, uuid);
CREATE FUNCTION public._event_meeting_caller_registration(_tenant uuid, _event_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT r.id
  FROM public.event_registrations r
  JOIN public.event_people p
    ON p.id = r.person_id AND p.tenant_id = r.tenant_id
  WHERE r.tenant_id = _tenant
    AND r.event_id = _event_id
    AND p.user_id = auth.uid()
    AND r.status IN ('approved', 'attended')
  ORDER BY r.created_at DESC, r.id DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public._event_meeting_caller_registration(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_meeting_caller_registration(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_meeting_caller_registration(uuid, uuid) IS
  'Uczestniczacy zapis wolajacego na tym wydarzeniu (konto -> kartoteka -> zapis) albo NULL. Pomocnik wewnetrzny.';

DROP FUNCTION IF EXISTS public._event_meeting_free_slots(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, integer
);
CREATE FUNCTION public._event_meeting_free_slots(
  _tenant uuid,
  _event_id uuid,
  _a_registration_id uuid,
  _b_registration_id uuid,
  _from timestamptz,
  _to timestamptz,
  _limit integer
)
RETURNS TABLE (
  starts_at timestamptz,
  ends_at timestamptz,
  table_id uuid,
  table_label text,
  table_zone text,
  table_seat integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH cfg AS (
    SELECT s.*
    FROM public.event_meeting_settings s
    WHERE s.tenant_id = _tenant AND s.event_id = _event_id AND s.is_enabled
  ),
  has_tables AS (
    SELECT EXISTS (
      SELECT 1 FROM public.event_meeting_tables t
      WHERE t.tenant_id = _tenant AND t.event_id = _event_id AND t.is_active
    ) AS present
  ),
  grid AS (
    SELECT
      g.slot_start AS slot_starts_at,
      g.slot_start + make_interval(mins => c.slot_minutes) AS slot_ends_at
    FROM cfg c
    CROSS JOIN unnest(c.meeting_days) AS d(dd)
    CROSS JOIN generate_series(
      ((d.dd + c.day_start_time) AT TIME ZONE c.timezone),
      ((d.dd + c.day_end_time) AT TIME ZONE c.timezone) - make_interval(mins => c.slot_minutes),
      make_interval(mins => c.slot_minutes + c.break_minutes)
    ) AS g(slot_start)
  ),
  daily AS (
    SELECT
      a.registration_id,
      (a.starts_at AT TIME ZONE c.timezone)::date AS grid_day,
      count(*)::integer AS taken
    FROM cfg c
    JOIN public.event_meeting_attendees a
      ON a.tenant_id = _tenant
     AND a.event_id = _event_id
     AND a.registration_id IN (_a_registration_id, _b_registration_id)
     AND a.status IN ('accepted', 'held', 'no_show')
    GROUP BY a.registration_id, (a.starts_at AT TIME ZONE c.timezone)::date
  )
  SELECT
    s.slot_starts_at,
    s.slot_ends_at,
    tb.id,
    tb.label,
    tb.zone,
    tb.seat_no
  FROM grid s
  CROSS JOIN cfg c
  CROSS JOIN has_tables ht
  LEFT JOIN LATERAL (
    SELECT t.id, t.label, t.zone, seat.n AS seat_no
    FROM public.event_meeting_tables t
    CROSS JOIN generate_series(1, t.capacity) AS seat(n)
    WHERE t.tenant_id = _tenant
      AND t.event_id = _event_id
      AND t.is_active
      AND NOT EXISTS (
        SELECT 1
        FROM public.event_meetings m
        WHERE m.tenant_id = _tenant
          AND m.table_id = t.id
          AND m.table_seat = seat.n
          AND m.status IN ('accepted', 'held', 'no_show')
          AND m.time_range && tstzrange(s.slot_starts_at, s.slot_ends_at, '[)')
      )
    ORDER BY t.sort_order, t.label, seat.n
    LIMIT 1
  ) tb ON true
  WHERE s.slot_starts_at > now()
    AND (_from IS NULL OR s.slot_starts_at >= _from)
    AND (_to IS NULL OR s.slot_starts_at < _to)
    AND public._event_meeting_available(
          _tenant, _event_id, _a_registration_id, s.slot_starts_at, s.slot_ends_at)
    AND public._event_meeting_available(
          _tenant, _event_id, _b_registration_id, s.slot_starts_at, s.slot_ends_at)
    AND NOT EXISTS (
      SELECT 1
      FROM public.event_meeting_attendees a
      WHERE a.tenant_id = _tenant
        AND a.event_id = _event_id
        AND a.registration_id IN (_a_registration_id, _b_registration_id)
        AND a.status IN ('accepted', 'held', 'no_show')
        AND a.time_range && tstzrange(s.slot_starts_at, s.slot_ends_at, '[)')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.event_meetings m
      WHERE m.tenant_id = _tenant
        AND m.event_id = _event_id
        AND m.pair_low = LEAST(_a_registration_id, _b_registration_id)
        AND m.pair_high = GREATEST(_a_registration_id, _b_registration_id)
        AND m.status IN ('invited', 'accepted')
        AND m.starts_at = s.slot_starts_at
    )
    AND (NOT ht.present OR tb.id IS NOT NULL)
    AND (
      c.max_meetings_per_day IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM daily dd
        WHERE dd.grid_day = (s.slot_starts_at AT TIME ZONE c.timezone)::date
          AND dd.taken >= c.max_meetings_per_day
      )
    )
  ORDER BY s.slot_starts_at
  LIMIT LEAST(GREATEST(COALESCE(_limit, 100), 1), 500);
$$;

REVOKE ALL ON FUNCTION public._event_meeting_free_slots(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_meeting_free_slots(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, integer
) TO service_role;

COMMENT ON FUNCTION public._event_meeting_free_slots(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, integer
) IS
  'Wolne terminy dla pary uczestnikow: przeciecie okien dostepnosci, siatka slotow, wolne miejsca przy stolikach, limity dzienne i brak kolizji - JEDNYM zapytaniem. Zwracany stolik jest podpowiedzia, nie rezerwacja. Pomocnik wewnetrzny.';

DROP FUNCTION IF EXISTS public._event_meeting_take_seat(
  uuid, uuid, timestamptz, timestamptz, uuid, uuid
);
CREATE FUNCTION public._event_meeting_take_seat(
  _tenant uuid,
  _event_id uuid,
  _starts timestamptz,
  _ends timestamptz,
  _preferred_table_id uuid,
  _exclude_meeting_id uuid
)
RETURNS TABLE (out_table_id uuid, out_table_seat integer)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_has_tables boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.event_meeting_tables t
    WHERE t.tenant_id = _tenant AND t.event_id = _event_id AND t.is_active
  ) INTO v_has_tables;

  IF NOT v_has_tables THEN
    RETURN QUERY SELECT NULL::uuid, NULL::integer;
    RETURN;
  END IF;

  PERFORM 1
  FROM public.event_meeting_tables t
  WHERE t.tenant_id = _tenant
    AND t.event_id = _event_id
    AND t.is_active
    AND (_preferred_table_id IS NULL OR t.id = _preferred_table_id)
  ORDER BY t.sort_order, t.label, t.id
  FOR UPDATE;

  RETURN QUERY
  SELECT t.id, seat.n
  FROM public.event_meeting_tables t
  CROSS JOIN generate_series(1, t.capacity) AS seat(n)
  WHERE t.tenant_id = _tenant
    AND t.event_id = _event_id
    AND t.is_active
    AND (_preferred_table_id IS NULL OR t.id = _preferred_table_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.event_meetings m
      WHERE m.tenant_id = _tenant
        AND m.table_id = t.id
        AND m.table_seat = seat.n
        AND m.status IN ('accepted', 'held', 'no_show')
        AND m.time_range && tstzrange(_starts, _ends, '[)')
        AND (_exclude_meeting_id IS NULL OR m.id <> _exclude_meeting_id)
    )
  ORDER BY t.sort_order, t.label, seat.n
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public._event_meeting_take_seat(
  uuid, uuid, timestamptz, timestamptz, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_meeting_take_seat(
  uuid, uuid, timestamptz, timestamptz, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION public._event_meeting_take_seat(
  uuid, uuid, timestamptz, timestamptz, uuid, uuid
) IS
  'Pierwsze wolne miejsce przy aktywnym stoliku w podanym przedziale, pod blokada FOR UPDATE na wierszach stolikow. Zero wierszy = brak wolnego miejsca; wiersz z NULL-ami = wydarzenie bez stolikow. Pomocnik wewnetrzny.';

CREATE OR REPLACE FUNCTION public.tg_event_meetings_validate()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_capacity integer;
  v_active boolean;
  v_time_changed boolean;
  v_place_changed boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.event_id IS DISTINCT FROM OLD.event_id
       OR NEW.requester_registration_id IS DISTINCT FROM OLD.requester_registration_id
       OR NEW.invitee_registration_id IS DISTINCT FROM OLD.invitee_registration_id THEN
      RAISE EXCEPTION 'meeting_identity_immutable: event and both parties are immutable';
    END IF;
  END IF;

  v_place_changed := TG_OP = 'INSERT'
    OR NEW.table_id IS DISTINCT FROM OLD.table_id
    OR NEW.table_seat IS DISTINCT FROM OLD.table_seat;

  v_time_changed := TG_OP = 'INSERT'
    OR NEW.starts_at IS DISTINCT FROM OLD.starts_at
    OR NEW.ends_at IS DISTINCT FROM OLD.ends_at;

  IF v_place_changed AND NEW.table_id IS NOT NULL THEN
    SELECT t.capacity, t.is_active INTO v_capacity, v_active
    FROM public.event_meeting_tables t
    WHERE t.tenant_id = NEW.tenant_id
      AND t.event_id = NEW.event_id
      AND t.id = NEW.table_id;

    IF v_capacity IS NULL THEN
      RAISE EXCEPTION 'table_not_found: the table does not belong to this event';
    END IF;

    IF NOT v_active AND NEW.status IN ('invited', 'accepted') THEN
      RAISE EXCEPTION 'table_inactive: the table is switched off for new meetings';
    END IF;

    IF NEW.table_seat > v_capacity THEN
      RAISE EXCEPTION 'table_seat_out_of_range: seat % exceeds table capacity %',
        NEW.table_seat, v_capacity;
    END IF;
  END IF;

  IF v_time_changed AND NEW.status IN ('invited', 'accepted') THEN
    IF NOT public._event_meeting_slot_valid(
      NEW.tenant_id, NEW.event_id, NEW.starts_at, NEW.ends_at
    ) THEN
      RAISE EXCEPTION 'slot_not_in_grid: the slot does not belong to the meeting grid';
    END IF;

    IF NOT public._event_meeting_available(
      NEW.tenant_id, NEW.event_id, NEW.requester_registration_id, NEW.starts_at, NEW.ends_at
    ) THEN
      RAISE EXCEPTION 'requester_unavailable: the requester has no open availability window for this slot';
    END IF;

    IF NOT public._event_meeting_available(
      NEW.tenant_id, NEW.event_id, NEW.invitee_registration_id, NEW.starts_at, NEW.ends_at
    ) THEN
      RAISE EXCEPTION 'invitee_unavailable: the invitee has no open availability window for this slot';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_event_meetings_validate() IS
  'Walidacja spotkania: numer miejsca w granicach pojemnosci stolika, slot w siatce, przedzial w oknach dostepnosci obu stron. Warunkowa - sprawdza to, co sie wlasnie zmienilo (uzasadnienie w komentarzu nad funkcja).';

DROP TRIGGER IF EXISTS event_meetings_validate ON public.event_meetings;
CREATE TRIGGER event_meetings_validate
  BEFORE INSERT OR UPDATE ON public.event_meetings
  FOR EACH ROW EXECUTE FUNCTION public.tg_event_meetings_validate();

CREATE OR REPLACE FUNCTION public.tg_event_meetings_sync_attendees()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.event_meeting_attendees (
    tenant_id, event_id, meeting_id, registration_id, side, starts_at, ends_at, status
  )
  VALUES
    (NEW.tenant_id, NEW.event_id, NEW.id, NEW.requester_registration_id,
     'requester', NEW.starts_at, NEW.ends_at, NEW.status),
    (NEW.tenant_id, NEW.event_id, NEW.id, NEW.invitee_registration_id,
     'invitee', NEW.starts_at, NEW.ends_at, NEW.status)
  ON CONFLICT (tenant_id, meeting_id, side) DO UPDATE
  SET registration_id = EXCLUDED.registration_id,
      starts_at = EXCLUDED.starts_at,
      ends_at = EXCLUDED.ends_at,
      status = EXCLUDED.status,
      updated_at = now();

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.tg_event_meetings_sync_attendees() IS
  'Utrzymuje projekcje event_meeting_attendees (dwa wiersze na spotkanie). Nie lapie wyjatku swiadomie: nieudana projekcja to odrzucenie kolizji terminu, czyli dzialanie ograniczenia, nie awaria.';

DROP TRIGGER IF EXISTS event_meetings_sync_attendees ON public.event_meetings;
CREATE TRIGGER event_meetings_sync_attendees
  AFTER INSERT OR UPDATE OF
    requester_registration_id, invitee_registration_id, starts_at, ends_at, status
  ON public.event_meetings
  FOR EACH ROW EXECUTE FUNCTION public.tg_event_meetings_sync_attendees();