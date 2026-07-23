-- ============================================================================
-- FIX (P1 bezpieczenstwo): regresja ekspozycji PII w public.profiles.
--
-- Regresja: migracja 20260721202956 przywrocila TABLE-LEVEL
--   `GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated`.
-- Grant tabelaryczny spelnia sprawdzenie przywileju dla KAZDEJ kolumny, wiec
-- cicho uniewaznia model kolumnowy (20260703090100 + 20260720120000), ktory
-- swiadomie wstrzymuje email/prefs oraz contact_email/phone/gender/location.
-- W polaczeniu z polityka wierszowa "Profiles authenticated read"
-- (id = auth.uid() OR (tenant_id = current_tenant_id() AND is_staff())) KAZDY
-- czlonek staffu - w tym nisko-zaufany `author` - mogl czytac PII wszystkich
-- profili w tenancie. Commit "Fixed security issues" (20260723151902) domknal
-- tylko strone `anon`. Ta migracja domyka strone `authenticated` (identycznie
-- jak sprawdzony fix 20260708170000) i przywraca dzialajacy, bezpieczny odczyt
-- publiczny dla `anon` (patrz nizej).
--
-- Kontrakt (egzekwowany przez supabase/tests/profiles_pii_grant_test.sql):
--   * authenticated: BRAK email/prefs/contact_email/phone/gender/location,
--     ale zachowany display_name/first_name (bylines, edycja wlasnego profilu).
--   * anon: widzi TYLKO profile redakcyjne (author/editor/admin) swojego tenanta,
--     wylacznie kolumny publiczne.
-- ============================================================================

-- ── (1) authenticated: zdejmij TABLE-LEVEL SELECT; granty KOLUMNOWE zostaja ──
-- REVOKE table-level nie usuwa grantow kolumnowych (sa sledzone osobno), wiec
-- authenticated dalej czyta kolumny publiczne, ale nie PII. INSERT/UPDATE
-- (zapisy wlasnego wiersza pod RLS) zostawiamy nietkniete.
REVOKE SELECT ON public.profiles FROM authenticated;

-- ── (2) anon: przywroc spojny, testowalny stan odczytu publicznego ──────────
-- 20260720085723 zrobilo `REVOKE ALL PRIVILEGES ... FROM anon`, a 20260723151902
-- zdjelo table-level SELECT - anon nie ma dzis ZADNEGO przywileju na profiles,
-- wiec bezposredni odczyt bazy (jak w tescie) konczy sie "permission denied".
-- Nadajemy kolumnowy SELECT na bezpieczny podzbior (bez PII) i przywracamy
-- polityke redakcyjna zamiast zbyt szerokiej polityki "tenant-only" z 20260723151902
-- (ktora ujawnialaby zwyklych czytelnikow).
REVOKE SELECT ON public.profiles FROM anon;
GRANT SELECT (
  id,
  tenant_id,
  slug,
  display_name,
  first_name,
  last_name,
  avatar_url,
  cover_url,
  bio,
  bio_pl,
  bio_en,
  job_title,
  current_company,
  specialization,
  twitter_url,
  linkedin_url,
  facebook_url,
  instagram_url,
  spotify_url,
  website_url,
  verified_at,
  created_at,
  updated_at
) ON public.profiles TO anon;

DROP POLICY IF EXISTS "Profiles anon read tenant via view" ON public.profiles;
DROP POLICY IF EXISTS "Profiles anon no direct read" ON public.profiles;
DROP POLICY IF EXISTS "Profiles anon public authors" ON public.profiles;
CREATE POLICY "Profiles anon public authors" ON public.profiles
  FOR SELECT TO anon
  USING (
    tenant_id = public_tenant_id()
    AND slug IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = profiles.id
        AND ur.role IN ('admin', 'editor', 'author', 'super_admin')
    )
  );

-- ── (3) profiles_public: przywroc zaufana projekcje (security_invoker = off) ─
-- Widok wystawia wylacznie kolumny publiczne i filtruje po public_tenant_id(),
-- wiec jako projekcja definera jest bezpieczny i czytelny dla anon bez grantow
-- na tabeli bazowej. 20260723151902 przelaczyl go na security_invoker=on, co
-- rozbilo odczyt (anon nie ma przywilejow bazowych). Wracamy do stanu z
-- 20260723123230.
ALTER VIEW public.profiles_public SET (security_invoker = off);
GRANT SELECT ON public.profiles_public TO anon, authenticated;
