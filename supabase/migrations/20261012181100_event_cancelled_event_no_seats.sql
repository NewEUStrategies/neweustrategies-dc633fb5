-- events-harness: include
-- ============================================================================
-- ZAPISY NA WYDARZENIA - REG-07/REG-13 (PRZEGLAD R45, CZ. 2): ODWOLANE ALBO
-- ZAKONCZONE WYDARZENIE NIKOGO JUZ NIE PRZYJMUJE - ANI Z KOLEJKI, ANI PO
-- WPLACIE, ANI BILETEM Z CRONA.
--
-- DEFEKT
--   1. `_event_waitlist_promote` (20261012150000:A) pilnuje tylko
--      `_event_effective_end`: na ODWOLANYM wydarzeniu kazde zwolnione miejsce
--      (rezygnacja, zwrot z webhooka, anulowanie przez organizatora) awansuje
--      kolejnego rozliczonego z kolejki - `approved`, nowy kod QR, zdarzenie
--      `promoted.v1` i mail o awansie na cos, co sie nie odbedzie.
--   2. `admin_event_waitlist_promote` (20261012150000:C), pojedynczy awans:
--      bez straznika konca ani odwolania - organizator awansowal (z kodem QR)
--      po koncu wydarzenia i na odwolanym.
--   3. `_event_ticket_codes_pending` (20260926180000:787-806) nie filtruje
--      odwolanych wydarzen - cron wysylal bilet na odwolane wydarzenie.
--   4. `_event_registration_paid_admission` (20260926180001:559-609) przyjmowal
--      wplate na miejsce (draft/pending/waitlist -> approved z kodem QR) takze
--      po koncu wydarzenia i na odwolanym.
--
-- ZMIANA
--   A. `_event_waitlist_promote` (5 arg.): status wydarzenia czytany pod TA SAMA
--      blokada wiersza wydarzenia; `cancelled` -> zero awansow.
--   B. `admin_event_waitlist_promote`: pojedynczy awans pod blokada wydarzenia
--      odmawia `event_cancelled` i `event_ended` (`_event_effective_end`); hurt
--      dostaje zero awansow z A.
--   C. `_event_ticket_codes_pending`: tylko wydarzenia nieodwolane.
--   D. `_event_registration_paid_admission`: odwolane albo po efektywnym
--      koncu -> status bez zmian (wplata tylko rozlicza wiersz). Wplata na
--      odwolanym wydarzeniu zamyka sie zwrotem w `payments_apply_event_ticket_outcome`
--      (20261012181400).
--
-- CZEGO TO NIE ZAMYKA. Wplata na OTWARTYM zgloszeniu po koncu (nieodwolanego)
-- wydarzenia zostaje w swoim statusie i jest oplacona - organizator zamyka je
-- decyzja 'cancel' (zwrot, bez awansu), jak kazda korekte po koncu.
-- `_event_issue_ticket_codes` (wydanie wskazanego zgloszenia: panel, zapis)
-- bez zmian - na odwolanym wydarzeniu oplacone zgloszenia sa juz zamkniete
-- (20261012181000), a cron bierze identyfikatory z C.
--
-- KOLEJNOSC WDROZENIA: dowolna (sygnatury bez zmian; nowe odmowy
-- `event_cancelled`/`event_ended` panel tlumaczy mapa zapisow).
-- IDEMPOTENTNA: CREATE OR REPLACE, bezstanowe REVOKE/GRANT, COMMENT ON.
-- DOWOD: supabase/tests/event_refund_r45_test.sql.
-- ============================================================================

-- A) AWANS Z KOLEJKI ---------------------------------------------------------------
-- Cialo z 20261012150000:A. ZMIANA 20261012 (R45) oznaczona nizej.
CREATE OR REPLACE FUNCTION public._event_waitlist_promote(
  _tenant uuid,
  _event_id uuid,
  _ticket_type_id uuid,
  _limit integer,
  _skip_group uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(_limit, 1), 1), 500);
  v_row record;
  v_left integer;
  v_token text;
  v_starts timestamptz;
  v_ends timestamptz;
  v_status text;
  v_promoted jsonb := '[]'::jsonb;
