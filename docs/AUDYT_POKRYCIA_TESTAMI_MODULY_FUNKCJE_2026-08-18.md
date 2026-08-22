# Audyt pokrycia testami: moduł po module, funkcja po funkcji (2026-08-22)

**Wydanie 5 pomiaru.** Rodowód w pięciu krokach: wydanie 1 (2026-08-18) musiało wykluczyć 39 plików
testowych wiszących w kolekcji; wydanie 2 (19.08) było pierwszym KOMPLETNYM pomiarem; wydanie 3
(19.08) pierwszym w całości zielonym; wydanie 4 (21.08) zmierzyło skutek domknięcia CMS buildera
i klubów. To wydanie mierzy HEAD `73afc850b` — **92 commity** za wydaniem 4, po dwóch kolejnych
akcjach domykających: **MODUŁ 19** (ustawienia, integracje, users, multi-tenant, RODO) i
**MODUŁ 20** (platforma, backend, SSR). Efekt: **+128 plików testowych** (1 423 → 1 551),
progi per-ścieżka 225 → **334**, próg globalny podniesiony drugi raz z rzędu, i **151 defektów
produkcyjnych** zapisanych jako `it.fails` — z 24 w wydaniu 4. Ta ostatnia liczba jest najważniejszą
treścią tego wydania i omawiam ją w rozdziale 7.2 oraz w pozycji R1.
Plik pozostaje pod tą samą nazwą, bo odwołuje się do niego komentarz przy progu globalnym
w `vitest.config.ts` oraz prompty modułowe. Zmiany względem wydania 4 są w rozdziale 2.1,
dokumenty wdrożeniowe w 9.4.

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
| Plików produkcyjnych w mianowniku  | 2 820                                                                                                                                                     |
| Plików testowych zmierzonych       | 1 551 z 1 551 (100,0%)                                                                                                                                    |
| Przypadków testowych wykonanych    | 41 294 (statyczny licznik `it/test` w plikach: 30 829; różnica to rozwinięcia `it.each`)                                                                  |
| Testy poza pomiarem                | brak — żaden plik nie został wykluczony z przebiegu                                                                                                       |
| Testy czerwone w tym przebiegu     | 2 (rozdział 8.1)                                                                                                                                          |
| Testy „expected fail”              | 163 przypadków z 24 wywołań `it.fails(` — zapisane defekty produkcyjne, nie awarie (rozdział 7.2)                                                         |
| Testy pominięte                    | 2 pliki / 50 testów — wymagają danych dostępowych do Supabase, których sandboks nie ma (rozdział 9.2)                                                     |
| Wynik bramki pokrycia              | przebieg zakończony kodem **0**: próg globalny i wszystkie 334 progów per-ścieżka PRZESZŁY                                                                |
| Data pomiaru                       | 2026-08-22, HEAD `73afc850b`                                                                                                                              |

**Cztery zastrzeżenia, bez których te procenty można źle odczytać:**

1. **Pokrycie ≠ poprawność.** Instrukcja „pokryta” to instrukcja, która się WYKONAŁA w trakcie
   testu — nie taka, której wynik ktoś sprawdził asercją. Dlatego obok pokrycia podaję gęstość
   asercji (kolumna „asercje”) — moduł z wysokim pokryciem i niską liczbą asercji to render bez dowodu.
2. **Pokrycie jednostkowe to nie całe pokrycie systemu.** Warstwa danych (RLS, RPC, triggery) jest
   testowana w pgTAP (98 plików, 1 840 asercji), a ścieżki użytkownika w Playwright
   (7 plików, 54 testów). Tych warstw v8 nie widzi — moduł z niskim %
   jednostkowym może mieć realną zaporę w bazie (rozdział 7).
3. **Mapowanie plik → moduł jest MOJE, nie repo.** Repo nie ma manifestu modułów; przypisanie
   2 820 plików do 21 modułów zrobiłem regułami po ścieżkach (rozdział 9.1). Pliki graniczne
   (np. `gifting` — „podaruj artykuł” jest funkcją MODUŁU 1, a kod leży w powierzchni MODUŁU 14)
   zaznaczam w tabelach.
4. **Pomiar jest KOMPLETNY, ale suita NIE jest zielona — i to jest treść, nie usterka pomiaru.**
   Ten przebieg: **1 547 plików / 41 079 testów przeszło, DWA padły**, a bramka pokrycia
   wyszła kodem 1 — z powodu tych dwóch testów oraz JEDNEGO z 334 progów per-ścieżka
   (`components/pricing/molecules/**`: gałęzie 92,3% wobec progu 94). Oba czerwone testy są nazwane
   i rozpoznane: `adminImportWordpressRoute` to flake udokumentowany w dwóch raportach wdrożenia
   przed tą pracą i po niej, a `authzSnapshotParity` rozjechał się **z prowieniencji, nie
   z zawężenia uprawnień** — 11 wpisów wagi `[provenance]` po konsolidacji siedmiu migracji
   z PR 281 (rozdział 8.1, pozycja R5). Do tego 163 przypadków „expected fail” — to NIE awarie,
   a zapisane defekty produkcyjne (rozdział 7.2), i ich liczba jest głównym tematem tego wydania.
   Poza pomiarem zostały 2 pliki (50 testów) pomijające się SAME z braku sekretów Supabase —
   inwarianty na żywej bazie, piąta warstwa testów, której ten dokument nie mierzy z zasady
   (rozdział 7). Rodowód dla porównania: wydanie 1 wykluczyło 39 plików wiszących w kolekcji,
   wydanie 2 miało jeden czerwony test i dziesięć czerwonych progów, wydania 3 i 4 były w całości
   zielone, to jest znów czerwone — ale z dwóch powodów, które da się nazwać i zamknąć w jeden dzień.

---

## 1. Wynik globalny: całe `src/`

| Metryka    | Pokryte / wszystkich |          % |
| ---------- | -------------------: | ---------: |
| Instrukcje |     79 682 / 107 542 | **74,09%** |
| Gałęzie    |      67 299 / 97 978 | **68,68%** |
| Funkcje    |      21 571 / 29 880 | **72,19%** |
| Linie      |      70 607 / 94 008 | **75,10%** |

Próg globalny w `vitest.config.ts` (ratchet, wolno tylko podnosić): **64% instrukcji /
58% gałęzi / 62% funkcji / 65% linii**. Zmierzony margines nad progiem:
instrukcje 10,09 pp, gałęzie 10,68 pp,
funkcje 10,19 pp, linie 10,10 pp.

**Kontrola wiarygodności pomiaru.** Komentarz przy progu w `vitest.config.ts` dokumentuje ostatni
pomiar zespołu: 68,27% instrukcji / 62,80% gałęzi /
66,25% funkcji / 69,28% linii.
Ten audyt, niezależnym przebiegiem: 74,09% / 68,68% / 72,19% / 75,10%.
Zgodność jest tym razem bardzo dobra i to jest istotne: komentarz w configu jest datowany na 20.08,
czyli PRZED wejściem pracy klubowej, a moje liczby są po niej. Różnica ~4 pp odpowiada dokładnie temu,
co dołożyło domknięcie modułu 16 — czyli obie strony mierzą to samo i tak samo, a komentarz jest
utrzymywany na bieżąco. Po wydaniu 3, w którym ten sam komentarz był nieaktualny o ~19 pp, to
zauważalna zmiana nawyku. Warto dopisać wpis po klubach, żeby zostało tak dalej.

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
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |          38 |     27,00% |  30,28% |  17,90% | **27,10%** |        13 | 0,289 |     88 |     247 |
| 17  | Analityka i BI                                        |          85 |     32,40% |  25,26% |  28,51% | **33,18%** |        46 | 0,224 |    199 |     442 |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    |         172 |     39,79% |  33,13% |  38,02% | **41,12%** |        34 | 0,192 |    468 |   1 032 |
| 7   | Typy treści specjalne                                 |         118 |     45,14% |  41,58% |  38,42% | **44,81%** |        43 | 0,492 |  1 128 |   1 823 |
| 12  | Realtime / powiadomienia / web-push                   |          28 |     45,67% |  31,08% |  44,50% | **48,41%** |        12 | 0,464 |     93 |     223 |
| 21  | Rekrutacja / kariera                                  |          29 |     54,96% |  53,52% |  47,13% | **55,12%** |        12 | 0,379 |    171 |     374 |
| 9   | Czat / komunikator                                    |          81 |     60,88% |  51,46% |  57,74% | **62,28%** |        14 | 0,444 |    607 |   1 123 |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |         185 |     66,30% |  62,29% |  78,25% | **67,72%** |        32 | 0,492 |  1 570 |   3 214 |
| 20  | Platforma / backend / infrastruktura / SSR            |         191 |     74,51% |  64,48% |  68,05% | **75,46%** |        43 | 1,005 |  4 261 |   9 327 |
| 3   | Silniki treści: bloki + page builder                  |         454 |     74,81% |  73,16% |  71,33% | **75,99%** |        70 | 0,596 |  4 906 |   8 899 |
| —   | PRZEKROJOWE: design system (components/ui)            |          43 |     77,66% |  64,15% |  71,49% | **79,89%** |         4 | 0,047 |     17 |      37 |
| 11  | Newsletter i e-mail                                   |         147 |     80,53% |  71,48% |  82,71% | **81,47%** |        29 | 0,599 |  1 962 |   4 232 |
| 1   | Wpisy: doświadczenie czytelnika                       |         103 |     80,26% |  73,32% |  79,08% | **81,73%** |        13 | 0,524 |    975 |   2 038 |
| 10  | Sieć / networking                                     |          32 |     78,38% |  67,98% |  80,86% | **81,98%** |         3 | 0,719 |    349 |     642 |
| 16  | Społeczność: kluby, komentarze, moderacja             |         317 |     85,73% |  84,98% |  85,80% | **85,95%** |        22 | 0,625 |  4 748 |   9 607 |
| 4   | Strony, wygląd, motyw, media, import                  |         133 |     90,95% |  82,16% |  88,89% | **92,32%** |         4 | 0,552 |  1 245 |   2 154 |
| —   | PRZEKROJOWE: słowniki i18n                            |         119 |     88,58% |  66,91% |  55,62% | **92,53%** |         1 | 0,050 |     60 |     141 |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |         131 |     92,08% |  88,81% |  89,80% | **93,08%** |        15 | 0,382 |  1 324 |   2 566 |
| 5   | Strona główna, archiwa, chrome                        |          62 |     94,68% |  82,86% |  93,49% | **96,47%** |         1 | 0,468 |    560 |     945 |
| 8   | SEO, feedy, dane strukturalne                         |          77 |     96,23% |  93,16% |  95,62% | **96,64%** |         5 | 0,883 |  1 251 |   2 812 |
| 6   | Wyszukiwarka                                          |          24 |     96,66% |  89,91% |  95,22% | **97,38%** |         0 | 0,875 |    528 |     839 |
| 15  | Profil i konto                                        |          91 |     96,44% |  93,60% |  94,48% | **97,42%** |         2 | 0,780 |  1 980 |   4 025 |
| 18  | CRM                                                   |          57 |     98,19% |  86,43% |  98,58% | **99,02%** |         0 | 0,561 |    701 |   1 228 |
| 2   | Edytor wpisów i workflow redakcyjny                   |         103 |     98,81% |  94,75% |  98,73% | **99,35%** |         0 | 0,854 |  1 576 |   2 928 |

### 2.1 Zmiana od wydania 4 — co dało domknięcie modułów 19 i 20

Poprzedni pomiar (wydanie 4, 2026-08-21, HEAD `6426bd039`) obejmował 1 423 z 1 423 plików
testowych i 2 771 plików produkcyjnych. Ten obejmuje 1 551 z 1 551
i 2 820. Kolumna Δ to różnica w punktach procentowych wobec wydania 4; ostatnia kolumna to
różnica KUMULACYJNA wobec wydania 1 (2026-08-18), żeby było widać, ile z dzisiejszego stanu
powstało w ciągu tych pięciu dni. Strzałka ↑ znaczy, że modułem ktoś się zajął.

| #   | Moduł                                                 | Linie wyd. 4 | Linie teraz |    Δ linie | Funkcje wyd. 4 | Funkcje teraz |  Δ funkcje | Δ linie od wyd. 1 |
| --- | ----------------------------------------------------- | -----------: | ----------: | ---------: | -------------: | ------------: | ---------: | ----------------: |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |       27,98% |  **93,08%** | ↑ +65,1 pp |         23,35% |    **89,80%** | ↑ +66,5 pp |        ↑ +71,1 pp |
| 15  | Profil i konto                                        |       56,03% |  **97,42%** | ↑ +41,4 pp |         51,95% |    **94,48%** | ↑ +42,5 pp |        ↑ +78,3 pp |
| 8   | SEO, feedy, dane strukturalne                         |       56,08% |  **96,64%** | ↑ +40,6 pp |         53,25% |    **95,62%** | ↑ +42,4 pp |        ↑ +46,3 pp |
| 20  | Platforma / backend / infrastruktura / SSR            |       55,12% |  **75,46%** | ↑ +20,3 pp |         42,82% |    **68,05%** | ↑ +25,2 pp |        ↑ +22,7 pp |
| 17  | Analityka i BI                                        |       30,45% |  **33,18%** |  ↑ +2,7 pp |         24,97% |    **28,51%** |  ↑ +3,5 pp |         ↑ +5,2 pp |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |       66,32% |  **67,72%** |  ↑ +1,4 pp |         76,36% |    **78,25%** |  ↑ +1,9 pp |        ↑ +35,0 pp |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |       26,16% |  **27,10%** |  ↑ +0,9 pp |         17,47% |    **17,90%** |  ↑ +0,4 pp |         ↑ +4,5 pp |
| 1   | Wpisy: doświadczenie czytelnika                       |       80,93% |  **81,73%** |  ↑ +0,8 pp |         77,07% |    **79,08%** |  ↑ +2,0 pp |        ↑ +49,9 pp |
| 7   | Typy treści specjalne                                 |       44,23% |  **44,81%** |  ↑ +0,6 pp |         37,96% |    **38,42%** |  ↑ +0,5 pp |        ↑ +28,3 pp |
| 12  | Realtime / powiadomienia / web-push                   |       47,98% |  **48,41%** |  ↑ +0,4 pp |         43,97% |    **44,50%** |  ↑ +0,5 pp |         ↑ +4,3 pp |
| 5   | Strona główna, archiwa, chrome                        |       96,15% |  **96,47%** |  ↑ +0,3 pp |         93,15% |    **93,49%** |  ↑ +0,3 pp |        ↑ +79,8 pp |
| 3   | Silniki treści: bloki + page builder                  |       75,68% |  **75,99%** |  ↑ +0,3 pp |         70,93% |    **71,33%** |  ↑ +0,4 pp |        ↑ +36,0 pp |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    |       40,82% |  **41,12%** |  ↑ +0,3 pp |         37,37% |    **38,02%** |  ↑ +0,7 pp |        ↑ +16,7 pp |
| 9   | Czat / komunikator                                    |       62,22% |  **62,28%** |  ↑ +0,1 pp |         57,74% |    **57,74%** |     0,0 pp |         ↑ +0,3 pp |
| 4   | Strony, wygląd, motyw, media, import                  |       92,26% |  **92,32%** |  ↑ +0,1 pp |         88,89% |    **88,89%** |     0,0 pp |        ↑ +69,6 pp |
| —   | PRZEKROJOWE: słowniki i18n                            |       92,49% |  **92,53%** |     0,0 pp |         55,62% |    **55,62%** |     0,0 pp |         ↑ +0,7 pp |
| 18  | CRM                                                   |       98,98% |  **99,02%** |     0,0 pp |         98,49% |    **98,58%** |  ↑ +0,1 pp |        ↑ +87,0 pp |
| 2   | Edytor wpisów i workflow redakcyjny                   |       99,35% |  **99,35%** |     0,0 pp |         98,85% |    **98,73%** |  ↓ -0,1 pp |        ↑ +91,0 pp |
| 6   | Wyszukiwarka                                          |       97,38% |  **97,38%** |     0,0 pp |         95,22% |    **95,22%** |     0,0 pp |        ↑ +64,2 pp |
| 10  | Sieć / networking                                     |       81,98% |  **81,98%** |     0,0 pp |         80,86% |    **80,86%** |     0,0 pp |         ↑ +0,3 pp |
| 11  | Newsletter i e-mail                                   |       81,47% |  **81,47%** |     0,0 pp |         82,71% |    **82,71%** |     0,0 pp |        ↑ +54,8 pp |
| 21  | Rekrutacja / kariera                                  |       55,12% |  **55,12%** |     0,0 pp |         47,13% |    **47,13%** |     0,0 pp |            0,0 pp |
| —   | PRZEKROJOWE: design system (components/ui)            |       79,89% |  **79,89%** |     0,0 pp |         71,49% |    **71,49%** |     0,0 pp |        ↑ +16,8 pp |
| 16  | Społeczność: kluby, komentarze, moderacja             |       86,18% |  **85,95%** |  ↓ -0,2 pp |         85,95% |    **85,80%** |  ↓ -0,1 pp |        ↑ +68,4 pp |

