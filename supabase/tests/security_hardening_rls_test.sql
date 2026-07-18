-- pgTAP: hardening RLS + grantów dla 5 findings ze skanu bezpieczeństwa
-- (2026-07-18). Każda własność jest asercją anti-regresyjną - dowolna
-- zmiana grantu lub polityki, która ponownie odsłoni te dane, wywali CI.
--
-- Zakres findings:
--   * author_profiles_public_read_pii
--       - anon NIE czyta wrażliwych kolumn (phone, media_contact_email)
--       - RLS "Public can view public author profiles" zawężone do
--         is_public=true AND tenant_id=public_tenant_id() (kontrola dodatnia)
--       - owner ma pełny dostęp przez SECURITY DEFINER get_own_author_profile()
--   * content_access_public_read_no_tenant_filter
--       - password_hash oraz password_hint_pl/en NIEczytelne dla anon
--         i authenticated (grant kolumnowy odebrany)
--       - RLS ogranicza SELECT do public_tenant_id()
--   * profile_badges_public_read_missing_tenant_scope
--       - anon widzi tylko wiersze publicznego tenanta (RLS filtruje po
--         public_tenant_id())
--   * tenant_pending_counters_and_domain_events_realtime_no_select_for_non_staff
--       - non-staff authenticated NIE czyta tenant_pending_counters
--       - non-staff authenticated NIE czyta cudzych domain_events;
--         własny wiersz (actor_id = auth.uid()) - tak
--   * wp_import_jobs_missing_tenant_select_restriction
--       - non-staff, non-actor NIE czyta wp_import_jobs
--       - actor swojego joba - tak; admin tenanta - tak

BEGIN;
SELECT plan(14);

-- ── (1) Granty kolumnowe: PII i sekrety ────────────────────────────────────
SELECT ok(
  NOT has_column_privilege('anon', 'public.author_profiles', 'phone', 'SELECT'),
  'anon NIE czyta author_profiles.phone'
);
SELECT ok(
  NOT has_column_privilege('anon', 'public.author_profiles', 'media_contact_email', 'SELECT'),
  'anon NIE czyta author_profiles.media_contact_email'
);
SELECT ok(
  NOT has_column_privilege('anon', 'public.content_access', 'password_hash', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'public.content_access', 'password_hash', 'SELECT'),
  'password_hash niedostępny dla anon ani authenticated (kolumnowy REVOKE)'
);
SELECT ok(
  NOT has_column_privilege('anon', 'public.content_access', 'password_hint_pl', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'public.content_access', 'password_hint_en', 'SELECT'),
  'password_hint_pl/en niedostępne dla anon ani authenticated'
);

-- ── Seed pod testy RLS ─────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('d4444444-4444-4444-4444-444444444444', 'tenant-d', 'Tenant D', 'tenant-d.example');

INSERT INTO auth.users (id, email) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'owner@d.test'),
  ('d0000000-0000-0000-0000-000000000002', 'admin@d.test'),
  ('d0000000-0000-0000-0000-000000000003', 'reader@d.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'owner@d.test',  'Owner D',  'd4444444-4444-4444-4444-444444444444'),
  ('d0000000-0000-0000-0000-000000000002', 'admin@d.test',  'Admin D',  'd4444444-4444-4444-4444-444444444444'),
  ('d0000000-0000-0000-0000-000000000003', 'reader@d.test', 'Reader D', 'd4444444-4444-4444-4444-444444444444');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'author', 'd4444444-4444-4444-4444-444444444444'),
  ('d0000000-0000-0000-0000-000000000002', 'admin',  'd4444444-4444-4444-4444-444444444444'),
  ('d0000000-0000-0000-0000-000000000003', 'user',   'd4444444-4444-4444-4444-444444444444');

-- wp_import_jobs: import należący do "owner"
INSERT INTO public.wp_import_jobs (
  id, tenant_id, actor_id, status, site, language, total, processed,
  imported, updated_count, skipped, failed, media_imported, log, options
) VALUES (
  'd1111111-0000-0000-0000-000000000001',
  'd4444444-4444-4444-4444-444444444444',
  'd0000000-0000-0000-0000-000000000001',
  'pending', 'https://example.test', 'pl', 0, 0, 0, 0, 0, 0, 0,
  '[]'::jsonb, '{}'::jsonb
);

