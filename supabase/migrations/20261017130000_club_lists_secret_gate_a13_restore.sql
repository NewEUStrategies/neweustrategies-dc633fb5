-- ============================================================================
-- Listy klubów: bramka klubu secret w club_list_by_specialization (i w liczniku
-- club_specializations_public), przywrócone A13 w club_list oraz utracone
-- COMMENT/REVOKE/GRANT club_list, club_list_by_specialization i
-- club_activity_feed (regresje z 20260811110015 i 20260919220300).
--
-- REGRESJA 1 - WYCIEK (club_list_by_specialization, od 20260811110015).
--   Funkcja z panelu Lovable nie miała bramki klubu 'secret': CTE `visible`
--   odsiewało tenant, status 'active', slug specjalizacji i regułę anonima
--   (`auth.uid() IS NOT NULL OR visibility = 'public'`) - i nic więcej.
--   KAŻDY zalogowany użytkownik tenantu dostawał więc przez
--   `POST /rest/v1/rpc/club_list_by_specialization {"p_slug":"..."}` id, slug,
--   nazwę, tagline, okładkę z kadrem, politykę wstępu i liczniki każdego
--   klubu secret w specjalizacji (can_read=false, ale sam wiersz jest
--   wyciekiem: secret to „tylko członkowie wiedzą, że istnieje"). club_list
--   ma tę bramkę od A1/A13, club_view od A19; 20260919220300 (drizzle 0028)
--   przepisała ciało 1:1, dokładając wyłącznie cover_position_y i pg_temp.
--   Ta sama luka siedzi w `club_count` z club_specializations_public (ta sama
--   migracja, bez późniejszej redefinicji): kafel liczył sekrety zalogowanemu
--   spoza klubu, więc po załataniu samej listy licznik i lista rozjechałyby
--   się dokładnie o liczbę sekretów - a ten rozjazd też zdradza ich istnienie.
--   p_limit był bez górnej granicy, a każdy wiersz kosztował wywołanie
--   club_capabilities().
--
-- REGRESJA 2 - A13 (club_list, 20260919220300 / 0028). DROP + CREATE dla
--   cover_position_y odtworzył ciało sprzed A13 (20260808150000, punkt 1):
--   a) `LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200)` stało się
--      `LIMIT GREATEST(COALESCE(p_limit, 100), 1)` - `p_limit => 1000000`
--      przechodził;
--   b) club_capabilities() znów biegło LATERAL dla KAŻDEGO aktywnego klubu
--      tenantu PRZED LIMIT zamiast dla zwracanej strony - klucz lateralny
--      równy id klubu jest unikatowy, więc Memoize nie ma czego zapamiętać
--      (A13 zmierzyło 124 wywołania na 122 wiersze).
--   Bramka sekretu zmieniła się wtedy z „aktywny członek albo is_club_admin"
--   na `cap.can_read`. To wpuszcza też sztab NES (is_nes_staff), spójnie
--   z club_capabilities („JEDYNE źródło prawdy o dostępie") i club_view,
--   a anonim dalej dostaje wyłącznie public+active - ta semantyka ZOSTAJE.
--
-- REGRESJA 3 - METADANE. DROP w 20260919220300 zdjął COMMENT oraz jawne
--   REVOKE ... FROM PUBLIC / GRANT ... TO anon, authenticated, service_role
--   z club_list (A13), club_list_by_specialization (20260811110015) i
--   club_activity_feed (A15): proacl = NULL, czyli EXECUTE dla PUBLIC.
--
-- POPRAWKA.
--   * club_list i club_list_by_specialization dostają JEDEN kształt (A13):
--     CTE `candidate` = tania bramka + sortowanie + total_count (okno liczone
--     PRZED LIMIT, więc dalej pełna liczba widocznych) + LIMIT ... 200;
--     dopiero ta strona idzie do LATERAL club_capabilities po can_read.
--     Bramka sekretu:
--       c.visibility IN ('public', 'members', 'private')
--       OR EXISTS (SELECT 1 FROM public.club_capabilities(c.id, NULL, auth.uid()) k
--                   WHERE k.can_read)
--     To dokładnie `... OR cap.can_read` z 0028 - tylko liczone wyłącznie dla
--     wierszy, których nie wpuściła pierwsza połowa OR (czyli dla sekretów),
--     a nie dla każdego klubu tenantu. Reguła anonima, status 'active', zakres
--     tenantu, klucze sortowania oraz lista i typy kolumn - bez zmian.
--     CREATE OR REPLACE bez DROP: inny RETURNS TABLE skończyłby się 42P13,
--     więc sama migracja dowodzi, że sygnatury są identyczne, a granty i OID
--     zostają (PostgREST nie traci funkcji między DROP a CREATE).
--   * club_specializations_public: ta sama bramka w podzapytaniu club_count
--     (licznik = liczba wierszy, które club_list_by_specialization pokaże).
--   * COMMENT + REVOKE FROM PUBLIC + GRANT anon/authenticated/service_role na
--     wszystkich czterech. club_activity_feed: WYŁĄCZNIE metadane - ciało A15
--     nietknięte (brak CREATE w tym pliku), komentarz 1:1 z A15.
--
-- LIMIT 200 A KLIENT. src/lib/clubs/api.ts i specializationsApi.ts proszą
--   domyślnie o 100 i 60 wierszy. „Pokaż więcej" na /club rośnie o 100
--   (src/routes/club.index.tsx), więc przy ponad 200 widocznych klubach
--   zatrzyma się na 200 - tak jak za A13; dalsze porcje to p_offset.
--
-- DOWÓD: supabase/tests/club_list_visibility_test.sql (pgTAP, pełny schemat)
--   i sekcja A13R w scripts/pg-harness/runtime_test.sql - czerwone na ciałach
--   z 20260919220300 / 20260811110015, zielone po tej migracji.
--
-- DLA KOLEJNYCH MIGRACJI: każda, która musi zrobić DROP którejś z tych
--   funkcji (np. nowa kolumna karty), kopiuje ciało Z TEGO PLIKU i odtwarza
--   COMMENT oraz REVOKE/GRANT - DROP zdejmuje oba.
--
-- KOLEJNOŚĆ: po 20261017120000. POWTÓRNE WYKONANIE BEZPIECZNE (CREATE OR
--   REPLACE, COMMENT, REVOKE/GRANT są idempotentne). Bliźniak drizzle:
--   0298_club_lists_secret_gate_a13_restore (ten sam SQL wykonywalny).
--
-- PO WDROŻENIU (krok operacyjny, SQL go nie wykona): nowy build aplikacji -
--   ten sam krok, którego wymaga 20261017120000, więc jeden build po obu
--   migracjach wystarcza. Segment buildu w kluczu L2 odcina w każdej kolonii
--   zapisane dokumenty /club i /club/specialization/<slug>, a nowe izolaty
--   startują z pustym L1; purge z panelu (`purgeDocumentCache`) czyści tylko
--   kolonię i izolat, który obsłużył żądanie. Same listy biegną w przeglądarce
--   (React Query -> POST /rpc), a dokument SSR jest anonimowy i wynik anonima
--   ta migracja zostawia bez zmian - build jest tu ostrożnością, nie łatą.
-- ============================================================================

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
