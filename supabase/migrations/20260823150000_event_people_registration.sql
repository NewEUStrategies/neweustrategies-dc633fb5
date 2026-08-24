-- ============================================================================
-- Event Builder, etap 3: UCZESTNICY I ZAPISY
-- (osoby bez konta, formularz, kwalifikacja, bilety, grupy, zgody, rezerwa)
--
-- STAN PRZED
--
-- Zapis na wydarzenie to dzis JEDEN wiersz `event_rsvps (event_id, user_id,
-- status)` z migracji 20260713093000. Wynikaja z tego cztery blokady, ktorych
-- nie da sie obejsc ani widokiem, ani komponentem:
--
--   1) `user_id uuid NOT NULL REFERENCES auth.users` - uczestnik MUSI miec konto.
--      W danych referencyjnych 21 z 21 prelegentow ma "No account", a redakcja
--      nie zaloz y 21 kont bez wiedzy tych osob. Dzisiejszy model nie pozwala
--      wpisac do wydarzenia czlowieka, ktory sie na nie zapisal mailem.
--   2) Status ma trzy wartosci (`going`, `interested`, `cancelled`; `waitlist`
--      dosypany w 20260721150000). Nie ma stanu "oczekuje na decyzje", nie ma
--      "odrzucony", nie ma "byl" i "nie przyszedl". Wydarzenie z akceptacja
--      organizatora nie ma wiec gdzie trzymac zgloszenia miedzy wyslaniem
--      formularza a decyzja - a to jest polowa cyklu zycia zapisu.
--   3) Nie ma FORMULARZA. `events.registration_flow = 'approval'` (etap 1)
--      obiecuje akceptacje, ale nie istnieje ani jedno pole, ani jedna
--      odpowiedz, ani jedna regula kwalifikujaca. Obietnica bez nosnika.
--   4) Cena biletu to DWIE kolumny na wydarzeniu (`ticket_price_cents`,
--      `ticket_currency`, 20260729174905). Jedno wydarzenie ma wiec dokladnie
--      jedna cene: nie da sie sprzedac wejsciowki studenckiej obok pelnej, nie
--      da sie otworzyc i zamknac okna sprzedazy, nie da sie ograniczyc puli.
--
-- Dodatkowo nie istnieje NIC z rzeczy, ktore wydarzenie z akceptacja wymaga
-- z mocy prawa i z mocy organizacji: zgody per wydarzenie z wersja, rejestr
-- akceptacji, grupy uczestnikow z uprawnieniami, kolejka rezerwowa z pozycja.
--
-- STAN PO
--
-- Osiem tabel i dwadziescia dwa RPC, w trzech warstwach:
--
--   KARTOTEKA OSOB (`event_people`) - rejestr ludzi NAJEMCY, nie wydarzenia.
--     Osoba istnieje niezaleznie od konta w `auth.users` i niezaleznie od
--     wydarzenia; `user_id` jest OPCJONALNYM dowiazaniem, ktore zapina sie przy
--     pierwszym zalogowaniu. Adres poczty jest unikalny W GRANICACH NAJEMCY,
--     wiec ta sama osoba na trzech wydarzeniach to JEDEN wiersz z jedna
--     historia zgod - nie trzy wiersze, ktore sie rozjada przy pierwszej
--     zmianie nazwiska.
--
--   ZAPIS (`event_registrations`) - fakt "ta osoba i to wydarzenie", z osmioma
--     stanami cyklu zycia, trybem zapisu, biletem, odpowiedziami formularza,
--     sladem decyzji (kto, kiedy, na jakiej podstawie, dlaczego) i HASZEM
--     tokenu kodu QR. Jedna osoba ma najwyzej JEDEN aktywny zapis na dane
--     wydarzenie - pilnuje tego indeks czesciowy, nie warunek w kliencie.
--
--   OPRAWA WYDARZENIA - pola formularza (`event_registration_fields`) z regula
--     kwalifikujaca, bilety (`event_ticket_types`) z pula i oknem sprzedazy,
--     grupy z uprawnieniami (`event_groups`, `event_group_members`), zgody
--     z wersja i rejestrem akceptacji (`event_terms`,
--     `event_term_acceptances`).
--
-- DLACZEGO TAK
--
-- OSOBA JEST NAJEMCY, NIE WYDARZENIA. Projekt modulu (§4.11) zapisuje
-- `event_people` z `event_id` i `UNIQUE (event_id, email_norm)`. Wlasciciel
-- produktu przewazyl to warunkiem "unikalnosc adresu poczty w granicach
-- najemcy": osoba, ktora byla na trzech wydarzeniach, ma byc jednym czlowiekiem
-- w bazie. Roznica jest praktyczna, nie estetyczna - przy kartotece per
-- wydarzenie zgoda RODO wycofana raz zostaje wycofana w JEDNYM wierszu z trzech,
-- a lista uczestnikow kolejnej edycji nie wie, ze ten czlowiek juz byl.
-- Przypisanie do wydarzenia niesie zapis, nie osoba.
--
-- KLUCZ OBCY ZLOZONY WSZEDZIE. Kazda tabela wiazana z wydarzeniem deklaruje
-- `FOREIGN KEY (tenant_id, event_id) REFERENCES events (tenant_id, id)`
-- (kotwica z 20260823135000), a kazda tabela-wnuk analogicznie do swojego
-- rodzica po trojce `(tenant_id, event_id, id)`. Skutek: wiersz nie moze
-- wskazywac wydarzenia, grupy ani biletu obcego najemcy, i nie moze wskazywac
-- grupy z INNEGO wydarzenia tego samego najemcy. Odrzuca to silnik, nie trigger
-- - wiec obowiazuje takze przy `COPY`, imporcie i migracji danych.
--
-- UPRAWNIENIA GRUPY TO KOLUMNY LOGICZNE, NIE JSONB. Kazde uprawnienie jest
-- predykatem, ktory czyta SQL: polityka, filtr listy, warunek RPC. Klucz w
-- jsonb nie da sie objac CHECK-iem, a literowka w nazwie klucza czyta sie jako
-- NULL, czyli jako "brak uprawnienia" - uprawnienie znika po cichu i nikt tego
-- nie zauwazy do pierwszej skargi. Kolumna daje NOT NULL, DEFAULT i kontrakt
-- widoczny w typach klienta. Koszt: nowe uprawnienie wymaga migracji. To jest
-- wlasciwa cena, bo nowe uprawnienie i tak wymaga nowego kodu, ktory je
-- egzekwuje.
--
-- PULA MIEJSC JEST SERIALIZOWANA BLOKADA WIERSZA, NIE ODCZYTEM LICZNIKA.
-- `_event_seats_left()` liczy wolne miejsca, ale KAZDA sciezka, ktora miejsce
-- ZAJMUJE (zapis publiczny, zatwierdzenie przez organizatora, promocja
-- z rezerwy), najpierw blokuje wiersz biletu albo wiersz wydarzenia klauzula
-- `FOR UPDATE`. Dwa jednoczesne zapisy ustawiaja sie wtedy w kolejke na tym
-- wierszu i drugi widzi skutek pierwszego. Licznik `sold_count` jest
-- utrzymywany triggerem (przeliczenie, nie inkrementacja - inkrementacja gubi
-- sie przy kazdej sciezce, ktora o niej nie wie), a `CHECK (sold_count <=
-- quota)` jest ostatnia linia obrony przed sciezka, ktorej dzis nie znamy.
--
-- TOKEN KODU QR: HASZ W BAZIE, JAWNY RAZ W ODPOWIEDZI. Token powstaje po
-- stronie bazy (`gen_random_bytes`), do tabeli idzie `sha256`, a wartosc jawna
-- wraca w odpowiedzi RPC dokladnie raz - w chwili, gdy zapis staje sie
-- zatwierdzony. Wyciek zrzutu tabeli nie daje wiec wstepu na wydarzenie.
--
-- IZOLACJA NAJEMCOW
--
--   * kazda tabela ma `tenant_id uuid NOT NULL REFERENCES tenants(id)`;
--   * kazda tabela ma RLS wlaczone i JAWNE polityki tylko do ODCZYTU stafowego
--     (admin albo editor, `tenant_id = current_tenant_id()`) oraz do odczytu
--     wlasnego wiersza; zapis nie ma zadnej polityki, bo idzie WYLACZNIE przez
--     RPC `SECURITY DEFINER`. Brak polityki to stan pozadany, nie przeoczenie;
--   * plaszczyzna administracyjna uzywa `assert_editor_tenant()` (tenant DOMOWY
--     wolajacego) i nigdy naglowka hosta;
--   * plaszczyzna tresci (trzy RPC publiczne) uzywa `public_tenant_id()` i NIE
--     wola `has_role()` ani `is_staff()` w zadnym z tych trzech cial - naglowek
--     hosta jest falsyfikowalny, wiec mieszanka pozwalalaby podszyc sie pod
--     najemce (bramka `check:sql-tenant-scope`);
--   * anonim NIE dostaje grantu na zadna tabele tego modulu i nie ma zadnej
--     polityki INSERT - jedyna sciezka zapisu anonimowego to `event_register()`,
--     ktora sama ustala najemce z kontekstu i nigdy nie czyta `tenant_id`
--     z wejscia (bramka `check:sql-anon-insert`);
--   * kazda funkcja SECURITY DEFINER ma `SET search_path`.
--
-- FORWARD-ONLY I IDEMPOTENTNOSC. Tabele `IF NOT EXISTS`, ograniczenia
-- dokladane blokami `DO $$` z testem `pg_constraint`, polityki wzorcem
-- `DROP POLICY IF EXISTS` + `CREATE POLICY`, seed grup `ON CONFLICT DO NOTHING`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Kotwica tozsamosci firmy w granicach najemcy
--
-- `event_people.company_id` wskazuje rejestr firm CRM (`crm_companies`,
-- 20260706201356) - modul NIE tworzy drugiego rejestru firm. Zeby to wskazanie
-- nie moglo przekroczyc granicy najemcy, potrzebny jest klucz obcy ZLOZONY,
-- a ten wymaga unikalnosci `(tenant_id, id)` po stronie firm. Dokladnie ten sam
-- zabieg, co `events_tenant_id_key` w 20260823135000, i z tego samego powodu:
-- bez niego wiersz osoby najemcy A moze wskazywac firme najemcy B, oba klucze
-- obce sa spelnione osobno, a zapytanie skalowane po `tenant_id` widzi obca
-- firme przy swojej osobie.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.crm_companies'::regclass
      AND conname = 'crm_companies_tenant_id_key'
  ) THEN
    ALTER TABLE public.crm_companies
      ADD CONSTRAINT crm_companies_tenant_id_key UNIQUE (tenant_id, id);
  END IF;
END
$$;

COMMENT ON CONSTRAINT crm_companies_tenant_id_key ON public.crm_companies IS
  'Tozsamosc firmy w granicach najemcy. Cel kluczy obcych zlozonych (tenant_id, company_id) - uniemozliwia wskazanie firmy innego najemcy.';

-- ----------------------------------------------------------------------------
-- 1) KARTOTEKA OSOB - uczestnik bez konta w systemie
--
-- `user_id` jest NULL-owalne i to jest cala istota tej tabeli: czlowiek moze
-- byc uczestnikiem, prelegentem i leadem, nie majac konta. Kiedy zaklada konto
-- (albo loguje sie pierwszy raz adresem, ktory juz tu jest), `event_register()`
-- dopina `user_id` do istniejacego wiersza - nie tworzy drugiego.
--
-- ZGODY OSOBY SA TRZY I KAZDA MA WLASNY STEMPEL, bo kazda ma inny zakres
-- i inna date waznosci. Zgoda na przetwarzanie danych jest warunkiem obslugi
-- zapisu, zgoda marketingowa i zgoda na przekazanie danych partnerowi NIE SA
-- - i dlatego nie moga siedziec w jednym booleanie "zgody: tak". Wycofanie
-- jest osobnym stemplem, bo dowod potrzebuje obu dat, nie jednej flagi.
-- Zgody PER WYDARZENIE (regulamin, klauzula partnera) mieszkaja w
-- `event_terms` - tam maja wersje i tresc.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- Dowiazanie do konta. ON DELETE SET NULL, nie CASCADE: usuniecie konta nie
  -- moze wykasowac historii obecnosci na wydarzeniu, bo to dokument rozliczenia.
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email text,
  -- Klucz dopasowania. `NULLIF` po `btrim` sprowadza pusty napis do NULL, wiec
  -- dwa wiersze bez adresu nie koliduja na indeksie unikalnym.
  email_norm text GENERATED ALWAYS AS (NULLIF(lower(btrim(email)), '')) STORED,
  first_name text NOT NULL,
  last_name text NOT NULL,
  -- Znormalizowane imie i nazwisko: zrodlo wyszukiwania w panelu. Kolumna
  -- wyliczana, a nie liczona w zapytaniu, bo tylko wtedy da sie ja zaindeksowac.
  full_name_norm text GENERATED ALWAYS AS
    (lower(btrim(btrim(first_name) || ' ' || btrim(last_name)))) STORED,
  phone text,
  job_title text,
  -- Nazwa firmy WPISANA (uczestnik podal w formularzu) obok wskazania firmy
  -- w CRM. Oba pola sa potrzebne: dopasowanie do CRM jest decyzja redakcji,
  -- a do czasu tej decyzji trzeba pamietac, co czlowiek napisal.
  company_text text,
  company_id uuid,
  -- Profil zawodowy w serwisie spolecznosciowym. https wymagane, bo adres
  -- jedzie do atrybutu href.
  social_profile_url text,
  source text NOT NULL DEFAULT 'self_registration',
  notes text,
  consent_data_processing_at timestamptz,
  consent_marketing_at timestamptz,
  consent_partner_sharing_at timestamptz,
  consent_withdrawn_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_people_first_name_len
    CHECK (char_length(btrim(first_name)) BETWEEN 1 AND 80),
  CONSTRAINT event_people_last_name_len
    CHECK (char_length(btrim(last_name)) BETWEEN 1 AND 80),
  CONSTRAINT event_people_email_shape CHECK (
    email IS NULL
    OR btrim(email) = ''
    OR btrim(email) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$'
  ),
  CONSTRAINT event_people_email_len CHECK (email IS NULL OR char_length(email) <= 320),
  CONSTRAINT event_people_phone_len CHECK (phone IS NULL OR char_length(btrim(phone)) BETWEEN 4 AND 40),
  CONSTRAINT event_people_job_title_len CHECK (job_title IS NULL OR char_length(job_title) <= 160),
  CONSTRAINT event_people_company_text_len CHECK (company_text IS NULL OR char_length(company_text) <= 200),
  CONSTRAINT event_people_social_url_https
    CHECK (social_profile_url IS NULL OR social_profile_url ~ '^https://'),
  CONSTRAINT event_people_notes_len CHECK (notes IS NULL OR char_length(notes) <= 4000),
  CONSTRAINT event_people_source_values CHECK (source IN (
    'self_registration', 'invitation', 'organizer', 'import', 'crm', 'partner', 'scan'
  )),
  -- Tozsamosc osoby w granicach najemcy: cel kluczy obcych zlozonych
  -- (tenant_id, person_id) w zapisach, czlonkostwach i akceptacjach zgod.
  CONSTRAINT event_people_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_people_company_tenant_fkey
    FOREIGN KEY (tenant_id, company_id)
    REFERENCES public.crm_companies (tenant_id, id) ON DELETE SET NULL
);

COMMENT ON TABLE public.event_people IS
  'Kartoteka osob najemcy dla modulu Wydarzen. Osoba istnieje BEZ konta w auth.users; user_id jest opcjonalnym dowiazaniem zapinanym przy pierwszym zapisie zalogowanego. Adres poczty unikalny w granicach najemcy.';
COMMENT ON COLUMN public.event_people.user_id IS
  'Opcjonalne dowiazanie do konta. NULL = uczestnik bez konta (21 z 21 prelegentow w danych referencyjnych). Dopinane przez event_register(), gdy adres sie zgadza.';
COMMENT ON COLUMN public.event_people.email_norm IS
  'Klucz dopasowania osoby (lower+btrim, pusty napis na NULL). Zrodlo unikalnosci w granicach najemcy.';
COMMENT ON COLUMN public.event_people.company_text IS
  'Nazwa firmy podana przez uczestnika. Zostaje po dopasowaniu do CRM - dowod, co czlowiek naprawde napisal.';
COMMENT ON COLUMN public.event_people.company_id IS
  'Firma z rejestru CRM (crm_companies). Klucz obcy ZLOZONY po (tenant_id, company_id), wiec nie da sie wskazac firmy obcego najemcy.';
COMMENT ON COLUMN public.event_people.source IS
  'Zrodlo pozyskania: self_registration | invitation | organizer | import | crm | partner | scan.';
COMMENT ON COLUMN public.event_people.consent_data_processing_at IS
  'Stempel zgody na przetwarzanie danych. Warunek obslugi zapisu - event_register() go wymaga.';
COMMENT ON COLUMN public.event_people.consent_partner_sharing_at IS
  'Stempel zgody na przekazanie danych partnerowi (skan badge na stoisku). NIE MOZE blokowac zatwierdzenia zapisu - inaczej jest zgoda pozorna.';
COMMENT ON COLUMN public.event_people.consent_withdrawn_at IS
  'Stempel wycofania zgod. Osobna kolumna, nie skasowanie stempla nadania - dowod potrzebuje obu dat.';

CREATE UNIQUE INDEX IF NOT EXISTS event_people_tenant_email_uniq
  ON public.event_people (tenant_id, email_norm) WHERE email_norm IS NOT NULL;
-- Jedno konto to najwyzej jedna osoba w kartotece najemcy. Bez tego dwa wiersze
-- z tym samym `user_id` daja dwie historie obecnosci jednego czlowieka.
CREATE UNIQUE INDEX IF NOT EXISTS event_people_tenant_user_uniq
  ON public.event_people (tenant_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_people_tenant_name_idx
  ON public.event_people (tenant_id, last_name, first_name);
CREATE INDEX IF NOT EXISTS event_people_tenant_company_idx
  ON public.event_people (tenant_id, company_id) WHERE company_id IS NOT NULL;

GRANT SELECT ON public.event_people TO authenticated;
GRANT ALL ON public.event_people TO service_role;
ALTER TABLE public.event_people ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_people_staff_read" ON public.event_people;
CREATE POLICY "event_people_staff_read"
  ON public.event_people FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

-- Wlasny wiersz kartoteki. Warunek tenanta jest tu OBOWIAZKOWY, mimo ze
-- `user_id = auth.uid()` wyglada na wystarczajacy: rodzenstwo na tej tabeli
-- tenanta pilnuje, a asymetria "zapisywalne w tenancie domowym, czytelne
-- w dowolnym" to dokladnie regresja z audytu 2026-08-03 na author_profiles.
DROP POLICY IF EXISTS "event_people_self_read" ON public.event_people;
CREATE POLICY "event_people_self_read"
  ON public.event_people FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND user_id = (SELECT auth.uid())
  );

DROP TRIGGER IF EXISTS event_people_touch_updated_at ON public.event_people;
CREATE TRIGGER event_people_touch_updated_at
  BEFORE UPDATE ON public.event_people
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 2) GRUPY UCZESTNIKOW - widocznosc i uprawnienia w obrebie wydarzenia
--
-- Grupa jest jednostka, w ktorej wydarzenie rozdaje uprawnienia: kto widzi
-- liste uczestnikow, kto moze prosic o spotkanie, kto rozmawia na czacie, kto
-- skanuje leady. Uprawnienia sa KOLUMNAMI LOGICZNYMI - uzasadnienie w naglowku
-- migracji.
--
-- `attendee_visibility` odpowiada na pytanie "kto kogo widzi" i ma cztery
-- wartosci, bo trzy nie wystarczaja: uczestnik moze nie widziec nikogo (sesja
-- Chatham House), widziec wlasna grupe (panel z prelegentami), widziec
-- wszystkich zapisanych (networking) albo byc widoczny takze dla gosci (katalog
-- wystawcow na stronie publicznej). Kolumna `can_see_attendees` jest
-- WLACZNIKIEM, `attendee_visibility` ZASIEGIEM - zlanie ich w jedno kasuje
-- roznice miedzy "nie widzi" i "widzi tylko swoich".
--
-- `is_default` wskazuje grupe, ktora dostaje zapis bez biletu. Indeks czesciowy
-- unikalny pilnuje, ze jest DOKLADNIE jedna taka grupa na wydarzenie - dwie
-- domyslne grupy znaczylyby, ze przypisanie jest losowe.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  key text NOT NULL,
  name_pl text NOT NULL,
  name_en text NOT NULL,
  description_pl text NOT NULL DEFAULT '',
  description_en text NOT NULL DEFAULT '',
  color text,
  attendee_visibility text NOT NULL DEFAULT 'registered',
  can_see_attendees boolean NOT NULL DEFAULT true,
  can_meet boolean NOT NULL DEFAULT false,
  can_chat boolean NOT NULL DEFAULT true,
  can_lead_retrieval boolean NOT NULL DEFAULT false,
  can_see_recording boolean NOT NULL DEFAULT true,
  min_tier_rank integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 100,
  is_default boolean NOT NULL DEFAULT false,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_groups_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,48}$'),
  CONSTRAINT event_groups_name_pl_len CHECK (char_length(btrim(name_pl)) BETWEEN 2 AND 80),
  CONSTRAINT event_groups_name_en_len CHECK (char_length(btrim(name_en)) BETWEEN 2 AND 80),
  CONSTRAINT event_groups_desc_pl_len CHECK (char_length(description_pl) <= 500),
  CONSTRAINT event_groups_desc_en_len CHECK (char_length(description_en) <= 500),
  -- Kolor jedzie do CSS jako zmienna, wiec musi byc literalem heksadecymalnym.
  CONSTRAINT event_groups_color_hex CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$'),
  CONSTRAINT event_groups_visibility_values
    CHECK (attendee_visibility IN ('none', 'own_group', 'registered', 'everyone')),
  -- Zasieg bez wlacznika jest sprzecznoscia: "nie widzi listy, ale widzi
  -- wszystkich zapisanych". Odrzucamy to na poziomie danych.
  CONSTRAINT event_groups_visibility_consistent
    CHECK (can_see_attendees OR attendee_visibility = 'none'),
  CONSTRAINT event_groups_tier_rank_nonneg CHECK (min_tier_rank >= 0),
  CONSTRAINT event_groups_event_key_unique UNIQUE (tenant_id, event_id, key),
  -- Tozsamosc grupy w granicach najemcy I wydarzenia. Trojka, nie para: bilet
  -- i czlonkostwo maja wskazywac grupe TEGO wydarzenia, nie dowolna grupe
  -- najemcy.
  CONSTRAINT event_groups_event_id_key UNIQUE (tenant_id, event_id, id),
  CONSTRAINT event_groups_event_tenant_fkey
    FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_groups IS
  'Grupy uczestnikow wydarzenia z uprawnieniami. Uprawnienia sa kolumnami logicznymi (nie jsonb), bo kazde jest predykatem czytanym przez SQL.';
