-- ============================================================================
-- Discussion Club A9 - zasieg grupy roboczej, wyscigi limitow, rozlacznosc
--                      stanowiska
--
-- Trzy znaleziska z audytu, potwierdzone na kodzie w stanie po A8. Kazde
-- zostawia sekcje z opisem, co dokladnie bylo zle - bo za pol roku diff
-- powie CO sie zmienilo, a nie DLACZEGO to bylo zlamane.
--
-- 1) [WYCIEK TRESCI] Grupa 'draft'/'archived' byla czytelna dla kazdego
--    czlonka. club_capabilities ustawiala dla niej wylacznie v_group_open,
--    a ten steruje TYLKO pisaniem - can_read zostawalo prawda. Repo samo
--    deklaruje granice ("Grupa w przygotowaniu jest widoczna wylacznie dla
--    zarzadzajacego", club_groups_list i club_threads_list ja egzekwuja),
--    ale club_thread_view, club_replies_list i club_semantic_search juz nie.
--    Scenariusz konca-w-koniec: admin zaklada watek w grupie roboczej (ma
--    can_post_thread, bo galaz `WHEN v_is_admin THEN true` stoi przed
--    sprawdzeniem v_group_open), czlonek znajduje go wyszukiwarka i czyta
--    cala dyskusje. Nigdzie po drodze nie jest wymagane can_manage.
--    Wzmocnienie: dla klubu 'public' galaz ANONIMOWA konczyla sie zanim
--    _group_id bylo w ogole rozwiazane, wiec anonim mial can_read = true
--    na dowolna grupe.
--
--    Poprawka idzie do ZRODLA, nie do pieciu klauzul WHERE: can_read = false
--    w club_capabilities zalatwia kazdego wolajacego, ktory przekazuje
--    group_id - a robia to wszyscy. Filtr w club_semantic_search dokladamy
--    mimo to, bo tanszy niz LATERAL i chroni przed regresja w capabilities.
--
-- 2) [WYSCIG] Limity antyspamowe bez blokady w dwoch ostatnich sciezkach.
--    A8 zserializowala club_reply i club_invite, ale club_create_thread
--    (10 watkow / 24 h) i club_invite_by_email zostaly. Gorsze:
--    club_invite_by_email dzieli licznik z club_invite, a nie bierze tego
--    samego klucza blokady, wiec przechodzi obok niej bokiem.
--
-- 3) [INTEGRALNOSC] Rozlacznosc 'agree'/'disagree' pilnowal WYLACZNIE
--    trigger BEFORE INSERT. Pod READ COMMITTED jego DELETE nie widzi
--    niezatwierdzonego INSERT-a z rownoleglej transakcji, wiec ta sama
--    osoba lada na mapie stanowisk dwa razy, po obu stronach. To nie jest
--    luka bezpieczenstwa (sprawca i ofiara to ta sama osoba, zero eskalacji),
--    tylko brud w danych - i naprawia sie go deklaratywnie, indeksem.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Grupa robocza znika z can_read
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_capabilities(
  _club_id uuid,
  _group_id uuid DEFAULT NULL,
  _user_id uuid DEFAULT auth.uid()
)
RETURNS TABLE (
  can_read          boolean,
  can_post_thread   boolean,
  can_reply         boolean,
  can_react         boolean,
  can_moderate      boolean,
  can_manage        boolean,
  can_invite        boolean,
  can_see_members   boolean,
  can_reveal_author boolean,
  effective_role    text,
  reason            text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club        public.clubs%ROWTYPE;
  v_group       public.club_groups%ROWTYPE;
  v_member      public.club_members%ROWTYPE;
  v_caller      uuid := auth.uid();
  v_is_admin    boolean;
  v_is_editor   boolean;
  v_home_tenant uuid;
  v_role        text;
  v_visibility  text;
  v_who_can_post text;
  v_min_tier    integer;
  v_reason      text := NULL;
  v_read        boolean := false;
  v_group_open  boolean := true;
BEGIN
  SELECT * INTO v_club FROM public.clubs c WHERE c.id = _club_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                        'non_member'::text, 'not_found'::text;
    RETURN;
  END IF;

  -- Pytanie o CUDZE uprawnienia przysluguje wylacznie adminowi TEGO tenanta.
  -- Dla wszystkich innych parametr jest po cichu zastepowany wolajacym.
  IF _user_id IS DISTINCT FROM v_caller
     AND NOT (public.is_club_admin(v_caller) AND v_club.tenant_id = public.current_tenant_id())
  THEN
    _user_id := v_caller;
  END IF;

  v_is_admin  := public.is_club_admin(_user_id);
  v_is_editor := _user_id IS NOT NULL AND public.has_role(_user_id, 'editor');

  SELECT p.tenant_id INTO v_home_tenant FROM public.profiles p WHERE p.id = _user_id;

  -- Grupa wczytywana PRZED galezia anonimowa: bez tego anonim w klubie
  -- publicznym dostawal can_read = true na DOWOLNA grupe, takze robocza,
  -- bo galaz anonimowa konczyla sie zanim _group_id zostalo w ogole
  -- rozwiazane.
  IF _group_id IS NOT NULL THEN
    SELECT * INTO v_group FROM public.club_groups g
     WHERE g.id = _group_id AND g.club_id = _club_id;
    IF NOT FOUND THEN
      RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                          'non_member'::text, 'not_found'::text;
      RETURN;
    END IF;
  END IF;

  IF _user_id IS NULL THEN
    -- Anonim: wylacznie kluby 'public' o statusie 'active' i WYLACZNIE
    -- w tenancie biezacego hosta. Bez sprawdzenia tenanta anonim widzialby
    -- publiczne kluby wszystkich tenantow po samym id.
    IF v_club.visibility = 'public' AND v_club.status = 'active'
       AND v_club.tenant_id = public.public_tenant_id()
       AND (v_group.id IS NULL OR v_group.status NOT IN ('draft', 'archived')) THEN
      RETURN QUERY SELECT true, false, false, false, false, false, false, false, false,
                          'non_member'::text, NULL::text;
    ELSE
      RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                          'non_member'::text, 'auth_required'::text;
    END IF;
    RETURN;
  END IF;

  IF v_home_tenant IS NULL OR v_home_tenant <> v_club.tenant_id THEN
    RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                        'non_member'::text, 'not_found'::text;
    RETURN;
  END IF;

  SELECT * INTO v_member FROM public.club_members m
   WHERE m.club_id = _club_id AND m.user_id = _user_id;

  IF FOUND AND v_member.status = 'banned' THEN
    RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                        'banned'::text, 'banned'::text;
    RETURN;
  END IF;

  v_role := CASE
    WHEN v_member.id IS NULL OR v_member.status <> 'active' THEN 'non_member'
    ELSE public.club_effective_member_role(v_member.role, v_member.role_expires_at)
  END;

  -- Klub 'secret', do ktorego nie naleze, ma byc NIEODROZNIALNY od nieistniejacego.
  -- Ta bramka jest PRZED wszystkimi innymi, zeby zaden inny kod powodu
  -- (tier_too_low, group_frozen) nie zdradzil, ze klub istnieje.
  IF v_club.visibility = 'secret' AND v_role = 'non_member' AND NOT v_is_admin THEN
    RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                        'non_member'::text, 'not_found'::text;
    RETURN;
  END IF;

  -- Klub w wersji roboczej albo zarchiwizowany nie istnieje dla nie-staffu.
  IF v_club.status <> 'active' AND NOT v_is_admin THEN
    RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                        v_role,
                        CASE WHEN v_club.status = 'draft' THEN 'not_open_yet' ELSE 'archived' END;
    RETURN;
  END IF;

  v_visibility   := COALESCE(v_group.visibility, v_club.visibility);
  v_who_can_post := COALESCE(v_group.who_can_post, v_club.who_can_post);
  v_min_tier     := COALESCE(v_group.min_tier_rank, v_club.min_tier_rank);

  IF _group_id IS NOT NULL AND NOT v_is_admin THEN
    -- Grupa robocza albo zarchiwizowana nie istnieje dla nie-zarzadzajacego.
    -- Wczesniej ustawialo to WYLACZNIE v_group_open, a ten steruje tylko
    -- pisaniem - can_read zostawalo prawda, wiec tresc grupy roboczej
    -- wychodzila przez club_thread_view, club_replies_list i wyszukiwarke.
    -- Ta bramka stoi PO bramce klubu 'secret', zeby nie zdradzic istnienia
    -- klubu, ktory ma byc nieodrozniany od nieistniejacego.
    IF v_group.status IN ('draft', 'archived') THEN
      RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                          v_role,
                          CASE WHEN v_group.status = 'draft'
                               THEN 'not_open_yet' ELSE 'archived' END;
      RETURN;
    ELSIF v_group.status = 'frozen' THEN
      v_group_open := false;
      v_reason := 'group_frozen';
    ELSIF v_group.opens_at IS NOT NULL AND v_group.opens_at > now() THEN
      v_group_open := false;
      v_reason := 'not_open_yet';
    ELSIF v_group.closes_at IS NOT NULL AND v_group.closes_at <= now() THEN
      v_group_open := false;
      v_reason := 'window_closed';
    END IF;
  END IF;

  -- Prog planu: has_tier_rank() liczy plan SESJI, wiec jest poprawny wylacznie
  -- gdy pytamy o samego siebie. Dla podgladu cudzych uprawnien liczymy rangę
  -- WSKAZANEJ osoby - inaczej "Podglad jako..." pokazywalby plan admina.
  IF v_min_tier > 0 AND NOT v_is_admin AND v_role = 'non_member' THEN
    IF _user_id = v_caller THEN
      IF NOT public.has_tier_rank(v_min_tier) THEN
        RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                            v_role, 'tier_too_low'::text;
        RETURN;
      END IF;
    ELSE
      -- Podglad cudzych uprawnien: bez sesji tamtej osoby nie da sie policzyc
      -- jej planu, wiec zglaszamy prog jako nierozstrzygniety zamiast klamac.
      v_reason := COALESCE(v_reason, 'tier_unknown');
    END IF;
  END IF;

  v_read := CASE
    WHEN v_is_admin THEN true
    WHEN v_role <> 'non_member' THEN true
    WHEN v_visibility IN ('public', 'members') THEN true
    ELSE false
  END;

  IF NOT v_read AND v_reason IS NULL THEN
    v_reason := 'not_member';
  END IF;

  IF v_reason IS NULL
     AND v_role IN ('member', 'observer')
     AND COALESCE(v_group.moderation_mode, v_club.moderation_mode) = 'pre' THEN
    v_reason := 'pre_moderation';
  END IF;

  RETURN QUERY SELECT
    v_read,
    CASE
      WHEN v_is_admin THEN true
      WHEN NOT v_read OR NOT v_group_open THEN false
      WHEN v_role IN ('lead', 'moderator') THEN true
      WHEN v_who_can_post = 'staff_only' THEN v_is_editor
      WHEN v_who_can_post = 'moderators' THEN false
      WHEN v_who_can_post = 'members' THEN v_role = 'member' OR v_is_editor
      ELSE false
    END,
    CASE
      WHEN v_is_admin THEN true
      WHEN NOT v_read OR NOT v_group_open THEN false
      WHEN v_role IN ('lead', 'moderator', 'member') THEN true
      WHEN v_is_editor AND v_read THEN true
      ELSE false
    END,
    CASE
      WHEN v_is_admin THEN true
      WHEN NOT v_read OR NOT v_group_open THEN false
      WHEN v_role IN ('lead', 'moderator', 'member') THEN true
      WHEN v_is_editor AND v_read THEN true
      ELSE false
    END,
    (v_is_admin OR (v_read AND v_role IN ('lead', 'moderator'))),
    v_is_admin,
    (v_is_admin OR (v_read AND v_role = 'lead')),
    v_read,
    v_is_admin,
    v_role,
    v_reason;
END;
$$;

COMMENT ON FUNCTION public.club_capabilities(uuid, uuid, uuid) IS
  'JEDYNE zrodlo prawdy o dostepie. Grupa draft/archived zeruje can_read, nie tylko can_post - inaczej tresc grupy roboczej wychodzila przez widok watku, liste odpowiedzi i wyszukiwarke. Parametr _user_id honorowany wylacznie dla samego siebie albo dla admina TEGO tenanta.';

REVOKE EXECUTE ON FUNCTION public.club_capabilities(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_capabilities(uuid, uuid, uuid)
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 1b) Wyszukiwanie semantyczne - filtr grupy wprost
--
-- club_search i club_threads_for_anchor dostaly go w A8; ta funkcja jako
-- jedyna z trojki zostala na wersji z A6.
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
  )
  SELECT
    t.id, t.club_id, c.slug, c.name_pl, c.name_en,
    t.slug, t.title, t.kind, t.reply_count, t.last_reply_at,
    (1 - (e.embedding <=> q.v))::real AS similarity
  FROM public.club_thread_embeddings e
  CROSS JOIN q
  JOIN public.club_threads t ON t.id = e.thread_id
  JOIN public.clubs c ON c.id = t.club_id
  JOIN public.club_groups g ON g.id = t.group_id
  CROSS JOIN LATERAL public.club_capabilities(t.club_id, t.group_id, auth.uid()) cap
  WHERE cap.can_read
    AND t.status IN ('open', 'resolved', 'dormant', 'locked')
    AND (g.status NOT IN ('draft', 'archived') OR cap.can_manage)
    AND (p_club_id IS NULL OR t.club_id = p_club_id)
    -- Prog podobienstwa odsiewa "najblizszych z dalekich": bez niego kazde
    -- zapytanie zwraca limit wynikow, takze wtedy, gdy zaden nie pasuje.
    AND (1 - (e.embedding <=> q.v)) >= COALESCE(p_threshold, 0.25)
  ORDER BY e.embedding <=> q.v, t.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
