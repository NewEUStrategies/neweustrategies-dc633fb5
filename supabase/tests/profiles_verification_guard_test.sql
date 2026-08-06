-- pgTAP: bramka pól weryfikacji profilu - KTO może zmienić `verified_at` /
-- `verified_by`, jak wygląda odmowa i które ścieżki są sankcjonowane.
--
-- PO CO TEN PLIK (regres 20260806094104). Migracja weryfikacji po domenie
-- e-mail odbudowała `profiles_guard_verification()` na najstarszej definicji i
-- po cichu ZAWĘZIŁA krąg uprawnionych do samego `admin`: `super_admin` bez
-- osobno nadanej roli `admin` przestał móc nadawać weryfikację, choć polityka
-- RLS "Admins can update tenant profiles", `admin_grant_profile_badge()` i
-- `admin_assert_verification_admin()` przepuszczają go bez zastrzeżeń. Wersja
-- wcześniejsza (20260805122338) miała `super_admin` i `ERRCODE 42501`, ale
-- poprzedni wariant tego pliku sprawdzał WYŁĄCZNIE strukturę (istnienie
-- funkcji, trigger, SECURITY DEFINER), więc zawężenie przeszło na zielono.
-- Migracja 20260806130000 przywraca zbiór ról i ERRCODE; ten plik pilnuje
-- ZACHOWANIA, nie kształtu.
--
-- WARSTWY, KTÓRE TU WIDAĆ (celowo testowane razem, bo dopiero razem dają
-- obserwowalny kontrakt tabeli `profiles`):
--   * `profiles_guard_privileged_columns_trg` - odpala się PIERWSZY (kolejność
--     alfabetyczna nazw triggerów) i dla nie-stafu po cichu wycofuje pola
--     weryfikacji (`NEW.verified_at := OLD.verified_at`), więc dla zwykłego
--     użytkownika NIE MA wyjątku - jest brak efektu;
--   * `profiles_guard_verification_trg` - odmawia twardo (42501) temu, kto pola
--     realnie zmienia, a nie jest `admin`/`super_admin` (czyli m.in. `editor`,
--     który przechodzi bliźniaczy guard).
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(20);

-- ── 1-4. Struktura bramki ───────────────────────────────────────────────────
SELECT has_function('public', 'profiles_guard_verification', 'guard function exists');

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.profiles'::regclass
       AND tgname = 'profiles_guard_verification_trg'
       AND NOT tgisinternal
  ),
  'trigger profiles_guard_verification_trg jest zainstalowany'
);

-- tgtype: 1 = ROW, 2 = BEFORE, 4 = INSERT, 16 = UPDATE => 23.
-- INSERT jest w kontrakcie od 20260806130000: polityka "Users insert own
-- profile" pozwala wstawić WŁASNY wiersz, a oba guardy były BEFORE UPDATE,
-- więc self-insert z `verified_at` nie przechodził żadnej kontroli.
SELECT is(
  (SELECT tgtype::int FROM pg_trigger
    WHERE tgrelid = 'public.profiles'::regclass
      AND tgname = 'profiles_guard_verification_trg'),
  23,
  'bramka pilnuje BEFORE INSERT OR UPDATE FOR EACH ROW (nie tylko UPDATE)'
);

SELECT ok(
  (SELECT prosecdef FROM pg_proc
    WHERE oid = 'public.profiles_guard_verification()'::regprocedure),
  'guard runs as SECURITY DEFINER (role check cannot be bypassed by RLS)'
);

-- ── Seed ────────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('c9111111-1111-1111-1111-111111111111', 'tenant-vg', 'Tenant VG');

INSERT INTO auth.users (id, email) VALUES
  ('c9000000-0000-0000-0000-0000000000aa', 'admin-vg@vg.test'),
  ('c9000000-0000-0000-0000-0000000000bb', 'super-vg@vg.test'),
  ('c9000000-0000-0000-0000-0000000000cc', 'editor-vg@vg.test'),
  ('c9000000-0000-0000-0000-0000000000dd', 'member-vg@vg.test'),
  ('c9000000-0000-0000-0000-0000000000ee', 'target-vg@vg.test'),
  ('c9000000-0000-0000-0000-0000000000ff', 'claim-vg@vg.test');

