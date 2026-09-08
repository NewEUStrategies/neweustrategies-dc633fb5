-- Public readers must be able to read the publishing/access rule of public
-- content; without it the whole public content resolver throws 42501 and every
-- article/page 404s.
GRANT SELECT ON public.content_access TO anon, authenticated;
GRANT SELECT ON public.content_access_public TO anon, authenticated;
GRANT ALL ON public.content_access TO service_role;

DROP POLICY IF EXISTS "content_access public read" ON public.content_access;
CREATE POLICY "content_access public read"
ON public.content_access
FOR SELECT
TO anon, authenticated
USING (tenant_id = public_tenant_id());