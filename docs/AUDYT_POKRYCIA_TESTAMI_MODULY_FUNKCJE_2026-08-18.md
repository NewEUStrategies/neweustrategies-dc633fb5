# Audyt pokrycia testami: moduł po module, funkcja po funkcji (2026-08-19)

**Wydanie 3 pomiaru.** Rodowód: wydanie 1 (2026-08-18, HEAD `e83570c`) musiało wykluczyć
39 plików testowych wiszących w kolekcji; wydanie 2 (2026-08-19, HEAD `86417e9`) było pierwszym
KOMPLETNYM pomiarem. To wydanie mierzy HEAD `8797ca8e3` — 33 commity za wydaniem 2, w tym siedem
nowych plików testowych, naprawa jedynego czerwonego testu suity i re-floor czterech progów
w `billing`. Suita: 1 230 → 1 237 plików testowych.
Plik pozostaje pod tą samą nazwą, bo odwołuje się do niego komentarz przy progu globalnym
w `vitest.config.ts` oraz prompty modułowe. Zmiany względem wydania 2 są w rozdziale 2.1,
mechanizm re-flooru progów w rozdziale 6.1.

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
| Plików produkcyjnych w mianowniku  | 2 703                                                                                                                                                     |
| Plików testowych zmierzonych       | 1 237 z 1 237 (100,0%)                                                                                                                                    |
| Przypadków testowych wykonanych    | 22 052 (statyczny licznik `it/test` w plikach: 19 629; różnica to rozwinięcia `it.each`)                                                                  |
| Testy poza pomiarem                | brak — żaden plik nie został wykluczony z przebiegu                                                                                                       |
| Testy czerwone w tym przebiegu     | **0 — suita jest w całości zielona** (pierwszy taki przebieg w trzech wydaniach)                                                                          |
| Testy pominięte                    | 2 pliki / 50 testów — wymagają danych dostępowych do Supabase, których sandboks nie ma (rozdział 9.2)                                                     |
| Wynik bramki pokrycia              | przebieg zakończony kodem **0**: próg globalny i wszystkie 208 progów per-ścieżka PRZESZŁY                                                                |
| Data pomiaru                       | 2026-08-19, HEAD `8797ca8e3`                                                                                                                              |

**Cztery zastrzeżenia, bez których te procenty można źle odczytać:**

1. **Pokrycie ≠ poprawność.** Instrukcja „pokryta” to instrukcja, która się WYKONAŁA w trakcie
   testu — nie taka, której wynik ktoś sprawdził asercją. Dlatego obok pokrycia podaję gęstość
   asercji (kolumna „asercje”) — moduł z wysokim pokryciem i niską liczbą asercji to render bez dowodu.
2. **Pokrycie jednostkowe to nie całe pokrycie systemu.** Warstwa danych (RLS, RPC, triggery) jest
   testowana w pgTAP (97 plików, 1 812 asercji), a ścieżki użytkownika w Playwright
   (7 plików, 42 testów). Tych warstw v8 nie widzi — moduł z niskim %
   jednostkowym może mieć realną zaporę w bazie (rozdział 7).
3. **Mapowanie plik → moduł jest MOJE, nie repo.** Repo nie ma manifestu modułów; przypisanie
   2 703 plików do 21 modułów zrobiłem regułami po ścieżkach (rozdział 9.1). Pliki graniczne
   (np. `gifting` — „podaruj artykuł” jest funkcją MODUŁU 1, a kod leży w powierzchni MODUŁU 14)
   zaznaczam w tabelach.
4. **Pomiar jest KOMPLETNY i po raz pierwszy w całości ZIELONY.** Wydanie 1 musiało wykluczyć
   39 plików testowych wiszących w fazie kolekcji (zakleszczenie cyklu pod fabryką `vi.mock`
   w warstwie leniwych widgetów — naprawione przed wydaniem 2, z odzyskiem 1 026 testów). Wydanie 2
   zmierzyło wszystko, ale przy jednym czerwonym teście i dziesięciu czerwonych progach per-ścieżka.
   Ten przebieg: **1 235 plików / 22 002 testy przeszły, ani jeden nie padł**, a bramka pokrycia
   wyszła kodem 0. Poza pomiarem zostały 2 pliki (50 testów) pomijające się SAME z braku danych
   dostępowych do Supabase — to inwarianty na żywej bazie, piąta warstwa testów w tym repo, której
   ten dokument nie mierzy z zasady (rozdział 7). Na CI z sekretami one się wykonują.

---

## 1. Wynik globalny: całe `src/`

| Metryka    | Pokryte / wszystkich |          % |
| ---------- | -------------------: | ---------: |
| Instrukcje |     60 115 / 106 250 | **56,57%** |
| Gałęzie    |      49 141 / 97 441 | **50,43%** |
| Funkcje    |      14 926 / 29 404 | **50,76%** |
| Linie      |      53 352 / 92 915 | **57,42%** |

Próg globalny w `vitest.config.ts` (ratchet, wolno tylko podnosić): **33% instrukcji /
28% gałęzi / 25% funkcji / 33% linii**. Zmierzony margines nad progiem:
instrukcje 23,57 pp, gałęzie 22,43 pp,
funkcje 25,76 pp, linie 24,42 pp.

**Kontrola wiarygodności pomiaru.** Komentarz przy progu w `vitest.config.ts` dokumentuje ostatni
pomiar zespołu: 37,19% instrukcji / 32,41% gałęzi /
29,13% funkcji / 37,78% linii.
Ten audyt, niezależnym przebiegiem: 56,57% / 50,43% / 50,76% / 57,42%.
Kierunek i rząd wielkości się zgadzają, co znaczy, że obie liczby mierzą to samo i tak samo. Ale
różnica ~19 pp nie jest już „pracą wykonaną od tamtego pomiaru”: to komentarz, którego nikt nie
zaktualizował po tygodniu intensywnej pracy testowej. Skutek praktyczny jest realny, bo to jest
liczba, po którą sięga każdy czytający config — i każdy prompt modułowy oparty na tym audycie.
Pozycja R1 tego wydania (rozdz. 8.1) obejmuje jej odświeżenie razem z podniesieniem progu.

