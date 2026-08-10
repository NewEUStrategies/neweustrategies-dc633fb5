-- ============================================================================
-- A32: KLUB JAKO SIEC LUDZI, NIE ARCHIWUM TRESCI
--
-- Do A31 wlacznie caly modul odpowiadal na pytanie "co tu napisano". Kazda
-- powierzchnia liczyla TRESC: watki, odpowiedzi, dokumenty, terminy. To jest
-- poprawny opis forum i bardzo zly opis think tanku, w ktorym wartosc powstaje
-- miedzy ludzmi, a tekst jest tylko jej sladem. Ta migracja doklada cztery
-- byty, ktorych w schemacie nie bylo, i naprawia jeden, ktory podwazal
-- wiarygodnosc calej reszty.
--
-- 1) OGLOSZENIA "SZUKAM / OFERUJE" (`club_board_notices`). Networking nie
--    zalamuje sie z braku ludzi, tylko z braku PRETEKSTU do odezwania sie.
--    Jedna linia ("szukam kontaktu w MON", "moge udostepnic analize X") jest
--    tym pretekstem i - w odroznieniu od watku - nie zobowiazuje autora do
--    prowadzenia dyskusji. Dlatego to OSOBNA tabela, a nie `club_threads.kind`:
--    ogloszenie ma date waznosci, stan "zalatwione" i zero odpowiedzi w miejscu
--    publikacji (rozmowa idzie do DM).
--
-- 2) ZADEKLAROWANA KOMPETENCJA (`club_member_expertise`). Najcenniejsza
--    asymetria informacyjna w klubie to wiedza o tym, KTO realnie pracowal nad
--    dana sprawa. Deklaracja jest zawezona DO KLUBU, nie globalna: ten sam
--    czlowiek jest ekspertem od amunicji w klubie obronnym i zwyklym czlonkiem
--    w klubie transportowym, a globalny znacznik zamienilby to w szum.
--    Katalog kluczy jest ten sam, co `club_topics` - obszar tematyczny watku
--    i deklaracja czlonka MUSZA byc porownywalne, inaczej modul kontekstowy
--    nie ma czego dopasowac.
--
-- 3) PROSBA O ZDANIE (`club_expert_pings`). Akcja "popros o zdanie" bez sladu
--    w bazie jest przyciskiem, ktory mozna nacisnac dwadziescia razy. Slad
--    daje deduplikacje (jeden pytajacy prosi te sama osobe w tym samym watku
--    raz) i pozwala pokazac w interfejsie, ze prosba juz poszla.
--
-- 4) POZNAJ CZLONKA (`club_member_spotlight`). Rotacja tygodniowa jest
--    LICZONA, nie planowana: klub, ktory musi co tydzien cos wgrac, przestaje
--    to robic w trzecim tygodniu. Redakcja moze przypiac wlasny opis na
--    konkretny tydzien; brak wpisu nie wylacza modulu, tylko przelacza go na
--    deterministyczna rotacje po skladzie.
--
-- 5) NAPRAWA SKLADU. Klub referencyjny pokazywal "0 czlonkow" przy siedmiu
--    watkach i widocznej aktywnosci. To nie byl blad licznika: `member_count`
--    liczy sie poprawnie z `club_members`, tylko ta tabela byla PUSTA, bo
--    watki zakladal ktos, kto ma `can_post_thread` z roli platformy, a nie
--    z czlonkostwa. Kazdy modul skladu zbudowany nad takim stanem klamie,
--    zanim ktokolwiek go przeczyta - wiec zamykamy zrodlo: kto pisze w klubie,
--    ten w tym klubie JEST. Trigger dopisuje autora do skladu, backfill robi
--    to samo dla historii, a `member_count` przelicza sie na koniec.
--
--    To NIE jest podniesienie uprawnien. Autor przeszedl juz bramke
--    `club_capabilities` przy pisaniu, ktora jest scisle mocniejsza niz
--    czlonkostwo; wiersz w `club_members` z rola 'member' nie daje mu ani
--    jednej zdolnosci, ktorej by wczesniej nie mial.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) OGLOSZENIA: SZUKAM / OFERUJE
--
-- `body` w jednej linii - limit 280 znakow i zakaz znaku nowej linii sa
-- CELOWE. Ogloszenie, ktore mozna rozwinac do akapitu, w ciagu miesiaca staje
-- sie krotkim watkiem, a wtedy modul dubluje strumien zamiast go zasilac.
--
-- `expires_at` z wartoscia domyslna: tablica ogloszen bez daty waznosci to
-- tablica z zeszlego roku. Wygaszenie jest CZYTANE przy odczycie, a nie
-- sprzatane jobem - martwe ogloszenie znika z listy w sekundzie, w ktorej
-- przestalo byc aktualne, bez zadnego harmonogramu.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.club_board_notices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  club_id      uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  group_id     uuid REFERENCES public.club_groups(id) ON DELETE SET NULL,
  author_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  kind         text NOT NULL CHECK (kind IN ('seeking', 'offering')),
  body         text NOT NULL,
  -- Klucz z katalogu `club_topics`. Bez wiezow do tabeli katalogu: obszar
  -- wylaczony przez redakcje ma zostac na starym ogloszeniu, a nie skasowac go
  -- kaskada (ta sama doktryna, co przy `club_threads.topic`).
  topic        text,

  status       text NOT NULL DEFAULT 'open'
               CHECK (status IN ('open', 'closed', 'removed')),
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  closed_at    timestamptz,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT club_board_notices_body_len
    CHECK (char_length(btrim(body)) BETWEEN 8 AND 280),
  -- Jedna linia znaczy jedna linie. Bez tego pierwszy wklejony akapit
  -- rozjezdza cala liste. Warunek przez `position`, a nie przez klase regexowa:
  -- interpretacja `\n` w literale zalezy od `standard_conforming_strings`,
  -- a ograniczenie tabeli nie moze zalezec od ustawienia sesji.
  CONSTRAINT club_board_notices_single_line
    CHECK (position(chr(10) IN body) = 0 AND position(chr(13) IN body) = 0),
  CONSTRAINT club_board_notices_closed_pair
    CHECK ((status = 'open') = (closed_at IS NULL))
);

