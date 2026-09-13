-- pgTAP: granica najemcy w podszywaniu się pod konto.
--
-- Klasa błędu: `is_super_admin()` bada WYŁĄCZNIE rolę wołającego w JEGO
-- najemcy, a serwerowa funkcja `startImpersonation` pracowała dalej kluczem
-- serwisowym, czyli poza RLS. Sama bramka roli nie mówi więc NIC o tym, do
-- którego najemcy należy CEL - super admin najemcy A wystawiał sobie token
-- logowania do konta w najemcy B, a wiersz dziennika lądował w najemcy
-- napastnika.
--
-- Ten plik pilnuje DWÓCH rzeczy po stronie bazy:
--   1. PRZESŁANKI poprawki w TypeScripcie: `is_super_admin()` jest tenantowe,
--      więc pytanie o rolę aktora NIE jest odpowiedzią o najemcy celu
--      (asercje 1-2). Gdyby ta funkcja kiedyś przestała być tenantowa, jawne
--      porównanie profili w `impersonation.functions.ts` straciłoby sens,
--      a ten plik zrobiłby się czerwony.
--   2. ZAWĘŻENIA DZIENNIKA (migracja 20260912180000): polityka
--      `super_admin_read_impersonation` wiąże wiersz z najemcą, więc super
--      admin A nie czyta historii podszyć najemcy B (asercje 3-5).
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(5);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Seed: dwa najemcy, w każdym po jednym super adminie ─────────────────────
INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('1a111111-1111-4111-8111-111111111111', 'imp-a', 'Impersonation Tenant A', 'a.imp.example'),
  ('1b222222-2222-4222-8222-222222222222', 'imp-b', 'Impersonation Tenant B', 'b.imp.example');

INSERT INTO auth.users (id, email) VALUES
  ('2a111111-1111-4111-8111-111111111111', 'super-a@imp.test'),
  ('2b222222-2222-4222-8222-222222222222', 'super-b@imp.test'),
  ('2c333333-3333-4333-8333-333333333333', 'member-b@imp.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('2a111111-1111-4111-8111-111111111111', 'super-a@imp.test', 'Super A',
   '1a111111-1111-4111-8111-111111111111'),
  ('2b222222-2222-4222-8222-222222222222', 'super-b@imp.test', 'Super B',
   '1b222222-2222-4222-8222-222222222222'),
  ('2c333333-3333-4333-8333-333333333333', 'member-b@imp.test', 'Member B',
   '1b222222-2222-4222-8222-222222222222');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('2a111111-1111-4111-8111-111111111111', 'super_admin'::public.app_role,
   '1a111111-1111-4111-8111-111111111111'),
  ('2b222222-2222-4222-8222-222222222222', 'super_admin'::public.app_role,
   '1b222222-2222-4222-8222-222222222222');

-- Trzy wiersze dziennika: własny najemcy A, cudzy najemcy B oraz historyczny
-- bez najemcy (aktor, którego profilu już nie ma - backfill migracji nie miał
-- go z czego uzupełnić).
INSERT INTO public.impersonation_sessions (actor_user_id, target_user_id, tenant_id, reason) VALUES
  ('2a111111-1111-4111-8111-111111111111', '2a111111-1111-4111-8111-111111111111',
   '1a111111-1111-4111-8111-111111111111', 'wlasny najemca'),
  ('2b222222-2222-4222-8222-222222222222', '2c333333-3333-4333-8333-333333333333',
   '1b222222-2222-4222-8222-222222222222', 'cudzy najemca'),
  ('2b222222-2222-4222-8222-222222222222', '2c333333-3333-4333-8333-333333333333',
   NULL, 'wiersz historyczny bez najemcy');

SET LOCAL ROLE authenticated;

-- ── 1) PRZESŁANKA: super admin A jest super adminem WE WŁASNYM najemcy ──────
SELECT set_config('request.jwt.claims',
  '{"sub":"2a111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
SELECT is(
  public.is_super_admin(),
  true,
  'przeslanka: super admin A przechodzi bramke roli we wlasnym najemcy'
);

-- ── 2) PRZESŁANKA: ta sama rola jest FAŁSZEM w kontekście najemcy B ─────────
-- Czyli: bramka roli odpowiada o najemcy WOŁAJĄCEGO, a nie o celu. Dlatego
-- `startImpersonation` musi porównać profile aktora i celu JAWNIE.
SELECT set_config('request.jwt.claims',
  '{"sub":"2c333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
SELECT is(
  public.is_super_admin('2a111111-1111-4111-8111-111111111111'),
  false,
  'przeslanka: rola super admina A nie istnieje w najemcy B - bramka roli nie mowi nic o celu'
);

-- ── 3) DZIENNIK: super admin A widzi WŁASNY wiersz ──────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"2a111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.impersonation_sessions
    WHERE reason = 'wlasny najemca'),
  1,
  'legit: super admin A czyta dziennik WLASNEGO najemcy - zawezenie nie psuje wlasnej sciezki'
);

-- ── 4) DZIENNIK: super admin A NIE widzi wiersza najemcy B ──────────────────
SELECT is(
  (SELECT count(*)::int FROM public.impersonation_sessions
    WHERE reason = 'cudzy najemca'),
  0,
  'regresja: super admin A NIE czyta podszyc najemcy B (przed migracja: 1)'
);

-- ── 5) DZIENNIK: wiersz bez najemcy jest niewidoczny dla ról klienckich ─────
SELECT is(
  (SELECT count(*)::int FROM public.impersonation_sessions
    WHERE reason = 'wiersz historyczny bez najemcy'),
  0,
  'fail closed: wiersza bez najemcy nie widzi zaden super admin - czyta go tylko service_role'
);

SELECT * FROM finish();
ROLLBACK;
