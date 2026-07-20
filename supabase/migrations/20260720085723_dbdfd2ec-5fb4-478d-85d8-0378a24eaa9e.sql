-- Clean up the previous column-grant attempt and block direct anon table access
REVOKE ALL PRIVILEGES ON public.profiles FROM anon;

-- Public-safe profiles view: only intentionally public columns, tenant-scoped
CREATE OR REPLACE VIEW public.profiles_public
WITH (security_invoker = off) AS
SELECT
  id,
  tenant_id,
  slug,
  display_name,
  first_name,
  last_name,
  avatar_url,
  cover_url,
  bio_pl,
  bio_en,
  job_title,
  twitter_url,
  linkedin_url,
  facebook_url,
  instagram_url,
  spotify_url,
  website_url,
  current_company,
  specialization,
  verified_at,
  updated_at
FROM public.profiles
WHERE tenant_id = public_tenant_id();

GRANT SELECT ON public.profiles_public TO anon, authenticated;

-- Anon must use the public view; direct SELECT on the sensitive base table is denied
DROP POLICY IF EXISTS "Profiles anon public authors" ON public.profiles;
CREATE POLICY "Profiles anon no direct read"
  ON public.profiles
  FOR SELECT
  TO anon
  USING (false);