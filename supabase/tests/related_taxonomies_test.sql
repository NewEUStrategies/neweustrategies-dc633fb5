-- pgTAP: „Powiązane kategorie / tagi" archiwum liczone ze współwystępowania.
--
-- Weryfikuje migrację 20261003100200_related_taxonomies.sql.
--
-- PO CO TO STOI. Sekcja pod listą archiwum i widżet sidebara brały DOWOLNE
-- inne terminy (`.neq("id", ...).limit(12)` bez `ORDER BY`), czyli pierwsze
-- wiersze sterty - ten sam szum pod każdym archiwum. Funkcja zastępuje to
-- rankingiem z opublikowanych wpisów, które termin dzieli z kandydatem.
--
-- CZEGO TEN TEST PILNUJE. Nie tego, że funkcja „coś zwraca", tylko że zwraca
-- to, co trzeba, w tej kolejności, w jakiej trzeba:
--   1. NORMALIZACJA KOSINUSEM MA ZNACZENIE: „Hub" dzieli z „Energetyką" WIĘCEJ
--      wpisów (3) niż „Klimat" (2), ale jest dziesięć razy większy, więc ląduje
--      NIŻEJ. Ranking po surowym `shared` odwróciłby tę kolejność - fikstura
--      jest zbudowana tak, żeby to rozstrzygało;
--   2. remisy: równy wynik -> więcej wspólnych wpisów wyżej, potem nazwa -
--      także dla remisu, którego float8 NIE reprezentuje dokładnie
--      (1/sqrt(6*1) = 3/sqrt(6*9)): wynik ma być bitowo równy, inaczej ORDER BY
--      sortuje po szumie zaokrągleń i do `shared_posts` nigdy nie dochodzi;
--   3. szkic i wpis miękko usunięty nie liczą się ANI jako wspólny wpis, ANI
--      w rozmiarze terminu (dokładne wartości `score` by to wychwyciły);
--   4. obcy najemca nie wchodzi niczym: ani terminem podpiętym pod nasz wpis,
--      ani własnym wpisem podpiętym pod nasze terminy; host najemcy B nie
--      widzi terminów najemcy A;
--      punkty 3 i 4 sprawdzane OSOBNO dla kategorii i dla tagów. Migracja
--      celowo dubluje filtry w dwóch gałęziach (`cat_*` / `tag_*`), więc każdy
--      predykat ma własną fiksturę, która go rozstrzyga: szkic, wpis usunięty
--      i wpis najemcy B niosą te same tagi co kotwica, ścisły i hub, a tag
--      najemcy B wisi na naszym wpisie - zgubiony warunek w gałęzi tagów
--      zmienia dokładny `score` albo wpuszcza obcy tag (sprawdzone mutacjami
--      pojedynczych linii);
--   5. wymiar `categories.kind`: region nie jest „powiązaną kategorią" tematu;
--   6. kontrakt wejścia: nieznany `_kind` / NULL -> pusto, `_limit` 1..24;
--   7. anonim i zalogowany redaktor (który przez RLS widzi szkice) dostają
--      TEN SAM publiczny wynik.
--
-- Wyzwalacze użytkownika na `auth.users` wyłączone - konwencja suity
-- (`handle_new_user()` sam zakłada profil, ręczny INSERT padłby na kluczu).

BEGIN;
SELECT plan(37);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Najemcy, strona, redaktor ──────────────────────────────────────────────
UPDATE public.tenants SET domain = 'nes.example' WHERE slug = 'nes';

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('e1b00000-0000-4000-8000-0000000000b1', 'rel-b', 'Related Tenant B', 'rel-b.example');

INSERT INTO public.pages (id, tenant_id, slug) VALUES
  ('e1a00000-9999-4000-8000-00000000000a', (SELECT id FROM public.tenants WHERE slug = 'nes'), 'rel-a-home'),
  ('e1b00000-9999-4000-8000-00000000000b', 'e1b00000-0000-4000-8000-0000000000b1', 'rel-b-home');

INSERT INTO auth.users (id, email) VALUES
  ('e1a00000-1111-4000-8000-0000000000e1', 'editor@rel-a.test');
INSERT INTO public.profiles (id, tenant_id, email) VALUES
  ('e1a00000-1111-4000-8000-0000000000e1', (SELECT id FROM public.tenants WHERE slug = 'nes'), 'editor@rel-a.test');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('e1a00000-1111-4000-8000-0000000000e1', 'editor', (SELECT id FROM public.tenants WHERE slug = 'nes'));

