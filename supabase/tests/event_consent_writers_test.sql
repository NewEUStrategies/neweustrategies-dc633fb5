-- pgTAP: kto PISZE zgody osoby wydarzenia (REG-02 / REG-14) - straznik
-- statyczny na PELNYM katalogu funkcji (migracja 20261012100200).
--
-- PO CO. Kolumny `event_people.consent_marketing_at`,
-- `consent_partner_sharing_at` i `consent_withdrawn_at` sa od 20261012100100
-- PROJEKCJA ksiegi `event_consent_records`. Projekcja pisana obok ksiegi
-- (stempel bez wpisu, `consent_withdrawn_at = NULL` przy kazdym zapisie) to
-- dokladnie defekt REG-02: anonim stawial zgody cudzej osobie i zdejmowal jej
-- wycofanie. Test sciezki szczesliwej lapie to tylko w funkcji, o ktorej ktos
-- pomyslal - ten plik lapie KAZDA funkcje schematu public.
--
-- REGULA:
--   1. kolumny zgod przypisuja WYLACZNIE `_event_person_consents_confirm`
--      i `_event_person_consents_withdraw` (+ tymczasowa lista nizej);
--   2. zadna funkcja nie przypisuje `consent_withdrawn_at = NULL` (gole
--      zerowanie wycofania); jedyne zdjecie wycofania to warunkowe CASE
--      w `_event_person_consents_confirm` dla kanalu DOI.
--
-- TYMCZASOWA LISTA (moze TYLKO malec). Dzisiejsze funkcje, ktore pisza stemple
-- wprost, naleza do innych jednostek naprawy, ktore przepinaja je na funkcje
-- rejestru: `_event_cfp_resolve_person` (B3). `event_register` (B1a) zniknal
-- z listy w 20261012140000 - rdzen `_event_register` pisze zgody wylacznie
-- przez funkcje rejestru; `event_package_invite_accept` (B2) zniknal
-- w 20261012120200 - przyjecie zaproszenia tez. Jednostka,
-- ktora naprawi swoja funkcje, USUWA jej nazwe z `pg_temp.ecw_pending()` -
-- asercja 5 czerwieni plik, dopoki martwy wpis zostaje (martwy wpis to
-- przyszla furtka).
--
-- JAK. Zrodlo kazdej funkcji (plpgsql/sql) z wycietymi komentarzami
-- i literalami (lekser bajtowy jak w check_whitelist_writers_test.sql),
-- potem dwa wzorce przypisania:
--   * `<kolumna> =` bez kwalifikatora (SET w UPDATE i ON CONFLICT DO UPDATE);
--     odczyty w module sa kwalifikowane (`p.consent_...`) albo `IS [NOT]
--     NULL`, a `:=`, `>=`, `<=`, `<>` nie pasuja;
--   * lista kolumn `INSERT INTO [public.]event_people (...)`.
-- Sondy (asercje 1-2) dowodza, ze wzorce nie sa slepe ani nadgorliwe.
BEGIN;
SELECT plan(7);