**Zmiana jakościowa, nie ilościowa: bramka pokrycia jest zielona.** W wydaniu 2 suita miała jeden
czerwony test (`lazyWidgets` — `TrendingNowView` poza listą `SPLIT_WIDGETS`) i dziesięć czerwonych
progów per-ścieżka w pięciu plikach `billing`/`retention`. Oba defekty zostały w tych 33 commitach
zamknięte: test wpisem brakującego widgetu, progi re-floorem do wartości zmierzonych (mechanizm
i jego koszt — 60 przebiegów `main` bez zieleni i osiem bramek jako `skipped` — w rozdziale 6.1).
Praktyczna konsekwencja: od teraz czerwony `test:coverage` znaczy REGRESJĘ autora zmiany, a nie
zastany dług. To warunek, bez którego bramka pokrycia nie działa jako bramka, niezależnie od tego,
jak wysoko stoją progi.

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
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |         130 |     27,53% |  22,97% |  22,65% | **27,50%** |        56 | 0,231 |    481 |     976 |
| 17  | Analityka i BI                                        |          85 |     29,25% |  23,07% |  24,52% | **29,93%** |        49 | 0,224 |    199 |     442 |
| 16  | Społeczność: kluby, komentarze, moderacja             |         252 |     34,96% |  31,72% |  29,90% | **33,79%** |       154 | 0,306 |  1 254 |   2 162 |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    |         172 |     39,05% |  32,29% |  36,95% | **40,46%** |        38 | 0,186 |    439 |     974 |
| 7   | Typy treści specjalne                                 |         115 |     44,50% |  40,88% |  37,90% | **44,18%** |        42 | 0,496 |  1 112 |   1 799 |
| 12  | Realtime / powiadomienia / web-push                   |          28 |     45,30% |  31,08% |  43,97% | **47,98%** |        13 | 0,464 |     93 |     223 |
| 3   | Silniki treści: bloki + page builder                  |         453 |     51,17% |  48,82% |  38,73% | **52,34%** |       120 | 0,463 |  2 370 |   5 105 |
| 20  | Platforma / backend / infrastruktura / SSR            |         184 |     53,70% |  42,43% |  42,34% | **54,55%** |        66 | 0,805 |  2 208 |   4 640 |
| 21  | Rekrutacja / kariera                                  |          29 |     54,96% |  53,52% |  47,13% | **55,12%** |        12 | 0,379 |    171 |     374 |
| 15  | Profil i konto                                        |          81 |     54,99% |  49,86% |  51,95% | **56,03%** |        28 | 0,469 |    716 |   1 469 |
| 8   | SEO, feedy, dane strukturalne                         |          74 |     56,52% |  48,73% |  53,25% | **56,08%** |        23 | 0,527 |    350 |     792 |
| 9   | Czat / komunikator                                    |          81 |     60,78% |  51,37% |  57,74% | **62,16%** |        15 | 0,444 |    607 |   1 123 |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |         185 |     65,02% |  60,42% |  76,36% | **66,32%** |        35 | 0,492 |  1 562 |   3 192 |
| —   | PRZEKROJOWE: design system (components/ui)            |          43 |     76,38% |  60,48% |  70,61% | **78,49%** |         6 | 0,047 |     17 |      37 |
| 1   | Wpisy: doświadczenie czytelnika                       |          86 |     79,34% |  72,08% |  77,07% | **80,93%** |        13 | 0,616 |    948 |   2 008 |
| 11  | Newsletter i e-mail                                   |         147 |     80,53% |  71,48% |  82,71% | **81,47%** |        29 | 0,599 |  1 962 |   4 232 |
| 10  | Sieć / networking                                     |          32 |     78,38% |  67,98% |  80,86% | **81,98%** |         3 | 0,719 |    349 |     642 |
| 4   | Strony, wygląd, motyw, media, import                  |         132 |     90,89% |  82,16% |  88,89% | **92,26%** |         6 | 0,549 |  1 235 |   2 140 |
| —   | PRZEKROJOWE: słowniki i18n                            |         118 |     88,53% |  66,91% |  55,03% | **92,49%** |         1 | 0,051 |     60 |     141 |
| 5   | Strona główna, archiwa, chrome                        |          54 |     94,31% |  82,49% |  93,15% | **96,15%** |         1 | 0,500 |    541 |     925 |
| 6   | Wyszukiwarka                                          |          24 |     96,66% |  89,91% |  95,22% | **97,38%** |         0 | 0,875 |    528 |     839 |
| 18  | CRM                                                   |          57 |     98,17% |  86,43% |  98,49% | **98,98%** |         0 | 0,561 |    701 |   1 228 |
| 2   | Edytor wpisów i workflow redakcyjny                   |         103 |     98,66% |  94,67% |  98,73% | **99,22%** |         0 | 0,854 |  1 576 |   2 928 |

### 2.1 Zmiana od wydania 2 — co dały 33 commity

Poprzedni pomiar (wydanie 2, 2026-08-19, HEAD `86417e9`) obejmował 1 230 z 1 230 plików
testowych i 2 696 plików produkcyjnych. Ten obejmuje 1 237 z 1 237
i 2 703. Kolumna Δ to różnica w punktach procentowych wobec wydania 2; ostatnia kolumna to
różnica KUMULACYJNA wobec wydania 1 (2026-08-18), żeby było widać, ile z dzisiejszego stanu
powstało w ciągu tych dwóch dni. Strzałka ↑ znaczy, że modułem ktoś się zajął.

