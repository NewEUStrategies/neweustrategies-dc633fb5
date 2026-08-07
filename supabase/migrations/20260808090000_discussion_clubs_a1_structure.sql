-- ============================================================================
-- DISCUSSION CLUB - ETAP A1: STRUKTURA I AUTORYZACJA
--
-- Domyka luke #8 z audytu 2026-08-07 ("brak trwalych kregow tematycznych":
-- grupy czatu sa ad hoc, wydarzenie potrafi je zrodzic, ale nie ma trwalej
-- przestrzeni z wlasna tozsamoscia, moderacja i archiwum).
--
-- Hierarchia trzypoziomowa (V2 §1):
--   KLUB   - przestrzen z czlonkostwem, zasadami i progiem wejscia
--    +- GRUPA - dzial tematyczny wewnatrz klubu (dziedziczy albo nadpisuje)
--        +- TEMAT - konkretna dyskusja (etap A3, nie ten plik)
--
-- TRZY DECYZJE, KTORE TRZEBA ZROZUMIEC PRZED CZYTANIEM RESZTY:
--
-- 1) JEDNO ZRODLO PRAWDY O DOSTEPIE. Najwieksze ryzyko tego modulu to rozjazd
--    kopii reguly widocznosci rozsypanej po ~32 RPC. Dlatego zdolnosci wylicza
--    WYLACZNIE public.club_capabilities(), a kazdy inny RPC ja wola. Zadna
--    bramka nie jest pisana inline.
--
-- 2) INWARIANT super_admin >= admin. Audyt z 06.08 zlapal dokladnie ten rozjazd
--    w profiles_guard_verification: bramke zawezono do samego 'admin', przez co
--    super_admin bez osobnej roli 'admin' stracil uprawnienie sterujace odznaka
--    eksperta (a ta pociaga dozywotni VIP). Tutaj bramka administracyjna ma
--    jedna nazwe - public.is_club_admin() - i nigdy nie jest rozwijana inline.
--    Uwaga: istniejacy is_staff() to admin|editor|author BEZ super_admin, wiec
--    NIE nadaje sie na te bramke.
--
-- 3) IZOLACJA TENANTA PO current_tenant_id(). Nie po public_tenant_id(), bo ten
--    czyta naglowek x-tenant-host ustawiany przez klienta (do podrobienia przez
--    curl). Funkcje SECURITY DEFINER, ktore autoryzuja po roli, MUSZA skalowac
--    dane po tenancie DOMOWYM wolajacego - inaczej admin tenanta A czyta dane
--    tenanta B. To jest inwariant pilnowany przez check:sql-tenant-scope.
--
-- Wszystko idempotentne. Tabele sa RPC-only: klient nie ma zadnych grantow DML,
-- cala powierzchnia mutacji idzie przez SECURITY DEFINER (wzorzec przeniesiony
-- z user_connections, ocenionego w audycie na 9/10).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Bramka administracyjna modulu - JEDNA nazwa, zero rozwiniec inline
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_club_admin(_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL
     AND (public.has_role(_user_id, 'admin')
          OR public.has_role(_user_id, 'super_admin'));
$$;

COMMENT ON FUNCTION public.is_club_admin(uuid) IS
  'Bramka struktury Discussion Club: admin LUB super_admin. Inwariant super_admin >= admin - nigdy nie rozwijac inline (lekcja profiles_guard_verification, audyt 2026-08-06).';

REVOKE EXECUTE ON FUNCTION public.is_club_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_club_admin(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 1) KLUB
--
-- Widocznosc i polityka wstepu to DWIE OSOBNE OSIE (V1 §1.1). Klub
-- public + invite to publiczna wizytowka zamknietego grona - poprawna i czesta
-- kombinacja, ktorej model jednoosiowy by nie wyrazil.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clubs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug              text NOT NULL,
  name_pl           text NOT NULL,
  name_en           text NOT NULL,
  tagline_pl        text,
  tagline_en        text,
  description_pl    text,
  description_en    text,
  icon              text NOT NULL DEFAULT 'MessagesSquare',
  accent_color      text,
  cover_image_url   text,

  visibility        text NOT NULL DEFAULT 'members'
                    CHECK (visibility IN ('public', 'members', 'private', 'secret')),
  join_policy       text NOT NULL DEFAULT 'request'
                    CHECK (join_policy IN ('open', 'request', 'invite')),
  min_tier_rank     integer NOT NULL DEFAULT 0 CHECK (min_tier_rank >= 0),
  attribution_mode  text NOT NULL DEFAULT 'attributed'
                    CHECK (attribution_mode IN ('attributed', 'chatham', 'anonymous_allowed')),
  who_can_post      text NOT NULL DEFAULT 'moderators'
                    CHECK (who_can_post IN ('members', 'moderators', 'staff_only')),
  moderation_mode   text NOT NULL DEFAULT 'trusted'
                    CHECK (moderation_mode IN ('post', 'pre', 'trusted')),

  policy_area       text,
  rules_pl          text,
  rules_en          text,

  status            text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'active', 'archived')),

  -- Denormalizacja swiadoma: lista klubow i lista tematow to ekrany otwierane
  -- najczesciej w calym module i nie moga liczyc COUNT(*) per wiersz.
  member_count      integer NOT NULL DEFAULT 0,
  group_count       integer NOT NULL DEFAULT 0,
  thread_count      integer NOT NULL DEFAULT 0,
  last_activity_at  timestamptz,

  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT clubs_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT clubs_name_pl_len CHECK (char_length(btrim(name_pl)) BETWEEN 2 AND 120),
  CONSTRAINT clubs_name_en_len CHECK (char_length(btrim(name_en)) BETWEEN 2 AND 120)
);

