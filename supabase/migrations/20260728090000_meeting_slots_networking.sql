-- ============================================================================
-- NETWORKING 1-1: sloty spotkan hostow (uzytkownicy/eksperci/prelegenci)
-- + rezerwacje 1-1 dla widgetu buildera "meeting-booking".
--
--   * meeting_slots - host (uzytkownik/ekspert) publikuje godzinowe okna
--     dostepnosci, opcjonalnie przypiete do wydarzenia (networking na
--     konferencji). Wiersze sa tenantowe (tenant profilu hosta).
--   * meeting_bookings - rezerwacja 1-1 (jeden potwierdzony attendee na slot,
--     unikalnosc egzekwowana czesciowym indeksem + FOR UPDATE na slocie -
--     wzorzec rsvp_event). Tozsamosc rezerwujacego NIE jest publiczna:
--     publiczna projekcja zwraca tylko is_booked/booked_by_me.
--   * Wszystkie odczyty/zapisy klienckie ida przez RPC (tabele nie sa w
--     wygenerowanych typach klienta; brak polityk INSERT/UPDATE dla klienta
--     poza wlasnymi slotami hosta zarzadzanymi takze przez RPC):
--       - get_public_meeting_slots  (plaszczyzna TRESCI: public_tenant_id)
--       - create_my_meeting_slot / delete_my_meeting_slot (wlasne sloty)
--       - book_meeting_slot / cancel_my_meeting_booking   (rezerwacje)
--     Zadna funkcja nie laczy public_tenant_id() z has_role()
--     (scripts/check-sql-tenant-scope.ts).
--
-- Wszystko idempotentne.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.meeting_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  host_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  -- Miejsce spotkania: sala/stolik albo link do wideorozmowy.
  location text,
  is_public boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  -- Slot godzinowy w rozsadnych granicach (5 min - 8 h).
  CHECK (ends_at - starts_at BETWEEN interval '5 minutes' AND interval '8 hours')
);

CREATE INDEX IF NOT EXISTS idx_meeting_slots_host
  ON public.meeting_slots (tenant_id, host_user_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_meeting_slots_event
  ON public.meeting_slots (event_id, starts_at) WHERE event_id IS NOT NULL;
-- Ten sam host nie moze opublikowac dwoch slotow o identycznym starcie.
CREATE UNIQUE INDEX IF NOT EXISTS uq_meeting_slots_host_start
  ON public.meeting_slots (tenant_id, host_user_id, starts_at);

REVOKE ALL ON public.meeting_slots FROM anon, authenticated;
GRANT SELECT ON public.meeting_slots TO anon, authenticated;
GRANT ALL ON public.meeting_slots TO service_role;
ALTER TABLE public.meeting_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meeting_slots public read" ON public.meeting_slots;
CREATE POLICY "meeting_slots public read" ON public.meeting_slots
  FOR SELECT TO anon, authenticated
  USING (
    is_public
    AND tenant_id = (SELECT public.public_tenant_id())
  );

DROP POLICY IF EXISTS "meeting_slots owner read" ON public.meeting_slots;
CREATE POLICY "meeting_slots owner read" ON public.meeting_slots
  FOR SELECT TO authenticated
  USING (host_user_id = (SELECT auth.uid()));
-- Zapisy wylacznie przez RPC create_my_meeting_slot / delete_my_meeting_slot.

CREATE TABLE IF NOT EXISTS public.meeting_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  slot_id uuid NOT NULL REFERENCES public.meeting_slots(id) ON DELETE CASCADE,
  attendee_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note text,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 1-1: dokladnie jedna POTWIERDZONA rezerwacja na slot.
CREATE UNIQUE INDEX IF NOT EXISTS uq_meeting_bookings_slot_confirmed
  ON public.meeting_bookings (slot_id) WHERE status = 'confirmed';
CREATE INDEX IF NOT EXISTS idx_meeting_bookings_attendee
  ON public.meeting_bookings (attendee_user_id, created_at DESC);

DROP TRIGGER IF EXISTS meeting_bookings_set_updated_at ON public.meeting_bookings;
CREATE TRIGGER meeting_bookings_set_updated_at
  BEFORE UPDATE ON public.meeting_bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

REVOKE ALL ON public.meeting_bookings FROM anon, authenticated;
GRANT SELECT ON public.meeting_bookings TO authenticated;
GRANT ALL ON public.meeting_bookings TO service_role;
ALTER TABLE public.meeting_bookings ENABLE ROW LEVEL SECURITY;

-- Rezerwacje widza wylacznie strony spotkania (attendee + host slotu).
DROP POLICY IF EXISTS "meeting_bookings parties read" ON public.meeting_bookings;
CREATE POLICY "meeting_bookings parties read" ON public.meeting_bookings
  FOR SELECT TO authenticated
  USING (
    attendee_user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.meeting_slots ms
       WHERE ms.id = slot_id AND ms.host_user_id = (SELECT auth.uid())
    )
  );
