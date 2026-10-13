-- events-harness: include
-- ============================================================================
-- SCALENIE Z MAIN (PR #504), CZ. 2: ZAPIS I DECYZJE ZLECEN ZWROTU = REG-03/R45
-- + INV-19c (CZYSTY BUDZET, `refund_unconfirmed`) + TIX-05 (ODMOWA WPLATY).
--
-- POCHODZENIE
--   * REG: `_event_registration_cancel_refund` (20261012170000, ostatnio
--     20261012181200 - rezygnacja ze zwrotu zdejmuje `pending`/`failed`),
--     `admin_event_refund_job_decide` (20261012170050). Obie tylko w REG, ale
--     pisza TEN SAM wiersz kolejki co eskalacja main.
--   * main: 20261012120000 (INV-19c) - ponowne zlecenie startuje z czystym
--     budzetem i bez starego alarmu (`attempts`, `escalated_at`,
--     `provider_refund_id`), `refund_unconfirmed` (pieniadze moga byc w drodze)
--     blokuje przywrocenie zgloszenia; 20261012130100 (TIX-05) -
--     `_event_ticket_payment_refused`: odmowa wplaty pobranej u operatora to
--     znacznik na zamowieniu i zlecenie zwrotu (`refund_queued`).
--
-- DEFEKT (stan po samym scaleniu)
--   1. Zapis zlecenia po rezygnacji i decyzja "zwroc" zerowaly `attempts`, ale
--      zostawialy `escalated_at` i `provider_refund_id` poprzedniego epizodu:
--      dziennik pokazywal stary alarm przy nowym zleceniu, a `refund.failed`
--      dla STAREGO identyfikatora zwrotu eskalowal nowe zlecenie.
--   2. Zlecenie `needs_review/refund_unconfirmed` (zwrot przyjety przez
--      operatora, bez potwierdzenia) dawalo sie nadpisac rezygnacja
--      (`pending` - drugi zwrot tej samej wplaty) i rozstrzygnac recznie
--      (`refund` = drugi zwrot, `dismiss` = zamkniecie zwrotu, ktory moze
--      jeszcze dojsc) - main zablokowal te sama sytuacje w straznikach.
--   3. Odmowa wplaty (TIX-05) wstawiala zlecenie z DOMYSLNYM pochodzeniem REG
--      `organizer_rejected` i bez kwoty, a przy wplacie na zgloszenie juz
--      zamkniete siatka bezpieczenstwa REG zdazyla w TEJ SAMEJ transakcji
--      wstawic `needs_review/closed_without_refund_decision` - zwrot nie
--      wychodzil, a odpowiedz mowila kupujacemu "zwrot zlecony"
--      (`refund_queued` = "wiersz istnieje").
--
-- ZMIANA (ciala zbudowane na NAJNOWSZYCH definicjach: zapis - 20261012181200,
--   decyzja - 20261012170050, odmowa - 20261012130100; zmiany oznaczone
--   `ZMIANA (scalenie z main)`)
--   A. `_event_registration_cancel_refund`: ponowne zlecenie z czystym
--      budzetem (INV-19c); zlecenie `refund_unconfirmed` zostaje nietkniete
--      (odpowiedz oddaje jego stan, wolajacy widzi, ze zwrot jest w drodze).
--   B. `admin_event_refund_job_decide`: `refund_unconfirmed` nie ma decyzji
--      (`invalid_transition` - najpierw potwierdzenie albo `refund.failed`;
--      panel po scaleniu nie pokazuje dla niego przyciskow), "zwroc" startuje
--      z czystym budzetem.
--   C. `_event_ticket_payment_refused`: pochodzenie `system`, kwota i waluta
--      zamowienia; zlecenie siatki bezpieczenstwa z TEJ transakcji
--      (`closed_without_refund_decision`, bez alarmu i decyzji) staje sie
--      zwrotem automatycznym, gdy zadne aktywne zgloszenie nie dzieli wplaty -
--      wplata na zamkniete zgloszenie nie kupila niczego (intencja TIX-05);
--      wspolna wplata zostaje w przegladzie (intencja REG-03/R45). Wynik =
--      PRAWDA, ze zwrot jest automatyczny albo juz w drodze (`pending`,
--      `processing`, `submitted`, `failed`, `completed`), a nie "wiersz istnieje" -
--      tak czyta go TS (`notifyTicketRefusal`: "zwrot zlecony" kontra
--      "organizator zdecyduje").
--
-- CZEGO TO NIE ZAMYKA. Zlecenie `refund_unconfirmed` bez potwierdzenia
--   operatora nie ma recznego wyjscia w panelu - rozstrzyga je webhook
--   (`charge.refunded` albo `refund.failed`), jak w main.
--
-- KOLEJNOSC WDROZENIA: dowolna wzgledem kodu (sygnatury i klucze odpowiedzi
--   bez zmian); PO wszystkich migracjach main i REG (20261013900000).
-- IDEMPOTENTNA: CREATE OR REPLACE, bezstanowe REVOKE/GRANT, COMMENT ON.
-- DOWOD: supabase/tests/reg_main_merge_test.sql,
--   supabase/tests/event_ticket_payment_binding_test.sql (main),
--   scripts/events-harness/runtime_test.d/75_paid_no_seat_waitlist.sql (main),
--   supabase/tests/event_registration_cancel_refund_test.sql, event_refund_r45_test.sql.
-- ============================================================================

-- A) ZAPIS ZLECENIA PO ZAMKNIECIU ------------------------------------------------
-- Cialo z 20261012181200 (D). Zmiany `ZMIANA (scalenie z main)`.
CREATE OR REPLACE FUNCTION public._event_registration_cancel_refund(
  _tenant uuid,
  _registration_id uuid,
  _origin text,
  _actor uuid,
  _assessment jsonb,
  _waive boolean DEFAULT false,
  _note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_state text := NULLIF(_assessment->>'job_state', '');
  v_reason text := NULLIF(_assessment->>'review_reason', '');
  v_order uuid := NULLIF(_assessment->>'payment_order_id', '')::uuid;
  v_note text := NULLIF(btrim(COALESCE(_note, '')), '');
  v_waive boolean := COALESCE(_waive, false);
  v_event_id uuid;
  v_title_pl text;
  v_title_en text;
  v_job_id uuid;
  v_job_state text;
  v_why_pl text;
  v_why_en text;
BEGIN
  IF _origin IS NULL OR _origin NOT IN ('participant_cancelled', 'organizer_cancelled') THEN
    RAISE EXCEPTION 'invalid_payload: refund origin must be participant_cancelled or organizer_cancelled';
  END IF;
  IF v_state IS NULL THEN
    RETURN _assessment || jsonb_build_object('job_id', NULL);
  END IF;
  IF v_waive THEN
    IF _origin <> 'organizer_cancelled' THEN
      RAISE EXCEPTION 'invalid_payload: only the organizer can waive a refund';
    END IF;
    v_state := 'cancelled';
    v_reason := 'organizer_waived';
  END IF;

  SELECT r.event_id, e.title_pl, COALESCE(NULLIF(btrim(e.title_en), ''), e.title_pl)
    INTO v_event_id, v_title_pl, v_title_en
    FROM public.event_registrations r
    JOIN public.events e ON e.id = r.event_id AND e.tenant_id = r.tenant_id
   WHERE r.id = _registration_id AND r.tenant_id = _tenant;
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'not_found: registration does not exist';
  END IF;

  IF v_order IS NOT NULL THEN
    INSERT INTO public.event_registration_refund_jobs AS j (
      tenant_id, event_id, payment_order_id, registration_id, state, origin, review_reason,
      refund_deadline_at, amount_cents, currency, requested_by, review_note, decided_by, decided_at)
    VALUES (
      _tenant, v_event_id, v_order, _registration_id, v_state, _origin, v_reason,
      NULLIF(_assessment->>'refund_deadline_at', '')::timestamptz,
      NULLIF(_assessment->>'amount_cents', '')::integer,
      NULLIF(_assessment->>'currency', ''),
      _actor, v_note,
      CASE WHEN v_state = 'cancelled' THEN _actor END,
      CASE WHEN v_state = 'cancelled' THEN now() END)
    ON CONFLICT (payment_order_id) DO UPDATE SET
      registration_id = EXCLUDED.registration_id,
      state = EXCLUDED.state,
      origin = EXCLUDED.origin,
      review_reason = EXCLUDED.review_reason,
      refund_deadline_at = EXCLUDED.refund_deadline_at,
      amount_cents = EXCLUDED.amount_cents,
      currency = EXCLUDED.currency,
      requested_by = EXCLUDED.requested_by,
      review_note = EXCLUDED.review_note,
      decided_by = EXCLUDED.decided_by,
      decided_at = EXCLUDED.decided_at,
      attempts = 0,
      -- ZMIANA (scalenie z main, INV-19c): nowe zlecenie startuje z czystym
      -- budzetem - bez alarmu i identyfikatora zwrotu poprzedniego epizodu
      -- (inaczej `refund.failed` starego zwrotu eskalowalby nowe zlecenie).
      escalated_at = NULL,
      provider_refund_id = NULL,
      claim_token = NULL,
      last_error = NULL,
      next_attempt_at = now(),
      updated_at = now()
    -- ZMIANA 20261012 (R45): rezygnacja ze zwrotu zdejmuje tez zlecenie,
    -- ktore jeszcze nie trafilo do operatora.
    -- ZMIANA (scalenie z main, INV-19c): `refund_unconfirmed` to zwrot
    -- przyjety przez operatora bez potwierdzenia - pieniadze moga byc w drodze,
    -- wiec ani nowe zlecenie (drugi zwrot), ani rezygnacja go nie nadpisuja.
    WHERE (j.state IN ('needs_review', 'cancelled')
           OR (v_waive AND j.state IN ('pending', 'failed')))
      AND j.review_reason IS DISTINCT FROM 'refund_unconfirmed'
    RETURNING j.id, j.state INTO v_job_id, v_job_state;

    IF v_job_id IS NULL THEN
      SELECT j.id, j.state INTO v_job_id, v_job_state
        FROM public.event_registration_refund_jobs j
       WHERE j.payment_order_id = v_order AND j.tenant_id = _tenant;
      -- ZMIANA (scalenie z main): zlecenie nietkniete w przegladzie mowi
      -- WLASNY powod (np. `refund_unconfirmed`), nie powod tej oceny.
      IF v_job_state = 'needs_review' THEN
        SELECT j.review_reason INTO v_reason
          FROM public.event_registration_refund_jobs j
         WHERE j.id = v_job_id;
      END IF;
    END IF;
  ELSE
    INSERT INTO public.event_registration_refund_jobs AS j (
      tenant_id, event_id, payment_order_id, registration_id, state, origin, review_reason,
      refund_deadline_at, amount_cents, currency, requested_by, review_note, decided_by, decided_at)
    VALUES (
      _tenant, v_event_id, NULL, _registration_id,
      -- Bez zamowienia nie ma kolejki operatora: tylko przeglad albo rezygnacja.
      CASE WHEN v_state = 'cancelled' THEN 'cancelled' ELSE 'needs_review' END,
      _origin, COALESCE(v_reason, 'manual_payment'),
      NULLIF(_assessment->>'refund_deadline_at', '')::timestamptz,
      NULL, NULL, _actor, v_note,
      CASE WHEN v_state = 'cancelled' THEN _actor END,
      CASE WHEN v_state = 'cancelled' THEN now() END)
    ON CONFLICT (registration_id) WHERE payment_order_id IS NULL DO UPDATE SET
      state = EXCLUDED.state,
      origin = EXCLUDED.origin,
      review_reason = EXCLUDED.review_reason,
      refund_deadline_at = EXCLUDED.refund_deadline_at,
      requested_by = EXCLUDED.requested_by,
      review_note = EXCLUDED.review_note,
      decided_by = EXCLUDED.decided_by,
      decided_at = EXCLUDED.decided_at,
      last_error = NULL,
      updated_at = now()
    WHERE j.state IN ('needs_review', 'cancelled')
    RETURNING j.id, j.state INTO v_job_id, v_job_state;

    IF v_job_id IS NULL THEN
      SELECT j.id, j.state INTO v_job_id, v_job_state
        FROM public.event_registration_refund_jobs j
       WHERE j.registration_id = _registration_id
         AND j.payment_order_id IS NULL
         AND j.tenant_id = _tenant;
    END IF;
  END IF;

  -- Szyna: dziennik zwrotow odswieza sie w panelu (eventInvalidationMap).
  -- Bez danych osobowych - tylko identyfikatory i stan.
  PERFORM public.emit_domain_event(
    _tenant,
    'event_registration',
    _registration_id::text,
    'event.registration.refund_requested.v1',
    jsonb_build_object(
      'event_id', v_event_id,
      'job_id', v_job_id,
      'state', v_job_state,
      'origin', _origin,
      'review_reason', v_reason),
    _actor);

  -- Rezygnacja uczestnika: organizator dowiaduje sie od razu. Decyzja
  -- organizatora nie dzwoni - jej autor widzial skutek w oknie decyzji.
  -- Cudzyslow tytulu doklejany `||`, nie w szablonie formatu: lekser bramki
  -- check_whitelist_writers czyta 3 bajty za operatorem jako ASCII.
  IF _origin = 'participant_cancelled' THEN
    IF v_job_state = 'pending' THEN
      PERFORM public._event_refund_alert_organizers(
        _tenant, v_event_id,
        'Rezygnacja z opłaconego biletu: zwrot zlecony',
        'Paid ticket cancelled: refund queued',
        format('%s: uczestnik zrezygnował w terminie zwrotu, zwrot trafił do operatora płatności. Szczegóły w dzienniku zwrotów.', '„' || v_title_pl || '”'),
        format('"%s": a participant cancelled within the refund window and the refund went to the payment provider. Details in the refund journal.', v_title_en));
    ELSIF v_job_state = 'needs_review' THEN
      -- ZMIANA (scalenie z main): takze powody eskalacji INV-19c - zlecenie
      -- nietkniete wyzej mowi wlasny powod.
      v_why_pl := CASE v_reason
        WHEN 'outside_refund_window' THEN 'po terminie zwrotu'
        WHEN 'refund_disabled' THEN 'wydarzenie nie ma samodzielnych zwrotów'
        WHEN 'shared_payment' THEN 'wpłata obejmuje inne aktywne zgłoszenia'
        WHEN 'active_registrations_share_payment' THEN 'wpłata obejmuje inne aktywne zgłoszenia'
        WHEN 'manual_payment' THEN 'wpłata poza operatorem płatności'
        WHEN 'refund_unconfirmed' THEN 'zwrot tej wpłaty czeka na potwierdzenie operatora płatności'
        WHEN 'provider_refund_failed' THEN 'operator płatności odrzucił wcześniejszy zwrot tej wpłaty'
        WHEN 'attempts_exhausted' THEN 'wcześniejszy zwrot tej wpłaty nie doszedł do skutku'
        ELSE 'zamknięcie bez decyzji o zwrocie'
      END;
      v_why_en := CASE v_reason
        WHEN 'outside_refund_window' THEN 'after the refund deadline'
        WHEN 'refund_disabled' THEN 'the event has no self-service refunds'
        WHEN 'shared_payment' THEN 'the payment covers other active registrations'
        WHEN 'active_registrations_share_payment' THEN 'the payment covers other active registrations'
        WHEN 'manual_payment' THEN 'paid outside the payment provider'
        WHEN 'refund_unconfirmed' THEN 'a refund of this payment awaits provider confirmation'
        WHEN 'provider_refund_failed' THEN 'the provider rejected an earlier refund of this payment'
        WHEN 'attempts_exhausted' THEN 'an earlier refund of this payment did not go through'
        ELSE 'closed without a refund decision'
      END;
      PERFORM public._event_refund_alert_organizers(
        _tenant, v_event_id,
        'Rezygnacja z opłaconego biletu: zwrot czeka na decyzję',
        'Paid ticket cancelled: refund needs a decision',
        format('%s: uczestnik zrezygnował (%s). Zdecyduj o zwrocie w dzienniku zwrotów.', '„' || v_title_pl || '”', v_why_pl),
        format('"%s": a participant cancelled (%s). Decide on the refund in the refund journal.', v_title_en, v_why_en));
    END IF;
  END IF;

  RETURN _assessment || jsonb_build_object('job_id', v_job_id, 'job_state', v_job_state,
                                           'review_reason', v_reason);
END $$;
REVOKE ALL ON FUNCTION public._event_registration_cancel_refund(uuid, uuid, text, uuid, jsonb, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_registration_cancel_refund(uuid, uuid, text, uuid, jsonb, boolean, text)
  TO service_role;

COMMENT ON FUNCTION public._event_registration_cancel_refund(uuid, uuid, text, uuid, jsonb, boolean, text) IS
  'REG-03: zapis zlecenia zwrotu po zamknieciu zgloszenia wedlug oceny _event_registration_refund_assess (pending albo needs_review; _waive = cancelled/organizer_waived, tylko organizator - zdejmuje takze zlecenie pending/failed, R45). Podnosi needs_review/cancelled z siatki bezpieczenstwa z czystym budzetem (attempts, escalated_at, provider_refund_id - INV-19c), nie rusza zlecenia w drodze, zakonczonego ani needs_review/refund_unconfirmed (zwrot moze jeszcze dojsc). Emituje event.registration.refund_requested.v1; przy rezygnacji uczestnika dzwoni do organizatorow. Pomocnicza: tylko service_role i funkcje SECURITY DEFINER.';

-- B) DECYZJA ORGANIZATORA ---------------------------------------------------------
-- Cialo z 20261012170050 (E2). Zmiany `ZMIANA (scalenie z main)`.
CREATE OR REPLACE FUNCTION public.admin_event_refund_job_decide(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_uid uuid := auth.uid();
  v_job_id uuid;
  v_action text := lower(btrim(COALESCE(p_payload->>'action', '')));
  v_note text := NULLIF(btrim(COALESCE(p_payload->>'note', '')), '');
  v_job public.event_registration_refund_jobs;
  v_order_status text;
  v_order_provider text;
  v_state text;
BEGIN
  v_job_id := CASE
    WHEN COALESCE(p_payload->>'job_id', '') ~ '^[0-9a-fA-F-]{36}$' THEN (p_payload->>'job_id')::uuid
  END;
  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: job_id is required';
  END IF;
  IF v_action NOT IN ('refund', 'mark_refunded', 'dismiss') THEN
    RAISE EXCEPTION 'invalid_action: unknown refund decision %', v_action;
  END IF;
  IF char_length(v_note) > 2000 THEN
    RAISE EXCEPTION 'note_too_long: at most 2000 characters';
  END IF;

  SELECT j.* INTO v_job
    FROM public.event_registration_refund_jobs j
   WHERE j.id = v_job_id AND j.tenant_id = v_tenant
   FOR UPDATE;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'not_found: refund job does not exist in this tenant';
  END IF;
  IF v_job.state NOT IN ('needs_review', 'failed') THEN
    RAISE EXCEPTION 'invalid_transition: refund job % cannot be %', v_job.state, v_action;
  END IF;
  -- ZMIANA (scalenie z main, INV-19c): zwrot przyjety przez operatora bez
  -- potwierdzenia nie ma decyzji - `refund` zlecilby drugi zwrot tej samej
  -- wplaty, `dismiss` zamykalby zwrot, ktory moze jeszcze dojsc, a
  -- `mark_refunded` dotyczy tylko wplat poza operatorem. Rozstrzyga webhook
  -- (`charge.refunded` albo `refund.failed`); panel nie pokazuje tu przyciskow.
  IF v_job.state = 'needs_review' AND v_job.review_reason = 'refund_unconfirmed' THEN
    RAISE EXCEPTION 'invalid_transition: refund awaits provider confirmation';
  END IF;

  IF v_job.payment_order_id IS NOT NULL THEN
    SELECT o.status::text, o.provider INTO v_order_status, v_order_provider
      FROM public.payment_orders o
     WHERE o.id = v_job.payment_order_id AND o.tenant_id = v_tenant;
  END IF;

  IF v_action = 'refund' THEN
    IF v_job.payment_order_id IS NULL OR v_order_provider IS DISTINCT FROM 'stripe' THEN
      RAISE EXCEPTION 'refund_manual_payment: this payment was taken outside the payment provider';
    END IF;
    IF v_order_status IS DISTINCT FROM 'paid' THEN
      RAISE EXCEPTION 'invalid_transition: payment % cannot be refunded', COALESCE(v_order_status, 'missing');
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.event_registrations r
       WHERE r.tenant_id = v_tenant
         AND r.payment_order_id = v_job.payment_order_id
         AND r.status NOT IN ('cancelled', 'rejected')
    ) THEN
      RAISE EXCEPTION 'refund_shared_payment: other active registrations share this payment';
    END IF;
    -- ZMIANA (scalenie z main, INV-19c): czysty budzet - bez alarmu
    -- i identyfikatora zwrotu poprzedniego epizodu.
    UPDATE public.event_registration_refund_jobs j SET
      state = 'pending', review_reason = NULL, attempts = 0, claim_token = NULL,
      escalated_at = NULL, provider_refund_id = NULL,
      last_error = NULL, next_attempt_at = now(), requested_by = v_uid,
      review_note = COALESCE(v_note, j.review_note), decided_by = v_uid, decided_at = now(),
      updated_at = now()
    WHERE j.id = v_job.id;
    v_state := 'pending';

  ELSIF v_action = 'mark_refunded' THEN
    IF v_job.payment_order_id IS NOT NULL AND v_order_provider = 'stripe' THEN
      RAISE EXCEPTION 'invalid_transition: a provider payment is refunded through the provider';
    END IF;
    UPDATE public.event_registration_refund_jobs j SET
      review_note = COALESCE(v_note, j.review_note), decided_by = v_uid, decided_at = now(),
      updated_at = now()
    WHERE j.id = v_job.id;
    -- Zgloszenie oznaczone jako zwrocone - trigger kolejki konczy zlecenie
    -- (po zamowieniu albo, bez zamowienia, po zgloszeniu).
    UPDATE public.event_registrations r SET
      payment_status = 'refunded',
      paid_at = NULL,
      updated_at = now()
    WHERE r.id = v_job.registration_id AND r.tenant_id = v_tenant
      AND r.payment_status IN ('paid', 'partially_refunded');
    -- Zgloszenie juz bez wplaty (np. oznaczone recznie wczesniej): konczymy
    -- zlecenie wprost.
    UPDATE public.event_registration_refund_jobs j SET state = 'completed', updated_at = now()
    WHERE j.id = v_job.id AND j.state <> 'completed';
    v_state := 'completed';

  ELSE
    IF v_note IS NULL OR char_length(v_note) < 3 THEN
      RAISE EXCEPTION 'reason_required: a note is required when no refund is made';
    END IF;
    UPDATE public.event_registration_refund_jobs j SET
      state = 'cancelled', review_reason = 'organizer_waived', claim_token = NULL,
      review_note = v_note, decided_by = v_uid, decided_at = now(), updated_at = now()
    WHERE j.id = v_job.id;
    v_state := 'cancelled';
  END IF;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_registration',
    v_job.registration_id::text,
    'event.registration.refund_requested.v1',
    jsonb_build_object('event_id', v_job.event_id, 'job_id', v_job.id, 'state', v_state,
                       'origin', v_job.origin, 'decision', v_action),
    v_uid);

  RETURN jsonb_build_object('job_id', v_job.id, 'state', v_state, 'action', v_action);