CREATE UNIQUE INDEX IF NOT EXISTS clubs_tenant_slug_key
  ON public.clubs (tenant_id, slug);
CREATE INDEX IF NOT EXISTS clubs_tenant_status_idx
  ON public.clubs (tenant_id, status, visibility);
CREATE INDEX IF NOT EXISTS clubs_tenant_activity_idx
  ON public.clubs (tenant_id, last_activity_at DESC NULLS LAST);

COMMENT ON TABLE public.clubs IS
  'Discussion Club: przestrzen z czlonkostwem. RPC-only (brak grantow klienta). Widocznosc i polityka wstepu to osobne osie.';
COMMENT ON COLUMN public.clubs.who_can_post IS
  'Kto zaklada temat. Domyslnie moderators - przejscie na members jest decyzja produktowa, nie zmiana architektury (V2 §0).';
COMMENT ON COLUMN public.clubs.attribution_mode IS
  'attributed | chatham (regula Chatham House) | anonymous_allowed. Egzekwowane w warstwie projekcji, nie w interfejsie (etap A3+).';

-- ----------------------------------------------------------------------------
-- 2) GRUPA - dziedzicz albo nadpisz
--
-- NULL w kolumnie ustawienia znaczy "wez z klubu". To nie jest brak wartosci,
-- tylko jawna deklaracja dziedziczenia - panel pokazuje ja jako etykiete
-- "dziedziczone z klubu" z przelacznikiem "nadpisz".
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.club_groups (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  club_id           uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  slug              text NOT NULL,
  name_pl           text NOT NULL,
  name_en           text NOT NULL,
  description_pl    text,
  description_en    text,
  icon              text,
  accent_color      text,
  sort_order        integer NOT NULL DEFAULT 0,

  -- Dziedziczenie: NULL = wez z klubu, wartosc = nadpisz.
  visibility        text CHECK (visibility IN ('members', 'private', 'secret')),
  who_can_post      text CHECK (who_can_post IN ('members', 'moderators', 'staff_only')),
  moderation_mode   text CHECK (moderation_mode IN ('post', 'pre', 'trusted')),
  min_tier_rank     integer CHECK (min_tier_rank IS NULL OR min_tier_rank >= 0),
  attribution_mode  text CHECK (attribution_mode IN ('attributed', 'chatham', 'anonymous_allowed')),

  -- Harmonogram (V2 §5). Egzekwowany przez club_capabilities, nie przez UI.
  opens_at          timestamptz,
  closes_at         timestamptz,
  status            text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'scheduled', 'active', 'frozen', 'archived')),

  anchor_type       text CHECK (anchor_type IN ('eu_policy_item', 'post', 'event', 'research_program')),
  anchor_id         text,

  thread_count      integer NOT NULL DEFAULT 0,
  last_activity_at  timestamptz,

  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT club_groups_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT club_groups_name_pl_len CHECK (char_length(btrim(name_pl)) BETWEEN 2 AND 120),
  CONSTRAINT club_groups_name_en_len CHECK (char_length(btrim(name_en)) BETWEEN 2 AND 120),
  -- Okno dyskusji musi byc oknem, nie punktem w odwrotnej kolejnosci.
  CONSTRAINT club_groups_window_sane CHECK (opens_at IS NULL OR closes_at IS NULL OR closes_at > opens_at),
  CONSTRAINT club_groups_anchor_pair CHECK ((anchor_type IS NULL) = (anchor_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS club_groups_club_slug_key
  ON public.club_groups (club_id, slug);
CREATE INDEX IF NOT EXISTS club_groups_club_order_idx
  ON public.club_groups (club_id, sort_order, created_at);
CREATE INDEX IF NOT EXISTS club_groups_tenant_idx
  ON public.club_groups (tenant_id, club_id);
CREATE INDEX IF NOT EXISTS club_groups_anchor_idx
  ON public.club_groups (anchor_type, anchor_id) WHERE anchor_id IS NOT NULL;

COMMENT ON TABLE public.club_groups IS
  'Dzial tematyczny wewnatrz klubu. NULL w kolumnie ustawienia = dziedzicz z klubu (jawna deklaracja, nie brak danych).';

-- ----------------------------------------------------------------------------
-- 3) CZLONKOSTWO
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.club_members (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  club_id           uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  role              text NOT NULL DEFAULT 'member'
                    CHECK (role IN ('lead', 'moderator', 'member', 'observer')),
  status            text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'pending', 'invited', 'banned', 'left')),
  notify_level      text NOT NULL DEFAULT 'digest'
                    CHECK (notify_level IN ('all', 'mentions', 'digest', 'none')),

  -- Kadencja roli (V2 §5.4): moderator na kwartal wraca do 'member' bez recznej
  -- pracy admina. Wygasniecie realnie odbiera uprawnienia - patrz
  -- club_effective_member_role() ponizej, gdzie data jest czytana przy KAZDYM
  -- wyliczeniu zdolnosci, a nie dopiero przez nocny job.
  role_expires_at   timestamptz,

  rules_accepted_at timestamptz,
  invited_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invite_source     text NOT NULL DEFAULT 'direct'
                    CHECK (invite_source IN ('direct', 'email', 'link', 'segment', 'auto', 'self')),
  banned_reason     text,
  joined_at         timestamptz NOT NULL DEFAULT now(),
  last_read_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT club_members_club_user_key UNIQUE (club_id, user_id)
);

