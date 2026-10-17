-- ============================================================================
-- club_view: przywrócenie POZYTYWNEGO predykatu A19 (regresja z 20260919220300)
--
-- REGRESJA. A19 (20260808210000, sekcja 1, KRYTYCZNE) zastąpiła filtr
--   `WHERE cap.reason IS DISTINCT FROM 'not_found'` predykatem POZYTYWNYM, bo
--   gałąź anonimowa `club_capabilities` nie zwraca 'not_found' NIGDY: anonim
--   dostaje reason NULL dla klubu public+active, a w każdym innym przypadku
--   'auth_required' (tak jest do dziś, ostatnia definicja 20261007100100).
--   Dla wołającego bez sesji warunek był więc tautologią.
--   20260919220300_club_cover_position_y (bliźniak drizzle 0028) musiała zrobić
--   DROP + CREATE, żeby dopisać `cover_position_y` do RETURNS TABLE, i odtworzyła
--   ciało z wersji SPRZED A19: stary filtr wrócił, a razem z DROP zniknęły
--   COMMENT oraz jawne REVOKE/GRANT z A19. Żadna późniejsza migracja (oba pasy,
--   do 20261013900900 / 0296) club_view nie redefiniuje - to jest stan produkcji.
--
-- SKUTEK. `POST /rest/v1/rpc/club_view {"p_slug":"..."}` BEZ tokenu oddaje pełny
--   wiersz dowolnego klubu tenantu publicznego - nazwę, opis, ZASADY, okładkę
--   z kadrem, politykę wstępu, liczniki - także klubu 'secret' (cała jego
--   definicja: „tylko członkowie wiedzą, że istnieje"), szkicu ('draft'),
--   archiwum oraz kart members/private, których A19 anonimowi nie pokazuje.
--   Zalogowany spoza klubu dostaje dodatkowo szkic i archiwum (reason
--   'not_open_yet' / 'archived' to też nie 'not_found'). Loader układu
--   /club/$clubSlug czyta club_view jako anonim na SSR, więc niepusty wiersz
--   sekretu trafiał też do danych `head()` dokumentu (a przy okładce - do
--   nagłówka Link), a dokument zostawał przy cache'owalnej polityce treści
--   zamiast `no-store`, którą loader daje wyłącznie przy braku wiersza.
--
-- POPRAWKA. Ciało 1:1 z 20260919220300 - ta sama lista i kolejność kolumn
--   RETURNS TABLE (z `cover_position_y smallint`), ten sam search_path
--   ('public', 'pg_temp'), te same CTE scope/found i projekcja. Zmienia się
--   WYŁĄCZNIE WHERE - na predykat A19, bez adaptacji, bo żadna kolumna ani
--   złączenie, z których korzysta, nie zmieniły się od A19:
--
--     cap.can_read
--     OR (auth.uid() IS NOT NULL AND f.status = 'active'
--         AND f.visibility IN ('public', 'members', 'private'))
--     OR m.user_id IS NOT NULL
--
--   Anonim: wyłącznie public+active. Zalogowany z tenanta: także karta
--   members/private (treść dalej za can_read). Secret, szkic, archiwum: tylko
--   członek (w dowolnym stanie, łącznie z banned) albo administracja tenanta
--   (can_read z club_capabilities). Obcy tenant: zero wierszy jak dotąd (CTE
--   scope). COMMENT i REVOKE FROM PUBLIC + GRANT anon/authenticated/service_role
--   wracają w brzmieniu A19.
--
-- DLACZEGO DROP + CREATE, skoro sygnatura i typ zwrotny są dziś te same:
--   DROP IF EXISTS uniezależnia plik od tego, czy środowisko ma już wersję
--   z `cover_position_y` (CREATE OR REPLACE przy innym RETURNS = 42P13). DROP
--   zdejmuje granty i komentarz, więc oba odtwarzamy jawnie poniżej.
--
-- DOWÓD (regres przybity testem): supabase/tests/club_view_visibility_test.sql
--   (pgTAP, pełny schemat: anon / zalogowany spoza klubu / członek sekretu /
--   zbanowany / admin tenanta / obcy tenant, plus granty) oraz sekcja A19R
--   w scripts/pg-harness/runtime_test.sql. Oba padają na ciele z
--   20260919220300 i przechodzą po tej migracji.
--
-- DLA KOLEJNYCH MIGRACJI: każda, która musi zrobić DROP club_view (np. nowa
--   kolumna karty), kopiuje ciało Z TEGO PLIKU, nie z wcześniejszych.
--
-- KOLEJNOŚĆ: po 20260919220300. POWTÓRNE WYKONANIE BEZPIECZNE (DROP IF EXISTS
--   + CREATE, REVOKE/GRANT idempotentne). Bliźniak drizzle:
--   0297_club_view_a19_positive_predicate_restore (ten sam SQL wykonywalny).
--
-- PO WDROŻENIU (krok operacyjny, SQL go nie wykona): unieważnić cache
--   dokumentów WSZYSTKICH hostów tenantów NOWYM BUILDEM aplikacji (segment
--   buildu w kluczu L2 odcina wpisy w każdej kolonii, nowe izolaty startują
--   z pustym L1). Purge z panelu (/admin/performance?tab=cache ->
--   `purgeDocumentCache`) NIE wystarcza: bump wersji L2 siedzi w Cache API
--   jednej kolonii, a L1 czyści tylko w izolacie, który obsłużył żądanie.
--   Póki regresja żyła, SSR /club/<slug> klubu secret, szkicu, archiwum
--   i members/private dostawał wiersz, więc dokument (head + karta z zasadami)
--   szedł z polityką treści (s-maxage=900, swr=86400) i mógł trafić do NES
--   Edge Cache. Po migracji loader oddaje 200 `no-store`, a takie odświeżenie
--   NIE usuwa wpisu (documentCache.server.ts: eksmisja wyłącznie na
--   404/410/3xx) - stara strona byłaby podawana jako STALE do doby
--   (DOCUMENT_CACHE_MAX_SWR_MS). Nie czekać na wygaśnięcie.
-- ============================================================================

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
