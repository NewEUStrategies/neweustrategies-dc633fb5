-- events-harness: include
-- ============================================================================
-- ZAPISY NA WYDARZENIA - REG-07: KOLEJKA AWANSUJE TYLKO ROZLICZONYCH, KOD QR
-- TYLKO DLA ROZLICZONYCH, BRAMKA NIE WPUSZCZA NIEROZLICZONYCH; REG-08 (CZESC
-- KOLEJKI): AWANS BLOKUJE WYDARZENIE PRZED BILETEM; REG-13: BEZ AWANSU PO
-- KONCU WYDARZENIA.
--
-- DEFEKT
--   1. REG-07. `_event_waitlist_promote` (20260926180000:101-213) wybiera
--      kandydatow samym `status = 'waitlist'` (:144) - bez `payment_status`.
--      Nieoplacone zgloszenie z kolejki (organizator wstawil je tam przed
--      wplata) awansowalo na zwolnione miejsce przed oplaconymi, dostawalo
--      `approved`, nowy kod QR (:169) i mail o awansie - bez terminu wplaty,
--      na stale zajmujac miejsce w puli.
--   2. REG-07. `admin_event_waitlist_promote` (20260824090921:267-357) wydawal
--      kod QR przy recznym awansie BEZWARUNKOWO (:312, :322) i oddawal go
--      w odpowiedzi - takze dla zgloszenia nieoplaconego. Decyzja 'approve'
--      tej samej funkcji organizatora kodu nieoplaconemu nie wydaje.
--   3. REG-07. `_event_checkin_evaluate` (20260824102000:2-75) sprawdzal tylko
--      `status IN ('approved','attended')` (:49) - przyjety, ale
--      nierozliczony wiersz (np. awansowany przez system przed ta naprawa)
--      przechodzil bramke QR, samoobslugowa i reczna.
--   4. REG-08. Awans z biletem blokowal SAM bilet (20260926180000:127-135),
--      a `_event_seats_left` liczy takze pojemnosc wydarzenia na zywo -
--      hurtowy awans organizatora (bez wczesniejszej blokady) scigal sie
--      z zapisem na inny bilet tego wydarzenia i przekraczal `events.capacity`.
--      Kolejnosc „bilet przed wydarzeniem" byla tez odwrotna wobec reszty
--      modulu (wydarzenie -> bilet -> zgloszenie).
--   5. REG-13 (przekazanie B4). Kaskada gosci (`_tg_event_group_follow_lead_status`
--      -> `_event_group_promote_freed`) i zwrot po koncu wydarzenia awansowaly
--      kolejke na cos, co juz sie odbylo.
--
-- ZMIANA
--   A. `_event_waitlist_promote` (5 arg.): blokada wydarzenie -> bilet ZAWSZE;
--      po `_event_effective_end` zero awansow; kandydat tylko rozliczony
--      (`payment_status IN ('paid','partially_refunded','not_required')`) -
--      nierozliczony zostaje w kolejce na swojej pozycji (wejdzie, placac:
--      `_event_registration_paid_admission`). Wariant 4-arg. bez zmian.
--   B. `_event_group_promote_freed` (4 arg.): ta sama granica konca wydarzenia
--      jawnie, zanim petla dotknie biletow.
--   C. `admin_event_waitlist_promote`: pojedynczy awans ponownie czyta zgloszenie
--      pod blokadami (wydarzenie -> bilet -> zgloszenie) i wydaje kod QR tylko
--      rozliczonemu - nierozliczony to swiadoma decyzja organizatora (jak
--      'approve' przed wplata) bez kodu. Hurt - przez A.
--   D. `_event_checkin_evaluate`: `approved` + nierozliczone ->
--      `denied_registration_status`, z wyjatkiem swiadomej furtki organizatora
--      (`decision_source = 'organizer'` + `unpaid`). Istniejacy wynik - bez
--      zmian CHECK-ow, slownikow i lustra offline.
--   E. Jednorazowo (`_event_unsettled_qr_repair`, wolana raz): kody QR
--      nierozliczonych przyjetych zgloszen skasowane (bez powiadomien),
--      NOTICE z liczba zgloszen awansowanych przez system bez wplaty (zostaja
--      na miejscu - decyzja nalezy do organizatora; bramka z D juz ich nie
--      wpuszcza).
--   F. `_event_seats_left`: prawdziwy kontrakt blokad w komentarzu, EXECUTE
--      tylko dla service_role (wolaja ja wylacznie funkcje SECURITY DEFINER).
--
-- CZEGO TO NIE ZAMYKA. Brak mechanizmu ofert z terminem (`waitlist_offer_hours`
-- nadal bez konsumenta): nieoplacony z kolejki traci kolejnosc na rzecz
-- rozliczonych i placi dopiero, gdy jest wolne miejsce. Awans calego
-- wydarzenia (bez biletu) dalej konczy petle na pierwszym pelnym bilecie.
-- Grupy gosci (`event_register_group_guests`) - osobny plik tego slotu
-- (20261012150100).
--
-- KOLEJNOSC WDROZENIA: dowolna (sygnatury bez zmian; front czyta nowe
-- `data.promoted` i plakietke `unpaidWaitlisted` niezaleznie od bazy).
-- IDEMPOTENTNA: CREATE OR REPLACE, bezstanowe REVOKE/GRANT, COMMENT ON,
-- naprawa QR to UPDATE z warunkiem (drugi przebieg nie znajduje wierszy).
-- DOWOD: supabase/tests/event_waitlist_settlement_test.sql,
--   scripts/events-harness/runtime_test.d/29_waitlist_settlement_group_locks.sql,
--   scripts/events-harness/runtime_test.d/24_group_refund_promotes_waitlist.sql.
-- ============================================================================

