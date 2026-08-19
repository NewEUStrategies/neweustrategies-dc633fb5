# Audyt pokrycia testami: moduł po module, funkcja po funkcji (2026-08-19)

**Wydanie 2 pomiaru.** Wydanie 1 (2026-08-18) mierzyło HEAD `e83570c` i musiało wykluczyć
39 plików testowych. To wydanie mierzy HEAD `86417e9` w całości — 358 commitów później,
po pracy testowej, która podniosła suitę z 817 do 1 230 plików testowych.
Plik pozostaje pod tą samą nazwą, bo odwołuje się do niego komentarz przy progu globalnym
w `vitest.config.ts` oraz prompty modułowe. Zmiany względem wydania 1 są w rozdziale 2.1.

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
| Plików produkcyjnych w mianowniku  | 2 696                                                                                                                                                     |
| Plików testowych zmierzonych       | 1 230 z 1 230 (100,0%)                                                                                                                                    |
| Przypadków testowych wykonanych    | 21 835 (statyczny licznik `it/test` w plikach: 19 416; różnica to rozwinięcia `it.each`)                                                                  |
| Testy poza pomiarem                | brak — cała suita weszła do pomiaru                                                                                                                       |
| Testy czerwone w tym przebiegu     | 1 (rozdział 8.1, pozycja R2)                                                                                                                              |
| Data pomiaru                       | 2026-08-19, HEAD `86417e9`                                                                                                                                |

**Cztery zastrzeżenia, bez których te procenty można źle odczytać:**

1. **Pokrycie ≠ poprawność.** Instrukcja „pokryta” to instrukcja, która się WYKONAŁA w trakcie
   testu — nie taka, której wynik ktoś sprawdził asercją. Dlatego obok pokrycia podaję gęstość
   asercji (kolumna „asercje”) — moduł z wysokim pokryciem i niską liczbą asercji to render bez dowodu.
2. **Pokrycie jednostkowe to nie całe pokrycie systemu.** Warstwa danych (RLS, RPC, triggery) jest
   testowana w pgTAP (97 plików, 1 812 asercji), a ścieżki użytkownika w Playwright
   (7 plików, 42 testów w Playwright). Tych warstw v8 nie widzi — moduł z niskim %
   jednostkowym może mieć realną zaporę w bazie (rozdział 7).
3. **Mapowanie plik → moduł jest MOJE, nie repo.** Repo nie ma manifestu modułów; przypisanie
   2 696 plików do 21 modułów zrobiłem regułami po ścieżkach (rozdział 9.1). Pliki graniczne
   (np. `gifting` — „podaruj artykuł” jest funkcją MODUŁU 1, a kod leży w powierzchni MODUŁU 14)
   zaznaczam w tabelach.
4. **Pomiar jest KOMPLETNY — inaczej niż w wydaniu z 18.08.** Tamten przebieg musiał wykluczyć
   39 plików testowych, które wisiały bez końca w fazie kolekcji. Przyczyna została w międzyczasie
   znaleziona i naprawiona: zakleszczenie cyklu pod fabryką `vi.mock` w warstwie leniwych widgetów
   (`widget-view/lazySuspense.tsx`; komentarz przy progu globalnym w `vitest.config.ts` datuje odzysk
   na 1 026 testów, które wcześniej nie wnosiły do pomiaru nic). W tym przebiegu wszystkie pliki
   testowe weszły do pomiaru, więc żadna powierzchnia nie jest już oznaczona jako zaniżona.

---

## 1. Wynik globalny: całe `src/`

| Metryka    | Pokryte / wszystkich |          % |
| ---------- | -------------------: | ---------: |
| Instrukcje |     59 664 / 106 012 | **56,28%** |
| Gałęzie    |      48 716 / 97 194 | **50,12%** |
| Funkcje    |      14 856 / 29 367 | **50,58%** |
| Linie      |      52 955 / 92 711 | **57,11%** |

Próg globalny w `vitest.config.ts` (ratchet, wolno tylko podnosić): **33% instrukcji /
28% gałęzi / 25% funkcji / 33% linii**. Zmierzony margines nad progiem:
instrukcje 23,28 pp, gałęzie 22,12 pp,
funkcje 25,58 pp, linie 24,11 pp.

**Kontrola wiarygodności pomiaru.** Komentarz przy progu w `vitest.config.ts` dokumentuje ostatni
pomiar zespołu: 37,19% instrukcji / 32,41% gałęzi /
29,13% funkcji / 37,78% linii.
Ten audyt, niezależnym przebiegiem: 56,28% / 50,12% / 50,58% / 57,11%.
Różnica to praca testowa wykonana między tamtym pomiarem a tym HEAD — kierunek i rząd wielkości się zgadzają,
co znaczy, że obie liczby mierzą to samo i tak samo.

**Rekomendacja R1 z wydania 18.08 jest wdrożona.** `coverage.reportOnFailure: true` stoi w configu
z komentarzem opisującym mechanizm (`checkThresholds` żyje wewnątrz `reportCoverage()`, z którego
vitest wychodził przy pierwszym czerwonym teście). Skutek praktyczny: ten pomiar nie wymagał już
żadnego obejścia — raport i progi powstają także na czerwonej suicie.

---

## 2. Pokrycie per moduł — tabela główna

Sortowanie: po pokryciu linii, rosnąco (najsłabsze na górze).
`T/P` = pliki testowe / pliki produkcyjne w module. `0%` = pliki produkcyjne bez ani jednej wykonanej linii.

| #   | Moduł                                                 | Pliki prod. | Instrukcje | Gałęzie | Funkcje |      Linie | Plików 0% |   T/P | Testów | Asercji |
| --- | ----------------------------------------------------- | ----------: | ---------: | ------: | ------: | ---------: | --------: | ----: | -----: | ------: |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |         130 |     25,92% |  21,70% |  21,26% | **25,87%** |        56 | 0,223 |    448 |     907 |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |          38 |     26,17% |  30,22% |  17,47% | **26,16%** |        16 | 0,289 |     88 |     247 |
| 17  | Analityka i BI                                        |          85 |     29,25% |  23,07% |  24,52% | **29,93%** |        49 | 0,224 |    199 |     442 |
| 16  | Społeczność: kluby, komentarze, moderacja             |         252 |     34,96% |  31,72% |  29,90% | **33,79%** |       154 | 0,306 |  1 254 |   2 162 |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    |         172 |     39,05% |  32,29% |  36,95% | **40,46%** |        38 | 0,186 |    439 |     974 |
| 7   | Typy treści specjalne                                 |         115 |     44,50% |  40,88% |  37,90% | **44,18%** |        42 | 0,496 |  1 112 |   1 799 |
| 12  | Realtime / powiadomienia / web-push                   |          28 |     45,30% |  31,08% |  43,97% | **47,98%** |        13 | 0,464 |     93 |     223 |
| 8   | SEO, feedy, dane strukturalne                         |          73 |     52,17% |  44,43% |  50,00% | **51,66%** |        23 | 0,521 |    314 |     724 |
| 3   | Silniki treści: bloki + page builder                  |         453 |     51,17% |  48,82% |  38,71% | **52,34%** |       120 | 0,463 |  2 369 |   5 103 |
| 15  | Profil i konto                                        |          81 |     52,27% |  47,48% |  50,39% | **53,31%** |        29 | 0,444 |    653 |   1 333 |
| 20  | Platforma / backend / infrastruktura / SSR            |         184 |     53,67% |  42,40% |  42,39% | **54,52%** |        66 | 0,805 |  2 208 |   4 640 |
| 21  | Rekrutacja / kariera                                  |          29 |     54,96% |  53,52% |  47,13% | **55,12%** |        12 | 0,379 |    171 |     374 |
| 9   | Czat / komunikator                                    |          81 |     60,78% |  51,37% |  57,74% | **62,16%** |        15 | 0,444 |    607 |   1 123 |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |         185 |     65,02% |  60,03% |  76,58% | **66,39%** |        35 | 0,492 |  1 538 |   3 148 |
| —   | PRZEKROJOWE: design system (components/ui)            |          43 |     76,38% |  60,48% |  70,61% | **78,49%** |         6 | 0,047 |     17 |      37 |
| 1   | Wpisy: doświadczenie czytelnika                       |          86 |     79,34% |  72,08% |  77,07% | **80,93%** |        13 | 0,616 |    948 |   2 008 |
| 10  | Sieć / networking                                     |          31 |     78,69% |  66,85% |  80,79% | **81,22%** |         3 | 0,710 |    327 |     609 |
| 11  | Newsletter i e-mail                                   |         147 |     80,53% |  71,48% |  82,71% | **81,47%** |        29 | 0,599 |  1 962 |   4 232 |
| 4   | Strony, wygląd, motyw, media, import                  |         132 |     90,89% |  82,16% |  88,89% | **92,26%** |         6 | 0,549 |  1 235 |   2 140 |
| —   | PRZEKROJOWE: słowniki i18n                            |         117 |     88,48% |  66,91% |  55,36% | **92,45%** |         1 | 0,051 |     60 |     141 |
| 5   | Strona główna, archiwa, chrome                        |          54 |     94,31% |  82,49% |  93,15% | **96,15%** |         1 | 0,500 |    541 |     925 |
| 6   | Wyszukiwarka                                          |          24 |     96,66% |  89,91% |  95,22% | **97,38%** |         0 | 0,875 |    528 |     839 |
| 18  | CRM                                                   |          57 |     98,17% |  86,43% |  98,49% | **98,98%** |         0 | 0,561 |    701 |   1 228 |
| 2   | Edytor wpisów i workflow redakcyjny                   |          99 |     98,86% |  94,53% |  99,18% | **99,42%** |         0 | 0,869 |  1 542 |   2 866 |

### 2.1 Zmiana od wydania 18.08 — co dała praca testowa ostatniego dnia

Poprzedni pomiar (2026-08-18, HEAD `e83570c`) obejmował 778 z 817 plików
testowych i 2 538 plików produkcyjnych. Ten obejmuje 1 230 z 1 230
i 2 696. Kolumna Δ to różnica w punktach procentowych; strzałka ↑ znaczy, że modułem ktoś się zajął.

