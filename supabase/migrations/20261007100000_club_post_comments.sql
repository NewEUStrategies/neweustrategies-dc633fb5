-- ============================================================================
-- KOMENTARZE WPISÓW ŚCIANY KLUBU (club_post_comments)
--
-- PO CO. Wpis ściany (`club_posts`) dało się dziś tylko polubić. Jedyną drogą
-- do rozmowy był link „Komentuj w wątku", który wyprowadzał czytelnika ze
-- strumienia na stronę wątku - a wpis bez podpiętego wątku nie miał gdzie
-- prowadzić wcale. Ta migracja daje wpisom WŁASNE, płaskie komentarze, które
-- karta strumienia czyta i dopisuje na miejscu.
--
-- DECYZJE, KTÓRYCH NIE WIDAĆ W KODZIE:
--
--   1. Komentarze są PŁASKIE (bez drzewa). „Odpowiedz" w interfejsie wstawia
--      `@slug ` autora, więc odpowiedź jest wzmianką, a wzmianka niesie
--      powiadomienie - drzewo nie dodaje tu nic poza kosztem projekcji.
--   2. Tabela idzie wzorcem `club_replies` (REVOKE ALL dla klientów, RLS bez
--      polityk), a NIE `club_posts` (granty dla `authenticated` bez polityk).
--      Dostęp wyłącznie przez RPC SECURITY DEFINER; brak grantu jest drugą
--      zaporą na wypadek, gdyby ktoś kiedyś dopisał zbyt szeroką politykę.
--   3. `author_id` jest ZAWSZE zapisany. Regułę Chatham House realizuje
--      PROJEKCJA (lista zwraca pseudonim), tak jak w odpowiedziach wątków -
--      bez tego moderacja nie miałaby kogo rozliczyć.
--   4. Pseudonim jest solony PER WPIS (`post:v1:<wpis>`), innym zakresem niż
--      pseudonim wątku (`v2:<wątek>`): ta sama osoba ma różne pseudonimy pod
--      różnymi wpisami i w wątkach, więc nie da się złożyć jej profilu
--      z historii klubu.
--   5. Migawka podglądu linku jest NORMALIZOWANA na serwerze do pięciu kluczy
--      i wyłącznie adresów https. Klient pobiera podgląd przez serwerową
--      funkcję z osłoną SSRF, ale RPC nie może ufać temu, co klient przysłał:
--      bez walidacji dowolny `data:` albo piksel śledzący trafiłby do kart
--      wszystkich czytelników.
--   6. `club_posts_list` dostaje `comment_count` i `can_comment`. Zmiana typu
--      zwracanego wymaga DROP + CREATE w tym samym pliku (bramka replay).
--      Reszta ciała pochodzi z jedynej definicji (20260809093335) - łącznie
--      z jawnym autorem wpisu - z jedną poprawką: strumień całego klubu
--      filtruje wpisy prawem odczytu ICH działu (patrz sekcja 6).
--   7. Premoderacja ma wyjście: `club_post_comment_moderate` zatwierdza albo
--      ukrywa komentarz i zostawia ślad w `club_moderation_log` (cel
--      `post_comment`). Bez tego komentarz `pending` czekał wiecznie - żadna
--      funkcja nie przestawiała statusu poza usunięciem. Lista oddaje
--      `can_approve`, bo `can_manage` jest prawdziwe także dla autora,
--      a w trybie chatham klient nie ma `author_id`, żeby ich rozróżnić.
--   8. Powiadomienie autora wpisu i @wzmianki rodzą się tylko raz: przy
--      komentarzu od razu widocznym albo przy przejściu pending -> visible.
--      Ponowne odsłonięcie ukrytego komentarza nie powiadamia drugi raz.
--
-- Wzmianki (`process_mentions`), bramka odbiorców, walidacja linków
-- i limity tempa w `club_post_create` oraz odczyt działów klubu publicznego
-- przez gościa są w kolejnej migracji (20261007100100).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Tabela
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.club_post_comments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  club_id      uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  post_id      uuid NOT NULL REFERENCES public.club_posts(id) ON DELETE CASCADE,
  author_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  body         text NOT NULL,
  link_preview jsonb,
  status       text NOT NULL DEFAULT 'visible',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  edited_at    timestamptz,
  CONSTRAINT club_post_comments_body_len
    CHECK (char_length(btrim(body)) BETWEEN 1 AND 3000),
  CONSTRAINT club_post_comments_link_preview_object
    CHECK (link_preview IS NULL OR jsonb_typeof(link_preview) = 'object'),
  CONSTRAINT club_post_comments_status_check
    CHECK (status IN ('pending', 'visible', 'hidden', 'deleted'))
);

COMMENT ON TABLE public.club_post_comments IS
  'Płaskie komentarze wpisów ściany klubu. Dostęp wyłącznie przez RPC (club_post_comments_list, club_post_comment_create, club_post_comment_delete, club_post_comment_moderate). author_id zapisany zawsze; Chatham House realizuje projekcja listy.';

-- Strona listy: najnowsze pierwsze, kursor (created_at, id).
CREATE INDEX IF NOT EXISTS club_post_comments_post_recent_idx
  ON public.club_post_comments (post_id, created_at DESC, id DESC);