-- A) AWANS Z KOLEJKI ---------------------------------------------------------------
-- Cialo z 20260926180000:101-204. Zmiany oznaczone `ZMIANA 20261012`.
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
  SELECT e.starts_at, e.ends_at INTO v_starts, v_ends
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
  'Promuje osoby z listy rezerwowej na zwolnione miejsca: blokada wydarzenie -> bilet (REG-08), po efektywnym koncu wydarzenia zero awansow (REG-13), kandydat tylko rozliczony - paid | partially_refunded | not_required (REG-07; nieoplacony czeka na swojej pozycji), liczenie miejsc przed kazdym awansem, z pominieciem zgloszenia _skip_group i jego gosci (NULL = bez pominiecia). Awans kasuje waitlist_notified_at. Zwraca promowane wiersze - wysylka nalezy do warstwy znajacej jezyk odbiorcy.';

-- B) AWANS ZA MIEJSCA GOSCI ----------------------------------------------------------
-- Cialo z 20260926180000:243-265. ZMIANA 20261012 (REG-13, D7, przekazanie B4):
-- kaskada zamkniecia prowadzacego po koncu wydarzenia (organizator moze
-- zamknac zgloszenie po koncu - korekta) nie awansuje nikogo za miejsca gosci.
-- `_event_waitlist_promote` pilnuje tej samej granicy; tu wychodzimy wczesniej,
-- zanim petla zablokuje choc jeden bilet.
CREATE OR REPLACE FUNCTION public._event_group_promote_freed(
  p_tenant uuid,
  p_event_id uuid,
  p_ticket_types uuid[],
  p_skip_group uuid
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  f record;
  v_n integer := 0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.events e
     WHERE e.id = p_event_id AND e.tenant_id = p_tenant
       AND now() >= public._event_effective_end(e.starts_at, e.ends_at)
  ) THEN
    RETURN 0;
  END IF;

  FOR f IN
    SELECT t.ticket_type_id, count(*)::integer AS seats
    FROM unnest(p_ticket_types) AS t(ticket_type_id)
    GROUP BY t.ticket_type_id
    ORDER BY t.ticket_type_id NULLS LAST
  LOOP
    v_n := v_n + COALESCE((public._event_waitlist_promote(
      p_tenant, p_event_id, f.ticket_type_id, f.seats, p_skip_group)->>'promoted')::integer, 0);
  END LOOP;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public._event_group_promote_freed(uuid, uuid, uuid[], uuid)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._event_group_promote_freed(uuid, uuid, uuid[], uuid) IS
  'Awans z kolejki rezerwowej za miejsca zwolnione przez gosci grupy: jeden element tablicy = jedno zwolnione miejsce danego biletu (NULL = bez cennika), z pominieciem zgloszenia p_skip_group i jego gosci (NULL = bez pominiecia). Osobno dla kazdego biletu, przez _event_waitlist_promote (tylko rozliczeni). Po efektywnym koncu wydarzenia zero awansow (REG-13). Zwraca liczbe awansowanych.';

