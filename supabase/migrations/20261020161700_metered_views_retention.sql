-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I9d-Y1, 3/8): RETENCJA DANYCH - ODCZYTY LICZNIKA
-- ARTYKUŁÓW (Z-I9c-07, kategoria `metered_views`). Decyzja właściciela
-- 2026-10-20: 3 mies. (zakres 2-13) - licznik potrzebuje bieżącego okresu,
-- a historia czytania w serwisie think-tanku może ujawniać poglądy (art. 9
-- RODO, minimalizacja - art. 5 ust. 1 lit. c i e). Przed usunięciem anonimowy
-- agregat dzienny; wskaźniki starszych okien bez zmian.
--
-- DEFEKT
--   1. `metered_views` (konto/gość, CO przeczytano, kiedy) żyje bez końca;
--      ten sam ślad czytania jest w `metering_event_log` (wyzwalacz
--      `metered_views_log_consume`) i w `paywall_hits` (`entity_id`) przez
--      okres kategorii `paywall_metering` (13 mies.).
--   2. Pulpit monetyzacji liczy odczyty (`metered_views`: razem, członkowie,
--      goście) wprost z wierszy surowych - usunięcie wyzerowałoby okna
--      starsze niż okres; lejek liczy konta aktywne także z odczytów
--      (`_funnel_counts`, część surowa) - zaniżyłby okna 3-13 mies.
--
-- ZMIANA (DECYZJE WYKONAWCZE orkiestratora I9d, dziennik §21.22)
--   A. `metered_views_daily` (najemca, dzień): odczyty członków, gości
--      i konta czytające (bez identyfikatorów). Liczone w pętli pieczęci
--      lejka (B) - dzień raz, potem nietykalny.
--   B. `_data_retention_seal_funnel` (CIALO-Z niżej): + agregat odczytów,
--      pierwszy dzień danych także z odczytów.
--   C. `_data_retention_funnel_cut` (CIALO-Z niżej): granica odczytu
--      z agregatu = także próg kategorii `metered_views`, gdy włączona. Lejek
--      (`_funnel_counts`, S3 - bez redefinicji) i pulpit czytają dni sprzed
--      granicy z agregatów dobowych, więc okno sprzed progu ma ten sam wynik
--      przed czyszczeniem i po nim. Skutek (opis w dzienniku i w dymku
--      panelu): okna starsze niż okres licznika (dom. 3 mies., dotąd 13)
--      liczą konto raz na dzień, nie raz na okno.
--   D. `_data_retention_backfill_metered_views` - agregat dni już
--      zapieczętowanych przez I9c-X2 (pieczęć nie liczyła wtedy odczytów);
--      wywołanie na końcu, póki surowe istnieją.
--   E. `_data_retention_metered_views` - pieczęć do progu, potem: odczyty
--      starsze niż próg (nigdy bieżący okres licznika) -> usunięte;
--      `metering_event_log.entity_id` i `paywall_hits.entity_id` starsze niż
--      próg -> NULL (wynik, powód, czas i konto/gość zostają - wskaźniki ich
--      nie potrzebują), `purged_before` lejka podniesione. `paywall_hits.
--      entity_id` traci NOT NULL (NULL = treść zredagowana; indeksy unikalne
--      traktują NULL jako różne, więc zapis nowych uderzeń bez zmian).
--   F. `monetization_dashboard` (CIALO-Z niżej = rejestr bramki dla funkcji
--      sprzed huba; ciało z wersji I9c 20261020161200): `metered_views`
--      dni sprzed granicy z A; kształt odpowiedzi bez zmian.
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020161000-161400 (agregaty, pieczęć,
-- odczyty I9c). Kategoria wchodzi do katalogu w 20261020162200 (rdzeń) - do
-- tego czasu granica C nie widzi kategorii i działa jak w I9c.
-- IDEMPOTENTNA: CREATE TABLE/INDEX IF NOT EXISTS, DROP NOT NULL (powtórka -
-- no-op), CREATE OR REPLACE FUNCTION, uzupełnienie `ON CONFLICT DO NOTHING`,
-- bezstanowe REVOKE/GRANT.
-- DOWÓD: supabase/tests/hub_i9d_metered_views_test.sql (usuwa tylko starsze
-- niż próg i nigdy bieżącego okresu; pulpit i lejek okna sprzed progu
-- identyczne przed i po; uzupełnienie dnia zapieczętowanego; redakcja
-- dziennika i uderzeń; podgląd nic nie zmienia; idempotencja; ACL).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Agregat odczytów licznika (bez identyfikatorów osób i treści).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.metered_views_daily (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  day date NOT NULL,
  -- Odczyty członków (konto) i gości - kształt `monetization_dashboard`.
  members integer NOT NULL DEFAULT 0 CHECK (members >= 0),
  anonymous integer NOT NULL DEFAULT 0 CHECK (anonymous >= 0),
  -- Konta czytające tego dnia (konto raz na dzień) - konta aktywne z odczytów.
  accounts integer NOT NULL DEFAULT 0 CHECK (accounts >= 0),
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, day)
);

