# Weryfikacja bramki fali 2: statystyka i ważność (2026-10-06)

Sprawdzane: `$G/ANALIZA.md` i `$G/W2-wyniki.json` (tych plików nie edytowałem). Liczyłem wszystko od nowa z surowych
danych w `$G/lh-browser/` i `$G/lh-bot/`, bez korzystania z `analiza/results.json` ani `analiza/scan.json`. Wejścia:
LHR `X-forma-n.json`, `summary.json`, `*.ledger.txt`, `*.artifacts/{devtoolslog,trace}.json`.
Nowego pomiaru Lighthouse nie było, a drzew A i B nie przebudowywałem.

`$S` = `/tmp/claude-0/-home-user-neweustrategies-dc633fb5/57088803-e7ea-5e89-8c05-954276daf4ba/scratchpad`,
`$G` = `$S/phase2/wave2/gate`, `$V` = `$G/weryfikacja-stat` (moje skrypty i wyniki).

## Werdykt weryfikacji

**Werdykt bramki („niezaliczona” w obu ramionach) się potwierdza.** Każde kryterium sprawdziłem przebieg po przebiegu
i żadna rozbieżność nie zmienia werdyktu kryterium, bramki ani DoD:

- (a) zaliczone tylko na medianach,
- (b) zaliczone,
- (c) zaliczone na zmierzonym hoście,
- (d) niezaliczone,
- (e) niezaliczone,
- (f) zaliczone,
- (g) niezaliczone.

**Jedna rozbieżność liczbowa jest istotna: normalizacja hosta (§5 i F1h w §7) używa niespójnego punktu odniesienia.**
Po jej poprawieniu prognoza PSI mobile spada o 0,9–1,5 pkt. Zmienia się też zdanie DoD „przy m' w paśmie” na
„ponad pasmem” (szczegóły w D1).

## Metoda (moje skrypty, `light.sh`)

| skrypt                                                                        | co liczy                                                                                                                                                                                                         | wynik                                                                                     |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `$V/recompute.py`                                                             | metryki z każdego LHR (60 + 60): perf, FCP, LCP, TBT, SI, TTI, CLS, `observed*`, `layout-shifts`, benchmarkIndex. Do tego mediany, pary B−A, Δ̄, σΔ (próbkowe), MDE(t) = 3,717·σΔ/√5, MDE(z), t (df 4) i znak par | `$V/runs-recomputed.json`, `$V/recompute.out`                                             |
| `$V/compare_json.py`                                                          | porównanie z `W2-wyniki.json` (`series.*.forms.*.runs/medians/pairs`)                                                                                                                                            | **0 rozbieżności** (13 pól × 60 przebiegów na ramię, mediany, 9 metryk par × 6 form)      |
| `$V/validity.py`                                                              | `summary.json` (validity, attempt, load, warianty, tryby FCP, restore). Reżim refetchu policzony niezależnie z devtoolsLog                                                                                       | –                                                                                         |
| `lanternTasks.ts --min 0 --json` (uruchomiony przeze mnie, kopia z `gate-w2`) | nowe księgi                                                                                                                                                                                                      | `$V/ledger-lh-{browser,bot}.json`                                                         |
| `$V/crit_e.py` + skrypt inline                                                | kryteria (b) i (e) z nowych ksiąg                                                                                                                                                                                | –                                                                                         |
| `analiza/cpu-whatif.mjs` (bez zmian, przez `CAL_BENCH`)                       | (1) odtworzenie przeliczenia autora z 1616,5; (2) wariant ze spójnym odniesieniem 1538,5 / 1575                                                                                                                  | `$V/whatif-{browser,bot}-1616.json`, `$V/whatif-{browser,bot}-{mobile-1538,d4-1575}.json` |
| `$V/proj.py`                                                                  | `score.py` z repo (`narzedzia/score.py`, sha256 `3e57f3e9…dbba` = kopia autora)                                                                                                                                  | `$V/proj.out`                                                                             |

## Potwierdzone

1. **Ważność serii.** Źródło: `summary.json` obu ramion.
   - 60/60 przebiegów ważnych, `excludedAttempts` 0, `attempt` 0, `exitCode` 0, `failures` [].
   - Wariant stały: browser A 400 880 B, B 337 912 B; bot A 392 234 B, B 330 857 B.
   - Tryby FCP: A pełny (browser A-mobile-4 częściowy), B `bez-js` 30/30.
   - `restored`: zgodne z `MEASURE.md` §3 (bot B-desktop4x 0/5, bot A-desktop5x 2/5).
   - Load: browser 1,00–1,98, bot 0,74–1,77, wszystkie poniżej progu 2,4.
   - Księga = audyt TBT (|Δ| ≤ 1 ms) w 30/30 na ramię, zarówno w `*.ledger.txt`, jak i w moich nowych księgach.
