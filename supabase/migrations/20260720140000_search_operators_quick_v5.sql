-- Wyszukiwarka v5: operatory boolowskie AND / OR / NOT + search_quick premium.
--
-- Kontekst:
--   * Widget wyszukiwarki w nagłówku od migracji premium_search podpowiada
--     operatory AND / OR / NOT i wstawia je do zapytania, ale parser
--     nes_search_tsquery_adv traktował je jak zwykłe słowa: "ukraina AND nato"
--     wymagało w treści dosłownego słowa "and". Ta migracja czyni operatory
--     prawdziwymi operatorami.
--   * search_quick (paleta poleceń ⌘K + serwerowy globalSearch) tkwił na
--     parserze v1 (nes_search_tsquery): bez polskiej fleksji, bez składni
--     "fraza"/-wykluczenie i bez tolerancji literówek. Wyrównujemy go z
--     resztą wyszukiwarki (parser adv + trigramowy fallback na tytułach).
--
-- Zakres:
--   1. nes_search_positive_rest: wspólny helper "pozytywnej reszty" zapytania
--      (bez -wykluczeń, NOT <atom>, tokenów AND/OR i cudzysłowów) - dotąd
--      inline'owany w search_posts/search_facets; steruje trybem przeglądania
--      i fallbackiem trigramowym.
--   2. nes_search_tsquery_adv v2: operatory AND / OR / NOT (TYLKO wielkimi
--      literami - konwencja Google/Scopus; małe "and/or/not" pozostają
--      zwykłymi słowami, więc naturalne frazy EN nie zmieniają znaczenia).
--      OR wiąże sąsiednie atomy w grupę alternatywy ("a b OR c" = a & (b|c),
--      jak w Google), NOT wyklucza następny atom (odpowiednik prefiksu "-"),
--      AND jest jawnym zapisem domyślnego złączenia. Reszta kontraktu bez
--      zmian: unaccent+lower, sanityzacja [a-z0-9], polska fleksja
--      (rdzeń OR-owany z surowym termem), "frazy" przez <->, tryby
--      all/any/phrase, puste/negatywne wejście -> NULL.
--   3. search_posts v5 / search_facets v3: te same sygnatury i ciała co v4/v2,
--      jedynie CTE nq korzysta z helpera (spójna obsługa NOT/AND/OR w trybie
--      przeglądania i fallbacku literówek).
--   4. search_quick v2: parser adv (fleksja, frazy, wykluczenia, operatory)
--      + trigramowy fallback literówek na tytułach postów i stron, świeżość
--      jako tie-break. Sygnatura i kształt wyniku BEZ ZMIAN (klient palety
--      i MCP działają bez modyfikacji).
--
-- Konwencje jak w 20260714130000 / 20260717120000:
--   * SECURITY DEFINER + tenant rozstrzygany WYŁĄCZNIE serwerowo,
--   * search_path = public, extensions,
--   * zmiany addytywne/wewnętrzne - żaden wywołujący nie wymaga zmian.

-- 1. POZYTYWNA RESZTA ZAPYTANIA ------------------------------------------------
-- Usuwa z zapytania -wykluczenia, "NOT <atom>", samodzielne tokeny AND/OR oraz
-- cudzysłowy; normalizuje (unaccent+lower) i składa białe znaki. Wynik '' czyta
-- się jako "brak pozytywnej treści" (tryb przeglądania). Operatory wykrywamy
-- PRZED lower() - liczą się tylko WIELKIE litery, jak w parserze.

CREATE OR REPLACE FUNCTION public.nes_search_positive_rest(_q text)
RETURNS text
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public, extensions
AS $$
  -- Kolejność: (1) NOT + atom (granicę słowa gwarantuje \s+ - "NOTHING" nie
  -- jest operatorem), (2) samodzielne AND/OR/NOT z lookaheadem granicy
  -- ("ANDROID"/"OREO" zostają słowami), (3) lower/unaccent, (4) -wykluczenia,
  -- (5) zbicie cudzysłowów i białych znaków.
  SELECT btrim(regexp_replace(regexp_replace(
           unaccent(lower(
             regexp_replace(
               regexp_replace(
                 regexp_replace(coalesce(_q, ''), '[„”“«»]', '"', 'g'),
                 '(^|\s)NOT\s+("[^"]*"|[^\s"]+)', ' ', 'g'),
               '(^|\s)(AND|OR|NOT)(?=\s|$)', ' ', 'g')
           )),
           '(^|\s)-("[^"]*"|[^\s"]+)', ' ', 'g'),
         '["\s]+', ' ', 'g'))