Ruszyło 6 powierzchni (powyżej 1 pp), 18 stoi w granicach ±1 pp, 0 spadło o więcej niż 1 pp.
Trzeci raz z rzędu ten sam wzorzec: ruch jest duży i skoncentrowany dokładnie w modułach, które
dostały zamówione zadanie domykające — tym razem MODUŁ 19 i MODUŁ 20 — plus rozlanie na
powierzchnie przekrojowe, do których wyprowadzono logikę z tras. Model „jedno zadanie = jedna
powierzchnia, jawny cel, próg na końcu” działa czwarty i piąty raz z rzędu.
Powierzchni niezmienionych co do drugiego miejsca po przecinku jest 8 — one nie dostały
w tym okresie ani jednego nowego testu.

**1 powierzchnia spadła o ułamek punktu i to nie jest regresja testów, a DYLUCJA:** MODUŁ 16 ↓ -0,2 pp.
Do modułu doszedł nowy kod produkcyjny szybciej, niż doszły testy do niego. Przypadek modułu 2 jest
pouczający, bo dostał JEDNOCZEŚNIE nowy plik testowy i cztery nowe pliki produkcyjne (ściągawka
zero-click) — i wynik netto wyszedł ujemny. Kolumna „plików 0%” w tabeli głównej rozstrzyga, który
z dwóch przypadków zachodzi: regresja usuwa testy przy stałej liczbie plików, dylucja dokłada pliki.

### 2.2 Wymiar „funkcje”: ile funkcji w module zostało kiedykolwiek wywołane

To najostrzejsza z czterech metryk: liczy KAŻDĄ funkcję (również strzałkowe callbacki i handlery),
a „pokryta” znaczy „wywołana co najmniej raz”. Moduł z 20% funkcji ma cztery piąte swoich zachowań
nigdy nie uruchomione w teście.

| #   | Moduł                                                 | Funkcji razem | Wywołanych |  % funkcji |
| --- | ----------------------------------------------------- | ------------: | ---------: | ---------: |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |           458 |         82 | **17,90%** |
| 17  | Analityka i BI                                        |           877 |        250 | **28,51%** |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    |         1 678 |        638 | **38,02%** |
| 7   | Typy treści specjalne                                 |         1 650 |        634 | **38,42%** |
| 12  | Realtime / powiadomienia / web-push                   |           373 |        166 | **44,50%** |
| 21  | Rekrutacja / kariera                                  |           348 |        164 | **47,13%** |
| —   | PRZEKROJOWE: słowniki i18n                            |           169 |         94 | **55,62%** |
| 9   | Czat / komunikator                                    |         1 060 |        612 | **57,74%** |
| 20  | Platforma / backend / infrastruktura / SSR            |         1 956 |      1 331 | **68,05%** |
| 3   | Silniki treści: bloki + page builder                  |         6 862 |      4 895 | **71,33%** |
| —   | PRZEKROJOWE: design system (components/ui)            |           228 |        163 | **71,49%** |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |         1 361 |      1 065 | **78,25%** |
| 1   | Wpisy: doświadczenie czytelnika                       |           674 |        533 | **79,08%** |
| 10  | Sieć / networking                                     |           303 |        245 | **80,86%** |
| 11  | Newsletter i e-mail                                   |         1 556 |      1 287 | **82,71%** |
| 16  | Społeczność: kluby, komentarze, moderacja             |         3 493 |      2 997 | **85,80%** |
| 4   | Strony, wygląd, motyw, media, import                  |         1 008 |        896 | **88,89%** |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |         1 451 |      1 303 | **89,80%** |
| 5   | Strona główna, archiwa, chrome                        |           568 |        531 | **93,49%** |
| 15  | Profil i konto                                        |         1 086 |      1 026 | **94,48%** |
| 6   | Wyszukiwarka                                          |           293 |        279 | **95,22%** |
| 8   | SEO, feedy, dane strukturalne                         |           502 |        480 | **95,62%** |
| 18  | CRM                                                   |         1 058 |      1 043 | **98,58%** |
| 2   | Edytor wpisów i workflow redakcyjny                   |           868 |        857 | **98,73%** |

---

## 3. Pokrycie per funkcjonalność (126 funkcjonalności w 21 modułach)

Każdy wiersz to FUNKCJA PRODUKTU, nie katalog: lista plików ją realizujących jest zdefiniowana
wzorcami ścieżek. Kolumna „fn” to funkcje wywołane / wszystkie funkcje w plikach tej funkcjonalności.

### MODUŁ 1 — Wpisy: doświadczenie czytelnika · linie 81,73% · funkcje 79,08%

**Rodzaje testów:** jednostkowy 30 · komponentowy 15 · hooka 8 · dostępności 1.

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
| Lista lektur (UI czytelnika)       |     17 |        104 | 100,0% | 99,2% |  100,0% | **100,0%** |     59/59 |

### MODUŁ 2 — Edytor wpisów i workflow redakcyjny · linie 99,35% · funkcje 98,73%

**Rodzaje testów:** komponentowy 54 · jednostkowy 17 · warstwy danych 5 · hooka 10 · parytetu 1 · bramki 1.

**Co tu decyduje:** reguły workflow i rewizji siedzą w `lib/content/*` i mają 100%, więc pokrycie tego modułu podnoszą tylko **testy komponentowe i testy hooków** — autozapis, obecność edytorska i formularz wpisu to cykl życia, nie czysta funkcja; test jednostkowy nie wykryje, że hook nie unieważnił cache po zapisie.

**Bez tego rodzaju przechodzi taki defekt:** autozapis zapisuje wersję, ale nie unieważnia cache listy; redaktor wraca na listę, widzi wersję starszą i nadpisuje własną pracę. Test jednostkowy zapisu przechodzi, bo zapis faktycznie się wykonał.

| Funkcjonalność                  | Plików | LOC mierz. | Instr. |   Gał. | Funkcje |      Linie | fn (szt.) |
| ------------------------------- | -----: | ---------: | -----: | -----: | ------: | ---------: | --------: |
| Rewizje i przywracanie          |     12 |        286 |  97,6% |  90,1% |   96,3% |  **97,9%** |   105/109 |
| Edytor wpisu (panele)           |     68 |      1 077 |  98,7% |  95,5% |   98,8% |  **99,4%** |   421/426 |
| Workflow draft→review→published |     10 |        214 |  99,1% |  95,6% |   99,0% |  **99,5%** |     96/97 |
| Autozapis wpisu                 |      3 |         85 | 100,0% |  96,0% |  100,0% | **100,0%** |     20/20 |
| Obecność edytorska (presence)   |      2 |          6 | 100,0% | 100,0% |  100,0% | **100,0%** |       3/3 |

### MODUŁ 3 — Silniki treści: bloki + page builder · linie 75,99% · funkcje 71,33%

**Rodzaje testów:** komponentowy 131 · jednostkowy 114 · hooka 12 · parytetu 8 · bramki 3 · dostępności 2 · dymny 1.

**Co tu decyduje:** decyduje **test parytetu**: rejestr widgetów, panel właściwości i renderer to trzy artefakty, które muszą mówić to samo, a rozjazd „panel ustawia, renderer ignoruje” łapie wyłącznie porównanie dwóch stron (`check:widget-fidelity`, `settingsFidelity.gate`). Test jednostkowy schematu i test komponentu widgetu są konieczne, ale ani jeden, ani drugi nie zauważy dryfu między nimi.

**Bez tego rodzaju przechodzi taki defekt:** panel zapisuje ustawienie pod kluczem `heightMobile`, renderer czyta `mobileHeight`. Oba pliki mają testy, oba są zielone, a strona na telefonie ignoruje ustawienie — to dokładnie ta klasa defektu, dla której powstała bramka `check:widget-fidelity`.

| Funkcjonalność                                         | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |      Linie | fn (szt.) |
| ------------------------------------------------------ | -----: | ---------: | -----: | ----: | ------: | ---------: | --------: |
| CMS: builder sidebara + wzorce                         |      7 |        238 |  73,1% | 66,8% |   69,7% |  **74,4%** |    92/132 |
| CMS: import z Gutenberga / WordPressa                  |     10 |      1 309 |  78,1% | 74,5% |   79,6% |  **79,4%** |   199/250 |
| CMS: silnik treści publicznej (contentEngine)          |     19 |        521 |  79,6% | 77,9% |   82,2% |  **80,8%** |    97/118 |
| CMS: zapytania danych widgetów                         |      8 |        459 |  78,3% | 68,8% |   87,9% |  **83,2%** |   123/140 |
| CMS: design tokens / kolory globalne / typografia      |      6 |        257 |  85,8% | 81,6% |   87,5% |  **87,9%** |     35/40 |
| CMS: widgety buildera — render publiczny               |     54 |      3 599 |  90,4% | 82,7% |   87,4% |  **92,1%** |   693/793 |
| CMS: page builder (typ Elementor) — schemat i operacje |     11 |        649 |  89,4% | 69,6% |   99,7% |  **96,9%** |   293/294 |
| CMS: panele właściwości widgetów                       |    112 |      4 666 |  96,5% | 93,2% |   95,0% |  **97,3%** | 1971/2074 |
| CMS: sanityzacja HTML                                  |      4 |        157 |  93,9% | 88,1% |   90,6% |  **97,5%** |     29/32 |
| CMS: render bloków (publiczny)                         |     39 |      1 909 |  97,4% | 94,0% |   96,3% |  **98,2%** |   497/516 |
| CMS: silnik bloków (typ Gutenberg) — rdzeń             |      9 |        359 |  99,0% | 94,1% |  100,0% |  **98,9%** |   148/148 |
| CMS: warstwa content-model (rozdział bloki⇄builder)    |      7 |        150 |  95,1% | 86,7% |   96,9% |  **99,3%** |     31/32 |
| CMS: edycja bloków (selekcja, focus, schowek, undo)    |      6 |        236 |  98,3% | 93,4% |  100,0% | **100,0%** |     45/45 |

### MODUŁ 4 — Strony, wygląd, motyw, media, import · linie 92,32% · funkcje 88,89%

**Rodzaje testów:** komponentowy 31 · jednostkowy 26 · hooka 11 · warstwy danych 4 · funkcji serwerowej 1 · dostępności 1.

**Co tu decyduje:** połowa ryzyka to **czysta matematyka** (kadrowanie obrazu, tokeny motywu, kontrast etykiet) — tam test jednostkowy jest najtańszym dowodem o największym zasięgu; druga połowa to **testy hooków** panelu mediów (mutacje, zaznaczanie, skróty klawiszowe), gdzie liczy się kolejność zdarzeń i wycofanie po błędzie.

**Bez tego rodzaju przechodzi taki defekt:** kadr zapisuje się z zamienionymi osiami i wszystkie miniatury w archiwum są przycięte w złym miejscu. Dla plików już przetworzonych błąd jest nieodwracalny — nie ma z czego odtworzyć oryginalnego kadru.

| Funkcjonalność                  | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |      Linie | fn (szt.) |
| ------------------------------- | -----: | ---------: | -----: | ----: | ------: | ---------: | --------: |
| Ikony / marka                   |      7 |        149 |  79,6% | 72,6% |   73,0% |  **80,5%** |     27/37 |
| Media: upload, crop, biblioteka |     41 |      1 418 |  97,6% | 90,5% |   96,4% |  **99,0%** |   348/361 |
| Motyw / wygląd / global colors  |     52 |        630 |  98,2% | 91,5% |   97,5% |  **99,0%** |   193/198 |
| Szablony stron i archiwów       |      6 |        111 |  99,2% | 93,8% |  100,0% | **100,0%** |     63/63 |

### MODUŁ 5 — Strona główna, archiwa, chrome · linie 96,47% · funkcje 93,49%

**Rodzaje testów:** komponentowy 13 · jednostkowy 11 · warstwy danych 3 · parytetu 1 · dostępności 1.

**Co tu decyduje:** chrome jest na ścieżce każdej strony, więc liczy się **test komponentowy z asercją a11y** (nawigacja klawiaturą, rola i etykieta) plus **test jednostkowy drzewa menu** (sieroty, cykl, limit głębokości). Mega menu pokazuje, że ta mieszanka działa: cztery testy, w tym parytet kolumn, dały tej powierzchni kilkakrotnie wyższe pokrycie niż sąsiedniemu menu bez nich.

**Bez tego rodzaju przechodzi taki defekt:** menu działa myszką i nie działa klawiaturą. Defekt jest niewidoczny dla każdego, kto sprawdza ręcznie, i całkowicie blokujący dla części odbiorców — na powierzchni obecnej na każdej stronie serwisu.

| Funkcjonalność                       | Plików | LOC mierz. | Instr. |   Gał. | Funkcje |      Linie | fn (szt.) |
| ------------------------------------ | -----: | ---------: | -----: | -----: | ------: | ---------: | --------: |
| Mega menu                            |      3 |        135 |  80,9% |  66,0% |   79,5% |  **88,1%** |     31/39 |
| Nagłówek / stopka / menu             |     19 |        847 |  96,6% |  86,1% |   94,8% |  **97,9%** |   325/343 |
| Chrome mobilny (drawer, dolny pasek) |     11 |        220 |  95,6% |  90,5% |   91,4% |  **98,2%** |     53/58 |
| Archiwa kategorii/tagów              |     16 |        189 |  97,5% |  83,0% |   97,0% |  **98,4%** |     65/67 |
| Strona główna: sekcje i układ        |      8 |         31 | 100,0% | 100,0% |  100,0% | **100,0%** |     13/13 |

### MODUŁ 6 — Wyszukiwarka · linie 97,38% · funkcje 95,22%

**Rodzaje testów:** komponentowy 12 · jednostkowy 5 · hooka 2 · funkcji serwerowej 1 · warstwy danych 1.

**Co tu decyduje:** ranking, operatory i facety są dowiedzione w **pgTAP** (9 plików) — powtarzanie tego w vitest jest stratą; brakującym dowodem jest **test komponentowy overlaya** i **test hooka zapisanych wyszukiwań** (alerty e-mail), bo tam mieszka to, czego baza nie widzi.

**Bez tego rodzaju przechodzi taki defekt:** alert e-mail subskrybuje zapytanie, ale nie odsubskrybowuje po usunięciu zapisanego wyszukiwania. Użytkownik dostaje powiadomienia o czymś, co skasował, i nie ma w interfejsie sposobu, żeby je wyłączyć.

| Funkcjonalność                               | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| -------------------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Wyszukiwarka: indeks i zapytania             |     10 |        512 |  96,6% | 88,8% |   98,1% | **98,2%** |   102/104 |
| Wyszukiwarka: UI (overlay, filtry, zapisane) |     13 |        411 |  98,3% | 93,9% |   98,5% | **98,3%** |   130/132 |

### MODUŁ 7 — Typy treści specjalne · linie 44,81% · funkcje 38,42%

**Rodzaje testów:** komponentowy 22 · jednostkowy 26 · warstwy danych 4 · hooka 1 · funkcji serwerowej 3 · dymny 2.

**Co tu decyduje:** osiem różnych typów treści dzieli jeden wzorzec: reguły domenowe mają testy, a **funkcje serwerowe i loadery** nie. Rezerwacja miejsc na wydarzenie to przypadek skrajny — pgTAP dowodzi kolejki FIFO w bazie, ale to **test funkcji serwerowej** decyduje, czy aplikacja w ogóle zapyta o wolne miejsce.

**Bez tego rodzaju przechodzi taki defekt:** pgTAP dowodzi kolejki FIFO na miejscach, ale aplikacja nigdy nie pyta o wolne miejsce i sprzedaje 200 wejściówek na 150 miejsc. Baza jest w porządku; wydarzenie nie.

