-- pgTAP: `profiles.discoverable_decided_at` zapisuje DECYZJĘ WŁAŚCICIELA profilu
-- o widoczności w katalogu osób - i wyłącznie ją.
--
-- Weryfikuje migrację 20261025090020_profiles_discoverable_decision_stamp.sql.
--
-- PO CO TO STOI. `discoverable` jest zgodą wyrażoną wprost, a RODO art. 7
-- ust. 1 wymaga umieć ją WYKAZAĆ. Do tej migracji true z przełącznika
-- właściciela, z DEFAULT-u i z hurtowego UPDATE (wpis dziennika 0001) wyglądało
-- identycznie, więc skutków 0001 nie dało się w pełni odróżnić od decyzji.
--
-- CO PRZYPINA
--   1-10.  kształt: kolumna timestamptz bez DEFAULT-u i NOT NULL; wyzwalacz
--          BEFORE INSERT OR UPDATE OF discoverable; funkcja wyzwalacza
--          SECURITY INVOKER z przypiętym search_path, bez EXECUTE dla klienta;
--          klient (authenticated, anon) bez grantu na kolumnę; kolumny nie ma
--          w widoku `profiles_public`;
--   11-12. blokada znacznika: wyzwalacz BEFORE UPDATE z warunkiem zmiany
--          znacznika, nazwany tak, że odpala PRZED stemplem; jego funkcja
--          SECURITY INVOKER z przypiętym search_path, bez EXECUTE dla klienta;
--   13-18. zachowanie: INSERT zeruje znacznik podany wprost; potwierdzenie
--          właściciela BEZ zmiany wartości stempluje; zmiana wartości przez
--          właściciela stempluje; edycja innej kolumny nie stempluje;
--          administrator najemcy i service_role zmieniają wartość bez stempla;
--   19-21. jedynym piszącym jest stempel - niezależnie od grantów: service_role
--          nie zapisze znacznika (sam ani razem z `discoverable`), a UPDATE bez
--          sesji (migracja) go nie wymaże;
--   22-23. klient nie zapisze ani nie odczyta znacznika (42501).
--
-- `now()` jest stałe w transakcji testu, więc stempel porównujemy z nim wprost.
-- Fikstura zeruje znacznik między przypadkami przy wyłączonej blokadzie
-- (`profiles_discoverable_decided_at_pin_trg`) - tylko na czas tego UPDATE.
-- WYZWALACZE UŻYTKOWNIKA NA auth.users WYŁĄCZONE - konwencja suity.
BEGIN;
SELECT plan(23);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── 1-10. Kształt, bezpieczeństwo, granty ───────────────────────────────────
SELECT has_column(
  'public', 'profiles', 'discoverable_decided_at',
  'profiles.discoverable_decided_at istnieje'
);

SELECT is(
  (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
    WHERE a.attrelid = 'public.profiles'::regclass AND a.attname = 'discoverable_decided_at'),
  'timestamp with time zone',
  'discoverable_decided_at jest timestamptz'
);

SELECT ok(
  (SELECT NOT a.attnotnull AND NOT a.atthasdef FROM pg_attribute a
    WHERE a.attrelid = 'public.profiles'::regclass AND a.attname = 'discoverable_decided_at'),
  'discoverable_decided_at: NULL dozwolone, bez DEFAULT-u (NULL = brak decyzji właściciela)'
);

SELECT ok(
  (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t
    WHERE t.tgrelid = 'public.profiles'::regclass
      AND t.tgname = 'profiles_discoverable_decision_stamp_trg')
    ~ '^CREATE TRIGGER profiles_discoverable_decision_stamp_trg BEFORE INSERT OR UPDATE OF discoverable ON public\.profiles FOR EACH ROW EXECUTE FUNCTION (public\.)?profiles_discoverable_decision_stamp\(\)$',
  'wyzwalacz: BEFORE INSERT OR UPDATE OF discoverable, FOR EACH ROW'
);

SELECT ok(
  NOT (SELECT p.prosecdef FROM pg_proc p
        WHERE p.oid = 'public.profiles_discoverable_decision_stamp()'::regprocedure),
  'funkcja wyzwalacza jest SECURITY INVOKER (zmienia tylko NEW)'
);

SELECT is(
  (SELECT p.proconfig FROM pg_proc p
    WHERE p.oid = 'public.profiles_discoverable_decision_stamp()'::regprocedure),
  ARRAY['search_path=public, pg_temp'],
  'funkcja wyzwalacza ma przypięty search_path = public, pg_temp'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.profiles_discoverable_decision_stamp()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.profiles_discoverable_decision_stamp()', 'EXECUTE')
  AND NOT EXISTS (
    SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
     WHERE p.oid = 'public.profiles_discoverable_decision_stamp()'::regprocedure AND a.grantee = 0
  ),
  'funkcja wyzwalacza: PUBLIC, anon i authenticated bez EXECUTE'
);

