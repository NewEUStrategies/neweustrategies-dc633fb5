-- pgTAP: /author/:slug musi zwracac profil eksperta zarowno dla anon, jak i
-- authenticated po zaostrzeniu RLS na public.profiles (PR #85/#90) i po
-- przywroceniu widoku `profiles_public` do security_invoker=off (migracja
-- 20260724130000_expert_request_visibility.sql (sekcja profiles_public_definer_view)).
--
-- Regresja: brak SELECT dla anon/authenticated na `profiles_public` = 404
-- na kazdej stronie eksperta. Frontend (src/lib/experts/queries.ts) czyta
-- wylacznie z tego widoku po slugu.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(9);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- Izolowany tenant + jego wpis w public_tenant_id() nie jest wymagany,
-- bo widok filtruje po tenant_id = public_tenant_id(). Uzywamy tenanta,
-- ktory public_tenant_id() zwraca jako domyslny (najstarszy).
INSERT INTO public.tenants (id, slug, name) VALUES
  ('ab111111-1111-1111-1111-111111111111', 'tenant-authpub', 'Tenant AuthPub');

INSERT INTO auth.users (id, email) VALUES
  ('ab000000-0000-0000-0000-0000000000a1', 'expert@authpub.test'),
  ('ab000000-0000-0000-0000-0000000000a2', 'viewer@authpub.test');

-- Profil eksperta w tenancie zwracanym przez public_tenant_id().
INSERT INTO public.profiles (id, tenant_id, slug, display_name, first_name, last_name)
SELECT
  'ab000000-0000-0000-0000-0000000000a1',
  public.public_tenant_id(),
  'test-expert-authpub',
  'Test Expert AuthPub',
  'Test',
  'Expert';

-- --- 1) Widok istnieje i ma wymagane grants -------------------------------
SELECT has_view('public', 'profiles_public', 'profiles_public exists');

SELECT ok(
  has_table_privilege('anon', 'public.profiles_public', 'SELECT'),
  'anon has SELECT on profiles_public'
);

SELECT ok(
  has_table_privilege('authenticated', 'public.profiles_public', 'SELECT'),
  'authenticated has SELECT on profiles_public'
);

-- --- 2) Widok jest security definer (invoker=off) -------------------------
SELECT ok(
  (SELECT NOT ('security_invoker=true' = ANY (COALESCE(reloptions, ARRAY[]::text[])))
     FROM pg_class WHERE oid = 'public.profiles_public'::regclass),
  'profiles_public runs with definer semantics (security_invoker off)'
);

SELECT ok(
  (SELECT 'security_barrier=true' = ANY (COALESCE(reloptions, ARRAY[]::text[]))
     FROM pg_class WHERE oid = 'public.profiles_public'::regclass),
  'profiles_public has security_barrier enabled'
);

-- --- 3) Anon czyta profil po slugu (odpowiednik /author/:slug) ------------
SET LOCAL ROLE anon;

SELECT is(
  (SELECT count(*)::int FROM public.profiles_public
    WHERE slug = 'test-expert-authpub'),
  1,
  'anon otrzymuje 1 wiersz dla /author/test-expert-authpub'
);

SELECT is(
  (SELECT display_name FROM public.profiles_public
    WHERE slug = 'test-expert-authpub'),
  'Test Expert AuthPub',
  'anon otrzymuje display_name eksperta'
);

RESET ROLE;

-- --- 4) Authenticated (inny user, ten sam tenant) tez czyta ---------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'ab000000-0000-0000-0000-0000000000a2';
SET LOCAL request.jwt.claims = '{"sub":"ab000000-0000-0000-0000-0000000000a2","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.profiles_public
    WHERE slug = 'test-expert-authpub'),
  1,
  'authenticated otrzymuje 1 wiersz dla /author/test-expert-authpub'
);

SELECT is(
  (SELECT slug FROM public.profiles_public
    WHERE slug = 'test-expert-authpub'),
  'test-expert-authpub',
  'authenticated otrzymuje slug eksperta'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
