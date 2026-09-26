-- Goscie rejestracji grupowej ida za decyzja o prowadzacym - i kazdy dostaje
-- WLASNY mail z biletem.
-- events-harness: include
--
-- PRZYCZYNA. Gosc dostaje przy dopisaniu status prowadzacego z tej chwili
-- (`event_register_group_guests`), a pozniej rusza go wylacznie trigger
-- platnosci (`_tg_event_group_follow_lead`) - i to tylko przy zamowieniu
-- Stripe. Zatwierdzenie prowadzacego przez organizatora (bilet
-- `requires_approval`, przeplyw `approval`, werdykt reguly) zmienialo JEDEN
-- wiersz, wiec goscie stali `pending` na zawsze, a `_event_issue_ticket_codes`
-- i cron (`_event_ticket_codes_pending`) wymagaja statusu approved/attended.
-- Zaden gosc takiej grupy nie dostal biletu.
--
-- CO ROBI TA MIGRACJA
--   a) STRAZNIK: bez obiektow 20260923110000 (0044) konczy sie GLOSNO. Na bazie
--      bez `_event_issue_ticket_codes` kazda sciezka wysylki milczy - serwer
--      loguje blad RPC i oddaje `sent: 0` - wiec brak 0044 musi wyjsc przy
--      wdrozeniu, a nie w skardze uczestnika.
--   b) KASKADA STATUSU z prowadzacego na gosci (nowy trigger AFTER UPDATE OF
--      status). Zatwierdzenie przyjmuje gosci rozliczonych (paid/not_required),
--      o ile jest miejsce - reszta idzie na liste rezerwowa. Goscie NIEOPLACENI
--      zostaja `pending`: nieoplacone miejsce nie trzyma puli, przyjmie ich
--      trigger platnosci. Odrzucenie i anulowanie zamyka gosci, ktorzy jeszcze
--      czekaja - STEMPLEM decyzji prowadzacego, wiec ponowne zatwierdzenie
--      prowadzacego przywraca dokladnie tych gosci. Goscie JUZ przyjeci zostaja
--      nietknieci (patrz nizej).
--   c) Trigger platnosci nie wymaga juz `payment_order_id` - reczne `paid` /
--      `refund` organizatora dociera do gosci. Gosc zachowuje wlasne
--      zamowienie, gdy wynik przychodzi bez zamowienia. Zwrot dotyczy tylko
--      gosci, ktorzy ZAPLACILI.
--   d) Wiersz, ktory WYCHODZI z approved/attended, traci znacznik wyslanego
--      biletu - ponowne przyjecie wyda i wysle nowy.
--   e) Cron widzi tez samodzielne zapisy na wydarzeniach w trybie RSVP.
--   f) `admin_event_registration_group_links` - panel widzi, kto jest gosciem
--      kogo i czy bilet wyszedl (dla wierszy WIDOCZNEJ strony).
--   g) `admin_event_ticket_resend` - organizator wysyla bilet ponownie, ale
--      nie wchodzi w droge wysylce, ktora wlasnie trwa.
--
-- KOLEJNOSC TRIGGEROW JEST CZESCIA KONTRAKTU. Postgres odpala triggery tego
-- samego momentu w KOLEJNOSCI NAZW. `_event_seats_left` czyta z pamieci
-- `event_ticket_types.sold_count`, ktore przelicza
-- `event_registrations_sync_ticket_sold` - kaskada musi wiec startowac PO nim,
-- inaczej liczy miejsca bez prowadzacego, przepuszcza o jednego goscia za duzo
-- i CHECK `event_ticket_types_sold_within_quota` wywraca zatwierdzenie
-- organizatora. Stad `zz` w nazwie. Ta sama kolejnosc stawia kaskade PO
-- triggerze platnosci (`event_registrations_group_follow_lead`), wiec na
-- sciezce Stripe goscie sa juz przyjeci i kaskada nie ma nic do roboty.
-- Kolejnosc przybija asercja kwoty w 27_group_follow_lead.sql.
--
-- CZEGO TA MIGRACJA NIE ROBI (swiadomie, do decyzji produktu):
--   * nie naprawia wierszy ostemplowanych przez backfill 0044 - to jednorazowa
--     operacja na produkcji, nie migracja;
--   * nie odwoluje gosci JUZ przyjetych, gdy prowadzacy zostaje odrzucony albo
--     anulowany - ich kod QR nadal wpuszcza;
--   * nie sprawdza miejsc w galezi `paid` `_event_apply_outcome_to_group`.

