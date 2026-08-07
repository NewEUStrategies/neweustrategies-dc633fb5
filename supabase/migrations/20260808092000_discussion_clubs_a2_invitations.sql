-- ============================================================================
-- DISCUSSION CLUB - ETAP A2: ZAPROSZENIA I SAMOOBSLUGA CZLONKOSTWA
--
-- Cztery sciezki wejscia (V2 §3):
--   A. BEZPOSREDNIA - istniejacy czlonek platformy, club_invitations
--   B. E-MAILOWA    - ktos spoza platformy, ISTNIEJACE user_invitations
--   C. LINK         - grupa nieznanych z gory, club_invite_links z tokenem
--   D. SEGMENTOWA   - zbior wyliczony z regulami, club_segment_rules
--
-- LUKA W SPECYFIKACJI, KTORA TA MIGRACJA DOMYKA:
-- V2 §2.4 daje roli `lead` prawo zapraszania, a §3.5 ustala dla niej limit
-- 20 zaproszen dziennie. Ale sciezka B reuzywa user_invitations, gdzie jedyna
-- polityka RLS to `invitations_admin_all` (admin OR super_admin). Lead nie ma
-- wiec jak wstawic wiersza - "Zaprasza ✅" dzialaloby tylko na sciezkach A/C/D.
-- Rozwiazanie: club_invite_by_email() jako SECURITY DEFINER. Funkcja omija RLS
-- W IMIENIU lead-a, ale WYLACZNIE po sprawdzeniu can_invite w club_capabilities
-- i WYLACZNIE z rola platformy 'user' - patrz pulapka typu ponizej.
--
-- PULAPKA TYPU (V2 §3.2), najgrozniejszy mozliwy blad tego modulu:
-- user_invitations.role jest typu public.app_role i oznacza role PLATFORMY.
-- Rola w klubie to osobna os i jedzie w metadata.club_role. Wpisanie roli
-- klubowej do `role` nadaloby komus uprawnienia redakcyjne calej platformy.
-- Dlatego club_invite_by_email() ZAWSZE wpisuje 'user' i nie przyjmuje roli
-- platformy jako parametru - nie da sie jej podac nawet przez pomylke.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Sciezka A: zaproszenia bezposrednie
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.club_invitations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  club_id      uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  group_id     uuid REFERENCES public.club_groups(id) ON DELETE SET NULL,
  inviter_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invitee_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  club_role    text NOT NULL DEFAULT 'member'
               CHECK (club_role IN ('lead', 'moderator', 'member', 'observer')),
  message      text CHECK (message IS NULL OR char_length(message) <= 500),
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'revoked')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);

