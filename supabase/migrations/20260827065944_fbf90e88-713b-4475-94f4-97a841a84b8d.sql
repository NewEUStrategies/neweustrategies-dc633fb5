-- ============================================================================
-- DWIE POZYCJE MENU WYDARZENIA, KTORE NIE MIALY CZEGO CZYTAC: UCZESTNICY
-- I DYSKUSJE.
--
-- CO TO ZAMYKA. Piatka zawsze obecnych pozycji ("Uczestnicy", "Prelegenci",
-- "Partnerzy", "Agenda", "Dyskusje") ma po stronie bazy cztery zrodla i jedna
-- dziure. Uczestnicy mieli wylacznie `event_meeting_directory` - katalog
-- GIELDY SPOTKAN, ktory milczy, gdy gielda 1-1 jest wylaczona
-- (`blocked = 'meetings_disabled'`), a wiec nie nadaje sie na strone
-- wydarzenia, ktore gieldy nie prowadzi. Dyskusje nie mialy NICZEGO:
-- `club_threads` nie znaja `event_id`, `qa_sessions.event_id` nie jest czytane
-- ani przez panel, ani przez front, a `events.conversation_id` to prywatny
-- czat na 49 osob zakladany przez gospodarza.
--
-- ---------------------------------------------------------------------------
-- DECYZJA 1: LISTA UCZESTNIKOW STOI NA DWOCH ZGODACH, KTORE JUZ ISTNIEJA.
--
-- Zero nowych zgod i zero zmian prawnych, bo baza domyslnie mowi NIE:
--   * `profiles.discoverable` ma `NOT NULL DEFAULT false` (20260710092108:8) -
--     czlowiek, ktory nigdy nie zdecydowal, jest niewidoczny;
--   * `event_registrations.directory_opt_out` jest opisane w komentarzu jako
--     decyzja OSOBY, nie wydarzenia ("organizator nie ma tu przelacznika, bo
--     to jest decyzja osoby, a nie wydarzenia", 20260825200000:45-46).
-- `event_attendees` czyta OBIE i nie doklada trzeciej. Osoba bez konta
-- (`event_people.user_id IS NULL`) nie wychodzi NIGDY - nie mialaby gdzie
-- wyrazic zgody, wiec jej brak nie jest milczeniem, tylko brakiem pytania.
--
-- Sama lista jest dla ZAPISANEGO. Nie dla goscia, nie dla zalogowanego
-- z ulicy: "kto jest na sali" to informacja dla ludzi z sali. Zapis czyta
-- `_event_meeting_caller_registration` - ten sam pomocnik, ktorego uzywa
-- gielda - zeby definicja "jestem zapisany" (konto -> kartoteka -> zapis
-- w stanie approved/attended) miala w module JEDNO miejsce.
--
-- CZEGO TA FUNKCJA CELOWO NIE CZYTA: `event_meeting_settings` (lista nie
-- zalezy od tego, czy gielda jest wlaczona) ani `event_groups.attendee_visibility`
-- (te kolumny opisuja widocznosc W GIELDZIE i domyslnie sa zamkniete, wiec
-- doklejenie ich tutaj wygasilo by liste dla wszystkich). Grupy wychodza jako
-- ETYKIETY i licznik, nie jako bramka.
--
-- ---------------------------------------------------------------------------
-- DECYZJA 2: CHATHAM HOUSE ODBIERA NAZWISKA, A NIE LICZBY - I ROBI TO TUTAJ.
--
-- Do dzis `events.chatham_house` bylo wylacznie deklaracja: `event_sections`
-- nie czyta tej kolumny ani razu, a nasz wlasny panel ostrzegal, ze "zasada
-- Chatham House przy publicznej stronie jest obietnica, ktorej strona nie
-- dowozi". Ta migracja te obietnice dowozi i robi to W RPC, nie w komponencie:
-- filtr w Reakcie obchodzi sie jednym `supabase.rpc()` z konsoli
-- przegladarki. Miejsce egzekwowania to JEDNA LINIA `WHERE NOT v_chatham`
-- w wyrazeniu `page` - liczba wychodzi z `listable` (a wiec zostaje), a strona
-- wierszy z nazwiskami po prostu nie powstaje.
--
-- ---------------------------------------------------------------------------
-- DECYZJA 3: DYSKUSJE TO GRUPA KLUBU DYSKUSYJNEGO, NIE NOWY SILNIK.
--
-- Kluby maja watki, moderacje, harmonogram okna, pseudonimy Chatham House
-- i JEDNO zrodlo prawdy o dostepie (`club_capabilities`). Projekt wprost
-- odrzuca budowanie drugiego silnika dyskusji
-- (docs/PROJEKT_MODUL_EVENT_BUILDER_2026-08-23.md:641-643), wiec wydarzenie
-- dostaje dwie kolumny WSKAZUJACE grupe, a nie wlasna tabele watkow.
--
-- `event_discussions` NIE POWTARZA reguly widocznosci klubu - wola
-- `club_capabilities(club, grupa, wolajacy)`. Gdyby przepisac warunki inline,
-- rozjechalyby sie z klubem przy pierwszej zmianie polityki grupy, a modul
-- klubow ma ten rozjazd opisany jako swoje najwieksze ryzyko.
--
-- Wydarzenie BEZ przypietej grupy nie jest bledem: `state = 'not_configured'`
-- i pusta lista. Strona pokazuje wtedy jedno zdanie zaproszenia - nie pusta
-- ramke i nie atrape.
--
-- ---------------------------------------------------------------------------
-- CO Z RLS. Ta migracja nie zaklada ani jednej tabeli i nie tworzy ani jednej
-- polityki, wiec kontraktu `event_admin_only_contract_test.sql` nie dotyka.
-- Obie funkcje sa SECURITY DEFINER i skaluja dane po `public_tenant_id()`
-- (najemca z naglowka hosta) BEZ ani jednego `has_role()`/`is_staff()` - to
-- plaszczyzna tresci, dokladnie jak `event_agenda` i `event_sponsors_public`.
--
-- ---------------------------------------------------------------------------
-- WPIECIE DO events-harness BYLO ODLOZONE I JUZ NIE JEST.
--
-- Ten harness stawia atrape CALEJ powierzchni poza modulem Wydarzen, a modulu
-- klubow nie stawial wcale - nie bylo w nim ani `clubs`, ani `club_groups`,
-- ani `club_capabilities`. Sam znacznik bez tych atrap wywrocilby replay na
-- pierwszym kluczu obcym tej migracji, czyli zaczerwienilby bramke z powodu
-- NIEDOMIARU HARNESSU, a nie bledu tutaj - dlatego kolejnosc byla odwrotna:
-- najpierw atrapy, potem znacznik. Atrapy klubow stoja teraz w
-- `scripts/events-harness/harness.sql` (kazdy blok z migracja zrodlowa,
-- cialo `club_capabilities` porownane diff-em z 20260812091500), a znacznik
-- nizej wciaga ten plik do zestawu.
--
-- events-harness: include
--   Znacznik dla `scripts/events-harness/run.sh`. Ta migracja nie definiuje
--   zadnego `public.admin_event_*` ani `events_tenant_id_key`, wiec selektor
--   po tresci by jej nie zlapal - a jej dwie funkcje sa w plpgsql, wiec
--   `CREATE FUNCTION` nie sprawdza w nich ANI JEDNEJ nazwy tabeli. Czysty
--   replay nie dowodzi tu niczego; dowodzi go dopiero WYWOLANIE, ktore robi
--   `runtime_test.d/95_attendees_and_discussions.sql`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. WIAZANIE WYDARZENIA Z GRUPA KLUBU
--
-- DWIE KOLUMNY, NIE JEDNA. Sama grupa wystarczylaby do odczytu watkow, ale
-- nie do zbudowania odnosnika: trasa watku to `/club/$clubSlug/t/$threadSlug`,
-- a `club_groups` nie ma sluga klubu. Klub jest tez tym, do czego czlowiek
-- dolacza, wiec redaktor wybiera go swiadomie.
--
-- KLUCZE OBCE SA JEDNOKOLUMNOWE, I TO NIE JEST NIEDOPATRZENIE. Tabele
-- potomne modulu Wydarzen wiaza sie z rodzicem para `(tenant_id, event_id)`,
-- bo `events` MA na to ograniczenie UNIQUE (nazwy nie cytujemy z tego samego
-- powodu, co znacznika harnessu wyzej - selektor grepuje caly plik).
-- `public.clubs` takiego ograniczenia NIE MA - ma tylko `PRIMARY KEY (id)`
-- i `UNIQUE (tenant_id, slug)` - wiec zlozony klucz obcy nie ma na czym stanac.
-- Dorobienie go w tej migracji zmienialoby ksztalt tabeli obcego modulu
-- w pliku o wydarzeniach, czyli dokladnie ten rodzaj zmiany, ktora potem nikt
-- nie umie znalezc. Rownosc najemcy pilnuje wiec `event_discussions`
-- (`c.tenant_id = v_tenant` przy KAZDYM odczycie), a przypiecie wskazujace na
-- obcego najemce zachowuje sie jak brak przypiecia - strona pokazuje
-- zaproszenie, nie cudze watki.
--
-- `ON DELETE SET NULL`, bo skasowanie klubu nie moze skasowac wydarzenia -
-- traci wtedy dyskusje i nic wiecej.
-- ---------------------------------------------------------------------------

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS discussion_club_id uuid
    REFERENCES public.clubs(id) ON DELETE SET NULL;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS discussion_group_id uuid
    REFERENCES public.club_groups(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.events.discussion_club_id IS
  'Klub dyskusyjny obslugujacy pozycje menu "Dyskusje". NULL = wydarzenie nie ma dyskusji i strona pokazuje zdanie zaproszenia. Rownosc najemcy sprawdza event_discussions, bo public.clubs nie ma UNIQUE (tenant_id, id).';

COMMENT ON COLUMN public.events.discussion_group_id IS
  'Grupa klubu, ktorej watki czyta event_discussions. NULL = brak dyskusji. Musi nalezec do discussion_club_id - inaczej przypiecie jest czytane jak brak przypiecia.';

-- PARA, NIE DWIE NIEZALEZNE KOLUMNY. Grupa bez klubu nie da sie zlinkowac,
-- a klub bez grupy jest stanem POSREDNIM redakcji (wybralem klub, wybieram
-- grupe) - dlatego zakazane jest tylko jedno z dwoch skrzyzowan.
ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_discussion_group_needs_club;
ALTER TABLE public.events
  ADD CONSTRAINT events_discussion_group_needs_club
    CHECK (discussion_group_id IS NULL OR discussion_club_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS events_discussion_group_idx
  ON public.events (tenant_id, discussion_group_id)
  WHERE discussion_group_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. UCZESTNICY OPUBLIKOWANEGO WYDARZENIA
--
-- Ladunek: {"event_slug" | "event_id", "q", "group_id", "limit", "offset"}.
--
-- POWODY ODMOWY SA STOPNIOWANE, bo kazdy ma inne nastepne dzialanie:
--   * `auth_required`               -> zaloguj sie (wyjatek, nie pole - patrz nizej),
--   * `requester_not_participating` -> zapisz sie na wydarzenie,
--   * `chatham_house`               -> nie bedzie nazwisk, i to jest cala tresc.
--
-- BRAK SESJI JEST WYJATKIEM, NIE POLEM `blocked`. Funkcja ma REVOKE dla `anon`,
-- wiec gosc dostaje odmowe uprawnien juz na wejsciu; `RAISE EXCEPTION` jest
-- druga oslona dla przypadku, w ktorym token wygasl w trakcie zwiedzania
-- strony. Ten sam uklad ma `event_meeting_directory` i nie ma powodu, zeby
-- dwie siostrzane funkcje odmawialy inaczej.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.event_attendees(jsonb);
CREATE FUNCTION public.event_attendees(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_slug text := NULLIF(btrim(COALESCE(p_payload->>'event_slug', '')), '');
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_q text := NULLIF(btrim(COALESCE(p_payload->>'q', '')), '');
  v_group_id uuid := NULLIF(p_payload->>'group_id', '')::uuid;
  v_limit integer := LEAST(GREATEST(COALESCE(NULLIF(p_payload->>'limit', '')::integer, 24), 1), 100);
  v_offset integer := GREATEST(COALESCE(NULLIF(p_payload->>'offset', '')::integer, 0), 0);
  v_event public.events;
  v_me uuid;
  v_chatham boolean := false;
  v_discoverable boolean := false;
  v_opt_out boolean := false;
  v_blocked text;
  v_total integer := 0;
  v_rows jsonb := '[]'::jsonb;
  v_groups jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to see who is attending';
  END IF;

  IF v_tenant IS NULL OR (v_slug IS NULL AND v_event_id IS NULL) THEN
    RAISE EXCEPTION 'invalid_payload: event_slug or event_id is required';
  END IF;

  -- NIEOPUBLIKOWANE WYDARZENIE NIE MA UCZESTNIKOW NA FRONCIE. Ta sama regula,
  -- co w `event_agenda` i `event_sponsors_public`: szkic zyje wylacznie
  -- w panelu.
  SELECT e.* INTO v_event
  FROM public.events e
  WHERE e.tenant_id = v_tenant
    AND e.status = 'published'
    AND (
      (v_event_id IS NOT NULL AND e.id = v_event_id)
      OR (v_event_id IS NULL AND e.slug = v_slug)
    );

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;

  v_chatham := COALESCE(v_event.chatham_house, false);
  v_me := public._event_meeting_caller_registration(v_tenant, v_event.id);

  IF v_me IS NULL THEN
    v_blocked := 'requester_not_participating';
  END IF;

  -- WLASNE DZWIGNIE WOLAJACEGO WYCHODZA ZAWSZE, TAKZE PRZY CHATHAM HOUSE:
  -- karta "Moja widocznosc" musi umiec powiedziec, czy jestem na liscie,
  -- nawet gdy tej listy nikt nie zobaczy.
  IF v_me IS NOT NULL THEN
    SELECT r.directory_opt_out, COALESCE(pr.discoverable, false)
      INTO v_opt_out, v_discoverable
    FROM public.event_registrations r
    JOIN public.event_people pe
      ON pe.id = r.person_id AND pe.tenant_id = r.tenant_id
    LEFT JOIN public.profiles pr
      ON pr.id = pe.user_id AND pr.tenant_id = r.tenant_id
    WHERE r.tenant_id = v_tenant AND r.id = v_me;
  END IF;

  IF v_blocked IS NULL THEN
    -- JEDNA INSTRUKCJA, TRZY WYNIKI. Predykat listy stoi w `listable` DOKLADNIE
    -- RAZ: liczba, strona wierszy i licznik per grupa czytaja to samo wyrazenie
    -- tabelaryczne. Rozbicie na trzy zapytania znaczyloby trzy kopie warunku
    -- zgody - a to jest warunek, ktorego nie wolno miec w trzech wersjach.
    WITH listable AS (
      SELECT
        r.id AS registration_id,
        pe.last_name AS sort_last,
        pe.first_name AS sort_first,
        -- IMIE Z PROFILU, BO TO JEST TOZSAMOSC, KTORA CZLOWIEK UPUBLICZNIL.
        -- Kartoteka wydarzenia jest zapasem: bywa, ze profil ma tylko nazwe
        -- wyswietlana, a bywa, ze nie ma nic.
        COALESCE(
          NULLIF(btrim(pr.display_name), ''),
          NULLIF(btrim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
          btrim(concat_ws(' ', pe.first_name, pe.last_name))
        ) AS name,
        -- STANOWISKO I FIRMA Z KARTOTEKI WYDARZENIA, bo to jest to, co stoi na
        -- identyfikatorze i co widac na sali; profil dopowiada, gdy zapisu
        -- nikt nie uzupelnil.
        COALESCE(NULLIF(btrim(pe.job_title), ''), NULLIF(btrim(pr.job_title), '')) AS job_title,
        COALESCE(
          NULLIF(btrim(pe.company_text), ''),
          co.name,
          NULLIF(btrim(pr.current_company), '')
        ) AS company,
        CASE WHEN pr.hide_avatar THEN NULL ELSE pr.avatar_url END AS avatar_url,
        pr.slug AS profile_slug
      FROM public.event_registrations r
      JOIN public.event_people pe
        ON pe.id = r.person_id AND pe.tenant_id = r.tenant_id
      -- ZLACZENIE WEWNETRZNE Z `profiles` JEST BRAMKA, NIE OZDOBA: osoba bez
      -- konta nie ma jak byc `discoverable`, wiec wypada tutaj, a nie
      -- w warunku ponizej.
      JOIN public.profiles pr
        ON pr.id = pe.user_id AND pr.tenant_id = r.tenant_id
      LEFT JOIN public.crm_companies co
        ON co.tenant_id = pe.tenant_id AND co.id = pe.company_id
      WHERE r.tenant_id = v_tenant
        AND r.event_id = v_event.id
        AND r.status IN ('approved', 'attended')
        -- DWIE ZGODY, OBIE WYMAGANE - patrz naglowek, decyzja 1.
        AND r.directory_opt_out = false
        AND pr.discoverable = true
        AND (
          v_group_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM public._event_meeting_groups(v_tenant, v_event.id, r.id) AS theirs(group_id)
            WHERE theirs.group_id = v_group_id
          )
        )
        AND (
          v_q IS NULL
          OR pe.full_name_norm LIKE '%' || lower(btrim(v_q)) || '%'
          OR lower(COALESCE(NULLIF(btrim(pe.company_text), ''), co.name, '')) LIKE
             '%' || lower(btrim(v_q)) || '%'
        )
    ),
    page AS (
      SELECT l.*
      FROM listable l
      -- ============================================================
      -- TU JEST EGZEKWOWANY CHATHAM HOUSE. Jedna linia, w bazie,
      -- w wyrazeniu budujacym WIERSZE - nie w komponencie, ktory da sie
      -- obejsc wolaniem RPC wprost. Liczba nizej liczy sie z `listable`,
      -- wiec przy `chatham_house = true` strona wie, ILU jest uczestnikow,
      -- i nie wie, KTO.
      -- ============================================================
      WHERE NOT v_chatham
      ORDER BY l.sort_last, l.sort_first, l.registration_id
      LIMIT v_limit OFFSET v_offset
    ),
    per_group AS (
      SELECT mg.group_id, count(*)::integer AS n
      FROM listable l
      CROSS JOIN LATERAL
        public._event_meeting_groups(v_tenant, v_event.id, l.registration_id) AS mg(group_id)
      GROUP BY mg.group_id
    )
    SELECT
      (SELECT count(*)::integer FROM listable),
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'registration_id', pg.registration_id,
              'name', pg.name,
              'job_title', pg.job_title,
              'company', pg.company,
              'avatar_url', pg.avatar_url,
              'profile_slug', pg.profile_slug,
              'groups', (
                SELECT COALESCE(jsonb_agg(
                  jsonb_build_object(
                    'id', g.id,
                    'name_pl', g.name_pl,
                    'name_en', g.name_en,
                    'color', g.color
                  ) ORDER BY g.sort_order, g.name_pl
                ), '[]'::jsonb)
                FROM public._event_meeting_groups(v_tenant, v_event.id, pg.registration_id)
                  AS mg(group_id)
                JOIN public.event_groups g ON g.id = mg.group_id AND g.tenant_id = v_tenant
              )
            ) ORDER BY pg.sort_last, pg.sort_first, pg.registration_id
          )
          FROM page pg
        ),
        '[]'::jsonb
      ),
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', g.id,
              'name_pl', g.name_pl,
              'name_en', g.name_en,
              'color', g.color,
              -- LICZBA W GRUPIE WOLNO TAKZE PRZY CHATHAM HOUSE: "12 prelegentow,
              -- 8 partnerow, 100 delegatow" nie zdradza nikogo, a mowi, kto
              -- jest na sali.
              'count', COALESCE(pgc.n, 0)
            ) ORDER BY g.sort_order, g.name_pl
          )
          FROM public.event_groups g
          LEFT JOIN per_group pgc ON pgc.group_id = g.id
          WHERE g.tenant_id = v_tenant AND g.event_id = v_event.id
        ),
        '[]'::jsonb
      )
    INTO v_total, v_rows, v_groups;

    IF v_chatham THEN
      -- Powod wraca DOPIERO TERAZ, po policzeniu: gdyby stanal wyzej, strona
      -- nie mialaby czym powiedziec "jest nas 120".
      v_blocked := 'chatham_house';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'blocked', v_blocked,
    'chatham_house', v_chatham,
    'my_registration_id', v_me,
    -- TRZY POLA, NIE JEDNO. `my_listed` mowi, co widza inni; `my_discoverable`
    -- i `my_opt_out` mowia, KTORA dzwignia to sprawia - a to sa dwie rozne
    -- decyzje w dwoch roznych miejscach (profil platformy i ten zapis).
    'my_listed', (v_discoverable AND NOT v_opt_out),
    'my_discoverable', v_discoverable,
    'my_opt_out', v_opt_out,
    'total_count', v_total,
    'rows', v_rows,
    'groups', v_groups
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_attendees(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_attendees(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_attendees(jsonb) IS
  'Lista uczestnikow opublikowanego wydarzenia dla ZAPISANEGO uczestnika: {"event_slug"|"event_id", "q", "group_id", "limit", "offset"}. Wychodza WYLACZNIE osoby z profiles.discoverable = true i bez event_registrations.directory_opt_out - zero nowych zgod. Przy events.chatham_house = true nazwiska NIE WYCHODZA (liczba i grupy wolno), egzekwowane w tej funkcji, nie w komponencie. Bez danych kontaktowych. Plaszczyzna tresci - zero has_role().';

-- ---------------------------------------------------------------------------
-- 3. DYSKUSJE OPUBLIKOWANEGO WYDARZENIA
--
-- Jeden argument (`p_slug`), jak `event_agenda`, `event_menu`
-- i `event_sponsors_public` - to jest dana STRONY, nie zapytanie z filtrami.
--
-- STANY, KTORE FRONT MUSI UMIEC NARYSOWAC:
--   * `not_found`       - nie ma takiego opublikowanego wydarzenia,
--   * `not_configured`  - nie ma przypietej grupy (albo przypiecie wskazuje
--                         poza najemce) -> zdanie zaproszenia,
--   * `ok`              - watki wychodza,
--   * cokolwiek innego  - powod WPROST z `club_capabilities.reason`
--                         (`auth_required`, `not_open_yet`, `window_closed`,
--                         `archived`, `banned`, `tier_required`...). Nie
--                         tlumaczymy tych powodow na wlasny slownik, bo
--                         drugi slownik znaczylby drugie zrodlo prawdy.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.event_discussions(text);
CREATE FUNCTION public.event_discussions(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Ile watkow wchodzi na strone wydarzenia. Reszta zycia dyskusji dzieje sie
  -- w klubie, wiec to jest zajawka, nie druga lista tematow.
  c_limit constant integer := 20;
  v_tenant uuid := public.public_tenant_id();
  v_event public.events;
  v_club public.clubs;
  v_group public.club_groups;
  v_caps record;
  v_state text := 'not_found';
  v_total integer := 0;
  v_threads jsonb := '[]'::jsonb;
  v_can_post boolean := false;
BEGIN
  IF v_tenant IS NOT NULL THEN
    SELECT e.* INTO v_event
    FROM public.events e
    WHERE e.tenant_id = v_tenant
      AND e.slug = p_slug
      AND e.status = 'published';
  END IF;

  IF v_event.id IS NULL THEN
    RETURN jsonb_build_object(
      'state', 'not_found',
      'club', NULL,
      'group', NULL,
      'attribution', NULL,
      'can_post', false,
      'total_count', 0,
      'threads', '[]'::jsonb
    );
  END IF;

  -- BRAK PRZYPIECIA NIE JEST BLEDEM. Wydarzenie bez dyskusji jest normalnym
  -- wydarzeniem - strona mowi jedno zdanie i tyle.
  IF v_event.discussion_club_id IS NOT NULL AND v_event.discussion_group_id IS NOT NULL THEN
    SELECT c.* INTO v_club
    FROM public.clubs c
    WHERE c.id = v_event.discussion_club_id
      AND c.tenant_id = v_tenant;

    SELECT g.* INTO v_group
    FROM public.club_groups g
    WHERE g.id = v_event.discussion_group_id
      AND g.club_id = v_event.discussion_club_id
      AND g.tenant_id = v_tenant;
  END IF;

  IF v_club.id IS NULL OR v_group.id IS NULL THEN
    RETURN jsonb_build_object(
      'state', 'not_configured',
      'club', NULL,
      'group', NULL,
      'attribution', NULL,
      'can_post', false,
      'total_count', 0,
      'threads', '[]'::jsonb
    );
  END IF;

  -- JEDNO ZRODLO PRAWDY O DOSTEPIE - patrz naglowek, decyzja 3.
  SELECT * INTO v_caps
  FROM public.club_capabilities(v_club.id, v_group.id, auth.uid());

  IF COALESCE(v_caps.can_read, false) THEN
    v_state := 'ok';
    v_can_post := COALESCE(v_caps.can_post_thread, false);

    WITH visible AS (
      SELECT
        t.*,
        -- KASKADA ATRYBUCJI 1:1 Z KLUBEM: watek nadpisuje grupe, grupa
        -- nadpisuje klub (`20260809212413`). Wlasna kolejnosc znaczylaby, ze
        -- ta sama dyskusja jest anonimowa w klubie i imienna na stronie
        -- wydarzenia.
        COALESCE(t.attribution_mode, v_group.attribution_mode, v_club.attribution_mode)
          AS attribution
      FROM public.club_threads t
      WHERE t.tenant_id = v_tenant
        AND t.club_id = v_club.id
        AND t.group_id = v_group.id
        -- STANY REDAKCYJNE NIE WYCHODZA NA FRONT: `pending` czeka na
        -- moderacje, `hidden` i `deleted` sa decyzja moderatora. Kolejka
        -- moderacji zyje w klubie, nie na stronie wydarzenia, wiec tutaj nie
        -- ma galezi "chyba ze moderator".
        AND t.status IN ('open', 'resolved', 'dormant', 'locked')
    ),
    page AS (
      SELECT v.*
      FROM visible v
      ORDER BY
        v.pinned_at DESC NULLS LAST,
        COALESCE(v.last_reply_at, v.created_at) DESC,
        v.id DESC
      LIMIT c_limit
    )
    SELECT
      (SELECT count(*)::integer FROM visible),
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', pt.id,
              'slug', pt.slug,
              'title', pt.title,
              'excerpt', left(pt.body, 280),
              'kind', pt.kind,
              'status', pt.status,
              'is_anonymous', (pt.is_anonymous OR pt.attribution = 'chatham'),
              -- PROJEKCJA AUTORA 1:1 Z `club_threads_list`: przy watku
              -- anonimowym albo w trybie Chatham House nazwisko, awatar i slug
              -- NIE OPUSZCZAJA funkcji.
              'author_name', CASE
                WHEN pt.is_anonymous OR pt.attribution = 'chatham' THEN NULL
                ELSE COALESCE(
                  NULLIF(btrim(pr.display_name), ''),
                  NULLIF(btrim(concat_ws(' ', pr.first_name, pr.last_name)), '')
                )
              END,
              'author_avatar', CASE
                WHEN pt.is_anonymous OR pt.attribution = 'chatham' OR pr.hide_avatar THEN NULL
                ELSE pr.avatar_url
              END,
              'author_slug', CASE
                WHEN pt.is_anonymous OR pt.attribution = 'chatham' THEN NULL
                ELSE pr.slug
              END,
              'reply_count', pt.reply_count,
              'participant_count', pt.participant_count,
              'pinned_at', pt.pinned_at,
              'last_reply_at', pt.last_reply_at,
              'created_at', pt.created_at
            ) ORDER BY
              pt.pinned_at DESC NULLS LAST,
              COALESCE(pt.last_reply_at, pt.created_at) DESC,
              pt.id DESC
          )
          FROM page pt
          LEFT JOIN public.profiles pr ON pr.id = pt.author_id
        ),
        '[]'::jsonb
      )
    INTO v_total, v_threads;
  ELSE
    v_state := COALESCE(NULLIF(btrim(COALESCE(v_caps.reason, '')), ''), 'no_access');
  END IF;

  RETURN jsonb_build_object(
    'state', v_state,
    'club', jsonb_build_object(
      'id', v_club.id,
      'slug', v_club.slug,
      'name_pl', v_club.name_pl,
      'name_en', v_club.name_en,
      'icon', v_club.icon,
      'accent_color', v_club.accent_color
    ),
    'group', jsonb_build_object(
      'id', v_group.id,
      'slug', v_group.slug,
      'name_pl', v_group.name_pl,
      'name_en', v_group.name_en,
      'status', v_group.status
    ),
    'attribution', COALESCE(v_group.attribution_mode, v_club.attribution_mode),
    'can_post', v_can_post,
    'total_count', v_total,
    'threads', v_threads
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_discussions(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_discussions(text)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_discussions(text) IS
  'Dyskusje opublikowanego wydarzenia po slugu: watki grupy wskazanej przez events.discussion_club_id/discussion_group_id. Dostep liczy club_capabilities (jedno zrodlo prawdy modulu klubow), atrybucja autora kaskaduje watek -> grupa -> klub, stany pending/hidden/deleted nie wychodza. Wydarzenie bez przypietej grupy oddaje state = not_configured i pusta liste. Plaszczyzna tresci - zero has_role().';