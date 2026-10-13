-- events-harness: include
-- ============================================================================
-- ZAPISY NA WYDARZENIA - REG-08/REG-03 (PRZEGLAD R45, CZ. 5): KAZDY
-- ZAPISUJACY MIEJSCA BLOKUJE WYDARZENIE -> BILET -> (ZAMOWIENIE) -> ZGLOSZENIE;
-- WPLATA NA ODWOLANYM WYDARZENIU ZAMYKA SIE ZWROTEM.
--
-- DEFEKT
--   1. `_event_package_purchase` (20261007120600) blokuje BILET (`FOR UPDATE
--      OF t`), a wydarzenie dopiero kluczem obcym przy wstawieniu zamowienia
--      (KEY SHARE) - odwrotnie niz reszta modulu. Z kazdym zapisujacym
--      miejsca (zapis, decyzja, rezygnacja, wynik platnosci, kazdy
--      `_event_waitlist_promote`) konczylo sie 40P01 (dblink, przeglad R45 p5).
--   2. `payments_apply_event_ticket_outcome` (20260926180002:28-413) blokuje
--      ZAMOWIENIE, a wydarzenie i bilet tylko dla wyniku `paid`. Zwrot
--      (`refunded`/`partial_refund`) blokowal zgloszenie przed biletem
--      (trigger `sold_count`) i wydarzeniem (awans), a
--      `event_registration_cancel` od 20261012170100 bierze wydarzenie ->
--      bilet -> zgloszenie - rownoczesna rezygnacja i webhook zwrotu tego
--      samego zgloszenia konczyly sie 40P01 (przeglad R45 p7). Sama blokada
--      wydarzenia PO zamowieniu nie wystarcza: rezygnacja wstawia zlecenie
--      zwrotu z kluczem obcym do zamowienia (KEY SHARE), czyli czeka na
--      webhook trzymajacy zamowienie.
--   3. Wplata, ktora dotrze po odwolaniu wydarzenia, przyjmowala zgloszenie
--      na miejsce (z kodem QR); wplata na zgloszeniu juz zamknietym tworzyla
--      zlecenie `needs_review` po cichu (dzwonil tylko TS).
--
-- ZMIANA
--   A. `_event_package_purchase`: wydarzenie pakietu FOR UPDATE przed biletem.
--   B. `payments_apply_event_ticket_outcome`: zamowienie czytane BEZ blokady
--      (tylko metadane: wydarzenie, bilet, zgloszenie), dopasowanie zgloszenia
--      bez blokady, potem dla KAZDEGO wyniku: wydarzenie -> bilety (z zamowienia
--      i ze zgloszenia, w porzadku identyfikatorow) -> zamowienie FOR UPDATE ->
--      zgloszenie FOR UPDATE. Reszta ciala bez zmian.
--   C. Wplata na ODWOLANYM wydarzeniu: `_event_registration_paid_admission`
--      (20261012181100) nie przyjmuje, a po rozliczeniu
--      `_event_cancelled_event_close_paid` (20261012181000) zamyka zgloszenie
--      ze zwrotem i jednym dzwonkiem. Wplata na zgloszeniu juz ZAMKNIETYM:
--      dzwonek o zleceniu z siatki bezpieczenstwa. Odpowiedz niesie
--      `organizer_alerted` - TS nie dzwoni drugi raz.
--
-- CZEGO TO NIE ZAMYKA. Statyczny straznik kolejnosci blokad obejmuje liste
-- znanych zapisujacych miejsca (test pgTAP), nie kazda przyszla funkcje.
--
-- KOLEJNOSC WDROZENIA: dowolna (sygnatury bez zmian; nowy klucz odpowiedzi
-- `organizer_alerted` czyta TS, stary TS go ignoruje - wtedy dwa dzwonki).
-- IDEMPOTENTNA: CREATE OR REPLACE, bezstanowe REVOKE/GRANT, COMMENT ON.
-- DOWOD: supabase/tests/event_refund_r45_test.sql,
-- scripts/events-harness/runtime_test.d/24_r45_cancel_refund_locks.sql (dblink).
-- ============================================================================