-- Lista otwiera sie ZAWSZE tak samo: klub + otwarte + najnowsze na gorze.
CREATE INDEX IF NOT EXISTS club_board_notices_open_idx
  ON public.club_board_notices (club_id, created_at DESC)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS club_board_notices_author_idx
  ON public.club_board_notices (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS club_board_notices_tenant_idx
  ON public.club_board_notices (tenant_id, club_id);

COMMENT ON TABLE public.club_board_notices IS
  'Ogloszenia czlonkow "szukam / oferuje". Jedna linia, data waznosci, rozmowa w DM - swiadomie NIE jest to watek.';
COMMENT ON COLUMN public.club_board_notices.expires_at IS
  'Waznosc czytana przy ODCZYCIE, nie sprzatana jobem - ogloszenie znika z listy w chwili wygasniecia.';

-- ----------------------------------------------------------------------------
-- 2) ZADEKLAROWANA KOMPETENCJA
--
-- Klucz glowny (club_id, user_id, topic) zamiast surogatu: deklaracja jest
-- FAKTEM, a nie zdarzeniem - powtorzenie tego samego wyboru nie ma prawa
-- utworzyc drugiego wiersza.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.club_member_expertise (
  club_id    uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  topic      text NOT NULL,
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (club_id, user_id, topic),
  CONSTRAINT club_member_expertise_topic_format
    CHECK (topic ~ '^[a-z][a-z0-9_]{1,48}$')
);

-- Zapytanie modulu brzmi "kto w tym klubie zna sie na X" - to jest ten indeks.
CREATE INDEX IF NOT EXISTS club_member_expertise_topic_idx
  ON public.club_member_expertise (club_id, topic);
CREATE INDEX IF NOT EXISTS club_member_expertise_tenant_idx
  ON public.club_member_expertise (tenant_id, club_id);

COMMENT ON TABLE public.club_member_expertise IS
  'Kompetencja zadeklarowana W KLUBIE (nie globalnie). Klucze zgodne z katalogiem club_topics, zeby obszar watku dalo sie dopasowac do czlonka.';

-- ----------------------------------------------------------------------------
-- 3) PROSBA O ZDANIE
--
-- Trojka (watek, adresat, pytajacy) jest kluczem: dwie rozne osoby maja prawo
-- poprosic tego samego eksperta o zdanie w tym samym watku, ta sama osoba -
-- nie.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.club_expert_pings (
  thread_id    uuid NOT NULL REFERENCES public.club_threads(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (thread_id, user_id, requested_by),
  CONSTRAINT club_expert_pings_not_self CHECK (user_id <> requested_by)
);

CREATE INDEX IF NOT EXISTS club_expert_pings_thread_idx
  ON public.club_expert_pings (thread_id, created_at DESC);

COMMENT ON TABLE public.club_expert_pings IS
  'Slad prosby o zdanie w watku. Deduplikuje akcje i pozwala interfejsowi powiedziec "prosba juz poszla".';

-- ----------------------------------------------------------------------------
-- 4) POZNAJ CZLONKA - przypiecie redakcyjne
--
-- `week_start` to PONIEDZIALEK tygodnia ISO. Kolumna generowana z daty podanej
-- przez redakcje bylaby zbedna: RPC i tak liczy biezacy poniedzialek, a
-- ograniczenie ponizej pilnuje, ze wpis dotyczy calego tygodnia, a nie srody.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.club_member_spotlight (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  club_id    uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  week_start date NOT NULL,
  blurb_pl   text,
  blurb_en   text,

  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT club_member_spotlight_week_is_monday
    CHECK (EXTRACT(ISODOW FROM week_start) = 1),
  CONSTRAINT club_member_spotlight_blurb_len
    CHECK (
      (blurb_pl IS NULL OR char_length(btrim(blurb_pl)) BETWEEN 10 AND 600) AND
      (blurb_en IS NULL OR char_length(btrim(blurb_en)) BETWEEN 10 AND 600)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS club_member_spotlight_week_key
  ON public.club_member_spotlight (club_id, week_start);

COMMENT ON TABLE public.club_member_spotlight IS
  'Przypiecie redakcyjne "poznaj czlonka" na konkretny tydzien. Brak wpisu NIE wylacza modulu - RPC schodzi wtedy na deterministyczna rotacje po skladzie.';

-- ----------------------------------------------------------------------------
-- 5) RLS: deny-all. Tabele sa RPC-only, tak jak cala reszta modulu.
-- ----------------------------------------------------------------------------
ALTER TABLE public.club_board_notices     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_member_expertise  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_expert_pings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_member_spotlight  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.club_board_notices    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.club_member_expertise FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.club_expert_pings     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.club_member_spotlight FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.club_board_notices    TO service_role;
GRANT ALL ON public.club_member_expertise TO service_role;
GRANT ALL ON public.club_expert_pings     TO service_role;
GRANT ALL ON public.club_member_spotlight TO service_role;

-- ----------------------------------------------------------------------------
-- 6) Triggery: pinowanie tenanta i updated_at
--
-- `club_child_pin_tenant()` (A1) wyprowadza tenanta z `NEW.club_id` i ignoruje
-- wartosc podana przez wolajacego. `club_expert_pings` nie ma `club_id`, wiec
-- idzie przez watek.
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS club_board_notices_pin_tenant_tg ON public.club_board_notices;
CREATE TRIGGER club_board_notices_pin_tenant_tg
  BEFORE INSERT OR UPDATE ON public.club_board_notices
  FOR EACH ROW EXECUTE FUNCTION public.club_child_pin_tenant();

