CREATE OR REPLACE FUNCTION public.club_semantic_search(
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
  ),
  scope AS (
    SELECT COALESCE(
      (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()),
      public.public_tenant_id()
    ) AS tenant_id
  )
  SELECT
    t.id, t.club_id, c.slug, c.name_pl, c.name_en,
    t.slug, t.title, t.kind, t.reply_count, t.last_reply_at,
    (1 - (e.embedding <=> q.v))::real AS similarity
  FROM public.club_thread_embeddings e
  CROSS JOIN q
  CROSS JOIN scope s
  JOIN public.club_threads t ON t.id = e.thread_id
  JOIN public.clubs c ON c.id = t.club_id
  JOIN public.club_groups g ON g.id = t.group_id
  CROSS JOIN LATERAL public.club_capabilities(t.club_id, t.group_id, auth.uid()) cap
  WHERE e.tenant_id = s.tenant_id
    AND cap.can_read
    AND t.status IN ('open', 'resolved', 'dormant', 'locked')
    AND (g.status NOT IN ('draft', 'archived') OR cap.can_manage)
    AND (p_club_id IS NULL OR t.club_id = p_club_id)
    AND (1 - (e.embedding <=> q.v)) >= COALESCE(p_threshold, 0.25)
  ORDER BY e.embedding <=> q.v
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
$$;

REVOKE EXECUTE ON FUNCTION public.club_semantic_search(double precision[], uuid, integer, real)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_semantic_search(double precision[], uuid, integer, real)
  TO authenticated, service_role;

UPDATE public.club_threads SET hotness = 0 WHERE hotness < 0;
UPDATE public.club_threads SET hotness = 9999999999 WHERE hotness >= 1e10;

ALTER TABLE public.club_threads DROP CONSTRAINT IF EXISTS club_threads_hotness_range;
ALTER TABLE public.club_threads
  ADD CONSTRAINT club_threads_hotness_range CHECK (hotness >= 0 AND hotness < 1e10);

COMMENT ON CONSTRAINT club_threads_hotness_range ON public.club_threads IS
  'Zakres wymuszony przez TEKSTOWY kursor listy tematow: to_char(hotness, FM0000000000.0000000000) zachowuje porzadek wylacznie dla wartosci nieujemnych o stalej szerokosci.';