-- `ff` celowo BEZ wiersza w profiles - to okno, w którym self-INSERT jest
-- możliwy (skasowany profil przy żywym koncie auth.users).
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('c9000000-0000-0000-0000-0000000000aa', 'admin-vg@vg.test', 'Admin VG',
   'c9111111-1111-1111-1111-111111111111'),
  ('c9000000-0000-0000-0000-0000000000bb', 'super-vg@vg.test', 'Super VG',
   'c9111111-1111-1111-1111-111111111111'),
  ('c9000000-0000-0000-0000-0000000000cc', 'editor-vg@vg.test', 'Editor VG',
   'c9111111-1111-1111-1111-111111111111'),
  ('c9000000-0000-0000-0000-0000000000dd', 'member-vg@vg.test', 'Member VG',
   'c9111111-1111-1111-1111-111111111111'),
  ('c9000000-0000-0000-0000-0000000000ee', 'target-vg@vg.test', 'Target VG',
   'c9111111-1111-1111-1111-111111111111');

-- `super_admin` BEZ osobnej roli `admin` - dokładnie konto, które regres
-- 20260806094104 pozbawił uprawnienia.
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('c9000000-0000-0000-0000-0000000000aa', 'admin',
   'c9111111-1111-1111-1111-111111111111'),
  ('c9000000-0000-0000-0000-0000000000bb', 'super_admin',
   'c9111111-1111-1111-1111-111111111111'),
  ('c9000000-0000-0000-0000-0000000000cc', 'editor',
   'c9111111-1111-1111-1111-111111111111');

-- ── 5-6. Zwykły użytkownik: brak wyjątku, brak efektu ───────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c9000000-0000-0000-0000-0000000000dd","role":"authenticated"}', true);

SELECT lives_ok(
  $$ UPDATE public.profiles SET verified_at = now()
      WHERE id = 'c9000000-0000-0000-0000-0000000000dd' $$,
  'nie-staff: UPDATE nie wybucha (bliźniaczy guard po cichu wycofuje pola)'
);

RESET ROLE;
SELECT is(
  (SELECT verified_at FROM public.profiles
    WHERE id = 'c9000000-0000-0000-0000-0000000000dd'),
  NULL::timestamptz,
  'zwykły użytkownik NIE nadaje sobie weryfikacji'
);

-- ── 7-8. Editor: przechodzi bliźniaczy guard, ale nie ten - twarde 42501 ────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c9000000-0000-0000-0000-0000000000cc","role":"authenticated"}', true);

SELECT throws_ok(
  $$ UPDATE public.profiles SET verified_at = now()
      WHERE id = 'c9000000-0000-0000-0000-0000000000cc' $$,
  '42501',
  'profiles: verification fields can only be changed by admin or super_admin',
  'editor dostaje 42501 z komunikatem bramki (parytet z admin_grant_profile_badge)'
);

RESET ROLE;
SELECT is(
  (SELECT verified_at FROM public.profiles
    WHERE id = 'c9000000-0000-0000-0000-0000000000cc'),
  NULL::timestamptz,
  'editor nie nadaje sobie weryfikacji'
);

-- ── 9-10. super_admin BEZ roli admin: REGRES 20260806094104 ─────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c9000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);

SELECT lives_ok(
  $$ UPDATE public.profiles
        SET verified_at = now(),
            verified_by = 'c9000000-0000-0000-0000-0000000000bb'
      WHERE id = 'c9000000-0000-0000-0000-0000000000bb' $$,
  'super_admin bez roli admin przechodzi bramkę weryfikacji'
);

RESET ROLE;
SELECT isnt(
  (SELECT verified_at FROM public.profiles
    WHERE id = 'c9000000-0000-0000-0000-0000000000bb'),
  NULL::timestamptz,
  'super_admin realnie zapisuje pola weryfikacji (regres 20260806094104)'
);

-- ── 11-12. Admin: zapis w cudzym wierszu tenanta + stempel audytu ───────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c9000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

SELECT lives_ok(
  $$ UPDATE public.profiles
        SET verified_at = now(),
            verified_by = 'c9000000-0000-0000-0000-0000000000aa'
      WHERE id = 'c9000000-0000-0000-0000-0000000000ee' $$,
  'admin nadaje weryfikację w wierszu członka swojego tenantu'
);

