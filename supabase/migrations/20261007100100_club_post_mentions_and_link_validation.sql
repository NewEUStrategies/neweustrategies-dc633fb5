-- ============================================================================
-- WPISY I KOMENTARZE ŚCIANY: @wzmianki, bramka odbiorców, podpowiedzi
-- członków klubu i walidacja załączników-linków
--
-- Ciąg dalszy 20261007100000 (komentarze wpisów). Pięć zmian:
--
-- 1) BRAMKA ODBIORCÓW WZMIANKI PYTAŁA O AUTORA, NIE O ODBIORCĘ
--
--    `club_mention_visible_to` (A22) miało nie wpuszczać powiadomienia do osoby,
--    która nie może czytać treści klubu prywatnego. Liczyło to przez
--    `club_capabilities(klub, grupa, odbiorca)` - a ta funkcja od A8 ma osłonę
--    przed sondowaniem cudzych uprawnień: `_user_id` różny od wołającego jest
--    podmieniany na `auth.uid()`, o ile wołający nie jest administratorem
--    klubów. `process_mentions` biegnie w triggerze, w sesji AUTORA, więc
--    bramka sprawdzała prawo autora do czytania jego własnego klubu i zawsze
--    przepuszczała. Teraz liczy prawo ODBIORCY przez `club_user_can_read`
--    (20261007100000) - dla wszystkich źródeł klubowych, bo to jedna reguła
--    i jedna kopia (A22, par. 7 specyfikacji: rozjazd kopii tej samej reguły
--    jest najbardziej prawdopodobnym sposobem wycieku tego modułu).
--    Nowe źródła: `club_post` i `club_post_comment` (klub i grupa z wpisu).
--
-- 2) WPISY I KOMENTARZE ŚCIANY NIE POWIADAMIAŁY O WZMIANKACH
--
--    `parse.ts` obiecuje, że `@slug` w treści jest powiadomieniem, a na ścianie
--    klubu był tylko linkiem. Dwa triggery dokładają `process_mentions`
--    (adres `/club/<klub>?post=<wpis>`, który strumień otwiera na karcie
--    wpisu). Komentarz w trybie chatham idzie bez aktora - 1:1
--    z `tg_club_replies_seams` (etykieta 'Uczestnik dyskusji',
--    `p_record_actor = false`, zdarzenie z `p_suppress_actor`). Klub `secret`
--    nie emituje nic (doktryna `club_thread_seam_context`). Komentarz
--    w kolejce premoderacji nie wzmiankuje nikogo, dopóki moderacja go nie
--    zatwierdzi - inaczej powiadomienie prowadziłoby do treści, której
--    adresat nie zobaczy, a moderacja nie mogłaby go już cofnąć.
--
--    Wpis ściany powiadamia teraz do dziesięciu osób, więc `club_post_create`
--    dostaje limity tempa jak wątki, odpowiedzi i komentarze: 30 wpisów na
--    dobę i 10 na minutę na autora (deduplikacja `enqueue_notification` po
--    adresie nic tu nie daje - każdy wpis ma własny adres).
--
-- 3) PODPOWIEDZI @ NIE ZNAŁY ZWYKŁYCH CZŁONKÓW KLUBU
--
--    `search_mention_targets` celowo podpowiada tylko osoby z publicznym
--    śladem redakcyjnym. W klubie rozmawia się jednak z członkami, więc
--    `club_mention_members` podpowiada aktywnych, odnajdywalnych członków -
--    za tą samą bramką, co lista członków (`can_see_members`), i w tym samym
--    kształcie wiersza, co `search_mention_targets`.
--
-- 4) ZAŁĄCZNIK-LINK WPISU NIE BYŁ WALIDOWANY
--
--    `club_post_create` sprawdzało tylko, że załączniki są tablicą do 10
--    elementów. Element `{type:'link'}` mógł nieść dowolny `url` i `image`
--    (`data:`, piksel śledzący, `http:`). Teraz idzie przez tę samą
--    normalizację, co migawka linku komentarza, a typ elementu musi być
--    DOKŁADNIE jednym ze znanych klientowi - inaczej `'link '` ze spacją
--    omijał walidację, a klient po przycięciu typu i tak rysował kartę linku.
--
-- 5) GOŚĆ CZYTAŁ KAŻDY DZIAŁ KLUBU PUBLICZNEGO
--
--    Gałąź gościa w `club_capabilities` odpowiadała `can_read = true` dla
--    klubu publicznego, zanim w ogóle zajrzała do działu - więc dział roboczy,
--    jeszcze nieotwarty albo zamknięty dla niezalogowanych (widoczność
--    'members', 'private', 'secret') był dla gościa otwarty: wątki,
--    odpowiedzi i wpisy ściany, a od 20261007100000 także komentarze
--    z nazwiskami autorów. Zalogowana osoba spoza klubu dostawała w tym samym
--    miejscu odmowę.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Bramka odbiorców wzmianki
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
  -- Źródła spoza modułu klubów nie mają tu czego rozstrzygać: `comments`,
  -- `messages` i `crm_lead_notes` rządzą się własnymi regułami i ta funkcja
  -- ich nie dotyka.
  IF p_source_type NOT IN ('club_thread', 'club_reply', 'club_post', 'club_post_comment') THEN
    RETURN true;
  END IF;
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF p_source_type = 'club_thread' THEN
    SELECT t.club_id, t.group_id INTO v_club, v_group
      FROM public.club_threads t WHERE t.id = p_source_id::uuid;
  ELSIF p_source_type = 'club_reply' THEN
    SELECT r.club_id, t.group_id INTO v_club, v_group
      FROM public.club_replies r
      JOIN public.club_threads t ON t.id = r.thread_id
     WHERE r.id = p_source_id::uuid;
  ELSIF p_source_type = 'club_post' THEN
    SELECT po.club_id, po.group_id INTO v_club, v_group
      FROM public.club_posts po WHERE po.id = p_source_id::uuid;
  ELSE
    SELECT pc.club_id, po.group_id INTO v_club, v_group
      FROM public.club_post_comments pc
      JOIN public.club_posts po ON po.id = pc.post_id
     WHERE pc.id = p_source_id::uuid;
  END IF;

  IF v_club IS NULL THEN
    RETURN false;
  END IF;

  -- Prawo do czytania ODBIORCY - patrz punkt 1 nagłówka. Wzmianka nie ma
  -- prawa dotrzeć dalej, niż sięga prawo do czytania treści.
  RETURN public.club_user_can_read(v_club, v_group, p_user_id);
