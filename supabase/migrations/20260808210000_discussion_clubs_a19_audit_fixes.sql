-- ============================================================================
-- Kluby dyskusyjne - etap A19: poprawki z audytu wdrozenia A1-A17
--
-- Osiem defektow znalezionych przez audyt calego modulu. Kazdy jest opisany
-- przy swojej sekcji; wspolny mianownik to jeden wzorzec bledu, ktory warto
-- nazwac raz, bo powtarza sie w polowie z nich:
--
--   FUNKCJA PYTA O UPRAWNIENIE, ALE NIE PYTA O STAN CELU.
--
-- `can_read` / `can_react` / `can_moderate` odpowiadaja na pytanie "kim jest
-- wolajacy wobec tego klubu". NIE odpowiadaja na pytanie "czy ta konkretna
-- tresc jest jeszcze w obiegu". Watek ukryty przez moderacje, wpis w kolejce
-- premoderacji i klub 'secret' to trzy rozne stany, ktorych zadna macierz
-- uprawnien nie zna - i we wszystkich trzech miejscach, gdzie o nie nie
-- zapytano, wyciekala tresc albo dalo sie ominac decyzje moderatora.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) KRYTYCZNE: club_view pokazywal anonimowi kazdy klub tenantu publicznego
--
-- Filtr brzmial `WHERE cap.reason IS DISTINCT FROM 'not_found'`, czyli
-- wykluczal JEDEN kod odmowy zamiast wpuszczac to, co wolno. Galaz anonimowa
-- w club_capabilities (A9) nie zwraca jednak 'not_found' NIGDY: dla wolajacego
-- bez sesji reason to albo NULL (klub public + active), albo 'auth_required'.
-- Warunek byl wiec dla anonima zawsze prawdziwy.
--
-- Skutek: `POST /rpc/club_view {"p_slug":"..."}` bez tokenu zwracal pelny
-- wiersz DOWOLNEGO klubu tenantu publicznego - nazwe, opis, ZASADY, okladke,
-- polityke wstepu i liczniki - takze dla klubu 'secret' (ktorego cala definicja
-- brzmi "tylko czlonkowie wiedza, ze istnieje") i dla klubu 'draft', czyli
-- pracy redakcyjnej przed publikacja. `club_list` mial to zrobione poprawnie
-- od A13 (`c.status = 'active'` + jawna lista widocznosci), wiec luka byla
-- dostepna wylacznie przez odgadniecie slugu - co dla klubu nazwanego po
-- projekcie jest granicznie latwe.
--
-- Poprawka odwraca logike na predykat POZYTYWNY: wiersz wychodzi, gdy
-- wolajacy moze go przeczytac ALBO gdy klub jest w stanie, w ktorym sama
-- karta jest jawna. Sekret i szkic nie naleza do zadnej z tych kategorii.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.club_view(text);

