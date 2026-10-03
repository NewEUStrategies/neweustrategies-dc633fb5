-- pgTAP: dzienny p75 Core Web Vitals z górną granicą okna `p_until`
-- (migracja 20261003120000_web_vitals_daily_p75_until.sql).
--
-- Do 2026-10-03 funkcja znała wyłącznie `p_since`, więc `getVitalsSummary`
-- pomijał ją przy każdym jawnym `untilIso` i rysował trend z przyciętej
-- próbki w pamięci. Ten plik pilnuje czterech rzeczy, których atrapa RPC
-- w Vitest nie widzi:
--   1. SYGNATURA. Istnieje DOKŁADNIE jedno przeciążenie (trzyargumentowe
--      z DEFAULT). Dwa przeciążenia dałyby PGRST203 dla wywołania
--      `{p_since, p_tenant}`.
--   2. GRANICA. `p_until` jest domknięta (`<=`, jak `.lte` w handlerze)
--      i tnie WIERSZE, nie dni: próbka z tego samego dnia UTC, ale po
--      granicy, nie wchodzi do p75. Metoda nearest rank zostaje.
--   3. ZGODNOŚĆ WSTECZNA. Wywołanie dwuargumentowe to nadal okno otwarte
--      od góry; odwrócone granice dają pusty wynik, nie błąd.
--   4. IZOLACJA I GRANTY. Obcy najemca nie wchodzi do agregatu, a EXECUTE
--      ma wyłącznie service_role (najemca przychodzi z parametru).
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(13);

-- ── Seed (jako właściciel; RLS pomijane) ────────────────────────────────────
INSERT INTO public.tenants (id, slug, name) VALUES
  ('d1111111-1111-1111-1111-1111111111d1', 'wv-until-a', 'WV Until A'),
  ('d2222222-2222-2222-2222-2222222222d2', 'wv-until-b', 'WV Until B');

-- Okno testowe: [2026-08-20T00:00Z, 2026-08-21T12:00Z].
INSERT INTO public.web_vitals (tenant_id, metric, value, created_at) VALUES
  -- Przed oknem - nie może wejść nigdzie.
  ('d1111111-1111-1111-1111-1111111111d1', 'LCP', 50000, '2026-08-19T12:00:00Z'),
  -- Pierwszy dzień okna: nearest rank z {1000, 2000, 3000, 4000} to 3000
  -- (percentile_cont dałby 3250).
  ('d1111111-1111-1111-1111-1111111111d1', 'LCP', 1000, '2026-08-20T08:00:00Z'),
  ('d1111111-1111-1111-1111-1111111111d1', 'LCP', 2000, '2026-08-20T09:00:00Z'),
  ('d1111111-1111-1111-1111-1111111111d1', 'LCP', 3000, '2026-08-20T10:00:00Z'),
  ('d1111111-1111-1111-1111-1111111111d1', 'LCP', 4000, '2026-08-20T11:00:00Z'),
  -- DOKŁADNIE na górnej granicy - granica domknięta, więc wchodzi.
  ('d1111111-1111-1111-1111-1111111111d1', 'LCP', 2500, '2026-08-21T12:00:00Z'),
  -- Ten sam dzień UTC, ale PO granicy - gdyby granica cięła dni, a nie
  -- wiersze, p75 tego dnia wyniósłby 99000.
  ('d1111111-1111-1111-1111-1111111111d1', 'LCP', 99000, '2026-08-21T18:00:00Z'),
  -- Dzień po oknie.
  ('d1111111-1111-1111-1111-1111111111d1', 'LCP', 77000, '2026-08-22T10:00:00Z'),
  -- Obcy najemca w środku okna, z wartością skrajną.
  ('d2222222-2222-2222-2222-2222222222d2', 'LCP', 88000, '2026-08-20T10:00:00Z');

-- ── 1. Sygnatura ────────────────────────────────────────────────────────────
SELECT has_function(
  'public', 'web_vitals_daily_p75',
  ARRAY['timestamp with time zone', 'uuid', 'timestamp with time zone'],
  'sygnatura z p_until istnieje'
);

SELECT hasnt_function(
  'public', 'web_vitals_daily_p75',
  ARRAY['timestamp with time zone', 'uuid'],
  'stara sygnatura zdjeta - jedno przeciazenie, brak PGRST203'
);

