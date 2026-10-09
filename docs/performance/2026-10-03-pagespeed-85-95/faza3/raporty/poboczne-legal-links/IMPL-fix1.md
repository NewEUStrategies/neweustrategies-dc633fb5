# Listwa linków prawnych (CopyrightBar): poprawki po recenzji 2 (IMPL-fix1)

Gałąź `feat/w3-legal-links`, worktree `scratchpad/wt3/legal-links`. Commit **`a0463f1b`** na `db56047e` (historia
nieprzepisana), baza `56da8d23`. Jedyna zmiana po buildzie i e2e to komentarz w `Footer.tsx` (zablokowany
`sessionStorage`), bez wpływu na wynik builda.

## 1. Ustalenia per pozycja recenzji

### B1 (blokujące): awaria chunku listwy dawała ekran błędu całej strony. ZROBIONE

**Mechanizm, odtworzony w kodzie i na artefakcie:**

1. Wyspa `site-footer` gruntuje `React.lazy` listwy (`hydrationIsland.tsx`, `loadChunks`). Import nie
   przychodzi, więc `__vitePreload` emituje `vite:preloadError`. W aplikacji nikt tego zdarzenia nie
   słucha, więc import rzuca. `Promise.allSettled` łapie odrzucenie, a wyspa woła `report()`, czyli
   `window.reportError(TypeError: Failed to fetch dynamically imported module …)`.
2. `reportError` wysyła zdarzenie `error` na `window`. Łapie je wczesny filtr korzenia
   (`armCacheBusting` w `__root.tsx`, przed punktem ciszy) albo nasłuch `startCacheBusting`
   (`src/lib/cacheBusting.ts`, po nim). Komunikat pasuje do `looksLikeChunkLoadError`, więc
   `safeReloadOnce` robi `location.replace(?_v=…)`. To jest „twarde przeładowanie do `/?_v=`”
   z recenzji.
3. Po przeładowaniu chunk znów nie przychodzi. Strażnik `__lov_cb_reload` w `sessionStorage`
   (15 s) blokuje drugie przeładowanie. `React.lazy` rzuca odrzuceniem przy hydratacji, a bez lokalnej
   granicy błąd dochodził do globalnego `ErrorBoundary` (`__root.tsx`) i cała strona stawała się
   ekranem błędu.

**Poprawka.** `Footer.tsx`: `<RenderErrorBoundary label="footer:legal-links">` wokół istniejącej
granicy `<Suspense>` listwy. Granica jest już w chunku wejściowym (`BuilderRenderer`), więc nie dochodzi
nowy moduł. Nie emituje DOM-u, więc parzystość SSR i klienta zostaje. Po poprawce:

- React porzuca HTML samej listwy (wymusza render klienta najbliższej granicy `Suspense`). Granica
  renderuje ukryty znacznik `<span hidden data-render-error="footer:legal-links">` (na produkcji)
  i raportuje błąd przez `reportPlatformError`. Dokument stopki, treść i nagłówek zostają.
  Zachowanie HTML-u SSR listwy przy awarii nie jest możliwe: bez kodu komponentu React nie hydratuje
  tego poddrzewa. Listwy po prostu nie ma.
- **Uczciwie o przeładowaniu.** Siatka `cacheBusting.ts` jest globalna i celowa: każdy chunk-load error
  daje JEDNO twarde przeładowanie `?_v=`, z myślą o dokumencie sprzed wdrożenia, którego chunków już
  nie ma. Granica B1 tego nie zmienia, bo zgłoszenie robi wyspa, nie render. Przy przejściowej awarii
  chunku listwy użytkownik dostaje więc jedno przeładowanie strony (zwykle pomaga). Przy trwałej awarii
  dostaje jedno przeładowanie, a potem stronę bez listwy, nie ekran błędu. Pętli nie ma, bo kolejne
  przeładowanie w ciągu 15 s blokuje strażnik. **Wyjątek sprzed tej zmiany:** przy zablokowanym
  `sessionStorage` (np. Chrome „blokuj wszystkie pliki cookie”) `safeReloadOnce` łapie wyjątek
  magazynu i przeładowuje mimo to. Trwale niedostępny chunk dałby wtedy pętlę przeładowań. Dotyczy to
  każdego leniwego chunku, który ładuje się sam (słownik języka, nakładki, sam moduł cache-bustingu).
  Listwa dokłada do tej klasy jeszcze jeden chunk, ładowany na każdej odsłonie. Nie zmieniałem
  globalnej siatki: to poza zakresem i dotyczy wszystkich chunków. Kandydat na osobne zadanie:
  strażnik w pamięci okna albo w `name`/`history.state`, gdy `sessionStorage` rzuca.
