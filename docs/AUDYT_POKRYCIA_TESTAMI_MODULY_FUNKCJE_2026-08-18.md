# Audyt pokrycia testami: moduł po module, funkcja po funkcji (2026-08-21)

**Wydanie 4 pomiaru.** Rodowód: wydanie 1 (2026-08-18, HEAD `e83570c`) musiało wykluczyć
39 plików testowych wiszących w kolekcji; wydanie 2 (19.08) było pierwszym KOMPLETNYM pomiarem;
wydanie 3 (2026-08-19, HEAD `8797ca8e3`) było pierwszym, w którym cała suita była zielona.
To wydanie mierzy HEAD `6426bd039` — **75 commitów** za wydaniem 3, w tym dwie duże akcje
domykające: CMS builder (20.08) i kluby dyskusyjne (21.08). Efekt: **+186 plików testowych**
(1 237 → 1 423), +81 plików produkcyjnych, 24 defekty produkcyjne zgłoszone
jako `it.fails` i podniesiony próg globalny. Plik pozostaje pod tą samą nazwą, bo odwołuje się
do niego komentarz przy progu globalnym w `vitest.config.ts` oraz prompty modułowe. Zmiany
względem wydania 3 są w rozdziale 2.1, defekty w 7.2, dokumenty wdrożeniowe w 9.4.

Zlecenie: **„ile % pokrycia testami ma każdy moduł, jego funkcje oraz funkcjonalności”**.
Dokument podaje ZMIERZONE liczby (nie oceny), z jawną metodologią i jawnymi ograniczeniami
pomiaru. Taksonomia modułów jest ta sama, co w `docs/OCENA_FUNKCJI_TABELE_2026-08-14.md`,
więc liczby da się wprost podłożyć pod tamte tabele ocen.

---

## 0. Jak to zmierzono (i czego te liczby NIE znaczą)

| Element pomiaru                    | Wartość                                                                                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Narzędzie                          | `vitest run --coverage` (provider `v8`), konfiguracja repo bez zmian                                                                                      |
| Zakres mierzony                    | całe `src/**/*.{ts,tsx}` (`all: true`) — pliki bez testów WCHODZĄ do mianownika                                                                           |
| Wykluczenia (z `vitest.config.ts`) | `__tests__`, `*.test.*`, artefakty generowane (`routeTree.gen.ts`, `supabase/types.ts`, `lucideIconNodes.generated.ts`), `src/test/**`, `lazyWidgets.tsx` |
| Plików produkcyjnych w mianowniku  | 2 771                                                                                                                                                     |
| Plików testowych zmierzonych       | 1 423 z 1 423 (100,0%)                                                                                                                                    |
| Przypadków testowych wykonanych    | 34 131 (statyczny licznik `it/test` w plikach: 25 835; różnica to rozwinięcia `it.each`)                                                                  |
| Testy poza pomiarem                | brak — żaden plik nie został wykluczony z przebiegu                                                                                                       |
| Testy czerwone w tym przebiegu     | **0 — suita jest w całości zielona** (pierwszy taki przebieg w trzech wydaniach)                                                                          |
| Testy „expected fail”              | 36 przypadków z 24 wywołań `it.fails(` — zapisane defekty produkcyjne, nie awarie (rozdział 7.2)                                                          |
| Testy pominięte                    | 2 pliki / 50 testów — wymagają danych dostępowych do Supabase, których sandboks nie ma (rozdział 9.2)                                                     |
| Wynik bramki pokrycia              | przebieg zakończony kodem **0**: próg globalny i wszystkie 225 progów per-ścieżka PRZESZŁY                                                                |
| Data pomiaru                       | 2026-08-21, HEAD `6426bd039`                                                                                                                              |

**Cztery zastrzeżenia, bez których te procenty można źle odczytać:**

1. **Pokrycie ≠ poprawność.** Instrukcja „pokryta” to instrukcja, która się WYKONAŁA w trakcie
   testu — nie taka, której wynik ktoś sprawdził asercją. Dlatego obok pokrycia podaję gęstość
   asercji (kolumna „asercje”) — moduł z wysokim pokryciem i niską liczbą asercji to render bez dowodu.
2. **Pokrycie jednostkowe to nie całe pokrycie systemu.** Warstwa danych (RLS, RPC, triggery) jest
   testowana w pgTAP (97 plików, 1 812 asercji), a ścieżki użytkownika w Playwright
   (7 plików, 42 testów). Tych warstw v8 nie widzi — moduł z niskim %
   jednostkowym może mieć realną zaporę w bazie (rozdział 7).
3. **Mapowanie plik → moduł jest MOJE, nie repo.** Repo nie ma manifestu modułów; przypisanie
   2 771 plików do 21 modułów zrobiłem regułami po ścieżkach (rozdział 9.1). Pliki graniczne
   (np. `gifting` — „podaruj artykuł” jest funkcją MODUŁU 1, a kod leży w powierzchni MODUŁU 14)
   zaznaczam w tabelach.
4. **Pomiar jest KOMPLETNY i zielony, a suita jest dwa i pół raza większa niż w wydaniu 1.**
   Ten przebieg: **1 421 plików / 34 045 testów przeszło, ani jeden nie padł**, bramka pokrycia
   wyszła kodem 0 (próg globalny plus 225 progów per-ścieżka). Do tego 36 przypadków
   „expected fail” — to NIE awarie, a zapisane defekty produkcyjne (rozdział 7.2). Poza pomiarem
   zostały 2 pliki (50 testów) pomijające się SAME z braku danych dostępowych do Supabase —
   inwarianty na żywej bazie, piąta warstwa testów w tym repo, której ten dokument nie mierzy
   z zasady (rozdział 7). Na CI z sekretami one się wykonują. Dla porównania rodowodu: wydanie 1
   musiało wykluczyć 39 plików wiszących w kolekcji, wydanie 2 miało jeden czerwony test i dziesięć
   czerwonych progów, wydanie 3 było pierwszym w całości zielonym.

---

## 1. Wynik globalny: całe `src/`

| Metryka    | Pokryte / wszystkich |          % |
| ---------- | -------------------: | ---------: |
| Instrukcje |     71 114 / 107 097 | **66,40%** |
| Gałęzie    |      59 725 / 97 633 | **61,17%** |
| Funkcje    |      19 239 / 29 767 | **64,63%** |
| Linie      |      63 127 / 93 630 | **67,42%** |

Próg globalny w `vitest.config.ts` (ratchet, wolno tylko podnosić): **58% instrukcji /
52% gałęzi / 54% funkcji / 58% linii**. Zmierzony margines nad progiem:
instrukcje 8,40 pp, gałęzie 9,17 pp,
funkcje 10,63 pp, linie 9,42 pp.

**Kontrola wiarygodności pomiaru.** Komentarz przy progu w `vitest.config.ts` dokumentuje ostatni
pomiar zespołu: 62,03% instrukcji / 56,37% gałęzi /
58,31% funkcji / 62,93% linii.
Ten audyt, niezależnym przebiegiem: 66,40% / 61,17% / 64,63% / 67,42%.
Zgodność jest tym razem bardzo dobra i to jest istotne: komentarz w configu jest datowany na 20.08,
czyli PRZED wejściem pracy klubowej, a moje liczby są po niej. Różnica ~4 pp odpowiada dokładnie temu,
co dołożyło domknięcie modułu 16 — czyli obie strony mierzą to samo i tak samo, a komentarz jest
utrzymywany na bieżąco. Po wydaniu 3, w którym ten sam komentarz był nieaktualny o ~19 pp, to
zauważalna zmiana nawyku. Warto dopisać wpis po klubach, żeby zostało tak dalej.

**Rekomendacja R1 z wydania 3 jest wdrożona — próg globalny podniesiony.** Wydanie 3 zgłaszało,
że progi `33/25/33/28` stoją ~23 pp pod pomiarem, czyli przepuszczają dwie piąte dorobku
testowego przy zielonym CI. Config ma dziś **58 instrukcji / 54 funkcje / 58 linii / 52 gałęzie**,
a komentarz z 20.08 argumentuje to tym samym mechanizmem: poprzedni próg „przepuszczał ~28 pp
swobodnego spadku, czyli nie łapał już żadnej realnej regresji — tylko katastrofę”. Reguła
została zachowana: próg = zmierzone minus ~4 pp marginesu na dryf CI. To pierwsze wydanie tego
audytu, w którym zapadka faktycznie zapada.

**Rekomendacja R1 z WYDANIA 1 jest wdrożona** (nie mylić z R1 tego wydania w rozdz. 8.1).
`coverage.reportOnFailure: true` stoi w configu
z komentarzem opisującym mechanizm (`checkThresholds` żyje wewnątrz `reportCoverage()`, z którego
vitest wychodził przy pierwszym czerwonym teście). Skutek praktyczny: ten pomiar nie wymagał już
żadnego obejścia — raport i progi powstają także na czerwonej suicie.

---

## 2. Pokrycie per moduł — tabela główna

Sortowanie: po pokryciu linii, rosnąco (najsłabsze na górze).
`T/P` = pliki testowe / pliki produkcyjne w module. `0%` = pliki produkcyjne bez ani jednej wykonanej linii.

| #   | Moduł                                                 | Pliki prod. | Instrukcje | Gałęzie | Funkcje |      Linie | Plików 0% |   T/P | Testów | Asercji |
| --- | ----------------------------------------------------- | ----------: | ---------: | ------: | ------: | ---------: | --------: | ----: | -----: | ------: |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |          38 |     26,17% |  30,22% |  17,47% | **26,16%** |        16 | 0,289 |     88 |     247 |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |         130 |     28,07% |  23,23% |  23,35% | **27,98%** |        56 | 0,231 |    481 |     976 |
| 17  | Analityka i BI                                        |          85 |     29,78% |  23,74% |  24,97% | **30,45%** |        49 | 0,224 |    199 |     442 |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    |         172 |     39,43% |  32,85% |  37,37% | **40,82%** |        36 | 0,186 |    439 |     974 |
| 7   | Typy treści specjalne                                 |         115 |     44,56% |  40,95% |  37,96% | **44,23%** |        42 | 0,496 |  1 112 |   1 799 |
| 12  | Realtime / powiadomienia / web-push                   |          28 |     45,30% |  31,08% |  43,97% | **47,98%** |        13 | 0,464 |     93 |     223 |
| 20  | Platforma / backend / infrastruktura / SSR            |         186 |     54,24% |  43,34% |  42,82% | **55,12%** |        66 | 0,818 |  2 408 |   4 950 |
| 21  | Rekrutacja / kariera                                  |          29 |     54,96% |  53,52% |  47,13% | **55,12%** |        12 | 0,379 |    171 |     374 |
| 15  | Profil i konto                                        |          81 |     54,99% |  49,86% |  51,95% | **56,03%** |        28 | 0,469 |    716 |   1 469 |
| 8   | SEO, feedy, dane strukturalne                         |          74 |     56,52% |  48,73% |  53,25% | **56,08%** |        23 | 0,527 |    350 |     792 |
| 9   | Czat / komunikator                                    |          81 |     60,83% |  51,46% |  57,74% | **62,22%** |        15 | 0,444 |    607 |   1 123 |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |         185 |     65,02% |  60,42% |  76,36% | **66,32%** |        35 | 0,492 |  1 562 |   3 192 |
| 3   | Silniki treści: bloki + page builder                  |         454 |     74,48% |  72,84% |  70,93% | **75,68%** |        72 | 0,596 |  4 884 |   8 840 |
| —   | PRZEKROJOWE: design system (components/ui)            |          43 |     77,66% |  64,15% |  71,49% | **79,89%** |         4 | 0,047 |     17 |      37 |
| 1   | Wpisy: doświadczenie czytelnika                       |          86 |     79,34% |  72,08% |  77,07% | **80,93%** |        13 | 0,616 |    948 |   2 008 |
| 11  | Newsletter i e-mail                                   |         147 |     80,53% |  71,48% |  82,71% | **81,47%** |        29 | 0,599 |  1 962 |   4 232 |
| 10  | Sieć / networking                                     |          32 |     78,38% |  67,98% |  80,86% | **81,98%** |         3 | 0,719 |    349 |     642 |
| 16  | Społeczność: kluby, komentarze, moderacja             |         317 |     85,97% |  85,23% |  85,95% | **86,18%** |        22 | 0,625 |  4 746 |   9 603 |
| 4   | Strony, wygląd, motyw, media, import                  |         132 |     90,89% |  82,23% |  88,89% | **92,26%** |         6 | 0,549 |  1 235 |   2 140 |
| —   | PRZEKROJOWE: słowniki i18n                            |         118 |     88,53% |  66,91% |  55,62% | **92,49%** |         1 | 0,051 |     60 |     141 |
| 5   | Strona główna, archiwa, chrome                        |          54 |     94,31% |  82,49% |  93,15% | **96,15%** |         1 | 0,500 |    541 |     925 |
| 6   | Wyszukiwarka                                          |          24 |     96,66% |  89,91% |  95,22% | **97,38%** |         0 | 0,875 |    528 |     839 |
| 18  | CRM                                                   |          57 |     98,17% |  86,43% |  98,49% | **98,98%** |         0 | 0,561 |    701 |   1 228 |
| 2   | Edytor wpisów i workflow redakcyjny                   |         103 |     98,81% |  94,71% |  98,85% | **99,35%** |         0 | 0,854 |  1 576 |   2 928 |

### 2.1 Zmiana od wydania 3 — co dało domknięcie buildera i klubów

Poprzedni pomiar (wydanie 3, 2026-08-19, HEAD `8797ca8e3`) obejmował 1 237 z 1 237 plików
testowych i 2 703 plików produkcyjnych. Ten obejmuje 1 423 z 1 423
i 2 771. Kolumna Δ to różnica w punktach procentowych wobec wydania 3; ostatnia kolumna to
różnica KUMULACYJNA wobec wydania 1 (2026-08-18), żeby było widać, ile z dzisiejszego stanu
powstało w ciągu tych czterech dni. Strzałka ↑ znaczy, że modułem ktoś się zajął.

| #   | Moduł                                                 | Linie wyd. 3 | Linie teraz |    Δ linie | Funkcje wyd. 3 | Funkcje teraz |  Δ funkcje | Δ linie od wyd. 1 |
| --- | ----------------------------------------------------- | -----------: | ----------: | ---------: | -------------: | ------------: | ---------: | ----------------: |
| 16  | Społeczność: kluby, komentarze, moderacja             |       33,79% |  **86,18%** | ↑ +52,4 pp |         29,90% |    **85,95%** | ↑ +56,0 pp |        ↑ +68,6 pp |
| 3   | Silniki treści: bloki + page builder                  |       52,34% |  **75,68%** | ↑ +23,3 pp |         38,73% |    **70,93%** | ↑ +32,2 pp |        ↑ +35,7 pp |
| —   | PRZEKROJOWE: design system (components/ui)            |       78,49% |  **79,89%** |  ↑ +1,4 pp |         70,61% |    **71,49%** |  ↑ +0,9 pp |        ↑ +16,8 pp |
| 20  | Platforma / backend / infrastruktura / SSR            |       54,55% |  **55,12%** |  ↑ +0,6 pp |         42,34% |    **42,82%** |  ↑ +0,5 pp |         ↑ +2,4 pp |
| 17  | Analityka i BI                                        |       29,93% |  **30,45%** |  ↑ +0,5 pp |         24,52% |    **24,97%** |  ↑ +0,5 pp |         ↑ +2,4 pp |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |       27,50% |  **27,98%** |  ↑ +0,5 pp |         22,65% |    **23,35%** |  ↑ +0,7 pp |         ↑ +6,0 pp |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    |       40,46% |  **40,82%** |  ↑ +0,4 pp |         36,95% |    **37,37%** |  ↑ +0,4 pp |        ↑ +16,4 pp |
| 2   | Edytor wpisów i workflow redakcyjny                   |       99,22% |  **99,35%** |  ↑ +0,1 pp |         98,73% |    **98,85%** |  ↑ +0,1 pp |        ↑ +91,0 pp |
| 9   | Czat / komunikator                                    |       62,16% |  **62,22%** |  ↑ +0,1 pp |         57,74% |    **57,74%** |     0,0 pp |         ↑ +0,3 pp |
| 7   | Typy treści specjalne                                 |       44,18% |  **44,23%** |     0,0 pp |         37,90% |    **37,96%** |  ↑ +0,1 pp |        ↑ +27,8 pp |
| 1   | Wpisy: doświadczenie czytelnika                       |       80,93% |  **80,93%** |     0,0 pp |         77,07% |    **77,07%** |     0,0 pp |        ↑ +49,1 pp |
| 4   | Strony, wygląd, motyw, media, import                  |       92,26% |  **92,26%** |     0,0 pp |         88,89% |    **88,89%** |     0,0 pp |        ↑ +69,5 pp |
| 5   | Strona główna, archiwa, chrome                        |       96,15% |  **96,15%** |     0,0 pp |         93,15% |    **93,15%** |     0,0 pp |        ↑ +79,4 pp |
| 6   | Wyszukiwarka                                          |       97,38% |  **97,38%** |     0,0 pp |         95,22% |    **95,22%** |     0,0 pp |        ↑ +64,2 pp |
| 8   | SEO, feedy, dane strukturalne                         |       56,08% |  **56,08%** |     0,0 pp |         53,25% |    **53,25%** |     0,0 pp |         ↑ +5,8 pp |
| 10  | Sieć / networking                                     |       81,98% |  **81,98%** |     0,0 pp |         80,86% |    **80,86%** |     0,0 pp |         ↑ +0,3 pp |
| 11  | Newsletter i e-mail                                   |       81,47% |  **81,47%** |     0,0 pp |         82,71% |    **82,71%** |     0,0 pp |        ↑ +54,8 pp |
| 12  | Realtime / powiadomienia / web-push                   |       47,98% |  **47,98%** |     0,0 pp |         43,97% |    **43,97%** |     0,0 pp |         ↑ +3,9 pp |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |       66,32% |  **66,32%** |     0,0 pp |         76,36% |    **76,36%** |     0,0 pp |        ↑ +33,6 pp |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |       26,16% |  **26,16%** |     0,0 pp |         17,47% |    **17,47%** |     0,0 pp |         ↑ +3,6 pp |
| 15  | Profil i konto                                        |       56,03% |  **56,03%** |     0,0 pp |         51,95% |    **51,95%** |     0,0 pp |        ↑ +36,9 pp |
| 18  | CRM                                                   |       98,98% |  **98,98%** |     0,0 pp |         98,49% |    **98,49%** |     0,0 pp |        ↑ +86,9 pp |
| 21  | Rekrutacja / kariera                                  |       55,12% |  **55,12%** |     0,0 pp |         47,13% |    **47,13%** |     0,0 pp |            0,0 pp |
| —   | PRZEKROJOWE: słowniki i18n                            |       92,49% |  **92,49%** |     0,0 pp |         55,03% |    **55,62%** |  ↑ +0,6 pp |         ↑ +0,7 pp |

Ruszyło 3 powierzchni (powyżej 1 pp), 21 stoi w granicach ±1 pp, 0 spadło o więcej niż 1 pp.
Inaczej niż w wydaniu 3, gdzie ruch był wąski: te 75 commitów to dwie skoncentrowane akcje
domykające. Ruch jest więc duży, ale nadal pokrywa się co do modułu z tym, czego dotknięto —
MODUŁ 3 (bloki + page builder) i MODUŁ 16 (kluby) plus powierzchnie przekrojowe, na które
wylała się logika wyprowadzona z JSX-a (28 nowych modułów reguł w `lib/clubs`, reduktor draftu
sidebara w `lib/sidebarBuilder`). Powierzchni niezmienionych co do drugiego miejsca po przecinku
jest 15 — one nie dostały w tym okresie ani jednego nowego testu.

### 2.2 Wymiar „funkcje”: ile funkcji w module zostało kiedykolwiek wywołane

To najostrzejsza z czterech metryk: liczy KAŻDĄ funkcję (również strzałkowe callbacki i handlery),
a „pokryta” znaczy „wywołana co najmniej raz”. Moduł z 20% funkcji ma cztery piąte swoich zachowań
nigdy nie uruchomione w teście.

