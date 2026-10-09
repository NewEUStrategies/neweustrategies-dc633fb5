-- ============================================================================
-- KONTRAKT KOLUMN PO WDROZENIU: `missing_schema_columns(jsonb)`.
--
-- PRZYCZYNA. 2026-10-09 katalog /podcasts byl trwale zdegradowany, bo
-- produkcja nie miala ZADNEJ z 19 kolumn migracji 20260725090500 (PostgREST:
-- 42703 „column podcasts.explicit does not exist"). Ta sama sonda tego dnia
-- znalazla jeszcze 7 kolumn, ktorych produkcja nie ma, choc migracje je dodaja
-- (`membership_grants.source_coupon_id`, `notifications.meta`, `tenant_id`
-- czterech tabel `research_program_*`, `research_program_members.id`).
-- Zadna bramka tego nie widziala: `check:db-contract` pytal wylacznie
-- o tabele, widoki i funkcje (`missing_schema_objects`), a
-- `check:migration-ledger` egzekwuje wersje dopiero od baseline
-- 20260825230232 - migracja dodajaca same kolumny sprzed tej linii byla
-- niewidoczna dla obu.
--
-- CO ROBI. Ten sam wzorzec co `missing_schema_objects` (20260912170000):
-- dostaje liste par {table, column} ze schematu `public`, czyta WYLACZNIE
-- katalog (pg_attribute), nie wykonuje niczego z aplikacji i zwraca tylko
-- PODZBIOR podanych par, ktorych brak - nie da sie nia enumerowac schematu.
-- Kolumna widoku tez sie liczy (tabela zastapiona widokiem o tej samej nazwie
-- dalej wystawia kolumne przez Data API).
--
-- UPRAWNIENIA = WOLAJACY. Jedyny wolajacy to post-deploy CI
-- (`scripts/check-db-contract.ts` przez `src/lib/ci/deploymentProbe.ts`)
-- z kluczem publikowalnym (anon) albo serwisowym. `authenticated` nie ma
-- sciezki, wiec nie dostaje EXECUTE; domyslne uprawnienia platformy nadaja je
-- jawnie anon i authenticated, stad REVOKE przed GRANT.
--
-- IDEMPOTENTNA: CREATE OR REPLACE + bezstanowe REVOKE/GRANT.
-- DOWOD: supabase/tests/schema_column_probe_test.sql.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.missing_schema_columns(_columns jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_missing jsonb;
BEGIN
  IF _columns IS NULL OR jsonb_typeof(_columns) <> 'array' THEN
    RAISE EXCEPTION 'contract: expected an array' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(_columns) > 100 THEN
    RAISE EXCEPTION 'contract: maximum 100 columns per request' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_columns) c
    WHERE jsonb_typeof(c) <> 'object'
      OR (c->>'table') IS NULL OR (c->>'table') !~ '^[a-z_][a-z0-9_]*$'
      OR (c->>'column') IS NULL OR (c->>'column') !~ '^[a-z_][a-z0-9_]*$'
  ) THEN
    RAISE EXCEPTION 'contract: invalid public column' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(jsonb_agg(c ORDER BY c->>'table', c->>'column'), '[]'::jsonb)
  INTO v_missing
  FROM (SELECT DISTINCT jsonb_build_object('table', x->>'table', 'column', x->>'column') c
        FROM jsonb_array_elements(_columns) x) requested
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class r ON r.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'public' AND r.relname = c->>'table'
      AND r.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND a.attname = c->>'column' AND a.attnum > 0 AND NOT a.attisdropped
  );
  RETURN v_missing;
END;
$$;
REVOKE ALL ON FUNCTION public.missing_schema_columns(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.missing_schema_columns(jsonb) TO anon, service_role;
COMMENT ON FUNCTION public.missing_schema_columns(jsonb) IS
  'Fundacja New European Strategies: read-only CI column contract; returns the subset of requested public columns that do not exist.';
