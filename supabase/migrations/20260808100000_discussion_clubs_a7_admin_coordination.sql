-- ============================================================================
-- DISCUSSION CLUB - ETAP A7: KOORDYNACJA W PANELU ADMINA
--
-- Panel dostaje to, czego brakowalo: liste tematow z akcjami, zarzadzanie
-- odpowiedziami, publikacje W IMIENIU wskazanej osoby, przenoszenie tematow
-- miedzy grupami, akcje wsadowe i miekkie usuwanie z przywracaniem.
--
-- DECYZJA, KTORA WYMAGALA ROZSTRZYGNIECIA: PUBLIKACJA W IMIENIU.
-- Admin moze opublikowac temat albo odpowiedz w imieniu wskazanego czlonka -
-- to jest potrzebne (protokol ze spotkania, tresc przyslana mailem, wypowiedz
-- z panelu offline). Ale pisanie cudzym nazwiskiem BEZ SLADU to podszycie sie.
--
-- Dlatego kazdy taki wpis niesie `posted_by_admin_id`:
--   * projekcje odczytowe zwracaja te kolumne, wiec interfejs pokazuje
--     adnotacje "opublikowane przez redakcje w imieniu X",
--   * kazde uzycie laduje w club_moderation_log,
--   * czytelnik ZAWSZE odrozni wypowiedz wlasna od wprowadzonej za kogos.
-- Podszycie sie jest wtedy jawna operacja redakcyjna, a nie cicha podmiana
-- autorstwa. To jedyna wersja tej funkcji, ktora da sie obronic.
--
-- USUWANIE JEST MIEKKIE. Status 'deleted' zamiast DELETE, bo:
--   * dyskusja jest dorobkiem ZBIOROWYM - twarde usuniecie tematu rozbija
--     odpowiedzi innych osob, ktore traca kontekst,
--   * moderacja potrzebuje sladu tego, co usunela,
--   * pomylka moderatora musi byc odwracalna jednym ruchem.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Znacznik publikacji w imieniu
-- ----------------------------------------------------------------------------
ALTER TABLE public.club_threads
  ADD COLUMN IF NOT EXISTS posted_by_admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.club_replies
  ADD COLUMN IF NOT EXISTS posted_by_admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.club_threads.posted_by_admin_id IS
  'Kto wprowadzil wpis, jesli zrobil to ktos inny niz autor. Projekcje odczytowe zwracaja te kolumne, wiec czytelnik ZAWSZE odrozni wypowiedz wlasna od wprowadzonej przez redakcje.';
COMMENT ON COLUMN public.club_replies.posted_by_admin_id IS
  'Jak wyzej, dla odpowiedzi.';

-- Log moderacji zyskuje dwie akcje: publikacja w imieniu i przywrocenie.
ALTER TABLE public.club_moderation_log DROP CONSTRAINT IF EXISTS club_moderation_log_action_check;
ALTER TABLE public.club_moderation_log
  ADD CONSTRAINT club_moderation_log_action_check
  CHECK (action IN ('approve', 'hide', 'delete', 'restore', 'lock', 'unlock',
                    'pin', 'unpin', 'ban', 'unban', 'reveal_author',
                    'role_change', 'post_on_behalf', 'move', 'edit'));

-- ----------------------------------------------------------------------------
-- 2) Lista tematow dla panelu
--
-- Osobno od club_threads_list: panel widzi WSZYSTKIE statusy (takze hidden
-- i deleted), nie przechodzi przez club_capabilities per wiersz (admin ma
-- dostep z definicji, wiec to bylby N wywolan bez zysku) i zwraca kolumny
-- potrzebne do koordynacji, nie do czytania.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_club_threads(uuid, uuid, text, text, text, integer, integer);

