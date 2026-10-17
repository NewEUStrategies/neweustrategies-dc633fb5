-- ----------------------------------------------------------------------------
-- 1) club_list: tania bramka najpierw, zdolnosci tylko dla strony (A13)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_list(p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, slug text, name_pl text, name_en text, tagline_pl text, tagline_en text, icon text, accent_color text, cover_image_url text, cover_position_y smallint, visibility text, join_policy text, min_tier_rank integer, policy_area text, status text, member_count integer, group_count integer, thread_count integer, last_activity_at timestamp with time zone, my_role text, my_status text, can_read boolean, total_count bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH me AS (SELECT p.id AS uid, p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()),
  scope AS (SELECT COALESCE((SELECT tenant_id FROM me), public.public_tenant_id()) AS tenant_id),
  -- Bramka BEZ club_capabilities dla klubow public/members/private: o nich
  -- rozstrzyga sama widocznosc w wierszu. Zdolnosci sa potrzebne wylacznie do
  -- klubu 'secret' i tylko tam OR siega po EXISTS (can_read: aktywny czlonek,
  -- administracja klubow, sztab NES - jak cap.can_read w 0028). Okno count(*)
  -- liczy sie PRZED LIMIT, wiec total_count to dalej pelna liczba widocznych.
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
    ORDER BY (m.user_id IS NOT NULL) DESC, c.last_activity_at DESC NULLS LAST, lower(c.name_pl) ASC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200) OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  )
  -- LATERAL dopiero tutaj: liczy sie dla JEDNEJ STRONY (max 200), nie dla tenantu.
  SELECT v.id, v.slug, v.name_pl, v.name_en, v.tagline_pl, v.tagline_en, v.icon, v.accent_color, v.cover_image_url, v.cover_position_y, v.visibility, v.join_policy, v.min_tier_rank, v.policy_area, v.status, v.member_count, v.group_count, v.thread_count, v.last_activity_at, public.club_effective_member_role(v.m_role, v.m_expires), v.m_status, cap.can_read, v.total_count
  FROM candidate v CROSS JOIN LATERAL public.club_capabilities(v.id, NULL, auth.uid()) cap
  ORDER BY v.is_mine DESC, v.last_activity_at DESC NULLS LAST, lower(v.name_pl) ASC
$function$;

COMMENT ON FUNCTION public.club_list(integer, integer) IS
  'Lista klubow widocznych dla wolajacego. Bramka widocznosci nie wola club_capabilities - zdolnosci licza sie LATERAL dopiero dla zwroconej strony, bo klucz lateralny rowny id klubu jest unikatowy i Memoize nie ma czego zapamietac. Wyjatek: klub secret rozstrzyga club_capabilities.can_read (czlonek aktywny, administracja, sztab NES), wolane tylko dla sekretow. Strona max 200 wierszy. A13, przywrocone w 20261017130000 po regresji z 20260919220300.';

REVOKE EXECUTE ON FUNCTION public.club_list(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_list(integer, integer) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2) club_list_by_specialization: bramka sekretu (wyciek od 20260811110015),
--    limit strony i ten sam ksztalt co club_list
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_list_by_specialization(p_slug text, p_limit integer DEFAULT 60, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, slug text, name_pl text, name_en text, tagline_pl text, tagline_en text, icon text, accent_color text, cover_image_url text, cover_position_y smallint, visibility text, join_policy text, min_tier_rank integer, policy_area text, specialization_slug text, status text, member_count integer, group_count integer, thread_count integer, last_activity_at timestamp with time zone, my_role text, my_status text, can_read boolean, total_count bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH scope AS (SELECT COALESCE(public._caller_tenant(), public.public_tenant_id()) AS tenant_id),
  -- Ta sama bramka co club_list. Bez czlonu o sekrecie kazdy zalogowany
  -- z tenantu listowal kluby secret danej specjalizacji (id, nazwa, okladka).
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
    ORDER BY (m.user_id IS NOT NULL) DESC, c.last_activity_at DESC NULLS LAST, lower(c.name_pl) ASC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 60), 1), 200) OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  )
  SELECT v.id, v.slug, v.name_pl, v.name_en, v.tagline_pl, v.tagline_en, v.icon, v.accent_color, v.cover_image_url, v.cover_position_y, v.visibility, v.join_policy, v.min_tier_rank, v.policy_area, v.specialization_slug, v.status, v.member_count, v.group_count, v.thread_count, v.last_activity_at, public.club_effective_member_role(v.m_role, v.m_expires), v.m_status, cap.can_read, v.total_count
  FROM candidate v CROSS JOIN LATERAL public.club_capabilities(v.id, NULL, auth.uid()) cap
  ORDER BY v.is_mine DESC, v.last_activity_at DESC NULLS LAST, lower(v.name_pl) ASC
