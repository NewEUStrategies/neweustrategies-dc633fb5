-- ============================================================================
-- Kluby dyskusyjne - etap A15: strona glowna (hub)
--
-- PROBLEM. /club jest dzis PLASKA LISTA kart. Zeby dowiedziec sie, czy w
-- klubach cokolwiek sie dzieje, trzeba wejsc do kazdego z osobna. Dla osoby,
-- ktora nalezy do jednego klubu, a moglaby nalezec do czterech, to jest
-- struktura, ktora aktywnie ukrywa powod, zeby zostac.
--
-- Hub potrzebuje JEDNEJ rzeczy, ktorej baza jeszcze nie umie: strumienia
-- aktywnosci PONAD klubami. Reszta modulow (moje kluby, zaproszenia, podzial
-- na obszary polityki, liczniki) liczy sie z `club_list` i `club_my_*`, ktore
-- juz istnieja - dokladanie do nich RPC byloby dokladaniem powierzchni bez
-- powodu.
--
-- DLACZEGO TO NIE JEST `club_threads_list` BEZ `p_club_id`. Kuszace i zle:
--
--   1. Anonimowosc jest wlasnoscia KLUBU (albo grupy), nie zapytania. Strumien
--      miesza watki z klubu 'attributed' i 'chatham' w jednej liscie, wiec
--      projekcja autora musi rozstrzygac sie per WIERSZ. Doklejenie tego do
--      istniejacej listy zamienilo by jej najwazliwszy CASE w gaszcz.
--   2. Ta funkcja nie zwraca `author_id` W OGOLE - ani dla 'attributed'. Hub
--      jest powierzchnia ODKRYWANIA; do niczego tam identyfikator nie jest
--      potrzebny, a czego nie ma w zwrotce, tego nie da sie wyciec.
--   3. Kursor jest bez sensu: hub pokazuje kilkanascie pozycji i odsyla do
--      klubu. Paginacja strumienia miedzyklubowego to zaproszenie do budowania
--      drugiego czytnika obok tego, ktory juz mamy.
--
-- KOSZT DOSTEPU. `club_capabilities` wola sie raz na PARE (klub, grupa)
-- widocznych klubow, nie raz na watek. Kandydaci sa dodatkowo obciete do 50
-- najswiezszych klubow, wiec gorny pulap wywolan jest staly i nie zalezy od
-- tego, ile watkow ma tenant. Zejscie ponizej tego wymagaloby zdublowania
-- regul dostepu w SQL-u zapytania - a jedno zrodlo prawdy o dostepie jest
-- warte wiecej niz te wywolania.
-- ============================================================================

-- Sort "gorace" w obrebie grupy - odpowiednik club_threads_group_idx dla
-- rankingu. Bez niego LATERAL po grupie sortuje sie przez sortowanie zbioru.
CREATE INDEX IF NOT EXISTS club_threads_group_hot_idx
  ON public.club_threads (group_id, status, hotness DESC, id DESC);

DROP FUNCTION IF EXISTS public.club_activity_feed(integer, text, text, integer);

