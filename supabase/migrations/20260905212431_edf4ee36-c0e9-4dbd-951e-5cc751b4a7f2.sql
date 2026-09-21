-- Kolumnowe uprawnienia zapisu na public.profiles: klient NIE MOZE nawet
-- adresowac kolumn zaufania (verified_at, verified_by, completeness_score).
-- Triggery profiles_guard_verification / profiles_completeness_refresh
-- zostaja - to jest DRUGA warstwa, na wypadek zmiany triggera.
DO $$
DECLARE
  v_cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'profiles'
     AND column_name NOT IN ('verified_at', 'verified_by', 'completeness_score');

  EXECUTE 'REVOKE UPDATE ON public.profiles FROM authenticated';
  EXECUTE 'REVOKE UPDATE ON public.profiles FROM anon';
  EXECUTE format('GRANT UPDATE (%s) ON public.profiles TO authenticated', v_cols);
END $$;

GRANT ALL ON public.profiles TO service_role;

COMMENT ON COLUMN public.profiles.completeness_score IS
  'Pochodna rankingowa liczona przez profiles_completeness_refresh(). Rola authenticated NIE ma UPDATE na tej kolumnie (grant kolumnowy).';
