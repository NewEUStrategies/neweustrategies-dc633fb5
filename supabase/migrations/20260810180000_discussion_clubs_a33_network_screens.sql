-- ============================================================================
-- A33: PELNE WIDOKI MODULOW SIECIUJACYCH
--
-- A32 dolozyl piec modulow do prawej szyny huba. Szyna jest z definicji
-- STRESZCZENIEM: trzy ogloszenia z osmiu, szesc twarzy z czterdziestu, jeden
-- czlonek tygodnia bez historii. Kazdy z tych modulow ma teraz wlasna trase
-- wewnatrz klubu i potrzebuje danych, ktorych streszczenie nie zbiera:
-- paginacji, filtrow, archiwum i pojedynczego wiersza po slugu.
--
-- ZASADA: rozszerzamy istniejace RPC tam, gdzie pytanie jest TO SAMO i zmienia
-- sie tylko zakres (ogloszenia, dorobek), a dokladamy nowe tam, gdzie pytanie
-- jest INNE (katalog ekspertow, archiwum przedstawien, pojedyncze spotkanie).
-- Dublowanie funkcji "to samo, ale wiecej wierszy" konczy sie dwoma bramkami
-- dostepu do tych samych danych, ktore rozjada sie przy pierwszej zmianie.
--
-- ZMIANA SYGNATURY = DROP + CREATE. Dwa przeciazenia tej samej nazwy roznia
-- sie dla PostgREST wylacznie zestawem kluczy w ciele zadania, a pominiety
-- klucz z wartoscia domyslna czyni wybor niejednoznacznym. DROP-ujemy takze
-- NOWA sygnature - wyglada na zbedny, ale bez niego odtworzenie bazy OD ZERA
-- pada z 42723: platforma zapisuje przy wdrozeniu wlasna kopie tego pliku,
-- wiec ten sam CREATE wykonuje sie w replayu dwa razy.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) OGLOSZENIA: zakres "moje" i archiwum
--
-- Szyna pokazuje wylacznie otwarte i niewygasle - i tak ma zostac. Pelna
-- tablica potrzebuje dwoch rzeczy wiecej: mojej historii (co juz zalatwilem)
-- i mozliwosci obejrzenia wygaslych, bo autor po miesiacu pyta "czy to
-- ogloszenie w ogole wisialo".
--
-- `status` i `closed_at` wchodza do projekcji, bo bez nich interfejs nie
-- odroznilby "zalatwione" od "wygaslo" - a to sa dwa rozne konce ogloszenia
-- i tylko pierwszy jest sukcesem.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.club_board_notices_list(uuid, text, text, integer, integer);
DROP FUNCTION IF EXISTS public.club_board_notices_list(uuid, text, text, integer, integer, boolean, boolean);

