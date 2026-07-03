
CREATE OR REPLACE FUNCTION public.get_post_for_edit(_slug text)
RETURNS SETOF public.posts
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.*
    FROM public.posts p
   WHERE p.slug = _slug
     AND p.tenant_id = public.current_tenant_id()
     AND public.is_staff()
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_page_for_edit(_slug text)
RETURNS SETOF public.pages
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT pg.*
    FROM public.pages pg
   WHERE pg.slug = _slug
     AND pg.tenant_id = public.current_tenant_id()
     AND public.is_staff()
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_post_for_edit(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_page_for_edit(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_post_for_edit(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_page_for_edit(text) TO authenticated;
