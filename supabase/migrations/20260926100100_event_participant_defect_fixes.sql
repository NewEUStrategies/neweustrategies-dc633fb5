-- ============================================================================
-- FUNKCJE UCZESTNIKA F1-F5: NAPRAWY D0 (spec B.3.2, decyzje D0-2, D0-4).
--
-- events-harness: include
--
-- PO CO. Trzy defekty, na ktorych staja funkcje uczestnika, musza zniknac
-- ZANIM tory A/B/C zaczna na nich budowac:
--
--   1. `event_my_agenda` (ostatnia definicja 20260828085309) czytala
--      `r.name_pl`/`r.name_en` z `event_rooms`, ktore ma WYLACZNIE `name`
--      (i `floor`) - kazde wywolanie z sala padalo na 42703 (plpgsql rozwiazuje
--      kolumny przy wykonaniu, wiec migracja przeszla). Dodatkowo zwracala
--      `stream_url` (link do transmisji w odpowiedzi osobistej, D7), nie
--      oznaczala sesji odwolanych i pokazywala szkice.
--   2. `payments_apply_event_ticket_outcome` (20260830110000): pelny zwrot
--      odwolywal zgloszenie, ale ZOSTAWIAL `qr_token_hash` - a
--      `event_checkin_record` szuka zgloszenia wylacznie po skrocie kodu i nie
--      sprawdza statusu. Zwrocony bilet wpuszczal przy bramce. Konto
--      posiadacza zostawalo tez zapisane na sesje (miejsca nie wracaly do
--      kolejki), z zakladkami planu i ze starsza rezerwacja RSVP 'going'.
--   3. `_event_apply_outcome_to_group` (20260922230000): ta sama luka dla
--      gosci grupy przy zwrocie zamowienia prowadzacego.
--
-- ZASADA REDEFINICJI (A.6 R-SQL). Kazde cialo jest SKOPIOWANE W CALOSCI
-- z ostatniej definicji, a kazda zmiana jest oznaczona `-- ZMIANA (PF-F): <slug>`.
-- Kazdy slug ma nazwana asercje `PF-F ZMIANA <slug>` w
-- `scripts/events-harness/runtime_test.d/14_participant_defect_fixes.sql`.
-- Po tej migracji `payments_apply_event_ticket_outcome`
-- i `_event_apply_outcome_to_group` przechodza pod wlasnosc toru B (A.4),
-- ktory dopisuje do tych samych cial odmowy macierzy zwrotow.
--
-- KOLEJNOSC BLOKAD (A.3): zwrot blokuje zamowienie -> zgloszenie (-> trigger
-- grupy: zgloszenia gosci) -> `event_sessions` (w `_event_participant_release`,
-- ostatni szczebel). Zadna funkcja nie cofa sie po drabinie.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) event_my_agenda (D0-4)
-- LOCKS: none (read only).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_my_agenda(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_slug text := NULLIF(btrim(COALESCE(p_payload->>'slug','')), '');
  v_event uuid;
  v_tz text;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to see your agenda';
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'invalid_tenant: unknown host';
  END IF;
  IF v_slug IS NULL THEN
    RAISE EXCEPTION 'invalid_slug: event slug is required';
  END IF;

  -- ZMIANA (PF-F): agenda-timezone - strefa wydarzenia czytana razem z id
  -- i podawana przez _event_safe_timezone (bledna nazwa -> Europe/Warsaw).
  SELECT e.id, public._event_safe_timezone(e.timezone) INTO v_event, v_tz
  FROM public.events e
  WHERE e.tenant_id = v_tenant AND e.slug = v_slug
  LIMIT 1;

  IF v_event IS NULL THEN
    RETURN jsonb_build_object('sessions', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.starts_at NULLS LAST, x.title_pl), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      s.id AS session_id,
      s.title_pl,
      s.title_en,
      s.starts_at,
      s.ends_at,
      s.format,
      -- ZMIANA (PF-F): agenda-no-stream-url - `s.stream_url` usuniety z odpowiedzi
      -- osobistej (D7: plan nigdy nie zwraca linku transmisji).
      -- ZMIANA (PF-F): agenda-room-name - sala ma kolumny `name` i `floor`;
      -- `room_name_pl`/`room_name_en` zostaja dla zgodnosci (oba = r.name).
      r.name AS room_name,
      r.floor AS room_floor,
      r.name AS room_name_pl,
      r.name AS room_name_en,
      -- ZMIANA (PF-F): agenda-session-status - status i stempel odwolania sesji,
      -- zeby UI oznaczalo sesje odwolane zamiast je ukrywac.
      s.status AS session_status,
      s.cancelled_at,
      v_tz AS timezone,
      t.id AS track_id,
      t.name_pl AS track_name_pl,
      t.name_en AS track_name_en,
      g.status AS signup_status,
      g.registered_at
    FROM public.event_session_signups g
    JOIN public.event_sessions s
      ON s.id = g.session_id AND s.tenant_id = g.tenant_id
    LEFT JOIN public.event_rooms r
      ON r.id = s.room_id AND r.tenant_id = s.tenant_id
    LEFT JOIN public.event_tracks t
      ON t.id = s.track_id AND t.tenant_id = s.tenant_id
    WHERE g.tenant_id = v_tenant
      AND g.event_id = v_event
      AND g.user_id = v_uid
      AND COALESCE(g.status, 'registered') <> 'cancelled'
      -- ZMIANA (PF-F): agenda-visibility-filter - szkice ukryte, odwolane
      -- widoczne (z etykieta); prywatne wedlug reguly widocznosci agendy.
      AND s.status IN ('published', 'cancelled')
      AND (s.is_private = false OR g.status IS NOT NULL)
  ) x;

  RETURN jsonb_build_object('sessions', v_rows);