2. **Tabele §2.1–§2.6 i §3 zgadzają się z moimi liczbami co do zaokrąglenia.** Dotyczy to:
   - per-run FCP, LCP, TBT, SI i CLS oraz median;
   - wszystkich 54 wierszy par (Δ̄, σΔ, MDE(t), t, znak);
   - Δ median.

   Przykłady: browser mobile TBT Δ̄ −89,7, σΔ 37,9, MDE(t) 63,0, t −5,30; bot desktop4x TBT −18,9 / 38,1 / 63,3 / −1,11.

3. **(a)** Mediany B mobile: FCP 1553,9 / 1541,5 ms, LCP 2332,1 / 2306,7 ms. Przekroczenia: browser B-mobile-3 (LCP 2452)
   oraz bot B-mobile-4 (FCP 1624, LCP 2436). Werdykt „mediany tak, każdy przebieg nie” jest poprawny.
4. **(b)** Według moich nowych ksiąg B ma 0 B w 30/30 przebiegach. A ma 520 692 B w 25 skryptach w 30/30.
5. **(c)** Mediana TBT 40,8 / 83,0 ms przy n = 5. Maksimum księgi 55,5 / 108,4 ms, czyli ≤ 200 ms w każdym przebiegu.
6. **(d)** Mediana desktop4x 216,0 / 268,0 ms. Żaden przebieg nie mieści się w 150 ms (minimum 174,5 / 185,5 ms).
   Desktop5x: 407,0 / 358,1 ms.
7. **(e)** Liczyłem z nowych ksiąg: klasa `ParseHTML` albo `Script` z URL dokumentu, `simDur` ≥ 50 ms, nakładanie na
   [FCP_opt, TTI_pes]. Wyniki B:

   | ramię   | mobile | desktop4x            | desktop5x | maks. sym. / blokowanie [ms] (mobile, desktop4x, desktop5x) |
   | ------- | ------ | -------------------- | --------- | ----------------------------------------------------------- |
   | browser | 1/5    | 5/5                  | 5/5       | 62/12, 120/37, 116/66                                       |
   | bot     | 1/5    | 3/5 (blokowanie 2/5) | 5/5       | 94/44, 95/37, 153/103                                       |

   Strona A: browser 1/5, 1/5, 4/5; bot 0/5, 1/5, 4/5. Skrypt inline dokumentu jest w oknie w 9 przebiegach
   (browser d4 5, d5 1; bot d5 3). Wszystko jak w §2.5.

8. **(f)** B ma CLS 0 i 0 pozycji w `layout-shifts` w 30/30 przebiegach oraz 0 zdarzeń `LayoutShift` w `trace.json`
   (grep). W A zdarzenia są tylko w: browser A-mobile-5, A-desktop4x-3, A-desktop5x-2/3/5 oraz bot A-mobile-4.
   Zgodne z §2.6.
9. **Przeliczenie autora z 1616,5 odtworzyłem bajt w bajt:** 40/40 przebiegów w obu ramionach, wszystkie pola identyczne.
   - Kontrola m' = m daje TBT równe audytowi w 20/20 na ramię.
   - Mediany m' są poprawne: B mobile 416,3 / 431,5, desktop4x 511,4 / 492,1; A 337,0 / 332,0 i 638,5 / 820,5.
   - Pary przy m' są poprawne: −41,1 / 202,7 / 337,0 / −0,45; +26,5 / 205,0 / 340,8 / +0,29; −129,4 / 46,1 / 76,7 / −6,27;
     −285,4 / 106,0 / 176,2 / −6,02.
   - Kontrola hosta W1 jest poprawna: 515,5 / 950,5 ms.
