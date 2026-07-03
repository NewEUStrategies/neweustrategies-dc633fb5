-- pgTAP: host-aware płaszczyzna anon (re-audyt N1 + N2).
--
-- Weryfikuje migracje 20260703120000 (request_public_host + host-aware
-- public_tenant_id) oraz 20260703120100 (trending_posts otenantowane):
--   1. request_public_host() normalizuje nagłówek x-tenant-host (case, port).
--   2. public_tenant_id(): brak nagłówka -> tenant domyślny; domena tenanta B
--      -> B; alias www. -> B; nieznany host -> tenant domyślny (fail-open na
--      płaszczyźnie TREŚCI jest zamierzony - poziom crawlera jest fail-closed
--      w warstwie aplikacji, patrz resolveCrawlerTenantForHost).
--   3. RLS anon na posts podąża za hostem: na domenie B anon widzi wyłącznie
--      opublikowane posty B, nigdy posty tenanta domyślnego.
--   4. trending_posts() zwraca wyłącznie posty tenanta wskazanego przez host -
--      koniec przecieku "trending" między tenantami.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(12);

-- ── Seed ───────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

-- Tenant domyślny (seed 'nes') dostaje jawną domenę; tenant B własną.
UPDATE public.tenants SET domain = 'nes.example' WHERE slug = 'nes';

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('b2222222-2222-2222-2222-222222222222', 'tenant-b', 'Tenant B', 'b.example');

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-0000000000aa', 'author-nes@nes.test'),
  ('b0000000-0000-0000-0000-0000000000bb', 'author-b@b.test');

INSERT INTO public.pages (id, tenant_id, slug) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a',
   (SELECT id FROM public.tenants WHERE slug = 'nes'), 'host-test-nes-home'),
  ('bbbbbbbb-0000-0000-0000-00000000000b',
   'b2222222-2222-2222-2222-222222222222', 'host-test-b-home');

INSERT INTO public.posts (id, slug, author_id, status, tenant_id, parent_page_id, title_pl) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'host-test-nes-post',
   'a0000000-0000-0000-0000-0000000000aa', 'published',
   (SELECT id FROM public.tenants WHERE slug = 'nes'),
   'aaaaaaaa-0000-0000-0000-00000000000a', 'Post NES'),
  ('00000000-0000-0000-0000-0000000000b1', 'host-test-b-post',
   'b0000000-0000-0000-0000-0000000000bb', 'published',
   'b2222222-2222-2222-2222-222222222222',
   'bbbbbbbb-0000-0000-0000-00000000000b', 'Post B');

-- Wyświetlenia dla obu postów - trending bez filtra tenanta pokazałby OBA.
INSERT INTO public.post_views (post_id, tenant_id, viewer_hash) VALUES
  ('00000000-0000-0000-0000-0000000000a1',
   (SELECT id FROM public.tenants WHERE slug = 'nes'), 'viewer-hash-nes-0001'),
  ('00000000-0000-0000-0000-0000000000b1',
   'b2222222-2222-2222-2222-222222222222', 'viewer-hash-bbb-0001');

-- ── request_public_host(): normalizacja nagłówka ───────────────────────────
SELECT set_config('request.headers', '{"x-tenant-host":"B.EXAMPLE:8443"}', true);
SELECT is(
  public.request_public_host(), 'b.example',
  'request_public_host normalizuje wielkość liter i odcina port'
);

SELECT set_config('request.headers', '', true);
SELECT is(
  public.request_public_host(), NULL::text,
  'request_public_host: brak nagłówków -> NULL (bez błędu)'
);

-- ── public_tenant_id(): host -> tenant ─────────────────────────────────────
SELECT is(
  public.public_tenant_id(),
  (SELECT id FROM public.tenants WHERE slug = 'nes'),
  'bez nagłówka public_tenant_id() = tenant domyślny (zachowanie sprzed multi-domain)'
);

SELECT set_config('request.headers', '{"x-tenant-host":"b.example"}', true);
SELECT is(
  public.public_tenant_id(), 'b2222222-2222-2222-2222-222222222222'::uuid,
  'domena tenanta B -> tenant B'
);

SELECT set_config('request.headers', '{"x-tenant-host":"www.b.example"}', true);
SELECT is(
  public.public_tenant_id(), 'b2222222-2222-2222-2222-222222222222'::uuid,
  'alias www. wskazuje na apex tenanta B'
);

SELECT set_config('request.headers', '{"x-tenant-host":"unclaimed.example"}', true);
SELECT is(
  public.public_tenant_id(),
  (SELECT id FROM public.tenants WHERE slug = 'nes'),
  'nieznany host -> tenant domyślny (płaszczyzna treści jest fail-open zamierzenie)'
);

-- ── RLS anon podąża za hostem ───────────────────────────────────────────────
SET LOCAL ROLE anon;

SELECT set_config('request.headers', '{"x-tenant-host":"b.example"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.posts WHERE slug = 'host-test-b-post'),
  1,
  'anon na domenie B czyta opublikowany post B'
);
SELECT is(
  (SELECT count(*)::int FROM public.posts WHERE slug = 'host-test-nes-post'),
  0,
  'anon na domenie B NIE widzi postów tenanta domyślnego'
);

-- ── trending_posts(): otenantowane (N1) ─────────────────────────────────────
SELECT is(
  (SELECT array_agg(t.slug ORDER BY t.slug)
     FROM public.trending_posts(7, 10) t
    WHERE t.slug LIKE 'host-test-%'),
  ARRAY['host-test-b-post'],
  'trending na domenie B zawiera wyłącznie posty B (koniec przecieku między tenantami)'
);

SELECT set_config('request.headers', '{"x-tenant-host":"nes.example"}', true);
SELECT is(
  (SELECT array_agg(t.slug ORDER BY t.slug)
     FROM public.trending_posts(7, 10) t
    WHERE t.slug LIKE 'host-test-%'),
  ARRAY['host-test-nes-post'],
  'trending na domenie domyślnej zawiera wyłącznie posty tenanta domyślnego'
);

RESET ROLE;

-- ── popular_post_ids: bliźniak dziedziczy host-awareness ────────────────────
SELECT set_config('request.headers', '{"x-tenant-host":"b.example"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.popular_post_ids(30, 200) p
    WHERE p.post_id = '00000000-0000-0000-0000-0000000000a1'),
  0,
  'popular_post_ids na domenie B nie zwraca postów tenanta domyślnego'
);
SELECT is(
  (SELECT count(*)::int FROM public.popular_post_ids(30, 200) p
    WHERE p.post_id = '00000000-0000-0000-0000-0000000000b1'),
  1,
  'popular_post_ids na domenie B zwraca posty B'
);

SELECT * FROM finish();
ROLLBACK;