CREATE FUNCTION public.admin_club_threads(
  p_club_id  uuid,
  p_group_id uuid DEFAULT NULL,
  p_status   text DEFAULT NULL,
  p_kind     text DEFAULT NULL,
  p_search   text DEFAULT NULL,
  p_limit    integer DEFAULT 50,
  p_offset   integer DEFAULT 0
)
RETURNS TABLE (
  id uuid, slug text, title text, kind text, status text,
  group_id uuid, group_name_pl text, group_name_en text,
  author_id uuid, author_name text, posted_by_admin_name text,
  is_anonymous boolean,
  reply_count integer, participant_count integer, reaction_count integer,
  pinned_at timestamptz, locked_at timestamptz,
  last_reply_at timestamptz, created_at timestamptz,
  total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH rows AS (
    SELECT
      t.id, t.slug, t.title, t.kind, t.status,
      t.group_id, g.name_pl AS g_pl, g.name_en AS g_en,
      -- Panel widzi autora ZAWSZE, takze w trybie chatham: bez tego nie da sie
      -- moderowac. Interfejs panelu jest dostepny wylacznie dla staffu, a
      -- ujawnienie w produkcie nadal wymaga audytowanego RPC.
      t.author_id,
      COALESCE(NULLIF(btrim(p.display_name), ''), 'User') AS a_name,
      NULLIF(btrim(pa.display_name), '') AS pb_name,
      t.is_anonymous,
      t.reply_count, t.participant_count, t.reaction_count,
      t.pinned_at, t.locked_at, t.last_reply_at, t.created_at
    FROM public.club_threads t
    JOIN public.clubs c ON c.id = t.club_id
    JOIN public.club_groups g ON g.id = t.group_id
    LEFT JOIN public.profiles p ON p.id = t.author_id
    LEFT JOIN public.profiles pa ON pa.id = t.posted_by_admin_id
    WHERE t.club_id = p_club_id
      AND public.is_club_admin(auth.uid())
      AND c.tenant_id = public.current_tenant_id()
      AND (p_group_id IS NULL OR t.group_id = p_group_id)
      AND (p_status IS NULL OR t.status = p_status)
      AND (p_kind IS NULL OR t.kind = p_kind)
      AND (
        p_search IS NULL OR btrim(p_search) = ''
        OR t.title ILIKE '%' || btrim(p_search) || '%'
      )
  )
  SELECT r.*, count(*) OVER () AS total_count
  FROM rows r
  ORDER BY (r.pinned_at IS NOT NULL) DESC,
           COALESCE(r.last_reply_at, r.created_at) DESC,
           r.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$$;

COMMENT ON FUNCTION public.admin_club_threads(uuid, uuid, text, text, text, integer, integer) IS
  'Lista tematow dla panelu: wszystkie statusy, autor widoczny takze w trybie chatham (bez tego nie da sie moderowac), total_count w wierszu.';

REVOKE EXECUTE ON FUNCTION public.admin_club_threads(uuid, uuid, text, text, text, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_threads(uuid, uuid, text, text, text, integer, integer)
  TO authenticated, service_role;

-- Odpowiedzi jednego tematu w panelu - plaska lista z akcjami.
DROP FUNCTION IF EXISTS public.admin_club_replies(uuid, integer, integer);

CREATE FUNCTION public.admin_club_replies(
  p_thread_id uuid, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid, parent_id uuid, depth smallint, body text, status text,
  author_id uuid, author_name text, posted_by_admin_name text,
  is_anonymous boolean, reaction_count integer,
  created_at timestamptz, edited_at timestamptz, total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH rows AS (
    SELECT
      r.id, r.parent_id, r.depth, r.body, r.status,
      r.author_id,
      COALESCE(NULLIF(btrim(p.display_name), ''), 'User') AS a_name,
      NULLIF(btrim(pa.display_name), '') AS pb_name,
      r.is_anonymous, r.reaction_count, r.created_at, r.edited_at
    FROM public.club_replies r
    JOIN public.club_threads t ON t.id = r.thread_id
    JOIN public.clubs c ON c.id = t.club_id
    LEFT JOIN public.profiles p ON p.id = r.author_id
    LEFT JOIN public.profiles pa ON pa.id = r.posted_by_admin_id
    WHERE r.thread_id = p_thread_id
      AND public.is_club_admin(auth.uid())
      AND c.tenant_id = public.current_tenant_id()
  )
  SELECT r.*, count(*) OVER () AS total_count
  FROM rows r
  ORDER BY r.created_at ASC, r.id ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$$;

REVOKE EXECUTE ON FUNCTION public.admin_club_replies(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_replies(uuid, integer, integer)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3) Publikacja W IMIENIU - z widocznym znacznikiem
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_club_thread_create(
  p_group_id  uuid,
  p_title     text,
  p_body      text,
  p_author_id uuid DEFAULT NULL,   -- NULL = pod wlasnym nazwiskiem admina
  p_kind      text DEFAULT 'discussion',
  p_pinned    boolean DEFAULT false
)
RETURNS TABLE (thread_id uuid, thread_slug text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_group  public.club_groups%ROWTYPE;
  v_author uuid;
  v_slug   text;
  v_base   text;
  v_n      integer := 0;
  v_id     uuid;
BEGIN
  IF NOT public.is_club_admin(v_uid) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('discussion','question','position','resource','announcement','poll') THEN
    RAISE EXCEPTION 'clubs: invalid thread kind %', p_kind USING ERRCODE = '22023';
  END IF;

  SELECT g.* INTO v_group
    FROM public.club_groups g JOIN public.clubs c ON c.id = g.club_id
   WHERE g.id = p_group_id AND c.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;

  -- Wskazany autor MUSI byc czlonkiem tego klubu. Publikacja w imieniu kogos,
  -- kto do klubu nie nalezy, byla by fabrykowaniem uczestnictwa, nie
  -- wprowadzaniem tresci.
  v_author := COALESCE(p_author_id, v_uid);
  IF p_author_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.club_members m
       WHERE m.club_id = v_group.club_id AND m.user_id = p_author_id AND m.status = 'active'
    ) THEN
      RAISE EXCEPTION 'clubs: author must be an active member of this club'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  v_base := btrim(COALESCE(NULLIF(regexp_replace(
              lower(unaccent(btrim(p_title))), '[^a-z0-9]+', '-', 'g'), ''), 'temat'), '-');
  v_base := left(v_base, 60);
  v_slug := v_base;
  WHILE EXISTS (SELECT 1 FROM public.club_threads t
                 WHERE t.club_id = v_group.club_id AND t.slug = v_slug) LOOP
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n::text;
  END LOOP;

  INSERT INTO public.club_threads (
    tenant_id, club_id, group_id, author_id, slug, title, body, kind, status,
    pinned_at, posted_by_admin_id
  ) VALUES (
    v_tenant, v_group.club_id, p_group_id, v_author, v_slug,
    btrim(p_title), btrim(p_body), p_kind, 'open',
    CASE WHEN p_pinned THEN now() ELSE NULL END,
    -- Znacznik TYLKO gdy autor jest kims innym niz publikujacy.
    CASE WHEN p_author_id IS NOT NULL AND p_author_id <> v_uid THEN v_uid ELSE NULL END
  )
  RETURNING club_threads.id INTO v_id;

  IF p_author_id IS NOT NULL AND p_author_id <> v_uid THEN
    INSERT INTO public.club_moderation_log (
      tenant_id, club_id, moderator_id, action, target_type, target_id, reason
    ) VALUES (
      v_tenant, v_group.club_id, v_uid, 'post_on_behalf', 'thread', v_id,
      'temat w imieniu: ' || v_author::text
    );
  END IF;

  thread_id := v_id; thread_slug := v_slug;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.admin_club_thread_create(uuid, text, text, uuid, text, boolean) IS
  'Admin zaklada temat, opcjonalnie W IMIENIU wskazanego czlonka. Znacznik posted_by_admin_id wychodzi w projekcjach, wiec podszycie nie jest ciche. Autor musi byc AKTYWNYM czlonkiem klubu.';

REVOKE EXECUTE ON FUNCTION public.admin_club_thread_create(uuid, text, text, uuid, text, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_thread_create(uuid, text, text, uuid, text, boolean)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_club_reply_create(
  p_thread_id uuid,
  p_body      text,
  p_author_id uuid DEFAULT NULL,
  p_parent_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_thread public.club_threads%ROWTYPE;
  v_author uuid;
  v_id     uuid;
BEGIN
  IF NOT public.is_club_admin(v_uid) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT t.* INTO v_thread
    FROM public.club_threads t JOIN public.clubs c ON c.id = t.club_id
   WHERE t.id = p_thread_id AND c.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;

  v_author := COALESCE(p_author_id, v_uid);
  IF p_author_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.club_members m
     WHERE m.club_id = v_thread.club_id AND m.user_id = p_author_id AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'clubs: author must be an active member of this club'
      USING ERRCODE = '42501';
  END IF;

  -- Admin moze odpowiedziec w ZAMKNIETYM watku: zamkniecie dotyczy dyskusji,
  -- nie moderacji. Sprostowanie redakcyjne pod zamknietym watkiem to typowy
  -- powod, dla ktorego ta funkcja w ogole istnieje.
  INSERT INTO public.club_replies (
    tenant_id, club_id, thread_id, author_id, parent_id, body, status, posted_by_admin_id
  ) VALUES (
    v_tenant, v_thread.club_id, p_thread_id, v_author, p_parent_id,
    btrim(p_body), 'visible',
    CASE WHEN p_author_id IS NOT NULL AND p_author_id <> v_uid THEN v_uid ELSE NULL END
  )
  RETURNING club_replies.id INTO v_id;

  IF p_author_id IS NOT NULL AND p_author_id <> v_uid THEN
    INSERT INTO public.club_moderation_log (
      tenant_id, club_id, moderator_id, action, target_type, target_id, reason
    ) VALUES (
      v_tenant, v_thread.club_id, v_uid, 'post_on_behalf', 'reply', v_id,
      'odpowiedz w imieniu: ' || v_author::text
    );
  END IF;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.admin_club_reply_create(uuid, text, uuid, uuid) IS
  'Admin dodaje odpowiedz, opcjonalnie w imieniu czlonka. Dziala takze w zamknietym watku - zamkniecie dotyczy dyskusji, nie sprostowania redakcyjnego.';

REVOKE EXECUTE ON FUNCTION public.admin_club_reply_create(uuid, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_reply_create(uuid, text, uuid, uuid)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4) Koordynacja: przenoszenie i przywracanie
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_club_thread_move(
  p_thread_id uuid, p_group_id uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_tenant  uuid := public.current_tenant_id();
  v_club    uuid;
  v_old     uuid;
BEGIN
  IF NOT public.is_club_admin(v_uid) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT t.club_id, t.group_id INTO v_club, v_old
    FROM public.club_threads t JOIN public.clubs c ON c.id = t.club_id
   WHERE t.id = p_thread_id AND c.tenant_id = v_tenant;
  IF v_club IS NULL THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;

  -- Przeniesienie WYLACZNIE w obrebie tego samego klubu: grupa z innego klubu
  -- ma inne czlonkostwo, wiec przeniesienie tam odslonilo by tresc osobom,
  -- ktore nigdy nie mialy do niej dostepu.
  IF NOT EXISTS (
    SELECT 1 FROM public.club_groups g WHERE g.id = p_group_id AND g.club_id = v_club
  ) THEN
    RAISE EXCEPTION 'clubs: target group belongs to a different club'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.club_threads SET group_id = p_group_id WHERE id = p_thread_id;
  -- Odpowiedzi nosza club_id, nie group_id, wiec nie wymagaja przepiecia.

  INSERT INTO public.club_moderation_log (
    tenant_id, club_id, moderator_id, action, target_type, target_id, reason
  ) VALUES (v_tenant, v_club, v_uid, 'move', 'thread', p_thread_id,
            v_old::text || ' -> ' || p_group_id::text);

  -- Liczniki obu grup wymagaja przeliczenia; trigger na club_threads reaguje
  -- na UPDATE OF status, nie group_id, wiec robimy to tutaj jawnie.
  UPDATE public.club_groups g SET thread_count = (
    SELECT count(*)::int FROM public.club_threads t
     WHERE t.group_id = g.id AND t.status NOT IN ('deleted','hidden','pending')
  ) WHERE g.id IN (v_old, p_group_id);

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.admin_club_thread_move(uuid, uuid) IS
  'Przenosi temat do innej grupy TEGO SAMEGO klubu. Grupa z innego klubu ma inne czlonkostwo, wiec przeniesienie tam odslonilo by tresc obcym.';

REVOKE EXECUTE ON FUNCTION public.admin_club_thread_move(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_thread_move(uuid, uuid)
  TO authenticated, service_role;

-- Przywrocenie miekko usunietej tresci. Osobna funkcja od club_moderate,
-- bo 'restore' musi wiedziec, DO JAKIEGO statusu wrocic - a to zalezy od
-- rodzaju celu.
CREATE OR REPLACE FUNCTION public.admin_club_restore(
  p_target_type text, p_target_id uuid, p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_club   uuid;
BEGIN
  IF NOT public.is_club_admin(v_uid) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_target_type NOT IN ('thread','reply') THEN
    RAISE EXCEPTION 'clubs: invalid target type' USING ERRCODE = '22023';
  END IF;

  IF p_target_type = 'thread' THEN
    UPDATE public.club_threads t SET status = 'open'
      FROM public.clubs c
     WHERE t.id = p_target_id AND c.id = t.club_id AND c.tenant_id = v_tenant
       AND t.status IN ('deleted','hidden')
     RETURNING t.club_id INTO v_club;
  ELSE
    UPDATE public.club_replies r SET status = 'visible'
      FROM public.clubs c
     WHERE r.id = p_target_id AND c.id = r.club_id AND c.tenant_id = v_tenant
       AND r.status IN ('deleted','hidden')
     RETURNING r.club_id INTO v_club;
  END IF;

  IF v_club IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.club_moderation_log (
    tenant_id, club_id, moderator_id, action, target_type, target_id, reason
  ) VALUES (v_tenant, v_club, v_uid, 'restore', p_target_type, p_target_id,
            NULLIF(btrim(COALESCE(p_reason, '')), ''));

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.admin_club_restore(text, uuid, text) IS
  'Przywraca miekko usunieta albo ukryta tresc. Pomylka moderatora musi byc odwracalna jednym ruchem.';

REVOKE EXECUTE ON FUNCTION public.admin_club_restore(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_restore(text, uuid, text)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5) Akcje wsadowe
--
-- Jedno wywolanie na cala zaznaczona partie, nie N wywolan. Moderacja
-- kilkudziesieciu wpisow po jednym to nie tylko wolno - to takze N wpisow
-- w logu z roznymi znacznikami czasu, przez co nie widac, ze byla to
-- JEDNA decyzja.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_club_bulk_moderate(
  p_target_type text, p_target_ids uuid[], p_action text, p_reason text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_tenant  uuid := public.current_tenant_id();
  v_done    integer := 0;
  v_id      uuid;
BEGIN
  IF NOT public.is_club_admin(v_uid) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('approve','hide','delete','restore','lock','unlock','pin','unpin') THEN
    RAISE EXCEPTION 'clubs: invalid moderation action %', p_action USING ERRCODE = '22023';
  END IF;
  IF p_target_ids IS NULL OR array_length(p_target_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;
  IF array_length(p_target_ids, 1) > 200 THEN
    RAISE EXCEPTION 'clubs: bulk limit is 200 items' USING ERRCODE = '22023';
  END IF;

  FOREACH v_id IN ARRAY p_target_ids LOOP
    BEGIN
      IF p_action = 'restore' THEN
        PERFORM public.admin_club_restore(p_target_type, v_id, p_reason);
      ELSE
        PERFORM public.club_moderate(p_target_type, v_id, p_action, p_reason);
      END IF;
      v_done := v_done + 1;
    EXCEPTION WHEN OTHERS THEN
      -- Jeden wpis, ktorego nie da sie ruszyc (np. przypiecie odpowiedzi),
      -- nie moze przerwac calej partii. Licznik zwraca, ile faktycznie
      -- przeszlo, wiec interfejs powie "zmieniono 47 z 50".
      NULL;
    END;
  END LOOP;

  RETURN v_done;
END;
$$;

COMMENT ON FUNCTION public.admin_club_bulk_moderate(text, uuid[], text, text) IS
  'Akcja moderacyjna na partii do 200 wpisow. Bledny element nie przerywa partii; zwracany licznik pozwala UI powiedziec "zmieniono 47 z 50".';

REVOKE EXECUTE ON FUNCTION public.admin_club_bulk_moderate(text, uuid[], text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_bulk_moderate(text, uuid[], text, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_club_bulk_member_role(
  p_club_id uuid, p_user_ids uuid[], p_role text
)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_done   integer;
BEGIN
  IF NOT public.is_club_admin(v_uid) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('lead','moderator','member','observer') THEN
    RAISE EXCEPTION 'clubs: invalid club role %', p_role USING ERRCODE = '22023';
  END IF;

  UPDATE public.club_members m SET role = p_role
    FROM public.clubs c
   WHERE m.club_id = p_club_id AND c.id = m.club_id AND c.tenant_id = v_tenant
     AND m.user_id = ANY(p_user_ids);
  GET DIAGNOSTICS v_done = ROW_COUNT;

  INSERT INTO public.club_moderation_log (
    tenant_id, club_id, moderator_id, action, target_type, target_id, reason
  )
  SELECT v_tenant, p_club_id, v_uid, 'role_change', 'member', u, p_role
    FROM unnest(p_user_ids) AS u;

  RETURN v_done;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_club_bulk_member_role(uuid, uuid[], text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_bulk_member_role(uuid, uuid[], text)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6) Statystyki: odsetek tematow BEZ ODPOWIEDZI
--
-- V2 zakladka 9 nazywa to najwazniejsza metryka klubu i ma racje: temat bez
-- odpowiedzi to porazka klubu, a nie neutralny stan. Dokladamy tez mediane
-- czasu do pierwszej odpowiedzi - druga liczbe, ktora mowi, czy klub zyje.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_club_stats(uuid);

CREATE FUNCTION public.admin_club_stats(p_club_id uuid)
RETURNS TABLE (
  member_count integer, active_members_30d integer, pending_members integer,
  group_count integer, thread_count integer, banned_count integer,
  leads_count integer, moderators_count integer,
  reply_count integer, unanswered_count integer, unanswered_pct integer,
  median_first_reply_hours integer, threads_30d integer, replies_30d integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH live AS (
    SELECT t.id, t.reply_count, t.created_at
      FROM public.club_threads t
     WHERE t.club_id = p_club_id AND t.status IN ('open','resolved','dormant','locked')
  ),
  first_reply AS (
    SELECT r.thread_id, min(r.created_at) AS at
      FROM public.club_replies r
      JOIN live l ON l.id = r.thread_id
     WHERE r.status = 'visible'
     GROUP BY r.thread_id
  )
  SELECT
    c.member_count,
    (SELECT count(*)::int FROM public.club_members m
      WHERE m.club_id = c.id AND m.status = 'active'
        AND m.last_read_at IS NOT NULL AND m.last_read_at > now() - interval '30 days'),
    (SELECT count(*)::int FROM public.club_members m
      WHERE m.club_id = c.id AND m.status = 'pending'),
    c.group_count,
    c.thread_count,
    (SELECT count(*)::int FROM public.club_members m
      WHERE m.club_id = c.id AND m.status = 'banned'),
    (SELECT count(*)::int FROM public.club_members m
      WHERE m.club_id = c.id AND m.status = 'active' AND m.role = 'lead'),
    (SELECT count(*)::int FROM public.club_members m
      WHERE m.club_id = c.id AND m.status = 'active' AND m.role = 'moderator'),
    (SELECT count(*)::int FROM public.club_replies r
      WHERE r.club_id = c.id AND r.status = 'visible'),
    (SELECT count(*)::int FROM live WHERE reply_count = 0),
    -- Odsetek liczymy tylko gdy jest z czego; zero tematow daje 0, nie NULL,
    -- bo karta z myslnikiem czyta sie jak awaria, nie jak pusty klub.
    COALESCE((SELECT round(100.0 * count(*) FILTER (WHERE reply_count = 0)
                           / NULLIF(count(*), 0))::int FROM live), 0),
    COALESCE((SELECT percentile_cont(0.5) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM (f.at - l.created_at)) / 3600.0)::int
                FROM first_reply f JOIN live l ON l.id = f.thread_id), 0),
    (SELECT count(*)::int FROM public.club_threads t
      WHERE t.club_id = c.id AND t.created_at > now() - interval '30 days'
        AND t.status NOT IN ('deleted','hidden')),
    (SELECT count(*)::int FROM public.club_replies r
      WHERE r.club_id = c.id AND r.created_at > now() - interval '30 days'
        AND r.status = 'visible')
  FROM public.clubs c
  WHERE c.id = p_club_id
    AND public.is_club_admin(auth.uid())
    AND c.tenant_id = public.current_tenant_id()
$$;

COMMENT ON FUNCTION public.admin_club_stats(uuid) IS
  'Metryki klubu. unanswered_pct jest tu NAJWAZNIEJSZY: temat bez odpowiedzi to porazka klubu, a nie neutralny stan (V2 zakladka 9).';

REVOKE EXECUTE ON FUNCTION public.admin_club_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_stats(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7) Znacznik "w imieniu" w projekcjach produktowych
--
-- Bez tego kolumna istnieje w bazie, ale czytelnik jej nie widzi - a wtedy
-- caly sens znacznika przepada.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.club_thread_view(uuid, text);

CREATE FUNCTION public.club_thread_view(p_club_id uuid, p_slug text)
RETURNS TABLE (
  id uuid, club_id uuid, group_id uuid, slug text,
  title text, body text, kind text, status text,
  anchor_type text, anchor_id text,
  is_anonymous boolean, author_id uuid, author_name text,
  author_avatar text, author_slug text, author_alias text,
  posted_by_admin_name text,
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
    -- Znacznik redakcyjny wychodzi TAKZE w trybie chatham: to informacja
    -- o tym, KTO WPROWADZIL tresc, a nie o tym, kto ja napisal. Ukrycie go
    -- pozwalaloby redakcji wstawiac anonimowe wpisy bez sladu.
    NULLIF(btrim(pa.display_name), ''),
    t.reply_count, t.participant_count, t.reaction_count,
    t.pinned_at, t.locked_at, t.resolved_reply_id,
    t.created_at, t.edited_at,
    attr.mode,
    (cap.can_reply AND t.locked_at IS NULL AND t.status NOT IN ('locked', 'hidden', 'deleted')),
    cap.can_moderate,
    cap.reason
  FROM public.club_threads t
  JOIN public.club_groups g ON g.id = t.group_id
  JOIN public.clubs c ON c.id = t.club_id
  CROSS JOIN LATERAL (SELECT COALESCE(g.attribution_mode, c.attribution_mode) AS mode) attr
  CROSS JOIN LATERAL public.club_capabilities(t.club_id, t.group_id, auth.uid()) cap
  LEFT JOIN public.profiles p ON p.id = t.author_id
  LEFT JOIN public.profiles pa ON pa.id = t.posted_by_admin_id
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
  'Widok watku. Warstwa projekcji reguly Chatham House. posted_by_admin_name wychodzi TAKZE w trybie chatham - to informacja o tym, kto WPROWADZIL tresc, nie kto ja napisal.';

REVOKE EXECUTE ON FUNCTION public.club_thread_view(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_thread_view(uuid, text)
  TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.club_replies_list(uuid, text);

CREATE FUNCTION public.club_replies_list(p_thread_id uuid, p_sort text DEFAULT 'chronological')
RETURNS TABLE (
  id uuid, parent_id uuid, depth smallint, body text, status text,
  is_anonymous boolean, author_id uuid, author_name text,
  author_avatar text, author_slug text, author_alias text,
  posted_by_admin_name text,
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
    NULLIF(btrim(pa.display_name), ''),
    r.reaction_count, r.created_at, r.edited_at,
    (th.resolved_reply_id = r.id) AS is_resolution
  FROM public.club_replies r
  CROSS JOIN thread th
  CROSS JOIN cap
  LEFT JOIN public.profiles p ON p.id = r.author_id
  LEFT JOIN public.profiles pa ON pa.id = r.posted_by_admin_id
  WHERE r.thread_id = p_thread_id
    AND cap.can_read
    AND (
      r.status = 'visible'
      OR cap.can_moderate
      OR (r.status = 'pending' AND r.author_id = auth.uid())
    )
  ORDER BY
    (th.resolved_reply_id = r.id) DESC NULLS LAST,
    CASE WHEN p_sort = 'best' THEN r.reaction_count ELSE 0 END DESC,
    r.created_at ASC,
    r.id ASC
$$;

REVOKE EXECUTE ON FUNCTION public.club_replies_list(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_replies_list(uuid, text)
  TO anon, authenticated, service_role;
