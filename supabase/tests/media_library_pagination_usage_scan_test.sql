-- pgTAP: biblioteka mediów - indeksy paginacji, foldery z położenia plików
-- i skan użyć po stronie bazy (migracja 20261003090000).
--
-- Trzy rzeczy, których nie widać w testach Vitest (atrapa PostgREST nie zna
-- ani indeksów, ani grantów, ani RLS):
--   1. KSZTAŁT. Indeksy keyset istnieją, a stary `media_tenant_folder_idx`
--      zniknął (nowy indeks per folder ma ten sam prefiks).
--   2. GRANTY. `media_usage_scan` czyta kolumny ciała odebrane roli
--      `authenticated`, więc EXECUTE ma wyłącznie service_role; granicą
--      tenanta jest jawny parametr. `media_folder_paths` jest SECURITY
--      INVOKER - redaktor tenanta A nie wyciągnie nim folderów tenanta B.
--   3. ZACHOWANIE. Skan trafia w okładkę, treść, drzewa buildera/bloków
--      i nadpisania układu; pomija kosz, obcego tenanta i puste igły.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(17);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Seed (jako właściciel; RLS pomijane) ────────────────────────────────────
INSERT INTO public.tenants (id, slug, name) VALUES
  ('e4111111-1111-1111-1111-111111111111', 'media-scan-a', 'Media Scan A'),
  ('e4222222-2222-2222-2222-222222222222', 'media-scan-b', 'Media Scan B');

INSERT INTO auth.users (id, email) VALUES
  ('e4000000-0000-0000-0000-0000000000a1', 'editor-a@media-scan.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('e4000000-0000-0000-0000-0000000000a1', 'editor-a@media-scan.test', 'Editor A',
   'e4111111-1111-1111-1111-111111111111');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('e4000000-0000-0000-0000-0000000000a1', 'editor', 'e4111111-1111-1111-1111-111111111111');

INSERT INTO public.media (tenant_id, storage_path, public_url, filename, folder_path) VALUES
  ('e4111111-1111-1111-1111-111111111111', 'e4a/u/root.png', 'https://x/media/e4a/u/root.png', 'root.png', '/'),
  ('e4111111-1111-1111-1111-111111111111', 'e4a/u/press.png', 'https://x/media/e4a/u/press.png', 'press.png', '/press/'),
  ('e4111111-1111-1111-1111-111111111111', 'e4a/u/press2.png', 'https://x/media/e4a/u/press2.png', 'press2.png', '/press/'),
  ('e4111111-1111-1111-1111-111111111111', 'e4a/u/deep.png', 'https://x/media/e4a/u/deep.png', 'deep.png', '/press/2026/'),
  ('e4222222-2222-2222-2222-222222222222', 'e4b/u/secret.png', 'https://x/media/e4b/u/secret.png', 'secret.png', '/secret/');

INSERT INTO public.pages (id, tenant_id, slug, title_pl, builder_data) VALUES
  ('e4aaaaaa-0000-0000-0000-00000000000a', 'e4111111-1111-1111-1111-111111111111', 'media-scan-home',
   'Strona A', '{"bg":"e4a/u/press.png"}'),
  ('e4bbbbbb-0000-0000-0000-00000000000b', 'e4222222-2222-2222-2222-222222222222', 'media-scan-home-b',
   'Strona B', '{"bg":"e4a/u/press.png"}');

INSERT INTO public.posts (id, slug, author_id, status, tenant_id, parent_page_id, title_pl,
                          cover_image_url, content_pl, blocks_data, layout_overrides, deleted_at) VALUES
  ('e4000000-0000-0000-0000-0000000000c1', 'scan-cover', 'e4000000-0000-0000-0000-0000000000a1',
   'published', 'e4111111-1111-1111-1111-111111111111', 'e4aaaaaa-0000-0000-0000-00000000000a', 'Okładka',
   'https://x/media/e4a/u/press.png', NULL, NULL, NULL, NULL),
  ('e4000000-0000-0000-0000-0000000000c2', 'scan-tree', 'e4000000-0000-0000-0000-0000000000a1',
   'draft', 'e4111111-1111-1111-1111-111111111111', 'e4aaaaaa-0000-0000-0000-00000000000a', 'Drzewo',
   NULL, '<img src="/media/e4a/u/press.png">', '[{"attrs":{"url":"e4a/u/press.png"}}]',
   '{"hero":"e4a/u/press.png"}', NULL),
  ('e4000000-0000-0000-0000-0000000000c3', 'scan-trash', 'e4000000-0000-0000-0000-0000000000a1',
   'draft', 'e4111111-1111-1111-1111-111111111111', 'e4aaaaaa-0000-0000-0000-00000000000a', 'Kosz',
   'e4a/u/press.png', NULL, NULL, NULL, now()),
  ('e4000000-0000-0000-0000-0000000000c4', 'scan-none', 'e4000000-0000-0000-0000-0000000000a1',
   'published', 'e4111111-1111-1111-1111-111111111111', 'e4aaaaaa-0000-0000-0000-00000000000a', 'Nic',
   'https://x/other.png', '<p>tekst</p>', NULL, NULL, NULL);

