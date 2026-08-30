-- ============================================================================
-- SEKCJA `materials`: BAZA UMIE POLICZYC JEJ PUSTKE - I OD TERAZ TO ROBI.
--
-- CO BYLO ZLE
--
-- `public.event_sections(text)` oddawala dla `materials` `has_content = NULL`,
-- czyli "nie wiem, zapytaj tego, kto rysuje". Front przepuszcza NULL
-- (`src/lib/events/eventSections.ts`: `isLocked || hasContent !== false`),
-- a dla `materials` NIE MA po drugiej stronie nikogo, kto by tej pustki
-- policzyl: `EventPageSections` odsiewa przed naglowkiem WYLACZNIE sekcje
-- praktyczne (`isEventPracticalSection`), bo tylko one maja tresc w propsach.
-- Materialy siedza za osobnym zapytaniem, ktore rusza dopiero WEWNATRZ
-- `EventMaterialsSection` - a wiec juz POD narysowanym naglowkiem.
--
-- Skutek dla uczestnika: kazde wydarzenie, ktoremu organizator wlaczyl sekcje
-- materialow (domyslnie `is_visible = false`, wiec jest to swiadome klikniecie
-- w panelu), a ktorego partnerzy nie opublikowali jeszcze ani jednego pliku,
-- pokazywalo SAMOTNY NAGLOWEK "Materialy" nad jednym zdaniem o pustce. Jest to
-- co do joty ta sama usterka, przed ktora 20260827130000 ostrzegal przy mapie
-- i kontakcie ("zeby nie zostal samotny naglowek 'Dojazd' nad pustka") -
-- tyle ze tam lekarstwem byl front, a tutaj front lekarstwa nie ma.
--
-- DLACZEGO NULL BYL BLEDEM, A NIE DECYZJA
--
-- 20260827130000 zostawil `materials` przy NULL-u z uzasadnieniem podanym
-- wprost: "zrodla w bazie nie ma, wiec nie da sie policzyc" (:330). To zdanie
-- bylo NIEPRAWDZIWE juz w chwili pisania. `public.event_sponsor_materials`
-- powstala 20260823160000 - cztery dni WCZESNIEJ - razem z publiczna
-- `event_sponsor_materials_public`, ktora czyta ja dwustopniowym predykatem
-- publikacji (material I przypiecie partnera). Zrodlo istnialo, bylo
-- zaindeksowane i bylo juz czytane przez ten sam front. Brakowalo wylacznie
-- rachunku - i on wchodzi tym plikiem.
--
-- DLACZEGO W SQL-U, A NIE NA FRONCIE
--
-- Front moglby podniesc zapytanie o materialy do `EventPageSections` i odsiac
-- sekcje jak mape. Kosztowaloby to trzy rzeczy, ktorych rachunek w bazie nie
-- kosztuje nic:
--   * PRZESKOK UKLADU NA KAZDYM ZIMNYM WCZYTANIU. `usePublicEventMaterials`
--     nie ma `initialData`, wiec przy pierwszym renderze `data` jest
--     `undefined`. Sekcja musialaby sie pojawic i zniknac - albo mignac
--     szkieletem po to, zeby go usunac.
--   * BLAD ZAMIENIONY W CISZE. `isError` tez daje pusta liste: sekcja ukryta
--     "bo pusto" opowiadalaby czytelnikowi, ze materialow nie ma, podczas gdy
--     zapytanie po prostu sie nie udalo.
--   * ZAPYTANIE DLA GOSCIA, KTORY I TAK NIC NIE ZOBACZY. Sekcja domyslnie stoi
--     za zapisem (`visibility = 'registered'`), a zamknieta sekcja z zalozenia
--     NIE POBIERA DANYCH (`EventPageSections`, naglowek).
-- Rachunek w bazie omija wszystkie trzy: sekcja albo wraca z RPC, albo nie
-- wraca wcale, a `shouldRenderSection` juz dzis umie ja na tej podstawie
-- ubic - bez ani jednej linii zmiany w komponentach.
--
-- ZAMEK NADAL WYGRYWA Z TRESCIA. `shouldRenderSection` to
-- `isLocked || hasContent !== false`, wiec goscia bez zapisu nadal wita karta
-- zaproszenia, takze przy zerze materialow - dokladnie tak, jak przy zerze
-- partnerow (`sponsors` liczy sie w bazie od 20260827130000 i zachowuje sie
-- identycznie). Ta migracja NIE rusza ani jednej bramki: `is_visible`,
-- `visibility`, `min_tier_rank` i `events.guest_mode` sa przeniesione znak
-- w znak, a `is_locked` / `lock_reason` wychodza bit w bit takie same.
--
-- CO SIE DZIEJE Z WYDARZENIAMI JUZ ISTNIEJACYMI
--   * Wydarzenie z opublikowanymi materialami opublikowanego partnera -
--     BEZ ZMIANY (`has_content = true`, sekcja jak dotad).
--   * Wydarzenie z wlaczona sekcja i zerem materialow - sekcja ZNIKA razem
--     z naglowkiem. To jest cala tresc tej zmiany.
--   * Wydarzenie z materialami przypietymi do NIEOPUBLIKOWANEGO partnera -
--     sekcja znika, i tak ma byc: `event_sponsor_materials_public` i tak nie
--     oddalaby ani jednego wiersza, wiec dotad byla to sekcja pusta.
--   * Gosc bez zapisu - BEZ ZMIANY (zamek wygrywa, karta zaproszenia zostaje).
--
-- CZEGO TEN PLIK NIE ROBI
--   * NIE rusza `map` i `contact` - ich pustke nadal liczy front z tych samych
--     kolumn, z ktorych rysuje tresc, i to jest kontrakt `eventPractical`.
--     NULL zostaje tam, gdzie naprawde znaczy "nie wiem".
--   * NIE usuwa zdania o pustce z `EventMaterialsSection`. Sekcja i lista jada
--     dwoma osobnymi zapytaniami, wiec moga sie rozjechac w czasie (partner
--     cofa publikacje miedzy jednym a drugim). Zdanie zostaje jako druga
--     linia obrony - tak samo, jak zostalo w `EventSponsorsSection`.
--   * NIE zmienia sygnatury ani uprawnien: `RETURNS TABLE`, `SECURITY DEFINER`,
--     `SET search_path`, REVOKE/GRANT - wszystko bez zmiany.
--   * NIE dodaje bramki rolowej. To plaszczyzna TRESCI: najemca z
--     `public_tenant_id()`, zero `has_role()` (`check:sql-tenant-scope`).
--
-- PostgreSQL nie ma "ALTER FUNCTION ... SET BODY", wiec plik przepisuje CALE
-- cialo z 20260827130000 (ostatnia definicja w repozytorium) i zmienia w nim
-- dokladnie: jedna deklaracje, jeden rachunek `EXISTS`, jedna galaz `CASE`
-- oraz `COMMENT`. Reszta jest przeniesiona znak w znak.
--
-- events-harness: include
--   Znacznik dla `scripts/events-harness/run.sh` - selektor po tresci lapie
--   `public.admin_event_` albo `events_tenant_id_key`, a ten plik definiuje
--   WYLACZNIE publiczna `public.event_sections`. Bez znacznika harness
--   sprawdzalby rachunek SPRZED zmiany, mimo ze asercje
--   `runtime_test.d/96_section_content_sources.sql` stoja dokladnie na nim.
--
-- Idempotentne: `CREATE OR REPLACE` na niezmienionej sygnaturze.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.event_sections(p_slug text)
RETURNS TABLE (
  section_key text,
  sort_order integer,
  heading_pl text,
  heading_en text,
  visibility text,
  min_tier_rank integer,
  is_locked boolean,
  lock_reason text,
  has_content boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_slug text := NULLIF(btrim(COALESCE(p_slug, '')), '');
  v_event public.events;
  v_registered boolean := false;
  v_has_description boolean;
  v_has_agenda boolean;
  v_has_speakers boolean;
  v_has_sponsors boolean;
  v_has_materials boolean;
BEGIN
  IF v_tenant IS NULL OR v_slug IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_event
  FROM public.events e
  WHERE e.tenant_id = v_tenant
    AND e.slug = v_slug
    AND e.status = 'published';

  IF v_event.id IS NULL THEN
    RETURN;
  END IF;

  IF v_uid IS NOT NULL THEN
    v_registered :=
      EXISTS (
        SELECT 1
        FROM public.event_registrations r
        JOIN public.event_people pe
          ON pe.tenant_id = r.tenant_id AND pe.id = r.person_id
        WHERE r.tenant_id = v_tenant
          AND r.event_id = v_event.id
          AND pe.user_id = v_uid
          AND r.status IN ('approved', 'attended')
      )
      OR EXISTS (
        SELECT 1 FROM public.event_rsvps rs
        WHERE rs.tenant_id = v_tenant
          AND rs.event_id = v_event.id
          AND rs.user_id = v_uid
          AND rs.status = 'going'
      );
  END IF;

  v_has_description :=
    btrim(COALESCE(v_event.description_pl, '')) <> ''
    OR btrim(COALESCE(v_event.description_en, '')) <> '';

  v_has_agenda := EXISTS (
    SELECT 1 FROM public.event_sessions s
    WHERE s.tenant_id = v_tenant
      AND s.event_id = v_event.id
      AND s.status = 'published'
      AND s.is_private = false
  );

  -- Prelegenci moga byc przypieci do wydarzenia (legacy `event_speakers`) albo
  -- do jego sesji (`event_session_speakers`). Sekcja ma tresc, gdy istnieje
  -- ktorekolwiek z dwojga.
  v_has_speakers :=
    EXISTS (
      SELECT 1 FROM public.event_speakers sp
      WHERE sp.event_id = v_event.id
    )
    OR EXISTS (
      SELECT 1 FROM public.event_session_speakers es
      WHERE es.tenant_id = v_tenant AND es.event_id = v_event.id
    );

  v_has_sponsors := EXISTS (
    SELECT 1 FROM public.event_sponsors sn
    WHERE sn.tenant_id = v_tenant
      AND sn.event_id = v_event.id
      AND sn.is_published
  );

  -- Publikacja materialu jest DWUSTOPNIOWA - material I przypiecie partnera -
  -- i ten predykat jest przepisany ZNAK W ZNAK z `event_sponsor_materials_public`
  -- (ostatnia definicja: 20260824094504:296-304), bo dwa liczniki tej samej
  -- pustki rozjechalyby sie przy pierwszej zmianie regul publikacji. Sekcja ma
  -- pokazywac dokladnie to, co tamta funkcja odda - ani wiersza wiecej. Indeks
  -- `event_sponsor_materials_event_published_idx` (tenant_id, event_id,
  -- sort_order) WHERE is_published obsluguje ten EXISTS bez skanu.
  v_has_materials := EXISTS (
    SELECT 1
    FROM public.event_sponsor_materials m
    JOIN public.event_sponsors s
      ON s.id = m.sponsor_id AND s.tenant_id = m.tenant_id
    WHERE m.tenant_id = v_tenant
      AND m.event_id = v_event.id
      AND m.is_published
      AND s.is_published
  );

  RETURN QUERY
  WITH merged AS (
    SELECT
      d.section_key AS k,
      COALESCE(s.is_visible, d.is_visible) AS visible,
      COALESCE(s.sort_order, d.sort_order) AS ord,
      s.heading_pl AS h_pl,
      s.heading_en AS h_en,
      COALESCE(s.visibility, d.visibility) AS vis,
      COALESCE(s.min_tier_rank, d.min_tier_rank) AS rank_min
    FROM public._event_default_sections() d
    LEFT JOIN public.event_page_sections s
      ON s.tenant_id = v_tenant
     AND s.event_id = v_event.id
     AND s.section_key = d.section_key
  ),
  gated AS (
    -- BRAMKI PRZENIESIONE ZNAK W ZNAK z 20260824095226. Powod pierwszy pasujacy
    -- wygrywa: brak zalogowania jest warunkiem MOCNIEJSZYM niz brak zapisu (bez
    -- konta nie ma jak sprawdzic zapisu), a prog warstwy jest niezalezny od
    -- jednego i drugiego. `guest_mode` domyka to, co widzi osoba BEZ ZAPISU:
    -- 'full' otwiera wszystko poza kontaktami, 'teaser' opis i agende,
    -- 'hidden' nic.
    SELECT
      m.k, m.ord, m.h_pl, m.h_en, m.vis, m.rank_min,
      CASE
        WHEN m.vis = 'authenticated' AND v_uid IS NULL THEN 'auth_required'
        WHEN m.vis = 'registered' AND NOT v_registered THEN 'registration_required'
        WHEN m.vis = 'tier' AND NOT public.has_tier_rank(m.rank_min) THEN 'tier_required'
        WHEN NOT v_registered AND v_event.guest_mode = 'hidden'
          THEN 'registration_required'
        WHEN NOT v_registered AND v_event.guest_mode = 'teaser'
          AND m.k NOT IN ('description', 'agenda', 'registration')
          THEN 'registration_required'
        WHEN NOT v_registered AND v_event.guest_mode = 'full' AND m.k = 'contact'
          THEN 'registration_required'
        ELSE 'none'
      END AS reason
    FROM merged m
    WHERE m.visible
  )
  SELECT
    g.k,
    g.ord,
    g.h_pl,
    g.h_en,
    g.vis,
    g.rank_min,
    (g.reason <> 'none'),
    g.reason,
    CASE g.k
      -- PIATKA Z PRAWDZIWYM ZRODLEM W BAZIE. Te sekcje baza policzyc UMIE
      -- i nadal liczy - kazda z nich ma zrodlo, ktorego front nie widzi bez
      -- drugiego zapytania (sesje, prelegenci, partnerzy, tryb zapisow).
      WHEN 'description' THEN v_has_description
      WHEN 'agenda' THEN v_has_agenda
      WHEN 'speakers' THEN v_has_speakers
      WHEN 'sponsors' THEN v_has_sponsors
      -- 'materials' DOLACZA DO TEJ RODZINY. 20260827130000 zostawil ja przy
      -- NULL-u z uzasadnieniem „zrodla w bazie nie ma" - i to zdanie bylo po
      -- prostu nieprawdziwe: `public.event_sponsor_materials` stoi od
      -- 20260823160000, czyli CZTERY DNI WCZESNIEJ, a publiczna
      -- `event_sponsor_materials_public` czyta ja tym samym predykatem,
      -- ktorego uzywa rachunek nizej. Skutkiem NULL-a bylo dokladnie to, przed
      -- czym tamten plik ostrzegal przy mapie i kontakcie: samotny naglowek
      -- „Materialy" nad jednym zdaniem o pustce, na kazdym wydarzeniu, ktoremu
      -- organizator te sekcje wlaczyl, a partnerzy nie wrzucili jeszcze nic.
      WHEN 'materials' THEN v_has_materials
      WHEN 'registration' THEN (v_event.registration_mode <> 'none')
      -- 'map' i 'contact': BAZA NIE WIE i ma tego nie udawac. Pustka tych dwoch
      -- sekcji jest pytaniem o RENDERER, nie o kolumny - o tym, czy
      -- `eventAddressLine` zlozy niepusta linie z pieciu nullowalnych czlonow
      -- i czy `eventSupportEmail` uzna napis z bazy za adres. `NULL` przekazuje
      -- to rozstrzygniecie tam, gdzie ono mieszka (`lib/events/eventPractical`),
      -- zamiast zgadywac je drugi raz w SQL-u.
      --
      -- Poprzednio staly tu dwa BOOLE i oba wychodzily `false`: mapa czytala
      -- stare `location`, ktorego panel nie zapisuje, a kontakt -
      -- `host_user_id`, ktorego nie ustawia NIC w calym repozytorium. `false`
      -- z bazy UBIJA sekcje (`eventSections.ts:177`), wiec adres, jezyki,
      -- hashtag i adres wsparcia byly dla uczestnika nieosiagalne.
      WHEN 'map' THEN NULL::boolean
      WHEN 'contact' THEN NULL::boolean
      -- Galaz domykajaca. Slownik sekcji jest zamkniety w
      -- `_event_default_sections()`, wiec po tej zmianie nie zostaje pod nia
      -- ani jeden klucz - stoi tu jako zabezpieczenie na wypadek dziewiatej
      -- sekcji dopisanej bez rachunku tresci. NULL, nie false: "nie wiem"
      -- i "policzone, wyszlo zero" to dwie rozne odpowiedzi, a front reaguje
      -- na nie inaczej (`shouldRenderSection`: `hasContent !== false`).
      ELSE NULL
    END
  FROM gated g
  ORDER BY g.ord, g.k;
END;
$$;

REVOKE ALL ON FUNCTION public.event_sections(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_sections(text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_sections(text) IS
  'Uklad sekcji strony opublikowanego wydarzenia dla WOLAJACEGO: kolejnosc, nadpisany naglowek, bramka (is_locked + lock_reason z visibility i events.guest_mode) oraz has_content liczony z prawdziwego zrodla kazdej sekcji. Boolean wraca dla szostki, ktora baza umie policzyc: description_pl/_en, event_sessions, event_speakers + event_session_speakers, event_sponsors, event_sponsor_materials (predykat jak w event_sponsor_materials_public) oraz registration_mode. NULL ("nie da sie policzyc") wraca wylacznie dla map i contact - pustke tych dwoch liczy front z tych samych kolumn, z ktorych rysuje tresc (lib/events/eventPractical). Sekcje wylaczone przez redakcje nie wracaja; zamkniete wracaja z powodem.';
