-- events-harness: include
-- ============================================================================
-- KUPONY: WALIDACJA I REZERWACJA KODU TYLKO Z SERWERA, Z JAWNA TOZSAMOSCIA.
--
-- DEFEKT (szew TypeScript <-> SQL i rola serwisowa <-> GRANT, audyt ed13
-- N-13-1 i D-13-1). Trzy uprawnienia byly szersze niz to, czego potrzebuje kod:
--   1. `validate_b2b_coupon` - EXECUTE dla `authenticated`
--      (20261001210000:122). Limit prob po adresie IP zyje tylko w TS
--      (`allowCodeProbe`, `couponPreview.server.ts`), wiec zalogowany
--      wolajacy PostgREST wprost (`POST /rest/v1/rpc/validate_b2b_coupon`)
--      omijal go calkowicie, a farma kont za jednym adresem zgadywala kody
--      30 pudel na konto co 10 minut - bez sufitu na adres. Kasa planu
--      (`checkout.functions.ts`, `stripeCheckout.functions.ts`) wolala te
--      sama funkcje JWT kupujacego, takze bez kubelka adresu.
--   2. `redeem_b2b_coupon` - EXECUTE dla `authenticated` (20260919094000:131).
--      Kazdy zalogowany znajacy `coupon_id` (oddaje go udana walidacja) mogl
--      zuzyc cala pule kodu bez zamowienia i dopisac wiersze realizacji
--      z dowolnym `_applied_cents` - analityka kuponow liczy z nich rabat.
--   3. `b2b_coupon_redemptions` - INSERT dla `authenticated`
--      (20260721070203:50), choc zadna polityka go nie dopuszcza i zaden kod
--      nie pisze tam z klienta: zapisuja wylacznie funkcje SECURITY DEFINER.
--
-- ZMIANA (wzorzec `event_coupon_revealed_tickets`, 20261001100000: funkcja
-- tylko dla `service_role`, najemca i tozsamosc JAWNIE, limit prob przed baza):
--   A. Kubelek pudel po ADRESIE w bazie: `_coupon_probe_ip_bucket(text)`,
--      120 pudel na 10 minut (ta sama liczba co `CODE_PROBE_SIGNED_IN_IP_MAX`
--      w `codeProbeLimit.server.ts`). Liczy WYLACZNIE pudla, jak kubelek konta
--      - kasa ponawia walidacje tego samego dobrego kodu i nie moze sie przez
--      to zablokowac. Podmiot to solony skrot adresu z TS (`ip:<32 hex>`,
--      `requestRateSubject`), nigdy surowy adres.
--   B. `_coupon_probe_guard(uuid, text)` i `_coupon_probe_miss(uuid, text)` -
--      konto I adres jawnie. Bezargumentowe wersje zostaja (woluja je
--      `validate_event_ticket_coupon` i `event_admission_quote`) i deleguja
--      z (`auth.uid()`, NULL) - zachowanie sciezek wydarzen bez zmian.
--   C. `_b2b_coupon_evaluate(c, kwota, waluta, uuid)` - limit na osobe po
--      jawnym uzytkowniku; wersja trzyargumentowa deleguje z `auth.uid()`.
--   D. `validate_b2b_coupon_for_user(_tenant_id, _user_id, _probe_subject,
--      _code, _plan_id, _amount_cents, _currency)` - TYLKO `service_role`.
--      Cialo walidacji z 20261001210000 w jednym rdzeniu
--      `_validate_b2b_coupon`, z najemca z argumentu zamiast z naglowka hosta
--      (`supabaseAdmin` hosta nie niesie).
--   E. `redeem_b2b_coupon_for_user(_tenant_id, _user_id, _coupon_id,
--      _order_id, _applied_cents, _original_cents, _currency)` - TYLKO
--      `service_role`; zamowienie musi nalezec do tego uzytkownika i najemcy,
--      wiec realizacja nie powstaje bez zamowienia, za ktore ktos placi.
--   F. `validate_b2b_coupon(4)` i `redeem_b2b_coupon(5)` zostaja jako cienkie
--      wrappery (najemca z hosta, tozsamosc z JWT) - EXECUTE odebrane
--      `PUBLIC`, `anon` i `authenticated`, zostaje `service_role`.
--   G. REVOKE INSERT ON b2b_coupon_redemptions FROM anon, authenticated
--      (anon na wypadek domyslnych grantow tabel w starszym projekcie).
--   H. `search_path` funkcji realizacji z `pg_temp` (klasa N-DB-3).
--
-- CZEGO NIE ZMIENIA: kody wydarzen (`validate_event_ticket_coupon`,
-- `event_admission_quote`) zostaja wykonywalne dla `authenticated` z kubelkiem
-- konta - ekran zakupu wydarzenia woluje wycene z przegladarki. To osobna
-- decyzja produktowa, nie skutek uboczny tej migracji.
--
-- KOLEJNOSC WDROZENIA: NAJPIERW KOD, POTEM TA MIGRACJA. Kod z tej zmiany
-- (`src/lib/billing/couponRpc.server.ts`) woluje `*_for_user` rola serwisowa,
-- a przy PGRST202/42883 (funkcji jeszcze nie ma) wraca do starego wywolania
-- JWT kupujacego - ktore dziala dokladnie do chwili wejscia tej migracji.
-- Odwrotna kolejnosc zatrzymalaby kupony planow do publikacji kodu.
--
-- IDEMPOTENTNA: CREATE OR REPLACE i bezstanowe REVOKE/GRANT.
-- Straznik klasy: supabase/tests/ts_sql_contract_test.sql (sekcja „RPC tylko
-- z serwera") i supabase/tests/event_code_guessing_test.sql.
-- ============================================================================

-- A) KUBELEK PUDEL PO ADRESIE ---------------------------------------------------
-- Okno liczone DOKLADNIE jak w `rate_limit_hit` (i `_coupon_probe_bucket`):
-- inna arytmetyka dalaby inny `window_start` i podglad czytalby pusty wiersz.
CREATE OR REPLACE FUNCTION public._coupon_probe_ip_bucket(
  p_subject text,
  OUT scope text,
  OUT subject text,
  OUT max_misses integer,
  OUT window_minutes integer,
  OUT window_start timestamptz
)
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  SELECT 'coupon_probe_miss.ip'::text,
         p_subject,
         p.max_misses,
         p.window_minutes,
         to_timestamp(
           (floor(extract(epoch FROM now()) / p.bucket_seconds) * p.bucket_seconds)::double precision
         )
    FROM (SELECT 120 AS max_misses, 10 AS window_minutes, 10 * 60 AS bucket_seconds) p
