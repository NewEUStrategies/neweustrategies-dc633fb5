-- Braki modulu Wydarzen, czesc 3: zawiadomienie gosci o odwolanym bilecie,
-- awans kolejki za gosci zwroconych, bilet z puli planu idzie za zgloszeniem
-- (zwrot do puli i odbior dla pojedynczego zgloszenia), wplata Stripe przy
-- wyczerpanej puli, poprawki przegladu czesci 2.
-- events-harness: include
--
-- CO ROBI TA MIGRACJA (sekcje nizej, kazda z wlasna PRZYCZYNA i opisem):
--   1) `ticket_revoked_at` - znacznik zawiadomienia gosci, do ktorych bilet
--      dotarl, gdy grupe odwolano (odrzucenie/anulowanie prowadzacego, zwrot).
--   2) `_event_waitlist_promote(..., _skip_group)` i
--      `_event_group_promote_freed(..., p_skip_group)` - awans z pominieciem
--      wlasnej grupy; kazdy awans kasuje `waitlist_notified_at`.
--   3) Gosc zwrocony czesciowo wraca z prowadzacym przy ponownym przyjeciu
--      (zwrot czesciowy to korekta ceny - miejsce i kod zostaja).
--   4) Kaskada statusu prowadzacego stempluje zawiadomienie.
--   5) Wynik platnosci na gosciach: zwrot awansuje kolejke za zwolnione
--      miejsca gosci (po petli, bez wlasnej grupy) i stempluje zawiadomienie;
--      wplata nie przyjmuje gosci, dopoki prowadzacy nie ma miejsca.
--   6) Zajecie i rozliczenie partii zawiadomien (cron: `jobs-tick`,
--      `community-cron` -> `event_ticket_revoked` przez `sendTxEmail`).
--   7) Wydanie biletu takze dla zgloszen zwroconych czesciowo.
--   8) Bilet z puli planu nalezy do zgloszenia (`registration_id`) i wraca do
--      puli, gdy zgloszenie go nie potrzebuje (trigger, wynik `unpaid`,
--      przeglad porzuconych kas); czlonek nie zwalnia biletu zgloszenia sam.
--      f2/g: wplata Stripe liczy miejsce pod blokada wydarzenia i biletu -
--      brak miejsca to kolejka OPLACONA zamiast wywroconego ksiegowania,
--      bilet z akceptacja zostaje `pending` oplacony.
--   9) `event_registration_redeem_plan_ticket` - odbior biletu z puli dla
--      pojedynczego zgloszenia (bez Stripe), ta sama regula przyjecia.
--  10) Zamowienie pakietu: kod blokowany przed zamowieniem, zatrzask tylko
--      z naprawde oddanym uzyciem.
--
-- MIGRACJA NIKOGO NIE POWIADAMIA. Jednorazowo (bez poczty): dopiecie biletow
-- z puli do zgloszen i zwolnienie biletow porzuconych kas, znacznik
-- wyslanego biletu dla zgloszen zwroconych czesciowo, ktore go nie mialy,
-- zadanie pg_cron `event-plan-seat-release` (gdy rozszerzenie jest).
--
-- KOLEJNOSC TRIGGEROW `event_registrations` (AFTER, po nazwie): platnosc
-- (`group_follow_lead`) -> bilet z puli (`plan_seat_follow`) -> zwolnienie
-- miejsc na sali (`release_seats`, 20260927000400) -> przelicznik
-- `sold_count` -> kaskada statusu (`zz_group_follow_lead_status`).
--
-- NUMER 20260926180000: ta migracja biegnie PO funkcjach uczestnika
-- (20260926153200), ktore redefiniuja `payments_apply_event_ticket_outcome`
-- i `_event_apply_outcome_to_group`. Ostatnia definicja wygrywa, wiec oba
-- ciala nizej niosa tez naprawy D0-2 stamtad (znaczniki `ZMIANA (PF-F)`).

-- ============================================================================
-- 1) ZNACZNIK ODWOLANEGO BILETU GOSCIA (zawiadomienie event_ticket_revoked)
-- ============================================================================
-- Niepusty `ticket_revoked_at` = zawiadomienie czeka. Stawia go TA SAMA
-- instrukcja, ktora zamyka goscia (kaskada statusu i galaz zwrotu), wylacznie
-- gosciowi, do ktorego bilet dotarl albo byl w drodze. Wartosc jest
-- tozsamoscia zawiadomienia (klucz idempotencji maila); kasuje ja rozliczenie
-- wysylki albo zamkniecie bez maila.
ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS ticket_revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS ticket_revoked_notice_claimed_at timestamptz;

COMMENT ON COLUMN public.event_registrations.ticket_revoked_at IS
  'Chwila, w ktorej gosc grupy stracil bilet, ktory do niego dotarl (albo byl w drodze), bo grupe odwolano: odrzucenie/anulowanie prowadzacego albo zwrot. Niepusty = zawiadomienie event_ticket_revoked czeka. Kasuje go rozliczenie wysylki (_event_ticket_revoked_notices_settle) albo zamkniecie bez maila (wydarzenie minelo, uczestnik wylaczyl maile). Wartosc jest tozsamoscia zawiadomienia (klucz idempotencji).';
COMMENT ON COLUMN public.event_registrations.ticket_revoked_notice_claimed_at IS
  'Dzierzawa wysylki zawiadomienia o odwolanym bilecie (15 minut) - chwila zajecia przez _event_ticket_revoked_notices_claim; rozliczenie dotyczy tylko TEGO zajecia.';

CREATE INDEX IF NOT EXISTS event_registrations_ticket_revoked_idx
  ON public.event_registrations (ticket_revoked_at, id)
  WHERE ticket_revoked_at IS NOT NULL;

