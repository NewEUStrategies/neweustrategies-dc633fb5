-- ============================================================================
-- BEZPIECZENSTWO: `pg_temp` NA KONCU search_path kazdej funkcji SECURITY DEFINER.
--
-- MECHANIZM, ODTWORZONY WYKONANIEM (PostgreSQL 16). Gdy przypieta sciezka NIE
-- wymienia `pg_temp` jawnie, Postgres przeszukuje schemat tymczasowy JAKO
-- PIERWSZY. W funkcji SECURITY DEFINER znaczy to, ze obiekt zalozony przez
-- WOLAJACEGO w jego wlasnym `pg_temp` przeslania obiekt z `public` - a cialo
-- wykonuje sie z uprawnieniami wlasciciela funkcji. Dwie funkcje rozniace sie
-- wylacznie sciezka, ta sama tabela `public.secret`, ten sam wolajacy
-- z `CREATE TEMP TABLE secret`:
--
--   search_path = public, extensions            -> PODSZYCIE_z_pg_temp
--   search_path = public, extensions, pg_temp   -> wiersz_z_public
--
-- To jest zalecenie z dokumentacji PostgreSQL dla SECURITY DEFINER i nie ma
-- funkcji, dla ktorej „pg_temp przeszukiwany pierwszy” bylby stanem pozadanym.
-- Dopisanie `pg_temp` NA KONCU jest wiec bezpieczne z konstrukcji: nie zmienia
-- rozstrzygania zadnej nazwy, ktora dotad rozstrzygala sie poprawnie, a odbiera
-- wolajacemu mozliwosc wejscia przed `public`.
--
-- ZAKRES: 735 z 913 FUNKCJI, NIE SIEDEM. Znalezisko wyszlo przy przegladzie
-- `20260812164000`, ktora ustawia `search_path = public, extensions` siedmiu
-- funkcjom - i ta siodemka byla pierwotnie opisana jako caly problem. Skan
-- koncowego stanu katalogu migracji pokazal, ze klasa jest repo-szeroka:
-- 735 funkcji SECURITY DEFINER w `public` ma przypieta sciezke bez `pg_temp`.
-- Naprawa siedmiu byla by arbitralna - pozostale 728 niosa dokladnie ten sam
-- wektor.
--
-- DLACZEGO PETLA PO KATALOGU, A NIE LISTA PODPISOW. Lista w `20260812164000`
-- pokazala swoja wade w praktyce: jest dopasowywana przez `to_regprocedure` do
-- DOKLADNEGO podpisu, wiec kazda pozniejsza zmiana listy parametrow po cichu
-- wypada z naprawy (`RAISE NOTICE ... pomijam`). Przy 735 pozycjach taka lista
-- rozjechalaby sie z rzeczywistoscia w pierwszym tygodniu. Petla czyta stan
-- FAKTYCZNY z `pg_proc`, wiec nie ma czego rozjechac.
--
-- IDEMPOTENTNA: funkcje, ktore juz maja `pg_temp` na sciezce, sa pomijane, wiec
-- drugie wykonanie nie zmienia niczego i konczy sie licznikiem 0. Migracja NIE
-- DOTYKA CIAL FUNKCJI - zmienia wylacznie `proconfig`, wiec nie moze cofnac
-- zadnej pozniejszej poprawki logiki (dokladnie ten blad zrobila migracja a8,
-- przedeklarowujac funkcje przez `CREATE OR REPLACE`).
--
-- CZEGO TA MIGRACJA NIE ZALATWIA: nowa funkcja SECURITY DEFINER dopisana jutro
-- znow moze przyjsc bez `pg_temp`. Trwalym domknieciem jest bramka, nie
-- migracja - ale bramka na 735 pozycjach musialaby byc ratchetem, a ten wymaga
-- zmierzenia stanu na PELNYM schemacie (czyli w jobie `pgtap`, nie lokalnie).
-- Zostawione swiadomie jako nastepny krok, opisane tutaj, zeby nie zginelo.
-- ============================================================================

DO $$
DECLARE
  r record;
  v_path text;
  v_fixed int := 0;
  v_skipped int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig,
           (SELECT cfg
              FROM unnest(p.proconfig) AS cfg
             WHERE cfg LIKE 'search_path=%'
             LIMIT 1) AS search_path_cfg
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef                    -- wylacznie SECURITY DEFINER
       AND p.proconfig IS NOT NULL        -- wylacznie z PRZYPIETA sciezka
     ORDER BY 1
  LOOP
    -- Funkcja ma `proconfig`, ale nie ustawia search_path (np. samo
    -- `statement_timeout`) - nie nasza klasa.
    CONTINUE WHEN r.search_path_cfg IS NULL;

    -- `proconfig` trzyma wpis jako 'search_path=<wartosc>'; 'search_path=' to
    -- 12 znakow, wiec wartosc zaczyna sie na 13.
    v_path := substring(r.search_path_cfg FROM 13);

    -- Pusta sciezka (`SET search_path = ''`) to SWIADOMA izolacja - wszystko
    -- w takiej funkcji musi byc kwalifikowane, a dopisanie czegokolwiek
    -- zmienialoby jej kontrakt. Zostawiamy.
    CONTINUE WHEN btrim(v_path) = '' OR btrim(v_path) IN ('''''', '""');

    -- Juz bezpieczna - gdziekolwiek `pg_temp` stoi jawnie, nie jest juz
    -- przeszukiwany niejawnie jako pierwszy.
    IF v_path ILIKE '%pg_temp%' THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Wartosc pochodzi z katalogu i jest juz poprawna lista search_path
    -- (wraz z cudzyslowami, jesli byly), wiec wchodzi doslownie.
    EXECUTE format('ALTER FUNCTION %s SET search_path = %s, pg_temp', r.sig, v_path);
    v_fixed := v_fixed + 1;
  END LOOP;

  RAISE NOTICE 'search_path/pg_temp: dopisano do % funkcji, % juz bylo bezpiecznych',
    v_fixed, v_skipped;
END $$;
