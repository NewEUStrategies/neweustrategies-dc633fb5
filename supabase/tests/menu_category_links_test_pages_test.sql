-- pgTAP: linki menu do kategorii podążają za kategorią, martwe linki znikają,
-- a strony testowe nie są publiczne ani indeksowalne.
--
-- Weryfikuje migracje 20261011090000_menu_items_follow_categories.sql,
-- 20261011090100_event_seed_test_pages_noindex.sql
-- i 20261011090200_unpublish_test_pages.sql.
--
-- PO CO TO STOI (2026-10 audyt SEO). Menu główne linkowało `/category/ekonomia`
-- (404): pozycja menu kopiowała adres przy dodaniu, a zmiana slugu albo
-- skasowanie kategorii nie dotykały `menu_items`. Równolegle opublikowane
-- strony `/test-e2e-zakup*` (zasiew stron wydarzeń z testów e2e) trafiały do
-- `sitemaps/pages.xml`.
--
-- CZEGO TEN TEST PILNUJE:
--   1. wyzwalacz `categories_sync_menu_items`: zmiana slugu przepisuje adres
--      pozycji kategorii (po `ref_id`) i własnych linków z DOKŁADNIE starym
--      adresem (także `/en/...`), skasowanie kategorii kasuje liść
--      i zamienia w nagłówek bez linku pozycję z dziećmi - wyłącznie w menu
--      najemcy kategorii (ten sam slug w innym najemcy zostaje nietknięty);
--   2. naprawa danych zastanych (`_menu_items_repair_category_links`, ta sama
--      funkcja, którą woła migracja): bieżący adres dla żywego `ref_id`,
--      dowiązanie martwego `ref_id` po żywym adresie, usunięcie martwych linków
--      (także `ref_id` wskazującego kategorię INNEGO najemcy), idempotencja;
--   3. odpublikowanie stron testowych (`_pages_unpublish_test_content`): slug
--      strony albo przodka, wszyscy najemcy, kosz nietknięty, prawdziwe słowa
--      (`testament`, `testy-nato`) nietknięte, idempotencja;
--   4. zasiew stron wydarzenia: wydarzenie testowe dostaje strony
--      `published` + `seo_noindex`, zwykłe - indeksowalne.
--
-- Klucze menu `pgtap-*` celowo nie są `main` - patrz `menu_items_save_atomic_test.sql`.

BEGIN;
SELECT plan(40);

INSERT INTO public.tenants (id, slug, name) VALUES
  ('b2000000-0000-4000-8000-0000000000a1', 'menu-links-a', 'Menu Links A'),
  ('b2000000-0000-4000-8000-0000000000b1', 'menu-links-b', 'Menu Links B');

INSERT INTO public.categories (id, tenant_id, slug, name_pl, name_en) VALUES
  ('b2000000-1111-4000-8000-0000000000a1', 'b2000000-0000-4000-8000-0000000000a1', 'ekonomia', 'Ekonomia', 'Economy'),
  ('b2000000-1111-4000-8000-0000000000a2', 'b2000000-0000-4000-8000-0000000000a1', 'energetyka', 'Energetyka', 'Energy'),
  ('b2000000-1111-4000-8000-0000000000a3', 'b2000000-0000-4000-8000-0000000000a1', 'obronnosc', 'Obronność', 'Defence'),
  ('b2000000-1111-4000-8000-0000000000b1', 'b2000000-0000-4000-8000-0000000000b1', 'ekonomia', 'Ekonomia B', 'Economy B');

INSERT INTO public.menus (id, tenant_id, key, name) VALUES
  ('b2000000-2222-4000-8000-0000000000a1', 'b2000000-0000-4000-8000-0000000000a1', 'pgtap-nav', 'Nawigacja A'),
  ('b2000000-2222-4000-8000-0000000000a2', 'b2000000-0000-4000-8000-0000000000a1', 'pgtap-legacy', 'Stare menu A'),
  ('b2000000-2222-4000-8000-0000000000b1', 'b2000000-0000-4000-8000-0000000000b1', 'pgtap-nav', 'Nawigacja B');

