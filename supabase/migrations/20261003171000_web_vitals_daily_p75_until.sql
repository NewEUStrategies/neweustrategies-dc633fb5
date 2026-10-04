-- Dzienny p75 Core Web Vitals z GÓRNĄ granicą okna (`p_until`).
--
-- STAN WYJŚCIOWY. Ostatnia definicja `web_vitals_daily_p75(p_since, p_tenant)`
-- (20260725120000_analytics_semantic_layer.sql i jej bliźniak treściowy
-- 20260725162011) filtrowała wyłącznie `created_at >= p_since`. Dla okna
-- zamkniętego w przeszłości funkcja dokładałaby więc dni SPOZA zakresu, dlatego
-- `getVitalsSummary` (src/lib/observability/vitals.functions.ts) pomijał RPC
-- przy każdym jawnym `untilIso` i zostawał przy trendzie z pamięci. Ten trend
-- liczy się z NAJNOWSZYCH `SAMPLE_CAP` = 20000 próbek okna, więc na ruchliwym
-- serwisie najstarsze dni okna znikają, a pierwszy ocalały dzień powstaje
-- z niepełnej próbki.
--
-- SKALA. To nie był przypadek brzegowy. `VitalsBiDashboard` (/admin/performance
-- i /admin/analytics/bi) wysyła `untilIso` ZAWSZE - `buildPresetRange`
-- w TimeRangeFilter ustawia górną granicę na „teraz" także dla presetów - więc
-- główny pulpit wydajności nigdy nie dostał dokładnego trendu z bazy. Dostawały
-- go tylko pasek na /admin i mini-karta analityki, które wysyłają `{ days }`.
--
-- CO SIĘ ZMIENIA:
--   1. Trzeci parametr `p_until`, granica DOMKNIĘTA (`<=`) - dokładnie jak
--      `.lte("created_at", until)` w zapytaniu liczącym i wierszowym handlera
--      oraz `created_at <= v_until` w analytics_semantic_snapshot. Trend,
--      `windowTotal` i próbka opisują wtedy JEDNO okno. Granica tnie WIERSZE,
--      nie dni: próbka z tego samego dnia UTC, ale po `p_until`, nie wchodzi
--      do p75 tego dnia.
--   2. DROP starej sygnatury + CREATE nowej zamiast dołożenia przeciążenia.
--      CREATE OR REPLACE z inną listą argumentów tworzy DRUGĄ funkcję,
--      a PostgREST rozstrzyga przeciążenia po nazwach argumentów: wywołanie
--      `{p_since, p_tenant}` pasowałoby i do wersji dwuargumentowej, i do
--      trzyargumentowej z DEFAULT, co kończy się PGRST203. Ten sam wzorzec, co
--      przy dołożeniu `p_tenant` (20260708150000).
--   3. `p_until DEFAULT NULL`, a nie parametr wymagany. Kolejność wdrożenia:
--      jeśli migracja wyprzedzi kod, stary klient z `{p_since, p_tenant}`
--      działa dalej. Dwuargumentowe wywołania w testach pgTAP
--      (web_vitals_tenant_scope_test, analytics_semantic_layer_test) zostają
--      ważne bez zmian. Parametr z domyślną wartością musi stać na końcu,
--      stąd `p_until` jako trzeci. NULL = okno otwarte od góry, jak dotąd.
--   4. `COALESCE(p_until, 'infinity')` zamiast `p_until IS NULL OR ...`.
--      Zmierzone na PG16 przy planie generycznym (prepared statement): forma
--      z OR zostaje w `Filter`, forma z COALESCE trafia do `Index Cond`
--      indeksu web_vitals_tenant_metric_created_idx.
--   5. Odwrócone granice dają pusty wynik, a nie błąd - to samo zero, które
--      zwraca COUNT i odczyt wierszy w handlerze.
--   6. `search_path = public, pg_temp` - przywrócone utwardzenie
--      z 20260709224001, które CREATE OR REPLACE z 20260725 po cichu cofnął
--      do samego `public`.
--
-- BEZPIECZEŃSTWO. Bez SECURITY DEFINER i bez zmian RLS: funkcja czyta
-- `web_vitals` uprawnieniami wołającego, a tabela ma RLS bez polityk, więc
-- realnie czyta ją tylko service_role. Najemca przychodzi z parametru, dlatego
-- EXECUTE dostaje WYŁĄCZNIE service_role (supabaseAdmin w getVitalsSummary,
-- tenant z profilu wołającego). DROP kasuje ACL, a domyślne uprawnienia
-- schematu `public` nadałyby EXECUTE rolom anon/authenticated - stąd jawne
-- REVOKE po CREATE.
--
-- Idempotentna: przy ponownym przebiegu DROP starej sygnatury jest NOTICE,
-- a CREATE OR REPLACE z identyczną sygnaturą podmienia ciało w miejscu.
DROP FUNCTION IF EXISTS public.web_vitals_daily_p75(timestamptz, uuid);

CREATE OR REPLACE FUNCTION public.web_vitals_daily_p75(
  p_since timestamptz,
  p_tenant uuid,
  p_until timestamptz DEFAULT NULL
)
RETURNS TABLE (day date, metric text, p75 double precision, samples bigint)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    (created_at AT TIME ZONE 'UTC')::date AS day,
    metric,
    percentile_disc(0.75) WITHIN GROUP (ORDER BY value) AS p75,
    count(*)::bigint AS samples
  FROM public.web_vitals
  WHERE tenant_id = p_tenant
    AND created_at >= p_since
    AND created_at <= COALESCE(p_until, 'infinity'::timestamptz)
  GROUP BY 1, 2
  ORDER BY 1, 2;
$$;

COMMENT ON FUNCTION public.web_vitals_daily_p75(timestamptz, uuid, timestamptz) IS
  'Dzienny p75 Core Web Vitals per tenant w oknie [p_since, p_until] (domknietym, jak .lte w getVitalsSummary i analytics_semantic_snapshot); p_until NULL = bez gornej granicy. Metoda NEAREST RANK (percentile_disc) identyczna z agregatorem w pamieci (src/lib/observability/aggregate.ts). Dzien kubkowany w UTC.';

REVOKE ALL ON FUNCTION public.web_vitals_daily_p75(timestamptz, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.web_vitals_daily_p75(timestamptz, uuid, timestamptz)
  TO service_role;
