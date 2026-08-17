-- ============================================================================
-- Organizacja przy wpisie + OZNACZENIE MATERIAŁU SPONSOROWANEGO.
--
-- DWIE RZECZY, JEDNA MIGRACJA, BO DZIELĄ JEDEN INWARIANT: publiczny czytelnik
-- musi zobaczyć, CZYJ to materiał i KTO za niego zapłacił, a jedno bez drugiego
-- nie ma sensu prawnego (ujawnienie „materiał sponsorowany" bez wskazania
-- reklamodawcy nie spełnia obowiązku informacyjnego - patrz niżej).
--
-- ----------------------------------------------------------------------------
-- 1) DLACZEGO SNAPSHOT ORGANIZACJI, A NIE SAM JOIN DO crm_companies
-- ----------------------------------------------------------------------------
-- `public.crm_companies` jest czytelne WYŁĄCZNIE dla CRM-owego stafu w obrębie
-- najemcy (polityka `crm_companies_staff_read`, 20260724053906: `tenant_id =
-- current_tenant_id() AND (admin OR super_admin OR editor)`). Publiczny wpis
-- renderuje się dla `anon`, więc JOIN do tej tabeli zwróciłby NULL i karta
-- organizacji byłaby pusta na produkcji, a pełna w panelu - defekt widoczny
-- dopiero po publikacji.
--
-- Rozwiązaniem NIE jest dopisanie `anon` do polityki CRM: to wystawiłoby cały
-- katalog firm (z leadami po FK) publicznie. Zamiast tego wpis niesie WŁASNĄ
-- kopię trzech pól prezentacyjnych. Kopia ma drugą, niezależną zaletę: jest
-- DOWODEM Z CHWILI PUBLIKACJI - późniejsza zmiana nazwy albo logo firmy w CRM
-- nie przepisuje retroaktywnie tego, co czytelnik realnie zobaczył pod
-- artykułem. `organization_id` zostaje jako referencja do CRM (raportowanie,
-- odświeżenie snapshotu na żądanie redakcji), z `ON DELETE SET NULL`, więc
-- usunięcie firmy z CRM nie kasuje atrybucji na opublikowanym wpisie.
--
-- ----------------------------------------------------------------------------
-- 2) DLACZEGO OZNACZENIE SPONSOROWANIA MA TAKI, A NIE INNY KSZTAŁT
-- ----------------------------------------------------------------------------
-- Podstawy prawne, z których wynika KAŻDA kolumna niżej:
--
--   * Prawo prasowe (Dz.U. 1984 nr 5 poz. 24) art. 36 ust. 3 - ogłoszenia
--     i reklamy „muszą być oznaczone w sposób nie budzący wątpliwości, iż nie
--     stanowią one materiału redakcyjnego". Stąd: `is_sponsored` + widoczna
--     etykieta NAD treścią (warstwa renderu), nie w stopce.
--   * Ustawa o przeciwdziałaniu nieuczciwym praktykom rynkowym art. 7 pkt 11
--     (implementacja zał. I pkt 11 dyrektywy 2005/29/WE) - wykorzystanie treści
--     redakcyjnej do promocji, gdy przedsiębiorca za nią zapłacił, a nie wynika
--     to jasno z treści, jest praktyką nieuczciwą Z SAMEJ LISTY (bez badania
--     wpływu na decyzję konsumenta). Stąd: `sponsored_kind` rozróżnia ODPŁATNĄ
--     reklamę od sponsoringu z zachowaną niezależnością redakcyjną - to dwa
--     różne stany faktyczne i dwie różne etykiety.
--   * Ustawa o zwalczaniu nieuczciwej konkurencji art. 16 ust. 1 pkt 4 -
--     kryptoreklama (wypowiedź sprawiająca wrażenie neutralnej informacji).
--   * Dyrektywa 2005/29/WE art. 7 ust. 2 - zaniechanie wprowadzające w błąd;
--     obejmuje też korzyść NIEPIENIĘŻNĄ (barter, udostępnienie produktu).
--     Stąd wariant `barter` - „nie zapłaciliśmy pieniędzmi" nie zwalnia
--     z ujawnienia powiązania.
--   * Ustawa o świadczeniu usług drogą elektroniczną art. 9 ust. 1 (wdrożenie
--     dyr. 2000/31/WE art. 6) - informacja handlowa jest wyraźnie wyodrębniana
--     i oznaczana w sposób niebudzący wątpliwości, a oznaczenie obejmuje podmiot,
--     na którego zlecenie jest rozpowszechniana, ORAZ JEGO ADRESY ELEKTRONICZNE.
--     Stąd `sponsored_advertiser_url` nie jest ozdobą - to element ustawowy;
--     bramka serwerowa wymaga go razem z nazwą (patrz disclosureGaps).
--   * Rekomendacje UOKiK dot. oznaczania treści reklamowych (2022) - zasada
--     DWUCZĘŚCIOWA: odbiorca musi wiedzieć (a) że to reklama i (b) KTO jest
--     reklamodawcą. Stąd `sponsored_advertiser_name` jest WYMAGANE, gdy
--     `is_sponsored` (CHECK niżej), a nie tylko zalecane w UI.
--   * Rozporządzenie 2022/2065 (DSA) art. 26 ust. 1 lit. b-c - oznaczenie musi
--     wskazywać, w czyim imieniu prezentowana jest reklama ORAZ kto za nią
--     zapłacił, JEŚLI TO INNY PODMIOT. Stąd osobne `sponsored_payer_name` -
--     zlewanie płatnika z reklamodawcą w jedno pole gubi dokładnie ten przypadek
--     (agencja/fundacja płaci za materiał firmowany przez inny podmiot). Serwis
--     wydawcy nie jest „platformą internetową" w rozumieniu DSA (art. 3 lit. i
--     + motyw 13: sekcja komentarzy jest funkcją pomocniczą wobec publikacji na
--     odpowiedzialność redakcyjną wydawcy), więc art. 26 nie wiąże tu
--     bezpośrednio - przyjmujemy go jako STANDARD TREŚCI ujawnienia, bo jest
--     ostrzejszy niż minimum krajowe.
--   * Rozporządzenie (UE) 2024/900 o przejrzystości i targetowaniu reklamy
--     POLITYCZNEJ - wiąże BEZPOŚREDNIO, jako „wydawcę reklamy politycznej"
--     (większość obowiązków od 10.10.2025). Dla redakcji o polityce europejskiej
--     to najbardziej prawdopodobny reżim wiążący: art. 3 ust. 2 obejmuje
--     przekazy mogące wpłynąć na wynik wyborów/referendum ALBO NA PROCES
--     LEGISLACYJNY LUB REGULACYJNY - czyli dokładnie płatny materiał
--     stowarzyszenia branżowego czy organizacji rzeczniczej. Art. 11 ust. 1
--     wymaga w sposób jasny, widoczny i jednoznaczny: (a) informacji, że to
--     reklama polityczna, (b) tożsamości sponsora i - gdy dotyczy - podmiotu
--     ostatecznie go kontrolującego, (c) procesu, którego reklama dotyczy.
--     Stąd `sponsored_political`, `sponsored_sponsor_controller`,
--     `sponsored_political_process`.
--   * Dyrektywa 2010/13/UE (AVMSD, zm. 2018/1808) art. 9 ust. 1 lit. a
--     (rozpoznawalność handlowego przekazu audiowizualnego, zakaz przekazu
--     ukrytego), art. 10 (sponsorowanie jasno oznaczone) i art. 11 (lokowanie
--     produktu oznaczane na początku, na końcu i po przerwie) oraz ustawa
--     o radiofonii i telewizji art. 16, 16c, 17 i 17a. UWAGA: art. 23 AVMSD to
--     ILOŚCIOWY limit 20% czasu na reklamę, NIE oznaczanie - nie ma tu
--     zastosowania. Sam serwis nie jest dostawcą usługi medialnej (wideo
--     osadzone w artykule pozostaje poza zakresem - por. TSUE C-347/14 New Media
--     Online: liczy się, czy sekcja wideo jest dająca się oddzielić od
--     działalności dziennikarskiej i czy jej głównym celem jest dostarczanie
--     audycji), więc traktujemy te przepisy jako standard oznaczenia. Etykieta
--     nad treścią obsługuje też wpisy w formacie `video`, więc nie potrzebujemy
--     osobnego pola.
--
-- CZEGO TU ŚWIADOMIE NIE MA: pola z DOWOLNYM tekstem etykiety głównej.
-- Kanoniczne brzmienia PL/EN żyją w słowniku i18n i są wybierane przez
-- `sponsored_kind` - redakcja nie może podmienić „MATERIAŁ REKLAMOWY" na
-- „#współpraca", co jest dokładnie tym, co UOKiK kwestionuje. Do wyjaśnień
-- ponad kanon służy `sponsored_note_pl/_en` (DOKLEJANE, nie zastępujące).
--
-- Wszystkie kroki idempotentne (re-run na świeżej bazie i na produkcji).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Kolumny: atrybucja organizacji (snapshot) + ujawnienie sponsoringu
-- ----------------------------------------------------------------------------
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS organization_id uuid
    REFERENCES public.crm_companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS organization_name text,
  ADD COLUMN IF NOT EXISTS organization_logo_url text,
  ADD COLUMN IF NOT EXISTS organization_website text,
  ADD COLUMN IF NOT EXISTS is_sponsored boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sponsored_kind text,
  ADD COLUMN IF NOT EXISTS sponsored_advertiser_name text,
  ADD COLUMN IF NOT EXISTS sponsored_advertiser_url text,
  ADD COLUMN IF NOT EXISTS sponsored_payer_name text,
  ADD COLUMN IF NOT EXISTS sponsored_note_pl text,
  ADD COLUMN IF NOT EXISTS sponsored_note_en text,
  ADD COLUMN IF NOT EXISTS sponsored_affiliate boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sponsored_political boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sponsored_political_process text,
  ADD COLUMN IF NOT EXISTS sponsored_sponsor_controller text,
  ADD COLUMN IF NOT EXISTS sponsored_order_ref text,
  ADD COLUMN IF NOT EXISTS sponsored_marked_by uuid
    REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sponsored_marked_at timestamptz;

