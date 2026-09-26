-- Odrzucenie i anulowanie prowadzacego zamyka takze gosci JUZ przyjetych,
-- a platnosc Stripe przyjmuje gosci z kontrola miejsc.
-- events-harness: include
--
-- PRZYCZYNA 1 - KOD QR PO ODWOLANIU GRUPY NADAL WPUSZCZAL. Kaskada statusu
-- z 20260926100000 (`_tg_event_group_follow_lead_status`) zamykala przy
-- odrzuceniu i anulowaniu prowadzacego wylacznie gosci, ktorzy jeszcze
-- czekali (draft/pending/waitlist). Gosc JUZ przyjety - zatwierdzony razem
-- z prowadzacym, oplacony w Stripe albo przyjety osobno - zostawal `approved`
-- z zywym `qr_token_hash`, wiec jego bilet z maila przechodzil przez bramke
-- (`admin_event_onsite_*` dopasowuja wlasnie ten skrot), choc grupa zostala
-- odwolana. Organizator musial wylapac i anulowac kazdego goscia z osobna.
--
-- PRZYCZYNA 2 - STRIPE PRZYJMOWAL GOSCI BEZ MIEJSC. Galaz `paid`
-- `_event_apply_outcome_to_group` z zamowieniem Stripe (20260830090000,
-- przepisana w 20260922230000 i 20260926100000) promowala `pending/waitlist ->
-- approved` BEZWARUNKOWO. Pula mogla sie zapelnic miedzy kasa a webhookiem
-- (nieoplacony gosc nie trzyma miejsca), a wtedy:
--   * przy puli biletu CHECK `event_ticket_types_sold_within_quota` wywracal
--     CALE ksiegowanie - pieniadze pobrane, zgloszenie nietkniete, bez biletu;
--   * przy samej pojemnosci wydarzenia nadsprzedaz przechodzila po cichu.
-- Reczna wplata organizatora miala juz kontrole miejsc (20260926100000);
-- Stripe zostal poza nia swiadomie, do tej migracji.
--
-- CO ROBI TA MIGRACJA
--   a) KASKADA ZAMYKA PRZYJETYCH. Odrzucenie i anulowanie prowadzacego zamyka
--      gosci `approved` razem z czekajacymi - TYM SAMYM stemplem decyzji
--      (`_event_guest_closed_with_lead`), wiec ponowne przyjecie prowadzacego
--      przywraca ich przez te sama sciezke, co czekajacych: rozliczony gosc
--      wraca z kontrola miejsc i NOWYM kodem, a bilet wychodzi ponownie
--      (trigger `event_registrations_ticket_code_reset` kasuje znacznik
--      wysylki przy wyjsciu z przyjecia). Skrot kodu QR znika w tej samej
--      instrukcji - stary bilet przestaje wpuszczac od razu.
--      `attended` i `no_show` ZOSTAJA: obecnosc (albo nieobecnosc) to fakt
--      z sali, a nie zapis, ktory da sie odwolac - raport frekwencji musi go
--      zachowac. Tak samo odmawia samodzielne wycofanie (`event_finished`).
--   b) ZWOLNIONE MIEJSCA AWANSUJA KOLEJKE. Kazdy przyjety gosc zajmowal
--      miejsce; decyzja o prowadzacym promuje z kolejki JEDNA osobe (za jego
--      miejsce). Kaskada promuje tyle osob, ilu przyjetych gosci zamknela -
--      osobno dla kazdego biletu (`_event_waitlist_promote`, ta sama regula
--      co przycisk panelu, z kontrola miejsc pod blokada puli). Awansowani
--      czekaja w panelu na powiadomienie (`promoted_at` bez
--      `waitlist_notified_at`), a bilet dostaja z crona.
--   c) STRIPE Z KONTROLA MIEJSC. Wynik `paid` rozlicza kazdego czekajacego
--      goscia, przelicza pule (trigger platnosci biegnie PRZED przelicznikiem
--      `sold_count`, a prowadzacy zajal miejsce w tej samej instrukcji)
--      i przyjmuje go ta sama regula, co kaskada i reczna wplata
--      (`_event_group_admit_guest`): wolne miejsce - przyjety z nowym kodem,
--      brak miejsca - kolejka, OPLACONY (`decision_source = 'capacity'`),
--      awans przy zwolnieniu miejsca. Ksiegowanie przestaje sie wywracac
--      na gosciach, a nadsprzedaz z pojemnosci wydarzenia - przechodzic.
--      Gosc juz przyjety (albo obecny) dostaje tylko rozliczenie, jak dotad.
--
-- CZEGO TA MIGRACJA NIE ROBI:
--   * nie wysyla gosciom maila o odwolaniu - bilet przestaje dzialac w bazie,
--     a zawiadomienie o decyzji jest, jak dotad, akcja organizatora;
--   * nie zwraca pieniedzy gosciom odwolanej grupy - zwrot to decyzja
--     organizatora (Stripe), a jego wynik juz dociera do gosci;
--   * nie awansuje kolejki za gosci anulowanych ZWROTEM (galaz `refunded`
--     `_event_apply_outcome_to_group`, bez zmian). Ta galaz biegnie PRZED
--     kaskada statusu, gdy nieoplaceni goscie tej samej grupy jeszcze stoja
--     w kolejce - awans w tym miejscu potrafil przyjac goscia grupy, ktora
--     kaskada chwile pozniej zamyka (przyjecie, kod i zdarzenie „awans"
--     dla osoby odwolanej w tej samej instrukcji). Miejsce prowadzacego
--     awansuje funkcja wyniku platnosci, jak dotad;
--   * nie zmienia sciezki samego prowadzacego: wyczerpana pula przy wplacie
--     Stripe za pojedyncze zgloszenie nadal rzuca (defekt przybity
--     w 25_payment_binding, decyzja produktu).
--
-- KOLEJNOSC TRIGGEROW bez zmian (patrz 20260926100000): platnosc ->
-- przelicznik `sold_count` -> kaskada statusu (`zz`).

