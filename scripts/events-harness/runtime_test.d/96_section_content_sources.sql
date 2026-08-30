-- ============================================================================
-- 96_section_content_sources - `has_content` W `event_sections`: KTO LICZY PUSTKE
--
-- PO CO TEN PLIK ISTNIEJE
-- `public.event_sections(p_slug)` oddaje frontowi kolumne `has_content`, a front
-- na jej podstawie UBIJA sekcje: `shouldRenderSection`
-- (src/lib/events/eventSections.ts:176-177) mowi
-- `section.isLocked || section.hasContent !== false`. Czyli `false` z bazy
-- USUWA sekcje ze strony, a `NULL` ("baza nie wie") ja PRZEPUSZCZA i oddaje
-- rozstrzygniecie rendererowi.
--
-- Ten rachunek siedzi w ciele plpgsql, a cial plpgsql `CREATE FUNCTION` NIE
-- SPRAWDZA - czysty przebieg replayu migracji nie dowodzi o nim NICZEGO.
-- Dwa `WHEN` byly wprost zle i nie zauwazyla tego zadna bramka:
--   * `map`     czytal stare, wolnotekstowe `events.location`, ktorego panel
--               Wydarzen w ogole nie pokazuje ani nie zapisuje;
--   * `contact` czytal `events.host_user_id`, ktorego NIC w calym repozytorium
--               nie ustawia - warunek byl stale `false`, wiec sekcja kontaktu
--               nie mogla miec tresci NIGDY.
-- Oba oddawaly wiec `false`, a `false` ubija sekcje. Migracja
-- 20260827130000 zmienia je na `NULL`, bo pustke tych dwoch sekcji liczy front
-- z tych samych kolumn, z ktorych rysuje tresc (`lib/events/eventPractical`) -
-- i to jest kontrakt zapisany w naglowku tamtego pliku (:20-23).
--
-- CZTERY EKSPERYMENTY, KAZDY Z KONTRAPUNKTEM:
--   (a) `map` i `contact` WRACAJA z funkcji i maja `has_content IS NULL` -
--       dla wydarzenia z adresem strukturalnym, dla wydarzenia opisanego STARYM
--       `location` i dla wydarzenia BEZ CZEGOKOLWIEK. NULL jest kontraktem,
--       a nie skutkiem danych, wiec musi byc ten sam we wszystkich trzech.
--   (b) KONTRAPUNKT, bez ktorego (a) nie znaczy nic: piatka sekcji z prawdziwym
--       zrodlem w bazie NADAL wraca jako BOOLEAN, i to w OBIE strony (`true`
--       tam, gdzie tresc jest, `false` tam, gdzie jej nie ma). Bez tego
--       „naprawa" mogla by polegac na wyzerowaniu calej kolumny `has_content`,
--       czyli na wylaczeniu mechanizmu - i przeszla by asercje (a).
--   (c) `materials` jest BOOLEAN-em w obie strony, mierzonym na trzech progach
--       dwustopniowej publikacji (material / przypiecie partnera) - razem
--       z dowodem, ze nadpisanie z `event_page_sections` w ogole dziala, bo
--       domyslnie ta sekcja jest niewidoczna i bez wiersza redakcji nie
--       wrocila by wcale. Do 20260829221500 stal tu NULL z uzasadnieniem
--       „zrodla w bazie nie ma"; zrodlo (`event_sponsor_materials`) istnialo
--       od 20260823160000, a NULL kosztowal samotny naglowek nad pustka.
--   (d) BRAMKI SA NIETKNIETE. To jest asercja o tym, czego migracja NIE miala
--       zmienic: przy `guest_mode = 'full'` gosc bez zapisu ma `map` OTWARTA
--       (`lock_reason = 'none'`), a `contact` ZAMKNIETA z powodem
--       `registration_required`. Sekcja, ktora dostala tresc, nie stala sie
--       sekcja otwarta.
--
-- CZEGO TEN PLIK NIE SPRAWDZA
--   * nie sprawdza FRONTU. To, ze `NULL` przechodzi przez `shouldRenderSection`
--     i ze `hasPracticalContent` odsiewa pusta karte PRZED naglowkiem, mierza
--     testy vitest (`src/components/events/__tests__/eventPageSections.test.tsx`
--     oraz `src/lib/events/__tests__/eventPublicPresentation.test.ts`). Harness
--     nie widzi Reacta.
--   * nie sprawdza polityk RLS na `events` ani `event_page_sections` - to zakres
--     80_admin_only (harness pracuje jako wlasciciel, ktory RLS omija).
--   * nie sprawdza pozostalych funkcji z 20260823170000 (`event_page_header`,
--     `events_public_list`) - maja wlasne zakresy.
--   * nie sprawdza sekcji `agenda`/`speakers`/`sponsors` po stronie `true`.
--     Zaseedowanie sesji, prelegenta i partnera po to, zeby zobaczyc boolean,
--     ktory dla tych trzech kluczy jest NIETKNIETY ta migracja, kupilo by
--     dowod o cudzym zakresie za trzy dodatkowe fikstury. Polaryzacje boolean-a
--     dowodza tu `description` i `registration` - w obie strony.
--
-- SPRZATANIE. Caly plik pracuje w transakcji zakonczonej ROLLBACK-iem, wiec nie
-- zostawia ani wiersza. Aktorzy i wydarzenia sa WLASNE, nie pozyczone z innych
-- plikow - pliki w runtime_test.d musza byc niezalezne od siebie i od kolejnosci.
-- ============================================================================