COMMENT ON COLUMN public.event_groups.attendee_visibility IS
  'Zasieg widocznosci uczestnikow: none | own_group | registered | everyone. Wlacznikiem jest can_see_attendees, ta kolumna jest zasiegiem.';
COMMENT ON COLUMN public.event_groups.is_default IS
  'Grupa przypisywana zapisowi bez biletu. Dokladnie jedna na wydarzenie (indeks event_groups_default_uniq).';
COMMENT ON COLUMN public.event_groups.is_system IS
  'Grupa zaseedowana przez modul (uczestnicy, prelegenci, organizatorzy). Nie da sie jej usunac - zabralaby etykiete z archiwum zapisow.';

CREATE UNIQUE INDEX IF NOT EXISTS event_groups_default_uniq
  ON public.event_groups (tenant_id, event_id) WHERE is_default;
CREATE INDEX IF NOT EXISTS event_groups_event_order_idx
  ON public.event_groups (tenant_id, event_id, sort_order, key);

GRANT SELECT ON public.event_groups TO authenticated;
GRANT ALL ON public.event_groups TO service_role;
ALTER TABLE public.event_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_groups_staff_read" ON public.event_groups;
CREATE POLICY "event_groups_staff_read"
  ON public.event_groups FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

DROP TRIGGER IF EXISTS event_groups_touch_updated_at ON public.event_groups;
CREATE TRIGGER event_groups_touch_updated_at
  BEFORE UPDATE ON public.event_groups
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 3) BILETY - ustawiane KAZDEMU WYDARZENIU INDYWIDUALNIE
--
-- Decyzja wlasciciela produktu: nie ma globalnego cennika. Bilet zyje pod
-- wydarzeniem, ma wlasna pule, wlasne okno sprzedazy i wlasny prog warstwy
-- czlonkowskiej.
--
-- KRAWEDZ KLUCZOWA: BILET NADAJE GRUPE. Bez tego administrator przypisuje grupe
-- recznie przy kazdym uczestniku - przy 300 zapisach to trzysta okazji do
-- pomylki. `group_id` wskazuje grupe TEGO wydarzenia (klucz obcy po trojce).
--
-- STATUS SPRZEDAZY NIE JEST KOLUMNA. "W sprzedazy", "wyprzedany",
-- "zakonczony", "zaplanowany" wynikaja z okna sprzedazy, puli i flagi
-- aktywnosci. Kolumna statusu rozjechalaby sie z tymi trzema w pierwszej
-- minucie po zamknieciu okna, bo nikt jej wtedy nie aktualizuje.
--
-- `sold_count` JEST kolumna, ale utrzymuje ja trigger przeliczajacy - nie
-- klient i nie inkrementacja. Uzasadnienie w naglowku migracji.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_ticket_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  key text NOT NULL,
  name_pl text NOT NULL,
  name_en text NOT NULL,
  description_pl text NOT NULL DEFAULT '',
  description_en text NOT NULL DEFAULT '',
  -- Cena w najmniejszej jednostce waluty. Zero = wejsciowka bezplatna, ktora
  -- nadal ma pule i okno sprzedazy - to jest inny stan niz brak biletu.
  price_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'PLN',
  quota integer,
  sold_count integer NOT NULL DEFAULT 0,
  sales_from timestamptz,
  sales_to timestamptz,
  min_tier_rank integer NOT NULL DEFAULT 0,
  requires_approval boolean NOT NULL DEFAULT false,
  group_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_ticket_types_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,48}$'),
  CONSTRAINT event_ticket_types_name_pl_len CHECK (char_length(btrim(name_pl)) BETWEEN 2 AND 80),
  CONSTRAINT event_ticket_types_name_en_len CHECK (char_length(btrim(name_en)) BETWEEN 2 AND 80),
  CONSTRAINT event_ticket_types_desc_pl_len CHECK (char_length(description_pl) <= 1000),
  CONSTRAINT event_ticket_types_desc_en_len CHECK (char_length(description_en) <= 1000),
  CONSTRAINT event_ticket_types_price_nonneg CHECK (price_cents >= 0),
  -- Waluty zgodne z `events_ticket_currency_allowed` (20260729174905). Trzecia
  -- waluta wymaga decyzji w kasie, nie w module wydarzen.
  CONSTRAINT event_ticket_types_currency_values CHECK (currency IN ('PLN', 'EUR')),
  CONSTRAINT event_ticket_types_quota_positive CHECK (quota IS NULL OR quota > 0),
  CONSTRAINT event_ticket_types_sold_nonneg CHECK (sold_count >= 0),
  -- Ostatnia linia obrony puli. Blokada wiersza w RPC jest pierwsza; ten CHECK
  -- lapie sciezke, ktorej dzis nie znamy (import, poprawka reczna, przyszly kod).
  CONSTRAINT event_ticket_types_sold_within_quota
    CHECK (quota IS NULL OR sold_count <= quota),
  CONSTRAINT event_ticket_types_sales_window
    CHECK (sales_from IS NULL OR sales_to IS NULL OR sales_to > sales_from),
  CONSTRAINT event_ticket_types_tier_rank_nonneg CHECK (min_tier_rank >= 0),
  CONSTRAINT event_ticket_types_event_key_unique UNIQUE (tenant_id, event_id, key),
  CONSTRAINT event_ticket_types_event_id_key UNIQUE (tenant_id, event_id, id),
  CONSTRAINT event_ticket_types_event_tenant_fkey
    FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  -- Grupa nadawana przez bilet MUSI byc grupa tego samego wydarzenia. Trojka
  -- w kluczu obcym zamyka to na poziomie silnika.
  CONSTRAINT event_ticket_types_group_fkey
    FOREIGN KEY (tenant_id, event_id, group_id)
    REFERENCES public.event_groups (tenant_id, event_id, id) ON DELETE SET NULL
);

COMMENT ON TABLE public.event_ticket_types IS
  'Bilety wydarzenia. Ustawiane per wydarzenie - nie ma globalnego cennika. Bilet NADAJE GRUPE (group_id). Status sprzedazy nie jest kolumna: wynika z okna, puli i is_active.';
COMMENT ON COLUMN public.event_ticket_types.price_cents IS
  'Cena w najmniejszej jednostce waluty. 0 = wejsciowka bezplatna z pula i oknem sprzedazy (inny stan niz brak biletu).';
COMMENT ON COLUMN public.event_ticket_types.quota IS
  'Pula miejsc. NULL = bez limitu. Serializacja przez FOR UPDATE na tym wierszu w kazdym RPC zajmujacym miejsce.';
COMMENT ON COLUMN public.event_ticket_types.sold_count IS
  'Liczba zajetych miejsc (zapisy w statusie approved / attended / no_show). Utrzymywana triggerem przeliczajacym, nie inkrementacja.';
COMMENT ON COLUMN public.event_ticket_types.group_id IS
  'Grupa nadawana zapisowi z tym biletem. Klucz obcy po (tenant_id, event_id, group_id) - grupa musi byc z TEGO wydarzenia.';
COMMENT ON COLUMN public.event_ticket_types.requires_approval IS
  'Bilet wymaga akceptacji organizatora nawet gdy wydarzenie ma tryb natychmiastowy (np. wejsciowka prasowa).';

CREATE INDEX IF NOT EXISTS event_ticket_types_event_order_idx
  ON public.event_ticket_types (tenant_id, event_id, sort_order, key);
CREATE INDEX IF NOT EXISTS event_ticket_types_event_active_idx
  ON public.event_ticket_types (tenant_id, event_id) WHERE is_active;

GRANT SELECT ON public.event_ticket_types TO authenticated;
GRANT ALL ON public.event_ticket_types TO service_role;
ALTER TABLE public.event_ticket_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_ticket_types_staff_read" ON public.event_ticket_types;
CREATE POLICY "event_ticket_types_staff_read"
  ON public.event_ticket_types FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

DROP TRIGGER IF EXISTS event_ticket_types_touch_updated_at ON public.event_ticket_types;
CREATE TRIGGER event_ticket_types_touch_updated_at
  BEFORE UPDATE ON public.event_ticket_types
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 4) POLA FORMULARZA ZAPISU - definicja per wydarzenie
--
-- Dziesiec typow pola pokrywa cala liste referencyjna. `consent` jest typem
-- OSOBNYM od `checkbox`, mimo ze na ekranie wygladaja tak samo: zgoda ma
-- wartosc dowodowa, wiec jej akceptacja idzie do `event_term_acceptances`
-- z wersja, a nie do `answers` jako zwykla odpowiedz.
--
-- REGULA KWALIFIKUJACA. Pole oznaczone `is_qualifying` niesie predykat
-- (`qualify_operator` + `qualify_value`) i SKUTEK jego SPELNIENIA
-- (`qualify_outcome`): automatyczne odrzucenie, skierowanie do akceptacji albo
-- natychmiastowe zatwierdzenie. Kierunek jest wazny i celowy - regula opisuje,
-- co ma sie stac, GDY warunek trafi, a nie gdy nie trafi. Odwrotna konwencja
-- ("regula musi byc spelniona, inaczej odrzut") nie umie wyrazic zdania
-- "przedstawiciel administracji publicznej idzie do akceptacji", bo to jest
-- warunek POZYTYWNY z negatywnym skutkiem.
--
-- Pierwszenstwo skutkow: odrzucenie > akceptacja > zatwierdzenie. Jedna regula
-- odrzucajaca wygrywa z dziesiecioma zatwierdzajacymi, bo bramka bezpieczenstwa
-- domyka sie, a nie otwiera.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_registration_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  key text NOT NULL,
  field_type text NOT NULL DEFAULT 'text',
  label_pl text NOT NULL,
  label_en text NOT NULL,
  help_pl text NOT NULL DEFAULT '',
  help_en text NOT NULL DEFAULT '',
  is_required boolean NOT NULL DEFAULT false,
  -- Opcje listy: [{ "value": "gov", "label_pl": "...", "label_en": "..." }].
  -- Tablica, nie obiekt, bo kolejnosc opcji jest trescia redakcyjna.
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order integer NOT NULL DEFAULT 100,
  is_qualifying boolean NOT NULL DEFAULT false,
  qualify_operator text NOT NULL DEFAULT 'none',
  qualify_value jsonb NOT NULL DEFAULT 'null'::jsonb,
  qualify_outcome text NOT NULL DEFAULT 'approval',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_registration_fields_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,48}$'),
  CONSTRAINT event_registration_fields_label_pl_len
    CHECK (char_length(btrim(label_pl)) BETWEEN 1 AND 200),
  CONSTRAINT event_registration_fields_label_en_len
    CHECK (char_length(btrim(label_en)) BETWEEN 1 AND 200),
  CONSTRAINT event_registration_fields_help_pl_len CHECK (char_length(help_pl) <= 500),
  CONSTRAINT event_registration_fields_help_en_len CHECK (char_length(help_en) <= 500),
  CONSTRAINT event_registration_fields_type_values CHECK (field_type IN (
    'text', 'textarea', 'select', 'multiselect', 'checkbox', 'switch',
    'number', 'date', 'file', 'consent'
  )),
  CONSTRAINT event_registration_fields_options_array
    CHECK (jsonb_typeof(options) = 'array'),
  -- Lista bez opcji jest polem, ktorego nie da sie wypelnic. Odrzucamy to przy
  -- zapisie definicji, a nie przy pierwszym zgloszeniu uczestnika.
  CONSTRAINT event_registration_fields_options_required CHECK (
    field_type NOT IN ('select', 'multiselect')
    OR jsonb_array_length(options) > 0
  ),
  CONSTRAINT event_registration_fields_operator_values CHECK (qualify_operator IN (
    'none', 'equals', 'not_equals', 'in', 'not_in',
    'gte', 'lte', 'is_true', 'is_false', 'not_empty'
  )),
  CONSTRAINT event_registration_fields_outcome_values
    CHECK (qualify_outcome IN ('auto_approve', 'approval', 'reject')),
  -- Pole kwalifikujace bez operatora nie kwalifikuje niczego - to znaczy, ze
  -- redaktor zaznaczyl przelacznik i nie dokonczyl reguly. Lepiej odmowic zapisu
  -- definicji niz udawac, ze bramka dziala.
  CONSTRAINT event_registration_fields_qualify_complete
    CHECK (NOT is_qualifying OR qualify_operator <> 'none'),
  CONSTRAINT event_registration_fields_event_key_unique UNIQUE (tenant_id, event_id, key),
  CONSTRAINT event_registration_fields_event_tenant_fkey
    FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_registration_fields IS
  'Definicja pol formularza zapisu per wydarzenie, wraz z regula kwalifikujaca. Typ `consent` idzie do event_term_acceptances (wersja, dowod), nie do answers.';
COMMENT ON COLUMN public.event_registration_fields.qualify_outcome IS
  'Co sie stanie, GDY predykat trafi: auto_approve | approval | reject. Pierwszenstwo: reject > approval > auto_approve.';
COMMENT ON COLUMN public.event_registration_fields.qualify_value IS
  'Wartosc oczekiwana predykatu. Skalar dla equals/gte/lte, tablica dla in/not_in, nieuzywana dla is_true/is_false/not_empty.';
COMMENT ON COLUMN public.event_registration_fields.options IS
  'Opcje listy: tablica obiektow { value, label_pl, label_en }. Tablica, bo kolejnosc opcji jest trescia redakcyjna.';

CREATE INDEX IF NOT EXISTS event_registration_fields_event_order_idx
  ON public.event_registration_fields (tenant_id, event_id, sort_order, key);
CREATE INDEX IF NOT EXISTS event_registration_fields_qualifying_idx
  ON public.event_registration_fields (tenant_id, event_id)
  WHERE is_active AND is_qualifying;

GRANT SELECT ON public.event_registration_fields TO authenticated;
GRANT ALL ON public.event_registration_fields TO service_role;
ALTER TABLE public.event_registration_fields ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_registration_fields_staff_read" ON public.event_registration_fields;
CREATE POLICY "event_registration_fields_staff_read"
  ON public.event_registration_fields FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

DROP TRIGGER IF EXISTS event_registration_fields_touch_updated_at ON public.event_registration_fields;
CREATE TRIGGER event_registration_fields_touch_updated_at
  BEFORE UPDATE ON public.event_registration_fields
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 5) ZAPIS NA WYDARZENIE
--
-- OSIEM STANOW, bo cykl zycia zapisu ma osiem punktow, w ktorych organizator
-- podejmuje inna decyzje:
--   draft     - formularz rozpoczety i niedokonczony (zapis czesciowy);
--   pending   - zgloszenie czeka na decyzje organizatora;
--   approved  - zatwierdzony, miejsce zajete, token QR wydany;
--   rejected  - odrzucony (recznie albo regula kwalifikujaca);
--   waitlist  - lista rezerwowa z pozycja w kolejce;
--   cancelled - anulowany (przez uczestnika albo organizatora);
--   attended  - byl na wydarzeniu (fakt osobny od zapisu);
--   no_show   - zapisal sie i nie przyszedl (bez tego nie da sie policzyc
--               frekwencji, a frekwencja jest jedyna miara wartosci zapisu).
--
-- JEDEN AKTYWNY ZAPIS NA OSOBE I WYDARZENIE. Pilnuje tego indeks CZESCIOWY
-- unikalny z warunkiem `status NOT IN ('cancelled','rejected')`. Dwa stany
-- terminalne sa wylaczone celowo: po anulowaniu i po odrzuceniu czlowiek moze
-- zglosic sie ponownie, a historia poprzedniej proby musi zostac. Warunek
-- w kliencie zamiast indeksu przepuszczalby dwa rownolegle zgloszenia.
--
-- SLAD DECYZJI JEST ROZBITY NA TRZY KOLUMNY, bo odpowiada na trzy rozne
-- pytania: KTO (`decided_by`, NULL gdy zadecydowala regula), KIEDY
-- (`decided_at`) i NA JAKIEJ PODSTAWIE (`decision_source`). Bez trzeciej
-- kolumny nie da sie odroznic odrzucenia przez czlowieka od odrzucenia przez
-- regule, a to jest pierwsze pytanie przy skardze uczestnika.
--
-- POWOD ODRZUCENIA JEST WYMAGANY, GDY ODRZUCA CZLOWIEK. CHECK
-- `event_registrations_rejection_has_reason` wymusza to na poziomie danych -
-- odrzucenie bez powodu jest nie do obrony wobec uczestnika, a organizator
-- i tak nie pamieta go po tygodniu. Odrzucenie regula powodu nie potrzebuje:
-- powod jest w definicji reguly.
--
-- TOKEN KODU QR: kolumna trzyma SHA-256, nigdy wartosc jawna.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  person_id uuid NOT NULL,
  ticket_type_id uuid,
  group_id uuid,
  status text NOT NULL DEFAULT 'pending',
  -- Tryb zapisu UTRWALONY w chwili zapisu. Wydarzenie moze zmienic tryb po
  -- fakcie; zgloszenie ma pamietac, w jakim trybie powstalo, bo od tego zalezy,
  -- czy odpowiedzi formularza sa w ogole oczekiwane.
  registration_mode text NOT NULL,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'self_registration',
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_source text,
  decision_note text,
  qr_token_hash text,
  qr_issued_at timestamptz,
  -- Uchwyt samoobslugowy osoby BEZ konta. To osobny sekret od tokenu
  -- wejsciowego, bo sluzy do czego innego: token QR jest poswiadczeniem WEJSCIA
  -- i powstaje w chwili zatwierdzenia, uchwyt sluzy do PODEJRZENIA I ANULOWANIA
  -- wlasnego zgloszenia i musi istniec od pierwszej sekundy - takze dla
  -- zgloszenia oczekujacego na decyzje, ktore tokenu wejsciowego jeszcze nie ma.
  -- Zlanie ich w jedno znaczyloby, ze albo oczekujacy nie moze sie wycofac,
  -- albo odrzucony trzyma w rece poswiadczenie wejscia.
  manage_token_hash text,
  waitlist_position integer,
  waitlist_notified_at timestamptz,
  promoted_at timestamptz,
  cancelled_at timestamptz,
  attended_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_registrations_status_values CHECK (status IN (
    'draft', 'pending', 'approved', 'rejected', 'waitlist',
    'cancelled', 'attended', 'no_show'
  )),
  -- `events.registration_mode` ma cztery wartosci, ale tylko dwie moga
  -- WYPRODUKOWAC wiersz zapisu: `external` prowadzi do obcego narzedzia,
  -- `none` nie prowadzi nigdzie.
  CONSTRAINT event_registrations_mode_values CHECK (registration_mode IN ('rsvp', 'form')),
  CONSTRAINT event_registrations_answers_object CHECK (jsonb_typeof(answers) = 'object'),
  CONSTRAINT event_registrations_source_values CHECK (source IN (
    'self_registration', 'invitation', 'organizer', 'import', 'crm', 'partner', 'scan'
  )),
  CONSTRAINT event_registrations_decision_source_values CHECK (
    decision_source IS NULL
    OR decision_source IN ('organizer', 'automatic_rule', 'capacity', 'system')
  ),
  -- Autor decyzji bez jej daty to slad, ktorego nie da sie ulozyc w czasie.
  CONSTRAINT event_registrations_decision_dated
    CHECK (decided_by IS NULL OR decided_at IS NOT NULL),
  CONSTRAINT event_registrations_decision_sourced
    CHECK (decided_at IS NULL OR decision_source IS NOT NULL),
  CONSTRAINT event_registrations_rejection_has_reason CHECK (
    status <> 'rejected'
    OR decision_source IS DISTINCT FROM 'organizer'
    OR char_length(btrim(COALESCE(decision_note, ''))) >= 3
  ),
  CONSTRAINT event_registrations_note_len
    CHECK (decision_note IS NULL OR char_length(decision_note) <= 2000),
  CONSTRAINT event_registrations_waitlist_position_positive
    CHECK (waitlist_position IS NULL OR waitlist_position > 0),
  -- Pozycja w kolejce ma sens WYLACZNIE dla wiersza w kolejce. Zostawiona po
  -- promocji klamalaby o miejscu w kolejce, ktorej ten czlowiek juz nie zajmuje.
  CONSTRAINT event_registrations_waitlist_position_scoped
    CHECK (waitlist_position IS NULL OR status = 'waitlist'),
  CONSTRAINT event_registrations_qr_shape CHECK (
    qr_token_hash IS NULL OR qr_token_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT event_registrations_qr_dated
    CHECK (qr_token_hash IS NULL OR qr_issued_at IS NOT NULL),
  CONSTRAINT event_registrations_manage_shape CHECK (
    manage_token_hash IS NULL OR manage_token_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT event_registrations_cancelled_dated
    CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL),
  CONSTRAINT event_registrations_attended_dated
    CHECK (status <> 'attended' OR attended_at IS NOT NULL),
  -- Tozsamosc zapisu w granicach najemcy (akceptacje zgod) i w granicach
  -- wydarzenia (przyszle tabele-wnuki, np. zapis na sesje agendy).
  CONSTRAINT event_registrations_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_registrations_event_id_key UNIQUE (tenant_id, event_id, id),
  CONSTRAINT event_registrations_event_tenant_fkey
    FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_registrations_person_fkey
    FOREIGN KEY (tenant_id, person_id)
    REFERENCES public.event_people (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_registrations_ticket_fkey
    FOREIGN KEY (tenant_id, event_id, ticket_type_id)
    REFERENCES public.event_ticket_types (tenant_id, event_id, id) ON DELETE SET NULL,
  CONSTRAINT event_registrations_group_fkey
    FOREIGN KEY (tenant_id, event_id, group_id)
    REFERENCES public.event_groups (tenant_id, event_id, id) ON DELETE SET NULL
);

COMMENT ON TABLE public.event_registrations IS
  'Zapis osoby na wydarzenie: osiem stanow cyklu zycia, tryb zapisu, bilet, grupa, odpowiedzi formularza, slad decyzji i HASZ tokenu QR. Jeden aktywny zapis na osobe i wydarzenie.';
COMMENT ON COLUMN public.event_registrations.registration_mode IS
  'Tryb zapisu utrwalony w chwili zapisu (rsvp | form). Wydarzenie moze zmienic tryb pozniej - zgloszenie pamieta swoj.';
COMMENT ON COLUMN public.event_registrations.decision_source IS
  'Na jakiej podstawie zapadla decyzja: organizer | automatic_rule | capacity | system. Bez tego nie da sie odroznic odrzucenia przez czlowieka od odrzucenia przez regule.';
COMMENT ON COLUMN public.event_registrations.qr_token_hash IS
  'SHA-256 tokenu wejsciowego. Wartosc jawna wraca w odpowiedzi RPC dokladnie raz, w chwili zatwierdzenia - zrzut tabeli nie daje wstepu.';
COMMENT ON COLUMN public.event_registrations.manage_token_hash IS
  'SHA-256 uchwytu samoobslugowego. Pozwala osobie BEZ konta podejrzec i anulowac wlasne zgloszenie od pierwszej sekundy - takze zgloszenie oczekujace, ktore tokenu wejsciowego nie ma.';
COMMENT ON COLUMN public.event_registrations.waitlist_position IS
  'Pozycja w kolejce rezerwowej. Unikalna wsrod wierszy waitlist danego wydarzenia; czyszczona przy zmianie statusu (CHECK waitlist_position_scoped).';
COMMENT ON COLUMN public.event_registrations.waitlist_notified_at IS
  'Stempel powiadomienia o awansie z rezerwy. Ustawiany, gdy powiadomienie w aplikacji naprawde powstalo; dla osoby bez konta stempluje go admin_event_registration_mark_notified() po wyslaniu wiadomosci.';
COMMENT ON COLUMN public.event_registrations.answers IS
  'Odpowiedzi na pola formularza, po kluczu pola. Zgody NIE trafiaja tutaj - ida do event_term_acceptances z wersja.';

-- Jeden aktywny zapis na osobe i wydarzenie.
CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_active_uniq
  ON public.event_registrations (tenant_id, event_id, person_id)
  WHERE status NOT IN ('cancelled', 'rejected');
-- Kolejnosc w kolejce rezerwowej jest FAKTEM, nie sugestia: dwie osoby nie moga
-- zajmowac tej samej pozycji.
CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_waitlist_order_uniq
  ON public.event_registrations (tenant_id, event_id, waitlist_position)
  WHERE status = 'waitlist';
CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_qr_uniq
  ON public.event_registrations (tenant_id, qr_token_hash)
  WHERE qr_token_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_manage_uniq
  ON public.event_registrations (tenant_id, manage_token_hash)
  WHERE manage_token_hash IS NOT NULL;
-- Lista panelu: najemca, wydarzenie, status, potem porzadek prezentacji.
CREATE INDEX IF NOT EXISTS event_registrations_event_status_idx
  ON public.event_registrations (tenant_id, event_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS event_registrations_event_ticket_idx
  ON public.event_registrations (tenant_id, event_id, ticket_type_id)
  WHERE ticket_type_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_registrations_person_idx
  ON public.event_registrations (tenant_id, person_id, created_at DESC);

GRANT SELECT ON public.event_registrations TO authenticated;
GRANT ALL ON public.event_registrations TO service_role;
ALTER TABLE public.event_registrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_registrations_staff_read" ON public.event_registrations;
CREATE POLICY "event_registrations_staff_read"
  ON public.event_registrations FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

-- Wlasny zapis czyta sie przez kartoteke: uczestnik z kontem widzi wiersze
-- osoby, ktora do jego konta jest dowiazana. Warunek tenanta jest tu
-- obowiazkowy - patrz komentarz przy event_people_self_read.
DROP POLICY IF EXISTS "event_registrations_self_read" ON public.event_registrations;
CREATE POLICY "event_registrations_self_read"
  ON public.event_registrations FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND EXISTS (
      SELECT 1 FROM public.event_people p
      WHERE p.id = event_registrations.person_id
        AND p.tenant_id = event_registrations.tenant_id
        AND p.user_id = (SELECT auth.uid())
    )
  );

DROP TRIGGER IF EXISTS event_registrations_touch_updated_at ON public.event_registrations;
CREATE TRIGGER event_registrations_touch_updated_at
  BEFORE UPDATE ON public.event_registrations
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 6) CZLONKOSTWO OSOB W GRUPACH (grupy DODATKOWE)
--
-- Grupa PODSTAWOWA jedzie na zapisie (`event_registrations.group_id`, nadana
-- biletem). Ta tabela trzyma grupy DODATKOWE: prelegent, ktory jest tez
-- uczestnikiem; przedstawiciel partnera, ktory prowadzi panel.
--
-- Uprawnienie wypadkowe z wielu grup to SUMA zdolnosci - najbardziej
-- pozwalajaca wygrywa. Iloczyn dawalby efekt odwrotny do zamierzonego:
-- dopisanie czlowieka do drugiej grupy ODBIERALOBY mu uprawnienia.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  group_id uuid NOT NULL,
  person_id uuid NOT NULL,
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_group_members_unique UNIQUE (tenant_id, group_id, person_id),
  CONSTRAINT event_group_members_group_fkey
    FOREIGN KEY (tenant_id, event_id, group_id)
    REFERENCES public.event_groups (tenant_id, event_id, id) ON DELETE CASCADE,
  CONSTRAINT event_group_members_person_fkey
    FOREIGN KEY (tenant_id, person_id)
    REFERENCES public.event_people (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_group_members IS
  'Czlonkostwo osob w grupach DODATKOWYCH wydarzenia. Grupa podstawowa jedzie na zapisie. Uprawnienie wypadkowe = suma zdolnosci wszystkich grup.';

CREATE INDEX IF NOT EXISTS event_group_members_group_idx
  ON public.event_group_members (tenant_id, group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS event_group_members_person_idx
  ON public.event_group_members (tenant_id, person_id);

GRANT SELECT ON public.event_group_members TO authenticated;
GRANT ALL ON public.event_group_members TO service_role;
ALTER TABLE public.event_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_group_members_staff_read" ON public.event_group_members;
CREATE POLICY "event_group_members_staff_read"
  ON public.event_group_members FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

-- ----------------------------------------------------------------------------
-- 7) ZGODY I REGULAMINY PER WYDARZENIE
--
-- WERSJA JEST WARUNKIEM WARTOSCI DOWODOWEJ: zgoda na wersje 1 nie jest zgoda
-- na wersje 2. Podniesienie wersji nie kasuje starych akceptacji - one
-- pozostaja dowodem tego, na co czlowiek naprawde sie zgodzil - ale przestaja
-- liczyc sie jako aktualne, wiec formularz poprosi o zgode ponownie.
--
-- ZGODA NIEWYMAGANA NIE MOZE BLOKOWAC ZATWIERDZENIA. Klauzula "przekazanie
-- danych partnerowi" jest z natury opcjonalna; gdyby jej brak wstrzymywal
-- zapis, byla by zgoda pozorna - a zgoda pozorna jest wada prawna, nie
-- niedogodnoscia. Reguly pilnuje `event_register()`, ktora wymaga wylacznie
-- zgod z `is_required = true`.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  key text NOT NULL,
  label_pl text NOT NULL,
  label_en text NOT NULL,
  body_pl text NOT NULL DEFAULT '',
  body_en text NOT NULL DEFAULT '',
  external_url text,
  display text NOT NULL DEFAULT 'registration',
  is_required boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_terms_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,48}$'),
  CONSTRAINT event_terms_label_pl_len CHECK (char_length(btrim(label_pl)) BETWEEN 2 AND 300),
  CONSTRAINT event_terms_label_en_len CHECK (char_length(btrim(label_en)) BETWEEN 2 AND 300),
  CONSTRAINT event_terms_body_pl_len CHECK (char_length(body_pl) <= 40000),
  CONSTRAINT event_terms_body_en_len CHECK (char_length(body_en) <= 40000),
  CONSTRAINT event_terms_external_url_https
    CHECK (external_url IS NULL OR external_url ~ '^https://'),
  CONSTRAINT event_terms_display_values
    CHECK (display IN ('registration', 'access', 'registration_and_access')),
  CONSTRAINT event_terms_version_positive CHECK (version > 0),
  -- Zgoda bez tresci i bez odnosnika jest checkboxem pod pustym miejscem.
  CONSTRAINT event_terms_has_content CHECK (
    char_length(btrim(body_pl)) > 0
    OR char_length(btrim(body_en)) > 0
    OR external_url IS NOT NULL
  ),
  CONSTRAINT event_terms_event_key_unique UNIQUE (tenant_id, event_id, key),
  CONSTRAINT event_terms_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_terms_event_tenant_fkey
    FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_terms IS
  'Zgody i regulaminy per wydarzenie, z wersja. Podniesienie wersji uniewaznia akceptacje jako AKTUALNA, nie kasuje jej jako dowodu.';