-- Czy bilet dotarl do goscia (albo byl w drodze). Liczone na wierszu SPRZED
-- zamkniecia: wyrazenia SET widza stary wiersz, a trigger
-- `event_registrations_ticket_code_reset` kasuje znaczniki wysylki dopiero
-- w wierszu wynikowym. Adres, ktorego poczta nie przyjela, zawiadomienia nie
-- dostaje; gosc czekajacy albo nieoplacony nie dostal od nas zadnego maila.
CREATE OR REPLACE FUNCTION public._event_guest_ticket_reached(p_reg public.event_registrations)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(
    p_reg.status = 'approved'
    AND p_reg.ticket_code_undeliverable_at IS NULL
    AND (p_reg.ticket_code_sent_at IS NOT NULL OR p_reg.ticket_code_claimed_at IS NOT NULL),
    false);
$$;
REVOKE ALL ON FUNCTION public._event_guest_ticket_reached(public.event_registrations)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._event_guest_ticket_reached(public.event_registrations) IS
  'Czy bilet dotarl do zgloszenia albo byl w drodze: przyjete, adres nie odrzucony, wyslany albo zajety do wysylki. Liczone na wierszu sprzed zamkniecia - decyduje o zawiadomieniu event_ticket_revoked.';

-- ============================================================================
-- 2) AWANS Z KOLEJKI Z POMINIECIEM GRUPY
-- ============================================================================
-- Piecioargumentowy wariant z cialem z 20260824085828 i dwiema zmianami:
-- pominiecie zgloszenia `_skip_group` i jego gosci oraz skasowanie
-- `waitlist_notified_at` przy awansie (nowy awans = nowe powiadomienie; bez
-- tego wiersz awansowany drugi raz nie wracal do plakietki panelu).
--
-- BEZ WARTOSCI DOMYSLNYCH. Czteroargumentowy wariant ma domyslne
-- `_ticket_type_id` i `_limit`; piecioargumentowy z domyslnym `_skip_group`
-- zrobilby kazde wywolanie z dwoma-czterema argumentami NIEJEDNOZNACZNYM.
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
  v_promoted jsonb := '[]'::jsonb;
BEGIN
  IF _tenant IS NULL OR _event_id IS NULL THEN
    RETURN jsonb_build_object('promoted', 0, 'registrations', '[]'::jsonb);
  END IF;

  -- Blokada serializujaca. Bilet gdy podany, w przeciwnym razie wydarzenie -
  -- to samo, na czym serializuje sie zapis publiczny.
  IF _ticket_type_id IS NOT NULL THEN
    PERFORM 1 FROM public.event_ticket_types t
    WHERE t.id = _ticket_type_id AND t.tenant_id = _tenant AND t.event_id = _event_id
    FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.events e
    WHERE e.id = _event_id AND e.tenant_id = _tenant
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
    WHERE r.id = v_row.id AND r.tenant_id = _tenant AND r.status = 'waitlist';

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
  'Promuje osoby z listy rezerwowej na zwolnione miejsca (blokada biletu albo wydarzenia, potem liczenie miejsc przed kazdym awansem), z pominieciem zgloszenia _skip_group i jego gosci (NULL = bez pominiecia). Awans kasuje waitlist_notified_at. Zwraca promowane wiersze - wysylka nalezy do warstwy znajacej jezyk odbiorcy.';

