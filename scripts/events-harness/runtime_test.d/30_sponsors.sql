-- ============================================================================
-- 30_sponsors - SPONSORZY, PARTNERZY I WYSTAWCY ZSYNCHRONIZOWANI Z CRM
--
-- PO CO TEN PLIK ISTNIEJE
-- Wykonuje na czystej bazie mechanike migracji
-- 20260823160000_event_sponsors_companies.sql - piec tabel, dziewietnascie
-- funkcji, dziesiec polityk RLS - czyli to, czego zadna bramka czytajaca SQL
-- jako TEKST nie zobaczy.
--
-- SEDNEM TEGO PODMODULU JEST MIGAWKA PREZENTACJI i dlatego jest ona tu
-- ASERCJA, nie komentarzem: sponsor zostaje zapisany, potem kartoteka CRM
-- idzie dalej (przebrandowanie, nowy logotyp), a strona wydarzenia MUSI
-- pokazywac stan z dnia zapisu. Sprawdzamy to trzykrotnie i z trzech stron:
--   (1) migawka w tabeli i na PUBLICZNEJ STRONIE nie drgnela;
--   (2) lista panelu RAPORTUJE rozjazd i wskazuje KTORE pola sie roznia;
--   (3) po JAWNYM odswiezeniu migawka zgadza sie z kartoteka - i dopiero wtedy
--       zmienia sie strona publiczna.
-- Gdyby migawka byla widokiem na CRM, asercja (1) byla by czerwona. Gdyby
-- odswiezenie bylo triggerem, czerwona byla by asercja (2). Oba bledy sa
-- niewidoczne dla bramek tekstowych i oba przepisalyby archiwum bez decyzji
-- redakcji.
--
-- IZOLACJA NAJEMCOW jest tu testem, nie obietnica: dwoch najemcow, kazdy
-- z wlasnym wydarzeniem, wlasna kartoteka firm i osob, wlasnym poziomem
-- sponsorskim i wlasnym przypieciem. KAZDA funkcja listujaca modulu
-- (`admin_event_sponsor_tiers_list`, `admin_event_sponsors_list`,
-- `admin_event_sponsor_detail`, `admin_event_sponsor_companies_search`,
-- `event_sponsors_public`, `event_sponsor_materials_public`) jest pytana
-- Z OBU STRON, plus KONTRAPUNKT, ze kazdy widzi swoj wlasny wiersz - bez
-- kontrapunktu test nie odroznia izolacji od blokady, bo przy deny-all obie
-- polowy przechodza na pustym wyniku.
--
-- CZEGO TEN PLIK NIE SPRAWDZA
--   * nie sprawdza sesji agendy (10_), zapisow (20_), frontu (40_), odprawy na
--     miejscu (50_) ani spotkan (60_) - tamte migracje maja wlasne pliki;
--   * NIE SPRAWDZA SERIALIZACJI LIMITU POZIOMU POD WSPOLBIEZNOSCIA. Migracja
--     bierze `SELECT ... FOR UPDATE` na wierszu poziomu i to jest dobra
--     konstrukcja, ale dowod wymaga DWOCH realnych sesji serwera, a wiec fazy
--     zacommitowanej (wzorzec z 20_registration, sekcja wspolbieznosci). Tutaj
--     sprawdzamy, ze limit JEST egzekwowany (`tier_full`, `tier_over_capacity`);
--     to, ze jest egzekwowany BEZ WYSCIGU, zostaje luka zgloszona w raporcie;
--   * nie sprawdza warstwy widoku (`src/lib/events/sponsors.ts`,
--     komponent widgetu `event-sponsors`) - to inne bramki. Sprawdzamy KSZTALT
--     danych oddawanych przez publiczny RPC, nie ich renderowanie;
--   * nie sprawdza wysylki korespondencji do osob kontaktowych - migracja jej
--     nie robi, wiec nie ma czego testowac;
--   * nie sprawdza wydajnosci ani planow zapytan - baza jest pusta;
--   * nie sprawdza atrap platformy (`harness.sql`) - one sa scenografia,
--     nie przedmiotem testu.
--
-- SPRZATANIE. Caly plik pracuje w JEDNEJ transakcji zakonczonej ROLLBACK-iem,
-- wiec nie zostawia po sobie ani wiersza, ani kolumny - takze tych atrap,
-- ktore doklada sekcja 0. To jest kontrakt kazdego pliku w runtime_test.d.
-- ============================================================================

\echo '== 30 sponsorzy: migawka prezentacji, CRM, poziomy, plaszczyzna tresci =='

BEGIN;

-- ---------------------------------------------------------------------------
-- SEKCJA 0: BRAKUJACE KOLUMNY ATRAP KARTOTEKI - I ZGLOSZENIE, ZE BRAKUJE ICH
--           W harness.sql
--
-- Atrapa `crm_companies` z `harness.sql` ma tylko `id/tenant_id/name/name_norm/
-- domain/aliases`, a atrapa `crm_leads` tylko `id/tenant_id/email`. Migracja
-- 20260823160000 czyta z kartoteki CZTERY POLA MIGAWKI (`name`, `logo_url`,
-- `website`, `country`), dodatkowo `city` i `domain` do wyszukiwarki firm, oraz
-- `first_name`, `last_name`, `phone`, `position`, `company_id` osoby do panelu
-- kontaktow. Kolumny te dokladaja migracje SPRZED modulu (20260721200229,
-- 20260722093241, 20260706201356, 20260722094744), ktorych harness nie
-- replayuje.
--
-- Cialo funkcji plpgsql NIE JEST rozwiazywane nazwowo przy `CREATE FUNCTION`,
-- wiec replay migracji przechodzi na zielono, a `admin_event_sponsor_save()`
-- pada dopiero przy PIERWSZYM WYWOLANIU na "record has no field". To jest LUKA
-- ATRAPY, nie blad migracji: na produkcji wszystkie te kolumny istnieja.
--
-- DLACZEGO SIEDZI TO TUTAJ, A NIE W harness.sql. Ta faza pisze DOKLADNIE JEDEN
-- plik, a rownolegle powstaje pieciu innych autorow; wspolna edycja
-- `harness.sql` konczy sie kolizja. MIEJSCE DOCELOWE TYCH KOLUMN JEST
-- W harness.sql (atrapa ma deklarowac to, czego modul wymaga) i jest zgloszone
-- w raporcie `sponsors-assertions.md`, sekcja "Luki harnessu".
--
-- Dokladanie jest w tej samej transakcji, ktora sie WYCOFUJE, wiec nie mutuje
-- wspolnego schematu dla plikow biegnacych po tym - w odroznieniu od pliku,
-- ktory kiedys dolozyl kolumny do `events` POZA transakcja (patrz komentarz
-- przy atrapie `events` w harness.sql). `IF NOT EXISTS` jest po to, zeby ten
-- plik nie przewrocil sie w dniu, w ktorym atrapa te kolumny dostanie.
-- ---------------------------------------------------------------------------
ALTER TABLE public.crm_companies
  ADD COLUMN IF NOT EXISTS website  text,
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS city     text,
  ADD COLUMN IF NOT EXISTS country  text;

ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name  text,
  ADD COLUMN IF NOT EXISTS phone      text,
  ADD COLUMN IF NOT EXISTS position   text,
  ADD COLUMN IF NOT EXISTS company_id uuid;

-- Bez tych kolumn zaden RPC panelu nie da sie wykonac ANI RAZU, wiec ich
-- obecnosc jest ASERCJA, a nie zalozeniem.
SELECT pg_temp.assert(
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'crm_companies'
      AND column_name IN ('name', 'logo_url', 'website', 'country', 'city', 'domain')) = 6,
  '30/atrapy: kartoteka firm ma szesc pol czytanych przez modul sponsorow');

SELECT pg_temp.assert(
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'crm_leads'
      AND column_name IN ('first_name', 'last_name', 'email', 'phone',
                          'position', 'company_id')) = 6,
  '30/atrapy: kartoteka osob ma szesc pol czytanych przez panel kontaktow');

