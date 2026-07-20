-- ============================================================================
-- Security hardening: close cross-user / cross-tenant PII read vectors.
--
-- Three independent regressions, all variants of the same class (a table-level
-- GRANT or an under-scoped predicate quietly re-widening PII exposure):
--
--   K1  public.profiles - a bulk column re-GRANT (20260708210242) undid the
--       deliberate REVOKE from 20260704142952. Because the row policy
--       "Profiles authenticated read" lets ANY is_staff() member (which
--       includes the low-trust `author` role) read every profile row in the
--       tenant, this let a low-trust author read the contact_email / phone /
--       gender / location of EVERY registered member (incl. plain readers).
--       Own-row access to these columns stays available via get_own_profile()
--       (SECURITY DEFINER, hard-scoped to auth.uid()); admin user management
--       via admin_list_users(). `email` / `prefs` were already withheld.
--
--   K2  public.author_profiles - the create migration (20260709143613) granted
--       a TABLE-level SELECT to `authenticated`. A table grant satisfies the
--       privilege check for ALL columns, so every later column-level REVOKE
--       (20260718084630) was a no-op for `authenticated` - the exact footgun
--       the profiles migrations warned about. `anon` was already fixed the
--       right way (20260715095639: table REVOKE + explicit column GRANT).
--       Convert `authenticated` to the same explicit column-grant model so a
--       future PII column added to author_profiles is NOT auto-exposed. The
--       public author-page columns (incl. the opt-in press contacts
--       media_contact_*) are preserved; the personal `phone` column is dropped
--       from the grant - it is never rendered in any public view (only carried
--       and discarded), so hiding it is a pure privacy win. Owners still read
--       their own phone via get_own_author_profile(); admins via the admin
--       policy.
--
--   K3  public.profile_is_public() - predicate was `slug IS NOT NULL AND
--       discoverable = true` with NO tenant scope, and it gates the SELECT
--       policies of the profile satellite tables (career / education / skills /
--       awards / hobbies / CV). Missing tenant scope = cross-tenant read of
--       those satellites. Add the tenant scope. Additionally, uploaded CV
--       documents (profile_cv_files) are not public data - revoke the anon
--       table grant (the bytes already live in the private `cv` bucket; this
--       closes anon read of the metadata rows too).
--
-- All statements are idempotent (REVOKE of an absent grant is a no-op; GRANT is
-- additive; CREATE OR REPLACE FUNCTION rewrites in place).
-- ============================================================================

-- ---------- K1: profiles - drop personal PII from the role-wide column grant --
-- Applied to BOTH roles: harmless where already absent, and it guarantees the
-- end state regardless of which of the historical grants is live.
REVOKE SELECT (contact_email, phone, gender, location)
  ON public.profiles FROM anon, authenticated;

-- ---------- K2: author_profiles - table grant -> explicit column grant -------
REVOKE SELECT ON public.author_profiles FROM authenticated;
GRANT SELECT (
  id,
  user_id,
  tenant_id,
  avatar_url,
  job_title,
  company,
  bio_pl,
  bio_en,
  contact_email,
  website_url,
  x_url,
  linkedin_url,
  facebook_url,
  instagram_url,
  spotify_url,
  custom_socials,
  is_public,
  created_at,
  updated_at,
  full_bio_pl,
  full_bio_en,
  org_functions,
  media_contact_name,
  media_contact_email,
  media_contact_phone,
  layout_template_id,
  layout_overrides,
  counterpart_user_id,
  counterpart_lang,
  layout_preset,
  layout_section_order,
  brand_accent,
  brand_accent_dark
) ON public.author_profiles TO authenticated;
-- INSERT/UPDATE/DELETE stay as granted by 20260709143613 (owner/admin RLS
-- policies gate the rows); only the SELECT surface is tightened here.

-- ---------- K3a: tenant-scope the public-profile predicate -------------------
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
      -- Pin to the host tenant, mirroring the core anon profiles policy
      -- ("Profiles anon public authors" USING ... tenant_id =
      -- public.public_tenant_id()). Prevents a satellite row (career,
      -- education, CV metadata) from one tenant being read on another tenant's
      -- site (cross-tenant leak).
      AND tenant_id = public.public_tenant_id()
  )
$function$;

-- ---------- K3b: uploaded CV documents are not anon-readable -----------------
REVOKE SELECT ON public.profile_cv_files FROM anon;
