-- ============================================================================
-- Bezpieczenstwo: polityki wlasciciela na public.author_profiles nie pilnowaly
-- tenanta przy ODCZYCIE i KASOWANIU.
--
-- Finding: polityka "Owners can view own author profile" sprawdzala wylacznie
-- `auth.uid() = user_id`, podczas gdy blizniacze polityki INSERT/UPDATE dostaly
-- `AND tenant_id = current_tenant_id()` (migracja 20260721105920). Ta sama
-- asymetria dotyczy "Owners can delete own author profile" - zostala przy golym
-- predykacie wlasnosci z migracji zalozycielskiej 20260709143613.
--
-- Dlaczego to ma znaczenie (a nie jest tylko kosmetyka):
--
--   B1  `current_tenant_id()` to tenant DOMOWY uzytkownika (`SELECT tenant_id
--       FROM profiles WHERE id = auth.uid()`), a `author_profiles.tenant_id` to
--       osobna kolumna, stemplowana przy INSERT-cie triggerem
--       author_profiles_set_tenant() albo jawnie przez klienta/service_role.
--       Te dwie wartosci MOGA sie rozjechac: przepiecie konta do innego obszaru
--       roboczego, zapis serwisowy z innym tenantem, migracja danych. Po dryfie
--       wiersz byl NIEZAPISYWALNY (UPDATE/INSERT pilnuja tenanta), ale nadal
--       w pelni CZYTELNY i KASOWALNY - czyli obszar roboczy firmy A wystawial
--       swoj wiersz sesji dzialajacej w kontekscie firmy B.
--
--   B2  Sciezka odczytu aplikacji NIE idzie przez tabele bazowa: kolumny
--       kontaktowe maja odebrany SELECT (20260720131542 / 20260730120000), wiec
--       edytor profilu czyta pelny wiersz przez SECURITY DEFINER
--       get_own_author_profile() (20260718084630), ktory RLS OMIJA i filtrowal
--       wylacznie po auth.uid(). Sama poprawka polityki byla by wiec martwa
--       litera - funkcja dostaje ten sam warunek tenanta, dokladnie jak jej
--       blizniaczka admin_get_author_profile() (20260730120000).
--
-- Stan koncowy: KAZDA sciezka wlasciciela (SELECT / INSERT / UPDATE / DELETE
-- + RPC) wiaze wiersz z tenantem domowym. Predykaty sa zapisane w formie
-- InitPlan - `(SELECT auth.uid())` / `(SELECT public.current_tenant_id())` -
-- ktora Postgres liczy RAZ na zapytanie zamiast raz na wiersz.
--
-- Bramka anty-regresyjna: scripts/check-sql-owner-tenant-scope.ts (klasa bledu)
-- + supabase/tests/author_profiles_owner_tenant_scope_test.sql (zachowanie).
-- Migracja jest w calosci idempotentna (DROP IF EXISTS + CREATE, OR REPLACE).
-- ============================================================================

-- ---------- 1) SELECT wlasciciela: dopiecie tenanta --------------------------
DROP POLICY IF EXISTS "Owners can view own author profile" ON public.author_profiles;
CREATE POLICY "Owners can view own author profile"
  ON public.author_profiles
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  );

COMMENT ON POLICY "Owners can view own author profile" ON public.author_profiles IS
  'Wlasciciel czyta swoj wiersz WYLACZNIE w tenancie domowym (current_tenant_id()). Predykat musi pozostac symetryczny z politykami INSERT/UPDATE/DELETE - asymetria oznacza wiersz zapisywalny w jednym obszarze roboczym, a czytelny w kazdym.';

-- ---------- 2) DELETE wlasciciela: ta sama asymetria -------------------------
DROP POLICY IF EXISTS "Owners can delete own author profile" ON public.author_profiles;
CREATE POLICY "Owners can delete own author profile"
  ON public.author_profiles
  FOR DELETE
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  );

