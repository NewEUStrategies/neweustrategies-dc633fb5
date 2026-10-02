-- pgTAP: drzewo pozycji menu zapisuje się albo w całości, albo wcale.
--
-- Weryfikuje migrację 20261002190000_save_menu_items_atomic.sql.
--
-- PO CO TO STOI. `saveMenuItems` zapisywało menu łańcuchem osobnych żądań
-- PostgREST: `DELETE` wszystkich pozycji, potem `INSERT` poziomami drzewa.
-- Każde żądanie to własna transakcja, więc błąd w połowie zostawiał menu
-- witryny PUSTE albo OBCIĘTE - publicznie, na każdej trasie z chrome, i bez
-- możliwości odtworzenia (stare pozycje były już skasowane).
--
-- CZEGO TEN TEST PILNUJE. Nie tego, że funkcja istnieje, tylko SKUTKU
-- przerwania w połowie: po nieudanym zapisie menu MUSI być dokładnie takie,
-- jak przed nim. Do tego reguły, które dotąd realizował BFS w TypeScripcie
-- (nowe UUID, rodzice z `parent_local_id`, sierota na najwyższym poziomie,
-- pierścień niezapisywany), bramka roli 1:1 z politykami `menu_items_staff_*`
-- i to, że menu innego tenanta jest dla funkcji nieadresowalne.
--
-- WYZWALACZE UŻYTKOWNIKA WYŁĄCZONE - konwencja tej suity: `on_auth_user_created`
-- woła `handle_new_user()`, który sam zakłada wiersz w `public.profiles`, więc
-- ręczne wstawienie profilu padłoby na kluczu głównym przed pierwszą asercją.
-- Klucz menu `pgtap-main` celowo nie jest `main`, żeby nie zderzyć się z menu
-- zakładanym dla tenantów przez inne migracje.

BEGIN;
SELECT plan(25);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('a1000000-0000-4000-8000-0000000000e1', 'menu-tenant-e', 'Menu Tenant E'),
  ('a1000000-0000-4000-8000-0000000000f1', 'menu-tenant-f', 'Menu Tenant F');

INSERT INTO auth.users (id, email) VALUES
  ('a1000000-1111-4000-8000-0000000000e1', 'admin@menu-e.test'),
  ('a1000000-1111-4000-8000-0000000000e2', 'editor@menu-e.test'),
  ('a1000000-1111-4000-8000-0000000000e3', 'reader@menu-e.test'),
  ('a1000000-1111-4000-8000-0000000000f1', 'admin@menu-f.test');

INSERT INTO public.profiles (id, tenant_id, email) VALUES
  ('a1000000-1111-4000-8000-0000000000e1', 'a1000000-0000-4000-8000-0000000000e1', 'admin@menu-e.test'),
  ('a1000000-1111-4000-8000-0000000000e2', 'a1000000-0000-4000-8000-0000000000e1', 'editor@menu-e.test'),
  ('a1000000-1111-4000-8000-0000000000e3', 'a1000000-0000-4000-8000-0000000000e1', 'reader@menu-e.test'),
  ('a1000000-1111-4000-8000-0000000000f1', 'a1000000-0000-4000-8000-0000000000f1', 'admin@menu-f.test');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('a1000000-1111-4000-8000-0000000000e1', 'admin',  'a1000000-0000-4000-8000-0000000000e1'),
  ('a1000000-1111-4000-8000-0000000000e2', 'editor', 'a1000000-0000-4000-8000-0000000000e1'),
  ('a1000000-1111-4000-8000-0000000000e3', 'user',   'a1000000-0000-4000-8000-0000000000e1'),
  ('a1000000-1111-4000-8000-0000000000f1', 'admin',  'a1000000-0000-4000-8000-0000000000f1');