$$;

COMMENT ON FUNCTION public.nes_search_positive_rest(text) IS
  'Pozytywna reszta zapytania wyszukiwarki: bez -wykluczeń, NOT <atom>, '
  'tokenów AND/OR (wielkimi literami) i cudzysłowów; unaccent+lower. '
  'Pusty wynik = tryb przeglądania; niepusty zasila fallback trigramowy.';

-- 2. PARSER ZAPYTAŃ v2: operatory AND / OR / NOT --------------------------------
-- Tokenizacja biegnie po wejściu Z ZACHOWANĄ wielkością liter (operatory
-- rozpoznajemy tylko WIELKIMI), a każdy atom jest normalizowany osobno
-- (unaccent+lower+sanityzacja) - semantyka pojedynczych termów identyczna
-- z v1. Grupy alternatywy renderują się jako (a | b), grupy łączą się AND-em
-- (tryb all) albo OR-em (tryb any); wykluczenia zawsze AND-em (& !x).

CREATE OR REPLACE FUNCTION public.nes_search_tsquery_adv(
  _q text,
  _match text DEFAULT 'all'
)
RETURNS tsquery
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
DECLARE
  -- Cudzysłowy typograficzne normalizujemy PRZED unaccent (unaccent zamienia
  -- „ na ,, i fraza przestałaby być rozpoznawalna). Wielkość liter zostaje -
  -- potrzebna do wykrycia operatorów.
  v_src    text := regexp_replace(coalesce(_q, ''), '[„”“«»]', '"', 'g');
  v_match  text := CASE WHEN _match IN ('all','any','phrase') THEN _match ELSE 'all' END;
  v_words  text[];
  v_parts  text[];
  v_groups text[] := '{}'; -- zamknięte grupy pozytywne (wewnątrz OR-owane)
  v_group  text[] := '{}'; -- grupa aktualnie budowana
  v_not    text[] := '{}';
  v_neg    boolean := false; -- następny atom to wykluczenie (operator NOT)
  v_or     boolean := false; -- następny atom dokleja się do bieżącej grupy
  v_raw    text;
  v_stem   text;
  v_expr   text;
  m        text[];