| #   | Moduł                                                 | Funkcji razem | Wywołanych |  % funkcji |
| --- | ----------------------------------------------------- | ------------: | ---------: | ---------: |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |           458 |         80 | **17,47%** |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |         1 439 |        336 | **23,35%** |
| 17  | Analityka i BI                                        |           877 |        219 | **24,97%** |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    |         1 678 |        627 | **37,37%** |
| 7   | Typy treści specjalne                                 |         1 641 |        623 | **37,96%** |
| 20  | Platforma / backend / infrastruktura / SSR            |         2 013 |        862 | **42,82%** |
| 12  | Realtime / powiadomienia / web-push                   |           373 |        164 | **43,97%** |
| 21  | Rekrutacja / kariera                                  |           348 |        164 | **47,13%** |
| 15  | Profil i konto                                        |         1 028 |        534 | **51,95%** |
| 8   | SEO, feedy, dane strukturalne                         |           492 |        262 | **53,25%** |
| —   | PRZEKROJOWE: słowniki i18n                            |           169 |         94 | **55,62%** |
| 9   | Czat / komunikator                                    |         1 060 |        612 | **57,74%** |
| 3   | Silniki treści: bloki + page builder                  |         6 862 |      4 867 | **70,93%** |
| —   | PRZEKROJOWE: design system (components/ui)            |           228 |        163 | **71,49%** |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |         1 358 |      1 037 | **76,36%** |
| 1   | Wpisy: doświadczenie czytelnika                       |           615 |        474 | **77,07%** |
| 10  | Sieć / networking                                     |           303 |        245 | **80,86%** |
| 11  | Newsletter i e-mail                                   |         1 556 |      1 287 | **82,71%** |
| 16  | Społeczność: kluby, komentarze, moderacja             |         3 487 |      2 997 | **85,95%** |
| 4   | Strony, wygląd, motyw, media, import                  |         1 008 |        896 | **88,89%** |
| 5   | Strona główna, archiwa, chrome                        |           555 |        517 | **93,15%** |
| 6   | Wyszukiwarka                                          |           293 |        279 | **95,22%** |
| 18  | CRM                                                   |         1 058 |      1 042 | **98,49%** |
| 2   | Edytor wpisów i workflow redakcyjny                   |           868 |        858 | **98,85%** |

---

## 3. Pokrycie per funkcjonalność (123 funkcjonalności w 21 modułach)

Każdy wiersz to FUNKCJA PRODUKTU, nie katalog: lista plików ją realizujących jest zdefiniowana
wzorcami ścieżek. Kolumna „fn” to funkcje wywołane / wszystkie funkcje w plikach tej funkcjonalności.

### MODUŁ 1 — Wpisy: doświadczenie czytelnika · linie 80,93% · funkcje 77,07%

**Rodzaje testów:** jednostkowy 29 · komponentowy 15 · hooka 8 · dostępności 1.

**Co tu decyduje:** reguły dostępu i formatowania (paywall, metering, cytowania, TOC) mają testy jednostkowe i progi, więc ryzyko przeniosło się na **testy komponentowe**: to, co czytelnik widzi — render wpisu, odtwarzacz audio, podświetlanie glosariusza mutujące DOM artykułu — dowodzi się wyłącznie renderem z asercją na treść, a nie testem czystej funkcji.

**Bez tego rodzaju przechodzi taki defekt:** reguła paywalla poprawnie liczy limit, a widok mimo to renderuje pełną treść pod nakładką — tekst jest w DOM, więc płatna treść wycieka do czytnika i do robota. Test reguły jest zielony, pieniądze stracone.

| Funkcjonalność                     | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |      Linie | fn (szt.) |
| ---------------------------------- | -----: | ---------: | -----: | ----: | ------: | ---------: | --------: |
| Paywall / bramka dostępu           |      5 |        152 |  70,9% | 73,4% |   78,8% |  **71,7%** |     26/33 |
| Audio wpisu (TTS)                  |     16 |        763 |  78,1% | 73,6% |   72,8% |  **80,2%** |   110/151 |
| Układy wpisu + render              |     29 |        507 |  83,0% | 72,0% |   76,8% |  **86,4%** |   126/164 |
| Powiązane wpisy / rekomendacje     |      7 |        162 |  89,4% | 80,1% |   95,7% |  **91,4%** |     45/47 |
| Key takeaways + cytowania          |      5 |        171 |  98,5% | 92,4% |  100,0% |  **99,4%** |     41/41 |
| Spis treści (TOC) + przypisy       |      5 |        183 |  97,6% | 93,6% |   98,1% |  **99,5%** |     53/54 |
| Metering „N darmowych/mies.”       |      3 |         85 |  98,0% | 96,1% |  100,0% | **100,0%** |     23/23 |
| Licznik odsłon / zapisane artykuły |      3 |        103 |  99,2% | 96,7% |   92,9% | **100,0%** |     26/28 |

### MODUŁ 2 — Edytor wpisów i workflow redakcyjny · linie 99,35% · funkcje 98,85%

**Rodzaje testów:** komponentowy 54 · jednostkowy 17 · warstwy danych 5 · hooka 10 · parytetu 1 · bramki 1.

**Co tu decyduje:** reguły workflow i rewizji siedzą w `lib/content/*` i mają 100%, więc pokrycie tego modułu podnoszą tylko **testy komponentowe i testy hooków** — autozapis, obecność edytorska i formularz wpisu to cykl życia, nie czysta funkcja; test jednostkowy nie wykryje, że hook nie unieważnił cache po zapisie.

**Bez tego rodzaju przechodzi taki defekt:** autozapis zapisuje wersję, ale nie unieważnia cache listy; redaktor wraca na listę, widzi wersję starszą i nadpisuje własną pracę. Test jednostkowy zapisu przechodzi, bo zapis faktycznie się wykonał.

| Funkcjonalność                  | Plików | LOC mierz. | Instr. |   Gał. | Funkcje |      Linie | fn (szt.) |
| ------------------------------- | -----: | ---------: | -----: | -----: | ------: | ---------: | --------: |
| Rewizje i przywracanie          |     12 |        286 |  97,6% |  90,1% |   96,3% |  **97,9%** |   105/109 |
| Edytor wpisu (panele)           |     68 |      1 077 |  98,8% |  95,5% |   99,1% |  **99,4%** |   422/426 |
| Workflow draft→review→published |     10 |        214 |  99,1% |  95,6% |   99,0% |  **99,5%** |     96/97 |
| Autozapis wpisu                 |      3 |         85 | 100,0% |  96,0% |  100,0% | **100,0%** |     20/20 |
| Obecność edytorska (presence)   |      2 |          6 | 100,0% | 100,0% |  100,0% | **100,0%** |       3/3 |

### MODUŁ 3 — Silniki treści: bloki + page builder · linie 75,68% · funkcje 70,93%

**Rodzaje testów:** komponentowy 131 · jednostkowy 114 · hooka 12 · parytetu 8 · bramki 3 · dostępności 2 · dymny 1.

**Co tu decyduje:** decyduje **test parytetu**: rejestr widgetów, panel właściwości i renderer to trzy artefakty, które muszą mówić to samo, a rozjazd „panel ustawia, renderer ignoruje” łapie wyłącznie porównanie dwóch stron (`check:widget-fidelity`, `settingsFidelity.gate`). Test jednostkowy schematu i test komponentu widgetu są konieczne, ale ani jeden, ani drugi nie zauważy dryfu między nimi.

**Bez tego rodzaju przechodzi taki defekt:** panel zapisuje ustawienie pod kluczem `heightMobile`, renderer czyta `mobileHeight`. Oba pliki mają testy, oba są zielone, a strona na telefonie ignoruje ustawienie — to dokładnie ta klasa defektu, dla której powstała bramka `check:widget-fidelity`.

| Funkcjonalność                                         | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |      Linie | fn (szt.) |
| ------------------------------------------------------ | -----: | ---------: | -----: | ----: | ------: | ---------: | --------: |
| CMS: builder sidebara + wzorce                         |      7 |        238 |  73,1% | 66,8% |   69,7% |  **74,4%** |    92/132 |
| CMS: import z Gutenberga / WordPressa                  |     10 |      1 309 |  78,1% | 74,5% |   79,6% |  **79,4%** |   199/250 |
| CMS: silnik treści publicznej (contentEngine)          |     19 |        521 |  79,5% | 77,9% |   82,2% |  **80,6%** |    97/118 |
| CMS: zapytania danych widgetów                         |      8 |        459 |  78,3% | 68,8% |   87,9% |  **83,2%** |   123/140 |
| CMS: design tokens / kolory globalne / typografia      |      6 |        257 |  85,5% | 81,6% |   85,0% |  **87,9%** |     34/40 |
| CMS: widgety buildera — render publiczny               |     54 |      3 599 |  90,4% | 82,7% |   87,4% |  **92,1%** |   693/793 |
| CMS: page builder (typ Elementor) — schemat i operacje |     11 |        649 |  89,4% | 69,6% |   99,7% |  **96,9%** |   293/294 |
| CMS: panele właściwości widgetów                       |    112 |      4 666 |  96,5% | 93,2% |   95,0% |  **97,3%** | 1971/2074 |
| CMS: sanityzacja HTML                                  |      4 |        157 |  93,9% | 88,1% |   90,6% |  **97,5%** |     29/32 |
| CMS: render bloków (publiczny)                         |     39 |      1 909 |  96,9% | 93,2% |   94,8% |  **97,8%** |   489/516 |
| CMS: silnik bloków (typ Gutenberg) — rdzeń             |      9 |        359 |  99,0% | 94,1% |  100,0% |  **98,9%** |   148/148 |
| CMS: warstwa content-model (rozdział bloki⇄builder)    |      7 |        150 |  95,1% | 86,7% |   96,9% |  **99,3%** |     31/32 |
| CMS: edycja bloków (selekcja, focus, schowek, undo)    |      6 |        236 |  98,3% | 93,4% |  100,0% | **100,0%** |     45/45 |

### MODUŁ 4 — Strony, wygląd, motyw, media, import · linie 92,26% · funkcje 88,89%

**Rodzaje testów:** komponentowy 31 · jednostkowy 25 · hooka 11 · warstwy danych 4 · funkcji serwerowej 1 · dostępności 1.

**Co tu decyduje:** połowa ryzyka to **czysta matematyka** (kadrowanie obrazu, tokeny motywu, kontrast etykiet) — tam test jednostkowy jest najtańszym dowodem o największym zasięgu; druga połowa to **testy hooków** panelu mediów (mutacje, zaznaczanie, skróty klawiszowe), gdzie liczy się kolejność zdarzeń i wycofanie po błędzie.

**Bez tego rodzaju przechodzi taki defekt:** kadr zapisuje się z zamienionymi osiami i wszystkie miniatury w archiwum są przycięte w złym miejscu. Dla plików już przetworzonych błąd jest nieodwracalny — nie ma z czego odtworzyć oryginalnego kadru.

| Funkcjonalność                  | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |      Linie | fn (szt.) |
| ------------------------------- | -----: | ---------: | -----: | ----: | ------: | ---------: | --------: |
| Ikony / marka                   |      7 |        149 |  79,6% | 73,9% |   73,0% |  **80,5%** |     27/37 |
| Media: upload, crop, biblioteka |     41 |      1 418 |  97,6% | 90,5% |   96,4% |  **99,0%** |   348/361 |
| Motyw / wygląd / global colors  |     51 |        629 |  98,2% | 91,5% |   97,5% |  **99,0%** |   193/198 |
| Szablony stron i archiwów       |      6 |        111 |  99,2% | 93,8% |  100,0% | **100,0%** |     63/63 |

### MODUŁ 5 — Strona główna, archiwa, chrome · linie 96,15% · funkcje 93,15%

**Rodzaje testów:** komponentowy 12 · jednostkowy 10 · warstwy danych 3 · parytetu 1 · dostępności 1.

**Co tu decyduje:** chrome jest na ścieżce każdej strony, więc liczy się **test komponentowy z asercją a11y** (nawigacja klawiaturą, rola i etykieta) plus **test jednostkowy drzewa menu** (sieroty, cykl, limit głębokości). Mega menu pokazuje, że ta mieszanka działa: cztery testy, w tym parytet kolumn, dały tej powierzchni kilkakrotnie wyższe pokrycie niż sąsiedniemu menu bez nich.

**Bez tego rodzaju przechodzi taki defekt:** menu działa myszką i nie działa klawiaturą. Defekt jest niewidoczny dla każdego, kto sprawdza ręcznie, i całkowicie blokujący dla części odbiorców — na powierzchni obecnej na każdej stronie serwisu.

| Funkcjonalność                       | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ------------------------------------ | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Mega menu                            |      3 |        135 |  80,9% | 66,0% |   79,5% | **88,1%** |     31/39 |
| Archiwa kategorii/tagów              |     16 |        189 |  95,1% | 82,3% |   95,5% | **96,3%** |     64/67 |
| Nagłówek / stopka / menu             |     19 |        847 |  96,6% | 86,1% |   94,8% | **97,9%** |   325/343 |
| Chrome mobilny (drawer, dolny pasek) |     11 |        220 |  95,6% | 89,3% |   91,4% | **98,2%** |     53/58 |

### MODUŁ 6 — Wyszukiwarka · linie 97,38% · funkcje 95,22%

**Rodzaje testów:** komponentowy 12 · jednostkowy 5 · hooka 2 · funkcji serwerowej 1 · warstwy danych 1.

**Co tu decyduje:** ranking, operatory i facety są dowiedzione w **pgTAP** (9 plików) — powtarzanie tego w vitest jest stratą; brakującym dowodem jest **test komponentowy overlaya** i **test hooka zapisanych wyszukiwań** (alerty e-mail), bo tam mieszka to, czego baza nie widzi.

**Bez tego rodzaju przechodzi taki defekt:** alert e-mail subskrybuje zapytanie, ale nie odsubskrybowuje po usunięciu zapisanego wyszukiwania. Użytkownik dostaje powiadomienia o czymś, co skasował, i nie ma w interfejsie sposobu, żeby je wyłączyć.

| Funkcjonalność                               | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| -------------------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Wyszukiwarka: indeks i zapytania             |     10 |        512 |  96,6% | 88,8% |   98,1% | **98,2%** |   102/104 |
| Wyszukiwarka: UI (overlay, filtry, zapisane) |     13 |        411 |  98,3% | 93,9% |   98,5% | **98,3%** |   130/132 |

### MODUŁ 7 — Typy treści specjalne · linie 44,23% · funkcje 37,96%

**Rodzaje testów:** komponentowy 22 · jednostkowy 25 · warstwy danych 4 · hooka 1 · funkcji serwerowej 3 · dymny 2.

**Co tu decyduje:** osiem różnych typów treści dzieli jeden wzorzec: reguły domenowe mają testy, a **funkcje serwerowe i loadery** nie. Rezerwacja miejsc na wydarzenie to przypadek skrajny — pgTAP dowodzi kolejki FIFO w bazie, ale to **test funkcji serwerowej** decyduje, czy aplikacja w ogóle zapyta o wolne miejsce.

**Bez tego rodzaju przechodzi taki defekt:** pgTAP dowodzi kolejki FIFO na miejscach, ale aplikacja nigdy nie pyta o wolne miejsce i sprzedaje 200 wejściówek na 150 miejsc. Baza jest w porządku; wydarzenie nie.

| Funkcjonalność                   | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |      Linie | fn (szt.) |
| -------------------------------- | -----: | ---------: | -----: | ----: | ------: | ---------: | --------: |
| Podcast                          |      4 |         78 |  73,7% | 74,3% |   50,0% |  **70,5%** |     16/32 |
| Quiz / mapy                      |      5 |        251 |  92,8% | 88,0% |   88,7% |  **94,4%** |     55/62 |
| Huby ekspertów                   |     26 |        820 |  97,0% | 89,4% |   95,7% |  **97,9%** |   244/255 |
| Tracker legislacyjny             |      9 |        235 |  99,3% | 96,1% |  100,0% | **100,0%** |     95/95 |
| Programy badawcze                |      4 |         31 | 100,0% | 96,6% |  100,0% | **100,0%** |     14/14 |
| Wydarzenia (RSVP, waitlist, ICS) |     15 |        208 |  99,2% | 96,4% |  100,0% | **100,0%** |     67/67 |
| Web stories                      |      3 |         98 |  99,2% | 94,8% |  100,0% | **100,0%** |     30/30 |
| Biblioteka plików                |      7 |        248 |  99,7% | 91,0% |  100,0% | **100,0%** |     76/76 |

### MODUŁ 8 — SEO, feedy, dane strukturalne · linie 56,08% · funkcje 53,25%

**Rodzaje testów:** jednostkowy 36 · komponentowy 2 · funkcji serwerowej 1.

**Co tu decyduje:** tu **e2e jest niezastępowalne**: JSON-LD, hreflang i sitemapy dowodzi się bajtami, które wyszły z SSR, a nie wywołaniem funkcji budującej `<head>`. Testy jednostkowe (35 plików) pilnują kształtu danych, `e2e/seo.spec.ts` pilnuje tego, co widzi robot.

**Bez tego rodzaju przechodzi taki defekt:** funkcja budująca `<head>` zwraca poprawny JSON-LD, a SSR go nie emituje albo emituje dwa razy. Test jednostkowy nie widzi bajtów, które wyszły z serwera — a robot widzi wyłącznie je.

| Funkcjonalność               | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ---------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Feedy i sitemapy             |      8 |        130 |   0,7% |  0,0% |    0,0% |  **0,8%** |      0/24 |
| Monitor linków               |      2 |         18 |   4,8% |  0,0% |    0,0% |  **5,6%** |       0/8 |
| Udostępnianie / OG           |      4 |        209 |  24,8% | 21,4% |   16,4% | **25,4%** |     10/61 |
| SEO: meta, JSON-LD, hreflang |     45 |      1 385 |  77,8% | 72,0% |   85,0% | **79,1%** |   250/294 |

### MODUŁ 9 — Czat / komunikator · linie 62,22% · funkcje 57,74%

**Rodzaje testów:** jednostkowy 16 · hooka 8 · komponentowy 12.

**Co tu decyduje:** wzorcowa mieszanka po refaktorze: **test warstwy danych z atrapą łańcucha PostgREST** (kształt zapytania), **test hooka** (kolejność wiadomości, deduplikacja optymistyczna) i **test jednostkowy reguł wątku**. To ten zestaw, nie sam wzrost liczby testów, wyciągnął moduł z 17% na poziom z progami per plik.

**Bez tego rodzaju przechodzi taki defekt:** zapytanie o wiadomości gubi filtr rozmowy. RLS je odrzuci, więc objawem nie będzie wyciek, ale pusty czat u wszystkich — i wyjdzie to dopiero na produkcji, bo w teście bez atrapy łańcucha nikt nie sprawdził kształtu zapytania.

| Funkcjonalność                                  | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |      Linie | fn (szt.) |
| ----------------------------------------------- | -----: | ---------: | -----: | ----: | ------: | ---------: | --------: |
| Czat: okno rozmowy i atomy UI                   |     35 |      1 507 |  45,2% | 38,7% |   40,7% |  **46,2%** |   212/521 |
| Czat: kompozytor + wzmianki                     |     10 |        229 |  81,6% | 68,8% |   77,2% |  **84,3%** |     44/57 |
| Czat: warstwa danych (rozmowy, wiadomości)      |      3 |        374 |  92,3% | 83,3% |   95,6% |  **97,6%** |   130/136 |
| Czat: reguły wątku (kolejność, separator, skok) |      5 |        159 |  99,5% | 98,5% |   97,5% | **100,0%** |     39/40 |

### MODUŁ 10 — Sieć / networking · linie 81,98% · funkcje 80,86%

**Rodzaje testów:** komponentowy 17 · hooka 3 · jednostkowy 2 · bramki 1.

**Co tu decyduje:** warstwa danych jest RPC-only, więc **test warstwy danych** dowodzi kontraktu czasowników i prywatności odmów zaproszeń — a **test komponentowy** dowodzi, że odmowa nie wycieka do UI. Oba są objęte progiem 95/98, dlatego moduł nie osuwa się między wydaniami.

**Bez tego rodzaju przechodzi taki defekt:** polityka poprawnie odrzuca zaproszenie, a interfejs pokazuje powód odmowy zawierający dane osoby, która odrzuciła. Prywatność łamie się w warstwie, której polityka bazy nie widzi.

| Funkcjonalność                             | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ------------------------------------------ | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Sieć kontaktów (zaproszenia, obserwowanie) |     30 |        712 |  92,3% | 85,6% |   96,8% | **96,5%** |   245/253 |

### MODUŁ 11 — Newsletter i e-mail · linie 81,47% · funkcje 82,71%

**Rodzaje testów:** komponentowy 30 · jednostkowy 32 · warstwy danych 13 · funkcji serwerowej 13.

**Co tu decyduje:** dostarczalność to **testy funkcji serwerowych** (webhook dostawcy, tłumienie, reputacja) — nic innego tego nie dowiedzie, bo zdarzenie przychodzi z zewnątrz; panel redakcyjny to **testy komponentowe**, bo błąd widać dopiero w interakcji: kampania wysłana do złej listy jest defektem UI, nie reguły.

**Bez tego rodzaju przechodzi taki defekt:** twarde odbicie nie trafia na listę tłumienia, więc kolejna kampania idzie na martwy adres. Reputacja domeny spada, a wraz z nią przestaje dochodzić poczta transakcyjna — w tym reset hasła.

