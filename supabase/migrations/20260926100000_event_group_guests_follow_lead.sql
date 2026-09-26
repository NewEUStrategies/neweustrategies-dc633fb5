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
--      nietknieci (patrz nizej). Przyjecie jednego goscia
--      (`_event_group_admit_guest`) i petla po grupie (`_event_group_admit_guests`)
--      sa osobnymi funkcjami - wola je tez reczna wplata i naprawa.
--   c) Trigger platnosci nie wymaga juz `payment_order_id` - reczne `paid` /
--      `refund` organizatora dociera do gosci. Wynik niesie zamowienie TYLKO,
--      gdy instrukcja zmienila `payment_order_id` (tak pisze kazdy wynik
--      Stripe) - reczna wplata u prowadzacego z nieudanym zamowieniem Stripe
--      jest reczna. Gosc zachowuje wlasne zamowienie, gdy wynik przychodzi bez
--      zamowienia. Zwrot dotyczy tylko gosci, ktorzy ZAPLACILI. Reczna wplata
--      przyjmuje gosci Z KONTROLA MIEJSC, jak kaskada statusu - nadmiarowy
--      gosc staje w kolejce.
--   d) Wiersz, ktory WYCHODZI z approved/attended, traci znacznik wyslanego
--      (i niedoreczonego) biletu - ponowne przyjecie wyda i wysle nowy.
--   e) Cron widzi tez samodzielne zapisy na wydarzeniach w trybie RSVP.
--   f) `admin_event_registration_group_links` - panel widzi, kto jest gosciem
--      kogo i czy bilet wyszedl albo nie dotarl (dla wierszy WIDOCZNEJ strony).
--   g) `admin_event_ticket_resend` + `admin_event_ticket_resend_scope` -
--      organizator wysyla bilet ponownie, nie wchodzi w droge wysylce, ktora
--      wlasnie trwa, i NIE UNIEWAZNIA dzialajacego biletu adresu z listy
--      wykluczen (serwer pomija takie wiersze, `p_exclude_ids`).
--   h) `ticket_code_undeliverable_at` + czteroargumentowe
--      `_event_ticket_code_confirm(..., p_undeliverable)` - bilet, ktorego
--      poczta nie przyjela (adres wypisany albo pusty), nie udaje wyslanego.
--   i) `_event_group_repair_stranded_guests` - JEDNORAZOWA naprawa gosci
--      uwiezionych za prowadzacymi przyjetymi PRZED ta migracja. Migracja jej
--      NIE WOLA: przyjeci goscie dostaja maile z crona, wiec uruchomienie jest
--      decyzja wlasciciela (docs/WDROZENIE_BILETY_GOSCI_GRUPY_2026-09-26.md).
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
-- Trigger platnosci biegnie PRZED przelicznikiem, wiec reczna wplata liczy
-- pule sama (patrz c). Kolejnosc przybija asercja kwoty w 27_group_follow_lead.sql.
--
-- CZEGO TA MIGRACJA NIE ROBI (swiadomie, do decyzji produktu):
--   * nie naprawia wierszy ostemplowanych przez backfill 0044 - to jednorazowa
--     operacja na produkcji, nie migracja (SQL w notatce wdrozeniowej);
--   * nie wola naprawy z i) - patrz wyzej;
--   * nie odwoluje gosci JUZ przyjetych, gdy prowadzacy zostaje odrzucony albo
--     anulowany - ich kod QR nadal wpuszcza;
--   * nie sprawdza miejsc na sciezce STRIPE galezi `paid`
--     `_event_apply_outcome_to_group` - zamowienie oplacilo cala grupe naraz,
--     a nadsprzedaz tej sciezki jest znana i przybita w harnessie (20260830090000).

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
-- h) BILET NIEDORECZONY (kolumna - funkcje nizej juz ja czytaja)
--
-- `undeliverable` z serwera ZAMYKA zajecie jak wysylka (adres wypisany albo
-- pusty nie ozyje przy nastepnym ticku, a rotowanie kodu co minute tylko
-- zapelnialoby dziennik poczty), wiec sam `ticket_code_sent_at` klamal: panel
-- pokazywal „Bilet wyslany" przy bilecie, ktory nigdy nie wyszedl. Osobna
-- kolumna mowi, CZYM zamknieto zajecie. Zyje zawsze w parze z
-- `ticket_code_sent_at`: kazda droga, ktora kasuje znacznik wysylki, kasuje
-- tez ten.
-- ----------------------------------------------------------------------------
ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS ticket_code_undeliverable_at timestamptz;

