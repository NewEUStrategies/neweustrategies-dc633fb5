-- ============================================================================
-- PAKIET GRUPOWY: KOD KWOTOWY SCHODZI Z KAZDEGO MIEJSCA, A UZYCIE KODU
-- JEST ZUZYWANE RAZEM Z ZAMOWIENIEM.
--
-- BLIZNIAKA w pasie drizzle/migrations (ten sam SQL wykonywalny, wpis
-- w `src/lib/ci/migrationLaneParity.ts`) dopisuje integrator PO scaleniu
-- rownoleglych galezi tej serii - numer drizzle nadaje sie w JEDNYM miejscu,
-- zeby dwie galezie nie wziely tego samego. Bramka parytetu czyta tylko pliki
-- drizzle, wiec brak blizniaka NIE jest dla niej czerwony: bez niego produkcja
-- (pas Lovable/drizzle) tej poprawki po prostu nie dostanie.
--
-- FINDING. Kasa zapisu grupowego (createCheckoutOrder + groupOrderPricing.ts,
-- c60df9e) zdejmuje kod kwotowy z KAZDEGO miejsca. Pakiet grupowy
-- (/events/<slug>/packages) liczy jednak osobny silnik bazy -
-- `event_admission_quote` - i ten silnik odejmowal kod RAZ od ceny calego
-- pakietu: pakiet 5 miejsc za 3200 zl z kodem „-50 zl" kosztowal 3150 zl, a te
-- same piec osob kupujacych pojedynczo dostaloby 5 x 50 zl. Dokladnie to
-- zglosil wlasciciel: „kod na stala kwote odejmuje sie raz od calego
-- zamowienia". `event_package_purchase` przepisywal te liczby do zamowienia.
--
-- TRZY DEFEKTY NA TEJ SAMEJ SCIEZCE, domkniete razem:
--   1. `applies_discount` (20260922220000) nie istnial dla tej funkcji. Kod
--      TYLKO odslaniajacy ukryte bilety ma obie kwoty NULL, a
--      GREATEST(LEAST(NULL, cena), 0) = cena - czyli pakiet ZA DARMO
--      (sprawdzone na PostgreSQL 16). Teraz odmowa z nazwa
--      `coupon_no_discount`, a kwoty przechodza przez COALESCE.
--   2. Zakres `ticket_type_ids` byl sprawdzany wylacznie dla wejsciowki.
--      Studio kodow (EventCodesPanel) nie wypelnia `package_ids`, wiec kod
--      zawezony do jednego biletu dzialal na KAZDY pakiet. Pakiet ma swoj
--      rodzaj wejsciowki (`ticket_type_id`) - i po nim sprawdzamy zakres,
--      z ta sama NAZWA odmowy, ktora ta wycena daje juz wejsciowce
--      (`coupon_other_ticket_type`; kasa biletu, `validate_event_ticket_coupon`,
--      mowi na to `ticket_not_eligible`). Kod, ktory WPROST wymienia pakiet
--      w `package_ids`, ma pierwszenstwo: admin nazwal ten pakiet po imieniu.
--   3. `event_package_purchase` NIE zuzywal kodu: ani `redemptions_count`,
--      ani wiersza w `b2b_coupon_redemptions`. Limit „Liczba uzyc: 1" i limit
--      na osobe nie dzialaly na pakietach wcale.
--
-- DLACZEGO ZUZYCIE TUTAJ, A NIE W KASIE. Zamowienie pakietu NIE przechodzi
-- przez createCheckoutOrder ani przez payment_orders: `payment_order_id`
-- w `event_package_orders` nie jest ustawiany przez zadna funkcje, a status
-- „oplacone" nadaje organizator (`admin_event_package_order_set_status`,
-- faktura). Nic innego tego kodu nie zuzyje, wiec podwojnego liczenia nie ma -
-- jedynym miejscem jest zakup, pod ta sama blokada co pule miejsc.
--
-- DLACZEGO NIE `redeem_b2b_coupon`. Funkcja rozstrzyga najemce po
-- `public_tenant_id()` (host zadania), a wycena i zakup pakietu - po
-- `_caller_tenant()` (profil wolajacego). Przy rozjezdzie obu kod znaleziony
-- przez wycene nie znalazlby sie przy zuzyciu i zakup padalby bez powodu.
-- Zuzycie powtarza wiec TE SAME kroki (blokada wiersza, limit na osobe PRZED
-- licznikiem, warunkowy UPDATE licznika, wiersz realizacji z user_id),
-- zawezone do najemcy zakupu.
--
-- LICZNIK LICZY ZAMOWIENIA, NIE MIEJSCA - tak samo jak kasa zapisu grupowego
-- (jedno `redeem_b2b_coupon` na zamowienie). Rabat jest od miejsca, uzycie od
-- zamowienia; mowi o tym podpowiedz w studiu kodow.
--
-- CZEGO NIE ZMIENIA: sygnatur (typy klienta bez zmian), grantow, blokad
-- i kolejnosci blokad (rodzaj, potem pakiet, potem kod - kasa biletu blokuje
-- sam kod, wiec cyklu nie ma), kodow procentowych (procent od sumy to procent
-- od kazdego miejsca) ani zwrotu uzycia przy anulowaniu zamowienia (osobna
-- sprawa - admin_event_package_order_set_status).
-- ============================================================================

