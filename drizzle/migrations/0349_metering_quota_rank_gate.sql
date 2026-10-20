-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S3, 3/5): LICZNIK ARTYKUŁÓW - PRÓG RANGI (P19),
-- ZDARZENIE WYCZERPANIA LIMITU I TOŻSAMOŚĆ W TELEMETRII ODMÓW.
--
-- DEFEKT
--   1. P19 - licznik omija próg rangi. `_metered_view_consume`
--      (20261013090400) wydaje body każdej treści `members`/`paid`
--      z polityką licznika, także tej z `content_access.min_tier_rank > 0`.
--      Treść „tylko dla Pro" była więc do przeczytania za darmo w ramach
--      miesięcznego limitu przez każde konto (i gościa przy `anon_monthly_limit
--      > 0`) - drabinka warstw (`has_content_access`) przegrywała z licznikiem.
--   2. Wyczerpanie limitu nie zostawia faktu na szynie: lejek nie widzi
--      momentu najwyższej intencji zakupu („przeczytałem wszystkie darmowe"),
--      a ścieżka S5 nie ma na co zareagować. Z tabeli `metering_event_log` nie
--      da się tego wyprowadzić tanio - konto loguje odmowy klientem
--      (opcjonalnie), więc szukanie „pierwszej odmowy w miesiącu" byłoby
--      skanem dziennika przy KAŻDYM odczycie artykułu.
--   3. `log_metering_event` (20260721070203) przyjmuje od zalogowanego klienta
--      dowolny `_visitor_id`: konto mogło dopisać do dziennika odmowy
--      „cudzego" gościa i zawyżać ścianę rejestracji w raportach. Wiersz
--      konta zawsze bierze `user_id` z `auth.uid()`, ale klucz gościa szedł
--      z ładunku bez sprawdzenia.
--
-- ZMIANA (rejestr S3 w `src/lib/ci/hubDelivery.ts`)
--   A. `_metered_view_consume` - ciało 1:1 z 20261013090400 (blokady per
--      podmiot i adres, sufit adresu gości, `remaining` = min(limit, sufit),
--      odmowy gości w dzienniku) plus:
--        * P19: po gałęzi uprawnionych (`has_content_access` - ci dostają body
--          bez licznika jak dotąd) treść z `min_tier_rank > 0` jest wyłączona
--          z licznika, gdy ranga czytającego (`user_tier_rank(uid, najemca)`;
--          gość = ranga warstwy domyślnej, czyli tej, którą dostałby po
--          rejestracji) jest NIŻSZA od progu - werdykt „licznik nie dotyczy"
--          (bez body, bez slotu), a paywall pokazuje ścieżkę do warstwy.
--          Treści bez progu (`min_tier_rank = 0`) działają bit w bit jak
--          dotąd - istniejące `metering_*` przechodzą bez edycji;
--        * `metering.quota_exhausted.v1` przy odmowie KONTA z wyczerpanym
--          limitem - najwyżej raz na konto i miesiąc: znacznik
--          `revenue_event_marks` (kind `quota`, ref `<konto>:<RRRR-MM>`,
--          `INSERT … ON CONFLICT (PK) DO NOTHING RETURNING`) - jedno
--          wyszukanie po kluczu głównym, ZERO skanu `metering_event_log`
--          (pgTAP: 1000 wywołań). Awaria emitera -> `_log_emit_error`,
--          odmowa i tak wraca do czytelnika.
--      `SET search_path = public, pg_temp` (było `public`) - zasada §4.1 dla
--      każdej funkcji SECURITY DEFINER huba.
--   B. `log_metering_event` - ciało z 20260721070203 plus: zalogowany klient
--      NIE podaje `_visitor_id` (42501 `metering_identity_mismatch`);
--      `user_id` jak dotąd wyłącznie z `auth.uid()`; typ treści z dziedziny
--      `access_entity_type`, powód <= 120 znaków (22023, bez przycinania).
--      Granty jak w 20261013090400 (konto i serwer; anon bez EXECUTE).
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020090000 (`revenue_event_marks`)
-- i 20261020090500 (`_log_emit_error`). Sygnatury bez zmian - CREATE OR
-- REPLACE zachowuje wołających (`consume_metered_view`,
-- `consume_metered_view_visitor`, `src/lib/access/metering.ts`), a REVOKE
-- powtarzamy, bo bramka dostawy wymaga ich w tym samym pliku. Kod klienta
-- nie wymaga zmian: werdykt P19 ma kształt werdyktu „licznik nie dotyczy"
-- (`granted = false`, `monthly_limit = 0`), który klient już obsługuje
-- standardowym paywallem.
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION, bezstanowe REVOKE/GRANT.
-- DOWÓD: supabase/tests/metering_quota_rank_gate_test.sql (P19 dla konta
-- i gościa, treść bez progu bez zmian, quota raz na miesiąc, 1000 wywołań bez
-- skanu sekwencyjnego `metering_event_log`, `log_metering_event` odrzuca
-- cudzą tożsamość); istniejące metering_paywall_test, metering_visitor_identity_test,
-- metering_concurrency_test - bez edycji.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Rdzeń konsumpcji.
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20261013090400
CREATE OR REPLACE FUNCTION public._metered_view_consume(
  _tenant uuid,
  _uid uuid,
  _visitor_id uuid,
  _ip_subject text,
  _entity_type public.access_entity_type,
  _entity_id uuid
)
RETURNS TABLE (
  granted boolean,
  consumed boolean,
  used integer,
  monthly_limit integer,
  remaining integer,
  requires_registration boolean,
  show_counter boolean,
  content_pl text,
  content_en text,
  builder_data jsonb,
  blocks_data jsonb
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_settings public.metering_settings%ROWTYPE;
  v_mode public.access_mode;
  v_policy text;
  v_rule_tenant uuid;
  v_min_rank integer := 0;
  v_limit integer := 0;
  v_ip_limit integer := 0;
  v_used integer := 0;
  v_ip_used integer := 0;
  v_remaining integer := 0;
  v_already boolean := false;
  v_insert_count integer := 0;
  v_requires_registration boolean := false;
  v_show_counter boolean := false;
  v_content_pl text;
  v_content_en text;
  v_builder jsonb;
  v_blocks jsonb;
  v_body_found boolean := false;
  v_period date := (date_trunc('month', now()))::date;
  v_subject text;
  v_quota_ref text;
  v_quota_marked integer;
BEGIN
  -- Rdzen liczy dla konta WYLACZNIE biezacego wolajacego: skrot dla
  -- uprawnionych (has_content_access) czyta auth.uid(), wiec inne _uid
  -- rozjechaloby werdykt dostepu i licznik.
  IF _uid IS NOT NULL AND _uid IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'metering_identity_mismatch';
  END IF;
  IF _uid IS NULL AND _ip_subject IS NOT NULL AND _ip_subject !~ '^ip:[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'metering_ip_subject_invalid';
  END IF;

  -- Media nie maja body do wydania ta droga; bez najemcy nie ma czego liczyc.
  IF _entity_type = 'media' OR _tenant IS NULL THEN
    RETURN QUERY SELECT false, false, 0, 0, 0, false, false,
      NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;

  SELECT ca.mode, ca.metering_policy, ca.tenant_id, COALESCE(ca.min_tier_rank, 0)
    INTO v_mode, v_policy, v_rule_tenant, v_min_rank
    FROM public.content_access ca
   WHERE ca.entity_type = _entity_type AND ca.entity_id = _entity_id;

  -- Brak reguly / tresc publiczna / tryb haslowy / inny najemca - metering nie
  -- ma tu nic do roboty (public idzie zwykla sciezka, haslo ma wlasny
  -- odblokowywacz).
  IF NOT FOUND OR v_mode = 'public' OR v_mode = 'password' OR v_rule_tenant IS DISTINCT FROM _tenant THEN
    RETURN QUERY SELECT false, false, 0, 0, 0, false, false,
      NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;

  SELECT * INTO v_settings FROM public.metering_settings ms WHERE ms.tenant_id = _tenant;
  IF NOT FOUND OR NOT v_settings.enabled OR v_policy = 'exempt' THEN
    RETURN QUERY SELECT false, false, 0, 0, 0, false, false,
      NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;
  v_show_counter := v_settings.show_counter;

  -- Uprawniony wolajacy (subskrypcja/zakup/organizacja) dostaje body bez
  -- zuzywania licznika. Gosc nie ma auth.uid(), wiec tej galezi nie dotyczy.
  IF _uid IS NOT NULL AND public.has_content_access(_entity_type, _entity_id) THEN
    SELECT b.content_pl, b.content_en, b.builder_data, b.blocks_data
      INTO v_content_pl, v_content_en, v_builder, v_blocks
      FROM public.get_entity_content(_entity_type, _entity_id) b;
    v_body_found := FOUND;
    RETURN QUERY SELECT v_body_found, false, 0, 0, 0, false, v_show_counter,
      v_content_pl, v_content_en, v_builder, v_blocks;
    RETURN;
  END IF;

  -- P19: prog rangi wygrywa z licznikiem. Tresc „od warstwy X" nie jest
  -- probka do przeczytania za darmo - czytajacy z ranga ponizej progu dostaje
  -- werdykt „licznik nie dotyczy" (bez body, bez slotu), a paywall prowadzi
  -- do warstwy. Gosc (_uid NULL) ma range warstwy domyslnej najemcy - te,
  -- ktora dostalby po rejestracji (`user_tier_rank` dla NULL).
  IF v_min_rank > 0 AND COALESCE(public.user_tier_rank(_uid, _tenant), 0) < v_min_rank THEN
    RETURN QUERY SELECT false, false, 0, 0, 0, false, v_show_counter,
      NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;

  -- Polityka 'inherit' respektuje globalne przelaczniki trybow; 'metered'
  -- wymusza udzial niezaleznie od nich.
  IF v_policy = 'inherit' THEN
    IF v_mode = 'paid' AND NOT v_settings.meter_paid THEN
      RETURN QUERY SELECT false, false, 0, 0, 0, false, v_show_counter,
        NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
      RETURN;
    END IF;
    IF v_mode = 'members' AND NOT v_settings.meter_members THEN
      RETURN QUERY SELECT false, false, 0, 0, 0, false, v_show_counter,
        NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
      RETURN;
    END IF;
  END IF;

  -- Tozsamosc i limit: konto (auth.uid) albo gosc z podpisanego cookie.
  IF _uid IS NOT NULL THEN
    v_limit := v_settings.member_monthly_limit;
    v_subject := 'u:' || _uid::text;
  ELSE
    v_limit := v_settings.anon_monthly_limit;
    v_requires_registration := v_settings.anon_monthly_limit <= 0;
    -- Gosc bez tozsamosci od serwera albo bez skrotu adresu nie jest liczony
    -- "w ciemno" - sciana rejestracji, jak dotad przy braku klucza goscia.
    IF _visitor_id IS NULL OR _ip_subject IS NULL OR v_requires_registration THEN
      INSERT INTO public.metering_event_log
        (tenant_id, user_id, visitor_id, entity_type, entity_id, outcome, reason,
         used_before, monthly_limit)
      VALUES
        (_tenant, NULL, _visitor_id, _entity_type::text, _entity_id, 'requires_registration',
         CASE WHEN v_requires_registration THEN 'anon_limit_zero' ELSE 'no_visitor_identity' END,
         0, v_limit);
      RETURN QUERY SELECT false, false, 0, v_limit, GREATEST(v_limit, 0), true, v_show_counter,
        NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
      RETURN;
    END IF;
    v_subject := 'v:' || _visitor_id::text;
    -- Adresowy sufit: 5 x limit goscia (zapas na NAT), patrz naglowek
    -- 20261013090400.
    v_ip_limit := v_limit * 5;
  END IF;

  -- Serializacja zliczenia i wstawienia per podmiot (i per adres dla gosci).
  -- Blokada transakcyjna - zwalnia sie sama z COMMIT/ROLLBACK. Stala kolejnosc
  -- (podmiot, potem adres) wyklucza zakleszczenie dwoch wolan.
  PERFORM pg_advisory_xact_lock(hashtextextended(_tenant::text || ':' || v_subject, 0));
  IF _uid IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(_tenant::text || ':' || _ip_subject, 0));
  END IF;

  -- Zuzycie w biezacym miesiacu + czy TEN byt juz odblokowano (ponowne
  -- czytanie nie kosztuje) - liczone DOPIERO pod blokada.
  IF _uid IS NOT NULL THEN
    SELECT count(*)::integer,
           bool_or(mv.entity_type = _entity_type AND mv.entity_id = _entity_id)
      INTO v_used, v_already
      FROM public.metered_views mv
     WHERE mv.tenant_id = _tenant AND mv.user_id = _uid
       AND mv.period_month = v_period;
  ELSE
    SELECT count(*)::integer,
           bool_or(mv.entity_type = _entity_type AND mv.entity_id = _entity_id)
      INTO v_used, v_already
      FROM public.metered_views mv
     WHERE mv.tenant_id = _tenant AND mv.user_id IS NULL AND mv.visitor_id = _visitor_id
       AND mv.period_month = v_period;
  END IF;
  v_already := COALESCE(v_already, false);

  IF NOT v_already THEN
    IF v_used >= v_limit THEN
      IF _uid IS NULL THEN
        INSERT INTO public.metering_event_log
          (tenant_id, user_id, visitor_id, entity_type, entity_id, outcome, reason,
           used_before, monthly_limit)
        VALUES
          (_tenant, NULL, _visitor_id, _entity_type::text, _entity_id, 'denied',
           'monthly_limit_reached', v_used, v_limit);
      ELSE
        -- Wyczerpanie limitu konta: fakt lejka najwyzej raz na konto i miesiac.
        -- Znacznik po kluczu glownym (jedno wyszukanie indeksem), NIE szukanie
        -- poprzednich odmow w metering_event_log - ta galaz biegnie przy kazdym
        -- odczycie artykulu po wyczerpaniu limitu.
        v_quota_ref := _uid::text || ':' || to_char(v_period, 'YYYY-MM');
        BEGIN
          v_quota_marked := NULL;
          INSERT INTO public.revenue_event_marks (tenant_id, kind, ref)
          VALUES (_tenant, 'quota', v_quota_ref)
          ON CONFLICT (tenant_id, kind, ref) DO NOTHING
          RETURNING 1 INTO v_quota_marked;
          IF v_quota_marked IS NOT NULL THEN
            PERFORM public.emit_domain_event(
              _tenant, 'metering', _uid::text, 'metering.quota_exhausted.v1',
              jsonb_build_object(
                'user_id', _uid,
                'period_month', to_char(v_period, 'YYYY-MM'),
                'limit', v_limit
              ),
              _uid
            );
          END IF;
        EXCEPTION WHEN OTHERS THEN
          PERFORM public._log_emit_error(
            _tenant, '_metered_view_consume', 'metering.quota_exhausted.v1', SQLSTATE, SQLERRM
          );
        END;
      END IF;
      -- Limit wyczerpany: stan licznika bez body (wariant "wykorzystano X z N").
      RETURN QUERY SELECT false, false, v_used, v_limit, 0, false, v_show_counter,
        NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
      RETURN;
    END IF;
    IF _uid IS NULL THEN
      -- Rozne byty odblokowane z tego adresu w okresie (inny gosc z tego samego
      -- biura czytajacy TEN artykul nie podnosi licznika adresu).
      SELECT count(DISTINCT (mv.entity_type, mv.entity_id))::integer
        INTO v_ip_used
        FROM public.metered_views mv
       WHERE mv.tenant_id = _tenant AND mv.user_id IS NULL
         AND mv.ip_subject = _ip_subject
         AND mv.period_month = v_period;
      IF v_ip_used >= v_ip_limit AND NOT EXISTS (
        SELECT 1 FROM public.metered_views mv
         WHERE mv.tenant_id = _tenant AND mv.user_id IS NULL
           AND mv.ip_subject = _ip_subject
           AND mv.period_month = v_period
           AND mv.entity_type = _entity_type AND mv.entity_id = _entity_id
      ) THEN
        INSERT INTO public.metering_event_log
          (tenant_id, user_id, visitor_id, entity_type, entity_id, outcome, reason,
           used_before, monthly_limit, metadata)
        VALUES
          (_tenant, NULL, _visitor_id, _entity_type::text, _entity_id, 'denied',
           'ip_limit_reached', v_used, v_limit,
           jsonb_build_object('ip_used', v_ip_used, 'ip_limit', v_ip_limit));
        -- Osobny powod odmowy: wlasny limit goscia nie jest wyczerpany
        -- (used < monthly_limit), wiec wariant "exhausted" nie pasuje,
        -- a goly paywall nie mowi, co zrobic. requires_registration = true
        -- kieruje na konto - ono ma wlasny licznik, poza sufitem adresu.
        RETURN QUERY SELECT false, false, v_used, v_limit, 0, true, v_show_counter,
          NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
        RETURN;
      END IF;
    END IF;
    -- Pod blokada konflikt jest niemozliwy; ON CONFLICT DO NOTHING zostaje
    -- jako bezpiecznik (np. wywolanie spoza rdzenia).
    INSERT INTO public.metered_views
      (tenant_id, user_id, visitor_id, entity_type, entity_id, ip_subject)
    VALUES
      (_tenant, _uid,
       CASE WHEN _uid IS NULL THEN _visitor_id ELSE NULL END,
       _entity_type, _entity_id,
       CASE WHEN _uid IS NULL THEN _ip_subject ELSE NULL END)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_insert_count = ROW_COUNT;
    IF v_insert_count > 0 THEN
      v_used := v_used + 1;
    END IF;
  END IF;

  -- "Zostalo N": konto - wlasny limit; gosc - mniejsza z dwoch liczb (wlasny
  -- limit i sufit adresu), liczona POD ta sama blokada adresu i takze przy
  -- ponownym czytaniu (v_already).
  v_remaining := GREATEST(v_limit - v_used, 0);
  IF _uid IS NULL THEN
    SELECT count(DISTINCT (mv.entity_type, mv.entity_id))::integer
      INTO v_ip_used
      FROM public.metered_views mv
     WHERE mv.tenant_id = _tenant AND mv.user_id IS NULL
       AND mv.ip_subject = _ip_subject
       AND mv.period_month = v_period;
    v_remaining := GREATEST(LEAST(v_remaining, v_ip_limit - v_ip_used), 0);
  END IF;

  -- Wydanie body - identyczne ograniczenia jak get_entity_content.
  IF _entity_type = 'post' THEN
    SELECT p.content_pl, p.content_en, p.builder_data, p.blocks_data
      INTO v_content_pl, v_content_en, v_builder, v_blocks
      FROM public.posts p
     WHERE p.id = _entity_id AND p.tenant_id = _tenant
       AND p.status = 'published' AND p.deleted_at IS NULL;
    v_body_found := FOUND;
  ELSE
    SELECT pg.content_pl, pg.content_en, pg.builder_data, NULL::jsonb
      INTO v_content_pl, v_content_en, v_builder, v_blocks
      FROM public.pages pg
     WHERE pg.id = _entity_id AND pg.tenant_id = _tenant
       AND pg.status = 'published' AND pg.deleted_at IS NULL;
    v_body_found := FOUND;
  END IF;

  IF NOT v_body_found THEN
    RETURN QUERY SELECT false, false, v_used, v_limit, v_remaining, false,
      v_show_counter, NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    true,
    (NOT v_already AND v_insert_count > 0),
    v_used,
    v_limit,
    v_remaining,
    false,
    v_show_counter,
    v_content_pl, v_content_en, v_builder, v_blocks;
END $$;

REVOKE ALL ON FUNCTION public._metered_view_consume(uuid, uuid, uuid, text, public.access_entity_type, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._metered_view_consume(uuid, uuid, uuid, text, public.access_entity_type, uuid) IS
  'Wewnetrzny rdzen meteringu (bez EXECUTE dla klientow): limit miesieczny konta albo goscia, '
  'adresowy sufit gosci (5 x anon_monthly_limit), serializacja pg_advisory_xact_lock per '
  '<najemca>:<podmiot> (i <najemca>:<skrot adresu>) PRZED zliczeniem. P19 (hub S3): tresc '
  'z min_tier_rank powyzej rangi czytajacego nie jest odblokowywana licznikiem. Odmowa konta '
  'z wyczerpanym limitem -> metering.quota_exhausted.v1 raz na konto i miesiac (znacznik '
  'revenue_event_marks kind=quota). Woluja go consume_metered_view (konto) '
  'i consume_metered_view_visitor (service_role).';

-- ----------------------------------------------------------------------------
-- B) Telemetria odmów: tożsamość wyłącznie z sesji.
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20260721070203
CREATE OR REPLACE FUNCTION public.log_metering_event(
  _entity_type text, _entity_id uuid, _outcome text,
  _reason text DEFAULT NULL, _visitor_id uuid DEFAULT NULL,
  _used_before integer DEFAULT NULL, _monthly_limit integer DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF _outcome NOT IN ('denied','granted','exempt','requires_registration') THEN
    RAISE EXCEPTION 'invalid outcome %', _outcome;
  END IF;
  -- Zalogowany klient loguje WYLACZNIE siebie: klucz goscia z ladunku konta
  -- to cudza tozsamosc (zawyzanie sciany rejestracji w raportach). Gosc ma
  -- odmowy logowane przez rdzen po stronie serwera.
  IF v_uid IS NOT NULL AND _visitor_id IS NOT NULL THEN
    RAISE EXCEPTION 'metering_identity_mismatch' USING ERRCODE = '42501';
  END IF;
  IF _entity_type IS NOT NULL AND _entity_type NOT IN ('post', 'page', 'media') THEN
    RAISE EXCEPTION 'metering_invalid_entity_type' USING ERRCODE = '22023';
  END IF;
  -- Za dlugi powod jest odrzucany, nie przycinany - dziennik ma mowic prawde.
  IF _reason IS NOT NULL AND char_length(_reason) > 120 THEN
    RAISE EXCEPTION 'metering_reason_too_long' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.metering_event_log
    (tenant_id, user_id, visitor_id, entity_type, entity_id, outcome, reason, used_before, monthly_limit)
  VALUES
    (public.public_tenant_id(), v_uid, _visitor_id, _entity_type, _entity_id,
     _outcome, _reason, _used_before, _monthly_limit);
END $$;

REVOKE ALL ON FUNCTION public.log_metering_event(text, uuid, text, text, uuid, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_metering_event(text, uuid, text, text, uuid, integer, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.log_metering_event(text, uuid, text, text, uuid, integer, integer) IS
  'Telemetria odmow licznika: user_id wylacznie z auth.uid(); zalogowany klient nie podaje '
  '_visitor_id (42501); powod <= 120 znakow (22023, bez przycinania). Konto i serwer; anon bez EXECUTE.';
