-- GENERATOR zapytania weryfikujacego po wdrozeniu. Uruchamiany przez
-- scripts/deploy-order-proof.sh na bazie `ref` (stan koncowy w kolejnosci
-- wersji); wypisuje SQL, ktory idzie na produkcje (tylko odczyt).
--
-- Zmienne psql (tablice tekstowe w skladni '{a,b}'):
--   :'fns'   funkcje zakladane przez pliki nowsze od linii
--   :'tabs'  tabele zakladane przez te pliki
--   :'alts'  tabele istniejace, ktore te pliki zmieniaja (ALTER TABLE)
--   :'cols'  kolumny dodawane przez ADD COLUMN w tych plikach
--   :'trgs'  triggery zakladane przez te pliki
--   :'src'   opis zrodla (plik kolejnosci, linia)
--
-- Tresc funkcji porownujemy po md5 ZNORMALIZOWANEJ: bez komentarzy `--`
-- i ze zwarta spacja. Kopie wdrozeniowe z panelu Lovable potrafia zgubic
-- komentarze (zapisy 0062-0064, 0066) - to nie jest rozjazd zachowania.
\pset format unaligned
\pset tuples_only on
\pset footer off

SELECT '-- Weryfikacja po wdrozeniu migracji modulu Wydarzen (TYLKO ODCZYT).';
SELECT '-- Wygenerowane przez scripts/deploy-order-proof.sh (' || :'src' || ').';
SELECT '-- PUSTY wynik = stan produkcji zgodny z repozytorium. Kazdy wiersz to rozjazd.';
SELECT 'WITH f(n, a, h) AS (VALUES';
SELECT string_agg(format('  (%L, %L, %L)', p.proname, pg_get_function_identity_arguments(p.oid),
         md5(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))),
       E',\n' ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)) || '),'
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (:'fns'::text[]);
SELECT 't(n) AS (VALUES';
SELECT string_agg(format('  (%L)', c.relname), E',\n' ORDER BY c.relname) || '),'
  FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
   AND c.relname = ANY (:'tabs'::text[]);
SELECT 'k(t, c) AS (VALUES';
SELECT COALESCE(string_agg(format('  (%L, %L)', c.relname, a.attname), E',\n' ORDER BY c.relname, a.attname),
                '  (NULL::text, NULL::text)') || '),'
  FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
 WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
   AND a.attnum > 0 AND NOT a.attisdropped
   AND c.relname = ANY (:'alts'::text[]) AND NOT c.relname = ANY (:'tabs'::text[])
   AND a.attname = ANY (:'cols'::text[]);
SELECT 'g(n) AS (VALUES';
SELECT string_agg(DISTINCT format('  (%L)', tg.tgname), E',\n') || ')'
  FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
 WHERE NOT tg.tgisinternal AND c.relnamespace = 'public'::regnamespace
   AND tg.tgname = ANY (:'trgs'::text[]);
SELECT $q$SELECT 'funkcja' AS rodzaj, f.n || '(' || f.a || ')' AS obiekt,
       CASE WHEN p.oid IS NULL THEN 'brak' ELSE 'inna tresc' END AS problem
  FROM f
  LEFT JOIN pg_proc p ON p.pronamespace = 'public'::regnamespace AND p.proname = f.n
                     AND pg_get_function_identity_arguments(p.oid) = f.a
 WHERE p.oid IS NULL
    OR md5(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) <> f.h
UNION ALL
SELECT 'tabela', t.n, 'brak' FROM t WHERE to_regclass('public.' || t.n) IS NULL
UNION ALL
SELECT 'kolumna', k.t || '.' || k.c, 'brak' FROM k
 WHERE k.t IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.' || k.t) AND a.attname = k.c AND NOT a.attisdropped)
UNION ALL
SELECT 'trigger', g.n, 'brak' FROM g
 WHERE NOT EXISTS (SELECT 1 FROM pg_trigger x WHERE x.tgname = g.n AND NOT x.tgisinternal)
ORDER BY 1, 2;$q$;