-- 1) WYCENA
CREATE OR REPLACE FUNCTION public.event_admission_quote(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public._caller_tenant();
  v_ticket_type_id uuid := NULLIF(p_payload->>'ticket_type_id', '')::uuid;
  v_package_id uuid := NULLIF(p_payload->>'package_id', '')::uuid;
  v_code text := upper(btrim(COALESCE(p_payload->>'coupon_code', '')));
  v_kind text;
  v_audience text;
  v_requires_verification boolean;
  v_min_tier_rank integer;
  v_price integer;
  v_currency text;
  v_quota integer;
  v_sold integer;
  v_sales_from timestamptz;
  v_sales_to timestamptz;
  v_seats integer := 1;
  v_max_per_person integer;
  v_event_id uuid;
  v_is_active boolean;
  v_owned integer := 0;
  v_coupon public.b2b_coupons;
  v_discount integer := 0;
  v_used_by_user integer := 0;
  -- Rodzaj wejsciowki, po ktorym sprawdzamy zakres kodu: dla wejsciowki ona
  -- sama, dla pakietu - rodzaj, w ktory zamienia sie kazde jego miejsce.
  v_scope_type uuid;
  v_code_cents integer;
  v_per_seat integer;
BEGIN
  IF v_uid IS NULL OR v_tenant IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sign_in_required');
  END IF;

  IF (v_ticket_type_id IS NULL) = (v_package_id IS NULL) THEN
    RAISE EXCEPTION 'invalid_payload: give exactly one of ticket_type_id or package_id';
  END IF;

  IF v_ticket_type_id IS NOT NULL THEN
    v_kind := 'ticket';
    v_scope_type := v_ticket_type_id;
    SELECT t.event_id, t.audience, t.requires_verification, t.min_tier_rank,
           t.price_cents, t.currency, t.quota, t.sold_count, t.sales_from, t.sales_to,
           t.is_active, t.max_per_person
      INTO v_event_id, v_audience, v_requires_verification, v_min_tier_rank,
           v_price, v_currency, v_quota, v_sold, v_sales_from, v_sales_to,
           v_is_active, v_max_per_person
    FROM public.event_ticket_types t
    WHERE t.id = v_ticket_type_id AND t.tenant_id = v_tenant;
  ELSE
    v_kind := 'package';
    SELECT p.event_id, p.audience, p.requires_verification, p.min_tier_rank,
           p.price_cents, p.currency, p.quota, p.sold_count, p.sales_from, p.sales_to,
           p.is_active, p.seats, p.ticket_type_id
      INTO v_event_id, v_audience, v_requires_verification, v_min_tier_rank,
           v_price, v_currency, v_quota, v_sold, v_sales_from, v_sales_to,
           v_is_active, v_seats, v_scope_type
    FROM public.event_ticket_packages p
    WHERE p.id = v_package_id AND p.tenant_id = v_tenant;
  END IF;

  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF NOT v_is_active THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'inactive');
  END IF;

  IF v_sales_from IS NOT NULL AND now() < v_sales_from THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sales_not_open',
                              'sales_from', v_sales_from);
  END IF;
  IF v_sales_to IS NOT NULL AND now() >= v_sales_to THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sales_closed');
  END IF;

  IF v_quota IS NOT NULL AND v_sold >= v_quota THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sold_out');
  END IF;

  IF v_min_tier_rank > 0 AND NOT public.has_tier_rank(v_min_tier_rank) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tier_required',
                              'min_tier_rank', v_min_tier_rank);
  END IF;

  IF v_audience NOT IN ('public', 'member') AND v_requires_verification
     AND NOT public.event_audience_qualifies(v_audience) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'audience_not_verified',
                              'audience', v_audience);
  END IF;

  IF v_kind = 'ticket' AND v_max_per_person IS NOT NULL THEN
    SELECT count(*)::integer INTO v_owned
    FROM public.event_registrations r
    JOIN public.event_people pe
      ON pe.id = r.person_id AND pe.tenant_id = r.tenant_id
    WHERE r.tenant_id = v_tenant
      AND r.ticket_type_id = v_ticket_type_id
      AND pe.user_id = v_uid
      AND r.status NOT IN ('cancelled', 'rejected');
    IF v_owned >= v_max_per_person THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'per_person_limit',
                                'max_per_person', v_max_per_person, 'owned', v_owned);
    END IF;
  END IF;

  IF v_code <> '' THEN
    SELECT * INTO v_coupon FROM public.b2b_coupons c
    WHERE c.tenant_id = v_tenant AND upper(c.code) = v_code;

    IF v_coupon.id IS NULL OR NOT v_coupon.active THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_unknown');
    END IF;
    IF v_coupon.valid_from IS NOT NULL AND now() < v_coupon.valid_from THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_not_yet_valid');
    END IF;
    IF v_coupon.valid_until IS NOT NULL AND now() >= v_coupon.valid_until THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_expired');
    END IF;
    IF v_coupon.max_redemptions IS NOT NULL
       AND v_coupon.redemptions_count >= v_coupon.max_redemptions THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_exhausted');
    END IF;

    IF v_coupon.max_redemptions_per_user IS NOT NULL THEN
      SELECT count(*)::integer INTO v_used_by_user
      FROM public.b2b_coupon_redemptions r
      WHERE r.coupon_id = v_coupon.id AND r.user_id = v_uid
        AND r.tenant_id = v_tenant;
      IF v_used_by_user >= v_coupon.max_redemptions_per_user THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'coupon_used_by_you');
      END IF;
    END IF;

    IF array_length(v_coupon.event_ids, 1) IS NOT NULL
       AND NOT (v_event_id = ANY (v_coupon.event_ids)) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_other_event');
    END IF;
    -- ZAKRES BILETU OBEJMUJE TEZ PAKIET. Wczesniej ten warunek mial
    -- `v_kind = 'ticket'`, wiec kod „tylko na Standard" dzialal na pakiet
    -- dowolnego rodzaju - studio kodow nie wypelnia `package_ids`, wiec nic
    -- innego go nie zawezalo.
    --
    -- WYJATEK: pakiet wymieniony WPROST w `package_ids`. Kod „Standard + pakiet
    -- P5" (zapisany SQL-em - studio tego pola nie ma) odmawialby inaczej wlasnie
    -- na P5, ktory admin nazwal. Dla wejsciowki `v_kind = 'package'` jest
    -- falszem, wiec `v_package_id` NULL nie robi z warunku NULL-a.
    IF array_length(v_coupon.ticket_type_ids, 1) IS NOT NULL
       AND NOT (v_scope_type = ANY (v_coupon.ticket_type_ids))
       AND NOT (v_kind = 'package' AND v_package_id = ANY (v_coupon.package_ids)) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_other_ticket_type');
    END IF;
    IF v_kind = 'package' AND array_length(v_coupon.package_ids, 1) IS NOT NULL
       AND NOT (v_package_id = ANY (v_coupon.package_ids)) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_other_package');
    END IF;
    -- KOD TYLKO ODSLANIAJACY nie ma kwoty. Bez tej odmowy obie kwoty NULL
    -- przechodzily przez LEAST/GREATEST (ktore pomijaja NULL) jako rabat
    -- rowny CENIE - pakiet wychodzil za zero zlotych i bez limitu.
    IF NOT v_coupon.applies_discount THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_no_discount');
    END IF;
    IF v_coupon.currency IS NOT NULL AND v_coupon.currency <> v_currency THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_other_currency');
    END IF;

    IF v_coupon.discount_kind = 'percent' THEN
      -- Procent od sumy to procent od kazdego miejsca - bez rozbicia.
      -- `bigint`, bo cena razy procent wychodzi poza integer przy drogich
      -- pakietach.
      v_discount := ((v_price::bigint * COALESCE(v_coupon.discount_percent, 0)) / 100)::integer;
    ELSE
      -- KOD KWOTOWY DZIALA NA MIEJSCE: min(kod, cena_pakietu / miejsca) za
      -- kazde miejsce. Liczymy to jako min(kod x miejsca, cena), bo to jest
      -- ta sama liczba bez dzielenia - a dzielenie calkowite gubiloby RESZTE:
      -- pakiet za 1000,00 zl na 3 miejsca to 333,33 zl i 1 grosz reszty, wiec
      -- kod wiekszy od ceny miejsca zostawialby do zaplaty 1 grosz zamiast
      -- zera. Gdy kod pokrywa kazde miejsce w calosci, rabat jest CALA cena
      -- (reszta tez), a na miejsce pokazujemy cene miejsca zaokraglona w dol -
      -- ta jedna etykieta moze sie roznic od rabatu o mniej niz grosz na
      -- miejsce, suma nigdy.
      v_code_cents := COALESCE(v_coupon.discount_cents, 0);
      IF v_code_cents::bigint * v_seats >= v_price THEN
        v_discount := v_price;
        v_per_seat := v_price / v_seats;
      ELSE
        v_discount := v_code_cents * v_seats;
        v_per_seat := v_code_cents;
      END IF;
    END IF;
    v_discount := GREATEST(LEAST(v_discount, v_price), 0);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'kind', v_kind,
    'event_id', v_event_id,
    'audience', v_audience,
    'seats', v_seats,
    'currency', v_currency,
    'price_cents', v_price,
    'discount_cents', v_discount,
    'total_cents', v_price - v_discount,
    'coupon_id', v_coupon.id,
    'coupon_code', NULLIF(v_code, ''),
    -- Ekran zakupu pokazuje „Rabat (N x kwota)" - bez tych dwoch pol musialby
    -- zgadywac rodzaj kodu z proporcji kwot.
    'discount_kind', v_coupon.discount_kind,
    'discount_per_seat_cents', v_per_seat,
    'seats_left', CASE WHEN v_quota IS NULL THEN NULL ELSE v_quota - v_sold END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_admission_quote(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_admission_quote(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_admission_quote(jsonb) IS
  'Jedna odpowiedz na cztery pytania ekranu zakupu: kwalifikacja, pula i okno, cena przed rabatem i po kodzie. Kod kwotowy schodzi z KAZDEGO miejsca pakietu (najwyzej do ceny miejsca), kod bez rabatu jest odmowa coupon_no_discount. Odmowa ma NAZWE (reason) bedaca kluczem slownika.';

-- 2) ZAKUP PAKIETU
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

    INSERT INTO public.b2b_coupon_redemptions (
      tenant_id, coupon_id, order_id, user_id, applied_cents, original_cents, currency
    ) VALUES (
      v_tenant, v_coupon_id, NULL, v_uid, v_discount, v_total + v_discount, v_pkg.currency
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
  'Zakup pakietu. Dotyka dwoch pul (zestawy i miejsca na sali) pod blokada wiersza w ustalonej kolejnosci rodzaj-potem-pakiet, a kod rabatowy zuzywa w tej samej transakcji (blokada kodu, limit na osobe, licznik, wiersz realizacji). Wycena liczona ponownie przez event_admission_quote.';
