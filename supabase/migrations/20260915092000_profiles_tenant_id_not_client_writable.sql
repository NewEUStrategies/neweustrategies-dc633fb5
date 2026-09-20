-- profiles.tenant_id niezapisywalne przez klienta (bliźniak pasa drizzle
-- `0024_profiles_tenant_id_not_client_writable`).
--
-- PO CO BLIŹNIAK. Poprawka pojechała dotąd wyłącznie pasem drizzle, więc baza
-- odtworzona z `supabase/migrations/` nadal trzyma politykę „Users update own
-- profile" z tautologicznym WITH CHECK i pełnym GRANT UPDATE na `profiles`.
-- Z `profiles.tenant_id` wywodzi się zakres najemcy w dziesiątkach tabel oraz
-- bramki rol - dziura żyje w każdym środowisku, którego ta migracja nie widzi.
--
-- POWTÓRNE WYKONANIE JEST BEZPIECZNE: blok DO wylicza listę kolumn z
-- `information_schema` przy KAŻDYM przebiegu (więc nie zamraża kształtu tabeli),
-- a REVOKE/GRANT i DROP POLICY IF EXISTS + CREATE POLICY są idempotentne.
--
-- DATOWNIK PÓŹNIEJSZY NIŻ CHWILA WYKONANIA NA PASIE DRIZZLE (2026-09-15 08:40)
-- z tego samego powodu, co przy 20260915091000: wersja starsza od
-- 20260915090000 zostałaby pominięta przez przyrostowy `db push`.
-- Przypisanie profilu do najemcy (public.profiles.tenant_id) NIE JEST zapisywalne
-- przez klienta.
--
-- PRZYCZYNA: polityka „Users update own profile" ma WITH CHECK
-- `tenant_id = current_tenant_id()`, a `current_tenant_id()` czyta
-- `profiles.tenant_id` DLA TEGO SAMEGO WIERSZA - warunek jest praktycznie
-- tautologiczny i sam z siebie nie broni przed podmianą najemcy w tym samym
-- UPDATE. Z `profiles.tenant_id` wywodzi się zakres najemcy w dziesiątkach tabel
-- oraz bramki rol (`has_role`, `is_staff`, `is_super_admin`).
--
-- MITYGACJA (trzy warstwy):
--   1. GRANT KOLUMNOWY - `authenticated`/`anon` nie mogą ADRESOWAĆ kolumny
--      `tenant_id` w UPDATE (obok kolumn zaufania: `verified_at`, `verified_by`,
--      `completeness_score` - patrz 20260905212431).
--   2. TRIGGER `profiles_pin_tenant_id_bu` - twarda odmowa 42501 (bez zmian).
--   3. POLITYKA RLS - WITH CHECK bez `current_tenant_id()`, żeby nie sugerować
--      ochrony, której ten warunek nie daje.
DO $$
DECLARE
  v_cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'profiles'
     AND column_name NOT IN ('tenant_id', 'verified_at', 'verified_by', 'completeness_score');

  EXECUTE 'REVOKE UPDATE ON public.profiles FROM authenticated';
  EXECUTE 'REVOKE UPDATE ON public.profiles FROM anon';
  EXECUTE format('GRANT UPDATE (%s) ON public.profiles TO authenticated', v_cols);
END $$;

GRANT ALL ON public.profiles TO service_role;

DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()) AND tenant_id IS NOT NULL);

COMMENT ON COLUMN public.profiles.tenant_id IS
  'Najemca wlasciciela profilu. NIEZMIENNY dla klienta: rola authenticated nie ma UPDATE na tej kolumnie (grant kolumnowy), a trigger profiles_pin_tenant_id_bu odmawia zmiany kodem 42501. Zmiana wylacznie przez service_role albo super_admin.';
