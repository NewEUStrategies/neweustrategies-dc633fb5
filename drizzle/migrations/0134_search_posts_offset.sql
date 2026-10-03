-- ============================================================================
-- BIBLIOTEKA PUBLIKACJI: `search_posts` DOSTAJE `_offset` (paginacja linkowa)
-- ============================================================================
--
-- PRZYCZYNA ŹRÓDŁOWA. `search_posts` miało `_limit`, ale nie miało przesunięcia
-- okna, więc jedyną drogą do dalszych wyników było POWIĘKSZANIE okna od
-- początku zbioru. `/publications` robiło dokładnie to: „Pokaż więcej"
-- podwajało `_limit` (60 -> 120 -> 240), a klient obcinał je sufitem
-- `SEARCH_LIMIT_MAX = 300`. Do tego ciało funkcji tnie okno na 200
-- (`LEAST(_limit, 200)`), więc realny sufit był jeszcze niższy niż ten
-- w kodzie klienta.
--
-- SKUTEK.
--   * Strony wyników nie miały adresów: nie dało się ich udostępnić, wrócić do
--     nich z historii ani dać crawlerowi - `<button>` nie jest linkiem.
--   * Każde „pokaż więcej" przeliczało i przesyłało CAŁE rosnące okno od
--     pierwszego wiersza (headline'y `ts_headline` liczone dla wszystkich
--     wierszy okna), więc koszt rósł kwadratowo z liczbą doładowań.
--   * Wszystko za 200. trafieniem było NIEOSIĄGALNE z interfejsu, mimo że
--     licznik (`total_count`) uczciwie mówił, że wyników jest więcej.
--
-- ROZWIĄZANIE. Parametr `_offset integer DEFAULT 0`, dopisany NA KOŃCU listy:
-- istniejące wywołania pozycyjne (pgTAP, `search_posts(NULL, 80, ...)`)
-- i nazwane (PostgREST bez `_offset`) zachowują dokładnie dotychczasowy wynik.
-- Okno to `rn > offset AND rn <= offset + limit` na tym samym `row_number()`,
-- który już porządkował wyniki (z `id` jako rozstrzygnięciem remisów), więc
-- kolejne strony są ROZŁĄCZNE i bez dziur. `total_count` liczy okno
-- `count(*) OVER ()` nad CAŁYM zbiorem trafień PRZED cięciem strony - we
-- wszystkich gałęziach, także w fallbacku trigramowym, którego warunek
-- (`NOT EXISTS (SELECT 1 FROM fts)`) patrzy na pełne `fts`, a nie na stronę.
-- Strona za końcem zbioru oddaje więc zero wierszy, a nie ucieka do fuzzy.
--
-- WIDEŁKI OFFSETU: `greatest(0, least(coalesce(_offset, 0), 10000))`. Ujemny
-- albo NULL działa jak 0; górna granica 10 000 zamyka głębokie stronicowanie
-- (każda strona i tak liczy `row_number()` nad pełnym zbiorem). Klient
-- (`SEARCH_OFFSET_MAX` w `src/lib/queries/archives.ts`) nie prosi o strony za
-- tą granicą - inaczej przycięty offset oddałby pod adresem strony 500 wiersze
-- od 10 001., czyli treść cudzej strony.
--
-- DLACZEGO DROP + CREATE, A NIE `CREATE OR REPLACE`. Nowy parametr zmienia
-- sygnaturę, więc `CREATE OR REPLACE` założyłby DRUGI, przeciążony wariant obok
-- starego. PostgREST rozstrzyga wywołanie po nazwach argumentów i przy dwóch
-- kandydatach pasujących do wywołania bez `_offset` odpowiada błędem
-- niejednoznaczności (PGRST203) - wyszukiwarka i biblioteka padłyby razem.
-- Zdejmujemy więc dokładnie starą sygnaturę (v6, 14 parametrów) oraz - jak
-- w 20260720215250 - tę, którą sami tworzymy, żeby powtórne wejście w plik nie
-- kończyło się 42723.
--
-- BEZ ZMIAN: ciało (filtry, rankingi, fallback trigramowy, headline'y), tenant
-- rozstrzygany wyłącznie serwerowo, `STABLE SECURITY DEFINER`, przypięta
-- ścieżka `public, extensions, pg_temp` (stan po 20260830120000 - `pg_temp`
-- na końcu), REVOKE od PUBLIC i GRANT dla anon / authenticated / service_role.
-- Komentarz funkcji, zgubiony przez DROP + CREATE w 20260720215250, wraca
-- z opisem aktualnego kontraktu.
--
-- KOLEJNOŚĆ WDROŻENIA: klient wysyła `_offset` WYŁĄCZNIE dla stron od drugiej
-- wzwyż, więc pierwsza strona biblioteki i całe `/search` działają także
-- przed tą migracją.
-- ============================================================================

DROP FUNCTION IF EXISTS public.search_posts(
  text, int, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text, text, text, text, jsonb
);
DROP FUNCTION IF EXISTS public.search_posts(
  text, int, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text, text, text, text, jsonb,
  int
);

CREATE FUNCTION public.search_posts(
  _q text DEFAULT NULL, _limit int DEFAULT 80, _author uuid DEFAULT NULL,
  _date_from timestamptz DEFAULT NULL, _date_to timestamptz DEFAULT NULL,
  _category uuid DEFAULT NULL, _terms uuid[] DEFAULT NULL,
  _format text DEFAULT NULL, _lang text DEFAULT NULL, _access text DEFAULT NULL,
  _sort text DEFAULT 'relevance', _match text DEFAULT 'all', _in text DEFAULT 'all',
  _term_groups jsonb DEFAULT NULL,
  _offset int DEFAULT 0
) RETURNS TABLE (
  id uuid, slug text, title_pl text, title_en text,
  excerpt_pl text, excerpt_en text, cover_image_url text,
  published_at timestamptz, parent_page_id uuid, author_id uuid, rank real,
  headline_pl text, headline_en text,
  post_format text, access_mode text, fuzzy boolean, total_count bigint
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
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
     WHERE tt.depth < 10
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
     WHERE p.status = 'published' AND p.deleted_at IS NULL
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
     WHERE tq.q IS NOT NULL AND b.search_vector @@ tq.q
       AND (_in IS DISTINCT FROM 'title'
            OR to_tsvector('simple', unaccent(
                 coalesce(b.title_pl, '') || ' ' || coalesce(b.title_en, ''))) @@ tq.q)
  ),
  trgm AS (
    SELECT b.*,
           GREATEST(
             word_similarity(nq.q, unaccent(lower(coalesce(b.title_pl, '')))),
             word_similarity(nq.q, unaccent(lower(coalesce(b.title_en, ''))))
           )::real AS rank, true AS fuzzy
      FROM base b, nq
     WHERE length(nq.q) >= 4 AND NOT EXISTS (SELECT 1 FROM fts)
       AND GREATEST(
             word_similarity(nq.q, unaccent(lower(coalesce(b.title_pl, '')))),
             word_similarity(nq.q, unaccent(lower(coalesce(b.title_en, ''))))
           ) > 0.3
  ),
  browse AS (
    SELECT b.*, 0::real AS rank, false AS fuzzy FROM base b, nq WHERE nq.q = ''
  ),
  hits AS (
    SELECT * FROM fts UNION ALL SELECT * FROM trgm UNION ALL SELECT * FROM browse
  ),
  pop AS (
    SELECT v.post_id, count(*) AS views FROM public.post_views v
     WHERE _sort = 'popular' AND v.viewed_at > now() - interval '90 days'
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
             h.published_at DESC NULLS LAST, h.id
           ) AS rn
      FROM hits h LEFT JOIN pop ON pop.post_id = h.id
  ),
  -- Widełki okna: limit jak dotąd (1..200), offset 0..10000 (ujemny i NULL = 0).
  bounds AS (
    SELECT GREATEST(LEAST(_limit, 200), 1) AS lim,
           GREATEST(0, LEAST(coalesce(_offset, 0), 10000)) AS off
  ),
  page AS (
    SELECT r.* FROM ranked r, bounds b
     WHERE r.rn > b.off AND r.rn <= b.off + b.lim
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
    FROM page pg JOIN public.posts p ON p.id = pg.id CROSS JOIN tq
   ORDER BY pg.rn;
$$;

REVOKE ALL ON FUNCTION public.search_posts(
  text, int, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text, text, text, text, jsonb,
  int
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_posts(
  text, int, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text, text, text, text, jsonb,
  int
) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.search_posts(
  text, int, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text, text, text, text, jsonb,
  int
) IS
  'Fasetowe wyszukiwanie archiwum v7: jak v6 plus _offset (0..10000) - strona wyników '
  'to okno rn > _offset AND rn <= _offset + _limit (1..200); total_count = liczność CAŁEGO '
  'zbioru trafień, liczona przed cięciem strony.';