- Opisane w komentarzu nad `LegalLinksChunk` w `Footer.tsx`.

**Testy:**

- vitest `src/components/__tests__/footerLegalLinksFailure.test.tsx` (nowy, osobny plik, bo stan
  `React.lazy` żyje w module `Footer.tsx`). Prawdziwy odrzucony `import()`: `vi.doMock` z fabryką, która
  rzuca `TypeError("Failed to fetch dynamically imported module …")`, zarejestrowany PO statycznym
  imporcie `Footer`. Serwer renderuje więc prawdziwą listwę, a dynamiczny import klienta pada.
  Test sprawdza:
  - HTML serwera ma listwę;
  - po otwarciu wyspy (IO) `onUncaughtError` jest pusty;
  - wyspa ma stan `hydrated`, a sekcja buildera stopki to TEN SAM węzeł serwera;
  - listwy nie ma, jest znacznik `data-render-error="footer:legal-links"`;
  - błąd przeszedł przez `onCaughtError` i `reportPlatformError` (etykieta `footer:legal-links`);
  - błędy odzyskiwalne hydratacji mają za przyczynę błąd chunku;
  - wyspa zgłosiła odrzucony chunk przez `reportError` (sygnał dla siatki przeładowania).

  **Kontrola negatywna:** bez granicy test pada, bo błąd chunku wychodzi z `act` do korzenia
  (`vitest-failure-without-boundary.log`).

- e2e `legal-links.boot-home.spec.ts` → „awaria chunku listwy prawnej”. `page.route` przerywa
  `legal-links-*.js`. Test sprawdza: dokładnie jedno przeładowanie `?_v=`; po nim wyspa w stanie
  `hydrated`, znacznik granicy jest, listwy nie ma; `main#main-content`, `header` i sekcja stopki
  są na miejscu; po 2 s nadal jedno przeładowanie; chunk żądany ≥ 2 razy. Na starym artefakcie
  (`db56047e`) test pada: brak znacznika, bo strona była ekranem błędu
  (`e2e-fix1-on-old-artifact.log`).

### B2 (blokujące): przycisk „Wróć na górę” zakrywał RODO/GDPR na 412 px. ZROBIONE

- `LegalLinks.tsx`: w `NAV_CLASS` `pb-4` → **`pb-20`** (5rem). `BackToTop` (`fixed bottom-6 right-6 h-11 w-11`)
  pokazuje się na każdej szerokości po przewinięciu o 400 px i zajmuje pas 1,5-4,25rem od dołu. 5rem
  to 4,25rem pasa przycisku plus 0,75rem luzu. Obie miary są w rem, więc zapas trzyma przy każdym
  rozmiarze płynnego korzenia i na każdej szerokości, na której przycisk się pokazuje. Wariantu
  zależnego od szerokości nie wybrałem, bo przy 768-1000 px wiersze listwy też mogą sięgać prawej
  krawędzi. Geometria jest wspólna dla motywów (AGENTS.md). Koszt: nowa reguła `.pb-20` w CSS
  blokującym render (+8 B gzip względem `db56047e`). Na desktopie pod listwą jest teraz 80 px
  zamiast 16 px tła stopki (zrzut `shots-fix1/pl-1350-light.png`).
- Pomiar na nowym artefakcie, 412 px po przewinięciu do końca (`shots-fix1/b2-metrics.json`,
  `b2-pl-412-light-bottom.png`): ostatni wiersz listwy kończy się na y = 743, przycisk zaczyna się na
  y = 755 (x 344-388). RODO (x 354-390) stoi w wierszu 687-711. Tak samo w EN, w ciemnym motywie.
- e2e „listwa prawna na telefonie (412 px, pl/en)”: PL w jasnym, EN w ciemnym motywie, decyzja
  o cookies zapisana przed bootem, przewinięcie do skutku (stopka ma `content-visibility: auto`).
  Przycisk musi być klikalny (`pointer-events` ≠ `none`). Dla każdego linku listwy
  `document.elementFromPoint(środek)` musi trafić w ten link, a prostokąt linku nie może przecinać
  prostokąta przycisku (WCAG 2.4.11). Na starym artefakcie oba przypadki padają: PL ma RODO
  zasłonięte, a prostokąty RODO i „Zwroty i reklamacje” przecinają przycisk; EN to samo z GDPR
  i Cookies.

### M1 cięcie 1 (`modulePreload.resolveDependencies`): ZROBIONE, zakres jednego chunku

