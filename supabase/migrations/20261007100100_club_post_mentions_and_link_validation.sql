-- ============================================================================
-- WPISY I KOMENTARZE ŚCIANY: @wzmianki, bramka odbiorców, podpowiedzi
-- członków klubu i walidacja załączników-linków
--
-- Ciąg dalszy 20261007100000 (komentarze wpisów). Cztery zmiany:
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
--    klubu był tylko linkiem. Dwa triggery AFTER INSERT dokładają
--    `process_mentions` (adres `/club/<klub>?post=<wpis>`, który strumień
--    otwiera na karcie wpisu). Komentarz w trybie chatham idzie bez aktora -
--    1:1 z `tg_club_replies_seams` (etykieta 'Uczestnik dyskusji',
--    `p_record_actor = false`, zdarzenie z `p_suppress_actor`). Klub `secret`
--    nie emituje nic (doktryna `club_thread_seam_context`).
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
--    normalizację, co migawka linku komentarza.
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

  PERFORM public.process_mentions(
    NEW.tenant_id, 'club_post_comment', NEW.id::text, NEW.body,
    NEW.author_id, 'club', v_href,
    CASE WHEN v_ctx.hide_actor THEN 'Uczestnik dyskusji' ELSE NULL END,
    NOT v_ctx.hide_actor
  );

  PERFORM public.emit_domain_event(
    NEW.tenant_id, 'club_post_comment', NEW.id::text, 'club_post_comment.created.v1',
    jsonb_build_object(
      'club_id', v_ctx.club_id, 'post_id', NEW.post_id, 'status', NEW.status
    ),
    p_suppress_actor => v_ctx.hide_actor
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Awaria szyny ani wzmianek nie może wywrócić zapisu komentarza.
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_club_post_comments_seams() IS
  'Nowy komentarz wpisu -> process_mentions (bramka odbiorców club_mention_visible_to) i club_post_comment.created.v1. W trybie chatham bez aktora, w klubie secret nic.';

DROP TRIGGER IF EXISTS club_post_comments_seams_tg ON public.club_post_comments;
CREATE TRIGGER club_post_comments_seams_tg
  AFTER INSERT ON public.club_post_comments
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
-- LIKE - fraza nie jest wzorcem (`%`, `_` trafiają dosłownie). Pusta fraza
-- (samo `@`) podaje ostatnio obecnych, potem alfabetycznie.
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
      (p.verified_at IS NOT NULL) AS verified,
      m.last_read_at
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
   ORDER BY s.rank ASC, s.last_read_at DESC NULLS LAST, lower(s.label) ASC, s.id ASC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 6), 1), 20)
$$;

COMMENT ON FUNCTION public.club_mention_members(uuid, text, integer) IS
  'Podpowiedzi @ z członków klubu: aktywni, odnajdywalni, ze slugiem, bez wołającego; bramka can_see_members. Kształt wiersza jak search_mention_targets (kind person). Dopasowanie starts_with/strpos, nie LIKE.';

REVOKE ALL ON FUNCTION public.club_mention_members(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_mention_members(uuid, text, integer)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4) club_post_create: walidacja załączników-linków
--
-- Ciało przeniesione 1:1 z 20260809093335 (jedyna definicja); dochodzi
-- wyłącznie pętla po elementach `type = 'link'`. Element linku jest
-- przepisywany do postaci kanonicznej (typ + pięć kluczy), więc obce klucze
-- nie trafiają do bazy. Pozostałe typy załączników - bez zmian.
-- Komunikaty błędów `club_post_create: ...` zostają, bo klient mapuje je po
-- treści; nowy błąd ma brzmienie z kontraktu (`clubs: invalid link attachment`).
-- ----------------------------------------------------------------------------
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
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'club_post_create: unauthenticated' USING ERRCODE = '42501';
  END IF;

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
    IF jsonb_typeof(v_el) = 'object' AND v_el->>'type' = 'link' THEN
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

  INSERT INTO public.club_posts (club_id, group_id, thread_id, author_id, body, attachments, tenant_id)
  SELECT p_club_id, p_group_id, p_thread_id, auth.uid(), v_body, v_att, c.tenant_id
    FROM public.clubs c WHERE c.id = p_club_id
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id;
END;
$$;

COMMENT ON FUNCTION public.club_post_create(uuid, uuid, uuid, text, jsonb) IS
  'Nowy wpis ściany. Załączniki: tablica do 10 elementów; element type=link normalizowany do {type, url, title, description, image, siteName} (tylko https), inaczej clubs: invalid link attachment.';

REVOKE ALL ON FUNCTION public.club_post_create(uuid, uuid, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_post_create(uuid, uuid, uuid, text, jsonb) TO authenticated, service_role;
