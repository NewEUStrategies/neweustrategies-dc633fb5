-- events-harness: include
-- ============================================================================
-- KODY WYDARZEN: WYNIK WALIDATORA SKALARNY, ZAKUP PAKIETU BEZ WYJATKU PO PUDLE.
--
-- BLIZNIAK w pasie drizzle: `drizzle/migrations/0118_event_code_scalar_verdicts.sql`
-- (ten sam SQL wykonywalny, wpis w `src/lib/ci/migrationLaneParity.ts`).
-- Produkcja dostaje te poprawke dopiero po zastosowaniu go z panelu Lovable.
--
-- POPRAWKA W PRZOD do `20261001100000_event_code_guessing_lockdown.sql`, ktora
-- jest juz wdrozona (zapis wdrozenia `drizzle/migrations/0117_20261001100000_...`).
-- Wdrozonej migracji nie edytujemy: Supabase sledzi wersje, nie tresc, wiec
-- zmiana pliku nie zostalaby wykonana, a zapis 0117 przestalby byc jej kopia.
--
-- DEFEKT, KTORY ZOSTAWILA 20261001100000 (oba zmierzone w pgTAP
-- `supabase/tests/event_code_guessing_test.sql`):
--   1. `validate_b2b_coupon` i `validate_event_ticket_coupon` zwracaja ZBIOR
--      WIERSZY (RETURNS TABLE), a zostaja wykonywalne dla `authenticated`.
--      PostgREST stosuje filtry wolajacego do wyniku takiej funkcji:
--      `?error=neq.not_found` z naglowkiem
--      `Accept: application/vnd.pgrst.object+json` daje przy pudle 0 wierszy,
--      PostgREST odpowiada 406 i WYCOFUJE transakcje razem z zapisem pudla,
--      a przy istniejacym kodzie zwraca wiersz. Kubelek pudel nigdy sie nie
--      zapelnia, a 406 wobec 200 to wyrocznia istnienia kodu.
--   2. `event_package_purchase` (20260926130000) zamienia KAZDA odmowe wyceny
--      na wyjatek `refused_<powod>`. Wycena zapisuje pudlo dla `coupon_unknown`,
--      a wyjatek wycofuje ten zapis - zakup pakietu byl wiec nieograniczona
--      sonda kodow z odpowiedzia `refused_coupon_unknown` wobec dalszej odmowy.
--
-- ZASADA DLA KAZDEJ FUNKCJI, KTORA ZLICZA PUDLO: odpowiedz i zapis pudla musza
-- sie zatwierdzic RAZEM, a wolajacy nie moze ich rozdzielic. Dlatego (1) wynik
-- jest skalarny (PostgREST nie filtruje skalara, wiec nie wymusi wycofania
-- transakcji zaleznie od tresci odpowiedzi) i (2) po zapisaniu pudla funkcja
-- nie rzuca wyjatku. pgTAP przypina oba warunki.
--
-- ZMIANY:
--   C/D. `validate_b2b_coupon`, `validate_event_ticket_coupon`: te same
--      argumenty i ta sama logika co w 20261001100000, wynik to JEDEN obiekt
--      jsonb o kluczach dawnych kolumn. Zmiana typu wyniku wymaga DROP, wiec
--      granty stawiamy od nowa (PUBLIC i anon bez EXECUTE, authenticated
--      i service_role z EXECUTE). Odmowy sklada jeden pomocnik
--      `_coupon_refusal` - bez id, nazwy, rodzaju i procentu kodu.
--   H. `event_package_purchase`: pelne cialo z 20260926130000, jedyna roznica:
--      odmowa `coupon_unknown` z wyceny wraca WARTOSCIA
--      `{ok:false, reason:'coupon_unknown'}`, wiec zapis pudla sie zatwierdza.
--      Pozostale odmowy dalej sa wyjatkiem (nie zapisuja pudla).
--
-- ZADEN WOLAJACY SQL: walidatorow nie wola zadna funkcja w bazie ani funkcja
-- edge (sprawdzone grepem po `supabase/`), wiec DROP niczego nie zrywa.
--
-- KOLEJNOSC WDROZENIA: NAJPIERW KOD, POTEM TA MIGRACJA. Kod wdrozony razem
-- z 20261001100000 (main 8e81b23) czyta wynik walidatora jako
-- `(rows ?? [])[0]`; na obiekcie jsonb to `undefined`, wiec KAZDY poprawny kod
-- zostalby odrzucony jako `not_found` (bez rabatu - bezpiecznie, ale kupony
-- przestalyby dzialac). Kod z tej poprawki czyta oba ksztalty
-- (`parseCouponVerdict` w `src/lib/billing/coupons.ts`) i obie odpowiedzi
-- zakupu pakietu (wyjatek `refused_coupon_unknown` i wartosc z `reason`), wiec
-- po jego publikacji migracja moze wejsc w dowolnym momencie.
--
-- IDEMPOTENTNA: CREATE OR REPLACE, DROP ... IF EXISTS i bezstanowe
-- REVOKE/GRANT - drugi przebieg niczego nie zmienia (Lovable potrafi zastosowac
-- plik ponownie).
-- ============================================================================