\echo '== 96 zrodla tresci sekcji: NULL dla map i contact, boolean dla reszty =='

BEGIN;

-- ---------------------------------------------------------------------------
-- ATRAPA SPOZA MODULU, BEZ KTOREJ `event_sections` NIE DA SIE WYWOLAC
--
-- Cialo funkcji liczy `v_has_speakers` z legacy `public.event_speakers`
-- (20260714130000:287-292), a tej tabeli harness modulu Wydarzen NIE MA:
-- powstaje w migracji huba ekspertow, ktorej selektor po tresci nie lapie.
-- Replay przechodzi, bo cial plpgsql `CREATE FUNCTION` nie sprawdza - dopiero
-- WYWOLANIE przewraca sie na `relation "public.event_speakers" does not exist`.
-- To jest zresztą drugi, mimochodem zdobyty dowod na to, po co ten plik
-- istnieje: przed nim NIC w harnessie nie wolalo `event_sections`.
--
-- Atrapa wchodzi TUTAJ, a nie do `harness.sql`, i to jest swiadome: dokladnie
-- tak samo robi `40_speakers.sql:91-96` (ta sama tabela, ten sam powod), a plik
-- asercji ma byc NIEZALEZNY - tabela zalozona w tej transakcji ginie razem
-- z ROLLBACK-iem i nie zmienia schematu dla plikow, ktore biegna po tym.
-- Ksztalt jest przepisany z oryginalu: PK (event_id, user_id) i ZERO tenant_id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_speakers (
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, user_id)
);

-- Atrapa musi byc PRAWDZIWA, nie deklarowana: bez tej asercji literowka
-- w nazwie tabeli dawalaby cichy brak, a kolejne asercje mowilyby o czyms
-- innym, niz mysla.
SELECT pg_temp.assert(
  (SELECT count(*) = 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = 'event_speakers'),
  '96/atrapa: legacy event_speakers stoi (event_sections liczy z niej prelegentow)');