EXCEPTION WHEN OTHERS THEN
  -- Przy wątpliwości NIE powiadamiamy. Błąd w tę stronę kosztuje jedno
  -- niedostarczone powiadomienie; błąd w drugą - ujawnienie istnienia klubu.
  RETURN false;
END;
$$;

COMMENT ON FUNCTION public.club_mention_visible_to(text, text, uuid) IS
  'Czy wskazana osoba może dostać powiadomienie o wzmiance w tym źródle. Dla źródeł klubowych (club_thread, club_reply, club_post, club_post_comment) liczy prawo ODBIORCY do czytania (club_user_can_read) - nie wołającego. Dla pozostałych źródeł zawsze true.';

REVOKE ALL ON FUNCTION public.club_mention_visible_to(text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_mention_visible_to(text, text, uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 2a) Szwy komentarza wpisu: wzmianki + zdarzenie na szynie
--
-- Wzmianki dopiero wtedy, gdy treść widzą wszyscy czytelnicy wpisu: przy
-- INSERT jako `visible` albo przy zatwierdzeniu z kolejki (pending ->
-- visible). Odsłonięcie komentarza ukrytego (hidden -> visible) nie
-- powtarza wzmianek - zostały wysłane przy pierwszej publikacji.
-- Zdarzenie `club_post_comment.created.v1` niesie status i powstaje RAZ,
-- przy INSERT: odbiorca szyny odświeża po nim listę komentarzy wpisu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_club_post_comments_seams()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx  record;
  v_href text;
BEGIN
  SELECT * INTO v_ctx FROM public.club_post_seam_context(NEW.post_id);
  IF NOT FOUND OR NOT v_ctx.emit THEN
    RETURN NEW;
  END IF;

  v_href := '/club/' || v_ctx.club_slug || '?post=' || NEW.post_id::text;

  IF NEW.status = 'visible'
     AND v_ctx.post_status = 'published'
     AND (TG_OP = 'INSERT' OR OLD.status = 'pending') THEN
    PERFORM public.process_mentions(
      NEW.tenant_id, 'club_post_comment', NEW.id::text, NEW.body,
      NEW.author_id, 'club', v_href,
      CASE WHEN v_ctx.hide_actor THEN 'Uczestnik dyskusji' ELSE NULL END,
      NOT v_ctx.hide_actor
    );
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'club_post_comment', NEW.id::text, 'club_post_comment.created.v1',
      jsonb_build_object(
        'club_id', v_ctx.club_id, 'post_id', NEW.post_id, 'status', NEW.status
      ),
      p_suppress_actor => v_ctx.hide_actor
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Awaria szyny ani wzmianek nie może wywrócić zapisu komentarza.
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_club_post_comments_seams() IS
  'Komentarz wpisu widoczny od razu albo zatwierdzony z kolejki -> process_mentions (bramka odbiorców club_mention_visible_to); INSERT -> club_post_comment.created.v1. W trybie chatham bez aktora, w klubie secret nic.';

DROP TRIGGER IF EXISTS club_post_comments_seams_tg ON public.club_post_comments;
CREATE TRIGGER club_post_comments_seams_tg
  AFTER INSERT OR UPDATE OF status ON public.club_post_comments
  FOR EACH ROW EXECUTE FUNCTION public.tg_club_post_comments_seams();

-- ----------------------------------------------------------------------------
-- 2b) Wzmianki w nowym wpisie ściany
--
-- Autor wpisu jest jawny w `club_posts_list` w każdym trybie atrybucji, więc
-- powiadomienie o wzmiance podpisuje go tak samo - ukrywanie tu ujawnionego
-- wyżej nazwiska niczego by nie chroniło.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_club_posts_mentions()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx record;
BEGIN
  IF NEW.status <> 'published' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_ctx FROM public.club_post_seam_context(NEW.id);
  IF NOT FOUND OR NOT v_ctx.emit THEN
    RETURN NEW;
  END IF;

  PERFORM public.process_mentions(
    NEW.tenant_id, 'club_post', NEW.id::text, NEW.body,
    NEW.author_id, 'club', '/club/' || v_ctx.club_slug || '?post=' || NEW.id::text,
    NULL, true
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_club_posts_mentions() IS
  'Nowy wpis ściany -> process_mentions z adresem /club/<klub>?post=<wpis> (bramka odbiorców club_mention_visible_to). Klub secret nie emituje.';

DROP TRIGGER IF EXISTS club_posts_mentions_tg ON public.club_posts;
CREATE TRIGGER club_posts_mentions_tg
  AFTER INSERT ON public.club_posts
  FOR EACH ROW EXECUTE FUNCTION public.tg_club_posts_mentions();

-- ----------------------------------------------------------------------------
-- 3) Podpowiedzi @: członkowie klubu
--
-- Ten sam kształt wiersza, co `search_mention_targets`, żeby klient scalał
-- obie listy bez mapowania. Dopasowanie przez `starts_with`/`strpos`, nie
-- LIKE - fraza nie jest wzorcem (`%`, `_` trafiają dosłownie). Kolejność:
-- najpierw trafienia od początku imienia/sluga, potem od początku słowa,
-- potem w środku; w każdej grupie alfabetycznie. Pusta fraza (samo `@`) to
-- po prostu lista alfabetyczna.
--
-- DLACZEGO BEZ „OSTATNIO OBECNYCH". `club_members.last_read_at` to prywatny
-- stan czytania - widzi go administracja i sam członek. Bramka
-- `can_see_members` wpuszcza tu w klubie publicznym każdego zalogowanego,
-- więc kolejność po tej kolumnie byłaby potwierdzeniem odczytu dla obcych.
-- Aktywność autorska też odpada: w klubach chatham i z anonimowością
-- wiązałaby nieopisane wypowiedzi z ich autorami.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_mention_members(
  p_club_id uuid,
  p_q       text DEFAULT NULL,
  p_limit   integer DEFAULT 6
)
RETURNS TABLE (
  kind text, id uuid, slug text, label text, subtitle text,
  avatar_url text, logo_url text, website text, verified boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH cap AS (
    SELECT cc.can_see_members
      FROM public.club_capabilities(p_club_id, NULL, auth.uid()) cc
  ),
  q AS (
    SELECT NULLIF(lower(btrim(ltrim(btrim(COALESCE(p_q, '')), '@'))), '') AS v
  ),
  members AS (
    SELECT
      p.id,
      p.slug,
      COALESCE(NULLIF(btrim(p.display_name), ''),
               NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
               p.slug) AS label,
      COALESCE(NULLIF(btrim(p.job_title), ''), NULLIF(btrim(p.current_company), '')) AS subtitle,
      CASE WHEN p.hide_avatar THEN NULL ELSE p.avatar_url END AS avatar_url,
      (p.verified_at IS NOT NULL) AS verified
    FROM public.club_members m
    JOIN public.clubs c ON c.id = m.club_id
    JOIN public.profiles p ON p.id = m.user_id
    CROSS JOIN cap
    WHERE m.club_id = p_club_id
      AND cap.can_see_members
      AND m.status = 'active'
      AND p.tenant_id = c.tenant_id
      AND p.discoverable
      AND NULLIF(btrim(COALESCE(p.slug, '')), '') IS NOT NULL
      AND m.user_id IS DISTINCT FROM auth.uid()
  ),
  scored AS (
    SELECT mb.*,
      CASE
        WHEN q.v IS NULL THEN 0
        WHEN starts_with(lower(mb.label), q.v) OR starts_with(lower(mb.slug), q.v) THEN 0
        WHEN strpos(' ' || lower(mb.label), ' ' || q.v) > 0 THEN 1
        ELSE 2
      END AS rank
    FROM members mb
    CROSS JOIN q
    WHERE q.v IS NULL
       OR strpos(lower(mb.label), q.v) > 0
       OR strpos(lower(mb.slug), q.v) > 0
  )
  SELECT 'person'::text, s.id, s.slug, s.label, s.subtitle, s.avatar_url,
         NULL::text, NULL::text, s.verified
    FROM scored s
   ORDER BY s.rank ASC, lower(s.label) ASC, s.id ASC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 6), 1), 20)
