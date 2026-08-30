-- ============================================================================
-- PO CO TEN PLIK ISTNIEJE
-- Szkielet raportowania asercji modulu Wydarzen plus PETLA po katalogu
-- `runtime_test.d`. Sam nie testuje niczego oprocz tego, ze petla dziala -
-- cala tresc siedzi w plikach `runtime_test.d/NN_*.sql`.
--
-- CZEGO TEN PLIK NIE ROBI
--   * nie seeduje danych. Kazdy plik z `runtime_test.d` seeduje sam siebie -
--     inaczej szesciu agentow dopisujacych pliki rownolegle kolidowaloby
--     o ten sam fixture;
--   * nie sprawdza schematu. Bledy schematu wychodza na etapie replayu
--     migracji, jeszcze przed tym plikiem;
--   * nie ustawia aktora. Aktor jest sprawa pojedynczej asercji i pojedynczy
--     plik przestawia go po kolei.
--
-- pgtap nie jest dostepny w tym obrazie, wiec asercje sa golym SQL-em:
-- kazda niespelniona rzuca wyjatek, ktory dzieki ON_ERROR_STOP konczy caly
-- skrypt niezerowym kodem wyjscia. run.sh ten kod PRZEPUSZCZA (patrz komentarz
-- o potoku w run.sh) - bez tego bramka bylaby zielona przy czerwonym tescie.
-- ============================================================================

\set ON_ERROR_STOP on
\timing off

-- ---------------------------------------------------------------------------
-- Sloty asercji
-- ---------------------------------------------------------------------------