RESET ROLE;
SELECT is(
  (SELECT verified_by FROM public.profiles
    WHERE id = 'c9000000-0000-0000-0000-0000000000ee'),
  'c9000000-0000-0000-0000-0000000000aa'::uuid,
  'verified_by stempluje admina nadającego weryfikację'
);

-- ── 13. Sankcjonowana furtka synchronizacji domenowej ───────────────────────
-- `sync_org_verification()` ustawia tę flagę lokalnie na czas własnego UPDATE;
-- bez niej automat nie mógłby domknąć weryfikacji po potwierdzeniu e-maila
-- (sesją jest wtedy zwykły użytkownik, nie staff).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c9000000-0000-0000-0000-0000000000dd","role":"authenticated"}', true);
SELECT set_config('app.verification_sync', 'on', true);

SELECT lives_ok(
  $$ UPDATE public.profiles SET verified_at = now()
      WHERE id = 'c9000000-0000-0000-0000-0000000000dd' $$,
  'furtka app.verification_sync przepuszcza zapis automatu'
);

SELECT set_config('app.verification_sync', 'off', true);
RESET ROLE;

-- ── 14-15. Brak sesji (service_role / cron): bramka milczy, pola pinuje
--          bliźniak - dlatego automat MUSI iść przez furtkę wyżej ────────────
SELECT set_config('request.jwt.claims', '', true);

SELECT lives_ok(
  $$ UPDATE public.profiles SET verified_at = now()
      WHERE id = 'c9000000-0000-0000-0000-0000000000cc' $$,
  'ścieżka bez auth.uid() nie jest traktowana jak samonadanie (brak 42501)'
);

SELECT is(
  (SELECT verified_at FROM public.profiles
    WHERE id = 'c9000000-0000-0000-0000-0000000000cc'),
  NULL::timestamptz,
  'bez furtki zapis i tak nie wchodzi (pin bliźniaczego guardu) - kontrakt warstw'
);

-- ── 16-17. INSERT: wiersz nie rodzi się zweryfikowany ───────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c9000000-0000-0000-0000-0000000000ff","role":"authenticated"}', true);

SELECT throws_ok(
  $$ INSERT INTO public.profiles (id, email, display_name, tenant_id, verified_at)
     VALUES ('c9000000-0000-0000-0000-0000000000ff', 'claim-vg@vg.test', 'Claim VG',
             'c9111111-1111-1111-1111-111111111111', now()) $$,
  '42501',
  'profiles: verification fields can only be changed by admin or super_admin',
  'self-INSERT z verified_at jest odrzucany (luka zamknięta w 20260806130000)'
);

SELECT lives_ok(
  $$ INSERT INTO public.profiles (id, email, display_name, tenant_id)
     VALUES ('c9000000-0000-0000-0000-0000000000ff', 'claim-vg@vg.test', 'Claim VG',
             'c9111111-1111-1111-1111-111111111111') $$,
  'ten sam self-INSERT bez pól weryfikacji przechodzi (bramka nie jest szeroka)'
);

-- ── 18-20. RPC panelu: ten sam zbiór ról co guard ───────────────────────────
-- Bez parytetu naprawa guardu byłaby martwa: `admin_set_profile_verification`
-- to jedyna ścieżka zapisu z panelu (src/routes/admin.users.$id.tsx).
SELECT set_config('request.jwt.claims',
  '{"sub":"c9000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);

SELECT lives_ok(
  $$ SELECT public.admin_set_profile_verification(
       'c9000000-0000-0000-0000-0000000000cc', true) $$,
  'super_admin nadaje weryfikację przez RPC panelu'
);

RESET ROLE;
SELECT is(
  (SELECT verified_by FROM public.profiles
    WHERE id = 'c9000000-0000-0000-0000-0000000000cc'),
  'c9000000-0000-0000-0000-0000000000bb'::uuid,
  'RPC stempluje super_admina jako nadającego'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c9000000-0000-0000-0000-0000000000cc","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT public.admin_set_profile_verification(
       'c9000000-0000-0000-0000-0000000000dd', true) $$,
  '42501',
  'forbidden: admin role required',
  'RPC odmawia editorowi z ERRCODE 42501 (nie gołym P0001)'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
