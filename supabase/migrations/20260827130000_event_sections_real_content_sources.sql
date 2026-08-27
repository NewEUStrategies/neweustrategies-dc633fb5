-- ============================================================================
-- SEKCJE `map` I `contact`: `has_content` ODDAJE NULL, CZYLI "BAZA NIE WIE".
--
-- CO BYLO ZLE (nie "zepsute" - NIEOSIAGALNE Z DEFINICJI)
--
-- `public.event_sections(text)` oddaje frontowi dla kazdej sekcji `has_content`,
-- a front na tym POLU ROZSTRZYGA, czy sekcja wchodzi na strone. Predykat stoi
-- w `src/lib/events/eventSections.ts:176-177`:
--
--     return section.isLocked || section.hasContent !== false;
--
-- Czyli sekcja PRZEZYWA przy `true` i przy `null`, a jest UBIJANA wylacznie
-- przy `false`. Parser (`eventSections.ts:112`) tlumaczy to wprost:
-- `typeof row.has_content === "boolean" ? row.has_content : null`.
--
-- Dwa z osmiu `WHEN` w rachunku `has_content` oddawaly BOOLEAN tam, gdzie front
-- oczekuje NULL - i ten boolean wychodzil `false`:
--
--   (1) `contact` -> `v_event.host_user_id IS NOT NULL`.
--       `events.host_user_id` jest w tym repozytorium wylacznie ZADEKLAROWANA
--       (20260712224438 i 20260713093000:45, oba `REFERENCES auth.users(id)
--       ON DELETE SET NULL`) i NIGDY - ani w migracji, ani w kodzie panelu -
--       nie jest USTAWIANA. Warunek byl wiec stale `false`, a sekcja kontaktu
--       nie mogla miec tresci NIGDY. To MARTWA REGULA w scislym sensie: nie
--       "rzadko prawdziwa", a niespelnialna zadnym dzialaniem redakcji.
--
--       Skutek dla wlasciciela: trzy pola, ktore panel zbiera i waliduje -
--       `languages` (pole OBOWIAZKOWE, EventGeneralPanel.tsx:419-440),
--       `social_hashtag` (:386-393) i `support_email` (:454-461) - byly dla
--       uczestnika STRUKTURALNIE nieosiagalne, mimo ze renderer istnieje
--       i dziala (EventPracticalSection.tsx:75-83 jezyki, :85-100 hashtag,
--       :101-113 `mailto:` na adresie wsparcia).
--
--   (2) `map` -> `btrim(COALESCE(v_event.location, '')) <> ''`.
--       `events.location` to STARE pole wolnotekstowe. Panel Wydarzen zapisuje
--       adres w PIECIU kolumnach strukturalnych: `street_address`
--       (EventGeneralPanel.tsx:307-312), `postal_code` (:328-333), `city`
--       (:314-319), `region` (:320-325), `country` (:334-339) - i pola
--       `location` w ogole nie pokazuje. Redaktor wypelnial wiec adres
--       porzadnie, `location` zostawalo puste, `has_content` wychodzil `false`
--       i sekcja dojazdu nie powstawala, mimo ze renderer istnieje
--       (`eventAddressLine` sklada te piec kolumn, EventPracticalSection.tsx:49).
--
-- DLACZEGO NULL, A NIE "NAUCZENIE SQL-A CZYTAC TE OSIEM KOLUMN"
--
-- Bo front JUZ liczy te pustke i jest jej JEDYNYM wlascicielem. Kontrakt jest
-- zapisany wprost w naglowku `src/lib/events/eventPractical.ts:20-23`:
--
--     "`has_content` Z BAZY TU NIE POMOZE. RPC oddaje dla mapy i kontaktu
--      `NULL` (,sekcja bez pojecia tresci'), bo baza nie wie, czy adres zlozony
--      z pieciu nullowalnych kolumn jest pusty w sensie tego widoku. Pustke
--      liczy wiec front - z tych samych kolumn, z ktorych rysuje tresc."
--
-- To NIE jest wygoda, to jest jedno zrodlo prawdy. Pustka sekcji `map` znaczy
-- "linia adresu zlozona przez `eventAddressLine` jest pusta", a pustka sekcji
-- `contact` znaczy "zaden z trzech wierszy karty nie ma czego wypisac" -
-- w tym `eventSupportEmail`, ktory odrzuca adres poza wzorcem, zeby nie
-- narysowac `mailto:` z napisu, ktory adresem nie jest. Druga kopia tej reguly
-- w SQL-u musialaby powtorzyc rowniez TO - i rozjechalaby sie z pierwsza przy
-- najblizszej zmianie ksztaltu karty. Dwa liczniki pustki to nie redundancja,
-- to dwie rozne odpowiedzi na to samo pytanie.
--
-- Skutek uboczny, ktory jest zaleta: nie da sie tu przypadkiem ZAPALIC sekcji,
-- ktora nie ma czego pokazac. `NULL` nie mowi "jest tresc" - mowi "nie wiem,
-- zapytaj tego, kto rysuje". O pustce nadal decyduje `eventPractical`, i to on
-- odsiewa sekcje PRZED naglowkiem (`EventPageSections.tsx:72-78`), zeby nie
-- zostal samotny naglowek "Dojazd" nad pustka.
--
-- DLACZEGO NIE DA SIE ZMIENIC JEDNEGO `WHEN`
--
-- PostgreSQL nie ma "ALTER FUNCTION ... SET BODY" - cialo funkcji podmienia sie
-- w calosci. Ten plik przepisuje wiec CALE cialo `event_sections(text)`
-- z 20260824095226 (ostatnia definicja w repozytorium) i zmienia w nim
-- DOKLADNIE dwie galezie `CASE`. Wszystko pozostale jest przeniesione bez
-- zmiany znaczenia: sygnatura, `RETURNS TABLE`, `LANGUAGE plpgsql STABLE`,
-- `SECURITY DEFINER`, `SET search_path`, `ORDER BY`, cztery pozostale rachunki
-- `v_has_*` oraz - co najwazniejsze - CALY blok bramkowania (`is_visible`,
-- `visibility`, `events.guest_mode`, `lock_reason`) znak w znak.
--
-- TO NIE JEST ZMIANA BRAMKI WIDOCZNOSCI
--
-- Trzy bramki tej funkcji zostaja nietkniete i warto rozdzielic je od tego,
-- co ten plik rusza:
--   * `is_visible` - czy redakcja sekcje wlaczyla (sekcja wylaczona NIE WRACA);
--   * `visibility` + `min_tier_rank` - dla KOGO sekcja jest otwarta;
--   * `events.guest_mode` - co widzi osoba BEZ ZAPISU.
-- Te trzy odpowiadaja na pytanie "czy WOLNO ci to zobaczyc" i ich wynik
-- (`is_locked`, `lock_reason`) jest identyczny co do bitu jak przed zmiana.
-- `has_content` odpowiada na inne pytanie - "czy jest tu co rysowac" - i tylko
-- ono sie zmienia. W szczegolnosci `contact` NADAL ma domyslna widocznosc
-- `registered` (20260824091955) i NADAL jest zamykany dla gosca przy
-- `guest_mode = 'full'`: sekcja, ktora dostala tresc, nie stala sie sekcja
-- otwarta. Zamek wygrywa z trescia - zamknieta sekcja wraca z karta zaproszenia
-- ZAMIAST karty informacji, i tak bylo przed ta migracja.
--
-- CO SIE DZIEJE Z WYDARZENIAMI JUZ ISTNIEJACYMI
--
--   * Wydarzenia z adresem strukturalnym ZYSKUJA sekcje dojazdu - czyli
--     zaczynaja pokazywac to, co redakcja juz wpisala i co panel juz zapisuje.
--   * Wydarzenia z wypelnionymi jezykami / hashtagiem / adresem wsparcia
--     ZYSKUJA sekcje kontaktu. `events.languages` ma `NOT NULL DEFAULT
--     ARRAY['pl','en']` (20260826090000:35), wiec dla wiekszosci wydarzen
--     bedzie to wiersz "Jezyki: polski, angielski" - PRAWDZIWA tresc, ktora
--     renderer i tak by narysowal, a nie sztucznie zapalona sekcja.
--   * Wydarzenia opisane STARYM, wolnotekstowym `location` NIE TRACA nic
--     PRZEZ TA MIGRACJE - i to jest wazna roznica, bo brzmi odwrotnie.
--     Sekcje dojazdu odsiewa im JUZ DZIS front, w `EventPageSections.tsx:77`,
--     ktory dla sekcji praktycznej wymaga `hasPracticalContent(practical, key)`
--     NIEZALEZNIE od `has_content` z bazy - a `EventPracticalInfo`
--     (`events.$slug.index.tsx:380-389`) w ogole nie niesie pola `location`,
--     wiec `eventAddressLine` nie ma z czego zlozyc linii. Innymi slowy: dla
--     takiego wydarzenia sekcja jest niewidoczna przed ta migracja i po niej,
--     a `has_content = true` z bazy nie mial jak jej pokazac. To osobna luka,
--     mieszkajaca w `eventPractical`/`eventAddress`, i ta migracja jej NIE
--     dotyka - patrz "CZEGO TEN PLIK NIE ROBI".
--
-- CZEGO TEN PLIK NIE ROBI - I DLACZEGO
--   * NIE naprawia starego `location` na froncie. Zeby wydarzenie sprzed panelu
--     Wydarzen odzyskalo sekcje dojazdu, `EventPracticalInfo` musialoby przyjac
--     szosty czlon adresu, a `eventAddressLine` - potraktowac go jako pelna
--     linie. To zmiana w REGULE PREZENTACJI, dotyka trzech miejsc skladajacych
--     ten sam adres (panel, strona, `schema.org/Event`) i nalezy zdecydowac,
--     czy wolnotekstowa sala ma stac obok ulicy, czy zamiast niej. Poza
--     zakresem rachunku `has_content`.
--   * NIE rusza domyslnej widocznosci `contact` (`registered`). To DECYZJA
--     WLASCICIELA z 20260824091955, nie usterka: pytanie, czy jezyki, hashtag
--     i adres wsparcia maja byc widoczne dla gosca bez zapisu, jest pytaniem
--     o polityke, a nie o poprawnosc rachunku.
--   * NIE rusza `materials` (nadal `NULL` - zrodla w bazie nie ma) ani zadnej
--     z piatki, ktora ma prawdziwe zrodlo w bazie. `description`, `agenda`,
--     `speakers`, `sponsors` i `registration` NADAL wracaja jako BOOLEAN -
--     naprawa polegajaca na wyzerowaniu calej kolumny `has_content` nie byla by
--     naprawa, tylko wylaczeniem mechanizmu, i ma na to osobna asercje
--     w harnessie.
--   * NIE dodaje `host_user_id` do zadnej sekcji. Gospodarz nie jest dzis
--     rysowany na stronie NIGDZIE: `EventPracticalSection` dla `contact` rysuje
--     wylacznie jezyki, hashtag i adres wsparcia. Warunek zostal wiec
--     USUNIETY, a nie przeniesiony - sekcja, ktora nie rysuje gospodarza, nie
--     moze miec tresci z tego, ze gospodarz istnieje.
--   * NIE dotyka grantow kolumnowych na `events`. `join_url` i `recording_url`
--     pozostaja odciete od klienckiego SELECT-u - ta funkcja czyta caly wiersz
--     jako `SECURITY DEFINER` i nie oddaje z niego ANI JEDNEJ kolumny, tylko
--     boole i etykiety sekcji.
--
-- PLASZCZYZNA TRESCI, NIE PANELU
--   `event_sections` jest funkcja PUBLICZNA: najemce bierze z
--   `public_tenant_id()` (naglowek hosta), nie z `profiles`, i nie wola
--   `has_role()` ani razu. Ten plik tego nie zmienia - dopisanie tu bramki
--   rolowej zlamaloby kontrakt modulu (`check:sql-tenant-scope`).
--
-- events-harness: include
--   Znacznik dla `scripts/events-harness/run.sh`. Selektor po tresci lapie
--   `public.admin_event_` albo `events_tenant_id_key`, a ta migracja definiuje
--   WYLACZNIE publiczna `public.event_sections` - bez znacznika harness by jej
--   nie zaaplikowal i sprawdzalby rachunek `has_content` SPRZED naprawy, mimo
--   ze asercje z `runtime_test.d/96_section_content_sources.sql` stoja
--   dokladnie na tym rachunku.
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
      -- 'materials': zrodla w bazie nie ma, wiec nie da sie policzyc. NULL,
      -- nie false - "nie wiem" i "policzone, wyszlo zero" to dwie rozne
      -- odpowiedzi i front reaguje na nie inaczej.
      ELSE NULL
    END
  FROM gated g
  ORDER BY g.ord, g.k;
END;
$$;

REVOKE ALL ON FUNCTION public.event_sections(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_sections(text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_sections(text) IS
  'Uklad sekcji strony opublikowanego wydarzenia dla WOLAJACEGO: kolejnosc, nadpisany naglowek, bramka (is_locked + lock_reason z visibility i events.guest_mode) oraz has_content liczony z prawdziwego zrodla kazdej sekcji. Boolean wraca dla piatki, ktora baza umie policzyc: description_pl/_en, event_sessions, event_speakers + event_session_speakers, event_sponsors, registration_mode. NULL ("nie da sie policzyc") wraca dla materials oraz dla map i contact - pustke tych dwoch liczy front z tych samych kolumn, z ktorych rysuje tresc (lib/events/eventPractical). Sekcje wylaczone przez redakcje nie wracaja; zamkniete wracaja z powodem.';