ALTER TABLE public.metered_views_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.metered_views_daily FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.metered_views_daily TO service_role;

COMMENT ON TABLE public.metered_views_daily IS
  'Retencja danych (I9d): anonimowy agregat dzienny odczytów licznika artykułów (członkowie, goście, konta czytające) - pulpit monetyzacji czyta z niego dni sprzed granicy retencji. Pisze pieczęć lejka; tylko funkcje SECURITY DEFINER.';

-- Gorące tabele (każde czytanie artykułu, każde uderzenie w paywall) -
-- limit blokady: DDL nie czeka w kolejce za długą transakcją.
SET lock_timeout = '5s';
-- Usuwanie i podgląd po dniu (`created_at`) - dotychczasowe indeksy są po
-- koncie/gościu i okresie.
CREATE INDEX IF NOT EXISTS metered_views_tenant_created_idx ON public.metered_views (tenant_id, created_at);
ALTER TABLE public.paywall_hits ALTER COLUMN entity_id DROP NOT NULL;
RESET lock_timeout;

COMMENT ON COLUMN public.paywall_hits.entity_id IS
  'Treść, w którą uderzono. NULL = zredagowana przez retencję odczytów licznika (I9d, starsze niż okres kategorii metered_views); zapis nowego uderzenia zawsze ją podaje.';