-- ----------------------------------------------------------------------------
-- a) STRAZNIK 0044
--
-- Funkcja, a nie jednorazowy blok DO: harness moze ja zawolac na bazie
-- z ukrytym obiektem 0044 i sprawdzic, ze naprawde odmawia - blok DO
-- znika razem z migracja i jego odmowy nie da sie udowodnic.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_assert_ticket_codes_schema()
RETURNS void
LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF to_regprocedure('public._event_issue_ticket_codes(uuid)') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns c
       WHERE c.table_schema = 'public'
         AND c.table_name = 'event_registrations'
         AND c.column_name = 'ticket_code_sent_at'
     ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Brak migracji 20260923110000_event_ticket_group_codes (0044): '
        || 'nie ma public._event_issue_ticket_codes(uuid) albo kolumny '
        || 'event_registrations.ticket_code_sent_at. Najpierw wdroz 0044. / '
        || 'Migration 20260923110000_event_ticket_group_codes (0044) is missing: '
        || 'apply it before this one.',
      ERRCODE = 'undefined_function';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._event_assert_ticket_codes_schema() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._event_assert_ticket_codes_schema() IS
  'Straznik wdrozenia: rzuca, gdy na bazie brakuje obiektow 20260923110000 (0044) - _event_issue_ticket_codes(uuid) albo event_registrations.ticket_code_sent_at. Bez nich kazda wysylka biletow milczy.';

SELECT public._event_assert_ticket_codes_schema();

-- ----------------------------------------------------------------------------
-- b) KASKADA STATUSU PROWADZACEGO NA GOSCI
-- ----------------------------------------------------------------------------

-- GOSC ZAMKNIETY RAZEM Z PROWADZACYM - po stemplu jego decyzji.
--
-- Kaskada zamyka czekajacych gosci stemplem prowadzacego: odrzucenie - ta sama
-- chwila `decided_at` i ten sam `decided_by` (odrzuca WYLACZNIE
-- `admin_event_registration_decide`, ktore stempluje `now()`, a kaskada biegnie
-- w tej samej transakcji, wiec `now()` jest identyczne), anulowanie - ten sam
-- `cancelled_at`. Gosc odrzucony osobno albo wycofany samodzielnie ma INNY
-- stempel - ponowne przyjecie prowadzacego go nie przywroci.
--
-- ZWROT NIE WRACA. Gosc `refunded`/`partially_refunded` dostal pieniadze
-- z powrotem - przywrocenie byloby nowa sprzedaza, a nie cofnieciem pomylki.
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
    AND p_guest.payment_status IN ('not_required', 'paid', 'unpaid')
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
  'Czy gosc zostal zamkniety RAZEM z prowadzacym: ten sam status i stempel decyzji (odrzucenie: decided_at + decided_by, anulowanie: cancelled_at), rozliczenie bez zwrotu. Ponowne przyjecie prowadzacego przywraca wlasnie tych gosci; panel liczy ich przy prowadzacym.';

CREATE OR REPLACE FUNCTION public._tg_event_group_follow_lead_status()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  g public.event_registrations;
  v_left integer;
  v_reopen boolean;
