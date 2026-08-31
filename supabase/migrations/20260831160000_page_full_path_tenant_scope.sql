-- IZOLACJA NAJEMCY W KANONICZNEJ SCIEZCE STRONY
-- Znalezisko otwarte od wydania 1 audytu pokrycia (rozdz. 8.4 wydania 7):
-- `public.page_full_path(_page_id uuid)` sklada kanoniczna sciezke strony
-- rekurencyjnym CTE idacym w gore po `pages.parent_id` BEZ PREDYKATU NAJEMCY.
--
-- DLACZEGO RLS TEGO NIE DOMYKA:
--   1. Funkcja jest LANGUAGE sql STABLE, czyli SECURITY INVOKER, ale
--      `src/lib/server/sitemapEntries.server.ts:75` wola ja spod SERVICE-ROLE
--      (klient `admin`), a service_role ma BYPASSRLS - nad funkcja nie ma wiec
--      zadnej polityki. TO JEST SCIEZKA, NA KTOREJ WYCIEK JEST REALNY, i to
--      dokladnie ona zasila sitemape oraz RSS.
--   2. Schemat tego nie domykal: `pages.parent_id` mial WYLACZNIE
--      `REFERENCES public.pages(id) ON DELETE RESTRICT` (migracja
--      20260531223436) - bez ograniczenia "ten sam najemca". Nic nie
--      przeszkadzalo wiec WYTWORZYC wiersza, ktory taki wyciek powoduje.
--
-- UCZCIWIE O ZASIEGU - sprawdzone na stanie KONCOWYM polityk (lokalna replika,
-- 931 migracji), nie na migracji zalozycielskiej. Polityka
-- `"Public reads published pages"` NIE jest dzis tenant-slepa: brzmi
-- `status = 'published' AND deleted_at IS NULL AND tenant_id = public_tenant_id()`,
-- czyli pod JWT `anon`/`authenticated` rekurencja i tak nie zobaczy wiersza
-- rodzica z obcego najemcy i lancuch urwie sie sam. Wyciek jest wiec realny
-- na sciezce SERVICE-ROLE, a nie "wszedzie" - i tak jest tu naprawiany.
-- Zapisuje to wprost, bo pierwsza wersja tego komentarza twierdzila, ze
-- polityka publiczna nie ma warunku najemcy (tak brzmi migracja zalozycielska
-- 20260531182153, ale pozniejsza ja zaostrzyla) - i to bylo NIEPRAWDA
-- o stanie dzisiejszym.
--
-- Nie zmienia to werdyktu o naprawie: zabezpieczenie, ktore trzyma sie
-- WYLACZNIE tego, ze RLS przypadkiem ukryje wiersz rodzica, jest zabezpieczeniem
-- przez skutek uboczny. Funkcje sa nadane `anon, authenticated, service_role`
-- i maja bronic same siebie.
--
-- SKUTEK: strona, ktorej rodzic nalezy do innego najemcy, wnosila JEGO slug do
-- sciezki kanonicznej publikowanej w sitemapie (`sitemapEntries.server.ts`),
-- w podgladzie SEO (`SeoPanel.tsx:131`) i na liscie zapisanych stron
-- (`SavedSection.tsx:79`).
--
-- Ta migracja zamyka dziure na DWA sposoby, bo jeden nie wystarcza: naprawa
-- funkcji chroni ODCZYT istniejacych danych, ograniczenie schematu nie
-- pozwala takich danych WYTWORZYC.

-- ===========================================================================
-- 1) PREDYKAT NAJEMCY W REKURENCJI
-- ===========================================================================
-- Predykat jest SAMO-ZAKOTWICZONY: rekurencja wymaga, zeby rodzic byl w tym
-- samym najemcy co DZIECKO (`p.tenant_id = c.tenant_id`), a kotwica bierze
-- najemce z wiersza startowego. NIE uzywamy tu `current_tenant_id()` i jest to
-- decyzja, nie przeoczenie: funkcje wola sitemap spod service-role, gdzie
-- kontekst najemcy jest NULL - filtr po sesji wywrocilby wtedy KAZDA sciezke
-- do NULL-a, czyli zamienil ciche naruszenie izolacji na cicha awarie
-- produkcyjna. Zakotwiczenie w wierszu startowym daje ten sam skutek
-- bezpieczenstwa niezaleznie od tego, kto i z jakimi uprawnieniami wola.
--
-- ZACHOWANIE PRZY NARUSZENIU: lancuch urywa sie na granicy najemcy, wiec
-- strona z rodzicem u obcego najemcy dostaje sciezke ZLOZONA WYLACZNIE
-- z wlasnych segmentow. Zaden obcy slug nie wchodzi do wyniku - a to jest
-- cala tresc tego znaleziska.