-- Sygnatura, wartosci domyslne i uprawnienia bez zmian - wolaja ja
-- `admin_event_waitlist_promote`, `admin_event_registration_decide`,
-- `payments_apply_event_ticket_outcome` i `_event_group_promote_freed`.
-- Zmiana jezyka (plpgsql -> sql) przez CREATE OR REPLACE jest dozwolona.
CREATE OR REPLACE FUNCTION public._event_waitlist_promote(
  _tenant uuid,
  _event_id uuid,
  _ticket_type_id uuid DEFAULT NULL,
  _limit integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT public._event_waitlist_promote(_tenant, _event_id, _ticket_type_id, _limit, NULL::uuid);
$$;

REVOKE ALL ON FUNCTION public._event_waitlist_promote(uuid, uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_waitlist_promote(uuid, uuid, uuid, integer)
  TO service_role;

COMMENT ON FUNCTION public._event_waitlist_promote(uuid, uuid, uuid, integer) IS
  'Promuje osoby z listy rezerwowej na zwolnione miejsca - piecioargumentowy wariant bez pominiecia grupy. Zwraca promowane wiersze - wysylka nalezy do warstwy znajacej jezyk odbiorcy.';

-- Awans za miejsca gosci: cialo z 20260926120000 z przekazaniem
-- `p_skip_group`. Bez wartosci domyslnej - z tego samego powodu, co wyzej.
CREATE OR REPLACE FUNCTION public._event_group_promote_freed(
  p_tenant uuid,
  p_event_id uuid,
  p_ticket_types uuid[],
  p_skip_group uuid
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  f record;
  v_n integer := 0;
BEGIN
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
END $$;
REVOKE ALL ON FUNCTION public._event_group_promote_freed(uuid, uuid, uuid[], uuid)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._event_group_promote_freed(uuid, uuid, uuid[], uuid) IS
  'Awans z kolejki rezerwowej za miejsca zwolnione przez gosci grupy: jeden element tablicy = jedno zwolnione miejsce danego biletu (NULL = bez cennika), z pominieciem zgloszenia p_skip_group i jego gosci (NULL = bez pominiecia). Osobno dla kazdego biletu, przez _event_waitlist_promote. Zwraca liczbe awansowanych.';

CREATE OR REPLACE FUNCTION public._event_group_promote_freed(
  p_tenant uuid,
  p_event_id uuid,
  p_ticket_types uuid[]
)
RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
  SELECT public._event_group_promote_freed(p_tenant, p_event_id, p_ticket_types, NULL::uuid);
$$;
REVOKE ALL ON FUNCTION public._event_group_promote_freed(uuid, uuid, uuid[])
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._event_group_promote_freed(uuid, uuid, uuid[]) IS
  'Awans z kolejki rezerwowej za miejsca zwolnione przez gosci grupy (kaskada statusu) - czteroargumentowy wariant bez pominiecia grupy. Zwraca liczbe awansowanych.';

-- ============================================================================
-- 3) GOSC ZWROCONY CZESCIOWO WRACA Z PROWADZACYM
-- ============================================================================
-- Od 20260926120000 kaskada zamyka takze gosci PRZYJETYCH, a zwrot czesciowy
-- prowadzacego przenosi `partially_refunded` na oplaconych gosci, ktorzy
-- zachowuja miejsce i kod (`payments_apply_event_ticket_outcome`: korekta
-- ceny, nie rezygnacja). Predykat przywrocenia dopuszczal tylko
-- not_required/paid/unpaid, wiec pomylkowe odrzucenie prowadzacego i ponowne
-- przyjecie przywracalo SAMEGO prowadzacego - goscie zostawali odrzuceni
-- z martwym biletem. Pelny zwrot (`refunded`) nadal nie wraca: to juz nie
-- jest korekta ceny.
CREATE OR REPLACE FUNCTION public._event_guest_closed_with_lead(
  p_guest public.event_registrations,
  p_lead public.event_registrations
)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(
    p_guest.group_lead_registration_id = p_lead.id
    AND p_guest.tenant_id = p_lead.tenant_id
    AND p_guest.status = p_lead.status
    AND p_guest.payment_status IN ('not_required', 'paid', 'partially_refunded', 'unpaid')
    AND CASE p_lead.status
      WHEN 'rejected' THEN p_guest.decided_at = p_lead.decided_at
                           AND p_guest.decided_by IS NOT DISTINCT FROM p_lead.decided_by
      WHEN 'cancelled' THEN p_guest.cancelled_at = p_lead.cancelled_at
      ELSE false
    END,
    false);
$$;
REVOKE ALL ON FUNCTION public._event_guest_closed_with_lead(public.event_registrations, public.event_registrations)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._event_guest_closed_with_lead(public.event_registrations, public.event_registrations) IS
  'Czy gosc zostal zamkniety RAZEM z prowadzacym: ten sam status i stempel decyzji (odrzucenie: decided_at + decided_by, anulowanie: cancelled_at), rozliczenie bez pelnego zwrotu (zwrot czesciowy to korekta ceny - gosc wraca). Ponowne przyjecie prowadzacego przywraca wlasnie tych gosci; panel liczy ich przy prowadzacym.';

-- Cialo z 20260926100000. Zmiana: `partially_refunded` jest rozliczeniem
-- (miejsce oplacone), wiec gosc wraca na miejsce albo do kolejki, a nie do
-- `pending` czekajacego na wplate, ktora nigdy nie przyjdzie.
CREATE OR REPLACE FUNCTION public._event_group_admit_guests(
  p_lead public.event_registrations,
  p_prev public.event_registrations
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  g public.event_registrations;
  v_reopen boolean;
BEGIN
  FOR g IN
    SELECT r.* FROM public.event_registrations r
    WHERE r.tenant_id = p_lead.tenant_id
      AND r.group_lead_registration_id = p_lead.id
      AND (r.status IN ('draft', 'pending', 'waitlist')
           OR public._event_guest_closed_with_lead(r, p_prev))
    ORDER BY r.created_at, r.id
    FOR UPDATE
  LOOP
    v_reopen := g.status IN ('rejected', 'cancelled');

    -- Osoba goscia zapisala sie tymczasem sama (albo w innej grupie): drugi
    -- aktywny zapis tej samej osoby wywrocilby CALA decyzje organizatora na
    -- `event_registrations_active_uniq`. Ten gosc zostaje zamkniety.
    IF v_reopen AND EXISTS (
      SELECT 1 FROM public.event_registrations o
      WHERE o.tenant_id = g.tenant_id
        AND o.event_id = g.event_id
        AND o.person_id = g.person_id
        AND o.id <> g.id
        AND o.status NOT IN ('cancelled', 'rejected')
    ) THEN
      CONTINUE;
    END IF;

    -- NIEOPLACONY GOSC CZEKA NA WPLATE, nie na miejsce: `pending` znaczy
    -- tu to samo, co w `event_register` - miejsce nie jest zajete. Przyjmie
    -- go trigger platnosci razem z wplata prowadzacego. Zamkniety razem
    -- z prowadzacym wraca do tego samego stanu, w jakim go dopisano.
    IF g.payment_status NOT IN ('not_required', 'paid', 'partially_refunded') THEN
      IF v_reopen THEN
        UPDATE public.event_registrations r SET
          status = 'pending',
          cancelled_at = NULL,
          waitlist_position = NULL,
          decided_by = NULL,
          decided_at = NULL,
          decision_source = NULL,
          qr_token_hash = NULL,
          qr_issued_at = NULL,
          updated_at = now()
        WHERE r.id = g.id AND r.tenant_id = p_lead.tenant_id;
      END IF;
      CONTINUE;
    END IF;

    PERFORM public._event_group_admit_guest(p_lead, g);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public._event_group_admit_guests(public.event_registrations, public.event_registrations)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._event_group_admit_guests(public.event_registrations, public.event_registrations) IS
  'Przyjecie gosci za przyjetym prowadzacym (p_lead), z przywroceniem gosci zamknietych razem z nim w stanie p_prev: rozliczeni (takze zwrot czesciowy) -> _event_group_admit_guest, nieoplaceni czekaja na wplate (zamknieci wracaja do pending), osoba z innym aktywnym zapisem zostaje zamknieta. Wola ja kaskada statusu i _event_group_repair_stranded_guests.';

-- ============================================================================
-- 4) KASKADA STATUSU STEMPLUJE ZAWIADOMIENIE
-- ============================================================================
-- Cialo z 20260926120000. Zmiana wylacznie w UPDATE gosci: znacznik
-- zawiadomienia (i zdjecie dzierzawy starego) dla gosci, do ktorych bilet
-- dotarl. Gosc zamkniety ponownie ZANIM dotarl do niego nowy bilet zachowuje
-- stary znacznik (ELSE) - niewyslane zawiadomienie nadal wyjdzie, wyslane
-- (znacznik juz pusty) nie wyjdzie drugi raz.
CREATE OR REPLACE FUNCTION public._tg_event_group_follow_lead_status()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_restamp boolean;
  v_freed uuid[];
BEGIN
  -- PRZYJECIE. Z oczekiwania - i z odrzucenia albo anulowania: wtedy wracaja
  -- takze goscie zamknieci RAZEM z prowadzacym (od tej migracji - takze ci,
  -- ktorzy byli juz przyjeci). Pomylkowe odrzucenie i ponowne zatwierdzenie
  -- to zwykly przebieg pracy organizatora.
  IF NEW.status = 'approved'
     AND OLD.status IN ('draft', 'pending', 'waitlist', 'rejected', 'cancelled') THEN
    PERFORM public._event_group_admit_guests(NEW, OLD);

  -- ODRZUCENIE I ANULOWANIE. Goscie, ktorzy czekaja, i goscie JUZ przyjeci -
  -- grupa idzie za decyzja o prowadzacym, a bilet odwolanej grupy nie moze
  -- wpuszczac. `attended`/`no_show` zostaja (fakt z sali). Kolumny ustawiamy
  -- pod CHECK-i: odrzucenie przez organizatora wymaga powodu
  -- (`rejection_has_reason`), anulowanie - daty (`cancelled_dated`). Data
  -- anulowania i chwila decyzji sa STEMPLEM prowadzacego - po nim
  -- `_event_guest_closed_with_lead` rozpozna tych gosci przy ponownym przyjeciu.
  --
  -- KTO ZAMKNAL GOSCIA - tylko ten, kto WLASNIE podjal decyzje (patrz
  -- 20260926100000): bez nowego stempla decyzji gosc dostaje `system` bez
  -- autora i zachowuje wlasna notatke.
  ELSIF NEW.status IN ('rejected', 'cancelled') THEN
    v_restamp := NEW.status = 'rejected' OR NEW.decided_at IS DISTINCT FROM OLD.decided_at;

    -- Bilety przyjetych gosci PRZED zamknieciem - po nim status juz ich nie
    -- odroznia od czekajacych. Blokada w kolejnosci wydania biletow.
    SELECT array_agg(r.ticket_type_id ORDER BY r.created_at, r.id) INTO v_freed
    FROM (
      SELECT g.ticket_type_id, g.created_at, g.id
      FROM public.event_registrations g
      WHERE g.tenant_id = NEW.tenant_id
        AND g.group_lead_registration_id = NEW.id
        AND g.status = 'approved'
      ORDER BY g.created_at, g.id
      FOR UPDATE
    ) r;

    UPDATE public.event_registrations r SET
      status = NEW.status,
      decision_note = CASE
        WHEN v_restamp THEN COALESCE(NEW.decision_note, r.decision_note)
        ELSE r.decision_note
      END,
      decided_by = CASE WHEN v_restamp THEN NEW.decided_by END,
      decided_at = now(),
      decision_source = CASE
        WHEN v_restamp THEN COALESCE(NEW.decision_source, 'system')
        ELSE 'system'
      END,
      cancelled_at = CASE
        WHEN NEW.status = 'cancelled' THEN NEW.cancelled_at
        ELSE r.cancelled_at
      END,
      waitlist_position = NULL,
      qr_token_hash = NULL,
      qr_issued_at = NULL,
      -- ZAWIADOMIENIE (20260926180000): gosc, do ktorego bilet dotarl albo
      -- byl w drodze. Wyrazenie widzi wiersz SPRZED zamkniecia.
      ticket_revoked_at = CASE
        WHEN public._event_guest_ticket_reached(r) THEN now() ELSE r.ticket_revoked_at
      END,
      -- Nowe zawiadomienie zdejmuje dzierzawe starego: rozliczenie starego
      -- zajecia zamknelloby nowe.
      ticket_revoked_notice_claimed_at = CASE
        WHEN public._event_guest_ticket_reached(r) THEN NULL
        ELSE r.ticket_revoked_notice_claimed_at
      END,
      updated_at = now()
    WHERE r.tenant_id = NEW.tenant_id
      AND r.group_lead_registration_id = NEW.id
      AND r.status IN ('draft', 'pending', 'waitlist', 'approved');

    PERFORM public._event_group_promote_freed(NEW.tenant_id, NEW.event_id, v_freed);
  END IF;

  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._tg_event_group_follow_lead_status() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._tg_event_group_follow_lead_status() IS
  'Kaskada statusu prowadzacego grupy na gosci: zatwierdzenie przyjmuje gosci rozliczonych (albo stawia ich w kolejce, gdy brak miejsca) i przywraca gosci zamknietych razem z prowadzacym (_event_group_admit_guests), odrzucenie i anulowanie zamyka gosci czekajacych i przyjetych (kod QR przestaje wpuszczac; attended/no_show zostaja) - ze sladem decydujacego tylko wtedy, gdy ta instrukcja stemplowala decyzje prowadzacego - i promuje kolejke za zwolnione miejsca. Gosciom, do ktorych bilet dotarl, stempluje zawiadomienie o odwolanym bilecie (ticket_revoked_at). Nieoplaconych gosci przyjmuje trigger platnosci.';

-- ============================================================================
-- 5) WYNIK PLATNOSCI NA GOSCIACH: ZWROT AWANSUJE KOLEJKE I ZAWIADAMIA
-- ============================================================================
-- Cialo z 20260926120000. Zmiany w galezi `refunded`: miejsce goscia liczone
-- ze statusu SPRZED zwrotu, skrot kodu QR znika, znacznik zawiadomienia dla
-- goscia, do ktorego bilet dotarl, a po petli awans za zwolnione miejsca
-- z pominieciem wlasnej grupy (naglowek: DLACZEGO Z POMINIECIEM). Awans PO
-- petli - oplacony gosc tej grupy stojacy na czele kolejki jest juz wtedy
-- zwrocony i anulowany.
--
-- NAPRAWY D0-2 Z 20260926153200 (funkcje uczestnika) sa PRZENIESIONE do tego
-- ciala, bo ta migracja biegnie po niej i ostatnia definicja wygrywa: kod QR
-- goscia znika przy zwrocie (to cialo juz go kasowalo), a konto goscia traci
-- zapisy na sesje, zakladki i starsza rezerwacje RSVP
-- (`_event_participant_release`). Znaczniki `ZMIANA (PF-F)` zostaja, asercje
-- sa w runtime_test.d/14_participant_defect_fixes.sql.
CREATE OR REPLACE FUNCTION public._event_apply_outcome_to_group(p_lead_id uuid, p_order_id uuid, p_outcome text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions','pg_temp'
AS $$
DECLARE
  g public.event_registrations;
  v_lead public.event_registrations;
  v_tenant uuid;
  v_token text;
  v_n integer := 0;
  v_freed uuid[] := ARRAY[]::uuid[];
  v_seated boolean;
  v_guest_user uuid;
BEGIN
  SELECT * INTO v_lead FROM public.event_registrations l WHERE l.id = p_lead_id;
  v_tenant := v_lead.tenant_id;
  -- GOSCIE NIE WCHODZA PRZED PROWADZACYM (pozycja 5). Wplata bez miejsca stawia
  -- prowadzacego w kolejce, a bilet z akceptacja - w oczekiwaniu na decyzje.
  -- Goscie sa wtedy tylko rozliczani; przyjmie ich kaskada statusu, gdy
  -- prowadzacy wejdzie na miejsce (awans z kolejki albo decyzja organizatora).
  v_seated := v_lead.status IN ('approved', 'attended', 'no_show');

  FOR g IN SELECT * FROM public.event_registrations r
    WHERE r.group_lead_registration_id = p_lead_id AND r.tenant_id = v_tenant
    ORDER BY r.created_at, r.id
    FOR UPDATE LOOP
    IF p_outcome IN ('refunded', 'partial_refund')
       AND g.payment_status NOT IN ('paid', 'partially_refunded') THEN
      CONTINUE;
    END IF;
    IF p_outcome = 'paid' THEN
      IF g.status IN ('cancelled','rejected') THEN CONTINUE; END IF;
      IF g.status IN ('draft','pending','waitlist') THEN
        UPDATE public.event_registrations r SET
          payment_order_id = COALESCE(p_order_id, r.payment_order_id), payment_status = 'paid',
          paid_at = COALESCE(r.paid_at, now()),
          updated_at = now()
        WHERE r.id = g.id AND r.tenant_id = v_tenant;
        IF v_seated THEN
          UPDATE public.event_ticket_types t SET sold_count = c.cnt
          FROM (
            SELECT count(*)::integer AS cnt
            FROM public.event_registrations x
            WHERE x.tenant_id = v_tenant
              AND x.ticket_type_id = g.ticket_type_id
              AND x.status IN ('approved', 'attended', 'no_show')
          ) c
          WHERE t.id = g.ticket_type_id AND t.tenant_id = v_tenant AND t.sold_count <> c.cnt;
          PERFORM public._event_group_admit_guest(v_lead, g);
        END IF;
      ELSE
        -- Gosc juz przyjety albo obecny: tylko rozliczenie. Kod zostaje (albo
        -- powstaje, gdy przyjecie przyszlo bez niego).
        v_token := public._event_new_qr_token();
        UPDATE public.event_registrations r SET
          payment_order_id = COALESCE(p_order_id, r.payment_order_id), payment_status = 'paid',
          paid_at = COALESCE(r.paid_at, now()),
          waitlist_position = NULL,
          decided_at = COALESCE(r.decided_at, now()),
          decision_source = COALESCE(r.decision_source, 'system'),
          qr_token_hash = COALESCE(r.qr_token_hash, encode(digest(v_token,'sha256'),'hex')),
          qr_issued_at = COALESCE(r.qr_issued_at, now()),
          updated_at = now()
        WHERE r.id = g.id AND r.tenant_id = v_tenant;
      END IF;
    ELSIF p_outcome = 'refunded' THEN
      -- Miejsce zajmowal gosc przyjety albo juz na sali - te same statusy,
      -- ktore liczy `_event_seats_left`. Gosc oplacony w kolejce, wycofany
      -- albo odrzucony miejsca nie trzymal.
      IF g.status IN ('approved', 'attended', 'no_show') THEN
        v_freed := array_append(v_freed, g.ticket_type_id);
      END IF;
      UPDATE public.event_registrations r SET
        payment_order_id = COALESCE(p_order_id, r.payment_order_id),
        payment_status = 'refunded', paid_at = NULL,
        status = 'cancelled', cancelled_at = COALESCE(r.cancelled_at, now()),
        waitlist_position = NULL,
        decided_at = COALESCE(r.decided_at, now()),
        decision_source = COALESCE(r.decision_source, 'system'),
        -- ZMIANA (PF-F): group-refund-clears-qr - kod wejscia goscia traci
        -- waznosc razem z biletem prowadzacego (D0-2).
        qr_token_hash = NULL,
        qr_issued_at = NULL,
        -- Zawiadomienie o odwolanym bilecie (sekcja 1) - wyrazenie widzi
        -- wiersz SPRZED zwrotu, jak w kaskadzie statusu.
        ticket_revoked_at = CASE
          WHEN public._event_guest_ticket_reached(r) THEN now() ELSE r.ticket_revoked_at
        END,
        ticket_revoked_notice_claimed_at = CASE
          WHEN public._event_guest_ticket_reached(r) THEN NULL
          ELSE r.ticket_revoked_notice_claimed_at
        END,
        updated_at = now()
      WHERE r.id = g.id AND r.tenant_id = v_tenant;
      -- ZMIANA (PF-F): group-refund-releases-guests - konto goscia (jesli jest)
      -- traci zapisy na sesje, zakladki i starsza rezerwacje RSVP. Tylko gosc,
      -- ktory zaplacil (warunek na poczatku petli), wiec zwalniamy dokladnie
      -- tych, ktorych zwrot odwolal.
      SELECT p.user_id INTO v_guest_user
        FROM public.event_people p
       WHERE p.id = g.person_id AND p.tenant_id = v_tenant;
      IF v_guest_user IS NOT NULL THEN
        PERFORM public._event_participant_release(v_tenant, g.event_id, v_guest_user, 'refunded');
      END IF;
    ELSIF p_outcome = 'partial_refund' THEN
      UPDATE public.event_registrations r SET
        payment_order_id = COALESCE(p_order_id, r.payment_order_id),
        payment_status = 'partially_refunded', updated_at = now()
      WHERE r.id = g.id AND r.tenant_id = v_tenant;
    ELSE
      UPDATE public.event_registrations r SET
        payment_order_id = COALESCE(p_order_id, r.payment_order_id),
        payment_status = 'unpaid', updated_at = now()
      WHERE r.id = g.id AND r.tenant_id = v_tenant AND r.payment_status <> 'paid';
    END IF;
    v_n := v_n + 1;
  END LOOP;

  -- AWANS ZA MIEJSCA ZWOLNIONE ZWROTEM - PO PETLI, bez wlasnej grupy (patrz
  -- naglowek). Miejsce prowadzacego awansuje wolajacy, po kaskadzie statusu.
  IF cardinality(v_freed) > 0 THEN
    PERFORM public._event_group_promote_freed(v_tenant, v_lead.event_id, v_freed, p_lead_id);
  END IF;

  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public._event_apply_outcome_to_group(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_apply_outcome_to_group(uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public._event_apply_outcome_to_group(uuid, uuid, text) IS
  'Wynik platnosci prowadzacego na gosciach grupy: paid rozlicza czekajacych i - gdy prowadzacy jest na miejscu - przyjmuje ich z kontrola miejsc (_event_group_admit_guest - miejsce albo kolejka, takze na sciezce Stripe), przyjetym tylko rozlicza; refunded anuluje oplaconych, czysci ich kody QR i zwalnia zapisy na sesje, zakladki i starsza rezerwacje RSVP (D0-2), stawia znacznik zawiadomienia tym, do ktorych bilet dotarl, i awansuje kolejke za miejsca, ktore zajmowali, z pominieciem wlasnej grupy; partial_refund i unpaid tylko rozliczaja. Zamowienie trafia do goscia tylko, gdy wynik je przyniosl.';

-- ============================================================================
-- 6) ZAWIADOMIENIA O ODWOLANYM BILECIE: ZAJECIE I ROZLICZENIE PARTII
-- ============================================================================
-- Wzor jak bilety (`_event_issue_ticket_codes` + `_event_ticket_code_confirm`):
-- dzierzawa 15 minut i SKIP LOCKED - minutowy tick i `community-cron` niczego
-- nie dubluja. Jedno zajecie i jedno rozliczenie na partie: dwa RPC zamiast
-- jednego plus dwoch na kazdego goscia.
--
-- Zajecie POMIJA wiersz, ktory znow jest przyjety (przywrocony gosc czeka na
-- nowy bilet - zawiadomienie byloby nieprawda), dopoki wydarzenie trwa.
-- Po wydarzeniu i przy `notify_email = false` zamyka znacznik BEZ maila, zeby
-- indeks czesciowy zostal maly. Wylacznie service_role - wynik niesie adresy.
CREATE OR REPLACE FUNCTION public._event_ticket_revoked_notices_claim(p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_claim timestamptz := clock_timestamp();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 200);
  v_notices jsonb;
BEGIN
  WITH picked AS (
    SELECT reg.id,
           (COALESCE(e.ends_at, e.starts_at + interval '1 day') <= now()
            OR reg.notify_email IS FALSE) AS closes_silently
    FROM public.event_registrations reg
    JOIN public.events e ON e.id = reg.event_id AND e.tenant_id = reg.tenant_id
    WHERE reg.ticket_revoked_at IS NOT NULL
      AND (reg.ticket_revoked_notice_claimed_at IS NULL
           OR reg.ticket_revoked_notice_claimed_at < now() - interval '15 minutes')
      AND (reg.status NOT IN ('approved', 'attended', 'no_show')
           OR COALESCE(e.ends_at, e.starts_at + interval '1 day') <= now())
    ORDER BY reg.ticket_revoked_at, reg.id
    LIMIT v_limit
    FOR UPDATE OF reg SKIP LOCKED
  ), marked AS (
    UPDATE public.event_registrations reg SET
      ticket_revoked_at = CASE WHEN p.closes_silently THEN NULL ELSE reg.ticket_revoked_at END,
      ticket_revoked_notice_claimed_at = CASE WHEN p.closes_silently THEN NULL ELSE v_claim END
    FROM picked p
    WHERE reg.id = p.id
    RETURNING reg.id, reg.tenant_id, reg.event_id, reg.person_id, reg.ticket_type_id,
              reg.group_lead_registration_id, reg.ticket_revoked_at, p.closes_silently
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'registration_id', m.id,
           'tenant_id', m.tenant_id,
           'revoked_at', m.ticket_revoked_at,
           'email', p.email,
           'first_name', p.first_name,
           'lang', COALESCE(
             CASE
               WHEN lower(NULLIF(pr.prefs->>'language', '')) IN ('pl', 'en')
                 THEN lower(pr.prefs->>'language')
               WHEN lower(NULLIF(pr.prefs->>'lang', '')) IN ('pl', 'en')
                 THEN lower(pr.prefs->>'lang')
               ELSE NULL
             END,
             (SELECT lower(ns.language)
                FROM public.newsletter_subscribers ns
               WHERE ns.tenant_id = m.tenant_id
                 AND lower(ns.email) = lower(p.email)
                 AND lower(ns.language) IN ('pl', 'en')
               LIMIT 1),
             'pl'),
           'lead_first_name', lp.first_name,
           'lead_last_name', lp.last_name,
           'event_slug', e.slug,
           'event_title_pl', e.title_pl,
           'event_title_en', e.title_en,
           'event_starts_at', e.starts_at,
           'event_timezone', e.timezone,
           'ticket_name_pl', tt.name_pl,
           'ticket_name_en', tt.name_en)
         ORDER BY m.ticket_revoked_at, m.id), '[]'::jsonb)
  INTO v_notices
  FROM marked m
  JOIN public.event_people p ON p.id = m.person_id AND p.tenant_id = m.tenant_id
  JOIN public.events e ON e.id = m.event_id AND e.tenant_id = m.tenant_id
  LEFT JOIN public.profiles pr ON pr.id = p.user_id AND pr.tenant_id = m.tenant_id
  LEFT JOIN public.event_ticket_types tt ON tt.id = m.ticket_type_id AND tt.tenant_id = m.tenant_id
  LEFT JOIN public.event_registrations lr
    ON lr.id = m.group_lead_registration_id AND lr.tenant_id = m.tenant_id
  LEFT JOIN public.event_people lp ON lp.id = lr.person_id AND lp.tenant_id = lr.tenant_id
  WHERE NOT m.closes_silently;

  RETURN jsonb_build_object('claimed_at', v_claim, 'notices', v_notices);
END $$;
REVOKE ALL ON FUNCTION public._event_ticket_revoked_notices_claim(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_ticket_revoked_notices_claim(integer) TO service_role;

COMMENT ON FUNCTION public._event_ticket_revoked_notices_claim(integer) IS
  'Zajmuje do p_limit (1-200, domyslnie 20) zawiadomien o biletach odwolanych razem z grupa (ticket_revoked_at), najstarsze pierwsze, SKIP LOCKED, dzierzawa 15 min; pomija wiersze znow przyjete, dopoki wydarzenie trwa; po wydarzeniu i przy notify_email = false zamyka znacznik bez maila. Zwraca {claimed_at, notices:[...]} z trescia maila. Wylacznie service_role.';

CREATE OR REPLACE FUNCTION public._event_ticket_revoked_notices_settle(
  p_claimed_at timestamptz,
  p_done uuid[],
  p_retry uuid[]
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_done uuid[] := COALESCE(p_done, ARRAY[]::uuid[]);
  v_n integer;
BEGIN
  UPDATE public.event_registrations reg SET
    ticket_revoked_at = CASE WHEN reg.id = ANY(v_done) THEN NULL ELSE reg.ticket_revoked_at END,
    ticket_revoked_notice_claimed_at = NULL
  WHERE reg.ticket_revoked_notice_claimed_at = p_claimed_at
    AND (reg.id = ANY(v_done) OR reg.id = ANY(COALESCE(p_retry, ARRAY[]::uuid[])));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public._event_ticket_revoked_notices_settle(timestamptz, uuid[], uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_ticket_revoked_notices_settle(timestamptz, uuid[], uuid[]) TO service_role;

COMMENT ON FUNCTION public._event_ticket_revoked_notices_settle(timestamptz, uuid[], uuid[]) IS
  'Rozliczenie partii zawiadomien jednym UPDATE, wylacznie dla TEGO zajecia (p_claimed_at): p_done zamyka znacznik, p_retry zwalnia dzierzawe i zostawia znacznik do ponowienia. Obce albo przeterminowane zajecie niczego nie zmienia. Zwraca liczbe wierszy. Wylacznie service_role.';

-- ============================================================================
-- 7) BILET DLA ZGLOSZENIA ZWROCONEGO CZESCIOWO
-- ============================================================================
-- Zwrot czesciowy zachowuje miejsce i kod QR (korekta ceny). Wydanie biletu
-- przyjmowalo jednak tylko `paid`/`not_required`, wiec gosc przywrocony
-- z prowadzacym po zwrocie czesciowym (sekcja 3) - i kazde takie zgloszenie
-- przyjete ponownie - dostawal nowy skrot kodu, ale nigdy maila z kodem;
-- ponowna wysylka z panelu odmawiala (`ticket_not_issuable`). Ciala
-- z 20260926100000 (kolejka crona, ponowna wysylka i jej zakres)
-- i 20260923110000 (wydanie) - zmiana wylacznie w warunku rozliczenia.
--
-- Zgloszenia przyjete i zwrocone czesciowo, ktore NIGDY nie mialy znacznika
-- wysylki (przyjete przed 20260923110000 - tamto dopiecie pomijalo ten status),
-- dostaja znacznik teraz, ta sama regula co wtedy: cron nie moze wyslac biletu
-- (i zrotowac kodu) komus, kto swoj kod juz ma. Migracja nikogo nie powiadamia.
UPDATE public.event_registrations r
SET ticket_code_sent_at = COALESCE(r.qr_issued_at, r.updated_at, now())
WHERE r.ticket_code_sent_at IS NULL
  AND r.ticket_code_claimed_at IS NULL
  AND r.status IN ('approved', 'attended')
  AND r.payment_status = 'partially_refunded';

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
    ORDER BY reg.created_at
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500)
  ) q;
$$;
REVOKE ALL ON FUNCTION public._event_ticket_codes_pending(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_ticket_codes_pending(integer) TO service_role;

CREATE OR REPLACE FUNCTION public._event_issue_ticket_codes(p_registration_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions','pg_temp'
AS $$
DECLARE
  v_root public.event_registrations;
  r record;
  v_qr text;
  v_manage text;
  v_claim timestamptz := clock_timestamp();
  v_out jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_root FROM public.event_registrations reg
  WHERE reg.id = p_registration_id;
  IF v_root.id IS NULL THEN RETURN v_out; END IF;

  FOR r IN
    SELECT reg.id, reg.tenant_id, reg.manage_token_hash,
           (reg.group_lead_registration_id IS NOT NULL) AS is_guest,
           p.email, p.first_name,
           lp.first_name AS lead_first_name, lp.last_name AS lead_last_name,
           e.slug AS event_slug, e.title_pl AS event_title_pl, e.title_en AS event_title_en,
           e.starts_at AS event_starts_at, e.timezone AS event_timezone, e.location AS event_location,
           tt.name_pl AS ticket_name_pl, tt.name_en AS ticket_name_en,
           COALESCE(
             CASE
               WHEN lower(NULLIF(pr.prefs->>'language', '')) IN ('pl', 'en')
                 THEN lower(pr.prefs->>'language')
               WHEN lower(NULLIF(pr.prefs->>'lang', '')) IN ('pl', 'en')
                 THEN lower(pr.prefs->>'lang')
               ELSE NULL
             END,
             (
               SELECT lower(ns.language)
               FROM public.newsletter_subscribers ns
               WHERE ns.tenant_id = reg.tenant_id
                 AND lower(ns.email) = lower(p.email)
                 AND lower(ns.language) IN ('pl', 'en')
               LIMIT 1
             ),
             'pl'
           ) AS lang
    FROM public.event_registrations reg
    JOIN public.event_people p ON p.id = reg.person_id AND p.tenant_id = reg.tenant_id
    JOIN public.events e ON e.id = reg.event_id AND e.tenant_id = reg.tenant_id
    LEFT JOIN public.profiles pr ON pr.id = p.user_id AND pr.tenant_id = reg.tenant_id
    LEFT JOIN public.event_ticket_types tt ON tt.id = reg.ticket_type_id AND tt.tenant_id = reg.tenant_id
    LEFT JOIN public.event_registrations lr
      ON lr.id = reg.group_lead_registration_id AND lr.tenant_id = reg.tenant_id
    LEFT JOIN public.event_people lp ON lp.id = lr.person_id AND lp.tenant_id = lr.tenant_id
    WHERE reg.tenant_id = v_root.tenant_id
      AND (reg.id = v_root.id OR reg.group_lead_registration_id = v_root.id)
      AND reg.status IN ('approved', 'attended')
      AND reg.payment_status IN ('paid', 'partially_refunded', 'not_required')
      AND reg.ticket_code_sent_at IS NULL
      AND (reg.ticket_code_claimed_at IS NULL
           OR reg.ticket_code_claimed_at < now() - interval '15 minutes')
    ORDER BY (reg.id = v_root.id) DESC, reg.created_at, reg.id
    FOR UPDATE OF reg
  LOOP
    v_qr := public._event_new_qr_token();
    -- Klucz samoobslugi wydajemy gosciowi grupy (przy kazdym zajeciu - klucz
    -- z nieudanej wysylki nigdzie nie dotarl) i temu, kto go nie ma. Klucza
    -- z `event_register` nie rotujemy: uniewaznilby link z potwierdzenia zapisu.
    v_manage := CASE WHEN r.is_guest OR r.manage_token_hash IS NULL
                     THEN public._event_new_qr_token() END;
    UPDATE public.event_registrations reg SET
      qr_token_hash = encode(digest(v_qr, 'sha256'), 'hex'),
      qr_issued_at = now(),
      manage_token_hash = CASE WHEN v_manage IS NOT NULL
        THEN encode(digest(v_manage, 'sha256'), 'hex') ELSE reg.manage_token_hash END,
      ticket_code_claimed_at = v_claim,
      updated_at = now()
    WHERE reg.id = r.id AND reg.tenant_id = v_root.tenant_id;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'registration_id', r.id,
      'tenant_id', r.tenant_id,
      'claimed_at', v_claim,
      'is_guest', r.is_guest,
      'qr_token', v_qr,
      'manage_token', v_manage,
      'email', r.email,
      'first_name', r.first_name,
      'lang', r.lang,
      'lead_first_name', CASE WHEN r.is_guest THEN r.lead_first_name END,
      'lead_last_name', CASE WHEN r.is_guest THEN r.lead_last_name END,
      'event_slug', r.event_slug,
      'event_title_pl', r.event_title_pl,
      'event_title_en', r.event_title_en,
      'event_starts_at', r.event_starts_at,
      'event_timezone', r.event_timezone,
      'event_location', r.event_location,
      'ticket_name_pl', r.ticket_name_pl,
      'ticket_name_en', r.ticket_name_en));
  END LOOP;

  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public._event_issue_ticket_codes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_issue_ticket_codes(uuid) TO service_role;

-- migration-split: part 1/3 of 20260926180000_event_registration_gaps_part3.sql
-- CIAG DALSZY: 20260926180001_event_registration_gaps_part3_part2.sql .. 20260926180002_event_registration_gaps_part3_part3.sql
-- (scripts/split-migration.ts, limit wdrozenia Lovable). SQL wykonywalny
-- czesci 1..3 sklejonych po kolei == SQL tej migracji sprzed podzialu.
-- events-harness: include
