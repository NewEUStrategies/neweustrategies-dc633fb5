CREATE OR REPLACE FUNCTION public.post_view_count(_post_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT count(v.id)
      FROM public.posts p
      JOIN public.post_views v ON v.post_id = p.id
     WHERE p.id = _post_id
       AND p.status = 'published'
       AND p.deleted_at IS NULL
       AND p.tenant_id = public.public_tenant_id()
  ), 0);
$$;

REVOKE ALL ON FUNCTION public.post_view_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_view_count(uuid)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.post_view_count(uuid) IS
  'Liczba odslon (post_views) opublikowanego wpisu biezacego tenanta publicznego. SECURITY DEFINER, bo post_views nie ma publicznej polityki SELECT; zwraca sam licznik i 0 dla wpisu spoza tenanta, nieopublikowanego lub usunietego.';