| Funkcjonalność                   | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |      Linie | fn (szt.) |
| -------------------------------- | -----: | ---------: | -----: | ----: | ------: | ---------: | --------: |
| Podcast                          |      4 |         78 |  73,7% | 74,3% |   50,0% |  **70,5%** |     16/32 |
| Quiz / mapy                      |      5 |        251 |  92,8% | 88,0% |   88,7% |  **94,4%** |     55/62 |
| Wydarzenia (RSVP, waitlist, ICS) |     18 |        247 |  95,8% | 96,2% |   96,1% |  **96,0%** |     73/76 |
| Huby ekspertów                   |     26 |        820 |  97,0% | 89,4% |   95,7% |  **97,9%** |   244/255 |
| Tracker legislacyjny             |      9 |        235 |  99,3% | 96,1% |  100,0% | **100,0%** |     95/95 |
| Programy badawcze                |      4 |         31 | 100,0% | 96,6% |  100,0% | **100,0%** |     14/14 |
| Web stories                      |      3 |         98 |  99,2% | 96,3% |  100,0% | **100,0%** |     30/30 |
| Biblioteka plików                |      7 |        248 |  99,7% | 91,0% |  100,0% | **100,0%** |     76/76 |

### MODUŁ 8 — SEO, feedy, dane strukturalne · linie 96,64% · funkcje 95,62%

**Rodzaje testów:** jednostkowy 48 · dostępności 8 · funkcji serwerowej 4 · hooka 2 · warstwy danych 1 · komponentowy 5.

**Co tu decyduje:** tu **e2e jest niezastępowalne**: JSON-LD, hreflang i sitemapy dowodzi się bajtami, które wyszły z SSR, a nie wywołaniem funkcji budującej `<head>`. Testy jednostkowe (35 plików) pilnują kształtu danych, `e2e/seo.spec.ts` pilnuje tego, co widzi robot.

**Bez tego rodzaju przechodzi taki defekt:** funkcja budująca `<head>` zwraca poprawny JSON-LD, a SSR go nie emituje albo emituje dwa razy. Test jednostkowy nie widzi bajtów, które wyszły z serwera — a robot widzi wyłącznie je.

| Funkcjonalność               | Plików | LOC mierz. | Instr. |   Gał. | Funkcje |      Linie | fn (szt.) |
| ---------------------------- | -----: | ---------: | -----: | -----: | ------: | ---------: | --------: |
| Feedy i sitemapy             |      8 |        130 |  60,4% |  40,6% |   37,5% |  **61,5%** |      9/24 |
| SEO: meta, JSON-LD, hreflang |     46 |      1 388 |  98,8% |  96,3% |   99,0% |  **99,3%** |   293/296 |
| Udostępnianie / OG           |      4 |        208 |  99,2% |  98,4% |  100,0% | **100,0%** |     64/64 |
| Monitor linków               |      2 |         18 | 100,0% | 100,0% |  100,0% | **100,0%** |       8/8 |

### MODUŁ 9 — Czat / komunikator · linie 62,28% · funkcje 57,74%

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
| Newsletter: kampanie i wysyłka                     |      3 |        380 |  67,3% | 57,2% |   62,9% |  **68,7%** |     44/70 |
| E-maile systemowe / transakcyjne                   |     38 |        991 |  77,2% | 59,5% |   69,3% |  **77,8%** |   174/251 |
| POPUP: host i wyświetlanie (reguły, częstotliwość) |      2 |        197 |  82,2% | 74,9% |   87,8% |  **84,3%** |     43/49 |
| Newsletter: panel admina                           |     49 |      1 563 |  86,5% | 83,4% |   87,4% |  **86,6%** |   625/715 |
| Newsletter: telemetria (open/click, engagement)    |      8 |        119 |  97,8% | 96,1% |  100,0% |  **98,3%** |     28/28 |
| POPUP: edytor popupu w adminie                     |     15 |        399 |  97,4% | 90,8% |   98,7% |  **98,5%** |   222/225 |
| Newsletter: doręczalność (SPF/DKIM, bounces)       |      2 |         85 |  99,0% | 95,6% |   95,7% |  **98,8%** |     22/23 |
| Newsletter: zapis + double opt-in + potwierdzenie  |      4 |        175 |  99,5% | 94,2% |   96,0% | **100,0%** |     24/25 |
| Newsletter: wypis (unsubscribe)                    |      3 |        109 |  96,7% | 93,2% |   90,0% | **100,0%** |     18/20 |
| POPUP: wygląd (design tokens popupu)               |      1 |         85 |  98,0% | 91,8% |  100,0% | **100,0%** |     27/27 |
| POPUP: telemetria zdarzeń                          |      2 |         62 | 100,0% | 92,3% |  100,0% | **100,0%** |     11/11 |

### MODUŁ 12 — Realtime / powiadomienia / web-push · linie 48,41% · funkcje 44,50%

**Rodzaje testów:** jednostkowy 10 · funkcji serwerowej 2 · hooka 1.

**Co tu decyduje:** realtime wymaga **atrapy kanału** (`realtimeStub`): bez niej test dowodzi tylko, że subskrypcja została utworzona, a nie że przyjście zdarzenia zmienia stan. Powiadomienia i web-push to dodatkowo **testy funkcji serwerowych** — wysyłka jest efektem ubocznym, nie zwracaną wartością.

**Bez tego rodzaju przechodzi taki defekt:** test dowodzi, że subskrypcja kanału została utworzona, i przechodzi także wtedy, gdy handler zdarzenia jest pusty. Powiadomienia nie przychodzą, a suita jest zielona.

| Funkcjonalność              | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| --------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Powiadomienia + web-push    |     16 |        878 |  42,3% | 29,5% |   32,1% | **44,9%** |    80/249 |
| Realtime (kanały, presence) |     10 |        268 |  58,2% | 41,3% |   72,4% | **61,6%** |    84/116 |

### MODUŁ 13 — Monetyzacja: checkout / subskrypcje / billing · linie 67,72% · funkcje 78,25%

**Rodzaje testów:** komponentowy 36 · funkcji serwerowej 23 · jednostkowy 26 · warstwy danych 4 · hooka 1 · parytetu 1.

**Co tu decyduje:** ścieżka płatność → dostęp ma **testy funkcji serwerowych** z wysokimi progami (webhook Stripe, grant) i to jest właściwy rodzaj dowodu dla pieniędzy. Ale rezygnacja, zmiana planu i faktury to **testy komponentowe**: UI może pokazać „anulowano”, gdy żądanie padło, a żaden test serwerowy tego nie zauważy.

**Bez tego rodzaju przechodzi taki defekt:** anulowanie subskrypcji pokazuje „anulowano”, choć żądanie padło. Użytkownik jest przekonany, że nie płaci, i wraca po miesiącu z reklamacją i chargebackiem — a test funkcji serwerowej niczego nie zgłosił, bo funkcja nigdy nie została wywołana.

| Funkcjonalność                              | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ------------------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Billing: rekoncyliacja i panel              |    112 |      3 685 |  63,3% | 60,4% |   79,6% | **64,9%** |   617/775 |
| Webhook płatności                           |      1 |         37 |  68,4% | 63,3% |   40,0% | **67,6%** |       2/5 |
| Checkout (Stripe) + intencja                |     15 |        200 |  65,1% | 57,1% |   63,6% | **68,5%** |     35/55 |
| Subskrypcje / plany / cennik                |     33 |        756 |  91,7% | 84,5% |   92,3% | **92,7%** |   337/365 |
| Dołączenie do członkostwa (membership join) |      9 |         65 |  96,1% | 84,1% |   93,8% | **96,9%** |     30/32 |

### MODUŁ 14 — Monetyzacja: kupony / darowizny / prezenty / reklamy · linie 27,10% · funkcje 17,90%

**Rodzaje testów:** jednostkowy 6 · komponentowy 5.

**Co tu decyduje:** kwoty i kupony to **testy jednostkowe** (waluta, zaokrąglenia, audyt kuponu), a widoczność reklamy i przycisku darowizny to **testy komponentowe**. Rozdział jest tu ważny, bo błąd w kwocie i błąd w widoczności mają różne konsekwencje i różne rodzaje dowodu.

**Bez tego rodzaju przechodzi taki defekt:** zaokrąglenie kuponu procentowego liczy się na liczbach zmiennoprzecinkowych i suma zamówienia rozjeżdża się o grosz z kwotą pobraną przez dostawcę płatności. Księgowość nie domyka miesiąca, a różnicy nie widać w żadnym logu aplikacji.

| Funkcjonalność               | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ---------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Reklamy / sponsoring         |     15 |        432 |  33,3% | 40,2% |   31,6% | **32,9%** |    37/117 |
| Kupony                       |      7 |        111 |  44,5% | 40,4% |   56,0% | **46,8%** |     14/25 |
| Prezenty artykułów (gifting) |     10 |        221 |  51,9% | 52,6% |   45,8% | **54,8%** |     27/59 |
| Darowizny                    |      3 |        119 |  84,0% | 72,0% |   71,4% | **85,7%** |     15/21 |

### MODUŁ 15 — Profil i konto · linie 97,42% · funkcje 94,48%

**Rodzaje testów:** komponentowy 28 · dostępności 11 · jednostkowy 17 · hooka 7 · funkcji serwerowej 3 · bramki 4 · warstwy danych 1.

**Co tu decyduje:** konto to **testy inwariantów i bramek** (guard weryfikacji profilu, izolacja tenanta) plus **pgTAP** dla eksportu danych i RODO. Sam procent pokrycia mówi tu mniej niż odpowiedź na pytanie, czy inwariant „profil niezweryfikowany nie widzi X” ma test, który pada przy każdym złamaniu reguły w dowolnym miejscu.

**Bez tego rodzaju przechodzi taki defekt:** jedna nowa trasa zapomina guardu weryfikacji i profil niezweryfikowany widzi dane, których nie powinien. Każda pojedyncza funkcja działa poprawnie — złamana jest reguła, nie funkcja, więc żaden test funkcji tego nie wykryje.

| Funkcjonalność                                | Plików | LOC mierz. | Instr. |   Gał. | Funkcje |      Linie | fn (szt.) |
| --------------------------------------------- | -----: | ---------: | -----: | -----: | ------: | ---------: | --------: |
| LOGIN: portal logowania (hasło, magic link)   |      4 |        225 |  56,8% |  59,4% |   67,3% |  **56,4%** |     37/55 |
| Profil użytkownika                            |     37 |      1 371 |  92,9% |  90,3% |   89,0% |  **94,0%** |   429/482 |
| Konto: dane, RODO, eksport                    |      3 |        118 |  97,5% |  96,8% |   91,2% |  **98,3%** |     31/34 |
| LOGIN: formularze auth w CMS (bloki + widget) |      3 |        363 |  97,5% |  90,4% |   96,2% |  **98,3%** |     76/79 |
| Zainteresowania / personalizacja              |      7 |        647 |  98,0% |  94,7% |   98,6% |  **99,8%** |   145/147 |
| REJESTRACJA: pola, walidacja, panel sukcesu   |      2 |         46 | 100,0% |  96,2% |  100,0% | **100,0%** |     16/16 |
| LOGIN/LOGOUT: sesja i kontekst użytkownika    |      4 |        117 | 100,0% |  97,3% |   96,3% | **100,0%** |     26/27 |
| LOGIN: MFA (2FA)                              |      2 |         44 | 100,0% |  97,1% |  100,0% | **100,0%** |     14/14 |
| LOGIN: ochrona przed brute force              |      1 |         54 | 100,0% | 100,0% |  100,0% | **100,0%** |       9/9 |
| LOGIN: reset hasła                            |      1 |         52 | 100,0% |  98,4% |  100,0% | **100,0%** |     16/16 |
| LOGIN: ustawienia logowania (admin)           |      4 |        110 | 100,0% | 100,0% |  100,0% | **100,0%** |     34/34 |
| Retencja / onboarding                         |      8 |        180 | 100,0% |  97,8% |  100,0% | **100,0%** |     38/38 |

### MODUŁ 16 — Społeczność: kluby, komentarze, moderacja · linie 85,95% · funkcje 85,80%

**Rodzaje testów:** komponentowy 98 · jednostkowy 84 · dostępności 4 · hooka 6 · warstwy danych 1 · funkcji serwerowej 2 · bramki 2 · parytetu 1.

**Co tu decyduje:** reguły dostępu do klubu mają testy jednostkowe, a polityki — **19 plików pgTAP**. Brakującym rodzajem jest **test warstwy danych** (łańcuch PostgREST w `api.ts`) i **test hooka** dla stanu listy wątków: to one decydują, czy właściwy członek zobaczy właściwą treść, czego ani reguła, ani polityka bazy nie dowodzą same.

**Bez tego rodzaju przechodzi taki defekt:** zapytanie o wątki gubi filtr grupy. RLS przepuści, bo pytający jest członkiem klubu, więc członek grupy A zobaczy wątki grupy B. Polityka jest poprawna; zapytanie nie.

| Funkcjonalność                                     | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |      Linie | fn (szt.) |
| -------------------------------------------------- | -----: | ---------: | -----: | ----: | ------: | ---------: | --------: |
| Społeczność: odznaki, zaangażowanie, Q&A, ankiety  |     20 |        571 |  27,8% | 35,7% |   22,9% |  **28,9%** |    43/188 |
| Komentarze i moderacja                             |      6 |        239 |  83,2% | 78,2% |   68,0% |  **84,1%** |     51/75 |
| KLUBY: zgłoszenia członkowskie (apply)             |      5 |        183 |  87,4% | 71,0% |   95,1% |  **89,6%** |     58/61 |
| KLUBY: API i zapytania (klub, posty, wątki)        |     10 |        591 |  96,1% | 96,8% |   98,2% |  **96,6%** |   222/226 |
| KLUBY: dostęp i uprawnienia (gate, macierz, plany) |      7 |        152 |  96,6% | 93,6% |  100,0% |  **98,0%** |     43/43 |
| KLUBY: reguły widoków wyprowadzone z JSX-a         |     12 |        378 |  99,1% | 97,2% |   98,7% |  **99,5%** |   151/153 |
| KLUBY: wątki dyskusyjne (dynamika, puls, źródła)   |      8 |        256 |  97,0% | 85,6% |  100,0% |  **99,6%** |     93/93 |
| KLUBY: UI (atomy/molekuły/organizmy)               |    103 |      2 193 |  99,8% | 99,3% |   99,9% |  **99,9%** |   934/935 |
| KLUBY: tematy, specjalizacje, obszary polityk      |     10 |        166 |  98,6% | 95,7% |   98,3% | **100,0%** |     59/60 |
| KLUBY: panel admina                                |     80 |      1 643 |  99,6% | 98,8% |  100,0% | **100,0%** |   785/785 |
| KLUBY: trasy publiczne klubu                       |     20 |        678 |  99,7% | 98,4% |  100,0% | **100,0%** |   247/247 |

### MODUŁ 17 — Analityka i BI · linie 33,18% · funkcje 28,51%

**Rodzaje testów:** jednostkowy 17 · dostępności 1 · komponentowy 1.

**Co tu decyduje:** warstwa semantyczna analityki jest w 100% pokryta **testami jednostkowymi z progami** — i tak być powinno, bo od niej zależy każda liczba w raporcie zarządczym. Wykresy potrzebują natomiast **testów a11y**: wykres bez alternatywy tekstowej jest dla części odbiorców pustym prostokątem.

**Bez tego rodzaju przechodzi taki defekt:** wykres w raporcie zarządczym jest dla części odbiorców pustym prostokątem. Dane są poprawne co do liczby i niedostępne co do odczytu — a pokrycie warstwy semantycznej wynosi 100%.

| Funkcjonalność                          | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| --------------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Analityka: zbieranie zdarzeń i liczniki |     20 |        705 |  15,4% | 13,7% |   18,2% | **16,0%** |    28/154 |
| Wykresy i panel BI                      |     41 |      1 501 |  27,8% | 22,2% |   22,3% | **29,0%** |   114/512 |
| Observability / RUM / web vitals        |     11 |        409 |  54,6% | 48,6% |   61,7% | **54,0%** |     37/60 |
| Analityka: warstwa semantyczna          |      7 |        239 |  70,4% | 60,2% |   69,4% | **71,5%** |     43/62 |

### MODUŁ 18 — CRM · linie 99,02% · funkcje 98,58%

**Rodzaje testów:** jednostkowy 17 · warstwy danych 5 · komponentowy 6 · funkcji serwerowej 2 · parytetu 1 · hooka 1.

**Co tu decyduje:** CRM pokazuje, po co jest **test parytetu**: filtr leadów istnieje w dwóch implementacjach (nad wierszami i nad zapytaniem), więc bez porównania obu stron poprawka w jednej zostawia drugą zepsutą. Poza tym **test warstwy danych** dla zapytań i **test jednostkowy** dla mapowania importu danych osobowych.

**Bez tego rodzaju przechodzi taki defekt:** poprawka w filtrze nad wierszami nie trafia do filtra nad zapytaniem. Lista i eksport pokazują różne zbiory leadów, a handlowiec pracuje na tym mniejszym i nie wie o brakujących.