-- Ten sam klucz w OBU tenantach (izolacja) plus menu istniejące tylko w E.
INSERT INTO public.menus (id, tenant_id, key, name) VALUES
  ('a1000000-2222-4000-8000-0000000000e1', 'a1000000-0000-4000-8000-0000000000e1', 'pgtap-main', 'Menu E'),
  ('a1000000-2222-4000-8000-0000000000e2', 'a1000000-0000-4000-8000-0000000000e1', 'pgtap-only-e', 'Tylko E'),
  ('a1000000-2222-4000-8000-0000000000f1', 'a1000000-0000-4000-8000-0000000000f1', 'pgtap-main', 'Menu F');

-- Stan wyjściowy menu E: stare drzewo, które zapis ma zastąpić w całości.
INSERT INTO public.menu_items (id, menu_id, parent_id, position, item_type, label_pl) VALUES
  ('a1000000-3333-4000-8000-000000000001', 'a1000000-2222-4000-8000-0000000000e1', NULL, 0, 'custom', 'Stare 1'),
  ('a1000000-3333-4000-8000-000000000002', 'a1000000-2222-4000-8000-0000000000e1',
   'a1000000-3333-4000-8000-000000000001', 0, 'custom', 'Stare 2'),
  ('a1000000-3333-4000-8000-000000000003', 'a1000000-2222-4000-8000-0000000000e2', NULL, 0, 'custom', 'Tylko E');

-- ---------------------------------------------------------------------------
-- 0) Kształt i uprawnienia funkcji.
-- ---------------------------------------------------------------------------
SELECT has_function(
  'public', 'save_menu_items', ARRAY['text', 'jsonb'],
  'save_menu_items(text, jsonb) istnieje - to ona niesie całe drzewo w jednej transakcji'
);
SELECT is_definer(
  'public', 'save_menu_items', ARRAY['text', 'jsonb'],
  'save_menu_items jest SECURITY DEFINER (bramka roli i tenanta w ciele funkcji)'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.save_menu_items(text, jsonb)', 'EXECUTE'),
  'anon NIE może wywołać save_menu_items'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.save_menu_items(text, jsonb)', 'EXECUTE'),
  'authenticated może wywołać save_menu_items (rola sprawdzana w ciele)'
);

-- ---------------------------------------------------------------------------
-- 1) Zapis drzewa przez admina E: hierarchia mapowana w bazie.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a1000000-1111-4000-8000-0000000000e1","role":"authenticated"}', true);

SELECT is(
  public.save_menu_items('pgtap-main', '[
    {"local_id":"root","parent_local_id":null,"position":0,"item_type":"custom","label_pl":"Korzeń","href":"/"},
    {"local_id":"kid","parent_local_id":"root","position":0,"item_type":"custom","label_pl":"Dziecko","visibility":"auth"},
    {"local_id":"grand","parent_local_id":"kid","position":1,"item_type":"custom","label_pl":"Wnuk"},
    {"local_id":"sierota","parent_local_id":"duch","position":1,"item_type":"custom","label_pl":"Sierota"}
  ]'::jsonb),
  4,
  'zapis drzewa zwraca liczbę zapisanych pozycji'
);

RESET ROLE;

