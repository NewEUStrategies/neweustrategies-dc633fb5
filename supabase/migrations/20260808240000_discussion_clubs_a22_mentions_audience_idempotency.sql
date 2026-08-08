-- ============================================================================
-- Kluby dyskusyjne - etap A22: publicznosc wzmianki i idempotencja tematu
--
-- 1) WZMIANKA W KLUBIE ZAMKNIETYM POWIADAMIALA OSOBE SPOZA KLUBU
--
-- Specyfikacja (V1 par. 4.3) wymienia trzy reguly specyficzne dla klubu, ktorych
-- generyczny `process_mentions` nie zna, i kaze dodac je w wywolujacym triggerze.
-- Regula pierwsza brzmi doslownie:
--
--     "wzmianka osoby SPOZA KLUBU w klubie private/secret NIE wysyla
--      powiadomienia (ujawnialaby istnienie klubu i jego tresc)"
--
-- Nie zostala wdrozona po zadnej ze stron. `process_mentions` (A12, A17)
-- powiadamia KAZDY profil dopasowany przez `@slug` w tym samym tenancie, a
-- szwy klubowe wolaja go bez zadnej bramki publicznosci. Powiadomienie niesie
-- `p_href` postaci `/club/<slug-klubu>/t/<slug-watku>`, wiec osoba, ktora nigdy
-- nie miala nic wspolnego z klubem `private` albo `secret`, dostaje do skrzynki
-- jego adres, tytul watku w linku i informacje, ze ktos o niej tam rozmawia.
-- Dla klubu `secret`, ktorego cala definicja brzmi "tylko czlonkowie wiedza, ze
-- istnieje", jest to bezposrednie zaprzeczenie modelu widocznosci.
--
-- Bramka jest scentralizowana w `process_mentions`, nie powielona w dwoch
-- triggerach, i to jest swiadome: dwie kopie reguly publicznosci to dwie
-- szanse na rozjazd, a wlasnie rozjazd kopii tej samej reguly wskazuje
-- specyfikacja (par. 7) jako najbardziej prawdopodobny sposob wyciekniecia
-- tego modulu.
--
-- 2) `club_create_thread` NIE BYLO IDEMPOTENTNE
--
-- V1 par. 6.3 wymaga wprost: "club_create_thread przez withCommandIdempotency
-- (klucz generuje frontend per akcje) - podwojny klik nie tworzy dwoch watkow".
-- RPC nie przyjmowalo klucza, a blokada `pg_advisory_xact_lock` z A9 tylko
-- SERIALIZUJE wywolania - nie deduplikuje ich. Podwojne klikniecie "Opublikuj"
-- albo retry POST-a po timeoucie sieci tworzylo drugi watek ze slugiem
-- `temat-1`, ktorego autor nie moze usunac sam.
--
-- Klucz jest OPCJONALNY: bez niego funkcja zachowuje sie dokladnie jak dotad,
-- wiec zaden istniejacy wolajacy nie zmienia zachowania.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Publicznosc wzmianki dla zrodel klubowych
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_mention_visible_to(
  p_source_type text, p_source_id text, p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club  uuid;
  v_group uuid;
BEGIN
  -- Zrodla spoza modulu klubow nie maja tu czego rozstrzygac: `comments`,
  -- `messages` i `crm_lead_notes` rzadza sie wlasnymi regulami i ta funkcja
  -- ich nie dotyka.
  IF p_source_type NOT IN ('club_thread', 'club_reply') THEN
    RETURN true;
  END IF;
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF p_source_type = 'club_thread' THEN
    SELECT t.club_id, t.group_id INTO v_club, v_group
      FROM public.club_threads t WHERE t.id = p_source_id::uuid;
  ELSE
    SELECT r.club_id, t.group_id INTO v_club, v_group
      FROM public.club_replies r
      JOIN public.club_threads t ON t.id = r.thread_id
     WHERE r.id = p_source_id::uuid;
  END IF;

  IF v_club IS NULL THEN
    RETURN false;
  END IF;

  -- JEDNO zrodlo prawdy o dostepie, to samo, ktorego uzywa kazdy RPC odczytowy.
  -- Wzmianka nie ma prawa dotrzec dalej, niz siega prawo do czytania tresci.
  RETURN COALESCE(
    (SELECT can_read FROM public.club_capabilities(v_club, v_group, p_user_id)),
    false
  );
EXCEPTION WHEN OTHERS THEN
  -- Przy watpliwosci NIE powiadamiamy. Blad w te strone kosztuje jedno
  -- niedostarczone powiadomienie; blad w druga - ujawnienie istnienia klubu.
  RETURN false;
END;
$$;

COMMENT ON FUNCTION public.club_mention_visible_to(text, text, uuid) IS
  'Czy wskazana osoba moze dostac powiadomienie o wzmiance w tym zrodle. Dla zrodel klubowych liczy club_capabilities: wzmianka nie siega dalej niz prawo do czytania tresci (V1 par. 4.3 regula 1). Dla pozostalych zrodel zawsze true.';

REVOKE EXECUTE ON FUNCTION public.club_mention_visible_to(text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_mention_visible_to(text, text, uuid) TO service_role;

-- Przepisujemy `process_mentions` w calosci (plpgsql nie ma skladni "dopisz
-- warunek"), zmieniajac DOKLADNIE jedno miejsce - warunek pominiecia odbiorcy.
CREATE OR REPLACE FUNCTION public.process_mentions(
  p_tenant_id uuid,
  p_source_type text,
  p_source_id text,
  p_body text,
  p_actor_id uuid,
  p_kind text,
  p_href text,
  p_actor_label text DEFAULT NULL,
  p_record_actor boolean DEFAULT true
)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug text;
  v_profile record;
  v_actor_name text;
  v_count integer := 0;
BEGIN
  IF p_body IS NULL OR position('@' in p_body) = 0 THEN
    RETURN 0;
  END IF;

  IF p_actor_label IS NOT NULL AND btrim(p_actor_label) <> '' THEN
    v_actor_name := btrim(p_actor_label);
  ELSE
    SELECT COALESCE(NULLIF(btrim(display_name), ''), 'Ktoś')
      INTO v_actor_name FROM public.profiles WHERE id = p_actor_id;
    v_actor_name := COALESCE(v_actor_name, 'Ktoś');
  END IF;

  FOR v_slug IN
    SELECT DISTINCT lower(m[1])
    FROM regexp_matches(p_body, '(?:^|[^a-zA-Z0-9@._-])@([a-zA-Z0-9][a-zA-Z0-9_-]{1,63})', 'g') AS m
    LIMIT 10
  LOOP
    SELECT id, display_name INTO v_profile
      FROM public.profiles
     WHERE tenant_id = p_tenant_id AND slug = v_slug;
    IF v_profile.id IS NULL OR v_profile.id = p_actor_id THEN
      CONTINUE;
    END IF;

    -- BRAMKA PUBLICZNOSCI. Dla zrodel klubowych wzmianka osoby, ktora nie ma
    -- prawa czytac tej tresci, nie tworzy ani krawedzi w grafie, ani
    -- powiadomienia, ani zdarzenia na szynie: kazde z tych trzech zdradza
    -- istnienie klubu zamknietego, a `p_href` zdradza dodatkowo jego adres.
    -- Interfejs proponuje w tym miejscu zaproszenie - i to jest wlasciwa
    -- droga, zeby kogos do rozmowy dolaczyc.
    IF NOT public.club_mention_visible_to(p_source_type, p_source_id, v_profile.id) THEN
      CONTINUE;
    END IF;

    PERFORM public.add_cross_reference(
      p_tenant_id, p_source_type, p_source_id,
      'profile', v_profile.id::text, 'mention',
      CASE WHEN p_record_actor THEN p_actor_id ELSE NULL END
    );

    PERFORM public.enqueue_notification(
      v_profile.id,
      p_kind,
      v_actor_name || ' wspomniał(a) o Tobie',
      v_actor_name || ' mentioned you',
      NULL, NULL,
      p_href,
      'at-sign'
    );

    PERFORM public.emit_domain_event(
      p_tenant_id, p_source_type, p_source_id, 'mention.created.v1',
      jsonb_build_object(
        'mentioned_user_id', v_profile.id,
        'actor_id', CASE WHEN p_record_actor THEN to_jsonb(p_actor_id) ELSE 'null'::jsonb END,
        'source_type', p_source_type
      ),
      p_suppress_actor => NOT p_record_actor
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
EXCEPTION WHEN OTHERS THEN
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION
  public.process_mentions(uuid, text, text, text, uuid, text, text, text, boolean) IS
  'Parsuje @wzmianki, dokłada krawędź w cross_references, kolejkuje powiadomienie i emituje mention.created.v1. Dla źródeł klubowych respektuje widoczność klubu: wzmianka nie sięga dalej niż prawo do czytania treści.';

-- ----------------------------------------------------------------------------
-- 2) Idempotencja zakladania tematu
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.club_create_thread(uuid, text, text, text, boolean, text, text);

-- Cialo jest WIERNA KOPIA wersji z A9 z dolozonymi trzema fragmentami
-- idempotencji i niczym wiecej. Kazda linia poza nimi - komunikaty bledow
-- (klient mapuje je po TRESCI), kody SQLSTATE, wymog kotwicy dla rodzaju
-- `resource`, klucz blokady doradczej per UZYTKOWNIK (nie per grupa: limit
-- 10/24h liczy sie po autorze, wiec szerszy klucz przepuscilby rownolegle
-- wywolania w roznych grupach) - jest przeniesiona bez zmiany. Przepisanie
-- funkcji z pamieci zamiast z jej biezacego zrodla to sposob, w jaki gubi sie
-- warunek, ktorego nikt nie zauwazy, dopoki nie zawiedzie.
CREATE FUNCTION public.club_create_thread(
  p_group_id        uuid,
  p_title           text,
  p_body            text,
  p_kind            text DEFAULT 'discussion',
  p_anonymous       boolean DEFAULT false,
  p_anchor_type     text DEFAULT NULL,
  p_anchor_id       text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
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
  v_key       text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_prior     jsonb;
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

  -- IDEMPOTENCJA (1/3): powtorka z tym samym kluczem zwraca ZAPAMIETANY watek.
  -- Sprawdzenie stoi po rozwiazaniu tenanta (wpis jest per tenant), a przed
  -- bramkami uprawnien - powtorka ma byc tania i nie ma powodu liczyc dla niej
  -- niczego drugi raz.
  IF v_key IS NOT NULL THEN
    SELECT ci.result INTO v_prior
      FROM public.command_idempotency ci
     WHERE ci.tenant_id = v_club.tenant_id
       AND ci.idempotency_key = v_key
       AND ci.command = 'club_create_thread'
       AND ci.status = 'succeeded';
    IF v_prior IS NOT NULL THEN
      id := (v_prior->>'id')::uuid;
      slug := v_prior->>'slug';
      status := v_prior->>'status';
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

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

  -- IDEMPOTENCJA (2/3): powtorne sprawdzenie POD blokada. Dwa rownolegle
  -- klikniecia moga oba przejsc pierwsze sprawdzenie (jeszcze nic nie ma
  -- w tabeli); dopiero to zamyka okno zbieznosci.
  IF v_key IS NOT NULL THEN
    SELECT ci.result INTO v_prior
      FROM public.command_idempotency ci
     WHERE ci.tenant_id = v_club.tenant_id
       AND ci.idempotency_key = v_key
       AND ci.command = 'club_create_thread'
       AND ci.status = 'succeeded';
    IF v_prior IS NOT NULL THEN
      id := (v_prior->>'id')::uuid;
      slug := v_prior->>'slug';
      status := v_prior->>'status';
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

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

  -- IDEMPOTENCJA (3/3): zapis wyniku. `ON CONFLICT DO NOTHING`, bo klucz mogl
  -- w miedzyczasie zarezerwowac inny commit - wtedy jego wynik jest rownie
  -- dobry i nie ma czego nadpisywac.
  IF v_key IS NOT NULL THEN
    INSERT INTO public.command_idempotency (
      tenant_id, idempotency_key, command, actor_id, status, result, completed_at
    ) VALUES (
      v_club.tenant_id, v_key, 'club_create_thread', v_uid, 'succeeded',
      jsonb_build_object('id', v_id, 'slug', v_slug, 'status', v_status), now()
    )
    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING;
  END IF;

  id := v_id; slug := v_slug; status := v_status;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION
  public.club_create_thread(uuid, text, text, text, boolean, text, text, text) IS
  'Zaklada temat. Klucz idempotencji jest OPCJONALNY: z nim powtorka zwraca zapamietany watek zamiast zakladac drugi (V1 par. 6.3), bez niego zachowanie jest jak w A9. Blokada advisory serializuje, ale NIE deduplikuje - to dwie rozne rzeczy.';

REVOKE EXECUTE ON FUNCTION
  public.club_create_thread(uuid, text, text, text, boolean, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.club_create_thread(uuid, text, text, text, boolean, text, text, text)
  TO authenticated, service_role;
