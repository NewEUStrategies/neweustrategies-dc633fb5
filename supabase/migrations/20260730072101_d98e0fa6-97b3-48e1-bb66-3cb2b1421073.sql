-- 1) Publiczny widok: maskowanie contact_email dla anonimowych.
CREATE OR REPLACE VIEW public.author_profiles_public
WITH (security_invoker = off, security_barrier = true) AS
  SELECT
    id, user_id, tenant_id, is_public,
    job_title, company, avatar_url,
    bio_pl, bio_en, full_bio_pl, full_bio_en,
    linkedin_url, x_url, facebook_url, instagram_url, spotify_url, website_url,
    custom_socials, brand_accent, brand_accent_dark,
    layout_template_id, layout_preset, layout_section_order, layout_overrides,
    org_functions, counterpart_lang, counterpart_user_id,
    media_contact_name,
    CASE WHEN auth.uid() IS NOT NULL THEN contact_email ELSE NULL END AS contact_email,
    created_at, updated_at
  FROM public.author_profiles ap
  WHERE is_public = true
    AND tenant_id = public_tenant_id();

GRANT SELECT ON public.author_profiles_public TO anon, authenticated;
GRANT ALL ON public.author_profiles_public TO service_role;

-- 2) Twarde domknięcie PII na tabeli bazowej (idempotentne).
REVOKE SELECT (phone, contact_email, media_contact_email, media_contact_phone)
  ON public.author_profiles FROM anon, authenticated;

-- 3) Nowe profile domyślnie prywatne (świadomy opt-in na publikację).
ALTER TABLE public.author_profiles ALTER COLUMN is_public SET DEFAULT false;