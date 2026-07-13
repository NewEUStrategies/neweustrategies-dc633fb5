-- pgTAP: weryfikacja zawodowa + filtr roli w katalogu osób (20260713160000).
--
-- Weryfikowane wlasnosci:
--   1. search_people zwraca flage verified oraz honoruje p_verified_only.
--   2. p_job_title filtruje po roli (case-insensitive), a people_filter_options
--      zwraca fasete job_title.
--   3. Zwykly uzytkownik NIE moze nadac sobie weryfikacji (trigger guard).
--   4. admin_set_profile_verification: odmowa dla nie-admina, dziala dla
--      admina tenanta i stempluje verified_by.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(8);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('a8111111-1111-1111-1111-111111111111', 'tenant-pv', 'Tenant PV');

INSERT INTO auth.users (id, email) VALUES
  ('a8000000-0000-0000-0000-0000000000aa', 'admin-pv@pv.test'),
  ('a8000000-0000-0000-0000-0000000000bb', 'member-pv@pv.test'),
  ('a8000000-0000-0000-0000-0000000000cc', 'peer-pv@pv.test');

INSERT INTO public.profiles
  (id, email, display_name, tenant_id, discoverable, job_title, current_company)
VALUES
  ('a8000000-0000-0000-0000-0000000000aa', 'admin-pv@pv.test', 'Admin PV',
   'a8111111-1111-1111-1111-111111111111', true, 'Director', 'EU Institute'),
  ('a8000000-0000-0000-0000-0000000000bb', 'member-pv@pv.test', 'Member PV',
   'a8111111-1111-1111-1111-111111111111', true, 'Policy Analyst', 'EU Institute'),
  ('a8000000-0000-0000-0000-0000000000cc', 'peer-pv@pv.test', 'Peer PV',
   'a8111111-1111-1111-1111-111111111111', true, 'Economist', 'Trade Lab');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('a8000000-0000-0000-0000-0000000000aa', 'admin',
   'a8111111-1111-1111-1111-111111111111');

-- -- 1-2. Zwykly czlonek: filtr roli + faseta job_title ------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a8000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);

SELECT is(
  (SELECT sp.display_name
     FROM public.search_people(p_query => '', p_job_title => 'economist', p_limit => 50) sp),
  'Peer PV',
  'p_job_title filtruje po roli case-insensitive'
);

SELECT is(
  (SELECT count(*)::int FROM public.people_filter_options() o
    WHERE o.field = 'job_title'),
  2,
  'people_filter_options zwraca fasete job_title (role innych czlonkow, bez self)'
);

-- -- 3. Samodzielna "weryfikacja" jest blokowana przez trigger guard -----------
SELECT throws_like(
  $$ UPDATE public.profiles SET verified_at = now()
      WHERE id = 'a8000000-0000-0000-0000-0000000000bb' $$,
  '%verification can only be changed by an admin%',
  'zwykly uzytkownik nie moze nadac sobie odznaki'
);

-- -- 4. RPC odmawia nie-adminowi ------------------------------------------------
SELECT throws_like(
  $$ SELECT public.admin_set_profile_verification(
       'a8000000-0000-0000-0000-0000000000cc', true) $$,
  '%admin role required%',
  'admin_set_profile_verification odmawia nie-adminowi'
);

-- -- 5-7. Admin nadaje weryfikacje; search_people ja raportuje i filtruje ------
SELECT set_config('request.jwt.claims',
  '{"sub":"a8000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

SELECT lives_ok(
  $$ SELECT public.admin_set_profile_verification(
       'a8000000-0000-0000-0000-0000000000bb', true) $$,
  'admin tenanta nadaje weryfikacje'
);

SELECT is(
  (SELECT sp.verified
     FROM public.search_people(p_query => 'Member', p_limit => 50) sp LIMIT 1),
  true,
  'search_people zwraca flage verified'
);

SELECT is(
  (SELECT count(*)::int
     FROM public.search_people(p_query => '', p_verified_only => true, p_limit => 50)),
  1,
  'p_verified_only zawezaja wyniki do zweryfikowanych'
);

-- -- 8. verified_by stempluje admina --------------------------------------------
RESET ROLE;
SELECT is(
  (SELECT verified_by FROM public.profiles
    WHERE id = 'a8000000-0000-0000-0000-0000000000bb'),
  'a8000000-0000-0000-0000-0000000000aa'::uuid,
  'verified_by wskazuje admina nadajacego odznake'
);

SELECT * FROM finish();
ROLLBACK;