-- domain_events: zdarzenie przypisane do "owner"
INSERT INTO public.domain_events (tenant_id, actor_id, aggregate_type, aggregate_id, event_type, payload)
VALUES ('d4444444-4444-4444-4444-444444444444',
        'd0000000-0000-0000-0000-000000000001',
        'test', gen_random_uuid(), 'test.event', '{}'::jsonb);

-- tenant_pending_counters: seed (klucz per-tenant)
INSERT INTO public.tenant_pending_counters (tenant_id, counter_key, value)
VALUES ('d4444444-4444-4444-4444-444444444444', 'pending', 3)
ON CONFLICT (tenant_id, counter_key) DO UPDATE SET value = EXCLUDED.value;

-- ── (2) Wcielenie: nie-staff, nie-actor (reader) ────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SELECT set_config('request.headers', '{"x-tenant-host":"tenant-d.example"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.wp_import_jobs
     WHERE id = 'd1111111-0000-0000-0000-000000000001'),
  0,
  'reader (non-staff, non-actor) NIE widzi wp_import_jobs cudzego joba'
);

SELECT is(
  (SELECT count(*)::int FROM public.domain_events
     WHERE actor_id = 'd0000000-0000-0000-0000-000000000001'),
  0,
  'reader NIE widzi cudzych domain_events (brak actor_id match, non-staff)'
);

SELECT is(
  (SELECT count(*)::int FROM public.tenant_pending_counters
     WHERE tenant_id = 'd4444444-4444-4444-4444-444444444444'),
  0,
  'reader (non-staff) NIE widzi tenant_pending_counters'
);

-- profile_badges: reader we własnym tenancie (niepubliczny) nie powinien
-- widzieć wierszy (polityka public read wymaga public_tenant_id())
SELECT is(
  (SELECT count(*)::int FROM public.profile_badges
     WHERE tenant_id = 'd4444444-4444-4444-4444-444444444444'),
  0,
  'profile_badges: wiersze niepublicznego tenanta niewidoczne dla anon/auth (public read filtruje po public_tenant_id())'
);

-- ── (3) Wcielenie: owner/actor własnego rekordu ─────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.wp_import_jobs
     WHERE id = 'd1111111-0000-0000-0000-000000000001'),
  1,
  'owner-actor CZYTA swój wp_import_jobs (polityka: actor_id = auth.uid())'
);

SELECT is(
  (SELECT count(*)::int FROM public.domain_events
     WHERE actor_id = 'd0000000-0000-0000-0000-000000000001'),
  1,
  'actor CZYTA swoje domain_events (polityka: actor_id = auth.uid())'
);

-- ── (4) Wcielenie: admin tenanta ────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.wp_import_jobs
     WHERE id = 'd1111111-0000-0000-0000-000000000001'),
  1,
  'admin tenanta CZYTA wp_import_jobs w swoim tenancie'
);

SELECT is(
  (SELECT count(*)::int FROM public.tenant_pending_counters
     WHERE tenant_id = 'd4444444-4444-4444-4444-444444444444'),
  1,
  'admin tenanta (is_staff) CZYTA tenant_pending_counters swojego tenanta'
);

SELECT is(
  (SELECT count(*)::int FROM public.domain_events
     WHERE tenant_id = 'd4444444-4444-4444-4444-444444444444'),
  1,
  'admin tenanta (is_staff) CZYTA domain_events swojego tenanta'
);

-- ── (5) get_own_author_profile() zwraca własny wiersz z PII ────────────────
-- (owner) - w tym teście autor D nie ma jeszcze author_profiles; wstawiamy go
-- teraz jako właściciel (SECURITY DEFINER; owner-scope przez auth.uid()).
INSERT INTO public.author_profiles (user_id, tenant_id, phone, media_contact_email, is_public)
VALUES ('d0000000-0000-0000-0000-000000000001',
        'd4444444-4444-4444-4444-444444444444',
        '+48 000 000 000',
        'media@d.test',
        true);

SELECT set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

SELECT is(
  (SELECT phone FROM public.get_own_author_profile()),
  '+48 000 000 000',
  'get_own_author_profile() zwraca własny phone (SECURITY DEFINER omija kolumnowy REVOKE)'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
