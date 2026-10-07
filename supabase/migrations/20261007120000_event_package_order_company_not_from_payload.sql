-- events-harness: include
-- ============================================================================
-- ZAKUP PAKIETU: FIRMA ZAMOWIENIA NIE PRZYCHODZI Z LADUNKU KUPUJACEGO.
--
-- DEFEKT (szew TypeScript <-> SQL). `event_package_purchase` jest SECURITY
-- DEFINER wykonywalna dla `authenticated` i wpisywala
-- `event_package_orders.company_id` wprost z `p_payload->>'company_id'`
-- (20261001210000:180, wczesniej 20260824080000:1242). Jedyna kontrola to
-- zlozony klucz obcy (tenant_id, company_id) -> crm_companies, czyli
-- „firma istnieje w tym najemcy", nie „kupujacy ma prawo ja wskazac".
-- Skutki dowolnej firmy z kartoteki CRM wskazanej przez kupujacego:
--   * lista uczestnikow wydarzenia i eksport pokazuja jej nazwe przy
--     zamowieniu (20260927000203: LEFT JOIN crm_companies ON o.company_id),
--   * rezerwacja miejsc pakietu trafia na os czasu TEJ firmy w CRM
--     (20260927000401: COALESCE(..., po.company_id)),
--   * most faktur przypina firme nabywcy z NIP-u tylko na PUSTYM polu
--     (20260927000202: `o.company_id IS NULL`) - wartosc kupujacego blokowala
--     wiec prawdziwe przypiecie na zawsze,
--   * blad klucza obcego (23503) wobec sukcesu byl wyrocznia istnienia
--     identyfikatorow firm w kartotece CRM najemcy.
-- Klient nigdy nie wysylal tej wartosci (`EventPackagesPurchase.tsx`:
-- `companyId: null`), ale typ wejscia ja dopuszczal, a test atrapy
-- utrwalal ksztalt ladunku z `company_id` - kontrakt istnial tylko w TS.
--
-- ZASADA (ta sama co w 20260927000200, sekcja CRM): firme zamowienia ustala
-- organizator - most faktur przy wystawieniu albo panel administracyjny -
-- nigdy prosba kupujacego. Klucz `company_id` w ladunku (takze pusty) to
-- `forbidden_field`, a zamowienie powstaje z `company_id` NULL.
--
-- ZMIANA: pelne cialo z 20261001210000:169-321; roznice tylko trzy -
-- usunieta zmienna `v_company_id`, odmowa klucza `company_id` po walidacji
-- `package_id`, NULL w kolumnie `company_id` INSERT-u.
--
-- KOLEJNOSC WDROZENIA: dowolna. Klient nie wysyla klucza (TS: typ wejscia
-- `PackagePurchaseInput` nie ma juz pola firmy), wiec stary i nowy kod dzialaja
-- z obiema wersjami funkcji.
--
-- IDEMPOTENTNA: CREATE OR REPLACE i bezstanowe REVOKE/GRANT.
-- Straznik klasy (funkcja SECURITY DEFINER dla anon/authenticated czytajaca
-- klucz tozsamosci z ladunku bez bramki redakcji):
-- supabase/tests/ts_sql_contract_test.sql (sekcja „ladunek").
-- ============================================================================

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
  -- FIRME NA ZAMOWIENIU USTALA ORGANIZATOR, NIE KUPUJACY. Przypiecie
  -- `company_id` robi most faktur przy WYSTAWIENIU (decyzja administratora,
  -- 20260927000200) i tylko na pustym polu - wartosc od kupujacego wyprzedzala
  -- te decyzje, a potem blokowala ja na zawsze. Klucz w ladunku (nawet pusty)
  -- to blad wolajacego, nie cicha zmiana znaczenia.
  IF p_payload ? 'company_id' THEN
    RAISE EXCEPTION 'forbidden_field: company_id is assigned by the organizer';
  END IF;

  v_quote := public.event_admission_quote(jsonb_build_object(
    'package_id', v_package_id,
    'coupon_code', COALESCE(p_payload->>'coupon_code', '')
  ));

  IF NOT (v_quote->>'ok')::boolean THEN
    -- PUDLO WRACA WARTOSCIA, NIE WYJATKIEM. Wycena zapisala wlasnie pudlo
    -- w kubelku uzytkownika (`_coupon_probe_miss`); wyjatek wycofalby ten zapis
    -- razem z cala transakcja, a zakup pakietu bylby nieograniczona wyrocznia
    -- kodow. Przed tym miejscem zakup niczego nie zapisal, wiec powrot
    -- zatwierdza wylacznie pudlo. Pozostale odmowy niczego nie zliczaja i rzucaja
    -- jak dotad (`refused_<powod>`).
    IF v_quote->>'reason' = 'coupon_unknown' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_unknown');
    END IF;
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
    v_tenant, v_pkg.event_id, v_package_id, v_uid, NULL,
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
  'Zakup pakietu. Dotyka dwoch pul (zestawy i miejsca na sali) pod blokada wiersza w ustalonej kolejnosci rodzaj-potem-pakiet, a kod rabatowy zuzywa w tej samej transakcji (blokada kodu, limit na osobe, licznik, wiersz realizacji). Wiersz realizacji wskazuje zamowienie (package_order_id), wiec anulowanie zamowienia umie oddac uzycie. Wycena liczona ponownie przez event_admission_quote. Odmowa coupon_unknown wraca wartoscia {ok:false, reason} (pudlo w kubelku musi przetrwac), pozostale odmowy rzucaja refused_<powod>. Firme zamowienia ustala organizator (most faktur, panel) - klucz company_id w ladunku to forbidden_field.';