$$;

REVOKE EXECUTE ON FUNCTION public.club_semantic_search(double precision[], uuid, integer, real)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_semantic_search(double precision[], uuid, integer, real)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 1c) Wektory nie powstaja z tresci grupy roboczej
--
-- club_thread_embedding_source wciaga g.name_pl razem z trescia watku, wiec
-- bez tego filtru nazwa i tresc grupy roboczej realnie ladowaly w tabeli
-- osadzen. Kolejka je pomija, a prune sprzata te, ktore juz tam sa - takze
-- wtedy, gdy grupa zostala zamrozona do 'archived' PO wyliczeniu wektora.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_threads_needing_embeddings(p_limit integer DEFAULT 50)
RETURNS TABLE (thread_id uuid, tenant_id uuid, source text, source_hash text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidates AS (
    SELECT t.id, t.tenant_id,
           public.club_thread_embedding_source(t.id) AS src
      FROM public.club_threads t
      JOIN public.club_groups g ON g.id = t.group_id
     WHERE t.status IN ('open', 'resolved', 'dormant', 'locked')
       AND g.status NOT IN ('draft', 'archived')
     ORDER BY t.updated_at DESC
     LIMIT GREATEST(COALESCE(p_limit, 50), 1) * 4
  )
  SELECT c.id, c.tenant_id, c.src, md5(c.src)
    FROM candidates c
    LEFT JOIN public.club_thread_embeddings e ON e.thread_id = c.id
   WHERE c.src IS NOT NULL
     AND (e.thread_id IS NULL OR e.source_hash IS DISTINCT FROM md5(c.src))
   LIMIT GREATEST(COALESCE(p_limit, 50), 1)
$$;

REVOKE EXECUTE ON FUNCTION public.club_threads_needing_embeddings(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_threads_needing_embeddings(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.club_prune_thread_embeddings()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.club_thread_embeddings e
   WHERE NOT EXISTS (
     SELECT 1
       FROM public.club_threads t
       JOIN public.club_groups g ON g.id = t.group_id
      WHERE t.id = e.thread_id
        AND t.status IN ('open', 'resolved', 'dormant', 'locked')
        AND g.status NOT IN ('draft', 'archived')
   );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_prune_thread_embeddings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_prune_thread_embeddings() TO service_role;

-- Osadzenia policzone dla watkow, ktore juz siedza w grupie roboczej albo
-- zarchiwizowanej, znikaja od razu - inaczej wyciek trwalby do najblizszego
-- przebiegu harmonogramu.
SELECT public.club_prune_thread_embeddings();

-- ----------------------------------------------------------------------------
-- 2) Limity antyspamowe: dwie ostatnie sciezki bez blokady
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
  --
  -- Blokada doradcza PRZED liczeniem. Bez niej N rownoleglych wywolan czyta
  -- ten sam licznik sprzed dowolnego INSERT-a i wszystkie przechodza:
  -- limit "10 na dobe" zamienial sie w "10 na dobe plus cokolwiek zmiesci sie
  -- w jednym oknie zbieznosci". A8 zserializowala club_reply i club_invite -
  -- to jest trzecia z tych sciezek. Klucz per uzytkownik, wiec dwie rozne
  -- osoby nadal pisza rownolegle.
  PERFORM pg_advisory_xact_lock(hashtext('club_create_thread:' || v_uid::text));

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

CREATE OR REPLACE FUNCTION public.club_invite_by_email(
  p_club_id  uuid,
  p_email    text,
  p_role     text DEFAULT 'member',
  p_group_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_tenant    uuid;
  v_caps      record;
  v_email     text := lower(btrim(p_email));
  v_inviter   text;
  v_id        uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;
  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'clubs: invalid email' USING ERRCODE = '22023';
  END IF;
  IF p_role NOT IN ('moderator', 'member', 'observer') THEN
    RAISE EXCEPTION 'clubs: invalid club role %', p_role USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_caps FROM public.club_capabilities(p_club_id, p_group_id, v_uid);
  IF NOT COALESCE(v_caps.can_invite, false) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_role = 'moderator' AND NOT public.is_club_admin(v_uid) THEN
    RAISE EXCEPTION 'clubs: elevated role requires admin' USING ERRCODE = '42501';
  END IF;
  -- TEN SAM klucz blokady co club_invite. Obie sciezki dziela jeden licznik
  -- (club_invite_quota_ok liczy club_invitations RAZEM z user_invitations),
  -- wiec osobny klucz byl gorszy niz zaden: A8 zserializowala club_invite,
  -- a sciezka e-mailowa i tak przechodzila obok tej blokady bokiem.
  PERFORM pg_advisory_xact_lock(hashtext('club_invite:' || v_uid::text));

  IF NOT public.club_invite_quota_ok(v_uid) THEN
    RAISE EXCEPTION 'clubs: invite quota exceeded' USING ERRCODE = '42901';
  END IF;

  SELECT c.tenant_id INTO v_tenant FROM public.clubs c WHERE c.id = p_club_id;
  SELECT COALESCE(NULLIF(btrim(p.display_name), ''), 'NES') INTO v_inviter
    FROM public.profiles p WHERE p.id = v_uid;

  -- KLUCZOWE: rola platformy to ZAWSZE 'user'. Rola klubowa jedzie wylacznie
  -- w metadata.club_role. Ta funkcja nie przyjmuje roli platformy jako
  -- parametru, wiec nie da sie jej podac nawet przez pomylke (V2 §3.2).
  INSERT INTO public.user_invitations (
    tenant_id, email, role, mode, status, source, metadata, invited_by, expires_at
  ) VALUES (
    v_tenant, v_email, 'user'::public.app_role, 'magic_link', 'pending', 'club',
    jsonb_build_object(
      'club_id', p_club_id,
      'group_id', p_group_id,
      'club_role', p_role,
      'invited_by_name', v_inviter
    ),
    v_uid,
    now() + interval '30 days'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_create_thread(uuid, text, text, text, boolean, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_create_thread(uuid, text, text, text, boolean, text, text)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.club_invite_by_email(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_invite_by_email(uuid, text, text, uuid)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3) Rozlacznosc stanowiska egzekwowana przez baze, nie przez trigger
--
-- Trigger BEFORE INSERT zostaje - to on realizuje ZMIANE ZDANIA (klikniecie
-- "nie zgadzam sie" po "zgadzam sie" ma podmienic, a nie rzucic bledem).
-- Ale sam trigger nie jest ograniczeniem: pod READ COMMITTED jego DELETE
-- nie widzi niezatwierdzonego INSERT-a z rownoleglej transakcji. Dokladamy
-- wiec dwie warstwy:
--   - indeks czesciowy: TWARDY zakaz dwoch stanowisk, egzekwowany przez baze
--     niezaleznie od tego, jaka sciezka wstawia wiersz,
--   - blokada doradcza w club_react: rownolegle zmiany zdania TEJ SAMEJ osoby
--     na TYM SAMYM wpisie ustawiaja sie w kolejke, zamiast jedna z nich
--     wracac do klienta bledem 23505.
-- ----------------------------------------------------------------------------

-- Sprzatanie przed indeksem: gdyby wyscig juz sie zdarzyl, zostaje NAJNOWSZE
-- stanowisko - ostatnia deklaracja jest ta obowiazujaca.
DELETE FROM public.club_reactions r
 WHERE r.kind IN ('agree', 'disagree')
   AND EXISTS (
     SELECT 1 FROM public.club_reactions r2
      WHERE r2.target_type = r.target_type
        AND r2.target_id = r.target_id
        AND r2.user_id = r.user_id
        AND r2.kind IN ('agree', 'disagree')
        AND (r2.created_at, r2.id) > (r.created_at, r.id)
   );

CREATE UNIQUE INDEX IF NOT EXISTS club_reactions_one_stance
  ON public.club_reactions (target_type, target_id, user_id)
  WHERE kind IN ('agree', 'disagree');

COMMENT ON INDEX public.club_reactions_one_stance IS
  'Jedno stanowisko na wpis i osobe. UNIQUE (target, user, kind) tego nie pilnuje, bo agree i disagree to rozne kind - trigger podmieniajacy jest wygoda UX, a nie ograniczeniem integralnosci.';

CREATE OR REPLACE FUNCTION public.club_react(
  p_target_type text, p_target_id uuid, p_kind text
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_club    uuid;
  v_group   uuid;
  v_caps    record;
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

  IF p_target_type = 'thread' THEN
    SELECT club_id, group_id INTO v_club, v_group
      FROM public.club_threads WHERE id = p_target_id;
  ELSE
    SELECT t.club_id, t.group_id INTO v_club, v_group
      FROM public.club_replies r JOIN public.club_threads t ON t.id = r.thread_id
     WHERE r.id = p_target_id;
  END IF;
  IF v_club IS NULL THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
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

REVOKE EXECUTE ON FUNCTION public.club_react(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_react(text, uuid, text) TO authenticated, service_role;