| #   | Moduł                                                 | Linie 18.08 | Linie teraz |    Δ linie | Funkcje 18.08 | Funkcje teraz |  Δ funkcje |
| --- | ----------------------------------------------------- | ----------: | ----------: | ---------: | ------------: | ------------: | ---------: |
| 2   | Edytor wpisów i workflow redakcyjny                   |       8,34% |  **99,42%** | ↑ +91,1 pp |         6,85% |    **99,18%** | ↑ +92,3 pp |
| 18  | CRM                                                   |      12,04% |  **98,98%** | ↑ +86,9 pp |         9,30% |    **98,49%** | ↑ +89,2 pp |
| 5   | Strona główna, archiwa, chrome                        |      16,71% |  **96,15%** | ↑ +79,4 pp |        11,80% |    **93,15%** | ↑ +81,4 pp |
| 4   | Strony, wygląd, motyw, media, import                  |      22,76% |  **92,26%** | ↑ +69,5 pp |        16,18% |    **88,89%** | ↑ +72,7 pp |
| 6   | Wyszukiwarka                                          |      33,21% |  **97,38%** | ↑ +64,2 pp |        32,65% |    **95,22%** | ↑ +62,6 pp |
| 11  | Newsletter i e-mail                                   |      26,70% |  **81,47%** | ↑ +54,8 pp |        20,74% |    **82,71%** | ↑ +62,0 pp |
| 1   | Wpisy: doświadczenie czytelnika                       |      31,81% |  **80,93%** | ↑ +49,1 pp |        26,93% |    **77,07%** | ↑ +50,1 pp |
| 15  | Profil i konto                                        |      19,12% |  **53,31%** | ↑ +34,2 pp |        18,00% |    **50,39%** | ↑ +32,4 pp |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |      32,71% |  **66,39%** | ↑ +33,7 pp |        26,68% |    **76,58%** | ↑ +49,9 pp |
| 7   | Typy treści specjalne                                 |      16,47% |  **44,18%** | ↑ +27,7 pp |        14,60% |    **37,90%** | ↑ +23,3 pp |
| 16  | Społeczność: kluby, komentarze, moderacja             |      17,56% |  **33,79%** | ↑ +16,2 pp |        13,32% |    **29,90%** | ↑ +16,6 pp |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    |      24,42% |  **40,46%** | ↑ +16,0 pp |        17,58% |    **36,95%** | ↑ +19,4 pp |
| —   | PRZEKROJOWE: design system (components/ui)            |      63,13% |  **78,49%** | ↑ +15,4 pp |        56,14% |    **70,61%** | ↑ +14,5 pp |
| 3   | Silniki treści: bloki + page builder                  |      39,99% |  **52,34%** | ↑ +12,3 pp |        29,04% |    **38,71%** |  ↑ +9,7 pp |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |      22,00% |  **25,87%** |  ↑ +3,9 pp |        17,43% |    **21,26%** |  ↑ +3,8 pp |
| 12  | Realtime / powiadomienia / web-push                   |      44,12% |  **47,98%** |  ↑ +3,9 pp |        41,02% |    **43,97%** |  ↑ +2,9 pp |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |      22,55% |  **26,16%** |  ↑ +3,6 pp |        15,28% |    **17,47%** |  ↑ +2,2 pp |
| 17  | Analityka i BI                                        |      28,00% |  **29,93%** |  ↑ +1,9 pp |        22,58% |    **24,52%** |  ↑ +1,9 pp |
| 20  | Platforma / backend / infrastruktura / SSR            |      52,72% |  **54,52%** |  ↑ +1,8 pp |        40,16% |    **42,39%** |  ↑ +2,2 pp |
| 8   | SEO, feedy, dane strukturalne                         |      50,31% |  **51,66%** |  ↑ +1,4 pp |        48,94% |    **50,00%** |  ↑ +1,1 pp |
| —   | PRZEKROJOWE: słowniki i18n                            |      91,78% |  **92,45%** |  ↑ +0,7 pp |        51,32% |    **55,36%** |  ↑ +4,0 pp |
| 9   | Czat / komunikator                                    |      61,96% |  **62,16%** |  ↑ +0,2 pp |        57,56% |    **57,74%** |  ↑ +0,2 pp |
| 21  | Rekrutacja / kariera                                  |      55,12% |  **55,12%** |     0,0 pp |        47,13% |    **47,13%** |     0,0 pp |
| 10  | Sieć / networking                                     |      81,68% |  **81,22%** |  ↓ -0,5 pp |        80,79% |    **80,79%** |     0,0 pp |

Ruszyło 20 powierzchni, 4 stoi w miejscu (±1 pp), 0 spadło. Spadek przy rosnącej liczbie plików
produkcyjnych nie musi znaczyć regresji testów — może znaczyć, że do modułu doszedł nowy, nieotestowany kod.
Kolumna „plików 0%” w tabeli głównej rozstrzyga, który przypadek zachodzi.

### 2.2 Wymiar „funkcje”: ile funkcji w module zostało kiedykolwiek wywołane

To najostrzejsza z czterech metryk: liczy KAŻDĄ funkcję (również strzałkowe callbacki i handlery),
a „pokryta” znaczy „wywołana co najmniej raz”. Moduł z 20% funkcji ma cztery piąte swoich zachowań
nigdy nie uruchomione w teście.

| #   | Moduł                                                 | Funkcji razem | Wywołanych |  % funkcji |
| --- | ----------------------------------------------------- | ------------: | ---------: | ---------: |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |           458 |         80 | **17,47%** |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |         1 439 |        306 | **21,26%** |
| 17  | Analityka i BI                                        |           877 |        215 | **24,52%** |
| 16  | Społeczność: kluby, komentarze, moderacja             |         3 167 |        947 | **29,90%** |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    |         1 678 |        620 | **36,95%** |
| 7   | Typy treści specjalne                                 |         1 641 |        622 | **37,90%** |
| 3   | Silniki treści: bloki + page builder                  |         6 848 |      2 651 | **38,71%** |
| 20  | Platforma / backend / infrastruktura / SSR            |         1 984 |        841 | **42,39%** |
| 12  | Realtime / powiadomienia / web-push                   |           373 |        164 | **43,97%** |
| 21  | Rekrutacja / kariera                                  |           348 |        164 | **47,13%** |
| 8   | SEO, feedy, dane strukturalne                         |           470 |        235 | **50,00%** |
| 15  | Profil i konto                                        |         1 028 |        518 | **50,39%** |
| —   | PRZEKROJOWE: słowniki i18n                            |           168 |         93 | **55,36%** |
| 9   | Czat / komunikator                                    |         1 060 |        612 | **57,74%** |
| —   | PRZEKROJOWE: design system (components/ui)            |           228 |        161 | **70,61%** |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |         1 358 |      1 040 | **76,58%** |
| 1   | Wpisy: doświadczenie czytelnika                       |           615 |        474 | **77,07%** |
| 10  | Sieć / networking                                     |           302 |        244 | **80,79%** |
| 11  | Newsletter i e-mail                                   |         1 556 |      1 287 | **82,71%** |
| 4   | Strony, wygląd, motyw, media, import                  |         1 008 |        896 | **88,89%** |
| 5   | Strona główna, archiwa, chrome                        |           555 |        517 | **93,15%** |
| 6   | Wyszukiwarka                                          |           293 |        279 | **95,22%** |
| 18  | CRM                                                   |         1 058 |      1 042 | **98,49%** |
| 2   | Edytor wpisów i workflow redakcyjny                   |           855 |        848 | **99,18%** |

---

## 3. Pokrycie per funkcjonalność (121 funkcjonalności w 21 modułach)

Każdy wiersz to FUNKCJA PRODUKTU, nie katalog: lista plików ją realizujących jest zdefiniowana
wzorcami ścieżek. Kolumna „fn” to funkcje wywołane / wszystkie funkcje w plikach tej funkcjonalności.

### MODUŁ 1 — Wpisy: doświadczenie czytelnika · linie 80,93% · funkcje 77,07%

**Rodzaje testów:** jednostkowy 29 · komponentowy 15 · hooka 8 · dostępności 1.

**Co tu decyduje:** reguły dostępu i formatowania (paywall, metering, cytowania, TOC) mają testy jednostkowe i progi, więc ryzyko przeniosło się na **testy komponentowe**: to, co czytelnik widzi — render wpisu, odtwarzacz audio, podświetlanie glosariusza mutujące DOM artykułu — dowodzi się wyłącznie renderem z asercją na treść, a nie testem czystej funkcji.

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

### MODUŁ 2 — Edytor wpisów i workflow redakcyjny · linie 99,42% · funkcje 99,18%

**Rodzaje testów:** komponentowy 53 · jednostkowy 16 · warstwy danych 5 · hooka 10 · bramki 1 · parytetu 1.

**Co tu decyduje:** reguły workflow i rewizji siedzą w `lib/content/*` i mają 100%, więc pokrycie tego modułu podnoszą tylko **testy komponentowe i testy hooków** — autozapis, obecność edytorska i formularz wpisu to cykl życia, nie czysta funkcja; test jednostkowy nie wykryje, że hook nie unieważnił cache po zapisie.

| Funkcjonalność                  | Plików | LOC mierz. | Instr. |   Gał. | Funkcje |      Linie | fn (szt.) |
| ------------------------------- | -----: | ---------: | -----: | -----: | ------: | ---------: | --------: |
| Rewizje i przywracanie          |     12 |        286 |  97,6% |  90,1% |   96,3% |  **97,9%** |   105/109 |
| Workflow draft→review→published |     10 |        214 |  99,1% |  95,6% |   99,0% |  **99,5%** |     96/97 |
| Edytor wpisu (panele)           |     64 |      1 016 |  99,2% |  95,3% |   99,8% |  **99,9%** |   412/413 |
| Autozapis wpisu                 |      3 |         85 | 100,0% |  96,0% |  100,0% | **100,0%** |     20/20 |
| Obecność edytorska (presence)   |      2 |          6 | 100,0% | 100,0% |  100,0% | **100,0%** |       3/3 |

### MODUŁ 3 — Silniki treści: bloki + page builder · linie 52,34% · funkcje 38,71%

**Rodzaje testów:** jednostkowy 104 · komponentowy 85 · hooka 7 · parytetu 8 · bramki 3 · dostępności 2 · dymny 1.

**Co tu decyduje:** decyduje **test parytetu**: rejestr widgetów, panel właściwości i renderer to trzy artefakty, które muszą mówić to samo, a rozjazd „panel ustawia, renderer ignoruje” łapie wyłącznie porównanie dwóch stron (`check:widget-fidelity`, `settingsFidelity.gate`). Test jednostkowy schematu i test komponentu widgetu są konieczne, ale ani jeden, ani drugi nie zauważy dryfu między nimi.

| Funkcjonalność                                         | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ------------------------------------------------------ | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| CMS: panele właściwości widgetów                       |    112 |      4 666 |  29,2% | 28,0% |   17,7% | **29,7%** |  368/2074 |
| CMS: builder sidebara + wzorce                         |      6 |        224 |  29,3% | 10,1% |   17,6% | **31,3%** |    21/119 |
| CMS: render bloków (publiczny)                         |     39 |      1 909 |  38,2% | 21,3% |   23,3% | **40,8%** |   120/516 |
| CMS: import z Gutenberga / WordPressa                  |     10 |      1 309 |  49,2% | 43,4% |   58,4% | **51,3%** |   146/250 |
| CMS: silnik bloków (typ Gutenberg) — rdzeń             |      9 |        358 |  63,5% | 62,7% |   43,5% | **63,1%** |    64/147 |
| CMS: silnik treści publicznej (contentEngine)          |     19 |        521 |  79,5% | 77,9% |   82,2% | **80,6%** |    97/118 |
| CMS: zapytania danych widgetów                         |      8 |        459 |  78,3% | 68,8% |   87,9% | **83,2%** |   123/140 |
| CMS: design tokens / kolory globalne / typografia      |      6 |        257 |  84,5% | 80,9% |   85,0% | **87,2%** |     34/40 |
| CMS: edycja bloków (selekcja, focus, schowek, undo)    |      6 |        236 |  88,1% | 82,6% |  100,0% | **89,4%** |     45/45 |
| CMS: widgety buildera — render publiczny               |     54 |      3 599 |  90,4% | 82,7% |   87,4% | **92,1%** |   693/793 |
| CMS: page builder (typ Elementor) — schemat i operacje |     11 |        649 |  85,4% | 64,9% |   96,6% | **92,9%** |   284/294 |
| CMS: sanityzacja HTML                                  |      4 |        157 |  94,4% | 88,8% |   90,6% | **98,1%** |     29/32 |
| CMS: warstwa content-model (rozdział bloki⇄builder)    |      7 |        150 |  93,5% | 82,9% |   96,9% | **98,7%** |     31/32 |

