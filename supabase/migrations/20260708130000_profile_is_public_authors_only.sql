-- PII fix: stop anon from reading every user's profile suite (CV files,
-- personality-test results, education, work history, skills, awards, hobbies).
--
-- Root cause: the satellite profile tables are anon-readable when
-- public.profile_is_public(user_id) is true, but that helper only checked
-- `slug IS NOT NULL`. handle_new_user assigns a unique slug to EVERY account
-- (readers included) and a backfill gave every existing row one, so the gate
-- was effectively "always true" — any anonymous visitor could read a plain
-- reader's CV/personality data once that reader used the profile suite.
--
-- The only public profile surface is the author page (/author/$slug), i.e.
-- public profiles are editorial (author/editor/admin) profiles. Require an
-- editorial role in addition to a slug: authors keep their public profile,
-- readers' profile data becomes owner-only again (the "owner manages own …"
-- policies are unchanged, so users still see and edit their own data).
CREATE OR REPLACE FUNCTION public.profile_is_public(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = _user_id
      AND p.slug IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = p.id
          AND ur.role IN ('admin', 'editor', 'author', 'super_admin')
      )
  )
$$;