-- Analizy → Specjalizacja (kategoria „energetyka", ma dziecko) → Ekonomia (liść).
INSERT INTO public.menu_items (id, menu_id, parent_id, position, item_type, ref_id, label_pl, href) VALUES
  ('b2000000-3333-4000-8000-000000000001', 'b2000000-2222-4000-8000-0000000000a1', NULL, 0,
   'custom', NULL, 'Analizy', '/analizy'),
  ('b2000000-3333-4000-8000-000000000002', 'b2000000-2222-4000-8000-0000000000a1',
   'b2000000-3333-4000-8000-000000000001', 0,
   'category', 'b2000000-1111-4000-8000-0000000000a2', 'Specjalizacja', '/category/energetyka'),
  ('b2000000-3333-4000-8000-000000000003', 'b2000000-2222-4000-8000-0000000000a1',
   'b2000000-3333-4000-8000-000000000002', 0,
   'category', 'b2000000-1111-4000-8000-0000000000a1', 'Ekonomia', '/category/ekonomia'),
  ('b2000000-3333-4000-8000-000000000004', 'b2000000-2222-4000-8000-0000000000a1', NULL, 1,
   'custom', NULL, 'Ekonomia (link)', '/category/ekonomia'),
  ('b2000000-3333-4000-8000-000000000005', 'b2000000-2222-4000-8000-0000000000a1', NULL, 2,
   'custom', NULL, 'Economy (EN)', '/en/category/ekonomia'),
  ('b2000000-3333-4000-8000-000000000006', 'b2000000-2222-4000-8000-0000000000a1', NULL, 3,
   'custom', NULL, 'Ekonomia (podstrona)', '/category/ekonomia/archiwum'),
  -- Ten sam slug w najemcy B - wyzwalacz kategorii A nie ma prawa go dotknąć.
  ('b2000000-3333-4000-8000-0000000000b1', 'b2000000-2222-4000-8000-0000000000b1', NULL, 0,
   'category', 'b2000000-1111-4000-8000-0000000000b1', 'Ekonomia B', '/category/ekonomia'),
  ('b2000000-3333-4000-8000-0000000000b2', 'b2000000-2222-4000-8000-0000000000b1', NULL, 1,
   'custom', NULL, 'Ekonomia B (link)', '/category/ekonomia');

-- ---------------------------------------------------------------------------
-- 0) Kształt
-- ---------------------------------------------------------------------------
SELECT has_trigger(
  'public', 'categories', 'categories_sync_menu_items',
  'categories ma wyzwalacz synchronizacji pozycji menu'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public._menu_items_prune_dead(uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._menu_items_prune_dead(uuid[])', 'EXECUTE'),
  '_menu_items_prune_dead: brak EXECUTE dla anon i authenticated'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public._menu_items_repair_category_links()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._menu_items_repair_category_links()', 'EXECUTE'),
  '_menu_items_repair_category_links: brak EXECUTE dla anon i authenticated'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public._pages_unpublish_test_content()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._pages_unpublish_test_content()', 'EXECUTE'),
  '_pages_unpublish_test_content: brak EXECUTE dla anon i authenticated'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public._event_seed_default_pages(uuid, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_seed_default_pages(uuid, uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._event_seed_default_pages(uuid, uuid)', 'EXECUTE'),
  '_event_seed_default_pages: uprawnienia jak w oryginale (tylko service_role)'
);

-- ---------------------------------------------------------------------------
-- 1) Zmiana slugu kategorii
-- ---------------------------------------------------------------------------
UPDATE public.categories SET slug = 'gospodarka'
 WHERE id = 'b2000000-1111-4000-8000-0000000000a1';

SELECT is(
  (SELECT href FROM public.menu_items WHERE id = 'b2000000-3333-4000-8000-000000000003'),
  '/category/gospodarka',
  'pozycja kategorii (po ref_id) dostaje nowy adres'
);
SELECT is(
  (SELECT href FROM public.menu_items WHERE id = 'b2000000-3333-4000-8000-000000000004'),
  '/category/gospodarka',
  'własny link z DOKŁADNIE starym adresem dostaje nowy adres'
);
SELECT is(
  (SELECT href FROM public.menu_items WHERE id = 'b2000000-3333-4000-8000-000000000005'),
  '/en/category/gospodarka',
  'własny link z prefiksem /en zachowuje prefiks'
);
SELECT is(
  (SELECT href FROM public.menu_items WHERE id = 'b2000000-3333-4000-8000-000000000006'),
  '/category/ekonomia/archiwum',
  'link, który tylko ZACZYNA SIĘ starym adresem, zostaje (to nie ten adres)'
);
SELECT is(
  (SELECT string_agg(href, ',' ORDER BY position) FROM public.menu_items
    WHERE menu_id = 'b2000000-2222-4000-8000-0000000000b1'),
  '/category/ekonomia,/category/ekonomia',
  'ten sam slug w INNYM najemcy zostaje nietknięty'
);

-- Zmiana innych pól niż slug nie przepisuje niczego.
UPDATE public.menu_items SET href = '/recznie' WHERE id = 'b2000000-3333-4000-8000-000000000004';
UPDATE public.categories SET name_pl = 'Gospodarka' WHERE id = 'b2000000-1111-4000-8000-0000000000a1';
SELECT is(
  (SELECT href FROM public.menu_items WHERE id = 'b2000000-3333-4000-8000-000000000004'),
  '/recznie',
  'zmiana nazwy kategorii (bez slugu) nie dotyka pozycji menu'
);
UPDATE public.menu_items SET href = '/category/gospodarka' WHERE id = 'b2000000-3333-4000-8000-000000000004';

-- ---------------------------------------------------------------------------
-- 2) Skasowanie kategorii
-- ---------------------------------------------------------------------------
DELETE FROM public.categories WHERE id = 'b2000000-1111-4000-8000-0000000000a2';

SELECT is(
  (SELECT item_type::text || '|' || coalesce(ref_id::text, 'null') || '|' || href || '|' || label_pl
     FROM public.menu_items WHERE id = 'b2000000-3333-4000-8000-000000000002'),
  'custom|null||Specjalizacja',
  'pozycja z dziećmi zostaje NAGŁÓWKIEM bez linku (etykieta zachowana)'
);
SELECT ok(
  EXISTS (SELECT 1 FROM public.menu_items WHERE id = 'b2000000-3333-4000-8000-000000000003'),
  'dziecko nagłówka (żywy link) przetrwało - brak kaskady'
);

DELETE FROM public.categories WHERE id = 'b2000000-1111-4000-8000-0000000000a1';

SELECT is(
  (SELECT count(*)::int FROM public.menu_items WHERE id IN (
     'b2000000-3333-4000-8000-000000000003',
     'b2000000-3333-4000-8000-000000000004',
     'b2000000-3333-4000-8000-000000000005')),
  0,
  'liście wskazujące skasowaną kategorię (ref_id, /category, /en/category) zniknęły'
);
SELECT ok(
  EXISTS (SELECT 1 FROM public.menu_items WHERE id = 'b2000000-3333-4000-8000-000000000002')
  AND EXISTS (SELECT 1 FROM public.menu_items WHERE id = 'b2000000-3333-4000-8000-000000000001'),
  'nagłówek i korzeń zostają (nagłówek nie wskazuje już niczego)'
);
SELECT is(
  (SELECT count(*)::int FROM public.menu_items WHERE menu_id = 'b2000000-2222-4000-8000-0000000000b1'),
  2,
  'skasowanie kategorii A nie dotyka menu najemcy B'
);

-- ---------------------------------------------------------------------------
-- 3) Naprawa danych zastanych
-- ---------------------------------------------------------------------------
-- Stan sprzed migracji: wstawiany z pominięciem wyzwalacza (kategorii nie
-- zmieniamy), czyli dokładnie to, co zostawiały stare ścieżki zapisu.
INSERT INTO public.menu_items (id, menu_id, parent_id, position, item_type, ref_id, label_pl, href) VALUES
  -- żywy ref, nieaktualny adres
  ('b2000000-4444-4000-8000-000000000001', 'b2000000-2222-4000-8000-0000000000a2', NULL, 0,
   'category', 'b2000000-1111-4000-8000-0000000000a3', 'Obronność', '/category/stary-slug'),
  -- martwy ref, żywy adres
  ('b2000000-4444-4000-8000-000000000002', 'b2000000-2222-4000-8000-0000000000a2', NULL, 1,
   'category', 'b2000000-9999-4000-8000-000000000001', 'Obronność 2', '/category/obronnosc'),
  -- martwy ref, martwy adres (przypadek /category/ekonomia z audytu)
  ('b2000000-4444-4000-8000-000000000003', 'b2000000-2222-4000-8000-0000000000a2', NULL, 2,
   'category', 'b2000000-9999-4000-8000-000000000002', 'Ekonomia', '/category/ekonomia'),
  -- ref do kategorii INNEGO najemcy (B ma `ekonomia`, A już nie)
  ('b2000000-4444-4000-8000-000000000004', 'b2000000-2222-4000-8000-0000000000a2', NULL, 3,
   'category', 'b2000000-1111-4000-8000-0000000000b1', 'Ekonomia B?', '/category/ekonomia'),
  -- własny link do nieistniejącej kategorii, z dzieckiem
  ('b2000000-4444-4000-8000-000000000005', 'b2000000-2222-4000-8000-0000000000a2', NULL, 4,
   'custom', NULL, 'Sekcja', '/category/nie-ma'),
  ('b2000000-4444-4000-8000-000000000006', 'b2000000-2222-4000-8000-0000000000a2',
   'b2000000-4444-4000-8000-000000000005', 0, 'custom', NULL, 'Blog', '/blog'),
  -- własny link do nieistniejącej kategorii, liść
  ('b2000000-4444-4000-8000-000000000007', 'b2000000-2222-4000-8000-0000000000a2', NULL, 5,
   'custom', NULL, 'Brak', '/category/brak'),
  -- własny link do istniejącej kategorii i zwykły link - bez zmian
  ('b2000000-4444-4000-8000-000000000008', 'b2000000-2222-4000-8000-0000000000a2', NULL, 6,
   'custom', NULL, 'Obronność (link)', '/category/obronnosc/'),
  ('b2000000-4444-4000-8000-000000000009', 'b2000000-2222-4000-8000-0000000000a2', NULL, 7,
   'custom', NULL, 'Kontakt', '/kontakt'),
  -- pozycja kategorii bez ref_id i bez adresu archiwum - nie jest „martwym linkiem"
  ('b2000000-4444-4000-8000-00000000000a', 'b2000000-2222-4000-8000-0000000000a2', NULL, 8,
   'category', NULL, 'Dziwna', '/blog');