SELECT ok(
  NOT has_column_privilege('authenticated', 'public.profiles', 'discoverable_decided_at', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'public.profiles', 'discoverable_decided_at', 'UPDATE'),
  'authenticated bez SELECT i UPDATE na discoverable_decided_at (granty kolumnowe profiles)'
);

SELECT ok(
  NOT has_column_privilege('anon', 'public.profiles', 'discoverable_decided_at', 'SELECT')
  AND NOT has_column_privilege('anon', 'public.profiles', 'discoverable_decided_at', 'UPDATE')
  AND NOT has_column_privilege('anon', 'public.profiles', 'discoverable_decided_at', 'INSERT'),
  'anon bez żadnego grantu na discoverable_decided_at'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'profiles_public'
       AND column_name = 'discoverable_decided_at'
  ),
  'widok profiles_public nie wystawia discoverable_decided_at'
);

-- ── 11-12. Blokada znacznika ────────────────────────────────────────────────
SELECT ok(
  (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t
    WHERE t.tgrelid = 'public.profiles'::regclass
      AND t.tgname = 'profiles_discoverable_decided_at_pin_trg')
    ~ '^CREATE TRIGGER profiles_discoverable_decided_at_pin_trg BEFORE UPDATE ON public\.profiles FOR EACH ROW WHEN \(\(new\.discoverable_decided_at IS DISTINCT FROM old\.discoverable_decided_at\)\) EXECUTE FUNCTION (public\.)?profiles_discoverable_decided_at_pin\(\)$'
  AND 'profiles_discoverable_decided_at_pin_trg' COLLATE "C"
      < 'profiles_discoverable_decision_stamp_trg' COLLATE "C",
  'blokada znacznika: BEFORE UPDATE przy zmianie znacznika, odpala przed stemplem (kolejność nazw)'
);

SELECT ok(
  NOT (SELECT p.prosecdef FROM pg_proc p
        WHERE p.oid = 'public.profiles_discoverable_decided_at_pin()'::regprocedure)
  AND (SELECT p.proconfig FROM pg_proc p
        WHERE p.oid = 'public.profiles_discoverable_decided_at_pin()'::regprocedure)
      = ARRAY['search_path=public, pg_temp']
  AND NOT has_function_privilege('anon', 'public.profiles_discoverable_decided_at_pin()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.profiles_discoverable_decided_at_pin()', 'EXECUTE')
  AND NOT EXISTS (
    SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
     WHERE p.oid = 'public.profiles_discoverable_decided_at_pin()'::regprocedure AND a.grantee = 0
  ),
  'funkcja blokady: SECURITY INVOKER, przypięty search_path, PUBLIC/anon/authenticated bez EXECUTE'
);

-- ── Seed: najemca, właściciel, członek, administrator najemcy ──────────────
INSERT INTO public.tenants (id, slug, name) VALUES
  ('e8d10000-0000-4000-8000-000000000000', 'stamp-tenant', 'Stamp Tenant');

INSERT INTO auth.users (id, email) VALUES
  ('e8d10000-0000-4000-8000-0000000000a1', 'wlasciciel@stamp.test'),
  ('e8d10000-0000-4000-8000-0000000000b1', 'czlonek@stamp.test'),
  ('e8d10000-0000-4000-8000-0000000000c1', 'admin@stamp.test');

-- Znacznik podany WPROST przy INSERT - wyzwalacz ma go wyzerować.
INSERT INTO public.profiles (id, tenant_id, email, display_name, discoverable, discoverable_decided_at) VALUES
  ('e8d10000-0000-4000-8000-0000000000a1', 'e8d10000-0000-4000-8000-000000000000',
   'wlasciciel@stamp.test', 'Właściciel', false, '2026-01-01 10:00+00'),
  ('e8d10000-0000-4000-8000-0000000000b1', 'e8d10000-0000-4000-8000-000000000000',
   'czlonek@stamp.test', 'Członek', false, NULL),
  ('e8d10000-0000-4000-8000-0000000000c1', 'e8d10000-0000-4000-8000-000000000000',
   'admin@stamp.test', 'Admin', false, NULL);

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('e8d10000-0000-4000-8000-0000000000c1', 'admin', 'e8d10000-0000-4000-8000-000000000000');