$function$;

COMMENT ON FUNCTION public.club_list_by_specialization(text, integer, integer) IS
  'Kluby jednej specjalizacji - te same reguly widocznosci co club_list: anonim wylacznie public+active, zalogowany z tenantu takze members/private, klub secret tylko gdy club_capabilities.can_read (czlonek aktywny, administracja, sztab NES). Zdolnosci licza sie dla zwroconej strony; strona max 200 wierszy. Bramka sekretu od 20261017130000 (wyciek od 20260811110015).';

REVOKE EXECUTE ON FUNCTION public.club_list_by_specialization(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_list_by_specialization(text, integer, integer) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3) club_specializations_public: licznik zgodny z lista (bez sekretow)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_specializations_public()
 RETURNS TABLE(slug text, key text, label_pl text, label_en text, lead_pl text, lead_en text, desc_pl text, desc_en text, icon text, sort_order integer, club_count integer)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH scope AS (SELECT COALESCE(public._caller_tenant(), public.public_tenant_id()) AS tenant_id)
  SELECT s.slug, s.key, s.label_pl, s.label_en, s.lead_pl, s.lead_en, s.desc_pl, s.desc_en, s.icon, s.sort_order,
    -- Licznik = liczba wierszy, ktore club_list_by_specialization pokaze temu
    -- samemu wolajacemu (ta sama bramka). Liczony sekret zdradzal jego istnienie.
    (SELECT count(*)::integer FROM public.clubs c
      WHERE c.tenant_id = s.tenant_id
        AND c.status = 'active'
        AND c.specialization_slug = s.slug
        AND (c.visibility IN ('public', 'members', 'private')
             OR EXISTS (SELECT 1 FROM public.club_capabilities(c.id, NULL, auth.uid()) k WHERE k.can_read))
        AND (auth.uid() IS NOT NULL OR c.visibility = 'public')) AS club_count
  FROM public.club_specializations s CROSS JOIN scope sc
  WHERE s.is_active AND s.tenant_id = sc.tenant_id
  ORDER BY s.sort_order, s.slug
$function$;

COMMENT ON FUNCTION public.club_specializations_public() IS
  'Aktywne specjalizacje klubow tenantu wolajacego (anon: tenant publiczny) z licznikiem club_count liczonym ta sama bramka co club_list_by_specialization - klub secret liczy sie tylko temu, kto go widzi (od 20261017130000).';

REVOKE EXECUTE ON FUNCTION public.club_specializations_public() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_specializations_public() TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4) club_activity_feed: wylacznie metadane A15 (cialo bez zmian)
-- ----------------------------------------------------------------------------
COMMENT ON FUNCTION public.club_activity_feed(integer, text, text, integer) IS
  'Strumien aktywnosci PONAD klubami dla strony glownej klubow. Nie zwraca author_id w zadnym trybie - hub jest powierzchnia odkrywania, a czego nie ma w zwrotce, tego nie da sie wyciec. Anonimowosc rozstrzyga sie per wiersz, bo strumien miesza kluby o roznym trybie atrybucji. p_per_club dlawi udzial jednego klubu - bez tego jeden ruchliwy klub zajmuje cala liste i hub przestaje pokazywac szerokosc.';

REVOKE EXECUTE ON FUNCTION public.club_activity_feed(integer, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_activity_feed(integer, text, text, integer) TO anon, authenticated, service_role;
