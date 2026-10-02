-- ============================================================================
-- LINKI DO PROFILU OSOBY: SLUG I TRASA Z BAZY, NIGDY UUID W MIEJSCU SLUGA.
--
-- BLIZNIAK drizzle/migrations/0120_profile_link_routes.sql - ten sam SQL
-- wykonywalny (pilnuje tego `src/lib/ci/migrationLaneParity.ts`).
--
-- FINDING (jedna klasa defektu, trzy miejsca). Trzy karty linkowaly osobe,
-- podajac trasie identyfikator w miejscu sluga, bo zasilajace je RPC nie
-- zwracaly zadnego sluga:
--   * IntroductionsCard (/profile) - `/people/$slug` z `<rola>_id`;
--     `get_member_profile` szuka WYLACZNIE po slugu (20260924100000:34-36),
--     wiec kazde klikniecie w kazdej z trzech rol konczylo sie karta
--     "Nie znaleziono profilu". Zrodlo: my_introduction_requests
--     (20260724120000:46-73).
--   * RecommendationsSection (hub /author) - `/author/$slug` z `author_id`.
--     Zrodlo: list_recommendations (20260725090000:161-209).
--   * ProfileViewsCard (/profile) - `/author/$slug` z `viewer_id`.
--     Zrodlo: my_profile_viewers (20260913170000:91-110).
-- `/author/<uuid>` rozwiazuje sie tylko przez UUID-owy fallback
-- `get_expert_hub`, a przekierowanie nie-autora na /people
-- (`member_slug_is_non_author`) porownuje WYLACZNIE slug (20260925100000:71-74).
-- Skutek dla zwyklego czlonka: w SPA hub autora zamiast /people, a po F5 albo
-- w nowej karcie (SSR bez sesji) trwale 404.
--
-- CO ZMIENIA
--   0. `_profile_link_route(uuid)` - JEDNO miejsce, ktore mowi, dokad link do
--      danej osoby doprowadzi wolajacego: 'author', 'people' albo NULL (nie
--      linkuj). Bramek NIE kopiujemy - wolamy te same funkcje, ktorych uzywaja
--      trasy, zeby zmiana widocznosci profilu nie rozjechala sie z linkami:
--        'author' - osoba ma role autora (`is_platform_author`) i publiczna
--                   obecnosc w tenancie zadania (`public_tenant_id()` +
--                   `profile_has_public_presence`). To jest galaz anonimowa
--                   `profiles_public` (20260807061849:44-47), z ktorej
--                   `get_expert_hub` czyta hub - wiec hub otwiera sie takze po
--                   F5 (SSR anonimowy), a `member_slug_is_non_author` dla
--                   autora daje false, czyli bez przekierowania na /people.
--                   Kolejnosc jak w `profileHref` (src/lib/profile/profileHref.ts):
--                   autor -> /author, reszta -> /people.
--        'people' - zalogowany wolajacy, a `get_member_profile(slug)` rozwiazuje
--                   TE osobe (tenant + wlasny / discoverable / polaczenie).
--        NULL     - brak sluga, pusty slug albo zadna trasa jej nie pokaze.
--      Autor BEZ publicznej obecnosci, widoczny tylko z galezi czlonkowskiej,
--      dostaje 'people' (jesli ja rozwiaze), a nie /author - tam po F5 byloby
--      404. Nie-autor z publiczna obecnoscia (odznaka eksperta), ktorego /people
--      nie rozwiaze, dostaje NULL: /author/<slug> po F5 przekierowuje go na
--      /people, ktore konczy sie "Nie znaleziono profilu".
--   1. my_introduction_requests: na KONCU RETURNS TABLE pary *_slug / *_route
--      dla proszacego, celu i mostu. Slug niepusty wylacznie przy niepustej
--      trasie. Dodatkowo rola spoza trzech (albo NULL) to blad 22023 zamiast
--      cichej pustej listy z `ELSE FALSE`: eksport RODO wolal te funkcje z
--      'all' i od poczatku oddawal `network_introductions: []` bez sygnalu.
--      Reszta ciala (13 kolumn, WHERE, ORDER BY) bez zmian.
--   2. list_recommendations: na KONCU author_slug / author_route. Sekcja jest
--      na PUBLICZNYM hubie - gosc dostaje trase 'author' dla autorow
--      z publicznym hubem, a 'people' nigdy (bramka logowania). Tenant
--      wlasciciela, prywatnosc moderacji i granty anon/authenticated bez zmian.
--   3. my_profile_viewers: na KONCU viewer_slug / viewer_route, wylacznie dla
--      wiersza `viewer_mode = 'public'` - slug pod TYM SAMYM warunkiem co
--      viewer_id i nazwa; widz anonimowy nie dostaje nic. Trasa liczona PO
--      LIMIT, nie dla calej historii odslon.
--   4. `search_path = public, pg_temp` we wszystkich czterech funkcjach.
--      DROP + CREATE gubi proconfig, a 20260830120000 dopisalo `pg_temp`
--      funkcjom SECURITY DEFINER; my_profile_viewers zgubilo je juz wczesniej
--      przez CREATE OR REPLACE w 20260913170000.
--   5. ACL odtworzone jawnie (DROP + CREATE je zeruje): introductions
--      i viewers - authenticated; recommendations - anon i authenticated
--      (publiczny hub); helper - nikt poza wlascicielem (wolaja go wylacznie
--      funkcje SECURITY DEFINER).
--   6. RLS `intro_read` (20260731141437:3-12): osoba DOCELOWA czyta tabele
--      wprost wylacznie dla prosb przekazanych (`status = 'forwarded'`).
--      Dotad polityka wpuszczala cel do KAZDEGO wiersza z jego target_id,
--      a `authenticated` ma SELECT na wszystkich kolumnach (20260718215718:92)
--      - zwykle GET /rest/v1/introduction_requests pokazywal celowi prosby
--      odrzucone, wycofane i oczekujace razem z trescia wiadomosci do mostu
--      i decyzja mostu. RPC (rola target) i eksport RODO (wylaczenie
--      `introductions_not_forwarded`) od poczatku obiecywaly, ze cel ich nie
--      widzi; ta polityka czyni obietnice prawdziwa. Proszacy i most bez zmian.
--      Zaden kod aplikacji nie czyta tabeli wprost - trzy funkcje modulu sa
--      SECURITY DEFINER - wiec zmienia sie wylacznie bezposredni odczyt API.
--
-- PRYWATNOSC. Slug i trasa wracaja WYLACZNIE, gdy wolajacy i tak moze otworzyc
-- te osobe (wtedy slug stoi w adresie strony) - nic ponad to, co juz widzi.
-- To nie jest wyrocznia istnienia profili ani roli autora: 'people' to
-- odpowiedz `get_member_profile`, ktore zalogowany wola wprost, a 'author'
-- dotyczy wylacznie osob z publicznym hubem, ktory pokazuje role kazdemu.
--
-- KOSZT. Jedno wywolanie helpera na osobe w wierszu (is_platform_author,
-- profile_has_public_presence, get_member_profile) - trzyma to `OFFSET 0`
-- w podzapytaniach LATERAL; bez niego planer splaszcza podzapytanie i wola
-- helper osobno dla kolumny sluga i kolumny trasy. Listy sa male: wprowadzenia
-- (limit 5 oczekujacych prosb na dobe), rekomendacje profilu, max 100 widzow.
--
-- DLACZEGO DROP + CREATE: zmiana ksztaltu RETURNS TABLE nie przechodzi przez
-- `CREATE OR REPLACE` - wzorzec jak w 20260724120000 i 20260913172000.
--
-- DLACZEGO NOWA PARA, a nie poprawki starych plikow: tamte stoja na
-- produkcji, a repozytorium jest forward-only.
--
-- IDEMPOTENCJA. `CREATE OR REPLACE` helpera, `DROP FUNCTION IF EXISTS` +
-- `CREATE FUNCTION`, REVOKE / GRANT i COMMENT - ponowne zastosowanie daje ten
-- sam stan; bez DDL-a na tabelach i bez przepisywania wierszy.
--
-- ZALEZNOSCI (wszystkie wczesniej w tym pasie): `current_tenant_id()`,
-- `get_member_profile(text)`,
-- `is_platform_author(uuid)` (20260924100000), `profile_has_public_presence`
-- i `public_tenant_id()` (20260806183256 i wczesniej), tabele
-- `introduction_requests`, `profile_recommendations`, `profile_view_events`.
--
-- KOLEJNOSC WDROZENIA. Klient z tej samej zmiany czyta slug i trasa przez
-- `?.`, wiec na bazie bez tej migracji (kolumny `undefined`) karty pokazuja
-- tekst bez linku zamiast martwego adresu; po migracji linki wracaja.
--
-- Testy: supabase/tests/introductions_flow_test.sql,
-- supabase/tests/profile_link_routes_test.sql; komponenty w
-- src/components/network/__tests__/ (IntroductionsCard, RecommendationsSection,
-- ProfileViewsCard).
-- ============================================================================

