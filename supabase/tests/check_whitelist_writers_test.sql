-- ============================================================================
-- pgTAP: strażnik klasy defektu „literał zapisywany przez funkcję spoza białej
-- listy CHECK" - dla KAŻDEJ tabeli i KAŻDEJ funkcji schematu public.
--
-- Mechanizm. Ciała PL/pgSQL nie są sprawdzane względem CHECK przy CREATE
-- FUNCTION, więc funkcja pisząca wartość spoza słownika przechodzi migrację
-- i pada dopiero przy wywołaniu (23514, wycofanie całej transakcji). Tak
-- `club_update_settings` pisała ('club_updated', 'club') do
-- `club_moderation_log` przez trzy kolejne definicje (20260905193621,
-- 20260919220300, 20261003170000), `club_propose` - `invite_source =
-- 'proposal'`, a `admin_club_invite_segment` - target_type 'club'. Druga
-- droga do tej samej awarii to zawężenie listy: słownik akcji dziennika
-- przepisywano w całości z kopii i 20260808100000 cofnęła cztery wartości.
-- Test ścieżki szczęśliwej łapie to tylko dla funkcji, które ktoś pomyślał
-- przetestować; ten plik łapie każdą.
--
-- Jak. Na PEŁNYM schemacie (wszystkie migracje):
--   1. białe listy = CHECK postaci `col = ANY (ARRAY[...])`, także z
--      `col IS NULL OR` i dodane `NOT VALID` (pg_get_constraintdef) - takie
--      ograniczenie też sprawdza każdy nowy wiersz,
--   2. leksykalizacja ciała każdej funkcji plpgsql/sql, która robi INSERT /
--      UPDATE / ON CONFLICT DO UPDATE na tabeli z białą listą,
--   3. dla każdej kolumny z listą - literały, które wyrażenie może ZAPISAĆ:
--      wyniki CASE (THEN/ELSE), COALESCE, GREATEST/LEAST, pierwszy argument
--      NULLIF, literał rzutowany na typ tekstowy. NIE są zapisem: warunki
--      WHEN, porównania, listy IN/ANY/ARRAY, argumenty innych funkcji
--      (format, left, ...), sklejenia `||`, treść $$...$$ (dynamiczny SQL)
--      i komentarze,
--   4. literał spoza KTÓREJKOLWIEK listy swojej kolumny = naruszenie.
-- Wartości płynące przez zmienne i parametry są poza zasięgiem (to robota
-- testów ścieżek szczęśliwych, np. `club_moderation_log_writers_test.sql`).
--
-- Sondy mutacyjne (sekcja 3) dowodzą, że analizator nie jest ślepy: każda
-- zakłada w public funkcję z jednym złym literałem w innej postaci zapisu;
-- sonda negatywna zbiera wszystkie postaci, które zapisem NIE są. Wszystko
-- znika z ROLLBACK.
--
-- Znane wyjątki (sekcja 2) - lista może TYLKO maleć: naprawa wyjątku czerwieni
-- ten plik, dopóki wpis nie zniknie.
-- ============================================================================
BEGIN;
SELECT plan(11);

-- 1. Leksykalizacja ciała funkcji (bajty UTF-8, O(1) dostęp).
--    kind: 'id' (identyfikator, małe litery), 'str' (literał), 'num',
--    'dol' (nieprzezroczyste ciało $tag$..$tag$), 'op'.
CREATE FUNCTION pg_temp.wl_lex(p_src text)
RETURNS TABLE (kind text, val text)
LANGUAGE plpgsql IMMUTABLE AS $f$
DECLARE
  b   bytea := convert_to(p_src, 'UTF8');
  n   integer := length(b);
  i   integer := 0;        -- get_byte liczy od 0
  j   integer;
  ch  integer;
  nx  integer;
  s   integer;
  tag bytea;
  tl  integer;
  op  text;