COMMENT ON COLUMN public.posts.organization_id IS
  'CRM company this post is attributed to (public.crm_companies). Reference only - the public render reads the organization_* snapshot, because crm_companies is staff-read-only.';
COMMENT ON COLUMN public.posts.organization_name IS
  'Snapshot of the organization name as shown to readers at publication time. Frozen on purpose: renaming the company in the CRM must not rewrite what readers were shown.';
COMMENT ON COLUMN public.posts.organization_logo_url IS
  'Snapshot of the organization logo URL (public `media` bucket). Same freezing rationale as organization_name.';
COMMENT ON COLUMN public.posts.organization_website IS
  'Snapshot of the organization website. Rendered as an outbound link on the attribution card.';
COMMENT ON COLUMN public.posts.is_sponsored IS
  'TRUE = the material carries a commercial relationship and MUST render a disclosure label above the content (Prawo prasowe art. 36 ust. 3; UPNPR art. 7 pkt 11).';
COMMENT ON COLUMN public.posts.sponsored_kind IS
  'Nature of the commercial relationship; selects the canonical disclosure wording (advertisement | sponsored | partner | barter | self_promo). Mirrors SPONSORED_KINDS in src/lib/content/sponsored.ts.';
COMMENT ON COLUMN public.posts.sponsored_advertiser_name IS
  'Who advertises / who paid - the two-part rule from the UOKiK 2022 recommendations and DSA art. 26(1)(b). Required to PUBLISH a flagged post (server gate in updatePost), not on every save: the field is typed, so a CHECK would reject autosaves mid-keystroke.';