| Funkcjonalność                                     | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |      Linie | fn (szt.) |
| -------------------------------------------------- | -----: | ---------: | -----: | ----: | ------: | ---------: | --------: |
| POPUP: panel zapisu (formularz + zgody)            |      3 |        199 |  43,5% | 42,5% |   47,6% |  **44,7%** |     20/42 |
| Newsletter: builder maila (dokument + render HTML) |      8 |        423 |  45,9% | 33,0% |   56,9% |  **47,3%** |    58/102 |
| POPUP: host i wyświetlanie (reguły, częstotliwość) |      2 |        197 |  66,8% | 64,0% |   69,4% |  **67,0%** |     34/49 |
| Newsletter: kampanie i wysyłka                     |      3 |        380 |  67,3% | 57,2% |   62,9% |  **68,7%** |     44/70 |
| E-maile systemowe / transakcyjne                   |     38 |        991 |  77,2% | 59,5% |   69,3% |  **77,8%** |   174/251 |
| POPUP: edytor popupu w adminie                     |     15 |        399 |  77,2% | 68,6% |   87,1% |  **78,4%** |   196/225 |
| Newsletter: panel admina                           |     49 |      1 563 |  86,5% | 83,4% |   87,4% |  **86,6%** |   625/715 |
| Newsletter: telemetria (open/click, engagement)    |      8 |        119 |  97,8% | 96,1% |  100,0% |  **98,3%** |     28/28 |
| Newsletter: doręczalność (SPF/DKIM, bounces)       |      2 |         85 |  99,0% | 95,6% |   95,7% |  **98,8%** |     22/23 |
| Newsletter: zapis + double opt-in + potwierdzenie  |      4 |        175 |  99,5% | 94,2% |   96,0% | **100,0%** |     24/25 |
| Newsletter: wypis (unsubscribe)                    |      3 |        109 |  96,7% | 93,2% |   90,0% | **100,0%** |     18/20 |
| POPUP: wygląd (design tokens popupu)               |      1 |         85 |  98,0% | 91,8% |  100,0% | **100,0%** |     27/27 |
| POPUP: telemetria zdarzeń                          |      2 |         62 | 100,0% | 92,3% |  100,0% | **100,0%** |     11/11 |

### MODUŁ 12 — Realtime / powiadomienia / web-push · linie 47,98% · funkcje 43,97%

**Rodzaje testów:** jednostkowy 10 · funkcji serwerowej 2 · hooka 1.

**Co tu decyduje:** realtime wymaga **atrapy kanału** (`realtimeStub`): bez niej test dowodzi tylko, że subskrypcja została utworzona, a nie że przyjście zdarzenia zmienia stan. Powiadomienia i web-push to dodatkowo **testy funkcji serwerowych** — wysyłka jest efektem ubocznym, nie zwracaną wartością.

**Bez tego rodzaju przechodzi taki defekt:** test dowodzi, że subskrypcja kanału została utworzona, i przechodzi także wtedy, gdy handler zdarzenia jest pusty. Powiadomienia nie przychodzą, a suita jest zielona.

| Funkcjonalność              | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| --------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Powiadomienia + web-push    |     16 |        878 |  42,3% | 29,5% |   32,1% | **44,9%** |    80/249 |
| Realtime (kanały, presence) |     10 |        268 |  58,2% | 41,3% |   72,4% | **61,6%** |    84/116 |

### MODUŁ 13 — Monetyzacja: checkout / subskrypcje / billing · linie 66,32% · funkcje 76,36%

**Rodzaje testów:** komponentowy 36 · funkcji serwerowej 23 · jednostkowy 26 · warstwy danych 4 · hooka 1 · parytetu 1.

**Co tu decyduje:** ścieżka płatność → dostęp ma **testy funkcji serwerowych** z wysokimi progami (webhook Stripe, grant) i to jest właściwy rodzaj dowodu dla pieniędzy. Ale rezygnacja, zmiana planu i faktury to **testy komponentowe**: UI może pokazać „anulowano”, gdy żądanie padło, a żaden test serwerowy tego nie zauważy.

**Bez tego rodzaju przechodzi taki defekt:** anulowanie subskrypcji pokazuje „anulowano”, choć żądanie padło. Użytkownik jest przekonany, że nie płaci, i wraca po miesiącu z reklamacją i chargebackiem — a test funkcji serwerowej niczego nie zgłosił, bo funkcja nigdy nie została wywołana.

| Funkcjonalność                              | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ------------------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Billing: rekoncyliacja i panel              |    112 |      3 658 |  63,3% | 60,3% |   79,3% | **64,8%** |   612/772 |
| Webhook płatności                           |      1 |         37 |  68,4% | 63,3% |   40,0% | **67,6%** |       2/5 |
| Checkout (Stripe) + intencja                |     15 |        200 |  65,1% | 57,1% |   63,6% | **68,5%** |     35/55 |
| Subskrypcje / plany / cennik                |     33 |        755 |  91,7% | 84,6% |   92,3% | **92,7%** |   337/365 |
| Dołączenie do członkostwa (membership join) |      9 |         65 |  96,1% | 84,1% |   93,8% | **96,9%** |     30/32 |

### MODUŁ 14 — Monetyzacja: kupony / darowizny / prezenty / reklamy · linie 26,16% · funkcje 17,47%

**Rodzaje testów:** jednostkowy 6 · komponentowy 5.

**Co tu decyduje:** kwoty i kupony to **testy jednostkowe** (waluta, zaokrąglenia, audyt kuponu), a widoczność reklamy i przycisku darowizny to **testy komponentowe**. Rozdział jest tu ważny, bo błąd w kwocie i błąd w widoczności mają różne konsekwencje i różne rodzaje dowodu.

**Bez tego rodzaju przechodzi taki defekt:** zaokrąglenie kuponu procentowego liczy się na liczbach zmiennoprzecinkowych i suma zamówienia rozjeżdża się o grosz z kwotą pobraną przez dostawcę płatności. Księgowość nie domyka miesiąca, a różnicy nie widać w żadnym logu aplikacji.

| Funkcjonalność               | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ---------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Reklamy / sponsoring         |     15 |        432 |  31,3% | 39,9% |   29,9% | **30,6%** |    35/117 |
| Kupony                       |      7 |        111 |  44,5% | 39,4% |   56,0% | **46,8%** |     14/25 |
| Prezenty artykułów (gifting) |     10 |        221 |  50,8% | 52,6% |   45,8% | **53,4%** |     27/59 |
| Darowizny                    |      3 |        119 |  84,0% | 72,0% |   71,4% | **85,7%** |     15/21 |

### MODUŁ 15 — Profil i konto · linie 56,03% · funkcje 51,95%

**Rodzaje testów:** komponentowy 18 · jednostkowy 11 · hooka 4 · funkcji serwerowej 1 · warstwy danych 1 · bramki 3.

**Co tu decyduje:** konto to **testy inwariantów i bramek** (guard weryfikacji profilu, izolacja tenanta) plus **pgTAP** dla eksportu danych i RODO. Sam procent pokrycia mówi tu mniej niż odpowiedź na pytanie, czy inwariant „profil niezweryfikowany nie widzi X” ma test, który pada przy każdym złamaniu reguły w dowolnym miejscu.

**Bez tego rodzaju przechodzi taki defekt:** jedna nowa trasa zapomina guardu weryfikacji i profil niezweryfikowany widzi dane, których nie powinien. Każda pojedyncza funkcja działa poprawnie — złamana jest reguła, nie funkcja, więc żaden test funkcji tego nie wykryje.

| Funkcjonalność                                | Plików | LOC mierz. | Instr. |   Gał. | Funkcje |      Linie | fn (szt.) |
| --------------------------------------------- | -----: | ---------: | -----: | -----: | ------: | ---------: | --------: |
| LOGIN: ustawienia logowania (admin)           |      3 |         81 |   2,4% |   0,0% |    0,0% |   **2,5%** |      0/51 |
| Retencja / onboarding                         |      8 |        180 |  44,0% |  38,0% |   47,4% |  **44,4%** |     18/38 |
| Zainteresowania / personalizacja              |      7 |        647 |  44,2% |  47,5% |   30,6% |  **46,5%** |    45/147 |
| LOGIN: portal logowania (hasło, magic link)   |      4 |        225 |  53,1% |  57,6% |   60,0% |  **53,3%** |     33/55 |
| LOGIN/LOGOUT: sesja i kontekst użytkownika    |      4 |        112 |  66,4% |  57,1% |   60,0% |  **68,8%** |     15/25 |
| Konto: dane, RODO, eksport                    |      3 |        118 |  70,0% |  71,0% |   79,4% |  **70,3%** |     27/34 |
| REJESTRACJA: pola, walidacja, panel sukcesu   |      2 |         46 |  70,9% |  49,1% |   75,0% |  **73,9%** |     12/16 |
| Profil użytkownika                            |     33 |      1 344 |  88,6% |  84,8% |   80,2% |  **90,4%** |   380/474 |
| LOGIN: formularze auth w CMS (bloki + widget) |      3 |        363 |  94,7% |  85,3% |   86,1% |  **96,4%** |     68/79 |
| LOGIN: MFA (2FA)                              |      2 |         44 | 100,0% |  94,1% |   92,9% | **100,0%** |     13/14 |
| LOGIN: ochrona przed brute force              |      1 |         54 | 100,0% | 100,0% |  100,0% | **100,0%** |       9/9 |
| LOGIN: reset hasła                            |      1 |         52 |  96,8% |  85,5% |  100,0% | **100,0%** |     16/16 |

### MODUŁ 16 — Społeczność: kluby, komentarze, moderacja · linie 86,18% · funkcje 85,95%

**Rodzaje testów:** komponentowy 98 · jednostkowy 84 · dostępności 4 · hooka 6 · warstwy danych 1 · funkcji serwerowej 2 · bramki 2 · parytetu 1.

**Co tu decyduje:** reguły dostępu do klubu mają testy jednostkowe, a polityki — **19 plików pgTAP**. Brakującym rodzajem jest **test warstwy danych** (łańcuch PostgREST w `api.ts`) i **test hooka** dla stanu listy wątków: to one decydują, czy właściwy członek zobaczy właściwą treść, czego ani reguła, ani polityka bazy nie dowodzą same.

**Bez tego rodzaju przechodzi taki defekt:** zapytanie o wątki gubi filtr grupy. RLS przepuści, bo pytający jest członkiem klubu, więc członek grupy A zobaczy wątki grupy B. Polityka jest poprawna; zapytanie nie.

| Funkcjonalność                                     | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |      Linie | fn (szt.) |
| -------------------------------------------------- | -----: | ---------: | -----: | ----: | ------: | ---------: | --------: |
| Społeczność: odznaki, zaangażowanie, Q&A, ankiety  |     20 |        548 |  29,0% | 37,2% |   23,6% |  **30,1%** |    43/182 |
| Komentarze i moderacja                             |      6 |        239 |  83,2% | 78,2% |   68,0% |  **84,1%** |     51/75 |
| KLUBY: zgłoszenia członkowskie (apply)             |      5 |        183 |  87,4% | 71,0% |   95,1% |  **89,6%** |     58/61 |
| KLUBY: API i zapytania (klub, posty, wątki)        |     10 |        591 |  96,1% | 96,8% |   98,2% |  **96,6%** |   222/226 |
| KLUBY: dostęp i uprawnienia (gate, macierz, plany) |      7 |        151 |  96,6% | 93,6% |  100,0% |  **98,0%** |     43/43 |
| KLUBY: reguły widoków wyprowadzone z JSX-a         |     12 |        378 |  99,1% | 97,2% |   98,7% |  **99,5%** |   151/153 |
| KLUBY: wątki dyskusyjne (dynamika, puls, źródła)   |      8 |        256 |  97,0% | 85,6% |  100,0% |  **99,6%** |     93/93 |
| KLUBY: UI (atomy/molekuły/organizmy)               |    103 |      2 193 |  99,8% | 99,3% |   99,9% |  **99,9%** |   934/935 |
| KLUBY: tematy, specjalizacje, obszary polityk      |     10 |        166 |  98,6% | 95,7% |   98,3% | **100,0%** |     59/60 |
| KLUBY: panel admina                                |     80 |      1 643 |  99,6% | 98,8% |  100,0% | **100,0%** |   785/785 |
| KLUBY: trasy publiczne klubu                       |     20 |        678 |  99,7% | 98,4% |  100,0% | **100,0%** |   247/247 |

### MODUŁ 17 — Analityka i BI · linie 30,45% · funkcje 24,97%

**Rodzaje testów:** jednostkowy 17 · dostępności 1 · komponentowy 1.

**Co tu decyduje:** warstwa semantyczna analityki jest w 100% pokryta **testami jednostkowymi z progami** — i tak być powinno, bo od niej zależy każda liczba w raporcie zarządczym. Wykresy potrzebują natomiast **testów a11y**: wykres bez alternatywy tekstowej jest dla części odbiorców pustym prostokątem.

**Bez tego rodzaju przechodzi taki defekt:** wykres w raporcie zarządczym jest dla części odbiorców pustym prostokątem. Dane są poprawne co do liczby i niedostępne co do odczytu — a pokrycie warstwy semantycznej wynosi 100%.

| Funkcjonalność                          | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| --------------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Analityka: zbieranie zdarzeń i liczniki |     20 |        705 |  14,4% | 13,7% |   16,2% | **15,2%** |    25/154 |
| Wykresy i panel BI                      |     41 |      1 501 |  27,8% | 22,2% |   22,3% | **29,0%** |   114/512 |
| Observability / RUM / web vitals        |     11 |        409 |  54,6% | 48,6% |   61,7% | **54,0%** |     37/60 |
| Analityka: warstwa semantyczna          |      7 |        239 |  70,4% | 60,2% |   69,4% | **71,5%** |     43/62 |

### MODUŁ 18 — CRM · linie 98,98% · funkcje 98,49%

**Rodzaje testów:** jednostkowy 17 · warstwy danych 5 · komponentowy 6 · funkcji serwerowej 2 · parytetu 1 · hooka 1.

**Co tu decyduje:** CRM pokazuje, po co jest **test parytetu**: filtr leadów istnieje w dwóch implementacjach (nad wierszami i nad zapytaniem), więc bez porównania obu stron poprawka w jednej zostawia drugą zepsutą. Poza tym **test warstwy danych** dla zapytań i **test jednostkowy** dla mapowania importu danych osobowych.

**Bez tego rodzaju przechodzi taki defekt:** poprawka w filtrze nad wierszami nie trafia do filtra nad zapytaniem. Lista i eksport pokazują różne zbiory leadów, a handlowiec pracuje na tym mniejszym i nie wie o brakujących.

| Funkcjonalność                        | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ------------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| CRM: UI panelu                        |     19 |        569 |  95,1% | 83,4% |   96,5% | **96,0%** |   279/289 |
| CRM: import/eksport CSV + organizacje |      7 |        356 |  98,6% | 91,7% |   95,1% | **99,4%** |     78/82 |
| CRM: kontakty, firmy, lejek, zadania  |     23 |      1 085 |  99,2% | 91,5% |   99,6% | **99,8%** |   261/262 |

### MODUŁ 19 — Ustawienia / integracje / users / multi-tenant / RODO · linie 27,98% · funkcje 23,35%

**Rodzaje testów:** jednostkowy 22 · warstwy danych 3 · komponentowy 2 · funkcji serwerowej 1 · parytetu 1 · bramki 1.

**Co tu decyduje:** tu rodzaj testu jest ważniejszy niż procent: **inwariant i parytet** (snapshot bramek autoryzacji kontra migracje, macierz uprawnień kontra rejestr capabilities) wykrywają zawężenie kręgu uprawnionych, którego żaden test jednostkowy pojedynczej funkcji nie zauważy, bo każda z nich osobno działa poprawnie.

**Bez tego rodzaju przechodzi taki defekt:** migracja zawęża krąg uprawnionych, a panel nadal oferuje akcję, którą baza odrzuci. To się w tym repo zdarzyło: `admin.users.$id` renderowało droplistę zmiany roli każdemu członkowi personelu, bo `/admin` przepuszcza też `editor` i `author` — każde jej użycie kończyło się `not_authorized`.

| Funkcjonalność                           | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ---------------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Użytkownicy i role (admin)               |      2 |        105 |   0,0% |  0,0% |    0,0% |  **0,0%** |      0/28 |
| Zgody / cookie banner / GPC / RODO       |     28 |        460 |  49,7% | 44,0% |   42,4% | **52,4%** |    64/151 |
| Ustawienia serwisu (panele)              |      5 |        111 |  54,6% | 24,5% |   40,4% | **53,2%** |     21/52 |
| Integracje zewnętrzne                    |      3 |        181 |  56,6% | 58,7% |   50,0% | **56,4%** |     17/34 |
| Autoryzacja / macierz uprawnień (authz)  |     23 |        207 |  82,4% | 75,5% |   73,9% | **82,6%** |     65/88 |
| Multi-tenant (izolacja tenanta w kodzie) |      6 |        281 |  88,5% | 83,3% |   84,1% | **90,4%** |     58/69 |
| Feature flags                            |      3 |        163 |  95,9% | 90,3% |   97,2% | **96,9%** |     35/36 |

### MODUŁ 20 — Platforma / backend / infrastruktura / SSR · linie 55,12% · funkcje 42,82%

**Rodzaje testów:** jednostkowy 103 · komponentowy 27 · funkcji serwerowej 15 · warstwy danych 3 · bramki 3 · parytetu 2.

**Co tu decyduje:** platforma utrzymuje **bramki (meta-inwarianty)**: „bramka, która istnieje, musi się uruchamiać”, parytet konfiguracji chunków, kontrakt zmiennych workflow. To rodzaj testu, który skaluje się z repozytorium, nie z liczbą przypadków — jeden taki test pilnuje wszystkich przyszłych plików.

**Bez tego rodzaju przechodzi taki defekt:** bramka istnieje w repozytorium i nie jest wpięta w workflow, więc zdanie „mamy to sprawdzone” jest fałszywe przez wiele miesięcy. Nikt tego nie zauważy, bo brak sygnału nie wygląda jak awaria — i to jest defekt, którego nie wykryje żaden test kodu produkcyjnego.

| Funkcjonalność                      | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ----------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Routing / trasy publiczne (powłoka) |      6 |        391 |   1,4% |  1,9% |    3,1% |  **1,5%** |      3/96 |
| Warstwa serwerowa (server fns)      |     19 |        980 |  20,3% | 17,7% |   17,7% | **20,5%** |    39/220 |
| Podgląd sesji / heartbeat           |      2 |        145 |  35,5% | 46,9% |   22,2% | **36,6%** |      6/27 |
| Klient Supabase / zapytania         |     26 |        909 |  34,1% | 23,5% |   32,6% | **38,3%** |    86/264 |
| A11y / watchdog / MCP               |      9 |        164 |  39,6% | 29,9% |   31,0% | **42,1%** |      9/29 |
| SSR / hydracja / cache brzegowy     |     31 |      1 149 |  74,7% | 72,9% |   71,0% | **75,5%** |   157/221 |
| Obsługa błędów / error boundary     |      7 |        115 |  78,0% | 75,7% |   65,5% | **77,4%** |     19/29 |
| Bramki CI (rejestry, kontrakty)     |     29 |      2 602 |  93,8% | 86,8% |   92,9% | **95,5%** |   442/476 |

### MODUŁ 21 — Rekrutacja / kariera · linie 55,12% · funkcje 47,13%

**Rodzaje testów:** jednostkowy 9 · dostępności 2.

**Co tu decyduje:** rekrutacja to **testy jednostkowe** walidacji zgłoszenia plus **testy a11y** formularza (to najczęściej wypełniany formularz przez osoby z zewnątrz) i **harness pgTAP** na ścieżce zapisu — bramka istnieje właśnie dlatego, że złamany CHECK w bazie przeszedł kiedyś przy zielonym CI.

**Bez tego rodzaju przechodzi taki defekt:** złamany CHECK w bazie przechodzi przy zielonym CI i formularz zgłoszenia przestaje przyjmować kandydatów. Błąd wychodzi z produkcji, nie z suity — bramka `check:pg-harness` istnieje dokładnie z tego powodu.

| Funkcjonalność                   | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| -------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Kariera: ogłoszenia i zgłoszenia |     26 |        576 |  80,1% | 80,2% |   73,2% | **81,3%** |   164/224 |

---

## 4. Zoom na powierzchnie wskazane w zleceniu

Dla pięciu obszarów wymienionych imiennie (newsletter, popup, CMS builder — Gutenberg i Elementor,
kluby dyskusyjne, login/rejestracja/wylogowanie) rozbicie schodzi do POJEDYNCZYCH FUNKCJI:
wypisuję nazwy funkcji, które nie mają ani jednego wywołania w całej suicie.

### 4.1 Newsletter (MODUŁ 11)