-- -- 0. Dokad link do osoby doprowadzi wolajacego ----------------------------
CREATE OR REPLACE FUNCTION public._profile_link_route(p_profile_id UUID)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
           WHEN btrim(COALESCE(p.slug, '')) = '' THEN NULL
           WHEN public.is_platform_author(p.id)
            AND p.tenant_id = public.public_tenant_id()
            AND public.profile_has_public_presence(p.id, p.tenant_id)
             THEN 'author'
           WHEN auth.uid() IS NOT NULL
            AND public.get_member_profile(p.slug) ->> 'id' = p.id::text
             THEN 'people'
         END
    FROM public.profiles p
   WHERE p.id = p_profile_id;
$$;

COMMENT ON FUNCTION public._profile_link_route(uuid) IS
  'Dokad link do osoby doprowadzi wolajacego: author (autor z publicznym hubem, '
  'otwiera sie takze bez sesji), people (get_member_profile rozwiazuje te osobe) '
  'albo NULL = nie linkuj. Bramki tras wolane, nie kopiowane. Nigdy UUID.';

REVOKE ALL ON FUNCTION public._profile_link_route(uuid) FROM PUBLIC, anon, authenticated;

-- -- 1. my_introduction_requests ---------------------------------------------
DROP FUNCTION IF EXISTS public.my_introduction_requests(TEXT);
CREATE FUNCTION public.my_introduction_requests(p_role TEXT DEFAULT 'bridge')
RETURNS TABLE (
  id UUID, requester_id UUID, requester_name TEXT, requester_avatar TEXT,
  target_id UUID, target_name TEXT, target_avatar TEXT,
  bridge_id UUID, bridge_name TEXT, bridge_avatar TEXT,
  message TEXT, status TEXT, created_at TIMESTAMPTZ,
  requester_slug TEXT, requester_route TEXT,
  target_slug TEXT, target_route TEXT,
  bridge_slug TEXT, bridge_route TEXT
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  -- Rola spoza trzech nie ma znaczenia: wpadala w `ELSE FALSE` i dawala pusta
  -- liste bez sygnalu. Teraz odmowa - wolajacy widzi blad, nie "brak danych".
  IF p_role IS NULL OR p_role NOT IN ('bridge', 'requester', 'target') THEN
    RAISE EXCEPTION 'invalid introduction role: %', COALESCE(p_role, 'NULL')
      USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT i.id, i.requester_id, pr.display_name, pr.avatar_url,
           i.target_id, pt.display_name, pt.avatar_url,
           i.bridge_id, pb.display_name, pb.avatar_url,
           i.message, i.status, i.created_at,
           CASE WHEN lr.route IS NOT NULL THEN pr.slug END, lr.route,
           CASE WHEN lt.route IS NOT NULL THEN pt.slug END, lt.route,
           CASE WHEN lb.route IS NOT NULL THEN pb.slug END, lb.route
      FROM public.introduction_requests i
      JOIN public.profiles pr ON pr.id = i.requester_id
      JOIN public.profiles pt ON pt.id = i.target_id
      JOIN public.profiles pb ON pb.id = i.bridge_id
      -- OFFSET 0: bez niego planer wciaga podzapytanie do zapytania i wola
      -- helper osobno dla sluga i dla trasy (dwa razy na osobe).
      CROSS JOIN LATERAL (SELECT public._profile_link_route(pr.id) AS route OFFSET 0) lr
      CROSS JOIN LATERAL (SELECT public._profile_link_route(pt.id) AS route OFFSET 0) lt
      CROSS JOIN LATERAL (SELECT public._profile_link_route(pb.id) AS route OFFSET 0) lb
     WHERE CASE p_role
             WHEN 'bridge'    THEN i.bridge_id = auth.uid()
             WHEN 'requester' THEN i.requester_id = auth.uid()
             WHEN 'target'    THEN i.target_id = auth.uid() AND i.status = 'forwarded'
             ELSE FALSE END
     ORDER BY i.created_at DESC;
END; $$;

COMMENT ON FUNCTION public.my_introduction_requests(text) IS
  'Wprowadzenia zalogowanego w jednej roli (bridge / requester / target); inna '
  'wartosc albo NULL -> blad 22023, nie pusta lista. Pary *_slug / *_route: '
  'niepuste wylacznie wtedy, gdy link doprowadzi wolajacego do tej osoby '
  '(_profile_link_route: author albo people); NULL = nie linkuj.';

REVOKE EXECUTE ON FUNCTION public.my_introduction_requests(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_introduction_requests(text) TO authenticated;

-- -- 2. list_recommendations -------------------------------------------------
DROP FUNCTION IF EXISTS public.list_recommendations(UUID);
CREATE FUNCTION public.list_recommendations(p_recipient UUID)
RETURNS TABLE (
  id UUID, author_id UUID, author_name TEXT, author_avatar TEXT,
  author_headline TEXT, relationship TEXT, body TEXT, status TEXT, created_at TIMESTAMPTZ,
  author_slug TEXT, author_route TEXT
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid           UUID := auth.uid();
  v_owner_tenant  UUID;
  v_caller_tenant UUID;
BEGIN
  IF p_recipient IS NULL THEN RETURN; END IF;

  -- Skalowanie tenantem WLASCICIELA profilu: sekcja jest publiczna, wiec
  -- anonimowy czytelnik (bez wiersza w profiles) tez musi zobaczyc
  -- opublikowane rekomendacje.
  SELECT p.tenant_id INTO v_owner_tenant FROM public.profiles p WHERE p.id = p_recipient;
  IF v_owner_tenant IS NULL THEN RETURN; END IF;

  -- Zalogowany czytelnik widzi tylko profile ze swojego tenanta.
  IF v_uid IS NOT NULL THEN
    SELECT p.tenant_id INTO v_caller_tenant FROM public.profiles p WHERE p.id = v_uid;
    IF v_caller_tenant IS DISTINCT FROM v_owner_tenant THEN RETURN; END IF;
  END IF;

  RETURN QUERY
    SELECT r.id, r.author_id, p.display_name, p.avatar_url,
           p.job_title, r.relationship, r.body,
           -- Prywatnosc moderacji: autor nie dowiaduje sie o odmowie/ukryciu -
           -- w jego widoku rekomendacja zostaje "pending".
           CASE
             WHEN r.recipient_id = v_uid THEN r.status
             WHEN r.author_id = v_uid AND r.status IN ('hidden', 'declined') THEN 'pending'
             ELSE r.status
           END AS status,
           r.created_at,
           CASE WHEN la.route IS NOT NULL THEN p.slug END,
           la.route
      FROM public.profile_recommendations r
      JOIN public.profiles p ON p.id = r.author_id
      CROSS JOIN LATERAL (SELECT public._profile_link_route(p.id) AS route OFFSET 0) la
     WHERE r.recipient_id = p_recipient
       AND r.tenant_id = v_owner_tenant
       AND (r.status = 'published' OR r.recipient_id = v_uid OR r.author_id = v_uid)
     ORDER BY r.created_at DESC;
END; $$;

COMMENT ON FUNCTION public.list_recommendations(uuid) IS
  'Rekomendacje profilu skalowane tenantem wlasciciela profilu. Anonim/inny czytelnik: '
  'tylko published. Autor nie widzi hidden/declined (prezentowane jako pending). '
  'author_slug / author_route niepuste wylacznie wtedy, gdy link doprowadzi wolajacego '
  'do autora rekomendacji (_profile_link_route); NULL = nie linkuj.';

-- Sekcja rekomendacji jest czescia publicznego profilu (renderowana takze dla
-- niezalogowanych), wiec odczyt musi byc dostepny dla `anon`.
REVOKE ALL ON FUNCTION public.list_recommendations(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_recommendations(uuid) TO anon, authenticated;

-- -- 3. my_profile_viewers ---------------------------------------------------
DROP FUNCTION IF EXISTS public.my_profile_viewers(INT);
CREATE FUNCTION public.my_profile_viewers(p_limit INT DEFAULT 20)
RETURNS TABLE (
  viewed_at TIMESTAMPTZ, viewer_mode TEXT,
  viewer_id UUID, display_name TEXT, avatar_url TEXT, job_title TEXT, company TEXT,
  viewer_slug TEXT, viewer_route TEXT
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT v.viewed_at, v.viewer_mode, v.viewer_id,
           v.display_name, v.avatar_url, v.job_title, v.company,
           CASE WHEN lv.route IS NOT NULL THEN p.slug END,
           lv.route
      FROM (
        -- Maskowanie i LIMIT najpierw: trasa liczona tylko dla zwracanych
        -- wierszy i tylko dla widza publicznego (zamaskowany viewer_id = NULL
        -- nie dolacza profilu).
        SELECT e.viewed_at, e.viewer_mode,
               CASE WHEN e.viewer_mode = 'public' THEN e.viewer_id END AS viewer_id,
               CASE WHEN e.viewer_mode = 'public' THEN (e.viewer_snapshot->>'display_name') END AS display_name,
               CASE WHEN e.viewer_mode = 'public' THEN (e.viewer_snapshot->>'avatar_url') END AS avatar_url,
               CASE WHEN e.viewer_mode = 'public' THEN (e.viewer_snapshot->>'job_title') END AS job_title,
               CASE WHEN e.viewer_mode = 'public' THEN (e.viewer_snapshot->>'company') END AS company
          FROM public.profile_view_events e
         WHERE e.profile_id = auth.uid()
           AND e.viewer_mode <> 'private'   -- wiersze historyczne (20260913170000)
         ORDER BY e.viewed_at DESC
         LIMIT LEAST(GREATEST(p_limit, 1), 100)
      ) v
      LEFT JOIN public.profiles p ON p.id = v.viewer_id
      LEFT JOIN LATERAL (SELECT public._profile_link_route(p.id) AS route OFFSET 0) lv ON p.id IS NOT NULL
     ORDER BY v.viewed_at DESC;
END; $$;

COMMENT ON FUNCTION public.my_profile_viewers(int) IS
  'Kto ogladal profil wolajacego. Tozsamosc (viewer_id, snapshot) oraz viewer_slug / '
  'viewer_route wylacznie dla viewer_mode = public. viewer_route z _profile_link_route '
  '(author / people); NULL = nie linkuj. Nigdy UUID.';

REVOKE EXECUTE ON FUNCTION public.my_profile_viewers(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_profile_viewers(int) TO authenticated;

-- -- 6. intro_read: cel widzi wprost tylko prosby przekazane -------------------
DROP POLICY IF EXISTS intro_read ON public.introduction_requests;
CREATE POLICY intro_read ON public.introduction_requests
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      (SELECT auth.uid()) = requester_id
      OR (SELECT auth.uid()) = bridge_id
      OR ((SELECT auth.uid()) = target_id AND status = 'forwarded')
    )
  );
