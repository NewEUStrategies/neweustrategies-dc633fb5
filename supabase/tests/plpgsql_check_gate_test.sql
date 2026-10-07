-- pgTAP: BRAMKA KATALOGOWA plpgsql_check - zadna funkcja PL/pgSQL schematu
-- `public` nie odwoluje sie do nieistniejacej kolumny, tabeli ani funkcji.
--
-- PO CO. PL/pgSQL nie sprawdza ciala przy CREATE, a kontrakt TS <-> SQL patrzy
-- na sygnatury i granty. Audyt platformy znalazl tak dziewiec funkcji, ktore
-- przechodzily CI na zielono i padaly przy KAZDYM wykonaniu (synchronizacja
-- miejsc Team, haslo tresci, CRM zgloszen do klubu, panel uprawnien widowni,
-- powiadomienia obserwujacych, widownia akademicka) - naprawione
-- w 20261007140600/140700/140710 i wywolywane w sql_runtime_errors_test.sql. Ta
-- bramka zamyka klase: nowa funkcja z martwym odwolaniem oblewa CI.
--
-- KOLEJNOSC JEST WARUNKIEM. Biblioteka rozszerzenia musi sie zaladowac ZANIM
-- w sesji wykona sie jakikolwiek PL/pgSQL (w tym `plan()` pgTAP) - inaczej
-- nastepne wywolanie PL/pgSQL konczy sie „pldbgapi2 statement call stack is
-- broken". Dlatego CREATE EXTENSION i pierwsze sprawdzenie stoja przed planem.
-- Brak rozszerzenia w obrazie bazy to blad tego pliku, nie ciche pominiecie.
BEGIN;
CREATE EXTENSION IF NOT EXISTS plpgsql_check;
SELECT count(*) FROM plpgsql_check_function_tb('public.event_audience_qualifies(text)'::regprocedure);

SELECT plan(4);

-- Funkcje rozszerzen (pgTAP w lokalnym runnerze stoi w `public`) nie sa nasze.
-- ZWOLNIENIA - kazde z powodem, a lista moze tylko malec:
--   * chat_purge_expired_messages() - tabela tymczasowa tworzona w ciele
--     (`_purged_convs`), ktorej analiza statyczna nie widzi;
--   * tg_reconcile_profile_badge_from_activity() - pola NEW czytane
--     w galeziach `TG_TABLE_NAME`, a sprawdzanie leci po kazdej tabeli.
CREATE TEMP TABLE _plc_targets ON COMMIT DROP AS
SELECT p.oid AS fn, NULL::oid AS rel, p.oid::regprocedure::text AS sig
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang
 WHERE n.nspname = 'public' AND l.lanname = 'plpgsql'
   AND p.prorettype <> 'trigger'::regtype
   AND NOT EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
UNION
SELECT DISTINCT t.tgfoid, t.tgrelid, t.tgfoid::regprocedure::text || ' ON ' || t.tgrelid::regclass::text
  FROM pg_trigger t
  JOIN pg_proc p ON p.oid = t.tgfoid
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang
 WHERE NOT t.tgisinternal AND n.nspname = 'public' AND l.lanname = 'plpgsql';

-- Zwykle zapytanie, nie petla w bloku DO: wyjatki w podtransakcjach PL/pgSQL
-- rozjezdzaja stos haka `pldbgapi2`, gdy wczesniej w transakcji dzialaly juz
-- funkcje pgTAP. `fatal_errors := false` - blad funkcji to wiersz, nie wyjatek.
CREATE TEMP TABLE _plc_errors ON COMMIT DROP AS
SELECT t.sig, e.lineno, e.sqlstate, e.message
  FROM _plc_targets t
  CROSS JOIN LATERAL plpgsql_check_function_tb(t.fn, COALESCE(t.rel, 0),
         fatal_errors := false, other_warnings := false,
         performance_warnings := false, extra_warnings := false) e
 WHERE e.level = 'error'
   AND t.sig NOT LIKE 'chat_purge_expired_messages()%'
   AND t.sig NOT LIKE 'tg_reconcile_profile_badge_from_activity()%';

SELECT cmp_ok((SELECT count(*)::int FROM _plc_targets), '>', 500,
  'bramka sprawdza realny katalog (ponad 500 funkcji), nie pusty zbior');
SELECT is(
  (SELECT count(*)::int FROM _plc_errors WHERE sqlstate = '42703'), 0,
  'zadna funkcja nie odwoluje sie do nieistniejacej kolumny (42703)');
SELECT is(
  (SELECT count(*)::int FROM _plc_errors WHERE sqlstate IN ('42883', '42725', '42804')), 0,
  'zadna funkcja nie wola nieistniejacej/niejednoznacznej funkcji ani zlego typu (42883/42725/42804)');
SELECT is(
  (SELECT count(*)::int FROM _plc_errors), 0,
  'plpgsql_check: zero bledow w funkcjach PL/pgSQL schematu public');
SELECT diag(sig || ':' || COALESCE(lineno::text, '?') || ' ' || sqlstate || ' ' || message)
  FROM _plc_errors ORDER BY sig;

SELECT * FROM finish();
ROLLBACK;