CREATE FUNCTION public.club_board_notices_list(
  p_club_id        uuid,
  p_kind           text    DEFAULT NULL,
  p_topic          text    DEFAULT NULL,
  p_limit          integer DEFAULT 8,
  p_offset         integer DEFAULT 0,
  p_mine           boolean DEFAULT false,
  p_include_closed boolean DEFAULT false
)
RETURNS TABLE (
  id uuid, kind text, body text, topic text,
  author_id uuid, author_name text, author_avatar text, author_slug text,
  author_headline text,
  created_at timestamptz, expires_at timestamptz,
  status text, closed_at timestamptz, is_expired boolean,
  is_mine boolean, can_close boolean, total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH cap AS (
    SELECT * FROM public.club_capabilities(p_club_id, NULL, auth.uid())
  ),
  visible AS (
    SELECT n.*
      FROM public.club_board_notices n
     CROSS JOIN cap
     WHERE n.club_id = p_club_id
       AND cap.can_read
       AND (NOT COALESCE(p_mine, false) OR n.author_id = auth.uid())
       AND (
         CASE
           WHEN COALESCE(p_include_closed, false)
             -- Zdjete przez moderacje widzi autor i moderacja - nikt wiecej.
             THEN (n.status <> 'removed' OR cap.can_moderate OR n.author_id = auth.uid())
           ELSE (n.status = 'open' AND n.expires_at > now())
         END
       )
       AND (p_kind IS NULL OR n.kind = p_kind)
       AND (p_topic IS NULL OR n.topic = p_topic)
  )
  SELECT
    v.id, v.kind, v.body, v.topic,
    v.author_id,
    COALESCE(NULLIF(btrim(p.display_name), ''),
             NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'User'),
    CASE WHEN p.hide_avatar THEN NULL ELSE p.avatar_url END,
    p.slug,
    NULLIF(btrim(concat_ws(' - ', NULLIF(btrim(p.job_title), ''),
                                  NULLIF(btrim(p.current_company), ''))), ''),
    v.created_at, v.expires_at,
    v.status, v.closed_at, (v.expires_at <= now()),
    v.author_id = auth.uid(),
    (v.author_id = auth.uid() OR cap.can_moderate),
    count(*) OVER ()
  FROM visible v
  CROSS JOIN cap
  JOIN public.profiles p ON p.id = v.author_id
  -- Otwarte przed zamknietymi, potem najnowsze. Archiwum ma byc archiwum,
  -- a nie miejscem, w ktorym zalatwione ogloszenie zaslania aktualne.
  ORDER BY (v.status = 'open' AND v.expires_at > now()) DESC, v.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 8), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$$;

COMMENT ON FUNCTION public.club_board_notices_list(uuid, text, text, integer, integer, boolean, boolean) IS
  'Ogloszenia klubu. Domyslnie otwarte i niewazne - `p_include_closed` otwiera archiwum, `p_mine` zaweza do wolajacego. Waznosc odsiewana przy odczycie.';

REVOKE EXECUTE ON FUNCTION public.club_board_notices_list(uuid, text, text, integer, integer, boolean, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_board_notices_list(uuid, text, text, integer, integer, boolean, boolean)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2) DOROBEK: paginacja
--
-- Szyna bierze cztery pozycje, strona - dwadziescia na raz i schodzi dalej.
-- `total_count` liczy sie w oknie PRZED limitem, wiec licznik nad lista mowi
-- o CALYM dorobku, a nie o biezacej stronie.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.club_output_list(uuid, integer);
DROP FUNCTION IF EXISTS public.club_output_list(uuid, integer, integer);

