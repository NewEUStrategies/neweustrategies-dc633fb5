-- ============================================================================
-- Listy klubów: porządek CAŁKOWITY w club_list i club_list_by_specialization
-- (remis rozstrzyga id), żeby strony p_offset składały się w pełną listę -
-- bez dziury i bez powtórzenia na styku stron.
--
-- PROBLEM. 20261017130000 (A13) sortuje po
--   (is_mine DESC, last_activity_at DESC NULLS LAST, lower(name_pl) ASC)
--   i nie ma na końcu klucza unikatowego. Remisy są realne:
--   * last_activity_at jest NULL (kolumna bez DEFAULT) dla każdego klubu bez
--     wątków - świeże i zaimportowane kluby remisują na dwóch pierwszych
--     kluczach;
--   * name_pl nie jest unikatowe (unikatowe jest tylko (tenant_id, slug)),
--     a lower() zrównuje także nazwy różniące się wielkością liter.
--   Kolejność wierszy w remisie jest w Postgresie niezdefiniowana, a plan
--   zależy od LIMIT/OFFSET: strona offset 0 / limit 100 idzie top-N heapsortem
--   (bound 100), strona offset 100 - pełnym quicksortem (bound 200), i oba
--   porządkują ten sam remis inaczej. Remis na styku stron daje wtedy JEDEN
--   klub na obu stronach i INNY na żadnej - na danych statycznych, bez
--   żadnej zmiany między wywołaniami (próba na PG 16 o kształcie tych
--   zapytań: dwa kluby o nazwach różnych tylko wielkością liter na styku
--   100/101 - dziura w 95 na 200 prób; dziesięć takich - w 198 na 200;
--   z id na końcu ORDER BY - 0 na 200).
--   Klient od tej samej serii stronicuje /club po p_offset (porcje po 100,
--   src/lib/clubs/useClubCatalog.ts). Duplikat usuwa sklejanie porcji po id,
--   ale dziury nie widać: liczba oddanych wierszy zrównuje się z total_count,
--   przycisk „pokaż więcej" znika, a jednego klubu nie ma na ekranie.
--
-- POPRAWKA. `, c.id ASC` na końcu ORDER BY w CTE candidate (to on wybiera
--   stronę przez LIMIT/OFFSET) i `, v.id ASC` na końcu zewnętrznego ORDER BY
--   (on ustala kolejność zwrotki - porządek CTE nie jest gwarantowany po
--   złączeniu LATERAL). Poza tym ciała 1:1 z 20261017130000: bramka sekretu,
--   reguła anonima, zakres tenantu, sufit 200, total_count z okna PRZED
--   LIMIT, club_capabilities tylko dla zwracanej strony, RETURNS TABLE.
--   Koszt: jeden klucz więcej w sortowaniu, które i tak biegnie (pierwszy
--   klucz to wynik LEFT JOIN club_members, więc indeks go nie obsłuży);
--   pomiar wywołań club_capabilities z A13 bez zmian.
--   CREATE OR REPLACE bez DROP (inny RETURNS TABLE skończyłby się 42P13, więc
--   sama migracja dowodzi, że sygnatury są te same; granty i OID zostają).
--   COMMENT, REVOKE i GRANT powtórzone mimo to - reguła z 20261017130000:
--   każda redefinicja tych funkcji odtwarza metadane jawnie.
--
-- CZEGO NIE ROBI. Porządek dalej ŻYJE: nowa aktywność przenosi klub między
--   stronami, więc klub, który między porcjami wskoczy na stronę już
--   wczytaną, ominie offset aż do refetchu (powtórzenia usuwa klient). Na to
--   potrzebny jest kursor (keyset), nie rozstrzygnięcie remisu - ta migracja
--   zamyka dziurę na danych STATYCZNYCH. club_specializations_public
--   i club_activity_feed - bez zmian.
--
-- DOWÓD: supabase/tests/club_list_visibility_test.sql, sekcja 7, i sekcja
--   A13R.6 w scripts/pg-harness/runtime_test.sql - fixture z remisami
--   (nazwy różne tylko wielkością liter, bez aktywności) na stykach stron
--   100 i 200; strony 0/100/200 sklejone = pełna lista w porządku z id.
--   Czerwone na ciałach z 20261017130000, zielone po tej migracji.
--
-- DLA KOLEJNYCH MIGRACJI: ciało club_list / club_list_by_specialization
--   kopiuje się odtąd Z TEGO PLIKU (nie z 20261017130000) i odtwarza COMMENT
--   oraz REVOKE/GRANT.
--
-- KOLEJNOŚĆ: po 20261017130000 (i niezależna od 20261017140000). POWTÓRNE
--   WYKONANIE BEZPIECZNE (CREATE OR REPLACE, COMMENT, REVOKE/GRANT są
--   idempotentne). Bliźniak drizzle: 0300_club_lists_total_order (ten sam
--   SQL wykonywalny). Bez kroku operacyjnego: zmienia się wyłącznie kolejność
--   wierszy w remisie, więc ani zapisane dokumenty SSR, ani cache klienta nie
--   niosą niczego, co trzeba unieważnić.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) club_list: cialo z 20261017130000 + id na koncu obu ORDER BY
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_list(p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, slug text, name_pl text, name_en text, tagline_pl text, tagline_en text, icon text, accent_color text, cover_image_url text, cover_position_y smallint, visibility text, join_policy text, min_tier_rank integer, policy_area text, status text, member_count integer, group_count integer, thread_count integer, last_activity_at timestamp with time zone, my_role text, my_status text, can_read boolean, total_count bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH me AS (SELECT p.id AS uid, p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()),
  scope AS (SELECT COALESCE((SELECT tenant_id FROM me), public.public_tenant_id()) AS tenant_id),
  -- Bramka BEZ club_capabilities dla klubow public/members/private: o nich
--   rozstrzyga sama widocznosc w wierszu. Zdolnosci sa potrzebne wylacznie do
--   klubu 'secret' i tylko tam OR siega po EXISTS (can_read: aktywny czlonek,
--   administracja klubow, sztab NES - jak cap.can_read w 0028). Okno count(*)
--   liczy sie PRZED LIMIT, wiec total_count to dalej pelna liczba widocznych.
  -- `c.id` na koncu ORDER BY: porzadek CALKOWITY, wiec LIMIT/OFFSET kolejnych
  -- stron tnie te sama sekwencje (remis bez id = inna kolejnosc w kazdym
  -- planie, dziura i duplikat na styku stron - patrz 20261017150000).
  candidate AS (
    SELECT c.id, c.slug, c.name_pl, c.name_en, c.tagline_pl, c.tagline_en, c.icon, c.accent_color, c.cover_image_url, c.cover_position_y, c.visibility, c.join_policy, c.min_tier_rank, c.policy_area, c.status, c.member_count, c.group_count, c.thread_count, c.last_activity_at,
           m.role AS m_role, m.role_expires_at AS m_expires, m.status AS m_status, (m.user_id IS NOT NULL) AS is_mine,
           count(*) OVER () AS total_count
    FROM public.clubs c CROSS JOIN scope s LEFT JOIN public.club_members m ON m.club_id = c.id AND m.user_id = auth.uid() AND m.status = 'active'
    WHERE c.tenant_id = s.tenant_id
      AND c.status = 'active'
      AND (c.visibility IN ('public', 'members', 'private')
           OR EXISTS (SELECT 1 FROM public.club_capabilities(c.id, NULL, auth.uid()) k WHERE k.can_read))
      AND (auth.uid() IS NOT NULL OR c.visibility = 'public')
    ORDER BY (m.user_id IS NOT NULL) DESC, c.last_activity_at DESC NULLS LAST, lower(c.name_pl) ASC, c.id ASC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200) OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  )
  -- LATERAL dopiero tutaj: liczy sie dla JEDNEJ STRONY (max 200), nie dla tenantu.
  -- Zewnetrzny ORDER BY powtarza CALY klucz (z id): kolejnosc wierszy CTE
  -- nie jest gwarantowana po zlaczeniu LATERAL.
  SELECT v.id, v.slug, v.name_pl, v.name_en, v.tagline_pl, v.tagline_en, v.icon, v.accent_color, v.cover_image_url, v.cover_position_y, v.visibility, v.join_policy, v.min_tier_rank, v.policy_area, v.status, v.member_count, v.group_count, v.thread_count, v.last_activity_at, public.club_effective_member_role(v.m_role, v.m_expires), v.m_status, cap.can_read, v.total_count
  FROM candidate v CROSS JOIN LATERAL public.club_capabilities(v.id, NULL, auth.uid()) cap
  ORDER BY v.is_mine DESC, v.last_activity_at DESC NULLS LAST, lower(v.name_pl) ASC, v.id ASC
