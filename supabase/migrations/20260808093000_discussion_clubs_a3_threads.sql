-- ============================================================================
-- DISCUSSION CLUB - ETAP A3: TRESC (TEMATY I ODPOWIEDZI)
--
-- CZTERY DECYZJE, KTORE ODROZNIAJA TEN MODUL OD FORUM (V1 §0):
--
-- 1) TEMAT MA ZAMIERZONY WYNIK. `kind` nie jest etykieta - zmienia cykl zycia:
--    question dostaje resolved_reply_id i status 'resolved', position zbiera
--    stanowiska, announcement zaklada wylacznie prowadzacy.
--
-- 2) DRZEWO PRZYCIETE DO 2 POZIOMOW, dokladnie jak komentarze
--    (MAX_COMMENT_DEPTH = 2 w src/lib/comments/tree.ts). Deliberacja potrzebuje
--    watkow pobocznych, ale glebokie zagniezdzenie zabija czytelnosc i layout
--    mobilny. Limit trzyma trigger W BAZIE, nie skladanie drzewa w kliencie.
--
-- 3) FTS W WLASNEJ KONFIGURACJI public.nes_polish, NIE w golym 'simple'.
--    Wyszukiwarka wiadomosci czatu ma tu otwarty dlug od szesciu wydan
--    ("zero fleksji wbrew komentarzowi o polskiej fleksji"). Nie powielamy go -
--    patrz sekcja 0, gdzie konfiguracja wybiera zrodlo w czasie migracji.
--
-- 4) KURSOR PAGINACJI ZAWSZE Z TIEBREAKEREM `id`. Czat ma tu otwarta pozycje;
--    bez tiebreakera dwa watki o tym samym hotness gubia sie miedzy stronami.
--
-- ANONIMOWOSC JEST FUNKCJA PROJEKCJI, NIE INTERFEJSU (V1 §1.2):
-- author_id zapisujemy ZAWSZE, bo odpowiedzialnosc i moderacja musza dzialac.
-- Ale RPC odczytowy nie zwraca go dla wpisow anonimowych - klient go nie
-- dostaje, wiec nie ma czego wyciec w devtoolsach. Pseudonim jest osolony
-- PER WATEK: bez tego ten sam alias w wielu watkach pozwolilby po czasie
-- zdeanonimizowac osobe przez korelacje tematow.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Konfiguracja wyszukiwania pelnotekstowego: public.nes_polish
--
-- Audyt slusznie wytyka czatowi konfiguracje 'simple' ("zero fleksji wbrew
-- komentarzowi o polskiej fleksji"). Nie powielamy tego dlugu - ale nie
-- mozemy tez zalozyc, ze konfiguracja 'polish' w tej bazie ISTNIEJE:
-- PostgreSQL nie dostarcza jej w standardzie (polski wymaga slownika
-- hunspell/ispell doinstalowanego osobno), a kolumna GENERATED odwolujaca sie
-- do nieistniejacej konfiguracji wywalilaby CALA migracje.
--
-- Dlatego tworzymy WLASNA konfiguracje i wybieramy zrodlo w czasie migracji:
--   * jest 'polish'  -> kopiujemy ja (pelna fleksja),
--   * nie ma        -> kopiujemy 'simple' (bez fleksji, ale z unaccent).
--
-- W obu przypadkach dokladamy `unaccent`, wiec diakrytyki nie maja znaczenia
-- i "rozporzadzenie" znajdzie "Rozporzadzenie". Nazwa jest STALA, wiec
-- doinstalowanie slownika polskiego w przyszlosci to jedna migracja
-- ALTER TEXT SEARCH CONFIGURATION - bez zmiany DEFINICJI kolumn GENERATED.
-- Uwaga operacyjna: istniejace wektory NIE przeliczaja sie same po takiej
-- zmianie, wiec taka migracja musi dolozyc backfill (UPDATE ... SET title =
-- title wymusza przeliczenie) - to jest znany koszt, nie niespodzianka.
-- ----------------------------------------------------------------------------
DO $config$
DECLARE
  v_source text;
  v_tok    text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'nes_polish'
              AND cfgnamespace = 'public'::regnamespace) THEN
    RETURN;
  END IF;

  v_source := CASE
    WHEN EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'polish') THEN 'polish'
    ELSE 'simple'
  END;

  EXECUTE format('CREATE TEXT SEARCH CONFIGURATION public.nes_polish (COPY = %I)', v_source);

  -- unaccent PRZED slownikiem zrodlowym: najpierw zdejmujemy diakrytyki,
  -- potem stemujemy. Odwrotna kolejnosc gubilaby czesc form.
  IF EXISTS (SELECT 1 FROM pg_ts_dict WHERE dictname = 'unaccent') THEN
    FOREACH v_tok IN ARRAY ARRAY['word', 'hword', 'hword_part', 'asciiword',
                                 'asciihword', 'hword_asciipart']
    LOOP
      EXECUTE format(
        'ALTER TEXT SEARCH CONFIGURATION public.nes_polish
           ALTER MAPPING FOR %s WITH unaccent, %I',
        v_tok, CASE WHEN v_source = 'polish' THEN 'polish_stem' ELSE 'simple' END
      );
    END LOOP;
  END IF;
END
$config$;

COMMENT ON TEXT SEARCH CONFIGURATION public.nes_polish IS
  'Konfiguracja FTS modulu Discussion Club. Kopiuje polish jesli istnieje, inaczej simple; w obu przypadkach z unaccent. Nazwa stala, wiec podmiana slownika nie rusza kolumn GENERATED.';