$$;

COMMENT ON FUNCTION public.club_mention_members(uuid, text, integer) IS
  'Podpowiedzi @ z członków klubu: aktywni, odnajdywalni, ze slugiem, bez wołającego; bramka can_see_members. Kształt wiersza jak search_mention_targets (kind person). Dopasowanie starts_with/strpos, nie LIKE; kolejność: trafienie od początku, potem alfabetycznie (bez last_read_at - prywatny stan czytania).';

REVOKE ALL ON FUNCTION public.club_mention_members(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_mention_members(uuid, text, integer)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4) club_post_create: walidacja załączników i limity tempa
--
-- Ciało przeniesione z 20260809093335 (jedyna definicja); dochodzą:
--   * pętla po elementach: element musi być obiektem z typem DOKŁADNIE
--     'link', 'image', 'video' albo 'file' (`ClubPostAttachment` klienta).
--     Biała lista, nie porównanie z 'link': klient przycina typ przed
--     odczytem, więc `' link'` albo `'link\n'` omijały walidację serwera
--     i lądowały na ekranie jako karta linku z dowolnym adresem. Element
--     linku jest przepisywany do postaci kanonicznej (typ + pięć kluczy),
--     więc obce klucze nie trafiają do bazy; pozostałe typy - bez zmian;
--   * limity tempa (30 / 24 h, 10 / min na autora) z blokadą doradczą, jak
--     `club_post_comment_create` - wpis z @wzmiankami powiadamia do
--     dziesięciu osób, a bez limitu pętla wywołań nie miałaby końca. Limit
--     liczy wpisy w każdym statusie: usunięcie wpisu nie zwraca przydziału.
-- Komunikaty błędów `club_post_create: ...` zostają, bo klient mapuje je po
-- treści; nowe błędy mają brzmienie z kontraktu (`clubs: invalid link
-- attachment`, `clubs: post rate limit`, `clubs: post burst limit`).
-- ----------------------------------------------------------------------------
-- Limity liczone po autorze - bez indeksu każdy wpis skanowałby tabelę.
CREATE INDEX IF NOT EXISTS club_posts_author_recent_idx
  ON public.club_posts (author_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.club_post_create(
  p_club_id uuid,
  p_group_id uuid DEFAULT NULL,
  p_thread_id uuid DEFAULT NULL,
  p_body text DEFAULT '',
  p_attachments jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE(post_id uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caps record;
  v_body text := btrim(COALESCE(p_body, ''));
  v_att jsonb := COALESCE(p_attachments, '[]'::jsonb);
  v_norm jsonb := '[]'::jsonb;
  v_el jsonb;
  v_link jsonb;
  v_recent integer;
  v_burst integer;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'club_post_create: unauthenticated' USING ERRCODE = '42501';
  END IF;

  -- Serializacja limitów per autor (wzorzec `club_reply`): równoległe
  -- wywołania stają w kolejce zamiast czytać ten sam licznik.
  PERFORM pg_advisory_xact_lock(hashtext('club_post_create:' || auth.uid()::text));

  SELECT * INTO v_caps FROM public.club_capabilities(p_club_id, p_group_id, auth.uid());
  IF NOT COALESCE(v_caps.can_reply, false) THEN
    RAISE EXCEPTION 'club_post_create: forbidden' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(v_att) <> 'array' THEN
    v_att := '[]'::jsonb;
  END IF;
  IF jsonb_array_length(v_att) > 10 THEN
    RAISE EXCEPTION 'club_post_create: too many attachments' USING ERRCODE = '22023';
  END IF;

  FOR v_el IN
    SELECT e.value FROM jsonb_array_elements(v_att) WITH ORDINALITY AS e(value, ord)
     ORDER BY e.ord
  LOOP
    IF jsonb_typeof(v_el) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_el->'type') IS DISTINCT FROM 'string'
       OR (v_el->>'type') NOT IN ('link', 'image', 'video', 'file') THEN
      RAISE EXCEPTION 'club_post_create: invalid attachment' USING ERRCODE = '22023';
    END IF;
    IF v_el->>'type' = 'link' THEN
      v_link := public.club_link_snapshot_normalize(v_el);
      IF v_link IS NULL THEN
        RAISE EXCEPTION 'clubs: invalid link attachment' USING ERRCODE = '22023';
      END IF;
      v_el := jsonb_build_object('type', 'link') || v_link;
    END IF;
    v_norm := v_norm || jsonb_build_array(v_el);
  END LOOP;
  v_att := v_norm;

  IF v_body = '' AND jsonb_array_length(v_att) = 0 THEN
    RAISE EXCEPTION 'club_post_create: empty post' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_body) > 6000 THEN
    RAISE EXCEPTION 'club_post_create: body too long' USING ERRCODE = '22023';
  END IF;

  IF p_thread_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.club_threads t
     WHERE t.id = p_thread_id AND t.club_id = p_club_id
  ) THEN
    RAISE EXCEPTION 'club_post_create: thread not in club' USING ERRCODE = '22023';
  END IF;

  IF p_group_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.club_groups g
     WHERE g.id = p_group_id AND g.club_id = p_club_id
  ) THEN
    RAISE EXCEPTION 'club_post_create: group not in club' USING ERRCODE = '22023';
  END IF;

  SELECT count(*)::int INTO v_recent FROM public.club_posts po
   WHERE po.author_id = auth.uid() AND po.created_at > now() - interval '24 hours';
  IF v_recent >= 30 THEN
    RAISE EXCEPTION 'clubs: post rate limit' USING ERRCODE = '42901';
  END IF;
  SELECT count(*)::int INTO v_burst FROM public.club_posts po
   WHERE po.author_id = auth.uid() AND po.created_at > now() - interval '1 minute';
  IF v_burst >= 10 THEN
    RAISE EXCEPTION 'clubs: post burst limit' USING ERRCODE = '42901';
  END IF;

  INSERT INTO public.club_posts (club_id, group_id, thread_id, author_id, body, attachments, tenant_id)
  SELECT p_club_id, p_group_id, p_thread_id, auth.uid(), v_body, v_att, c.tenant_id
    FROM public.clubs c WHERE c.id = p_club_id
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id;
END;
$$;