END $$;
REVOKE ALL ON FUNCTION public.admin_event_refund_job_decide(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_refund_job_decide(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_refund_job_decide(jsonb) IS
  'REG-03: decyzja organizatora o zleceniu zwrotu w przegladzie (needs_review albo failed; needs_review/refund_unconfirmed - bez decyzji, rozstrzyga webhook, INV-19c): refund (zamowienie Stripe paid bez innych aktywnych zgloszen -> pending z czystym budzetem), mark_refunded (wplata poza operatorem -> zgloszenie refunded, zlecenie completed), dismiss (bez zwrotu, notatka >= 3 znaki). Najemca z assert_event_admin_tenant(), nigdy z ladunku.';

-- C) ODMOWA WPLATY (TIX-05) -------------------------------------------------------
-- Cialo z 20261012130100. Zmiany `ZMIANA (scalenie z main)`.
CREATE OR REPLACE FUNCTION public._event_ticket_payment_refused(
  p_order public.payment_orders,
  p_event_id uuid,
  p_registration_id uuid,
  p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_reg uuid;
  v_state text;
BEGIN
  UPDATE public.payment_orders o SET
    metadata = COALESCE(o.metadata, '{}'::jsonb) || jsonb_build_object(
      'needs_manual_review', true,
      'ticket_refusal', jsonb_build_object(
        'reason', p_reason,
        'registration_id', p_registration_id,
        'at', now()
      )
    ),
    updated_at = now()
  WHERE o.id = p_order.id AND o.tenant_id = p_order.tenant_id
    AND NOT (COALESCE(o.metadata, '{}'::jsonb) ? 'ticket_refusal');

  IF p_registration_id IS NOT NULL AND p_event_id IS NOT NULL THEN
    SELECT r.id INTO v_reg
    FROM public.event_registrations r
    WHERE r.id = p_registration_id AND r.tenant_id = p_order.tenant_id AND r.event_id = p_event_id;
  END IF;
  IF v_reg IS NULL THEN
    RETURN false;
  END IF;

  -- ZMIANA (scalenie z main, REG-03): zlecenie mowi, skad sie wzielo
  -- (`system` - odmowa bazy, nie decyzja organizatora; domyslne pochodzenie
  -- REG to `organizer_rejected`) i ile zwraca (cale zamowienie).
  INSERT INTO public.event_registration_refund_jobs (
    tenant_id, event_id, payment_order_id, registration_id, origin, amount_cents, currency)
  VALUES (p_order.tenant_id, p_event_id, p_order.id, v_reg, 'system',
          NULLIF(GREATEST(COALESCE(p_order.amount_cents, 0) - COALESCE(p_order.refunded_amount_cents, 0), 0), 0),
          CASE WHEN upper(COALESCE(p_order.currency, '')) ~ '^[A-Z]{3}$' THEN upper(p_order.currency) END)
  ON CONFLICT (payment_order_id) DO NOTHING;

  -- ZMIANA (scalenie z main): wplata na zgloszenie juz ZAMKNIETE. Siatka
  -- bezpieczenstwa REG-03 (`_event_rejection_refund_queue`) zdazyla w TEJ
  -- transakcji (`created_at = now()`) wstawic `needs_review` bez decyzji
  -- i bez alarmu - a ta wplata nie kupila niczego, wiec to zwrot
  -- automatyczny (TIX-05). Wspolna wplata (inne aktywne zgloszenie na tym
  -- zamowieniu) zostaje w przegladzie (R45: calosci nie zwracamy nigdy).
  UPDATE public.event_registration_refund_jobs j SET
    state = 'pending',
    review_reason = NULL,
    origin = 'system',
    amount_cents = COALESCE(j.amount_cents,
      NULLIF(GREATEST(COALESCE(p_order.amount_cents, 0) - COALESCE(p_order.refunded_amount_cents, 0), 0), 0)),
    currency = COALESCE(j.currency,
      CASE WHEN upper(COALESCE(p_order.currency, '')) ~ '^[A-Z]{3}$' THEN upper(p_order.currency) END),
    attempts = 0,
    next_attempt_at = now(),
    updated_at = now()
  WHERE j.payment_order_id = p_order.id AND j.tenant_id = p_order.tenant_id
    AND j.state = 'needs_review'
    AND j.review_reason = 'closed_without_refund_decision'
    AND j.created_at = now()
    AND j.escalated_at IS NULL
    AND j.decided_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.event_registrations x
       WHERE x.tenant_id = p_order.tenant_id
         AND x.payment_order_id = p_order.id
         AND x.status NOT IN ('cancelled', 'rejected'));

  -- ZMIANA (scalenie z main): "zwrot zlecony" znaczy zwrot automatyczny albo
  -- juz w drodze/zakonczony - nie "wiersz istnieje". Zlecenie w przegladzie
  -- (wspolna wplata, decyzja organizatora) albo zdjete to `false`: TS mowi
  -- wtedy kupujacemu, ze o zwrocie zdecyduje organizator.
  SELECT j.state INTO v_state
    FROM public.event_registration_refund_jobs j
   WHERE j.payment_order_id = p_order.id AND j.tenant_id = p_order.tenant_id;
  RETURN COALESCE(v_state IN ('pending', 'processing', 'submitted', 'failed', 'completed'), false);
END $$;
REVOKE ALL ON FUNCTION public._event_ticket_payment_refused(public.payment_orders, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_ticket_payment_refused(public.payment_orders, uuid, uuid, text)
  TO service_role;

COMMENT ON FUNCTION public._event_ticket_payment_refused(public.payment_orders, uuid, uuid, text) IS
  'Odmowa wplaty pobranej u operatora (TIX-05): znacznik needs_manual_review/ticket_refusal na zamowieniu (pierwszy powod zostaje) i zlecenie zwrotu calego zamowienia (pochodzenie system, kwota i waluta zamowienia), gdy jest zgloszenie. Zlecenie siatki bezpieczenstwa REG-03 z tej samej transakcji (wplata na zamkniete zgloszenie) staje sie zwrotem automatycznym, chyba ze wplate dzieli aktywne zgloszenie. Wynik: czy zwrot jest automatyczny albo juz w drodze (nie: czy wiersz istnieje). Tylko service_role i funkcje SECURITY DEFINER.';