### MODUŁ 4 — Strony, wygląd, motyw, media, import · linie 92,26% · funkcje 88,89%

**Rodzaje testów:** komponentowy 31 · jednostkowy 25 · hooka 11 · warstwy danych 4 · funkcji serwerowej 1 · dostępności 1.

**Co tu decyduje:** połowa ryzyka to **czysta matematyka** (kadrowanie obrazu, tokeny motywu, kontrast etykiet) — tam test jednostkowy jest najtańszym dowodem o największym zasięgu; druga połowa to **testy hooków** panelu mediów (mutacje, zaznaczanie, skróty klawiszowe), gdzie liczy się kolejność zdarzeń i wycofanie po błędzie.

| Funkcjonalność                  | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |      Linie | fn (szt.) |
| ------------------------------- | -----: | ---------: | -----: | ----: | ------: | ---------: | --------: |
| Ikony / marka                   |      7 |        149 |  79,6% | 72,6% |   73,0% |  **80,5%** |     27/37 |
| Media: upload, crop, biblioteka |     41 |      1 418 |  97,6% | 90,5% |   96,4% |  **99,0%** |   348/361 |
| Motyw / wygląd / global colors  |     51 |        629 |  98,2% | 91,5% |   97,5% |  **99,0%** |   193/198 |
| Szablony stron i archiwów       |      6 |        111 |  99,2% | 93,8% |  100,0% | **100,0%** |     63/63 |

### MODUŁ 5 — Strona główna, archiwa, chrome · linie 96,15% · funkcje 93,15%

**Rodzaje testów:** komponentowy 12 · jednostkowy 10 · warstwy danych 3 · parytetu 1 · dostępności 1.

**Co tu decyduje:** chrome jest na ścieżce każdej strony, więc liczy się **test komponentowy z asercją a11y** (nawigacja klawiaturą, rola i etykieta) plus **test jednostkowy drzewa menu** (sieroty, cykl, limit głębokości). Mega menu pokazuje, że ta mieszanka działa: cztery testy, w tym parytet kolumn, dały tej powierzchni kilkakrotnie wyższe pokrycie niż sąsiedniemu menu bez nich.

| Funkcjonalność                       | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ------------------------------------ | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Mega menu                            |      3 |        135 |  80,9% | 66,0% |   79,5% | **88,1%** |     31/39 |
| Archiwa kategorii/tagów              |     16 |        189 |  95,1% | 82,3% |   95,5% | **96,3%** |     64/67 |
| Nagłówek / stopka / menu             |     19 |        847 |  96,6% | 86,1% |   94,8% | **97,9%** |   325/343 |
| Chrome mobilny (drawer, dolny pasek) |     11 |        220 |  95,6% | 89,3% |   91,4% | **98,2%** |     53/58 |

### MODUŁ 6 — Wyszukiwarka · linie 97,38% · funkcje 95,22%

**Rodzaje testów:** komponentowy 12 · jednostkowy 5 · hooka 2 · funkcji serwerowej 1 · warstwy danych 1.

**Co tu decyduje:** ranking, operatory i facety są dowiedzione w **pgTAP** (9 plików) — powtarzanie tego w vitest jest stratą; brakującym dowodem jest **test komponentowy overlaya** i **test hooka zapisanych wyszukiwań** (alerty e-mail), bo tam mieszka to, czego baza nie widzi.

| Funkcjonalność                               | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| -------------------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Wyszukiwarka: indeks i zapytania             |     10 |        512 |  96,6% | 88,8% |   98,1% | **98,2%** |   102/104 |
| Wyszukiwarka: UI (overlay, filtry, zapisane) |     13 |        411 |  98,3% | 93,9% |   98,5% | **98,3%** |   130/132 |

### MODUŁ 7 — Typy treści specjalne · linie 44,18% · funkcje 37,90%

**Rodzaje testów:** komponentowy 22 · jednostkowy 25 · warstwy danych 4 · hooka 1 · funkcji serwerowej 3 · dymny 2.

**Co tu decyduje:** osiem różnych typów treści dzieli jeden wzorzec: reguły domenowe mają testy, a **funkcje serwerowe i loadery** nie. Rezerwacja miejsc na wydarzenie to przypadek skrajny — pgTAP dowodzi kolejki FIFO w bazie, ale to **test funkcji serwerowej** decyduje, czy aplikacja w ogóle zapyta o wolne miejsce.

| Funkcjonalność                   | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |      Linie | fn (szt.) |
| -------------------------------- | -----: | ---------: | -----: | ----: | ------: | ---------: | --------: |
| Podcast                          |      4 |         78 |  73,7% | 74,3% |   50,0% |  **70,5%** |     16/32 |
| Quiz / mapy                      |      5 |        251 |  92,8% | 88,0% |   88,7% |  **94,4%** |     55/62 |
| Huby ekspertów                   |     26 |        820 |  96,7% | 89,2% |   95,3% |  **97,7%** |   243/255 |
| Tracker legislacyjny             |      9 |        235 |  99,3% | 96,1% |  100,0% | **100,0%** |     95/95 |
| Programy badawcze                |      4 |         31 | 100,0% | 96,6% |  100,0% | **100,0%** |     14/14 |
| Wydarzenia (RSVP, waitlist, ICS) |     15 |        208 |  99,2% | 95,8% |  100,0% | **100,0%** |     67/67 |
| Web stories                      |      3 |         98 |  99,2% | 94,8% |  100,0% | **100,0%** |     30/30 |
| Biblioteka plików                |      7 |        248 |  99,7% | 91,0% |  100,0% | **100,0%** |     76/76 |

### MODUŁ 8 — SEO, feedy, dane strukturalne · linie 51,66% · funkcje 50,00%

**Rodzaje testów:** jednostkowy 35 · komponentowy 2 · funkcji serwerowej 1.

**Co tu decyduje:** tu **e2e jest niezastępowalne**: JSON-LD, hreflang i sitemapy dowodzi się bajtami, które wyszły z SSR, a nie wywołaniem funkcji budującej `<head>`. Testy jednostkowe (35 plików) pilnują kształtu danych, `e2e/seo.spec.ts` pilnuje tego, co widzi robot.

| Funkcjonalność               | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ---------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Feedy i sitemapy             |      8 |        130 |   0,7% |  0,0% |    0,0% |  **0,8%** |      0/24 |
| Monitor linków               |      2 |         18 |   4,8% |  0,0% |    0,0% |  **5,6%** |       0/8 |
| Udostępnianie / OG           |      4 |        209 |  24,8% | 21,4% |   16,4% | **25,4%** |     10/61 |
| SEO: meta, JSON-LD, hreflang |     44 |      1 264 |  73,3% | 67,6% |   82,0% | **74,4%** |   223/272 |

### MODUŁ 9 — Czat / komunikator · linie 62,16% · funkcje 57,74%

**Rodzaje testów:** jednostkowy 16 · hooka 8 · komponentowy 12.

**Co tu decyduje:** wzorcowa mieszanka po refaktorze: **test warstwy danych z atrapą łańcucha PostgREST** (kształt zapytania), **test hooka** (kolejność wiadomości, deduplikacja optymistyczna) i **test jednostkowy reguł wątku**. To ten zestaw, nie sam wzrost liczby testów, wyciągnął moduł z 17% na poziom z progami per plik.

| Funkcjonalność                                  | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |      Linie | fn (szt.) |
| ----------------------------------------------- | -----: | ---------: | -----: | ----: | ------: | ---------: | --------: |
| Czat: okno rozmowy i atomy UI                   |     35 |      1 507 |  45,2% | 38,7% |   40,7% |  **46,2%** |   212/521 |
| Czat: kompozytor + wzmianki                     |     10 |        229 |  81,6% | 68,8% |   77,2% |  **84,3%** |     44/57 |
| Czat: warstwa danych (rozmowy, wiadomości)      |      3 |        374 |  92,3% | 83,3% |   95,6% |  **97,6%** |   130/136 |
| Czat: reguły wątku (kolejność, separator, skok) |      5 |        159 |  99,5% | 98,5% |   97,5% | **100,0%** |     39/40 |

### MODUŁ 10 — Sieć / networking · linie 81,22% · funkcje 80,79%

**Rodzaje testów:** komponentowy 16 · hooka 3 · jednostkowy 2 · bramki 1.

**Co tu decyduje:** warstwa danych jest RPC-only, więc **test warstwy danych** dowodzi kontraktu czasowników i prywatności odmów zaproszeń — a **test komponentowy** dowodzi, że odmowa nie wycieka do UI. Oba są objęte progiem 95/98, dlatego moduł nie osuwa się między wydaniami.

| Funkcjonalność                             | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ------------------------------------------ | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Sieć kontaktów (zaproszenia, obserwowanie) |     29 |        694 |  93,0% | 85,2% |   96,8% | **96,0%** |   244/252 |

### MODUŁ 11 — Newsletter i e-mail · linie 81,47% · funkcje 82,71%

**Rodzaje testów:** komponentowy 30 · jednostkowy 32 · warstwy danych 13 · funkcji serwerowej 13.

**Co tu decyduje:** dostarczalność to **testy funkcji serwerowych** (webhook dostawcy, tłumienie, reputacja) — nic innego tego nie dowiedzie, bo zdarzenie przychodzi z zewnątrz; panel redakcyjny to **testy komponentowe**, bo błąd widać dopiero w interakcji: kampania wysłana do złej listy jest defektem UI, nie reguły.

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

| Funkcjonalność              | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| --------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Powiadomienia + web-push    |     16 |        878 |  42,3% | 29,5% |   32,1% | **44,9%** |    80/249 |
| Realtime (kanały, presence) |     10 |        268 |  58,2% | 41,3% |   72,4% | **61,6%** |    84/116 |

### MODUŁ 13 — Monetyzacja: checkout / subskrypcje / billing · linie 66,39% · funkcje 76,58%

**Rodzaje testów:** komponentowy 36 · funkcji serwerowej 23 · jednostkowy 26 · warstwy danych 4 · hooka 1 · parytetu 1.

**Co tu decyduje:** ścieżka płatność → dostęp ma **testy funkcji serwerowych** z wysokimi progami (webhook Stripe, grant) i to jest właściwy rodzaj dowodu dla pieniędzy. Ale rezygnacja, zmiana planu i faktury to **testy komponentowe**: UI może pokazać „anulowano”, gdy żądanie padło, a żaden test serwerowy tego nie zauważy.

| Funkcjonalność                              | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ------------------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Billing: rekoncyliacja i panel              |    112 |      3 658 |  63,3% | 59,8% |   79,7% | **65,0%** |   615/772 |
| Webhook płatności                           |      1 |         37 |  68,4% | 63,3% |   40,0% | **67,6%** |       2/5 |
| Checkout (Stripe) + intencja                |     15 |        200 |  65,1% | 57,1% |   63,6% | **68,5%** |     35/55 |
| Subskrypcje / plany / cennik                |     33 |        755 |  91,7% | 84,6% |   92,3% | **92,7%** |   337/365 |
| Dołączenie do członkostwa (membership join) |      9 |         65 |  96,1% | 84,1% |   93,8% | **96,9%** |     30/32 |