SELECT is(
  (SELECT string_agg(label_pl, ',' ORDER BY label_pl) FROM public.menu_items
    WHERE menu_id = 'a1000000-2222-4000-8000-0000000000e1'),
  'Dziecko,Korzeń,Sierota,Wnuk',
  'stare pozycje zastąpione w całości nowym drzewem'
);
SELECT is(
  (SELECT p.label_pl FROM public.menu_items c
     JOIN public.menu_items p ON p.id = c.parent_id
    WHERE c.menu_id = 'a1000000-2222-4000-8000-0000000000e1' AND c.label_pl = 'Dziecko'),
  'Korzeń',
  'parent_local_id dziecka zmapowany na NOWE UUID korzenia'
);
SELECT is(
  (SELECT p.label_pl FROM public.menu_items c
     JOIN public.menu_items p ON p.id = c.parent_id
    WHERE c.menu_id = 'a1000000-2222-4000-8000-0000000000e1' AND c.label_pl = 'Wnuk'),
  'Dziecko',
  'trzeci poziom wskazuje drugi - hierarchia zachowana na każdej głębokości'
);
SELECT ok(
  (SELECT parent_id IS NULL FROM public.menu_items
    WHERE menu_id = 'a1000000-2222-4000-8000-0000000000e1' AND label_pl = 'Sierota'),
  'SIEROTA (rodzic spoza payloadu) ląduje na najwyższym poziomie'
);
SELECT is(
  (SELECT mi.visibility || '|' || mi.target || '|' || mi.position::text FROM public.menu_items mi
    WHERE mi.menu_id = 'a1000000-2222-4000-8000-0000000000e1' AND mi.label_pl = 'Dziecko'),
  'auth|_self|0',
  'pola pozycji przeniesione, brakujące dostają wartości domyślne tabeli'
);

-- ---------------------------------------------------------------------------
-- 2) SEDNO: błąd w POŁOWIE drzewa (CHECK widoczności na dziecku) wycofuje
--    także skasowanie starych pozycji. Stary przebieg zostawiał tu menu
--    z samym korzeniem albo puste.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$ SELECT public.save_menu_items('pgtap-main', '[
       {"local_id":"n-root","parent_local_id":null,"position":0,"item_type":"custom","label_pl":"Nowy"},
       {"local_id":"n-kid","parent_local_id":"n-root","position":0,"item_type":"custom","label_pl":"Zły","visibility":"wszyscy"}
     ]'::jsonb) $$,
  '23514',
  NULL,
  'naruszenie ograniczenia na dziecku przerywa zapis wyjątkiem'
);
SELECT throws_ok(
  $$ SELECT public.save_menu_items('pgtap-main', '[
       {"local_id":"n-root","parent_local_id":null,"position":0,"item_type":"custom","label_pl":"Nowy"},
       {"local_id":"n-kid","parent_local_id":"n-root","position":0,"item_type":"widget","label_pl":"Zły typ"}
     ]'::jsonb) $$,
  '22P02',
  NULL,
  'nieznany typ pozycji w połowie drzewa też przerywa zapis'
);

RESET ROLE;

SELECT is(
  (SELECT string_agg(label_pl, ',' ORDER BY label_pl) FROM public.menu_items
    WHERE menu_id = 'a1000000-2222-4000-8000-0000000000e1'),
  'Dziecko,Korzeń,Sierota,Wnuk',
  'po przerwanych zapisach menu jest BIT W BIT takie jak przed nimi'
);

-- ---------------------------------------------------------------------------
-- 3) Walidacja przed jakąkolwiek zmianą.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$ SELECT public.save_menu_items('pgtap-main', '[
       {"local_id":"x","parent_local_id":null,"position":0,"item_type":"custom","label_pl":"A"},
       {"local_id":"x","parent_local_id":null,"position":1,"item_type":"custom","label_pl":"B"}
     ]'::jsonb) $$,
  '22023',
  'invalid_payload: duplicate local_id',
  'zdublowane local_id odrzucone (stary kod łamał na nim klucz główny w połowie zapisu)'
);
SELECT throws_ok(
  $$ SELECT public.save_menu_items('pgtap-main',
       (SELECT jsonb_agg(jsonb_build_object(
          'local_id', 'k' || i, 'parent_local_id', NULL, 'position', 0,
          'item_type', 'custom', 'label_pl', 'X'))
        FROM generate_series(1, 501) AS i)) $$,
  '22023',
  'too_many_items',
  'partia większa niż sufit walidatora (500) jest odrzucana przez bazę'
);
SELECT throws_ok(
  $$ SELECT public.save_menu_items('pgtap-main', '{"local_id":"x"}'::jsonb) $$,
  '22023',
  'invalid_payload: items must be an array',
  'payload, który nie jest tablicą, jest odrzucany'
);