-- ----------------------------------------------------------------------------
-- 1) TEMAT
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.club_threads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  club_id           uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  group_id          uuid NOT NULL REFERENCES public.club_groups(id) ON DELETE CASCADE,
  author_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  slug              text NOT NULL,

  title             text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 5 AND 200),
  body              text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 10 AND 20000),

  kind              text NOT NULL DEFAULT 'discussion'
                    CHECK (kind IN ('discussion', 'question', 'position',
                                    'resource', 'announcement', 'poll')),
  status            text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('pending', 'open', 'resolved', 'dormant',
                                      'locked', 'hidden', 'deleted')),

  is_anonymous      boolean NOT NULL DEFAULT false,

  anchor_type       text CHECK (anchor_type IN ('eu_policy_item', 'post', 'event',
                                                'research_program', 'club_thread')),
  anchor_id         text,

  pinned_at         timestamptz,
  locked_at         timestamptz,
  resolved_reply_id uuid,

  -- Denormalizacja swiadoma: lista tematow jest ekranem otwieranym najczesciej
  -- w calym module i nie moze liczyc COUNT(*) per wiersz.
  reply_count       integer NOT NULL DEFAULT 0,
  participant_count integer NOT NULL DEFAULT 0,
  reaction_count    integer NOT NULL DEFAULT 0,
  last_reply_at     timestamptz,

  -- Kolumna, nie widok: lista tematow nie moze liczyc potegi per wiersz.
  hotness           numeric NOT NULL DEFAULT 0,

  -- Konfiguracja public.nes_polish - patrz sekcja 0.
  search_vector     tsvector GENERATED ALWAYS AS (
                      setweight(to_tsvector('public.nes_polish', coalesce(title, '')), 'A') ||
                      setweight(to_tsvector('public.nes_polish', coalesce(body, '')),  'B')
                    ) STORED,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  edited_at         timestamptz,
  edit_count        smallint NOT NULL DEFAULT 0,

  CONSTRAINT club_threads_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT club_threads_anchor_pair CHECK ((anchor_type IS NULL) = (anchor_id IS NULL)),
  -- Rozstrzygajaca odpowiedz ma sens wylacznie w pytaniu.
  CONSTRAINT club_threads_resolved_only_question
    CHECK (resolved_reply_id IS NULL OR kind = 'question')
);

CREATE UNIQUE INDEX IF NOT EXISTS club_threads_club_slug_key
  ON public.club_threads (club_id, slug);
-- Lista domyslna: przypiete na gorze, potem ranking.
CREATE INDEX IF NOT EXISTS club_threads_list_hot_idx
  ON public.club_threads (club_id, status, pinned_at DESC NULLS LAST, hotness DESC, id DESC);
-- Sort "najnowsze" - z tiebreakerem id, patrz naglowek, decyzja 4.
CREATE INDEX IF NOT EXISTS club_threads_list_new_idx
  ON public.club_threads (club_id, status, last_reply_at DESC NULLS LAST, id DESC);
CREATE INDEX IF NOT EXISTS club_threads_group_idx
  ON public.club_threads (group_id, status, last_reply_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS club_threads_anchor_idx
  ON public.club_threads (anchor_type, anchor_id) WHERE anchor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS club_threads_search_idx
  ON public.club_threads USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS club_threads_author_idx
  ON public.club_threads (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS club_threads_tenant_idx
  ON public.club_threads (tenant_id, club_id);

COMMENT ON TABLE public.club_threads IS
  'Temat dyskusji. kind zmienia cykl zycia, nie tylko etykiete. FTS w konfiguracji public.nes_polish (polish jesli dostepny, inaczej simple + unaccent) - nie powielamy dlugu czatu.';
COMMENT ON COLUMN public.club_threads.is_anonymous IS
  'Anonimowosc jest funkcja PROJEKCJI: author_id zapisujemy zawsze, ale RPC odczytowy go nie zwraca dla wpisow anonimowych.';

-- ----------------------------------------------------------------------------
-- 2) ODPOWIEDZ - drzewo przyciete do 2 poziomow
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.club_replies (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  club_id        uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  thread_id      uuid NOT NULL REFERENCES public.club_threads(id) ON DELETE CASCADE,
  author_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  parent_id      uuid REFERENCES public.club_replies(id) ON DELETE CASCADE,

  -- 0..2, dokladnie jak MAX_COMMENT_DEPTH w lib/comments/tree.ts.
  depth          smallint NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 2),
  body           text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 10000),
  is_anonymous   boolean NOT NULL DEFAULT false,
  status         text NOT NULL DEFAULT 'visible'
                 CHECK (status IN ('pending', 'visible', 'hidden', 'deleted')),
  reaction_count integer NOT NULL DEFAULT 0,

  search_vector  tsvector GENERATED ALWAYS AS (to_tsvector('public.nes_polish', coalesce(body, ''))) STORED,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  edited_at      timestamptz,
  edit_count     smallint NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS club_replies_thread_idx
  ON public.club_replies (thread_id, status, created_at, id);
