-- ============================================================================
-- WPISY ŚCIANY: ZAŁĄCZNIK-PLIK TYLKO Z WŁASNEGO KATALOGU AUTORA
--
-- Ciąg dalszy 20261007100100 (punkt 4 - walidacja załączników-linków).
--
-- ZNALEZISKO. `club_post_create` normalizował wyłącznie element `type=link`.
-- Elementy `image`/`video`/`file` szły do bazy tak, jak przysłał je klient -
-- z DOWOLNYM `path`. Polityka odczytu kubełka `club-media` (20260830132031)
-- wpuszcza zaś każdego aktywnego członka klubu, w którego wpisie dana ścieżka
-- występuje jako załącznik (`club_media_path_readable`). Wystarczyło więc
-- opublikować we WŁASNYM klubie wpis z załącznikiem
-- `{"type":"file","path":"<uid ofiary>/<plik>"}`, żeby autor i wszyscy
-- członkowie jego klubu dostali odczyt (podpisany adres, a nawet listowanie
-- `storage.objects`) cudzego pliku - także z klubu prywatnego czy tajnego,
-- do którego nikt z nich nie należy. Ścieżkę wystarczy raz zobaczyć (byłe
-- członkostwo, przekazany link), a dostęp trwa, dopóki stoi wpis napastnika.
--
-- DWIE ZAPORY, BO KAŻDA ZAMYKA INNĄ STRONĘ:
--
-- 1) ZAPIS: `club_post_create` przepuszcza element `image`/`video`/`file`
--    przez `club_post_media_normalize` - dokładnie jak link przez
--    `club_link_snapshot_normalize`. Ścieżka musi mieć postać
--    `<auth.uid()>/<plik>`, czyli tę, którą produkuje `uploadClubPostMedia`
--    i jedyną, którą wolno zapisać polityce INSERT kubełka
--    (`(storage.foldername(name))[1] = auth.uid()::text`). Element dostaje
--    postać kanoniczną klienta (`ClubPostMediaAttachment`: type, path, name,
--    mime, size, width, height) - obce klucze odpadają, a teksty i liczby
--    mają granice, więc jsonb wpisu nie jest już workiem bez dna obok
--    limitu 6000 znaków treści. Odmowa: `clubs: invalid media attachment`.
--
-- 2) ODCZYT: `club_media_path_readable` wiąże ścieżkę z AUTOREM wpisu -
--    pierwszy segment ścieżki (katalog właściciela pliku) musi być
--    `author_id` wpisu, który ją niesie. Bez tego zapora (1) chroniłaby
--    tylko nowe wpisy, a wpisy wstrzyknięte przed tą migracją dalej
--    otwierałyby cudze pliki. Historycznych danych nie przepisujemy: obcy
--    załącznik zostaje w jsonb, ale niczego już nie otwiera (klient dostaje
--    dla niego brak podpisu i pomija podgląd). Przy okazji predykat liczy
--    tylko wpisy `published` - wpis usunięty (`club_post_delete`) nie jest
--    już nigdzie pokazywany, więc nie ma powodu trzymać otwartych jego plików.
--
--    KONTO AUTORA USUNIĘTE. `deleteUser` kasuje `auth.users`, a FK
--    `club_posts.author_id ... ON DELETE SET NULL` zostawia wpis z treścią
--    i załącznikami w strumieniu. Samo `author_id = właściciel` odcięłoby
--    wtedy jego zdjęcia wszystkim członkom (przed tą migracją działały).
--    Gdy właściciela katalogu NIE MA już w `auth.users`, predykat dopasowuje
--    więc wpisy z `author_id IS NULL`: po FK tylko taki wpis mógł należeć do
--    usuniętego konta. Ścieżki ŻYJĄCEGO użytkownika ta gałąź nie otwiera -
--    wstrzyknięcie sprzed migracji, którego autor potem usunął konto, dalej
--    nic nie daje. Zostaje jedno okno: wpis wstrzyknięty przed migracją,
--    którego autor i właściciel ścieżki usunęli konta - plik osieroconego
--    katalogu, bez żywego właściciela do ochrony; odróżnić go można by tylko
--    trwałym identyfikatorem przesyłającego w wierszu (zmiana schematu
--    nieproporcjonalna do tego przypadku).
--
-- OPTYMALIZACJA. Predykat jest liczony dla KAŻDEGO wiersza `storage.objects`,
-- który ogląda polityka (podpisywanie galerii, listowanie). Dotąd szukał
-- ścieżki zawieraniem jsonb w całym najemcy - bez indeksu na `attachments`,
-- czyli skanem wszystkich wpisów najemcy na każdy plik. Teraz wiązanie
-- autora trafia w `club_posts_author_recent_idx (author_id, created_at)`
-- z 20261007100100, więc koszt spada do wpisów jednego autora (gałąź konta
-- usuniętego: do wpisów z `author_id IS NULL`, ten sam indeks). Katalog,
-- który nie jest uuid-em, daje od razu `false` - bez wyjątku rzutowania
-- w środku polityki, który wywróciłby całe zapytanie magazynu.
--
-- Bez zmian: kształt i granty RPC, semantyka członkostwa w predykacie
-- (aktywny członek klubu wpisu w tym samym najemcy), polityki magazynu
-- (czytają funkcję, więc wystarczy ją podmienić), elementy `type=link`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Normalizacja załącznika-pliku
--
-- Zwraca obiekt z DOKŁADNIE siedmioma kluczami albo NULL, gdy element jest
-- niepoprawny - komunikat błędu należy do wołającego (jak przy migawce linku).
--   type   - 'image' | 'video' | 'file';
--   path   - `<p_owner>/<plik>`: jeden segment pliku, bez `.`/`..`, bez znaków
--            sterujących, najwyżej 1024 znaki (limit klucza obiektu); NIE
--            przycinany - musi wskazywać dokładnie ten obiekt, który wgrano;
--   name, mime - null albo tekst najwyżej 255 znaków (znaki sterujące
--            usunięte, pusty -> null);
--   size   - null albo liczba całkowita 0..52428800 (limit kubełka, ten sam
--            co `CLUB_POST_MAX_FILE_BYTES` klienta);
--   width, height - null albo liczba całkowita 1..100000.
-- Nieznane klucze są pomijane. Zakres znaków sterujących jak w
-- `club_link_snapshot_normalize` (C0, DEL, C1 wypisane jawnie).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_post_media_normalize(p_media jsonb, p_owner uuid)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE
  c_cntrl constant text := '[\u0001-\u001f\u007f-\u009f]';
  v_out   jsonb;
  v_val   jsonb;
  v_text  text;
  v_num   numeric;
  v_key   text;
  v_max   numeric;
  v_min   numeric;
