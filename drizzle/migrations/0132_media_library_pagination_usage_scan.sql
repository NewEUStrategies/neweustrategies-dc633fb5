-- Biblioteka mediów: paginacja keyset, foldery bez pełnego odczytu i skan użyć
-- po stronie bazy (moduł 4, rekomendacja wydania 11: „spaginować bibliotekę
-- mediów, dołożyć indeks i ograniczyć skan użyć”).
--
-- STAN WYJŚCIOWY. Menedżer mediów czytał CAŁĄ tabelę `media` tenanta jednym
-- zapytaniem bez limitu, picker - do 500 wierszy (`limit(500)`), a oba
-- sortowały po `created_at` bez indeksu, który by to sortowanie niósł: jedyny
-- indeks tabeli to `media_tenant_folder_idx (tenant_id, folder_path)`. Do tego
-- `getMediaUsage` ściągał do workera PEŁNE treści wszystkich wpisów i stron
-- tenanta (content_pl/en, builder_data, blocks_data, layout_overrides), żeby
-- w JavaScripcie zrobić `includes` - koszt rosnący liniowo z archiwum, płacony
-- przy każdym otwarciu podglądu pliku.
--
-- CO TA MIGRACJA DOKŁADA:
--   1. Indeksy pod paginację keyset (`created_at DESC, id DESC`): globalny dla
--      pickera („wszystkie foldery") i per folder dla menedżera. Indeks per
--      folder ma prefiks `(tenant_id, folder_path)`, więc przejmuje rolę
--      `media_tenant_folder_idx` (także zapytania `LIKE 'prefiks%'` przy
--      zmianie nazwy i kasowaniu folderu) - stary indeks jest zdejmowany, żeby
--      zapis do `media` nie płacił za dwa indeksy o tym samym prefiksie.
--   2. `media_folder_paths(_tenant_id)` - lista RÓŻNYCH folderów, w których
--      leżą pliki. Folder może istnieć wyłącznie jako `media.folder_path` (bez
--      wiersza `media_folders`: `updateMediaMeta`, `bulkMoveMedia`), więc
--      drzewo folderów musiało dotąd czytać całą tabelę. SECURITY INVOKER: RLS
--      tabeli `media` obowiązuje bez zmian.
--   3. `media_usage_scan(_tenant_id, _needles, _limit)` - dopasowanie podciągów
--      wykonywane w bazie, zwracające WYŁĄCZNIE trafienia (z limitem). Wołane
--      tylko spod service_role (kolumny ciała są odebrane roli `authenticated`
--      od 20260702200000), dlatego EXECUTE jest odebrane wszystkim poza
--      service_role, a granicą tenanta jest jawny parametr `_tenant_id`
--      ustalany na serwerze z profilu wołającego - ta sama doktryna, co
--      `posts-migrate` i dotychczasowy skan w TypeScripcie.

-- 1) Indeksy pod paginację keyset.
CREATE INDEX IF NOT EXISTS media_tenant_created_idx
  ON public.media (tenant_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS media_tenant_folder_created_idx
  ON public.media (tenant_id, folder_path, created_at DESC, id DESC);

DROP INDEX IF EXISTS public.media_tenant_folder_idx;

-- 2) Foldery wynikające z położenia plików.
CREATE OR REPLACE FUNCTION public.media_folder_paths(_tenant_id uuid)
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DISTINCT m.folder_path
    FROM public.media m
   WHERE m.tenant_id = _tenant_id
     AND m.folder_path IS NOT NULL
     AND m.folder_path <> '/'
   ORDER BY m.folder_path
$$;