Razem: **3 070 / 3 845 linii = 79,84%**, funkcje **993/1234 = 80,47%**.

**Newsletter: builder maila (dokument + render HTML)** — linie 47,3%, funkcje 58/102 (56,9%), plików 8 (bez pokrycia: 0), LOC 423

> Bez ani jednego wywołania: **44 funkcji** (11 nazwanych, 33 anonimowych domknięć). Nazwane:
>
> - `normalizePhone @ src/components/newsletter/NewsletterDocRenderer.tsx:63`
> - `normalizeLinkedin @ src/components/newsletter/NewsletterDocRenderer.tsx:70`
> - `useSubscriberCount @ src/components/newsletter/NewsletterDocRenderer.tsx:78`
> - `NewsletterDocRenderer @ src/components/newsletter/NewsletterDocRenderer.tsx:94`
> - `SectionRenderer @ src/components/newsletter/NewsletterDocRenderer.tsx:269`
> - `widgetErrorKey @ src/components/newsletter/NewsletterDocRenderer.tsx:405`
> - `RuntimeWidget @ src/components/newsletter/NewsletterDocRenderer.tsx:423`
> - `CouponWidgetView @ src/components/newsletter/NewsletterDocRenderer.tsx:710`
> - `FieldWrap @ src/components/newsletter/NewsletterDocRenderer.tsx:756`
> - `fetchForBlock @ src/lib/newsletter/emailDocResolve.ts:44`
> - `fetchEmailDocPostRows @ src/lib/newsletter/emailDocResolve.ts:99`

**Newsletter: kampanie i wysyłka** — linie 68,7%, funkcje 44/70 (62,9%), plików 3 (bez pokrycia: 1), LOC 380

> Bez ani jednego wywołania: **26 funkcji** (4 nazwanych, 22 anonimowych domknięć). Nazwane:
>
> - `tickStatusOf @ src/lib/newsletter-admin.functions.ts:134`
> - `queueCount @ src/lib/newsletter-admin.functions.ts:138`
> - `splitList @ src/lib/newsletter-status.functions.ts:39`
> - `loadContext @ src/lib/newsletter-status.functions.ts:47`

**E-maile systemowe / transakcyjne** — linie 77,8%, funkcje 174/251 (69,3%), plików 38 (bez pokrycia: 6), LOC 991

> Bez ani jednego wywołania: **77 funkcji** (19 nazwanych, 58 anonimowych domknięć). Nazwane, pierwsze 14:
>
> - `forwardToPlatformRoute @ src/lib/email/platformCompat.server.ts:22`
> - `sleep @ src/lib/email/queueDrain.server.ts:167`
> - `isEmailSuppressed @ src/lib/email/suppression.server.ts:110`
> - `unsubscribeByToken @ src/lib/email/suppression.server.ts:212`
> - `recordSuppression @ src/lib/email/suppression.server.ts:249`
> - `isRecord @ src/lib/email/suppression.server.ts:307`
> - `applyDeliveryEvent @ src/lib/email/suppression.server.ts:316`
> - `serviceClient @ src/lib/email/transactional.server.ts:79`
> - `suppressionGate @ src/lib/email/transactional.server.ts:105`
> - `alreadyHandled @ src/lib/email/transactional.server.ts:158`
> - `formatMoney @ src/lib/email/transactional.server.ts:172`
> - `formatDate @ src/lib/email/transactional.server.ts:181`
> - `sendTxEmail @ src/lib/email/transactional.server.ts:199`
> - `deterministicId @ src/lib/email/transactional.server.ts:311`

**Newsletter: panel admina** — linie 86,6%, funkcje 625/715 (87,4%), plików 49 (bez pokrycia: 14), LOC 1 563

> Bez ani jednego wywołania: **90 funkcji** (7 nazwanych, 83 anonimowych domknięć). Nazwane:
>
> - `isoToLocalInput @ src/routes/admin.newsletter.campaigns.$id.tsx:76`
> - `localInputToIso @ src/routes/admin.newsletter.campaigns.$id.tsx:85`
> - `CampaignEditor @ src/routes/admin.newsletter.campaigns.$id.tsx:91`
> - `isResumableSending @ src/routes/admin.newsletter.campaigns.index.tsx:100`
> - `CampaignsList @ src/routes/admin.newsletter.campaigns.index.tsx:107`
> - `NewsletterOverview @ src/routes/admin.newsletter.overview.tsx:20`
> - `NewsletterLayout @ src/routes/admin.newsletter.tsx:14`

**Newsletter: telemetria (open/click, engagement)** — linie 98,3%, funkcje 28/28 (100,0%), plików 8 (bez pokrycia: 0), LOC 119

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

**Newsletter: doręczalność (SPF/DKIM, bounces)** — linie 98,8%, funkcje 22/23 (95,7%), plików 2 (bez pokrycia: 0), LOC 85

> Bez ani jednego wywołania: **1 funkcji** (0 nazwanych, 1 anonimowych domknięć).

**Newsletter: zapis + double opt-in + potwierdzenie** — linie 100,0%, funkcje 24/25 (96,0%), plików 4 (bez pokrycia: 0), LOC 175

> Bez ani jednego wywołania: **1 funkcji** (0 nazwanych, 1 anonimowych domknięć).

**Newsletter: wypis (unsubscribe)** — linie 100,0%, funkcje 18/20 (90,0%), plików 3 (bez pokrycia: 0), LOC 109

> Bez ani jednego wywołania: **2 funkcji** (0 nazwanych, 2 anonimowych domknięć).

### 4.2 Popup zapisu (MODUŁ 11, wydzielony)

Razem: **681 / 942 linii = 72,29%**, funkcje **288/354 = 81,36%**.

**POPUP: panel zapisu (formularz + zgody)** — linie 44,7%, funkcje 20/42 (47,6%), plików 3 (bez pokrycia: 0), LOC 199

> Bez ani jednego wywołania: **22 funkcji** (0 nazwanych, 22 anonimowych domknięć).

**POPUP: host i wyświetlanie (reguły, częstotliwość)** — linie 67,0%, funkcje 34/49 (69,4%), plików 2 (bez pokrycia: 0), LOC 197

> Bez ani jednego wywołania: **15 funkcji** (3 nazwanych, 12 anonimowych domknięć). Nazwane:
>
> - `useActivePopups @ src/lib/builder/popups.ts:201`
> - `usePopupsAdmin @ src/lib/builder/popups.ts:220`
> - `usePopupEditor @ src/lib/builder/popups.ts:327`

**POPUP: edytor popupu w adminie** — linie 78,4%, funkcje 196/225 (87,1%), plików 15 (bez pokrycia: 3), LOC 399

> Bez ani jednego wywołania: **29 funkcji** (5 nazwanych, 24 anonimowych domknięć). Nazwane:
>
> - `PopupEditorRoute @ src/routes/admin.popups.$id.tsx:8`
> - `PopupsLayout @ src/routes/admin.popups.tsx:44`
> - `triggerSummary @ src/routes/admin.popups.tsx:50`
> - `SignupPopupRow @ src/routes/admin.popups.tsx:69`
> - `PopupsList @ src/routes/admin.popups.tsx:131`

**POPUP: wygląd (design tokens popupu)** — linie 100,0%, funkcje 27/27 (100,0%), plików 1 (bez pokrycia: 0), LOC 85

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

**POPUP: telemetria zdarzeń** — linie 100,0%, funkcje 11/11 (100,0%), plików 2 (bez pokrycia: 0), LOC 62

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

### 4.3 CMS builder — bloki (Gutenberg) i widgety (Elementor) (MODUŁ 3)

Razem: **13 491 / 14 509 linii = 92,98%**, funkcje **4244/4614 = 91,98%**.

**CMS: builder sidebara + wzorce** — linie 74,4%, funkcje 92/132 (69,7%), plików 7 (bez pokrycia: 1), LOC 238

> Bez ani jednego wywołania: **40 funkcji** (8 nazwanych, 32 anonimowych domknięć). Nazwane:
>
> - `PatternPicker @ src/components/patterns/PatternPicker.tsx:58`
> - `SelectedPanel @ src/components/patterns/PatternPicker.tsx:145`
> - `PagePanel @ src/components/patterns/PatternPicker.tsx:160`
> - `PostPanel @ src/components/patterns/PatternPicker.tsx:293`
> - `PreviewFrame @ src/components/patterns/PatternPicker.tsx:416`
> - `ApplyBar @ src/components/patterns/PatternPicker.tsx:431`
> - `ConfirmDialog @ src/components/patterns/PatternPicker.tsx:446`
> - `FieldInput @ src/components/patterns/PatternPicker.tsx:513`

**CMS: import z Gutenberga / WordPressa** — linie 79,4%, funkcje 199/250 (79,6%), plików 10 (bez pokrycia: 1), LOC 1 309

> Bez ani jednego wywołania: **51 funkcji** (32 nazwanych, 19 anonimowych domknięć). Nazwane, pierwsze 14:
>
> - `esc @ src/lib/wp-import/elementor.ts:28`
> - `stripTags @ src/lib/wp-import/elementor.ts:35`
> - `readAttr @ src/lib/wp-import/elementor.ts:41`
> - `classesOf @ src/lib/wp-import/elementor.ts:45`
> - `hasClass @ src/lib/wp-import/elementor.ts:48`
> - `hasAnyClassStart @ src/lib/wp-import/elementor.ts:51`
> - `extractOutermost @ src/lib/wp-import/elementor.ts:65`
> - `widgetKind @ src/lib/wp-import/elementor.ts:127`
> - `firstMatch @ src/lib/wp-import/elementor.ts:136`
> - `parseHeadingWidget @ src/lib/wp-import/elementor.ts:141`
> - `parseButtonWidget @ src/lib/wp-import/elementor.ts:159`
> - `parseImageWidget @ src/lib/wp-import/elementor.ts:183`
> - `parseIconBoxAsCard @ src/lib/wp-import/elementor.ts:203`
> - `parseDividerWidget @ src/lib/wp-import/elementor.ts:226`

**CMS: silnik treści publicznej (contentEngine)** — linie 80,6%, funkcje 97/118 (82,2%), plików 19 (bez pokrycia: 2), LOC 521

> Bez ani jednego wywołania: **21 funkcji** (2 nazwanych, 19 anonimowych domknięć). Nazwane:
>
> - `sha256Hex @ src/lib/content/feedback.functions.ts:9`
> - `generateToken @ src/lib/content/previewTokens.functions.ts:14`

**CMS: zapytania danych widgetów** — linie 83,2%, funkcje 123/140 (87,9%), plików 8 (bez pokrycia: 0), LOC 459

> Bez ani jednego wywołania: **17 funkcji** (3 nazwanych, 14 anonimowych domknięć). Nazwane:
>
> - `fetchPopularPostIds @ src/lib/builder/postListQuery.ts:282`
> - `clubWidgetSlug @ src/lib/builder/prefetch.ts:119`
> - `clubThreadsInput @ src/lib/builder/prefetch.ts:125`

**CMS: design tokens / kolory globalne / typografia** — linie 87,9%, funkcje 34/40 (85,0%), plików 6 (bez pokrycia: 0), LOC 257

> Bez ani jednego wywołania: **6 funkcji** (1 nazwanych, 5 anonimowych domknięć). Nazwane:
>
> - `clearAllLiveWidgetTypography @ src/lib/builder/liveTypography.ts:95`

**CMS: widgety buildera — render publiczny** — linie 92,1%, funkcje 693/793 (87,4%), plików 54 (bez pokrycia: 0), LOC 3 599

> Bez ani jednego wywołania: **100 funkcji** (18 nazwanych, 82 anonimowych domknięć). Nazwane, pierwsze 14:
>
> - `resolveSpan @ src/components/builder/organisms/BuilderRenderer.tsx:82`
> - `resolveOrder @ src/components/builder/organisms/BuilderRenderer.tsx:92`
> - `BuilderEmptyPickerProvider @ src/components/builder/organisms/BuilderRenderer.tsx:137`
> - `deviceForWidth @ src/components/builder/organisms/BuilderRenderer.tsx:154`
> - `BuilderRenderer @ src/components/builder/organisms/BuilderRenderer.tsx:174`
> - `BuilderDebugOverlay @ src/components/builder/organisms/BuilderRenderer.tsx:255`
> - `SectionsList2 @ src/components/builder/organisms/BuilderRenderer.tsx:305`
> - `ExperimentSection @ src/components/builder/organisms/BuilderRenderer.tsx:375`
> - `SectionBackgroundVideo @ src/components/builder/organisms/BuilderRenderer.tsx:410`
> - `RenderSection2 @ src/components/builder/organisms/BuilderRenderer.tsx:453`
> - `RenderInner2 @ src/components/builder/organisms/BuilderRenderer.tsx:677`
> - `RenderColumn2 @ src/components/builder/organisms/BuilderRenderer.tsx:741`
> - `shallowEqual @ src/components/builder/organisms/BuilderWidgetNode.tsx:32`
> - `widgetsEqual @ src/components/builder/organisms/BuilderWidgetNode.tsx:46`

**CMS: page builder (typ Elementor) — schemat i operacje** — linie 96,9%, funkcje 293/294 (99,7%), plików 11 (bez pokrycia: 0), LOC 649

> Bez ani jednego wywołania: **1 funkcji** (0 nazwanych, 1 anonimowych domknięć).

**CMS: panele właściwości widgetów** — linie 97,3%, funkcje 1971/2074 (95,0%), plików 112 (bez pokrycia: 0), LOC 4 666

> Bez ani jednego wywołania: **103 funkcji** (0 nazwanych, 103 anonimowych domknięć).

**CMS: sanityzacja HTML** — linie 97,5%, funkcje 29/32 (90,6%), plików 4 (bez pokrycia: 0), LOC 157

> Bez ani jednego wywołania: **3 funkcji** (0 nazwanych, 3 anonimowych domknięć).

**CMS: render bloków (publiczny)** — linie 97,8%, funkcje 489/516 (94,8%), plików 39 (bez pokrycia: 0), LOC 1 909

> Bez ani jednego wywołania: **27 funkcji** (0 nazwanych, 27 anonimowych domknięć).

**CMS: silnik bloków (typ Gutenberg) — rdzeń** — linie 98,9%, funkcje 148/148 (100,0%), plików 9 (bez pokrycia: 0), LOC 359

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

**CMS: warstwa content-model (rozdział bloki⇄builder)** — linie 99,3%, funkcje 31/32 (96,9%), plików 7 (bez pokrycia: 0), LOC 150

> Bez ani jednego wywołania: **1 funkcji** (0 nazwanych, 1 anonimowych domknięć).

**CMS: edycja bloków (selekcja, focus, schowek, undo)** — linie 100,0%, funkcje 45/45 (100,0%), plików 6 (bez pokrycia: 0), LOC 236

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

### 4.4 Kluby dyskusyjne (MODUŁ 16)

Razem: **6 192 / 6 239 linii = 99,25%**, funkcje **2592/2603 = 99,58%**.

**KLUBY: zgłoszenia członkowskie (apply)** — linie 89,6%, funkcje 58/61 (95,1%), plików 5 (bez pokrycia: 1), LOC 183

> Bez ani jednego wywołania: **3 funkcji** (0 nazwanych, 3 anonimowych domknięć).

**KLUBY: API i zapytania (klub, posty, wątki)** — linie 96,6%, funkcje 222/226 (98,2%), plików 10 (bez pokrycia: 0), LOC 591

> Bez ani jednego wywołania: **4 funkcji** (2 nazwanych, 2 anonimowych domknięć). Nazwane:
>
> - `uploadClubCover @ src/lib/clubs/coverApi.ts:69`
> - `setClubCover @ src/lib/clubs/coverApi.ts:95`

**KLUBY: dostęp i uprawnienia (gate, macierz, plany)** — linie 98,0%, funkcje 43/43 (100,0%), plików 7 (bez pokrycia: 0), LOC 151

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

**KLUBY: reguły widoków wyprowadzone z JSX-a** — linie 99,5%, funkcje 151/153 (98,7%), plików 12 (bez pokrycia: 0), LOC 378

> Bez ani jednego wywołania: **2 funkcji** (2 nazwanych, 0 anonimowych domknięć). Nazwane:
>
> - `toClubAttributionMode @ src/lib/clubs/types.ts:361`
> - `isActionApplicable @ src/lib/clubs/types.ts:1179`

**KLUBY: wątki dyskusyjne (dynamika, puls, źródła)** — linie 99,6%, funkcje 93/93 (100,0%), plików 8 (bez pokrycia: 0), LOC 256

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

**KLUBY: UI (atomy/molekuły/organizmy)** — linie 99,9%, funkcje 934/935 (99,9%), plików 103 (bez pokrycia: 0), LOC 2 193

> Bez ani jednego wywołania: **1 funkcji** (0 nazwanych, 1 anonimowych domknięć).

**KLUBY: tematy, specjalizacje, obszary polityk** — linie 100,0%, funkcje 59/60 (98,3%), plików 10 (bez pokrycia: 0), LOC 166

> Bez ani jednego wywołania: **1 funkcji** (0 nazwanych, 1 anonimowych domknięć).

**KLUBY: panel admina** — linie 100,0%, funkcje 785/785 (100,0%), plików 80 (bez pokrycia: 0), LOC 1 643

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

**KLUBY: trasy publiczne klubu** — linie 100,0%, funkcje 247/247 (100,0%), plików 20 (bez pokrycia: 0), LOC 678

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

### 4.5 Login / rejestracja / wylogowanie (MODUŁ 15)

Razem: **733 / 977 linii = 75,03%**, funkcje **166/265 = 62,64%**.

**LOGIN: ustawienia logowania (admin)** — linie 2,5%, funkcje 0/51 (0,0%), plików 3 (bez pokrycia: 2), LOC 81

> Bez ani jednego wywołania: **51 funkcji** (6 nazwanych, 45 anonimowych domknięć). Nazwane:
>
> - `useAuthSettings @ src/hooks/useAuthSettings.ts:7`
> - `useSaveAuthSettings @ src/hooks/useAuthSettings.ts:22`
> - `LoginSettingsPage @ src/routes/admin.login-settings.tsx:26`
> - `ImageField @ src/routes/admin.login-settings.tsx:377`
> - `Card @ src/routes/admin.login-settings.tsx:475`
> - `BiField @ src/routes/admin.login-settings.tsx:495`

**LOGIN: portal logowania (hasło, magic link)** — linie 53,3%, funkcje 33/55 (60,0%), plików 4 (bez pokrycia: 2), LOC 225

> Bez ani jednego wywołania: **22 funkcji** (4 nazwanych, 18 anonimowych domknięć). Nazwane:
>
> - `LoginPopup @ src/components/LoginPopup.tsx:28`
> - `openLoginPopup @ src/lib/loginPopupBus.ts:13`
> - `onOpenLoginPopup @ src/lib/loginPopupBus.ts:19`
> - `LoginPage @ src/routes/login.tsx:32`

**LOGIN/LOGOUT: sesja i kontekst użytkownika** — linie 68,8%, funkcje 15/25 (60,0%), plików 4 (bez pokrycia: 3), LOC 112

> Bez ani jednego wywołania: **10 funkcji** (6 nazwanych, 4 anonimowych domknięć). Nazwane:
>
> - `useAuthSettings @ src/hooks/useAuthSettings.ts:7`
> - `useSaveAuthSettings @ src/hooks/useAuthSettings.ts:22`
> - `currentUserFromSession @ src/lib/auth/currentUser.ts:16`
> - `currentUserIdFromSession @ src/lib/auth/currentUser.ts:21`
> - `anonClient @ src/lib/auth/optionalUser.server.ts:19`
> - `optionalUserIdFromRequest @ src/lib/auth/optionalUser.server.ts:32`

**REJESTRACJA: pola, walidacja, panel sukcesu** — linie 73,9%, funkcje 12/16 (75,0%), plików 2 (bez pokrycia: 1), LOC 46

> Bez ani jednego wywołania: **4 funkcji** (1 nazwanych, 3 anonimowych domknięć). Nazwane:
>
> - `SignupSuccessPanel @ src/components/auth/SignupSuccessPanel.tsx:22`

**LOGIN: formularze auth w CMS (bloki + widget)** — linie 96,4%, funkcje 68/79 (86,1%), plików 3 (bez pokrycia: 0), LOC 363

> Bez ani jednego wywołania: **11 funkcji** (0 nazwanych, 11 anonimowych domknięć).

**LOGIN: MFA (2FA)** — linie 100,0%, funkcje 13/14 (92,9%), plików 2 (bez pokrycia: 0), LOC 44

> Bez ani jednego wywołania: **1 funkcji** (0 nazwanych, 1 anonimowych domknięć).

**LOGIN: ochrona przed brute force** — linie 100,0%, funkcje 9/9 (100,0%), plików 1 (bez pokrycia: 0), LOC 54

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