CREATE FUNCTION public.club_view(p_slug text)
RETURNS TABLE (
  id uuid, slug text, name_pl text, name_en text,
  tagline_pl text, tagline_en text, description_pl text, description_en text,
  rules_pl text, rules_en text,
  icon text, accent_color text, cover_image_url text,
  visibility text, join_policy text, min_tier_rank integer,
  attribution_mode text, who_can_post text, moderation_mode text,
  policy_area text, status text, layout text,
  member_count integer, group_count integer, thread_count integer,
  last_activity_at timestamptz, created_at timestamptz,
  my_role text, my_status text, rules_accepted_at timestamptz,
  can_read boolean, can_post_thread boolean, can_reply boolean,
  can_moderate boolean, can_manage boolean, can_invite boolean,
  can_see_members boolean, reason text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH scope AS (
    SELECT COALESCE(
      (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()),
      public.public_tenant_id()
    ) AS tenant_id
  ),
  found AS (
    SELECT c.* FROM public.clubs c CROSS JOIN scope s
     WHERE c.slug = p_slug AND c.tenant_id = s.tenant_id
  )
  SELECT
    f.id, f.slug, f.name_pl, f.name_en,
    f.tagline_pl, f.tagline_en, f.description_pl, f.description_en,
    f.rules_pl, f.rules_en,
    f.icon, f.accent_color, f.cover_image_url,
    f.visibility, f.join_policy, f.min_tier_rank,
    f.attribution_mode, f.who_can_post, f.moderation_mode,
    f.policy_area, f.status, f.layout,
    f.member_count, f.group_count, f.thread_count,
    f.last_activity_at, f.created_at,
    public.club_effective_member_role(m.role, m.role_expires_at),
    m.status, m.rules_accepted_at,
    cap.can_read, cap.can_post_thread, cap.can_reply,
    cap.can_moderate, cap.can_manage, cap.can_invite,
    cap.can_see_members, cap.reason
  FROM found f
  LEFT JOIN public.club_members m ON m.club_id = f.id AND m.user_id = auth.uid()
  CROSS JOIN LATERAL public.club_capabilities(f.id, NULL, auth.uid()) cap
  -- Predykat POZYTYWNY. Trzy rozlaczne powody, dla ktorych karta ma prawo
  -- wyjsc, i nic poza nimi:
  --   a) wolajacy moze czytac tresc klubu (czlonek, moderacja, klub otwarty);
  --   b) wolajacy jest ZALOGOWANY, a klub jest aktywny i nie jest sekretem -
  --      karta klubu 'private' jest jawna dla zalogowanych, sama tresc nie;
  --   c) wolajacy jest czlonkiem w JAKIMKOLWIEK stanie (pending, invited,
  --      banned) - inaczej osoba czekajaca na przyjecie nie zobaczylaby, na co
  --      czeka, a zbanowana nie zobaczylaby, ze zostala zbanowana.
  -- Anonim nie spelnia (b) ani (c), wiec dostaje wylacznie to, co (a) - czyli
  -- kluby 'public' o statusie 'active'.
  WHERE cap.can_read
     OR (auth.uid() IS NOT NULL
         AND f.status = 'active'
         AND f.visibility IN ('public', 'members', 'private'))
     OR m.user_id IS NOT NULL
$$;

COMMENT ON FUNCTION public.club_view(text) IS
  'Karta klubu po slugu. Predykat jest POZYTYWNY: anonim widzi wylacznie kluby public+active, zalogowany takze karte klubow members/private, a klub secret i szkic - tylko czlonek. Zero wierszy znaczy 404, nie 403.';

REVOKE EXECUTE ON FUNCTION public.club_view(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_view(text) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2) Akceptacja starego zaproszenia kasowala bana
--
-- Sekwencja: prowadzacy zaprasza X (zaproszenie 'pending', wazne 30 dni) ->
-- moderator banuje X -> X akceptuje zaproszenie. `ON CONFLICT DO UPDATE SET
-- status = 'active'` nadpisywalo 'banned' bezwarunkowo, wiec zbanowany wracal
-- do klubu, i to od razu z rola z zaproszenia.
--
-- To nie jest teoretyczne: ban przychodzi zwykle PO zaproszeniu, bo powodem
-- bana jest to, co ktos zrobil juz w klubie albo obok niego.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_respond_invitation(
  p_invitation_id uuid, p_accept boolean
)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inv public.club_invitations%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv FROM public.club_invitations
   WHERE id = p_invitation_id AND invitee_id = v_uid AND status = 'pending'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: invitation not found' USING ERRCODE = '42501';
  END IF;
  IF v_inv.expires_at <= now() THEN
    UPDATE public.club_invitations SET status = 'expired' WHERE id = p_invitation_id;
    RAISE EXCEPTION 'clubs: invitation expired' USING ERRCODE = '42501';
  END IF;

  -- Ban jest silniejszy niz zaproszenie, NIEZALEZNIE od tego, ktore z nich
  -- powstalo pierwsze. Odmowa jest jawna: zbanowany ma wiedziec, czemu
  -- akceptacja nie dziala, zamiast klikac w nieskonczonosc.
  IF p_accept AND EXISTS (
       SELECT 1 FROM public.club_members m
        WHERE m.club_id = v_inv.club_id AND m.user_id = v_uid AND m.status = 'banned'
     ) THEN
    RAISE EXCEPTION 'clubs: banned' USING ERRCODE = '42501';
  END IF;

  UPDATE public.club_invitations
     SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
         responded_at = now()
   WHERE id = p_invitation_id;

  IF p_accept THEN
    INSERT INTO public.club_members (
      tenant_id, club_id, user_id, role, status, invited_by, invite_source
    ) VALUES (
      v_inv.tenant_id, v_inv.club_id, v_uid, v_inv.club_role, 'active',
      v_inv.inviter_id, 'direct'
    )
    -- Pas i szelki: gdyby ban powstal MIEDZY sprawdzeniem powyzej a tym
    -- zapisem, ON CONFLICT nadal go nie zdejmie.
    ON CONFLICT (club_id, user_id) DO UPDATE
      SET status = CASE WHEN club_members.status = 'banned'
                        THEN 'banned' ELSE 'active' END,
          role   = CASE WHEN club_members.status = 'banned'
                        THEN club_members.role ELSE EXCLUDED.role END;
    RETURN 'accepted';
  END IF;

  RETURN 'declined';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_respond_invitation(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_respond_invitation(uuid, boolean)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3) club_resolve_thread omijalo premoderacje