CREATE OR REPLACE FUNCTION public.page_full_path(_page_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH RECURSIVE chain AS (
    SELECT id, parent_id, slug, tenant_id, 1 AS depth
      FROM public.pages
     WHERE id = _page_id
    UNION ALL
    SELECT p.id, p.parent_id, p.slug, p.tenant_id, c.depth + 1
      FROM public.pages p
      JOIN chain c ON p.id = c.parent_id
     WHERE c.depth < 50
       -- Granica najemcy: rodzic musi siedziec w tym samym obszarze roboczym.
       AND p.tenant_id = c.tenant_id
  )
  SELECT string_agg(slug, '/' ORDER BY depth DESC) FROM chain;
$$;

GRANT EXECUTE ON FUNCTION public.page_full_path(uuid) TO anon, authenticated, service_role;

-- Wariant WSADOWY ma DOKLADNIE TE SAMA dziure i to jest osobne znalezisko tej
-- migracji: audyt nazywal tylko funkcje pojedyncza, a `page_full_paths`
-- (migracja 20260724150000, przedefiniowana w 20260724184141) powtarza te sama
-- rekurencje bez najemcy - i wlasnie ONA obsluguje dzis sitemape wsadowo
-- (`sitemapEntries.server.ts`) oraz archiwa i wyszukiwarke. Naprawa jednej bez
-- drugiej zostawilaby dziure w scieżce, ktora ma WIEKSZY ruch.
--
-- Komentarz oryginalu twierdzil: „SECURITY INVOKER: RLS na public.pages
-- obowiazuje jak przy wywolaniach per-id, wiec funkcja nie ujawnia nic ponad
-- to, co wolajacy i tak by odczytal". To bylo NIEPRAWDA z powodow 1 i 2 wyzej
-- i dlatego zostaje tu sprostowane, a nie przepisane.

CREATE OR REPLACE FUNCTION public.page_full_paths(_page_ids uuid[])
RETURNS TABLE(page_id uuid, full_path text)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH RECURSIVE requested AS (
    SELECT DISTINCT unnest(_page_ids) AS root_id
  ),
  chain AS (
    SELECT r.root_id, p.id, p.parent_id, p.slug, p.tenant_id, 1 AS depth
      FROM requested r
      JOIN public.pages p ON p.id = r.root_id
    UNION ALL
    SELECT c.root_id, p.id, p.parent_id, p.slug, p.tenant_id, c.depth + 1
      FROM public.pages p
      JOIN chain c ON p.id = c.parent_id
     WHERE c.depth < 50
       -- Granica najemcy - identycznie jak w wariancie pojedynczym.
       AND p.tenant_id = c.tenant_id
  )
  SELECT root_id AS page_id, string_agg(slug, '/' ORDER BY depth DESC) AS full_path
    FROM chain
    GROUP BY root_id;
$$;

GRANT EXECUTE ON FUNCTION public.page_full_paths(uuid[]) TO anon, authenticated, service_role;

-- ===========================================================================
-- 2) OGRANICZENIE SCHEMATU: parent_id WSKAZUJE STRONE TEGO SAMEGO NAJEMCY
-- ===========================================================================
-- WYBOR MECHANIZMU - zadanie kazalo uzasadnic „CHECK z funkcja albo trigger".
-- Wybieram TRZECIA opcje, bo jest scisle mocniejsza od obu:
-- ZLOZONY KLUCZ OBCY `(parent_id, tenant_id) -> (id, tenant_id)`.
--
--   * CHECK Z FUNKCJA JEST NIEPOPRAWNY, nie tylko slabszy. Postgres wymaga od
--     wyrazenia CHECK immutable-osci i sprawdza je WYLACZNIE przy zapisie
--     TEGO wiersza. Funkcja czytajaca inny wiersz lamie oba zalozenia: nie
--     jest immutable (wynik zalezy od stanu tabeli), a przy zmianie
--     `tenant_id` RODZICA nikt jej nie przelicza - dziura wraca cicho.
--     `pg_dump`/`pg_restore` dokladaja drugi problem: CHECK jest odtwarzany
--     przed danymi, wiec restore rzuca sie na wierszach, ktore w zrodle byly
--     legalne.
--   * TRIGGER jest poprawny, ale drozszy i mniej szczelny: trzeba go napisac
--     na OBU kierunkach (zmiana `parent_id`/`tenant_id` dziecka ORAZ zmiana
--     `tenant_id` rodzica majacego dzieci), sam nie chroni przed wyscigiem bez
--     jawnego blokowania wiersza rodzica, i da sie go wylaczyc
--     (`ALTER TABLE ... DISABLE TRIGGER`) - co ta baza REALNIE robi w testach
--     pgTAP (patrz `ALTER TABLE auth.users DISABLE TRIGGER USER`).
--   * ZLOZONY FK zalatwia oba kierunki JEDNA deklaracja: Postgres pilnuje
--     zarowno zapisu dziecka, jak i zmiany `tenant_id` rodzica (bo rodzic jest
--     wtedy referencowanym wierszem), robi to pod wlasciwa blokada, nie da sie
--     tego pominac spod service-role i przezywa dump/restore.
--
-- Warunek wstepny: klucz obcy potrzebuje UNIQUE po stronie referencowanej.
-- `id` jest kluczem glownym, wiec UNIQUE (id, tenant_id) jest spelnione
-- trywialnie - to indeks pomocniczy, nie nowe ograniczenie biznesowe.
--
-- MATCH SIMPLE (domyslny) jest tu tym, czego chcemy: gdy `parent_id IS NULL`,
-- ograniczenie jest spelnione bez sprawdzania - strony korzeniowe zostaja
-- nietkniete. `tenant_id` jest NOT NULL, wiec drugiej kolumny nie trzeba
-- rozwazac.

