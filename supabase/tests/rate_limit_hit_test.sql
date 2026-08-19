-- pgTAP: atomowy licznik ochrony brute force.
-- Warstwa TypeScript wybiera zakres i skraca identyfikatory. Funkcja bazy jest
-- źródłem prawdy dla progu N, izolacji kubełków i rozpoczęcia nowego okna.

BEGIN;
SELECT plan(9);

DELETE FROM public.rate_limits
 WHERE scope LIKE 'test_auth_%';

SELECT is(
  (SELECT allowed FROM public.rate_limit_hit('test_auth_ip', 'ip:aaaaaaaa', 2, 5)),
  true,
  'pierwsza próba w oknie przechodzi'
);

SELECT is(
  (SELECT hits FROM public.rate_limit_hit('test_auth_ip', 'ip:aaaaaaaa', 2, 5)),
  2,
  'druga próba zwiększa ten sam licznik do dwóch'
);

SELECT is(
  (SELECT allowed FROM public.rate_limit_hit('test_auth_ip', 'ip:aaaaaaaa', 2, 5)),
  false,
  'próba ponad limit zostaje odrzucona'
);

SELECT is(
  (SELECT count FROM public.rate_limits
    WHERE scope = 'test_auth_ip' AND subject_id = 'ip:aaaaaaaa'),
  3,
  'odrzucona próba pozostaje policzona'
);

SELECT is(
  (SELECT allowed FROM public.rate_limit_hit('test_auth_ip', 'ip:bbbbbbbb', 2, 5)),
  true,
  'inny adres IP ma niezależny kubełek'
);

SELECT is(
  (SELECT count FROM public.rate_limits
    WHERE scope = 'test_auth_ip' AND subject_id = 'ip:aaaaaaaa'),
  3,
  'próba z innego IP nie zmienia pierwszego kubełka'
);

SELECT is(
  (SELECT allowed FROM public.rate_limit_hit('test_auth_login_email', 'email:one', 1, 15)),
  true,
  'pierwszy login ma własny kubełek e-mail'
);

SELECT is(
  (SELECT allowed FROM public.rate_limit_hit('test_auth_login_email', 'email:two', 1, 15)),
  true,
  'drugi login nie dzieli kubełka e-mail pierwszego loginu'
);

DO $$
BEGIN
  PERFORM public.rate_limit_hit('test_auth_window', 'ip:cccccccc', 1, 5);
END
$$;
UPDATE public.rate_limits
   SET window_start = window_start - interval '5 minutes'
 WHERE scope = 'test_auth_window' AND subject_id = 'ip:cccccccc';

SELECT is(
  (SELECT hits FROM public.rate_limit_hit('test_auth_window', 'ip:cccccccc', 1, 5)),
  1,
  'po rozpoczęciu nowego okna licznik wraca do jednego'
);

SELECT * FROM finish();
ROLLBACK;