10. **Wszystkie projekcje `score.py` z §7 i §2.3 odtworzyłem dokładnie** (`$V/proj.out`):
    - referencja 53,10 / 69,80;
    - F1: mobile 93,00 (per run 93,00 ×5 oraz 93,00, 93,00, 92,70, 93,00, 93,00), z serii 97,75 / 97,75 (zakresy
      96,90–97,75 i 97,15–97,75), desktop 97,65 / 96,75, desktop5x 94,05 / 94,95;
    - F1h: 86,70 / 86,10, ×0,81 88,50 / 88,20, desktop 91,05 / 91,65, ×0,81 93,75 / 94,05;
    - rozrzuty 85,80–88,20, 85,20–92,10, 85,95–93,75, 88,65–93,75;
    - progi LCP: 2778 / 2691, 3087 / 3013, 2551 / 2395, 2899 / 2778 ms; F1 3715 ms;
    - wszystkie komórki siatki mobile;
    - 91,45 / 90,85 (wynik przy medianach FCP, LCP, SI i TBT m');
    - `mobileTbtX2` 93,0 / 92,1 i `lcpLimit87_tbtX2` 3715 / 3576.
11. **Mapowanie przez k jest zgodne z POMIAR §7.** Wartości k: mobile 0,72 = 600 / 832, desktop4x 0,42 = 740 / 1769.
    Linie `K` harnessu (5,24 / 3,40 i 4,73 / 2,82) liczą k z mediany strony A i słusznie nie zostały użyte.
12. **Waga dokumentu (§3) się zgadza.** Źródło: `document-weight-{A,B}.json`, wartości `medians`:

    | metryka                |                    A |                    B |
    | ---------------------- | -------------------: | -------------------: |
    | `htmlRawBytes`         | 400 880 B (391,5 KB) | 337 912 B (330,0 KB) |
    | gzip                   |              55,5 KB |              51,4 KB |
    | head                   |              25,3 KB |              28,3 KB |
    | `preLcpTransferBytes`  |             727,9 KB |             173,9 KB |
    | `bootClosureGzipBytes` |             474,0 KB |             484,5 KB |

## Rozbieżności

### D1. Normalizacja hosta (m', F1h): niespójny punkt odniesienia benchmarkIndex. Waga: `changes_number`

**Na czym polega niespójność.**

- `cpu-whatif.mjs` liczy m' = m × benchmarkIndex przebiegu / 1616,5. Licznik to `environment.benchmarkIndex` z LHR
  każdego przebiegu.
- Mianownik 1616,5 to coś innego: benchmark Chrome mierzony przez atrapę gtag **przed** serią kalibracji k
  (POMIAR §7: „Fałszywy gtag w skali x2,29 (benchmarkIndex Chrome 1616,5)”).
- Te same benchmarkIndex z LHR przebiegów kalibracji mają w `lighthouse-local-baseline-w1.json` mediany **1538,5**
  (mobile, 1492–1668,5) i **1575** (desktop4x, 1467–1609,5).
- W samej bramce W2 benchmark atrapy też różni się od benchmarku przebiegów: 2240 / 2126 wobec median B mobile 2617 / 2367.
- Analiza jest tu niespójna sama ze sobą: kontrola na hoście W1 używa mediany z LHR (1356,5 z `W1-wyniki.json`), a nie
  benchmarku atrapy (1298).

**Przeliczenie ze spójnym odniesieniem.** To samo narzędzie, `CAL_BENCH=1538.5` dla mobile i `1575` dla desktop4x
(`$V/whatif-*-mobile-1538.json`, `$V/whatif-*-d4-1575.json`):

| wielkość                                                      | ANALIZA (1616,5)                                             | spójnie (LHR 1538,5 / 1575)                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| TBT B mobile przy m', mediana (browser / bot)                 | 416,3 / 431,5 ms                                             | **468,0 / 477,5 ms**                                         |
| TBT A mobile przy m'                                          | 337,0 / 332,0                                                | 374,5 / 364,2                                                |
| pary mobile przy m' Δ̄ / σΔ / MDE(t) / t                       | −41,1 / 202,7 / 337,0 / −0,45; +26,5 / 205,0 / 340,8 / +0,29 | −43,6 / 242,3 / 402,7 / −0,40; +38,3 / 227,1 / 377,6 / +0,38 |
| TBT B desktop4x przy m'                                       | 511,4 / 492,1                                                | **540,4 / 512,0**                                            |
| pary desktop4x przy m'                                        | −129,4 (t −6,27); −285,4 (t −6,02)                           | −145,7 (t −6,28); −305,5 (t −6,00)                           |
| F1h mobile, punkt PSI-podobny (FCP 1,8 / LCP 2,85 / SI 3,7 s) | 86,70 / 86,10                                                | **85,20 / 85,20**                                            |
| F1h mobile, rozrzut po przebiegach                            | 85,80–88,20 / 85,20–92,10                                    | 84,60–87,30 / 84,00–91,80                                    |
| F1h mobile × 0,81                                             | 88,50 / 88,20                                                | 87,60 / 87,30                                                |
| F1h mobile, (c) alternatywa z median serii                    | 91,45 / 90,85                                                | 89,95 / 89,95                                                |
| F1h desktop, punkt (0,45 / 0,85 / 1,3 s)                      | 91,05 / 91,65                                                | **90,45 / 91,05**                                            |
| próg LCP PSI dla 87 (FCP 1,8 / SI 3,7 s)                      | ≤ 2,78 / 2,69 s                                              | ≤ 2,50 / 2,50 s                                              |
| próg LCP PSI dla 85                                           | ≤ 3,09 / 3,01 s                                              | ≤ 2,86 / 2,86 s                                              |
| próg LCP PSI dla 87 (FCP 2,0 / SI 4,2 s)                      | ≤ 2,55 / 2,40 s                                              | ≤ 2,21 / 2,21 s                                              |

**Co z tego wynika dla werdyktów.**

- Werdykt bramki się nie zmienia: (c) liczy się na zmierzonej serii.
- Alternatywa PSI-podobna przy m' była niezaliczona i dalej jest niezaliczona, tylko głębiej: 1,8 pkt pod progiem
  zamiast 0,3–0,9.
- „DoD prognoza PSI mobile 81–87” dalej jest spełnione, bo 85,20 mieści się w paśmie. Punkt przesuwa się jednak
  z górnej połowy pasma do okolic środka (84).
- **Zmienia się jedno zdanie ANALIZY (§6, wiersz DoD TBT) i jedno pole `W2-wyniki.json` (`dod[dod-tbt].evidence`).**
  Teraz brzmią „przy m' 416,3 / 431,5 ms – w paśmie, blisko górnej granicy”. Przy spójnym odniesieniu jest
  468,0 / 477,5 ms, czyli **ponad pasmem 234–457 ms**.
- Werdykt DoD-TBT („spełnione”, liczony na zmierzonych 40,8 / 83,0 ms) zostaje, ale argument odporności z m' upada.
- Do poprawienia w ANALIZIE: §0 (wiersz (c), wiersz prognozy), §2.3, §5, §6, §7 i §9 pkt 1–2, a w `W2-wyniki.json`
  `psiForecast.F1h.*` oraz `criteria[c]`.

**Dodatkowo o samej metodzie m'.** Kontrola na hoście W1 (§5) daje dla mobile 515,5 ms wobec 374 ms zmierzonych,
czyli +38 %. Dla desktop4x daje 950,5 wobec 1037, czyli −8 %, i do tego użyto mediany benchmarku B mobile (1357), a nie
desktop4x (1398, `W1-wyniki.json`). Błąd metody rzędu ±40 % TBT przekłada się na kilka punktów PSI. To więcej niż
różnica 86,7 wobec 87, więc punkt F1h trzeba traktować jako przedział, nie jako liczbę z dokładnością do 0,1.

### D2. Reżim refetchu postów: liczby z backendu, nie z okna Lighthouse. Waga: `wording`

ANALIZA §3 i `MEASURE.md` §7 pkt 4 podają: browser A 3/15, B 5/15; bot A 1/15, B 5/15. Źródło to
`backend.byPath["GET /rest/v1/posts"]`, czyli liczba żądań widziana przez serwer.

Policzyłem `Network.requestWillBeSent` dla GET `/rest/v1/posts` w `devtoolslog.json`, czyli tylko w oknie śladu:

- browser: A **2/15** (A-desktop4x-2 8, A-desktop5x-1 8). Cztery GET z A-mobile-3 nie występują w devtoolsLog.
  B 5/15 (B-mobile-3 5, B-mobile-4 5, B-desktop4x-3 8, B-desktop4x-4 8, B-desktop5x-3 8).
- bot: A 1/15 (A-desktop4x-2). B **4/15** (B-mobile-4 5, B-desktop4x-3 8, B-desktop5x-1 8, B-desktop5x-2 8). Cztery GET
  z B-mobile-3 nie występują w devtoolsLog.
- W oknie śladu na mobile jest 5 GET, nie 8.

Wniosek ANALIZY („nierównowaga działa przeciw B”) się nie zmienia.

**Uwaga do (a), której ANALIZA nie rozważa.** Oba przebiegi, które przekraczają próg (a), należą do reżimu refetchu
w oknie śladu (browser B-mobile-3, bot B-mobile-4). Wśród 10 przebiegów B mobile przekroczenie wystąpiło w 2 z 3
przebiegów z refetchem i w 0 z 7 bez niego (Fisher, jednostronnie, p ≈ 0,067). To nie dowodzi przyczyny. Żądania
ruszają po bootcie, więc same nie powinny wchodzić do grafu LCP. Zdanie §2.1 „Przyczyna obu przekroczeń jest jedna
i ta sama” warto jednak opatrzyć zastrzeżeniem, że oba przebiegi przypadają na ten sam stan serwera i klienta.
Werdykt (a) dosłownie i tak jest niezaliczony.

### D3. Mnożnik MDE(z). Waga: `wording`

ANALIZA §1 podaje „MDE(z) = 2,802·σΔ/√5 (moje wartości zgadzają się z liniami PAIRS)”.

- Wartości w tabeli §3 i w `W2-wyniki.json` odpowiadają mnożnikowi 2,8016 (z₀,₉₇₅ + z₀,₈). Przykład: browser mobile
  FCP: 2,8016 × 1023,19 / √5 = 1282,0.
- Harness używa mnożnika 2,80: `summary.json` `mdeZ` = 1281,24, w linii `PAIRS` 1,281 s.
- Przy 2,802 wychodzi 1282,2.

Różnica jest ≤ 0,1 %, więc żadne porównanie z MDE się nie zmienia.

### D4. Dwie różne agregacje w §2.3. Waga: `wording`

- Wariant F1 „z FCP/LCP/SI serii” (97,75 / 97,75) to **mediana wyników per przebieg**.
- Wariant m' (91,45 / 90,85) to **wynik przy medianach** FCP, LCP, SI i TBT.
- Mediana per przebieg dla m' wynosi 91,15 / 90,85 (`psiForecast.F1h.*.mobileSeriesRuns`).

Warto ujednolicić. Werdykt się nie zmienia.

### D5. F1h „z FCP/LCP/SI serii” miesza wartości z m i m'. Waga: `wording`

Projekcja F1h z serii bierze TBT przy m', ale FCP, LCP i SI przy m. Przy m' FCP Lantern rośnie w browser B-mobile-3
z 1598 do 1634 ms i w bot B-mobile-4 z 1624 do 1664 ms; desktop4x B-1 ma przy m' FCP 584 ms i LCP 673 ms. Wpływ na
punkty jest marginalny, a mediany (a) przy m' się nie zmieniają. ANALIZA nie mówi jednak, że przy m' dosłowne (a)
oblewa też FCP browser B-mobile-3, które przy m' wynosi 1634 ms, ponad 1,6 s.

### D6. Liniowe mapowanie przez k przy małym TBT. Waga: `wording`, uwaga metodyczna

k = 0,72 skalibrowano przy TBT fixture 832 ms. TBT jest progowe i wypukłe, co `lanternTasks.ts --help` mówi wprost,
więc proporcjonalne przełożenie 40,8 → 29,4 ms (F1) nie ma podstawy empirycznej. ANALIZA słusznie traktuje F1 jako
„górną granicę” i za punkt bierze F1h. W §9 brakuje jednak tego zastrzeżenia obok zastrzeżenia o szybkości hosta.

### D7. Drobne. Waga: `wording`

- Bot desktop4x perf, kolumna „znak par”: wpisano „mieszane”, a faktycznie są 4 pary dodatnie i 1 zerowa, bez ujemnych.
- benchmarkIndex bot B-desktop4x-3 to 2202,5. W §5 wpisano „2202”, choć przy zwykłym zaokrągleniu byłoby 2203.
- „Host ×1,4–1,7 szybszy” (§1): wartości 1,4–1,7 wychodzą z median przebiegów B do median LHR kalibracji
  (2617 / 1538,5 = 1,70; 2266 / 1575 = 1,44). Z benchmarku atrapy wychodzi 2240 / 1616,5 = 1,39 i
  2126 / 1616,5 = 1,32, a przebiegi mieszczą się w 1759–2779. To ten sam problem odniesienia co w D1.

## Podsumowanie wpływu

| rozbieżność       | zmienia werdykt?                      | zmienia liczby?                                                                                                                                                     |
| ----------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 odniesienie m' | nie (bramka, kryteria, DoD bez zmian) | tak: F1h mobile 86,70 / 86,10 → 85,20 / 85,20, desktop 91,05 / 91,65 → 90,45 / 91,05; TBT m' 416,3 / 431,5 → 468,0 / 477,5 ms (ponad pasmem DoD 234–457); progi LCP |
| D2 refetch        | nie                                   | liczebności reżimu w oknie śladu: A 2/15 (browser), B 4/15 (bot)                                                                                                    |
| D3–D7             | nie                                   | nie (sformułowania i zaokrąglenia)                                                                                                                                  |