| #   | Moduł                                                 | Linie wyd. 2 | Linie teraz |   Δ linie | Funkcje wyd. 2 | Funkcje teraz | Δ funkcje | Δ linie od wyd. 1 |
| --- | ----------------------------------------------------- | -----------: | ----------: | --------: | -------------: | ------------: | --------: | ----------------: |
| 8   | SEO, feedy, dane strukturalne                         |       51,66% |  **56,08%** | ↑ +4,4 pp |         50,00% |    **53,25%** | ↑ +3,3 pp |         ↑ +5,8 pp |
| 15  | Profil i konto                                        |       53,31% |  **56,03%** | ↑ +2,7 pp |         50,39% |    **51,95%** | ↑ +1,6 pp |        ↑ +36,9 pp |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |       25,87% |  **27,50%** | ↑ +1,6 pp |         21,26% |    **22,65%** | ↑ +1,4 pp |         ↑ +5,5 pp |
| 10  | Sieć / networking                                     |       81,22% |  **81,98%** | ↑ +0,8 pp |         80,79% |    **80,86%** | ↑ +0,1 pp |         ↑ +0,3 pp |
| —   | PRZEKROJOWE: słowniki i18n                            |       92,45% |  **92,49%** |    0,0 pp |         55,36% |    **55,03%** | ↓ -0,3 pp |         ↑ +0,7 pp |
| 20  | Platforma / backend / infrastruktura / SSR            |       54,52% |  **54,55%** |    0,0 pp |         42,39% |    **42,34%** | ↓ -0,1 pp |         ↑ +1,8 pp |
| 1   | Wpisy: doświadczenie czytelnika                       |       80,93% |  **80,93%** |    0,0 pp |         77,07% |    **77,07%** |    0,0 pp |        ↑ +49,1 pp |
| 4   | Strony, wygląd, motyw, media, import                  |       92,26% |  **92,26%** |    0,0 pp |         88,89% |    **88,89%** |    0,0 pp |        ↑ +69,5 pp |
| 5   | Strona główna, archiwa, chrome                        |       96,15% |  **96,15%** |    0,0 pp |         93,15% |    **93,15%** |    0,0 pp |        ↑ +79,4 pp |
| 6   | Wyszukiwarka                                          |       97,38% |  **97,38%** |    0,0 pp |         95,22% |    **95,22%** |    0,0 pp |        ↑ +64,2 pp |
| 7   | Typy treści specjalne                                 |       44,18% |  **44,18%** |    0,0 pp |         37,90% |    **37,90%** |    0,0 pp |        ↑ +27,7 pp |
| 9   | Czat / komunikator                                    |       62,16% |  **62,16%** |    0,0 pp |         57,74% |    **57,74%** |    0,0 pp |         ↑ +0,2 pp |
| 11  | Newsletter i e-mail                                   |       81,47% |  **81,47%** |    0,0 pp |         82,71% |    **82,71%** |    0,0 pp |        ↑ +54,8 pp |
| 12  | Realtime / powiadomienia / web-push                   |       47,98% |  **47,98%** |    0,0 pp |         43,97% |    **43,97%** |    0,0 pp |         ↑ +3,9 pp |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |       26,16% |  **26,16%** |    0,0 pp |         17,47% |    **17,47%** |    0,0 pp |         ↑ +3,6 pp |
| 16  | Społeczność: kluby, komentarze, moderacja             |       33,79% |  **33,79%** |    0,0 pp |         29,90% |    **29,90%** |    0,0 pp |        ↑ +16,2 pp |
| 17  | Analityka i BI                                        |       29,93% |  **29,93%** |    0,0 pp |         24,52% |    **24,52%** |    0,0 pp |         ↑ +1,9 pp |
| 18  | CRM                                                   |       98,98% |  **98,98%** |    0,0 pp |         98,49% |    **98,49%** |    0,0 pp |        ↑ +86,9 pp |
| 21  | Rekrutacja / kariera                                  |       55,12% |  **55,12%** |    0,0 pp |         47,13% |    **47,13%** |    0,0 pp |            0,0 pp |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    |       40,46% |  **40,46%** |    0,0 pp |         36,95% |    **36,95%** |    0,0 pp |        ↑ +16,0 pp |
| —   | PRZEKROJOWE: design system (components/ui)            |       78,49% |  **78,49%** |    0,0 pp |         70,61% |    **70,61%** |    0,0 pp |        ↑ +15,4 pp |
| 3   | Silniki treści: bloki + page builder                  |       52,34% |  **52,34%** |    0,0 pp |         38,71% |    **38,73%** |    0,0 pp |        ↑ +12,3 pp |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |       66,39% |  **66,32%** | ↓ -0,1 pp |         76,58% |    **76,36%** | ↓ -0,2 pp |        ↑ +33,6 pp |
| 2   | Edytor wpisów i workflow redakcyjny                   |       99,42% |  **99,22%** | ↓ -0,2 pp |         99,18% |    **98,73%** | ↓ -0,4 pp |        ↑ +90,9 pp |

Ruszyło 3 powierzchni (powyżej 1 pp), 21 stoi w granicach ±1 pp, 0 spadło o więcej niż 1 pp.
To dokładnie ten obraz, jakiego należy oczekiwać po 33 commitach z siedmioma nowymi plikami testowymi:
ruch jest wąski i pokrywa się co do modułu z tym, czego te commity dotknęły — reguły zero-click w SEO,
ochrona przed brute force i scalanie danych gościa w profilu, funkcje serwerowe retencji w ustawieniach,
przycisk kontaktu w sieci. Pozostałe powierzchnie nie dostały w tym okresie ani jednego nowego testu
i ich liczby są niezmienione co do drugiego miejsca po przecinku — takich powierzchni jest 18.

