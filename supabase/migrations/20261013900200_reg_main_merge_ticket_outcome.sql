-- events-harness: include
-- ============================================================================
-- SCALENIE Z MAIN (PR #504), CZ. 3: WYNIK PLATNOSCI ZA BILET = R45/REG-08
-- (KOLEJNOSC BLOKAD DLA KAZDEGO WYNIKU, WPLATA NA ODWOLANYM WYDARZENIU)
-- + TIX-01/TIX-05 (WLASCICIEL, BILET, KWOTA; ODMOWA = ZWROT W KOLEJCE).
--
-- POCHODZENIE
--   * main: 20261012130100_event_ticket_payment_binding.sql - wskazane
--     zgloszenie rozlicza tylko zamowienie jego wlasciciela, na jego bilet,
--     w jego walucie i co najmniej za najnizsza cene (`_event_ticket_order_mismatch`);
--     odmowa wplaty pobranej u operatora (wskazanie bez zgloszenia, niezgodnosc,
--     druga wplata, zgloszenie zamkniete) to znacznik na zamowieniu i zwrot
--     w kolejce (`_event_ticket_payment_refused`) z ladunkiem `refused`;
--     zwrot zamowienia, ktore NIGDY nie oplacilo zgloszenia, go nie odwoluje;
--     metadane zamowienia sprawdzane wzorcem (zly uuid nie wywraca ksiegowania).
--   * REG: 20261012181400 (R45, REG-08) - zamowienie czytane bez blokady,
--     dla KAZDEGO wyniku wydarzenie -> bilety -> zamowienie -> zgloszenie;
--     wplata na ODWOLANYM wydarzeniu zamyka zgloszenie ze zwrotem
--     (`_event_cancelled_event_close_paid`), wplata na zamknietym zgloszeniu
--     ze zleceniem w przegladzie dzwoni z bazy (`organizer_alerted`).
--
-- DEFEKT (stan po samym scaleniu): plik REG sortuje sie PO 20261012130100,
--   wiec jego cialo (zbudowane na 20260926180002) po cichu WYCOFYWALO TIX-01
--   i TIX-05: cudze albo tansze zamowienie ze wskazaniem rozliczalo zgloszenie
--   VIP z kodem QR, druga wplata i wplata na zamkniete zgloszenie nie
--   zakladaly zwrotu ani znacznika, a zwrot odmowionej wplaty ze wskazaniem
--   cudzego zgloszenia odwolywal to zgloszenie (supabase/tests/
--   event_ticket_payment_binding_test.sql - 4 czerwone asercje).
--
-- ZMIANA: cialo REG (20261012181400) + zmiany main oznaczone
--   `ZMIANA (scalenie z main, TIX-01/TIX-05)`:
--   1. metadane `event_id`/`ticket_type_id` sprawdzane wzorcem;
--   2. wskazanie bez zgloszenia przy wplacie - odmowa z kolejka zwrotu;
--   3. TIX-01 po blokadzie zgloszenia (zamowienie nie dowiazane jeszcze do
--      tego zgloszenia): dopasowanie po osobie -> zakup RSVP, wskazanie ->
--      odmowa (przy wplacie z kolejka zwrotu);
--   4. druga wplata - odmowa z kolejka zwrotu;
--   5. wplata na zgloszenie zamkniete - odmowa wobec kupujacego (`refused`)
--      ZAWSZE, a `refund_queued` mowi, czy zwrot jest automatyczny
--      (20261013900100); dzwonek REG z bazy tylko dla zlecenia w przegladzie
--      bez alarmu eskalacji, wtedy `organizer_alerted` (TS nie dubluje);
--   6. zwrot zamowienia innego niz to, ktore oplacilo zgloszenie (takze
--      gdy zgloszenie nie ma zadnego) - `refund_for_other_order`.
--   Kolejnosc blokad REG zostaje: odmowy z punktow 2-4 zapadaja PO blokadach
--   wydarzenia, biletow i zamowienia (wstawienie zlecenia zwrotu bierze
--   KEY SHARE na zamowieniu, ktore juz trzymamy).
--
-- KOLEJNOSC WDROZENIA: dowolna wzgledem kodu (sygnatura bez zmian; klucze
--   odpowiedzi to suma obu stron - `refused`, `refund_queued`,
--   `organizer_alerted`). PO wszystkich migracjach main i REG.
-- IDEMPOTENTNA: CREATE OR REPLACE, bezstanowe REVOKE/GRANT, COMMENT ON.
-- DOWOD: supabase/tests/event_ticket_payment_binding_test.sql (main),
--   scripts/events-harness/runtime_test.d/78_ticket_checkout_integrity.sql (main),
--   75_paid_no_seat_waitlist.sql (main), supabase/tests/event_refund_r45_test.sql
--   i 24_r45_cancel_refund_locks.sql (REG, dblink), reg_main_merge_test.sql.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.payments_apply_event_ticket_outcome(
  p_order_id uuid,
  p_outcome text,
  p_refunded_cents integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
-- ZMIANA (PF-F): payments-search-path - dopisany 'pg_temp' (A.6 R-SQL).
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_order public.payment_orders;
  v_event_id uuid;
  v_ticket_type_id uuid;
  v_registration_hint uuid;
  v_person_id uuid;
  v_reg public.event_registrations;
  v_reg_id uuid;
  v_seat_ticket uuid;
  v_token text;
  v_promoted jsonb := jsonb_build_object('promoted', 0, 'registrations', '[]'::jsonb);
  v_effective text;
  v_refunded integer;
  v_person public.event_people;
  v_event public.events;
  v_event_status text;
  v_next_status text;
  v_admitted boolean;
  v_queued boolean;
  v_position integer;
  v_newly_settled boolean := false;
  v_final public.event_registrations;
  v_close jsonb;
  v_alerted boolean := false;
  v_mismatch text;          -- TIX-01 (main)
  v_refund_queued boolean;  -- TIX-05 (main)
  v_refused boolean := false;
BEGIN
  IF p_outcome NOT IN ('paid','unpaid','refunded','partial_refund') THEN
    RAISE EXCEPTION 'invalid_outcome';
  END IF;

  -- ZMIANA 20261012 (R45, REG-08): zamowienie czytane BEZ blokady - tylko
  -- metadane (wydarzenie, bilet, zgloszenie; zapisane raz przy zakladaniu
  -- zamowienia), zeby wiedziec, co zablokowac. Blokada zamowienia PRZED
  -- wydarzeniem zakleszczala sie z rezygnacja: ta trzyma wydarzenie, a jej
  -- zlecenie zwrotu (klucz obcy do zamowienia, KEY SHARE) czekalo na webhook.
  SELECT * INTO v_order FROM public.payment_orders o WHERE o.id = p_order_id;
  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'order_not_found');
  END IF;

  -- Ksztalt sprawdzamy REGEXEM, a nie rzutowaniem: `'zle'::uuid` rzuca 22P02
  -- i wywracaloby ksiegowanie wplaty, ktora u operatora juz przeszla.
  -- ZMIANA (scalenie z main, TIX-01): takze `event_id` i `ticket_type_id`.
  v_event_id := CASE
    WHEN COALESCE(v_order.metadata->>'event_id','') ~ '^[0-9a-fA-F-]{36}$'
      THEN (v_order.metadata->>'event_id')::uuid
  END;
  v_ticket_type_id := CASE
    WHEN COALESCE(v_order.metadata->>'ticket_type_id','') ~ '^[0-9a-fA-F-]{36}$'
      THEN (v_order.metadata->>'ticket_type_id')::uuid
  END;
  v_registration_hint := CASE
    WHEN COALESCE(v_order.metadata->>'registration_id','') ~ '^[0-9a-fA-F-]{36}$'
      THEN (v_order.metadata->>'registration_id')::uuid
    ELSE NULL
  END;

  -- ==========================================================================
  -- DOPASOWANIE ZGLOSZENIA (zmiana z 2026-08-30).
  --
  -- Gdy zamowienie NIESIE `registration_id`, dopasowanie idzie WYLACZNIE po
  -- nim; niezgodnosc najemcy albo wydarzenia to JAWNA ODMOWA, a nie zgadywanie
  -- po osobie. Dopasowanie po osobie ZOSTAJE dla zamowien BEZ tego klucza
  -- (kasa spolecznosci, zamowienia sprzed migracji).
  --
  -- DOPASOWANIE BEZ BLOKADY, BLOKADY W KOLEJNOSCI wydarzenie -> bilet ->
  -- zamowienie -> zgloszenie (ZMIANA 20261012, R45: dla KAZDEGO wyniku, nie
  -- tylko `paid` - zwrot zwalnia miejsce, przelicza `sold_count` biletu
  -- i awansuje kolejke).
  -- ==========================================================================
  IF v_event_id IS NOT NULL AND v_order.user_id IS NOT NULL AND v_order.tenant_id IS NOT NULL THEN
    IF v_registration_hint IS NOT NULL THEN
      SELECT r.id, r.ticket_type_id INTO v_reg_id, v_seat_ticket
      FROM public.event_registrations r
      WHERE r.id = v_registration_hint
        AND r.tenant_id = v_order.tenant_id
        AND r.event_id = v_event_id;
    ELSE
      SELECT p.id INTO v_person_id
      FROM public.event_people p
      WHERE p.tenant_id = v_order.tenant_id AND p.user_id = v_order.user_id
      LIMIT 1;

      SELECT r.id, r.ticket_type_id INTO v_reg_id, v_seat_ticket
      FROM public.event_registrations r
      WHERE r.tenant_id = v_order.tenant_id
        AND r.event_id = v_event_id
        AND (
          r.payment_order_id = v_order.id
          OR (v_person_id IS NOT NULL AND r.person_id = v_person_id)
        )
      ORDER BY (r.payment_order_id = v_order.id) DESC, r.created_at DESC
      LIMIT 1;
    END IF;

    SELECT e.status INTO v_event_status
    FROM public.events e
    WHERE e.id = v_event_id AND e.tenant_id = v_order.tenant_id
    FOR UPDATE;
    -- Bilet z zamowienia i bilet zgloszenia (zwykle ten sam wiersz), w porzadku
    -- identyfikatorow - NULL-e IN pomija.
    PERFORM 1 FROM public.event_ticket_types t
    WHERE t.tenant_id = v_order.tenant_id
      AND t.id IN (v_ticket_type_id, v_seat_ticket)
    ORDER BY t.id
    FOR UPDATE;
  END IF;

  SELECT * INTO v_order FROM public.payment_orders o WHERE o.id = p_order_id FOR UPDATE;

  v_effective := p_outcome;
  v_refunded := COALESCE(v_order.refunded_amount_cents, 0);

  -- Zwrot: suma zwroconych srodkow jest kumulatywna (operator przysyla
  -- `amount_refunded` narastajaco). Gdy pokryje cale obciazenie, zwrot
  -- czesciowy staje sie pelnym - miejsce musi wrocic do puli.
  IF p_outcome IN ('refunded','partial_refund') THEN
    IF p_refunded_cents IS NOT NULL AND p_refunded_cents > v_refunded THEN
      v_refunded := p_refunded_cents;
    ELSIF p_outcome = 'refunded' AND p_refunded_cents IS NULL THEN
      v_refunded := GREATEST(v_refunded, COALESCE(v_order.amount_cents, 0));
    END IF;

    UPDATE public.payment_orders o
    SET refunded_amount_cents = v_refunded,
        updated_at = now()
    WHERE o.id = v_order.id;

    IF COALESCE(v_order.amount_cents, 0) > 0 AND v_refunded >= v_order.amount_cents THEN
      v_effective := 'refunded';
    ELSIF p_outcome = 'partial_refund' THEN
      v_effective := 'partial_refund';
    END IF;
  END IF;

  IF v_event_id IS NULL OR v_order.user_id IS NULL OR v_order.tenant_id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'not_a_ticket_order',
                              'outcome', v_effective, 'refunded_cents', v_refunded);
  END IF;

  IF v_registration_hint IS NOT NULL AND v_reg_id IS NULL THEN
    -- ZMIANA (scalenie z main, TIX-05): wplata pobrana na wskazanie, ktorego
    -- nie ma - znacznik do przegladu (zgloszenia, do ktorego da sie przypiac
    -- zlecenie, nie ma).
    IF v_effective = 'paid' THEN
      v_refund_queued := public._event_ticket_payment_refused(v_order, v_event_id, NULL, 'registration_mismatch');
      RETURN public._event_ticket_refusal_payload(v_order, v_event_id, v_registration_hint,
        'registration_mismatch', v_refund_queued, v_effective, v_refunded);
    END IF;
    RETURN jsonb_build_object('applied', false, 'reason', 'registration_mismatch',
                              'registration_id', v_registration_hint,
                              'outcome', v_effective, 'refunded_cents', v_refunded);
  END IF;

  IF v_reg_id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'registration_not_found',
                              'outcome', v_effective, 'refunded_cents', v_refunded);
  END IF;

  SELECT r.* INTO v_reg
  FROM public.event_registrations r
  WHERE r.id = v_reg_id AND r.tenant_id = v_order.tenant_id
  FOR UPDATE;

  -- ==========================================================================
  -- ZMIANA (scalenie z main, TIX-01): WLASCICIEL, BILET, KWOTA. Zamowienie juz
  -- dowiazane do zgloszenia (ponowiony webhook, zwrot) przechodzi bez ponownej
  -- oceny - cennik mogl sie od tego czasu zmienic, a raz rozliczona wplata nie
  -- przestaje byc wazna.
  -- ==========================================================================
  IF v_effective IN ('paid', 'unpaid')
     AND v_reg.payment_order_id IS DISTINCT FROM v_order.id THEN
    v_mismatch := public._event_ticket_order_mismatch(v_order, v_reg, v_effective = 'paid');
    IF v_mismatch IS NOT NULL THEN
      IF v_registration_hint IS NULL THEN
        -- Dopasowanie po osobie: ta wplata nie kupila TEGO zgloszenia (inny
        -- bilet, nizsza cena) - zostaje zakupem RSVP, zgloszenie nietkniete.
        RETURN jsonb_build_object('applied', false, 'reason', 'registration_not_found',
                                  'skipped_registration_id', v_reg.id,
                                  'skipped_reason', v_mismatch,
                                  'outcome', v_effective, 'refunded_cents', v_refunded);
      END IF;
      IF v_effective = 'paid' THEN
        v_refund_queued := public._event_ticket_payment_refused(v_order, v_event_id, v_reg.id, v_mismatch);
        RETURN public._event_ticket_refusal_payload(v_order, v_event_id, v_reg.id,
          v_mismatch, v_refund_queued, v_effective, v_refunded);
      END IF;
      RETURN jsonb_build_object('applied', false, 'reason', v_mismatch,
                                'registration_id', v_reg.id,
                                'outcome', v_effective, 'refunded_cents', v_refunded);
    END IF;
  END IF;

  IF v_effective = 'paid' THEN
    -- Druga wplata na to samo zgloszenie jest JAWNIE odrzucana (naprawa
    -- 2026-08-30). Ponowne doreczenie TEGO SAMEGO zamowienia przechodzi
    -- (porownanie po `id`) - idempotencja webhooka nietknieta.
    -- ZMIANA (scalenie z main, TIX-05): odmowa to zwrot w kolejce i znacznik
    -- do przegladu, a nie sam wpis w logu.
    IF v_reg.payment_status = 'paid'
       AND v_reg.payment_order_id IS NOT NULL
       AND v_reg.payment_order_id <> v_order.id THEN
      v_refund_queued := public._event_ticket_payment_refused(v_order, v_event_id, v_reg.id,
        'already_settled_by_another_order');
      RETURN public._event_ticket_refusal_payload(v_order, v_event_id, v_reg.id,
          'already_settled_by_another_order', v_refund_queued, v_effective, v_refunded)
        || jsonb_build_object('payment_order_id', v_reg.payment_order_id);
    END IF;

    -- KOD QR TYLKO DLA WIERSZA, KTORY NAPRAWDE BEDZIE WPUSZCZONY; miejsce
    -- z kontrola (`_event_registration_paid_admission`): miejsce -> przyjete
    -- z kodem; brak miejsca -> kolejka OPLACONA; bilet albo przeplyw
    -- z akceptacja -> `pending` oplacone; odwolane albo zakonczone wydarzenie
    -- -> status bez zmian (R45). Wiersz juz w kolejce zachowuje pozycje.
    -- Bilet mogl sie zmienic miedzy odczytem a blokada wiersza: blokujemy pule
    -- biletu, ktory naprawde liczymy (ten sam wiersz - blokada nic nie kosztuje).
    v_seat_ticket := COALESCE(v_ticket_type_id, v_reg.ticket_type_id);
    PERFORM 1 FROM public.event_ticket_types t
    WHERE t.id = v_seat_ticket AND t.tenant_id = v_order.tenant_id
    FOR UPDATE;

    v_newly_settled := v_reg.payment_status <> 'paid';
    v_next_status := public._event_registration_paid_admission(v_reg, v_seat_ticket);
    v_admitted := v_next_status IN ('approved', 'attended');
    v_queued := v_next_status = 'waitlist' AND v_reg.status <> 'waitlist';
    v_position := CASE
      WHEN v_next_status <> 'waitlist' THEN NULL
      WHEN v_reg.status = 'waitlist' THEN v_reg.waitlist_position
      ELSE public._event_next_waitlist_position(v_order.tenant_id, v_event_id)
    END;
    v_token := CASE WHEN v_admitted THEN public._event_new_qr_token() END;

    UPDATE public.event_registrations r
    SET payment_order_id = v_order.id,
        payment_status = 'paid',
        paid_at = COALESCE(r.paid_at, now()),
        -- Wiersz na miejscu zostaje przy SWOIM bilecie: zamowienie wskazujace
        -- inny (pelny) bilet nie moze przeniesc go ponad pule.
        ticket_type_id = CASE
          WHEN r.status IN ('approved', 'attended', 'no_show') THEN r.ticket_type_id
          ELSE v_seat_ticket
        END,
        status = v_next_status,
        waitlist_position = v_position,
        -- `cancelled_at` CZYSCIMY WYLACZNIE RAZEM ZE STATUSEM (naprawa
        -- 2026-08-30): wplata na zgloszeniu ODWOLANYM zostawia status, a pusty
        -- `cancelled_at` naruszalby `event_registrations_cancelled_dated`.
        cancelled_at = CASE
          WHEN r.status IN ('draft','pending','waitlist') THEN NULL
          ELSE r.cancelled_at
        END,
        -- Nowy wiersz w kolejce: slad decyzji pojemnosci. Wiersz nadal czekajacy
        -- (akceptacja, kolejka) nie dostaje stempla `system` - decyzja jest
        -- jeszcze przed organizatorem.
        decided_by = CASE WHEN v_queued THEN NULL ELSE r.decided_by END,
        decided_at = CASE
          WHEN v_queued THEN now()
          WHEN v_next_status IN ('draft', 'pending', 'waitlist') THEN r.decided_at
          ELSE COALESCE(r.decided_at, now())
        END,
        decision_source = CASE
          WHEN v_queued THEN 'capacity'
          WHEN v_next_status IN ('draft', 'pending', 'waitlist') THEN r.decision_source
          ELSE COALESCE(r.decision_source, 'system')
        END,
        qr_token_hash = CASE
          WHEN v_admitted THEN COALESCE(r.qr_token_hash, encode(digest(v_token,'sha256'),'hex'))
          WHEN v_next_status IN ('draft', 'pending', 'waitlist') THEN NULL
          ELSE r.qr_token_hash
        END,
        qr_issued_at = CASE
          WHEN v_admitted THEN COALESCE(r.qr_issued_at, now())
          WHEN v_next_status IN ('draft', 'pending', 'waitlist') THEN NULL
          ELSE r.qr_issued_at
        END,
        updated_at = now()
    WHERE r.id = v_reg.id;

    -- ZMIANA 20261012 (R45): wplata na ODWOLANYM wydarzeniu - otwarte
    -- zgloszenie zamyka sie ze zwrotem ta sama procedura, co samo odwolanie
    -- (jeden dzwonek do organizatorow, bez awansu).
    IF v_event_status = 'cancelled' THEN
      v_close := public._event_cancelled_event_close_paid(v_order.tenant_id, v_event_id, NULL);
      v_alerted := COALESCE((v_close->>'closed')::integer, 0) > 0;
    END IF;

    -- ZMIANA (scalenie z main, TIX-05): wplata na zgloszenie ODWOLANE albo
    -- ODRZUCONE nie daje miejsca - to pieniadze do zwrotu i ODMOWA wobec
    -- kupujacego (`refused`). Zlecenie z siatki bezpieczenstwa REG-03 staje
    -- sie zwrotem automatycznym, chyba ze wplate dzieli aktywne zgloszenie
    -- (`_event_ticket_payment_refused`, 20261013900100); `refund_queued`
    -- mowi, ktore z dwojga.
    IF v_next_status IN ('cancelled', 'rejected') AND v_newly_settled THEN
      v_refused := true;
      v_refund_queued := public._event_ticket_payment_refused(v_order, v_event_id, v_reg.id,
        'registration_closed');
    END IF;

    -- ZMIANA 20261012 (R45): wplata na zgloszeniu juz ZAMKNIETYM, ktorej
    -- zlecenie zostalo w przegladzie - organizator dowiaduje sie z bazy, nie
    -- tylko z TS. ZMIANA (scalenie z main): zlecenie po eskalacji INV-19c
    -- (wspolna wplata przy odrzuceniu) juz zadzwonilo `_tenant_admins_alert`
    -- - bez drugiego dzwonka, ale TS tez nie dubluje (`organizer_alerted`).
    IF NOT v_alerted AND v_newly_settled AND v_reg.status IN ('cancelled', 'rejected')
       AND EXISTS (
         SELECT 1 FROM public.event_registration_refund_jobs j
          WHERE j.tenant_id = v_order.tenant_id
            AND j.payment_order_id = v_order.id
            AND j.state = 'needs_review'
            AND j.escalated_at IS NOT NULL) THEN
      v_alerted := true;
    END IF;
    IF NOT v_alerted AND v_newly_settled AND v_reg.status IN ('cancelled', 'rejected')
       AND EXISTS (
         SELECT 1 FROM public.event_registration_refund_jobs j
          WHERE j.tenant_id = v_order.tenant_id
            AND j.payment_order_id = v_order.id
            AND j.state = 'needs_review') THEN
      SELECT * INTO v_event FROM public.events e WHERE e.id = v_event_id;
      v_alerted := public._event_refund_alert_organizers(
        v_order.tenant_id, v_event_id,
        'Wpłata za zamknięte zgłoszenie - do zwrotu',
        'Payment for a closed registration - refund due',
        format('%s: wpłata dotarła do zgłoszenia odwołanego albo odrzuconego. Zlecenie czeka w dzienniku zwrotów zgłoszeń - zdecyduj tam o zwrocie.',
               '„' || v_event.title_pl || '”'),
        format('"%s": a payment reached a cancelled or rejected registration. The request waits in the registration refund journal - decide on the refund there.',
               COALESCE(NULLIF(btrim(v_event.title_en), ''), v_event.title_pl))) > 0;
    END IF;

  ELSIF v_effective = 'unpaid' THEN
    UPDATE public.event_registrations r
    SET payment_order_id = v_order.id,
        payment_status = 'unpaid',
        updated_at = now()
    WHERE r.id = v_reg.id AND r.payment_status <> 'paid';
    -- Kasa przepadla: bilet z puli miejsca prowadzacego wraca, chyba ze
    -- zyje inna kasa tego zgloszenia (to zamowienie nadal stoi w processing).
    PERFORM public._event_plan_seat_settle(v_reg.id, v_order.id);

  ELSIF v_effective IN ('partial_refund', 'refunded')
        AND v_reg.payment_order_id IS DISTINCT FROM v_order.id THEN
    -- Zwrot dotyczy INNEGO zamowienia niz to, ktore oplacilo zgloszenie -
    -- nie odwoluje zapisu oplaconego poprawnie drugim zamowieniem.
    -- ZMIANA (scalenie z main, TIX-01): takze zamowienia, ktore NIGDY go nie
    -- oplacilo (`payment_order_id` pusty) - zwrot odmowionej wplaty ze
    -- wskazaniem cudzego zgloszenia odwolywal to zgloszenie.
    RETURN jsonb_build_object('applied', false, 'reason', 'refund_for_other_order',
                              'registration_id', v_reg.id,
                              'payment_order_id', v_reg.payment_order_id,
                              'outcome', v_effective, 'refunded_cents', v_refunded);

  ELSIF v_effective = 'partial_refund' THEN
    -- Zwrot czesciowy to korekta ceny, nie rezygnacja: uczestnik zachowuje
    -- miejsce i kod QR, zmienia sie wylacznie obraz rozliczenia.
    UPDATE public.event_registrations r
    SET payment_order_id = v_order.id,
        payment_status = 'partially_refunded',
        updated_at = now()
    WHERE r.id = v_reg.id;

  ELSE
    UPDATE public.event_registrations r
    SET payment_order_id = v_order.id,
        payment_status = 'refunded',
        paid_at = NULL,
        status = 'cancelled',
        cancelled_at = COALESCE(r.cancelled_at, now()),
        waitlist_position = NULL,
        decided_at = COALESCE(r.decided_at, now()),
        decision_source = COALESCE(r.decision_source, 'system'),
        -- ZMIANA (PF-F): refund-clears-qr - pelny zwrot uniewaznia kod wejscia
        -- (D0-2). `event_checkin_record` szuka zgloszenia WYLACZNIE po
        -- `qr_token_hash` i nie sprawdza statusu.
        qr_token_hash = NULL,
        qr_issued_at = NULL,
        updated_at = now()
    WHERE r.id = v_reg.id;

    v_promoted := public._event_waitlist_promote(
      v_order.tenant_id, v_event_id, COALESCE(v_ticket_type_id, v_reg.ticket_type_id), 1);

    -- ZMIANA (PF-F): refund-releases-participant - po odwolaniu zgloszenia
    -- konto posiadacza traci zapisy na sesje (z awansem z kolejki), zakladki
    -- planu i starsza rezerwacje RSVP (D0-2, D7). `event_sessions` jest
    -- ostatnim szczeblem blokad, a zgloszenie jest juz zapisane.
    PERFORM public._event_participant_release(
      v_order.tenant_id, v_event_id,
      (SELECT p.user_id FROM public.event_people p WHERE p.id = v_reg.person_id),
      'refunded');
  END IF;

  -- Stan PO ksiegowaniu (triggery gosci nie zmieniaja wiersza prowadzacego).
  SELECT r.* INTO v_final FROM public.event_registrations r
  WHERE r.id = v_reg.id AND r.tenant_id = v_order.tenant_id;

  SELECT * INTO v_person FROM public.event_people p WHERE p.id = v_reg.person_id;
  SELECT * INTO v_event FROM public.events e WHERE e.id = v_event_id;

  PERFORM public.emit_domain_event(
    v_order.tenant_id,
    'event_registration',
    v_reg.id::text,
    'event.registration.payment.v1',
    jsonb_build_object('event_id', v_event_id, 'order_id', v_order.id,
                       'outcome', v_effective, 'refunded_cents', v_refunded),
    NULL
  );

  RETURN jsonb_build_object(
    'applied', true,
    'registration_id', v_reg.id,
    'registration_status', v_final.status,
    'waitlist_position', v_final.waitlist_position,
    'newly_settled', v_newly_settled,
    -- ZMIANA (scalenie z main, TIX-05): zwrot automatyczny w kolejce.
    'refund_queued', COALESCE(v_refund_queued, false),
    'outcome', v_effective,
    'refunded_cents', v_refunded,
    'amount_cents', v_order.amount_cents,
    'currency', v_order.currency,
    'tenant_id', v_order.tenant_id,
    'event_id', v_event_id,
    'event_title_pl', v_event.title_pl,
    'event_title_en', v_event.title_en,
    'event_slug', v_event.slug,
    -- ZMIANA 20261012 (R45): baza juz zadzwonila do organizatorow (zamkniecie
    -- na odwolanym wydarzeniu albo wplata na zamknietym zgloszeniu) - TS nie
    -- dzwoni drugi raz.
    'organizer_alerted', v_alerted,
    'contact', jsonb_build_object(
      'person_id', v_reg.person_id,
      'user_id', v_order.user_id,
      'email', v_person.email,
      'phone', v_person.phone,
      'first_name', v_person.first_name,
      'last_name', v_person.last_name
    ),
    'waitlist', v_promoted
  ) || CASE WHEN v_refused
         -- ZMIANA (scalenie z main, TIX-05): wplata na zamkniete zgloszenie
         -- to odmowa wobec kupujacego (`notifyTicketRefusal`), a nie
         -- „miejsce zarezerwowane"; `refund_queued` rozroznia zwrot
         -- automatyczny od decyzji organizatora.
         THEN jsonb_build_object('refused', true, 'reason', 'registration_closed')
         ELSE '{}'::jsonb END;
