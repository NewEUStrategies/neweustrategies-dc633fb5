-- pgTAP: strony wyników `search_posts` (parametr `_offset`).
--
-- Weryfikuje migrację 20261003100100_search_posts_offset.sql.
--
-- PO CO TO STOI. Biblioteka publikacji (/publications) miała tylko „Pokaż
-- więcej", które podwajało `_limit` - strony nie miały adresów, każde
-- doładowanie przeliczało całe rosnące okno, a wszystko za 200. trafieniem
-- (sufit `LEAST(_limit, 200)` w ciele funkcji) było nieosiągalne. Paginacja
-- linkowa stoi na `_offset`, więc ten plik pilnuje SKUTKÓW, na których opiera
-- się interfejs:
--   * dokładnie JEDEN wariant funkcji - drugi przeciążony wariant to błąd
--     niejednoznaczności PostgREST (PGRST203) na każdym wywołaniu;
--   * kolejne strony są rozłączne, bez dziur i w porządku sortowania - inaczej
--     czytelnik widzi wpis dwa razy albo nie widzi go wcale;
--   * `total_count` jest licznością CAŁEGO zbioru na KAŻDEJ stronie, także
--     w gałęzi FTS i w fallbacku trigramowym - z niego interfejs liczy liczbę
--     stron i wykrywa stronę za końcem;
--   * widełki offsetu: za końcem zero wierszy, ujemny i NULL jak 0, wielki nie
--     wywraca funkcji przepełnieniem `integer`;
--   * wywołanie BEZ `_offset` (/search, pierwsza strona biblioteki, stary
--     klient) daje dokładnie to, co przed migracją.
--
-- Wszystko z perspektywy anona; tenant rozstrzygany serwerowo z nagłówka
-- x-tenant-host (public_tenant_id()), więc fixture dostaje WŁASNY tenant
-- z domeną - seed tenanta domyślnego nie wchodzi do wyników.

BEGIN;
SELECT plan(21);

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('5e000000-0000-4000-8000-0000000000a1', 'tenant-offset', 'Tenant Offset', 'offset.example');
SELECT '5e000000-0000-4000-8000-0000000000a1' AS nes \gset

INSERT INTO public.pages (id, tenant_id, slug) VALUES
  ('5e000000-1111-4000-8000-0000000000a1', :'nes', 'offset-home');

