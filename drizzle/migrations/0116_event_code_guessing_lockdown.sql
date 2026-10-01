-- events-harness: include
-- Kody wydarzen i kupony: limit prob i jedna odpowiedz dla pudla (blizniak 20261001100000).
-- A) KUBELEK PUDEL ------------------------------------------------------------

-- Jedno miejsce na liczby. Limiter TS sond (CODE_PROBE_RATE_LIMIT) ma te same
-- 30 / 10 min - akceptacja audytu mowi o 31. probie.
CREATE OR REPLACE FUNCTION public._coupon_probe_bucket(
  p_uid uuid,
  OUT scope text,
  OUT subject text,
  OUT max_misses integer,
  OUT window_minutes integer,
  OUT window_start timestamptz
)
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  -- Okno liczone DOKLADNIE jak w `rate_limit_hit` (20260724221149:15-19):
  -- inna arytmetyka dalaby inny `window_start` i podglad czytalby pusty wiersz.
  SELECT 'coupon_probe_miss'::text,
         'user:' || p_uid::text,
         p.max_misses,
         p.window_minutes,
         to_timestamp(
           (floor(extract(epoch FROM now()) / p.bucket_seconds) * p.bucket_seconds)::double precision
         )
    FROM (SELECT 30 AS max_misses, 10 AS window_minutes, 10 * 60 AS bucket_seconds) p