**LOGIN: reset hasła** — linie 100,0%, funkcje 16/16 (100,0%), plików 1 (bez pokrycia: 0), LOC 52

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

---

## 5. Zera: gdzie test nie dotarł wcale

### 5.1 Największe pliki produkcyjne z pokryciem 0%

| Plik                                                           | LOC mierzone | Moduł                                              |
| -------------------------------------------------------------- | -----------: | -------------------------------------------------- |
| `src/routes/admin.podcasts.tsx`                                |          337 | M7                                                 |
| `src/routes/admin.names.tsx`                                   |          296 | M19                                                |
| `src/routes/admin.users.index.tsx`                             |          275 | M19                                                |
| `src/routes/admin.research-programs.tsx`                       |          249 | M7                                                 |
| `src/lib/admin/invitations.functions.ts`                       |          245 | M19                                                |
| `src/components/admin/blocks/BlockCanvas.tsx`                  |          218 | M3                                                 |
| `src/routes/$.tsx`                                             |          213 | M20                                                |
| `src/components/admin/TrendingTickerPane.tsx`                  |          195 | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły |
| `src/routes/admin.tracker.tsx`                                 |          188 | M7                                                 |
| `src/routes/admin.organizations.$id.tsx`                       |          187 | M19                                                |
| `src/routes/admin.users.$id.tsx`                               |          169 | M19                                                |
| `src/components/admin/blocks/edit/Paragraph.tsx`               |          167 | M3                                                 |
| `src/components/admin/analytics/GscBiDashboard.tsx`            |          163 | M17                                                |
| `src/components/chat/ChatComposer.tsx`                         |          160 | M9                                                 |
| `src/routes/admin.ads.tsx`                                     |          158 | M14                                                |
| `src/routes/admin.paywall.tsx`                                 |          153 | M20                                                |
| `src/lib/server/publishedContent.server.ts`                    |          151 | M20                                                |
| `src/routes/admin.hiring.tsx`                                  |          148 | M21                                                |
| `src/routes/profile.security.tsx`                              |          147 | M15                                                |
| `src/components/notifications/NotificationsCenter.tsx`         |          146 | M12                                                |
| `src/components/admin/WordPressImportDialog.tsx`               |          142 | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły |
| `src/components/admin/WxrUploadPanel.tsx`                      |          140 | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły |
| `src/lib/wp-import.functions.ts`                               |          137 | M3                                                 |
| `src/routes/__root.tsx`                                        |          126 | M20                                                |
| `src/routes/admin.community.qa.tsx`                            |          122 | M16                                                |
| `src/routes/admin.programs.tsx`                                |          122 | M7                                                 |
| `src/routes/admin.integrations.tsx`                            |          118 | M19                                                |
| `src/components/admin/analytics/Ga4BiDashboard.tsx`            |          116 | M17                                                |
| `src/lib/server/wp-media.server.ts`                            |          116 | M20                                                |
| `src/routes/reading-list.tsx`                                  |          116 | M20                                                |
| `src/routes/profile.personality.tsx`                           |          112 | M15                                                |
| `src/routes/admin.coupons.index.tsx`                           |          111 | M14                                                |
| `src/components/admin/analytics/RelatedPostsAnalytics.tsx`     |          111 | M17                                                |
| `src/routes/admin.live-blog.tsx`                               |          110 | M7                                                 |
| `src/routes/events.$slug.tsx`                                  |          110 | M7                                                 |
| `src/routes/author.$slug.tsx`                                  |          109 | M15                                                |
| `src/routes/admin.careers.tsx`                                 |          109 | M21                                                |
| `src/routes/admin.gifting.tsx`                                 |          108 | M14                                                |
| `src/components/admin/blocks/molecules/NestedBlocksEditor.tsx` |          107 | M3                                                 |
| `src/components/share/FloatingShareBar.tsx`                    |          106 | M8                                                 |

Łącznie plików produkcyjnych z pokryciem **0%: 542** z 2 771 (19,56%).

### 5.2 Katalogi bez ANI JEDNEGO pliku testowego

Sygnał niezależny od pokrycia: katalog może mieć pokrycie z testu innego katalogu, ale nie ma
testu WŁASNEGO — czyli nikt nie testuje go wprost. Takich katalogów jest **72**,
obejmują **107 plików / 28 549 linii**.

| Katalog                                          | Plików |   LOC |
| ------------------------------------------------ | -----: | ----: |
| `src/lib/locale`                                 |      2 | 4 544 |
| `src/components/admin/ThemeOptionsPane.tsx`      |      1 | 1 898 |
| `src/components/admin/GlobalColorsEditor.tsx`    |      1 | 1 479 |
| `src/components/share`                           |      2 | 1 366 |
| `src/components/admin/TrendingTickerPane.tsx`    |      1 | 1 139 |
| `src/components/newsletter`                      |      2 |   956 |
| `src/components/admin/PostSettingsMetabox.tsx`   |      1 |   878 |
| `src/lib/content-model`                          |      7 |   789 |
| `src/components/admin/settings`                  |      4 |   670 |
| `src/components/author`                          |      2 |   664 |
| `src/components/admin/AdminShell.tsx`            |      1 |   656 |
| `src/components/admin/PostGeneralOverview.tsx`   |      1 |   627 |
| `src/components/admin/ThemeFontSizesPane.tsx`    |      1 |   602 |
| `src/lib/cookieBanner`                           |      2 |   574 |
| `src/components/admin/WordPressImportDialog.tsx` |      1 |   573 |
| `src/components/patterns`                        |      1 |   548 |
| `src/components/admin/WxrUploadPanel.tsx`        |      1 |   512 |
| `src/components/admin/atoms`                     |      7 |   460 |
| `src/start.ts/(root)`                            |      1 |   454 |
| `src/components/maps`                            |      1 |   451 |
| `src/utils/(root)`                               |      1 |   444 |
| `src/components/admin/users`                     |      2 |   434 |
| `src/components/admin/AccessSettingsPane.tsx`    |      1 |   407 |
| `src/components/admin/performance`               |      1 |   350 |
| `src/components/composer`                        |      1 |   310 |
| `src/components/admin/ThemeBackgroundsPane.tsx`  |      1 |   305 |
| `src/components/admin/ExpertLayoutPreview.tsx`   |      1 |   287 |
| `src/components/admin/podcasts`                  |      2 |   284 |
| `src/components/admin/AudioPicker.tsx`           |      1 |   282 |
| `src/components/admin/RelatedLayoutPreview.tsx`  |      1 |   241 |

### 5.3 Dwie ścieżki importu WordPressa — przetestowano jedną

To najciekawsze znalezisko tego wydania i wychodzi wyłącznie z zestawienia zer z nazwami plików.
Repo ma DWIE niezależne implementacje importu z WordPressa o łudząco podobnych nazwach:

| Plik                                    |      Linie |   Funkcje | LOC mierz. | Kto tego używa                                                       |
| --------------------------------------- | ---------: | --------: | ---------: | -------------------------------------------------------------------- |
| `src/lib/wordpress-import.functions.ts` | **99,28%** |  **100%** |        280 | `routes/admin.import-wordpress.tsx`, `lib/server/wp-media.server.ts` |
| `src/lib/wp-import.functions.ts`        |     **0%** |    **0%** |        137 | `WordPressImportDialog.tsx`, `WordPressPreviewDialog.tsx`            |
| `src/lib/wp-import/wxr.ts`              |     **0%** |    **0%** |        105 | `WxrUploadPanel.tsx` (parser pliku WXR)                              |
| `src/lib/wp-import/elementor.ts`        |  **3,28%** | **2,43%** |        152 | konwersja treści WP → widgety buildera                               |
| `src/lib/wp-import/buildPage.ts`        |     62,50% |      100% |         24 | budowa strony docelowej                                              |
| `src/lib/wp-import/convert.ts`          |     75,00% |    75,00% |         28 | konwersja bloków                                                     |
| `src/lib/wp-import/localizedMerge.ts`   |       100% |      100% |         42 | scalanie wersji językowych                                           |

Zadanie domykające builder podniosło `wordpress-import.functions.ts` z 0% na 99,28% — i raport
wdrożenia uczciwie raportuje tę powierzchnię jako „osiągnięty”. Problem jest w ZAKRESIE, nie
w wykonaniu: **to jest wina mojego promptu**, który wskazał tę jedną ścieżkę z nazwy i nie sprawdził,
czy nie ma drugiej. Druga jest większa (394 zmierzone linie w trzech plikach na 0–3,3%) i wpięta
w DIALOGI panelu, czyli w ścieżkę, którą administrator faktycznie klika: wgranie pliku WXR →
parsowanie → konwersja na widgety Elementora.

Ryzyko jest tej samej klasy, co defekt `slugify` znaleziony w tym samym zadaniu (rozdz. 7.2): import
uruchamia się raz, na dużej ilości treści, i nikt nie weryfikuje wyniku ręcznie wpis po wpisie. Błąd
w parserze WXR albo w konwersji do Elementora jest cichy i masowy. Do tego `elementor.ts` na 3,28%
to najgorszy pojedynczy plik tej klasy w repo.

Wniosek metodologiczny, szerszy niż ten jeden przypadek: **zakres zadania testowego nie może być
listą nazw plików.** Musi być listą ŚCIEŻEK UŻYTKOWNIKA — „import z WordPressa” obejmuje obie
implementacje, a nazwa pliku o tym nie mówi. Kolejne prompty modułowe dostają z tego poprawkę:
przed rozpoczęciem trzeba wyszukać wszystkie implementacje danej funkcji, nie ufać jednej nazwie.

---

## 6. Które powierzchnie mają BRAMKĘ pokrycia (a które tylko liczbę)

Liczba bez bramki gnije: pokrycie spada z każdym mergem, którego nikt nie mierzy. Repo ma
**1 próg globalny + 225 progów per-ścieżka** w `vitest.config.ts`, egzekwowanych w CI krokiem
`Test + coverage gate` (`.github/workflows/ci.yml`).

| Moduł                                 | Progów per-ścieżka | Mediana progu linii | Najwyższy próg linii |
| ------------------------------------- | -----------------: | ------------------: | -------------------: |
| M11                                   |                 65 |                  98 |                  100 |
| M1                                    |                 26 |                 100 |                  100 |
| M2                                    |                 21 |                 100 |                  100 |
| M13                                   |                 18 |                 100 |                  100 |
| M3                                    |                 17 |                  98 |                  100 |
| M15                                   |                 15 |                 100 |                  100 |
| M20                                   |                 11 |                 100 |                  100 |
| M16                                   |                 11 |                  99 |                  100 |
| M9                                    |                  9 |                  96 |                  100 |
| M17                                   |                  8 |                 100 |                  100 |
| M19                                   |                  8 |                 100 |                  100 |
| M6                                    |                  8 |                 100 |                  100 |
| M8                                    |                  2 |                 100 |                  100 |
| powłoka panelu admin + atomy/molekuły |                  2 |                 100 |                  100 |
| M10                                   |                  2 |                  98 |                   98 |
| M18                                   |                  1 |                  98 |                   98 |
| M7                                    |                  1 |                 100 |                  100 |

Z tego **53 progów obejmuje CAŁE POWIERZCHNIE** (wzorzec `/**`), a nie pojedyncze pliki —
to one decydują, czy nowy plik dołożony do katalogu automatycznie podlega bramce:

| Powierzchnia                                      | Instr. | Gał. | Funkcje | Linie | Moduł                                 |
| ------------------------------------------------- | -----: | ---: | ------: | ----: | ------------------------------------- |
| `src/components/builder/organisms/widget-view/**` |     95 |   87 |      94 |    97 | M3                                    |
| `src/components/admin/builder/**`                 |     94 |   91 |      93 |    95 | M3                                    |
| `src/lib/blocks/**`                               |     96 |   91 |      97 |    97 | M3                                    |
| `src/components/blocks/**`                        |     95 |   91 |      92 |    96 | M3                                    |
| `src/lib/sidebarBuilder/**`                       |     98 |   96 |     100 |    98 | M3                                    |
| `src/components/admin/sidebarBuilder/**`          |     97 |   95 |      98 |    98 | M3                                    |
| `src/components/billing/atoms/**`                 |    100 |   95 |     100 |   100 | M13                                   |
| `src/components/billing/molecules/**`             |     95 |   82 |      98 |    96 | M13                                   |
| `src/components/billing/organisms/**`             |     89 |   85 |      89 |    91 | M13                                   |
| `src/components/pricing/atoms/**`                 |    100 |   80 |     100 |   100 | M13                                   |
| `src/components/pricing/molecules/**`             |     98 |   94 |     100 |   100 | M13                                   |
| `src/components/pricing/organisms/**`             |     92 |   90 |      88 |    95 | M13                                   |
| `src/components/membership-join/**`               |     94 |   82 |      92 |    95 | M13                                   |
| `src/components/admin/billing/**`                 |     95 |   87 |      96 |    97 | M13                                   |
| `src/components/admin/pricing/**`                 |     94 |   89 |      95 |    96 | M13                                   |
| `src/components/admin/membership/**`              |     91 |   85 |      90 |    94 | powłoka panelu admin + atomy/molekuły |
| `src/lib/pricing/**`                              |     96 |   89 |      92 |    95 | M13                                   |
| `src/lib/retention/**`                            |     98 |   95 |      98 |    98 | M15                                   |
| `src/lib/network/**`                              |     85 |   65 |      95 |    95 | M10                                   |
| `src/components/network/**`                       |     97 |   92 |      98 |    98 | M10                                   |
| `src/lib/profile/**`                              |     81 |   75 |      81 |    81 | M15                                   |
| `src/components/profile/**`                       |     85 |   82 |      74 |    87 | M15                                   |
| `src/lib/chat/**`                                 |     74 |   67 |      80 |    77 | M9                                    |
| `src/components/chat/**`                          |     40 |   34 |      36 |    41 | M9                                    |
| `src/lib/email/**`                                |     74 |   61 |      79 |    74 | M11                                   |
| `src/lib/newsletter/**`                           |     79 |   75 |      84 |    80 | M11                                   |
| `src/components/popups/**`                        |     94 |   80 |     100 |    97 | M11                                   |
| `src/components/admin/popups/**`                  |     95 |   85 |      95 |    95 | M11                                   |
| `src/components/admin/newsletter/**`              |     95 |   85 |      95 |    95 | M11                                   |
| `src/lib/search/**`                               |     92 |   84 |      94 |    94 | M6                                    |
| `src/components/search/**`                        |     94 |   89 |      94 |    94 | M6                                    |
| `src/components/admin/post-editor/lib/**`         |     95 |   94 |      95 |    95 | M2                                    |
| `src/components/admin/post-editor/hooks/**`       |     94 |   89 |      96 |    95 | M2                                    |
| `src/components/admin/post-editor/atoms/**`       |     88 |   89 |      85 |    87 | M2                                    |
| `src/lib/revisions/**`                            |    100 |  100 |     100 |   100 | M2                                    |
| `src/components/admin/versions/lib/**`            |    100 |  100 |     100 |   100 | M2                                    |
| `src/components/admin/workflows/lib/**`           |    100 |  100 |     100 |   100 | M2                                    |
| `src/components/admin/post-editor/molecules/**`   |     23 |   22 |      26 |    23 | M2                                    |
| `src/components/admin/workflows/**`               |     45 |   27 |      50 |    45 | M2                                    |
| `src/components/admin/versions/**`                |      7 |    9 |       8 |     7 | M2                                    |
| `src/components/admin/postExperience/**`          |    100 |   95 |     100 |   100 | powłoka panelu admin + atomy/molekuły |
| `src/components/post/**`                          |     80 |   66 |      72 |    84 | M1                                    |
| `src/components/audio/**`                         |     62 |   77 |      48 |    64 | M1                                    |
| `src/components/post/atoms/**`                    |    100 |   90 |     100 |   100 | M1                                    |
| `src/components/audio/atoms/**`                   |    100 |   90 |     100 |   100 | M1                                    |
| `src/components/clubs/atoms/**`                   |     99 |   98 |      99 |    99 | M16                                   |
| `src/components/clubs/molecules/**`               |     98 |   98 |      99 |    99 | M16                                   |
| `src/components/clubs/organisms/**`               |     98 |   98 |      98 |    98 | M16                                   |
| `src/components/admin/clubs/**`                   |     98 |   96 |      99 |    99 | M16                                   |
| `src/components/admin/clubs/atoms/**`             |    100 |   99 |     100 |   100 | M16                                   |
| `src/components/admin/clubs/molecules/**`         |     99 |   99 |     100 |   100 | M16                                   |
| `src/components/admin/clubs/organisms/**`         |     98 |   96 |      99 |    99 | M16                                   |
| `src/lib/clubs/**`                                |     92 |   89 |      93 |    92 | M16                                   |

**Czego bramka NIE pilnuje** — moduły bez ani jednego progu per-ścieżka:

- **MODUŁ 4 — Strony, wygląd, motyw, media, import**: linie 92,26%, funkcje 88,89%, plików 0%: 6/132
- **MODUŁ 5 — Strona główna, archiwa, chrome**: linie 96,15%, funkcje 93,15%, plików 0%: 1/54
- **MODUŁ 12 — Realtime / powiadomienia / web-push**: linie 47,98%, funkcje 43,97%, plików 0%: 13/28
- **MODUŁ 14 — Monetyzacja: kupony / darowizny / prezenty / reklamy**: linie 26,16%, funkcje 17,47%, plików 0%: 16/38
- **MODUŁ 21 — Rekrutacja / kariera**: linie 55,12%, funkcje 47,13%, plików 0%: 12/29

### 6.1 Próg ustawiony POWYŻEJ rzeczywistości to bramka WYŁĄCZONA

Między wydaniem 2 i 3 repo dostarczyło pomiar, który należy do tego rozdziału, bo pokazuje,
że bramka pokrycia ma tryb awarii GORSZY niż brak bramki.

Cztery progi per-ścieżka w `src/lib/billing` (`membership.ts`, `diagnostics.server.ts`,
`portalLink.server.ts`, `queries.ts`) były ustawione WYŻEJ, niż kiedykolwiek zmierzone pokrycie
tych plików. Skutek, wprost z commita naprawiającego: `main` nie miał zielonego CI przez
**60 kolejnych przebiegów** (2026-08-16T17:53Z → 2026-08-19T15:37Z: 42 failure, 17 cancelled,
zero success). Koszt nie skończył się na tym kroku — **osiem bramek stojących ZA nim nie
uruchomiło się w tym okresie ANI RAZU**: Build, budżet bundle, acykliczność grafu chunków,
parytet i18n, wierność widgetów, macierz uprawnień, kontrakt SEO oraz ścieżka bootowania bez SDK
płatności. Wszystkie schodziły jako `skipped`, bo krok przed nimi padał wcześniej.

Wartości po re-floorze do POMIARU (48855ac): `membership.ts` instr. 100 → **98,86**, gał. 95 →
**93,65**; `diagnostics.server.ts` gał. 92 → **91,11**; `portalLink.server.ts` instr. 95 →
**93,75**, linie → **92,59**; `queries.ts` instr. **95,52**, gał. **80,55**.

To ta sama klasa awarii co `reportOnFailure: false` z rozdz. 9.3 wydania 1: **bramka milczy
dokładnie wtedy, kiedy jest potrzebna.** Różnica jest w kierunku — tam czerwony test ukrywał
pomiar, tu aspiracyjny próg ukrywał osiem innych bramek. W obu przypadkach nikt nie został
wprowadzony w błąd przez liczbę: nikt nie dostał żadnej liczby.

Reguła, która z tego wynika: **próg jest przyrządem pomiarowym, nie aspiracją.** Próg ustawiony
powyżej pomiaru nie podnosi pokrycia — wyłącza krok i wszystko, co za nim stoi. Aspiracja należy
do komentarza („cel 95%, zmierzone 80,55%, droga tam: testy X”), a sam próg 1–2 pp pod pomiarem.

I nota, którą repo zapisało samo o sobie: re-floor jest odstępstwem od zasady „progi wolno tylko
podnosić”. Commit to przyznaje i dodaje, że powtarzanie go zamiast pracy testowej to już „gaszenie
sygnału”. Ten audyt się z tym zgadza i zapisuje `queries.ts` — gałęzie **80,55%** — jako dług do
spłacenia testami, nie kolejnym re-floorem.

---

## 7. Pięć warstw testów — co która realnie pokrywa

