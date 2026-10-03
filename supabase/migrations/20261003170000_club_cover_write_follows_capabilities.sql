-- Okładka klubu: zapis pliku, zapis adresu i kadrowanie pytają JEDNEGO
-- predykatu - klub w najemcy wołającego ORAZ `club_capabilities(...).can_moderate`,
-- czyli dokładnie to, co UI dostaje z `club_view` i na co pokazuje edytor.
--
-- DEFEKT 1 (rola spoza słownika). `club_is_cover_moderator` (20260914184500)
-- wpuszczał do `club-covers/<clubId>/...` członków o roli
-- `IN ('owner', 'moderator')`. Tabela `club_members` zna wyłącznie
-- `lead | moderator | member | observer` (CHECK z A1), więc `owner` nie pasował
-- do żadnego wiersza: prowadzący klub w roli `lead` widział edytor okładki
-- (`can_moderate` z `club_capabilities` obejmuje `lead`), a każde wgranie
-- kończyło się odmową RLS. Zmienić okładkę mógł tylko moderator albo admin.
--
-- DEFEKT 2 (status i kadencja). Ta sama funkcja nie patrzyła ani na
-- `club_members.status`, ani na `role_expires_at`. Wyjście z klubu
-- (`status = 'left'`) i ban (`status = 'banned'`) nie zerują roli, a wygasła
-- kadencja degraduje rolę dopiero w `club_effective_member_role`. Były,
-- zbanowany albo „przeterminowany" moderator mógł więc nadpisać (upsert) albo
-- skasować obiekt okładki pod znaną, publiczną ścieżką, choć
-- `club_capabilities` odmawiało mu już wszystkiego.
--
-- DEFEKT 3 (admin cudzego najemcy). Gałąź `has_role(_user_id, 'admin')`
-- w `club_is_cover_moderator` i `has_role(v_uid, 'admin')` w `club_set_cover`
-- pytają o rolę w najemcy WOŁAJĄCEGO (`user_roles.tenant_id =
-- current_tenant_id()`), a nie w najemcy klubu. Admin najemcy B, znając UUID
-- klubu najemcy A, mógł więc wgrać, nadpisać i skasować plik w
-- `club-covers/<klub A>/`, a przez `club_set_cover` - zdjąć albo podmienić
-- okładkę klubu A (`UPDATE ... WHERE id = p_club_id` bez warunku najemcy).
-- To ten sam mechanizm, który 20260920120000 domknęło już dla
-- `club_set_cover_position`; tu zostawał otwarty.
--
-- DEFEKT 4 (adres pod domeną marki odrzucany). Klient (`uploadClubCover`)
-- wysyła do `club_set_cover` adres po `brandedMediaUrl`, czyli
-- `https://neweuropeanstrategies.com/media/club-covers/...`, a migracja
-- 20260915091000 przepisała na tę domenę także istniejące okładki. Tymczasem
-- `club_set_cover` (20260809182555) przyjmował WYŁĄCZNIE host techniczny
-- `*.supabase.co/storage/v1/object/public/media/`. Nawet z poprawną polityką
-- magazynu zapis adresu kończył się `clubs: invalid cover url`, a klient
-- sprzątał świeżo wgrany plik - okładki nie dało się ustawić nikomu.
--
-- DEFEKT 5 (sprzątanie, które nic nie kasuje). `uploadClubCover` po odmowie
-- `club_set_cover` woła `storage.from('media').remove([path])`, żeby w
-- publicznym kubełku nie została sierota. `remove` w storage-js wymaga na
-- `storage.objects` uprawnień `delete` ORAZ `select` (DELETE z WHERE czyta
-- wiersz, więc RLS dokłada politykę SELECT). Kubełek `media` nie ma od
-- 20260625160117 żadnej polityki SELECT, więc dla prowadzących DELETE trafiał
-- w zero wierszy: polityki `update`/`delete` prefiksu były martwe, a każda
-- nieudana próba zostawiała plik pod znanym publicznym adresem. Nowa polityka
-- `club covers moderator select` wpuszcza do odczytu metadanych WYŁĄCZNIE
-- obiekty `club-covers/<clubId>/...` klubu, którego okładkę wołający może
-- edytować - sam plik i tak jest publiczny (kubełek `public`), więc polityka
-- nie odsłania treści, a jedynie domyka ścieżkę sprzątania.
--
-- DEFEKT 6 (kadr starego zdjęcia na nowym). Ani `club_set_cover`, ani
-- `admin_club_upsert` (panel administracyjny) nie ruszały `cover_position_y`,
-- więc nowe zdjęcie dziedziczyło kadr poprzedniego - ustawiony pod inną
-- kompozycję, a od tej zmiany widoczny na KAŻDEJ powierzchni. Reset żyje teraz
-- w triggerze `clubs_cover_position_reset_tg` (BEFORE UPDATE OF
-- cover_image_url), więc obejmuje każdą ścieżkę zapisu naraz: zmiana PLIKU
-- (ścieżki obiektu w kubełku, nie samego hosta) wraca do środka (50), chyba że
-- ta sama instrukcja jawnie ustawia nowy kadr. Zmiana samego hosta (np.
-- przemarkowanie domeny hurtowym UPDATE-em) kadru nie rusza.
--
-- DEFEKT 7 (obejście przez ustawienia klubu). `club_update_settings`
-- (20260919220300) przepisywał `p->>'cover_image_url'` do kolumny bez żadnej
-- walidacji i pozwalał ustawić `cover_position_y` - z własną bramką
-- (`is_club_admin OR effective_role = 'lead'`), którą prowadzący klubu
-- zarchiwizowanego przechodzi. Dziś każde wywołanie i tak pada na CHECK
-- dziennika moderacji (akcja `club_updated`), ale naprawa tamtego CHECK-a
-- otworzyłaby ścieżkę z dowolnym hostem w `<img src>`. Funkcja odrzuca teraz
-- oba klucze (22023): okładkę zapisują wyłącznie `club_set_cover`
-- i `club_set_cover_position`. Interfejs ustawień tych pól nie wysyła.
--
-- POPRAWKA. Jeden predykat `club_can_edit_cover(club, user)`:
--   * klub musi należeć do najemcy wołającego (`current_tenant_id()`) - bez
--     tego warunku żadna gałąź nie jest rozważana,
--   * potem wyłącznie `club_capabilities(club, NULL, user).can_moderate`: ta
--     funkcja liczy rolę efektywną (kadencja), status członkostwa (`active`;
--     `banned` i `left` odpadają), stan klubu (zarchiwizowany przyjmuje zmiany
--     tylko od administracji), a administrację modułu przez `is_club_admin`
--     (admin LUB super_admin - wcześniej super_admin bez roli admin dostawał
--     odmowę w magazynie, wbrew inwariantowi super_admin >= admin).
-- Osobna gałąź `has_role(..., 'admin')` znika: przy klubie z własnego najemcy
-- jest podzbiorem `is_club_admin`, a bez tego warunku była właśnie dziurą
-- z DEFEKTU 3.
--
-- Z predykatu korzystają polityka magazynu (przez `club_is_cover_moderator`),
-- `club_set_cover` i `club_set_cover_position`. Słownik ról przestaje żyć
-- w trzech miejscach, więc ten rodzaj rozjazdu nie może wrócić po cichu.
--
-- Predykat odpowiada WYŁĄCZNIE o wywołującego (`_user_id = auth.uid()`).
-- Polityka i oba RPC podają `auth.uid()`, a funkcja jest wykonywalna dla
-- `authenticated` (musi być - polityka RLS liczy się prawami wywołującego),
-- więc bez tego wiązania dałoby się nią sondować uprawnienia cudzych kont.
--
-- `club_set_cover` przyjmuje adres w obu postaciach (host techniczny magazynu
-- albo `https://<host>/media/...`) i zapisuje `https://<origin>/media/<ścieżka>`.
-- Origin podany przez klienta zostaje WYŁĄCZNIE, gdy jest na białej liście:
-- domena marki (neweuropeanstrategies.com i www.) albo domena najemcy klubu
-- (`tenants.domain` i jej alias www./apex - ten sam model, którym trasa
-- rozpoznaje najemcę po hoście). Origin jest konfiguracją wdrożenia
-- (`VITE_PUBLIC_MEDIA_ORIGIN`), więc stała w bazie kłóciłaby się z najemcą na
-- własnej domenie. Każdy inny host - w tym techniczny host magazynu - schodzi
-- do originu kanonicznego: domeny najemcy, a bez niej domeny marki (jak
-- `brand_media_url_text`). Obcy host nie trafi więc do `<img src>` (tracking,
-- mieszana treść). Ścieżka musi wskazywać prefiks TEGO klubu - tak jak
-- polityka magazynu, która wpuszcza plik wyłącznie tam. Ścieżkę z obu postaci
-- adresu wyjmuje jedna funkcja, `club_cover_media_path`, z której korzysta też
-- trigger resetu kadru.
--
-- `club_is_any_moderator` (20260809182555) nosił ten sam literał `owner`,
-- a od 20260914184500 nie korzysta z niego żadna polityka ani kod. Martwa
-- funkcja SECURITY DEFINER z błędnym słownikiem ról to pułapka na ponowne
-- użycie, więc znika. `DROP` bez CASCADE: gdyby cokolwiek jeszcze od niej
-- zależało, migracja zatrzyma się głośno zamiast skasować zależność po cichu.
--
-- POWTÓRNE WYKONANIE JEST BEZPIECZNE: `CREATE OR REPLACE` (sygnatury i typy
-- zwracane bez zmian), `DROP ... IF EXISTS`, polityki odtwarzane po `DROP`.
-- Pas drizzle: plik jedzie wyłącznie pasem supabase; bliźniaka dokłada
-- wdrożenie (jak 0132 dla 20261003090000).

