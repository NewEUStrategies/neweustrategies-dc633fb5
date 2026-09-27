-- CZESC 3/3 MIGRACJI 0067_event_registration_gaps_part3.sql
-- migration-split: part 3/3 of 0067_event_registration_gaps_part3.sql
--
-- PO CO PODZIAL. Panel Lovable nie wdraza duzych plikow migracji (wdrozyl
-- 52 653 B, odrzucil pliki od 62 KB wzwyz), wiec scripts/split-migration.ts
-- pocial oryginal na czesci po najwyzej 46080 B - wylacznie na granicach
-- instrukcji najwyzszego poziomu i bez oddzielania obiektu od jego RLS
-- i REVOKE. Czesci wdraza sie PO KOLEI: 0067_event_registration_gaps_part3.sql,
-- potem 0069_event_registration_gaps_part3_part2.sql .. 0070_event_registration_gaps_part3_part3.sql.
-- SQL wykonywalny czesci sklejonych w tej kolejnosci == SQL oryginalu
-- (dowod: src/lib/ci/migrationSplit.ts). Opis zmian i uzasadnienie - w czesci 1.

-- ----------------------------------------------------------------------------
-- g) WYNIK PLATNOSCI: MIEJSCE Z KONTROLA (pozycja 5), `unpaid` ODDAJE BILET
-- ----------------------------------------------------------------------------
-- Cialo z 20260830110000. Zmiany: blokady wydarzenie -> bilet -> zgloszenie,
-- galaz `paid` z kontrola miejsc (f2), odpowiedz z registration_status /
-- waitlist_position / newly_settled; galaz `unpaid` nie zmienia payment_status
-- (unpaid -> unpaid), wiec trigger b) jej nie widzi - wola
-- `_event_plan_seat_settle` z wylaczeniem tego zamowienia.
--
-- NAPRAWY D0-2 Z 20260926153200 (funkcje uczestnika) sa PRZENIESIONE do tego
-- ciala (ta migracja biegnie po niej): 'pg_temp' w search_path, pelny zwrot
-- czysci kod QR i zwalnia zapisy na sesje, zakladki planu oraz starsza
-- rezerwacje RSVP posiadacza. Na tym ostatnim polega `refunds.server.ts`:
-- zamowienia ze zgloszeniem nie anuluje RSVP w aplikacji.
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
  v_next_status text;
  v_admitted boolean;
  v_queued boolean;
  v_position integer;
  v_newly_settled boolean := false;
  v_final public.event_registrations;
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
  --
  -- DOPASOWANIE BEZ BLOKADY, BLOKADY W KOLEJNOSCI wydarzenie -> bilet ->
  -- zgloszenie (20260926180000). Cialo z 20260830110000 blokowalo najpierw
  -- zgloszenie, a wydarzenia i puli biletu nie blokowalo wcale: dwie wplaty za
  -- ostatnie miejsce liczyly je obie jako wolne (nadsprzedaz albo CHECK puli
  -- wywracajacy cale ksiegowanie), a kolejnosc byla odwrotna niz w
  -- `event_register` i `admin_event_registration_decide` (zakleszczenie).
  -- ==========================================================================
  IF v_registration_hint IS NOT NULL THEN
    SELECT r.id, r.ticket_type_id INTO v_reg_id, v_seat_ticket
    FROM public.event_registrations r
    WHERE r.id = v_registration_hint
      AND r.tenant_id = v_order.tenant_id
      AND r.event_id = v_event_id;

    IF v_reg_id IS NULL THEN
      RETURN jsonb_build_object('applied', false, 'reason', 'registration_mismatch',
                                'registration_id', v_registration_hint,
                                'outcome', v_effective, 'refunded_cents', v_refunded);
    END IF;
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

  IF v_reg_id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'registration_not_found',
                              'outcome', v_effective, 'refunded_cents', v_refunded);
  END IF;

  -- Wplata liczy miejsce: pula wydarzenia i biletu pod blokada PRZED wierszem
  -- zgloszenia. Zwroty i nieudana platnosc miejsca nie zajmuja - awans za
  -- zwolnione miejsce blokuje pule sam (`_event_waitlist_promote`).
  IF v_effective = 'paid' THEN
    PERFORM 1 FROM public.events e
    WHERE e.id = v_event_id AND e.tenant_id = v_order.tenant_id
    FOR UPDATE;
    PERFORM 1 FROM public.event_ticket_types t
    WHERE t.id = COALESCE(v_ticket_type_id, v_seat_ticket) AND t.tenant_id = v_order.tenant_id
    FOR UPDATE;
  END IF;

  SELECT r.* INTO v_reg
  FROM public.event_registrations r
  WHERE r.id = v_reg_id AND r.tenant_id = v_order.tenant_id
  FOR UPDATE;

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
    -- Wplata na zgloszenie ODWOLANE zostawia je `cancelled` i nie wydaje mu
    -- kodu: `event_checkin_record` odszukuje zgloszenie WYLACZNIE po
    -- `qr_token_hash` i NIE SPRAWDZA statusu, wiec taki kod wpuszczalby przy
    -- bramce kogos, kto sam odwolal udzial.
    --
    -- MIEJSCE Z KONTROLA (20260926180000). Cialo sprzed tej migracji flipowalo
    -- `draft/pending/waitlist -> approved` bez liczenia miejsc: przy wyczerpanej
    -- puli biletu CHECK `event_ticket_types_sold_within_quota` wywracal CALE
    -- ksiegowanie (pieniadze pobrane, zgloszenie nietkniete, bez biletu - defekt
    -- przybity w 25_payment_binding), a przy samej pojemnosci wydarzenia
    -- nadsprzedaz przechodzila po cichu. Teraz `_event_registration_paid_admission`:
    -- miejsce -> przyjete z kodem; brak miejsca -> kolejka OPLACONA
    -- (`capacity`, awans przy zwolnieniu miejsca); bilet albo przeplyw
    -- z akceptacja -> `pending` oplacone (wplata nie jest akceptacja).
    -- Wiersz juz w kolejce zachowuje swoja pozycje (nie przeskakuje nikogo).
    -- ========================================================================
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
  'Przenosi wynik platnosci na zgloszenie. Dopasowanie po metadata.registration_id, gdy jest obecne. Wplata przyjmuje z kontrola miejsc pod blokada wydarzenia i biletu (_event_registration_paid_admission): miejsce -> approved z kodem QR, brak miejsca -> kolejka OPLACONA (capacity), bilet albo przeplyw z akceptacja -> pending (oplacone), gosc bez przyjetego prowadzacego -> tylko rozliczenie. Wynik unpaid oddaje bilet z puli planu (_event_plan_seat_settle). Odpowiedz niesie registration_status, waitlist_position i newly_settled. Druga wplata na to samo zgloszenie i zwrot z cudzego zamowienia sa jawnie odrzucane. Pelny zwrot czysci kod QR i zwalnia zapisy na sesje, zakladki planu oraz starsza rezerwacje RSVP posiadacza (D0-2).';