-- ---------------------------------------------------------------------------
-- SCENOGRAFIA: TRZY WYDARZENIA, TRZY SPOSOBY OPISANIA TEGO SAMEGO
--
--   S1 „strukturalne" - adres w PIECIU kolumnach panelu, `location` PUSTE,
--      jezyki, hashtag i adres wsparcia wpisane, opis po polsku, zapisy `rsvp`.
--      To wydarzenie redagowane dzisiejszym panelem - i dokladnie ono traci
--      sekcje dojazdu i kontaktu przed naprawa.
--   S2 „stare" - wolnotekstowe `location`, WSZYSTKIE kolumny strukturalne NULL.
--      Wydarzenie sprzed panelu Wydarzen; wchodzi tu jako REGRESJA.
--   S3 „puste" - ani `location`, ani zadna kolumna adresu, `languages = '{}'`,
--      bez hashtagu, bez adresu wsparcia, BEZ opisow, zapisy `none`.
--      Kontrapunkt: to na nim boolean musi wyjsc `false`.
--
-- `guest_mode = 'full'` we wszystkich trzech jest WYBOREM, nie kopia domyslnej
-- wartosci ('teaser'): tylko przy 'full' bramka gosca przepuszcza `map`
-- i zamyka WYLACZNIE `contact`, a wiec tylko wtedy asercja (d) rozroznia te dwie
-- sekcje. Przy 'teaser' obie byly by zamkniete i (d) nie dowodzila by niczego.
-- `kind` bierzemy z CHECK-a atrapy `events` ('webinar' jest na liscie).
-- ---------------------------------------------------------------------------
INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en,
   description_pl, description_en,
   starts_at, status, kind, guest_mode, registration_mode,
   location, street_address, postal_code, city, region, country,
   languages, social_hashtag, support_email)
VALUES
  ('96000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'sec-struct', 'Kongres strukturalny', 'Structured congress',
   'Dwa dni rozmow o bezpieczenstwie gospodarczym.', NULL,
   now() + interval '30 days', 'published', 'webinar', 'full', 'rsvp',
   NULL, 'Krakowskie Przedmiescie 42/44', '00-325', 'Warszawa', NULL, 'PL',
   ARRAY['pl', 'en']::text[], 'kongresNES', 'kontakt@example.test'),
  ('96000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'sec-legacy', 'Kongres stary', 'Legacy congress',
   NULL, NULL,
   now() + interval '31 days', 'published', 'webinar', 'full', 'rsvp',
   'Hotel Bristol, Warszawa', NULL, NULL, NULL, NULL, NULL,
   ARRAY[]::text[], NULL, NULL),
  ('96000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'sec-bare', 'Kongres pusty', 'Bare congress',
   NULL, NULL,
   now() + interval '32 days', 'published', 'webinar', 'full', 'none',
   NULL, NULL, NULL, NULL, NULL, NULL,
   ARRAY[]::text[], NULL, NULL);

-- Front czyta sekcje takze bez logowania - i to jest tozsamosc, w ktorej
-- usterka byla widoczna dla uczestnika.
SELECT pg_temp.act_as(NULL, NULL);

-- ── (a) `map` I `contact`: WRACAJA I MAJA `has_content IS NULL` ─────────────
-- NAJPIERW OBECNOSC, bo asercja o wartosci `IS NULL` na braku wiersza
-- przechodzila by na pustym wyniku - `SELECT ... IS NULL` z zera wierszy daje
-- NULL, a `pg_temp.assert` odrzuca NULL, ale `NOT EXISTS`-owa forma nie.
-- Dlatego kolejnosc jest taka, a nie odwrotna.
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sections('sec-struct') s
    WHERE s.section_key IN ('map', 'contact')) = 2,
  '96/(a): map i contact WRACAJA z event_sections (nie wypadaja przez filtr visible)');

SELECT pg_temp.assert(
  (SELECT bool_and(s.has_content IS NULL) FROM public.event_sections('sec-struct') s
    WHERE s.section_key IN ('map', 'contact')),
  '96/(a): adres strukturalny + PUSTE location -> map i contact maja has_content NULL');

-- REGRESJA. Wydarzenie opisane starym `location` dostaje DOKLADNIE TO SAMO
-- NULL. Baza przestala zgadywac w obie strony - nie „zgaduje inaczej".
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sections('sec-legacy') s
    WHERE s.section_key IN ('map', 'contact')) = 2,
  '96/(a): stare wydarzenie z location tez dostaje obie sekcje w odpowiedzi');

