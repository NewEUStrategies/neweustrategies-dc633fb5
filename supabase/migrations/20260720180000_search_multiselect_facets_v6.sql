-- Wyszukiwarka v6: multi-select w fasetach (P1 z OCENA_MODULOW_2026-07-20 §3.5)
-- - OR wewnątrz wymiaru, AND między wymiarami (standard Algolii).
--
-- Kontekst:
--   * Dotąd wszystkie wybrane termy lądowały w jednej płaskiej tablicy _terms
--     ze ścisłym AND - zaznaczenie dwóch tematów zwracało przecięcie (zwykle
--     puste), więc UI wymuszał pojedynczy wybór na wymiar.
--   * Alerty zapisanych wyszukiwań (20260720170000) wprowadziły już
--     nes_post_matches_term_group (grupa CSV uuid-ów: OR w grupie, ekspansja
--     poddrzewa jak term_tree) - v6 używa tego samego helpera, więc alert
--     i strona wyników mają identyczną semantykę dopasowania.
--
-- Zakres:
--   1. search_posts v6: nowy parametr _term_groups jsonb
--      ({"category":"id1,id2","topic":"id3",...}) - grupa per wymiar, OR
--      wewnątrz, AND między. Legacy _terms (płaski AND) zachowane dla
--      starszych wywołujących; _term_groups ma pierwszeństwo po stronie
--      klienta (klient wysyła jedno albo drugie).
--   2. search_facets v4: to samo wejście + FASETOWANIE ROZŁĄCZNE
--      (disjunctive): licznik termu w wymiarze D liczy się z pominięciem
--      własnej grupy D (inaczej po zaznaczeniu jednego tematu wszystkie
--      pozostałe tematy spadałyby do zera i multi-select byłby martwy).
--      Wymiary skalarne (autor/format/język/dostęp/rok) liczone po pełnym
--      zbiorze (wszystkie grupy zastosowane) - pozostają pojedynczego wyboru.
--
-- Dodanie parametru zmienia sygnaturę (powstałby przeciążony wariant i
-- niejednoznaczność w PostgREST), więc DROP + CREATE - jak w v3.
-- Konwencje bez zmian: SECURITY DEFINER, tenant wyłącznie serwerowo,
-- search_path = public, extensions, REVOKE/GRANT jawnie.

DROP FUNCTION IF EXISTS public.search_posts(
  text, int, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text, text, text, text
);
DROP FUNCTION IF EXISTS public.search_facets(
  text, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text, text, text
);

-- 1. search_posts v6 ----------------------------------------------------------