--
-- Funkcja sprawdzala rodzaj watku i uprawnienie, ale NIE jego status. Autor
-- pytania czekajacego w kolejce premoderacji (`status='pending'`) mogl wolac
-- club_resolve_thread(id, NULL) - a UPDATE ustawia wtedy `status='open'`,
-- czyli PUBLIKUJE wpis, ktorego moderator jeszcze nie widzial. Ta sama sciezka
-- odwracala 'hidden' po decyzji moderatora.
--
-- Poprawka jest dwuczesciowa: brama na wejsciu (nie-moderator nie rusza watku
-- spoza cyklu zycia dyskusji) i warunkowy powrot statusu (cofniecie oznaczenia
-- wraca do 'open' tylko z 'resolved' - nigdy z 'locked' czy 'dormant',
-- ktorych ta akcja nie ma prawa zmieniac).
-- ----------------------------------------------------------------------------
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
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;

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

  -- Wpis poza obiegiem dyskusji rusza wylacznie moderacja. Bez tego autor
  -- publikowal wlasny watek z kolejki premoderacji jednym kliknieciem.
  IF v_t.status IN ('pending', 'hidden', 'deleted')
     AND NOT COALESCE(v_caps.can_moderate, false) THEN
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
         status = CASE
                    -- Oznaczenie rozstrzygniecia podnosi status wylacznie
                    -- z otwartego obiegu; zamkniety watek zostaje zamkniety.
                    WHEN p_reply_id IS NOT NULL AND status IN ('open', 'dormant')
                      THEN 'resolved'
                    -- Cofniecie oznaczenia wraca do 'open' tylko z 'resolved'.
                    WHEN p_reply_id IS NULL AND status = 'resolved'
                      THEN 'open'
                    ELSE status
                  END
   WHERE id = p_thread_id;
  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.club_resolve_thread(uuid, uuid) IS
  'Oznacza odpowiedz rozstrzygajaca. NULL cofa oznaczenie. Watku w premoderacji, ukrytego albo usunietego dotyka wylacznie moderacja - inaczej autor publikowal wlasny wpis z kolejki tym wywolaniem.';

