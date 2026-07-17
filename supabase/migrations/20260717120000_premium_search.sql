-- Wyszukiwarka premium: osoby i organizacje + zaawansowane tryby zapytań.
--
-- Zakres:
--   1. Nowy wymiar taksonomii "organization" (categories.kind) - organizacje
--      i instytucje opisywane w treściach (NATO, UE, ONZ...), zarządzane jak
--      pozostałe słowniki w panelu kategorii; startowy słownik dla tenanta
--      publicznego. Istniejące RPC (search_facets / search_autosuggest /
--      filtr _terms w search_posts) podejmują nowy wymiar automatycznie.
--   2. nes_search_tsquery_adv: zaawansowana składnia zapytań -
--      "fraza w cudzysłowie" (dopasowanie sąsiadujących słów), -wykluczenie,
--      tryby dopasowania: all (wszystkie słowa, domyślny - kontrakt v1),
--      any (dowolne słowo), phrase (całość jako fraza). Zachowuje kontrakt
--      nes_search_tsquery: unaccent+lower, sanityzacja [a-z0-9], polska
--      fleksja (rdzeń OR-owany z surowym termem), puste wejście -> NULL.
--   3. search_posts v4 / search_facets v2: parametry _match (tryb dopasowania)
--      i _in ('all' | 'title' - zawężenie dopasowania do tytułów). Parametry
--      DOMYSLNE dopisane na końcu listy: dotychczasowi wywołujący (klient,
--      MCP, pgTAP) działają bez zmian.
--   4. search_people_orgs: publiczne wyszukiwanie OSÓB (autorzy/eksperci
--      z publicznym dorobkiem) i ORGANIZACJI (termy kind='organization')
--      z metadanymi (avatar, rola, liczba publikacji) - zasila sekcję
--      "Osoby i organizacje" strony /search. Zwraca wyłącznie kolumny
--      bezpieczne publicznie (lustro polityki anon na profiles);
--      member_organizations (dane członkowskie) celowo POZA zasięgiem.
--
-- Konwencje jak w 20260714130000_faceted_archive_search.sql:
--   * SECURITY DEFINER + tenant rozstrzygany WYŁĄCZNIE serwerowo,
--   * search_path = public, extensions,
--   * addytywne kolumny/parametry - starszy klient czyta te, które zna.

-- 1. WYMIAR "ORGANIZATION" ----------------------------------------------------

ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_kind_check;
ALTER TABLE public.categories
  ADD CONSTRAINT categories_kind_check
  CHECK (kind IN ('category','pub_type','region','topic','project','series','organization'));

-- Startowy słownik organizacji dla tenanta publicznego (edytowalny w panelu;
-- WHERE NOT EXISTS -> migracja nie wskrzesza ręcznie usuniętych terminów).
INSERT INTO public.categories (tenant_id, slug, name_pl, name_en, kind)
SELECT public.public_tenant_id(), s.slug, s.pl, s.en, 'organization'
  FROM (VALUES
    ('nato',            'NATO',            'NATO'),
    ('unia-europejska', 'Unia Europejska', 'European Union'),
    ('onz',             'ONZ',             'United Nations'),
    ('oecd',            'OECD',            'OECD'),
    ('obwe',            'OBWE',            'OSCE')
  ) AS s(slug, pl, en)
 WHERE public.public_tenant_id() IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.categories c
      WHERE c.tenant_id = public.public_tenant_id() AND c.slug = s.slug
   );

-- 2. ZAAWANSOWANA SKŁADNIA ZAPYTAŃ ---------------------------------------------
-- Tokenizer: "fraza" (także cudzysłowy typograficzne), -wykluczenie, słowo.
-- Frazy -> sąsiedztwo (<->); wykluczenia -> & !term; pozytywne słowa jak w v1:
-- (surowy:* | rdzeń:*). Tryb any łączy pozytywy OR-em (wykluczenia zawsze
-- AND-em). Tryb phrase traktuje całe zapytanie jako jedną frazę. Zapytanie
-- złożone wyłącznie z wykluczeń -> NULL (tryb przeglądania, nigdy "wszystko
-- poza X" na całym archiwum).

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
  -- „ na ,, i fraza przestałaby być rozpoznawalna).
  v_norm  text := unaccent(lower(regexp_replace(coalesce(_q, ''), '[„”“«»]', '"', 'g')));
  v_match text := CASE WHEN _match IN ('all','any','phrase') THEN _match ELSE 'all' END;
  v_words text[];
  v_parts text[];
  v_pos   text[] := '{}';
  v_not   text[] := '{}';
  v_raw   text;
  v_stem  text;
  v_expr  text;
  m       text[];