**2 powierzchnie spadły o ułamek punktu i to nie jest regresja testów, a DYLUCJA:** MODUŁ 13 ↓ -0,1 pp, MODUŁ 2 ↓ -0,2 pp.
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
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |           458 |         80 | **17,47%** |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |         1 439 |        326 | **22,65%** |
| 17  | Analityka i BI                                        |           877 |        215 | **24,52%** |
| 16  | Społeczność: kluby, komentarze, moderacja             |         3 167 |        947 | **29,90%** |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    |         1 678 |        620 | **36,95%** |
| 7   | Typy treści specjalne                                 |         1 641 |        622 | **37,90%** |
| 3   | Silniki treści: bloki + page builder                  |         6 848 |      2 652 | **38,73%** |
| 20  | Platforma / backend / infrastruktura / SSR            |         1 984 |        840 | **42,34%** |
| 12  | Realtime / powiadomienia / web-push                   |           373 |        164 | **43,97%** |
| 21  | Rekrutacja / kariera                                  |           348 |        164 | **47,13%** |
| 15  | Profil i konto                                        |         1 028 |        534 | **51,95%** |
| 8   | SEO, feedy, dane strukturalne                         |           492 |        262 | **53,25%** |
| —   | PRZEKROJOWE: słowniki i18n                            |           169 |         93 | **55,03%** |
| 9   | Czat / komunikator                                    |         1 060 |        612 | **57,74%** |
| —   | PRZEKROJOWE: design system (components/ui)            |           228 |        161 | **70,61%** |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |         1 358 |      1 037 | **76,36%** |
| 1   | Wpisy: doświadczenie czytelnika                       |           615 |        474 | **77,07%** |
| 10  | Sieć / networking                                     |           303 |        245 | **80,86%** |
| 11  | Newsletter i e-mail                                   |         1 556 |      1 287 | **82,71%** |
| 4   | Strony, wygląd, motyw, media, import                  |         1 008 |        896 | **88,89%** |
| 5   | Strona główna, archiwa, chrome                        |           555 |        517 | **93,15%** |
| 6   | Wyszukiwarka                                          |           293 |        279 | **95,22%** |
| 18  | CRM                                                   |         1 058 |      1 042 | **98,49%** |
| 2   | Edytor wpisów i workflow redakcyjny                   |           868 |        857 | **98,73%** |

---

## 3. Pokrycie per funkcjonalność (121 funkcjonalności w 21 modułach)

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

### MODUŁ 2 — Edytor wpisów i workflow redakcyjny · linie 99,22% · funkcje 98,73%

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

### MODUŁ 3 — Silniki treści: bloki + page builder · linie 52,34% · funkcje 38,73%

**Rodzaje testów:** jednostkowy 104 · komponentowy 85 · hooka 7 · parytetu 8 · bramki 3 · dostępności 2 · dymny 1.

**Co tu decyduje:** decyduje **test parytetu**: rejestr widgetów, panel właściwości i renderer to trzy artefakty, które muszą mówić to samo, a rozjazd „panel ustawia, renderer ignoruje” łapie wyłącznie porównanie dwóch stron (`check:widget-fidelity`, `settingsFidelity.gate`). Test jednostkowy schematu i test komponentu widgetu są konieczne, ale ani jeden, ani drugi nie zauważy dryfu między nimi.

**Bez tego rodzaju przechodzi taki defekt:** panel zapisuje ustawienie pod kluczem `heightMobile`, renderer czyta `mobileHeight`. Oba pliki mają testy, oba są zielone, a strona na telefonie ignoruje ustawienie — to dokładnie ta klasa defektu, dla której powstała bramka `check:widget-fidelity`.

| Funkcjonalność                                         | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ------------------------------------------------------ | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| CMS: panele właściwości widgetów                       |    112 |      4 666 |  29,2% | 28,0% |   17,7% | **29,7%** |  368/2074 |
| CMS: builder sidebara + wzorce                         |      6 |        224 |  29,3% | 10,1% |   17,6% | **31,3%** |    21/119 |
| CMS: render bloków (publiczny)                         |     39 |      1 909 |  38,2% | 21,3% |   23,3% | **40,8%** |   120/516 |
| CMS: import z Gutenberga / WordPressa                  |     10 |      1 309 |  49,2% | 43,4% |   58,4% | **51,3%** |   146/250 |
| CMS: silnik bloków (typ Gutenberg) — rdzeń             |      9 |        358 |  63,5% | 62,7% |   43,5% | **63,1%** |    64/147 |
| CMS: silnik treści publicznej (contentEngine)          |     19 |        521 |  79,5% | 77,9% |   82,2% | **80,6%** |    97/118 |
| CMS: zapytania danych widgetów                         |      8 |        459 |  78,3% | 68,8% |   87,9% | **83,2%** |   123/140 |
| CMS: design tokens / kolory globalne / typografia      |      6 |        257 |  84,8% | 80,9% |   87,5% | **87,2%** |     35/40 |
| CMS: edycja bloków (selekcja, focus, schowek, undo)    |      6 |        236 |  88,1% | 82,6% |  100,0% | **89,4%** |     45/45 |
| CMS: widgety buildera — render publiczny               |     54 |      3 599 |  90,4% | 82,7% |   87,4% | **92,1%** |   693/793 |
| CMS: page builder (typ Elementor) — schemat i operacje |     11 |        649 |  85,4% | 64,9% |   96,6% | **92,9%** |   284/294 |
| CMS: sanityzacja HTML                                  |      4 |        157 |  93,9% | 88,1% |   90,6% | **97,5%** |     29/32 |
| CMS: warstwa content-model (rozdział bloki⇄builder)    |      7 |        150 |  93,5% | 82,9% |   96,9% | **98,7%** |     31/32 |

### MODUŁ 4 — Strony, wygląd, motyw, media, import · linie 92,26% · funkcje 88,89%

**Rodzaje testów:** komponentowy 31 · jednostkowy 25 · hooka 11 · warstwy danych 4 · funkcji serwerowej 1 · dostępności 1.

**Co tu decyduje:** połowa ryzyka to **czysta matematyka** (kadrowanie obrazu, tokeny motywu, kontrast etykiet) — tam test jednostkowy jest najtańszym dowodem o największym zasięgu; druga połowa to **testy hooków** panelu mediów (mutacje, zaznaczanie, skróty klawiszowe), gdzie liczy się kolejność zdarzeń i wycofanie po błędzie.

**Bez tego rodzaju przechodzi taki defekt:** kadr zapisuje się z zamienionymi osiami i wszystkie miniatury w archiwum są przycięte w złym miejscu. Dla plików już przetworzonych błąd jest nieodwracalny — nie ma z czego odtworzyć oryginalnego kadru.

| Funkcjonalność                  | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |      Linie | fn (szt.) |
| ------------------------------- | -----: | ---------: | -----: | ----: | ------: | ---------: | --------: |
| Ikony / marka                   |      7 |        149 |  79,6% | 72,6% |   73,0% |  **80,5%** |     27/37 |
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

### MODUŁ 7 — Typy treści specjalne · linie 44,18% · funkcje 37,90%

**Rodzaje testów:** komponentowy 22 · jednostkowy 25 · warstwy danych 4 · hooka 1 · funkcji serwerowej 3 · dymny 2.