BEGIN
  IF btrim(v_src) = '' THEN
    RETURN NULL;
  END IF;

  -- Tryb "phrase": całość jako jedna fraza (kolejne słowa muszą sąsiadować).
  IF v_match = 'phrase' THEN
    SELECT array_agg(w) INTO v_words
      FROM (
        SELECT regexp_replace(unaccent(lower(x)), '[^a-z0-9]', '', 'g') AS w
        FROM unnest(regexp_split_to_array(v_src, '\s+')) AS x
      ) s
     WHERE w <> '';
    IF v_words IS NULL THEN
      RETURN NULL;
    END IF;
    RETURN to_tsquery('simple', array_to_string(v_words, ' <-> '));
  END IF;

  -- Tokeny: (-)"fraza" | (-)słowo. Grupy: m[1]/m[2] = fraza, m[3]/m[4] = słowo.
  FOR m IN
    SELECT regexp_matches(v_src, '(-)?"([^"]+)"|(-)?([^\s"]+)', 'g')
  LOOP
    -- Operatory boolowskie: tylko goły token pisany WIELKIMI literami.
    IF m[2] IS NULL AND m[3] IS NULL AND m[4] IN ('AND', 'OR', 'NOT') THEN
      IF m[4] = 'OR' THEN
        -- OR bez lewego atomu (początek zapytania) jest ignorowany.
        IF array_length(v_group, 1) IS NOT NULL THEN
          v_or := true;
        END IF;
      ELSIF m[4] = 'NOT' THEN
        v_neg := true;
      ELSE
        v_or := false; -- AND = jawny zapis domyślnego złączenia grup
      END IF;
      CONTINUE;
    END IF;

    IF m[2] IS NOT NULL THEN
      -- "fraza" -> sąsiedztwo (<->); każde słowo normalizowane osobno.
      SELECT array_agg(w) INTO v_parts
        FROM (
          SELECT regexp_replace(unaccent(lower(x)), '[^a-z0-9]', '', 'g') AS w
          FROM unnest(regexp_split_to_array(m[2], '\s+')) AS x
        ) s
       WHERE w <> '';
      IF v_parts IS NULL THEN
        CONTINUE;
      END IF;
      v_expr := CASE WHEN array_length(v_parts, 1) = 1 THEN v_parts[1]
                     ELSE '(' || array_to_string(v_parts, ' <-> ') || ')' END;
      IF m[1] IS NOT NULL OR v_neg THEN
        v_not := v_not || v_expr;
      ELSE
        IF v_or AND array_length(v_group, 1) IS NOT NULL THEN
          v_group := v_group || v_expr;
        ELSE
          IF array_length(v_group, 1) IS NOT NULL THEN
            v_groups := v_groups || CASE WHEN array_length(v_group, 1) = 1 THEN v_group[1]
                                         ELSE '(' || array_to_string(v_group, ' | ') || ')' END;
          END IF;
          v_group := ARRAY[v_expr];
        END IF;
      END IF;
    ELSE
      v_raw := regexp_replace(unaccent(lower(coalesce(m[4], ''))), '[^a-z0-9]', '', 'g');
      IF v_raw = '' THEN
        CONTINUE;
      END IF;
      IF m[3] IS NOT NULL OR v_neg THEN
        -- Wykluczenie prefiksowe: -nato / NOT nato odcina też "natowski" itd.
        v_not := v_not || (v_raw || ':*');
      ELSE
        v_stem := public.nes_pl_light_stem(v_raw);
        IF v_stem <> v_raw THEN
          v_expr := '(' || v_raw || ':* | ' || v_stem || ':*)';
        ELSE
          v_expr := v_raw || ':*';
        END IF;
        IF v_or AND array_length(v_group, 1) IS NOT NULL THEN
          v_group := v_group || v_expr;
        ELSE
          IF array_length(v_group, 1) IS NOT NULL THEN
            v_groups := v_groups || CASE WHEN array_length(v_group, 1) = 1 THEN v_group[1]
                                         ELSE '(' || array_to_string(v_group, ' | ') || ')' END;
          END IF;
          v_group := ARRAY[v_expr];
        END IF;
      END IF;
    END IF;

    -- Flagi operatorów konsumuje najbliższy atom.
    v_neg := false;
    v_or := false;
  END LOOP;

  -- Domknij ostatnią budowaną grupę.
  IF array_length(v_group, 1) IS NOT NULL THEN
    v_groups := v_groups || CASE WHEN array_length(v_group, 1) = 1 THEN v_group[1]
                                 ELSE '(' || array_to_string(v_group, ' | ') || ')' END;
  END IF;

  IF array_length(v_groups, 1) IS NULL THEN
    -- Zapytanie złożone wyłącznie z wykluczeń/operatorów -> NULL (tryb
    -- przeglądania; nigdy "wszystko poza X" na całym archiwum).
    RETURN NULL;
  END IF;

  v_expr := array_to_string(v_groups, CASE WHEN v_match = 'any' THEN ' | ' ELSE ' & ' END);
  IF v_match = 'any' AND array_length(v_groups, 1) > 1 THEN
    v_expr := '(' || v_expr || ')';
  END IF;
  IF array_length(v_not, 1) IS NOT NULL THEN
    v_expr := v_expr || ' & !' || array_to_string(v_not, ' & !');
  END IF;

  RETURN to_tsquery('simple', v_expr);
EXCEPTION WHEN others THEN
  -- Awaryjnie: nigdy nie wywracaj wyszukiwarki na egzotycznym wejściu.
  RETURN plainto_tsquery('simple', unaccent(lower(coalesce(_q, ''))));
END;
$$;