-- ----------------------------------------------------------------------------
-- a) + b) KASKADA STATUSU: ODRZUCENIE I ANULOWANIE ZAMYKA TEZ PRZYJETYCH
-- ----------------------------------------------------------------------------
-- Cialo z 20260926100000. Zmiany: galaz odrzucenia i anulowania obejmuje
-- `approved` i promuje kolejke za zwolnione miejsca. Galaz przyjecia bez zmian.
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
  'Kaskada statusu prowadzacego grupy na gosci: zatwierdzenie przyjmuje gosci rozliczonych (albo stawia ich w kolejce, gdy brak miejsca) i przywraca gosci zamknietych razem z prowadzacym (_event_group_admit_guests), odrzucenie i anulowanie zamyka gosci czekajacych i przyjetych (kod QR przestaje wpuszczac; attended/no_show zostaja) - ze sladem decydujacego tylko wtedy, gdy ta instrukcja stemplowala decyzje prowadzacego - i promuje kolejke za zwolnione miejsca. Nieoplaconych gosci przyjmuje trigger platnosci.';

-- ----------------------------------------------------------------------------
-- b) AWANS KOLEJKI ZA MIEJSCA ZWOLNIONE PRZEZ GOSCI
-- ----------------------------------------------------------------------------
-- `p_ticket_types` - bilet kazdego zamknietego goscia, ktory zajmowal miejsce
-- (jeden element = jedno miejsce). Awans idzie osobno dla kazdego biletu, bo
-- miejsce nalezy do jego puli; `_event_waitlist_promote` sprawdza wolne
-- miejsca pod blokada puli i nie awansuje ponad nie. Bilet NULL (zapis bez
-- cennika) awansuje po calym wydarzeniu - tak samo liczy go pojemnosc.
-- Pusta albo NULL tablica - nic do zrobienia.
CREATE OR REPLACE FUNCTION public._event_group_promote_freed(
  p_tenant uuid,
  p_event_id uuid,
  p_ticket_types uuid[]
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
      p_tenant, p_event_id, f.ticket_type_id, f.seats)->>'promoted')::integer, 0);
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public._event_group_promote_freed(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._event_group_promote_freed(uuid, uuid, uuid[]) IS
  'Awans z kolejki rezerwowej za miejsca zwolnione przez gosci grupy: jeden element tablicy = jedno zwolnione miejsce danego biletu (NULL = bez cennika). Osobno dla kazdego biletu, przez _event_waitlist_promote (kontrola miejsc pod blokada). Zwraca liczbe awansowanych.';

-- ----------------------------------------------------------------------------
-- c) WYNIK PLATNOSCI PROWADZACEGO NA GOSCIACH
-- ----------------------------------------------------------------------------
-- Cialo z 20260926100000. Zmiany:
--   * galaz `paid` NIE rozroznia juz Stripe od recznej wplaty przy przyjeciu:
--     kazdy czekajacy gosc jest rozliczany, pula przeliczana, a przyjecie idzie
--     przez `_event_group_admit_guest` (miejsce albo kolejka). Zamowienie
--     nadal trafia do goscia tylko wtedy, gdy wynik je przyniosl
--     (`COALESCE(p_order_id, r.payment_order_id)`). Pozostale galezie bez zmian.
--
-- PULE PRZELICZAMY SAMI (patrz 20260926100000): ten trigger biegnie PRZED
-- `event_registrations_sync_ticket_sold`, a samo rozliczenie goscia
-- przelicznika nie odpala.
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

COMMENT ON FUNCTION public._event_apply_outcome_to_group(uuid, uuid, text) IS
  'Wynik platnosci prowadzacego na gosciach grupy: paid rozlicza czekajacych i przyjmuje ich z kontrola miejsc (_event_group_admit_guest - miejsce albo kolejka, takze na sciezce Stripe), przyjetym tylko rozlicza; refunded anuluje oplaconych; partial_refund i unpaid tylko rozliczaja. Zamowienie trafia do goscia tylko, gdy wynik je przyniosl.';
