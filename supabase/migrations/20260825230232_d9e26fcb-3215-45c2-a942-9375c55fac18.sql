-- Bramka CI: czy migracje z gałęzi faktycznie wykonały się na bazie.
-- Funkcja NIE wylicza zawartości rejestru - przyjmuje listę wersji znanych
-- wołającemu i zwraca wyłącznie te, których w rejestrze brak, więc nie da się
-- przez nią enumerować historii wdrożeń.
CREATE OR REPLACE FUNCTION public.missing_migration_versions(_versions text[])
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, supabase_migrations
AS $$
  SELECT COALESCE(
    array_agg(v ORDER BY v) FILTER (
      WHERE NOT EXISTS (
        SELECT 1
        FROM supabase_migrations.schema_migrations m
        WHERE m.version = v
      )
    ),
    ARRAY[]::text[]
  )
  FROM unnest(COALESCE(_versions, ARRAY[]::text[])) AS v;
$$;

REVOKE ALL ON FUNCTION public.missing_migration_versions(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.missing_migration_versions(text[]) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.missing_migration_versions(text[]) IS
  'CI post-deploy gate: zwraca podzbiór podanych wersji migracji, których nie ma w supabase_migrations.schema_migrations.';
