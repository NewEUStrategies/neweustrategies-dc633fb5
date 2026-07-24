
-- 1) profile_cv_files: remove public read; owner-only access remains.
DROP POLICY IF EXISTS "public read current cv" ON public.profile_cv_files;

-- 2) Curated public views for profile sub-tables. security_invoker=off so the
--    view runs as its (superuser) owner and can bypass the base-table RLS;
--    security_barrier=true prevents predicate leaking. Row filter uses the
--    same profile_is_public() check as the old policies.

-- profile_skills_public
DROP VIEW IF EXISTS public.profile_skills_public;
CREATE VIEW public.profile_skills_public
  WITH (security_invoker = off, security_barrier = true) AS
SELECT id, user_id, label, level, category, sort_order
FROM public.profile_skills
WHERE public.profile_is_public(user_id);

-- profile_experiences_public
DROP VIEW IF EXISTS public.profile_experiences_public;
CREATE VIEW public.profile_experiences_public
  WITH (security_invoker = off, security_barrier = true) AS
SELECT id, user_id, role_title, company, location, start_date, end_date,
       is_current, description, logo_url, sort_order
FROM public.profile_experiences
WHERE public.profile_is_public(user_id);

-- profile_education_public
DROP VIEW IF EXISTS public.profile_education_public;
CREATE VIEW public.profile_education_public
  WITH (security_invoker = off, security_barrier = true) AS
SELECT id, user_id, school, degree, field, start_date, end_date,
       description, logo_url, sort_order
FROM public.profile_education
WHERE public.profile_is_public(user_id);

-- profile_hobbies_public
DROP VIEW IF EXISTS public.profile_hobbies_public;
CREATE VIEW public.profile_hobbies_public
  WITH (security_invoker = off, security_barrier = true) AS
SELECT id, user_id, label, icon, sort_order
FROM public.profile_hobbies
WHERE public.profile_is_public(user_id);

-- profile_awards_public
DROP VIEW IF EXISTS public.profile_awards_public;
CREATE VIEW public.profile_awards_public
  WITH (security_invoker = off, security_barrier = true) AS
SELECT id, user_id, title, issuer, awarded_at, description, icon, url, kind, sort_order
FROM public.profile_awards
WHERE public.profile_is_public(user_id);

GRANT SELECT ON public.profile_skills_public       TO anon, authenticated;
GRANT SELECT ON public.profile_experiences_public  TO anon, authenticated;
GRANT SELECT ON public.profile_education_public    TO anon, authenticated;
GRANT SELECT ON public.profile_hobbies_public      TO anon, authenticated;
GRANT SELECT ON public.profile_awards_public       TO anon, authenticated;

-- 3) Remove direct base-table public read policies. Owner-manage policies stay.
DROP POLICY IF EXISTS "public read skills"              ON public.profile_skills;
DROP POLICY IF EXISTS "public read for public profiles" ON public.profile_experiences;
DROP POLICY IF EXISTS "public read education"           ON public.profile_education;
DROP POLICY IF EXISTS "public read hobbies"             ON public.profile_hobbies;
DROP POLICY IF EXISTS "public read awards"              ON public.profile_awards;