COMMENT ON COLUMN public.event_terms.display IS
  'Gdzie zgoda jest pokazywana: registration (przy zapisie) | access (przy wejsciu na tresc) | registration_and_access (w obu miejscach).';
COMMENT ON COLUMN public.event_terms.version IS
  'Wersja tresci. Zgoda na wersje N nie jest zgoda na wersje N+1 - formularz poprosi ponownie.';

CREATE INDEX IF NOT EXISTS event_terms_event_order_idx
  ON public.event_terms (tenant_id, event_id, sort_order, key);

GRANT SELECT ON public.event_terms TO authenticated;
GRANT ALL ON public.event_terms TO service_role;
ALTER TABLE public.event_terms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_terms_staff_read" ON public.event_terms;
CREATE POLICY "event_terms_staff_read"
  ON public.event_terms FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

DROP TRIGGER IF EXISTS event_terms_touch_updated_at ON public.event_terms;
CREATE TRIGGER event_terms_touch_updated_at
  BEFORE UPDATE ON public.event_terms
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 8) REJESTR AKCEPTACJI ZGOD
--
-- Klucz naturalny to TROJKA (zgoda, osoba, wersja). Ta sama osoba akceptuje
-- wersje 1 i wersje 2 - to sa dwa osobne dowody, oba warte zachowania.
--
-- ADRES JEST HASZEM, NIE ADRESEM. Wartosc dowodowa ma haszu wystarczajaco duzo
-- (da sie potwierdzic zgodnosc z podanym adresem), a ryzyka danych osobowych
-- juz nie niesie. Hasz liczy warstwa serwerowa i podaje w wywolaniu - dokladnie
-- ten sam uklad, co `verify_content_password(_ip_hash)` z 20260720071845, bo
-- Postgres za PostgREST nie widzi adresu klienta.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_term_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  term_id uuid NOT NULL,
  person_id uuid NOT NULL,
  registration_id uuid,
  version integer NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  ip_hash text,
  user_agent text,
  CONSTRAINT event_term_acceptances_version_positive CHECK (version > 0),
  CONSTRAINT event_term_acceptances_ip_hash_shape
    CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{16,128}$'),
  CONSTRAINT event_term_acceptances_user_agent_len
    CHECK (user_agent IS NULL OR char_length(user_agent) <= 400),
  CONSTRAINT event_term_acceptances_withdrawn_after
    CHECK (withdrawn_at IS NULL OR withdrawn_at >= accepted_at),
  CONSTRAINT event_term_acceptances_unique UNIQUE (tenant_id, term_id, person_id, version),
  CONSTRAINT event_term_acceptances_term_fkey
    FOREIGN KEY (tenant_id, term_id)
    REFERENCES public.event_terms (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_term_acceptances_person_fkey
    FOREIGN KEY (tenant_id, person_id)
    REFERENCES public.event_people (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_term_acceptances_registration_fkey
    FOREIGN KEY (tenant_id, registration_id)
    REFERENCES public.event_registrations (tenant_id, id) ON DELETE SET NULL
);

COMMENT ON TABLE public.event_term_acceptances IS
  'Rejestr akceptacji zgod wydarzenia: kto, kiedy, ktora wersje, z jakiego adresu (HASZ, nie adres). Klucz naturalny: (zgoda, osoba, wersja).';
COMMENT ON COLUMN public.event_term_acceptances.ip_hash IS
  'Hasz adresu klienta liczony przez warstwe serwerowa i podany w wywolaniu (Postgres za PostgREST adresu nie widzi). NULL = nie zapisano.';

CREATE INDEX IF NOT EXISTS event_term_acceptances_term_idx
  ON public.event_term_acceptances (tenant_id, term_id, accepted_at DESC);
CREATE INDEX IF NOT EXISTS event_term_acceptances_person_idx
  ON public.event_term_acceptances (tenant_id, person_id);
CREATE INDEX IF NOT EXISTS event_term_acceptances_registration_idx
  ON public.event_term_acceptances (tenant_id, registration_id)
  WHERE registration_id IS NOT NULL;

GRANT SELECT ON public.event_term_acceptances TO authenticated;
GRANT ALL ON public.event_term_acceptances TO service_role;
ALTER TABLE public.event_term_acceptances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_term_acceptances_staff_read" ON public.event_term_acceptances;
CREATE POLICY "event_term_acceptances_staff_read"
  ON public.event_term_acceptances FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

DROP POLICY IF EXISTS "event_term_acceptances_self_read" ON public.event_term_acceptances;
CREATE POLICY "event_term_acceptances_self_read"
  ON public.event_term_acceptances FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND EXISTS (
      SELECT 1 FROM public.event_people p
      WHERE p.id = event_term_acceptances.person_id
        AND p.tenant_id = event_term_acceptances.tenant_id
        AND p.user_id = (SELECT auth.uid())
    )
  );

-- ============================================================================
-- CZESC B: MECHANIKA. Triggery utrzymujace prawde o liczbach, funkcje pomocnicze
-- z jednym miejscem prawdy na regule, i dopiero potem RPC.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- B1) Licznik zajetych miejsc biletu - PRZELICZENIE, nie inkrementacja
--
-- Inkrementacja gubi sie przy kazdej sciezce, ktora o niej nie wie: odrzuceniu
-- po zatwierdzeniu, anulowaniu, imporcie, poprawce recznej. Przeliczenie jest
-- odporne na wszystkie te sciezki, bo nie zna zadnej z nich - liczy stan.
--
-- MIEJSCE ZAJMUJA TRZY STATUSY: `approved`, `attended` i `no_show`. Trzeci jest
-- najmniej oczywisty i najwazniejszy: kto sie zapisal i nie przyszedl, ZAJAL
-- miejsce - odjecie go z licznika po wydarzeniu falszowalo by raport sprzedazy.
-- `pending` miejsca NIE zajmuje: gdyby zajmowal, jedno zgloszenie odrzucone
-- po tygodniu blokowaloby miejsce przez tydzien.
--
-- Warunek `t.sold_count <> c.cnt` nie jest optymalizacja - bez niego kazda
-- zmiana statusu zapisu przestawialaby `updated_at` biletu, czyli szum
-- w historii zmian redakcyjnych.
-- ----------------------------------------------------------------------------
-- Funkcje TRIGGEROWE nie dostaja `DROP FUNCTION IF EXISTS` przed `CREATE`, w
-- odroznieniu od pozostalych dwudziestu dziewieciu: przy powtornym przebiegu
-- migracji trigger juz istnieje i DROP odbil by sie zaleznoscia
-- (`cannot drop function ... other objects depend on it`), a `DROP ... CASCADE`
-- skasowalby sam trigger. `CREATE OR REPLACE` wymienia cialo w miejscu - to samo
-- rozwiazanie, co w 20260823120000 dla `tg_events_stamp_lifecycle`.
CREATE OR REPLACE FUNCTION public.tg_event_registrations_sync_ticket_sold()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_ids uuid[] := ARRAY[]::uuid[];
  v_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_tenant := OLD.tenant_id;
  ELSE
    v_tenant := NEW.tenant_id;
  END IF;

  IF TG_OP <> 'INSERT' AND OLD.ticket_type_id IS NOT NULL THEN
    v_ids := array_append(v_ids, OLD.ticket_type_id);
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.ticket_type_id IS NOT NULL THEN
    v_ids := array_append(v_ids, NEW.ticket_type_id);
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    UPDATE public.event_ticket_types t
    SET sold_count = c.cnt
    FROM (
      SELECT count(*)::integer AS cnt
      FROM public.event_registrations r
      WHERE r.tenant_id = v_tenant
        AND r.ticket_type_id = v_id
        AND r.status IN ('approved', 'attended', 'no_show')
    ) c
    WHERE t.id = v_id
      AND t.tenant_id = v_tenant
      AND t.sold_count <> c.cnt;
  END LOOP;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.tg_event_registrations_sync_ticket_sold() IS
  'Przelicza event_ticket_types.sold_count po kazdej zmianie zapisu. Miejsce zajmuja statusy approved / attended / no_show.';

DROP TRIGGER IF EXISTS event_registrations_sync_ticket_sold ON public.event_registrations;
CREATE TRIGGER event_registrations_sync_ticket_sold
  AFTER INSERT OR DELETE OR UPDATE OF status, ticket_type_id, tenant_id
  ON public.event_registrations
  FOR EACH ROW EXECUTE FUNCTION public.tg_event_registrations_sync_ticket_sold();

-- ----------------------------------------------------------------------------
-- B2) Trzy grupy startowe dla kazdego wydarzenia
--
-- Wydarzenie bez zadnej grupy nie umie skorzystac z mechanizmu "bilet nadaje
-- grupe", a redaktor nie ma czego wybrac w selekcie. Grupy startowe sa wiec
-- warunkiem uzywalnosci modulu, nie ozdoba - i dlatego powstaja przy TWORZENIU
-- wydarzenia (trigger), a nie przy pierwszym wejsciu na ekran grup.
--
-- `is_system = true` chroni je przed usunieciem: skasowana grupa zabralaby
-- etykiete z archiwum zapisow.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._event_seed_default_groups(_tenant uuid, _event_id uuid);
CREATE OR REPLACE FUNCTION public._event_seed_default_groups(_tenant uuid, _event_id uuid)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_default boolean;
  v_inserted integer;