-- ── Kategorie ──────────────────────────────────────────────────────────────
-- Najemca A: kotwica E, kandydaci K/M/F/G/H, wykluczeni D/S/R, kotwica „many"
-- z 30 kandydatami do testu limitu, kotwica „remis" z dwoma kandydatami
-- o równym, niereprezentowalnym kosinusie. Najemca B: X (podpięta pod wpis A),
-- BX (kotwica na hoście B) i BP (jej partner).
INSERT INTO public.categories (id, tenant_id, slug, name_pl, name_en, kind) VALUES
  ('e1a00000-2222-4000-8000-000000000001', (SELECT id FROM public.tenants WHERE slug = 'nes'), 'rel-energetyka', 'Energetyka', 'Energy', 'category'),
  ('e1a00000-2222-4000-8000-000000000002', (SELECT id FROM public.tenants WHERE slug = 'nes'), 'rel-klimat', 'Klimat', 'Climate', 'category'),
  ('e1a00000-2222-4000-8000-000000000003', (SELECT id FROM public.tenants WHERE slug = 'nes'), 'rel-migracje', 'Migracje', 'Migration', 'category'),
  ('e1a00000-2222-4000-8000-000000000004', (SELECT id FROM public.tenants WHERE slug = 'nes'), 'rel-finanse', 'Finanse', 'Finance', 'category'),
  ('e1a00000-2222-4000-8000-000000000005', (SELECT id FROM public.tenants WHERE slug = 'nes'), 'rel-gospodarka', 'Gospodarka', 'Economy', 'category'),
  ('e1a00000-2222-4000-8000-000000000006', (SELECT id FROM public.tenants WHERE slug = 'nes'), 'rel-hub', 'Hub', 'Hub', 'category'),
  ('e1a00000-2222-4000-8000-000000000007', (SELECT id FROM public.tenants WHERE slug = 'nes'), 'rel-szkic', 'Tylko szkic', 'Draft only', 'category'),
  ('e1a00000-2222-4000-8000-000000000008', (SELECT id FROM public.tenants WHERE slug = 'nes'), 'rel-usuniety', 'Tylko usunięty', 'Deleted only', 'category'),
  ('e1a00000-2222-4000-8000-000000000009', (SELECT id FROM public.tenants WHERE slug = 'nes'), 'rel-region', 'Region', 'Region', 'region'),
  ('e1a00000-2222-4000-8000-000000000010', (SELECT id FROM public.tenants WHERE slug = 'nes'), 'rel-many', 'Wiele', 'Many', 'category'),
  ('e1a00000-2222-4000-8000-000000000011', (SELECT id FROM public.tenants WHERE slug = 'nes'), 'rel-remis', 'Remis', 'Tie', 'category'),
  ('e1a00000-2222-4000-8000-000000000012', (SELECT id FROM public.tenants WHERE slug = 'nes'), 'rel-remis-a', 'Aaa remis', 'Aaa tie', 'category'),
  ('e1a00000-2222-4000-8000-000000000013', (SELECT id FROM public.tenants WHERE slug = 'nes'), 'rel-remis-b', 'Bbb remis', 'Bbb tie', 'category'),
  ('e1b00000-2222-4000-8000-000000000001', 'e1b00000-0000-4000-8000-0000000000b1', 'rel-b-obca', 'Obca', 'Foreign', 'category'),
  ('e1b00000-2222-4000-8000-000000000002', 'e1b00000-0000-4000-8000-0000000000b1', 'rel-b-kotwica', 'Kotwica B', 'Anchor B', 'category'),
  ('e1b00000-2222-4000-8000-000000000003', 'e1b00000-0000-4000-8000-0000000000b1', 'rel-b-partner', 'Partner B', 'Partner B', 'category');

