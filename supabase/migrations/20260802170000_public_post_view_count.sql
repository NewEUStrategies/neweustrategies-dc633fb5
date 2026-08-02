-- Publiczny licznik odsłon POJEDYNCZEGO wpisu (widget `post-meta`, opcja
-- "Pokaż liczbę odsłon").
--
-- PROBLEM: `public.post_views` nie ma polityki SELECT dla anon/authenticated
-- (migracja 20260625160054 skasowała publiczny odczyt, 20260626162717 zostawiła
-- wyłącznie odczyt administracyjny w tenancie domowym). Licznik w widgecie był
-- więc nieosiągalny publicznie: kanwa buildera pokazywała próbkę 1234, a strona
-- publiczna nie mogła pokazać NICZEGO, bo nikt nie potrafił policzyć wierszy.
--
-- ROZWIĄZANIE: agregat w funkcji SECURITY DEFINER, dokładnie tym samym wzorcem
-- co `popular_post_ids` / `trending_posts`:
--   * zwraca WYŁĄCZNIE liczbę (zero kolumn viewer_hash / user_id, zero PII),
--   * ponownie wymusza tenant publiczny (`public_tenant_id()`) oraz
--     status = 'published' + brak soft-delete, więc nie da się policzyć odsłon
--     wpisu innego tenanta ani szkicu,
--   * brak jakiegokolwiek `has_role()` w ciele, więc nie miesza płaszczyzny
--     publicznej (nagłówek x-tenant-host) z autoryzacją roli - inwariant
--     pilnowany przez `bun run check:sql-tenant-scope`,
--   * `SET search_path = public` + REVOKE FROM PUBLIC + jawne GRANT-y.
-- Wpis niewidoczny publicznie zwraca 0 (nigdy NULL), więc wywołanie nie
-- rozróżnia "brak wpisu" od "wpis bez odsłon" i nie jest wyrocznią istnienia.

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
  'Liczba odsłon (post_views) opublikowanego wpisu bieżącego tenanta publicznego. '
  'SECURITY DEFINER, bo post_views nie ma publicznej polityki SELECT; zwraca sam '
  'licznik (bez viewer_hash / user_id) i 0 dla wpisu spoza tenanta, nieopublikowanego '
  'lub usuniętego. Zasila opcję "Pokaż liczbę odsłon" widgetu post-meta.';
