-- pgTAP: zarządzanie rolami + prywatność profili (migracja
-- 20260703090100_profiles_column_grants_and_role_audit.sql).
--
-- Weryfikowane własności:
--   1. Bezpośredni zapis do user_roles przez klienta jest ZABRONIONY
--      (przywilej INSERT/UPDATE/DELETE odebrany) - to zamyka eskalację,
--      w której admin tenantu nadawał sobie super_admin własnym INSERT-em.
--   2. change_user_role() atomowo podmienia rolę, pisze wpis audytowy,
--      blokuje zmianę własnej roli, nadanie super_admin przez zwykłego
--      admina oraz wywołanie przez nie-admina.
--   3. profiles.email NIE jest czytelny kolumnowo dla zalogowanych
--      (regresja z 20260629065015 usunięta); kolumny publiczne działają,
--      a własny wiersz (z e-mailem) zwraca get_own_profile().
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(11);

-- ── Seed (jako właściciel; triggery auth.users wyłączone jak w teście RLS) ──
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('c1111111-1111-1111-1111-111111111111', 'tenant-c', 'Tenant C');

INSERT INTO auth.users (id, email) VALUES
  ('c0000000-0000-0000-0000-0000000000aa', 'admin-c@c.test'),
  ('c0000000-0000-0000-0000-0000000000bb', 'author-c@c.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('c0000000-0000-0000-0000-0000000000aa', 'admin-c@c.test', 'Admin C', 'c1111111-1111-1111-1111-111111111111'),
  ('c0000000-0000-0000-0000-0000000000bb', 'author-c@c.test', 'Author C', 'c1111111-1111-1111-1111-111111111111');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('c0000000-0000-0000-0000-0000000000aa', 'admin',  'c1111111-1111-1111-1111-111111111111'),
  ('c0000000-0000-0000-0000-0000000000bb', 'author', 'c1111111-1111-1111-1111-111111111111');

-- ── Wcielenie: admin tenantu C ──────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

-- 1. Bezpośredni INSERT roli (w tym samo-eskalacja do super_admin) = odmowa.
SELECT throws_like(
  $$INSERT INTO public.user_roles (user_id, role, tenant_id)
    VALUES ('c0000000-0000-0000-0000-0000000000aa', 'super_admin', 'c1111111-1111-1111-1111-111111111111')$$,
  '%permission denied%',
  'klient nie może pisać do user_roles bezpośrednio (eskalacja zamknięta)'
);

-- 2-4. Atomowa, audytowana zmiana roli author -> editor.
SELECT lives_ok(
  $$SELECT public.change_user_role('c0000000-0000-0000-0000-0000000000bb', 'editor')$$,
  'admin zmienia rolę członka swojego tenantu przez change_user_role()'
);

SELECT is(
  (SELECT array_agg(role ORDER BY role) FROM public.user_roles
   WHERE user_id = 'c0000000-0000-0000-0000-0000000000bb'
     AND tenant_id = 'c1111111-1111-1111-1111-111111111111'),
  ARRAY['editor']::public.app_role[],
  'stary zestaw ról został atomowo zastąpiony nowym'
);

-- 5. Zmiana własnej roli zablokowana.
SELECT throws_like(
  $$SELECT public.change_user_role('c0000000-0000-0000-0000-0000000000aa', 'editor')$$,
  '%cannot_change_own_role%',
  'admin nie może zmienić własnej roli'
);

-- 6. Zwykły admin nie nadaje super_admin.
SELECT throws_like(
  $$SELECT public.change_user_role('c0000000-0000-0000-0000-0000000000bb', 'super_admin')$$,
  '%super_admin_required%',
  'nadanie super_admin wymaga super_admina'
);

-- 7. Kolumna email NIE jest czytelna (grant kolumnowy bez email).
SELECT throws_like(
  $$SELECT email FROM public.profiles WHERE id = 'c0000000-0000-0000-0000-0000000000bb'$$,
  '%permission denied%',
  'profiles.email nie jest czytelny dla authenticated (regresja grantu usunięta)'
);

-- 8. Kolumny publiczne (byline) czytają się normalnie.
SELECT is(
  (SELECT display_name FROM public.profiles WHERE id = 'c0000000-0000-0000-0000-0000000000bb'),
  'Author C',
  'publiczne kolumny profilu pozostają czytelne'
);

-- 9. Własny pełny wiersz przez get_own_profile() (w tym email).
SELECT is(
  (SELECT email FROM public.get_own_profile()),
  'admin-c@c.test',
  'get_own_profile() zwraca własny wiersz z e-mailem'
);

-- ── Wcielenie: autor (nie-admin) ────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);

-- 10. Nie-admin nie zarządza rolami.
SELECT throws_like(
  $$SELECT public.change_user_role('c0000000-0000-0000-0000-0000000000aa', 'user')$$,
  '%not_authorized%',
  'autor nie może zmieniać ról'
);

-- ── Audyt (czytany jako właściciel, poza RLS) ───────────────────────────────
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.role_audit_log
   WHERE tenant_id = 'c1111111-1111-1111-1111-111111111111'
     AND target_user_id = 'c0000000-0000-0000-0000-0000000000bb'),
  1,
  'zmiana roli zostawia dokładnie jeden wpis audytowy'
);

SELECT is(
  (SELECT old_roles || new_roles FROM public.role_audit_log
   WHERE tenant_id = 'c1111111-1111-1111-1111-111111111111'
     AND target_user_id = 'c0000000-0000-0000-0000-0000000000bb'),
  ARRAY['author', 'editor']::public.app_role[],
  'wpis audytowy niesie stary i nowy zestaw ról'
);

SELECT * FROM finish();
ROLLBACK;