| Warstwa                                      | Rozmiar                                     | Co dowodzi                                                                   | Czego NIE dowodzi                                                                 |
| -------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Jednostkowe / komponentowe (vitest)          | 1 423 plików, 25 835 testów, 50 263 asercji | logikę w TS/TSX, render komponentów, kontrakty modułów                       | zachowania bazy (RLS/RPC/triggery), realnych ścieżek przeglądarki, SSR end-to-end |
| Baza (pgTAP)                                 | 97 plików, 1 812 asercji                    | izolację tenanta, polityki RLS, kontrakty RPC, triggery                      | kodu frontu — v8 tego pokrycia NIE liczy                                          |
| E2E (Playwright)                             | 7 plików, 42 testów                         | ścieżki użytkownika, SSR, SEO, checkout                                      | pokrycia jednostkowego (osobny proces, nie wchodzi do %)                          |
| Bramki statyczne (`check:*`)                 | 33 skryptów                                 | kontrakty struktury (SQL, i18n, warstwy, bundle)                             | wykonania kodu                                                                    |
| Inwarianty na ŻYWEJ bazie (vitest + sekrety) | 2 pliki, 50 testów                          | zgodność schematu bazy z typami i parytet języków w DANYCH, nie w słownikach | niczego bez sekretów — bez `VITE_SUPABASE_URL` pomijają się same                  |

To jest źródło pozornej sprzeczności: MODUŁ z ~20% pokrycia jednostkowego może być jednym
z najlepiej zabezpieczonych w systemie, jeśli jego reguły siedzą w bazie i mają pgTAP.

Piąta warstwa jest w tym zestawieniu nowa, bo dopiero ten przebieg pokazał ją wprost: dwa pliki
w `src/__tests__/` (`db-schema-invariant`, `lang-parity`) uruchamiają się TYLKO z sekretami Supabase.
W sandboksie audytu zeszły jako `skipped`, na CI się wykonują — i sprawdzają rzecz, której nie
sprawdza żadna z pozostałych czterech: czy wygenerowane typy nadal opisują schemat, który baza ma
NAPRAWDĘ. To rodzaj testu, który nie chroni użytkownika, a programistę — od pisania kodu przeciw
nieaktualnemu obrazowi bazy.

### 7.1 Rodzaje testów w suicie jednostkowej — i dlaczego rodzaj waży więcej niż liczba

Procent pokrycia odpowiada na pytanie „czy ta linia się wykonała”. Nie odpowiada na pytanie
„co zostało dowiedzione”. Odpowiada na nie RODZAJ testu — i dlatego dwa moduły z identycznym
pokryciem mogą mieć zupełnie inne ryzyko. Klasyfikacja poniżej powstała ze skanu treści
wszystkich plików testowych (sygnały: `renderHook`, `@testing-library/react`, `supabaseFromStub`,
`axe`, `createServerFn`, nazwy `*.gate.*`, `*.invariant.*`, `*Parity*`).

| Rodzaj testu                               | Plików | Testów | Asercji | As./test | Co DOWODZI                                                                                    | Czego NIE dowodzi                                                        |
| ------------------------------------------ | -----: | -----: | ------: | -------: | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| komponentowy (render + interakcja)         |    562 | 11 927 |  23 524 |     1,97 | że użytkownik to zobaczy: treść, stan wyłączony, komunikat błędu, reakcja na kliknięcie       | zachowania na prawdziwej przeglądarce i prawdziwych danych z bazy        |
| jednostkowy (czysta reguła)                |    624 |  9 082 |  17 364 |     1,91 | reguły w izolacji: wejście → wyjście, przypadki graniczne, gałęzie warunków                   | że reguła jest w ogóle wywołana przez aplikację (poprawnego okablowania) |
| warstwy danych (atrapa PostgREST)          |     47 |  1 590 |   2 842 |     1,79 | kształtu zapytania: filtry, kolejność ogniw, limit, zachowanie przy błędzie PostgREST         | że polityka RLS na serwerze przepuści to zapytanie                       |
| hooka (renderHook)                         |     69 |  1 544 |   2 959 |     1,92 | cyklu życia i unieważniania cache: kolejność efektów, sprzątanie, ponowne pobranie po mutacji | wyglądu; hook może być poprawny, a widok nadal pokazywać stare dane      |
| funkcji serwerowej                         |     65 |  1 151 |   2 449 |     2,13 | bramek wykonania: tenant, uprawnienia, rate limit, audyt, ścieżka błędu                       | że klient wywoła funkcję w odpowiednim momencie                          |
| dostępności (axe)                          |     14 |    247 |     561 |     2,27 | kontraktu dostępności: role, etykiety, kolejność fokusu, brak naruszeń axe                    | sensu treści dla czytnika ekranu (to ocenia człowiek)                    |
| parytetu (dwa artefakty muszą się zgadzać) |     18 |    125 |     264 |     2,11 | ZGODNOŚCI DWÓCH ARTEFAKTÓW (panel ⇄ renderer, snapshot ⇄ migracje, PL ⇄ EN)                   | poprawności żadnej ze stron osobno — tylko tego, że się nie rozjechały   |
| bramki (meta-inwariant CI)                 |     16 |    115 |     187 |     1,63 | meta-inwariantu repo: że bramka istnieje, jest wpięta i coś sprawdza                          | zachowania kodu produkcyjnego                                            |
| inwariantu (nie wolno złamać reguły)       |      4 |     39 |      83 |     2,13 | że reguła nie została złamana NIGDZIE w repo — skaluje się z kodem, nie z przypadkiem         | poprawności pojedynczej ścieżki użytkownika                              |
| dymny (czy w ogóle stoi)                   |      3 |     13 |      26 |     2,00 | że powierzchnia wstaje i nie rzuca przy montażu                                               | niczego o zachowaniu — to detektor katastrofy, nie dowód                 |
| integracyjny (wiele warstw)                |      1 |      2 |       4 |     2,00 | współpracy kilku warstw naraz na jednym scenariuszu                                           | izolowanej przyczyny awarii — po padnięciu trzeba szukać dalej           |

**Sześć wniosków, które wynikają z tej tabeli, a nie z procentów:**

1. **Test jednostkowy jest najtańszy i najsłabszy jednocześnie.** Dowodzi reguły, ale przechodzi
   również wtedy, gdy nikt tej reguły nie wywołuje. Wydanie 1 tego audytu znalazło dwa takie
   przypadki: `lib/podcast/types.ts` miał test, a jego helpery etykiet zero wywołań; katalog
   wyszukiwarki miał `SearchAutosuggest.test.tsx` przy komponencie na 0%. Oba są dziś na 100%
   (14/14 i 19/19 funkcji) — czyli defekt był realny, a wskaźnikiem, który go pokazał, był NIE procent
   linii, a wymiar „funkcje wywołane”. Dlatego liczba testów bez tego wymiaru pozostaje myląca.
2. **Test komponentowy jest jedynym dowodem tego, co widzi użytkownik.** Reguła może być poprawna,
   a interfejs pokazać „anulowano”, gdy żądanie padło. Powierzchnie, na których błąd ma konsekwencje
   poza kodem (rezygnacja z subskrypcji, import danych osobowych, moderacja), wymagają tego rodzaju
   testu niezależnie od tego, jak dobrze przetestowane są ich reguły.
3. **Test parytetu ma inną ekonomię niż wszystkie pozostałe.** Jeden test parytetu panel ⇄ renderer
   pilnuje kompletu typów widgetów; jeden test parytetu snapshotu autoryzacji pilnuje wszystkich
   migracji, które kiedykolwiek powstaną. Nie zastępuje testów obu stron, ale wykrywa jedyną klasę
   defektu, której one nie widzą: dryf.
4. **pgTAP i e2e nie są „lepszym” pokryciem — są pokryciem czegoś innego.** RLS można złamać bez
   zmiany jednej linii TypeScriptu, a SSR może wysłać inny HTML niż ten, który zwraca funkcja
   budująca `<head>`. Dlatego moduł SEO opiera się na e2e, a moduł klubów na pgTAP — i w obu
   przypadkach niski procent jednostkowy nie oznacza braku zapory.
5. **Gęstość asercji jest stabilna (~2 na test) i to dobry znak.** Wyjątkiem są bramki (1,66) —
   tam jeden test często sprawdza jeden inwariant, co jest poprawne. Gdyby ta liczba spadła poniżej 1,
   znaczyłoby to powrót testów renderujących bez dowodu, czyli warstwy, którą repo raz już usunęło.
6. **Bramka jest rodzajem testu — i ma najgorszy tryb awarii z całej listy.** Test jednostkowy,
   który padnie, zgłasza jedną regułę. Bramka, która padnie z powodu nieosiągalnego progu, kasuje
   sygnał ze WSZYSTKICH bramek stojących za nią w tym samym kroku CI — zmierzone na tym repo:
   60 przebiegów `main` bez zieleni i osiem bramek jako `skipped` (rozdz. 6.1). Rodzaj testu
   decyduje więc nie tylko o tym, CO zostaje dowiedzione, ale i o tym, co jeszcze przestaje być
   sprawdzane, kiedy ten jeden zawiedzie.

Do tego dochodzą rodzaje, których v8 nie widzi wcale: **pgTAP** (97 plików) dowodzi
polityk i triggerów, **Playwright** (7 plików) ścieżek użytkownika i realnego SSR,
a **bramki skryptowe `check:*`** (33) kontraktów strukturalnych, w których nie ma
kodu do wykonania — na przykład tego, że każda bramka jest wpięta w workflow.

### 7.2 Czego rodzaj testu faktycznie dowiódł: 24 defekty produkcyjne w dwa dni

Rozdział 7.1 argumentuje teoretycznie, że rodzaj testu waży więcej niż liczba. Te dwa dni dały
do tego dowód empiryczny — z tego repozytorium, nie z podręcznika. Domknięcie CMS buildera
(2026-08-20) i klubów (2026-08-21) dodało 186 plików testowych i przy okazji odsłoniło
**24 defekty produkcyjne**. Każdy jest zapisany jako `it.fails` z opisem, produkcji NIE ruszono.
Sprawdziłem to niezależnie: **24 wywołania `it.fails(` w 20 plikach**, zero `it.skip` i zero
`it.todo` w całym repo. Sam przebieg raportuje **36 przypadków „expected fail”** — to te same
24 defekty po rozwinięciu `it.each`, nie 36 osobnych błędów. Dwie nieścisłości w raportach zespołu,
które pomiar rozstrzyga: raport klubowy pisze „wszystkie 12 expected fail w całej suicie” (zaniża
o tuzin z buildera), a jego licznik testów 26 607 nie zgadza się z komentarzem w configu z 20.08
(29 312) — dziś jest 34 131. Merytorycznie oba raporty zgadzają się z pomiarem.

Liczba jest mniej ważna niż to, JAKIE to defekty i jaki rodzaj testu je wyłapał:

| Klasa defektu                           | Ile | Przykład z repo                                                                                                                                                                                           | Rodzaj testu, który go znalazł                                |
| --------------------------------------- | --: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Bezpieczeństwo**                      |   1 | `sanitizeHtml`: prefiks `<script>…</script>` przed ładunkiem przepuszcza handler `on*=`                                                                                                                   | jednostkowy nad czystą funkcją                                |
| **Zgodność / RODO**                     |   1 | `ContactFormView`: brak komunikatu przy niezaznaczonej wymaganej zgodzie                                                                                                                                  | komponentowy z interakcją                                     |
| **Cicha utrata lub duplikacja danych**  |   2 | `slugify` nie transliteruje `ł` (`Łódź` → `odz`) — duplikacja adresów przy imporcie; `blocks/migrate` gubi `iframe` i `img` bez śladu                                                                     | jednostkowy nad czystą funkcją                                |
| **Awaria nieodróżnialna od pustki**     |   3 | awaria RPC archiwum klubu, skrzynki zgłoszeń i katalogu słownika wygląda identycznie jak brak danych                                                                                                      | komponentowy, wzorzec „trzy stany”: pełny / pusty / częściowy |
| **Czytanie z prototypu obiektu**        |   2 | `getBlockVariants` i `clubThreadTone`: `constructor` staje się prawidłowym wariantem albo rodzajem wątku                                                                                                  | jednostkowy z przypadkiem granicznym                          |
| **Dostępność**                          |   1 | szyna sekcji klubu przeskakuje z `<h1>` na `<h3>` — złamana kolejność nagłówków                                                                                                                           | komponentowy z asercją a11y                                   |
| **Martwy głęboki link**                 |   1 | `?reply=1` z wklejonego adresu nie dociera do widoku                                                                                                                                                      | test trasy (`validateSearch`)                                 |
| **Widoczny „Invalid Date”**             |   3 | `TemplateHistoryDialog`, `LiveBlogBlock`, kadencja w rosterze admina (ta rzuca wyjątkiem)                                                                                                                 | jednostkowy + komponentowy                                    |
| **Utrata wartości przy edycji**         |   4 | wyczyszczone pole startuje od zera, nie od wartości dokumentu (`ClampedNumberInput`, `HoverControl`); „Przywróć” zjadane przez rehydrację; wyjście z trybu „cały dzień” gubi godzinę                      | komponentowy z interakcją                                     |
| **Reszta (stan, klucze i18n, warunki)** |   6 | dialog nie czyści wybranego tematu; ostrzeżenie o zmianie sluga używa klucza podpowiedzi; warunek `!== null` na kolumnie NOT NULL; podpis ginie przy wklejaniu z Worda; brak spadku tytułu na drugi język | komponentowy i jednostkowy                                    |

**Trzy wnioski, których nie da się wyczytać z procentów:**

1. **Żaden z tych 24 defektów nie jest egzotyczny.** To rzeczy, które spotyka czytelnik, redaktor
   albo administrator: pusty ekran zamiast komunikatu o awarii, „Invalid Date”, zgubiona godzina
   wydarzenia, zduplikowany adres po imporcie. Wszystkie siedziały w produkcji na powierzchniach,
   które przed tymi dwoma dniami miały 0–30% pokrycia. Nie znalazło ich review ani klikanie.
2. **Klasa „awaria wygląda jak pustka” to najgroźniejsza z całej listy** i wykrywa ją dokładnie
   jeden rodzaj testu: komponentowy z rozdzieleniem stanu pustego od stanu błędu. Test jednostkowy
   reguły przechodzi, bo reguła jest poprawna; użytkownik i tak widzi „nic tu nie ma” zamiast
   „nie udało się wczytać”. Trzy niezależne wystąpienia tego samego wzorca w jednym module
   znaczą, że to nie wypadek, a brak konwencji.
3. **Dyscyplina „nie ruszaj produkcji, żeby test przeszedł” zadziałała.** 24 defekty są zapisane,
   widoczne i zaświecą na czerwono w chwili naprawy — bo `it.fails` pada, kiedy test zaczyna
   przechodzić. To jest lepszy stan niż zielona suita z 24 nieznanymi błędami. Warunek: ktoś musi
   te `it.fails` faktycznie zamienić na naprawy, inaczej po miesiącu staną się tłem.

---

## 8. Wnioski: gdzie ryzyko jest największe

Ryzyko liczę jako BEZWZGLĘDNĄ liczbę niepokrytych linii, nie procent — 20% na module o 50 tys.
linii to większa dziura niż 20% na module o 5 tys.

| #   | Moduł                                                 | Linii niepokrytych | Linie % | Funkcje % | Testów |
| --- | ----------------------------------------------------- | -----------------: | ------: | --------: | -----: |
| 3   | Silniki treści: bloki + page builder                  |          **5 195** |  75,68% |    70,93% |  4 884 |
| 20  | Platforma / backend / infrastruktura / SSR            |          **3 916** |  55,12% |    42,82% |  2 408 |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |          **3 109** |  27,98% |    23,35% |    481 |
| 7   | Typy treści specjalne                                 |          **2 555** |  44,23% |    37,96% |  1 112 |
| 17  | Analityka i BI                                        |          **2 136** |  30,45% |    24,97% |    199 |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |          **1 728** |  66,32% |    76,36% |  1 562 |
| 15  | Profil i konto                                        |          **1 520** |  56,03% |    51,95% |    716 |
| 9   | Czat / komunikator                                    |          **1 229** |  62,22% |    57,74% |    607 |
| 16  | Społeczność: kluby, komentarze, moderacja             |          **1 159** |  86,18% |    85,95% |  4 746 |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |          **1 022** |  26,16% |    17,47% |     88 |

### 8.1 Rekomendacje — kolejność, nie lista życzeń

**R1. Podnieść pięć progów, które zostały po re-floorze — te pliki są dziś na 100%.**
Wydanie 3 zapisało obniżkę czterech progów w `billing` jako dług i wskazało adres: gałęzie
`lib/billing/queries.ts` na 80,55%. Dług jest spłacony w całości. Zmierzone teraz:
`billing/queries.ts`, `billing/membership.ts`, `billing/diagnostics.server.ts`,
`billing/portalLink.server.ts` i `retention/queries.ts` — **wszystkie pięć po 100% na wszystkich
czterech metrykach**. Progi w configu nadal stoją na wartościach re-floorowanych (queries.ts:
gałęzie 80,55, instrukcje 95,52). Podnieść je do 99/100 i dopisać w komentarzu, że odstępstwo
z 19.08 zostało zamknięte pracą testową, nie kolejną obniżką — bo dokładnie to zespół sobie
wtedy obiecał, a to jedyny sposób, żeby ta obietnica była widoczna w kodzie.

**R2. Domknąć DRUGĄ ścieżkę importu WordPressa — 394 linie na 0–3,3% (rozdz. 5.3).**
`lib/wp-import.functions.ts` **0%**, `lib/wp-import/wxr.ts` **0%**, `lib/wp-import/elementor.ts`
**3,28%** — przy `lib/wordpress-import.functions.ts` na 99,28%. To dwie niezależne implementacje
o podobnych nazwach; przetestowano tę wpiętą w trasę, nietestowana jest ta wpięta w DIALOGI panelu
(`WordPressImportDialog`, `WxrUploadPanel`, `WordPressPreviewDialog`), czyli w ścieżkę, którą
administrator faktycznie klika. Ryzyko tej samej klasy, co znaleziony w tym samym zadaniu defekt
`slugify`: import idzie raz, na dużej ilości treści, i nikt nie sprawdza wyniku wpis po wpisie.
Zakres na jedno zadanie: parser WXR (kompletność pól, encje, załączniki), konwersja WP → widgety
Elementora (`elementor.ts` jako najgorszy plik tej klasy w repo), scalanie wersji językowych.

**R3. Zamienić 24 `it.fails` na naprawy — inaczej po miesiącu staną się tłem.**
Praca domykająca zapisała 24 defekty produkcyjne jako `it.fails` (36 przypadków testowych po
rozwinięciu `it.each`) i to była właściwa decyzja: nie ruszać produkcji, żeby test przeszedł.
Ale `it.fails` jest zieloną kropką w raporcie. Kolejność napraw według konsekwencji, nie według
trudności: **obejście `sanitizeHtml`** przepuszczające handler `on*=` (to jest XSS w treści
renderowanej z bazy), **brak komunikatu przy niezaznaczonej zgodzie RODO** w `ContactFormView`,
**`slugify` bez transliteracji `ł`** (cicha duplikacja adresów przy imporcie), potem trzy
przypadki „awaria RPC wygląda jak brak danych”. Reszta to jakość, nie ryzyko.

**R4. MODUŁ 19 (uprawnienia, zgody, RODO) — teraz to najsłabszy punkt systemu bez konkurencji.**
28,00% linii, 23,26% funkcji, 56 z 130 plików na zerze, +0,5 pp od wydania 3 (szum). Z 186 nowych
plików testowych ten moduł nie dostał ANI JEDNEGO. Po domknięciu klubów i buildera nie ma już
większej dziury o porównywalnej konsekwencji: defekt w macierzy uprawnień, zgodach albo eksporcie
danych jest zdarzeniem prawnym, nie usterką. Rodzaj testu, który tu decyduje, jest inny niż
w dwóch domkniętych modułach: **inwariant i parytet** (snapshot bramek autoryzacji kontra migracje,
macierz kontra rejestr capabilities), bo zawężenia kręgu uprawnionych nie widzi żaden test
pojedynczej funkcji — każda z nich osobno działa poprawnie.

**R5. MODUŁ 3: zostało 5 195 niepokrytych linii i są skoncentrowane w edytorze bloków panelu.**
Sześć powierzchni buildera domknięto do 95/93, moduł urósł o 23,3 pp — i nadal jest największą
bezwzględną dziurą repo. Reszta jest nazwana i wąska: `components/admin/blocks/**` na zerze —
`BlockCanvas` (218 LOC), `edit/Paragraph` (167), `NestedBlocksEditor` (107), `SortableBlockItem`
(93), `edit/Heading` (92), `useBlockClipboard` (77), `AutoFootnotesPreview` (58). To ten sam typ
kodu, który w tym zadaniu podniesiono z 28,75% na 96,46% w `admin/builder/**`, więc metoda jest
znana i sprawdzona: wyprowadzić logikę z JSX-a do czystych modułów, potem testować powłoki.

