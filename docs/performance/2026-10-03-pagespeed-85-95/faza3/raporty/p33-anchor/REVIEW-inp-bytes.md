# P3.3 kotwica: recenzja pod kątem kosztu interakcji (INP) i bajtów

- Zmiana: `470e2a52` na `4d1e2791` (worktree `scratchpad/wt3/p33-anchor`, gałąź `fix/w3-p33-anchor`). Recenzja tylko do odczytu: w worktree ani w `base-w3f` nic nie zmieniałem i niczego nie budowałem.
- Własne pomiary leżą w `phase3/p33-anchor/rv-cost/`:
  - `run-all.sh`, `out/{fix,base}-x{4,6}.jsonl`: INP kliku, kopia `cost/anchor-cost.spec.ts`, port 4297;
  - `rv-hash.spec.ts`, `out/hash-*.jsonl`: ścieżka `location.hash`;
  - `summarize.js`.
- Uruchamiałem wszystko przez `heavy-bg.sh`. Serwery zgasły razem z runnerem (port 4297 jest wolny). `git status` obu drzew jest czysty.

## Werdykt: approve, bez uwag blokujących

- Bajty:
  - poprawka nie dodaje ani bajtu do bundla klienta, do chunka wejściowego ani do domknięcia bootu;
  - inline'owy skrypt rośnie o 785 B, a HTML po gzipie o 419 B, wszystko w progach.
- INP: pierwszy klik w kotwicę do obszaru cv płaci jednorazowo za odsłonięcie sekcji.
  - Czysty koszt to styl i układ: ok. 90 ms przy x4 i ok. 230–270 ms przy x6.
  - Względem `4d1e2791` klik drożeje o ok. 270 ms (x4) i ok. 650 ms (x6). Te liczby to mediany z mojej serii, a `4d1e2791` był tani tylko dlatego, że przewijał na pasach z szacunku i trafiał źle.
  - Względem strony sprzed P3.3 klik kosztuje tyle samo plus najwyżej czysty koszt odsłonięcia.
  - Uważam ten koszt za akceptowalny:
    - płaci się go raz na dokument;
    - dotyczy rzadkiej interakcji (kotwica w stronie na długiej stronie buildera);
    - naprawia realną wadę poprawności (cel 1240 px pod widokiem);
    - nie dotyka TBT, LCP ani laboratoryjnego Lighthouse'a.
