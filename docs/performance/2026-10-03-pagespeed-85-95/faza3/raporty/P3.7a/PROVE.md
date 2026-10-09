# P3.7a (fala 3): PROVE

Data: 2026-10-09. A = `base-w3b` (63a05a32, kod aplikacji = 56da8d23, `.output` z bazy, bez przebudowy).
B = worktree `wt3/P3.7a` (gałąź `perf/w3-P3.7a`, commit `186279bc`), zbudowany tu przez
`BUNDLE_INVENTORY=1 bun run build:smoke` pod mutexem (exit 0, 1 min 52 s).
`$P` = `$SCRATCH/phase3/wave3/P3.7a`. Wszystkie logi i surowe pliki leżą w `$P`.

## 0. Werdykt

- **Bajty: zgodne z planem co do bajta.** Domknięcie bootu −4 920 B raw / −1 414 B gz (plan: ok. −4,9 KB / −1,28 KB),
  `htmlRawBytes` −13 483 B (prognoza IMPL −13 483 B), `headRawBytes` −2 966 B, `inlineStyleBytes` −13 483 B.
  Ulga dla P3.3 jest: zapas `bootClosureRawBytes` 812 B → **5 732 B**, `bootClosureGzipBytes` 638 B → **2 052 B**,
  `bootBurstGzipBytes` 611 B → **3 408 B**.
- **Wyrocznia S1: zielona** (implementera i moja, niezależna). Komentarzy CSS w czterech oznaczonych blokach jest 0 B.
  `inlineCssCommentBytes` = 517 B pochodzi WYŁĄCZNIE z `data-content-area` (S1g wyłączony decyzją orkiestratora).
- **S3 (pasek panelu): wygląd identyczny.** Arkusz panelu z artefaktu B = arkusz A + dokładnie 15 reguł (po scaleniu
  lightningcss) usuniętych z mostu. Kolejność reszty reguł bez zmian. Zrzuty A/B są pikselowo identyczne
  (6 stylów × jasny/ciemny × kolory domyślne/własne, spoczynek i hover).
- **Bramki: wszystkie zielone.** `check:bundle` (overall −5,2 KB, `publicCss` bez zmian, bo `styles.css` jest bajtowo
  identyczny), `check:chunks`, `check:entry-purity`, `check:server-entry-purity`, `check:dangerous-html`,
  `check:document-weight` (A i B), `test:e2e:artifact` 12/12, vitest pozycji 124/124.
- **Lighthouse:** CLS 0 i brak regresji TBT. Na mobile FCP spada o −0,18 s (σΔ 0,039 s, MDE(t) 0,065 s), czyli
  istotnie i więcej niż „±0,02 s” z planu. Kierunek jest dobry. Wielkość wynika ze skoku w modelu TCP Lanterna:
  dokument fixture schodzi poniżej 43 800 B transferu, więc w symulacji kosztuje 2 rundy RTT zamiast 3 (§5.3).
  To nie jest zysk z samego parsowania. Porcje ParseHTML w śladzie maleją (mobile −4,0 ms sumy, desktop −0,7 ms),
  ale mieszczą się w szumie.
- `effect_matches_plan` = **yes** dla struktury i bajtów. Dla rozmiaru efektu czasowego: **inconclusive**, bo
  ParseHTML jest w szumie, a FCP to artefakt progu TCP. `needs_fix` = **nie**.

## 1. Bramki artefaktu