CREATE INDEX IF NOT EXISTS club_members_user_active_idx
  ON public.club_members (user_id, status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS club_members_club_role_idx
  ON public.club_members (club_id, status, role);
CREATE INDEX IF NOT EXISTS club_members_tenant_idx
  ON public.club_members (tenant_id, club_id);
CREATE INDEX IF NOT EXISTS club_members_role_expiry_idx
  ON public.club_members (role_expires_at) WHERE role_expires_at IS NOT NULL;

COMMENT ON TABLE public.club_members IS
  'Czlonkostwo w klubie. Rola klubowa to OSOBNA os od public.app_role - nigdy ich nie mieszac (V2 §3.2).';
COMMENT ON COLUMN public.club_members.role_expires_at IS
  'Kadencja roli. Czytana przy kazdym wyliczeniu zdolnosci, nie tylko przez job - wygasla rola nie daje uprawnien nawet zanim job ja sprzatnie.';

-- ----------------------------------------------------------------------------
-- 4) RLS: deny-all. Tabele sa RPC-only.
-- ----------------------------------------------------------------------------
ALTER TABLE public.clubs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_groups  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_members ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.clubs        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.club_groups  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.club_members FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.clubs        TO service_role;
GRANT ALL ON public.club_groups  TO service_role;
GRANT ALL ON public.club_members TO service_role;

-- ----------------------------------------------------------------------------
-- 5) Triggery: pinowanie tenanta, updated_at, liczniki
--
-- tenant_id jest pinowany, a nie tylko domyslny: przy INSERT wyprowadzamy go
-- z rodzica (klub -> grupa/czlonkostwo), przy UPDATE nie pozwalamy go zmienic.
-- Bez tego przeniesienie wiersza miedzy tenantami bylo by jednym UPDATE.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clubs_pin_tenant()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.tenant_id := OLD.tenant_id;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS clubs_pin_tenant_tg ON public.clubs;
CREATE TRIGGER clubs_pin_tenant_tg
  BEFORE UPDATE ON public.clubs
  FOR EACH ROW EXECUTE FUNCTION public.clubs_pin_tenant();