-- ── 13-18. Zachowanie ───────────────────────────────────────────────────────
SELECT is(
  (SELECT discoverable_decided_at FROM public.profiles
    WHERE id = 'e8d10000-0000-4000-8000-0000000000a1'),
  NULL::timestamptz,
  'INSERT zeruje znacznik podany wprost (rejestracja to nie decyzja)'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"e8d10000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
UPDATE public.profiles SET discoverable = false
 WHERE id = 'e8d10000-0000-4000-8000-0000000000a1';
RESET ROLE;

SELECT is(
  (SELECT discoverable_decided_at FROM public.profiles
    WHERE id = 'e8d10000-0000-4000-8000-0000000000a1'),
  now(),
  'potwierdzenie właściciela BEZ zmiany wartości stempluje decyzję'
);

ALTER TABLE public.profiles DISABLE TRIGGER profiles_discoverable_decided_at_pin_trg;
UPDATE public.profiles SET discoverable_decided_at = NULL
 WHERE id = 'e8d10000-0000-4000-8000-0000000000a1';
ALTER TABLE public.profiles ENABLE TRIGGER profiles_discoverable_decided_at_pin_trg;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"e8d10000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
UPDATE public.profiles SET discoverable = true
 WHERE id = 'e8d10000-0000-4000-8000-0000000000a1';
RESET ROLE;

SELECT ok(
  (SELECT discoverable AND discoverable_decided_at = now() FROM public.profiles
    WHERE id = 'e8d10000-0000-4000-8000-0000000000a1'),
  'zmiana wartości przez właściciela stempluje decyzję'
);

ALTER TABLE public.profiles DISABLE TRIGGER profiles_discoverable_decided_at_pin_trg;
UPDATE public.profiles SET discoverable_decided_at = NULL
 WHERE id = 'e8d10000-0000-4000-8000-0000000000a1';
ALTER TABLE public.profiles ENABLE TRIGGER profiles_discoverable_decided_at_pin_trg;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"e8d10000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
UPDATE public.profiles SET job_title = 'Analityczka'
 WHERE id = 'e8d10000-0000-4000-8000-0000000000a1';
RESET ROLE;

SELECT is(
  (SELECT discoverable_decided_at FROM public.profiles
    WHERE id = 'e8d10000-0000-4000-8000-0000000000a1'),
  NULL::timestamptz,
  'edycja innej kolumny przez właściciela nie stempluje'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"e8d10000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
UPDATE public.profiles SET discoverable = true
 WHERE id = 'e8d10000-0000-4000-8000-0000000000b1';
RESET ROLE;

SELECT ok(
  (SELECT discoverable AND discoverable_decided_at IS NULL FROM public.profiles
    WHERE id = 'e8d10000-0000-4000-8000-0000000000b1'),
  'administrator najemcy zmienia wartość członka, ale nie stempluje jego decyzji'
);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
UPDATE public.profiles SET discoverable = false
 WHERE id = 'e8d10000-0000-4000-8000-0000000000b1';
RESET ROLE;

SELECT ok(
  (SELECT NOT discoverable AND discoverable_decided_at IS NULL FROM public.profiles
    WHERE id = 'e8d10000-0000-4000-8000-0000000000b1'),
  'service_role (auth.uid() NULL) zmienia wartość bez stempla'
);

-- ── 19-21. Jedynym piszącym jest stempel, niezależnie od grantów ────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"e8d10000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
UPDATE public.profiles SET discoverable = true
 WHERE id = 'e8d10000-0000-4000-8000-0000000000a1';
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
UPDATE public.profiles SET discoverable_decided_at = '2026-01-01 10:00+00'
 WHERE id IN ('e8d10000-0000-4000-8000-0000000000a1', 'e8d10000-0000-4000-8000-0000000000b1');
RESET ROLE;

SELECT ok(
  (SELECT discoverable_decided_at = now() FROM public.profiles
    WHERE id = 'e8d10000-0000-4000-8000-0000000000a1')
  AND (SELECT discoverable_decided_at IS NULL FROM public.profiles
        WHERE id = 'e8d10000-0000-4000-8000-0000000000b1'),
  'service_role z grantem UPDATE: zapis samego znacznika to no-op (stempel właściciela i NULL członka zostają)'
);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
UPDATE public.profiles SET discoverable = true, discoverable_decided_at = '2026-01-01 10:00+00'
 WHERE id = 'e8d10000-0000-4000-8000-0000000000b1';
RESET ROLE;

SELECT ok(
  (SELECT discoverable AND discoverable_decided_at IS NULL FROM public.profiles
    WHERE id = 'e8d10000-0000-4000-8000-0000000000b1'),
  'service_role zmienia discoverable, ale znacznika podanego razem z nim nie zapisze (bez podrobionej decyzji)'
);

UPDATE public.profiles SET discoverable_decided_at = NULL
 WHERE id = 'e8d10000-0000-4000-8000-0000000000a1';

SELECT is(
  (SELECT discoverable_decided_at FROM public.profiles
    WHERE id = 'e8d10000-0000-4000-8000-0000000000a1'),
  now(),
  'UPDATE bez sesji (migracja, administrator bazy) nie wymaże stempla właściciela'
);

-- ── 22-23. Klient nie pisze ani nie czyta znacznika ─────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"e8d10000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

SELECT throws_ok(
  $$ UPDATE public.profiles SET discoverable_decided_at = now()
      WHERE id = 'e8d10000-0000-4000-8000-0000000000a1' $$,
  '42501', NULL,
  'właściciel nie zapisze znacznika wprost (brak grantu kolumnowego UPDATE)'
);

SELECT throws_ok(
  $$ SELECT discoverable_decided_at FROM public.profiles
      WHERE id = 'e8d10000-0000-4000-8000-0000000000a1' $$,
  '42501', NULL,
  'właściciel nie odczyta znacznika przez Data API (brak grantu kolumnowego SELECT)'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