CREATE FUNCTION public.search_posts(
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
  _in text DEFAULT 'all',
  _term_groups jsonb DEFAULT NULL
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
       -- Multi-select: grupa per wymiar (OR wewnątrz), AND między grupami.
       AND (_term_groups IS NULL OR (
             public.nes_post_matches_term_group(p.id, _term_groups->>'category')
         AND public.nes_post_matches_term_group(p.id, _term_groups->>'pub_type')
         AND public.nes_post_matches_term_group(p.id, _term_groups->>'region')
         AND public.nes_post_matches_term_group(p.id, _term_groups->>'topic')
         AND public.nes_post_matches_term_group(p.id, _term_groups->>'project')
         AND public.nes_post_matches_term_group(p.id, _term_groups->>'series')
         AND public.nes_post_matches_term_group(p.id, _term_groups->>'organization')))
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
  text, int, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text, text, text, text, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_posts(
  text, int, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text, text, text, text, jsonb
) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.search_posts(
  text, int, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text, text, text, text, jsonb
) IS
  'Fasetowe wyszukiwanie archiwum v6: jak v5 plus _term_groups jsonb '
  '(multi-select: OR wewnątrz wymiaru, AND między wymiarami).';

-- 2. search_facets v4 (fasetowanie rozłączne) ---------------------------------

CREATE FUNCTION public.search_facets(
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
  _in text DEFAULT 'all',
  _term_groups jsonb DEFAULT NULL
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
  -- base celowo BEZ filtra _term_groups: fasetowanie rozłączne potrzebuje
  -- zbioru sprzed filtrów taksonomicznych; flagi grup liczone są niżej.
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
  -- Flagi dopasowania per grupa wymiaru (wszystkie true przy braku grup;
  -- puste grupy nie płacą kosztu wywołania helpera per wiersz).
  flags AS (
    SELECT m.*,
           CASE WHEN coalesce(_term_groups->>'category', '') = '' THEN true
                ELSE public.nes_post_matches_term_group(m.id, _term_groups->>'category') END
             AS ok_category,
           CASE WHEN coalesce(_term_groups->>'pub_type', '') = '' THEN true
                ELSE public.nes_post_matches_term_group(m.id, _term_groups->>'pub_type') END
             AS ok_pub_type,
           CASE WHEN coalesce(_term_groups->>'region', '') = '' THEN true
                ELSE public.nes_post_matches_term_group(m.id, _term_groups->>'region') END
             AS ok_region,
           CASE WHEN coalesce(_term_groups->>'topic', '') = '' THEN true
                ELSE public.nes_post_matches_term_group(m.id, _term_groups->>'topic') END
             AS ok_topic,
           CASE WHEN coalesce(_term_groups->>'project', '') = '' THEN true
                ELSE public.nes_post_matches_term_group(m.id, _term_groups->>'project') END
             AS ok_project,
           CASE WHEN coalesce(_term_groups->>'series', '') = '' THEN true
                ELSE public.nes_post_matches_term_group(m.id, _term_groups->>'series') END
             AS ok_series,
           CASE WHEN coalesce(_term_groups->>'organization', '') = '' THEN true
                ELSE public.nes_post_matches_term_group(m.id, _term_groups->>'organization') END
             AS ok_organization
      FROM matched m
  ),
  -- Pełny zbiór wyników (wszystkie grupy zastosowane) - liczniki wymiarów
  -- skalarnych mają odzwierciedlać to, co użytkownik faktycznie widzi.
  full_set AS (
    SELECT f.* FROM flags f
     WHERE f.ok_category AND f.ok_pub_type AND f.ok_region AND f.ok_topic
       AND f.ok_project AND f.ok_series AND f.ok_organization
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
  -- Wymiary taksonomiczne: licznik rozłączny - własna grupa wymiaru pominięta,
  -- pozostałe grupy egzekwowane (klik w drugą wartość tego samego wymiaru
  -- POSZERZA wyniki, więc licznik musi pokazywać zbiór po poszerzeniu).
  SELECT c.kind AS dim, c.id, c.slug, c.name_pl AS label_pl, c.name_en AS label_en,
         c.parent_id, count(DISTINCT f.id) AS cnt
    FROM flags f
    JOIN public.post_categories pc ON pc.post_id = f.id
    JOIN vocab_tree vt ON vt.match_id = pc.category_id
    JOIN public.categories c ON c.id = vt.root
   WHERE CASE c.kind
           WHEN 'category'     THEN f.ok_pub_type AND f.ok_region AND f.ok_topic
                                    AND f.ok_project AND f.ok_series AND f.ok_organization
           WHEN 'pub_type'     THEN f.ok_category AND f.ok_region AND f.ok_topic
                                    AND f.ok_project AND f.ok_series AND f.ok_organization
           WHEN 'region'       THEN f.ok_category AND f.ok_pub_type AND f.ok_topic
                                    AND f.ok_project AND f.ok_series AND f.ok_organization
           WHEN 'topic'        THEN f.ok_category AND f.ok_pub_type AND f.ok_region
                                    AND f.ok_project AND f.ok_series AND f.ok_organization
           WHEN 'project'      THEN f.ok_category AND f.ok_pub_type AND f.ok_region
                                    AND f.ok_topic AND f.ok_series AND f.ok_organization
           WHEN 'series'       THEN f.ok_category AND f.ok_pub_type AND f.ok_region
                                    AND f.ok_topic AND f.ok_project AND f.ok_organization
           WHEN 'organization' THEN f.ok_category AND f.ok_pub_type AND f.ok_region
                                    AND f.ok_topic AND f.ok_project AND f.ok_series
           ELSE f.ok_category AND f.ok_pub_type AND f.ok_region AND f.ok_topic
                AND f.ok_project AND f.ok_series AND f.ok_organization
         END
   GROUP BY c.kind, c.id, c.slug, c.name_pl, c.name_en, c.parent_id
  UNION ALL
  SELECT 'author', pr.id, pr.slug, coalesce(pr.display_name, 'Autor'),
         coalesce(pr.display_name, 'Author'), NULL, count(*)::bigint
    FROM full_set m
    JOIN public.profiles pr ON pr.id = m.author_id
   GROUP BY pr.id, pr.slug, pr.display_name
  UNION ALL
  SELECT 'format', NULL, m.post_format, m.post_format, m.post_format, NULL,
         count(*)::bigint
    FROM full_set m
   GROUP BY m.post_format
  UNION ALL
  SELECT 'lang', NULL, l.code, l.code, l.code, NULL, count(*)::bigint
    FROM full_set m
    CROSS JOIN LATERAL (
      SELECT 'pl'::text AS code WHERE btrim(m.title_pl) <> ''
      UNION ALL
      SELECT 'en' WHERE btrim(m.title_en) <> ''
    ) l
   GROUP BY l.code
  UNION ALL
  SELECT 'access', NULL, m.eff_access, m.eff_access, m.eff_access, NULL,
         count(*)::bigint
    FROM full_set m
   GROUP BY m.eff_access
  UNION ALL
  SELECT 'year', NULL, y.year_slug, y.year_slug, y.year_slug, NULL,
         count(*)::bigint
    FROM (
      SELECT extract(year FROM m.published_at)::int::text AS year_slug
        FROM full_set m
       WHERE m.published_at IS NOT NULL
    ) y
   GROUP BY y.year_slug;
$$;

REVOKE ALL ON FUNCTION public.search_facets(
  text, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text, text, text, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_facets(
  text, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text, text, text, jsonb
) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.search_facets(
  text, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text, text, text, jsonb
) IS
  'Fasety archiwum v4: jak v3 plus _term_groups jsonb i fasetowanie '
  'rozłączne (licznik wymiaru liczony z pominięciem własnej grupy).';
