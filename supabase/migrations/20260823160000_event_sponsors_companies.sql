-- ============================================================================
-- Event Builder, etap 4: SPONSORZY, PARTNERZY I WYSTAWCY - ZSYNCHRONIZOWANI
--                        Z KARTOTEKA FIRM (CRM)
--
-- STAN PRZED. Sponsorzy wydarzenia zyja jako TRESC WIDGETU `event-sponsors`:
-- tablica `content.tiers[].sponsors[]` w `builder_data` strony, parsowana
-- wylacznie po stronie klienta (`src/lib/events/sponsors.ts`,
-- `parseSponsorTiers`). Dla plakatu z logotypami to wystarcza. Nie wystarcza na
-- nic, co wymaga tozsamosci firmy i policzalnosci:
--   * ta sama firma na trzech wydarzeniach to TRZY niezalezne wpisy jsonb
--     z trzema roznymi pisowniami nazwy i trzema adresami logotypu - nie da sie
--     zapytac "na ilu naszych wydarzeniach byla ta firma" ani polaczyc jej
--     z kartoteka sprzedazowa, w ktorej ta sama firma juz jest;
--   * poziom sponsorski jest napisem w jsonbie, wiec "maksymalnie cztery firmy
--     na poziomie Diamond" jest obietnica handlowa, ktorej nikt nie pilnuje;
--   * osoba kontaktowa sponsora nie ma gdzie mieszkac, wiec mieszka w arkuszu;
--   * materialy sponsora (prezentacja, katalog, pakiet logotypow) nie maja
--     wiersza, wiec zakladka "Materialy" na stronie wydarzenia nie ma zrodla;
--   * publikacja jest wszystko-albo-nic: albo widget jest na stronie, albo go
--     nie ma. Nie da sie przygotowac sponsora "na potem".
--
-- DECYZJA WLASCICIELA PRODUKTU (doc par. 0.4 i par. 4.5). Modul wystawcow NIE
-- POWSTAJE. Sponsor, partner, patron medialny i wystawca to JEDNA I TA SAMA
-- rzecz na innym miejscu w hierarchii: FIRMA Z KARTOTEKI `crm_companies`
-- przypieta do wydarzenia. Ta migracja NIE tworzy drugiego rejestru firm ani
-- drugiego rejestru osob - wskazuje `crm_companies` (firma) i `crm_leads`
-- (osoba kontaktowa) kluczami obcymi zlozonymi.
--
-- STAN PO. Piec tabel, osiemnascie funkcji RPC (szesnascie panelu, dwie
-- publiczne) i jeden pomocnik wewnetrzny normalizujacy adres strony firmy:
--   * `event_sponsor_tiers`          - poziomy sponsorskie JEDNEGO wydarzenia
--     (klucz, nazwa i opis PL/EN, ranga, kolor akcentu, rozmiar logotypu,
--     limit firm, kolejnosc, aktywnosc);
--   * `event_sponsor_tier_benefits`  - swiadczenia poziomu, pozycja po pozycji;
--   * `event_sponsors`               - PRZYPIECIE firmy do wydarzenia razem
--     z MIGAWKA PREZENTACJI, rola, stanowiskiem, kolejnoscia i publikacja;
--   * `event_sponsor_contacts`       - osoby z CRM obslugujace to przypiecie;
--   * `event_sponsor_materials`      - materialy sponsora pod zakladke na
--     stronie wydarzenia.
--
-- DLACZEGO TAK
--
-- 1) MIGAWKA PREZENTACJI JEST SEDNEM TEGO MODULU. Nazwa, logotyp, opis, adres
--    strony i kraj pokazywane na stronie wydarzenia sa WLASNYMI KOLUMNAMI
--    `event_sponsors` (`snapshot_*`), a nie odczytem na zywo z `crm_companies`.
--    Powod jest jeden i jest twardy: KARTOTEKA ZMIENIA SIE PO WYDARZENIU.
--    Firma sie przebrandowuje, zmienia domene, jest przejmowana, wymienia
--    logotyp na nowy. Strona kongresu z marca 2024 ma pokazywac stan z marca
--    2024 - to jest DOKUMENT, nie widok. Odczyt na zywo zamienilby archiwum
--    w zywy kanal marketingowy przejmujacej spolki, i to bez zadnej decyzji
--    redakcji.
--
--    Dowod przez zaprzeczenie: gdyby migawka byla widokiem na CRM, jedna
--    zmiana nazwy w kartotece przepisalaby N stron archiwalnych naraz, bez
--    sladu, bez zatwierdzenia i bez mozliwosci cofniecia. Zadna kolumna nie
--    pamietalaby, co bylo na stronie w dniu wydarzenia.
--
-- 2) ODSWIEZENIE MIGAWKI JEST JAWNA OPERACJA ORGANIZATORA, NIE TRIGGEREM.
--    `admin_event_sponsor_snapshot_refresh(p_payload)` przepisuje migawke
--    z kartoteki - jedno przypiecie albo wsadowo. NIE ROBIMY TEGO
--    AUTOMATYCZNIE, i to jest decyzja, nie przeoczenie:
--      * trigger na `crm_companies` przepisywalby dziesiatki stron archiwalnych
--        przy jednym zapisie handlowca, bez recenzji i bez cofniecia;
--      * kartoteke edytuje sprzedaz, a strone wydarzenia PODPISUJE organizator
--        - to dwie rozne odpowiedzialnosci i dwa rozne momenty w czasie;
--      * rozjazd jest WIDOCZNY I POLICZALNY w liscie panelu (patrz punkt 3),
--        wiec odswiezenie jest decyzja z podgladem, a nie niespodzianka.
--    Odswiezenie dotyczy CZTERECH pol kartotecznych (nazwa, logotyp, adres
--    strony, kraj). OPISU NIE DOTYKA NIGDY - patrz punkt 4.
--
-- 3) ROZJAZD MIGAWKI JEST WYLICZENIEM W RPC, NIE KOLUMNA W TABELI. Lista
--    panelu porownuje migawke z BIEZACYMI wartosciami firmy i oddaje
--    `crm_drift` plus `crm_drift_fields` (ktore konkretnie pola sie roznia).
--    Kolumna `is_out_of_sync` w tabeli byla by DRUGIM ZRODLEM PRAWDY o stanie,
--    ktory w calosci wynika z dwoch wierszy juz istniejacych: rozjechala by sie
--    przy pierwszej zmianie w `crm_companies` zrobionej inna sciezka niz nasza
--    (import, `COPY`, panel CRM, `service_role`), i pokazywalaby "zgodne" tam,
--    gdzie zgodne nie jest. Wyliczenie jest z definicji aktualne w chwili
--    odczytu, a koszt to porownanie czterech tekstow na wiersz strony listy.
--
--    Porownanie idzie po `btrim`: nazwa z ogonem spacji nie jest inna nazwa,
--    a falszywy rozjazd uczy redaktora ignorowac ostrzezenie.
--
--    `snapshot_source` odroznia DWA rozne rozjazdy, ktore inaczej wygladaja
--    identycznie: `crm` = migawka byla kopia kartoteki, wiec roznica znaczy
--    "kartoteka poszla dalej"; `manual` = redaktor SWIADOMIE nadpisal
--    prezentacje (nazwa handlowa inna niz rejestrowa, logotyp na ciemne tlo),
--    wiec roznica jest zamierzona i nie jest bledem do naprawienia.
--
-- 4) OPIS SPONSORA JEST REDAKCYJNY I NIE MA ZRODLA W KARTOTECE. `crm_companies`
--    nie ma i nie bedzie miec kolumny opisu - kartoteka sprzedazowa nie jest
--    miejscem na tekst marketingowy (doc par. 4.5: "bez zasmiecania CRM danymi
--    marketingowymi"). Dlatego `snapshot_description_pl/en` powstaja W PANELU
--    WYDARZENIA i odswiezenie migawki ICH NIE RUSZA. Alternatywa - dorobic
--    opis do CRM tylko po to, zeby migawka miala co kopiowac - dodalaby do
--    kartoteki pole, ktorego nikt w CRM nie wypelnia, i zamienila realny proces
--    w atrape.
--
-- 5) LIMIT FIRM NA POZIOMIE JEST EGZEKWOWANY BLOKADA WIERSZA POZIOMU.
--    `admin_event_sponsor_save` bierze `SELECT ... FOR UPDATE` na wierszu
--    `event_sponsor_tiers` i dopiero pod ta blokada liczy przypiecia (wzorzec
--    `rsvp_event` z 20260713093000 i `event_session_signup` z 20260823140000).
--    Odczyt licznika bez blokady jest wyscigiem: dwa formularze zapisane w tej
--    samej milisekundzie widza trzy z czterech miejsc i oba zapisuja czwarte.
--    Licznika zmaterializowanego na poziomie NIE MA swiadomie - byl by drugim
--    zrodlem prawdy, ktore rozjezdza sie po pierwszym `DELETE` bez triggera.
--
--    Limit liczy WSZYSTKIE przypiecia poziomu, takze nieopublikowane. Miejsce
--    na poziomie Diamond jest SPRZEDANE w chwili przypiecia, nie w chwili
--    publikacji logotypu - liczenie tylko opublikowanych pozwalaloby sprzedac
--    piate miejsce z czterech.
--
-- 6) USUNIECIE FIRMY Z KARTOTEKI JEST ODRZUCANE, GDY FIRMA SPONSOROWALA
--    WYDARZENIE. Klucz obcy `(tenant_id, company_id)` ma domyslne NO ACTION,
--    nie CASCADE i nie SET NULL:
--      * CASCADE wykasowalby przypiecie, czyli DOKUMENT sponsoringu - jedna
--        decyzja porzadkowa w CRM zabralaby logotypy ze wszystkich stron
--        archiwalnych;
--      * SET NULL na kluczu zlozonym zeruje WSZYSTKIE kolumny klucza (w tym
--        `tenant_id NOT NULL`), a wariant z lista kolumn wymaga PostgreSQL 15.
--    Konsekwencja jest zamierzona: firma, ktora byla sponsorem, zostaje
--    w kartotece. To wlasnie znaczy "kartoteka jest jednym zrodlem prawdy
--    o firmie".
--
--    OSOBA KONTAKTOWA MA ODWROTNA ZASADE (`ON DELETE CASCADE` do `crm_leads`),
--    bo kontakt jest OPERACYJNY, nie archiwalny: skasowana osoba nie moze
--    zostac osoba kontaktowa, a strona publiczna nigdy nie pokazuje kontaktow.
--
-- 7) SWIADCZENIA POZIOMU SA WIERSZAMI, NIE TABLICA JSONB. Argument jest ten
--    sam, co przy agendzie (20260823140000): pozycja w jsonbie nie ma wlasnej
--    kolejnosci do przestawienia, nie da sie jej ograniczyc CHECK-iem na
--    dlugosc, a walidacja "kazda pozycja ma tekst w obu jezykach" musi wtedy
--    zyc w kliencie - czyli nie istnieje dla importu. Zapis jest WSADOWY
--    (cala lista naraz), bo formularz poziomu edytuje ja jako calosc.
--
-- 8) `rank` I `sort_order` TO DWIE ROZNE RZECZY. `rank` mowi, JAK WYSOKO stoi
--    poziom w hierarchii handlowej (Diamond > Zloty > Srebrny) - po nim idzie
--    kolejnosc grup na stronie publicznej i po nim panel odpowiada na pytanie
--    "czy ten sponsor jest co najmniej zloty". `sort_order` to reczna kolejnosc
--    w liscie panelu. Rownej rangi NIE ZABRANIAMY: "Partner Technologiczny"
--    i "Partner Medialny" moga stac na tej samej wysokosci i wtedy `sort_order`
--    rozstrzyga, ktory jest pierwszy.
--
-- 9) POZIOM WYLACZONY (`is_active = false`) ZNIKA Z SELEKTU, ALE NIE ZE STRONY.
--    Dokladnie jak `event_tracks.is_active` (20260823140000): poziom przestaje
--    byc oferowany w formularzu przypiecia, ale grupa logotypow, ktora jest
--    juz opublikowana, zostaje. Ukrycie jej zabraloby ze strony sponsora, ktory
--    zaplacil, przy operacji wygladajacej jak porzadkowanie cennika. Dlatego
--    polityka publiczna i publiczny RPC NIE filtruja po `is_active`.
--
-- IZOLACJA NAJEMCOW
--   * Kazda z pieciu tabel ma wlasna kolumne `tenant_id uuid NOT NULL`
--     z kluczem obcym do `tenants(id)` i kaskada usuniecia.
--   * Kazde powiazanie z wydarzeniem jest KLUCZEM OBCYM ZLOZONYM do
--     `events (tenant_id, id)` (ograniczenie `events_tenant_id_key`
--     z 20260823135000), wiec wiersz nie moze wskazac wydarzenia obcego
--     najemcy - baza odrzuca to na poziomie silnika, takze przy imporcie
--     i przy `COPY`, gdzie trigger nie obowiazuje.
--   * Powiazania w GLAB drzewa sa POTROJNE: `(tenant_id, event_id, tier_id)`
--     i `(tenant_id, event_id, sponsor_id)`. Para z samym najemca pilnowalaby
--     tylko granicy firmy; potrojka pilnuje TAKZE tego, ze poziom i przypiecie
--     naleza do TEGO SAMEGO wydarzenia - inaczej sponsor kongresu marcowego
--     stanalby w poziomie Diamond kongresu listopadowego.
--   * Wskazania do kartoteki sa ZLOZONE: `(tenant_id, company_id)` ->
--     `crm_companies (tenant_id, id)` i `(tenant_id, lead_id)` ->
--     `crm_leads (tenant_id, id)`. Bez tego wiersz najemcy A moglby wskazac
--     firme najemcy B (oba klucze obce spelnione osobno), a lista skalowana po
--     `tenant_id` pokazalaby obca firme jako wlasnego sponsora.
--   * Kazda tabela ma wlaczone RLS i JAWNE polityki. ZAPIS NIE MA ZADNEJ
--     POLITYKI KLIENCKIEJ - jedyna droga to RPC `SECURITY DEFINER` z bramka
--     `assert_editor_tenant()`. Brak polityki to stan pozadany, nie
--     przeoczenie.
--   * `event_sponsor_contacts` NIE MA POLITYKI PUBLICZNEJ I NIE MA GRANTU DLA
--     `anon`. Dane kontaktowe sponsora to dane osobowe osoby, ktora nie zapisala
--     sie na nic - nie ma zadnej sciezki, na ktorej powinny wyjsc na strone.
--   * Plaszczyzna ADMINISTRACYJNA uzywa WYLACZNIE `assert_editor_tenant()`
--     (tenant DOMOWY wolajacego) i nigdy naglowka hosta. Plaszczyzna TRESCI
--     (dwa publiczne RPC) uzywa WYLACZNIE `public_tenant_id()` i nie wola
--     `has_role()` ani `is_staff()` w zadnym ciele - naglowek `x-tenant-host`
--     jest falsyfikowalny, wiec mieszanka pozwolilaby administratorowi najemcy
--     A podszyc sie pod najemce B (bramka `check:sql-tenant-scope`).
--   * Kazda funkcja SECURITY DEFINER ma `SET search_path = public, pg_temp`.
--   * Kazdy indeks skalowany po najemcy ma `tenant_id` na pierwszej pozycji.
--
-- FORWARD-ONLY I IDEMPOTENTNOSC. Tabele `CREATE TABLE IF NOT EXISTS`,
-- ograniczenia dokladane blokami `DO $$ ... $$` z testem `pg_constraint`,
-- polityki i triggery wzorcem `DROP ... IF EXISTS` + `CREATE`, funkcje
-- `DROP FUNCTION IF EXISTS` z pelna sygnatura + `CREATE FUNCTION`. Powtorny
-- przebieg na bazie czesciowo zmigrowanej nie psuje danych.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) KOTWICE TOZSAMOSCI W GRANICACH NAJEMCY
--
-- To samo, co `events_tenant_id_key` zrobil dla wydarzenia (20260823135000):
-- bez `UNIQUE (tenant_id, id)` po stronie kartoteki wskazanie firmy i osoby
-- musialoby trzymac DWA niezalezne klucze obce, a wtedy wiersz najemcy A moze
-- wskazywac firme najemcy B - oba klucze sa spelnione osobno, a zapytanie
-- skalowane po `tenant_id` widzi obca firme przy swoim wydarzeniu.
--
-- `crm_companies_tenant_id_key` zaklada takze 20260823150000 (modul
-- uczestnikow). Blok jest warunkowy, wiec kolejnosc wykonania nie ma znaczenia
-- i zadna z migracji nie zalezy od tego, czy druga juz przeszla.
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

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.crm_leads'::regclass
      AND conname = 'crm_leads_tenant_id_key'
  ) THEN
    ALTER TABLE public.crm_leads
      ADD CONSTRAINT crm_leads_tenant_id_key UNIQUE (tenant_id, id);
  END IF;