-- Limity tempa liczone po autorze.
CREATE INDEX IF NOT EXISTS club_post_comments_author_recent_idx
  ON public.club_post_comments (author_id, created_at DESC);
-- Kaskada usunięcia klubu i przekroje moderacyjne.
CREATE INDEX IF NOT EXISTS club_post_comments_club_idx
  ON public.club_post_comments (club_id);

ALTER TABLE public.club_post_comments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_post_comments FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.club_post_comments TO service_role;

-- Najemca zawsze z klubu - klient nie ma jak go podać inaczej.
DROP TRIGGER IF EXISTS club_post_comments_pin_tenant_tg ON public.club_post_comments;
CREATE TRIGGER club_post_comments_pin_tenant_tg
  BEFORE INSERT OR UPDATE ON public.club_post_comments
  FOR EACH ROW EXECUTE FUNCTION public.club_child_pin_tenant();

DROP TRIGGER IF EXISTS club_post_comments_set_updated_tg ON public.club_post_comments;
CREATE TRIGGER club_post_comments_set_updated_tg
  BEFORE UPDATE ON public.club_post_comments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Ta sama reguła składu co dla wątków, odpowiedzi i wpisów (A32): kto pisze
-- w klubie, ten w tym klubie JEST. Bez tego redaktor komentujący jako gość
-- znikałby z listy członków, choć jego głos stoi w strumieniu.
DROP TRIGGER IF EXISTS club_post_comments_autojoin_tg ON public.club_post_comments;
CREATE TRIGGER club_post_comments_autojoin_tg
  AFTER INSERT ON public.club_post_comments
  FOR EACH ROW EXECUTE FUNCTION public.club_autojoin_author();

-- ----------------------------------------------------------------------------
-- 2) Pomocnicy (bez grantów dla klientów)
-- ----------------------------------------------------------------------------

