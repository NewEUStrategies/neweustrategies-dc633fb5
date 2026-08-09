-- ============================================================================
-- A29: DOROBEK KLUBU + DZIALY, KTORE ZNACZA TEMAT
--
-- Ta migracja domyka dwa ustalenia audytu ukladu (V3):
--
-- 1) `kind` DOKUMENTU MIAL JEDNA WARTOSC NA DWA KONCE PROCESU. `brief` oznaczal
--    zarowno material, ktory czlonek dostaje PRZED sesja, jak i produkt, ktory
--    powstaje PO niej. Sa to dwa rozne byty w cyklu pracy klubu i mieszanie ich
--    w jednym slowniku sprawia, ze na pytanie "co ten klub wyprodukowal" nie da
--    sie odpowiedziec zapytaniem - a to jest jedyne pytanie, ktore odroznia
--    think tank od forum. Dokladamy siedem rodzajow PRODUKTU; `brief` zostaje
--    i od teraz znaczy WYLACZNIE briefing przedsesyjny.
--
-- 2) DZIAL KLUBU REFERENCYJNEGO NIE ZNACZYL TEMATU. Piec dzialow zasianych
--    przez A20 wyrazalo cztery ROZNE osie: format pracy ("Debata otwarta"),
--    kotwice ("Akty prawne"), zamierzony wynik ("Stanowiska klubu") i
--    powierzchnie ("Biblioteka"). Trzy z nich maja juz w module wlasna, lepsza
--    reprezentacje (`club_threads.kind`, `p_anchored`, sekcja dokumentow), wiec
--    jako dzialy byly duplikatem, ktory odbieral dzialowi jego wlasne
--    znaczenie. Piata - "Kuluary" - jest realnym rezimem zaufania i zostaje.
--
-- CZEGO TA MIGRACJA NIE ROBI. Nie rusza dzialow, ktore redakcja tknela. Cala
-- przebudowa punktu 2 stoi za bramka porownujaca slug ORAZ obie nazwy z tym,
-- co zasial A20 - jesli ktokolwiek zmienil nazwe dzialu, blok konczy sie
-- NOTICE i nie zmienia niczego. Tresc klubu nalezy do redakcji; migracja moze
-- poprawic WLASNY zasiew, nie cudza prace.
--
-- Zaden dzial nie jest kasowany. Oproznione ida na `archived`, czyli znikaja
-- z szyny czlonka (`club_groups_list` odsiewa 'draft'/'archived' dla
-- niezarzadzajacych), a zarzadzajacy widzi je dalej i moze cofnac decyzje.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Slownik rodzajow dokumentu: material zrodlowy + PRODUKT
-- ----------------------------------------------------------------------------
ALTER TABLE public.club_documents DROP CONSTRAINT IF EXISTS club_documents_kind_check;
ALTER TABLE public.club_documents
  ADD CONSTRAINT club_documents_kind_check
  CHECK (kind IN (
    -- Materialy: to, z czego klub pracuje.
    'brief', 'analysis', 'minutes', 'dataset',
    'position', 'legal', 'presentation', 'other',
    -- Produkty: to, co klub wytwarza. Kolejnosc odpowiada cyklowi pracy -
    -- od notatki po sesji do materialu przeznaczonego do publikacji.
    'discussion_note', 'policy_brief', 'scenario', 'memo',
    'research_agenda', 'public_insight', 'decision_memo'
  ));

COMMENT ON COLUMN public.club_documents.kind IS
  'Rodzaj dokumentu. Pierwsze osiem wartosci to MATERIALY (wejscie do pracy klubu), siedem kolejnych to PRODUKTY (wyjscie). Podzial zasila powierzchnie "Dorobek" i odpowiada na pytanie, co klub wytworzyl.';

-- ----------------------------------------------------------------------------
-- 2) club_documents_list: zawezenie po ZBIORZE rodzajow
--
-- Powierzchnia "Dorobek" pyta o siedem rodzajow naraz, a `p_kind` przyjmuje
-- jeden. Odsianie reszty po stronie klienta byloby gorsze niz brak funkcji:
-- `total_count` liczy sie w oknie PRZED limitem, wiec licznik i paginacja
-- mowilyby o zbiorze, ktorego uzytkownik nie oglada.
--
-- `p_kind` zostaje obok `p_kinds` - pojedynczy chip rodzaju to nadal
-- najczestsze uzycie i nie ma powodu zmuszac go do budowania tablicy.
--
-- Zmiana sygnatury, wiec DROP + CREATE. Stary szescioargumentowy wariant musi
-- zniknac JAWNIE: dwa przeciazenia tej samej nazwy roznia sie dla PostgREST
-- wylacznie zestawem kluczy w ciele zadania, a pominiety klucz z wartoscia
-- domyslna czyni wybor niejednoznacznym.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.club_documents_list(uuid, uuid, text, text, integer, integer);
-- DROP takze NOWEJ sygnatury. Wyglada na zbedny (przed ta migracja nic takiego
-- nie istnieje), ale bez niego odtworzenie bazy OD ZERA pada z 42723: platforma
-- zapisuje przy wdrozeniu wlasna kopie tego pliku, wiec ten sam `CREATE`
-- wykonuje sie w replayu dwa razy. `CREATE OR REPLACE` nie jest tu wyjsciem,
-- bo pierwszy DROP powyzej zmienia liste argumentow.
DROP FUNCTION IF EXISTS public.club_documents_list(uuid, uuid, text, text, integer, integer, text[]);