- W `environments.client.build` obu konfiguracji (`vite.config.ts`, `vite.smoke.config.ts`) identycznie:
  `modulePreload.resolveDependencies: (file, deps) => /(?:^|\/)legal-links-[\w-]+\.js$/.test(file) ? [] : deps`.
- Zakres sprawdzony w źródle Vite 7.3.6 (`config.js`, `vite:build-import-analysis`, `generateBundle`).
  `resolveDependencies` dostaje plik importowany dynamicznie (`normalizedFile`). Dla każdego innego
  pliku zwracamy tę samą tablicę, więc ich `__vite__mapDeps` się nie zmienia. Ścieżka HTML (`hostType:
"html"`) dostaje plik wejścia, którego wzorzec nie łapie.
- Na artefakcie wejście ma teraz `d(()=>import("./legal-links-BUyzui7a.js"),[])`, a w tablicy
  `__vite__mapDeps` nie ma wpisu `assets/legal-links-…`. Porównanie wszystkich chunków z bazą
  (`cmp-assets.py`): rozmiar zmienił się wyłącznie w `legal-links` (nowy), `index` (wejście) oraz
  `pl`/`en` (klucz `footer.legal_nav`). Reszta 890 plików ma rozmiar bajt w bajt jak w bazie.
- Zachowanie się nie zmienia: to samo jedno żądanie chunku. Zależności `vendor-react`,
  `vendor-tanstack` i `vendor-i18n` są już załadowane przez boot.
- `viteChunkParity.test.ts`: nowy przypadek. Blok `modulePreload` jest identyczny w obu konfiguracjach,
  a wzorzec trafia w `assets/legal-links-HASH.js` i NIE trafia w `index-*`, `vendor-react-*`,
  `footer-legal-links-*`, `LegalLinksPanel-*` ani `legal-links-*.css`.
- e2e (m5 niżej) pilnuje też, że chunk listwy nie wraca na listę preloadu wejścia.
- Bilans w `index-*.js`: B1 to +48 B (`i.jsx(Sr,{label:"footer:legal-links",children:…})`), cięcie 1
  to −59 B (`__vite__mapDeps([158,1,2,7])` → `[]`, −26, i wpis w tablicy, −33). Netto **−11 B**
  względem `db56047e`.

### M1 cięcie 2 (zdjęcie wewnętrznego `Suspense`): ODRZUCONE decyzją orkiestratora

Granica zostaje: stopka nie może znikać przy świeżym montażu po nawigacji z `/admin` lub `/login`.

### m1: „zero nowych zapytań”. POPRAWIONE

Zdanie z IMPL dotyczyło wyłącznie danych i było nieprecyzyjne. Prawda wygląda tak: **jedno żądanie
leniwego chunku `legal-links-*.js` na odsłonę** (~0,5 KB gzip, 891 B surowo, cache `immutable`),
gdy wyspa stopki się otwiera. Dzieje się to przy widoczności, przy interakcji albo w punkcie ciszy,
czyli zwykle zaraz po boocie, także bez przewijania (recenzja: ~757 ms). Żądanie jest poza ścieżką do
LCP (`preLcpTransferBytes` się nie zmienia poza samym HTML-em). Wyspa stopki czeka na ten chunk przed
hydratacją. Pierwszy tap w nieuwodnioną stopkę czeka więc na RTT chunku (najwyżej
`CLICK_REPLAY_DEADLINE_MS`). Danych listwa nie czyta. Koszt i decyzja są opisane w komentarzu
w `Footer.tsx`.

### m2: fokus w jasnym motywie. ZROBIONE

`focus-visible:underline` w `LINK_CLASS`. Klasa była już w CSS, więc koszt CSS jest zerowy.
Podkreślenie ma kolor tekstu, więc kontrast ~16:1 w obu motywach. Pierścień `--ring` zostaje jako
drugi sygnał. Zrzut: `shots-fix1/pl-1350-light-focus.png`.

### m3: odstęp pionowy celów dotyku. ZROBIONE

`gap-y-2` w `LIST_CLASS` (klasa była już w CSS). Na 412 px wiersze (współrzędne okna po przewinięciu do końca)
zajmują 655-679, 687-711 i 719-743, czyli mają 8 px odstępu. Wcześniej stykały się: 6687,9, 6711,9
i 6735,9 we współrzędnych dokumentu. Desktop się nie zmienia, bo to jeden wiersz.
Komentarz o 24 px poprawiony: przy płynnym korzeniu desktopu `min-h-6` daje ~23 px, a 2.5.8 spełnia
wyjątek odstępu `gap-x-4`.