SELECT cmp_ok(
  public._menu_items_repair_category_links(), '>=', 6,
  'naprawa zmienia co najmniej sześć pozycji (adres, dowiązanie, cztery martwe)'
);
SELECT is(
  (SELECT href FROM public.menu_items WHERE id = 'b2000000-4444-4000-8000-000000000001'),
  '/category/obronnosc',
  'żywy ref_id: pozycja dostaje bieżący adres kategorii'
);
SELECT is(
  (SELECT ref_id FROM public.menu_items WHERE id = 'b2000000-4444-4000-8000-000000000002'),
  'b2000000-1111-4000-8000-0000000000a3'::uuid,
  'martwy ref_id z żywym adresem: pozycja dowiązana do kategorii tego najemcy'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.menu_items WHERE id = 'b2000000-4444-4000-8000-000000000003'),
  'martwy ref_id i martwy adres (/category/ekonomia z audytu): pozycja usunięta'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.menu_items WHERE id = 'b2000000-4444-4000-8000-000000000004'),
  'ref_id kategorii INNEGO najemcy liczy się jako martwy - pozycja usunięta'
);
SELECT is(
  (SELECT item_type::text || '|' || href FROM public.menu_items WHERE id = 'b2000000-4444-4000-8000-000000000005'),
  'custom|',
  'martwy własny link z dzieckiem: nagłówek bez linku'
);
SELECT is(
  (SELECT parent_id FROM public.menu_items WHERE id = 'b2000000-4444-4000-8000-000000000006'),
  'b2000000-4444-4000-8000-000000000005'::uuid,
  'dziecko nagłówka zostaje na swoim miejscu'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.menu_items WHERE id = 'b2000000-4444-4000-8000-000000000007'),
  'martwy własny link (liść): pozycja usunięta'
);
SELECT is(
  (SELECT string_agg(href, ',' ORDER BY position) FROM public.menu_items
    WHERE id IN ('b2000000-4444-4000-8000-000000000008',
                 'b2000000-4444-4000-8000-000000000009',
                 'b2000000-4444-4000-8000-00000000000a')),
  '/category/obronnosc/,/kontakt,/blog',
  'żywe linki i pozycje bez adresu archiwum zostają nietknięte'
);
SELECT is(
  (SELECT string_agg(href, ',' ORDER BY position) FROM public.menu_items
    WHERE menu_id = 'b2000000-2222-4000-8000-0000000000b1'),
  '/category/ekonomia,/category/ekonomia',
  'naprawa nie rusza żywych linków najemcy B'
);
SELECT is(
  public._menu_items_repair_category_links(), 0,
  'naprawa jest idempotentna - drugi przebieg nie zmienia niczego'
);

