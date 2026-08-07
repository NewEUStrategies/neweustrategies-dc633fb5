-- ============================================================================
-- Discussion Club A13 - wydajnosc odczytu i dwa warunki brzegowe
--
-- Piec pozycji z audytu, kazda zmierzona, nie wywnioskowana.
--
-- 1) club_list liczyl club_capabilities() dla KAZDEGO klubu tenantu.
--    Klucz lateralny rowny c.id jest unikatowy, wiec Memoize nie ma czego
--    zapamietac: 120 klubow to 120 wywolan funkcji, ktora sama robi kilka
--    zapytan. Zmierzone w harnessie: 124 wywolania, 2083 bufory, 22,4 ms na
--    122 zwrocone wiersze - i zapytanie nie ma ani LIMIT, ani kursora.
--    Sedno: `cap.can_read` w WHERE jest potrzebne WYLACZNIE dla klubow
--    'secret'. Dla pozostalych decyduje sama widocznosc, ktora jest w wierszu.
--
-- 2) club_semantic_search sortowal po `e.embedding <=> q.v, t.id`. Drugi klucz
--    sortowania jest dla indeksu HNSW nie do zaspokojenia, wiec plan schodzi
--    z odczytu sasiadow w kolejnosci indeksu na sortowanie calego zbioru -
--    czyli traci sie wlasnie to, po co stawia sie HNSW. Do tego skan szedl po
--    wektorach WSZYSTKICH tenantow, a odsiew robil dopiero LATERAL.
--
-- 3) club_threads_refresh_hotness wolal club_thread_quality_score(a.id) oraz
--    policzenie stanowisk PER WIERSZ. Przy p_limit = 1000 to dwa tysiace
--    skorelowanych podzapytan w jednym tiku harmonogramu, co piec minut.
--
-- 4) admin_club_moderation_queue nie mial LIMIT i zwracal pelne tresci
--    (do 20 000 znakow na watek). Ta sama klasa problemu, ktora A8 nazwalo
--    wektorem DoS przy club_replies_list - tylko nienaprawiona.
--
-- 5) Kursor listy tematow jest tekstowy: to_char(hotness, 'FM0000000000.0000000000').
--    Empiryczny spacer po 2004 tematach potwierdzil, ze dla wartosci
--    nieujemnych porzadek leksykalny = porzadek liczbowy. Ale dla hotness < 0
--    prefiks '-' (45) sortuje sie PRZED '0' (48), wiec porzadek sie odwraca,
--    a od 1e10 klucz zmienia szerokosc i porownanie przestaje byc spojne.
--    Dzis zaden kod nie zapisuje takiej wartosci - i wlasnie dlatego warto to
--    przybic CHECK-iem, zanim ktos to zrobi.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) club_list: tania bramka najpierw, zdolnosci tylko dla strony
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_list(
  p_limit  integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid, slug text, name_pl text, name_en text,
  tagline_pl text, tagline_en text, icon text, accent_color text,
  cover_image_url text, visibility text, join_policy text,
  min_tier_rank integer, policy_area text, status text,
  member_count integer, group_count integer, thread_count integer,
  last_activity_at timestamptz,
  my_role text, my_status text, can_read boolean,
  total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (SELECT p.id AS uid, p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()),
  scope AS (
    SELECT COALESCE((SELECT tenant_id FROM me), public.public_tenant_id()) AS tenant_id
  ),
  -- Bramka BEZ wywolania club_capabilities. Zdolnosci sa potrzebne wylacznie
  -- do rozstrzygniecia klubu 'secret', a to samo rozstrzyga LEFT JOIN na
  -- aktywnym czlonkostwie plus rola platformowa - jedno i drugie mamy tu za
  -- darmo, bo zlaczenie i tak jest potrzebne do kolumny my_role.
  visible AS (
    SELECT c.*, m.role AS m_role, m.role_expires_at AS m_expires, m.status AS m_status,
           (m.user_id IS NOT NULL) AS is_member,
           count(*) OVER () AS total
      FROM public.clubs c
      CROSS JOIN scope s
      LEFT JOIN public.club_members m
        ON m.club_id = c.id AND m.user_id = auth.uid() AND m.status = 'active'
     WHERE c.tenant_id = s.tenant_id
       AND c.status = 'active'
       AND (
         c.visibility IN ('public', 'members', 'private')
         OR m.user_id IS NOT NULL
         OR public.is_club_admin(auth.uid())
       )
       AND (auth.uid() IS NOT NULL OR c.visibility = 'public')
     ORDER BY (m.user_id IS NOT NULL) DESC, c.last_activity_at DESC NULLS LAST,
              lower(c.name_pl) ASC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  )
  SELECT
    v.id, v.slug, v.name_pl, v.name_en, v.tagline_pl, v.tagline_en,
    v.icon, v.accent_color, v.cover_image_url, v.visibility, v.join_policy,
    v.min_tier_rank, v.policy_area, v.status,
    v.member_count, v.group_count, v.thread_count, v.last_activity_at,
    public.club_effective_member_role(v.m_role, v.m_expires),
    v.m_status,
    cap.can_read,
    v.total
  FROM visible v
  -- LATERAL dopiero tutaj: liczy sie dla JEDNEJ STRONY, nie dla calego tenantu.
  CROSS JOIN LATERAL public.club_capabilities(v.id, NULL, auth.uid()) cap
  ORDER BY v.is_member DESC, v.last_activity_at DESC NULLS LAST, lower(v.name_pl) ASC
$$;

COMMENT ON FUNCTION public.club_list(integer, integer) IS
  'Lista klubow widocznych dla wolajacego. Bramka widocznosci nie wola club_capabilities - zdolnosci licza sie LATERAL dopiero dla zwroconej strony, bo klucz lateralny rowny id klubu jest unikatowy i Memoize nie ma czego zapamietac.';

REVOKE EXECUTE ON FUNCTION public.club_list(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_list(integer, integer)
  TO anon, authenticated, service_role;

-- Bezargumentowa wersja znika: przeciazenie rozstrzygane po liczbie argumentow
-- to cicha pulapka przy nastepnej edycji.
DROP FUNCTION IF EXISTS public.club_list();

-- ----------------------------------------------------------------------------
-- 2) club_semantic_search: sortowanie, ktore indeks HNSW umie zaspokoic
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_semantic_search(
  p_embedding double precision[],
  p_club_id   uuid DEFAULT NULL,
  p_limit     integer DEFAULT 20,
  p_threshold real DEFAULT 0.25
)
RETURNS TABLE (
  thread_id uuid, club_id uuid, club_slug text, club_name_pl text, club_name_en text,
  thread_slug text, title text, kind text,
  reply_count integer, last_reply_at timestamptz, similarity real
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH q AS (
    SELECT (p_embedding::extensions.vector(768)) AS v
     WHERE p_embedding IS NOT NULL AND array_length(p_embedding, 1) = 768
  ),
  scope AS (
    SELECT COALESCE(
      (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()),
      public.public_tenant_id()
    ) AS tenant_id
  )
  SELECT
    t.id, t.club_id, c.slug, c.name_pl, c.name_en,
    t.slug, t.title, t.kind, t.reply_count, t.last_reply_at,
    (1 - (e.embedding <=> q.v))::real AS similarity
  FROM public.club_thread_embeddings e
  CROSS JOIN q
  CROSS JOIN scope s
  JOIN public.club_threads t ON t.id = e.thread_id
  JOIN public.clubs c ON c.id = t.club_id
  JOIN public.club_groups g ON g.id = t.group_id
  CROSS JOIN LATERAL public.club_capabilities(t.club_id, t.group_id, auth.uid()) cap
  -- Zawezenie PRZED wejsciem w sasiedztwo wektorowe: bez tego skan szedl po
  -- wektorach wszystkich tenantow, a odsiew robil dopiero LATERAL.
  WHERE e.tenant_id = s.tenant_id
    AND cap.can_read
    AND t.status IN ('open', 'resolved', 'dormant', 'locked')
    AND (g.status NOT IN ('draft', 'archived') OR cap.can_manage)
    AND (p_club_id IS NULL OR t.club_id = p_club_id)
    -- Prog podobienstwa odsiewa "najblizszych z dalekich": bez niego kazde
    -- zapytanie zwraca limit wynikow, takze wtedy, gdy zaden nie pasuje.
    AND (1 - (e.embedding <=> q.v)) >= COALESCE(p_threshold, 0.25)
  -- JEDEN klucz sortowania. Drugi (t.id) wygladal na zabezpieczenie przed
  -- niestabilnym porzadkiem, ale unikalnosc daje juz klucz glowny
  -- club_thread_embeddings.thread_id, a dla HNSW byl to koszt bez zysku:
  -- plan schodzil z odczytu sasiadow w kolejnosci indeksu na sortowanie.
  ORDER BY e.embedding <=> q.v
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
$$;

REVOKE EXECUTE ON FUNCTION public.club_semantic_search(double precision[], uuid, integer, real)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_semantic_search(double precision[], uuid, integer, real)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3) Ranking liczony wsadowo
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_threads_refresh_hotness(p_limit integer DEFAULT 1000)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH active AS (
    SELECT id, reply_count, participant_count, created_at
      FROM public.club_threads
     WHERE status IN ('open', 'resolved')
     ORDER BY last_reply_at DESC NULLS LAST
     LIMIT GREATEST(COALESCE(p_limit, 1000), 1)
  ),
  -- Reakcje jakosciowe policzone wsadowo, ale DWOMA agregatami, nie jednym
  -- zlaczeniem. Kuszaca wersja z jednym LEFT JOIN po club_replies i drugim po
  -- club_reactions z warunkiem OR daje ILOCZYN KARTEZJANSKI: watek z pieciona
  -- odpowiedziami i jedna reakcja NA SAM WATEK policzylby te reakcje piec
  -- razy. Rozdzielenie po target_type usuwa problem u zrodla i trafia w oba
  -- indeksy zamiast wymuszac zlaczenie po warunku OR.
  react_thread AS (
    SELECT a.id, count(*)::int AS n
      FROM active a
      JOIN public.club_reactions r
        ON r.target_type = 'thread' AND r.target_id = a.id
       AND r.kind IN ('insightful', 'evidence')
     GROUP BY a.id
  ),
  react_reply AS (
    SELECT rep.thread_id AS id, count(*)::int AS n
      FROM active a
      JOIN public.club_replies rep ON rep.thread_id = a.id
      JOIN public.club_reactions r
        ON r.target_type = 'reply' AND r.target_id = rep.id
       AND r.kind IN ('insightful', 'evidence')
     GROUP BY rep.thread_id
  ),
  stances AS (
    SELECT a.id, count(s.id)::int AS cnt
      FROM active a
      LEFT JOIN public.club_stances s ON s.thread_id = a.id
     GROUP BY a.id
  )
  UPDATE public.club_threads t
     SET hotness = public.club_thread_hotness(
           COALESCE(rt.n, 0) + COALESCE(rr.n, 0),
           a.reply_count, a.participant_count,
           COALESCE(st.cnt, 0), a.created_at)
    FROM active a
    LEFT JOIN react_thread rt ON rt.id = a.id
    LEFT JOIN react_reply  rr ON rr.id = a.id
    LEFT JOIN stances st ON st.id = a.id
   WHERE t.id = a.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_threads_refresh_hotness(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_threads_refresh_hotness(integer) TO service_role;

-- ----------------------------------------------------------------------------
-- 4) Kolejka moderacji: strona zamiast calosci, podglad zamiast pelnej tresci
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_club_moderation_queue(uuid);

CREATE FUNCTION public.admin_club_moderation_queue(
  p_club_id uuid,
  p_limit   integer DEFAULT 50,
  p_offset  integer DEFAULT 0
)
RETURNS TABLE (
  target_type text, target_id uuid, thread_slug text, title text,
  body text, author_name text, is_anonymous boolean, created_at timestamptz,
  total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH guard AS (
    SELECT 1 FROM public.clubs c
     WHERE c.id = p_club_id
       AND c.tenant_id = public.current_tenant_id()
       AND public.is_club_admin(auth.uid())
  ),
  items AS (
    SELECT 'thread'::text AS target_type, t.id AS target_id, t.slug AS thread_slug,
           t.title,
           -- Podglad, nie pelna tresc: moderator decyduje z listy, a pelny
           -- watek otwiera w podgladzie. Dwadziescia tysiecy znakow razy
           -- rozmiar kolejki bylo tu wektorem DoS - tak samo jak w liscie
           -- odpowiedzi, ktora A8 juz z tego powodu ograniczylo.
           left(t.body, 500) AS body,
           CASE WHEN t.is_anonymous
                  OR COALESCE(g.attribution_mode, cl.attribution_mode) = 'chatham'
                THEN NULL
                ELSE COALESCE(NULLIF(btrim(p.display_name), ''), 'User') END AS author_name,
           (t.is_anonymous OR COALESCE(g.attribution_mode, cl.attribution_mode) = 'chatham')
             AS is_anonymous,
           t.created_at
      FROM public.club_threads t
      JOIN public.clubs cl ON cl.id = t.club_id
      JOIN public.club_groups g ON g.id = t.group_id
      LEFT JOIN public.profiles p ON p.id = t.author_id
     WHERE t.club_id = p_club_id AND t.status = 'pending'
       AND EXISTS (SELECT 1 FROM guard)
    UNION ALL
    SELECT 'reply'::text, r.id, t.slug, t.title,
           left(r.body, 500),
           CASE WHEN r.is_anonymous
                  OR COALESCE(g.attribution_mode, cl.attribution_mode) = 'chatham'
                THEN NULL
                ELSE COALESCE(NULLIF(btrim(p.display_name), ''), 'User') END,
           (r.is_anonymous OR COALESCE(g.attribution_mode, cl.attribution_mode) = 'chatham'),
           r.created_at
      FROM public.club_replies r
      JOIN public.club_threads t ON t.id = r.thread_id
      JOIN public.clubs cl ON cl.id = t.club_id
      JOIN public.club_groups g ON g.id = t.group_id
      LEFT JOIN public.profiles p ON p.id = r.author_id
     WHERE r.club_id = p_club_id AND r.status = 'pending'
       AND EXISTS (SELECT 1 FROM guard)
  )
  SELECT i.*, count(*) OVER () AS total_count
    FROM items i
   ORDER BY i.created_at ASC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$$;

COMMENT ON FUNCTION public.admin_club_moderation_queue(uuid, integer, integer) IS
  'Kolejka premoderacji, stronicowana. Autor wpisu anonimowego NIE jest tu ujawniany - od tego jest club_moderator_reveal_author. Tresc jest przycieta do 500 znakow: kolejka sluzy do decyzji, nie do czytania.';

REVOKE EXECUTE ON FUNCTION public.admin_club_moderation_queue(uuid, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_moderation_queue(uuid, integer, integer)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5) Zakres rankingu przybity CHECK-iem
--
-- Kursor listy tematow jest kluczem TEKSTOWYM o stalej szerokosci. Dla
-- hotness >= 0 i < 1e10 porzadek leksykalny pokrywa sie z liczbowym - to
-- zostalo zmierzone spacerem po 2004 tematach. Poza tym zakresem klucz klamie:
-- '-' sortuje sie przed '0', a od 1e10 zmienia sie szerokosc. Dzis nic takiej
-- wartosci nie zapisuje, ale to jest wlasnie moment, w ktorym warto to przybic
-- - inwariant kursora nie moze zalezec od tego, ze nikt nie zmieni wzoru.
-- ----------------------------------------------------------------------------
UPDATE public.club_threads SET hotness = 0 WHERE hotness < 0;
UPDATE public.club_threads SET hotness = 9999999999 WHERE hotness >= 1e10;

ALTER TABLE public.club_threads DROP CONSTRAINT IF EXISTS club_threads_hotness_range;
ALTER TABLE public.club_threads
  ADD CONSTRAINT club_threads_hotness_range CHECK (hotness >= 0 AND hotness < 1e10);

COMMENT ON CONSTRAINT club_threads_hotness_range ON public.club_threads IS
  'Zakres wymuszony przez TEKSTOWY kursor listy tematow: to_char(hotness, FM0000000000.0000000000) zachowuje porzadek wylacznie dla wartosci nieujemnych o stalej szerokosci.';