END
$$;

COMMENT ON CONSTRAINT crm_leads_tenant_id_key ON public.crm_leads IS
  'Tozsamosc osoby z kartoteki w granicach najemcy. Cel klucza obcego zlozonego (tenant_id, lead_id) z event_sponsor_contacts - uniemozliwia wskazanie osoby innego najemcy.';

-- ----------------------------------------------------------------------------
-- 1) POZIOMY SPONSORSKIE JEDNEGO WYDARZENIA
--
-- Poziom nalezy do WYDARZENIA, nie do organizacji. "Zloty Partner" kongresu
-- energetycznego i "Zloty Partner" gali rocznej to dwie rozne oferty z innymi
-- swiadczeniami i innym cennikiem; wspolny katalog wymuszalby na sprzedazy
-- rozstrzyganie przy kazdym przypieciu, ktora oferta jest ktora.
--
-- `key` jest stabilnym identyfikatorem kotwicy na stronie wydarzenia
-- (`/sponsorzy#diamond`) i selektora w materialach handlowych, dlatego ma
-- format identyczny z `event_types.key` i `event_tracks.key`, jest unikalny
-- w obrebie wydarzenia i NIEZMIENNY po zapisie.
--
-- `logo_size` jest kolumna, a nie ustawieniem widgetu, bo rozmiar logotypu
-- NALEZY DO POZIOMU: "duzy logotyp" to swiadczenie sprzedane razem z pakietem
-- Diamond, a nie decyzja o wygladzie podejmowana osobno na kazdej stronie.
-- Wartosci sa te same trzy, co w kontrakcie widgetu `event-sponsors`
-- (`SponsorTierSize` w src/lib/events/sponsors.ts), zeby publiczny RPC mogl
-- zasilic ten sam komponent, ktory dzis czyta tresc widgetu.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_sponsor_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  key text NOT NULL,
  name_pl text NOT NULL,
  name_en text NOT NULL,
  description_pl text NOT NULL DEFAULT '',
  description_en text NOT NULL DEFAULT '',
  -- Wysokosc w hierarchii handlowej. Wyzsza liczba = wyzszy poziom.
  rank integer NOT NULL DEFAULT 0,
  accent_color text,
  logo_size text NOT NULL DEFAULT 'md',
  -- Limit sprzedazowy. NULL = bez limitu (patron medialny, wystawcy).
  max_companies integer,
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_sponsor_tiers_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,48}$'),
  CONSTRAINT event_sponsor_tiers_name_pl_len CHECK (char_length(btrim(name_pl)) BETWEEN 2 AND 80),
  CONSTRAINT event_sponsor_tiers_name_en_len CHECK (char_length(btrim(name_en)) BETWEEN 2 AND 80),
  CONSTRAINT event_sponsor_tiers_desc_pl_len CHECK (char_length(description_pl) <= 1000),
  CONSTRAINT event_sponsor_tiers_desc_en_len CHECK (char_length(description_en) <= 1000),
  -- Gorna granica rangi to 1000: wyzsza liczba znaczy pomylke (rok, cena
  -- pakietu wpisana w pole rangi), a nie realny poziom w hierarchii.
  CONSTRAINT event_sponsor_tiers_rank_range CHECK (rank BETWEEN 0 AND 1000),
  -- Kolor jedzie do CSS jako zmienna, wiec musi byc literalem heksadecymalnym
  -- (wzorzec `event_types.accent_color` z 20260823120000).
  CONSTRAINT event_sponsor_tiers_accent_hex
    CHECK (accent_color IS NULL OR accent_color ~ '^#[0-9a-fA-F]{6}$'),
  CONSTRAINT event_sponsor_tiers_logo_size_values CHECK (logo_size IN ('sm', 'md', 'lg')),
  CONSTRAINT event_sponsor_tiers_max_companies_positive
    CHECK (max_companies IS NULL OR max_companies > 0),
  CONSTRAINT event_sponsor_tiers_tenant_id_key UNIQUE (tenant_id, id),
  -- Tozsamosc w granicach najemcy I WYDARZENIA - cel klucza obcego potrojnego
  -- ze swiadczen i z przypiec, ktory wymusza "poziom z tego samego wydarzenia".
  CONSTRAINT event_sponsor_tiers_tenant_event_id_key UNIQUE (tenant_id, event_id, id),
  CONSTRAINT event_sponsor_tiers_event_key_unique UNIQUE (tenant_id, event_id, key),
  CONSTRAINT event_sponsor_tiers_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_sponsor_tiers IS
  'Poziomy sponsorskie jednego wydarzenia. Zapis wylacznie przez admin_event_sponsor_tier_save; klucz jest niezmienny po zapisie.';
COMMENT ON COLUMN public.event_sponsor_tiers.rank IS
  'Wysokosc w hierarchii handlowej (wyzsza liczba = wyzszy poziom). Steruje kolejnoscia grup na stronie publicznej. Rowna ranga dwoch poziomow jest dozwolona - rozstrzyga wtedy sort_order.';
COMMENT ON COLUMN public.event_sponsor_tiers.max_companies IS
  'Limit sprzedazowy poziomu. Egzekwowany blokada wiersza w admin_event_sponsor_save; liczy WSZYSTKIE przypiecia, takze nieopublikowane - miejsce jest sprzedane w chwili przypiecia.';
COMMENT ON COLUMN public.event_sponsor_tiers.logo_size IS
  'Rozmiar logotypu sprzedany razem z pakietem: sm / md / lg. Te same trzy wartosci co SponsorTierSize w src/lib/events/sponsors.ts.';
COMMENT ON COLUMN public.event_sponsor_tiers.is_active IS
  'Wylaczony poziom znika z selektu w formularzu przypiecia, ale NIE znika ze strony - grupa logotypow juz opublikowana zostaje (wzorzec event_tracks.is_active).';

-- Lista panelu i publiczna strona pytaja tak samo: po najemcy i wydarzeniu,
-- w kolejnosci hierarchii. Indeks pokrywa oba zapytania.
CREATE INDEX IF NOT EXISTS event_sponsor_tiers_event_rank_idx
  ON public.event_sponsor_tiers (tenant_id, event_id, rank DESC, sort_order, key);

DROP TRIGGER IF EXISTS event_sponsor_tiers_touch_updated_at ON public.event_sponsor_tiers;
CREATE TRIGGER event_sponsor_tiers_touch_updated_at
  BEFORE UPDATE ON public.event_sponsor_tiers
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

GRANT SELECT ON public.event_sponsor_tiers TO anon;
GRANT SELECT ON public.event_sponsor_tiers TO authenticated;
GRANT ALL ON public.event_sponsor_tiers TO service_role;

ALTER TABLE public.event_sponsor_tiers ENABLE ROW LEVEL SECURITY;

-- Plaszczyzna TRESCI: nazwa poziomu jest naglowkiem grupy logotypow na stronie
-- wydarzenia, wiec jest publiczna - ale tylko dla OPUBLIKOWANEGO wydarzenia
-- i tylko w obrebie najemcy z naglowka hosta. Wiazanie idzie przez RODZICA
-- (wzorzec przywrocony migracja 20260814210824).
--
-- BEZ filtra `is_active` - patrz komentarz przy kolumnie: wylaczenie poziomu
-- jest decyzja cennikowa, nie decyzja o ukryciu opublikowanych logotypow.
DROP POLICY IF EXISTS "event_sponsor_tiers_public_read" ON public.event_sponsor_tiers;
CREATE POLICY "event_sponsor_tiers_public_read"
  ON public.event_sponsor_tiers FOR SELECT
  TO anon, authenticated
  USING (
    tenant_id = (SELECT public.public_tenant_id())
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_sponsor_tiers.event_id
        AND e.tenant_id = event_sponsor_tiers.tenant_id
        AND e.status = 'published'
    )
  );

-- Plaszczyzna ADMINISTRACYJNA: staff redakcyjny widzi poziomy takze
-- w wydarzeniach roboczych, ale WYLACZNIE w swoim tenancie domowym.
DROP POLICY IF EXISTS "event_sponsor_tiers_staff_read" ON public.event_sponsor_tiers;
CREATE POLICY "event_sponsor_tiers_staff_read"
  ON public.event_sponsor_tiers FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );
-- Zapis: BRAK polityki klienckiej. Jedyna droga to admin_event_sponsor_tier_save
-- / _delete / admin_event_sponsor_tiers_reorder (SECURITY DEFINER, bramka
-- assert_editor_tenant()).

-- ----------------------------------------------------------------------------
-- 2) SWIADCZENIA POZIOMU
--
-- Pozycja oferty ("logotyp na scianie glownej", "trzy wejsciowki VIP",
-- "wystapienie w sesji plenarnej") jest WIERSZEM, nie elementem tablicy jsonb.
-- Uzasadnienie w naglowku pliku, punkt 7. Zapis jest wsadowy - cala lista
-- poziomu naraz, w jednej transakcji - bo formularz edytuje ja jako calosc.
--
-- Klucz obcy jest POTROJNY, wiec swiadczenie nie moze wskazac poziomu z innego
-- wydarzenia, mimo ze samo trzyma `event_id` w swojej kolumnie.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_sponsor_tier_benefits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  tier_id uuid NOT NULL,
  label_pl text NOT NULL,
  label_en text NOT NULL,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_sponsor_tier_benefits_label_pl_len
    CHECK (char_length(btrim(label_pl)) BETWEEN 1 AND 200),
  CONSTRAINT event_sponsor_tier_benefits_label_en_len
    CHECK (char_length(btrim(label_en)) BETWEEN 1 AND 200),
  CONSTRAINT event_sponsor_tier_benefits_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_sponsor_tier_benefits_tier_fk
    FOREIGN KEY (tenant_id, event_id, tier_id)
    REFERENCES public.event_sponsor_tiers (tenant_id, event_id, id) ON DELETE CASCADE,
  CONSTRAINT event_sponsor_tier_benefits_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_sponsor_tier_benefits IS
  'Swiadczenia jednego poziomu sponsorskiego, pozycja po pozycji, w obu jezykach. Zapis wsadowo przez admin_event_sponsor_tier_save (cala lista poziomu naraz).';

CREATE INDEX IF NOT EXISTS event_sponsor_tier_benefits_tier_idx
  ON public.event_sponsor_tier_benefits (tenant_id, tier_id, sort_order);
CREATE INDEX IF NOT EXISTS event_sponsor_tier_benefits_event_idx
  ON public.event_sponsor_tier_benefits (tenant_id, event_id);

DROP TRIGGER IF EXISTS event_sponsor_tier_benefits_touch_updated_at
  ON public.event_sponsor_tier_benefits;
CREATE TRIGGER event_sponsor_tier_benefits_touch_updated_at
  BEFORE UPDATE ON public.event_sponsor_tier_benefits
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

GRANT SELECT ON public.event_sponsor_tier_benefits TO anon;
GRANT SELECT ON public.event_sponsor_tier_benefits TO authenticated;
GRANT ALL ON public.event_sponsor_tier_benefits TO service_role;

ALTER TABLE public.event_sponsor_tier_benefits ENABLE ROW LEVEL SECURITY;

-- Plaszczyzna TRESCI: swiadczenia sa oferta pokazywana na stronie "Zostan
-- sponsorem", wiec sa publiczne tam, gdzie publiczny jest poziom. Wiazanie
-- idzie przez POZIOM, ktory sam wiaze wydarzenie - dwa poziomy w jednym
-- EXISTS, bo polityka na wnuku nie moze wierzyc wlasnym kolumnom.
DROP POLICY IF EXISTS "event_sponsor_tier_benefits_public_read"
  ON public.event_sponsor_tier_benefits;
CREATE POLICY "event_sponsor_tier_benefits_public_read"
  ON public.event_sponsor_tier_benefits FOR SELECT
  TO anon, authenticated
  USING (
    tenant_id = (SELECT public.public_tenant_id())
    AND EXISTS (
      SELECT 1
      FROM public.event_sponsor_tiers t
      JOIN public.events e
        ON e.id = t.event_id AND e.tenant_id = t.tenant_id
      WHERE t.id = event_sponsor_tier_benefits.tier_id
        AND t.tenant_id = event_sponsor_tier_benefits.tenant_id
        AND e.status = 'published'
    )
  );

DROP POLICY IF EXISTS "event_sponsor_tier_benefits_staff_read"
  ON public.event_sponsor_tier_benefits;
CREATE POLICY "event_sponsor_tier_benefits_staff_read"
  ON public.event_sponsor_tier_benefits FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );
-- Zapis: BRAK polityki klienckiej (admin_event_sponsor_tier_save).

