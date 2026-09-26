-- ============================================================================
-- PAKIET GRUPOWY: ANULOWANIE ZAMOWIENIA ODDAJE UZYCIE KODU RABATOWEGO,
-- A PRZYWROCENIE ZAMOWIENIA ZUZYWA JE Z POWROTEM.
-- events-harness: include
--
-- BLIZNIAK w pasie drizzle:
-- `drizzle/migrations/0060_event_package_order_cancel_returns_coupon.sql`
-- (ten sam SQL wykonywalny, wpis w `src/lib/ci/migrationLaneParity.ts`).
-- Produkcja dostaje te poprawke dopiero po zastosowaniu go z panelu Lovable -
-- PO `0056_event_package_coupon_per_seat.sql`, bo ta migracja przepisuje
-- `event_package_purchase` z tamtej.
--
-- PRZYCZYNA. Od 20260926110000 zakup pakietu zuzywa kod rabatowy: podnosi
-- `b2b_coupons.redemptions_count` i dopisuje wiersz `b2b_coupon_redemptions`.
-- Ten wiersz NIE WSKAZYWAL zamowienia: `order_id` to klucz do payment_orders,
-- a pakiet rozlicza sie faktura, wiec zostawal NULL. Zmiana statusu
-- (`admin_event_package_order_set_status`, 20260827221214) nie miala wiec czego
-- oddac i anulowane zamowienie trzymalo uzycie na zawsze: kod „Liczba uzyc: 1"
-- z zamowienia, ktore organizator anulowal, byl dla nastepnego kupujacego
-- wyczerpany, a limit na osobe odbijal tego samego kupujacego przy ponownym
-- zakupie. To jest zgloszenie „anulowanie zamowienia pakietu nie zwraca uzycia
-- kodu" (docs/WDROZENIE_KOD_KWOTOWY_NA_BILET_2026-09-26.md, „Poza zakresem").
--
-- CO ROBI:
--   1. `b2b_coupon_redemptions.package_order_id` - wskazanie zamowienia pakietu,
--      ktore zuzylo to uzycie. Klucz obcy ZLOZONY (tenant_id, package_order_id)
--      -> event_package_orders (tenant_id, id): wiersz realizacji nie wskaze
--      zamowienia innego najemcy. ON DELETE SET NULL (package_order_id) Z LISTA
--      KOLUMN (PostgreSQL 15+, precedens 20260923120000): goly SET NULL
--      zerowalby tez `tenant_id`, ktore jest NOT NULL, i skasowanie zamowienia
--      padaloby na naruszeniu NOT NULL. Skasowane zamowienie zostawia uzycie
--      policzone - tak jak dotad. CHECK: wiersz wskazuje zamowienie platnosci
--      ALBO zamowienie pakietu, nigdy oba. Indeks unikalny czesciowy: jedno
--      zamowienie pakietu ma najwyzej jedno uzycie (licznik liczy zamowienia,
--      nie miejsca - 20260926110000); sluzy tez kluczowi obcemu przy kasowaniu.
--   2. `event_package_orders.coupon_released_at` - ZATRZASK. Ustawiany przy
--      anulowaniu TYLKO wtedy, gdy anulowanie naprawde oddalo powiazane uzycie.
--      Powrot z anulowania zuzywa kod z powrotem WYLACZNIE przy ustawionym
--      zatrzasku i od razu go czysci. Bez zatrzasku powrot zamowienia, ktorego
--      realizacji nie dalo sie powiazac (stare dane, niejednoznaczne), zuzylby
--      kod DRUGI raz - bo jego stary wiersz realizacji nadal istnieje. CHECK:
--      zatrzask stoi wylacznie na zamowieniu anulowanym (ten sam wzor co
--      `event_package_orders_cancelled_stamp`).
--   3. `event_package_purchase` - cialo z 20260926110000 slowo w slowo; jedyna
--      zmiana: wiersz realizacji dostaje `package_order_id = v_order_id`
--      (i zdanie o tym w COMMENT).
--   4. `admin_event_package_order_set_status` - dotychczasowe zachowanie
--      (walidacja stanu, blokada wiersza, znaczniki paid_at i cancelled_at,
--      wycofanie wolnych miejsc przy anulowaniu) plus dwie galezie:
--      A. WEJSCIE w 'cancelled' z innego stanu: kasuje powiazana realizacje
--         (w najemcy zamowienia), zdejmuje ja z licznika kodu (GREATEST(0, ...))
--         i ustawia zatrzask - tylko jesli cokolwiek skasowala. Ponowne
--         anulowanie zamowienia juz anulowanego nie robi z kodem nic.
--      B. WYJSCIE z 'cancelled' (do dowolnego stanu) przy ustawionym zatrzasku:
--         blokada wiersza kodu, limit na osobe PRZED licznikiem (jak w zakupie)
--         - `coupon_restore_used_by_buyer`, warunkowy UPDATE licznika -
--         `coupon_restore_exhausted`, wiersz realizacji z powrotem (rabat
--         i cena z zamowienia), zatrzask wyczyszczony. Odmowa wycofuje CALA
--         zmiane statusu: zamowienie zostaje anulowane, z zatrzaskiem.
--         NIE sprawdza `active` ani okna waznosci kodu: rabat siedzi juz
--         w `amount_cents`, a powrot zamowienia nie jest nowym uzyciem, tylko
--         przywroceniem starego. Kod skasowany w miedzyczasie (klucz obcy
--         zamowienia zeruje `coupon_id`) albo spoza najemcy zamowienia -
--         zatrzask znika, zuzywac nie ma czego.
--      'refunded' ZATRZYMUJE uzycie: zwrot pieniedzy rozlicza zamowienie,
--      ktore sie odbylo, a nie cofa go. `refunded -> cancelled` oddaje uzycie
--      jak kazde inne wejscie w anulowanie.
--   5. `_event_package_coupon_link_backfill()` - dopiecie danych sprzed tej
--      migracji (wylacznie service_role, przechodzi po WSZYSTKICH najemcach):
--      (1) wiaze niepowiazane realizacje (order_id NULL i package_order_id
--      NULL) z zamowieniami po DOKLADNYM dopasowaniu - najemca, kod, kupujacy,
--      `created_at` (zakup wstawia oba wiersze w jednej transakcji, wiec
--      now() jest ten sam), rabat, cena przed rabatem, waluta - i tylko pary
--      jednoznaczne 1:1; (2) zamowieniom JUZ anulowanym, z powiazana
--      realizacja i bez zatrzasku, oddaje uzycie i stawia zatrzask.
--      Idempotentna: drugie wywolanie zwraca {linked: 0, released: 0}.
--      Migracja wola ja raz, na koncu.
--
-- KOLEJNOSC BLOKAD: najpierw wiersz zamowienia, potem wiersz kodu - w zmianie
-- statusu i w dopieciu (zamowienia blokowane po `id`). Zakup blokuje rodzaj,
-- pakiet i kod, a zamowienie WSTAWIA - nigdy nie blokuje istniejacego, wiec
-- z ta kolejnoscia cyklu nie ma. Kasa biletu (`redeem_b2b_coupon`) blokuje sam
-- kod i nie dotyka zamowien pakietow.
--
-- CZEGO NIE ROBI:
--   * nie przywraca zaproszen ani miejsc po powrocie z anulowania - jak dotad
--     organizator zaprasza ponownie (`admin_event_package_seat_invite`);
--   * nie oddaje puli zestawow ani miejsc sali (`sold_count`) przy anulowaniu -
--     osobna sprawa, ta migracja dotyka wylacznie kodu rabatowego;
--   * nie wiaze realizacji niejednoznacznych (np. dwa zakupy tym samym kodem,
--     przez te sama osobe, w jednej transakcji) ani takich, ktorym cos sie nie
--     zgadza co do grosza. Te zostaja niepowiazane: anulowanie ich nie oddaje,
--     a powrot z anulowania ich nie zuzywa (brak zatrzasku) - licznik nigdy nie
--     liczy podwojnie, najwyzej trzyma uzycie jak przed ta migracja;
--   * nie zmienia sygnatur, typow zwracanych ani grantow istniejacych funkcji
--     i nie dotyka `payment_orders`;
--   * nie uzywa `public_tenant_id()` - najemca to najemca DOMOWY administratora
--     (`assert_event_admin_tenant()`), jak w calym panelu.
-- ============================================================================

