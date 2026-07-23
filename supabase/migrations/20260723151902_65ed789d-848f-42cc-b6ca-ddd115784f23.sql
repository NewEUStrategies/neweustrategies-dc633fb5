
-- 1) content_access: stop exposing password_hash (and other columns) to anon.
--    Public reads must go through content_access_public view (already used by app).
DROP POLICY IF EXISTS "content_access public read" ON public.content_access;
REVOKE SELECT ON public.content_access FROM anon;

-- Ensure the safe view is readable by anon.
GRANT SELECT ON public.content_access_public TO anon, authenticated;

-- 2) profiles_public: flip view to security_invoker=on and add a scoped anon
--    SELECT policy on profiles, while revoking direct table SELECT from anon so
--    that anon can only reach the safe subset via the view.
ALTER VIEW public.profiles_public SET (security_invoker = on);

REVOKE SELECT ON public.profiles FROM anon;
GRANT SELECT ON public.profiles_public TO anon, authenticated;

DROP POLICY IF EXISTS "Profiles anon no direct read" ON public.profiles;
DROP POLICY IF EXISTS "Profiles anon read tenant via view" ON public.profiles;
CREATE POLICY "Profiles anon read tenant via view"
  ON public.profiles
  FOR SELECT
  TO anon
  USING (tenant_id = public_tenant_id());

-- 3) Fix mutable search_path on our function.
ALTER FUNCTION public.pricing_catalog_v5_benefits() SET search_path = public;
