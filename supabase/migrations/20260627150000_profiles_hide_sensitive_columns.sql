-- Hide profiles.email and profiles.prefs from the public Data API.
--
-- Why this is needed: a TABLE-level `GRANT SELECT ON public.profiles TO anon,
-- authenticated` (migration 20260531180217) was never revoked. In PostgreSQL a
-- table-level SELECT privilege satisfies the access check for ALL columns, so
-- the later column-level `REVOKE SELECT (email[, prefs]) ... FROM anon`
-- (20260625160054 / 20260626162717) were effectively no-ops: anon and any
-- authenticated user could still read those columns. The only correct way to
-- restrict columns is to drop the table-wide SELECT and re-grant SELECT on just
-- the non-sensitive columns.
--
-- Effect:
--  * anon + authenticated can read public profile fields (display name, avatar,
--    bio, slug, tenant) — needed for author bylines — but NOT email / prefs.
--  * RLS row policies are unchanged (they still gate WHICH rows are visible).
--  * service_role (admin / server functions) is untouched and keeps full access,
--    so admin user-management that reads email server-side still works.
--
-- The app's client/SSR code only ever selects id, display_name, avatar_url and
-- tenant_id from profiles, so this does not break any read path.

REVOKE SELECT ON public.profiles FROM anon, authenticated;

GRANT SELECT (
  id,
  display_name,
  avatar_url,
  tenant_id,
  slug,
  bio,
  bio_pl,
  bio_en,
  created_at,
  updated_at
) ON public.profiles TO anon, authenticated;
