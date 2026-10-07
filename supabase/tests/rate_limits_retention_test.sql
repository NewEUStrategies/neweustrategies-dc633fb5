-- pgTAP: retencja `rate_limits` (migracja 20261007140800_rate_limits_retention).
--
-- CO PRZYPINA: funkcja kasuje wylacznie wiersze starsze niz 2 doby (biezace
-- okna i okno dobowe sprzed doby zostaja, wiec zadna decyzja limitu sie nie
-- zmienia), respektuje partie i jest tylko dla service_role.
BEGIN;
SELECT plan(7);

DELETE FROM public.rate_limits WHERE scope LIKE 'rlret.%';
INSERT INTO public.rate_limits (scope, subject_id, window_start, count) VALUES
  ('rlret.old', 'a', now() - interval '3 days', 5),
  ('rlret.old', 'b', now() - interval '10 days', 5),
  ('rlret.old', 'c', now() - interval '49 hours', 5),
  ('rlret.keep', 'day', now() - interval '25 hours', 5),
  ('rlret.keep', 'now', now(), 5);

SELECT ok(NOT has_function_privilege('anon', 'public.rate_limits_prune(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.rate_limits_prune(integer)', 'EXECUTE'),
  'rate_limits_prune: bez EXECUTE dla klienta');
SELECT ok(has_function_privilege('service_role', 'public.rate_limits_prune(integer)', 'EXECUTE'),
  'rate_limits_prune: service_role (pg_cron / na zadanie)');

SET LOCAL ROLE service_role;
SELECT cmp_ok(public.rate_limits_prune(1), '=', 1, 'partia 1 kasuje dokladnie jeden wiersz');
SELECT cmp_ok(public.rate_limits_prune(50000), '>=', 2, 'kolejny przebieg kasuje reszte starych');
RESET ROLE;

SELECT is((SELECT count(*)::int FROM public.rate_limits WHERE scope = 'rlret.old'), 0,
  'wiersze starsze niz 2 doby usuniete');
SELECT is((SELECT count(*)::int FROM public.rate_limits WHERE scope = 'rlret.keep'), 2,
  'okno biezace i okno dobowe sprzed doby zostaja (decyzje limitow bez zmian)');
SET LOCAL ROLE service_role;
SELECT is((SELECT count(*)::int FROM public.rate_limits WHERE scope LIKE 'rlret.%' AND window_start < now() - interval '2 days'), 0,
  'po przebiegu nie zostaje nic do skasowania w zakresie testu');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
