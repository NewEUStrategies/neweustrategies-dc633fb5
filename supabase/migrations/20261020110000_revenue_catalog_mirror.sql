-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S2, 1/8): LUSTRO KATALOGU CEN W SQL - POZYCJA
-- KATALOGU, MIESIĄCE NA CYKL, MRR SUBSKRYPCJI.
--
-- DEFEKT
--   1. Baza nie zna katalogu cen. `subscriptions.price_id` to czytelny klucz
--      ceny operatora (`plus_monthly`, `team_monthly_seat`…), ale warstwę,
--      cykl i rangę zna wyłącznie `BILLING_CATALOG` w TS
--      (src/lib/billing/catalog.ts). Księga MRR liczona w SQL (trigger historii
--      subskrypcji, 110100) nie miałaby z czego wyprowadzić cyklu ani segmentu.
--   2. Subskrypcje sprzed 2026-08-05 mogą stać na kluczach `plus_yearly`
--      i `pro_yearly` (zmienione wtedy na `*_annual`). Katalog TS ich nie ma -
--      MRR takiej subskrypcji byłby „nieznany", a reguła diagnostyki
--      krzyczałaby o cenie spoza katalogu, choć klient płaci od miesięcy.
--   3. Normalizacja do miesiąca żyje w TS (`monthlyEquivalent`,
--      src/lib/billing/subscriptionRepricing.ts). Druga, ręcznie przepisana
--      normalizacja w SQL rozjechałaby się z nią przy pierwszej zmianie
--      (np. tydzień = 52/12 vs 4,33).
--
-- ZMIANA
--   A. `billing_catalog_entry(p_price_id)` - pozycja katalogu: produkt,
--      warstwa, cykl aplikacji (`two_weeks|month|quarter|year|one_time`),
--      ranga, za miejsce, schodkowa, jednorazowa, `legacy`; `NULL` = cały
--      katalog (macierz oferty szuka pary warstwa × cykl). Lista =
--      `[...BILLING_CATALOG, ...BILLING_CATALOG_LEGACY]` (TS) - pilnuje jej
--      test parytetu src/lib/billing/__tests__/billingCatalogSqlParity.test.ts
--      czytający blok `-- katalog:begin` / `-- katalog:end` z tego pliku.
--      Każdy PR zmieniający katalog aktualizuje lustro (R-06).
--   B. `billing_months_per_interval(p_interval, p_count)` - liczba miesięcy
--      jednego okresu rozliczeniowego; MRR = kwota okresu / wynik. Słownik
--      operatora (`day|week|month|year` × krotność) i aplikacji
--      (`two_weeks` = tydzień × 2, `quarter` = miesiąc × 3 - jak
--      `catalogRecurringFor`). Rok = 12, tydzień = 12/52, dzień = 12/365 -
--      DOKŁADNIE konwencja `monthlyEquivalent`; wspólny zestaw przypadków
--      (`-- fixture:monthly-equivalent`) czytają pgTAP i vitest.
--      `one_time` i słowo spoza słownika -> NULL (brak cyklu = brak MRR).
--   C. `subscription_mrr_minor(...)` - MRR jednej subskrypcji w jednostkach
--      drobnych z podstawą:
--        * `provider` - migawka operatora na wierszu subskrypcji
--          (`unit_amount_minor` × ilość − rabat na okres, gdy rabat jeszcze
--          trwa), zaokrąglenie połówek od zera;
--        * `catalog` - D-05: bez migawki kwota z katalogu NAJEMCY
--          (`access_plans` aktywny dla pary warstwa × cykl, kolejność jak
--          `resolvePlanForPrice`), ilość i próg wolumenowy jak
--          `catalogPlanQuote` (miejsca tylko dla `per_seat`, 1-100). Ta
--          podstawa jest JAWNA w wyniku (`basis`) i w księdze
--          (`subscription_state_history.mrr_basis`) - panel opisuje źródło
--          kwoty, zamiast udawać, że zna cenę operatora.
--      Cena nieznana katalogowi albo jednorazowa -> wiersz z `mrr_minor`
--      NULL (nie 0: zero udawałoby zmierzony brak przychodu).
--   Wszystkie trzy funkcje są WEWNĘTRZNE (§4.4): REVOKE dla PUBLIC, anon,
--   authenticated; `billing_catalog_entry` ma EXECUTE dla service_role
--   (testy parytetu), pozostałe żadnej roli API.
--
-- KOLEJNOŚĆ WDROŻENIA: po I0, przed 110100 (trigger księgi woła
-- `subscription_mrr_minor`). Nowe funkcje, nikt ich jeszcze nie woła.
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION (nowe sygnatury - bez CIALO-Z),
-- bezstanowe REVOKE/GRANT. Zero DDL tabel.
-- DOWÓD: supabase/tests/revenue_catalog_mirror_test.sql (katalog z
-- `student_annual` i wpisami legacy, wspólny fixture miesięcy, migawka vs
-- katalog, próg wolumenowy, miejsca, rabat po terminie, granty);
-- src/lib/billing/__tests__/billingCatalogSqlParity.test.ts.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Pozycja katalogu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.billing_catalog_entry(p_price_id text)
RETURNS TABLE (
  price_id text,
  product_id text,
  tier_key text,
  billing_interval text,
  rank integer,
  per_seat boolean,
  volume_tiered boolean,
  one_time boolean,
  legacy boolean
)
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT c.price_id, c.product_id, c.tier_key, c.billing_interval, c.rank,
         c.per_seat, c.volume_tiered, c.one_time, c.legacy
    FROM (VALUES
      -- katalog:begin
      -- (price_id, product_id, tier_key, interval, rank, per_seat, volume_tiered, one_time, legacy)
      ('student_monthly', 'plan_student', 'student', 'month', 10, false, false, false, false),
      ('student_annual', 'plan_student', 'student', 'year', 11, false, false, false, false),
      ('educator_monthly', 'plan_educator', 'educator', 'month', 20, false, false, false, false),
      ('plus_monthly', 'plan_plus', 'member', 'month', 30, false, false, false, false),
      ('plus_annual', 'plan_plus', 'member', 'year', 31, false, false, false, false),
      ('pro_monthly', 'plan_pro', 'pro', 'month', 40, false, false, false, false),
      ('pro_annual', 'plan_pro', 'pro', 'year', 41, false, false, false, false),
      ('team_monthly_seat', 'plan_team', 'team', 'month', 50, true, true, false, false),
      ('decision_lab_seat', 'product_decision_lab', 'decision_lab', 'one_time', 0, false, false, true, false),
      ('business_2w', 'plan_business', 'business', 'two_weeks', 60, false, false, false, false),
      ('business_monthly', 'plan_business', 'business', 'month', 61, false, false, false, false),
      ('business_quarterly', 'plan_business', 'business', 'quarter', 62, false, false, false, false),
      ('plus_yearly', 'plan_plus', 'member', 'year', 31, false, false, false, true),
      ('pro_yearly', 'plan_pro', 'pro', 'year', 41, false, false, false, true)
      -- katalog:end
    ) AS c(price_id, product_id, tier_key, billing_interval, rank, per_seat, volume_tiered, one_time, legacy)
   -- NULL = cały katalog (macierz oferty 110700, parytet w pgTAP).
   WHERE p_price_id IS NULL OR c.price_id = p_price_id