SELECT pg_temp.assert(
  (SELECT bool_and(s.has_content IS NULL) FROM public.event_sections('sec-legacy') s
    WHERE s.section_key IN ('map', 'contact')),
  '96/(a): stare, wolnotekstowe location -> has_content NULL, a nie true');

-- NULL JEST KONTRAKTEM, NIE SKUTKIEM DANYCH. Wydarzenie bez ANI JEDNEJ z tych
-- kolumn dostaje ten sam NULL - gdyby baza probowala liczyc pustke, tutaj
-- wyszlo by jej `false`, czyli sekcja zniknela by ze strony bez pytania frontu.
SELECT pg_temp.assert(
  (SELECT bool_and(s.has_content IS NULL) FROM public.event_sections('sec-bare') s
    WHERE s.section_key IN ('map', 'contact')),
  '96/(a): wydarzenie bez adresu i bez kontaktu -> nadal NULL, nie false');

-- ── (b) KONTRAPUNKT: PIATKA Z BAZY NADAL JEST BOOLEAN-EM, W OBIE STRONY ────
-- Bez tej sekcji asercje (a) przechodzily by rowniez dla funkcji, ktora oddaje
-- `NULL` dla WSZYSTKIEGO - a to nie jest naprawa, to wylaczenie mechanizmu.
SELECT pg_temp.assert(
  (SELECT s.has_content FROM public.event_sections('sec-struct') s
    WHERE s.section_key = 'description') = true,
  '96/(b): description z wpisanym opisem -> has_content TRUE (boolean zyje)');

SELECT pg_temp.assert(
  (SELECT s.has_content FROM public.event_sections('sec-bare') s
    WHERE s.section_key = 'description') = false,
  '96/(b): description bez zadnego opisu -> has_content FALSE (druga strona)');

SELECT pg_temp.assert(
  (SELECT s.has_content FROM public.event_sections('sec-struct') s
    WHERE s.section_key = 'registration') = true,
  '96/(b): registration_mode = rsvp -> has_content TRUE');

SELECT pg_temp.assert(
  (SELECT s.has_content FROM public.event_sections('sec-bare') s
    WHERE s.section_key = 'registration') = false,
  '96/(b): registration_mode = none -> has_content FALSE');

-- Trzy sekcje o zrodle TABELARYCZNYM: na pustej bazie musza dac `false`,
-- a nie `NULL`. Ta asercja lapie dokladnie to, czego (a) nie widzi -
-- zamiane boolean-a na NULL w sekcji, ktora baza policzyc UMIE.
SELECT pg_temp.assert(
  (SELECT bool_and(s.has_content = false) FROM public.event_sections('sec-struct') s
    WHERE s.section_key IN ('agenda', 'speakers', 'sponsors')),
  '96/(b): agenda, speakers i sponsors bez wierszy -> FALSE, nie NULL');

-- ── (c) `materials`: BOOLEAN W OBIE STRONY, I DOWOD, ZE NADPISANIE DZIALA ──
-- Domyslnie `materials` ma `is_visible = false` (_event_default_sections),
-- wiec bez wiersza redakcji NIE WRACA WCALE - a asercja o jej `has_content`
-- przechodzila by wtedy na pustym wyniku. Wlaczamy ja wprost i przy okazji
-- dowodzimy, ze cala maszyneria `event_page_sections`, ktorej ta migracja nie
-- rusza, nadal scala sie z lista domyslna.
--
-- DO 20260829221500 STALO TU „has_content NULL - zrodla w bazie nie ma".
-- Zdanie bylo nieprawdziwe: `public.event_sponsor_materials` istnieje od
-- 20260823160000, a `event_sponsor_materials_public` czyta ja dwustopniowym
-- predykatem publikacji. NULL kosztowal uczestnika samotny naglowek
-- „Materialy" nad zdaniem o pustce - front nie ma dla tej sekcji zadnego
-- licznika pustki (odsiewa PRZED naglowkiem wylacznie sekcje praktyczne,
-- bo tylko one maja tresc w propsach). Od tamtej migracji `materials` jest
-- SZOSTA sekcja liczona w bazie i musi byc mierzona W OBIE STRONY, tak jak
-- reszta rodziny w (b).
SELECT pg_temp.assert(
  NOT EXISTS (
    SELECT 1 FROM public.event_sections('sec-struct') s WHERE s.section_key = 'materials'
  ),
  '96/(c): materials domyslnie NIE WRACA (is_visible = false ze wzorca)');

