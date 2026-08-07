-- ============================================================================
-- Discussion Club A10 - luki panelu: kadencja, dziennik, kasowanie grup,
--                       redakcja moderatorska
--
-- Cztery znaleziska z audytu. Trzy pierwsze to rzeczy, ktore panel OBIECUJE,
-- a baza ich nie dowozi - a to gorszy rodzaj braku niz brak wprost, bo
-- administrator widzi kontrolke i wierzy, ze zadzialala.
-- ----------------------------------------------------------------------------
-- 1) [CICHA UTRATA DANYCH] admin_club_member_upsert zerowal kadencje
--
--    Droplista roli w panelu nie zna pola role_expires_at, wiec klient wysyla
--    parametr jako undefined - klucz wypada z JSON-a, dziala DEFAULT NULL,
--    a `ON CONFLICT DO UPDATE SET role_expires_at = EXCLUDED.role_expires_at`
--    KASUJE ustawiona wczesniej kadencje. Zmiana roli z panelu cicho zdejmowala
--    wiec termin waznosci tej roli, przez co krok 3 club_scheduler_tick
--    (wygaszanie kadencji) nie mial na czym pracowac.
--
--    Poprawka: pusty parametr znaczy "nie ruszaj", a nie "wyczysc". Do jawnego
--    czyszczenia jest osobny parametr - bo "brak wartosci" i "wartosc pusta"
--    to dwie rozne intencje i nie wolno ich sklejac w jeden NULL.
--
-- 2) [MARTWY INTERFEJS] Zmiana roli z panelu nie zostawiala sladu
--
--    club_set_role loguje 'role_change', ale nie ma ANI JEDNEGO wywolania
--    z warstwy TS - panel wola admin_club_member_upsert, ktore nie logowalo
--    nic. Skutkiem filtr "Zmiana roli" w dzienniku moderacji byl trwale pusty:
--    nie brakowalo tam wpisow z przyszlosci, tylko wpisow, ktore juz powinny
--    byc.
--
-- 3) [BRAK OPERACJI] Grupy nie dalo sie usunac
--
--    admin_club_group_upsert tworzy i edytuje, reorder przestawia - kasowania
--    nie bylo w ogole. Grupa zalozona przez pomylke zostawala na zawsze.
--    Kasowanie jest TWARDE (grupa to pojemnik, nie tresc), ale odmawia pracy,
--    gdy w srodku sa watki: wtedy trzeba wskazac grupe docelowa i tresc
--    jedzie razem z nia. Kasowanie ostatniej grupy klubu jest zabronione -
--    klub bez grupy nie ma gdzie przyjac watku.
--
-- 4) [LUKA MODERACYJNA] Redakcja nie mogla poprawic cudzego wpisu
--
--    club_edit_thread i club_edit_reply mialy bramke author-only i okno
--    15 minut, bez zadnej sciezki dla moderacji. Nie dalo sie zaczernic
--    danych osobowych ani poprawic literowki w ogloszeniu - jedyna dostepna
--    reakcja bylo ukrycie calego wpisu. Moderator dostaje wiec obejscie okna,
--    ale KAZDA taka edycja idzie do dziennika: to jest ingerencja w cudza
--    wypowiedz i ma zostawiac slad.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Slownik dziennika: dwie nowe akcje i nowy typ celu
--
-- Kasowanie grupy nie dotyczy watku ani czlonka, wiec target_type musi umiec
-- powiedziec 'group'. Bez tego INSERT z sekcji 3 wywalilby sie na CHECK-u
-- dopiero w runtime - czyli dokladnie tam, gdzie administrator klika.
-- ----------------------------------------------------------------------------
ALTER TABLE public.club_moderation_log DROP CONSTRAINT IF EXISTS club_moderation_log_action_check;
ALTER TABLE public.club_moderation_log
  ADD CONSTRAINT club_moderation_log_action_check
  CHECK (action IN ('approve', 'hide', 'delete', 'restore', 'lock', 'unlock',
                    'pin', 'unpin', 'ban', 'unban', 'reveal_author',
                    'role_change', 'post_on_behalf', 'move', 'edit',
                    'member_add', 'group_delete'));

ALTER TABLE public.club_moderation_log DROP CONSTRAINT IF EXISTS club_moderation_log_target_type_check;
ALTER TABLE public.club_moderation_log
  ADD CONSTRAINT club_moderation_log_target_type_check
  CHECK (target_type IN ('thread', 'reply', 'member', 'group'));

