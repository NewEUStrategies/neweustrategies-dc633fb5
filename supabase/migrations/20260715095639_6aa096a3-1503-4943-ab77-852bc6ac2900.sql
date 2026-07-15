
-- 1) Require explicit discoverable opt-in for the "public via slug" helper
CREATE OR REPLACE FUNCTION public.profile_is_public(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = _user_id
      AND slug IS NOT NULL
      AND discoverable = true
  )
$function$;

-- 2) author_profiles: revoke anon SELECT on sensitive contact columns.
--    Authenticated users retain access via existing policies; owners/admins
--    still see everything through the owner/admin policies.
REVOKE SELECT ON TABLE public.author_profiles FROM anon;

GRANT SELECT (
  id, user_id, tenant_id, avatar_url, job_title, company,
  bio_pl, bio_en, website_url, x_url, linkedin_url, facebook_url,
  instagram_url, spotify_url, custom_socials, is_public,
  created_at, updated_at, full_bio_pl, full_bio_en, org_functions,
  media_contact_name, layout_template_id, layout_overrides,
  counterpart_user_id, counterpart_lang, layout_preset,
  layout_section_order, brand_accent, brand_accent_dark
) ON public.author_profiles TO anon;