COMMENT ON COLUMN public.posts.sponsored_advertiser_url IS
  'Advertiser electronic address - a statutory element of the marking under uśude art. 9 ust. 1 pkt 1 (dyr. 2000/31/WE art. 6), not decoration. Rendered with rel="sponsored nofollow noopener" so the paid link is not treated as an editorial endorsement.';
COMMENT ON COLUMN public.posts.sponsored_payer_name IS
  'Who PAID, when different from the advertiser (DSA art. 26(1)(c)) - e.g. an agency or foundation funding a message fronted by another entity. NULL = the advertiser paid.';
COMMENT ON COLUMN public.posts.sponsored_political IS
  'TRUE = political advertising under Regulation (EU) 2024/900 art. 3(2) - including messages liable to influence a legislative or regulatory process, not only elections. Triggers the art. 11(1) disclosure set.';
COMMENT ON COLUMN public.posts.sponsored_political_process IS
  'The election, referendum or legislative/regulatory process the political advertisement concerns (Regulation (EU) 2024/900 art. 11(1)(c)).';
COMMENT ON COLUMN public.posts.sponsored_sponsor_controller IS
  'Entity ultimately controlling the sponsor, where applicable (Regulation (EU) 2024/900 art. 11(1)(b)).';
COMMENT ON COLUMN public.posts.sponsored_note_pl IS
  'Optional PL addendum appended BELOW the canonical label (e.g. the scope of editorial control). Never replaces the canonical wording.';