CREATE FUNCTION public.club_documents_list(
  p_club_id  uuid,
  p_group_id uuid    DEFAULT NULL,
  p_kind     text    DEFAULT NULL,
  p_search   text    DEFAULT NULL,
  p_limit    integer DEFAULT 50,
  p_offset   integer DEFAULT 0,
  p_kinds    text[]  DEFAULT NULL
)
RETURNS TABLE (
  id uuid, club_id uuid, group_id uuid, thread_id uuid,
  slug text, title_pl text, title_en text, summary_pl text, summary_en text,
  kind text, file_url text, file_size bigint, mime_type text, external_url text,
  visibility text, status text, language text, version text, source_label text,
  published_at timestamptz, pinned_at timestamptz, download_count integer,
  thread_slug text, group_name_pl text, group_name_en text,
  uploader_name text, created_at timestamptz, updated_at timestamptz,
  can_manage boolean, total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH caps AS (
    SELECT * FROM public.club_capabilities(p_club_id, NULL, auth.uid())
  ),
  visible AS (
    SELECT d.*
      FROM public.club_documents d
     CROSS JOIN caps
     WHERE d.club_id = p_club_id
       AND caps.can_read
       -- Notatki prowadzenia widzi prowadzenie. Szkic widzi prowadzenie
       -- i autor - inaczej wgranie pliku znikaloby z oczu wgrywajacemu.
       AND (d.visibility = 'club' OR caps.can_moderate)
       AND (d.status = 'published' OR caps.can_moderate OR d.uploaded_by = auth.uid())
       AND (p_group_id IS NULL OR d.group_id = p_group_id)
       AND (p_kind IS NULL OR d.kind = p_kind)
       -- Pusta tablica to NIE jest "wszystko": to jawnie pusty wybor i ma
       -- zwrocic zero wierszy, inaczej filtr bez zaznaczonej pozycji cicho
       -- pokazywalby caly zbior.
       AND (p_kinds IS NULL OR d.kind = ANY (p_kinds))
       AND (
         NULLIF(btrim(COALESCE(p_search, '')), '') IS NULL
         OR d.title_pl ILIKE '%' || btrim(p_search) || '%'
         OR d.title_en ILIKE '%' || btrim(p_search) || '%'
         OR COALESCE(d.summary_pl, '') ILIKE '%' || btrim(p_search) || '%'
         OR COALESCE(d.summary_en, '') ILIKE '%' || btrim(p_search) || '%'
       )
  )
  SELECT
    v.id, v.club_id, v.group_id, v.thread_id,
    v.slug, v.title_pl, v.title_en, v.summary_pl, v.summary_en,
    v.kind, v.file_url, v.file_size, v.mime_type, v.external_url,
    v.visibility, v.status, v.language, v.version, v.source_label,
    v.published_at, v.pinned_at, v.download_count,
    t.slug, g.name_pl, g.name_en,
    NULLIF(btrim(COALESCE(p.display_name, '')), ''),
    v.created_at, v.updated_at,
    caps.can_moderate,
    count(*) OVER ()
  FROM visible v
  CROSS JOIN caps
  LEFT JOIN public.club_threads t ON t.id = v.thread_id
  LEFT JOIN public.club_groups  g ON g.id = v.group_id
  LEFT JOIN public.profiles     p ON p.id = v.uploaded_by
  ORDER BY v.pinned_at DESC NULLS LAST, v.created_at DESC
  LIMIT  GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
  OFFSET GREATEST(0, COALESCE(p_offset, 0))
$$;

COMMENT ON FUNCTION public.club_documents_list(uuid, uuid, text, text, integer, integer, text[]) IS
  'Dokumenty klubu z paginacja i licznikiem okna. `p_kinds` zaweza po ZBIORZE rodzajow - zasila powierzchnie "Dorobek" (produkty) i "Materialy" (zrodla).';

REVOKE EXECUTE ON FUNCTION
  public.club_documents_list(uuid, uuid, text, text, integer, integer, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.club_documents_list(uuid, uuid, text, text, integer, integer, text[])
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3) Klub referencyjny: dzialy tematyczne zamiast czterech osi w jednej liscie
-- ----------------------------------------------------------------------------
DO $rebuild$
DECLARE
  v_tenant    uuid := public.public_tenant_id();
  v_owner     uuid;
  v_club      uuid;
  g_debata    uuid;
  g_dossier   uuid;
  g_stanowis  uuid;
  g_biblio    uuid;
  g_arch      uuid;
  g_przemysl  uuid;
  v_untouched boolean;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE NOTICE 'clubs A29: brak tenantu publicznego - przebudowa dzialow pominieta';
    RETURN;
  END IF;

  SELECT id INTO v_club FROM public.clubs
   WHERE tenant_id = v_tenant AND slug = 'bezpieczenstwo-europy-srodkowo-wschodniej';
  IF v_club IS NULL THEN
    RAISE NOTICE 'clubs A29: klub referencyjny nie istnieje - przebudowa dzialow pominieta';
    RETURN;
  END IF;

  SELECT id INTO g_debata   FROM public.club_groups WHERE club_id = v_club AND slug = 'debata';
  SELECT id INTO g_dossier  FROM public.club_groups WHERE club_id = v_club AND slug = 'dossier';
  SELECT id INTO g_stanowis FROM public.club_groups WHERE club_id = v_club AND slug = 'stanowiska';
  SELECT id INTO g_biblio   FROM public.club_groups WHERE club_id = v_club AND slug = 'biblioteka';

  -- BRAMKA REDAKCYJNA. Przebudowa rusza WYLACZNIE zasiew A20 w stanie
  -- nietknietym: cztery dzialy istnieja i wszystkie cztery maja obie nazwy
  -- dokladnie takie, jakie zapisal zasiew. Kazde odstepstwo znaczy, ze ktos
  -- tu pracowal - i wtedy jego praca wygrywa z ta migracja.
  SELECT
    g_debata IS NOT NULL AND g_dossier IS NOT NULL
    AND g_stanowis IS NOT NULL AND g_biblio IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.club_groups
                 WHERE id = g_debata   AND name_pl = 'Debata otwarta'    AND name_en = 'Open debate')
    AND EXISTS (SELECT 1 FROM public.club_groups
                 WHERE id = g_dossier  AND name_pl = 'Akty prawne'       AND name_en = 'Policy files')
    AND EXISTS (SELECT 1 FROM public.club_groups
                 WHERE id = g_stanowis AND name_pl = 'Stanowiska klubu'  AND name_en = 'Club positions')
    AND EXISTS (SELECT 1 FROM public.club_groups
                 WHERE id = g_biblio   AND name_pl = 'Biblioteka'        AND name_en = 'Library')
    INTO v_untouched;

  IF NOT v_untouched THEN
    RAISE NOTICE 'clubs A29: dzialy klubu referencyjnego byly edytowane - przebudowa pominieta';
    RETURN;
  END IF;

  SELECT created_by INTO v_owner FROM public.clubs WHERE id = v_club;

  -- ---- Dzialy tematyczne ----------------------------------------------------
  -- Hierarchia jedzie z konwencji slugow (`buildClubGroupTree` po stronie UI),
  -- wiec poddzial nie potrzebuje kolumny rodzica - tylko dyscypliny w nazwie.
  --
  -- Rezim dziedziczy sie z klubu we WSZYSTKICH nowych dzialach. To jest cala
  -- roznica wobec zasiewu A20, ktory nadpisywal ustawienia w kazdym dziale,
  -- zeby pokazac dziedziczenie: rezim ma byc wlasnoscia dzialu tylko wtedy,
  -- gdy naprawde sie rozni, bo znacznik przy kazdej pozycji nie znaczy nic.
  INSERT INTO public.club_groups (
    tenant_id, club_id, slug, name_pl, name_en, description_pl, description_en,
    icon, sort_order, status, created_by
  ) VALUES
    (v_tenant, v_club, 'bezpieczenstwo-architektura',
     'Architektura bezpieczeństwa', 'Security architecture',
     'Układ sojuszy, gwarancje, prawo i instytucje. Diagnoza, interpretacja, implikacje - w tej kolejności.',
     'Alliances, guarantees, law and institutions. Diagnosis, interpretation, implications - in that order.',
     'Landmark', 10, 'active', v_owner),
    (v_tenant, v_club, 'bezpieczenstwo-architektura-flanka',
     'Wschodnia flanka i NATO', 'Eastern flank and NATO',
     'Poddział: obecność, planowanie obronne i zdolności sojusznicze na flance.',
     'Subsection: presence, defence planning and allied capabilities on the flank.',
     'Compass', 11, 'active', v_owner),
    (v_tenant, v_club, 'bezpieczenstwo-przemysl',
     'Zdolności i przemysł obronny', 'Capabilities and defence industry',
     'Zamówienia, harmonogramy dostaw, zapasy i baza przemysłowa regionu.',
     'Procurement, delivery schedules, stockpiles and the region''s industrial base.',
     'Factory', 20, 'active', v_owner),
    (v_tenant, v_club, 'bezpieczenstwo-tech',
     'Technologia i cyber', 'Technology and cyber',
     'Cyberbezpieczeństwo, AI i automatyzacja jako czynniki zmiany układu sił.',
     'Cybersecurity, AI and automation as forces reshaping the balance of power.',
     'Cpu', 30, 'active', v_owner)
  ON CONFLICT (club_id, slug) DO NOTHING;

  SELECT id INTO g_arch FROM public.club_groups
   WHERE club_id = v_club AND slug = 'bezpieczenstwo-architektura';
  SELECT id INTO g_przemysl FROM public.club_groups
   WHERE club_id = v_club AND slug = 'bezpieczenstwo-przemysl';

  IF g_arch IS NULL OR g_przemysl IS NULL THEN
    RAISE NOTICE 'clubs A29: nie udalo sie zalozyc dzialow tematycznych - przebudowa przerwana';
    RETURN;
  END IF;

  -- ---- Przeniesienie watkow -------------------------------------------------
  -- Kazdy watek zasiewu jest mapowany PO SLUGU, a nie hurtem po dziale
  -- zrodlowym: "Debata otwarta" trzymala i watek o zdolnosciach przemyslowych,
  -- i sondaz porzadkowy klubu, wiec przeniesienie calego dzialu w jedno
  -- miejsce zrobiloby dokladnie ten sam blad, ktory ta migracja naprawia.
  UPDATE public.club_threads SET group_id = g_przemysl
   WHERE club_id = v_club
     AND slug IN (
       'zdolnosci-a-deklaracje-luka-wykonawcza',
       'gdzie-szukac-danych-o-zapasach-amunicji',
       'wspolne-zamowienia-jako-domyslna-sciezka',
       'zestawienie-zrodel-o-przemysle-obronnym-regionu'
     );

  UPDATE public.club_threads SET group_id = g_arch
   WHERE club_id = v_club
     AND slug IN (
       'jak-dziala-ten-klub',
       'priorytet-klubu-na-najblizszy-kwartal',
       'czytanie-aktu-co-zmienia-sie-w-praktyce'
     );

  -- Dokumenty i wpisy kalendarza wskazuja dzial osobno - bez tego materialy
  -- zostalyby przypiete do dzialu, ktorego czlonek juz nie widzi.
  UPDATE public.club_documents SET group_id = g_przemysl
   WHERE club_id = v_club AND group_id = g_biblio;
  UPDATE public.club_documents SET group_id = g_arch
   WHERE club_id = v_club AND group_id IN (g_debata, g_dossier, g_stanowis);
  UPDATE public.club_events SET group_id = g_arch
   WHERE club_id = v_club AND group_id IN (g_debata, g_dossier, g_stanowis, g_biblio);

  -- Licznik watkow NIE przeliczy sie sam: trigger na `club_threads` reaguje na
  -- `UPDATE OF status`, a nie na `group_id` - dokladnie z tego powodu
  -- `admin_club_thread_move` (A7) przelicza go jawnie po kazdym przenosinie.
  -- Bez tego szyna pokazywalaby liczbe watkow dzialu, ktory ich juz nie ma.
  UPDATE public.club_groups g SET thread_count = (
    SELECT count(*)::int FROM public.club_threads t
     WHERE t.group_id = g.id AND t.status NOT IN ('deleted', 'hidden', 'pending')
  ) WHERE g.id IN (g_debata, g_dossier, g_stanowis, g_biblio, g_arch, g_przemysl);

  -- ---- Wycofanie dzialow, ktore wyrazaly cudza os ---------------------------
  -- Warunek `NOT EXISTS` jest istotny: gdyby ktos zalozyl w tym dziale wlasny
  -- watek po zasiewie, archiwizacja schowalaby mu tresc. Dzial z resztkami
  -- zostaje aktywny i czeka na decyzje redakcji.
  UPDATE public.club_groups g SET status = 'archived'
   WHERE g.id IN (g_debata, g_dossier, g_stanowis, g_biblio)
     AND NOT EXISTS (
       SELECT 1 FROM public.club_threads t
        WHERE t.group_id = g.id AND t.status <> 'deleted'
     );

  -- Kuluary zostaja i dostaja kolejnosc na koncu listy: to nie jest temat,
  -- tylko rezim, wiec ma stac pod dzialami tematycznymi, a nie miedzy nimi.
  UPDATE public.club_groups SET sort_order = 90
   WHERE club_id = v_club AND slug = 'kuluary';

  RAISE NOTICE 'clubs A29: dzialy klubu referencyjnego przebudowane na tematyczne';
END
$rebuild$;
