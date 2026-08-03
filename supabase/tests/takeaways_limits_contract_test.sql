-- pgTAP: kontrakt limitow sekcji "Z tego materialu dowiesz sie, ze..."
--
-- Limit zyje w trzech warstwach - trigger DB, schemat zod serwerowej funkcji
-- (lib/content.functions.ts) i panel edytora. Do 2026-08-03 rozjechaly sie:
-- baza dopuszczala 7 punktow (migracja 20260709100809 podniosla limit z 6),
-- zod odrzucal 7, a panel liczyl do 6, jednoczesnie obiecujac w podpowiedzi
-- "max 7". Warstwe TS spina stala KEY_TAKEAWAYS_MAX_ITEMS
-- (lib/keyTakeaways/limits.ts) + test jednostkowy, ktory przypina jej wartosc
-- do 7; ten plik przypina STRONE BAZY, wiec zmiana triggera bez zmiany stalej
-- (i odwrotnie) zapala CI.
--
-- Dodatkowo: sekcja dziala dla WPISOW **i STRON** (dwa audyty zapisaly
-- nieprawde, ze dla stron gałąź renderu jest martwa). Test asercjonuje symetrie
-- obu triggerow, zeby ta symetria byla faktem pilnowanym, nie przekonaniem.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(10);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO auth.users (id, email) VALUES
  ('c7000000-0000-0000-0000-0000000000aa', 'takeaways@contract.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('c7000000-0000-0000-0000-0000000000aa', 'takeaways@contract.test', 'Takeaways Author',
   (SELECT public.public_tenant_id()));

-- Strona-rodzic dla wpisu (posts.parent_page_id jest wymagane w tym schemacie).
INSERT INTO public.pages (id, tenant_id, slug, title_pl, title_en, status)
VALUES ('c7111111-1111-1111-1111-111111111101', (SELECT public.public_tenant_id()),
        'takeaways-parent', 'Rodzic', 'Parent', 'published');

INSERT INTO public.posts (id, tenant_id, slug, title_pl, title_en, status, parent_page_id)
VALUES ('c7222222-2222-2222-2222-222222222201', (SELECT public.public_tenant_id()),
        'takeaways-post', 'Wpis', 'Post', 'published',
        'c7111111-1111-1111-1111-111111111101');

INSERT INTO public.pages (id, tenant_id, slug, title_pl, title_en, status)
VALUES ('c7111111-1111-1111-1111-111111111102', (SELECT public.public_tenant_id()),
        'takeaways-page', 'Strona', 'Page', 'published');

-- -- 1. Triggery i kolumny istnieja na OBU encjach -----------------------------------

SELECT has_column('public', 'pages', 'takeaways_pl',
  'strony maja kolumne takeaways_pl (sekcja nie jest funkcja tylko wpisow)');
SELECT has_column('public', 'pages', 'takeaways_en',
  'strony maja kolumne takeaways_en');
SELECT has_column('public', 'pages', 'takeaways_variant',
  'strony maja wlasne nadpisanie wariantu wizualnego');

SELECT has_trigger('public', 'pages', 'pages_validate_takeaways_trg',
  'walidator punktow jest wpiety na pages');
SELECT has_trigger('public', 'posts', 'posts_validate_takeaways_trg',
  'walidator punktow jest wpiety na posts');

-- -- 2. Limit liczby punktow: 7 przechodzi, 8 nie -------------------------------------

SELECT lives_ok(
  $$ UPDATE public.posts
        SET takeaways_pl = ARRAY['p1','p2','p3','p4','p5','p6','p7']
      WHERE id = 'c7222222-2222-2222-2222-222222222201' $$,
  'wpis przyjmuje 7 punktow (tyle, ile obiecuje panel i stala TS)'
);

SELECT throws_ok(
  $$ UPDATE public.posts
        SET takeaways_pl = ARRAY['p1','p2','p3','p4','p5','p6','p7','p8']
      WHERE id = 'c7222222-2222-2222-2222-222222222201' $$,
  'P0001',
  'takeaways_pl: max 7 items',
  'wpis odrzuca 8 punktow z jawnym komunikatem'
);

SELECT lives_ok(
  $$ UPDATE public.pages
        SET takeaways_en = ARRAY['p1','p2','p3','p4','p5','p6','p7']
      WHERE id = 'c7111111-1111-1111-1111-111111111102' $$,
  'strona przyjmuje 7 punktow - symetria z wpisem'
);

SELECT throws_ok(
  $$ UPDATE public.pages
        SET takeaways_en = ARRAY['p1','p2','p3','p4','p5','p6','p7','p8']
      WHERE id = 'c7111111-1111-1111-1111-111111111102' $$,
  'P0001',
  'takeaways_en: max 7 items',
  'strona odrzuca 8 punktow - symetria z wpisem'
);

-- -- 3. Limit dlugosci punktu: 500 znakow ---------------------------------------------

SELECT throws_ok(
  format(
    $$ UPDATE public.pages SET takeaways_pl = ARRAY[%L] WHERE id = 'c7111111-1111-1111-1111-111111111102' $$,
    repeat('x', 501)
  ),
  'P0001',
  'takeaways_pl item too long (max 500)',
  'punkt dluzszy niz 500 znakow jest odrzucany (parytet z maxLength w panelu)'
);

SELECT * FROM finish();
ROLLBACK;