REVOKE ALL ON FUNCTION public.payments_apply_event_ticket_outcome(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payments_apply_event_ticket_outcome(uuid, text, integer) TO service_role;

-- ----------------------------------------------------------------------------
-- h) DOPIECIE BILETOW ZAJETYCH PRZED TA MIGRACJA
-- ----------------------------------------------------------------------------
-- Wylacznie service_role. Dowodem jest zamowienie z benefitem `included`
-- i zgloszeniem tego wydarzenia (najnowsze wygrywa). Tylko bilety CZYNNE:
-- zwolniony (takze odpiety przez administratora) zostaje bez zgloszenia, wiec
-- ponowne uruchomienie nie cofa recznej decyzji. Bilet bez takiego
-- zamowienia (kasa przerwana przed zamowieniem) zostaje bez zgloszenia -
-- nie odroznimy go od biletu sciezki RSVP. Potem ten sam przeglad, co co
-- godzine: bilety porzuconych i zamknietych kas wracaja do puli. Idempotentna.
CREATE OR REPLACE FUNCTION public._event_plan_seat_link_backfill()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_linked integer;
BEGIN
  UPDATE public.plan_ticket_claims c
     SET registration_id = x.registration_id
    FROM (
      SELECT DISTINCT ON (o.user_id, r.event_id)
             o.user_id, r.event_id, r.id AS registration_id
        FROM public.payment_orders o
        JOIN public.event_registrations r
          ON r.id = CASE
               WHEN COALESCE(o.metadata->>'registration_id', '') ~ '^[0-9a-fA-F-]{36}$'
                 THEN (o.metadata->>'registration_id')::uuid
             END
       WHERE o.metadata->>'plan_benefit' = 'included'
       ORDER BY o.user_id, r.event_id, o.created_at DESC
    ) x
   WHERE c.registration_id IS NULL
     AND c.released_at IS NULL
     AND c.user_id = x.user_id
     AND c.event_id = x.event_id;
  GET DIAGNOSTICS v_linked = ROW_COUNT;

  RETURN jsonb_build_object(
    'linked', v_linked,
    'released', public._event_plan_seat_release_lapsed(100000)
  );