### m5: e2e nie pilnował wklejenia kodu listwy do wejścia. ZROBIONE

W teście SSR (`/` i `/en`) e2e pobiera `sets[0].e` (wejście `index-*.js`) i sprawdza:

- jest leniwy `import("./legal-links-*.js")`;
- NIE ma literału `footer.legal_nav` ani fragmentu klas `min-h-6 items-center rounded-sm underline-offset-2`;
- NIE ma wpisu `"assets/legal-links-*.js"` w tablicy preloadu.

Asercje są logiczne, z komunikatem, żeby porażka nie zrzucała do logu ~0,9 MB wejścia. Pierwsza
wersja z `not.toMatch` dawała 1,3 MB logu.

### n4: `role="list"`. ZROBIONE

`<ul role="list">`, bo lista ma `list-none` (Safari/VoiceOver). Wzorzec jest już w repo
(`SearchOverlay`, `ChartFrame`). eslint czysty.

### Bez zmian (zgodnie z decyzją)

- **m4** (baner cookies przy pierwszej wizycie zasłania listwę): zachowanie z założenia, nakładka sprzed
  zmiany. Do osobnego zadania (`scroll-padding-bottom` lub wcięcie przy widocznym banerze).
- **m6** (szablon `landing` chowa stopkę z listwą): z założenia, do decyzji właściciela, jeśli landingi
  sprzedają.
- **n1** (11,5 px wobec 12 px w wierszu praw autorskich), **n2** (duplikat linku do polityki prywatności
  z CMS, zgodny z WCAG 3.2.4), **n3** (`/en/wytyczne-dotyczace-reklam` z polskim tytułem, zadanie
  treściowe), **n5** (koszt klas w HTML-u, mały w gzipie), **n6** (hover bez zmiany koloru): bez zmian.

## 2. Zmienione pliki