REVOKE ALL ON FUNCTION public.media_folder_paths(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.media_folder_paths(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.media_folder_paths(uuid) IS
  'Distinct media.folder_path values of a tenant (folders implied by file locations). SECURITY INVOKER - media RLS applies.';

-- 3) Skan użyć pliku po stronie bazy.
CREATE OR REPLACE FUNCTION public.media_text_contains_any(_haystack text, _needles text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT _haystack IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM unnest(_needles) AS n
        WHERE n IS NOT NULL
          AND n <> ''
          AND strpos(_haystack, n) > 0
      )
$$;

REVOKE ALL ON FUNCTION public.media_text_contains_any(text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.media_text_contains_any(text, text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.media_usage_scan(
  _tenant_id uuid,
  _needles text[],
  _limit integer DEFAULT 200
)
RETURNS TABLE (kind text, id uuid, slug text, title text, areas text[])
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH needles AS (
    SELECT coalesce(array_agg(DISTINCT n), ARRAY[]::text[]) AS list
      FROM unnest(_needles) AS n
     WHERE n IS NOT NULL
       AND n <> ''
  ),
  hits AS (
    SELECT 'post'::text AS kind,
           p.id,
           p.slug,
           coalesce(nullif(p.title_pl, ''), nullif(p.title_en, ''), p.slug) AS title,
           array_remove(ARRAY[
             CASE WHEN public.media_text_contains_any(p.cover_image_url, nd.list) THEN 'cover' END,
             CASE WHEN public.media_text_contains_any(p.excerpt_pl, nd.list)
                    OR public.media_text_contains_any(p.excerpt_en, nd.list) THEN 'excerpt' END,
             CASE WHEN public.media_text_contains_any(p.content_pl, nd.list)
                    OR public.media_text_contains_any(p.content_en, nd.list) THEN 'content' END,
             CASE WHEN public.media_text_contains_any(p.builder_data::text, nd.list) THEN 'builder' END,
             CASE WHEN public.media_text_contains_any(p.blocks_data::text, nd.list) THEN 'blocks' END,
             CASE WHEN public.media_text_contains_any(p.layout_overrides::text, nd.list) THEN 'layout' END
           ], NULL) AS areas
      FROM public.posts p
      CROSS JOIN needles nd
     WHERE p.tenant_id = _tenant_id
       AND p.deleted_at IS NULL
       AND cardinality(nd.list) > 0
    UNION ALL
    SELECT 'page'::text AS kind,
           g.id,
           g.slug,
           coalesce(nullif(g.title_pl, ''), nullif(g.title_en, ''), g.slug) AS title,
           array_remove(ARRAY[
             CASE WHEN public.media_text_contains_any(g.cover_image_url, nd.list) THEN 'cover' END,
             CASE WHEN public.media_text_contains_any(g.excerpt_pl, nd.list)
                    OR public.media_text_contains_any(g.excerpt_en, nd.list) THEN 'excerpt' END,
             CASE WHEN public.media_text_contains_any(g.content_pl, nd.list)
                    OR public.media_text_contains_any(g.content_en, nd.list) THEN 'content' END,
             CASE WHEN public.media_text_contains_any(g.builder_data::text, nd.list) THEN 'builder' END,
             CASE WHEN public.media_text_contains_any(g.layout_overrides::text, nd.list) THEN 'layout' END
           ], NULL) AS areas
      FROM public.pages g
      CROSS JOIN needles nd
     WHERE g.tenant_id = _tenant_id
       AND g.deleted_at IS NULL
       AND cardinality(nd.list) > 0
  )
  SELECT h.kind, h.id, h.slug, h.title, h.areas
    FROM hits h
   WHERE cardinality(h.areas) > 0
   ORDER BY h.kind = 'page', h.title, h.id
   LIMIT greatest(1, least(coalesce(_limit, 200), 500))
$$;

REVOKE ALL ON FUNCTION public.media_usage_scan(uuid, text[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.media_usage_scan(uuid, text[], integer) TO service_role;

COMMENT ON FUNCTION public.media_usage_scan(uuid, text[], integer) IS
  'Posts/pages of _tenant_id whose cover, excerpt, body, builder/blocks tree or layout overrides contain any of _needles. service_role only; the caller pins _tenant_id from the profile.';