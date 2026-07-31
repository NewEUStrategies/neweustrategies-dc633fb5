-- pgTAP: siatka społeczności w bazie - invoke_community_cron + job_runner_autoarm
-- (migracja 20260731210000).
--
-- Kontekst (audyt "Scheduler push + digest", P0): kolejka push, konsument i
-- gating były gotowe, ale /api/public/community-cron nie miał ŻADNEGO wołacza
-- po stronie bazy - scheduler repo bywa wyłączony (60 dni bez aktywności) albo
-- nieskonfigurowany, a jobs-tick drenuje kanały społeczności dopiero PO
-- newsletterze w tym samym budżecie 25 s. Ten test pilnuje mechanizmów,
-- które to naprawiają:
--
--   1. Funkcje puknięcia (invoke_community_cron, job_runner_autoarm) są
--      service-role only - klient nie może pukać ani zbroić runnera.
--   2. job_runner_autoarm() zbroi WYŁĄCZNIE wiersz dziewiczy i tylko raz;
--      decyzja operatora (stempel auto_armed_at, ręczne wyłączenie) jest
--      nienaruszalna. To JEDNA logika samozbrojenia dla obu puknięć -
--      dwie inline'owe kopie to klasa awarii pojednana w 20260731130000.
--   3. invoke_community_cron() jest fail-open bez pg_net i stempluje POWÓD
--      pominięcia (disabled / no_secret / pg_net_unavailable) we WŁASNEJ
--      telemetrii community_last_tick_* - bez dotykania telemetrii jobs-tick,
--      bo rozjazd tych dwóch statusów lokalizuje awarię konkretnej ścieżki.
--   4. Job spoza kontraktu spada do 'all' zamiast wysadzić crona na zawsze.
--   5. Wpis pg_cron 'community-cron' jest zaplanowany co 5 minut z PRZEPLOTEM
--      (minuty 2,7,12,...): jobs-tick zagląda do digestów w minutach
--      podzielnych przez 5, więc przesunięte okna się przeplatają.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(17);

-- Nieobecność pg_net WYMUSZAMY, zamiast liczyć na środowisko (na Supabase
-- pg_net JEST zainstalowany). DDL jest transakcyjne, plik kończy się
-- ROLLBACK-iem, więc rozszerzenie wraca po teście; CASCADE jest bezpieczne,
-- bo puknięcia wołają net.http_post dynamicznie z ciała plpgsql.
DROP EXTENSION IF EXISTS pg_net CASCADE;

-- Stan wyjściowy JAWNIE dziewiczy + deterministyczna domena tenanta
-- domyślnego (samozbrojenie liczy z niej adres, a seed środowiska bywa różny).
UPDATE public.tenants SET domain = 'autoarm-sched.test' WHERE is_default;
UPDATE public.job_runner_settings
   SET enabled = false,
       base_url = '',
       secret = 'sekret-testowy',
       auto_armed_at = NULL,
       last_tick_at = NULL,
       last_tick_status = NULL,
       last_tick_error = NULL,
       tick_count = 0,
       community_last_tick_at = NULL,
       community_last_tick_status = NULL,
       community_last_tick_error = NULL,
       community_tick_count = 0
 WHERE id = 1;

-- -- 1. Puknięcia poza zasięgiem klienta ---------------------------------------
SELECT has_function('public', 'invoke_community_cron', ARRAY['text'],
  'invoke_community_cron istnieje');
SELECT has_function('public', 'job_runner_autoarm',
  'job_runner_autoarm istnieje (jedna logika samozbrojenia)');

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.invoke_community_cron(text)', 'EXECUTE'),
  'authenticated nie może pukać do community-cron'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.invoke_community_cron(text)', 'EXECUTE'),
  'anon nie może pukać do community-cron'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.job_runner_autoarm()', 'EXECUTE'),
  'authenticated nie może zbroić runnera (przekierowanie ticku)'
);
SELECT ok(
  has_function_privilege('service_role', 'public.invoke_community_cron(text)', 'EXECUTE'),
  'service_role puka do community-cron'
);

-- -- 2. Samozbrojenie: raz i tylko dziewiczy wiersz ----------------------------
SELECT ok(
  public.job_runner_autoarm(),
  'dziewiczy wiersz zbroi się z domeny tenanta domyślnego'
);

SELECT row_eq(
  $$ SELECT enabled, base_url, auto_armed_at IS NOT NULL
       FROM public.job_runner_settings WHERE id = 1 $$,
  ROW(true, 'https://autoarm-sched.test'::text, true),
  'zbrojenie włącza runner, składa adres https i stempluje decyzję'
);

SELECT ok(
  NOT public.job_runner_autoarm(),
  'drugie wywołanie jest no-opem (stempel auto_armed_at)'
);

-- -- 3. Fail-open bez pg_net + telemetria WŁASNA, nie jobs-tick ----------------
SELECT lives_ok(
  $$ SELECT public.invoke_community_cron() $$,
  'invoke_community_cron nie wywala się bez pg_net (cron przeżywa)'
);

SELECT row_eq(
  $$ SELECT community_last_tick_status, community_last_tick_error
       FROM public.job_runner_settings WHERE id = 1 $$,
  ROW('skipped'::text, 'pg_net_unavailable'::text),
  'brak pg_net jest raportowany jako POWÓD pominięcia, nie jako cisza'
);

SELECT row_eq(
  $$ SELECT community_tick_count, last_tick_status IS NULL, tick_count
       FROM public.job_runner_settings WHERE id = 1 $$,
  ROW(0::bigint, true, 0::bigint),
  'pominięcie nie bije licznika i NIE dotyka telemetrii jobs-tick'
);

-- -- 4. Decyzja operatora + job spoza kontraktu --------------------------------
UPDATE public.job_runner_settings SET enabled = false WHERE id = 1;

SELECT lives_ok(
  $$ SELECT public.invoke_community_cron('nie-ma-takiego-joba') $$,
  'job spoza kontraktu nie wysadza puknięcia (spada do all)'
);

SELECT row_eq(
  $$ SELECT enabled, community_last_tick_error
       FROM public.job_runner_settings WHERE id = 1 $$,
  ROW(false, 'disabled'::text),
  'wyłączenie po uzbrojeniu jest respektowane i raportowane jako powód'
);

SELECT ok(
  NOT public.job_runner_autoarm(),
  'samozbrojenie nie wraca po świadomym wyłączeniu runnera'
);

-- -- 5. Brak sekretu ma własny powód -------------------------------------------
UPDATE public.job_runner_settings SET enabled = true, secret = '' WHERE id = 1;
SELECT public.invoke_community_cron();
SELECT row_eq(
  $$ SELECT community_last_tick_status, community_last_tick_error
       FROM public.job_runner_settings WHERE id = 1 $$,
  ROW('skipped'::text, 'no_secret'::text),
  'pusty sekret jest raportowany wprost'
);

-- -- 6. Wpis harmonogramu: co 5 minut z przeplotem względem jobs-tick ----------
SELECT row_eq(
  $$ SELECT schedule, command, active FROM cron.job WHERE jobname = 'community-cron' $$,
  ROW('2-59/5 * * * *'::text, 'SELECT public.invoke_community_cron()'::text, true),
  'community-cron zaplanowany co 5 minut w minutach 2,7,... (przeplot z oknem digestów jobs-tick)'
);

SELECT * FROM finish();
ROLLBACK;