### MODUŁ 14 — Monetyzacja: kupony / darowizny / prezenty / reklamy · linie 26,16% · funkcje 17,47%

**Rodzaje testów:** jednostkowy 6 · komponentowy 5.

**Co tu decyduje:** kwoty i kupony to **testy jednostkowe** (waluta, zaokrąglenia, audyt kuponu), a widoczność reklamy i przycisku darowizny to **testy komponentowe**. Rozdział jest tu ważny, bo błąd w kwocie i błąd w widoczności mają różne konsekwencje i różne rodzaje dowodu.

| Funkcjonalność               | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ---------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Reklamy / sponsoring         |     15 |        432 |  31,3% | 39,9% |   29,9% | **30,6%** |    35/117 |
| Kupony                       |      7 |        111 |  44,5% | 39,4% |   56,0% | **46,8%** |     14/25 |
| Prezenty artykułów (gifting) |     10 |        221 |  50,8% | 52,6% |   45,8% | **53,4%** |     27/59 |
| Darowizny                    |      3 |        119 |  84,0% | 72,0% |   71,4% | **85,7%** |     15/21 |

### MODUŁ 15 — Profil i konto · linie 53,31% · funkcje 50,39%

**Rodzaje testów:** komponentowy 18 · jednostkowy 11 · hooka 3 · bramki 3 · warstwy danych 1.

**Co tu decyduje:** konto to **testy inwariantów i bramek** (guard weryfikacji profilu, izolacja tenanta) plus **pgTAP** dla eksportu danych i RODO. Sam procent pokrycia mówi tu mniej niż odpowiedź na pytanie, czy inwariant „profil niezweryfikowany nie widzi X” ma test, który pada przy każdym złamaniu reguły w dowolnym miejscu.

| Funkcjonalność                                | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |      Linie | fn (szt.) |
| --------------------------------------------- | -----: | ---------: | -----: | ----: | ------: | ---------: | --------: |
| LOGIN: ustawienia logowania (admin)           |      3 |         81 |   2,4% |  0,0% |    0,0% |   **2,5%** |      0/51 |
| LOGIN: ochrona przed brute force              |      1 |         54 |  10,5% |  0,0% |    0,0% |  **11,1%** |       0/9 |
| Retencja / onboarding                         |      8 |        180 |  17,7% | 13,9% |   28,9% |  **18,9%** |     11/38 |
| Zainteresowania / personalizacja              |      7 |        647 |  33,1% | 39,0% |   17,0% |  **35,7%** |    25/147 |
| LOGIN: portal logowania (hasło, magic link)   |      4 |        225 |  53,1% | 57,6% |   60,0% |  **53,3%** |     33/55 |
| LOGIN/LOGOUT: sesja i kontekst użytkownika    |      4 |        112 |  66,4% | 57,1% |   60,0% |  **68,8%** |     15/25 |
| Konto: dane, RODO, eksport                    |      3 |        118 |  70,0% | 71,0% |   79,4% |  **70,3%** |     27/34 |
| REJESTRACJA: pola, walidacja, panel sukcesu   |      2 |         46 |  70,9% | 49,1% |   75,0% |  **73,9%** |     12/16 |
| LOGIN: formularze auth w CMS (bloki + widget) |      3 |        363 |  87,4% | 77,8% |   84,8% |  **90,4%** |     67/79 |
| Profil użytkownika                            |     33 |      1 344 |  88,6% | 84,8% |   80,2% |  **90,4%** |   380/474 |
| LOGIN: MFA (2FA)                              |      2 |         44 | 100,0% | 94,1% |   92,9% | **100,0%** |     13/14 |
| LOGIN: reset hasła                            |      1 |         52 |  96,8% | 85,5% |  100,0% | **100,0%** |     16/16 |

### MODUŁ 16 — Społeczność: kluby, komentarze, moderacja · linie 33,79% · funkcje 29,90%

**Rodzaje testów:** jednostkowy 57 · hooka 5 · komponentowy 9 · warstwy danych 1 · funkcji serwerowej 2 · bramki 2 · parytetu 1.

**Co tu decyduje:** reguły dostępu do klubu mają testy jednostkowe, a polityki — **19 plików pgTAP**. Brakującym rodzajem jest **test warstwy danych** (łańcuch PostgREST w `api.ts`) i **test hooka** dla stanu listy wątków: to one decydują, czy właściwy członek zobaczy właściwą treść, czego ani reguła, ani polityka bazy nie dowodzą same.

| Funkcjonalność                                     | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| -------------------------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| KLUBY: trasy publiczne klubu                       |     20 |        707 |   0,0% |  0,0% |    0,0% |  **0,0%** |     0/261 |
| KLUBY: UI (atomy/molekuły/organizmy)               |    103 |      2 247 |   8,4% |  7,6% |    6,3% |  **8,4%** |    60/947 |
| KLUBY: panel admina                                |     26 |      1 233 |   8,3% |  6,3% |    5,8% |  **8,6%** |    32/552 |
| KLUBY: zgłoszenia członkowskie (apply)             |      5 |        183 |  20,9% |  8,1% |   16,4% | **21,3%** |     10/61 |
| Społeczność: odznaki, zaangażowanie, Q&A, ankiety  |     20 |        548 |  24,0% | 28,4% |   18,1% | **24,5%** |    33/182 |
| Komentarze i moderacja                             |      6 |        239 |  83,2% | 78,2% |   68,0% | **84,1%** |     51/75 |
| KLUBY: dostęp i uprawnienia (gate, macierz, plany) |      7 |        151 |  88,6% | 77,1% |   79,1% | **89,4%** |     34/43 |
| KLUBY: wątki dyskusyjne (dynamika, puls, źródła)   |      8 |        256 |  88,5% | 79,0% |   80,6% | **89,8%** |     75/93 |
| KLUBY: tematy, specjalizacje, obszary polityk      |     10 |        166 |  94,8% | 90,9% |   96,7% | **95,8%** |     58/60 |
| KLUBY: API i zapytania (klub, posty, wątki)        |     10 |        591 |  95,9% | 96,6% |   98,2% | **96,6%** |   222/226 |

### MODUŁ 17 — Analityka i BI · linie 29,93% · funkcje 24,52%

**Rodzaje testów:** jednostkowy 17 · dostępności 1 · komponentowy 1.

**Co tu decyduje:** warstwa semantyczna analityki jest w 100% pokryta **testami jednostkowymi z progami** — i tak być powinno, bo od niej zależy każda liczba w raporcie zarządczym. Wykresy potrzebują natomiast **testów a11y**: wykres bez alternatywy tekstowej jest dla części odbiorców pustym prostokątem.

| Funkcjonalność                          | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| --------------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Analityka: zbieranie zdarzeń i liczniki |     20 |        705 |  14,4% | 13,7% |   16,2% | **15,2%** |    25/154 |
| Wykresy i panel BI                      |     41 |      1 501 |  26,7% | 21,0% |   21,5% | **28,0%** |   110/512 |
| Observability / RUM / web vitals        |     11 |        409 |  54,6% | 48,6% |   61,7% | **54,0%** |     37/60 |
| Analityka: warstwa semantyczna          |      7 |        239 |  70,4% | 60,2% |   69,4% | **71,5%** |     43/62 |

### MODUŁ 18 — CRM · linie 98,98% · funkcje 98,49%

**Rodzaje testów:** jednostkowy 17 · warstwy danych 5 · komponentowy 6 · funkcji serwerowej 2 · parytetu 1 · hooka 1.

**Co tu decyduje:** CRM pokazuje, po co jest **test parytetu**: filtr leadów istnieje w dwóch implementacjach (nad wierszami i nad zapytaniem), więc bez porównania obu stron poprawka w jednej zostawia drugą zepsutą. Poza tym **test warstwy danych** dla zapytań i **test jednostkowy** dla mapowania importu danych osobowych.

| Funkcjonalność                        | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ------------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| CRM: UI panelu                        |     19 |        569 |  95,1% | 83,4% |   96,5% | **96,0%** |   279/289 |
| CRM: import/eksport CSV + organizacje |      7 |        356 |  98,6% | 91,7% |   95,1% | **99,4%** |     78/82 |
| CRM: kontakty, firmy, lejek, zadania  |     23 |      1 085 |  99,2% | 91,5% |   99,6% | **99,8%** |   261/262 |

### MODUŁ 19 — Ustawienia / integracje / users / multi-tenant / RODO · linie 25,87% · funkcje 21,26%

**Rodzaje testów:** jednostkowy 22 · warstwy danych 2 · komponentowy 2 · funkcji serwerowej 1 · parytetu 1 · bramki 1.

**Co tu decyduje:** tu rodzaj testu jest ważniejszy niż procent: **inwariant i parytet** (snapshot bramek autoryzacji kontra migracje, macierz uprawnień kontra rejestr capabilities) wykrywają zawężenie kręgu uprawnionych, którego żaden test jednostkowy pojedynczej funkcji nie zauważy, bo każda z nich osobno działa poprawnie.

| Funkcjonalność                           | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ---------------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Użytkownicy i role (admin)               |      2 |        105 |   0,0% |  0,0% |    0,0% |  **0,0%** |      0/28 |
| Ustawienia serwisu (panele)              |      5 |        111 |  33,8% | 14,2% |   21,2% | **34,2%** |     11/52 |
| Zgody / cookie banner / GPC / RODO       |     28 |        460 |  49,7% | 44,0% |   42,4% | **52,4%** |    64/151 |
| Integracje zewnętrzne                    |      3 |        181 |  56,6% | 58,7% |   50,0% | **56,4%** |     17/34 |
| Autoryzacja / macierz uprawnień (authz)  |     23 |        207 |  82,4% | 75,5% |   73,9% | **82,6%** |     65/88 |
| Multi-tenant (izolacja tenanta w kodzie) |      6 |        281 |  88,5% | 83,3% |   84,1% | **90,4%** |     58/69 |
| Feature flags                            |      3 |        163 |  95,9% | 90,3% |   97,2% | **96,9%** |     35/36 |

### MODUŁ 20 — Platforma / backend / infrastruktura / SSR · linie 54,52% · funkcje 42,39%

**Rodzaje testów:** jednostkowy 101 · komponentowy 26 · funkcji serwerowej 15 · warstwy danych 2 · bramki 3 · parytetu 2.

**Co tu decyduje:** platforma utrzymuje **bramki (meta-inwarianty)**: „bramka, która istnieje, musi się uruchamiać”, parytet konfiguracji chunków, kontrakt zmiennych workflow. To rodzaj testu, który skaluje się z repozytorium, nie z liczbą przypadków — jeden taki test pilnuje wszystkich przyszłych plików.

