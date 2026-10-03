-- pgTAP: tło nagłówka archiwum „Zdjęcie” ma gdzie trzymać adres obrazu,
-- a baza nie wpuszcza adresu, który rozrywa CSS albo wskazuje obcy schemat.
--
-- Weryfikuje migrację 20261003100000_archive_hero_image_url.sql.
--
-- PO CO TO STOI. `hero_bg_style = 'image'` było martwym ustawieniem: panel je
-- oferował, `HeroBackground` umiał je narysować, ale adresu nie przechowywało
-- nic, więc każde archiwum z tym stylem schodziło po cichu na neutralne tło.
--
-- CZEGO TEN TEST PILNUJE.
--   * kształtu kolumny: tekst, NULL dozwolony i domyślny - istniejące wiersze
--     nie zmieniają wyglądu;
--   * reguły adresu 1:1 z `isHeroImageUrl` (`src/lib/archive/heroImage.ts`):
--     odrzuca `javascript:`, `data:`, adres bez schematu ('//host'), '/\host',
--     biały znak i nową linię (rozerwanie wartości CSS) oraz wartość ponad
--     2048 znaków; przyjmuje https, ścieżkę w serwisie, nawiasy i NULL;
--   * tego, że kolumna NIE zmieniła uprawnień: anon czyta wiersz własnego
--     tenanta (polityka „readable by tenant scope”) i nie może go zmienić,
--     admin zapisuje adres DOKŁADNIE ścieżką panelu (upsert po
--     `tenant_id, archive_type`), redaktor i admin obcego tenanta - nie;
--   * tego, że CHECK obowiązuje także na ścieżce klienta, nie tylko dla
--     właściciela tabeli.
--
-- WYZWALACZE UŻYTKOWNIKA WYŁĄCZONE - konwencja tej suity: `on_auth_user_created`
-- woła `handle_new_user()`, który sam zakłada wiersz w `public.profiles`, więc
-- ręczne wstawienie profilu padłoby na kluczu głównym przed pierwszą asercją.

BEGIN;
SELECT plan(29);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('b7e00000-0000-4000-8000-0000000000a1', 'hero-tenant-a', 'Hero Tenant A', 'hero-a.pgtap.test'),
  ('b7e00000-0000-4000-8000-0000000000b1', 'hero-tenant-b', 'Hero Tenant B', 'hero-b.pgtap.test');

INSERT INTO auth.users (id, email) VALUES
  ('b7e00000-1111-4000-8000-0000000000a1', 'admin@hero-a.test'),
  ('b7e00000-1111-4000-8000-0000000000a2', 'editor@hero-a.test'),
  ('b7e00000-1111-4000-8000-0000000000b1', 'admin@hero-b.test');

INSERT INTO public.profiles (id, tenant_id, email) VALUES
  ('b7e00000-1111-4000-8000-0000000000a1', 'b7e00000-0000-4000-8000-0000000000a1', 'admin@hero-a.test'),
  ('b7e00000-1111-4000-8000-0000000000a2', 'b7e00000-0000-4000-8000-0000000000a1', 'editor@hero-a.test'),
  ('b7e00000-1111-4000-8000-0000000000b1', 'b7e00000-0000-4000-8000-0000000000b1', 'admin@hero-b.test');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('b7e00000-1111-4000-8000-0000000000a1', 'admin',  'b7e00000-0000-4000-8000-0000000000a1'),
  ('b7e00000-1111-4000-8000-0000000000a2', 'editor', 'b7e00000-0000-4000-8000-0000000000a1'),
  ('b7e00000-1111-4000-8000-0000000000b1', 'admin',  'b7e00000-0000-4000-8000-0000000000b1');

-- Wiersz kategorii tenanta A ze zdjęciem i wiersz B bez zdjęcia (stan po
-- migracji dla każdego istniejącego wiersza).
INSERT INTO public.archive_layout_settings (id, tenant_id, archive_type, hero_bg_style, hero_image_url) VALUES
  ('b7e00000-2222-4000-8000-0000000000a1', 'b7e00000-0000-4000-8000-0000000000a1', 'category', 'image',
   'https://cdn.example/hero-a.jpg'),
  ('b7e00000-2222-4000-8000-0000000000b1', 'b7e00000-0000-4000-8000-0000000000b1', 'category', 'gradient',
   NULL);

-- ---------------------------------------------------------------------------
-- 0) Kształt kolumny i ograniczenia.
-- ---------------------------------------------------------------------------
SELECT has_column('public', 'archive_layout_settings', 'hero_image_url',
  'archive_layout_settings.hero_image_url istnieje - styl „Zdjęcie” ma źródło obrazu');
