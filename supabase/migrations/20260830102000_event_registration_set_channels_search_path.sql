-- events-harness: include
--
-- ZNACZNIK JEST TU KONIECZNY, nie kosmetyczny. Selektor uprzezy wydarzen
-- (scripts/events-harness/run.sh) dobiera migracje PO TRESCI, m.in. wzorcem
-- `FUNCTION public\.event_[a-z_]+\(`. Ta migracja nie tworzy funkcji - ALTER-uje
-- ja przez `format()` z nazwa trzymana w ZMIENNEJ, wiec doslowny wzorzec nie
-- wystepuje w pliku i selektor go NIE lapie. Migracja, ktora defekt wprowadzila
-- (20260828063423), selektorem zlapana JEST. Bez tej linii uprzez odtwarzalaby
-- modul z funkcja nadal przypieta na `search_path = public, pg_temp` i swiecila
-- na zielono na stanie, ktorego produkcja juz nie ma - dokladnie ta klasa
-- falszywej zieleni, dla ktorej czwarty czlon selektora zostal dopisany.
-- ============================================================================
-- KONTRAKT pgcrypto: `event_registration_set_channels` nie widzialo `digest`.
--
-- OBJAW. Bramka `pgtap` byla czerwona na JEDNEJ asercji z 1793:
--
--   extensions_search_path_contract_test.sql
--   # Failed test 1: "zadna funkcja nie wola pgcrypto bez kwalifikatora
--   #                 przy search_path bez `extensions`"
--   #     Unexpected records:
--   #         ("event_registration_set_channels(jsonb)")
--
-- PRZYCZYNA. Funkcja powstala w `20260828063423` jako SECURITY DEFINER
-- z przypieta sciezka `SET search_path TO 'public', 'pg_temp'`, a w ciele wola
-- pgcrypto BEZ kwalifikatora:
--
--   v_hash := encode(digest(v_token, 'sha256'), 'hex');
--
-- Na Supabase `pgcrypto` mieszka w schemacie `extensions` (instalowane jawnie
-- `WITH SCHEMA extensions` w 20260805090000 i 20260805114407). Przypieta
-- sciezka NADPISUJE sesyjna, wiec `digest` sie nie rozstrzyga i wywolanie pada
-- z 42883 - niezaleznie od tego, jak poprawnie ustawiona jest sciezka
-- wolajacego.
--
-- CO TO REALNIE PSULO. Galaz z `v_token` to sciezka zarzadzania zgloszeniem
-- przez `manage_token`, czyli zmiana kanalow powiadomien z linku, BEZ logowania.
-- Ta sciezka byla martwa w runtime od 28.08. Nie widzial tego nikt, bo
-- `.github/workflows/ci.yml` byl w tym czasie nieparsowalny i GitHub nie
-- planowal ani jednego joba - bramka zglaszala defekt do pustej sali.
--
-- DLACZEGO `ALTER`, A NIE `extensions.digest(...)` W CIELE. Powod zapisany juz
-- w `20260812164000`: rozszerzenie sciezki dziala TAKZE wtedy, gdy rozszerzenie
-- stoi w `public` - inaczej niz twarde kwalifikowanie, ktore w takiej
-- instalacji by padlo. `ALTER` nie dotyka tez ciala funkcji, wiec nie cofa
-- zadnej pozniejszej poprawki logiki (dokladnie ten blad zrobila migracja a8:
-- `CREATE OR REPLACE` cofnelo naprawe search_path sprzed trzech godzin).
--
-- `pg_temp` ZOSTAJE na sciezce, bo miala go oryginalna definicja - ta migracja
-- ma dolozyc `extensions`, a nie przy okazji zabrac cokolwiek innego.
--
-- Straznik `to_regprocedure` jak w 20260812164000: gdy pozniejsza zmiana
-- podpisu usunie te funkcje, migracja przechodzi z NOTICE zamiast wywracac
-- odtworzenie bazy od zera.
--
-- KOMENTARZ TEZ IDZIE POD STRAZNIK, a nie za blokiem. `COMMENT ON FUNCTION`
-- na nieistniejacej funkcji rzuca blad rownie skutecznie, co `ALTER` - wiec
-- niezabezpieczony komentarz cofalby caly sens straznika. Zlapane przy probie
-- na czystym klastrze: pierwsza wersja tej migracji przechodzila blok DO
-- z NOTICE i zaraz potem wywracala sie na 42883 w `COMMENT ON`.
-- ============================================================================

DO $$
DECLARE
  v_signature constant text := 'public.event_registration_set_channels(jsonb)';
BEGIN
  IF to_regprocedure(v_signature) IS NULL THEN
    RAISE NOTICE 'search_path fix: brak funkcji % - pomijam', v_signature;
    RETURN;
  END IF;

  EXECUTE format(
    'ALTER FUNCTION %s SET search_path = public, extensions, pg_temp',
    v_signature
  );

  EXECUTE format(
    'COMMENT ON FUNCTION %s IS %L',
    v_signature,
    'Zmiana kanalow powiadomien zgloszenia - po zalogowaniu (auth.uid()) albo z linku (manage_token). search_path zawiera `extensions`, bo weryfikacja tokenu wola digest() z pgcrypto; bez tego galaz tokenowa pada na 42883 (kontrakt: supabase/tests/extensions_search_path_contract_test.sql).'
  );
END $$;