$$;

COMMENT ON FUNCTION public.billing_catalog_entry(text) IS
  'Hub przychodu (S2): lustro BILLING_CATALOG + BILLING_CATALOG_LEGACY (src/lib/billing/catalog.ts). Parytet: billingCatalogSqlParity.test.ts.';

-- ----------------------------------------------------------------------------
-- B) Miesiące jednego okresu rozliczeniowego.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.billing_months_per_interval(p_interval text, p_count integer)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  -- Krotność < 1 albo NULL liczy się jak 1 (`Math.max(1, intervalCount)`).
  SELECT CASE p_interval
           WHEN 'day' THEN 12::numeric * GREATEST(COALESCE(p_count, 1), 1) / 365
           WHEN 'week' THEN 12::numeric * GREATEST(COALESCE(p_count, 1), 1) / 52
           WHEN 'month' THEN GREATEST(COALESCE(p_count, 1), 1)::numeric
           WHEN 'year' THEN 12::numeric * GREATEST(COALESCE(p_count, 1), 1)
           -- Słownik aplikacji (`catalogRecurringFor`): tydzień × 2, miesiąc × 3.
           WHEN 'two_weeks' THEN 24::numeric * GREATEST(COALESCE(p_count, 1), 1) / 52
           WHEN 'quarter' THEN 3::numeric * GREATEST(COALESCE(p_count, 1), 1)
           ELSE NULL
         END
$$;

COMMENT ON FUNCTION public.billing_months_per_interval(text, integer) IS
  'Hub przychodu (S2): miesiące jednego okresu (MRR = kwota / wynik) - lustro monthlyEquivalent (subscriptionRepricing.ts); one_time i nieznane -> NULL.';