-- Zgoda: warunek MUSI byc prawda. NULL to NIE prawda - to celowe, bo
-- `SELECT ... = 1` na braku wiersza daje NULL, a taka asercja przechodzila by
-- na pustej bazie.
CREATE OR REPLACE FUNCTION pg_temp.assert(_ok boolean, _label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _ok IS NOT TRUE THEN
    RAISE EXCEPTION 'ASERCJA NIESPELNIONA: %', _label;
  END IF;
  RAISE NOTICE '  ok  %', _label;
END $$;

-- ODMOWA: operacja MUSI zostac odrzucona. To jest drugi bok kazdej asercji
-- o uprawnieniach i o ograniczeniach - naruszenie EXCLUDE, przekroczenie puli
-- miejsc, zapis w trybie, ktory go zabrania, wiersz wskazujacy wydarzenie
-- obcego najemcy. Asercja, ktora sprawdza tylko zgody, nie potrafi byc
-- czerwona z powodu ZBYT SZEROKICH uprawnien.
CREATE OR REPLACE FUNCTION pg_temp.assert_raises(_sql text, _label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '  ok  % (odrzucone: %)', _label, left(SQLERRM, 70);
    RETURN;
  END;
  RAISE EXCEPTION 'ASERCJA NIESPELNIONA: % - operacja PRZESZLA, a miala zostac odrzucona', _label;
END $$;

-- Odmowa Z KONKRETNYM powodem. `assert_raises` samo w sobie przechodzi tez
-- wtedy, gdy operacja padla z bledu literowki w tescie - a to jest falszywa
-- zgoda. Tam, gdzie znamy nazwe ograniczenia albo tekst wyjatku, sprawdzamy ja.
CREATE OR REPLACE FUNCTION pg_temp.assert_raises_like(_sql text, _pattern text, _label text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_err text;
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    IF v_err ILIKE '%' || _pattern || '%' THEN
      RAISE NOTICE '  ok  % (odrzucone: %)', _label, left(v_err, 70);
      RETURN;
    END IF;
    RAISE EXCEPTION 'ASERCJA NIESPELNIONA: % - odrzucone, ale NIE z powodu "%": %',
      _label, _pattern, left(v_err, 120);
  END;
  RAISE EXCEPTION 'ASERCJA NIESPELNIONA: % - operacja PRZESZLA, a miala zostac odrzucona', _label;
END $$;

-- DEFEKT ZAREJESTROWANY, a nie naprawiony po cichu. Odpowiednik `it.fails`
-- z vitest, ktorego w tym repozytorium jest dzis 171 wpisow w 94 plikach:
-- asercja opisuje ZLE zachowanie, ktore produkcja NADAL ma, i przechodzi
-- dopoki ono trwa. W chwili naprawy staje sie CZERWONA - i to jest jej cala
-- wartosc: nikt nie usunie defektu bez usuniecia wpisu, a wpis niesie opis
-- tego, co bylo zle. Rejestr moze wiec tylko malec.
--
-- `_present` = warunek, ktory jest PRAWDA, dopoki defekt istnieje.
CREATE OR REPLACE FUNCTION pg_temp.assert_known_defect(
  _present boolean, _label text, _plan text
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _present IS NOT TRUE THEN
    RAISE EXCEPTION 'DEFEKT NAPRAWIONY, USUN WPIS: % (plan bylo: %)', _label, _plan;
  END IF;
  RAISE NOTICE '  ok  DEFEKT ZAREJESTROWANY (nadal obecny): % [%]', _label, _plan;
END $$;

-- ---------------------------------------------------------------------------
-- Przestawianie aktora
--
-- Jedna funkcja zamiast czterech SET-ow rozsypanych po plikach. Wolana bez
-- argumentow ustawia anonima. Ksztalt sesji opisuje README, sekcja
-- "Kim jestem w tescie".
--
-- UWAGA: to ustawia TOZSAMOSC (auth.uid, najemca, warstwa), a NIE role
-- bazodanowa. RLS w PostgreSQL nie obowiazuje superuzytkownika, wiec asercje
-- o politykach MUSZA dodatkowo zrobic `SET ROLE authenticated` albo
-- `SET ROLE anon` - i wrocic przez `RESET ROLE`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.act_as(
  _uid uuid DEFAULT NULL,
  _tenant uuid DEFAULT NULL,
  _tier_rank integer DEFAULT 0,
  _tier_features text DEFAULT ''
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(_uid::text, ''), false);
  PERFORM set_config('nes.tenant',            COALESCE(_tenant::text, ''), false);
  PERFORM set_config('nes.tier_rank',         _tier_rank::text, false);
  PERFORM set_config('nes.tier_features',     COALESCE(_tier_features, ''), false);
END $$;

-- ---------------------------------------------------------------------------
-- PETLA runtime_test.d
--
-- Pliki wchodza POSORTOWANE PO NAZWIE, bo numer w nazwie jest jedynym
-- porzadkiem, na ktory moga sie umowic rownolegli autorzy:
--   00_ dym, 10_ sesje, 20_ zapisy, 30_ sponsorzy,
--   40_ front, 50_ obsluga na miejscu, 60_ spotkania.
--
-- DLACZEGO LISTA NIE JEST WPISANA TUTAJ. psql nie umie rozwinac katalogu
-- w polecenie `\i` - `\gexec` wykonuje SQL, nie polecenia odwrotnego ukosnika.
-- Gdyby lista plikow siedziala w tym pliku, kazdy agent dopisujacy asercje
-- musialby edytowac TEN plik, a szescioro rownoleglych autorow kolidowaloby
-- na jednej linijce. Dlatego liste generuje run.sh (`ls | sort`) do manifestu
-- i podaje jego sciezke w zmiennej `:manifest`. Dopisanie pliku do
-- runtime_test.d wystarcza, zeby wszedl do przebiegu - bez ruszania tego pliku.
--
-- Manifest niesie bezwzgledne sciezki, wiec psql raportuje bledy z prawdziwa
-- nazwa pliku i numerem linii - to jest cala roznica miedzy diagnostyka
-- a zgadywaniem.
--
-- IZOLACJA PLIKOW. Kazdy plik seeduje wlasne dane i sam po sobie sprzata albo
-- pracuje w transakcji, ktora wycofuje. Ten plik NICZEGO nie seeduje i niczego
-- nie sprzata - gdyby seedowal, pliki zaczelyby zalezec od kolejnosci.
-- ---------------------------------------------------------------------------
\echo ''
\echo '=========================================='
\echo ' ASERCJE RUNTIME MODULU WYDARZEN'
\echo '=========================================='

\i :manifest

\echo ''
\echo '=========================================='
\echo ' WSZYSTKIE ASERCJE PRZESZLY'
\echo '=========================================='
