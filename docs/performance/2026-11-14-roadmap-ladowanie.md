# Roadmap: ładowanie stron i modułów, SSR, Speed Index (2026-11-14)

Gałąź robocza: `claude/kind-brown-vrah7o`. Dokument roboczy wykonawcy: kolejność
prac, zakres każdej pozycji, sposób weryfikacji i warunki stopu. Aktualizować
kolumnę „Stan" po każdej pozycji.

## 0. Punkt wyjścia (pomiar z 14.11.2026)

PageSpeed Insights, strona główna, Lighthouse 13.6.0:

| Wskaźnik    | Telefon | Komputer |
| ----------- | ------: | -------: |
| Wydajność   |      93 |       96 |
| FCP         |   1,2 s |    0,3 s |
| LCP         |   2,0 s |    0,5 s |
| TBT / CLS   |   0 / 0 |    0 / 0 |
| Speed Index |   6,2 s |    2,1 s |
| Dostępność  |      95 |       92 |

Speed Index odpowiada za ~5,6 z ~6,4 utraconych punktów na telefonie i za
całość ubytku na komputerze. Jest pochodną czasu odpowiedzi serwera
(`2026-10-22-speed-index.md` §1: +1 s TTFB = +1,4 s SI telefon, +0,6 s komputer).

Czas do pierwszego bajtu, `curl` z kolonii IAD, po dwa żądania na trasę:

| Trasa                     |        TTFB | Cache        | Zapytania | Uwaga                        |
| ------------------------- | ----------: | ------------ | --------: | ---------------------------- |
| `/`                       |   2,5–5,3 s | MISS (3 z 5) |     14–17 | HIT 0,38 s, STALE 0,76 s     |
| `/blog`                   |   1,6–2,6 s | MISS         |     10–13 |                              |
| `/blog/<wpis>`            | 0,3 / 3,3 s | STALE / MISS |        20 | suma czasów zapytań 7,3 s    |
| `/wydarzenia`             |   2,6–3,4 s | MISS         |        20 |                              |
| `/login`                  |   2,2–2,4 s | BYPASS       |         0 | sam zimny start izolatu      |
| `/kontakt`, `/en`         |   0,7–1,1 s | MISS         |       5–7 | ciepły izolat, bez trafienia |
| adres nieistniejący (404) |   2,3–3,5 s | MISS         |     15–17 | pełny render strony błędu    |

Stałe ograniczenie: produkcja działa na runtime Lovable (`x-deployment-id:
psr2.*`), współdzielony cache dokumentów jest martwy (`nes-l2-fail;desc="put"`),
każdy zimny izolat renderuje od zera.

## 1. Zasady wykonania

1. Jedna pozycja = jeden commit z testem przypinającym zachowanie. Bez commitów
   zbiorczych.
2. Po każdej pozycji: testy modułu, `bun run typecheck:tsc`, `bun run lint` na
   zmienionych plikach; przed wypchnięciem partii `bun run verify:blocking`
   oraz bramki `check:bundle`, `check:chunks`, `check:entry-purity`,
   `check:server-entry-purity`, `check:document-weight`, `check:ts-sql-contract`.
3. Reguły `AGENTS.md` obowiązują bez wyjątków. W szczególności: schemat tylko
   przez `supabase/migrations` + `bun run migrations:mirror`; żadnej ręcznej
   edycji `drizzle/`; wdrożenie migracji wyłącznie przez właściciela.
4. HTML serwera ma być równy stronie po hydratacji. Każda zmiana znaczników
   SSR dostaje test równoważności albo porównanie dokumentu przed/po.
5. Pomiar przed i po: `scripts/performance/lighthouse-local.mjs --compare`
   (telefon i komputer) oraz laboratorium zimnego renderu z opóźnieniem
   150 ms na zapytanie. Liczby wpisywać do tego dokumentu.
6. Nie pushować bez zielonej partii; PR dopiero na prośbę właściciela.

## 2. Partie prac

### Partia A. Dostępność i higiena linków (niskie ryzyko, bez migracji)

| #   | Pozycja                                                                                                                                                                                                                                                                              | Pliki                                                                                                                                                                                     | Weryfikacja                                                                                              | Stan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Etykieta sekcji jako nagłówek 2. stopnia (`role="heading" aria-level=2`), żeby strona nie skakała z `h1` na `h3`                                                                                                                                                                     | `src/lib/builder/sectionLabelVariants.tsx`                                                                                                                                                | testy `sectionLabel*.test.tsx` + nowy test roli; miniatury `sm` i puste etykiety bez roli                | wykonane (test `sectionLabelHeadingRole.test.tsx`, 24 przypadki)                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| A2  | Kanoniczne adresy wpisów w widgetach zamiast `/post/<slug>` (dziś każde kliknięcie = 301 + 2 odczyty bazy). Wspólny pomocnik `postHref`; ścieżka rodzica z osadzenia `pages` w tym samym zapytaniu (zero dodatkowych podróży); zapas `/post/<slug>` gdy rodzic zagnieżdżony/nieznany | nowy `src/lib/routing/postHref.ts`; `latestPostsSuperset.ts`, `postListQuery.ts`, `sliderPostsQuery.ts`; `PostListView.tsx`, `PostsSliderWidget.tsx`; potem pozostałe widoki (lista w §4) | test równości kolumn nadzbioru; test pomocnika; `check:ts-sql-contract`; dokument `/` bez `href="/post/` | wykonane dla post-listy, slidera, pasków news-ticker i trending-now oraz listy ocenianej (`b38389cf`, `8c83feb7`, `51ba632b`): adres kanoniczny z osadzenia strony-rodzica w tym samym zapytaniu, zapas `/post/<slug>`. Zostają: bloki treści (7 widoków, `POST_SELECT` w `lib/queries/blocks.ts`), lista `/blog`, mega menu, wyszukiwarka, lista do przeczytania; `get_post_refs` i rekomendacje wymagają zmiany RPC (E). Po wdrożeniu sprawdzić jednym żądaniem anon, że `parent_page` wraca wypełnione |
| A3  | Kontrast i wielkość celów dotykowych (komputer)                                                                                                                                                                                                                                      | do ustalenia                                                                                                                                                                              | lokalny Lighthouse (lista elementów)                                                                     | wymaga listy elementów z audytu                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| A4  | Wymiary logotypów SVG (`width`/`height` albo `aspect-ratio`)                                                                                                                                                                                                                         | komponent logo nagłówka i stopki                                                                                                                                                          | audyt „unsized-images" pusty; CLS bez zmian                                                              | na gałęzi (`0a29a634`…`e69fec57`, 19 commitów; próg bramki `05f62691`): naturalny rozmiar pliku jako atrybuty `width`/`height` dla logo pasków, logo motywu i własnego pliku widgetu obrazu; pomiar w panelu (układ strony, bez `fetch`) przy zapisie opcji motywu i w edytorze obrazu. Bez zapisanych wymiarów znaczniki są jak dotąd (złote wzorce HTML). Dwa przeglądy, 7 znalezisk zamkniętych; druga tura poprawek bez osobnego przeglądu. Wymaga kroków właściciela po wdrożeniu (§8)               |

### Partia B. Koszt renderu serwera na każdej trasie (średnie ryzyko, bez migracji)

