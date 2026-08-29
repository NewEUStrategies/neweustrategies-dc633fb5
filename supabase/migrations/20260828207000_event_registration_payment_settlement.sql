-- ============================================================================
-- WYJSCIE ZE STANU „NIEZAPLACONE" - inaczej bramka z 20260828206000 jest slepa
-- uliczka.
--
-- CO BYLO ZLE. Migracja `20260828206000` przestala wydawac platny bilet za
-- darmo: zgloszenie z `payment_status = 'unpaid'` nie dostaje kodu QR. Sama
-- bramka byla poprawna, ale NIC nie umialo z tego stanu wyprowadzic:
--
--   * `admin_event_registration_decide` akcja `approve` wymaga statusu
--     `draft | pending | waitlist | rejected | cancelled`, wiec zgloszenia
--     stojacego juz `approved` nie dalo sie „zatwierdzic ponownie",
--   * zadna inna funkcja nie ustawia `payment_status`,
--   * a kod QR powstaje wylacznie w `event_register` i w `decide/approve`.
--
-- Skutek dla uczestnika: placi przelewem, organizator widzi wplate i NIE MA
-- czym wydac wejsciowki. Zamiast darmowego biletu (blad K-1) dostawalismy bilet
-- niemozliwy do wydania - zamiana jednej awarii na druga.
--
-- CO ROBI TA MIGRACJA
--
--   1. Dodaje akcje `paid`: ksieguje wplate (`payment_status = 'paid'`), a gdy
--      zgloszenie czeka - sprawdza pule, zajmuje miejsce i wydaje kod QR.
--      To jest normalna sciezka dla przelewu, ktory organizator widzi na
--      wyciagu.
--   2. Pilnuje, zeby `approve` NIE WYDAWALO kodu przy `payment_status =
--      'unpaid'`. Bez tego organizator zatwierdzajacy niezaplacone zgloszenie
--      otwieral K-1 tylnymi drzwiami: status `approved`, kod QR w reku, zero
--      pieniedzy. Po zmianie `approve` na niezaplaconym ZAJMUJE MIEJSCE (bo to
--      swiadoma decyzja organizatora, ze ta osoba wchodzi), ale wejsciowki nie
--      wydaje - do tego sluzy `paid`. Reczna odprawa po nazwisku dziala jak
--      dotad.
--   3. Dodaje akcje `refund`: zwrot zdejmuje kod QR i cofa zgloszenie do
--      `cancelled`. Bez tego jedyna droga po zwrocie bylo `cancel`, ktore
--      zostawialo `payment_status = 'paid'` - czyli slad ksiegowy klamiacy
--      o stanie pieniedzy.
--
-- CZEGO TA MIGRACJA NIE ROBI. Nie buduje kasy samoobslugowej. Platforma nie ma
-- dzis ZADNEJ sciezki zaplaty za wejsciowke wydarzenia - ani tu, ani przed
-- `20260828206000`, gdzie bilet byl po prostu wydawany za darmo. Rozliczenie
-- jest wiec poza systemem (przelew), a system ma je wylacznie ZAKSIEGOWAC.
-- Podpiecie kasy to osobna praca i osobna decyzja produktowa.
--
-- CALA RESZTA CIALA FUNKCJI JEST PRZEPISANA ZNAK W ZNAK z `20260824090654`.
-- W tym repozytorium wygrywa OSTATNIA definicja, wiec funkcji nie da sie
-- „zalatac" fragmentem - przedeklarowanie musi niesc komplet zachowania.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_event_registration_decide(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_uid uuid := auth.uid();
  v_id uuid := NULLIF(p_payload->>'registration_id', '')::uuid;
  v_action text := lower(btrim(COALESCE(p_payload->>'action', '')));
  v_note text := NULLIF(btrim(COALESCE(p_payload->>'note', '')), '');
  v_reg public.event_registrations;
  v_seats_left integer;
  v_token text;
  v_position integer;
  v_freed boolean := false;
  v_status text;
  v_promoted jsonb := jsonb_build_object('promoted', 0);
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: registration_id is required';
  END IF;

  IF v_action NOT IN ('approve', 'reject', 'waitlist', 'attended', 'no_show',
                      'cancel', 'paid', 'refund') THEN
    RAISE EXCEPTION 'invalid_action: unknown decision %', v_action;
  END IF;

  SELECT * INTO v_reg
  FROM public.event_registrations r
  WHERE r.id = v_id AND r.tenant_id = v_tenant;

  IF v_reg.id IS NULL THEN
    RAISE EXCEPTION 'not_found: registration does not exist in this tenant';
  END IF;

  PERFORM 1 FROM public.events e
  WHERE e.id = v_reg.event_id AND e.tenant_id = v_tenant
  FOR UPDATE;

  IF v_reg.ticket_type_id IS NOT NULL THEN
    PERFORM 1 FROM public.event_ticket_types t
    WHERE t.id = v_reg.ticket_type_id AND t.tenant_id = v_tenant
    FOR UPDATE;
  END IF;

  -- DOZWOLONE PRZEJSCIA - jawna tablica, nie domysl.
  -- `paid` i `refund` chodza po osi PIENIEDZY, wiec ich warunek dotyczy
  -- `payment_status`, a nie `status`. Zgloszenie odwolane albo odrzucone nie
  -- przyjmuje wplaty: ksiegowanie pieniedzy na wierszu, ktory nie daje wstepu,
  -- byloby sladem, ktorego nikt pozniej nie umie odczytac.
  IF NOT (
    (v_action = 'approve' AND v_reg.status IN ('draft', 'pending', 'waitlist', 'rejected', 'cancelled'))
    OR (v_action = 'reject' AND v_reg.status IN ('draft', 'pending', 'waitlist', 'approved'))
    OR (v_action = 'waitlist' AND v_reg.status IN ('draft', 'pending', 'approved'))
    OR (v_action = 'attended' AND v_reg.status IN ('approved', 'no_show'))
    OR (v_action = 'no_show' AND v_reg.status IN ('approved', 'attended'))
    OR (v_action = 'cancel' AND v_reg.status IN ('draft', 'pending', 'waitlist', 'approved'))
    OR (v_action = 'paid' AND v_reg.payment_status = 'unpaid'
        AND v_reg.status IN ('draft', 'pending', 'waitlist', 'approved'))
    OR (v_action = 'refund' AND v_reg.payment_status = 'paid')
  ) THEN
    IF v_action IN ('paid', 'refund') THEN
      RAISE EXCEPTION 'invalid_transition: payment % cannot be %',
        v_reg.payment_status, v_action;
    END IF;
    RAISE EXCEPTION 'invalid_transition: % cannot be %', v_reg.status, v_action;
  END IF;

  v_freed := v_reg.status IN ('approved', 'attended', 'no_show')
    AND v_action IN ('reject', 'waitlist', 'cancel', 'refund');

  IF v_action = 'approve' THEN
    IF v_reg.status IN ('rejected', 'cancelled') AND EXISTS (
      SELECT 1 FROM public.event_registrations r2
      WHERE r2.tenant_id = v_tenant
        AND r2.event_id = v_reg.event_id
        AND r2.person_id = v_reg.person_id
        AND r2.id <> v_reg.id
        AND r2.status NOT IN ('cancelled', 'rejected')
    ) THEN
      RAISE EXCEPTION 'already_registered: this person already has an active registration';
    END IF;

    v_seats_left := public._event_seats_left(v_tenant, v_reg.event_id, v_reg.ticket_type_id);
    IF v_seats_left IS NOT NULL AND v_seats_left <= 0 THEN
      RAISE EXCEPTION 'no_seats_left: no free seat for this ticket - use the waiting list';
    END IF;

    -- KOD TYLKO ZA ZAPLACONY BILET. Organizator moze zatwierdzic zgloszenie
    -- niezaplacone - to jest jego decyzja i zajmuje miejsce z puli - ale
    -- wejsciowka nie wychodzi, bo inaczej `approve` bylo tylnymi drzwiami do
    -- darmowego biletu, ktore zamknela migracja `20260828206000`.
    IF v_reg.payment_status <> 'unpaid' THEN
      v_token := public._event_new_qr_token();
    END IF;

    UPDATE public.event_registrations r
    SET status = 'approved',
        waitlist_position = NULL,
        cancelled_at = NULL,
        decided_by = v_uid,
        decided_at = now(),
        decision_source = 'organizer',
        decision_note = COALESCE(v_note, r.decision_note),
        qr_token_hash = CASE
          WHEN v_token IS NOT NULL THEN encode(digest(v_token, 'sha256'), 'hex')
          ELSE NULL
        END,
        qr_issued_at = CASE WHEN v_token IS NOT NULL THEN now() END,
        promoted_at = CASE WHEN r.status = 'waitlist' THEN now() ELSE r.promoted_at END
    WHERE r.id = v_id AND r.tenant_id = v_tenant;

  ELSIF v_action = 'paid' THEN
    -- WPLATA ZAKSIEGOWANA. Jesli zgloszenie czekalo (a przy platnym bilecie
    -- czeka domyslnie - patrz `20260828206000`), to dopiero TERAZ zajmuje
    -- miejsce: sprawdzamy pule pod ta sama blokada, co przy `approve`.
    IF v_reg.status <> 'approved' THEN
      v_seats_left := public._event_seats_left(v_tenant, v_reg.event_id, v_reg.ticket_type_id);
      IF v_seats_left IS NOT NULL AND v_seats_left <= 0 THEN
        RAISE EXCEPTION 'no_seats_left: no free seat for this ticket - use the waiting list';
      END IF;
    END IF;

    v_token := public._event_new_qr_token();

    UPDATE public.event_registrations r
    SET payment_status = 'paid',
        status = 'approved',
        waitlist_position = NULL,
        cancelled_at = NULL,
        decided_by = v_uid,
        decided_at = now(),
        decision_source = 'organizer',
        decision_note = COALESCE(v_note, r.decision_note),
        qr_token_hash = encode(digest(v_token, 'sha256'), 'hex'),
        qr_issued_at = now(),
        promoted_at = CASE WHEN r.status = 'waitlist' THEN now() ELSE r.promoted_at END
    WHERE r.id = v_id AND r.tenant_id = v_tenant;

  ELSIF v_action = 'refund' THEN
    -- ZWROT ZDEJMUJE WEJSCIOWKE. Zostawienie kodu przy zwroconej wplacie
    -- daloby przepustke oplacona pieniedzmi, ktorych juz nie ma.
    UPDATE public.event_registrations r
    SET payment_status = 'refunded',
        status = 'cancelled',
        cancelled_at = now(),
        waitlist_position = NULL,
        decided_by = v_uid,
        decided_at = now(),
        decision_source = 'organizer',
        decision_note = COALESCE(v_note, r.decision_note),
        qr_token_hash = NULL,
        qr_issued_at = NULL
    WHERE r.id = v_id AND r.tenant_id = v_tenant;

  ELSIF v_action = 'reject' THEN
    IF v_note IS NULL OR char_length(v_note) < 3 THEN
      RAISE EXCEPTION 'reason_required: a rejection reason is required';
    END IF;

    UPDATE public.event_registrations r
    SET status = 'rejected',
        waitlist_position = NULL,
        decided_by = v_uid,
        decided_at = now(),
        decision_source = 'organizer',
        decision_note = v_note,
        qr_token_hash = NULL,
        qr_issued_at = NULL
    WHERE r.id = v_id AND r.tenant_id = v_tenant;

  ELSIF v_action = 'waitlist' THEN
    v_position := public._event_next_waitlist_position(v_tenant, v_reg.event_id);

    UPDATE public.event_registrations r
    SET status = 'waitlist',
        waitlist_position = v_position,
        waitlist_notified_at = NULL,
        decided_by = v_uid,
        decided_at = now(),
        decision_source = 'organizer',
        decision_note = COALESCE(v_note, r.decision_note),
        qr_token_hash = NULL,
        qr_issued_at = NULL
    WHERE r.id = v_id AND r.tenant_id = v_tenant;

  ELSIF v_action = 'cancel' THEN
    UPDATE public.event_registrations r
    SET status = 'cancelled',
        cancelled_at = now(),
        waitlist_position = NULL,
        decided_by = v_uid,
        decided_at = now(),
        decision_source = 'organizer',
        decision_note = COALESCE(v_note, r.decision_note),
        qr_token_hash = NULL,
        qr_issued_at = NULL
    WHERE r.id = v_id AND r.tenant_id = v_tenant;

  ELSE
    UPDATE public.event_registrations r
    SET status = v_action,
        attended_at = CASE
          WHEN v_action = 'attended' THEN COALESCE(r.attended_at, now())
          ELSE NULL
        END,
        decided_by = v_uid,
        decided_at = now(),
        decision_source = 'organizer',
        decision_note = COALESCE(v_note, r.decision_note)
    WHERE r.id = v_id AND r.tenant_id = v_tenant;
  END IF;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_registration',
    v_id::text,
    'event.registration.decided.v1',
    jsonb_build_object(
      'event_id', v_reg.event_id,
      'person_id', v_reg.person_id,
      'from', v_reg.status,
      'action', v_action
    ),
    v_uid
  );

  IF v_freed THEN
    v_promoted := public._event_waitlist_promote(
      v_tenant, v_reg.event_id, v_reg.ticket_type_id, 1
    );
  END IF;

  -- STATUS W ODPOWIEDZI JEST CZYTANY Z WIERSZA, nie odgadywany z akcji.
  -- Wersja poprzednia sklejala go warunkiem na `v_action` i przy kazdej nowej
  -- akcji trzeba bylo pamietac o dopisaniu galezi - `paid` zwrocilby wtedy
  -- doslownie napis „paid" jako status zgloszenia.
  SELECT r.status INTO v_status
  FROM public.event_registrations r
  WHERE r.id = v_id AND r.tenant_id = v_tenant;

  RETURN jsonb_build_object(
    'registration_id', v_id,
    'action', v_action,
    'status', v_status,
    'waitlist_position', v_position,
    'qr_token', v_token,
    'promoted_from_waitlist', COALESCE((v_promoted->>'promoted')::integer, 0),
    'promoted', COALESCE(v_promoted->'registrations', '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_registration_decide(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_registration_decide(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_registration_decide(jsonb) IS
  'Decyzja organizatora o zapisie: approve | reject | waitlist | attended | no_show | cancel | paid | refund. Jawna tablica dozwolonych przejsc, pula sprawdzana pod blokada, slad decyzji (kto, kiedy, na jakiej podstawie, dlaczego). paid ksieguje wplate, zajmuje miejsce i wydaje kod QR; approve na niezaplaconym zgloszeniu zajmuje miejsce, ale kodu NIE wydaje; refund zdejmuje kod i odwoluje zapis. Zwolnione miejsce promuje kolejke.';