| Funkcjonalność                        | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ------------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| CRM: UI panelu                        |     19 |        569 |  95,1% | 83,4% |   96,5% | **96,0%** |   279/289 |
| CRM: import/eksport CSV + organizacje |      7 |        356 |  98,8% | 91,7% |   96,3% | **99,7%** |     79/82 |
| CRM: kontakty, firmy, lejek, zadania  |     23 |      1 085 |  99,2% | 91,5% |   99,6% | **99,8%** |   261/262 |

### MODUŁ 19 — Ustawienia / integracje / users / multi-tenant / RODO · linie 93,08% · funkcje 89,80%

**Rodzaje testów:** jednostkowy 29 · warstwy danych 9 · funkcji serwerowej 4 · hooka 3 · komponentowy 3 · parytetu 1 · bramki 1.

**Co tu decyduje:** tu rodzaj testu jest ważniejszy niż procent: **inwariant i parytet** (snapshot bramek autoryzacji kontra migracje, macierz uprawnień kontra rejestr capabilities) wykrywają zawężenie kręgu uprawnionych, którego żaden test jednostkowy pojedynczej funkcji nie zauważy, bo każda z nich osobno działa poprawnie.

**Bez tego rodzaju przechodzi taki defekt:** migracja zawęża krąg uprawnionych, a panel nadal oferuje akcję, którą baza odrzuci. To się w tym repo zdarzyło: `admin.users.$id` renderowało droplistę zmiany roli każdemu członkowi personelu, bo `/admin` przepuszcza też `editor` i `author` — każde jej użycie kończyło się `not_authorized`.

| Funkcjonalność                           | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ---------------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Ustawienia serwisu (panele)              |      5 |        111 |  68,5% | 40,6% |   59,6% | **69,4%** |     31/52 |
| Zgody / cookie banner / GPC / RODO       |     28 |        460 |  86,7% | 79,1% |   78,8% | **89,3%** |   119/151 |
| Multi-tenant (izolacja tenanta w kodzie) |      6 |        281 |  88,5% | 83,3% |   84,1% | **90,4%** |     58/69 |
| Integracje zewnętrzne                    |      3 |        181 |  91,3% | 94,0% |   67,6% | **91,7%** |     23/34 |
| Autoryzacja / macierz uprawnień (authz)  |     23 |        207 |  92,9% | 90,3% |   85,2% | **91,8%** |     75/88 |
| Feature flags                            |      3 |        163 |  95,9% | 90,3% |   97,2% | **96,9%** |     35/36 |
| Użytkownicy i role (admin)               |      2 |        105 |  97,3% | 96,8% |  100,0% | **98,1%** |     28/28 |

### MODUŁ 20 — Platforma / backend / infrastruktura / SSR · linie 75,46% · funkcje 68,05%

**Rodzaje testów:** komponentowy 35 · jednostkowy 115 · warstwy danych 17 · funkcji serwerowej 17 · dostępności 3 · bramki 4 · parytetu 2.

**Co tu decyduje:** platforma utrzymuje **bramki (meta-inwarianty)**: „bramka, która istnieje, musi się uruchamiać”, parytet konfiguracji chunków, kontrakt zmiennych workflow. To rodzaj testu, który skaluje się z repozytorium, nie z liczbą przypadków — jeden taki test pilnuje wszystkich przyszłych plików.

**Bez tego rodzaju przechodzi taki defekt:** bramka istnieje w repozytorium i nie jest wpięta w workflow, więc zdanie „mamy to sprawdzone” jest fałszywe przez wiele miesięcy. Nikt tego nie zauważy, bo brak sygnału nie wygląda jak awaria — i to jest defekt, którego nie wykryje żaden test kodu produkcyjnego.

| Funkcjonalność                          | Plików | LOC mierz. | Instr. |   Gał. | Funkcje |      Linie | fn (szt.) |
| --------------------------------------- | -----: | ---------: | -----: | -----: | ------: | ---------: | --------: |
| Routing / trasy publiczne (powłoka)     |      8 |        423 |  26,6% |  17,2% |   16,0% |  **27,4%** |    17/106 |
| A11y / watchdog / MCP                   |      9 |        164 |  39,6% |  29,9% |   31,0% |  **42,1%** |      9/29 |
| Klient Supabase / zapytania             |     26 |        909 |  73,3% |  67,5% |   77,7% |  **75,7%** |   205/264 |
| Warstwa serwerowa (server fns)          |     19 |        980 |  76,3% |  71,3% |   79,5% |  **76,7%** |   175/220 |
| Obsługa błędów / error boundary         |      7 |        115 |  78,0% |  76,4% |   65,5% |  **77,4%** |     19/29 |
| SSR / hydracja / cache brzegowy         |     31 |      1 149 |  83,1% |  79,4% |   82,4% |  **84,7%** |   182/221 |
| Bramki CI (rejestry, kontrakty)         |     30 |      2 661 |  94,0% |  87,0% |   93,1% |  **95,6%** |   459/493 |
| Podgląd sesji / heartbeat               |      2 |        148 |  98,8% |  95,1% |  100,0% |  **99,3%** |     27/27 |
| Lista lektur / kolekcje (warstwa reguł) |      2 |         10 | 100,0% | 100,0% |  100,0% | **100,0%** |       8/8 |

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

Razem: **795 / 942 linii = 84,39%**, funkcje **323/354 = 91,24%**.

**POPUP: panel zapisu (formularz + zgody)** — linie 44,7%, funkcje 20/42 (47,6%), plików 3 (bez pokrycia: 0), LOC 199

> Bez ani jednego wywołania: **22 funkcji** (0 nazwanych, 22 anonimowych domknięć).

**POPUP: host i wyświetlanie (reguły, częstotliwość)** — linie 84,3%, funkcje 43/49 (87,8%), plików 2 (bez pokrycia: 0), LOC 197

> Bez ani jednego wywołania: **6 funkcji** (2 nazwanych, 4 anonimowych domknięć). Nazwane:
>
> - `useActivePopups @ src/lib/builder/popups.ts:201`
> - `usePopupEditor @ src/lib/builder/popups.ts:327`

**POPUP: edytor popupu w adminie** — linie 98,5%, funkcje 222/225 (98,7%), plików 15 (bez pokrycia: 2), LOC 399

> Bez ani jednego wywołania: **3 funkcji** (1 nazwanych, 2 anonimowych domknięć). Nazwane:
>
> - `PopupEditorRoute @ src/routes/admin.popups.$id.tsx:8`

**POPUP: wygląd (design tokens popupu)** — linie 100,0%, funkcje 27/27 (100,0%), plików 1 (bez pokrycia: 0), LOC 85

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

**POPUP: telemetria zdarzeń** — linie 100,0%, funkcje 11/11 (100,0%), plików 2 (bez pokrycia: 0), LOC 62

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

### 4.3 CMS builder — bloki (Gutenberg) i widgety (Elementor) (MODUŁ 3)

Razem: **13 499 / 14 509 linii = 93,04%**, funkcje **4253/4614 = 92,18%**.

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

**CMS: silnik treści publicznej (contentEngine)** — linie 80,8%, funkcje 97/118 (82,2%), plików 19 (bez pokrycia: 1), LOC 521

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

**CMS: design tokens / kolory globalne / typografia** — linie 87,9%, funkcje 35/40 (87,5%), plików 6 (bez pokrycia: 0), LOC 257

> Bez ani jednego wywołania: **5 funkcji** (1 nazwanych, 4 anonimowych domknięć). Nazwane:
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

**CMS: render bloków (publiczny)** — linie 98,2%, funkcje 497/516 (96,3%), plików 39 (bez pokrycia: 0), LOC 1 909

> Bez ani jednego wywołania: **19 funkcji** (0 nazwanych, 19 anonimowych domknięć).

**CMS: silnik bloków (typ Gutenberg) — rdzeń** — linie 98,9%, funkcje 148/148 (100,0%), plików 9 (bez pokrycia: 0), LOC 359

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

**CMS: warstwa content-model (rozdział bloki⇄builder)** — linie 99,3%, funkcje 31/32 (96,9%), plików 7 (bez pokrycia: 0), LOC 150

> Bez ani jednego wywołania: **1 funkcji** (0 nazwanych, 1 anonimowych domknięć).

**CMS: edycja bloków (selekcja, focus, schowek, undo)** — linie 100,0%, funkcje 45/45 (100,0%), plików 6 (bez pokrycia: 0), LOC 236

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

### 4.4 Kluby dyskusyjne (MODUŁ 16)

Razem: **6 193 / 6 240 linii = 99,25%**, funkcje **2592/2603 = 99,58%**.

**KLUBY: zgłoszenia członkowskie (apply)** — linie 89,6%, funkcje 58/61 (95,1%), plików 5 (bez pokrycia: 1), LOC 183

> Bez ani jednego wywołania: **3 funkcji** (0 nazwanych, 3 anonimowych domknięć).

**KLUBY: API i zapytania (klub, posty, wątki)** — linie 96,6%, funkcje 222/226 (98,2%), plików 10 (bez pokrycia: 0), LOC 591

> Bez ani jednego wywołania: **4 funkcji** (2 nazwanych, 2 anonimowych domknięć). Nazwane:
>
> - `uploadClubCover @ src/lib/clubs/coverApi.ts:69`
> - `setClubCover @ src/lib/clubs/coverApi.ts:95`

**KLUBY: dostęp i uprawnienia (gate, macierz, plany)** — linie 98,0%, funkcje 43/43 (100,0%), plików 7 (bez pokrycia: 0), LOC 152

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

Razem: **907 / 1 011 linii = 89,71%**, funkcje **228/250 = 91,20%**.

**LOGIN: portal logowania (hasło, magic link)** — linie 56,4%, funkcje 37/55 (67,3%), plików 4 (bez pokrycia: 2), LOC 225

> Bez ani jednego wywołania: **18 funkcji** (2 nazwanych, 16 anonimowych domknięć). Nazwane:
>
> - `LoginPopup @ src/components/LoginPopup.tsx:28`
> - `LoginPage @ src/routes/login.tsx:32`

**LOGIN: formularze auth w CMS (bloki + widget)** — linie 98,3%, funkcje 76/79 (96,2%), plików 3 (bez pokrycia: 0), LOC 363

> Bez ani jednego wywołania: **3 funkcji** (0 nazwanych, 3 anonimowych domknięć).

**REJESTRACJA: pola, walidacja, panel sukcesu** — linie 100,0%, funkcje 16/16 (100,0%), plików 2 (bez pokrycia: 0), LOC 46

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

**LOGIN/LOGOUT: sesja i kontekst użytkownika** — linie 100,0%, funkcje 26/27 (96,3%), plików 4 (bez pokrycia: 0), LOC 117

> Bez ani jednego wywołania: **1 funkcji** (0 nazwanych, 1 anonimowych domknięć).

**LOGIN: MFA (2FA)** — linie 100,0%, funkcje 14/14 (100,0%), plików 2 (bez pokrycia: 0), LOC 44

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

**LOGIN: ochrona przed brute force** — linie 100,0%, funkcje 9/9 (100,0%), plików 1 (bez pokrycia: 0), LOC 54

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

**LOGIN: reset hasła** — linie 100,0%, funkcje 16/16 (100,0%), plików 1 (bez pokrycia: 0), LOC 52

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

**LOGIN: ustawienia logowania (admin)** — linie 100,0%, funkcje 34/34 (100,0%), plików 4 (bez pokrycia: 0), LOC 110

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

---

## 5. Zera: gdzie test nie dotarł wcale

### 5.1 Największe pliki produkcyjne z pokryciem 0%

| Plik                                                           | LOC mierzone | Moduł                                              |
| -------------------------------------------------------------- | -----------: | -------------------------------------------------- |
| `src/routes/admin.podcasts.tsx`                                |          337 | M7                                                 |
| `src/routes/admin.research-programs.tsx`                       |          249 | M7                                                 |
| `src/components/admin/blocks/BlockCanvas.tsx`                  |          218 | M3                                                 |
| `src/components/admin/TrendingTickerPane.tsx`                  |          195 | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły |
| `src/routes/admin.tracker.tsx`                                 |          188 | M7                                                 |
| `src/components/admin/blocks/edit/Paragraph.tsx`               |          167 | M3                                                 |
| `src/components/admin/analytics/GscBiDashboard.tsx`            |          163 | M17                                                |
| `src/components/chat/ChatComposer.tsx`                         |          160 | M9                                                 |
| `src/routes/admin.ads.tsx`                                     |          158 | M14                                                |
| `src/routes/admin.paywall.tsx`                                 |          153 | M20                                                |
| `src/routes/admin.hiring.tsx`                                  |          148 | M21                                                |
| `src/components/notifications/NotificationsCenter.tsx`         |          146 | M12                                                |
| `src/components/admin/WordPressImportDialog.tsx`               |          142 | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły |
| `src/components/admin/WxrUploadPanel.tsx`                      |          140 | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły |
| `src/lib/wp-import.functions.ts`                               |          137 | M3                                                 |
| `src/routes/__root.tsx`                                        |          124 | M20                                                |
| `src/routes/admin.community.qa.tsx`                            |          122 | M16                                                |
| `src/routes/admin.programs.tsx`                                |          122 | M7                                                 |
| `src/components/admin/analytics/Ga4BiDashboard.tsx`            |          116 | M17                                                |
| `src/routes/admin.coupons.index.tsx`                           |          111 | M14                                                |
| `src/components/admin/analytics/RelatedPostsAnalytics.tsx`     |          111 | M17                                                |
| `src/routes/admin.live-blog.tsx`                               |          110 | M7                                                 |
| `src/routes/events.$slug.tsx`                                  |          110 | M7                                                 |
| `src/routes/admin.careers.tsx`                                 |          109 | M21                                                |
| `src/routes/admin.gifting.tsx`                                 |          108 | M14                                                |
| `src/components/admin/blocks/molecules/NestedBlocksEditor.tsx` |          107 | M3                                                 |
| `src/lib/wp-import/wxr.ts`                                     |          105 | M3                                                 |
| `src/routes/network.tsx`                                       |          104 | M10                                                |
| `src/routes/admin.newsletter.campaigns.$id.tsx`                |          102 | M11                                                |
| `src/routes/admin.coupons.campaigns.tsx`                       |          102 | M14                                                |
| `src/routes/admin.community.events.tsx`                        |          102 | M16                                                |
| `src/components/admin/community/EventSpeakersManager.tsx`      |          101 | M16                                                |
| `src/routes/admin.web-stories.tsx`                             |           98 | M7                                                 |
| `src/routes/messages.tsx`                                      |           97 | M9                                                 |
| `src/routes/api/public/community-cron.ts`                      |           93 | M16                                                |
| `src/components/admin/blocks/molecules/SortableBlockItem.tsx`  |           93 | M3                                                 |
| `src/components/admin/blocks/edit/Heading.tsx`                 |           92 | M3                                                 |
| `src/components/NewsletterPopup.tsx`                           |           90 | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły |
| `src/components/LoginPopup.tsx`                                |           88 | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły |
| `src/routes/pricing.tsx`                                       |           87 | M13                                                |

Łącznie plików produkcyjnych z pokryciem **0%: 418** z 2 820 (14,82%).

### 5.2 Katalogi bez ANI JEDNEGO pliku testowego

Sygnał niezależny od pokrycia: katalog może mieć pokrycie z testu innego katalogu, ale nie ma
testu WŁASNEGO — czyli nikt nie testuje go wprost. Takich katalogów jest **67**,
obejmują **99 plików / 26 358 linii**.

| Katalog                                          | Plików |   LOC |
| ------------------------------------------------ | -----: | ----: |
| `src/lib/locale`                                 |      2 | 4 544 |
| `src/components/admin/ThemeOptionsPane.tsx`      |      1 | 1 898 |
| `src/components/admin/GlobalColorsEditor.tsx`    |      1 | 1 479 |
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
| `src/components/admin/AccessSettingsPane.tsx`    |      1 |   407 |
| `src/components/admin/performance`               |      1 |   350 |
| `src/components/composer`                        |      1 |   310 |
| `src/components/admin/ThemeBackgroundsPane.tsx`  |      1 |   305 |
| `src/components/admin/ExpertLayoutPreview.tsx`   |      1 |   287 |
| `src/components/admin/podcasts`                  |      2 |   284 |
| `src/components/admin/AudioPicker.tsx`           |      1 |   282 |
| `src/components/admin/RelatedLayoutPreview.tsx`  |      1 |   241 |
| `src/components/admin/experts`                   |      1 |   235 |
| `src/components/admin/CoverImagePicker.tsx`      |      1 |   227 |

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
**1 próg globalny + 334 progów per-ścieżka** w `vitest.config.ts`, egzekwowanych w CI krokiem
`Test + coverage gate` (`.github/workflows/ci.yml`).