| #   | Pozycja                                                                                                                                                         | Pliki (start rozpoznania)                                                        | Weryfikacja                                                               | Stan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Strona 404: dziś 15–17 zapytań i brak zapisu w cache. Cel: krótki negatywny cache dokumentu 404 per ścieżka i render bez fali widgetów treści                   | `src/routes/$.tsx`, `src/lib/http/documentCache.server.ts`, `notFoundIfClean.ts` | laboratorium: 2. żądanie tego samego 404 bez zapytań; test polityki cache | patrz §6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| B2  | Wpis: 20 zapytań na zimnym renderze. Inwentaryzacja fal, scalenie odczytów nad zgięciem, reszta za odpowiedzią                                                  | `src/routes/$.tsx`, `src/lib/queries/*`                                          | `report:route-loaders`; laboratorium zimnego renderu przed/po             | wykonane (`f083856e`, `25716f3d`, `400ea444`, `e62d09ab`) i poprawione po niezależnym przeglądzie: łańcuch treści wpisu 4 fale -> 2, zapytania trasy 11 -> 10 (model z kodu i testów, bez pomiaru). Przegląd w dwóch z trzech perspektyw: 0 usterek poważnych, 4 drobne naprawione (kolejność `resolve_path` na drucie, podpowiedź tylko dla możliwego sluga, wyrejestrowanie słuchacza reklam, lot reklam pod `waitUntil`). Trzecią perspektywę (osadzenie współautorów, cache konfiguracji) sprawdzono ręcznie w migracjach |
| B3  | Wydarzenia: 20 zapytań na liście; liście bez loadera, `events.$slug` grzeje 2 z ~9                                                                              | `src/routes/events*.tsx`                                                         | jak B2                                                                    | rozpoznane: moduł jest na podłodze (katalog 1 odczyt, strona wydarzenia 2 równoległe, zakładki 0); 20 zapytań `/wydarzenia` to strona CMS w `$.tsx`. Scalone: zapadka budżetu zapytań (`e01afc24`) i zaproszenie z pakietu poza wspólnym cache (`57f7c3ee`). Dalej: RPC `event_page_bootstrap` (E) i decyzja, która lista jest kanoniczna                                                                                                                                                                                     |
| B4  | Trasy bez trafienia na ciepłym izolacie (`/kontakt`, `/en` MISS dwa razy): ustalić, czy dokument dostaje `no-store` z degradacji, czy to rotacja izolatów       | `documentCache.server.ts`, `cachePolicy.ts`                                      | nagłówki odpowiedzi + pierścień decyzji cache                             | patrz §7                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| B5  | Podpowiedź obrazu LCP zapisywana przy publikacji strony, żeby preload trafiał do `<head>` także na zimnym renderze (strona główna, wydarzenia, autor, programy) | `src/routes/index.tsx`, `lcpCandidate`, zapis strony w builderze                 | dokument zimnego renderu ma preload okładki w `<head>`                    | niezaczęte                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### Partia C. Start zimnego izolatu (wysokie ryzyko, osobny PR)

| #   | Pozycja                                                                                                                              | Weryfikacja                                                                    | Stan                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | „Front door": podanie dokumentu z cache w `src/server.ts` przed importem routera. Zysk dopiero przy działającym cache współdzielonym | lokalny workerd: TTFB pierwszego żądania przy HIT; `check:server-entry-purity` | oceniony projekt, bez implementacji (`2026-11-15-zimny-start-c2.md` §7): nie omija kompilacji skryptu, na obecnym hostingu wymaga magazynu w bazie; czeka na W1                                                                               |
| C2  | Dalszy podział kodu serwera (`/login` płaci >2 s bez bazy): trasy profilu, checkoutu, wydarzeń-studio leniwie także na serwerze      | rozmiar artefaktu i liczba modułów; równoważność HTML 11 adresów               | wykonane w części (`2026-11-15-zimny-start-c2.md`): SDK MCP poza domknięciem dokumentu, zaślepki tras `ssr: false` i `/profile/*`; 1 893 → 1 796 modułów, 14,11 → 13,23 MB, lokalnie −3 % (`/login`) i −7 % (`/`) zimnego startu; reszta w §8 |

### Partia D. Klient (średnie ryzyko)

| #   | Pozycja                                                                                                                  | Weryfikacja                                          | Stan             |
| --- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ---------------- |
| D1  | `vendor-supabase` (53 KiB gz) poza bootem gościa (plan P3.1)                                                             | `check:chunks`; ślad sieci anonimowej strony głównej | niezaczęte       |
| D2  | Podział `styles.css` (563 KB / 82 KB gz, blokuje render na każdej trasie): reguły panelu i modułów poza arkusz publiczny | rozmiar arkusza publicznego; zrzuty przed/po         | niezaczęte       |
| D3  | Liście `$initial` z modułów mieszanych boot/admin w `app-initial` (≤ 15–20 KB gz)                                        | `check:bundle`, `report:chunk-inventory`             | niezaczęte       |
| D4  | Rejestry ikon `import * as` → `DynamicIcon`; decyzja o zestawie Font Awesome                                             | `check:menu-icons`, rozmiar chunku ikon              | czeka na decyzję |

### Partia E. Zapytania scalone w RPC (wymaga migracji i wdrożenia przez właściciela)

| #   | Pozycja                                                                                  | Stan           |
| --- | ---------------------------------------------------------------------------------------- | -------------- |
| E1  | `chrome_bootstrap` / `public_bootstrap`: ustawienia + tokeny + menu + pasek w jednym RPC | czeka na zgodę |
| E2  | `get_public_homepage(slug)`: wiersz strony + treść kanwy                                 | czeka na zgodę |

Każda migracja: plik w `supabase/migrations`, `bun run migrations:mirror`,
granty zgodne z regułą (server-only → `service_role`), `generate:ts-sql-contract`,
kod z zapasowym odczytem na czas między wdrożeniem kodu a migracji.

### Partia F. Usuwanie martwego kodu (bez wpływu na SI, porządek)

Lista z `2026-10-22-speed-index.md` §6: 34 manifesty `ggm-2021`, moduł hubu I9,
zestaw Font Awesome. Każda pozycja po sprawdzeniu importów (`knip`) i, dla
manifestów, odwołań w treści bazy. Usuwam tylko pozycje z zerem importerów;
reszta do decyzji właściciela.

## 3. Poza kodem: decyzje właściciela

| #   | Decyzja                                                                                              | Skutek                                                   |
| --- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| W1  | Przeniesienie produkcji na Worker we własnym koncie Cloudflare, Smart Placement, Brotli, Early Hints | jedyna dźwignia sprowadzająca SI telefonu do ~1,4–2,2 s  |
| W2  | `vars.LHCI_URL`, `vars.LHCI_EXTRA_PATHS`, `PSI_API_KEY`                                              | pomiar tras innych niż główna, telefon i komputer        |
| W3  | Decyzja DPO: anonimowe metryki czasowe bez zgody                                                     | widoczność pierwszego wejścia czytelnika                 |
| W4  | Zgoda na migracje z partii E i ich wdrożenie                                                         | −2…−3 fale zapytań na każdej trasie                      |
| W5  | Font Awesome: zostaje czy wychodzi                                                                   | odblokowuje D4; ROZSTRZYGNIĘTE 16.11.2026: usunąć (§9.6) |

## 4. Kolejność i warunki stopu

Kolejność: A1 → A2 → B1 → B4 → B5 → B2 → B3 → D1 → A3/A4 → D2 → D3 → C2 → C1 → F.
Partia E równolegle po zgodzie W4.

Zatrzymuję się i pytam, gdy: zmiana wymaga migracji; test równoważności HTML
nie przechodzi; bramka bundla rośnie; pozycja dotyka zgody/pomiaru (reguły
`AGENTS.md` o gtag i zgodach); pomiar po zmianie nie pokazuje zysku (wtedy
wycofanie zamiast dokładania).

Widoki do objęcia pomocnikiem `postHref` po `PostListView`/`PostsSliderWidget`:
`NewsTickerView`, `TrendingNowView`, `TailoredMustReadsView`, `TrendingTicker`,
`FoxizExtraViews`, `LatestPostsView`, `PostContextViews`, `ContextBlockViews`,
`NavLoopViews`, `CalendarView`, `PostListCard`, `ReadingListPostCard`,
`contentRefs.ts`, `ratedListQuery.ts`. Adresy w panelu (`MenuManager`,
`AddItemPanel`, `SliderEditor`, `PageUrlAutocomplete`) zapisują się do treści
CMS: osobna pozycja, bez przepisywania istniejących danych.

