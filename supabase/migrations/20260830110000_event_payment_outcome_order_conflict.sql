-- ============================================================================
-- KSIEGOWANIE WPLATY: KOD QR DLA ODWOLANEGO ZAPISU I DWA ZAMOWIENIA NA JEDEN.
--
-- events-harness: include
--
-- Dwa defekty P1 z recenzji `20260830090000`. Oba dotycza tej samej funkcji
-- i obu nie widac w tekscie migracji - wychodza dopiero z pytania „co sie
-- stanie, gdy kupujacy zrobi to DWA RAZY albo ODWOLA zapis w miedzyczasie".
--
-- ---------------------------------------------------------------------------
-- DEFEKT 1: KOD QR NA ZGLOSZENIU ODWOLANYM WPUSZCZA PRZY BRAMCE
--
-- Galaz `paid` flipuje status wylacznie z `draft/pending/waitlist`, ale kod QR
-- wydawala BEZWARUNKOWO. Uczestnik, ktory otworzyl kase, odwolal zapis i
-- dopiero potem dokonczyl platnosc w nadal zywej sesji operatora, dostawal
-- wiersz `status = 'cancelled'` Z DZIALAJACYM KODEM WEJSCIA.
--
-- To nie jest sprzecznosc kosmetyczna. `event_checkin_record` (20260824102151)
-- odszukuje zgloszenie WYLACZNIE po `qr_token_hash`:
--     SELECT r.id, r.event_id, r.person_id INTO v_reg
--     FROM public.event_registrations r
--     WHERE r.tenant_id = v_device.tenant_id
--       AND r.qr_token_hash = encode(digest(v_code, 'sha256'), 'hex');
-- i NIE SPRAWDZA statusu ANI RAZU. Kod wydany odwolanemu zapisowi wpuszcza
-- wiec przy bramce tak samo, jak kod zapisu przyjetego.
--
-- Naprawa: kod QR powstaje TYLKO wtedy, gdy wiersz po tej operacji naprawde
-- bedzie wpuszczany (`approved` albo `attended`). Pieniadze nadal sa
-- ksiegowane - `payment_status = 'paid'` i `paid_at` zostaja, bo wplata
-- FAKTYCZNIE przyszla i organizator ma ja zobaczyc, zeby moc zwrocic.
--
-- ---------------------------------------------------------------------------
-- DEFEKT 2: DWA ZAMOWIENIA NA JEDNO ZGLOSZENIE
--
-- `event_registration_payment_context` sprawdza wylacznie, czy zgloszenie jest
-- `unpaid` - a wiazane z zamowieniem jest dopiero przy ksiegowaniu wyniku.
-- Kupujacy moze wiec zalozyc i oplacic DWA zamowienia na to samo zgloszenie
-- (dwie zakladki, powrot po zamknieciu nakladki). Cialo sprzed tej naprawy
-- przyjmowalo kazde `paid` i nadpisywalo `payment_order_id`, a pozniejszy zwrot
-- DOWOLNEGO z tych zamowien odwolywal zapis - mimo ze druga wplata nadal byla
-- wazna. Uczestnik tracil miejsce, za ktore zaplacil, a pieniadze zostawaly
-- pobrane.
--
-- Naprawa jest dwustronna:
--   * `paid` na zgloszeniu JUZ oplaconym przez INNE zamowienie -> jawna odmowa
--     `already_settled_by_another_order`. Pieniadze nie znikaja: zamowienie
--     zostaje `paid` u operatora, `applyTicketOutcome` loguje powod, a
--     organizator ma czytelna przeslanke do zwrotu nadliczbowej wplaty;
--   * `refunded` / `partial_refund` z zamowienia INNEGO niz to, ktore oplacilo
--     zgloszenie -> jawna odmowa `refund_for_other_order`, wiec zwrot
--     nadliczbowej wplaty nie odwoluje poprawnie oplaconego zapisu.
--
-- Ponowne doreczenie TEGO SAMEGO zamowienia przechodzi w obu przypadkach
-- (porownanie po `id`), wiec idempotencja webhooka zostaje nietknieta.
--
-- ---------------------------------------------------------------------------
-- CZEGO TA MIGRACJA NADAL NIE ROBI. Nie rezerwuje miejsca na czas sesji
-- operatora. Defekt „pula wyczerpana miedzy kasa a webhookiem" zostaje
-- zarejestrowany w `scripts/events-harness/runtime_test.d/25_payment_binding.sql`
-- (sekcja 6) razem z trzema propozycjami rozstrzygniecia - to decyzja
-- o pieniadzach klienta, nie refaktor.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.payments_apply_event_ticket_outcome(
  p_order_id uuid,
  p_outcome text,
  p_refunded_cents integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_order public.payment_orders;
  v_event_id uuid;
  v_ticket_type_id uuid;
  v_registration_hint uuid;
  v_person_id uuid;
  v_reg public.event_registrations;
  v_token text;
  v_promoted jsonb := jsonb_build_object('promoted', 0, 'registrations', '[]'::jsonb);
  v_effective text;
  v_refunded integer;
  v_person public.event_people;
  v_event public.events;
  v_next_status text;
  v_admitted boolean;
BEGIN
  IF p_outcome NOT IN ('paid','unpaid','refunded','partial_refund') THEN
    RAISE EXCEPTION 'invalid_outcome';
  END IF;

  SELECT * INTO v_order FROM public.payment_orders o WHERE o.id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'order_not_found');
  END IF;

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

  v_event_id := NULLIF(v_order.metadata->>'event_id','')::uuid;
  v_ticket_type_id := NULLIF(v_order.metadata->>'ticket_type_id','')::uuid;
  -- Ksztalt sprawdzamy REGEXEM, a nie rzutowaniem: `'zle'::uuid` rzuca 22P02
  -- i wywracaloby ksiegowanie wplaty, ktora u operatora juz przeszla.
  v_registration_hint := CASE
    WHEN COALESCE(v_order.metadata->>'registration_id','') ~ '^[0-9a-fA-F-]{36}$'
      THEN (v_order.metadata->>'registration_id')::uuid
    ELSE NULL
  END;

  IF v_event_id IS NULL OR v_order.user_id IS NULL OR v_order.tenant_id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'not_a_ticket_order',
                              'outcome', v_effective, 'refunded_cents', v_refunded);
  END IF;

  -- ==========================================================================
  -- DOPASOWANIE ZGLOSZENIA (zmiana z 2026-08-30).
  --
  -- BYLO: alternatywa `payment_order_id = order.id OR person_id = <osoba>`
  -- z `ORDER BY ... created_at DESC LIMIT 1`. Pierwszy czlon ustawia DOPIERO
  -- TA FUNKCJA, wiec przy pierwszym ksiegowaniu dzialal WYLACZNIE drugi:
  -- uczestnik z dwoma zgloszeniami na to samo wydarzenie dostawal oplacony
  -- bilet przypiety do najnowszego wiersza, niekoniecznie tego, za ktory
  -- zaplacil.
  --
  -- JEST: gdy zamowienie NIESIE `registration_id`, dopasowanie idzie WYLACZNIE
  -- po nim. Niezgodnosc najemcy albo wydarzenia to JAWNA ODMOWA, a nie ciche
  -- zejscie do zgadywania po osobie - blad wskazania ma byc widoczny, a nie
  -- zamaskowany tym samym zachowaniem, ktore usuwamy.
  --
  -- Dopasowanie po osobie ZOSTAJE dla zamowien BEZ tego klucza: kasa
  -- spolecznosci (`EventTicketPurchase` -> cena z wiersza wydarzenia) nie zna
  -- zgloszen etapu 4, a zamowienia zalozone przed ta migracja juz leza w bazie.
  -- ==========================================================================
  IF v_registration_hint IS NOT NULL THEN
    SELECT r.* INTO v_reg
    FROM public.event_registrations r
    WHERE r.id = v_registration_hint
      AND r.tenant_id = v_order.tenant_id
      AND r.event_id = v_event_id
    FOR UPDATE;

    IF v_reg.id IS NULL THEN
      RETURN jsonb_build_object('applied', false, 'reason', 'registration_mismatch',
                                'registration_id', v_registration_hint,
                                'outcome', v_effective, 'refunded_cents', v_refunded);
    END IF;
  ELSE
    SELECT p.id INTO v_person_id
    FROM public.event_people p
    WHERE p.tenant_id = v_order.tenant_id AND p.user_id = v_order.user_id
    LIMIT 1;

    SELECT r.* INTO v_reg
    FROM public.event_registrations r
    WHERE r.tenant_id = v_order.tenant_id
      AND r.event_id = v_event_id
      AND (
        r.payment_order_id = v_order.id
        OR (v_person_id IS NOT NULL AND r.person_id = v_person_id)
      )
    ORDER BY (r.payment_order_id = v_order.id) DESC, r.created_at DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_reg.id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'registration_not_found',
                              'outcome', v_effective, 'refunded_cents', v_refunded);
  END IF;

  IF v_effective = 'paid' THEN
    -- ========================================================================
    -- DWIE ZAMOWIENIA NA JEDNO ZGLOSZENIE (naprawa 2026-08-30, recenzja PR).
    --
    -- Zgloszenie NIE JEST wiazane z zamowieniem w chwili zalozenia zamowienia -
    -- `payment_order_id` ustawia dopiero ta funkcja. Kupujacy moze wiec otworzyc
    -- kase dwa razy (dwie zakladki, powrot po zamknieciu nakladki) i oplacic OBA
    -- zamowienia. Cialo sprzed tej naprawy przyjmowalo kazde `paid` i nadpisywalo
    -- `payment_order_id`, a pozniejszy zwrot DOWOLNEGO z nich odwolywal
    -- zgloszenie - mimo ze druga wplata nadal byla wazna.
    --
    -- Druga wplata jest wiec JAWNIE ODRZUCANA. To nie gubi pieniedzy: zamowienie
    -- zostaje `paid` u operatora, `applyTicketOutcome` loguje powod, a organizator
    -- ma czytelna przeslanke do zwrotu. Cicha nadpiska nie dawala ani jednego,
    -- ani drugiego.
    --
    -- Ponowne doreczenie TEGO SAMEGO zamowienia przechodzi (porownanie po `id`),
    -- wiec idempotencja webhooka zostaje nietknieta.
    -- ========================================================================
    IF v_reg.payment_status = 'paid'
       AND v_reg.payment_order_id IS NOT NULL
       AND v_reg.payment_order_id <> v_order.id THEN
      RETURN jsonb_build_object('applied', false, 'reason', 'already_settled_by_another_order',
                                'registration_id', v_reg.id,
                                'payment_order_id', v_reg.payment_order_id,
                                'outcome', v_effective, 'refunded_cents', v_refunded);
    END IF;

    -- ========================================================================
    -- KOD QR TYLKO DLA WIERSZA, KTORY NAPRAWDE BEDZIE WPUSZCZONY.
    --
    -- Status flipuje sie wylacznie z `draft/pending/waitlist`; wplata na
    -- zgloszenie ODWOLANE zostawiala je `cancelled` - i mimo to wydawala mu kod
    -- QR. To nie jest kosmetyka: `event_checkin_record` odszukuje zgloszenie
    -- WYLACZNIE po `qr_token_hash` i NIE SPRAWDZA statusu, wiec taki kod
    -- WPUSZCZALBY przy bramce kogos, kto sam odwolal udzial. Sciezka jest realna
    -- i po dowiazaniu po `registration_id` trafia sie czesciej, bo wplata idzie
    -- dokladnie tam, gdzie wskazano.
    -- ========================================================================
    v_next_status := CASE
      WHEN v_reg.status IN ('draft','pending','waitlist') THEN 'approved'
      ELSE v_reg.status
    END;
    v_admitted := v_next_status IN ('approved','attended');
    v_token := CASE WHEN v_admitted THEN public._event_new_qr_token() END;

    UPDATE public.event_registrations r
    SET payment_order_id = v_order.id,
        payment_status = 'paid',
        paid_at = COALESCE(r.paid_at, now()),
        ticket_type_id = COALESCE(v_ticket_type_id, r.ticket_type_id),
        status = v_next_status,
        waitlist_position = NULL,
        -- `cancelled_at` CZYSCIMY WYLACZNIE RAZEM ZE STATUSEM (naprawa 2026-08-30).
        --
        -- Bylo tu bezwarunkowe `cancelled_at = NULL`, a status flipuje sie
        -- tylko z `draft/pending/waitlist`. Wplata ksiegowana na zgloszeniu
        -- ODWOLANYM zostawiala wiec wiersz `status = 'cancelled'` z pustym
        -- `cancelled_at` - czyli naruszenie `event_registrations_cancelled_dated`,
        -- czyli WYJATEK w calej funkcji. Webhook zamienia wyjatek na 500,
        -- operator ponawia dostarczenie, a ponowienie pada tak samo: pieniadze
        -- pobrane, zgloszenie nietkniete, petla bez konca. Sciezka jest realna
        -- - uczestnik odwoluje zapis i dopiero potem konczy platnosc zaczeta
        -- wczesniej - i po dowiazaniu po `registration_id` trafia sie CZESCIEJ,
        -- bo wplata idzie dokladnie tam, gdzie wskazano.
        cancelled_at = CASE
          WHEN r.status IN ('draft','pending','waitlist') THEN NULL
          ELSE r.cancelled_at
        END,
        decided_at = COALESCE(r.decided_at, now()),
        decision_source = COALESCE(r.decision_source, 'system'),
        qr_token_hash = CASE
          WHEN v_admitted THEN COALESCE(r.qr_token_hash, encode(digest(v_token,'sha256'),'hex'))
          ELSE r.qr_token_hash
        END,
        qr_issued_at = CASE
          WHEN v_admitted THEN COALESCE(r.qr_issued_at, now())
          ELSE r.qr_issued_at
        END,
        updated_at = now()
    WHERE r.id = v_reg.id;

  ELSIF v_effective = 'unpaid' THEN
    UPDATE public.event_registrations r
    SET payment_order_id = v_order.id,
        payment_status = 'unpaid',
        updated_at = now()
    WHERE r.id = v_reg.id AND r.payment_status <> 'paid';

  ELSIF v_effective IN ('partial_refund', 'refunded')
        AND v_reg.payment_order_id IS NOT NULL
        AND v_reg.payment_order_id <> v_order.id THEN
    -- Zwrot dotyczy INNEGO zamowienia niz to, ktore oplacilo zgloszenie.
    -- Bez tej bramki zwrot nadliczbowej wplaty ODWOLYWAL zapis oplacony
    -- poprawnie przez drugie zamowienie - uczestnik traci miejsce, za ktore
    -- zaplacil, a pieniadze zostaja pobrane.
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
        updated_at = now()
    WHERE r.id = v_reg.id;

    v_promoted := public._event_waitlist_promote(
      v_order.tenant_id, v_event_id, COALESCE(v_ticket_type_id, v_reg.ticket_type_id), 1);
  END IF;

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
    'outcome', v_effective,
    'refunded_cents', v_refunded,
    'amount_cents', v_order.amount_cents,
    'currency', v_order.currency,
    'tenant_id', v_order.tenant_id,
    'event_id', v_event_id,
    'event_title_pl', v_event.title_pl,
    'event_title_en', v_event.title_en,
    'event_slug', v_event.slug,
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
  'Przenosi wynik platnosci na zgloszenie. Dopasowanie po metadata.registration_id, gdy jest obecne. Kod QR powstaje TYLKO dla wiersza, ktory bedzie wpuszczany (event_checkin_record nie sprawdza statusu). Druga wplata na to samo zgloszenie i zwrot z cudzego zamowienia sa jawnie odrzucane.';

REVOKE ALL ON FUNCTION public.payments_apply_event_ticket_outcome(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payments_apply_event_ticket_outcome(uuid, text, integer) TO service_role;