**R6. MODUŁ 20 (platforma / SSR) — druga największa dziura i jedyna duża bez własnego podejścia.**
55,12% linii, 42,84% funkcji, 66 z 186 plików na zerze, 3 916 niepokrytych linii. Ten moduł nie
dostał jeszcze żadnego zadania domykającego, a utrzymuje meta-inwarianty, od których zależą
pozostałe bramki. Nowy `lib/preview/**` (heartbeat sesji) wszedł tu z 36,6% linii, czyli poniżej
średniej modułu — to znak, że powierzchnia dokłada kod szybciej, niż dokłada testy.

**R7. MODUŁ 14 (kupony / darowizny) — trzecie wydanie z rzędu bez ruchu, przy najniższym wymiarze funkcyjnym w repo.**
26,16% linii i **17,47% funkcji**, 16 z 38 plików na zerze, zero progów per-ścieżka. To 1 022 linie,
czyli jedna piąta długu modułu 3 — najtańsze domknięcie z całej listy i jedyne, które od 18 sierpnia
nie ruszyło się ani o pół punktu. Kupon i darowizna to transakcja: kwota, waluta, limit wykorzystań.

**R8. E2E nie urosło ani o jeden plik przy +186 plikach testów jednostkowych.**
Warstwy poza vitestem stoją w miejscu od pierwszego wydania: **7 plików Playwrighta / 42 testy,
97 plików pgTAP, 33 bramki `check:*`** — przy aplikacji, która w tym samym czasie urosła o 81 plików
produkcyjnych. To nie jest zarzut do pracy domykającej, bo jej zakres był jednostkowo-komponentowy.
To luka, której żadne z dotychczasowych zadań nie obejmowało: nie ma ani jednej pełnej ścieżki
end-to-end dla klubów, buildera ani newslettera. Rozdz. 7 wyjaśnia, czego te warstwy dowodzą
i czego vitest nie zastąpi: RLS można złamać bez zmiany jednej linii TypeScriptu, a SSR może
wysłać inny HTML niż ten, który zwraca funkcja budująca `<head>`.

### 8.2 Ocena: dobre, złe, beznadziejne — z argumentem, nie z widzimisię

Rozdziały 1–8 podają liczby. Ten podaje MOJĄ ocenę tych liczb, bo o to zapytano — z jawną rubryką,
żeby dała się sprawdzić i podważyć.

**Rubryka.** Baza oceny = **0,4 × linie% + 0,6 × funkcje%**. Funkcje ważą więcej, bo to metryka
ostrzejsza: liczy każdy handler i callback, więc trudniej ją ugrać renderem bez interakcji. Progi:
**wzorowo** ≥ 90, **dobrze** 75–90, **przeciętnie** 55–75, **źle** 35–55, **beznadziejnie** < 35.
Rubryka nie jest jednak wyrokiem — pod tabelą jest kolumna zastrzeżeń, w których sama liczba wprowadza
w błąd (słowniki i18n, kluby, monetyzacja), i tam ocenę koryguję z podaniem powodu.

| Ocena             | Baza | Moduł                                                     | Linie | Funkcje | Progów | Rodzajów testów | Plików 0% |
| ----------------- | ---: | --------------------------------------------------------- | ----: | ------: | -----: | --------------: | --------: |
| **wzorowo**       | 99,0 | 2. Edytor wpisów i workflow redakcyjny                    | 99,3% |   98,8% |     21 |               6 |     0/103 |
| **wzorowo**       | 98,7 | 18. CRM                                                   | 99,0% |   98,5% |      1 |               6 |      0/57 |
| **wzorowo**       | 96,1 | 6. Wyszukiwarka                                           | 97,4% |   95,2% |      8 |               5 |      0/24 |
| **wzorowo**       | 94,4 | 5. Strona główna, archiwa, chrome                         | 96,1% |   93,2% |      0 |               5 |      1/54 |
| **wzorowo**       | 90,2 | 4. Strony, wygląd, motyw, media, import                   | 92,3% |   88,9% |      0 |               6 |     6/132 |
| **dobrze**        | 86,0 | 16. Społeczność: kluby, komentarze, moderacja             | 86,2% |   85,9% |     11 |               8 |    22/317 |
| **dobrze**        | 82,2 | 11. Newsletter i e-mail                                   | 81,5% |   82,7% |     65 |               4 |    29/147 |
| **dobrze**        | 81,3 | 10. Sieć / networking                                     | 82,0% |   80,9% |      2 |               4 |      3/32 |
| **dobrze**        | 78,6 | 1. Wpisy: doświadczenie czytelnika                        | 80,9% |   77,1% |     26 |               4 |     13/86 |
| **przeciętnie**   | 74,9 | design system (components/ui)                             | 79,9% |   71,5% |      0 |               1 |      4/43 |
| **przeciętnie**   | 72,8 | 3. Silniki treści: bloki + page builder                   | 75,7% |   70,9% |     17 |               7 |    72/454 |
| **przeciętnie**   | 72,3 | 13. Monetyzacja: checkout / subskrypcje / billing         | 66,3% |   76,4% |     18 |               6 |    35/185 |
| **przeciętnie**   | 70,4 | słowniki i18n                                             | 92,5% |   55,6% |      0 |               2 |     1/118 |
| **przeciętnie**   | 59,5 | 9. Czat / komunikator                                     | 62,2% |   57,7% |      9 |               3 |     15/81 |
| **źle**           | 54,4 | 8. SEO, feedy, dane strukturalne                          | 56,1% |   53,3% |      2 |               3 |     23/74 |
| **źle**           | 53,6 | 15. Profil i konto                                        | 56,0% |   51,9% |     15 |               6 |     28/81 |
| **źle**           | 50,3 | 21. Rekrutacja / kariera                                  | 55,1% |   47,1% |      0 |               2 |     12/29 |
| **źle**           | 47,7 | 20. Platforma / backend / infrastruktura / SSR            | 55,1% |   42,8% |     11 |               6 |    66/186 |
| **źle**           | 45,6 | 12. Realtime / powiadomienia / web-push                   | 48,0% |   44,0% |      0 |               3 |     13/28 |
| **źle**           | 40,5 | 7. Typy treści specjalne                                  | 44,2% |   38,0% |      1 |               6 |    42/115 |
| **źle**           | 38,7 | powłoka panelu admin + atomy/molekuły                     | 40,8% |   37,4% |      0 |               4 |    36/172 |
| **beznadziejnie** | 27,2 | 17. Analityka i BI                                        | 30,4% |   25,0% |      8 |               3 |     49/85 |
| **beznadziejnie** | 25,2 | 19. Ustawienia / integracje / users / multi-tenant / RODO | 28,0% |   23,3% |      8 |               6 |    56/130 |
| **beznadziejnie** | 20,9 | 14. Monetyzacja: kupony / darowizny / prezenty / reklamy  | 26,2% |   17,5% |      0 |               2 |     16/38 |

Rozkład: **5** wzorowo · **4** dobrze · **5** przeciętnie · **7** źle · **3** beznadziejnie.

**Ocena całości: PRZECIĘTNIE — ale przy górnej krawędzi tej oceny i po realnej poprawie.**
Baza dla całego repo liczona tą samą rubryką: **65,7** (w wydaniu 3 było 53,4).
Rozbijam to na pięć osobnych ocen, bo jedna liczba tego nie opisuje:

1. **Poziom pokrycia — przeciętnie, ale już nie „średniactwo”.** 67,42% linii i 64,63% funkcji
   na 2 771 plikach produkcyjnych. W wydaniu 3 pisałem, że za „dobrze” uznam 75%+ linii przy
   żadnym module poniżej 60% — pierwszy warunek jest 7,6 pp od spełnienia, drugiego nie spełnia dziewięć
   modułów. Ale to już poziom, na którym średni refaktor przestaje być hazardem: 67% linii i 65% funkcji
   znaczy, że dwie trzecie zachowań aplikacji ktoś kiedykolwiek uruchomił w teście. Cztery dni temu
   była jedna trzecia.
2. **Rozkład — nadal źle, ale mierzalnie lepiej.** 10 z 24 powierzchni ma ocenę „źle”
   albo „beznadziejnie” (w wydaniu 3 było 12 z 24), a „beznadziejnie” spadło z czterech do 3.
   Zmiana nie wzięła się z równomiernego podnoszenia średniej, a z dwóch celowanych akcji: kluby
   z „beznadziejnie” (31,5) na „dobrze” (86,0), builder ze „źle” (44,2) na „przeciętnie” (72,8).
   To dowód, że model „jedno zadanie = jedna powierzchnia, z jawnym celem i progiem na końcu” działa
   — i że pozostałe trzy „beznadziejnie” to nie problem metody, a kolejki.
3. **Uczciwość pomiaru — dobrze, miejscami wzorowo.** `all: true` na całym `src/`, pliki bez testów
   w mianowniku, zero whitelistu. To repo ma za sobą epizod raportowania **98%** z 38 plików
   z pętlami renderującymi bez asercji — i sam ten epizod usunęło. Gęstość asercji
   1,95 na test, stabilna w każdym rodzaju testu, potwierdza, że dzisiejsze liczby nie są farmione.
4. **Infrastruktura dowodu — wzorowo.** 225 progów per-ścieżka, 33 bramek `check:*`
   (w tym META-bramka „bramka, która istnieje, musi się uruchamiać”), 97 plików pgTAP
   z 1 812 asercjami na RLS i RPC, klasyfikacja testów na jedenaście rodzajów. Większość projektów
   tej wielkości nie ma nawet połowy tego aparatu. To jest realny atut i on nie wynika z procentu.
5. **Zabezpieczenie dorobku — POPRAWIONE, ale niedokończone.** Próg globalny stoi
   9,4 pp pod pomiarem na liniach — tyle pokrycia można dziś stracić przy zielonym CI.
   Bez ANI JEDNEGO progu per-ścieżka jest 8 z 24 powierzchni, w tym 2
   z oceną „wzorowo”: MODUŁ 5 (96,1%), MODUŁ 4 (92,3%).
   Tam dorobek jest pożyczony: jeden PR bez testów zdejmie go, nie łamiąc żadnej bramki.
   Druga rzecz do domknięcia: pięć progów obniżonych 19.08 w `billing`/`retention` opisuje dziś
   dziurę, której już nie ma — wszystkie pięć plików jest na **100% we wszystkich czterech
   metrykach**, a próg `queries.ts` nadal notuje gałęzie 80,55%. Próg, który stoi 20 pp pod
   rzeczywistością, nie łapie regresji, tylko ją przepuszcza (poz. R1 w 8.1).

**Trajektoria zasługuje na osobne zdanie: super.** 32,71% → 67,42% linii w cztery dni, przy suicie
rosnącej z 817 do 1 423 plików i z ~8,3 tys. do 34 131 testów, to nie jest normalne tempo.
Siedem modułów przeszło z kilkunastu procent do ponad 80: edytor **+91,0 pp**, CRM +86,9, chrome +79,4,
wygląd/media +69,5, kluby **+68,6**, wyszukiwarka +64,2, newsletter +54,8. Ocena „przeciętnie” dotyczy
STANU, nie pracy — i przy tym tempie decyduje już wyłącznie kolejność, w jakiej bierze się
pozostałe powierzchnie. Rozdział 8.1 podaje tę kolejność.

**Zastrzeżenia per moduł — tam, gdzie sama liczba kłamie albo jest niepełna:**

- **MODUŁ 2** (wzorowo, baza 99,0) — wzorowo i UTRWALONE: 21 progów per-ścieżka pilnuje tego poziomu, więc jedna zmiana go nie zdejmie. Wzorzec do kopiowania w pozostałych modułach.
- **MODUŁ 18** (wzorowo, baza 98,7) — wzorowo, ale BEZ ZAPORY: 98,98% linii chroni jeden próg per-ścieżka. Ten poziom powstał w ciągu dwóch dni i jeden PR bez testów może go zdjąć, nie łamiąc żadnej bramki.
- **MODUŁ 6** (wzorowo, baza 96,1) — wzorowo, przy czym ranking i operatory dowodzi pgTAP (9 plików) — to przykład powierzchni, na której wysoki procent jednostkowy i mocna warstwa bazy zgadzają się co do wniosku.
- **MODUŁ 5** (wzorowo, baza 94,4) — wzorowo DZIŚ, bez gwarancji na jutro: ani jednego progu per-ścieżka na powierzchni obecnej na każdej stronie serwisu. Chrome z 96,15% i bez zapory to dorobek pożyczony.
- **MODUŁ 4** (wzorowo, baza 90,2) — wzorowo bez zapory (zero progów). Połowa tego pokrycia to czysta matematyka kadrowania i tokenów motywu — najtańszy dowód o największym zasięgu, i najłatwiejszy do utracenia bez progu.
- **MODUŁ 16** (dobrze, baza 86,0) — NAJWIĘKSZY SKOK W HISTORII TEGO AUDYTU: 33,79% → 86,21% linii (+52,4 pp), funkcje 29,90% → 85,88%, plików na zerze 154 → 22. I ocena znów jest dwumodalna, tylko ODWROTNIE niż w wydaniu 3: same KLUBY stoją po domknięciu na ~97% (cztery powierzchnie docelowe po 95%+, `lib/clubs/**` na 93,95% z powodem rozpisanym per plik), a WSZYSTKIE 22 pozostałe zera to część, która była poza zakresem zadania — społeczność: `admin.community.qa`, `admin.community.events`, `admin.community.polls`, `admin.community.badges`, `EventSpeakersManager`, `EventTicketPurchase`, `community-cron`. Mianownik urósł z 252 na 317 plików, bo 28 modułów reguł i 37 komponentów wyszło z JSX-a — czyli 86,21% liczy się na WIĘKSZEJ ilości kodu niż 33,79%.
- **MODUŁ 11** (dobrze, baza 82,2) — dobrze i najlepiej utrwalone w całym repo: 65 progów per-ścieżka, najwięcej z wszystkich modułów. 29 z 147 plików nadal na zerze, więc jest co domykać, ale osunąć się to nie może.
- **MODUŁ 10** (dobrze, baza 81,3) — dobrze i spójnie: warstwa danych jest RPC-only i objęta progiem 95/98, więc moduł nie dryfuje między wydaniami. 3 pliki na zerze z 32 to najlepszy wynik w tej klasie.
- **MODUŁ 1** (dobrze, baza 78,6) — dobrze, z zastrzeżeniem rodzaju: reguły paywalla i meteringu mają testy i progi, ale to, co czytelnik widzi, dowodzi się renderem — a 13 z 86 plików nie wykonuje ani jednej linii.
- **design system (components/ui)** (przeciętnie, baza 74,9) — procent zaniża wartość tej powierzchni: jeden test kontraktu atomu (rola, etykieta, stan wyłączony) chroni każde jego użycie w repo, a plików na zerze zostało 4 ze 43. Ale wciąż tylko JEDEN rodzaj testu (komponentowy) i ZERO progów per-ścieżka — przy 43 plikach, z których korzysta cała aplikacja.
- **MODUŁ 3** (przeciętnie, baza 72,8) — +23,3 pp (52,34% → 75,66%), funkcje 38,73% → 70,94%, zera 120 → 72 — ale NADAL największa bezwzględna dziura systemu: 5 195 niepokrytych linii. Sześć powierzchni buildera domknięto do 95/93 (panele widgetów 97,34% linii, publiczny render bloków 97,85%, rdzeń silnika 99,41%), więc to, co zostało, jest skoncentrowane i nazwane: **edytor bloków w panelu** (`components/admin/blocks/**` — `BlockCanvas` 218 LOC, `edit/Paragraph` 167, `NestedBlocksEditor` 107, `SortableBlockItem` 93, `edit/Heading` 92, `useBlockClipboard` 77, wszystkie na zerze) oraz DRUGA ścieżka importu WordPressa. Ta druga jest najciekawszym znaleziskiem tego wydania i opisuję ją osobno niżej.
- **MODUŁ 13** (przeciętnie, baza 72,3) — CZYTAĆ ODWROTNIE, NIŻ WYGLĄDA: funkcje (76,36%) są wyżej niż linie (66,32%), co znaczy, że ścieżka płatność → dostęp ma testy funkcji serwerowych z wysokimi progami, a nietestowana jest powłoka UI. To właściwa kolejność priorytetów — dowód jest tam, gdzie idą pieniądze. Ale rezygnacja i zmiana planu to interfejs: UI może pokazać „anulowano”, gdy żądanie padło, i żaden test serwerowy tego nie zauważy.
- **słowniki i18n** (przeciętnie, baza 70,4) — TA LICZBA NIE PODLEGA OCENIE PROCENTEM. 92,49% linii przy 55,03% funkcji to artefakt zaimportowania obiektu — słowniki nie mają logiki, więc „pokryta linia” nic tu nie dowodzi. Jedynym sensownym dowodem jest bramka parytetu PL/EN i cztery `check:i18n-*`. Te istnieją i działają, więc powierzchnia jest zabezpieczona DOBRZE, mimo że jej procent jest bez treści.
- **MODUŁ 9** (przeciętnie, baza 59,5) — przeciętnie, ale to najlepszy przykład skutecznej metody w tym repo: mieszanka testu warstwy danych z atrapą łańcucha PostgREST, testu hooka i testu reguł wątku wyciągnęła moduł z 17% na obecny poziom. Nie liczba testów to zrobiła, a dobór rodzaju.
- **MODUŁ 8** (źle, baza 54,4) — źle wobec konsekwencji: JSON-LD, hreflang i sitemapy dowodzi się bajtami z SSR, a nie wywołaniem funkcji budującej `<head>`. Moduł ruszył o +4,4 pp (reguły zero-click) i to jedyny wyraźny ruch w tym wydaniu, ale 23 z 74 plików nadal nie wykonuje ani jednej linii.
- **MODUŁ 15** (źle, baza 53,6) — źle wobec konsekwencji: konto, RODO i eksport danych. Ruszył +2,7 pp dzięki testom ochrony przed brute force i scalania danych gościa — i to była dokładnie właściwa kolejność, bo scalanie to jedyna ścieżka, na której użytkownik może NIEODWRACALNIE stracić dane. Zostaje 28 z 81 plików na zerze.
- **MODUŁ 21** (źle, baza 50,3) — źle i bez zapory, przy najczęściej wypełnianym formularzu przez osoby z zewnątrz. Jedyna pociecha: bramka `check:careers-harness` istnieje, bo złamany CHECK w bazie już raz przeszedł przy zielonym CI.
- **MODUŁ 20** (źle, baza 47,7) — źle w liczbach, lepiej w rzeczywistości: ta powierzchnia utrzymuje meta-inwarianty („bramka, która istnieje, musi się uruchamiać”), które skalują się z repozytorium, nie z liczbą przypadków. Ale 66 z 186 plików na zerze przy 3 916 niepokrytych liniach to DRUGA największa dziura w repo po module 3 — i jedyna duża, która nie dostała jeszcze własnego podejścia. Nowy `lib/preview/**` (heartbeat sesji) wszedł tu z pokryciem 36,6% linii, czyli poniżej średniej modułu.
- **MODUŁ 12** (źle, baza 45,6) — źle i mylące: bez atrapy kanału test dowodzi tylko, że subskrypcja została utworzona, i przechodzi przy PUSTYM handlerze zdarzenia. Na tej powierzchni procent może rosnąć bez wzrostu dowodu — zero progów per-ścieżka tego nie wyłapie.
- **MODUŁ 7** (źle, baza 40,5) — źle przy ośmiu różnych typach treści dzielących jeden wzorzec: reguły domenowe mają testy, funkcje serwerowe i loadery nie. Rezerwacja miejsc jest tu przypadkiem skrajnym — baza pilnuje kolejki, aplikacja może nigdy o wolne miejsce nie zapytać.
- **powłoka panelu admin + atomy/molekuły** (źle, baza 38,7) — źle i to jest dług architektoniczny, nie testowy: 38 z 172 plików na zerze, bo powłoka panelu jest powtórzonym JSX-em, którego nikt nie scalił w atomy. Wartość pracy tutaj mierzy się nie procentem, a tym, ile powtórzeń udało się zamknąć w jednym testowanym atomie.
- **MODUŁ 17** (beznadziejnie, baza 27,2) — beznadziejnie z jednym wyjątkiem, który ratuje sens: warstwa semantyczna analityki jest pokryta w 100% i objęta progiem — a od niej zależy KAŻDA liczba w raporcie zarządczym. Reszta (49 z 85 plików na zerze) to widoki i wykresy, gdzie brakuje testów a11y: wykres bez alternatywy tekstowej jest dla części odbiorców pustym prostokątem.
- **MODUŁ 19** (beznadziejnie, baza 25,2) — BEZNADZIEJNIE I NAJGROŹNIEJ, a po tych czterech dniach RELATYWNIE GORZEJ niż wcześniej: 28,00% linii i 23,26% funkcji (+0,5 pp od wydania 3, czyli szum), 56 z 130 plików na zerze — przy macierzy uprawnień, zgodach, cookie bannerze, izolacji tenanta i eksporcie danych. Dwie duże akcje domykające poszły w builder i kluby; ten moduł nie dostał ani jednego z 186 nowych plików testowych. Tu defekt jest zdarzeniem PRAWNYM, nie usterką, więc tę samą liczbę trzeba czytać surowiej niż w module 14. Rodzaj testu, który decyduje, jest inny niż wszędzie: inwariant i parytet, bo zawężenia kręgu uprawnionych nie widzi żaden test pojedynczej funkcji — każda z nich osobno działa poprawnie.
- **MODUŁ 14** (beznadziejnie, baza 20,9) — BEZNADZIEJNIE BEZ WYMÓWKI, trzecie wydanie z rzędu bez ruchu: 26,16% linii, 17,47% funkcji (najniższy wymiar funkcyjny w repo), 16 z 38 plików na zerze, ZERO progów per-ścieżka, dwa rodzaje testów. Argument „duża powierzchnia” tu nie działa: 1 022 niepokryte linie to jedna piąta długu modułu 3 i najtańsze domknięcie z całej listy. Kupon i darowizna to transakcja — kwota, waluta, limit wykorzystań.