## 5. Czego ten plan nie obiecuje

Bez W1 Speed Index w PSI pozostanie zależny od losowego trafienia w zimny
izolat (rozrzut sekund między przebiegami). Partie A–D skracają zimny render
i liczbę zapytań, ale nie zastąpią działającego cache współdzielonego.
Moduły klubów, podcastów i cennika nie zostały zmierzone pod właściwymi
adresami (sprawdzone ścieżki zwróciły 404); pomiar uzupełnić przed B2/B3.

## 6. B1: strona 404 - wynik (2026-11-14)

Stan: fale zapytań i pamięć izolatu wykonane; cache dokumentu 404 świadomie
nie (§6.3); jedna podróż do bazy wymaga migracji (§6.4).

### 6.1. Co robi 404 nieznanego adresu jednosegmentowego

Loadery korzenia i trasy `/$` biegną równolegle (router uruchamia je jako
osobne zadania), więc fale trasy chowają się w cieniu fal powłoki, o ile jest
ich nie więcej niż fal powłoki (dwie).

Trasa `/$` przed zmianą (`73cabcb7`):

| Fala | Zapytanie (plan anon)                | Miejsce                                              | Pamięć izolatu      |
| ---- | ------------------------------------ | ---------------------------------------------------- | ------------------- |
| T1   | RPC `resolve_path`                   | `lib/queries/public.ts:715` (`$.tsx:467`)            | 60 s, także `null`  |
| T1   | `post_layout_settings`               | `hooks/usePostLayoutSettings.ts:17` (`$.tsx:465`)    | 60 s                |
| T1   | RPC `get_related_posts_config`       | `lib/queries/relatedPostsConfig.ts:40` (`$.tsx:466`) | brak                |
| T2   | `categories` po slugu                | `$.tsx:501`                                          | brak                |
| T2   | `tags` po slugu                      | `$.tsx:502`                                          | brak                |
| T3   | `posts` po slugu (stary adres wpisu) | `lib/routing/legacyPostPath.ts` (`$.tsx:519`)        | 5 min, także `null` |
| (T4) | RPC `page_full_path`, gdy wpis jest  | `lib/routing/legacyPostPath.ts`                      | razem z T3          |

T4 biegnie tylko wtedy, gdy wpis istnieje, czyli przy 301, nie przy 404.

Powłoka (korzeń, `__root.tsx`), bez zmian w tej pozycji:

| Fala | Zapytanie                                               | Miejsce                                                     |
| ---- | ------------------------------------------------------- | ----------------------------------------------------------- |
| K1   | `menus` + `menu_items` dla `main` i `footer` (2)        | `__root.tsx:802` -> `lib/menus/menu.functions.ts:251`       |
| K1   | adresy pozycji menu (strony, wpisy, taksonomie)         | `lib/menus/refResolution.ts:200-314`                        |
| K1   | `site_settings`                                         | `__root.tsx:883` -> `lib/useSiteSetting.ts:34`              |
| K1   | `site_design_tokens` (tokeny, kolory, skala: jeden lot) | `lib/builder/designTokens.ts:88`                            |
| K2   | pasek „Na czasie" (`trending_posts`, wpisy, ścieżki)    | `__root.tsx:1043` -> `lib/views/postViews.functions.ts:200` |
| K2   | `builder_popups` (sygnał „brak popupów")                | `__root.tsx:1094` -> `lib/builder/popups.ts:240`            |
| K2   | zapytania widgetów nagłówka i stopki (zależne od CMS)   | `__root.tsx:1114` -> `lib/builder/prefetch.ts:643`          |

Sama strona 404 (`PublicNotFound`) nie ma widgetów treści i niczego nie
pobiera; fala wtórna trasy (sekcje nad zgięciem, bloki, reklamy) nie startuje,
bo loader rzuca wcześniej. Monitor 404 (`record_seo_404`) biegnie za
odpowiedzią pod `waitUntil` planem service-role (`src/start.ts`,
`seo404Middleware`) i nie wchodzi ani do TTFB, ani do `db;desc="n=..."`.

Rachunek zgadza się z pomiarem: zimny izolat to 6 zapytań trasy i 9-11
powłoki (razem 15-17); ciepły izolat z adresem widzianym pierwszy raz to 5
(tabela trasy bez `post_layout_settings`), powłoka 0.

### 6.2. Po zmianie

| Przypadek (zapytania trasy)                      | Przed               | Po                  |
| ------------------------------------------------ | ------------------- | ------------------- |
| zimny izolat, zwykły slug (`/nie-ma-strony`)     | 6 zapytań, 3 fale   | 6 zapytań, 2 fale   |
| zimny izolat, adres skanera (`/wp-login.php`)    | 6 zapytań, 3 fale   | 3 zapytania, 1 fala |
| zimny izolat, wielosegmentowy (`/a/nie-ma`)      | 4 zapytania, 2 fale | 4 zapytania, 2 fale |
| ciepły izolat, adres pierwszy raz, zwykły slug   | 5 zapytań, 3 fale   | 5 zapytań, 2 fale   |
| ciepły izolat, adres pierwszy raz, adres skanera | 5 zapytań, 3 fale   | 2 zapytania, 1 fala |
| ciepły izolat, ten sam adres ponownie (do 60 s)  | 3 zapytania, 2 fale | 1 zapytanie, 1 fala |

Powłoka bez zmian (9-11 zapytań na zimnym izolacie, 0 na ciepłym). Liczby
„po" wynikają z testów jednostkowych loadera i z kodu; nie były mierzone na
produkcji ani w laboratorium zimnego renderu (wymaga builda).

Zmiany:

1. Kategoria, tag i stary adres wpisu idą jedną falą
   (`lib/routing/missingPathLookups.ts`); pierwszeństwo taksonomii rozstrzyga
   `resolveMissingContent`, nie kolejność zapytań.
2. Wynik tej fali, także negatywny, leży w jednym wpisie `edgeTtlCache` na
   60 s, bez serve-stale; błąd bazy nie jest zapamiętywany.
3. Segment spoza alfabetu slugów (`canBeStoredSlug`) nie pyta o archiwum ani
   o stary wpis i nie zajmuje wpisu w pamięci izolatu. `resolve_path` pyta
   nadal dla każdego adresu.
4. Błąd odczytu starego adresu wpisu nie jest już zapamiętywany jako „wpisu
   nie ma" na 5 minut (dotyczy też `/post/<slug>`).

Poza zakresem tej pozycji, bo to kod wspólny ze ścieżką wpisu (B2):
`post_layout_settings` i `get_related_posts_config` startują przed rezolucją
treści, więc płaci je także 404. Drugie nie ma pamięci izolatu i to ono jest
ostatnim zapytaniem powtórzonego 404. Na zimnym izolacie fala 1 ma przez nie
7 równoległych podżądań planu anon (4 korzenia i 3 trasy) przy limicie 6.

### 6.3. Cache dokumentu 404: decyzja „nie"

Czysty 404 zostaje `private, no-store`. Powody, każdy z kodu:

- **Purge nie obejmuje publikacji, która zamienia 404 w treść.** Publikacja
  zaplanowana to `publish_due_posts()` i `publish_due_pages()` z `pg_cron` co
  minutę: czysty SQL, bez wywołania purge'a. Publikacja wpisu z panelu czyści
  selektywnie (`postDocumentPaths`): adres kanoniczny tylko wtedy, gdy RPC
  ścieżki rodzica odpowiedział, a płaskiego starego adresu `/<slug>` (404 -> 301) nie ma na liście wcale. Purge L1 sięga wyłącznie izolatu, który
  obsłużył zapis, purge L2 jego kolonii.
- **Zostaje sam TTL, a ten się sumuje.** Decyzja 404 stoi na odczycie
  `public:resolved:` z własną minutą świeżości i serve-stale do 5 minut;
  dokument zapisany z takiego odczytu żyłby kolejną minutę ponad niego.
- **Magazyn nie zna statusu.** `DocumentCacheEntry` i wpis L2 nie niosą
  statusu, `replay()` oddaje zawsze 200, `documentStorePolicy` odrzuca
  nie-200, `planDefaultCacheControl` nadaje odpowiedziom nie-200 tylko opt-out
  albo dyrektywę 301/308, a granica odpowiedzi nadaje dyrektywę trasy tylko
  odpowiedziom `ok`. To pięć miejsc na najbardziej krytycznej ścieżce i zmiana
  formatu wpisu L2.
- **Wypieranie.** Dokument 404 ma około 218 KB; budżet L1 to 24 MiB wspólnego
  LRU, więc około 110 różnych nietrafionych adresów wypiera wszystkie
  prawdziwe dokumenty izolatu. Potrzebny byłby osobny budżet.
- **Zysk.** Adresy z rozszerzeniem (większość ruchu skanerów)
  `planDocumentCache` i tak omija. Dla pozostałych trafienie wymaga tego
  samego adresu dwa razy w ciągu minuty w tym samym izolacie, a na obecnym
  hostingu kolejne żądania trafiają w różne izolaty i L2 nie działa. Po
  zmianach z §6.2 takie powtórzenie kosztuje jedno zapytanie; cache dokumentu
  oszczędziłby już tylko CPU renderu.

Do ponownej oceny po W1 (działające L2). Warunki: status we wpisie L1 i L2,
okno stale równe 0, świeżość dziedziczona po odczytach negatywnych (dokument
nie żyje dłużej niż one), osobny budżet bajtów, nigdy dla 404 zdegradowanego.

### 6.4. Jedna podróż zamiast dwóch fal: wymaga migracji (partia E)

`resolve_public_path(_segments text[])` zwracające w jednym wierszu `page_id`,
`post_id`, `category_slug`, `tag_slug` i `legacy_post_path`: ciało
`resolve_path`, a przy braku trafienia kategoria i tag po gołym slugu oraz
opublikowany wpis po ostatnim segmencie ze ścieżką rodzica (`page_full_path`).
`STABLE`, `SECURITY INVOKER` (RLS i `public_tenant_id()` jak dziś), `EXECUTE`
dla `anon` i `authenticated` (płaszczyzna publiczna, jak `resolve_path`). Kod
z zapasem: przy `PGRST202` (funkcji jeszcze nie ma) dzisiejsza ścieżka.
Skutek: 404 i 301 ze starego adresu w jednej fali i jednym zapytaniu trasy.

## 7. B4: MISS dwa razy na ciepłym izolacie - ustalenie z kodu

Defektu w kodzie nie znalazłem. Czysty dokument 200 nie wraca z L1 na ciepłym
izolacie z jednego z poniższych powodów; trzy pierwsze tłumaczą pomiar.

1. **To nie ten sam izolat.** `cold=0` w `nes-iso` znaczy tylko, że izolat
   miał już załadowane entry routera (`src/server.ts`, `coldEntry`), a nie że
   renderował tę ścieżkę. L1 jest per izolat, więc pierwsze żądanie ścieżki
   w każdym ciepłym izolacie to MISS. Dla `/kontakt` przemawia za tym liczba
   zapytań: 5-7 przy obu żądaniach to pełna rezolucja strony (`resolve_path`
   i cztery odczyty wiersza), którą w tym samym izolacie przez 60 s pochłania
   `public:resolved:`; drugie żądanie miałoby ich najwyżej 2-3.
2. **Render zdegradowany nie jest zapisywany.** Loader po terminie oddaje
   `private, no-store`: strona główna ma 600 ms na ustawienia, motyw, powłokę
   i sekcje nad zgięciem oraz 1 200 ms na treść (`lib/ssr/homeSsrBudget.ts`),
   trasa `/$` 1 500 ms na całość (`CONTENT_SSR_BUDGET_MS`), powłoka 500 ms
   (`CHROME_WARM_BUDGET_MS`). Przy 150-300 ms na podróż do bazy pierwszy
   render ścieżki w izolacie potrafi nie zmieścić się w tych terminach. Po
   takim MISS-ie rusza odświeżenie w tle (najwyżej 2 próby na 10 minut na
   klucz).
3. **Render „spóźniony" żyje 30 s.** Powłoka albo sekcje nad zgięciem
   dostrumieniowane po flushu dają `s-maxage=30`
   (`chromeDegradedCacheControl`); po 30 s wpis jest STALE, nie MISS.
4. Predykat kompletności na końcu strumienia (tylko strona główna) albo
   dyrektywa zawężona w trakcie strumieniowania odrzucają zapis, choć
   nagłówki MISS-a wyglądały na czyste; widać to tylko w pierścieniu decyzji
   (`degradedAt: "stream"`).
5. Wpis powstaje dopiero na końcu strumienia body, więc żądanie, które
   przyszło wcześniej, jeszcze go nie widzi.
6. Dokument ponad `DOCUMENT_CACHE_MAX_ENTRY_BYTES` (2 MiB) nie wchodzi wcale
   (licznik `oversize`, ostrzeżenie w logu). Strona 404 ma około 218 KB, więc
   tych tras to nie dotyczy.
7. Purge między żądaniami: każdy zapis strony, menu albo ustawień czyści cały
   host.

Klucz cache'u nie zależy od nagłówków: to zwalidowany host, ścieżka oraz
parametry `page` i `sort` (`planDocumentCache`). `Sec-GPC`, klasa
user-agenta, `Accept-Language` i zwykłe ciasteczka do niego nie wchodzą;
`Authorization`, ciasteczko `sb-*` i nieznany parametr zapytania dają BYPASS,
nie MISS.

Jak rozróżnić w pomiarze: `cache-control` MISS-a (`private, no-store` to
powód 2, `s-maxage=30` to powód 3, `s-maxage=900` to dokument zapisany, więc
kolejny MISS oznacza inny izolat), `nes-iso;desc="req=N"` (ten sam izolat
podaje kolejne numery) i `db;desc="n=..."` (spadek przy powtórzeniu w tym
samym izolacie).

## 8. Stan na 15.11.2026, 21:30 i ciąg dalszy

Zapis stanu na wypadek przerwania sesji. Gałąź `claude/kind-brown-vrah7o`,
szkic PR #542, HEAD `05f62691` plus ten commit.

### Zweryfikowane na `d94ec1f3` (wszystko poza A4)

Build `cloudflare-module`, `check:bundle` (5 383,9 KB przy progu 5 386 KB),
`check:server-entry-purity`, `check:entry-purity`, `check:chunks`,
`verify:static`, `typecheck` (aplikacja, skrypty, e2e), ESLint całego
repozytorium (0 błędów; uruchamiać z `--ignore-pattern ".claude/"`, jeśli
w katalogu leżą kopie robocze agentów) i pełny zestaw testów (3 949 plików,
97 695 testów zielonych, 194 oczekiwane porażki, 51 pominiętych - jak na bazie).

### A4: przebieg i stan końcowy

Trzy tury, wszystkie na gałęzi:

1. Wdrożenie (`0a29a634`…`e35f3e6f`, 8 commitów). CI na `5ae9f4d2` zielone
   w całości, łącznie z e2e i pgTAP.
2. Pierwszy przegląd (dwie z trzech perspektyw) i poprawki `6c064c3c`…`57e77034`:
   SVG bez własnej proporcji nie dostaje rozmiaru; zaznaczenie widgetu mierzy
   tylko rozmiar, którego użyje renderer (kliknięcie nie zapisuje już dokumentu
   bez potrzeby); utracony pomiar jest widoczny i wraca przy kolejnym
   zaznaczeniu; przywrócenie wersji z historii mierzy zestaw logotypów, który
   faktycznie zostanie w wierszu.
3. Drugi przegląd (trzy uwagi) i poprawki `00ae4201`…`e69fec57`: o proporcję
   pliku pyta układ strony (dwa niewidoczne `<img>`), a nie `fetch` z parserem
   SVG, który polityka CSP mogła zablokować i który ważył najwięcej; plik bez
   własnej proporcji zeruje wcześniej zapisany rozmiar (logo motywu i widget
   obrazu), więc nieaktualne wymiary nie zostają po podmianie pliku; pomiar
   trzyma panel właściwości ponad zakładkami i przypisuje wynik widgetowi,
   przy którym ruszył, więc przełączenie zakładki albo zaznaczenia go nie gubi.

Weryfikacja lokalna na `e69fec57`: build, `check:chunks`, `check:entry-purity`,
`check:server-entry-purity`, `tsgo --noEmit --singleThreaded` (kod 0), testy
modułów dotkniętych i sąsiednich (202 pliki, 6 891 testów zielonych).

Czego NIE sprawdzono: druga tura poprawek nie miała osobnego niezależnego
przeglądu (decyzja o zakończeniu rund przeglądu A4); sonda układu była
sprawdzona tylko w Chromium - Firefox i Safari bez weryfikacji (w razie innego
zachowania skutek to brak zapisanego rozmiaru, czyli znaczniki jak dziś);
trzecia perspektywa pierwszego przeglądu (sens testów, narzędzia i18n) nie
ruszyła.

### Bramka bundla: próg `overall` 5 386 → 5 388 KB (`05f62691`)

Decyzja właściciela z 15.11.2026. Pomiar gzip: `d94ec1f3` 5 383,9 KB (publiczne
2 801,4, panelowe 2 582,5) → `e69fec57` 5 387,7 KB (publiczne 2 802,5, panelowe
2 585,2). A4 kosztuje więc 3,8 KB: 2,7 KB w kodzie ładowanym tylko w panelu
i 1,1 KB w chunkach publicznych, z czego 0,3 KB w chunku startowym. Budżety
czytelnika (publiczne 2 881 KB, chunk startowy 579 KB, największy chunk 286 KB)
mają duży zapas i nie były ruszane. Nowy próg to zaokrąglenie pomiaru w górę
BEZ zwyczajowego marginesu +1 KB na różnicę hosta: zapas lokalny 0,3 KB. Jeżeli
runner CI zmierzy więcej niż 5 388 KB, próg nie rośnie sam - decyzja wraca do
właściciela. Następna faza musi najpierw zwolnić bajty, zanim cokolwiek dołoży.

### Do decyzji właściciela przed wyjściem PR ze szkicu

1. Linia dopisana do `AGENTS.md` (reguła naturalnego rozmiaru obrazu).
2. Przełączenie PR #542 ze szkicu na gotowy do przeglądu (po zielonym CI na
   `05f62691` lub nowszym).