REVOKE EXECUTE ON FUNCTION public.club_resolve_thread(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_resolve_thread(uuid, uuid)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4) admin_club_replies ujawnialo autora anonimowego z pominieciem audytu
--
-- Specyfikacja (V1 par. 1.2) mowi jednoznacznie: moderator widzi tozsamosc
-- ZAWSZE, ale przez osobne, AUDYTOWANE RPC (club_moderator_reveal_author),
-- ktorego kazde wywolanie zostawia slad. Podglad watku w panelu zwracal
-- author_id i author_name bezwarunkowo - wiec cala ta konstrukcja byla
-- ozdobna: tozsamosc dalo sie odczytac wchodzac w zwykly podglad.
--
-- Kolumna `attribution_mode` dochodzi do projekcji, zeby panel mogl
-- powiedziec, DLACZEGO autora nie widac, i pokazac przycisk ujawnienia.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_club_replies(uuid, integer, integer);

CREATE FUNCTION public.admin_club_replies(
  p_thread_id uuid, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid, parent_id uuid, depth smallint, body text, status text,
  author_id uuid, author_name text, posted_by_admin_name text,
  is_anonymous boolean, attribution_mode text, author_alias text,
  reaction_count integer,
  created_at timestamptz, edited_at timestamptz, total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH rows AS (
    SELECT
      r.id, r.parent_id, r.depth, r.body, r.status,
      COALESCE(g.attribution_mode, c.attribution_mode) AS attr,
      r.is_anonymous,
      r.reaction_count, r.created_at, r.edited_at,
      r.author_id AS raw_author,
      COALESCE(NULLIF(btrim(p.display_name), ''), 'User') AS raw_name,
      NULLIF(btrim(pa.display_name), '') AS pb_name,
      r.thread_id
    FROM public.club_replies r
    JOIN public.club_threads t ON t.id = r.thread_id
    JOIN public.club_groups g ON g.id = t.group_id
    JOIN public.clubs c ON c.id = t.club_id
    LEFT JOIN public.profiles p ON p.id = r.author_id
    LEFT JOIN public.profiles pa ON pa.id = r.posted_by_admin_id
    WHERE r.thread_id = p_thread_id
      AND public.is_club_admin(auth.uid())
      AND c.tenant_id = public.current_tenant_id()
  )
  SELECT
    r.id, r.parent_id, r.depth, r.body, r.status,
    CASE WHEN r.is_anonymous OR r.attr = 'chatham' THEN NULL ELSE r.raw_author END,
    CASE WHEN r.is_anonymous OR r.attr = 'chatham' THEN NULL ELSE r.raw_name END,
    r.pb_name, r.is_anonymous, r.attr,
    -- Alias pozwala moderatorowi sledzic, kto z kim polemizuje, nie mowiac mu
    -- KTO to jest. Dokladnie ten sam alias, co widzi czytelnik.
    CASE WHEN r.is_anonymous OR r.attr = 'chatham'
         THEN public.club_author_alias(r.thread_id, r.raw_author) ELSE NULL END,
    r.reaction_count, r.created_at, r.edited_at,
    count(*) OVER () AS total_count
  FROM rows r
  ORDER BY r.created_at ASC, r.id ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$$;

COMMENT ON FUNCTION public.admin_club_replies(uuid, integer, integer) IS
  'Odpowiedzi watku w panelu. Autor wpisu anonimowego i klubu w trybie chatham NIE wychodzi - tozsamosc czyta sie wylacznie audytowanym club_moderator_reveal_author. Bez tego audyt ujawnien byl ozdoba.';

REVOKE EXECUTE ON FUNCTION public.admin_club_replies(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_replies(uuid, integer, integer)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5) club_reactions_for pytalo o widocznosc KLUBU zamiast GRUPY
--
-- To jedyny RPC odczytowy modulu, ktory wolal wspolne zrodlo prawdy o inna
-- pare niz reszta: `club_capabilities(r.club_id, NULL, auth.uid())`. Po A9
-- grupa moze miec wlasny prog planu i wlasny status, wiec licznik reakcji
-- wyciekal z grup roboczych (draft) i zza progu warstwy platnej - jako jedyny
-- sygnal w calym module.
--
-- Przy okazji: reakcje na tresc poza obiegiem (watek ukryty) nie licza sie do
-- niczego, wiec i ich nie zwracamy.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.club_reactions_for(text, uuid[]);

CREATE FUNCTION public.club_reactions_for(p_target_type text, p_target_ids uuid[])
RETURNS TABLE (target_id uuid, kind text, total bigint, mine boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH targets AS (
    -- Kazdy cel sprowadzony do pary (klub, grupa) - tej samej, o ktora pyta
    -- reszta modulu.
    SELECT t.id AS target_id, t.club_id, t.group_id, t.status
      FROM public.club_threads t
     WHERE p_target_type = 'thread' AND t.id = ANY(p_target_ids[1:200])
    UNION ALL
    SELECT r.id, r.club_id, t.group_id, t.status
      FROM public.club_replies r
      JOIN public.club_threads t ON t.id = r.thread_id
     WHERE p_target_type = 'reply' AND r.id = ANY(p_target_ids[1:200])
  )
  SELECT
    x.target_id, re.kind, count(*) AS total,
    bool_or(re.user_id = auth.uid()) AS mine
  FROM targets x
  JOIN public.club_reactions re
    ON re.target_type = p_target_type AND re.target_id = x.target_id
  WHERE x.status IN ('open', 'resolved', 'dormant', 'locked')
    AND (SELECT can_read FROM public.club_capabilities(x.club_id, x.group_id, auth.uid()))
  GROUP BY x.target_id, re.kind
$$;

COMMENT ON FUNCTION public.club_reactions_for(text, uuid[]) IS
  'Reakcje dla partii celow jednym zapytaniem - nigdy N+1. Widocznosc liczona dla pary (klub, GRUPA), tak jak w reszcie modulu: po A9 grupa ma wlasny prog planu i status, wiec bramka klubowa byla za szeroka.';

REVOKE EXECUTE ON FUNCTION public.club_reactions_for(text, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_reactions_for(text, uuid[])
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6) club_react i club_set_stance nie patrzyly na stan celu
--
-- Reakcja na watek ukryty przez moderacje podbijala jego `reaction_count`
-- i `hotness`, czyli podnosila w rankingu tresc, ktora moderator wlasnie
-- z rankingu zdjal. `club_reply` sprawdza to od A8 (locked_at + status);
-- reakcje i stanowiska tej bramki nie mialy.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_react(
  p_target_type text, p_target_id uuid, p_kind text
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_club   uuid;
  v_group  uuid;
  v_status text;
  v_locked timestamptz;
  v_caps   record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_target_type NOT IN ('thread', 'reply') THEN
    RAISE EXCEPTION 'clubs: invalid target type' USING ERRCODE = '22023';
  END IF;
  IF p_kind NOT IN ('insightful','evidence','question','agree','disagree','thanks') THEN
    RAISE EXCEPTION 'clubs: invalid reaction kind %', p_kind USING ERRCODE = '22023';
  END IF;

  -- Status i blokada celu doczytane w tym samym zapytaniu, co para (klub,
  -- grupa) - druga podroz do tabeli po to samo bylaby kosztem bez powodu.
  IF p_target_type = 'thread' THEN
    SELECT t.club_id, t.group_id, t.status, t.locked_at
      INTO v_club, v_group, v_status, v_locked
      FROM public.club_threads t WHERE t.id = p_target_id;
  ELSE
    SELECT t.club_id, t.group_id, r.status, t.locked_at
      INTO v_club, v_group, v_status, v_locked
      FROM public.club_replies r JOIN public.club_threads t ON t.id = r.thread_id
     WHERE r.id = p_target_id;
  END IF;
  IF v_club IS NULL THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;

  -- Stan CELU, nie tylko uprawnienie wolajacego. Bez tego reakcja na watek
  -- ukryty przez moderacje podbijala reaction_count i hotness, czyli windowala
  -- w rankingu tresc, ktora moderator wlasnie z niego zdjal.
  IF v_locked IS NOT NULL OR v_status IN ('hidden', 'deleted', 'pending') THEN
    RAISE EXCEPTION 'clubs: thread locked' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_caps FROM public.club_capabilities(v_club, v_group, v_uid);
  IF NOT COALESCE(v_caps.can_react, false) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  -- Blokada WYLACZNIE dla stanowiska i wylacznie na parze (wpis, osoba):
  -- reakcje jakosciowe nie sa rozlaczne, wiec nie ma czego serializowac,
  -- a szerszy klucz ustawialby w kolejce niezwiazane ze soba klikniecia.
  IF p_kind IN ('agree', 'disagree') THEN
    PERFORM pg_advisory_xact_lock(
      hashtext('club_stance:' || p_target_type || ':' || p_target_id::text),
      hashtext(v_uid::text));
  END IF;

  INSERT INTO public.club_reactions (tenant_id, club_id, target_type, target_id, user_id, kind)
  SELECT c.tenant_id, v_club, p_target_type, p_target_id, v_uid, p_kind
    FROM public.clubs c WHERE c.id = v_club
  ON CONFLICT (target_type, target_id, user_id, kind) DO NOTHING;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.club_react(text, uuid, text) IS
  'Postawienie reakcji. Rozlacznosc agree/disagree pilnuje trigger. Watek zamkniety, ukryty, usuniety albo w premoderacji nie przyjmuje reakcji - inaczej ranking podnosil tresc, ktora moderacja wlasnie z niego zdjela.';

REVOKE EXECUTE ON FUNCTION public.club_react(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_react(text, uuid, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_set_stance(
  p_thread_id uuid, p_stance text, p_rationale text DEFAULT NULL
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
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_stance NOT IN ('support', 'oppose', 'abstain') THEN
    RAISE EXCEPTION 'clubs: invalid stance %', p_stance USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_t FROM public.club_threads WHERE id = p_thread_id;
  IF NOT FOUND OR v_t.kind <> 'position' THEN
    RAISE EXCEPTION 'clubs: stances only apply to position threads' USING ERRCODE = '22023';
  END IF;

  IF v_t.locked_at IS NOT NULL OR v_t.status IN ('hidden', 'deleted', 'pending') THEN
    RAISE EXCEPTION 'clubs: thread locked' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_caps FROM public.club_capabilities(v_t.club_id, v_t.group_id, v_uid);
  IF NOT COALESCE(v_caps.can_react, false) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.club_stances (tenant_id, club_id, thread_id, user_id, stance, rationale)
  VALUES (v_t.tenant_id, v_t.club_id, p_thread_id, v_uid, p_stance,
          NULLIF(btrim(COALESCE(p_rationale, '')), ''))
  ON CONFLICT (thread_id, user_id) DO UPDATE
    SET stance = EXCLUDED.stance, rationale = EXCLUDED.rationale;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_set_stance(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_set_stance(uuid, text, text)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7) admin_club_group_delete zostawialo zanizony licznik grupy docelowej
--
-- Trigger `club_threads_sync_counts_tg` jest zadeklarowany jako
-- `AFTER INSERT OR UPDATE OF status OR DELETE`, wiec UPDATE samego `group_id`
-- go NIE odpala. `admin_club_thread_move` o tym wie i przelicza liczniki
-- jawnie; kasowanie grupy przenosilo watki tym samym UPDATE-em i nie
-- przeliczalo nic - grupa docelowa zostawala z licznikiem sprzed przeniesienia
-- na zawsze, bo nic go pozniej nie odbudowuje.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_club_group_delete(
  p_group_id uuid, p_move_to_group_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group   public.club_groups%ROWTYPE;
  v_target  public.club_groups%ROWTYPE;
  v_tenant  uuid := public.current_tenant_id();
  v_threads integer;
  v_left    integer;
BEGIN
  IF NOT public.is_club_admin(auth.uid()) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT g.* INTO v_group
    FROM public.club_groups g
    JOIN public.clubs c ON c.id = g.club_id
   WHERE g.id = p_group_id AND c.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::int INTO v_left
    FROM public.club_groups g WHERE g.club_id = v_group.club_id;
  IF v_left <= 1 THEN
    RAISE EXCEPTION 'clubs: last group cannot be removed' USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::int INTO v_threads
    FROM public.club_threads t WHERE t.group_id = p_group_id;

  IF v_threads > 0 THEN
    IF p_move_to_group_id IS NULL THEN
      RAISE EXCEPTION 'clubs: group not empty' USING ERRCODE = '42901';
    END IF;
    SELECT g.* INTO v_target FROM public.club_groups g
     WHERE g.id = p_move_to_group_id AND g.club_id = v_group.club_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'clubs: target group not in this club' USING ERRCODE = '42501';
    END IF;

    UPDATE public.club_threads t SET group_id = p_move_to_group_id
     WHERE t.group_id = p_group_id;

    -- Trigger licznikow reaguje na UPDATE OF status, nie group_id - tak samo,
    -- jak w admin_club_thread_move, przeliczamy tutaj jawnie.
    UPDATE public.club_groups g
       SET thread_count = (SELECT count(*)::int FROM public.club_threads t
                            WHERE t.group_id = g.id
                              AND t.status NOT IN ('deleted', 'hidden', 'pending'))
     WHERE g.id = p_move_to_group_id;
  END IF;

  DELETE FROM public.club_groups g WHERE g.id = p_group_id;

  INSERT INTO public.club_moderation_log (
    tenant_id, club_id, moderator_id, action, target_type, target_id, reason
  ) VALUES (v_tenant, v_group.club_id, auth.uid(), 'group_delete', 'group', p_group_id,
            CASE WHEN v_threads > 0
                 THEN format('%s: przeniesiono %s watkow', v_group.slug, v_threads)
                 ELSE format('%s: grupa pusta', v_group.slug) END);

  RETURN v_threads;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_club_group_delete(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_group_delete(uuid, uuid)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 8) Ban i wyjscie z klubu zostawialy zywe subskrypcje watkow
--
-- A8 domknelo WEJSCIE (club_subscribe_thread wola club_capabilities), ale
-- wiersze juz istniejace przezywaly utrate dostepu: `club_replies_autosubscribe`
-- zapisuje subskrypcje kazdemu, kto odpowie, a `club_ban_member` / `club_leave`
-- nie kasowaly ich. Zbanowany dostawal wiec dalej powiadomienia Z TYTULEM
-- WATKU z klubu, do ktorego nie ma juz wstepu.
--
-- Czyscimy przy zmianie statusu czlonkostwa - jedno zrodlo, obie sciezki
-- (ban i wyjscie) i takze kazda przyszla, ktora ten status ustawi.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_club_members_drop_subscriptions()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('banned', 'left') AND OLD.status IS DISTINCT FROM NEW.status THEN
    DELETE FROM public.club_thread_subscriptions s
     USING public.club_threads t
     WHERE s.thread_id = t.id
       AND t.club_id = NEW.club_id
       AND s.user_id = NEW.user_id;

    -- Licznik nieprzeczytanych tez traci podstawe: nie ma czego czytac.
    IF COALESCE(NEW.unread_count, 0) > 0 THEN
      PERFORM public.bump_user_counter(
        NEW.tenant_id, NEW.user_id, 'club_unread', -NEW.unread_count);
      NEW.unread_count := 0;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS club_members_drop_subscriptions_tg ON public.club_members;
CREATE TRIGGER club_members_drop_subscriptions_tg
  BEFORE UPDATE OF status ON public.club_members
  FOR EACH ROW EXECUTE FUNCTION public.tg_club_members_drop_subscriptions();

COMMENT ON FUNCTION public.tg_club_members_drop_subscriptions() IS
  'Ban albo wyjscie z klubu kasuje subskrypcje jego watkow. Bez tego producent powiadomien slal zbanowanemu tytuly watkow z klubu, do ktorego nie ma juz wstepu.';