| Funkcjonalność                      | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ----------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Routing / trasy publiczne (powłoka) |      6 |        386 |   1,4% |  1,9% |    3,2% |  **1,6%** |      3/94 |
| Warstwa serwerowa (server fns)      |     19 |        980 |  20,3% | 17,7% |   17,7% | **20,5%** |    39/220 |
| Klient Supabase / zapytania         |     26 |        909 |  26,4% | 17,8% |   26,5% | **29,7%** |    70/264 |
| A11y / watchdog / MCP               |      9 |        164 |  39,6% | 29,9% |   31,0% | **42,1%** |      9/29 |
| SSR / hydracja / cache brzegowy     |     31 |      1 149 |  74,8% | 72,9% |   71,5% | **75,5%** |   158/221 |
| Obsługa błędów / error boundary     |      7 |        115 |  78,0% | 75,7% |   65,5% | **77,4%** |     19/29 |
| Bramki CI (rejestry, kontrakty)     |     29 |      2 602 |  93,8% | 86,8% |   92,9% | **95,5%** |   442/476 |

### MODUŁ 21 — Rekrutacja / kariera · linie 55,12% · funkcje 47,13%

**Rodzaje testów:** jednostkowy 9 · dostępności 2.

**Co tu decyduje:** rekrutacja to **testy jednostkowe** walidacji zgłoszenia plus **testy a11y** formularza (to najczęściej wypełniany formularz przez osoby z zewnątrz) i **harness pgTAP** na ścieżce zapisu — bramka istnieje właśnie dlatego, że złamany CHECK w bazie przeszedł kiedyś przy zielonym CI.

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

Razem: **8 592 / 14 494 linii = 59,28%**, funkcje **2055/4600 = 44,67%**.

**CMS: panele właściwości widgetów** — linie 29,7%, funkcje 368/2074 (17,7%), plików 112 (bez pokrycia: 31), LOC 4 666

> Bez ani jednego wywołania: **1706 funkcji** (83 nazwanych, 1623 anonimowych domknięć). Nazwane, pierwsze 14:
>
> - `Builder @ src/components/admin/builder/Builder.tsx:78`
> - `WidgetHeightControl @ src/components/admin/builder/WidgetProperties.tsx:1071`
> - `ThemedColorField @ src/components/admin/builder/WidgetProperties.tsx:1200`
> - `FormElementSizeField @ src/components/admin/builder/WidgetProperties.tsx:1253`
> - `GlobalWidgetBanner @ src/components/admin/builder/WidgetProperties.tsx:1730`
> - `CollapsibleDetails @ src/components/admin/builder/ui/atoms/Collapsible.tsx:7`
> - `ColorInput @ src/components/admin/builder/ui/atoms/ColorInput.tsx:5`
> - `PositionAnchor @ src/components/admin/builder/ui/atoms/PositionAnchor.tsx:16`
> - `Row @ src/components/admin/builder/ui/atoms/Row.tsx:4`
> - `SidesInput @ src/components/admin/builder/ui/atoms/SidesInput.tsx:5`
> - `useBuilderClipboard @ src/components/admin/builder/ui/hooks/useBuilderClipboard.ts:31`
> - `useBuilderOperations @ src/components/admin/builder/ui/hooks/useBuilderOperations.ts:42`
> - `useBuilderShortcuts @ src/components/admin/builder/ui/hooks/useBuilderShortcuts.ts:29`
> - `forEachGlobalInstance @ src/components/admin/builder/ui/hooks/useGlobalWidgetSync.ts:25`

**CMS: builder sidebara + wzorce** — linie 31,3%, funkcje 21/119 (17,6%), plików 6 (bez pokrycia: 2), LOC 224

> Bez ani jednego wywołania: **98 funkcji** (19 nazwanych, 79 anonimowych domknięć). Nazwane, pierwsze 14:
>
> - `defaultSettingsFor @ src/components/admin/sidebarBuilder/SidebarBuilderPane.tsx:113`
> - `newWidget @ src/components/admin/sidebarBuilder/SidebarBuilderPane.tsx:118`
> - `SidebarBuilderPane @ src/components/admin/sidebarBuilder/SidebarBuilderPane.tsx:127`
> - `patchDraft @ src/components/admin/sidebarBuilder/SidebarBuilderPane.tsx:210`
> - `addWidget @ src/components/admin/sidebarBuilder/SidebarBuilderPane.tsx:214`
> - `moveWidget @ src/components/admin/sidebarBuilder/SidebarBuilderPane.tsx:221`
> - `deleteWidget @ src/components/admin/sidebarBuilder/SidebarBuilderPane.tsx:233`
> - `toggleHidden @ src/components/admin/sidebarBuilder/SidebarBuilderPane.tsx:238`
> - `updateSettings @ src/components/admin/sidebarBuilder/SidebarBuilderPane.tsx:245`
> - `IconBtn @ src/components/admin/sidebarBuilder/SidebarBuilderPane.tsx:512`
> - `ReadingPanelSettingsForm @ src/components/admin/sidebarBuilder/SidebarBuilderPane.tsx:541`
> - `PatternPicker @ src/components/patterns/PatternPicker.tsx:58`
> - `SelectedPanel @ src/components/patterns/PatternPicker.tsx:145`
> - `PagePanel @ src/components/patterns/PatternPicker.tsx:160`

**CMS: render bloków (publiczny)** — linie 40,8%, funkcje 120/516 (23,3%), plików 39 (bez pokrycia: 15), LOC 1 909

> Bez ani jednego wywołania: **396 funkcji** (79 nazwanych, 317 anonimowych domknięć). Nazwane, pierwsze 14:
>
> - `AffiliateBlockView @ src/components/blocks/AffiliateBlockView.tsx:18`
> - `CalendarView @ src/components/blocks/CalendarView.tsx:16`
> - `CodeBlockView @ src/components/blocks/CodeBlockView.tsx:19`
> - `CompareSlider @ src/components/blocks/CompareSlider.tsx:11`
> - `onSubmit @ src/components/blocks/ContactFormView.tsx:278`
> - `formatDate @ src/components/blocks/ContextBlockViews.tsx:13`
> - `PostTitleView @ src/components/blocks/ContextBlockViews.tsx:30`
> - `PostDateView @ src/components/blocks/ContextBlockViews.tsx:39`
> - `PostAuthorView @ src/components/blocks/ContextBlockViews.tsx:60`
> - `PostExcerptView @ src/components/blocks/ContextBlockViews.tsx:103`
> - `PostFeaturedImageView @ src/components/blocks/ContextBlockViews.tsx:132`
> - `PostTermsView @ src/components/blocks/ContextBlockViews.tsx:160`
> - `SiteTitleView @ src/components/blocks/ContextBlockViews.tsx:187`
> - `SiteTaglineView @ src/components/blocks/ContextBlockViews.tsx:201`

**CMS: import z Gutenberga / WordPressa** — linie 51,3%, funkcje 146/250 (58,4%), plików 10 (bez pokrycia: 2), LOC 1 309

> Bez ani jednego wywołania: **104 funkcji** (50 nazwanych, 54 anonimowych domknięć). Nazwane, pierwsze 14:
>
> - `captureWpRedirect @ src/lib/wordpress-import.functions.ts:51`
> - `authHeaders @ src/lib/wordpress-import.functions.ts:96`
> - `wpFetch @ src/lib/wordpress-import.functions.ts:111`
> - `slugify @ src/lib/wordpress-import.functions.ts:126`
> - `resolveTenant @ src/lib/wordpress-import.functions.ts:136`
> - `resolveBlogPage @ src/lib/wordpress-import.functions.ts:146`
> - `ensureUniqueSlug @ src/lib/wordpress-import.functions.ts:176`
> - `decodeEntities @ src/lib/wordpress-import.functions.ts:232`
> - `stripTags @ src/lib/wordpress-import.functions.ts:245`
> - `mapStatus @ src/lib/wordpress-import.functions.ts:250`
> - `isLikelyWpMediaUrl @ src/lib/wordpress-import.functions.ts:260`
> - `extName @ src/lib/wordpress-import.functions.ts:272`
> - `sha256Hex @ src/lib/wordpress-import.functions.ts:284`
> - `createMediaImporter @ src/lib/wordpress-import.functions.ts:296`

**CMS: silnik bloków (typ Gutenberg) — rdzeń** — linie 63,1%, funkcje 64/147 (43,5%), plików 9 (bez pokrycia: 0), LOC 358

> Bez ani jednego wywołania: **83 funkcji** (1 nazwanych, 82 anonimowych domknięć). Nazwane:
>
> - `getBlockVariants @ src/lib/blocks/variants.ts:40`

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

**CMS: design tokens / kolory globalne / typografia** — linie 87,2%, funkcje 34/40 (85,0%), plików 6 (bez pokrycia: 0), LOC 257

> Bez ani jednego wywołania: **6 funkcji** (1 nazwanych, 5 anonimowych domknięć). Nazwane:
>
> - `clearAllLiveWidgetTypography @ src/lib/builder/liveTypography.ts:95`

**CMS: edycja bloków (selekcja, focus, schowek, undo)** — linie 89,4%, funkcje 45/45 (100,0%), plików 6 (bez pokrycia: 0), LOC 236

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

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

**CMS: page builder (typ Elementor) — schemat i operacje** — linie 92,9%, funkcje 284/294 (96,6%), plików 11 (bez pokrycia: 0), LOC 649

> Bez ani jednego wywołania: **10 funkcji** (6 nazwanych, 4 anonimowych domknięć). Nazwane:
>
> - `copyToClipboard @ src/lib/builder/clipboard.ts:14`
> - `readClipboard @ src/lib/builder/clipboard.ts:22`
> - `cloneInner @ src/lib/builder/operations.ts:49`
> - `addSectionToContainer @ src/lib/builder/operations.ts:221`
> - `insertSectionNode @ src/lib/builder/operations.ts:232`
> - `insertContainerAt @ src/lib/builder/operations.ts:236`

**CMS: sanityzacja HTML** — linie 98,1%, funkcje 29/32 (90,6%), plików 4 (bez pokrycia: 0), LOC 157

> Bez ani jednego wywołania: **3 funkcji** (0 nazwanych, 3 anonimowych domknięć).

**CMS: warstwa content-model (rozdział bloki⇄builder)** — linie 98,7%, funkcje 31/32 (96,9%), plików 7 (bez pokrycia: 0), LOC 150

> Bez ani jednego wywołania: **1 funkcji** (0 nazwanych, 1 anonimowych domknięć).

### 4.4 Kluby dyskusyjne (MODUŁ 16)

Razem: **1 429 / 5 534 linii = 25,82%**, funkcje **491/2243 = 21,89%**.

**KLUBY: trasy publiczne klubu** — linie 0,0%, funkcje 0/261 (0,0%), plików 20 (bez pokrycia: 20), LOC 707

> Bez ani jednego wywołania: **261 funkcji** (24 nazwanych, 237 anonimowych domknięć). Nazwane, pierwsze 14:
>
> - `ClubAbout @ src/routes/club.$clubSlug.about.tsx:50`
> - `ClubBoardRoute @ src/routes/club.$clubSlug.board.tsx:38`
> - `ClubCalendarRoute @ src/routes/club.$clubSlug.calendar.tsx:33`
> - `ClubDocumentsRoute @ src/routes/club.$clubSlug.documents.tsx:35`
> - `ClubMeetingRoute @ src/routes/club.$clubSlug.e.$eventSlug.tsx:40`
> - `ClubExpertsRoute @ src/routes/club.$clubSlug.experts.tsx:37`
> - `ClubHubRoute @ src/routes/club.$clubSlug.index.tsx:65`
> - `ClubInsightsRoute @ src/routes/club.$clubSlug.insights.tsx:37`
> - `asRole @ src/routes/club.$clubSlug.members.tsx:54`
> - `ClubMembersRoute @ src/routes/club.$clubSlug.members.tsx:79`
> - `ClubMinisiteRoute @ src/routes/club.$clubSlug.minisite.tsx:43`
> - `ClubNewThread @ src/routes/club.$clubSlug.new.tsx:102`
> - `ClubScheduleRoute @ src/routes/club.$clubSlug.schedule.tsx:33`
> - `ClubSpotlightRoute @ src/routes/club.$clubSlug.spotlight.tsx:33`

