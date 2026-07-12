-- pgTAP: job runner (20260713170000) - bezpieczenstwo konfiguracji.
--
--   1. job_runner_settings ma dokladnie jeden wiersz konfiguracji (id=1)
--      z wygenerowanym sekretem.
--   2. anon/authenticated NIE moga czytac tabeli (RLS bez polityk + brak
--      grantow) - sekret nie wycieka do klienta.
--   3. invoke_jobs_tick() nie jest wykonywalne przez anon/authenticated.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(6);

SELECT is(
  (SELECT count(*)::int FROM public.job_runner_settings),
  1,
  'job_runner_settings ma dokladnie jeden wiersz (seed id=1)'
);

SELECT ok(
  (SELECT length(secret) >= 32 FROM public.job_runner_settings WHERE id = 1),
  'sekret jest wygenerowany (>= 32 znaki hex)'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.job_runner_settings', 'SELECT'),
  'anon nie ma SELECT na job_runner_settings'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.job_runner_settings', 'SELECT'),
  'authenticated nie ma SELECT na job_runner_settings'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.invoke_jobs_tick()', 'EXECUTE'),
  'anon nie moze wywolac invoke_jobs_tick'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.invoke_jobs_tick()', 'EXECUTE'),
  'authenticated nie moze wywolac invoke_jobs_tick'
);

SELECT * FROM finish();
ROLLBACK;
