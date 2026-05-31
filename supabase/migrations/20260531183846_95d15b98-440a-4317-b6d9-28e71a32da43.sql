-- Fix warnings introduced by previous migration.

-- 1) Pin search_path on the new helper.
CREATE OR REPLACE FUNCTION public.storage_path_tenant(_name text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    THEN (split_part(_name, '/', 1))::uuid
    ELSE NULL
  END
$$;

-- 2) Tighten public read on media: only allow SELECT for objects that follow
--    the tenant-prefixed path scheme. This prevents listing arbitrary files
--    and rejects legacy/garbage paths.
DROP POLICY IF EXISTS "media public read" ON storage.objects;
CREATE POLICY "media public read"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (
  bucket_id = 'media'
  AND public.storage_path_tenant(name) IS NOT NULL
);

-- 3) Add an explicit deny-all policy on rate_limits so the linter sees a policy
--    while real access still happens only via service_role (which bypasses RLS).
CREATE POLICY "rate_limits no client access"
ON public.rate_limits FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);