CREATE INDEX IF NOT EXISTS club_replies_parent_idx
  ON public.club_replies (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS club_replies_author_idx
  ON public.club_replies (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS club_replies_search_idx
  ON public.club_replies USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS club_replies_tenant_idx
  ON public.club_replies (tenant_id, club_id);

COMMENT ON TABLE public.club_replies IS
  'Odpowiedz w watku. Drzewo przyciete do 2 poziomow - limit trzyma trigger w bazie, nie skladanie drzewa w kliencie.';

-- Klucz obcy resolved_reply_id dokladamy PO utworzeniu club_replies.
ALTER TABLE public.club_threads
  DROP CONSTRAINT IF EXISTS club_threads_resolved_reply_fk;
ALTER TABLE public.club_threads
  ADD CONSTRAINT club_threads_resolved_reply_fk
  FOREIGN KEY (resolved_reply_id) REFERENCES public.club_replies(id) ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- 3) RLS: deny-all, RPC-only
-- ----------------------------------------------------------------------------
ALTER TABLE public.club_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_replies ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.club_threads FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.club_replies FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.club_threads TO service_role;
GRANT ALL ON public.club_replies TO service_role;

DROP TRIGGER IF EXISTS club_threads_pin_tenant_tg ON public.club_threads;
CREATE TRIGGER club_threads_pin_tenant_tg
  BEFORE INSERT OR UPDATE ON public.club_threads
  FOR EACH ROW EXECUTE FUNCTION public.club_child_pin_tenant();

DROP TRIGGER IF EXISTS club_replies_pin_tenant_tg ON public.club_replies;
CREATE TRIGGER club_replies_pin_tenant_tg
  BEFORE INSERT OR UPDATE ON public.club_replies
  FOR EACH ROW EXECUTE FUNCTION public.club_child_pin_tenant();

DROP TRIGGER IF EXISTS club_threads_set_updated_tg ON public.club_threads;
CREATE TRIGGER club_threads_set_updated_tg BEFORE UPDATE ON public.club_threads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS club_replies_set_updated_tg ON public.club_replies;
CREATE TRIGGER club_replies_set_updated_tg BEFORE UPDATE ON public.club_replies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4) Ranking `hotness` (V1 §5.3)
--
-- hotness = (insightful*3 + evidence*3 + replies*2 + participants*2 + stances)
--           / pow(hours_since_created + 2, 1.5)
--
-- Reakcje przychodza w A4, wiec na razie licznik jakosci jest zerem - wzor
-- juz go jednak uwzglednia, zeby A4 nie wymagalo przepisania funkcji.
--
-- TRZY DECYZJE WARTE OBRONY:
--   * jakosc wazy wiecej niz objetosc (insightful x3 vs replies x2),
--   * liczba UCZESTNIKOW wazy tyle co odpowiedzi - dziesiec odpowiedzi od
--     dwoch osob to klotnia, nie dyskusja,
--   * agree/disagree NIE podbijaja - inaczej ranking premiowalby polaryzacje.
--     To jest ta jedna decyzja, ktorej warto bronic najmocniej.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_thread_hotness(
  _quality_reactions integer,
  _reply_count integer,
  _participant_count integer,
  _stance_count integer,
  _created_at timestamptz
)
RETURNS numeric
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT (
    COALESCE(_quality_reactions, 0) * 3
    + COALESCE(_reply_count, 0) * 2
    + COALESCE(_participant_count, 0) * 2
    + COALESCE(_stance_count, 0)
  )::numeric
  / power(
      GREATEST(EXTRACT(EPOCH FROM (now() - _created_at)) / 3600.0, 0) + 2,
      1.5
    );
$$;

COMMENT ON FUNCTION public.club_thread_hotness(integer, integer, integer, integer, timestamptz) IS
  'Ranking tematu. Jakosc wazy wiecej niz objetosc; agree/disagree NIE podbijaja, zeby ranking nie premiowal polaryzacji (V1 §5.3).';

REVOKE EXECUTE ON FUNCTION public.club_thread_hotness(integer, integer, integer, integer, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_thread_hotness(integer, integer, integer, integer, timestamptz)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5) Triggery: glebokosc, liczniki, hotness
-- ----------------------------------------------------------------------------

-- Glebokosc wyliczamy z rodzica, nie przyjmujemy od klienta. Odpowiedz na
-- poziom 2 PRZYPINA sie do poziomu 2 zamiast tworzyc trzecie pietro -
-- dokladnie jak canReplyToComment po stronie klienta.
CREATE OR REPLACE FUNCTION public.club_replies_set_depth()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_parent public.club_replies%ROWTYPE;
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.depth := 0;
    RETURN NEW;
  END IF;

  SELECT * INTO v_parent FROM public.club_replies WHERE id = NEW.parent_id;
  IF NOT FOUND OR v_parent.thread_id <> NEW.thread_id THEN
    RAISE EXCEPTION 'clubs: invalid parent reply' USING ERRCODE = '23503';
  END IF;

  IF v_parent.depth >= 2 THEN
    -- Splaszczenie zamiast bledu: uzytkownik nacisnal "Odpowiedz" i ma prawo
    -- oczekiwac, ze jego tresc gdzies wyladuje. Renderuje sie jako "@ktos".
    NEW.parent_id := v_parent.parent_id;
    NEW.depth := 2;
  ELSE
    NEW.depth := v_parent.depth + 1;
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS club_replies_set_depth_tg ON public.club_replies;
CREATE TRIGGER club_replies_set_depth_tg
  BEFORE INSERT ON public.club_replies
  FOR EACH ROW EXECUTE FUNCTION public.club_replies_set_depth();

-- Liczniki watku plus hotness. Jeden trigger, bo wszystkie te wartosci zmienia
-- ta sama operacja i rozdzielenie dawaloby dwa UPDATE na ten sam wiersz.
CREATE OR REPLACE FUNCTION public.club_replies_sync_thread()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_thread uuid := COALESCE(NEW.thread_id, OLD.thread_id);
BEGIN
  UPDATE public.club_threads t
     SET reply_count = sub.cnt,
         participant_count = sub.participants,
         last_reply_at = sub.last_at,
         hotness = public.club_thread_hotness(
           0, sub.cnt::int, sub.participants::int, 0, t.created_at
         )
    FROM (
      SELECT count(*)::int AS cnt,
             count(DISTINCT author_id)::int AS participants,
             max(created_at) AS last_at
        FROM public.club_replies
       WHERE thread_id = v_thread AND status = 'visible'
    ) sub
   WHERE t.id = v_thread;

  -- Ostatnia aktywnosc klubu i grupy: bez tego lista klubow sortuje sie po
  -- dacie utworzenia i wyglada na martwa mimo ruchu w dyskusjach.
  UPDATE public.clubs c SET last_activity_at = now()
   WHERE c.id = (SELECT club_id FROM public.club_threads WHERE id = v_thread);
  UPDATE public.club_groups g SET last_activity_at = now()
   WHERE g.id = (SELECT group_id FROM public.club_threads WHERE id = v_thread);

  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS club_replies_sync_thread_tg ON public.club_replies;
