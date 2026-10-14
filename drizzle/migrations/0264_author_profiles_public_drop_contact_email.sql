
DROP VIEW IF EXISTS public.author_profiles_public;

CREATE VIEW public.author_profiles_public
WITH (security_invoker = off, security_barrier = true) AS
SELECT
  ap.id,
  ap.user_id,
  ap.tenant_id,
  ap.is_public,
  ap.job_title,
  ap.company,
  ap.avatar_url,
  ap.bio_pl,
  ap.bio_en,
  ap.full_bio_pl,
  ap.full_bio_en,
  ap.linkedin_url,
  ap.x_url,
  ap.facebook_url,
  ap.instagram_url,
  ap.spotify_url,
  ap.website_url,
  ap.custom_socials,
  ap.brand_accent,
  ap.brand_accent_dark,
  ap.layout_template_id,
  ap.layout_preset,
  ap.layout_section_order,
  ap.layout_overrides,
  ap.org_functions,
  ap.counterpart_lang,
  ap.counterpart_user_id,
  ap.media_contact_name,
  ap.created_at,
  ap.updated_at
FROM public.author_profiles ap
WHERE ap.is_public = true
  AND ap.tenant_id = public_tenant_id();

REVOKE ALL ON public.author_profiles_public FROM anon, authenticated;
GRANT SELECT ON public.author_profiles_public TO anon, authenticated;

COMMENT ON VIEW public.author_profiles_public IS
  'Public author projection (is_public, host tenant). No contact channels: phone, contact_email, media_contact_email and media_contact_phone are readable only by the owner (get_own_author_profile), tenant admins (admin_get_author_profile) and service_role. Read-only for anon/authenticated.';