-- Typ przez `is()` na `information_schema`, nie `col_type_is`: licznik planu
-- (`src/lib/ci/pgTapPlan.ts`) nie zna `col_type_is` i zgłosiłby rozjazd planu.
SELECT is(
  (SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'archive_layout_settings'
      AND column_name = 'hero_image_url'),
  'text',
  'hero_image_url jest tekstem'
);
SELECT col_is_null('public', 'archive_layout_settings', 'hero_image_url',
  'hero_image_url dopuszcza NULL - brak zdjęcia to stan poprawny (neutralne tło)');
SELECT col_hasnt_default('public', 'archive_layout_settings', 'hero_image_url',
  'hero_image_url nie ma wartości domyślnej - istniejące wiersze dostają NULL i nie zmieniają wyglądu');
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.archive_layout_settings'::regclass
       AND conname = 'archive_layout_settings_hero_image_url_shape'
       AND contype = 'c'
  ),
  'CHECK archive_layout_settings_hero_image_url_shape istnieje'
);

-- ---------------------------------------------------------------------------
-- 1) Reguła adresu - odrzucenia (właściciel tabeli, poza RLS: CHECK działa
--    niezależnie od drogi zapisu).
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$UPDATE public.archive_layout_settings SET hero_image_url = 'javascript:alert(1)'
     WHERE id = 'b7e00000-2222-4000-8000-0000000000a1'$$,
  '23514', NULL,
  'javascript: odrzucone'
);
SELECT throws_ok(
  $$UPDATE public.archive_layout_settings SET hero_image_url = 'JavaScript:alert(1)'
     WHERE id = 'b7e00000-2222-4000-8000-0000000000a1'$$,
  '23514', NULL,
  'javascript: odrzucone także w mieszanej wielkości liter'
);
SELECT throws_ok(
  $$UPDATE public.archive_layout_settings SET hero_image_url = 'data:image/png;base64,iVBORw0KGgo='
     WHERE id = 'b7e00000-2222-4000-8000-0000000000a1'$$,
  '23514', NULL,
  'data: odrzucone'
);
SELECT throws_ok(
  $$UPDATE public.archive_layout_settings SET hero_image_url = '//evil.example/x.jpg'
     WHERE id = 'b7e00000-2222-4000-8000-0000000000a1'$$,
  '23514', NULL,
  'adres bez schematu (//host) odrzucony - przeglądarka czyta go jako obcy host'
);
SELECT throws_ok(
  $$UPDATE public.archive_layout_settings SET hero_image_url = '/\evil.example/x.jpg'
     WHERE id = 'b7e00000-2222-4000-8000-0000000000a1'$$,
  '23514', NULL,
  '/\host odrzucony - przeglądarka normalizuje go do //host'
);
SELECT throws_ok(
  $$UPDATE public.archive_layout_settings SET hero_image_url = 'https:///evil.example/x.jpg'
     WHERE id = 'b7e00000-2222-4000-8000-0000000000a1'$$,
  '23514', NULL,
  'https:/// (pusty host) odrzucony'
);
SELECT throws_ok(
  $$UPDATE public.archive_layout_settings SET hero_image_url = ' https://cdn.example/x.jpg'
     WHERE id = 'b7e00000-2222-4000-8000-0000000000a1'$$,
  '23514', NULL,
  'wiodąca spacja odrzucona - panel zapisuje wartość przyciętą'
);
SELECT throws_ok(
  $$UPDATE public.archive_layout_settings SET hero_image_url = E'https://cdn.example/x.jpg\n);color:red'
     WHERE id = 'b7e00000-2222-4000-8000-0000000000a1'$$,
  '23514', NULL,
  'nowa linia odrzucona - nie da się nią rozerwać wartości CSS'
);
SELECT throws_ok(
  $$UPDATE public.archive_layout_settings SET hero_image_url = 'https://cdn.example/' || repeat('a', 2029)
     WHERE id = 'b7e00000-2222-4000-8000-0000000000a1'$$,
  '23514', NULL,
  'adres dłuższy niż 2048 znaków odrzucony'
);

-- ---------------------------------------------------------------------------
-- 2) Reguła adresu - akceptacje.
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$UPDATE public.archive_layout_settings SET hero_image_url = 'https://cdn.example/' || repeat('a', 2028)
     WHERE id = 'b7e00000-2222-4000-8000-0000000000a1'$$,
  'adres DOKŁADNIE 2048 znaków przyjęty (granica włącznie)'
);
SELECT lives_ok(
  $$UPDATE public.archive_layout_settings SET hero_image_url = '/media/archiwum/hero(1).jpg'
     WHERE id = 'b7e00000-2222-4000-8000-0000000000a1'$$,
  'ścieżka w serwisie z nawiasami przyjęta - render cytuje i escapuje url("…")'
);
SELECT lives_ok(
  $$UPDATE public.archive_layout_settings SET hero_image_url = NULL
     WHERE id = 'b7e00000-2222-4000-8000-0000000000a1'$$,
  'NULL przyjęty - wyczyszczenie zdjęcia'
);
SELECT lives_ok(
  $$UPDATE public.archive_layout_settings SET hero_image_url = 'https://cdn.example/hero-a.jpg'
     WHERE id = 'b7e00000-2222-4000-8000-0000000000a1'$$,
  'adres https przyjęty'
);