CREATE TRIGGER club_replies_sync_thread_tg
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.club_replies
  FOR EACH ROW EXECUTE FUNCTION public.club_replies_sync_thread();

-- Liczniki tematow na klubie i grupie.
CREATE OR REPLACE FUNCTION public.club_threads_sync_counts()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_club  uuid := COALESCE(NEW.club_id, OLD.club_id);
  v_group uuid := COALESCE(NEW.group_id, OLD.group_id);
BEGIN
  UPDATE public.clubs c
     SET thread_count = (SELECT count(*)::int FROM public.club_threads t
                          WHERE t.club_id = v_club
                            AND t.status NOT IN ('deleted', 'hidden', 'pending')),
         last_activity_at = now()
   WHERE c.id = v_club;

  UPDATE public.club_groups g
     SET thread_count = (SELECT count(*)::int FROM public.club_threads t
                          WHERE t.group_id = v_group
                            AND t.status NOT IN ('deleted', 'hidden', 'pending')),
         last_activity_at = now()
   WHERE g.id = v_group;

  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS club_threads_sync_counts_tg ON public.club_threads;
CREATE TRIGGER club_threads_sync_counts_tg
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.club_threads
  FOR EACH ROW EXECUTE FUNCTION public.club_threads_sync_counts();

-- ----------------------------------------------------------------------------
-- 6) Pseudonim Chatham House - osolony PER WATEK
--
-- Bez osolenia per watek ten sam pseudonim w wielu watkach pozwolilby po
-- czasie zdeanonimizowac osobe przez korelacje tematow, w ktorych sie
-- wypowiada. Sol bierzemy z id watku i tenanta - deterministycznie, wiec
-- alias jest stabilny w obrebie watku i da sie sledzic, kto z kim polemizuje.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_author_alias(_thread_id uuid, _author_id uuid)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _author_id IS NULL THEN NULL
    ELSE 'A' || (
      -- 26 liter zamiast liczby: "Uczestnik C" czyta sie lepiej niz
      -- "Uczestnik 7391" i nie sugeruje kolejnosci dolaczenia.
      ('{A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R,S,T,U,V,W,X,Y,Z}'::text[])[
        1 + (abs(hashtextextended(_thread_id::text || ':' || _author_id::text, 42)) % 26)
      ]
    )
  END;
$$;

COMMENT ON FUNCTION public.club_author_alias(uuid, uuid) IS
  'Pseudonim Chatham House, deterministyczny i OSOLONY PER WATEK. Bez osolenia korelacja tematow pozwolilaby zdeanonimizowac autora.';

REVOKE EXECUTE ON FUNCTION public.club_author_alias(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_author_alias(uuid, uuid)
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7) Odczyt: lista tematow
--
-- Kursor (hotness|last_reply_at, id) - ZAWSZE z tiebreakerem, patrz naglowek.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.club_threads_list(uuid, uuid, text, text, text, integer);