-- Jedno AKTYWNE zaproszenie na pare (osoba, klub). Indeks czesciowy zamiast
-- pelnego UNIQUE: historia odrzuconych musi zostac, zeby dzialal 90-dniowy
-- odstep przed ponowieniem.
CREATE UNIQUE INDEX IF NOT EXISTS club_invitations_active_key
  ON public.club_invitations (club_id, invitee_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS club_invitations_invitee_idx
  ON public.club_invitations (invitee_id, status);
CREATE INDEX IF NOT EXISTS club_invitations_club_idx
  ON public.club_invitations (club_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS club_invitations_tenant_idx
  ON public.club_invitations (tenant_id, club_id);

COMMENT ON TABLE public.club_invitations IS
  'Zaproszenia bezposrednie do klubu (sciezka A). Jedno aktywne na pare (osoba, klub); historia odrzuconych zostaje dla 90-dniowego odstepu.';

-- ----------------------------------------------------------------------------
-- 2) Sciezka C: linki zapraszajace
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.club_invite_links (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  club_id           uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  group_id          uuid REFERENCES public.club_groups(id) ON DELETE SET NULL,
  -- Token losowy, NIGDY sekwencyjny: 32 bajty z gen_random_bytes w base64url.
  token             text NOT NULL UNIQUE,
  label             text,
  club_role         text NOT NULL DEFAULT 'member'
                    CHECK (club_role IN ('moderator', 'member', 'observer')),
  max_uses          integer CHECK (max_uses IS NULL OR max_uses > 0),
  used_count        integer NOT NULL DEFAULT 0,
  requires_approval boolean NOT NULL DEFAULT false,
  expires_at        timestamptz,
  revoked_at        timestamptz,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS club_invite_links_club_idx
  ON public.club_invite_links (club_id, revoked_at, created_at DESC);
CREATE INDEX IF NOT EXISTS club_invite_links_tenant_idx
  ON public.club_invite_links (tenant_id, club_id);

COMMENT ON TABLE public.club_invite_links IS
  'Linki zapraszajace (sciezka C). Rola lead NIE jest tu dopuszczalna - prowadzacego nadaje sie imiennie, nie masowo linkiem z newslettera.';

CREATE TABLE IF NOT EXISTS public.club_invite_link_uses (
  link_id uuid NOT NULL REFERENCES public.club_invite_links(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  used_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (link_id, user_id)
);

COMMENT ON TABLE public.club_invite_link_uses IS
  'Uzycia linku. Klucz glowny (link, osoba) sprawia, ze ta sama osoba nie zjada limitu dwa razy.';

-- ----------------------------------------------------------------------------
-- 3) Sciezka D: zapisane reguly segmentow
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.club_segment_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  club_id     uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  name        text NOT NULL,
  -- Regula jako jsonb, bo jej ksztalt zalezy od rodzaju: {"kind":"badge",
  -- "badge_slug":"..."} albo {"kind":"reputation","min_level":"voice"}.
  -- Zapisana, zeby kampanie dalo sie POWTORZYC bez skladania jej od nowa.
  rule        jsonb NOT NULL DEFAULT '{}'::jsonb,
  club_role   text NOT NULL DEFAULT 'member'
              CHECK (club_role IN ('moderator', 'member', 'observer')),
  last_run_at timestamptz,
  last_sent   integer NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS club_segment_rules_club_idx
  ON public.club_segment_rules (club_id, created_at DESC);

COMMENT ON TABLE public.club_segment_rules IS
  'Zapisane reguly segmentow (sciezka D), zeby kampanie zapraszajaca dalo sie powtorzyc.';

-- ----------------------------------------------------------------------------
-- 4) RLS: deny-all, RPC-only
-- ----------------------------------------------------------------------------
ALTER TABLE public.club_invitations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_invite_links      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_invite_link_uses  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_segment_rules     ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.club_invitations      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.club_invite_links     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.club_invite_link_uses FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.club_segment_rules    FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.club_invitations      TO service_role;
GRANT ALL ON public.club_invite_links     TO service_role;
GRANT ALL ON public.club_invite_link_uses TO service_role;
GRANT ALL ON public.club_segment_rules    TO service_role;

DROP TRIGGER IF EXISTS club_invitations_pin_tenant_tg ON public.club_invitations;
CREATE TRIGGER club_invitations_pin_tenant_tg
  BEFORE INSERT OR UPDATE ON public.club_invitations
  FOR EACH ROW EXECUTE FUNCTION public.club_child_pin_tenant();

DROP TRIGGER IF EXISTS club_invite_links_pin_tenant_tg ON public.club_invite_links;
CREATE TRIGGER club_invite_links_pin_tenant_tg
  BEFORE INSERT OR UPDATE ON public.club_invite_links
  FOR EACH ROW EXECUTE FUNCTION public.club_child_pin_tenant();

DROP TRIGGER IF EXISTS club_segment_rules_pin_tenant_tg ON public.club_segment_rules;
CREATE TRIGGER club_segment_rules_pin_tenant_tg
  BEFORE INSERT OR UPDATE ON public.club_segment_rules
  FOR EACH ROW EXECUTE FUNCTION public.club_child_pin_tenant();

-- ----------------------------------------------------------------------------
-- 5) Limity antyspamowe - w BAZIE, nie w kliencie (V2 §3.5)
--
-- Wydzielone do funkcji, bo wola je trzy sciezki zapraszania. Limit zalezy od
-- tego, kim jest zapraszajacy: staff 200/dzien, lead 20/dzien.
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
  SELECT count(*)::int INTO v_used
    FROM public.club_invitations
   WHERE inviter_id = _user_id
     AND created_at > now() - interval '24 hours';
  RETURN v_used < v_limit;
END;
$$;