END;
$function$;

COMMENT ON FUNCTION public.payments_apply_event_ticket_outcome(uuid, text, integer) IS
  'Przenosi wynik platnosci na zgloszenie. Dopasowanie po metadata.registration_id, gdy jest obecne (metadane sprawdzane wzorcem). Blokady dla KAZDEGO wyniku: wydarzenie -> bilety -> zamowienie -> zgloszenie (R45). TIX-01: zamowienie jeszcze nie dowiazane rozlicza zgloszenie tylko, gdy jego konto jest wlascicielem (osoba albo zakladajacy), bilet i waluta sa zgodne, a kwota pokrywa najnizsza cene biletu (_event_ticket_order_mismatch); dopasowanie po osobie -> zakup RSVP, wskazanie -> odmowa. TIX-05: odmowa wplaty (wskazanie bez zgloszenia, niezgodnosc, druga wplata, zgloszenie zamkniete) = znacznik na zamowieniu i zwrot w kolejce (_event_ticket_payment_refused), ladunek refused + refund_queued (zwrot automatyczny albo decyzja organizatora przy wspolnej wplacie). Wplata przyjmuje z kontrola miejsc (_event_registration_paid_admission): miejsce -> approved z kodem QR, brak miejsca -> kolejka OPLACONA (capacity), bilet albo przeplyw z akceptacja -> pending (oplacone), gosc bez przyjetego prowadzacego -> tylko rozliczenie; na odwolanym wydarzeniu zgloszenie zamyka sie ze zwrotem (_event_cancelled_event_close_paid), na zamknietym zgloszeniu ze zleceniem w przegladzie - dzwonek z bazy (organizer_alerted). Wynik unpaid oddaje bilet z puli planu (_event_plan_seat_settle). Zwrot zamowienia, ktore nie oplacilo zgloszenia, go nie odwoluje (refund_for_other_order). Pelny zwrot czysci kod QR i zwalnia zapisy na sesje, zakladki planu oraz starsza rezerwacje RSVP posiadacza (D0-2).';

REVOKE ALL ON FUNCTION public.payments_apply_event_ticket_outcome(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payments_apply_event_ticket_outcome(uuid, text, integer) TO service_role;
