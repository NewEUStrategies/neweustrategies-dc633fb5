-- ============================================================================
-- Kluby dyskusyjne - etap A25: ogloszenie zachowuje sie jak ogloszenie
--
-- BLAD, KTORY TO NAPRAWIA. Rodzaj watku mial - zgodnie z komentarzem przy
-- `club_threads.kind` - "zmieniac CYKL ZYCIA, a nie tylko etykiete". Dla pieciu
-- rodzajow tak jest: `question` dostaje rozstrzygajaca odpowiedz, `position`
-- zbiera stanowiska, `resource` wymaga kotwicy, `poll` niesie ankiete,
-- `discussion` jest domyslna. `announcement` nie dostawal NICZEGO poza bramka
-- "tylko moderacja moze go zalozyc" - powstawal jako zwykly watek, nieprzypiety,
-- ktory po trzech nowych dyskusjach spadal ponizej linii ekranu. Ogloszenie,
-- ktore trzeba wyszukac, nie jest ogloszeniem.
--
-- DWIE ZMIANY, OBIE W BAZIE:
--
--   1. PRZYPIECIE JEST WLASNOSCIA RODZAJU, nie recznym krokiem moderatora.
--      Wczesniej trzeba bylo pamietac o osobnej akcji "przypnij" po publikacji;
--      kto zapomnial, ten opublikowal ogloszenie, ktorego nikt nie zobaczy.
--      Sort `hot` i `new` juz honoruja `pinned_at` (patrz A18), wiec to jedno
--      pole zalatwia widocznosc bez dotykania listy.
--
--   2. `p_lock_replies` - mozliwosc zalozenia watku OD RAZU zamknietego.
--      Ogloszenie "od poniedzialku zmieniamy regulamin" czesto ma byc
--      komunikatem, a nie watkiem; dotad jedyna droga byly dwa kroki
--      (opublikuj, potem zamknij), miedzy ktorymi watek stal otworem.
--      Parametr dziala dla KAZDEGO rodzaju i jest zwiazany z `can_moderate` -
--      zamykanie cudzej rozmowy to uprawnienie moderacyjne, niezaleznie od
--      tego, czy dzieje sie przy zakladaniu, czy pozniej.
--
-- Dlaczego w bazie, a nie w kompozytorze: watek zaklada sie z trzech miejsc
-- (kompozytor, panel administracyjny, seed). Regula wpisana w jedno z nich
-- byla by regula obowiazujaca w jednym z nich.
--
-- ARNOSC. Parametr z wartoscia domyslna nie zastepuje funkcji, tylko tworzy
-- PRZECIAZENIE - wywolanie bez niego staloby sie niejednoznaczne. Stad DROP
-- osmioargumentowej wersji i CREATE dziewiecioargumentowej. Cialo jest wierna
-- kopia A22 (razem z kompletem idempotencji) z dolozonymi trzema fragmentami
-- i niczym wiecej.
-- ============================================================================

DROP FUNCTION IF EXISTS public.club_create_thread(uuid, text, text, text, boolean, text, text, text);

CREATE FUNCTION public.club_create_thread(
  p_group_id        uuid,
  p_title           text,
  p_body            text,
  p_kind            text DEFAULT 'discussion',
  p_anonymous       boolean DEFAULT false,
  p_anchor_type     text DEFAULT NULL,
  p_anchor_id       text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_lock_replies    boolean DEFAULT false
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
  v_lock      boolean := COALESCE(p_lock_replies, false);
  v_pinned    timestamptz;
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

  -- Zamkniecie watku przy zakladaniu to TA SAMA wladza, co zamkniecie go
  -- godzine pozniej - i tak samo zwiazana z `can_moderate`. Bez tego warunku
  -- kazdy czlonek publikowalby "dyskusje", w ktorej nie wolno mu odpowiedziec.
  IF v_lock AND NOT COALESCE(v_caps.can_moderate, false) THEN
    RAISE EXCEPTION 'clubs: locking a thread requires moderator' USING ERRCODE = '42501';
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

  -- Zamkniecie NIE nadpisuje premoderacji: watek czekajacy na zatwierdzenie ma
  -- zostac 'pending', bo inaczej wypadlby z kolejki moderacji, do ktorej sam
  -- sie zglosil. W praktyce galaz jest nieosiagalna (zamykac moze tylko
  -- moderator, a moderator nie trafia do kolejki) - warunek stoi tu po to,
  -- zeby pozostala nieosiagalna takze po zmianie regul premoderacji.
  IF v_lock AND v_status = 'open' THEN
    v_status := 'locked';
  END IF;

  -- Ogloszenie jest przypiete Z DEFINICJI. Reszta rodzajow wchodzi bez
  -- przypiecia i czeka na decyzje moderatora.
  v_pinned := CASE WHEN p_kind = 'announcement' THEN now() ELSE NULL END;

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
    is_anonymous, anchor_type, anchor_id, pinned_at, locked_at
  ) VALUES (
    v_club.tenant_id, v_group.club_id, p_group_id, v_uid, v_slug,
    btrim(p_title), btrim(p_body), p_kind, v_status,
    COALESCE(p_anonymous, false),
    NULLIF(p_anchor_type, ''), NULLIF(btrim(COALESCE(p_anchor_id, '')), ''),
    v_pinned,
    CASE WHEN v_status = 'locked' THEN now() ELSE NULL END
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
  public.club_create_thread(uuid, text, text, text, boolean, text, text, text, boolean) IS
  'Zaklada temat. Ogloszenie jest przypiete z definicji rodzaju, nie recznym krokiem moderatora. p_lock_replies zaklada watek od razu zamkniety (uprawnienie moderacyjne). Klucz idempotencji jest OPCJONALNY: z nim powtorka zwraca zapamietany watek zamiast zakladac drugi (V1 par. 6.3).';

REVOKE EXECUTE ON FUNCTION
  public.club_create_thread(uuid, text, text, text, boolean, text, text, text, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.club_create_thread(uuid, text, text, text, boolean, text, text, text, boolean)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Ogloszenia zalozone PRZED ta migracja tez maja byc widoczne. Bez tego regula
-- obowiazywalaby wylacznie w przyszlosci, a klub z ogloszeniem sprzed tygodnia
-- wygladalby tak, jakby jej nie bylo.
--
-- Brak przypiecia nie jest tu odczytywany jako decyzja moderatora: dotad nie
-- istniala zadna sciezka, ktora by je zakladala, wiec kazde nieprzypiete
-- ogloszenie jest skutkiem luki, a nie wyborem. `COALESCE(pinned_at,
-- created_at)` zamiast `now()`, zeby porzadek przypietych odtwarzal kolejnosc
-- publikacji, a nie kolejnosc wykonania migracji.
-- ----------------------------------------------------------------------------
UPDATE public.club_threads
   SET pinned_at = COALESCE(pinned_at, created_at)
 WHERE kind = 'announcement'
   AND pinned_at IS NULL
   AND status IN ('open', 'resolved', 'dormant', 'locked');
