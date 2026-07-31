-- ===== PR #45: PII grant hardening =====
REVOKE SELECT (contact_email, phone, gender, location)
  ON public.profiles FROM anon, authenticated;

REVOKE SELECT ON public.author_profiles FROM authenticated;
GRANT SELECT (
  id, user_id, tenant_id, avatar_url, job_title, company,
  bio_pl, bio_en, contact_email, website_url,
  x_url, linkedin_url, facebook_url, instagram_url, spotify_url,
  custom_socials, is_public, created_at, updated_at,
  full_bio_pl, full_bio_en, org_functions,
  media_contact_name, media_contact_email, media_contact_phone,
  layout_template_id, layout_overrides,
  counterpart_user_id, counterpart_lang,
  layout_preset, layout_section_order, brand_accent, brand_accent_dark
) ON public.author_profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.profile_is_public(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = _user_id
      AND slug IS NOT NULL
      AND discoverable = true
      AND tenant_id = public.public_tenant_id()
  )
$function$;

REVOKE SELECT ON public.profile_cv_files FROM anon;

-- ===== PR #45: client_errors tenant scoping =====
ALTER TABLE public.client_errors
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;

UPDATE public.client_errors
   SET tenant_id = public.public_tenant_id()
 WHERE tenant_id IS NULL;

ALTER TABLE public.client_errors ALTER COLUMN tenant_id SET DEFAULT public.public_tenant_id();
ALTER TABLE public.client_errors ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS client_errors_tenant_created_idx
  ON public.client_errors (tenant_id, created_at DESC);