COMMENT ON COLUMN public.event_registrations.ticket_code_undeliverable_at IS
  'Chwila, w ktorej wysylke biletu zamknieto jako NIEDORECZALNA (adres na liscie wykluczen albo brak adresu). Ustawiana razem z ticket_code_sent_at przez czteroargumentowe _event_ticket_code_confirm(p_undeliverable => true), kasowana wszedzie tam, gdzie znacznik wysylki.';

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

-- PRZYJECIE JEDNEGO GOSCIA NA MIEJSCE ALBO DO KOLEJKI.
--
-- Wspolne dla kaskady statusu, recznej wplaty i naprawy - wszystkie trzy maja
-- przyjmowac gosci TA SAMA regula. Wolajacy trzyma blokade wiersza goscia
-- i odpowiada za to, ze `sold_count` jest przeliczone (kaskada biegnie po
-- przeliczniku, reczna wplata przelicza sama).
--
-- Gosc juz w kolejce, dla ktorego nadal brak miejsca, zostaje na SWOJEJ
-- pozycji - nie przeskakuje nikogo.
CREATE OR REPLACE FUNCTION public._event_group_admit_guest(
  p_lead public.event_registrations,
  p_guest public.event_registrations
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_left integer;
BEGIN
  -- Liczymy PO kazdym gosciu od nowa: kazdy UPDATE nizej odpala przelicznik
  -- `sold_count` na koncu wlasnej instrukcji, wiec nastepny gosc widzi juz
  -- miejsce zajete przez poprzedniego.
  v_left := public._event_seats_left(p_lead.tenant_id, p_lead.event_id, p_guest.ticket_type_id);
  IF v_left IS NULL OR v_left > 0 THEN
    UPDATE public.event_registrations r SET
      status = 'approved',
      waitlist_position = NULL,
      cancelled_at = NULL,
      decided_by = p_lead.decided_by,
      decided_at = now(),
      decision_source = COALESCE(p_lead.decision_source, 'system'),
      qr_token_hash = encode(digest(public._event_new_qr_token(), 'sha256'), 'hex'),
      qr_issued_at = now(),
      -- Nowe przyjecie = nowy bilet. Kod rotuje wydanie, a mail wysle
      -- serwer (`issueAndSendTicketCodes`) albo cron.
      ticket_code_sent_at = NULL,
      ticket_code_claimed_at = NULL,
      ticket_code_undeliverable_at = NULL,
      promoted_at = CASE WHEN r.status = 'waitlist' THEN now() ELSE r.promoted_at END,
      updated_at = now()
    WHERE r.id = p_guest.id AND r.tenant_id = p_lead.tenant_id;
  ELSIF p_guest.status <> 'waitlist' THEN
    -- BRAK MIEJSCA NIE COFA DECYZJI O PROWADZACYM. Wyjatek wywrocilby
    -- decyzje organizatora (zatwierdzenie, zaksiegowana wplate) o calej
    -- grupie; gosc, ktory sie nie zmiescil, staje w kolejce jak kazdy zapis
    -- ponad pule i awansuje, gdy miejsce sie zwolni. Gosc przywracany
    -- z anulowania gubi date anulowania - kolejka nie jest anulowaniem.
    -- Rozliczenie zostaje (oplacony gosc czeka w kolejce oplacony).
    UPDATE public.event_registrations r SET
      status = 'waitlist',
      waitlist_position = public._event_next_waitlist_position(p_lead.tenant_id, p_lead.event_id),
      cancelled_at = NULL,
      decided_by = NULL,
      decided_at = now(),
      decision_source = 'capacity',
      qr_token_hash = NULL,
      qr_issued_at = NULL,
      updated_at = now()
    WHERE r.id = p_guest.id AND r.tenant_id = p_lead.tenant_id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._event_group_admit_guest(public.event_registrations, public.event_registrations)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._event_group_admit_guest(public.event_registrations, public.event_registrations) IS
  'Przyjecie jednego goscia grupy za prowadzacym: wolne miejsce -> approved (nowy kod, bilet do wydania, slad decyzji prowadzacego), brak miejsca -> kolejka (decision_source capacity, rozliczenie zostaje), gosc juz w kolejce zostaje na swojej pozycji. Wolajacy blokuje wiersz i dba o przeliczone sold_count.';

-- PRZYJECIE GRUPY ZA PRZYJETYM PROWADZACYM.
--
-- Petla kaskady statusu wyjeta do funkcji BEZ ZMIANY ZACHOWANIA - wola ja
-- trigger i naprawa gosci uwiezionych przed ta migracja. `p_prev` to stan
-- prowadzacego SPRZED przyjecia: z odrzucenia albo anulowania wracaja tez
-- goscie zamknieci RAZEM z nim (`_event_guest_closed_with_lead`). Naprawa
-- podaje samego prowadzacego (przyjety - predykat nie trafia nikogo).
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
  'Przyjecie gosci za przyjetym prowadzacym (p_lead), z przywroceniem gosci zamknietych razem z nim w stanie p_prev: rozliczeni -> _event_group_admit_guest, nieoplaceni czekaja na wplate (zamknieci wracaja do pending), osoba z innym aktywnym zapisem zostaje zamknieta. Wola ja kaskada statusu i _event_group_repair_stranded_guests.';

CREATE OR REPLACE FUNCTION public._tg_event_group_follow_lead_status()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_restamp boolean;
BEGIN
  -- PRZYJECIE. Z oczekiwania - i z odrzucenia albo anulowania: wtedy wracaja
  -- takze goscie zamknieci RAZEM z prowadzacym. Pomylkowe odrzucenie
  -- i ponowne zatwierdzenie to zwykly przebieg pracy organizatora; bez tego
  -- goscie zostawali zamknieci na zawsze, a jedyna droga powrotu bylo
  -- zatwierdzanie kazdego z osobna.
  IF NEW.status = 'approved'
     AND OLD.status IN ('draft', 'pending', 'waitlist', 'rejected', 'cancelled') THEN
    PERFORM public._event_group_admit_guests(NEW, OLD);

  -- ODRZUCENIE I ANULOWANIE. Tylko goscie, ktorzy jeszcze czekaja - przyjetych
  -- nie ruszamy (decyzja produktu, patrz naglowek). Kolumny ustawiamy pod CHECK-i:
  -- odrzucenie przez organizatora wymaga powodu (`rejection_has_reason`),
  -- anulowanie - daty (`cancelled_dated`, u prowadzacego wymuszonej tym samym
  -- CHECK-iem przed triggerem AFTER). Data anulowania i chwila decyzji sa
  -- STEMPLEM prowadzacego - po nim `_event_guest_closed_with_lead` rozpozna
  -- tych gosci przy ponownym przyjeciu.
  --
  -- KTO ZAMKNAL GOSCIA - tylko ten, kto WLASNIE podjal decyzje. Odrzuca
  -- wylacznie organizator (decyzja stempluje `decided_at`), wiec odrzucenie
  -- zawsze niesie jego slad - i predykat stempla go potrzebuje. Anulowanie
  -- bywa samodzielne (`event_registration_cancel`) albo zwrotem Stripe:
  -- zadne z nich nie rusza `decided_*` prowadzacego, wiec przepisanie ich
  -- zapisaloby gosciom „anulowal organizator X" za dawne zatwierdzenie.
  -- Bez nowego stempla decyzji gosc dostaje `system` bez autora i ZACHOWUJE
  -- wlasna notatke; przywrocenie anulowanych i tak idzie po `cancelled_at`.
  ELSIF NEW.status IN ('rejected', 'cancelled') THEN
    v_restamp := NEW.status = 'rejected' OR NEW.decided_at IS DISTINCT FROM OLD.decided_at;
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
      updated_at = now()
    WHERE r.tenant_id = NEW.tenant_id
      AND r.group_lead_registration_id = NEW.id
      AND r.status IN ('draft', 'pending', 'waitlist');
  END IF;

  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._tg_event_group_follow_lead_status() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._tg_event_group_follow_lead_status() IS
  'Kaskada statusu prowadzacego grupy na gosci: zatwierdzenie przyjmuje gosci rozliczonych (albo stawia ich w kolejce, gdy brak miejsca) i przywraca gosci zamknietych razem z prowadzacym (_event_group_admit_guests), odrzucenie i anulowanie zamyka gosci, ktorzy jeszcze czekaja - ze sladem decydujacego tylko wtedy, gdy ta instrukcja stemplowala decyzje prowadzacego. Nieoplaconych gosci przyjmuje trigger platnosci, przyjetych nie rusza.';

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
-- zamiast `p_order_id` (reczne `paid`/`refund` organizatora nie przynosi
-- zamowienia, a gosc nie moze zgubic wlasnego), zawezenie do najemcy prowadzacego, zwrot
-- tylko dla gosci, ktorzy zaplacili, reczna wplata z kontrola miejsc
-- i stala kolejnosc gosci (`created_at, id` - ta sama, co w kaskadzie
-- i w wydaniu biletow).
--
-- ZWROT DOTYCZY TEGO, KTO ZAPLACIL. Do tej migracji wynik docieral do gosci
-- tylko z zamowieniem Stripe, a te oplacaly cala grupe naraz. Reczny `refund`
-- organizatora dociera teraz do KAZDEGO goscia - bez tego warunku gosc
-- odrzucony albo wycofany przed wplata dostawal `refunded` (zwrot, ktorego nie
-- bylo) i `cancelled` w miejsce decyzji o odrzuceniu. Nieoplacony gosc, ktory
-- jeszcze czeka, i tak zostaje zamkniety - robi to kaskada statusu, bo zwrot
-- anuluje prowadzacego.
--
-- RECZNA WPLATA (`p_order_id IS NULL` - trigger podaje zamowienie tylko wtedy,
-- gdy wynik je PRZYNIOSL, patrz `_tg_event_group_follow_lead`) PRZYJMUJE
-- Z KONTROLA MIEJSC. Nieoplacony gosc nie trzyma miejsca, wiec pula mogla sie
-- tymczasem zapelnic, a `admin_event_registration_decide` 'paid' sprawdza
-- miejsce TYLKO dla prowadzacego. Przyjecie wszystkich naraz przepelnialo pule: CHECK
-- `event_ticket_types_sold_within_quota` wywracal cala decyzje (organizator
-- nie mogl zaksiegowac przelewu), a przy samej pojemnosci wydarzenia
-- nadsprzedaz przechodzila po cichu. Gosc jest wiec najpierw ROZLICZANY,
-- a potem przyjmowany ta sama regula, co w kaskadzie
-- (`_event_group_admit_guest`) - nadmiarowy czeka w kolejce oplacony.
-- Sciezka Stripe zostaje BEZ ZMIAN (patrz naglowek).
--
-- PULE PRZELICZAMY SAMI. Ten trigger (`event_registrations_group_follow_lead`)
-- biegnie PRZED `event_registrations_sync_ticket_sold`, a decyzja 'paid'
-- przyjmuje prowadzacego w tej samej instrukcji - `sold_count` nie zna go
-- jeszcze. Bez przeliczenia pierwszy gosc widzialby miejsce, ktore zajal
-- prowadzacy. Samo rozliczenie goscia przelicznika nie odpala (rusza go
-- tylko zmiana statusu, biletu albo najemcy).
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
      IF p_order_id IS NULL AND g.status IN ('draft','pending','waitlist') THEN
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
      END IF;
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
--
-- ZAMOWIENIE PRZEKAZUJEMY TYLKO, GDY TA INSTRUKCJA JE ZMIENILA. Reczna wplata
-- to NIE to samo, co "brak zamowienia": prowadzacy, ktorego platnosc odroczona
-- w Stripe przepadla, NOSI zamowienie (`payment_orders` -> wynik `unpaid`
-- zapisuje `payment_order_id` przy nieoplaconym wierszu), a 'paid' organizatora
-- kolumny nie rusza. Przekazanie `NEW.payment_order_id` wprost puszczalo taka
-- wplate galezia Stripe - bez kontroli miejsc (CHECK puli wywracal przelew,
-- sama pojemnosc przepelniala sie po cichu) - i stemplowalo gosciom nieudane
-- zamowienie. Kazdy wynik Stripe zapisuje `payment_order_id = zamowienie`
-- w TEJ SAMEJ instrukcji, a kazda proba zaplaty zaklada NOWE zamowienie, wiec
-- zmiana kolumny jest pewnym znakiem, ze wynik przyniosl zamowienie. Gdyby to
-- samo zamowienie wrocilo kiedys z `unpaid` do `paid` (Stripe tak nie robi:
-- nieudana platnosc odroczona zamyka sesje), wplata przeszlaby sciezka
-- z kontrola miejsc - ostrzej, nie gorzej.
CREATE OR REPLACE FUNCTION public._tg_event_group_follow_lead()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions','pg_temp'
AS $$
BEGIN
  IF NEW.group_lead_registration_id IS NULL
     AND NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    PERFORM public._event_apply_outcome_to_group(
      NEW.id,
      CASE WHEN NEW.payment_order_id IS DISTINCT FROM OLD.payment_order_id
           THEN NEW.payment_order_id END,
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
  NEW.ticket_code_undeliverable_at := NULL;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._tg_event_ticket_code_reset() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._tg_event_ticket_code_reset() IS
  'Wiersz wychodzacy z approved/attended do draft/pending/waitlist/rejected/cancelled traci znacznik wyslanego biletu (ticket_code_sent_at, ticket_code_claimed_at, ticket_code_undeliverable_at), zeby ponowne przyjecie wydalo i wyslalo nowy kod.';

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
-- mowi dopiero `ticket_code_sent_at`, a o tym, ze mail NIE DOTARL (adres na
-- liscie wykluczen) - `ticket_code_undeliverable_at`.
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
--
-- DROP przed CREATE: ksztalt wyniku urosl o `ticket_code_undeliverable_at`,
-- a `CREATE OR REPLACE` nie zmienia `RETURNS TABLE` (baza deweloperska
-- z wczesniejsza wersja tego pliku).
DROP FUNCTION IF EXISTS public.admin_event_registration_group_links(uuid, uuid[]);
CREATE FUNCTION public.admin_event_registration_group_links(
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
  ticket_code_sent_at timestamptz,
  ticket_code_undeliverable_at timestamptz
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
    r.ticket_code_sent_at,
    r.ticket_code_undeliverable_at
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
  'Panel zgloszen: powiazania grupy (gosc -> prowadzacy z imieniem i nazwiskiem, prowadzacy -> liczba gosci idacych za jego decyzja: aktywnych i zamknietych razem z nim), rozliczenie, znacznik wyslanego biletu i znacznik biletu niedoreczonego. Tylko wskazane wiersze wydarzenia (strona listy, do 200). Bramka: assert_event_admin_tenant().';

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
--
-- ADRES Z LISTY WYKLUCZEN NIE TRACI BILETU. Wydanie rotuje kod (i klucz
-- samoobslugi goscia) PRZED wysylka, a mail na zablokowany adres nie wyjdzie -
-- ponowna wysylka uniewazniala wiec dzialajacy bilet bez zastepstwa, a gosc
-- odbijal sie od bramki. Liste wykluczen zna tylko serwer (kategoria poczty),
-- wiec to on czyta zakres (`admin_event_ticket_resend_scope`), sprawdza
-- kazdy adres i podaje zablokowane wiersze w `p_exclude_ids`. Pominiety
-- wiersz ZACHOWUJE znacznik wysylki, wiec wydanie od korzenia go nie ruszy.
--
-- KOLEJNOSC BLOKAD JAK W WYDANIU: korzen, potem grupa po `created_at, id`
-- (`_event_issue_ticket_codes`). Blokada wskazanego wiersza PRZED korzeniem
-- (gosc, potem prowadzacy) zakleszczala sie z cronem, ktory wydaje od
-- prowadzacego; sprawdzenia i UPDATE ida dopiero na zablokowanym, swiezo
-- przeczytanym wierszu.
--
-- DROP przed CREATE: nowa sygnatura (`p_exclude_ids`) obok starej bylaby
-- przeciazeniem, a wywolanie z dwoma argumentami - niejednoznaczne.
DROP FUNCTION IF EXISTS public.admin_event_ticket_resend(uuid, boolean);
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
     OR v_reg.payment_status NOT IN ('paid', 'not_required') THEN
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
    AND r.payment_status IN ('paid', 'not_required')
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

-- ZAKRES PONOWNEJ WYSYLKI - DO SPRAWDZENIA LISTY WYKLUCZEN.
--
-- Dokladnie te wiersze, ktorym `admin_event_ticket_resend` skasuje znacznik
-- (ten sam warunek), z adresem i najemca - serwer pyta o kazdy
-- `checkSendAllowed` i dopiero wtedy wola ponowna wysylke. Tylko odczyt;
-- odmowy (`not_found`, `ticket_not_issuable`, `ticket_send_in_progress`)
-- zostaja przy `admin_event_ticket_resend` - wiersz spoza zakresu wraca tu
-- jako pusty wynik, a nie wyjatek.
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
    AND r.payment_status IN ('paid', 'not_required')
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

-- ----------------------------------------------------------------------------
-- h) WYNIK WYSYLKI Z ROZROZNIENIEM „NIEDORECZALNY"
-- ----------------------------------------------------------------------------
-- Czteroargumentowy wariant `_event_ticket_code_confirm` z 20260923110000:
-- `p_undeliverable = true` zapisuje obok znacznika wysylki, ze poczta adresu
-- nie przyjela. Nieudana wysylka (`p_sent = false`) kasuje oba znaczniki
-- niezaleznie od flagi: zajecie wraca do kolejki.
--
-- OSOBNA SYGNATURA, NIE `DEFAULT false` NA STAREJ. Serwer podaje flage TYLKO
-- jako `true`, a wysylke udana i ponowienie potwierdza trzema argumentami -
-- te wywolania dzialaja wiec tak samo na bazie sprzed tej migracji i po niej.
-- Trojargumentowy wariant z 0044 zostaje NIETKNIETY i nadal trzyma pare
-- znacznikow w porzadku: zamyka wylacznie wiersz z pustym `sent_at`, a taki
-- nigdy nie niesie `ticket_code_undeliverable_at`. `DEFAULT` na nowym
-- argumencie zrobilby wywolanie trojargumentowe NIEJEDNOZNACZNYM (dwie
-- pasujace funkcje), a `DROP` starej sygnatury rozsypalby jej uprawnienia
-- przybite w 26_group_tickets.sql - stad brak wartosci domyslnej.
CREATE OR REPLACE FUNCTION public._event_ticket_code_confirm(
  p_registration_id uuid,
  p_claimed_at timestamptz,
  p_sent boolean,
  p_undeliverable boolean
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
BEGIN
  UPDATE public.event_registrations reg SET
    ticket_code_sent_at = CASE WHEN p_sent THEN now() ELSE NULL END,
    ticket_code_claimed_at = CASE WHEN p_sent THEN reg.ticket_code_claimed_at ELSE NULL END,
    ticket_code_undeliverable_at = CASE
      WHEN p_sent AND COALESCE(p_undeliverable, false) THEN now()
      ELSE NULL
    END,
    updated_at = now()
  WHERE reg.id = p_registration_id
    AND reg.ticket_code_claimed_at = p_claimed_at
    AND reg.ticket_code_sent_at IS NULL;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public._event_ticket_code_confirm(uuid, timestamptz, boolean, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_ticket_code_confirm(uuid, timestamptz, boolean, boolean)
  TO service_role;

COMMENT ON FUNCTION public._event_ticket_code_confirm(uuid, timestamptz, boolean, boolean) IS
  'Wynik wysylki biletu dla TEGO zajecia (p_claimed_at) z rozroznieniem niedoreczalnego adresu: p_sent odnotowuje wysylke, p_undeliverable (tylko z p_sent) zapisuje ticket_code_undeliverable_at, nieudana wysylka zwalnia zajecie. Serwer wola ten wariant tylko dla adresu niedoreczalnego; wysylke i ponowienie potwierdza trojargumentowy z 20260923110000. Wylacznie service_role.';

-- ----------------------------------------------------------------------------
-- i) NAPRAWA GOSCI UWIEZIONYCH PRZED TA MIGRACJA (NIE WOLANA TUTAJ)
-- ----------------------------------------------------------------------------
-- Przed ta migracja zatwierdzenie prowadzacego (bilet z akceptacja, przeplyw
-- `approval`) i reczna wplata organizatora zostawialy gosci `pending` na
-- zawsze. Nowe triggery odpalaja dopiero przy NASTEPNEJ zmianie statusu albo
-- rozliczenia prowadzacego, a tej nie bedzie: 'approve' z `approved` to
-- `invalid_transition`, a 'paid' wymaga `unpaid`. Ponowna wysylka odmawia
-- oczekujacym (`ticket_not_issuable`). Bez naprawy te grupy - te z samego
-- zgloszenia - zostalyby bez biletow, o ile organizator nie przyjmie kazdego
-- goscia z osobna.
--
-- CO ROBI, dla prowadzacych approved/attended na wydarzeniach, ktore sie
-- jeszcze nie skonczyly (najstarsze najpierw, najwyzej `p_limit` grup), z goscmi
-- w draft/pending/waitlist - albo, u prowadzacego OPLACONEGO, z goscmi
-- przyjetymi, ale nieoplaconymi (dopisani do przyjetego prowadzacego przed
-- jego reczna wplata, ktora do nich nie dotarla):
--   1. prowadzacy OPLACONY - to, co zrobilby dzis trigger platnosci: reczna
--      galaz `paid` (`p_order_id` NULL, wiec z kontrola miejsc; gosc zachowuje
--      wlasne zamowienie - zamowienie Stripe i tak docieralo do gosci);
--   2. potem petla kaskady (`_event_group_admit_guests`): rozliczeni goscie na
--      wolne miejsce, reszta do kolejki, nieoplaceni czekaja na wplate.
-- Wynik: liczba gosci, ktorzy w tym wywolaniu DOSTALI PRAWO DO BILETU
-- (przyjeci i rozliczeni, a przed wywolaniem nie). Drugie wywolanie nie ma kogo
-- przyjac (gosc bez miejsca czeka w kolejce na swojej pozycji) i oddaje 0.
--
-- MIGRACJA JEJ NIE WOLA. Przyjeci goscie maja pusty znacznik wysylki, wiec
-- cron wysle im maile z biletem - wdrozenie nie moze samo pisac do ludzi.
-- Wlasciciel uruchamia ja RAZ, swiadomie (notatka wdrozeniowa).
--
-- BLOKADY JAK DECYZJA ORGANIZATORA: najpierw wydarzenia, potem bilety (obie
-- listy po `id`), dopiero potem wiersze zgloszen - zablokowane w petli
-- i sprawdzone PONOWNIE, wiec prowadzacy odrzucony w miedzyczasie odpada.
-- Wylacznie service_role: funkcja przechodzi po WSZYSTKICH najemcach.
CREATE OR REPLACE FUNCTION public._event_group_repair_stranded_guests(p_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_ids uuid[];
  v_lead public.event_registrations;
  v_waiting uuid[];
  v_n integer := 0;
BEGIN
  v_ids := ARRAY(
    SELECT l.id
    FROM public.event_registrations l
    JOIN public.events e ON e.id = l.event_id AND e.tenant_id = l.tenant_id
    WHERE l.group_lead_registration_id IS NULL
      AND l.status IN ('approved', 'attended')
      AND COALESCE(e.ends_at, e.starts_at + interval '1 day') > now()
      AND EXISTS (
        SELECT 1 FROM public.event_registrations g
        WHERE g.tenant_id = l.tenant_id
          AND g.group_lead_registration_id = l.id
          AND (g.status IN ('draft', 'pending', 'waitlist')
               OR (l.payment_status = 'paid'
                   AND g.payment_status = 'unpaid'
                   AND g.status NOT IN ('cancelled', 'rejected'))))
    ORDER BY l.created_at, l.id
    LIMIT GREATEST(COALESCE(p_limit, 500), 1));

  PERFORM 1 FROM public.events e
  WHERE (e.tenant_id, e.id) IN (
    SELECT l.tenant_id, l.event_id FROM public.event_registrations l WHERE l.id = ANY(v_ids))
  ORDER BY e.id
  FOR UPDATE;

  PERFORM 1 FROM public.event_ticket_types t
  WHERE (t.tenant_id, t.id) IN (
    SELECT r.tenant_id, r.ticket_type_id FROM public.event_registrations r
    WHERE r.id = ANY(v_ids) OR r.group_lead_registration_id = ANY(v_ids))
  ORDER BY t.id
  FOR UPDATE;

  FOR v_lead IN
    SELECT l.* FROM public.event_registrations l
    WHERE l.id = ANY(v_ids)
      AND l.group_lead_registration_id IS NULL
      AND l.status IN ('approved', 'attended')
    ORDER BY l.created_at, l.id
    FOR UPDATE
  LOOP
    -- Goscie bez prawa do biletu PRZED naprawa - po niej liczymy, ilu je dostalo.
    v_waiting := ARRAY(
      SELECT g.id FROM public.event_registrations g
      WHERE g.tenant_id = v_lead.tenant_id
        AND g.group_lead_registration_id = v_lead.id
        AND g.status NOT IN ('cancelled', 'rejected')
        AND NOT (g.status IN ('approved', 'attended')
                 AND g.payment_status IN ('paid', 'not_required')));

    IF v_lead.payment_status = 'paid' THEN
      PERFORM public._event_apply_outcome_to_group(v_lead.id, NULL, 'paid');
    END IF;
    PERFORM public._event_group_admit_guests(v_lead, v_lead);

    v_n := v_n + (
      SELECT count(*)::integer FROM public.event_registrations g
      WHERE g.id = ANY(v_waiting)
        AND g.status IN ('approved', 'attended')
        AND g.payment_status IN ('paid', 'not_required'));
  END LOOP;

  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public._event_group_repair_stranded_guests(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_group_repair_stranded_guests(integer) TO service_role;

COMMENT ON FUNCTION public._event_group_repair_stranded_guests(integer) IS
  'Jednorazowa, idempotentna naprawa gosci uwiezionych za prowadzacymi przyjetymi przed 20260926100000: oplaconym prowadzacym rozlicza gosci jak reczna wplata (z kontrola miejsc), potem przyjmuje gosci petla kaskady. Najwyzej p_limit grup, tylko wydarzenia, ktore sie nie skonczyly. Wynik: liczba gosci, ktorzy dostali prawo do biletu. Migracja jej NIE wola (cron wysyla przyjetym maile). Wylacznie service_role.';