-- ── 2. Górna granica ────────────────────────────────────────────────────────
SELECT results_eq(
  $$ SELECT day
       FROM public.web_vitals_daily_p75('2026-08-20T00:00:00Z',
                                        'd1111111-1111-1111-1111-1111111111d1',
                                        '2026-08-21T12:00:00Z')
      ORDER BY day $$,
  $$ VALUES ('2026-08-20'::date), ('2026-08-21'::date) $$,
  'gorna granica nie doklada dni po p_until'
);

SELECT is(
  (SELECT sum(samples)::int
     FROM public.web_vitals_daily_p75('2026-08-20T00:00:00Z',
                                      'd1111111-1111-1111-1111-1111111111d1',
                                      '2026-08-21T12:00:00Z')),
  5,
  'w oknie 4 + 1 na granicy; bez probki po granicy i bez obcego najemcy'
);

SELECT is(
  (SELECT samples::int
     FROM public.web_vitals_daily_p75('2026-08-20T00:00:00Z',
                                      'd1111111-1111-1111-1111-1111111111d1',
                                      '2026-08-21T12:00:00Z')
    WHERE day = '2026-08-21'),
  1,
  'granica gorna DOMKNIETA (<=), jak .lte w getVitalsSummary'
);

SELECT is(
  (SELECT p75
     FROM public.web_vitals_daily_p75('2026-08-20T00:00:00Z',
                                      'd1111111-1111-1111-1111-1111111111d1',
                                      '2026-08-21T12:00:00Z')
    WHERE day = '2026-08-21'),
  2500::double precision,
  'granica tnie WIERSZE, nie dni - 99000 po p_until nie wchodzi do p75'
);

SELECT is(
  (SELECT p75
     FROM public.web_vitals_daily_p75('2026-08-20T00:00:00Z',
                                      'd1111111-1111-1111-1111-1111111111d1',
                                      '2026-08-21T12:00:00Z')
    WHERE day = '2026-08-20'),
  3000::double precision,
  'nearest rank zachowany (3000, nie 3250) i obce 88000 nie wchodzi do p75'
);

-- ── 3. Zgodność wsteczna ────────────────────────────────────────────────────
SELECT is(
  (SELECT sum(samples)::int
     FROM public.web_vitals_daily_p75('2026-08-20T00:00:00Z',
                                      'd1111111-1111-1111-1111-1111111111d1')),
  7,
  'wywolanie dwuargumentowe = okno otwarte od gory (zgodnosc wsteczna)'
);

SELECT is_empty(
  $$ SELECT *
       FROM public.web_vitals_daily_p75('2026-08-25T00:00:00Z',
                                        'd1111111-1111-1111-1111-1111111111d1',
                                        '2026-08-20T00:00:00Z') $$,
  'odwrocone granice: pusty wynik, nie blad'
);

-- ── 4. Izolacja i granty ────────────────────────────────────────────────────
SELECT results_eq(
  $$ SELECT day, samples::int, p75
       FROM public.web_vitals_daily_p75('2026-08-20T00:00:00Z',
                                        'd2222222-2222-2222-2222-2222222222d2',
                                        '2026-08-21T12:00:00Z') $$,
  $$ VALUES ('2026-08-20'::date, 1, 88000::double precision) $$,
  'najemca B widzi wylacznie wlasna probke - granica okna nie poszerza zakresu najemcy'
);

SELECT ok(
  NOT has_function_privilege('anon',
    'public.web_vitals_daily_p75(timestamptz, uuid, timestamptz)', 'EXECUTE'),
  'anon nie wola funkcji - DROP skasowal ACL, REVOKE nie dopuszcza domyslnych grantow'
);

SELECT ok(
  NOT has_function_privilege('authenticated',
    'public.web_vitals_daily_p75(timestamptz, uuid, timestamptz)', 'EXECUTE'),
  'authenticated nie wola funkcji - tenant idzie z parametru, wiec tylko serwer'
);

SELECT ok(
  has_function_privilege('service_role',
    'public.web_vitals_daily_p75(timestamptz, uuid, timestamptz)', 'EXECUTE'),
  'service_role (supabaseAdmin w getVitalsSummary) wola funkcje'
);

SELECT * FROM finish();
ROLLBACK;