-- ----------------------------------------------------------------------------
-- C) MRR subskrypcji z podstawą kwoty.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.subscription_mrr_minor(
  p_tenant uuid,
  p_price_id text,
  p_quantity integer,
  p_unit_amount_minor integer,
  p_currency text,
  p_discount_minor integer,
  p_discount_ends_at timestamptz,
  p_at timestamptz DEFAULT now()
)
RETURNS TABLE (
  mrr_minor integer,
  currency text,
  basis text,
  tier_key text,
  billing_interval text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entry record;
  v_months numeric;
  v_qty integer := GREATEST(COALESCE(p_quantity, 1), 1);
  v_discount integer := 0;
  v_amount numeric;
  v_plan record;
  v_unit integer;
  v_seats integer;
BEGIN
  SELECT * INTO v_entry FROM public.billing_catalog_entry(p_price_id);
  IF NOT FOUND THEN
    -- Cena spoza katalogu: cyklu nie znamy, więc MRR też nie (NULL, nie 0).
    RETURN QUERY SELECT NULL::integer, upper(p_currency), NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;
  v_months := public.billing_months_per_interval(v_entry.billing_interval, 1);
  IF v_entry.one_time OR v_months IS NULL THEN
    RETURN QUERY SELECT NULL::integer, upper(p_currency), NULL::text, v_entry.tier_key, v_entry.billing_interval;
    RETURN;
  END IF;
  -- Rabat liczy się tylko, dopóki trwa (`discount_ends_at` w przyszłości
  -- względem chwili wyceny albo bez końca).
  IF COALESCE(p_discount_minor, 0) > 0
     AND (p_discount_ends_at IS NULL OR p_discount_ends_at > COALESCE(p_at, now())) THEN
    v_discount := p_discount_minor;
  END IF;

  IF p_unit_amount_minor IS NOT NULL AND p_currency ~ '^[A-Za-z]{3}$' THEN
    v_amount := GREATEST(p_unit_amount_minor::numeric * v_qty - v_discount, 0);
    RETURN QUERY SELECT round(v_amount / v_months)::integer, upper(p_currency), 'provider'::text,
                        v_entry.tier_key, v_entry.billing_interval;
    RETURN;
  END IF;

  -- D-05: bez migawki operatora - kwota z katalogu najemcy, jawnie `catalog`.
  SELECT ap.price_cents, ap.currency, ap.volume_threshold_seats, ap.volume_price_cents
    INTO v_plan
    FROM public.access_plans ap
   WHERE ap.tenant_id = p_tenant
     AND ap.tier_key = v_entry.tier_key
     AND ap.interval::text = v_entry.billing_interval
     AND ap.active
   ORDER BY ap.sort_order, ap.created_at, ap.id
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::integer, upper(p_currency), NULL::text, v_entry.tier_key, v_entry.billing_interval;
    RETURN;
  END IF;
  -- `catalogPlanQuote`: miejsca wyłącznie dla planu za miejsce (1-100), próg
  -- wolumenowy w trybie `volume` (wszystkie miejsca po niższej stawce).
  v_seats := CASE WHEN v_entry.per_seat THEN LEAST(v_qty, 100) ELSE 1 END;
  v_unit := CASE
              WHEN v_entry.per_seat AND COALESCE(v_plan.volume_threshold_seats, 0) >= 2
                   AND v_seats >= v_plan.volume_threshold_seats
                THEN COALESCE(v_plan.volume_price_cents, 0)
              ELSE COALESCE(v_plan.price_cents, 0)
            END;
  v_amount := GREATEST(v_unit::numeric * v_seats - v_discount, 0);
  RETURN QUERY SELECT round(v_amount / v_months)::integer, upper(v_plan.currency), 'catalog'::text,
                      v_entry.tier_key, v_entry.billing_interval;
END;
$$;

COMMENT ON FUNCTION public.subscription_mrr_minor(uuid, text, integer, integer, text, integer, timestamptz, timestamptz) IS
  'Hub przychodu (S2): MRR subskrypcji (jednostki drobne) z podstawą provider (migawka operatora) albo catalog (D-05, katalog najemcy jak catalogPlanQuote). Cena nieznana/jednorazowa -> mrr_minor NULL.';

-- ----------------------------------------------------------------------------
-- Granty: helpery wewnętrzne (§4.4).
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.billing_catalog_entry(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_months_per_interval(text, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.subscription_mrr_minor(uuid, text, integer, integer, text, integer, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
-- Test parytetu katalogu po stronie bazy (SPEC §4.4: wyjątek dla service_role).
GRANT EXECUTE ON FUNCTION public.billing_catalog_entry(text) TO service_role;