END;
$$;
REVOKE ALL ON FUNCTION public._event_plan_seat_link_backfill() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_plan_seat_link_backfill() TO service_role;

COMMENT ON FUNCTION public._event_plan_seat_link_backfill() IS
  'Dopiecie danych sprzed 20260926180000 (service_role): przypina bilety z puli do zgloszen po zamowieniach z benefitem included (najnowsze na osobe i wydarzenie) i od razu zwalnia te, ktorych zgloszenie nie potrzebuje (_event_plan_seat_release_lapsed). Idempotentna; zwraca {linked, released}.';

SELECT public._event_plan_seat_link_backfill();

-- ============================================================================
-- 9) BILET Z PULI DLA POJEDYNCZEGO ZGLOSZENIA ETAPU 4 (pozycja 4, bez Stripe)
-- ============================================================================
-- PRZYCZYNA. Pojedyncze zgloszenie etapu 4 czlonka z biletem w puli konczylo
-- sie w kasie odmowa `ticket_included_in_plan` („odbierz z puli
-- czlonkowskiej"), a drogi odbioru dla zgloszenia z formularza nie bylo:
-- `claim_included_event_ticket` zna wylacznie `rsvp_event`. Zgloszenie stalo
-- `pending/unpaid` bez wejsciowki.
--
-- Odpowiedz: `{ok: true, registration_id, event_id, status: 'approved',
-- payment_status: 'paid', reused}` albo `{ok: false, reason}`, gdzie `reason`
-- to `account_required` | `not_found` | `not_eligible` | `registration_closed` |
-- `already_settled` | `group_order` | `ticket_not_available` |
-- `event_finished` | `sales_not_open` | `sales_closed` | `approval_required` |
-- `sold_out` | `pool_empty`. Odmowa NIE rzuca i NICZEGO nie zapisuje: bilet
-- z puli schodzi dopiero po wszystkich sprawdzeniach, w tej samej transakcji
-- co przyjecie.
--
-- TA SAMA REGULA PRZYJECIA, CO WPLATA STRIPE (f2). Zgloszenie wymagajace
-- akceptacji czeka na organizatora (`approval_required`) - po przyjeciu przez
-- organizatora (`approved/unpaid`) odbior przechodzi bez liczenia miejsc,
-- bo miejsce juz jest. Brak miejsca to `sold_out` BEZ zdjecia biletu z puli:
-- nie ma pieniedzy, ktore trzeba by zaksiegowac, wiec nie ma powodu stawiac
-- czlonka w kolejce ze zuzytym benefitem (inaczej niz przy wplacie Stripe).
--
-- BLOKADY jak ksiegowanie wplaty: wydarzenie -> bilet -> zgloszenie (odczyt
-- wlasnosci bez blokady, potem wiersz ponownie pod blokada).
CREATE OR REPLACE FUNCTION public.event_registration_redeem_plan_ticket(p_registration_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.public_tenant_id();
  v_reg_id uuid;
  v_event_id uuid;
  v_ticket_id uuid;
  v_reg public.event_registrations;
  v_event public.events;
  v_ticket public.event_ticket_types;
  v_next text;
  v_claim jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'account_required');
  END IF;

  -- ZGLOSZENIE WOLAJACEGO. Benefit nalezy do osoby zgloszenia, nie do tego,
  -- kto je zalozyl - ta sama regula co `event_registration_claim_plan_seat`.
  SELECT r.id, r.event_id, r.ticket_type_id INTO v_reg_id, v_event_id, v_ticket_id
  FROM public.event_registrations r
  JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
  WHERE r.id = p_registration_id
    AND r.tenant_id = v_tenant
    AND p.user_id = v_uid;

  IF v_reg_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- Pula miejsc: wydarzenie, potem bilet, potem wiersz zgloszenia.
  SELECT e.* INTO v_event FROM public.events e
  WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  FOR UPDATE;
  SELECT t.* INTO v_ticket FROM public.event_ticket_types t
  WHERE t.id = v_ticket_id AND t.tenant_id = v_tenant
  FOR UPDATE;
  SELECT r.* INTO v_reg FROM public.event_registrations r
  WHERE r.id = v_reg_id AND r.tenant_id = v_tenant
  FOR UPDATE;

  -- Pula pokrywa wylacznie wlasne miejsce czlonka - nie miejsce goscia.
  IF v_reg.group_lead_registration_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_eligible');
  END IF;
  -- Te same stany, z ktorych organizator moze zaksiegowac wplate (akcja `paid`).
  IF v_reg.status NOT IN ('draft', 'pending', 'waitlist', 'approved') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'registration_closed');
  END IF;
  IF v_reg.payment_status <> 'unpaid' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_settled');
  END IF;
  -- Nieoplaceni goscie: jedno zamowienie za cala grupe (kasa + bilet z puli
  -- na miejscu prowadzacego). Pula nie oplaca gosci - patrz 20260926140000.
  IF EXISTS (
    SELECT 1 FROM public.event_registrations g
    WHERE g.group_lead_registration_id = v_reg.id
      AND g.tenant_id = v_tenant
      AND g.status NOT IN ('cancelled', 'rejected')
      AND g.payment_status = 'unpaid'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'group_order');
  END IF;

  -- Te same odmowy co kasa (`event_ticket_checkout_quote`), poza kodem dostepu
  -- i ranga: te sprawdzil zapis, ktory to zgloszenie zalozyl.
  IF v_event.status IS DISTINCT FROM 'published' OR v_event.cancelled_at IS NOT NULL
     OR v_ticket.id IS NULL OR NOT v_ticket.is_active THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ticket_not_available');
  END IF;
  IF v_event.starts_at IS NOT NULL AND v_event.starts_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'event_finished');
  END IF;
  IF v_ticket.sales_from IS NOT NULL AND now() < v_ticket.sales_from THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sales_not_open');
  END IF;
  IF v_ticket.sales_to IS NOT NULL AND now() > v_ticket.sales_to THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sales_closed');
  END IF;

  -- PRZYJECIE PRZED PULA (f2). `approved` zostaje `approved` - organizator
  -- juz przyjal i miejsce jest liczone.
  v_next := public._event_registration_paid_admission(v_reg, v_reg.ticket_type_id);
  IF v_next = 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'approval_required');
  END IF;
  IF v_next <> 'approved' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sold_out');
  END IF;

  -- BILET Z PULI - ta sama funkcja i ta sama regula co miejsce prowadzacego
  -- w zamowieniu grupowym (blokady puli, okno roku, jeden bilet na wydarzenie;
  -- bilet juz zajety dla tego wydarzenia wraca jako `reused`).
  v_claim := public.event_registration_claim_plan_seat(v_reg.id, false);
  IF (v_claim ->> 'claimed')::boolean IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'reason', v_claim ->> 'reason');
  END IF;

  -- ROZLICZENIE = PRZYJECIE, jak wynik `paid` z kasy. `paid`, nie
  -- `not_required`: `event_register_group_guests` przyjmuje gosci do
  -- prowadzacego `not_required` z JEGO statusem platnosci i kodem QR - czyli
  -- za darmo. Kod QR jest zastepczy: jawny wyda `_event_issue_ticket_codes`
  -- razem z mailem.
  UPDATE public.event_registrations r SET
    payment_status = 'paid',
    paid_at = COALESCE(r.paid_at, now()),
    status = 'approved',
    waitlist_position = NULL,
    decided_at = COALESCE(r.decided_at, now()),
    decision_source = COALESCE(r.decision_source, 'system'),
    qr_token_hash = COALESCE(r.qr_token_hash,
                             encode(digest(public._event_new_qr_token(), 'sha256'), 'hex')),
    qr_issued_at = COALESCE(r.qr_issued_at, now()),
    updated_at = now()
  WHERE r.id = v_reg.id AND r.tenant_id = v_tenant;

  -- Bilet z puli ROZLICZYL to zgloszenie (bez zamowienia) - ponowne
  -- przyjecie po odwolaniu przywraca go jak bilet oplaconej kasy
  -- (`_event_plan_seat_settle`). Bilet sciezki RSVP (bez zgloszenia) nie.
  UPDATE public.plan_ticket_claims c SET redeemed_at = now()
   WHERE c.registration_id = v_reg.id AND c.released_at IS NULL;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_registration',
    v_reg.id::text,
    'event.registration.payment.v1',
    jsonb_build_object('event_id', v_reg.event_id, 'order_id', NULL, 'outcome', 'paid',
                       'refunded_cents', 0, 'settled_by', 'plan_ticket',
                       'plan_ticket_reused', (v_claim ->> 'reused')::boolean),
    v_uid
  );

  RETURN jsonb_build_object(
    'ok', true,
    'registration_id', v_reg.id,
    'event_id', v_reg.event_id,
    'status', 'approved',
    'payment_status', 'paid',
    'reused', (v_claim ->> 'reused')::boolean
  );