-- C) RECZNY AWANS ORGANIZATORA -----------------------------------------------------
-- Cialo z 20260824090921:267-357. Zmiany (ZMIANA 20261012):
--   * search_path z `pg_temp` (ostatni), jak w reszcie modulu;
--   * pojedynczy awans: status sprawdzany ponownie POD blokadami wydarzenie ->
--     bilet -> zgloszenie (dwa rownolegle klikniecia nie awansuja dwa razy
--     ani nie nadpisuja decyzji, ktora zapadla w miedzyczasie);
--   * REG-07: kod QR tylko dla rozliczonego. Nierozliczony dostaje miejsce
--     decyzja organizatora (`decision_source = 'organizer'`) bez kodu - jak
--     'approve' przed wplata; bramka wpuszcza go jako swiadoma furtke.
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

    PERFORM 1 FROM public.events e
    WHERE e.id = v_reg.event_id AND e.tenant_id = v_tenant
    FOR UPDATE;

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

  -- Hurt: blokady, koniec wydarzenia i rozliczenie pilnuje `_event_waitlist_promote`.
  RETURN public._event_waitlist_promote(v_tenant, v_event_id, v_ticket_id, v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_waitlist_promote(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_waitlist_promote(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_waitlist_promote(jsonb) IS
  'Reczna promocja z listy rezerwowej: wskazany zapis poza kolejnoscia (ze sladem decyzji organizatora, stan sprawdzany pod blokadami wydarzenie -> bilet -> zgloszenie; kod QR tylko dla rozliczonego - REG-07) albo N pierwszych ROZLICZONYCH z kolejki przez _event_waitlist_promote (po koncu wydarzenia zero). Odpowiedz: promoted = faktyczna liczba awansow. Najemca z assert_editor_tenant().';

-- D) BRAMKA WEJSCIA ------------------------------------------------------------------
-- Cialo z 20260824102000:2-66. ZMIANA 20261012 (REG-07, D11): przyjete, ale
-- nierozliczone zgloszenie nie przechodzi bramki - wynik
-- `denied_registration_status` (istniejacy: CHECK-i dziennika, lustro offline
-- i slowniki bez zmian). Wyjatek to swiadoma furtka organizatora: przyjal
-- nieoplacone zgloszenie decyzja ('approve' przed wplata, reczny awans) -
-- `decision_source = 'organizer'` i `payment_status = 'unpaid'`. Obecny
-- (`attended`, powrot na sale) i punkt `track` (wpuszcza i loguje) - bez zmian.
CREATE OR REPLACE FUNCTION public._event_checkin_evaluate(
  _tenant uuid,
  _event_id uuid,
  _checkpoint_id uuid,
  _person_id uuid,
  _direction text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cp public.event_checkpoints;
  v_reg_id uuid;
  v_status text;
  v_payment text;
  v_decision_source text;
  v_result text;
  v_occupancy integer;
BEGIN
  SELECT cp.* INTO v_cp
  FROM public.event_checkpoints cp
  WHERE cp.tenant_id = _tenant
    AND cp.event_id = _event_id
    AND cp.id = _checkpoint_id;

  IF v_cp.id IS NULL THEN
    RAISE EXCEPTION 'checkpoint_not_found: checkpoint does not exist in this event';
  END IF;

  v_occupancy := public._event_checkpoint_occupancy(_tenant, _checkpoint_id);

  IF NOT v_cp.is_active THEN
    v_result := 'denied_checkpoint_inactive';
  ELSIF (_direction = 'in' AND v_cp.direction_mode = 'out_only')
     OR (_direction = 'out' AND v_cp.direction_mode = 'in_only') THEN
    v_result := 'denied_direction';
  ELSE
    SELECT r.id, r.status, r.payment_status, r.decision_source
      INTO v_reg_id, v_status, v_payment, v_decision_source
    FROM public.event_registrations r
    WHERE r.tenant_id = _tenant
      AND r.event_id = _event_id
      AND r.person_id = _person_id
      AND r.status NOT IN ('cancelled', 'rejected');

    IF v_reg_id IS NULL THEN
      v_result := 'denied_not_registered';
    ELSIF v_status NOT IN ('approved', 'attended') THEN
      v_result := 'denied_registration_status';
    ELSIF v_status = 'approved'
      AND COALESCE(v_payment, 'unpaid') NOT IN ('paid', 'partially_refunded', 'not_required')
      AND NOT (v_payment = 'unpaid' AND v_decision_source IS NOT DISTINCT FROM 'organizer') THEN
      v_result := 'denied_registration_status';
    ELSIF _direction = 'in' AND v_cp.capacity IS NOT NULL AND v_occupancy >= v_cp.capacity THEN
      v_result := 'denied_capacity';
    ELSE
      v_result := 'granted';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'result', v_result,
    'registration_id', v_reg_id,
    'occupancy', v_occupancy,
    'capacity', v_cp.capacity,
    'access_mode', v_cp.access_mode
  );
END;
$$;

REVOKE ALL ON FUNCTION public._event_checkin_evaluate(uuid, uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_checkin_evaluate(uuid, uuid, uuid, uuid, text)
  TO service_role;

COMMENT ON FUNCTION public._event_checkin_evaluate(uuid, uuid, uuid, uuid, text) IS
  'Jedna definicja decyzji odprawy dla podgladu (event_checkin_resolve) i dla zapisu (_event_checkin_write: QR, samoobsluga, stanowisko reczne). Przyjete, ale nierozliczone zgloszenie -> denied_registration_status (REG-07), poza swiadoma furtka organizatora (decision_source organizer + unpaid). Liczy, nie rezerwuje - wiazacy jest tylko wynik policzony pod blokada wiersza punktu.';

-- E) NAPRAWA JEDNORAZOWA: KOD QR NIEROZLICZONYCH ---------------------------------
-- Kod QR wydany nierozliczonemu przyjetemu zgloszeniu (awans systemu sprzed
-- tej naprawy, reczny awans organizatora) przestaje istniec. UPDATE dotyka
-- tylko kolumn kodu - z triggerow odpala wylacznie `touch_updated_at`
-- (status i platnosc bez zmian), wiec nikt nie dostaje maila, a delta
-- czytnika offline oddaje te wiersze jako `gone`. Drugi przebieg nie
-- znajduje juz wierszy.
--
-- Zgloszenia awansowane przez SYSTEM bez wplaty nadal trzymaja miejsce. Nie
-- cofamy ich po cichu do kolejki (kaskada gosci, RSVP, mail „awansowales"
-- juz wyszedl) - liczba trafia do dziennika wdrozenia, decyzja nalezy do
-- organizatora (bramka z sekcji D juz ich nie wpuszcza).
--
-- FUNKCJA, A NIE GOLY UPDATE: migracja wola ja raz, a test dowodzi na
-- fiksturach dokladnie tego predykatu (naprawy z pliku migracji nie da sie
-- inaczej uruchomic na danych wstawionych po replayu). Bez SECURITY DEFINER,
-- bez EXECUTE dla klientow.
CREATE OR REPLACE FUNCTION public._event_unsettled_qr_repair()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cleared integer;
  v_legacy integer;
BEGIN
  UPDATE public.event_registrations r
     SET qr_token_hash = NULL,
         qr_issued_at = NULL
   WHERE r.status = 'approved'
     AND r.payment_status NOT IN ('paid', 'partially_refunded', 'not_required')
     AND r.qr_token_hash IS NOT NULL;
  GET DIAGNOSTICS v_cleared = ROW_COUNT;

  SELECT count(*)::integer INTO v_legacy
    FROM public.event_registrations r
   WHERE r.status = 'approved'
     AND r.payment_status = 'unpaid'
     AND r.decision_source = 'system'
     AND r.promoted_at IS NOT NULL;

  RETURN jsonb_build_object('cleared', v_cleared, 'legacy_system_promoted', v_legacy);
END;
$$;

REVOKE ALL ON FUNCTION public._event_unsettled_qr_repair() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_unsettled_qr_repair() TO service_role;

COMMENT ON FUNCTION public._event_unsettled_qr_repair() IS
  'REG-07, naprawa jednorazowa (20261012150000): kasuje kod QR przyjetych, ale nierozliczonych zgloszen (bez powiadomien) i liczy zgloszenia awansowane przez system bez wplaty. {cleared, legacy_system_promoted}. Idempotentna. Tylko service_role.';

DO $$
DECLARE
  v_repair jsonb := public._event_unsettled_qr_repair();
BEGIN
  RAISE NOTICE 'REG-07: skasowane kody QR nierozliczonych przyjetych zgloszen: %', v_repair->>'cleared';
  RAISE NOTICE 'REG-07: zgloszenia awansowane przez system bez wplaty (trzymaja miejsce, bramka ich nie wpuszcza): %',
    v_repair->>'legacy_system_promoted';
END
$$;

-- F) KONTRAKT LICZNIKA MIEJSC ---------------------------------------------------------
-- Wolaja ja wylacznie funkcje SECURITY DEFINER (oraz `_event_registration_ticket_json`
-- wolana tylko z nich); przegladarka nie wola jej nigdy. Najemce bierze
-- z argumentu, wiec EXECUTE dla `authenticated` byl zbednym odczytem
-- obsadzenia cudzych wydarzen.
REVOKE ALL ON FUNCTION public._event_seats_left(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_seats_left(uuid, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_seats_left(uuid, uuid, uuid) IS
  'Wolne miejsca wydarzenia (i biletu, gdy podany). NULL = bez limitu. Liczy, nie rezerwuje: pojemnosc wydarzenia liczona na zywo z przyjetych wierszy, wiec wolajacy, ktory potem zajmuje miejsce, trzyma FOR UPDATE na wierszu WYDARZENIA (zawsze), a na wierszu biletu - gdy bilet podany (kolejnosc wydarzenie -> bilet -> zgloszenie, REG-08). Tylko service_role i funkcje SECURITY DEFINER.';
