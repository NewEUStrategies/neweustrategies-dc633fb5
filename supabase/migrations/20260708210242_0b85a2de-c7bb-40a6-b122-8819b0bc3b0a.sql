-- Re-grant the column-level SELECT that 20260703090100 established.
-- REVOKE SELECT ON public.profiles in 20260708170000 removed both the
-- table-level AND all column-level SELECT grants, breaking every signed-in
-- code path that reads tenant_id (useAuth), display_name, avatars, etc.
--
-- Deliberately EXCLUDES `email` and `prefs` so the PII fix from
-- 20260708170000 remains in effect. Own-row access to those private columns
-- still flows through SECURITY DEFINER get_own_profile(); admin e-mail
-- listing still flows through admin_list_users().
GRANT SELECT (
  id,
  display_name,
  avatar_url,
  cover_url,
  tenant_id,
  slug,
  bio,
  bio_pl,
  bio_en,
  contact_email,
  first_name,
  last_name,
  gender,
  phone,
  job_title,
  current_company,
  specialization,
  location,
  twitter_url,
  linkedin_url,
  website_url,
  facebook_url,
  instagram_url,
  spotify_url,
  created_at,
  updated_at
) ON public.profiles TO authenticated;