-- ---------------------------------------------------------------------------
-- 4) Strony testowe: odpublikowanie
-- ---------------------------------------------------------------------------
INSERT INTO public.pages (id, tenant_id, parent_id, slug, status, publish_at, seo_noindex, deleted_at) VALUES
  ('b2000000-5555-4000-8000-000000000001', 'b2000000-0000-4000-8000-0000000000a1', NULL,
   'test', 'published', NULL, false, NULL),
  ('b2000000-5555-4000-8000-000000000002', 'b2000000-0000-4000-8000-0000000000a1',
   'b2000000-5555-4000-8000-000000000001', 'podstrona', 'published', NULL, false, NULL),
  ('b2000000-5555-4000-8000-000000000003', 'b2000000-0000-4000-8000-0000000000a1', NULL,
   'test-e2e-zakup', 'published', NULL, false, NULL),
  ('b2000000-5555-4000-8000-000000000004', 'b2000000-0000-4000-8000-0000000000a1', NULL,
   'e2e-kongres', 'scheduled', now() + interval '1 day', false, NULL),
  ('b2000000-5555-4000-8000-000000000005', 'b2000000-0000-4000-8000-0000000000a1', NULL,
   'o-nas', 'published', NULL, false, NULL),
  ('b2000000-5555-4000-8000-000000000006', 'b2000000-0000-4000-8000-0000000000a1',
   'b2000000-5555-4000-8000-000000000005', 'test_druk', 'draft', NULL, false, NULL),
  ('b2000000-5555-4000-8000-000000000007', 'b2000000-0000-4000-8000-0000000000a1', NULL,
   'testament', 'published', NULL, false, NULL),
  ('b2000000-5555-4000-8000-000000000008', 'b2000000-0000-4000-8000-0000000000a1', NULL,
   'testy-nato', 'published', NULL, false, NULL),
  ('b2000000-5555-4000-8000-000000000009', 'b2000000-0000-4000-8000-0000000000a1', NULL,
   'test-kosz', 'published', NULL, false, now()),
  ('b2000000-5555-4000-8000-0000000000b1', 'b2000000-0000-4000-8000-0000000000b1', NULL,
   'test-b', 'published', NULL, false, NULL);

