-- pgTAP: profiles PII exposure fixes (migration 20260708170000).
--
-- Guards two regressions:
--   1. authenticated must NOT be able to read profiles.email / profiles.prefs
--      (a table-level GRANT SELECT had re-exposed every column to all staff),
--      while the public-safe columns stay readable so bylines and own-profile
--      editing keep working.
--   2. anon must only see EDITORIAL profiles (author/editor/admin), not every
--      reader who happens to have a slug.
--
-- Running: see supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(7);

-- ── (1) Column-level privileges of the authenticated role ───────────────────
-- These read the live ACL, so they assert the exact outcome of the REVOKE.
SELECT ok(
  NOT has_column_privilege('authenticated', 'public.profiles', 'email', 'SELECT'),
  'authenticated CANNOT SELECT profiles.email (account e-mail stays private)'
);
SELECT ok(
  NOT has_column_privilege('authenticated', 'public.profiles', 'prefs', 'SELECT'),
  'authenticated CANNOT SELECT profiles.prefs (private preferences/consent stay private)'
);
SELECT ok(
  has_column_privilege('authenticated', 'public.profiles', 'display_name', 'SELECT'),
  'authenticated CAN still SELECT profiles.display_name (author bylines keep working)'
);
SELECT ok(
  has_column_privilege('authenticated', 'public.profiles', 'first_name', 'SELECT'),
  'authenticated CAN still SELECT profiles.first_name (own-profile editing keeps working)'
);
SELECT ok(
  has_column_privilege('authenticated', 'public.profiles', 'contact_email', 'SELECT'),
  'authenticated CAN still SELECT profiles.contact_email (public contact field, not the account e-mail)'
);

-- ── (2) anon row visibility: editorial-only ─────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('c3333333-3333-3333-3333-333333333333', 'tenant-c', 'Tenant C');

INSERT INTO auth.users (id, email) VALUES
  ('c0000000-0000-0000-0000-0000000000c1', 'reader@c.test'),
  ('c0000000-0000-0000-0000-0000000000c2', 'author@c.test');

-- Both accounts have a slug (handle_new_user assigns one to EVERY account).
INSERT INTO public.profiles (id, email, display_name, slug, tenant_id) VALUES
  ('c0000000-0000-0000-0000-0000000000c1', 'reader@c.test', 'Plain Reader', 'plain-reader', 'c3333333-3333-3333-3333-333333333333'),
  ('c0000000-0000-0000-0000-0000000000c2', 'author@c.test', 'Real Author',  'real-author',  'c3333333-3333-3333-3333-333333333333');

-- Only the second account is editorial.
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('c0000000-0000-0000-0000-0000000000c2', 'author', 'c3333333-3333-3333-3333-333333333333');

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.profiles WHERE id = 'c0000000-0000-0000-0000-0000000000c1'),
  0,
  'anon CANNOT read a plain reader profile (slug alone no longer makes it public)'
);
SELECT is(
  (SELECT count(*)::int FROM public.profiles WHERE id = 'c0000000-0000-0000-0000-0000000000c2'),
  1,
  'anon CAN read an editorial (author) profile'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