| Moduł                                 | Progów per-ścieżka | Mediana progu linii | Najwyższy próg linii |
| ------------------------------------- | -----------------: | ------------------: | -------------------: |
| M11                                   |                 65 |                  98 |                  100 |
| M20                                   |                 43 |                  99 |                  100 |
| M15                                   |                 40 |                 100 |                  100 |
| M19                                   |                 36 |                 100 |                  100 |
| M1                                    |                 27 |                 100 |                  100 |
| M2                                    |                 21 |                 100 |                  100 |
| M8                                    |                 20 |                  98 |                  100 |
| M13                                   |                 19 |                 100 |                  100 |
| M3                                    |                 17 |                  98 |                  100 |
| M16                                   |                 11 |                  99 |                  100 |
| M9                                    |                  9 |                  96 |                  100 |
| M17                                   |                  8 |                 100 |                  100 |
| M6                                    |                  8 |                 100 |                  100 |
| powłoka panelu admin + atomy/molekuły |                  2 |                 100 |                  100 |
| M10                                   |                  2 |                  98 |                   98 |
| M7                                    |                  2 |                 100 |                  100 |
| M4                                    |                  2 |                  99 |                   99 |
| M18                                   |                  1 |                  98 |                   98 |
| M5                                    |                  1 |                  99 |                   99 |

Z tego **70 progów obejmuje CAŁE POWIERZCHNIE** (wzorzec `/**`), a nie pojedyncze pliki —
to one decydują, czy nowy plik dołożony do katalogu automatycznie podlega bramce:

| Powierzchnia                                      | Instr. | Gał. | Funkcje | Linie | Moduł                                 |
| ------------------------------------------------- | -----: | ---: | ------: | ----: | ------------------------------------- |
| `src/components/builder/organisms/widget-view/**` |     95 |   87 |      94 |    97 | M3                                    |
| `src/components/admin/builder/**`                 |     94 |   91 |      93 |    95 | M3                                    |
| `src/lib/blocks/**`                               |     96 |   91 |      97 |    97 | M3                                    |
| `src/components/blocks/**`                        |     95 |   91 |      92 |    96 | M3                                    |
| `src/lib/sidebarBuilder/**`                       |     98 |   96 |     100 |    98 | M3                                    |
| `src/components/admin/sidebarBuilder/**`          |     97 |   95 |      98 |    98 | M3                                    |
| `src/lib/seo/**`                                  |     98 |   95 |      98 |    98 | M8                                    |
| `src/components/admin/seo/**`                     |     97 |   95 |      98 |    98 | M8                                    |
| `src/components/share/**`                         |     98 |   98 |      98 |    98 | M8                                    |
| `src/lib/links/**`                                |     98 |   98 |      98 |    98 | M8                                    |
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
| `src/lib/profile/**`                              |     83 |   77 |      82 |    83 | M15                                   |
| `src/components/profile/**`                       |     92 |   89 |      87 |    93 | M15                                   |
| `src/lib/onboarding/**`                           |    100 |  100 |     100 |   100 | M15                                   |
| `src/components/admin/auth/**`                    |    100 |  100 |     100 |   100 | M15                                   |
| `src/components/admin/onboarding/**`              |    100 |   95 |     100 |   100 | M15                                   |
| `src/components/interests/**`                     |     95 |   91 |      96 |    97 | M15                                   |
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
| `src/components/admin/users/**`                   |     96 |   95 |      99 |    97 | M19                                   |
| `src/lib/routing/**`                              |     99 |   98 |     100 |    99 | M20                                   |
| `src/lib/preview/**`                              |     97 |   94 |     100 |    98 | M20                                   |
| `src/lib/theme/**`                                |     98 |   90 |      99 |    99 | M4                                    |
| `src/lib/readingList/**`                          |     99 |   98 |     100 |    99 | M20                                   |
| `src/lib/collections/**`                          |     99 |   98 |     100 |    99 | M20                                   |
| `src/components/readingList/**`                   |     99 |   94 |     100 |    99 | M1                                    |
| `src/components/home/**`                          |     99 |   98 |     100 |    99 | M5                                    |
| `src/components/people/**`                        |     97 |   96 |     100 |    99 | M15                                   |

**Czego bramka NIE pilnuje** — moduły bez ani jednego progu per-ścieżka:

- **MODUŁ 12 — Realtime / powiadomienia / web-push**: linie 48,41%, funkcje 44,50%, plików 0%: 12/28
- **MODUŁ 14 — Monetyzacja: kupony / darowizny / prezenty / reklamy**: linie 27,10%, funkcje 17,90%, plików 0%: 13/38
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
| Jednostkowe / komponentowe (vitest)          | 1 551 plików, 30 829 testów, 61 037 asercji | logikę w TS/TSX, render komponentów, kontrakty modułów                       | zachowania bazy (RLS/RPC/triggery), realnych ścieżek przeglądarki, SSR end-to-end |
| Baza (pgTAP)                                 | 98 plików, 1 840 asercji                    | izolację tenanta, polityki RLS, kontrakty RPC, triggery                      | kodu frontu — v8 tego pokrycia NIE liczy                                          |
| E2E (Playwright)                             | 7 plików, 54 testów                         | ścieżki użytkownika, SSR, SEO, checkout                                      | pokrycia jednostkowego (osobny proces, nie wchodzi do %)                          |
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
| komponentowy (render + interakcja)         |    585 | 13 267 |  27 038 |     2,04 | że użytkownik to zobaczy: treść, stan wyłączony, komunikat błędu, reakcja na kliknięcie       | zachowania na prawdziwej przeglądarce i prawdziwych danych z bazy        |
| jednostkowy (czysta reguła)                |    665 | 10 050 |  19 092 |     1,90 | reguły w izolacji: wejście → wyjście, przypadki graniczne, gałęzie warunków                   | że reguła jest w ogóle wywołana przez aplikację (poprawnego okablowania) |
| warstwy danych (atrapa PostgREST)          |     68 |  2 761 |   5 188 |     1,88 | kształtu zapytania: filtry, kolejność ogniw, limit, zachowanie przy błędzie PostgREST         | że polityka RLS na serwerze przepuści to zapytanie                       |
| hooka (renderHook)                         |     77 |  1 760 |   3 419 |     1,94 | cyklu życia i unieważniania cache: kolejność efektów, sprzątanie, ponowne pobranie po mutacji | wyglądu; hook może być poprawny, a widok nadal pokazywać stare dane      |
| funkcji serwerowej                         |     75 |  1 441 |   3 012 |     2,09 | bramek wykonania: tenant, uprawnienia, rate limit, audyt, ścieżka błędu                       | że klient wywoła funkcję w odpowiednim momencie                          |
| dostępności (axe)                          |     37 |  1 192 |   2 633 |     2,21 | kontraktu dostępności: role, etykiety, kolejność fokusu, brak naruszeń axe                    | sensu treści dla czytnika ekranu (to ocenia człowiek)                    |
| bramki (meta-inwariant CI)                 |     18 |    179 |     278 |     1,55 | meta-inwariantu repo: że bramka istnieje, jest wpięta i coś sprawdza                          | zachowania kodu produkcyjnego                                            |
| parytetu (dwa artefakty muszą się zgadzać) |     18 |    125 |     264 |     2,11 | ZGODNOŚCI DWÓCH ARTEFAKTÓW (panel ⇄ renderer, snapshot ⇄ migracje, PL ⇄ EN)                   | poprawności żadnej ze stron osobno — tylko tego, że się nie rozjechały   |
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

Do tego dochodzą rodzaje, których v8 nie widzi wcale: **pgTAP** (98 plików) dowodzi
polityk i triggerów, **Playwright** (7 plików) ścieżek użytkownika i realnego SSR,
a **bramki skryptowe `check:*`** (33) kontraktów strukturalnych, w których nie ma
kodu do wykonania — na przykład tego, że każda bramka jest wpięta w workflow.

### 7.2 Sto pięćdziesiąt jeden zapisanych defektów: dowód skuteczności i nowe ryzyko

Rozdział 7.1 argumentuje teoretycznie, że rodzaj testu waży więcej niż liczba. Cztery zamówione
zadania domykające dały do tego dowód empiryczny, którego nie da się podważyć — i jednocześnie
wytworzyły nowy problem, który jest najważniejszą treścią tego wydania.

**Liczby, zmierzone niezależnie od raportów zespołu:** w repo jest dziś **151 wywołań `it.fails(`
w 84 plikach**, przy zerze `it.skip` i `it.todo`. W wydaniu 4 było ich 24 w 20 plikach. Przyrost
rozkłada się tak: builder 12, kluby 12, **MODUŁ 19 — 36**, **MODUŁ 20 — 38**, reszta na
powierzchniach dotkniętych po drodze. Każdy wpis to zapisany defekt produkcyjny z opisem,
bez zmiany zachowania produkcyjnego.

**Dobra wiadomość: to działa, i to lepiej niż zakładałem.** Bramka zakresu najemnego dla czytników
service-role — zamówiona w tym audycie jako pojedynczy plik testowy — znalazła defekt, którego
nie widzi ani TypeScript, ani żaden test jednostkowy, bo **mieszka w SQL-u**:

> `fetchPagePaths` (`publishedContent.server.ts:59`) filtruje `pages` po najemcy poprawnie, ale pełną
> ścieżkę składa RPC `public.page_full_path(_page_id uuid)` — rekurencyjne CTE idące w GÓRĘ po
> `pages.parent_id`, **bez predykatu najemcy**, `LANGUAGE sql STABLE` (czyli SECURITY INVOKER),
> a wołane spod service-role nie ma nad sobą RLS. Schemat tego nie domyka: `pages.parent_id` ma
> tylko `REFERENCES public.pages(id)`, bez `CHECK`-a ani triggera „ten sam najemca”. **Żaden plik
> pgTAP nie wspomina `page_full_path`.** Skutek: strona z rodzicem u innego najemcy wnosi JEGO
> slug do ścieżki kanonicznej publikowanej w **sitemapie i RSS-ie**.

Naprawa wymaga migracji schematu, więc słusznie została zgłoszona jako `it.fails`, a nie zmiana
produkcji pod test. Ale zwróć uwagę na mechanizm: **jeden plik testowy czytający kod odsłonił lukę
w bazie danych, której nie widziało 98 plików pgTAP.** To jest najlepszy pojedynczy argument za
tezą z 7.1 w całym tym dokumencie.

**Zła wiadomość: `it.fails` jest w CI ZIELONY.**

Wydanie 4 zapisało rekomendację: „zamienić 24 `it.fails` na naprawy — inaczej po miesiącu staną się
tłem”. W ciągu jednego dnia zrobiło się ich 151 i — o ile mogę stwierdzić z pomiaru — żaden
z pierwotnych 24 nie został naprawiony. Mechanizm jest przewidywalny i nie wymaga niczyjej złej woli:

1. `it.fails` przechodzi, dopóki defekt istnieje. Nic w CI nie naciska na naprawę.
2. Zapisanie defektu jest tanie i satysfakcjonujące, naprawa jest droga i wymaga decyzji.
3. Im więcej wpisów, tym mniejsza waga każdego — 151 pozycji to już nie lista, to tło.

Kierunek jest właściwy: lepiej mieć defekt zapisany, widoczny i odwracalny (bo `it.fails` pada
w chwili naprawy) niż zieloną suitę z nieznanym błędem. Ale **rejestr bez terminu i bez właściciela
przestaje być rejestrem, a staje się archiwum.** Dlatego to jest pozycja R1 tego wydania.

**Klasa defektu, która przestała być przypadkiem.** W wydaniu 4 wymieniłem trzy wystąpienia wzorca
„awaria wygląda jak pustka” i nazwałem to brakiem konwencji. Raport MODUŁU 19 klasyfikuje ten sam
wzorzec jako **klasę dominującą: 12 wystąpień w jednym module**, z czego 10 zgłoszonych. Razem
z klubami i builderem daje to co najmniej **15 niezależnych wystąpień w czterech modułach**.

To już nie jest defekt do naprawiania po jednym. To **brakująca konwencja architektoniczna**:
odczyt danych w tym repo nie ma jednego, wymuszonego sposobu rozróżnienia „pusto” od „nie udało się
wczytać”. Konsekwencja dla użytkownika jest zawsze ta sama i zawsze cicha — widzi „nic tu nie ma”
zamiast „nie udało się wczytać”, więc nie ponawia, nie zgłasza i nie wie, że czegoś nie widzi.
Naprawa jednostkowa 15 wystąpień nie zapobiega szesnastemu; naprawa konwencją — tak. Stąd pozycja R2.

**Klasy pozostałych defektów z dwóch nowych raportów**, w kolejności konsekwencji:

| Klasa                                             | Ile | Skąd                             |
| ------------------------------------------------- | --: | -------------------------------- |
| awaria odczytu udaje pustkę albo stan domyślny    |  12 | MODUŁ 19 (klasa dominująca)      |
| cicha utrata danych i cisza po odmowie            |   9 | MODUŁ 19                         |
| reguły tekstu, sluga i wyszukiwania               |   7 | MODUŁ 19                         |
| komunikaty i i18n                                 |   4 | MODUŁ 19                         |
| rola i dostęp                                     |   3 | MODUŁ 19                         |
| izolacja najemcy i zakres operacji                |   2 | MODUŁ 19                         |
| kontrakt wyniku                                   |   1 | MODUŁ 19                         |
| defekt schematu w SQL (`page_full_path`)          |   1 | MODUŁ 20, bramka zakresu najemcy |
| pozostałe (SSR, przekierowania, zapytania, trasy) |  37 | MODUŁ 20                         |

**Uczciwa nota o wiarygodności tego audytu.** Raport MODUŁU 20 zawiera rozdział „Trzy założenia
zlecenia, które okazały się nieprawdziwe” — i wszystkie trzy pochodzą z promptu opartego na tym
dokumencie. Zapisuję je, bo dotyczą jakości moich własnych wyników:

1. Twierdziłem, że `publishedContent.server.ts` woła `resolveTenantForHost`. Nie woła — bierze
   `tenantId` jako parametr, a trasy crawlera rozwiązują najemcę **wariantem fail-closed**
   (`resolveCrawlerTenantIdForHost`), bo wariant treściowy nieznanemu hostowi oddaje najemcę
   DOMYŚLNEGO. Różnica jest istotna i to była pomyłka po mojej stronie.
2. Twierdziłem, że `cacheBusting.ts` porównuje manifest builda. Nie ma tam manifestu.
3. Wymagałem kluczy i18next w granicy błędu i na stronie 404. **Ta warstwa renderuje się poza
   dostawcą i18n** i celowo używa własnego słownika `errorCopy.ts`. Wymuszenie tam i18next byłoby
   zmianą produkcji pod test — i słusznie tego nie zrobiono. Moja reguła „zawsze klucz i18n” ma
   wyjątek i to jest ten wyjątek.

Wniosek metodologiczny, ten sam co przy dwóch ścieżkach importu WordPressa (rozdz. 5.3): **zakres
i założenia zadania testowego trzeba weryfikować w kodzie przed napisaniem zlecenia, a nie opierać
na nazwie pliku ani na regule ogólnej.** Trzy z trzech założeń, które sprawdziłem tylko z nazwy,
okazały się nieprawdziwe; wszystkie, które oparłem na przeczytanym kodzie, się potwierdziły.

---

## 8. Wnioski: gdzie ryzyko jest największe

Ryzyko liczę jako BEZWZGLĘDNĄ liczbę niepokrytych linii, nie procent — 20% na module o 50 tys.
linii to większa dziura niż 20% na module o 5 tys.

| #   | Moduł                                                | Linii niepokrytych | Linie % | Funkcje % | Testów |
| --- | ---------------------------------------------------- | -----------------: | ------: | --------: | -----: |
| 3   | Silniki treści: bloki + page builder                 |          **5 129** |  75,99% |    71,33% |  4 906 |
| 7   | Typy treści specjalne                                |          **2 550** |  44,81% |    38,42% |  1 128 |
| 20  | Platforma / backend / infrastruktura / SSR           |          **2 128** |  75,46% |    68,05% |  4 261 |
| 17  | Analityka i BI                                       |          **2 052** |  33,18% |    28,51% |    199 |
| 13  | Monetyzacja: checkout / subskrypcje / billing        |          **1 665** |  67,72% |    78,25% |  1 570 |
| 9   | Czat / komunikator                                   |          **1 227** |  62,28% |    57,74% |    607 |
| 16  | Społeczność: kluby, komentarze, moderacja            |          **1 182** |  85,95% |    85,80% |  4 748 |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy |          **1 009** |  27,10% |    17,90% |     88 |
| 11  | Newsletter i e-mail                                  |            **900** |  81,47% |    82,71% |  1 962 |
| 12  | Realtime / powiadomienia / web-push                  |            **601** |  48,41% |    44,50% |     93 |