-- ----------------------------------------------------------------------------
-- 3) PRZYPIECIE FIRMY DO WYDARZENIA (sponsor / partner / patron / wystawca)
--
-- To jest tabela, w ktorej mieszka MIGAWKA PREZENTACJI - powod istnienia
-- calego modulu (naglowek pliku, punkty 1-4). Wiersz odpowiada na dwa pytania
-- naraz i dlatego ma dwie grupy kolumn:
--   * KOGO przypieto  -> `company_id` (kartoteka, jedno zrodlo prawdy o firmie);
--   * JAK TO WYGLADALO -> `snapshot_*` (stan pokazany na stronie wydarzenia).
--
-- CZTERY ROLE POKRYWAJA CALY REPERTUAR (doc par. 0.4 i par. 4.5):
--   `sponsor`       - firma z poziomem sponsorskim i swiadczeniami;
--   `partner`       - partner merytoryczny albo instytucjonalny bez pakietu;
--   `media_partner` - patron medialny (wymiana barterowa, nie sprzedaz);
--   `exhibitor`     - wystawca ze stanowiskiem. NIE JEST osobnym rejestrem -
--                     to ta sama firma z kartoteki, tylko z `booth_label`.
--
-- POZIOM JEST WYMAGANY DOPIERO PRZY PUBLIKACJI I TYLKO DLA ROLI `sponsor`
-- (`event_sponsors_published_sponsor_needs_tier`). Konstrukcja jest celowo
-- warunkowa - taka sama jak `events_external_mode_requires_url` z 20260823120000:
--   * wymog bezwarunkowy zmuszalby sprzedaz do zalozenia cennika przed
--     przypieciem pierwszej firmy, czyli odwrotnie niz idzie rozmowa handlowa;
--   * brak wymogu w ogole wypuszczalby na strone sponsora, ktory nie ma grupy,
--     w ktorej moze stanac - publiczny RPC grupuje po poziomie, wiec taki
--     wiersz wpadal by do grupy "bez poziomu" razem z patronami medialnymi.
-- Patron medialny i wystawca poziomu NIE POTRZEBUJA i publikuja sie bez niego.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_sponsors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  company_id uuid NOT NULL,
  tier_id uuid,
  role text NOT NULL DEFAULT 'sponsor',
  -- Numer albo nazwa stanowiska wystawienniczego ("B14", "Foyer / stolik 3").
  booth_label text,
  sort_order integer NOT NULL DEFAULT 100,
  is_published boolean NOT NULL DEFAULT false,
  -- MIGAWKA PREZENTACJI. Kolumny WLASNE, nie wyliczane z kartoteki.
  snapshot_name text NOT NULL,
  snapshot_logo_url text,
  snapshot_description_pl text NOT NULL DEFAULT '',
  snapshot_description_en text NOT NULL DEFAULT '',
  snapshot_website text,
  snapshot_country text,
  -- `crm` = migawka jest kopia kartoteki (rozjazd znaczy "kartoteka poszla
  -- dalej"); `manual` = redaktor swiadomie nadpisal prezentacje (rozjazd jest
  -- zamierzony). Bez tej kolumny oba przypadki wygladaja identycznie.
  snapshot_source text NOT NULL DEFAULT 'crm',
  snapshot_taken_at timestamptz NOT NULL DEFAULT now(),
  -- Notatka wewnetrzna organizatora (ustalenia, numer umowy). NIGDY publiczna.
  internal_note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_sponsors_role_values
    CHECK (role IN ('sponsor', 'partner', 'media_partner', 'exhibitor')),
  CONSTRAINT event_sponsors_snapshot_source_values
    CHECK (snapshot_source IN ('crm', 'manual')),
  -- Gorna granica z walidatora kartoteki (`crm-companies.functions.ts`:
  -- name max 200, country max 120), zeby kopia z CRM nigdy nie odbila sie
  -- od CHECK-a migawki.
  CONSTRAINT event_sponsors_snapshot_name_len
    CHECK (char_length(btrim(snapshot_name)) BETWEEN 1 AND 200),
  CONSTRAINT event_sponsors_snapshot_country_len
    CHECK (snapshot_country IS NULL OR char_length(btrim(snapshot_country)) BETWEEN 2 AND 120),
  CONSTRAINT event_sponsors_snapshot_desc_pl_len
    CHECK (char_length(snapshot_description_pl) <= 2000),
  CONSTRAINT event_sponsors_snapshot_desc_en_len
    CHECK (char_length(snapshot_description_en) <= 2000),
  -- Adres logotypu jedzie do atrybutu src. Dopuszczamy sciezke wzgledna
  -- (logotyp wgrany do naszego magazynu jest podawany jako `/storage/...`)
  -- oraz oba schematy http, bo kartoteka trzyma to, co wpisal handlowiec,
  -- a odbicie sie od CHECK-a przy odswiezeniu migawki byloby awaria panelu.
  CONSTRAINT event_sponsors_snapshot_logo_shape
    CHECK (snapshot_logo_url IS NULL OR snapshot_logo_url ~ '^(https?://|/)'),
  CONSTRAINT event_sponsors_snapshot_website_shape
    CHECK (
      snapshot_website IS NULL
      OR (snapshot_website ~ '^https?://' AND char_length(snapshot_website) <= 500)
    ),
  CONSTRAINT event_sponsors_booth_label_len
    CHECK (booth_label IS NULL OR char_length(btrim(booth_label)) BETWEEN 1 AND 40),
  CONSTRAINT event_sponsors_internal_note_len
    CHECK (internal_note IS NULL OR char_length(internal_note) <= 2000),
  -- Opublikowany SPONSOR musi miec poziom - inaczej nie ma grupy, w ktorej
  -- staje na stronie. Partner, patron medialny i wystawca poziomu nie wymagaja.
  CONSTRAINT event_sponsors_published_sponsor_needs_tier
    CHECK (is_published = false OR role <> 'sponsor' OR tier_id IS NOT NULL),
  -- Jedna firma jest przypieta do wydarzenia RAZ. Dwa wiersze tej samej firmy
  -- to dwa logotypy pod jednym naglowkiem, nie dwie role.
  CONSTRAINT event_sponsors_event_company_unique UNIQUE (tenant_id, event_id, company_id),
  CONSTRAINT event_sponsors_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_sponsors_tenant_event_id_key UNIQUE (tenant_id, event_id, id),
  CONSTRAINT event_sponsors_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  -- NO ACTION (domyslne) jest tu decyzja, nie przeoczeniem - patrz naglowek
  -- pliku, punkt 6. Firma, ktora sponsorowala wydarzenie, nie kasuje sie
  -- z kartoteki, bo przypiecie jest dokumentem.
  CONSTRAINT event_sponsors_company_fk FOREIGN KEY (tenant_id, company_id)
    REFERENCES public.crm_companies (tenant_id, id),
  -- Klucz POTROJNY: poziom musi nalezec do TEGO SAMEGO wydarzenia. MATCH
  -- SIMPLE (domyslne) przepuszcza wiersz z `tier_id IS NULL`, czyli dokladnie
  -- przypiecie bez poziomu.
  CONSTRAINT event_sponsors_tier_fk FOREIGN KEY (tenant_id, event_id, tier_id)
    REFERENCES public.event_sponsor_tiers (tenant_id, event_id, id)
);

COMMENT ON TABLE public.event_sponsors IS
  'Przypiecie firmy z kartoteki (crm_companies) do wydarzenia razem z MIGAWKA prezentacji. Zapis wylacznie przez admin_event_sponsor_save; migawka odswiezana jawnie przez admin_event_sponsor_snapshot_refresh.';
COMMENT ON COLUMN public.event_sponsors.company_id IS
  'Firma w kartotece. Jedno zrodlo prawdy o firmie - modul NIE tworzy drugiego rejestru. Usuniecie firmy uzytej tutaj jest odrzucane (NO ACTION), bo przypiecie jest dokumentem sponsoringu.';
COMMENT ON COLUMN public.event_sponsors.snapshot_name IS
  'Nazwa POKAZANA na stronie wydarzenia. Kolumna wlasna, nie odczyt z kartoteki: strona archiwalna ma pokazywac stan z dnia wydarzenia, a nie biezaca nazwe po przebrandowaniu.';
COMMENT ON COLUMN public.event_sponsors.snapshot_description_pl IS
  'Opis REDAKCYJNY sponsora. Kartoteka nie ma zrodla opisu (i nie bedzie miec - doc par. 4.5), wiec odswiezenie migawki tego pola NIGDY nie nadpisuje.';
COMMENT ON COLUMN public.event_sponsors.snapshot_description_en IS
  'Opis redakcyjny w wersji angielskiej. Jak snapshot_description_pl: powstaje w panelu wydarzenia, odswiezenie migawki go nie rusza.';
COMMENT ON COLUMN public.event_sponsors.snapshot_source IS
  'Skad wzieta jest migawka: crm (kopia kartoteki - roznica znaczy rozjazd) albo manual (swiadome nadpisanie - roznica jest zamierzona).';
COMMENT ON COLUMN public.event_sponsors.snapshot_taken_at IS
  'Kiedy migawka byla ostatnio zapisana. Odpowiada na pytanie "z ktorego dnia jest ten logotyp", ktorego rozjazd sam nie tlumaczy.';
COMMENT ON COLUMN public.event_sponsors.booth_label IS
  'Numer albo nazwa stanowiska wystawienniczego. Wolny tekst, bo numeracja hali nalezy do obiektu, nie do naszego schematu.';
COMMENT ON COLUMN public.event_sponsors.internal_note IS
  'Notatka wewnetrzna organizatora. NIE wychodzi zadnym publicznym RPC ani zadna polityka publiczna.';

-- Lista panelu i publiczna strona pytaja po najemcy i wydarzeniu.
CREATE INDEX IF NOT EXISTS event_sponsors_event_order_idx
  ON public.event_sponsors (tenant_id, event_id, sort_order, id);
-- Grupowanie po poziomie: publiczny RPC i licznik zajetych miejsc.
CREATE INDEX IF NOT EXISTS event_sponsors_tier_idx
  ON public.event_sponsors (tenant_id, tier_id, sort_order)
  WHERE tier_id IS NOT NULL;
-- Publiczna strona czyta WYLACZNIE opublikowane - indeks czesciowy trzyma
-- ten zbior maly niezaleznie od liczby przygotowywanych przypiec.
CREATE INDEX IF NOT EXISTS event_sponsors_published_idx
  ON public.event_sponsors (tenant_id, event_id, sort_order)
  WHERE is_published;
-- "Na ilu naszych wydarzeniach byla ta firma" - pytanie, ktorego tresc widgetu
-- nie umiala zadac wcale. Zasila plakietke w wyszukiwarce firm.
CREATE INDEX IF NOT EXISTS event_sponsors_company_idx
  ON public.event_sponsors (tenant_id, company_id);

DROP TRIGGER IF EXISTS event_sponsors_touch_updated_at ON public.event_sponsors;
CREATE TRIGGER event_sponsors_touch_updated_at
  BEFORE UPDATE ON public.event_sponsors
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

-- Granty kolumnowe zamiast tabelowych - patrz blok GRANT SELECT (...) ponizej
-- polityk. `internal_note` i `created_by` nie wychodza klientowi.
GRANT ALL ON public.event_sponsors TO service_role;

ALTER TABLE public.event_sponsors ENABLE ROW LEVEL SECURITY;

-- Plaszczyzna TRESCI: logotyp jest publiczny, gdy PRZYPIECIE jest opublikowane
-- I wydarzenie jest opublikowane. Dwa warunki, bo publikacja logotypu jest
-- decyzja niezalezna od publikacji wydarzenia (sponsor moze dojsc pozniej).
--
-- UWAGA: polityka nie odsiewa `internal_note`. Kolumna jest odcieta od
-- klienckiego SELECT-a grantem kolumnowym ponizej, wzorcem `events.join_url`
-- z 20260713093000 - polityka wierszowa nie umie ukryc kolumny.
DROP POLICY IF EXISTS "event_sponsors_public_read" ON public.event_sponsors;
CREATE POLICY "event_sponsors_public_read"
  ON public.event_sponsors FOR SELECT
  TO anon, authenticated
  USING (
    tenant_id = (SELECT public.public_tenant_id())
    AND is_published
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_sponsors.event_id
        AND e.tenant_id = event_sponsors.tenant_id
        AND e.status = 'published'
    )
  );

DROP POLICY IF EXISTS "event_sponsors_staff_read" ON public.event_sponsors;
CREATE POLICY "event_sponsors_staff_read"
  ON public.event_sponsors FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );
-- Zapis: BRAK polityki klienckiej (admin_event_sponsor_save / _delete /
-- _reorder / _set_published / _snapshot_refresh).

-- Notatka wewnetrzna i identyfikator autora wpisu NIE WYCHODZA klientowi.
-- Grant kolumnowy zamiast tabelowego, bo polityka RLS nie umie ukryc KOLUMNY -
-- umie ukryc wiersz (wzorzec `events.join_url` z 20260713093000). Panel czyta
-- je przez `admin_event_sponsor_detail` (SECURITY DEFINER omija grant).
--
-- REVOKE przed GRANT-em jest tu dla IDEMPOTENTNOSCI: gdyby wczesniejszy
-- przebieg (albo recznie nadany przywilej) zostawil grant TABELOWY, sam grant
-- kolumnowy by go nie zdjal, a grant tabelowy przeslania kolumnowy.
REVOKE SELECT ON public.event_sponsors FROM anon;
REVOKE SELECT ON public.event_sponsors FROM authenticated;
GRANT SELECT (
  id, tenant_id, event_id, company_id, tier_id, role, booth_label, sort_order,
  is_published, snapshot_name, snapshot_logo_url, snapshot_description_pl,
  snapshot_description_en, snapshot_website, snapshot_country, snapshot_source,
  snapshot_taken_at, created_at, updated_at
) ON public.event_sponsors TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4) OSOBY KONTAKTOWE SPONSORA NA WYDARZENIU
--
-- Wskazujemy `crm_leads` - JEDYNY rejestr osob kartotecznych w repozytorium
-- (migracja 20260630053403, `company_id` do `crm_companies` od 20260706201356).
-- Drugi rejestr osob dalby dwie karty tego samego czlowieka i dwie historie
-- kontaktu, rozjezdzajace sie po pierwszej zmianie numeru telefonu.
--
-- ROLA JEST WLASNOSCIA WIERSZA KONTAKTU, nie osoby: ta sama osoba jest osoba
-- decyzyjna u jednego sponsora i kontaktem rozliczeniowym u drugiego.
--
-- NIE WYMAGAMY, ZEBY OSOBA NALEZALA DO PRZYPIETEJ FIRMY. Sponsorow obsluguja
-- agencje: kontaktem operacyjnym jest wtedy czlowiek z agencji, a nie z firmy,
-- ktorej logotyp stoi na stronie. Warunek "osoba z tej firmy" wygladalby na
-- porzadek, a w praktyce blokowalby najczestszy uklad. Panel POKAZUJE firme
-- osoby obok nazwiska, wiec rozbieznosc jest widoczna, tylko nie zabroniona.
--
-- MIGAWKI TU NIE MA I NIE POWINNO BYC. Kontakt jest danymi OPERACYJNYMI: nie
-- ma zadnej strony archiwalnej, na ktorej mialby zamarznac, a zamrozony numer
-- telefonu jest gorszy od braku numeru. Dlatego panel czyta dane osoby NA ZYWO
-- z kartoteki, a usuniecie osoby kasuje wiersz kontaktu (`ON DELETE CASCADE`)
-- - dokladnie odwrotnie niz przy firmie, i z dokladnie odwrotnego powodu.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_sponsor_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  sponsor_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'primary',
  sort_order integer NOT NULL DEFAULT 100,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_sponsor_contacts_role_values
    CHECK (role IN ('primary', 'marketing', 'billing', 'onsite')),
  CONSTRAINT event_sponsor_contacts_tenant_id_key UNIQUE (tenant_id, id),
  -- Jedna osoba przy jednym przypieciu RAZ. Dwa wiersze tej samej osoby to dwa
  -- razy ten sam telefon na liscie kontaktow, nie dwie role.
  CONSTRAINT event_sponsor_contacts_unique UNIQUE (tenant_id, sponsor_id, lead_id),
  CONSTRAINT event_sponsor_contacts_sponsor_fk
    FOREIGN KEY (tenant_id, event_id, sponsor_id)
    REFERENCES public.event_sponsors (tenant_id, event_id, id) ON DELETE CASCADE,
  CONSTRAINT event_sponsor_contacts_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_sponsor_contacts_lead_fk FOREIGN KEY (tenant_id, lead_id)
    REFERENCES public.crm_leads (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_sponsor_contacts IS
  'Osoby z kartoteki (crm_leads) obslugujace przypiecie sponsora na tym wydarzeniu. Dane osoby czytane NA ZYWO z kartoteki - migawki tu nie ma swiadomie. Zapis wsadowo przez admin_event_sponsor_contacts_set.';
COMMENT ON COLUMN public.event_sponsor_contacts.role IS
  'Rola przy TYM przypieciu: primary (osoba decyzyjna) / marketing / billing (rozliczenia) / onsite (obsluga na miejscu).';

CREATE INDEX IF NOT EXISTS event_sponsor_contacts_sponsor_idx
  ON public.event_sponsor_contacts (tenant_id, sponsor_id, sort_order);
-- "Przy ktorych sponsorach wystepuje ta osoba" - pytanie zadawane przy scalaniu
-- duplikatow w kartotece i przed wyslaniem korespondencji.
CREATE INDEX IF NOT EXISTS event_sponsor_contacts_lead_idx
  ON public.event_sponsor_contacts (tenant_id, lead_id);
CREATE INDEX IF NOT EXISTS event_sponsor_contacts_event_idx
  ON public.event_sponsor_contacts (tenant_id, event_id);

DROP TRIGGER IF EXISTS event_sponsor_contacts_touch_updated_at ON public.event_sponsor_contacts;
CREATE TRIGGER event_sponsor_contacts_touch_updated_at
  BEFORE UPDATE ON public.event_sponsor_contacts
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

-- ANON NIE DOSTAJE GRANTU. Dane kontaktowe sponsora to dane osobowe czlowieka,
-- ktory sam nigdzie sie nie zapisal - nie ma sciezki, na ktorej powinny wyjsc
-- na strone publiczna, wiec nie ma ani grantu, ani polityki publicznej.
GRANT SELECT ON public.event_sponsor_contacts TO authenticated;
GRANT ALL ON public.event_sponsor_contacts TO service_role;

ALTER TABLE public.event_sponsor_contacts ENABLE ROW LEVEL SECURITY;

-- JEDYNA polityka na tej tabeli: odczyt stafowy w tenancie domowym. Brak
-- polityki publicznej jest tu FUNKCJA, nie luka.
DROP POLICY IF EXISTS "event_sponsor_contacts_staff_read" ON public.event_sponsor_contacts;
CREATE POLICY "event_sponsor_contacts_staff_read"
  ON public.event_sponsor_contacts FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );
-- Zapis: BRAK polityki klienckiej (admin_event_sponsor_contacts_set).

-- ----------------------------------------------------------------------------
-- 5) MATERIALY SPONSORA
--
-- Zasila zakladke "Materialy" na stronie wydarzenia: prezentacja z sesji,
-- katalog produktowy, pakiet logotypow do publikacji, nagranie wystapienia.
--
-- PUBLIKACJA JEST DWUSTOPNIOWA I TO JEST ZAMIERZONE: material wychodzi na
-- strone, gdy `is_published` MA WIERSZ MATERIALU **I** przypiecie sponsora
-- jest opublikowane. Bez drugiego warunku odpiecie sponsora ze strony
-- zostawialoby jego katalog produktowy w zakladce materialow - czyli reklame
-- firmy, ktorej wlasnie nie ma na liscie partnerow.
--
-- `kind` jest ograniczony CHECK-iem, a nie wolnym tekstem, bo od niego zalezy
-- IKONA I ZACHOWANIE odnosnika (pobranie kontra otwarcie w nowej karcie).
-- Wolny tekst dalby "PDF", "pdf", "Pdf" i trzy rozne ikony dla jednej rzeczy.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_sponsor_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  sponsor_id uuid NOT NULL,
  title_pl text NOT NULL,
  title_en text NOT NULL,
  kind text NOT NULL DEFAULT 'document',
  url text NOT NULL,
  sort_order integer NOT NULL DEFAULT 100,
  is_published boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_sponsor_materials_kind_values
    CHECK (kind IN ('document', 'presentation', 'video', 'link', 'logo_pack')),
  CONSTRAINT event_sponsor_materials_title_pl_len
    CHECK (char_length(btrim(title_pl)) BETWEEN 2 AND 160),
  CONSTRAINT event_sponsor_materials_title_en_len
    CHECK (char_length(btrim(title_en)) BETWEEN 2 AND 160),
  -- Adres jedzie do atrybutu href. Sciezka wzgledna jest dopuszczona, bo plik
  -- wgrany do naszego magazynu jest podawany jako `/storage/...`; schemat
  -- inny niz http(s) nie jest (mailto, javascript, data).
  CONSTRAINT event_sponsor_materials_url_shape CHECK (url ~ '^(https?://|/)'),
  CONSTRAINT event_sponsor_materials_url_len CHECK (char_length(url) <= 1000),
  CONSTRAINT event_sponsor_materials_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_sponsor_materials_sponsor_fk
    FOREIGN KEY (tenant_id, event_id, sponsor_id)
    REFERENCES public.event_sponsors (tenant_id, event_id, id) ON DELETE CASCADE,
  CONSTRAINT event_sponsor_materials_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_sponsor_materials IS
  'Materialy sponsora pod zakladke "Materialy" na stronie wydarzenia. Publiczne dopiero gdy material I przypiecie sa opublikowane. Zapis przez admin_event_sponsor_material_save.';
COMMENT ON COLUMN public.event_sponsor_materials.kind IS
  'Rodzaj pozycji: document / presentation / video / link / logo_pack. Steruje ikona i zachowaniem odnosnika, dlatego jest ograniczony CHECK-iem, a nie wolnym tekstem.';
COMMENT ON COLUMN public.event_sponsor_materials.is_published IS
  'Publikacja POZYCJI. Material wychodzi na strone tylko razem z opublikowanym przypieciem sponsora - patrz polityka event_sponsor_materials_public_read.';

CREATE INDEX IF NOT EXISTS event_sponsor_materials_sponsor_idx
  ON public.event_sponsor_materials (tenant_id, sponsor_id, sort_order);
CREATE INDEX IF NOT EXISTS event_sponsor_materials_event_published_idx
  ON public.event_sponsor_materials (tenant_id, event_id, sort_order)
  WHERE is_published;

DROP TRIGGER IF EXISTS event_sponsor_materials_touch_updated_at
  ON public.event_sponsor_materials;
CREATE TRIGGER event_sponsor_materials_touch_updated_at
  BEFORE UPDATE ON public.event_sponsor_materials
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

GRANT SELECT ON public.event_sponsor_materials TO anon;
GRANT SELECT ON public.event_sponsor_materials TO authenticated;
GRANT ALL ON public.event_sponsor_materials TO service_role;

ALTER TABLE public.event_sponsor_materials ENABLE ROW LEVEL SECURITY;

-- Plaszczyzna TRESCI: trzy warunki w jednym EXISTS - material opublikowany,
-- przypiecie opublikowane, wydarzenie opublikowane. Polityka na wnuku nie moze
-- wierzyc wlasnym kolumnom, wiec `event_id` sprawdzamy przez rodzica.
DROP POLICY IF EXISTS "event_sponsor_materials_public_read"
  ON public.event_sponsor_materials;
CREATE POLICY "event_sponsor_materials_public_read"
  ON public.event_sponsor_materials FOR SELECT
  TO anon, authenticated
  USING (
    tenant_id = (SELECT public.public_tenant_id())
    AND is_published
    AND EXISTS (
      SELECT 1
      FROM public.event_sponsors s
      JOIN public.events e
        ON e.id = s.event_id AND e.tenant_id = s.tenant_id
      WHERE s.id = event_sponsor_materials.sponsor_id
        AND s.tenant_id = event_sponsor_materials.tenant_id
        AND s.is_published
        AND e.status = 'published'
    )
  );

DROP POLICY IF EXISTS "event_sponsor_materials_staff_read"
  ON public.event_sponsor_materials;
CREATE POLICY "event_sponsor_materials_staff_read"
  ON public.event_sponsor_materials FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );
-- Zapis: BRAK polityki klienckiej (admin_event_sponsor_material_save / _delete
-- / admin_event_sponsor_materials_reorder).