COMMENT ON COLUMN public.posts.sponsored_note_en IS
  'Optional EN addendum appended BELOW the canonical label. Never replaces the canonical wording.';
COMMENT ON COLUMN public.posts.sponsored_affiliate IS
  'TRUE = the body contains affiliate links; renders its own disclosure line. Orthogonal to is_sponsored (dyrektywa 2005/29/WE art. 7 ust. 2).';
COMMENT ON COLUMN public.posts.sponsored_order_ref IS
  'EDITORIAL-INTERNAL order / contract reference for the accountability trail. Deliberately NOT part of the public column grant below and NOT selected by the public content query.';
COMMENT ON COLUMN public.posts.sponsored_marked_by IS
  'Who declared the commercial relationship (accountability trail).';
COMMENT ON COLUMN public.posts.sponsored_marked_at IS
  'When the commercial relationship was declared (accountability trail).';

-- ----------------------------------------------------------------------------
-- 2) CHECK-i: stan niezgodny z prawem ma być NIEREPREZENTOWALNY w schemacie
-- ----------------------------------------------------------------------------
-- GDZIE STOI KTÓRA BRAMKA - i dlaczego nie wszystkie tutaj.
--
-- Pierwsza wersja tej migracji wymagała CHECK-iem nazwy reklamodawcy przy
-- każdej wartości `is_sponsored = true`. To był DEFEKT, nie surowość: `updatePost`
-- jest ścieżką AUTOZAPISU (debounce 1500 ms). Redaktor, który zaznacza „materiał
-- sponsorowany" i zaczyna wpisywać nazwę, ma przez kilka sekund stan
-- „flaga bez nazwy" - a CHECK odrzuciłby wtedy CAŁY wiersz, więc razem z nim
-- nie zapisałyby się niezwiązane zmiany tytułu i treści z tej samej migawki.
-- Twardy warunek na polu, które POWSTAJE PRZEZ PISANIE, blokuje edytor.
--
-- Podział, który z tego wynika:
--   * TUTAJ (CHECK) - wyłącznie niezmienniki STRUKTURALNE, których UI nie potrafi
--     naruszyć przejściowo, bo ustawia je jednym atomowym patchem: allowlista
--     rodzajów relacji, „flaga ⇒ rodzaj relacji", „reklama polityczna ⇒ materiał
--     komercyjny". Tych stanów nie da się osiągnąć pisząc w polu tekstowym.
--   * PRZY PUBLIKACJI (serwer, `disclosureGaps` w updatePost dla statusu
--     published/scheduled) - kompletność pól TEKSTOWYCH: nazwa reklamodawcy, jego
--     adres elektroniczny, proces w reklamie politycznej. Moment publikacji jest
--     właściwym momentem: wersja robocza z niedokończoną deklaracją nikogo nie
--     wprowadza w błąd, opublikowana - wprowadza.
--   * PRZY RENDERZE (resolveDisclosure) - etykieta pokazuje się ZAWSZE, gdy
--     flaga jest włączona, nawet przy brakującej nazwie. Wariant „brak nazwy ⇒
--     brak etykiety" byłby najgorszy z możliwych: materiał opłacony bez żadnego
--     oznaczenia to dokładnie kryptoreklama.
-- Lustro `SPONSORED_KINDS` z src/lib/content/sponsored.ts. Dodanie wariantu
-- w kodzie WYMAGA migracji podnoszącej ten CHECK - inaczej panel pokaże opcję,
-- której baza nie przyjmie (ta sama konwencja co posts_tts_voice_*_check).
ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_sponsored_kind_check;
ALTER TABLE public.posts
  ADD CONSTRAINT posts_sponsored_kind_check
  CHECK (
    sponsored_kind IS NULL
    OR sponsored_kind IN ('advertisement', 'sponsored', 'partner', 'barter', 'self_promo')
  );

