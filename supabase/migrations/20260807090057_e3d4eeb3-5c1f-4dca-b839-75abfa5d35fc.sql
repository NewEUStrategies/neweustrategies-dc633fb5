CREATE OR REPLACE FUNCTION public.nes_profile_open_to_catalog()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY[
    'consortium',
    'partnership',
    'advisory',
    'speaking',
    'co_authoring',
    'mentoring',
    'hiring',
    'job_change',
    'investment',
    'media'
  ]::text[];
$$;
COMMENT ON FUNCTION public.nes_profile_open_to_catalog() IS
  'Zamkniety katalog kodow intencji profilu (profiles.open_to). Lustro klienckie: src/lib/profile/intents.ts.';
REVOKE ALL ON FUNCTION public.nes_profile_open_to_catalog() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nes_profile_open_to_catalog()
  TO anon, authenticated, service_role;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS open_to text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS seeking_pl text,
  ADD COLUMN IF NOT EXISTS seeking_en text,
  ADD COLUMN IF NOT EXISTS offering_pl text,
  ADD COLUMN IF NOT EXISTS offering_en text,
  ADD COLUMN IF NOT EXISTS intent_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS completeness_score smallint NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_open_to_catalog_check
    CHECK (open_to <@ public.nes_profile_open_to_catalog());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_open_to_cardinality_check
    CHECK (COALESCE(array_length(open_to, 1), 0) <= 6);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_intent_text_length_check
    CHECK (
      COALESCE(char_length(seeking_pl), 0)  <= 600
      AND COALESCE(char_length(seeking_en), 0)  <= 600
      AND COALESCE(char_length(offering_pl), 0) <= 600
      AND COALESCE(char_length(offering_en), 0) <= 600
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_completeness_range_check
    CHECK (completeness_score BETWEEN 0 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT (open_to, seeking_pl, seeking_en, offering_pl, offering_en,
              intent_updated_at, completeness_score)
  ON public.profiles TO anon, authenticated;

CREATE INDEX IF NOT EXISTS profiles_open_to_gin
  ON public.profiles USING gin (open_to)
  WHERE discoverable;
CREATE INDEX IF NOT EXISTS profiles_completeness_idx
  ON public.profiles (tenant_id, completeness_score DESC)
  WHERE discoverable;

CREATE OR REPLACE FUNCTION public.nes_profile_completeness_row(
  p_avatar_url      text,
  p_display_name    text,
  p_first_name      text,
  p_last_name       text,
  p_job_title       text,
  p_current_company text,
  p_location        text,
  p_specialization  text,
  p_bio_pl          text,
  p_bio_en          text,
  p_open_to         text[],
  p_seeking_pl      text,
  p_seeking_en      text,
  p_skills          integer,
  p_experiences     integer,
  p_education       integer
)
RETURNS smallint
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT LEAST(GREATEST(
      CASE WHEN COALESCE(btrim(p_avatar_url), '') <> '' THEN 10 ELSE 0 END
    + CASE WHEN COALESCE(btrim(p_display_name), '') <> ''
             OR COALESCE(btrim(concat_ws(' ', p_first_name, p_last_name)), '') <> ''
           THEN 8 ELSE 0 END
    + CASE WHEN COALESCE(btrim(p_job_title), '') <> '' THEN 8 ELSE 0 END
    + CASE WHEN COALESCE(btrim(p_current_company), '') <> '' THEN 6 ELSE 0 END
    + CASE WHEN COALESCE(btrim(p_location), '') <> '' THEN 6 ELSE 0 END
    + CASE WHEN COALESCE(btrim(p_specialization), '') <> '' THEN 6 ELSE 0 END
    + CASE WHEN GREATEST(char_length(COALESCE(btrim(p_bio_pl), '')),
                         char_length(COALESCE(btrim(p_bio_en), ''))) >= 120
           THEN 14 ELSE 0 END
    + CASE WHEN COALESCE(array_length(p_open_to, 1), 0) >= 1 THEN 10 ELSE 0 END
    + CASE WHEN GREATEST(char_length(COALESCE(btrim(p_seeking_pl), '')),
                         char_length(COALESCE(btrim(p_seeking_en), ''))) >= 40
           THEN 12 ELSE 0 END
    + CASE WHEN COALESCE(p_skills, 0) >= 3 THEN 10 ELSE 0 END
    + CASE WHEN COALESCE(p_experiences, 0) >= 1 THEN 6 ELSE 0 END
    + CASE WHEN COALESCE(p_education, 0) >= 1 THEN 4 ELSE 0 END
  , 0), 100)::smallint;
$$;
REVOKE ALL ON FUNCTION public.nes_profile_completeness_row(
  text, text, text, text, text, text, text, text, text, text,
  text[], text, text, integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nes_profile_completeness_row(
  text, text, text, text, text, text, text, text, text, text,
  text[], text, text, integer, integer, integer)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.nes_profile_completeness(p_user_id uuid)
RETURNS smallint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.nes_profile_completeness_row(
    p.avatar_url, p.display_name, p.first_name, p.last_name,
    p.job_title, p.current_company, p.location, p.specialization,
    p.bio_pl, p.bio_en,
    p.open_to, p.seeking_pl, p.seeking_en,
    (SELECT count(*)::int FROM public.profile_skills s      WHERE s.user_id = p.id),
    (SELECT count(*)::int FROM public.profile_experiences e WHERE e.user_id = p.id),
    (SELECT count(*)::int FROM public.profile_education d   WHERE d.user_id = p.id)
  )
  FROM public.profiles p
  WHERE p.id = p_user_id;
$$;
REVOKE ALL ON FUNCTION public.nes_profile_completeness(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nes_profile_completeness(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.profiles_completeness_refresh()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (NEW.open_to      IS DISTINCT FROM OLD.open_to
       OR NEW.seeking_pl   IS DISTINCT FROM OLD.seeking_pl
       OR NEW.seeking_en   IS DISTINCT FROM OLD.seeking_en
       OR NEW.offering_pl  IS DISTINCT FROM OLD.offering_pl
       OR NEW.offering_en  IS DISTINCT FROM OLD.offering_en) THEN
    NEW.intent_updated_at := now();
  ELSIF TG_OP = 'INSERT'
        AND (COALESCE(array_length(NEW.open_to, 1), 0) > 0
          OR COALESCE(btrim(NEW.seeking_pl), '') <> ''
          OR COALESCE(btrim(NEW.seeking_en), '') <> '') THEN
    NEW.intent_updated_at := now();
  END IF;
  NEW.completeness_score := public.nes_profile_completeness_row(
    NEW.avatar_url, NEW.display_name, NEW.first_name, NEW.last_name,
    NEW.job_title, NEW.current_company, NEW.location, NEW.specialization,
    NEW.bio_pl, NEW.bio_en,
    NEW.open_to, NEW.seeking_pl, NEW.seeking_en,
    (SELECT count(*)::int FROM public.profile_skills s      WHERE s.user_id = NEW.id),
    (SELECT count(*)::int FROM public.profile_experiences e WHERE e.user_id = NEW.id),
    (SELECT count(*)::int FROM public.profile_education d   WHERE d.user_id = NEW.id)
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS profiles_completeness_trg ON public.profiles;
CREATE TRIGGER profiles_completeness_trg
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_completeness_refresh();

CREATE OR REPLACE FUNCTION public.tg_profile_child_completeness()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := COALESCE(NEW.user_id, OLD.user_id);
BEGIN
  IF v_user IS NOT NULL THEN
    UPDATE public.profiles
       SET completeness_score = public.nes_profile_completeness(v_user)
     WHERE id = v_user;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS profile_skills_completeness_trg ON public.profile_skills;
CREATE TRIGGER profile_skills_completeness_trg
  AFTER INSERT OR DELETE ON public.profile_skills
  FOR EACH ROW EXECUTE FUNCTION public.tg_profile_child_completeness();
DROP TRIGGER IF EXISTS profile_experiences_completeness_trg ON public.profile_experiences;
CREATE TRIGGER profile_experiences_completeness_trg
  AFTER INSERT OR DELETE ON public.profile_experiences
  FOR EACH ROW EXECUTE FUNCTION public.tg_profile_child_completeness();
DROP TRIGGER IF EXISTS profile_education_completeness_trg ON public.profile_education;
CREATE TRIGGER profile_education_completeness_trg
  AFTER INSERT OR DELETE ON public.profile_education
  FOR EACH ROW EXECUTE FUNCTION public.tg_profile_child_completeness();

UPDATE public.profiles p
   SET completeness_score = public.nes_profile_completeness_row(
     p.avatar_url, p.display_name, p.first_name, p.last_name,
     p.job_title, p.current_company, p.location, p.specialization,
     p.bio_pl, p.bio_en,
     p.open_to, p.seeking_pl, p.seeking_en,
     c.skills, c.experiences, c.education
   )
  FROM (
    SELECT p2.id,
           (SELECT count(*)::int FROM public.profile_skills s      WHERE s.user_id = p2.id) AS skills,
           (SELECT count(*)::int FROM public.profile_experiences e WHERE e.user_id = p2.id) AS experiences,
           (SELECT count(*)::int FROM public.profile_education d   WHERE d.user_id = p2.id) AS education
      FROM public.profiles p2
  ) c
 WHERE c.id = p.id;

CREATE OR REPLACE FUNCTION public.profiles_discovery_search_refresh()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.discovery_search := public.discovery_search_norm(concat_ws(' ',
    NEW.display_name, NEW.first_name, NEW.last_name,
    NEW.job_title, NEW.current_company, NEW.specialization, NEW.location, NEW.slug,
    NEW.seeking_pl, NEW.seeking_en, NEW.offering_pl, NEW.offering_en
  ));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS profiles_discovery_search_trg ON public.profiles;
CREATE TRIGGER profiles_discovery_search_trg
  BEFORE INSERT OR UPDATE OF display_name, first_name, last_name,
    job_title, current_company, specialization, location, slug,
    seeking_pl, seeking_en, offering_pl, offering_en
  ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_discovery_search_refresh();

UPDATE public.profiles
   SET discovery_search = public.discovery_search_norm(concat_ws(' ',
     display_name, first_name, last_name,
     job_title, current_company, specialization, location, slug,
     seeking_pl, seeking_en, offering_pl, offering_en))
 WHERE discovery_search IS DISTINCT FROM public.discovery_search_norm(concat_ws(' ',
     display_name, first_name, last_name,
     job_title, current_company, specialization, location, slug,
     seeking_pl, seeking_en, offering_pl, offering_en));

CREATE OR REPLACE FUNCTION public.people_filter_options()
RETURNS TABLE (field text, value text, cnt bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH base AS (
    SELECT p.specialization, p.current_company, p.location, p.job_title, p.open_to
      FROM public.profiles p
     WHERE auth.uid() IS NOT NULL
       AND p.discoverable
       AND p.id <> auth.uid()
       AND p.tenant_id = (SELECT pr.tenant_id FROM public.profiles pr WHERE pr.id = auth.uid())
  ),
  spec AS (
    SELECT 'specialization'::text AS field, btrim(b.specialization) AS value, count(*) AS cnt
      FROM base b WHERE COALESCE(btrim(b.specialization), '') <> ''
     GROUP BY 2
  ),
  comp AS (
    SELECT 'company'::text AS field, btrim(b.current_company) AS value, count(*) AS cnt
      FROM base b WHERE COALESCE(btrim(b.current_company), '') <> ''
     GROUP BY 2
  ),
  loc AS (
    SELECT 'location'::text AS field, btrim(b.location) AS value, count(*) AS cnt
      FROM base b WHERE COALESCE(btrim(b.location), '') <> ''
     GROUP BY 2
  ),
  job_titles AS (
    SELECT 'job_title'::text AS field, btrim(b.job_title) AS value, count(*) AS cnt
      FROM base b WHERE COALESCE(btrim(b.job_title), '') <> ''
     GROUP BY 2
  ),
  intents AS (
    SELECT 'open_to'::text AS field, x.code AS value, count(*) AS cnt
      FROM base b
      CROSS JOIN LATERAL unnest(b.open_to) AS x(code)
     WHERE x.code = ANY (public.nes_profile_open_to_catalog())
     GROUP BY 2
  )
  SELECT * FROM (
    SELECT * FROM spec
    UNION ALL SELECT * FROM comp
    UNION ALL SELECT * FROM loc
    UNION ALL SELECT * FROM job_titles
    UNION ALL SELECT * FROM intents
  ) all_options
  ORDER BY field ASC, cnt DESC, value ASC
$$;
REVOKE ALL ON FUNCTION public.people_filter_options() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.people_filter_options() TO authenticated, service_role;