INSERT INTO public.categories (id, tenant_id, slug, name_pl, name_en)
SELECT ('e1a00000-2223-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
       (SELECT id FROM public.tenants WHERE slug = 'nes'),
       'rel-many-' || lpad(g::text, 2, '0'), 'Wiele ' || lpad(g::text, 2, '0'), 'Many ' || lpad(g::text, 2, '0')
  FROM generate_series(1, 30) AS g;

-- ── Tagi ───────────────────────────────────────────────────────────────────
INSERT INTO public.tags (id, tenant_id, slug, name) VALUES
  ('e1a00000-3333-4000-8000-000000000001', (SELECT id FROM public.tenants WHERE slug = 'nes'), 'rel-tag-kotwica', 'Kotwica'),
  ('e1a00000-3333-4000-8000-000000000002', (SELECT id FROM public.tenants WHERE slug = 'nes'), 'rel-tag-hub', 'NATO'),
  ('e1a00000-3333-4000-8000-000000000003', (SELECT id FROM public.tenants WHERE slug = 'nes'), 'rel-tag-tight', 'Bałtyk'),
  ('e1a00000-3333-4000-8000-000000000004', (SELECT id FROM public.tenants WHERE slug = 'nes'), 'rel-tag-szkic', 'Szkic'),
  -- najemca B: tag podpięty pod wpis A (i kotwica na hoście B) oraz jego partner
  ('e1b00000-3333-4000-8000-000000000001', 'e1b00000-0000-4000-8000-0000000000b1', 'rel-b-tag', 'Obcy tag'),
  ('e1b00000-3333-4000-8000-000000000002', 'e1b00000-0000-4000-8000-0000000000b1', 'rel-b-tag-partner', 'Partner B');

-- ── Wpisy ──────────────────────────────────────────────────────────────────
-- p1..p4: opublikowane wpisy „Energetyki" (n_E = 4). draft / deleted: dzielą
-- termin z E, ale nie mogą się liczyć. m1-m2, h01-h17: rozmiar Migracji i Huba.
-- b1: wpis najemcy B podpięty pod terminy A. b2: dorobek hosta B.
INSERT INTO public.posts (id, slug, status, tenant_id, parent_page_id, title_pl, deleted_at) VALUES
  ('e1a00000-4444-4000-8000-000000000001', 'rel-p1', 'published', (SELECT id FROM public.tenants WHERE slug = 'nes'), 'e1a00000-9999-4000-8000-00000000000a', 'P1', NULL),
  ('e1a00000-4444-4000-8000-000000000002', 'rel-p2', 'published', (SELECT id FROM public.tenants WHERE slug = 'nes'), 'e1a00000-9999-4000-8000-00000000000a', 'P2', NULL),
  ('e1a00000-4444-4000-8000-000000000003', 'rel-p3', 'published', (SELECT id FROM public.tenants WHERE slug = 'nes'), 'e1a00000-9999-4000-8000-00000000000a', 'P3', NULL),
  ('e1a00000-4444-4000-8000-000000000004', 'rel-p4', 'published', (SELECT id FROM public.tenants WHERE slug = 'nes'), 'e1a00000-9999-4000-8000-00000000000a', 'P4', NULL),
  ('e1a00000-4444-4000-8000-000000000005', 'rel-draft', 'draft', (SELECT id FROM public.tenants WHERE slug = 'nes'), 'e1a00000-9999-4000-8000-00000000000a', 'Szkic', NULL),
  ('e1a00000-4444-4000-8000-000000000006', 'rel-deleted', 'published', (SELECT id FROM public.tenants WHERE slug = 'nes'), 'e1a00000-9999-4000-8000-00000000000a', 'Usunięty', now()),
  ('e1a00000-4444-4000-8000-000000000007', 'rel-m1', 'published', (SELECT id FROM public.tenants WHERE slug = 'nes'), 'e1a00000-9999-4000-8000-00000000000a', 'M1', NULL),
  ('e1a00000-4444-4000-8000-000000000008', 'rel-m2', 'published', (SELECT id FROM public.tenants WHERE slug = 'nes'), 'e1a00000-9999-4000-8000-00000000000a', 'M2', NULL),
  ('e1a00000-4444-4000-8000-000000000009', 'rel-many-post', 'published', (SELECT id FROM public.tenants WHERE slug = 'nes'), 'e1a00000-9999-4000-8000-00000000000a', 'Many', NULL),
  ('e1b00000-4444-4000-8000-000000000001', 'rel-b1', 'published', 'e1b00000-0000-4000-8000-0000000000b1', 'e1b00000-9999-4000-8000-00000000000b', 'B1', NULL),
  ('e1b00000-4444-4000-8000-000000000002', 'rel-b2', 'published', 'e1b00000-0000-4000-8000-0000000000b1', 'e1b00000-9999-4000-8000-00000000000b', 'B2', NULL);

INSERT INTO public.posts (id, slug, status, tenant_id, parent_page_id, title_pl)
SELECT ('e1a00000-4445-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'rel-h' || lpad(g::text, 2, '0'),
       'published', (SELECT id FROM public.tenants WHERE slug = 'nes'),
       'e1a00000-9999-4000-8000-00000000000a', 'H' || g
  FROM generate_series(1, 17) AS g;

-- t1..t6: wpisy kotwicy „remis" (n = 6); u1..u6: dorobek „Bbb remis" poza nią.
INSERT INTO public.posts (id, slug, status, tenant_id, parent_page_id, title_pl)
SELECT ('e1a00000-4446-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'rel-t' || g,
       'published', (SELECT id FROM public.tenants WHERE slug = 'nes'),
       'e1a00000-9999-4000-8000-00000000000a', 'T' || g
  FROM generate_series(1, 6) AS g;
INSERT INTO public.posts (id, slug, status, tenant_id, parent_page_id, title_pl)
SELECT ('e1a00000-4447-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'rel-u' || g,
       'published', (SELECT id FROM public.tenants WHERE slug = 'nes'),
       'e1a00000-9999-4000-8000-00000000000a', 'U' || g
  FROM generate_series(1, 6) AS g;

INSERT INTO public.post_categories (post_id, category_id) VALUES
  -- p1: E, Hub, Klimat, Migracje, region, obca kategoria najemcy B
  ('e1a00000-4444-4000-8000-000000000001', 'e1a00000-2222-4000-8000-000000000001'),
  ('e1a00000-4444-4000-8000-000000000001', 'e1a00000-2222-4000-8000-000000000006'),
  ('e1a00000-4444-4000-8000-000000000001', 'e1a00000-2222-4000-8000-000000000002'),
  ('e1a00000-4444-4000-8000-000000000001', 'e1a00000-2222-4000-8000-000000000003'),
  ('e1a00000-4444-4000-8000-000000000001', 'e1a00000-2222-4000-8000-000000000009'),
  ('e1a00000-4444-4000-8000-000000000001', 'e1b00000-2222-4000-8000-000000000001'),
  -- p2: E, Hub, Klimat, Migracje
  ('e1a00000-4444-4000-8000-000000000002', 'e1a00000-2222-4000-8000-000000000001'),
  ('e1a00000-4444-4000-8000-000000000002', 'e1a00000-2222-4000-8000-000000000006'),
  ('e1a00000-4444-4000-8000-000000000002', 'e1a00000-2222-4000-8000-000000000002'),
  ('e1a00000-4444-4000-8000-000000000002', 'e1a00000-2222-4000-8000-000000000003'),
  -- p3: E, Hub
  ('e1a00000-4444-4000-8000-000000000003', 'e1a00000-2222-4000-8000-000000000001'),
  ('e1a00000-4444-4000-8000-000000000003', 'e1a00000-2222-4000-8000-000000000006'),
  -- p4: E, Finanse, Gospodarka
  ('e1a00000-4444-4000-8000-000000000004', 'e1a00000-2222-4000-8000-000000000001'),
  ('e1a00000-4444-4000-8000-000000000004', 'e1a00000-2222-4000-8000-000000000004'),
  ('e1a00000-4444-4000-8000-000000000004', 'e1a00000-2222-4000-8000-000000000005'),
  -- szkic: E, „Tylko szkic", Klimat (zawyżyłby n_E, shared i n_K)
  ('e1a00000-4444-4000-8000-000000000005', 'e1a00000-2222-4000-8000-000000000001'),
  ('e1a00000-4444-4000-8000-000000000005', 'e1a00000-2222-4000-8000-000000000007'),
  ('e1a00000-4444-4000-8000-000000000005', 'e1a00000-2222-4000-8000-000000000002'),
  -- miękko usunięty: E, „Tylko usunięty", Klimat (zawyżyłby n_E, shared i n_K)
  ('e1a00000-4444-4000-8000-000000000006', 'e1a00000-2222-4000-8000-000000000001'),
  ('e1a00000-4444-4000-8000-000000000006', 'e1a00000-2222-4000-8000-000000000008'),
  ('e1a00000-4444-4000-8000-000000000006', 'e1a00000-2222-4000-8000-000000000002'),
  -- m1, m2: tylko Migracje (n_M = 4)
  ('e1a00000-4444-4000-8000-000000000007', 'e1a00000-2222-4000-8000-000000000003'),
  ('e1a00000-4444-4000-8000-000000000008', 'e1a00000-2222-4000-8000-000000000003'),
  -- b1 (najemca B): E i Hub - wiersz pivotu przez granicę najemców
  ('e1b00000-4444-4000-8000-000000000001', 'e1a00000-2222-4000-8000-000000000001'),
  ('e1b00000-4444-4000-8000-000000000001', 'e1a00000-2222-4000-8000-000000000006'),
  -- b2 (najemca B): kotwica B i partner B
  ('e1b00000-4444-4000-8000-000000000002', 'e1b00000-2222-4000-8000-000000000002'),
  ('e1b00000-4444-4000-8000-000000000002', 'e1b00000-2222-4000-8000-000000000003'),
  -- wpis „many": kotwica z jednym wpisem
  ('e1a00000-4444-4000-8000-000000000009', 'e1a00000-2222-4000-8000-000000000010');

-- h01..h17: tylko Hub (n_H = 3 + 17 = 20)
INSERT INTO public.post_categories (post_id, category_id)
SELECT ('e1a00000-4445-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'e1a00000-2222-4000-8000-000000000006'::uuid
  FROM generate_series(1, 17) AS g;

-- wpis „many" dzieli się z 30 kategoriami (30 kandydatów o wyniku 1.0)
INSERT INTO public.post_categories (post_id, category_id)
SELECT 'e1a00000-4444-4000-8000-000000000009'::uuid, ('e1a00000-2223-4000-8000-' || lpad(g::text, 12, '0'))::uuid
  FROM generate_series(1, 30) AS g;

-- „remis": kotwica na t1..t6; „Aaa remis" tylko na t1 (1 / sqrt(6 * 1));
-- „Bbb remis" na t2..t4 i u1..u6 (3 / sqrt(6 * 9)) - ten sam kosinus 1/sqrt(6),
-- którego float8 nie zapisuje dokładnie. Nazwa stawia „Aaa" pierwszą, więc
-- „Bbb" wyżej dowodzi, że remis rozstrzygnął `shared_posts`.
INSERT INTO public.post_categories (post_id, category_id)
SELECT ('e1a00000-4446-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'e1a00000-2222-4000-8000-000000000011'::uuid
  FROM generate_series(1, 6) AS g;
INSERT INTO public.post_categories (post_id, category_id) VALUES
  ('e1a00000-4446-4000-8000-000000000001', 'e1a00000-2222-4000-8000-000000000012');
INSERT INTO public.post_categories (post_id, category_id)
SELECT ('e1a00000-4446-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'e1a00000-2222-4000-8000-000000000013'::uuid
  FROM generate_series(2, 4) AS g
UNION ALL
SELECT ('e1a00000-4447-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'e1a00000-2222-4000-8000-000000000013'::uuid
  FROM generate_series(1, 6) AS g;

-- Gałąź tagów ma WŁASNE kopie filtrów, więc fikstura jest lustrem kategorii:
-- szkic, wpis usunięty i wpis b1 najemcy B niosą kotwicę, ścisły i hub
-- naraz. Każdy z nich, wpuszczony przez zgubiony warunek, zmienia n_kotwicy,
-- shared albo n_kandydata - a to łapią dokładne wyniki poniżej.
INSERT INTO public.post_tags (post_id, tag_id) VALUES
  -- kotwica tagów: p1, p2 (n = 2; szkic, usunięty i b1 nie mogą się liczyć)
  ('e1a00000-4444-4000-8000-000000000001', 'e1a00000-3333-4000-8000-000000000001'),
  ('e1a00000-4444-4000-8000-000000000002', 'e1a00000-3333-4000-8000-000000000001'),
  ('e1a00000-4444-4000-8000-000000000005', 'e1a00000-3333-4000-8000-000000000001'),
  ('e1a00000-4444-4000-8000-000000000006', 'e1a00000-3333-4000-8000-000000000001'),
  ('e1b00000-4444-4000-8000-000000000001', 'e1a00000-3333-4000-8000-000000000001'),
  -- hub tagów: p1, p2, h01..h17 (n = 19, h dopisane niżej) + szkic, usunięty, b1
  ('e1a00000-4444-4000-8000-000000000001', 'e1a00000-3333-4000-8000-000000000002'),
  ('e1a00000-4444-4000-8000-000000000002', 'e1a00000-3333-4000-8000-000000000002'),
  ('e1a00000-4444-4000-8000-000000000005', 'e1a00000-3333-4000-8000-000000000002'),
  ('e1a00000-4444-4000-8000-000000000006', 'e1a00000-3333-4000-8000-000000000002'),
  ('e1b00000-4444-4000-8000-000000000001', 'e1a00000-3333-4000-8000-000000000002'),
  -- ścisły: p1 (n = 1) + szkic, usunięty, b1
  ('e1a00000-4444-4000-8000-000000000001', 'e1a00000-3333-4000-8000-000000000003'),
  ('e1a00000-4444-4000-8000-000000000005', 'e1a00000-3333-4000-8000-000000000003'),
  ('e1a00000-4444-4000-8000-000000000006', 'e1a00000-3333-4000-8000-000000000003'),
  ('e1b00000-4444-4000-8000-000000000001', 'e1a00000-3333-4000-8000-000000000003'),
  -- tylko szkic
  ('e1a00000-4444-4000-8000-000000000005', 'e1a00000-3333-4000-8000-000000000004'),
  -- tag najemcy B: na NASZYM wpisie p1 (przez granicę najemców) i na b1;
  -- partner B tylko na b1 (jedyny poprawny wynik na hoście B)
  ('e1a00000-4444-4000-8000-000000000001', 'e1b00000-3333-4000-8000-000000000001'),
  ('e1b00000-4444-4000-8000-000000000001', 'e1b00000-3333-4000-8000-000000000001'),
  ('e1b00000-4444-4000-8000-000000000001', 'e1b00000-3333-4000-8000-000000000002');

INSERT INTO public.post_tags (post_id, tag_id)
SELECT ('e1a00000-4445-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'e1a00000-3333-4000-8000-000000000002'::uuid
  FROM generate_series(1, 17) AS g;

-- ---------------------------------------------------------------------------
-- 0) Kształt, konfiguracja i uprawnienia funkcji.
-- ---------------------------------------------------------------------------
SELECT has_function(
  'public', 'related_taxonomies', ARRAY['text', 'uuid', 'integer'],
  'related_taxonomies(text, uuid, integer) istnieje'
);
SELECT is_definer(
  'public', 'related_taxonomies', ARRAY['text', 'uuid', 'integer'],
  'related_taxonomies jest SECURITY DEFINER (RLS liczy public_tenant_id per wiersz)'
);
SELECT is(
  (SELECT proconfig FROM pg_proc
    WHERE oid = 'public.related_taxonomies(text, uuid, integer)'::regprocedure),
  ARRAY['search_path=public, pg_temp', 'jit=off'],
  'search_path przypięty, JIT wyłączony (kompilacja kosztowała więcej niż zapytanie)'
);
SELECT ok(
  has_function_privilege('anon', 'public.related_taxonomies(text, uuid, integer)', 'EXECUTE'),
  'anon wykonuje related_taxonomies (publiczne archiwum)'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.related_taxonomies(text, uuid, integer)', 'EXECUTE'),
  'authenticated wykonuje related_taxonomies'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
     WHERE p.oid = 'public.related_taxonomies(text, uuid, integer)'::regprocedure
       AND a.grantee = 0
  ),
  'PUBLIC nie ma EXECUTE - granty wyłącznie jawne'
);

-- ---------------------------------------------------------------------------
-- 1) Ranking kategorii na hoście najemcy A, jako anonim.
-- ---------------------------------------------------------------------------
SELECT set_config('request.headers', '{"x-tenant-host":"nes.example"}', true);
SET LOCAL ROLE anon;

SELECT is(
  (SELECT array_agg(r.slug ORDER BY r.ord)
     FROM public.related_taxonomies('category', 'e1a00000-2222-4000-8000-000000000001', 12)
          WITH ORDINALITY AS r(id, slug, name_pl, name_en, shared_posts, score, ord)),
  ARRAY['rel-klimat', 'rel-migracje', 'rel-finanse', 'rel-gospodarka', 'rel-hub'],
  'kolejność: kosinus malejąco, remis -> więcej wspólnych wpisów, potem nazwa'
);
SELECT ok(
  (SELECT h.shared_posts > k.shared_posts AND h.score < k.score
     FROM public.related_taxonomies('category', 'e1a00000-2222-4000-8000-000000000001', 12) h,
          public.related_taxonomies('category', 'e1a00000-2222-4000-8000-000000000001', 12) k
    WHERE h.slug = 'rel-hub' AND k.slug = 'rel-klimat'),
  'NORMALIZACJA: hub dzieli więcej wpisów niż Klimat, a mimo to jest niżej'
);
SELECT is(
  (SELECT round(score::numeric, 9) || '|' || shared_posts
     FROM public.related_taxonomies('category', 'e1a00000-2222-4000-8000-000000000001', 12)
    WHERE slug = 'rel-klimat'),
  round((2 / sqrt(4 * 2)::double precision)::numeric, 9) || '|2',
  'Klimat: 2 / sqrt(4 * 2) - szkic ani wpis usunięty nie zawyżają ani n_E, ani shared, ani n_K'
);
SELECT is(
  (SELECT round(score::numeric, 9) || '|' || shared_posts
     FROM public.related_taxonomies('category', 'e1a00000-2222-4000-8000-000000000001', 12)
    WHERE slug = 'rel-hub'),
  round((3 / sqrt(4 * 20)::double precision)::numeric, 9) || '|3',
  'Hub: 3 / sqrt(4 * 20) - wpis najemcy B podpięty pod E i Hub nie liczy się nigdzie'
);
SELECT is(
  (SELECT array_agg(r.score ORDER BY r.ord)
     FROM public.related_taxonomies('category', 'e1a00000-2222-4000-8000-000000000001', 12)
          WITH ORDINALITY AS r(id, slug, name_pl, name_en, shared_posts, score, ord)
    WHERE r.slug IN ('rel-migracje', 'rel-finanse', 'rel-gospodarka')),
  ARRAY[0.5, 0.5, 0.5]::double precision[],
  'remis wyniku 0.5 (2/sqrt(16) i 1/sqrt(4)) - rozstrzyga shared, potem nazwa'
);
SELECT is(
  (SELECT array_agg(r.slug ORDER BY r.ord)
     FROM public.related_taxonomies('category', 'e1a00000-2222-4000-8000-000000000011', 12)
          WITH ORDINALITY AS r(id, slug, name_pl, name_en, shared_posts, score, ord)),
  ARRAY['rel-remis-b', 'rel-remis-a'],
  'remis niereprezentowalny w float8 (1/sqrt(6*1) = 3/sqrt(6*9)): wyżej więcej wspólnych wpisów, wbrew nazwie'
);
SELECT ok(
  (SELECT a.score = b.score
     FROM public.related_taxonomies('category', 'e1a00000-2222-4000-8000-000000000011', 12) a,
          public.related_taxonomies('category', 'e1a00000-2222-4000-8000-000000000011', 12) b
    WHERE a.slug = 'rel-remis-a' AND b.slug = 'rel-remis-b'),
  'równe kosinusy dają BITOWO równy score - ORDER BY nie sortuje po szumie zaokrągleń'
);
SELECT is(
  (SELECT count(*)::int
     FROM public.related_taxonomies('category', 'e1a00000-2222-4000-8000-000000000001', 12)
    WHERE id = 'e1a00000-2222-4000-8000-000000000001'),
  0,
  'termin bieżący nie poleca sam siebie'
);
SELECT is(
  (SELECT count(*)::int
     FROM public.related_taxonomies('category', 'e1a00000-2222-4000-8000-000000000001', 12)
    WHERE slug IN ('rel-szkic', 'rel-usuniety')),
  0,
  'współwystępowanie WYŁĄCZNIE na szkicu lub wpisie usuniętym nie tworzy kandydata'
);
SELECT is(
  (SELECT count(*)::int
     FROM public.related_taxonomies('category', 'e1a00000-2222-4000-8000-000000000001', 12)
    WHERE slug = 'rel-region'),
  0,
  'region (inny wymiar categories.kind) nie jest powiązaną kategorią tematu'
);
SELECT is(
  (SELECT count(*)::int
     FROM public.related_taxonomies('category', 'e1a00000-2222-4000-8000-000000000001', 12)
    WHERE slug = 'rel-b-obca'),
  0,
  'kategoria najemcy B podpięta pod wpis najemcy A nie przecieka'
);
SELECT is(
  (SELECT name_pl || '|' || name_en
     FROM public.related_taxonomies('category', 'e1a00000-2222-4000-8000-000000000001', 12)
    WHERE slug = 'rel-klimat'),
  'Klimat|Climate',
  'kategoria niesie obie nazwy językowe'
);

-- ---------------------------------------------------------------------------
-- 2) Tagi: ta sama miara na drugim pivocie.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT array_agg(r.slug || ':' || r.shared_posts ORDER BY r.ord)
     FROM public.related_taxonomies('tag', 'e1a00000-3333-4000-8000-000000000001', 12)
          WITH ORDINALITY AS r(id, slug, name_pl, name_en, shared_posts, score, ord)),
  ARRAY['rel-tag-tight:1', 'rel-tag-hub:2'],
  'tagi: ścisły (1/sqrt(2)) nad hubem (2/sqrt(2*19)), tag tylko ze szkicu pominięty'
);
SELECT is(
  (SELECT array_agg(r.slug || '|' || round(r.score::numeric, 9) ORDER BY r.ord)
     FROM public.related_taxonomies('tag', 'e1a00000-3333-4000-8000-000000000001', 12)
          WITH ORDINALITY AS r(id, slug, name_pl, name_en, shared_posts, score, ord)),
  ARRAY[
    'rel-tag-tight|' || round((1 / sqrt(2 * 1)::double precision)::numeric, 9),
    'rel-tag-hub|' || round((2 / sqrt(2 * 19)::double precision)::numeric, 9)
  ],
  'tagi, dokładne wyniki: szkic, wpis usunięty i wpis najemcy B nie zawyżają ani n_kotwicy, ani shared, ani n_kandydata'
);
SELECT is(
  (SELECT count(*)::int
     FROM public.related_taxonomies('tag', 'e1a00000-3333-4000-8000-000000000001', 12)
    WHERE slug IN ('rel-b-tag', 'rel-b-tag-partner')),
  0,
  'tag najemcy B podpięty pod wpis najemcy A nie przecieka'
);
SELECT is(
  (SELECT name_pl || '|' || name_en
     FROM public.related_taxonomies('tag', 'e1a00000-3333-4000-8000-000000000001', 12)
    WHERE slug = 'rel-tag-tight'),
  'Bałtyk|Bałtyk',
  'tag ma jedną nazwę - podana w obu językach'
);

-- ---------------------------------------------------------------------------
-- 3) Kontrakt wejścia: rodzaj, NULL, limit.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM public.related_taxonomies('categories', 'e1a00000-2222-4000-8000-000000000001', 12)),
  0,
  'nieznany _kind -> pusty wynik, nie wyjątek'
);
SELECT is(
  (SELECT count(*)::int FROM public.related_taxonomies('tag', 'e1a00000-2222-4000-8000-000000000001', 12)),
  0,
  'identyfikator kategorii podany jako tag -> pusto (rodzaje się nie mieszają)'
);
SELECT is(
  (SELECT count(*)::int FROM public.related_taxonomies('category', 'e1a00000-3333-4000-8000-000000000001', 12)),
  0,
  'identyfikator tagu podany jako kategoria -> pusto (gałąź tagów ma własną bramkę _kind)'
);
SELECT is(
  (SELECT count(*)::int FROM public.related_taxonomies('tags', 'e1a00000-3333-4000-8000-000000000001', 12)),
  0,
  'nieznany _kind przy identyfikatorze tagu -> pusto'
);
SELECT is(
  (SELECT count(*)::int FROM public.related_taxonomies('category', NULL, 12)),
  0,
  'NULL zamiast terminu -> pusto'
);
SELECT is(
  (SELECT count(*)::int FROM public.related_taxonomies('category', 'e1a00000-2222-4000-8000-000000000010')),
  12,
  'domyślny _limit to 12'
);
SELECT is(
  (SELECT count(*)::int FROM public.related_taxonomies('category', 'e1a00000-2222-4000-8000-000000000010', 1000)),
  24,
  '_limit klamrowany od góry do 24 (30 kandydatów)'
);
SELECT is(
  (SELECT count(*)::int FROM public.related_taxonomies('category', 'e1a00000-2222-4000-8000-000000000010', 0)),
  1,
  '_limit klamrowany od dołu do 1'
);
SELECT is(
  (SELECT count(*)::int FROM public.related_taxonomies('category', 'e1a00000-2222-4000-8000-000000000010', NULL)),
  12,
  '_limit NULL -> 12'
);