-- A) ZAKUP PAKIETU --------------------------------------------------------------------
-- Cialo z 20261007120600. ZMIANA 20261012 (R45) oznaczona nizej.
CREATE OR REPLACE FUNCTION public._event_package_purchase(p_payload jsonb, p_ip_subject text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public._caller_tenant();
  v_package_id uuid := NULLIF(p_payload->>'package_id', '')::uuid;
  v_email text := lower(btrim(COALESCE(p_payload->>'buyer_email', '')));
  v_name text := btrim(COALESCE(p_payload->>'buyer_name', ''));
  v_note text := btrim(COALESCE(p_payload->>'invoice_note', ''));
  v_quote jsonb;
  v_pkg public.event_ticket_packages;
  v_type public.event_ticket_types;
  v_order_id uuid;
  v_coupon_id uuid;
  v_total integer;
  v_discount integer;
  v_per_user integer;
BEGIN
  IF v_uid IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required';
  END IF;
  IF v_package_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: package_id is required';
  END IF;
  -- FIRME NA ZAMOWIENIU USTALA ORGANIZATOR, NIE KUPUJACY. Przypiecie
  -- `company_id` robi most faktur przy WYSTAWIENIU (decyzja administratora,
  -- 20260927000200) i tylko na pustym polu - wartosc od kupujacego wyprzedzala
  -- te decyzje, a potem blokowala ja na zawsze. Klucz w ladunku (nawet pusty)
  -- to blad wolajacego, nie cicha zmiana znaczenia.
  IF p_payload ? 'company_id' THEN
    RAISE EXCEPTION 'forbidden_field: company_id is assigned by the organizer';
  END IF;

  v_quote := public._event_admission_quote(jsonb_build_object(
    'package_id', v_package_id,
    'coupon_code', COALESCE(p_payload->>'coupon_code', '')
  ), p_ip_subject);

  IF NOT (v_quote->>'ok')::boolean THEN
    -- PUDLO WRACA WARTOSCIA, NIE WYJATKIEM. Wycena zapisala wlasnie pudlo
    -- w kubelku uzytkownika (`_coupon_probe_miss`); wyjatek wycofalby ten zapis
    -- razem z cala transakcja, a zakup pakietu bylby nieograniczona wyrocznia
    -- kodow. Przed tym miejscem zakup niczego nie zapisal, wiec powrot
    -- zatwierdza wylacznie pudlo. Pozostale odmowy niczego nie zliczaja i rzucaja
    -- jak dotad (`refused_<powod>`).
    IF v_quote->>'reason' = 'coupon_unknown' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_unknown');
    END IF;
    RAISE EXCEPTION 'refused_%: %', v_quote->>'reason', v_quote->>'reason';
  END IF;

  v_total := (v_quote->>'total_cents')::integer;
  v_discount := (v_quote->>'discount_cents')::integer;
  v_coupon_id := NULLIF(v_quote->>'coupon_id', '')::uuid;

  -- ZMIANA 20261012 (R45, REG-08): wydarzenie PRZED biletem - kolejnosc calego
  -- modulu (wydarzenie -> bilet -> zgloszenie). Bez tej blokady zakup trzymal
  -- bilet i czekal na wydarzenie (klucz obcy zamowienia), a kazdy inny
  -- zapisujacy miejsca trzymal wydarzenie i czekal na bilet - 40P01.
  PERFORM 1
  FROM public.events e
  JOIN public.event_ticket_packages p
    ON p.event_id = e.id AND p.tenant_id = e.tenant_id
  WHERE p.id = v_package_id AND p.tenant_id = v_tenant
  FOR UPDATE OF e;

  SELECT t.* INTO v_type
  FROM public.event_ticket_types t
  JOIN public.event_ticket_packages p
    ON p.ticket_type_id = t.id AND p.tenant_id = t.tenant_id
  WHERE p.id = v_package_id AND p.tenant_id = v_tenant
  FOR UPDATE OF t;

  SELECT * INTO v_pkg
  FROM public.event_ticket_packages
  WHERE id = v_package_id AND tenant_id = v_tenant
  FOR UPDATE;

  IF v_pkg.id IS NULL OR v_type.id IS NULL THEN
    RAISE EXCEPTION 'not_found: package does not exist in this tenant';
  END IF;

  IF v_pkg.quota IS NOT NULL AND v_pkg.sold_count >= v_pkg.quota THEN
    RAISE EXCEPTION 'sold_out: no packages left';
  END IF;
  IF v_type.quota IS NOT NULL AND v_type.sold_count + v_pkg.seats > v_type.quota THEN
    RAISE EXCEPTION 'seats_exhausted: not enough seats left for a whole package';
  END IF;

  INSERT INTO public.event_package_orders (
    tenant_id, event_id, package_id, buyer_user_id, company_id,
    buyer_email, buyer_name, seats_total, status,
    amount_cents, discount_cents, currency, coupon_id, invoice_note, created_by
  ) VALUES (
    v_tenant, v_pkg.event_id, v_package_id, v_uid, NULL,
    CASE WHEN v_email <> '' THEN v_email
         ELSE lower(btrim((SELECT u.email FROM auth.users u WHERE u.id = v_uid))) END,
    v_name, v_pkg.seats, 'pending',
    v_total, v_discount, v_pkg.currency, v_coupon_id, v_note, v_uid
  )
  RETURNING id INTO v_order_id;

  -- ZUZYCIE KODU W TEJ SAMEJ TRANSAKCJI CO ZAMOWIENIE. Wycena wyzej sprawdzila
  -- limity BEZ blokady, wiec dwa rownolegle zakupy mogly ja przejsc na
  -- ostatnim uzyciu. Rozstrzyga dopiero blokada wiersza kodu i warunkowy
  -- UPDATE licznika - przegrany zakup RZUCA, a wyjatek wycofuje razem z nim
  -- zamowienie wyzej i pule nizej. Limit na osobe PRZED licznikiem (jak
  -- w `redeem_b2b_coupon`), zeby odrzucona proba nie zjadala puli kodu.
  --
  -- `order_id` zostaje NULL: klucz obcy wskazuje payment_orders, a zamowienie
  -- pakietu rozlicza sie poza operatorem (faktura). Limit na osobe liczy sie po
  -- `user_id`, wiec dziala bez niego.
  IF v_coupon_id IS NOT NULL THEN
    SELECT c.max_redemptions_per_user INTO v_per_user
    FROM public.b2b_coupons c
    WHERE c.id = v_coupon_id AND c.tenant_id = v_tenant
    FOR UPDATE;

    IF v_per_user IS NOT NULL AND (
         SELECT count(*)
         FROM public.b2b_coupon_redemptions r
         WHERE r.coupon_id = v_coupon_id AND r.user_id = v_uid
           AND r.tenant_id = v_tenant
       ) >= v_per_user THEN
      RAISE EXCEPTION 'refused_coupon_used_by_you: code already used by this buyer in a concurrent order';
    END IF;

    UPDATE public.b2b_coupons c
    SET redemptions_count = c.redemptions_count + 1, updated_at = now()
    WHERE c.id = v_coupon_id AND c.tenant_id = v_tenant AND c.active
      AND (c.max_redemptions IS NULL OR c.redemptions_count < c.max_redemptions)
      AND (c.valid_from IS NULL OR now() >= c.valid_from)
      AND (c.valid_until IS NULL OR now() < c.valid_until);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'refused_coupon_exhausted: last use taken by a concurrent order';
    END IF;

    -- `package_order_id` (20260926130000) wskazuje zamowienie, ktore to uzycie
    -- zuzylo - bez niego anulowanie nie ma czego oddac.
    INSERT INTO public.b2b_coupon_redemptions (
      tenant_id, coupon_id, order_id, user_id, applied_cents, original_cents, currency,
      package_order_id
    ) VALUES (
      v_tenant, v_coupon_id, NULL, v_uid, v_discount, v_total + v_discount, v_pkg.currency,
      v_order_id
    );
  END IF;

  INSERT INTO public.event_package_seats (tenant_id, event_id, package_order_id)
  SELECT v_tenant, v_pkg.event_id, v_order_id FROM generate_series(1, v_pkg.seats);

  UPDATE public.event_ticket_packages
  SET sold_count = sold_count + 1 WHERE id = v_package_id AND tenant_id = v_tenant;
  UPDATE public.event_ticket_types
  SET sold_count = sold_count + v_pkg.seats WHERE id = v_type.id AND tenant_id = v_tenant;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'seats', v_pkg.seats,
    'currency', v_pkg.currency,
    'total_cents', v_total,
    'discount_cents', v_discount,
    'status', 'pending'
  );
