-- events-harness: include
-- ============================================================================
-- KODY WYDARZEN: WALIDACJA, WYCENA I ZAKUP PAKIETU TYLKO Z SERWERA,
-- Z KUBELKIEM PUDEL TAKZE PO ADRESIE.
--
-- DEFEKT (ten sam co N-13-1 dla kodow planu, 20261007120200). Trzy funkcje
-- odpowiadajace na pytanie „czy ten kod istnieje" byly wykonywalne dla
-- `authenticated`, a limit prob mialy tylko w kubelku KONTA (30 pudel / 10 min):
--   1. `validate_event_ticket_coupon` (20261001210000:128) - kasa i podglad
--      wejsciowki wolaly ja JWT kupujacego,
--   2. `event_admission_quote` (20261001100000:349) - ekran zakupu pakietu
--      wolal ja WPROST z przegladarki,
--   3. `event_package_purchase` (20261007120000) - liczy wycene ponownie, wiec
--      kazde wywolanie z kodem to tez sonda (pudlo wraca wartoscia).
-- Limit po adresie zyje w TS (`codeProbeLimit.server.ts`), wiec zalogowany
-- wolajacy PostgREST wprost omijal go calkowicie: farma kont za jednym adresem
-- zgadywala kody wydarzen 30 pudel na konto co 10 minut, bez sufitu na adres.
--
-- ZMIANA (wzorzec 20261007120200: funkcja tylko dla `service_role`, najemca,
-- konto i solony skrot adresu JAWNIE, pudlo liczone w obu kubelkach):
--   A. `_validate_event_ticket_coupon(najemca, konto, adres, ...)` - rdzen
--      z ciala 20261001210000 (sekcja D); `_coupon_probe_guard/_miss(konto,
--      adres)` i limit na osobe po jawnym koncie. `validate_event_ticket_coupon
--      _for_user(_tenant_id, _user_id, _probe_subject, ...)` - TYLKO
--      `service_role`; stara piecioargumentowa zostaje cienkim wrapperem
--      (najemca z hosta, konto z JWT, bez adresu) tylko dla `service_role`.
--   B. `_event_admission_quote(p_payload, adres)` i `_event_package_purchase(
--      p_payload, adres)` - ciala bez zmian poza dwoma miejscami: straznik
--      i zliczenie pudla dostaja adres, a zakup liczy wycene rdzeniem z tym
--      samym adresem. Stare `event_admission_quote(jsonb)`
--      i `event_package_purchase(jsonb)` deleguja z adresem NULL - TYLKO
--      `service_role`.
--   C. `event_admission_quote_for_user` i `event_package_purchase_for_user`
--      (`_tenant_id, _user_id, _probe_subject, p_payload`) - TYLKO
--      `service_role`. Wycena zalezy od lancucha funkcji czytajacych
--      `auth.uid()` (`_caller_tenant`, `has_tier_rank` -> `current_tier_rank`,
--      `event_audience_qualifies` -> `my_academic_domain_verification`),
--      wiec zamiast kopiowac piec funkcji kwalifikacji z parametrem konta
--      (dwie kopie reguly = rozjazd), wersja serwerowa USTAWIA tozsamosc
--      wolajacego na czas wywolania (`_set_request_identity`: te same
--      ustawienia `request.jwt.claim*`, ktore PostgREST stawia z JWT) i po
--      powrocie ODTWARZA poprzednie. Wykonywalna wylacznie dla `service_role`,
--      ktora i tak omija RLS - nie daje wiec niczego, czego ta rola juz nie ma;
--      konto podaje serwer z ZWERYFIKOWANEJ sesji (`requireSupabaseAuth`).
--      Najemca wycen to dalej najemca PROFILU; inny najemca hosta to
--      `not_found` - jak dotad, gdy pakiet obcego najemcy nie istnial
--      w najemcy profilu.
--
-- DLACZEGO TO ZAMYKA OBEJSCIE. Po tej migracji zadna funkcja odpowiadajaca
-- o istnieniu kodu wydarzenia nie jest wykonywalna dla `anon`
-- ani `authenticated`; jedyna droga to funkcja serwerowa, ktora podaje solony
-- skrot adresu (`requestRateSubject`), a baza liczy pudla w kubelku konta
-- (30 / 10 min) I adresu (120 / 10 min, `_coupon_probe_ip_bucket`).
--
-- KOLEJNOSC WDROZENIA: NAJPIERW KOD, POTEM TA MIGRACJA. Kod woluje `*_for_user`
-- rola serwisowa, a przy PGRST202/42883 (funkcji jeszcze nie ma) wraca do
-- starego wywolania JWT kupujacego - ktore dziala dokladnie do wejscia tej
-- migracji. Odwrotna kolejnosc zatrzymalaby kody wydarzen i zakup pakietow
-- do publikacji kodu.
--
-- IDEMPOTENTNA: CREATE OR REPLACE i bezstanowe REVOKE/GRANT.
-- DOWOD: supabase/tests/event_code_guessing_test.sql (farma kont za jednym
-- adresem, granty) i supabase/tests/ts_sql_contract_test.sql.
-- ============================================================================