-- ---------------------------------------------------------------------------
-- SEKCJA 1: SCENOGRAFIA - DWOCH NAJEMCOW, KAZDY Z WLASNA KARTOTEKA
--
-- Najemca A to najemca publiczny harnessu (11111111...), najemca B jest nowy.
-- Kazdy ma wlasnego redaktora, wlasne wydarzenie, wlasne firmy i wlasne osoby -
-- inaczej asercja o izolacji nie ma czego NIE WIDZIEC, a asercja
-- o kontrapunkcie nie ma czego widziec.
--
-- Identyfikatory sa STALE i czytelne (a1..a6 firmy najemcy A, b1 firma
-- najemcy B), zeby asercje czytaly sie same, a nie przez podzapytanie po
-- kluczu naturalnym.
--
-- `website` firmy pierwszej jest wpisany BEZ SCHEMATU ('orlen.pl') - dokladnie
-- tak, jak trafia do kartoteki od handlowca. To nie jest ozdoba fixture'a: na
-- tym stoi asercja o `_event_sponsor_web_url()` jako JEDNYM zrodle normalizacji
-- (sekcja 4, "fałszywy rozjazd adresu").
-- ---------------------------------------------------------------------------
INSERT INTO public.tenants (id, name, slug) VALUES
  ('30000000-0000-0000-0000-0000000000b0', 'Tenant B (sponsorzy)', 'tb-spo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('30a00000-0000-0000-0000-0000000000a1', 'sponsor.admin.a@example.org'),
  ('30a00000-0000-0000-0000-0000000000a2', 'sponsor.editor.a@example.org'),
  ('30a00000-0000-0000-0000-0000000000a3', 'sponsor.member.a@example.org'),
  ('30a00000-0000-0000-0000-0000000000a4', 'sponsor.author.a@example.org'),
  ('30a00000-0000-0000-0000-0000000000b1', 'sponsor.editor.b@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role) VALUES
  ('30a00000-0000-0000-0000-0000000000a1', 'admin'),
  ('30a00000-0000-0000-0000-0000000000a2', 'editor'),
  ('30a00000-0000-0000-0000-0000000000a4', 'author'),
  ('30a00000-0000-0000-0000-0000000000b1', 'editor')
ON CONFLICT DO NOTHING;

-- Rola bez profilu dostaje `forbidden: caller has no tenant` - i tak samo
-- zachowa sie produkcja. Uczestnik (`a3`) profil ma, roli nie ma.
INSERT INTO public.profiles (id, tenant_id) VALUES
  ('30a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111'),
  ('30a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111'),
  ('30a00000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111'),
  ('30a00000-0000-0000-0000-0000000000a4', '11111111-1111-1111-1111-111111111111'),
  ('30a00000-0000-0000-0000-0000000000b1', '30000000-0000-0000-0000-0000000000b0')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, status)
VALUES
  ('30e00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'sponsors-kongres-a', 'Kongres A', 'Congress A', now() + interval '30 days', 'published'),
  ('30e00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   'sponsors-gala-a', 'Gala A', 'Gala A', now() + interval '60 days', 'draft'),
  ('30e00000-0000-0000-0000-0000000000b1', '30000000-0000-0000-0000-0000000000b0',
   'sponsors-kongres-b', 'Kongres B', 'Congress B', now() + interval '30 days', 'published')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.crm_companies
  (id, tenant_id, name, domain, website, city, country, logo_url)
VALUES
  ('30c00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'Orlen Energia', 'orlen.pl', 'orlen.pl', 'Plock', 'Polska', 'https://cdn.test/orlen.png'),
  ('30c00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   'Bank Spoldzielczy', 'bs.pl', 'https://bs.pl', 'Warszawa', 'Polska', NULL),
  ('30c00000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111',
   'Media House', 'mh.pl', NULL, 'Krakow', 'Polska', NULL),
  ('30c00000-0000-0000-0000-0000000000a4', '11111111-1111-1111-1111-111111111111',
   'Techno Stoisko', 'ts.pl', NULL, 'Gdansk', 'Polska', NULL),
  ('30c00000-0000-0000-0000-0000000000a5', '11111111-1111-1111-1111-111111111111',
   'Firma Piata', 'p5.pl', NULL, 'Lodz', 'Polska', NULL),
  ('30c00000-0000-0000-0000-0000000000a6', '11111111-1111-1111-1111-111111111111',
   'Zeta Nieprzypieta', 'zeta.pl', NULL, 'Poznan', 'Polska', NULL),
  ('30c00000-0000-0000-0000-0000000000b1', '30000000-0000-0000-0000-0000000000b0',
   'Obca Firma', 'obca.de', NULL, 'Berlin', 'Niemcy', NULL)
ON CONFLICT (id) DO NOTHING;

-- Jan Kowalski nalezy do INNEJ firmy niz ta, ktora obsluguje - to jest uklad
-- agencyjny, ktory migracja swiadomie DOPUSZCZA (komentarz przy tabeli
-- `event_sponsor_contacts`). Panel go pokazuje, nie zabrania.
INSERT INTO public.crm_leads
  (id, tenant_id, email, first_name, last_name, phone, position, company_id)
VALUES
  ('30d00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'anna@orlen.pl', 'Anna', 'Nowak', '+48 500 100 200', 'Dyrektor marketingu',
   '30c00000-0000-0000-0000-0000000000a1'),
  ('30d00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   'jan@agencja.pl', 'Jan', 'Kowalski', '+48 500 100 201', 'Account manager',
   '30c00000-0000-0000-0000-0000000000a2'),
  ('30d00000-0000-0000-0000-0000000000b1', '30000000-0000-0000-0000-0000000000b0',
   'klaus@obca.de', 'Klaus', 'Mueller', NULL, NULL,
   '30c00000-0000-0000-0000-0000000000b1')
ON CONFLICT (id) DO NOTHING;

-- Slownik identyfikatorow dynamicznych. Funkcje zwracaja uuid nowych wierszy,
-- a asercje w kolejnych sekcjach musza je znac - w jednej transakcji nie ma
-- innego sposobu przekazania ich miedzy blokami DO.
CREATE TEMP TABLE spo_q (k text PRIMARY KEY, u uuid) ON COMMIT DROP;

-- ---------------------------------------------------------------------------
-- SEKCJA 2: POZIOMY SPONSORSKIE I SWIADCZENIA
--
-- Poziom nalezy do JEDNEGO wydarzenia, `key` jest niezmienny po zapisie,
-- swiadczenia sa wierszami podmienianymi WSADOWO tylko wtedy, gdy klient
-- przyslal klucz `benefits` - brak klucza znaczy "nie dotykaj listy" i to jest
-- KONTRAKT, nie skutek uboczny. Kazde z tych trzech zdan da sie zlamac
-- osobno, wiec kazde ma osobna asercje.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('30a00000-0000-0000-0000-0000000000a1',
                      '11111111-1111-1111-1111-111111111111');

DO $do$
DECLARE
  v_diamond uuid;
  v_gold uuid;
  v_media uuid;
  v_cnt integer;
  v_txt text;
  v_rec record;
BEGIN
  v_diamond := public.admin_event_sponsor_tier_save(jsonb_build_object(
    'event_id', '30e00000-0000-0000-0000-0000000000a1',
    'key', 'diamond', 'name_pl', 'Diamentowy', 'name_en', 'Diamond',
    'description_pl', 'Najwyzszy poziom.', 'description_en', 'Top level.',
    'rank', 100, 'accent_color', '#1122aa', 'logo_size', 'lg',
    'max_companies', 2, 'sort_order', 10,
    'benefits', jsonb_build_array(
      jsonb_build_object('label_pl', 'Logotyp na scianie glownej',
                         'label_en', 'Logo on the main wall'),
      jsonb_build_object('label_pl', 'Wystapienie plenarne',
                         'label_en', 'Plenary talk'),
      -- Pozycja bez tekstu w obu jezykach MUSI zostac odsiana - inaczej
      -- formularz z pustym wierszem produkuje puste kropki na stronie oferty.
      jsonb_build_object('label_pl', '', 'label_en', 'do odsiania')
    )
  ));
  PERFORM pg_temp.assert(v_diamond IS NOT NULL, '30/poziomy: poziom diamond zapisany');
  INSERT INTO spo_q VALUES ('diamond', v_diamond);

  SELECT count(*)::integer INTO v_cnt
  FROM public.event_sponsor_tier_benefits b WHERE b.tier_id = v_diamond;
  PERFORM pg_temp.assert(v_cnt = 2,
    '30/poziomy: swiadczenie bez tekstu w obu jezykach odsiane (2 z 3)');

  v_gold := public.admin_event_sponsor_tier_save(jsonb_build_object(
    'event_id', '30e00000-0000-0000-0000-0000000000a1',
    'key', 'gold', 'name_pl', 'Zloty', 'name_en', 'Gold',
    'rank', 50, 'sort_order', 20));
  INSERT INTO spo_q VALUES ('gold', v_gold);

  -- Poziom WYLACZONY. Ma zniknac z selektu formularza, ale NIE ze strony -
  -- sprawdza to sekcja 10 (publiczny RPC nie filtruje po `is_active`).
  v_media := public.admin_event_sponsor_tier_save(jsonb_build_object(
    'event_id', '30e00000-0000-0000-0000-0000000000a1',
    'key', 'media', 'name_pl', 'Patronat medialny', 'name_en', 'Media patronage',
    'rank', 10, 'sort_order', 30, 'is_active', false));
  INSERT INTO spo_q VALUES ('media', v_media);

  -- Poziom w wydarzeniu ROBOCZYM tego samego najemcy - cel asercji o kluczu
  -- POTROJNYM (poziom z innego wydarzenia, sekcja 5).
  INSERT INTO spo_q VALUES ('gala_tier',
    public.admin_event_sponsor_tier_save(jsonb_build_object(
      'event_id', '30e00000-0000-0000-0000-0000000000a2',
      'key', 'gala_gold', 'name_pl', 'Zloty gali', 'name_en', 'Gala gold',
      'rank', 50)));

  -- Edycja BEZ klucza `benefits` nie rusza listy swiadczen.
  PERFORM public.admin_event_sponsor_tier_save(jsonb_build_object(
    'id', v_diamond, 'name_pl', 'Diamentowy 2026', 'name_en', 'Diamond 2026',
    'key', 'podmieniony'));
  SELECT count(*)::integer INTO v_cnt
  FROM public.event_sponsor_tier_benefits b WHERE b.tier_id = v_diamond;
  PERFORM pg_temp.assert(v_cnt = 2,
    '30/poziomy: edycja bez klucza benefits NIE kasuje swiadczen');

  SELECT t.key INTO STRICT v_rec
  FROM public.event_sponsor_tiers t WHERE t.id = v_diamond;
  PERFORM pg_temp.assert(v_rec.key = 'diamond',
    '30/poziomy: klucz poziomu jest niezmienny po zapisie (kotwica na stronie)');

  -- Pusta lista `benefits` to JEST zyczenie "wyczysc swiadczenia" - inaczej
  -- nie da sie ich usunac zadna operacja formularza.
  PERFORM public.admin_event_sponsor_tier_save(jsonb_build_object(
    'id', v_gold, 'name_pl', 'Zloty', 'name_en', 'Gold',
    'benefits', '[]'::jsonb));
  SELECT count(*)::integer INTO v_cnt
  FROM public.event_sponsor_tier_benefits b WHERE b.tier_id = v_gold;
  PERFORM pg_temp.assert(v_cnt = 0,
    '30/poziomy: pusta tablica benefits czysci liste (brak klucza to inna rzecz)');

  -- Walidacje wejscia.
  -- KLUCZ NIE JEST ODRZUCANY ZA WIELKA LITERE - jest NORMALIZOWANY.
  -- Pierwsza wersja tej asercji twierdzila, ze `Diamond` leci na `invalid_key`,
  -- i przechodzila by tylko przez przypadek: `admin_event_sponsor_tier_save`
  -- robi `lower(btrim(...))` (linia 971 migracji), wiec `Diamond` staje sie
  -- `diamond`, a `diamond` juz istnial w scenografii - odmowa przychodzila
  -- z ograniczenia unikalnosci, NIE z walidacji klucza. Asercja mierzyla wiec
  -- co innego, niz mowila jej wlasna etykieta.
  --
  -- Prawdziwa regula jest dwuczlonowa i tak jest tu sprawdzana:
  --   (a) wielka litera przechodzi i zostaje znormalizowana,
  --   (b) `invalid_key` leci od wejscia, ktorego normalizacja NIE naprawia.
  PERFORM public.admin_event_sponsor_tier_save(jsonb_build_object(
    'event_id','30e00000-0000-0000-0000-0000000000a1',
    'key','Platinum','name_pl','Platynowy','name_en','Platinum'));
  SELECT t.key INTO v_txt
  FROM public.event_sponsor_tiers t
  WHERE t.event_id = '30e00000-0000-0000-0000-0000000000a1' AND t.name_en = 'Platinum';
  PERFORM pg_temp.assert(v_txt = 'platinum',
    '30/poziomy: klucz z wielka litera jest NORMALIZOWANY do malych, nie odrzucany');

  -- SCENOGRAFIA WRACA DO STANU WYJSCIOWEGO. Ten poziom powstal WYLACZNIE po to,
  -- zeby dowiesc normalizacji klucza, a asercje nizej licza poziomy wydarzenia
  -- A1 i maja prawo zakladac, ze nikt im po drodze nie dolozyl wiersza. Asercja,
  -- ktora zmienia scenografie i jej nie oddaje, psuje asercje nastepne - i wtedy
  -- czerwone jest to, co dziala, a autor szuka bledu w niewinnym miejscu.
  DELETE FROM public.event_sponsor_tiers
  WHERE event_id = '30e00000-0000-0000-0000-0000000000a1'
    AND key = 'platinum';

  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.admin_event_sponsor_tier_save(jsonb_build_object(
         'event_id','30e00000-0000-0000-0000-0000000000a1',
         'key','2026','name_pl','X1','name_en','X1'))$q$,
    'invalid_key',
    '30/poziomy: klucz zaczynajacy sie cyfra odrzucony - normalizacja tego nie naprawia');

  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.admin_event_sponsor_tier_save(jsonb_build_object(
         'event_id','30e00000-0000-0000-0000-0000000000a1',
         'key','zloty-partner','name_pl','X2','name_en','X2'))$q$,
    'invalid_key',
    '30/poziomy: dywiz w kluczu odrzucony - wzorzec dopuszcza tylko podkreslenie');

  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.admin_event_sponsor_tier_save(jsonb_build_object(
         'event_id','30e00000-0000-0000-0000-0000000000a1',
         'key','platinum','name_pl','Platyna','name_en',''))$q$,
    'invalid_names',
    '30/poziomy: brak nazwy angielskiej odrzucony z nazwanym bledem');

  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.admin_event_sponsor_tier_save(jsonb_build_object(
         'event_id','30e00000-0000-0000-0000-0000000000a1',
         'key','platinum','name_pl','Platyna','name_en','Platinum',
         'accent_color','#zzzzzz'))$q$,
    'event_sponsor_tiers_accent_hex',
    '30/poziomy: kolor akcentu poza #rrggbb odrzucony przez baze');

  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.admin_event_sponsor_tier_save(jsonb_build_object(
         'event_id','30e00000-0000-0000-0000-0000000000a1',
         'key','platinum','name_pl','Platyna','name_en','Platinum',
         'rank', 2026))$q$,
    'event_sponsor_tiers_rank_range',
    '30/poziomy: ranga 2026 (pomylona z rokiem) odrzucona przez baze');

  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.admin_event_sponsor_tier_save(jsonb_build_object(
         'event_id','30e00000-0000-0000-0000-0000000000a1',
         'key','diamond','name_pl','Drugi Diament','name_en','Second Diamond'))$q$,
    'event_sponsor_tiers_event_key_unique',
    '30/poziomy: ten sam klucz dwa razy w jednym wydarzeniu odrzucony');
END
$do$;

-- Lista panelu: trzy liczby i swiadczenia w jednym wierszu.
DO $do$
DECLARE
  v_rec record;
  v_cnt integer;
BEGIN
  SELECT count(*)::integer INTO v_cnt
  FROM public.admin_event_sponsor_tiers_list('30e00000-0000-0000-0000-0000000000a1');
  PERFORM pg_temp.assert(v_cnt = 3,
    '30/lista poziomow: trzy poziomy wydarzenia A1 (poziom gali A2 nie wchodzi)');

  SELECT * INTO v_rec
  FROM public.admin_event_sponsor_tiers_list('30e00000-0000-0000-0000-0000000000a1')
  LIMIT 1;
  PERFORM pg_temp.assert(v_rec.key = 'diamond',
    '30/lista poziomow: najwyzsza ranga pierwsza (rank DESC, nie sort_order)');
  PERFORM pg_temp.assert(v_rec.sponsors_count = 0,
    '30/lista poziomow: licznik przypiec startuje z zerem');
  PERFORM pg_temp.assert(v_rec.slots_left = 2,
    '30/lista poziomow: wolne miejsca = limit przy zerze przypiec');
  PERFORM pg_temp.assert(jsonb_array_length(v_rec.benefits) = 2,
    '30/lista poziomow: swiadczenia jada w wierszu poziomu (bez N+1)');

  SELECT * INTO v_rec
  FROM public.admin_event_sponsor_tiers_list('30e00000-0000-0000-0000-0000000000a1')
  WHERE key = 'gold';
  -- "Bez limitu" i "brak miejsc" to DWIE ROZNE odpowiedzi, a zero czyta sie
  -- jako druga z nich.
  PERFORM pg_temp.assert(v_rec.slots_left IS NULL,
    '30/lista poziomow: poziom bez limitu ma slots_left NULL, nie zero');
  PERFORM pg_temp.assert(jsonb_array_length(v_rec.benefits) = 0,
    '30/lista poziomow: poziom bez swiadczen oddaje pusta tablice, nie NULL');

  -- Kolejnosc i ranga wsadowo, jednym wywolaniem.
  PERFORM pg_temp.assert(
    public.admin_event_sponsor_tiers_reorder(jsonb_build_object('items', jsonb_build_array(
      jsonb_build_object('id', (SELECT u FROM spo_q WHERE k = 'gold'), 'rank', 60),
      jsonb_build_object('id', (SELECT u FROM spo_q WHERE k = 'media'), 'sort_order', 40)
    ))) = 2,
    '30/reorder poziomow: dwa wiersze przestawione, liczba zwrocona');

  PERFORM pg_temp.assert(
    (SELECT t.rank FROM public.event_sponsor_tiers t
      WHERE t.id = (SELECT u FROM spo_q WHERE k = 'gold')) = 60,
    '30/reorder poziomow: ranga przepisana');
  PERFORM pg_temp.assert(
    (SELECT t.rank FROM public.event_sponsor_tiers t
      WHERE t.id = (SELECT u FROM spo_q WHERE k = 'media')) = 10,
    '30/reorder poziomow: pole nieobecne w pozycji zostaje bez zmian');
  PERFORM pg_temp.assert(
    public.admin_event_sponsor_tiers_reorder(jsonb_build_object('items', jsonb_build_array(
      jsonb_build_object('id', (SELECT u FROM spo_q WHERE k = 'gold'), 'rank', 60)
    ))) = 0,
    '30/reorder poziomow: wartosc bez zmiany nie liczy sie jako przestawienie');

  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.admin_event_sponsor_tiers_reorder('{"items":"nie tablica"}'::jsonb)$q$,
    'invalid_payload',
    '30/reorder poziomow: payload bez tablicy items odrzucony');