BEGIN
  IF p_owner IS NULL OR p_media IS NULL OR jsonb_typeof(p_media) IS DISTINCT FROM 'object' THEN
    RETURN NULL;
  END IF;

  v_val := p_media -> 'type';
  IF jsonb_typeof(v_val) IS DISTINCT FROM 'string'
     OR (v_val #>> '{}') NOT IN ('image', 'video', 'file') THEN
    RETURN NULL;
  END IF;
  v_out := jsonb_build_object('type', v_val #>> '{}');

  -- Katalog właściciela to pierwszy segment; drugi i ostatni to plik.
  v_val := p_media -> 'path';
  IF jsonb_typeof(v_val) IS DISTINCT FROM 'string' THEN
    RETURN NULL;
  END IF;
  v_text := v_val #>> '{}';
  IF char_length(v_text) > 1024
     OR v_text ~ c_cntrl
     OR v_text !~ '^[^/]+/[^/]+$'
     OR split_part(v_text, '/', 1) <> p_owner::text
     OR split_part(v_text, '/', 2) IN ('.', '..') THEN
    RETURN NULL;
  END IF;
  v_out := v_out || jsonb_build_object('path', v_text);

  FOREACH v_key IN ARRAY ARRAY['name', 'mime'] LOOP
    v_val := p_media -> v_key;
    IF v_val IS NULL OR jsonb_typeof(v_val) = 'null' THEN
      v_out := v_out || jsonb_build_object(v_key, NULL);
    ELSIF jsonb_typeof(v_val) = 'string' THEN
      v_text := NULLIF(btrim(regexp_replace(v_val #>> '{}', c_cntrl, '', 'g')), '');
      IF v_text IS NOT NULL AND char_length(v_text) > 255 THEN
        RETURN NULL;
      END IF;
      v_out := v_out || jsonb_build_object(v_key, v_text);
    ELSE
      RETURN NULL;
    END IF;
  END LOOP;

  FOREACH v_key IN ARRAY ARRAY['size', 'width', 'height'] LOOP
    v_min := CASE v_key WHEN 'size' THEN 0 ELSE 1 END;
    v_max := CASE v_key WHEN 'size' THEN 52428800 ELSE 100000 END;
    v_val := p_media -> v_key;
    IF v_val IS NULL OR jsonb_typeof(v_val) = 'null' THEN
      v_out := v_out || jsonb_build_object(v_key, NULL);
    ELSIF jsonb_typeof(v_val) = 'number' THEN
      v_num := (v_val #>> '{}')::numeric;
      IF v_num <> trunc(v_num) OR v_num < v_min OR v_num > v_max THEN
        RETURN NULL;
      END IF;
      v_out := v_out || jsonb_build_object(v_key, v_num::bigint);
    ELSE
      RETURN NULL;
    END IF;
  END LOOP;

  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public.club_post_media_normalize(jsonb, uuid) IS
  'Załącznik-plik wpisu do postaci kanonicznej {type, path, name, mime, size, width, height}: path wyłącznie <p_owner>/<plik> (katalog autora w club-media, bez ./.., bez znaków sterujących, do 1024 znaków), name/mime do 255 znaków, size 0..52428800, width/height 1..100000. NULL = element niepoprawny.';

REVOKE ALL ON FUNCTION public.club_post_media_normalize(jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.club_post_media_normalize(jsonb, uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 2) club_post_create: załączniki-pliki przez normalizację
--
-- Ciało przeniesione 1:1 z 20261007100100; zmienia się WYŁĄCZNIE pętla
-- załączników (gałąź ELSE dla image/video/file).
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
  v_media jsonb;
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
    ELSE
      -- Plik wyłącznie z katalogu WOŁAJĄCEGO - patrz nagłówek: obca ścieżka
      -- otwierałaby cudzy plik każdemu członkowi tego klubu.
      v_media := public.club_post_media_normalize(v_el, auth.uid());
      IF v_media IS NULL THEN
        RAISE EXCEPTION 'clubs: invalid media attachment' USING ERRCODE = '22023';
      END IF;
      v_el := v_media;
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
  'Nowy wpis ściany. Załączniki: tablica do 10 obiektów typu link/image/video/file (inny typ: club_post_create: invalid attachment); element type=link normalizowany do {type, url, title, description, image, siteName} (tylko https), inaczej clubs: invalid link attachment; element image/video/file normalizowany do {type, path, name, mime, size, width, height} z path wyłącznie <auth.uid()>/<plik>, inaczej clubs: invalid media attachment. Limity: 30/24 h (clubs: post rate limit) i 10/min (clubs: post burst limit) na autora.';

REVOKE ALL ON FUNCTION public.club_post_create(uuid, uuid, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_post_create(uuid, uuid, uuid, text, jsonb) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3) Predykat odczytu kubełka club-media: ścieżka należy do AUTORA wpisu
--
-- Polityka "club media member read" (20260830132031) zostaje bez zmian:
-- właściciel czyta swój katalog, a resztę rozstrzyga ta funkcja.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.club_media_path_readable(_path text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_folder text := split_part(COALESCE(_path, ''), '/', 1);
  v_owner  uuid;
BEGIN
  -- Katalog nie-uuid: odmowa bez rzutowania - wyjątek w środku polityki
  -- wywróciłby całe zapytanie magazynu.
  IF v_folder !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;
  v_owner := v_folder::uuid;

  -- Właściciel katalogu żyje: plik otwiera wyłącznie JEGO opublikowany wpis
  -- (nagłówek, punkt 2).
  IF EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_owner) THEN
    RETURN EXISTS (
      SELECT 1
        FROM public.club_posts p
        JOIN public.club_members m
          ON m.club_id = p.club_id
         AND m.tenant_id = p.tenant_id
         AND m.user_id = auth.uid()
         AND m.status = 'active'
       WHERE p.author_id = v_owner
         AND p.tenant_id = public.current_tenant_id()
         AND p.status = 'published'
         AND p.attachments @> jsonb_build_array(jsonb_build_object('path', _path))
    );
  END IF;

  -- Konto właściciela usunięte: FK wyzerował `author_id` jego wpisów, więc
  -- tylko wpis z `author_id IS NULL` mógł być jego. Wpis żyjącego autora
  -- z tą ścieżką to wstrzyknięcie - tej gałęzi nie dotyczy.
  RETURN EXISTS (
    SELECT 1
      FROM public.club_posts p
      JOIN public.club_members m
        ON m.club_id = p.club_id
       AND m.tenant_id = p.tenant_id
       AND m.user_id = auth.uid()
       AND m.status = 'active'
     WHERE p.author_id IS NULL
       AND p.tenant_id = public.current_tenant_id()
       AND p.status = 'published'
       AND p.attachments @> jsonb_build_array(jsonb_build_object('path', _path))
  );
END;
$$;

COMMENT ON FUNCTION public.club_media_path_readable(text) IS
  'Predykat polityki odczytu kubełka club-media: wołający jest aktywnym członkiem klubu (w swoim najemcy), w którym OPUBLIKOWANY wpis AUTORA ścieżki (pierwszy segment = author_id) niesie ją jako załącznik; gdy konta właściciela katalogu nie ma już w auth.users - wpis z author_id NULL (ON DELETE SET NULL). Ścieżka żyjącego użytkownika we wpisie innego autora nie otwiera niczego.';

REVOKE ALL ON FUNCTION public.club_media_path_readable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_media_path_readable(text) TO authenticated, service_role;
