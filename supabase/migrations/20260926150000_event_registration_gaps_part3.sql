-- Braki modulu Wydarzen, czesc 3 (PROTOTYP ZLOZENIA).
-- events-harness: include

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
      -- ZAWIADOMIENIE (20260926150000): gosc, do ktorego bilet dotarl albo
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
-- 7) WYNIK PLATNOSCI NA GOSCIACH: ZWROT AWANSUJE KOLEJKE I ZAWIADAMIA
-- ============================================================================
-- Cialo z 20260926120000. Zmiany w galezi `refunded`: miejsce goscia liczone
-- ze statusu SPRZED zwrotu, skrot kodu QR znika, znacznik zawiadomienia dla
-- goscia, do ktorego bilet dotarl, a po petli awans za zwolnione miejsca
-- z pominieciem wlasnej grupy (naglowek: DLACZEGO Z POMINIECIEM). Awans PO
-- petli - oplacony gosc tej grupy stojacy na czele kolejki jest juz wtedy
-- zwrocony i anulowany.
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
BEGIN
  SELECT * INTO v_lead FROM public.event_registrations l WHERE l.id = p_lead_id;
  v_tenant := v_lead.tenant_id;

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

COMMENT ON FUNCTION public._event_apply_outcome_to_group(uuid, uuid, text) IS
  'Wynik platnosci prowadzacego na gosciach grupy: paid rozlicza czekajacych i przyjmuje ich z kontrola miejsc (_event_group_admit_guest - miejsce albo kolejka, takze na sciezce Stripe), przyjetym tylko rozlicza; refunded anuluje oplaconych (bez kodu QR, ze znacznikiem zawiadomienia dla tych, do ktorych bilet dotarl) i awansuje kolejke za miejsca, ktore zajmowali, z pominieciem wlasnej grupy; partial_refund i unpaid tylko rozliczaja. Zamowienie trafia do goscia tylko, gdy wynik je przyniosl.';

-- ============================================================================
-- 5) ZAWIADOMIENIA O ODWOLANYM BILECIE: ZAJECIE I ROZLICZENIE PARTII
-- ============================================================================
-- Wzor jak bilety (`_event_issue_ticket_codes` + `_event_ticket_code_confirm`):
-- dzierzawa 15 minut i SKIP LOCKED - minutowy tick i `community-cron` niczego
-- nie dublują. Jedno zajecie i jedno rozliczenie na partie: dwa RPC zamiast
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
-- 6) BILET DLA ZGLOSZENIA ZWROCONEGO CZESCIOWO
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

