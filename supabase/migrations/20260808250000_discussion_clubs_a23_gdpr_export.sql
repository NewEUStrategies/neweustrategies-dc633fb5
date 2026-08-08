-- ============================================================================
-- Kluby dyskusyjne - etap A23: eksport danych osobowych (RODO art. 15 i 20)
--
-- BLAD, KTORY TO NAPRAWIA. Eksport danych osobowych (`exportMyData`) podpisuje
-- sie jako komplet - niesie wlasny manifest, liste swiadomych wylaczen i bramke
-- `assertExportManifestMatches`, ktora pilnuje, zeby deklaracja nie rozjechala
-- sie z implementacja. Caly modul klubow dyskusyjnych powstal PO tej bramce
-- i nie zostal do niej dopiety: `grep -i club` po `exportManifest.ts` oraz
-- `export.functions.ts` nie zwracal ANI JEDNEGO trafienia. Osoba, ktora
-- napisala w klubach 50 tematow i 300 odpowiedzi, dostawala plik nazwany
-- kompletem, w ktorym calego modulu nie ma - i nie miala jak tego zauwazyc,
-- bo manifest tez o nim milczal.
--
-- DLACZEGO RPC, A NIE `.from("club_*")`. Wszystkie tabele klubowe sa RLS
-- deny-all z `REVOKE ALL ... FROM authenticated` (A3/A4: powierzchnia mutacji
-- i odczytu jest wylacznie RPC-owa). Klient user-scoped, ktorym jedzie reszta
-- eksportu, dostalby z nich puste zbiory albo blad grantu - czyli sekcje, ktore
-- wygladaja na "brak danych" zamiast na "brak dostepu". Stad jedno
-- SECURITY DEFINER RPC zwracajace jsonb, rozbijane na zadeklarowane sekcje po
-- stronie serwera aplikacji.
--
-- ZAKRES. Wylacznie dane WYWOLUJACEGO: jego czlonkostwa, jego tematy, jego
-- odpowiedzi, jego stanowiska, jego reakcje, jego subskrypcje i zaproszenia
-- skierowane do niego. Cudze wypowiedzi w tych samych watkach sa wylaczeniem
-- zadeklarowanym w manifescie (art. 15 ust. 4 RODO) - dokladnie ta sama zasada,
-- co w czacie.
--
-- ANONIMOWOSC I REGULA CHATHAM HOUSE. Wpisy anonimowe wywolujacego SA jego
-- danymi i musza byc w eksporcie - `is_anonymous` jest funkcja PROJEKCJI, a nie
-- brakiem `author_id` (patrz komentarz przy `club_threads.is_anonymous`).
-- Eksport nie odslania przy tym NICZYJEJ anonimowosci: filtr idzie po
-- `author_id = auth.uid()`, wiec nie da sie nim odczytac cudzego autorstwa.
--
-- SKALOWANIE PO TENANCIE. Filtr jest podwojny - `tenant_id` wiersza klubowego
-- musi sie zgadzac z `tenant_id` PROFILU wolajacego (tenant domowy), tak samo
-- jak w `club_my_memberships`. Naglowek `x-tenant-host` nie ma tu wplywu na nic.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.club_export_my_data(p_limit integer DEFAULT 2000)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_tenant uuid;
  -- Sufit wierszy przychodzi z warstwy aplikacji (ROW_LIMIT eksportu), ale
  -- bramka jest tutaj: eksport ma byc plikiem, nie zrzutem bazy, a parametr
  -- jedzie od klienta.
  v_limit  integer := greatest(1, least(COALESCE(p_limit, 2000), 5000));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT p.tenant_id INTO v_tenant FROM public.profiles p WHERE p.id = v_uid;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'clubs: profile not found' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    -- Czlonkostwa: rola, kadencja, tryb powiadomien, akceptacja regulaminu,
    -- zrodlo zaproszenia i powod bana. Powod bana jest DANA OSOBY, ktorej
    -- dotyczy - zatajenie go w eksporcie bylo poprzednio jedynym sposobem,
    -- w jaki mogla sie o nim nie dowiedziec.
    'club_memberships', COALESCE((
      SELECT jsonb_agg(row_to_json(t)::jsonb)
        FROM (
          SELECT
            c.slug            AS club_slug,
            c.name_pl         AS club_name_pl,
            c.name_en         AS club_name_en,
            m.role,
            m.status,
            m.notify_level,
            m.role_expires_at,
            m.rules_accepted_at,
            m.invite_source,
            m.banned_reason,
            m.joined_at,
            m.last_read_at,
            m.unread_count,
            m.created_at,
            m.updated_at
          FROM public.club_members m
          JOIN public.clubs c ON c.id = m.club_id
         WHERE m.user_id = v_uid
           AND m.tenant_id = v_tenant
           AND c.tenant_id = v_tenant
         ORDER BY m.joined_at DESC
         LIMIT v_limit
        ) t
    ), '[]'::jsonb),

    -- Tematy autorstwa wywolujacego - z trescia, bo art. 20 mowi o danych
    -- DOSTARCZONYCH przez osobe, a tresc wpisu jest tego przykladem wzorcowym.
    'club_threads_authored', COALESCE((
      SELECT jsonb_agg(row_to_json(t)::jsonb)
        FROM (
          SELECT
            th.id,
            c.slug   AS club_slug,
            g.slug   AS group_slug,
            th.slug  AS thread_slug,
            th.title,
            th.body,
            th.kind,
            th.status,
            th.is_anonymous,
            th.anchor_type,
            th.anchor_id,
            th.pinned_at,
            th.locked_at,
            th.reply_count,
            th.participant_count,
            th.reaction_count,
            th.last_reply_at,
            th.created_at,
            th.updated_at,
            th.edited_at,
            th.edit_count
          FROM public.club_threads th
          JOIN public.clubs c       ON c.id = th.club_id
          JOIN public.club_groups g ON g.id = th.group_id
         WHERE th.author_id = v_uid
           AND th.tenant_id = v_tenant
         ORDER BY th.created_at DESC
         LIMIT v_limit
        ) t
    ), '[]'::jsonb),

    -- Odpowiedzi autorstwa wywolujacego. `thread_id` + `parent_id` zostaja,
    -- zeby dalo sie odtworzyc miejsce wypowiedzi w drzewie bez cudzych tresci.
    'club_replies_authored', COALESCE((
      SELECT jsonb_agg(row_to_json(t)::jsonb)
        FROM (
          SELECT
            r.id,
            c.slug  AS club_slug,
            r.thread_id,
            th.slug AS thread_slug,
            r.parent_id,
            r.depth,
            r.body,
            r.is_anonymous,
            r.status,
            r.reaction_count,
            r.created_at,
            r.updated_at,
            r.edited_at,
            r.edit_count
          FROM public.club_replies r
          JOIN public.clubs c        ON c.id = r.club_id
          JOIN public.club_threads th ON th.id = r.thread_id
         WHERE r.author_id = v_uid
           AND r.tenant_id = v_tenant
         ORDER BY r.created_at DESC
         LIMIT v_limit
        ) t
    ), '[]'::jsonb),

    -- Stanowiska: deklaracja poparcia lub sprzeciwu wraz z uzasadnieniem.
    -- To opinia polityczna zapisana imiennie, wiec tym bardziej musi byc
    -- w eksporcie osoby, ktorej dotyczy.
    'club_stances', COALESCE((
      SELECT jsonb_agg(row_to_json(t)::jsonb)
        FROM (
          SELECT
            s.thread_id,
            th.slug AS thread_slug,
            th.title AS thread_title,
            c.slug  AS club_slug,
            s.stance,
            s.rationale,
            s.created_at,
            s.updated_at
          FROM public.club_stances s
          JOIN public.club_threads th ON th.id = s.thread_id
          JOIN public.clubs c         ON c.id = s.club_id
         WHERE s.user_id = v_uid
           AND s.tenant_id = v_tenant
         ORDER BY s.created_at DESC
         LIMIT v_limit
        ) t
    ), '[]'::jsonb),

    'club_reactions', COALESCE((
      SELECT jsonb_agg(row_to_json(t)::jsonb)
        FROM (
          SELECT
            c.slug AS club_slug,
            rx.target_type,
            rx.target_id,
            rx.kind,
            rx.created_at
          FROM public.club_reactions rx
          JOIN public.clubs c ON c.id = rx.club_id
         WHERE rx.user_id = v_uid
           AND rx.tenant_id = v_tenant
         ORDER BY rx.created_at DESC
         LIMIT v_limit
        ) t
    ), '[]'::jsonb),

    -- Subskrypcje watkow. Tabela nie ma `tenant_id` (klucz to para
    -- watek+osoba), wiec skalowanie idzie przez watek - inaczej wpis z innego
    -- tenanta przeciekalby do pliku.
    'club_thread_subscriptions', COALESCE((
      SELECT jsonb_agg(row_to_json(t)::jsonb)
        FROM (
          SELECT
            sub.thread_id,
            th.slug  AS thread_slug,
            th.title AS thread_title,
            c.slug   AS club_slug,
            sub.state,
            sub.created_at
          FROM public.club_thread_subscriptions sub
          JOIN public.club_threads th ON th.id = sub.thread_id
          JOIN public.clubs c         ON c.id = th.club_id
         WHERE sub.user_id = v_uid
           AND th.tenant_id = v_tenant
         ORDER BY sub.created_at DESC
         LIMIT v_limit
        ) t
    ), '[]'::jsonb),

    -- Zaproszenia SKIEROWANE DO wywolujacego. `inviter_id` nie wychodzi -
    -- tozsamosc zapraszajacego jest jego dana, a tresc zaproszenia i tak
    -- pokazuje, czego dotyczylo.
    'club_invitations_received', COALESCE((
      SELECT jsonb_agg(row_to_json(t)::jsonb)
        FROM (
          SELECT
            c.slug AS club_slug,
            g.slug AS group_slug,
            i.club_role,
            i.message,
            i.status,
            i.created_at,
            i.responded_at,
            i.expires_at
          FROM public.club_invitations i
          JOIN public.clubs c            ON c.id = i.club_id
          LEFT JOIN public.club_groups g ON g.id = i.group_id
         WHERE i.invitee_id = v_uid
           AND i.tenant_id = v_tenant
         ORDER BY i.created_at DESC
         LIMIT v_limit
        ) t
    ), '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.club_export_my_data(integer) IS
  'Eksport RODO modulu klubow: czlonkostwa, tematy, odpowiedzi, stanowiska, reakcje, subskrypcje i zaproszenia WYWOLUJACEGO. Tabele klubowe sa RLS deny-all, wiec eksport nie ma innej drogi niz to RPC. Cudze wypowiedzi sa wylaczeniem zadeklarowanym w manifescie (art. 15 ust. 4 RODO).';

REVOKE EXECUTE ON FUNCTION public.club_export_my_data(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_export_my_data(integer) TO authenticated, service_role;