-- 1) WSKAZANIE ZAMOWIENIA PAKIETU NA WIERSZU REALIZACJI
ALTER TABLE public.b2b_coupon_redemptions
  ADD COLUMN IF NOT EXISTS package_order_id uuid;

ALTER TABLE public.b2b_coupon_redemptions
  DROP CONSTRAINT IF EXISTS b2b_coupon_redemptions_package_order_fkey;
ALTER TABLE public.b2b_coupon_redemptions
  ADD CONSTRAINT b2b_coupon_redemptions_package_order_fkey
  FOREIGN KEY (tenant_id, package_order_id)
  REFERENCES public.event_package_orders (tenant_id, id)
  ON DELETE SET NULL (package_order_id);

ALTER TABLE public.b2b_coupon_redemptions
  DROP CONSTRAINT IF EXISTS b2b_coupon_redemptions_one_order_kind;
ALTER TABLE public.b2b_coupon_redemptions
  ADD CONSTRAINT b2b_coupon_redemptions_one_order_kind
  CHECK (order_id IS NULL OR package_order_id IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS b2b_coupon_redemptions_package_order_key
  ON public.b2b_coupon_redemptions (package_order_id)
  WHERE package_order_id IS NOT NULL;

COMMENT ON COLUMN public.b2b_coupon_redemptions.package_order_id IS
  'Zamowienie pakietu grupowego, ktore zuzylo to uzycie kodu (event_package_purchase). Anulowanie zamowienia kasuje ten wiersz i oddaje uzycie; NULL = realizacja kasy biletu (order_id) albo stara realizacja pakietu, ktorej nie dalo sie jednoznacznie powiazac.';

-- 2) ZATRZASK ODDANEGO UZYCIA NA ZAMOWIENIU
ALTER TABLE public.event_package_orders
  ADD COLUMN IF NOT EXISTS coupon_released_at timestamptz;