### Kroki właściciela po wdrożeniu A4

Bez nich produkcja renderuje się dokładnie jak dziś.

1. `/admin/theme-options`: jeden zapis bez zmian (mierzy pliki logo).
2. Builder strony głównej: kliknięcie każdego obrazu z proporcją „auto"
   (dowolna zakładka panelu) i zapis strony.
3. Kontrola w źródle strony: logo `width="350" height="150"`, obraz
   `width="1200" height="675"`; audyt `unsized-images` w PageSpeed pusty.

### Po wdrożeniu całości: do sprawdzenia na produkcji

- `server-timing` wpisu i 404: `db;desc="n=…"` wobec liczb z §0.
- Jedno żądanie anonimowe do PostgREST z osadzeniem `parent_page`: czy wraca
  wypełnione (inaczej linki zostają `/post/<slug>`, z ostrzeżeniem `[postHref]`).
- Który preset builda stosuje hosting (`cloudflare-module` czy
  `lovable-fetch-bundle`): w drugim poprawka chunku SDK MCP nie działa.

### Następne pozycje

Faza druga: §9 (mapa z 15.11.2026 i kolejność). Decyzje właściciela bez zmian:
§3 oraz pomarańczowy tekst, kanoniczna lista wydarzeń, zgoda na migracje RPC
(powłoka strony to dziś najdłuższy łańcuch przed pierwszym bajtem).

## 9. Faza druga: mapa i kolejność (15.11.2026)

Mapa sporządzona wyłącznie przez odczyt, na artefakcie klienta z `e69fec57`.
„Zmierzone" oznacza różnicę gzip po wycięciu kodu z gotowego pliku; „szacunek"
oznacza symulację bez builda. Rozstrzyga dopiero `bun run build` i bramki.

Stan bramek przed fazą drugą: `overall` 5 387,7 / 5 388 KB lokalnie (CI
5 385,8), CSS razem 100,13 / 101 KiB, CSS publiczny 84,09 / 85 KiB oraz trzecia,
najciaśniejsza: `check:document-weight` `renderBlockingCssGzipBytes` 83 394 /
83 461 B (zapas 67 B).

### 9.1. Zwolnienie bajtów w JS klienta (pierwsze w kolejności)

| #   | Pozycja                                                                                                                                                                                                                              | Zysk gzip                                                      | Ryzyko  | Decyzja właściciela                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ------- | -------------------------------------- |
| J1  | Budowniczy nagłówków i polityk cache liczeni w przeglądarce jako argumenty pustych funkcji (`setCacheControlHeader`, `appendLinkHeader`; 75 wywołań w 49 chunkach tras) oraz `stripInaccessibleNodes` za bramką `typeof window`      | 1,5 KB całość, 0,8 KB chunk startowy (zmierzone)               | niskie  | nie                                    |
| J2  | Osierocone instrukcje: schematy zod używane tylko w `z.infer` lub tylko w walidatorze serwerowym (podcasty, menu, finanse, journeys, retencja), lista hostów CSP, `TextEncoder` w `tenantAssertion`, stałe polityk cache             | 2,8 KB całość, 0,7 KB chunk startowy (zmierzone)               | niskie  | nie                                    |
| J3  | D3: eksporty modułów mieszanych trzymane w `app-initial` tylko dla chunków panelu (`seo/robots`, `builder/experiments`, `seo/settings`, `builder/globalWidgets`, `dynamicText`, `liveTypography`, `customFonts`, `ads/types` i inne) | 0 całość; chunk startowy −6,7 KB (zmierzone), górna granica 27 | średnie | nie; WYKONANE 16.11.2026 (§9.8)        |
| J4  | D4: rejestry ikon `import * as` w `lucide-shim`                                                                                                                                                                                      | ok. 0,9 KB całość, ok. 5,7 KB chunk startowy (szacunek)        | średnie | tak (W5); WSTRZYMANE 16.11.2026 (§9.8) |
| J5  | Wariant ikon Font Awesome (`lucide-shim.fa`)                                                                                                                                                                                         | 17,9 KB całość i publiczne (zmierzone)                         | niskie  | WYKONANE (§9.6)                        |
| J6  | Wpisy słowników i18n bez żadnego odwołania w kodzie (ok. 2 800 wpisów PL+EN)                                                                                                                                                         | 20–37 KB całość (szacunek heurystyczny)                        | średnie | tak                                    |
| J7  | Dziesięć funkcji serwerowych bez importera produkcyjnego (używane tylko w testach)                                                                                                                                                   | ok. 0,4 KB; usuwa też żywe punkty RPC                          | średnie | tak                                    |

Odrzucone po pomiarze: usuwanie plików „nieużywanych" wg knip (nie trafiają do
bundla), statyczne bramki `isSsrRequest` (130 B), opcje tras panelu w chunku
startowym (wynikają z drzewa tras), przycinanie katalogu ikon (zależy od treści
w bazie), łączenie małych chunków panelu i fasad reeksportu (konfiguracja
bundlera, wysokie ryzyko).