**Jedno zdanie, gdyby trzeba było wybrać jedno.** Cztery dni temu napisałem, że to projekt z mocnym
aparatem dowodowym i połową powierzchni, na której nikt nie zaczął — dziś ta połowa jest o dwie
powierzchnie mniejsza, a ryzyko skupiło się w 3 modułach zamiast czterech. Metoda jest
udowodniona (dwa zamówione zadania, dwa domknięcia, 24 znalezione defekty), więc pytanie nie brzmi
już „czy da się”, a „w jakiej kolejności” — i pierwszą pozycją jest MODUŁ 19, bo tam defekt jest
zdarzeniem prawnym, a moduł nie dostał ani jednego z 186 nowych plików testowych.

---

## 9. Załączniki

### 9.1 Reguły mapowania plik → moduł

Mapowanie jest deterministyczne (pierwsze trafienie wygrywa) i w całości oparte na ścieżkach.
Wzorce w kolejności stosowania, per moduł:

| #   | Moduł                                                 | Wzorce ścieżek                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Wpisy: doświadczenie czytelnika                       | `src/lib/access/`, `src/lib/toc/`, `src/lib/footnotes`, `src/lib/manualToc`, `src/lib/keyTakeaways/`, `src/lib/citations/`, `src/lib/audio/`, `src/lib/readingTime`, `src/lib/postLayouts`, `src/lib/relatedPosts`, `src/lib/relatedInsights`, `src/lib/relatedClickBeacon`, `src/components/post/`, `src/components/PostLayoutRenderer`, `src/components/Paywall`, `src/components/author/`, `src/components/audio/`, `src/components/molecules/MeterBanner`, `src/components/atoms/QuotaMeter`, `src/hooks/(useContentAccess                                                                                                                                                                                                   | useUnlockedContent                                        | usePasswordUnlock                                  | useRecordPostView                                | useSaveArticle                     | useBookmarks                 | useReadingTimeSettings                                             | usePostLayoutSettings                     | useRecommendedPosts)`, `src/routes/post\.`, `src/routes/preview\.`, `src/routes/admin\.(key-takeaways | toc           | post-layouts | related-posts)`, `src/routes/api/public/(post-tts | related-click)`, `src/routes/api/(tts | stt)` |
| 2   | Edytor wpisów i workflow redakcyjny                   | `src/components/admin/post-editor/`, `src/components/admin/versions/`, `src/components/admin/workflows/`, `src/lib/revisions`, `src/lib/posts-migrate`, `src/hooks/useAutosave`, `src/hooks/useEditPresence`, `src/hooks/useHistory`, `src/hooks/useUnsavedChangesGuard`, `src/lib/unsavedChanges`, `src/routes/admin\.(posts                                                                                                                                                                                                                                                                                                                                                                                                    | scheduler                                                 | calendar)`, `src/routes/admin\.(versions           | workflows                                        | redirects                          | import-wordpress             | contributors)`, `src/components/admin/(PostEditor                  | PostGeneralOverview)`                     |
| 3   | Silniki treści: bloki + page builder                  | `src/lib/blocks/`, `src/lib/builder/`, `src/lib/content/`, `src/lib/content-model/`, `src/lib/sidebarBuilder/`, `src/lib/patterns/`, `src/lib/wp-import`, `src/lib/wordpress-import`, `src/lib/sanitize`, `src/lib/content\.functions`, `src/components/blocks/`, `src/components/builder/`, `src/components/patterns/`, `src/components/content/`, `src/components/admin/blocks/`, `src/components/admin/builder/`, `src/components/admin/sidebarBuilder/`                                                                                                                                                                                                                                                                      |
| 4   | Strony, wygląd, motyw, media, import                  | `src/lib/theme/`, `src/lib/media`, `src/lib/layout/`, `src/lib/pageTemplates`, `src/lib/archive-layout-settings`, `src/lib/expertLayouts`, `src/lib/cropSizes`, `src/lib/cardImageSizes`, `src/lib/brand`, `src/lib/icons/`, `src/lib/icon`, `src/components/media/`, `src/components/theme/`, `src/components/icons/`, `src/components/pages/`, `src/components/admin/media/`, `src/components/admin/theme-design/`, `src/components/admin/archiveLayout/`, `src/hooks/(useGlobalColors                                                                                                                                                                                                                                         | useExpertLayoutSettings)`, `src/routes/admin\.(appearance | media                                              | pages                                            | theme                              | categor                      | tags?)`, `src/routes/admin\.(icons                                 | crop-sizes                                | content-area                                                                                          | custom-meta)` |
| 5   | Strona główna, archiwa, chrome                        | `src/components/header/`, `src/components/footer/`, `src/components/menu/`, `src/components/megaMenu/`, `src/components/mobile/`, `src/components/archive/`, `src/lib/menus/`, `src/lib/megaMenu/`, `src/lib/mobileBottomBar/`, `src/lib/mobileDrawer`, `src/lib/breadcrumbs`, `src/lib/categoryAreas`, `src/components/admin/menu/`, `src/routes/(category                                                                                                                                                                                                                                                                                                                                                                      | tag                                                       | blog                                               | series                                           | publications)\.`                   |
| 6   | Wyszukiwarka                                          | `src/lib/search/`, `src/components/search/`, `src/hooks/useSavedSearches`, `src/routes/search`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 7   | Typy treści specjalne                                 | `src/lib/tracker/`, `src/components/tracker/`, `src/lib/experts/`, `src/components/experts/`, `src/components/admin/experts/`, `src/lib/programs/`, `src/components/programs/`, `src/lib/events/`, `src/components/events/`, `src/lib/podcast/`, `src/components/podcast/`, `src/components/admin/podcasts/`, `src/lib/web-stories/`, `src/components/web-stories/`, `src/components/quiz/`, `src/lib/files/`, `src/components/files/`, `src/lib/maps/`, `src/components/maps/`, `src/routes/.*(tracker                                                                                                                                                                                                                          | expert                                                    | program                                            | event                                            | podcast                            | web-stor                     | quiz                                                               | librar                                    | glossar                                                                                               | poll          | qa           | live)`                                            |
| 8   | SEO, feedy, dane strukturalne                         | `src/lib/seo/`, `src/components/seo/`, `src/lib/social/`, `src/lib/links/`, `src/lib/customMeta`, `src/components/share/`, `src/components/admin/seo/`, `src/routes/.*(sitemap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | robots                                                    | rss                                                | feed                                             | llms                               | og-                          | seo)`                                                              |
| 9   | Czat / komunikator                                    | `src/lib/chat/`, `src/components/chat/`, `src/lib/composer/`, `src/components/composer/`, `src/lib/mentions/`, `src/components/mentions/`, `src/routes/.*(chat                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | messages)`                                                |
| 10  | Sieć / networking                                     | `src/lib/network/`, `src/components/network/`, `src/hooks/useFollow`, `src/routes/.*network`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 11  | Newsletter i e-mail                                   | `src/lib/newsletter`, `src/components/newsletter/`, `src/components/admin/newsletter/`, `src/lib/email`, `src/lib/system-emails`, `src/lib/tx-email-preview`, `src/lib/auth-email`, `src/hooks/useMyNewsletterStatus`, `src/hooks/useNewsletterSettings`, `src/components/popups/`, `src/routes/.*newsletter`, `src/routes/.*email`, `src/routes/(unsubscribe                                                                                                                                                                                                                                                                                                                                                                    | api/public/nl-)`, `src/components/admin/popups/`          |
| 12  | Realtime / powiadomienia / web-push                   | `src/lib/realtime/`, `src/lib/notifications/`, `src/components/notifications/`, `src/routes/.*notification`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 13  | Monetyzacja: checkout / subskrypcje / billing         | `src/lib/billing/`, `src/lib/stripe`, `src/lib/pricing/`, `src/components/billing/`, `src/components/checkout/`, `src/components/pricing/`, `src/components/membership-join/`, `src/components/admin/billing/`, `src/components/admin/pricing/`, `src/hooks/useCheckout`, `src/routes/.*(billing                                                                                                                                                                                                                                                                                                                                                                                                                                 | checkout                                                  | pricing                                            | membership                                       | subscription)`, `src/routes/(plans | api/public/payments          | api/public/fx-rate)`                                               |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  | `src/lib/gifting`, `src/components/gifting/`, `src/components/donations/`, `src/lib/ads/`, `src/components/ads/`, `src/components/admin/coupons/`, `src/hooks/useValidateCoupon`, `src/routes/.*(gift                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | donat                                                     | coupon                                             | ads)`                                            |
| 15  | Profil i konto                                        | `src/lib/profile/`, `src/lib/account`, `src/lib/auth/`, `src/lib/authSettings`, `src/lib/interests/`, `src/lib/retention/`, `src/lib/onboarding/`, `src/components/profile/`, `src/components/auth/`, `src/components/interests/`, `src/components/admin/auth/`, `src/components/admin/onboarding/`, `src/hooks/useAuth`, `src/hooks/useAuthSettings`, `src/hooks/useInterests`, `src/routes/(login                                                                                                                                                                                                                                                                                                                              | signup                                                    | account                                            | profile                                          | auth)`, `src/routes/.*(profile     | account                      | onboarding)`, `src/routes/(reset-password                          | support                                   | contribute)`                                                                                          |
| 16  | Społeczność: kluby, komentarze, moderacja             | `src/lib/clubs/`, `src/lib/community/`, `src/lib/comments/`, `src/components/clubs/`, `src/components/community/`, `src/components/comments/`, `src/components/admin/clubs/`, `src/components/admin/community/`, `src/routes/.*(club                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | community                                                 | comment                                            | badge)`                                          |
| 17  | Analityka i BI                                        | `src/lib/analytics/`, `src/lib/observability/`, `src/lib/charts/`, `src/lib/counters/`, `src/lib/views/`, `src/lib/webVitals`, `src/lib/tracker-admin`, `src/components/charts/`, `src/components/admin/analytics/`, `src/components/admin/performance/`, `src/routes/.*(analytics                                                                                                                                                                                                                                                                                                                                                                                                                                               | semantic)`, `src/routes/api/public/(track                 | vitals                                             | client-errors)`, `src/routes/admin\.(performance | experiments                        | link-monitor)`               |
| 18  | CRM                                                   | `src/lib/crm`, `src/components/admin/crm/`, `src/lib/organizations/`, `src/lib/csv/`, `src/routes/.*crm`, `src/routes/admin\.(companies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | contact)`                                                 |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO | `src/lib/authz/`, `src/lib/consent`, `src/lib/cookieBanner/`, `src/lib/legal/`, `src/lib/integrations/`, `src/lib/tenant`, `src/lib/features/`, `src/lib/personalization/`, `src/lib/greetings/`, `src/lib/admin/`, `src/lib/adminToasts`, `src/lib/useSiteSetting`, `src/lib/joinUsSync`, `src/lib/contact\.functions`, `src/components/legal/`, `src/components/consent/`, `src/components/admin/permissions/`, `src/components/admin/users/`, `src/components/admin/settings/`, `src/components/admin/cookie-banner/`, `src/components/admin/google-source/`, `src/hooks/(usePersonalizedSettings                                                                                                                             | useCheckoutSettings)`, `src/routes/admin\.(settings       | users                                              | integrations                                     | permissions                        | consent                      | organizations                                                      | audience)`, `src/routes/admin\.(greetings | names                                                                                                 | personalized  | popups)`     |
| 20  | Platforma / backend / infrastruktura / SSR            | `src/lib/ssr`, `src/lib/server/`, `src/lib/http/`, `src/lib/supabase`, `src/integrations/`, `src/lib/ci/`, `src/lib/queries/`, `src/lib/async`, `src/lib/errors/`, `src/lib/error`, `src/lib/watchdog/`, `src/lib/routing/`, `src/lib/a11y/`, `src/lib/code/`, `src/lib/mcp/`, `src/lib/prerender`, `src/lib/edgeCache`, `src/lib/platform-error-reporting`, `src/lib/cacheBusting`, `src/lib/ai-gateway`, `src/lib/redirects`, `src/lib/text/`, `src/lib/utils`, `src/lib/deepMerge`, `src/lib/storageKeys`, `src/lib/rafThrottle`, `src/lib/smoothAnchorScroll`, `src/lib/overlayCoordinator`, `src/lib/appDialogs`, `src/lib/loginPopupBus`, `src/lib/toastError`, `src/lib/countries`, `src/components/error/`, `src/(router | server                                                    | start)\.`, `src/utils/`, `src/routes/`, `src/lib/` |
| 21  | Rekrutacja / kariera                                  | `src/lib/careers/`, `src/lib/jobs/`, `src/components/careers/`, `src/routes/.*(career                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | job)`, `src/routes/admin\.hiring`                         |
| —   | PRZEKROJOWE: słowniki i18n                            | `src/lib/i18n-`, `src/lib/i18n\.ts$`, `src/lib/i18n/`, `src/lib/locale/`, `src/components/admin/i18n/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    | `src/components/(atoms                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | molecules                                                 | forms                                              | features)/`, `src/components/admin/(atoms        | molecules                          | hooks)/`, `src/lib/(features | hooks)/`, `src/components/admin/`, `src/components/`, `src/hooks/` |
| —   | PRZEKROJOWE: design system (components/ui)            | `src/components/ui/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

Rozbicie liczby plików produkcyjnych:

| #   | Moduł                                                 | Pliki | LOC (surowe) | Pliki testowe | LOC testów |
| --- | ----------------------------------------------------- | ----: | -----------: | ------------: | ---------: |
| 1   | Wpisy: doświadczenie czytelnika                       |    86 |       12 501 |            53 |     12 145 |
| 2   | Edytor wpisów i workflow redakcyjny                   |   103 |       14 724 |            88 |     23 835 |
| 3   | Silniki treści: bloki + page builder                  |   455 |      110 742 |           271 |     67 294 |
| 4   | Strony, wygląd, motyw, media, import                  |   133 |       16 859 |            73 |     15 393 |
| 5   | Strona główna, archiwa, chrome                        |    54 |        9 721 |            27 |      7 801 |
| 6   | Wyszukiwarka                                          |    24 |        4 662 |            21 |      6 119 |
| 7   | Typy treści specjalne                                 |   115 |       25 433 |            57 |     13 187 |
| 8   | SEO, feedy, dane strukturalne                         |    74 |       10 670 |            39 |      4 166 |
| 9   | Czat / komunikator                                    |    81 |       15 602 |            36 |      9 164 |
| 10  | Sieć / networking                                     |    32 |        5 162 |            23 |      5 298 |
| 11  | Newsletter i e-mail                                   |   147 |       28 636 |            88 |     26 865 |
| 12  | Realtime / powiadomienia / web-push                   |    28 |        5 374 |            13 |      1 672 |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |   185 |       26 394 |            91 |     24 021 |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |    38 |        7 786 |            11 |      1 402 |
| 15  | Profil i konto                                        |    81 |       18 003 |            38 |     11 309 |
| 16  | Społeczność: kluby, komentarze, moderacja             |   317 |       60 184 |           198 |     74 846 |
| 17  | Analityka i BI                                        |    85 |       16 520 |            19 |      2 229 |
| 18  | CRM                                                   |    57 |       16 062 |            32 |     10 336 |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |   130 |       23 800 |            30 |      5 636 |
| 20  | Platforma / backend / infrastruktura / SSR            |   187 |       58 528 |           153 |     36 123 |
| 21  | Rekrutacja / kariera                                  |    29 |        5 231 |            11 |      2 202 |
| —   | PRZEKROJOWE: słowniki i18n                            |   118 |       41 460 |             6 |        528 |
| —   | NIEPRZYPISANE                                         |     0 |            0 |            11 |      1 976 |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    |   172 |       28 336 |            32 |      6 945 |
| —   | PRZEKROJOWE: design system (components/ui)            |    43 |        4 248 |             2 |        195 |

### 9.2 Pliki testowe wyłączone z pomiaru — w tym wydaniu ŻADEN

Wydanie 1 musiało wykluczyć 39 plików (464 testy), które wisiały bez końca w fazie kolekcji —
wszystkie z dwóch powierzchni MODUŁU 3: `components/admin/builder/**` i
`components/builder/organisms/widget-view/**`. Przyczyną było zakleszczenie cyklu pod fabryką
`vi.mock` w warstwie leniwych widgetów, nie „za wolne testy”. Zostało naprawione
(`widget-view/lazySuspense.tsx`), a komentarz przy progu globalnym w `vitest.config.ts` datuje
odzysk na 1 026 testów. Dzięki temu obie te powierzchnie mają w tym wydaniu liczby zmierzone,
a nie oszacowane z progu: widget-view i panele buildera wchodzą do pomiaru w całości.

**Dwa pliki pominęły się SAME i to nie jest wykluczenie z pomiaru:**
`src/__tests__/db-schema-invariant.test.ts` i `src/__tests__/lang-parity.test.ts` (razem 50 testów)
startują tylko wtedy, gdy w środowisku są `VITE_SUPABASE_URL` i klucz publikowalny — sprawdzają
inwarianty na ŻYWEJ bazie: zgodność schematu z typami i parytet języków w danych. Sandboks audytu
nie ma sekretów, więc oba zeszły jako `skipped`; na CI z sekretami wykonują się. Konsekwencja dla
czytania tabel: żadna liczba w tym dokumencie nie zależy od tych 50 testów, bo mierzą one warstwę,
której v8 nie liczy — ale w rachunku ryzyka trzeba je policzyć na plus, nie pominąć.

### 9.3 Odtworzenie pomiaru

```bash
bun install                    # rejestr prywatny Lovable (piny z bun.lock)
bun run test:coverage          # próg globalny + 225 progów per-ścieżka
```

Od wdrożenia R1 z wydania 1 (`coverage.reportOnFailure: true` w configu) raport i progi powstają
TAKŻE na czerwonej suicie, więc powyższe jedno polecenie wystarcza — obejście z wydania 1 nie jest
już potrzebne. Pełny przebieg na tym HEAD: 9 min 10 s, 1 423 plików testowych, 34 131 testów
(1 235 plików / 22 002 testy przeszły, 2 pliki / 50 testów pominięte z braku sekretów Supabase).

Agregacja per moduł / funkcja / funkcjonalność powstała z `coverage/coverage-final.json`
(mapy `statementMap`/`fnMap`/`branchMap` + liczniki `s`/`f`/`b`) oraz `coverage-summary.json`:
moduł = suma po plikach pasujących do reguł z 9.1, funkcjonalność = suma po wzorcach ścieżek,
„funkcja bez wywołania” = wpis `fnMap`, którego licznik `f` wynosi zero.

### 9.4 Dokumenty wdrożeniowe, na które opiera się to wydanie

Zespół udokumentował obie akcje domykające osobno i te raporty są częścią dowodu — ten audyt
weryfikował ich liczby własnym przebiegiem, nie przepisywał ich:

- `docs/WDROZENIE_CMS_BUILDER_TESTY_2026-08-20.md` (242 wiersze) — sześć powierzchni buildera
  z przed → po, rozdział „Czego NIE pokryto — z numerami linii”, dwanaście defektów, zapadka progów.
- `docs/WDROZENIE_KLUBY_POKRYCIE_95_MODUL_16_2026-08-21.md` (351 wierszy) — 28 czystych modułów
  reguł wyprowadzonych z JSX-a, dwanaście defektów, rozdział „Nie osiągnięto 95% w:” z podaniem
  gałęzi nieosiągalnych i zakresu świadomie nietkniętego.

Oba mają rozdział o tym, czego NIE osiągnięto, z numerami linii. To rzadkie i warto to zapisać:
raport wdrożenia, który wymienia własne luki, jest sprawdzalny; raport, który podaje tylko
procenty, nie jest.