**KLUBY: UI (atomy/molekuły/organizmy)** — linie 8,4%, funkcje 60/947 (6,3%), plików 103 (bez pokrycia: 86), LOC 2 247

> Bez ani jednego wywołania: **887 funkcji** (219 nazwanych, 668 anonimowych domknięć). Nazwane, pierwsze 14:
>
> - `initials @ src/components/clubs/atoms/ClubAuthorAvatar.tsx:16`
> - `ClubAuthorAvatar @ src/components/clubs/atoms/ClubAuthorAvatar.tsx:28`
> - `clubThreadTone @ src/components/clubs/atoms/ClubDossierRow.tsx:110`
> - `clubDossierSpineClass @ src/components/clubs/atoms/ClubDossierRow.tsx:131`
> - `clubDossierToneColor @ src/components/clubs/atoms/ClubDossierRow.tsx:136`
> - `clubDossierIconBoxClass @ src/components/clubs/atoms/ClubDossierRow.tsx:141`
> - `ClubDossierKind @ src/components/clubs/atoms/ClubDossierRow.tsx:151`
> - `ClubDocumentIcon @ src/components/clubs/atoms/ClubEntryIcon.tsx:54`
> - `ClubMilestoneIcon @ src/components/clubs/atoms/ClubEntryIcon.tsx:65`
> - `ClubSectionIcon @ src/components/clubs/atoms/ClubEntryIcon.tsx:76`
> - `clubGroupAccentVars @ src/components/clubs/atoms/ClubGroupAccent.tsx:19`
> - `ClubGroupIcon @ src/components/clubs/atoms/ClubGroupAccent.tsx:59`
> - `ClubHubAccessBadge @ src/components/clubs/atoms/ClubHubAccessBadge.tsx:19`
> - `ClubRailPanel @ src/components/clubs/atoms/ClubHubPrimitives.tsx:22`

**KLUBY: panel admina** — linie 8,6%, funkcje 32/552 (5,8%), plików 26 (bez pokrycia: 25), LOC 1 233

> Bez ani jednego wywołania: **520 funkcji** (76 nazwanych, 444 anonimowych domknięć). Nazwane, pierwsze 14:
>
> - `ToneBadge @ src/components/admin/clubs/atoms/ClubBadges.tsx:29`
> - `ClubStatusBadge @ src/components/admin/clubs/atoms/ClubBadges.tsx:43`
> - `ClubGroupStatusBadge @ src/components/admin/clubs/atoms/ClubBadges.tsx:56`
> - `ClubVisibilityBadge @ src/components/admin/clubs/atoms/ClubBadges.tsx:70`
> - `ClubMemberStatusBadge @ src/components/admin/clubs/atoms/ClubBadges.tsx:85`
> - `ClubRoleBadge @ src/components/admin/clubs/atoms/ClubBadges.tsx:99`
> - `InheritedField @ src/components/admin/clubs/atoms/InheritedField.tsx:25`
> - `Bar @ src/components/admin/clubs/molecules/ClubLayoutPicker.tsx:18`
> - `ListPreview @ src/components/admin/clubs/molecules/ClubLayoutPicker.tsx:27`
> - `CardsPreview @ src/components/admin/clubs/molecules/ClubLayoutPicker.tsx:40`
> - `MagazinePreview @ src/components/admin/clubs/molecules/ClubLayoutPicker.tsx:54`
> - `EditorialPreview @ src/components/admin/clubs/molecules/ClubLayoutPicker.tsx:73`
> - `ClubLayoutPicker @ src/components/admin/clubs/molecules/ClubLayoutPicker.tsx:104`
> - `ClubAccessTab @ src/components/admin/clubs/organisms/ClubAccessTab.tsx:47`

**KLUBY: zgłoszenia członkowskie (apply)** — linie 21,3%, funkcje 10/61 (16,4%), plików 5 (bez pokrycia: 2), LOC 183

> Bez ani jednego wywołania: **51 funkcji** (2 nazwanych, 49 anonimowych domknięć). Nazwane:
>
> - `GateCard @ src/routes/club.apply.tsx:82`
> - `ClubApplyPage @ src/routes/club.apply.tsx:114`

**KLUBY: dostęp i uprawnienia (gate, macierz, plany)** — linie 89,4%, funkcje 34/43 (79,1%), plików 7 (bez pokrycia: 0), LOC 151

> Bez ani jednego wywołania: **9 funkcji** (0 nazwanych, 9 anonimowych domknięć).

**KLUBY: wątki dyskusyjne (dynamika, puls, źródła)** — linie 89,8%, funkcje 75/93 (80,6%), plików 8 (bez pokrycia: 0), LOC 256

> Bez ani jednego wywołania: **18 funkcji** (6 nazwanych, 12 anonimowych domknięć). Nazwane:
>
> - `useClubThreadMilestones @ src/lib/clubs/useThreadWorkspace.ts:122`
> - `useUpsertClubThreadMilestone @ src/lib/clubs/useThreadWorkspace.ts:137`
> - `useRemoveClubThreadMilestone @ src/lib/clubs/useThreadWorkspace.ts:147`
> - `useAnswerClubThreadQuestion @ src/lib/clubs/useThreadWorkspace.ts:187`
> - `useDetachClubThreadPoll @ src/lib/clubs/useThreadWorkspace.ts:241`
> - `useRemoveClubThreadLink @ src/lib/clubs/useThreadWorkspace.ts:282`

**KLUBY: tematy, specjalizacje, obszary polityk** — linie 95,8%, funkcje 58/60 (96,7%), plików 10 (bez pokrycia: 0), LOC 166

> Bez ani jednego wywołania: **2 funkcji** (1 nazwanych, 1 anonimowych domknięć). Nazwane:
>
> - `buildSpecializationHead @ src/lib/clubs/specializationHead.ts:148`

**KLUBY: API i zapytania (klub, posty, wątki)** — linie 96,6%, funkcje 222/226 (98,2%), plików 10 (bez pokrycia: 0), LOC 591

> Bez ani jednego wywołania: **4 funkcji** (2 nazwanych, 2 anonimowych domknięć). Nazwane:
>
> - `uploadClubCover @ src/lib/clubs/coverApi.ts:69`
> - `setClubCover @ src/lib/clubs/coverApi.ts:95`

### 4.5 Login / rejestracja / wylogowanie (MODUŁ 15)

Razem: **663 / 977 linii = 67,86%**, funkcje **156/265 = 58,87%**.

**LOGIN: ustawienia logowania (admin)** — linie 2,5%, funkcje 0/51 (0,0%), plików 3 (bez pokrycia: 2), LOC 81

> Bez ani jednego wywołania: **51 funkcji** (6 nazwanych, 45 anonimowych domknięć). Nazwane:
>
> - `useAuthSettings @ src/hooks/useAuthSettings.ts:7`
> - `useSaveAuthSettings @ src/hooks/useAuthSettings.ts:22`
> - `LoginSettingsPage @ src/routes/admin.login-settings.tsx:26`
> - `ImageField @ src/routes/admin.login-settings.tsx:377`
> - `Card @ src/routes/admin.login-settings.tsx:475`
> - `BiField @ src/routes/admin.login-settings.tsx:495`

**LOGIN: ochrona przed brute force** — linie 11,1%, funkcje 0/9 (0,0%), plików 1 (bez pokrycia: 0), LOC 54

> Bez ani jednego wywołania: **9 funkcji** (3 nazwanych, 6 anonimowych domknięć). Nazwane:
>
> - `hashSubject @ src/lib/auth/bruteforce.functions.ts:23`
> - `currentIpHash @ src/lib/auth/bruteforce.functions.ts:27`
> - `hitBucket @ src/lib/auth/bruteforce.functions.ts:47`

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

**LOGIN: formularze auth w CMS (bloki + widget)** — linie 90,4%, funkcje 67/79 (84,8%), plików 3 (bez pokrycia: 0), LOC 363

> Bez ani jednego wywołania: **12 funkcji** (0 nazwanych, 12 anonimowych domknięć).

**LOGIN: MFA (2FA)** — linie 100,0%, funkcje 13/14 (92,9%), plików 2 (bez pokrycia: 0), LOC 44

> Bez ani jednego wywołania: **1 funkcji** (0 nazwanych, 1 anonimowych domknięć).

**LOGIN: reset hasła** — linie 100,0%, funkcje 16/16 (100,0%), plików 1 (bez pokrycia: 0), LOC 52

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

---

## 5. Zera: gdzie test nie dotarł wcale

### 5.1 Największe pliki produkcyjne z pokryciem 0%

| Plik                                                                        | LOC mierzone | Moduł                                              |
| --------------------------------------------------------------------------- | -----------: | -------------------------------------------------- |
| `src/routes/admin.podcasts.tsx`                                             |          337 | M7                                                 |
| `src/routes/admin.names.tsx`                                                |          296 | M19                                                |
| `src/lib/wordpress-import.functions.ts`                                     |          280 | M3                                                 |
| `src/routes/admin.users.index.tsx`                                          |          275 | M19                                                |
| `src/routes/admin.research-programs.tsx`                                    |          249 | M7                                                 |
| `src/lib/admin/invitations.functions.ts`                                    |          245 | M19                                                |
| `src/components/admin/blocks/BlockCanvas.tsx`                               |          218 | M3                                                 |
| `src/routes/$.tsx`                                                          |          213 | M20                                                |
| `src/components/admin/builder/Builder.tsx`                                  |          207 | M3                                                 |
| `src/components/admin/TrendingTickerPane.tsx`                               |          195 | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły |
| `src/routes/admin.tracker.tsx`                                              |          188 | M7                                                 |
| `src/routes/admin.organizations.$id.tsx`                                    |          187 | M19                                                |
| `src/routes/admin.users.$id.tsx`                                            |          169 | M19                                                |
| `src/components/admin/blocks/edit/Paragraph.tsx`                            |          167 | M3                                                 |
| `src/components/admin/analytics/GscBiDashboard.tsx`                         |          163 | M17                                                |
| `src/components/chat/ChatComposer.tsx`                                      |          160 | M9                                                 |
| `src/routes/admin.ads.tsx`                                                  |          158 | M14                                                |
| `src/routes/admin.paywall.tsx`                                              |          153 | M20                                                |
| `src/lib/server/publishedContent.server.ts`                                 |          151 | M20                                                |
| `src/routes/club.$clubSlug.t.$threadSlug.tsx`                               |          150 | M16                                                |
| `src/routes/admin.hiring.tsx`                                               |          148 | M21                                                |
| `src/routes/profile.security.tsx`                                           |          147 | M15                                                |
| `src/components/notifications/NotificationsCenter.tsx`                      |          146 | M12                                                |
| `src/components/admin/builder/ui/hooks/useBuilderOperations.ts`             |          145 | M3                                                 |
| `src/components/admin/WordPressImportDialog.tsx`                            |          142 | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły |
| `src/components/admin/clubs/organisms/ClubThreadsTab.tsx`                   |          141 | M16                                                |
| `src/components/admin/WxrUploadPanel.tsx`                                   |          140 | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły |
| `src/lib/wp-import.functions.ts`                                            |          137 | M3                                                 |
| `src/routes/club.apply.tsx`                                                 |          125 | M16                                                |
| `src/routes/admin.community.qa.tsx`                                         |          122 | M16                                                |
| `src/routes/admin.programs.tsx`                                             |          122 | M7                                                 |
| `src/routes/__root.tsx`                                                     |          121 | M20                                                |
| `src/components/admin/builder/ui/organisms/section-properties/TabsPane.tsx` |          121 | M3                                                 |
| `src/routes/admin.integrations.tsx`                                         |          118 | M19                                                |
| `src/components/admin/analytics/Ga4BiDashboard.tsx`                         |          116 | M17                                                |
| `src/lib/server/wp-media.server.ts`                                         |          116 | M20                                                |
| `src/routes/reading-list.tsx`                                               |          116 | M20                                                |
| `src/routes/profile.personality.tsx`                                        |          112 | M15                                                |
| `src/routes/admin.coupons.index.tsx`                                        |          111 | M14                                                |
| `src/components/admin/analytics/RelatedPostsAnalytics.tsx`                  |          111 | M17                                                |