COMMENT ON FUNCTION public.club_invite_quota_ok(uuid) IS
  'Dzienny limit zaproszen: 200 dla staffu, 20 dla prowadzacego. Liczony w bazie - klient nie ma jak go ominac.';

REVOKE EXECUTE ON FUNCTION public.club_invite_quota_ok(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_invite_quota_ok(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6) Sciezka A: zaproszenie osoby z platformy
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_invite(
  p_club_id  uuid,
  p_user_id  uuid,
  p_role     text DEFAULT 'member',
  p_message  text DEFAULT NULL,
  p_group_id uuid DEFAULT NULL
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
  IF p_role NOT IN ('lead', 'moderator', 'member', 'observer') THEN
    RAISE EXCEPTION 'clubs: invalid club role %', p_role USING ERRCODE = '22023';
  END IF;

  -- Bramka przez JEDYNE zrodlo prawdy, nie przez wlasny warunek.
  SELECT * INTO v_caps FROM public.club_capabilities(p_club_id, p_group_id, v_uid);
  IF NOT COALESCE(v_caps.can_invite, false) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  -- Role podniesione nadaje wylacznie staff: prowadzacy nie mianuje drugiego
  -- prowadzacego, bo to obejscie kontroli struktury.
  IF p_role IN ('lead', 'moderator') AND NOT public.is_club_admin(v_uid) THEN
    RAISE EXCEPTION 'clubs: elevated role requires admin' USING ERRCODE = '42501';
  END IF;

  SELECT c.tenant_id INTO v_tenant FROM public.clubs c WHERE c.id = p_club_id;
  SELECT p.tenant_id INTO v_peer_tenant FROM public.profiles p WHERE p.id = p_user_id;
  IF v_peer_tenant IS NULL OR v_peer_tenant <> v_tenant THEN
    RAISE EXCEPTION 'clubs: user not available' USING ERRCODE = '42501';
  END IF;

  -- Zaproszenie NIGDY nie omija blokady miedzy uzytkownikami (V2 §3.5).
  IF public.is_blocked_pair(v_uid, p_user_id) THEN
    RAISE EXCEPTION 'clubs: user not available' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM public.club_members m
              WHERE m.club_id = p_club_id AND m.user_id = p_user_id
                AND m.status IN ('active', 'banned')) THEN
    RAISE EXCEPTION 'clubs: already a member' USING ERRCODE = '23505';
  END IF;

  -- Odrzucone zaproszenie blokuje ponowienie na 90 dni - chyba ze wysyla staff.
  IF NOT public.is_club_admin(v_uid) THEN
    SELECT max(responded_at) INTO v_recent
      FROM public.club_invitations
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
  ) VALUES (v_tenant, p_club_id, p_group_id, v_uid, p_user_id, p_role, NULLIF(btrim(p_message), ''))
  ON CONFLICT (club_id, invitee_id) WHERE status = 'pending'
  DO UPDATE SET message = EXCLUDED.message, club_role = EXCLUDED.club_role
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.club_invite(uuid, uuid, text, text, uuid) IS
  'Sciezka A: zaproszenie osoby z platformy. Bramka przez club_capabilities, limit w bazie, nigdy nie omija user_blocks. Role podniesione nadaje wylacznie staff.';

REVOKE EXECUTE ON FUNCTION public.club_invite(uuid, uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_invite(uuid, uuid, text, text, uuid)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7) Sciezka B: zaproszenie e-mailowe przez ISTNIEJACE user_invitations
--
-- To jest funkcja, ktorej brakowalo w specyfikacji (patrz naglowek). Bez niej
-- rola `lead` nie moze skorzystac ze sciezki B, bo polityka RLS na
-- user_invitations dopuszcza wylacznie admina.
-- ----------------------------------------------------------------------------
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

COMMENT ON FUNCTION public.club_invite_by_email(uuid, text, text, uuid) IS
  'Sciezka B: zaproszenie e-mailowe przez user_invitations. Rola PLATFORMY zawsze user; rola klubowa wylacznie w metadata.club_role. SECURITY DEFINER, bo RLS user_invitations dopuszcza tylko staff, a macierz daje prawo zapraszania takze roli lead.';