-- ----------------------------------------------------------------------------
-- B) Pieczęć lejka: + agregat odczytów licznika.
-- ----------------------------------------------------------------------------
-- Ciało z 20261020161000; zmiany oznaczone „ZMIANA (I9d)".
-- CIALO-Z: 20261020161000
CREATE OR REPLACE FUNCTION public._data_retention_seal_funnel(
  p_tenant uuid,
  p_until date,
  p_max_days integer DEFAULT 31
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_segments constant text[] := ARRAY['b2c_individual', 'b2c_reduced', 'b2b_institution'];
  v_sealed date;
  v_first date;
  v_day date;
  v_stop date;
  v_counts jsonb;
  v_converted jsonb;
  v_seg text;
  v_days integer := 0;
BEGIN
  IF p_tenant IS NULL OR p_until IS NULL THEN
    RETURN jsonb_build_object('sealed_through', NULL, 'days', 0, 'complete', false);
  END IF;
  -- Jeden pieczętujący na najemcę naraz (przebieg nocny i „uruchom teraz").
  PERFORM pg_advisory_xact_lock(hashtextextended('data_retention_seal_funnel:' || p_tenant::text, 0));
  SELECT st.sealed_through INTO v_sealed FROM public.data_retention_state st
   WHERE st.tenant_id = p_tenant AND st.scope = 'funnel';
  IF v_sealed IS NOT NULL AND v_sealed >= p_until - 1 THEN
    RETURN jsonb_build_object('sealed_through', v_sealed, 'days', 0, 'complete', true);
  END IF;
  IF v_sealed IS NULL THEN
    -- ZMIANA (I9d): także pierwszy dzień odczytów licznika - dzień bez
    -- uderzeń i zdarzeń, ale z odczytami, też trafia do agregatu.
    SELECT LEAST(
             (SELECT min(ph.day) FROM public.paywall_hits ph WHERE ph.tenant_id = p_tenant),
             (SELECT min((ml.occurred_at AT TIME ZONE 'UTC')::date) FROM public.metering_event_log ml
               WHERE ml.tenant_id = p_tenant),
             (SELECT min((mv.created_at AT TIME ZONE 'UTC')::date) FROM public.metered_views mv
               WHERE mv.tenant_id = p_tenant))
      INTO v_first;
    v_day := COALESCE(LEAST(v_first, p_until), p_until);
  ELSE
    v_day := v_sealed + 1;
  END IF;
  v_stop := LEAST(p_until, v_day + GREATEST(COALESCE(p_max_days, 31), 1));

  WHILE v_day < v_stop LOOP
    v_counts := public._funnel_counts(p_tenant, v_day::timestamp AT TIME ZONE 'UTC',
                                      (v_day + 1)::timestamp AT TIME ZONE 'UTC', 'all');
    v_converted := jsonb_build_object('all', COALESCE((v_counts ->> 'paywall_converted_accounts')::integer, 0));
    FOREACH v_seg IN ARRAY c_segments LOOP
      v_converted := v_converted || jsonb_build_object(v_seg, COALESCE((public._funnel_counts(
        p_tenant, v_day::timestamp AT TIME ZONE 'UTC', (v_day + 1)::timestamp AT TIME ZONE 'UTC', v_seg)
        ->> 'paywall_converted_accounts')::integer, 0));
    END LOOP;
    INSERT INTO public.funnel_paywall_daily AS f (
      tenant_id, day, active_accounts, paywall_hit_accounts, paywall_hit_visitors, paywall_hits,
      converted, reasons, computed_at
    ) VALUES (
      p_tenant, v_day,
      COALESCE((v_counts ->> 'active_accounts')::integer, 0),
      COALESCE((v_counts ->> 'paywall_hit_accounts')::integer, 0),
      COALESCE((v_counts ->> 'paywall_hit_visitors')::integer, 0),
      COALESCE((v_counts ->> 'paywall_hits')::bigint, 0),
      v_converted,
      COALESCE(v_counts -> 'paywall_reasons', '[]'::jsonb),
      now()
    )
    ON CONFLICT (tenant_id, day) DO UPDATE
       SET active_accounts = EXCLUDED.active_accounts, paywall_hit_accounts = EXCLUDED.paywall_hit_accounts,
           paywall_hit_visitors = EXCLUDED.paywall_hit_visitors, paywall_hits = EXCLUDED.paywall_hits,
           converted = EXCLUDED.converted, reasons = EXCLUDED.reasons, computed_at = EXCLUDED.computed_at;

    INSERT INTO public.metering_events_daily AS m (tenant_id, day, outcome, events)
    SELECT p_tenant, v_day, ml.outcome, count(*)::integer
      FROM public.metering_event_log ml
     WHERE ml.tenant_id = p_tenant
       AND ml.occurred_at >= v_day::timestamp AT TIME ZONE 'UTC'
       AND ml.occurred_at < (v_day + 1)::timestamp AT TIME ZONE 'UTC'
     GROUP BY ml.outcome
    ON CONFLICT (tenant_id, day, outcome) DO UPDATE SET events = EXCLUDED.events;

    -- ZMIANA (I9d): odczyty licznika dnia (członkowie, goście, konta) - pulpit
    -- monetyzacji czyta z nich dni sprzed granicy, gdy surowe znikną.
    INSERT INTO public.metered_views_daily AS d (tenant_id, day, members, anonymous, accounts, computed_at)
    SELECT p_tenant, v_day,
           count(*) FILTER (WHERE mv.user_id IS NOT NULL)::integer,
           count(*) FILTER (WHERE mv.user_id IS NULL)::integer,
           count(DISTINCT mv.user_id)::integer,
           now()
      FROM public.metered_views mv
     WHERE mv.tenant_id = p_tenant
       AND mv.created_at >= v_day::timestamp AT TIME ZONE 'UTC'
       AND mv.created_at < (v_day + 1)::timestamp AT TIME ZONE 'UTC'
    HAVING count(*) > 0
    ON CONFLICT (tenant_id, day) DO UPDATE
       SET members = EXCLUDED.members, anonymous = EXCLUDED.anonymous, accounts = EXCLUDED.accounts,
           computed_at = EXCLUDED.computed_at;

    v_days := v_days + 1;
    v_day := v_day + 1;
  END LOOP;

  v_sealed := v_stop - 1;
  INSERT INTO public.data_retention_state AS st (tenant_id, scope, sealed_through, updated_at)
  VALUES (p_tenant, 'funnel', v_sealed, now())
  ON CONFLICT (tenant_id, scope) DO UPDATE
     SET sealed_through = GREATEST(COALESCE(st.sealed_through, EXCLUDED.sealed_through), EXCLUDED.sealed_through),
         updated_at = now();
  RETURN jsonb_build_object('sealed_through', v_sealed, 'days', v_days, 'complete', v_stop >= p_until);
END;
$$;
REVOKE ALL ON FUNCTION public._data_retention_seal_funnel(uuid, date, integer) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- C) Granica odczytu z agregatu: także próg odczytów licznika.
-- ----------------------------------------------------------------------------
-- Późniejsza z (próg `paywall_metering`, próg `metered_views` gdy włączona,
-- dzień, poniżej którego surowe już usunięto), nigdy dalej niż dzień po
-- ostatnim zapieczętowanym. GREATEST pomija NULL (kategoria wyłączona albo
-- jeszcze nie w katalogu).
-- CIALO-Z: 20261020161000
CREATE OR REPLACE FUNCTION public._data_retention_funnel_cut(p_tenant uuid)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN st.sealed_through IS NULL THEN NULL
              ELSE LEAST(st.sealed_through + 1,
                         GREATEST(COALESCE(st.purged_before, '-infinity'::date), e.paywall, e.views)) END
    FROM public.data_retention_state st
   CROSS JOIN LATERAL (
     SELECT (max(x.cutoff) FILTER (WHERE x.category = 'paywall_metering') AT TIME ZONE 'UTC')::date AS paywall,
            (max(x.cutoff) FILTER (WHERE x.category = 'metered_views' AND x.enabled) AT TIME ZONE 'UTC')::date AS views
       FROM public._data_retention_effective(p_tenant) x
   ) e
   WHERE st.tenant_id = p_tenant AND st.scope = 'funnel'
$$;
REVOKE ALL ON FUNCTION public._data_retention_funnel_cut(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- D) Uzupełnienie agregatu dni zapieczętowanych przed I9d.
-- ----------------------------------------------------------------------------
-- Dzień <= `sealed_through` bez wiersza agregatu, a z odczytami - liczony
-- z wierszy surowych (do I9d nikt ich nie usuwał). `ON CONFLICT DO NOTHING`:
-- dnia policzonego przez pieczęć nie nadpisuje. NULL = wszyscy najemcy.
CREATE OR REPLACE FUNCTION public._data_retention_backfill_metered_views(p_tenant uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n integer := 0;
BEGIN
  INSERT INTO public.metered_views_daily (tenant_id, day, members, anonymous, accounts, computed_at)
  SELECT mv.tenant_id, (mv.created_at AT TIME ZONE 'UTC')::date,
         count(*) FILTER (WHERE mv.user_id IS NOT NULL)::integer,
         count(*) FILTER (WHERE mv.user_id IS NULL)::integer,
         count(DISTINCT mv.user_id)::integer,
         now()
    FROM public.metered_views mv
    JOIN public.data_retention_state st
      ON st.tenant_id = mv.tenant_id AND st.scope = 'funnel' AND st.sealed_through IS NOT NULL
   WHERE (p_tenant IS NULL OR mv.tenant_id = p_tenant)
     AND mv.created_at < (st.sealed_through + 1)::timestamp AT TIME ZONE 'UTC'
   GROUP BY mv.tenant_id, (mv.created_at AT TIME ZONE 'UTC')::date
  ON CONFLICT (tenant_id, day) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public._data_retention_backfill_metered_views(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- E) Funkcja kategorii.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._data_retention_metered_views(
  p_tenant uuid, p_cutoff timestamptz, p_execute boolean, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_day date := (p_cutoff AT TIME ZONE 'UTC')::date;
  -- Bieżący okres licznika liczony TAK SAMO jak w `_metered_view_consume` -
  -- jego wierszy nie ruszamy nigdy (podwójny bezpiecznik obok minimum 2 mies.).
  v_period date := date_trunc('month', now())::date;
  v_seal jsonb;
  v_cut date;
  v_cut_at timestamptz;
  v_views integer := 0;
  v_log integer := 0;
  v_hits integer := 0;
BEGIN
  -- Najpierw agregaty dzienne (lejek, zdarzenia, odczyty), potem usuwanie -
  -- i tylko do dnia zapieczętowanego (reszta przy kolejnym przebiegu).
  v_seal := public._data_retention_seal_funnel(p_tenant, v_day);
  v_cut := LEAST(v_day, (v_seal ->> 'sealed_through')::date + 1);
  v_cut_at := v_cut::timestamp AT TIME ZONE 'UTC';
  IF p_execute THEN
    WITH doomed AS (
      SELECT mv.id FROM public.metered_views mv
       WHERE mv.tenant_id = p_tenant AND mv.created_at < v_cut_at AND mv.period_month < v_period
       ORDER BY mv.created_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
    DELETE FROM public.metered_views mv USING doomed d WHERE mv.id = d.id;
    GET DIAGNOSTICS v_views = ROW_COUNT;
    -- Historia czytania w dzienniku licznika i w uderzeniach: CO przeczytano
    -- -> NULL; wynik, powód, czas i podmiot zostają (wskaźniki i pseudonim
    -- po usunięciu konta ich potrzebują).
    WITH doomed AS (
      SELECT ml.id FROM public.metering_event_log ml
       WHERE ml.tenant_id = p_tenant AND ml.occurred_at < v_cut_at AND ml.entity_id IS NOT NULL
       ORDER BY ml.occurred_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
    UPDATE public.metering_event_log ml SET entity_id = NULL FROM doomed d WHERE ml.id = d.id;
    GET DIAGNOSTICS v_log = ROW_COUNT;
    WITH doomed AS (
      SELECT ph.id FROM public.paywall_hits ph
       WHERE ph.tenant_id = p_tenant AND ph.day < v_cut AND ph.entity_id IS NOT NULL
       ORDER BY ph.day LIMIT p_limit FOR UPDATE SKIP LOCKED)
    UPDATE public.paywall_hits ph SET entity_id = NULL FROM doomed d WHERE ph.id = d.id;
    GET DIAGNOSTICS v_hits = ROW_COUNT;
    UPDATE public.data_retention_state st
       SET purged_before = GREATEST(COALESCE(st.purged_before, v_cut), v_cut), updated_at = now()
     WHERE st.tenant_id = p_tenant AND st.scope = 'funnel' AND v_cut IS NOT NULL;
  ELSE
    SELECT public._data_retention_bounded(count(*), p_limit) INTO v_views FROM (
      SELECT 1 FROM public.metered_views mv
       WHERE mv.tenant_id = p_tenant AND mv.created_at < v_cut_at AND mv.period_month < v_period LIMIT p_limit) x;
    SELECT public._data_retention_bounded(count(*), p_limit) INTO v_log FROM (
      SELECT 1 FROM public.metering_event_log ml
       WHERE ml.tenant_id = p_tenant AND ml.occurred_at < v_cut_at AND ml.entity_id IS NOT NULL LIMIT p_limit) x;
    SELECT public._data_retention_bounded(count(*), p_limit) INTO v_hits FROM (
      SELECT 1 FROM public.paywall_hits ph
       WHERE ph.tenant_id = p_tenant AND ph.day < v_cut AND ph.entity_id IS NOT NULL LIMIT p_limit) x;
  END IF;
  RETURN jsonb_build_object('affected', v_views + v_log + v_hits,
    'backlog', v_views >= p_limit OR v_log >= p_limit OR v_hits >= p_limit
               OR NOT COALESCE((v_seal ->> 'complete')::boolean, false),
    'cutoff', v_cut_at);
END;
$$;
REVOKE ALL ON FUNCTION public._data_retention_metered_views(uuid, timestamptz, boolean, integer) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._data_retention_metered_views(uuid, timestamptz, boolean, integer) IS
  'Retencja danych (I9d, kategoria metered_views): pieczęć lejka i agregatu odczytów do progu, potem odczyty licznika starsze niż próg (nigdy bieżący okres) usunięte, entity_id w metering_event_log i paywall_hits -> NULL. Podgląd liczy. Wewnętrzny.';

-- ----------------------------------------------------------------------------
-- F) Pulpit monetyzacji: odczyty dni sprzed granicy z agregatu.
-- ----------------------------------------------------------------------------
-- Ciało z wersji I9c 20261020161200 (najemca z sesji, bramka admin/editor,
-- zdarzenia licznika z agregatu); zmienia się źródło `metered_views` dla dni
-- < granica. Znacznik niżej to wersja rejestru bramki (definicja sprzed huba).
-- CIALO-Z: 20260724100000
CREATE OR REPLACE FUNCTION public.monetization_dashboard(
  _from timestamptz DEFAULT (now() - interval '30 days'),
  _to timestamptz DEFAULT now(),
  _plan_id uuid DEFAULT NULL,
  _organization_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp STABLE AS $$
DECLARE v_tenant uuid := public.current_tenant_id(); v_out jsonb; -- FIX: był public_tenant_id()
  -- ZMIANA (I9c-X2): dni < granica retencji z `metering_events_daily`;
  -- (I9d) odczyty licznika - z `metered_views_daily`.
  v_cut timestamptz := public._data_retention_funnel_cut(public.current_tenant_id())::timestamp AT TIME ZONE 'UTC';
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  -- ZMIANA (I9d): odczyty licznika - część surowa od granicy, dni sprzed
  -- granicy z `metered_views_daily` (ten sam podział co zdarzenia niżej).
  WITH mv_rows AS (
    SELECT count(*) FILTER (WHERE user_id IS NOT NULL) AS members,
           count(*) FILTER (WHERE user_id IS NULL) AS anonymous
    FROM public.metered_views
    WHERE tenant_id = v_tenant AND created_at >= GREATEST(_from, COALESCE(v_cut, '-infinity'::timestamptz))
      AND created_at <= _to
    UNION ALL
    SELECT sum(d.members), sum(d.anonymous)
    FROM public.metered_views_daily d
    WHERE v_cut IS NOT NULL AND d.tenant_id = v_tenant
      AND d.day >= (_from AT TIME ZONE 'UTC')::date AND d.day <= (_to AT TIME ZONE 'UTC')::date
      AND d.day < (v_cut AT TIME ZONE 'UTC')::date
  ), mv AS (
    SELECT (COALESCE(sum(members), 0) + COALESCE(sum(anonymous), 0))::int AS total,
           COALESCE(sum(members), 0)::int AS members,
           COALESCE(sum(anonymous), 0)::int AS anonymous
    FROM mv_rows
  ), ev_rows AS (
    SELECT outcome, 1 AS n
    FROM public.metering_event_log
    WHERE tenant_id = v_tenant AND occurred_at >= GREATEST(_from, COALESCE(v_cut, '-infinity'::timestamptz))
      AND occurred_at <= _to
    UNION ALL
    SELECT d.outcome, d.events
    FROM public.metering_events_daily d
    WHERE v_cut IS NOT NULL AND d.tenant_id = v_tenant
      AND d.day >= (_from AT TIME ZONE 'UTC')::date AND d.day <= (_to AT TIME ZONE 'UTC')::date
      AND d.day < (v_cut AT TIME ZONE 'UTC')::date
  ), ev AS (
    SELECT
      COALESCE(sum(n) FILTER (WHERE outcome='consumed'), 0)::int AS consumed,
      COALESCE(sum(n) FILTER (WHERE outcome='denied'), 0)::int AS denied,
      COALESCE(sum(n) FILTER (WHERE outcome='requires_registration'), 0)::int AS reg_wall
    FROM ev_rows
  ), orders AS (
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE status='paid')::int AS paid,
           coalesce(sum(amount_cents) FILTER (WHERE status='paid'),0)::bigint AS revenue_cents
    FROM public.payment_orders
    WHERE tenant_id = v_tenant
      AND created_at >= _from AND created_at <= _to
      AND (_plan_id IS NULL OR plan_id = _plan_id)
  ), coupons AS (
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE active)::int AS active,
           coalesce(sum(redemptions_count),0)::int AS redemptions
    FROM public.b2b_coupons
    WHERE tenant_id = v_tenant
      AND (_organization_id IS NULL OR organization_id = _organization_id)
  ), redemptions AS (
    SELECT count(*)::int AS in_range,
           coalesce(sum(applied_cents),0)::bigint AS discount_cents
    FROM public.b2b_coupon_redemptions r
    WHERE r.tenant_id = v_tenant
      AND r.created_at >= _from AND r.created_at <= _to
      AND (_organization_id IS NULL
           OR EXISTS (SELECT 1 FROM public.b2b_coupons c
                       WHERE c.id = r.coupon_id AND c.organization_id = _organization_id))
  ), cs AS (
    SELECT to_jsonb(cs.*) AS settings
    FROM public.checkout_settings cs
    WHERE cs.tenant_id = v_tenant
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'range', jsonb_build_object('from', _from, 'to', _to),
    'metered_views', (SELECT to_jsonb(mv) FROM mv),
    'metering_events', (SELECT to_jsonb(ev) FROM ev),
    'orders', (SELECT to_jsonb(orders) FROM orders),
    'coupons', (SELECT to_jsonb(coupons) FROM coupons),
    'redemptions', (SELECT to_jsonb(redemptions) FROM redemptions),
    'checkout_settings', COALESCE((SELECT settings FROM cs), '{}'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION public.monetization_dashboard(timestamptz, timestamptz, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.monetization_dashboard(timestamptz, timestamptz, uuid, uuid) TO authenticated, service_role;

-- Dni zapieczętowane przez I9c-X2 przed tą migracją (surowe jeszcze są).
SELECT public._data_retention_backfill_metered_views(NULL);