| Bramka                                                                                                                                      | Wynik       | Uwagi                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build:smoke` (BUNDLE_INVENTORY=1)                                                                                                          | zielona     | 0 ostrzeżeń `nes:static-css` (wtyczka nie odmówiła i nie ostrzegła). Jedyne ostrzeżenia to stare `inputValidator()` TanStacka i rozmiar chunków (`build.log`)                                            |
| `check:bundle`                                                                                                                              | zielona     | szczegóły w §2 (`check-bundle.log`, baza: `check-bundle-base.log`)                                                                                                                                       |
| `check:chunks`                                                                                                                              | zielona     | 893 chunki, 6 845 krawędzi, graf acykliczny                                                                                                                                                              |
| `check:entry-purity`                                                                                                                        | zielona     | `lib/builder/globalColors` dalej na liście ciężkich modułów (poza wejściem)                                                                                                                              |
| `check:server-entry-purity`                                                                                                                 | zielona     | 1 813 plików, zamrożony dług bez zmian                                                                                                                                                                   |
| `check:dangerous-html`                                                                                                                      | zielona     | 78 sinków, bez nowych                                                                                                                                                                                    |
| `check:document-weight` B                                                                                                                   | zielona     | `document-weight.json`; nowa metryka `inlineCssCommentBytes` 517/517                                                                                                                                     |
| `check:document-weight` A (baza)                                                                                                            | zielona     | `document-weight-base.json` (skrypt bazy nie zna nowej metryki)                                                                                                                                          |
| `test:e2e:artifact` (env CI, `NES_ARTIFACT_FIXTURE=1`)                                                                                      | **12/12**   | zero błędów hydratacji. Jedyny `[hydration-mismatch]` w logu pochodzi z kontroli negatywnej (test 5, oczekiwany). Pozycja nie dodała specyfikacji e2e                                                    |
| vitest pozycji (5 plików: minifyStaticCss, staticCssPlugin z prawdziwym buildem Vite, sidebarRulesAdminOnly, globalColors, viteChunkParity) | **124/124** | `vitest-prove.log`                                                                                                                                                                                       |
| Scalalność (`git merge-tree`, tylko odczyt)                                                                                                 | czysta      | z PR `claude/zen-ritchie-hzur21` (po partii 2: legal-links, chat-toasts w `vite*.config.ts`) i z `perf/w3-P3.8`. P3.8 nie dodaje komentarzy do `ContentAreaStyle.tsx`, więc próg 517 B wytrzyma scalenie |

Bramek procesowych usuniętych w PR #475 nie uruchamiałem (nie ma ich w `package.json`).

## 2. `check:bundle` A → B

| Pozycja                    |                     A (baza) |                        B (P3.7a) |                                            Δ |                            Budżet |
| -------------------------- | ---------------------------: | -------------------------------: | -------------------------------------------: | --------------------------------: |
| Client JS overall (gz)     |                   4 754,4 KB |                   **4 749,2 KB** |                                      −5,2 KB |    ≤ 4 772 (zapas 17,6 → 22,8 KB) |
| public JS                  |                   2 804,0 KB |                       2 799,4 KB |                                      −4,6 KB |                           ≤ 2 877 |
| admin-only JS              |                   1 950,4 KB |                       1 949,9 KB |                                      −0,5 KB |                       (w overall) |
| Largest chunk (wejście)    |  262,2 KB (`index-c_XR_U82`) |      260,8 KB (`index-DKkSamIk`) |                                      −1,4 KB |                             ≤ 286 |
| Client CSS (suma, 4 pliki) |                      95,0 KB |                      **95,4 KB** |                                      +0,4 KB | ≤ 96 (zapas **1,0 → 0,6 KB**, L2) |
| public CSS                 |                      81,2 KB |                          81,2 KB | 0 (`styles-BhxeJUg-.css` bajtowo identyczny) |                              ≤ 83 |
| **Boot closure**           | 487,8 KB gz / 1 598,6 KB raw | **486,5 KB gz / 1 593,8 KB raw** |                               −1,3 / −4,8 KB |                             ≤ 579 |

Linia `Boot closure` w B: `Boot closure: 486.5 KB gzip / 1593.8 KB raw  (10 chunków statycznie osiągalnych ze SSR-owego <script>; budget ≤ 579 KB)`.
Lista ruchów względem baseline'u b006c2e jest w B identyczna jak w A, a P3.7a nie dodaje nowych ruchów powyżej progu
raportu. Ostrzeżenia o zapasie poniżej 2%: overall 22,8 KB (0,48%), **css total 0,6 KB (0,61%)**.

L2: arkusz panelu rośnie o +3 581 B raw i +416 B gz (gzip −9: 13 950 → 14 366 B). P3.2b (+~250 B gz w `styles.css`)
zostawi w sumie `css` ok. 0,35 KB zapasu.

Chunki dotknięte przez S1 (gzip −9):

| Chunk                                  |        A raw / gz |        B raw / gz |          Δ raw / gz |
| -------------------------------------- | ----------------: | ----------------: | ------------------: |
| wejście `index-*` (boot, `TICKER_CSS`) | 863 586 / 264 938 | 858 666 / 263 705 | **−4 920 / −1 233** |
| `sliderVariants-*`                     |   41 261 / 11 312 |    38 295 / 9 993 |     −2 966 / −1 319 |
| `designTokensCss-*` (most, dynamiczny) |    36 261 / 6 890 |    30 378 / 5 646 |     −5 883 / −1 244 |
| `SearchButtonWidget-*`                 |    22 231 / 7 088 |    21 960 / 7 054 |          −271 / −34 |
| `admin-styles-*.css` (S3)              |   87 664 / 13 950 |   91 245 / 14 366 |       +3 581 / +416 |

## 3. `check:document-weight` A → B (fixture `/`, 5 próbek HIT, wszystkie bajtowo stałe)

| Metryka                            |                                        A |               B |          Δ | Próg (max) |     Zapas A → B |               ceil(B × 1,02) |
| ---------------------------------- | ---------------------------------------: | --------------: | ---------: | ---------: | --------------: | ---------------------------: |
| htmlRawBytes                       |                                  337 696 |     **324 213** |    −13 483 |    406 180 | 68 484 → 81 967 |                      330 698 |
| htmlGzipBytes                      |                                   52 546 |          48 927 |     −3 619 |     57 710 |   5 164 → 8 783 |                       49 906 |
| headRawBytes                       |                                   28 758 |      **25 792** |     −2 966 |     29 345 |     587 → 3 553 |                       26 308 |
| inlineStyleBytes                   |                                   84 717 |          71 234 |    −13 483 |    135 546 |        → 64 312 |                       72 659 |
| inlineStyleLargestBytes            |                                   26 732 |          21 406 |     −5 326 |          - |               - |                            - |
| inlineStyleCount                   |                                       25 |              25 |          0 |         50 |               - |                            - |
| **inlineCssCommentBytes** (nowa)   | 5 348 (zmierzone skryptem B na HTML-u A) |         **517** |     −4 831 |        517 |               0 |                            - |
| inlineScriptBytes / wykonywalne    |                          86 617 / 79 373 | 86 617 / 79 373 |          0 |          - |               - |                            - |
| dehydratedStateBytes               |                                   60 357 |          60 357 |          0 |     66 486 |               - |                            - |
| modulepreloadCount                 |                                        0 |               0 |          0 |          0 |               - |                            - |
| preloadDuplicates / w dokumencie   |                                    3 / 0 |           3 / 0 |          0 |      3 / 0 |               - |                            - |
| imgFetchpriorityHigh               |                                        1 |               1 |          0 |          2 |               - |                            - |
| JS z priorytetem High przy starcie |                                      0 B |             0 B |          0 |          - |               - |                            - |
| **bootClosureRawBytes**            |                                1 636 946 |   **1 632 026** | **−4 920** |  1 637 758 | **812 → 5 732** | (nie obniżać: ulga dla P3.3) |
| **bootClosureGzipBytes**           |                                  496 041 |     **494 627** | **−1 414** |    496 679 | **638 → 2 052** |                        (jw.) |
| bootBurstGzipBytes                 |                                  574 062 |         571 265 |     −2 797 |    574 673 |     611 → 3 408 |                        (jw.) |
| preLcpTransferBytes                |                                  177 704 |         174 085 |     −3 619 |    181 594 |   3 890 → 7 509 |                      177 567 |
| renderBlockingCssGzipBytes         |                                   80 426 |          80 426 |          0 |     81 399 |               - |                            - |
| elementCount                       |                                    1 224 |           1 221 |         −3 |          - |               - |                            - |

- `elementCount` −3 to artefakt licznika. Komentarze CSS w A zawierały tekst `<variant`, `<header`, `<a`.
  Znaczniki poza `<style>` są w A i B identyczne (tagi 1:1). Różnią się tylko hashe chunków, port i znaczniki czasu.
- Komentarze CSS per blok (A → B): slider 2 130 → 0, most marki 1 511 → 0, pasek trendów 1 190 → 0,
  `data-content-area` 517 → 517 (S1g poza zakresem).
- **Proponowany ratchet (orkiestrator):** `htmlRawBytes` 330 698, `htmlGzipBytes` 49 906, `headRawBytes` 26 308,
  `inlineStyleBytes` 72 659, `preLcpTransferBytes` 177 567 (= ceil(B × 1,02)). Progów `bootClosure*` i
  `bootBurstGzipBytes` celowo NIE obniżać, bo ta ulga ma przyjąć P3.3. `inlineCssCommentBytes` zostaje na 517
  (cel 0 po S1g). Duplikaty, modulepreload i imgFetchpriorityHigh są bez zmian.

## 4. Wyrocznia S1 i kaskada S3

### 4.1 Wyrocznia S1 (HTML artefaktu B, `/` i `/en`)

- Skrypt implementera `tools/oracle-s1.ts` (`oracle-B.log`) daje **exit 0**. Dla 4/4 bloków na obu dokumentach
  jednocześnie: HTML = bajtowo wynik `minifyStaticCss` literału oraz lightningcss(HTML) = lightningcss(źródło).
  Rozmiary HTML/źródło: ticker 10 332/15 217 B, slider 8 218/11 146 B, most 13 740/15 903 B, wyszukiwarka 2 225/2 496 B.
  Kontrola negatywna na HTML-u bazy daje exit 1 (`oracle-A-neg.log`).
- Moja niezależna wyrocznia (`prove-tools/pair-styles.cjs`, `bridge-diff2.cjs`) bierze parami 25 bloków `<style>` z
  HTML-u A i B. 20 bloków jest bajtowo identycznych. Slider, ticker i wyszukiwarka są różne bajtowo, ale
  lightningcss(minify) A == B. Most marki: po spłaszczeniu (z warstwami) A ma 82 reguły, B 67. Wszystkie 15 reguł
  „tylko w A” zawierają `data-sidebar` (12 bez warstwy, 3 w `@layer utilities`), w B nie ma reguł spoza A, a
  kolejność wspólnych reguł jest identyczna. Ten sam wynik daje `/en`.

### 4.2 S3: arkusz panelu z artefaktu (L14)

- `prove-tools/admin-diff.cjs`: arkusz A ma 997 reguł, B 1 012. Tylko w A: 0. Tylko w B: 15, wszystkie z
  `data-sidebar`, i **to 1:1 te same 15 reguł, które zniknęły z mostu**. Wspólne reguły stoją w tej samej kolejności.
- Pozycja: 3 reguły fontów są w `@layer utilities` na końcu warstwy (indeksy 777–779). 12 reguł kolorów jest bez
  warstwy na indeksach 950–961, za ostatnią regułą `[data-sidebar-style]` (938). Za nimi są wyłącznie `@property`
  i `@keyframes`. Wygrana nad regułami stylu przy równej specyficzności jest więc zachowana.
- Sonda Chromium na arkuszach Z ARTEFAKTÓW (`prove-probe/`, `probe-prove.log`; `styles.css` A = B bajtowo):
  zrzuty **pikselowo identyczne** w spoczynku 4/4 i przy hoverze 336/336, dla 6 stylów × jasny/ciemny × kolory
  domyślne/własne `--gc-sidebar-*` (`prove-probe/shots/`). Porównano 4 167 432 wartości `getComputedStyle`.
  Jest 144 różnic jednego rodzaju: `background-position "0% 0%" → "0px 0px"` na marce i przełączniku. Przyczyna:
  lightningcss minifikuje `background: transparent !important` do `background: 0 0 !important`. Bez obrazu tła nie
  ma to skutku wizualnego (zrzuty identyczne), a ten sam potok przetwarza cały arkusz panelu. Ograniczenie: sonda
  odtwarza DOM paska z `AdminShell` na stronie testowej, a nie zalogowany `/admin` (artefakt fixture nie ma sesji panelu).

## 5. Lighthouse `--compare` (fixture, fake-gtag, `--warm-ua bot`, n = 5 na formę)

Log: `ab.log`, wyniki `lh/`. VALID: A mobile 5/5, B mobile 5/5, A desktop4x 5/5, B desktop4x 5/5. Wykluczeń 0.
Jeden przebieg A mobile-5 powtórzono po błędzie `NO_NAVSTART`. Load w trakcie przebiegów wynosił 0,9–2,1 (limit 2,4).
Dokument: A 330 641 B, B 317 158 B, wariant `s-maxage=900`, tryb FCP bez JS we wszystkich parach.

### 5.1 Mediany i pary

| Forma     | Strona    |       perf |         FCP |     LCP |              TBT |      SI | CLS |    TTI | mainThread |   bootup | req | transfer |
| --------- | --------- | ---------: | ----------: | ------: | ---------------: | ------: | --: | -----: | ---------: | -------: | --: | -------: |
| mobile    | A         | 96 (95–98) |      1,61 s |  2,42 s |  114 ms (52–154) |  1,67 s |   0 | 5,36 s |   3 003 ms | 1 378 ms |  72 | 915,2 KB |
| mobile    | B         | 98 (95–99) |      1,39 s |  2,15 s |   78 ms (39–224) |  1,60 s |   0 | 5,30 s |   2 917 ms | 1 311 ms |  70 | 908,7 KB |
| mobile    | **Δ med** |         +2 | **−0,22 s** | −0,27 s |           −36 ms | −0,07 s |  ±0 |        |     −86 ms |   −66 ms |  −2 |  −6,5 KB |
| desktop4x | A         | 92 (87–93) |      0,44 s |  0,55 s | 231 ms (217–317) |  0,62 s |   0 | 1,41 s |   3 150 ms | 1 605 ms |  75 | 920,3 KB |
| desktop4x | B         | 92 (80–95) |      0,41 s |  0,51 s | 233 ms (184–473) |  0,61 s |   0 | 1,24 s |   3 132 ms | 1 461 ms |  75 | 914,3 KB |
| desktop4x | **Δ med** |         ±0 |     −0,03 s | −0,04 s |            +2 ms | −0,01 s |  ±0 |        |     −18 ms |  −144 ms |   0 |  −6,0 KB |

| Pary (n = 5, t(4) = 3,72) |        Δ |      σΔ |  MDE(t) | ocena                                                 |
| ------------------------- | -------: | ------: | ------: | ----------------------------------------------------- |
| mobile FCP                | −0,180 s | 0,039 s | 0,065 s | istotne (każde B < każde A: 1,37–1,46 vs 1,53–1,62 s) |
| mobile LCP                | −0,185 s | 0,114 s | 0,189 s | na granicy MDE                                        |
| mobile TBT                |    −6 ms |  110 ms |  183 ms | szum, brak regresji                                   |
| mobile SI                 | −0,040 s | 0,143 s | 0,238 s | szum                                                  |
| mobile score              |     +1,2 |     2,2 |     3,6 | szum                                                  |
| desktop4x FCP             | −0,055 s | 0,092 s | 0,154 s | szum                                                  |
| desktop4x LCP             | −0,055 s | 0,027 s | 0,045 s | istotne (mało)                                        |
| desktop4x TBT             |   +38 ms |  131 ms |  218 ms | szum, brak regresji (wartość odstająca B-2: 473 ms)   |
| desktop4x SI              | −0,035 s | 0,108 s | 0,180 s | szum                                                  |

Liczba żądań na mobile różni się o −2 tylko w medianie. W pojedynczych przebiegach obie strony mają 70–81 żądań
(zmienność leniwych chunków), czyli to nie jest efekt zmiany.

### 5.2 Porcje ParseHTML (ślad, główny wątek, dokument fixture) i rozbicie wątku

| Forma     | Strona | porcji ParseHTML (med) | suma ParseHTML (med) | najdłuższa porcja (med) | LH „Parse HTML & CSS” | LH „Style & Layout” |
| --------- | ------ | ---------------------: | -------------------: | ----------------------: | --------------------: | ------------------: |
| mobile    | A      |                     15 |              41,1 ms |                 17,8 ms |              112,7 ms |            394,8 ms |
| mobile    | B      |                     16 |          **37,1 ms** |             **15,4 ms** |              114,8 ms |            388,4 ms |
| desktop4x | A      |                     14 |              34,0 ms |                 10,6 ms |              111,0 ms |            396,7 ms |
| desktop4x | B      |                     15 |          **33,3 ms** |             **10,3 ms** |              114,1 ms |            375,8 ms |

Suma i najdłuższa porcja ParseHTML maleją na obu formach, ale wielkość mieści się w rozrzucie przebiegów
(A mobile 33–46 ms, B 30–42 ms). Grupa LH „Parse HTML & CSS” jest zdominowana przez arkusz 542 KB (bez zmian) i nie
pokazuje różnicy. Arkusze inline nie mają osobnych zdarzeń `ParseAuthorStyleSheet`, bo parsują się wewnątrz ParseHTML.
Ledger Lanterna nie ma osobnej klasy „ParseHTML” ≥ 50 ms. Zadanie `Navigation` (pierwsza porcja dokumentu) ma
mediany sim: mobile A 139 / B 141 ms, desktop A 132 / B 107 ms, czyli szum. Nie było docelowej klasy zadań, która
mogłaby zniknąć: S1 skraca tekst do parsowania, ale nie usuwa zadania.

Speedline (obsSI, prawdziwy filmstrip): mobile A med 297 ms (279–316) / B 278 ms (255–321), desktop4x A 315 ms /
B 337 ms. To szum: pozycja nie zmienia ruchu ani pierwszej klatki.

### 5.3 Skąd −0,18 s FCP na mobile (model, nie parsowanie)

Lantern (`TCPConnection.simulateDownloadUntil`, LH 13.5) wysyła pierwsze okno 10 × 1 460 = 14 600 B razem z TTFB, a
potem okna podwajane do limitu przepustowości (mobile 1,6 Mb/s × 150 ms ≈ 21 segmentów). Po 2 rundach dokument ma
14 600 + 29 200 = **43 800 B**. Transfer dokumentu: A 44 966–45 026 B (3 rundy), B 41 508–41 542 B (2 rundy). Na
mobile oszczędza to jedno RTT = 150 ms. Do tego dochodzi ok. 17 ms przepustowości (3,46 KB) i mniej CPU parsowania
(×4). Razem daje to zmierzone −0,18 do −0,22 s. Na desktopie ten sam próg kosztuje 40 ms RTT, a zmierzono
−0,03 do −0,055 s. Wniosek: na fixture zysk FCP/LCP jest realny w modelu, ale to skok progowy wynikający z rozmiaru
dokumentu fixture, a nie liniowy efekt S1. Na produkcji próg zależy od rozmiaru danej strony. Dokument `d2.html`
(gzip 75 959 → ok. 72 151 B wg IMPL) przekracza w tym modelu granicę 3 rund (74 460 B), więc może zyskać jedno RTT.
To hipoteza do sprawdzenia po wdrożeniu (Lighthouse z kontenera), nie do zapisania jako zysk.

### 5.4 Audyty jednego przebiegu mobile na stronę (`A-mobile-1.audits.txt`, `B-mobile-1.audits.txt`)

|                                                       | A-mobile-1                                   | B-mobile-1                  |
| ----------------------------------------------------- | -------------------------------------------- | --------------------------- |
| żądania / transfer                                    | 70 / 914,6 KB                                | 70 / 908,7 KB               |
| dokument (transfer)                                   | 44 966 B                                     | 41 542 B                    |
| element LCP                                           | `img.eh-img` (`fixture.invalid/cover.jpg`)   | ten sam                     |
| LCP: TTFB / opóźnienie ładowania / ładowanie / render | 26 / 27 / 17 / 173 ms (obs.)                 | 22 / 44 / 7 / 187 ms (obs.) |
| render-blocking                                       | `styles-BhxeJUg-.css` 68,5 KB, wasted 461 ms | ten sam plik, 459 ms        |
| High przed obrazem LCP                                | 112,4 KB                                     | 112,4 KB                    |
| CLS                                                   | 0,000                                        | 0,000                       |

## 6. Ocena wobec kryteriów dowodu (orkiestrator, KRYTYKA §6, PLAN-FALI-3 §3a)

| Kryterium                                                            | Wynik                                                                                                                                                                |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| bootClosureRawBytes ok. −4,9 KB                                      | **−4 920 B** ✔                                                                                                                                                       |
| bootClosureGzipBytes ok. −1,28 KB                                    | **−1 414 B** ✔ (lepiej niż plan)                                                                                                                                     |
| htmlRawBytes w dół                                                   | **−13 483 B** ✔                                                                                                                                                      |
| inlineCssCommentBytes = 0 na artefakcie                              | 0 B w 4 oznaczonych blokach ✔. Metryka całego dokumentu = 517 B z `data-content-area` (S1g wyłączony decyzją orkiestratora, próg 517)                                |
| wyrocznia S1 (lightningcss, równość bajtowa)                         | ✔ exit 0 na `/` i `/en`, plus niezależne parowanie bloków A/B                                                                                                        |
| check:bundle: overall w dół, publicCss bez zmian, suma css w limicie | ✔ −5,2 KB; 81,2 = 81,2 KB; 95,4/96 KB (zapas 0,6 KB)                                                                                                                 |
| check:chunks, check:entry-purity, check:dangerous-html               | ✔                                                                                                                                                                    |
| e2e artefaktu, zero błędów hydratacji                                | ✔ 12/12                                                                                                                                                              |
| sonda wizualna admina: 5 stylów × jasny/ciemny przed/po              | ✔ 6 stylów × 2 motywy × 2 zestawy kolorów, pikselowo identyczne (strona testowa z DOM-em `AdminShell`, arkusze z artefaktów)                                         |
| Lighthouse: porcje ParseHTML w dół                                   | ✔ kierunek (suma −4,0 / −0,7 ms, najdłuższa porcja −2,4 / −0,3 ms), wielkość w szumie                                                                                |
| FCP/LCP ±0,02 s                                                      | mobile FCP −0,18 s i LCP −0,19 s, desktop −0,03 do −0,055 s. Lepiej niż zakładano, poza „±”, ale w dobrą stronę. Przyczyna to próg TCP Lanterna (§5.3), bez regresji |
| CLS ≤ 0,001                                                          | ✔ 0,000 we wszystkich 20 przebiegach                                                                                                                                 |
| TBT bez regresji                                                     | ✔ mobile −6 ms (σΔ 110), desktop +38 ms (σΔ 131, MDE 218), w szumie                                                                                                  |

## 7. Ryzyka i uwagi dla orkiestratora

1. **Suma `css` w `check:bundle`: zapas 0,6 KB.** Kolejny wzrost arkuszy (P3.2b +~250 B) zostawi ok. 0,35 KB.
2. **`inlineCssCommentBytes` ma próg 517 B bez zapasu.** Każdy nowy komentarz w szablonie `ContentAreaStyle.tsx`
   zapali bramkę. Sprawdziłem: P3.8 go nie dodaje, a scalenie jest czyste.
3. Ulgę bootu (5 732 B raw / 2 052 B gz zapasu) zostawić dla P3.3, bez ratchetu `bootClosure*`.
4. Pomiar produkcyjny po wdrożeniu: sprawdzić, czy `d2.html` przechodzi próg 3 rund TCP w Lighthouse z kontenera (§5.3).

## 8. Pliki

- Logi: `$P/build.log`, `check-bundle.log`, `check-bundle-base.log`, `check:chunks.log`, `check:entry-purity.log`,
  `check:server-entry-purity.log`, `check:dangerous-html.log`, `docweight.log`, `docweight-base.log`,
  `e2e-artifact.log`, `vitest-prove.log`, `oracle-B.log`, `oracle-A-neg.log`, `pair-styles-home.log`,
  `pair-styles-_en.log`, `probe-prove.log`, `ab.log`.
- Dane: `document-weight.json`, `document-weight-base.json`, `html/{A,B}-{home,_en}.html`, `lh/` (ślady, ledgery,
  audyty), `prove-probe/shots/`.
- Narzędzia PROVE: `prove-tools/` (`dump-html.ts`, `pair-styles.cjs`, `bridge-diff2.cjs`, `admin-diff.cjs`,
  `admin-tail.cjs`, `parsehtml.cjs`).