-- Pseudonim Chatham House dla komentarza wpisu. Algorytm 1:1 z
-- `club_author_alias` (HMAC-SHA256 z solą najemcy, 25 bitów w Crockford
-- Base32), inny jest WYŁĄCZNIE zakres wiadomości - patrz decyzja 4 w nagłówku.
-- search_path z `extensions`, bo HMAC pochodzi z pgcrypto (kontrakt
-- `extensions_search_path_contract_test.sql`); wywołanie jest dodatkowo
-- kwalifikowane, więc działa przy obu ułożeniach rozszerzenia.
CREATE OR REPLACE FUNCTION public.club_post_author_alias(_post_id uuid, _author_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tenant   uuid;
  v_salt     text;
  v_mac      bytea;
  v_bits     bigint;
  v_alphabet text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_out      text := '';
  v_i        integer;
BEGIN
  IF _author_id IS NULL OR _post_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT po.tenant_id INTO v_tenant FROM public.club_posts po WHERE po.id = _post_id;
  IF v_tenant IS NULL THEN
    RETURN NULL;
  END IF;

  -- Funkcja jest STABLE, więc soli tu nie zakładamy (sieje ją trigger klubu).
  SELECT s.salt INTO v_salt FROM public.club_anonymity_salts s WHERE s.tenant_id = v_tenant;
  IF v_salt IS NULL THEN
    RETURN '?????';
  END IF;

  v_mac := extensions.hmac(
    'post:v1:' || _post_id::text || ':' || _author_id::text, v_salt, 'sha256');

  v_bits := (get_byte(v_mac, 0)::bigint << 32)
          | (get_byte(v_mac, 1)::bigint << 24)
          | (get_byte(v_mac, 2)::bigint << 16)
          | (get_byte(v_mac, 3)::bigint << 8)
          |  get_byte(v_mac, 4)::bigint;

  FOR v_i IN 0..4 LOOP
    v_out := v_out || substr(v_alphabet, 1 + ((v_bits >> (35 - v_i * 5)) & 31)::int, 1);
  END LOOP;

  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public.club_post_author_alias(uuid, uuid) IS
  'Pseudonim Chatham House w komentarzach wpisu: HMAC-SHA256 z solą najemcy, zakres post:v1:<wpis>. Stabilny pod jednym wpisem, różny między wpisami i względem pseudonimów wątków.';

REVOKE ALL ON FUNCTION public.club_post_author_alias(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_post_author_alias(uuid, uuid) TO service_role;

-- Normalizacja migawki podglądu linku. Zwraca obiekt z DOKŁADNIE pięcioma
-- kluczami albo NULL, gdy migawka jest niepoprawna - komunikat błędu należy do
-- wołającego (komentarz i załącznik wpisu mówią o tym różnie).
--   url         - wymagany tekst https://..., najwyżej 2048 znaków;
--   image       - null albo https://..., najwyżej 2048 znaków;
--   title, description, siteName - null albo tekst najwyżej 300 znaków.
-- Puste teksty zamieniają się w null; nieznane klucze są pomijane.
--
-- ZNAKI STERUJĄCE (C0, DEL, C1) wypadają z tekstów, a w adresach dają
-- odrzucenie - tak samo jak w kliencie (`clampText`, `readHttpsUrl`). Zakresy
-- są wypisane jawnie, nie przez `[:cntrl:]`: zawartość tej klasy zależy od
-- locale bazy, a serwer i klient mają usuwać DOKŁADNIE ten sam zbiór
-- (< U+0020 i U+007F..U+009F). Sam U+0000 nie dociera tu wcale - `jsonb`
-- odrzuca `\u0000` już przy parsowaniu argumentu (22P05), więc tę zaporę
-- stawia klient.
CREATE OR REPLACE FUNCTION public.club_link_snapshot_normalize(p_link jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE
  -- Schemat i niepusty host; bez białych znaków i znaków sterujących.
  c_https constant text :=
    '^https://[^[:space:]\u0001-\u001f\u007f-\u009f/?#]+([/?#][^[:space:]\u0001-\u001f\u007f-\u009f]*)?$';
  c_cntrl constant text := '[\u0001-\u001f\u007f-\u009f]';
  v_out   jsonb;
  v_val   jsonb;
  v_text  text;
  v_key   text;
BEGIN
  IF p_link IS NULL OR jsonb_typeof(p_link) IS DISTINCT FROM 'object' THEN
    RETURN NULL;
  END IF;

  v_val := p_link -> 'url';
  IF v_val IS NULL OR jsonb_typeof(v_val) <> 'string' THEN
    RETURN NULL;
  END IF;
  v_text := btrim(v_val #>> '{}');
  IF char_length(v_text) > 2048 OR v_text !~* c_https THEN
    RETURN NULL;
  END IF;
  v_out := jsonb_build_object('url', v_text);

  v_val := p_link -> 'image';
  IF v_val IS NULL OR jsonb_typeof(v_val) = 'null' THEN
    v_out := v_out || jsonb_build_object('image', NULL);
  ELSIF jsonb_typeof(v_val) = 'string' THEN
    v_text := NULLIF(btrim(v_val #>> '{}'), '');
    IF v_text IS NOT NULL AND (char_length(v_text) > 2048 OR v_text !~* c_https) THEN
      RETURN NULL;
    END IF;
    v_out := v_out || jsonb_build_object('image', v_text);
  ELSE
    RETURN NULL;
  END IF;

  FOREACH v_key IN ARRAY ARRAY['title', 'description', 'siteName'] LOOP
    v_val := p_link -> v_key;
    IF v_val IS NULL OR jsonb_typeof(v_val) = 'null' THEN
      v_out := v_out || jsonb_build_object(v_key, NULL);
    ELSIF jsonb_typeof(v_val) = 'string' THEN
      v_text := NULLIF(btrim(regexp_replace(v_val #>> '{}', c_cntrl, '', 'g')), '');
      IF v_text IS NOT NULL AND char_length(v_text) > 300 THEN
        RETURN NULL;
      END IF;
      v_out := v_out || jsonb_build_object(v_key, v_text);
    ELSE
      RETURN NULL;
    END IF;
  END LOOP;

  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public.club_link_snapshot_normalize(jsonb) IS
  'Migawka podglądu linku do postaci kanonicznej {url, title, description, image, siteName}: tylko https bez znaków sterujących, url/image do 2048 znaków, teksty do 300 (znaki sterujące usunięte). NULL = migawka niepoprawna.';

REVOKE ALL ON FUNCTION public.club_link_snapshot_normalize(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_link_snapshot_normalize(jsonb) TO service_role;

-- Prawo ODCZYTU wskazanej osoby (nie wołającego) do klubu lub grupy.
--
-- DLACZEGO NIE `club_capabilities(_club, _group, odbiorca)`. Ta funkcja ma
-- osłonę przed sondowaniem cudzych uprawnień: `_user_id` różny od wołającego
-- jest PODMIENIANY na `auth.uid()`, chyba że wołający jest administratorem
-- klubów. W triggerze wołającym jest AUTOR wpisu, więc pytanie „czy odbiorca
-- może to czytać" zamieniało się po cichu w „czy autor może to czytać" - czyli
-- zawsze „tak". Bramka publiczności wzmianek (A22) i adresat powiadomienia
-- o komentarzu muszą pytać o ODBIORCĘ.
--
-- Gałąź odczytu jest przepisana 1:1 z `club_capabilities`
-- (20260812091500; 20261007100100 zmienia tam wyłącznie gałąź gościa,
-- a gość nie bywa tu odbiorcą - `_user_id` NULL daje `false`):
-- najemca domowy, ban, rola z kadencją, klub tajny,
-- status klubu, widoczność grupy (szkic i okno przed `opens_at` ukrywają,
-- `frozen`/`archived` nie) oraz widoczność klubu/grupy. Próg planu dla
-- cudzego konta - tak jak tam - nie blokuje odczytu, bo `has_tier_rank` zna
-- wyłącznie wołającego. Zmiana reguły odczytu w `club_capabilities` wymaga
-- zmiany tutaj.
CREATE OR REPLACE FUNCTION public.club_user_can_read(
  _club_id uuid, _group_id uuid, _user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club   public.clubs%ROWTYPE;
  v_group  public.club_groups%ROWTYPE;
  v_member public.club_members%ROWTYPE;
  v_tenant uuid;
  v_role   text;
BEGIN
  IF _club_id IS NULL OR _user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_club FROM public.clubs c WHERE c.id = _club_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT p.tenant_id INTO v_tenant FROM public.profiles p WHERE p.id = _user_id;
  IF v_tenant IS NULL OR v_tenant <> v_club.tenant_id THEN
    RETURN false;
  END IF;

  IF _group_id IS NOT NULL THEN
    SELECT * INTO v_group FROM public.club_groups g
     WHERE g.id = _group_id AND g.club_id = _club_id;
    IF NOT FOUND THEN
      RETURN false;
    END IF;
  END IF;

  SELECT * INTO v_member FROM public.club_members m
   WHERE m.club_id = _club_id AND m.user_id = _user_id;
  IF FOUND AND v_member.status = 'banned' THEN
    RETURN false;
  END IF;

  IF public.is_club_admin(_user_id) OR public.is_nes_staff(_user_id) THEN
    RETURN true;
  END IF;

  v_role := CASE
    WHEN v_member.id IS NULL OR v_member.status <> 'active' THEN 'non_member'
    ELSE public.club_effective_member_role(v_member.role, v_member.role_expires_at)
  END;

  IF v_club.visibility = 'secret' AND v_role = 'non_member' THEN
    RETURN false;
  END IF;
  IF v_club.status <> 'active' THEN
    RETURN false;
  END IF;

  IF _group_id IS NOT NULL THEN
    IF v_group.status = 'draft' THEN
      RETURN false;
    END IF;
    IF v_group.status NOT IN ('archived', 'frozen')
       AND v_group.opens_at IS NOT NULL AND v_group.opens_at > now() THEN
      RETURN false;
    END IF;
  END IF;

  IF v_role <> 'non_member' THEN
    RETURN true;
  END IF;
  RETURN COALESCE(v_group.visibility, v_club.visibility) IN ('public', 'members');
END;
$$;

COMMENT ON FUNCTION public.club_user_can_read(uuid, uuid, uuid) IS
  'Czy WSKAZANA osoba może czytać klub/grupę. Gałąź odczytu club_capabilities bez osłony przed sondowaniem - dla bramek odbiorców w triggerach, gdzie wołającym jest autor. Wyłącznie service_role.';

REVOKE ALL ON FUNCTION public.club_user_can_read(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_user_can_read(uuid, uuid, uuid) TO service_role;

-- Reguła ujawniania dla szyn wpisu - odpowiednik `club_thread_seam_context`.
-- Tryb atrybucji wpisu: grupa -> klub (wpis nie ma własnego nadpisania).
CREATE OR REPLACE FUNCTION public.club_post_seam_context(p_post_id uuid)
RETURNS TABLE (
  emit boolean, hide_actor boolean, club_id uuid, club_slug text,
  tenant_id uuid, group_id uuid, post_author_id uuid, post_status text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (c.visibility <> 'secret'),
    (COALESCE(g.attribution_mode, c.attribution_mode) = 'chatham'),
    c.id, c.slug, c.tenant_id, po.group_id, po.author_id, po.status
  FROM public.club_posts po
  JOIN public.clubs c ON c.id = po.club_id
  LEFT JOIN public.club_groups g ON g.id = po.group_id
  WHERE po.id = p_post_id
$$;

COMMENT ON FUNCTION public.club_post_seam_context(uuid) IS
  'Regula ujawniania dla szyn wpisu ściany: klub secret nie emituje nic, tryb chatham (grupa -> klub) emituje bez aktora.';

REVOKE ALL ON FUNCTION public.club_post_seam_context(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_post_seam_context(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 3) RPC: lista komentarzy wpisu
--
-- Najnowsze pierwsze, kursor keyset (created_at, id). Nieczytelny albo
-- usunięty wpis daje PUSTY zbiór, nie błąd - karta strumienia nie ma czego
-- obsługiwać, a brak rozróżnienia nie zdradza istnienia wpisu.
--
-- `can_manage` (usuń) przysługuje autorowi i moderacji, `can_approve`
-- (zatwierdź z kolejki) WYŁĄCZNIE moderacji i tylko dla `pending` - autor
-- nie zatwierdza sam siebie, a przycisk „Zatwierdź" nie może zależeć od
-- `author_id`, którego w trybie chatham lista nie oddaje.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_post_comments_list(
  p_post_id   uuid,
  p_limit     integer DEFAULT 3,
  p_before    timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid, post_id uuid, body text, link_preview jsonb, status text,
  author_id uuid, author_name text, author_avatar text, author_slug text,
  author_alias text, created_at timestamptz, edited_at timestamptz,
  can_manage boolean, can_approve boolean, total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH post AS (
    SELECT po.id, po.club_id, po.group_id,
           COALESCE(g.attribution_mode, c.attribution_mode) AS attribution
      FROM public.club_posts po
      JOIN public.clubs c ON c.id = po.club_id
      LEFT JOIN public.club_groups g ON g.id = po.group_id
     WHERE po.id = p_post_id
       AND po.status = 'published'
  ),
  cap AS (
    SELECT cc.can_read, cc.can_moderate
      FROM post
      CROSS JOIN LATERAL public.club_capabilities(post.club_id, post.group_id, auth.uid()) cc
  ),
  visible AS (
    SELECT pc.*
      FROM public.club_post_comments pc
      CROSS JOIN post
      CROSS JOIN cap
     WHERE pc.post_id = post.id
       AND cap.can_read
       -- pending widzi autor i moderacja; hidden/deleted - nikt.
       AND (pc.status = 'visible'
            OR (pc.status = 'pending'
                AND auth.uid() IS NOT NULL
                AND (pc.author_id = auth.uid() OR cap.can_moderate)))
  ),
  page AS (
    SELECT v.* FROM visible v
     WHERE p_before IS NULL
        OR (p_before_id IS NULL AND v.created_at < p_before)
        OR (p_before_id IS NOT NULL AND (v.created_at, v.id) < (p_before, p_before_id))
     ORDER BY v.created_at DESC, v.id DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 3), 1), 50)
  )
  SELECT
    v.id, v.post_id, v.body, v.link_preview, v.status,
    CASE WHEN post.attribution = 'chatham' THEN NULL ELSE v.author_id END,
    CASE WHEN post.attribution = 'chatham' THEN NULL
         ELSE COALESCE(NULLIF(btrim(p.display_name), ''),
                       NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'User')
    END,
    CASE WHEN post.attribution = 'chatham' OR p.hide_avatar THEN NULL ELSE p.avatar_url END,
    CASE WHEN post.attribution = 'chatham' THEN NULL ELSE p.slug END,
    CASE WHEN post.attribution = 'chatham'
         THEN public.club_post_author_alias(v.post_id, v.author_id) ELSE NULL END,
    v.created_at, v.edited_at,
    (auth.uid() IS NOT NULL AND (v.author_id = auth.uid() OR cap.can_moderate)),
    (v.status = 'pending' AND auth.uid() IS NOT NULL AND COALESCE(cap.can_moderate, false)),
    (SELECT count(*) FROM visible)
  FROM page v
  CROSS JOIN post
  CROSS JOIN cap
  LEFT JOIN public.profiles p ON p.id = v.author_id
  ORDER BY v.created_at DESC, v.id DESC
$$;

COMMENT ON FUNCTION public.club_post_comments_list(uuid, integer, timestamptz, uuid) IS
  'Komentarze wpisu ściany, najnowsze pierwsze, kursor (p_before, p_before_id). visible dla czytających, pending dla autora i moderacji. W trybie chatham autor ukryty, author_alias = pseudonim per wpis. can_approve = pending i can_moderate wołającego. total_count bez kursora.';

REVOKE ALL ON FUNCTION public.club_post_comments_list(uuid, integer, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_post_comments_list(uuid, integer, timestamptz, uuid)
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4) RPC: nowy komentarz
--
-- Komunikaty błędów mapuje klient po TREŚCI (`clubCommentErrorKey`), więc są
-- częścią kontraktu. Kolumny wyjściowe nazywają się comment_id/comment_status
-- z tego samego powodu, co w `club_reply` (A30): RETURNS TABLE wprowadza je
-- do zakresu plpgsql, a `id`/`status` są kolumnami tabel w tym ciele.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_post_comment_create(
  p_post_id      uuid,
  p_body         text,
  p_link_preview jsonb DEFAULT NULL
)
RETURNS TABLE (comment_id uuid, comment_status text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_post   public.club_posts%ROWTYPE;
  v_caps   record;
  -- Przycinamy KAŻDY biały znak na brzegach (także nowe linie z textarea),
  -- nie tylko spacje jak `btrim`: komentarz z samych Enterów jest pusty.
  v_body   text := regexp_replace(COALESCE(p_body, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_link   jsonb;
  v_mod    text;
  v_status text;
  v_recent integer;
  v_burst  integer;
  v_id     uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;

  -- Serializacja limitów per użytkownik (wzorzec `club_reply`): równoległe
  -- wywołania stają w kolejce zamiast czytać ten sam licznik.
  PERFORM pg_advisory_xact_lock(hashtext('club_post_comment:' || v_uid::text));

  SELECT * INTO v_post FROM public.club_posts po WHERE po.id = p_post_id;
  IF NOT FOUND OR v_post.status <> 'published' THEN
    RAISE EXCEPTION 'clubs: post not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_caps FROM public.club_capabilities(v_post.club_id, v_post.group_id, v_uid);
  IF NOT COALESCE(v_caps.can_reply, false) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  IF char_length(v_body) < 1 OR char_length(v_body) > 3000 THEN
    RAISE EXCEPTION 'clubs: invalid comment' USING ERRCODE = '22023';
  END IF;

  IF p_link_preview IS NOT NULL AND jsonb_typeof(p_link_preview) <> 'null' THEN
    v_link := public.club_link_snapshot_normalize(p_link_preview);
    IF v_link IS NULL THEN
      RAISE EXCEPTION 'clubs: invalid link preview' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT count(*)::int INTO v_recent FROM public.club_post_comments pc
   WHERE pc.author_id = v_uid AND pc.created_at > now() - interval '24 hours';
  IF v_recent >= 60 THEN
    RAISE EXCEPTION 'clubs: comment rate limit' USING ERRCODE = '42901';
  END IF;
  SELECT count(*)::int INTO v_burst FROM public.club_post_comments pc
   WHERE pc.author_id = v_uid AND pc.created_at > now() - interval '1 minute';
  IF v_burst >= 5 THEN
    RAISE EXCEPTION 'clubs: comment burst limit' USING ERRCODE = '42901';
  END IF;

  -- Tryb moderacji: grupa -> klub. Wpis bez grupy (ściana klubu) bierze tryb
  -- klubu - stąd LEFT JOIN, inaczej niż w `club_reply`, gdzie grupa jest zawsze.
  SELECT COALESCE(g.moderation_mode, c.moderation_mode) INTO v_mod
    FROM public.clubs c
    LEFT JOIN public.club_groups g ON g.id = v_post.group_id
   WHERE c.id = v_post.club_id;

  v_status := CASE
    WHEN v_caps.can_moderate THEN 'visible'
    WHEN v_mod = 'pre' THEN 'pending'
    WHEN v_mod = 'trusted' AND v_caps.reason = 'pre_moderation' THEN 'pending'
    ELSE 'visible' END;

  -- club_id ZAWSZE z wpisu: komentarz nie może trafić do innego klubu niż
  -- wpis, pod którym stoi (najemcę dopina trigger z klubu).
  INSERT INTO public.club_post_comments (
    tenant_id, club_id, post_id, author_id, body, link_preview, status
  ) VALUES (
    v_post.tenant_id, v_post.club_id, v_post.id, v_uid, v_body, v_link, v_status
  )
  RETURNING club_post_comments.id INTO v_id;

  RETURN QUERY SELECT v_id, v_status;
END;
$$;

COMMENT ON FUNCTION public.club_post_comment_create(uuid, text, jsonb) IS
  'Komentarz pod wpisem ściany. Wymaga can_reply w klubie/grupie wpisu; treść 1..3000 znaków; migawka linku normalizowana do 5 kluczy https. Limity: 60/24 h i 5/min. Zwraca identyfikator ORAZ status (visible albo pending - premoderacja).';

REVOKE ALL ON FUNCTION public.club_post_comment_create(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_post_comment_create(uuid, text, jsonb)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5) Moderacja komentarza: dziennik, usunięcie (miękkie), zatwierdzenie
--
-- Dziennik moderacji zna dotąd cele 'thread', 'reply', 'member', 'group',
-- 'club' (ostatnia lista: 20261004090000). Dopisujemy 'post_comment' -
-- wyłącznie POSZERZENIE, więc żaden istniejący wiersz nie narusza nowej
-- listy. Akcje 'approve', 'hide' i 'delete' lista akcji już zna. Klient czyta
-- ten słownik z `CLUB_LOG_TARGETS` (bramka `clubLogDbParity.test.ts`).
-- ----------------------------------------------------------------------------
ALTER TABLE public.club_moderation_log
  DROP CONSTRAINT IF EXISTS club_moderation_log_target_type_check;
ALTER TABLE public.club_moderation_log
  ADD CONSTRAINT club_moderation_log_target_type_check
  CHECK (target_type IN ('thread', 'reply', 'member', 'group', 'club', 'post_comment'));

-- Autor usuwa własny komentarz bez śladu w dzienniku (to nie jest
-- moderacja); usunięcie CUDZEGO komentarza przez moderację zostawia wpis
-- 'delete' - jak każda akcja `club_moderate` na wątku i odpowiedzi.
CREATE OR REPLACE FUNCTION public.club_post_comment_delete(p_comment_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_comment public.club_post_comments%ROWTYPE;
  v_group   uuid;
  v_caps    record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_comment FROM public.club_post_comments pc
   WHERE pc.id = p_comment_id FOR UPDATE;
  IF NOT FOUND OR v_comment.status = 'deleted' THEN
    RETURN false;
  END IF;

  SELECT po.group_id INTO v_group FROM public.club_posts po WHERE po.id = v_comment.post_id;
  SELECT * INTO v_caps FROM public.club_capabilities(v_comment.club_id, v_group, v_uid);
  IF v_comment.author_id IS DISTINCT FROM v_uid AND NOT COALESCE(v_caps.can_moderate, false) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.club_post_comments pc SET status = 'deleted' WHERE pc.id = p_comment_id;

  IF v_comment.author_id IS DISTINCT FROM v_uid THEN
    INSERT INTO public.club_moderation_log (
      tenant_id, club_id, moderator_id, action, target_type, target_id
    ) VALUES (
      v_comment.tenant_id, v_comment.club_id, v_uid, 'delete', 'post_comment', p_comment_id
    );
  END IF;
  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.club_post_comment_delete(uuid) IS
  'Miękkie usunięcie komentarza wpisu (status deleted). Autor albo moderacja klubu/grupy wpisu; usunięcie cudzego komentarza trafia do club_moderation_log (delete, post_comment). Brak komentarza albo już usunięty = false.';

REVOKE ALL ON FUNCTION public.club_post_comment_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_post_comment_delete(uuid) TO authenticated, service_role;

-- Zatwierdzenie z kolejki premoderacji albo ukrycie komentarza.
--   approve: pending/hidden -> visible;  hide: pending/visible -> hidden.
-- Wyłącznie `can_moderate` w klubie/dziale WPISU (autor nie zatwierdza sam
-- siebie). Brak komentarza, komentarz usunięty albo stan docelowy już
-- osiągnięty -> `false` bez zmiany i bez wpisu w dzienniku - klient czyta to
-- jak „ktoś zrobił to przed tobą" i po prostu odświeża listę.
-- Przejście pending -> visible uruchamia triggery: powiadomienie autora
-- wpisu (sekcja 7) i @wzmianki (20261007100100) - dopiero teraz treść
-- widzą wszyscy czytelnicy wpisu.
CREATE OR REPLACE FUNCTION public.club_post_comment_moderate(
  p_comment_id uuid,
  p_action     text
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_comment public.club_post_comments%ROWTYPE;
  v_group   uuid;
  v_caps    record;
  v_status  text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('approve', 'hide') THEN
    RAISE EXCEPTION 'clubs: invalid moderation action' USING ERRCODE = '22023';
  END IF;

  -- FOR UPDATE: dwóch moderatorów klikających naraz nie zapisze dwóch
  -- wpisów w dzienniku ani dwóch powiadomień - drugi zobaczy stan docelowy.
  SELECT * INTO v_comment FROM public.club_post_comments pc
   WHERE pc.id = p_comment_id FOR UPDATE;
  IF NOT FOUND OR v_comment.status = 'deleted' THEN
    RETURN false;
  END IF;

  SELECT po.group_id INTO v_group FROM public.club_posts po WHERE po.id = v_comment.post_id;
  SELECT * INTO v_caps FROM public.club_capabilities(v_comment.club_id, v_group, v_uid);
  IF NOT COALESCE(v_caps.can_moderate, false) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  v_status := CASE p_action WHEN 'approve' THEN 'visible' ELSE 'hidden' END;
  IF v_comment.status = v_status THEN
    RETURN false;
  END IF;

  UPDATE public.club_post_comments pc SET status = v_status WHERE pc.id = p_comment_id;

  INSERT INTO public.club_moderation_log (
    tenant_id, club_id, moderator_id, action, target_type, target_id
  ) VALUES (
    v_comment.tenant_id, v_comment.club_id, v_uid, p_action, 'post_comment', p_comment_id
  );
  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.club_post_comment_moderate(uuid, text) IS
  'Moderacja komentarza wpisu: approve (pending/hidden -> visible) albo hide (pending/visible -> hidden). Tylko can_moderate klubu/grupy wpisu; wpis w club_moderation_log (post_comment). Brak komentarza, usunięty albo bez zmiany = false. Zatwierdzenie z kolejki powiadamia autora wpisu i wzmiankowanych.';

REVOKE ALL ON FUNCTION public.club_post_comment_moderate(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_post_comment_moderate(uuid, text)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6) club_posts_list: + comment_count, + can_comment
--
-- Ciało przeniesione z 20260809093335 (jedyna definicja - żadna późniejsza
-- migracja go nie łatała). Dochodzą dwie kolumny:
--   * comment_count - komentarze `visible` wpisu (pending nie podbija licznika,
--     bo pozostali czytelnicy go nie widzą);
--   * can_comment - `can_reply` wołającego w klubie/grupie KAŻDEGO wpisu, nie
--     w filtrze listy: strumień całego klubu miesza wpisy z różnych grup,
--     a zamrożona grupa ma być tylko do odczytu także w strumieniu.
-- oraz jedna poprawka odczytu: strumień całego klubu (`p_group_id` NULL)
-- sprawdzał wyłącznie prawo do KLUBU, więc pokazywał wpisy z działów
-- roboczych, jeszcze nieotwartych i zamkniętych dla osób spoza klubu -
-- z licznikiem komentarzy, których `club_post_comments_list` (prawo działu)
-- potem nie oddawała. Teraz wpis przechodzi przez `can_read` SWOJEGO działu,
-- zanim trafi na stronę i do `total_count`. Zdolności liczymy raz na dział
-- klubu (`gcap`), nie raz na wiersz; ten sam wynik daje `can_comment`.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.club_posts_list(uuid, uuid, uuid, integer, timestamptz);
CREATE FUNCTION public.club_posts_list(
  p_club_id uuid,
  p_group_id uuid DEFAULT NULL,
  p_thread_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_cursor timestamptz DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  club_id uuid,
  group_id uuid,
  group_name_pl text,
  group_name_en text,
  thread_id uuid,
  thread_slug text,
  thread_title text,
  author_id uuid,
  author_name text,
  author_avatar text,
  author_slug text,
  body text,
  attachments jsonb,
  like_count integer,
  comment_count bigint,
  liked_by_me boolean,
  can_manage boolean,
  can_comment boolean,
  created_at timestamptz,
  edited_at timestamptz,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH cap AS (
    SELECT * FROM public.club_capabilities(p_club_id, p_group_id, auth.uid())
  ),
  -- Ściana klubu (gid NULL) i każdy dział, z którego mogą pochodzić wpisy.
  gcap AS (
    SELECT gs.gid, cc.can_read, cc.can_reply
      FROM (SELECT NULL::uuid AS gid WHERE p_group_id IS NULL
            UNION ALL
            SELECT g.id FROM public.club_groups g
             WHERE g.club_id = p_club_id
               AND (p_group_id IS NULL OR g.id = p_group_id)) gs
      CROSS JOIN LATERAL public.club_capabilities(p_club_id, gs.gid, auth.uid()) cc
  ),
  visible AS (
    SELECT po.*, gc.can_reply AS g_can_reply
      FROM public.club_posts po
      CROSS JOIN cap
      JOIN gcap gc ON gc.gid IS NOT DISTINCT FROM po.group_id
     WHERE po.club_id = p_club_id
       AND cap.can_read
       AND COALESCE(gc.can_read, false)
       AND po.status = 'published'
       AND (p_group_id IS NULL OR po.group_id = p_group_id)
       AND (p_thread_id IS NULL OR po.thread_id = p_thread_id)
  ),
  page AS (
    SELECT v.* FROM visible v
     WHERE p_cursor IS NULL OR v.created_at < p_cursor
     ORDER BY v.created_at DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
  )
  SELECT
    v.id, v.club_id, v.group_id, g.name_pl, g.name_en,
    v.thread_id, t.slug, t.title,
    v.author_id,
    COALESCE(NULLIF(btrim(p.display_name), ''),
             NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'User'),
    CASE WHEN p.hide_avatar THEN NULL ELSE p.avatar_url END,
    p.slug,
    v.body, v.attachments, v.like_count,
    (SELECT count(*) FROM public.club_post_comments pc
      WHERE pc.post_id = v.id AND pc.status = 'visible'),
    EXISTS (SELECT 1 FROM public.club_post_likes l
             WHERE l.post_id = v.id AND l.user_id = auth.uid()),
    (auth.uid() IS NOT NULL
     AND (v.author_id = auth.uid() OR (SELECT cap.can_moderate FROM cap))),
    (auth.uid() IS NOT NULL AND COALESCE(v.g_can_reply, false)),
    v.created_at, v.edited_at,
    (SELECT count(*) FROM visible)
  FROM page v
  LEFT JOIN public.profiles p ON p.id = v.author_id
  LEFT JOIN public.club_groups g ON g.id = v.group_id
  LEFT JOIN public.club_threads t ON t.id = v.thread_id
  ORDER BY v.created_at DESC
$$;

COMMENT ON FUNCTION public.club_posts_list(uuid, uuid, uuid, integer, timestamptz) IS
  'Wpisy ściany klubu (najnowsze pierwsze, kursor po created_at); każdy wpis tylko przy can_read wołającego w SWOIM dziale. comment_count = komentarze visible; can_comment = can_reply wołającego w klubie/grupie wpisu (anon: false).';

REVOKE ALL ON FUNCTION public.club_posts_list(uuid, uuid, uuid, integer, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_posts_list(uuid, uuid, uuid, integer, timestamptz)
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7) Powiadomienie autora wpisu
--
-- Wzorzec `club_replies_notify` (A8): wyłącznie gdy komentarz STAJE SIĘ
-- widoczny po raz pierwszy - INSERT jako visible albo zatwierdzenie
-- z kolejki (pending -> visible) - bez samopowiadomienia (`club_notify`).
-- Odsłonięcie komentarza ukrytego przez moderację (hidden -> visible) NIE
-- powiadamia: autor wpisu dostał już sygnał przy pierwszej publikacji.
-- Różnice, świadome:
--   * w trybie chatham tytuł nie niesie nazwiska - pseudonim w liście jest
--     per wpis, więc nawet on nie trafia do skrzynki;
--   * adresat musi nadal móc CZYTAĆ klub (`club_user_can_read`): autor, który
--     odszedł z klubu prywatnego albo dostał bana, nie dostaje wycinka treści;
--   * awaria powiadomienia nigdy nie wywraca zapisu komentarza.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_post_comments_notify()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx     record;
  v_href    text;
  v_name    text;
  v_who_pl  text;
  v_who_en  text;
  v_excerpt text;
BEGIN
  IF NEW.status <> 'visible' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'pending' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_ctx FROM public.club_post_seam_context(NEW.post_id);
  IF NOT FOUND OR v_ctx.post_status <> 'published' OR v_ctx.post_author_id IS NULL
     OR v_ctx.post_author_id = NEW.author_id THEN
    RETURN NULL;
  END IF;
  IF NOT public.club_user_can_read(v_ctx.club_id, v_ctx.group_id, v_ctx.post_author_id) THEN
    RETURN NULL;
  END IF;

  v_href := '/club/' || v_ctx.club_slug || '?post=' || NEW.post_id::text;

  IF v_ctx.hide_actor THEN
    v_who_pl := 'Uczestnik dyskusji';
    v_who_en := 'A participant';
  ELSE
    SELECT NULLIF(btrim(p.display_name), '') INTO v_name
      FROM public.profiles p WHERE p.id = NEW.author_id;
    v_who_pl := COALESCE(v_name, 'Ktoś');
    v_who_en := COALESCE(v_name, 'Someone');
  END IF;

  v_excerpt := regexp_replace(btrim(NEW.body), '\s+', ' ', 'g');
  IF char_length(v_excerpt) > 140 THEN
    v_excerpt := left(v_excerpt, 139) || '…';
  END IF;

  PERFORM public.club_notify(
    v_ctx.post_author_id, NEW.author_id,
    v_who_pl || ' skomentował(a) Twój wpis', v_who_en || ' commented on your post',
    v_excerpt, v_excerpt, v_href);

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.club_post_comments_notify() IS
  'Komentarz widoczny od razu albo zatwierdzony z kolejki (pending -> visible) -> powiadomienie autora wpisu (club_notify, bez samopowiadomienia). Odsłonięcie ukrytego nie powiadamia. W trybie chatham bez nazwiska; adresat musi móc czytać klub.';

REVOKE ALL ON FUNCTION public.club_post_comments_notify() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS club_post_comments_notify_tg ON public.club_post_comments;
CREATE TRIGGER club_post_comments_notify_tg
  AFTER INSERT OR UPDATE OF status ON public.club_post_comments
  FOR EACH ROW EXECUTE FUNCTION public.club_post_comments_notify();