-- Grupa i czlonkostwo dziedzicza tenanta z klubu ZAWSZE - takze przy INSERT.
-- Wartosc podana przez wolajacego jest ignorowana, wiec nie da sie wstawic
-- grupy tenanta A pod klub tenanta B.
CREATE OR REPLACE FUNCTION public.club_child_pin_tenant()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT c.tenant_id INTO v_tenant FROM public.clubs c WHERE c.id = NEW.club_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'clubs: unknown club %', NEW.club_id USING ERRCODE = '23503';
  END IF;
  NEW.tenant_id := v_tenant;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS club_groups_pin_tenant_tg ON public.club_groups;
CREATE TRIGGER club_groups_pin_tenant_tg
  BEFORE INSERT OR UPDATE ON public.club_groups
  FOR EACH ROW EXECUTE FUNCTION public.club_child_pin_tenant();

DROP TRIGGER IF EXISTS club_members_pin_tenant_tg ON public.club_members;
CREATE TRIGGER club_members_pin_tenant_tg
  BEFORE INSERT OR UPDATE ON public.club_members
  FOR EACH ROW EXECUTE FUNCTION public.club_child_pin_tenant();

DROP TRIGGER IF EXISTS clubs_set_updated_tg ON public.clubs;
CREATE TRIGGER clubs_set_updated_tg BEFORE UPDATE ON public.clubs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS club_groups_set_updated_tg ON public.club_groups;
CREATE TRIGGER club_groups_set_updated_tg BEFORE UPDATE ON public.club_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS club_members_set_updated_tg ON public.club_members;
CREATE TRIGGER club_members_set_updated_tg BEFORE UPDATE ON public.club_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Licznik czlonkow: tylko status 'active'. Zliczamy w triggerze, bo lista
-- klubow w panelu i w produkcie renderuje ten licznik w kazdym wierszu.
CREATE OR REPLACE FUNCTION public.club_members_sync_count()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_club uuid := COALESCE(NEW.club_id, OLD.club_id);
BEGIN
  UPDATE public.clubs c
     SET member_count = (
           SELECT count(*)::int FROM public.club_members m
            WHERE m.club_id = v_club AND m.status = 'active'
         )
   WHERE c.id = v_club;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS club_members_sync_count_tg ON public.club_members;
CREATE TRIGGER club_members_sync_count_tg
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.club_members
  FOR EACH ROW EXECUTE FUNCTION public.club_members_sync_count();

CREATE OR REPLACE FUNCTION public.club_groups_sync_count()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_club uuid := COALESCE(NEW.club_id, OLD.club_id);
BEGIN
  UPDATE public.clubs c
     SET group_count = (
           SELECT count(*)::int FROM public.club_groups g
            WHERE g.club_id = v_club AND g.status <> 'archived'
         )
   WHERE c.id = v_club;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS club_groups_sync_count_tg ON public.club_groups;
CREATE TRIGGER club_groups_sync_count_tg
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.club_groups
  FOR EACH ROW EXECUTE FUNCTION public.club_groups_sync_count();

-- ----------------------------------------------------------------------------
-- 6) Rola efektywna czlonka - kadencja liczona w locie
--
-- Wydzielona, bo wolaja ja i club_capabilities, i projekcje list czlonkow.
-- Gdyby kadencje sprzatal wylacznie nocny job, moderator z wygasla kadencja
-- moderowalby az do najblizszego przebiegu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_effective_member_role(
  _role text, _role_expires_at timestamptz
)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _role IS NULL THEN NULL
    -- Kadencja dotyczy WYLACZNIE rol podniesionych. Wygasniecie sprowadza do
    -- 'member', nigdy nie wyrzuca z klubu.
    WHEN _role IN ('lead', 'moderator')
         AND _role_expires_at IS NOT NULL
         AND _role_expires_at <= now()
      THEN 'member'
    ELSE _role
  END;
$$;

COMMENT ON FUNCTION public.club_effective_member_role(text, timestamptz) IS
  'Rola po uwzglednieniu kadencji. Wygasla rola podniesiona spada do member natychmiast, nie po przebiegu joba.';

REVOKE EXECUTE ON FUNCTION public.club_effective_member_role(text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_effective_member_role(text, timestamptz)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7) club_capabilities() - JEDYNE zrodlo prawdy o dostepie
--
-- Pole `reason` jest celowe (V2 §2.2). Bez niego interfejs mowi "nie mozesz",
-- a uzytkownik nie wie, czy ma poprosic o dostep, wykupic plan, czy poczekac
-- na otwarcie grupy. Zwracamy KOD, a UI mapuje go na zdanie i wlasciwa akcje.
--
-- Kolejnosc bramek jest znaczaca: ban bije wszystko, potem tenant, potem
-- harmonogram, potem plan, na koncu widocznosc. Pierwszy powod, ktory realnie
-- blokuje, jest tym, ktory pokazujemy - bo to on opisuje nastepny krok.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.club_capabilities(uuid, uuid, uuid);