END;
$function$;
-- ZMIANA (PF-F): agenda-comment - komentarz funkcji (wczesniej brak).
COMMENT ON FUNCTION public.event_my_agenda(jsonb) IS
  'Moja agenda na wydarzeniu: sesje, na ktore konto jest zapisane (registered/waitlist). Sala z event_rooms.name/floor, status sesji (odwolane oznaczone, szkice ukryte), strefa wydarzenia; bez stream_url (D0-4).';

REVOKE ALL ON FUNCTION public.event_my_agenda(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_my_agenda(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.event_my_agenda(jsonb) TO service_role;

-- ----------------------------------------------------------------------------
-- 2) payments_apply_event_ticket_outcome (D0-2) - cialo z 20260830110000
-- LOCKS: payment_orders (FOR UPDATE) -> event_registrations (FOR UPDATE)
--        -> [trigger grupy: zgloszenia gosci] -> event_sessions (release).
-- ----------------------------------------------------------------------------
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
        -- ZMIANA (PF-F): refund-clears-qr - pelny zwrot uniewaznia kod wejscia
        -- (D0-2). `event_checkin_record` szuka zgloszenia WYLACZNIE po
        -- `qr_token_hash` i nie sprawdza statusu, wiec kod zwroconego biletu
        -- wpuszczalby przy bramce.
        qr_token_hash = NULL,
        qr_issued_at = NULL,
        updated_at = now()
    WHERE r.id = v_reg.id;

    v_promoted := public._event_waitlist_promote(
      v_order.tenant_id, v_event_id, COALESCE(v_ticket_type_id, v_reg.ticket_type_id), 1);

    -- ZMIANA (PF-F): refund-releases-participant - po odwolaniu zgloszenia
    -- konto posiadacza traci zapisy na sesje (z awansem z kolejki), zakladki
    -- planu i starsza rezerwacje RSVP (D0-2, D7). Kolejnosc blokad A.3:
    -- `event_sessions` jest ostatnim szczeblem, a zgloszenie jest juz zapisane.
    PERFORM public._event_participant_release(
      v_order.tenant_id, v_event_id,
      (SELECT p.user_id FROM public.event_people p WHERE p.id = v_reg.person_id),
      'refunded');
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
-- ZMIANA (PF-F): payments-comment - komentarz opisuje skutki pelnego zwrotu (D0-2).
COMMENT ON FUNCTION public.payments_apply_event_ticket_outcome(uuid, text, integer) IS
  'Przenosi wynik platnosci na zgloszenie. Dopasowanie po metadata.registration_id, gdy jest obecne. Kod QR powstaje TYLKO dla wiersza, ktory bedzie wpuszczany (event_checkin_record nie sprawdza statusu). Druga wplata na to samo zgloszenie i zwrot z cudzego zamowienia sa jawnie odrzucane. Pelny zwrot czysci kod QR i zwalnia zapisy na sesje, zakladki planu oraz starsza rezerwacje RSVP posiadacza (D0-2).';

REVOKE ALL ON FUNCTION public.payments_apply_event_ticket_outcome(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payments_apply_event_ticket_outcome(uuid, text, integer) TO service_role;

-- ----------------------------------------------------------------------------
-- 3) _event_apply_outcome_to_group (D0-2) - cialo z 20260922230000
-- LOCKS: event_registrations gosci (FOR UPDATE) -> event_sessions (release).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_apply_outcome_to_group(p_lead_id uuid, p_order_id uuid, p_outcome text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions','pg_temp'
AS $$
DECLARE
  g public.event_registrations;
  v_token text;
  v_n integer := 0;
  v_guest_user uuid;
BEGIN
  FOR g IN SELECT * FROM public.event_registrations r
    WHERE r.group_lead_registration_id = p_lead_id FOR UPDATE LOOP
    IF p_outcome = 'paid' THEN
      IF g.status IN ('cancelled','rejected') THEN CONTINUE; END IF;
      v_token := public._event_new_qr_token();
      UPDATE public.event_registrations r SET
        payment_order_id = p_order_id, payment_status = 'paid',
        paid_at = COALESCE(r.paid_at, now()),
        status = CASE WHEN r.status IN ('draft','pending','waitlist') THEN 'approved' ELSE r.status END,
        waitlist_position = NULL,
        decided_at = COALESCE(r.decided_at, now()),
        decision_source = COALESCE(r.decision_source, 'system'),
        qr_token_hash = COALESCE(r.qr_token_hash, encode(digest(v_token,'sha256'),'hex')),
        qr_issued_at = COALESCE(r.qr_issued_at, now()),
        updated_at = now()
      WHERE r.id = g.id;
    ELSIF p_outcome = 'refunded' THEN
      UPDATE public.event_registrations r SET
        payment_order_id = p_order_id, payment_status = 'refunded', paid_at = NULL,
        status = 'cancelled', cancelled_at = COALESCE(r.cancelled_at, now()),
        waitlist_position = NULL,
        decided_at = COALESCE(r.decided_at, now()),
        decision_source = COALESCE(r.decision_source, 'system'),
        -- ZMIANA (PF-F): group-refund-clears-qr - kod wejscia goscia traci
        -- waznosc razem z biletem prowadzacego (D0-2).
        qr_token_hash = NULL,
        qr_issued_at = NULL,
        updated_at = now()
      WHERE r.id = g.id;
      -- ZMIANA (PF-F): group-refund-releases-guests - konto goscia (jesli jest)
      -- traci zapisy na sesje, zakladki i starsza rezerwacje RSVP.
      SELECT p.user_id INTO v_guest_user
        FROM public.event_people p
       WHERE p.id = g.person_id AND p.tenant_id = g.tenant_id;
      IF v_guest_user IS NOT NULL THEN
        PERFORM public._event_participant_release(g.tenant_id, g.event_id, v_guest_user, 'refunded');
      END IF;
    ELSIF p_outcome = 'partial_refund' THEN
      UPDATE public.event_registrations r SET payment_order_id = p_order_id,
        payment_status = 'partially_refunded', updated_at = now() WHERE r.id = g.id;
    ELSE
      UPDATE public.event_registrations r SET payment_order_id = p_order_id,
        payment_status = 'unpaid', updated_at = now()
      WHERE r.id = g.id AND r.payment_status <> 'paid';
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
-- ZMIANA (PF-F): group-comment - komentarz funkcji (wczesniej brak).
COMMENT ON FUNCTION public._event_apply_outcome_to_group(uuid, uuid, text) IS
  'Przenosi wynik platnosci prowadzacego na gosci grupy (trigger event_registrations_group_follow_lead). Zwrot czysci kody QR gosci i zwalnia ich zapisy na sesje, zakladki i starsza rezerwacje RSVP (D0-2).';
REVOKE ALL ON FUNCTION public._event_apply_outcome_to_group(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
-- ZMIANA (PF-F): group-grant-service-role - jawny GRANT (A.6 R-SQL); wolajacy
-- trigger jest SECURITY DEFINER, wiec zachowanie sie nie zmienia.
GRANT EXECUTE ON FUNCTION public._event_apply_outcome_to_group(uuid, uuid, text) TO service_role;
