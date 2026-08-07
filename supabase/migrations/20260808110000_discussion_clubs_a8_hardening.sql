-- ============================================================================
-- DISCUSSION CLUB - ETAP A8: HARTOWANIE
--
-- Audyt adwersaryjny plus wykonanie migracji na zywym PostgreSQL-u znalazly
-- osiem bledow, ktore przeszly przez wszystkie bramki `check:sql-*`, przeglad
-- kodu i 59 testow jednostkowych. Cztery z nich sa ciezkie.
--
-- DLACZEGO BRAMKI TEGO NIE ZLAPALY - to jest wazniejsze od samych poprawek:
--   * check:sql-tenant-scope szuka MIESZANIA public_tenant_id() z has_role().
--     club_set_role() nie mieszal - on po prostu NIE SKALOWAL po tenancie
--     w ogole. Brak jest niewidoczny dla bramki szukajacej zlego wzorca.
--   * ciala plpgsql nie sa parsowane przy CREATE FUNCTION, wiec kolizja nazw
--     i zly typ w COALESCE wychodza dopiero przy wywolaniu.
--   * grant dla anon na funkcje pomocnicza wyglada niewinnie, dopoki nie
--     zauwazy sie, ze funkcja jest deterministyczna i przyjmuje dowolne id.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) [KRYTYCZNE] Deanonimizacja przez club_author_alias
--
-- Funkcja byla nadana anon i authenticated, deterministyczna i bez sekretu.
-- Atak jest jednolinijkowy: wez alias widoczny przy wypowiedzi, przeiteruj po
-- kandydatach z listy czlonkow, porownaj. Regula Chatham House - glowny
-- wyroznik tego modulu - byla zlamana w calosci.
--
-- Dwie warstwy poprawki, bo jedna nie wystarcza:
--   (a) SEKRET per tenant. Bez niego kazdy, kto ma dostep do bazy albo do
--       kodu, odtworzy odwzorowanie offline.
--   (b) ODEBRANIE GRANTU klientowi. Sam sekret nie pomoze, jesli napastnik
--       moze pytac funkcje o dowolna pare (watek, kandydat).
-- Projekcje odczytowe sa SECURITY DEFINER i wolaja alias wewnetrznie, wiec
-- dzialaja dalej bez zmian po stronie klienta.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.club_anonymity_salts (
  tenant_id  uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  salt       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.club_anonymity_salts IS
  'Sekret solacy pseudonimy Chatham House, jeden na tenanta. RPC-only i bez grantow - wyciek tej wartosci odwraca anonimowosc calego archiwum.';

ALTER TABLE public.club_anonymity_salts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_anonymity_salts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.club_anonymity_salts TO service_role;

-- Sol powstaje leniwie przy pierwszym uzyciu w tenancie.
CREATE OR REPLACE FUNCTION public.club_anonymity_salt(_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_salt text;
BEGIN
  SELECT salt INTO v_salt FROM public.club_anonymity_salts WHERE tenant_id = _tenant_id;
  IF v_salt IS NOT NULL THEN
    RETURN v_salt;
  END IF;
  INSERT INTO public.club_anonymity_salts (tenant_id, salt)
  VALUES (_tenant_id, encode(gen_random_bytes(32), 'hex'))
  ON CONFLICT (tenant_id) DO NOTHING;
  SELECT salt INTO v_salt FROM public.club_anonymity_salts WHERE tenant_id = _tenant_id;
  RETURN v_salt;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_anonymity_salt(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_anonymity_salt(uuid) TO service_role;

DROP FUNCTION IF EXISTS public.club_author_alias(uuid, uuid);

CREATE FUNCTION public.club_author_alias(_thread_id uuid, _author_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_salt   text;
  v_idx    integer;
BEGIN
  IF _author_id IS NULL OR _thread_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT t.tenant_id INTO v_tenant FROM public.club_threads t WHERE t.id = _thread_id;
  IF v_tenant IS NULL THEN
    RETURN NULL;
  END IF;

  -- STABLE nie moze pisac, wiec soli tu nie tworzymy. Brak soli oznacza, ze
  -- tenant nie mial jeszcze zadnej anonimowej wypowiedzi; wtedy odpowiadamy
  -- neutralnie zamiast degradowac do wersji bez sekretu.
  SELECT s.salt INTO v_salt FROM public.club_anonymity_salts s WHERE s.tenant_id = v_tenant;
  IF v_salt IS NULL THEN
    RETURN 'A?';
  END IF;

  v_idx := 1 + (abs(hashtextextended(_thread_id::text || ':' || _author_id::text || ':' || v_salt, 42)) % 26);
  RETURN 'A' || (('{A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R,S,T,U,V,W,X,Y,Z}'::text[])[v_idx]);
END;
$$;

COMMENT ON FUNCTION public.club_author_alias(uuid, uuid) IS
  'Pseudonim Chatham House: osolony per watek ORAZ sekretem per tenant, BEZ grantu dla klienta. Wersja bez sekretu i z grantem dla anon pozwalala odzyskac autora jednym zapytaniem.';

-- Klient NIE MOZE wolac tej funkcji. Projekcje sa SECURITY DEFINER i wolaja
-- ja wewnetrznie, wiec interfejs nie traci nic.
REVOKE EXECUTE ON FUNCTION public.club_author_alias(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_author_alias(uuid, uuid) TO service_role;

-- Sol musi powstac zanim pojawi sie pierwsza anonimowa wypowiedz - inaczej
-- alias byłby 'A?' do czasu pierwszego zapisu. Robi to trigger na watkach.
CREATE OR REPLACE FUNCTION public.club_ensure_anonymity_salt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.club_anonymity_salt(NEW.tenant_id);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS clubs_ensure_salt_tg ON public.clubs;
CREATE TRIGGER clubs_ensure_salt_tg
  AFTER INSERT ON public.clubs
  FOR EACH ROW EXECUTE FUNCTION public.club_ensure_anonymity_salt();

-- Backfill dla klubow, ktore juz istnieja.
INSERT INTO public.club_anonymity_salts (tenant_id, salt)
SELECT DISTINCT c.tenant_id, encode(gen_random_bytes(32), 'hex')
  FROM public.clubs c
ON CONFLICT (tenant_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2) [KRYTYCZNE] club_capabilities honorowal CUDZE _user_id
--
-- Funkcja jest nadana anon i authenticated, a parametr _user_id byl brany
-- doslownie. Kazdy mogl zapytac o role dowolnej osoby w dowolnym klubie,
-- a przy klubie 'secret' odroznic "istnieje, ale nie powiem" od "nie istnieje".
-- Komentarz przy admin_club_capabilities_preview mowil, ze to bylby wyciek -
-- i mial racje; brakowalo tylko egzekwowania.
--
-- Degradacja jest CICHA (bez bledu), zeby funkcja nie stala sie wyrocznia
-- "czy jestem uprawniony do pytania o te osobe".
--
-- Podglad cudzych uprawnien jest dodatkowo ZWIAZANY Z TENANTEM DOMOWYM
-- wolajacego (current_tenant_id()). is_club_admin() to rola PLATFORMOWA, nie
-- tenantowa - bez tego warunku admin tenanta B pytalby o role dowolnej osoby
-- w dowolnym klubie tenanta A. Ta sama luka co w club_set_role nizej.
--
-- UWAGA na kolejnosc: klub trzeba wczytac PRZED regula degradacji, bo regula
-- porownuje tenant klubu z tenantem domowym wolajacego.
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

  IF _user_id IS NULL THEN
    -- Anonim: wylacznie kluby 'public' o statusie 'active' i WYLACZNIE
    -- w tenancie biezacego hosta. Bez sprawdzenia tenanta anonim widzialby
    -- publiczne kluby wszystkich tenantow po samym id.
    IF v_club.visibility = 'public' AND v_club.status = 'active'
       AND v_club.tenant_id = public.public_tenant_id() THEN
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

  IF _group_id IS NOT NULL THEN
    SELECT * INTO v_group FROM public.club_groups g
     WHERE g.id = _group_id AND g.club_id = _club_id;
    IF NOT FOUND THEN
      RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                          'non_member'::text, 'not_found'::text;
      RETURN;
    END IF;
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
    IF v_group.status IN ('draft', 'archived') THEN
      v_group_open := false;
      v_reason := CASE WHEN v_group.status = 'draft' THEN 'not_open_yet' ELSE 'archived' END;
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
  'JEDYNE zrodlo prawdy o dostepie. Parametr _user_id honorowany WYLACZNIE dla samego siebie albo dla staffu - inaczej funkcja byla wyrocznia "kto nalezy do ktorego klubu". Klub secret bramkowany PRZED innymi powodami, zeby zaden kod nie zdradzil jego istnienia.';

REVOKE EXECUTE ON FUNCTION public.club_capabilities(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_capabilities(uuid, uuid, uuid)
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3) [KRYTYCZNE] club_set_role bez skalowania po tenancie
--
-- Funkcja sprawdzala role wolajacego, ale NIE sprawdzala, czy klub nalezy do
-- jego tenanta. Admin tenanta B awansowal czlonka klubu tenanta A na leada.
-- Bramka check:sql-tenant-scope tego nie zlapala, bo szuka MIESZANIA
-- public_tenant_id() z has_role(), a tu nie bylo skalowania w ogole.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_set_role(
  p_club_id uuid, p_user_id uuid, p_role text, p_expires_at timestamptz DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_caps   record;
  v_target_role text;
  v_hit    integer;
BEGIN
  IF p_role NOT IN ('lead','moderator','member','observer') THEN
    RAISE EXCEPTION 'clubs: invalid club role %', p_role USING ERRCODE = '22023';
  END IF;

  -- Klub MUSI byc w tenancie wolajacego.
  IF NOT EXISTS (
    SELECT 1 FROM public.clubs c WHERE c.id = p_club_id AND c.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_caps FROM public.club_capabilities(p_club_id, NULL, v_uid);
  IF p_role IN ('lead','moderator') AND NOT public.is_club_admin(v_uid) THEN
    RAISE EXCEPTION 'clubs: elevated role requires admin' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_club_admin(v_uid) OR v_caps.effective_role = 'lead') THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  -- Prowadzacy nie DEGRADUJE innego prowadzacego ani moderatora. Bez tego
  -- warunku spor miedzy dwoma leadami rozstrzygalby ten, kto pierwszy kliknie.
  SELECT m.role INTO v_target_role FROM public.club_members m
   WHERE m.club_id = p_club_id AND m.user_id = p_user_id;
  IF NOT public.is_club_admin(v_uid)
     AND COALESCE(v_target_role, 'member') IN ('lead','moderator') THEN
    RAISE EXCEPTION 'clubs: only an admin can change an elevated role'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.club_members
     SET role = p_role, role_expires_at = p_expires_at
   WHERE club_id = p_club_id AND user_id = p_user_id;
  GET DIAGNOSTICS v_hit = ROW_COUNT;
  IF v_hit = 0 THEN
    RETURN false;
  END IF;

  INSERT INTO public.club_moderation_log (
    tenant_id, club_id, moderator_id, action, target_type, target_id, reason
  ) VALUES (v_tenant, p_club_id, v_uid, 'role_change', 'member', p_user_id, p_role);

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.club_set_role(uuid, uuid, text, timestamptz) IS
  'Zmiana roli klubowej. Skalowana po tenancie wolajacego (brak tego byl cross-tenantowa eskalacja). Prowadzacy nie degraduje innego prowadzacego ani moderatora.';

REVOKE EXECUTE ON FUNCTION public.club_set_role(uuid, uuid, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_set_role(uuid, uuid, text, timestamptz)
  TO authenticated, service_role;

-- To samo zaniedbanie w club_ban_member.
CREATE OR REPLACE FUNCTION public.club_ban_member(
  p_club_id uuid, p_user_id uuid, p_banned boolean, p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_caps   record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.clubs c WHERE c.id = p_club_id AND c.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_caps FROM public.club_capabilities(p_club_id, NULL, v_uid);
  IF NOT COALESCE(v_caps.can_moderate, false) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_banned AND (
       public.is_club_admin(p_user_id)
       OR EXISTS (SELECT 1 FROM public.club_members m
                   WHERE m.club_id = p_club_id AND m.user_id = p_user_id
                     AND m.role = 'lead' AND m.status = 'active')
     ) AND NOT public.is_club_admin(v_uid) THEN
    RAISE EXCEPTION 'clubs: cannot ban a lead or staff member' USING ERRCODE = '42501';
  END IF;

  UPDATE public.club_members
     SET status = CASE WHEN p_banned THEN 'banned' ELSE 'active' END,
         banned_reason = CASE WHEN p_banned
                              THEN NULLIF(btrim(COALESCE(p_reason, '')), '') ELSE NULL END
   WHERE club_id = p_club_id AND user_id = p_user_id;

  INSERT INTO public.club_moderation_log (
    tenant_id, club_id, moderator_id, action, target_type, target_id, reason
  ) VALUES (v_tenant, p_club_id, v_uid,
            CASE WHEN p_banned THEN 'ban' ELSE 'unban' END,
            'member', p_user_id, NULLIF(btrim(COALESCE(p_reason, '')), ''));

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_ban_member(uuid, uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_ban_member(uuid, uuid, boolean, text)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4) [KRYTYCZNE] Trigger zaproszen wywalal sie na enumie
--
-- COALESCE(OLD.status, '') na kolumnie typu public.invitation_status probuje
-- rzutowac pusty string na enum i konczy sie 22P02. Skutek: akceptacja
-- zaproszenia e-mailowego (sciezka B) wywalala sie na OSTATNIM kroku, juz po
-- utworzeniu konta - uzytkownik zostawal poza klubem, do ktorego go zaproszono.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_user_invitations_enroll_club()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_club_id uuid;
  v_role    text;
BEGIN
  -- Porownanie enuma z enumem, bez COALESCE na pusty string.
  IF NEW.status <> 'accepted'::public.invitation_status
     OR (OLD.status IS NOT NULL AND OLD.status = 'accepted'::public.invitation_status) THEN
    RETURN NEW;
  END IF;
  IF NEW.auth_user_id IS NULL OR COALESCE(NEW.source, '') <> 'club' THEN
    RETURN NEW;
  END IF;

  v_club_id := NULLIF(NEW.metadata->>'club_id', '')::uuid;
  v_role    := COALESCE(NULLIF(NEW.metadata->>'club_role', ''), 'member');
  IF v_club_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF v_role NOT IN ('lead', 'moderator', 'member', 'observer') THEN
    v_role := 'member';
  END IF;

  INSERT INTO public.club_members (
    tenant_id, club_id, user_id, role, status, invited_by, invite_source
  )
  SELECT c.tenant_id, c.id, NEW.auth_user_id, v_role, 'active', NEW.invited_by, 'email'
    FROM public.clubs c
   WHERE c.id = v_club_id AND c.tenant_id = NEW.tenant_id
  ON CONFLICT (club_id, user_id) DO NOTHING;

  RETURN NEW;
END; $$;

-- ----------------------------------------------------------------------------
-- 5) admin_club_segment_preview byl STABLE, a tworzyl tabele tymczasowa
--
-- "CREATE TABLE is not allowed in a non-volatile function" - funkcja zwracala
-- blad ZAWSZE, przy kazdym wywolaniu. Poza zmiana volatility upraszczamy ja
-- do CTE: tabela tymczasowa nie byla do niczego potrzebna.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_club_segment_preview(uuid, jsonb);

CREATE FUNCTION public.admin_club_segment_preview(p_club_id uuid, p_rule jsonb)
RETURNS TABLE (matched integer, already_member integer, blocked integer, will_send integer)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
  WITH guard AS (
    SELECT c.id AS club_id, c.tenant_id
      FROM public.clubs c
     WHERE c.id = p_club_id
       AND public.is_club_admin(auth.uid())
       AND c.tenant_id = public.current_tenant_id()
  ),
  cand AS (
    -- profile_badges.badge (nie badge_slug) - slownik verified|expert|contributor|staff.
    SELECT DISTINCT b.user_id FROM public.profile_badges b JOIN guard g ON true
      JOIN public.profiles p ON p.id = b.user_id AND p.tenant_id = g.tenant_id
     WHERE p_rule->>'kind' = 'badge' AND b.badge = p_rule->>'badge'
    UNION
    SELECT DISTINCT f.user_id FROM public.eu_policy_follows f JOIN guard g ON true
      JOIN public.profiles p ON p.id = f.user_id AND p.tenant_id = g.tenant_id
     WHERE p_rule->>'kind' = 'policy_follow'
       AND f.item_id = NULLIF(p_rule->>'item_id','')::uuid
    UNION
    SELECT DISTINCT r.user_id FROM public.event_rsvps r JOIN guard g ON true
      JOIN public.profiles p ON p.id = r.user_id AND p.tenant_id = g.tenant_id
     WHERE p_rule->>'kind' = 'event_rsvp'
       AND r.event_id = NULLIF(p_rule->>'event_id','')::uuid
       AND r.status IN ('going','interested')
    UNION
    SELECT DISTINCT m.user_id FROM public.club_members m JOIN guard g ON true
      JOIN public.clubs oc ON oc.id = m.club_id AND oc.tenant_id = g.tenant_id
     WHERE p_rule->>'kind' = 'other_club'
       AND m.club_id = NULLIF(p_rule->>'club_id','')::uuid AND m.status = 'active'
    UNION
    SELECT p.id FROM public.profiles p JOIN guard g ON p.tenant_id = g.tenant_id
     WHERE p_rule->>'kind' = 'specialization' AND p.discoverable
       AND lower(btrim(COALESCE(p.specialization,''))) = lower(btrim(COALESCE(p_rule->>'value','')))
  ),
  agg AS (
    SELECT
      count(*)::int AS matched,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM public.club_members m
         WHERE m.club_id = p_club_id AND m.user_id = cand.user_id
           AND m.status IN ('active','pending','invited','banned')))::int AS already_member,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM public.notification_preferences np
         WHERE np.user_id = cand.user_id AND np.enabled_club IS FALSE))::int AS blocked
    FROM cand
  )
  SELECT matched, already_member, blocked,
         GREATEST(matched - already_member - blocked, 0)
    FROM agg
$$;

COMMENT ON FUNCTION public.admin_club_segment_preview(uuid, jsonb) IS
  'Podglad liczebnosci segmentu PRZED wysylka. Poprzednia wersja byla STABLE i tworzyla tabele tymczasowa, wiec zwracala blad przy KAZDYM wywolaniu.';

REVOKE EXECUTE ON FUNCTION public.admin_club_segment_preview(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_segment_preview(uuid, jsonb)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6) Kolejka moderacji ujawniala autora anonimowej wypowiedzi
--
-- Nazwisko autora wpisu anonimowego (albo dowolnego w trybie chatham) bylo
-- widoczne w kolejce BEZ przejscia przez audytowane ujawnienie. Moderator
-- ma prawo je poznac, ale przez club_moderator_reveal_author - z powodem
-- i sladem, nie mimochodem przy przegladaniu kolejki.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_club_moderation_queue(uuid);

CREATE FUNCTION public.admin_club_moderation_queue(p_club_id uuid)
RETURNS TABLE (
  target_type text, target_id uuid, thread_slug text, title text,
  body text, author_name text, is_anonymous boolean, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH club AS (
    SELECT c.* FROM public.clubs c
     WHERE c.id = p_club_id
       AND public.is_club_admin(auth.uid())
       AND c.tenant_id = public.current_tenant_id()
  )
  SELECT 'thread'::text, t.id, t.slug, t.title, t.body,
         CASE WHEN t.is_anonymous
                OR COALESCE(g.attribution_mode, cl.attribution_mode) = 'chatham'
              THEN NULL
              ELSE COALESCE(NULLIF(btrim(p.display_name), ''), 'User') END,
         (t.is_anonymous OR COALESCE(g.attribution_mode, cl.attribution_mode) = 'chatham'),
         t.created_at
    FROM public.club_threads t
    JOIN club cl ON cl.id = t.club_id
    JOIN public.club_groups g ON g.id = t.group_id
    LEFT JOIN public.profiles p ON p.id = t.author_id
   WHERE t.status = 'pending'

  UNION ALL

  SELECT 'reply'::text, r.id, t.slug, t.title, r.body,
         CASE WHEN r.is_anonymous
                OR COALESCE(g.attribution_mode, cl.attribution_mode) = 'chatham'
              THEN NULL
              ELSE COALESCE(NULLIF(btrim(p.display_name), ''), 'User') END,
         (r.is_anonymous OR COALESCE(g.attribution_mode, cl.attribution_mode) = 'chatham'),
         r.created_at
    FROM public.club_replies r
    JOIN public.club_threads t ON t.id = r.thread_id
    JOIN club cl ON cl.id = r.club_id
    JOIN public.club_groups g ON g.id = t.group_id
    LEFT JOIN public.profiles p ON p.id = r.author_id
   WHERE r.status = 'pending'

  ORDER BY created_at ASC
$$;

COMMENT ON FUNCTION public.admin_club_moderation_queue(uuid) IS
  'Kolejka premoderacji. Autor wpisu anonimowego NIE jest tu ujawniany - od tego jest club_moderator_reveal_author, z powodem i sladem w dwoch logach.';

REVOKE EXECUTE ON FUNCTION public.admin_club_moderation_queue(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_moderation_queue(uuid)
  TO authenticated, service_role;

-- To samo w liscie tematow panelu: kolumna autora zostaje (moderacja jej
-- potrzebuje), ale wpis anonimowy jest jawnie oznaczony, zeby moderator
-- wiedzial, ze patrzy na tozsamosc chroniona regula.
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
  is_anonymous boolean, attribution_mode text,
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
      t.author_id,
      COALESCE(NULLIF(btrim(p.display_name), ''), 'User') AS a_name,
      NULLIF(btrim(pa.display_name), '') AS pb_name,
      t.is_anonymous,
      COALESCE(g.attribution_mode, c.attribution_mode) AS attr,
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
      AND (p_search IS NULL OR btrim(p_search) = ''
           OR t.title ILIKE '%' || btrim(p_search) || '%')
  )
  SELECT r.*, count(*) OVER () AS total_count
  FROM rows r
  ORDER BY (r.pinned_at IS NOT NULL) DESC,
           COALESCE(r.last_reply_at, r.created_at) DESC, r.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$$;

REVOKE EXECUTE ON FUNCTION public.admin_club_threads(uuid, uuid, text, text, text, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_threads(uuid, uuid, text, text, text, integer, integer)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7) Subskrypcja watku bez bramki
--
-- club_subscribe_thread nie wolal club_capabilities, wiec dowolna osoba mogla
-- zasubskrybowac dowolny watek po id - takze z klubu secret. Powiadomienia
-- o nowych odpowiedziach wyplywaly potem poza klub.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_subscribe_thread(p_thread_id uuid, p_state text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_club  uuid;
  v_group uuid;
  v_caps  record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_state NOT IN ('subscribed', 'muted') THEN
    RAISE EXCEPTION 'clubs: invalid subscription state %', p_state USING ERRCODE = '22023';
  END IF;

  SELECT t.club_id, t.group_id INTO v_club, v_group
    FROM public.club_threads t WHERE t.id = p_thread_id;
  IF v_club IS NULL THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_caps FROM public.club_capabilities(v_club, v_group, v_uid);
  IF NOT COALESCE(v_caps.can_read, false) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.club_thread_subscriptions (thread_id, user_id, state)
  VALUES (p_thread_id, v_uid, p_state)
  ON CONFLICT (thread_id, user_id) DO UPDATE SET state = EXCLUDED.state;
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_subscribe_thread(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_subscribe_thread(uuid, text)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 8) Limit zaproszen nie obejmowal sciezki e-mailowej
--
-- club_invite_quota_ok liczyl wylacznie club_invitations, wiec lead mogl
-- wyslac nieograniczona liczbe zaproszen e-mailowych. Liczymy obie sciezki.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_invite_quota_ok(_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := CASE WHEN public.is_club_admin(_user_id) THEN 200 ELSE 20 END;
  v_used  integer;
BEGIN
  SELECT
    (SELECT count(*) FROM public.club_invitations
      WHERE inviter_id = _user_id AND created_at > now() - interval '24 hours')
  + (SELECT count(*) FROM public.user_invitations
      WHERE invited_by = _user_id AND source = 'club'
        AND created_at > now() - interval '24 hours')
  INTO v_used;
  RETURN v_used < v_limit;
END;
$$;

COMMENT ON FUNCTION public.club_invite_quota_ok(uuid) IS
  'Dzienny limit zaproszen liczony przez OBIE sciezki - bezposrednia i e-mailowa. Wersja liczaca tylko pierwsza pozwalala wysylac e-maile bez ograniczen.';

REVOKE EXECUTE ON FUNCTION public.club_invite_quota_ok(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_invite_quota_ok(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 9) IMMUTABLE na funkcjach czytajacych now()
--
-- Planer moze zwinac wywolanie funkcji IMMUTABLE do stalej. Dla kadencji roli
-- i rankingu znaczy to, ze wartosc "zamarza" w planie zapytania - kadencja
-- przestaje wygasac w obrebie dlugiego polaczenia. STABLE jest tu poprawne.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_effective_member_role(
  _role text, _role_expires_at timestamptz
)
RETURNS text
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _role IS NULL THEN NULL
    WHEN _role IN ('lead', 'moderator')
         AND _role_expires_at IS NOT NULL
         AND _role_expires_at <= now()
      THEN 'member'
    ELSE _role
  END;
$$;

COMMENT ON FUNCTION public.club_effective_member_role(text, timestamptz) IS
  'Rola po uwzglednieniu kadencji. STABLE, nie IMMUTABLE: czyta now(), a planer zwinalby IMMUTABLE do stalej i kadencja przestalaby wygasac w obrebie polaczenia.';

REVOKE EXECUTE ON FUNCTION public.club_effective_member_role(text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_effective_member_role(text, timestamptz)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_thread_hotness(
  _quality_reactions integer, _reply_count integer, _participant_count integer,
  _stance_count integer, _created_at timestamptz
)
RETURNS numeric
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT (
    COALESCE(_quality_reactions, 0) * 3 + COALESCE(_reply_count, 0) * 2
    + COALESCE(_participant_count, 0) * 2 + COALESCE(_stance_count, 0)
  )::numeric
  / power(GREATEST(EXTRACT(EPOCH FROM (now() - _created_at)) / 3600.0, 0) + 2, 1.5);
$$;

REVOKE EXECUTE ON FUNCTION public.club_thread_hotness(integer, integer, integer, integer, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_thread_hotness(integer, integer, integer, integer, timestamptz)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 10) Ranking gubil skladnik jakosciowy
--
-- Trigger odpowiedzi i job odswiezajacy przekazywaly do club_thread_hotness
-- twarde 0 jako liczbe reakcji jakosciowych. Skutek: kazda nowa odpowiedz
-- KASOWALA wklad reakcji insightful/evidence w ranking - dokladnie odwrotnie
-- do zasady "jakosc wazy wiecej niz objetosc".
--
-- Wydzielamy liczenie do jednej funkcji, zeby trzy miejsca nie mialy trzech
-- roznych wersji tej samej arytmetyki.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_thread_quality_score(_thread_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int
    FROM public.club_reactions r
   WHERE r.kind IN ('insightful', 'evidence')
     AND (
       (r.target_type = 'thread' AND r.target_id = _thread_id)
       OR (r.target_type = 'reply' AND r.target_id IN
           (SELECT id FROM public.club_replies WHERE thread_id = _thread_id))
     )
$$;

REVOKE EXECUTE ON FUNCTION public.club_thread_quality_score(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_thread_quality_score(uuid) TO authenticated, service_role;

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
           public.club_thread_quality_score(v_thread),
           sub.cnt::int, sub.participants::int,
           (SELECT count(*)::int FROM public.club_stances s WHERE s.thread_id = v_thread),
           t.created_at)
    FROM (
      SELECT count(*)::int AS cnt,
             count(DISTINCT author_id)::int AS participants,
             max(created_at) AS last_at
        FROM public.club_replies
       WHERE thread_id = v_thread AND status = 'visible'
    ) sub
   WHERE t.id = v_thread;

  UPDATE public.clubs c SET last_activity_at = now()
   WHERE c.id = (SELECT club_id FROM public.club_threads WHERE id = v_thread);
  UPDATE public.club_groups g SET last_activity_at = now()
   WHERE g.id = (SELECT group_id FROM public.club_threads WHERE id = v_thread);

  RETURN NULL;
END; $$;

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
           public.club_thread_quality_score(a.id),
           a.reply_count, a.participant_count,
           (SELECT count(*)::int FROM public.club_stances s WHERE s.thread_id = a.id),
           a.created_at)
    FROM active a WHERE t.id = a.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_threads_refresh_hotness(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_threads_refresh_hotness(integer) TO service_role;

-- ----------------------------------------------------------------------------
-- 11) Zatwierdzenie wpisu z premoderacji bylo ciche
--
-- club_replies_notify odpalal sie wylacznie AFTER INSERT, a wpis przechodzacy
-- premoderacje wchodzi jako 'pending' i dopiero UPDATE robi go widocznym.
-- Autor watku nie dowiadywal sie o zatwierdzonej odpowiedzi NIGDY.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_replies_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_t    public.club_threads%ROWTYPE;
  v_club public.clubs%ROWTYPE;
  v_href text;
  v_rec  record;
BEGIN
  IF NEW.status <> 'visible' THEN
    RETURN NULL;
  END IF;
  -- Przy UPDATE powiadamiamy tylko gdy wpis WLASNIE stal sie widoczny.
  IF TG_OP = 'UPDATE' AND OLD.status = 'visible' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_t FROM public.club_threads WHERE id = NEW.thread_id;
  SELECT * INTO v_club FROM public.clubs WHERE id = v_t.club_id;
  v_href := '/club/' || v_club.slug || '/t/' || v_t.slug;

  PERFORM public.club_notify(
    v_t.author_id, NEW.author_id,
    'Nowa odpowiedź w Twoim temacie', 'New reply in your topic',
    v_t.title, v_t.title, v_href);

  FOR v_rec IN
    SELECT s.user_id FROM public.club_thread_subscriptions s
     WHERE s.thread_id = NEW.thread_id AND s.state = 'subscribed'
       AND s.user_id IS DISTINCT FROM v_t.author_id
  LOOP
    PERFORM public.club_notify(
      v_rec.user_id, NEW.author_id,
      'Nowa odpowiedź w śledzonym temacie', 'New reply in a topic you follow',
      v_t.title, v_t.title, v_href);
  END LOOP;

  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS club_replies_notify_tg ON public.club_replies;
CREATE TRIGGER club_replies_notify_tg
  AFTER INSERT OR UPDATE OF status ON public.club_replies
  FOR EACH ROW EXECUTE FUNCTION public.club_replies_notify();

-- ----------------------------------------------------------------------------
-- 12) Zaproszenia do roznych klubow zjadala deduplikacja po href
--
-- enqueue_notification odsiewa powtorke tego samego (user, kind, href) w oknie
-- 5 minut. Wszystkie zaproszenia mialy href '/club', wiec drugie zaproszenie
-- w ciagu piecu minut przepadalo bez sladu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_invitations_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_club public.clubs%ROWTYPE;
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_club FROM public.clubs WHERE id = NEW.club_id;
  PERFORM public.club_notify(
    NEW.invitee_id, NEW.inviter_id,
    'Zaproszenie do klubu dyskusyjnego', 'Invitation to a discussion club',
    v_club.name_pl, v_club.name_en,
    -- Href per KLUB, nie wspolny '/club' - inaczej deduplikacja po href
    -- kasuje drugie zaproszenie w oknie pieciu minut.
    '/club/' || v_club.slug || '/about');
  RETURN NULL;
END; $$;

-- ----------------------------------------------------------------------------
-- 13) Paginacja odpowiedzi
--
-- club_replies_list nie mial limitu. Watek z tysiacem odpowiedzi to jedna
-- odpowiedz HTTP na kilka megabajtow - wektor DoS i zabity telefon.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.club_replies_list(uuid, text);

CREATE FUNCTION public.club_replies_list(
  p_thread_id uuid, p_sort text DEFAULT 'chronological',
  p_limit integer DEFAULT 200, p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid, parent_id uuid, depth smallint, body text, status text,
  is_anonymous boolean, author_id uuid, author_name text,
  author_avatar text, author_slug text, author_alias text,
  posted_by_admin_name text,
  reaction_count integer, created_at timestamptz, edited_at timestamptz,
  is_resolution boolean, total_count bigint
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
  ),
  rows AS (
    SELECT
      r.id, r.parent_id, r.depth, r.body, r.status, r.is_anonymous,
      CASE WHEN r.is_anonymous OR th.attribution = 'chatham' THEN NULL ELSE r.author_id END AS a_id,
      CASE WHEN r.is_anonymous OR th.attribution = 'chatham' THEN NULL
           ELSE COALESCE(NULLIF(btrim(p.display_name), ''), 'User') END AS a_name,
      CASE WHEN r.is_anonymous OR th.attribution = 'chatham' OR p.hide_avatar THEN NULL
           ELSE p.avatar_url END AS a_avatar,
      CASE WHEN r.is_anonymous OR th.attribution = 'chatham' THEN NULL ELSE p.slug END AS a_slug,
      CASE WHEN r.is_anonymous OR th.attribution = 'chatham'
           THEN public.club_author_alias(r.thread_id, r.author_id) ELSE NULL END AS a_alias,
      NULLIF(btrim(pa.display_name), '') AS pb_name,
      r.reaction_count, r.created_at, r.edited_at,
      (th.resolved_reply_id = r.id) AS is_res
    FROM public.club_replies r
    CROSS JOIN thread th
    CROSS JOIN cap
    LEFT JOIN public.profiles p ON p.id = r.author_id
    LEFT JOIN public.profiles pa ON pa.id = r.posted_by_admin_id
    WHERE r.thread_id = p_thread_id
      AND cap.can_read
      AND (r.status = 'visible' OR cap.can_moderate
           OR (r.status = 'pending' AND r.author_id = auth.uid()))
  )
  SELECT r.*, count(*) OVER () AS total_count
  FROM rows r
  ORDER BY
    r.is_res DESC NULLS LAST,
    CASE WHEN p_sort = 'best' THEN r.reaction_count ELSE 0 END DESC,
    r.created_at ASC, r.id ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$$;

COMMENT ON FUNCTION public.club_replies_list(uuid, text, integer, integer) IS
  'Odpowiedzi watku z paginacja. Wersja bez limitu byla wektorem DoS: watek z tysiacem odpowiedzi to jedna odpowiedz HTTP na kilka megabajtow.';

REVOKE EXECUTE ON FUNCTION public.club_replies_list(uuid, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_replies_list(uuid, text, integer, integer)
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 14) Lista czlonkow ujawniala zbanowanych kazdemu
--
-- club_members_list(p_status => NULL) zwracala takze 'banned' i 'left'.
-- Informacja o tym, kogo klub wyrzucil, nalezy do moderacji, nie do wszystkich.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.club_members_list(uuid, text, integer, integer);

CREATE FUNCTION public.club_members_list(
  p_club_id uuid, p_status text DEFAULT 'active',
  p_limit integer DEFAULT 50, p_offset integer DEFAULT 0
)
RETURNS TABLE (
  user_id uuid, display_name text, avatar_url text, slug text,
  job_title text, current_company text, verified boolean,
  role text, status text, joined_at timestamptz,
  role_expires_at timestamptz, invite_source text, total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH cap AS (
    SELECT * FROM public.club_capabilities(p_club_id, NULL, auth.uid())
  ),
  rows AS (
    SELECT
      m.user_id,
      COALESCE(NULLIF(btrim(p.display_name), ''),
               NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'User') AS display_name,
      CASE WHEN p.hide_avatar THEN NULL ELSE p.avatar_url END AS avatar_url,
      p.slug, p.job_title, p.current_company,
      (p.verified_at IS NOT NULL) AS verified,
      public.club_effective_member_role(m.role, m.role_expires_at) AS role,
      m.status, m.joined_at, m.role_expires_at, m.invite_source
    FROM public.club_members m
    JOIN public.profiles p ON p.id = m.user_id
    JOIN public.clubs c ON c.id = m.club_id
    CROSS JOIN cap
    WHERE m.club_id = p_club_id
      AND cap.can_see_members
      AND p.tenant_id = c.tenant_id
      AND (p_status IS NULL OR m.status = p_status)
      -- Statusy 'banned' i 'left' widzi WYLACZNIE moderacja.
      AND (m.status NOT IN ('banned', 'left') OR cap.can_moderate)
      AND (p.discoverable OR cap.can_manage OR m.user_id = auth.uid())
  )
  SELECT r.*, count(*) OVER () AS total_count
  FROM rows r
  ORDER BY CASE r.role WHEN 'lead' THEN 0 WHEN 'moderator' THEN 1
                       WHEN 'member' THEN 2 ELSE 3 END,
           lower(r.display_name) ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$$;

REVOKE EXECUTE ON FUNCTION public.club_members_list(uuid, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_members_list(uuid, text, integer, integer)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 15) club_join ignorowal widocznosc, club_redeem_invite_link ignorowal plan
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_join(p_club_id uuid)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_club   public.clubs%ROWTYPE;
  v_caps   record;
  v_status text;
  v_hit    integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_club FROM public.clubs WHERE id = p_club_id;
  IF NOT FOUND OR v_club.status <> 'active' THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_caps FROM public.club_capabilities(p_club_id, NULL, v_uid);
  -- Klub 'secret', ktorego nie widze, ma pozostac nieodrozniany od
  -- nieistniejacego takze przy probie dolaczenia.
  IF v_caps.reason = 'not_found' THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;
  IF v_caps.reason = 'tier_too_low' THEN
    RAISE EXCEPTION 'clubs: tier too low' USING ERRCODE = '42501';
  END IF;
  IF v_caps.effective_role = 'banned' THEN
    RAISE EXCEPTION 'clubs: banned' USING ERRCODE = '42501';
  END IF;
  IF v_club.join_policy = 'invite' THEN
    RAISE EXCEPTION 'clubs: invitation required' USING ERRCODE = '42501';
  END IF;

  v_status := CASE WHEN v_club.join_policy = 'open' THEN 'active' ELSE 'pending' END;

  INSERT INTO public.club_members (tenant_id, club_id, user_id, role, status, invite_source)
  SELECT v_club.tenant_id, p_club_id, v_uid, 'member', v_status, 'self'
   WHERE EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = v_uid AND p.tenant_id = v_club.tenant_id)
  ON CONFLICT (club_id, user_id) DO UPDATE
    SET status = CASE WHEN club_members.status = 'left'
                      THEN EXCLUDED.status ELSE club_members.status END;
  GET DIAGNOSTICS v_hit = ROW_COUNT;

  -- Zero wierszy znaczy, ze profil nie nalezy do tenanta klubu. Zwrocenie
  -- 'active' bylo by klamstwem - interfejs pokazalby sukces bez czlonkostwa.
  IF v_hit = 0 THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;

  RETURN v_status;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_join(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_join(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_redeem_invite_link(p_token text)
RETURNS TABLE (club_slug text, status text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_link   public.club_invite_links%ROWTYPE;
  v_tenant uuid;
  v_min    integer;
  v_slug   text;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_link FROM public.club_invite_links l
   WHERE l.token = p_token FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: invalid link' USING ERRCODE = '42501';
  END IF;
  IF v_link.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'clubs: link revoked' USING ERRCODE = '42501';
  END IF;
  IF v_link.expires_at IS NOT NULL AND v_link.expires_at <= now() THEN
    RAISE EXCEPTION 'clubs: link expired' USING ERRCODE = '42501';
  END IF;

  SELECT p.tenant_id INTO v_tenant FROM public.profiles p WHERE p.id = v_uid;
  IF v_tenant IS NULL OR v_tenant <> v_link.tenant_id THEN
    RAISE EXCEPTION 'clubs: invalid link' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM public.club_members m
              WHERE m.club_id = v_link.club_id AND m.user_id = v_uid
                AND m.status = 'banned') THEN
    RAISE EXCEPTION 'clubs: banned' USING ERRCODE = '42501';
  END IF;

  -- Prog planu obowiazuje TAKZE przy wejsciu linkiem. Bez tego link byl
  -- obejsciem bramki premium: wystarczylo go przekazac dalej.
  SELECT COALESCE(g.min_tier_rank, c.min_tier_rank) INTO v_min
    FROM public.clubs c
    LEFT JOIN public.club_groups g ON g.id = v_link.group_id
   WHERE c.id = v_link.club_id;
  IF COALESCE(v_min, 0) > 0 AND NOT public.has_tier_rank(v_min) THEN
    RAISE EXCEPTION 'clubs: tier too low' USING ERRCODE = '42501';
  END IF;

  IF v_link.max_uses IS NOT NULL
     AND v_link.used_count >= v_link.max_uses
     AND NOT EXISTS (SELECT 1 FROM public.club_invite_link_uses u
                      WHERE u.link_id = v_link.id AND u.user_id = v_uid) THEN
    RAISE EXCEPTION 'clubs: link exhausted' USING ERRCODE = '42901';
  END IF;

  v_status := CASE WHEN v_link.requires_approval THEN 'pending' ELSE 'active' END;

  INSERT INTO public.club_members (
    tenant_id, club_id, user_id, role, status, invited_by, invite_source
  ) VALUES (
    v_link.tenant_id, v_link.club_id, v_uid, v_link.club_role, v_status,
    v_link.created_by, 'link'
  )
  ON CONFLICT (club_id, user_id) DO UPDATE
    SET status = CASE WHEN club_members.status = 'left'
                      THEN EXCLUDED.status ELSE club_members.status END;

  INSERT INTO public.club_invite_link_uses (link_id, user_id)
  VALUES (v_link.id, v_uid)
  ON CONFLICT (link_id, user_id) DO NOTHING;

  IF FOUND THEN
    UPDATE public.club_invite_links SET used_count = used_count + 1 WHERE id = v_link.id;
  END IF;

  SELECT c.slug INTO v_slug FROM public.clubs c WHERE c.id = v_link.club_id;
  RETURN QUERY SELECT v_slug, v_status;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_redeem_invite_link(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_redeem_invite_link(text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 16) Limity antyspamowe bez blokady (TOCTOU)
--
-- count-then-insert bez serializacji: dwa rownolegle wywolania czytaja ten sam
-- licznik i oba przechodza. Blokada doradcza per uzytkownik i akcja serializuje
-- je bez dotykania tabel - to najtanszy sposob domkniecia tej dziury.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_reply(
  p_thread_id uuid, p_body text, p_parent_id uuid DEFAULT NULL,
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

  -- Serializacja limitow dla tego uzytkownika. Blokada zwalnia sie na koncu
  -- transakcji, wiec rownolegle wywolania ustawiaja sie w kolejce zamiast
  -- czytac ten sam licznik.
  PERFORM pg_advisory_xact_lock(hashtext('club_reply:' || v_uid::text));

  SELECT * INTO v_thread FROM public.club_threads WHERE id = p_thread_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;
  IF v_thread.locked_at IS NOT NULL OR v_thread.status IN ('locked','hidden','deleted') THEN
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
    ELSE 'visible' END;

  INSERT INTO public.club_replies (
    tenant_id, club_id, thread_id, author_id, parent_id, body, is_anonymous, status
  ) VALUES (
    v_thread.tenant_id, v_thread.club_id, p_thread_id, v_uid, p_parent_id,
    btrim(p_body), COALESCE(p_anonymous, false), v_status
  )
  RETURNING club_replies.id INTO v_id;

  IF v_thread.status = 'dormant' AND v_status = 'visible' THEN
    UPDATE public.club_threads SET status = 'open' WHERE id = p_thread_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_reply(uuid, text, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_reply(uuid, text, uuid, boolean)
  TO authenticated, service_role;

-- Ta sama blokada w tworzeniu tematu i zapraszaniu.
CREATE OR REPLACE FUNCTION public.club_invite(
  p_club_id uuid, p_user_id uuid, p_role text DEFAULT 'member',
  p_message text DEFAULT NULL, p_group_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_tenant      uuid;
  v_peer_tenant uuid;
  v_caps        record;
  v_recent      timestamptz;
  v_id          uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('lead','moderator','member','observer') THEN
    RAISE EXCEPTION 'clubs: invalid club role %', p_role USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('club_invite:' || v_uid::text));

  SELECT * INTO v_caps FROM public.club_capabilities(p_club_id, p_group_id, v_uid);
  IF NOT COALESCE(v_caps.can_invite, false) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_role IN ('lead','moderator') AND NOT public.is_club_admin(v_uid) THEN
    RAISE EXCEPTION 'clubs: elevated role requires admin' USING ERRCODE = '42501';
  END IF;

  SELECT c.tenant_id INTO v_tenant FROM public.clubs c WHERE c.id = p_club_id;
  SELECT p.tenant_id INTO v_peer_tenant FROM public.profiles p WHERE p.id = p_user_id;
  IF v_peer_tenant IS NULL OR v_peer_tenant <> v_tenant THEN
    RAISE EXCEPTION 'clubs: user not available' USING ERRCODE = '42501';
  END IF;
  IF public.is_blocked_pair(v_uid, p_user_id) THEN
    RAISE EXCEPTION 'clubs: user not available' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.club_members m
              WHERE m.club_id = p_club_id AND m.user_id = p_user_id
                AND m.status IN ('active','banned')) THEN
    RAISE EXCEPTION 'clubs: already a member' USING ERRCODE = '23505';
  END IF;

  IF NOT public.is_club_admin(v_uid) THEN
    SELECT max(responded_at) INTO v_recent FROM public.club_invitations
     WHERE club_id = p_club_id AND invitee_id = p_user_id AND status = 'declined';
    IF v_recent IS NOT NULL AND v_recent > now() - interval '90 days' THEN
      RAISE EXCEPTION 'clubs: recently declined' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NOT public.club_invite_quota_ok(v_uid) THEN
    RAISE EXCEPTION 'clubs: invite quota exceeded' USING ERRCODE = '42901';
  END IF;

  INSERT INTO public.club_invitations (
    tenant_id, club_id, group_id, inviter_id, invitee_id, club_role, message
  ) VALUES (v_tenant, p_club_id, p_group_id, v_uid, p_user_id, p_role,
            NULLIF(btrim(p_message), ''))
  ON CONFLICT (club_id, invitee_id) WHERE status = 'pending'
  DO UPDATE SET message = EXCLUDED.message, club_role = EXCLUDED.club_role
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_invite(uuid, uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_invite(uuid, uuid, text, text, uuid)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 17) Wyszukiwanie i kotwice nie filtrowaly grup draft/archived
--
-- Temat w grupie w wersji roboczej wyplywal w wynikach wyszukiwania i na
-- karcie dossier, mimo ze sama grupa byla dla czlonka niewidoczna.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.club_search(text, uuid, integer);

CREATE FUNCTION public.club_search(
  p_query text, p_club_id uuid DEFAULT NULL, p_limit integer DEFAULT 20
)
RETURNS TABLE (
  thread_id uuid, club_id uuid, club_slug text, club_name_pl text, club_name_en text,
  thread_slug text, title text, snippet text, kind text,
  reply_count integer, last_reply_at timestamptz, rank real
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH q AS (
    SELECT websearch_to_tsquery('public.nes_polish', btrim(COALESCE(p_query, ''))) AS ts
  ),
  visible AS (
    SELECT t.*, c.slug AS c_slug, c.name_pl AS c_pl, c.name_en AS c_en
      FROM public.club_threads t
      JOIN public.clubs c ON c.id = t.club_id
      JOIN public.club_groups g ON g.id = t.group_id
      CROSS JOIN LATERAL public.club_capabilities(t.club_id, t.group_id, auth.uid()) cap
     WHERE cap.can_read
       AND t.status IN ('open','resolved','dormant','locked')
       AND (g.status NOT IN ('draft','archived') OR cap.can_manage)
       AND (p_club_id IS NULL OR t.club_id = p_club_id)
  )
  SELECT
    v.id, v.club_id, v.c_slug, v.c_pl, v.c_en, v.slug, v.title,
    ts_headline('public.nes_polish', left(v.body, 2000), q.ts,
                'MaxWords=30, MinWords=15, ShortWord=3, MaxFragments=1'),
    v.kind, v.reply_count, v.last_reply_at,
    ts_rank(v.search_vector, q.ts)
  FROM visible v, q
  WHERE q.ts IS NOT NULL AND btrim(COALESCE(p_query, '')) <> ''
    AND v.search_vector @@ q.ts
  ORDER BY ts_rank(v.search_vector, q.ts) DESC, v.last_reply_at DESC NULLS LAST, v.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
$$;

REVOKE EXECUTE ON FUNCTION public.club_search(text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_search(text, uuid, integer)
  TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.club_threads_for_anchor(text, text, integer);

CREATE FUNCTION public.club_threads_for_anchor(
  p_anchor_type text, p_anchor_id text, p_limit integer DEFAULT 5
)
RETURNS TABLE (
  thread_id uuid, thread_slug text, title text, kind text,
  club_slug text, club_name_pl text, club_name_en text,
  reply_count integer, last_reply_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.slug, t.title, t.kind, c.slug, c.name_pl, c.name_en,
         t.reply_count, t.last_reply_at
  FROM public.club_threads t
  JOIN public.clubs c ON c.id = t.club_id
  JOIN public.club_groups g ON g.id = t.group_id
  CROSS JOIN LATERAL public.club_capabilities(t.club_id, t.group_id, auth.uid()) cap
  WHERE t.anchor_type = p_anchor_type
    AND t.anchor_id = p_anchor_id
    AND cap.can_read
    AND t.status IN ('open','resolved','locked')
    AND (g.status NOT IN ('draft','archived') OR cap.can_manage)
  ORDER BY t.last_reply_at DESC NULLS LAST, t.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 5), 1), 20)
$$;

REVOKE EXECUTE ON FUNCTION public.club_threads_for_anchor(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_threads_for_anchor(text, text, integer)
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 18) Przypiete watki duplikowaly sie miedzy stronami
--
-- ORDER BY stawial przypiete na gorze KAZDEJ strony, ale kursor porownywal
-- tylko hotness. Skutek: ten sam przypiety watek wracal na stronie 2, 3, 4...
-- Rozwiazanie: kursor niesie takze flage przypiecia, wiec porzadek kursora
-- pokrywa sie z porzadkiem sortowania.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.club_threads_list(uuid, uuid, text, text, text, integer);

CREATE FUNCTION public.club_threads_list(
  p_club_id uuid, p_group_id uuid DEFAULT NULL, p_sort text DEFAULT 'hot',
  p_kind text DEFAULT NULL, p_cursor text DEFAULT NULL, p_limit integer DEFAULT 20
)
RETURNS TABLE (
  id uuid, slug text, title text, kind text, status text,
  group_id uuid, group_name_pl text, group_name_en text,
  anchor_type text, anchor_id text,
  is_anonymous boolean, author_id uuid, author_name text,
  author_avatar text, author_slug text, author_alias text,
  posted_by_admin_name text,
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
  visible AS (
    SELECT t.*, g.name_pl AS g_pl, g.name_en AS g_en,
           COALESCE(g.attribution_mode, cl.attribution_mode) AS attribution,
           -- Flaga przypiecia jest CZESCIA klucza kursora, wiec porzadek
           -- kursora pokrywa sie z porzadkiem sortowania i przypiety watek
           -- nie wraca na kazdej stronie.
           (CASE WHEN t.pinned_at IS NOT NULL THEN '1' ELSE '0' END) AS pin_key
      FROM public.club_threads t
      JOIN public.club_groups g ON g.id = t.group_id
      JOIN public.clubs cl ON cl.id = t.club_id
      CROSS JOIN cap
     WHERE t.club_id = p_club_id
       AND cap.can_read
       AND (p_group_id IS NULL OR t.group_id = p_group_id)
       AND (p_kind IS NULL OR t.kind = p_kind)
       AND (t.status IN ('open','resolved','dormant','locked')
            OR cap.can_moderate
            OR (t.status = 'pending' AND t.author_id = auth.uid()))
       AND (g.status NOT IN ('draft','archived') OR cap.can_manage)
  ),
  keyed AS (
    SELECT v.*,
           v.pin_key || '|' ||
           CASE p_sort
             WHEN 'new' THEN to_char(COALESCE(v.last_reply_at, v.created_at), 'YYYYMMDDHH24MISSMS')
             ELSE to_char(v.hotness, 'FM0000000000.0000000000')
           END || '|' || v.id::text AS ckey
      FROM visible v
  )
  SELECT
    k.id, k.slug, k.title, k.kind, k.status,
    k.group_id, k.g_pl, k.g_en, k.anchor_type, k.anchor_id, k.is_anonymous,
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
    k.pinned_at, k.last_reply_at, k.created_at, k.hotness, k.ckey
  FROM keyed k
  LEFT JOIN public.profiles p ON p.id = k.author_id
  LEFT JOIN public.profiles pa ON pa.id = k.posted_by_admin_id
  WHERE p_cursor IS NULL OR k.ckey < p_cursor
  ORDER BY k.ckey DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
$$;

COMMENT ON FUNCTION public.club_threads_list(uuid, uuid, text, text, text, integer) IS
  'Lista tematow z kursorem. Flaga przypiecia jest CZESCIA klucza kursora - bez tego przypiety watek wracal na kazdej kolejnej stronie.';

REVOKE EXECUTE ON FUNCTION public.club_threads_list(uuid, uuid, text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_threads_list(uuid, uuid, text, text, text, integer)
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 19) admin_club_invitations rzutowal metadata->>'club_id' poza filtrem
--
-- Planer moze wykonac rzutowanie na uuid PRZED filtrem source='club', a wtedy
-- dowolne zaproszenie z innym ksztaltem metadata wywala cale zapytanie
-- bledem 22P02. Filtrujemy operatorem @>, ktory nie rzutuje.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_club_invitations(uuid);

CREATE FUNCTION public.admin_club_invitations(p_club_id uuid)
RETURNS TABLE (
  id uuid, channel text, recipient text, club_role text, status text,
  inviter_name text, created_at timestamptz, expires_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.id, 'direct'::text,
         COALESCE(NULLIF(btrim(p.display_name), ''), 'User'),
         i.club_role, i.status,
         COALESCE(NULLIF(btrim(inv.display_name), ''), '-'),
         i.created_at, i.expires_at
    FROM public.club_invitations i
    JOIN public.clubs c ON c.id = i.club_id
    LEFT JOIN public.profiles p ON p.id = i.invitee_id
    LEFT JOIN public.profiles inv ON inv.id = i.inviter_id
   WHERE i.club_id = p_club_id
     AND public.is_club_admin(auth.uid())
     AND c.tenant_id = public.current_tenant_id()

  UNION ALL

  SELECT u.id, 'email'::text, u.email,
         COALESCE(u.metadata->>'club_role', 'member'), u.status::text,
         COALESCE(u.metadata->>'invited_by_name', '-'),
         u.created_at, u.expires_at
    FROM public.user_invitations u
   WHERE u.source = 'club'
     -- Operator @> nie rzutuje na uuid, wiec zaproszenie o innym ksztalcie
     -- metadata nie wywala calego zapytania bledem 22P02.
     AND u.metadata @> jsonb_build_object('club_id', p_club_id::text)
     AND public.is_club_admin(auth.uid())
     AND u.tenant_id = public.current_tenant_id()

  ORDER BY created_at DESC
$$;

REVOKE EXECUTE ON FUNCTION public.admin_club_invitations(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_invitations(uuid)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 20) club_view nie filtrowal klubow draft/archived
--
-- Karta nieopublikowanego klubu byla widoczna po zgadnieciu sluga. Filtr jest
-- teraz w club_capabilities (punkt 2), ale club_view musi go uszanowac takze
-- dla galezi "karta widoczna bez tresci".
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
  policy_area text, status text,
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
  target AS (
    SELECT c.* FROM public.clubs c CROSS JOIN scope s
     WHERE c.tenant_id = s.tenant_id AND c.slug = p_slug
  )
  SELECT
    t.id, t.slug, t.name_pl, t.name_en,
    t.tagline_pl, t.tagline_en, t.description_pl, t.description_en,
    t.rules_pl, t.rules_en,
    t.icon, t.accent_color, t.cover_image_url,
    t.visibility, t.join_policy, t.min_tier_rank,
    t.attribution_mode, t.who_can_post, t.moderation_mode,
    t.policy_area, t.status,
    t.member_count, t.group_count, t.thread_count,
    t.last_activity_at, t.created_at,
    public.club_effective_member_role(m.role, m.role_expires_at),
    m.status, m.rules_accepted_at,
    cap.can_read, cap.can_post_thread, cap.can_reply,
    cap.can_moderate, cap.can_manage, cap.can_invite,
    cap.can_see_members, cap.reason
  FROM target t
  LEFT JOIN public.club_members m ON m.club_id = t.id AND m.user_id = auth.uid()
  CROSS JOIN LATERAL public.club_capabilities(t.id, NULL, auth.uid()) cap
  WHERE cap.can_read
     OR (t.status = 'active' AND t.visibility IN ('public','members','private'))
$$;

REVOKE EXECUTE ON FUNCTION public.club_view(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_view(text) TO anon, authenticated, service_role;

-- club_list: ta sama poprawka dla listy.
DROP FUNCTION IF EXISTS public.club_list();

CREATE FUNCTION public.club_list()
RETURNS TABLE (
  id uuid, slug text, name_pl text, name_en text,
  tagline_pl text, tagline_en text, icon text, accent_color text,
  cover_image_url text, visibility text, join_policy text,
  min_tier_rank integer, policy_area text, status text,
  member_count integer, group_count integer, thread_count integer,
  last_activity_at timestamptz,
  my_role text, my_status text, can_read boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (SELECT p.id AS uid, p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()),
  scope AS (
    SELECT COALESCE((SELECT tenant_id FROM me), public.public_tenant_id()) AS tenant_id
  )
  SELECT
    c.id, c.slug, c.name_pl, c.name_en, c.tagline_pl, c.tagline_en,
    c.icon, c.accent_color, c.cover_image_url, c.visibility, c.join_policy,
    c.min_tier_rank, c.policy_area, c.status,
    c.member_count, c.group_count, c.thread_count, c.last_activity_at,
    public.club_effective_member_role(m.role, m.role_expires_at),
    m.status,
    cap.can_read
  FROM public.clubs c
  CROSS JOIN scope s
  LEFT JOIN public.club_members m
    ON m.club_id = c.id AND m.user_id = auth.uid() AND m.status = 'active'
  CROSS JOIN LATERAL public.club_capabilities(c.id, NULL, auth.uid()) cap
  WHERE c.tenant_id = s.tenant_id
    AND c.status = 'active'
    AND (c.visibility IN ('public','members','private') OR cap.can_read)
    AND (auth.uid() IS NOT NULL OR c.visibility = 'public')
  ORDER BY (m.user_id IS NOT NULL) DESC, c.last_activity_at DESC NULLS LAST, lower(c.name_pl) ASC
$$;

REVOKE EXECUTE ON FUNCTION public.club_list() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_list() TO anon, authenticated, service_role;
