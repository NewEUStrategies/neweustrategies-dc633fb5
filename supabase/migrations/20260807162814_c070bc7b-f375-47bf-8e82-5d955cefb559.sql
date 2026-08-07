CREATE TABLE IF NOT EXISTS public.club_thread_embeddings (
  thread_id   uuid PRIMARY KEY REFERENCES public.club_threads(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  embedding   extensions.vector(768),
  source_hash text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS club_thread_embeddings_hnsw_idx
  ON public.club_thread_embeddings
  USING hnsw (embedding extensions.vector_cosine_ops);
CREATE INDEX IF NOT EXISTS club_thread_embeddings_tenant_idx
  ON public.club_thread_embeddings (tenant_id);
ALTER TABLE public.club_thread_embeddings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_thread_embeddings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.club_thread_embeddings TO service_role;

CREATE OR REPLACE FUNCTION public.club_thread_embedding_source(p_thread_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT concat_ws(E'\n',
    c.name_pl,
    g.name_pl,
    t.title,
    left(t.body, 4000)
  )
  FROM public.club_threads t
  JOIN public.club_groups g ON g.id = t.group_id
  JOIN public.clubs c ON c.id = t.club_id
  WHERE t.id = p_thread_id
$$;
REVOKE EXECUTE ON FUNCTION public.club_thread_embedding_source(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_thread_embedding_source(uuid) TO service_role;

DROP FUNCTION IF EXISTS public.club_threads_needing_embeddings(integer);
CREATE FUNCTION public.club_threads_needing_embeddings(p_limit integer DEFAULT 50)
RETURNS TABLE (thread_id uuid, tenant_id uuid, source text, source_hash text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidates AS (
    SELECT t.id, t.tenant_id,
           public.club_thread_embedding_source(t.id) AS src
      FROM public.club_threads t
     WHERE t.status IN ('open', 'resolved', 'dormant', 'locked')
     ORDER BY t.updated_at DESC
     LIMIT GREATEST(COALESCE(p_limit, 50), 1) * 4
  )
  SELECT c.id, c.tenant_id, c.src, md5(c.src)
    FROM candidates c
    LEFT JOIN public.club_thread_embeddings e ON e.thread_id = c.id
   WHERE c.src IS NOT NULL
     AND (e.thread_id IS NULL OR e.source_hash IS DISTINCT FROM md5(c.src))
   LIMIT GREATEST(COALESCE(p_limit, 50), 1)
$$;
REVOKE EXECUTE ON FUNCTION public.club_threads_needing_embeddings(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_threads_needing_embeddings(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.club_prune_thread_embeddings()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.club_thread_embeddings e
   WHERE NOT EXISTS (
     SELECT 1 FROM public.club_threads t
      WHERE t.id = e.thread_id
        AND t.status IN ('open', 'resolved', 'dormant', 'locked')
   );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.club_prune_thread_embeddings()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_prune_thread_embeddings() TO service_role;

DROP FUNCTION IF EXISTS public.club_search(text, uuid, integer);
CREATE FUNCTION public.club_search(
  p_query   text,
  p_club_id uuid DEFAULT NULL,
  p_limit   integer DEFAULT 20
)
RETURNS TABLE (
  thread_id uuid, club_id uuid, club_slug text, club_name_pl text, club_name_en text,
  thread_slug text, title text, snippet text, kind text,
  reply_count integer, last_reply_at timestamptz, rank real
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH q AS (
    SELECT websearch_to_tsquery('public.nes_polish', btrim(COALESCE(p_query, ''))) AS ts
  ),
  visible AS (
    SELECT t.*, c.slug AS c_slug, c.name_pl AS c_pl, c.name_en AS c_en
      FROM public.club_threads t
      JOIN public.clubs c ON c.id = t.club_id
      CROSS JOIN LATERAL public.club_capabilities(t.club_id, t.group_id, auth.uid()) cap
     WHERE cap.can_read
       AND t.status IN ('open', 'resolved', 'dormant', 'locked')
       AND (p_club_id IS NULL OR t.club_id = p_club_id)
  )
  SELECT
    v.id, v.club_id, v.c_slug, v.c_pl, v.c_en,
    v.slug, v.title,
    ts_headline('public.nes_polish', left(v.body, 2000), q.ts,
                'MaxWords=30, MinWords=15, ShortWord=3, MaxFragments=1') AS snippet,
    v.kind, v.reply_count, v.last_reply_at,
    ts_rank(v.search_vector, q.ts) AS rank
  FROM visible v, q
  WHERE q.ts IS NOT NULL
    AND btrim(COALESCE(p_query, '')) <> ''
    AND v.search_vector @@ q.ts
  ORDER BY ts_rank(v.search_vector, q.ts) DESC, v.last_reply_at DESC NULLS LAST, v.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
$$;
REVOKE EXECUTE ON FUNCTION public.club_search(text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_search(text, uuid, integer)
  TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.club_semantic_search(double precision[], uuid, integer, real);
CREATE FUNCTION public.club_semantic_search(
  p_embedding double precision[],
  p_club_id   uuid DEFAULT NULL,
  p_limit     integer DEFAULT 20,
  p_threshold real DEFAULT 0.25
)
RETURNS TABLE (
  thread_id uuid, club_id uuid, club_slug text, club_name_pl text, club_name_en text,
  thread_slug text, title text, kind text,
  reply_count integer, last_reply_at timestamptz, similarity real
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH q AS (
    SELECT (p_embedding::extensions.vector(768)) AS v
     WHERE p_embedding IS NOT NULL AND array_length(p_embedding, 1) = 768
  )
  SELECT
    t.id, t.club_id, c.slug, c.name_pl, c.name_en,
    t.slug, t.title, t.kind, t.reply_count, t.last_reply_at,
    (1 - (e.embedding <=> q.v))::real AS similarity
  FROM public.club_thread_embeddings e
  CROSS JOIN q
  JOIN public.club_threads t ON t.id = e.thread_id
  JOIN public.clubs c ON c.id = t.club_id
  CROSS JOIN LATERAL public.club_capabilities(t.club_id, t.group_id, auth.uid()) cap
  WHERE cap.can_read
    AND t.status IN ('open', 'resolved', 'dormant', 'locked')
    AND (p_club_id IS NULL OR t.club_id = p_club_id)
    AND (1 - (e.embedding <=> q.v)) >= COALESCE(p_threshold, 0.25)
  ORDER BY e.embedding <=> q.v, t.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
$$;
REVOKE EXECUTE ON FUNCTION public.club_semantic_search(double precision[], uuid, integer, real)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_semantic_search(double precision[], uuid, integer, real)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_upsert_thread_embedding(
  p_thread_id uuid, p_embedding double precision[], p_source_hash text
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF p_embedding IS NULL OR array_length(p_embedding, 1) IS DISTINCT FROM 768 THEN
    RAISE EXCEPTION 'clubs: embedding must have 768 dimensions' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.club_thread_embeddings (thread_id, tenant_id, embedding, source_hash, updated_at)
  SELECT t.id, t.tenant_id, p_embedding::extensions.vector(768), p_source_hash, now()
    FROM public.club_threads t WHERE t.id = p_thread_id
  ON CONFLICT (thread_id) DO UPDATE
    SET embedding = EXCLUDED.embedding,
        source_hash = EXCLUDED.source_hash,
        updated_at = now();
  RETURN FOUND;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.club_upsert_thread_embedding(uuid, double precision[], text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_upsert_thread_embedding(uuid, double precision[], text)
  TO service_role;

DROP FUNCTION IF EXISTS public.club_threads_for_anchor(text, text, integer);
CREATE FUNCTION public.club_threads_for_anchor(
  p_anchor_type text, p_anchor_id text, p_limit integer DEFAULT 5
)
RETURNS TABLE (
  thread_id uuid, thread_slug text, title text, kind text,
  club_slug text, club_name_pl text, club_name_en text,
  reply_count integer, last_reply_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id, t.slug, t.title, t.kind,
    c.slug, c.name_pl, c.name_en,
    t.reply_count, t.last_reply_at
  FROM public.club_threads t
  JOIN public.clubs c ON c.id = t.club_id
  CROSS JOIN LATERAL public.club_capabilities(t.club_id, t.group_id, auth.uid()) cap
  WHERE t.anchor_type = p_anchor_type
    AND t.anchor_id = p_anchor_id
    AND cap.can_read
    AND t.status IN ('open', 'resolved', 'locked')
  ORDER BY t.last_reply_at DESC NULLS LAST, t.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 5), 1), 20)
$$;
REVOKE EXECUTE ON FUNCTION public.club_threads_for_anchor(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_threads_for_anchor(text, text, integer)
  TO anon, authenticated, service_role;