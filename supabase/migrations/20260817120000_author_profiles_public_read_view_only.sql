-- ============================================================================
-- Bezpieczeństwo: publiczny odczyt author_profiles WYŁĄCZNIE przez widok
-- author_profiles_public - tabela bazowa bez polityk SELECT anon/authenticated.
--
-- Finding "author_profiles - public policies return the full row": polityki
-- "Public can view public author profiles" (anon) i "Authenticated can view
-- public author profiles" (authenticated) wpuszczały przy is_public = true
-- CAŁY wiersz tabeli bazowej. RLS w Postgresie nie zawęża kolumn, więc na
-- poziomie POLITYK wiersz niósł też phone, contact_email, media_contact_email
-- i media_contact_phone; jedyną zaporą przed odczytem tych kolumn przez
-- dowolnego gościa internetu był kolumnowy REVOKE (20260720131542, przypięty
-- w 20260730120000). Ta granica już dwa razy dryfowała: 20260720090804 oddał
-- anonowi contact_email, a 20260720120000 authenticated media_contact_email
-- i media_contact_phone - oba przecieki domknęła dopiero 20260730120000.
-- Klasa błędu (dryf grantów) pozostaje otwarta, dopóki tabela z kontaktowym
-- PII w ogóle ma publiczne polityki SELECT.
--
-- Stan po tej migracji - tabela bazowa przestaje być publicznym API:
--
--   * SELECT z tabeli mają wyłącznie: właściciel wiersza ("Owners can view
--     own author profile"), admin tenanta ("Admins can manage tenant author
--     profiles") i service_role. anon traci też WSZYSTKIE granty (zero
--     powierzchni - SELECT kończy się 42501, zanim RLS cokolwiek policzy);
--     authenticated zachowuje kolumnowe granty bezpiecznych kolumn, bo
--     potrzebują ich ścieżki właściciela/admina (WHERE po user_id przy
--     upsert/update w AuthorProfileEditor oraz odczyt wierszy tenanta -
--     w tym NIEpublicznych - w wewnętrznej bazie ekspertów).
--
--   * Publiczna projekcja bez zmian merytorycznych: widok
--     author_profiles_public (DEFINER + security_barrier, is_public = true,
--     tenant hosta, BEZ kolumn kontaktowych - 20260730120000) oraz
--     get_expert_hub(), które czyta ten widok. Frontend przełączony na widok
--     w trzech ostatnich miejscach czytających tabelę bazową:
--     expertsDirectoryQueryOptions (katalog /experts), fetchExpertHydration
--     (fallback hydratacji widgetów dla staffu bez roli admin)
--     i internalExpertBaseQueryOptions (scala odczyt tabeli bazowej -
--     wiersz własny / wiersze tenanta admina - z widokiem).
--
--   * Pełny wiersz (z kontaktami) jak dotąd: get_own_author_profile() dla
--     właściciela, admin_get_author_profile() dla admina tenanta,
--     service_role dla backendu. Publicznie zostaje media_contact_name -
--     nazwa biura prasowego, nie kanał kontaktu.
--
-- Czego NIE zmieniamy: polityk INSERT/UPDATE/DELETE (właściciel -
-- 20260803184416, admin - 20260709143613), definicji widoku, obu RPC ani
-- SECURITY DEFINER predykatów (profile_is_public, is_expert_user,
-- profile_has_public_presence) - one czytają tabelę jako definer i nie
-- zależą od grantów anon/authenticated.
--
-- Testy: supabase/tests/author_profiles_public_read_view_only_test.sql.
-- ============================================================================

-- ---------- 1) Tabela bazowa: koniec publicznych polityk SELECT --------------
DROP POLICY IF EXISTS "Public can view public author profiles" ON public.author_profiles;
DROP POLICY IF EXISTS "Authenticated can view public author profiles" ON public.author_profiles;

-- ---------- 2) anon: zero grantów na tabeli bazowej --------------------------
-- Bez polityki wierszowej kolumnowy grant i tak zwracałby pusty zbiór, ale
-- zerowa powierzchnia = zero dryfu: przyszły przypadkowy GRANT SELECT dla anon
-- niczego nie otworzy, dopóki ktoś świadomie nie doda TAKŻE polityki.
REVOKE ALL ON public.author_profiles FROM anon;

-- ---------- 3) Przypięcie granicy kolumn kontaktowych (idempotentne) ---------
-- Kontakty czyta wyłącznie właściciel/admin przez SECURITY DEFINER RPC
-- i service_role; dla ról klienckich kolumny pozostają odebrane.
REVOKE SELECT (phone, contact_email, media_contact_email, media_contact_phone)
  ON public.author_profiles FROM anon, authenticated;
