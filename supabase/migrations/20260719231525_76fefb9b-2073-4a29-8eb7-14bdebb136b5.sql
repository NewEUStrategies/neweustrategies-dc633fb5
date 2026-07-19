
DROP POLICY IF EXISTS "media tenant upload storage" ON storage.objects;

REVOKE SELECT ON public.profiles FROM anon;
GRANT SELECT (id, tenant_id, slug, first_name, last_name, display_name, bio, bio_pl, bio_en, avatar_url, cover_url, job_title, current_company, location, specialization, twitter_url, linkedin_url, website_url, facebook_url, instagram_url, spotify_url, discoverable, verified_at, created_at, updated_at)
ON public.profiles TO anon;