END
$do$;

-- ---------------------------------------------------------------------------
-- SEKCJA 3: PRZYPIECIE FIRMY I POWSTANIE MIGAWKI
--
-- Migawka powstaje W CHWILI PRZYPIECIA z czterech pol kartoteki. Piate pole -
-- OPIS - nie ma zrodla w CRM i powstaje w panelu; szoste (`snapshot_source`)
-- mowi, czy migawka jest kopia kartoteki, czy swiadomym nadpisaniem.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_diamond uuid := (SELECT u FROM spo_q WHERE k = 'diamond');
  v_gold uuid := (SELECT u FROM spo_q WHERE k = 'gold');
  v_id uuid;
  v_rec record;
BEGIN
  v_id := public.admin_event_sponsor_save(jsonb_build_object(
    'event_id', '30e00000-0000-0000-0000-0000000000a1',
    'company_id', '30c00000-0000-0000-0000-0000000000a1',
    'tier_id', v_diamond, 'role', 'sponsor', 'sort_order', 10,
    'snapshot_description_pl', 'Lider rynku energii.',
    'snapshot_description_en', 'Energy market leader.',
    'internal_note', 'Umowa 2026/17, kontakt przez agencje.'));
  INSERT INTO spo_q VALUES ('s1', v_id);

  SELECT * INTO v_rec FROM public.event_sponsors s WHERE s.id = v_id;
  PERFORM pg_temp.assert(v_rec.snapshot_name = 'Orlen Energia',
    '30/migawka: nazwa skopiowana z kartoteki w chwili przypiecia');
  PERFORM pg_temp.assert(v_rec.snapshot_logo_url = 'https://cdn.test/orlen.png',
    '30/migawka: logotyp skopiowany z kartoteki');
  -- Adres bez schematu w atrybucie href jest sciezka WZGLEDNA, wiec musi byc
  -- domkniety RAZ i w jednym miejscu (`_event_sponsor_web_url`).
  PERFORM pg_temp.assert(v_rec.snapshot_website = 'https://orlen.pl',
    '30/migawka: adres z kartoteki bez schematu domkniety do https://');
  PERFORM pg_temp.assert(v_rec.snapshot_country = 'Polska',
    '30/migawka: kraj skopiowany z kartoteki');
  PERFORM pg_temp.assert(v_rec.snapshot_source = 'crm',
    '30/migawka: zrodlo crm, gdy migawka jest kopia kartoteki');
  PERFORM pg_temp.assert(v_rec.snapshot_taken_at IS NOT NULL,
    '30/migawka: stempel "z ktorego dnia jest ten logotyp" wypelniony');
  PERFORM pg_temp.assert(v_rec.snapshot_description_pl = 'Lider rynku energii.',
    '30/migawka: opis jest REDAKCYJNY - z payloadu, nie z kartoteki');
  PERFORM pg_temp.assert(v_rec.is_published = false,
    '30/przypiecie: startuje jako NIEopublikowane (publikacja jest decyzja)');

  -- Wlasna nazwa albo wlasny logotyp = swiadome nadpisanie prezentacji.
  v_id := public.admin_event_sponsor_save(jsonb_build_object(
    'event_id', '30e00000-0000-0000-0000-0000000000a1',
    'company_id', '30c00000-0000-0000-0000-0000000000a2',
    'tier_id', v_diamond, 'role', 'sponsor', 'sort_order', 20,
    'snapshot_name', 'BS Grupa', 'snapshot_logo_url', '/storage/bs.svg'));
  INSERT INTO spo_q VALUES ('s2', v_id);

  SELECT * INTO v_rec FROM public.event_sponsors s WHERE s.id = v_id;
  PERFORM pg_temp.assert(v_rec.snapshot_source = 'manual',
    '30/migawka: reczna nazwa przestawia zrodlo na manual (rozjazd zamierzony)');
  PERFORM pg_temp.assert(v_rec.snapshot_logo_url = '/storage/bs.svg',
    '30/migawka: sciezka wzgledna logotypu z naszego magazynu dopuszczona');

  -- LIMIT POZIOMU. Diamond ma dwa miejsca i oba sa zajete.
  PERFORM pg_temp.assert_raises_like(format(
    $q$SELECT public.admin_event_sponsor_save(jsonb_build_object(
         'event_id','30e00000-0000-0000-0000-0000000000a1',
         'company_id','30c00000-0000-0000-0000-0000000000a3',
         'tier_id','%s','role','sponsor'))$q$, v_diamond),
    'tier_full',
    '30/limit poziomu: trzecia firma na dwumiejscowym poziomie odrzucona');

  -- Patron medialny i wystawca poziomu NIE POTRZEBUJA i publikuja sie bez niego.
  v_id := public.admin_event_sponsor_save(jsonb_build_object(
    'event_id', '30e00000-0000-0000-0000-0000000000a1',
    'company_id', '30c00000-0000-0000-0000-0000000000a3',
    'role', 'media_partner', 'is_published', true, 'sort_order', 30));
  INSERT INTO spo_q VALUES ('s3', v_id);
  PERFORM pg_temp.assert(
    (SELECT s.is_published FROM public.event_sponsors s WHERE s.id = v_id),
    '30/role: patron medialny publikuje sie BEZ poziomu');

  v_id := public.admin_event_sponsor_save(jsonb_build_object(
    'event_id', '30e00000-0000-0000-0000-0000000000a1',
    'company_id', '30c00000-0000-0000-0000-0000000000a4',
    'role', 'exhibitor', 'booth_label', 'B14',
    'is_published', true, 'sort_order', 40));
  INSERT INTO spo_q VALUES ('s4', v_id);
  PERFORM pg_temp.assert(
    (SELECT s.booth_label FROM public.event_sponsors s WHERE s.id = v_id) = 'B14',
    '30/role: wystawca to ta sama firma z numerem stanowiska, nie osobny rejestr');

  -- Sponsor bez poziomu nie ma grupy, w ktorej stanie na stronie.
  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.admin_event_sponsor_save(jsonb_build_object(
         'event_id','30e00000-0000-0000-0000-0000000000a1',
         'company_id','30c00000-0000-0000-0000-0000000000a5',
         'role','sponsor','is_published',true))$q$,
    'sponsor_tier_required',
    '30/publikacja: opublikowany SPONSOR bez poziomu odrzucony');

  v_id := public.admin_event_sponsor_save(jsonb_build_object(
    'event_id', '30e00000-0000-0000-0000-0000000000a1',
    'company_id', '30c00000-0000-0000-0000-0000000000a5',
    'tier_id', v_gold, 'role', 'sponsor', 'sort_order', 50));
  INSERT INTO spo_q VALUES ('s5', v_id);

  -- Jedna firma jest przypieta do wydarzenia RAZ.
  PERFORM pg_temp.assert_raises_like(format(
    $q$SELECT public.admin_event_sponsor_save(jsonb_build_object(
         'event_id','30e00000-0000-0000-0000-0000000000a1',
         'company_id','30c00000-0000-0000-0000-0000000000a1',
         'tier_id','%s','role','partner'))$q$, v_gold),
    'event_sponsors_event_company_unique',
    '30/przypiecie: ta sama firma dwa razy na jednym wydarzeniu odrzucona');

  -- FIRMA JEST NIEZMIENNA PO ZAPISIE. Podmiana firmy pod migawka dawalaby
  -- wiersz mowiacy "logotyp firmy A, kartoteka firmy B".
  PERFORM public.admin_event_sponsor_save(jsonb_build_object(
    'id', (SELECT u FROM spo_q WHERE k = 's5'),
    'company_id', '30c00000-0000-0000-0000-0000000000a6',
    'sort_order', 55));
  PERFORM pg_temp.assert(
    (SELECT s.company_id FROM public.event_sponsors s
      WHERE s.id = (SELECT u FROM spo_q WHERE k = 's5'))
      = '30c00000-0000-0000-0000-0000000000a6'::uuid IS FALSE,
    '30/przypiecie: firma jest niezmienna po zapisie (podmiana zignorowana)');
  PERFORM pg_temp.assert(
    (SELECT s.sort_order FROM public.event_sponsors s
      WHERE s.id = (SELECT u FROM spo_q WHERE k = 's5')) = 55,
    '30/przypiecie: edycja przeszla (kontrapunkt - to nie byl no-op)');

  -- Edycja NIE moze zabrac poziomu opublikowanemu sponsorowi.
  PERFORM public.admin_event_sponsor_save(jsonb_build_object(
    'id', (SELECT u FROM spo_q WHERE k = 's5'), 'is_published', true));
  PERFORM pg_temp.assert_raises_like(format(
    $q$SELECT public.admin_event_sponsor_save(
         jsonb_build_object('id','%s','tier_id',''))$q$,
    (SELECT u FROM spo_q WHERE k = 's5')),
    'sponsor_tier_required',
    '30/publikacja: zdjecie poziomu opublikowanemu sponsorowi odrzucone');
  PERFORM public.admin_event_sponsor_save(jsonb_build_object(
    'id', (SELECT u FROM spo_q WHERE k = 's5'), 'is_published', false));
  PERFORM pg_temp.assert(
    (SELECT s.is_published FROM public.event_sponsors s
      WHERE s.id = (SELECT u FROM spo_q WHERE k = 's5')) = false,
    '30/publikacja: wycofanie przypiecia ze strony dziala');

  -- Zdarzenie na szynie: publikacja jest faktem domenowym, nie zmiana flagi.
  PERFORM pg_temp.assert(
    (SELECT count(*)::integer FROM public.domain_events de
      WHERE de.event_type = 'event_sponsor.published.v1') >= 3,
    '30/szyna: publikacja przypiecia emituje event_sponsor.published.v1');
  PERFORM pg_temp.assert(
    (SELECT count(*)::integer FROM public.domain_events de
      WHERE de.event_type = 'event_sponsor.unpublished.v1') >= 1,
    '30/szyna: wycofanie przypiecia emituje event_sponsor.unpublished.v1');
END
$do$;

-- Ksztalt migawki jest pilnowany przez baze, nie tylko przez RPC - inaczej
-- import albo `COPY` wstawilby adres, ktory w atrybucie href jest bomba.
SELECT pg_temp.assert_raises_like(
  $q$UPDATE public.event_sponsors SET snapshot_website = 'javascript:alert(1)'
     WHERE snapshot_name = 'Orlen Energia'$q$,
  'event_sponsors_snapshot_website_shape',
  '30/migawka: adres strony poza schematem http(s) odrzucony przez baze');

SELECT pg_temp.assert_raises_like(
  $q$UPDATE public.event_sponsors SET snapshot_logo_url = 'data:image/svg+xml,x'
     WHERE snapshot_name = 'Orlen Energia'$q$,
  'event_sponsors_snapshot_logo_shape',
  '30/migawka: logotyp jako data: URI odrzucony przez baze');

SELECT pg_temp.assert_raises_like(
  $q$UPDATE public.event_sponsors SET snapshot_source = 'import'
     WHERE snapshot_name = 'Orlen Energia'$q$,
  'event_sponsors_snapshot_source_values',
  '30/migawka: zrodlo poza crm/manual odrzucone przez baze');

-- ---------------------------------------------------------------------------
-- SEKCJA 4: MIGAWKA KONTRA KARTOTEKA - SEDNO PODMODULU
--
-- Trzy asercje, ktore razem sa cala pointa tego modulu, i kazda z nich potrafi
-- byc czerwona z osobna:
--   (1) po zmianie w CRM migawka NIE DRGA - ani w tabeli, ani na stronie;
--   (2) lista panelu RAPORTUJE rozjazd i wskazuje KTORE pola sie roznia;
--   (3) po JAWNYM odswiezeniu migawka zgadza sie z kartoteka i dopiero wtedy
--       zmienia sie strona.
--
-- Zeby (1) dalo sie sprawdzic NA STRONIE, sponsor musi byc opublikowany -
-- inaczej publiczny RPC nie oddaje go w zadnym stanie i asercja przechodzilaby
-- na pustym wyniku.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_s1 uuid := (SELECT u FROM spo_q WHERE k = 's1');
  v_s2 uuid := (SELECT u FROM spo_q WHERE k = 's2');
  v_rec record;
  v_n integer;
  v_name text;