-- C) KOD NA PLAN --------------------------------------------------------------
-- WYNIK TO JEDEN OBIEKT jsonb, NIE ZBIOR WIERSZY. Walidatory zostaja
-- wykonywalne dla `authenticated`, a PostgREST stosuje filtry wolajacego do
-- wyniku funkcji zwracajacej tabele: `?error=neq.not_found` z naglowkiem
-- `Accept: application/vnd.pgrst.object+json` daje przy pudle 0 wierszy,
-- PostgREST odpowiada 406 i WYCOFUJE transakcje razem z zapisem pudla - a przy
-- istniejacym kodzie zwraca wiersz. Darmowa wyrocznia mimo kubelka. Wyniku
-- skalarnego PostgREST nie filtruje, wiec odpowiedz i zapis pudla ida razem.
-- Zmiana typu wyniku wymaga DROP; granty stawiamy od nowa ponizej.
DROP FUNCTION IF EXISTS public.validate_b2b_coupon(text, uuid, integer, text);

-- Jedna odmowa dla wszystkich: bez id, nazwy, rodzaju i procentu, kwota nietknieta.
CREATE OR REPLACE FUNCTION public._coupon_refusal(p_error text, p_amount_cents integer)
RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'ok', false, 'error', p_error, 'coupon_id', NULL, 'discount_cents', 0,
    'final_cents', p_amount_cents, 'label', NULL, 'discount_kind', NULL,
    'discount_percent', NULL)