CREATE FUNCTION public.club_activity_feed(
  p_limit integer DEFAULT 12,
  p_sort text DEFAULT 'new',
  p_policy_area text DEFAULT NULL,
  p_per_club integer DEFAULT 3
)
RETURNS TABLE (
  thread_id uuid, thread_slug text, title text, kind text, status text,
  excerpt text,
  club_id uuid, club_slug text, club_name_pl text, club_name_en text,
  club_policy_area text, club_cover_image_url text,
  group_name_pl text, group_name_en text,
  is_anonymous boolean, author_name text, author_alias text,
  reply_count integer, participant_count integer,
  last_reply_at timestamptz, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH lim AS (
    SELECT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 30) AS n,
           LEAST(GREATEST(COALESCE(p_per_club, 3), 1), 10) AS per_club
  ),
  scope AS (
    SELECT COALESCE(
      (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()),
      public.public_tenant_id()
    ) AS tenant_id
  ),
  -- Tania bramka wstepna - ta sama, co w club_list. Klub 'secret' odpada tu
  -- juz na poziomie zlaczenia, wiec nie trafia nawet do club_capabilities.
  candidate AS (
    SELECT c.id, c.slug, c.name_pl, c.name_en, c.policy_area, c.cover_image_url,
           c.attribution_mode
      FROM public.clubs c
      CROSS JOIN scope s
      LEFT JOIN public.club_members m
        ON m.club_id = c.id AND m.user_id = auth.uid() AND m.status = 'active'
     WHERE c.tenant_id = s.tenant_id
       AND c.status = 'active'
       AND (p_policy_area IS NULL OR c.policy_area = p_policy_area)
       AND (c.visibility <> 'secret'
            OR m.user_id IS NOT NULL
            OR public.is_club_admin(auth.uid()))
     ORDER BY c.last_activity_at DESC NULLS LAST
     LIMIT 50
  ),
  -- Zdolnosci liczone per (klub, grupa), bo grupa moze zaostrzyc prog planu
  -- albo widocznosc ponad klub. Bez pary funkcja pokazywalaby watki z grupy
  -- zamknietej dla wolajacego.
  readable AS (
    SELECT c.id AS club_id, c.slug AS club_slug, c.name_pl AS club_pl,
           c.name_en AS club_en, c.policy_area, c.cover_image_url,
           g.id AS group_id, g.name_pl AS group_pl, g.name_en AS group_en,
           COALESCE(g.attribution_mode, c.attribution_mode) AS attribution
      FROM candidate c
      JOIN public.club_groups g ON g.club_id = c.id
      CROSS JOIN LATERAL public.club_capabilities(c.id, g.id, auth.uid()) cap
     WHERE cap.can_read
       AND (g.status NOT IN ('draft', 'archived') OR cap.can_manage)
  ),
  picked AS (
    SELECT r.*, t.id AS t_id, t.slug AS t_slug, t.title, t.kind, t.status,
           t.body, t.is_anonymous, t.author_id,
           t.reply_count, t.participant_count,
           t.last_reply_at, t.created_at, t.hotness
      FROM readable r
      CROSS JOIN lim
      JOIN LATERAL (
        SELECT t.*
          FROM public.club_threads t
         WHERE t.group_id = r.group_id
           -- Watki 'pending' i 'removed' nie naleza do powierzchni odkrywania
           -- nawet dla moderatora: kolejka moderacyjna ma wlasny widok, a hub
           -- ma pokazywac dyskusje, nie prace do wykonania.
           AND t.status IN ('open', 'resolved', 'dormant', 'locked')
         ORDER BY
           CASE WHEN p_sort = 'hot' THEN t.hotness END DESC NULLS LAST,
           CASE WHEN p_sort = 'hot' THEN NULL
                ELSE COALESCE(t.last_reply_at, t.created_at) END DESC NULLS LAST,
           t.id DESC
         -- per_club, nie n: skoro z klubu i tak wyjdzie najwyzej per_club
         -- wierszy, to najlepsze per_club z KAZDEJ jego grupy zawiera
         -- najlepsze per_club calego klubu. Ciagniecie wiecej byloby praca
         -- na wyrzucenie.
         LIMIT lim.per_club
      ) t ON true
  ),
  -- Dlawik rownowagi. Bez niego jeden ruchliwy klub zajmuje CALA liste, a hub
  -- przestaje robic to jedno, po co powstal: pokazywac, ze zyje wiecej niz
  -- jeden klub. Wykryte testem - pierwsza wersja zwracala trzydziesci watkow
  -- z tego samego klubu i wygladala na poprawna.
  ranked AS (
    SELECT k.*, row_number() OVER (
             PARTITION BY k.club_id
             ORDER BY
               CASE WHEN p_sort = 'hot' THEN k.hotness END DESC NULLS LAST,
               CASE WHEN p_sort = 'hot' THEN NULL
                    ELSE COALESCE(k.last_reply_at, k.created_at) END DESC NULLS LAST,
               k.t_id DESC
           ) AS rn
      FROM picked k
  )
  SELECT
    k.t_id, k.t_slug, k.title, k.kind, k.status,
    left(k.body, 200),
    k.club_id, k.club_slug, k.club_pl, k.club_en,
    k.policy_area, k.cover_image_url,
    k.group_pl, k.group_en,
    k.is_anonymous,
    -- Ta sama regula projekcji, co w club_threads_list: nazwisko wychodzi
    -- WYLACZNIE gdy watek nie jest anonimowy i klub nie dziala w regule
    -- Chatham House. Inaczej wychodzi pseudonim solony per tenant.
    CASE WHEN k.is_anonymous OR k.attribution = 'chatham' THEN NULL
         ELSE COALESCE(NULLIF(btrim(p.display_name), ''),
                       NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
                       'User') END,
    CASE WHEN k.is_anonymous OR k.attribution = 'chatham'
         THEN public.club_author_alias(k.t_id, k.author_id) ELSE NULL END,
    k.reply_count, k.participant_count,
    k.last_reply_at, k.created_at
  FROM ranked k
  LEFT JOIN public.profiles p ON p.id = k.author_id
  WHERE k.rn <= (SELECT per_club FROM lim)
  ORDER BY
    CASE WHEN p_sort = 'hot' THEN k.hotness END DESC NULLS LAST,
    CASE WHEN p_sort = 'hot' THEN NULL
         ELSE COALESCE(k.last_reply_at, k.created_at) END DESC NULLS LAST,
    k.t_id DESC
  LIMIT (SELECT n FROM lim)
$$;

COMMENT ON FUNCTION public.club_activity_feed(integer, text, text, integer) IS
  'Strumien aktywnosci PONAD klubami dla strony glownej klubow. Nie zwraca author_id w zadnym trybie - hub jest powierzchnia odkrywania, a czego nie ma w zwrotce, tego nie da sie wyciec. Anonimowosc rozstrzyga sie per wiersz, bo strumien miesza kluby o roznym trybie atrybucji. p_per_club dlawi udzial jednego klubu - bez tego jeden ruchliwy klub zajmuje cala liste i hub przestaje pokazywac szerokosc.';

REVOKE EXECUTE ON FUNCTION public.club_activity_feed(integer, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_activity_feed(integer, text, text, integer)
  TO anon, authenticated, service_role;