-- Siedem opublikowanych wpisów, każdy z INNĄ datą: off-1 najnowszy, off-7
-- najstarszy, więc sort 'newest' daje off-1..off-7. Tytuły dzielą zbiór na dwie
-- frazy: „Raport" (4 wpisy, gałąź FTS) i „Geopolityka" (3 wpisy - zapytanie
-- z literówką „geopolityks" nie ma trafień FTS, więc idzie fallback trigramowy).
INSERT INTO public.posts (id, slug, status, tenant_id, parent_page_id, title_pl, published_at) VALUES
  ('5e000000-2222-4000-8000-000000000001', 'off-1', 'published', :'nes',
   '5e000000-1111-4000-8000-0000000000a1', 'Raport energetyczny pierwszy', now() - interval '1 day'),
  ('5e000000-2222-4000-8000-000000000002', 'off-2', 'published', :'nes',
   '5e000000-1111-4000-8000-0000000000a1', 'Geopolityka regionu drugiego', now() - interval '2 days'),
  ('5e000000-2222-4000-8000-000000000003', 'off-3', 'published', :'nes',
   '5e000000-1111-4000-8000-0000000000a1', 'Raport energetyczny trzeci', now() - interval '3 days'),
  ('5e000000-2222-4000-8000-000000000004', 'off-4', 'published', :'nes',
   '5e000000-1111-4000-8000-0000000000a1', 'Geopolityka regionu czwartego', now() - interval '4 days'),
  ('5e000000-2222-4000-8000-000000000005', 'off-5', 'published', :'nes',
   '5e000000-1111-4000-8000-0000000000a1', 'Raport energetyczny piaty', now() - interval '5 days'),
  ('5e000000-2222-4000-8000-000000000006', 'off-6', 'published', :'nes',
   '5e000000-1111-4000-8000-0000000000a1', 'Geopolityka regionu szostego', now() - interval '6 days'),
  ('5e000000-2222-4000-8000-000000000007', 'off-7', 'published', :'nes',
   '5e000000-1111-4000-8000-0000000000a1', 'Raport energetyczny siodmy', now() - interval '7 days');

-- ---------------------------------------------------------------------------
-- 0) Kształt i uprawnienia - sprawdzane PRZED zmianą roli (katalog).
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'search_posts'),
  1,
  'search_posts ma dokładnie JEDEN wariant - przeciążenie dałoby PGRST203 w PostgREST'
);
SELECT has_function(
  'public', 'search_posts',
  ARRAY['text', 'integer', 'uuid', 'timestamp with time zone', 'timestamp with time zone',
        'uuid', 'uuid[]', 'text', 'text', 'text', 'text', 'text', 'text', 'jsonb', 'integer'],
  'search_posts przyjmuje _offset integer jako OSTATNI parametr'
);
SELECT is_definer(
  'public', 'search_posts',
  ARRAY['text', 'integer', 'uuid', 'timestamp with time zone', 'timestamp with time zone',
        'uuid', 'uuid[]', 'text', 'text', 'text', 'text', 'text', 'text', 'jsonb', 'integer'],
  'search_posts zostaje SECURITY DEFINER (tenant rozstrzygany w ciele funkcji)'
);
SELECT ok(
  has_function_privilege(
    'anon',
    'public.search_posts(text, int, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text, text, text, text, jsonb, int)',
    'EXECUTE'),
  'anon może wywołać search_posts (publiczne /search i /publications)'
);
SELECT ok(
  NOT has_function_privilege(
    'public',
    'public.search_posts(text, int, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text, text, text, text, jsonb, int)',
    'EXECUTE'),
  'PUBLIC nie ma EXECUTE - uprawnienia nadane jawnie, jak przed migracją'
);

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.headers', '{"x-tenant-host":"offset.example"}', true);

-- ---------------------------------------------------------------------------
-- 1) Strony przeglądania (bez frazy), sort 'newest', strona = 3 wiersze.
-- ---------------------------------------------------------------------------
-- `ARRAY(SELECT ...)` zachowuje kolejność wierszy funkcji (ORDER BY pg.rn
-- w jej ciele), więc porównanie tablic sprawdza też PORZĄDEK, nie tylko zbiór.
SELECT is(
  ARRAY(SELECT s.slug FROM public.search_posts(_limit => 3, _sort => 'newest', _offset => 0) s),
  ARRAY['off-1', 'off-2', 'off-3'],
  'strona 1 (offset 0): trzy najnowsze wpisy w porządku sortowania'
);
SELECT is(
  ARRAY(SELECT s.slug FROM public.search_posts(_limit => 3, _sort => 'newest', _offset => 3) s),
  ARRAY['off-4', 'off-5', 'off-6'],
  'strona 2 (offset 3): kolejne trzy, bez powtórzeń ze strony 1'
);
SELECT is(
  ARRAY(SELECT s.slug FROM public.search_posts(_limit => 3, _sort => 'newest', _offset => 6) s),
  ARRAY['off-7'],
  'strona 3 (offset 6): ostatni wpis - niepełna strona'
);
SELECT is(
  ARRAY(SELECT s.slug FROM public.search_posts(_limit => 3, _sort => 'newest', _offset => 0) s)
  || ARRAY(SELECT s.slug FROM public.search_posts(_limit => 3, _sort => 'newest', _offset => 3) s)
  || ARRAY(SELECT s.slug FROM public.search_posts(_limit => 3, _sort => 'newest', _offset => 6) s),
  ARRAY(SELECT s.slug FROM public.search_posts(_limit => 80, _sort => 'newest') s),
  'sklejone strony = pełna lista: rozłączne, bez dziur, ten sam porządek'
);
SELECT is(
  ARRAY(
    SELECT DISTINCT s.total_count FROM (
      SELECT total_count FROM public.search_posts(_limit => 3, _sort => 'newest', _offset => 0)
      UNION ALL
      SELECT total_count FROM public.search_posts(_limit => 3, _sort => 'newest', _offset => 3)
      UNION ALL
      SELECT total_count FROM public.search_posts(_limit => 3, _sort => 'newest', _offset => 6)
    ) s),
  ARRAY[7::bigint],
  'każda strona niesie total_count CAŁEGO zbioru (7), nie liczność strony'
);

