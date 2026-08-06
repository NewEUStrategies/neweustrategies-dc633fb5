-- pgTAP: kto naprawde moze zmienic verified_at / verified_by w public.profiles.
--
-- Weryfikacja profilu nie jest kosmetyka: steruje odznaka `verified`, a odznaka
-- eksperta pociaga dozywotni dostep VIP (sync_expert_vip_grant). Dlatego kolumny
-- weryfikacji maja DWIE warstwy obrony na public.profiles (triggery BEFORE UPDATE
-- odpalaja sie alfabetycznie, wiec w tej kolejnosci):
--
--   1. profiles_guard_privileged_columns_trg - dla NIE-staffu CICHO przywraca
--      stare wartosci (zwykly czlonek nie dostaje bledu, jego wartosci po prostu
--      nie maja skutku),
--   2. profiles_guard_verification_trg - dla staffu BEZ prawa do weryfikacji
--      (czyli `editor`, ktory przechodzi warstwe 1.) zmiana MUSI polec glosno,
--      kodem 42501.
--
-- Poprzednia wersja tego pliku sprawdzala tylko istnienie funkcji, triggera i
-- flagi SECURITY DEFINER, wiec przezyla dwie zmiany semantyki bez jednego
-- czerwonego przebiegu - w tym zawezenie kregu uprawnionych do samego `admin`
-- (migracja 20260806094104), ktore odcielo `super_admin` od nadawania
-- weryfikacji. Ten test sprawdza ZACHOWANIE dla kazdej roli osobno.

BEGIN;
SELECT plan(18);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('c1111111-1111-1111-1111-111111111111', 'verify-guard', 'Verify Guard');

INSERT INTO auth.users (id, email) VALUES
  ('c1000000-0000-0000-0000-0000000000aa', 'admin@verify-guard.test'),
  ('c1000000-0000-0000-0000-0000000000bb', 'super@verify-guard.test'),
  ('c1000000-0000-0000-0000-0000000000cc', 'editor@verify-guard.test'),
  ('c1000000-0000-0000-0000-0000000000dd', 'member@verify-guard.test'),
  ('c1000000-0000-0000-0000-0000000000ee', 'target@verify-guard.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('c1000000-0000-0000-0000-0000000000aa', 'admin@verify-guard.test', 'Admin',
   'c1111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-0000000000bb', 'super@verify-guard.test', 'Super',
   'c1111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-0000000000cc', 'editor@verify-guard.test', 'Editor',
   'c1111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-0000000000dd', 'member@verify-guard.test', 'Member',
   'c1111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-0000000000ee', 'target@verify-guard.test', 'Target',
   'c1111111-1111-1111-1111-111111111111');

-- Super admin CELOWO nie ma osobnej roli `admin` - dokladnie ten przypadek
-- przestal dzialac po zawezeniu bramki.
INSERT INTO public.user_roles (tenant_id, user_id, role) VALUES
  ('c1111111-1111-1111-1111-111111111111',
   'c1000000-0000-0000-0000-0000000000aa', 'admin'),
  ('c1111111-1111-1111-1111-111111111111',
   'c1000000-0000-0000-0000-0000000000bb', 'super_admin'),
  ('c1111111-1111-1111-1111-111111111111',
   'c1000000-0000-0000-0000-0000000000cc', 'editor');

-- ---------------------------------------------------------------------------
-- 1) Struktura: funkcja, trigger, SECURITY DEFINER, kod bledu
-- ---------------------------------------------------------------------------
SELECT has_function('public', 'profiles_guard_verification', 'guard function exists');

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.profiles'::regclass
       AND tgname = 'profiles_guard_verification_trg'
       AND NOT tgisinternal
  ),
  'BEFORE UPDATE trigger on public.profiles is installed'
);

SELECT ok(
  (SELECT prosecdef FROM pg_proc
    WHERE oid = 'public.profiles_guard_verification()'::regprocedure),
  'guard runs as SECURITY DEFINER (role check cannot be bypassed by RLS)'
);

-- 42501 (insufficient_privilege), a nie generyczne P0001: klient rozpoznaje
-- odmowe uprawnien po kodzie, nie po tresci komunikatu. Reszta modulu
-- (admin_grant_profile_badge, admin_assert_verification_admin) rzuca tak samo.
SELECT ok(
  (SELECT prosrc FROM pg_proc
    WHERE oid = 'public.profiles_guard_verification()'::regprocedure) LIKE '%42501%',
  'guard raises 42501 (insufficient_privilege), not a generic P0001'
);

-- ---------------------------------------------------------------------------
-- 2) Zwykly czlonek: samonadanie nie ma skutku (warstwa 1. cicho cofa wartosci)
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-0000-0000-0000000000dd","role":"authenticated"}',
  true
);

SELECT lives_ok(
  $$ UPDATE public.profiles
        SET verified_at = now(), verified_by = 'c1000000-0000-0000-0000-0000000000dd'
      WHERE id = 'c1000000-0000-0000-0000-0000000000dd' $$,
  'zwykly czlonek nie dostaje bledu - jego wartosci sa cicho cofane'
);