**Co tu decyduje:** osiem różnych typów treści dzieli jeden wzorzec: reguły domenowe mają testy, a **funkcje serwerowe i loadery** nie. Rezerwacja miejsc na wydarzenie to przypadek skrajny — pgTAP dowodzi kolejki FIFO w bazie, ale to **test funkcji serwerowej** decyduje, czy aplikacja w ogóle zapyta o wolne miejsce.

**Bez tego rodzaju przechodzi taki defekt:** pgTAP dowodzi kolejki FIFO na miejscach, ale aplikacja nigdy nie pyta o wolne miejsce i sprzedaje 200 wejściówek na 150 miejsc. Baza jest w porządku; wydarzenie nie.

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

### MODUŁ 9 — Czat / komunikator · linie 62,16% · funkcje 57,74%

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
| LOGIN: formularze auth w CMS (bloki + widget) |      3 |        363 |  87,4% |  77,8% |   84,8% |  **90,4%** |     67/79 |
| Profil użytkownika                            |     33 |      1 344 |  88,6% |  84,8% |   80,2% |  **90,4%** |   380/474 |
| LOGIN: MFA (2FA)                              |      2 |         44 | 100,0% |  94,1% |   92,9% | **100,0%** |     13/14 |
| LOGIN: ochrona przed brute force              |      1 |         54 | 100,0% | 100,0% |  100,0% | **100,0%** |       9/9 |
| LOGIN: reset hasła                            |      1 |         52 |  96,8% |  85,5% |  100,0% | **100,0%** |     16/16 |

### MODUŁ 16 — Społeczność: kluby, komentarze, moderacja · linie 33,79% · funkcje 29,90%

**Rodzaje testów:** jednostkowy 57 · hooka 5 · komponentowy 9 · warstwy danych 1 · funkcji serwerowej 2 · bramki 2 · parytetu 1.

**Co tu decyduje:** reguły dostępu do klubu mają testy jednostkowe, a polityki — **19 plików pgTAP**. Brakującym rodzajem jest **test warstwy danych** (łańcuch PostgREST w `api.ts`) i **test hooka** dla stanu listy wątków: to one decydują, czy właściwy członek zobaczy właściwą treść, czego ani reguła, ani polityka bazy nie dowodzą same.

**Bez tego rodzaju przechodzi taki defekt:** zapytanie o wątki gubi filtr grupy. RLS przepuści, bo pytający jest członkiem klubu, więc członek grupy A zobaczy wątki grupy B. Polityka jest poprawna; zapytanie nie.

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

**Bez tego rodzaju przechodzi taki defekt:** wykres w raporcie zarządczym jest dla części odbiorców pustym prostokątem. Dane są poprawne co do liczby i niedostępne co do odczytu — a pokrycie warstwy semantycznej wynosi 100%.

| Funkcjonalność                          | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| --------------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Analityka: zbieranie zdarzeń i liczniki |     20 |        705 |  14,4% | 13,7% |   16,2% | **15,2%** |    25/154 |
| Wykresy i panel BI                      |     41 |      1 501 |  26,7% | 21,0% |   21,5% | **28,0%** |   110/512 |
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

### MODUŁ 19 — Ustawienia / integracje / users / multi-tenant / RODO · linie 27,50% · funkcje 22,65%

**Rodzaje testów:** jednostkowy 22 · warstwy danych 3 · komponentowy 2 · funkcji serwerowej 1 · parytetu 1 · bramki 1.

**Co tu decyduje:** tu rodzaj testu jest ważniejszy niż procent: **inwariant i parytet** (snapshot bramek autoryzacji kontra migracje, macierz uprawnień kontra rejestr capabilities) wykrywają zawężenie kręgu uprawnionych, którego żaden test jednostkowy pojedynczej funkcji nie zauważy, bo każda z nich osobno działa poprawnie.

**Bez tego rodzaju przechodzi taki defekt:** migracja zawęża krąg uprawnionych, a panel nadal oferuje akcję, którą baza odrzuci. To się w tym repo zdarzyło: `admin.users.$id` renderowało droplistę zmiany roli każdemu członkowi personelu, bo `/admin` przepuszcza też `editor` i `author` — każde jej użycie kończyło się `not_authorized`.

| Funkcjonalność                           | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ---------------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Użytkownicy i role (admin)               |      2 |        105 |   0,0% |  0,0% |    0,0% |  **0,0%** |      0/28 |
| Ustawienia serwisu (panele)              |      5 |        111 |  33,8% | 14,2% |   21,2% | **34,2%** |     11/52 |
| Zgody / cookie banner / GPC / RODO       |     28 |        460 |  49,7% | 44,0% |   42,4% | **52,4%** |    64/151 |
| Integracje zewnętrzne                    |      3 |        181 |  56,6% | 58,7% |   50,0% | **56,4%** |     17/34 |
| Autoryzacja / macierz uprawnień (authz)  |     23 |        207 |  82,4% | 75,5% |   73,9% | **82,6%** |     65/88 |
| Multi-tenant (izolacja tenanta w kodzie) |      6 |        281 |  88,5% | 83,3% |   84,1% | **90,4%** |     58/69 |
| Feature flags                            |      3 |        163 |  95,9% | 90,3% |   97,2% | **96,9%** |     35/36 |

### MODUŁ 20 — Platforma / backend / infrastruktura / SSR · linie 54,55% · funkcje 42,34%

**Rodzaje testów:** jednostkowy 101 · komponentowy 26 · funkcji serwerowej 15 · warstwy danych 2 · bramki 3 · parytetu 2.

**Co tu decyduje:** platforma utrzymuje **bramki (meta-inwarianty)**: „bramka, która istnieje, musi się uruchamiać”, parytet konfiguracji chunków, kontrakt zmiennych workflow. To rodzaj testu, który skaluje się z repozytorium, nie z liczbą przypadków — jeden taki test pilnuje wszystkich przyszłych plików.

**Bez tego rodzaju przechodzi taki defekt:** bramka istnieje w repozytorium i nie jest wpięta w workflow, więc zdanie „mamy to sprawdzone” jest fałszywe przez wiele miesięcy. Nikt tego nie zauważy, bo brak sygnału nie wygląda jak awaria — i to jest defekt, którego nie wykryje żaden test kodu produkcyjnego.

