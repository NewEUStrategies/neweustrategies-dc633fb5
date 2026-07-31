
-- Restrict anon SELECT to non-sensitive columns only on profiles & author_profiles

-- 1) profiles: revoke full-column SELECT then grant only safe public columns to anon
REVOKE SELECT ON public.profiles FROM anon;
GRANT SELECT (
  id, tenant_id, slug, display_name, first_name, last_name,
  avatar_url, cover_url, bio, bio_pl, bio_en,
  job_title, current_company, specialization,
  linkedin_url, twitter_url, facebook_url, instagram_url, spotify_url, website_url,
  verified_at, created_at, updated_at, discoverable, profile_view_mode
) ON public.profiles TO anon;

-- 2) author_profiles: revoke full-column SELECT then grant only safe public columns to anon
REVOKE SELECT ON public.author_profiles FROM anon;
GRANT SELECT (
  id, user_id, tenant_id, is_public,
  bio_pl, bio_en, full_bio_pl, full_bio_en,
  avatar_url, company, job_title, org_functions,
  brand_accent, brand_accent_dark,
  layout_preset, layout_template_id, layout_overrides, layout_section_order,
  linkedin_url, x_url, facebook_url, instagram_url, spotify_url, website_url,
  custom_socials, media_contact_name,
  created_at, updated_at, counterpart_user_id, counterpart_lang
) ON public.author_profiles TO anon;
