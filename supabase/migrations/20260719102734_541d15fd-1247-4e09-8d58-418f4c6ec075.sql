DROP FUNCTION IF EXISTS public.search_people_orgs(text, int);

CREATE OR REPLACE FUNCTION public.search_people_orgs(
  _q text DEFAULT NULL,
  _limit int DEFAULT 40
)
RETURNS TABLE (
  kind text, id uuid, slug text, label_pl text, label_en text,
  sublabel_pl text, sublabel_en text, avatar_url text, logo_url text,
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
           NULLIF(concat_ws(' - ',
             coalesce(ap.job_title, pr.job_title),
             coalesce(ap.company, pr.current_company)), '') AS sub,
           pr.avatar_url,
           NULL::text AS logo_url,
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
           NULL::text AS avatar_url,
           c.logo_url,
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
           pe.avatar_url, pe.logo_url, pe.verified, pe.post_count,
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
           o.avatar_url, o.logo_url, false, o.post_count,
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
         c.sublabel_pl, c.sublabel_en, c.avatar_url, c.logo_url,
         c.verified, c.post_count, c.score::real
    FROM cand c, nq
   WHERE nq.q = '' OR length(nq.q) < 2 OR c.score > 0.3
   ORDER BY c.score DESC, c.post_count DESC, c.label_pl
   LIMIT GREATEST(LEAST(coalesce(_limit, 40), 100), 1);
$$;

REVOKE ALL ON FUNCTION public.search_people_orgs(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_people_orgs(text, int)
  TO anon, authenticated, service_role;