-- Zapisy wylacznie przez RPC book_meeting_slot / cancel_my_meeting_booking.

-- ----------------------------------------------------------------------------
-- RPC: publiczna projekcja slotow (widget meeting-booking).
-- Plaszczyzna TRESCI (public_tenant_id); auth.uid() sluzy wylacznie do
-- oznaczenia booked_by_me/is_mine - zadnego has_role.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_public_meeting_slots(
  p_host_user_id uuid DEFAULT NULL,
  p_event_id uuid DEFAULT NULL,
  p_days integer DEFAULT 14,
  p_limit integer DEFAULT 200
)
RETURNS TABLE (
  id uuid,
  host_user_id uuid,
  host_name text,
  host_avatar_url text,
  host_slug text,
  event_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  location text,
  is_booked boolean,
  booked_by_me boolean,
  is_mine boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ms.id,
    ms.host_user_id,
    p.display_name AS host_name,
    p.avatar_url AS host_avatar_url,
    p.slug AS host_slug,
    ms.event_id,
    ms.starts_at,
    ms.ends_at,
    ms.location,
    EXISTS (
      SELECT 1 FROM public.meeting_bookings b
       WHERE b.slot_id = ms.id AND b.status = 'confirmed'
    ) AS is_booked,
    EXISTS (
      SELECT 1 FROM public.meeting_bookings b
       WHERE b.slot_id = ms.id
         AND b.status = 'confirmed'
         AND b.attendee_user_id = auth.uid()
    ) AS booked_by_me,
    (ms.host_user_id = auth.uid()) AS is_mine
  FROM public.meeting_slots ms
  JOIN public.profiles p
    ON p.id = ms.host_user_id
   AND p.tenant_id = (SELECT public.public_tenant_id())
  WHERE ms.tenant_id = (SELECT public.public_tenant_id())
    AND (ms.is_public OR ms.host_user_id = auth.uid())
    AND (p_host_user_id IS NULL OR ms.host_user_id = p_host_user_id)
    AND (p_event_id IS NULL OR ms.event_id = p_event_id)
    AND ms.starts_at >= now() - interval '1 hour'
    AND ms.starts_at < now()
      + make_interval(days => LEAST(GREATEST(COALESCE(p_days, 14), 1), 90))
  ORDER BY ms.starts_at
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
$$;

REVOKE EXECUTE ON FUNCTION public.get_public_meeting_slots(uuid, uuid, integer, integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_meeting_slots(uuid, uuid, integer, integer)
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- RPC: host publikuje wlasny slot. Tenant = tenant profilu hosta.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_my_meeting_slot(
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_event_id uuid DEFAULT NULL,
  p_location text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'meetings: authentication required';
  END IF;
  IF p_starts_at IS NULL OR p_ends_at IS NULL OR p_ends_at <= p_starts_at THEN
    RAISE EXCEPTION 'meetings: invalid time range';
  END IF;
  IF p_starts_at < now() THEN
    RAISE EXCEPTION 'meetings: slot in the past';
  END IF;

  SELECT pr.tenant_id INTO v_tenant FROM public.profiles pr WHERE pr.id = v_user;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'meetings: tenant unresolved';
  END IF;

  IF p_event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.events e
     WHERE e.id = p_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'meetings: event not found in tenant';
  END IF;

  INSERT INTO public.meeting_slots (tenant_id, host_user_id, event_id, starts_at, ends_at, location)
  VALUES (v_tenant, v_user, p_event_id, p_starts_at, p_ends_at, NULLIF(btrim(COALESCE(p_location, '')), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_my_meeting_slot(timestamptz, timestamptz, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_my_meeting_slot(timestamptz, timestamptz, uuid, text)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- RPC: host usuwa wlasny slot (rezerwacje kaskadowo; zarezerwowany slot
-- mozna usunac swiadomie - attendee zobaczy zniknieta rezerwacje).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_my_meeting_slot(p_slot_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_deleted integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'meetings: authentication required';
  END IF;
  DELETE FROM public.meeting_slots
   WHERE id = p_slot_id AND host_user_id = v_user;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_my_meeting_slot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_meeting_slot(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- RPC: rezerwacja 1-1 pod blokada wiersza slotu (bez wyscigu).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.book_meeting_slot(p_slot_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_slot public.meeting_slots%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'meetings: authentication required';
  END IF;

  SELECT * INTO v_slot
    FROM public.meeting_slots
   WHERE id = p_slot_id
     AND tenant_id = public.public_tenant_id()
     AND is_public
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'meetings: slot not found';
  END IF;
  IF v_slot.host_user_id = v_user THEN
    RAISE EXCEPTION 'meetings: cannot book own slot';
  END IF;
  IF v_slot.starts_at < now() THEN
    RAISE EXCEPTION 'meetings: slot in the past';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.meeting_bookings b
     WHERE b.slot_id = p_slot_id AND b.status = 'confirmed'
  ) THEN
    RAISE EXCEPTION 'meetings: slot already booked';
  END IF;

  INSERT INTO public.meeting_bookings (tenant_id, slot_id, attendee_user_id, note)
  VALUES (v_slot.tenant_id, p_slot_id, v_user, NULLIF(btrim(COALESCE(p_note, '')), ''));

  -- Powiadomienie hosta (best-effort; szanuje preferencje uzytkownika).
  BEGIN
    PERFORM public.enqueue_notification(
      v_slot.host_user_id,
      'content',
      'Nowa rezerwacja spotkania 1-1',
      'New 1-1 meeting booking',
      'Ktos zarezerwowal Twoj slot '
        || to_char(v_slot.starts_at AT TIME ZONE 'Europe/Warsaw', 'DD.MM HH24:MI') || '.',
      'Someone booked your slot at '
        || to_char(v_slot.starts_at AT TIME ZONE 'Europe/Warsaw', 'DD.MM HH24:MI')
        || ' (Warsaw time).',
      '/profile',
      'CalendarClock'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'meetings: booking notification failed: %', SQLERRM;
  END;

  RETURN jsonb_build_object('slot_id', p_slot_id, 'status', 'confirmed');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.book_meeting_slot(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.book_meeting_slot(uuid, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- RPC: attendee anuluje wlasna rezerwacje (slot wraca do puli).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_my_meeting_booking(p_slot_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_updated integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'meetings: authentication required';
  END IF;
  UPDATE public.meeting_bookings
     SET status = 'cancelled', updated_at = now()
   WHERE slot_id = p_slot_id
     AND attendee_user_id = v_user
     AND status = 'confirmed';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_my_meeting_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_my_meeting_booking(uuid) TO authenticated, service_role;