$$;
REVOKE ALL ON FUNCTION public._coupon_probe_bucket(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._coupon_probe_guard()
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_b record;
  v_count integer;
BEGIN
  -- Sciezki service_role (bez uzytkownika) maja wlasny limiter w TS.
  IF v_uid IS NULL THEN
    RETURN;
  END IF;
  SELECT * INTO v_b FROM public._coupon_probe_bucket(v_uid);
  -- PODGLAD, nie zliczenie: dobry kod nie moze zjadac kubelka.
  SELECT rl.count INTO v_count
    FROM public.rate_limits rl
   WHERE rl.scope = v_b.scope
     AND rl.subject_id = v_b.subject
     AND rl.window_start = v_b.window_start;
  IF COALESCE(v_count, 0) >= v_b.max_misses THEN
    RAISE EXCEPTION 'rate_limited: too many code attempts, try again later';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._coupon_probe_guard() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._coupon_probe_miss()
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_b record;
  v_hit record;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;
  SELECT * INTO v_b FROM public._coupon_probe_bucket(v_uid);
  SELECT * INTO v_hit
    FROM public.rate_limit_hit(v_b.scope, v_b.subject, v_b.max_misses, v_b.window_minutes);
  -- Rownolegle wywolania moga przejsc podglad razem; licznik `rate_limit_hit`
  -- jest atomowy, wiec przegrany wyscigu dostaje odmowe zamiast 31. odpowiedzi.
  -- Wyjatek wycofuje tez jego zliczenie, wiec kubelek stoi na 30.
  IF NOT v_hit.allowed THEN
    RAISE EXCEPTION 'rate_limited: too many code attempts, try again later';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._coupon_probe_miss() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._coupon_probe_bucket(uuid) IS
  'Polityka kubelka pudel kodow: zakres coupon_probe_miss, podmiot user:<uid>, 30 pudel na 10 minut, okno jak w rate_limit_hit. Jedyne miejsce tych liczb w bazie.';
COMMENT ON FUNCTION public._coupon_probe_guard() IS
  'Straznik sond kodow: przy 30 pudlach uzytkownika w oknie rzuca rate_limited (P0001). Podglad bez zliczania; bez auth.uid() nic nie robi.';
COMMENT ON FUNCTION public._coupon_probe_miss() IS
  'Zlicza pudlo kodu (wynik klasy nie-ma) w kubelku uzytkownika przez rate_limit_hit; bez auth.uid() nic nie robi.';

-- B) OCENA KODU ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._b2b_coupon_evaluate(c public.b2b_coupons, _amount_cents integer, _currency text)
RETURNS TABLE(ok boolean, error text, coupon_id uuid, discount_cents integer, final_cents integer, label text, discount_kind text, discount_percent integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_disc integer := 0;
  v_used integer := 0;
BEGIN
  -- ODMOWA NIE NIESIE KODU: id, nazwa, rodzaj i procent naleza wylacznie do
  -- wiersza sukcesu. Wylaczony kod to `not_found` - istnienie kodu, ktorego nie
  -- da sie uzyc, nie jest informacja dla wolajacego.
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
  IF c.max_redemptions_per_user IS NOT NULL AND auth.uid() IS NOT NULL THEN
    SELECT count(*)::integer INTO v_used FROM public.b2b_coupon_redemptions r
     WHERE r.coupon_id = c.id AND r.user_id = auth.uid();
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
REVOKE ALL ON FUNCTION public._b2b_coupon_evaluate(public.b2b_coupons, integer, text) FROM PUBLIC, anon, authenticated;

-- C) KOD NA PLAN --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_b2b_coupon(_code text, _plan_id uuid, _amount_cents integer, _currency text)
RETURNS TABLE(ok boolean, error text, coupon_id uuid, discount_cents integer, final_cents integer, label text, discount_kind text, discount_percent integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  c public.b2b_coupons%ROWTYPE;
  v_norm text := upper(trim(coalesce(_code,'')));
BEGIN
  IF v_norm = '' THEN
    RETURN QUERY SELECT false,'empty_code'::text,NULL::uuid,0,_amount_cents,NULL::text,NULL::text,NULL::integer; RETURN;
  END IF;
  IF _amount_cents IS NULL OR _amount_cents <= 0 THEN
    RETURN QUERY SELECT false,'invalid_amount'::text,NULL::uuid,0,coalesce(_amount_cents,0),NULL::text,NULL::text,NULL::integer; RETURN;
  END IF;
  -- Straznik PRZED wyszukaniem: przy pelnym kubelku nawet dobry kod nie
  -- dostaje odpowiedzi, wiec zablokowany nie ma wyroczni.
  PERFORM public._coupon_probe_guard();
  SELECT * INTO c FROM public.b2b_coupons
   WHERE tenant_id = public.public_tenant_id() AND upper(code) = v_norm;
  -- KLASA "NIE MA" = JEDEN WIERSZ. Brak kodu, kod obcego najemcy, kod
  -- wylaczony i kod przypiety do wydarzen (na planie nieuzywalny) daja bajt
  -- w bajt ten sam wiersz co pudlo i ZLICZAJA pudlo - inaczej roznica odpowiedzi
  -- albo darmowa proba zdradzalaby, ze kod istnieje.
  IF NOT FOUND OR NOT c.active OR array_length(c.event_ids,1) IS NOT NULL THEN
    PERFORM public._coupon_probe_miss();
    RETURN QUERY SELECT false,'not_found'::text,NULL::uuid,0,_amount_cents,NULL::text,NULL::text,NULL::integer; RETURN;
  END IF;
  -- Zerowy UUID planu nadal jest tu konkretnym planem (it.fails w
  -- useValidateCoupon.test.ts) - ta migracja tego nie zmienia.
  IF array_length(c.plan_ids,1) IS NOT NULL AND _plan_id IS NOT NULL AND NOT (_plan_id = ANY(c.plan_ids)) THEN
    RETURN QUERY SELECT false,'plan_not_eligible'::text,NULL::uuid,0,_amount_cents,NULL::text,NULL::text,NULL::integer; RETURN;
  END IF;
  RETURN QUERY SELECT * FROM public._b2b_coupon_evaluate(c, _amount_cents, _currency);
END $$;
REVOKE ALL ON FUNCTION public.validate_b2b_coupon(text, uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_b2b_coupon(text, uuid, integer, text) TO authenticated, service_role;

-- D) KOD NA BILET -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_event_ticket_coupon(_code text, _event_id uuid, _ticket_type_id uuid, _amount_cents integer, _currency text)
RETURNS TABLE(ok boolean, error text, coupon_id uuid, discount_cents integer, final_cents integer, label text, discount_kind text, discount_percent integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  c public.b2b_coupons%ROWTYPE;
  v_norm text := upper(trim(coalesce(_code,'')));
BEGIN
  IF v_norm = '' THEN
    RETURN QUERY SELECT false,'empty_code'::text,NULL::uuid,0,_amount_cents,NULL::text,NULL::text,NULL::integer; RETURN;
  END IF;
  IF _amount_cents IS NULL OR _amount_cents <= 0 THEN
    RETURN QUERY SELECT false,'invalid_amount'::text,NULL::uuid,0,coalesce(_amount_cents,0),NULL::text,NULL::text,NULL::integer; RETURN;
  END IF;
  PERFORM public._coupon_probe_guard();
  SELECT * INTO c FROM public.b2b_coupons
   WHERE tenant_id = public.public_tenant_id() AND upper(code) = v_norm;
  -- KLASA "NIE MA" = JEDEN WIERSZ (jak w validate_b2b_coupon): brak, obcy
  -- najemca, wylaczony, kod INNEGO wydarzenia i kod tylko planowy. Kod innego
  -- wydarzenia jest dla tego wydarzenia nieodroznialny od pudla - to jest
  -- warunek akceptacji audytu.
  IF NOT FOUND OR NOT c.active
     OR (array_length(c.event_ids,1) IS NOT NULL AND (_event_id IS NULL OR NOT (_event_id = ANY(c.event_ids))))
     OR (array_length(c.event_ids,1) IS NULL AND array_length(c.plan_ids,1) IS NOT NULL) THEN
    PERFORM public._coupon_probe_miss();
    RETURN QUERY SELECT false,'not_found'::text,NULL::uuid,0,_amount_cents,NULL::text,NULL::text,NULL::integer; RETURN;
  END IF;
  -- Kod TEGO wydarzenia na inny bilet: odmowa zostaje (kupujacy ma kod
  -- z zaproszenia i trzeba mu powiedziec, ze wybral zly bilet), ale bez danych kodu.
  IF array_length(c.ticket_type_ids,1) IS NOT NULL AND (_ticket_type_id IS NULL OR NOT (_ticket_type_id = ANY(c.ticket_type_ids))) THEN
    RETURN QUERY SELECT false,'ticket_not_eligible'::text,NULL::uuid,0,_amount_cents,NULL::text,NULL::text,NULL::integer; RETURN;
  END IF;
  RETURN QUERY SELECT * FROM public._b2b_coupon_evaluate(c, _amount_cents, _currency);
END $$;
REVOKE ALL ON FUNCTION public.validate_event_ticket_coupon(text, uuid, uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_event_ticket_coupon(text, uuid, uuid, integer, text) TO authenticated, service_role;

-- E) ODSLANIANIE UKRYTYCH BILETOW ---------------------------------------------
-- Stara sygnatura (p_event_id, p_code) znika: zostawiona dalej bylaby wyrocznia
-- dla anon obok nowej, a DROP zabiera tez jej granty.
DROP FUNCTION IF EXISTS public.event_coupon_revealed_tickets(uuid, text);

CREATE OR REPLACE FUNCTION public.event_coupon_revealed_tickets(p_tenant uuid, p_event_id uuid, p_code text)
RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  c public.b2b_coupons%ROWTYPE;
  v_norm text := upper(trim(coalesce(p_code,'')));
  v_ids uuid[];
BEGIN
  -- Najemca przychodzi JAWNIE od serwera (host zadania rozwiazany po stronie
  -- TS): supabaseAdmin nie niesie hosta, a public_tenant_id() bez hosta to
  -- najemca domyslny.
  IF p_tenant IS NULL OR p_event_id IS NULL OR v_norm = '' OR length(v_norm) > 64 THEN
    RETURN ARRAY[]::uuid[];
  END IF;
  -- Kazdy powod odmowy (brak, wylaczony, nie odslania, inne wydarzenie, poza
  -- oknem, wyczerpany) to ta sama pusta lista.
  SELECT * INTO c FROM public.b2b_coupons
   WHERE tenant_id = p_tenant AND upper(code) = v_norm
     AND active AND reveals_hidden AND p_event_id = ANY(event_ids)
     AND (valid_from IS NULL OR now() >= valid_from)
     AND (valid_until IS NULL OR now() <= valid_until)
     AND (max_redemptions IS NULL OR redemptions_count < max_redemptions);
  IF NOT FOUND THEN
    RETURN ARRAY[]::uuid[];
  END IF;
  SELECT coalesce(array_agg(t.id ORDER BY t.id), ARRAY[]::uuid[]) INTO v_ids
    FROM public.event_ticket_types t
   WHERE t.tenant_id = p_tenant AND t.event_id = p_event_id AND t.is_hidden
     AND (array_length(c.ticket_type_ids,1) IS NULL OR t.id = ANY(c.ticket_type_ids));
  RETURN v_ids;
END $$;
REVOKE ALL ON FUNCTION public.event_coupon_revealed_tickets(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_coupon_revealed_tickets(uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public.event_coupon_revealed_tickets(uuid, uuid, text) IS
  'Ukryte bilety odslaniane kodem w danym wydarzeniu. Wylacznie service_role z jawnym najemca: limit prob (IP + uzytkownik) stoi przed baza, w funkcji serwerowej eventCodeReveal. Kazda odmowa to pusta lista.';

-- F) WYCENA WEJSCIOWKI I PAKIETU ----------------------------------------------
-- Pelne cialo z 20260926110001:63-283; zmiany: VOLATILE, straznik przed
-- wyszukaniem kodu, pudlo przy `coupon_unknown`, kod innego wydarzenia to
-- `coupon_unknown` sprawdzany PRZED waznoscia.
CREATE OR REPLACE FUNCTION public.event_admission_quote(p_payload jsonb)
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
    PERFORM public._coupon_probe_guard();
    SELECT * INTO v_coupon FROM public.b2b_coupons c
    WHERE c.tenant_id = v_tenant AND upper(c.code) = v_code;

    -- KLASA "NIE MA": brak, wylaczony i kod INNEGO wydarzenia to ta sama
    -- odpowiedz `coupon_unknown` i to samo zliczone pudlo. Zakres wydarzenia
    -- stoi PRZED waznoscia i limitami: wczesniej wygasly kod innego wydarzenia
    -- odpowiadal `coupon_expired`, czyli zdradzal, ze istnieje.
    IF v_coupon.id IS NULL OR NOT v_coupon.active
       OR (array_length(v_coupon.event_ids, 1) IS NOT NULL
           AND NOT (v_event_id = ANY (v_coupon.event_ids))) THEN
      PERFORM public._coupon_probe_miss();
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
    -- `v_kind = 'ticket'`, wiec kod "tylko na Standard" dzialal na pakiet
    -- dowolnego rodzaju - studio kodow nie wypelnia `package_ids`, wiec nic
    -- innego go nie zawezalo.
    --
    -- WYJATEK: pakiet wymieniony WPROST w `package_ids`. Kod "Standard + pakiet
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
    -- Ekran zakupu pokazuje "Rabat (N x kwota)" - bez tych dwoch pol musialby
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
  'Jedna odpowiedz na cztery pytania ekranu zakupu: kwalifikacja, pula i okno, cena przed rabatem i po kodzie. Kod kwotowy schodzi z KAZDEGO miejsca pakietu (najwyzej do ceny miejsca), kod bez rabatu jest odmowa coupon_no_discount. Kod nieznany, wylaczony albo innego wydarzenia to jedno coupon_unknown i jedno pudlo w kubelku uzytkownika (30 na 10 minut, potem rate_limited). Odmowa ma NAZWE (reason) bedaca kluczem slownika.';

-- G) WYCOFANA SCIEZKA NADAJACA WARSTWE BEZ PLATNOSCI ----------------------------
-- 20260725181430 (petla :23-35) oddala `authenticated` funkcje wycofana
-- w 20260725090300:192-198. Odbieramy ponownie; service_role zostaje.
-- Warunkowo, bo baza harnessu wydarzen tej funkcji nie modeluje (to sciezka
-- platnosci planow, nie modul wydarzen) - w pelnej bazie funkcja istnieje.
DO $$
BEGIN
  IF to_regprocedure('public.redeem_b2b_coupon_with_effects(uuid, uuid, integer, integer, text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.redeem_b2b_coupon_with_effects(uuid, uuid, integer, integer, text)
      FROM PUBLIC, anon, authenticated;
  END IF;
END $$;