| Plik                                                               | Zmiana                                                                                                                                    |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/Footer.tsx`                                        | `RenderErrorBoundary label="footer:legal-links"` wokół `Suspense` listwy; komentarz: koszt (1 żądanie), awaria i przeładowanie            |
| `src/components/footer/LegalLinks.tsx`                             | `pb-20` (B2), `gap-y-2` (m3), `focus-visible:underline` (m2), `role="list"` (n4), komentarze                                              |
| `vite.config.ts`, `vite.smoke.config.ts`                           | `modulePreload.resolveDependencies` tylko dla `legal-links-*.js` (M1 cięcie 1)                                                            |
| `src/lib/ci/__tests__/viteChunkParity.test.ts`                     | parytet bloku `modulePreload` i zakres wzorca                                                                                             |
| `src/components/__tests__/footerLegalLinksFailure.test.tsx` (nowy) | odrzucony import listwy: znika sama listwa, korzeń nietknięty                                                                             |
| `e2e/legal-links.boot-home.spec.ts`                                | m5 (wejście bez kodu listwy i bez preloadu), B2 (412 px, `elementFromPoint` i przecięcie z przyciskiem), B1 (awaria chunku na artefakcie) |

## 3. Pomiar (artefakt `BUNDLE_INVENTORY=1 build:smoke`, fixture, GET /, 5 próbek HIT)

`document-weight-fix1.json` wobec `document-weight-base.json` (baza) i `document-weight-2.json` (`db56047e`):

| Metryka                    | baza      | db56047e  | fix1          | fix1 − baza | fix1 − db56047e | próg      |
| -------------------------- | --------- | --------- | ------------- | ----------- | --------------- | --------- |
| bootClosureRawBytes        | 1 636 946 | 1 637 165 | **1 637 154** | **+208**    | −11             | 1 637 758 |
| bootClosureGzipBytes       | 496 041   | 496 155   | **496 072**   | **+31**     | −83             | 496 679   |
| bootBurstGzipBytes         | 574 062   | 574 164   | 574 118       | +56         | −46             | 574 673   |
| htmlRawBytes               | 337 696   | 339 967   | 340 180       | +2 484      | +213            | 406 180   |
| htmlGzipBytes              | 52 557    | 52 847    | 52 867        | +310        | +20             | 57 710    |
| preLcpTransferBytes        | 177 715   | 178 014   | 178 042       | +327        | +28             | 181 594   |
| renderBlockingCssGzipBytes | 80 426    | 80 435    | 80 443        | +17         | +8              | 81 399    |

- W domknięciu bootu zmienia się wyłącznie `index-*.js`: 863 586 (baza), potem 863 805 (`db56047e`),
  potem 863 794 (fix1). B1 to +48 B, cięcie M1 to −59 B. Gzip waha się o dziesiątki bajtów zależnie
  od układu treści, dlatego −83 B gzip względem `db56047e` przy −11 B surowo.
- HTML +213 B surowo / +20 B gzip względem `db56047e`: 8 × ` focus-visible:underline`, `gap-y-2`,
  `pb-20` i `role="list"`.
- Chunk `legal-links-*.js`: 848 → 891 B surowo (te same klasy i `role`).
- `check:bundle`: łączny JS klienta to 4755,1 KB gzip, baza 4754,4 KB (zmierzona tym samym skryptem
  przez `CLIENT_DIR`/`ENTRY_CHUNKS`), czyli **+0,7 KB**. Odczyt z rundy 1 (4752,8 KB, 1,6 KB PONIŻEJ
  bazy) to szum gzipu: nowy hash wejścia zmienia napisy importów w kilkuset chunkach. Rozmiary surowe
  wszystkich chunków poza czterema są identyczne z bazą.
- **Scalenie z P3.3:** zapas `bootClosureRawBytes` na tej bazie wynosi 604 B. P3.3 to +657 B, razem
  ok. 1 637 811 B, czyli **ok. 53 B ponad próg** (było 64 B). Cięcie 2 (−~41 B) odrzucone, więc
  nadal potrzebna decyzja: kolejność scalania albo świadome podniesienie progu o pomiar. Gzip mieści
  się razem z P3.3 z dużym zapasem.

## 4. Bramki (wszystkie zielone)

| Bramka                                                                                                                                                                                                                                 | Wynik                                                                                                | Log                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `bunx prettier --write` / `--check` (7 plików)                                                                                                                                                                                         | czysto                                                                                               | -                                                 |
| `bunx eslint` (7 plików)                                                                                                                                                                                                               | 0 błędów                                                                                             | -                                                 |
| typecheck (`typecheck-noinc.sh`: tsgo app, tsc scripts, tsgo e2e)                                                                                                                                                                      | zielony (2×, drugi po ostatniej zmianie e2e)                                                         | `typecheck-fix1.log`, `typecheck-fix1b.log`       |
| vitest, 11 plików / 199 testów (`footerLegalLinksFailure`, `footerIsland`, `Footer`, `SiteChrome`, `siteChromePersistence`, `LegalLinks`, `footerChrome`, `viteChunkParity`, `RenderErrorBoundary`, `cacheBusting`, `hydrationIsland`) | zielone                                                                                              | `vitest-fix1.log`                                 |
| `bun run verify:static`                                                                                                                                                                                                                | 15 bramek OK                                                                                         | `verify-static-fix1.log`                          |
| `BUNDLE_INVENTORY=1 bun run build:smoke`                                                                                                                                                                                               | OK                                                                                                   | `build-fix1.log`                                  |
| `check:bundle`, `check:chunks` (graf acykliczny), `check:entry-purity`                                                                                                                                                                 | zielone                                                                                              | `check:*-fix1.log`                                |
| `check-document-weight`                                                                                                                                                                                                                | „Waga dokumentu w progach”                                                                           | `docweight-fix1.log`, `document-weight-fix1.json` |
| e2e artefaktu (`test:e2e:artifact`, env jak w CI)                                                                                                                                                                                      | **17/17** (w tym 5 przypadków `legal-links.boot-home`)                                               | `e2e-fix1.log`                                    |
| kontrola negatywna: nowy spec na starym artefakcie `db56047e`                                                                                                                                                                          | 5 przypadków `legal-links` pada z oczekiwanych powodów (mapDeps, RODO/GDPR zasłonięte, brak granicy) | `e2e-fix1-on-old-artifact.log`                    |

Zrzuty po poprawce: `shots-fix1/` (412 i 1350, jasny i ciemny, fokus, hover; `b2-*-412-*-bottom.png`
z decyzją o cookies). Serwery uruchomione przez skrypty są zabite (porty 4181 i 4199 wolne).

## 5. Otwarte

1. Budżet `bootClosureRawBytes` przy scaleniu z P3.3: ok. 53 B ponad próg (sekcja 3).
2. Globalna siatka przeładowania przy zablokowanym `sessionStorage` może zapętlić przeładowania przy
   trwałej awarii DOWOLNEGO samoładującego się chunku (stan sprzed zmiany; sekcja B1). Kandydat na
   osobne zadanie.
3. m4 (baner cookies) i m6 (szablon `landing`) zgodnie z decyzją bez zmian.