SELECT cmp_ok(
  public._pages_unpublish_test_content(), '>=', 6,
  'odpublikowanie zmienia co najmniej sześć stron testowych'
);
SELECT is(
  (SELECT string_agg(slug || ':' || status::text || ':' || seo_noindex::text, ',' ORDER BY slug)
     FROM public.pages WHERE id IN (
       'b2000000-5555-4000-8000-000000000001',
       'b2000000-5555-4000-8000-000000000002',
       'b2000000-5555-4000-8000-000000000003')),
  'podstrona:draft:true,test:draft:true,test-e2e-zakup:draft:true',
  'strona testowa i jej POTOMEK (slug zwykły) są szkicem z noindex'
);
SELECT is(
  (SELECT status::text || ':' || seo_noindex::text || ':' || coalesce(publish_at::text, 'null')
     FROM public.pages WHERE id = 'b2000000-5555-4000-8000-000000000004'),
  'draft:true:null',
  'zaplanowana strona e2e-*: szkic, noindex, harmonogram wyczyszczony'
);
SELECT is(
  (SELECT status::text || ':' || seo_noindex::text
     FROM public.pages WHERE id = 'b2000000-5555-4000-8000-000000000006'),
  'draft:true',
  'szkic test_* pod zwykłym rodzicem dostaje noindex, status bez zmian'
);
SELECT is(
  (SELECT string_agg(slug || ':' || status::text || ':' || seo_noindex::text, ',' ORDER BY slug)
     FROM public.pages WHERE id IN (
       'b2000000-5555-4000-8000-000000000005',
       'b2000000-5555-4000-8000-000000000007',
       'b2000000-5555-4000-8000-000000000008')),
  'o-nas:published:false,testament:published:false,testy-nato:published:false',
  'prawdziwe słowa (testament, testy-nato) i rodzic strony testowej nietknięte'
);
SELECT is(
  (SELECT status::text FROM public.pages WHERE id = 'b2000000-5555-4000-8000-000000000009'),
  'published',
  'strona w koszu nietknięta'
);
SELECT is(
  (SELECT status::text || ':' || seo_noindex::text
     FROM public.pages WHERE id = 'b2000000-5555-4000-8000-0000000000b1'),
  'draft:true',
  'reguła obejmuje wszystkich najemców'
);
SELECT is(
  public._pages_unpublish_test_content(), 0,
  'odpublikowanie jest idempotentne'
);