-- Lekser: kod bez komentarzy, literalow '...' (z '') i cial $tag$...$tag$,
-- male litery. Bajty UTF-8 i get_byte - O(1) dostep do znaku.
CREATE FUNCTION pg_temp.ecw_code(p_src text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $f$
DECLARE
  b   bytea := convert_to(COALESCE(p_src, ''), 'UTF8');
  n   integer := length(b);
  i   integer := 0;
  j   integer;
  seg integer := 0;
  ch  integer;
  nx  integer;
  tag bytea;
  tl  integer;
  out bytea := ''::bytea;
BEGIN
  WHILE i < n LOOP
    ch := get_byte(b, i);
    nx := CASE WHEN i + 1 < n THEN get_byte(b, i + 1) ELSE -1 END;
    IF ch = 45 AND nx = 45 THEN                          -- -- komentarz
      out := out || substring(b FROM seg + 1 FOR i - seg) || '\x20'::bytea;
      WHILE i < n AND get_byte(b, i) <> 10 LOOP i := i + 1; END LOOP;
      seg := i;
    ELSIF ch = 47 AND nx = 42 THEN                       -- /* komentarz */
      out := out || substring(b FROM seg + 1 FOR i - seg) || '\x20'::bytea;
      i := i + 2;
      WHILE i + 1 < n AND NOT (get_byte(b, i) = 42 AND get_byte(b, i + 1) = 47) LOOP i := i + 1; END LOOP;
      i := LEAST(i + 2, n);
      seg := i;
    ELSIF ch = 39 THEN                                   -- 'literal' z ''
      out := out || substring(b FROM seg + 1 FOR i - seg) || '\x2727'::bytea;
      i := i + 1;
      LOOP
        EXIT WHEN i >= n;
        IF get_byte(b, i) = 39 THEN
          IF i + 1 < n AND get_byte(b, i + 1) = 39 THEN i := i + 2; CONTINUE; END IF;
          EXIT;
        END IF;
        i := i + 1;
      END LOOP;
      i := LEAST(i + 1, n);
      seg := i;
    ELSIF ch = 36 THEN                                   -- $tag$ ... $tag$ (nie $1)
      j := i + 1;
      WHILE j < n AND (get_byte(b, j) BETWEEN 97 AND 122 OR get_byte(b, j) BETWEEN 65 AND 90
                       OR get_byte(b, j) = 95 OR (j > i + 1 AND get_byte(b, j) BETWEEN 48 AND 57)) LOOP
        j := j + 1;
      END LOOP;
      IF j < n AND get_byte(b, j) = 36 THEN
        tag := substring(b FROM i + 1 FOR j - i + 1);
        tl := length(tag);
        out := out || substring(b FROM seg + 1 FOR i - seg) || '\x20'::bytea;
        i := j + 1;
        WHILE i + tl <= n AND substring(b FROM i + 1 FOR tl) <> tag LOOP i := i + 1; END LOOP;
        i := LEAST(i + tl, n);
        seg := i;
      ELSE
        i := i + 1;
      END IF;
    ELSE
      i := i + 1;
    END IF;
  END LOOP;
  out := out || substring(b FROM seg + 1 FOR n - seg);
  RETURN lower(convert_from(out, 'UTF8'));
END $f$;

-- Funkcje przypisujace kolumny zgod (nazwa; przeciazenia zlane).
CREATE FUNCTION pg_temp.ecw_writers()
RETURNS TABLE (proname name)
LANGUAGE sql STABLE AS $f$
  SELECT DISTINCT s.proname
    FROM (
      SELECT p.proname, pg_temp.ecw_code(p.prosrc) AS code
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        JOIN pg_language l ON l.oid = p.prolang
       WHERE n.nspname = 'public'
         AND l.lanname IN ('plpgsql', 'sql')
         AND p.prosrc ~* 'consent_(marketing|partner_sharing|withdrawn)_at'
    ) s
   WHERE s.code ~ '(^|[^a-z0-9_.])consent_(marketing|partner_sharing|withdrawn)_at\s*=(?![=>])'
      OR EXISTS (
        SELECT 1
          FROM regexp_matches(s.code,
                 'insert\s+into\s+(?:public\.)?event_people\M\s*(?:as\s+[a-z_][a-z0-9_]*\s*)?\(([^)]*)\)', 'g') AS m
         WHERE m[1] ~ 'consent_(marketing|partner_sharing|withdrawn)_at'
      )
$f$;

-- Funkcje z golym zerowaniem wycofania.
CREATE FUNCTION pg_temp.ecw_withdrawal_nullers()
RETURNS TABLE (proname name)
LANGUAGE sql STABLE AS $f$
  SELECT DISTINCT p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
   WHERE n.nspname = 'public'
     AND l.lanname IN ('plpgsql', 'sql')
     AND p.prosrc ~* 'consent_withdrawn_at'
     AND pg_temp.ecw_code(p.prosrc) ~ '(^|[^a-z0-9_.])consent_withdrawn_at\s*=\s*null\M'
$f$;

-- TYMCZASOWA LISTA - patrz naglowek. Moze tylko malec.
CREATE FUNCTION pg_temp.ecw_pending()
RETURNS TABLE (proname name)
LANGUAGE sql IMMUTABLE AS $f$
  VALUES ('_event_cfp_resolve_person'::name)    -- B3: marketing przez _event_person_consents_confirm
$f$;

-- ── 1-2. Sondy: wzorce nie sa slepe ani nadgorliwe ──────────────────────────
CREATE FUNCTION public.ecw_probe_update(p_id uuid) RETURNS void LANGUAGE plpgsql AS $p$
BEGIN
  UPDATE public.event_people p SET first_name = p.first_name,
    consent_marketing_at = now()
   WHERE p.id = p_id;
END $p$;
CREATE FUNCTION public.ecw_probe_insert(p_tenant uuid) RETURNS void LANGUAGE sql AS $p$
  INSERT INTO public.event_people (tenant_id, first_name, last_name,
                                   consent_partner_sharing_at)
  VALUES (p_tenant, 'a', 'b', now());
$p$;
CREATE FUNCTION public.ecw_probe_conflict(p_tenant uuid) RETURNS void LANGUAGE plpgsql AS $p$
BEGIN
  INSERT INTO public.event_people AS p (tenant_id, first_name, last_name)
  VALUES (p_tenant, 'a', 'b')
  ON CONFLICT (id) DO UPDATE SET consent_withdrawn_at = NULL;
END $p$;
-- Same odczyty i wzmianki: kwalifikowane porownanie, IS NULL, przypisanie
-- do pola rekordu, komentarz, literal i klucz jsonb - nic z tego nie jest
-- zapisem kolumny.
CREATE FUNCTION public.ecw_probe_reader(p_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $p$
DECLARE
  v public.event_people%ROWTYPE;
BEGIN
  -- consent_marketing_at = now() w komentarzu
  /* consent_withdrawn_at = NULL w komentarzu blokowym */
  SELECT * INTO v FROM public.event_people p
   WHERE p.id = p_id AND p.consent_marketing_at = now() AND p.consent_withdrawn_at IS NULL;
  v.consent_partner_sharing_at := now();
  RAISE NOTICE 'consent_withdrawn_at = NULL %', 'consent_marketing_at = now()';
  RETURN jsonb_build_object('consent_marketing_at', v.consent_marketing_at,
                            'x', v.consent_marketing_at >= now());
END $p$;

SELECT set_eq(
  $$SELECT proname FROM pg_temp.ecw_writers() WHERE proname::text LIKE 'ecw\_probe\_%'$$,
  $$VALUES ('ecw_probe_update'::name), ('ecw_probe_insert'::name), ('ecw_probe_conflict'::name)$$,
  'sondy: SET w UPDATE, lista kolumn INSERT i ON CONFLICT DO UPDATE wykryte; odczyty, komentarze i literaly nie');
SELECT set_eq(
  $$SELECT proname FROM pg_temp.ecw_withdrawal_nullers() WHERE proname::text LIKE 'ecw\_probe\_%'$$,
  $$VALUES ('ecw_probe_conflict'::name)$$,
  'sondy: gole consent_withdrawn_at = NULL wykryte, tekst w komentarzu i literale nie');

DROP FUNCTION public.ecw_probe_update(uuid);
DROP FUNCTION public.ecw_probe_insert(uuid);
DROP FUNCTION public.ecw_probe_conflict(uuid);
DROP FUNCTION public.ecw_probe_reader(uuid);

-- ── 3-5. Pisarze projekcji ──────────────────────────────────────────────────
SELECT set_eq(
  $$SELECT proname FROM pg_temp.ecw_writers()
     WHERE proname IN ('_event_person_consents_confirm', '_event_person_consents_withdraw')$$,
  $$VALUES ('_event_person_consents_confirm'::name), ('_event_person_consents_withdraw'::name)$$,
  'funkcje rejestru sa pisarzami projekcji (analizator je widzi)');
SELECT is_empty(
  $$SELECT proname FROM pg_temp.ecw_writers()
    EXCEPT SELECT proname FROM pg_temp.ecw_pending()
    EXCEPT VALUES ('_event_person_consents_confirm'::name), ('_event_person_consents_withdraw'::name)$$,
  'kolumny zgod event_people pisza WYLACZNIE _event_person_consents_confirm/_withdraw (+ tymczasowa lista)');
SELECT is_empty(
  $$SELECT proname FROM pg_temp.ecw_pending()
    EXCEPT SELECT proname FROM pg_temp.ecw_writers()$$,
  'tymczasowa lista bez martwych wpisow (naprawiona funkcja znika z listy)');

-- ── 6-7. Zerowanie wycofania ────────────────────────────────────────────────
SELECT is_empty(
  $$SELECT proname FROM pg_temp.ecw_withdrawal_nullers()
    EXCEPT SELECT proname FROM pg_temp.ecw_pending()$$,
  'zadna funkcja (poza tymczasowa lista) nie zeruje consent_withdrawn_at = NULL');
SELECT ok(
  pg_temp.ecw_code((SELECT prosrc FROM pg_proc
                     WHERE oid = 'public._event_person_consents_confirm(uuid,uuid,text[],text,uuid,uuid,uuid,integer,text,text,text,uuid,text,boolean)'::regprocedure))
    ~ 'consent_withdrawn_at\s*=\s*case\s+when\s+v_grants\s+and\s+p_evidence\s*=\s*''''\s+then\s+null',
  'jedyne zdjecie wycofania: warunkowe CASE kanalu DOI w _event_person_consents_confirm');

SELECT * FROM finish();
ROLLBACK;