| Funkcjonalność                      | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ----------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Routing / trasy publiczne (powłoka) |      6 |        386 |   1,4% |  1,9% |    3,2% |  **1,6%** |      3/94 |
| Warstwa serwerowa (server fns)      |     19 |        980 |  20,3% | 17,7% |   17,7% | **20,5%** |    39/220 |
| Klient Supabase / zapytania         |     26 |        909 |  26,4% | 17,8% |   26,5% | **29,7%** |    70/264 |
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

Razem: **8 591 / 14 494 linii = 59,27%**, funkcje **2056/4600 = 44,70%**.

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

**CMS: design tokens / kolory globalne / typografia** — linie 87,2%, funkcje 35/40 (87,5%), plików 6 (bez pokrycia: 0), LOC 257

> Bez ani jednego wywołania: **5 funkcji** (1 nazwanych, 4 anonimowych domknięć). Nazwane:
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

**CMS: sanityzacja HTML** — linie 97,5%, funkcje 29/32 (90,6%), plików 4 (bez pokrycia: 0), LOC 157

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

Razem: **711 / 977 linii = 72,77%**, funkcje **165/265 = 62,26%**.

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

**LOGIN: formularze auth w CMS (bloki + widget)** — linie 90,4%, funkcje 67/79 (84,8%), plików 3 (bez pokrycia: 0), LOC 363

> Bez ani jednego wywołania: **12 funkcji** (0 nazwanych, 12 anonimowych domknięć).

**LOGIN: MFA (2FA)** — linie 100,0%, funkcje 13/14 (92,9%), plików 2 (bez pokrycia: 0), LOC 44

> Bez ani jednego wywołania: **1 funkcji** (0 nazwanych, 1 anonimowych domknięć).

**LOGIN: ochrona przed brute force** — linie 100,0%, funkcje 9/9 (100,0%), plików 1 (bez pokrycia: 0), LOC 54

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

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

Łącznie plików produkcyjnych z pokryciem **0%: 726** z 2 703 (26,86%).

### 5.2 Katalogi bez ANI JEDNEGO pliku testowego

Sygnał niezależny od pokrycia: katalog może mieć pokrycie z testu innego katalogu, ale nie ma
testu WŁASNEGO — czyli nikt nie testuje go wprost. Takich katalogów jest **74**,
obejmują **109 plików / 29 231 linii**.

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
**1 próg globalny + 208 progów per-ścieżka** w `vitest.config.ts`, egzekwowanych w CI krokiem
`Test + coverage gate` (`.github/workflows/ci.yml`).

| Moduł                                 | Progów per-ścieżka | Mediana progu linii | Najwyższy próg linii |
| ------------------------------------- | -----------------: | ------------------: | -------------------: |
| M11                                   |                 65 |                  98 |                  100 |
| M1                                    |                 26 |                 100 |                  100 |
| M2                                    |                 21 |                 100 |                  100 |
| M13                                   |                 18 |                 100 |                  100 |
| M15                                   |                 15 |                 100 |                  100 |
| M3                                    |                 11 |                  99 |                  100 |
| M20                                   |                 11 |                 100 |                  100 |
| M9                                    |                  9 |                  96 |                  100 |
| M17                                   |                  8 |                 100 |                  100 |
| M19                                   |                  8 |                 100 |                  100 |
| M6                                    |                  8 |                 100 |                  100 |
| M8                                    |                  2 |                 100 |                  100 |
| powłoka panelu admin + atomy/molekuły |                  2 |                 100 |                  100 |
| M10                                   |                  2 |                  98 |                   98 |
| M18                                   |                  1 |                  98 |                   98 |
| M7                                    |                  1 |                 100 |                  100 |

Z tego **41 progów obejmuje CAŁE POWIERZCHNIE** (wzorzec `/**`), a nie pojedyncze pliki —
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

**Czego bramka NIE pilnuje** — moduły bez ani jednego progu per-ścieżka:

- **MODUŁ 4 — Strony, wygląd, motyw, media, import**: linie 92,26%, funkcje 88,89%, plików 0%: 6/132
- **MODUŁ 5 — Strona główna, archiwa, chrome**: linie 96,15%, funkcje 93,15%, plików 0%: 1/54
- **MODUŁ 12 — Realtime / powiadomienia / web-push**: linie 47,98%, funkcje 43,97%, plików 0%: 13/28
- **MODUŁ 14 — Monetyzacja: kupony / darowizny / prezenty / reklamy**: linie 26,16%, funkcje 17,47%, plików 0%: 16/38
- **MODUŁ 16 — Społeczność: kluby, komentarze, moderacja**: linie 33,79%, funkcje 29,90%, plików 0%: 154/252
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
| Jednostkowe / komponentowe (vitest)          | 1 237 plików, 19 629 testów, 38 777 asercji | logikę w TS/TSX, render komponentów, kontrakty modułów                       | zachowania bazy (RLS/RPC/triggery), realnych ścieżek przeglądarki, SSR end-to-end |
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
| komponentowy (render + interakcja)         |    426 |  7 689 |  15 073 |     1,96 | że użytkownik to zobaczy: treść, stan wyłączony, komunikat błędu, reakcja na kliknięcie       | zachowania na prawdziwej przeglądarce i prawdziwych danych z bazy        |
| jednostkowy (czysta reguła)                |    585 |  7 562 |  15 137 |     2,00 | reguły w izolacji: wejście → wyjście, przypadki graniczne, gałęzie warunków                   | że reguła jest w ogóle wywołana przez aplikację (poprawnego okablowania) |
| warstwy danych (atrapa PostgREST)          |     46 |  1 462 |   2 664 |     1,82 | kształtu zapytania: filtry, kolejność ogniw, limit, zachowanie przy błędzie PostgREST         | że polityka RLS na serwerze przepuści to zapytanie                       |
| hooka (renderHook)                         |     63 |  1 402 |   2 736 |     1,95 | cyklu życia i unieważniania cache: kolejność efektów, sprzątanie, ponowne pobranie po mutacji | wyglądu; hook może być poprawny, a widok nadal pokazywać stare dane      |
| funkcji serwerowej                         |     65 |  1 151 |   2 449 |     2,13 | bramek wykonania: tenant, uprawnienia, rate limit, audyt, ścieżka błędu                       | że klient wywoła funkcję w odpowiednim momencie                          |
| parytetu (dwa artefakty muszą się zgadzać) |     18 |    125 |     264 |     2,11 | ZGODNOŚCI DWÓCH ARTEFAKTÓW (panel ⇄ renderer, snapshot ⇄ migracje, PL ⇄ EN)                   | poprawności żadnej ze stron osobno — tylko tego, że się nie rozjechały   |
| bramki (meta-inwariant CI)                 |     16 |    107 |     178 |     1,66 | meta-inwariantu repo: że bramka istnieje, jest wpięta i coś sprawdza                          | zachowania kodu produkcyjnego                                            |
| dostępności (axe)                          |     10 |     77 |     163 |     2,12 | kontraktu dostępności: role, etykiety, kolejność fokusu, brak naruszeń axe                    | sensu treści dla czytnika ekranu (to ocenia człowiek)                    |
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