DROP TRIGGER IF EXISTS club_member_expertise_pin_tenant_tg ON public.club_member_expertise;
CREATE TRIGGER club_member_expertise_pin_tenant_tg
  BEFORE INSERT OR UPDATE ON public.club_member_expertise
  FOR EACH ROW EXECUTE FUNCTION public.club_child_pin_tenant();

DROP TRIGGER IF EXISTS club_member_spotlight_pin_tenant_tg ON public.club_member_spotlight;
CREATE TRIGGER club_member_spotlight_pin_tenant_tg
  BEFORE INSERT OR UPDATE ON public.club_member_spotlight
  FOR EACH ROW EXECUTE FUNCTION public.club_child_pin_tenant();

CREATE OR REPLACE FUNCTION public.club_expert_ping_pin_tenant()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT t.tenant_id INTO v_tenant FROM public.club_threads t WHERE t.id = NEW.thread_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'clubs: unknown thread %', NEW.thread_id USING ERRCODE = '23503';
  END IF;
  NEW.tenant_id := v_tenant;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS club_expert_pings_pin_tenant_tg ON public.club_expert_pings;
CREATE TRIGGER club_expert_pings_pin_tenant_tg
  BEFORE INSERT OR UPDATE ON public.club_expert_pings
  FOR EACH ROW EXECUTE FUNCTION public.club_expert_ping_pin_tenant();

DROP TRIGGER IF EXISTS club_board_notices_set_updated_tg ON public.club_board_notices;
CREATE TRIGGER club_board_notices_set_updated_tg BEFORE UPDATE ON public.club_board_notices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS club_member_spotlight_set_updated_tg ON public.club_member_spotlight;
CREATE TRIGGER club_member_spotlight_set_updated_tg BEFORE UPDATE ON public.club_member_spotlight
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 7) NAPRAWA SKLADU: kto pisze w klubie, ten w tym klubie JEST
--
-- Patrz punkt 5 naglowka. Funkcja jest CICHA z zalozenia: dopisanie do skladu
-- jest efektem UBOCZNYM napisania wpisu i nie ma prawa wywrocic transakcji,
-- ktora ten wpis tworzy. Konflikt na (club_id, user_id) znaczy "juz jest" -
-- i to jest poprawny wynik, nie blad.
--
-- Rola 'member' i `invite_source = 'auto'`: skad wziela sie ta osoba w skladzie
-- musi zostac w danych, inaczej za rok nikt nie odrozni czlonka zaproszonego od
-- dopisanego przez ten trigger.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.club_autojoin_author()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.author_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.club_members (club_id, user_id, tenant_id, role, status, invite_source)
  SELECT NEW.club_id, NEW.author_id, c.tenant_id, 'member', 'active', 'auto'
    FROM public.clubs c
   WHERE c.id = NEW.club_id
  ON CONFLICT (club_id, user_id) DO NOTHING;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Skladu nie ma prawa zabraknac tak, zeby wpis nie powstal.
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.club_autojoin_author() IS
  'Dopisuje autora wpisu do skladu klubu (rola member, zrodlo auto). Nie podnosi uprawnien: autor przeszedl juz mocniejsza bramke club_capabilities przy pisaniu.';

DROP TRIGGER IF EXISTS club_threads_autojoin_tg ON public.club_threads;
CREATE TRIGGER club_threads_autojoin_tg
  AFTER INSERT ON public.club_threads
  FOR EACH ROW EXECUTE FUNCTION public.club_autojoin_author();

DROP TRIGGER IF EXISTS club_replies_autojoin_tg ON public.club_replies;
CREATE TRIGGER club_replies_autojoin_tg
  AFTER INSERT ON public.club_replies
  FOR EACH ROW EXECUTE FUNCTION public.club_autojoin_author();

DROP TRIGGER IF EXISTS club_posts_autojoin_tg ON public.club_posts;
CREATE TRIGGER club_posts_autojoin_tg
  AFTER INSERT ON public.club_posts
  FOR EACH ROW EXECUTE FUNCTION public.club_autojoin_author();

-- Backfill historii + przeliczenie licznika. Jedno przejscie, idempotentne.
INSERT INTO public.club_members (club_id, user_id, tenant_id, role, status, invite_source, joined_at)
SELECT a.club_id, a.author_id, c.tenant_id, 'member', 'active', 'auto', a.first_at
  FROM (
    SELECT club_id, author_id, min(created_at) AS first_at
      FROM public.club_threads
     WHERE author_id IS NOT NULL
     GROUP BY club_id, author_id
    UNION
    SELECT club_id, author_id, min(created_at)
      FROM public.club_replies
     WHERE author_id IS NOT NULL
     GROUP BY club_id, author_id
    UNION
    SELECT club_id, author_id, min(created_at)
      FROM public.club_posts
     WHERE author_id IS NOT NULL
     GROUP BY club_id, author_id
  ) a
  JOIN public.clubs c ON c.id = a.club_id
ON CONFLICT (club_id, user_id) DO NOTHING;

UPDATE public.clubs c
   SET member_count = COALESCE(m.total, 0)
  FROM (
    SELECT club_id, count(*)::int AS total
      FROM public.club_members
     WHERE status = 'active'
     GROUP BY club_id
  ) m
 WHERE m.club_id = c.id
   AND c.member_count IS DISTINCT FROM m.total;

-- ============================================================================
-- 8) RPC: OGLOSZENIA
-- ============================================================================
DROP FUNCTION IF EXISTS public.club_board_notices_list(uuid, text, text, integer, integer);

CREATE FUNCTION public.club_board_notices_list(
  p_club_id uuid,
  p_kind    text    DEFAULT NULL,
  p_topic   text    DEFAULT NULL,
  p_limit   integer DEFAULT 8,
  p_offset  integer DEFAULT 0
)
RETURNS TABLE (
  id uuid, kind text, body text, topic text,
  author_id uuid, author_name text, author_avatar text, author_slug text,
  author_headline text,
  created_at timestamptz, expires_at timestamptz,
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
       AND n.status = 'open'
       AND n.expires_at > now()
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
    v.author_id = auth.uid(),
    (v.author_id = auth.uid() OR cap.can_moderate),
    count(*) OVER ()
  FROM visible v
  CROSS JOIN cap
  JOIN public.profiles p ON p.id = v.author_id
  ORDER BY v.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 8), 1), 50)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$$;