-- ---------------------------------------------------------------------------
-- 2) Widełki offsetu.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM public.search_posts(_limit => 3, _sort => 'newest', _offset => 7)),
  0,
  'offset równy liczności zbioru: zero wierszy (strona za końcem)'
);
SELECT is(
  (SELECT count(*)::int FROM public.search_posts(_limit => 3, _sort => 'newest', _offset => 100)),
  0,
  'offset daleko za końcem: zero wierszy, bez błędu'
);
SELECT is(
  ARRAY(SELECT s.slug FROM public.search_posts(_limit => 3, _sort => 'newest', _offset => -5) s),
  ARRAY['off-1', 'off-2', 'off-3'],
  'ujemny offset działa jak 0'
);
SELECT is(
  ARRAY(SELECT s.slug FROM public.search_posts(_limit => 3, _sort => 'newest', _offset => NULL) s),
  ARRAY['off-1', 'off-2', 'off-3'],
  'NULL jako offset działa jak 0'
);
SELECT is(
  (SELECT count(*)::int FROM public.search_posts(
     _limit => 3, _sort => 'newest', _offset => 2147483647)),
  0,
  'maksymalny integer jako offset: górne widełki (10000) chronią przed przepełnieniem off + lim'
);
SELECT is(
  ARRAY(SELECT s.slug FROM public.search_posts(_limit => 3, _sort => 'newest') s),
  ARRAY['off-1', 'off-2', 'off-3'],
  'wywołanie BEZ _offset (stary klient, /search) daje pierwszą stronę jak przed migracją'
);

-- ---------------------------------------------------------------------------
-- 3) total_count w gałęzi FTS i w fallbacku trigramowym.
-- ---------------------------------------------------------------------------
SELECT is(
  ARRAY(SELECT s.slug FROM public.search_posts(
     _q => 'raport', _limit => 2, _sort => 'newest', _offset => 2) s),
  ARRAY['off-5', 'off-7'],
  'FTS, strona 2: trzecie i czwarte trafienie frazy'
);
SELECT is(
  ARRAY(SELECT DISTINCT s.total_count FROM public.search_posts(
     _q => 'raport', _limit => 2, _sort => 'newest', _offset => 2) s),
  ARRAY[4::bigint],
  'FTS, strona 2: total_count = wszystkie 4 trafienia frazy'
);
SELECT is(
  ARRAY(SELECT s.slug || ':' || s.fuzzy::text FROM public.search_posts(
     _q => 'geopolityks', _limit => 1, _sort => 'newest', _offset => 1) s),
  ARRAY['off-4:true'],
  'fallback trigramowy, strona 2: drugie trafienie, oznaczone jako fuzzy'
);
SELECT is(
  ARRAY(SELECT DISTINCT s.total_count FROM public.search_posts(
     _q => 'geopolityks', _limit => 1, _sort => 'newest', _offset => 1) s),
  ARRAY[3::bigint],
  'fallback trigramowy: total_count = cały zbiór trafień fuzzy (3), nie strona'
);
SELECT is(
  (SELECT count(*)::int FROM public.search_posts(
     _q => 'geopolityks', _limit => 1, _sort => 'newest', _offset => 3)),
  0,
  'fallback trigramowy za końcem zbioru: zero wierszy'
);

SELECT * FROM finish();
ROLLBACK;