BEGIN
  WHILE i < n LOOP
    ch := get_byte(b, i);
    nx := CASE WHEN i + 1 < n THEN get_byte(b, i + 1) ELSE -1 END;
    IF ch IN (32, 9, 10, 13, 12) THEN
      i := i + 1;
    ELSIF ch = 45 AND nx = 45 THEN                       -- -- komentarz
      WHILE i < n AND get_byte(b, i) <> 10 LOOP i := i + 1; END LOOP;
    ELSIF ch = 47 AND nx = 42 THEN                       -- /* komentarz */
      i := i + 2;
      WHILE i + 1 < n AND NOT (get_byte(b, i) = 42 AND get_byte(b, i + 1) = 47) LOOP i := i + 1; END LOOP;
      i := i + 2;
    ELSIF ch = 39 THEN                                   -- 'literał' z ''
      s := i + 1; i := i + 1;
      LOOP
        EXIT WHEN i >= n;
        IF get_byte(b, i) = 39 THEN
          IF i + 1 < n AND get_byte(b, i + 1) = 39 THEN i := i + 2; CONTINUE; END IF;
          EXIT;
        END IF;
        i := i + 1;
      END LOOP;
      kind := 'str'; val := replace(convert_from(substring(b FROM s + 1 FOR i - s), 'UTF8'), '''''', ''''); RETURN NEXT;
      i := i + 1;
    ELSIF ch = 36 AND (nx = 36 OR nx = 95 OR (nx BETWEEN 65 AND 90) OR (nx BETWEEN 97 AND 122)) THEN
      j := i + 1;
      WHILE j < n AND (get_byte(b, j) = 95 OR get_byte(b, j) BETWEEN 48 AND 57
                       OR get_byte(b, j) BETWEEN 65 AND 90 OR get_byte(b, j) BETWEEN 97 AND 122) LOOP
        j := j + 1;
      END LOOP;
      IF j < n AND get_byte(b, j) = 36 THEN
        tag := substring(b FROM i + 1 FOR j - i + 1); tl := length(tag);
        j := position(tag IN substring(b FROM j + 2));
        i := CASE WHEN j = 0 THEN n ELSE (i + tl) + (j - 1) + tl END;
        kind := 'dol'; val := NULL; RETURN NEXT;
      ELSE
        kind := 'op'; val := '$'; RETURN NEXT; i := i + 1;
      END IF;
    ELSIF ch = 95 OR (ch BETWEEN 65 AND 90) OR (ch BETWEEN 97 AND 122) OR ch >= 128 THEN
      s := i;
      WHILE i < n AND (get_byte(b, i) IN (95, 36) OR get_byte(b, i) BETWEEN 48 AND 57
                       OR get_byte(b, i) BETWEEN 65 AND 90 OR get_byte(b, i) BETWEEN 97 AND 122
                       OR get_byte(b, i) >= 128) LOOP
        i := i + 1;
      END LOOP;
      kind := 'id'; val := lower(convert_from(substring(b FROM s + 1 FOR i - s), 'UTF8')); RETURN NEXT;
    ELSIF ch = 34 THEN                                   -- "identyfikator"
      s := i + 1; i := i + 1;
      WHILE i < n AND get_byte(b, i) <> 34 LOOP i := i + 1; END LOOP;
      kind := 'id'; val := convert_from(substring(b FROM s + 1 FOR i - s), 'UTF8'); RETURN NEXT;
      i := i + 1;
    ELSIF ch BETWEEN 48 AND 57 THEN
      WHILE i < n AND (get_byte(b, i) BETWEEN 48 AND 57 OR get_byte(b, i) = 46) LOOP i := i + 1; END LOOP;
      kind := 'num'; val := NULL; RETURN NEXT;
    ELSE
      op := convert_from(substring(b FROM i + 1 FOR 3), 'SQL_ASCII');
      IF left(op, 3) IN ('->>', '#>>') THEN op := left(op, 3);
      ELSIF left(op, 2) IN ('->', '#>', '::', ':=', '<>', '!=', '>=', '<=', '||', '?|', '?&', '~*', '!~', '=>') THEN op := left(op, 2);
      ELSE op := chr(ch);
      END IF;
      kind := 'op'; val := op; RETURN NEXT;
      i := i + length(op);
    END IF;
  END LOOP;
END;
$f$;

-- 2. Literały, które wyrażenie tk[a..b] może ZAPISAĆ do kolumny.
--    Pomija: porównania i operatory, argumenty funkcji (poza coalesce/greatest/
--    least i pierwszym argumentem nullif), listy IN/ANY/ARRAY, warunki
--    WHEN..THEN, literały rzutowane na typ nietekstowy, sklejenia ||.
CREATE FUNCTION pg_temp.wl_assigned(tk text[], tv text[], a integer, b integer)
RETURNS SETOF text
LANGUAGE plpgsql IMMUTABLE AS $f$
DECLARE
  p        integer;
  par_kind text[]  := '{}';   -- 't' przezroczysty, 'o' nieprzezroczysty, 'n' nullif
  par_arg  integer[] := '{}';
  cs_depth integer[] := '{}'; -- głębokość nawiasów, na której otwarto CASE
  cs_state text[]  := '{}';   -- 'head' | 'cond' | 'val'
  d        integer := 0;
  prv      text;
  nxt      text;
  opaque   boolean;
  k        integer;
BEGIN
  FOR p IN a..b LOOP
    prv := CASE WHEN p > a THEN tv[p - 1] END;
    IF tk[p] = 'op' AND tv[p] IN ('(', '[') THEN
      d := d + 1;
      IF tv[p] = '[' THEN par_kind := par_kind || 'o'::text;
      ELSIF prv IS NULL OR tk[p - 1] = 'op' OR prv IN ('then', 'else', 'when', 'and', 'or', 'not', 'select', 'return', 'case') THEN
        par_kind := par_kind || 't'::text;
      ELSIF prv IN ('coalesce', 'greatest', 'least') THEN par_kind := par_kind || 't'::text;
      ELSIF prv = 'nullif' THEN par_kind := par_kind || 'n'::text;
      ELSE par_kind := par_kind || 'o'::text;
      END IF;
      par_arg := par_arg || 0;
      CONTINUE;
    ELSIF tk[p] = 'op' AND tv[p] IN (')', ']') THEN
      IF d > 0 THEN
        d := d - 1;
        par_kind := par_kind[1:d]; par_arg := par_arg[1:d];
      END IF;
      CONTINUE;
    ELSIF tk[p] = 'op' AND tv[p] = ',' AND d > 0 THEN
      par_arg[d] := par_arg[d] + 1;
      CONTINUE;
    ELSIF tk[p] = 'id' AND tv[p] = 'case' THEN
      cs_depth := cs_depth || d; cs_state := cs_state || 'head'::text; CONTINUE;
    ELSIF tk[p] = 'id' AND tv[p] IN ('when', 'then', 'else', 'end')
          AND cardinality(cs_depth) > 0 AND cs_depth[cardinality(cs_depth)] = d THEN
      k := cardinality(cs_depth);
      IF tv[p] = 'when' THEN cs_state[k] := 'cond';
      ELSIF tv[p] IN ('then', 'else') THEN cs_state[k] := 'val';
      ELSE cs_depth := cs_depth[1:k - 1]; cs_state := cs_state[1:k - 1];
      END IF;
      CONTINUE;
    END IF;

    CONTINUE WHEN tk[p] <> 'str';

    opaque := false;
    FOR k IN 1..d LOOP
      IF par_kind[k] = 'o' OR (par_kind[k] = 'n' AND par_arg[k] > 0) THEN opaque := true; END IF;
    END LOOP;
    CONTINUE WHEN opaque;
    CONTINUE WHEN cardinality(cs_state) > 0 AND cs_state[cardinality(cs_state)] <> 'val';
    CONTINUE WHEN prv IN ('=', '<>', '!=', '<', '>', '<=', '>=', '~', '~*', '!~', 'like', 'ilike',
                          '||', '->', '->>', '#>', '#>>', '?', '?|', '?&', 'is', 'from', 'similar',
                          '+', '-', '*', '/', '%', 'in', 'any', 'all', 'distinct');
    nxt := CASE WHEN p < b THEN tv[p + 1] END;
    CONTINUE WHEN nxt IN ('=', '<>', '!=', '<', '>', '<=', '>=', '~', '~*', '!~', 'like', 'ilike',
                          '||', '->', '->>', '#>', '#>>', '?', '?|', '?&', 'is', '+', '-', '*', '/', '%');
    CONTINUE WHEN nxt = '::' AND p + 1 < b
                  AND tv[p + 2] NOT IN ('text', 'varchar', 'character', 'name', 'bpchar', 'citext');
    RETURN NEXT tv[p];
  END LOOP;
END;
$f$;

-- 3. Zapisy funkcji: (tabela, kolumna, literał) dla INSERT (VALUES / SELECT),
--    UPDATE ... SET i INSERT ... ON CONFLICT DO UPDATE SET.
CREATE FUNCTION pg_temp.wl_writes(p_src text)
RETURNS TABLE (tbl text, col text, lit text)
LANGUAGE plpgsql IMMUTABLE AS $f$
DECLARE
  tk   text[];
  tv   text[];
  n    integer;
  i    integer := 1;
  j    integer;
  e    integer;
  d    integer;
  cols text[];
  ci   integer;
  t    text;
  last_ins text;
  sel  boolean;
BEGIN
  SELECT array_agg(x.kind), array_agg(x.val) INTO tk, tv FROM pg_temp.wl_lex(p_src) x;
  n := coalesce(cardinality(tk), 0);
  WHILE i <= n LOOP
    -- INSERT INTO [public.]t [AS a] (kolumny) VALUES (...)[, (...)] | SELECT ...
    IF tv[i] = 'insert' AND i < n AND tv[i + 1] = 'into' AND tk[i] = 'id' THEN
      j := i + 2;
      IF tv[j] = 'public' AND tv[j + 1] = '.' THEN j := j + 2; END IF;
      t := tv[j]; j := j + 1; last_ins := t;
      IF tv[j] = 'as' THEN j := j + 2; END IF;
      IF tv[j] IS DISTINCT FROM '(' THEN i := j; CONTINUE; END IF;
      cols := '{}'; j := j + 1;
      WHILE j <= n AND tv[j] <> ')' LOOP
        IF tk[j] = 'id' THEN cols := cols || tv[j]; END IF;
        j := j + 1;
      END LOOP;
      j := j + 1;
      IF tv[j] = 'values' THEN
        j := j + 1;
        WHILE j <= n AND tv[j] = '(' LOOP
          ci := 1; d := 0; e := j + 1;
          FOR k IN j + 1..n LOOP
            IF tk[k] = 'op' AND tv[k] IN ('(', '[') THEN d := d + 1;
            ELSIF tk[k] = 'op' AND tv[k] IN (')', ']') THEN
              IF d = 0 THEN
                IF ci <= cardinality(cols) THEN
                  RETURN QUERY SELECT t, cols[ci], x FROM pg_temp.wl_assigned(tk, tv, e, k - 1) x;
                END IF;
                j := k + 1; EXIT;
              END IF;
              d := d - 1;
            ELSIF tk[k] = 'op' AND tv[k] = ',' AND d = 0 THEN
              IF ci <= cardinality(cols) THEN
                RETURN QUERY SELECT t, cols[ci], x FROM pg_temp.wl_assigned(tk, tv, e, k - 1) x;
              END IF;
              ci := ci + 1; e := k + 1;
            END IF;
          END LOOP;
          IF tv[j] = ',' THEN j := j + 1; ELSE EXIT; END IF;
        END LOOP;
      ELSIF tv[j] = 'select' THEN
        j := j + 1;
        IF tv[j] = 'distinct' THEN j := j + 1; END IF;
        ci := 1; d := 0; e := j;
        FOR k IN j..n + 1 LOOP
          IF k <= n AND tk[k] = 'op' AND tv[k] IN ('(', '[') THEN d := d + 1;
          ELSIF k <= n AND tk[k] = 'op' AND tv[k] IN (')', ']') AND d > 0 THEN d := d - 1;
          ELSIF k > n OR (d = 0 AND ((tk[k] = 'op' AND tv[k] IN (',', ';', ')'))
                OR (tk[k] = 'id' AND tv[k] IN ('from', 'where', 'on', 'returning', 'union', 'group', 'order', 'limit', 'into', 'having', 'window', 'except', 'intersect')))) THEN
            IF ci <= cardinality(cols) THEN
              -- alias "AS x" na końcu pozycji listy
              RETURN QUERY SELECT t, cols[ci], x FROM pg_temp.wl_assigned(tk, tv, e,
                CASE WHEN k - 2 >= e AND tv[k - 2] = 'as' THEN k - 3 ELSE k - 1 END) x;
            END IF;
            EXIT WHEN k > n OR tv[k] IS DISTINCT FROM ',';
            ci := ci + 1; e := k + 1;
          END IF;
        END LOOP;
      END IF;
      i := j; CONTINUE;
    END IF;

    -- UPDATE [ONLY] [public.]t [[AS] a] SET ... | ON CONFLICT ... DO UPDATE SET ...
    IF tv[i] = 'update' AND tk[i] = 'id' AND (i = 1 OR tv[i - 1] NOT IN ('for', 'of', 'before', 'after', 'or', 'instead', ',')) THEN
      j := i + 1;
      IF i > 1 AND tv[i - 1] = 'do' THEN
        t := last_ins;
      ELSE
        IF tv[j] = 'only' THEN j := j + 1; END IF;
        IF tv[j] = 'public' AND tv[j + 1] = '.' THEN j := j + 2; END IF;
        t := tv[j]; j := j + 1;
        IF tv[j] = 'as' THEN j := j + 1; END IF;
        IF tk[j] = 'id' AND tv[j] <> 'set' THEN j := j + 1; END IF;
      END IF;
      IF tv[j] IS DISTINCT FROM 'set' OR t IS NULL THEN i := i + 1; CONTINUE; END IF;
      j := j + 1; d := 0; e := j;
      FOR k IN j..n + 1 LOOP
        IF k <= n AND tk[k] = 'op' AND tv[k] IN ('(', '[') THEN d := d + 1;
        ELSIF k <= n AND tk[k] = 'op' AND tv[k] IN (')', ']') AND d > 0 THEN d := d - 1;
        ELSIF k > n OR (d = 0 AND ((tk[k] = 'op' AND tv[k] IN (',', ';', ')'))
              OR (tk[k] = 'id' AND tv[k] IN ('where', 'from', 'returning')))) THEN
          -- przypisanie: [alias.]kol = wyrażenie
          IF tk[e] = 'id' AND tv[e + 1] = '.' AND tk[e + 2] = 'id' AND tv[e + 3] = '=' THEN
            RETURN QUERY SELECT t, tv[e + 2], x FROM pg_temp.wl_assigned(tk, tv, e + 4, k - 1) x;
          ELSIF tk[e] = 'id' AND tv[e + 1] = '=' THEN
            RETURN QUERY SELECT t, tv[e], x FROM pg_temp.wl_assigned(tk, tv, e + 2, k - 1) x;
          END IF;
          EXIT WHEN k > n OR tv[k] IS DISTINCT FROM ',';
          e := k + 1;
        END IF;
      END LOOP;
      i := j; CONTINUE;
    END IF;
    i := i + 1;
  END LOOP;
END;
$f$;

-- 4. Białe listy: CHECK (col = ANY (ARRAY[...])) [z wariantem col IS NULL OR]
CREATE FUNCTION pg_temp.wl_lists()
RETURNS TABLE (tbl text, col text, allowed text[])
LANGUAGE sql STABLE AS $f$
  WITH defs AS (
    SELECT r.relname::text AS tbl, pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace ns ON ns.oid = r.relnamespace
     WHERE c.contype = 'c' AND ns.nspname = 'public'
  ), parsed AS (
    SELECT tbl,
           coalesce(m1[1], m2[2], m3[1]) AS col,
           coalesce(m1[2], m2[3], m3[2]) AS arr
      FROM defs,
           LATERAL (SELECT regexp_match(def, '^CHECK \(\((\w+) = ANY \(ARRAY\[(.*)\]\)\)\)( NOT VALID)?$') AS m1,
                           regexp_match(def, '^CHECK \(\(\((\w+) IS NULL\) OR \((\w+) = ANY \(ARRAY\[(.*)\]\)\)\)\)( NOT VALID)?$') AS m2,
                           regexp_match(def, '^CHECK \(\(\((\w+)\)::text = ANY \(\(ARRAY\[(.*)\]\)::text\[\]\)\)\)( NOT VALID)?$') AS m3) m
     WHERE coalesce(m1[1], m2[2], m3[1]) IS NOT NULL
       AND (m2 IS NULL OR m2[1] = m2[2])
  )
  SELECT p.tbl, p.col,
         array(SELECT replace(v[1], '''''', '''')
                 FROM regexp_matches(p.arr, '''((?:[^'']|'''')*)''::(?:text|character varying)', 'g') AS v)
    FROM parsed p