END;
$$;
REVOKE ALL ON FUNCTION public.event_registration_redeem_plan_ticket(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_registration_redeem_plan_ticket(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_registration_redeem_plan_ticket(uuid) IS
  'Bilet z puli planu dla POJEDYNCZEGO zgloszenia etapu 4 (bez gosci do oplacenia), bez Stripe: zgloszenie osoby wolajacej, otwarte i nieoplacone; te same odmowy co kasa (bilet, termin, okno sprzedazy) i ta sama regula przyjecia co wplata (_event_registration_paid_admission: akceptacja -> approval_required, brak miejsca -> sold_out, bez zdjecia biletu z puli); pula przez event_registration_claim_plan_seat. Blokady: wydarzenie, bilet, zgloszenie. Sukces: payment_status paid, status approved, zastepczy kod QR, redeemed_at na bilecie, zdarzenie event.registration.payment.v1 (settled_by plan_ticket). Odmowa nie rzuca i niczego nie zapisuje: {ok:false, reason}.';

-- ============================================================================
-- 10) ZAMOWIENIE PAKIETU: KOLEJNOSC BLOKAD I ZATRZASK TYLKO Z ODDANYM UZYCIEM
-- ============================================================================
-- Cialo z 20260926130000. Zmiany: (1) kod blokowany PRZED zamowieniem - ta
-- sama kolejnosc, co kasowanie kodu z panelu (cykl blokad 40P01 znika);
-- (2) galaz A kasuje realizacje tylko razem z uzyciem, ktore naprawde zdejmuje
-- z licznika kodu najemcy, i dopiero wtedy stawia zatrzask. Jednorazowe
-- dopiecie `_event_package_coupon_link_backfill` juz przebieglo (0060) i nie
-- jest wolane ponownie - zostaje bez zmian.
CREATE OR REPLACE FUNCTION public.admin_event_package_order_set_status(p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_status text := lower(btrim(COALESCE(p_payload->>'status', '')));
  v_order public.event_package_orders;
  v_latch timestamptz;
  v_coupon_id uuid;
  v_per_user integer;
BEGIN
  IF v_status NOT IN ('pending', 'paid', 'cancelled', 'refunded') THEN
    RAISE EXCEPTION 'invalid_status: unknown order status';
  END IF;

  -- KOLEJNOSC BLOKAD: NAJPIERW KOD, potem zamowienie (20260926180000).
  -- Kasowanie kodu z panelu blokuje wiersz kodu, a jego klucze obce kasuja
  -- realizacje i zeruja `coupon_id` zamowienia - czyli ida kod -> realizacja
  -- -> zamowienie. Zmiana statusu szla odwrotnie (zamowienie -> realizacja ->
  -- kod) i obie sesje potrafily czekac na siebie nawzajem (40P01). Odczyt
  -- `coupon_id` bez blokady wystarcza: jedyna zmiana w miedzyczasie to
  -- wyzerowanie przez skasowanie kodu, a galezie nizej obsluguja NULL.
  -- Zakup (rodzaj, pakiet, kod, NOWE zamowienie) i `redeem_b2b_coupon`
  -- (sam kod) nie tworza z ta kolejnoscia cyklu.
  PERFORM 1 FROM public.b2b_coupons c
  WHERE c.id = (SELECT o.coupon_id FROM public.event_package_orders o
                WHERE o.id = v_id AND o.tenant_id = v_tenant)
    AND c.tenant_id = v_tenant
  FOR UPDATE OF c;

  SELECT * INTO v_order
  FROM public.event_package_orders o
  WHERE o.id = v_id AND o.tenant_id = v_tenant
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'not_found: order does not exist in this tenant';
  END IF;

  v_latch := v_order.coupon_released_at;

  IF v_status = 'cancelled' AND v_order.status <> 'cancelled' THEN
    -- A. WEJSCIE W ANULOWANIE. Kasujemy realizacje wskazujaca TO zamowienie
    -- i zdejmujemy ja z licznika jej kodu. GREATEST, bo licznik bywal
    -- poprawiany recznie, a ujemna liczba uzyc otworzylaby kod ponad limit.
    -- Realizacja niepowiazana (stare dane) nie jest tu widoczna - wtedy nic
    -- nie oddajemy i zatrzask zostaje pusty, wiec powrot niczego nie zuzyje.
    --
    -- Realizacja zamowienia jest co najwyzej jedna (unikat
    -- `b2b_coupon_redemptions_package_order_key`). Kasujemy ja TYLKO razem
    -- z uzyciem, ktore da sie zdjac z licznika kodu tego najemcy - inaczej
    -- wiersz realizacji znikal, licznik zostawal, a zatrzask stawal mimo to,
    -- i powrot z anulowania nie mial juz czego odtworzyc (licznik o jeden
    -- wyzej niz rejestr, na zawsze).
    DELETE FROM public.b2b_coupon_redemptions r
    WHERE r.package_order_id = v_id AND r.tenant_id = v_tenant
      AND EXISTS (SELECT 1 FROM public.b2b_coupons c
                  WHERE c.id = r.coupon_id AND c.tenant_id = v_tenant)
    RETURNING r.coupon_id INTO v_coupon_id;

    IF FOUND THEN
      UPDATE public.b2b_coupons c
      SET redemptions_count = GREATEST(0, c.redemptions_count - 1), updated_at = now()
      WHERE c.id = v_coupon_id AND c.tenant_id = v_tenant;
      v_latch := now();
    END IF;

  ELSIF v_status <> 'cancelled' AND v_order.status = 'cancelled'
        AND v_order.coupon_released_at IS NOT NULL THEN
    -- B. POWROT Z ANULOWANIA, KTORE ODDALO UZYCIE. Te same kroki co zuzycie
    -- w zakupie (blokada kodu, limit na osobe PRZED licznikiem, warunkowy
    -- UPDATE licznika, wiersz realizacji z user_id) - bez `active` i okna
    -- waznosci: rabat jest juz w `amount_cents`, to nie jest nowe uzycie.
    IF v_order.coupon_id IS NOT NULL THEN
      SELECT c.id, c.max_redemptions_per_user INTO v_coupon_id, v_per_user
      FROM public.b2b_coupons c
      WHERE c.id = v_order.coupon_id AND c.tenant_id = v_tenant
      FOR UPDATE;
    END IF;

    -- Kodu nie ma (skasowany - klucz obcy wyzerowal `coupon_id`) albo nie
    -- nalezy do najemcy zamowienia: nie ma czego zuzyc, zatrzask i tak znika.
    IF v_coupon_id IS NOT NULL THEN
      -- Zamowienie bez konta kupujacego (konto usuniete) nie ma osoby, ktorej
      -- limit dalo by sie policzyc - `r.user_id = NULL` nie trafia w nic.
      IF v_per_user IS NOT NULL AND (
           SELECT count(*)
           FROM public.b2b_coupon_redemptions r
           WHERE r.coupon_id = v_coupon_id AND r.user_id = v_order.buyer_user_id
             AND r.tenant_id = v_tenant
         ) >= v_per_user THEN
        RAISE EXCEPTION 'coupon_restore_used_by_buyer: the buyer already used this code in another order';
      END IF;

      UPDATE public.b2b_coupons c
      SET redemptions_count = c.redemptions_count + 1, updated_at = now()
      WHERE c.id = v_coupon_id AND c.tenant_id = v_tenant
        AND (c.max_redemptions IS NULL OR c.redemptions_count < c.max_redemptions);
      IF NOT FOUND THEN
        RAISE EXCEPTION 'coupon_restore_exhausted: the code has no use left to give back to this order';
      END IF;

      INSERT INTO public.b2b_coupon_redemptions (
        tenant_id, coupon_id, order_id, user_id, applied_cents, original_cents, currency,
        package_order_id
      ) VALUES (
        v_tenant, v_coupon_id, NULL, v_order.buyer_user_id, v_order.discount_cents,
        v_order.amount_cents + v_order.discount_cents, v_order.currency,
        v_id
      );
    END IF;

    v_latch := NULL;
  END IF;

  -- Zatrzask w TYM SAMYM UPDATE co status: CHECK
  -- `event_package_orders_coupon_released_stamp` nie dopuszcza zatrzasku na
  -- zamowieniu, ktore nie jest anulowane - nawet na chwile.
  UPDATE public.event_package_orders o SET
    status = v_status,
    paid_at = CASE WHEN v_status IN ('paid', 'refunded') THEN COALESCE(o.paid_at, now()) END,
    cancelled_at = CASE WHEN v_status = 'cancelled' THEN COALESCE(o.cancelled_at, now()) END,
    coupon_released_at = v_latch
  WHERE o.id = v_id AND o.tenant_id = v_tenant;

  -- Anulowane zamowienie nie moze trzymac zaproszen, ktore ktos jeszcze przyjmie.
  IF v_status = 'cancelled' THEN
    UPDATE public.event_package_seats s SET
      revoked_at = now(),
      invite_email = NULL,
      invite_token_hash = NULL
    WHERE s.package_order_id = v_id
      AND s.tenant_id = v_tenant
      AND s.registration_id IS NULL
      AND s.revoked_at IS NULL;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_package_order_set_status(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_package_order_set_status(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_package_order_set_status(jsonb) IS
  'Zmiana statusu zamowienia pakietu (pending, paid, cancelled, refunded) przez administratora najemcy. Wejscie w cancelled wycofuje wolne miejsca i ODDAJE powiazane uzycie kodu rabatowego (zatrzask coupon_released_at); powrot z anulowania zuzywa je z powrotem albo odmawia (coupon_restore_used_by_buyer, coupon_restore_exhausted) i wtedy nie zmienia niczego. refunded zatrzymuje uzycie. Blokady: kod, potem zamowienie - ta sama kolejnosc, co kasowanie kodu.';