-- ---------------------------------------------------------------------------
-- 4) Host najemcy B: terminy A są nieadresowalne, własne działają.
-- ---------------------------------------------------------------------------
SELECT set_config('request.headers', '{"x-tenant-host":"rel-b.example"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.related_taxonomies('category', 'e1a00000-2222-4000-8000-000000000001', 12)),
  0,
  'host B nie dostaje rekomendacji dla kategorii najemcy A'
);
SELECT is(
  (SELECT array_agg(slug) FROM public.related_taxonomies('category', 'e1b00000-2222-4000-8000-000000000002', 12)),
  ARRAY['rel-b-partner'],
  'host B dostaje wyłącznie dorobek najemcy B'
);
SELECT is(
  (SELECT count(*)::int FROM public.related_taxonomies('tag', 'e1a00000-3333-4000-8000-000000000001', 12)),
  0,
  'host B nie dostaje rekomendacji dla tagu najemcy A'
);
SELECT is(
  (SELECT array_agg(slug) FROM public.related_taxonomies('tag', 'e1b00000-3333-4000-8000-000000000001', 12)),
  ARRAY['rel-b-tag-partner'],
  'host B dla własnego tagu dostaje tylko tagi B - tagi A z wpisu b1 i wpis A z tagiem B nie wchodzą'
);