END;
$function$;
REVOKE ALL ON FUNCTION public._event_package_purchase(jsonb, text) FROM PUBLIC, anon, authenticated;

-- B+C) WYNIK PLATNOSCI ----------------------------------------------------------------
-- Cialo z 20260926180002:28-413. Zmiany oznaczone `ZMIANA 20261012 (R45)`.
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

  v_event_id := NULLIF(v_order.metadata->>'event_id','')::uuid;
  v_ticket_type_id := NULLIF(v_order.metadata->>'ticket_type_id','')::uuid;
  -- Ksztalt sprawdzamy REGEXEM, a nie rzutowaniem: `'zle'::uuid` rzuca 22P02
  -- i wywracaloby ksiegowanie wplaty, ktora u operatora juz przeszla.
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

  IF v_effective = 'paid' THEN
    -- Druga wplata na to samo zgloszenie jest JAWNIE odrzucana (naprawa
    -- 2026-08-30): zamowienie zostaje `paid` u operatora, organizator ma
    -- przeslanke do zwrotu. Ponowne doreczenie TEGO SAMEGO zamowienia
    -- przechodzi (porownanie po `id`) - idempotencja webhooka nietknieta.
    IF v_reg.payment_status = 'paid'
       AND v_reg.payment_order_id IS NOT NULL
       AND v_reg.payment_order_id <> v_order.id THEN
      RETURN jsonb_build_object('applied', false, 'reason', 'already_settled_by_another_order',
                                'registration_id', v_reg.id,
                                'payment_order_id', v_reg.payment_order_id,
                                'outcome', v_effective, 'refunded_cents', v_refunded);
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

    -- ZMIANA 20261012 (R45): wplata na zgloszeniu juz ZAMKNIETYM - siatka
    -- bezpieczenstwa (`_event_rejection_refund_queue`) zostawila zlecenie
    -- w przegladzie; organizator dowiaduje sie z bazy, nie tylko z TS.
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
        AND v_reg.payment_order_id IS NOT NULL
        AND v_reg.payment_order_id <> v_order.id THEN
    -- Zwrot dotyczy INNEGO zamowienia niz to, ktore oplacilo zgloszenie -
    -- nie odwoluje zapisu oplaconego poprawnie drugim zamowieniem.
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
  );
