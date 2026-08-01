-- Jawne, trwałe odebranie kolumn PII dla roli anon na public.profiles.
-- Publiczna polityka "Profiles anon public authors" (redakcja + slug) nadal
-- działa, ale wyłącznie na kolumnach prezentacyjnych nadanych w
-- 20260801120000_restore_min_profile_grants.sql.

REVOKE ALL (email, contact_email, phone, location, gender, prefs,
            discovery_search, verified_by, current_company_id)
  ON public.profiles FROM anon;

-- Bezpiecznik: gdyby kiedykolwiek pojawił się grant tabelaryczny dla anon,
-- odbieramy go i przywracamy wyłącznie bezpieczny zestaw kolumn.
DO $$
BEGIN
  IF has_table_privilege('anon', 'public.profiles', 'SELECT') THEN
    REVOKE ALL ON public.profiles FROM anon;
    GRANT SELECT (
      id, tenant_id, slug, display_name, first_name, last_name,
      avatar_url, cover_url, bio, bio_pl, bio_en, job_title,
      current_company, specialization, twitter_url, linkedin_url,
      facebook_url, instagram_url, spotify_url, website_url,
      verified_at, created_at, updated_at
    ) ON public.profiles TO anon;
  END IF;
END
$$;

COMMENT ON COLUMN public.profiles.phone IS 'PII - brak SELECT dla anon; dostęp tylko właściciel/staff przez RLS.';
COMMENT ON COLUMN public.profiles.contact_email IS 'PII - brak SELECT dla anon; publiczny kontakt autorów idzie przez author_profiles_public.';
COMMENT ON COLUMN public.profiles.email IS 'PII - brak SELECT dla anon; dostęp tylko właściciel/staff przez RLS.';