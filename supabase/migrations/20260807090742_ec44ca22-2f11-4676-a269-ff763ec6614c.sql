CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.profile_embeddings (
  profile_id   uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  content_hash text NOT NULL,
  embedding    extensions.vector(768) NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.profile_embeddings IS
  'Wektor semantyczny profilu (768D). Odczyt wylacznie przez semantic_search_profiles.';

ALTER TABLE public.profile_embeddings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profile_embeddings FROM PUBLIC;
REVOKE ALL ON public.profile_embeddings FROM anon, authenticated;
GRANT ALL ON public.profile_embeddings TO service_role;

CREATE INDEX IF NOT EXISTS profile_embeddings_tenant_idx
  ON public.profile_embeddings (tenant_id);
CREATE INDEX IF NOT EXISTS profile_embeddings_hnsw
  ON public.profile_embeddings
  USING hnsw (embedding extensions.vector_cosine_ops);

CREATE OR REPLACE FUNCTION public.nes_profile_embedding_source(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT left(btrim(concat_ws(E'\n',
    nullif(btrim(concat_ws(' ',
      nullif(btrim(coalesce(p.job_title, '')), ''),
      nullif(btrim(coalesce(p.current_company, '')), ''))), ''),
    nullif(btrim(coalesce(p.specialization, '')), ''),
    nullif(btrim(coalesce(p.location, '')), ''),
    nullif(btrim(coalesce(p.seeking_pl, '')), ''),
    nullif(btrim(coalesce(p.seeking_en, '')), ''),
    nullif(btrim(coalesce(p.offering_pl, '')), ''),
    nullif(btrim(coalesce(p.offering_en, '')), ''),
    nullif(btrim(coalesce(p.bio_pl, '')), ''),
    nullif(btrim(coalesce(p.bio_en, '')), ''),
    (SELECT nullif(string_agg(s.label, ', ' ORDER BY s.sort_order, s.label), '')
       FROM public.profile_skills s WHERE s.user_id = p.id),
    (SELECT nullif(string_agg(DISTINCT e.role_title, ', '), '')
       FROM public.profile_experiences e WHERE e.user_id = p.id)
  )), 2000)
  FROM public.profiles p
  WHERE p.id = p_user_id;
$$;
REVOKE ALL ON FUNCTION public.nes_profile_embedding_source(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nes_profile_embedding_source(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.profiles_needing_embeddings(
  _limit integer DEFAULT 24,
  _min_completeness integer DEFAULT 40
)
RETURNS TABLE (profile_id uuid, tenant_id uuid, content_hash text, embed_text text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH src AS (
    SELECT p.id, p.tenant_id,
           public.nes_profile_embedding_source(p.id) AS embed_text
      FROM public.profiles p
     WHERE p.discoverable
       AND p.completeness_score >= GREATEST(LEAST(COALESCE(_min_completeness, 40), 100), 0)
  )
  SELECT s.id, s.tenant_id, md5(s.embed_text), s.embed_text
    FROM src s
    LEFT JOIN public.profile_embeddings pe ON pe.profile_id = s.id
   WHERE COALESCE(s.embed_text, '') <> ''
     AND (pe.profile_id IS NULL OR pe.content_hash IS DISTINCT FROM md5(s.embed_text))
   ORDER BY pe.profile_id IS NULL DESC, s.id
   LIMIT GREATEST(LEAST(COALESCE(_limit, 24), 200), 1);
$$;
REVOKE EXECUTE ON FUNCTION public.profiles_needing_embeddings(integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.profiles_needing_embeddings(integer, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.prune_profile_embeddings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_removed integer;
BEGIN
  DELETE FROM public.profile_embeddings pe
   WHERE NOT EXISTS (
     SELECT 1 FROM public.profiles p
      WHERE p.id = pe.profile_id
        AND p.discoverable
        AND p.completeness_score >= 40
   );
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  RETURN v_removed;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.prune_profile_embeddings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_profile_embeddings() TO service_role;

CREATE OR REPLACE FUNCTION public.semantic_search_profiles(
  _embedding double precision[],
  _limit integer DEFAULT 40
)
RETURNS TABLE (profile_id uuid, similarity real)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH me AS (
    SELECT p.id AS uid, p.tenant_id
      FROM public.profiles p
     WHERE p.id = auth.uid()
  ),
  q AS (
    SELECT (_embedding::extensions.vector(768)) AS v
  )
  SELECT pe.profile_id, (1 - (pe.embedding <=> q.v))::real AS similarity
    FROM public.profile_embeddings pe
    JOIN public.profiles p ON p.id = pe.profile_id
    CROSS JOIN me
    CROSS JOIN q
   WHERE auth.uid() IS NOT NULL
     AND cardinality(_embedding) = 768
     AND pe.tenant_id = me.tenant_id
     AND p.discoverable
     AND p.id <> me.uid
   ORDER BY pe.embedding <=> q.v
   LIMIT GREATEST(LEAST(COALESCE(_limit, 40), 100), 1);
$$;
REVOKE ALL ON FUNCTION public.semantic_search_profiles(double precision[], integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.semantic_search_profiles(double precision[], integer)
  TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.search_people(text, text, text, text, integer, integer, text, boolean);

CREATE FUNCTION public.search_people(
  p_query text DEFAULT '',
  p_specialization text DEFAULT NULL,
  p_company text DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0,
  p_job_title text DEFAULT NULL,
  p_verified_only boolean DEFAULT false,
  p_open_to text[] DEFAULT NULL,
  p_embedding double precision[] DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  display_name text,
  avatar_url text,
  job_title text,
  current_company text,
  specialization text,
  location text,
  slug text,
  verified boolean,
  open_to text[],
  seeking_pl text,
  seeking_en text,
  completeness_score smallint,
  match_score real,
  total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH q AS (
    SELECT n.raw, public.like_escape(n.raw) AS esc
    FROM (SELECT public.discovery_search_norm(p_query) AS raw) n
  ),
  qv AS (
    SELECT CASE
             WHEN p_embedding IS NOT NULL AND cardinality(p_embedding) = 768
               THEN p_embedding::extensions.vector(768)
           END AS v
  ),
  intents AS (
    SELECT NULLIF(ARRAY(
             SELECT c FROM unnest(COALESCE(p_open_to, '{}'::text[])) AS c
              WHERE c = ANY (public.nes_profile_open_to_catalog())
           ), '{}'::text[]) AS codes
  )
  SELECT
    p.id,
    COALESCE(
      NULLIF(btrim(p.display_name), ''),
      NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
      'User'
    ) AS display_name,
    CASE WHEN p.hide_avatar THEN NULL ELSE p.avatar_url END AS avatar_url,
    p.job_title,
    p.current_company,
    p.specialization,
    p.location,
    p.slug,
    (p.verified_at IS NOT NULL) AS verified,
    p.open_to,
    p.seeking_pl,
    p.seeking_en,
    p.completeness_score,
    (
      CASE WHEN q.raw <> '' THEN similarity(p.discovery_search, q.raw) ELSE 0 END
      + COALESCE((1 - (pe.embedding <=> qv.v))::real, 0) * 1.5
      + (COALESCE(p.completeness_score, 0)::real / 500)
    )::real AS match_score,
    count(*) OVER () AS total_count
  FROM public.profiles p
  CROSS JOIN q
  CROSS JOIN qv
  CROSS JOIN intents
  LEFT JOIN public.profile_embeddings pe
    ON qv.v IS NOT NULL AND pe.profile_id = p.id
  WHERE auth.uid() IS NOT NULL
    AND p.discoverable
    AND p.id <> auth.uid()
    AND p.tenant_id = (SELECT pr.tenant_id FROM public.profiles pr WHERE pr.id = auth.uid())
    AND (
      q.raw = ''
      OR (qv.v IS NULL AND p.discovery_search LIKE '%' || q.esc || '%')
      OR (qv.v IS NOT NULL AND (
            p.discovery_search LIKE '%' || q.esc || '%'
            OR (pe.profile_id IS NOT NULL AND (1 - (pe.embedding <=> qv.v)) >= 0.62)
          ))
    )
    AND (COALESCE(btrim(p_specialization), '') = ''
         OR lower(btrim(p.specialization)) = lower(btrim(p_specialization)))
    AND (COALESCE(btrim(p_company), '') = ''
         OR lower(btrim(p.current_company)) = lower(btrim(p_company)))
    AND (COALESCE(btrim(p_location), '') = ''
         OR lower(btrim(p.location)) = lower(btrim(p_location)))
    AND (COALESCE(btrim(p_job_title), '') = ''
         OR lower(btrim(p.job_title)) = lower(btrim(p_job_title)))
    AND (NOT COALESCE(p_verified_only, false) OR p.verified_at IS NOT NULL)
    AND (intents.codes IS NULL OR p.open_to && intents.codes)
  ORDER BY
    (q.raw <> '' AND p.discovery_search LIKE q.esc || '%') DESC,
    (
      CASE WHEN q.raw <> '' THEN similarity(p.discovery_search, q.raw) ELSE 0 END
      + COALESCE((1 - (pe.embedding <=> qv.v))::real, 0) * 1.5
      + (COALESCE(p.completeness_score, 0)::real / 500)
    ) DESC,
    lower(COALESCE(
      NULLIF(btrim(p.display_name), ''),
      concat_ws(' ', p.first_name, p.last_name)
    )) ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$$;

COMMENT ON FUNCTION public.search_people(
  text, text, text, text, integer, integer, text, boolean, text[], double precision[]) IS
  'Katalog osob: trigram po discovery_search + fasety + opcjonalny blend semantyczny (p_embedding, 768D). Ukryty avatar pozostaje ukryty.';

REVOKE ALL ON FUNCTION public.search_people(
  text, text, text, text, integer, integer, text, boolean, text[], double precision[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_people(
  text, text, text, text, integer, integer, text, boolean, text[], double precision[])
  TO authenticated, service_role;