-- Ścieżka obiektu w kubełku `media` z jednej z dwóch postaci adresu
-- publicznego; NULL dla każdego innego kształtu (obcy schemat, brak `/media/`,
-- zapytanie, fragment).
CREATE OR REPLACE FUNCTION public.club_cover_media_path(_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    substring(btrim(_url) FROM '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/media/([^?#]+)$'),
    substring(btrim(_url) FROM '^https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?/media/([^?#]+)$')
  );
$$;

COMMENT ON FUNCTION public.club_cover_media_path(text) IS
  'Sciezka obiektu w kubelku media z adresu publicznego (host techniczny magazynu albo https://<host>/media/...). NULL dla innego ksztaltu.';

REVOKE ALL ON FUNCTION public.club_cover_media_path(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_cover_media_path(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_can_edit_cover(_club_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_can boolean;
BEGIN
  IF _club_id IS NULL OR _user_id IS NULL OR _user_id IS DISTINCT FROM auth.uid() THEN
    RETURN FALSE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.clubs c
     WHERE c.id = _club_id AND c.tenant_id = public.current_tenant_id()
  ) THEN
    RETURN FALSE;
  END IF;
  SELECT cap.can_moderate INTO v_can
    FROM public.club_capabilities(_club_id, NULL::uuid, _user_id) cap;
  RETURN COALESCE(v_can, FALSE);
END;
$$;

COMMENT ON FUNCTION public.club_can_edit_cover(uuid, uuid) IS
  'Jedyny predykat edycji okladki klubu (plik w magazynie, adres, kadrowanie): klub w najemcy wolajacego ORAZ club_capabilities.can_moderate (rola efektywna lead/moderator z aktywnym czlonkostwem albo is_club_admin). Odpowiada wylacznie o wolajacego (_user_id = auth.uid()).';

REVOKE ALL ON FUNCTION public.club_can_edit_cover(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_can_edit_cover(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_is_cover_moderator(_user_id uuid, _object_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parts text[] := storage.foldername(COALESCE(_object_name, ''));
  v_club  uuid;
BEGIN
  IF _user_id IS NULL THEN
    RETURN FALSE;
  END IF;
  -- Wymagamy DOKŁADNIE `club-covers/<uuid>/<plik>`: brak segmentu klubu albo
  -- segment, który nie jest UUID, to brak uprawnienia - nie "wolno wszystko".
  -- UUID sprawdza wyrażenie regularne, nie blok EXCEPTION wokół rzutowania:
  -- polityka liczy tę funkcję dla każdego dotykanego wiersza prefiksu, a blok
  -- EXCEPTION otwiera przy każdym wywołaniu podtransakcję.
  IF array_length(v_parts, 1) IS DISTINCT FROM 2
     OR v_parts[1] <> 'club-covers'
     OR v_parts[2] !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RETURN FALSE;
  END IF;
  v_club := v_parts[2]::uuid;

  RETURN public.club_can_edit_cover(v_club, _user_id);
END;
$$;

COMMENT ON FUNCTION public.club_is_cover_moderator(uuid, text) IS
  'TRUE, gdy sciezka club-covers/<clubId>/<plik> nalezy do klubu, ktorego okladke _user_id moze edytowac (club_can_edit_cover). Fail-closed dla sciezek bez poprawnego UUID klubu i dla innego uzytkownika niz wolajacy.';

REVOKE ALL ON FUNCTION public.club_is_cover_moderator(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_is_cover_moderator(uuid, text) TO authenticated, service_role;

-- Polityki insert/update/delete odtwarzane z tą samą treścią co
-- w 20260914184500 (zmienia się wyłącznie ciało funkcji), select dochodzi
-- (DEFEKT 5). Komplet w jednym pliku dokumentuje, co realnie stoi na
-- `storage.objects` dla tego prefiksu.
DROP POLICY IF EXISTS "club covers moderator select" ON storage.objects;
DROP POLICY IF EXISTS "club covers moderator insert" ON storage.objects;
DROP POLICY IF EXISTS "club covers moderator update" ON storage.objects;
DROP POLICY IF EXISTS "club covers moderator delete" ON storage.objects;

CREATE POLICY "club covers moderator select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = 'club-covers'
    AND public.club_is_cover_moderator(auth.uid(), name)
  );

CREATE POLICY "club covers moderator insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = 'club-covers'
    AND public.club_is_cover_moderator(auth.uid(), name)
  );

CREATE POLICY "club covers moderator update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = 'club-covers'
    AND public.club_is_cover_moderator(auth.uid(), name)
  )
  WITH CHECK (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = 'club-covers'
    AND public.club_is_cover_moderator(auth.uid(), name)
  );

CREATE POLICY "club covers moderator delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = 'club-covers'
    AND public.club_is_cover_moderator(auth.uid(), name)
  );

-- Kolejność odmów jak w `club_set_cover_position` (20260920120000): klub
-- z cudzego najemcy wygląda na nieistniejący (`not found`, funkcja nie
-- potwierdza nawet UUID-a), brak prawa we własnym najemcy to `forbidden`.
CREATE OR REPLACE FUNCTION public.club_set_cover(p_club_id uuid, p_url text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_url    text := NULLIF(btrim(COALESCE(p_url, '')), '');
  v_file   text;
  v_host   text;
  v_domain text;
  v_origin text;
  v_hit    integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = p_club_id AND c.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;

  IF NOT public.club_can_edit_cover(p_club_id, v_uid) THEN
    RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_url IS NOT NULL THEN
    v_file := substring(public.club_cover_media_path(v_url)
                        FROM '^club-covers/' || p_club_id::text || '/([A-Za-z0-9][A-Za-z0-9._-]{0,199})$');
    IF v_file IS NULL OR v_file LIKE '%..%' THEN
      RAISE EXCEPTION 'clubs: invalid cover url' USING ERRCODE = '22023';
    END IF;

    -- Biała lista originów: domena marki i domena najemcy klubu (z aliasem
    -- www./apex). Host techniczny magazynu i każdy obcy host schodzą do originu
    -- kanonicznego - domeny najemcy, a bez niej domeny marki.
    v_host := lower(substring(v_url FROM '^https://([A-Za-z0-9.-]+)(?::[0-9]{1,5})?/media/'));
    SELECT NULLIF(regexp_replace(lower(btrim(COALESCE(t.domain, ''))), '^https?://|/+$', '', 'g'), '')
      INTO v_domain
      FROM public.tenants t
     WHERE t.id = v_tenant;
    v_origin := CASE
      WHEN v_host IN ('neweuropeanstrategies.com', 'www.neweuropeanstrategies.com') THEN 'https://' || v_host
      WHEN v_domain IS NOT NULL
           AND v_host IN (v_domain, 'www.' || v_domain, regexp_replace(v_domain, '^www\.', '')) THEN 'https://' || v_host
      ELSE 'https://' || COALESCE(v_domain, 'neweuropeanstrategies.com')
    END;
    v_url := v_origin || '/media/club-covers/' || p_club_id::text || '/' || v_file;
  END IF;

  -- Reset kadru przy zmianie pliku robi trigger `clubs_cover_position_reset_tg`.
  UPDATE public.clubs c SET cover_image_url = v_url WHERE c.id = p_club_id AND c.tenant_id = v_tenant;
  GET DIAGNOSTICS v_hit = ROW_COUNT;
  IF v_hit = 0 THEN
    RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501';
  END IF;
  RETURN v_url;
END;
$$;

COMMENT ON FUNCTION public.club_set_cover(uuid, text) IS
  'Ustawia (albo zdejmuje przy NULL) okladke klubu z najemcy wolajacego. Uprawnienie: club_can_edit_cover. Adres musi wskazywac club-covers/<p_club_id>/<plik> w kubelku media (host techniczny magazynu albo /media/ pod domena). Origin zostaje tylko z bialej listy (domena marki, domena najemcy z aliasem www.), inaczej origin kanoniczny najemcy. Zmiana pliku zeruje kadr (trigger clubs_cover_position_reset_tg).';

REVOKE ALL ON FUNCTION public.club_set_cover(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_set_cover(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.club_set_cover_position(p_club_id uuid, p_position_y smallint)
 RETURNS smallint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_tenant uuid := public.current_tenant_id(); v_val smallint; v_hit integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = p_club_id AND c.tenant_id = v_tenant) THEN RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501'; END IF;
  IF NOT public.club_can_edit_cover(p_club_id, v_uid) THEN RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501'; END IF;
  v_val := GREATEST(0::smallint, LEAST(100::smallint, COALESCE(p_position_y, 50)::smallint));
  UPDATE public.clubs c SET cover_position_y = v_val WHERE c.id = p_club_id AND c.tenant_id = v_tenant;
  GET DIAGNOSTICS v_hit = ROW_COUNT;
  IF v_hit = 0 THEN RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501'; END IF;
  RETURN v_val;
END;
$function$;

-- Reset kadru przy zmianie PLIKU okładki - na każdej ścieżce zapisu
-- (`club_set_cover`, `admin_club_upsert`, przyszłe). Porównujemy ścieżkę obiektu,
-- nie cały adres: zmiana samego hosta to ten sam plik. Adres spoza kubełka
-- `media` porównujemy w całości. Instrukcja, która jawnie ustawia nowy kadr
-- razem z plikiem, wygrywa z resetem.
CREATE OR REPLACE FUNCTION public.club_cover_position_reset()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.cover_position_y IS NOT DISTINCT FROM OLD.cover_position_y
     AND COALESCE(public.club_cover_media_path(NEW.cover_image_url), btrim(NEW.cover_image_url))
         IS DISTINCT FROM
         COALESCE(public.club_cover_media_path(OLD.cover_image_url), btrim(OLD.cover_image_url))
  THEN
    NEW.cover_position_y := 50;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.club_cover_position_reset() IS
  'Trigger: zmiana pliku okladki (sciezki w kubelku media, nie hosta) zeruje cover_position_y do 50, chyba ze ta sama instrukcja ustawia kadr jawnie.';

REVOKE ALL ON FUNCTION public.club_cover_position_reset() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_cover_position_reset() TO authenticated, service_role;

DROP TRIGGER IF EXISTS clubs_cover_position_reset_tg ON public.clubs;
CREATE TRIGGER clubs_cover_position_reset_tg
  BEFORE UPDATE OF cover_image_url ON public.clubs
  FOR EACH ROW EXECUTE FUNCTION public.club_cover_position_reset();

-- `club_update_settings` bez zapisu okładki (DEFEKT 7). Treść jak
-- w 20260919220300, z dwiema różnicami: klucze `cover_image_url`
-- i `cover_position_y` są odrzucane (22023), a ich przypisania zniknęły.
CREATE OR REPLACE FUNCTION public.club_update_settings(p_club_id uuid, p jsonb)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_tenant uuid := public.current_tenant_id(); v_caps record; v_hit integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'clubs: sign in required' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = p_club_id AND c.tenant_id = v_tenant) THEN RAISE EXCEPTION 'clubs: not found' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_caps FROM public.club_capabilities(p_club_id, NULL, v_uid);
  IF NOT (public.is_club_admin(v_uid) OR v_caps.effective_role = 'lead') THEN RAISE EXCEPTION 'clubs: forbidden' USING ERRCODE = '42501'; END IF;
  IF (p ? 'cover_image_url') OR (p ? 'cover_position_y') THEN RAISE EXCEPTION 'clubs: cover is written by club_set_cover' USING ERRCODE = '22023'; END IF;
  IF (p ? 'join_policy') AND COALESCE(p->>'join_policy', '') NOT IN ('open', 'request', 'invite') THEN RAISE EXCEPTION 'clubs: invalid join policy' USING ERRCODE = '22023'; END IF;
  IF (p ? 'who_can_post') AND COALESCE(p->>'who_can_post', '') NOT IN ('members', 'moderators', 'staff_only') THEN RAISE EXCEPTION 'clubs: invalid who_can_post' USING ERRCODE = '22023'; END IF;
  IF (p ? 'layout') AND COALESCE(p->>'layout', '') NOT IN ('list', 'cards', 'magazine') THEN RAISE EXCEPTION 'clubs: invalid layout' USING ERRCODE = '22023'; END IF;
  UPDATE public.clubs c SET
    name_pl = COALESCE(NULLIF(btrim(p->>'name_pl'), ''), c.name_pl),
    name_en = COALESCE(NULLIF(btrim(p->>'name_en'), ''), c.name_en),
    tagline_pl = CASE WHEN p ? 'tagline_pl' THEN NULLIF(btrim(p->>'tagline_pl'), '') ELSE c.tagline_pl END,
    tagline_en = CASE WHEN p ? 'tagline_en' THEN NULLIF(btrim(p->>'tagline_en'), '') ELSE c.tagline_en END,
    description_pl = CASE WHEN p ? 'description_pl' THEN NULLIF(btrim(p->>'description_pl'), '') ELSE c.description_pl END,
    description_en = CASE WHEN p ? 'description_en' THEN NULLIF(btrim(p->>'description_en'), '') ELSE c.description_en END,
    rules_pl = CASE WHEN p ? 'rules_pl' THEN NULLIF(btrim(p->>'rules_pl'), '') ELSE c.rules_pl END,
    rules_en = CASE WHEN p ? 'rules_en' THEN NULLIF(btrim(p->>'rules_en'), '') ELSE c.rules_en END,
    icon = COALESCE(NULLIF(btrim(p->>'icon'), ''), c.icon),
    accent_color = CASE WHEN p ? 'accent_color' THEN NULLIF(btrim(p->>'accent_color'), '') ELSE c.accent_color END,
    policy_area = CASE WHEN p ? 'policy_area' THEN NULLIF(btrim(p->>'policy_area'), '') ELSE c.policy_area END,
    layout = COALESCE(NULLIF(p->>'layout', ''), c.layout),
    who_can_post = COALESCE(NULLIF(p->>'who_can_post', ''), c.who_can_post),
    join_policy = COALESCE(NULLIF(p->>'join_policy', ''), c.join_policy),
    updated_at = now()
  WHERE c.id = p_club_id AND c.tenant_id = v_tenant;
  GET DIAGNOSTICS v_hit = ROW_COUNT;
  IF v_hit = 0 THEN RETURN false; END IF;
  INSERT INTO public.club_moderation_log (tenant_id, club_id, moderator_id, action, target_type, target_id, reason) VALUES (v_tenant, p_club_id, v_uid, 'club_updated', 'club', p_club_id, left(COALESCE((SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(p) AS k), ''), 500));
  RETURN true;
END;
$function$;

DROP FUNCTION IF EXISTS public.club_is_any_moderator(uuid);