---

## 8. Wnioski: gdzie ryzyko jest największe

Ryzyko liczę jako BEZWZGLĘDNĄ liczbę niepokrytych linii, nie procent — 20% na module o 50 tys.
linii to większa dziura niż 20% na module o 5 tys.

| #   | Moduł                                                 | Linii niepokrytych | Linie % | Funkcje % | Testów |
| --- | ----------------------------------------------------- | -----------------: | ------: | --------: | -----: |
| 3   | Silniki treści: bloki + page builder                  |         **10 173** |  52,34% |    38,73% |  2 370 |
| 16  | Społeczność: kluby, komentarze, moderacja             |          **5 188** |  33,79% |    29,90% |  1 254 |
| 20  | Platforma / backend / infrastruktura / SSR            |          **3 897** |  54,55% |    42,34% |  2 208 |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |          **3 130** |  27,50% |    22,65% |    481 |
| 7   | Typy treści specjalne                                 |          **2 557** |  44,18% |    37,90% |  1 112 |
| 17  | Analityka i BI                                        |          **2 152** |  29,93% |    24,52% |    199 |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |          **1 728** |  66,32% |    76,36% |  1 562 |
| 15  | Profil i konto                                        |          **1 520** |  56,03% |    51,95% |    716 |
| 9   | Czat / komunikator                                    |          **1 231** |  62,16% |    57,74% |    607 |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |          **1 022** |  26,16% |    17,47% |     88 |

### 8.1 Rekomendacje — kolejność, nie lista życzeń

**R1. Podnieść PRÓG GLOBALNY — stoi 23 pp pod pomiarem, a suita jest po raz pierwszy w całości zielona.**
Progi globalne w `vitest.config.ts` to `statements 33 / functions 25 / lines 33 / branches 28`.
Pomiar tego przebiegu: **56,57 / 50,76 / 57,42 / 50,43**. Różnica ~23 pp to zakres, w którym pokrycie
może się osunąć przy zielonym CI — czyli można dziś skasować dwie piąte dorobku testowego i żadna
bramka nie krzyknie. Do tej pory istniało uzasadnienie „progi per-ścieżka i tak padają, nie ma po co”;
ono zniknęło: ten przebieg wyszedł kodem **0**, więc próg globalny i wszystkie **208** progów
per-ścieżka przechodzą. Wpisać 55 / 49 / 56 / 49 (1–2 pp pod pomiarem) i przy okazji zaktualizować
komentarz, który nadal dokumentuje pomiar zespołu **37,19 / 32,41 / 29,13 / 37,78** — nieaktualny
o ~19 pp, a to jest liczba, po którą sięga każdy czytający config i każdy prompt modułowy.

**R2. `lib/billing/queries.ts` — gałęzie 80,55% to jedyny dług, jaki zapisał po sobie re-floor.**
Cztery progi w `billing` zostały obniżone do wartości zmierzonych i to była właściwa decyzja
(mechanizm w rozdziale 6.1: aspiracyjny próg wyłączył krok CI i osiem bramek za nim). Ale commit
naprawiający zapisał wprost, że droga powrotna prowadzi WYŁĄCZNIE przez testy i że kolejne obniżenie
„to już nie re-floor, tylko gaszenie sygnału”. Ten audyt się z tym zgadza i wskazuje adres: gałęzie
`queries.ts` na **80,55%** przy pozostałych trzech plikach powyżej 91%. To jedno miejsce, w którym
próg per-ścieżka opisuje dziurę, nie sufit.

**R3. MODUŁ 3 (bloki + page builder) — 10 173 niepokrytych linii, największa BEZWZGLĘDNA dziura systemu.**
52,34% linii przy **38,73% funkcji** i 120 z 453 plików na zerze. Rozjazd linie ⇄ funkcje o 14 pp jest
tu sygnaturą, nie szumem: testy renderują komplet widgetów, ale nie wchodzą w gałęzie ustawień. Panele
właściwości mają własny próg (27/16/28/26), świadomie wpisany „tuż nad zmierzonym”, z komentarzem
nazywającym następny krok — wyprowadzenie warstwy dostępu do wartości pól ze `WidgetProperties.tsx`.
Dopóki to nie powstanie, moduł 3 pozostaje najdroższą pozycją w tym dokumencie.

**R4. MODUŁ 16 (kluby, komentarze, moderacja) — 154 z 252 plików na zerze, drugi dług: 5 188 linii.**
Przez 33 commity nie ruszył się o ani jedną dziesiątą punktu (0,0 pp). Reguły domenowe są zrobione
(`lib/clubs/**`: 51 plików testowych na 69 źródłowych, `api.ts` na 100%), więc cały dług siedzi
w prezentacji: trasy publiczne klubu **0 z 261 funkcji**, UI 8,4%, panel admina 8,6%. Rodzaj testu,
który tu decyduje, to test warstwy danych i test trasy — a `renderRoute()` z `src/test/routeHarness.tsx`
jest w repo i obsługuje 32 testy tras, z czego **ani jeden nie dotyczy klubów**.

