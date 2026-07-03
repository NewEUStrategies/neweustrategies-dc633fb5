-- pgTAP: kolumnowy grant UPDATE na tenants (re-audyt N6, migracja
-- 20260703120300).
--
-- Polityka RLS "Admins update own tenant" ogranicza KTÓRY wiersz, a grant
-- kolumnowy ogranicza CO wolno zmienić:
--   * admin tenanta może zmienić name (branding) własnego tenanta,
--   * slug / domain / is_default (tożsamość + routing host->tenant) są
--     odrzucane na poziomie uprawnień (42501) - nawet dla własnego wiersza,
--   * anon nie ma UPDATE wcale.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(6);

-- ── Seed: tenant A + jego admin ─────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'grants-tenant-a', 'Tenant A');

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-0000000000aa', 'admin-a@a.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('a0000000-0000-0000-0000-0000000000aa', 'admin-a@a.test', 'Admin A',
   'a1111111-1111-1111-1111-111111111111');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('a0000000-0000-0000-0000-0000000000aa', 'admin',
   'a1111111-1111-1111-1111-111111111111');

-- ── Wcielenie: admin tenanta A ──────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

SELECT lives_ok(
  $$ UPDATE public.tenants SET name = 'Tenant A (rebranded)'
      WHERE id = 'a1111111-1111-1111-1111-111111111111' $$,
  'admin tenanta zmienia name własnego tenanta (kolumna brandingowa)'
);

SELECT throws_ok(
  $$ UPDATE public.tenants SET slug = 'hijacked'
      WHERE id = 'a1111111-1111-1111-1111-111111111111' $$,
  '42501', NULL,
  'zmiana slug jest odrzucana na poziomie uprawnień (tożsamość tenanta)'
);

SELECT throws_ok(
  $$ UPDATE public.tenants SET domain = 'stolen-domain.example'
      WHERE id = 'a1111111-1111-1111-1111-111111111111' $$,
  '42501', NULL,
  'zmiana domain jest odrzucana (przejęcie routingu host->tenant)'
);

SELECT throws_ok(
  $$ UPDATE public.tenants SET is_default = true
      WHERE id = 'a1111111-1111-1111-1111-111111111111' $$,
  '42501', NULL,
  'zmiana is_default jest odrzucana (fallback dla nieznanych hostów)'
);

RESET ROLE;

SELECT is(
  (SELECT name FROM public.tenants
    WHERE id = 'a1111111-1111-1111-1111-111111111111'),
  'Tenant A (rebranded)',
  'dozwolona zmiana name faktycznie się zapisała'
);

-- ── anon: zero UPDATE ───────────────────────────────────────────────────────
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$ UPDATE public.tenants SET name = 'anon-was-here'
      WHERE slug = 'grants-tenant-a' $$,
  '42501', NULL,
  'anon nie ma UPDATE na tenants w ogóle'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