RESET ROLE;
SELECT is(
  (SELECT verified_at FROM public.profiles
    WHERE id = 'c1000000-0000-0000-0000-0000000000dd'),
  NULL::timestamptz,
  'samonadanie weryfikacji NIE zostaje zapisane'
);
SELECT is(
  (SELECT verified_by FROM public.profiles
    WHERE id = 'c1000000-0000-0000-0000-0000000000dd'),
  NULL::uuid,
  'samonadanie nie zapisuje takze verified_by'
);

-- ---------------------------------------------------------------------------
-- 3) Editor: staff, wiec warstwa 1. go przepuszcza -> bramka MUSI rzucic 42501
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-0000-0000-0000000000cc","role":"authenticated"}',
  true
);

SELECT throws_ok(
  $$ UPDATE public.profiles
        SET verified_at = now(), verified_by = 'c1000000-0000-0000-0000-0000000000cc'
      WHERE id = 'c1000000-0000-0000-0000-0000000000cc' $$,
  '42501', NULL,
  'editor nie nada sobie weryfikacji - bramka odrzuca zmiane glosno'
);

RESET ROLE;
SELECT is(
  (SELECT verified_at FROM public.profiles
    WHERE id = 'c1000000-0000-0000-0000-0000000000cc'),
  NULL::timestamptz,
  'proba editora nie zostawia sladu w danych'
);

-- ---------------------------------------------------------------------------
-- 4) Admin: nadaje weryfikacje w swoim tenancie
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-0000-0000-0000000000aa","role":"authenticated"}',
  true
);

SELECT lives_ok(
  $$ UPDATE public.profiles
        SET verified_at = now(), verified_by = 'c1000000-0000-0000-0000-0000000000aa'
      WHERE id = 'c1000000-0000-0000-0000-0000000000ee' $$,
  'admin nadaje weryfikacje'
);

RESET ROLE;
SELECT ok(
  (SELECT verified_at IS NOT NULL FROM public.profiles
    WHERE id = 'c1000000-0000-0000-0000-0000000000ee'),
  'nadanie admina zostaje zapisane'
);
SELECT is(
  (SELECT verified_by FROM public.profiles
    WHERE id = 'c1000000-0000-0000-0000-0000000000ee'),
  'c1000000-0000-0000-0000-0000000000aa'::uuid,
  'slad audytowy wskazuje aktora nadania'
);

-- ---------------------------------------------------------------------------
-- 5) Super admin BEZ osobnej roli admin: cofa weryfikacje.
--    REGRESJA 20260806094104 - bramka zawezona do `admin` odbijala go kodem
--    P0001, mimo ze wszystkie bramki-rodzenstwo modulu go przepuszczaja.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-0000-0000-0000000000bb","role":"authenticated"}',
  true
);

SELECT lives_ok(
  $$ UPDATE public.profiles
        SET verified_at = NULL, verified_by = NULL
      WHERE id = 'c1000000-0000-0000-0000-0000000000ee' $$,
  'super_admin bez roli admin cofa weryfikacje (bramka go przepuszcza)'
);

RESET ROLE;
SELECT is(
  (SELECT verified_at FROM public.profiles
    WHERE id = 'c1000000-0000-0000-0000-0000000000ee'),
  NULL::timestamptz,
  'cofniecie przez super_admina zostaje zapisane'
);

-- ---------------------------------------------------------------------------
-- 6) Sciezka synchronizacji domenowej: flaga app.verification_sync przepuszcza
--    zapis bez roli (sync_org_verification ustawia ja transakcyjnie).
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-0000-0000-0000000000dd","role":"authenticated"}',
  true
);
SELECT set_config('app.verification_sync', 'on', true);

SELECT lives_ok(
  $$ UPDATE public.profiles
        SET verified_at = now()
      WHERE id = 'c1000000-0000-0000-0000-0000000000dd' $$,
  'synchronizacja domenowa (app.verification_sync=on) nie odbija sie od bramki'
);

SELECT set_config('app.verification_sync', 'off', true);
RESET ROLE;

SELECT ok(
  (SELECT verified_at IS NOT NULL FROM public.profiles
    WHERE id = 'c1000000-0000-0000-0000-0000000000dd'),
  'zapis synchronizacji domenowej faktycznie ladnie przechodzi do danych'
);

-- ---------------------------------------------------------------------------
-- 7) Reczna sciezka RPC ma ten sam krag uprawnionych, co bramka triggera.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-0000-0000-0000000000bb","role":"authenticated"}',
  true
);

SELECT lives_ok(
  $$ SELECT public.admin_set_profile_verification(
       'c1000000-0000-0000-0000-0000000000ee', true
     ) $$,
  'admin_set_profile_verification dziala dla super_admina (parytet z bramka)'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-0000-0000-0000000000cc","role":"authenticated"}',
  true
);
SELECT throws_ok(
  $$ SELECT public.admin_set_profile_verification(
       'c1000000-0000-0000-0000-0000000000ee', false
     ) $$,
  '42501', NULL,
  'admin_set_profile_verification odrzuca editora kodem 42501'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