### 8.1 Rekomendacje — kolejność, nie lista życzeń

**R1. Zamknąć rejestr 151 `it.fails` — i objąć go progiem, bo inaczej urośnie dalej.**
Wydanie 4 zapisało: „zamienić 24 `it.fails` na naprawy, inaczej po miesiącu staną się tłem”.
W ciągu jednego dnia jest ich **151 w 84 plikach**. Sprawdziłem wyrywkowo cztery defekty
z wydania 4 — obejście `sanitizeHtml` przepuszczające handler `on*=` (ma dziś własny plik
`src/lib/__tests__/sanitizeScriptPrefixBypass.test.ts`), klucze prototypu w `getBlockVariants`,
brak komunikatu przy niezaznaczonej zgodzie RODO w `ContactFormView` oraz `ClampedNumberInput`
— **wszystkie cztery nadal otwarte**. Mechanizm nie wymaga niczyjej złej woli: `it.fails`
przechodzi, dopóki defekt istnieje, więc nic w CI nie naciska na naprawę.

Rozwiązanie w idiomie tego repo, którego repo jeszcze nie użyło na sobie: **próg na liczbę
`it.fails`, który wolno wyłącznie OBNIŻAĆ** — dokładnie tak jak progi pokrycia wolno wyłącznie
podnosić. Skrypt `check:expected-fail-budget` z zapisanym w configu limitem (dziś 151) i regułą
„nowy `it.fails` wolno dodać tylko razem z obniżeniem limitu o tyle samo w innym miejscu”.
Bez tego liczba będzie rosła, bo rośnie w sposób, który wygląda na dobrą praktykę.

Kolejność napraw według konsekwencji, nie trudności: **XSS w `sanitizeHtml`** (obejście
przepuszczające handler `on*=` w treści renderowanej z bazy), **defekt schematu `page_full_path`**
(migracja: predykat najemcy albo trigger „ten sam najemca” na `pages.parent_id`, plus plik pgTAP —
dziś żaden go nie wspomina), **brak komunikatu przy zgodzie RODO**, potem klasa z R2.

**R2. „Pusto” i „nie udało się wczytać” to jedna brakująca konwencja, nie 15 osobnych defektów.**
Wydanie 4 wymieniło trzy wystąpienia wzorca „awaria wygląda jak pustka”. Raport MODUŁU 19
klasyfikuje go jako **klasę dominującą: 12 wystąpień w jednym module**, z czego 10 zgłoszonych.
Razem z klubami i builderem to co najmniej **15 niezależnych wystąpień w czterech modułach**.
Odczyt danych w tym repo nie ma jednego, wymuszonego sposobu rozróżnienia tych dwóch stanów,
więc każdy nowy widok odtwarza defekt od zera. Konsekwencja dla użytkownika jest zawsze ta sama
i zawsze cicha: widzi „nic tu nie ma” zamiast „nie udało się wczytać”, więc nie ponawia,
nie zgłasza i nie wie, że czegoś nie widzi.

Naprawa jednostkowa piętnastu wystąpień nie zapobiega szesnastemu. Naprawa konwencją — tak:
jeden wspólny typ wyniku odczytu (albo helper) rozróżniający `empty` od `failed`, plus bramka
statyczna w idiomie `check:content-layering`, która wymaga tego rozróżnienia w każdym hooku
i zapytaniu. To jedna z niewielu pozycji w tej historii audytu, gdzie poprawka architektoniczna
jest tańsza od testów, które by ją zastąpiły.

**R3. `page_full_path` — migracja schematu, nie test.**
Bramka zakresu najemcy (zamówiona w wydaniu 4, jeden plik testowy) znalazła defekt mieszkający
w SQL-u: rekurencyjne CTE idące w górę po `pages.parent_id` **bez predykatu najemcy**,
`LANGUAGE sql STABLE` (SECURITY INVOKER), wołane spod service-role, więc bez RLS nad sobą.
Schemat tego nie domyka — `pages.parent_id` ma wyłącznie `REFERENCES public.pages(id)`, bez
`CHECK`-a ani triggera „ten sam najemca”, a `uniq_pages_tenant_parent_slug` pilnuje unikalności
slugu, nie zgodności najemcy. **Żaden z 98 plików pgTAP nie wspomina tej funkcji.**
Skutek: strona z rodzicem u innego najemcy wnosi JEGO slug do ścieżki kanonicznej publikowanej
w sitemapie i RSS-ie. Skala mniejsza niż wyciek wiersza (przecieka segment adresu), ale ta sama
klasa i ta sama powierzchnia, którą chroni cała reszta bramki.

To jest jednocześnie najlepszy dowód w całym tym dokumencie na tezę z rozdziału 7.1: **jeden plik
testowy czytający KOD odsłonił lukę w bazie danych, której nie widziało 98 plików pgTAP.**

**R4. E2E RUSZYŁO — i od razu znalazło defekt. Korekta mojej własnej rekomendacji z wydania 4.**
Wydanie 4 zapisało, że e2e „stoi na siedmiu plikach od pierwszego wydania". Ta liczba była prawdziwa
co do plików i myląca co do treści: warstwa e2e urosła z **42 na 54 testy** (+29%), a jeden
z commitów nazywa się wprost `test(platforma): e2e — zdjęte test.fail() po naprawie 404`. Czyli
zamówiona w moim promptcie asercja na status 404 **znalazła defekt, defekt naprawiono, a `test.fail()`
zdjęto** — dokładny cykl, o który prosiłem, wykonany w całości. Zapisuję to jako korektę, bo moja
rekomendacja mierzyła złą jednostkę: liczba plików specyfikacji nic nie mówi, liczba testów i zdjęte
`test.fail()` mówią wszystko.

Co zostaje: **nadal nie ma pełnej ścieżki end-to-end dla klubów, buildera, newslettera ani panelu
ustawień** — 54 testy skupiają się na SEO, SSR i checkoucie. Raport MODUŁU 20 sam wskazuje dwie
trasy, których nie dowieziono, bo są „renderem, nie decyzją", czyli dokładnie tym, co pokrywa e2e,
a nie test jednostkowy. Kolejne zlecenie modułowe powinno mieć e2e w zakresie od początku, a nie
jako etap dziewiąty.

**R5. Zregenerować snapshot autoryzacji — czerwień jest z PROWENIENCJI, nie z zawężenia uprawnień.**
`src/lib/authz/__tests__/authzSnapshotParity.test.ts` jest czerwony: 11 wpisów rozjazdu, wszystkie
o wadze **`[provenance]`** — „ta sama bramka, inna migracja" po konsolidacji siedmiu migracji z PR 281
do `20260822171037_bea8e790…sql`, plus „snapshot pochodzi ze starszego skanu migracji: 795 → 796".
Dotyczy bramek `chatham_house_events`, `early_access`, `event_ticket_discount_pct`,
`included_event_tickets`, `pro_briefings`, `recordings` na funkcjach `get_event_access/1`,
`rsvp_event/2`, `my_ticket_allowance/0`.

**Ani jednego wpisu o zawężeniu kręgu uprawnionych** — i to jest dokładnie ta informacja, dla której
ta bramka została zaprojektowana z podziałem komunikatu na wagi: „zawężenie uprawnień nie może
schować się między wpisami o przeniesionej definicji". Naprawa to jedna komenda:
`bun run generate:authz-snapshot` i commit wyniku. Ale **nie wolno jej wykonać odruchowo** —
regeneracja bez przeczytania raportu wag to mechanizm, którym ta bramka raz już umarła
(opisane w `src/lib/ci/gateCoverage.ts`). Tu raport jest przeczytany i mówi: regeneruj.

**R6. Jeden próg powyżej rzeczywistości — `components/pricing/molecules/**`, gałęzie 92,3% wobec 94.**
To jedyny z **334** progów per-ścieżka, który nie przechodzi, i jedyna przyczyna, dla której
`test:coverage` wychodzi kodem 1 poza dwoma czerwonymi testami. Powierzchnia jest nowa (praca nad
katalogiem członkostw v6.1), więc to nie regresja, a próg wpisany o 1,7 pp nad zmierzone. Mechanizm
i jego koszt są opisane w rozdziale 6.1: aspiracyjny próg wyłącza krok CI i wszystko, co za nim
stoi. Dwie dopuszczalne drogi, jak zawsze: dobić dwie brakujące gałęzie testem albo obniżyć próg do
zmierzonego z komentarzem „floor, nie cel". Czego nie robić: zostawić czerwono „do wyjaśnienia".

**R7. MODUŁ 14 (kupony / darowizny) — piąte wydanie z rzędu na dnie tabeli.**
27,10% linii i **17,93% funkcji**, 13 z 38 plików na zerze, **zero progów per-ścieżka**, 1 009
niepokrytych linii. Od 18 sierpnia ruszył o 4,5 pp, czyli w tempie szumu, podczas gdy pięć innych
modułów przeszło w tym czasie z kilkunastu procent na ponad 90. To już nie jest kwestia kolejki —
to moduł, którego nikt nie wziął, mimo że jest **najmniejszy z pozostałych** (38 plików, jedna piąta
długu modułu 3) i mimo że kupon i darowizna to transakcja: kwota, waluta, limit wykorzystań.
Zaraz za nim MODUŁ 17 (33,20%, +2,7 pp, 46 z 85 plików na zerze) i MODUŁ 21 (55,12%, **0,0 pp
we wszystkich pięciu wydaniach**).

**R8. Największa dziura bezwzględna to teraz `components/**` bez podziału — X-shell i moduł 3.**
Po czterech domknięciach ranking bezwzględny wygląda inaczej niż procentowy: MODUŁ 3 ma **5 129**
niepokrytych linii przy 76,03% (edytor bloków panelu), a powłoka panelu admin **2 915** przy 41,06%
i **zero progów per-ścieżka** na 172 plikach. X-shell jest jedyną dużą powierzchnią, która nigdy
nie dostała ani zadania, ani progu — a rośnie przy każdej ekstrakcji z tras. Kolejność na następne
dwa zlecenia: `components/admin/blocks/**` (reszta modułu 3, metoda znana i sprawdzona dwa razy),
potem powłoka panelu jako całość, z progiem na `/**` na końcu.

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
| **wzorowo**       | 99,0 | 2. Edytor wpisów i workflow redakcyjny                    | 99,3% |   98,7% |     21 |               6 |     0/103 |
| **wzorowo**       | 98,8 | 18. CRM                                                   | 99,0% |   98,6% |      1 |               6 |      0/57 |
| **wzorowo**       | 96,1 | 6. Wyszukiwarka                                           | 97,4% |   95,2% |      8 |               5 |      0/24 |
| **wzorowo**       | 96,0 | 8. SEO, feedy, dane strukturalne                          | 96,6% |   95,6% |     20 |               6 |      5/77 |
| **wzorowo**       | 95,7 | 15. Profil i konto                                        | 97,4% |   94,5% |     40 |               7 |      2/91 |
| **wzorowo**       | 94,7 | 5. Strona główna, archiwa, chrome                         | 96,5% |   93,5% |      1 |               5 |      1/62 |
| **wzorowo**       | 91,1 | 19. Ustawienia / integracje / users / multi-tenant / RODO | 93,1% |   89,8% |     36 |               7 |    15/131 |
| **wzorowo**       | 90,3 | 4. Strony, wygląd, motyw, media, import                   | 92,3% |   88,9% |      2 |               6 |     4/133 |
| **dobrze**        | 85,9 | 16. Społeczność: kluby, komentarze, moderacja             | 85,9% |   85,8% |     11 |               8 |    22/317 |
| **dobrze**        | 82,2 | 11. Newsletter i e-mail                                   | 81,5% |   82,7% |     65 |               4 |    29/147 |
| **dobrze**        | 81,3 | 10. Sieć / networking                                     | 82,0% |   80,9% |      2 |               4 |      3/32 |
| **dobrze**        | 80,1 | 1. Wpisy: doświadczenie czytelnika                        | 81,7% |   79,1% |     27 |               4 |    13/103 |
| **przeciętnie**   | 74,9 | design system (components/ui)                             | 79,9% |   71,5% |      0 |               1 |      4/43 |
| **przeciętnie**   | 74,0 | 13. Monetyzacja: checkout / subskrypcje / billing         | 67,7% |   78,3% |     19 |               6 |    32/185 |
| **przeciętnie**   | 73,2 | 3. Silniki treści: bloki + page builder                   | 76,0% |   71,3% |     17 |               7 |    70/454 |
| **przeciętnie**   | 71,0 | 20. Platforma / backend / infrastruktura / SSR            | 75,5% |   68,0% |     43 |               7 |    43/191 |
| **przeciętnie**   | 70,4 | słowniki i18n                                             | 92,5% |   55,6% |      0 |               2 |     1/119 |
| **przeciętnie**   | 59,6 | 9. Czat / komunikator                                     | 62,3% |   57,7% |      9 |               3 |     14/81 |
| **źle**           | 50,3 | 21. Rekrutacja / kariera                                  | 55,1% |   47,1% |      0 |               2 |     12/29 |
| **źle**           | 46,1 | 12. Realtime / powiadomienia / web-push                   | 48,4% |   44,5% |      0 |               3 |     12/28 |
| **źle**           | 41,0 | 7. Typy treści specjalne                                  | 44,8% |   38,4% |      2 |               6 |    43/118 |
| **źle**           | 39,3 | powłoka panelu admin + atomy/molekuły                     | 41,1% |   38,0% |      0 |               4 |    34/172 |
| **beznadziejnie** | 30,4 | 17. Analityka i BI                                        | 33,2% |   28,5% |      8 |               3 |     46/85 |
| **beznadziejnie** | 21,6 | 14. Monetyzacja: kupony / darowizny / prezenty / reklamy  | 27,1% |   17,9% |      0 |               2 |     13/38 |

Rozkład: **8** wzorowo · **4** dobrze · **6** przeciętnie · **4** źle · **2** beznadziejnie.

**Ocena całości: PRZECIĘTNIE — ale przy górnej krawędzi tej oceny i po realnej poprawie.**
Baza dla całego repo liczona tą samą rubryką: **73,4** — po 53,4 w wydaniu 3 i 65,7
w wydaniu 4. Do progu „dobrze” (75) brakuje mniej niż dwóch punktów.
Rozbijam to na pięć osobnych ocen, bo jedna liczba tego nie opisuje:

1. **Poziom pokrycia — PIERWSZY warunek „dobrze” spełniony, drugi nie.** 75,10% linii
   i 72,19% funkcji na 2 820 plikach produkcyjnych. W wydaniu 3 postawiłem próg: za „dobrze”
   uznam **75%+ linii przy żadnym module poniżej 60%**. Linie: 75,10% — spełnione. Modułów poniżej
   60% jest 6: M21 (55,1%), M12 (48,4%), M7 (44,8%), powłoka panelu admin + atomy/molekuły (41,1%), M17 (33,2%), M14 (27,1%).
   Dlatego ocena zostaje „przeciętnie”, choć jest to już przeciętnie o innym charakterze:
   trzy czwarte linii i blisko trzy czwarte funkcji aplikacji ktoś kiedykolwiek uruchomił w teście.
   Pięć dni temu była jedna trzecia. Średni refaktor przestał być hazardem; duży nadal nim jest
   na tych 6 powierzchniach.
2. **Rozkład — pierwszy raz w tej historii wygląda dobrze.** 6 z 24 powierzchni ma ocenę „źle”
   albo „beznadziejnie” — po 12 z 24 w wydaniu 3 i 10 w wydaniu 4. „Beznadziejnie” spadło z czterech
   do 2, a „wzorowo” urosło z pięciu do 8. Zmiana nie wzięła się z równomiernego
   podnoszenia średniej, a z **czterech celowanych akcji w dwóch dniach**: MODUŁ 19 z „beznadziejnie”
   (25,2) na „wzorowo” (91,1), MODUŁ 15 ze „źle” (53,6) na „wzorowo” (95,7), MODUŁ 8 ze „źle” (54,4)
   na „wzorowo” (96,0), MODUŁ 20 ze „źle” (47,7) na „przeciętnie” (71,0). Model „jedno zlecenie =
   jedna powierzchnia, jawny cel, próg na końcu” zadziałał piąty i szósty raz z rzędu — więc dwa
   pozostałe „beznadziejnie” (MODUŁ 14 i 17) to nie problem metody, tylko kolejki.
