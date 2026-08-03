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
  'Wlasciciel czyta swoj wiersz WYLACZNIE w tenancie domowym (current_tenant_id()). Predykat musi pozostac symetryczny z politykami INSERT/UPDATE/DELETE.';

-- ---------- 2) DELETE wlasciciela --------------------------------------------
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
  'Kasowanie wlasnego wiersza tylko w tenancie domowym.';

-- ---------- 3) INSERT/UPDATE: ta sama semantyka, forma InitPlan --------------
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

-- ---------- 4) RPC wlasciciela -----------------------------------------------
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
  'Pelny wiersz author_profiles wlasciciela - wylacznie w tenancie domowym wolajacego.';

-- ---------- 5) Indeksy: usuniecie duplikatu na user_id -----------------------
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