-- Postgres nie ma `ADD CONSTRAINT IF NOT EXISTS`, a ta migracja MUSI dac sie
-- odtworzyc (bramka `check:sql-migration-replay` trzyma inwariant "baze da sie
-- odtworzyc z migracji"). Bez oslony powtorne wykonanie pliku wywraca sie na
-- duplikacie i - co gorsze - przerywa go PRZED zalozeniem klucza obcego nizej,
-- czyli zostawia baze z polowa naprawy. Zweryfikowane wprost na lokalnej
-- replice: przebieg bez oslony konczyl sie brakiem `pages_parent_same_tenant_fkey`
-- i pieciu czerwonymi asercjami pgTAP.
DO $$ BEGIN
  ALTER TABLE public.pages ADD CONSTRAINT pages_id_tenant_id_key UNIQUE (id, tenant_id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;

-- NAPRAWA DANYCH PRZED ZALOZENIEM OGRANICZENIA.
-- Swiadomie NIE uzywam `NOT VALID`: ograniczenie dodane jako NOT VALID pilnuje
-- wylacznie NOWYCH zapisow, a istniejace naruszenia zostawia w bazie - czyli
-- dokladnie te wiersze, ktore juz dzis wnosza obcy slug do sitemapy. Zamiast
-- tego odczepiamy takie strony od obcego rodzica (`parent_id := NULL`, czyli
-- strona staje sie korzeniowa) i mowimy w logu migracji, ilu wierszy dotyczylo.
-- Utrata informacji jest tu POZORNA: relacja rodzic-dziecko przez granice
-- najemcy nie ma sensu produktowego, a sciezka kanoniczna po naprawie funkcji
-- wyzej i tak juz jej nie uwzglednia.
DO $$
DECLARE
  v_fixed int;
BEGIN
  WITH bad AS (
    SELECT c.id
      FROM public.pages c
      JOIN public.pages p ON p.id = c.parent_id
     WHERE c.parent_id IS NOT NULL
       AND p.tenant_id <> c.tenant_id
  )
  UPDATE public.pages
     SET parent_id = NULL
   WHERE id IN (SELECT id FROM bad);
  GET DIAGNOSTICS v_fixed = ROW_COUNT;
  IF v_fixed > 0 THEN
    RAISE NOTICE 'page_full_path tenant scope: odczepiono % stron od rodzica u obcego najemcy', v_fixed;
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE public.pages
    ADD CONSTRAINT pages_parent_same_tenant_fkey
    FOREIGN KEY (parent_id, tenant_id)
    REFERENCES public.pages (id, tenant_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Istniejacy `parent_id -> pages(id)` NIE jest usuwany. Zlozony FK go
-- funkcjonalnie zawiera, ale zdjecie starego ograniczenia to osobna zmiana
-- o innym profilu ryzyka (nazwa ograniczenia wystepuje w komunikatach bledow,
-- na ktore moga byc napisane asercje) - a ta migracja ma domykac izolacje,
-- nie porzadkowac schemat.

COMMENT ON CONSTRAINT pages_parent_same_tenant_fkey ON public.pages IS
  'Strona-rodzic musi nalezec do tego samego najemcy. Domyka izolacje kanonicznej sciezki (public.page_full_path / page_full_paths).';