-- 0) TOZSAMOSC WOLAJACEGO NA CZAS WYWOLANIA ------------------------------------
-- Te same trzy ustawienia, z ktorych `auth.uid()` i `auth.role()` czytaja
-- tozsamosc zadania. `true` = lokalnie dla transakcji (jak SET LOCAL):
-- wyjatek wycofuje je razem z reszta, a wrapper po sukcesie odtwarza
-- poprzednie wartosci.
CREATE OR REPLACE FUNCTION public._set_request_identity(p_sub text, p_role text, p_claims text)
RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_sub, ''), true);
  PERFORM set_config('request.jwt.claim.role', COALESCE(p_role, ''), true);
  PERFORM set_config('request.jwt.claims', COALESCE(p_claims, ''), true);
END $$;
REVOKE ALL ON FUNCTION public._set_request_identity(text, text, text) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._set_request_identity(text, text, text) IS
  'Ustawia (lokalnie dla transakcji) request.jwt.claim.sub/.role/claims - tozsamosc, z ktorej czytaja auth.uid() i auth.role(). Wylacznie dla wrapperow *_for_user (service_role) i odtworzenia stanu po nich.';

-- Wspolna walidacja argumentow tozsamosci (jak w validate_b2b_coupon_for_user).
CREATE OR REPLACE FUNCTION public._require_server_identity(p_tenant uuid, p_uid uuid, p_probe_subject text)
RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  -- Serwer zna najemce (host) i konto (sesja) - brak ktoregokolwiek to blad
  -- wolajacego, nie odpowiedz o kodzie.
  IF p_tenant IS NULL OR p_uid IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: tenant and user are required';
  END IF;
  -- Solony skrot adresu, nigdy surowy adres (`requestRateSubject`).
  IF p_probe_subject IS NULL OR p_probe_subject !~ '^ip:[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'invalid_payload: probe subject must be a salted address hash';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._require_server_identity(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- A) KOD NA BILET ------------------------------------------------------------------
-- Rdzen: cialo `validate_event_ticket_coupon` z 20261001210000 (sekcja D)
-- z najemca, kontem i adresem z argumentow.
CREATE OR REPLACE FUNCTION public._validate_event_ticket_coupon(
  p_tenant uuid, p_uid uuid, p_ip_subject text,
  _code text, _event_id uuid, _ticket_type_id uuid, _amount_cents integer, _currency text
)
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
  -- Straznik PRZED wyszukaniem: przy pelnym kubelku (konta albo adresu) nawet
  -- dobry kod nie dostaje odpowiedzi, wiec zablokowany nie ma wyroczni.
  PERFORM public._coupon_probe_guard(p_uid, p_ip_subject);
  SELECT * INTO c FROM public.b2b_coupons
   WHERE tenant_id = p_tenant AND upper(code) = v_norm;
  -- KLASA „NIE MA" = JEDNA ODPOWIEDZ: brak, obcy najemca, wylaczony, kod
  -- INNEGO wydarzenia i kod tylko planowy - to samo co pudlo i to samo
  -- zliczone pudlo w obu kubelkach.
  IF NOT FOUND OR NOT c.active
     OR (array_length(c.event_ids,1) IS NOT NULL AND (_event_id IS NULL OR NOT (_event_id = ANY(c.event_ids))))
     OR (array_length(c.event_ids,1) IS NULL AND array_length(c.plan_ids,1) IS NOT NULL) THEN
    PERFORM public._coupon_probe_miss(p_uid, p_ip_subject);
    RETURN public._coupon_refusal('not_found', _amount_cents);
  END IF;
  -- Kod TEGO wydarzenia na inny bilet: odmowa zostaje, ale bez danych kodu.
  IF array_length(c.ticket_type_ids,1) IS NOT NULL AND (_ticket_type_id IS NULL OR NOT (_ticket_type_id = ANY(c.ticket_type_ids))) THEN
    RETURN public._coupon_refusal('ticket_not_eligible', _amount_cents);
  END IF;
  RETURN (SELECT to_jsonb(e) FROM public._b2b_coupon_evaluate(c, _amount_cents, _currency, p_uid) e);