CREATE FUNCTION public.club_threads_list(
  p_club_id    uuid,
  p_group_id   uuid DEFAULT NULL,
  p_sort       text DEFAULT 'hot',
  p_kind       text DEFAULT NULL,
  p_cursor     text DEFAULT NULL,
  p_limit      integer DEFAULT 20
)
RETURNS TABLE (
  id uuid, slug text, title text, kind text, status text,
  group_id uuid, group_name_pl text, group_name_en text,
  anchor_type text, anchor_id text,
  is_anonymous boolean, author_id uuid, author_name text,
  author_avatar text, author_slug text, author_alias text,
  reply_count integer, participant_count integer, reaction_count integer,
  pinned_at timestamptz, last_reply_at timestamptz, created_at timestamptz,
  hotness numeric, cursor_value text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH cap AS (
    SELECT * FROM public.club_capabilities(p_club_id, p_group_id, auth.uid())
  ),
  club AS (
    SELECT c.* FROM public.clubs c WHERE c.id = p_club_id
  ),
  visible AS (
    SELECT t.*, g.name_pl AS g_pl, g.name_en AS g_en,
           COALESCE(g.attribution_mode, cl.attribution_mode) AS attribution
      FROM public.club_threads t
      JOIN public.club_groups g ON g.id = t.group_id
      JOIN club cl ON cl.id = t.club_id
      CROSS JOIN cap
     WHERE t.club_id = p_club_id
       AND cap.can_read
       AND (p_group_id IS NULL OR t.group_id = p_group_id)
       AND (p_kind IS NULL OR t.kind = p_kind)
       -- Ukryte i usuniete widzi wylacznie moderacja; wlasny wpis w kolejce
       -- premoderacji widzi jego autor, zeby wiedzial, ze czeka.
       AND (
         t.status IN ('open', 'resolved', 'dormant', 'locked')
         OR cap.can_moderate
         OR (t.status = 'pending' AND t.author_id = auth.uid())
       )
       AND (g.status NOT IN ('draft', 'archived') OR cap.can_manage)
  )
  SELECT
    v.id, v.slug, v.title, v.kind, v.status,
    v.group_id, v.g_pl, v.g_en,
    v.anchor_type, v.anchor_id,
    v.is_anonymous,
    -- PROJEKCJA ANONIMOWOSCI: author_id nie opuszcza bazy dla wpisow
    -- anonimowych ani w trybie chatham. Moderator tez go tu nie dostaje -
    -- od ujawnienia jest osobne, audytowane RPC.
    CASE WHEN v.is_anonymous OR v.attribution = 'chatham' THEN NULL ELSE v.author_id END,
    CASE WHEN v.is_anonymous OR v.attribution = 'chatham' THEN NULL
         ELSE COALESCE(NULLIF(btrim(p.display_name), ''),
                       NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
                       'User') END,
    CASE WHEN v.is_anonymous OR v.attribution = 'chatham' OR p.hide_avatar THEN NULL
         ELSE p.avatar_url END,
    CASE WHEN v.is_anonymous OR v.attribution = 'chatham' THEN NULL ELSE p.slug END,
    CASE WHEN v.is_anonymous OR v.attribution = 'chatham'
         THEN public.club_author_alias(v.id, v.author_id) ELSE NULL END,
    v.reply_count, v.participant_count, v.reaction_count,
    v.pinned_at, v.last_reply_at, v.created_at, v.hotness,
    -- Kursor niesie oba pola sortowania, wiec klient nie sklada go sam.
    CASE p_sort
      WHEN 'new' THEN to_char(COALESCE(v.last_reply_at, v.created_at), 'YYYYMMDDHH24MISSMS')
      ELSE to_char(v.hotness, 'FM0000000000.0000000000')
    END || '|' || v.id::text
  FROM visible v
  LEFT JOIN public.profiles p ON p.id = v.author_id
  WHERE p_cursor IS NULL OR (
    CASE p_sort
      WHEN 'new' THEN to_char(COALESCE(v.last_reply_at, v.created_at), 'YYYYMMDDHH24MISSMS')
      ELSE to_char(v.hotness, 'FM0000000000.0000000000')
    END || '|' || v.id::text
  ) < p_cursor
  ORDER BY
    -- Przypiete zawsze na gorze, niezaleznie od sortu.
    (v.pinned_at IS NOT NULL) DESC,
    CASE WHEN p_sort = 'new'
         THEN to_char(COALESCE(v.last_reply_at, v.created_at), 'YYYYMMDDHH24MISSMS')
         ELSE to_char(v.hotness, 'FM0000000000.0000000000') END DESC,
    v.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
$$;

COMMENT ON FUNCTION public.club_threads_list(uuid, uuid, text, text, text, integer) IS
  'Lista tematow z kursorem (klucz sortowania, id) - ZAWSZE z tiebreakerem id. Projekcja anonimowosci: author_id nie opuszcza bazy dla wpisow anonimowych.';

REVOKE EXECUTE ON FUNCTION public.club_threads_list(uuid, uuid, text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_threads_list(uuid, uuid, text, text, text, integer)
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 8) Odczyt: widok watku
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.club_thread_view(uuid, text);

CREATE FUNCTION public.club_thread_view(p_club_id uuid, p_slug text)
RETURNS TABLE (
  id uuid, club_id uuid, group_id uuid, slug text,
  title text, body text, kind text, status text,
  anchor_type text, anchor_id text,
  is_anonymous boolean, author_id uuid, author_name text,
  author_avatar text, author_slug text, author_alias text,
  reply_count integer, participant_count integer, reaction_count integer,
  pinned_at timestamptz, locked_at timestamptz, resolved_reply_id uuid,
  created_at timestamptz, edited_at timestamptz,
  attribution_mode text,
  can_reply boolean, can_moderate boolean, reason text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id, t.club_id, t.group_id, t.slug,
    t.title, t.body, t.kind, t.status,
    t.anchor_type, t.anchor_id,
    t.is_anonymous,
    CASE WHEN t.is_anonymous OR attr.mode = 'chatham' THEN NULL ELSE t.author_id END,
    CASE WHEN t.is_anonymous OR attr.mode = 'chatham' THEN NULL
         ELSE COALESCE(NULLIF(btrim(p.display_name), ''), 'User') END,
    CASE WHEN t.is_anonymous OR attr.mode = 'chatham' OR p.hide_avatar THEN NULL
         ELSE p.avatar_url END,
    CASE WHEN t.is_anonymous OR attr.mode = 'chatham' THEN NULL ELSE p.slug END,
    CASE WHEN t.is_anonymous OR attr.mode = 'chatham'
         THEN public.club_author_alias(t.id, t.author_id) ELSE NULL END,
    t.reply_count, t.participant_count, t.reaction_count,
    t.pinned_at, t.locked_at, t.resolved_reply_id,
    t.created_at, t.edited_at,
    attr.mode,
    -- Zablokowany watek nie przyjmuje odpowiedzi nawet od uprawnionego.
    (cap.can_reply AND t.locked_at IS NULL AND t.status NOT IN ('locked', 'hidden', 'deleted')),
    cap.can_moderate,
    cap.reason
  FROM public.club_threads t
  JOIN public.club_groups g ON g.id = t.group_id
  JOIN public.clubs c ON c.id = t.club_id
  CROSS JOIN LATERAL (
    SELECT COALESCE(g.attribution_mode, c.attribution_mode) AS mode
  ) attr
  CROSS JOIN LATERAL public.club_capabilities(t.club_id, t.group_id, auth.uid()) cap
  LEFT JOIN public.profiles p ON p.id = t.author_id
  WHERE t.club_id = p_club_id
    AND t.slug = p_slug
    AND cap.can_read
    AND (
      t.status IN ('open', 'resolved', 'dormant', 'locked')
      OR cap.can_moderate
      OR (t.status = 'pending' AND t.author_id = auth.uid())
    )
$$;

COMMENT ON FUNCTION public.club_thread_view(uuid, text) IS
  'Widok watku. To jest warstwa projekcji egzekwujaca regule Chatham House - author_id nigdy nie opuszcza bazy w trybie chatham.';

REVOKE EXECUTE ON FUNCTION public.club_thread_view(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_thread_view(uuid, text)
  TO anon, authenticated, service_role;

-- Odpowiedzi watku. Plaska lista z depth - drzewo sklada klient tym samym
-- kodem, co komentarze (buildCommentTree), wiec nie ma dwoch implementacji.
DROP FUNCTION IF EXISTS public.club_replies_list(uuid, text);

CREATE FUNCTION public.club_replies_list(p_thread_id uuid, p_sort text DEFAULT 'chronological')
RETURNS TABLE (
  id uuid, parent_id uuid, depth smallint, body text, status text,
  is_anonymous boolean, author_id uuid, author_name text,
  author_avatar text, author_slug text, author_alias text,
  reaction_count integer, created_at timestamptz, edited_at timestamptz,
  is_resolution boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH thread AS (
    SELECT t.*, COALESCE(g.attribution_mode, c.attribution_mode) AS attribution
      FROM public.club_threads t
      JOIN public.club_groups g ON g.id = t.group_id
      JOIN public.clubs c ON c.id = t.club_id
     WHERE t.id = p_thread_id
  ),
  cap AS (
    SELECT * FROM public.club_capabilities(
      (SELECT club_id FROM thread), (SELECT group_id FROM thread), auth.uid())
  )
  SELECT
    r.id, r.parent_id, r.depth, r.body, r.status,
    r.is_anonymous,
    CASE WHEN r.is_anonymous OR th.attribution = 'chatham' THEN NULL ELSE r.author_id END,
    CASE WHEN r.is_anonymous OR th.attribution = 'chatham' THEN NULL
         ELSE COALESCE(NULLIF(btrim(p.display_name), ''), 'User') END,
    CASE WHEN r.is_anonymous OR th.attribution = 'chatham' OR p.hide_avatar THEN NULL
         ELSE p.avatar_url END,
    CASE WHEN r.is_anonymous OR th.attribution = 'chatham' THEN NULL ELSE p.slug END,
    CASE WHEN r.is_anonymous OR th.attribution = 'chatham'
         THEN public.club_author_alias(r.thread_id, r.author_id) ELSE NULL END,
    r.reaction_count, r.created_at, r.edited_at,
    (th.resolved_reply_id = r.id) AS is_resolution
  FROM public.club_replies r
  CROSS JOIN thread th
  CROSS JOIN cap
  LEFT JOIN public.profiles p ON p.id = r.author_id
  WHERE r.thread_id = p_thread_id
    AND cap.can_read
    AND (
      r.status = 'visible'
      OR cap.can_moderate
      OR (r.status = 'pending' AND r.author_id = auth.uid())
    )
  ORDER BY
    -- Rozstrzygajaca odpowiedz zawsze na gorze, niezaleznie od sortu:
    -- w pytaniu to jest odpowiedz, po ktora ktos przyszedl.
    (th.resolved_reply_id = r.id) DESC NULLS LAST,
    CASE WHEN p_sort = 'best' THEN r.reaction_count ELSE 0 END DESC,
    r.created_at ASC,
    r.id ASC
$$;

COMMENT ON FUNCTION public.club_replies_list(uuid, text) IS
  'Odpowiedzi jako plaska lista z depth - drzewo sklada klient tym samym kodem, co komentarze (buildCommentTree). Rozstrzygajaca odpowiedz zawsze pierwsza.';

REVOKE EXECUTE ON FUNCTION public.club_replies_list(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_replies_list(uuid, text)
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 9) Zapis tresci
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_create_thread(
  p_group_id    uuid,
  p_title       text,
  p_body        text,
  p_kind        text DEFAULT 'discussion',
  p_anonymous   boolean DEFAULT false,
  p_anchor_type text DEFAULT NULL,
  p_anchor_id   text DEFAULT NULL
)
RETURNS TABLE (id uuid, slug text, status text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_group     public.club_groups%ROWTYPE;
  v_club      public.clubs%ROWTYPE;
  v_caps      record;
  v_attr      text;
  v_mod       text;
  v_status    text;
  v_slug      text;
  v_base      text;
  v_n         integer := 0;
  v_recent    integer;
  v_id        uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('discussion','question','position','resource','announcement','poll') THEN
    RAISE EXCEPTION 'clubs: invalid thread kind %', p_kind USING ERRCODE = '22023';
  END IF;

  -- Tabele MUSZA byc aliasowane: funkcja ma parametry OUT o nazwach id/slug/
  -- status, wiec niekwalifikowane `WHERE id = ...` jest dla plpgsql
  -- niejednoznaczne i wywala sie dopiero W RUNTIME (42702), nie przy CREATE.
  SELECT * INTO v_group FROM public.club_groups g WHERE g.id = p_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_club FROM public.clubs c WHERE c.id = v_group.club_id;

  SELECT * INTO v_caps FROM public.club_capabilities(v_group.club_id, p_group_id, v_uid);
  IF NOT COALESCE(v_caps.can_post_thread, false) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  -- Ogloszenie zaklada wylacznie prowadzacy albo moderacja (V1 §1.3).
  IF p_kind = 'announcement' AND NOT COALESCE(v_caps.can_moderate, false) THEN
    RAISE EXCEPTION 'clubs: announcement requires moderator' USING ERRCODE = '42501';
  END IF;

  -- Zasob musi miec kotwice - inaczej nie jest zasobem, tylko dyskusja.
  IF p_kind = 'resource' AND NULLIF(btrim(COALESCE(p_anchor_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'clubs: resource requires an anchor' USING ERRCODE = '22023';
  END IF;

  v_attr := COALESCE(v_group.attribution_mode, v_club.attribution_mode);
  -- Anonimowosc wolno wlaczyc wylacznie tam, gdzie tryb na to pozwala.
  IF p_anonymous AND v_attr = 'attributed' THEN
    RAISE EXCEPTION 'clubs: anonymous posting disabled' USING ERRCODE = '42501';
  END IF;

  -- Antyspam: 10 tematow / 24 h. W bazie, nie w kliencie (V1 §7).
  SELECT count(*)::int INTO v_recent FROM public.club_threads
   WHERE author_id = v_uid AND created_at > now() - interval '24 hours';
  IF v_recent >= 10 THEN
    RAISE EXCEPTION 'clubs: thread rate limit' USING ERRCODE = '42901';
  END IF;

  v_mod := COALESCE(v_group.moderation_mode, v_club.moderation_mode);
  v_status := CASE
    -- Moderacja i staff nie przechodza przez kolejke - premoderacja ma chronic
    -- przed nowymi kontami, nie spowalniac prowadzacych.
    WHEN v_caps.can_moderate THEN 'open'
    WHEN v_mod = 'pre' THEN 'pending'
    WHEN v_mod = 'trusted' AND v_caps.reason = 'pre_moderation' THEN 'pending'
    ELSE 'open'
  END;

  -- Slug z tytulu, z sufiksem przy kolizji. Polskie znaki przez unaccent,
  -- zeby "Rozporządzenie" nie zamienilo sie w ciag myslnikow.
  v_base := NULLIF(regexp_replace(
              lower(unaccent(btrim(p_title))), '[^a-z0-9]+', '-', 'g'
            ), '');
  v_base := btrim(COALESCE(v_base, 'temat'), '-');
  v_base := left(v_base, 60);
  v_slug := v_base;
  WHILE EXISTS (SELECT 1 FROM public.club_threads
                 WHERE club_id = v_group.club_id AND club_threads.slug = v_slug) LOOP
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n::text;
  END LOOP;

  INSERT INTO public.club_threads (
    tenant_id, club_id, group_id, author_id, slug, title, body, kind, status,
    is_anonymous, anchor_type, anchor_id
  ) VALUES (
    v_club.tenant_id, v_group.club_id, p_group_id, v_uid, v_slug,
    btrim(p_title), btrim(p_body), p_kind, v_status,
    COALESCE(p_anonymous, false),
    NULLIF(p_anchor_type, ''), NULLIF(btrim(COALESCE(p_anchor_id, '')), '')
  )
  RETURNING club_threads.id INTO v_id;

  id := v_id; slug := v_slug; status := v_status;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.club_create_thread(uuid, text, text, text, boolean, text, text) IS
  'Zaklada temat. Bramka przez club_capabilities, limit 10/24h w bazie, premoderacja omija moderacje. Slug z unaccent, zeby polskie znaki nie dawaly ciagu myslnikow.';

REVOKE EXECUTE ON FUNCTION public.club_create_thread(uuid, text, text, text, boolean, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_create_thread(uuid, text, text, text, boolean, text, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_reply(
  p_thread_id uuid,
  p_body      text,
  p_parent_id uuid DEFAULT NULL,
  p_anonymous boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_thread public.club_threads%ROWTYPE;
  v_caps   record;
  v_attr   text;
  v_mod    text;
  v_status text;
  v_recent integer;
  v_burst  integer;
  v_id     uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_thread FROM public.club_threads WHERE id = p_thread_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;
  IF v_thread.locked_at IS NOT NULL
     OR v_thread.status IN ('locked', 'hidden', 'deleted') THEN
    RAISE EXCEPTION 'clubs: thread locked' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_caps FROM public.club_capabilities(v_thread.club_id, v_thread.group_id, v_uid);
  IF NOT COALESCE(v_caps.can_reply, false) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(g.attribution_mode, c.attribution_mode),
         COALESCE(g.moderation_mode, c.moderation_mode)
    INTO v_attr, v_mod
    FROM public.club_groups g JOIN public.clubs c ON c.id = g.club_id
   WHERE g.id = v_thread.group_id;

  IF p_anonymous AND v_attr = 'attributed' THEN
    RAISE EXCEPTION 'clubs: anonymous posting disabled' USING ERRCODE = '42501';
  END IF;

  -- Dwa limity o roznym celu: dobowy przeciw zalewaniu, minutowy przeciw
  -- botowi. Jeden bez drugiego zostawia otwarta furtke.
  SELECT count(*)::int INTO v_recent FROM public.club_replies
   WHERE author_id = v_uid AND created_at > now() - interval '24 hours';
  IF v_recent >= 60 THEN
    RAISE EXCEPTION 'clubs: reply rate limit' USING ERRCODE = '42901';
  END IF;
  SELECT count(*)::int INTO v_burst FROM public.club_replies
   WHERE author_id = v_uid AND created_at > now() - interval '1 minute';
  IF v_burst >= 5 THEN
    RAISE EXCEPTION 'clubs: reply burst limit' USING ERRCODE = '42901';
  END IF;

  v_status := CASE
    WHEN v_caps.can_moderate THEN 'visible'
    WHEN v_mod = 'pre' THEN 'pending'
    WHEN v_mod = 'trusted' AND v_caps.reason = 'pre_moderation' THEN 'pending'
    ELSE 'visible'
  END;

  INSERT INTO public.club_replies (
    tenant_id, club_id, thread_id, author_id, parent_id, body, is_anonymous, status
  ) VALUES (
    v_thread.tenant_id, v_thread.club_id, p_thread_id, v_uid, p_parent_id,
    btrim(p_body), COALESCE(p_anonymous, false), v_status
  )
  RETURNING club_replies.id INTO v_id;

  -- Temat, na ktory ktos odpowiedzial, przestaje byc uspiony.
  IF v_thread.status = 'dormant' AND v_status = 'visible' THEN
    UPDATE public.club_threads SET status = 'open' WHERE id = p_thread_id;
  END IF;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.club_reply(uuid, text, uuid, boolean) IS
  'Dodaje odpowiedz. Glebokosc wylicza trigger z rodzica (splaszczenie na poziomie 2). Dwa limity: dobowy przeciw zalewaniu, minutowy przeciw botowi.';

REVOKE EXECUTE ON FUNCTION public.club_reply(uuid, text, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_reply(uuid, text, uuid, boolean)
  TO authenticated, service_role;

-- Edycja w oknie 15 minut. Po oknie tresc zostaje, ale `edited_at` jest
-- widoczne - deliberacja, w ktorej mozna po cichu przepisac swoja teze,
-- nie jest deliberacja.
CREATE OR REPLACE FUNCTION public.club_edit_thread(
  p_thread_id uuid, p_title text, p_body text
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_t   public.club_threads%ROWTYPE;
BEGIN
  SELECT * INTO v_t FROM public.club_threads WHERE id = p_thread_id;
  IF NOT FOUND OR v_t.author_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_t.created_at < now() - interval '15 minutes' THEN
    RAISE EXCEPTION 'clubs: edit window closed' USING ERRCODE = '42501';
  END IF;

  UPDATE public.club_threads
     SET title = COALESCE(NULLIF(btrim(p_title), ''), title),
         body  = COALESCE(NULLIF(btrim(p_body), ''), body),
         edited_at = now(),
         edit_count = edit_count + 1
   WHERE id = p_thread_id;
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_edit_thread(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_edit_thread(uuid, text, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_edit_reply(p_reply_id uuid, p_body text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_r   public.club_replies%ROWTYPE;
BEGIN
  SELECT * INTO v_r FROM public.club_replies WHERE id = p_reply_id;
  IF NOT FOUND OR v_r.author_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_r.created_at < now() - interval '15 minutes' THEN
    RAISE EXCEPTION 'clubs: edit window closed' USING ERRCODE = '42501';
  END IF;

  UPDATE public.club_replies
     SET body = btrim(p_body), edited_at = now(), edit_count = edit_count + 1
   WHERE id = p_reply_id;
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_edit_reply(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_edit_reply(uuid, text) TO authenticated, service_role;

-- Oznaczenie odpowiedzi rozstrzygajacej. Moze to zrobic autor pytania albo
-- moderacja - autor wie, co odpowiedzialo na jego pytanie.
CREATE OR REPLACE FUNCTION public.club_resolve_thread(
  p_thread_id uuid, p_reply_id uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_t    public.club_threads%ROWTYPE;
  v_caps record;
BEGIN
  SELECT * INTO v_t FROM public.club_threads WHERE id = p_thread_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;
  IF v_t.kind <> 'question' THEN
    RAISE EXCEPTION 'clubs: only questions can be resolved' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_caps FROM public.club_capabilities(v_t.club_id, v_t.group_id, v_uid);
  IF v_t.author_id IS DISTINCT FROM v_uid AND NOT COALESCE(v_caps.can_moderate, false) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_reply_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.club_replies
                      WHERE id = p_reply_id AND thread_id = p_thread_id
                        AND status = 'visible') THEN
    RAISE EXCEPTION 'clubs: invalid reply' USING ERRCODE = '23503';
  END IF;

  UPDATE public.club_threads
     SET resolved_reply_id = p_reply_id,
         status = CASE WHEN p_reply_id IS NULL THEN 'open' ELSE 'resolved' END
   WHERE id = p_thread_id;
  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.club_resolve_thread(uuid, uuid) IS
  'Oznacza odpowiedz rozstrzygajaca. NULL cofa oznaczenie i wraca do statusu open. Moze autor pytania albo moderacja.';

REVOKE EXECUTE ON FUNCTION public.club_resolve_thread(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_resolve_thread(uuid, uuid)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 10) Usypianie tematow (V1 §1.3)
--
-- Watek bez odpowiedzi przez 90 dni dostaje 'dormant' i wypada z rankingu -
-- BEZ kasowania. To utrzymuje klub czytelnym bez moderacyjnej pracy recznej.
-- Wolane z jobs-tick, nie z wlasnego crona.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_threads_mark_dormant(p_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH stale AS (
    SELECT id FROM public.club_threads
     WHERE status = 'open'
       AND pinned_at IS NULL
       AND COALESCE(last_reply_at, created_at) < now() - interval '90 days'
     LIMIT GREATEST(COALESCE(p_limit, 500), 1)
  )
  UPDATE public.club_threads t SET status = 'dormant'
    FROM stale s WHERE t.id = s.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.club_threads_mark_dormant(integer) IS
  'Usypia tematy bez odpowiedzi przez 90 dni - bez kasowania. Przypiete sa wylaczone: przypiecie to jawna decyzja, ze temat ma zostac na wierzchu.';

REVOKE EXECUTE ON FUNCTION public.club_threads_mark_dormant(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_threads_mark_dormant(integer) TO service_role;

-- Odswiezenie rankingu: mianownik rosnie z czasem sam z siebie, wiec bez
-- cyklicznego przeliczenia stary temat trzymalby wysoka pozycje w nieskonczonosc.
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
  )
  UPDATE public.club_threads t
     SET hotness = public.club_thread_hotness(
           0, a.reply_count, a.participant_count, 0, a.created_at)
    FROM active a WHERE t.id = a.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_threads_refresh_hotness(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_threads_refresh_hotness(integer) TO service_role;