**R5. MODUŁ 14 (kupony / darowizny / prezenty / reklamy) — 26,16% linii i 17,47% funkcji, najniższy wymiar funkcyjny w repo.**
Stoi w miejscu we wszystkich trzech wydaniach (0,0 pp wobec wydania 2, +3,6 pp wobec wydania 1).
Darowizna i kupon to transakcja: kwota, waluta, limit wykorzystań — a 16 z 38 plików nie wykonuje ani
jednej linii. Moduł jest MAŁY, więc jest to najtańsze domknięcie z całej listy: 1 022 niepokryte linie
wobec 10 173 w module 3. Zaraz za nim MODUŁ 19 (27,50%, +1,6 pp dzięki testom retencji) i MODUŁ 17
(29,93%, 49 z 85 plików na zerze) — z tą różnicą, że w 19 defekt jest zdarzeniem prawnym.

**R6. Pilnować DYLUCJI — trzy moduły spadły nie przez regresję testów, a przez nowy kod bez testów.**
MODUŁ 2 −0,2 pp, MODUŁ 13 −0,1 pp, MODUŁ 3 −0,0 pp. Przypadek modułu 2 jest pouczający: dostał nowy
plik testowy ORAZ cztery nowe pliki produkcyjne (ściągawka zero-click: `ZeroClickCheatSheet`,
`ZeroClickChecklist`, `ZeroClickSection`, `zeroClickMessages`) i wynik netto wyszedł ujemny.
To nie jest defekt — to normalna cena rozwoju. Defektem byłoby tego nie widzieć. Wykrywa to wyłącznie
próg obejmujący CAŁĄ POWIERZCHNIĘ (wzorzec `/**`), bo próg per plik nie wie o pliku, który dopiero
powstał. Cztery powierzchnie zasługują dziś na taki próg, bo praca na nich jest skończona i wysoka:
`lib/crm/**` (98,98%), `components/admin/post-editor/**` (99,22%), `components/search/**` (97,38%),
`lib/menus/**` (96,15%).

**R7. Nie mylić wysokiego procentu z dowodem — rozdział 7.1 podaje, jak to rozpoznać.**
Wzorcowy przykład jest w tym pomiarze: słowniki i18n mają **92,49% linii przy 55,03% funkcji** —
wysoka liczba jest artefaktem zaimportowania obiektu, a nie dowodem czegokolwiek. Wskaźnik do czytania
obok procentu: **asercje na test** — dziś 38 777 asercji na 19 629 statycznie policzonych przypadków
(**1,98**), stabilnie na każdym rodzaju testu. Spadek poniżej 1,5 przy rosnącym procencie znaczyłby
powrót warstwy renderującej bez asercji, którą to repo raz już usunęło (i którą pokazywało jako „98%”).

**R8. Sortować dalszą pracę po WYMIARZE FUNKCYJNYM, nie po liniach — tam siedzi reszta ryzyka.**
Cztery powierzchnie mają linie wyraźnie wyżej niż funkcje: MODUŁ 3 (52,34% ⇄ 38,73%), MODUŁ 20
(54,55% ⇄ 42,34%), MODUŁ 12 (47,98% ⇄ 43,97%) i słowniki (92,49% ⇄ 55,03%). Wymiar funkcyjny liczy
KAŻDĄ funkcję, w tym każdy handler i callback, i odpowiada na pytanie „ile zachowań tego modułu ktoś
kiedykolwiek uruchomił”. Przy planowaniu kolejnych podejść to on, a nie procent linii, mówi, ile
naprawdę zostało do zrobienia.

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
| 3   | Silniki treści: bloki + page builder                  |   454 |      110 601 |           210 |     35 977 |
| 4   | Strony, wygląd, motyw, media, import                  |   133 |       16 859 |            73 |     15 393 |
| 5   | Strona główna, archiwa, chrome                        |    54 |        9 721 |            27 |      7 801 |
| 6   | Wyszukiwarka                                          |    24 |        4 662 |            21 |      6 119 |
| 7   | Typy treści specjalne                                 |   115 |       25 433 |            57 |     13 187 |
| 8   | SEO, feedy, dane strukturalne                         |    74 |       10 670 |            39 |      4 166 |
| 9   | Czat / komunikator                                    |    81 |       15 602 |            36 |      9 164 |
| 10  | Sieć / networking                                     |    32 |        5 162 |            23 |      5 298 |
| 11  | Newsletter i e-mail                                   |   147 |       28 636 |            88 |     26 865 |
| 12  | Realtime / powiadomienia / web-push                   |    28 |        5 374 |            13 |      1 672 |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |   185 |       26 394 |            91 |     23 996 |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |    38 |        7 786 |            11 |      1 402 |
| 15  | Profil i konto                                        |    81 |       18 003 |            38 |     11 309 |
| 16  | Społeczność: kluby, komentarze, moderacja             |   252 |       52 772 |            77 |     17 295 |
| 17  | Analityka i BI                                        |    85 |       16 520 |            19 |      2 229 |
| 18  | CRM                                                   |    57 |       16 062 |            32 |     10 336 |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |   130 |       23 800 |            30 |      5 636 |
| 20  | Platforma / backend / infrastruktura / SSR            |   185 |       58 118 |           149 |     33 062 |
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
bun run test:coverage          # próg globalny + 208 progów per-ścieżka
```

Od wdrożenia R1 z wydania 1 (`coverage.reportOnFailure: true` w configu) raport i progi powstają
TAKŻE na czerwonej suicie, więc powyższe jedno polecenie wystarcza — obejście z wydania 1 nie jest
już potrzebne. Pełny przebieg na tym HEAD: 9 min 10 s, 1 237 plików testowych, 22 052 testów
(1 235 plików / 22 002 testy przeszły, 2 pliki / 50 testów pominięte z braku sekretów Supabase).

Agregacja per moduł / funkcja / funkcjonalność powstała z `coverage/coverage-final.json`
(mapy `statementMap`/`fnMap`/`branchMap` + liczniki `s`/`f`/`b`) oraz `coverage-summary.json`:
moduł = suma po plikach pasujących do reguł z 9.1, funkcjonalność = suma po wzorcach ścieżek,
„funkcja bez wywołania” = wpis `fnMap`, którego licznik `f` wynosi zero.