-- ---------------------------------------------------------------------------
-- 4) Bramka roli: zwykłe konto tenanta E nie zapisuje, nawet pustego menu.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"a1000000-1111-4000-8000-0000000000e3","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT public.save_menu_items('pgtap-main', '[]'::jsonb) $$,
  '42501',
  'forbidden: staff role required',
  'konto bez roli admin/editor dostaje 42501'
);

-- ---------------------------------------------------------------------------
-- 5) Izolacja tenantów: admin F pod TYM SAMYM kluczem pisze wyłącznie do F,
--    a menu istniejące tylko w E jest dla niego nieadresowalne.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"a1000000-1111-4000-8000-0000000000f1","role":"authenticated"}', true);

SELECT is(
  public.save_menu_items('pgtap-main', '[
    {"local_id":"f","parent_local_id":null,"position":0,"item_type":"custom","label_pl":"Pozycja F"}
  ]'::jsonb),
  1,
  'admin F zapisuje menu swojego tenanta'
);
SELECT throws_ok(
  $$ SELECT public.save_menu_items('pgtap-only-e', '[]'::jsonb) $$,
  'P0002',
  'menu_not_found',
  'menu istniejące wyłącznie w tenancie E nie istnieje dla admina F'
);

RESET ROLE;

SELECT is(
  (SELECT string_agg(label_pl, ',' ORDER BY label_pl) FROM public.menu_items
    WHERE menu_id = 'a1000000-2222-4000-8000-0000000000e1'),
  'Dziecko,Korzeń,Sierota,Wnuk',
  'zapis admina F nie ruszył menu E o tym samym kluczu ani nie zostało skasowane przez odmowę konta bez roli'
);
SELECT is(
  (SELECT string_agg(label_pl, ',') FROM public.menu_items
    WHERE menu_id = 'a1000000-2222-4000-8000-0000000000f1'),
  'Pozycja F',
  'zapis admina F wylądował w menu F, nie w menu E o tym samym kluczu'
);
SELECT is(
  (SELECT string_agg(label_pl, ',') FROM public.menu_items
    WHERE menu_id = 'a1000000-2222-4000-8000-0000000000e2'),
  'Tylko E',
  'pozycja menu tylko-E przeżyła próbę zapisu z obcego tenanta'
);

-- ---------------------------------------------------------------------------
-- 6) Pierścień rodziców nie jest osiągalny z korzenia - nie jest zapisywany
--    (tak robił BFS; edytor i SiteMenu i tak go nie pokazują), a reszta tak.
--    Na koniec redaktor E (rola editor) czyści menu - bramka wpuszcza obie
--    role redakcji.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a1000000-1111-4000-8000-0000000000e2","role":"authenticated"}', true);

SELECT is(
  public.save_menu_items('pgtap-main', '[
    {"local_id":"r","parent_local_id":null,"position":0,"item_type":"custom","label_pl":"Korzeń 2"},
    {"local_id":"a","parent_local_id":"b","position":0,"item_type":"custom","label_pl":"Pierścień A"},
    {"local_id":"b","parent_local_id":"a","position":0,"item_type":"custom","label_pl":"Pierścień B"},
    {"local_id":"s","parent_local_id":"s","position":1,"item_type":"custom","label_pl":"Sam sobie"}
  ]'::jsonb),
  1,
  'redaktor zapisuje; pozycje w pierścieniu (także rodzic samego siebie) są pomijane'
);
SELECT is(
  public.save_menu_items('pgtap-main', '[]'::jsonb),
  0,
  'pusty payload czyści menu w tej samej transakcji'
);

RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.menu_items
    WHERE menu_id = 'a1000000-2222-4000-8000-0000000000e1'),
  0,
  'po wyczyszczeniu menu E nie ma pozycji'
);

SELECT * FROM finish();
ROLLBACK;