$f$;

-- 5. Naruszenia: literał zapisywany do kolumny spoza KTÓREJKOLWIEK jej białej listy.
CREATE FUNCTION pg_temp.wl_violations()
RETURNS TABLE (fn text, tbl text, col text, lit text, allowed text[])
LANGUAGE sql STABLE AS $f$
  WITH lists AS (SELECT * FROM pg_temp.wl_lists()),
  tabs AS (SELECT string_agg(DISTINCT tbl, '|') AS re FROM lists),
  fns AS (
    SELECT p.oid::regprocedure::text AS fn, p.prosrc
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
     CROSS JOIN tabs
     WHERE ns.nspname = 'public' AND l.lanname IN ('plpgsql', 'sql')
       AND p.prosrc ~* ('(insert\s+into|update)\s+(only\s+)?(public\.)?(' || tabs.re || ')\M')
  )
  SELECT DISTINCT f.fn, w.tbl, w.col, w.lit, l.allowed
    FROM fns f
   CROSS JOIN LATERAL pg_temp.wl_writes(f.prosrc) w
    JOIN lists l ON l.tbl = w.tbl AND l.col = w.col
   WHERE NOT (w.lit = ANY (l.allowed))
   ORDER BY 1, 2, 3, 4
$f$;

-- Sondy mutacyjne: każda pisze dokładnie jeden zły literał `zly_*`.
CREATE FUNCTION public.wl_probe_case(p boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.club_moderation_log AS l (tenant_id, club_id, moderator_id, action, target_type, target_id, reason)
  VALUES (NULL, NULL, NULL, CASE WHEN p THEN 'ban' ELSE 'zly_case' END, 'member', NULL, format('%s', 'nie_lista'));
END $$;
CREATE FUNCTION public.wl_probe_select() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO club_moderation_log (tenant_id, club_id, moderator_id, action, target_type, target_id, reason)
  SELECT c.tenant_id, c.id, NULL, 'zly_select' AS action, 'thread', c.id, 'x' FROM public.clubs c WHERE c.slug = 'abc';
END $$;
CREATE FUNCTION public.wl_probe_update() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.club_members m SET invite_source = COALESCE(NULL, 'zly_update'), role = 'member'
   WHERE m.status = 'active' AND m.invite_source IN ('neg_in');
END $$;
CREATE FUNCTION public.wl_probe_upsert() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.club_members (tenant_id, club_id, user_id, role, status, invite_source)
  VALUES (NULL, NULL, NULL, 'member', 'active', 'direct')
  ON CONFLICT (club_id, user_id) DO UPDATE SET invite_source = 'zly_upsert';
END $$;
CREATE FUNCTION public.wl_probe_multirow() RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.club_moderation_log (tenant_id, club_id, moderator_id, action, target_type, target_id)
  VALUES (NULL, NULL, NULL, 'ban', 'member', NULL), (NULL, NULL, NULL, 'unban', 'zly_multirow', NULL);
$$;
-- Sonda negatywna: literały w porównaniach, listach, argumentach funkcji,
-- NULLIF, komentarzach i dynamicznym SQL nie są zapisem.
CREATE FUNCTION public.wl_probe_neg(p text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.club_moderation_log (tenant_id, club_id, moderator_id, action, target_type, target_id, reason)
  VALUES (NULL, NULL, NULL,
          CASE WHEN p = 'neg_cmp' THEN 'ban' WHEN p IN ('neg_in1', 'neg_in2') THEN 'unban' ELSE p END,
          NULLIF(p, 'neg_nullif'),
          NULL,
          left('neg_left' || p, 10)); -- 'neg_comment'
  UPDATE public.club_members SET invite_source = p WHERE invite_source <> 'neg_where' AND role = ANY (ARRAY['neg_any']);
  PERFORM 1 FROM public.club_members WHERE invite_source = 'neg_select' FOR UPDATE;
  EXECUTE $q$ INSERT INTO public.club_moderation_log (action) VALUES ('neg_dynamic') $q$;
END $$;

-- Jedno przejście analizatora (ok. 1 s) na cały schemat razem z sondami.
CREATE TEMP TABLE wl_found ON COMMIT DROP AS
  SELECT fn, tbl, col, lit FROM pg_temp.wl_violations();

-- ----------------------------------------------------------------------------
-- 1. Analizator nie jest pusty
-- ----------------------------------------------------------------------------
SELECT ok((SELECT count(*) FROM pg_temp.wl_lists()) >= 100,
  'parser białych list rozpoznaje setki CHECK - zmiana formatu pg_get_constraintdef nie oślepi strażnika');
SELECT ok((SELECT 'club_updated' = ANY (allowed) FROM pg_temp.wl_lists()
            WHERE tbl = 'club_moderation_log' AND col = 'action'),
  'lista akcji dziennika klubów jest odczytana razem z club_updated');
SELECT ok((SELECT count(*) FROM pg_temp.wl_lists() WHERE tbl = 'notifications' AND col = 'kind') = 1,
  'lista dodana NOT VALID też jest czytana - notifications_kind_check');
SELECT ok(EXISTS (
    SELECT 1 FROM pg_proc p, pg_temp.wl_writes(p.prosrc) w
     WHERE p.oid = 'public.club_update_settings(uuid, jsonb)'::regprocedure
       AND w.tbl = 'club_moderation_log' AND w.col = 'action' AND w.lit = 'club_updated'),
  'analizator zapisów widzi literał club_updated w club_update_settings');

-- ----------------------------------------------------------------------------
-- 2. Schemat: zero naruszeń poza znanymi wyjątkami
-- ----------------------------------------------------------------------------
-- event_package_invite_accept (20260827221214) pisze source='package_invitation'
-- do event_people i event_registrations, których listy tej wartości nie znają.
-- Funkcja ma za tą blokadą trzecią (`event_package_seats_invite_pair` przy
-- konsumpcji zaproszenia) i jej odblokowanie wymaga decyzji o płatności
-- zamówienia i stanie wydarzenia - poza zakresem migracji 20261004090000.
SELECT set_eq(
  $$ SELECT fn, tbl, col, lit FROM wl_found WHERE fn NOT LIKE 'wl\_probe%' $$,
  $$ VALUES ('event_package_invite_accept(jsonb)', 'event_people', 'source', 'package_invitation'),
            ('event_package_invite_accept(jsonb)', 'event_registrations', 'source', 'package_invitation') $$,
  'żadna funkcja nie zapisuje literału spoza białej listy CHECK - poza znanymi wyjątkami');

-- ----------------------------------------------------------------------------
-- 3. Sondy mutacyjne
-- ----------------------------------------------------------------------------
SELECT set_eq($$ SELECT col, lit FROM wl_found WHERE fn = 'wl_probe_case(boolean)' $$,
  $$ VALUES ('action', 'zly_case') $$, 'sonda: gałąź ELSE wyrażenia CASE');
SELECT set_eq($$ SELECT col, lit FROM wl_found WHERE fn = 'wl_probe_select()' $$,
  $$ VALUES ('action', 'zly_select') $$, 'sonda: INSERT ... SELECT z aliasem kolumny');
SELECT set_eq($$ SELECT col, lit FROM wl_found WHERE fn = 'wl_probe_update()' $$,
  $$ VALUES ('invite_source', 'zly_update') $$, 'sonda: UPDATE ... SET przez COALESCE');
SELECT set_eq($$ SELECT col, lit FROM wl_found WHERE fn = 'wl_probe_upsert()' $$,
  $$ VALUES ('invite_source', 'zly_upsert') $$, 'sonda: ON CONFLICT DO UPDATE SET');
SELECT set_eq($$ SELECT col, lit FROM wl_found WHERE fn = 'wl_probe_multirow()' $$,
  $$ VALUES ('target_type', 'zly_multirow') $$, 'sonda: druga krotka VALUES');
SELECT is_empty($$ SELECT * FROM wl_found WHERE fn = 'wl_probe_neg(text)' $$,
  'sonda negatywna: porównania, listy, argumenty funkcji, NULLIF i dynamiczny SQL to nie zapis');

SELECT * FROM finish();
ROLLBACK;