BEGIN
  IF btrim(v_norm) = '' THEN
    RETURN NULL;
  END IF;

  -- Tryb "phrase": całość jako jedna fraza (kolejne słowa muszą sąsiadować).
  IF v_match = 'phrase' THEN
    SELECT array_agg(w) INTO v_words
      FROM (
        SELECT regexp_replace(x, '[^a-z0-9]', '', 'g') AS w
        FROM unnest(regexp_split_to_array(v_norm, '\s+')) AS x
      ) s
     WHERE w <> '';
    IF v_words IS NULL THEN
      RETURN NULL;
    END IF;
    RETURN to_tsquery('simple', array_to_string(v_words, ' <-> '));
  END IF;

  -- Tokeny: (-)"fraza" | (-)słowo. Grupy: m[1]/m[2] = fraza, m[3]/m[4] = słowo.
  FOR m IN
    SELECT regexp_matches(v_norm, '(-)?"([^"]+)"|(-)?([^\s"]+)', 'g')
  LOOP
    IF m[2] IS NOT NULL THEN
      SELECT array_agg(w) INTO v_parts
        FROM (
          SELECT regexp_replace(x, '[^a-z0-9]', '', 'g') AS w
          FROM unnest(regexp_split_to_array(m[2], '\s+')) AS x
        ) s
       WHERE w <> '';
      IF v_parts IS NULL THEN
        CONTINUE;
      END IF;
      v_expr := CASE WHEN array_length(v_parts, 1) = 1 THEN v_parts[1]
                     ELSE '(' || array_to_string(v_parts, ' <-> ') || ')' END;
      IF m[1] IS NOT NULL THEN
        v_not := v_not || v_expr;
      ELSE
        v_pos := v_pos || v_expr;
      END IF;
    ELSE
      v_raw := regexp_replace(coalesce(m[4], ''), '[^a-z0-9]', '', 'g');
      IF v_raw = '' THEN
        CONTINUE;
      END IF;
      IF m[3] IS NOT NULL THEN
        -- Wykluczenie prefiksowe: -nato odcina też "natowski" itd.
        v_not := v_not || (v_raw || ':*');
      ELSE
        v_stem := public.nes_pl_light_stem(v_raw);
        IF v_stem <> v_raw THEN
          v_pos := v_pos || ('(' || v_raw || ':* | ' || v_stem || ':*)');
        ELSE
          v_pos := v_pos || (v_raw || ':*');
        END IF;
      END IF;
    END IF;
  END LOOP;

  IF array_length(v_pos, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  v_expr := array_to_string(v_pos, CASE WHEN v_match = 'any' THEN ' | ' ELSE ' & ' END);
  IF v_match = 'any' AND array_length(v_pos, 1) > 1 THEN
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
  'Zaawansowany parser zapytań: "frazy" (<->), -wykluczenia (& !), tryby '
  'all/any/phrase; poza tym kontrakt nes_search_tsquery (unaccent, sanityzacja, '
  'polska fleksja, puste wejście -> NULL).';

-- 3. search_posts v4 ------------------------------------------------------------
-- Sygnatura rośnie o _match/_in na KOŃCU (pozycyjni i nazwani wywołujący v3
-- działają bez zmian). Ciało jak w v3, ale tsquery buduje parser zaawansowany,
-- a _in='title' zawęża dopasowanie FTS do tytułów (fallback trigramowy i tak
-- pracuje wyłącznie na tytułach).

DROP FUNCTION IF EXISTS public.search_posts(
  text, int, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text, text);

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
  -- Pozytywna reszta zapytania (bez -wykluczeń i cudzysłowów): steruje trybem
  -- przeglądania (pusta reszta = przeglądanie, także dla samych wykluczeń)
  -- i fallbackiem trigramowym (literówki liczone tylko na pozytywnej części).
  nq AS (
    SELECT btrim(regexp_replace(regexp_replace(
             unaccent(lower(regexp_replace(coalesce(_q, ''), '[„”“«»]', '"', 'g'))),
             '(^|\s)-("[^"]*"|[^\s"]+)', ' ', 'g'),
           '["\s]+', ' ', 'g')) AS q
  ),
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
  'Fasetowe wyszukiwanie archiwum v4: jak v3 plus _match (all/any/phrase, '
  'składnia "fraza" i -wykluczenie) oraz _in (all/title - zawężenie do tytułów).';

-- 4. search_facets v2 -----------------------------------------------------------

DROP FUNCTION IF EXISTS public.search_facets(
  text, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text);

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
  -- Pozytywna reszta zapytania - jak w search_posts v4.
  nq AS (
    SELECT btrim(regexp_replace(regexp_replace(
             unaccent(lower(regexp_replace(coalesce(_q, ''), '[„”“«»]', '"', 'g'))),
             '(^|\s)-("[^"]*"|[^\s"]+)', ' ', 'g'),
           '["\s]+', ' ', 'g')) AS q
  ),
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
  'Liczniki fasetowe v2: jak v1 plus _match/_in (spójne z search_posts v4); '
  'wymiar organization liczony automatycznie przez kind.';

-- 5. OSOBY I ORGANIZACJE --------------------------------------------------------
-- Publiczna sekcja "Osoby i organizacje": autorzy/eksperci z publicznym
-- dorobkiem (lustro polityki anon: slug + rola redakcyjna; tylko kolumny
-- bezpieczne publicznie) oraz termy organizacji z licznikami publikacji.
-- Fraza pusta = tryb przeglądania (ranking po dorobku).

CREATE OR REPLACE FUNCTION public.search_people_orgs(
  _q text DEFAULT NULL,
  _limit int DEFAULT 40
)
RETURNS TABLE (
  kind text, id uuid, slug text, label_pl text, label_en text,
  sublabel_pl text, sublabel_en text, avatar_url text,
  verified boolean, post_count bigint, score real
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH ctx AS (
    SELECT coalesce(public.current_tenant_id(), public.public_tenant_id()) AS tid
  ),
  nq AS (SELECT unaccent(lower(btrim(coalesce(_q, '')))) AS q),
  people AS (
    SELECT pr.id, pr.slug,
           coalesce(pr.display_name, 'Autor') AS name,
           NULLIF(concat_ws(' · ',
             coalesce(ap.job_title, pr.job_title),
             coalesce(ap.company, pr.current_company)), '') AS sub,
           pr.avatar_url,
           (pr.verified_at IS NOT NULL) AS verified,
           coalesce(ap.is_public, false) AS is_public_expert,
           (SELECT count(DISTINCT p.id)
              FROM public.posts p
              LEFT JOIN public.post_authors pa
                ON pa.post_id = p.id AND pa.user_id = pr.id
             WHERE p.tenant_id = ctx.tid
               AND p.status = 'published'
               AND p.deleted_at IS NULL
               AND (p.author_id = pr.id OR pa.user_id IS NOT NULL)) AS post_count
      FROM public.profiles pr
      CROSS JOIN ctx
      LEFT JOIN public.author_profiles ap
        ON ap.user_id = pr.id AND ap.tenant_id = pr.tenant_id
     WHERE pr.tenant_id = ctx.tid
       AND pr.slug IS NOT NULL
       AND public.user_is_editorial(pr.id)
  ),
  orgs AS (
    SELECT c.id, c.slug, c.name_pl, c.name_en,
           c.description_pl, c.description_en,
           (SELECT count(DISTINCT pc.post_id)
              FROM public.post_categories pc
              JOIN public.posts p ON p.id = pc.post_id
             WHERE pc.category_id = c.id
               AND p.tenant_id = ctx.tid
               AND p.status = 'published'
               AND p.deleted_at IS NULL) AS post_count
      FROM public.categories c
      CROSS JOIN ctx
     WHERE c.tenant_id = ctx.tid AND c.kind = 'organization'
  ),
  cand AS (
    SELECT 'person'::text AS kind, pe.id, pe.slug,
           pe.name AS label_pl, pe.name AS label_en,
           pe.sub AS sublabel_pl, pe.sub AS sublabel_en,
           pe.avatar_url, pe.verified, pe.post_count,
           CASE WHEN nq.q = '' THEN 0.0
                ELSE word_similarity(nq.q, unaccent(lower(pe.name)))
                     + CASE WHEN unaccent(lower(pe.name)) LIKE nq.q || '%'
                            THEN 1.0 ELSE 0.0 END
                     + CASE WHEN unaccent(lower(pe.name)) LIKE '%' || nq.q || '%'
                            THEN 0.5 ELSE 0.0 END
           END AS score
      FROM people pe, nq
     WHERE pe.post_count > 0 OR pe.is_public_expert
    UNION ALL
    SELECT 'organization', o.id, o.slug,
           o.name_pl, o.name_en,
           o.description_pl, o.description_en,
           NULL, false, o.post_count,
           CASE WHEN nq.q = '' THEN 0.0
                ELSE GREATEST(
                       word_similarity(nq.q, unaccent(lower(o.name_pl))),
                       word_similarity(nq.q, unaccent(lower(o.name_en))))
                     + CASE WHEN unaccent(lower(o.name_pl)) LIKE nq.q || '%'
                              OR unaccent(lower(o.name_en)) LIKE nq.q || '%'
                            THEN 1.0 ELSE 0.0 END
                     + CASE WHEN unaccent(lower(o.name_pl)) LIKE '%' || nq.q || '%'
                              OR unaccent(lower(o.name_en)) LIKE '%' || nq.q || '%'
                            THEN 0.5 ELSE 0.0 END
           END AS score
      FROM orgs o, nq
  )
  SELECT c.kind, c.id, c.slug, c.label_pl, c.label_en,
         c.sublabel_pl, c.sublabel_en, c.avatar_url,
         c.verified, c.post_count, c.score::real
    FROM cand c, nq
   WHERE nq.q = '' OR length(nq.q) < 2 OR c.score > 0.3
   ORDER BY c.score DESC, c.post_count DESC, c.label_pl
   LIMIT GREATEST(LEAST(coalesce(_limit, 40), 100), 1);
$$;

REVOKE ALL ON FUNCTION public.search_people_orgs(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_people_orgs(text, int)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.search_people_orgs(text, int) IS
  'Sekcja "Osoby i organizacje" wyszukiwarki: autorzy/eksperci z publicznym '
  'dorobkiem (kolumny bezpieczne publicznie) + termy organizacji z licznikami '
  'publikacji; fraza pusta = przeglądanie wg dorobku.';