### 9.2. Kanoniczne linki wpisów (A2, ciąg dalszy)

Każdy pozostały link `/post/<slug>` albo płaski `/<slug>` kosztuje 301 i dwa
odczyty bazy przy kliknięciu, a przez `AppLink` także przy najechaniu. Kolejność,
jeden commit na zapytanie:

1. Warunek wstępny: wspólny pomocnik składający kolumny z osadzeniem
   `parent_page` i skrócenie ostrzeżenia (ok. −150 B w chunku startowym; dzięki
   temu pozycje 2–5 są łącznie neutralne dla bramki zamiast +255 B).
2. Mega menu nagłówka (`src/lib/queries/megaMenu.ts:75`), każda trasa.
3. Karta wyróżnionego wpisu w panelu mega menu (`megaFeatured.ts`,
   `MegaPanelView.tsx:235,310`; dziś płaski `/<slug>`).
4. Archiwum `/blog` i strona główna w trybie ostatnich wpisów
   (`src/lib/queries/public.ts`, `blogArchiveQueryOptions`).
5. Bloki treści: cztery zapytania za `POST_SELECT` w `src/lib/queries/blocks.ts`
   i ich widoki.
6. Strona wpisu: stopka poprzedni/następny (`src/routes/$.tsx:1453-1475`; ścieżka
   rodzica jest już w danych loadera) i linki do samego siebie.
7. Blok kalendarza. 8. Paleta poleceń (`search.functions.ts`, funkcja serwerowa,
   zero bajtów klienta, jedna dodatkowa podróż na zapytanie). 9. Listy
   zalogowanego: zapisane, zakładki, dok, podsumowanie Q&A.

Poza zakresem bez migracji: wyszukiwarka (`search_posts`, `search_autosuggest`),
`get_post_refs`, `get_recommended_posts_v2`, `get_followed_feed`, dwa producenty
powiadomień w SQL. Poza zakresem bez decyzji: adresy `/post/<slug>` zapisane
w treści CMS przez edytory (slajdy, autouzupełnianie adresu). Świadomie bez
zmian: linki w e-mailach newslettera (stabilny adres) i ścieżki, które już
liczą adres kanoniczny po stronie serwera.

### 9.3. Arkusz stylów (D2)

Skład arkusza głównego (562 983 B, 83 590 B gzip): połowa to klasy Tailwind
(42,0 KB gzip), reguły pisane ręcznie 37,5 KB gzip. Martwych reguł nie ma (0 na
1 514), reszta panelowa to 0,2 KB. Rezerwuary to powierzchnie, których czytelnik
artykułu nie używa.

| #   | Pozycja                                                                                                                                              | Arkusz główny (gzip) | CSS razem        | Ryzyko  | Decyzja właściciela               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------- | ------- | --------------------------------- |
| S1  | Wykresy: reguły `.neh-*`, 826 deklaracji `--chart-*` i druk wykresów do własnego arkusza, linkowanego przez komponenty wykresów (wzorzec `WorldMap`) | −7,8 KB (zmierzone)  | ok. 0            | średnie | nie; WSTRZYMANE 16.11.2026 (§9.7) |
| S2  | Czat i dok członka (`.chat-*`, `.wd-*`) do arkusza leniwego chunku doku                                                                              | −1,5 KB (zmierzone)  | +0,3 KiB         | niskie  | nie                               |
| S3  | Strona kariery do arkusza trasy                                                                                                                      | −0,6 KB              | +0,3 KiB         | niskie  | nie                               |
| S4  | Ostatnie reguły wyłącznie panelowe do `admin-styles.css`                                                                                             | −0,2 KB              | 0                | niskie  | nie                               |
| S5  | Kluby oraz reszta aplikacji członka (klasy Tailwind i reguły) w osobnym arkuszu                                                                      | −5,9 do −10,4 KB     | +2,0 do +2,9 KiB | średnie | tak: kontrakt bramek CSS          |
| S6  | Podwójna emisja zamienników `color-mix`                                                                                                              | do −8,25 KB          | tyle samo        | wysokie | tak: zakres wsparcia przeglądarek |

Wniosek o wpływie: dokument `2026-10-22-speed-index.md` liczy ok. 2 ms Speed
Index telefonu na 1 KB gzip CSS, więc nawet −19 KB to ok. −40 ms. Szacowane
przez PageSpeed 430 ms to koszt samego istnienia blokującego żądania, którego
zmniejszenie arkusza nie usuwa.

„Critical CSS inline" jest nierealne w tej architekturze: dowodliwe minimum dla
samej powłoki to 41,6 KB gzip (prawie tyle, co cały dokument `/`), strony są
składane z widgetów CMS w czasie żądania, nieblokujące ładowanie przez
`onload` blokuje CSP (`script-src-attr 'none'`), a bramki stylów inline są
wyczerpane (26/26 bloków). Dźwignią usuwającą to oczekiwanie jest dostarczanie:
cache krawędziowy i 103 Early Hints, czyli W1.

### 9.4. Kolejność wykonania

1. J1 + J2 (zwolnienie ok. 4,3 KB) oraz równolegle 9.2 pozycje 1–6:
   WYKONANE 16.11.2026 (§9.5).
2. S1, potem S2 i S4 (mieszczą się w obecnych bramkach).
3. J3 (chunk startowy).
4. 9.2 pozycje 7–9.

Po decyzjach właściciela: J4–J7, S5, S6.

### 9.5. Wykonanie: partia 1 (16.11.2026)

Commity na gałęzi PR: J1 + J2 `80991f55`…`4e8515e7` (8), linki `1ed8608d`…
`c0c081e8` (6), poprawki po przeglądzie `27079b1e`, `4c23b09e`.

Pomiar na zintegrowanym buildzie (kontener roboczy, `check:bundle`):

| Miara                       | Przed (`d178d332`) | Po (`4c23b09e`)           |
| --------------------------- | ------------------ | ------------------------- |
| `overall` (cały JS klienta) | 5 387,7 KB         | 5 380,4 KB (zapas 7,6 KB) |
| JS publiczny                | 2 802,5 KB         | 2 798,7 KB                |
| Chunk startowy              | 261,4 KB           | 259,4 KB                  |
| Domknięcie startu           | 475,2 KB           | 473,2 KB                  |

Sam strumień bajtów na własnej gałęzi dał 5 379,2 KB (−8,5 KB wobec planowanych
−4,3 KB); linki kosztują po scaleniu ok. +1,2 KB tej liczby, z czego większość
to szum (niżej).

**J1.** Każde wywołanie `setCacheControlHeader` i `appendLinkHeader` w `src/routes`
(93 wywołania w 53 plikach) stoi za statyczną bramką
`import.meta.env.SSR || import.meta.env.DEV`; `stripInaccessibleNodes` za stałą
`IN_BROWSER_BUNDLE` jak w `ssrCache.ts`. Bramka MUSI mieć dokładnie tę postać:
inna pisownia może zdjąć nagłówek po stronie serwera i uczynić stronę prywatną
publicznie cache'owalną. Pilnuje tego test-zapadka
`src/routes/__tests__/headerSetterStaticGate.test.ts` (tylko `src/routes`; dwa
wywołania poza tym katalogiem są w kodzie serwerowym). Dowód równoważności:
w zbudowanym artefakcie serwera chunk routera różni się od bazy w trzech
miejscach, bez wpływu na wartości nagłówków.

**J2.** Schematy zod używane wyłącznie jako typy stały się typami (podcasty,
nadpisanie spisu treści; tożsamość typów dowiedziona asercją `Equal<>` pod
`tsgo`). Schematy używane tylko przez walidatory serwera są owinięte w
`/* @__PURE__ */ (() => ...)()`, a nie przeniesione: po zdjęciu owijek 13 plików
kompiluje się bajt w bajt jak przed zmianą, więc walidacja po stronie serwera
jest dokładnie tak samo ścisła. Sama adnotacja `@__PURE__` na łańcuchu zod nie
wystarcza (zostają wywołania w argumentach), stąd owijka. Zostało 37
osieroconych instrukcji (1,4 KB surowego), w tym 10 zaślepek funkcji
serwerowych czekających na decyzję (J7).