CREATE FUNCTION public.club_capabilities(
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
  v_is_admin    boolean := public.is_club_admin(_user_id);
  v_is_editor   boolean := _user_id IS NOT NULL AND public.has_role(_user_id, 'editor');
  v_home_tenant uuid;
  v_role        text;            -- rola klubowa po kadencji, albo 'non_member'
  v_visibility  text;
  v_who_can_post text;
  v_min_tier    integer;
  v_reason      text := NULL;
  v_read        boolean := false;
  v_group_open  boolean := true;
BEGIN
  SELECT * INTO v_club FROM public.clubs WHERE id = _club_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                        'non_member'::text, 'not_found'::text;
    RETURN;
  END IF;

  -- Izolacja tenanta: rola wolajacego zyje w jego tenancie DOMOWYM, wiec dane
  -- skalujemy tym samym tenantem. Naglowek x-tenant-host nie ma tu wplywu.
  SELECT p.tenant_id INTO v_home_tenant FROM public.profiles p WHERE p.id = _user_id;
  IF _user_id IS NULL THEN
    -- Anonim: wylacznie kluby 'public' o statusie 'active'.
    IF v_club.visibility = 'public' AND v_club.status = 'active' THEN
      RETURN QUERY SELECT true, false, false, false, false, false, false, false, false,
                          'non_member'::text, NULL::text;
    ELSE
      RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                          'non_member'::text, 'auth_required'::text;
    END IF;
    RETURN;
  END IF;

  IF v_home_tenant IS NULL OR v_home_tenant <> v_club.tenant_id THEN
    -- Nie zdradzamy istnienia klubu z obcego tenanta.
    RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                        'non_member'::text, 'not_found'::text;
    RETURN;
  END IF;

  IF _group_id IS NOT NULL THEN
    SELECT * INTO v_group FROM public.club_groups
     WHERE id = _group_id AND club_id = _club_id;
    IF NOT FOUND THEN
      RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                          'non_member'::text, 'not_found'::text;
      RETURN;
    END IF;
  END IF;

  SELECT * INTO v_member FROM public.club_members
   WHERE club_id = _club_id AND user_id = _user_id;

  -- 1. BAN bije wszystko, takze staff-owe obejscie roli klubowej.
  IF FOUND AND v_member.status = 'banned' THEN
    RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                        'banned'::text, 'banned'::text;
    RETURN;
  END IF;

  v_role := CASE
    WHEN v_member.id IS NULL OR v_member.status <> 'active' THEN 'non_member'
    ELSE public.club_effective_member_role(v_member.role, v_member.role_expires_at)
  END;

  -- Dziedziczenie ustawien: NULL na grupie = wartosc klubu.
  v_visibility   := COALESCE(v_group.visibility, v_club.visibility);
  v_who_can_post := COALESCE(v_group.who_can_post, v_club.who_can_post);
  v_min_tier     := COALESCE(v_group.min_tier_rank, v_club.min_tier_rank);

  -- 2. HARMONOGRAM grupy (V2 §5). Staff widzi zawsze - inaczej nie moglby
  --    przygotowac grupy przed otwarciem.
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
      -- Okno zamkniete: dyskusja zostaje jako dokument, czyli do ODCZYTU.
      v_group_open := false;
      v_reason := 'window_closed';
    END IF;
  END IF;

  -- 3. PROG PLANU przez kanoniczny helper has_tier_rank() - ten sam, ktorym
  --    bramkowane sa wydarzenia. Wlasny join po membership_tiers bylby druga
  --    definicja tej samej reguly (uprawnienia plyna z trzech zrodel:
  --    subskrypcji, grantow i seatow organizacji).
  --    Staff i istniejacy czlonek nie przechodza progu ponownie - obnizenie
  --    planu nie moze wyrzucic kogos ze srodka dyskusji.
  IF v_min_tier > 0 AND NOT v_is_admin AND v_role = 'non_member' THEN
    IF NOT public.has_tier_rank(v_min_tier) THEN
      RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                          v_role, 'tier_too_low'::text;
      RETURN;
    END IF;
  END IF;

  -- 4. WIDOCZNOSC.
  v_read := CASE
    WHEN v_is_admin THEN true
    WHEN v_role <> 'non_member' THEN true
    WHEN v_visibility = 'public'  THEN v_club.status = 'active'
    WHEN v_visibility = 'members' THEN v_club.status = 'active'
    WHEN v_visibility = 'private' THEN false  -- karta widoczna, tresc nie
    ELSE false                                 -- 'secret': nie istnieje dla obcych
  END;

  IF NOT v_read AND v_reason IS NULL THEN
    v_reason := CASE
      WHEN v_visibility = 'secret' THEN 'not_found'
      WHEN v_club.status = 'draft' THEN 'not_open_yet'
      WHEN v_club.status = 'archived' THEN 'archived'
      ELSE 'not_member'
    END;
  END IF;

  -- 5. PREMODERACJA jako powod informacyjny (nie odbiera prawa pisania -
  --    wpis trafia do kolejki). UI ma powiedziec o tym PRZED napisaniem.
  IF v_reason IS NULL
     AND v_role IN ('member', 'observer')
     AND COALESCE(v_group.moderation_mode, v_club.moderation_mode) = 'pre' THEN
    v_reason := 'pre_moderation';
  END IF;

  RETURN QUERY SELECT
    v_read,
    -- Zaklada temat: staff zawsze; lead/moderator w otwartej grupie; editor
    -- i member tylko gdy ustawienie klubu/grupy na to pozwala (V2 §2.4).
    CASE
      WHEN v_is_admin THEN true
      WHEN NOT v_read OR NOT v_group_open THEN false
      WHEN v_role IN ('lead', 'moderator') THEN true
      WHEN v_who_can_post = 'staff_only' THEN v_is_editor
      WHEN v_who_can_post = 'moderators' THEN false
      WHEN v_who_can_post = 'members' THEN v_role = 'member' OR v_is_editor
      ELSE false
    END,
    -- Odpowiada: kazdy czlonek poza observerem; observer jest z definicji cichy.
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
    -- Moderuje: staff, lead, moderator. Editor NIE - to praca redakcyjna,
    -- nie moderatorska.
    (v_is_admin OR (v_read AND v_role IN ('lead', 'moderator'))),
    -- Zarzadza struktura: WYLACZNIE staff (V2 §0 - struktura nalezy do admina).
    v_is_admin,
    -- Zaprasza: staff zawsze, lead w aktywnym klubie.
    (v_is_admin OR (v_read AND v_role = 'lead')),
    -- Widzi liste czlonkow: kazdy, kto czyta klub.
    v_read,
    -- Ujawnia autora anonimowej wypowiedzi: staff. NIE lead - prowadzacy jest
    -- strona dyskusji, wiec dostep do tozsamosci bylby konfliktem interesu
    -- (V2 §2.4).
    v_is_admin,
    v_role,
    v_reason;
END;
$$;

COMMENT ON FUNCTION public.club_capabilities(uuid, uuid, uuid) IS
  'JEDYNE zrodlo prawdy o dostepie do klubu/grupy. Kazdy RPC modulu wola ta funkcje - zadnej bramki nie pisze sie inline. Pole reason zasila UI kodem powodu (not_member, tier_too_low, group_frozen, banned, pre_moderation, not_open_yet, window_closed, archived, auth_required, not_found).';

REVOKE EXECUTE ON FUNCTION public.club_capabilities(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_capabilities(uuid, uuid, uuid)
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 8) Odczyt produktowy
-- ----------------------------------------------------------------------------

-- Lista klubow widocznych dla wolajacego. Klub 'private' pokazuje sie jako
-- KARTA (nazwa, opis, liczba czlonkow), ale bez tresci - to jest jego sens.
-- Klub 'secret' nie pojawia sie w ogole.
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
  WITH me AS (
    SELECT p.id AS uid, p.tenant_id
      FROM public.profiles p WHERE p.id = auth.uid()
  ),
  scope AS (
    -- Anonim widzi wylacznie plaszczyzne publiczna biezacego hosta; zalogowany
    -- widzi swoj tenant domowy. Rozdzielenie jest celowe: dla anonima nie ma
    -- roli do podniesienia, wiec public_tenant_id() jest tu bezpieczny.
    SELECT COALESCE((SELECT tenant_id FROM me), public.public_tenant_id()) AS tenant_id
  )
  SELECT
    c.id, c.slug, c.name_pl, c.name_en,
    c.tagline_pl, c.tagline_en, c.icon, c.accent_color,
    c.cover_image_url, c.visibility, c.join_policy,
    c.min_tier_rank, c.policy_area, c.status,
    c.member_count, c.group_count, c.thread_count,
    c.last_activity_at,
    public.club_effective_member_role(m.role, m.role_expires_at) AS my_role,
    m.status AS my_status,
    cap.can_read
  FROM public.clubs c
  CROSS JOIN scope s
  LEFT JOIN public.club_members m
    ON m.club_id = c.id AND m.user_id = auth.uid() AND m.status = 'active'
  CROSS JOIN LATERAL public.club_capabilities(c.id, NULL, auth.uid()) cap
  WHERE c.tenant_id = s.tenant_id
    AND c.status = 'active'
    AND (
      -- Karta widoczna: public/members/private. Secret tylko dla czlonka
      -- i staffu (tam can_read jest juz true).
      c.visibility IN ('public', 'members', 'private')
      OR cap.can_read
    )
    AND (auth.uid() IS NOT NULL OR c.visibility = 'public')
  ORDER BY
    (m.user_id IS NOT NULL) DESC,          -- moje kluby na gorze
    c.last_activity_at DESC NULLS LAST,
    lower(c.name_pl) ASC
$$;

COMMENT ON FUNCTION public.club_list() IS
  'Kluby widoczne dla wolajacego. private = karta bez tresci, secret = niewidoczny dla obcych. Widocznosc liczy club_capabilities, nie ta funkcja.';

REVOKE EXECUTE ON FUNCTION public.club_list() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_list() TO anon, authenticated, service_role;

-- Widok pojedynczego klubu po slugu (z zasadami i pelnym opisem).
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
    -- Zasady sa czescia karty: trzeba je pokazac PRZED wejsciem, nie po.
    t.rules_pl, t.rules_en,
    t.icon, t.accent_color, t.cover_image_url,
    t.visibility, t.join_policy, t.min_tier_rank,
    t.attribution_mode, t.who_can_post, t.moderation_mode,
    t.policy_area, t.status,
    t.member_count, t.group_count, t.thread_count,
    t.last_activity_at, t.created_at,
    public.club_effective_member_role(m.role, m.role_expires_at) AS my_role,
    m.status AS my_status,
    m.rules_accepted_at,
    cap.can_read, cap.can_post_thread, cap.can_reply,
    cap.can_moderate, cap.can_manage, cap.can_invite,
    cap.can_see_members, cap.reason
  FROM target t
  LEFT JOIN public.club_members m
    ON m.club_id = t.id AND m.user_id = auth.uid()
  CROSS JOIN LATERAL public.club_capabilities(t.id, NULL, auth.uid()) cap
  -- Klub 'secret' bez dostepu nie istnieje dla wolajacego: zero wierszy,
  -- czyli 404 w interfejsie, a nie 403 zdradzajacy nazwe.
  WHERE cap.can_read OR t.visibility IN ('public', 'members', 'private')
$$;

COMMENT ON FUNCTION public.club_view(text) IS
  'Karta klubu po slugu wraz z pelnym zestawem zdolnosci wolajacego. Secret bez dostepu zwraca zero wierszy (404, nie 403).';

REVOKE EXECUTE ON FUNCTION public.club_view(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_view(text) TO anon, authenticated, service_role;

-- Grupy klubu z rozwiazanym dziedziczeniem: klient dostaje wartosc EFEKTYWNA
-- oraz flage, czy jest dziedziczona - zeby panel mogl pokazac "dziedziczone
-- z klubu" bez powtarzania regul dziedziczenia po stronie TS.
DROP FUNCTION IF EXISTS public.club_groups_list(uuid);

CREATE FUNCTION public.club_groups_list(p_club_id uuid)
RETURNS TABLE (
  id uuid, club_id uuid, slug text, name_pl text, name_en text,
  description_pl text, description_en text, icon text, accent_color text,
  sort_order integer, status text,
  opens_at timestamptz, closes_at timestamptz,
  anchor_type text, anchor_id text,
  thread_count integer, last_activity_at timestamptz,
  visibility text, visibility_inherited boolean,
  who_can_post text, who_can_post_inherited boolean,
  moderation_mode text, moderation_mode_inherited boolean,
  min_tier_rank integer, min_tier_rank_inherited boolean,
  attribution_mode text, attribution_mode_inherited boolean,
  can_read boolean, can_post_thread boolean, reason text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    g.id, g.club_id, g.slug, g.name_pl, g.name_en,
    g.description_pl, g.description_en, g.icon, g.accent_color,
    g.sort_order, g.status,
    g.opens_at, g.closes_at,
    g.anchor_type, g.anchor_id,
    g.thread_count, g.last_activity_at,
    COALESCE(g.visibility, c.visibility),          (g.visibility IS NULL),
    COALESCE(g.who_can_post, c.who_can_post),      (g.who_can_post IS NULL),
    COALESCE(g.moderation_mode, c.moderation_mode),(g.moderation_mode IS NULL),
    COALESCE(g.min_tier_rank, c.min_tier_rank),    (g.min_tier_rank IS NULL),
    COALESCE(g.attribution_mode, c.attribution_mode), (g.attribution_mode IS NULL),
    cap.can_read, cap.can_post_thread, cap.reason
  FROM public.club_groups g
  JOIN public.clubs c ON c.id = g.club_id
  CROSS JOIN LATERAL public.club_capabilities(g.club_id, g.id, auth.uid()) cap
  WHERE g.club_id = p_club_id
    AND cap.can_read
    -- Grupa w przygotowaniu jest widoczna wylacznie dla zarzadzajacego.
    AND (g.status NOT IN ('draft', 'archived') OR cap.can_manage)
  ORDER BY g.sort_order ASC, g.created_at ASC
$$;

COMMENT ON FUNCTION public.club_groups_list(uuid) IS
  'Grupy klubu z ROZWIAZANYM dziedziczeniem: kolumna wartosci efektywnej + flaga *_inherited. Regula dziedziczenia zyje w bazie, nie w kliencie.';

REVOKE EXECUTE ON FUNCTION public.club_groups_list(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_groups_list(uuid) TO anon, authenticated, service_role;

-- Moje czlonkostwa - zasila nawigacje ("moje kluby") jednym zapytaniem.
DROP FUNCTION IF EXISTS public.club_my_memberships();

CREATE FUNCTION public.club_my_memberships()
RETURNS TABLE (
  club_id uuid, slug text, name_pl text, name_en text, icon text,
  accent_color text, role text, status text, notify_level text,
  role_expires_at timestamptz, last_read_at timestamptz,
  member_count integer, thread_count integer, last_activity_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id, c.slug, c.name_pl, c.name_en, c.icon, c.accent_color,
    public.club_effective_member_role(m.role, m.role_expires_at),
    m.status, m.notify_level, m.role_expires_at, m.last_read_at,
    c.member_count, c.thread_count, c.last_activity_at
  FROM public.club_members m
  JOIN public.clubs c ON c.id = m.club_id
  JOIN public.profiles p ON p.id = m.user_id
  WHERE m.user_id = auth.uid()
    AND auth.uid() IS NOT NULL
    AND m.status IN ('active', 'pending', 'invited')
    AND c.status <> 'archived'
    AND c.tenant_id = p.tenant_id
  ORDER BY (m.status = 'active') DESC, c.last_activity_at DESC NULLS LAST
$$;

COMMENT ON FUNCTION public.club_my_memberships() IS
  'Kluby wolajacego (aktywne, oczekujace, zaproszenia) - jedno zapytanie dla nawigacji.';

REVOKE EXECUTE ON FUNCTION public.club_my_memberships() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_my_memberships() TO authenticated, service_role;

-- Lista czlonkow. Respektuje `discoverable`: kto ukryl sie w katalogu osob,
-- ten nie wyplywa przez liste klubu. Staff widzi wszystkich, bo bez tego nie
-- da sie moderowac.
DROP FUNCTION IF EXISTS public.club_members_list(uuid, text, integer, integer);

CREATE FUNCTION public.club_members_list(
  p_club_id uuid,
  p_status text DEFAULT 'active',
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
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
      COALESCE(
        NULLIF(btrim(p.display_name), ''),
        NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
        'User'
      ) AS display_name,
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
      -- Prywatnosc katalogu obowiazuje takze tutaj; zarzadzajacy widzi komplet.
      AND (p.discoverable OR cap.can_manage OR m.user_id = auth.uid())
  )
  SELECT r.*, count(*) OVER () AS total_count
  FROM rows r
  ORDER BY
    CASE r.role WHEN 'lead' THEN 0 WHEN 'moderator' THEN 1
                WHEN 'member' THEN 2 ELSE 3 END,
    lower(r.display_name) ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0)
$$;

COMMENT ON FUNCTION public.club_members_list(uuid, text, integer, integer) IS
  'Czlonkowie klubu z paginacja i total_count w tym samym wierszu (bez drugiego zapytania). Respektuje discoverable - zarzadzajacy widzi komplet.';

REVOKE EXECUTE ON FUNCTION public.club_members_list(uuid, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_members_list(uuid, text, integer, integer)
  TO authenticated, service_role;
