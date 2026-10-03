-- ============================================================================
-- ARCHIWA: TŁO NAGŁÓWKA „ZDJĘCIE” DOSTAJE WRESZCIE ŹRÓDŁO OBRAZU
-- ============================================================================
--
-- PRZYCZYNA ŹRÓDŁOWA. `archive_layout_settings.hero_bg_style` od pierwszej
-- migracji tabeli (20260716135520) dopuszcza wartość 'image', a panel
-- (`ArchiveLayoutAdmin`) oferuje ją jako „Zdjęcie”. Renderer
-- (`HeroBackground`) umie narysować zdjęcie z propsu `imageUrl` - tyle że
-- adresu nie przechowywało NIC: tabela nie miała kolumny, `ArchiveHeader`
-- przekazywał sam styl, kategorie mają wyłącznie `logo_url`, a tagi żadnego
-- obrazu. Łańcuch urywał się już w bazie, więc żadna poprawka w samym
-- renderze nie mogła go domknąć.
--
-- SKUTEK. „Zdjęcie” było martwym ustawieniem: każda strona kategorii i tagu
-- z tym stylem po cichu schodziła na neutralne tło `bg-muted`, a redaktor nie
-- dostawał żadnego sygnału, że wybór nic nie robi - podgląd na żywo w panelu
-- pokazywał to samo neutralne tło, więc wyglądało to na „tak ma być”.
--
-- ROZWIĄZANIE. Kolumna `hero_image_url` na wierszu ustawień archiwum, czyli
-- per tenant i rodzaj archiwum - dokładnie tam, gdzie żyje sam styl tła, więc
-- styl i jego źródło zapisują się jednym upsertem panelu. NULL znaczy „brak
-- zdjęcia” i jest stanem domyślnym: istniejące wiersze nie zmieniają wyglądu,
-- a nagłówek bez zdjęcia nadal schodzi na neutralne tło.
--
-- KSZTAŁT ADRESU PILNOWANY W BAZIE, nie tylko w panelu. Wartość trafia do CSS
-- (`background-image`) na KAŻDEJ publicznej stronie archiwum tenanta, więc
-- zapis z pominięciem panelu (PostgREST, skrypt, ręczny UPDATE) nie może
-- wnieść ani obcego schematu, ani znaku, który rozrywa wartość CSS:
--   * `http(s)://` z niepustym hostem albo ścieżka w serwisie zaczynająca się
--     od POJEDYNCZEGO „/”. '//host' (adres bez schematu) i '/\host'
--     przeglądarka czyta jako obcy host, więc odpadają oba - podobnie jak
--     'https:///host'. `javascript:`, `data:` i każdy inny schemat nie
--     spełniają warunku początku, więc nie trzeba ich wyliczać;
--   * żadnych białych znaków, znaków sterujących (0x01-0x20, 0x7f) ani
--     odwrotnego ukośnika. Zakres podany JAWNIE w szesnastkowym, a nie klasą
--     `[[:space:]]`/`[[:cntrl:]]`: klasy zależą od locale bazy, więc w UTF-8
--     odrzucałyby więcej niż ta sama reguła w TypeScripcie i panel
--     przepuszczałby wartość, którą baza potem odrzuca bez komunikatu;
--   * najwyżej 2048 znaków - ten sam limit co
--     `speaker_profiles.card_institution_logo_url`.
-- Lustrem tej reguły jest `isHeroImageUrl` w `src/lib/archive/heroImage.ts`:
-- panel pokazuje po niej komunikat, zanim zapis dotrze do bazy, a render
-- odrzuca po niej wartość jeszcze raz (obrona w głąb) i składa CSS wyłącznie
-- z cytowanego, escapowanego `url("…")`.
--
-- UPRAWNIENIA BEZ ZMIAN. Granty tej tabeli są TABELOWE, nie kolumnowe
-- (20260716135520: SELECT dla anon i authenticated, INSERT/UPDATE dla
-- authenticated), więc nowa kolumna dziedziczy je sama i nie wymaga własnego
-- GRANT. Zapis nadal bramkuje polityka "Admins manage archive layout
-- settings" (admin albo super_admin w tenancie domowym, 20260728130410),
-- odczyt - "Archive layout settings are readable by tenant scope"
-- (`public_tenant_id()`, 20260716220420).
--
-- IDEMPOTENCJA. `ADD COLUMN IF NOT EXISTS` oraz `DROP CONSTRAINT IF EXISTS`
-- przed `ADD CONSTRAINT` - ponowne wykonanie daje ten sam stan i ponownie
-- sprawdza istniejące wiersze tą samą regułą.

ALTER TABLE public.archive_layout_settings
  ADD COLUMN IF NOT EXISTS hero_image_url text;

ALTER TABLE public.archive_layout_settings
  DROP CONSTRAINT IF EXISTS archive_layout_settings_hero_image_url_shape;

ALTER TABLE public.archive_layout_settings
  ADD CONSTRAINT archive_layout_settings_hero_image_url_shape CHECK (
    hero_image_url IS NULL
    OR (
      char_length(hero_image_url) <= 2048
      AND hero_image_url ~* '^(https?://|/)[^/]'
      AND hero_image_url !~ '[\x01-\x20\x7f\\]'
    )
  );

COMMENT ON COLUMN public.archive_layout_settings.hero_image_url IS
  'Zdjęcie w tle nagłówka archiwum dla hero_bg_style = ''image''. NULL = brak zdjęcia (neutralne tło). Tylko http(s):// albo ścieżka od pojedynczego "/", bez białych znaków i odwrotnego ukośnika, do 2048 znaków - lustro isHeroImageUrl w src/lib/archive/heroImage.ts.';