BEGIN
  -- PRZYJECIE. Z oczekiwania - i z odrzucenia albo anulowania: wtedy wracaja
  -- takze goscie zamknieci RAZEM z prowadzacym. Pomylkowe odrzucenie
  -- i ponowne zatwierdzenie to zwykly przebieg pracy organizatora; bez tego
  -- goscie zostawali zamknieci na zawsze, a jedyna droga powrotu bylo
  -- zatwierdzanie kazdego z osobna.
  IF NEW.status = 'approved'
     AND OLD.status IN ('draft', 'pending', 'waitlist', 'rejected', 'cancelled') THEN
    FOR g IN
      SELECT r.* FROM public.event_registrations r
      WHERE r.tenant_id = NEW.tenant_id
        AND r.group_lead_registration_id = NEW.id
        AND (r.status IN ('draft', 'pending', 'waitlist')
             OR public._event_guest_closed_with_lead(r, OLD))
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
      IF g.payment_status NOT IN ('not_required', 'paid') THEN
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
          WHERE r.id = g.id AND r.tenant_id = NEW.tenant_id;
        END IF;
        CONTINUE;
      END IF;

      -- Liczymy PO kazdym gosciu od nowa: kazdy UPDATE nizej odpala przelicznik
      -- `sold_count` na koncu wlasnej instrukcji, wiec nastepny gosc widzi juz
      -- miejsce zajete przez poprzedniego.
      v_left := public._event_seats_left(NEW.tenant_id, NEW.event_id, g.ticket_type_id);
      IF v_left IS NULL OR v_left > 0 THEN
        UPDATE public.event_registrations r SET
          status = 'approved',
          waitlist_position = NULL,
          cancelled_at = NULL,
          decided_by = NEW.decided_by,
          decided_at = now(),
          decision_source = COALESCE(NEW.decision_source, 'system'),
          qr_token_hash = encode(digest(public._event_new_qr_token(), 'sha256'), 'hex'),
          qr_issued_at = now(),
          -- Nowe przyjecie = nowy bilet. Kod rotuje wydanie, a mail wysle
          -- serwer (`issueAndSendTicketCodes`) albo cron.
          ticket_code_sent_at = NULL,
          ticket_code_claimed_at = NULL,
          promoted_at = CASE WHEN r.status = 'waitlist' THEN now() ELSE r.promoted_at END,
          updated_at = now()
        WHERE r.id = g.id AND r.tenant_id = NEW.tenant_id;
      ELSIF g.status <> 'waitlist' THEN
        -- BRAK MIEJSCA NIE COFA ZATWIERDZENIA PROWADZACEGO. Wyjatek wywrocilby
        -- decyzje organizatora o calej grupie; gosc, ktory sie nie zmiescil,
        -- staje w kolejce jak kazdy zapis ponad pule i awansuje, gdy miejsce
        -- sie zwolni. Gosc przywracany z anulowania gubi date anulowania -
        -- kolejka nie jest anulowaniem.
        UPDATE public.event_registrations r SET
          status = 'waitlist',
          waitlist_position = public._event_next_waitlist_position(NEW.tenant_id, NEW.event_id),
          cancelled_at = NULL,
          decided_by = NULL,
          decided_at = now(),
          decision_source = 'capacity',
          qr_token_hash = NULL,
          qr_issued_at = NULL,
          updated_at = now()
        WHERE r.id = g.id AND r.tenant_id = NEW.tenant_id;
      END IF;
      -- Gosc juz w kolejce zostaje na SWOJEJ pozycji - nie przeskakuje nikogo.
    END LOOP;

  -- ODRZUCENIE I ANULOWANIE. Tylko goscie, ktorzy jeszcze czekaja - przyjetych
  -- nie ruszamy (decyzja produktu, patrz naglowek). Kolumny ustawiamy pod CHECK-i:
  -- odrzucenie przez organizatora wymaga powodu (`rejection_has_reason`),
  -- anulowanie - daty (`cancelled_dated`, u prowadzacego wymuszonej tym samym
  -- CHECK-iem przed triggerem AFTER). Data anulowania i chwila decyzji sa
  -- STEMPLEM prowadzacego - po nim `_event_guest_closed_with_lead` rozpozna
  -- tych gosci przy ponownym przyjeciu.
  ELSIF NEW.status IN ('rejected', 'cancelled') THEN
    UPDATE public.event_registrations r SET
      status = NEW.status,
      decision_note = COALESCE(NEW.decision_note, r.decision_note),
      decided_by = NEW.decided_by,
      decided_at = now(),
      decision_source = COALESCE(NEW.decision_source, 'system'),
      cancelled_at = CASE
        WHEN NEW.status = 'cancelled' THEN NEW.cancelled_at
        ELSE r.cancelled_at
      END,
      waitlist_position = NULL,
      qr_token_hash = NULL,
      qr_issued_at = NULL,
      updated_at = now()
    WHERE r.tenant_id = NEW.tenant_id
      AND r.group_lead_registration_id = NEW.id
      AND r.status IN ('draft', 'pending', 'waitlist');
  END IF;

  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._tg_event_group_follow_lead_status() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._tg_event_group_follow_lead_status() IS
  'Kaskada statusu prowadzacego grupy na gosci: zatwierdzenie przyjmuje gosci rozliczonych (albo stawia ich w kolejce, gdy brak miejsca), odrzucenie i anulowanie zamyka gosci, ktorzy jeszcze czekaja, a ponowne zatwierdzenie przywraca gosci zamknietych razem z prowadzacym (_event_guest_closed_with_lead). Nieoplaconych gosci przyjmuje trigger platnosci, przyjetych nie rusza.';

