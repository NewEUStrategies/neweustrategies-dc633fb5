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

| #   | Pozycja                                                                                                                                                         | Pliki (start rozpoznania)                                                        | Weryfikacja                                                               | Stan       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------- |
| B1  | Strona 404: dziś 15–17 zapytań i brak zapisu w cache. Cel: krótki negatywny cache dokumentu 404 per ścieżka i render bez fali widgetów treści                   | `src/routes/$.tsx`, `src/lib/http/documentCache.server.ts`, `notFoundIfClean.ts` | laboratorium: 2. żądanie tego samego 404 bez zapytań; test polityki cache | niezaczęte |
| B2  | Wpis: 20 zapytań na zimnym renderze. Inwentaryzacja fal, scalenie odczytów nad zgięciem, reszta za odpowiedzią                                                  | `src/routes/$.tsx`, `src/lib/queries/*`                                          | `report:route-loaders`; laboratorium zimnego renderu przed/po             | niezaczęte |
| B3  | Wydarzenia: 20 zapytań na liście; liście bez loadera, `events.$slug` grzeje 2 z ~9                                                                              | `src/routes/events*.tsx`                                                         | jak B2                                                                    | niezaczęte |
| B4  | Trasy bez trafienia na ciepłym izolacie (`/kontakt`, `/en` MISS dwa razy): ustalić, czy dokument dostaje `no-store` z degradacji, czy to rotacja izolatów       | `documentCache.server.ts`, `cachePolicy.ts`                                      | nagłówki odpowiedzi + pierścień decyzji cache                             | niezaczęte |
| B5  | Podpowiedź obrazu LCP zapisywana przy publikacji strony, żeby preload trafiał do `<head>` także na zimnym renderze (strona główna, wydarzenia, autor, programy) | `src/routes/index.tsx`, `lcpCandidate`, zapis strony w builderze                 | dokument zimnego renderu ma preload okładki w `<head>`                    | niezaczęte |

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