3. **Uczciwość pomiaru — dobrze, miejscami wzorowo.** `all: true` na całym `src/`, pliki bez testów
   w mianowniku, zero whitelistu. To repo ma za sobą epizod raportowania **98%** z 38 plików
   z pętlami renderującymi bez asercji — i sam ten epizod usunęło. Gęstość asercji
   1,98 na test, stabilna w każdym rodzaju testu, potwierdza, że dzisiejsze liczby nie są farmione.
4. **Infrastruktura dowodu — wzorowo.** 334 progów per-ścieżka, 33 bramek `check:*`
   (w tym META-bramka „bramka, która istnieje, musi się uruchamiać”), 98 plików pgTAP
   z 1 840 asercjami na RLS i RPC, klasyfikacja testów na jedenaście rodzajów. Większość projektów
   tej wielkości nie ma nawet połowy tego aparatu. To jest realny atut i on nie wynika z procentu.
5. **Zabezpieczenie dorobku — POPRAWIONE, ale niedokończone.** Próg globalny stoi
   10,1 pp pod pomiarem na liniach — tyle pokrycia można stracić, nie łamiąc progu globalnego.
   Bez ANI JEDNEGO progu per-ścieżka jest 6 z 24 powierzchni: design system (components/ui) (79,9%), słowniki i18n (92,5%), MODUŁ 21 (55,1%), MODUŁ 12 (48,4%), powłoka panelu admin + atomy/molekuły (41,1%), MODUŁ 14 (27,1%).
   Najgroźniejsza z nich to powłoka panelu admina: 2 915 niepokrytych linii, 172 pliki, zero
   progów — jedyna duża powierzchnia, która nigdy nie dostała ani zadania, ani zapadki, i która
   rośnie przy każdej ekstrakcji z tras (poz. R8 w 8.1).
   Druga rzecz: jeden z 334 progów jest dziś wpisany NAD zmierzone
   (`components/pricing/molecules/**`, gałęzie 92,3% wobec 94) i to on — obok dwóch czerwonych
   testów — powoduje, że bramka pokrycia wychodzi kodem 1. Mechanizm w rozdz. 6.1, naprawa w R6.

**Trajektoria zasługuje na osobne zdanie: super.** 32,71% → 75,10% linii w pięć dni, przy suicie
rosnącej z 817 do 1 551 plików i z ~8,3 tys. do 41 294 testów, to nie jest normalne tempo.
Jedenaście modułów przeszło z kilkunastu procent do ponad 80: edytor **+91,0 pp**, CRM +87,0, chrome
+79,8, profil i konto **+78,3**, wygląd/media +69,6, kluby +68,4, wyszukiwarka +64,2, newsletter
+54,8, SEO **+46,3**, billing +35,0, ustawienia i RODO **+71,1**. Ocena „przeciętnie” dotyczy
STANU, nie pracy — i przy tym tempie decyduje już wyłącznie kolejność, w jakiej bierze się
pozostałe powierzchnie. Rozdział 8.1 podaje tę kolejność.

**Zastrzeżenia per moduł — tam, gdzie sama liczba kłamie albo jest niepełna:**

- **MODUŁ 2** (wzorowo, baza 99,0) — wzorowo i UTRWALONE: 21 progów per-ścieżka pilnuje tego poziomu, więc jedna zmiana go nie zdejmie. Wzorzec do kopiowania w pozostałych modułach.
- **MODUŁ 18** (wzorowo, baza 98,8) — wzorowo, ale BEZ ZAPORY: 98,98% linii chroni jeden próg per-ścieżka. Ten poziom powstał w ciągu dwóch dni i jeden PR bez testów może go zdjąć, nie łamiąc żadnej bramki.
- **MODUŁ 6** (wzorowo, baza 96,1) — wzorowo, przy czym ranking i operatory dowodzi pgTAP (9 plików) — to przykład powierzchni, na której wysoki procent jednostkowy i mocna warstwa bazy zgadzają się co do wniosku.
- **MODUŁ 8** (wzorowo, baza 96,0) — +40,6 pp (56,08% → 96,64%), funkcje 53,25% → 95,58%, progi 2 → 20. Zadanie zostało wykonane z CELEM RÓŻNICOWANYM, o który prosiłem: praca poszła w panel SEO admina (7 z 9 plików było na 0–3%), udostępnianie i gałęzie generatorów, a trasy feedów zostały świadomie w spokoju, bo dowodzi ich `e2e/seo.spec.ts`. To jedyny moduł w tej historii, w którym płaski cel 95/93 byłby błędem — i nie został postawiony.
- **MODUŁ 15** (wzorowo, baza 95,7) — z „ŹLE” (53,6) na „WZOROWO” (95,7) w jednym zadaniu: 56,03% → 97,42% linii (+41,4 pp), funkcje 51,95% → 94,51%, plików na zerze 28 → 2, progi 15 → 40. Domknięte to, co wisiało trzy wydania: ustawienia logowania z 2,5% i zera funkcji, pulpit profilu, panel bezpieczeństwa, zainteresowania. Osobny próg na `export.functions.ts` (eksport RODO) — czyli liczba przestała chować plik na zerze za średnią katalogu, o co prosiłem wprost.
- **MODUŁ 5** (wzorowo, baza 94,7) — wzorowo DZIŚ, bez gwarancji na jutro: ani jednego progu per-ścieżka na powierzchni obecnej na każdej stronie serwisu. Chrome z 96,15% i bez zapory to dorobek pożyczony.
- **MODUŁ 19** (wzorowo, baza 91,1) — NAJWIĘKSZY SKOK POJEDYNCZEGO MODUŁU W CAŁEJ HISTORII TEGO AUDYTU: 27,98% → 93,08% linii (+65,1 pp), funkcje 23,35% → 89,84%, plików na zerze 56 → 15, progi 8 → 36. Trzynaście powierzchni domkniętych do 95%+, 36 defektów zapisanych. Ocena z „beznadziejnie” (25,2) na „wzorowo” (91,1) w jednym zadaniu. To jest dowód, że model „jedno zlecenie = jedna powierzchnia, jawny cel, próg na końcu” działa nawet na powierzchni, która przez cztery wydania stała w miejscu.
- **MODUŁ 4** (wzorowo, baza 90,3) — wzorowo bez zapory (zero progów). Połowa tego pokrycia to czysta matematyka kadrowania i tokenów motywu — najtańszy dowód o największym zasięgu, i najłatwiejszy do utracenia bez progu.
- **MODUŁ 16** (dobrze, baza 85,9) — domknięte w wydaniu 4 i STABILNE: 85,92% linii, 85,79% funkcji, −0,2 pp (dylucja od nowego kodu, nie regresja testów). Kluby właściwe stoją po ~97%, a 22 pozostałe zera to społeczność (`admin.community.qa`, `events`, `polls`, `badges`, bilety) — część, która była poza zakresem tamtego zadania. Mianownik urósł z 252 na 317 plików, bo 28 modułów reguł wyszło z JSX-a.
- **MODUŁ 11** (dobrze, baza 82,2) — dobrze i najlepiej utrwalone w całym repo: 65 progów per-ścieżka, najwięcej z wszystkich modułów. 29 z 147 plików nadal na zerze, więc jest co domykać, ale osunąć się to nie może.
- **MODUŁ 10** (dobrze, baza 81,3) — dobrze i spójnie: warstwa danych jest RPC-only i objęta progiem 95/98, więc moduł nie dryfuje między wydaniami. 3 pliki na zerze z 32 to najlepszy wynik w tej klasie.
- **MODUŁ 1** (dobrze, baza 80,1) — dobrze, z zastrzeżeniem rodzaju: reguły paywalla i meteringu mają testy i progi, ale to, co czytelnik widzi, dowodzi się renderem — a 13 z 86 plików nie wykonuje ani jednej linii.
- **design system (components/ui)** (przeciętnie, baza 74,9) — procent zaniża wartość tej powierzchni: jeden test kontraktu atomu (rola, etykieta, stan wyłączony) chroni każde jego użycie w repo, a plików na zerze zostało 4 ze 43. Ale wciąż tylko JEDEN rodzaj testu (komponentowy) i ZERO progów per-ścieżka — przy 43 plikach, z których korzysta cała aplikacja.
- **MODUŁ 13** (przeciętnie, baza 74,0) — CZYTAĆ ODWROTNIE, NIŻ WYGLĄDA: funkcje (76,36%) są wyżej niż linie (66,32%), co znaczy, że ścieżka płatność → dostęp ma testy funkcji serwerowych z wysokimi progami, a nietestowana jest powłoka UI. To właściwa kolejność priorytetów — dowód jest tam, gdzie idą pieniądze. Ale rezygnacja i zmiana planu to interfejs: UI może pokazać „anulowano”, gdy żądanie padło, i żaden test serwerowy tego nie zauważy.
- **MODUŁ 3** (przeciętnie, baza 73,2) — +23,3 pp (52,34% → 75,66%), funkcje 38,73% → 70,94%, zera 120 → 72 — ale NADAL największa bezwzględna dziura systemu: 5 195 niepokrytych linii. Sześć powierzchni buildera domknięto do 95/93 (panele widgetów 97,34% linii, publiczny render bloków 97,85%, rdzeń silnika 99,41%), więc to, co zostało, jest skoncentrowane i nazwane: **edytor bloków w panelu** (`components/admin/blocks/**` — `BlockCanvas` 218 LOC, `edit/Paragraph` 167, `NestedBlocksEditor` 107, `SortableBlockItem` 93, `edit/Heading` 92, `useBlockClipboard` 77, wszystkie na zerze) oraz DRUGA ścieżka importu WordPressa. Ta druga jest najciekawszym znaleziskiem tego wydania i opisuję ją osobno niżej.
- **MODUŁ 20** (przeciętnie, baza 71,0) — +20,3 pp (55,12% → 75,45%), funkcje 42,82% → 68,03%, progi 11 → 43. Raport wdrożenia sam mówi w pierwszym akapicie, że cel modułowy 88/85 NIE został osiągnięty — i to jest właściwe raportowanie, nie porażka: jedenaście powierzchni na celu, trzy pod celem tylko na gałęziach nieosiągalnych, dwie trasy świadomie nietknięte jako „render, nie decyzja”. Zamówiona bramka zakresu najemcy znalazła defekt schematu w SQL-u (`page_full_path`), którego nie widziało 98 plików pgTAP. Zostaje 2 128 niepokrytych linii i 43 z 191 plików na zerze.
- **słowniki i18n** (przeciętnie, baza 70,4) — TA LICZBA NIE PODLEGA OCENIE PROCENTEM. 92,49% linii przy 55,03% funkcji to artefakt zaimportowania obiektu — słowniki nie mają logiki, więc „pokryta linia” nic tu nie dowodzi. Jedynym sensownym dowodem jest bramka parytetu PL/EN i cztery `check:i18n-*`. Te istnieją i działają, więc powierzchnia jest zabezpieczona DOBRZE, mimo że jej procent jest bez treści.
- **MODUŁ 9** (przeciętnie, baza 59,6) — przeciętnie, ale to najlepszy przykład skutecznej metody w tym repo: mieszanka testu warstwy danych z atrapą łańcucha PostgREST, testu hooka i testu reguł wątku wyciągnęła moduł z 17% na obecny poziom. Nie liczba testów to zrobiła, a dobór rodzaju.
- **MODUŁ 21** (źle, baza 50,3) — źle i bez zapory, przy najczęściej wypełnianym formularzu przez osoby z zewnątrz — i **0,0 pp ruchu we wszystkich pięciu wydaniach**, jedyny taki moduł w repo. 55,12% linii, 47,13% funkcji, 12 z 29 plików na zerze, zero progów. Jedyna pociecha: bramka `check:careers-harness` istnieje, bo złamany CHECK w bazie już raz przeszedł przy zielonym CI.
- **MODUŁ 12** (źle, baza 46,1) — źle i mylące: bez atrapy kanału test dowodzi tylko, że subskrypcja została utworzona, i przechodzi przy PUSTYM handlerze zdarzenia. Na tej powierzchni procent może rosnąć bez wzrostu dowodu — zero progów per-ścieżka tego nie wyłapie.
- **MODUŁ 7** (źle, baza 41,0) — źle przy ośmiu różnych typach treści dzielących jeden wzorzec: reguły domenowe mają testy, funkcje serwerowe i loadery nie. Rezerwacja miejsc jest tu przypadkiem skrajnym — baza pilnuje kolejki, aplikacja może nigdy o wolne miejsce nie zapytać.
- **powłoka panelu admin + atomy/molekuły** (źle, baza 39,3) — źle i to jest dług architektoniczny, nie testowy — a teraz także NAJWIĘKSZA duża powierzchnia bez własnego zadania: 41,06% linii, 2 915 niepokrytych linii, 34 z 172 plików na zerze i ZERO progów per-ścieżka. Rośnie przy każdej ekstrakcji z tras, bo catch-all `^src/components/` łapie wszystko, czego nie złapał wcześniejszy wzorzec (w tym wydaniu poprawiłem trzy takie przypisania — rozdz. 9.1). Wartość pracy tutaj mierzy się nie procentem, a tym, ile powtórzeń JSX-a udało się zamknąć w jednym testowanym atomie.
- **MODUŁ 17** (beznadziejnie, baza 30,4) — beznadziejnie i po tych pięciu dniach RELATYWNIE najgorzej: 33,20% linii, 28,49% funkcji, 46 z 85 plików na zerze, +2,7 pp. Ratuje sens jedna rzecz — warstwa semantyczna analityki jest pokryta w 100% i objęta progiem, a od niej zależy KAŻDA liczba w raporcie zarządczym. Reszta to widoki i wykresy, gdzie brakuje testów a11y: wykres bez alternatywy tekstowej jest dla części odbiorców pustym prostokątem. Drugi w kolejce po module 14.
- **MODUŁ 14** (beznadziejnie, baza 21,6) — BEZNADZIEJNIE, PIĄTE WYDANIE Z RZĘDU: 27,10% linii, 17,93% funkcji (najniższy wymiar funkcyjny w repo), 13 z 38 plików na zerze, ZERO progów per-ścieżka. Od 18 sierpnia +4,5 pp, czyli tempo szumu, podczas gdy pięć innych modułów przeszło w tym czasie z kilkunastu procent na ponad 90. To już nie kwestia kolejki: moduł jest NAJMNIEJSZY z pozostałych (1 009 niepokrytych linii, jedna piąta długu modułu 3), a kupon i darowizna to transakcja — kwota, waluta, limit wykorzystań.

**Jedno zdanie, gdyby trzeba było wybrać jedno.** Cztery dni temu napisałem, że to projekt z mocnym
aparatem dowodowym i połową powierzchni, na której nikt nie zaczął — dziś ta połowa jest o dwie
powierzchnie mniejsza, a ryzyko skupiło się w 2 modułach zamiast czterech. Metoda jest
udowodniona (dwa zamówione zadania, dwa domknięcia, 24 znalezione defekty), więc pytanie nie brzmi
już „czy da się”, a „w jakiej kolejności” — i pierwszą pozycją jest MODUŁ 19, bo tam defekt jest
zdarzeniem prawnym, a moduł nie dostał ani jednego z 186 nowych plików testowych.

---

## 9. Załączniki

### 9.1 Reguły mapowania plik → moduł

Mapowanie jest deterministyczne (pierwsze trafienie wygrywa) i w całości oparte na ścieżkach.
Wzorce w kolejności stosowania, per moduł:

**Korekta wprowadzona w tym wydaniu — zgłaszam ją, bo psuje porównywalność trzech wierszy.**
Zadanie MODUŁU 20 wyodrębniło z tras 28 komponentów publicznych (`components/readingList`,
`components/home`, `components/people`). Wpadały one w catch-all `^src/components/` → X-shell,
czyli „powłoka panelu ADMIN” — semantycznie błędnie, bo to strony czytelnika. Poprawiłem
przypisanie: `home` → MODUŁ 5, `readingList` → MODUŁ 1, `people` → MODUŁ 15. Skutek:
X-shell wraca ze 200 na 172 pliki, a moduły 1, 5 i 15 dostają po kilkanaście plików o pokryciu
bliskim 100% (były świeżo testowane). **Delta tych czterech wierszy w rozdziale 2.1 jest więc
częściowo artefaktem korekty mapy, a nie samą pracą testową** — pozostałe dwadzieścia wierszy
jest porównywalne bez zastrzeżeń. Alternatywą było zostawienie błędnego przypisania, które przy
każdej kolejnej ekstrakcji z tras psułoby obraz coraz bardziej.