DROP TRIGGER IF EXISTS event_registrations_zz_group_follow_lead_status ON public.event_registrations;
-- `zz` = PO `event_registrations_sync_ticket_sold` (patrz naglowek).
CREATE TRIGGER event_registrations_zz_group_follow_lead_status
  AFTER UPDATE OF status ON public.event_registrations
  FOR EACH ROW
  WHEN (NEW.group_lead_registration_id IS NULL AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public._tg_event_group_follow_lead_status();

-- ----------------------------------------------------------------------------
-- c) PLATNOSC PROWADZACEGO DOCIERA DO GOSCI TAKZE BEZ ZAMOWIENIA
-- ----------------------------------------------------------------------------
-- Cialo z 20260922230000. Zmiany: `COALESCE(p_order_id, r.payment_order_id)`
-- zamiast `p_order_id` (reczne `paid`/`refund` organizatora nie ma zamowienia,
-- a gosc nie moze zgubic wlasnego), zawezenie do najemcy prowadzacego i zwrot
-- tylko dla gosci, ktorzy zaplacili.
--
-- ZWROT DOTYCZY TEGO, KTO ZAPLACIL. Do tej migracji wynik docieral do gosci
-- tylko z zamowieniem Stripe, a te oplacaly cala grupe naraz. Reczny `refund`
-- organizatora dociera teraz do KAZDEGO goscia - bez tego warunku gosc
-- odrzucony albo wycofany przed wplata dostawal `refunded` (zwrot, ktorego nie
-- bylo) i `cancelled` w miejsce decyzji o odrzuceniu. Nieoplacony gosc, ktory
-- jeszcze czeka, i tak zostaje zamkniety - robi to kaskada statusu, bo zwrot
-- anuluje prowadzacego.
CREATE OR REPLACE FUNCTION public._event_apply_outcome_to_group(p_lead_id uuid, p_order_id uuid, p_outcome text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions','pg_temp'
AS $$
DECLARE
  g public.event_registrations;
  v_tenant uuid;
  v_token text;
  v_n integer := 0;
BEGIN
  SELECT l.tenant_id INTO v_tenant FROM public.event_registrations l WHERE l.id = p_lead_id;

  FOR g IN SELECT * FROM public.event_registrations r
    WHERE r.group_lead_registration_id = p_lead_id AND r.tenant_id = v_tenant
    FOR UPDATE LOOP
    IF p_outcome IN ('refunded', 'partial_refund')
       AND g.payment_status NOT IN ('paid', 'partially_refunded') THEN
      CONTINUE;
    END IF;
    IF p_outcome = 'paid' THEN
      IF g.status IN ('cancelled','rejected') THEN CONTINUE; END IF;
      v_token := public._event_new_qr_token();
      UPDATE public.event_registrations r SET
        payment_order_id = COALESCE(p_order_id, r.payment_order_id), payment_status = 'paid',
        paid_at = COALESCE(r.paid_at, now()),
        status = CASE WHEN r.status IN ('draft','pending','waitlist') THEN 'approved' ELSE r.status END,
        waitlist_position = NULL,
        decided_at = COALESCE(r.decided_at, now()),
        decision_source = COALESCE(r.decision_source, 'system'),
        qr_token_hash = COALESCE(r.qr_token_hash, encode(digest(v_token,'sha256'),'hex')),
        qr_issued_at = COALESCE(r.qr_issued_at, now()),
        updated_at = now()
      WHERE r.id = g.id AND r.tenant_id = v_tenant;
    ELSIF p_outcome = 'refunded' THEN
      UPDATE public.event_registrations r SET
        payment_order_id = COALESCE(p_order_id, r.payment_order_id),
        payment_status = 'refunded', paid_at = NULL,
        status = 'cancelled', cancelled_at = COALESCE(r.cancelled_at, now()),
        waitlist_position = NULL,
        decided_at = COALESCE(r.decided_at, now()),
        decision_source = COALESCE(r.decision_source, 'system'),
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
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public._event_apply_outcome_to_group(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- Cialo z 20260922230000 BEZ warunku `payment_order_id IS NOT NULL`: akcja
-- `paid` w `admin_event_registration_decide` (przelew, gotowka) nie ustawia
-- zamowienia, wiec goscie zostawali `pending/unpaid` i bez biletu.
CREATE OR REPLACE FUNCTION public._tg_event_group_follow_lead()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions','pg_temp'
AS $$
BEGIN
  IF NEW.group_lead_registration_id IS NULL
     AND NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    PERFORM public._event_apply_outcome_to_group(
      NEW.id, NEW.payment_order_id,
      CASE NEW.payment_status
        WHEN 'paid' THEN 'paid'
        WHEN 'refunded' THEN 'refunded'
        WHEN 'partially_refunded' THEN 'partial_refund'
        ELSE 'unpaid' END);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._tg_event_group_follow_lead() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- d) WYJSCIE Z PRZYJECIA KASUJE ZNACZNIK WYSLANEGO BILETU
-- ----------------------------------------------------------------------------
-- Rezerwa, odrzucenie i anulowanie zdejmuja `qr_token_hash`, wiec kod
-- w skrzynce uczestnika przestaje wpuszczac. Ze znacznikiem wysylki wiersz po
-- ponownym przyjeciu NIGDY nie wracal do wydania (`ticket_code_sent_at IS NULL`
-- to warunek i wydania, i crona). Kasowanie w BEFORE, wiec dziala niezaleznie
-- od drogi: decyzja organizatora, platnosc, samoobsluga, kaskada grupy.
--
-- `no_show` NIE kasuje: nieobecnosc nie zdejmuje kodu QR, bilet z maila nadal
-- obowiazuje, a powrot do `attended` wyslalby uczestnikowi drugi, zbedny mail.
CREATE OR REPLACE FUNCTION public._tg_event_ticket_code_reset()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  NEW.ticket_code_sent_at := NULL;
  NEW.ticket_code_claimed_at := NULL;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._tg_event_ticket_code_reset() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._tg_event_ticket_code_reset() IS
  'Wiersz wychodzacy z approved/attended do draft/pending/waitlist/rejected/cancelled traci znacznik wyslanego biletu (ticket_code_sent_at, ticket_code_claimed_at), zeby ponowne przyjecie wydalo i wyslalo nowy kod.';

DROP TRIGGER IF EXISTS event_registrations_ticket_code_reset ON public.event_registrations;
CREATE TRIGGER event_registrations_ticket_code_reset
  BEFORE UPDATE OF status ON public.event_registrations
  FOR EACH ROW
  WHEN (OLD.status IN ('approved', 'attended')
        AND NEW.status IN ('draft', 'pending', 'waitlist', 'rejected', 'cancelled'))
  EXECUTE FUNCTION public._tg_event_ticket_code_reset();

-- ----------------------------------------------------------------------------
-- e) CRON WIDZI SAMODZIELNE ZAPISY W TRYBIE RSVP
-- ----------------------------------------------------------------------------
-- Cialo z 20260923110000. `event_register` zapisuje `registration_mode = 'rsvp'`
-- na kazdym wydarzeniu poza trybem formularza, a przeplyw `approval` i tak
-- prowadzi na formularz - takie zgloszenie (i jego goscie) mogl przyjac tylko
-- organizator, a bilet wydac tylko cron, ktory filtrowal `'form'`. Samego
-- filtra nie da sie zdjac: `admin_event_registration_upsert` wstawia wpisy
-- organizatora i importy jako `rsvp` ze zrodlem `organizer`/`import`/..., a te
-- nie dostaja maili automatycznie. Rozroznia je `source`: `event_register`
-- i `event_register_group_guests` pisza zawsze `self_registration`.
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
      AND reg.payment_status IN ('paid', 'not_required')
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