BEGIN
  -- Publikacja wsadowa dwoch przypiec diamond.
  v_n := public.admin_event_sponsors_set_published(jsonb_build_object(
    'ids', jsonb_build_array(v_s1::text, v_s2::text), 'is_published', true));
  PERFORM pg_temp.assert(v_n = 2,
    '30/publikacja wsadowa: dwa przypiecia opublikowane jedna decyzja');

  -- Stan wyjsciowy: zero rozjazdu.
  SELECT * INTO v_rec
  FROM public.admin_event_sponsors_list('30e00000-0000-0000-0000-0000000000a1') l
  WHERE l.id = v_s1;
  PERFORM pg_temp.assert(v_rec.crm_drift = false,
    '30/rozjazd: swiezo przypieta firma nie ma rozjazdu');
  PERFORM pg_temp.assert(cardinality(v_rec.crm_drift_fields) = 0,
    '30/rozjazd: lista rozjechanych pol jest pusta, nie NULL');
  -- Kartoteka trzyma 'orlen.pl', migawka 'https://orlen.pl'. Gdyby
  -- normalizacja adresu byla skopiowana w dwa miejsca (zapis i porownanie),
  -- rozjazd byl by zglaszany WIECZNIE i redaktor nauczylby sie go ignorowac.
  PERFORM pg_temp.assert(NOT (v_rec.crm_drift_fields @> ARRAY['website']),
    '30/rozjazd: adres bez schematu w CRM NIE jest rozjazdem (jedno zrodlo normalizacji)');

  -- Migawka jest na stronie.
  SELECT count(*)::integer INTO v_n
  FROM public.event_sponsors_public('sponsors-kongres-a') g,
       jsonb_array_elements(g.sponsors) x
  WHERE x->>'name' = 'Orlen Energia';
  PERFORM pg_temp.assert(v_n = 1,
    '30/migawka: opublikowany sponsor jest na stronie pod nazwa z migawki');

  -- ===== KARTOTEKA IDZIE DALEJ: przebrandowanie i nowy logotyp =====
  UPDATE public.crm_companies
  SET name = 'Orlen Energia SA', logo_url = 'https://cdn.test/orlen-2026.png'
  WHERE id = '30c00000-0000-0000-0000-0000000000a1';

  -- (1) MIGAWKA NIE DRGA - to jest asercja, dla ktorej ten modul istnieje.
  PERFORM pg_temp.assert(
    (SELECT s.snapshot_name FROM public.event_sponsors s WHERE s.id = v_s1)
      = 'Orlen Energia',
    '30/MIGAWKA: zmiana nazwy w CRM NIE zmienia migawki w tabeli');
  PERFORM pg_temp.assert(
    (SELECT s.snapshot_logo_url FROM public.event_sponsors s WHERE s.id = v_s1)
      = 'https://cdn.test/orlen.png',
    '30/MIGAWKA: zmiana logotypu w CRM NIE zmienia migawki w tabeli');

  SELECT x->>'name' INTO v_name
  FROM public.event_sponsors_public('sponsors-kongres-a') g,
       jsonb_array_elements(g.sponsors) x
  WHERE (x->>'id')::uuid = v_s1;
  PERFORM pg_temp.assert(v_name = 'Orlen Energia',
    '30/MIGAWKA: STRONA PUBLICZNA pokazuje stan z dnia zapisu, nie biezacy CRM');

  SELECT count(*)::integer INTO v_n
  FROM public.event_sponsors_public('sponsors-kongres-a') g,
       jsonb_array_elements(g.sponsors) x
  WHERE x->>'name' = 'Orlen Energia SA';
  PERFORM pg_temp.assert(v_n = 0,
    '30/MIGAWKA: nowa nazwa z CRM NIE pojawila sie na stronie archiwalnej');

  -- (2) ROZJAZD JEST RAPORTOWANY I NAZWANY.
  SELECT * INTO v_rec
  FROM public.admin_event_sponsors_list('30e00000-0000-0000-0000-0000000000a1') l
  WHERE l.id = v_s1;
  PERFORM pg_temp.assert(v_rec.crm_drift,
    '30/ROZJAZD: lista panelu raportuje rozjazd po zmianie w CRM');
  PERFORM pg_temp.assert(v_rec.crm_drift_fields @> ARRAY['name', 'logo_url'],
    '30/ROZJAZD: lista wskazuje KTORE pola sie roznia (nazwa i logotyp)');
  PERFORM pg_temp.assert(NOT (v_rec.crm_drift_fields @> ARRAY['country']),
    '30/ROZJAZD: pole niezmienione NIE jest raportowane jako rozjechane');
  PERFORM pg_temp.assert(v_rec.crm_name = 'Orlen Energia SA',
    '30/ROZJAZD: lista oddaje TAKZE biezaca nazwe z CRM (dwie kolumny obok siebie)');
  PERFORM pg_temp.assert(v_rec.snapshot_name = 'Orlen Energia',
    '30/ROZJAZD: lista oddaje migawke bez zmiany (porownanie, nie nadpisanie)');
  PERFORM pg_temp.assert(v_rec.snapshot_source = 'crm',
    '30/ROZJAZD: zrodlo crm - roznica znaczy "kartoteka poszla dalej"');

  SELECT * INTO v_rec
  FROM public.admin_event_sponsors_list('30e00000-0000-0000-0000-0000000000a1') l
  WHERE l.id = v_s2;
  PERFORM pg_temp.assert(v_rec.snapshot_source = 'manual' AND v_rec.crm_drift,
    '30/ROZJAZD: przy migawce manual rozjazd tez jest widoczny, ale zamierzony');

  -- Ogon spacji nie jest inna nazwa. Falszywy alarm uczy ignorowac ostrzezenie.
  UPDATE public.crm_companies SET name = 'Orlen Energia SA   '
  WHERE id = '30c00000-0000-0000-0000-0000000000a1';
  UPDATE public.event_sponsors SET snapshot_name = 'Orlen Energia SA' WHERE id = v_s1;
  SELECT * INTO v_rec
  FROM public.admin_event_sponsors_list('30e00000-0000-0000-0000-0000000000a1') l
  WHERE l.id = v_s1;
  PERFORM pg_temp.assert(NOT (v_rec.crm_drift_fields @> ARRAY['name']),
    '30/ROZJAZD: ogon spacji w CRM nie produkuje falszywego alarmu (btrim)');
  -- Przywracamy stan rozjazdu na nazwie, zeby (3) mialo co odswiezyc.
  UPDATE public.crm_companies SET name = 'Orlen Energia SA'
  WHERE id = '30c00000-0000-0000-0000-0000000000a1';
  UPDATE public.event_sponsors SET snapshot_name = 'Orlen Energia' WHERE id = v_s1;
END
$do$;

-- (3) ODSWIEZENIE MIGAWKI - jawna operacja organizatora, nie trigger.
DO $do$
DECLARE
  v_s1 uuid := (SELECT u FROM spo_q WHERE k = 's1');
  v_s2 uuid := (SELECT u FROM spo_q WHERE k = 's2');
  v_rec record;
  v_n integer;
  v_name text;
BEGIN
  UPDATE public.crm_companies SET name = 'BS Grupa Kapitalowa'
  WHERE id = '30c00000-0000-0000-0000-0000000000a2';

  v_n := public.admin_event_sponsor_snapshot_refresh(
    jsonb_build_object('event_id', '30e00000-0000-0000-0000-0000000000a1'));
  PERFORM pg_temp.assert(v_n = 1, format(
    '30/ODSWIEZENIE: dotknelo DOKLADNIE jednego wiersza crm, migawke manual pominelo (bylo %s)',
    v_n));

  SELECT * INTO v_rec FROM public.event_sponsors s WHERE s.id = v_s1;
  PERFORM pg_temp.assert(v_rec.snapshot_name = 'Orlen Energia SA',
    '30/ODSWIEZENIE: nazwa w migawce zgadza sie z kartoteka');
  PERFORM pg_temp.assert(v_rec.snapshot_logo_url = 'https://cdn.test/orlen-2026.png',
    '30/ODSWIEZENIE: logotyp w migawce zgadza sie z kartoteka');
  PERFORM pg_temp.assert(v_rec.snapshot_description_pl = 'Lider rynku energii.',
    '30/ODSWIEZENIE: opis redakcyjny NIETKNIETY (CRM nie ma zrodla opisu)');
  PERFORM pg_temp.assert(
    (SELECT s.snapshot_name FROM public.event_sponsors s WHERE s.id = v_s2) = 'BS Grupa',
    '30/ODSWIEZENIE: migawka manual NIE zostala nadpisana bez pytania');

  -- Rozjazd domyka sie do zera - warunek odswiezenia jest LUSTREM wyliczenia.
  SELECT * INTO v_rec
  FROM public.admin_event_sponsors_list('30e00000-0000-0000-0000-0000000000a1') l
  WHERE l.id = v_s1;
  PERFORM pg_temp.assert(v_rec.crm_drift = false,
    '30/ODSWIEZENIE: po odswiezeniu lista nie raportuje rozjazdu');

  -- I DOPIERO TERAZ zmienia sie strona publiczna.
  SELECT x->>'name' INTO v_name
  FROM public.event_sponsors_public('sponsors-kongres-a') g,
       jsonb_array_elements(g.sponsors) x
  WHERE (x->>'id')::uuid = v_s1;
  PERFORM pg_temp.assert(v_name = 'Orlen Energia SA',
    '30/ODSWIEZENIE: strona zmienia sie DOPIERO po decyzji organizatora');

  -- Powtorne wywolanie jest bezczynne: liczba mowi "ile stron sie zmienilo",
  -- a nie "ile wierszy przeleciala petla".
  PERFORM pg_temp.assert(
    public.admin_event_sponsor_snapshot_refresh(
      jsonb_build_object('event_id', '30e00000-0000-0000-0000-0000000000a1')) = 0,
    '30/ODSWIEZENIE: powtorne wywolanie zwraca zero (aktualizuje tylko rozne)');

  -- Z jawna zgoda migawka reczna tez sie odswieza i wraca na zrodlo crm.
  PERFORM pg_temp.assert(
    public.admin_event_sponsor_snapshot_refresh(jsonb_build_object(
      'ids', jsonb_build_array(v_s2::text), 'include_manual', true)) = 1,
    '30/ODSWIEZENIE: include_manual dosiega migawki nadpisanej recznie');
  SELECT * INTO v_rec FROM public.event_sponsors s WHERE s.id = v_s2;
  PERFORM pg_temp.assert(v_rec.snapshot_name = 'BS Grupa Kapitalowa',
    '30/ODSWIEZENIE: z include_manual nazwa przepisana z kartoteki');
  PERFORM pg_temp.assert(v_rec.snapshot_source = 'crm',
    '30/ODSWIEZENIE: zrodlo wraca na crm po jawnym odswiezeniu');

  PERFORM pg_temp.assert(
    (SELECT count(*)::integer FROM public.domain_events de
      WHERE de.event_type = 'event_sponsor.snapshot_refreshed.v1') >= 2,
    '30/szyna: odswiezenie migawki emituje event_sponsor.snapshot_refreshed.v1');

  -- Payload bez zakresu jest bledem, nie cichym zerem. Ta asercja pilnuje
  -- realnego bledu naprawionego w tej migracji: `jsonb_typeof(NULL) = 'array'`
  -- daje NULL, wiec brak COALESCE odsiewal KAZDY wiersz i funkcja zwracala 0
  -- bez zadnego bledu.
  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.admin_event_sponsor_snapshot_refresh('{}'::jsonb)$q$,
    'invalid_payload',
    '30/ODSWIEZENIE: payload bez ids i bez event_id odrzucony, nie cicho pusty');

  -- Firma z pusta nazwa w kartotece jest POMIJANA - migawka z pusta nazwa
  -- odbila by sie od CHECK-a i zamienila porzadkowanie w awarie panelu.
  UPDATE public.crm_companies SET name = '   '
  WHERE id = '30c00000-0000-0000-0000-0000000000a4';
  PERFORM pg_temp.assert(
    public.admin_event_sponsor_snapshot_refresh(
      jsonb_build_object('event_id', '30e00000-0000-0000-0000-0000000000a1')) = 0,
    '30/ODSWIEZENIE: firma z pusta nazwa w CRM jest pomijana, nie wywraca operacji');
  UPDATE public.crm_companies SET name = 'Techno Stoisko'
  WHERE id = '30c00000-0000-0000-0000-0000000000a4';
END
$do$;

-- ---------------------------------------------------------------------------
-- SEKCJA 5: GRANICE NAJEMCY I WYDARZENIA PRZY PRZYPIECIU
--
-- Cztery odmowy sprawdzane DWIEMA droga naraz: przez RPC (nazwany blad dla
-- panelu) i przez GOLY INSERT (klucz obcy zlozony, ktory obowiazuje takze przy
-- imporcie i przy `COPY`, gdzie zaden RPC nie stoi na drodze). Sam RPC bez
-- klucza obcego byl by bramka z jednym wejsciem i otwartym oknem.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_gold uuid := (SELECT u FROM spo_q WHERE k = 'gold');
  v_gala uuid := (SELECT u FROM spo_q WHERE k = 'gala_tier');