-- ---------------------------------------------------------------------------
-- 3) anon: czyta wiersz WŁASNEGO hosta, nie może go zmienić.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.headers', '{"x-tenant-host":"hero-a.pgtap.test"}', true);

SELECT is(
  (SELECT hero_image_url FROM public.archive_layout_settings WHERE archive_type = 'category'),
  'https://cdn.example/hero-a.jpg',
  'anon na hoście tenanta A czyta adres zdjęcia z jego wiersza (polityka odczytu bez zmian)'
);
SELECT is(
  (SELECT count(*)::int FROM public.archive_layout_settings
    WHERE id = 'b7e00000-2222-4000-8000-0000000000b1'),
  0,
  'anon na hoście A NIE widzi wiersza tenanta B'
);
SELECT throws_ok(
  $$UPDATE public.archive_layout_settings SET hero_image_url = '/media/anon.jpg'$$,
  '42501', NULL,
  'anon NIE może zmienić adresu zdjęcia (brak grantu UPDATE)'
);

RESET ROLE;
SELECT set_config('request.headers', '', true);

-- ---------------------------------------------------------------------------
-- 4) Admin tenanta A - DOKŁADNIE ścieżka panelu: upsert bez tenant_id
--    (DEFAULT current_tenant_id()) z konfliktem po (tenant_id, archive_type).
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"b7e00000-1111-4000-8000-0000000000a1","role":"authenticated"}', true);

SELECT lives_ok(
  $$INSERT INTO public.archive_layout_settings (archive_type, hero_bg_style, hero_image_url)
    VALUES ('category', 'image', '/media/archiwum/admin.jpg')
    ON CONFLICT (tenant_id, archive_type)
    DO UPDATE SET hero_bg_style = EXCLUDED.hero_bg_style, hero_image_url = EXCLUDED.hero_image_url$$,
  'admin A zapisuje adres zdjęcia upsertem panelu'
);
SELECT throws_ok(
  $$UPDATE public.archive_layout_settings SET hero_image_url = 'javascript:alert(1)'
     WHERE id = 'b7e00000-2222-4000-8000-0000000000a1'$$,
  '23514', NULL,
  'CHECK obowiązuje także na ścieżce klienta - admin nie zapisze javascript:'
);

RESET ROLE;

SELECT is(
  (SELECT hero_image_url FROM public.archive_layout_settings
    WHERE id = 'b7e00000-2222-4000-8000-0000000000a1'),
  '/media/archiwum/admin.jpg',
  'upsert admina zaktualizował ISTNIEJĄCY wiersz tenanta A'
);
SELECT is(
  (SELECT count(*)::int FROM public.archive_layout_settings
    WHERE tenant_id = 'b7e00000-0000-4000-8000-0000000000a1' AND archive_type = 'category'),
  1,
  'upsert nie założył drugiego wiersza kategorii'
);

-- ---------------------------------------------------------------------------
-- 5) Redaktor A i admin B - polityka zapisu bez zmian (0 wierszy).
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"b7e00000-1111-4000-8000-0000000000a2","role":"authenticated"}', true);

SELECT is_empty(
  $$UPDATE public.archive_layout_settings SET hero_image_url = '/media/redaktor.jpg'
     WHERE id = 'b7e00000-2222-4000-8000-0000000000a1' RETURNING id$$,
  'redaktor A (nie admin) nie zmienia adresu zdjęcia'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"b7e00000-1111-4000-8000-0000000000b1","role":"authenticated"}', true);

SELECT is_empty(
  $$UPDATE public.archive_layout_settings SET hero_image_url = '/media/obcy.jpg'
     WHERE id = 'b7e00000-2222-4000-8000-0000000000a1' RETURNING id$$,
  'admin tenanta B nie zmienia adresu zdjęcia tenanta A'
);

RESET ROLE;

SELECT is(
  (SELECT hero_image_url FROM public.archive_layout_settings
    WHERE id = 'b7e00000-2222-4000-8000-0000000000a1'),
  '/media/archiwum/admin.jpg',
  'po próbach redaktora A i admina B adres zdjęcia tenanta A jest nietknięty'
);
SELECT is(
  (SELECT hero_image_url FROM public.archive_layout_settings
    WHERE id = 'b7e00000-2222-4000-8000-0000000000b1'),
  NULL,
  'wiersz tenanta B zostaje bez zdjęcia'
);

SELECT * FROM finish();
ROLLBACK;
