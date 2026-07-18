
-- 1) content_access: hide password_hash / password hints from anon and authenticated.
--    Server-side password verification runs via SECURITY DEFINER functions / service role.
REVOKE SELECT (password_hash, password_hint_pl, password_hint_en)
  ON public.content_access FROM anon, authenticated;

-- 2) author_profiles: hide phone and media contact PII from public readers.
--    Owners fetch their own full profile through a dedicated function.
REVOKE SELECT (phone, media_contact_email, media_contact_phone)
  ON public.author_profiles FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_own_author_profile()
RETURNS SETOF public.author_profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.author_profiles
  WHERE user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_own_author_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_own_author_profile() TO authenticated;

-- 3) wp_import_jobs: restrict SELECT to staff (admin/editor) or the row's actor.
DROP POLICY IF EXISTS "wp_import_jobs tenant read" ON public.wp_import_jobs;

CREATE POLICY "wp_import_jobs staff read"
  ON public.wp_import_jobs
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'editor'::app_role)
      OR actor_id = auth.uid()
    )
  );