$function$;

COMMENT ON FUNCTION public.club_list(integer, integer) IS
  'Lista klubow widocznych dla wolajacego. Bramka widocznosci nie wola club_capabilities - zdolnosci licza sie LATERAL dopiero dla zwroconej strony, bo klucz lateralny rowny id klubu jest unikatowy i Memoize nie ma czego zapamietac. Wyjatek: klub secret rozstrzyga club_capabilities.can_read (czlonek aktywny, administracja, sztab NES), wolane tylko dla sekretow. Strona max 200 wierszy w porzadku calkowitym (czlonkostwo, aktywnosc, lower(name_pl), id), wiec strony p_offset skladaja sie bez dziur i powtorzen. A13, przywrocone w 20261017130000 po regresji z 20260919220300; id w porzadku od 20261017150000.';

REVOKE EXECUTE ON FUNCTION public.club_list(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_list(integer, integer) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2) club_list_by_specialization: cialo z 20261017130000 + id na koncu obu
--    ORDER BY
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_list_by_specialization(p_slug text, p_limit integer DEFAULT 60, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, slug text, name_pl text, name_en text, tagline_pl text, tagline_en text, icon text, accent_color text, cover_image_url text, cover_position_y smallint, visibility text, join_policy text, min_tier_rank integer, policy_area text, specialization_slug text, status text, member_count integer, group_count integer, thread_count integer, last_activity_at timestamp with time zone, my_role text, my_status text, can_read boolean, total_count bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH scope AS (SELECT COALESCE(public._caller_tenant(), public.public_tenant_id()) AS tenant_id),
  -- Ta sama bramka co club_list. Bez czlonu o sekrecie kazdy zalogowany
--   z tenantu listowal kluby secret danej specjalizacji (id, nazwa, okladka).
  -- Porzadek calkowity (id na koncu) z tego samego powodu co w club_list.
  candidate AS (
    SELECT c.id, c.slug, c.name_pl, c.name_en, c.tagline_pl, c.tagline_en, c.icon, c.accent_color, c.cover_image_url, c.cover_position_y, c.visibility, c.join_policy, c.min_tier_rank, c.policy_area, c.specialization_slug, c.status, c.member_count, c.group_count, c.thread_count, c.last_activity_at,
           m.role AS m_role, m.role_expires_at AS m_expires, m.status AS m_status, (m.user_id IS NOT NULL) AS is_mine,
           count(*) OVER () AS total_count
    FROM public.clubs c CROSS JOIN scope s LEFT JOIN public.club_members m ON m.club_id = c.id AND m.user_id = auth.uid() AND m.status = 'active'
    WHERE c.tenant_id = s.tenant_id
      AND c.status = 'active'
      AND c.specialization_slug = btrim(p_slug)
      AND (c.visibility IN ('public', 'members', 'private')
           OR EXISTS (SELECT 1 FROM public.club_capabilities(c.id, NULL, auth.uid()) k WHERE k.can_read))
      AND (auth.uid() IS NOT NULL OR c.visibility = 'public')
    ORDER BY (m.user_id IS NOT NULL) DESC, c.last_activity_at DESC NULLS LAST, lower(c.name_pl) ASC, c.id ASC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 60), 1), 200) OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  )
  SELECT v.id, v.slug, v.name_pl, v.name_en, v.tagline_pl, v.tagline_en, v.icon, v.accent_color, v.cover_image_url, v.cover_position_y, v.visibility, v.join_policy, v.min_tier_rank, v.policy_area, v.specialization_slug, v.status, v.member_count, v.group_count, v.thread_count, v.last_activity_at, public.club_effective_member_role(v.m_role, v.m_expires), v.m_status, cap.can_read, v.total_count
  FROM candidate v CROSS JOIN LATERAL public.club_capabilities(v.id, NULL, auth.uid()) cap
  ORDER BY v.is_mine DESC, v.last_activity_at DESC NULLS LAST, lower(v.name_pl) ASC, v.id ASC
$function$;

COMMENT ON FUNCTION public.club_list_by_specialization(text, integer, integer) IS
  'Kluby jednej specjalizacji - te same reguly widocznosci co club_list: anonim wylacznie public+active, zalogowany z tenantu takze members/private, klub secret tylko gdy club_capabilities.can_read (czlonek aktywny, administracja, sztab NES). Zdolnosci licza sie dla zwroconej strony; strona max 200 wierszy w porzadku calkowitym (jak club_list, id na koncu od 20261017150000). Bramka sekretu od 20261017130000 (wyciek od 20260811110015).';

REVOKE EXECUTE ON FUNCTION public.club_list_by_specialization(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_list_by_specialization(text, integer, integer) TO anon, authenticated, service_role;