COMMENT ON FUNCTION public.nes_search_tsquery_adv(text, text) IS
  'Zaawansowany parser zapytań v2: "frazy" (<->), -wykluczenia (& !), operatory '
  'AND/OR/NOT wielkimi literami (OR wiąże sąsiednie atomy jak w Google), tryby '
  'all/any/phrase; poza tym kontrakt v1 (unaccent, sanityzacja, polska fleksja, '
  'puste wejście -> NULL).';

-- 3. search_posts v5 ------------------------------------------------------------
-- Ciało identyczne z v4 (20260717120000_premium_search.sql); jedyna zmiana:
-- CTE nq korzysta z nes_search_positive_rest (spójne traktowanie NOT/AND/OR
-- w trybie przeglądania i fallbacku trigramowym). Sygnatura bez zmian.

CREATE OR REPLACE FUNCTION public.search_posts(
  _q text DEFAULT NULL,
  _limit int DEFAULT 80,
  _author uuid DEFAULT NULL,
  _date_from timestamptz DEFAULT NULL,
  _date_to timestamptz DEFAULT NULL,
  _category uuid DEFAULT NULL,
  _terms uuid[] DEFAULT NULL,
  _format text DEFAULT NULL,
  _lang text DEFAULT NULL,
  _access text DEFAULT NULL,
  _sort text DEFAULT 'relevance',
  _match text DEFAULT 'all',
  _in text DEFAULT 'all'
)
RETURNS TABLE (
  id uuid, slug text, title_pl text, title_en text,
  excerpt_pl text, excerpt_en text, cover_image_url text,
  published_at timestamptz, parent_page_id uuid, author_id uuid, rank real,
  headline_pl text, headline_en text,
  post_format text, access_mode text, fuzzy boolean, total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH RECURSIVE ctx AS (
    SELECT coalesce(public.current_tenant_id(), public.public_tenant_id()) AS tid
  ),
  tq AS (SELECT public.nes_search_tsquery_adv(_q, _match) AS q),
  -- Pozytywna reszta zapytania (bez -wykluczeń, NOT <atom>, AND/OR i cudzysłowów):
  -- steruje trybem przeglądania (pusta reszta = przeglądanie, także dla samych
  -- wykluczeń) i fallbackiem trigramowym (literówki liczone tylko na pozytywach).
  nq AS (SELECT public.nes_search_positive_rest(_q) AS q),
  term_tree AS (
    SELECT t.term_id AS root, t.term_id AS match_id, 0 AS depth
      FROM unnest(coalesce(_terms, '{}'::uuid[])) AS t(term_id)
    UNION ALL
    SELECT tt.root, c.id, tt.depth + 1
      FROM public.categories c
      JOIN term_tree tt ON c.parent_id = tt.match_id
     WHERE tt.depth < 10 -- tama na ewentualny cykl parent↔dziecko w danych
  ),
  base AS (
    SELECT p.id, p.slug, p.title_pl, p.title_en, p.excerpt_pl, p.excerpt_en,
           p.cover_image_url, p.published_at, p.parent_page_id, p.author_id,
           p.post_format, p.search_vector,
           coalesce(ca.mode::text, 'public') AS eff_access
      FROM public.posts p
      JOIN ctx ON p.tenant_id = ctx.tid
      LEFT JOIN public.content_access ca
        ON ca.entity_type = 'post' AND ca.entity_id = p.id
     WHERE p.status = 'published'
       AND p.deleted_at IS NULL
       AND (_author IS NULL OR p.author_id = _author)
       AND (_date_from IS NULL OR p.published_at >= _date_from)
       AND (_date_to IS NULL OR p.published_at <= _date_to)
       AND (_category IS NULL OR EXISTS (
             SELECT 1 FROM public.post_categories pc
              WHERE pc.post_id = p.id AND pc.category_id = _category))
       AND (_format IS NULL OR p.post_format = _format)
       AND (_lang IS NULL
            OR (_lang = 'pl' AND btrim(p.title_pl) <> '')
            OR (_lang = 'en' AND btrim(p.title_en) <> ''))
       AND (_access IS NULL OR coalesce(ca.mode::text, 'public') = _access)
       AND (_terms IS NULL OR NOT EXISTS (
             SELECT 1 FROM unnest(_terms) AS req(term_id)
              WHERE NOT EXISTS (
                SELECT 1 FROM public.post_categories pc
                JOIN term_tree tt
                  ON tt.match_id = pc.category_id AND tt.root = req.term_id
                WHERE pc.post_id = p.id)))
  ),
  fts AS (
    SELECT b.*, ts_rank_cd(b.search_vector, tq.q)::real AS rank, false AS fuzzy
      FROM base b, tq
     WHERE tq.q IS NOT NULL
       AND b.search_vector @@ tq.q
       AND (_in IS DISTINCT FROM 'title'
            OR to_tsvector('simple', unaccent(
                 coalesce(b.title_pl, '') || ' ' || coalesce(b.title_en, ''))) @@ tq.q)
  ),
  trgm AS (
    SELECT b.*,
           GREATEST(
             word_similarity(nq.q, unaccent(lower(coalesce(b.title_pl, '')))),
             word_similarity(nq.q, unaccent(lower(coalesce(b.title_en, ''))))
           )::real AS rank,
           true AS fuzzy
      FROM base b, nq
     WHERE length(nq.q) >= 4
       AND NOT EXISTS (SELECT 1 FROM fts)
       AND GREATEST(
             word_similarity(nq.q, unaccent(lower(coalesce(b.title_pl, '')))),
             word_similarity(nq.q, unaccent(lower(coalesce(b.title_en, ''))))
           ) > 0.3
  ),
  browse AS (
    SELECT b.*, 0::real AS rank, false AS fuzzy
      FROM base b, nq
     WHERE nq.q = ''
  ),
  hits AS (
    SELECT * FROM fts
    UNION ALL SELECT * FROM trgm
    UNION ALL SELECT * FROM browse
  ),
  pop AS (
    SELECT v.post_id, count(*) AS views
      FROM public.post_views v
     WHERE _sort = 'popular'
       AND v.viewed_at > now() - interval '90 days'
     GROUP BY v.post_id
  ),
  ranked AS (
    SELECT h.id, h.slug, h.title_pl, h.title_en, h.excerpt_pl, h.excerpt_en,
           h.cover_image_url, h.published_at, h.parent_page_id, h.author_id,
           h.post_format, h.eff_access, h.rank, h.fuzzy,
           (count(*) OVER ())::bigint AS total_count,
           row_number() OVER (ORDER BY
             CASE WHEN _sort = 'popular' THEN coalesce(pop.views, 0) END DESC NULLS LAST,
             CASE WHEN coalesce(_sort, 'relevance') NOT IN ('newest','popular') THEN h.rank END DESC NULLS LAST,
             h.published_at DESC NULLS LAST,
             h.id
           ) AS rn
      FROM hits h
      LEFT JOIN pop ON pop.post_id = h.id
  ),
  page AS (
    SELECT * FROM ranked WHERE rn <= GREATEST(LEAST(_limit, 200), 1)
  )
  SELECT pg.id, pg.slug, pg.title_pl, pg.title_en, pg.excerpt_pl, pg.excerpt_en,
         pg.cover_image_url, pg.published_at, pg.parent_page_id, pg.author_id,
         pg.rank,
         CASE WHEN tq.q IS NOT NULL AND NOT pg.fuzzy THEN ts_headline(
           'simple',
           left(coalesce(pg.excerpt_pl, '') || ' ' ||
                regexp_replace(coalesce(p.content_pl, ''), '<[^>]+>', ' ', 'g'), 4000),
           tq.q,
           'StartSel=[[[, StopSel=]]], MaxWords=28, MinWords=12, ShortWord=2, MaxFragments=1'
         ) END AS headline_pl,
         CASE WHEN tq.q IS NOT NULL AND NOT pg.fuzzy THEN ts_headline(
           'simple',
           left(coalesce(pg.excerpt_en, '') || ' ' ||
                regexp_replace(coalesce(p.content_en, ''), '<[^>]+>', ' ', 'g'), 4000),
           tq.q,
           'StartSel=[[[, StopSel=]]], MaxWords=28, MinWords=12, ShortWord=2, MaxFragments=1'
         ) END AS headline_en,
         pg.post_format, pg.eff_access AS access_mode, pg.fuzzy, pg.total_count
    FROM page pg
    JOIN public.posts p ON p.id = pg.id
    CROSS JOIN tq
   ORDER BY pg.rn;
$$;

REVOKE ALL ON FUNCTION public.search_posts(
  text, int, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text, text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_posts(
  text, int, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text, text, text, text
) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.search_posts(
  text, int, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text, text, text, text
) IS
  'Fasetowe wyszukiwanie archiwum v5: jak v4 plus operatory AND/OR/NOT '
  '(parser adv v2) i wspólny helper pozytywnej reszty zapytania.';

-- 4. search_facets v3 -----------------------------------------------------------
-- Jak v2 (20260717120000_premium_search.sql); zmiana wyłącznie w CTE nq.

CREATE OR REPLACE FUNCTION public.search_facets(
  _q text DEFAULT NULL,
  _author uuid DEFAULT NULL,
  _date_from timestamptz DEFAULT NULL,
  _date_to timestamptz DEFAULT NULL,
  _category uuid DEFAULT NULL,
  _terms uuid[] DEFAULT NULL,
  _format text DEFAULT NULL,
  _lang text DEFAULT NULL,
  _access text DEFAULT NULL,
  _match text DEFAULT 'all',
  _in text DEFAULT 'all'
)
RETURNS TABLE (
  dim text, id uuid, slug text, label_pl text, label_en text,
  parent_id uuid, cnt bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH RECURSIVE ctx AS (
    SELECT coalesce(public.current_tenant_id(), public.public_tenant_id()) AS tid
  ),
  tq AS (SELECT public.nes_search_tsquery_adv(_q, _match) AS q),
  nq AS (SELECT public.nes_search_positive_rest(_q) AS q),
  term_tree AS (
    SELECT t.term_id AS root, t.term_id AS match_id, 0 AS depth
      FROM unnest(coalesce(_terms, '{}'::uuid[])) AS t(term_id)
    UNION ALL
    SELECT tt.root, c.id, tt.depth + 1
      FROM public.categories c
      JOIN term_tree tt ON c.parent_id = tt.match_id
     WHERE tt.depth < 10 -- tama na ewentualny cykl parent↔dziecko w danych
  ),
  base AS (
    SELECT p.id, p.author_id, p.post_format, p.published_at,
           p.title_pl, p.title_en, p.search_vector,
           coalesce(ca.mode::text, 'public') AS eff_access
      FROM public.posts p
      JOIN ctx ON p.tenant_id = ctx.tid
      LEFT JOIN public.content_access ca
        ON ca.entity_type = 'post' AND ca.entity_id = p.id
     WHERE p.status = 'published'
       AND p.deleted_at IS NULL
       AND (_author IS NULL OR p.author_id = _author)
       AND (_date_from IS NULL OR p.published_at >= _date_from)
       AND (_date_to IS NULL OR p.published_at <= _date_to)
       AND (_category IS NULL OR EXISTS (
             SELECT 1 FROM public.post_categories pc
              WHERE pc.post_id = p.id AND pc.category_id = _category))
       AND (_format IS NULL OR p.post_format = _format)
       AND (_lang IS NULL
            OR (_lang = 'pl' AND btrim(p.title_pl) <> '')
            OR (_lang = 'en' AND btrim(p.title_en) <> ''))
       AND (_access IS NULL OR coalesce(ca.mode::text, 'public') = _access)
       AND (_terms IS NULL OR NOT EXISTS (
             SELECT 1 FROM unnest(_terms) AS req(term_id)
              WHERE NOT EXISTS (
                SELECT 1 FROM public.post_categories pc
                JOIN term_tree tt
                  ON tt.match_id = pc.category_id AND tt.root = req.term_id
                WHERE pc.post_id = p.id)))
  ),
  fts AS (
    SELECT b.* FROM base b, tq
     WHERE tq.q IS NOT NULL
       AND b.search_vector @@ tq.q
       AND (_in IS DISTINCT FROM 'title'
            OR to_tsvector('simple', unaccent(
                 coalesce(b.title_pl, '') || ' ' || coalesce(b.title_en, ''))) @@ tq.q)
  ),
  trgm AS (
    SELECT b.*
      FROM base b, nq
     WHERE length(nq.q) >= 4
       AND NOT EXISTS (SELECT 1 FROM fts)
       AND GREATEST(
             word_similarity(nq.q, unaccent(lower(coalesce(b.title_pl, '')))),
             word_similarity(nq.q, unaccent(lower(coalesce(b.title_en, ''))))
           ) > 0.3
  ),
  browse AS (
    SELECT b.* FROM base b, nq WHERE nq.q = ''
  ),
  matched AS (
    SELECT * FROM fts
    UNION ALL SELECT * FROM trgm
    UNION ALL SELECT * FROM browse
  ),
  vocab_tree AS (
    SELECT c.id AS root, c.id AS match_id, 0 AS depth
      FROM public.categories c, ctx
     WHERE c.tenant_id = ctx.tid
    UNION ALL
    SELECT vt.root, c.id, vt.depth + 1
      FROM public.categories c
      JOIN vocab_tree vt ON c.parent_id = vt.match_id
     WHERE vt.depth < 10 -- tama na ewentualny cykl parent↔dziecko w danych
  )
  SELECT c.kind AS dim, c.id, c.slug, c.name_pl AS label_pl, c.name_en AS label_en,
         c.parent_id, count(DISTINCT m.id) AS cnt
    FROM matched m
    JOIN public.post_categories pc ON pc.post_id = m.id
    JOIN vocab_tree vt ON vt.match_id = pc.category_id
    JOIN public.categories c ON c.id = vt.root
   GROUP BY c.kind, c.id, c.slug, c.name_pl, c.name_en, c.parent_id
  UNION ALL
  SELECT 'author', pr.id, pr.slug, coalesce(pr.display_name, 'Autor'),
         coalesce(pr.display_name, 'Author'), NULL, count(*)::bigint
    FROM matched m
    JOIN public.profiles pr ON pr.id = m.author_id
   GROUP BY pr.id, pr.slug, pr.display_name
  UNION ALL
  SELECT 'format', NULL, m.post_format, m.post_format, m.post_format, NULL,
         count(*)::bigint
    FROM matched m
   GROUP BY m.post_format
  UNION ALL
  SELECT 'lang', NULL, l.code, l.code, l.code, NULL, count(*)::bigint
    FROM matched m
    CROSS JOIN LATERAL (
      SELECT 'pl'::text AS code WHERE btrim(m.title_pl) <> ''
      UNION ALL
      SELECT 'en' WHERE btrim(m.title_en) <> ''
    ) l
   GROUP BY l.code
  UNION ALL
  SELECT 'access', NULL, m.eff_access, m.eff_access, m.eff_access, NULL,
         count(*)::bigint
    FROM matched m
   GROUP BY m.eff_access
  UNION ALL
  SELECT 'year', NULL, y.year_slug, y.year_slug, y.year_slug, NULL,
         count(*)::bigint
    FROM (
      SELECT extract(year FROM m.published_at)::int::text AS year_slug
        FROM matched m
       WHERE m.published_at IS NOT NULL
    ) y
   GROUP BY y.year_slug;
$$;

REVOKE ALL ON FUNCTION public.search_facets(
  text, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_facets(
  text, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text, text, text
) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.search_facets(
  text, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text, text, text
) IS
  'Liczniki fasetowe v3: jak v2 plus operatory AND/OR/NOT (parser adv v2) '
  'i wspólny helper pozytywnej reszty zapytania.';

-- 5. search_quick v2 ------------------------------------------------------------
-- Paleta poleceń (⌘K) i serwerowy globalSearch. Zmiany wyłącznie wewnętrzne
-- (sygnatura i kształt wyniku bez zmian):
--   * parser adv v2 (polska fleksja, "frazy", -wykluczenia, AND/OR/NOT) zamiast
--     parsera v1 - te same frazy zwracają to samo co /search,
--   * trigramowy fallback literówek na tytułach postów I stron, gdy FTS nie
--     trafi nic ("ukrainia" znajdzie "Ukraina..."),
--   * świeżość (published_at/updated_at) jako tie-break rankingu.

CREATE OR REPLACE FUNCTION public.search_quick(
  _q text,
  _limit int DEFAULT 12
)
RETURNS TABLE (kind text, id uuid, slug text, title_pl text, title_en text, rank real)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH ctx AS (
    -- Tenant wyłącznie serwerowo (jak w search_posts) - bez parametru klienta.
    SELECT coalesce(public.current_tenant_id(), public.public_tenant_id()) AS tid
  ),
  tq AS (SELECT public.nes_search_tsquery_adv(_q, 'all') AS q),
  nq AS (SELECT public.nes_search_positive_rest(_q) AS q),
  fts AS (
    SELECT 'post'::text AS kind, p.id, p.slug, p.title_pl, p.title_en,
           ts_rank_cd(p.search_vector, tq.q)::real AS rank,
           p.published_at AS fresh_at
      FROM public.posts p, tq, ctx
     WHERE tq.q IS NOT NULL AND p.search_vector @@ tq.q
       AND p.status = 'published' AND p.deleted_at IS NULL
       AND p.tenant_id = ctx.tid
    UNION ALL
    SELECT 'page'::text AS kind, pg.id, pg.slug, pg.title_pl, pg.title_en,
           ts_rank_cd(pg.search_vector, tq.q)::real AS rank,
           pg.updated_at AS fresh_at
      FROM public.pages pg, tq, ctx
     WHERE tq.q IS NOT NULL AND pg.search_vector @@ tq.q
       AND pg.status = 'published' AND pg.deleted_at IS NULL
       AND pg.tenant_id = ctx.tid
  ),
  -- Tolerancja literówek: gdy FTS nie trafił nic, dopasuj trigramowo tytuły
  -- (próg i normalizacja jak w search_posts; rank = podobieństwo 0..1).
  trgm AS (
    SELECT 'post'::text AS kind, p.id, p.slug, p.title_pl, p.title_en,
           GREATEST(
             word_similarity(nq.q, unaccent(lower(coalesce(p.title_pl, '')))),
             word_similarity(nq.q, unaccent(lower(coalesce(p.title_en, ''))))
           )::real AS rank,
           p.published_at AS fresh_at
      FROM public.posts p, nq, ctx
     WHERE length(nq.q) >= 4
       AND NOT EXISTS (SELECT 1 FROM fts)
       AND p.status = 'published' AND p.deleted_at IS NULL
       AND p.tenant_id = ctx.tid
       AND GREATEST(
             word_similarity(nq.q, unaccent(lower(coalesce(p.title_pl, '')))),
             word_similarity(nq.q, unaccent(lower(coalesce(p.title_en, ''))))
           ) > 0.3
    UNION ALL
    SELECT 'page'::text AS kind, pg.id, pg.slug, pg.title_pl, pg.title_en,
           GREATEST(
             word_similarity(nq.q, unaccent(lower(coalesce(pg.title_pl, '')))),
             word_similarity(nq.q, unaccent(lower(coalesce(pg.title_en, ''))))
           )::real AS rank,
           pg.updated_at AS fresh_at
      FROM public.pages pg, nq, ctx
     WHERE length(nq.q) >= 4
       AND NOT EXISTS (SELECT 1 FROM fts)
       AND pg.status = 'published' AND pg.deleted_at IS NULL
       AND pg.tenant_id = ctx.tid
       AND GREATEST(
             word_similarity(nq.q, unaccent(lower(coalesce(pg.title_pl, '')))),
             word_similarity(nq.q, unaccent(lower(coalesce(pg.title_en, ''))))
           ) > 0.3
  ),
  hits AS (
    SELECT * FROM fts
    UNION ALL SELECT * FROM trgm
  )
  SELECT h.kind, h.id, h.slug, h.title_pl, h.title_en, h.rank
    FROM hits h
   ORDER BY h.rank DESC, h.fresh_at DESC NULLS LAST, h.title_pl
   LIMIT GREATEST(LEAST(_limit, 50), 1);
$$;

REVOKE ALL ON FUNCTION public.search_quick(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_quick(text, int)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.search_quick(text, int) IS
  'Szybkie wyszukiwanie (paleta poleceń) v2: parser adv (fleksja PL, frazy, '
  'wykluczenia, AND/OR/NOT), trigramowy fallback literówek na tytułach postów '
  'i stron, świeżość jako tie-break. Sygnatura i kształt wyniku jak v1.';
