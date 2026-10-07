-- ============================================================================
-- RETENCJA `rate_limits`: liczniki starsze niz 2 doby znikaja co godzine.
--
-- DEFEKT (audyt platformy, probe-surfaces-8). Jedyny DELETE na tej tabeli to
-- jednorazowe sprzatanie z 20260721165306. Kazdy limiter dopisuje wiersz na
-- (zakres, podmiot, okno), a czesc podmiotow wybiera wolajacy (e-mail zapisu
-- na wydarzenie, prefiks tokenu, identyfikator tresci przed jej odczytem) -
-- skrypt rotujacy wartosci dokladal wiec wiersze bez konca, a z tabela rosly
-- indeks unikalny i koszt KAZDEGO sprawdzenia limitu na platformie.
--
-- ZMIANA:
--   * `rate_limits_prune(p_limit)` - kasuje partiami (najstarsze, SKIP LOCKED)
--     wiersze z `window_start` starszym niz 2 doby. Najdluzsze okno limitu w
--     repo to doba (`windowMinutes: 1440`), a zaden odczyt nie sumuje okien
--     wstecz, wiec wiersz starszy niz 2 doby nie zmienia zadnej decyzji.
--     TYLKO `service_role`.
--   * pg_cron co godzine (minuta 29 - wolna w harmonogramie repo), gdy
--     rozszerzenie jest dostepne; inaczej funkcja zostaje wywolaniem na
--     zadanie, a migracja mowi to wprost.
--   BEZ nowego indeksu na `window_start`: zwykly CREATE INDEX na nieczyszczonej
--   tabeli produkcyjnej blokowalby zapisy, czyli KAZDY limiter, na czas budowy.
--   Partia wybiera wiersze sekwencyjnie - przy przewadze starych wierszy to
--   tanie, a po pierwszych przebiegach tabela miesci sie w 2 dobach ruchu.
--
-- CZEGO TO NIE ZMIENIA: okna sa nadal stale (wyrownane do epoki), wiec na
-- granicy okna mozliwy jest podwojny wybuch prob - zamiana na kubelek
-- przesuwny to osobna zmiana `rate_limit_hit`.
--
-- IDEMPOTENTNA: CREATE OR REPLACE, wyrejestrowanie zadania przed rejestracja.
-- DOWOD: supabase/tests/rate_limits_retention_test.sql.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rate_limits_prune(p_limit integer DEFAULT 50000)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50000), 1), 500000);
  v_deleted integer;
BEGIN
  WITH doomed AS (
    SELECT ctid FROM public.rate_limits
     WHERE window_start < now() - interval '2 days'
     ORDER BY window_start
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.rate_limits r
   USING doomed d
   WHERE r.ctid = d.ctid;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END $$;
REVOKE ALL ON FUNCTION public.rate_limits_prune(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limits_prune(integer) TO service_role;

COMMENT ON FUNCTION public.rate_limits_prune(integer) IS
  'Retencja licznikow limitow: kasuje partiami (najstarsze najpierw, SKIP LOCKED) wiersze rate_limits z window_start starszym niz 2 doby (najdluzsze okno w repo to doba). p_limit 1..500000, domyslnie 50000. Co godzine z pg_cron (rate-limits-prune, minuta 29), gdy rozszerzenie jest dostepne; inaczej na zadanie (service_role).';

DO $$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron unavailable - rate_limits retention runs only on demand';
    RETURN;
  END IF;
  BEGIN
    PERFORM cron.unschedule('rate-limits-prune');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM cron.schedule('rate-limits-prune', '29 * * * *', $job$SELECT public.rate_limits_prune(50000)$job$);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'rate_limits: scheduling retention job failed (%)', SQLERRM;
END $$;
