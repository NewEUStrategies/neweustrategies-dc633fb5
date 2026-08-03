-- pgTAP: izolacja tenanta w politykach WŁAŚCICIELA na author_profiles
-- (migracja 20260803140000).
--
-- Klasa błędu: polityki właściciela dopisywane są parami INSERT/UPDATE, a
-- SELECT i DELETE zostają przy gołym `auth.uid() = user_id` z migracji
-- założycielskiej. Na author_profiles dało to wiersz ZAPISYWALNY wyłącznie
-- w tenancie domowym, ale w pełni CZYTELNY i KASOWALNY z dowolnego kontekstu
-- tenanta - po dryfie danych (wiersz w tenancie A, konto przepięte do B)
-- obszar roboczy firmy A wystawiał swój wiersz sesji firmy B.
--
-- Druga połowa naprawy jest w RPC: edytor profilu NIE czyta tabeli bazowej
-- (kolumny kontaktowe mają odebrany kolumnowy SELECT), tylko SECURITY DEFINER
-- get_own_author_profile(), które RLS OMIJA. Bez tenanta w ciele funkcji
-- poprawka polityki byłaby martwą literą - dlatego oba predykaty są tu
-- sprawdzane osobno.
--
-- Bliźniaczy plik dla tej samej klasy: user_bookmarks_tenant_isolation_test.sql.
-- Bramka statyczna klasy: scripts/check-sql-owner-tenant-scope.ts.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(17);

-- ── (1-4) Kształt polityk: wszystkie cztery ścieżki właściciela wiążą tenanta ─
SELECT ok(
  (SELECT qual FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'author_profiles'
      AND policyname = 'Owners can view own author profile') ~ 'current_tenant_id',
  'polityka SELECT właściciela wiąże wiersz z current_tenant_id()'
);

SELECT ok(
  (SELECT qual FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'author_profiles'
      AND policyname = 'Owners can delete own author profile') ~ 'current_tenant_id',
  'polityka DELETE właściciela wiąże wiersz z current_tenant_id()'
);

SELECT ok(
  (SELECT with_check FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'author_profiles'
      AND policyname = 'Owners can insert own author profile') ~ 'current_tenant_id',
  'polityka INSERT właściciela nadal wiąże wiersz z current_tenant_id()'
);

SELECT ok(
  (SELECT qual FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'author_profiles'
      AND policyname = 'Owners can update own author profile') ~ 'current_tenant_id'
  AND (SELECT with_check FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'author_profiles'
          AND policyname = 'Owners can update own author profile') ~ 'current_tenant_id',
  'polityka UPDATE właściciela wiąże tenanta w USING I WITH CHECK'
);

-- ── (5-7) RPC właściciela: RLS omija, więc tenant musi być w ciele ───────────
SELECT ok(
  pg_get_functiondef('public.get_own_author_profile()'::regprocedure) ~ 'current_tenant_id',
  'get_own_author_profile() filtruje po current_tenant_id() (inaczej polityka SELECT jest martwą literą)'
);

SELECT ok(
  (SELECT p.prosecdef FROM pg_proc p
    WHERE p.oid = 'public.get_own_author_profile()'::regprocedure),
  'get_own_author_profile() jest SECURITY DEFINER (omija kolumnowy REVOKE PII)'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.get_own_author_profile()', 'EXECUTE'),
  'anon NIE może wywołać get_own_author_profile()'
);

-- ── (8-9) Indeksy: duplikat na user_id usunięty, unikalny zachowany ──────────
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_class c
     WHERE c.relname = 'author_profiles_user_idx'
       AND c.relnamespace = 'public'::regnamespace
  ),
  'zdublowany indeks author_profiles_user_idx usunięty (UNIQUE na user_id go pokrywa)'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_index i
     WHERE i.indrelid = 'public.author_profiles'::regclass
       AND i.indisunique
       AND i.indnatts = 1
       AND i.indkey[0] = (
             SELECT attnum FROM pg_attribute
              WHERE attrelid = 'public.author_profiles'::regclass
                AND attname = 'user_id' AND NOT attisdropped)
  ),
  'unikalny indeks na user_id żyje (upsert `onConflict: user_id` z edytora profilu na nim stoi)'
);

-- ── Seed: dwa tenanty, właściciel zgodny z tenantem i konto po dryfie ────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('ac111111-1111-1111-1111-111111111111', 'ap-a', 'Author Tenant A', 'a.ap.example'),
  ('ac222222-2222-2222-2222-222222222222', 'ap-b', 'Author Tenant B', 'b.ap.example');

