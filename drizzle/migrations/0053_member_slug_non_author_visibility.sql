-- member_slug_is_non_author(text): gosc dostaje true wylacznie dla profilu
-- widocznego w profiles_public (zrodlo get_expert_hub, tenant zadania),
-- zalogowany - wylacznie gdy cel 301 rozwiaze profil (get_member_profile
-- oddaje wiersz z is_author = false). 0047 odpowiadalo dla kazdego sluga
-- w kazdym tenancie, takze dla profili ukrytych przed anon. Server fn
-- isNonAuthorMemberSlug przekazuje bearer sesji, gdy jest. Swiadomy koszt:
-- gosc dostaje 404 zamiast 301 na /people dla czlonka widocznego tylko
-- w katalogu wewnetrznym (discoverable). Do tego is_platform_author traci
-- EXECUTE dla authenticated (wolaja go tylko funkcje SECURITY DEFINER).
-- Blizniak: supabase/migrations/20260925100000_member_slug_non_author_visibility.sql.
CREATE OR REPLACE FUNCTION public.member_slug_is_non_author(p_slug text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN EXISTS (
      SELECT 1 FROM public.profiles_public pp
       WHERE pp.slug = p_slug
         AND NOT public.is_platform_author(pp.id)
    )
    ELSE COALESCE((public.get_member_profile(p_slug) ->> 'is_author') = 'false', false)
  END;
$$;
REVOKE ALL ON FUNCTION public.member_slug_is_non_author(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.member_slug_is_non_author(text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.member_slug_is_non_author(text) IS
  'Czy /author/<slug> ma przekierowac 301 na /people/<slug>: slug osoby BEZ roli autora, '
  'ktorej profil wolajacy zobaczy. Gosc: profil widoczny w profiles_public (zrodlo '
  'get_expert_hub). Zalogowany: get_member_profile(slug) oddaje wiersz z is_author = false. '
  'Wylacznie boolean; dla profilu niewidocznego, obcego tenanta albo nieznanego sluga '
  'false - nie jest wyrocznia istnienia profili.';

REVOKE EXECUTE ON FUNCTION public.is_platform_author(uuid) FROM authenticated;
