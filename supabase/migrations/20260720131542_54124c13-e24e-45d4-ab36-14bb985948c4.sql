-- Fix 1: author_profiles - explicit column-level revoke of sensitive PII from public roles.
-- Base table already has no table-wide SELECT for anon/authenticated; make the deny
-- explicit at the column level so future GRANTs cannot accidentally leak contact/phone.
REVOKE SELECT (phone, contact_email, media_contact_email, media_contact_phone)
  ON public.author_profiles FROM anon, authenticated;

-- Public, safe projection for anonymous and authenticated readers (excludes PII).
CREATE OR REPLACE VIEW public.author_profiles_public
WITH (security_invoker = on) AS
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

GRANT SELECT ON public.author_profiles_public TO anon, authenticated;

-- Fix 2: content_access - password_hash must never be readable from the client.
-- Password verification happens exclusively in server functions via service_role.
REVOKE SELECT (password_hash) ON public.content_access FROM anon, authenticated;
GRANT  SELECT (password_hash) ON public.content_access TO service_role;

-- Fix 3: profile_recommendations - only the recipient (or an admin/super_admin) can
-- transition status to 'published'. Enforced by a trigger so it applies regardless of
-- whether writes originate from RLS-scoped clients or admin server functions.
CREATE OR REPLACE FUNCTION public.enforce_prof_rec_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  is_admin boolean;
BEGIN
  -- Trusted server-side code (service_role, direct SQL) has no auth.uid();
  -- allow those paths - they already bypass RLS by design.
  IF actor IS NULL THEN
    RETURN NEW;
  END IF;

  is_admin := has_role(actor, 'admin'::app_role)
           OR has_role(actor, 'super_admin'::app_role);

  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'published' AND NOT (actor = NEW.recipient_id OR is_admin) THEN
      RAISE EXCEPTION 'Only the recipient or an admin can publish a recommendation';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'published'
       AND OLD.status IS DISTINCT FROM 'published'
       AND NOT (actor = OLD.recipient_id OR is_admin) THEN
      RAISE EXCEPTION 'Only the recipient or an admin can publish a recommendation';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prof_rec_enforce_status ON public.profile_recommendations;
CREATE TRIGGER trg_prof_rec_enforce_status
BEFORE INSERT OR UPDATE ON public.profile_recommendations
FOR EACH ROW EXECUTE FUNCTION public.enforce_prof_rec_status();