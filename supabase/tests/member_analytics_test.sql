-- pgTAP: analityka czlonkow (20260713190000).
--
--   1. RPC odmawiaja nie-adminowi (guard assert_admin_tenant).
--   2. admin_member_funnel liczy czlonkow tenanta, opt-in discoverable
--      i aktywnych (aktywnosc = m.in. user_read_history) w oknie.
--   3. admin_member_activity_series zwraca pelna serie dni.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(7);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('aa111111-1111-1111-1111-111111111111', 'tenant-ma', 'Tenant MA');

INSERT INTO auth.users (id, email) VALUES
  ('aa000000-0000-0000-0000-0000000000aa', 'admin-ma@ma.test'),
  ('aa000000-0000-0000-0000-0000000000bb', 'active-ma@ma.test'),
  ('aa000000-0000-0000-0000-0000000000cc', 'idle-ma@ma.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id, discoverable, created_at) VALUES
  ('aa000000-0000-0000-0000-0000000000aa', 'admin-ma@ma.test', 'Admin MA',
   'aa111111-1111-1111-1111-111111111111', false, now() - interval '10 days'),
  ('aa000000-0000-0000-0000-0000000000bb', 'active-ma@ma.test', 'Active MA',
   'aa111111-1111-1111-1111-111111111111', true, now() - interval '9 days'),
  ('aa000000-0000-0000-0000-0000000000cc', 'idle-ma@ma.test', 'Idle MA',
   'aa111111-1111-1111-1111-111111111111', false, now() - interval '8 days');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('aa000000-0000-0000-0000-0000000000aa', 'admin',
   'aa111111-1111-1111-1111-111111111111');

-- Aktywnosc: jeden czlonek czyta wpis w oknie.
INSERT INTO public.pages (id, tenant_id, slug) VALUES
  ('aa222222-2222-2222-2222-222222222222',
   'aa111111-1111-1111-1111-111111111111', 'sekcja-ma');
INSERT INTO public.posts (id, slug, author_id, status, tenant_id, parent_page_id, title_pl)
VALUES ('aa333333-3333-3333-3333-333333333333', 'wpis-ma',
        'aa000000-0000-0000-0000-0000000000aa', 'published',
        'aa111111-1111-1111-1111-111111111111',
        'aa222222-2222-2222-2222-222222222222', 'Wpis MA');
-- tenant_id jawnie: DEFAULT current_tenant_id() nie dziala dla ownera testu
-- (auth.uid() = NULL), a kolumna jest NOT NULL.
INSERT INTO public.user_read_history (user_id, tenant_id, post_id, read_at)
VALUES ('aa000000-0000-0000-0000-0000000000bb',
        'aa111111-1111-1111-1111-111111111111',
        'aa333333-3333-3333-3333-333333333333', now() - interval '2 days');

-- -- 1. Nie-admin: odmowa -------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"aa000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);

SELECT throws_like(
  $$ SELECT * FROM public.admin_member_funnel(30) $$,
  '%admin role required%',
  'admin_member_funnel odmawia nie-adminowi'
);

SELECT throws_like(
  $$ SELECT * FROM public.admin_member_retention(8) $$,
  '%admin role required%',
  'admin_member_retention odmawia nie-adminowi'
);

-- -- 2. Admin: lejek -------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"aa000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

SELECT is(
  (SELECT f.members_total FROM public.admin_member_funnel(30) f),
  3::bigint,
  'lejek liczy wszystkich czlonkow tenanta'
);

SELECT is(
  (SELECT f.discoverable_total FROM public.admin_member_funnel(30) f),
  1::bigint,
  'lejek liczy opt-in discoverable'
);

SELECT is(
  (SELECT f.active_members FROM public.admin_member_funnel(30) f),
  1::bigint,
  'aktywni = czlonkowie z aktywnoscia w oknie (tu: user_read_history)'
);

SELECT is(
  (SELECT f.readers FROM public.admin_member_funnel(30) f),
  1::bigint,
  'czytajacy liczeni po user_read_history'
);

-- -- 3. Seria dzienna ------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM public.admin_member_activity_series(7)),
  7,
  'seria dzienna zwraca wiersz na kazdy dzien okna'
);

SELECT * FROM finish();
ROLLBACK;