COMMENT ON POLICY "Owners can delete own author profile" ON public.author_profiles IS
  'Kasowanie wlasnego wiersza tylko w tenancie domowym - inaczej sesja w obszarze roboczym B kasuje dane obszaru A.';

-- ---------- 3) INSERT/UPDATE: ta sama semantyka, forma InitPlan --------------
-- Bez zmiany znaczenia wzgledem 20260721105920: `current_tenant_id()` jest
-- STABLE SECURITY DEFINER, wiec w formie `(SELECT …)` planer liczy je raz na
-- zapytanie (InitPlan) zamiast raz na wiersz. Trzymamy wszystkie cztery
-- polityki wlasciciela w JEDNEJ, identycznej formie - rozjazd zapisu jest
-- dokladnie tym, jak powstal ten finding.
DROP POLICY IF EXISTS "Owners can insert own author profile" ON public.author_profiles;
CREATE POLICY "Owners can insert own author profile"
  ON public.author_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  );

DROP POLICY IF EXISTS "Owners can update own author profile" ON public.author_profiles;
CREATE POLICY "Owners can update own author profile"
  ON public.author_profiles
  FOR UPDATE
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  );

-- ---------- 4) RPC wlasciciela: rzeczywista sciezka odczytu ------------------
-- SECURITY DEFINER omija RLS, wiec warunek tenanta musi byc W CIELE - inaczej
-- punkty 1-3 sa martwa litera dla edytora profilu (src/components/profile/
-- AuthorProfileEditor.tsx wola ten RPC, bo kolumny kontaktowe maja odebrany
-- kolumnowy SELECT). Lustro admin_get_author_profile(): SETOF + sql, wiec
-- wolajacy spoza tenanta dostaje PUSTY ZBIOR (PostgREST -> null na
-- .maybeSingle()), a nie blad - brak sondowania kanalem bledu.
CREATE OR REPLACE FUNCTION public.get_own_author_profile()
RETURNS SETOF public.author_profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ap.*
  FROM public.author_profiles ap
  WHERE ap.user_id = auth.uid()
    AND ap.tenant_id = public.current_tenant_id();
$$;

REVOKE ALL ON FUNCTION public.get_own_author_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_own_author_profile() TO authenticated;

COMMENT ON FUNCTION public.get_own_author_profile() IS
  'Pelny wiersz author_profiles wlasciciela (omija kolumnowy REVOKE PII) - wylacznie w tenancie domowym wolajacego. Predykat musi byc identyczny z polityka "Owners can view own author profile"; rozjazd = wyciek miedzy obszarami roboczymi, bo RPC omija RLS.';

-- ---------- 5) Indeksy: usuniecie duplikatu na user_id -----------------------
-- `user_id` jest UNIQUE od migracji zalozycielskiej (constraint tworzy wlasny
-- indeks unikalny; korzysta z niego takze upsert `onConflict: user_id`), a obok
-- stoi zwykly author_profiles_user_idx na tej samej kolumnie. Duplikat nic nie
-- przyspiesza, a kosztuje przy kazdym zapisie i zasmieca planer. Kasujemy go
-- WYLACZNIE gdy indeks unikalny faktycznie istnieje.
DO $$
DECLARE
  v_user_attnum smallint;
  v_has_unique  boolean;
BEGIN
  SELECT attnum INTO v_user_attnum
    FROM pg_attribute
   WHERE attrelid = 'public.author_profiles'::regclass
     AND attname = 'user_id'
     AND NOT attisdropped;

  SELECT EXISTS (
    SELECT 1
      FROM pg_index i
     WHERE i.indrelid = 'public.author_profiles'::regclass
       AND i.indisunique
       AND i.indnatts = 1
       AND i.indkey[0] = v_user_attnum
  ) INTO v_has_unique;

  IF v_has_unique THEN
    DROP INDEX IF EXISTS public.author_profiles_user_idx;
  END IF;
END
$$;