**Linki (9.2, pozycje 1–6).** Zapytania przeliczone przez osadzenie `parent_page`
dają adres kanoniczny tylko dla rodzica najwyższego poziomu; wpis pod stroną
zagnieżdżoną zostaje przy `/post/<slug>`. Wyjątek: stopka poprzedni/następny
i linki wpisu do samego siebie biorą pełną ścieżkę rodzica z okruszków loadera,
więc obsługują także zagnieżdżenie. Adres własny wpisu jest nowym, opcjonalnym
polem `CurrentPostCtx.href` ustawianym w `src/routes/$.tsx`; strony go nie
dostają. Błąd odczytu z osadzeniem powtarza zapytanie bez osadzenia; błąd
zwykłego odczytu wypływa jak dotąd.

**Przegląd niezależny** (jeden recenzent na strumień, obie perspektywy): 6
znalezisk, żadnego poważnego.

- Naprawione: brak testu hintów `modulepreload` na stronie głównej; test
  kontekstu strony na danych, przy których przechodził także bez pilnowanego
  warunku (oba nowe testy sprawdzone mutacją); nieaktualne komentarze.
- Otwarte (częściowo zamknięte w §9.7: 4 z 10 odczytów widoczne): zapytania przekazujące kolumny przez parametr (7 nowych i 4 z fazy
  pierwszej) są niewidoczne dla bramki kontraktu TS↔SQL w tych miejscach. Dziś
  żadna para tabela–operacja–rola–kolumna nie wypadła, bo te same kolumny
  pokrywają inne literały, ale ochrona jest słabsza. Poprawka: generator
  (`src/lib/ci/tsSqlContract.ts`) ma rozwiązywać literał z drugiego argumentu
  `readPostsWithParentPage`.
- Otwarte: brak zapadki dla J2 (nowy schemat używany tylko jako typ wróci do
  bundla niezauważony, dopóki mieści się w progu); kandydat: skaner
  osieroconych instrukcji jako kontrola po buildzie.
- Otwarte, drobne: na kilku trasach (`web-stories.$slug`, strona klubu) wejście
  do nagłówka `Link` nadal liczy się w przeglądarce; bramka obejmuje samo
  wywołanie.

**Dwie obserwacje o bramkach.**

- Liczba `overall` ma szum ok. ±1 KB między buildami o różnicy kilkudziesięciu
  bajtów kodu (5 385,3–5 387,7 KB w siedmiu kolejnych buildach): zmieniają się
  skróty w nazwach chunków, a z nimi kompresja importów w plikach, których treść
  się nie zmieniła. Zapas poniżej 1 KB nie jest więc wiarygodny.
- `check:document-weight` jest w kontenerze roboczym czerwone o 7 B na
  `headRawBytes` (23 928 wobec 23 921) także na commicie bazowym: adres artefaktu
  z pięciocyfrowym portem występuje w `<head>` 22 razy. To cecha środowiska; CI
  przechodzi.

**Czego nie sprawdzono.** Nie uruchomiono serwera i nie odczytano nagłówków
z odpowiedzi; brak przebiegu w przeglądarce (hydratacja, ślad sieci stopki);
czy osadzenie `parent_page` zwraca dane roli anonimowej na produkcji (krok
właściciela po wdrożeniu, §8).

### 9.6. Wykonanie: usunięcie opcji Font Awesome (16.11.2026)

Decyzja właściciela z 16.11.2026 (W5, wariant 1 z czterech przedstawionych:
usunąć, zostawić, rozbudować do pełnej alternatywy, Font Awesome Pro). Commit
`30fc9181` na gałęzi PR.

Powód: opcja „Font Awesome (rezerwowy)" w `/admin/settings/general` była
niepełna. Działała tylko na ikony z `src/lib/lucide-shim.tsx` (129 ikon w 288
plikach), a 892 pliki importują Lucide bezpośrednio, więc interfejs mieszał dwa
style; 22 ze 129 ikon nie miały odpowiednika i znikały; serwer zawsze renderował
Lucide, więc po hydratacji ikony migały, a do pobrania chunku nie były widoczne.

Usunięte: `lucide-shim.fa.tsx`, `iconPack.ts`, `IconPackSync` w korzeniu, pole
w panelu z czterema kluczami słownika PL/EN, testy tych modułów, pakiety
`@fortawesome/free-solid-svg-icons` i `@fortawesome/free-brands-svg-icons`.
`lucide-shim` eksportuje wprost komponenty Lucide. Wartość `icon_pack` zapisana
w bazie zostaje (panel jej nie pokazuje i nie kasuje), bez migracji.

| Miara (`check:bundle`, kontener roboczy) | Przed (`dc01012f`) | Po (`30fc9181`) |
| ---------------------------------------- | ------------------ | --------------- |
| `overall` (cały JS klienta)              | 5 380,4 KB         | 5 362,2 KB      |
| JS publiczny                             | 2 798,7 KB         | 2 780,5 KB      |
| Chunk startowy                           | 259,4 KB           | 258,5 KB        |
| Domknięcie startu                        | 473,2 KB           | 472,3 KB        |

Zapas pod progiem `overall` (5 388 KB) wynosi teraz 25,8 KB. Czytelnik przy
ustawieniu Lucide nie pobierał chunku Font Awesome, więc dla niego zysk to
0,9 KB w chunku startowym (opakowanie każdej ikony, magazyn preferencji,
zapytanie o ustawienie); pozostałe 17,3 KB to miejsce w bramce.

Weryfikacja: typecheck, ESLint i Prettier na zmienionych plikach, 225 plików
testów (6 202 testy, 32 oczekiwane porażki), build, `check:bundle`,
`check:chunks`, `check:entry-purity`, `check:server-entry-purity`. Skrypt
`check:menu-icons` wymieniony w tabeli partii D nie istnieje w `package.json`.

Odblokowane: D4 (rejestry ikon `import * as` w `lucide-shim`), bo nie trzeba
już zachowywać zgodności z mapą nazw Font Awesome.

### 9.7. Partia 2 (16.11.2026): generator kontraktu wykonany, arkusz wykresów wstrzymany

**Generator kontraktu TS↔SQL** (`src/lib/ci/tsSqlContract.ts`, commity
`60c82c8b`…`8b6446cb`). `.select(x)` daje fakty, gdy `x` jest pierwszym
parametrem funkcji oddanej `readPostsWithParentPage` (wprost albo przez `const`
lub deklarację funkcji w tym samym pliku), a drugi argument pomocnika rozwiązuje
się do napisu. Fakty powstają dla obu wariantów, które pomocnik wysyła (zwykły
i z osadzeniem `POST_PARENT_PAGE_EMBED`, czytanym z prawdziwej stałej).
Operacje na tabelach: 1 538 → 1 546; zbiór par tabela–operacja–rola–kolumna bez
zmian (3 032), lista nieczytelnych miejsc bez zmian (13 z 13).

Pokrycie jest częściowe: widoczne są 4 z 10 odczytów (`megaFeatured.ts` ×2,
`public.ts` ×2). Pozostałe 6 (`megaMenu.ts`, `blocks.ts`, `postListQuery.ts`,
`ratedListQuery.ts`, `sliderPostsQuery.ts`, `newsTickerQuery.ts`) przekazuje
kolumny dalej do `postsQuery`, `postsNarrowedToTaxonomy` albo
`postsConstrainedByTaxonomy`, które budują `select` w innej funkcji (w tym
przez `[cols, ...embeds].join`). Do pokrycia ich potrzebne jest śledzenie
parametru przez wywołania między plikami albo literał w miejscu zapytania;
żadne zapytanie nie zostało zmienione. Przy okazji: wszystkie `select`
w `src/lib/queries/taxonomyPivot.ts` są dla bramki niewidoczne niezależnie od
wołającego, a generator nie ma roli `anon` (zapytania przeglądarki sprawdza
względem grantów `authenticated`).

