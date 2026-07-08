-- Re-apply PR #49 migration 20260708170000_profiles_pii_grant_fix.sql
-- (files were merged but this migration was not executed against the DB).

-- (1) Drop the table-wide SELECT; keep the column-level grants.
REVOKE SELECT ON public.profiles FROM authenticated;

-- (2) Restrict anon profile reads to editorial (author/editor/admin) accounts.
DROP POLICY IF EXISTS "Profiles anon public authors" ON public.profiles;
CREATE POLICY "Profiles anon public authors" ON public.profiles
  FOR SELECT TO anon
  USING (
    slug IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = profiles.id
        AND ur.role IN ('admin', 'editor', 'author', 'super_admin')
    )
  );