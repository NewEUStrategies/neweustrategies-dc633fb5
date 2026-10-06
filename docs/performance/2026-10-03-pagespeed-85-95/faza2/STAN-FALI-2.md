# Stan fali 2 po bramce (2026-10-06)

Fala 2 programu PSI 85/95 według `PLAN-FALE-1-2.md` §3 i §6 oraz `PROMPTY-FALA-2.md`. Wszystkie pozycje (P2.1–P2.6) są
scalone do gałęzi PR `claude/zen-ritchie-hzur21` (PR #476); werdykt bramki fali: §6.

> **Werdykt bramki fali 2: niezaliczona** (oba ramiona rozgrzewki, 60/60 przebiegów ważnych, dwie niezależne
> weryfikacje). Zaliczone: (b) 0 B skryptów przed obserwowanym LCP w 30/30 przebiegach W2, (c) TBT mobile 40,8 / 83,0 ms
> (browser / bot; kruche – na hoście kalibracji k ok. 470 ms), (f) CLS 0 w 30/30. Niezaliczone: (a) dosłownie –
> mediany FCP 1,55 / 1,54 s i LCP 2,33 / 2,31 s są w progu, ale po jednym przebiegu na ramię ponad progiem; (d) TBT
> desktop4x 216 / 268 ms > 150 ms (było 157 / 263 ms na W1); (e) zadania ParseHTML i skryptu loadera bootu ≥ 50 ms
> sym. w oknie TBT (11/15 / 9/15 przebiegów); (g) bot jak browser. W1 → W2 na mobile: perf 72 → 98 / 69 → 97, FCP
> 4,10 → 1,55 s, LCP 4,81 → 2,33 s, TBT 115 → 41 / 177 → 83 ms. Prognoza PSI (host znormalizowany): mobile 85,2
> (83,1–88,5), desktop 90,5–91,1. **Konsekwencja według planu: P2.1 zostaje w gałęzi PR bez wdrożenia, P3.1, P3.3 i
> P3.4 są obowiązkowe (P3.4 razem z K4i w `bootLoaderScript.ts`), P3.2 jest warunkiem bramki W3, a wdrożenie i
> potwierdzenie PSI następują po zielonej bramce W3.**

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

## 6. Bramka fali 2 (2026-10-06)

Bramka fali 2 według `PLAN-FALE-1-2.md` §3.3 pkt 5 (kryteria (a)–(g)) i akapitu „Definition of Done fali 2”, z
poprawkami §6. Wszystkie pozycje fali (P2.1–P2.6) są scalone do gałęzi PR `claude/zen-ritchie-hzur21` (§3).

- **A = W1** = `main` @ `78356a7a` (fale 0 i 1, PR #469, #472, #475; bez fali 2), worktree `$SCRATCH/base-w2`.
- **B = W2** = gałąź PR @ `ca34249c`: P2.1–P2.6, scalenie `main` `e129ca33`, naprawa regresji bootu
  `57681ad3`/`7d865b47`/`3841521a`, favicon `3a40c23c`, prettier `ca34249c`; worktree `$SCRATCH/gate-w2`.
- Drzew nie przebudowywano (`.output` z 2026-10-05 13:48 i 2026-10-06 06:47); `lighthouse-local.mjs` po obu stronach
  bajt w bajt ten sam. Dwie serie A/B z przeplotem: `--warm-ua browser` (07:35:40–07:47:21 UTC) i `--warm-ua bot`
  (07:47:36–07:59:22 UTC), formy mobile, desktop4x i desktop5x, po 5 przebiegów na stronę, flagi
  `--client-backend fixture --third-party fake-gtag --save-artifacts`. Komendy, tabele surowe i uwagi o ważności:
  `POMIAR.md` §9. Liczby maszynowo: `raporty/W2-wyniki.json`.
- **Ważność:** 60/60 przebiegów ważnych, `excluded` 0, dokument HIT w każdym przebiegu, wariant stały po każdej
  stronie (browser A 400 880 B, B 337 912 B; bot A 392 234 B, B 330 857 B), księga Lantern = audyt TBT w 60/60,
  0 zadań Google w 60/60, load 0,74–1,98 (próg 2,4).
- **Zakres werdyktu: wyłącznie `ca34249c`.** Gałąź poszła dalej o `5f0f1037` (raporty P2.1 i ten plik, same
  dokumenty) i `ad8be46c` (sam test `ThemeBackgroundsPane`); kod produktu się nie zmienił.

Werdykty przeszły dwie niezależne weryfikacje: statystyka i trafność oraz atrybucja i kompletność. Rozbieżności
rozstrzygnąłem na danych surowych (§6.9). Dwie zmieniają liczby: odniesienie normalizacji szybkości hosta (prognoza
PSI mobile 86,7 → 85,2) oraz atrybucję timera loadera P2.1. Żadna nie zmienia werdyktu kryterium ani bramki. Werdykt
(a) zapisuję dosłownie jako niezaliczony (analiza: „częściowo”), bo kryterium wymaga progu we wszystkich przebiegach;
mediany są w progu. Kodu produktu, testów, konfiguracji ani progów nie zmieniałem.

### 6.0 Werdykt w skrócie

| Kryterium (§3.3 pkt 5)                                                           | browser (`--warm-ua browser`)                            | bot (`--warm-ua bot`)              | Kluczowe liczby (browser / bot)                                                                                                           |
| -------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| (a) mobile FCP ≤ 1,6 s, LCP ≤ 2,4 s we wszystkich przebiegach                    | **niezaliczone** (mediany w progu, 1/5 przebiegów ponad) | **niezaliczone** (jw.)             | mediany FCP 1,554 / 1,542 s, LCP 2,332 / 2,307 s; ponad progiem: browser B-mobile-3 LCP 2,452 s, bot B-mobile-4 FCP 1,624 s i LCP 2,436 s |
| (b) `scriptBytesEndedBeforeObsLcp` = 0 (bez `/~flock.js`), boot po obs. LCP      | **zaliczone** 15/15                                      | **zaliczone** 15/15                | 0 B w 30/30 przebiegach B; seria bootu +52…+66 / +53…+84 ms po obs. LCP; W1: 25 skryptów / 520 692 B przed obs. LCP w 30/30               |
| (c) TBT mobile ≤ 200 ms (mediana, n ≥ 5) i księga ≤ 200 ms, ALBO `score.py` ≥ 87 | **zaliczone**                                            | **zaliczone**                      | TBT = księga 40,8 / 83,0 ms (maks. 55,5 / 108,4). **Kruche:** na hoście o szybkości z kalibracji k TBT 468,0 / 477,5 ms (§6.6)            |
| (d) desktop4x TBT ≤ 150 ms; desktop5x raport                                     | **niezaliczone**                                         | **niezaliczone**                   | desktop4x 216,0 / 268,0 ms, 0/5 przebiegów ≤ 150 ms w każdym ramieniu; desktop5x 407,0 / 358,1 ms                                         |
| (e) brak ParseHTML ani inline EvaluateScript ≥ 50 ms sym. w [FCP, TTI]           | **niezaliczone**                                         | **niezaliczone**                   | przebiegi B z zadaniem 11/15 / 9/15; sam ParseHTML 7/15 / 9/15; maks. 120 / 153 ms sym.                                                   |
| (f) CLS ≤ 0,001, żadne przesunięcie > 0,0005 (≥ 5 przebiegów)                    | **zaliczone** 15/15                                      | **zaliczone** 15/15                | B: CLS 0 i 0 zdarzeń `LayoutShift` w śladzie w 30/30 przebiegach                                                                          |
| (g) wariant bota spełnia te same progi                                           | –                                                        | **niezaliczone**                   | bot oblewa (a), (d) i (e) tak jak browser                                                                                                 |
| **Bramka fali 2 łącznie**                                                        | **niezaliczona**                                         | **niezaliczona**                   | (a), (d), (e) w obu ramionach, (g)                                                                                                        |
| Definition of Done fali 2                                                        | **częściowo**                                            | **częściowo**                      | TBT i prognozy PSI spełnione; FCP i LCP 0,02–0,06 s ponad pasmem (§6.2)                                                                   |
| Prognoza PSI (`score.py`, k z POMIAR §7, host znormalizowany)                    | mobile **85,2**, desktop **90,45**                       | mobile **85,2**, desktop **91,05** | niepewność metody: mobile 83,1–88,5, desktop 88,05–94,65; na hoście bramki (górna granica) 93,0 / 96,75–97,65 (§6.7)                      |

**Konsekwencja według planu (§3.3 pkt 5):** bramka niezaliczona, więc **P2.1 zostaje w gałęzi PR (bez wdrożenia),
P3.1, P3.3 i P3.4 są obowiązkowe, a wdrożenie następuje dopiero po zielonej bramce W3.** Lista fali 3 wyprowadzona z
księgi jest w §6.8.

### 6.1 Kryteria (a)–(g)

Źródła: LHR (`audits.*.numericValue`), `summary.json` (`records[].ledger`), księgi `lanternTasks.ts --min 0 --json`
(60 przebiegów; wygenerowane przez analizę i niezależnie przez obie weryfikacje), ślady i devtoolsLogi z `*.artifacts`. Okno TBT księgi: [FCP_opt, TTI_pes],
bo `simStart` księgi pochodzi z symulacji pesymistycznej. „≥ 50 ms sym. w oknie” oznacza `simDur` ≥ 50 ms i nachodzenie
na okno. MDE(t) = (t₀,₉₇₅ + t₀,₈)·σΔ/√n, dla n = 5 mnożnik 3,717.

| Kryterium                                                                                                    | Werdykt                                              | Dowód                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) mobile FCP ≤ 1,6 s, LCP ≤ 2,4 s                                                                          | **niezaliczone** (dosłownie); na medianach zaliczone | FCP B per przebieg: browser 1525 / 1537 / 1598 / 1554 / 1570 ms, bot 1532 / 1555 / 1542 / **1624** / 1521 ms. LCP: browser 2282 / 2302 / **2452** / 2332 / 2360 ms, bot 2290 / 2327 / 2307 / **2436** / 2281 ms. Oba przekroczenia mają tę samą przyczynę, ustaloną na śladach. Zadanie ParseHTML nagłówka (linie 0–200, z `ParseAuthorStyleSheet`) zaczęło się już po zakończeniu pobierania arkusza `styles-*.css`: 87,8 ms obs. wobec 81,4 ms w browser B-mobile-3, 82,9 wobec 81,6 ms w bot B-mobile-4. Lantern stawia je więc w grafie LCP za arkuszem (68,8 KB), a przed fontem (30 KB). W symulacji optymistycznej zajmuje 1536–1598 / 1530–1624 ms i wyznacza FCP. Font trwa wtedy 305 / 302 ms zamiast 151–158 ms, a obraz `cover.jpg` (110,3 KB) kończy się w 2452 / 2436 ms. Element LCP = `img[data-lcp-candidate]` w 60/60. |
| (b) `scriptBytesEndedBeforeObsLcp` = 0 (bez `/~flock.js`) we wszystkich przebiegach; seria bootu po obs. LCP | **zaliczone** w obu ramionach                        | B: 0 skryptów i 0 B zakończonych przed obs. LCP w 30/30 przebiegach, zarówno w harnessie, jak i niezależnie w devtoolsLog. `/~flock.js` nie wystąpił. Pierwszym skryptem jest zawsze wejście `/assets/index-fO-Yix7R.js`, inicjowane skryptem, a nie parserem. Seria bootu rusza +52…+66 ms (browser) i +53…+84 ms (bot) po obs. LCP. W1: 25 skryptów / 520 692 B przed obs. LCP w 30/30, seria rusza 191–387 ms przed obs. LCP.                                                                                                                                                                                                                                                                                                                                                                                                         |
| (c) TBT mobile ≤ 200 ms i księga ≤ 200 ms, ALBO `score.py` ≥ 87 po k                                         | **zaliczone** w obu ramionach (na zmierzonej serii)  | TBT B per przebieg: browser 35,5 / 28,0 / 40,8 / 55,5 / 55,0 ms (mediana **40,8**), bot 69,5 / 83,0 / 108,4 / 58,0 / 88,0 ms (mediana **83,0**). Księga = audyt w 5/5 i ≤ 200 ms w każdym przebiegu. Alternatywa też przechodzi: `score.py` z TBT × 0,72 daje 97,75 / 97,75 z FCP/LCP/SI serii (mediana wyników per przebieg) i 93,00 / 93,00 z metrykami PSI-podobnymi (FCP 1,8 / LCP 2,85 / SI 3,7 s). **Zastrzeżenie (§6.6):** na hoście o szybkości z serii kalibracji k ten sam ślad daje 468,0 / 477,5 ms. Wariant główny byłby wtedy niezaliczony, a alternatywa wyszłaby 89,95 / 89,95 z serii (zaliczona) i 85,20 / 85,20 PSI-podobnie (niezaliczona).                                                                                                                                                                          |
| (d) desktop4x ≤ 150 ms; desktop5x raport                                                                     | **niezaliczone** w obu ramionach                     | desktop4x B: browser 216,0 / 249,5 / 174,5 / 203,5 / 222,5 ms (mediana **216,0**), bot 185,5 / 272,0 / 301,5 / 268,0 / 250,5 ms (mediana **268,0**). Żaden z 10 przebiegów nie schodzi do 150 ms. Pary W2−W1: +23,2 / −18,9 ms przy MDE(t) 123,8 / 63,3, czyli brak zmiany. desktop5x (raport): 407,0 / 358,1 ms, pary −123,5 / −165,7 ms, w szumie.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| (e) brak ParseHTML ani inline EvaluateScript ≥ 50 ms sym. w [FCP, TTI]                                       | **niezaliczone** w obu ramionach                     | Przebiegi B z zadaniem: browser 11/15 (mobile 1, desktop4x 5, desktop5x 5), bot 9/15 (1, 3, 5). Maksimum 120 / 153 ms sym., blokowanie do 66 / 103 ms. **Skrypt inline dokumentu** daje w oknie 11 zadań, wszystkie z loadera bootu P2.1 (`bootLoaderScript.ts`, linia 201 dokumentu): 9 to handler `DOMContentLoaded` (funkcja `Y` → `Z()` wymusza pierwszy Style+Layout: 390–669 elementów, 50–153 ms sym.), 2 to callback timera `boot()` (bot B-desktop5x-1 i -3, 51 / 72 ms sym.). **ParseHTML** to porcje strumienia dokumentu: linie 0–200, 200–675, 675–676. Bez rozszerzenia o skrypt inline sam ParseHTML też oblewa: browser 7/15, bot 9/15. Bez desktop5x kryterium także oblewa: browser 6/10, bot 4/10. W1 dla porównania: browser 6/15, bot 5/15 przebiegów (głównie desktop5x).                                          |
| (f) CLS ≤ 0,001, żadne przesunięcie > 0,0005                                                                 | **zaliczone** w obu ramionach                        | B: CLS 0, 0 pozycji w audycie `layout-shifts` i 0 zdarzeń `LayoutShift` w śladzie w 30/30 przebiegach. W1 dla porównania: browser A-mobile-5 0,4014 (kolumna `…001b`, `had_recent_input = true`), desktop A 0,0016–0,0113 (sekcja `…0029`), bot A-mobile-4 0,0006. Nieobecność przesunięć nie dowodzi naprawy (STAN-FALI-1 §7 pkt 5).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| (g) wariant bota                                                                                             | **niezaliczone**                                     | Ramię bota (dokument, który PSI dostaje na MISS; zestaw bootu `#nes-boot-set` także w nim) zachowuje się jak browser: (b), (c) i (f) zaliczone, (a), (d) i (e) niezaliczone. Bot ma wyższe TBT (mobile 83,0 wobec 40,8 ms, desktop4x 268,0 wobec 216,0 ms) i większy wymuszony układ w handlerze loadera (640–669 wobec 481–512 elementów na desktopie).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

### 6.2 Definition of Done fali 2

| Warunek DoD (§3.3; §6)                                                                       | Zmierzone (browser / bot)                                                                                                            | Werdykt                                                                       |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| fixture mobile x4 TBT 234–457 ms w kombinacji (C3 sam: 885)                                  | 40,8 / 83,0 ms, czyli lepiej niż pasmo. Na hoście znormalizowanym 468,0 / 477,5 ms, ponad pasmem                                     | **spełnione** (na zmierzonej serii; argument odporności nie trzyma się, §6.6) |
| §6: fixture po W2 z C3 ×0,5 / pełne – mobile 201 / 87, d4 244 / 130, d5 450 / 229 ms         | mobile 40,8 / 83,0 (lepiej niż „pełne”); d4 216,0 / 268,0 (browser między ×0,5 a pełnymi, bot ponad ×0,5); d5 407,0 / 358,1 (między) | mobile tak, desktop częściowo                                                 |
| FCP 1,37–1,52 s                                                                              | mediany 1,554 / 1,542 s, czyli +0,034 / +0,022 s ponad pasmem; w paśmie 0/5 przebiegów (min. 1,525 / 1,521 s)                        | **niespełnione**                                                              |
| LCP 2,12–2,27 s                                                                              | mediany 2,332 / 2,307 s, czyli +0,062 / +0,037 s; w paśmie 0/5 (min. 2,282 / 2,281 s)                                                | **niespełnione**                                                              |
| prognoza PSI mobile 81–87 (centralnie 84)                                                    | 85,20 / 85,20 (F1h, §6.7); przy niepewności metody 83,1–88,5                                                                         | **spełnione** (środek pasma)                                                  |
| prognoza PSI desktop 82–85                                                                   | 90,45 / 91,05 (F1h)                                                                                                                  | **spełnione z nadwyżką**                                                      |
| jeśli bramka zielona: wdrożenie i potwierdzenie PSI (`hl=pl`, `psi-sample.mjs`, mediana z 5) | bramka niezielona                                                                                                                    | nie dotyczy                                                                   |
| **DoD łącznie**                                                                              |                                                                                                                                      | **częściowo**                                                                 |

Brakujące 0,02–0,06 s FCP i LCP wynikają z łańcucha CSS → font → `cover.jpg`, który jest zakresem P3.2. W 8/10
przebiegów font trwa 151–158 ms, a obraz 605–632 ms (`analiza/lcp-graph-B-mobile.txt`).

### 6.3 W1 → W2 (pary A-n/B-n)

Δ = W2 − W1; poza perf ujemna wartość oznacza poprawę. Mediany i pary z LHR (`W2-wyniki.json` `series`), liczby
dla TBT, FCP, LCP, SI i TTI identyczne z liniami `PAIRS` harnessu. Weryfikacja statystyki odtworzyła je z LHR bez
rozbieżności.

#### mobile

| metryka       | browser W1 → W2 (mediany) | pary Δ̄ (σΔ; MDE(t); t; znak)                  | bot W1 → W2 (mediany) | pary Δ̄ (σΔ; MDE(t); t; znak)                   |
| ------------- | ------------------------- | --------------------------------------------- | --------------------- | ---------------------------------------------- |
| perf          | 72 → **98**               | +29,0 (9,75; 16,2; 6,65; 5/5 dodatnich)       | 69 → **97**           | +27,6 (1,8; 3,0; 33,97; 5/5 dodatnich)         |
| FCP [s]       | 4,104 → **1,554**         | −2,099 s (1,023; 1,701; −4,59; 5/5 ujemnych)  | 4,124 → **1,542**     | −2,551 s (0,056; 0,093; −101,40; 5/5 ujemnych) |
| LCP [s]       | 4,812 → **2,332**         | −2,527 s (0,130; 0,216; −43,44; 5/5 ujemnych) | 4,885 → **2,307**     | −2,541 s (0,069; 0,114; −82,53; 5/5 ujemnych)  |
| TBT [ms]      | 114,5 → **40,8**          | −89,7 (37,9; 63,0; −5,30; 5/5 ujemnych)       | 176,5 → **83,0**      | −101,8 (74,3; 123,5; −3,06; 5/5 ujemnych)      |
| SI [s]        | 4,104 → **1,554**         | −2,099 s (1,023; 1,701; −4,59; 5/5 ujemnych)  | 4,124 → **1,629**     | −2,419 s (0,141; 0,235; −38,24; 5/5 ujemnych)  |
| TTI [s]       | 5,783 → **5,464**         | −0,374 s (0,168; 0,279; −4,98; 5/5 ujemnych)  | 5,883 → **5,489**     | −0,346 s (0,230; 0,383; −3,36; 5/5 ujemnych)   |
| obs. FCP [ms] | 247 → **185**             | −81,2 (42,6; 70,8; −4,26; 5/5 ujemnych)       | 316 → **207**         | −104,2 (43,1; 71,7; −5,40; 5/5 ujemnych)       |
| obs. LCP [ms] | 262 → **187**             | −88,6 (36,0; 59,8; −5,51; 5/5 ujemnych)       | 316 → **207**         | −104,2 (43,1; 71,7; −5,40; 5/5 ujemnych)       |
| obs. SI [ms]  | 275 → **192**             | −120,6 (50,5; 83,9; −5,34; 5/5 ujemnych)      | 361 → **209**         | −156,8 (32,2; 53,6; −10,88; 5/5 ujemnych)      |

#### desktop4x

| metryka       | browser W1 → W2 (mediany) | pary Δ̄ (σΔ; MDE(t); t; znak)                     | bot W1 → W2 (mediany) | pary Δ̄ (σΔ; MDE(t); t; znak)                    |
| ------------- | ------------------------- | ------------------------------------------------ | --------------------- | ----------------------------------------------- |
| perf          | 95 → **93**               | +1,0 (4,5; 7,5; 0,49; 2 dodatnie, 3 ujemne)      | 88 → **89**           | +3,0 (2,7; 4,6; 2,45; 4 dodatnie, 1 zerowa)     |
| FCP [s]       | 0,851 → **0,396**         | −0,461 s (0,106; 0,177; −9,71; 5/5 ujemnych)     | 0,853 → **0,489**     | −0,377 s (0,051; 0,086; −16,39; 5/5 ujemnych)   |
| LCP [s]       | 0,931 → **0,548**         | −0,404 s (0,046; 0,077; −19,53; 5/5 ujemnych)    | 0,934 → **0,560**     | −0,383 s (0,015; 0,025; −58,10; 5/5 ujemnych)   |
| TBT [ms]      | 156,6 → **216,0**         | +23,2 (74,5; 123,8; 0,70; 4 dodatnie, 1 ujemna)  | 262,5 → **268,0**     | −18,9 (38,1; 63,3; −1,11; 2 dodatnie, 3 ujemne) |
| SI [s]        | 0,851 → **0,564**         | −0,322 s (0,079; 0,131; −9,13; 5/5 ujemnych)     | 0,853 → **0,663**     | −0,219 s (0,076; 0,127; −6,43; 5/5 ujemnych)    |
| TTI [s]       | 1,747 → **1,248**         | −0,470 s (0,224; 0,373; −4,69; 5/5 ujemnych)     | 1,874 → **1,309**     | −0,583 s (0,127; 0,211; −10,25; 5/5 ujemnych)   |
| obs. FCP [ms] | 333 → **140**             | −159,8 (100,8; 167,5; −3,55; 5/5 ujemnych)       | 369 → **238**         | −117,0 (60,6; 100,7; −4,32; 5/5 ujemnych)       |
| obs. LCP [ms] | 333 → **262**             | −79,8 (88,4; 147,0; −2,02; 1 dodatnia, 4 ujemne) | 369 → **238**         | −117,0 (60,6; 100,7; −4,32; 5/5 ujemnych)       |
| obs. SI [ms]  | 368 → **223**             | −149,6 (91,3; 151,8; −3,66; 5/5 ujemnych)        | 406 → **270**         | −137,0 (63,6; 105,8; −4,81; 5/5 ujemnych)       |

#### desktop5x

| metryka       | browser W1 → W2 (mediany) | pary Δ̄ (σΔ; MDE(t); t; znak)                       | bot W1 → W2 (mediany) | pary Δ̄ (σΔ; MDE(t); t; znak)                  |
| ------------- | ------------------------- | -------------------------------------------------- | --------------------- | --------------------------------------------- |
| perf          | 74 → **82**               | +7,2 (7,5; 12,5; 2,14; 5/5 dodatnich)              | 76 → **84**           | +8,2 (5,1; 8,4; 3,62; 5/5 dodatnich)          |
| FCP [s]       | 0,906 → **0,440**         | −0,476 s (0,095; 0,157; −11,25; 5/5 ujemnych)      | 0,882 → **0,397**     | −0,462 s (0,114; 0,190; −9,06; 5/5 ujemnych)  |
| LCP [s]       | 0,971 → **0,549**         | −0,448 s (0,083; 0,137; −12,10; 5/5 ujemnych)      | 0,969 → **0,552**     | −0,398 s (0,051; 0,085; −17,50; 5/5 ujemnych) |
| TBT [ms]      | 606,0 → **407,0**         | −123,5 (192,7; 320,3; −1,43; 2 dodatnie, 3 ujemne) | 496,0 → **358,1**     | −165,7 (158,5; 263,5; −2,34; 5/5 ujemnych)    |
| SI [s]        | 0,940 → **0,725**         | −0,228 s (0,111; 0,184; −4,59; 5/5 ujemnych)       | 0,916 → **0,625**     | −0,270 s (0,099; 0,165; −6,10; 5/5 ujemnych)  |
| TTI [s]       | 2,352 → **1,565**         | −0,792 s (0,276; 0,459; −6,41; 5/5 ujemnych)       | 2,315 → **1,393**     | −0,845 s (0,174; 0,289; −10,87; 5/5 ujemnych) |
| obs. FCP [ms] | 328 → **247**             | −88,6 (53,3; 88,5; −3,72; 5/5 ujemnych)            | 332 → **232**         | −122,8 (58,1; 96,6; −4,72; 5/5 ujemnych)      |
| obs. LCP [ms] | 328 → **247**             | −88,6 (53,3; 88,5; −3,72; 5/5 ujemnych)            | 334 → **248**         | −92,2 (12,6; 20,9; −16,39; 5/5 ujemnych)      |
| obs. SI [ms]  | 366 → **261**             | −112,4 (31,6; 52,4; −7,97; 5/5 ujemnych)           | 370 → **233**         | −136,0 (32,9; 54,7; −9,25; 5/5 ujemnych)      |

- **Mobile:** wszystkie metryki czasu są lepsze w 5/5 parach w obu ramionach. LCP −2,53 / −2,54 s, FCP i SI ok.
  −2,1…−2,6 s, TBT −89,7 / −101,8 ms, perf +29,0 / +27,6 pkt. |Δ̄| < MDE(t) tylko dla TBT i TTI w ramieniu bota.
- **desktop4x:** FCP −0,46 / −0,38 s, LCP −0,40 / −0,38 s, TTI −0,47 / −0,58 s (5/5), ale TBT i perf bez zmiany w
  granicach szumu.
- **desktop5x:** FCP i LCP jak na desktop4x, TBT −123,5 / −165,7 ms (w szumie), perf +7,2 / +8,2.
- Linie `DELTA` harnessu dla mobile (browser / bot): główny wątek −2025 / −2544 ms, bootup −1364 / −1614 ms, transfer
  −94,5 / −94,2 KB, JS −67,3 KB, bajty High przed obrazem LCP −508,1 KB, żądania −26 / −28.
- **Waga dokumentu** (`check-document-weight`, 5 próbek HIT; oba drzewa w swoich progach), W1 → W2:
  - `htmlRawBytes` 391,5 → 330,0 KB, `htmlGzipBytes` 55,5 → 51,4 KB;
  - `headRawBytes` 25,3 → 28,3 KB (loader i zestaw bootu P2.1);
  - `inlineStyleCount` 50 → 25, `modulepreloadCount` 25 → 0;
  - `preLcpTransferBytes` 727,9 → 173,9 KB;
  - `bootClosureGzipBytes` 474,0 → 484,5 KB.

### 6.4 Księga Lantern per klasa: W2 wobec W1 (zmierzone)

Źródło: `lanternTasks.ts --min 0 --json` na 60 przebiegach, klasy K według heurystyki `kclass()` (nazwy jak w P0.5
§1.4 i STAN-FALI-1). Sumy klas = TBT.

**Korekta arbitra:** w bot desktop5x dwa zadania `Timer:(dokument)` to callback timera `boot()` loadera P2.1
(`TimerFire` → `FunctionCall` z dokumentu, linia 201). Przeniosłem je z „Kmod” do K4i.

**Ramię browser** – mediana blokowania klasy [ms] W1 → W2 (w nawiasie: przebiegi z blokowaniem > 0; przebiegi z zadaniem ≥ 50 ms sym. w oknie)

| klasa                                     | mobile                       | desktop4x                     | desktop5x                       |
| ----------------------------------------- | ---------------------------- | ----------------------------- | ------------------------------- |
| K7 ScriptCatchup                          | 0,0 (0; 1) → **0,0** (0; 3)  | 78,0 (4; 5) → **96,0** (5; 5) | 159,0 (5; 5) → **136,0** (5; 5) |
| K5/K6 klatka Style+Layout dokumentu ($RV) | 0,0 (0; 0) → **0,0** (0; 0)  | 36,5 (3; 3) → **43,0** (5; 5) | 92,8 (5; 5) → **87,0** (5; 5)   |
| K4i loader bootu P2.1 (DCL `Y`, timer)    | 0,0 (0; 0) → **0,0** (0; 0)  | 0,0 (0; 0) → **19,0** (4; 5)  | 0,0 (0; 0) → **0,0** (1; 1)     |
| K4 ParseHTML dokumentu                    | 0,0 (1; 1) → **0,0** (1; 1)  | 0,0 (1; 1) → **0,0** (1; 1)   | 1,0 (3; 4) → **30,0** (5; 5)    |
| K12 commit hydratacji                     | 13,0 (5; 5) → **3,0** (5; 5) | 31,0 (5; 5) → **11,5** (5; 5) | 67,0 (5; 5) → **29,0** (5; 5)   |
| K13 styl wymuszony z `index`              | 5,0 (3; 3) → **0,0** (2; 2)  | 9,0 (4; 4) → **0,0** (2; 2)   | 29,0 (5; 5) → **18,5** (5; 5)   |
| K14 plastry Reacta                        | 12,5 (5; 5) → **0,0** (2; 2) | 44,9 (5; 5) → **0,0** (2; 2)  | 146,5 (5; 5) → **23,0** (5; 5)  |
| K15 ParseHTML w commicie (`innerHTML`)    | 70,0 (5; 5) → **0,0** (0; 0) | 0,0 (0; 0) → **0,0** (0; 0)   | 0,0 (0; 0) → **0,0** (0; 0)     |
| K16 restyle po przełączeniu urządzenia    | 0,0 (1; 1) → **7,8** (3; 3)  | 0,0 (0; 0) → **0,0** (0; 0)   | 0,0 (0; 0) → **0,0** (0; 0)     |
| K11/K10 `Timer:index`                     | 0,0 (1; 1) → **0,0** (2; 2)  | 3,0 (3; 3) → **4,0** (3; 3)   | 25,0 (5; 5) → **4,5** (4; 5)    |
| K9 przebieg korzenia (`Script:index`)     | 0,0 (0; 0) → **0,0** (2; 2)  | 0,0 (0; 0) → **0,0** (0; 0)   | 0,0 (0; 0) → **0,0** (0; 0)     |
| K9a ewaluacja modułów wejścia             | 0,0 (0; 0) → **0,0** (0; 0)  | 0,0 (0; 0) → **0,0** (0; 0)   | 0,0 (1; 1) → **8,0** (3; 3)     |
| K7b `v8.compileModule`                    | 0,0 (0; 0) → **0,0** (0; 0)  | 0,0 (0; 0) → **0,0** (0; 0)   | 0,0 (0; 0) → **0,0** (1; 1)     |
| K6b klatka po starcie bootu               | 0,0 (1; 1) → **0,0** (0; 0)  | 0,0 (1; 1) → **0,0** (0; 0)   | 23,5 (4; 4) → **0,0** (0; 0)    |
| **TBT (mediana, = suma księgi)**          | 114,5 → **40,8**             | 156,6 → **216,0**             | 606,0 → **407,0**               |

**Ramię bot** – mediana blokowania klasy [ms] W1 → W2 (w nawiasie: przebiegi z blokowaniem > 0; przebiegi z zadaniem ≥ 50 ms sym. w oknie)

| klasa                                     | mobile                        | desktop4x                      | desktop5x                       |
| ----------------------------------------- | ----------------------------- | ------------------------------ | ------------------------------- |
| K7 ScriptCatchup                          | 0,0 (0; 0) → **0,0** (1; 4)   | 97,0 (5; 5) → **123,0** (5; 5) | 156,0 (5; 5) → **143,0** (5; 5) |
| K5/K6 klatka Style+Layout dokumentu ($RV) | 0,0 (0; 0) → **0,0** (0; 0)   | 0,0 (2; 5) → **89,0** (5; 5)   | 109,0 (5; 5) → **0,0** (2; 2)   |
| K4i loader bootu P2.1 (DCL `Y`, timer)    | 0,0 (0; 0) → **0,0** (0; 0)   | 0,0 (0; 0) → **0,0** (0; 0)    | 0,0 (0; 0) → **77,0** (4; 4)    |
| K4 ParseHTML dokumentu                    | 0,0 (0; 0) → **0,0** (1; 1)   | 0,0 (1; 1) → **0,0** (2; 3)    | 2,0 (3; 4) → **19,0** (5; 5)    |
| K12 commit hydratacji                     | 14,0 (5; 5) → **10,0** (5; 5) | 52,0 (5; 5) → **21,5** (5; 5)  | 65,0 (5; 5) → **36,0** (5; 5)   |
| K13 styl wymuszony z `index`              | 25,0 (5; 5) → **2,0** (3; 3)  | 28,0 (5; 5) → **6,0** (5; 5)   | 35,0 (5; 5) → **13,5** (5; 5)   |
| K14 plastry Reacta                        | 41,5 (5; 5) → **8,0** (4; 4)  | 69,5 (5; 5) → **5,0** (4; 5)   | 111,0 (5; 5) → **21,0** (5; 5)  |
| K15 ParseHTML w commicie (`innerHTML`)    | 70,0 (5; 5) → **0,0** (0; 0)  | 0,0 (0; 0) → **0,0** (0; 0)    | 0,0 (0; 0) → **0,0** (0; 0)     |
| K16 restyle po przełączeniu urządzenia    | 0,0 (0; 0) → **35,0** (4; 4)  | 0,0 (0; 0) → **0,0** (0; 0)    | 0,0 (0; 0) → **0,0** (0; 0)     |
| K11/K10 `Timer:index`                     | 18,0 (4; 5) → **8,0** (4; 4)  | 11,0 (5; 5) → **0,0** (1; 1)   | 27,0 (5; 5) → **17,0** (5; 5)   |
| K9 przebieg korzenia (`Script:index`)     | 0,0 (0; 0) → **0,0** (0; 0)   | 0,0 (0; 0) → **0,0** (0; 0)    | 0,0 (0; 0) → **0,0** (0; 0)     |
| K9a ewaluacja modułów wejścia             | 0,0 (0; 0) → **0,0** (2; 2)   | 0,0 (1; 1) → **0,0** (0; 2)    | 0,0 (0; 0) → **0,0** (1; 2)     |
| K7b `v8.compileModule`                    | 0,0 (0; 0) → **0,0** (0; 0)   | 0,0 (0; 0) → **0,0** (0; 0)    | 0,0 (0; 0) → **0,0** (2; 2)     |
| K6b klatka po starcie bootu               | 0,0 (0; 0) → **0,0** (0; 0)   | 0,0 (0; 0) → **0,0** (0; 0)    | 0,0 (0; 0) → **0,0** (0; 0)     |
| **TBT (mediana, = suma księgi)**          | 176,5 → **83,0**              | 262,5 → **268,0**              | 496,0 → **358,1**               |

- **Spłacone przez falę 2:**
  - K15 (`innerHTML` w commicie przełączenia urządzenia): mobile 70,0 → 0 ms w obu ramionach, 0/5 przebiegów (P2.4).
  - K14 (plastry Reacta): mobile 12,5 / 41,5 → 0,0 / 8,0 ms, desktop4x 44,9 / 69,5 → 0,0 / 5,0, desktop5x
    146,5 / 111,0 → 23,0 / 21,0 (P2.2).
  - K13 jest mniejszy we wszystkich formach, K11/K10 poza browser desktop4x (3,0 → 4,0 ms).
  - K12 jest mniejszy (desktop4x 31,0 / 52,0 → 11,5 / 21,5 ms), ale **nadal ma zadanie ≥ 50 ms sym. w oknie w 5/5
    przebiegach każdej formy i ramienia**: commit nie jest rozbity (przekazanie P2.2).
- **Nowe w oknie na W2:**
  - **K4i**, loader bootu P2.1: browser desktop4x 0/5 → 5/5 (19,0 ms), bot desktop5x 0/5 → 4/5 (77,0 ms).
  - **K16**, restyle po przełączeniu urządzenia (693–694 elementów): mobile 1/5 → 3/5 i 0/5 → 4/5, czyli 7,8 /
    35,0 ms.
  - Na mobile **K7** `ScriptCatchup` ≥ 50 ms sym. w oknie: 1/5 → 3/5 i 0/5 → 4/5. Blokowania prawie nie daje (bot
    1/5, 11,9 ms), bo zadanie przecina FCP_sim.
  - Porcje **K4** ParseHTML na desktopie: desktop4x bot 1/5 → 3/5, desktop5x 4/5 → 5/5 w obu ramionach (30,0 / 19,0
    ms).
- **Na desktopie już w oknie na W1, nie wciągnięte przez falę 2:**
  - **K7** w 5/5 przebiegów desktop4x i desktop5x obu ramion. Przykład: A-desktop4x-2 ma FCP_opt 811 ms, a K7
    1074 + 164 ms sym. Na W2 K7 rośnie na desktop4x (78,0 → 96,0, 97,0 → 123,0 ms), a spada na desktop5x
    (159,0 → 136,0, 156,0 → 143,0).
  - **K5/K6** na desktop4x 3/5 i 5/5.
  - **Dlaczego desktop4x nie zyskał na TBT:** spadki K14, K12 i K13 zrównoważył wzrost K7, K5/K6 i dojście K4i.

### 6.5 Bramki repo na W2 (`ca34249c`)

| Bramka                                                            | W2                                        | Uwagi                                                                                                                                                                                        |
| ----------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build:smoke` (`vite.smoke.config.ts`)                            | zielone                                   | kod 0                                                                                                                                                                                        |
| `typecheck` (tsc + scripts)                                       | zielone                                   |                                                                                                                                                                                              |
| `verify:static`                                                   | zielone (14 bramek, w tym `format:check`) |                                                                                                                                                                                              |
| lint                                                              | zielone                                   | 0 błędów, 262 ostrzeżenia                                                                                                                                                                    |
| `check:bundle`                                                    | **czerwone** tylko overall                | 4801,6 KB > 4772 (baza W2: 4790,9, czerwone tak jak na `main`). Public 2851,0 / 2877, największy chunk 262,2 / 286, CSS 95,7 / 96 KB, public CSS 81,5 / 83, boot 487,9 KB gz (baza W2 477,3) |
| `check:chunks`, `check:entry-purity`, `check:server-entry-purity` | zielone                                   | 893 chunki / 6864 krawędzie, acykliczny; boot 10 chunków; 1809 plików serwera                                                                                                                |
| `check:document-weight`                                           | zielone (oba drzewa w swoich progach)     | §6.3                                                                                                                                                                                         |
| `test:e2e:artifact`                                               | zielone (9/9)                             |                                                                                                                                                                                              |
| vitest pełny                                                      | **1 plik czerwony**                       | 3092 pliki zielone; 2 testy `ThemeBackgroundsPane` oczekują `#fcfcf9`, dostają `#F8F7F3` (kolor z `main`). Poprawione samym testem w `ad8be46c`, w bramce nie powtórzone                     |

### 6.6 Wrażliwość na szybkość hosta (przeliczenie Lantern, bez nowego pomiaru)

benchmarkIndex przebiegów wynosił 1759–2779. W serii kalibracji k (POMIAR §7) mediany LHR były 1538,5 (mobile) i
1575 (desktop4x). Host bramki był więc ok. ×1,4–1,7 szybszy. TBT jest progowe (blokowanie = czas − 50 ms), dlatego
na szybszym hoście spada nieproporcjonalnie.

**Metoda.** Lantern liczony od nowa na tych samych artefaktach z mnożnikiem CPU m' = m × benchmarkIndex przebiegu /
mediana LHR serii kalibracji, z tymi samymi funkcjami co audyt. Przy m' = m TBT jest równe audytowi.
Przeliczenie wykonałem ponownie i jest identyczne bajt w bajt z weryfikacją.

| ramię   | forma     | benchmarkIndex B (przebiegi)           | m' B                              | TBT A: zmierzone → m' (mediana) [ms] | TBT B przy m': przebiegi; mediana (zmierzone) [ms]   | pary B−A przy m': Δ̄ / σΔ / MDE(t) / t |
| ------- | --------- | -------------------------------------- | --------------------------------- | ------------------------------------ | ---------------------------------------------------- | ------------------------------------- |
| browser | mobile    | 2778,5, 2637,0, 2553,0, 2445,5, 2617,0 | 7,224, 6,856, 6,638, 6,358, 6,804 | 114,5 → **374,5**                    | 503,2, 396,5, 483,3, 468,0, 381,5; **468,0** (40,8)  | −43,6 / 242,25 / 402,7 / −0,40        |
| browser | desktop4x | 2406,5, 2689,0, 2352,0, 2423,0, 2367,5 | 6,112, 6,829, 5,973, 6,154, 6,013 | 156,6 → **672,0**                    | 499,5, 743,0, 432,7, 565,0, 540,4; **540,4** (216,0) | −145,7 / 51,9 / 86,3 / −6,28          |
| bot     | mobile    | 2371,5, 2367,0, 2377,5, 2307,5, 2364,0 | 6,166, 6,154, 6,181, 5,999, 6,146 | 176,5 → **364,2**                    | 477,5, 506,2, 530,5, 182,5, 434,0; **477,5** (83,0)  | +38,3 / 227,1 / 377,6 / +0,38         |
| bot     | desktop4x | 2464,0, 2454,0, 2202,5, 2000,0, 2266,0 | 6,258, 6,232, 5,594, 5,079, 5,755 | 262,5 → **857,2**                    | 491,5, 609,5, 642,0, 443,5, 512,0; **512,0** (268,0) | −305,5 / 113,9 / 189,3 / −6,00        |

- **Przy m' TBT mobile W2 nie jest niższe niż W1** (pary −43,6 / +38,3 ms przy MDE(t) 402,7 / 377,6). Wartość
  bezwzględna 468,0 / 477,5 ms przekracza próg (c), który wynosi 200 ms.
- Na desktop4x W2 jest wyraźnie lepsze od W1 (t −6,28 / −6,00), ale 540,4 / 512,0 ms to 3,4–3,6 razy próg (d).
- **Największa klasa przy m' to K7 `ScriptCatchup`.** Mobile:
  - K7 172,0 / 162,0 ms (≥ 50 ms sym. w oknie 5/5 / 4/5);
  - dalej K16 60,0 / 81,0, K14 36,0 / 40,0, K11/K10 31,0 / 39,0, K13 26,0 / 30,0, K12 24,5 / 29,0.

  Desktop4x: K7 172,0 / 204,0, K5/K6 90,0 / 149,0, K4i 67,0 (browser), K12 33,0 / 47,5 ms.

- **Kontrola metody na drzewie W1:** stronę A tej serii przeliczyłem do szybkości hosta bramki W1 i porównałem z TBT
  zmierzonym w bramce W1.

  | forma     | przeliczone | zmierzone w bramce W1 | błąd  |
  | --------- | ----------- | --------------------- | ----- |
  | mobile    | 515,5 ms    | 374 ms                | +38 % |
  | desktop4x | 885 ms      | 1037 ms               | −15 % |

  Punkt znormalizowany jest więc przedziałem szerokim na kilka punktów PSI, a nie liczbą z dokładnością 0,1.

- **Wniosek:** werdykty (d) i (e) nie zależą od hosta, bo przy m' są gorsze. Werdykt (c) zależy od niego.

### 6.7 Prognoza PSI (`score.py`)

**Referencja:** PSI 2026-10-03 18:58 CEST (`hl=pl`). `score.py` odtwarza ją jako 53,10 mobile i 69,80 desktop.

| forma   | FCP   | LCP   | TBT    | SI    | CLS | wynik |
| ------- | ----- | ----- | ------ | ----- | --- | ----- |
| mobile  | 3,1 s | 6,6 s | 600 ms | 4,9 s | 0   | 53    |
| desktop | 0,6 s | 1,1 s | 740 ms | 1,5 s | –   | 70    |

**Założenia:**

- TBT PSI = k × TBT fixture W2, k z POMIAR §7: mobile 0,72, desktop4x 0,42.
- FCP, LCP i SI PSI-podobne z projekcji `faza1/PLAN.md` §1.5 dla W2: mobile 1,8 / 2,85 / 3,7 s, desktop 0,45 / 0,85 /
  1,3 s; CLS 0.
- **F1h (punkt)** = k × TBT przy m'. **F1** = k × TBT zmierzone na hoście bramki. F1 to tylko górna granica: k
  skalibrowano przy TBT 832 ms, a proporcjonalne przełożenie 40–80 ms nie ma podstawy empirycznej.

| wariant                                               | TBT PSI mobile [ms] (browser / bot) | mobile                | TBT PSI desktop [ms]      | desktop                   |
| ----------------------------------------------------- | ----------------------------------- | --------------------- | ------------------------- | ------------------------- |
| **F1h, host znormalizowany (punkt)**                  | 337,0 / 343,8                       | **85,20 / 85,20**     | 227,0 / 215,0             | **90,45 / 91,05**         |
| F1h, rozrzut po przebiegach                           | –                                   | 84,6–87,3 / 84,0–91,8 | –                         | 85,05–93,15 / 87,75–92,85 |
| F1h przy niepewności metody (−15…+38 % TBT)           | 244,5–394,8 / 249,4–402,8           | 83,4–88,5 / 83,1–88,2 | 164,7–266,0 / 156,0–252,0 | 88,05–94,35 / 88,95–94,65 |
| F1h × 0,81 (korekta przeplotu, STAN-FALI-1 §5.3)      | 272,9 / 278,5                       | 87,60 / 87,30         | –                         | 93,15 / 93,75             |
| F1h z FCP/LCP/SI serii (mediana wyników per przebieg) | –                                   | 89,95 / 89,95         | –                         | –                         |
| F1, host bramki (górna granica)                       | 29,4 / 59,8                         | 93,00 / 93,00         | 90,7 / 112,6              | 97,65 / 96,75             |
| F1 z desktop5x zamiast desktop4x                      | –                                   | –                     | 170,9 / 150,4             | 94,05 / 94,95             |

Siatka mobile przy F1h (wynik zależny od LCP PSI; oba ramiona dają te same liczby):

| FCP / SI [s] | LCP 2,4 | 2,7  | 2,85 | 3,0  | 3,14 | 3,3  | 3,6  | 4,0  |
| ------------ | ------- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| 1,6 / 3,4    | 88,2    | 86,8 | 86,0 | 85,0 | 84,0 | 83,0 | 80,8 | 78,0 |
| 1,8 / 3,7    | 87,5    | 86,0 | 85,2 | 84,2 | 83,2 | 82,2 | 80,0 | 77,2 |
| 2,0 / 4,2    | 86,0    | 84,5 | 83,8 | 82,8 | 81,8 | 80,8 | 78,5 | 75,8 |
| 2,2 / 4,2    | 85,5    | 84,0 | 83,2 | 82,2 | 81,2 | 80,2 | 78,0 | 75,2 |

- **Próg 87 na mobile przy F1h** (FCP 1,8 / SI 3,7 s) wymaga LCP PSI ≤ 2,50 s, a próg 85 – LCP ≤ 2,86 s. Przy FCP 2,0
  / SI 4,2 s progi wynoszą 2,21 / 2,65 s, a przy ×0,81 dla 87 – 2,94 / 2,90 s.
- **LCP PSI po W2 jest niezmierzone.** Fixture ma LCP 2,31–2,33 s, a dokument PSI waży 569 KB wobec 330 857–337 912 B
  na fixture. Dwa założenia (żadne nie jest pomiarem):
  - stosunek PSI/fixture z W0 (6,6 / 4,84 s) daje LCP 3,18 / 3,15 s i wynik 82,95 / 83,20;
  - stała różnica +1,7 s daje 76,95.
- **Wobec planu:** mobile 85,2 mieści się w paśmie 81–87 i leży blisko jego środka (84). Desktop 90,45–91,05 jest
  powyżej pasma 82–85.
- Liczby z poprzedniej wersji analizy (86,70 / 86,10 mobile, 91,05 / 91,65 desktop, próg LCP 2,78 / 2,69 s) są
  zastąpione (§6.9, S-D1).

### 6.8 Konsekwencja według planu i fala 3

**Konsekwencja (§3.3 pkt 5, `faza1/PLAN.md` W2 „Bramka fali”):** bramka niezaliczona, więc P2.1 zostaje w gałęzi PR
bez wdrożenia, P3.1, P3.3 i P3.4 są obowiązkowe, a wdrożenie następuje po zielonej bramce W3. Bramka W3 to bramka W2
oraz:

- ΔLCP mobile ≤ −0,1 s z P3.2;
- brak `ScriptCatchup` ≥ 50 ms sym. w oknie, jeśli P3.4 uruchomiono;
- zmierzone desktop4x i desktop5x.

Potwierdzenie PSI `hl=pl` przesuwa się za bramkę W3.

Lista fali 3 z księgi W2. „Górna granica” to TBT przebiegu minus blokowanie wskazanych klas przy niezmienionym oknie.
To arytmetyka księgi, nie prognoza; podaję medianę po przebiegach.

| Pozycja                                      | Warunek z planu                                                   | Dane W2 (zmierzone; przy m')                                                                                                                                                                                                                             | Wskazanie                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P3.4** stopniowany burst bootu             | `ScriptCatchup` ≥ 50 ms sym. w oknie po W2                        | desktop4x 5/5 + 5/5 (96,0 / 123,0 ms), desktop5x 5/5 + 5/5 (136,0 / 143,0), mobile 3/5 + 4/5; przy m' największa klasa mobile (172,0 / 162,0 ms)                                                                                                         | **MUST.** Uzupełnienie zakresu: **K4i** (handler DCL `Y`, którego pomiar pola kandydata `Z()` przez `getBoundingClientRect` wymusza Style+Layout, i callback timera `boot()`), bo to ten sam plik `src/lib/boot/bootLoaderScript.ts`; decyzja orkiestratora przed startem W3. Górna granica desktop4x bez K7: 115,5 / 149,0 ms, przebiegi do 153,5 / 177,0 |
| **P3.3** `content-visibility` sekcji ≥ 2     | zadanie stylu/layoutu dokumentu ≥ 50 ms sym. w oknie po W2        | K5/K6 desktop4x 5/5 + 5/5 (43,0 / 89,0 ms), desktop5x 5/5 (browser), bot K5/K6 2/5 + K4i 3/5 = 5/5; przy m' desktop4x 90,0 / 149,0                                                                                                                       | **MUST.** Górna granica desktop4x bez K7, K5/K6 i K4i: 53,5 / 43,0 ms (przebiegi do 107,5 / 88,0). Próg (d) jest w zasięgu tylko przy P3.4 (z K4i) i P3.3 razem                                                                                                                                                                                            |
| **P3.1** zadania wciągnięte do okna przez C3 | ≥ 50 ms sym. w oknie na W2, nieobecne na W1, bez właściciela w W2 | K9 `Script:index` (browser mobile 0/5 → 2/5; przy m' do 118 ms), K9a moduły wejścia (bot mobile 0/5 → 2/5, przy m' 21,0 ms 3/5; desktop5x 1/5 → 3/5 i 0/5 → 2/5), K7b `v8.compileModule` `vendor-react` (desktop5x 0/5 → 1/5 i 2/5, do 67 ms blokowania) | **MUST** (konsekwencja bramki). Do decyzji orkiestratora jako uzupełnienie zakresu: K16 (P2.4 + P2.2; przy m' druga klasa mobile, 60,0 / 81,0 ms)                                                                                                                                                                                                          |
| **P3.2** bajty zbioru LCP                    | ΔLCP mobile ≤ −0,1 s (warunek bramki W3)                          | łańcuch CSS 68,8 KB → font 30 KB → `cover.jpg` 110,3 KB; tryb górny (font 302–305 ms zamiast 151–158) w 2/10 przebiegów, czyli oba przekroczenia (a); DoD FCP/LCP chybia o 0,02–0,06 s                                                                   | **MUST** (warunek bramki W3). Preload jednego fontu w `<head>` powinien zdjąć zależność fontu od zadania parsowania nagłówka (do sprawdzenia w grafie LCP), a hero 640w skraca obraz                                                                                                                                                                       |
| **(e) ParseHTML dokumentu**                  | bramka W3 obejmuje (e)                                            | sam ParseHTML: browser 7/15, bot 9/15 (desktop5x 5/5 + 5/5, desktop4x 1/5 + 3/5, mobile 1/5 + 1/5); żadna pozycja W3 nie obejmuje tego zadania                                                                                                           | **Decyzja przed W3:** właściciel porcji ParseHTML (dalsza dieta dokumentu po P2.4–P2.6 albo P4.1 dla arkusza w nagłówku) albo jawne odstępstwo dla desktop5x. Bez tego bramka W3 nie przejdzie na (e)                                                                                                                                                      |
| K12, K13, K11/K10                            | (w oknie już na W1)                                               | K12 ≥ 50 ms sym. w 5/5 każdej formy (P2.2, nierozbity); przy m' mobile K13 26,0 / 30,0 i K11/K10 31,0 / 39,0 ms                                                                                                                                          | SHOULD: K12 do P2.2/P5.1, K11/K10 do P5.2, K13 bez właściciela W2                                                                                                                                                                                                                                                                                          |

**Mobile na hoście kalibracji.** Nawet bez K7, K5/K6 i K4i przy m' TBT mobile wynosi 221,5 / 299,5 ms (mediany), czyli
ponad 200 ms. Zostają K16, K14, K11/K10, K13 i K12. Zielone (c) w bramce W3 na szybkim hoście nie wystarczy więc jako
dowód celu 85. Rozstrzygną dopiero dane PSI: JSON-y z D13 i rekalibracja k na hoście o znanym benchmarkIndex.

**Kolejność według danych:** P3.4 razem z K4i → P3.3 → P3.2 → P3.1. K4i i P3.4 zmieniają ten sam plik
(`bootLoaderScript.ts`), więc trafiają do jednej pozycji.

### 6.9 Rozbieżności rozstrzygnięte na danych surowych

- **S-D1, odniesienie normalizacji hosta. Rację ma weryfikacja; liczby się zmieniają.**
  - Analiza dzieliła benchmarkIndex przebiegu (z LHR) przez 1616,5, czyli benchmark atrapy gtag zmierzony przed serią
    kalibracji.
  - Mediany LHR samej serii kalibracji to 1538,5 i 1575 (`lighthouse-local-baseline-w1.json`
    `forms.*.median.benchmarkIndex`). Licznik i mianownik muszą pochodzić z tego samego źródła.
  - Przeliczyłem `cpu-whatif.mjs` z `CAL_BENCH` i wynik jest identyczny bajt w bajt z weryfikacją: TBT mobile
    468,0 / 477,5 ms (było 416,3 / 431,5), desktop4x 540,4 / 512,0 ms, F1h mobile 85,20 / 85,20 (było 86,70 /
    86,10), desktop 90,45 / 91,05, próg LCP dla 87: 2,50 s (było 2,78 / 2,69).
  - Zdanie DoD „przy m' w paśmie 234–457” jest fałszywe: wartości leżą ponad pasmem.
  - Kontrola desktop4x na drzewie W1 przy właściwej medianie 1398 daje 885 ms, a nie 950,5.
  - Werdykty się nie zmieniają.
- **S-D2, reżim refetchu postów. Obie strony mają częściowo rację.**
  - Analiza liczyła żądania backendu, więc także te poza oknem nagrania. W oknie Lighthouse (devtoolsLog) jest
    browser A 2/15, B 5/15 i bot A 1/15, B 4/15; w mobile 5 GET w oknie, nie 8.
  - Współwystępowanie z przekroczeniami (a) potwierdzam: 2/3 przebiegów z refetchem wobec 0/7 bez niego (p ≈ 0,067).
  - Refetch nie jest jednak przyczyną. GET-y startują 766 / 751 ms obs., po obs. LCP (187 / 207 ms), czyli poza grafem
    LCP. Ślady pokazują mechanizm opisany w (a): parsowanie nagłówka zaczęło się po zakończeniu arkusza.
- **S-D3, mnożnik MDE(z). Rację ma weryfikacja (sformułowanie).** Poprawny mnożnik to z₀,₉₇₅ + z₀,₈ = 2,8016, a
  harness używa 2,80. Różnica wynosi ≤ 0,1 %.
- **S-D4, agregacja alternatywy (c). Rację ma weryfikacja (sformułowanie).** Wszędzie liczę teraz medianę wyników per
  przebieg; przy m' wynosi ona 89,95 / 89,95.
- **S-D5, projekcja z serii przy m'. Rację ma weryfikacja.** Liczę ją teraz z TBT, FCP i LCP przy m' (SI przy m).
  - Przy m' FCP Lantern browser B-mobile-3 to 1639 ms, a bot B-mobile-4 1670 ms; mediany (a) się nie zmieniają.
  - Na desktop4x przy m' FCP Lantern wynosi w browser 392–592 ms (zmierzone 392–495), a w bot 510–700 ms
    (zmierzone 438–565).
- **S-D6, liniowe k przy małym TBT. Rację ma weryfikacja.** Zastrzeżenie dopisałem w §6.7; F1 pozostaje tylko górną
  granicą.
- **S-D7, drobne. Rację ma weryfikacja.**
  - Bot desktop4x perf: 4 pary dodatnie i 1 zerowa, a nie „mieszane”.
  - benchmarkIndex bot B-desktop4x-3 to 2202,5.
  - Host jest ×1,4–1,7 szybszy tylko wobec median LHR kalibracji; wobec benchmarku atrapy 1616,5 wychodzi ×1,32–1,39.
- **A-1, timer loadera P2.1 zaliczony do „Kmod”. Rację ma weryfikacja.**
  - W bot B-desktop5x-1 i -3 ślad pokazuje `TimerFire` (timerId 4) → `FunctionCall` z dokumentu, linia 201: 300,5 /
    10,1 ms obs. (51 ms sym., blokowanie 1 ms) i 302,8 / 14,5 ms obs. (72 ms sym., 22 ms).
  - Zadań skryptu inline w oknie jest więc 11, nie 9. K4i bot desktop5x wynosi 77,0 ms (4/5), a Kmod 0.
  - Liczby przebiegów (e) się nie zmieniają.
- **A-2, „K7 i K5/K6 wciągnięte do okna” na desktopie. Rację ma weryfikacja.** Na W1 K7 leży w oknie w 5/5 przebiegów
  desktop4x i desktop5x obu ramion. „Wciągnięcie” dotyczy tylko mobile (§6.4).
- **A-3, P3.4 „mobile bez blokowania”. Rację ma weryfikacja.** bot B-mobile-3 ma `ScriptCatchup` 1466 + 137 ms sym.
  z blokowaniem 12 ms (11,9).
- **A-4, K4i jako „inline EvaluateScript”. Obie strony mają rację co do faktów.** K4i to `EventDispatch
DOMContentLoaded` → `FunctionCall Y`, a nie `EvaluateScript`. Szeroki odczyt jest konserwatywny i teraz nazwany
  wprost. Bez niego (e) oblewa na samym ParseHTML: 7/15 i 9/15.
- **A-5, klatki Style z `$RV` i URL-em dokumentu. Rację ma weryfikacja (sformułowanie).** W browser dotyczy to
  desktop4x 5/5 i desktop5x 4/5. Udział skryptu wynosi ≤ 26 %, czyli < 50 ms sym., więc nie liczę tych zadań do (e).
  To klatka stylu, zakres P3.3.

### 6.10 Pliki

- Liczby maszynowo: `raporty/W2-wyniki.json` (z sekcją `arbiter`). Komendy i ważność: `POMIAR.md` §9.
- Dane robocze bramki w `$SCRATCH/phase2/wave2/gate/`:
  - pomiar: `MEASURE.md`, `lh-browser/`, `lh-bot/` (LHR, ślady, devtoolsLogi, księgi, `summary.json`), `lh-*.log`,
    `document-weight-{A,B}.json`;
  - analiza: `ANALIZA.md`, `analiza/`;
  - weryfikacje: `WERYFIKACJA-statystyka.md` + `weryfikacja-stat/` oraz `WERYFIKACJA-atrybucja.md` +
    `weryfikacja-atrybucja/`;
  - rozstrzygnięcia: `arbiter/` (what-if i księga przy m', projekcje, refetch, wyścig arkusza z parserem, korekta
    księgi).