COMMENT ON FUNCTION public.club_board_notices_list(uuid, text, text, integer, integer) IS
  'Otwarte i niewygasle ogloszenia klubu. Waznosc odsiewana przy odczycie - bez jobu sprzatajacego.';

REVOKE EXECUTE ON FUNCTION public.club_board_notices_list(uuid, text, text, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_board_notices_list(uuid, text, text, integer, integer)
  TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.club_board_notice_create(uuid, text, text, text, integer);

CREATE FUNCTION public.club_board_notice_create(
  p_club_id uuid,
  p_kind    text,
  p_body    text,
  p_topic   text    DEFAULT NULL,
  p_days    integer DEFAULT 30
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caps  record;
  v_body  text := btrim(regexp_replace(COALESCE(p_body, ''), '\s+', ' ', 'g'));
  v_topic text := NULLIF(btrim(COALESCE(p_topic, '')), '');
  v_days  integer := LEAST(GREATEST(COALESCE(p_days, 30), 1), 90);
  v_open  integer;
  v_id    uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'club_board_notice_create: unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_caps FROM public.club_capabilities(p_club_id, NULL, auth.uid());
  -- Prog jest ten sam, co przy odpowiedzi: ogloszenie to glos w klubie,
  -- a nie akt kuratorski.
  IF NOT COALESCE(v_caps.can_reply, false) THEN
    RAISE EXCEPTION 'club_board_notice_create: forbidden' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(p_kind, '') NOT IN ('seeking', 'offering') THEN
    RAISE EXCEPTION 'club_board_notice_create: bad kind' USING ERRCODE = '22023';
  END IF;

  IF char_length(v_body) < 8 OR char_length(v_body) > 280 THEN
    RAISE EXCEPTION 'club_board_notice_create: bad body length' USING ERRCODE = '22023';
  END IF;

  IF v_topic IS NOT NULL AND v_topic !~ '^[a-z][a-z0-9_]{1,48}$' THEN
    RAISE EXCEPTION 'club_board_notice_create: bad topic' USING ERRCODE = '22023';
  END IF;

  -- Tablica nalezy do klubu, nie do jednej osoby. Limit jest niski celowo:
  -- pieciu otwartych ogloszen nie da sie przekroczyc uczciwym uzyciem, a
  -- zalanie tablicy jednym nadawca zabija modul dla wszystkich pozostalych.
  SELECT count(*)::int INTO v_open
    FROM public.club_board_notices n
   WHERE n.club_id = p_club_id
     AND n.author_id = auth.uid()
     AND n.status = 'open'
     AND n.expires_at > now();
  IF v_open >= 5 THEN
    RAISE EXCEPTION 'club_board_notice_create: too many open notices' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.club_board_notices (club_id, author_id, tenant_id, kind, body, topic, expires_at)
  SELECT p_club_id, auth.uid(), c.tenant_id, p_kind, v_body, v_topic,
         now() + make_interval(days => v_days)
    FROM public.clubs c WHERE c.id = p_club_id
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_board_notice_create(uuid, text, text, text, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_board_notice_create(uuid, text, text, text, integer)
  TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.club_board_notice_close(uuid);

CREATE FUNCTION public.club_board_notice_close(p_notice_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_notice public.club_board_notices%ROWTYPE;
  v_caps   record;
BEGIN
  SELECT * INTO v_notice FROM public.club_board_notices WHERE id = p_notice_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT * INTO v_caps FROM public.club_capabilities(v_notice.club_id, NULL, auth.uid());
  IF v_notice.author_id <> auth.uid() AND NOT COALESCE(v_caps.can_moderate, false) THEN
    RAISE EXCEPTION 'club_board_notice_close: forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.club_board_notices
     SET status = CASE WHEN v_notice.author_id = auth.uid() THEN 'closed' ELSE 'removed' END,
         closed_at = now()
   WHERE id = p_notice_id AND status = 'open';

  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.club_board_notice_close(uuid) IS
  'Zamkniecie ogloszenia. Autor "zalatwil" (closed), moderacja "zdjela" (removed) - dwa rozne fakty, dwa rozne stany.';

REVOKE EXECUTE ON FUNCTION public.club_board_notice_close(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_board_notice_close(uuid) TO authenticated, service_role;

-- ============================================================================
-- 9) RPC: KOMPETENCJE
-- ============================================================================
DROP FUNCTION IF EXISTS public.club_expertise_set(uuid, text[]);

CREATE FUNCTION public.club_expertise_set(p_club_id uuid, p_topics text[])
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caps   record;
  v_topics text[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'club_expertise_set: unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_caps FROM public.club_capabilities(p_club_id, NULL, auth.uid());
  IF NOT COALESCE(v_caps.can_read, false) THEN
    RAISE EXCEPTION 'club_expertise_set: forbidden' USING ERRCODE = '42501';
  END IF;

  -- Normalizacja W BAZIE, nie w kliencie: ten sam zbior przychodzi z panelu,
  -- z modulu skladu i z importu, a rozjazd bylby widoczny dopiero jako
  -- ekspert, ktorego modul kontekstowy nie znajduje.
  SELECT COALESCE(array_agg(DISTINCT topic), ARRAY[]::text[]) INTO v_topics
    FROM (
      SELECT lower(btrim(t)) AS topic
        FROM unnest(COALESCE(p_topics, ARRAY[]::text[])) AS t
    ) s
   WHERE s.topic ~ '^[a-z][a-z0-9_]{1,48}$';

  IF array_length(v_topics, 1) > 12 THEN
    RAISE EXCEPTION 'club_expertise_set: too many topics' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.club_member_expertise e
   WHERE e.club_id = p_club_id
     AND e.user_id = auth.uid()
     AND NOT (e.topic = ANY (v_topics));

  INSERT INTO public.club_member_expertise (club_id, user_id, tenant_id, topic)
  SELECT p_club_id, auth.uid(), c.tenant_id, t
    FROM unnest(v_topics) AS t
    CROSS JOIN public.clubs c
   WHERE c.id = p_club_id
  ON CONFLICT (club_id, user_id, topic) DO NOTHING;

  RETURN COALESCE(array_length(v_topics, 1), 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_expertise_set(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_expertise_set(uuid, text[]) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.club_expertise_mine(uuid);

CREATE FUNCTION public.club_expertise_mine(p_club_id uuid)
RETURNS TABLE (topic text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.topic
    FROM public.club_member_expertise e
   WHERE e.club_id = p_club_id
     AND e.user_id = auth.uid()
   ORDER BY e.topic
$$;

REVOKE EXECUTE ON FUNCTION public.club_expertise_mine(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_expertise_mine(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 10) RPC: EKSPERCI TEGO WATKU
--
-- Obszar bierzemy z watku, a gdy watek go nie ma - z klubu. Klub bez obszaru
-- i watek bez obszaru daja PUSTA liste, a nie liste wszystkich czlonkow:
-- "ekspert" bez dziedziny to zwykly czlonek, a modul, ktory tego nie rozroznia,
-- jest druga kopia skladu.
--
-- Kolejnosc jest teza: NAJPIERW ci, ktorych w watku jeszcze nie ma. Czlonek,
-- ktory juz sie wypowiedzial, jest widoczny w dyskusji i nie potrzebuje
-- drugiego miejsca na ekranie - cala wartosc tego panelu to ludzie, ktorych
-- czytelnik NIE widzi.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.club_thread_experts(uuid, integer);

CREATE FUNCTION public.club_thread_experts(p_thread_id uuid, p_limit integer DEFAULT 6)
RETURNS TABLE (
  user_id uuid, display_name text, avatar_url text, profile_slug text,
  headline text, club_role text, topics text[],
  in_thread boolean, pinged_by_me boolean, topic text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH th AS (
    SELECT t.id, t.club_id, t.author_id,
           COALESCE(NULLIF(btrim(COALESCE(t.topic, '')), ''),
                    NULLIF(btrim(COALESCE(c.policy_area, '')), '')) AS topic
      FROM public.club_threads t
      JOIN public.clubs c ON c.id = t.club_id
     WHERE t.id = p_thread_id
  ),
  cap AS (
    SELECT c.* FROM th CROSS JOIN LATERAL public.club_capabilities(th.club_id, NULL, auth.uid()) c
  ),
  spoke AS (
    SELECT DISTINCT r.author_id
      FROM public.club_replies r
     WHERE r.thread_id = p_thread_id
       AND r.author_id IS NOT NULL
       AND r.status = 'visible'
    UNION
    SELECT th.author_id FROM th WHERE th.author_id IS NOT NULL
  ),
  candidates AS (
    SELECT
      m.user_id,
      public.club_effective_member_role(m.role, m.role_expires_at) AS club_role,
      array_agg(DISTINCT e.topic ORDER BY e.topic) AS topics,
      bool_or(e.topic = th.topic) AS matches
      FROM th
      CROSS JOIN cap
      JOIN public.club_member_expertise e ON e.club_id = th.club_id
      JOIN public.club_members m
        ON m.club_id = th.club_id AND m.user_id = e.user_id AND m.status = 'active'
     WHERE th.topic IS NOT NULL
       AND cap.can_read
       AND cap.can_see_members
     GROUP BY m.user_id, m.role, m.role_expires_at, th.topic
  )
  SELECT
    c.user_id,
    COALESCE(NULLIF(btrim(p.display_name), ''),
             NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'User'),
    CASE WHEN p.hide_avatar THEN NULL ELSE p.avatar_url END,
    p.slug,
    NULLIF(btrim(concat_ws(' - ', NULLIF(btrim(p.job_title), ''),
                                  NULLIF(btrim(p.current_company), ''))), ''),
    c.club_role,
    c.topics,
    (s.author_id IS NOT NULL),
    (g.user_id IS NOT NULL),
    th.topic
  FROM candidates c
  CROSS JOIN th
  JOIN public.profiles p ON p.id = c.user_id
  LEFT JOIN spoke s ON s.author_id = c.user_id
  LEFT JOIN public.club_expert_pings g
    ON g.thread_id = p_thread_id AND g.user_id = c.user_id AND g.requested_by = auth.uid()
  WHERE c.matches
    AND c.user_id <> COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
    -- Ta sama regula widocznosci profilu, co w `club_members_list`, sygnale
    -- skladu i liscie obecnosci. Bez niej czlonek, ktory zadeklarowal obszar,
    -- a pozniej wylaczyl widocznosc w katalogu, byl NIEWIDOCZNY na trzech
    -- ekranach i WYPISANY Z NAZWISKA na czwartym - wystarczylo otworzyc watek
    -- z pasujacym obszarem. Deklaracja kompetencji nie jest zgoda na bycie
    -- wymienionym z nazwiska.
    AND p.discoverable
  -- Nieobecni w watku pierwsi, potem szerzej zadeklarowani, na koncu alfabet.
  ORDER BY (s.author_id IS NOT NULL) ASC,
           cardinality(c.topics) DESC,
           lower(COALESCE(p.display_name, '')) ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 6), 1), 20)
$$;

COMMENT ON FUNCTION public.club_thread_experts(uuid, integer) IS
  'Czlonkowie z zadeklarowana kompetencja w obszarze watku. Milczy w klubie ukrywajacym sklad i w watku bez obszaru.';

REVOKE EXECUTE ON FUNCTION public.club_thread_experts(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_thread_experts(uuid, integer) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.club_thread_expert_ping(uuid, uuid);

CREATE FUNCTION public.club_thread_expert_ping(p_thread_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_thread public.club_threads%ROWTYPE;
  v_caps   record;
  v_club   public.clubs%ROWTYPE;
  v_actor  text;
  v_rows   integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'club_thread_expert_ping: unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'club_thread_expert_ping: self' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_thread FROM public.club_threads WHERE id = p_thread_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT * INTO v_caps FROM public.club_capabilities(v_thread.club_id, v_thread.group_id, auth.uid());
  -- Prosic o zdanie moze ten, kto sam moze sie w tym watku odezwac.
  IF NOT COALESCE(v_caps.can_reply, false) THEN
    RAISE EXCEPTION 'club_thread_expert_ping: forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.club_members m
     WHERE m.club_id = v_thread.club_id AND m.user_id = p_user_id AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'club_thread_expert_ping: not a member' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.club_expert_pings (thread_id, user_id, requested_by, tenant_id)
  VALUES (p_thread_id, p_user_id, auth.uid(), v_thread.tenant_id)
  ON CONFLICT (thread_id, user_id, requested_by) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    -- Prosba juz poszla. Cisza jest poprawna odpowiedzia - drugi sygnal do tej
    -- samej osoby w tym samym watku to nie jest przypomnienie, tylko spam.
    RETURN false;
  END IF;

  SELECT * INTO v_club FROM public.clubs WHERE id = v_thread.club_id;
  SELECT COALESCE(NULLIF(btrim(p.display_name), ''), 'User') INTO v_actor
    FROM public.profiles p WHERE p.id = auth.uid();

  PERFORM public.club_notify(
    p_user_id,
    auth.uid(),
    'Poproszono Cie o zdanie',
    'You were asked to weigh in',
    format('%s prosi o Twoje zdanie w temacie "%s".', v_actor, v_thread.title),
    format('%s is asking for your view on "%s".', v_actor, v_thread.title),
    format('/club/%s/t/%s', v_club.slug, v_thread.slug)
  );

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.club_thread_expert_ping(uuid, uuid) IS
  'Prosba o zdanie eksperta w watku. Deduplikowana po trojce (watek, adresat, pytajacy) - powtorzenie zwraca false i nie wysyla drugiego powiadomienia.';

REVOKE EXECUTE ON FUNCTION public.club_thread_expert_ping(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_thread_expert_ping(uuid, uuid) TO authenticated, service_role;

-- ============================================================================
-- 11) RPC: KTO BEDZIE NA SPOTKANIU
--
-- Sama data konwertuje slabo, lista potwierdzonych - mocno: ludzie przychodza
-- do ludzi, nie do tematu. Nazwiska wychodza WYLACZNIE przy `can_see_members`;
-- klub ukrywajacy sklad dostaje pusta liste, a licznik obecnosci i tak jedzie
-- w `club_events_list.going_count`, wiec modul ma co pokazac.
-- ============================================================================
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
  JOIN public.profiles p ON p.id = r.user_id
  -- "Bede" przed "moze": lista, ktora miesza oba stany, przestaje byc
  -- powodem, zeby przyjsc.
  ORDER BY CASE r.state WHEN 'going' THEN 0 ELSE 1 END,
           lower(COALESCE(p.display_name, '')) ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 50)
$$;

REVOKE EXECUTE ON FUNCTION public.club_event_attendees(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_event_attendees(uuid, integer) TO authenticated, service_role;

-- ============================================================================
-- 12) RPC: SKLAD Z SYGNALEM OBECNOSCI
--
-- Jedno wywolanie oddaje CZTERY liczby i twarze, bo to jest jeden panel i nie
-- ma powodu, zeby rysowal sie w czterech ratach.
--
-- Okno 24-godzinne, a nie "dzisiaj": baza stoi w UTC, czytelnik w Warszawie,
-- a "dzisiaj" liczone o polnocy UTC pokazywaloby o 01:00 czasu lokalnego
-- pusty klub, ktory wlasnie tetni. Etykieta w interfejsie mowi wprost "24 h".
-- ============================================================================
DROP FUNCTION IF EXISTS public.club_roster_signal(uuid, integer);

CREATE FUNCTION public.club_roster_signal(p_club_id uuid, p_limit integer DEFAULT 12)
RETURNS TABLE (
  members_total integer,
  new_7d integer,
  active_24h integer,
  active_7d integer,
  people_series integer[],
  faces jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH cap AS (
    SELECT * FROM public.club_capabilities(p_club_id, NULL, auth.uid())
  ),
  -- Okno 14-dniowe zasila iskre, 7-dniowe - liczby. Jedno zrodlo, dwa zakresy:
  -- drugie zapytanie o te same trzy tabele bylo by tym samym skanem po raz drugi.
  acts AS (
    SELECT author_id, created_at FROM public.club_threads
     WHERE club_id = p_club_id AND author_id IS NOT NULL
       AND created_at > now() - interval '14 days'
    UNION ALL
    SELECT author_id, created_at FROM public.club_replies
     WHERE club_id = p_club_id AND author_id IS NOT NULL AND status = 'visible'
       AND created_at > now() - interval '14 days'
    UNION ALL
    SELECT author_id, created_at FROM public.club_posts
     WHERE club_id = p_club_id AND author_id IS NOT NULL AND status = 'published'
       AND created_at > now() - interval '14 days'
  ),
  last_seen AS (
    SELECT author_id, max(created_at) AS last_at
      FROM acts
     WHERE created_at > now() - interval '7 days'
     GROUP BY author_id
  ),
  -- ISKRA LICZY LUDZI, NIE WPISY. Poprzedni panel rysowal sume watkow
  -- i odpowiedzi, czyli mowil o TRESCI - jedna osoba pisząca dziesiec razy
  -- dawala tam ten sam slupek, co dziesiec osob po razie, mimo ze to sa dwa
  -- zupelnie rozne kluby. Tutaj slupek to liczba ROZNYCH osob, ktore sie
  -- w danym dniu odezwaly.
  days AS (
    SELECT generate_series(
             (date_trunc('day', now()) - interval '13 days')::date,
             date_trunc('day', now())::date,
             interval '1 day')::date AS day
  ),
  people_per_day AS (
    SELECT d.day,
           count(DISTINCT a.author_id)::int AS people
      FROM days d
      LEFT JOIN acts a ON date_trunc('day', a.created_at)::date = d.day
     GROUP BY d.day
  ),
  roster AS (
    SELECT m.user_id, m.joined_at,
           public.club_effective_member_role(m.role, m.role_expires_at) AS club_role,
           l.last_at
      FROM public.club_members m
      CROSS JOIN cap
      LEFT JOIN last_seen l ON l.author_id = m.user_id
     WHERE m.club_id = p_club_id
       AND m.status = 'active'
       AND cap.can_read
  ),
  counts AS (
    SELECT
      count(*)::int AS members_total,
      count(*) FILTER (WHERE joined_at > now() - interval '7 days')::int AS new_7d,
      count(*) FILTER (WHERE last_at > now() - interval '24 hours')::int AS active_24h,
      count(*) FILTER (WHERE last_at IS NOT NULL)::int AS active_7d
    FROM roster
  ),
  visible AS (
    -- Kolejnosc twarzy: najpierw kto tu wlasnie byl, potem kto wlasnie doszedl.
    -- Awatary maja odpowiadac na pytanie "kto tu jest TERAZ". Pozycja jedzie
    -- JAWNA kolumna, bo `ORDER BY` w podzapytaniu nie jest obietnica dla
    -- agregatu ponizej - jest tylko wyborem wierszy do limitu.
    SELECT r.*,
           row_number() OVER (
             ORDER BY (r.last_at IS NOT NULL) DESC, r.last_at DESC NULLS LAST, r.joined_at DESC
           ) AS pos
      FROM roster r
      CROSS JOIN cap
      JOIN public.profiles p ON p.id = r.user_id
     WHERE cap.can_see_members
       AND (p.discoverable OR r.user_id = auth.uid())
     ORDER BY pos
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 40)
  )
  SELECT
    counts.members_total, counts.new_7d, counts.active_24h, counts.active_7d,
    COALESCE(
      (SELECT array_agg(p.people ORDER BY p.day) FROM people_per_day p),
      ARRAY[]::integer[]),
    COALESCE(
      (SELECT jsonb_agg(
                jsonb_build_object(
                  'user_id',    v.user_id,
                  'name',       COALESCE(NULLIF(btrim(p.display_name), ''),
                                         NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
                                         'User'),
                  'avatar_url', CASE WHEN p.hide_avatar THEN NULL ELSE p.avatar_url END,
                  'slug',       p.slug,
                  'role',       v.club_role,
                  'is_new',     v.joined_at > now() - interval '7 days',
                  'is_active',  COALESCE(v.last_at > now() - interval '24 hours', false),
                  'topics',     COALESCE(
                                  (SELECT array_agg(e.topic ORDER BY e.topic)
                                     FROM public.club_member_expertise e
                                    WHERE e.club_id = p_club_id AND e.user_id = v.user_id),
                                  ARRAY[]::text[])
                ) ORDER BY v.pos)
         FROM visible v
         JOIN public.profiles p ON p.id = v.user_id),
      '[]'::jsonb)
  FROM counts
$$;

COMMENT ON FUNCTION public.club_roster_signal(uuid, integer) IS
  'Sklad klubu z sygnalem obecnosci: liczby (razem / nowi 7 dni / aktywni 24 h / aktywni 7 dni), 14-dniowy szereg LICZBY ROZNYCH AKTYWNYCH OSOB (nie wpisow) i twarze z tagami kompetencji. Twarze wychodza tylko przy can_see_members.';

REVOKE EXECUTE ON FUNCTION public.club_roster_signal(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_roster_signal(uuid, integer) TO authenticated, service_role;

-- ============================================================================
-- 13) RPC: POZNAJ CZLONKA
--
-- Kolejnosc zrodel: przypiecie redakcyjne na TEN tydzien, a gdy go nie ma -
-- rotacja liczona z numeru tygodnia. Rotacja bierze WYLACZNIE osoby, ktore
-- maja co pokazac (zadeklarowana kompetencja albo opis w profilu) - profil
-- pusty w module "poznaj czlonka" jest gorszy niz brak modulu.
-- ============================================================================
DROP FUNCTION IF EXISTS public.club_member_spotlight_current(uuid);

CREATE FUNCTION public.club_member_spotlight_current(p_club_id uuid)
RETURNS TABLE (
  user_id uuid, display_name text, avatar_url text, profile_slug text,
  headline text, club_role text, bio_pl text, bio_en text,
  blurb_pl text, blurb_en text, topics text[],
  joined_at timestamptz, curated boolean, week_start date
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH cap AS (
    SELECT * FROM public.club_capabilities(p_club_id, NULL, auth.uid())
  ),
  wk AS (
    SELECT (date_trunc('week', now()))::date AS week_start
  ),
  eligible AS (
    SELECT
      m.user_id, m.joined_at,
      public.club_effective_member_role(m.role, m.role_expires_at) AS club_role,
      COALESCE(
        (SELECT array_agg(e.topic ORDER BY e.topic)
           FROM public.club_member_expertise e
          WHERE e.club_id = p_club_id AND e.user_id = m.user_id),
        ARRAY[]::text[]) AS topics
      FROM public.club_members m
      CROSS JOIN cap
      JOIN public.profiles p ON p.id = m.user_id
     WHERE m.club_id = p_club_id
       AND m.status = 'active'
       AND cap.can_read
       AND cap.can_see_members
       AND p.discoverable
       AND (
         NULLIF(btrim(COALESCE(p.bio_pl, p.bio, '')), '') IS NOT NULL
         OR NULLIF(btrim(COALESCE(p.bio_en, p.bio, '')), '') IS NOT NULL
         OR NULLIF(btrim(COALESCE(p.job_title, '')), '') IS NOT NULL
         OR EXISTS (SELECT 1 FROM public.club_member_expertise e
                     WHERE e.club_id = p_club_id AND e.user_id = m.user_id)
       )
  ),
  ordered AS (
    SELECT e.*, row_number() OVER (ORDER BY e.user_id) - 1 AS idx,
           count(*) OVER () AS total
      FROM eligible e
  ),
  rotated AS (
    -- Numer tygodnia epoki modulo licznosc skladu. Deterministyczne, wiec ta
    -- sama osoba stoi w module przez caly tydzien i u kazdego czytelnika ta
    -- sama - bez zadnego stanu po stronie bazy.
    SELECT o.*, false AS curated
      FROM ordered o
     WHERE o.total > 0
       AND o.idx = (floor(extract(epoch FROM now()) / 604800)::bigint % o.total)
  ),
  pinned AS (
    SELECT
      s.user_id, m.joined_at,
      public.club_effective_member_role(m.role, m.role_expires_at) AS club_role,
      COALESCE(
        (SELECT array_agg(e.topic ORDER BY e.topic)
           FROM public.club_member_expertise e
          WHERE e.club_id = p_club_id AND e.user_id = s.user_id),
        ARRAY[]::text[]) AS topics,
      0::bigint AS idx, 0::bigint AS total, true AS curated,
      s.blurb_pl, s.blurb_en
      FROM public.club_member_spotlight s
      CROSS JOIN wk
      CROSS JOIN cap
      JOIN public.club_members m
        ON m.club_id = s.club_id AND m.user_id = s.user_id AND m.status = 'active'
      JOIN public.profiles pp ON pp.id = s.user_id
     WHERE s.club_id = p_club_id
       AND s.week_start = wk.week_start
       AND cap.can_read
       AND cap.can_see_members
       -- Rotacja odsiewa niewidocznych w katalogu, wiec przypiecie musi robic
       -- to samo. Inaczej wybor redakcji jest OBEJSCIEM decyzji czlonka:
       -- osoba, ktorej rotacja nigdy by nie pokazala, trafia na ekran razem
       -- z nazwiskiem, awatarem i opisem, bo ktos ja recznie wskazal.
       AND pp.discoverable
  ),
  winner AS (
    SELECT user_id, joined_at, club_role, topics, curated, blurb_pl, blurb_en FROM pinned
    UNION ALL
    SELECT r.user_id, r.joined_at, r.club_role, r.topics, r.curated, NULL::text, NULL::text
      FROM rotated r
     WHERE NOT EXISTS (SELECT 1 FROM pinned)
  )
  SELECT
    w.user_id,
    COALESCE(NULLIF(btrim(p.display_name), ''),
             NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'User'),
    CASE WHEN p.hide_avatar THEN NULL ELSE p.avatar_url END,
    p.slug,
    NULLIF(btrim(concat_ws(' - ', NULLIF(btrim(p.job_title), ''),
                                  NULLIF(btrim(p.current_company), ''))), ''),
    w.club_role,
    NULLIF(btrim(COALESCE(p.bio_pl, p.bio, '')), ''),
    NULLIF(btrim(COALESCE(p.bio_en, p.bio, '')), ''),
    w.blurb_pl, w.blurb_en, w.topics,
    w.joined_at, w.curated, wk.week_start
  FROM winner w
  CROSS JOIN wk
  JOIN public.profiles p ON p.id = w.user_id
  LIMIT 1
$$;

COMMENT ON FUNCTION public.club_member_spotlight_current(uuid) IS
  'Czlonek tygodnia: przypiecie redakcyjne na biezacy tydzien, a w jego braku deterministyczna rotacja po skladzie (numer tygodnia epoki modulo licznosc).';

REVOKE EXECUTE ON FUNCTION public.club_member_spotlight_current(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_member_spotlight_current(uuid) TO authenticated, service_role;

-- ============================================================================
-- 14) RPC: DOROBEK JAKO WYNIK WSPOLNYCH ROZMOW
--
-- `club_documents_list(scope => 'products')` odpowiada na pytanie "co ten klub
-- opublikowal". To jest pytanie o BIBLIOTEKE. Panel dorobku ma odpowiadac na
-- inne: "co powstalo z tego, ze ci ludzie ze soba rozmawiali" - a wiec musi
-- pokazac ROZMOWE, z ktorej produkt wyrosl, i osoby, ktore ja prowadzily.
--
-- Wspolautorstwo NIE dostaje wlasnej tabeli. Zrodlem prawdy jest dyskusja
-- podpieta pod dokument: kto sie w niej wypowiadal, ten wspoltworzyl wynik.
-- Osobna lista autorow rozjechalaby sie z watkiem w pierwszym miesiacu, a
-- utrzymywalby ja recznie ten sam czlowiek, ktory wgrywa plik.
--
-- Regula Chatham House wygrywa z wszystkim: w klubie, ktory jej uzywa, twarze
-- nie wychodza wcale. Produkt zostaje, wspolautorzy znikaja - dokladnie tak,
-- jak dziala ta regula poza ekranem.
-- ============================================================================
DROP FUNCTION IF EXISTS public.club_output_list(uuid, integer);

CREATE FUNCTION public.club_output_list(p_club_id uuid, p_limit integer DEFAULT 4)
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
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 4), 1), 20)
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
       LIMIT 6
    ) a
    JOIN public.profiles pr ON pr.id = a.author_id
  ) co ON true
  ORDER BY (r.thread_id IS NOT NULL) DESC, COALESCE(r.published_at, r.created_at) DESC
$$;

COMMENT ON FUNCTION public.club_output_list(uuid, integer) IS
  'Dorobek klubu jako wynik wspolnych rozmow: produkt + dyskusja, z ktorej wyrosl, + jej uczestnicy. Regula Chatham House kasuje twarze, produkt zostaje.';

REVOKE EXECUTE ON FUNCTION public.club_output_list(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_output_list(uuid, integer) TO authenticated, service_role;
