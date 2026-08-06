-- 1) Fixed search_path for project-owned functions flagged by the linter.
ALTER FUNCTION public.b64url_decode(text) SET search_path = public;
ALTER FUNCTION public.b64url_encode(bytea) SET search_path = public;
ALTER FUNCTION public.normalize_public_host(text) SET search_path = public;

-- 2) Comments: block self-approval at the POLICY level (defense in depth on top
--    of the existing comments_guard_update trigger).
CREATE OR REPLACE FUNCTION public.comments_moderation_enabled(_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT (s.value ->> 'moderate_new_comments')::boolean
       FROM public.site_settings s
      WHERE s.key = 'discussion' AND s.tenant_id = _tenant_id),
    true
  );
$$;

REVOKE ALL ON FUNCTION public.comments_moderation_enabled(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.comments_moderation_enabled(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS comments_own_update ON public.comments;
CREATE POLICY comments_own_update ON public.comments
FOR UPDATE
TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND (
    public.has_role((SELECT auth.uid()), 'admin'::app_role)
    OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    OR status IN ('pending', 'deleted')
    OR (status = 'approved' AND NOT public.comments_moderation_enabled(tenant_id))
  )
);

-- 3) Posts / pages: mirror the USING ownership predicate in WITH CHECK so an
--    author cannot reassign author_id or write rows outside their scope.
DROP POLICY IF EXISTS "Authors update tenant posts" ON public.posts;
CREATE POLICY "Authors update tenant posts" ON public.posts
FOR UPDATE
USING (
  tenant_id = current_tenant_id()
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'editor'::app_role)
    OR (has_role(auth.uid(), 'author'::app_role) AND author_id = auth.uid())
  )
)
WITH CHECK (
  tenant_id = current_tenant_id()
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'editor'::app_role)
    OR (has_role(auth.uid(), 'author'::app_role) AND author_id = auth.uid())
  )
);

DROP POLICY IF EXISTS "Authors update tenant pages" ON public.pages;
CREATE POLICY "Authors update tenant pages" ON public.pages
FOR UPDATE
USING (
  tenant_id = current_tenant_id()
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'editor'::app_role)
    OR (has_role(auth.uid(), 'author'::app_role) AND author_id = auth.uid())
  )
)
WITH CHECK (
  tenant_id = current_tenant_id()
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'editor'::app_role)
    OR (has_role(auth.uid(), 'author'::app_role) AND author_id = auth.uid())
  )
);