Łącznie plików produkcyjnych z pokryciem **0%: 727** z 2 696 (26,97%).

### 5.2 Katalogi bez ANI JEDNEGO pliku testowego

Sygnał niezależny od pokrycia: katalog może mieć pokrycie z testu innego katalogu, ale nie ma
testu WŁASNEGO — czyli nikt nie testuje go wprost. Takich katalogów jest **74**,
obejmują **109 plików / 29 224 linii**.

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
| `src/components/admin/PostGeneralOverview.tsx`   |      1 |   620 |
| `src/components/admin/sidebarBuilder`            |      1 |   607 |
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

---

## 6. Które powierzchnie mają BRAMKĘ pokrycia (a które tylko liczbę)

Liczba bez bramki gnije: pokrycie spada z każdym mergem, którego nikt nie mierzy. Repo ma
**1 próg globalny + 203 progów per-ścieżka** w `vitest.config.ts`, egzekwowanych w CI krokiem
`Test + coverage gate` (`.github/workflows/ci.yml`).

| Moduł                                 | Progów per-ścieżka | Mediana progu linii | Najwyższy próg linii |
| ------------------------------------- | -----------------: | ------------------: | -------------------: |
| M11                                   |                 65 |                  98 |                  100 |
| M1                                    |                 26 |                 100 |                  100 |
| M2                                    |                 20 |                 100 |                  100 |
| M13                                   |                 18 |                 100 |                  100 |
| M15                                   |                 13 |                 100 |                  100 |
| M3                                    |                 11 |                  99 |                  100 |
| M20                                   |                 11 |                 100 |                  100 |
| M9                                    |                  9 |                  96 |                  100 |
| M17                                   |                  8 |                 100 |                  100 |
| M6                                    |                  8 |                 100 |                  100 |
| M19                                   |                  7 |                 100 |                  100 |
| powłoka panelu admin + atomy/molekuły |                  2 |                 100 |                  100 |
| M10                                   |                  2 |                  98 |                   98 |
| M8                                    |                  1 |                  90 |                   90 |
| M18                                   |                  1 |                  98 |                   98 |
| M7                                    |                  1 |                 100 |                  100 |

Z tego **40 progów obejmuje CAŁE POWIERZCHNIE** (wzorzec `/**`), a nie pojedyncze pliki —
to one decydują, czy nowy plik dołożony do katalogu automatycznie podlega bramce:

| Powierzchnia                                      | Instr. | Gał. | Funkcje | Linie | Moduł                                 |
| ------------------------------------------------- | -----: | ---: | ------: | ----: | ------------------------------------- |
| `src/components/builder/organisms/widget-view/**` |     95 |   87 |      94 |    97 | M3                                    |
| `src/components/admin/builder/**`                 |     27 |   26 |      16 |    28 | M3                                    |
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

**Czego bramka NIE pilnuje** — moduły bez ani jednego progu per-ścieżka:

- **MODUŁ 4 — Strony, wygląd, motyw, media, import**: linie 92,26%, funkcje 88,89%, plików 0%: 6/132
- **MODUŁ 5 — Strona główna, archiwa, chrome**: linie 96,15%, funkcje 93,15%, plików 0%: 1/54
- **MODUŁ 12 — Realtime / powiadomienia / web-push**: linie 47,98%, funkcje 43,97%, plików 0%: 13/28
- **MODUŁ 14 — Monetyzacja: kupony / darowizny / prezenty / reklamy**: linie 26,16%, funkcje 17,47%, plików 0%: 16/38
- **MODUŁ 16 — Społeczność: kluby, komentarze, moderacja**: linie 33,79%, funkcje 29,90%, plików 0%: 154/252
- **MODUŁ 21 — Rekrutacja / kariera**: linie 55,12%, funkcje 47,13%, plików 0%: 12/29

---

## 7. Cztery warstwy testów — co która realnie pokrywa

| Warstwa                             | Rozmiar                                     | Co dowodzi                                              | Czego NIE dowodzi                                                                 |
| ----------------------------------- | ------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Jednostkowe / komponentowe (vitest) | 1 230 plików, 19 416 testów, 38 363 asercji | logikę w TS/TSX, render komponentów, kontrakty modułów  | zachowania bazy (RLS/RPC/triggery), realnych ścieżek przeglądarki, SSR end-to-end |
| Baza (pgTAP)                        | 97 plików, 1 812 asercji                    | izolację tenanta, polityki RLS, kontrakty RPC, triggery | kodu frontu — v8 tego pokrycia NIE liczy                                          |
| E2E (Playwright)                    | 7 plików, 42 testów                         | ścieżki użytkownika, SSR, SEO, checkout                 | pokrycia jednostkowego (osobny proces, nie wchodzi do %)                          |
| Bramki statyczne (`check:*`)        | 33 skryptów                                 | kontrakty struktury (SQL, i18n, warstwy, bundle)        | wykonania kodu                                                                    |

To jest źródło pozornej sprzeczności: MODUŁ z ~20% pokrycia jednostkowego może być jednym
z najlepiej zabezpieczonych w systemie, jeśli jego reguły siedzą w bazie i mają pgTAP.

### 7.1 Rodzaje testów w suicie jednostkowej — i dlaczego rodzaj waży więcej niż liczba

Procent pokrycia odpowiada na pytanie „czy ta linia się wykonała”. Nie odpowiada na pytanie
„co zostało dowiedzione”. Odpowiada na nie RODZAJ testu — i dlatego dwa moduły z identycznym
pokryciem mogą mieć zupełnie inne ryzyko. Klasyfikacja poniżej powstała ze skanu treści
wszystkich plików testowych (sygnały: `renderHook`, `@testing-library/react`, `supabaseFromStub`,
`axe`, `createServerFn`, nazwy `*.gate.*`, `*.invariant.*`, `*Parity*`).

| Rodzaj testu                               | Plików | Testów | Asercji | As./test | Co DOWODZI                                                                                    | Czego NIE dowodzi                                                        |
| ------------------------------------------ | -----: | -----: | ------: | -------: | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| komponentowy (render + interakcja)         |    424 |  7 658 |  15 020 |     1,96 | że użytkownik to zobaczy: treść, stan wyłączony, komunikat błędu, reakcja na kliknięcie       | zachowania na prawdziwej przeglądarce i prawdziwych danych z bazy        |
| jednostkowy (czysta reguła)                |    583 |  7 504 |  15 032 |     2,00 | reguły w izolacji: wejście → wyjście, przypadki graniczne, gałęzie warunków                   | że reguła jest w ogóle wywołana przez aplikację (poprawnego okablowania) |
| warstwy danych (atrapa PostgREST)          |     45 |  1 408 |   2 540 |     1,80 | kształtu zapytania: filtry, kolejność ogniw, limit, zachowanie przy błędzie PostgREST         | że polityka RLS na serwerze przepuści to zapytanie                       |
| hooka (renderHook)                         |     62 |  1 377 |   2 692 |     1,95 | cyklu życia i unieważniania cache: kolejność efektów, sprzątanie, ponowne pobranie po mutacji | wyglądu; hook może być poprawny, a widok nadal pokazywać stare dane      |
| funkcji serwerowej                         |     64 |  1 110 |   2 368 |     2,13 | bramek wykonania: tenant, uprawnienia, rate limit, audyt, ścieżka błędu                       | że klient wywoła funkcję w odpowiednim momencie                          |
| parytetu (dwa artefakty muszą się zgadzać) |     18 |    121 |     257 |     2,12 | ZGODNOŚCI DWÓCH ARTEFAKTÓW (panel ⇄ renderer, snapshot ⇄ migracje, PL ⇄ EN)                   | poprawności żadnej ze stron osobno — tylko tego, że się nie rozjechały   |
| bramki (meta-inwariant CI)                 |     16 |    107 |     178 |     1,66 | meta-inwariantu repo: że bramka istnieje, jest wpięta i coś sprawdza                          | zachowania kodu produkcyjnego                                            |
| dostępności (axe)                          |     10 |     77 |     163 |     2,12 | kontraktu dostępności: role, etykiety, kolejność fokusu, brak naruszeń axe                    | sensu treści dla czytnika ekranu (to ocenia człowiek)                    |
| inwariantu (nie wolno złamać reguły)       |      4 |     39 |      83 |     2,13 | że reguła nie została złamana NIGDZIE w repo — skaluje się z kodem, nie z przypadkiem         | poprawności pojedynczej ścieżki użytkownika                              |
| dymny (czy w ogóle stoi)                   |      3 |     13 |      26 |     2,00 | że powierzchnia wstaje i nie rzuca przy montażu                                               | niczego o zachowaniu — to detektor katastrofy, nie dowód                 |
| integracyjny (wiele warstw)                |      1 |      2 |       4 |     2,00 | współpracy kilku warstw naraz na jednym scenariuszu                                           | izolowanej przyczyny awarii — po padnięciu trzeba szukać dalej           |

**Pięć wniosków, które wynikają z tej tabeli, a nie z procentów:**

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

Do tego dochodzą rodzaje, których v8 nie widzi wcale: **pgTAP** (97 plików) dowodzi
polityk i triggerów, **Playwright** (7 plików) ścieżek użytkownika i realnego SSR,
a **bramki skryptowe `check:*`** (33) kontraktów strukturalnych, w których nie ma
kodu do wykonania — na przykład tego, że każda bramka jest wpięta w workflow.

---

## 8. Wnioski: gdzie ryzyko jest największe

Ryzyko liczę jako BEZWZGLĘDNĄ liczbę niepokrytych linii, nie procent — 20% na module o 50 tys.
linii to większa dziura niż 20% na module o 5 tys.