Przegląd niezależny: 3 znaleziska. Naprawione: brak testów dla czterech
strażników reguły (przesłonięcie parametru w bloku i `catch`, owijki wyrażenia,
nazwa pomocnika, wymóg `const`); każdy nowy test sprawdzony mutacją. Otwarte:
6 niewidocznych odczytów (wyżej). Weryfikacja: typecheck, ESLint, Prettier,
`check:ts-sql-contract`, 247 plików testów.

**S1, arkusz wykresów: wstrzymane decyzją właściciela z 16.11.2026.** Gotowe na
lokalnej gałęzi `p2/charts-css` (5 commitów nad `dc01012f`). Arkusz blokujący
render na stronach bez wykresu: 83 590 → 75 575 B gzip (zmierzone), arkusz
wykresów 8 312 B gzip ładowany tylko przez wykres; zbiory deklaracji przed
i po identyczne poza 11 kopiami parytetu kaskady; style obliczone w Chromium bez
różnic na 7 479 elementach rzeczywistego markupu wykresów. Powody wstrzymania:

- usterka wysokiej wagi z przeglądu, odtworzona: gdy wykres montuje się po
  danych pobranych w przeglądarce (dossier `/tracker/<slug>`, statystyki klubu,
  raport sponsora), React wstrzymuje zatwierdzenie do załadowania arkusza,
  a przy aktualizacji synchronicznej najbliższa granica Suspense (cała trasa)
  pokazuje `RouteLoadingSkeleton`;
- strony z wykresem mają drugi arkusz blokujący render (panel: trzeci), wbrew
  zasadzie `renderBlockingCssCount` = 1, której żaden dokument z bramki nie
  sprawdza dla stron z wykresem;
- remisy kaskady wygrywane dotąd kolejnością utrzymuje plik 11 skopiowanych
  deklaracji; nowy remis nie zostałby wykryty automatycznie;
- zysk: ok. 15 ms Speed Index na telefonie według przelicznika
  z `2026-10-22-speed-index.md`, a CSS łącznie +0,29 KiB (zapas 0,6 KiB).

Powrót do S1 ma sens po W1: cache krawędziowy i 103 Early Hints dla arkusza
zmniejszają znaczenie jego rozmiaru, a usterkę trzeba wtedy naprawić linkiem
arkusza w renderowanej przez serwer części tych tras.

### 9.8. Partia 3 (16.11.2026): J3 wykonane, D4 wstrzymane

**J3 (D3): kod używany tylko przez panel poza chunkiem startowym.** Dwanaście
modułów mieszanych rozdzielonych na część bootu i liść panelu (bez reeksportów,
importerzy panelu i ich `vi.mock` wskazują liść): `globalWidgetsAdmin`,
`experimentsAdmin`, `themedWrites`, `dynamicTagCatalog`, `ads/adminFields`,
`customFontUpload`, `liveTypographyBroadcast`, `usePostLayoutSettingsAdmin`,
`useFontScaleAdmin`, `cropSizesAdmin`, `impersonationStart`; polityka crawlerów
AI przeniesiona z `seo/settings.ts` do `seo/robots.ts`, dzięki czemu cały
builder robots.txt wyszedł z bootu. Kod przeniesiony bez zmian (sprawdzone
porównaniem wielozbioru linii dla każdego podziału).

| Miara (`check:bundle`, kontener roboczy) | Przed (`28c50810`) | Po                                                            |
| ---------------------------------------- | ------------------ | ------------------------------------------------------------- |
| Chunk startowy (`app-initial`)           | 258,5 KB           | 253,3 KB                                                      |
| Domknięcie startu                        | 472,3 KB           | 467,1 KB                                                      |
| JS publiczny                             | 2 780,8 KB         | 2 776,1 KB                                                    |
| `overall`                                | 5 362,9 KB         | 5 364,5 KB (+1,6 KB: więcej małych chunków, gorsza kompresja) |

Czytelnik pobiera o 5,2 KB gzip mniej na każdej stronie. Uboczne: z bootu
wyszły też `tenant.ts` i `widgetCacheInvalidation.tsx` (WidgetLiveSync);
dla najemców z aktywnymi popupami ścieżka `PopupHost` dociąga przez to dwa małe
chunki (ok. 0,8 KB gzip, równolegle przez listę preloadu).

Przegląd: 3 znaleziska niskiej wagi, wszystkie zamknięte. Nowy moduł polityki
crawlerów zużywał ostatnie miejsce zapadki `platformCoreBoundary` (113 → 114
przy suficie 114) - kod przeniesiony do `robots.ts`, krawędzi znów 113.
Strażnik `bootAdminLeaves.gate.test.ts` sprawdza teraz oba kierunki: moduły bootu
nie sięgają liści, a liście importuje wyłącznie panel, serwer i inne liście
(sprawdzone mutacją). Raport uzupełniony o ścieżkę `PopupHost`.

Pozostawione celowo (nagłówki modułów każą trzymać edytor i renderer razem
albo zysk jest poniżej 0,3 KB): `authorDisplay.ts`, `content/sponsored.ts`,
`animatedHeadingLinks.ts`, `socialBrand.ts`, `designTokens`, `useGlobalColors`.
W `app-initial` zostało ok. 2,2 KB gzip kodu używanego tylko przez panel
i ok. 10,7 KB kodu używanego tylko przez publiczne chunki leniwe (np.
`newsletter/popupDesign`, `queries/podcasts`) - kandydat na kolejną partię.

**D4: rejestry ikon - wstrzymane.** Gotowe na lokalnej gałęzi
`p2/icon-registry` (domknięcie startu −4,6 KB gzip). Zysk dała dopiero kombinacja
dwóch zmian: `lucide-shim` jako czyste reeksporty `lucide-react` oraz ikony
spoza 12 najczęstszych nazw ładowane leniwie za granicą Suspense. Przegląd
odtworzył dwie usterki wysokiej wagi: (1) przy renderze po stronie klienta
(nawigacja SPA, kanwa buildera) ikona z „ogona" nie pojawia się w pierwszym
zatwierdzeniu i dochodzi później z przesunięciem tekstu; (2) po hydratacji
zmiana kontekstu nad oczekującą ikoną (np. sesja w `AuthProvider`) usuwa SVG
z serwera albo wstrzymuje całą tranzycję do pobrania chunku, wbrew regule
„HTML serwera równy stronie po hydratacji". Do tego strażnik kliknięć wysp
hydratacji przetrzymuje kliknięcia w ikonę w linku lub przycisku. Bez leniwego
ogona zysk spada do ok. 0,7 KB. Warunek powrotu: wiedza, jakie nazwy ikon
zapisane są w treściach produkcyjnych (wtedy wszystkie trafiają do zestawu
ładowanego od razu) albo preload ogona przed renderem stron, które go używają.

Przy okazji D4 znalazło usterki zachowania, istniejące już dziś (do decyzji
właściciela, bez zmian w tym PR): wybieraki ikon w schematach widgetów
(`LucideIconPicker`) zapisują nazwy w formacie `kebab-case`, których rejestr nie
rozpoznaje, więc nagłówek, przycisk, separator, newsletter i pasek gorących
tematów zawsze pokazują ikonę zastępczą zamiast wybranej; „Bell" na liście paska
alertów i domyślna „Flag" osi czasu nie są eksportami rejestru i również
spadają do zastępczej; formaty wpisu „galeria" i „audio" nie mają ikony
w liście z ocenami.
