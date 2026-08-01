-- ============================================================================
-- FIX (P0): przywrócenie minimalnych kolumnowych grantów SELECT na
-- public.profiles oraz wykonywalności polityki anon "Profiles anon public
-- authors".
--
-- ROOT CAUSE: `REVOKE SELECT ON public.profiles FROM authenticated`
-- (20260723184018, ponowiony w 20260724090100) skasował - zgodnie z
-- udokumentowaną semantyką PostgreSQL - również WSZYSTKIE kolumnowe granty
-- SELECT roli authenticated ("When revoking privileges on a table, the
-- corresponding column privileges (if any) are automatically revoked on each
-- column of the table, as well."). Komentarze w 20260708170000 i
-- 20260724090100 zakładały odwrotnie, więc re-grant kolumn dostał wtedy tylko
-- anon. Jedyna kolumna, jaka pozostała authenticated, to
-- expert_requests_enabled (nadana PO wipie w 20260724115134/130000).
-- Skutek: bylines, listy autorów, odczyt własnego wiersza (WHERE id = ...)
-- i testy pii/role_management/expert_request_visibility padają na 42501.
--
-- Drugi defekt: 20260723184018/20260724090100 przywróciły w polityce anon
-- gołe EXISTS na public.user_roles zamiast SECURITY-DEFINER
-- public.user_is_editorial() (wzorzec z 20260713070949/20260713200000).
-- Podzapytanie w USING wykonuje się z uprawnieniami anon, a anon nigdy nie
-- miał (i nie ma dostać) SELECT na user_roles - każdy anon-odczyt profiles
-- kończył się "permission denied for table user_roles".
--
-- Kontrakt (egzekwowany przez pii_column_grants_test i profiles_pii_grant_test):
--   * NEGATYWNY (nietknięty): email, prefs, contact_email, phone, gender,
--     location, verified_by, discovery_search, current_company_id pozostają
--     BEZ grantu role-wide; własny wiersz przez get_own_profile(), admin
--     przez admin_list_users()/admin_get_user().
--   * POZYTYWNY: publiczne kolumny profilu wracają dla anon+authenticated
--     (lista identyczna z re-grantem anon w 20260724090100); authenticated
--     dodatkowo expert_requests_enabled (kontrakt 20260724130000) oraz
--     discoverable/profile_view_mode (własne ustawienia czytane klientem;
--     wiersze i tak gatuje RLS).
--
-- NOTATKA NA PRZYSZŁOŚĆ: każdy `REVOKE SELECT ON public.profiles FROM <rola>`
-- MUSI być w tej samej migracji odtworzony pełnym kolumnowym GRANT-em -
-- REVOKE tabelaryczny zeruje także ACL kolumnowe.
-- ============================================================================

-- ── (1) profiles: publiczny, niewrażliwy zestaw kolumn (lista identyczna z
--        re-grantem anon w 20260724090100) - dla OBU ról klienckich ──────────
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
) ON public.profiles TO anon, authenticated;

-- ── (2) profiles: kolumny funkcjonalne tylko dla zalogowanych ───────────────
-- expert_requests_enabled: kontrakt 20260724115134/130000 (idempotentne
-- potwierdzenie). discoverable / profile_view_mode: czytane klientem na
-- własnym wierszu; dla anon pozostają odebrane.
GRANT SELECT (expert_requests_enabled, discoverable, profile_view_mode)
  ON public.profiles TO authenticated;

-- ── (3) user_roles: potwierdzenie kontraktu odczytu dla authenticated ───────
-- Grant tabelaryczny istnieje od 20260531180217 i nigdy nie został odebrany
-- (20260703090100 odebrał tylko INSERT/UPDATE/DELETE) - to idempotentny
-- bezpiecznik dla useAuth.loadContext (odczyt własnych ról). Wiersze gatują
-- istniejące polityki: "Users view own roles" (own-rows, 20260720052334)
-- oraz "Admins view tenant roles" (20260703090100). Zapisy wyłącznie przez
-- change_user_role(). anon celowo BEZ grantu.
GRANT SELECT ON public.user_roles TO authenticated;

-- ── (4) polityka anon wraca na SECURITY-DEFINER user_is_editorial() ─────────
-- Pin definicji i grantów EXECUTE (identyczne z 20260713200000; CREATE OR
-- REPLACE jest idempotentne). Definer omija RLS/ACL user_roles wewnątrz
-- funkcji, więc anon nie potrzebuje żadnych przywilejów na user_roles.
CREATE OR REPLACE FUNCTION public.user_is_editorial(p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
     WHERE ur.user_id = p_user
       AND ur.role IN ('admin'::app_role, 'editor'::app_role,
                       'author'::app_role, 'super_admin'::app_role)
  );
$$;

REVOKE ALL ON FUNCTION public.user_is_editorial(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_is_editorial(uuid) TO anon, authenticated, service_role;

-- Semantyka identyczna z 20260724090100 (tenant publiczny + slug + rola
-- redakcyjna); zmienia się wyłącznie mechanizm sprawdzenia roli.
DROP POLICY IF EXISTS "Profiles anon public authors" ON public.profiles;
CREATE POLICY "Profiles anon public authors" ON public.profiles
  FOR SELECT TO anon
  USING (
    tenant_id = public.public_tenant_id()
    AND slug IS NOT NULL
    AND public.user_is_editorial(id)
  );