-- ---------------------------------------------------------------------------
-- 5) Zasiew stron wydarzenia (wyzwalacz `events_seed_pages_on_publish`)
-- ---------------------------------------------------------------------------
INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status) VALUES
  ('b2000000-6666-4000-8000-000000000001', 'b2000000-0000-4000-8000-0000000000a1',
   'test-e2e-pgtap', 'Test e2e', 'Test e2e', now() + interval '7 days', 'published'),
  ('b2000000-6666-4000-8000-000000000002', 'b2000000-0000-4000-8000-0000000000a1',
   'kongres-pgtap', 'Kongres', 'Congress', now() + interval '7 days', 'published');

SELECT ok(
  (SELECT count(*) FROM public.event_pages WHERE event_id = 'b2000000-6666-4000-8000-000000000001') > 0,
  'wydarzenie testowe ma zasiane strony modułowe'
);
SELECT is(
  (SELECT count(*)::int FROM public.pages p
    WHERE p.id IN (
      SELECT ep.page_id FROM public.event_pages ep WHERE ep.event_id = 'b2000000-6666-4000-8000-000000000001'
      UNION
      SELECT e.root_page_id FROM public.events e WHERE e.id = 'b2000000-6666-4000-8000-000000000001'
    )
    AND (p.status <> 'published' OR NOT p.seo_noindex)),
  0,
  'wydarzenie testowe: korzeń i strony modułowe są published + seo_noindex'
);
SELECT ok(
  (SELECT seo_noindex FROM public.pages p
     JOIN public.events e ON e.root_page_id = p.id
    WHERE e.id = 'b2000000-6666-4000-8000-000000000001'),
  'korzeń wydarzenia testowego (slug z wydarzenia) ma noindex'
);
SELECT is(
  (SELECT count(*)::int FROM public.pages p
    WHERE p.id IN (
      SELECT ep.page_id FROM public.event_pages ep WHERE ep.event_id = 'b2000000-6666-4000-8000-000000000002'
      UNION
      SELECT e.root_page_id FROM public.events e WHERE e.id = 'b2000000-6666-4000-8000-000000000002'
    )
    AND p.status = 'published' AND NOT p.seo_noindex),
  (SELECT count(*)::int + 1 FROM public.event_pages WHERE event_id = 'b2000000-6666-4000-8000-000000000002'),
  'zwykłe wydarzenie: strony published i indeksowalne (bez zmian zachowania)'
);
SELECT ok(
  (SELECT count(*) FROM public.event_pages WHERE event_id = 'b2000000-6666-4000-8000-000000000002') > 0,
  'zwykłe wydarzenie też ma zasiane strony'
);

SELECT * FROM finish();
ROLLBACK;