INSERT INTO auth.users (id, email) VALUES
  ('ac000000-0000-0000-0000-0000000000a1', 'owner-a@ap.test'),
  ('ac000000-0000-0000-0000-0000000000b1', 'drifter@ap.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('ac000000-0000-0000-0000-0000000000a1', 'owner-a@ap.test', 'Owner A',
   'ac111111-1111-1111-1111-111111111111'),
  -- Konto przepięte do obszaru roboczego B (dryf: jego wiersz autora został w A).
  ('ac000000-0000-0000-0000-0000000000b1', 'drifter@ap.test', 'Drifter',
   'ac222222-2222-2222-2222-222222222222');

-- Oba wiersze NIEpubliczne, żeby polityki „public/authenticated can view public"
-- nie mogły przypadkiem przykryć wyniku - testujemy WYŁĄCZNIE ścieżkę właściciela.
INSERT INTO public.author_profiles (user_id, tenant_id, job_title, phone, is_public) VALUES
  ('ac000000-0000-0000-0000-0000000000a1', 'ac111111-1111-1111-1111-111111111111',
   'Analyst A', '+48 111 111 111', false),
  ('ac000000-0000-0000-0000-0000000000b1', 'ac111111-1111-1111-1111-111111111111',
   'Analyst Drift', '+48 222 222 222', false);

-- ── (10-11) Właściciel zgodny z tenantem: pełny dostęp bez zmian ─────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"ac000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT is(
  (SELECT count(user_id)::int FROM public.author_profiles
    WHERE user_id = 'ac000000-0000-0000-0000-0000000000a1'),
  1,
  'legit: właściciel widzi swój wiersz w tenancie domowym'
);

SELECT is(
  (SELECT phone FROM public.get_own_author_profile()),
  '+48 111 111 111',
  'legit: właściciel czyta pełny wiersz (z PII) przez get_own_author_profile()'
);

-- ── (12-14) Konto po dryfie: wiersz obcego obszaru roboczego jest niewidoczny ─
SELECT set_config('request.jwt.claims',
  '{"sub":"ac000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);

SELECT is(
  (SELECT count(user_id)::int FROM public.author_profiles
    WHERE user_id = 'ac000000-0000-0000-0000-0000000000b1'),
  0,
  'izolacja: wiersz user_id=drifter z tenant_id=A jest niewidoczny w sesji tenanta B (przed naprawą: 1)'
);

SELECT is(
  (SELECT count(*)::int FROM public.get_own_author_profile()),
  0,
  'izolacja: get_own_author_profile() nie wydaje wiersza spoza tenanta domowego (RPC omija RLS)'
);

DELETE FROM public.author_profiles
 WHERE user_id = 'ac000000-0000-0000-0000-0000000000b1';

RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.author_profiles
    WHERE user_id = 'ac000000-0000-0000-0000-0000000000b1'),
  1,
  'izolacja: DELETE z sesji tenanta B nie ruszył wiersza tenanta A (polityka DELETE odfiltrowała go)'
);

-- ── (15-16) Ścieżka zapisu edytora (upsert) nadal działa ────────────────────
-- `INSERT … ON CONFLICT DO UPDATE` sprawdza NIE tylko politykę UPDATE, ale też
-- politykę SELECT (istniejący i nowy wiersz), więc zaostrzenie SELECT-a mogło
-- rozwalić zapis profilu. Ta para asercji tego pilnuje.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"ac000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT lives_ok(
  $$INSERT INTO public.author_profiles (user_id, tenant_id, job_title, is_public)
      VALUES ('ac000000-0000-0000-0000-0000000000a1',
              'ac111111-1111-1111-1111-111111111111', 'Senior Analyst A', false)
    ON CONFLICT (user_id) DO UPDATE SET job_title = EXCLUDED.job_title$$,
  'legit: upsert własnego profilu (ścieżka AuthorProfileEditor) przechodzi po zaostrzeniu SELECT-a'
);

SELECT is(
  (SELECT job_title FROM public.author_profiles
    WHERE user_id = 'ac000000-0000-0000-0000-0000000000a1'),
  'Senior Analyst A',
  'legit: upsert faktycznie zaktualizował wiersz właściciela'
);

-- ── (17) Kontrola dodatnia: właściciel nadal kasuje swój wiersz ──────────────
DELETE FROM public.author_profiles
 WHERE user_id = 'ac000000-0000-0000-0000-0000000000a1';

RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.author_profiles
    WHERE user_id = 'ac000000-0000-0000-0000-0000000000a1'),
  0,
  'legit: właściciel kasuje własny wiersz w tenancie domowym (polityka nie jest za ciasna)'
);

SELECT * FROM finish();
ROLLBACK;