END $$;
REVOKE ALL ON FUNCTION public._validate_event_ticket_coupon(uuid, uuid, text, text, uuid, uuid, integer, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.validate_event_ticket_coupon_for_user(
  _tenant_id uuid, _user_id uuid, _probe_subject text,
  _code text, _event_id uuid, _ticket_type_id uuid, _amount_cents integer, _currency text
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public._require_server_identity(_tenant_id, _user_id, _probe_subject);
  RETURN public._validate_event_ticket_coupon(
    _tenant_id, _user_id, _probe_subject, _code, _event_id, _ticket_type_id, _amount_cents, _currency);
END $$;
REVOKE ALL ON FUNCTION public.validate_event_ticket_coupon_for_user(uuid, uuid, text, text, uuid, uuid, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_event_ticket_coupon_for_user(uuid, uuid, text, text, uuid, uuid, integer, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.validate_event_ticket_coupon(_code text, _event_id uuid, _ticket_type_id uuid, _amount_cents integer, _currency text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public._validate_event_ticket_coupon(
    public.public_tenant_id(), auth.uid(), NULL, _code, _event_id, _ticket_type_id, _amount_cents, _currency);
END $$;
REVOKE ALL ON FUNCTION public.validate_event_ticket_coupon(text, uuid, uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_event_ticket_coupon(text, uuid, uuid, integer, text) TO service_role;

COMMENT ON FUNCTION public.validate_event_ticket_coupon_for_user(uuid, uuid, text, text, uuid, uuid, integer, text) IS
  'Kod rabatowy na bilet wydarzenia - TYLKO service_role. Najemca, konto i solony skrot adresu jawnie; pudla licza sie w kubelku konta (30/10 min) i adresu (120/10 min). Odmowa bez danych kodu (_coupon_refusal); wynik to jeden obiekt jsonb.';
COMMENT ON FUNCTION public.validate_event_ticket_coupon(text, uuid, uuid, integer, text) IS
  'Wrapper zgodnosci (najemca z hosta, konto z JWT, bez kubelka adresu) - TYLKO service_role. Kasa i podglad woluja validate_event_ticket_coupon_for_user.';

-- B) WYCENA I ZAKUP PAKIETU: RDZENIE Z ADRESEM ---------------------------------
-- Cialo `event_admission_quote` z 20261001100000 (sekcja F); jedyna roznica:
-- straznik i zliczenie pudla dostaja konto i adres (`v_uid`, `p_ip_subject`).
CREATE OR REPLACE FUNCTION public._event_admission_quote(p_payload jsonb, p_ip_subject text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
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
    -- Straznik PRZED wyszukaniem kodu: przy pelnym kubelku pudel zadna wycena
    -- z kodem nie dostaje odpowiedzi (takze z dobrym kodem).
    PERFORM public._coupon_probe_guard(v_uid, p_ip_subject);
    SELECT * INTO v_coupon FROM public.b2b_coupons c
    WHERE c.tenant_id = v_tenant AND upper(c.code) = v_code;

    -- KLASA „NIE MA": brak, wylaczony i kod INNEGO wydarzenia to ta sama
    -- odpowiedz `coupon_unknown` i to samo zliczone pudlo. Zakres wydarzenia
    -- stoi PRZED waznoscia i limitami: wczesniej wygasly kod innego wydarzenia
    -- odpowiadal `coupon_expired`, czyli zdradzal, ze istnieje.
    IF v_coupon.id IS NULL OR NOT v_coupon.active
       OR (array_length(v_coupon.event_ids, 1) IS NOT NULL
           AND NOT (v_event_id = ANY (v_coupon.event_ids))) THEN
      PERFORM public._coupon_probe_miss(v_uid, p_ip_subject);
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
REVOKE ALL ON FUNCTION public._event_admission_quote(jsonb, text) FROM PUBLIC, anon, authenticated;

-- Cialo `event_package_purchase` z 20261007120000; jedyna roznica: wycena
-- liczona rdzeniem z tym samym adresem, wiec sonda przez zakup tez zlicza
-- pudlo w kubelku adresu.
CREATE OR REPLACE FUNCTION public._event_package_purchase(p_payload jsonb, p_ip_subject text)
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

  v_quote := public._event_admission_quote(jsonb_build_object(
    'package_id', v_package_id,
    'coupon_code', COALESCE(p_payload->>'coupon_code', '')
  ), p_ip_subject);

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
REVOKE ALL ON FUNCTION public._event_package_purchase(jsonb, text) FROM PUBLIC, anon, authenticated;

-- Stare sygnatury: cienkie wrappery bez kubelka adresu - TYLKO service_role
-- (i wolajacy SQL SECURITY DEFINER, ktorzy wykonuja sie jako wlasciciel).
CREATE OR REPLACE FUNCTION public.event_admission_quote(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public._event_admission_quote(p_payload, NULL);
END $$;
REVOKE ALL ON FUNCTION public.event_admission_quote(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_admission_quote(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.event_package_purchase(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public._event_package_purchase(p_payload, NULL);
END $$;
REVOKE ALL ON FUNCTION public.event_package_purchase(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_package_purchase(jsonb) TO service_role;

-- C) WERSJE SERWEROWE Z TOZSAMOSCIA KONTA --------------------------------------
CREATE OR REPLACE FUNCTION public.event_admission_quote_for_user(
  _tenant_id uuid, _user_id uuid, _probe_subject text, p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_prev_sub text := current_setting('request.jwt.claim.sub', true);
  v_prev_role text := current_setting('request.jwt.claim.role', true);
  v_prev_claims text := current_setting('request.jwt.claims', true);
  v_profile_tenant uuid;
  v_out jsonb;
BEGIN
  PERFORM public._require_server_identity(_tenant_id, _user_id, _probe_subject);
  -- Wycena czyta konto przez lancuch funkcji kwalifikacji (`auth.uid()`),
  -- wiec na czas wywolania wolajacym JEST konto z sesji.
  PERFORM public._set_request_identity(
    _user_id::text, 'authenticated',
    jsonb_build_object('sub', _user_id, 'role', 'authenticated')::text);
  v_profile_tenant := public._caller_tenant();
  IF v_profile_tenant IS NOT NULL AND v_profile_tenant <> _tenant_id THEN
    -- Pakiet z hosta innego najemcy niz profil: tak jak dotad - nie istnieje.
    v_out := jsonb_build_object('ok', false, 'reason', 'not_found');
  ELSE
    v_out := public._event_admission_quote(p_payload, _probe_subject);
  END IF;
  PERFORM public._set_request_identity(v_prev_sub, v_prev_role, v_prev_claims);
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.event_admission_quote_for_user(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_admission_quote_for_user(uuid, uuid, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.event_package_purchase_for_user(
  _tenant_id uuid, _user_id uuid, _probe_subject text, p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_prev_sub text := current_setting('request.jwt.claim.sub', true);
  v_prev_role text := current_setting('request.jwt.claim.role', true);
  v_prev_claims text := current_setting('request.jwt.claims', true);
  v_profile_tenant uuid;
  v_out jsonb;
BEGIN
  PERFORM public._require_server_identity(_tenant_id, _user_id, _probe_subject);
  PERFORM public._set_request_identity(
    _user_id::text, 'authenticated',
    jsonb_build_object('sub', _user_id, 'role', 'authenticated')::text);
  v_profile_tenant := public._caller_tenant();
  IF v_profile_tenant IS NOT NULL AND v_profile_tenant <> _tenant_id THEN
    -- Ta sama odpowiedz, ktora dawala wycena pakietu spoza najemcy profilu.
    RAISE EXCEPTION 'refused_not_found: not_found';
  END IF;
  v_out := public._event_package_purchase(p_payload, _probe_subject);
  PERFORM public._set_request_identity(v_prev_sub, v_prev_role, v_prev_claims);
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.event_package_purchase_for_user(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_package_purchase_for_user(uuid, uuid, text, jsonb) TO service_role;

COMMENT ON FUNCTION public.event_admission_quote_for_user(uuid, uuid, text, jsonb) IS
  'Wycena wejsciowki/pakietu - TYLKO service_role. Konto z sesji serwera jest wolajacym na czas wywolania (_set_request_identity), solony skrot adresu liczy pudla kodu w kubelku adresu (120/10 min) obok kubelka konta (30/10 min). Najemca hosta inny niz najemca profilu = not_found.';
COMMENT ON FUNCTION public.event_package_purchase_for_user(uuid, uuid, text, jsonb) IS
  'Zakup pakietu - TYLKO service_role. Konto z sesji serwera jest wolajacym na czas wywolania, wycena liczona rdzeniem z kubelkiem adresu. Odmowa coupon_unknown wraca wartoscia {ok:false, reason} (pudlo musi przetrwac), pozostale odmowy rzucaja refused_<powod>.';
COMMENT ON FUNCTION public.event_admission_quote(jsonb) IS
  'Wrapper zgodnosci (konto z JWT, bez kubelka adresu) - TYLKO service_role. Ekran zakupu woluje event_admission_quote_for_user przez funkcje serwerowa.';
COMMENT ON FUNCTION public.event_package_purchase(jsonb) IS
  'Wrapper zgodnosci (konto z JWT, bez kubelka adresu) - TYLKO service_role. Ekran zakupu woluje event_package_purchase_for_user przez funkcje serwerowa. Firme zamowienia ustala organizator - klucz company_id w ladunku to forbidden_field.';