-- „Oznaczony jako komercyjny" bez rodzaju relacji nie wybiera żadnej kanonicznej
-- etykiety, więc render nie miałby czego pokazać. Karta w panelu ustawia rodzaj
-- W TYM SAMYM patchu co flagę, więc ten stan jest z UI nieosiągalny.
ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_sponsored_disclosure_complete_check;
ALTER TABLE public.posts
  ADD CONSTRAINT posts_sponsored_disclosure_complete_check
  CHECK (is_sponsored = false OR sponsored_kind IS NOT NULL);

-- Reklama polityczna (rozp. 2024/900) JEST reklamą - „polityczny przekaz
-- sponsorowany" bez oznaczenia materiału jako komercyjnego jest wewnętrznie
-- sprzeczny. Oba pola to przełączniki, ustawiane atomowo.
ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_sponsored_political_check;
ALTER TABLE public.posts
  ADD CONSTRAINT posts_sponsored_political_check
  CHECK (sponsored_political = false OR is_sponsored = true);

-- ----------------------------------------------------------------------------
-- 3) Indeksy
-- ----------------------------------------------------------------------------
-- Raportowanie „co opublikowaliśmy dla tej organizacji" oraz lista sponsorowanych
-- w panelu. Częściowe indeksy - kolumny są NULL/false w zdecydowanej większości
-- wierszy, więc pełny indeks byłby w całości balastem.
CREATE INDEX IF NOT EXISTS posts_organization_id_idx
  ON public.posts (organization_id)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS posts_tenant_sponsored_idx
  ON public.posts (tenant_id, published_at DESC)
  WHERE is_sponsored = true;

-- ----------------------------------------------------------------------------
-- 4) GRANT-y kolumnowe (doktryna fail-closed)
-- ----------------------------------------------------------------------------
-- 20260702200000_gate_content_body_columns.sql odebrała tabelaryczny SELECT
-- i przywróciła go WYLICZONĄ listą kolumn, z jawnym zapisem w nagłówku: „any
-- column added later is NOT auto-exposed (fail-closed) and must be granted
-- explicitly". Trzymamy się tego, więc nowe kolumny PREZENTACYJNE dostają
-- SELECT jawnie. `sponsored_order_ref`, `sponsored_marked_by` i
-- `sponsored_marked_at` NIE - to ślad rozliczalności dla redakcji, nie treść
-- dla czytelnika (panel czyta je przez get_post_for_edit, SECURITY DEFINER,
-- który omija ACL kolumnowy).
GRANT SELECT (
  organization_id,
  organization_name,
  organization_logo_url,
  organization_website,
  is_sponsored,
  sponsored_kind,
  sponsored_advertiser_name,
  sponsored_advertiser_url,
  sponsored_payer_name,
  sponsored_note_pl,
  sponsored_note_en,
  sponsored_affiliate,
  sponsored_political,
  sponsored_political_process,
  sponsored_sponsor_controller
) ON public.posts TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5) RPC katalogu organizacji: logo w wyszukiwaniu i przy zakładaniu firmy
-- ----------------------------------------------------------------------------
-- `search_companies_public` / `create_company_self_service` (20260725182640) są
-- jedyną ścieżką, którą NIE-CRM-owy staff (rola `author`) może przeczytać
-- katalog firm i dodać brakującą - polityki `crm_companies_staff_*` wymagają
-- admin/editor/super_admin, a wpisy pisze też autor. Obie funkcje powstały
-- przed kolumną `logo_url` (20260722093241), więc katalog nie umiał ani zwrócić
-- logo, ani go zapisać. Bez tego „dodanie organizacji wraz z logo" z edytora
-- wpisu jest niewykonalne dla autora.
--
-- Zmiana typu zwracanego wymaga DROP (CREATE OR REPLACE nie podnosi RETURNS
-- TABLE), a dodanie parametru tworzyłoby przeciążenie - dlatego oba obiekty
-- lecą DROP + CREATE, z ponownym GRANT EXECUTE.
DROP FUNCTION IF EXISTS public.search_companies_public(text, integer);

