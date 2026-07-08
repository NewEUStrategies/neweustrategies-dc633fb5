-- ============================================================================
-- Security: close two profiles PII regressions.
--
-- (1) authenticated - table-level SELECT re-exposed email/prefs to all staff.
--     20260704190601 added `GRANT SELECT, INSERT, UPDATE ON public.profiles TO
--     authenticated` next to a legitimate column-level grant. A TABLE-LEVEL
--     SELECT satisfies the privilege check for EVERY column, silently undoing
--     the column-level model that deliberately withholds `email` and `prefs`
--     (20260703090100). Because the row policy "Profiles authenticated read"
--     lets any is_staff() member (admin / editor / AUTHOR) read every profile
--     row in their tenant, this let a low-trust author read the e-mail address
--     and private prefs/consent of every registered user. This is the exact
--     regression 20260703090100 fixed and warned against ("never GRANT SELECT
--     ON public.profiles table-wide again").
--
--     Fix: revoke ONLY the table-level SELECT. Column-level SELECT grants
--     (20260703090100 + the six re-granted by 20260704190601) are stored
--     separately and remain intact, so authenticated keeps reading the
--     public-safe columns (author bylines, own-profile editing) but no longer
--     `email` / `prefs`. Own-row access to the private columns already flows
--     through the SECURITY DEFINER get_own_profile(); admin e-mail access
--     through admin_list_users(). INSERT/UPDATE grants are left untouched
--     (own-row writes stay governed by RLS + column privileges).
--
-- (2) anon - the whole reader base was enumerable, not just authors.
--     "Profiles anon public authors" gates on `slug IS NOT NULL`, but
--     handle_new_user assigns a unique slug to EVERY account, so the gate is
--     effectively always true: any anonymous visitor could read the name /
--     employer / bio / socials of every registered reader. 20260708130000 fixed
--     this for the satellite profile tables (profile_is_public) but left the
--     core profiles anon policy untouched. Require an editorial role too - the
--     only public profile surface is the author page (/author/$slug).
-- ============================================================================

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
