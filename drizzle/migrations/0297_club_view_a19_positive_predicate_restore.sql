DROP FUNCTION IF EXISTS public.club_view(text);
CREATE OR REPLACE FUNCTION public.club_view(p_slug text)
 RETURNS TABLE(id uuid, slug text, name_pl text, name_en text, tagline_pl text, tagline_en text, description_pl text, description_en text, rules_pl text, rules_en text, icon text, accent_color text, cover_image_url text, cover_position_y smallint, visibility text, join_policy text, min_tier_rank integer, attribution_mode text, who_can_post text, moderation_mode text, policy_area text, status text, layout text, member_count integer, group_count integer, thread_count integer, last_activity_at timestamp with time zone, created_at timestamp with time zone, my_role text, my_status text, rules_accepted_at timestamp with time zone, can_read boolean, can_post_thread boolean, can_reply boolean, can_moderate boolean, can_manage boolean, can_invite boolean, can_see_members boolean, reason text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH scope AS (SELECT COALESCE((SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()), public.public_tenant_id()) AS tenant_id),
  found AS (SELECT c.* FROM public.clubs c CROSS JOIN scope s WHERE c.slug = p_slug AND c.tenant_id = s.tenant_id)
  SELECT f.id, f.slug, f.name_pl, f.name_en, f.tagline_pl, f.tagline_en, f.description_pl, f.description_en, f.rules_pl, f.rules_en, f.icon, f.accent_color, f.cover_image_url, f.cover_position_y, f.visibility, f.join_policy, f.min_tier_rank, f.attribution_mode, f.who_can_post, f.moderation_mode, f.policy_area, f.status, f.layout, f.member_count, f.group_count, f.thread_count, f.last_activity_at, f.created_at, public.club_effective_member_role(m.role, m.role_expires_at), m.status, m.rules_accepted_at, cap.can_read, cap.can_post_thread, cap.can_reply, cap.can_moderate, cap.can_manage, cap.can_invite, cap.can_see_members, cap.reason
  FROM found f LEFT JOIN public.club_members m ON m.club_id = f.id AND m.user_id = auth.uid() CROSS JOIN LATERAL public.club_capabilities(f.id, NULL, auth.uid()) cap
  -- Predykat POZYTYWNY (A19; przywrocony po regresji z 20260919220300).
  -- NIE wracac do `cap.reason IS DISTINCT FROM 'not_found'`: galaz anonimowa
  -- club_capabilities nigdy nie zwraca 'not_found', wiec taki filtr wpuszcza
  -- anonima do kazdego klubu tenantu publicznego. Trzy rozlaczne powody, dla
  -- ktorych karta ma prawo wyjsc, i nic poza nimi:
  --   a) wolajacy moze czytac tresc klubu (czlonek, administracja, klub otwarty);
  --   b) wolajacy jest ZALOGOWANY, a klub jest aktywny i nie jest sekretem -
  --      karta klubu 'private' jest jawna dla zalogowanych, sama tresc nie;
  --   c) wolajacy jest czlonkiem w JAKIMKOLWIEK stanie (pending, invited,
  --      banned) - inaczej czekajacy nie zobaczylby, na co czeka, a zbanowany,
  --      ze zostal zbanowany.
  -- Anonim nie spelnia (b) ani (c), wiec dostaje wylacznie (a): public+active.
  WHERE cap.can_read
     OR (auth.uid() IS NOT NULL
         AND f.status = 'active'
         AND f.visibility IN ('public', 'members', 'private'))
     OR m.user_id IS NOT NULL
$function$;

COMMENT ON FUNCTION public.club_view(text) IS
  'Karta klubu po slugu. Predykat jest POZYTYWNY (A19, przywrocony w 20261017120000 po regresji z 20260919220300): anonim widzi wylacznie kluby public+active, zalogowany takze karte klubow members/private, a klub secret, szkic i archiwum - tylko czlonek albo administracja. Zero wierszy znaczy 404, nie 403. Test: supabase/tests/club_view_visibility_test.sql.';

REVOKE EXECUTE ON FUNCTION public.club_view(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_view(text) TO anon, authenticated, service_role;