-- ----------------------------------------------------------------------------
-- 1 + 2) Kadencja przezywa zmiane roli, a zmiana roli trafia do dziennika
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_club_member_upsert(
  p_club_id uuid,
  p_user_id uuid,
  p_role    text DEFAULT 'member',
  p_status  text DEFAULT 'active',
  p_role_expires_at timestamptz DEFAULT NULL,
  -- Jawne czyszczenie kadencji. Bez tego parametru nie da sie odroznic
  -- "nie przyslalem terminu" od "zdejmij termin", a to sa dwie rozne rzeczy.
  p_clear_role_expiry boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant      uuid := public.current_tenant_id();
  v_club_tenant uuid;
  v_peer_tenant uuid;
  v_prev        public.club_members%ROWTYPE;
  v_id          uuid;
BEGIN
  IF NOT public.is_club_admin(auth.uid()) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('lead', 'moderator', 'member', 'observer') THEN
    RAISE EXCEPTION 'clubs: invalid club role %', p_role USING ERRCODE = '22023';
  END IF;
  IF p_status NOT IN ('active', 'pending', 'invited', 'banned', 'left') THEN
    RAISE EXCEPTION 'clubs: invalid member status %', p_status USING ERRCODE = '22023';
  END IF;

  SELECT c.tenant_id INTO v_club_tenant FROM public.clubs c WHERE c.id = p_club_id;
  SELECT p.tenant_id INTO v_peer_tenant FROM public.profiles p WHERE p.id = p_user_id;

  -- Trzy tenanty musza byc tym samym tenantem: admina, klubu i dodawanej osoby.
  IF v_club_tenant IS NULL OR v_club_tenant <> v_tenant THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;
  IF v_peer_tenant IS NULL OR v_peer_tenant <> v_tenant THEN
    RAISE EXCEPTION 'clubs: user not available' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_prev FROM public.club_members m
   WHERE m.club_id = p_club_id AND m.user_id = p_user_id;

  INSERT INTO public.club_members (
    tenant_id, club_id, user_id, role, status, role_expires_at,
    invited_by, invite_source
  ) VALUES (
    v_tenant, p_club_id, p_user_id, p_role, p_status,
    CASE WHEN p_clear_role_expiry THEN NULL ELSE p_role_expires_at END,
    auth.uid(), 'direct'
  )
  ON CONFLICT (club_id, user_id) DO UPDATE SET
    role   = EXCLUDED.role,
    status = EXCLUDED.status,
    -- Trojpodzial zamiast nadpisania: wyczysc / ustaw / zostaw jak bylo.
    role_expires_at = CASE
      WHEN p_clear_role_expiry           THEN NULL
      WHEN p_role_expires_at IS NOT NULL THEN p_role_expires_at
      ELSE club_members.role_expires_at
    END
  RETURNING id INTO v_id;

  -- Do dziennika idzie tylko REALNA zmiana. Zapis "ustawiono member na member"
  -- zasmieca historie i uczy jej nie czytac.
  IF v_prev.id IS NULL THEN
    INSERT INTO public.club_moderation_log (
      tenant_id, club_id, moderator_id, action, target_type, target_id, reason
    ) VALUES (v_tenant, p_club_id, auth.uid(), 'member_add', 'member', p_user_id,
              format('rola: %s, status: %s', p_role, p_status));
  ELSIF v_prev.role IS DISTINCT FROM p_role OR v_prev.status IS DISTINCT FROM p_status THEN
    INSERT INTO public.club_moderation_log (
      tenant_id, club_id, moderator_id, action, target_type, target_id, reason
    ) VALUES (v_tenant, p_club_id, auth.uid(), 'role_change', 'member', p_user_id,
              format('%s/%s -> %s/%s', v_prev.role, v_prev.status, p_role, p_status));
  END IF;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.admin_club_member_upsert(uuid, uuid, text, text, timestamptz, boolean) IS
  'Dodaje albo aktualizuje czlonkostwo. Pusty p_role_expires_at znaczy "nie ruszaj kadencji" - do jej zdjecia sluzy p_clear_role_expiry. Kazda realna zmiana roli lub statusu idzie do club_moderation_log.';

REVOKE EXECUTE ON FUNCTION
  public.admin_club_member_upsert(uuid, uuid, text, text, timestamptz, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.admin_club_member_upsert(uuid, uuid, text, text, timestamptz, boolean)
  TO authenticated, service_role;

-- Stara sygnatura piecioargumentowa znika: zostawiona obok nowej dawalaby
-- przeciazenie, ktore PostgREST rozstrzyga po nazwach parametrow - a wtedy
-- wywolanie bez p_clear_role_expiry trafialoby w WERSJE Z BLEDEM.
DROP FUNCTION IF EXISTS public.admin_club_member_upsert(uuid, uuid, text, text, timestamptz);

-- ----------------------------------------------------------------------------
-- 3) Kasowanie grupy
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_club_group_delete(
  p_group_id uuid,
  -- Grupa docelowa dla watkow. NULL = kasuj tylko grupe pusta.
  p_move_to_group_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant  uuid := public.current_tenant_id();
  v_group   public.club_groups%ROWTYPE;
  v_target  public.club_groups%ROWTYPE;
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

  -- Klub bez grupy nie ma gdzie przyjac watku, wiec ostatnia grupa zostaje.
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
    -- Grupa docelowa MUSI byc w tym samym klubie: inny klub ma inne
    -- czlonkostwo, wiec przeniesienie odslonilo by tresc obcym.
    SELECT g.* INTO v_target FROM public.club_groups g
     WHERE g.id = p_move_to_group_id AND g.club_id = v_group.club_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'clubs: target group not in this club' USING ERRCODE = '42501';
    END IF;

    UPDATE public.club_threads t SET group_id = p_move_to_group_id
     WHERE t.group_id = p_group_id;
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

COMMENT ON FUNCTION public.admin_club_group_delete(uuid, uuid) IS
  'Kasuje grupe. Grupa z watkami wymaga wskazania grupy docelowej w TYM SAMYM klubie - inaczej tresc trafilaby do innego zbioru czlonkow. Ostatniej grupy klubu nie da sie skasowac.';

REVOKE EXECUTE ON FUNCTION public.admin_club_group_delete(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_group_delete(uuid, uuid)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4) Redakcja moderatorska z obowiazkowym sladem
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_edit_thread(
  p_thread_id uuid, p_title text, p_body text, p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_t      public.club_threads%ROWTYPE;
  v_caps   record;
  v_author boolean;
BEGIN
  SELECT * INTO v_t FROM public.club_threads WHERE id = p_thread_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  v_author := v_t.author_id IS NOT DISTINCT FROM v_uid AND v_uid IS NOT NULL;
  SELECT * INTO v_caps FROM public.club_capabilities(v_t.club_id, v_t.group_id, v_uid);

  IF NOT v_author AND NOT COALESCE(v_caps.can_moderate, false) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  -- Okno 15 minut obowiazuje AUTORA. Moderacja poprawia takze pozniej -
  -- zaczernienie danych osobowych nie moze zalezec od tego, kiedy ktos
  -- zdazyl je zglosic.
  IF v_author AND NOT COALESCE(v_caps.can_moderate, false)
     AND v_t.created_at < now() - interval '15 minutes' THEN
    RAISE EXCEPTION 'clubs: edit window closed' USING ERRCODE = '42501';
  END IF;

  UPDATE public.club_threads
     SET title = COALESCE(NULLIF(btrim(p_title), ''), title),
         body  = COALESCE(NULLIF(btrim(p_body), ''), body),
         edited_at = now(),
         edit_count = edit_count + 1
   WHERE id = p_thread_id;

  -- Ingerencja w CUDZA wypowiedz zawsze zostawia slad. Wlasna poprawka
  -- literowki nie zasmieca dziennika.
  IF NOT v_author THEN
    INSERT INTO public.club_moderation_log (
      tenant_id, club_id, moderator_id, action, target_type, target_id, reason
    ) VALUES (v_t.tenant_id, v_t.club_id, v_uid, 'edit', 'thread', p_thread_id,
              NULLIF(btrim(COALESCE(p_reason, '')), ''));
  END IF;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_edit_thread(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_edit_thread(uuid, text, text, text)
  TO authenticated, service_role;
DROP FUNCTION IF EXISTS public.club_edit_thread(uuid, text, text);

CREATE OR REPLACE FUNCTION public.club_edit_reply(
  p_reply_id uuid, p_body text, p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_r      public.club_replies%ROWTYPE;
  v_group  uuid;
  v_caps   record;
  v_author boolean;
BEGIN
  SELECT * INTO v_r FROM public.club_replies WHERE id = p_reply_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT t.group_id INTO v_group FROM public.club_threads t WHERE t.id = v_r.thread_id;

  v_author := v_r.author_id IS NOT DISTINCT FROM v_uid AND v_uid IS NOT NULL;
  SELECT * INTO v_caps FROM public.club_capabilities(v_r.club_id, v_group, v_uid);

  IF NOT v_author AND NOT COALESCE(v_caps.can_moderate, false) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_author AND NOT COALESCE(v_caps.can_moderate, false)
     AND v_r.created_at < now() - interval '15 minutes' THEN
    RAISE EXCEPTION 'clubs: edit window closed' USING ERRCODE = '42501';
  END IF;

  UPDATE public.club_replies
     SET body = btrim(p_body), edited_at = now(), edit_count = edit_count + 1
   WHERE id = p_reply_id;

  IF NOT v_author THEN
    INSERT INTO public.club_moderation_log (
      tenant_id, club_id, moderator_id, action, target_type, target_id, reason
    ) VALUES (v_r.tenant_id, v_r.club_id, v_uid, 'edit', 'reply', p_reply_id,
              NULLIF(btrim(COALESCE(p_reason, '')), ''));
  END IF;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_edit_reply(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_edit_reply(uuid, text, text)
  TO authenticated, service_role;
DROP FUNCTION IF EXISTS public.club_edit_reply(uuid, text);