REVOKE EXECUTE ON FUNCTION public.club_invite_by_email(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_invite_by_email(uuid, text, text, uuid)
  TO authenticated, service_role;

-- Po akceptacji zaproszenia platformowego wpisujemy osobe do klubu. Bez tego
-- ladowalaby na pustym pulpicie - a to roznica miedzy zaproszeniem, ktore
-- dziala, a takim, ktore technicznie zadzialalo.
CREATE OR REPLACE FUNCTION public.tg_user_invitations_enroll_club()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_club_id uuid;
  v_role    text;
BEGIN
  IF NEW.status <> 'accepted' OR COALESCE(OLD.status, '') = 'accepted' THEN
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
  -- Rola spoza slownika klubowego degraduje do 'member' zamiast wysadzac
  -- akceptacje zaproszenia - konto juz powstalo, wiec blad tutaj zostawilby
  -- uzytkownika w polowie procesu.
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

DROP TRIGGER IF EXISTS tg_user_invitations_enroll_club ON public.user_invitations;
CREATE TRIGGER tg_user_invitations_enroll_club
  AFTER UPDATE OF status ON public.user_invitations
  FOR EACH ROW EXECUTE FUNCTION public.tg_user_invitations_enroll_club();

-- ----------------------------------------------------------------------------
-- 8) Sciezka C: linki
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_club_invite_link_create(
  p_club_id  uuid,
  p_label    text DEFAULT NULL,
  p_role     text DEFAULT 'member',
  p_max_uses integer DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL,
  p_requires_approval boolean DEFAULT false,
  p_group_id uuid DEFAULT NULL
)
RETURNS TABLE (id uuid, token text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_token  text;
  v_id     uuid;
BEGIN
  IF NOT public.is_club_admin(auth.uid()) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('moderator', 'member', 'observer') THEN
    RAISE EXCEPTION 'clubs: invalid club role %', p_role USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clubs c
                  WHERE c.id = p_club_id AND c.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;

  -- 32 bajty losowe w base64url. Sekwencyjny token dalby sie zgadnac,
  -- a link zapraszajacy jest z definicji wysylany kanalem publicznym.
  v_token := translate(encode(gen_random_bytes(32), 'base64'), '+/=', '-_');

  INSERT INTO public.club_invite_links (
    tenant_id, club_id, group_id, token, label, club_role,
    max_uses, requires_approval, expires_at, created_by
  ) VALUES (
    v_tenant, p_club_id, p_group_id, v_token, NULLIF(btrim(p_label), ''), p_role,
    p_max_uses, COALESCE(p_requires_approval, false), p_expires_at, auth.uid()
  )
  RETURNING club_invite_links.id INTO v_id;

  -- Przypisanie do parametrow OUT osobno: RETURNING prosto do `id`/`token`
  -- kolidowaloby z nazwami kolumn tabeli w tym samym zapytaniu.
  id := v_id;
  token := v_token;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.admin_club_invite_link_create(uuid, text, text, integer, timestamptz, boolean, uuid) IS
  'Tworzy link zapraszajacy z tokenem 32 B z gen_random_bytes. Token zwracany jest RAZ, przy tworzeniu.';

REVOKE EXECUTE ON FUNCTION public.admin_club_invite_link_create(uuid, text, text, integer, timestamptz, boolean, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_invite_link_create(uuid, text, text, integer, timestamptz, boolean, uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_club_invite_link_revoke(p_link_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hit integer;
BEGIN
  IF NOT public.is_club_admin(auth.uid()) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.club_invite_links l
     SET revoked_at = now()
   WHERE l.id = p_link_id
     AND l.tenant_id = public.current_tenant_id()
     AND l.revoked_at IS NULL;
  GET DIAGNOSTICS v_hit = ROW_COUNT;
  RETURN v_hit > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_club_invite_link_revoke(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_invite_link_revoke(uuid)
  TO authenticated, service_role;

-- Wykorzystanie linku. Limit i licznik w JEDNEJ transakcji z blokada wiersza -
-- inaczej rownolegle wejscia przekrocza max_uses (V2 §3.3).
CREATE OR REPLACE FUNCTION public.club_redeem_invite_link(p_token text)
RETURNS TABLE (club_slug text, status text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_link   public.club_invite_links%ROWTYPE;
  v_tenant uuid;
  v_slug   text;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;

  -- FOR UPDATE serializuje rownolegle wejscia na tym samym linku.
  SELECT * INTO v_link FROM public.club_invite_links
   WHERE token = p_token FOR UPDATE;
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

  -- Limit sprawdzamy PO odsianiu powtornego uzycia przez te sama osobe:
  -- kto juz wszedl, nie zjada limitu drugi raz.
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

COMMENT ON FUNCTION public.club_redeem_invite_link(text) IS
  'Wykorzystanie linku: waznosc, limit, blokady i wpis czlonkostwa w JEDNEJ transakcji z FOR UPDATE. requires_approval wpuszcza do poczekalni, nie do klubu.';

REVOKE EXECUTE ON FUNCTION public.club_redeem_invite_link(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_redeem_invite_link(text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 9) Samoobsluga czlonkostwa
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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_club FROM public.clubs WHERE id = p_club_id;
  IF NOT FOUND OR v_club.status <> 'active' THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;

  -- Prog planu i blokady liczy club_capabilities - tu ich nie powtarzamy.
  SELECT * INTO v_caps FROM public.club_capabilities(p_club_id, NULL, v_uid);
  IF v_caps.reason = 'tier_too_low' THEN
    RAISE EXCEPTION 'clubs: tier too low' USING ERRCODE = '42501';
  END IF;
  IF v_caps.effective_role = 'banned' THEN
    RAISE EXCEPTION 'clubs: banned' USING ERRCODE = '42501';
  END IF;

  -- Klub 'invite' nie przyjmuje samodzielnych zgloszen - od tego sa zaproszenia.
  IF v_club.join_policy = 'invite' THEN
    RAISE EXCEPTION 'clubs: invitation required' USING ERRCODE = '42501';
  END IF;

  v_status := CASE WHEN v_club.join_policy = 'open' THEN 'active' ELSE 'pending' END;

  INSERT INTO public.club_members (
    tenant_id, club_id, user_id, role, status, invite_source
  )
  SELECT v_club.tenant_id, p_club_id, v_uid, 'member', v_status, 'self'
   WHERE EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = v_uid AND p.tenant_id = v_club.tenant_id)
  ON CONFLICT (club_id, user_id) DO UPDATE
    SET status = CASE WHEN club_members.status = 'left'
                      THEN EXCLUDED.status ELSE club_members.status END;

  RETURN v_status;
END;
$$;

COMMENT ON FUNCTION public.club_join(uuid) IS
  'Dolaczenie samodzielne. open -> active, request -> pending, invite -> odmowa. Prog planu i blokady liczy club_capabilities.';

REVOKE EXECUTE ON FUNCTION public.club_join(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_join(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_leave(p_club_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hit integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;
  -- Status 'left', nie DELETE: historia czlonkostwa jest potrzebna moderacji
  -- i statystykom, a wyjscie ma byc odwracalne.
  UPDATE public.club_members
     SET status = 'left'
   WHERE club_id = p_club_id AND user_id = auth.uid() AND status <> 'banned';
  GET DIAGNOSTICS v_hit = ROW_COUNT;
  RETURN v_hit > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_leave(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_leave(uuid) TO authenticated, service_role;

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
    ON CONFLICT (club_id, user_id) DO UPDATE
      SET status = 'active', role = EXCLUDED.role;
    RETURN 'accepted';
  END IF;

  RETURN 'declined';
END;
$$;

COMMENT ON FUNCTION public.club_respond_invitation(uuid, boolean) IS
  'Odpowiedz na zaproszenie. Wygasle zaproszenie oznacza sie jako expired przy probie odpowiedzi - bez potrzeby nocnego joba.';

REVOKE EXECUTE ON FUNCTION public.club_respond_invitation(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_respond_invitation(uuid, boolean)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_set_notify_level(p_club_id uuid, p_level text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hit integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_level NOT IN ('all', 'mentions', 'digest', 'none') THEN
    RAISE EXCEPTION 'clubs: invalid notify level %', p_level USING ERRCODE = '22023';
  END IF;
  UPDATE public.club_members SET notify_level = p_level
   WHERE club_id = p_club_id AND user_id = auth.uid();
  GET DIAGNOSTICS v_hit = ROW_COUNT;
  RETURN v_hit > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.club_set_notify_level(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_set_notify_level(uuid, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_accept_rules(p_club_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hit integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.club_members SET rules_accepted_at = now()
   WHERE club_id = p_club_id AND user_id = auth.uid() AND rules_accepted_at IS NULL;
  GET DIAGNOSTICS v_hit = ROW_COUNT;
  RETURN v_hit > 0;
END;
$$;

COMMENT ON FUNCTION public.club_accept_rules(uuid) IS
  'Akceptacja zasad klubu. Znacznik czasu jest podstawa do przetwarzania tresci przy usunieciu konta (anonimizacja, V1 §7) - dlatego nie nadpisujemy istniejacej daty.';

REVOKE EXECUTE ON FUNCTION public.club_accept_rules(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_accept_rules(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 10) Odczyt: moje zaproszenia + historia w panelu
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.club_my_invitations();

CREATE FUNCTION public.club_my_invitations()
RETURNS TABLE (
  id uuid, club_id uuid, club_slug text, club_name_pl text, club_name_en text,
  club_icon text, club_role text, message text,
  inviter_name text, created_at timestamptz, expires_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    i.id, i.club_id, c.slug, c.name_pl, c.name_en, c.icon, i.club_role, i.message,
    COALESCE(NULLIF(btrim(p.display_name), ''), 'NES') AS inviter_name,
    i.created_at, i.expires_at
  FROM public.club_invitations i
  JOIN public.clubs c ON c.id = i.club_id
  LEFT JOIN public.profiles p ON p.id = i.inviter_id
  WHERE i.invitee_id = auth.uid()
    AND auth.uid() IS NOT NULL
    AND i.status = 'pending'
    AND i.expires_at > now()
  ORDER BY i.created_at DESC
$$;

REVOKE EXECUTE ON FUNCTION public.club_my_invitations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_my_invitations() TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.admin_club_invitations(uuid);

CREATE FUNCTION public.admin_club_invitations(p_club_id uuid)
RETURNS TABLE (
  id uuid, channel text, recipient text, club_role text, status text,
  inviter_name text, created_at timestamptz, expires_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  -- Dwie sciezki w jednej liscie: bezposrednie i e-mailowe. Administrator
  -- pyta "kogo zaprosilismy", a nie "kogo zaprosilismy ktora tabela".
  SELECT
    i.id, 'direct'::text,
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

  SELECT
    u.id, 'email'::text, u.email,
    COALESCE(u.metadata->>'club_role', 'member'), u.status::text,
    COALESCE(u.metadata->>'invited_by_name', '-'),
    u.created_at, u.expires_at
  FROM public.user_invitations u
  WHERE u.source = 'club'
    AND (u.metadata->>'club_id')::uuid = p_club_id
    AND public.is_club_admin(auth.uid())
    AND u.tenant_id = public.current_tenant_id()

  ORDER BY created_at DESC
$$;

COMMENT ON FUNCTION public.admin_club_invitations(uuid) IS
  'Historia zaproszen klubu: sciezka bezposrednia i e-mailowa w jednej liscie. Administrator pyta "kogo zaprosilismy", nie "ktora tabela".';

REVOKE EXECUTE ON FUNCTION public.admin_club_invitations(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_invitations(uuid) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.admin_club_invite_links(uuid);

CREATE FUNCTION public.admin_club_invite_links(p_club_id uuid)
RETURNS TABLE (
  id uuid, token text, label text, club_role text,
  max_uses integer, used_count integer, requires_approval boolean,
  expires_at timestamptz, revoked_at timestamptz, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.id, l.token, l.label, l.club_role,
    l.max_uses, l.used_count, l.requires_approval,
    l.expires_at, l.revoked_at, l.created_at
  FROM public.club_invite_links l
  JOIN public.clubs c ON c.id = l.club_id
  WHERE l.club_id = p_club_id
    AND public.is_club_admin(auth.uid())
    AND c.tenant_id = public.current_tenant_id()
  ORDER BY l.revoked_at NULLS FIRST, l.created_at DESC
$$;

REVOKE EXECUTE ON FUNCTION public.admin_club_invite_links(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_club_invite_links(uuid) TO authenticated, service_role;