| #   | Moduł                                                 | Wzorce ścieżek                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Wpisy: doświadczenie czytelnika                       | `src/lib/access/`, `src/lib/toc/`, `src/lib/footnotes`, `src/lib/manualToc`, `src/lib/keyTakeaways/`, `src/lib/citations/`, `src/lib/audio/`, `src/lib/readingTime`, `src/lib/postLayouts`, `src/lib/relatedPosts`, `src/lib/relatedInsights`, `src/lib/relatedClickBeacon`, `src/components/post/`, `src/components/PostLayoutRenderer`, `src/components/Paywall`, `src/components/author/`, `src/components/audio/`, `src/components/molecules/MeterBanner`, `src/components/atoms/QuotaMeter`, `src/hooks/(useContentAccess                                                                                                                                                                                                   | useUnlockedContent                                        | usePasswordUnlock                                  | useRecordPostView                                | useSaveArticle                     | useBookmarks                 | useReadingTimeSettings                                             | usePostLayoutSettings                     | useRecommendedPosts)`, `src/components/readingList/`, `src/routes/post\.`, `src/routes/preview\.`, `src/routes/admin\.(key-takeaways | toc           | post-layouts | related-posts)`, `src/routes/api/public/(post-tts | related-click)`, `src/routes/api/(tts | stt)` |
| 2   | Edytor wpisów i workflow redakcyjny                   | `src/components/admin/post-editor/`, `src/components/admin/versions/`, `src/components/admin/workflows/`, `src/lib/revisions`, `src/lib/posts-migrate`, `src/hooks/useAutosave`, `src/hooks/useEditPresence`, `src/hooks/useHistory`, `src/hooks/useUnsavedChangesGuard`, `src/lib/unsavedChanges`, `src/routes/admin\.(posts                                                                                                                                                                                                                                                                                                                                                                                                    | scheduler                                                 | calendar)`, `src/routes/admin\.(versions           | workflows                                        | redirects                          | import-wordpress             | contributors)`, `src/components/admin/(PostEditor                  | PostGeneralOverview)`                     |
| 3   | Silniki treści: bloki + page builder                  | `src/lib/blocks/`, `src/lib/builder/`, `src/lib/content/`, `src/lib/content-model/`, `src/lib/sidebarBuilder/`, `src/lib/patterns/`, `src/lib/wp-import`, `src/lib/wordpress-import`, `src/lib/sanitize`, `src/lib/content\.functions`, `src/components/blocks/`, `src/components/builder/`, `src/components/patterns/`, `src/components/content/`, `src/components/admin/blocks/`, `src/components/admin/builder/`, `src/components/admin/sidebarBuilder/`                                                                                                                                                                                                                                                                      |
| 4   | Strony, wygląd, motyw, media, import                  | `src/lib/theme/`, `src/lib/media`, `src/lib/layout/`, `src/lib/pageTemplates`, `src/lib/archive-layout-settings`, `src/lib/expertLayouts`, `src/lib/cropSizes`, `src/lib/cardImageSizes`, `src/lib/brand`, `src/lib/icons/`, `src/lib/icon`, `src/components/media/`, `src/components/theme/`, `src/components/icons/`, `src/components/pages/`, `src/components/admin/media/`, `src/components/admin/theme-design/`, `src/components/admin/archiveLayout/`, `src/hooks/(useGlobalColors                                                                                                                                                                                                                                         | useExpertLayoutSettings)`, `src/routes/admin\.(appearance | media                                              | pages                                            | theme                              | categor                      | tags?)`, `src/routes/admin\.(icons                                 | crop-sizes                                | content-area                                                                                                                         | custom-meta)` |
| 5   | Strona główna, archiwa, chrome                        | `src/components/header/`, `src/components/footer/`, `src/components/menu/`, `src/components/megaMenu/`, `src/components/mobile/`, `src/components/archive/`, `src/components/home/`, `src/lib/menus/`, `src/lib/megaMenu/`, `src/lib/mobileBottomBar/`, `src/lib/mobileDrawer`, `src/lib/breadcrumbs`, `src/lib/categoryAreas`, `src/components/admin/menu/`, `src/routes/(category                                                                                                                                                                                                                                                                                                                                              | tag                                                       | blog                                               | series                                           | publications)\.`                   |
| 6   | Wyszukiwarka                                          | `src/lib/search/`, `src/components/search/`, `src/hooks/useSavedSearches`, `src/routes/search`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 7   | Typy treści specjalne                                 | `src/lib/tracker/`, `src/components/tracker/`, `src/lib/experts/`, `src/components/experts/`, `src/components/admin/experts/`, `src/lib/programs/`, `src/components/programs/`, `src/lib/events/`, `src/components/events/`, `src/lib/podcast/`, `src/components/podcast/`, `src/components/admin/podcasts/`, `src/lib/web-stories/`, `src/components/web-stories/`, `src/components/quiz/`, `src/lib/files/`, `src/components/files/`, `src/lib/maps/`, `src/components/maps/`, `src/routes/.*(tracker                                                                                                                                                                                                                          | expert                                                    | program                                            | event                                            | podcast                            | web-stor                     | quiz                                                               | librar                                    | glossar                                                                                                                              | poll          | qa           | live)`                                            |
| 8   | SEO, feedy, dane strukturalne                         | `src/lib/seo/`, `src/components/seo/`, `src/lib/social/`, `src/lib/links/`, `src/lib/customMeta`, `src/components/share/`, `src/components/admin/seo/`, `src/routes/.*(sitemap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | robots                                                    | rss                                                | feed                                             | llms                               | og-                          | seo)`                                                              |
| 9   | Czat / komunikator                                    | `src/lib/chat/`, `src/components/chat/`, `src/lib/composer/`, `src/components/composer/`, `src/lib/mentions/`, `src/components/mentions/`, `src/routes/.*(chat                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | messages)`                                                |
| 10  | Sieć / networking                                     | `src/lib/network/`, `src/components/network/`, `src/hooks/useFollow`, `src/routes/.*network`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 11  | Newsletter i e-mail                                   | `src/lib/newsletter`, `src/components/newsletter/`, `src/components/admin/newsletter/`, `src/lib/email`, `src/lib/system-emails`, `src/lib/tx-email-preview`, `src/lib/auth-email`, `src/hooks/useMyNewsletterStatus`, `src/hooks/useNewsletterSettings`, `src/components/popups/`, `src/routes/.*newsletter`, `src/routes/.*email`, `src/routes/(unsubscribe                                                                                                                                                                                                                                                                                                                                                                    | api/public/nl-)`, `src/components/admin/popups/`          |
| 12  | Realtime / powiadomienia / web-push                   | `src/lib/realtime/`, `src/lib/notifications/`, `src/components/notifications/`, `src/routes/.*notification`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 13  | Monetyzacja: checkout / subskrypcje / billing         | `src/lib/billing/`, `src/lib/stripe`, `src/lib/pricing/`, `src/components/billing/`, `src/components/checkout/`, `src/components/pricing/`, `src/components/membership-join/`, `src/components/admin/billing/`, `src/components/admin/pricing/`, `src/hooks/useCheckout`, `src/routes/.*(billing                                                                                                                                                                                                                                                                                                                                                                                                                                 | checkout                                                  | pricing                                            | membership                                       | subscription)`, `src/routes/(plans | api/public/payments          | api/public/fx-rate)`                                               |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  | `src/lib/gifting`, `src/components/gifting/`, `src/components/donations/`, `src/lib/ads/`, `src/components/ads/`, `src/components/admin/coupons/`, `src/hooks/useValidateCoupon`, `src/routes/.*(gift                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | donat                                                     | coupon                                             | ads)`                                            |
| 15  | Profil i konto                                        | `src/components/people/`, `src/lib/profile/`, `src/lib/account`, `src/lib/auth/`, `src/lib/authSettings`, `src/lib/interests/`, `src/lib/retention/`, `src/lib/onboarding/`, `src/components/profile/`, `src/components/auth/`, `src/components/interests/`, `src/components/admin/auth/`, `src/components/admin/onboarding/`, `src/hooks/useAuth`, `src/hooks/useAuthSettings`, `src/hooks/useInterests`, `src/routes/(login                                                                                                                                                                                                                                                                                                    | signup                                                    | account                                            | profile                                          | auth)`, `src/routes/.*(profile     | account                      | onboarding)`, `src/routes/(reset-password                          | support                                   | contribute)`                                                                                                                         |
| 16  | Społeczność: kluby, komentarze, moderacja             | `src/lib/clubs/`, `src/lib/community/`, `src/lib/comments/`, `src/components/clubs/`, `src/components/community/`, `src/components/comments/`, `src/components/admin/clubs/`, `src/components/admin/community/`, `src/routes/.*(club                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | community                                                 | comment                                            | badge)`                                          |
| 17  | Analityka i BI                                        | `src/lib/analytics/`, `src/lib/observability/`, `src/lib/charts/`, `src/lib/counters/`, `src/lib/views/`, `src/lib/webVitals`, `src/lib/tracker-admin`, `src/components/charts/`, `src/components/admin/analytics/`, `src/components/admin/performance/`, `src/routes/.*(analytics                                                                                                                                                                                                                                                                                                                                                                                                                                               | semantic)`, `src/routes/api/public/(track                 | vitals                                             | client-errors)`, `src/routes/admin\.(performance | experiments                        | link-monitor)`               |
| 18  | CRM                                                   | `src/lib/crm`, `src/components/admin/crm/`, `src/lib/organizations/`, `src/lib/csv/`, `src/routes/.*crm`, `src/routes/admin\.(companies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | contact)`                                                 |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO | `src/lib/authz/`, `src/lib/consent`, `src/lib/cookieBanner/`, `src/lib/legal/`, `src/lib/integrations/`, `src/lib/tenant`, `src/lib/features/`, `src/lib/personalization/`, `src/lib/greetings/`, `src/lib/admin/`, `src/lib/adminToasts`, `src/lib/useSiteSetting`, `src/lib/joinUsSync`, `src/lib/contact\.functions`, `src/components/legal/`, `src/components/consent/`, `src/components/admin/permissions/`, `src/components/admin/users/`, `src/components/admin/settings/`, `src/components/admin/cookie-banner/`, `src/components/admin/google-source/`, `src/hooks/(usePersonalizedSettings                                                                                                                             | useCheckoutSettings)`, `src/routes/admin\.(settings       | users                                              | integrations                                     | permissions                        | consent                      | organizations                                                      | audience)`, `src/routes/admin\.(greetings | names                                                                                                                                | personalized  | popups)`     |
| 20  | Platforma / backend / infrastruktura / SSR            | `src/lib/ssr`, `src/lib/server/`, `src/lib/http/`, `src/lib/supabase`, `src/integrations/`, `src/lib/ci/`, `src/lib/queries/`, `src/lib/async`, `src/lib/errors/`, `src/lib/error`, `src/lib/watchdog/`, `src/lib/routing/`, `src/lib/a11y/`, `src/lib/code/`, `src/lib/mcp/`, `src/lib/prerender`, `src/lib/edgeCache`, `src/lib/platform-error-reporting`, `src/lib/cacheBusting`, `src/lib/ai-gateway`, `src/lib/redirects`, `src/lib/text/`, `src/lib/utils`, `src/lib/deepMerge`, `src/lib/storageKeys`, `src/lib/rafThrottle`, `src/lib/smoothAnchorScroll`, `src/lib/overlayCoordinator`, `src/lib/appDialogs`, `src/lib/loginPopupBus`, `src/lib/toastError`, `src/lib/countries`, `src/components/error/`, `src/(router | server                                                    | start)\.`, `src/utils/`, `src/routes/`, `src/lib/` |
| 21  | Rekrutacja / kariera                                  | `src/lib/careers/`, `src/lib/jobs/`, `src/components/careers/`, `src/routes/.*(career                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | job)`, `src/routes/admin\.hiring`                         |
| —   | PRZEKROJOWE: słowniki i18n                            | `src/lib/i18n-`, `src/lib/i18n\.ts$`, `src/lib/i18n/`, `src/lib/locale/`, `src/components/admin/i18n/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    | `src/components/(atoms                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | molecules                                                 | forms                                              | features)/`, `src/components/admin/(atoms        | molecules                          | hooks)/`, `src/lib/(features | hooks)/`, `src/components/admin/`, `src/components/`, `src/hooks/` |
| —   | PRZEKROJOWE: design system (components/ui)            | `src/components/ui/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

Rozbicie liczby plików produkcyjnych:

| #   | Moduł                                                 | Pliki | LOC (surowe) | Pliki testowe | LOC testów |
| --- | ----------------------------------------------------- | ----: | -----------: | ------------: | ---------: |
| 1   | Wpisy: doświadczenie czytelnika                       |   103 |       13 451 |            54 |     12 421 |
| 2   | Edytor wpisów i workflow redakcyjny                   |   103 |       14 724 |            88 |     23 835 |
| 3   | Silniki treści: bloki + page builder                  |   455 |      110 742 |           271 |     67 574 |
| 4   | Strony, wygląd, motyw, media, import                  |   134 |       16 886 |            74 |     15 564 |
| 5   | Strona główna, archiwa, chrome                        |    62 |       10 031 |            29 |      8 022 |
| 6   | Wyszukiwarka                                          |    24 |        4 668 |            21 |      6 119 |
| 7   | Typy treści specjalne                                 |   118 |       25 639 |            58 |     13 311 |
| 8   | SEO, feedy, dane strukturalne                         |    77 |       10 794 |            68 |     20 739 |
| 9   | Czat / komunikator                                    |    81 |       15 602 |            36 |      9 164 |
| 10  | Sieć / networking                                     |    32 |        5 162 |            23 |      5 298 |
| 11  | Newsletter i e-mail                                   |   147 |       28 636 |            88 |     26 865 |
| 12  | Realtime / powiadomienia / web-push                   |    28 |        5 374 |            13 |      1 672 |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |   185 |       26 620 |            91 |     24 210 |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |    38 |        7 786 |            11 |      1 402 |
| 15  | Profil i konto                                        |    91 |       19 369 |            71 |     32 167 |
| 16  | Społeczność: kluby, komentarze, moderacja             |   317 |       60 327 |           198 |     74 867 |
| 17  | Analityka i BI                                        |    85 |       16 520 |            19 |      2 229 |
| 18  | CRM                                                   |    57 |       16 062 |            32 |     10 336 |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |   131 |       24 111 |            50 |     20 684 |
| 20  | Platforma / backend / infrastruktura / SSR            |   192 |       58 564 |           193 |     73 707 |
| 21  | Rekrutacja / kariera                                  |    29 |        5 231 |            11 |      2 202 |
| —   | PRZEKROJOWE: słowniki i18n                            |   119 |       41 711 |             6 |        528 |
| —   | NIEPRZYPISANE                                         |     0 |            0 |            11 |      1 976 |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    |   172 |       28 336 |            33 |      7 485 |
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
bun run test:coverage          # próg globalny + 334 progów per-ścieżka
```

Od wdrożenia R1 z wydania 1 (`coverage.reportOnFailure: true` w configu) raport i progi powstają
TAKŻE na czerwonej suicie, więc powyższe jedno polecenie wystarcza — obejście z wydania 1 nie jest
już potrzebne. Pełny przebieg na tym HEAD: 9 min 10 s, 1 551 plików testowych, 41 294 testów
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
- `docs/WDROZENIE_USTAWIENIA_INTEGRACJE_MODUL_19_2026-08-22.md` (413 wierszy) — trzynaście
  powierzchni z 28% na 95%+, **36 defektów w siedmiu klasach** (z klasą dominującą „awaria odczytu
  udaje pustkę”), dwie bramki, rozdział „Nie osiągnięto 95% w:”.
- `docs/WDROZENIE_PLATFORMA_POKRYCIE_MODUL_20_2026-08-22.md` (400 wierszy) — jedenaście powierzchni
  na celu, **cel modułowy 88/85 NIE osiągnięty** (83,34% linii / 82,21% funkcji) i powiedziane to
  w pierwszym akapicie, 38 defektów, osobny rozdział „Do zgłoszenia człowiekowi” o defekcie schematu
  `page_full_path` oraz rozdział „Trzy założenia zlecenia, które okazały się nieprawdziwe”.

Ten drugi jest wzorcem raportowania, którego wcześniej w tym repo nie było: podaje wynik PONIŻEJ
celu w pierwszym akapicie, wymienia test, który był flaky przed pracą i nadal jest, i koryguje
założenia zlecenia. Raport, który tego nie robi, jest nieweryfikowalny.

Oba mają rozdział o tym, czego NIE osiągnięto, z numerami linii. To rzadkie i warto to zapisać:
raport wdrożenia, który wymienia własne luki, jest sprawdzalny; raport, który podaje tylko
procenty, nie jest.