-- ----------------------------------------------------------------------------
-- f) PANEL: KTO JEST GOSCIEM KOGO I CZY BILET WYSZEDL
-- ----------------------------------------------------------------------------
-- Osobne RPC zamiast kolumn w `admin_event_registrations_list`: tamta funkcja
-- zmienialaby ksztalt (DROP + CREATE), a jej wiersz jest przepisany w wielu
-- atrapach testow. `has_qr` z listy klamie dla gosci bezplatnych - skrot kodu
-- powstaje przy dopisaniu, zanim jakikolwiek mail wyjdzie - wiec o wysylce
-- mowi dopiero `ticket_code_sent_at`.
--
-- TYLKO WIERSZE WIDOCZNEJ STRONY (`p_registration_ids`). Lista zgloszen
-- stronicuje po stronie serwera (do 200 wierszy), a panel odswieza powiazania
-- po kazdej decyzji, powiadomieniu i ponownej wysylce - zapytanie o cale
-- wydarzenie ciagneloby przy duzym kongresie tysiace wierszy na klikniecie.
-- Wiecej niz strona to `invalid_request`, NULL to pusty wynik.
--
-- `guest_count` LICZY GOSCI, KTORZY IDA ZA DECYZJA PROWADZACEGO: aktywnych
-- i zamknietych razem z nim (`_event_guest_closed_with_lead`). Ci drudzy wroca
-- przy ponownym zatwierdzeniu - organizator ma to przeczytac w oknie decyzji,
-- zanim kliknie.
--
-- Bramka jak lista zgloszen - `assert_editor_tenant()` deleguje do
-- `assert_event_admin_tenant()`, a nowy kod wola nastepce wprost.
CREATE OR REPLACE FUNCTION public.admin_event_registration_group_links(
  p_event_id uuid,
  p_registration_ids uuid[]
)
RETURNS TABLE (
  registration_id uuid,
  group_lead_registration_id uuid,
  lead_first_name text,
  lead_last_name text,
  guest_count integer,
  payment_status text,
  ticket_code_sent_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  -- Gorna granica strony `admin_event_registrations_list` - lustro panelu.
  IF cardinality(p_registration_ids) > 200 THEN
    RAISE EXCEPTION 'invalid_request: at most one page of registrations per call';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.group_lead_registration_id,
    lp.first_name,
    lp.last_name,
    COALESCE(gc.cnt, 0)::integer,
    r.payment_status,
    r.ticket_code_sent_at
  FROM public.event_registrations r
  LEFT JOIN public.event_registrations lr
    ON lr.id = r.group_lead_registration_id AND lr.tenant_id = r.tenant_id
  LEFT JOIN public.event_people lp
    ON lp.id = lr.person_id AND lp.tenant_id = lr.tenant_id
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM public.event_registrations gr
    WHERE gr.tenant_id = r.tenant_id
      AND gr.group_lead_registration_id = r.id
      AND (gr.status NOT IN ('cancelled', 'rejected')
           OR public._event_guest_closed_with_lead(gr, r))
  ) gc ON true
  WHERE r.tenant_id = v_tenant
    AND r.event_id = p_event_id
    AND r.id = ANY(p_registration_ids)
  ORDER BY r.created_at, r.id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_registration_group_links(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_registration_group_links(uuid, uuid[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_registration_group_links(uuid, uuid[]) IS
  'Panel zgloszen: powiazania grupy (gosc -> prowadzacy z imieniem i nazwiskiem, prowadzacy -> liczba gosci idacych za jego decyzja: aktywnych i zamknietych razem z nim), rozliczenie i znacznik wyslanego biletu. Tylko wskazane wiersze wydarzenia (strona listy, do 200). Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- g) PONOWNA WYSYLKA BILETU
-- ----------------------------------------------------------------------------
-- Baza nie wysyla maili - kasuje znacznik wysylki i oddaje identyfikator, od
-- ktorego serwer wola `_event_issue_ticket_codes` (zajecie, NOWY kod, mail,
-- potwierdzenie). Z `p_include_group` korzeniem jest prowadzacy, bo wydanie
-- od prowadzacego obejmuje cala grupe; bez niego - sam wiersz, zeby nie
-- rotowac kodow osobom, ktore o nic nie prosily.
--
-- ODMOWA ZAMIAST CISZY. Bilet dostaje wylacznie wiersz przyjety i rozliczony -
-- ten sam warunek, co w `_event_issue_ticket_codes`. Wiersz spoza niego
-- konczy sie `ticket_not_issuable`, a nie "wyslano 0", ktore organizator
-- przeczytalby jako awarie poczty.
--
-- ZYWA DZIERZAWA = BILET WLASNIE WYCHODZI. Cron albo wydanie po decyzji zajal
-- wiersz i wysyla mail z kodem, ktory WLASNIE wydal (dzierzawa 15 minut - ta
-- sama, co w `_event_issue_ticket_codes`). Skasowanie zajecia pozwoliloby
-- wydac kod od nowa: mail w drodze nioslby kod, ktory juz nie wpuszcza, a jego
-- potwierdzenie przepadloby po cichu (inna chwila zajecia). Organizator klika
-- ponowna wysylke najczesciej wlasnie przy plakietce „bilet niewyslany", czyli
-- dokladnie w tym stanie. Wskazany wiersz konczy sie wiec
-- `ticket_send_in_progress`, a wiersze grupy w trakcie wysylki sa pomijane -
-- ich bilet i tak zaraz wyjdzie. Wiersz WYSLANY trzyma chwile zajecia po
-- potwierdzeniu, wiec o dzierzawie mowi dopiero para z pustym `sent_at`.
CREATE OR REPLACE FUNCTION public.admin_event_ticket_resend(
  p_registration_id uuid,
  p_include_group boolean DEFAULT true
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
  v_root uuid;
BEGIN
  SELECT * INTO v_reg
  FROM public.event_registrations r
  WHERE r.id = p_registration_id AND r.tenant_id = v_tenant
  FOR UPDATE;

  IF v_reg.id IS NULL THEN
    RAISE EXCEPTION 'not_found: registration does not exist in this tenant';
  END IF;

  IF v_reg.status NOT IN ('approved', 'attended')
     OR v_reg.payment_status NOT IN ('paid', 'not_required') THEN
    RAISE EXCEPTION 'ticket_not_issuable: only an approved and settled registration gets a ticket';
  END IF;

  IF v_reg.ticket_code_sent_at IS NULL
     AND v_reg.ticket_code_claimed_at > now() - interval '15 minutes' THEN
    RAISE EXCEPTION 'ticket_send_in_progress: the ticket e-mail is being sent right now';
  END IF;

  v_root := CASE
    WHEN v_group THEN COALESCE(v_reg.group_lead_registration_id, v_reg.id)
    ELSE v_reg.id
  END;

  UPDATE public.event_registrations r SET
    ticket_code_sent_at = NULL,
    ticket_code_claimed_at = NULL,
    updated_at = now()
  WHERE r.tenant_id = v_tenant
    AND (r.id = v_reg.id
         OR (v_group AND (r.id = v_root OR r.group_lead_registration_id = v_root)))
    AND r.status IN ('approved', 'attended')
    AND r.payment_status IN ('paid', 'not_required')
    AND (r.ticket_code_sent_at IS NOT NULL
         OR r.ticket_code_claimed_at IS NULL
         OR r.ticket_code_claimed_at <= now() - interval '15 minutes');

  RETURN v_root;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_ticket_resend(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_ticket_resend(uuid, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_ticket_resend(uuid, boolean) IS
  'Ponowna wysylka biletu: kasuje znacznik wysylki przyjetych i rozliczonych wierszy (zgloszenie albo cala jego grupa) i oddaje identyfikator do wydania przez serwer. Wiersz nieprzyjety albo nierozliczony: ticket_not_issuable; wiersz, ktorego bilet wlasnie wychodzi (zywa dzierzawa): ticket_send_in_progress - wiersze grupy w tym stanie sa pomijane. Bramka: assert_event_admin_tenant().';