INSERT INTO public.event_page_sections (tenant_id, event_id, section_key, is_visible, visibility)
VALUES ('11111111-1111-1111-1111-111111111111',
        '96000000-0000-0000-0000-000000000001', 'materials', true, 'public');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sections('sec-struct') s
    WHERE s.section_key = 'materials') = 1,
  '96/(c): po wlaczeniu przez redakcje materials WRACA (nadpisanie dziala)');

-- STRONA PIERWSZA: wlaczona sekcja BEZ ani jednego materialu -> FALSE, czyli
-- `shouldRenderSection` ubija ja razem z naglowkiem. To jest cala tresc
-- naprawy; przed nia wychodzil tu NULL i sekcja zostawala na stronie pusta.
SELECT pg_temp.assert(
  (SELECT s.has_content FROM public.event_sections('sec-struct') s
    WHERE s.section_key = 'materials') = false,
  '96/(c): wlaczona sekcja materialow bez ani jednego pliku -> FALSE, nie NULL');

-- ---------------------------------------------------------------------------
-- STRONA DRUGA, I TRZY PROGI PUBLIKACJI PO DRODZE
--
-- Publikacja materialu jest DWUSTOPNIOWA (material I przypiecie partnera),
-- wiec rachunek musi byc mierzony na KAZDYM z trzech stanow, a nie tylko na
-- ostatnim. Bez progow asercja „true na koncu" przechodzilaby rowniez dla
-- rachunku, ktory ignoruje `is_published` - czyli dla sekcji zapalanej
-- szkicem, ktorego czytelnik i tak nie zobaczy.
--
-- Firma i przypiecie sa WLASNE (prefiks 96), nie pozyczone z 30_sponsors -
-- pliki runtime_test.d musza byc niezalezne od siebie i od kolejnosci.
-- ---------------------------------------------------------------------------
INSERT INTO public.crm_companies (id, tenant_id, name, domain)
VALUES ('96c00000-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'Partner Materialowy', 'pm.test');

-- ROLA `partner`, A NIE `sponsor`, I NIE JEST TO OZDOBA:
-- `event_sponsors_published_sponsor_needs_tier` zada poziomu WYLACZNIE od
-- opublikowanego sponsora. Sekcja nazywa sie „materialy partnerskie", wiec
-- partner jest tu i wlasciwa rola, i najkrotsza droga do progu publikacji
-- bez wciagania cennika, ktorego ten plik nie mierzy.
INSERT INTO public.event_sponsors
  (id, tenant_id, event_id, company_id, role, snapshot_name, is_published)
VALUES ('96500000-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111',
        '96000000-0000-0000-0000-000000000001',
        '96c00000-0000-0000-0000-000000000001', 'partner', 'Partner Materialowy', false);

INSERT INTO public.event_sponsor_materials
  (id, tenant_id, event_id, sponsor_id, title_pl, title_en, url, is_published)
VALUES ('96d00000-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111',
        '96000000-0000-0000-0000-000000000001',
        '96500000-0000-0000-0000-000000000001',
        'Prezentacja partnera', 'Partner deck', 'https://cdn.test/deck.pdf', false);

SELECT pg_temp.assert(
  (SELECT s.has_content FROM public.event_sections('sec-struct') s
    WHERE s.section_key = 'materials') = false,
  '96/(c): material SZKIC przy przypieciu SZKICU -> nadal FALSE');

UPDATE public.event_sponsor_materials SET is_published = true
WHERE id = '96d00000-0000-0000-0000-000000000001';

-- PROG, KTORY LAPIE POLOWICZNY RACHUNEK. Material opublikowany, ale partner
-- nieopublikowany: `event_sponsor_materials_public` nie odda tu ani jednego
-- wiersza, wiec sekcja nadal NIE MA tresci. Rachunek liczacy sam
-- `m.is_published` zapalilby ja i zielenil sie na sekcji, ktora dla czytelnika
-- jest pusta - dokladnie ta usterka od nowa, tylko z drugiej strony.
SELECT pg_temp.assert(
  (SELECT s.has_content FROM public.event_sections('sec-struct') s
    WHERE s.section_key = 'materials') = false,
  '96/(c): material opublikowany przy przypieciu SZKICU -> nadal FALSE (prog partnera)');

UPDATE public.event_sponsors SET is_published = true
WHERE id = '96500000-0000-0000-0000-000000000001';

SELECT pg_temp.assert(
  (SELECT s.has_content FROM public.event_sections('sec-struct') s
    WHERE s.section_key = 'materials') = true,
  '96/(c): material I przypiecie opublikowane -> has_content TRUE');

-- KONTRAPUNKT ZGODNOSCI Z POWIERZCHNIA PUBLICZNA. Rachunek i lista maja
-- oddawac te sama odpowiedz - to jest jedyny powod, dla ktorego predykat
-- w `event_sections` jest przepisany z `event_sponsor_materials_public`
-- znak w znak. Bez tej asercji oba moglyby sie rozejsc bez sladu.
SELECT pg_temp.assert(
  (SELECT count(*) > 0 FROM public.event_sponsor_materials_public('sec-struct')),
  '96/(c): ta sama publikacja daje niepusta liste z event_sponsor_materials_public');

-- ZAMEK WYGRYWA Z PUSTKA, TAKZE TUTAJ. Sekcja zamknieta wraca na strone nawet
-- przy zerze materialow, bo karta zaproszenia JEST jej trescia - identycznie
-- jak przy `sponsors`. Bez tej asercji naprawa mogla by po cichu zabrac
-- gosciowi zaproszenie do zapisu.
UPDATE public.event_sponsor_materials SET is_published = false
WHERE id = '96d00000-0000-0000-0000-000000000001';

UPDATE public.event_page_sections SET visibility = 'registered'
WHERE event_id = '96000000-0000-0000-0000-000000000001'
  AND section_key = 'materials';

SELECT pg_temp.assert(
  (SELECT s.is_locked = true AND s.has_content = false
     FROM public.event_sections('sec-struct') s WHERE s.section_key = 'materials'),
  '96/(c): sekcja zamknieta i pusta WRACA z has_content FALSE (zamek rozstrzyga front)');

UPDATE public.event_page_sections SET visibility = 'public'
WHERE event_id = '96000000-0000-0000-0000-000000000001'
  AND section_key = 'materials';

-- ── (d) BRAMKI NIETKNIETE: `map` OTWARTA, `contact` ZAMKNIETA ──────────────
-- To asercja o tym, czego migracja NIE miala zmienic. `contact` ma domyslna
-- widocznosc `registered` I dodatkowo lapie sie na bramke `guest_mode = 'full'`
-- („wszystko poza kontaktami"), wiec dla gosca bez zapisu MUSI wracac zamknieta
-- z nazwanym powodem - mimo ze wlasnie zyskala tresc.
SELECT pg_temp.assert(
  (SELECT s.is_locked = false AND s.lock_reason = 'none'
     FROM public.event_sections('sec-struct') s WHERE s.section_key = 'map'),
  '96/(d): przy guest_mode = full sekcja map jest dla gosca OTWARTA');

-- Ta asercja mierzy bramke WIDOCZNOSCI (`visibility = 'registered'` ze wzorca),
-- a NIE bramke gosca - i wazne, zeby jej etykieta tego nie mylila. Sprawdzone
-- eksperymentalnie: usuniecie z funkcji galezi `guest_mode = 'full' AND
-- m.k = 'contact'` NIE czerwieni tej asercji, bo wczesniejsza galaz
-- (`m.vis = 'registered' AND NOT v_registered`) dopasowuje sie PIERWSZA.
SELECT pg_temp.assert(
  (SELECT s.is_locked = true AND s.lock_reason = 'registration_required'
     FROM public.event_sections('sec-struct') s WHERE s.section_key = 'contact'),
  '96/(d): contact zamkniety dla gosca domyslna widocznoscia registered');

-- A TERAZ SAMA BRAMKA GOSCA, na wlasnych nogach. Redakcja otwiera `contact`
-- dla wszystkich (`visibility = 'public'`), wiec galaz o widocznosci przestaje
-- sie dopasowywac - i jedyne, co moze jeszcze zamknac te sekcje gosciowi, to
-- `events.guest_mode = 'full'` („wszystko poza kontaktami"). Bez tej asercji
-- galaz guest_mode dla kontaktu nie jest w harnessie mierzona ANI RAZ.
INSERT INTO public.event_page_sections (tenant_id, event_id, section_key, is_visible, visibility)
VALUES ('11111111-1111-1111-1111-111111111111',
        '96000000-0000-0000-0000-000000000001', 'contact', true, 'public');

SELECT pg_temp.assert(
  (SELECT s.visibility = 'public' FROM public.event_sections('sec-struct') s
    WHERE s.section_key = 'contact'),
  '96/(d): nadpisanie widocznosci contact na public weszlo (kontrapunkt)');

SELECT pg_temp.assert(
  (SELECT s.is_locked = true AND s.lock_reason = 'registration_required'
     FROM public.event_sections('sec-struct') s WHERE s.section_key = 'contact'),
  '96/(d): contact otwarty przez redakcje NADAL zamyka gosciowi guest_mode = full');

-- KONTRAPUNKT BRAMKI GOSCA: przy `guest_mode = 'teaser'` ta sama galaz zamyka
-- takze `map` (teaser przepuszcza tylko opis, agende i zapisy). Bez tego
-- asercja wyzej nie odroznia „guest_mode dziala" od „contact zawsze zamkniety".
UPDATE public.events SET guest_mode = 'teaser'
WHERE id = '96000000-0000-0000-0000-000000000001';

SELECT pg_temp.assert(
  (SELECT s.is_locked = true AND s.lock_reason = 'registration_required'
     FROM public.event_sections('sec-struct') s WHERE s.section_key = 'map'),
  '96/(d): przy guest_mode = teaser gosc traci takze map (bramka zyje)');

UPDATE public.events SET guest_mode = 'full'
WHERE id = '96000000-0000-0000-0000-000000000001';

-- KONTRAPUNKT ZAMKA: zamek nie zabiera tresci i tresc nie otwiera zamka. Te dwie
-- kolumny sa NIEZALEZNE i mieszanie ich bylo by cala usterka od nowa, tylko
-- z drugiej strony.
SELECT pg_temp.assert(
  (SELECT s.has_content IS NULL FROM public.event_sections('sec-struct') s
    WHERE s.section_key = 'contact'),
  '96/(d): zamknieta sekcja contact i tak niesie has_content NULL (kolumny niezalezne)');

-- Wydarzenie NIEOPUBLIKOWANE nie ma sekcji w ogole - bramka statusu stoi wyzej
-- niz caly rachunek `has_content` i ta migracja jej nie dotyka.
UPDATE public.events SET status = 'draft'
WHERE id = '96000000-0000-0000-0000-000000000001';

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sections('sec-struct')) = 0,
  '96/(d): szkic wydarzenia nie oddaje ANI JEDNEJ sekcji');

ROLLBACK;

\echo '== 96 zrodla tresci sekcji: koniec =='
