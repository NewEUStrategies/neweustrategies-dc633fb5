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

| #   | Pozycja                                                                                                                                                                                                                                                                              | Pliki                                                                                                                                                                                     | Weryfikacja                                                                                              | Stan                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| A1  | Etykieta sekcji jako nagłówek 2. stopnia (`role="heading" aria-level=2`), żeby strona nie skakała z `h1` na `h3`                                                                                                                                                                     | `src/lib/builder/sectionLabelVariants.tsx`                                                                                                                                                | testy `sectionLabel*.test.tsx` + nowy test roli; miniatury `sm` i puste etykiety bez roli                | wykonane (test `sectionLabelHeadingRole.test.tsx`, 24 przypadki) |
| A2  | Kanoniczne adresy wpisów w widgetach zamiast `/post/<slug>` (dziś każde kliknięcie = 301 + 2 odczyty bazy). Wspólny pomocnik `postHref`; ścieżka rodzica z osadzenia `pages` w tym samym zapytaniu (zero dodatkowych podróży); zapas `/post/<slug>` gdy rodzic zagnieżdżony/nieznany | nowy `src/lib/routing/postHref.ts`; `latestPostsSuperset.ts`, `postListQuery.ts`, `sliderPostsQuery.ts`; `PostListView.tsx`, `PostsSliderWidget.tsx`; potem pozostałe widoki (lista w §4) | test równości kolumn nadzbioru; test pomocnika; `check:ts-sql-contract`; dokument `/` bez `href="/post/` | rozpoznane, niezaczęte                                           |
| A3  | Kontrast i wielkość celów dotykowych (komputer)                                                                                                                                                                                                                                      | do ustalenia                                                                                                                                                                              | lokalny Lighthouse (lista elementów)                                                                     | wymaga listy elementów z audytu                                  |
| A4  | Wymiary logotypów SVG (`width`/`height` albo `aspect-ratio`)                                                                                                                                                                                                                         | komponent logo nagłówka i stopki                                                                                                                                                          | audyt „unsized-images" pusty; CLS bez zmian                                                              | niezaczęte                                                       |

### Partia B. Koszt renderu serwera na każdej trasie (średnie ryzyko, bez migracji)

| #   | Pozycja                                                                                                                                                         | Pliki (start rozpoznania)                                                        | Weryfikacja                                                               | Stan                                                                                                                                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Strona 404: dziś 15–17 zapytań i brak zapisu w cache. Cel: krótki negatywny cache dokumentu 404 per ścieżka i render bez fali widgetów treści                   | `src/routes/$.tsx`, `src/lib/http/documentCache.server.ts`, `notFoundIfClean.ts` | laboratorium: 2. żądanie tego samego 404 bez zapytań; test polityki cache | patrz §6                                                                                                                                                                                                                                                                                                                                  |
| B2  | Wpis: 20 zapytań na zimnym renderze. Inwentaryzacja fal, scalenie odczytów nad zgięciem, reszta za odpowiedzią                                                  | `src/routes/$.tsx`, `src/lib/queries/*`                                          | `report:route-loaders`; laboratorium zimnego renderu przed/po             | niezaczęte                                                                                                                                                                                                                                                                                                                                |
| B3  | Wydarzenia: 20 zapytań na liście; liście bez loadera, `events.$slug` grzeje 2 z ~9                                                                              | `src/routes/events*.tsx`                                                         | jak B2                                                                    | rozpoznane: moduł jest na podłodze (katalog 1 odczyt, strona wydarzenia 2 równoległe, zakładki 0); 20 zapytań `/wydarzenia` to strona CMS w `$.tsx`. Scalone: zapadka budżetu zapytań (`e01afc24`) i zaproszenie z pakietu poza wspólnym cache (`57f7c3ee`). Dalej: RPC `event_page_bootstrap` (E) i decyzja, która lista jest kanoniczna |
| B4  | Trasy bez trafienia na ciepłym izolacie (`/kontakt`, `/en` MISS dwa razy): ustalić, czy dokument dostaje `no-store` z degradacji, czy to rotacja izolatów       | `documentCache.server.ts`, `cachePolicy.ts`                                      | nagłówki odpowiedzi + pierścień decyzji cache                             | patrz §7                                                                                                                                                                                                                                                                                                                                  |
| B5  | Podpowiedź obrazu LCP zapisywana przy publikacji strony, żeby preload trafiał do `<head>` także na zimnym renderze (strona główna, wydarzenia, autor, programy) | `src/routes/index.tsx`, `lcpCandidate`, zapis strony w builderze                 | dokument zimnego renderu ma preload okładki w `<head>`                    | niezaczęte                                                                                                                                                                                                                                                                                                                                |

### Partia C. Start zimnego izolatu (wysokie ryzyko, osobny PR)

| #   | Pozycja                                                                                                                              | Weryfikacja                                                                    | Stan       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ---------- |
| C1  | „Front door": podanie dokumentu z cache w `src/server.ts` przed importem routera. Zysk dopiero przy działającym cache współdzielonym | lokalny workerd: TTFB pierwszego żądania przy HIT; `check:server-entry-purity` | niezaczęte |
| C2  | Dalszy podział kodu serwera (`/login` płaci >2 s bez bazy): trasy profilu, checkoutu, wydarzeń-studio leniwie także na serwerze      | rozmiar artefaktu i liczba modułów; równoważność HTML 11 adresów               | niezaczęte |

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

| #   | Decyzja                                                                                              | Skutek                                                  |
| --- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| W1  | Przeniesienie produkcji na Worker we własnym koncie Cloudflare, Smart Placement, Brotli, Early Hints | jedyna dźwignia sprowadzająca SI telefonu do ~1,4–2,2 s |
| W2  | `vars.LHCI_URL`, `vars.LHCI_EXTRA_PATHS`, `PSI_API_KEY`                                              | pomiar tras innych niż główna, telefon i komputer       |
| W3  | Decyzja DPO: anonimowe metryki czasowe bez zgody                                                     | widoczność pierwszego wejścia czytelnika                |
| W4  | Zgoda na migracje z partii E i ich wdrożenie                                                         | −2…−3 fale zapytań na każdej trasie                     |
| W5  | Font Awesome: zostaje czy wychodzi                                                                   | odblokowuje D4                                          |

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