BEGIN
  -- FIRMA Z INNEGO NAJEMCY.
  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.admin_event_sponsor_save(jsonb_build_object(
         'event_id','30e00000-0000-0000-0000-0000000000a1',
         'company_id','30c00000-0000-0000-0000-0000000000b1','role','partner'))$q$,
    'not_found',
    '30/IZOLACJA: firma obcego najemcy nie da sie przypiac (RPC, nazwany blad)');

  PERFORM pg_temp.assert_raises_like(
    $q$INSERT INTO public.event_sponsors
         (tenant_id, event_id, company_id, snapshot_name)
       VALUES ('11111111-1111-1111-1111-111111111111',
               '30e00000-0000-0000-0000-0000000000a1',
               '30c00000-0000-0000-0000-0000000000b1', 'Obca')$q$,
    'event_sponsors_company_fk',
    '30/IZOLACJA: firma obcego najemcy odrzucona takze golym INSERT-em (klucz zlozony)');

  -- WYDARZENIE Z INNEGO NAJEMCY.
  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.admin_event_sponsor_save(jsonb_build_object(
         'event_id','30e00000-0000-0000-0000-0000000000b1',
         'company_id','30c00000-0000-0000-0000-0000000000a6','role','partner'))$q$,
    'not_found',
    '30/IZOLACJA: wydarzenie obcego najemcy nie da sie obsadzic (RPC)');

  PERFORM pg_temp.assert_raises_like(
    $q$INSERT INTO public.event_sponsors
         (tenant_id, event_id, company_id, snapshot_name)
       VALUES ('11111111-1111-1111-1111-111111111111',
               '30e00000-0000-0000-0000-0000000000b1',
               '30c00000-0000-0000-0000-0000000000a6', 'Zeta')$q$,
    'event_sponsors_event_fk',
    '30/IZOLACJA: wydarzenie obcego najemcy odrzucone golym INSERT-em (klucz zlozony)');

  -- POZIOM Z INNEGO WYDARZENIA TEGO SAMEGO NAJEMCY. Para z samym najemca
  -- pilnowalaby tylko granicy firmy; POTROJKA pilnuje takze tego, ze poziom
  -- i przypiecie naleza do TEGO SAMEGO wydarzenia.
  PERFORM pg_temp.assert_raises_like(format(
    $q$SELECT public.admin_event_sponsor_save(jsonb_build_object(
         'event_id','30e00000-0000-0000-0000-0000000000a1',
         'company_id','30c00000-0000-0000-0000-0000000000a6',
         'tier_id','%s','role','sponsor'))$q$, v_gala),
    'not_found',
    '30/IZOLACJA: poziom z innego wydarzenia odrzucony przez RPC (nazwany blad)');

  PERFORM pg_temp.assert_raises_like(format(
    $q$INSERT INTO public.event_sponsors
         (tenant_id, event_id, company_id, tier_id, snapshot_name)
       VALUES ('11111111-1111-1111-1111-111111111111',
               '30e00000-0000-0000-0000-0000000000a1',
               '30c00000-0000-0000-0000-0000000000a6','%s','Zeta')$q$, v_gala),
    'event_sponsors_tier_fk',
    '30/IZOLACJA: poziom z innego wydarzenia odrzucony kluczem POTROJNYM');

  -- Poziom TEGO wydarzenia przechodzi - kontrapunkt, bez ktorego trzy asercje
  -- wyzej nie odroznialyby izolacji od blokady wszystkiego.
  PERFORM pg_temp.assert(
    public.admin_event_sponsor_save(jsonb_build_object(
      'event_id', '30e00000-0000-0000-0000-0000000000a1',
      'company_id', '30c00000-0000-0000-0000-0000000000a6',
      'tier_id', v_gold, 'role', 'sponsor')) IS NOT NULL,
    '30/IZOLACJA/kontrapunkt: poziom TEGO wydarzenia przechodzi');

  -- Swiadczenie tez nie moze wskazac poziomu z innego wydarzenia.
  PERFORM pg_temp.assert_raises_like(format(
    $q$INSERT INTO public.event_sponsor_tier_benefits
         (tenant_id, event_id, tier_id, label_pl, label_en)
       VALUES ('11111111-1111-1111-1111-111111111111',
               '30e00000-0000-0000-0000-0000000000a1','%s','X','X')$q$, v_gala),
    'event_sponsor_tier_benefits_tier_fk',
    '30/IZOLACJA: swiadczenie nie moze wskazac poziomu z innego wydarzenia');

  -- Firma, ktora sponsorowala wydarzenie, nie kasuje sie z kartoteki -
  -- przypiecie jest DOKUMENTEM, nie ozdoba.
  PERFORM pg_temp.assert_raises_like(
    $q$DELETE FROM public.crm_companies
       WHERE id = '30c00000-0000-0000-0000-0000000000a1'$q$,
    'event_sponsors_company_fk',
    '30/kartoteka: usuniecie firmy uzytej w przypieciu jest ODRZUCANE');
END
$do$;

-- ---------------------------------------------------------------------------
-- SEKCJA 6: PUBLIKACJA WSADOWA
--
-- "Opublikuj wszystkich" jest JEDNA decyzja, wiec jest jedna transakcja.
-- Sponsor bez poziomu blokuje CALOSC z liczba - cicha zgoda na 12 z 15 wierszy
-- zostawia trzy logotypy poza strona i nikt sie o tym nie dowie do telefonu
-- od sponsora.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_s5 uuid := (SELECT u FROM spo_q WHERE k = 's5');
  v_s1 uuid := (SELECT u FROM spo_q WHERE k = 's1');
  v_bad uuid;
  v_before integer;
BEGIN
  -- Sponsor bez poziomu w zestawieniu.
  v_bad := public.admin_event_sponsor_save(jsonb_build_object(
    'event_id', '30e00000-0000-0000-0000-0000000000a2',
    'company_id', '30c00000-0000-0000-0000-0000000000a3',
    'role', 'sponsor'));

  SELECT count(*)::integer INTO v_before
  FROM public.event_sponsors s WHERE s.is_published;

  PERFORM pg_temp.assert_raises_like(format(
    $q$SELECT public.admin_event_sponsors_set_published(jsonb_build_object(
         'ids', jsonb_build_array('%s','%s'), 'is_published', true))$q$, v_s5, v_bad),
    'sponsor_tier_required',
    '30/publikacja wsadowa: sponsor bez poziomu blokuje CALY zestaw');

  PERFORM pg_temp.assert(
    (SELECT count(*)::integer FROM public.event_sponsors s WHERE s.is_published) = v_before,
    '30/publikacja wsadowa: po odmowie NIC nie zostalo opublikowane (jedna transakcja)');

  PERFORM public.admin_event_sponsor_delete(v_bad);

  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.admin_event_sponsors_set_published('{"ids":"nie tablica"}'::jsonb)$q$,
    'invalid_payload',
    '30/publikacja wsadowa: payload bez tablicy ids odrzucony');

  -- Wartosc bez zmiany nie liczy sie jako zmiana - inaczej zwrotka klamie
  -- o tym, ile stron sie zmienilo.
  PERFORM pg_temp.assert(
    public.admin_event_sponsors_set_published(jsonb_build_object(
      'ids', jsonb_build_array(v_s1::text), 'is_published', true)) = 0,
    '30/publikacja wsadowa: przypiecie juz opublikowane nie liczy sie jako zmiana');
END
$do$;

-- ---------------------------------------------------------------------------
-- SEKCJA 7: OSOBY KONTAKTOWE - DANE NA ZYWO, BEZ MIGAWKI
--
-- Odwrotnie niz przy firmie i z odwrotnego powodu: kontakt jest OPERACYJNY.
-- Nie ma strony archiwalnej, na ktorej mialby zamarznac, a zamrozony numer
-- telefonu jest gorszy od braku numeru. Dlatego panel czyta osobe NA ZYWO,
-- a usuniecie osoby kasuje wiersz kontaktu.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_s2 uuid := (SELECT u FROM spo_q WHERE k = 's2');
  v_rec record;
  v_n integer;
BEGIN
  PERFORM pg_temp.assert(
    public.admin_event_sponsor_contacts_set(jsonb_build_object(
      'sponsor_id', v_s2,
      'items', jsonb_build_array(
        jsonb_build_object('lead_id', '30d00000-0000-0000-0000-0000000000a1',
                           'role', 'primary'),
        jsonb_build_object('lead_id', '30d00000-0000-0000-0000-0000000000a2',
                           'role', 'onsite')))) = 2,
    '30/kontakty: dwie osoby zapisane wsadowo');

  -- Podmiana listy ODPINA nieobecnych - obsada jest lista, nie dopisywaniem.
  PERFORM pg_temp.assert(
    public.admin_event_sponsor_contacts_set(jsonb_build_object(
      'sponsor_id', v_s2,
      'items', jsonb_build_array(
        jsonb_build_object('lead_id', '30d00000-0000-0000-0000-0000000000a2',
                           'role', 'billing')))) = 1,
    '30/kontakty: podmiana listy zwraca liczbe kontaktow PO operacji');
  PERFORM pg_temp.assert(
    (SELECT count(*)::integer FROM public.event_sponsor_contacts k
      WHERE k.sponsor_id = v_s2) = 1,
    '30/kontakty: osoba nieobecna w items zostala odpieta');
  PERFORM pg_temp.assert(
    (SELECT k.role FROM public.event_sponsor_contacts k WHERE k.sponsor_id = v_s2)
      = 'billing',
    '30/kontakty: rola nalezy do WIERSZA kontaktu, nie do osoby (przepisana)');

  -- Osoba spoza kartoteki najemcy zatrzymuje CALOSC z nazwanym bledem.
  PERFORM pg_temp.assert_raises_like(format(
    $q$SELECT public.admin_event_sponsor_contacts_set(jsonb_build_object(
         'sponsor_id','%s','items', jsonb_build_array(
           jsonb_build_object('lead_id','30d00000-0000-0000-0000-0000000000b1'))))$q$,
    v_s2),
    'contact_not_found',
    '30/IZOLACJA: osoba z kartoteki obcego najemcy nie da sie przypisac (RPC)');

  PERFORM pg_temp.assert_raises_like(format(
    $q$INSERT INTO public.event_sponsor_contacts
         (tenant_id, event_id, sponsor_id, lead_id)
       VALUES ('11111111-1111-1111-1111-111111111111',
               '30e00000-0000-0000-0000-0000000000a1','%s',
               '30d00000-0000-0000-0000-0000000000b1')$q$, v_s2),
    'event_sponsor_contacts_lead_fk',
    '30/IZOLACJA: osoba obcego najemcy odrzucona golym INSERT-em (klucz zlozony)');

  PERFORM pg_temp.assert(
    (SELECT count(*)::integer FROM public.event_sponsor_contacts k
      WHERE k.sponsor_id = v_s2) = 1,
    '30/kontakty: po odrzuconej podmianie lista nietknieta (transakcja calosciowa)');

  PERFORM pg_temp.assert_raises_like(format(
    $q$SELECT public.admin_event_sponsor_contacts_set(jsonb_build_object(
         'sponsor_id','%s','items', jsonb_build_array(
           jsonb_build_object('lead_id','30d00000-0000-0000-0000-0000000000a1',
                              'role','ksiegowosc'))))$q$, v_s2),
    'invalid_role',
    '30/kontakty: rola poza czterema dopuszczonymi odrzucona');

  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.admin_event_sponsor_contacts_set('{"items":[]}'::jsonb)$q$,
    'invalid_payload',
    '30/kontakty: brak sponsor_id odrzucony');

  -- DANE NA ZYWO. Zmiana numeru w kartotece MUSI byc widoczna w panelu -
  -- to jest dokladne przeciwienstwo migawki firmy.
  UPDATE public.crm_leads SET phone = '+48 500 999 999'
  WHERE id = '30d00000-0000-0000-0000-0000000000a2';
  SELECT * INTO v_rec FROM public.admin_event_sponsor_detail(v_s2);
  PERFORM pg_temp.assert(jsonb_array_length(v_rec.contacts) = 1,
    '30/detal: jeden kontakt w wierszu przypiecia');
  PERFORM pg_temp.assert(v_rec.contacts->0->>'phone' = '+48 500 999 999',
    '30/detal: dane osoby czytane NA ZYWO z CRM (kontakt NIE ma migawki)');
  PERFORM pg_temp.assert(v_rec.contacts->0->>'lead_company_name' = 'BS Grupa Kapitalowa',
    '30/detal: firma osoby pokazana obok nazwiska (uklad agencyjny widoczny)');
  -- NOTATKA USTAWIANA TUTAJ, NIE ZAKLADANA ZE SCENOGRAFII. Pierwsza wersja tej
  -- asercji sprawdzala `internal_note` na sponsorze `v_s2`, a scenografia nadaje
  -- ja sponsorowi `s1` - wiec asercja mogla byc tylko czerwona i nie mierzyla
  -- niczego poza kolejnoscia wierszy wyzej. Asercja zalezna od tego, co ustawil
  -- KTOS INNY kilkaset linii wczesniej, jest asercja o scenografii, nie o module.
  UPDATE public.event_sponsors SET internal_note = 'Aneks 2026/31, faktura zbiorcza.'
  WHERE id = v_s2;
  SELECT * INTO v_rec FROM public.admin_event_sponsor_detail(v_s2);
  PERFORM pg_temp.assert(v_rec.internal_note = 'Aneks 2026/31, faktura zbiorcza.',
    '30/detal: notatka wewnetrzna wychodzi TYM RPC (odciecie od klienta sprawdzone osobno nizej)');

  -- Usuniecie osoby kasuje kontakt (kaskada) - skasowany czlowiek nie moze
  -- byc osoba kontaktowa.
  DELETE FROM public.crm_leads WHERE id = '30d00000-0000-0000-0000-0000000000a2';
  PERFORM pg_temp.assert(
    (SELECT count(*)::integer FROM public.event_sponsor_contacts k
      WHERE k.sponsor_id = v_s2) = 0,
    '30/kontakty: usuniecie osoby z CRM kasuje wiersz kontaktu (kaskada)');

  -- Pusta lista `items` kasuje wszystkie kontakty - "zapisz bez kontaktow"
  -- musi byc wykonalne.
  PERFORM public.admin_event_sponsor_contacts_set(jsonb_build_object(
    'sponsor_id', v_s2, 'items', jsonb_build_array(
      jsonb_build_object('lead_id', '30d00000-0000-0000-0000-0000000000a1'))));
  PERFORM pg_temp.assert(
    public.admin_event_sponsor_contacts_set(jsonb_build_object(
      'sponsor_id', v_s2, 'items', '[]'::jsonb)) = 0,
    '30/kontakty: pusta lista items kasuje wszystkie kontakty przypiecia');
  SELECT count(*)::integer INTO v_n
  FROM public.event_sponsor_contacts k WHERE k.sponsor_id = v_s2;
  PERFORM pg_temp.assert(v_n = 0,
    '30/kontakty: po pustej liscie w tabeli nie ma ani jednego wiersza');
END
$do$;

