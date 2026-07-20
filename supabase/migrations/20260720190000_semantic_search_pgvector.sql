-- Warstwa semantyczna wyszukiwania (P2 z OCENA_MODULOW_2026-07-20 §3.5):
-- embeddingi tytuł+zajawka (pgvector) jako DRUGI sygnał rankingu obok FTS.
--
-- Architektura (świadomie minimalna):
--   * post_embeddings: jeden wektor per wpis (768 wymiarów - wspólny mianownik
--     text-embedding-3-small z parametrem dimensions oraz Gemini
--     text-embedding-004), tekst źródłowy = tytuł+zajawka PL i EN razem
--     (modele wielojęzyczne łączą zapytanie w dowolnym języku z treścią).
--   * indekser działa w APLIKACJI (jobs-tick co minutę, embeddings.server.ts):
--     pobiera kolejkę z posts_needing_embeddings, liczy wektory przez bramkę
--     AI i upsertuje. SQL nie woła HTTP - cron tylko puka (wzorzec platformy).
--   * zapytanie: server fn semanticSearch embeduje frazę i woła
--     semantic_search_posts; klient DOKŁADA podobieństwo do rankingu FTS
--     (klientowy blend - zero zmian w search_posts, degradacja do czystego
--     FTS gdy bramka nie wspiera embeddingów).
--
-- Tabela jest niedostępna dla anon/authenticated (tylko service_role +
-- SECURITY DEFINER RPC) - embeddingi to pochodna treści publicznych, ale
-- nie ma powodu wystawiać surowych wektorów.

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.post_embeddings (
  post_id uuid PRIMARY KEY REFERENCES public.posts(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  content_hash text NOT NULL,
  embedding extensions.vector(768) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.post_embeddings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.post_embeddings FROM PUBLIC;
REVOKE ALL ON public.post_embeddings FROM anon, authenticated;
GRANT ALL ON public.post_embeddings TO service_role;

CREATE INDEX IF NOT EXISTS post_embeddings_tenant_idx
  ON public.post_embeddings (tenant_id);
CREATE INDEX IF NOT EXISTS post_embeddings_hnsw
  ON public.post_embeddings
  USING hnsw (embedding extensions.vector_cosine_ops);

-- Tekst i hash źródłowy embeddingu - jedna definicja dla kolejki indeksera
-- i porównania świeżości (zmiana tytułu/zajawki inwaliduje wektor).
CREATE OR REPLACE FUNCTION public.nes_post_embedding_source(
  p_title_pl text, p_excerpt_pl text, p_title_en text, p_excerpt_en text
) RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT left(
    concat_ws(E'\n',
      nullif(btrim(coalesce(p_title_pl, '')), ''),
      nullif(btrim(coalesce(p_excerpt_pl, '')), ''),
      nullif(btrim(coalesce(p_title_en, '')), ''),
      nullif(btrim(coalesce(p_excerpt_en, '')), '')
    ), 2000);
$$;

-- Kolejka indeksowania: opublikowane wpisy bez wektora albo z wektorem
-- policzonym dla starszej wersji tytułu/zajawki. Wyłącznie dla indeksera
-- (service_role) - zwraca gotowy tekst do embedowania.
CREATE OR REPLACE FUNCTION public.posts_needing_embeddings(_limit integer DEFAULT 32)
RETURNS TABLE (post_id uuid, tenant_id uuid, content_hash text, embed_text text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT p.id, p.tenant_id,
         md5(public.nes_post_embedding_source(p.title_pl, p.excerpt_pl, p.title_en, p.excerpt_en))
           AS content_hash,
         public.nes_post_embedding_source(p.title_pl, p.excerpt_pl, p.title_en, p.excerpt_en)
           AS embed_text
    FROM public.posts p
    LEFT JOIN public.post_embeddings pe ON pe.post_id = p.id
   WHERE p.status = 'published'
     AND p.deleted_at IS NULL
     AND coalesce(public.nes_post_embedding_source(
           p.title_pl, p.excerpt_pl, p.title_en, p.excerpt_en), '') <> ''
     AND (pe.post_id IS NULL
          OR pe.content_hash IS DISTINCT FROM
             md5(public.nes_post_embedding_source(
               p.title_pl, p.excerpt_pl, p.title_en, p.excerpt_en)))
   ORDER BY p.published_at DESC NULLS LAST
   LIMIT GREATEST(LEAST(coalesce(_limit, 32), 200), 1);
$$;

REVOKE EXECUTE ON FUNCTION public.posts_needing_embeddings(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.posts_needing_embeddings(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.posts_needing_embeddings(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.posts_needing_embeddings(integer) TO service_role;

-- Podobieństwo kosinusowe do wektora zapytania. Wektor przyjeżdża jako
-- float8[] (PostgREST nie rzutuje json->vector); tenant rozstrzygany
-- wyłącznie serwerowo, tylko wpisy opublikowane.
CREATE OR REPLACE FUNCTION public.semantic_search_posts(
  _embedding double precision[],
  _limit integer DEFAULT 40
)
RETURNS TABLE (post_id uuid, similarity real)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH ctx AS (
    SELECT coalesce(public.current_tenant_id(), public.public_tenant_id()) AS tid
  ),
  q AS (
    SELECT (_embedding::extensions.vector(768)) AS v
  )
  SELECT pe.post_id, (1 - (pe.embedding <=> q.v))::real AS similarity
    FROM public.post_embeddings pe
    JOIN public.posts p ON p.id = pe.post_id
    JOIN ctx ON pe.tenant_id = ctx.tid
    CROSS JOIN q
   WHERE p.status = 'published'
     AND p.deleted_at IS NULL
     AND cardinality(_embedding) = 768
   ORDER BY pe.embedding <=> q.v
   LIMIT GREATEST(LEAST(coalesce(_limit, 40), 100), 1);
$$;

REVOKE ALL ON FUNCTION public.semantic_search_posts(double precision[], integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.semantic_search_posts(double precision[], integer)
  TO anon, authenticated, service_role;