BEGIN
  IF _tenant IS NULL OR _event_id IS NULL THEN
    RETURN jsonb_build_object('promoted', 0, 'registrations', '[]'::jsonb);
  END IF;

  -- ZMIANA 20261012 (REG-08, D11): blokada w kolejnosci calego modulu -
  -- wydarzenie ZAWSZE, potem bilet. `_event_seats_left` liczy pojemnosc
  -- wydarzenia na zywo, wiec sama blokada biletu nie chronila
  -- `events.capacity` przed zapisem na inny bilet. Wolajacy, ktory juz
  -- trzyma wydarzenie (decyzja, rezygnacja, wynik platnosci), nic nie traci.
  SELECT e.starts_at, e.ends_at, e.status INTO v_starts, v_ends, v_status
    FROM public.events e
   WHERE e.id = _event_id AND e.tenant_id = _tenant
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('promoted', 0, 'registrations', '[]'::jsonb);
  END IF;

  -- ZMIANA 20261012 (REG-13, D7): po efektywnym koncu wydarzenia zwolnione
  -- miejsce nikomu juz nie sluzy - zero awansow, bez wzgledu na to, kto
  -- zwolnil (kaskada gosci, zwrot, korekta organizatora).
  IF now() >= public._event_effective_end(v_starts, v_ends) THEN
    RETURN jsonb_build_object('promoted', 0, 'registrations', '[]'::jsonb);
  END IF;

  -- ZMIANA 20261012 (R45): odwolane wydarzenie tez nikogo nie przyjmuje -
  -- status czytany pod ta sama blokada, wiec rownolegle odwolanie nie
  -- przecisnie sie miedzy sprawdzeniem a awansem.
  IF v_status = 'cancelled' THEN
    RETURN jsonb_build_object('promoted', 0, 'registrations', '[]'::jsonb);
  END IF;

  IF _ticket_type_id IS NOT NULL THEN
    PERFORM 1 FROM public.event_ticket_types t
    WHERE t.id = _ticket_type_id AND t.tenant_id = _tenant AND t.event_id = _event_id
    FOR UPDATE;
  END IF;

  FOR v_row IN
    SELECT r.id, r.person_id, r.ticket_type_id, p.email, p.first_name, p.last_name, p.user_id
    FROM public.event_registrations r
    JOIN public.event_people p
      ON p.id = r.person_id AND p.tenant_id = r.tenant_id
    WHERE r.tenant_id = _tenant
      AND r.event_id = _event_id
      AND r.status = 'waitlist'
      -- ZMIANA 20261012 (REG-07, D11): awans automatyczny tylko ROZLICZONYCH.
      -- Nieoplacony w kolejce czeka na swojej pozycji; wchodzi, placac
      -- (`_event_registration_paid_admission`), albo decyzja organizatora.
      -- Warunek stoi w WHERE, wiec ORDER BY i LIMIT licza tylko uprawnionych.
      AND r.payment_status IN ('paid', 'partially_refunded', 'not_required')
      AND (_ticket_type_id IS NULL OR r.ticket_type_id = _ticket_type_id)
      -- Grupa, ktorej miejsca wlasnie zwalniamy: prowadzacy i jego goscie.
      AND (_skip_group IS NULL
           OR (r.id <> _skip_group
               AND r.group_lead_registration_id IS DISTINCT FROM _skip_group))
    ORDER BY r.waitlist_position NULLS LAST, r.created_at, r.id
    LIMIT v_limit
  LOOP
    v_left := public._event_seats_left(_tenant, _event_id, v_row.ticket_type_id);
    -- NULL = bez limitu. Zero konczy petle: kolejka jest uporzadkowana, wiec
    -- brak miejsca dla pierwszego znaczy brak dla kazdego nastepnego.
    EXIT WHEN v_left IS NOT NULL AND v_left <= 0;

    v_token := public._event_new_qr_token();

    UPDATE public.event_registrations r
    SET status = 'approved',
        waitlist_position = NULL,
        promoted_at = now(),
        -- Nowy awans = nowe powiadomienie (plakietka panelu).
        waitlist_notified_at = NULL,
        decided_at = now(),
        decided_by = NULL,
        decision_source = 'system',
        qr_token_hash = encode(digest(v_token, 'sha256'), 'hex'),
        qr_issued_at = now()
    WHERE r.id = v_row.id AND r.tenant_id = _tenant AND r.status = 'waitlist'
      -- Rozliczenie sprawdzone ponownie na wierszu: kod QR nigdy dla
      -- nierozliczonego, nawet gdy cos zmienilo wiersz w trakcie petli.
      AND r.payment_status IN ('paid', 'partially_refunded', 'not_required');

    -- Wiersz przyjety w tej petli przez kaskade awansowanego prowadzacego
    -- (jego gosc stal dalej w tej samej kolejce) - nie awansujemy go drugi raz.
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_promoted := v_promoted || jsonb_build_object(
      'registration_id', v_row.id,
      'person_id', v_row.person_id,
      'email', v_row.email,
      'first_name', v_row.first_name,
      'last_name', v_row.last_name,
      'user_id', v_row.user_id,
      'ticket_type_id', v_row.ticket_type_id
    );

    PERFORM public.emit_domain_event(
      _tenant,
      'event_registration',
      v_row.id::text,
      'event.registration.promoted.v1',
      jsonb_build_object('event_id', _event_id, 'person_id', v_row.person_id),
      auth.uid()
    );
  END LOOP;

  RETURN jsonb_build_object(
    'promoted', jsonb_array_length(v_promoted),
    'registrations', v_promoted
  );
