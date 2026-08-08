-- ============================================================================
-- Kluby dyskusyjne - etap A26: wiersz watku niesie komplet sygnalow (spec §5.2)
--
-- BLAD, KTORY TO NAPRAWIA. Specyfikacja opisuje wiersz watku jako DZIEWIEC
-- sygnalow, "wszystkie z jednego zapytania dzieki denormalizacji". Lista
-- dowozila szesc: rodzaj, tytul, autor, liczba odpowiedzi, liczba uczestnikow,
-- czas ostatniej aktywnosci. Brakowaly trzy - i akurat te trzy, ktore zmieniaja
-- decyzje czytelnika, a nie tylko ozdabiaja wiersz:
--
--   1. KOTWICA. `anchor_type`/`anchor_id` byly w projekcji od A3 i nie mialy
--      konsumenta, bo goly identyfikator nie jest sygnalem. Watek zakotwiczony
--      w akcie prawnym wygladal identycznie jak luzna dyskusja, mimo ze to
--      dwie rozne rzeczy: przy jednym warto najpierw przeczytac dossier.
--   2. `insightful`. Lista pokazywala `reaction_count` - SUME wszystkich
--      reakcji, w ktorej `agree` wazy tyle samo, co `insightful`. To jest
--      dokladnie ta agregacja, ktorej ranking `hotness` swiadomie NIE robi
--      (§5.3: jakosc wazy wiecej niz objetosc, agree/disagree nie podbijaja).
--      Wiersz mowil wiec co innego niz porzadek, w ktorym stal.
--   3. NIEPRZECZYTANE. `club_members.last_read_at` istnialo od A1 i bylo
--      czytane wylacznie przez licznik globalny. Na liscie watkow - jedynym
--      miejscu, gdzie ta informacja cokolwiek zmienia - nie bylo jej wcale.
--
-- FILTRY (§5.2). Dochodza `p_status`, `p_anchored` i `p_unread_only`. Filtr
-- "obszar polityki" nie ma tu czego robic: `policy_area` jest kolumna KLUBU,
-- wiec wewnatrz listy jednego klubu jest stala. Ten filtr zyje na hubie
-- (`ClubTopicNav` nad katalogiem klubow) i tam dziala - dokladanie go tutaj
-- byloby dropLista, ktora nigdy niczego nie odsiewa.
--
-- KOSZT. `insightful_count` to skorelowany agregat po `club_reactions`
-- (indeks `club_reactions_target_idx` na (target_type, target_id)) liczony dla
-- STRONY, czyli najwyzej 50 wierszy - nie dla calego klubu. Etykieta kotwicy
-- to jedno LEFT JOIN LATERAL po kluczu glownym. Swiadomie NIE denormalizujemy
-- `insightful` do kolumny: to wymagaloby kolejnego triggera na reakcjach,
-- a strona listy i tak czyta 20 wierszy.
--
-- Zmiana typu zwracanego i sygnatury, wiec DROP + CREATE w tym samym pliku.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Etykieta kotwicy
--
-- Osobna funkcja, a nie CASE wklejony w liste: kotwice czyta takze karta
-- "dyskutowane w klubach" i panel administracyjny, a trzy kopie tego samego
-- CASE rozjezdzaja sie przy pierwszym nowym typie kotwicy.
--
-- Widocznosc: kotwica jest LINKIEM do tresci, ktora ma wlasna bramke. Etykieta
-- moze wiec wyjsc dla kazdego, kto widzi watek - z jednym wyjatkiem, ktorym
-- jest kotwica w innym WATKU KLUBOWYM: tam delegujemy do
-- `club_linked_item_label`, ktore zna regule widocznosci klubu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_anchor_label(p_type text, p_id text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label text;
BEGIN
  IF p_type IS NULL OR NULLIF(btrim(COALESCE(p_id, '')), '') IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;

  CASE p_type
    WHEN 'eu_policy_item' THEN
      SELECT COALESCE(NULLIF(btrim(i.title_pl), ''), NULLIF(btrim(i.title_en), ''))
        INTO v_label FROM public.eu_policy_items i WHERE i.id = p_id::uuid;
    WHEN 'post' THEN
      SELECT COALESCE(NULLIF(btrim(p.title_pl), ''), NULLIF(btrim(p.title_en), ''), p.slug)
        INTO v_label FROM public.posts p
       WHERE p.id = p_id::uuid AND p.deleted_at IS NULL;
    WHEN 'event' THEN
      SELECT COALESCE(NULLIF(btrim(e.title_pl), ''), NULLIF(btrim(e.title_en), ''), e.slug)
        INTO v_label FROM public.events e WHERE e.id = p_id::uuid;
    -- `research_programs` nazywa kolumny `name_*`, nie `title_*` - roznica,
    -- ktora nie odezwalaby sie przy CREATE, tylko przy pierwszym watku
    -- zakotwiczonym w programie badawczym (cialo plpgsql nie jest walidowane).
    WHEN 'research_program' THEN
      SELECT COALESCE(NULLIF(btrim(r.name_pl), ''), NULLIF(btrim(r.name_en), ''), r.slug)
        INTO v_label FROM public.research_programs r WHERE r.id = p_id::uuid;
    WHEN 'club_thread' THEN
      v_label := public.club_linked_item_label('club_thread', p_id);
    ELSE
      v_label := NULL;
  END CASE;

  RETURN v_label;
EXCEPTION WHEN OTHERS THEN
  -- Kotwica wskazujaca na skasowana tresc nie moze wywalic CALEJ listy watkow.
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.club_anchor_label(text, text) IS
  'Czytelna nazwa kotwicy watku. Kotwica jest linkiem do tresci z wlasna bramka, wiec etykieta wychodzi dla kazdego, kto widzi watek - poza kotwica w innym watku klubowym, gdzie regule widocznosci trzyma club_linked_item_label.';

REVOKE EXECUTE ON FUNCTION public.club_anchor_label(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_anchor_label(text, text)
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2) club_threads_list: trzy brakujace sygnaly + trzy filtry
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.club_threads_list(uuid, uuid, text, text, text, integer);

DROP FUNCTION IF EXISTS public.club_threads_list(uuid, uuid, text, text, text, integer, text, boolean, boolean);
CREATE FUNCTION public.club_threads_list(
  p_club_id uuid, p_group_id uuid DEFAULT NULL, p_sort text DEFAULT 'hot',
  p_kind text DEFAULT NULL, p_cursor text DEFAULT NULL, p_limit integer DEFAULT 20,
  p_status text DEFAULT NULL, p_anchored boolean DEFAULT NULL,
  p_unread_only boolean DEFAULT false
)
RETURNS TABLE (
  id uuid, slug text, title text, kind text, status text,
  group_id uuid, group_name_pl text, group_name_en text,
  anchor_type text, anchor_id text, anchor_label text,
  is_anonymous boolean, author_id uuid, author_name text,
  author_avatar text, author_slug text, author_alias text,
  posted_by_admin_name text,
  reply_count integer, participant_count integer, reaction_count integer,
  insightful_count integer,
  pinned_at timestamptz, last_reply_at timestamptz, created_at timestamptz,
  hotness numeric, is_unread boolean, cursor_value text, excerpt text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH sort AS (
    SELECT CASE
             WHEN p_sort IN ('new', 'unanswered', 'top', 'mine', 'subscribed')
               THEN p_sort
             ELSE 'hot'
           END AS mode
  ),
  cap AS (
    SELECT * FROM public.club_capabilities(p_club_id, p_group_id, auth.uid())
  ),
  -- Moment ostatniego przeczytania KLUBU przez wolajacego. Jeden wiersz na cala
  -- liste, nie podzapytanie per watek. Anonim nie ma czego "nie przeczytac",
  -- wiec dostaje NULL i wszystkie znaczniki gasna.
  seen AS (
    SELECT m.last_read_at
      FROM public.club_members m
     WHERE m.club_id = p_club_id
       AND auth.uid() IS NOT NULL
       AND m.user_id = auth.uid()
  ),
  visible AS (
    SELECT t.*, g.name_pl AS g_pl, g.name_en AS g_en,
           COALESCE(g.attribution_mode, cl.attribution_mode) AS attribution,
           -- Nieprzeczytany = ostatnia aktywnosc PO ostatnim otwarciu klubu.
           -- Wlasny watek nigdy nie swieci: autor go czytal, pisac go musial.
           (auth.uid() IS NOT NULL
            AND t.author_id IS DISTINCT FROM auth.uid()
            AND COALESCE(t.last_reply_at, t.created_at)
                > COALESCE((SELECT last_read_at FROM seen), '-infinity'::timestamptz)
           ) AS unread,
           -- Flaga przypiecia jest CZESCIA klucza kursora, wiec porzadek
           -- kursora pokrywa sie z porzadkiem sortowania i przypiety watek
           -- nie wraca na kazdej stronie.
           (CASE WHEN t.pinned_at IS NOT NULL AND s.mode IN ('hot', 'new')
                 THEN '1' ELSE '0' END) AS pin_key
      FROM public.club_threads t
      JOIN public.club_groups g ON g.id = t.group_id
      JOIN public.clubs cl ON cl.id = t.club_id
      CROSS JOIN cap
      CROSS JOIN sort s
     WHERE t.club_id = p_club_id
       AND cap.can_read
       AND (p_group_id IS NULL OR t.group_id = p_group_id)
       AND (p_kind IS NULL OR t.kind = p_kind)
       AND (t.status IN ('open','resolved','dormant','locked')
            OR cap.can_moderate
            OR (t.status = 'pending' AND t.author_id = auth.uid()))
       AND (g.status NOT IN ('draft','archived') OR cap.can_manage)
       -- Filtr statusu jest ZAWEZENIEM tego, co i tak wolno zobaczyc - stoi
       -- wiec PO bramce widocznosci, a nie zamiast niej. Bez tej kolejnosci
       -- `p_status = 'pending'` odslanialby cudze wpisy z kolejki moderacji.
       AND (p_status IS NULL OR t.status = p_status)
       AND (p_anchored IS NULL OR (t.anchor_id IS NOT NULL) = p_anchored)
       -- Sorty filtrujace. `unanswered` celowo nie liczy odpowiedzi autora
       -- watku osobno: zero odpowiedzi to zero odpowiedzi.
       AND (s.mode <> 'unanswered' OR t.reply_count = 0)
       AND (s.mode <> 'top' OR t.created_at > now() - interval '30 days')
       AND (s.mode <> 'mine'
            OR (auth.uid() IS NOT NULL AND t.author_id = auth.uid()))
       AND (s.mode <> 'subscribed'
            OR EXISTS (SELECT 1 FROM public.club_thread_subscriptions cs
                        WHERE cs.thread_id = t.id
                          AND cs.user_id = auth.uid()
                          AND cs.state = 'subscribed'))
  ),
  filtered AS (
    SELECT v.* FROM visible v
     WHERE NOT COALESCE(p_unread_only, false) OR v.unread
  ),
  keyed AS (
    SELECT f.*,
           f.pin_key || '|' ||
           CASE s.mode
             WHEN 'new' THEN
               to_char(COALESCE(f.last_reply_at, f.created_at), 'YYYYMMDDHH24MISSMS')
             WHEN 'subscribed' THEN
               to_char(COALESCE(f.last_reply_at, f.created_at), 'YYYYMMDDHH24MISSMS')
             WHEN 'unanswered' THEN to_char(f.created_at, 'YYYYMMDDHH24MISSMS')
             WHEN 'mine' THEN to_char(f.created_at, 'YYYYMMDDHH24MISSMS')
             -- `top` sortuje po REAKCJACH, nie po odpowiedziach: trzydziesci
             -- odpowiedzi w klotni dwoch osob to nie jest szczyt miesiaca.
             WHEN 'top' THEN lpad(GREATEST(f.reaction_count, 0)::text, 10, '0')
             ELSE to_char(f.hotness, 'FM0000000000.0000000000')
           END || '|' || f.id::text AS ckey
      FROM filtered f
      CROSS JOIN sort s
  ),
  page AS (
    SELECT k.* FROM keyed k
     WHERE p_cursor IS NULL OR k.ckey < p_cursor
     ORDER BY k.ckey DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
  )
  SELECT
    k.id, k.slug, k.title, k.kind, k.status,
    k.group_id, k.g_pl, k.g_en,
    k.anchor_type, k.anchor_id,
    public.club_anchor_label(k.anchor_type, k.anchor_id),
    k.is_anonymous,
    CASE WHEN k.is_anonymous OR k.attribution = 'chatham' THEN NULL ELSE k.author_id END,
    CASE WHEN k.is_anonymous OR k.attribution = 'chatham' THEN NULL
         ELSE COALESCE(NULLIF(btrim(p.display_name), ''),
                       NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'User') END,
    CASE WHEN k.is_anonymous OR k.attribution = 'chatham' OR p.hide_avatar THEN NULL
         ELSE p.avatar_url END,
    CASE WHEN k.is_anonymous OR k.attribution = 'chatham' THEN NULL ELSE p.slug END,
    CASE WHEN k.is_anonymous OR k.attribution = 'chatham'
         THEN public.club_author_alias(k.id, k.author_id) ELSE NULL END,
    NULLIF(btrim(pa.display_name), ''),
    k.reply_count, k.participant_count, k.reaction_count,
    -- Liczona dla STRONY, nie dla klubu: podzapytanie siedzi po LIMIT-cie.
    COALESCE((SELECT count(*)::int FROM public.club_reactions rx
               WHERE rx.target_type = 'thread' AND rx.target_id = k.id
                 AND rx.kind = 'insightful'), 0),
    k.pinned_at, k.last_reply_at, k.created_at, k.hotness, k.unread, k.ckey,
    left(k.body, 280)
  FROM page k
  LEFT JOIN public.profiles p ON p.id = k.author_id
  LEFT JOIN public.profiles pa ON pa.id = k.posted_by_admin_id
  ORDER BY k.ckey DESC
$$;

COMMENT ON FUNCTION public.club_threads_list(uuid, uuid, text, text, text, integer, text, boolean, boolean) IS
  'Lista tematow klubu - komplet sygnalow ze spec par. 5.2 (rodzaj, tytul, autor, kotwica z etykieta, odpowiedzi, uczestnicy, insightful, ostatnia aktywnosc, znacznik nieprzeczytanego). Szesc sortow i filtry: rodzaj, status, zakotwiczenie, tylko nieprzeczytane. Kursor niesie przypiecie, klucz sortu i id.';

REVOKE EXECUTE ON FUNCTION
  public.club_threads_list(uuid, uuid, text, text, text, integer, text, boolean, boolean)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.club_threads_list(uuid, uuid, text, text, text, integer, text, boolean, boolean)
  TO anon, authenticated, service_role;