-- ----------------------------------------------------------------------------
-- 6) PANEL: POZIOMY SPONSORSKIE
--
-- Lista niesie TRZY liczby, bo kazda odpowiada na inne pytanie interfejsu:
--   * `sponsors_count`           - czy przycisk usuniecia poziomu ma sens;
--   * `published_sponsors_count` - ile logotypow z tego poziomu widzi gosc;
--   * `slots_left`               - ile miejsc zostalo do sprzedania (NULL przy
--     poziomie bez limitu; "bez limitu" i "brak miejsc" to dwie rozne
--     odpowiedzi, a zero czyta sie jako druga z nich).
-- Licznik bez tej roli byl by ozdoba; z ta rola jest warunkiem operacji.
--
-- Swiadczenia jada w tym samym wierszu jako `benefits`, bo formularz poziomu
-- i tak potrzebuje ich wszystkich naraz - drugie wywolanie na kazdy poziom
-- dawaloby N+1 zapytan na ekranie, ktory ma szesc wierszy.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_sponsor_tiers_list(uuid);
CREATE FUNCTION public.admin_event_sponsor_tiers_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  key text,
  name_pl text,
  name_en text,
  description_pl text,
  description_en text,
  rank integer,
  accent_color text,
  logo_size text,
  max_companies integer,
  sort_order integer,
  is_active boolean,
  sponsors_count integer,
  published_sponsors_count integer,
  slots_left integer,
  benefits jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  RETURN QUERY
  SELECT
    t.id, t.event_id, t.key, t.name_pl, t.name_en,
    t.description_pl, t.description_en, t.rank, t.accent_color, t.logo_size,
    t.max_companies, t.sort_order, t.is_active,
    COALESCE(u.total, 0)::integer,
    COALESCE(u.published, 0)::integer,
    CASE
      WHEN t.max_companies IS NULL THEN NULL
      ELSE GREATEST(t.max_companies - COALESCE(u.total, 0), 0)
    END::integer,
    COALESCE(b.items, '[]'::jsonb),
    t.created_at, t.updated_at
  FROM public.event_sponsor_tiers t
  LEFT JOIN LATERAL (
    SELECT
      count(*)::integer AS total,
      count(*) FILTER (WHERE s.is_published)::integer AS published
    FROM public.event_sponsors s
    WHERE s.tenant_id = v_tenant AND s.tier_id = t.id
  ) u ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', bn.id,
        'label_pl', bn.label_pl,
        'label_en', bn.label_en,
        'sort_order', bn.sort_order
      ) ORDER BY bn.sort_order, bn.label_pl
    ) AS items
    FROM public.event_sponsor_tier_benefits bn
    WHERE bn.tenant_id = v_tenant AND bn.tier_id = t.id
  ) b ON true
  WHERE t.tenant_id = v_tenant
    AND t.event_id = p_event_id
  ORDER BY t.rank DESC, t.sort_order, t.key;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_tiers_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_tiers_list(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_tiers_list(uuid) IS
  'Poziomy sponsorskie wydarzenia dla panelu: liczniki przypiec, wolne miejsca i swiadczenia w jednym wierszu. Bramka: assert_editor_tenant().';

-- Klucz poziomu jest NIEZMIENNY po zapisie - tak jak `event_types.key`
-- (20260823120000) i `event_tracks.key` (20260823140000). Kotwica
-- `/sponsorzy#diamond` trafia do materialow handlowych i do korespondencji;
-- zmiana klucza zabija oba. W edycji pole jest IGNOROWANE, nie odrzucane,
-- zeby klient mogl odeslac caly wiersz bez filtrowania.
--
-- OBNIZENIE LIMITU PONIZEJ LICZBY PRZYPIEC JEST ODRZUCANE. Inaczej poziom
-- wchodzi w stan, ktorego nie da sie naprawic zadna operacja na poziomie:
-- limit mowi 3, przypiec jest 5, a `slots_left` pokazuje 0 - czyli komunikat
-- "brak miejsc" zamiast prawdy "dwa miejsca nadpisane".
DROP FUNCTION IF EXISTS public.admin_event_sponsor_tier_save(jsonb);
CREATE FUNCTION public.admin_event_sponsor_tier_save(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_key text := lower(btrim(COALESCE(p_payload->>'key', '')));
  v_name_pl text := btrim(COALESCE(p_payload->>'name_pl', ''));
  v_name_en text := btrim(COALESCE(p_payload->>'name_en', ''));
  v_max integer;
  v_used integer;
BEGIN
  IF v_name_pl = '' OR v_name_en = '' THEN
    RAISE EXCEPTION 'invalid_names: both names are required';
  END IF;

  IF v_id IS NOT NULL THEN
    SELECT t.event_id INTO v_event_id
    FROM public.event_sponsor_tiers t
    WHERE t.id = v_id AND t.tenant_id = v_tenant;

    IF v_event_id IS NULL THEN
      RAISE EXCEPTION 'not_found: sponsorship tier does not exist in this tenant';
    END IF;

    IF p_payload ? 'max_companies' THEN
      v_max := (NULLIF(p_payload->>'max_companies', ''))::integer;

      IF v_max IS NOT NULL THEN
        SELECT count(*)::integer INTO v_used
        FROM public.event_sponsors s
        WHERE s.tenant_id = v_tenant AND s.tier_id = v_id;

        IF v_used > v_max THEN
          RAISE EXCEPTION
            'tier_over_capacity: % company(ies) already pinned, limit % is lower',
            v_used, v_max;
        END IF;
      END IF;
    END IF;

    UPDATE public.event_sponsor_tiers SET
      name_pl = v_name_pl,
      name_en = v_name_en,
      description_pl = COALESCE(btrim(p_payload->>'description_pl'), description_pl),
      description_en = COALESCE(btrim(p_payload->>'description_en'), description_en),
      rank = COALESCE((NULLIF(p_payload->>'rank', ''))::integer, rank),
      accent_color = CASE
        WHEN p_payload ? 'accent_color'
          THEN NULLIF(btrim(COALESCE(p_payload->>'accent_color', '')), '')
        ELSE accent_color
      END,
      logo_size = COALESCE(NULLIF(p_payload->>'logo_size', ''), logo_size),
      max_companies = CASE
        WHEN p_payload ? 'max_companies'
          THEN (NULLIF(p_payload->>'max_companies', ''))::integer
        ELSE max_companies
      END,
      sort_order = COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, sort_order),
      is_active = COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, is_active)
    WHERE id = v_id AND tenant_id = v_tenant;
  ELSE
    IF v_event_id IS NULL THEN
      RAISE EXCEPTION 'invalid_event: event_id is required';
    END IF;

    IF v_key !~ '^[a-z][a-z0-9_]{1,48}$' THEN
      RAISE EXCEPTION 'invalid_key: key must match ^[a-z][a-z0-9_]{1,48}$';
    END IF;

    -- Wydarzenie MUSI nalezec do tenanta wolajacego. Klucz obcy zlozony
    -- odrzucilby obce id sam, ale wtedy panel dostaje `23503` bez wskazania
    -- pola - a redaktor nie ma jak zgadnac, ze chodzi o wydarzenie.
    IF NOT EXISTS (
      SELECT 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant
    ) THEN
      RAISE EXCEPTION 'not_found: event does not exist in this tenant';
    END IF;

    INSERT INTO public.event_sponsor_tiers (
      tenant_id, event_id, key, name_pl, name_en, description_pl, description_en,
      rank, accent_color, logo_size, max_companies, sort_order, is_active
    ) VALUES (
      v_tenant, v_event_id, v_key, v_name_pl, v_name_en,
      COALESCE(btrim(p_payload->>'description_pl'), ''),
      COALESCE(btrim(p_payload->>'description_en'), ''),
      COALESCE((NULLIF(p_payload->>'rank', ''))::integer, 0),
      NULLIF(btrim(COALESCE(p_payload->>'accent_color', '')), ''),
      COALESCE(NULLIF(p_payload->>'logo_size', ''), 'md'),
      (NULLIF(p_payload->>'max_companies', ''))::integer,
      COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, 100),
      COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, true)
    )
    RETURNING id INTO v_id;
  END IF;

  -- SWIADCZENIA: PELNA PODMIANA, ale tylko gdy klient je przyslal. Brak klucza
  -- `benefits` w payloadzie oznacza "nie dotykaj listy" - inaczej zapis samej
  -- nazwy poziomu z formularza, ktory swiadczen nie edytuje, kasowalby je
  -- wszystkie. Podmiana zamiast diffu, bo wiersz swiadczenia nie jest przez nic
  -- wskazywany, wiec nowe identyfikatory nikogo nie osieroca.
  -- COALESCE zamiast golego porownania: brak klucza daje `jsonb_typeof(NULL)`
  -- = NULL, a warunek NULL jest w IF falszem tylko przez przypadek. Tutaj
  -- "brak klucza = nie dotykaj listy" jest KONTRAKTEM, wiec musi byc napisane.
  IF COALESCE(jsonb_typeof(p_payload->'benefits') = 'array', false) THEN
    DELETE FROM public.event_sponsor_tier_benefits b
    WHERE b.tenant_id = v_tenant AND b.tier_id = v_id;

    INSERT INTO public.event_sponsor_tier_benefits (
      tenant_id, event_id, tier_id, label_pl, label_en, sort_order
    )
    SELECT
      v_tenant,
      v_event_id,
      v_id,
      btrim(x->>'label_pl'),
      btrim(x->>'label_en'),
      COALESCE((NULLIF(x->>'sort_order', ''))::integer, (ord * 10)::integer)
    FROM jsonb_array_elements(p_payload->'benefits') WITH ORDINALITY AS t(x, ord)
    WHERE btrim(COALESCE(x->>'label_pl', '')) <> ''
      AND btrim(COALESCE(x->>'label_en', '')) <> '';
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_tier_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_tier_save(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_tier_save(jsonb) IS
  'Dodanie albo edycja poziomu sponsorskiego razem ze swiadczeniami (klucz "benefits" = pelna podmiana listy; brak klucza = lista nietknieta). Klucz poziomu jest niezmienny po zapisie. Bramka: assert_editor_tenant().';

-- Usuniecie poziomu z przypietymi firmami jest odrzucane W RPC, zeby panel
-- dostal LICZBE zamiast kodu `23503` z klucza obcego. Alternatywa (odpiecie
-- firm przy usunieciu poziomu) po cichu zdejmowalaby logotypy ze strony -
-- a decyzja "te cztery firmy nie maja juz poziomu" nalezy do organizatora,
-- nie do przycisku usuwania. Swiadczenia poziomu ida kaskada.
DROP FUNCTION IF EXISTS public.admin_event_sponsor_tier_delete(uuid);
CREATE FUNCTION public.admin_event_sponsor_tier_delete(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_used integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.event_sponsor_tiers t
    WHERE t.id = _id AND t.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: sponsorship tier does not exist in this tenant';
  END IF;

  SELECT count(*)::integer INTO v_used
  FROM public.event_sponsors s
  WHERE s.tenant_id = v_tenant AND s.tier_id = _id;

  IF v_used > 0 THEN
    RAISE EXCEPTION 'tier_in_use: % company(ies) still pinned to this tier', v_used;
  END IF;

  DELETE FROM public.event_sponsor_tiers WHERE id = _id AND tenant_id = v_tenant;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_tier_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_tier_delete(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_tier_delete(uuid) IS
  'Usuwa poziom sponsorski, do ktorego nie jest przypieta zadna firma. Poziom w uzyciu jest odrzucany bledem tier_in_use z liczba firm. Swiadczenia ida kaskada.';

-- Przeciagniecie poziomu w liscie zmienia kolejnosc CALEJ kolumny, a czesto
-- takze HIERARCHIE (przeciagniecie Zlotego nad Diamond to zmiana rangi, nie
-- tylko kolejnosci wyswietlania). Dlatego jedno wywolanie przyjmuje OBA pola
-- i przestawia to, ktore klient przyslal - N wywolan dawaloby N transakcji,
-- z ktorych czesc moze sie nie udac, a cennik zostaje w stanie, ktorego nikt
-- nie zamawial.
DROP FUNCTION IF EXISTS public.admin_event_sponsor_tiers_reorder(jsonb);
CREATE FUNCTION public.admin_event_sponsor_tiers_reorder(p_payload jsonb)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_moved integer;
BEGIN
  IF jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_payload: items must be an array of {id, sort_order, rank}';
  END IF;

  UPDATE public.event_sponsor_tiers t
  SET sort_order = COALESCE(i.sort_order, t.sort_order),
      rank = COALESCE(i.rank, t.rank)
  FROM (
    SELECT
      (x->>'id')::uuid AS id,
      (NULLIF(x->>'sort_order', ''))::integer AS sort_order,
      (NULLIF(x->>'rank', ''))::integer AS rank
    FROM jsonb_array_elements(p_payload->'items') AS x
    WHERE NULLIF(x->>'id', '') IS NOT NULL
  ) i
  WHERE t.id = i.id
    AND t.tenant_id = v_tenant
    AND (
      t.sort_order IS DISTINCT FROM COALESCE(i.sort_order, t.sort_order)
      OR t.rank IS DISTINCT FROM COALESCE(i.rank, t.rank)
    );

  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RETURN v_moved;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_tiers_reorder(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_tiers_reorder(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_tiers_reorder(jsonb) IS
  'Wsadowa zmiana kolejnosci i rangi poziomow: {"items":[{"id":uuid,"sort_order":int,"rank":int}]}. Pole nieobecne w pozycji zostaje bez zmian. Zwraca liczbe przestawionych wierszy.';

-- ----------------------------------------------------------------------------
-- 7) NORMALIZACJA ADRESU STRONY FIRMY
--
-- Kartoteka trzyma `website` jako WOLNY TEKST (walidator
-- `src/lib/crm-companies.functions.ts` sprawdza tylko dlugosc), wiec realnie
-- spotykamy "example.com", "www.example.com" i "https://example.com" w jednej
-- kolumnie. Adres bez schematu wstawiony do atrybutu href jest sciezka
-- WZGLEDNA - przegladarka zamienia go na `/wydarzenia/example.com`. Domkniecie
-- schematu musi wiec zdarzyc sie RAZ i W JEDNYM MIEJSCU, bo ta sama funkcja
-- odpowiada za dwie rzeczy naraz:
--   * wartosc zapisana do migawki przy przypieciu i przy odswiezeniu,
--   * wartosc porownywana z migawka przy liczeniu rozjazdu.
-- Dwie kopie tej logiki dalyby rozjazd zglaszany wiecznie: migawka "https://x",
-- kartoteka "x", roznica na zawsze.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._event_sponsor_web_url(text);
CREATE FUNCTION public._event_sponsor_web_url(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_raw IS NULL OR btrim(p_raw) = '' THEN NULL
    WHEN btrim(p_raw) ~ '^https?://' THEN left(btrim(p_raw), 500)
    ELSE left('https://' || btrim(p_raw), 500)
  END;
$$;

REVOKE ALL ON FUNCTION public._event_sponsor_web_url(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_sponsor_web_url(text) TO service_role;

COMMENT ON FUNCTION public._event_sponsor_web_url(text) IS
  'Domyka schemat adresu strony firmy z kartoteki (wolny tekst) do postaci nadajacej sie do atrybutu href. JEDNO zrodlo tej logiki dla zapisu migawki i dla liczenia rozjazdu.';

-- ----------------------------------------------------------------------------
-- 8) PANEL: LISTA SPONSOROW WYDARZENIA
--
-- ROZJAZD MIGAWKI JEST TU WYLICZANY, NIE CZYTANY Z KOLUMNY (naglowek pliku,
-- punkt 3). `crm_drift_fields` mowi KTORE pola sie roznia, bo komunikat "dane
-- sie rozjechaly" bez wskazania pola zmusza redaktora do otwarcia dwoch kart
-- i porownania ich wzrokiem. Porownanie idzie po `btrim`, zeby ogon spacji nie
-- produkowal falszywego alarmu, i po `_event_sponsor_web_url()`, zeby adres bez
-- schematu nie rozjezdzal sie z wlasna znormalizowana kopia.
--
-- ZLACZENIE Z KARTOTEKA JEST WEWNETRZNE (JOIN, nie LEFT JOIN) I NIE MOZE ZGUBIC
-- WIERSZA. Klucz obcy zlozony `(tenant_id, company_id)` gwarantuje istnienie
-- firmy w tym samym najemcy, a NO ACTION gwarantuje, ze nie da sie jej usunac
-- spod przypiecia. LEFT JOIN sugerowalby, ze wiersz bez firmy jest mozliwy -
-- i kazalby pisac obsluge stanu, ktory schemat wyklucza.
--
-- `total_count` jedzie w KAZDYM wierszu jako funkcja okna - wzorzec
-- `admin_events_list` z 20260823130000. Bez niej paginacja wymaga drugiego
-- zapytania z tym samym filtrem, a dwa zapytania rozjezdzaja sie przy kazdym
-- zapisie miedzy nimi.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_sponsors_list(uuid, uuid, text, text, text, integer, integer);
CREATE FUNCTION public.admin_event_sponsors_list(
  p_event_id uuid,
  p_tier_id uuid DEFAULT NULL,
  p_role text DEFAULT NULL,
  p_published text DEFAULT NULL,
  p_q text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  company_id uuid,
  tier_id uuid,
  tier_key text,
  tier_name_pl text,
  tier_name_en text,
  tier_rank integer,
  tier_accent_color text,
  tier_logo_size text,
  role text,
  booth_label text,
  sort_order integer,
  is_published boolean,
  snapshot_name text,
  snapshot_logo_url text,
  snapshot_description_pl text,
  snapshot_description_en text,
  snapshot_website text,
  snapshot_country text,
  snapshot_source text,
  snapshot_taken_at timestamptz,
  crm_name text,
  crm_logo_url text,
  crm_website text,
  crm_country text,
  crm_city text,
  crm_drift boolean,
  crm_drift_fields text[],
  contacts_count integer,
  materials_count integer,
  published_materials_count integer,
  created_at timestamptz,
  updated_at timestamptz,
  total_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_q text := NULLIF(btrim(COALESCE(p_q, '')), '');
BEGIN
  RETURN QUERY
  SELECT
    s.id, s.event_id, s.company_id, s.tier_id,
    t.key, t.name_pl, t.name_en, t.rank, t.accent_color, t.logo_size,
    s.role, s.booth_label, s.sort_order, s.is_published,
    s.snapshot_name, s.snapshot_logo_url,
    s.snapshot_description_pl, s.snapshot_description_en,
    s.snapshot_website, s.snapshot_country,
    s.snapshot_source, s.snapshot_taken_at,
    c.name, c.logo_url, public._event_sponsor_web_url(c.website), c.country, c.city,
    (cardinality(d.fields) > 0),
    d.fields,
    COALESCE(k.contacts, 0)::integer,
    COALESCE(m.total, 0)::integer,
    COALESCE(m.published, 0)::integer,
    s.created_at, s.updated_at,
    count(*) OVER ()::integer
  FROM public.event_sponsors s
  JOIN public.crm_companies c
    ON c.id = s.company_id AND c.tenant_id = s.tenant_id
  LEFT JOIN public.event_sponsor_tiers t
    ON t.id = s.tier_id AND t.tenant_id = s.tenant_id
  CROSS JOIN LATERAL (
    SELECT array_remove(ARRAY[
      CASE
        WHEN btrim(s.snapshot_name) IS DISTINCT FROM btrim(c.name) THEN 'name'
      END,
      CASE
        WHEN btrim(COALESCE(s.snapshot_logo_url, ''))
             IS DISTINCT FROM btrim(COALESCE(c.logo_url, '')) THEN 'logo_url'
      END,
      CASE
        WHEN COALESCE(s.snapshot_website, '')
             IS DISTINCT FROM COALESCE(public._event_sponsor_web_url(c.website), '')
          THEN 'website'
      END,
      CASE
        WHEN btrim(COALESCE(s.snapshot_country, ''))
             IS DISTINCT FROM btrim(COALESCE(c.country, '')) THEN 'country'
      END
    ]::text[], NULL) AS fields
  ) d
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS contacts
    FROM public.event_sponsor_contacts k0
    WHERE k0.tenant_id = v_tenant AND k0.sponsor_id = s.id
  ) k ON true
  LEFT JOIN LATERAL (
    SELECT
      count(*)::integer AS total,
      count(*) FILTER (WHERE m0.is_published)::integer AS published
    FROM public.event_sponsor_materials m0
    WHERE m0.tenant_id = v_tenant AND m0.sponsor_id = s.id
  ) m ON true
  WHERE s.tenant_id = v_tenant
    AND s.event_id = p_event_id
    AND (p_tier_id IS NULL OR s.tier_id = p_tier_id)
    AND (p_role IS NULL OR p_role = 'all' OR s.role = p_role)
    AND (
      p_published IS NULL OR p_published = 'all'
      OR (p_published = 'published' AND s.is_published)
      OR (p_published = 'draft' AND NOT s.is_published)
    )
    AND (
      v_q IS NULL
      OR s.snapshot_name ILIKE '%' || v_q || '%'
      OR c.name ILIKE '%' || v_q || '%'
      OR s.booth_label ILIKE '%' || v_q || '%'
    )
  ORDER BY t.rank DESC NULLS LAST, s.sort_order, s.snapshot_name
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsors_list(uuid, uuid, text, text, text, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsors_list(uuid, uuid, text, text, text, integer, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsors_list(uuid, uuid, text, text, text, integer, integer) IS
  'Lista sponsorow wydarzenia dla panelu: nazwa i ranga poziomu, status publikacji, biezace wartosci z kartoteki i WYLICZONY rozjazd migawki (crm_drift + crm_drift_fields). Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- 9) PANEL: JEDNO PRZYPIECIE DO FORMULARZA
--
-- Osobna funkcja od listy, bo formularz potrzebuje trzech rzeczy, ktorych lista
-- nie oddaje: notatki wewnetrznej (odcietej od klienckiego SELECT-a grantem
-- kolumnowym), OSOB KONTAKTOWYCH z danymi na zywo z kartoteki i MATERIALOW.
-- Wciagniecie tego do listy oznaczaloby, ze ekran z pietnastoma sponsorami
-- pobiera pietnascie razy wiecej danych osobowych, niz pokazuje.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_sponsor_detail(uuid);
CREATE FUNCTION public.admin_event_sponsor_detail(_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  company_id uuid,
  tier_id uuid,
  tier_key text,
  tier_name_pl text,
  tier_name_en text,
  tier_rank integer,
  role text,
  booth_label text,
  sort_order integer,
  is_published boolean,
  snapshot_name text,
  snapshot_logo_url text,
  snapshot_description_pl text,
  snapshot_description_en text,
  snapshot_website text,
  snapshot_country text,
  snapshot_source text,
  snapshot_taken_at timestamptz,
  internal_note text,
  crm_name text,
  crm_logo_url text,
  crm_website text,
  crm_country text,
  crm_city text,
  crm_domain text,
  crm_drift_fields text[],
  contacts jsonb,
  materials jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  RETURN QUERY
  SELECT
    s.id, s.event_id, s.company_id, s.tier_id,
    t.key, t.name_pl, t.name_en, t.rank,
    s.role, s.booth_label, s.sort_order, s.is_published,
    s.snapshot_name, s.snapshot_logo_url,
    s.snapshot_description_pl, s.snapshot_description_en,
    s.snapshot_website, s.snapshot_country,
    s.snapshot_source, s.snapshot_taken_at, s.internal_note,
    c.name, c.logo_url, public._event_sponsor_web_url(c.website),
    c.country, c.city, c.domain,
    array_remove(ARRAY[
      CASE
        WHEN btrim(s.snapshot_name) IS DISTINCT FROM btrim(c.name) THEN 'name'
      END,
      CASE
        WHEN btrim(COALESCE(s.snapshot_logo_url, ''))
             IS DISTINCT FROM btrim(COALESCE(c.logo_url, '')) THEN 'logo_url'
      END,
      CASE
        WHEN COALESCE(s.snapshot_website, '')
             IS DISTINCT FROM COALESCE(public._event_sponsor_web_url(c.website), '')
          THEN 'website'
      END,
      CASE
        WHEN btrim(COALESCE(s.snapshot_country, ''))
             IS DISTINCT FROM btrim(COALESCE(c.country, '')) THEN 'country'
      END
    ]::text[], NULL),
    COALESCE(k.items, '[]'::jsonb),
    COALESCE(m.items, '[]'::jsonb),
    s.created_at, s.updated_at
  FROM public.event_sponsors s
  JOIN public.crm_companies c
    ON c.id = s.company_id AND c.tenant_id = s.tenant_id
  LEFT JOIN public.event_sponsor_tiers t
    ON t.id = s.tier_id AND t.tenant_id = s.tenant_id
  LEFT JOIN LATERAL (
    -- Dane osoby CZYTANE NA ZYWO z kartoteki - kontakt nie ma migawki
    -- swiadomie (patrz komentarz przy tabeli event_sponsor_contacts).
    -- `lead_company_name` pokazuje, czy osoba nalezy do przypietej firmy,
    -- czy do agencji ja obslugujacej - rozbieznosc jest dozwolona i widoczna.
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', k0.id,
        'lead_id', k0.lead_id,
        'role', k0.role,
        'sort_order', k0.sort_order,
        'first_name', l.first_name,
        'last_name', l.last_name,
        'email', l.email,
        'phone', l.phone,
        'position', l.position,
        'lead_company_id', l.company_id,
        'lead_company_name', lc.name
      ) ORDER BY k0.sort_order, l.last_name, l.first_name
    ) AS items
    FROM public.event_sponsor_contacts k0
    JOIN public.crm_leads l
      ON l.id = k0.lead_id AND l.tenant_id = k0.tenant_id
    LEFT JOIN public.crm_companies lc
      ON lc.id = l.company_id AND lc.tenant_id = l.tenant_id
    WHERE k0.tenant_id = v_tenant AND k0.sponsor_id = s.id
  ) k ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', m0.id,
        'title_pl', m0.title_pl,
        'title_en', m0.title_en,
        'kind', m0.kind,
        'url', m0.url,
        'sort_order', m0.sort_order,
        'is_published', m0.is_published
      ) ORDER BY m0.sort_order, m0.title_pl
    ) AS items
    FROM public.event_sponsor_materials m0
    WHERE m0.tenant_id = v_tenant AND m0.sponsor_id = s.id
  ) m ON true
  WHERE s.tenant_id = v_tenant
    AND s.id = _id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_detail(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_detail(uuid) IS
  'Jedno przypiecie sponsora do formularza panelu: migawka, biezaca kartoteka, rozjazd, notatka wewnetrzna, osoby kontaktowe z danymi NA ZYWO i materialy. Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- 10) PANEL: ZAPIS PRZYPIECIA (dodanie i edycja jednym kontraktem)
--
-- MIGAWKA POWSTAJE TUTAJ, W CHWILI PRZYPIECIA. Przy dodaniu bierzemy cztery
-- pola z kartoteki (nazwa, logotyp, adres strony, kraj) i zapisujemy je do
-- kolumn `snapshot_*` z `snapshot_source = 'crm'`. Gdy klient przysyla wlasne
-- wartosci ktoregokolwiek z tych czterech pol, migawka dostaje
-- `snapshot_source = 'manual'` - od tej chwili rozjazd z kartoteka jest
-- ZAMIERZONY i panel ma o tym wiedziec (patrz naglowek pliku, punkt 3).
--
-- OPIS (`snapshot_description_*`) NIGDY nie pochodzi z kartoteki i nie wplywa
-- na `snapshot_source`: kartoteka nie ma zrodla opisu (punkt 4).
--
-- LIMIT POZIOMU SERIALIZUJE SIE BLOKADA WIERSZA POZIOMU, nie odczytem
-- licznika (punkt 5). Blokade bierzemy TYLKO gdy poziom sie zmienia albo gdy
-- wiersz powstaje - przy edycji nazwy stanowiska liczba przypiec na poziomie
-- sie nie zmienia, wiec blokada byla by kolejka bez powodu.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_sponsor_save(jsonb);
CREATE FUNCTION public.admin_event_sponsor_save(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_company_id uuid := NULLIF(p_payload->>'company_id', '')::uuid;
  v_tier_id uuid;
  v_old_tier_id uuid;
  v_role text;
  v_published boolean;
  v_was_published boolean;
  v_manual boolean := (
    p_payload ? 'snapshot_name'
    OR p_payload ? 'snapshot_logo_url'
    OR p_payload ? 'snapshot_website'
    OR p_payload ? 'snapshot_country'
  );
  v_company public.crm_companies;
  v_max integer;
  v_used integer;
BEGIN
  IF v_id IS NULL THEN
    -- ---------------- DODANIE ----------------
    IF v_event_id IS NULL THEN
      RAISE EXCEPTION 'invalid_event: event_id is required';
    END IF;
    IF v_company_id IS NULL THEN
      RAISE EXCEPTION 'invalid_company: company_id is required';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant
    ) THEN
      RAISE EXCEPTION 'not_found: event does not exist in this tenant';
    END IF;

    -- Firma MUSI nalezec do tenanta wolajacego. Klucz obcy zlozony odrzucilby
    -- obce id sam, ale panel dostalby `23503` bez wskazania pola.
    SELECT * INTO v_company
    FROM public.crm_companies c
    WHERE c.id = v_company_id AND c.tenant_id = v_tenant;

    IF v_company.id IS NULL THEN
      RAISE EXCEPTION 'not_found: company does not exist in this tenant';
    END IF;

    v_tier_id := NULLIF(p_payload->>'tier_id', '')::uuid;
    v_role := COALESCE(NULLIF(p_payload->>'role', ''), 'sponsor');
    v_published := COALESCE((NULLIF(p_payload->>'is_published', ''))::boolean, false);

    IF v_published AND v_role = 'sponsor' AND v_tier_id IS NULL THEN
      RAISE EXCEPTION 'sponsor_tier_required: a published sponsor must have a tier';
    END IF;

    IF v_tier_id IS NOT NULL THEN
      SELECT t.max_companies INTO v_max
      FROM public.event_sponsor_tiers t
      WHERE t.id = v_tier_id AND t.tenant_id = v_tenant AND t.event_id = v_event_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found: sponsorship tier does not exist in this event';
      END IF;

      IF v_max IS NOT NULL THEN
        SELECT count(*)::integer INTO v_used
        FROM public.event_sponsors s
        WHERE s.tenant_id = v_tenant AND s.tier_id = v_tier_id;

        IF v_used >= v_max THEN
          RAISE EXCEPTION 'tier_full: tier allows % company(ies), % already pinned',
            v_max, v_used;
        END IF;
      END IF;
    END IF;

    INSERT INTO public.event_sponsors (
      tenant_id, event_id, company_id, tier_id, role, booth_label,
      sort_order, is_published,
      snapshot_name, snapshot_logo_url,
      snapshot_description_pl, snapshot_description_en,
      snapshot_website, snapshot_country,
      snapshot_source, snapshot_taken_at, internal_note, created_by
    ) VALUES (
      v_tenant, v_event_id, v_company_id, v_tier_id, v_role,
      NULLIF(btrim(COALESCE(p_payload->>'booth_label', '')), ''),
      COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, 100),
      v_published,
      COALESCE(NULLIF(btrim(COALESCE(p_payload->>'snapshot_name', '')), ''), v_company.name),
      COALESCE(
        NULLIF(btrim(COALESCE(p_payload->>'snapshot_logo_url', '')), ''),
        NULLIF(btrim(COALESCE(v_company.logo_url, '')), '')
      ),
      COALESCE(btrim(p_payload->>'snapshot_description_pl'), ''),
      COALESCE(btrim(p_payload->>'snapshot_description_en'), ''),
      COALESCE(
        public._event_sponsor_web_url(p_payload->>'snapshot_website'),
        public._event_sponsor_web_url(v_company.website)
      ),
      COALESCE(
        NULLIF(btrim(COALESCE(p_payload->>'snapshot_country', '')), ''),
        NULLIF(btrim(COALESCE(v_company.country, '')), '')
      ),
      CASE WHEN v_manual THEN 'manual' ELSE 'crm' END,
      now(),
      NULLIF(btrim(COALESCE(p_payload->>'internal_note', '')), ''),
      auth.uid()
    )
    RETURNING id INTO v_id;

    IF v_published THEN
      PERFORM public.emit_domain_event(
        v_tenant,
        'event_sponsor',
        v_id::text,
        'event_sponsor.published.v1',
        jsonb_build_object(
          'event_id', v_event_id, 'sponsor_id', v_id, 'company_id', v_company_id
        ),
        auth.uid()
      );
    END IF;

    RETURN v_id;
  END IF;

  -- ---------------- EDYCJA ----------------
  SELECT s.event_id, s.tier_id, s.role, s.is_published, s.company_id
    INTO v_event_id, v_old_tier_id, v_role, v_was_published, v_company_id
  FROM public.event_sponsors s
  WHERE s.id = v_id AND s.tenant_id = v_tenant;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'not_found: sponsor pin does not exist in this tenant';
  END IF;

  -- Firma jest NIEZMIENNA po zapisie. Podmiana firmy pod migawka daje wiersz,
  -- ktory mowi "logotyp firmy A, kartoteka firmy B" - a to nie jest edycja,
  -- tylko nowe przypiecie. Panel usuwa i dodaje.
  v_tier_id := CASE
    WHEN p_payload ? 'tier_id' THEN NULLIF(p_payload->>'tier_id', '')::uuid
    ELSE v_old_tier_id
  END;
  v_role := COALESCE(NULLIF(p_payload->>'role', ''), v_role);
  v_published := COALESCE((NULLIF(p_payload->>'is_published', ''))::boolean, v_was_published);

  IF v_published AND v_role = 'sponsor' AND v_tier_id IS NULL THEN
    RAISE EXCEPTION 'sponsor_tier_required: a published sponsor must have a tier';
  END IF;

  IF v_tier_id IS NOT NULL AND v_tier_id IS DISTINCT FROM v_old_tier_id THEN
    SELECT t.max_companies INTO v_max
    FROM public.event_sponsor_tiers t
    WHERE t.id = v_tier_id AND t.tenant_id = v_tenant AND t.event_id = v_event_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'not_found: sponsorship tier does not exist in this event';
    END IF;

    IF v_max IS NOT NULL THEN
      SELECT count(*)::integer INTO v_used
      FROM public.event_sponsors s
      WHERE s.tenant_id = v_tenant AND s.tier_id = v_tier_id AND s.id <> v_id;

      IF v_used >= v_max THEN
        RAISE EXCEPTION 'tier_full: tier allows % company(ies), % already pinned',
          v_max, v_used;
      END IF;
    END IF;
  END IF;

  UPDATE public.event_sponsors SET
    tier_id = v_tier_id,
    role = v_role,
    is_published = v_published,
    booth_label = CASE
      WHEN p_payload ? 'booth_label'
        THEN NULLIF(btrim(COALESCE(p_payload->>'booth_label', '')), '')
      ELSE booth_label
    END,
    sort_order = COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, sort_order),
    snapshot_name = COALESCE(
      NULLIF(btrim(COALESCE(p_payload->>'snapshot_name', '')), ''), snapshot_name
    ),
    snapshot_logo_url = CASE
      WHEN p_payload ? 'snapshot_logo_url'
        THEN NULLIF(btrim(COALESCE(p_payload->>'snapshot_logo_url', '')), '')
      ELSE snapshot_logo_url
    END,
    snapshot_description_pl = COALESCE(
      btrim(p_payload->>'snapshot_description_pl'), snapshot_description_pl
    ),
    snapshot_description_en = COALESCE(
      btrim(p_payload->>'snapshot_description_en'), snapshot_description_en
    ),
    snapshot_website = CASE
      WHEN p_payload ? 'snapshot_website'
        THEN public._event_sponsor_web_url(p_payload->>'snapshot_website')
      ELSE snapshot_website
    END,
    snapshot_country = CASE
      WHEN p_payload ? 'snapshot_country'
        THEN NULLIF(btrim(COALESCE(p_payload->>'snapshot_country', '')), '')
      ELSE snapshot_country
    END,
    -- Tylko RECZNA zmiana ktoregos z czterech pol kartotecznych przestawia
    -- zrodlo na `manual`. Zmiana samego opisu, poziomu albo kolejnosci
    -- migawki nie dotyka, wiec nie klamie o jej pochodzeniu.
    snapshot_source = CASE WHEN v_manual THEN 'manual' ELSE snapshot_source END,
    snapshot_taken_at = CASE WHEN v_manual THEN now() ELSE snapshot_taken_at END,
    internal_note = CASE
      WHEN p_payload ? 'internal_note'
        THEN NULLIF(btrim(COALESCE(p_payload->>'internal_note', '')), '')
      ELSE internal_note
    END
  WHERE id = v_id AND tenant_id = v_tenant;

  IF v_published IS DISTINCT FROM v_was_published THEN
    PERFORM public.emit_domain_event(
      v_tenant,
      'event_sponsor',
      v_id::text,
      CASE WHEN v_published
        THEN 'event_sponsor.published.v1'
        ELSE 'event_sponsor.unpublished.v1'
      END,
      jsonb_build_object(
        'event_id', v_event_id, 'sponsor_id', v_id, 'company_id', v_company_id
      ),
      auth.uid()
    );
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_save(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_save(jsonb) IS
  'Dodanie albo edycja przypiecia firmy do wydarzenia. Przy dodaniu migawka powstaje z kartoteki; recznie podane pole kartoteczne przestawia snapshot_source na manual. Firma jest niezmienna po zapisie. Limit poziomu egzekwowany blokada wiersza. Bramka: assert_editor_tenant().';

-- Usuniecie przypiecia zabiera ze soba osoby kontaktowe i materialy (kaskada
-- z kluczy potrojnych). Jest to zamierzone: material sponsora bez sponsora nie
-- ma gdzie sie pokazac, a kontakt bez przypiecia nie opisuje niczego. Firma
-- w kartotece ZOSTAJE nietknieta - to ona jest zrodlem prawdy, nie przypiecie.
DROP FUNCTION IF EXISTS public.admin_event_sponsor_delete(uuid);
CREATE FUNCTION public.admin_event_sponsor_delete(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  DELETE FROM public.event_sponsors
  WHERE id = _id AND tenant_id = v_tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: sponsor pin does not exist in this tenant';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_delete(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_delete(uuid) IS
  'Usuwa przypiecie firmy do wydarzenia razem z jego osobami kontaktowymi i materialami (kaskada). Firma w kartotece zostaje nietknieta.';

-- Przeciagniecie jednego logotypu w siatce zmienia kolejnosc CALEJ grupy.
-- Wysylanie tego jako N wywolan daje N transakcji, z ktorych czesc moze sie nie
-- udac - i strona zostaje w kolejnosci, ktorej nikt nie zamawial. Wiersze obce
-- tenantowi sa POMIJANE, a funkcja zwraca liczbe faktycznie przestawionych
-- wierszy, zeby klient mogl porownac ja z dlugoscia swojej listy.
DROP FUNCTION IF EXISTS public.admin_event_sponsors_reorder(jsonb);
CREATE FUNCTION public.admin_event_sponsors_reorder(p_payload jsonb)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_moved integer;
BEGIN
  IF jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_payload: items must be an array of {id, sort_order}';
  END IF;

  UPDATE public.event_sponsors s
  SET sort_order = i.sort_order
  FROM (
    SELECT
      (x->>'id')::uuid AS id,
      (x->>'sort_order')::integer AS sort_order
    FROM jsonb_array_elements(p_payload->'items') AS x
    WHERE NULLIF(x->>'id', '') IS NOT NULL
      AND NULLIF(x->>'sort_order', '') IS NOT NULL
  ) i
  WHERE s.id = i.id
    AND s.tenant_id = v_tenant
    AND s.sort_order IS DISTINCT FROM i.sort_order;

  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RETURN v_moved;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsors_reorder(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsors_reorder(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsors_reorder(jsonb) IS
  'Wsadowa zmiana kolejnosci przypiec: {"items":[{"id":uuid,"sort_order":int}]}. Zwraca liczbe przestawionych wierszy. Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- 11) PANEL: PUBLIKACJA PRZYPIEC WSADOWO
--
-- "Opublikuj wszystkich sponsorow" jest jedna decyzja organizatora, wiec jest
-- jedna transakcja. Sponsorzy bez poziomu SA ODRZUCANI Z LICZBA, a nie po cichu
-- pomijani: cicha zgoda na 12 z 15 wierszy zostawia trzy logotypy poza strona
-- i nikt sie o tym nie dowie do telefonu od sponsora.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_sponsors_set_published(jsonb);
CREATE FUNCTION public.admin_event_sponsors_set_published(p_payload jsonb)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_publish boolean := COALESCE((NULLIF(p_payload->>'is_published', ''))::boolean, true);
  v_blocked integer;
  v_changed integer := 0;
  v_rec record;
BEGIN
  IF jsonb_typeof(p_payload->'ids') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_payload: ids must be an array of uuid';
  END IF;

  IF v_publish THEN
    SELECT count(*)::integer INTO v_blocked
    FROM public.event_sponsors s
    WHERE s.tenant_id = v_tenant
      AND s.role = 'sponsor'
      AND s.tier_id IS NULL
      AND s.id IN (
        SELECT x::uuid
        FROM jsonb_array_elements_text(p_payload->'ids') AS x
        WHERE NULLIF(btrim(x), '') IS NOT NULL
      );

    IF v_blocked > 0 THEN
      RAISE EXCEPTION 'sponsor_tier_required: % sponsor(s) in the selection have no tier',
        v_blocked;
    END IF;
  END IF;

  FOR v_rec IN
    UPDATE public.event_sponsors s
    SET is_published = v_publish
    WHERE s.tenant_id = v_tenant
      AND s.is_published IS DISTINCT FROM v_publish
      AND s.id IN (
        SELECT x::uuid
        FROM jsonb_array_elements_text(p_payload->'ids') AS x
        WHERE NULLIF(btrim(x), '') IS NOT NULL
      )
    RETURNING s.id, s.event_id, s.company_id
  LOOP
    v_changed := v_changed + 1;
    PERFORM public.emit_domain_event(
      v_tenant,
      'event_sponsor',
      v_rec.id::text,
      CASE WHEN v_publish
        THEN 'event_sponsor.published.v1'
        ELSE 'event_sponsor.unpublished.v1'
      END,
      jsonb_build_object(
        'event_id', v_rec.event_id, 'sponsor_id', v_rec.id, 'company_id', v_rec.company_id
      ),
      auth.uid()
    );
  END LOOP;

  RETURN v_changed;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsors_set_published(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsors_set_published(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsors_set_published(jsonb) IS
  'Wsadowa publikacja albo wycofanie przypiec: {"ids":[uuid],"is_published":bool}. Sponsor bez poziomu blokuje calosc bledem sponsor_tier_required. Zwraca liczbe zmienionych wierszy.';

-- ----------------------------------------------------------------------------
-- 12) PANEL: ODSWIEZENIE MIGAWKI Z KARTOTEKI
--
-- DLACZEGO TO NIE JEST TRIGGER (powtarzam, bo to najwazniejsza decyzja tego
-- pliku): trigger na `crm_companies` przepisywalby dziesiatki stron
-- archiwalnych przy jednym zapisie handlowca. Kartoteke edytuje sprzedaz,
-- a strone wydarzenia PODPISUJE organizator - to dwie rozne odpowiedzialnosci
-- i dwa rozne momenty w czasie. Rozjazd jest widoczny i policzalny w liscie
-- panelu, wiec odswiezenie jest decyzja Z PODGLADEM, a nie niespodzianka.
--
-- TRZY WLASNOSCI, KTORE TRZEBA CZYTAC RAZEM
--
--   1) DOTYKA CZTERECH POL (nazwa, logotyp, adres strony, kraj). Opisu NIE
--      DOTYKA NIGDY - kartoteka nie ma zrodla opisu (naglowek pliku, punkt 4).
--
--   2) MIGAWKE NADPISANA RECZNIE POMIJA, dopoki klient nie poprosi wyraznie
--      (`include_manual`). `snapshot_source = 'manual'` znaczy "redaktor
--      swiadomie ustawil inna nazwe albo inny logotyp"; hurtowe odswiezenie
--      wszystkiego skasowalo by te decyzje bez pytania i bez sladu.
--
--   3) AKTUALIZUJE TYLKO WIERSZE, KTORE SIE ROZNIA. Dzieki temu zwracana
--      liczba jest odpowiedzia na pytanie "ile stron sie zmienilo", a nie
--      "ile wierszy przeleciala petla", a `updated_at` nie klamie o edycji,
--      ktora nic nie zmienila. Powtorne wywolanie jest wiec bezczynne.
--
-- Zakres wskazuje klient: `{"ids":[uuid,...]}` (jedno albo kilka przypiec)
-- albo `{"event_id":uuid}` (cale wydarzenie). Firma z pusta nazwa w kartotece
-- jest pomijana - migawka z pusta nazwa odbila by sie od CHECK-a i zamienila
-- porzadkowanie w awarie panelu.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_sponsor_snapshot_refresh(jsonb);
CREATE FUNCTION public.admin_event_sponsor_snapshot_refresh(p_payload jsonb)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  -- COALESCE jest tu KONIECZNY, nie kosmetyczny: brak klucza `ids` daje
  -- `jsonb_typeof(NULL)` = NULL, a NULL w warunku WHERE ponizej odsiewa
  -- KAZDY wiersz - odswiezenie po `event_id` odswiezalo by zero wierszy
  -- i zwracalo zero bez zadnego bledu.
  v_has_ids boolean := COALESCE(jsonb_typeof(p_payload->'ids') = 'array', false);
  v_include_manual boolean :=
    COALESCE((NULLIF(p_payload->>'include_manual', ''))::boolean, false);
  v_changed integer := 0;
  v_rec record;
BEGIN
  IF NOT v_has_ids AND v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: pass ids (array) or event_id';
  END IF;

  FOR v_rec IN
    UPDATE public.event_sponsors s
    SET snapshot_name = btrim(c.name),
        snapshot_logo_url = NULLIF(btrim(COALESCE(c.logo_url, '')), ''),
        snapshot_website = public._event_sponsor_web_url(c.website),
        snapshot_country = NULLIF(btrim(COALESCE(c.country, '')), ''),
        snapshot_source = 'crm',
        snapshot_taken_at = now()
    FROM public.crm_companies c
    WHERE c.id = s.company_id
      AND c.tenant_id = s.tenant_id
      AND s.tenant_id = v_tenant
      AND btrim(c.name) <> ''
      AND (v_include_manual OR s.snapshot_source = 'crm')
      AND (
        (v_has_ids AND s.id IN (
          SELECT x::uuid
          FROM jsonb_array_elements_text(p_payload->'ids') AS x
          WHERE NULLIF(btrim(x), '') IS NOT NULL
        ))
        OR (NOT v_has_ids AND s.event_id = v_event_id)
      )
      -- Tylko realny rozjazd. Warunek jest LUSTREM wyliczenia z listy panelu
      -- (`crm_drift_fields`), wiec "odswiez wszystkie rozjechane" domyka sie
      -- do zera po jednym wywolaniu.
      AND (
        btrim(s.snapshot_name) IS DISTINCT FROM btrim(c.name)
        OR btrim(COALESCE(s.snapshot_logo_url, ''))
           IS DISTINCT FROM btrim(COALESCE(c.logo_url, ''))
        OR COALESCE(s.snapshot_website, '')
           IS DISTINCT FROM COALESCE(public._event_sponsor_web_url(c.website), '')
        OR btrim(COALESCE(s.snapshot_country, ''))
           IS DISTINCT FROM btrim(COALESCE(c.country, ''))
      )
    RETURNING s.id, s.event_id, s.company_id
  LOOP
    v_changed := v_changed + 1;
    PERFORM public.emit_domain_event(
      v_tenant,
      'event_sponsor',
      v_rec.id::text,
      'event_sponsor.snapshot_refreshed.v1',
      jsonb_build_object(
        'event_id', v_rec.event_id, 'sponsor_id', v_rec.id, 'company_id', v_rec.company_id
      ),
      auth.uid()
    );
  END LOOP;

  RETURN v_changed;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_snapshot_refresh(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_snapshot_refresh(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_snapshot_refresh(jsonb) IS
  'Jawne odswiezenie migawki prezentacji z kartoteki: {"ids":[uuid]} albo {"event_id":uuid}, opcjonalnie {"include_manual":true}. Dotyka nazwy, logotypu, adresu strony i kraju; opisu NIGDY. Zwraca liczbe faktycznie zmienionych przypiec.';

-- ----------------------------------------------------------------------------
-- 13) PANEL: WYSZUKIWARKA FIRM Z KARTOTEKI DO PRZYPIECIA
--
-- Oddaje MINIMUM KOLUMN potrzebnych do rozpoznania firmy w selektorze (nazwa,
-- domena, miasto, kraj, logotyp) i NIC ponad to. Telefonu ani adresu
-- korespondencyjnego kartoteki tu nie ma, bo do wybrania firmy z listy nie sa
-- potrzebne, a kazda kolumna oddana "na zapas" jest kolumna, ktora wyciekla.
--
-- `is_pinned` odpowiada na pytanie, ktore selektor bez tej flagi zamienia
-- w pulapke: firma juz przypieta wyglada identycznie jak nieprzypieta, wiec
-- redaktor klika ja i dostaje `23505` z ograniczenia unikalnosci. Z flaga panel
-- pokazuje ja jako wybrana i prowadzi do istniejacego wiersza
-- (`pinned_sponsor_id`).
--
-- `events_count` to plakietka "Events (N)" ze zrzutu 8.6: na ilu wydarzeniach
-- TEJ organizacji firma juz byla. Liczone z `event_sponsors`, wiec jest to
-- liczba, a nie obietnica - dokladnie to, czego tresc widgetu nie umiala
-- policzyc wcale.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_sponsor_companies_search(uuid, text, integer);
CREATE FUNCTION public.admin_event_sponsor_companies_search(
  p_event_id uuid,
  p_q text DEFAULT NULL,
  p_limit integer DEFAULT 20
)
RETURNS TABLE (
  id uuid,
  name text,
  domain text,
  website text,
  city text,
  country text,
  logo_url text,
  is_pinned boolean,
  pinned_sponsor_id uuid,
  events_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
  v_q text := NULLIF(btrim(COALESCE(p_q, '')), '');
BEGIN
  RETURN QUERY
  SELECT
    c.id, c.name, c.domain, public._event_sponsor_web_url(c.website),
    c.city, c.country, c.logo_url,
    (pin.id IS NOT NULL),
    pin.id,
    COALESCE(u.cnt, 0)::integer
  FROM public.crm_companies c
  LEFT JOIN LATERAL (
    SELECT s.id
    FROM public.event_sponsors s
    WHERE s.tenant_id = v_tenant
      AND s.event_id = p_event_id
      AND s.company_id = c.id
    LIMIT 1
  ) pin ON true
  LEFT JOIN LATERAL (
    SELECT count(DISTINCT s2.event_id)::integer AS cnt
    FROM public.event_sponsors s2
    WHERE s2.tenant_id = v_tenant AND s2.company_id = c.id
  ) u ON true
  WHERE c.tenant_id = v_tenant
    AND (
      v_q IS NULL
      OR c.name ILIKE '%' || v_q || '%'
      OR c.domain ILIKE '%' || v_q || '%'
      OR c.city ILIKE '%' || v_q || '%'
    )
  -- Nieprzypiete najpierw (to one sa celem wyszukiwania), potem trafienie od
  -- POCZATKU nazwy przed trafieniem w srodku, potem alfabetycznie.
  ORDER BY
    (pin.id IS NOT NULL),
    CASE WHEN v_q IS NULL THEN NULL ELSE position(lower(v_q) IN c.name_norm) END
      NULLS LAST,
    c.name_norm
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_companies_search(uuid, text, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_companies_search(uuid, text, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_companies_search(uuid, text, integer) IS
  'Wyszukiwarka firm z kartoteki do przypiecia: minimum kolumn, flaga is_pinned dla tego wydarzenia i licznik wydarzen firmy. Skalowana po tenancie domowym. Bramka: assert_editor_tenant().';

-- ----------------------------------------------------------------------------
-- 14) PANEL: OSOBY KONTAKTOWE PRZYPIECIA (wsadowo)
--
-- Kontrakt jest identyczny z `admin_event_session_speakers_set` z 20260823140000
-- i z tego samego powodu: obsada jest LISTA, ktora formularz edytuje jako
-- calosc. Wysylanie jej jako N wywolan daje N transakcji, z ktorych czesc moze
-- sie nie udac, i lista zostaje w stanie mieszanym.
--
-- OSOBA NIEZNANA KARTOTECE ZATRZYMUJE CALOSC Z LICZBA, a nie jest po cichu
-- pomijana. Cicha zgoda na "dodalem trzy osoby, zapisaly sie dwie" konczy sie
-- tym, ze na miejscu nie ma numeru do czlowieka obslugujacego stoisko.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_sponsor_contacts_set(jsonb);
CREATE FUNCTION public.admin_event_sponsor_contacts_set(p_payload jsonb)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_sponsor_id uuid := NULLIF(p_payload->>'sponsor_id', '')::uuid;
  v_event_id uuid;
  v_keep uuid[] := ARRAY[]::uuid[];
  v_count integer := 0;
  v_ord integer := 0;
  v_item jsonb;
  v_lead uuid;
  v_role text;
  v_sort integer;
BEGIN
  IF v_sponsor_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: sponsor_id is required';
  END IF;

  IF jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_payload: items must be an array';
  END IF;

  SELECT s.event_id INTO v_event_id
  FROM public.event_sponsors s
  WHERE s.id = v_sponsor_id AND s.tenant_id = v_tenant;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'not_found: sponsor pin does not exist in this tenant';
  END IF;

  FOR v_item IN SELECT x FROM jsonb_array_elements(p_payload->'items') AS x
  LOOP
    v_ord := v_ord + 1;
    v_lead := NULLIF(v_item->>'lead_id', '')::uuid;
    v_role := COALESCE(NULLIF(v_item->>'role', ''), 'primary');
    v_sort := COALESCE((NULLIF(v_item->>'sort_order', ''))::integer, v_ord * 10);

    IF v_lead IS NULL THEN
      RAISE EXCEPTION 'invalid_payload: lead_id is required for every entry';
    END IF;

    IF v_role NOT IN ('primary', 'marketing', 'billing', 'onsite') THEN
      RAISE EXCEPTION 'invalid_role: role must be primary, marketing, billing or onsite';
    END IF;

    -- Osoba MUSI byc w kartotece TEGO najemcy. Klucz obcy zlozony
    -- (tenant_id, lead_id) odrzucilby obce id sam, ale bez nazwy pola - a panel
    -- nie ma jak zgadnac, ktora z pieciu osob na liscie jest ta zla.
    IF NOT EXISTS (
      SELECT 1 FROM public.crm_leads l
      WHERE l.id = v_lead AND l.tenant_id = v_tenant
    ) THEN
      RAISE EXCEPTION 'contact_not_found: person does not exist in this tenant';
    END IF;

    INSERT INTO public.event_sponsor_contacts (
      tenant_id, event_id, sponsor_id, lead_id, role, sort_order, created_by
    ) VALUES (
      v_tenant, v_event_id, v_sponsor_id, v_lead, v_role, v_sort, auth.uid()
    )
    ON CONFLICT (tenant_id, sponsor_id, lead_id) DO UPDATE
      SET role = EXCLUDED.role,
          sort_order = EXCLUDED.sort_order,
          updated_at = now();

    v_keep := v_keep || v_lead;
    v_count := v_count + 1;
  END LOOP;

  -- Pusta lista `items` kasuje wszystkie kontakty przypiecia - `= ANY` na
  -- pustej tablicy jest falszem, wiec `NOT (...)` obejmuje kazdy wiersz. To jest
  -- zamierzone: "zapisz bez kontaktow" musi byc wykonalne.
  DELETE FROM public.event_sponsor_contacts k
  WHERE k.tenant_id = v_tenant
    AND k.sponsor_id = v_sponsor_id
    AND NOT (k.lead_id = ANY (v_keep));

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_contacts_set(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_contacts_set(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_contacts_set(jsonb) IS
  'Wsadowe ustawienie osob kontaktowych przypiecia: {"sponsor_id":uuid,"items":[{"lead_id":uuid,"role":text,"sort_order":int}]}. Osoby nieobecne w items sa odpinane. Osoba spoza kartoteki najemcy zatrzymuje calosc. Zwraca liczbe kontaktow po operacji.';

-- ----------------------------------------------------------------------------
-- 15) PANEL: MATERIALY SPONSORA
--
-- Osobne RPC na pozycje, a nie wsadowa podmiana jak przy kontaktach, bo
-- material ma WLASNY cykl zycia: prezentacja z sesji dochodzi po wydarzeniu,
-- katalog produktowy jest wymieniany na nowa wersje, pakiet logotypow jest
-- publikowany od razu. Podmiana calej listy przy kazdym dodaniu jednej pozycji
-- kasowalaby i odtwarzala wiersze, ktorych nikt nie edytowal.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_sponsor_material_save(jsonb);
CREATE FUNCTION public.admin_event_sponsor_material_save(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_sponsor_id uuid := NULLIF(p_payload->>'sponsor_id', '')::uuid;
  v_event_id uuid;
  v_title_pl text := btrim(COALESCE(p_payload->>'title_pl', ''));
  v_title_en text := btrim(COALESCE(p_payload->>'title_en', ''));
  v_url text := btrim(COALESCE(p_payload->>'url', ''));
BEGIN
  IF v_id IS NOT NULL THEN
    IF v_title_pl = '' OR v_title_en = '' THEN
      RAISE EXCEPTION 'invalid_titles: both titles are required';
    END IF;

    UPDATE public.event_sponsor_materials SET
      title_pl = v_title_pl,
      title_en = v_title_en,
      kind = COALESCE(NULLIF(p_payload->>'kind', ''), kind),
      url = COALESCE(NULLIF(btrim(COALESCE(p_payload->>'url', '')), ''), url),
      sort_order = COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, sort_order),
      is_published = COALESCE((NULLIF(p_payload->>'is_published', ''))::boolean, is_published)
    WHERE id = v_id AND tenant_id = v_tenant;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'not_found: material does not exist in this tenant';
    END IF;

    RETURN v_id;
  END IF;

  IF v_sponsor_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: sponsor_id is required';
  END IF;
  IF v_title_pl = '' OR v_title_en = '' THEN
    RAISE EXCEPTION 'invalid_titles: both titles are required';
  END IF;
  IF v_url = '' THEN
    RAISE EXCEPTION 'invalid_url: url is required';
  END IF;

  SELECT s.event_id INTO v_event_id
  FROM public.event_sponsors s
  WHERE s.id = v_sponsor_id AND s.tenant_id = v_tenant;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'not_found: sponsor pin does not exist in this tenant';
  END IF;

  INSERT INTO public.event_sponsor_materials (
    tenant_id, event_id, sponsor_id, title_pl, title_en, kind, url,
    sort_order, is_published, created_by
  ) VALUES (
    v_tenant, v_event_id, v_sponsor_id, v_title_pl, v_title_en,
    COALESCE(NULLIF(p_payload->>'kind', ''), 'document'),
    v_url,
    COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, 100),
    COALESCE((NULLIF(p_payload->>'is_published', ''))::boolean, false),
    auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_material_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_material_save(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_material_save(jsonb) IS
  'Dodanie albo edycja materialu sponsora. Przy dodaniu wydarzenie jest brane Z PRZYPIECIA, nie z payloadu - klient nie ma czym rozjechac tej pary. Bramka: assert_editor_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_sponsor_material_delete(uuid);
CREATE FUNCTION public.admin_event_sponsor_material_delete(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  DELETE FROM public.event_sponsor_materials
  WHERE id = _id AND tenant_id = v_tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: material does not exist in this tenant';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_material_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_material_delete(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_material_delete(uuid) IS
  'Usuwa jedna pozycje materialow sponsora. Plik w magazynie nie jest ruszany - jego cykl zycia nalezy do magazynu, nie do tej tabeli.';

DROP FUNCTION IF EXISTS public.admin_event_sponsor_materials_reorder(jsonb);
CREATE FUNCTION public.admin_event_sponsor_materials_reorder(p_payload jsonb)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_moved integer;
BEGIN
  IF jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_payload: items must be an array of {id, sort_order}';
  END IF;

  UPDATE public.event_sponsor_materials m
  SET sort_order = i.sort_order
  FROM (
    SELECT
      (x->>'id')::uuid AS id,
      (x->>'sort_order')::integer AS sort_order
    FROM jsonb_array_elements(p_payload->'items') AS x
    WHERE NULLIF(x->>'id', '') IS NOT NULL
      AND NULLIF(x->>'sort_order', '') IS NOT NULL
  ) i
  WHERE m.id = i.id
    AND m.tenant_id = v_tenant
    AND m.sort_order IS DISTINCT FROM i.sort_order;

  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RETURN v_moved;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_materials_reorder(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_materials_reorder(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_materials_reorder(jsonb) IS
  'Wsadowa zmiana kolejnosci materialow sponsora: {"items":[{"id":uuid,"sort_order":int}]}. Zwraca liczbe przestawionych wierszy.';

-- ----------------------------------------------------------------------------
-- 16) PLASZCZYZNA TRESCI: SPONSORZY OPUBLIKOWANEGO WYDARZENIA PO SLUGU
--
-- WYLACZNIE `public_tenant_id()`, zero `has_role()` i zero `is_staff()`.
-- Naglowek `x-tenant-host` ustawia klient, wiec jest falsyfikowalny; funkcja,
-- ktora skalowalaby dane po naglowku, a autoryzowala po roli w tenancie
-- domowym, pozwolilaby administratorowi najemcy A podszyc sie pod najemce B
-- (wyciek zamkniety w 20260724091000, pilnowany przez check:sql-tenant-scope).
-- Staff podglada nieopublikowanych sponsorow funkcjami panelu.
--
-- WYNIK JEST POGRUPOWANY PO POZIOMIE, jeden wiersz na grupe, sponsorzy w
-- `sponsors jsonb`. Ksztalt jest ten sam co `SponsorTier[]` w
-- `src/lib/events/sponsors.ts`, wiec komponent renderujacy dzisiaj tresc
-- widgetu przyjmie to zrodlo bez zmiany warstwy widoku (`source: "event"`
-- z projektu, par. 4.10).
--
-- CO WYCHODZI, A CO NIE
--   * WYCHODZI MIGAWKA, nie kartoteka. Zaden JOIN do `crm_companies` tu nie
--     wystepuje - i to jest cala pointa modulu. Strona archiwalna nie zmienia
--     sie, gdy firma zmieni nazwe.
--   * Grupa BEZ POZIOMU (patroni medialni, wystawcy) wychodzi jako wiersz
--     z `tier_id = NULL` i `tier_rank = NULL`, na koncu (`NULLS LAST`).
--     Alternatywa - ukryc ich - zdejmowalaby ze strony partnerow, ktorzy nie
--     kupili pakietu, ale sa na plakacie.
--   * NIE WYCHODZI `internal_note`, `snapshot_source`, `snapshot_taken_at`
--     ani `company_id`. Notatka jest wewnetrzna, a pozostale trzy sa
--     narzedziem redakcji - gosc nie ma z nich zadnego pozytku, a
--     `company_id` wiazalby publiczna strone z identyfikatorem w kartotece
--     sprzedazowej.
--   * Poziom WYLACZONY (`is_active = false`) NIE JEST filtrowany - patrz
--     komentarz przy kolumnie. Wylaczenie jest decyzja cennikowa.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.event_sponsors_public(text);
CREATE FUNCTION public.event_sponsors_public(p_slug text)
RETURNS TABLE (
  tier_id uuid,
  tier_key text,
  tier_name_pl text,
  tier_name_en text,
  tier_description_pl text,
  tier_description_en text,
  tier_rank integer,
  tier_accent_color text,
  tier_logo_size text,
  benefits jsonb,
  sponsors jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_event_id uuid;
BEGIN
  IF v_tenant IS NULL THEN
    RETURN;
  END IF;

  SELECT e.id INTO v_event_id
  FROM public.events e
  WHERE e.tenant_id = v_tenant
    AND e.slug = p_slug
    AND e.status = 'published';

  IF v_event_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH grouped AS (
    SELECT
      s.tier_id AS gid,
      jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'name', s.snapshot_name,
          'logo', COALESCE(s.snapshot_logo_url, ''),
          'url', COALESCE(s.snapshot_website, ''),
          'description_pl', s.snapshot_description_pl,
          'description_en', s.snapshot_description_en,
          'country', s.snapshot_country,
          'role', s.role,
          'booth_label', s.booth_label,
          'sort_order', s.sort_order
        ) ORDER BY s.sort_order, s.snapshot_name
      ) AS items
    FROM public.event_sponsors s
    WHERE s.tenant_id = v_tenant
      AND s.event_id = v_event_id
      AND s.is_published
    GROUP BY s.tier_id
  )
  SELECT
    g.gid,
    t.key,
    t.name_pl,
    t.name_en,
    t.description_pl,
    t.description_en,
    t.rank,
    t.accent_color,
    -- Grupa bez poziomu dostaje rozmiar sredni - ta sama wartosc domyslna,
    -- ktora `parseSponsorTiers` nadaje wpisowi bez `size`.
    COALESCE(t.logo_size, 'md'),
    COALESCE(b.items, '[]'::jsonb),
    g.items
  FROM grouped g
  LEFT JOIN public.event_sponsor_tiers t
    ON t.id = g.gid AND t.tenant_id = v_tenant
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', bn.id,
        'label_pl', bn.label_pl,
        'label_en', bn.label_en
      ) ORDER BY bn.sort_order, bn.label_pl
    ) AS items
    FROM public.event_sponsor_tier_benefits bn
    WHERE bn.tenant_id = v_tenant AND bn.tier_id = g.gid
  ) b ON true
  ORDER BY t.rank DESC NULLS LAST, t.sort_order NULLS LAST, t.key NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.event_sponsors_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_sponsors_public(text)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_sponsors_public(text) IS
  'Publiczna lista sponsorow opublikowanego wydarzenia po slugu, pogrupowana po poziomie (grupa bez poziomu na koncu), tylko opublikowane przypiecia, w najemcy z naglowka hosta. Oddaje MIGAWKE, nigdy biezacej kartoteki. Plaszczyzna tresci - zero has_role().';

-- ----------------------------------------------------------------------------
-- 17) PLASZCZYZNA TRESCI: MATERIALY SPONSOROW PO SLUGU WYDARZENIA
--
-- Zasila zakladke "Materialy" na stronie wydarzenia. Osobna funkcja od listy
-- sponsorow, bo zakladka jest osobnym ekranem i pobieranie materialow razem
-- z logotypami obciazaloby KAZDE wejscie na strone glowna wydarzenia danymi,
-- ktorych ta strona nie pokazuje.
--
-- Warunek publikacji jest DWUSTOPNIOWY (material I przypiecie), tak samo jak
-- w polityce RLS - inaczej odpiecie sponsora zostawialoby jego katalog
-- produktowy w zakladce materialow wydarzenia.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.event_sponsor_materials_public(text);
CREATE FUNCTION public.event_sponsor_materials_public(p_slug text)
RETURNS TABLE (
  id uuid,
  sponsor_id uuid,
  sponsor_name text,
  sponsor_logo_url text,
  tier_id uuid,
  tier_name_pl text,
  tier_name_en text,
  tier_rank integer,
  title_pl text,
  title_en text,
  kind text,
  url text,
  sort_order integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_event_id uuid;
BEGIN
  IF v_tenant IS NULL THEN
    RETURN;
  END IF;

  SELECT e.id INTO v_event_id
  FROM public.events e
  WHERE e.tenant_id = v_tenant
    AND e.slug = p_slug
    AND e.status = 'published';

  IF v_event_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    m.id, m.sponsor_id, s.snapshot_name, s.snapshot_logo_url,
    s.tier_id, t.name_pl, t.name_en, t.rank,
    m.title_pl, m.title_en, m.kind, m.url, m.sort_order
  FROM public.event_sponsor_materials m
  JOIN public.event_sponsors s
    ON s.id = m.sponsor_id AND s.tenant_id = m.tenant_id
  LEFT JOIN public.event_sponsor_tiers t
    ON t.id = s.tier_id AND t.tenant_id = s.tenant_id
  WHERE m.tenant_id = v_tenant
    AND m.event_id = v_event_id
    AND m.is_published
    AND s.is_published
  ORDER BY t.rank DESC NULLS LAST, s.sort_order, m.sort_order, m.title_pl;
END;
$$;

REVOKE ALL ON FUNCTION public.event_sponsor_materials_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_sponsor_materials_public(text)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_sponsor_materials_public(text) IS
  'Publiczne materialy sponsorow opublikowanego wydarzenia po slugu. Widoczne dopiero gdy material I przypiecie sa opublikowane. Plaszczyzna tresci - zero has_role().';
