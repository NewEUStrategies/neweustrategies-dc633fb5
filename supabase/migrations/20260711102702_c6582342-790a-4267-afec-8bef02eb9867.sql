-- =============================================================
-- 1) personality_result_history
-- =============================================================
CREATE TABLE IF NOT EXISTS public.personality_result_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  openness smallint NOT NULL,
  conscientiousness smallint NOT NULL,
  extraversion smallint NOT NULL,
  agreeableness smallint NOT NULL,
  neuroticism smallint NOT NULL,
  answers jsonb,
  taken_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS personality_result_history_user_idx
  ON public.personality_result_history (user_id, taken_at DESC);
CREATE INDEX IF NOT EXISTS personality_result_history_tenant_idx
  ON public.personality_result_history (tenant_id, taken_at DESC);

GRANT SELECT ON public.personality_result_history TO authenticated;
GRANT ALL ON public.personality_result_history TO service_role;

ALTER TABLE public.personality_result_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS personality_history_owner_read ON public.personality_result_history;
CREATE POLICY personality_history_owner_read
  ON public.personality_result_history
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS personality_history_admin_read ON public.personality_result_history;
CREATE POLICY personality_history_admin_read
  ON public.personality_result_history
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin'::app_role)
         OR public.has_role(auth.uid(), 'super_admin'::app_role))
  );

-- Trigger: każdy INSERT/UPDATE na personality_results dorzuca wpis do historii
CREATE OR REPLACE FUNCTION public.personality_results_append_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.personality_result_history (
    user_id, tenant_id,
    openness, conscientiousness, extraversion, agreeableness, neuroticism,
    answers, taken_at
  ) VALUES (
    NEW.user_id, NEW.tenant_id,
    NEW.openness, NEW.conscientiousness, NEW.extraversion, NEW.agreeableness, NEW.neuroticism,
    NEW.answers, COALESCE(NEW.taken_at, now())
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS personality_results_append_history_trg ON public.personality_results;
CREATE TRIGGER personality_results_append_history_trg
  AFTER INSERT OR UPDATE ON public.personality_results
  FOR EACH ROW EXECUTE FUNCTION public.personality_results_append_history();

-- =============================================================
-- 2) search_people - rozszerzona sygnatura
--    (frontend woła: p_query, p_specialization, p_company, p_location, p_limit, p_offset)
-- =============================================================
DROP FUNCTION IF EXISTS public.search_people(text, integer);

CREATE OR REPLACE FUNCTION public.search_people(
  p_query text DEFAULT NULL,
  p_specialization text DEFAULT NULL,
  p_company text DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_limit integer DEFAULT 24,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  display_name text,
  avatar_url text,
  job_title text,
  current_company text,
  specialization text,
  location text,
  slug text,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()),
  base AS (
    SELECT p.id, p.display_name, p.avatar_url, p.job_title,
           p.current_company, p.specialization, p.location, p.slug
    FROM public.profiles p, me
    WHERE p.discoverable = true
      AND p.tenant_id = me.tenant_id
      AND p.id <> auth.uid()
      AND (p_specialization IS NULL OR p.specialization = p_specialization)
      AND (p_company IS NULL OR p.current_company = p_company)
      AND (p_location IS NULL OR p.location = p_location)
      AND (
        coalesce(p_query, '') = ''
        OR p.display_name    ILIKE '%' || p_query || '%'
        OR p.first_name      ILIKE '%' || p_query || '%'
        OR p.last_name       ILIKE '%' || p_query || '%'
        OR p.job_title       ILIKE '%' || p_query || '%'
        OR p.current_company ILIKE '%' || p_query || '%'
        OR p.specialization  ILIKE '%' || p_query || '%'
        OR p.location        ILIKE '%' || p_query || '%'
      )
  ),
  counted AS (SELECT count(*) AS c FROM base)
  SELECT b.id, b.display_name, b.avatar_url, b.job_title,
         b.current_company, b.specialization, b.location, b.slug,
         (SELECT c FROM counted) AS total_count
  FROM base b
  ORDER BY b.display_name NULLS LAST
  OFFSET GREATEST(p_offset, 0)
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;

GRANT EXECUTE ON FUNCTION public.search_people(text, text, text, text, integer, integer)
  TO authenticated;