-- ---------------------------------------------------------------------------
-- SEKCJA 8: MATERIALY SPONSORA
--
-- Publikacja jest DWUSTOPNIOWA: material wychodzi na strone, gdy opublikowany
-- jest material I przypiecie. Bez drugiego warunku odpiecie sponsora
-- zostawialoby jego katalog produktowy w zakladce materialow - reklame firmy,
-- ktorej wlasnie nie ma na liscie partnerow.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_s1 uuid := (SELECT u FROM spo_q WHERE k = 's1');
  v_m1 uuid;
  v_m2 uuid;
BEGIN
  v_m1 := public.admin_event_sponsor_material_save(jsonb_build_object(
    'sponsor_id', v_s1, 'title_pl', 'Prezentacja plenarna',
    'title_en', 'Plenary deck', 'kind', 'presentation',
    'url', '/storage/orlen-2026.pdf', 'is_published', true, 'sort_order', 10));
  INSERT INTO spo_q VALUES ('m1', v_m1);
  PERFORM pg_temp.assert(v_m1 IS NOT NULL, '30/materialy: pozycja zapisana');

  -- Wydarzenie jest brane Z PRZYPIECIA, nie z payloadu - klient nie ma czym
  -- rozjechac tej pary.
  PERFORM pg_temp.assert(
    (SELECT m.event_id FROM public.event_sponsor_materials m WHERE m.id = v_m1)
      = '30e00000-0000-0000-0000-0000000000a1'::uuid,
    '30/materialy: wydarzenie wziete z przypiecia, nie z payloadu');

  v_m2 := public.admin_event_sponsor_material_save(jsonb_build_object(
    'sponsor_id', v_s1, 'title_pl', 'Katalog wewnetrzny',
    'title_en', 'Internal catalogue', 'url', 'https://cdn.test/kat.pdf',
    'sort_order', 20));
  INSERT INTO spo_q VALUES ('m2', v_m2);
  PERFORM pg_temp.assert(
    (SELECT m.is_published FROM public.event_sponsor_materials m WHERE m.id = v_m2) = false,
    '30/materialy: pozycja startuje jako nieopublikowana');

  -- Adres jedzie do atrybutu href. Schemat inny niz http(s) i sciezka
  -- wzgledna NIE jest dopuszczony.
  PERFORM pg_temp.assert_raises_like(format(
    $q$SELECT public.admin_event_sponsor_material_save(jsonb_build_object(
         'sponsor_id','%s','title_pl','Zly','title_en','Bad',
         'url','javascript:alert(1)'))$q$, v_s1),
    'event_sponsor_materials_url_shape',
    '30/materialy: adres javascript: odrzucony przez baze');

  PERFORM pg_temp.assert_raises_like(format(
    $q$SELECT public.admin_event_sponsor_material_save(jsonb_build_object(
         'sponsor_id','%s','title_pl','Zly','title_en','Bad',
         'kind','pdf','url','/x.pdf'))$q$, v_s1),
    'event_sponsor_materials_kind_values',
    '30/materialy: rodzaj poza piecioma dopuszczonymi odrzucony');

  PERFORM pg_temp.assert_raises_like(format(
    $q$SELECT public.admin_event_sponsor_material_save(jsonb_build_object(
         'sponsor_id','%s','title_pl','Bez adresu','title_en','No url'))$q$, v_s1),
    'invalid_url',
    '30/materialy: brak adresu odrzucony z nazwanym bledem');

  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.admin_event_sponsor_material_save(jsonb_build_object(
         'sponsor_id','30e00000-0000-0000-0000-0000000000ff',
         'title_pl','Sierota','title_en','Orphan','url','/x.pdf'))$q$,
    'not_found',
    '30/materialy: material bez istniejacego przypiecia odrzucony');

  -- Edycja i kolejnosc.
  PERFORM public.admin_event_sponsor_material_save(jsonb_build_object(
    'id', v_m2, 'title_pl', 'Katalog 2026', 'title_en', 'Catalogue 2026',
    'is_published', true));
  PERFORM pg_temp.assert(
    (SELECT m.title_pl FROM public.event_sponsor_materials m WHERE m.id = v_m2)
      = 'Katalog 2026',
    '30/materialy: edycja przepisala tytul');
  PERFORM pg_temp.assert(
    (SELECT m.url FROM public.event_sponsor_materials m WHERE m.id = v_m2)
      = 'https://cdn.test/kat.pdf',
    '30/materialy: edycja bez adresu nie kasuje adresu');

  PERFORM pg_temp.assert(
    public.admin_event_sponsor_materials_reorder(jsonb_build_object(
      'items', jsonb_build_array(
        jsonb_build_object('id', v_m1, 'sort_order', 30),
        jsonb_build_object('id', v_m2, 'sort_order', 20)))) = 1,
    '30/materialy: reorder przestawil tylko wiersz o innej kolejnosci');

  PERFORM pg_temp.assert(public.admin_event_sponsor_material_delete(v_m2),
    '30/materialy: pozycja usunieta');
  PERFORM pg_temp.assert_raises_like(format(
    $q$SELECT public.admin_event_sponsor_material_delete('%s')$q$, v_m2),
    'not_found',
    '30/materialy: powtorne usuniecie tej samej pozycji odrzucone');
END
$do$;

-- ---------------------------------------------------------------------------
-- SEKCJA 9: WYSZUKIWARKA FIRM DO PRZYPIECIA
--
-- Bez flagi `is_pinned` selektor jest pulapka: firma juz przypieta wyglada
-- identycznie jak nieprzypieta, wiec redaktor klika ja i dostaje `23505`
-- z ograniczenia unikalnosci.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_rec record;
  v_n integer;
BEGIN
  SELECT count(*)::integer INTO v_n
  FROM public.admin_event_sponsor_companies_search(
    '30e00000-0000-0000-0000-0000000000a1', NULL, 50);
  PERFORM pg_temp.assert(v_n = 6, format(
    '30/IZOLACJA: wyszukiwarka oddaje szesc firm najemcy A i ZERO firm najemcy B (bylo %s)',
    v_n));

  SELECT * INTO v_rec FROM public.admin_event_sponsor_companies_search(
    '30e00000-0000-0000-0000-0000000000a1', 'Orlen', 10);
  PERFORM pg_temp.assert(v_rec.is_pinned,
    '30/wyszukiwarka: firma juz przypieta do TEGO wydarzenia ma flage');
  PERFORM pg_temp.assert(v_rec.pinned_sponsor_id = (SELECT u FROM spo_q WHERE k = 's1'),
    '30/wyszukiwarka: flaga prowadzi do istniejacego wiersza przypiecia');
  PERFORM pg_temp.assert(v_rec.events_count = 1,
    '30/wyszukiwarka: licznik wydarzen firmy jest LICZBA, nie obietnica');
  PERFORM pg_temp.assert(v_rec.website = 'https://orlen.pl',
    '30/wyszukiwarka: adres znormalizowany tym samym pomocnikiem co migawka');

  SELECT * INTO v_rec FROM public.admin_event_sponsor_companies_search(
    '30e00000-0000-0000-0000-0000000000a1', 'Zeta', 10);
  PERFORM pg_temp.assert(v_rec.events_count = 1,
    '30/wyszukiwarka: firma przypieta raz ma licznik jeden');

  -- Nieprzypiete na gorze listy - to one sa celem wyszukiwania.
  SELECT * INTO v_rec FROM public.admin_event_sponsor_companies_search(
    '30e00000-0000-0000-0000-0000000000a2', NULL, 50) LIMIT 1;
  PERFORM pg_temp.assert(NOT v_rec.is_pinned,
    '30/wyszukiwarka: nieprzypiete do TEGO wydarzenia stoja na gorze listy');
END
$do$;

-- ---------------------------------------------------------------------------
-- SEKCJA 10: PLASZCZYZNA TRESCI
--
-- Publiczny odczyt oddaje TYLKO opublikowane przypiecia opublikowanego
-- wydarzenia, POGRUPOWANE po poziomie, i WYLACZNIE z najemcy z naglowka hosta.
-- Zero `has_role()` w ciele - naglowek `x-tenant-host` jest falsyfikowalny,
-- wiec mieszanka pozwolilaby administratorowi najemcy A podszyc sie pod B.
--
-- Stan wyjsciowy w wydarzeniu A1: diamond (s1, s2) opublikowane, grupa bez
-- poziomu (s3 patron medialny, s4 wystawca) opublikowana, gold (s5, Zeta)
-- nieopublikowany.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_rec record;
  v_n integer;
BEGIN
  SELECT count(*)::integer INTO v_n FROM public.event_sponsors_public('sponsors-kongres-a');
  PERFORM pg_temp.assert(v_n = 2, format(
    '30/publiczne: DWIE grupy - diamond i grupa bez poziomu (bylo %s)', v_n));

  SELECT * INTO v_rec FROM public.event_sponsors_public('sponsors-kongres-a') LIMIT 1;
  PERFORM pg_temp.assert(v_rec.tier_key = 'diamond',
    '30/publiczne: najwyzsza ranga pierwsza (kolejnosc grup na stronie)');
  PERFORM pg_temp.assert(jsonb_array_length(v_rec.sponsors) = 2,
    '30/publiczne: dwa logotypy w grupie diamond');
  PERFORM pg_temp.assert(jsonb_array_length(v_rec.benefits) = 2,
    '30/publiczne: swiadczenia poziomu jada z grupa (strona "Zostan sponsorem")');
  PERFORM pg_temp.assert(v_rec.tier_logo_size = 'lg',
    '30/publiczne: rozmiar logotypu nalezy do POZIOMU (swiadczenie pakietu)');
  PERFORM pg_temp.assert(v_rec.sponsors->0->>'url' = 'https://orlen.pl',
    '30/publiczne: adres sponsora oddany w postaci nadajacej sie do href');

  SELECT * INTO v_rec FROM public.event_sponsors_public('sponsors-kongres-a')
  WHERE tier_id IS NULL;
  PERFORM pg_temp.assert(v_rec.tier_rank IS NULL,
    '30/publiczne: grupa bez poziomu istnieje i ma range NULL (NULLS LAST)');
  PERFORM pg_temp.assert(v_rec.tier_logo_size = 'md',
    '30/publiczne: grupa bez poziomu dostaje rozmiar sredni (domyslny)');
  PERFORM pg_temp.assert(jsonb_array_length(v_rec.sponsors) = 2,
    '30/publiczne: patron medialny i wystawca stoja w grupie bez poziomu');

  -- Nieopublikowane przypiecie nie wychodzi - i nie wychodzi CALA jego grupa.
  PERFORM pg_temp.assert(
    NOT EXISTS (
      SELECT 1 FROM public.event_sponsors_public('sponsors-kongres-a') g,
        jsonb_array_elements(g.sponsors) x
      WHERE x->>'name' IN ('Firma Piata', 'Zeta Nieprzypieta')),
    '30/publiczne: nieopublikowane przypiecie NIE wychodzi na strone');
  PERFORM pg_temp.assert(
    NOT EXISTS (
      SELECT 1 FROM public.event_sponsors_public('sponsors-kongres-a') g
      WHERE g.tier_key = 'gold'),
    '30/publiczne: poziom bez ani jednego opublikowanego logotypu nie daje grupy');

  -- Wydarzenie robocze nie ma sponsorow publicznych.
  PERFORM pg_temp.assert(
    (SELECT count(*)::integer FROM public.event_sponsors_public('sponsors-gala-a')) = 0,
    '30/publiczne: wydarzenie robocze nie oddaje ANI JEDNEJ grupy');
  PERFORM pg_temp.assert(
    (SELECT count(*)::integer FROM public.event_sponsors_public('nie-ma-takiego')) = 0,
    '30/publiczne: nieistniejacy slug oddaje pustke, nie wyjatek');

  -- Materialy: warunek DWUSTOPNIOWY.
  SELECT count(*)::integer INTO v_n
  FROM public.event_sponsor_materials_public('sponsors-kongres-a');
  PERFORM pg_temp.assert(v_n = 1, format(
    '30/publiczne materialy: jedna pozycja (opublikowana, przy opublikowanym sponsorze), bylo %s',
    v_n));

  SELECT * INTO v_rec FROM public.event_sponsor_materials_public('sponsors-kongres-a');
  PERFORM pg_temp.assert(v_rec.sponsor_name = 'Orlen Energia SA',
    '30/publiczne materialy: nazwa sponsora z MIGAWKI, nie z kartoteki');
  PERFORM pg_temp.assert(v_rec.tier_name_pl = 'Diamentowy 2026',
    '30/publiczne materialy: nazwa poziomu przy pozycji');

  -- Odpiecie sponsora zdejmuje jego materialy ze strony.
  PERFORM public.admin_event_sponsors_set_published(jsonb_build_object(
    'ids', jsonb_build_array((SELECT u FROM spo_q WHERE k = 's1')::text),
    'is_published', false));
  PERFORM pg_temp.assert(
    (SELECT count(*)::integer
       FROM public.event_sponsor_materials_public('sponsors-kongres-a')) = 0,
    '30/publiczne materialy: wycofanie sponsora zdejmuje TAKZE jego materialy');
  PERFORM public.admin_event_sponsors_set_published(jsonb_build_object(
    'ids', jsonb_build_array((SELECT u FROM spo_q WHERE k = 's1')::text),
    'is_published', true));
  PERFORM pg_temp.assert(
    (SELECT count(*)::integer
       FROM public.event_sponsor_materials_public('sponsors-kongres-a')) = 1,
    '30/publiczne materialy/kontrapunkt: przywrocenie sponsora wraca z materialem');
END
$do$;

