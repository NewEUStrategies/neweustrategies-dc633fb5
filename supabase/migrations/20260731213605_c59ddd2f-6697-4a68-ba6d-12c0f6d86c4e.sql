CREATE OR REPLACE FUNCTION public.get_expert_materials(
  _slug_or_id text,
  _kind text DEFAULT NULL,
  _program_slug text DEFAULT NULL,
  _region_slug text DEFAULT NULL,
  _category_slug text DEFAULT NULL,
  _tag_slug text DEFAULT NULL,
  _year integer DEFAULT NULL,
  _page integer DEFAULT 1,
  _page_size integer DEFAULT 9
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_expert uuid;
  v_page integer := GREATEST(COALESCE(_page, 1), 1);
  v_size integer := LEAST(GREATEST(COALESCE(_page_size, 9), 1), 60);
  v_kind text := NULLIF(btrim(COALESCE(_kind, '')), '');
  v_program uuid;
  v_region uuid;
  v_category uuid;
  v_tag uuid;
  v_empty jsonb;
  v_total bigint := 0;
  v_sel jsonb := '[]'::jsonb;
  v_items jsonb := '[]'::jsonb;
  v_post_ids uuid[] := ARRAY[]::uuid[];
  v_post_categories jsonb := '[]'::jsonb;
  v_post_programs jsonb := '[]'::jsonb;
  v_post_regions jsonb := '[]'::jsonb;
  v_post_tags jsonb := '[]'::jsonb;
BEGIN
  v_empty := jsonb_build_object(
    'found', true,
    'total', 0,
    'page', v_page,
    'page_size', v_size,
    'items', '[]'::jsonb,
    'post_categories', '[]'::jsonb,
    'post_programs', '[]'::jsonb,
    'post_regions', '[]'::jsonb,
    'post_tags', '[]'::jsonb
  );

  SELECT id INTO v_expert FROM public.profiles_public
    WHERE slug = _slug_or_id LIMIT 1;
  IF v_expert IS NULL
     AND _slug_or_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id INTO v_expert FROM public.profiles_public
      WHERE id = _slug_or_id::uuid LIMIT 1;
  END IF;
  IF v_expert IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  IF v_kind IS NOT NULL
     AND v_kind NOT IN ('article', 'report', 'video', 'podcast', 'event') THEN
    RETURN v_empty;
  END IF;
  IF _program_slug IS NOT NULL THEN
    SELECT id INTO v_program FROM public.programs WHERE slug = _program_slug LIMIT 1;
    IF v_program IS NULL THEN RETURN v_empty; END IF;
  END IF;
  IF _region_slug IS NOT NULL THEN
    SELECT id INTO v_region FROM public.regions WHERE slug = _region_slug LIMIT 1;
    IF v_region IS NULL THEN RETURN v_empty; END IF;
  END IF;
  IF _category_slug IS NOT NULL THEN
    SELECT id INTO v_category FROM public.categories WHERE slug = _category_slug LIMIT 1;
    IF v_category IS NULL THEN RETURN v_empty; END IF;
  END IF;
  IF _tag_slug IS NOT NULL THEN
    SELECT id INTO v_tag FROM public.tags WHERE slug = _tag_slug LIMIT 1;
    IF v_tag IS NULL THEN RETURN v_empty; END IF;
  END IF;

  WITH cand AS (
    SELECT p.id,
           CASE
             WHEN p.post_format = 'video' THEN 'video'
             WHEN p.post_format = 'report' THEN 'report'
             ELSE 'article'
           END AS kind,
           'post'::text AS source,
           p.published_at AS d,
           (p.author_id IS DISTINCT FROM v_expert) AS is_coauthor
      FROM public.posts p
      LEFT JOIN public.post_authors pa
        ON pa.post_id = p.id AND pa.user_id = v_expert
      WHERE p.status = 'published' AND p.deleted_at IS NULL
        AND (p.author_id = v_expert OR pa.user_id IS NOT NULL)
        AND (v_program IS NULL OR EXISTS (
              SELECT 1 FROM public.post_programs x
                WHERE x.post_id = p.id AND x.program_id = v_program))
        AND (v_region IS NULL OR EXISTS (
              SELECT 1 FROM public.post_regions x
                WHERE x.post_id = p.id AND x.region_id = v_region))
        AND (v_category IS NULL OR EXISTS (
              SELECT 1 FROM public.post_categories x
                WHERE x.post_id = p.id AND x.category_id = v_category))
        AND (v_tag IS NULL OR EXISTS (
              SELECT 1 FROM public.post_tags x
                WHERE x.post_id = p.id AND x.tag_id = v_tag))
    UNION ALL
    SELECT pod.id, 'podcast', 'podcast', pod.published_at, false
      FROM public.podcasts pod
      WHERE pod.author_id = v_expert
        AND pod.status = 'published' AND pod.deleted_at IS NULL
        AND (v_program IS NULL OR pod.program_id = v_program)
        AND (v_region IS NULL OR pod.region_id = v_region)
        AND v_category IS NULL AND v_tag IS NULL
    UNION ALL
    SELECT e.id, 'event', 'event', e.starts_at, false
      FROM public.events e
      LEFT JOIN public.event_speakers es
        ON es.event_id = e.id AND es.user_id = v_expert
      WHERE e.status = 'published'
        AND (e.host_user_id = v_expert OR es.user_id IS NOT NULL)
        AND (v_program IS NULL OR e.program_id = v_program)
        AND (v_region IS NULL OR e.region_id = v_region)
        AND v_category IS NULL AND v_tag IS NULL
  ), filtered AS (
    SELECT c.* FROM cand c
      WHERE (v_kind IS NULL OR c.kind = v_kind)
        AND (_year IS NULL OR (c.d IS NOT NULL
             AND EXTRACT(YEAR FROM c.d AT TIME ZONE 'UTC')::integer = _year))
  ), page AS (
    SELECT f.id, f.source, f.is_coauthor,
           row_number() OVER (ORDER BY f.d DESC NULLS LAST, f.id ASC) AS rn
      FROM filtered f
      ORDER BY f.d DESC NULLS LAST, f.id ASC
      LIMIT v_size OFFSET (v_page - 1) * v_size
  )
  SELECT (SELECT count(*) FROM filtered),
         COALESCE((SELECT jsonb_agg(jsonb_build_object(
                     'id', pg.id,
                     'source', pg.source,
                     'is_coauthor', pg.is_coauthor
                   ) ORDER BY pg.rn) FROM page pg), '[]'::jsonb)
    INTO v_total, v_sel;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'source', s.source,
           'is_coauthor', s.is_coauthor,
           'row', CASE s.source
             WHEN 'post' THEN (
               SELECT to_jsonb(pr) FROM (
                 SELECT id, slug, title_pl, title_en, excerpt_pl, excerpt_en,
                        cover_image_url, published_at, post_format, author_id
                   FROM public.posts WHERE id = s.id
               ) pr)
             WHEN 'podcast' THEN (
               SELECT to_jsonb(pd) FROM (
                 SELECT id, slug, title_pl, title_en, excerpt_pl, excerpt_en,
                        cover_image_url, published_at, program_id, region_id
                   FROM public.podcasts WHERE id = s.id
               ) pd)
             ELSE (
               SELECT to_jsonb(ev) FROM (
                 SELECT id, slug, title_pl, title_en, description_pl,
                        description_en, cover_url, starts_at, program_id,
                        region_id, host_user_id
                   FROM public.events WHERE id = s.id
               ) ev)
           END
         ) ORDER BY s.ord), '[]'::jsonb)
    INTO v_items
    FROM (
      SELECT (e ->> 'id')::uuid AS id,
             e ->> 'source' AS source,
             COALESCE((e ->> 'is_coauthor')::boolean, false) AS is_coauthor,
             t.ord
        FROM jsonb_array_elements(v_sel) WITH ORDINALITY AS t(e, ord)
    ) s;

  SELECT COALESCE(array_agg((e ->> 'id')::uuid), ARRAY[]::uuid[])
    INTO v_post_ids
    FROM jsonb_array_elements(v_sel) e
    WHERE e ->> 'source' = 'post';

  IF array_length(v_post_ids, 1) IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(pc)), '[]'::jsonb) INTO v_post_categories
      FROM (SELECT post_id, category_id FROM public.post_categories
              WHERE post_id = ANY (v_post_ids)) pc;
    SELECT COALESCE(jsonb_agg(to_jsonb(pg)), '[]'::jsonb) INTO v_post_programs
      FROM (SELECT post_id, program_id FROM public.post_programs
              WHERE post_id = ANY (v_post_ids)) pg;
    SELECT COALESCE(jsonb_agg(to_jsonb(pr)), '[]'::jsonb) INTO v_post_regions
      FROM (SELECT post_id, region_id FROM public.post_regions
              WHERE post_id = ANY (v_post_ids)) pr;
    SELECT COALESCE(jsonb_agg(to_jsonb(pt)), '[]'::jsonb) INTO v_post_tags
      FROM (SELECT post_id, tag_id FROM public.post_tags
              WHERE post_id = ANY (v_post_ids)) pt;
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'total', v_total,
    'page', v_page,
    'page_size', v_size,
    'items', v_items,
    'post_categories', v_post_categories,
    'post_programs', v_post_programs,
    'post_regions', v_post_regions,
    'post_tags', v_post_tags
  );
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.get_expert_materials(text, text, text, text, text, text, integer, integer, integer)
  TO anon, authenticated, service_role;

CREATE INDEX IF NOT EXISTS idx_posts_author_published
  ON public.posts (author_id, published_at DESC)
  WHERE status = 'published' AND deleted_at IS NULL;