-- =============================================================
-- 3) people_filter_options - fasety dla katalogu osób
-- =============================================================
CREATE OR REPLACE FUNCTION public.people_filter_options()
RETURNS TABLE(field text, value text, cnt bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()),
  visible AS (
    SELECT p.specialization, p.current_company, p.location
    FROM public.profiles p, me
    WHERE p.discoverable = true
      AND p.tenant_id = me.tenant_id
      AND p.id <> auth.uid()
  )
  SELECT 'specialization'::text, specialization, count(*)::bigint
    FROM visible WHERE specialization IS NOT NULL AND btrim(specialization) <> ''
    GROUP BY specialization
  UNION ALL
  SELECT 'company'::text, current_company, count(*)::bigint
    FROM visible WHERE current_company IS NOT NULL AND btrim(current_company) <> ''
    GROUP BY current_company
  UNION ALL
  SELECT 'location'::text, location, count(*)::bigint
    FROM visible WHERE location IS NOT NULL AND btrim(location) <> ''
    GROUP BY location
  ORDER BY 1, 3 DESC, 2;
$$;

GRANT EXECUTE ON FUNCTION public.people_filter_options() TO authenticated;

-- =============================================================
-- 4) get_followed_feed - realny feed obserwowanych
-- =============================================================
CREATE OR REPLACE FUNCTION public.get_followed_feed(
  p_limit integer DEFAULT 12,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  slug text,
  title_pl text,
  title_en text,
  excerpt_pl text,
  excerpt_en text,
  cover_image_url text,
  published_at timestamptz,
  parent_page_id uuid,
  author_id uuid,
  reasons text[],
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (SELECT auth.uid() AS uid, public.public_tenant_id() AS tenant_id),
  followed_authors AS (
    SELECT target_id FROM public.user_follows, me
      WHERE user_id = me.uid AND target_type = 'author'
  ),
  followed_categories AS (
    SELECT target_id FROM public.user_follows, me
      WHERE user_id = me.uid AND target_type = 'category'
  ),
  followed_tags AS (
    SELECT target_id FROM public.user_follows, me
      WHERE user_id = me.uid AND target_type = 'tag'
  ),
  candidates AS (
    SELECT p.id,
      array_remove(ARRAY[
        CASE WHEN EXISTS (SELECT 1 FROM followed_authors fa WHERE fa.target_id = p.author_id) THEN 'author' END,
        CASE WHEN EXISTS (
          SELECT 1 FROM public.post_categories pc
          JOIN followed_categories fc ON fc.target_id = pc.category_id
          WHERE pc.post_id = p.id
        ) THEN 'category' END,
        CASE WHEN EXISTS (
          SELECT 1 FROM public.post_tags pt
          JOIN followed_tags ft ON ft.target_id = pt.tag_id
          WHERE pt.post_id = p.id
        ) THEN 'tag' END
      ], NULL) AS reasons
    FROM public.posts p, me
    WHERE p.status = 'published'
      AND p.deleted_at IS NULL
      AND p.tenant_id = me.tenant_id
  ),
  filtered AS (
    SELECT c.id, c.reasons
    FROM candidates c
    WHERE array_length(c.reasons, 1) > 0
  ),
  counted AS (SELECT count(*) AS c FROM filtered)
  SELECT p.id, p.slug, p.title_pl, p.title_en, p.excerpt_pl, p.excerpt_en,
         p.cover_image_url, p.published_at, p.parent_page_id, p.author_id,
         f.reasons, (SELECT c FROM counted) AS total_count
  FROM filtered f
  JOIN public.posts p ON p.id = f.id
  ORDER BY p.published_at DESC NULLS LAST
  OFFSET GREATEST(p_offset, 0)
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;

REVOKE EXECUTE ON FUNCTION public.get_followed_feed(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_followed_feed(integer, integer) TO authenticated;

-- =============================================================
-- 5) get_recommended_posts_v2 - scoring w SQL, gość + zalogowany
-- =============================================================
-- DROP konieczny dla świeżego `db reset`: 20260711100000 tworzy tę funkcję
-- z INNYM zestawem kolumn wyjściowych, a CREATE OR REPLACE nie może zmienić
-- typu zwracanego (42P13). Na hostowanej bazie (migracja już zaaplikowana)
-- ta poprawka nic nie zmienia. Wersję kanoniczną definiuje 20260711120000.
DROP FUNCTION IF EXISTS public.get_recommended_posts_v2(integer, integer, uuid[], uuid[]);

CREATE OR REPLACE FUNCTION public.get_recommended_posts_v2(
  p_limit integer DEFAULT 9,
  p_offset integer DEFAULT 0,
  p_category_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_tag_ids uuid[] DEFAULT ARRAY[]::uuid[]
)
RETURNS TABLE(
  id uuid,
  slug text,
  title_pl text,
  title_en text,
  excerpt_pl text,
  excerpt_en text,
  cover_image_url text,
  published_at timestamptz,
  parent_page_id uuid,
  author_id uuid,
  score numeric,
  reasons text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ctx AS (
    SELECT auth.uid() AS uid, public.public_tenant_id() AS tenant_id
  ),
  followed_authors AS (
    SELECT target_id FROM public.user_follows, ctx
      WHERE ctx.uid IS NOT NULL AND user_id = ctx.uid AND target_type = 'author'
  ),
  followed_categories AS (
    SELECT target_id FROM public.user_follows, ctx
      WHERE ctx.uid IS NOT NULL AND user_id = ctx.uid AND target_type = 'category'
  ),
  followed_tags AS (
    SELECT target_id FROM public.user_follows, ctx
      WHERE ctx.uid IS NOT NULL AND user_id = ctx.uid AND target_type = 'tag'
  ),
  history_posts AS (
    SELECT post_id FROM public.user_read_history, ctx
      WHERE ctx.uid IS NOT NULL AND user_id = ctx.uid
      ORDER BY read_at DESC LIMIT 100
  ),
  history_categories AS (
    SELECT DISTINCT pc.category_id AS target_id
    FROM public.post_categories pc
    WHERE pc.post_id IN (SELECT post_id FROM history_posts)
  ),
  history_tags AS (
    SELECT DISTINCT pt.tag_id AS target_id
    FROM public.post_tags pt
    WHERE pt.post_id IN (SELECT post_id FROM history_posts)
  ),
  scored AS (
    SELECT p.id,
      (
        CASE WHEN EXISTS (SELECT 1 FROM followed_authors fa WHERE fa.target_id = p.author_id) THEN 4 ELSE 0 END
      + CASE WHEN EXISTS (
          SELECT 1 FROM public.post_categories pc
          JOIN followed_categories fc ON fc.target_id = pc.category_id
          WHERE pc.post_id = p.id
        ) THEN 3 ELSE 0 END
      + CASE WHEN EXISTS (
          SELECT 1 FROM public.post_tags pt
          JOIN followed_tags ft ON ft.target_id = pt.tag_id
          WHERE pt.post_id = p.id
        ) THEN 2 ELSE 0 END
      + CASE WHEN array_length(p_category_ids, 1) IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.post_categories pc
          WHERE pc.post_id = p.id AND pc.category_id = ANY(p_category_ids)
        ) THEN 3 ELSE 0 END
      + CASE WHEN array_length(p_tag_ids, 1) IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.post_tags pt
          WHERE pt.post_id = p.id AND pt.tag_id = ANY(p_tag_ids)
        ) THEN 2 ELSE 0 END
      + CASE WHEN EXISTS (
          SELECT 1 FROM public.post_categories pc
          JOIN history_categories hc ON hc.target_id = pc.category_id
          WHERE pc.post_id = p.id
        ) THEN 1 ELSE 0 END
      + CASE WHEN EXISTS (
          SELECT 1 FROM public.post_tags pt
          JOIN history_tags ht ON ht.target_id = pt.tag_id
          WHERE pt.post_id = p.id
        ) THEN 1 ELSE 0 END
      + CASE WHEN p.published_at > now() - interval '30 days' THEN 1 ELSE 0 END
      )::numeric AS score,
      array_remove(ARRAY[
        CASE WHEN EXISTS (SELECT 1 FROM followed_authors fa WHERE fa.target_id = p.author_id) THEN 'author' END,
        CASE WHEN EXISTS (
          SELECT 1 FROM public.post_categories pc
          JOIN followed_categories fc ON fc.target_id = pc.category_id
          WHERE pc.post_id = p.id
        ) THEN 'category' END,
        CASE WHEN EXISTS (
          SELECT 1 FROM public.post_tags pt
          JOIN followed_tags ft ON ft.target_id = pt.tag_id
          WHERE pt.post_id = p.id
        ) THEN 'tag' END,
        CASE WHEN EXISTS (SELECT 1 FROM history_posts hp WHERE hp.post_id = p.id)
             OR EXISTS (
               SELECT 1 FROM public.post_categories pc
               JOIN history_categories hc ON hc.target_id = pc.category_id
               WHERE pc.post_id = p.id
             ) THEN 'history' END,
        CASE WHEN p.published_at > now() - interval '30 days' THEN 'fresh' END
      ], NULL) AS reasons
    FROM public.posts p, ctx
    WHERE p.status = 'published'
      AND p.deleted_at IS NULL
      AND p.tenant_id = ctx.tenant_id
      AND NOT EXISTS (SELECT 1 FROM history_posts hp WHERE hp.post_id = p.id)
  )
  SELECT p.id, p.slug, p.title_pl, p.title_en, p.excerpt_pl, p.excerpt_en,
         p.cover_image_url, p.published_at, p.parent_page_id, p.author_id,
         s.score, s.reasons
  FROM scored s
  JOIN public.posts p ON p.id = s.id
  ORDER BY s.score DESC, p.published_at DESC NULLS LAST
  OFFSET GREATEST(p_offset, 0)
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;

GRANT EXECUTE ON FUNCTION public.get_recommended_posts_v2(integer, integer, uuid[], uuid[])
  TO anon, authenticated;