-- Sponsor najemcy B - bez niego asercje o izolacji plaszczyzny tresci
-- sprawdzalyby tylko, ze najemca B jest pusty.
SELECT pg_temp.act_as('30a00000-0000-0000-0000-0000000000b1',
                      '30000000-0000-0000-0000-0000000000b0');

DO $do$
DECLARE v_tier uuid;
BEGIN
  v_tier := public.admin_event_sponsor_tier_save(jsonb_build_object(
    'event_id', '30e00000-0000-0000-0000-0000000000b1',
    'key', 'diamond', 'name_pl', 'Diamentowy B', 'name_en', 'Diamond B',
    'rank', 100));
  INSERT INTO spo_q VALUES ('tier_b', v_tier);
  INSERT INTO spo_q VALUES ('s_b1', public.admin_event_sponsor_save(jsonb_build_object(
    'event_id', '30e00000-0000-0000-0000-0000000000b1',
    'company_id', '30c00000-0000-0000-0000-0000000000b1',
    'tier_id', v_tier, 'role', 'sponsor', 'is_published', true)));
  PERFORM pg_temp.assert(
    (SELECT count(*)::integer FROM public.event_sponsors s
      WHERE s.tenant_id = '30000000-0000-0000-0000-0000000000b0') = 1,
    '30/scenografia B: najemca B ma wlasnego opublikowanego sponsora');
END
$do$;

-- IZOLACJA PLASZCZYZNY TRESCI. `public_tenant_id()` czyta w harnessie GUC
-- `nes.public_tenant`, ktory odgrywa role naglowka `x-tenant-host`. To samo
-- zapytanie, dwa naglowki, i zaden nie widzi ani jednego wiersza drugiego.
SELECT set_config('nes.public_tenant', '30000000-0000-0000-0000-0000000000b0', false);

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sponsors_public('sponsors-kongres-a')) = 0,
  '30/IZOLACJA: na hoscie najemcy B slug najemcy A nie oddaje ANI JEDNEJ grupy');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sponsor_materials_public('sponsors-kongres-a')) = 0,
  '30/IZOLACJA: na hoscie najemcy B materialy najemcy A nie wychodza');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sponsors_public('sponsors-kongres-b')) = 1,
  '30/IZOLACJA/kontrapunkt: na hoscie najemcy B jego wlasne wydarzenie oddaje grupe');

SELECT set_config('nes.public_tenant', '', false);

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sponsors_public('sponsors-kongres-b')) = 0,
  '30/IZOLACJA: na hoscie najemcy A slug najemcy B nie oddaje ANI JEDNEJ grupy');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sponsors_public('sponsors-kongres-a')) = 2,
  '30/IZOLACJA/kontrapunkt: na hoscie najemcy A jego wlasne wydarzenie oddaje dwie grupy');

-- Publiczny RPC NIE oddaje narzedzi redakcji ani identyfikatora w kartotece
-- sprzedazowej. Sprawdzamy KONTRAKT WYJSCIA funkcji, bo wyciek kolumny nie
-- odbija sie od zadnej polityki - polityka ukrywa wiersz, nie kolumne.
SELECT pg_temp.assert(
  (SELECT pg_get_function_result(p.oid) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'event_sponsors_public')
    NOT LIKE '%internal_note%',
  '30/publiczne: kontrakt wyjscia nie zawiera notatki wewnetrznej');
SELECT pg_temp.assert(
  (SELECT pg_get_function_result(p.oid) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'event_sponsors_public')
    NOT LIKE '%company_id%',
  '30/publiczne: kontrakt wyjscia nie wiaze strony z identyfikatorem firmy w CRM');
SELECT pg_temp.assert(
  NOT EXISTS (
    SELECT 1 FROM public.event_sponsors_public('sponsors-kongres-a') g,
      jsonb_array_elements(g.sponsors) x
    WHERE x ? 'internal_note' OR x ? 'company_id' OR x ? 'snapshot_source'),
  '30/publiczne: obiekt sponsora w jsonb nie niesie pol redakcyjnych');

-- Zero `has_role()` i zero `is_staff()` w ciele obu publicznych funkcji.
-- Mieszanka naglowka hosta z rola w tenancie domowym jest wyciekiem zamknietym
-- w 20260724091000 i pilnowanym przez check:sql-tenant-scope.
SELECT pg_temp.assert(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('event_sponsors_public', 'event_sponsor_materials_public')
      AND (p.prosrc LIKE '%has_role%' OR p.prosrc LIKE '%is_staff%'
           OR p.prosrc LIKE '%assert_editor_tenant%')) = 0,
  '30/publiczne: plaszczyzna tresci nie wola has_role/is_staff/assert_editor_tenant');

-- ---------------------------------------------------------------------------
-- SEKCJA 11: BRAMKI ROL
--
-- `assert_editor_tenant()` wpuszcza admina, redaktora i super admina, a odbija
-- autora, uczestnika i anonima. Bramka, ktora sprawdza tylko zgody, nie potrafi
-- byc czerwona z powodu ZBYT SZEROKICH uprawnien - dlatego kazda rola ma
-- wlasna asercje.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as(NULL, NULL);
SELECT pg_temp.assert_raises_like(
  $q$SELECT * FROM public.admin_event_sponsors_list('30e00000-0000-0000-0000-0000000000a1')$q$,
  'forbidden',
  '30/bramka: anonim nie widzi listy sponsorow');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_sponsor_snapshot_refresh(
       '{"event_id":"30e00000-0000-0000-0000-0000000000a1"}'::jsonb)$q$,
  'forbidden',
  '30/bramka: anonim nie odswieza migawek');

SELECT pg_temp.act_as('30a00000-0000-0000-0000-0000000000a3',
                      '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert_raises_like(
  $q$SELECT * FROM public.admin_event_sponsor_tiers_list('30e00000-0000-0000-0000-0000000000a1')$q$,
  'forbidden',
  '30/bramka: uczestnik bez roli nie widzi cennika poziomow');
SELECT pg_temp.assert_raises_like(
  $q$SELECT * FROM public.admin_event_sponsor_companies_search(
       '30e00000-0000-0000-0000-0000000000a1', NULL, 10)$q$,
  'forbidden',
  '30/bramka: uczestnik bez roli nie przeszukuje kartoteki firm');

SELECT pg_temp.act_as('30a00000-0000-0000-0000-0000000000a4',
                      '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert_raises_like(
  $q$SELECT * FROM public.admin_event_sponsors_list('30e00000-0000-0000-0000-0000000000a1')$q$,
  'forbidden',
  '30/bramka: rola author NIE wystarcza (is_staff ja obejmuje, bramka nie)');

SELECT pg_temp.act_as('30a00000-0000-0000-0000-0000000000a2',
                      '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_sponsor_tiers_list(
    '30e00000-0000-0000-0000-0000000000a1')) = 3,
  '30/bramka/kontrapunkt: redaktor widzi cennik poziomow (inaczej test mierzylby blokade)');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_sponsors_list(
    '30e00000-0000-0000-0000-0000000000a1')) > 0,
  '30/bramka/kontrapunkt: redaktor widzi liste sponsorow');

-- ---------------------------------------------------------------------------
-- SEKCJA 12: IZOLACJA NAJEMCOW W ODCZYCIE
--
-- Dwa poziomy naraz:
--   * RPC panelu skalowane po tenancie DOMOWYM wolajacego - admin najemcy B
--     pyta o wydarzenie najemcy A i nie dostaje ani wiersza;
--   * POLITYKI RLS na tabelach - wymagaja `SET ROLE`, bo RLS nie obowiazuje
--     superuzytkownika, a bez tego polityki nie zostalyby nawet policzone
--     i asercja przechodzilaby ZAWSZE.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('30a00000-0000-0000-0000-0000000000b1',
                      '30000000-0000-0000-0000-0000000000b0');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_sponsors_list(
    '30e00000-0000-0000-0000-0000000000a1')) = 0,
  '30/IZOLACJA: redaktor B nie widzi ANI JEDNEGO sponsora najemcy A (lista)');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_sponsor_tiers_list(
    '30e00000-0000-0000-0000-0000000000a1')) = 0,
  '30/IZOLACJA: redaktor B nie widzi ANI JEDNEGO poziomu najemcy A');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_sponsor_detail(
    (SELECT u FROM spo_q WHERE k = 's1'))) = 0,
  '30/IZOLACJA: redaktor B nie otwiera detalu przypiecia najemcy A');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_sponsor_companies_search(
    '30e00000-0000-0000-0000-0000000000b1', NULL, 50)) = 1,
  '30/IZOLACJA: redaktor B widzi WYLACZNIE wlasna kartoteke firm (jedna firma)');

-- Kontrapunkt dla strony B - bez niego cztery asercje wyzej przechodzilyby
-- takze przy bramce, ktora nie oddaje NICZEGO nikomu.
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_sponsors_list(
    '30e00000-0000-0000-0000-0000000000b1')) = 1,
  '30/IZOLACJA/kontrapunkt: redaktor B widzi SWOJEGO sponsora');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_sponsor_detail(
    (SELECT u FROM spo_q WHERE k = 's_b1'))) = 1,
  '30/IZOLACJA/kontrapunkt: redaktor B otwiera detal SWOJEGO przypiecia');

-- Odswiezenie i publikacja wsadowa najemcy B nie dosiegaja wierszy najemcy A.
SELECT pg_temp.assert(
  public.admin_event_sponsor_snapshot_refresh(
    '{"event_id":"30e00000-0000-0000-0000-0000000000a1"}'::jsonb) = 0,
  '30/IZOLACJA: redaktor B nie odswiezy ANI JEDNEJ migawki najemcy A');
SELECT pg_temp.assert(
  public.admin_event_sponsors_set_published(jsonb_build_object(
    'ids', jsonb_build_array((SELECT u FROM spo_q WHERE k = 's5')::text),
    'is_published', true)) = 0,
  '30/IZOLACJA: redaktor B nie opublikuje ANI JEDNEGO przypiecia najemcy A');
SELECT pg_temp.assert(
  public.admin_event_sponsors_reorder(jsonb_build_object(
    'items', jsonb_build_array(jsonb_build_object(
      'id', (SELECT u FROM spo_q WHERE k = 's5')::text, 'sort_order', 999)))) = 0,
  '30/IZOLACJA: redaktor B nie przestawi ANI JEDNEGO przypiecia najemcy A');
SELECT pg_temp.assert_raises_like(format(
  $q$SELECT public.admin_event_sponsor_delete('%s')$q$, (SELECT u FROM spo_q WHERE k = 's1')),
  'not_found',
  '30/IZOLACJA: redaktor B nie usunie przypiecia najemcy A');
SELECT pg_temp.assert_raises_like(format(
  $q$SELECT public.admin_event_sponsor_material_delete('%s')$q$,
  (SELECT u FROM spo_q WHERE k = 'm1')),
  'not_found',
  '30/IZOLACJA: redaktor B nie usunie materialu najemcy A');

-- ===== POLITYKI RLS =====
-- Redaktor A na domenie A: nie widzi ani jednego wiersza najemcy B.
SELECT pg_temp.act_as('30a00000-0000-0000-0000-0000000000a2',
                      '11111111-1111-1111-1111-111111111111');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sponsors
    WHERE tenant_id = '30000000-0000-0000-0000-0000000000b0') = 0
  AND (SELECT count(*) FROM public.event_sponsor_tiers
        WHERE tenant_id = '30000000-0000-0000-0000-0000000000b0') = 0
  AND (SELECT count(*) FROM public.event_sponsor_materials
        WHERE tenant_id = '30000000-0000-0000-0000-0000000000b0') = 0,
  '30/IZOLACJA/RLS: redaktor A nie czyta ANI JEDNEGO wiersza sponsoringu najemcy B');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sponsors
    WHERE tenant_id = '11111111-1111-1111-1111-111111111111') >= 5,
  '30/IZOLACJA/RLS/kontrapunkt: redaktor A czyta SWOICH sponsorow');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sponsor_contacts
    WHERE tenant_id = '11111111-1111-1111-1111-111111111111') = 0
  AND (SELECT count(*) FROM public.event_sponsor_tier_benefits
        WHERE tenant_id = '11111111-1111-1111-1111-111111111111') = 2,
  '30/IZOLACJA/RLS/kontrapunkt: redaktor A czyta swoje swiadczenia poziomu');
-- ZAPIS wprost do tabeli nie jest mozliwy dla nikogo poza service_role -
-- jedyna droga to RPC. Brak polityki zapisu jest tu funkcja, nie luka.
SELECT pg_temp.assert_raises_like(
  $q$UPDATE public.event_sponsors SET sort_order = 1$q$,
  'permission denied',
  '30/RLS: redaktor nie ma prawa ZAPISU wprost do tabeli (zapis idzie przez RPC)');
SELECT pg_temp.assert_raises_like(
  $q$SELECT internal_note FROM public.event_sponsors LIMIT 1$q$,
  'permission denied',
  '30/RLS: notatka wewnetrzna odcieta grantem KOLUMNOWYM (polityka nie ukryje kolumny)');
RESET ROLE;

-- Redaktor B na domenie B: odwrotna strona plus kontrapunkt.
--
-- OBA WYMIARY MUSZA PRZEJSC NA B, nie jeden. `act_as` przestawia najemce
-- WOLAJACEGO (`nes.tenant`, czyli `_caller_tenant()`), ale NIE najemce
-- z naglowka Host (`nes.public_tenant`, czyli `public_tenant_id()`), a linia
-- wyzej wyczyscila go do hosta A. Polityki RLS lacza sie przez OR, wiec przy
-- wolajacym B i hoscie A wiersz najemcy A wpada w `event_sponsors_public_read`
-- i jest widoczny - CALKOWICIE POPRAWNIE, bo redaktor B na stronie najemcy A
-- jest zwyklym gosciem tej strony.
--
-- Pierwsza wersja tej asercji przestawiala tylko wolajacego i nazywala wynik
-- wyciekiem izolacji. Mierzyla plaszczyzne TRESCI, nie izolacje najemcow -
-- czyli dokladnie ten blad, przed ktorym ostrzega README harnessu przy `SET ROLE`.
SELECT pg_temp.act_as('30a00000-0000-0000-0000-0000000000b1',
                      '30000000-0000-0000-0000-0000000000b0');