CREATE FUNCTION public.club_output_list(
  p_club_id uuid,
  p_limit   integer DEFAULT 4,
  p_offset  integer DEFAULT 0
)
RETURNS TABLE (
  id uuid, slug text, title_pl text, title_en text,
  summary_pl text, summary_en text, kind text,
  file_url text, external_url text, published_at timestamptz,
  thread_id uuid, thread_slug text, thread_title text,
  contributor_count integer, contributors jsonb, total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH cap AS (
    SELECT * FROM public.club_capabilities(p_club_id, NULL, auth.uid())
  ),
  club AS (
    SELECT c.id, c.attribution_mode FROM public.clubs c WHERE c.id = p_club_id
  ),
  products AS (
    SELECT d.*
      FROM public.club_documents d
     CROSS JOIN cap
     WHERE d.club_id = p_club_id
       AND cap.can_read
       AND d.status = 'published'
       AND (d.visibility = 'club' OR cap.can_moderate)
       AND d.kind IN ('discussion_note', 'policy_brief', 'scenario', 'memo',
                      'research_agenda', 'public_insight', 'decision_memo')
  ),
  ranked AS (
    SELECT p.*, count(*) OVER () AS total_count
      FROM products p
     -- Produkt z rozmowa przed produktem bez rozmowy: panel mowi o tym, co
     -- powstalo ze WSPOLNEJ pracy, wiec taki wlasnie ma stac na gorze.
     ORDER BY (p.thread_id IS NOT NULL) DESC,
              COALESCE(p.published_at, p.created_at) DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 4), 1), 50)
     OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  )
  SELECT
    r.id, r.slug, r.title_pl, r.title_en, r.summary_pl, r.summary_en, r.kind,
    r.file_url, r.external_url, COALESCE(r.published_at, r.created_at),
    r.thread_id, t.slug, t.title,
    COALESCE(co.people, 0)::int,
    CASE
      WHEN club.attribution_mode = 'chatham' OR NOT cap.can_see_members THEN '[]'::jsonb
      ELSE COALESCE(co.faces, '[]'::jsonb)
    END,
    r.total_count
  FROM ranked r
  CROSS JOIN cap
  CROSS JOIN club
  LEFT JOIN public.club_threads t ON t.id = r.thread_id
  LEFT JOIN LATERAL (
    SELECT
      count(*)::int AS people,
      jsonb_agg(jsonb_build_object(
        'user_id', a.author_id,
        'name',    COALESCE(NULLIF(btrim(pr.display_name), ''), 'User'),
        'avatar_url', CASE WHEN pr.hide_avatar THEN NULL ELSE pr.avatar_url END,
        'slug',    pr.slug
      ) ORDER BY a.first_at) AS faces
    FROM (
      SELECT author_id, min(created_at) AS first_at
        FROM (
          SELECT th.author_id, th.created_at
            FROM public.club_threads th
           WHERE th.id = r.thread_id AND th.author_id IS NOT NULL AND NOT th.is_anonymous
          UNION ALL
          SELECT rp.author_id, rp.created_at
            FROM public.club_replies rp
           WHERE rp.thread_id = r.thread_id AND rp.author_id IS NOT NULL
             AND NOT rp.is_anonymous AND rp.status = 'visible'
        ) src
       GROUP BY author_id
       ORDER BY min(created_at)
       LIMIT 8
    ) a
    JOIN public.profiles pr ON pr.id = a.author_id
  ) co ON true
  ORDER BY (r.thread_id IS NOT NULL) DESC, COALESCE(r.published_at, r.created_at) DESC
$$;

COMMENT ON FUNCTION public.club_output_list(uuid, integer, integer) IS
  'Dorobek klubu jako wynik wspolnych rozmow: produkt + dyskusja, z ktorej wyrosl, + jej uczestnicy. Regula Chatham House kasuje twarze, produkt zostaje.';