COMMENT ON FUNCTION public.club_post_create(uuid, uuid, uuid, text, jsonb) IS
  'Nowy wpis ściany. Załączniki: tablica do 10 obiektów typu link/image/video/file (inny typ: club_post_create: invalid attachment); element type=link normalizowany do {type, url, title, description, image, siteName} (tylko https), inaczej clubs: invalid link attachment. Limity: 30/24 h (clubs: post rate limit) i 10/min (clubs: post burst limit) na autora.';

REVOKE ALL ON FUNCTION public.club_post_create(uuid, uuid, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_post_create(uuid, uuid, uuid, text, jsonb) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5) club_capabilities: gość a dział klubu publicznego
--
-- Ciało przeniesione 1:1 z 20260812091500 (ostatnia definicja); zmienia się
-- WYŁĄCZNIE gałąź gościa (`_user_id` NULL) - patrz punkt 5 nagłówka.
-- Gałąź zalogowanych i `club_user_can_read` (20261007100000) bez zmian.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_capabilities(_club_id uuid, _group_id uuid DEFAULT NULL::uuid, _user_id uuid DEFAULT auth.uid())
 RETURNS TABLE(can_read boolean, can_post_thread boolean, can_reply boolean, can_react boolean, can_moderate boolean, can_manage boolean, can_invite boolean, can_see_members boolean, can_reveal_author boolean, effective_role text, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_club        public.clubs%ROWTYPE;
  v_group       public.club_groups%ROWTYPE;
  v_member      public.club_members%ROWTYPE;
  v_caller      uuid := auth.uid();
  v_is_admin    boolean;
  v_is_editor   boolean;
  v_is_staff    boolean;
  v_home_tenant uuid;
  v_role        text;
  v_visibility  text;
  v_who_can_post text;
  v_min_tier    integer;
  v_reason      text := NULL;
  v_read        boolean := false;
  v_group_open  boolean := true;
  v_group_visible boolean := true;
BEGIN
  SELECT * INTO v_club FROM public.clubs c WHERE c.id = _club_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                        'non_member'::text, 'not_found'::text;
    RETURN;
  END IF;
  IF _user_id IS DISTINCT FROM v_caller
     AND NOT (public.is_club_admin(v_caller) AND v_club.tenant_id = public.current_tenant_id())
  THEN
    _user_id := v_caller;
  END IF;
  v_is_admin  := public.is_club_admin(_user_id);
  v_is_staff  := public.is_nes_staff(_user_id);
  v_is_editor := _user_id IS NOT NULL AND (public.has_role(_user_id, 'editor') OR v_is_staff);
  SELECT p.tenant_id INTO v_home_tenant FROM public.profiles p WHERE p.id = _user_id;
  IF _user_id IS NULL THEN
    IF v_club.visibility IS DISTINCT FROM 'public' OR v_club.status IS DISTINCT FROM 'active'
       OR v_club.tenant_id IS DISTINCT FROM public.public_tenant_id() THEN
      RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                          'non_member'::text, 'auth_required'::text;
      RETURN;
    END IF;
    -- Dział klubu publicznego: te same stany co niżej dla zalogowanego spoza
    -- klubu (szkic i okno przed `opens_at` - działu jeszcze nie ma), a każda
    -- własna widoczność działu ('members', 'private', 'secret') i własny
    -- próg planu wymagają zalogowania. Bez tego gość czytał dział, którego
    -- zalogowany nieczłonek nie widzi (20261007100100, punkt 5).
    IF _group_id IS NOT NULL THEN
      SELECT * INTO v_group FROM public.club_groups g
       WHERE g.id = _group_id AND g.club_id = _club_id;
      IF NOT FOUND THEN
        RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                            'non_member'::text, 'not_found'::text;
        RETURN;
      END IF;
      IF v_group.status = 'draft'
         OR (v_group.status NOT IN ('archived', 'frozen')
             AND v_group.opens_at IS NOT NULL AND v_group.opens_at > now()) THEN
        RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                            'non_member'::text, 'not_open_yet'::text;
        RETURN;
      END IF;
      IF v_group.visibility IS NOT NULL OR COALESCE(v_group.min_tier_rank, 0) > 0 THEN
        RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                            'non_member'::text, 'auth_required'::text;
        RETURN;
      END IF;
    END IF;
    RETURN QUERY SELECT true, false, false, false, false, false, false, false, false,
                        'non_member'::text, NULL::text;
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
  IF v_club.visibility = 'secret' AND v_role = 'non_member' AND NOT v_is_admin AND NOT v_is_staff THEN
    RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                        'non_member'::text, 'not_found'::text;
    RETURN;
  END IF;
  IF v_club.status <> 'active' AND NOT v_is_admin AND NOT v_is_staff THEN
    RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                        v_role,
                        CASE WHEN v_club.status = 'draft' THEN 'not_open_yet' ELSE 'archived' END;
    RETURN;
  END IF;
  v_visibility   := COALESCE(v_group.visibility, v_club.visibility);
  v_who_can_post := COALESCE(v_group.who_can_post, v_club.who_can_post);
  v_min_tier     := COALESCE(v_group.min_tier_rank, v_club.min_tier_rank);
  IF _group_id IS NOT NULL AND NOT v_is_admin AND NOT v_is_staff THEN
    IF v_group.status IN ('draft', 'archived') THEN
      v_group_open := false;
      v_group_visible := v_group.status <> 'draft';
      v_reason := CASE WHEN v_group.status = 'draft' THEN 'not_open_yet' ELSE 'archived' END;
    ELSIF v_group.status = 'frozen' THEN
      v_group_open := false;
      v_reason := 'group_frozen';
    ELSIF v_group.opens_at IS NOT NULL AND v_group.opens_at > now() THEN
      v_group_open := false;
      v_group_visible := false;
      v_reason := 'not_open_yet';
    ELSIF v_group.closes_at IS NOT NULL AND v_group.closes_at <= now() THEN
      v_group_open := false;
      v_reason := 'window_closed';
    END IF;
  END IF;
  IF v_min_tier > 0 AND NOT v_is_admin AND NOT v_is_staff AND v_role = 'non_member' THEN
    IF _user_id = v_caller THEN
      IF NOT public.has_tier_rank(v_min_tier) THEN
        RETURN QUERY SELECT false, false, false, false, false, false, false, false, false,
                            v_role, 'tier_too_low'::text;
        RETURN;
      END IF;
    ELSE
      v_reason := COALESCE(v_reason, 'tier_unknown');
    END IF;
  END IF;
  v_read := CASE
    WHEN v_is_admin OR v_is_staff THEN true
    WHEN NOT v_group_visible THEN false
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
      ELSE v_is_staff
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
$function$;

COMMENT ON FUNCTION public.club_capabilities(uuid, uuid, uuid) IS
  'JEDYNE zrodlo prawdy o dostepie. Grupa draft/archived zeruje can_read, nie tylko can_post - inaczej tresc grupy roboczej wychodzila przez widok watku, liste odpowiedzi i wyszukiwarke. Gosc czyta dzial klubu publicznego tylko bez wlasnej widocznosci i progu planu, poza szkicem i oknem przed opens_at. Parametr _user_id honorowany wylacznie dla samego siebie albo dla admina TEGO tenanta.';

REVOKE EXECUTE ON FUNCTION public.club_capabilities(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_capabilities(uuid, uuid, uuid)
  TO anon, authenticated, service_role;