SELECT set_config('nes.public_tenant', '30000000-0000-0000-0000-0000000000b0', false);
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sponsors
    WHERE tenant_id = '11111111-1111-1111-1111-111111111111') = 0
  AND (SELECT count(*) FROM public.event_sponsor_tiers
        WHERE tenant_id = '11111111-1111-1111-1111-111111111111') = 0,
  '30/IZOLACJA/RLS: redaktor B nie czyta ANI JEDNEGO wiersza sponsoringu najemcy A');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sponsors
    WHERE tenant_id = '30000000-0000-0000-0000-0000000000b0') = 1,
  '30/IZOLACJA/RLS/kontrapunkt: redaktor B czyta SWOJEGO sponsora');
RESET ROLE;

-- Host wraca na A, bo asercje anonima nizej licza wiersze WIDOCZNE NA DOMENIE A
-- i ich liczby (cztery przypiecia, jeden material, dwa swiadczenia) sa liczbami
-- scenografii najemcy A.
SELECT set_config('nes.public_tenant', '', false);

-- Anonim: plaszczyzna tresci na tabelach. Widzi WYLACZNIE opublikowane
-- przypiecia opublikowanego wydarzenia swojego najemcy - i ani jednej osoby
-- kontaktowej, bo tam nie ma nawet grantu.
SELECT pg_temp.act_as(NULL, NULL);
SET ROLE anon;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sponsors) = 4,
  '30/RLS anon: widzi cztery opublikowane przypiecia opublikowanego wydarzenia');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sponsors WHERE NOT is_published) = 0,
  '30/RLS anon: nie widzi ANI JEDNEGO nieopublikowanego przypiecia');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sponsors
    WHERE tenant_id = '30000000-0000-0000-0000-0000000000b0') = 0,
  '30/IZOLACJA/RLS anon: na hoscie A nie widzi przypiec najemcy B');
-- Poziom WYLACZONY jest widoczny - wylaczenie jest decyzja cennikowa, nie
-- decyzja o ukryciu opublikowanych logotypow.
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sponsor_tiers WHERE NOT is_active) = 1,
  '30/RLS anon: poziom wylaczony jest widoczny (polityka nie filtruje is_active)');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sponsor_materials) = 1,
  '30/RLS anon: tylko opublikowany material opublikowanego sponsora');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sponsor_tier_benefits) = 2,
  '30/RLS anon: swiadczenia opublikowanego wydarzenia widoczne');
SELECT pg_temp.assert_raises_like(
  $q$SELECT count(*) FROM public.event_sponsor_contacts$q$,
  'permission denied',
  '30/RLS anon: osoby kontaktowe bez grantu (dane osobowe, zero sciezki na strone)');
SELECT pg_temp.assert_raises_like(
  $q$SELECT internal_note FROM public.event_sponsors LIMIT 1$q$,
  'permission denied',
  '30/RLS anon: notatka wewnetrzna odcieta grantem kolumnowym');
SELECT pg_temp.assert_raises_like(
  $q$SELECT * FROM public.admin_event_sponsors_list(
       '30e00000-0000-0000-0000-0000000000a1')$q$,
  'permission denied',
  '30/granty: anon nie ma prawa WYKONANIA zadnego RPC panelu');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sponsors_public('sponsors-kongres-a')) = 2,
  '30/granty/kontrapunkt: anon WYKONUJE publiczny RPC sponsorow');
RESET ROLE;

-- Wydarzenie wycofane ze publikacji zabiera ze strony CALY sponsoring -
-- to jest ten sam warunek `e.status = 'published'` w kazdej polityce publicznej.
UPDATE public.events SET status = 'draft'
WHERE id = '30e00000-0000-0000-0000-0000000000a1';
SET ROLE anon;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_sponsors) = 0
  AND (SELECT count(*) FROM public.event_sponsor_tiers) = 0
  AND (SELECT count(*) FROM public.event_sponsor_materials) = 0
  AND (SELECT count(*) FROM public.event_sponsor_tier_benefits) = 0,
  '30/RLS anon: wycofanie wydarzenia zdejmuje CALY sponsoring ze strony');
RESET ROLE;
UPDATE public.events SET status = 'published'
WHERE id = '30e00000-0000-0000-0000-0000000000a1';

-- ---------------------------------------------------------------------------
-- SEKCJA 13: POMOCNIK NORMALIZACJI ADRESU
--
-- Jedna funkcja odpowiada za dwie rzeczy naraz: wartosc zapisana do migawki
-- i wartosc porownywana z migawka. Dwie kopie tej logiki dawalyby rozjazd
-- zglaszany WIECZNIE (migawka "https://x", kartoteka "x").
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(public._event_sponsor_web_url(NULL) IS NULL,
  '30/adres: NULL zostaje NULL-em');
SELECT pg_temp.assert(public._event_sponsor_web_url('   ') IS NULL,
  '30/adres: same spacje daja NULL, nie "https://"');
SELECT pg_temp.assert(public._event_sponsor_web_url('example.com') = 'https://example.com',
  '30/adres: adres bez schematu domkniety do https');
SELECT pg_temp.assert(public._event_sponsor_web_url('  http://example.com ') = 'http://example.com',
  '30/adres: istniejacy schemat http zachowany, ogon spacji obciety');
SELECT pg_temp.assert(char_length(
  public._event_sponsor_web_url(repeat('a', 900))) = 500,
  '30/adres: dlugosc obcieta do 500 znakow (kolumna migawki tyle przyjmuje)');

-- Pomocnik jest WEWNETRZNY: klient nie ma prawa go wykonac.
SET ROLE authenticated;
SELECT pg_temp.assert_raises_like(
  $q$SELECT public._event_sponsor_web_url('x')$q$,
  'permission denied',
  '30/adres: pomocnik wewnetrzny nie jest wykonywalny przez authenticated');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- SEKCJA 14: USUNIECIA I KASKADY
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('30a00000-0000-0000-0000-0000000000a1',
                      '11111111-1111-1111-1111-111111111111');

DO $do$
DECLARE
  v_s1 uuid := (SELECT u FROM spo_q WHERE k = 's1');
  v_diamond uuid := (SELECT u FROM spo_q WHERE k = 'diamond');
  v_media uuid := (SELECT u FROM spo_q WHERE k = 'media');
BEGIN
  -- Poziom w uzyciu: odmowa Z LICZBA, nie kod 23503 z klucza obcego.
  PERFORM pg_temp.assert_raises_like(format(
    $q$SELECT public.admin_event_sponsor_tier_delete('%s')$q$, v_diamond),
    'tier_in_use',
    '30/usuniecia: poziom z przypietymi firmami nie da sie usunac');

  -- Obnizenie limitu ponizej liczby przypiec zostawialoby poziom w stanie,
  -- ktorego nie naprawi zadna operacja na poziomie.
  PERFORM pg_temp.assert_raises_like(format(
    $q$SELECT public.admin_event_sponsor_tier_save(jsonb_build_object(
         'id','%s','name_pl','Diamentowy','name_en','Diamond','max_companies',1))$q$,
    v_diamond),
    'tier_over_capacity',
    '30/usuniecia: obnizenie limitu ponizej liczby przypiec odrzucone');

  PERFORM pg_temp.assert(public.admin_event_sponsor_tier_delete(v_media),
    '30/usuniecia: poziom bez przypiec usuniety');
  PERFORM pg_temp.assert_raises_like(format(
    $q$SELECT public.admin_event_sponsor_tier_delete('%s')$q$, v_media),
    'not_found',
    '30/usuniecia: powtorne usuniecie tego samego poziomu odrzucone');

  -- Usuniecie przypiecia zabiera materialy i kontakty, ale NIE firme.
  PERFORM public.admin_event_sponsor_contacts_set(jsonb_build_object(
    'sponsor_id', v_s1, 'items', jsonb_build_array(
      jsonb_build_object('lead_id', '30d00000-0000-0000-0000-0000000000a1'))));
  PERFORM pg_temp.assert(public.admin_event_sponsor_delete(v_s1),
    '30/usuniecia: przypiecie usuniete');
  PERFORM pg_temp.assert(
    (SELECT count(*)::integer FROM public.event_sponsor_materials m
      WHERE m.sponsor_id = v_s1) = 0,
    '30/usuniecia: materialy przypiecia ida kaskada');
  PERFORM pg_temp.assert(
    (SELECT count(*)::integer FROM public.event_sponsor_contacts k
      WHERE k.sponsor_id = v_s1) = 0,
    '30/usuniecia: osoby kontaktowe przypiecia ida kaskada');
  PERFORM pg_temp.assert(
    (SELECT count(*)::integer FROM public.crm_companies c
      WHERE c.id = '30c00000-0000-0000-0000-0000000000a1') = 1,
    '30/usuniecia: firma w kartotece ZOSTAJE (jedno zrodlo prawdy o firmie)');
  PERFORM pg_temp.assert_raises_like(format(
    $q$SELECT public.admin_event_sponsor_delete('%s')$q$, v_s1),
    'not_found',
    '30/usuniecia: powtorne usuniecie tego samego przypiecia odrzucone');

  -- Usuniecie WYDARZENIA zabiera caly jego sponsoring.
  DELETE FROM public.events WHERE id = '30e00000-0000-0000-0000-0000000000a1';
  PERFORM pg_temp.assert(
    (SELECT count(*)::integer FROM public.event_sponsors s
      WHERE s.event_id = '30e00000-0000-0000-0000-0000000000a1') = 0
    AND (SELECT count(*)::integer FROM public.event_sponsor_tiers t
      WHERE t.event_id = '30e00000-0000-0000-0000-0000000000a1') = 0,
    '30/usuniecia: usuniecie wydarzenia kasuje jego poziomy i przypiecia (kaskada)');
END
$do$;

-- ---------------------------------------------------------------------------
-- SEKCJA 15: STRUKTURA - to, co musi byc prawda niezaleznie od danych
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND c.relname IN ('event_sponsor_tiers', 'event_sponsor_tier_benefits',
                        'event_sponsors', 'event_sponsor_contacts',
                        'event_sponsor_materials')) = 5,
  '30/struktura: migracja zostawila wszystkie piec tabel podmodulu');

SELECT pg_temp.assert(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE '%sponsor%') = 19,
  '30/struktura: migracja zostawila 19 funkcji (16 panelu, 2 publiczne, 1 pomocnik)');

SELECT pg_temp.assert(
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('event_sponsor_tiers', 'event_sponsor_tier_benefits',
                        'event_sponsors', 'event_sponsor_contacts',
                        'event_sponsor_materials')
      AND NOT c.relrowsecurity) = 0,
  '30/struktura: RLS wlaczone na wszystkich pieciu tabelach');

-- ZERO polityk zapisu. Jedyna droga zapisu to RPC SECURITY DEFINER z bramka -
-- to jest stan pozadany, nie przeoczenie.
SELECT pg_temp.assert(
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('event_sponsor_tiers', 'event_sponsor_tier_benefits',
                        'event_sponsors', 'event_sponsor_contacts',
                        'event_sponsor_materials')
      AND cmd <> 'SELECT') = 0,
  '30/struktura: ZERO polityk zapisu na tabelach podmodulu');

SELECT pg_temp.assert(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE '%sponsor%' AND p.prosecdef
      AND NOT EXISTS (
        SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) cfg
        WHERE cfg LIKE 'search_path=%')) = 0,
  '30/struktura: kazda funkcja SECURITY DEFINER podmodulu ma ustawiony search_path');

SELECT pg_temp.assert(
  (SELECT count(*) FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'event_sponsor_contacts'
      AND grantee = 'anon') = 0,
  '30/struktura: anon nie ma ZADNEGO grantu na osoby kontaktowe');

-- `internal_note` i `created_by` nie wychodza klientowi ZADNYM grantem
-- kolumnowym - polityka wierszowa nie umie ukryc kolumny.
SELECT pg_temp.assert(
  (SELECT count(*) FROM information_schema.column_privileges
    WHERE table_schema = 'public' AND table_name = 'event_sponsors'
      AND column_name IN ('internal_note', 'created_by')
      AND grantee IN ('anon', 'authenticated')) = 0,
  '30/struktura: notatka wewnetrzna i autor wpisu bez grantu dla anon/authenticated');

-- Kazdy indeks skalowany po najemcy ma `tenant_id` na PIERWSZEJ pozycji -
-- inaczej zapytanie panelu czyta caly indeks i skalowanie jest pozorne.
SELECT pg_temp.assert(
  (SELECT count(*) FROM pg_index i
     JOIN pg_class c ON c.oid = i.indrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = i.indkey[0]
    WHERE n.nspname = 'public'
      AND c.relname IN ('event_sponsor_tiers', 'event_sponsor_tier_benefits',
                        'event_sponsors', 'event_sponsor_contacts',
                        'event_sponsor_materials')
      AND NOT i.indisprimary
      AND a.attname <> 'tenant_id') = 0,
  '30/struktura: kazdy indeks wtorny podmodulu ma tenant_id na pierwszej pozycji');

SELECT pg_temp.act_as(NULL, NULL);

ROLLBACK;

\echo '== 30 sponsorzy: koniec =='