| #   | Moduł                                                 | Linii niepokrytych | Linie % | Funkcje % | Testów |
| --- | ----------------------------------------------------- | -----------------: | ------: | --------: | -----: |
| 3   | Silniki treści: bloki + page builder                  |         **10 172** |  52,34% |    38,71% |  2 369 |
| 16  | Społeczność: kluby, komentarze, moderacja             |          **5 188** |  33,79% |    29,90% |  1 254 |
| 20  | Platforma / backend / infrastruktura / SSR            |          **3 900** |  54,52% |    42,39% |  2 208 |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |          **3 200** |  25,87% |    21,26% |    448 |
| 7   | Typy treści specjalne                                 |          **2 557** |  44,18% |    37,90% |  1 112 |
| 17  | Analityka i BI                                        |          **2 152** |  29,93% |    24,52% |    199 |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |          **1 724** |  66,39% |    76,58% |  1 538 |
| 15  | Profil i konto                                        |          **1 614** |  53,31% |    50,39% |    653 |
| 9   | Czat / komunikator                                    |          **1 231** |  62,16% |    57,74% |    607 |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |          **1 022** |  26,16% |    17,47% |     88 |

### 8.1 Rekomendacje — kolejność, nie lista życzeń

**R1. Zgasić 10 CZERWONYCH PROGÓW per-ścieżka — bramka pokrycia jest dziś czerwona nie z powodu regresji, a z powodu progów wpisanych ponad osiągnięty poziom.**
Przebieg na tym HEAD zwraca dziesięć naruszeń w pięciu plikach monetyzacji i retencji:
`lib/billing/membership.ts` (instrukcje 98,86% wobec progu 100, gałęzie 93,65% wobec 95),
`lib/billing/diagnostics.server.ts` (gałęzie 91,11% wobec 92),
`lib/billing/portalLink.server.ts` (linie 92,59% wobec 96, instrukcje 93,75% wobec 95),
`lib/billing/queries.ts` (instrukcje 95,52% wobec 96, gałęzie 80,55% wobec 88),
`lib/retention/queries.ts` (linie 81,81% wobec 90, funkcje 71,42% wobec 85, instrukcje 84,61% wobec 90).
To nie jest to samo co spadek pokrycia: progi ustawiono aspiracyjnie, a nie „tuż pod zmierzonym”.
Skutek jest jednak identyczny — `bun run test:coverage` pada, więc kolejna osoba nie odróżni własnej
regresji od zastanego długu. Dwie dopuszczalne drogi, dla każdego pliku osobno: dobić brakujące
gałęzie testem (preferowane w `retention/queries.ts`, gdzie brak 13 pp jest realną dziurą)
albo obniżyć próg do zmierzonego z komentarzem „floor, nie cel” (uzasadnione w `membership.ts`,
gdzie brakuje 1,14 pp na nieosiągalnym ramieniu). Czego NIE robić: zostawić czerwono „do wyjaśnienia”.

**R2. Naprawić jedyny czerwony test w suicie — to ten sam defekt, który audyt zgłosił 18.08.**
`src/components/builder/organisms/widget-view/__tests__/lazyWidgets.test.ts` („does not leak unexpected
exports”) nadal pada na tym samym eksporcie: **`TrendingNowView`** jest w rejestrze leniwych widgetów,
ale nie ma go na liście `SPLIT_WIDGETS` w teście. Jeden dopisany wiersz albo jedno usunięcie eksportu.
Waga tej pozycji nie leży w rozmiarze poprawki: przez ostatnią dobę suita urosła z 8 274 do 21 835
testów, a ten jeden został. Zapora strukturalna, która stoi czerwona i nikogo nie zatrzymuje, po kilku
tygodniach przestaje być zaporą — dokładnie tak zginęła bramka `check:authz-snapshot` opisana
w `src/lib/ci/gateCoverage.ts`.

**R3. MODUŁ 19 (ustawienia / integracje / users / multi-tenant / RODO) jest teraz najsłabszym punktem systemu — 25,87% linii i 21,26% funkcji.**
To jedyny duży moduł, który przez ostatnią dobę nie ruszył się praktycznie w ogóle (20,92% → 25,87%),
a mieszka w nim macierz uprawnień, zgody, cookie banner, izolacja tenanta i eksport danych — czyli
warstwa, w której defekt jest zdarzeniem prawnym, nie usterką. 56 z 130 plików nie wykonuje ani jednej
linii. Rodzaj testu, który tu decyduje, jest inny niż w modułach zamkniętych w ostatniej dobie:
**inwariant i parytet** (snapshot bramek kontra migracje, macierz kontra rejestr capabilities),
bo zawężenia kręgu uprawnionych nie widzi żaden test pojedynczej funkcji — każda z nich osobno działa.

**R4. MODUŁ 16 (kluby, komentarze, moderacja) pozostaje największą bezwzględną dziurą: 154 z 252 plików na zerze.**
Wzrost 17,6% → 33,79% to realna praca, ale wciąż 154 pliki bez ani jednej wykonanej linii i 947 z 3 167
wywołanych funkcji. Kolejność bez zmian względem wydania 18.08: warstwa danych (`lib/clubs/api.ts`),
potem hooki (`useClubs.ts` — rozbić przed testowaniem), potem bramka dostępu i moderacja.
Atrapa łańcucha PostgREST jest już w repo (`src/test/chat/fixtures.ts` → `supabaseFromStub`),
więc koszt wejścia, który blokował ten moduł, przestał istnieć.

**R5. MODUŁ 14 (kupony / darowizny / prezenty / reklamy) — 17,47% funkcji przy pieniądzach na wejściu.**
Najniższy wymiar funkcyjny w całym repo poza modułem 3. Darowizna i kupon to transakcja: kwota,
waluta, limit wykorzystań. Reguły kwot mają testy (`couponMoney`, `couponAuditCurrency`), ale
80 z 458 funkcji tego modułu nigdy nie zostało wywołanych. Ten moduł nie dostał jeszcze własnego
podejścia — a jest mały (38 plików), więc to najtańsze domknięcie z pozostałych.

**R6. Podnieść progi tam, gdzie pomiar odjechał od bramki — inaczej wczorajsza praca wyparuje.**
Cztery moduły są dziś dramatycznie powyżej swoich progów: CRM (98,98% linii), edytor wpisów (99,42%),
wyszukiwarka (97,38%), chrome (96,15%), a moduł 4 (92,26%) i newsletter (81,47%) niedaleko.
Zasada z configu („ten próg wolno wyłącznie podnosić”) działa tylko wtedy, gdy ktoś realnie go podnosi
po zakończonej pracy. Dopisanie progu zbiorczego per powierzchnia (`lib/crm/**`,
`components/admin/newsletter/**`, `components/search/**`, `lib/menus/**`) jest tańsze niż 203 progi
per plik i pilnuje też plików, które dopiero powstaną — dziś tylko część progów obejmuje całe katalogi.

**R7. Nie mylić wysokiego procentu z dowodem — rozdział 7.1 podaje, jak to rozpoznać.**
Trzy powierzchnie o wysokim pokryciu i niskiej wartości dowodowej: słowniki i18n (92,45% linii przy
55,36% funkcji — artefakt importu obiektów), trasy sprowadzone do loaderów oraz testy, które wykonują
kod, ale nie sprawdzają wyniku. Wskaźnik do obserwowania obok procentu: **asercje na test** —
dziś 38 363 asercji na 19 416 statycznie policzonych przypadków (1,98), stabilnie na każdym rodzaju testu.
Spadek tej liczby poniżej 1,5 przy rosnącym procencie znaczyłby powrót warstwy, którą repo raz już usunęło.

**R8. Domknąć wymiar funkcyjny w modułach z wysokimi liniami — tam siedzi reszta ryzyka.**
Moduł 3 ma 52,34% linii, ale 38,71% funkcji (2 651 z 6 848): to rozjazd typowy dla powierzchni,
w której testy renderują komplet, ale nie wchodzą w gałęzie ustawień. Podobnie moduł 20 (54,52% linii
wobec 42,39% funkcji) i moduł 12 (47,98% wobec 43,97%). Wymiar funkcyjny jest najostrzejszy z czterech
i najlepiej opisuje „ile zachowań tego modułu ktoś kiedykolwiek uruchomił” — planując dalszą pracę,
sortuj po nim, nie po liniach.

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
| 2   | Edytor wpisów i workflow redakcyjny                   |    99 |       14 292 |            86 |     23 425 |
| 3   | Silniki treści: bloki + page builder                  |   454 |      110 601 |           210 |     35 962 |
| 4   | Strony, wygląd, motyw, media, import                  |   133 |       16 859 |            73 |     15 393 |
| 5   | Strona główna, archiwa, chrome                        |    54 |        9 721 |            27 |      7 801 |
| 6   | Wyszukiwarka                                          |    24 |        4 662 |            21 |      6 119 |
| 7   | Typy treści specjalne                                 |   115 |       25 433 |            57 |     13 187 |
| 8   | SEO, feedy, dane strukturalne                         |    73 |       10 272 |            38 |      3 850 |
| 9   | Czat / komunikator                                    |    81 |       15 602 |            36 |      9 164 |
| 10  | Sieć / networking                                     |    31 |        5 004 |            22 |      4 974 |
| 11  | Newsletter i e-mail                                   |   147 |       28 636 |            88 |     26 865 |
| 12  | Realtime / powiadomienia / web-push                   |    28 |        5 374 |            13 |      1 672 |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |   185 |       26 394 |            91 |     23 689 |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |    38 |        7 786 |            11 |      1 402 |
| 15  | Profil i konto                                        |    81 |       18 003 |            36 |     10 372 |
| 16  | Społeczność: kluby, komentarze, moderacja             |   252 |       52 772 |            77 |     17 295 |
| 17  | Analityka i BI                                        |    85 |       16 520 |            19 |      2 229 |
| 18  | CRM                                                   |    57 |       16 062 |            32 |     10 336 |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |   130 |       23 800 |            29 |      5 170 |
| 20  | Platforma / backend / infrastruktura / SSR            |   185 |       58 124 |           149 |     33 062 |
| 21  | Rekrutacja / kariera                                  |    29 |        5 231 |            11 |      2 202 |
| —   | PRZEKROJOWE: słowniki i18n                            |   117 |       41 197 |             6 |        528 |
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

### 9.3 Odtworzenie pomiaru

```bash
bun install                    # rejestr prywatny Lovable (piny z bun.lock)
bun run test:coverage          # próg globalny + 203 progów per-ścieżka
```

Od wdrożenia R1 z wydania 1 (`coverage.reportOnFailure: true` w configu) raport i progi powstają
TAKŻE na czerwonej suicie, więc powyższe jedno polecenie wystarcza — obejście z wydania 1 nie jest
już potrzebne. Pełny przebieg na tym HEAD: ~10 minut, 1 230 plików testowych, 21 835 testów.

Agregacja per moduł / funkcja / funkcjonalność powstała z `coverage/coverage-final.json`
(mapy `statementMap`/`fnMap`/`branchMap` + liczniki `s`/`f`/`b`) oraz `coverage-summary.json`:
moduł = suma po plikach pasujących do reguł z 9.1, funkcjonalność = suma po wzorcach ścieżek,
„funkcja bez wywołania” = wpis `fnMap`, którego licznik `f` wynosi zero.