END;
$$;

REVOKE ALL ON FUNCTION public._event_waitlist_promote(uuid, uuid, uuid, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_waitlist_promote(uuid, uuid, uuid, integer, uuid)
  TO service_role;

COMMENT ON FUNCTION public._event_waitlist_promote(uuid, uuid, uuid, integer, uuid) IS
  'Promuje osoby z listy rezerwowej na zwolnione miejsca: blokada wydarzenie -> bilet (REG-08), po efektywnym koncu wydarzenia i na wydarzeniu odwolanym zero awansow (REG-13, R45), kandydat tylko rozliczony - paid | partially_refunded | not_required (REG-07; nieoplacony czeka na swojej pozycji), liczenie miejsc przed kazdym awansem, z pominieciem zgloszenia _skip_group i jego gosci (NULL = bez pominiecia). Awans kasuje waitlist_notified_at. Zwraca promowane wiersze - wysylka nalezy do warstwy znajacej jezyk odbiorcy.';

-- B) RECZNY AWANS ORGANIZATORA -----------------------------------------------------
-- Cialo z 20261012150000:C. ZMIANA 20261012 (R45): pojedynczy awans odmawia
-- na wydarzeniu odwolanym (`event_cancelled`) i po jego efektywnym koncu
-- (`event_ended`) - stan wydarzenia czytany pod jego blokada.
CREATE OR REPLACE FUNCTION public.admin_event_waitlist_promote(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_uid uuid := auth.uid();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_reg_id uuid := NULLIF(p_payload->>'registration_id', '')::uuid;
  v_ticket_id uuid := NULLIF(p_payload->>'ticket_type_id', '')::uuid;
  v_count integer := LEAST(GREATEST(COALESCE((NULLIF(p_payload->>'count', ''))::integer, 1), 1), 500);
  v_reg public.event_registrations;
  v_seats_left integer;
  v_token text;
  v_event_status text;
  v_starts timestamptz;
  v_ends timestamptz;
BEGIN
  IF v_reg_id IS NOT NULL THEN
    SELECT * INTO v_reg
    FROM public.event_registrations r
    WHERE r.id = v_reg_id AND r.tenant_id = v_tenant;

    IF v_reg.id IS NULL THEN
      RAISE EXCEPTION 'not_found: registration does not exist in this tenant';
    END IF;
    IF v_reg.status <> 'waitlist' THEN
      RAISE EXCEPTION 'invalid_transition: % is not on the waiting list', v_reg.status;
    END IF;

    SELECT e.status, e.starts_at, e.ends_at INTO v_event_status, v_starts, v_ends
    FROM public.events e
    WHERE e.id = v_reg.event_id AND e.tenant_id = v_tenant
    FOR UPDATE;

    -- ZMIANA 20261012 (R45): miejsce na odwolanym albo zakonczonym
    -- wydarzeniu nikomu nie sluzy, a awans wydalby kod QR.
    IF v_event_status = 'cancelled' THEN
      RAISE EXCEPTION 'event_cancelled: the event has been cancelled';
    END IF;
    IF now() >= public._event_effective_end(v_starts, v_ends) THEN
      RAISE EXCEPTION 'event_ended: the event has already ended';
    END IF;

    IF v_reg.ticket_type_id IS NOT NULL THEN
      PERFORM 1 FROM public.event_ticket_types t
      WHERE t.id = v_reg.ticket_type_id AND t.tenant_id = v_tenant
      FOR UPDATE;
    END IF;

    -- ZMIANA 20261012: stan zgloszenia pod blokadami - odczyt wyzej byl
    -- tylko po to, by wiedziec, ktore wydarzenie i bilet zablokowac.
    SELECT * INTO v_reg
    FROM public.event_registrations r
    WHERE r.id = v_reg_id AND r.tenant_id = v_tenant
    FOR UPDATE;
    IF v_reg.status IS DISTINCT FROM 'waitlist' THEN
      RAISE EXCEPTION 'invalid_transition: registration is no longer on the waiting list';
    END IF;

    v_seats_left := public._event_seats_left(v_tenant, v_reg.event_id, v_reg.ticket_type_id);
    IF v_seats_left IS NOT NULL AND v_seats_left <= 0 THEN
      RAISE EXCEPTION 'no_seats_left: no free seat for this ticket';
    END IF;

    -- ZMIANA 20261012 (REG-07, D11): kod QR jest przepustka - tylko dla
    -- rozliczonego zgloszenia.
    IF v_reg.payment_status IN ('paid', 'partially_refunded', 'not_required') THEN
      v_token := public._event_new_qr_token();
    END IF;

    UPDATE public.event_registrations r
    SET status = 'approved',
        waitlist_position = NULL,
        waitlist_notified_at = NULL,
        promoted_at = now(),
        decided_by = v_uid,
        decided_at = now(),
        decision_source = 'organizer',
        qr_token_hash = CASE
          WHEN v_token IS NOT NULL THEN encode(digest(v_token, 'sha256'), 'hex')
        END,
        qr_issued_at = CASE WHEN v_token IS NOT NULL THEN now() END
    WHERE r.id = v_reg_id AND r.tenant_id = v_tenant AND r.status = 'waitlist';

    PERFORM public.emit_domain_event(
      v_tenant,
      'event_registration',
      v_reg_id::text,
      'event.registration.promoted.v1',
      jsonb_build_object('event_id', v_reg.event_id, 'person_id', v_reg.person_id, 'manual', true),
      v_uid
    );

    RETURN jsonb_build_object(
      'promoted', 1,
      'registrations', jsonb_build_array(jsonb_build_object(
        'registration_id', v_reg_id,
        'person_id', v_reg.person_id
      )),
      'qr_token', v_token
    );
  END IF;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: event_id or registration_id is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  -- Hurt: blokady, koniec i odwolanie wydarzenia oraz rozliczenie pilnuje
  -- `_event_waitlist_promote` (zero awansow, bez odmowy).
  RETURN public._event_waitlist_promote(v_tenant, v_event_id, v_ticket_id, v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_waitlist_promote(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_waitlist_promote(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_waitlist_promote(jsonb) IS
  'Reczna promocja z listy rezerwowej: wskazany zapis poza kolejnoscia (ze sladem decyzji organizatora, stan sprawdzany pod blokadami wydarzenie -> bilet -> zgloszenie; kod QR tylko dla rozliczonego - REG-07; na wydarzeniu odwolanym event_cancelled, po efektywnym koncu event_ended - R45) albo N pierwszych ROZLICZONYCH z kolejki przez _event_waitlist_promote (po koncu i na odwolanym zero). Odpowiedz: promoted = faktyczna liczba awansow. Najemca z assert_editor_tenant().';

-- C) KOLEJKA CRONA BILETOW ------------------------------------------------------------
-- Cialo z 20260926180000:787-806. ZMIANA 20261012 (R45): tylko wydarzenia
-- nieodwolane.
CREATE OR REPLACE FUNCTION public._event_ticket_codes_pending(p_limit integer DEFAULT 50)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
  SELECT COALESCE(array_agg(q.id ORDER BY q.created_at), ARRAY[]::uuid[])
  FROM (
    SELECT reg.id, reg.created_at
    FROM public.event_registrations reg
    JOIN public.events e ON e.id = reg.event_id AND e.tenant_id = reg.tenant_id
    WHERE reg.ticket_code_sent_at IS NULL
      AND reg.status IN ('approved', 'attended')
      AND reg.payment_status IN ('paid', 'partially_refunded', 'not_required')
      AND (reg.registration_mode = 'form' OR reg.source = 'self_registration')
      AND (reg.ticket_code_claimed_at IS NULL
           OR reg.ticket_code_claimed_at < now() - interval '15 minutes')
      AND COALESCE(e.ends_at, e.starts_at + interval '1 day') > now()
      AND e.status IS DISTINCT FROM 'cancelled'
    ORDER BY reg.created_at
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500)
  ) q;
$$;
REVOKE ALL ON FUNCTION public._event_ticket_codes_pending(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_ticket_codes_pending(integer) TO service_role;

COMMENT ON FUNCTION public._event_ticket_codes_pending(integer) IS
  'Kolejka crona biletow: przyjete i rozliczone zgloszenia bez wyslanego biletu (dzierzawa 15 min), tylko wydarzenia nieodwolane (R45) i przed koncem. Tylko service_role.';

-- D) PRZYJECIE PO WPLACIE ------------------------------------------------------------
-- Cialo z 20260926180001:559-609. ZMIANA 20261012 (R45): odwolane albo
-- zakonczone wydarzenie - wplata nie przyjmuje na miejsce.
CREATE OR REPLACE FUNCTION public._event_registration_paid_admission(
  p_reg public.event_registrations,
  p_ticket_type_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_left integer;
  v_needs boolean;
  v_event_status text;
  v_starts timestamptz;
  v_ends timestamptz;
BEGIN
  -- Przyjete, obecne, nieobecne, odwolane, odrzucone - wplata nie zmienia statusu.
  IF p_reg.status NOT IN ('draft', 'pending', 'waitlist') THEN
    RETURN p_reg.status;
  END IF;

  -- ZMIANA 20261012 (R45): wydarzenie odwolane albo po efektywnym koncu -
  -- miejsce nikomu juz nie sluzy. Wplata rozlicza wiersz, status zostaje
  -- (na odwolanym zamyka go wolajacy ze zwrotem).
  SELECT e.status, e.starts_at, e.ends_at INTO v_event_status, v_starts, v_ends
    FROM public.events e
   WHERE e.id = p_reg.event_id AND e.tenant_id = p_reg.tenant_id;
  IF v_event_status = 'cancelled' OR now() >= public._event_effective_end(v_starts, v_ends) THEN
    RETURN p_reg.status;
  END IF;

  IF p_reg.group_lead_registration_id IS NOT NULL THEN
    -- Gosc idzie za prowadzacym: bez prowadzacego na miejscu tylko rozliczenie.
    IF NOT EXISTS (
      SELECT 1 FROM public.event_registrations l
      WHERE l.id = p_reg.group_lead_registration_id
        AND l.tenant_id = p_reg.tenant_id
        AND l.status IN ('approved', 'attended', 'no_show')
    ) THEN
      RETURN p_reg.status;
    END IF;
  ELSIF p_reg.status <> 'waitlist' THEN
    -- Wplata nie jest akceptacja. Ta sama regula, co w `event_register`.
    SELECT COALESCE(t.requires_approval, false)
        OR CASE public._event_registration_verdict(p_reg.tenant_id, p_reg.event_id, p_reg.answers)
             WHEN 'auto_approve' THEN false
             WHEN 'none' THEN e.registration_flow = 'approval'
             ELSE true
           END
      INTO v_needs
    FROM public.events e
    LEFT JOIN public.event_ticket_types t
      ON t.id = p_ticket_type_id AND t.tenant_id = e.tenant_id AND t.event_id = e.id
    WHERE e.id = p_reg.event_id AND e.tenant_id = p_reg.tenant_id;

    IF COALESCE(v_needs, false) THEN
      RETURN 'pending';
    END IF;
  END IF;

  v_left := public._event_seats_left(p_reg.tenant_id, p_reg.event_id, p_ticket_type_id);
  RETURN CASE WHEN v_left IS NULL OR v_left > 0 THEN 'approved' ELSE 'waitlist' END;
END $$;
REVOKE ALL ON FUNCTION public._event_registration_paid_admission(public.event_registrations, uuid)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._event_registration_paid_admission(public.event_registrations, uuid) IS
  'Status oplaconego zgloszenia po wplacie: przyjete/obecne/nieobecne/odwolane/odrzucone bez zmian; wydarzenie odwolane albo po efektywnym koncu bez zmian (R45); gosc bez prowadzacego na miejscu bez zmian; zgloszenie wymagajace akceptacji (bilet requires_approval, przeplyw approval bez reguly auto_approve, regula approval albo reject) -> pending; poza tym miejsce (_event_seats_left) -> approved, brak -> waitlist. Zgloszenie juz w kolejce pomija akceptacje. Wolajacy trzyma blokade wydarzenia i biletu.';