BEGIN
  IF _tenant IS NULL OR _event_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.event_groups g
    WHERE g.tenant_id = _tenant AND g.event_id = _event_id AND g.is_default
  ) INTO v_has_default;

  INSERT INTO public.event_groups (
    tenant_id, event_id, key, name_pl, name_en, description_pl, description_en,
    color, attendee_visibility, can_see_attendees, can_meet, can_chat,
    can_lead_retrieval, can_see_recording, sort_order, is_default, is_system
  )
  SELECT
    _tenant, _event_id, d.key, d.name_pl, d.name_en, d.description_pl, d.description_en,
    d.color, d.attendee_visibility, d.can_see_attendees, d.can_meet, d.can_chat,
    d.can_lead_retrieval, d.can_see_recording, d.sort_order,
    d.is_default AND NOT v_has_default, true
  FROM (VALUES
    ('attendees', 'Uczestnicy', 'Attendees',
     'Podstawowa grupa zapisanych. Widzi liste zapisanych i rozmawia na czacie.',
     'Default group of registered people. Sees the attendee list and uses the chat.',
     '#2563eb', 'registered', true, true, true, false, true, 10, true),
    ('speakers', 'Prelegenci', 'Speakers',
     'Osoby na scenie. Widza pelna liste zapisanych, takze przed wydarzeniem.',
     'People on stage. They see the full attendee list, also before the event.',
     '#7c3aed', 'registered', true, true, true, false, true, 20, false),
    ('partners', 'Partnerzy', 'Partners',
     'Przedstawiciele firm partnerskich. Moga skanowac leady na stoisku.',
     'Representatives of partner companies. They may scan leads at the booth.',
     '#0d9488', 'own_group', true, true, true, true, false, 30, false),
    ('organisers', 'Organizatorzy', 'Organisers',
     'Obsada wydarzenia. Widzi wszystko i moze wszystko w obrebie wydarzenia.',
     'Event crew. Sees everything and may do everything within the event.',
     '#b45309', 'everyone', true, true, true, true, true, 40, false)
  ) AS d(
    key, name_pl, name_en, description_pl, description_en, color,
    attendee_visibility, can_see_attendees, can_meet, can_chat,
    can_lead_retrieval, can_see_recording, sort_order, is_default
  )
  ON CONFLICT (tenant_id, event_id, key) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public._event_seed_default_groups(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_seed_default_groups(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_seed_default_groups(uuid, uuid) IS
  'Zaklada cztery grupy startowe wydarzenia (uczestnicy, prelegenci, partnerzy, organizatorzy). Idempotentna. Wolana triggerem przy tworzeniu wydarzenia i w backfillu.';

-- Blad seedu grup NIE MOZE wywrocic tworzenia wydarzenia - wydarzenie bez grup
-- da sie naprawic jednym wywolaniem, wydarzenie nieutworzone trzeba wpisac od
-- nowa. Pominiecie zostawia jednak slad w logu (wzorzec z enqueue_notification,
-- 20260812091000): cichy brak przezylby tydzien, glosny nie przezyje godziny.
CREATE OR REPLACE FUNCTION public.tg_events_seed_registration_groups()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._event_seed_default_groups(NEW.tenant_id, NEW.id);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'event groups seed skipped (event=%): % [%]', NEW.id, SQLERRM, SQLSTATE;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS events_seed_registration_groups ON public.events;
CREATE TRIGGER events_seed_registration_groups
  AFTER INSERT ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.tg_events_seed_registration_groups();

-- Backfill dla wydarzen istniejacych przed ta migracja.
DO $$
DECLARE
  v_event record;
BEGIN
  FOR v_event IN SELECT e.tenant_id, e.id FROM public.events e LOOP
    PERFORM public._event_seed_default_groups(v_event.tenant_id, v_event.id);
  END LOOP;
END
$$;

-- ----------------------------------------------------------------------------
-- B3) Predykat reguly kwalifikujacej - JEDNO miejsce, w ktorym regula jest
--     rozumiana
--
-- Funkcja jest czysta (nie czyta tabel), wiec da sie ja przetestowac wprost
-- w pgTAP i da sie ja wolac z podgladu w panelu bez zapisywania zgloszenia.
--
-- BRAK ODPOWIEDZI NIE TRAFIA W ZADEN PREDYKAT poza `not_empty`. To jest decyzja,
-- nie skutek uboczny: regula "kraj inny niz Polska" nie moze odrzucic czlowieka,
-- ktory kraju nie podal, bo wtedy pole nieobowiazkowe dziala jak pulapka.
-- Brakujaca odpowiedz na pole OBOWIAZKOWE jest lapana wczesniej, przy walidacji.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._event_answer_matches(_operator text, _expected jsonb, _answer jsonb);
CREATE OR REPLACE FUNCTION public._event_answer_matches(
  _operator text,
  _expected jsonb,
  _answer jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_answer_kind text;
  v_answer_text text;
  v_expected_text text;
  v_hit boolean;
  v_bool boolean;
BEGIN
  IF _operator IS NULL OR _operator = 'none' THEN
    RETURN false;
  END IF;

  v_answer_kind := COALESCE(jsonb_typeof(_answer), 'null');

  v_answer_text := CASE
    WHEN v_answer_kind = 'string' THEN NULLIF(btrim(_answer #>> '{}'), '')
    WHEN v_answer_kind IN ('number', 'boolean') THEN _answer #>> '{}'
    ELSE NULL
  END;

  v_expected_text := CASE
    WHEN _expected IS NULL OR jsonb_typeof(_expected) = 'null' THEN NULL
    WHEN jsonb_typeof(_expected) = 'string' THEN NULLIF(btrim(_expected #>> '{}'), '')
    WHEN jsonb_typeof(_expected) IN ('number', 'boolean') THEN _expected #>> '{}'
    ELSE NULL
  END;

  IF _operator = 'not_empty' THEN
    RETURN CASE
      WHEN v_answer_kind = 'array' THEN jsonb_array_length(_answer) > 0
      WHEN v_answer_kind = 'object' THEN _answer <> '{}'::jsonb
      ELSE v_answer_text IS NOT NULL
    END;
  END IF;

  IF _operator IN ('is_true', 'is_false') THEN
    v_bool := CASE
      WHEN v_answer_kind = 'boolean' THEN (_answer = 'true'::jsonb)
      WHEN lower(COALESCE(v_answer_text, '')) IN ('true', '1', 'yes', 'tak') THEN true
      WHEN lower(COALESCE(v_answer_text, '')) IN ('false', '0', 'no', 'nie') THEN false
      ELSE NULL
    END;
    IF v_bool IS NULL THEN
      RETURN false;
    END IF;
    RETURN CASE WHEN _operator = 'is_true' THEN v_bool ELSE NOT v_bool END;
  END IF;

  IF _operator IN ('in', 'not_in') THEN
    IF jsonb_typeof(_expected) <> 'array' THEN
      RETURN false;
    END IF;
    IF v_answer_kind = 'array' THEN
      SELECT EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(_answer) a
        JOIN jsonb_array_elements_text(_expected) x
          ON lower(btrim(a.value)) = lower(btrim(x.value))
      ) INTO v_hit;
    ELSIF v_answer_text IS NULL THEN
      RETURN false;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(_expected) x
        WHERE lower(btrim(x.value)) = lower(v_answer_text)
      ) INTO v_hit;
    END IF;
    RETURN CASE WHEN _operator = 'in' THEN v_hit ELSE NOT v_hit END;
  END IF;

  IF _operator IN ('equals', 'not_equals') THEN
    IF v_answer_text IS NULL OR v_expected_text IS NULL THEN
      RETURN false;
    END IF;
    v_hit := lower(v_answer_text) = lower(v_expected_text);
    RETURN CASE WHEN _operator = 'equals' THEN v_hit ELSE NOT v_hit END;
  END IF;

  IF _operator IN ('gte', 'lte') THEN
    IF v_answer_text IS NULL OR v_answer_text !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
      RETURN false;
    END IF;
    IF v_expected_text IS NULL OR v_expected_text !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
      RETURN false;
    END IF;
    RETURN CASE
      WHEN _operator = 'gte' THEN v_answer_text::numeric >= v_expected_text::numeric
      ELSE v_answer_text::numeric <= v_expected_text::numeric
    END;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public._event_answer_matches(text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._event_answer_matches(text, jsonb, jsonb)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public._event_answer_matches(text, jsonb, jsonb) IS
  'Predykat reguly kwalifikujacej: czy odpowiedz trafia w warunek. Funkcja czysta - brak odpowiedzi nie trafia w zaden operator poza not_empty.';

-- ----------------------------------------------------------------------------
-- B4) Werdykt kwalifikacji dla calego formularza
--
-- Pierwszenstwo: odrzucenie > akceptacja > zatwierdzenie. Jedna regula
-- odrzucajaca wygrywa z dziesiecioma zatwierdzajacymi, bo bramka bezpieczenstwa
-- domyka sie, a nie otwiera.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._event_registration_verdict(_tenant uuid, _event_id uuid, _answers jsonb);
CREATE OR REPLACE FUNCTION public._event_registration_verdict(
  _tenant uuid,
  _event_id uuid,
  _answers jsonb
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_field record;
  v_verdict text := 'none';
BEGIN
  FOR v_field IN
    SELECT f.key, f.qualify_operator, f.qualify_value, f.qualify_outcome
    FROM public.event_registration_fields f
    WHERE f.tenant_id = _tenant
      AND f.event_id = _event_id
      AND f.is_active
      AND f.is_qualifying
      AND f.qualify_operator <> 'none'
    ORDER BY f.sort_order, f.key
  LOOP
    CONTINUE WHEN NOT public._event_answer_matches(
      v_field.qualify_operator,
      v_field.qualify_value,
      COALESCE(_answers, '{}'::jsonb) -> v_field.key
    );

    IF v_field.qualify_outcome = 'reject' THEN
      RETURN 'reject';
    ELSIF v_field.qualify_outcome = 'approval' THEN
      v_verdict := 'approval';
    ELSIF v_verdict <> 'approval' THEN
      v_verdict := 'auto_approve';
    END IF;
  END LOOP;

  RETURN v_verdict;
END;
$$;

REVOKE ALL ON FUNCTION public._event_registration_verdict(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._event_registration_verdict(uuid, uuid, jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public._event_registration_verdict(uuid, uuid, jsonb) IS
  'Werdykt regul kwalifikujacych wydarzenia dla zestawu odpowiedzi: reject | approval | auto_approve | none. Pierwszenstwo: reject > approval > auto_approve.';

-- ----------------------------------------------------------------------------
-- B5) Wolne miejsca - JEDNO miejsce, w ktorym liczy sie pojemnosc
--
-- Wynik NULL znaczy BEZ LIMITU, a nie "zero". Ta roznica jest cala trescia
-- funkcji: "bez limitu" i "brak wolnych" to dwie rozne odpowiedzi, a zero
-- czyta sie jako druga z nich.
--
-- Limit wydarzenia (`events.capacity`) i pula biletu (`quota`) obowiazuja
-- JEDNOCZESNIE - wiazacy jest mniejszy z nich. Bilet z pula 200 na wydarzeniu
-- na 100 osob sprzeda 100 miejsc, nie 200.
--
-- UWAGA WOLAJACEGO: ta funkcja LICZY, nie REZERWUJE. Kazda sciezka zajmujaca
-- miejsce musi najpierw zablokowac wiersz biletu (albo wydarzenia) klauzula
-- FOR UPDATE - inaczej dwa jednoczesne zapisy odczytaja te sama liczbe.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._event_seats_left(_tenant uuid, _event_id uuid, _ticket_type_id uuid);
CREATE OR REPLACE FUNCTION public._event_seats_left(
  _tenant uuid,
  _event_id uuid,
  _ticket_type_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_capacity integer;
  v_used integer;
  v_quota integer;
  v_sold integer;
  v_left integer;
  v_ticket_left integer;
BEGIN
  SELECT e.capacity INTO v_capacity
  FROM public.events e
  WHERE e.id = _event_id AND e.tenant_id = _tenant;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  IF v_capacity IS NOT NULL THEN
    SELECT count(*)::integer INTO v_used
    FROM public.event_registrations r
    WHERE r.tenant_id = _tenant
      AND r.event_id = _event_id
      AND r.status IN ('approved', 'attended', 'no_show');
    v_left := GREATEST(v_capacity - v_used, 0);
  END IF;

  IF _ticket_type_id IS NOT NULL THEN
    SELECT t.quota, t.sold_count INTO v_quota, v_sold
    FROM public.event_ticket_types t
    WHERE t.id = _ticket_type_id
      AND t.tenant_id = _tenant
      AND t.event_id = _event_id;

    IF NOT FOUND THEN
      RETURN 0;
    END IF;

    IF v_quota IS NOT NULL THEN
      v_ticket_left := GREATEST(v_quota - v_sold, 0);
      v_left := CASE
        WHEN v_left IS NULL THEN v_ticket_left
        ELSE LEAST(v_left, v_ticket_left)
      END;
    END IF;
  END IF;

  RETURN v_left;
END;
$$;

REVOKE ALL ON FUNCTION public._event_seats_left(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._event_seats_left(uuid, uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public._event_seats_left(uuid, uuid, uuid) IS
  'Wolne miejsca wydarzenia (i biletu, gdy podany). NULL = bez limitu. Liczy, nie rezerwuje - wolajacy musi trzymac FOR UPDATE na wierszu biletu albo wydarzenia.';

-- ----------------------------------------------------------------------------
-- B6) Token wejsciowy - jawny raz, w bazie tylko hasz
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._event_new_qr_token();
CREATE OR REPLACE FUNCTION public._event_new_qr_token()
RETURNS text
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  -- base64url bez wypelnienia: token jedzie w adresie i w kodzie QR, wiec nie
  -- moze zawierac znakow wymagajacych kodowania procentowego.
  SELECT replace(replace(rtrim(encode(gen_random_bytes(24), 'base64'), '='), '+', '-'), '/', '_');
$$;

REVOKE ALL ON FUNCTION public._event_new_qr_token() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_new_qr_token() TO service_role;

COMMENT ON FUNCTION public._event_new_qr_token() IS
  'Losowy token wejsciowy (24 bajty, base64url). Do tabeli idzie wylacznie sha256 tej wartosci.';

-- ----------------------------------------------------------------------------
-- B7) Promocja z listy rezerwowej
--
-- JEDNO miejsce, w ktorym rezerwa zamienia sie w zapis. Wola je i anulowanie
-- (automat: zwolnione miejsce wraca do kolejki natychmiast), i przycisk
-- organizatora (recznie: "wpusc trzy osoby"). Dwie kopie tej logiki rozjechalyby
-- sie na pierwszej zmianie definicji wolnego miejsca.
--
-- BLOKADA NAJPIERW, LICZENIE POTEM. Funkcja blokuje wiersz biletu (albo wiersz
-- wydarzenia, gdy zapisy nie maja biletu) i tylko wtedy pyta o wolne miejsca.
-- Bez tej kolejnosci dwa rownolegle anulowania promuja dwie osoby na jedno
-- zwolnione miejsce.
--
-- POWIADOMIENIE NIE JEST WYSYLANE Z SQL-A. Tresc wiadomosci jest tekstem dla
-- uzytkownika, a tekst dla uzytkownika w tym repozytorium zyje w slowniku i18n,
-- nie w ciele funkcji. Funkcja emituje zdarzenie domenowe
-- `event.registration.promoted.v1` i ZWRACA promowane wiersze - wysylke robi
-- warstwa, ktora zna jezyk odbiorcy, a stempel `waitlist_notified_at` stawia
-- `admin_event_registration_mark_notified()` po wyslaniu.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._event_waitlist_promote(_tenant uuid, _event_id uuid, _ticket_type_id uuid, _limit integer);
CREATE OR REPLACE FUNCTION public._event_waitlist_promote(
  _tenant uuid,
  _event_id uuid,
  _ticket_type_id uuid DEFAULT NULL,
  _limit integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(_limit, 1), 1), 500);
  v_row record;
  v_left integer;
  v_token text;
  v_promoted jsonb := '[]'::jsonb;
BEGIN
  IF _tenant IS NULL OR _event_id IS NULL THEN
    RETURN jsonb_build_object('promoted', 0, 'registrations', '[]'::jsonb);
  END IF;

  -- Blokada serializujaca. Bilet gdy podany, w przeciwnym razie wydarzenie -
  -- to samo, na czym serializuje sie zapis publiczny, wiec obie sciezki staja
  -- w tej samej kolejce.
  IF _ticket_type_id IS NOT NULL THEN
    PERFORM 1 FROM public.event_ticket_types t
    WHERE t.id = _ticket_type_id AND t.tenant_id = _tenant AND t.event_id = _event_id
    FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.events e
    WHERE e.id = _event_id AND e.tenant_id = _tenant
    FOR UPDATE;
  END IF;

  FOR v_row IN
    SELECT r.id, r.person_id, r.ticket_type_id, p.email, p.first_name, p.last_name, p.user_id
    FROM public.event_registrations r
    JOIN public.event_people p
      ON p.id = r.person_id AND p.tenant_id = r.tenant_id
    WHERE r.tenant_id = _tenant
      AND r.event_id = _event_id
      AND r.status = 'waitlist'
      AND (_ticket_type_id IS NULL OR r.ticket_type_id = _ticket_type_id)
    ORDER BY r.waitlist_position NULLS LAST, r.created_at, r.id
    LIMIT v_limit
  LOOP
    v_left := public._event_seats_left(_tenant, _event_id, v_row.ticket_type_id);
    -- NULL = bez limitu, wiec promujemy. Zero konczy petle: kolejka jest
    -- uporzadkowana, wiec brak miejsca dla pierwszego znaczy brak dla kazdego
    -- nastepnego w tej samej puli.
    EXIT WHEN v_left IS NOT NULL AND v_left <= 0;

    v_token := public._event_new_qr_token();

    UPDATE public.event_registrations r
    SET status = 'approved',
        waitlist_position = NULL,
        promoted_at = now(),
        decided_at = now(),
        decided_by = NULL,
        decision_source = 'system',
        qr_token_hash = encode(digest(v_token, 'sha256'), 'hex'),
        qr_issued_at = now()
    WHERE r.id = v_row.id AND r.tenant_id = _tenant AND r.status = 'waitlist';

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_promoted := v_promoted || jsonb_build_object(
      'registration_id', v_row.id,
      'person_id', v_row.person_id,
      'email', v_row.email,
      'first_name', v_row.first_name,
      'last_name', v_row.last_name,
      'user_id', v_row.user_id,
      'ticket_type_id', v_row.ticket_type_id
    );

    PERFORM public.emit_domain_event(
      _tenant,
      'event_registration',
      v_row.id::text,
      'event.registration.promoted.v1',
      jsonb_build_object('event_id', _event_id, 'person_id', v_row.person_id),
      auth.uid()
    );
  END LOOP;

  RETURN jsonb_build_object(
    'promoted', jsonb_array_length(v_promoted),
    'registrations', v_promoted
  );
END;
$$;

REVOKE ALL ON FUNCTION public._event_waitlist_promote(uuid, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_waitlist_promote(uuid, uuid, uuid, integer) TO service_role;

COMMENT ON FUNCTION public._event_waitlist_promote(uuid, uuid, uuid, integer) IS
  'Promuje osoby z listy rezerwowej na zwolnione miejsca (blokada wiersza biletu albo wydarzenia najpierw, liczenie potem). Zwraca promowane wiersze - wysylka wiadomosci nalezy do warstwy znajacej jezyk odbiorcy.';

-- ----------------------------------------------------------------------------
-- B8) Nadanie pozycji w kolejce rezerwowej
--
-- Pozycja jest LICZBA, nie kolejnoscia wstawienia: organizator musi umiec
-- powiedziec "jestes trzeci", a `created_at` tego nie mowi bez przeliczenia
-- calej kolejki przy kazdym pytaniu. Nastepna pozycja to max + 1 - liczona pod
-- ta sama blokada, co pula, wiec dwa jednoczesne zapisy nie dostana tej samej.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._event_next_waitlist_position(_tenant uuid, _event_id uuid);
CREATE OR REPLACE FUNCTION public._event_next_waitlist_position(_tenant uuid, _event_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(max(r.waitlist_position), 0) + 1
  FROM public.event_registrations r
  WHERE r.tenant_id = _tenant
    AND r.event_id = _event_id
    AND r.status = 'waitlist';
$$;

REVOKE ALL ON FUNCTION public._event_next_waitlist_position(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_next_waitlist_position(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_next_waitlist_position(uuid, uuid) IS
  'Nastepna wolna pozycja w kolejce rezerwowej wydarzenia. Wolana pod blokada wiersza biletu albo wydarzenia.';

-- ============================================================================
-- CZESC C: PLASZCZYZNA TRESCI (odczyt i zapis po naglowku Host)
--
-- Trzy funkcje. Wszystkie skaluja dane po `public_tenant_id()` i ZADNA nie wola
-- `has_role()` ani `is_staff()` - naglowek hosta jest falsyfikowalny, wiec
-- mieszanka pozwalalaby podszyc sie pod najemce (bramka `check:sql-tenant-scope`).
-- Zadna z nich nie oddaje danych innej osoby niz wolajacy.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- C1) Formularz zapisu dla frontu wydarzenia
--
-- Jedno wywolanie oddaje wszystko, co formularz musi wiedziec, zeby sie
-- narysowac: tryb, okno, pola, bilety z dostepnoscia i zgody do akceptacji.
-- Cztery osobne zapytania dalyby cztery rozne chwile w czasie - a przy pytaniu
-- "czy sa jeszcze miejsca" to znaczy cztery rozne odpowiedzi.
--
-- `is_open` i `closed_reason` licza sie TUTAJ, nie w kliencie. Klient, ktory
-- sam sklada warunek z piecu kolumn, po pierwszej zmianie reguly klamie
-- w druga strone niz serwer - a wtedy uczestnik widzi przycisk, ktory odmawia.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.event_registration_form(p_event_slug text);
CREATE OR REPLACE FUNCTION public.event_registration_form(p_event_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_event public.events;
  v_slug text := NULLIF(btrim(COALESCE(p_event_slug, '')), '');
  v_seats_left integer;
  v_reason text;
  v_fields jsonb;
  v_tickets jsonb;
  v_terms jsonb;
  v_active_tickets integer;
BEGIN
  IF v_tenant IS NULL OR v_slug IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;

  SELECT * INTO v_event
  FROM public.events e
  WHERE e.tenant_id = v_tenant AND e.slug = v_slug AND e.status = 'published';

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;

  v_seats_left := public._event_seats_left(v_tenant, v_event.id, NULL);

  SELECT count(*)::integer INTO v_active_tickets
  FROM public.event_ticket_types t
  WHERE t.tenant_id = v_tenant AND t.event_id = v_event.id AND t.is_active;

  -- Kolejnosc warunkow jest kolejnoscia waznosci: odwolane wydarzenie nie jest
  -- "wyprzedane", a wylaczone zapisy nie sa "jeszcze nieotwarte".
  v_reason := CASE
    WHEN v_event.cancelled_at IS NOT NULL THEN 'event_cancelled'
    WHEN v_event.registration_mode = 'none' THEN 'registration_disabled'
    WHEN v_event.registration_mode = 'external' THEN 'registration_external'
    WHEN v_event.rsvp_opens_at IS NOT NULL
      AND v_event.rsvp_opens_at > now()
      AND NOT (
        v_event.early_rsvp_rank IS NOT NULL
        AND public.has_tier_rank(v_event.early_rsvp_rank)
      ) THEN 'registration_not_open'
    WHEN v_event.visibility = 'members'
      AND NOT public.has_tier_rank(GREATEST(v_event.min_tier_rank, 1)) THEN 'membership_required'
    -- Wyprzedanie liczymy tylko wtedy, gdy wydarzenie NIE ma biletow: przy
    -- biletach kazdy z nich ma wlasna pule i wlasny stan, wiec jedna flaga na
    -- wydarzeniu klamalaby o tych, ktore jeszcze sa.
    WHEN v_active_tickets = 0 AND v_seats_left IS NOT NULL AND v_seats_left <= 0 THEN 'sold_out'
    ELSE NULL
  END;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', f.id,
    'key', f.key,
    'field_type', f.field_type,
    'label_pl', f.label_pl,
    'label_en', f.label_en,
    'help_pl', f.help_pl,
    'help_en', f.help_en,
    'is_required', f.is_required,
    'options', f.options,
    'sort_order', f.sort_order
  ) ORDER BY f.sort_order, f.key), '[]'::jsonb)
  INTO v_fields
  FROM public.event_registration_fields f
  WHERE f.tenant_id = v_tenant
    AND f.event_id = v_event.id
    AND f.is_active
    -- Regula kwalifikujaca NIE WYCHODZI na front. Uczestnik, ktory zna regule,
    -- odpowiada pod nia - a wtedy kwalifikacja mierzy znajomosc reguly, nie
    -- to, co miala mierzyc.
    AND f.field_type <> 'consent';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'key', t.key,
    'name_pl', t.name_pl,
    'name_en', t.name_en,
    'description_pl', t.description_pl,
    'description_en', t.description_en,
    'price_cents', t.price_cents,
    'currency', t.currency,
    'requires_approval', t.requires_approval,
    'min_tier_rank', t.min_tier_rank,
    'sales_from', t.sales_from,
    'sales_to', t.sales_to,
    -- Liczba wolnych miejsc, nie liczba sprzedanych: uczestnikowi nie mowimy,
    -- ilu ludzi kupilo bilet, tylko czy jest jeszcze miejsce.
    'seats_left', public._event_seats_left(v_tenant, v_event.id, t.id),
    'availability', CASE
      WHEN t.sales_from IS NOT NULL AND now() < t.sales_from THEN 'scheduled'
      WHEN t.sales_to IS NOT NULL AND now() > t.sales_to THEN 'ended'
      WHEN t.quota IS NOT NULL AND t.sold_count >= t.quota THEN 'sold_out'
      ELSE 'on_sale'
    END,
    'tier_locked', (t.min_tier_rank > 0 AND NOT public.has_tier_rank(t.min_tier_rank)),
    'sort_order', t.sort_order
  ) ORDER BY t.sort_order, t.key), '[]'::jsonb)
  INTO v_tickets
  FROM public.event_ticket_types t
  WHERE t.tenant_id = v_tenant AND t.event_id = v_event.id AND t.is_active;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', tr.id,
    'key', tr.key,
    'label_pl', tr.label_pl,
    'label_en', tr.label_en,
    'body_pl', tr.body_pl,
    'body_en', tr.body_en,
    'external_url', tr.external_url,
    'is_required', tr.is_required,
    'version', tr.version,
    'sort_order', tr.sort_order
  ) ORDER BY tr.sort_order, tr.key), '[]'::jsonb)
  INTO v_terms
  FROM public.event_terms tr
  WHERE tr.tenant_id = v_tenant
    AND tr.event_id = v_event.id
    AND tr.is_active
    AND tr.display IN ('registration', 'registration_and_access');

  RETURN jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_event.id,
      'slug', v_event.slug,
      'title_pl', v_event.title_pl,
      'title_en', v_event.title_en,
      'starts_at', v_event.starts_at,
      'ends_at', v_event.ends_at,
      'timezone', v_event.timezone,
      'registration_mode', v_event.registration_mode,
      'registration_flow', v_event.registration_flow,
      'external_registration_url', v_event.external_registration_url,
      'capacity', v_event.capacity,
      'seats_left', v_seats_left,
      'rsvp_opens_at', v_event.rsvp_opens_at
    ),
    'is_open', (v_reason IS NULL),
    'closed_reason', v_reason,
    'fields', v_fields,
    'tickets', v_tickets,
    'terms', v_terms
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_registration_form(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_registration_form(text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_registration_form(text) IS
  'Formularz zapisu wydarzenia dla frontu: tryb, okno, pola, bilety z dostepnoscia i zgody. Skalowana po public_tenant_id(). Nie oddaje regul kwalifikujacych ani danych innych osob.';

-- ----------------------------------------------------------------------------
-- C2) PUBLICZNY ZAPIS NA WYDARZENIE
--
-- To jest JEDYNA sciezka, w ktorej anonim pisze do bazy w tym module - i dlatego
-- jest jedyna funkcja z tak dluga lista warunkow wejscia. Zadna tabela modulu
-- nie ma polityki INSERT dla `anon`, zaden GRANT nie wpuszcza anonima na
-- tabele; wszystko idzie tutaj (bramka `check:sql-anon-insert`).
--
-- NAJEMCA POCHODZI Z KONTEKSTU, NIGDY Z WEJSCIA. `p_payload` nie ma pola
-- `tenant_id` i gdyby je mial, funkcja by go nie przeczytala. To nie jest
-- ostroznosc na zapas: wstrzykniety `tenant_id` pozwalalby dopisac uczestnika
-- do wydarzenia obcej organizacji.
--
-- CO ZWRACA: WYLACZNIE wynik WLASNEGO zapisu. Ani jednej liczby o cudzych
-- zgloszeniach, ani jednego adresu poczty, ani pozycji cudzej osoby w kolejce.
--
-- KOLEJNOSC BLOKAD: najpierw wiersz wydarzenia, potem wiersz biletu. Ta sama
-- kolejnosc obowiazuje w decyzji organizatora, wiec dwie sciezki nie zablokuja
-- sie wzajemnie.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.event_register(p_payload jsonb);
CREATE OR REPLACE FUNCTION public.event_register(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_event public.events;
  v_ticket public.event_ticket_types;
  v_slug text := NULLIF(btrim(COALESCE(p_payload->>'event_slug', '')), '');
  v_event_id uuid;
  v_ticket_id uuid;
  v_email text := lower(btrim(COALESCE(p_payload->>'email', '')));
  v_first text := btrim(COALESCE(p_payload->>'first_name', ''));
  v_last text := btrim(COALESCE(p_payload->>'last_name', ''));
  v_phone text := NULLIF(btrim(COALESCE(p_payload->>'phone', '')), '');
  v_job text := NULLIF(btrim(COALESCE(p_payload->>'job_title', '')), '');
  v_company text := NULLIF(btrim(COALESCE(p_payload->>'company_text', '')), '');
  v_social text := NULLIF(btrim(COALESCE(p_payload->>'social_profile_url', '')), '');
  v_answers jsonb := COALESCE(p_payload->'answers', '{}'::jsonb);
  v_ip_hash text := NULLIF(btrim(COALESCE(p_payload->>'ip_hash', '')), '');
  v_user_agent text := left(NULLIF(btrim(COALESCE(p_payload->>'user_agent', '')), ''), 400);
  v_marketing boolean := lower(COALESCE(p_payload->>'consent_marketing', '')) IN ('true', 't', '1');
  v_partner boolean := lower(COALESCE(p_payload->>'consent_partner_sharing', '')) IN ('true', 't', '1');
  v_data_ok boolean := lower(COALESCE(p_payload->>'consent_data_processing', '')) IN ('true', 't', '1');
  v_accepted uuid[];
  v_active_tickets integer;
  v_person_id uuid;
  v_bind_uid uuid;
  v_missing text[];
  v_verdict text;
  v_status text;
  v_decision_source text;
  v_group_id uuid;
  v_seats_left integer;
  v_position integer;
  v_token text;
  v_manage text;
  v_reg_id uuid;
  v_rate record;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;

  -- Gorna granica wejscia. Bez niej jeden zapis z zalacznikiem w `answers`
  -- potrafi wysadzic pamiec sesji, a formularz zapisu nie ma powodu wazyc
  -- wiecej niz 64 kB.
  IF length(p_payload::text) > 65536 THEN
    RAISE EXCEPTION 'payload_too_large: registration payload exceeds 64 kB';
  END IF;

  IF jsonb_typeof(v_answers) <> 'object' THEN
    RAISE EXCEPTION 'invalid_answers: answers must be a JSON object';
  END IF;

  IF v_first = '' OR v_last = '' THEN
    RAISE EXCEPTION 'invalid_name: first name and last name are required';
  END IF;

  IF v_email = '' OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'invalid_email: a valid e-mail address is required';
  END IF;

  IF NOT v_data_ok THEN
    RAISE EXCEPTION 'consent_required: consent to data processing is required';
  END IF;

  IF v_social IS NOT NULL AND v_social !~ '^https://' THEN
    RAISE EXCEPTION 'invalid_social_url: the profile address must start with https://';
  END IF;

  -- Bramka czestotliwosci na dwa klucze: hasz adresu, gdy warstwa serwerowa go
  -- podala, i adres poczty w kazdym innym razie. Wzorzec z
  -- verify_content_password (20260720071845) - atomowy licznik, nie odczyt.
  SELECT * INTO v_rate
  FROM public.rate_limit_hit(
    'event_register',
    v_tenant::text || ':' || COALESCE(v_ip_hash, v_email),
    12,
    10
  );
  IF NOT v_rate.allowed THEN
    RAISE EXCEPTION 'rate_limited: too many registration attempts, try again later';
  END IF;

  v_event_id := CASE
    WHEN COALESCE(p_payload->>'event_id', '') ~ '^[0-9a-fA-F-]{36}$'
      THEN (p_payload->>'event_id')::uuid
    ELSE NULL
  END;
  v_ticket_id := CASE
    WHEN COALESCE(p_payload->>'ticket_type_id', '') ~ '^[0-9a-fA-F-]{36}$'
      THEN (p_payload->>'ticket_type_id')::uuid
    ELSE NULL
  END;

  IF v_event_id IS NULL AND v_slug IS NULL THEN
    RAISE EXCEPTION 'invalid_event: event_id or event_slug is required';
  END IF;

  SELECT COALESCE(array_agg(x::uuid), ARRAY[]::uuid[]) INTO v_accepted
  FROM jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(p_payload->'accepted_term_ids') = 'array'
        THEN p_payload->'accepted_term_ids'
      ELSE '[]'::jsonb
    END
  ) AS t(x)
  WHERE x ~ '^[0-9a-fA-F-]{36}$';

  -- Blokada wiersza wydarzenia: pula miejsc bez wyscigu.
  SELECT * INTO v_event
  FROM public.events e
  WHERE e.tenant_id = v_tenant
    AND (
      (v_event_id IS NOT NULL AND e.id = v_event_id)
      OR (v_event_id IS NULL AND e.slug = v_slug)
    )
  FOR UPDATE;

  IF v_event.id IS NULL OR v_event.status <> 'published' THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;

  IF v_event.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_cancelled: the event has been cancelled';
  END IF;

  IF v_event.registration_mode = 'none' THEN
    RAISE EXCEPTION 'registration_disabled: this event does not take registrations';
  END IF;

  IF v_event.registration_mode = 'external' THEN
    RAISE EXCEPTION 'registration_external: registration runs in an external tool';
  END IF;

  IF v_event.rsvp_opens_at IS NOT NULL
     AND v_event.rsvp_opens_at > now()
     AND NOT (
       v_event.early_rsvp_rank IS NOT NULL
       AND public.has_tier_rank(v_event.early_rsvp_rank)
     ) THEN
    RAISE EXCEPTION 'registration_not_open: registration has not opened yet';
  END IF;

  IF v_event.visibility = 'members'
     AND NOT public.has_tier_rank(GREATEST(v_event.min_tier_rank, 1)) THEN
    RAISE EXCEPTION 'membership_required: this event is open to members only';
  END IF;

  SELECT count(*)::integer INTO v_active_tickets
  FROM public.event_ticket_types t
  WHERE t.tenant_id = v_tenant AND t.event_id = v_event.id AND t.is_active;

  IF v_ticket_id IS NOT NULL THEN
    SELECT * INTO v_ticket
    FROM public.event_ticket_types t
    WHERE t.id = v_ticket_id AND t.tenant_id = v_tenant AND t.event_id = v_event.id
    FOR UPDATE;

    IF v_ticket.id IS NULL OR NOT v_ticket.is_active THEN
      RAISE EXCEPTION 'not_found: ticket does not exist for this event';
    END IF;
    IF v_ticket.sales_from IS NOT NULL AND now() < v_ticket.sales_from THEN
      RAISE EXCEPTION 'ticket_not_on_sale: sales for this ticket have not started';
    END IF;
    IF v_ticket.sales_to IS NOT NULL AND now() > v_ticket.sales_to THEN
      RAISE EXCEPTION 'ticket_sales_ended: sales for this ticket are closed';
    END IF;
    IF v_ticket.min_tier_rank > 0 AND NOT public.has_tier_rank(v_ticket.min_tier_rank) THEN
      RAISE EXCEPTION 'ticket_tier_required: this ticket requires a higher membership tier';
    END IF;
    v_group_id := v_ticket.group_id;
  ELSIF v_active_tickets > 0 THEN
    RAISE EXCEPTION 'ticket_required: this event sells tickets - pick one';
  END IF;

  IF v_group_id IS NULL THEN
    SELECT g.id INTO v_group_id
    FROM public.event_groups g
    WHERE g.tenant_id = v_tenant AND g.event_id = v_event.id AND g.is_default;
  END IF;

  -- Pola obowiazkowe sprawdzamy WYLACZNIE w trybie formularza. Tryb `rsvp`
  -- znaczy "jeden klik" i formularza nie pokazuje, wiec wymaganie w nim
  -- odpowiedzi bylo by wymaganiem czegos, o co nikt nie zapytal.
  IF v_event.registration_mode = 'form' THEN
    SELECT COALESCE(array_agg(f.key ORDER BY f.sort_order, f.key), ARRAY[]::text[])
    INTO v_missing
    FROM public.event_registration_fields f
    WHERE f.tenant_id = v_tenant
      AND f.event_id = v_event.id
      AND f.is_active
      AND f.is_required
      AND f.field_type <> 'consent'
      AND NOT public._event_answer_matches('not_empty', 'null'::jsonb, v_answers -> f.key);

    IF COALESCE(array_length(v_missing, 1), 0) > 0 THEN
      RAISE EXCEPTION 'missing_required_fields: %', array_to_string(v_missing, ',');
    END IF;
  END IF;

  -- Zgody WYMAGANE. Zgoda niewymagana nie blokuje zapisu nawet wtedy, gdy jej
  -- nie ma - inaczej byla by zgoda pozorna (patrz komentarz przy event_terms).
  SELECT COALESCE(array_agg(tr.key ORDER BY tr.sort_order, tr.key), ARRAY[]::text[])
  INTO v_missing
  FROM public.event_terms tr
  WHERE tr.tenant_id = v_tenant
    AND tr.event_id = v_event.id
    AND tr.is_active
    AND tr.is_required
    AND tr.display IN ('registration', 'registration_and_access')
    AND NOT (tr.id = ANY (v_accepted));

  IF COALESCE(array_length(v_missing, 1), 0) > 0 THEN
    RAISE EXCEPTION 'terms_required: %', array_to_string(v_missing, ',');
  END IF;

  -- Kartoteka: dopasowanie po adresie w granicach najemcy.
  SELECT p.id INTO v_person_id
  FROM public.event_people p
  WHERE p.tenant_id = v_tenant AND p.email_norm = v_email;

  -- Dowiazanie konta zapinamy tylko wtedy, gdy to konto nie jest juz dowiazane
  -- do INNEJ osoby w tej kartotece. Zalogowany, ktory zapisuje sie na cudzy
  -- adres, nie moze przejac tamtego wiersza.
  v_bind_uid := CASE
    WHEN v_uid IS NULL THEN NULL
    WHEN EXISTS (
      SELECT 1 FROM public.event_people p2
      WHERE p2.tenant_id = v_tenant
        AND p2.user_id = v_uid
        AND (v_person_id IS NULL OR p2.id <> v_person_id)
    ) THEN NULL
    ELSE v_uid
  END;

  IF v_person_id IS NULL THEN
    INSERT INTO public.event_people (
      tenant_id, user_id, email, first_name, last_name, phone, job_title,
      company_text, social_profile_url, source,
      consent_data_processing_at, consent_marketing_at, consent_partner_sharing_at,
      created_by
    ) VALUES (
      v_tenant, v_bind_uid, v_email, v_first, v_last, v_phone, v_job,
      v_company, v_social, 'self_registration',
      now(),
      CASE WHEN v_marketing THEN now() END,
      CASE WHEN v_partner THEN now() END,
      v_uid
    )
    RETURNING id INTO v_person_id;
  ELSE
    UPDATE public.event_people p SET
      user_id = COALESCE(p.user_id, v_bind_uid),
      first_name = v_first,
      last_name = v_last,
      phone = COALESCE(v_phone, p.phone),
      job_title = COALESCE(v_job, p.job_title),
      company_text = COALESCE(v_company, p.company_text),
      social_profile_url = COALESCE(v_social, p.social_profile_url),
      -- Stempel zgody opisuje PIERWSZE nadanie, wiec go nie nadpisujemy.
      -- Ponowne przejscie formularza CZYSCI natomiast wycofanie: czlowiek
      -- wlasnie zgodzil sie jeszcze raz.
      consent_data_processing_at = COALESCE(p.consent_data_processing_at, now()),
      consent_marketing_at = CASE
        WHEN v_marketing THEN COALESCE(p.consent_marketing_at, now())
        ELSE p.consent_marketing_at
      END,
      consent_partner_sharing_at = CASE
        WHEN v_partner THEN COALESCE(p.consent_partner_sharing_at, now())
        ELSE p.consent_partner_sharing_at
      END,
      consent_withdrawn_at = NULL
    WHERE p.id = v_person_id AND p.tenant_id = v_tenant;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.event_registrations r
    WHERE r.tenant_id = v_tenant
      AND r.event_id = v_event.id
      AND r.person_id = v_person_id
      AND r.status NOT IN ('cancelled', 'rejected')
  ) THEN
    RAISE EXCEPTION 'already_registered: this person already has an active registration';
  END IF;

  v_verdict := public._event_registration_verdict(v_tenant, v_event.id, v_answers);

  IF v_verdict = 'reject' THEN
    v_status := 'rejected';
    v_decision_source := 'automatic_rule';
  ELSIF v_verdict = 'approval' THEN
    v_status := 'pending';
  ELSIF v_verdict = 'auto_approve' THEN
    v_status := 'approved';
    v_decision_source := 'automatic_rule';
  ELSE
    v_status := CASE WHEN v_event.registration_flow = 'approval' THEN 'pending' ELSE 'approved' END;
    v_decision_source := CASE WHEN v_status = 'approved' THEN 'system' ELSE NULL END;
  END IF;

  -- Bilet moze PODNIESC wymog akceptacji nawet przy trybie natychmiastowym
  -- (wejsciowka prasowa na wydarzeniu otwartym). Nie moze go OBNIZYC.
  IF v_ticket.id IS NOT NULL AND v_ticket.requires_approval AND v_status = 'approved' THEN
    v_status := 'pending';
    v_decision_source := NULL;
  END IF;

  -- Brak miejsca nie odrzuca zgloszenia - kieruje je na liste rezerwowa.
  -- Zgloszenie oczekujace na decyzje miejsca NIE zajmuje, wiec go tu nie
  -- sprawdzamy: pule sprawdzi organizator w chwili zatwierdzenia.
  IF v_status = 'approved' THEN
    v_seats_left := public._event_seats_left(v_tenant, v_event.id, v_ticket.id);
    IF v_seats_left IS NOT NULL AND v_seats_left <= 0 THEN
      v_status := 'waitlist';
      v_decision_source := 'capacity';
      v_position := public._event_next_waitlist_position(v_tenant, v_event.id);
    END IF;
  END IF;

  IF v_status = 'approved' THEN
    v_token := public._event_new_qr_token();
  END IF;
  v_manage := public._event_new_qr_token();

  INSERT INTO public.event_registrations (
    tenant_id, event_id, person_id, ticket_type_id, group_id, status,
    registration_mode, answers, source,
    decided_at, decision_source, qr_token_hash, qr_issued_at,
    manage_token_hash, waitlist_position, created_by
  ) VALUES (
    v_tenant, v_event.id, v_person_id, v_ticket.id, v_group_id, v_status,
    CASE WHEN v_event.registration_mode = 'form' THEN 'form' ELSE 'rsvp' END,
    v_answers, 'self_registration',
    CASE WHEN v_decision_source IS NOT NULL THEN now() END,
    v_decision_source,
    CASE WHEN v_token IS NOT NULL THEN encode(digest(v_token, 'sha256'), 'hex') END,
    CASE WHEN v_token IS NOT NULL THEN now() END,
    encode(digest(v_manage, 'sha256'), 'hex'),
    v_position,
    v_uid
  )
  RETURNING id INTO v_reg_id;

  INSERT INTO public.event_term_acceptances (
    tenant_id, term_id, person_id, registration_id, version, ip_hash, user_agent
  )
  SELECT v_tenant, tr.id, v_person_id, v_reg_id, tr.version, v_ip_hash, v_user_agent
  FROM public.event_terms tr
  WHERE tr.tenant_id = v_tenant
    AND tr.event_id = v_event.id
    AND tr.is_active
    AND tr.id = ANY (v_accepted)
  ON CONFLICT (tenant_id, term_id, person_id, version) DO NOTHING;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_registration',
    v_reg_id::text,
    'event.registration.created.v1',
    jsonb_build_object(
      'event_id', v_event.id,
      'person_id', v_person_id,
      'status', v_status,
      'ticket_type_id', v_ticket.id,
      'source', 'self_registration'
    ),
    v_uid
  );

  RETURN jsonb_build_object(
    'registration_id', v_reg_id,
    'person_id', v_person_id,
    'status', v_status,
    'decision_source', v_decision_source,
    'waitlist_position', v_position,
    'ticket_type_id', v_ticket.id,
    'group_id', v_group_id,
    -- Oba sekrety wracaja jawnie DOKLADNIE RAZ. W bazie zostaja tylko ich hasze.
    'qr_token', v_token,
    'manage_token', v_manage
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_register(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_register(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_register(jsonb) IS
  'Publiczny zapis na wydarzenie (jedyna sciezka zapisu anonimowego w module). Najemca z kontekstu tresci, nigdy z wejscia. Waliduje pola wymagane, zgody, okno i pule; ustawia status wedlug trybu i regul kwalifikujacych; token QR zwraca raz.';

-- ----------------------------------------------------------------------------
-- C3) ANULOWANIE WLASNEGO ZAPISU
--
-- Dwa dowody wlasnosci, bo sa dwie klasy uczestnikow: zalogowany dowodzi
-- kontem (`event_people.user_id`), osoba bez konta uchwytem samoobslugowym
-- (`manage_token_hash`). Trzeciej drogi nie ma - w szczegolnosci sam adres
-- poczty dowodem NIE JEST, bo adres zna kazdy, kto go widzial.
--
-- ZWOLNIONE MIEJSCE WRACA DO KOLEJKI NATYCHMIAST. Anulowanie wola
-- `_event_waitlist_promote()` w tej samej transakcji - inaczej miejsce lezy
-- odlogiem do nastepnego wejscia organizatora na ekran, czyli zwykle do konca
-- zapisow. To jest cala roznica miedzy lista rezerwowa, ktora dziala,
-- i lista rezerwowa, ktora jest ozdoba.
--
-- Funkcja NIE oddaje niczego o promowanej osobie - tylko liczbe awansow, zeby
-- front mogl napisac "zwolnione miejsce trafilo do kolejki".
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.event_registration_cancel(p_payload jsonb);
CREATE OR REPLACE FUNCTION public.event_registration_cancel(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_manage text := NULLIF(btrim(COALESCE(p_payload->>'manage_token', '')), '');
  v_reg_id uuid;
  v_reg record;
  v_promoted jsonb;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'not_found: registration does not exist';
  END IF;

  v_reg_id := CASE
    WHEN COALESCE(p_payload->>'registration_id', '') ~ '^[0-9a-fA-F-]{36}$'
      THEN (p_payload->>'registration_id')::uuid
    ELSE NULL
  END;

  IF v_reg_id IS NULL AND v_manage IS NULL THEN
    RAISE EXCEPTION 'invalid_request: registration_id or manage_token is required';
  END IF;

  SELECT r.id, r.event_id, r.ticket_type_id, r.status, r.person_id,
         p.user_id AS person_user_id,
         (r.manage_token_hash IS NOT NULL
          AND v_manage IS NOT NULL
          AND r.manage_token_hash = encode(digest(v_manage, 'sha256'), 'hex')) AS token_ok
  INTO v_reg
  FROM public.event_registrations r
  JOIN public.event_people p
    ON p.id = r.person_id AND p.tenant_id = r.tenant_id
  WHERE r.tenant_id = v_tenant
    AND (
      (v_reg_id IS NOT NULL AND r.id = v_reg_id)
      OR (
        v_reg_id IS NULL
        AND r.manage_token_hash = encode(digest(v_manage, 'sha256'), 'hex')
      )
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: registration does not exist';
  END IF;

  IF NOT (
    v_reg.token_ok
    OR (v_uid IS NOT NULL AND v_reg.person_user_id = v_uid)
  ) THEN
    RAISE EXCEPTION 'forbidden: this registration belongs to somebody else';
  END IF;

  IF v_reg.status IN ('cancelled', 'rejected') THEN
    RAISE EXCEPTION 'already_closed: this registration is already closed';
  END IF;

  IF v_reg.status IN ('attended', 'no_show') THEN
    RAISE EXCEPTION 'event_finished: attendance is already recorded';
  END IF;

  -- Blokada wiersza wydarzenia PRZED zwolnieniem miejsca: ta sama kolejnosc,
  -- co w zapisie publicznym i w decyzji organizatora.
  PERFORM 1 FROM public.events e
  WHERE e.id = v_reg.event_id AND e.tenant_id = v_tenant
  FOR UPDATE;

  UPDATE public.event_registrations r
  SET status = 'cancelled',
      cancelled_at = now(),
      waitlist_position = NULL,
      -- Poswiadczenie wejscia traci waznosc w tej samej sekundzie. Zostawiony
      -- hasz otwieral by bramke czlowiekowi, ktory sie wypisal.
      qr_token_hash = NULL,
      qr_issued_at = NULL
  WHERE r.id = v_reg.id AND r.tenant_id = v_tenant;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_registration',
    v_reg.id::text,
    'event.registration.cancelled.v1',
    jsonb_build_object('event_id', v_reg.event_id, 'by', 'participant'),
    v_uid
  );

  v_promoted := public._event_waitlist_promote(v_tenant, v_reg.event_id, v_reg.ticket_type_id, 1);

  RETURN jsonb_build_object(
    'registration_id', v_reg.id,
    'status', 'cancelled',
    'promoted_from_waitlist', COALESCE((v_promoted->>'promoted')::integer, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_registration_cancel(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_registration_cancel(jsonb) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_registration_cancel(jsonb) IS
  'Anulowanie WLASNEGO zapisu: dowod wlasnosci to uchwyt samoobslugowy albo konto dowiazane do osoby. Zwolnione miejsce natychmiast promuje pierwszego z kolejki rezerwowej.';

-- ============================================================================
-- CZESC D: PLASZCZYZNA ADMINISTRACYJNA
--
-- Kazda funkcja zaczyna sie od `assert_editor_tenant()` (admin ALBO editor
-- w tenancie DOMOWYM) i skaluje dane po zwroconym tenancie. `public_tenant_id()`
-- nie wystepuje w zadnym z tych cial - naglowek hosta nigdy nie autoryzuje.
-- Rola `author` jest odrzucana przez bramke: autor pisze wpisy, ale nie widzi
-- adresow poczty uczestnikow.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- D1) Lista zapisow dla panelu
--
-- `total_count` jedzie w KAZDYM wierszu jako funkcja okna - bez tego paginacja
-- wymaga drugiego zapytania z tym samym filtrem, a dwa zapytania rozjezdzaja sie
-- przy kazdym zapisie miedzy nimi (wzorzec z admin_events_list, 20260823130000).
--
-- HASZY NIE ODDAJEMY. Zamiast `qr_token_hash` jedzie flaga `has_qr`: panel musi
-- wiedziec, czy poswiadczenie wejscia istnieje, i nie musi wiedziec nic wiecej.
--
-- `required_terms_missing` liczy zgody WYMAGANE, ktorych ta osoba nie ma
-- w AKTUALNEJ wersji. To jedyna liczba na tym ekranie, ktora mowi, czy
-- zgloszenie da sie zatwierdzic bez naruszenia - i dlatego liczy ja serwer,
-- a nie klient sumujacy dwie listy.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_registrations_list(p_event_id uuid, p_status text, p_ticket_type_id uuid, p_group_id uuid, p_q text, p_from timestamp with time zone, p_to timestamp with time zone, p_limit integer, p_offset integer);
CREATE OR REPLACE FUNCTION public.admin_event_registrations_list(
  p_event_id uuid,
  p_status text DEFAULT NULL,
  p_ticket_type_id uuid DEFAULT NULL,
  p_group_id uuid DEFAULT NULL,
  p_q text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  person_id uuid,
  status text,
  registration_mode text,
  source text,
  first_name text,
  last_name text,
  email text,
  phone text,
  job_title text,
  company_text text,
  company_id uuid,
  company_name text,
  social_profile_url text,
  person_user_id uuid,
  ticket_type_id uuid,
  ticket_key text,
  ticket_name_pl text,
  ticket_name_en text,
  ticket_price_cents integer,
  ticket_currency text,
  group_id uuid,
  group_key text,
  group_name_pl text,
  group_name_en text,
  group_color text,
  extra_groups_count integer,
  answers jsonb,
  decided_by uuid,
  decided_at timestamptz,
  decision_source text,
  decision_note text,
  waitlist_position integer,
  waitlist_notified_at timestamptz,
  promoted_at timestamptz,
  cancelled_at timestamptz,
  attended_at timestamptz,
  has_qr boolean,
  consent_data_processing_at timestamptz,
  consent_marketing_at timestamptz,
  consent_partner_sharing_at timestamptz,
  consent_withdrawn_at timestamptz,
  accepted_terms_count integer,
  required_terms_missing integer,
  created_at timestamptz,
  total_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_q text := NULLIF(btrim(COALESCE(p_q, '')), '');
BEGIN
  RETURN QUERY
  SELECT
    r.id, r.event_id, r.person_id, r.status, r.registration_mode, r.source,
    p.first_name, p.last_name, p.email, p.phone, p.job_title,
    p.company_text, p.company_id, c.name,
    p.social_profile_url, p.user_id,
    r.ticket_type_id, t.key, t.name_pl, t.name_en, t.price_cents, t.currency,
    r.group_id, g.key, g.name_pl, g.name_en, g.color,
    COALESCE(gm.cnt, 0)::integer,
    r.answers, r.decided_by, r.decided_at, r.decision_source, r.decision_note,
    r.waitlist_position, r.waitlist_notified_at, r.promoted_at,
    r.cancelled_at, r.attended_at,
    (r.qr_token_hash IS NOT NULL),
    p.consent_data_processing_at, p.consent_marketing_at,
    p.consent_partner_sharing_at, p.consent_withdrawn_at,
    COALESCE(ta.accepted, 0)::integer,
    COALESCE(tm.missing, 0)::integer,
    r.created_at,
    count(*) OVER ()::integer
  FROM public.event_registrations r
  JOIN public.event_people p
    ON p.id = r.person_id AND p.tenant_id = r.tenant_id
  LEFT JOIN public.crm_companies c
    ON c.id = p.company_id AND c.tenant_id = p.tenant_id
  LEFT JOIN public.event_ticket_types t
    ON t.id = r.ticket_type_id AND t.tenant_id = r.tenant_id
  LEFT JOIN public.event_groups g
    ON g.id = r.group_id AND g.tenant_id = r.tenant_id
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM public.event_group_members m
    WHERE m.tenant_id = r.tenant_id
      AND m.event_id = r.event_id
      AND m.person_id = r.person_id
  ) gm ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS accepted
    FROM public.event_term_acceptances a
    JOIN public.event_terms tr
      ON tr.id = a.term_id AND tr.tenant_id = a.tenant_id
    WHERE a.tenant_id = r.tenant_id
      AND a.person_id = r.person_id
      AND tr.event_id = r.event_id
      AND a.version = tr.version
      AND a.withdrawn_at IS NULL
  ) ta ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS missing
    FROM public.event_terms tr
    WHERE tr.tenant_id = r.tenant_id
      AND tr.event_id = r.event_id
      AND tr.is_active
      AND tr.is_required
      AND NOT EXISTS (
        SELECT 1 FROM public.event_term_acceptances a
        WHERE a.tenant_id = tr.tenant_id
          AND a.term_id = tr.id
          AND a.person_id = r.person_id
          AND a.version = tr.version
          AND a.withdrawn_at IS NULL
      )
  ) tm ON true
  WHERE r.tenant_id = v_tenant
    AND r.event_id = p_event_id
    AND (p_status IS NULL OR p_status = 'all' OR r.status = p_status)
    AND (p_ticket_type_id IS NULL OR r.ticket_type_id = p_ticket_type_id)
    -- Filtr grupy obejmuje grupe PODSTAWOWA (z biletu) i grupy DODATKOWE
    -- (czlonkostwo). Sam `group_id` pominalby prelegenta dopisanego do grupy
    -- prelegentow, ktory kupil zwykly bilet - czyli dokladnie ten przypadek,
    -- dla ktorego grupy dodatkowe istnieja.
    AND (
      p_group_id IS NULL
      OR r.group_id = p_group_id
      OR EXISTS (
        SELECT 1 FROM public.event_group_members m2
        WHERE m2.tenant_id = r.tenant_id
          AND m2.group_id = p_group_id
          AND m2.person_id = r.person_id
      )
    )
    AND (p_from IS NULL OR r.created_at >= p_from)
    AND (p_to IS NULL OR r.created_at <= p_to)
    AND (
      v_q IS NULL
      OR p.full_name_norm LIKE '%' || lower(v_q) || '%'
      OR p.email_norm LIKE '%' || lower(v_q) || '%'
      OR p.company_text ILIKE '%' || v_q || '%'
      OR p.job_title ILIKE '%' || v_q || '%'
    )
  ORDER BY
    -- Kolejka rezerwowa ma wlasny porzadek i to on jest jej trescia; reszta
    -- listy idzie od najnowszego zgloszenia.
    CASE WHEN r.status = 'waitlist' THEN 0 ELSE 1 END,
    r.waitlist_position NULLS LAST,
    r.created_at DESC,
    r.id DESC
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_registrations_list(uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_registrations_list(uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_registrations_list(uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer) IS
  'Lista zapisow wydarzenia dla panelu: filtry (status, bilet, grupa, fraza, zakres dat), licznik calosci do paginacji, liczba brakujacych zgod wymaganych. Nie oddaje haszy tokenow. Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- D2) Liczniki per status pod zakladki
--
-- Osobna funkcja, bo licznik zakladek musi IGNOROWAC filtr statusu. Wspolne
-- zapytanie z lista dawaloby "Oczekujace: n" rowne liczbie wierszy widocznych
-- pod zakladka Oczekujace, czyli licznik bezuzyteczny. Filtry NIE-statusowe sa
-- respektowane (wzorzec z admin_events_counts).
--
-- Doklada TAKZE stan pojemnosci, bo to jest druga liczba, ktorej organizator
-- szuka na tym ekranie, a policzenie jej po stronie klienta wymagaloby
-- powtorzenia reguly "limit wydarzenia i pula biletu obowiazuja jednoczesnie".
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_registrations_counts(p_event_id uuid, p_ticket_type_id uuid, p_group_id uuid, p_q text, p_from timestamp with time zone, p_to timestamp with time zone);
CREATE OR REPLACE FUNCTION public.admin_event_registrations_counts(
  p_event_id uuid,
  p_ticket_type_id uuid DEFAULT NULL,
  p_group_id uuid DEFAULT NULL,
  p_q text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_q text := NULLIF(btrim(COALESCE(p_q, '')), '');
  v_out jsonb;
  v_capacity integer;
  v_seats_left integer;
BEGIN
  SELECT e.capacity INTO v_capacity
  FROM public.events e
  WHERE e.id = p_event_id AND e.tenant_id = v_tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  v_seats_left := public._event_seats_left(v_tenant, p_event_id, p_ticket_type_id);

  SELECT jsonb_build_object(
    'all', count(*),
    'draft', count(*) FILTER (WHERE r.status = 'draft'),
    'pending', count(*) FILTER (WHERE r.status = 'pending'),
    'approved', count(*) FILTER (WHERE r.status = 'approved'),
    'rejected', count(*) FILTER (WHERE r.status = 'rejected'),
    'waitlist', count(*) FILTER (WHERE r.status = 'waitlist'),
    'cancelled', count(*) FILTER (WHERE r.status = 'cancelled'),
    'attended', count(*) FILTER (WHERE r.status = 'attended'),
    'no_show', count(*) FILTER (WHERE r.status = 'no_show'),
    'awaiting_notice', count(*) FILTER (
      WHERE r.promoted_at IS NOT NULL AND r.waitlist_notified_at IS NULL
    )
  )
  INTO v_out
  FROM public.event_registrations r
  JOIN public.event_people p
    ON p.id = r.person_id AND p.tenant_id = r.tenant_id
  WHERE r.tenant_id = v_tenant
    AND r.event_id = p_event_id
    AND (p_ticket_type_id IS NULL OR r.ticket_type_id = p_ticket_type_id)
    AND (
      p_group_id IS NULL
      OR r.group_id = p_group_id
      OR EXISTS (
        SELECT 1 FROM public.event_group_members m2
        WHERE m2.tenant_id = r.tenant_id
          AND m2.group_id = p_group_id
          AND m2.person_id = r.person_id
      )
    )
    AND (p_from IS NULL OR r.created_at >= p_from)
    AND (p_to IS NULL OR r.created_at <= p_to)
    AND (
      v_q IS NULL
      OR p.full_name_norm LIKE '%' || lower(v_q) || '%'
      OR p.email_norm LIKE '%' || lower(v_q) || '%'
      OR p.company_text ILIKE '%' || v_q || '%'
      OR p.job_title ILIKE '%' || v_q || '%'
    );

  RETURN COALESCE(v_out, jsonb_build_object(
    'all', 0, 'draft', 0, 'pending', 0, 'approved', 0, 'rejected', 0,
    'waitlist', 0, 'cancelled', 0, 'attended', 0, 'no_show', 0, 'awaiting_notice', 0
  )) || jsonb_build_object('capacity', v_capacity, 'seats_left', v_seats_left);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_registrations_counts(uuid, uuid, uuid, text, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_registrations_counts(uuid, uuid, uuid, text, timestamptz, timestamptz) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_registrations_counts(uuid, uuid, uuid, text, timestamptz, timestamptz) IS
  'Liczniki zapisow per status pod zakladki listy plus stan pojemnosci. Ignoruje filtr statusu, respektuje pozostale filtry. Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- D3) DECYZJA ORGANIZATORA
--
-- Jedna funkcja na szesc czynnosci, bo wszystkie sa TA SAMA operacja: przejscie
-- stanu zapisu z zapisaniem sladu. Szesc osobnych funkcji dawaloby szesc kopii
-- sprawdzenia tenanta, blokady wydarzenia i sladu decyzji - a rozjazd miedzy
-- nimi jest niewidoczny do pierwszego audytu.
--
-- DOZWOLONE PRZEJSCIA SA JAWNE. Bez tej tablicy "zatwierdz" na wierszu, ktory
-- juz byl na wydarzeniu, cofalby frekwencje - i nikt by tego nie zauwazyl, bo
-- wynik wygladalby poprawnie.
--
-- ZATWIERDZENIE SPRAWDZA PULE POD BLOKADA. Zgloszenie oczekujace miejsca nie
-- zajmuje, wiec dziesiec zgloszen moze czekac na piec miejsc. Bez blokady
-- i sprawdzenia w tej chwili organizator zatwierdzilby wszystkie dziesiec.
--
-- ZWOLNIENIE MIEJSCA URUCHAMIA KOLEJKE. Odrzucenie i anulowanie wiersza, ktory
-- miejsce zajmowal, wola promocje z rezerwy w tej samej transakcji.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_registration_decide(p_payload jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_registration_decide(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_uid uuid := auth.uid();
  v_id uuid := NULLIF(p_payload->>'registration_id', '')::uuid;
  v_action text := lower(btrim(COALESCE(p_payload->>'action', '')));
  v_note text := NULLIF(btrim(COALESCE(p_payload->>'note', '')), '');
  v_reg public.event_registrations;
  v_seats_left integer;
  v_token text;
  v_position integer;
  v_freed boolean := false;
  v_promoted jsonb := jsonb_build_object('promoted', 0);
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: registration_id is required';
  END IF;

  IF v_action NOT IN ('approve', 'reject', 'waitlist', 'attended', 'no_show', 'cancel') THEN
    RAISE EXCEPTION 'invalid_action: unknown decision %', v_action;
  END IF;

  SELECT * INTO v_reg
  FROM public.event_registrations r
  WHERE r.id = v_id AND r.tenant_id = v_tenant;

  IF v_reg.id IS NULL THEN
    RAISE EXCEPTION 'not_found: registration does not exist in this tenant';
  END IF;

  -- Blokada wiersza wydarzenia PRZED wierszem biletu - ta sama kolejnosc, co
  -- w zapisie publicznym.
  PERFORM 1 FROM public.events e
  WHERE e.id = v_reg.event_id AND e.tenant_id = v_tenant
  FOR UPDATE;

  IF v_reg.ticket_type_id IS NOT NULL THEN
    PERFORM 1 FROM public.event_ticket_types t
    WHERE t.id = v_reg.ticket_type_id AND t.tenant_id = v_tenant
    FOR UPDATE;
  END IF;

  -- Tablica dozwolonych przejsc.
  IF NOT (
    (v_action = 'approve' AND v_reg.status IN ('draft', 'pending', 'waitlist', 'rejected', 'cancelled'))
    OR (v_action = 'reject' AND v_reg.status IN ('draft', 'pending', 'waitlist', 'approved'))
    OR (v_action = 'waitlist' AND v_reg.status IN ('draft', 'pending', 'approved'))
    OR (v_action = 'attended' AND v_reg.status IN ('approved', 'no_show'))
    OR (v_action = 'no_show' AND v_reg.status IN ('approved', 'attended'))
    OR (v_action = 'cancel' AND v_reg.status IN ('draft', 'pending', 'waitlist', 'approved'))
  ) THEN
    RAISE EXCEPTION 'invalid_transition: % cannot be %', v_reg.status, v_action;
  END IF;

  -- Czy ta operacja ZWALNIA miejsce? Liczy sie stan PRZED zmiana.
  v_freed := v_reg.status IN ('approved', 'attended', 'no_show')
    AND v_action IN ('reject', 'waitlist', 'cancel');

  IF v_action = 'approve' THEN
    -- Powrot do stanu aktywnego nie moze podwoic zapisu tej osoby: jesli
    -- w miedzyczasie zlozyla nowe zgloszenie, indeks czesciowy by tego nie
    -- przepuscil - i lepiej powiedziec to wprost niz oddac 23505.
    IF v_reg.status IN ('rejected', 'cancelled') AND EXISTS (
      SELECT 1 FROM public.event_registrations r2
      WHERE r2.tenant_id = v_tenant
        AND r2.event_id = v_reg.event_id
        AND r2.person_id = v_reg.person_id
        AND r2.id <> v_reg.id
        AND r2.status NOT IN ('cancelled', 'rejected')
    ) THEN
      RAISE EXCEPTION 'already_registered: this person already has an active registration';
    END IF;

    v_seats_left := public._event_seats_left(v_tenant, v_reg.event_id, v_reg.ticket_type_id);
    IF v_seats_left IS NOT NULL AND v_seats_left <= 0 THEN
      RAISE EXCEPTION 'no_seats_left: no free seat for this ticket - use the waiting list';
    END IF;

    v_token := public._event_new_qr_token();

    UPDATE public.event_registrations r
    SET status = 'approved',
        waitlist_position = NULL,
        cancelled_at = NULL,
        decided_by = v_uid,
        decided_at = now(),
        decision_source = 'organizer',
        decision_note = COALESCE(v_note, r.decision_note),
        qr_token_hash = encode(digest(v_token, 'sha256'), 'hex'),
        qr_issued_at = now(),
        promoted_at = CASE WHEN r.status = 'waitlist' THEN now() ELSE r.promoted_at END
    WHERE r.id = v_id AND r.tenant_id = v_tenant;

  ELSIF v_action = 'reject' THEN
    -- Powod odrzucenia jest wymagany, gdy odrzuca czlowiek. Pilnuje tego takze
    -- CHECK na tabeli - tutaj odmowa jest czytelna, tam jest ostateczna.
    IF v_note IS NULL OR char_length(v_note) < 3 THEN
      RAISE EXCEPTION 'reason_required: a rejection reason is required';
    END IF;

    UPDATE public.event_registrations r
    SET status = 'rejected',
        waitlist_position = NULL,
        decided_by = v_uid,
        decided_at = now(),
        decision_source = 'organizer',
        decision_note = v_note,
        qr_token_hash = NULL,
        qr_issued_at = NULL
    WHERE r.id = v_id AND r.tenant_id = v_tenant;

  ELSIF v_action = 'waitlist' THEN
    v_position := public._event_next_waitlist_position(v_tenant, v_reg.event_id);

    UPDATE public.event_registrations r
    SET status = 'waitlist',
        waitlist_position = v_position,
        waitlist_notified_at = NULL,
        decided_by = v_uid,
        decided_at = now(),
        decision_source = 'organizer',
        decision_note = COALESCE(v_note, r.decision_note),
        qr_token_hash = NULL,
        qr_issued_at = NULL
    WHERE r.id = v_id AND r.tenant_id = v_tenant;

  ELSIF v_action = 'cancel' THEN
    UPDATE public.event_registrations r
    SET status = 'cancelled',
        cancelled_at = now(),
        waitlist_position = NULL,
        decided_by = v_uid,
        decided_at = now(),
        decision_source = 'organizer',
        decision_note = COALESCE(v_note, r.decision_note),
        qr_token_hash = NULL,
        qr_issued_at = NULL
    WHERE r.id = v_id AND r.tenant_id = v_tenant;

  ELSE
    -- Frekwencja. `attended_at` stawiamy raz - drugie piknieciie przy bramce
    -- nie moze przesunac godziny wejscia.
    UPDATE public.event_registrations r
    SET status = v_action,
        attended_at = CASE
          WHEN v_action = 'attended' THEN COALESCE(r.attended_at, now())
          ELSE NULL
        END,
        decided_by = v_uid,
        decided_at = now(),
        decision_source = 'organizer',
        decision_note = COALESCE(v_note, r.decision_note)
    WHERE r.id = v_id AND r.tenant_id = v_tenant;
  END IF;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_registration',
    v_id::text,
    'event.registration.decided.v1',
    jsonb_build_object(
      'event_id', v_reg.event_id,
      'person_id', v_reg.person_id,
      'from', v_reg.status,
      'action', v_action
    ),
    v_uid
  );

  IF v_freed THEN
    v_promoted := public._event_waitlist_promote(
      v_tenant, v_reg.event_id, v_reg.ticket_type_id, 1
    );
  END IF;

  RETURN jsonb_build_object(
    'registration_id', v_id,
    'action', v_action,
    'status', CASE WHEN v_action = 'cancel' THEN 'cancelled' ELSE
      CASE WHEN v_action = 'approve' THEN 'approved' ELSE v_action END END,
    'waitlist_position', v_position,
    -- Token wraca RAZ, zeby warstwa wysylkowa mogla go doreczyc uczestnikowi.
    'qr_token', v_token,
    'promoted_from_waitlist', COALESCE((v_promoted->>'promoted')::integer, 0),
    'promoted', COALESCE(v_promoted->'registrations', '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_registration_decide(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_registration_decide(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_registration_decide(jsonb) IS
  'Decyzja organizatora o zapisie: approve | reject | waitlist | attended | no_show | cancel. Jawna tablica dozwolonych przejsc, pula sprawdzana pod blokada, slad decyzji (kto, kiedy, na jakiej podstawie, dlaczego). Zwolnione miejsce promuje kolejke.';

-- ----------------------------------------------------------------------------
-- D4) Wpis organizatora: osoba i zapis bez przejscia formularza
--
-- Bez tej funkcji kartoteka opisuje wylacznie ludzi, ktorzy sami sie zapisali -
-- a wydarzenie ma prelegentow, gosci honorowych i obsluge, ktorych do formularza
-- nikt nie posle. To ta sciezka wpisuje 21 prelegentow bez konta.
--
-- Nie sprawdza pol obowiazkowych formularza: organizator wpisuje czlowieka,
-- ktorego formularza nikt nie pytal. Sprawdza natomiast pule - bo miejsce jest
-- fizyczne niezaleznie od tego, kto je przydzielil.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_registration_upsert(p_payload jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_registration_upsert(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_uid uuid := auth.uid();
  v_reg_id uuid := NULLIF(p_payload->>'registration_id', '')::uuid;
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_person_id uuid := NULLIF(p_payload->>'person_id', '')::uuid;
  v_ticket_id uuid := NULLIF(p_payload->>'ticket_type_id', '')::uuid;
  v_group_id uuid := NULLIF(p_payload->>'group_id', '')::uuid;
  v_company_id uuid := NULLIF(p_payload->>'company_id', '')::uuid;
  v_email text := lower(btrim(COALESCE(p_payload->>'email', '')));
  v_first text := btrim(COALESCE(p_payload->>'first_name', ''));
  v_last text := btrim(COALESCE(p_payload->>'last_name', ''));
  v_status text := COALESCE(NULLIF(p_payload->>'status', ''), 'approved');
  v_source text := COALESCE(NULLIF(p_payload->>'source', ''), 'organizer');
  v_answers jsonb := COALESCE(p_payload->'answers', '{}'::jsonb);
  v_note text := NULLIF(btrim(COALESCE(p_payload->>'note', '')), '');
  v_existing public.event_registrations;
  v_seats_left integer;
  v_position integer;
  v_token text;
BEGIN
  IF v_reg_id IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.event_registrations r
    WHERE r.id = v_reg_id AND r.tenant_id = v_tenant;

    IF v_existing.id IS NULL THEN
      RAISE EXCEPTION 'not_found: registration does not exist in this tenant';
    END IF;
    v_event_id := v_existing.event_id;
    v_person_id := v_existing.person_id;
  END IF;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: event_id is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  IF jsonb_typeof(v_answers) <> 'object' THEN
    RAISE EXCEPTION 'invalid_answers: answers must be a JSON object';
  END IF;

  IF v_status NOT IN ('draft', 'pending', 'approved', 'waitlist') THEN
    RAISE EXCEPTION 'invalid_status: an organiser entry starts as draft, pending, approved or waitlist';
  END IF;

  -- Blokada wiersza wydarzenia przed pula - ta sama kolejnosc, co wszedzie.
  PERFORM 1 FROM public.events e
  WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  FOR UPDATE;

  IF v_ticket_id IS NOT NULL THEN
    PERFORM 1 FROM public.event_ticket_types t
    WHERE t.id = v_ticket_id AND t.tenant_id = v_tenant AND t.event_id = v_event_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'not_found: ticket does not exist for this event';
    END IF;
  END IF;

  -- KARTOTEKA. Wskazana osoba wygrywa z adresem; bez wskazania dopasowujemy po
  -- adresie, a gdy i tego nie ma - zakladamy wiersz.
  IF v_person_id IS NULL AND v_email <> '' THEN
    SELECT p.id INTO v_person_id
    FROM public.event_people p
    WHERE p.tenant_id = v_tenant AND p.email_norm = v_email;
  END IF;

  IF v_person_id IS NULL THEN
    IF v_first = '' OR v_last = '' THEN
      RAISE EXCEPTION 'invalid_name: first name and last name are required';
    END IF;
    INSERT INTO public.event_people (
      tenant_id, email, first_name, last_name, phone, job_title,
      company_text, company_id, social_profile_url, source, notes, created_by
    ) VALUES (
      v_tenant,
      NULLIF(v_email, ''),
      v_first,
      v_last,
      NULLIF(btrim(COALESCE(p_payload->>'phone', '')), ''),
      NULLIF(btrim(COALESCE(p_payload->>'job_title', '')), ''),
      NULLIF(btrim(COALESCE(p_payload->>'company_text', '')), ''),
      v_company_id,
      NULLIF(btrim(COALESCE(p_payload->>'social_profile_url', '')), ''),
      v_source,
      NULLIF(btrim(COALESCE(p_payload->>'notes', '')), ''),
      v_uid
    )
    RETURNING id INTO v_person_id;
  ELSE
    UPDATE public.event_people p SET
      first_name = COALESCE(NULLIF(v_first, ''), p.first_name),
      last_name = COALESCE(NULLIF(v_last, ''), p.last_name),
      email = CASE WHEN p_payload ? 'email' THEN NULLIF(v_email, '') ELSE p.email END,
      phone = CASE
        WHEN p_payload ? 'phone' THEN NULLIF(btrim(COALESCE(p_payload->>'phone', '')), '')
        ELSE p.phone
      END,
      job_title = CASE
        WHEN p_payload ? 'job_title' THEN NULLIF(btrim(COALESCE(p_payload->>'job_title', '')), '')
        ELSE p.job_title
      END,
      company_text = CASE
        WHEN p_payload ? 'company_text' THEN NULLIF(btrim(COALESCE(p_payload->>'company_text', '')), '')
        ELSE p.company_text
      END,
      company_id = CASE WHEN p_payload ? 'company_id' THEN v_company_id ELSE p.company_id END,
      social_profile_url = CASE
        WHEN p_payload ? 'social_profile_url'
          THEN NULLIF(btrim(COALESCE(p_payload->>'social_profile_url', '')), '')
        ELSE p.social_profile_url
      END,
      notes = CASE
        WHEN p_payload ? 'notes' THEN NULLIF(btrim(COALESCE(p_payload->>'notes', '')), '')
        ELSE p.notes
      END
    WHERE p.id = v_person_id AND p.tenant_id = v_tenant;
  END IF;

  -- Grupa: z biletu, potem z wejscia, na koncu domyslna grupa wydarzenia.
  IF v_group_id IS NULL THEN
    SELECT t.group_id INTO v_group_id
    FROM public.event_ticket_types t
    WHERE t.id = v_ticket_id AND t.tenant_id = v_tenant;
  END IF;
  IF v_group_id IS NULL THEN
    SELECT g.id INTO v_group_id
    FROM public.event_groups g
    WHERE g.tenant_id = v_tenant AND g.event_id = v_event_id AND g.is_default;
  END IF;

  -- STATUS STARTOWY DOTYCZY WYLACZNIE NOWEGO WPISU. Edycja istniejacego zapisu
  -- NIE zmienia statusu - przejscia stanu maja jedno miejsce
  -- (`admin_event_registration_decide`) z tablica dozwolonych przejsc i sladem
  -- decyzji. Gdyby ta funkcja liczyla tu pule takze dla edycji, poprawienie
  -- literowki w nazwisku odbijalo by sie odmowa `no_seats_left` na wydarzeniu
  -- pelnym - i to przy zapisie, ktory zadnego miejsca nie zajmuje.
  IF v_existing.id IS NULL THEN
    IF v_status = 'approved' THEN
      v_seats_left := public._event_seats_left(v_tenant, v_event_id, v_ticket_id);
      IF v_seats_left IS NOT NULL AND v_seats_left <= 0 THEN
        RAISE EXCEPTION 'no_seats_left: no free seat for this ticket - use the waiting list';
      END IF;
      v_token := public._event_new_qr_token();
    ELSIF v_status = 'waitlist' THEN
      v_position := public._event_next_waitlist_position(v_tenant, v_event_id);
    END IF;
  END IF;

  IF v_existing.id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.event_registrations r
      WHERE r.tenant_id = v_tenant
        AND r.event_id = v_event_id
        AND r.person_id = v_person_id
        AND r.status NOT IN ('cancelled', 'rejected')
    ) THEN
      RAISE EXCEPTION 'already_registered: this person already has an active registration';
    END IF;

    INSERT INTO public.event_registrations (
      tenant_id, event_id, person_id, ticket_type_id, group_id, status,
      registration_mode, answers, source,
      decided_by, decided_at, decision_source, decision_note,
      qr_token_hash, qr_issued_at, manage_token_hash, waitlist_position, created_by
    ) VALUES (
      v_tenant, v_event_id, v_person_id, v_ticket_id, v_group_id, v_status,
      -- Wpis organizatora jest zapisem jednym kliknieciem, nawet gdy wydarzenie
      -- ma formularz: nikt tego formularza nie wypelnial.
      'rsvp',
      v_answers, v_source,
      CASE WHEN v_status IN ('approved', 'waitlist') THEN v_uid END,
      CASE WHEN v_status IN ('approved', 'waitlist') THEN now() END,
      CASE WHEN v_status IN ('approved', 'waitlist') THEN 'organizer' END,
      v_note,
      CASE WHEN v_token IS NOT NULL THEN encode(digest(v_token, 'sha256'), 'hex') END,
      CASE WHEN v_token IS NOT NULL THEN now() END,
      encode(digest(public._event_new_qr_token(), 'sha256'), 'hex'),
      v_position,
      v_uid
    )
    RETURNING id INTO v_reg_id;
  ELSE
    UPDATE public.event_registrations r SET
      ticket_type_id = CASE WHEN p_payload ? 'ticket_type_id' THEN v_ticket_id ELSE r.ticket_type_id END,
      group_id = COALESCE(v_group_id, r.group_id),
      answers = CASE WHEN p_payload ? 'answers' THEN v_answers ELSE r.answers END,
      source = v_source,
      decision_note = COALESCE(v_note, r.decision_note)
    WHERE r.id = v_reg_id AND r.tenant_id = v_tenant;
  END IF;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_registration',
    v_reg_id::text,
    CASE WHEN v_existing.id IS NULL
      THEN 'event.registration.created.v1'
      ELSE 'event.registration.updated.v1'
    END,
    jsonb_build_object(
      'event_id', v_event_id,
      'person_id', v_person_id,
      'status', COALESCE(v_existing.status, v_status),
      'source', v_source
    ),
    v_uid
  );

  RETURN v_reg_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_registration_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_registration_upsert(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_registration_upsert(jsonb) IS
  'Wpis organizatora: zaklada albo aktualizuje osobe w kartotece i jej zapis na wydarzenie, bez przechodzenia formularza. Sprawdza pule (miejsce jest fizyczne), nie sprawdza pol obowiazkowych.';

-- ----------------------------------------------------------------------------
-- D5) Stempel powiadomienia o awansie z rezerwy
--
-- Osoba BEZ konta nie dostaje powiadomienia w aplikacji, wiec awans z rezerwy
-- jedzie do niej wiadomoscia - a wiadomosc wysyla warstwa, ktora zna jezyk
-- odbiorcy i szablon. Ta funkcja jest jej pokwitowaniem: bez niej licznik
-- "awansowani, jeszcze niepowiadomieni" nigdy by nie zerowal, czyli byl by
-- metryka bez zapisujacego ja procesu.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_registration_mark_notified(p_payload jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_registration_mark_notified(p_payload jsonb)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_ids uuid[];
  v_count integer;
BEGIN
  SELECT COALESCE(array_agg(x::uuid), ARRAY[]::uuid[]) INTO v_ids
  FROM jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(p_payload->'registration_ids') = 'array'
        THEN p_payload->'registration_ids'
      ELSE '[]'::jsonb
    END
  ) AS t(x)
  WHERE x ~ '^[0-9a-fA-F-]{36}$';

  IF COALESCE(array_length(v_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'invalid_request: registration_ids is required';
  END IF;

  UPDATE public.event_registrations r
  SET waitlist_notified_at = now()
  WHERE r.tenant_id = v_tenant
    AND r.id = ANY (v_ids)
    AND r.waitlist_notified_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_registration_mark_notified(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_registration_mark_notified(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_registration_mark_notified(jsonb) IS
  'Stawia stempel waitlist_notified_at na wskazanych zapisach po wyslaniu wiadomosci o awansie. Zeruje licznik "awansowani, jeszcze niepowiadomieni".';

-- ----------------------------------------------------------------------------
-- D6) Reczna promocja z listy rezerwowej
--
-- Automat dziala przy zwolnieniu miejsca; ten przycisk sluzy do decyzji
-- organizatora ("dostawiamy dziesiec krzesel"). `p_payload.registration_id`
-- pozwala wpuscic KONKRETNA osobe poza kolejnoscia - z zapisaniem sladu, bo
-- wyprzedzenie kolejki jest decyzja, ktora ktos kiedys zakwestionuje.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_waitlist_promote(p_payload jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_waitlist_promote(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_uid uuid := auth.uid();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_reg_id uuid := NULLIF(p_payload->>'registration_id', '')::uuid;
  v_ticket_id uuid := NULLIF(p_payload->>'ticket_type_id', '')::uuid;
  v_count integer := LEAST(GREATEST(COALESCE((NULLIF(p_payload->>'count', ''))::integer, 1), 1), 500);
  v_reg public.event_registrations;
  v_seats_left integer;
  v_token text;
BEGIN
  IF v_reg_id IS NOT NULL THEN
    SELECT * INTO v_reg
    FROM public.event_registrations r
    WHERE r.id = v_reg_id AND r.tenant_id = v_tenant;

    IF v_reg.id IS NULL THEN
      RAISE EXCEPTION 'not_found: registration does not exist in this tenant';
    END IF;
    IF v_reg.status <> 'waitlist' THEN
      RAISE EXCEPTION 'invalid_transition: % is not on the waiting list', v_reg.status;
    END IF;

    PERFORM 1 FROM public.events e
    WHERE e.id = v_reg.event_id AND e.tenant_id = v_tenant
    FOR UPDATE;

    IF v_reg.ticket_type_id IS NOT NULL THEN
      PERFORM 1 FROM public.event_ticket_types t
      WHERE t.id = v_reg.ticket_type_id AND t.tenant_id = v_tenant
      FOR UPDATE;
    END IF;

    v_seats_left := public._event_seats_left(v_tenant, v_reg.event_id, v_reg.ticket_type_id);
    IF v_seats_left IS NOT NULL AND v_seats_left <= 0 THEN
      RAISE EXCEPTION 'no_seats_left: no free seat for this ticket';
    END IF;

    v_token := public._event_new_qr_token();

    UPDATE public.event_registrations r
    SET status = 'approved',
        waitlist_position = NULL,
        waitlist_notified_at = NULL,
        promoted_at = now(),
        decided_by = v_uid,
        decided_at = now(),
        decision_source = 'organizer',
        qr_token_hash = encode(digest(v_token, 'sha256'), 'hex'),
        qr_issued_at = now()
    WHERE r.id = v_reg_id AND r.tenant_id = v_tenant AND r.status = 'waitlist';

    PERFORM public.emit_domain_event(
      v_tenant,
      'event_registration',
      v_reg_id::text,
      'event.registration.promoted.v1',
      jsonb_build_object('event_id', v_reg.event_id, 'person_id', v_reg.person_id, 'manual', true),
      v_uid
    );

    RETURN jsonb_build_object(
      'promoted', 1,
      'registrations', jsonb_build_array(jsonb_build_object(
        'registration_id', v_reg_id,
        'person_id', v_reg.person_id
      )),
      'qr_token', v_token
    );
  END IF;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: event_id or registration_id is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  RETURN public._event_waitlist_promote(v_tenant, v_event_id, v_ticket_id, v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_waitlist_promote(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_waitlist_promote(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_waitlist_promote(jsonb) IS
  'Reczna promocja z listy rezerwowej: wskazany zapis poza kolejnoscia (ze sladem decyzji) albo N pierwszych z kolejki. Pula sprawdzana pod blokada wiersza.';

-- ----------------------------------------------------------------------------
-- D7-D9) POLA FORMULARZA: lista, zapis, usuniecie
--
-- Klucz pola jest NIEZMIENNY po zapisie: odpowiedzi juz zlozonych zgloszen
-- siedza w `answers` pod tym kluczem, a zmiana klucza osierocilaby je bez sladu.
-- W edycji pole `key` jest wiec ignorowane, nie odrzucane - klient moze odeslac
-- caly wiersz bez filtrowania (wzorzec z admin_event_type_upsert).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_registration_fields_list(p_event_id uuid);
CREATE OR REPLACE FUNCTION public.admin_event_registration_fields_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  key text,
  field_type text,
  label_pl text,
  label_en text,
  help_pl text,
  help_en text,
  is_required boolean,
  options jsonb,
  sort_order integer,
  is_qualifying boolean,
  qualify_operator text,
  qualify_value jsonb,
  qualify_outcome text,
  is_active boolean,
  answers_count integer,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  RETURN QUERY
  SELECT
    f.id, f.event_id, f.key, f.field_type, f.label_pl, f.label_en,
    f.help_pl, f.help_en, f.is_required, f.options, f.sort_order,
    f.is_qualifying, f.qualify_operator, f.qualify_value, f.qualify_outcome,
    f.is_active,
    -- Ile zgloszen ma juz odpowiedz na to pole. Redaktor kasujacy pole musi
    -- wiedziec, ile odpowiedzi przestanie byc czytelnych w panelu.
    COALESCE(a.cnt, 0)::integer,
    f.created_at, f.updated_at
  FROM public.event_registration_fields f
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM public.event_registrations r
    WHERE r.tenant_id = f.tenant_id
      AND r.event_id = f.event_id
      AND r.answers ? f.key
  ) a ON true
  WHERE f.tenant_id = v_tenant AND f.event_id = p_event_id
  ORDER BY f.sort_order, f.key;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_registration_fields_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_registration_fields_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_registration_fields_list(uuid) IS
  'Pola formularza zapisu wydarzenia z licznikiem zlozonych odpowiedzi. Bramka: assert_editor_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_registration_field_upsert(p_payload jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_registration_field_upsert(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_key text := lower(btrim(COALESCE(p_payload->>'key', '')));
  v_label_pl text := btrim(COALESCE(p_payload->>'label_pl', ''));
  v_label_en text := btrim(COALESCE(p_payload->>'label_en', ''));
  v_options jsonb := COALESCE(p_payload->'options', '[]'::jsonb);
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT f.event_id INTO v_event_id
    FROM public.event_registration_fields f
    WHERE f.id = v_id AND f.tenant_id = v_tenant;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'not_found: field does not exist in this tenant';
    END IF;
  END IF;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: event_id is required';
  END IF;

  IF v_label_pl = '' OR v_label_en = '' THEN
    RAISE EXCEPTION 'invalid_labels: the label is required in both languages';
  END IF;

  IF jsonb_typeof(v_options) <> 'array' THEN
    RAISE EXCEPTION 'invalid_options: options must be a JSON array';
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE public.event_registration_fields f SET
      field_type = COALESCE(NULLIF(p_payload->>'field_type', ''), f.field_type),
      label_pl = v_label_pl,
      label_en = v_label_en,
      help_pl = COALESCE(btrim(p_payload->>'help_pl'), f.help_pl),
      help_en = COALESCE(btrim(p_payload->>'help_en'), f.help_en),
      is_required = COALESCE((NULLIF(p_payload->>'is_required', ''))::boolean, f.is_required),
      options = CASE WHEN p_payload ? 'options' THEN v_options ELSE f.options END,
      sort_order = COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, f.sort_order),
      is_qualifying = COALESCE((NULLIF(p_payload->>'is_qualifying', ''))::boolean, f.is_qualifying),
      qualify_operator = COALESCE(NULLIF(p_payload->>'qualify_operator', ''), f.qualify_operator),
      qualify_value = CASE
        WHEN p_payload ? 'qualify_value' THEN COALESCE(p_payload->'qualify_value', 'null'::jsonb)
        ELSE f.qualify_value
      END,
      qualify_outcome = COALESCE(NULLIF(p_payload->>'qualify_outcome', ''), f.qualify_outcome),
      is_active = COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, f.is_active)
    WHERE f.id = v_id AND f.tenant_id = v_tenant;

    RETURN v_id;
  END IF;

  IF v_key !~ '^[a-z][a-z0-9_]{1,48}$' THEN
    RAISE EXCEPTION 'invalid_key: key must match ^[a-z][a-z0-9_]{1,48}$';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  INSERT INTO public.event_registration_fields (
    tenant_id, event_id, key, field_type, label_pl, label_en, help_pl, help_en,
    is_required, options, sort_order, is_qualifying,
    qualify_operator, qualify_value, qualify_outcome, is_active
  ) VALUES (
    v_tenant, v_event_id, v_key,
    COALESCE(NULLIF(p_payload->>'field_type', ''), 'text'),
    v_label_pl, v_label_en,
    COALESCE(btrim(p_payload->>'help_pl'), ''),
    COALESCE(btrim(p_payload->>'help_en'), ''),
    COALESCE((NULLIF(p_payload->>'is_required', ''))::boolean, false),
    v_options,
    COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, 100),
    COALESCE((NULLIF(p_payload->>'is_qualifying', ''))::boolean, false),
    COALESCE(NULLIF(p_payload->>'qualify_operator', ''), 'none'),
    COALESCE(p_payload->'qualify_value', 'null'::jsonb),
    COALESCE(NULLIF(p_payload->>'qualify_outcome', ''), 'approval'),
    COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, true)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_registration_field_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_registration_field_upsert(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_registration_field_upsert(jsonb) IS
  'Dodanie albo edycja pola formularza zapisu. Klucz jest niezmienny po zapisie (odpowiedzi siedza pod nim w answers).';

DROP FUNCTION IF EXISTS public.admin_event_registration_field_delete(_id uuid);
CREATE OR REPLACE FUNCTION public.admin_event_registration_field_delete(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  DELETE FROM public.event_registration_fields f
  WHERE f.id = _id AND f.tenant_id = v_tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: field does not exist in this tenant';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_registration_field_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_registration_field_delete(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_registration_field_delete(uuid) IS
  'Usuwa definicje pola formularza. Zlozone odpowiedzi ZOSTAJA w answers pod swoim kluczem - panel pokazuje je jako pole usuniete, bo skasowanie odpowiedzi razem z pytaniem bylo by utrata danych zgloszenia.';

-- ----------------------------------------------------------------------------
-- D10-D12) BILETY: lista, zapis, usuniecie
--
-- Lista oddaje `availability` LICZONE PO STRONIE SERWERA. Klient skladajacy ten
-- stan z okna sprzedazy, puli i flagi aktywnosci rozjedzie sie z serwerem przy
-- pierwszej zmianie reguly - i wtedy pokaze "w sprzedazy" na bilecie, ktory
-- odmawia zapisu.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_tickets_list(p_event_id uuid);
CREATE OR REPLACE FUNCTION public.admin_event_tickets_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  key text,
  name_pl text,
  name_en text,
  description_pl text,
  description_en text,
  price_cents integer,
  currency text,
  quota integer,
  sold_count integer,
  seats_left integer,
  sales_from timestamptz,
  sales_to timestamptz,
  min_tier_rank integer,
  requires_approval boolean,
  group_id uuid,
  group_name_pl text,
  group_name_en text,
  is_active boolean,
  sort_order integer,
  availability text,
  pending_count integer,
  waitlist_count integer,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  RETURN QUERY
  SELECT
    t.id, t.event_id, t.key, t.name_pl, t.name_en,
    t.description_pl, t.description_en, t.price_cents, t.currency,
    t.quota, t.sold_count,
    public._event_seats_left(v_tenant, t.event_id, t.id),
    t.sales_from, t.sales_to, t.min_tier_rank, t.requires_approval,
    t.group_id, g.name_pl, g.name_en,
    t.is_active, t.sort_order,
    CASE
      WHEN NOT t.is_active THEN 'inactive'
      WHEN t.sales_from IS NOT NULL AND now() < t.sales_from THEN 'scheduled'
      WHEN t.sales_to IS NOT NULL AND now() > t.sales_to THEN 'ended'
      WHEN t.quota IS NOT NULL AND t.sold_count >= t.quota THEN 'sold_out'
      ELSE 'on_sale'
    END,
    COALESCE(c.pending, 0)::integer,
    COALESCE(c.waitlist, 0)::integer,
    t.created_at, t.updated_at
  FROM public.event_ticket_types t
  LEFT JOIN public.event_groups g
    ON g.id = t.group_id AND g.tenant_id = t.tenant_id
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE r.status = 'pending')::integer AS pending,
      count(*) FILTER (WHERE r.status = 'waitlist')::integer AS waitlist
    FROM public.event_registrations r
    WHERE r.tenant_id = t.tenant_id AND r.ticket_type_id = t.id
  ) c ON true
  WHERE t.tenant_id = v_tenant AND t.event_id = p_event_id
  ORDER BY t.sort_order, t.key;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_tickets_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_tickets_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_tickets_list(uuid) IS
  'Bilety wydarzenia z wolnymi miejscami, stanem sprzedazy i licznikami zgloszen oczekujacych i rezerwowych. Stan sprzedazy liczy serwer, nie klient.';

DROP FUNCTION IF EXISTS public.admin_event_ticket_upsert(p_payload jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_ticket_upsert(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_key text := lower(btrim(COALESCE(p_payload->>'key', '')));
  v_name_pl text := btrim(COALESCE(p_payload->>'name_pl', ''));
  v_name_en text := btrim(COALESCE(p_payload->>'name_en', ''));
  v_group_id uuid := NULLIF(p_payload->>'group_id', '')::uuid;
  v_quota integer;
  v_sold integer;
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT t.event_id, t.sold_count INTO v_event_id, v_sold
    FROM public.event_ticket_types t
    WHERE t.id = v_id AND t.tenant_id = v_tenant;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'not_found: ticket does not exist in this tenant';
    END IF;
  END IF;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: event_id is required';
  END IF;

  IF v_name_pl = '' OR v_name_en = '' THEN
    RAISE EXCEPTION 'invalid_names: the name is required in both languages';
  END IF;

  -- Grupa nadawana biletem musi byc grupa TEGO wydarzenia. Klucz obcy zlozony
  -- odrzuci to i tak; tutaj odmowa jest czytelna i wskazuje pole.
  IF v_group_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_groups g
    WHERE g.id = v_group_id AND g.tenant_id = v_tenant AND g.event_id = v_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: group does not exist for this event';
  END IF;

  IF p_payload ? 'quota' THEN
    v_quota := (NULLIF(p_payload->>'quota', ''))::integer;
    -- Pula mniejsza od liczby juz zajetych miejsc nie jest do wykonania:
    -- oznaczalaby, ze trzeba komus odebrac potwierdzone miejsce. Odmawiamy
    -- wprost, zamiast oddawac naruszenie CHECK-a.
    IF v_quota IS NOT NULL AND v_id IS NOT NULL AND v_quota < COALESCE(v_sold, 0) THEN
      RAISE EXCEPTION 'quota_below_sold: % seats are already taken', v_sold;
    END IF;
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE public.event_ticket_types t SET
      name_pl = v_name_pl,
      name_en = v_name_en,
      description_pl = COALESCE(btrim(p_payload->>'description_pl'), t.description_pl),
      description_en = COALESCE(btrim(p_payload->>'description_en'), t.description_en),
      price_cents = COALESCE((NULLIF(p_payload->>'price_cents', ''))::integer, t.price_cents),
      currency = COALESCE(NULLIF(p_payload->>'currency', ''), t.currency),
      quota = CASE WHEN p_payload ? 'quota' THEN v_quota ELSE t.quota END,
      sales_from = CASE
        WHEN p_payload ? 'sales_from' THEN (NULLIF(p_payload->>'sales_from', ''))::timestamptz
        ELSE t.sales_from
      END,
      sales_to = CASE
        WHEN p_payload ? 'sales_to' THEN (NULLIF(p_payload->>'sales_to', ''))::timestamptz
        ELSE t.sales_to
      END,
      min_tier_rank = COALESCE((NULLIF(p_payload->>'min_tier_rank', ''))::integer, t.min_tier_rank),
      requires_approval =
        COALESCE((NULLIF(p_payload->>'requires_approval', ''))::boolean, t.requires_approval),
      group_id = CASE WHEN p_payload ? 'group_id' THEN v_group_id ELSE t.group_id END,
      is_active = COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, t.is_active),
      sort_order = COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, t.sort_order)
    WHERE t.id = v_id AND t.tenant_id = v_tenant;

    RETURN v_id;
  END IF;

  IF v_key !~ '^[a-z][a-z0-9_]{1,48}$' THEN
    RAISE EXCEPTION 'invalid_key: key must match ^[a-z][a-z0-9_]{1,48}$';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  INSERT INTO public.event_ticket_types (
    tenant_id, event_id, key, name_pl, name_en, description_pl, description_en,
    price_cents, currency, quota, sales_from, sales_to, min_tier_rank,
    requires_approval, group_id, is_active, sort_order
  ) VALUES (
    v_tenant, v_event_id, v_key, v_name_pl, v_name_en,
    COALESCE(btrim(p_payload->>'description_pl'), ''),
    COALESCE(btrim(p_payload->>'description_en'), ''),
    COALESCE((NULLIF(p_payload->>'price_cents', ''))::integer, 0),
    COALESCE(NULLIF(p_payload->>'currency', ''), 'PLN'),
    (NULLIF(p_payload->>'quota', ''))::integer,
    (NULLIF(p_payload->>'sales_from', ''))::timestamptz,
    (NULLIF(p_payload->>'sales_to', ''))::timestamptz,
    COALESCE((NULLIF(p_payload->>'min_tier_rank', ''))::integer, 0),
    COALESCE((NULLIF(p_payload->>'requires_approval', ''))::boolean, false),
    v_group_id,
    COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, true),
    COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, 100)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_ticket_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_ticket_upsert(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_ticket_upsert(jsonb) IS
  'Dodanie albo edycja biletu wydarzenia. Klucz niezmienny po zapisie. Pula nie da sie zejsc pod liczbe zajetych miejsc.';

DROP FUNCTION IF EXISTS public.admin_event_ticket_delete(_id uuid);
CREATE OR REPLACE FUNCTION public.admin_event_ticket_delete(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_used integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.event_ticket_types t WHERE t.id = _id AND t.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: ticket does not exist in this tenant';
  END IF;

  -- Klucz obcy jest ON DELETE SET NULL, wiec usuniecie by PRZESZLO i po cichu
  -- odebralo zapisom ich bilet. Blokada jest tu wlasnie po to, zeby cisza nie
  -- byla mozliwa: wylaczenie biletu jest odwracalne, usuniecie nie.
  SELECT count(*)::integer INTO v_used
  FROM public.event_registrations r
  WHERE r.tenant_id = v_tenant AND r.ticket_type_id = _id;

  IF v_used > 0 THEN
    RAISE EXCEPTION 'ticket_in_use: % registration(s) use this ticket', v_used;
  END IF;

  DELETE FROM public.event_ticket_types t WHERE t.id = _id AND t.tenant_id = v_tenant;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_ticket_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_ticket_delete(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_ticket_delete(uuid) IS
  'Usuwa bilet wydarzenia. Odmawia, gdy jakikolwiek zapis go uzywa - wtedy poprawna operacja jest wylaczenie (is_active = false).';

-- ----------------------------------------------------------------------------
-- D13-D16) GRUPY I CZLONKOSTWO
--
-- `members_count` liczy OBIE drogi przynaleznosci: grupe podstawowa z zapisu
-- i czlonkostwo dodatkowe. Licznik liczacy tylko jedna z nich mowilby "0"
-- o grupie, w ktorej sa wszyscy uczestnicy wydarzenia.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_groups_list(p_event_id uuid);
CREATE OR REPLACE FUNCTION public.admin_event_groups_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  key text,
  name_pl text,
  name_en text,
  description_pl text,
  description_en text,
  color text,
  attendee_visibility text,
  can_see_attendees boolean,
  can_meet boolean,
  can_chat boolean,
  can_lead_retrieval boolean,
  can_see_recording boolean,
  min_tier_rank integer,
  sort_order integer,
  is_default boolean,
  is_system boolean,
  members_count integer,
  primary_members_count integer,
  extra_members_count integer,
  tickets_count integer,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  RETURN QUERY
  SELECT
    g.id, g.event_id, g.key, g.name_pl, g.name_en,
    g.description_pl, g.description_en, g.color,
    g.attendee_visibility, g.can_see_attendees, g.can_meet, g.can_chat,
    g.can_lead_retrieval, g.can_see_recording, g.min_tier_rank, g.sort_order,
    g.is_default, g.is_system,
    (COALESCE(pm.cnt, 0) + COALESCE(em.cnt, 0))::integer,
    COALESCE(pm.cnt, 0)::integer,
    COALESCE(em.cnt, 0)::integer,
    COALESCE(tk.cnt, 0)::integer,
    g.created_at, g.updated_at
  FROM public.event_groups g
  LEFT JOIN LATERAL (
    SELECT count(DISTINCT r.person_id)::integer AS cnt
    FROM public.event_registrations r
    WHERE r.tenant_id = g.tenant_id
      AND r.group_id = g.id
      AND r.status NOT IN ('cancelled', 'rejected')
  ) pm ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM public.event_group_members m
    WHERE m.tenant_id = g.tenant_id AND m.group_id = g.id
  ) em ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM public.event_ticket_types t
    WHERE t.tenant_id = g.tenant_id AND t.group_id = g.id
  ) tk ON true
  WHERE g.tenant_id = v_tenant AND g.event_id = p_event_id
  ORDER BY g.sort_order, g.key;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_groups_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_groups_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_groups_list(uuid) IS
  'Grupy uczestnikow wydarzenia z uprawnieniami i licznikami: czlonkowie podstawowi (z zapisu), dodatkowi (czlonkostwo) i bilety nadajace grupe.';

DROP FUNCTION IF EXISTS public.admin_event_group_upsert(p_payload jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_group_upsert(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_key text := lower(btrim(COALESCE(p_payload->>'key', '')));
  v_name_pl text := btrim(COALESCE(p_payload->>'name_pl', ''));
  v_name_en text := btrim(COALESCE(p_payload->>'name_en', ''));
  v_is_default boolean := (NULLIF(p_payload->>'is_default', ''))::boolean;
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT g.event_id INTO v_event_id
    FROM public.event_groups g
    WHERE g.id = v_id AND g.tenant_id = v_tenant;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'not_found: group does not exist in this tenant';
    END IF;
  END IF;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: event_id is required';
  END IF;

  IF v_name_pl = '' OR v_name_en = '' THEN
    RAISE EXCEPTION 'invalid_names: the name is required in both languages';
  END IF;

  -- Dokladnie jedna grupa domyslna na wydarzenie. Pilnuje tego indeks
  -- czesciowy; tutaj ODBIERAMY flage poprzedniej, zeby przelaczenie bylo
  -- operacja jednym kliknieciem, a nie sekwencja dwoch zapisow, ktorej
  -- polowa moze sie nie udac.
  IF v_is_default IS TRUE THEN
    UPDATE public.event_groups g
    SET is_default = false
    WHERE g.tenant_id = v_tenant
      AND g.event_id = v_event_id
      AND g.is_default
      AND (v_id IS NULL OR g.id <> v_id);
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE public.event_groups g SET
      name_pl = v_name_pl,
      name_en = v_name_en,
      description_pl = COALESCE(btrim(p_payload->>'description_pl'), g.description_pl),
      description_en = COALESCE(btrim(p_payload->>'description_en'), g.description_en),
      color = CASE
        WHEN p_payload ? 'color' THEN NULLIF(btrim(COALESCE(p_payload->>'color', '')), '')
        ELSE g.color
      END,
      attendee_visibility =
        COALESCE(NULLIF(p_payload->>'attendee_visibility', ''), g.attendee_visibility),
      can_see_attendees =
        COALESCE((NULLIF(p_payload->>'can_see_attendees', ''))::boolean, g.can_see_attendees),
      can_meet = COALESCE((NULLIF(p_payload->>'can_meet', ''))::boolean, g.can_meet),
      can_chat = COALESCE((NULLIF(p_payload->>'can_chat', ''))::boolean, g.can_chat),
      can_lead_retrieval =
        COALESCE((NULLIF(p_payload->>'can_lead_retrieval', ''))::boolean, g.can_lead_retrieval),
      can_see_recording =
        COALESCE((NULLIF(p_payload->>'can_see_recording', ''))::boolean, g.can_see_recording),
      min_tier_rank = COALESCE((NULLIF(p_payload->>'min_tier_rank', ''))::integer, g.min_tier_rank),
      sort_order = COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, g.sort_order),
      is_default = COALESCE(v_is_default, g.is_default)
    WHERE g.id = v_id AND g.tenant_id = v_tenant;

    RETURN v_id;
  END IF;

  IF v_key !~ '^[a-z][a-z0-9_]{1,48}$' THEN
    RAISE EXCEPTION 'invalid_key: key must match ^[a-z][a-z0-9_]{1,48}$';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  INSERT INTO public.event_groups (
    tenant_id, event_id, key, name_pl, name_en, description_pl, description_en,
    color, attendee_visibility, can_see_attendees, can_meet, can_chat,
    can_lead_retrieval, can_see_recording, min_tier_rank, sort_order,
    is_default, is_system
  ) VALUES (
    v_tenant, v_event_id, v_key, v_name_pl, v_name_en,
    COALESCE(btrim(p_payload->>'description_pl'), ''),
    COALESCE(btrim(p_payload->>'description_en'), ''),
    NULLIF(btrim(COALESCE(p_payload->>'color', '')), ''),
    COALESCE(NULLIF(p_payload->>'attendee_visibility', ''), 'registered'),
    COALESCE((NULLIF(p_payload->>'can_see_attendees', ''))::boolean, true),
    COALESCE((NULLIF(p_payload->>'can_meet', ''))::boolean, false),
    COALESCE((NULLIF(p_payload->>'can_chat', ''))::boolean, true),
    COALESCE((NULLIF(p_payload->>'can_lead_retrieval', ''))::boolean, false),
    COALESCE((NULLIF(p_payload->>'can_see_recording', ''))::boolean, true),
    COALESCE((NULLIF(p_payload->>'min_tier_rank', ''))::integer, 0),
    COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, 100),
    COALESCE(v_is_default, false),
    false
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_group_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_group_upsert(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_group_upsert(jsonb) IS
  'Dodanie albo edycja grupy uczestnikow. Ustawienie grupy domyslnej odbiera flage poprzedniej w jednej operacji.';

DROP FUNCTION IF EXISTS public.admin_event_group_delete(_id uuid);
CREATE OR REPLACE FUNCTION public.admin_event_group_delete(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_is_system boolean;
  v_used integer;
BEGIN
  SELECT g.is_system INTO v_is_system
  FROM public.event_groups g
  WHERE g.id = _id AND g.tenant_id = v_tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: group does not exist in this tenant';
  END IF;

  IF v_is_system THEN
    RAISE EXCEPTION 'group_system: system groups cannot be deleted';
  END IF;

  -- Zapisy i bilety maja klucz ON DELETE SET NULL, wiec usuniecie by przeszlo
  -- i po cichu odebralo im grupe. Liczymy oba uzycia i odmawiamy.
  SELECT
    (SELECT count(*) FROM public.event_registrations r
      WHERE r.tenant_id = v_tenant AND r.group_id = _id)
    + (SELECT count(*) FROM public.event_ticket_types t
        WHERE t.tenant_id = v_tenant AND t.group_id = _id)
    + (SELECT count(*) FROM public.event_group_members m
        WHERE m.tenant_id = v_tenant AND m.group_id = _id)
  INTO v_used;

  IF v_used > 0 THEN
    RAISE EXCEPTION 'group_in_use: % registration(s), ticket(s) or membership(s) use this group', v_used;
  END IF;

  DELETE FROM public.event_groups g WHERE g.id = _id AND g.tenant_id = v_tenant;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_group_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_group_delete(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_group_delete(uuid) IS
  'Usuwa grupe uczestnikow. Odmawia dla grup systemowych i dla grup uzywanych przez zapisy, bilety albo czlonkostwa.';

-- Czlonkostwo dodatkowe: jedna funkcja na dodanie i odjecie, bo to ta sama
-- decyzja z dwoma kierunkami. Osobne funkcje dawaly by dwie kopie sprawdzenia,
-- czy grupa i osoba naleza do tego samego wydarzenia i najemcy.
DROP FUNCTION IF EXISTS public.admin_event_group_member_set(p_payload jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_group_member_set(p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_uid uuid := auth.uid();
  v_group_id uuid := NULLIF(p_payload->>'group_id', '')::uuid;
  v_person_id uuid := NULLIF(p_payload->>'person_id', '')::uuid;
  v_member boolean := COALESCE((NULLIF(p_payload->>'is_member', ''))::boolean, true);
  v_event_id uuid;
BEGIN
  IF v_group_id IS NULL OR v_person_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: group_id and person_id are required';
  END IF;

  SELECT g.event_id INTO v_event_id
  FROM public.event_groups g
  WHERE g.id = v_group_id AND g.tenant_id = v_tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: group does not exist in this tenant';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.event_people p
    WHERE p.id = v_person_id AND p.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: person does not exist in this tenant';
  END IF;

  IF v_member THEN
    INSERT INTO public.event_group_members (
      tenant_id, event_id, group_id, person_id, added_by
    ) VALUES (
      v_tenant, v_event_id, v_group_id, v_person_id, v_uid
    )
    ON CONFLICT (tenant_id, group_id, person_id) DO NOTHING;
  ELSE
    DELETE FROM public.event_group_members m
    WHERE m.tenant_id = v_tenant
      AND m.group_id = v_group_id
      AND m.person_id = v_person_id;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_group_member_set(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_group_member_set(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_group_member_set(jsonb) IS
  'Dodaje albo odejmuje osobe w grupie DODATKOWEJ wydarzenia (is_member decyduje o kierunku). Idempotentna w obie strony.';

-- ----------------------------------------------------------------------------
-- D17-D19) ZGODY: lista, zapis, usuniecie
--
-- Lista oddaje DWA liczniki akceptacji: w aktualnej wersji i w dowolnej.
-- Roznica miedzy nimi jest miara skutku podniesienia wersji - i jedyna liczba,
-- ktora mowi organizatorowi, ilu ludzi trzeba poprosic ponownie.
--
-- USUNIECIE ZGODY Z AKCEPTACJAMI JEST ZABRONIONE. Akceptacja jest dowodem, a
-- kaskada skasowalaby dowod razem z pytaniem. Poprawna operacja to wylaczenie
-- (`is_active = false`): zgoda znika z formularza, dowody zostaja.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_terms_list(p_event_id uuid);
CREATE OR REPLACE FUNCTION public.admin_event_terms_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  key text,
  label_pl text,
  label_en text,
  body_pl text,
  body_en text,
  external_url text,
  display text,
  is_required boolean,
  version integer,
  sort_order integer,
  is_active boolean,
  acceptances_current integer,
  acceptances_total integer,
  withdrawn_count integer,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  RETURN QUERY
  SELECT
    tr.id, tr.event_id, tr.key, tr.label_pl, tr.label_en,
    tr.body_pl, tr.body_en, tr.external_url, tr.display,
    tr.is_required, tr.version, tr.sort_order, tr.is_active,
    COALESCE(a.current_version, 0)::integer,
    COALESCE(a.total, 0)::integer,
    COALESCE(a.withdrawn, 0)::integer,
    tr.created_at, tr.updated_at
  FROM public.event_terms tr
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE ac.version = tr.version AND ac.withdrawn_at IS NULL)::integer
        AS current_version,
      count(*) FILTER (WHERE ac.withdrawn_at IS NULL)::integer AS total,
      count(*) FILTER (WHERE ac.withdrawn_at IS NOT NULL)::integer AS withdrawn
    FROM public.event_term_acceptances ac
    WHERE ac.tenant_id = tr.tenant_id AND ac.term_id = tr.id
  ) a ON true
  WHERE tr.tenant_id = v_tenant AND tr.event_id = p_event_id
  ORDER BY tr.sort_order, tr.key;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_terms_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_terms_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_terms_list(uuid) IS
  'Zgody wydarzenia z licznikami akceptacji: w AKTUALNEJ wersji, w dowolnej, i wycofanych. Roznica dwoch pierwszych mierzy skutek podniesienia wersji.';

DROP FUNCTION IF EXISTS public.admin_event_term_upsert(p_payload jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_term_upsert(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_key text := lower(btrim(COALESCE(p_payload->>'key', '')));
  v_label_pl text := btrim(COALESCE(p_payload->>'label_pl', ''));
  v_label_en text := btrim(COALESCE(p_payload->>'label_en', ''));
  v_bump boolean := COALESCE((NULLIF(p_payload->>'bump_version', ''))::boolean, false);
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT tr.event_id INTO v_event_id
    FROM public.event_terms tr
    WHERE tr.id = v_id AND tr.tenant_id = v_tenant;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'not_found: term does not exist in this tenant';
    END IF;
  END IF;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: event_id is required';
  END IF;

  IF v_label_pl = '' OR v_label_en = '' THEN
    RAISE EXCEPTION 'invalid_labels: the label is required in both languages';
  END IF;

  IF v_id IS NOT NULL THEN
    -- WERSJA IDZIE W GORE TYLKO NA ZADANIE. Automatyczne podniesienie przy
    -- kazdej literowce w tresci kazaloby wszystkim uczestnikom akceptowac zgode
    -- ponownie - a wtedy redakcja przestalaby poprawiac literowki.
    UPDATE public.event_terms tr SET
      label_pl = v_label_pl,
      label_en = v_label_en,
      body_pl = COALESCE(p_payload->>'body_pl', tr.body_pl),
      body_en = COALESCE(p_payload->>'body_en', tr.body_en),
      external_url = CASE
        WHEN p_payload ? 'external_url'
          THEN NULLIF(btrim(COALESCE(p_payload->>'external_url', '')), '')
        ELSE tr.external_url
      END,
      display = COALESCE(NULLIF(p_payload->>'display', ''), tr.display),
      is_required = COALESCE((NULLIF(p_payload->>'is_required', ''))::boolean, tr.is_required),
      version = CASE WHEN v_bump THEN tr.version + 1 ELSE tr.version END,
      sort_order = COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, tr.sort_order),
      is_active = COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, tr.is_active)
    WHERE tr.id = v_id AND tr.tenant_id = v_tenant;

    RETURN v_id;
  END IF;

  IF v_key !~ '^[a-z][a-z0-9_]{1,48}$' THEN
    RAISE EXCEPTION 'invalid_key: key must match ^[a-z][a-z0-9_]{1,48}$';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  INSERT INTO public.event_terms (
    tenant_id, event_id, key, label_pl, label_en, body_pl, body_en,
    external_url, display, is_required, version, sort_order, is_active
  ) VALUES (
    v_tenant, v_event_id, v_key, v_label_pl, v_label_en,
    COALESCE(p_payload->>'body_pl', ''),
    COALESCE(p_payload->>'body_en', ''),
    NULLIF(btrim(COALESCE(p_payload->>'external_url', '')), ''),
    COALESCE(NULLIF(p_payload->>'display', ''), 'registration'),
    COALESCE((NULLIF(p_payload->>'is_required', ''))::boolean, false),
    1,
    COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, 100),
    COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, true)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_term_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_term_upsert(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_term_upsert(jsonb) IS
  'Dodanie albo edycja zgody wydarzenia. Wersja rosnie WYLACZNIE przy bump_version = true - podniesienie uniewaznia dotychczasowe akceptacje jako aktualne.';

DROP FUNCTION IF EXISTS public.admin_event_term_delete(_id uuid);
CREATE OR REPLACE FUNCTION public.admin_event_term_delete(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_used integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.event_terms tr WHERE tr.id = _id AND tr.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: term does not exist in this tenant';
  END IF;

  SELECT count(*)::integer INTO v_used
  FROM public.event_term_acceptances a
  WHERE a.tenant_id = v_tenant AND a.term_id = _id;

  IF v_used > 0 THEN
    RAISE EXCEPTION 'term_in_use: % acceptance(s) recorded - deactivate instead', v_used;
  END IF;

  DELETE FROM public.event_terms tr WHERE tr.id = _id AND tr.tenant_id = v_tenant;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_term_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_term_delete(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_term_delete(uuid) IS
  'Usuwa zgode wydarzenia. Odmawia, gdy istnieje choc jedna akceptacja - akceptacja jest dowodem, wiec poprawna operacja jest wylaczenie zgody.';