CREATE FUNCTION public.search_companies_public(
  _query text,
  _limit integer DEFAULT 12
)
RETURNS TABLE(
  id uuid,
  name text,
  country text,
  branch text,
  city text,
  address text,
  postal_code text,
  website text,
  phone text,
  domain text,
  logo_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, name, country, branch, city, address, postal_code, website, phone,
         domain, logo_url
  FROM public.crm_companies
  WHERE tenant_id = public.current_tenant_id()
    AND (coalesce(_query, '') = '' OR name ILIKE '%' || _query || '%')
  ORDER BY name
  LIMIT _limit;
$$;

REVOKE ALL ON FUNCTION public.search_companies_public(text, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.search_companies_public(text, integer) TO authenticated;

DROP FUNCTION IF EXISTS public.create_company_self_service(
  text, text, text, text, text, text, text, text
);
DROP FUNCTION IF EXISTS public.create_company_self_service(
  text, text, text, text, text, text, text, text, text
);

CREATE FUNCTION public.create_company_self_service(
  _name text,
  _country text DEFAULT NULL,
  _branch text DEFAULT NULL,
  _city text DEFAULT NULL,
  _address text DEFAULT NULL,
  _postal_code text DEFAULT NULL,
  _website text DEFAULT NULL,
  _phone text DEFAULT NULL,
  _logo_url text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
  existing_id uuid;
BEGIN
  IF _name IS NULL OR btrim(_name) = '' THEN
    RAISE EXCEPTION 'name_required';
  END IF;

  SELECT id INTO existing_id
  FROM public.crm_companies
  WHERE tenant_id = public.current_tenant_id()
    AND name_norm = lower(btrim(_name))
  LIMIT 1;

  -- Idempotencja po (tenant_id, name_norm), jak w wersji z 20260725182640.
  -- NOWE: logo dokładamy do ISTNIEJĄCEJ firmy, gdy jeszcze go nie ma. Bez tego
  -- redakcja, która wgrała logo w dialogu, a firma już była w CRM, dostawała
  -- ciche zignorowanie uploadu - i wpis bez logo, choć plik poszedł do storage.
  IF existing_id IS NOT NULL THEN
    IF _logo_url IS NOT NULL AND btrim(_logo_url) <> '' THEN
      -- `tenant_id` powtórzony JAWNIE, choć `existing_id` pochodzi z zapytania
      -- już zawężonego do najemcy. To funkcja SECURITY DEFINER, więc omija RLS -
      -- jedyną ochroną byłaby wtedy poprawność wyprowadzenia zmiennej piętro
      -- wyżej. Drugi, niezależny predykat jest doktryną tego repo (jak w
      -- get_entity_content): refaktor, który kiedyś przestawi źródło
      -- `existing_id`, nie może cicho otworzyć zapisu do obcego najemcy.
      UPDATE public.crm_companies
         SET logo_url = _logo_url,
             updated_at = now()
       WHERE id = existing_id
         AND tenant_id = public.current_tenant_id()
         AND (logo_url IS NULL OR btrim(logo_url) = '');
    END IF;
    RETURN existing_id;
  END IF;

  INSERT INTO public.crm_companies (
    tenant_id, created_by, name, country, branch, city, address, postal_code,
    website, phone, logo_url
  ) VALUES (
    public.current_tenant_id(),
    auth.uid(),
    _name,
    nullif(trim(coalesce(_country, '')), ''),
    nullif(trim(coalesce(_branch, '')), ''),
    nullif(trim(coalesce(_city, '')), ''),
    nullif(trim(coalesce(_address, '')), ''),
    nullif(trim(coalesce(_postal_code, '')), ''),
    nullif(trim(coalesce(_website, '')), ''),
    nullif(trim(coalesce(_phone, '')), ''),
    nullif(trim(coalesce(_logo_url, '')), '')
  )
  RETURNING id INTO new_id;

  RETURN new_id;
EXCEPTION WHEN unique_violation THEN
  SELECT id INTO existing_id
  FROM public.crm_companies
  WHERE tenant_id = public.current_tenant_id()
    AND name_norm = lower(btrim(_name))
  LIMIT 1;
  RETURN existing_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_company_self_service(
  text, text, text, text, text, text, text, text, text
) FROM public;
GRANT EXECUTE ON FUNCTION public.create_company_self_service(
  text, text, text, text, text, text, text, text, text
) TO authenticated;