ALTER TABLE public.event_package_orders
  DROP CONSTRAINT IF EXISTS event_package_orders_coupon_released_stamp;
ALTER TABLE public.event_package_orders
  ADD CONSTRAINT event_package_orders_coupon_released_stamp
  CHECK (coupon_released_at IS NULL OR status = 'cancelled');

COMMENT ON COLUMN public.event_package_orders.coupon_released_at IS
  'Zatrzask: anulowanie oddalo powiazane uzycie kodu rabatowego. Powrot z anulowania zuzywa kod z powrotem WYLACZNIE przy ustawionym zatrzasku i czysci go. Stoi tylko na zamowieniu anulowanym.';

-- 3) ZAKUP PAKIETU - wiersz realizacji wskazuje zamowienie
CREATE OR REPLACE FUNCTION public.event_package_purchase(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public._caller_tenant();
  v_package_id uuid := NULLIF(p_payload->>'package_id', '')::uuid;
  v_company_id uuid := NULLIF(p_payload->>'company_id', '')::uuid;
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

  v_quote := public.event_admission_quote(jsonb_build_object(
    'package_id', v_package_id,
    'coupon_code', COALESCE(p_payload->>'coupon_code', '')
  ));

  IF NOT (v_quote->>'ok')::boolean THEN
    RAISE EXCEPTION 'refused_%: %', v_quote->>'reason', v_quote->>'reason';
  END IF;

  v_total := (v_quote->>'total_cents')::integer;
  v_discount := (v_quote->>'discount_cents')::integer;
  v_coupon_id := NULLIF(v_quote->>'coupon_id', '')::uuid;

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
    v_tenant, v_pkg.event_id, v_package_id, v_uid, v_company_id,
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
$$;

REVOKE ALL ON FUNCTION public.event_package_purchase(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_package_purchase(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_package_purchase(jsonb) IS
  'Zakup pakietu. Dotyka dwoch pul (zestawy i miejsca na sali) pod blokada wiersza w ustalonej kolejnosci rodzaj-potem-pakiet, a kod rabatowy zuzywa w tej samej transakcji (blokada kodu, limit na osobe, licznik, wiersz realizacji). Wiersz realizacji wskazuje zamowienie (package_order_id), wiec anulowanie zamowienia umie oddac uzycie. Wycena liczona ponownie przez event_admission_quote.';

-- 4) ZMIANA STATUSU ZAMOWIENIA - anulowanie oddaje uzycie kodu, powrot je zuzywa
--
-- Cialo z 20260827221214 (jedyna definicja do tej pory) plus galezie A i B
-- opisane w naglowku. Bramka: `assert_event_admin_tenant()` - to jest to samo,
-- co wycofany alias `assert_editor_tenant()`, z ktorego korzystala stara wersja
-- (20260825190728), tylko bez posrednika.
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
  v_released integer := 0;
  v_coupon_id uuid;
  v_per_user integer;
BEGIN
  IF v_status NOT IN ('pending', 'paid', 'cancelled', 'refunded') THEN
    RAISE EXCEPTION 'invalid_status: unknown order status';
  END IF;

  -- KOLEJNOSC BLOKAD: najpierw zamowienie, potem (w galeziach A i B) kod.
  -- Zakup nigdy nie blokuje istniejacego zamowienia, wiec cyklu nie ma.
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
    WITH gone AS (
      DELETE FROM public.b2b_coupon_redemptions r
      WHERE r.package_order_id = v_id AND r.tenant_id = v_tenant
      RETURNING r.coupon_id
    ), per_coupon AS (
      SELECT g.coupon_id, count(*)::integer AS n
      FROM gone g
      GROUP BY g.coupon_id
    ), returned AS (
      UPDATE public.b2b_coupons c
      SET redemptions_count = GREATEST(0, c.redemptions_count - p.n), updated_at = now()
      FROM per_coupon p
      WHERE c.id = p.coupon_id AND c.tenant_id = v_tenant
      RETURNING c.id
    )
    SELECT COALESCE(sum(p.n), 0)::integer INTO v_released FROM per_coupon p;

    IF v_released > 0 THEN
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
  'Zmiana statusu zamowienia pakietu (pending, paid, cancelled, refunded) przez administratora najemcy. Wejscie w cancelled wycofuje wolne miejsca i ODDAJE powiazane uzycie kodu rabatowego (zatrzask coupon_released_at); powrot z anulowania zuzywa je z powrotem albo odmawia (coupon_restore_used_by_buyer, coupon_restore_exhausted) i wtedy nie zmienia niczego. refunded zatrzymuje uzycie. Blokady: zamowienie, potem kod.';

-- 5) DOPIECIE DANYCH SPRZED TEJ MIGRACJI
--
-- Wylacznie service_role: funkcja przechodzi po WSZYSTKICH najemcach, a jej
-- jedynym wolajacym jest ta migracja (i ewentualnie operator z konsoli).
CREATE OR REPLACE FUNCTION public._event_package_coupon_link_backfill()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_linked integer := 0;
  v_released integer := 0;
  v_n integer;
  v_row record;
BEGIN
  -- (1) WIAZANIE. Zakup wstawial zamowienie i realizacje w jednej transakcji,
  -- wiec `created_at` obu wierszy to ten sam now(). Kwoty musza sie zgadzac co
  -- do grosza. Para przechodzi TYLKO wtedy, gdy realizacja pasuje do jednego
  -- zamowienia, a zamowienie do jednej realizacji - dwa zakupy tym samym kodem
  -- przez te sama osobe w jednej transakcji sa nierozroznialne i zostaja
  -- niepowiazane. Zamowienie z juz powiazana realizacja albo z zatrzaskiem
  -- (uzycie oddane) nie dostaje drugiej.
  WITH candidates AS (
    SELECT r.id AS redemption_id,
           o.id AS order_id,
           count(*) OVER (PARTITION BY r.id) AS per_redemption,
           count(*) OVER (PARTITION BY o.id) AS per_order
    FROM public.b2b_coupon_redemptions r
    JOIN public.event_package_orders o
      ON o.tenant_id = r.tenant_id
     AND o.coupon_id = r.coupon_id
     AND o.buyer_user_id IS NOT DISTINCT FROM r.user_id
     AND o.created_at = r.created_at
     AND o.discount_cents = r.applied_cents
     AND o.amount_cents + o.discount_cents = r.original_cents
     AND o.currency = r.currency
    WHERE r.order_id IS NULL
      AND r.package_order_id IS NULL
      AND o.coupon_released_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.b2b_coupon_redemptions l
        WHERE l.package_order_id = o.id
      )
  )
  UPDATE public.b2b_coupon_redemptions r
  SET package_order_id = c.order_id
  FROM candidates c
  WHERE r.id = c.redemption_id
    AND c.per_redemption = 1
    AND c.per_order = 1;
  GET DIAGNOSTICS v_linked = ROW_COUNT;

  -- (2) ZAMOWIENIA JUZ ANULOWANE. Anulowane przed ta migracja trzymaja uzycie,
  -- ktorego stara zmiana statusu nie oddala. Te same kroki co galaz A zmiany
  -- statusu i ta sama kolejnosc blokad: zamowienie (po `id`), potem kod.
  FOR v_row IN
    SELECT o.id, o.tenant_id
    FROM public.event_package_orders o
    WHERE o.status = 'cancelled'
      AND o.coupon_released_at IS NULL
      AND EXISTS (
        SELECT 1 FROM public.b2b_coupon_redemptions r
        WHERE r.package_order_id = o.id AND r.tenant_id = o.tenant_id
      )
    ORDER BY o.id
    FOR UPDATE OF o
  LOOP
    WITH gone AS (
      DELETE FROM public.b2b_coupon_redemptions r
      WHERE r.package_order_id = v_row.id AND r.tenant_id = v_row.tenant_id
      RETURNING r.coupon_id
    ), per_coupon AS (
      SELECT g.coupon_id, count(*)::integer AS n
      FROM gone g
      GROUP BY g.coupon_id
    ), returned AS (
      UPDATE public.b2b_coupons c
      SET redemptions_count = GREATEST(0, c.redemptions_count - p.n), updated_at = now()
      FROM per_coupon p
      WHERE c.id = p.coupon_id AND c.tenant_id = v_row.tenant_id
      RETURNING c.id
    )
    SELECT COALESCE(sum(p.n), 0)::integer INTO v_n FROM per_coupon p;

    IF v_n > 0 THEN
      UPDATE public.event_package_orders o
      SET coupon_released_at = now()
      WHERE o.id = v_row.id AND o.tenant_id = v_row.tenant_id;
      v_released := v_released + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('linked', v_linked, 'released', v_released);
END;
$$;

REVOKE ALL ON FUNCTION public._event_package_coupon_link_backfill() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_package_coupon_link_backfill() TO service_role;

COMMENT ON FUNCTION public._event_package_coupon_link_backfill() IS
  'Dopiecie danych sprzed 20260926130000 (service_role, wszyscy najemcy): wiaze niepowiazane realizacje kodu z zamowieniami pakietow po dokladnym dopasowaniu 1:1 (najemca, kod, kupujacy, created_at, kwoty, waluta), a zamowieniom juz anulowanym oddaje uzycie i stawia zatrzask coupon_released_at. Idempotentna; zwraca {linked, released}.';

SELECT public._event_package_coupon_link_backfill();