REVOKE EXECUTE ON FUNCTION public.club_output_list(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_output_list(uuid, integer, integer) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3) KATALOG EKSPERTOW KLUBU
--
-- `club_thread_experts` odpowiada na pytanie WATKU ("kto zna sie na tym, o czym
-- tu mowa"). To jest inne pytanie niz pytanie KLUBU ("kto tu sie na czym zna")
-- i inny zbior: tam wchodzi tylko obszar watku i wychodzi szesc osob, tutaj
-- wchodzi caly katalog obszarow i wychodzi lista z paginacja.
--
-- Do kazdej osoby dokladamy DOROBEK W KLUBIE - liczbe watkow i odpowiedzi.
-- Deklaracja bez sladu pracy jest deklaracja; deklaracja obok trzydziestu
-- wypowiedzi w tym obszarze jest argumentem. Katalog, ktory tego nie pokazuje,
-- zamienia sie w liste checkboxow.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.club_experts_list(uuid, text, text, integer, integer);

CREATE FUNCTION public.club_experts_list(
  p_club_id uuid,
  p_topic   text    DEFAULT NULL,
  p_search  text    DEFAULT NULL,
  p_limit   integer DEFAULT 24,
  p_offset  integer DEFAULT 0
)
RETURNS TABLE (
  user_id uuid, display_name text, avatar_url text, profile_slug text,
  headline text, club_role text, topics text[],
  joined_at timestamptz, last_active_at timestamptz,
  thread_count integer, reply_count integer, total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH cap AS (
    SELECT * FROM public.club_capabilities(p_club_id, NULL, auth.uid())
  ),
  declared AS (
    SELECT
      m.user_id,
      m.joined_at,
      public.club_effective_member_role(m.role, m.role_expires_at) AS club_role,
      array_agg(DISTINCT e.topic ORDER BY e.topic) AS topics
      FROM public.club_member_expertise e
      CROSS JOIN cap
      JOIN public.club_members m
        ON m.club_id = e.club_id AND m.user_id = e.user_id AND m.status = 'active'
      JOIN public.profiles p ON p.id = m.user_id
     WHERE e.club_id = p_club_id
       AND cap.can_read
       AND cap.can_see_members
       AND (p.discoverable OR m.user_id = auth.uid())
       -- Zawezenie po obszarze musi patrzec na CALY zbior deklaracji tej
       -- osoby, a nie na wiersz po agregacji - stad EXISTS, nie filtr na `e`.
       AND (p_topic IS NULL OR EXISTS (
         SELECT 1 FROM public.club_member_expertise e2
          WHERE e2.club_id = p_club_id AND e2.user_id = m.user_id AND e2.topic = p_topic
       ))
       AND (
         NULLIF(btrim(COALESCE(p_search, '')), '') IS NULL
         OR COALESCE(p.display_name, '') ILIKE '%' || btrim(p_search) || '%'
         OR COALESCE(p.job_title, '') ILIKE '%' || btrim(p_search) || '%'
         OR COALESCE(p.current_company, '') ILIKE '%' || btrim(p_search) || '%'
       )
     GROUP BY m.user_id, m.joined_at, m.role, m.role_expires_at
  ),
  work AS (
    SELECT
      d.user_id,
      (SELECT count(*)::int FROM public.club_threads th
        WHERE th.club_id = p_club_id AND th.author_id = d.user_id) AS thread_count,
      (SELECT count(*)::int FROM public.club_replies rp
        WHERE rp.club_id = p_club_id AND rp.author_id = d.user_id
          AND rp.status = 'visible') AS reply_count,
      GREATEST(
        (SELECT max(th.created_at) FROM public.club_threads th
          WHERE th.club_id = p_club_id AND th.author_id = d.user_id),
        (SELECT max(rp.created_at) FROM public.club_replies rp
          WHERE rp.club_id = p_club_id AND rp.author_id = d.user_id
            AND rp.status = 'visible')
      ) AS last_active_at
    FROM declared d
  )
  SELECT
    d.user_id,
    COALESCE(NULLIF(btrim(p.display_name), ''),
             NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'User'),
    CASE WHEN p.hide_avatar THEN NULL ELSE p.avatar_url END,
    p.slug,
    NULLIF(btrim(concat_ws(' - ', NULLIF(btrim(p.job_title), ''),
                                  NULLIF(btrim(p.current_company), ''))), ''),
    d.club_role, d.topics, d.joined_at,
    w.last_active_at, w.thread_count, w.reply_count,
    count(*) OVER ()
  FROM declared d
  JOIN work w ON w.user_id = d.user_id
  JOIN public.profiles p ON p.id = d.user_id
  -- Dorobek przed deklaracja: kto realnie pisal w tym klubie, stoi wyzej niz
  -- kto tylko zaznaczyl obszary.
  ORDER BY (w.thread_count + w.reply_count) DESC,
           cardinality(d.topics) DESC,
           lower(COALESCE(p.display_name, '')) ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$$;

COMMENT ON FUNCTION public.club_experts_list(uuid, text, text, integer, integer) IS
  'Katalog czlonkow z zadeklarowana kompetencja, z ich dorobkiem w klubie. Milczy w klubie ukrywajacym sklad.';

REVOKE EXECUTE ON FUNCTION public.club_experts_list(uuid, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_experts_list(uuid, text, text, integer, integer)
  TO authenticated, service_role;

-- Obszary, w ktorych ktokolwiek cos zadeklarowal - z licznikiem osob.
-- Zasila chipy filtra: filtr oferujacy obszar, w ktorym nie ma nikogo, jest
-- obietnica pustej listy.
DROP FUNCTION IF EXISTS public.club_expertise_areas(uuid);

CREATE FUNCTION public.club_expertise_areas(p_club_id uuid)
RETURNS TABLE (topic text, people integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH cap AS (
    SELECT * FROM public.club_capabilities(p_club_id, NULL, auth.uid())
  )
  SELECT e.topic, count(DISTINCT e.user_id)::int
    FROM public.club_member_expertise e
    CROSS JOIN cap
    JOIN public.club_members m
      ON m.club_id = e.club_id AND m.user_id = e.user_id AND m.status = 'active'
    JOIN public.profiles p ON p.id = m.user_id
   WHERE e.club_id = p_club_id
     AND cap.can_read
     AND cap.can_see_members
     AND (p.discoverable OR m.user_id = auth.uid())
   GROUP BY e.topic
   ORDER BY count(DISTINCT e.user_id) DESC, e.topic ASC
$$;

REVOKE EXECUTE ON FUNCTION public.club_expertise_areas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_expertise_areas(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4) POZNAJ CZLONKA: archiwum i redakcja
--
-- Rotacja tygodniowa nie zostawia sladu z definicji - jest liczona, nie
-- zapisywana. Archiwum ma wiec sens WYLACZNIE dla przypiec redakcyjnych i tak
-- jest zbudowane: `club_member_spotlight` jest jedynym zrodlem historii.
--
-- Strona modulu daje prowadzeniu klubu miejsce, w ktorym to przypiecie
-- powstaje. Bez tego tabela z A32 nie mialaby ANI JEDNEJ drogi zapisu poza
-- panelem administracyjnym, ktorego prowadzacy klub nie widzi - dokladnie ten
-- sam martwy tor, co `club_set_role` przed A-tka ze skladem.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.club_member_spotlight_history(uuid, integer);

CREATE FUNCTION public.club_member_spotlight_history(p_club_id uuid, p_limit integer DEFAULT 12)
RETURNS TABLE (
  id uuid, week_start date, user_id uuid,
  display_name text, avatar_url text, profile_slug text, headline text,
  blurb_pl text, blurb_en text, topics text[],
  is_current boolean, can_manage boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH cap AS (
    SELECT * FROM public.club_capabilities(p_club_id, NULL, auth.uid())
  ),
  wk AS (
    SELECT (date_trunc('week', now()))::date AS week_start
  )
  SELECT
    s.id, s.week_start, s.user_id,
    COALESCE(NULLIF(btrim(p.display_name), ''),
             NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'User'),
    CASE WHEN p.hide_avatar THEN NULL ELSE p.avatar_url END,
    p.slug,
    NULLIF(btrim(concat_ws(' - ', NULLIF(btrim(p.job_title), ''),
                                  NULLIF(btrim(p.current_company), ''))), ''),
    s.blurb_pl, s.blurb_en,
    COALESCE(
      (SELECT array_agg(e.topic ORDER BY e.topic)
         FROM public.club_member_expertise e
        WHERE e.club_id = p_club_id AND e.user_id = s.user_id),
      ARRAY[]::text[]),
    s.week_start = wk.week_start,
    cap.can_moderate
  FROM public.club_member_spotlight s
  CROSS JOIN cap
  CROSS JOIN wk
  JOIN public.profiles p ON p.id = s.user_id
  WHERE s.club_id = p_club_id
    AND cap.can_read
    AND cap.can_see_members
  ORDER BY s.week_start DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 52)
$$;

REVOKE EXECUTE ON FUNCTION public.club_member_spotlight_history(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_member_spotlight_history(uuid, integer)
  TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.club_member_spotlight_upsert(uuid, uuid, date, text, text);

CREATE FUNCTION public.club_member_spotlight_upsert(
  p_club_id    uuid,
  p_user_id    uuid,
  p_week_start date DEFAULT NULL,
  p_blurb_pl   text DEFAULT NULL,
  p_blurb_en   text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caps  record;
  v_week  date := COALESCE(p_week_start, (date_trunc('week', now()))::date);
  v_pl    text := NULLIF(btrim(COALESCE(p_blurb_pl, '')), '');
  v_en    text := NULLIF(btrim(COALESCE(p_blurb_en, '')), '');
  v_id    uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'club_member_spotlight_upsert: unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_caps FROM public.club_capabilities(p_club_id, NULL, auth.uid());
  IF NOT COALESCE(v_caps.can_moderate, false) THEN
    RAISE EXCEPTION 'club_member_spotlight_upsert: forbidden' USING ERRCODE = '42501';
  END IF;

  -- Tydzien normalizujemy do PONIEDZIALKU zamiast odrzucac srode: redakcja
  -- podaje date z kalendarza, a nie numer tygodnia ISO, i nie ma powodu karac
  -- jej za to bledem zapisu.
  v_week := (date_trunc('week', v_week::timestamp))::date;

  IF NOT EXISTS (
    SELECT 1 FROM public.club_members m
     WHERE m.club_id = p_club_id AND m.user_id = p_user_id AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'club_member_spotlight_upsert: not a member' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.club_member_spotlight (club_id, user_id, tenant_id, week_start, blurb_pl, blurb_en, created_by)
  SELECT p_club_id, p_user_id, c.tenant_id, v_week, v_pl, v_en, auth.uid()
    FROM public.clubs c WHERE c.id = p_club_id
  ON CONFLICT (club_id, week_start) DO UPDATE
     SET user_id  = EXCLUDED.user_id,
         blurb_pl = EXCLUDED.blurb_pl,
         blurb_en = EXCLUDED.blurb_en
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.club_member_spotlight_upsert(uuid, uuid, date, text, text) IS
  'Przypiecie czlonka na tydzien. Data normalizowana do poniedzialku - redakcja podaje date z kalendarza, nie numer tygodnia ISO.';

REVOKE EXECUTE ON FUNCTION public.club_member_spotlight_upsert(uuid, uuid, date, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_member_spotlight_upsert(uuid, uuid, date, text, text)
  TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.club_member_spotlight_delete(uuid);

CREATE FUNCTION public.club_member_spotlight_delete(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club uuid;
  v_caps record;
BEGIN
  SELECT club_id INTO v_club FROM public.club_member_spotlight WHERE id = p_id;
  IF v_club IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_caps FROM public.club_capabilities(v_club, NULL, auth.uid());
  IF NOT COALESCE(v_caps.can_moderate, false) THEN
    RAISE EXCEPTION 'club_member_spotlight_delete: forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.club_member_spotlight WHERE id = p_id;
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_member_spotlight_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_member_spotlight_delete(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4a) OBECNOSC: ta sama regula widocznosci profilu, co na liscie skladu
--
-- `club_members_list` odsiewa osoby z `discoverable = false` (poza wolajacym
-- i zarzadzajacym) od A1. `club_event_attendees` z A32 tego nie robilo, wiec
-- ten sam czlowiek byl NIEWIDOCZNY na ekranie skladu i WYPISANY Z NAZWISKA na
-- liscie uczestnikow spotkania - w tym samym klubie, dla tego samego
-- czytelnika. Dwie odpowiedzi na jedno pytanie to nie jest niuans widocznosci,
-- tylko wyciek przez tylne drzwi.
--
-- Licznik `going_count` w wierszu wydarzenia zostaje nietkniety: liczba osob,
-- ktore potwierdzily, nie zdradza nikogo, a lista nazwisk zdradza. To jest ten
-- sam podzial, co miedzy `members_total` a `faces` w sygnale skladu.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.club_event_attendees(uuid, integer);

CREATE FUNCTION public.club_event_attendees(p_event_id uuid, p_limit integer DEFAULT 12)
RETURNS TABLE (
  user_id uuid, display_name text, avatar_url text, profile_slug text,
  headline text, state text, is_me boolean, total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH ev AS (
    SELECT e.id, e.club_id FROM public.club_events e WHERE e.id = p_event_id
  ),
  cap AS (
    SELECT c.* FROM ev CROSS JOIN LATERAL public.club_capabilities(ev.club_id, NULL, auth.uid()) c
  ),
  rows AS (
    SELECT r.user_id, r.state
      FROM public.club_event_rsvps r
     CROSS JOIN cap
     WHERE r.event_id = p_event_id
       AND cap.can_read
       AND cap.can_see_members
       AND r.state IN ('going', 'maybe')
  )
  SELECT
    r.user_id,
    COALESCE(NULLIF(btrim(p.display_name), ''),
             NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'User'),
    CASE WHEN p.hide_avatar THEN NULL ELSE p.avatar_url END,
    p.slug,
    NULLIF(btrim(concat_ws(' - ', NULLIF(btrim(p.job_title), ''),
                                  NULLIF(btrim(p.current_company), ''))), ''),
    r.state,
    r.user_id = auth.uid(),
    count(*) OVER ()
  FROM rows r
  CROSS JOIN cap
  JOIN public.profiles p ON p.id = r.user_id
  WHERE (p.discoverable OR cap.can_manage OR r.user_id = auth.uid())
  -- "Bede" przed "moze": lista, ktora miesza oba stany, przestaje byc
  -- powodem, zeby przyjsc.
  ORDER BY CASE r.state WHEN 'going' THEN 0 ELSE 1 END,
           lower(COALESCE(p.display_name, '')) ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 50)
$$;

COMMENT ON FUNCTION public.club_event_attendees(uuid, integer) IS
  'Lista potwierdzonych obecnosci. Respektuje `profiles.discoverable` tak samo jak club_members_list - licznik going_count zostaje pelny, bo liczba nikogo nie zdradza.';

REVOKE EXECUTE ON FUNCTION public.club_event_attendees(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_event_attendees(uuid, integer) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5) POJEDYNCZE SPOTKANIE PO SLUGU
--
-- Strona spotkania nie moze pobierac dwustu wpisow kalendarza po to, zeby
-- pokazac jeden. Projekcja jest IDENTYCZNA z `club_events_list` - lacznie
-- z zerowaniem `meeting_url` dla nieuczestnikow - bo to ten sam byt widziany
-- z bliska, a nie druga jego wersja.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.club_event_view(uuid, text);

CREATE FUNCTION public.club_event_view(p_club_id uuid, p_slug text)
RETURNS TABLE (
  id uuid, club_id uuid, group_id uuid, thread_id uuid, anchor_event_id uuid,
  slug text, title_pl text, title_en text, description_pl text, description_en text,
  kind text, starts_at timestamptz, ends_at timestamptz, all_day boolean,
  location text, meeting_url text, status text,
  rsvp_enabled boolean, capacity integer, going_count integer,
  my_rsvp text, thread_slug text, group_name_pl text, group_name_en text,
  created_at timestamptz, can_manage boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH cap AS (
    SELECT * FROM public.club_capabilities(p_club_id, NULL, auth.uid())
  )
  SELECT
    e.id, e.club_id, e.group_id, e.thread_id, e.anchor_event_id,
    e.slug, e.title_pl, e.title_en, e.description_pl, e.description_en,
    e.kind, e.starts_at, e.ends_at, e.all_day,
    e.location,
    CASE WHEN cap.can_reply OR cap.can_moderate THEN e.meeting_url ELSE NULL END,
    e.status,
    e.rsvp_enabled, e.capacity, e.going_count,
    r.state,
    t.slug, g.name_pl, g.name_en,
    e.created_at, cap.can_moderate
  FROM public.club_events e
  CROSS JOIN cap
  LEFT JOIN public.club_event_rsvps r ON r.event_id = e.id AND r.user_id = auth.uid()
  LEFT JOIN public.club_threads t ON t.id = e.thread_id
  LEFT JOIN public.club_groups  g ON g.id = e.group_id
  WHERE e.club_id = p_club_id
    AND e.slug = p_slug
    AND cap.can_read
$$;

COMMENT ON FUNCTION public.club_event_view(uuid, text) IS
  'Jedno wydarzenie klubu po slugu. Projekcja identyczna z club_events_list - lacznie z zerowaniem meeting_url dla nieuczestnikow.';

REVOKE EXECUTE ON FUNCTION public.club_event_view(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_event_view(uuid, text) TO authenticated, service_role;