$$;
REVOKE ALL ON FUNCTION public._coupon_refusal(text, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.validate_b2b_coupon(_code text, _plan_id uuid, _amount_cents integer, _currency text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  c public.b2b_coupons%ROWTYPE;
  v_norm text := upper(trim(coalesce(_code,'')));
BEGIN
  IF v_norm = '' THEN
    RETURN public._coupon_refusal('empty_code', _amount_cents);
  END IF;
  IF _amount_cents IS NULL OR _amount_cents <= 0 THEN
    RETURN public._coupon_refusal('invalid_amount', coalesce(_amount_cents,0));
  END IF;
  -- Straznik PRZED wyszukaniem: przy pelnym kubelku nawet dobry kod nie
  -- dostaje odpowiedzi, wiec zablokowany nie ma wyroczni.
  PERFORM public._coupon_probe_guard();
  SELECT * INTO c FROM public.b2b_coupons
   WHERE tenant_id = public.public_tenant_id() AND upper(code) = v_norm;
  -- KLASA „NIE MA" = JEDNA ODPOWIEDZ. Brak kodu, kod obcego najemcy, kod
  -- wylaczony i kod przypiety do wydarzen (na planie nieuzywalny) daja bajt
  -- w bajt to samo co pudlo i ZLICZAJA pudlo - inaczej roznica odpowiedzi
  -- albo darmowa proba zdradzalaby, ze kod istnieje.
  IF NOT FOUND OR NOT c.active OR array_length(c.event_ids,1) IS NOT NULL THEN
    PERFORM public._coupon_probe_miss();
    RETURN public._coupon_refusal('not_found', _amount_cents);
  END IF;
  -- Zerowy UUID planu nadal jest tu konkretnym planem (it.fails w
  -- useValidateCoupon.test.ts) - ta migracja tego nie zmienia.
  IF array_length(c.plan_ids,1) IS NOT NULL AND _plan_id IS NOT NULL AND NOT (_plan_id = ANY(c.plan_ids)) THEN
    RETURN public._coupon_refusal('plan_not_eligible', _amount_cents);
  END IF;
  RETURN (SELECT to_jsonb(e) FROM public._b2b_coupon_evaluate(c, _amount_cents, _currency) e);
END $$;
REVOKE ALL ON FUNCTION public.validate_b2b_coupon(text, uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_b2b_coupon(text, uuid, integer, text) TO authenticated, service_role;

-- D) KOD NA BILET -------------------------------------------------------------
-- Ten sam powod co wyzej: wynik skalarny, wiec DROP i granty od nowa.
DROP FUNCTION IF EXISTS public.validate_event_ticket_coupon(text, uuid, uuid, integer, text);

CREATE OR REPLACE FUNCTION public.validate_event_ticket_coupon(_code text, _event_id uuid, _ticket_type_id uuid, _amount_cents integer, _currency text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  c public.b2b_coupons%ROWTYPE;
  v_norm text := upper(trim(coalesce(_code,'')));
BEGIN
  IF v_norm = '' THEN
    RETURN public._coupon_refusal('empty_code', _amount_cents);
  END IF;
  IF _amount_cents IS NULL OR _amount_cents <= 0 THEN
    RETURN public._coupon_refusal('invalid_amount', coalesce(_amount_cents,0));
  END IF;
  PERFORM public._coupon_probe_guard();
  SELECT * INTO c FROM public.b2b_coupons
   WHERE tenant_id = public.public_tenant_id() AND upper(code) = v_norm;
  -- KLASA „NIE MA" = JEDNA ODPOWIEDZ (jak w validate_b2b_coupon): brak, obcy
  -- najemca, wylaczony, kod INNEGO wydarzenia i kod tylko planowy. Kod innego
  -- wydarzenia jest dla tego wydarzenia nieodroznialny od pudla - to jest
  -- warunek akceptacji audytu.
  IF NOT FOUND OR NOT c.active
     OR (array_length(c.event_ids,1) IS NOT NULL AND (_event_id IS NULL OR NOT (_event_id = ANY(c.event_ids))))
     OR (array_length(c.event_ids,1) IS NULL AND array_length(c.plan_ids,1) IS NOT NULL) THEN
    PERFORM public._coupon_probe_miss();
    RETURN public._coupon_refusal('not_found', _amount_cents);
  END IF;
  -- Kod TEGO wydarzenia na inny bilet: odmowa zostaje (kupujacy ma kod
  -- z zaproszenia i trzeba mu powiedziec, ze wybral zly bilet), ale bez danych kodu.
  IF array_length(c.ticket_type_ids,1) IS NOT NULL AND (_ticket_type_id IS NULL OR NOT (_ticket_type_id = ANY(c.ticket_type_ids))) THEN
    RETURN public._coupon_refusal('ticket_not_eligible', _amount_cents);
  END IF;
  RETURN (SELECT to_jsonb(e) FROM public._b2b_coupon_evaluate(c, _amount_cents, _currency) e);
END $$;
REVOKE ALL ON FUNCTION public.validate_event_ticket_coupon(text, uuid, uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_event_ticket_coupon(text, uuid, uuid, integer, text) TO authenticated, service_role;

-- H) ZAKUP PAKIETU -------------------------------------------------------------
-- Pelne cialo z 20260926130000:140-284; jedyna zmiana: odmowa `coupon_unknown`
-- z wyceny wraca wartoscia zamiast wyjatkiem, zeby pudlo zapisane w kubelku
-- nie zostalo wycofane razem z transakcja.
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
  'Zakup pakietu. Dotyka dwoch pul (zestawy i miejsca na sali) pod blokada wiersza w ustalonej kolejnosci rodzaj-potem-pakiet, a kod rabatowy zuzywa w tej samej transakcji (blokada kodu, limit na osobe, licznik, wiersz realizacji). Wiersz realizacji wskazuje zamowienie (package_order_id), wiec anulowanie zamowienia umie oddac uzycie. Wycena liczona ponownie przez event_admission_quote. Odmowa coupon_unknown wraca wartoscia {ok:false, reason} (pudlo w kubelku musi przetrwac), pozostale odmowy rzucaja refused_<powod>.';