CREATE OR REPLACE FUNCTION public.admin_event_ticket_resend(
  p_registration_id uuid,
  p_include_group boolean DEFAULT true,
  p_exclude_ids uuid[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_group boolean := COALESCE(p_include_group, true);
  v_reg public.event_registrations;
  v_lead uuid;
  v_root uuid;
BEGIN
  -- Korzen z odczytu BEZ blokady - prowadzacy wiersza sie nie zmienia.
  SELECT r.group_lead_registration_id INTO v_lead
  FROM public.event_registrations r
  WHERE r.id = p_registration_id AND r.tenant_id = v_tenant;

  v_root := CASE
    WHEN v_group THEN COALESCE(v_lead, p_registration_id)
    ELSE p_registration_id
  END;

  PERFORM 1 FROM public.event_registrations r
  WHERE r.tenant_id = v_tenant
    AND (r.id = p_registration_id
         OR (v_group AND (r.id = v_root OR r.group_lead_registration_id = v_root)))
  ORDER BY (r.id = v_root) DESC, r.created_at, r.id
  FOR UPDATE;

  SELECT * INTO v_reg
  FROM public.event_registrations r
  WHERE r.id = p_registration_id AND r.tenant_id = v_tenant;

  IF v_reg.id IS NULL THEN
    RAISE EXCEPTION 'not_found: registration does not exist in this tenant';
  END IF;

  IF v_reg.status NOT IN ('approved', 'attended')
     OR v_reg.payment_status NOT IN ('paid', 'partially_refunded', 'not_required') THEN
    RAISE EXCEPTION 'ticket_not_issuable: only an approved and settled registration gets a ticket';
  END IF;

  IF v_reg.ticket_code_sent_at IS NULL
     AND v_reg.ticket_code_claimed_at > now() - interval '15 minutes' THEN
    RAISE EXCEPTION 'ticket_send_in_progress: the ticket e-mail is being sent right now';
  END IF;

  UPDATE public.event_registrations r SET
    ticket_code_sent_at = NULL,
    ticket_code_claimed_at = NULL,
    ticket_code_undeliverable_at = NULL,
    updated_at = now()
  WHERE r.tenant_id = v_tenant
    AND (r.id = v_reg.id
         OR (v_group AND (r.id = v_root OR r.group_lead_registration_id = v_root)))
    AND r.status IN ('approved', 'attended')
    AND r.payment_status IN ('paid', 'partially_refunded', 'not_required')
    AND (r.ticket_code_sent_at IS NOT NULL
         OR r.ticket_code_claimed_at IS NULL
         OR r.ticket_code_claimed_at <= now() - interval '15 minutes')
    AND NOT (r.id = ANY(COALESCE(p_exclude_ids, ARRAY[]::uuid[])));

  RETURN v_root;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_ticket_resend(uuid, boolean, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_ticket_resend(uuid, boolean, uuid[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_ticket_resend(uuid, boolean, uuid[]) IS
  'Ponowna wysylka biletu: kasuje znacznik wysylki przyjetych i rozliczonych wierszy (zgloszenie albo cala jego grupa, bez p_exclude_ids - adresow z listy wykluczen) i oddaje identyfikator do wydania przez serwer. Blokuje korzen, potem grupe po created_at, id. Wiersz nieprzyjety albo nierozliczony: ticket_not_issuable; wiersz, ktorego bilet wlasnie wychodzi (zywa dzierzawa): ticket_send_in_progress - wiersze grupy w tym stanie sa pomijane. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_ticket_resend_scope(
  p_registration_id uuid,
  p_include_group boolean DEFAULT true
)
RETURNS TABLE (
  registration_id uuid,
  email text,
  tenant_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_group boolean := COALESCE(p_include_group, true);
  v_lead uuid;
  v_root uuid;
BEGIN
  SELECT r.group_lead_registration_id INTO v_lead
  FROM public.event_registrations r
  WHERE r.id = p_registration_id AND r.tenant_id = v_tenant;

  v_root := CASE
    WHEN v_group THEN COALESCE(v_lead, p_registration_id)
    ELSE p_registration_id
  END;

  RETURN QUERY
  SELECT r.id, p.email, r.tenant_id
  FROM public.event_registrations r
  JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
  WHERE r.tenant_id = v_tenant
    AND (r.id = p_registration_id
         OR (v_group AND (r.id = v_root OR r.group_lead_registration_id = v_root)))
    AND r.status IN ('approved', 'attended')
    AND r.payment_status IN ('paid', 'partially_refunded', 'not_required')
    AND (r.ticket_code_sent_at IS NOT NULL
         OR r.ticket_code_claimed_at IS NULL
         OR r.ticket_code_claimed_at <= now() - interval '15 minutes')
  ORDER BY (r.id = v_root) DESC, r.created_at, r.id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_ticket_resend_scope(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_ticket_resend_scope(uuid, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_ticket_resend_scope(uuid, boolean) IS
  'Zakres ponownej wysylki biletu (te same wiersze, ktorym admin_event_ticket_resend skasuje znacznik) z adresem i najemca - serwer sprawdza nimi liste wykluczen przed rotacja kodow. Tylko odczyt. Bramka: assert_event_admin_tenant().';

-- ============================================================================
-- 8) BILET Z PULI PLANU IDZIE ZA ZGLOSZENIEM
-- ============================================================================
-- ----------------------------------------------------------------------------
-- a) KTORE ZGLOSZENIE TRZYMA BILET
-- ----------------------------------------------------------------------------
ALTER TABLE public.plan_ticket_claims
  ADD COLUMN IF NOT EXISTS registration_id uuid
    REFERENCES public.event_registrations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_plan_ticket_claims_registration
  ON public.plan_ticket_claims (registration_id)
  WHERE registration_id IS NOT NULL;

COMMENT ON COLUMN public.plan_ticket_claims.registration_id IS
  'Zgloszenie etapu 4, ktorego miejsce prowadzacego pokrywa ten bilet (event_registration_claim_plan_seat). Pusta: bilet sciezki RSVP. Bilet ze zgloszeniem zwalnia cykl zgloszenia (_event_plan_seat_settle), nie czlonek.';


-- ----------------------------------------------------------------------------
-- b) CZY ZGLOSZENIE POTRZEBUJE BILETU Z PULI
-- ----------------------------------------------------------------------------
-- `p_user` - wlasciciel biletu (placacy prowadzacy). `p_except_order` -
-- zamowienie, ktore wlasnie przepadlo, a nadal stoi w processing.
CREATE OR REPLACE FUNCTION public._event_plan_seat_needed(
  p_reg public.event_registrations,
  p_user uuid,
  p_except_order uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p_reg.status NOT IN ('cancelled', 'rejected')
     AND p_reg.payment_status <> 'refunded'
     AND (
       p_reg.payment_status IN ('paid', 'partially_refunded')
       OR EXISTS (
         SELECT 1 FROM public.payment_orders o
          WHERE o.user_id = p_user
            AND o.status::text IN ('pending', 'processing')
            AND o.created_at > now() - interval '25 hours'
            AND o.metadata->>'registration_id' = p_reg.id::text
            AND o.metadata->>'plan_benefit' = 'included'
            AND o.id IS DISTINCT FROM p_except_order
       )
     )
$$;
REVOKE ALL ON FUNCTION public._event_plan_seat_needed(public.event_registrations, uuid, uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._event_plan_seat_needed(public.event_registrations, uuid, uuid) IS
  'Czy zgloszenie potrzebuje biletu z puli planu: otwarte, nie zwrocone i oplacone albo z zywa kasa (zamowienie pending/processing z benefitem included, mlodsze niz 25 h, poza p_except_order).';

-- ----------------------------------------------------------------------------
-- c) BILET IDZIE ZA ZGLOSZENIEM
-- ----------------------------------------------------------------------------
-- 'none' (brak biletu zgloszenia albo nic do zrobienia) | 'released' |
-- 'reheld' (bilet wrocil do zgloszenia oplaconego z puli) | 'kept'.
CREATE OR REPLACE FUNCTION public._event_plan_seat_settle(
  p_registration_id uuid,
  p_lapsed_order uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_reg public.event_registrations;
  v_user uuid;
  v_n integer;
BEGIN
  -- Wlasciciel biletu (placacy prowadzacy). Klucz obcy `registration_id`
  -- gwarantuje, ze zgloszenie biletu istnieje.
  SELECT c.user_id INTO v_user
    FROM public.plan_ticket_claims c
   WHERE c.registration_id = p_registration_id
   ORDER BY c.released_at DESC NULLS FIRST
   LIMIT 1;
  IF v_user IS NULL THEN
    RETURN 'none';
  END IF;
  SELECT r.* INTO v_reg FROM public.event_registrations r WHERE r.id = p_registration_id;

  IF NOT public._event_plan_seat_needed(v_reg, v_user, p_lapsed_order) THEN
    UPDATE public.plan_ticket_claims c SET released_at = now()
     WHERE c.registration_id = v_reg.id AND c.released_at IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN CASE WHEN v_n > 0 THEN 'released' ELSE 'none' END;
  END IF;

  -- Zgloszenie znow potrzebuje biletu, ktory juz oddalo (ponowne przyjecie,
  -- wplata z sesji otwartej przed odwolaniem). Wraca tylko, gdy oplacilo je
  -- zamowienie liczace miejsce prowadzacego z puli - bez sprawdzania puli.
  UPDATE public.plan_ticket_claims c SET released_at = NULL
   WHERE c.registration_id = v_reg.id
     AND c.user_id = v_user
     AND c.released_at IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.payment_orders o
        WHERE o.id = v_reg.payment_order_id
          AND o.user_id = v_user
          AND o.status::text = 'paid'
          AND o.metadata->>'plan_benefit' = 'included'
     );
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN CASE WHEN v_n > 0 THEN 'reheld' ELSE 'kept' END;
END $$;
REVOKE ALL ON FUNCTION public._event_plan_seat_settle(uuid, uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._event_plan_seat_settle(uuid, uuid) IS
  'Uzgadnia bilet z puli planu ze stanem zgloszenia (_event_plan_seat_needed): zwalnia, gdy niepotrzebny; przywraca bez sprawdzania puli, gdy zgloszenie oplacilo zamowienie z miejscem z puli. Zwraca none | released | reheld | kept.';

CREATE OR REPLACE FUNCTION public._tg_event_plan_seat_follow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  PERFORM public._event_plan_seat_settle(NEW.id);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._tg_event_plan_seat_follow() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS event_registrations_plan_seat_follow ON public.event_registrations;
CREATE TRIGGER event_registrations_plan_seat_follow
  AFTER UPDATE OF status, payment_status ON public.event_registrations
  FOR EACH ROW
  WHEN (NEW.group_lead_registration_id IS NULL
        AND (OLD.status IS DISTINCT FROM NEW.status
             OR OLD.payment_status IS DISTINCT FROM NEW.payment_status))
  EXECUTE FUNCTION public._tg_event_plan_seat_follow();

-- ----------------------------------------------------------------------------
-- d) PORZUCONE KASY
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_plan_seat_release_lapsed(p_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_ids uuid[];
  v_n integer;
BEGIN
  SELECT array_agg(x.id) INTO v_ids
    FROM (
      SELECT c.id
        FROM public.plan_ticket_claims c
        JOIN public.event_registrations r ON r.id = c.registration_id
       WHERE c.released_at IS NULL
         AND c.claimed_at < now() - interval '1 hour'
         AND NOT public._event_plan_seat_needed(r, c.user_id)
       ORDER BY c.claimed_at, c.id
       LIMIT GREATEST(COALESCE(p_limit, 500), 1)
       FOR UPDATE OF c SKIP LOCKED
    ) x;

  UPDATE public.plan_ticket_claims c SET released_at = now()
   WHERE c.id = ANY (v_ids) AND c.released_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public._event_plan_seat_release_lapsed(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_plan_seat_release_lapsed(integer) TO service_role;

COMMENT ON FUNCTION public._event_plan_seat_release_lapsed(integer) IS
  'Co godzine (pg_cron event-plan-seat-release) i z community-cron (event-ticket-codes): zwalnia bilety z puli trzymane przez zgloszenia, ktore ich nie potrzebuja (_event_plan_seat_needed) - porzucona kasa, kasa przerwana przed zamowieniem. Karencja godziny od zajecia. Zwraca liczbe zwolnionych.';

-- Harmonogram w pg_cron, gdy jest. NIE jest jedynym zrodlem wywolan:
-- `community-cron` (job `event-ticket-codes`, scheduler repo co 5 minut) woła
-- ten sam przeglad (`runPlanSeatRelease`), wiec baza bez pg_cron - albo
-- z nieudanym zakladaniem zadania - nie zostawia biletow porzuconych kas
-- zajetych na zawsze. Funkcja jest idempotentna (SKIP LOCKED, karencja).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule('event-plan-seat-release', '17 * * * *',
      'SELECT public._event_plan_seat_release_lapsed(500)');
  ELSE
    RAISE NOTICE 'pg_cron unavailable - lapsed plan seats released by community-cron (event-ticket-codes)';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron setup skipped: %', SQLERRM;
END $$;

-- ----------------------------------------------------------------------------
-- e) KASA ZAPISUJE ZGLOSZENIE W BILECIE
-- ----------------------------------------------------------------------------
-- Cialo z 20260926140000. Zmiany: `registration_id` przy zajeciu i przy
-- ponownym zajeciu zwolnionego wiersza; bilet zajety przez INNE zgloszenie tej
-- osoby przechodzi na biezace (poza podgladem).
CREATE OR REPLACE FUNCTION public.event_registration_claim_plan_seat(
  p_registration_id uuid,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.public_tenant_id();
  v_pool_tenant uuid;
  v_reg public.event_registrations;
  v_ticket public.event_ticket_types;
  v_face integer := 0;
  v_state jsonb;
  v_org uuid;
  v_tier text;
  v_claim_id uuid;
  v_holder uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'account_required');
  END IF;
  SELECT p.tenant_id INTO v_pool_tenant FROM public.profiles p WHERE p.id = v_uid;

  SELECT r.* INTO v_reg
  FROM public.event_registrations r
  JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
  WHERE r.id = p_registration_id
    AND r.tenant_id = v_tenant
    AND p.user_id = v_uid
    AND r.group_lead_registration_id IS NULL
    AND r.status NOT IN ('cancelled', 'rejected')
    AND r.payment_status = 'unpaid'
  FOR UPDATE OF r;

  IF v_reg.id IS NOT NULL AND v_reg.ticket_type_id IS NOT NULL THEN
    SELECT * INTO v_ticket FROM public.event_ticket_types t
    WHERE t.id = v_reg.ticket_type_id AND t.tenant_id = v_tenant;
    v_face := COALESCE(public._event_ticket_price_now(
      v_ticket.price_cents, v_ticket.early_bird_price_cents,
      v_ticket.early_bird_until, v_ticket.price_schedule), 0);
  END IF;

  -- Zgloszenie cudze, goscia, zamkniete, rozliczone, bez biletu z cennika albo
  -- z biletem za darmo - nie ma czego pokrywac pula. Jeden powod, jak
  -- w kontekscie platnosci: rozroznienie byloby sonda cudzych zgloszen.
  IF v_reg.id IS NULL OR v_pool_tenant IS NULL OR v_face <= 0 THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'not_eligible');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('plan_ticket_pool:' || v_pool_tenant::text || ':' || v_uid::text)
  );
  SELECT c.id, c.registration_id INTO v_claim_id, v_holder
    FROM public.plan_ticket_claims c
   WHERE c.user_id = v_uid AND c.event_id = v_reg.event_id
     AND c.released_at IS NULL
     AND c.period_start <= CURRENT_DATE
     AND c.period_end > CURRENT_DATE
   FOR UPDATE;
  IF v_claim_id IS NOT NULL THEN
    -- Bilet trzyma INNE zgloszenie tej osoby - zamkniete, bo otwarte jest
    -- jedno (`event_registrations_active_uniq`): przechodzi na biezace, zeby
    -- jego cykl (odwolanie, porzucona kasa) go oddal. Bilet sciezki RSVP
    -- (bez zgloszenia) zostaje jej. Podglad niczego nie zapisuje.
    IF v_holder IS NOT NULL AND v_holder <> v_reg.id AND NOT COALESCE(p_dry_run, false) THEN
      UPDATE public.plan_ticket_claims SET registration_id = v_reg.id WHERE id = v_claim_id;
    END IF;
    RETURN jsonb_build_object('claimed', true, 'reused', true);
  END IF;

  v_state := public.my_ticket_allowance();
  IF COALESCE((v_state ->> 'remaining')::integer, 0) <= 0 THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'pool_empty');
  END IF;
  v_org := NULLIF(v_state ->> 'org_id', '')::uuid;
  IF v_org IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtext('plan_ticket_pool_org:' || v_pool_tenant::text || ':' || v_org::text)
    );
    v_state := public.my_ticket_allowance();
    IF COALESCE((v_state ->> 'remaining')::integer, 0) <= 0 THEN
      RETURN jsonb_build_object('claimed', false, 'reason', 'pool_empty');
    END IF;
  END IF;

  -- Podglad: pula odda bilet, ale nic nie zapisujemy.
  IF COALESCE(p_dry_run, false) THEN
    RETURN jsonb_build_object('claimed', true, 'reused', false, 'dry_run', true);
  END IF;

  -- Najwyzsza warstwa czlonka - ta sama kolejnosc zrodel, co w
  -- `claim_included_event_ticket` (nadanie albo subskrypcja).
  SELECT k.tier_key INTO v_tier
    FROM (
      SELECT g.tier_key, mt.rank
        FROM public.membership_grants g
        JOIN public.membership_tiers mt
          ON mt.tenant_id = g.tenant_id AND mt.key = g.tier_key
       WHERE g.user_id = v_uid AND g.tenant_id = v_pool_tenant
         AND g.revoked_at IS NULL
         AND g.starts_at <= now()
         AND (g.expires_at IS NULL OR g.expires_at > now())
      UNION ALL
      SELECT ap.tier_key, mt.rank
        FROM public.user_subscriptions us
        JOIN public.access_plans ap ON ap.id = us.plan_id
        JOIN public.membership_tiers mt
          ON mt.tenant_id = us.tenant_id AND mt.key = ap.tier_key
       WHERE us.user_id = v_uid AND us.tenant_id = v_pool_tenant
         AND us.status::text IN ('active', 'trialing', 'past_due')
         AND ap.tier_key IS NOT NULL
    ) k
   ORDER BY k.rank DESC
   LIMIT 1;

  INSERT INTO public.plan_ticket_claims (
    tenant_id, user_id, event_id, org_id, tier_key,
    period_start, period_end, face_value_cents, currency, registration_id
  )
  VALUES (
    v_pool_tenant, v_uid, v_reg.event_id, v_org,
    COALESCE(v_tier, 'member'),
    (v_state ->> 'period_start')::date,
    (v_state ->> 'period_end')::date,
    v_face,
    COALESCE(v_ticket.currency, 'PLN'),
    v_reg.id
  )
  ON CONFLICT (user_id, event_id) DO UPDATE
    SET released_at      = NULL,
        org_id           = EXCLUDED.org_id,
        tier_key         = EXCLUDED.tier_key,
        period_start     = EXCLUDED.period_start,
        period_end       = EXCLUDED.period_end,
        face_value_cents = EXCLUDED.face_value_cents,
        currency         = EXCLUDED.currency,
        registration_id  = EXCLUDED.registration_id,
        claimed_at       = now();
  RETURN jsonb_build_object('claimed', true, 'reused', false);
END;
$$;
REVOKE ALL ON FUNCTION public.event_registration_claim_plan_seat(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_registration_claim_plan_seat(uuid, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_registration_claim_plan_seat(uuid, boolean) IS
  'Bilet z puli planu dla miejsca PROWADZACEGO w zamowieniu grupowym: tylko zgloszenie, ktorego osoba to wolajacy, bez grupy nad soba, otwarte i nieoplacone, z biletem platnym w cenniku. Ta sama regula puli co claim_included_event_ticket (blokady, okno roku, jeden bilet na wydarzenie - ponowna kasa bierze ten sam; bilet zapisuje zgloszenie - registration_id, zwalnia go jego cykl). p_dry_run: podglad kasy - ta sama odpowiedz bez zapisu. Odmowa nie rzuca: {claimed:false, reason: account_required | not_eligible | pool_empty}.';

-- ----------------------------------------------------------------------------
-- f) RECZNY ZWROT BILETU DO PULI
-- ----------------------------------------------------------------------------
-- Cialo z 20260822171037. Zmiany: czlonek (zwrot wlasnego biletu, takze
-- przez `rsvp_event`) NIE zwraca biletu, ktory trzyma zgloszenie - kasa
-- wycenila za niego miejsce prowadzacego na zero. Administrator i rola
-- serwisowa zwracaja kazdy i ODPINAJA go od zgloszenia, zeby cykl zgloszenia
-- (ponowne przyjecie) go nie przywrocil.
CREATE OR REPLACE FUNCTION public.release_included_event_ticket(p_event_id uuid, p_user uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := COALESCE(p_user, auth.uid());
  v_self boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;
  IF v_uid <> auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'tickets: forbidden';
  END IF;
  v_self := v_uid = auth.uid();

  UPDATE public.plan_ticket_claims c
     SET released_at = now(),
         registration_id = CASE WHEN v_self THEN c.registration_id END
   WHERE c.user_id = v_uid
     AND c.event_id = p_event_id
     AND c.released_at IS NULL
     AND (NOT COALESCE(v_self, false) OR c.registration_id IS NULL);

  RETURN FOUND;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.release_included_event_ticket(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_included_event_ticket(uuid, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.release_included_event_ticket(uuid, uuid) IS
  'Zwraca bilet do puli po rezygnacji z udzialu. Wiersz zostaje ze stemplem released_at jako slad audytowy. Bilet trzymany przez zgloszenie etapu 4 (registration_id) zwraca cykl zgloszenia - czlonek go nie zwolni; administrator albo rola serwisowa zwalnia i odpina go od zgloszenia.';

-- ----------------------------------------------------------------------------
-- g) WYNIK `unpaid` ODDAJE BILET Z PULI
-- ----------------------------------------------------------------------------
-- Cialo z 20260830110000 [SCALIC z pozycja 5 - galaz `paid`]. Zmiana: galaz
-- `unpaid` nie zmienia payment_status (unpaid -> unpaid), wiec trigger b) jej
-- nie widzi - wola `_event_plan_seat_settle` z wylaczeniem tego zamowienia.
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
  'Dopiecie danych sprzed 20260926150000 (service_role): przypina bilety z puli do zgloszen po zamowieniach z benefitem included (najnowsze na osobe i wydarzenie) i od razu zwalnia te, ktorych zgloszenie nie potrzebuje (_event_plan_seat_release_lapsed). Idempotentna; zwraca {linked, released}.';

SELECT public._event_plan_seat_link_backfill();

-- ============================================================================
-- 11) ZAMOWIENIE PAKIETU: KOLEJNOSC BLOKAD I ZATRZASK TYLKO Z ODDANYM UZYCIEM
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

  -- KOLEJNOSC BLOKAD: NAJPIERW KOD, potem zamowienie (20260926150000).
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