RESET ROLE;

-- ---------------------------------------------------------------------------
-- 5) Redaktor najemcy A widzi przez RLS szkice - ranking ma być ten sam co
--    dla anonima (nic ze szkicu nie wchodzi do publicznej sekcji).
-- ---------------------------------------------------------------------------
SELECT set_config('request.headers', '{"x-tenant-host":"nes.example"}', true);

CREATE TEMP TABLE rel_anon_result ON COMMIT DROP AS
  SELECT r.slug, r.shared_posts, r.score, r.ord
    FROM public.related_taxonomies('category', 'e1a00000-2222-4000-8000-000000000001', 12)
         WITH ORDINALITY AS r(id, slug, name_pl, name_en, shared_posts, score, ord)
   WHERE false;
GRANT SELECT, INSERT ON rel_anon_result TO anon, authenticated;

SET LOCAL ROLE anon;
INSERT INTO rel_anon_result
  SELECT r.slug, r.shared_posts, r.score, r.ord
    FROM public.related_taxonomies('category', 'e1a00000-2222-4000-8000-000000000001', 12)
         WITH ORDINALITY AS r(id, slug, name_pl, name_en, shared_posts, score, ord);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"e1a00000-1111-4000-8000-0000000000e1","role":"authenticated"}', true);

SELECT ok(
  (SELECT count(*) FROM public.posts WHERE id = 'e1a00000-4444-4000-8000-000000000005') = 1,
  'warunek wstępny: redaktor widzi szkic przez RLS'
);
SELECT results_eq(
  $$ SELECT r.slug, r.shared_posts, r.score, r.ord
       FROM public.related_taxonomies('category', 'e1a00000-2222-4000-8000-000000000001', 12)
            WITH ORDINALITY AS r(id, slug, name_pl, name_en, shared_posts, score, ord) $$,
  $$ SELECT slug, shared_posts, score, ord FROM rel_anon_result ORDER BY ord $$,
  'redaktor dostaje DOKŁADNIE ten sam publiczny ranking co anonim'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
