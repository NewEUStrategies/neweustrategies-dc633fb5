# Stan fali 2 (w toku, 2026-10-05)

Fala 2 programu PSI 85/95 według `PLAN-FALE-1-2.md` §3 i §6 oraz `PROMPTY-FALA-2.md`. Dokument jest aktualizowany po
każdej scalonej partii; werdykt bramki fali dopisze orkiestrator po partii 3.

## 1. Baza W2

- **W2 = `78356a7a`**: `main` z falami 0 i 1 (PR #469, #472) oraz PR #475 (CI tylko z bramkami chroniącymi produkcję).
  Worktree bazy zbudowany `BUNDLE_INVENTORY=1 bun run build:smoke` (2 min 12 s).
- Bramki na bazie:

| Bramka                               | Wynik                        | Liczby                                                                                                                                                                                 |
| ------------------------------------ | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check:bundle`                       | czerwone (tak jak na `main`) | overall 4790,9 KB > 4772; public 2841,9 / 2877; CSS 95,4 / 96 KB gz; public CSS 81,1 / 83; boot 477,3 KB gz / 1570,7 KB raw                                                            |
| `check:chunks`, `check:entry-purity` | zielone                      |                                                                                                                                                                                        |
| `check:document-weight`              | zielone 25/25                | `htmlRawBytes` 391,5 / 396,7 KB; `htmlGzipBytes` 55,5 / 56,4; `headRawBytes` 25,3 / 26,0; `inlineStyleCount` 50 / 50; `dehydratedStateBytes` 63,7 / 64,9; `modulepreloadCount` 25 / 25 |
| `format:check`                       | zielone                      |                                                                                                                                                                                        |

- Zapasy, które ograniczają falę: CSS klienta ok. 0,6 KB gz (P2.4, P2.6), `headRawBytes` ok. 0,7 KB (P2.1),
  `inlineStyleCount` 0.

## 2. A/A bazy z transformacją C3 (szum dla dowodów P2.2–P2.6)

`lighthouse-local.mjs --compare base base --runs 4 --forms mobile,desktop4x --client-backend fixture --html-transform
c3-lcpobs.mjs --html-transform-b c3-lcpobs.mjs`; 16/16 przebiegów ważnych.

| Forma     | TBT A / B (mediana) | FCP           | LCP    | SI            | perf    | CLS           |
| --------- | ------------------- | ------------- | ------ | ------------- | ------- | ------------- |
| mobile    | 366 / 410 ms        | 1,54 s        | 2,30 s | 1,65 / 1,61 s | 89 / 88 | 0,000         |
| desktop4x | 442 / 420 ms        | 0,44 / 0,41 s | 0,54 s | 0,62 / 0,68 s | 81 / 82 | 0,006 / 0,004 |

- Pary mobile: TBT σΔ 121 ms, MDE(t) 252 ms, MDE(z) 169 ms; FCP σΔ 0,042 s; SI σΔ 0,032 s. Efekty TBT pojedynczych
  pozycji poniżej ok. 170 ms rozstrzyga księga zadań, nie mediana.
- desktop4x: przebieg B-2 odstaje (TBT 1749 ms), stąd σΔ 630 ms; |ΔFCP| A/A 0,029 s (ponad próg 0,02 s).
- Przebieg A mobile-3 ma LCP 4,78 s przy 2,26–2,30 s w pozostałych: do obejrzenia przy wyzwalaczu P2.1.
- CLS desktop 0,004–0,006 jest na bazie (nagłówek i sekcja `…0029`, `STAN-FALI-1.md` §7 pkt 9) i przypisany do P2.3.

## 3. Pozycje

| Id                                   | Partia | Stan                                                                                   | Raporty             |
| ------------------------------------ | ------ | -------------------------------------------------------------------------------------- | ------------------- |
| P2.5 dieta dehydratacji              | 1a     | **scalone** (`9652d965`); dowód: struktura tak, rozmiar częściowo                      | `raporty/P2.5-*.md` |
| P2.6 dieta znaczników                | 1a     | **scalone** (`afcf927c`); dowód: struktura tak, czas w szumie                          | `raporty/P2.6-*.md` |
| P2.4 hydratacja per widget, animacje | 1b     | **scalone** (`48259396`); dowód: tak                                                   | `raporty/P2.4-*.md` |
| P2.3 nagłówek w oknie                | 1b     | **scalone** (`83d9cc80`); dowód: częściowo (kryteria zależne od I2 przechodzą do P2.2) | `raporty/P2.3-*.md` |
| P2.2 wyspy sekcji i stopki           | 2      | **scalone** (`ae602a97`); dowód: struktura tak, TBT w szumie                           | `raporty/P2.2-*.md` |
| P2.1 boot po LCP                     | 3      | **scalone** (`7ea62fe7`); dowód: tak (oba ramiona rozgrzewki)                          | `raporty/P2.1-*.md` |

## 4. Spike P2.1 (krok 0): parytet zielony, plan A

Commit `fe6ccfce` na gałęzi roboczej `perf/w2-P2.1`, jeszcze nie w gałęzi PR. Szczegóły: `raporty/P2.1-SPIKE.md`.

- `scripts/lib/bootAfterLcpPlugin.ts` (tylko build, środowisko `ssr`) przepisuje `tanstack-start-manifest:v`: puste
  `preloads` tras i korzenia, skrypt wejścia przeniesiony do serwerowego manifestu bootu. `<HeadContent>/<Scripts>`,
  kolektor `Link` i odwodniony manifest klienta renderują to samo.
- Sonda Playwright na artefakcie: `/`, `/en`, strona buildera `/$` (dwa fixture), `/welcome` (`ssr: false`) × UA
  przeglądarki i bota `Chrome-Lighthouse` (ścieżka `allReady`) × MISS i HIT × mobile i desktop: 36/36 z hydratacją,
  0 błędów hydratacji, `console.error` identyczne z bazą, markup SSR identyczny po normalizacji.
- 0 `modulepreload` w `<head>`, w `Link` z frameworka i w manifeście klienta (baza 11–62).
- Plan B (transformacja strumienia w `src/server.ts`) niepotrzebny i gorszy: renumeracja grafu `$R[n]` seroval w
  locie, łańcuch wrażliwy na tożsamość odpowiedzi albo koszt CPU workera przy każdym HIT.
- **Decyzje orkiestratora:** wykrywanie chunku wejścia w `scripts/check-entry-purity.ts` i
  `scripts/check-bundle-size.ts` (dziś regex na `scripts` manifestu, po spike'u czerwone) przechodzi do P2.1 jako
  uzupełnienie zakresu, bo P2.4 będzie wtedy scalone; rusztowanie spike'u w `__root.tsx` zastąpią: `bootManifest.ts`,
  `bootSet.server.ts` (wstrzyknięcie w wrapperze `router.options.dehydrate`) i `BOOT_LOADER_SCRIPT` w `<head>`.
- Do P3.4: zestaw bootu `/$` ma 62 URL-e (sama trasa 53 preloady, w tym chunk komponentu błędu).

## 4a. Partia 1a (P2.5, P2.6): scalona

Obie pozycje przeszły implementację, recenzję kontradyktoryjną (P2.5: trzy rundy, P2.6: dwie), rundy poprawek i dowód
A/B wobec bazy W2 z transformacją C3 po obu stronach (n = 5). Liczby: `raporty/P2.5-PROVE.md`, `raporty/P2.6-PROVE.md`.

| Miara (fixture `/`)                     |                  Baza |                                   P2.5 |                                                  P2.6 |
| --------------------------------------- | --------------------: | -------------------------------------: | ----------------------------------------------------: |
| `htmlRawBytes`                          |             400 880 B |                    389 642 B (−11 238) |                                    392 282 B (−8 598) |
| `htmlGzipBytes`                         |              57 039 B |                      54 983 B (−2 056) |                                       56 618 B (−232) |
| `dehydratedStateBytes` (bariera `$tsr`) |              65 199 B |     61 115 B (−4 084 raw, −0,12 KB gz) |                                             bez zmian |
| TBT mobile, mediana A → B               |                     – | 371 → 263 ms (pary −53 ms, MDE(t) 380) |                323 → 396 ms (pary +56 ms, MDE(t) 173) |
| TBT desktop4x, mediana A → B            |                     – |      nie mierzone (forma tylko mobile) |                525 → 419 ms (pary −71 ms, MDE(t) 311) |
| boot closure (gz)                       |              477,3 KB |                        478,2 KB (+0,9) |                                       477,6 KB (+0,3) |
| CLS                                     | 0,000 / 0,006 desktop |                                  0,000 | 0,000 / 0,006 desktop (to samo przesunięcie co w A/A) |

- P2.5: klucze `popup_*` znikają ze stanu SSR `/` (48 → 0); formularze inline (newsletter, join-us) i prefetch czytają
  projekcję, popup, admin i `registrationFields` zostają na pełnym kluczu; `carouselDefaults` nie idzie już ścieżką
  błędu dla poprawnych danych; ticker nie zapada się przy miękkiej zmianie języka (e2e 2/2). Estymata produkcyjna
  −3,5…−3,8 KB gz (plan: −8,4) przez przyjęte odchylenia: menu zachowuje oba języki etykiet i `ref_id` (MenuManager
  zapisuje całe drzewo z tego samego klucza), ticker bez języka w kluczu.
- P2.6: ramka widgetu, przejście obrazów slidera i szerokość kart multi-card bez powtarzanego `style=""`; kropki
  paginacji animują tylko `transform`/`opacity` (sonda CDP: A – szerokość, wysokość i kolor; B – tylko kompozytor);
  sonda `getComputedStyle` 390/820/1350 px, jasny i ciemny: 0 różnic dla 48 ramek, 25 obrazów i 20 kart. Efekt
  rozmiaru ok. 1/4 planu (pozycja obejmuje 3 z 19 powtarzalnych wartości `style`).
- Zadania ParseHTML/EvaluateScript dokumentu: kryterium „krótsze we wszystkich przebiegach” niespełnione w obu
  pozycjach; oczekiwany efekt (1–2 ms sym.) jest poniżej rozrzutu przebiegów. Rozliczenie pakietu dokumentu łącznie
  (P2.4 + P2.5 + P2.6) w bramce fali.
- Na scalonej głowie: vitest zmienionych testów 11 plików, 345 zielonych + 2 oczekiwane porażki; `typecheck` (tsc + scripts) zielony.

**Decyzje orkiestratora (partia 1a):**

1. P2.5: rozszerzenie własności o `NewsletterForm.tsx`, `JoinUsForm.tsx`, `prefetch.ts`, `NewsletterDocRenderer.tsx`
   (typ propsa), `newsletterFieldLabels.ts` i pięć plików testów – przyjęte (żadna inna pozycja fali ich nie dotyka).
2. Reguła „`check:bundle` nie gorzej niż baza”: przyjęte +0,9 KB gz bootu (P2.5, projekcje w `queryFn` są wymagane, by
   SSR, hydratacja i refetch miały jeden kształt) i +0,3 KB gz (P2.6, tabela klas ramki); progi bez zmian, overall
   czerwony jak na bazie.
3. P2.5: dodatkowe żądanie pełnych ustawień newslettera przez popup po `overlaysReady` (poza ścieżką LCP) – przyjęte.
4. P2.6: nowy test `builderWidgetNodeFrame.test.tsx` poza listą i reguła `prefers-reduced-motion` z 700 ms
   przenikaniem `opacity` (bez zmiany widocznej) – przyjęte.
5. Przekazania: ticker z językiem w kluczu i `keepPreviousData` (wymaga języka żądania w `__root.tsx`, P2.1 lub
   później); fixture bez menu (`homeFixture.ts` ignoruje embed `menus→menu_items`, więc pomiary fixture nie widzą menu
   nagłówka) – poprawka uprzęży po fali 2, żeby nie psuć porównywalności A/B w trakcie fali.

## 4c. Partia 1b (P2.4, P2.3): scalona

| Miara (fixture `/`, C3 po obu stronach, n = 5) | P2.4                                                                                                                                                                                     | P2.3 (dowód 2, `8505be5c`)                                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| TBT mobile, mediana A → B                      | 339 → 195 ms (pary −129 ms, 5/5 ujemnych)                                                                                                                                                | 201 → 178 ms (pary −7 ms); dowód 1: 300 → 185 ms (−99 ms, 5/5); pula 10 par ok. −53 ms                    |
| TBT desktop4x, mediana A → B                   | 373 → 266 ms (pary −95 ms)                                                                                                                                                               | 246 → 225 ms (pary −24 ms)                                                                                |
| Księga                                         | K15 (50 × `innerHTML` w commicie przełączenia urządzenia) 5/5 → 0/5; „Parse HTML & CSS” krótsze w 5/5 parach (239 → 120 ms); K16 skrócone; `icons-3` + `newsletter.confirm` 10/10 → 0/10 | ScriptCatchup mobile przesunięty przed FCP_sim (blokowanie 69 → 32 ms); przebieg korzenia bez zmian do I2 |
| HTML                                           | 400 880 → 356 740 B; `inlineStyleCount` 50 → 25                                                                                                                                          | −2,1 KB raw                                                                                               |
| CLS                                            | 0 / 0,006 desktop (przesunięcie z A/A)                                                                                                                                                   | desktop 0,003 → 0,000 (przesunięcie wiersza nagłówka usunięte, 0/10 przebiegów)                           |
| Boot (gz)                                      | +0,6 KB                                                                                                                                                                                  | +6,5 KB (prymityw wysp P1.6 w chunku wejściowym przez `Header.tsx`)                                       |

- P2.4: szablon typografii HW-2 (`data-wt` + zmienne per urządzenie, reguły raz w `styles.css`), `StyleSink` per widget,
  `useGlobalWidgetNode` tylko z `globalId`, `cn()` z pamięcią, `DynamicIcon` z SVG z DOM SSR, `CountryCombobox` leniwie,
  test animacji przy ładowaniu, strażnik generatora typografii w `check:entry-purity`. Sonda `getComputedStyle` (390/820/1350
  px, jasny/ciemny, z JS i bez): 0 różnic; akcja Kinetic Signal Notch 11 px/400 w 1332/1332 przypadków (AGENTS.md).
- P2.3: ukryty nagłówek desktopowy jako wyspa `media`, konto i wyszukiwarka na intencję (Radix, powitania, dyktowanie i
  model kubełków dopiero przy użyciu), ticker F9–F11 (bez wyspy: marquee nie jest czysto CSS), CLS wiersza nagłówka.
  Dwa przypadki e2e `header-intent` oznaczone `test.fail` do czasu I2 (P2.2).
- Przy scaleniu: `PostListView` importuje `normalizeTypographyGapPx` z lekkiego `liveTypography` (sugestia P2.4).

**Regresja bootu po scaleniu z `main` (naprawiona w PR).** Scalona głowa miała domknięcie bootu 503,4 KB gzip (baza W2
477,3) i 10 chunków: łączenie małych chunków (`experimentalMinChunkSize`) dokleiło do chunku wejściowego atom
`ClubThreadKindIcon.tsx`, a z nim cały `vendor-lucide` (+18 KB gzip). Źródło: zmiana Lovable w `main` (`ClubHubRail.tsx`
importuje `clubThreadKindIcon`, co rozbiło dawny wspólny chunk `threadIcons`). **Ta sama regresja jest na `origin/main`
`824584d1`, czyli na produkcji: domknięcie bootu 493,0 KB gzip.** Poprawka (`57681ad3`, `7d865b47`, `3841521a`):

- `manualChunks` obu presetów (identycznie, `viteChunkParity`): atom w chunku `club-thread-kind-icon`, `DynamicIcon` we
  własnym chunku `dynamic-icon` (bez tego Rollup wciąga zależność do chunku atomu i wejście importuje go stamtąd);
- `check:entry-purity`: leniwe chunki vendorowe (`vendor-lucide`, `vendor-radix` i grupy poza `-boot`, `vendor-sonner`,
  `vendor-jszip`) w domknięciu bootu = naruszenie; kontrola negatywna na buildzie przed poprawką: czerwone;
- wynik: boot 483,1 KiB gzip / 1593,3 KiB raw (próg 483,4 / 1599,4), 10 chunków (index + `dynamic-icon`); liczniki
  `modulepreloadCount`, `linkHeaderEntries`, `preloadedJsCount` podniesione o dokładnie 1 z kroniką w pliku progów.

Bramki scalonej głowy `3841521a`: `check:bundle` czerwone tylko overall 4799,8 KB (jak na `main`), `check:chunks`,
`check:entry-purity`, `check:server-entry-purity` zielone, `check:document-weight` 25/25, vitest zmienionych testów 23 pliki
zielone (213 + 1 oczekiwana porażka), `typecheck` zielony, `test:e2e:artifact` 8/8.

## 4d. Partia 2 (P2.2): scalona

Dowód wobec scalonej partii 1 (`3841521a`), C3 po obu stronach, n = 5 (`raporty/P2.2-PROVE-2.md`; runda 1 w
`P2.2-PROVE.md`). Recenzja kontradyktoryjna zatwierdziła implementację w pierwszej rundzie; poprawka po dowodzie 1
domknęła straż kliku wysp (pierwsze dotknięcie zimnej wyspy nie ginie) i regresję zegara interakcji first-visit.

| Miara                                        | mobile A → B                                              | desktop4x A → B          |
| -------------------------------------------- | --------------------------------------------------------- | ------------------------ |
| TBT, mediana                                 | 127 → 93 ms (pary −47 ms, MDE 113 – w szumie)             | 182 → 181 ms (w szumie)  |
| główny wątek                                 | 3927 → 2724 ms (pary −1168 ms, 5/5, poza MDE)             | 3209 → 2802 ms (−396 ms) |
| bootup                                       | 2096 → 1231 ms (pary −886 ms, 5/5)                        | 1634 → 1321 ms           |
| żądania / JS                                 | 94 → 70 / 673,7 → 637,9 KB                                | 91 → 76                  |
| plastry hydratacji K14                       | 138 → 69 zadań (395 → 199 ms obs.)                        | 98 → 70                  |
| późne zadania hydratacji sekcji ≥ 50 ms sym. | 8/10 → 0/10 przebiegów                                    |                          |
| K12 (commit hydratacji)                      | 80 → 71 ms sym. – nadal jedno zadanie ≥ 50 ms, nierozbite | 75 → 64 ms sym.          |
| CLS                                          | 0                                                         | 0 w 5/5                  |

- I2 wdrożone (stała wartość kontekstu gościa w `useAuth`, lustro motywu, `applyTheme` synchronicznie na `<html>`);
  dwa przypadki `header-intent` z P2.3 zdjęte z `test.fail` i zielone (10/10); poprawka wyzwalacza `media` w prymitywie
  (zmiana zapytania między renderem a efektem nie ginie); `run-first-visit --compare`: CLS 0 w 28/28, 8/8 wysp zachowuje
  węzły serwera; `check:first-visit-regression` 32/32.
- **Decyzja orkiestratora:** progi `bootClosureGzipBytes` (+1 694 B) i `preloadedJsGzipBytes` (+1 688 B) podniesione
  dokładnie o przyrost P2.2 z kroniką w pliku progów (`8a26b3eb`); jedyne cięcie w plikach P2.2 to ok. 150 B. P2.1
  zdejmie modulepreload i obniży te progi ratchetem.
- Otwarte (przekazanie): rejestr chunków wysp jest pusty (leniwe widgety są prywatne w `lazyWidgets.tsx`, poza plikami
  P2.2) – wyspy otwierają się na wyzwalacz, a utratę pierwszego kliku łapie straż; `vendor-radix` u gościa zostaje przez
  statyczny import `WidgetView → formFieldConfig` (`MessageComposerField`, `AdminSelect`); K16 (restyle po
  `data-device`) bez zmian; K12 nierozbite. Kandydaci do fali 3 (P3.3, P3.4) albo higieny po fali.
- Scalona głowa `8a26b3eb`: `check:bundle` czerwone tylko overall 4801,9 KB, `check:chunks`, `check:entry-purity`,
  `check:server-entry-purity` zielone, `check:document-weight` 25/25, `typecheck` zielony, vitest zmienionych testów 9
  plików / 225 zielonych, `test:e2e:artifact` 8/8.

## 4e. Partia 3 (P2.1, boot po LCP): scalona

Spike parytetu (krok 0, plan A) → kroki 1–5 → recenzja (zatwierdzona) → dowód 1 (błąd blokujący: wejście bootu wstawiane
przed końcem parsowania dawało `Invariant failed` na dokumencie w porcjach) → poprawka → dowód 2. A = scalone P2.2–P2.6
(`8a26b3eb`), B = P2.1 (`cad29e86`), bez transformacji C3, fixture + `fake-gtag`, n = 5 na formę i stronę
(`raporty/P2.1-PROVE-2.md`).

| Forma (ramię browser / bot) | perf A → B                | FCP A → B                             | LCP A → B                             | TBT A → B (pary, MDE)                                    |
| --------------------------- | ------------------------- | ------------------------------------- | ------------------------------------- | -------------------------------------------------------- |
| mobile                      | 72 → **97** / 71 → **96** | 4,14 → **1,54 s** / 4,19 → **1,54 s** | 4,91 → **2,31 s** / 4,96 → **2,33 s** | 33 → 100 / 66 → 109 ms (+79 / +65, MDE 109 / 155 – szum) |
| desktop                     | 98 → 100                  | 0,80 → 0,39 s / 0,82 → 0,42 s         | 0,92 → 0,54 s                         | 0 → 0                                                    |
| desktop4x                   | 94 → 92 / 92 → 87         | 0,96 → 0,42 s                         | 1,00 → 0,56 s                         | 169 → 226 / 193 → 308 ms (szum)                          |
| desktop5x                   | 80 → 79 / 82 → 80         | 0,91 → 0,45 s                         | 0,93 → 0,56 s                         | 396 → 479 / 371 → 463 ms (szum)                          |

- Struktura: `scriptBytesEndedBeforeObsLcp` = 0 w 50/50 przebiegach B (A: 26 skryptów, 517,9 KB); seria bootu startuje
  +44…+101 ms po obserwowanym LCP w 50/50; pula High przed obrazem LCP 630,6 → 112,6 KB; nagłówek `Link`: 0
  modulepreload (baza 27); zestaw bootu `#nes-boot-set` także w dokumencie bota (ścieżka `allReady`); zalogowany,
  ramka podglądu i trasy bez kandydata bootują od razu; CLS maks. 0,0007.
- Sprzężenie TBT (Style, ScriptCatchup, na desktop4x/5x także ParseHTML dokumentu w oknie [FCP, TTI]) jest
  przewidziane planem i mniejsze od prognozy (+154 ms); rozlicza je bramka fali (§6).
- Bramki: `check:bundle` B lepsze od bazy o 0,2–0,4 KB (overall czerwony jak na `main`), `check:entry-purity` i
  `check:bundle` czytają wejście z serwerowej mapy bootu, `test:e2e:artifact` 9/9, `consent-shell-geometry` +
  `on-demand-overlays` 9/9, `check:document-weight` 28/28 (nowe metryki zestawu bootu; progi modulepreload w dół).
- **Decyzja orkiestratora – favicon** (`3a40c23c`): `public/favicon.ico` miał jeden PNG 256 px (26 KB) pobierany z
  priorytetem High przed obserwowanym LCP; Lantern dokładał go szeregowo za obrazem kandydata (+152 ms LCP mobile w 4/15
  przebiegów, tryb górny 2,44–2,60 s; wariant okładek leadów 2,44 s > 2,4). Teraz 16 + 32 px (2,5 KB), ten sam obraz
  pomniejszony; `apple-touch-icon` jako osobny PNG 180 px.
- Formatowanie prettier sześciu plików z `main` (commity Lovable), żeby `format:check` w CI był zielony (`ca34249c`).
- Przekazania: ticker nagłówka z językiem w kluczu (P2.5) nie zrobiony – wymaga `headerTickerQuery.ts` i
  `TrendingTicker.tsx`; druga okładka leada przed obserwowanym LCP w 1/5 przebiegów wariantu okładek (ryzyko P1.4);
  opcjonalny ratchet w dół `bootClosure*` o ok. 0,3–0,4 KB.

## 4b. Przerwa i wznowienie

Limit użycia sesji przerwał oba workflowy partii 1 (ok. 16:07–19:44 UTC). Wznowienie od miejsca przerwania: P2.4 od
recenzji (implementacja była zacommitowana; orkiestrator nałożył przygotowaną poprawkę testu `joinUsWidgetSizes` spoza
listy), P2.3 od przerwanej implementacji, P2.5 od rundy poprawek, P2.6 od dokończenia dowodu bez powtarzania buildu i
A/B na tym samym commicie. `main` (39 commitów Lovable) scalony do gałęzi PR bez konfliktów (`e129ca33`).

## 5. Zmiany procesu względem dokumentów fali

- `workflow-faza2-wave.js` czyta dla fali 2 `PROMPTY-FALA-2.md`, §3 planu fal i `STAN-FALI-1.md` §7; środowisko z
  `args`; kroki ciężkie przez `heavy-bg.sh` bez opakowań `bash -c`.
- Agenci nie odtwarzają bramek i testów usuniętych w PR #475 (decyzja właściciela); testy z list własności, których
  już nie ma, zastępują skupione testy zachowania.
- Zamiast osobnych baz W2 w dwóch ramionach rozgrzewki (`--warm-ua browser` i `bot`) przed falą: A/A z C3 (§2);
  baza w obu ramionach zostanie zmierzona w porównaniu bramki fali (A = W2-baza, B = W2-koniec).
- Uzupełnienia zakresu przypisane przed startem: P2.5 – `carouselDefaults.ts` (`queryFn` z `safeParse` idącym
  ścieżką błędu); P2.3 – CLS desktop nagłówka i sekcji `…0029` oraz F9–F11 (ticker).