-- ── (1-3) Kształt: indeksy keyset, bez zdublowanego prefiksu ────────────────
SELECT has_index('public', 'media', 'media_tenant_created_idx',
  ARRAY['tenant_id', 'created_at', 'id'], 'indeks keyset biblioteki (tenant, created_at, id)');
SELECT has_index('public', 'media', 'media_tenant_folder_created_idx',
  ARRAY['tenant_id', 'folder_path', 'created_at', 'id'], 'indeks keyset folderu (tenant, folder, created_at, id)');
SELECT hasnt_index('public', 'media', 'media_tenant_folder_idx',
  'stary indeks (tenant, folder) zdjęty - jego prefiks niesie indeks per folder');

-- ── (4-8) Granty ────────────────────────────────────────────────────────────
SELECT ok(NOT has_function_privilege('anon', 'public.media_usage_scan(uuid,text[],integer)', 'EXECUTE'),
  'anon NIE wywoła skanu użyć');
SELECT ok(NOT has_function_privilege('authenticated', 'public.media_usage_scan(uuid,text[],integer)', 'EXECUTE'),
  'authenticated NIE wywoła skanu użyć (kolumny ciała są mu odebrane, tenant byłby z parametru)');
SELECT ok(has_function_privilege('service_role', 'public.media_usage_scan(uuid,text[],integer)', 'EXECUTE'),
  'service_role wywołuje skan użyć');
SELECT ok(NOT has_function_privilege('anon', 'public.media_folder_paths(uuid)', 'EXECUTE'),
  'anon NIE wylistuje folderów biblioteki');
SELECT ok(has_function_privilege('authenticated', 'public.media_folder_paths(uuid)', 'EXECUTE'),
  'redakcja listuje foldery biblioteki');

-- ── (9-13) Skan użyć jako service_role ─────────────────────────────────────
SET LOCAL ROLE service_role;

SELECT results_eq(
  $$ SELECT kind, slug, areas FROM public.media_usage_scan(
       'e4111111-1111-1111-1111-111111111111', ARRAY['e4a/u/press.png']) $$,
  $$ VALUES ('post'::text, 'scan-tree'::text, ARRAY['content', 'blocks', 'layout']::text[]),
            ('post', 'scan-cover', ARRAY['cover']::text[]),
            ('page', 'media-scan-home', ARRAY['builder']::text[]) $$,
  'skan trafia w okładkę, treść, bloki, układ i builder strony - wpisy przed stronami, potem po tytule'
);

SELECT is(
  (SELECT count(*)::int FROM public.media_usage_scan(
     'e4111111-1111-1111-1111-111111111111', ARRAY['e4a/u/press.png'])
    WHERE slug IN ('scan-trash', 'media-scan-home-b')),
  0,
  'skan pomija kosz i treści OBCEGO tenanta, choć zawierają tę samą ścieżkę'
);

SELECT is(
  (SELECT count(*)::int FROM public.media_usage_scan(
     'e4111111-1111-1111-1111-111111111111', ARRAY['', NULL]::text[])),
  0,
  'puste i NULL-owe igły niczego nie dopasowują (pusty podciąg pasowałby do wszystkiego)'
);

SELECT is(
  (SELECT count(*)::int FROM public.media_usage_scan(
     'e4111111-1111-1111-1111-111111111111', ARRAY['e4a/u/press.png'], 1)),
  1,
  'limit przycina liczbę zwróconych trafień'
);

SELECT is(
  (SELECT count(*)::int FROM public.media_usage_scan(
     'e4111111-1111-1111-1111-111111111111', ARRAY['e4a/u/root.png'])),
  0,
  'plik nieużywany nigdzie daje zero trafień'
);

-- ── (14-17) Foldery jako redaktor tenanta A (RLS obowiązuje) ────────────────
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"e4000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT results_eq(
  $$ SELECT p FROM public.media_folder_paths('e4111111-1111-1111-1111-111111111111') AS p $$,
  $$ VALUES ('/press/'::text), ('/press/2026/'::text) $$,
  'foldery z położenia plików: różne, posortowane, bez korzenia'
);

SELECT is(
  (SELECT count(*)::int FROM public.media_folder_paths('e4222222-2222-2222-2222-222222222222')),
  0,
  'redaktor tenanta A NIE wyciągnie folderów tenanta B przez parametr (SECURITY INVOKER + RLS)'
);

SELECT throws_ok(
  $$ SELECT * FROM public.media_usage_scan('e4111111-1111-1111-1111-111111111111', ARRAY['x']) $$,
  '42501',
  NULL,
  'redaktor dostaje odmowę EXECUTE na skanie użyć'
);

SELECT throws_ok(
  $$ SELECT public.media_text_contains_any('abc', ARRAY['b']) $$,
  '42501',
  NULL,
  'funkcja pomocnicza skanu też nie jest wystawiona roli authenticated'
);

SELECT * FROM finish();
ROLLBACK;
