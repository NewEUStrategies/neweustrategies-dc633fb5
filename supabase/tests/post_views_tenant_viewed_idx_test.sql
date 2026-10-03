-- pgTAP: indeks okna odsłon najemcy `post_views (tenant_id, viewed_at DESC)`
-- (migracja 20261003171100_post_views_tenant_viewed_idx.sql).
--
-- Atrapa PostgREST w Vitest nie zna indeksów, więc kształt pilnowany jest tu:
--   1. Nowy indeks istnieje, jest PEŁNY (bez WHERE) i malejący po czasie -
--      częściowy `post_views_dwell_window_idx` (dwell_ms IS NOT NULL) nie
--      obsłuży predykatu audytorium.
--   2. `post_views_tenant_idx (tenant_id)` zniknął - jest prefiksem nowego.
--   3. `post_views_viewed_at_idx` ZOSTAŁ - skan okna bez najemcy
--      w `search_posts` (sortowanie `popular`).
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(4);

SELECT has_index(
  'public', 'post_views', 'post_views_tenant_viewed_idx',
  ARRAY['tenant_id', 'viewed_at'],
  'indeks okna audytorium (tenant_id, viewed_at DESC)'
);

SELECT hasnt_index(
  'public', 'post_views', 'post_views_tenant_idx',
  'stary (tenant_id) zdjety - jego prefiks niesie indeks okna'
);

SELECT has_index(
  'public', 'post_views', 'post_views_viewed_at_idx',
  ARRAY['viewed_at'],
  '(viewed_at DESC) ZOSTAJE - skan okna bez najemcy w search_posts sort=popular'
);

-- has_index nie widzi ani kierunku sortowania, ani predykatu indeksu
-- częściowego - definicja przypina oba.
SELECT is(
  (SELECT pg_get_indexdef('public.post_views_tenant_viewed_idx'::regclass)),
  'CREATE INDEX post_views_tenant_viewed_idx ON public.post_views USING btree (tenant_id, viewed_at DESC)',
  'indeks PELNY (bez WHERE) i malejacy - czesciowy post_views_dwell_window_idx nie obsluzy audytorium'
);

SELECT * FROM finish();
ROLLBACK;