$$;
REVOKE ALL ON FUNCTION public._coupon_probe_ip_bucket(text) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._coupon_probe_ip_bucket(text) IS
  'Polityka kubelka pudel kodow po adresie: zakres coupon_probe_miss.ip, podmiot = solony skrot adresu z TS (ip:<32 hex>), 120 pudel na 10 minut, okno jak w rate_limit_hit.';

-- B) STRAZNIK I ZLICZENIE Z JAWNA TOZSAMOSCIA -------------------------------
CREATE OR REPLACE FUNCTION public._coupon_probe_guard(p_uid uuid, p_ip_subject text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_b record;
  v_count integer;
BEGIN
  -- PODGLAD, nie zliczenie: dobry kod nie moze zjadac zadnego kubelka.
  IF p_uid IS NOT NULL THEN
    SELECT * INTO v_b FROM public._coupon_probe_bucket(p_uid);
    SELECT rl.count INTO v_count
      FROM public.rate_limits rl
     WHERE rl.scope = v_b.scope
       AND rl.subject_id = v_b.subject
       AND rl.window_start = v_b.window_start;
    IF COALESCE(v_count, 0) >= v_b.max_misses THEN
      RAISE EXCEPTION 'rate_limited: too many code attempts, try again later';
    END IF;
  END IF;
  IF p_ip_subject IS NOT NULL THEN
    v_count := NULL;
    SELECT * INTO v_b FROM public._coupon_probe_ip_bucket(p_ip_subject);
    SELECT rl.count INTO v_count
      FROM public.rate_limits rl
     WHERE rl.scope = v_b.scope
       AND rl.subject_id = v_b.subject
       AND rl.window_start = v_b.window_start;
    IF COALESCE(v_count, 0) >= v_b.max_misses THEN
      RAISE EXCEPTION 'rate_limited: too many code attempts, try again later';
    END IF;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._coupon_probe_guard(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._coupon_probe_miss(p_uid uuid, p_ip_subject text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_b record;
  v_hit record;
BEGIN
  -- `rate_limit_hit` jest atomowy, wiec przegrany wyscigu dostaje odmowe
  -- zamiast kolejnej odpowiedzi; wyjatek wycofuje tez jego zliczenie.
  IF p_uid IS NOT NULL THEN
    SELECT * INTO v_b FROM public._coupon_probe_bucket(p_uid);
    SELECT * INTO v_hit
      FROM public.rate_limit_hit(v_b.scope, v_b.subject, v_b.max_misses, v_b.window_minutes);
    IF NOT v_hit.allowed THEN
      RAISE EXCEPTION 'rate_limited: too many code attempts, try again later';
    END IF;
  END IF;
  IF p_ip_subject IS NOT NULL THEN
    SELECT * INTO v_b FROM public._coupon_probe_ip_bucket(p_ip_subject);
    SELECT * INTO v_hit
      FROM public.rate_limit_hit(v_b.scope, v_b.subject, v_b.max_misses, v_b.window_minutes);
    IF NOT v_hit.allowed THEN
      RAISE EXCEPTION 'rate_limited: too many code attempts, try again later';
    END IF;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._coupon_probe_miss(uuid, text) FROM PUBLIC, anon, authenticated;

-- Wersje bezargumentowe - sciezki wydarzen (JWT uczestnika, bez adresu).
CREATE OR REPLACE FUNCTION public._coupon_probe_guard()
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- Sciezki service_role bez uzytkownika i bez adresu nic tu nie licza.
  PERFORM public._coupon_probe_guard(auth.uid(), NULL);
END $$;
REVOKE ALL ON FUNCTION public._coupon_probe_guard() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._coupon_probe_miss()
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public._coupon_probe_miss(auth.uid(), NULL);
END $$;
REVOKE ALL ON FUNCTION public._coupon_probe_miss() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._coupon_probe_guard(uuid, text) IS
  'Straznik sond kodow z jawna tozsamoscia: 30 pudel konta albo 120 pudel adresu w oknie 10 minut -> rate_limited (P0001). Podglad bez zliczania; NULL pomija dany kubelek.';
COMMENT ON FUNCTION public._coupon_probe_miss(uuid, text) IS
  'Zlicza pudlo kodu (wynik klasy nie-ma) w kubelku konta i adresu przez rate_limit_hit; NULL pomija dany kubelek.';
COMMENT ON FUNCTION public._coupon_probe_guard() IS
  'Straznik sond kodow dla sciezek z JWT (kody wydarzen): deleguje do _coupon_probe_guard(auth.uid(), NULL).';
COMMENT ON FUNCTION public._coupon_probe_miss() IS
  'Zliczenie pudla dla sciezek z JWT (kody wydarzen): deleguje do _coupon_probe_miss(auth.uid(), NULL).';

-- C) OCENA KODU Z JAWNYM UZYTKOWNIKIEM -----------------------------------------
-- Cialo z 20261001100000 (sekcja B); jedyna roznica: limit na osobe liczy sie
-- po `p_uid`, nie po `auth.uid()`.
CREATE OR REPLACE FUNCTION public._b2b_coupon_evaluate(c public.b2b_coupons, _amount_cents integer, _currency text, p_uid uuid)
RETURNS TABLE(ok boolean, error text, coupon_id uuid, discount_cents integer, final_cents integer, label text, discount_kind text, discount_percent integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_disc integer := 0;
  v_used integer := 0;
BEGIN
  -- ODMOWA NIE NIESIE KODU: id, nazwa, rodzaj i procent naleza wylacznie do
  -- wiersza sukcesu. Wylaczony kod to `not_found`.
  IF NOT c.active THEN
    RETURN QUERY SELECT false,'not_found'::text,NULL::uuid,0,_amount_cents,NULL::text,NULL::text,NULL::integer; RETURN;
  END IF;
  IF c.valid_from IS NOT NULL AND now() < c.valid_from THEN
    RETURN QUERY SELECT false,'not_yet_valid'::text,NULL::uuid,0,_amount_cents,NULL::text,NULL::text,NULL::integer; RETURN;
  END IF;
  IF c.valid_until IS NOT NULL AND now() > c.valid_until THEN
    RETURN QUERY SELECT false,'expired'::text,NULL::uuid,0,_amount_cents,NULL::text,NULL::text,NULL::integer; RETURN;
  END IF;
  IF c.max_redemptions IS NOT NULL AND c.redemptions_count >= c.max_redemptions THEN
    RETURN QUERY SELECT false,'limit_reached'::text,NULL::uuid,0,_amount_cents,NULL::text,NULL::text,NULL::integer; RETURN;
  END IF;
  IF c.max_redemptions_per_user IS NOT NULL AND p_uid IS NOT NULL THEN
    SELECT count(*)::integer INTO v_used FROM public.b2b_coupon_redemptions r
     WHERE r.coupon_id = c.id AND r.user_id = p_uid;
    IF v_used >= c.max_redemptions_per_user THEN
      RETURN QUERY SELECT false,'per_user_limit_reached'::text,NULL::uuid,0,_amount_cents,NULL::text,NULL::text,NULL::integer; RETURN;
    END IF;
  END IF;
  IF NOT c.applies_discount THEN
    RETURN QUERY SELECT false,'no_discount'::text,NULL::uuid,0,_amount_cents,NULL::text,NULL::text,NULL::integer; RETURN;
  END IF;
  IF c.discount_kind = 'percent' THEN
    v_disc := (_amount_cents * COALESCE(c.discount_percent,0)) / 100;
  ELSE
    IF c.currency IS NOT NULL AND upper(c.currency) <> upper(_currency) THEN
      RETURN QUERY SELECT false,'currency_mismatch'::text,NULL::uuid,0,_amount_cents,NULL::text,NULL::text,NULL::integer; RETURN;
    END IF;
    v_disc := LEAST(COALESCE(c.discount_cents,0),_amount_cents);
  END IF;
  RETURN QUERY SELECT true,NULL::text,c.id,v_disc,GREATEST(_amount_cents-v_disc,0),c.name,c.discount_kind,c.discount_percent;
END $$;
REVOKE ALL ON FUNCTION public._b2b_coupon_evaluate(public.b2b_coupons, integer, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._b2b_coupon_evaluate(c public.b2b_coupons, _amount_cents integer, _currency text)
RETURNS TABLE(ok boolean, error text, coupon_id uuid, discount_cents integer, final_cents integer, label text, discount_kind text, discount_percent integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY SELECT * FROM public._b2b_coupon_evaluate(c, _amount_cents, _currency, auth.uid());
END $$;
REVOKE ALL ON FUNCTION public._b2b_coupon_evaluate(public.b2b_coupons, integer, text) FROM PUBLIC, anon, authenticated;

-- D) WALIDACJA KODU NA PLAN ------------------------------------------------------
-- Rdzen: cialo `validate_b2b_coupon` z 20261001210000 (sekcja C) z najemca,
-- kontem i adresem z argumentow. Wynik - jeden obiekt jsonb (skalar: PostgREST
-- nie filtruje go, wiec odpowiedz i zapis pudla zatwierdzaja sie razem).
CREATE OR REPLACE FUNCTION public._validate_b2b_coupon(
  p_tenant uuid, p_uid uuid, p_ip_subject text,
  _code text, _plan_id uuid, _amount_cents integer, _currency text
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
  -- Straznik PRZED wyszukaniem: przy pelnym kubelku nawet dobry kod nie
  -- dostaje odpowiedzi, wiec zablokowany nie ma wyroczni.
  PERFORM public._coupon_probe_guard(p_uid, p_ip_subject);
  SELECT * INTO c FROM public.b2b_coupons
   WHERE tenant_id = p_tenant AND upper(code) = v_norm;
  -- KLASA „NIE MA" = JEDNA ODPOWIEDZ: brak kodu, kod obcego najemcy, kod
  -- wylaczony i kod przypiety do wydarzen daja to samo co pudlo i ZLICZAJA
  -- pudlo w obu kubelkach.
  IF NOT FOUND OR NOT c.active OR array_length(c.event_ids,1) IS NOT NULL THEN
    PERFORM public._coupon_probe_miss(p_uid, p_ip_subject);
    RETURN public._coupon_refusal('not_found', _amount_cents);
  END IF;
  IF array_length(c.plan_ids,1) IS NOT NULL AND _plan_id IS NOT NULL AND NOT (_plan_id = ANY(c.plan_ids)) THEN
    RETURN public._coupon_refusal('plan_not_eligible', _amount_cents);
  END IF;
  RETURN (SELECT to_jsonb(e) FROM public._b2b_coupon_evaluate(c, _amount_cents, _currency, p_uid) e);
END $$;
REVOKE ALL ON FUNCTION public._validate_b2b_coupon(uuid, uuid, text, text, uuid, integer, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.validate_b2b_coupon_for_user(
  _tenant_id uuid, _user_id uuid, _probe_subject text,
  _code text, _plan_id uuid, _amount_cents integer, _currency text
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- Serwer zna najemce (host) i konto (sesja) - brak ktoregokolwiek to blad
  -- wolajacego, nie odpowiedz o kodzie.
  IF _tenant_id IS NULL OR _user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: tenant and user are required';
  END IF;
  -- Solony skrot adresu, nigdy surowy adres (`requestRateSubject`).
  IF _probe_subject IS NULL OR _probe_subject !~ '^ip:[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'invalid_payload: probe subject must be a salted address hash';
  END IF;
  RETURN public._validate_b2b_coupon(
    _tenant_id, _user_id, _probe_subject, _code, _plan_id, _amount_cents, _currency);
END $$;
REVOKE ALL ON FUNCTION public.validate_b2b_coupon_for_user(uuid, uuid, text, text, uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_b2b_coupon_for_user(uuid, uuid, text, text, uuid, integer, text) TO service_role;

CREATE OR REPLACE FUNCTION public.validate_b2b_coupon(_code text, _plan_id uuid, _amount_cents integer, _currency text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public._validate_b2b_coupon(
    public.public_tenant_id(), auth.uid(), NULL, _code, _plan_id, _amount_cents, _currency);
END $$;
REVOKE ALL ON FUNCTION public.validate_b2b_coupon(text, uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_b2b_coupon(text, uuid, integer, text) TO service_role;

COMMENT ON FUNCTION public.validate_b2b_coupon_for_user(uuid, uuid, text, text, uuid, integer, text) IS
  'Kod rabatowy na plan - TYLKO service_role. Najemca, konto i solony skrot adresu jawnie; pudla licza sie w kubelku konta (30/10 min) i adresu (120/10 min). Odmowa bez danych kodu (_coupon_refusal); wynik to jeden obiekt jsonb.';
COMMENT ON FUNCTION public.validate_b2b_coupon(text, uuid, integer, text) IS
  'Wrapper zgodnosci (najemca z hosta, konto z JWT, bez kubelka adresu) - TYLKO service_role. Klient i kasa woluja validate_b2b_coupon_for_user.';

-- E) REZERWACJA UZYCIA KODU --------------------------------------------------------
-- Cialo `redeem_b2b_coupon` z 20260919094000 z najemca i kontem z argumentow
-- oraz wiazaniem zamowienia: realizacja bez zamowienia tego konta nie powstaje.
CREATE OR REPLACE FUNCTION public._redeem_b2b_coupon(
  p_tenant uuid, p_uid uuid,
  _coupon_id uuid, _order_id uuid, _applied_cents integer, _original_cents integer, _currency text
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_per_user integer;
  v_used_by_user integer := 0;
BEGIN
  IF p_tenant IS NULL OR p_uid IS NULL OR _order_id IS NULL THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.payment_orders o
     WHERE o.id = _order_id AND o.tenant_id = p_tenant AND o.user_id = p_uid
  ) THEN
    RETURN false;
  END IF;
  -- Limit na uzytkownika PRZED inkrementacja licznika kampanii, zeby odrzucona
  -- proba nie zjadala globalnej puli.
  SELECT max_redemptions_per_user INTO v_per_user
    FROM public.b2b_coupons
   WHERE id = _coupon_id AND tenant_id = p_tenant
   FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_per_user IS NOT NULL THEN
    SELECT count(*)::integer INTO v_used_by_user
      FROM public.b2b_coupon_redemptions r
     WHERE r.coupon_id = _coupon_id AND r.user_id = p_uid;
    IF v_used_by_user >= v_per_user THEN RETURN false; END IF;
  END IF;

  UPDATE public.b2b_coupons
     SET redemptions_count = redemptions_count + 1, updated_at = now()
   WHERE id = _coupon_id AND tenant_id = p_tenant AND active
     AND (max_redemptions IS NULL OR redemptions_count < max_redemptions)
     AND (valid_from IS NULL OR now() >= valid_from)
     AND (valid_until IS NULL OR now() <= valid_until);
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.b2b_coupon_redemptions
    (tenant_id, coupon_id, order_id, user_id, applied_cents, original_cents, currency)
  VALUES
    (p_tenant, _coupon_id, _order_id, p_uid, _applied_cents, _original_cents, _currency);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public._redeem_b2b_coupon(uuid, uuid, uuid, uuid, integer, integer, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.redeem_b2b_coupon_for_user(
  _tenant_id uuid, _user_id uuid,
  _coupon_id uuid, _order_id uuid, _applied_cents integer, _original_cents integer, _currency text
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public._redeem_b2b_coupon(
    _tenant_id, _user_id, _coupon_id, _order_id, _applied_cents, _original_cents, _currency);
END $$;
REVOKE ALL ON FUNCTION public.redeem_b2b_coupon_for_user(uuid, uuid, uuid, uuid, integer, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_b2b_coupon_for_user(uuid, uuid, uuid, uuid, integer, integer, text) TO service_role;

CREATE OR REPLACE FUNCTION public.redeem_b2b_coupon(
  _coupon_id uuid, _order_id uuid, _applied_cents integer,
  _original_cents integer, _currency text
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public._redeem_b2b_coupon(
    public.public_tenant_id(), auth.uid(),
    _coupon_id, _order_id, _applied_cents, _original_cents, _currency);
END $$;
REVOKE ALL ON FUNCTION public.redeem_b2b_coupon(uuid, uuid, integer, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_b2b_coupon(uuid, uuid, integer, integer, text) TO service_role;

COMMENT ON FUNCTION public.redeem_b2b_coupon_for_user(uuid, uuid, uuid, uuid, integer, integer, text) IS
  'Atomowa rezerwacja uzycia kodu - TYLKO service_role. Najemca i konto jawnie; zamowienie musi nalezec do tego konta i najemcy. Limit na osobe przed licznikiem kampanii; false = odmowa (wyczerpany, nieaktywny, poza oknem, cudze zamowienie).';
COMMENT ON FUNCTION public.redeem_b2b_coupon(uuid, uuid, integer, integer, text) IS
  'Wrapper zgodnosci (najemca z hosta, konto z JWT) - TYLKO service_role. Kasa woluje redeem_b2b_coupon_for_user.';

-- G) TABELA REALIZACJI: zapis wylacznie przez funkcje ----------------------------
REVOKE INSERT ON public.b2b_coupon_redemptions FROM anon, authenticated;
