-- ============================================================================
-- Dziennik moderacji klubów: słowniki CHECK obejmują wszystkich zapisujących.
-- Zapis ustawień klubu przez prowadzącego, propozycja klubu i kampania
-- segmentowa przestają padać na naruszeniu CHECK.
--
-- MECHANIZM DEFEKTU.
--   `club_moderation_log` ma dwie białe listy: `action` i `target_type`.
--   Pierwszą przepisywano w całości (DROP + ADD) siedem razy, zawsze z kopii
--   poprzedniej listy - 20260808100000 (a7) cofnęła nawet cztery wartości
--   dodane godzinę wcześniej. Drugą od 20260808130000 (a10) zna tylko
--   `thread`, `reply`, `member`, `group`. Trzy funkcje piszą wartości, których
--   ŻADNA wersja list nie dopuszczała:
--     * `club_update_settings` - ('club_updated', 'club') od 20260905193621,
--       odtworzona z tym samym literałem w 20260919220300 i 20261003170000.
--       Każdy zapis - prowadzącego i administratora - kończył się 23514 na
--       `club_moderation_log_action_check`, a po jego poszerzeniu na
--       `club_moderation_log_target_type_check`; cała transakcja wracała.
--     * `club_propose` (20260905193621) - najpierw
--       `club_members.invite_source = 'proposal'` (lista `direct`, `email`,
--       `link`, `segment`, `auto`, `self` nie zmieniła się od utworzenia
--       tabeli), potem ('club_proposed', 'club'). Żadna propozycja klubu nie
--       powstała.
--     * `admin_club_invite_segment` (20260808061350, a27) - `target_type =
--       'club'`. Wpis powstaje tylko przy `invited > 0`, a przycisk wysyłki
--       jest aktywny tylko przy `will_send > 0`, więc kampania padała
--       dokładnie wtedy, gdy miała skutek. a27 poszerzyła `action` z
--       komentarzem „inaczej wpis odbija się o CHECK", ale pominęła
--       `target_type`.
--   Ciała PL/pgSQL nie są sprawdzane względem CHECK przy CREATE FUNCTION,
--   a żaden test nie wołał tych funkcji ścieżką, która dochodzi do INSERT-u
--   (testy okładki kończą się na wcześniejszym 22023). 20261003170000
--   świadomie zostawiła CHECK zepsuty: jego naprawa otworzyłaby zapis okładki
--   z dowolnego hosta przez ustawienia. Ta sama migracja zamknęła to wejście
--   (klucze okładki → 22023), więc przeszkoda zniknęła.
--
-- CO ROBI TA MIGRACJA.
--   1. Słowniki - wyłącznie POSZERZENIE, więc żaden istniejący wiersz nie
--      narusza nowych list: `action` + `club_updated`, `club_proposed`;
--      `target_type` + `club`; `invite_source` + `proposal` (nie `self`:
--      `club_members_notify_status` czyta `self` jako prośbę o przyjęcie).
--   2. `club_update_settings`, bo poszerzenie CHECK odsłania jej bramkę:
--      `is_club_admin OR effective_role = 'lead'` wpuszczała prowadzącego
--      klubu zarchiwizowanego i szkicu. Teraz jak okładka (20261003170000):
--      administracja albo prowadzący z `can_moderate` (aktywny klub, aktywne
--      członkostwo, ważna kadencja). Przy okazji:
--        * jeden odczyt wiersza `FOR UPDATE` zamiast EXISTS + UPDATE,
--          `club_capabilities` tylko dla nie-administratora,
--        * nieznane klucze i wartości inne niż tekst/null → 22023 (dawniej
--          ignorowane, ale wpisywane do dziennika jako „zmienione"),
--        * brak różnicy → `false` bez UPDATE i bez wpisu (klient od początku
--          czyta `false` jako „nie było czego zapisać", ale ta gałąź była
--          nieosiągalna); dziennik wymienia tylko kolumny, które się zmieniły,
--        * `updated_at` ustawia `clubs_set_updated_tg`, nie ciało funkcji,
--        * ACL: DROP FUNCTION w 20260919220300 zgubił REVOKE z 20260905193621
--          (`proacl` NULL = EXECUTE dla PUBLIC, w tym `anon`).
--   3. `admin_club_invite_segment` i `admin_club_segment_preview`, bo
--      poszerzenie `target_type` odsłania zapis MIĘDZYNAJEMCOWY: klub był
--      szukany bez filtra najemcy, `is_club_admin` pyta o rolę w najemcy
--      WOŁAJĄCEGO, a kandydaci pochodzą z najemcy wołającego - administrator
--      najemcy B tworzył zaproszenia, regułę i wpis dziennika w klubie
--      najemcy A (sprawdzone). Podgląd ujawniał liczności cudzego klubu już
--      dziś. Do tego: `p_role` bez `lead` (komentarz funkcji: „kampania
--      masowa nie mianuje prowadzących", a zaproszenie z `lead` po przyjęciu
--      dawało rolę prowadzącego) i `p_group_id` z tego samego klubu.
--   4. `_club_unique_slug`: `left(…, 80)` i `left(…, 74) || '-'` mogły
--      kończyć się myślnikiem, co łamie `clubs_slug_format` (23514) - ścieżka
--      odblokowana przez punkt 1 (nazwa do 120 znaków).
--   5. ACL `club_set_cover_position` - ten sam DROP bez REVOKE.
--
-- Strażnik klasy (literał zapisywany przez funkcję vs. biała lista CHECK,
-- dowolna tabela): supabase/tests/check_whitelist_writers_test.sql.
-- ============================================================================

-- 1. Słowniki ------------------------------------------------------------------
ALTER TABLE public.club_moderation_log
  DROP CONSTRAINT IF EXISTS club_moderation_log_action_check;
ALTER TABLE public.club_moderation_log
  ADD CONSTRAINT club_moderation_log_action_check
  CHECK (action IN ('approve', 'hide', 'delete', 'restore', 'lock', 'unlock',
                    'pin', 'unpin', 'ban', 'unban', 'reveal_author',
                    'role_change', 'post_on_behalf', 'move', 'edit',
                    'member_add', 'group_delete', 'report', 'invite_segment',
                    'club_updated', 'club_proposed'));

ALTER TABLE public.club_moderation_log
  DROP CONSTRAINT IF EXISTS club_moderation_log_target_type_check;
ALTER TABLE public.club_moderation_log
  ADD CONSTRAINT club_moderation_log_target_type_check
  CHECK (target_type IN ('thread', 'reply', 'member', 'group', 'club'));

ALTER TABLE public.club_members
  DROP CONSTRAINT IF EXISTS club_members_invite_source_check;
ALTER TABLE public.club_members
  ADD CONSTRAINT club_members_invite_source_check
  CHECK (invite_source IN ('direct', 'email', 'link', 'segment', 'auto', 'self', 'proposal'));

-- 2. Ustawienia klubu ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_update_settings(p_club_id uuid, p jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_tenant  uuid := public.current_tenant_id();
  v_caps    record;
  v_old     public.clubs%ROWTYPE;
  v_new     public.clubs%ROWTYPE;
  v_changed text;
  c_keys    CONSTANT text[] := ARRAY[
    'name_pl', 'name_en', 'tagline_pl', 'tagline_en', 'description_pl', 'description_en',
    'rules_pl', 'rules_en', 'icon', 'accent_color', 'policy_area', 'layout', 'who_can_post',
    'join_policy'];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: sign in required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_old FROM public.clubs c
   WHERE c.id = p_club_id AND c.tenant_id = v_tenant
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;
  -- Ten sam predykat co zapis okładki: rola efektywna (kadencja), aktywne
  -- członkostwo, aktywny klub. Administracja nie liczy capabilities wcale.
  IF NOT public.is_club_admin(v_uid) THEN
    SELECT * INTO v_caps FROM public.club_capabilities(p_club_id, NULL, v_uid);
    IF NOT (v_caps.effective_role = 'lead' AND v_caps.can_moderate) THEN
      RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'clubs: invalid settings' USING ERRCODE = '22023';
  END IF;
  IF (p ? 'cover_image_url') OR (p ? 'cover_position_y') THEN
    RAISE EXCEPTION 'clubs: cover is written by club_set_cover' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each(p) e
              WHERE e.key <> ALL (c_keys) OR jsonb_typeof(e.value) NOT IN ('string', 'null')) THEN
    RAISE EXCEPTION 'clubs: invalid settings' USING ERRCODE = '22023';
  END IF;
  IF (p ? 'join_policy') AND COALESCE(p->>'join_policy', '') NOT IN ('open', 'request', 'invite') THEN
    RAISE EXCEPTION 'clubs: invalid join policy' USING ERRCODE = '22023';
  END IF;
  IF (p ? 'who_can_post') AND COALESCE(p->>'who_can_post', '') NOT IN ('members', 'moderators', 'staff_only') THEN
    RAISE EXCEPTION 'clubs: invalid who_can_post' USING ERRCODE = '22023';
  END IF;
  IF (p ? 'layout') AND COALESCE(p->>'layout', '') NOT IN ('list', 'cards', 'magazine') THEN
    RAISE EXCEPTION 'clubs: invalid layout' USING ERRCODE = '22023';
  END IF;

  v_new := v_old;
  v_new.name_pl        := COALESCE(NULLIF(btrim(p->>'name_pl'), ''), v_old.name_pl);
  v_new.name_en        := COALESCE(NULLIF(btrim(p->>'name_en'), ''), v_old.name_en);
  v_new.tagline_pl     := CASE WHEN p ? 'tagline_pl' THEN NULLIF(btrim(p->>'tagline_pl'), '') ELSE v_old.tagline_pl END;
  v_new.tagline_en     := CASE WHEN p ? 'tagline_en' THEN NULLIF(btrim(p->>'tagline_en'), '') ELSE v_old.tagline_en END;
  v_new.description_pl := CASE WHEN p ? 'description_pl' THEN NULLIF(btrim(p->>'description_pl'), '') ELSE v_old.description_pl END;
  v_new.description_en := CASE WHEN p ? 'description_en' THEN NULLIF(btrim(p->>'description_en'), '') ELSE v_old.description_en END;
  v_new.rules_pl       := CASE WHEN p ? 'rules_pl' THEN NULLIF(btrim(p->>'rules_pl'), '') ELSE v_old.rules_pl END;
  v_new.rules_en       := CASE WHEN p ? 'rules_en' THEN NULLIF(btrim(p->>'rules_en'), '') ELSE v_old.rules_en END;
  v_new.icon           := COALESCE(NULLIF(btrim(p->>'icon'), ''), v_old.icon);
  v_new.accent_color   := CASE WHEN p ? 'accent_color' THEN NULLIF(btrim(p->>'accent_color'), '') ELSE v_old.accent_color END;
  v_new.policy_area    := CASE WHEN p ? 'policy_area' THEN NULLIF(btrim(p->>'policy_area'), '') ELSE v_old.policy_area END;
  v_new.layout         := COALESCE(NULLIF(p->>'layout', ''), v_old.layout);
  v_new.who_can_post   := COALESCE(NULLIF(p->>'who_can_post', ''), v_old.who_can_post);
  v_new.join_policy    := COALESCE(NULLIF(p->>'join_policy', ''), v_old.join_policy);

  -- Dziennik nazywa kolumny, które się ZMIENIŁY - nie klucze ładunku.
  SELECT string_agg(n.key, ',' ORDER BY n.key) INTO v_changed
    FROM jsonb_each(to_jsonb(v_new)) n
    JOIN jsonb_each(to_jsonb(v_old)) o USING (key)
   WHERE n.value IS DISTINCT FROM o.value;
  IF v_changed IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.clubs c SET
    name_pl = v_new.name_pl,
    name_en = v_new.name_en,
    tagline_pl = v_new.tagline_pl,
    tagline_en = v_new.tagline_en,
    description_pl = v_new.description_pl,
    description_en = v_new.description_en,
    rules_pl = v_new.rules_pl,
    rules_en = v_new.rules_en,
    icon = v_new.icon,
    accent_color = v_new.accent_color,
    policy_area = v_new.policy_area,
    layout = v_new.layout,
    who_can_post = v_new.who_can_post,
    join_policy = v_new.join_policy
  WHERE c.id = p_club_id;

  INSERT INTO public.club_moderation_log (
    tenant_id, club_id, moderator_id, action, target_type, target_id, reason
  ) VALUES (
    v_tenant, p_club_id, v_uid, 'club_updated', 'club', p_club_id, left(v_changed, 500)
  );
  RETURN true;
END;
$function$;

COMMENT ON FUNCTION public.club_update_settings(uuid, jsonb) IS
  'Dane klubu (nazwy, opisy, zasady, ikona, kolor, polityka publikacji i dolaczania) - administracja albo prowadzacy z can_moderate. false = brak zmian (bez UPDATE i wpisu); dziennik: club_updated/club z lista zmienionych kolumn. Okladka: club_set_cover.';

REVOKE ALL ON FUNCTION public.club_update_settings(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_update_settings(uuid, jsonb) TO authenticated, service_role;

-- 3. Kampania segmentowa w granicy najemcy ------------------------------------
CREATE OR REPLACE FUNCTION public.admin_club_segment_preview(p_club_id uuid, p_rule jsonb)
RETURNS TABLE(matched integer, already_member integer, blocked integer, will_send integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_matched integer := 0;
  v_member  integer := 0;
  v_send    integer := 0;
BEGIN
  IF NOT public.is_club_admin(auth.uid()) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  -- Kandydaci pochodzą z najemcy WOŁAJĄCEGO (`club_segment_candidate_ids`),
  -- więc klub też musi być jego - inaczej podgląd liczy cudzy klub.
  IF NOT EXISTS (SELECT 1 FROM public.clubs c
                  WHERE c.id = p_club_id AND c.tenant_id = public.current_tenant_id()) THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::int INTO v_matched FROM public.club_segment_candidate_ids(p_rule);

  SELECT count(*)::int INTO v_member
    FROM public.club_segment_candidate_ids(p_rule) c
    JOIN public.club_members m ON m.user_id = c.user_id AND m.club_id = p_club_id
   WHERE m.status IN ('active', 'pending', 'invited', 'banned');

  SELECT count(*)::int INTO v_send
    FROM public.club_segment_recipients(p_club_id, p_rule);

  -- `blocked` jest RESZTA, a nie osobnym zapytaniem: dzieki temu trzy liczby
  -- zawsze sie sumuja do `matched`, cokolwiek dojdzie do odsiewu w przyszlosci.
  RETURN QUERY SELECT v_matched, v_member, GREATEST(v_matched - v_member - v_send, 0), v_send;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_club_invite_segment(
  p_club_id uuid, p_rule jsonb, p_role text DEFAULT 'member', p_message text DEFAULT NULL,
  p_group_id uuid DEFAULT NULL, p_save_rule boolean DEFAULT true, p_max integer DEFAULT 500)
RETURNS TABLE(invited integer, rule_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_tenant  uuid;
  v_count   integer := 0;
  v_rule    uuid;
  v_cap     integer := LEAST(GREATEST(COALESCE(p_max, 500), 1), 2000);
BEGIN
  IF NOT public.is_club_admin(v_uid) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  -- Słownik `club_segment_rules_club_role_check` i CLUB_SEGMENT_CAMPAIGN_ROLES:
  -- kampania masowa nie mianuje prowadzących (zaproszenie z `lead` dawało
  -- po przyjęciu rolę prowadzącego).
  IF p_role IS NULL OR p_role NOT IN ('moderator', 'member', 'observer') THEN
    RAISE EXCEPTION 'clubs: invalid club role %', p_role USING ERRCODE = '22023';
  END IF;

  -- Granica najemcy jak w `admin_club_member_upsert`: kandydaci są z najemcy
  -- wołającego, więc klub też.
  SELECT c.tenant_id INTO v_tenant FROM public.clubs c
   WHERE c.id = p_club_id AND c.tenant_id = public.current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;
  IF p_group_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.club_groups g WHERE g.id = p_group_id AND g.club_id = p_club_id) THEN
    RAISE EXCEPTION 'clubs: group not in club' USING ERRCODE = '22023';
  END IF;

  -- Serializacja per KLUB. Dwie kampanie puszczone rownolegle na ten sam klub
  -- czytalyby ten sam odsiew i obie policzylyby te same osoby jako "do
  -- wyslania" - `ON CONFLICT` uratowalby baze, ale licznik zwrocony
  -- administratorowi klamalby o dwukrotnosci.
  PERFORM pg_advisory_xact_lock(hashtext('club_invite_segment:' || p_club_id::text));

  WITH picked AS (
    SELECT r.user_id
      FROM public.club_segment_recipients(p_club_id, p_rule) r
     LIMIT v_cap
  ),
  ins AS (
    INSERT INTO public.club_invitations (
      tenant_id, club_id, group_id, inviter_id, invitee_id, club_role, message
    )
    SELECT v_tenant, p_club_id, p_group_id, v_uid, p.user_id, p_role,
           NULLIF(btrim(COALESCE(p_message, '')), '')
      FROM picked p
    ON CONFLICT (club_id, invitee_id) WHERE status = 'pending' DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int INTO v_count FROM ins;

  -- Regula zapisuje sie PO wysylce i tylko wtedy, gdy cokolwiek poszlo: wpis
  -- w `club_segment_rules` ma znaczyc "ta kampania sie odbyla", a nie "ktos
  -- kliknal podglad".
  IF COALESCE(p_save_rule, true) AND v_count > 0 THEN
    INSERT INTO public.club_segment_rules (
      tenant_id, club_id, name, rule, club_role, last_run_at, last_sent, created_by
    ) VALUES (
      v_tenant, p_club_id,
      COALESCE(NULLIF(btrim(p_rule->>'name'), ''),
               'segment: ' || COALESCE(p_rule->>'kind', '?')),
      p_rule, p_role, now(), v_count, v_uid
    )
    RETURNING id INTO v_rule;
  END IF;

  IF v_count > 0 THEN
    INSERT INTO public.club_moderation_log (
      tenant_id, club_id, moderator_id, action, target_type, target_id, reason
    ) VALUES (
      v_tenant, p_club_id, v_uid, 'invite_segment', 'club', p_club_id,
      'segment: ' || COALESCE(p_rule->>'kind', '?') || ', invited: ' || v_count::text
    );
  END IF;

  invited := v_count;
  rule_id := v_rule;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_club_segment_preview(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_segment_preview(uuid, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_club_invite_segment(uuid, jsonb, text, text, uuid, boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_invite_segment(uuid, jsonb, text, text, uuid, boolean, integer) TO authenticated, service_role;

-- 4. Slug bez myślnika na końcu -----------------------------------------------
CREATE OR REPLACE FUNCTION public._club_unique_slug(_tenant_id uuid, p_base text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_base text := rtrim(left(public._club_slugify(p_base), 80), '-');
  v_slug text := v_base;
  v_n    integer := 1;
BEGIN
  WHILE EXISTS (
    SELECT 1 FROM public.clubs c WHERE c.tenant_id = _tenant_id AND c.slug = v_slug
  ) LOOP
    v_n := v_n + 1;
    v_slug := rtrim(left(v_base, 74), '-') || '-' || v_n::text;
  END LOOP;
  RETURN v_slug;
END;
$$;

-- 5. ACL zgubiony przez DROP FUNCTION w 20260919220300 ------------------------
REVOKE ALL ON FUNCTION public.club_set_cover_position(uuid, smallint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_set_cover_position(uuid, smallint) TO authenticated, service_role;