- Implementer opisuje wynik o odcień za optymistycznie („INP = poziom sprzed P3.3, w szumie"). Korekta wniosku jest w uwadze M1.

## 1. Bajty i bundle (zweryfikowane)

| sprawdzenie                                                         | wynik                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CV_GUARD_SCRIPT` (wyliczony ze źródła)                             | 1026 B surowo i 599 B gzip -9 osobno (było 241 / 214). Przyrost +785 B surowo                                                                                                                                                                                          |
| źródło == build                                                     | build `.output` (06:40) jest nowszy niż ostatnia zmiana `BuilderRenderer.tsx` (06:31). `.output/server/_ssr/router-RphXZ8Nv.mjs` zawiera skrypt identyczny ze źródłem                                                                                                  |
| klient                                                              | md5 wszystkich 901 plików `.js`/`.css` w `.output/public` jest **identyczne** z `base-w3f` (`rv-base-assets.txt` vs `rv-fix-assets.txt`). `data-cv-off` nie występuje w `.output/public`. Chunk wejściowy i domknięcie bootu są bajt w bajt te same                    |
| `document-weight` (r2 vs baza, ten sam skrypt, 5 próbek, min = max) | `htmlRawBytes` +785, `htmlGzipBytes` +419, `inlineScriptBytes` +785, `inlineExecutableScriptBytes` +785, `preLcpTransferBytes` +419. Każda inna metryka ma Δ 0, w tym `bootClosureRaw/GzipBytes`, `bootBurstGzipBytes` i `inlineCssCommentBytes` (517, bez nowego CSS) |
| zapasy po zmianie                                                   | `inlineScriptBytes` 9 767 B, `inlineExecutableScriptBytes` 10 636 B, `htmlGzipBytes` 7 451 B, `preLcpTransferBytes` 6 160 B, `bootClosureGzipBytes` 1 525 B (bez zmian). Progi nie zostały podniesione                                                                 |
| parzystość SSR/hydratacji                                           | Klient nadal renderuje `CvBlock` z pustym `__html`, a dla skryptu w tym węźle nic się nie zmienia                                                                                                                                                                      |

Blok cv stoi przed pierwszą sekcją, więc +419 B gzip trafia na ścieżkę przed LCP. Na wolnym 4G to ok. 2 ms transferu, czyli pomijalnie. Przesuwanie bloku za kandydata LCP nie jest warte ryzyka zmiany kształtu drzewa.

## 2. INP kliku w `#id` (telefon 412x823, mediana z 5, klik po 2,5 s spoczynku)

Wariant `base` to `/#__ax_none`: strażnik zdejmuje cv przy parsowaniu, więc strona zachowuje się jak przed P3.3. Wariant `sync` to samo `setAttribute("data-cv-off")` + wymuszony układ, bez kliku, czyli czysty koszt odsłonięcia.

| seria (moja)             |            INP (zakres) | processing | presentation | układ w oknie kliku | najdłuższe zadanie |
| ------------------------ | ----------------------: | ---------: | -----------: | ------------------: | -----------------: |
| x4 `4d1e2791` cur        |           648 (520–680) |        198 |          338 |                 120 |                635 |
| x4 poprawka cur          |          920 (880–1696) |        451 |          495 |                  91 |                603 |
| x4 poprawka, sprzed P3.3 |         1040 (824–1384) |        404 |          527 |                  10 |                599 |
| x4 sync, poprawka / baza |   89 / 90 ms styl+układ |            |              |                     |                    |
| x6 `4d1e2791` cur        |        1104 (1016–1200) |        493 |          583 |                   9 |                598 |
| x6 poprawka cur          |        1760 (1376–2024) |        856 |          855 |                 162 |                921 |
| x6 poprawka, sprzed P3.3 |        1264 (1216–1944) |        547 |          710 |                   8 |                823 |
| x6 sync, poprawka / baza | 231 / 271 ms styl+układ |            |              |                     |                    |

Liczby implementera (`cost/out/*.jsonl`) przeliczyłem ponownie i zgadzają się z tabelą w IMPL.md. Różnice w parach „poprawka minus sprzed P3.3":

|     | serie implementera | moja seria |     średnio |
| --- | ------------------ | ---------: | ----------: |
| x4  | +8, +24, +168      |       −120 |  ok. +20 ms |
| x6  | −8, +104, +304     |       +496 | ok. +220 ms |

Średnia przy x6 pokrywa się z czystym kosztem odsłonięcia. To odpowiada modelowi fizycznemu: strona sprzed P3.3 płaciła za układ sekcji przy wczytaniu, a poprawka płaci za niego w zadaniu kliku.

**Ścieżka `location.hash`** (`rv-hash.spec.ts`, czas synchroniczny przypisania, n=10):

| przypadek                                  |     x4 |     x6 |
| ------------------------------------------ | -----: | -----: |
| strażnik                                   | 180 ms | 335 ms |
| wyłącznik ustawiony tuż przed przypisaniem | 160 ms | 328 ms |
| `4d1e2791` (przewinięcie na pasach)        |  60 ms | 146 ms |

- Odczyt `getBoundingClientRect()` celu przy włączonym cv w `g` kosztuje więc +8 do +21 ms, w szumie.
- Do następnej klatki: x4 649 → 945 ms, x6 929 → 1655 ms. Ta różnica to głównie pełny render TanStacka na zmianę `#` (`router.load` + render), który przy wyłączonym cv musi wystylować całą stronę.
- Wszystkie przebiegi poprawki kończą się na y=5080 (cel pod nagłówkiem).

## 3. Uwagi

**M1 (minor) - wniosek o INP w IMPL.md i w komunikacie commita.**

- Obecne sformułowanie: „INP pierwszego kliku = poziom sprzed P3.3 (różnica w szumie)".
- Lepiej opisać to jako „poziom sprzed P3.3 plus co najwyżej jednorazowy styl i układ odsłonięcia".
- Odsłonięcie mierzone tutaj kosztuje ok. 90 ms przy x4 i 230–270 ms przy x6. Wartości z REPRO (78 i 182 ms) są zaniżone.
- Względem `4d1e2791` daje to +270 do +650 ms na tym jednym kliku.
- Werdykt się nie zmienia, ale liczba powinna być uczciwa na wypadek, gdy INP z pola wzrośnie na stronach z kotwicami.
- Opcja na przyszłość, nie warunek: wyprowadzić odsłonięcie z klatki interakcji. Klik zostawiłby wtedy tylko wyłącznik i przewinięcie byłoby odłożone o klatkę. Zmienia to jednak semantykę nawigacji, więc w tej poprawce bym tego nie robił.

**N1 (nit) - klik w linki routera do `/#id` na tej samej stronie też wyłącza cv.**

- Dotyczy `AppLink` i `<Link hash>`.
- Router z `defaultHashScrollIntoView: false` w ogóle wtedy nie przewija, więc koszt 90–270 ms jest bez zysku.
- Na stronach publicznych zdarza się to rzadko, a wadą jest sam router (pozycja poza P3.3, opisana w IMPL §6). Do odnotowania, bez zmian.

**N2 (nit) - rozmiar strażnika.**

- 1026 B mieści się w progach. Można zejść o ok. 60–80 B:
  - nasłuch `hashchange` jest w praktyce zbędny, bo Chromium, Gecko i WebKit wysyłają `popstate` przy nawigacji do fragmentu;
  - `area[href]` dotyczy tylko map obrazów, których buildery nie generują.
- Nie wymagam tego. Siatka bezpieczeństwa jest tania, a zapas inline'owego skryptu to 9,8 KB.

**N3 (nit) - czas e2e.**

- Spec cv urósł z 11 do 21 testów, a jeden przebieg trwa ok. 2,2 min zamiast ok. 1 min.
- Najdłuższy test (wstecz/dalej, x6) trwa 46,5 s przy limicie 120 s, więc zapas wynosi 2,6x. Wolniejszy runner CI (1,5–2x) się w nim mieści, ale warto to obserwować przy kolejnych testach z dławieniem.

**Bez uwag:**

- Nasłuch `click` w fazie przechwytywania na każdym kliku robi tylko `closest` i porównanie stringów, czyli mikrosekundy.
- `f()` robi `querySelector("[data-cv]")` tylko dla linków do tego samego dokumentu i przy `popstate`/`hashchange`.
- Po nawigacji SPA nie ma opakowań `[data-cv]` (render kliencki nie dostaje cv), więc strażnik nic nie robi.
- Raz wyłączone cv nie wraca. Każdy kolejny klik w kotwicę kosztuje tyle co przed P3.3.
- Cele przed obszarem cv (link „przejdź do treści", sekcje z `advanced.htmlId`) nic nie kosztują.
