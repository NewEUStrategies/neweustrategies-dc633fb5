-- Grant anon SELECT on public-safe columns of profiles so SSR (server-side render
-- with anon key) can read expert profiles listed via `/author/$slug`.
-- The existing RLS policy "Profiles anon public authors" already restricts
-- visibility to authors with slug/public tenant. Without a base GRANT PostgREST
-- rejects the request with 42501 "permission denied for table profiles",
-- which currently blows up the /author/$slug loader and returns a 500.
GRANT SELECT (
  id,
  tenant_id,
  slug,
  display_name,
  avatar_url,
  cover_url,
  bio_pl,
  bio_en,
  twitter_url,
  linkedin_url,
  website_url,
  verified_at,
  updated_at
) ON public.profiles TO anon;