END;
$function$;

COMMENT ON FUNCTION public.payments_apply_event_ticket_outcome(uuid, text, integer) IS
  'Przenosi wynik platnosci na zgloszenie. Dopasowanie po metadata.registration_id, gdy jest obecne. Blokady dla KAZDEGO wyniku: wydarzenie -> bilety -> zamowienie -> zgloszenie (R45). Wplata przyjmuje z kontrola miejsc (_event_registration_paid_admission): miejsce -> approved z kodem QR, brak miejsca -> kolejka OPLACONA (capacity), bilet albo przeplyw z akceptacja -> pending (oplacone), gosc bez przyjetego prowadzacego -> tylko rozliczenie; na odwolanym wydarzeniu zgloszenie zamyka sie ze zwrotem (_event_cancelled_event_close_paid), na zamknietym zgloszeniu - dzwonek o zleceniu w przegladzie (organizer_alerted w odpowiedzi). Wynik unpaid oddaje bilet z puli planu (_event_plan_seat_settle). Odpowiedz niesie registration_status, waitlist_position, newly_settled i organizer_alerted. Druga wplata na to samo zgloszenie i zwrot z cudzego zamowienia sa jawnie odrzucane. Pelny zwrot czysci kod QR i zwalnia zapisy na sesje, zakladki planu oraz starsza rezerwacje RSVP posiadacza (D0-2).';

REVOKE ALL ON FUNCTION public.payments_apply_event_ticket_outcome(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payments_apply_event_ticket_outcome(uuid, text, integer) TO service_role;
