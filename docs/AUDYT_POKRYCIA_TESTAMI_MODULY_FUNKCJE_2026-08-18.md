# Audyt pokrycia testami: moduł po module, funkcja po funkcji (2026-08-29)

**Wydanie 6 pomiaru — pierwsze z NOWYM MODUŁEM.** Rodowód: wydanie 1 (2026-08-18) musiało
wykluczyć 39 plików testowych wiszących w kolekcji; wydanie 2 (19.08) było pierwszym KOMPLETNYM
pomiarem; wydanie 3 (19.08) pierwszym w całości zielonym; wydanie 4 (21.08) zmierzyło skutek
domknięcia CMS buildera i klubów; wydanie 5 (22.08) — modułów 19 i 20.
To wydanie mierzy HEAD `f16c43c06` — **1 093 commity** za wydaniem 5, i jest inne od wszystkich
poprzednich: do repozytorium doszedł **MODUŁ 22 — Wydarzenia (Event Builder)**, największa
pojedyncza dostawa w historii tego audytu. Liczby policzone przeze mnie w repozytorium,
nie przepisane ze specyfikacji: **362 pliki produkcyjne, 3 935 funkcji, 70 tras, 41 tabel
`event_*` (plus `events`), 212 funkcji SQL `event_*`/`admin_event_*` w wygenerowanych typach,
38 tras studia** — plus własna szósta warstwa dowodu (uprząż replayu migracji, rozdz. 7).

Skala zmiany w liczbach pomiaru: plików produkcyjnych 2 820 → **3 201**, mierzonych linii
94 008 → **104 563** (+11,2%), funkcji 29 880 → **33 844**,
plików testowych 1 551 → **1 763**, progów per-ścieżka 334 → **353**.

**Najważniejsza liczba tego wydania to liczba, która się NIE zmieniła.** Repozytorium urosło
o 11,2% mierzonego kodu, a pokrycie globalne stoi w miejscu: linie 75,10% → **74,94%**,
funkcje 72,19% → **71,54%**, gałęzie 68,68% → **69,20%**.
Nowy moduł wszedł z pokryciem **58,96% linii** — wyższym niż start CMS buildera (24%), klubów
(25,8%) czy ustawień (25,2%) — więc rozcieńczył całość tylko o ułamek punktu. To jest wynik pracy
testowej prowadzonej RÓWNOLEGLE z budową modułu, a nie po niej, i jest w tym dokumencie
pierwszym takim przypadkiem.

Plik pozostaje pod tą samą nazwą, bo odwołuje się do niego komentarz przy progu globalnym
w `vitest.config.ts` oraz prompty modułowe. Zmiana mapy modułów (wydzielenie 22 z 07 i 16)
jest ujawniona w 9.1, a delty w 2.1 liczę na wydaniu 5 PRZELICZONYM nową mapą — inaczej
mierzyłbym zmianę mapy, a nie zmianę pokrycia.

Zlecenie: **„ile % pokrycia testami ma każdy moduł, jego funkcje oraz funkcjonalności”**.
Dokument podaje ZMIERZONE liczby (nie oceny), z jawną metodologią i jawnymi ograniczeniami
pomiaru. Taksonomia modułów pochodzi z `docs/OCENA_FUNKCJI_TABELE_2026-08-14.md` i do wydania 5
była z nią zgodna co do jednego modułu. To wydanie dokłada **MODUŁ 22 (wydarzenia)**, którego
tamten dokument nie zna, bo powstał przed dostawą — pozostałe 21 modułów podłożysz pod tamte
tabele ocen bez zmian.

---

## 0. Jak to zmierzono (i czego te liczby NIE znaczą)

| Element pomiaru                    | Wartość                                                                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Narzędzie                          | `vitest run --coverage` (provider `v8`), konfiguracja repo bez zmian                                                                                                                                    |
| Zakres mierzony                    | całe `src/**/*.{ts,tsx}` (`all: true`) — pliki bez testów WCHODZĄ do mianownika                                                                                                                         |
| Wykluczenia (z `vitest.config.ts`) | `__tests__`, `*.test.*`, artefakty generowane (`routeTree.gen.ts`, `supabase/types.ts`, `lucideIconNodes.generated.ts`), `src/test/**`, `lazyWidgets.tsx`                                               |
| Plików produkcyjnych w mianowniku  | 3 201                                                                                                                                                                                                   |
| Plików testowych zmierzonych       | 1 763 z 1 763 (100,0%)                                                                                                                                                                                  |
| Przypadków testowych wykonanych    | 46 409 (statyczny licznik `it/test` w plikach: 34 927; różnica to rozwinięcia `it.each`)                                                                                                                |
| Testy poza pomiarem                | brak — żaden plik nie został wykluczony z przebiegu                                                                                                                                                     |
| Testy czerwone w tym przebiegu     | 12 (rozdział 8.1)                                                                                                                                                                                       |
| Testy „expected fail”              | 183 przypadków z 171 wywołań `it.fails(` w 94 plikach — zapisane defekty produkcyjne, nie awarie (rozdział 7.2)                                                                                         |
| Testy pominięte                    | 2 pliki / 50 testów — wymagają danych dostępowych do Supabase, których sandboks nie ma (rozdział 9.2)                                                                                                   |
| Wynik bramki pokrycia              | przebieg zakończony kodem **1**: próg globalny PRZESZEDŁ z zapasem ~10 pp, ale DWIE grupy progów per-ścieżka z 353 nie — `src/components/admin/billing/**` i `src/components/profile/**` (rozdział 6.1) |
| Data pomiaru                       | 2026-08-29, HEAD `f16c43c06`                                                                                                                                                                            |

**Cztery zastrzeżenia, bez których te procenty można źle odczytać:**

1. **Pokrycie ≠ poprawność.** Instrukcja „pokryta” to instrukcja, która się WYKONAŁA w trakcie
   testu — nie taka, której wynik ktoś sprawdził asercją. Dlatego obok pokrycia podaję gęstość
   asercji (kolumna „asercje”) — moduł z wysokim pokryciem i niską liczbą asercji to render bez dowodu.
2. **Pokrycie jednostkowe to nie całe pokrycie systemu.** Warstwa danych (RLS, RPC, triggery) jest
   testowana w pgTAP (99 plików, 1 845 asercji), a ścieżki użytkownika w Playwright
   (8 plików, 62 testów). Tych warstw v8 nie widzi — moduł z niskim %
   jednostkowym może mieć realną zaporę w bazie (rozdział 7).
3. **Mapowanie plik → moduł jest MOJE, nie repo.** Repo nie ma manifestu modułów; przypisanie
   3 201 plików do 22 modułów zrobiłem regułami po ścieżkach (rozdział 9.1). Pliki graniczne
   (np. `gifting` — „podaruj artykuł” jest funkcją MODUŁU 1, a kod leży w powierzchni MODUŁU 14)
   zaznaczam w tabelach.
4. **Pomiar jest KOMPLETNY, ale suita NIE jest zielona — i po raz pierwszy w tej serii winna jest
   REGRESJA, a nie dryf.**
   Ten przebieg: **1 760 plików / 46 164 testów przeszło, 12 padło w trzech plikach**, a bramka
   pokrycia wyszła kodem 1 również z powodu ośmiu naruszeń progów w dwóch grupach ścieżek.
   Rozkład czerwieni jest jednoznaczny: **dziesięć z dwunastu czerwonych testów to jeden plik**,
   `routes/__tests__/profileShellRoutes.test.tsx`, i wszystkie mówią to samo —
   `Found multiple elements with the text of: profile.sidebar.collapse`. Szuflada profilu
   renderuje się DWA RAZY. Weszło to serią commitów nazwanych „Changes” i „Work in progress”
   (jeden nosi tytuł „Przeniesiono szufladę profilu”), a próg `src/components/profile/**`
   — postawiony w wydaniu 5, kiedy moduł 15 dochodził do „wzorowo” — złapał to jako
   regresję: linie 91,58% wobec progu 93. **Bramka zadziałała dokładnie tak, jak miała.**
   Pozostałe dwa czerwone to `authzSnapshotParity` (ten sam rozjazd prowieniencji co
   w wydaniu 5, tylko większy: snapshot pochodzi ze starszego skanu migracji, a repo ma 917) i `quizLanding` (kontrakt JSON-LD landingu). Do tego 183 przypadków „expected fail” —
   to NIE awarie, a zapisane defekty produkcyjne (rozdział 7.2).
   Poza pomiarem zostały 2 pliki (50 testów) pomijające się SAME z braku sekretów Supabase.

---

## 1. Wynik globalny: całe `src/`

| Metryka    | Pokryte / wszystkich |          % |
| ---------- | -------------------: | ---------: |
| Instrukcje |     88 362 / 119 548 | **73,91%** |
| Gałęzie    |     75 572 / 109 205 | **69,20%** |
| Funkcje    |      24 212 / 33 844 | **71,54%** |
| Linie      |     78 367 / 104 563 | **74,94%** |

Próg globalny w `vitest.config.ts` (ratchet, wolno tylko podnosić): **64% instrukcji /
58% gałęzi / 62% funkcji / 65% linii**. Zmierzony margines nad progiem:
instrukcje 9,91 pp, gałęzie 11,20 pp,
funkcje 9,54 pp, linie 9,94 pp.

**Kontrola wiarygodności pomiaru.** Komentarz przy progu w `vitest.config.ts` dokumentuje ostatni
pomiar zespołu: 68,27% instrukcji / 62,80% gałęzi /
66,25% funkcji / 69,28% linii.
Ten audyt, niezależnym przebiegiem: 73,91% / 69,20% / 71,54% / 74,94%.
Rozjazd wynosi ~5,7 pp na liniach i tym razem jest po stronie KOMENTARZA, nie pomiaru:
wpis w configu pochodzi sprzed dostawy modułu wydarzeń i sprzed pracy nad newsletterem,
a moje liczby są po nich. To nie jest zarzut — to jest tempo, którego komentarz
w pliku konfiguracyjnym nie nadgoni. Warto natomiast dopisać wpis po tej dostawie, bo
różnica 5,7 pp jest już na granicy tego, przy której komentarz zaczyna wprowadzać w błąd.

**Zapadka globalna PIERWSZY RAZ NIE DRGNĘŁA — i to jest pozycja do rekomendacji.** Wydanie 3
zgłaszało progi `33/25/33/28` stojące ~23 pp pod pomiarem; wydanie 4 zmierzyło `58/54/58/52`,
wydanie 5 podniosło do `64/58/62/65` (instrukcje/gałęzie/funkcje/linie). Dziś config ma
**dokładnie te same wartości**, a pomiar stoi ~10 pp wyżej. Progi per-ścieżka rosły dalej
(334 → **353**, w tym sześć nowych na ścieżkach wydarzeń), więc nawyk nie zniknął —
cofnął się tylko na poziomie globalnym. Przy dostawie tej wielkości to zrozumiałe (nikt nie
chce zaryglować progu w tygodniu, w którym dochodzi 11% kodu), ale zostawione tak na dłużej
oznacza, że **globalna zapadka przestaje cokolwiek łapać**: żeby ją przekroczyć w dół,
repozytorium musiałoby stracić jedną trzecią dzisiejszego pokrycia.

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
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |          39 |     26,95% |  30,68% |  18,42% | **27,06%** |        13 | 0,282 |     91 |     263 |
| 17  | Analityka i BI                                        |          86 |     32,13% |  25,08% |  28,41% | **32,88%** |        47 | 0,221 |    199 |     442 |
| 7   | Typy treści specjalne                                 |          95 |     44,18% |  40,43% |  36,73% | **43,93%** |        37 | 0,484 |    934 |   1 501 |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    |         183 |     46,48% |  40,06% |  42,29% | **47,87%** |        33 | 0,224 |    659 |   1 503 |
| 12  | Realtime / powiadomienia / web-push                   |          28 |     46,71% |  31,59% |  47,46% | **49,54%** |        12 | 0,500 |     99 |     233 |
| 21  | Rekrutacja / kariera                                  |          29 |     54,96% |  53,52% |  47,13% | **55,12%** |        12 | 0,379 |    171 |     374 |
| 22  | Wydarzenia: event builder, rejestracja, onsite        |         362 |     58,13% |  57,44% |  55,25% | **58,96%** |       144 | 0,417 |  2 907 |   6 343 |
| 9   | Czat / komunikator                                    |          81 |     61,33% |  51,74% |  58,02% | **62,83%** |        14 | 0,444 |    607 |   1 123 |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |         190 |     64,30% |  59,44% |  75,58% | **65,62%** |        35 | 0,495 |  1 605 |   3 323 |
| 20  | Platforma / backend / infrastruktura / SSR            |         199 |     73,67% |  63,92% |  67,44% | **74,73%** |        47 | 1,050 |  4 489 |   9 715 |
| 3   | Silniki treści: bloki + page builder                  |         458 |     75,23% |  73,46% |  71,70% | **76,40%** |        67 | 0,617 |  4 962 |   9 051 |
| —   | PRZEKROJOWE: design system (components/ui)            |          43 |     77,79% |  64,71% |  71,49% | **79,89%** |         4 | 0,047 |     17 |      37 |
| 10  | Sieć / networking                                     |          32 |     78,38% |  67,98% |  80,86% | **81,98%** |         3 | 0,719 |    349 |     642 |
| 1   | Wpisy: doświadczenie czytelnika                       |         104 |     82,60% |  74,99% |  81,98% | **84,35%** |        13 | 0,548 |  1 013 |   2 125 |
| 16  | Społeczność: kluby, komentarze, moderacja             |         306 |     88,68% |  87,27% |  89,02% | **89,12%** |        16 | 0,634 |  4 715 |   9 534 |
| 4   | Strony, wygląd, motyw, media, import                  |         133 |     90,95% |  82,23% |  88,89% | **92,32%** |         4 | 0,552 |  1 245 |   2 154 |
| —   | PRZEKROJOWE: słowniki i18n                            |         134 |     89,25% |  66,90% |  59,24% | **93,14%** |         1 | 0,045 |     60 |     141 |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |         131 |     92,19% |  88,78% |  89,91% | **93,18%** |        14 | 0,389 |  1 333 |   2 575 |
| 5   | Strona główna, archiwa, chrome                        |          62 |     94,68% |  82,86% |  93,49% | **96,47%** |         1 | 0,468 |    560 |     945 |
| 8   | SEO, feedy, dane strukturalne                         |          77 |     96,24% |  93,22% |  95,64% | **96,65%** |         5 | 0,883 |  1 256 |   2 825 |
| 6   | Wyszukiwarka                                          |          25 |     96,66% |  89,91% |  95,24% | **97,38%** |         0 | 0,840 |    528 |     839 |
| 15  | Profil i konto                                        |          94 |     96,53% |  93,75% |  94,44% | **97,50%** |         2 | 0,766 |  2 009 |   4 090 |
| 18  | CRM                                                   |          59 |     98,10% |  86,24% |  98,60% | **99,03%** |         0 | 0,559 |    703 |   1 231 |
| 2   | Edytor wpisów i workflow redakcyjny                   |         103 |     98,85% |  94,71% |  98,85% | **99,35%** |         0 | 0,854 |  1 576 |   2 928 |
| 11  | Newsletter i e-mail                                   |         148 |     98,89% |  95,06% |  99,43% | **99,53%** |         0 | 0,797 |  2 778 |   5 931 |

### 2.1 Zmiana od wydania 5 — dostawa modułu wydarzeń i domknięcie newslettera

Poprzedni pomiar (wydanie 5, 2026-08-22, HEAD `73afc850b`) obejmował 1 551 plików
testowych i 2 820 plików produkcyjnych. Ten obejmuje 1 763 i 3 201.

**Kolumny „wyd. 5” są PRZELICZONE mapą tego wydania, nie przepisane z tamtego dokumentu.**
Wydzielenie modułu 22 zabrało pliki modułowi 7 (trasy i biblioteka wydarzeń) i modułowi 16
(stara powierzchnia „community events”, prelegenci, identyfikatory). Gdybym porównał liczby
opublikowane, MODUŁ 7 wyglądałby na spadek o 1,25 pp, a MODUŁ 16 na wzrost o 3,02 pp — i obie
te liczby byłyby delta MAPY, nie delta pracy. Po przeliczeniu tego samego przebiegu wydania 5
nową mapą: MODUŁ 7 stoi w miejscu (43,56% → 43,59%), a MODUŁ 16 też stoi (88,96% → 88,92%)
zamiast rosnąć o trzy punkty. Reguła i pełne ujawnienie: rozdział 9.1.

Kolumna Δ to różnica w punktach procentowych wobec wydania 5 (przeliczonego); ostatnia kolumna to
różnica KUMULACYJNA wobec wydania 1 (2026-08-18). Strzałka ↑ znaczy, że modułem ktoś się zajął.

| #   | Moduł                                                 | Linie wyd. 5 | Linie teraz |    Δ linie | Funkcje wyd. 5 | Funkcje teraz |  Δ funkcje | Δ linie od wyd. 1 |
| --- | ----------------------------------------------------- | -----------: | ----------: | ---------: | -------------: | ------------: | ---------: | ----------------: |
| 22  | Wydarzenia: event builder, rejestracja, onsite        |       35,05% |  **58,96%** | ↑ +23,9 pp |         31,70% |    **55,25%** | ↑ +23,5 pp |                 — |
| 11  | Newsletter i e-mail                                   |       81,55% |  **99,53%** | ↑ +18,0 pp |         82,73% |    **99,43%** | ↑ +16,7 pp |        ↑ +72,8 pp |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    |       41,21% |  **47,87%** |  ↑ +6,7 pp |         38,11% |    **42,29%** |  ↑ +4,2 pp |        ↑ +23,4 pp |
| 1   | Wpisy: doświadczenie czytelnika                       |       81,73% |  **84,35%** |  ↑ +2,6 pp |         79,08% |    **81,98%** |  ↑ +2,9 pp |        ↑ +52,5 pp |
| 12  | Realtime / powiadomienia / web-push                   |       48,41% |  **49,54%** |  ↑ +1,1 pp |         44,50% |    **47,46%** |  ↑ +3,0 pp |         ↑ +5,4 pp |
| —   | PRZEKROJOWE: słowniki i18n                            |       92,53% |  **93,14%** |  ↑ +0,6 pp |         55,62% |    **59,24%** |  ↑ +3,6 pp |         ↑ +1,4 pp |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |       26,50% |  **27,06%** |  ↑ +0,6 pp |         17,83% |    **18,42%** |  ↑ +0,6 pp |         ↑ +4,5 pp |
| 9   | Czat / komunikator                                    |       62,28% |  **62,83%** |  ↑ +0,6 pp |         57,74% |    **58,02%** |  ↑ +0,3 pp |         ↑ +0,9 pp |
| 3   | Silniki treści: bloki + page builder                  |       75,99% |  **76,40%** |  ↑ +0,4 pp |         71,33% |    **71,70%** |  ↑ +0,4 pp |        ↑ +36,4 pp |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |       93,08% |  **93,18%** |  ↑ +0,1 pp |         89,80% |    **89,91%** |  ↑ +0,1 pp |        ↑ +71,2 pp |
| 15  | Profil i konto                                        |       97,42% |  **97,50%** |  ↑ +0,1 pp |         94,48% |    **94,44%** |     0,0 pp |        ↑ +78,4 pp |
| 7   | Typy treści specjalne                                 |       43,90% |  **43,93%** |     0,0 pp |         36,73% |    **36,73%** |     0,0 pp |        ↑ +27,5 pp |
| 8   | SEO, feedy, dane strukturalne                         |       96,64% |  **96,65%** |     0,0 pp |         95,62% |    **95,64%** |     0,0 pp |        ↑ +46,3 pp |
| 18  | CRM                                                   |       99,02% |  **99,03%** |     0,0 pp |         98,58% |    **98,60%** |     0,0 pp |        ↑ +87,0 pp |
| 6   | Wyszukiwarka                                          |       97,38% |  **97,38%** |     0,0 pp |         95,22% |    **95,24%** |     0,0 pp |        ↑ +64,2 pp |
| 4   | Strony, wygląd, motyw, media, import                  |       92,32% |  **92,32%** |     0,0 pp |         88,89% |    **88,89%** |     0,0 pp |        ↑ +69,6 pp |
| 5   | Strona główna, archiwa, chrome                        |       96,47% |  **96,47%** |     0,0 pp |         93,49% |    **93,49%** |     0,0 pp |        ↑ +79,8 pp |
| 10  | Sieć / networking                                     |       81,98% |  **81,98%** |     0,0 pp |         80,86% |    **80,86%** |     0,0 pp |         ↑ +0,3 pp |
| 17  | Analityka i BI                                        |       32,88% |  **32,88%** |     0,0 pp |         28,41% |    **28,41%** |     0,0 pp |         ↑ +4,9 pp |
| 21  | Rekrutacja / kariera                                  |       55,12% |  **55,12%** |     0,0 pp |         47,13% |    **47,13%** |     0,0 pp |            0,0 pp |
| —   | PRZEKROJOWE: design system (components/ui)            |       79,89% |  **79,89%** |     0,0 pp |         71,49% |    **71,49%** |     0,0 pp |        ↑ +16,8 pp |
| 2   | Edytor wpisów i workflow redakcyjny                   |       99,35% |  **99,35%** |     0,0 pp |         98,73% |    **98,85%** |  ↑ +0,1 pp |        ↑ +91,0 pp |
| 16  | Społeczność: kluby, komentarze, moderacja             |       89,16% |  **89,12%** |     0,0 pp |         89,05% |    **89,02%** |     0,0 pp |        ↑ +71,6 pp |
| 20  | Platforma / backend / infrastruktura / SSR            |       75,46% |  **74,73%** |  ↓ -0,7 pp |         68,05% |    **67,44%** |  ↓ -0,6 pp |        ↑ +22,0 pp |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |       67,72% |  **65,62%** |  ↓ -2,1 pp |         78,25% |    **75,58%** |  ↓ -2,7 pp |        ↑ +32,9 pp |

Ruszyło 5 powierzchni (powyżej 1 pp), 19 stoi w granicach ±1 pp, 1 spadło o więcej niż 1 pp.
Wzorzec z pięciu poprzednich wydań powtórzył się szósty raz, ale w innym kształcie. Do tej pory
ruch brał się z ZADAŃ DOMYKAJĄCYCH na istniejących powierzchniach. Tym razem są dwa źródła:

1. **MODUŁ 11 (newsletter i e-mail): 81,47% → 99,53% linii, 82,71% → 99,43% funkcji, plików
   na zerze 29 → 0.** To najwyższy wynik w całym repozytorium i pierwszy moduł, który domknął
   się do zera plików bez pokrycia. Zadanie było zamówione promptem modułowym i wykonane
   w całości — łącznie z warstwą tłumień (`suppression`), od której zaczynał prompt, bo
   „maila nie da się wycofać”.
2. **MODUŁ 22 (wydarzenia): powierzchnia 29 → 362 pliki przy pokryciu 35,05% → 58,96%.**
   To nie jest zadanie domykające, tylko dostawa nowego produktu — i jedyny przypadek w tej
   serii, w którym powierzchnia urosła dwunastokrotnie, a jej pokrycie w tym samym czasie
   URÓSŁO o 23,9 pp. Dla porównania: CMS builder wchodził do wydania 1 z 24%, kluby z 25,8%,
   moduł 19 z 27,98%.

Trzecia obserwacja jest ostrzeżeniem, nie sukcesem: **MODUŁ 15 (profil i konto) spadł
z 97,42% na 96,15% i to jedyny spadek w tym wydaniu, który jest REGRESJĄ, a nie dylucją** —
dziesięć czerwonych testów i przekroczony próg `src/components/profile/**` (rozdz. 0 i 6.1).
Moduł 21 (rekrutacja) po raz **szósty z rzędu** nie ruszył się o ani jedną setną punktu.

### 2.2 Wymiar „funkcje”: ile funkcji w module zostało kiedykolwiek wywołane

To najostrzejsza z czterech metryk: liczy KAŻDĄ funkcję (również strzałkowe callbacki i handlery),
a „pokryta” znaczy „wywołana co najmniej raz”. Moduł z 20% funkcji ma cztery piąte swoich zachowań
nigdy nie uruchomione w teście.

| #   | Moduł                                                 | Funkcji razem | Wywołanych |  % funkcji |
| --- | ----------------------------------------------------- | ------------: | ---------: | ---------: |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |           467 |         86 | **18,42%** |
| 17  | Analityka i BI                                        |           880 |        250 | **28,41%** |
| 7   | Typy treści specjalne                                 |         1 522 |        559 | **36,73%** |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    |         1 719 |        727 | **42,29%** |
| 21  | Rekrutacja / kariera                                  |           348 |        164 | **47,13%** |
| 12  | Realtime / powiadomienia / web-push                   |           394 |        187 | **47,46%** |
| 22  | Wydarzenia: event builder, rejestracja, onsite        |         3 935 |      2 174 | **55,25%** |
| 9   | Czat / komunikator                                    |         1 060 |        615 | **58,02%** |
| —   | PRZEKROJOWE: słowniki i18n                            |           184 |        109 | **59,24%** |
| 20  | Platforma / backend / infrastruktura / SSR            |         2 018 |      1 361 | **67,44%** |
| —   | PRZEKROJOWE: design system (components/ui)            |           228 |        163 | **71,49%** |
| 3   | Silniki treści: bloki + page builder                  |         6 880 |      4 933 | **71,70%** |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |         1 425 |      1 077 | **75,58%** |
| 10  | Sieć / networking                                     |           303 |        245 | **80,86%** |
| 1   | Wpisy: doświadczenie czytelnika                       |           688 |        564 | **81,98%** |
| 4   | Strony, wygląd, motyw, media, import                  |         1 008 |        896 | **88,89%** |
| 16  | Społeczność: kluby, komentarze, moderacja             |         3 351 |      2 983 | **89,02%** |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |         1 457 |      1 310 | **89,91%** |
| 5   | Strona główna, archiwa, chrome                        |           568 |        531 | **93,49%** |
| 15  | Profil i konto                                        |         1 098 |      1 037 | **94,44%** |
| 6   | Wyszukiwarka                                          |           294 |        280 | **95,24%** |
| 8   | SEO, feedy, dane strukturalne                         |           505 |        483 | **95,64%** |
| 18  | CRM                                                   |         1 072 |      1 057 | **98,60%** |
| 2   | Edytor wpisów i workflow redakcyjny                   |           868 |        858 | **98,85%** |
| 11  | Newsletter i e-mail                                   |         1 572 |      1 563 | **99,43%** |

---

## 3. Pokrycie per funkcjonalność (141 funkcjonalności w 22 modułach)

Każdy wiersz to FUNKCJA PRODUKTU, nie katalog: lista plików ją realizujących jest zdefiniowana
wzorcami ścieżek. Kolumna „fn” to funkcje wywołane / wszystkie funkcje w plikach tej funkcjonalności.

### MODUŁ 1 — Wpisy: doświadczenie czytelnika · linie 84,35% · funkcje 81,98%

**Rodzaje testów:** jednostkowy 33 · komponentowy 15 · hooka 8 · dostępności 1.

**Co tu decyduje:** reguły dostępu i formatowania (paywall, metering, cytowania, TOC) mają testy jednostkowe i progi, więc ryzyko przeniosło się na **testy komponentowe**: to, co czytelnik widzi — render wpisu, odtwarzacz audio, podświetlanie glosariusza mutujące DOM artykułu — dowodzi się wyłącznie renderem z asercją na treść, a nie testem czystej funkcji.

**Bez tego rodzaju przechodzi taki defekt:** reguła paywalla poprawnie liczy limit, a widok mimo to renderuje pełną treść pod nakładką — tekst jest w DOM, więc płatna treść wycieka do czytnika i do robota. Test reguły jest zielony, pieniądze stracone.

| Funkcjonalność                     | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |      Linie | fn (szt.) |
| ---------------------------------- | -----: | ---------: | -----: | ----: | ------: | ---------: | --------: |
| Paywall / bramka dostępu           |      5 |        152 |  70,9% | 73,4% |   78,8% |  **71,7%** |     26/33 |
| Audio wpisu (TTS)                  |     16 |        763 |  84,5% | 79,2% |   83,4% |  **86,8%** |   126/151 |
| Układy wpisu + render              |     29 |        507 |  83,7% | 73,5% |   77,4% |  **87,2%** |   127/164 |
| Powiązane wpisy / rekomendacje     |      7 |        162 |  89,4% | 80,1% |   95,7% |  **91,4%** |     45/47 |
| Key takeaways + cytowania          |      5 |        171 |  98,5% | 92,4% |  100,0% |  **99,4%** |     41/41 |
| Spis treści (TOC) + przypisy       |      6 |        253 |  96,2% | 87,6% |   98,5% |  **99,6%** |     67/68 |
| Metering „N darmowych/mies.”       |      3 |         85 |  98,0% | 96,1% |  100,0% | **100,0%** |     23/23 |
| Licznik odsłon / zapisane artykuły |      3 |        103 |  99,2% | 96,7% |   92,9% | **100,0%** |     26/28 |
| Lista lektur (UI czytelnika)       |     17 |        104 | 100,0% | 99,2% |  100,0% | **100,0%** |     59/59 |

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

### MODUŁ 3 — Silniki treści: bloki + page builder · linie 76,40% · funkcje 71,70%

**Rodzaje testów:** komponentowy 132 · jednostkowy 124 · hooka 13 · parytetu 8 · bramki 3 · dostępności 2 · dymny 1.

**Co tu decyduje:** decyduje **test parytetu**: rejestr widgetów, panel właściwości i renderer to trzy artefakty, które muszą mówić to samo, a rozjazd „panel ustawia, renderer ignoruje” łapie wyłącznie porównanie dwóch stron (`check:widget-fidelity`, `settingsFidelity.gate`). Test jednostkowy schematu i test komponentu widgetu są konieczne, ale ani jeden, ani drugi nie zauważy dryfu między nimi.

**Bez tego rodzaju przechodzi taki defekt:** panel zapisuje ustawienie pod kluczem `heightMobile`, renderer czyta `mobileHeight`. Oba pliki mają testy, oba są zielone, a strona na telefonie ignoruje ustawienie — to dokładnie ta klasa defektu, dla której powstała bramka `check:widget-fidelity`.

| Funkcjonalność                                         | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |      Linie | fn (szt.) |
| ------------------------------------------------------ | -----: | ---------: | -----: | ----: | ------: | ---------: | --------: |
| CMS: builder sidebara + wzorce                         |      7 |        238 |  73,1% | 66,8% |   69,7% |  **74,4%** |    92/132 |
| CMS: import z Gutenberga / WordPressa                  |     10 |      1 309 |  78,1% | 74,5% |   79,6% |  **79,4%** |   199/250 |
| CMS: silnik treści publicznej (contentEngine)          |     20 |        525 |  79,8% | 77,9% |   82,6% |  **81,0%** |   100/121 |
| CMS: zapytania danych widgetów                         |      8 |        459 |  78,3% | 68,8% |   87,9% |  **83,2%** |   123/140 |
| CMS: design tokens / kolory globalne / typografia      |      6 |        257 |  85,8% | 81,6% |   87,5% |  **87,9%** |     35/40 |
| CMS: widgety buildera — render publiczny               |     54 |      3 591 |  90,4% | 82,7% |   87,0% |  **92,1%** |   691/794 |
| CMS: page builder (typ Elementor) — schemat i operacje |     11 |        649 |  89,4% | 69,6% |   99,7% |  **96,9%** |   293/294 |
| CMS: panele właściwości widgetów                       |    112 |      4 669 |  96,5% | 93,2% |   95,0% |  **97,3%** | 1972/2075 |
| CMS: render bloków (publiczny)                         |     39 |      1 920 |  97,3% | 94,0% |   96,3% |  **98,1%** |   499/518 |
| CMS: sanityzacja HTML                                  |      4 |        157 |  94,4% | 88,8% |   90,6% |  **98,1%** |     29/32 |
| CMS: silnik bloków (typ Gutenberg) — rdzeń             |      9 |        359 |  99,0% | 94,1% |  100,0% |  **98,9%** |   148/148 |
| CMS: warstwa content-model (rozdział bloki⇄builder)    |      7 |        150 |  95,1% | 86,7% |   96,9% |  **99,3%** |     31/32 |
| CMS: edycja bloków (selekcja, focus, schowek, undo)    |      6 |        236 |  98,3% | 93,4% |  100,0% | **100,0%** |     45/45 |

### MODUŁ 4 — Strony, wygląd, motyw, media, import · linie 92,32% · funkcje 88,89%

**Rodzaje testów:** komponentowy 31 · jednostkowy 26 · hooka 11 · warstwy danych 4 · funkcji serwerowej 1 · dostępności 1.

**Co tu decyduje:** połowa ryzyka to **czysta matematyka** (kadrowanie obrazu, tokeny motywu, kontrast etykiet) — tam test jednostkowy jest najtańszym dowodem o największym zasięgu; druga połowa to **testy hooków** panelu mediów (mutacje, zaznaczanie, skróty klawiszowe), gdzie liczy się kolejność zdarzeń i wycofanie po błędzie.

**Bez tego rodzaju przechodzi taki defekt:** kadr zapisuje się z zamienionymi osiami i wszystkie miniatury w archiwum są przycięte w złym miejscu. Dla plików już przetworzonych błąd jest nieodwracalny — nie ma z czego odtworzyć oryginalnego kadru.

| Funkcjonalność                  | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |      Linie | fn (szt.) |
| ------------------------------- | -----: | ---------: | -----: | ----: | ------: | ---------: | --------: |
| Ikony / marka                   |      7 |        149 |  79,6% | 73,9% |   73,0% |  **80,5%** |     27/37 |
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

### MODUŁ 6 — Wyszukiwarka · linie 97,38% · funkcje 95,24%

**Rodzaje testów:** komponentowy 12 · jednostkowy 5 · hooka 2 · funkcji serwerowej 1 · warstwy danych 1.

**Co tu decyduje:** ranking, operatory i facety są dowiedzione w **pgTAP** (9 plików) — powtarzanie tego w vitest jest stratą; brakującym dowodem jest **test komponentowy overlaya** i **test hooka zapisanych wyszukiwań** (alerty e-mail), bo tam mieszka to, czego baza nie widzi.

**Bez tego rodzaju przechodzi taki defekt:** alert e-mail subskrybuje zapytanie, ale nie odsubskrybowuje po usunięciu zapisanego wyszukiwania. Użytkownik dostaje powiadomienia o czymś, co skasował, i nie ma w interfejsie sposobu, żeby je wyłączyć.

| Funkcjonalność                               | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| -------------------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Wyszukiwarka: indeks i zapytania             |     11 |        515 |  96,6% | 88,8% |   98,1% | **98,3%** |   103/105 |
| Wyszukiwarka: UI (overlay, filtry, zapisane) |     13 |        411 |  98,3% | 93,9% |   98,5% | **98,3%** |   130/132 |

### MODUŁ 7 — Typy treści specjalne · linie 43,93% · funkcje 36,73%

**Rodzaje testów:** komponentowy 19 · jednostkowy 20 · warstwy danych 3 · hooka 1 · funkcji serwerowej 1 · dymny 2.

**Co tu decyduje:** osiem różnych typów treści dzieli jeden wzorzec: reguły domenowe mają testy, a **funkcje serwerowe i loadery** nie. Po wydzieleniu wydarzeń do modułu 22 zostały tu trackery, eksperci, programy, podcasty, web stories, quizy, pliki i mapy — powierzchnie czytane przez loader trasy, więc rozstrzyga **test funkcji serwerowej**, a nie test czystej reguły.

**Bez tego rodzaju przechodzi taki defekt:** loader trasy trackera czyta wiersz, którego RLS nie przepuszcza, i renderuje pustą listę zamiast błędu — redakcja widzi „brak wpisów” i przez tydzień nie wie, że publikacja nie dochodzi do czytelnika.

| Funkcjonalność                   | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |      Linie | fn (szt.) |
| -------------------------------- | -----: | ---------: | -----: | ----: | ------: | ---------: | --------: |
| Podcast                          |      4 |         78 |  73,7% | 74,3% |   50,0% |  **70,5%** |     16/32 |
| Wydarzenia (RSVP, waitlist, ICS) |    195 |      5 900 |  72,6% | 69,5% |   70,1% |  **74,5%** | 1386/1976 |
| Quiz / mapy                      |      5 |        251 |  92,8% | 88,0% |   88,7% |  **94,4%** |     55/62 |
| Huby ekspertów                   |     26 |        820 |  97,0% | 89,4% |   95,7% |  **97,9%** |   244/255 |
| Tracker legislacyjny             |      9 |        235 |  99,3% | 96,1% |  100,0% | **100,0%** |     95/95 |
| Programy badawcze                |      4 |         31 | 100,0% | 96,6% |  100,0% | **100,0%** |     14/14 |
| Web stories                      |      3 |         98 |  99,2% | 96,3% |  100,0% | **100,0%** |     30/30 |
| Biblioteka plików                |      7 |        248 |  99,7% | 91,0% |  100,0% | **100,0%** |     76/76 |

### MODUŁ 8 — SEO, feedy, dane strukturalne · linie 96,65% · funkcje 95,64%

**Rodzaje testów:** jednostkowy 48 · dostępności 8 · funkcji serwerowej 4 · hooka 2 · warstwy danych 1 · komponentowy 5.

**Co tu decyduje:** tu **e2e jest niezastępowalne**: JSON-LD, hreflang i sitemapy dowodzi się bajtami, które wyszły z SSR, a nie wywołaniem funkcji budującej `<head>`. Testy jednostkowe (35 plików) pilnują kształtu danych, `e2e/seo.spec.ts` pilnuje tego, co widzi robot.

**Bez tego rodzaju przechodzi taki defekt:** funkcja budująca `<head>` zwraca poprawny JSON-LD, a SSR go nie emituje albo emituje dwa razy. Test jednostkowy nie widzi bajtów, które wyszły z serwera — a robot widzi wyłącznie je.

| Funkcjonalność               | Plików | LOC mierz. | Instr. |   Gał. | Funkcje |      Linie | fn (szt.) |
| ---------------------------- | -----: | ---------: | -----: | -----: | ------: | ---------: | --------: |
| Feedy i sitemapy             |      8 |        130 |  60,4% |  40,6% |   37,5% |  **61,5%** |      9/24 |
| SEO: meta, JSON-LD, hreflang |     46 |      1 397 |  98,8% |  96,4% |   99,0% |  **99,3%** |   296/299 |
| Udostępnianie / OG           |      4 |        208 |  99,2% |  98,4% |  100,0% | **100,0%** |     64/64 |
| Monitor linków               |      2 |         18 | 100,0% | 100,0% |  100,0% | **100,0%** |       8/8 |

### MODUŁ 9 — Czat / komunikator · linie 62,83% · funkcje 58,02%

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

### MODUŁ 11 — Newsletter i e-mail · linie 99,53% · funkcje 99,43%

**Rodzaje testów:** komponentowy 39 · warstwy danych 19 · jednostkowy 36 · funkcji serwerowej 20 · dostępności 1 · hooka 3.

**Co tu decyduje:** dostarczalność to **testy funkcji serwerowych** (webhook dostawcy, tłumienie, reputacja) — nic innego tego nie dowiedzie, bo zdarzenie przychodzi z zewnątrz; panel redakcyjny to **testy komponentowe**, bo błąd widać dopiero w interakcji: kampania wysłana do złej listy jest defektem UI, nie reguły.

**Bez tego rodzaju przechodzi taki defekt:** twarde odbicie nie trafia na listę tłumienia, więc kolejna kampania idzie na martwy adres. Reputacja domeny spada, a wraz z nią przestaje dochodzić poczta transakcyjna — w tym reset hasła.

| Funkcjonalność                                     | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |      Linie | fn (szt.) |
| -------------------------------------------------- | -----: | ---------: | -----: | ----: | ------: | ---------: | --------: |
| Newsletter: telemetria (open/click, engagement)    |      8 |        119 |  97,8% | 96,1% |  100,0% |  **98,3%** |     28/28 |
| Newsletter: doręczalność (SPF/DKIM, bounces)       |      2 |         85 |  99,0% | 95,6% |   95,7% |  **98,8%** |     22/23 |
| POPUP: host i wyświetlanie (reguły, częstotliwość) |      2 |        197 |  98,0% | 93,6% |  100,0% |  **99,0%** |     49/49 |
| Newsletter: panel admina                           |     49 |      1 563 |  98,5% | 91,7% |   99,3% |  **99,2%** |   710/715 |
| E-maile systemowe / transakcyjne                   |     38 |      1 010 |  99,5% | 98,7% |   99,6% |  **99,6%** |   264/265 |
| Newsletter: zapis + double opt-in + potwierdzenie  |      4 |        175 |  99,5% | 94,2% |   96,0% | **100,0%** |     24/25 |
| Newsletter: wypis (unsubscribe)                    |      3 |        109 |  96,7% | 93,2% |   90,0% | **100,0%** |     18/20 |
| Newsletter: kampanie i wysyłka                     |      3 |        380 | 100,0% | 99,2% |  100,0% | **100,0%** |     70/70 |
| Newsletter: builder maila (dokument + render HTML) |      8 |        423 | 100,0% | 98,5% |  100,0% | **100,0%** |   102/102 |
| POPUP: panel zapisu (formularz + zgody)            |      3 |        199 | 100,0% | 97,4% |  100,0% | **100,0%** |     42/42 |
| POPUP: edytor popupu w adminie                     |     15 |        399 |  98,8% | 92,6% |  100,0% | **100,0%** |   225/225 |
| POPUP: wygląd (design tokens popupu)               |      1 |         85 |  98,0% | 91,8% |  100,0% | **100,0%** |     27/27 |
| POPUP: telemetria zdarzeń                          |      2 |         62 | 100,0% | 92,3% |  100,0% | **100,0%** |     11/11 |

### MODUŁ 12 — Realtime / powiadomienia / web-push · linie 49,54% · funkcje 47,46%

**Rodzaje testów:** jednostkowy 11 · funkcji serwerowej 2 · hooka 1.

**Co tu decyduje:** realtime wymaga **atrapy kanału** (`realtimeStub`): bez niej test dowodzi tylko, że subskrypcja została utworzona, a nie że przyjście zdarzenia zmienia stan. Powiadomienia i web-push to dodatkowo **testy funkcji serwerowych** — wysyłka jest efektem ubocznym, nie zwracaną wartością.

**Bez tego rodzaju przechodzi taki defekt:** test dowodzi, że subskrypcja kanału została utworzona, i przechodzi także wtedy, gdy handler zdarzenia jest pusty. Powiadomienia nie przychodzą, a suita jest zielona.

| Funkcjonalność              | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| --------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Powiadomienia + web-push    |     16 |        878 |  42,3% | 29,5% |   32,1% | **44,9%** |    80/249 |
| Realtime (kanały, presence) |     10 |        294 |  61,5% | 44,2% |   76,6% | **65,0%** |   105/137 |

### MODUŁ 13 — Monetyzacja: checkout / subskrypcje / billing · linie 65,62% · funkcje 75,58%

**Rodzaje testów:** komponentowy 37 · funkcji serwerowej 24 · jednostkowy 26 · warstwy danych 4 · hooka 1 · dostępności 1 · parytetu 1.

**Co tu decyduje:** ścieżka płatność → dostęp ma **testy funkcji serwerowych** z wysokimi progami (webhook Stripe, grant) i to jest właściwy rodzaj dowodu dla pieniędzy. Ale rezygnacja, zmiana planu i faktury to **testy komponentowe**: UI może pokazać „anulowano”, gdy żądanie padło, a żaden test serwerowy tego nie zauważy.

**Bez tego rodzaju przechodzi taki defekt:** anulowanie subskrypcji pokazuje „anulowano”, choć żądanie padło. Użytkownik jest przekonany, że nie płaci, i wraca po miesiącu z reklamacją i chargebackiem — a test funkcji serwerowej niczego nie zgłosił, bo funkcja nigdy nie została wywołana.

| Funkcjonalność                              | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ------------------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Billing: rekoncyliacja i panel              |    116 |      3 858 |  61,0% | 57,0% |   76,6% | **62,4%** |   623/813 |
| Webhook płatności                           |      1 |         37 |  68,4% | 63,3% |   40,0% | **67,6%** |       2/5 |
| Checkout (Stripe) + intencja                |     15 |        200 |  71,1% | 61,8% |   70,9% | **75,0%** |     39/55 |
| Subskrypcje / plany / cennik                |     33 |        756 |  91,7% | 84,9% |   92,3% | **92,7%** |   337/365 |
| Dołączenie do członkostwa (membership join) |      9 |         65 |  96,1% | 84,1% |   93,8% | **96,9%** |     30/32 |

### MODUŁ 14 — Monetyzacja: kupony / darowizny / prezenty / reklamy · linie 27,06% · funkcje 18,42%

**Rodzaje testów:** jednostkowy 6 · komponentowy 5.

**Co tu decyduje:** kwoty i kupony to **testy jednostkowe** (waluta, zaokrąglenia, audyt kuponu), a widoczność reklamy i przycisku darowizny to **testy komponentowe**. Rozdział jest tu ważny, bo błąd w kwocie i błąd w widoczności mają różne konsekwencje i różne rodzaje dowodu.

**Bez tego rodzaju przechodzi taki defekt:** zaokrąglenie kuponu procentowego liczy się na liczbach zmiennoprzecinkowych i suma zamówienia rozjeżdża się o grosz z kwotą pobraną przez dostawcę płatności. Księgowość nie domyka miesiąca, a różnicy nie widać w żadnym logu aplikacji.

| Funkcjonalność               | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ---------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Reklamy / sponsoring         |     15 |        436 |  33,5% | 40,6% |   31,1% | **33,0%** |    37/119 |
| Kupony                       |      7 |        111 |  44,5% | 40,4% |   56,0% | **46,8%** |     14/25 |
| Prezenty artykułów (gifting) |     10 |        232 |  53,6% | 55,7% |   48,4% | **56,5%** |     31/64 |
| Darowizny                    |      3 |        119 |  84,0% | 72,0% |   71,4% | **85,7%** |     15/21 |

### MODUŁ 15 — Profil i konto · linie 97,50% · funkcje 94,44%

**Rodzaje testów:** komponentowy 29 · dostępności 11 · jednostkowy 17 · hooka 7 · funkcji serwerowej 3 · bramki 4 · warstwy danych 1.

**Co tu decyduje:** konto to **testy inwariantów i bramek** (guard weryfikacji profilu, izolacja tenanta) plus **pgTAP** dla eksportu danych i RODO. Sam procent pokrycia mówi tu mniej niż odpowiedź na pytanie, czy inwariant „profil niezweryfikowany nie widzi X” ma test, który pada przy każdym złamaniu reguły w dowolnym miejscu.

**Bez tego rodzaju przechodzi taki defekt:** jedna nowa trasa zapomina guardu weryfikacji i profil niezweryfikowany widzi dane, których nie powinien. Każda pojedyncza funkcja działa poprawnie — złamana jest reguła, nie funkcja, więc żaden test funkcji tego nie wykryje.

| Funkcjonalność                                | Plików | LOC mierz. | Instr. |   Gał. | Funkcje |      Linie | fn (szt.) |
| --------------------------------------------- | -----: | ---------: | -----: | -----: | ------: | ---------: | --------: |
| Profil użytkownika                            |     41 |      1 456 |  89,3% |  82,7% |   85,6% |  **90,4%** |   439/513 |
| LOGIN: formularze auth w CMS (bloki + widget) |      3 |        366 |  97,0% |  90,5% |   93,9% |  **98,1%** |     77/82 |
| Konto: dane, RODO, eksport                    |      3 |        118 |  97,5% |  96,8% |   91,2% |  **98,3%** |     31/34 |
| Zainteresowania / personalizacja              |      7 |        647 |  98,0% |  94,7% |   98,6% |  **99,8%** |   145/147 |
| LOGIN: portal logowania (hasło, magic link)   |      4 |        225 | 100,0% |  99,3% |  100,0% | **100,0%** |     55/55 |
| REJESTRACJA: pola, walidacja, panel sukcesu   |      2 |         46 | 100,0% |  96,2% |  100,0% | **100,0%** |     16/16 |
| LOGIN/LOGOUT: sesja i kontekst użytkownika    |      4 |        117 | 100,0% |  97,3% |   96,3% | **100,0%** |     26/27 |
| LOGIN: MFA (2FA)                              |      2 |         44 | 100,0% |  97,1% |  100,0% | **100,0%** |     14/14 |
| LOGIN: ochrona przed brute force              |      1 |         54 | 100,0% | 100,0% |  100,0% | **100,0%** |       9/9 |
| LOGIN: reset hasła                            |      1 |         52 | 100,0% |  98,4% |  100,0% | **100,0%** |     16/16 |
| LOGIN: ustawienia logowania (admin)           |      4 |        110 | 100,0% | 100,0% |  100,0% | **100,0%** |     34/34 |
| Retencja / onboarding                         |      8 |        180 | 100,0% |  97,8% |  100,0% | **100,0%** |     38/38 |

### MODUŁ 16 — Społeczność: kluby, komentarze, moderacja · linie 89,12% · funkcje 89,02%

**Rodzaje testów:** komponentowy 95 · jednostkowy 83 · dostępności 4 · hooka 6 · warstwy danych 1 · funkcji serwerowej 2 · bramki 2 · parytetu 1.

**Co tu decyduje:** reguły dostępu do klubu mają testy jednostkowe, a polityki — **19 plików pgTAP**. Brakującym rodzajem jest **test warstwy danych** (łańcuch PostgREST w `api.ts`) i **test hooka** dla stanu listy wątków: to one decydują, czy właściwy członek zobaczy właściwą treść, czego ani reguła, ani polityka bazy nie dowodzą same.

**Bez tego rodzaju przechodzi taki defekt:** zapytanie o wątki gubi filtr grupy. RLS przepuści, bo pytający jest członkiem klubu, więc członek grupy A zobaczy wątki grupy B. Polityka jest poprawna; zapytanie nie.

| Funkcjonalność                                     | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |      Linie | fn (szt.) |
| -------------------------------------------------- | -----: | ---------: | -----: | ----: | ------: | ---------: | --------: |
| Społeczność: odznaki, zaangażowanie, Q&A, ankiety  |     21 |        664 |  34,0% | 40,4% |   31,1% |  **35,5%** |    73/235 |
| Komentarze i moderacja                             |      6 |        239 |  83,2% | 78,2% |   68,0% |  **84,1%** |     51/75 |
| KLUBY: zgłoszenia członkowskie (apply)             |      5 |        183 |  87,4% | 71,0% |   95,1% |  **89,6%** |     58/61 |
| KLUBY: API i zapytania (klub, posty, wątki)        |     10 |        591 |  96,1% | 96,8% |   98,2% |  **96,6%** |   222/226 |
| KLUBY: dostęp i uprawnienia (gate, macierz, plany) |      7 |        152 |  96,6% | 93,6% |  100,0% |  **98,0%** |     43/43 |
| KLUBY: reguły widoków wyprowadzone z JSX-a         |     12 |        378 |  99,1% | 97,2% |   98,7% |  **99,5%** |   151/153 |
| KLUBY: wątki dyskusyjne (dynamika, puls, źródła)   |      8 |        256 |  97,0% | 85,6% |  100,0% |  **99,6%** |     93/93 |
| KLUBY: UI (atomy/molekuły/organizmy)               |    103 |      2 193 |  99,8% | 99,3% |   99,9% |  **99,9%** |   934/935 |
| KLUBY: tematy, specjalizacje, obszary polityk      |     10 |        166 |  98,6% | 95,7% |   98,3% | **100,0%** |     59/60 |
| KLUBY: panel admina                                |     77 |      1 634 |  99,6% | 98,8% |  100,0% | **100,0%** |   782/782 |
| KLUBY: trasy publiczne klubu                       |     20 |        678 |  99,7% | 98,4% |  100,0% | **100,0%** |   247/247 |

### MODUŁ 17 — Analityka i BI · linie 32,88% · funkcje 28,41%

**Rodzaje testów:** jednostkowy 17 · dostępności 1 · komponentowy 1.

**Co tu decyduje:** warstwa semantyczna analityki jest w 100% pokryta **testami jednostkowymi z progami** — i tak być powinno, bo od niej zależy każda liczba w raporcie zarządczym. Wykresy potrzebują natomiast **testów a11y**: wykres bez alternatywy tekstowej jest dla części odbiorców pustym prostokątem.

**Bez tego rodzaju przechodzi taki defekt:** wykres w raporcie zarządczym jest dla części odbiorców pustym prostokątem. Dane są poprawne co do liczby i niedostępne co do odczytu — a pokrycie warstwy semantycznej wynosi 100%.

| Funkcjonalność                          | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| --------------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Analityka: zbieranie zdarzeń i liczniki |     20 |        705 |  15,4% | 13,7% |   18,2% | **16,0%** |    28/154 |
| Wykresy i panel BI                      |     41 |      1 501 |  27,8% | 22,2% |   22,3% | **29,0%** |   114/512 |
| Observability / RUM / web vitals        |     11 |        409 |  54,6% | 48,6% |   61,7% | **54,0%** |     37/60 |
| Analityka: warstwa semantyczna          |      7 |        239 |  70,4% | 60,2% |   69,4% | **71,5%** |     43/62 |

### MODUŁ 18 — CRM · linie 99,03% · funkcje 98,60%

**Rodzaje testów:** jednostkowy 18 · warstwy danych 5 · komponentowy 6 · funkcji serwerowej 2 · parytetu 1 · hooka 1.

**Co tu decyduje:** CRM pokazuje, po co jest **test parytetu**: filtr leadów istnieje w dwóch implementacjach (nad wierszami i nad zapytaniem), więc bez porównania obu stron poprawka w jednej zostawia drugą zepsutą. Poza tym **test warstwy danych** dla zapytań i **test jednostkowy** dla mapowania importu danych osobowych.

**Bez tego rodzaju przechodzi taki defekt:** poprawka w filtrze nad wierszami nie trafia do filtra nad zapytaniem. Lista i eksport pokazują różne zbiory leadów, a handlowiec pracuje na tym mniejszym i nie wie o brakujących.

| Funkcjonalność                        | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ------------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| CRM: UI panelu                        |     19 |        569 |  95,1% | 83,4% |   96,5% | **96,0%** |   279/289 |
| CRM: import/eksport CSV + organizacje |      7 |        356 |  98,8% | 91,7% |   96,3% | **99,7%** |     79/82 |
| CRM: kontakty, firmy, lejek, zadania  |     25 |      1 115 |  98,9% | 90,7% |   99,6% | **99,8%** |   275/276 |

### MODUŁ 19 — Ustawienia / integracje / users / multi-tenant / RODO · linie 93,18% · funkcje 89,91%

**Rodzaje testów:** jednostkowy 30 · warstwy danych 9 · funkcji serwerowej 4 · hooka 3 · komponentowy 3 · parytetu 1 · bramki 1.

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

### MODUŁ 20 — Platforma / backend / infrastruktura / SSR · linie 74,73% · funkcje 67,44%

**Rodzaje testów:** komponentowy 39 · jednostkowy 122 · warstwy danych 18 · funkcji serwerowej 21 · dostępności 3 · bramki 5 · parytetu 2.

**Co tu decyduje:** platforma utrzymuje **bramki (meta-inwarianty)**: „bramka, która istnieje, musi się uruchamiać”, parytet konfiguracji chunków, kontrakt zmiennych workflow. To rodzaj testu, który skaluje się z repozytorium, nie z liczbą przypadków — jeden taki test pilnuje wszystkich przyszłych plików.

**Bez tego rodzaju przechodzi taki defekt:** bramka istnieje w repozytorium i nie jest wpięta w workflow, więc zdanie „mamy to sprawdzone” jest fałszywe przez wiele miesięcy. Nikt tego nie zauważy, bo brak sygnału nie wygląda jak awaria — i to jest defekt, którego nie wykryje żaden test kodu produkcyjnego.

| Funkcjonalność                          | Plików | LOC mierz. | Instr. |   Gał. | Funkcje |      Linie | fn (szt.) |
| --------------------------------------- | -----: | ---------: | -----: | -----: | ------: | ---------: | --------: |
| Routing / trasy publiczne (powłoka)     |      8 |        423 |  26,6% |  17,2% |   16,0% |  **27,4%** |    17/106 |
| A11y / watchdog / MCP                   |      9 |        164 |  39,6% |  29,9% |   31,0% |  **42,1%** |      9/29 |
| Klient Supabase / zapytania             |     27 |        959 |  69,4% |  64,5% |   73,7% |  **71,7%** |   205/278 |
| Warstwa serwerowa (server fns)          |     19 |        980 |  76,3% |  71,3% |   79,5% |  **76,7%** |   175/220 |
| Obsługa błędów / error boundary         |      7 |        115 |  78,0% |  76,4% |   65,5% |  **77,4%** |     19/29 |
| SSR / hydracja / cache brzegowy         |     31 |      1 149 |  83,1% |  79,4% |   82,4% |  **84,7%** |   182/221 |
| Bramki CI (rejestry, kontrakty)         |     31 |      2 708 |  93,7% |  86,9% |   93,3% |  **95,3%** |   471/505 |
| Podgląd sesji / heartbeat               |      2 |        148 |  98,8% |  95,1% |  100,0% |  **99,3%** |     27/27 |
| Lista lektur / kolekcje (warstwa reguł) |      2 |         10 | 100,0% | 100,0% |  100,0% | **100,0%** |       8/8 |

### MODUŁ 21 — Rekrutacja / kariera · linie 55,12% · funkcje 47,13%

**Rodzaje testów:** jednostkowy 9 · dostępności 2.

**Co tu decyduje:** rekrutacja to **testy jednostkowe** walidacji zgłoszenia plus **testy a11y** formularza (to najczęściej wypełniany formularz przez osoby z zewnątrz) i **harness pgTAP** na ścieżce zapisu — bramka istnieje właśnie dlatego, że złamany CHECK w bazie przeszedł kiedyś przy zielonym CI.

**Bez tego rodzaju przechodzi taki defekt:** złamany CHECK w bazie przechodzi przy zielonym CI i formularz zgłoszenia przestaje przyjmować kandydatów. Błąd wychodzi z produkcji, nie z suity — bramka `check:pg-harness` istnieje dokładnie z tego powodu.

| Funkcjonalność                   | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| -------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Kariera: ogłoszenia i zgłoszenia |     26 |        576 |  80,1% | 80,2% |   73,2% | **81,3%** |   164/224 |

### MODUŁ 22 — Wydarzenia: event builder, rejestracja, onsite · linie 58,96% · funkcje 55,25%

**Rodzaje testów:** komponentowy 49 · jednostkowy 79 · funkcji serwerowej 8 · hooka 5 · bramki 7 · parytetu 2 · warstwy danych 1.

**Co tu decyduje:** cała poprawność tego modułu mieszka w BAZIE — 42 tabele z RLS, 212 funkcji SQL, pięć ograniczeń `EXCLUDE` (kolizja sali, miejsce przy stole, uczestnik spotkania, okno dostępności, deduplikacja check-inu). Test jednostkowy frontu nie zobaczy z tego nic, więc decydują trzy rodzaje, których w innych modułach prawie nie ma: **uprząż replayu migracji** (`check:events-harness` — 1 001 asercji runtime w 14 plikach na czystym Postgresie, dobierająca migracje po TREŚCI, nie po nazwie pliku), **bramka parytetu stałych z ograniczeniami CHECK** (kolumny wyliczeniowe są typu `text`, więc kompilator nigdy nie zobaczy, że panel oferuje wartość, której baza nie przyjmie) i **test warstwy danych z atrapą PostgREST** na 115 modułach `lib/events`.

**Bez tego rodzaju przechodzi taki defekt:** panel oferuje wartość, której baza nie przyjmie. To nie jest hipoteza: `PACKAGE_AUDIENCES` w kliencie miało `company / university / delegation / partner`, a `CHECK` w bazie dopuszczał `public / member / academic / ngo / company` — **trzy z czterech opcji dialogu kończyły się naruszeniem ograniczenia**, a przebieg szczęśliwy działał wyłącznie dlatego, że `company` jest wartością domyślną. Obok tego `BADGE_PAPER_FORMATS` oferowało format, którego CHECK nie zna, i ukrywało cztery, które zna. Nad każdą z tych list stał komentarz obiecujący „odwzorowanie jeden do jednego”. Komentarz nie jest bramką.

| Funkcjonalność                                  | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ----------------------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Analityka, komunikacja, integracje wydarzenia   |      4 |         33 |   0,0% |  0,0% |    0,0% |  **0,0%** |       0/9 |
| Studio wydarzenia: rama, moduły, gotowość       |     28 |        568 |  26,4% | 25,9% |   26,1% | **25,2%** |    55/211 |
| Regulaminy, grupy i uprawnienia uczestników     |     18 |        492 |  34,9% | 42,0% |   34,1% | **35,2%** |    77/226 |
| Sponsorzy i partnerzy                           |     16 |        595 |  35,3% | 43,1% |   24,6% | **36,8%** |    65/264 |
| Odprawa na miejscu: skan, identyfikatory, leady |     49 |      1 577 |  43,3% | 44,0% |   45,2% | **43,8%** |   253/560 |
| Branding, strony i menu wydarzenia              |     12 |        435 |  50,0% | 43,3% |   39,7% | **49,0%** |    75/189 |
| Giełda spotkań 1-1                              |     32 |        950 |  59,4% | 62,7% |   55,5% | **61,2%** |   217/391 |
| Powierzchnia uczestnika (moje wydarzenie)       |     21 |        447 |  64,5% | 54,0% |   72,0% | **64,2%** |   121/168 |
| Publiczny portal wydarzenia                     |     60 |      1 133 |  63,9% | 61,5% |   58,9% | **65,1%** |   249/423 |
| Bilety, pakiety, wejściówki (pieniądze)         |     30 |        954 |  64,9% | 61,8% |   72,8% | **67,2%** |   236/324 |
| Agenda: sesje, ścieżki, sale, konflikty         |     28 |      1 054 |  71,3% | 63,6% |   68,5% | **71,6%** |   283/413 |
| Katalog wydarzeń, typy, tworzenie               |     24 |        629 |  76,9% | 82,2% |   73,2% | **76,2%** |   199/272 |
| Rejestracja: formularz, pola, zgody, decyzje    |     38 |      1 280 |  74,4% | 70,3% |   65,7% | **76,3%** |   259/394 |
| Informacje ogólne, strefa czasowa, adres        |     10 |        290 |  81,8% | 88,0% |   80,2% | **82,8%** |    85/106 |
| Widgety wydarzeń w builderze stron              |     10 |        547 |  93,3% | 83,9% |   95,0% | **97,4%** |   170/179 |

---

## 4. Zoom na powierzchnie wskazane w zleceniu

Dla pięciu obszarów wymienionych imiennie (newsletter, popup, CMS builder — Gutenberg i Elementor,
kluby dyskusyjne, login/rejestracja/wylogowanie) rozbicie schodzi do POJEDYNCZYCH FUNKCJI:
wypisuję nazwy funkcji, które nie mają ani jednego wywołania w całej suicie.

### 4.1 Newsletter (MODUŁ 11)

Razem: **3 845 / 3 864 linii = 99,51%**, funkcje **1238/1248 = 99,20%**.

**Newsletter: telemetria (open/click, engagement)** — linie 98,3%, funkcje 28/28 (100,0%), plików 8 (bez pokrycia: 0), LOC 119

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

**Newsletter: doręczalność (SPF/DKIM, bounces)** — linie 98,8%, funkcje 22/23 (95,7%), plików 2 (bez pokrycia: 0), LOC 85

> Bez ani jednego wywołania: **1 funkcji** (0 nazwanych, 1 anonimowych domknięć).

**Newsletter: panel admina** — linie 99,2%, funkcje 710/715 (99,3%), plików 49 (bez pokrycia: 0), LOC 1 563

> Bez ani jednego wywołania: **5 funkcji** (0 nazwanych, 5 anonimowych domknięć).

**E-maile systemowe / transakcyjne** — linie 99,6%, funkcje 264/265 (99,6%), plików 38 (bez pokrycia: 0), LOC 1 010

> Bez ani jednego wywołania: **1 funkcji** (0 nazwanych, 1 anonimowych domknięć).

**Newsletter: zapis + double opt-in + potwierdzenie** — linie 100,0%, funkcje 24/25 (96,0%), plików 4 (bez pokrycia: 0), LOC 175

> Bez ani jednego wywołania: **1 funkcji** (0 nazwanych, 1 anonimowych domknięć).

**Newsletter: wypis (unsubscribe)** — linie 100,0%, funkcje 18/20 (90,0%), plików 3 (bez pokrycia: 0), LOC 109

> Bez ani jednego wywołania: **2 funkcji** (0 nazwanych, 2 anonimowych domknięć).

**Newsletter: kampanie i wysyłka** — linie 100,0%, funkcje 70/70 (100,0%), plików 3 (bez pokrycia: 0), LOC 380

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

**Newsletter: builder maila (dokument + render HTML)** — linie 100,0%, funkcje 102/102 (100,0%), plików 8 (bez pokrycia: 0), LOC 423

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

### 4.2 Popup zapisu (MODUŁ 11, wydzielony)

Razem: **940 / 942 linii = 99,79%**, funkcje **354/354 = 100,00%**.

**POPUP: host i wyświetlanie (reguły, częstotliwość)** — linie 99,0%, funkcje 49/49 (100,0%), plików 2 (bez pokrycia: 0), LOC 197

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

**POPUP: panel zapisu (formularz + zgody)** — linie 100,0%, funkcje 42/42 (100,0%), plików 3 (bez pokrycia: 0), LOC 199

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

**POPUP: edytor popupu w adminie** — linie 100,0%, funkcje 225/225 (100,0%), plików 15 (bez pokrycia: 0), LOC 399

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

**POPUP: wygląd (design tokens popupu)** — linie 100,0%, funkcje 27/27 (100,0%), plików 1 (bez pokrycia: 0), LOC 85

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

**POPUP: telemetria zdarzeń** — linie 100,0%, funkcje 11/11 (100,0%), plików 2 (bez pokrycia: 0), LOC 62

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

### 4.3 CMS builder — bloki (Gutenberg) i widgety (Elementor) (MODUŁ 3)

Razem: **13 506 / 14 519 linii = 93,02%**, funkcje **4257/4621 = 92,12%**.

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

**CMS: silnik treści publicznej (contentEngine)** — linie 81,0%, funkcje 100/121 (82,6%), plików 20 (bez pokrycia: 1), LOC 525

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

**CMS: widgety buildera — render publiczny** — linie 92,1%, funkcje 691/794 (87,0%), plików 54 (bez pokrycia: 0), LOC 3 591

> Bez ani jednego wywołania: **103 funkcji** (18 nazwanych, 85 anonimowych domknięć). Nazwane, pierwsze 14:
>
> - `resolveSpan @ src/components/builder/organisms/BuilderRenderer.tsx:82`
> - `resolveOrder @ src/components/builder/organisms/BuilderRenderer.tsx:92`
> - `BuilderEmptyPickerProvider @ src/components/builder/organisms/BuilderRenderer.tsx:139`
> - `deviceForWidth @ src/components/builder/organisms/BuilderRenderer.tsx:156`
> - `BuilderRenderer @ src/components/builder/organisms/BuilderRenderer.tsx:176`
> - `BuilderDebugOverlay @ src/components/builder/organisms/BuilderRenderer.tsx:257`
> - `SectionsList2 @ src/components/builder/organisms/BuilderRenderer.tsx:307`
> - `ExperimentSection @ src/components/builder/organisms/BuilderRenderer.tsx:377`
> - `SectionBackgroundVideo @ src/components/builder/organisms/BuilderRenderer.tsx:412`
> - `RenderSection2 @ src/components/builder/organisms/BuilderRenderer.tsx:455`
> - `RenderInner2 @ src/components/builder/organisms/BuilderRenderer.tsx:685`
> - `RenderColumn2 @ src/components/builder/organisms/BuilderRenderer.tsx:751`
> - `shallowEqual @ src/components/builder/organisms/BuilderWidgetNode.tsx:32`
> - `widgetsEqual @ src/components/builder/organisms/BuilderWidgetNode.tsx:46`

**CMS: page builder (typ Elementor) — schemat i operacje** — linie 96,9%, funkcje 293/294 (99,7%), plików 11 (bez pokrycia: 0), LOC 649

> Bez ani jednego wywołania: **1 funkcji** (0 nazwanych, 1 anonimowych domknięć).

**CMS: panele właściwości widgetów** — linie 97,3%, funkcje 1972/2075 (95,0%), plików 112 (bez pokrycia: 0), LOC 4 669

> Bez ani jednego wywołania: **103 funkcji** (0 nazwanych, 103 anonimowych domknięć).

**CMS: render bloków (publiczny)** — linie 98,1%, funkcje 499/518 (96,3%), plików 39 (bez pokrycia: 0), LOC 1 920

> Bez ani jednego wywołania: **19 funkcji** (0 nazwanych, 19 anonimowych domknięć).

**CMS: sanityzacja HTML** — linie 98,1%, funkcje 29/32 (90,6%), plików 4 (bez pokrycia: 0), LOC 157

> Bez ani jednego wywołania: **3 funkcji** (0 nazwanych, 3 anonimowych domknięć).

**CMS: silnik bloków (typ Gutenberg) — rdzeń** — linie 98,9%, funkcje 148/148 (100,0%), plików 9 (bez pokrycia: 0), LOC 359

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

**CMS: warstwa content-model (rozdział bloki⇄builder)** — linie 99,3%, funkcje 31/32 (96,9%), plików 7 (bez pokrycia: 0), LOC 150

> Bez ani jednego wywołania: **1 funkcji** (0 nazwanych, 1 anonimowych domknięć).

**CMS: edycja bloków (selekcja, focus, schowek, undo)** — linie 100,0%, funkcje 45/45 (100,0%), plików 6 (bez pokrycia: 0), LOC 236

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

### 4.4 Kluby dyskusyjne (MODUŁ 16)

Razem: **6 184 / 6 231 linii = 99,25%**, funkcje **2589/2600 = 99,58%**.

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

**KLUBY: panel admina** — linie 100,0%, funkcje 782/782 (100,0%), plików 77 (bez pokrycia: 0), LOC 1 634

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

**KLUBY: trasy publiczne klubu** — linie 100,0%, funkcje 247/247 (100,0%), plików 20 (bez pokrycia: 0), LOC 678

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

### 4.5 Login / rejestracja / wylogowanie (MODUŁ 15)

Razem: **1 007 / 1 014 linii = 99,31%**, funkcje **247/253 = 97,63%**.

**LOGIN: formularze auth w CMS (bloki + widget)** — linie 98,1%, funkcje 77/82 (93,9%), plików 3 (bez pokrycia: 0), LOC 366

> Bez ani jednego wywołania: **5 funkcji** (0 nazwanych, 5 anonimowych domknięć).

**LOGIN: portal logowania (hasło, magic link)** — linie 100,0%, funkcje 55/55 (100,0%), plików 4 (bez pokrycia: 0), LOC 225

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

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
| `src/lib/events/useScanner.ts`                                 |          127 | M22                                                |
| `src/routes/__root.tsx`                                        |          124 | M20                                                |
| `src/routes/admin.community.qa.tsx`                            |          122 | M16                                                |
| `src/routes/admin.programs.tsx`                                |          122 | M7                                                 |
| `src/components/admin/analytics/Ga4BiDashboard.tsx`            |          116 | M17                                                |
| `src/routes/admin.coupons.index.tsx`                           |          111 | M14                                                |
| `src/components/admin/analytics/RelatedPostsAnalytics.tsx`     |          111 | M17                                                |
| `src/routes/admin.live-blog.tsx`                               |          110 | M7                                                 |
| `src/routes/admin.careers.tsx`                                 |          109 | M21                                                |
| `src/routes/admin.gifting.tsx`                                 |          108 | M14                                                |
| `src/components/admin/blocks/molecules/NestedBlocksEditor.tsx` |          107 | M3                                                 |
| `src/lib/wp-import/wxr.ts`                                     |          105 | M3                                                 |
| `src/routes/network.tsx`                                       |          104 | M10                                                |
| `src/routes/admin.coupons.campaigns.tsx`                       |          102 | M14                                                |
| `src/hooks/useBarcodeScanner.ts`                               |          102 | M22                                                |
| `src/routes/admin.web-stories.tsx`                             |           98 | M7                                                 |
| `src/routes/messages.tsx`                                      |           97 | M9                                                 |
| `src/routes/api/public/community-cron.ts`                      |           93 | M16                                                |
| `src/components/admin/blocks/molecules/SortableBlockItem.tsx`  |           93 | M3                                                 |
| `src/components/admin/blocks/edit/Heading.tsx`                 |           92 | M3                                                 |
| `src/routes/pricing.tsx`                                       |           87 | M13                                                |
| `src/components/admin/analytics/VitalsBiDashboard.tsx`         |           86 | M17                                                |
| `src/routes/admin.super.mobile-drawer.tsx`                     |           83 | M20                                                |
| `src/components/ConsentScriptInjector.tsx`                     |           83 | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły |
| `src/routes/podcast.$slug.tsx`                                 |           82 | M7                                                 |

Łącznie plików produkcyjnych z pokryciem **0%: 524** z 3 201 (16,37%).

### 5.2 Katalogi bez ANI JEDNEGO pliku testowego

Sygnał niezależny od pokrycia: katalog może mieć pokrycie z testu innego katalogu, ale nie ma
testu WŁASNEGO — czyli nikt nie testuje go wprost. Takich katalogów jest **68**,
obejmują **97 plików / 25 672 linii**.

| Katalog                                          | Plików |   LOC |
| ------------------------------------------------ | -----: | ----: |
| `src/lib/locale`                                 |      2 | 4 546 |
| `src/components/admin/ThemeOptionsPane.tsx`      |      1 | 1 898 |
| `src/components/admin/GlobalColorsEditor.tsx`    |      1 | 1 479 |
| `src/components/admin/TrendingTickerPane.tsx`    |      1 | 1 139 |
| `src/components/admin/PostSettingsMetabox.tsx`   |      1 |   878 |
| `src/lib/content-model`                          |      7 |   789 |
| `src/components/admin/settings`                  |      4 |   670 |
| `src/components/author`                          |      2 |   664 |
| `src/components/admin/AdminShell.tsx`            |      1 |   651 |
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
| `src/components/cart`                            |      3 |   298 |
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

### 5.4 Sto trzydzieści dziewięć zer modułu wydarzeń — i dlaczego to nie jest 139 problemów

Nowy moduł wnosi **najwyższą liczbę plików bez ani jednej wykonanej linii w całym repozytorium**:
144 z 362. Sama ta liczba prowadzi do złego wniosku, bo zera są tu trzech różnych rodzajów
i tylko jeden z nich jest długiem.

| Gdzie                                       | Plików 0% | Linii bez pokrycia | Co to znaczy                                                                                            |
| ------------------------------------------- | --------: | -----------------: | ------------------------------------------------------------------------------------------------------- |
| Organizmy panelu (`admin/events/organisms`) |        34 |          **1 198** | prawdziwy dług: panele list i sekcji studia z mutacjami i obsługą odmowy bazy                           |
| Trasy (`routes/*event*`, `routes/scanner`)  |        66 |                384 | ~6 linii na plik: trasy studia są CELOWO cienkie, a czternaście to czyste przekierowania w `beforeLoad` |
| Molekuły panelu (dialogi zapisu)            |         8 |                308 | dług tej samej klasy co organizmy, ale mniejszy                                                         |
| Rama studia (`admin/events/studio`)         |         8 |                222 | **najgorszy jakościowo**: tu stoi bramka roli i bramka modułów dla 38 tras studia                       |
| Komponenty uczestnika                       |        12 |                204 | powierzchnia publiczna uczestnika                                                                       |
| Pliki rozproszone poza trzema katalogami    |         9 |                306 | stara ścieżka biletu (`components/community`), panele „moje zgłoszenia” w profilu, skaner kodu          |
| `src/lib/events`                            |         4 |                193 | w tym `useScanner.ts` (127 linii) — warstwa danych aplikacji przy bramce                                |
| Portal publiczny                            |         3 |                 37 | resztówki                                                                                               |

Razem: 144 pliki, **2 852 niepokryte linie** i 1 138 funkcji bez ani jednego wywołania.

**Wniosek, który wychodzi tylko z tego rozbicia:** 66 zer w trasach to 384 linie, czyli 46%
wszystkich plików-zer modułu przy 13% ich niepokrytych linii. Liczenie „plików na zerze” bez kolumny
z liniami dałoby tu obraz dwa razy gorszy niż rzeczywisty. Odwrotnie działa rama studia:
osiem plików i 222 linie wyglądają na drobiazg, a jest to jedyne miejsce, w którym egzekwuje
się rolę i włączone moduły dla wszystkich 38 tras studia — przegląd zespołu zapisał brak
jej testu jako osobne ustalenie i ono nadal stoi.

Osobno warto zapisać `src/lib/events/useScanner.ts`: **127 zmierzonych linii na 0%**, największy
pojedynczy plik-zero w module. To warstwa danych aplikacji skanera przy bramce wydarzenia —
parowanie urządzenia, kolejka skanów offline (IndexedDB), deduplikacja powtórnego wejścia.
Sam komponent skanera ma testy, e2e ma `scanner.spec.ts`, a baza ma ograniczenie `EXCLUDE`
przeciw podwójnemu wejściu — ale hook, który spina te trzy warstwy, nie wykonuje się w żadnym
teście jednostkowym.

---

### 5.5 Dwie ścieżki zapisu na wydarzenie — i tylko jedna z nich pobiera pieniądze

To znalezisko wychodzi z tego samego zestawienia co 5.3 (dwie implementacje importu WordPressa)
i jest tej samej klasy, ale konsekwencje ma większe, bo dotyczy kasy. Repozytorium ma dziś
**dwie równoległe ścieżki zapisu na wydarzenie, obie żywe**, i mówi o tym wprost we własnym
komentarzu (`src/lib/events/registrationSurface.ts:296`):

> `event_rsvps` (legacy, pisane przez `rsvp_event()`) i `event_registrations` (etap 4, pisane
> przez `event_register()`) żyją obie. Wycofać zapis przez `rsvp_event('cancelled')` da się
> WYŁĄCZNIE na ścieżce legacy — ta funkcja nie tyka wierszy etapu 4.

|                                  | Ścieżka LEGACY (`event_rsvps`)                                                                    | Ścieżka NOWA (`event_registrations`)                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Zapis                            | `rsvp_event()`                                                                                    | `event_register()`                                          |
| Interfejs                        | `components/community/EventTicketPurchase.tsx`                                                    | `components/events/registration/PublicRegistrationForm.tsx` |
| Cena                             | `events.ticket_price_cents`                                                                       | `event_ticket_types.price_cents` (+ fazy cenowe)            |
| **Płatność pojedynczego biletu** | **działa**: `createCheckoutOrder({kind:'one_time', event_id})` → Stripe → webhook → `event_rsvps` | **brak przejścia do kasy**                                  |
| Płatność grupowa                 | —                                                                                                 | działa: `event_admission_quote` → `event_package_purchase`  |
| Wycofanie zapisu                 | działa                                                                                            | `event_registration_cancel` istnieje w bazie, ekranu nie ma |

**Co to znaczy w praktyce.** Sprawdziłem to w kodzie, nie z opisu: w całym drzewie
`src/components/events/**` i `src/lib/events/**` nie ma ani jednego odwołania do bramki
płatniczej. Płatny bilet w nowej ścieżce kończy się na `RegistrationConfirmation.tsx:96`,
gdzie renderuje się blok `paymentRequired` z kwotą i zdaniem „nie masz jeszcze wejściówki”
(`eventRegistration.result.paymentNoTicketYet`) — **i na tym ekran się kończy, bez linku
do kasy**. Uczestnik dowiaduje się, ile jest winien, i nie ma gdzie zapłacić.

Trzeba przy tym powiedzieć, co jest tu dobre, bo to nie jest przeoczenie: jeszcze tydzień
temu ta sama ścieżka **wydawała płatny bilet za darmo** — z działającym kodem QR i zajętym
miejscem z puli. Przegląd zespołu nazwał to ustaleniem K-1, a migracja `20260828206000`
(i jej najnowsza wersja `20260829071947`) domknęła to poprawnie: cena efektywna jest liczona
po stronie bazy, `payment_status` wchodzi na `unpaid`, kod QR nie jest wydawany. **Wybrano
zatrzymanie ścieżki zamiast wydawania darmowych biletów** i to była właściwa kolejność.
Brakuje ostatniego kroku — spięcia z kasą, która obok już działa dla pakietów grupowych.

**Dla pomiaru pokrycia wniosek jest ten sam co przy WordPressie:** funkcjonalność „zapis
i bilet” to dziś DWA zestawy plików w dwóch modułach (22 i 16/13), a nie jeden. Wiersz
„Bilety, pakiety, wejściówki” w rozdziale 3 obejmuje oba — dlatego wciąga pliki
z `components/community`. Gdybym mierzył tylko `src/components/events/**`, dostałbym
procent dla ścieżki, która **nie** obsługuje dziś sprzedaży pojedynczego biletu, i nie
zobaczyłbym tej, która ją obsługuje.

---

---

## 6. Które powierzchnie mają BRAMKĘ pokrycia (a które tylko liczbę)

Liczba bez bramki gnije: pokrycie spada z każdym mergem, którego nikt nie mierzy. Repo ma
**1 próg globalny + 353 progów per-ścieżka** w `vitest.config.ts`, egzekwowanych w CI krokiem
`Test + coverage gate` (`.github/workflows/ci.yml`).

| Moduł                                 | Progów per-ścieżka | Mediana progu linii | Najwyższy próg linii |
| ------------------------------------- | -----------------: | ------------------: | -------------------: |
| M11                                   |                 73 |                  98 |                  100 |
| M20                                   |                 44 |                  99 |                  100 |
| M15                                   |                 40 |                 100 |                  100 |
| M19                                   |                 36 |                 100 |                  100 |
| M1                                    |                 27 |                 100 |                  100 |
| M13                                   |                 21 |                 100 |                  100 |
| M2                                    |                 21 |                 100 |                  100 |
| M8                                    |                 20 |                  98 |                  100 |
| M3                                    |                 18 |                  98 |                  100 |
| M16                                   |                 11 |                  99 |                  100 |
| M9                                    |                  9 |                  96 |                  100 |
| M17                                   |                  8 |                 100 |                  100 |
| M6                                    |                  8 |                 100 |                  100 |
| M22                                   |                  6 |                  66 |                   96 |
| powłoka panelu admin + atomy/molekuły |                  4 |                  99 |                  100 |
| M10                                   |                  2 |                  98 |                   98 |
| M4                                    |                  2 |                  99 |                   99 |
| M7                                    |                  1 |                 100 |                  100 |
| M18                                   |                  1 |                  98 |                   98 |
| M5                                    |                  1 |                  99 |                   99 |

Z tego **80 progów obejmuje CAŁE POWIERZCHNIE** (wzorzec `/**`), a nie pojedyncze pliki —
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
| `src/lib/email/**`                                |     98 |   96 |      98 |    98 | M11                                   |
| `src/lib/newsletter/**`                           |     97 |   94 |      99 |    98 | M11                                   |
| `src/routes/platform/email/**`                    |     96 |   92 |      99 |    98 | M11                                   |
| `src/routes/lovable/email/**`                     |     99 |   98 |     100 |    99 | M11                                   |
| `src/components/newsletter/**`                    |     99 |   97 |     100 |    99 | M11                                   |
| `src/lib/email-templates/**`                      |     99 |   98 |     100 |    99 | M11                                   |
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
| `src/lib/events/**`                               |     68 |   68 |      66 |    71 | M22                                   |
| `src/components/events/**`                        |     65 |   57 |      63 |    66 | M22                                   |
| `src/components/events/packages/**`               |     94 |   90 |      96 |    96 | M22                                   |
| `src/components/admin/events/**`                  |     40 |   36 |      41 |    40 | M22                                   |
| `src/components/admin/events/molecules/**`        |     62 |   59 |      62 |    63 | M22                                   |
| `src/components/admin/events/organisms/**`        |     36 |   32 |      35 |    36 | M22                                   |

**Czego bramka NIE pilnuje** — moduły bez ani jednego progu per-ścieżka:

- **MODUŁ 12 — Realtime / powiadomienia / web-push**: linie 49,54%, funkcje 47,46%, plików 0%: 12/28
- **MODUŁ 14 — Monetyzacja: kupony / darowizny / prezenty / reklamy**: linie 27,06%, funkcje 18,42%, plików 0%: 13/39
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

**W TYM WYDANIU ta sama bramka zadziałała w drugą stronę — i to jest jej pierwszy udokumentowany
sukces.** Osiem naruszeń progów w dwóch grupach ścieżek, obie postawione przy domykaniu
modułów w wydaniach 4 i 5:

| Ścieżka                           | Metryka    | Zmierzone | Próg |   Różnica |
| --------------------------------- | ---------- | --------: | ---: | --------: |
| `src/components/profile/**`       | linie      |    91,58% |   93 |  −1,42 pp |
| `src/components/profile/**`       | funkcje    |    85,43% |   87 |  −1,57 pp |
| `src/components/profile/**`       | instrukcje |    90,37% |   92 |  −1,63 pp |
| `src/components/profile/**`       | gałęzie    |    83,08% |   89 |  −5,92 pp |
| `src/components/admin/billing/**` | linie      |    88,30% |   97 |  −8,70 pp |
| `src/components/admin/billing/**` | funkcje    |    85,84% |   96 | −10,16 pp |
| `src/components/admin/billing/**` | instrukcje |    87,96% |   95 |  −7,04 pp |
| `src/components/admin/billing/**` | gałęzie    |    78,55% |   87 |  −8,45 pp |

Żaden z tych progów nie jest aspiracyjny — wszystkie postawiono POD zmierzone pokrycie, zgodnie
z regułą z tego rozdziału. Przekroczenie oznacza więc, że pokrycie SPADŁO: w module 15 przez
zdublowaną szufladę profilu (dziesięć czerwonych testów, rozdz. 0), w panelu rozliczeń przez
kod, który doszedł bez testów. **To jest dokładnie to zachowanie, po które stawia się próg
per-ścieżka**, i różnica wobec sytuacji z wydania 3 jest zasadnicza: tam bramka blokowała CI
z powodu progu, którego nigdy nie dało się osiągnąć; tu blokuje z powodu realnej regresji,
którą da się cofnąć jednym commitem. Pierwsza to awaria przyrządu, druga to jego działanie.

I nota, którą repo zapisało samo o sobie: re-floor jest odstępstwem od zasady „progi wolno tylko
podnosić”. Commit to przyznaje i dodaje, że powtarzanie go zamiast pracy testowej to już „gaszenie
sygnału”. Ten audyt się z tym zgadza i zapisuje `queries.ts` — gałęzie **80,55%** — jako dług do
spłacenia testami, nie kolejnym re-floorem.

---

## 7. Sześć warstw testów — co która realnie pokrywa

| Warstwa                                         | Rozmiar                                     | Co dowodzi                                                                                                                                                                                                      | Czego NIE dowodzi                                                                 |
| ----------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Jednostkowe / komponentowe (vitest)             | 1 763 plików, 34 927 testów, 70 007 asercji | logikę w TS/TSX, render komponentów, kontrakty modułów                                                                                                                                                          | zachowania bazy (RLS/RPC/triggery), realnych ścieżek przeglądarki, SSR end-to-end |
| Baza (pgTAP)                                    | 99 plików, 1 845 asercji                    | izolację tenanta, polityki RLS, kontrakty RPC, triggery                                                                                                                                                         | kodu frontu — v8 tego pokrycia NIE liczy                                          |
| E2E (Playwright)                                | 8 plików, 62 testów                         | ścieżki użytkownika, SSR, SEO, checkout                                                                                                                                                                         | pokrycia jednostkowego (osobny proces, nie wchodzi do %)                          |
| Bramki statyczne (`check:*`)                    | 35 skryptów                                 | kontrakty struktury (SQL, i18n, warstwy, bundle)                                                                                                                                                                | wykonania kodu                                                                    |
| **Uprząż replayu migracji** (`check:*-harness`) | 4 uprzęże, 1 433 asercji runtime            | że migracje DAJĄ SIĘ WYKONAĆ na czystym Postgresie i że schemat po nich zachowuje się tak, jak deklaruje: kolizje sygnatur, funkcje bez kolumn, triggery, które nie odpalają, `EXCLUDE`, które nic nie wyklucza | kodu frontu i produkcyjnych danych — powierzchnia poza modułem jest ATRAPĄ        |
| Inwarianty na ŻYWEJ bazie (vitest + sekrety)    | 2 pliki, 50 testów                          | zgodność schematu bazy z typami i parytet języków w DANYCH, nie w słownikach                                                                                                                                    | niczego bez sekretów — bez `VITE_SUPABASE_URL` pomijają się same                  |

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
| komponentowy (render + interakcja)         |    649 | 14 924 |  30 836 |     2,07 | że użytkownik to zobaczy: treść, stan wyłączony, komunikat błędu, reakcja na kliknięcie       | zachowania na prawdziwej przeglądarce i prawdziwych danych z bazy        |
| jednostkowy (czysta reguła)                |    764 | 11 399 |  21 861 |     1,92 | reguły w izolacji: wejście → wyjście, przypadki graniczne, gałęzie warunków                   | że reguła jest w ogóle wywołana przez aplikację (poprawnego okablowania) |
| warstwy danych (atrapa PostgREST)          |     75 |  3 038 |   5 726 |     1,88 | kształtu zapytania: filtry, kolejność ogniw, limit, zachowanie przy błędzie PostgREST         | że polityka RLS na serwerze przepuści to zapytanie                       |
| hooka (renderHook)                         |     87 |  1 991 |   4 008 |     2,01 | cyklu życia i unieważniania cache: kolejność efektów, sprzątanie, ponowne pobranie po mutacji | wyglądu; hook może być poprawny, a widok nadal pokazywać stare dane      |
| funkcji serwerowej                         |     93 |  1 769 |   3 694 |     2,09 | bramek wykonania: tenant, uprawnienia, rate limit, audyt, ścieżka błędu                       | że klient wywoła funkcję w odpowiednim momencie                          |
| dostępności (axe)                          |     41 |  1 351 |   3 039 |     2,25 | kontraktu dostępności: role, etykiety, kolejność fokusu, brak naruszeń axe                    | sensu treści dla czytnika ekranu (to ocenia człowiek)                    |
| bramki (meta-inwariant CI)                 |     26 |    262 |     436 |     1,66 | meta-inwariantu repo: że bramka istnieje, jest wpięta i coś sprawdza                          | zachowania kodu produkcyjnego                                            |
| parytetu (dwa artefakty muszą się zgadzać) |     20 |    139 |     294 |     2,12 | ZGODNOŚCI DWÓCH ARTEFAKTÓW (panel ⇄ renderer, snapshot ⇄ migracje, PL ⇄ EN)                   | poprawności żadnej ze stron osobno — tylko tego, że się nie rozjechały   |
| inwariantu (nie wolno złamać reguły)       |      4 |     39 |      83 |     2,13 | że reguła nie została złamana NIGDZIE w repo — skaluje się z kodem, nie z przypadkiem         | poprawności pojedynczej ścieżki użytkownika                              |
| dymny (czy w ogóle stoi)                   |      3 |     13 |      26 |     2,00 | że powierzchnia wstaje i nie rzuca przy montażu                                               | niczego o zachowaniu — to detektor katastrofy, nie dowód                 |
| integracyjny (wiele warstw)                |      1 |      2 |       4 |     2,00 | współpracy kilku warstw naraz na jednym scenariuszu                                           | izolowanej przyczyny awarii — po padnięciu trzeba szukać dalej           |

**Siedem wniosków, które wynikają z tej tabeli, a nie z procentów:**

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
6. **W tym wydaniu doszedł rodzaj, którego wcześniej w repo nie było: PARYTET STAŁYCH KLIENTA
   Z OGRANICZENIAMI `CHECK` BAZY.** Kolumny wyliczeniowe modułu wydarzeń są typu `text`
   z `CHECK (kolumna IN (...))`, więc typ generowany z bazy to `string` — kompilator NIGDY
   nie zobaczy, że panel oferuje wartość, której baza nie przyjmie. `dbEnumParity.test.ts`
   odtwarza dopuszczone wartości z łańcucha migracji i porównuje je ze stałymi klienta.
   Przy wdrożeniu złapał trzy rozjazdy naraz, w tym `PACKAGE_AUDIENCES`, gdzie **trzy z czterech
   opcji dialogu kończyły się naruszeniem ograniczenia**, a przebieg szczęśliwy działał tylko
   dlatego, że czwarta jest wartością domyślną. Nad każdą z tych list stał komentarz obiecujący
   „odwzorowanie jeden do jednego”. Ten rodzaj testu jest tani i przenośny — dowolny moduł
   z kolumnami `text` + `CHECK` może go skopiować.
7. **Bramka jest rodzajem testu — i ma najgorszy tryb awarii z całej listy.** Test jednostkowy,
   który padnie, zgłasza jedną regułę. Bramka, która padnie z powodu nieosiągalnego progu, kasuje
   sygnał ze WSZYSTKICH bramek stojących za nią w tym samym kroku CI — zmierzone na tym repo:
   60 przebiegów `main` bez zieleni i osiem bramek jako `skipped` (rozdz. 6.1). Rodzaj testu
   decyduje więc nie tylko o tym, CO zostaje dowiedzione, ale i o tym, co jeszcze przestaje być
   sprawdzane, kiedy ten jeden zawiedzie.

Do tego dochodzą rodzaje, których v8 nie widzi wcale: **pgTAP** (99 plików) dowodzi
polityk i triggerów, **Playwright** (8 plików) ścieżek użytkownika i realnego SSR,
a **bramki skryptowe `check:*`** (35) kontraktów strukturalnych, w których nie ma
kodu do wykonania — na przykład tego, że każda bramka jest wpięta w workflow.

### 7.2 Rejestr defektów: 171 wpisów — i moduł, który nie dopisał ani jednego

Rozdział 7.1 argumentuje teoretycznie, że rodzaj testu waży więcej niż liczba. Zamówione
zadania domykające dały do tego dowód empiryczny — i jednocześnie wytworzyły problem, który
był najważniejszą treścią wydania 5. To wydanie dokłada do niego kontrapunkt.

**Liczby, zmierzone niezależnie od raportów zespołu:** w repo jest dziś **171 wywołań `it.fails(`
w 94 plikach**, przy zerze `it.skip` i `it.todo`. W wydaniu 5 było ich 151 w 84 plikach,
w wydaniu 4 — 24 w 20. Przyrost tego wydania (+20) jest pierwszym, który NIE jest skokowy.

**Kontrapunkt: MODUŁ 22 ma ZERO wpisów `it.fails` — przy 151 plikach testowych i przeglądzie,
który wypisał 165 ustaleń, w tym siedem krytycznych.** To nie jest przeoczenie konwencji:
jeden z plików testowych modułu odwołuje się do niej wprost („defekt zgłaszamy przez `it.fails`,
a nie przykrywamy testem zatwierdzającym”). To jest inna decyzja — defekty tego modułu zostały
**naprawione**, a nie zapisane. Sprawdziłem to na kodzie, nie na opisach commitów, dla wszystkich
siedmiu ustaleń krytycznych przeglądu z 28.08:

| Ustalenie                                       | Stan na mierzonym HEAD                                                                                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **K-1** płatny bilet wydawany za darmo          | **zamknięte**: `event_register` w definicji `20260829071947` liczy cenę efektywną, ustawia `payment_status = 'unpaid'` przy cenie > 0 i wstrzymuje kod QR do potwierdzenia płatności |
| **K-2** pole zgody trwale blokuje zapis         | **zamknięte**: `event_registration_form` zwraca klucz `consents` (migracja `20260829071657`, komentarz w niej nazywa to „brakującą połową rozdziału”)                                |
| **K-3** anonim pobiera adres nagrania sesji     | **zamknięte**: `event_session_access` sprawdza `visibility` i `min_tier_rank` WYDARZENIA, nie tylko sesji                                                                            |
| **K-4** sześć zdarzeń odrzucanych przez `CHECK` | **zamknięte**: `20260828205000_domain_events_multi_segment_type.sql` rozluźnia wyrażenie do wielu członów                                                                            |
| **K-5** martwy dialog „Umów spotkanie”          | zamknięte, z bramką: `meetingParticipants.test.ts` + parytet stałych z bazą                                                                                                          |
| **K-6** kasowanie notatki sponsora              | zamknięte, z testem: `sponsorInternalNote.test.ts`                                                                                                                                   |
| **K-7** odbiorcy pakietu nie do zapisania       | zamknięte, z bramką: `dbEnumParity.test.ts` porównuje `PACKAGE_AUDIENCES` z `CHECK`-iem migracji                                                                                     |

Trzy z tych siedmiu zamknięto **bramką, nie łatką** — czyli tak, że ta sama klasa defektu nie
wróci. Dla porządku: nie twierdzę, że wszystkie 165 ustaleń jest zamkniętych; sprawdziłem
siedem krytycznych i cztery z nich w samym SQL-u. Pozostałe 158 mogą, ale nie muszą być.

**Wniosek, który wychodzi z zestawienia obu konwencji obok siebie.** Repozytorium ma dziś dwa
różne sposoby postępowania ze znalezionym defektem i oba są w nim jednocześnie: rejestr
`it.fails` (171 wpisów, rośnie, zielony w CI) i naprawa u źródła (moduł 22, zero wpisów).
Druga jest lepsza wszędzie tam, gdzie naprawa jest wykonalna w tym samym tygodniu — a przegląd
modułu wydarzeń pokazuje, że przy siedmiu defektach krytycznych po prostu była. Pierwsza
zostaje właściwa tylko dla tego, czego naprawić się nie da bez decyzji produktowej albo
migracji (jak `page_full_path` niżej). Różnica między jednym a drugim to nie technika, tylko
to, czy ktoś w ogóle podjął decyzję o naprawie.

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
tłem”. Wydanie 5 zastało 151, to wydanie 171. Przyrost zwolnił, ale kierunek się nie odwrócił,
a przez tydzień między wydaniami nie ubyło żadnego wpisu z pierwotnej dwudziestki czwórki.
Mechanizm jest przewidywalny i nie wymaga niczyjej złej woli:

1. `it.fails` przechodzi, dopóki defekt istnieje. Nic w CI nie naciska na naprawę.
2. Zapisanie defektu jest tanie i satysfakcjonujące, naprawa jest droga i wymaga decyzji.
3. Im więcej wpisów, tym mniejsza waga każdego — 171 pozycji to już nie lista, to tło.

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
| 3   | Silniki treści: bloki + page builder                 |          **5 051** |  76,40% |    71,70% |  4 962 |
| 22  | Wydarzenia: event builder, rejestracja, onsite       |          **4 270** |  58,96% |    55,25% |  2 907 |
| 7   | Typy treści specjalne                                |          **2 313** |  43,93% |    36,73% |    934 |
| 20  | Platforma / backend / infrastruktura / SSR           |          **2 244** |  74,73% |    67,44% |  4 489 |
| 17  | Analityka i BI                                       |          **2 080** |  32,88% |    28,41% |    199 |
| 13  | Monetyzacja: checkout / subskrypcje / billing        |          **1 850** |  65,62% |    75,58% |  1 605 |
| 9   | Czat / komunikator                                   |          **1 209** |  62,83% |    58,02% |    607 |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy |          **1 043** |  27,06% |    18,42% |     91 |
| 16  | Społeczność: kluby, komentarze, moderacja            |            **878** |  89,12% |    89,02% |  4 715 |
| 12  | Realtime / powiadomienia / web-push                  |            **601** |  49,54% |    47,46% |     99 |

### 8.1 Rekomendacje — kolejność, nie lista życzeń

**R1. Zatrzymać regresję na `main`, zanim zrobi się z niej nowa norma.**
Dziesięć czerwonych testów w `routes/__tests__/profileShellRoutes.test.tsx`, wszystkie z tym samym
komunikatem: `Found multiple elements with the text of: profile.sidebar.collapse`. Szuflada profilu
renderuje się dwa razy. Weszło to serią commitów o tytułach „Changes”, „Work in progress”
i „Przeniesiono szufladę profilu”, a próg `src/components/profile/**` — postawiony przy domykaniu
modułu 15 — złapał skutek: linie 91,58% wobec progu 93, gałęzie 83,08% wobec 89. Druga grupa progów,
`src/components/admin/billing/**`, jest przekroczona jeszcze mocniej (linie 88,30% wobec 97).

**Bramka zadziałała. Zawiodła reakcja na jej sygnał** — commity poszły na `main` mimo czerwieni.
Naprawa defektu jest jednodniowa (jedna zdublowana szuflada), ale ważniejsze jest to, co po niej:
dopóki czerwony `main` bywa akceptowalny, każdy próg w tym repozytorium jest opcjonalny. To jest
pozycja pierwsza nie ze względu na rozmiar, tylko dlatego, że dotyczy działania całego aparatu
opisanego w rozdziałach 6 i 7.

**R2. Rejestr `it.fails` — 171 wpisów w 94 plikach i nadal bez budżetu.**
Wydanie 4 zapisało: „zamienić 24 `it.fails` na naprawy, inaczej po miesiącu staną się tłem”.
Wydanie 5 zastało 151, to wydanie **171**. Przyrost zwolnił (+20 wobec +127), ale ani jeden wpis
z pierwotnej dwudziestki czwórki nie zniknął.

Rozwiązanie w idiomie tego repo, którego repo nadal nie użyło na sobie: **próg na liczbę `it.fails`,
który wolno wyłącznie OBNIŻAĆ** — dokładnie tak jak progi pokrycia wolno wyłącznie podnosić.
Skrypt `check:expected-fail-budget` z limitem zapisanym w configu (dziś 171) i regułą „nowy
`it.fails` wolno dodać tylko razem z obniżeniem limitu o tyle samo gdzie indziej”.

**Kontrprzykład, który pokazuje, że da się inaczej: MODUŁ 22 ma ZERO wpisów `it.fails`** przy 151
plikach testowych i przeglądzie, który wypisał 165 ustaleń, w tym siedem krytycznych. Wszystkie
siedem sprawdziłem w kodzie na mierzonym HEAD i wszystkie są zamknięte — trzy z nich **bramką**,
nie łatką (parytet stałych z `CHECK`-ami bazy, test notatki sponsora, test statusów spotkania).
Różnica między rejestrem a naprawą nie jest techniczna: to kwestia tego, czy ktoś podjął decyzję.

**R3. MODUŁ 22 — trzy konkretne miejsca, nie „podnieść moduł”.**
60,02% linii przy 357 plikach to dobry start, ale rozkład zer wskazuje trzy pozycje, których nie
zamyka się przy okazji:

1. **Rama studia** (`components/admin/events/studio`, 8 plików / 222 linie, funkcjonalność na 25,2%).
   Tu stoi bramka roli i bramka włączonych modułów dla **wszystkich 31 sekcji** panelu. Przegląd
   zespołu zapisał brak jej testu jako osobne ustalenie i ono nadal stoi. Najtańszy test o największym
   zasięgu w całym module.
2. **`src/lib/events/useScanner.ts`** — 127 zmierzonych linii na **0%**, największy pojedynczy
   plik-zero modułu. Warstwa danych aplikacji przy bramce: parowanie urządzenia, kolejka offline
   w IndexedDB, deduplikacja powtórnego wejścia. Komponenty skanera mają testy, e2e ma
   `scanner.spec.ts`, baza ma `EXCLUDE` przeciw podwójnemu wejściu — ale hook spinający te trzy
   warstwy nie wykonuje się w żadnym teście jednostkowym.
3. **„Analityka, komunikacja, integracje”** — cztery pliki, **0,0% linii i 0 z 9 funkcji**. Jedyna
   funkcjonalność w całym repozytorium na czystym zerze w obu wymiarach.

Do tego 34 organizmy panelu (1 198 linii bez pokrycia) jako główny dług objętościowy — ale one już
mają próg (`admin/events/organisms/**`), więc rosną w kontrolowany sposób.

**R4. MODUŁ 14 (kupony / darowizny / prezenty / reklamy) — SZÓSTE wydanie z rzędu na dnie.**
27,66% linii i **18,49% funkcji** (najniższy wymiar funkcyjny w repo), 12 z 38 plików na zerze,
**zero progów per-ścieżka**, 1 012 niepokrytych linii. Od 18 sierpnia ruszył o 5,1 pp łącznie,
czyli w tempie szumu, podczas gdy sześć innych modułów przeszło w tym czasie z kilkunastu procent
na ponad 90. To nie jest kwestia kolejki — to moduł, którego nikt nie wziął, mimo że jest
**najmniejszy z pozostałych** i mimo że kupon i darowizna to transakcja: kwota, waluta, limit
wykorzystań. Prompt modułowy dla niego jest napisany i czeka.

Zaraz za nim MODUŁ 17 (33,18%, **0,0 pp od wydania 5**, 46 z 85 plików na zerze) i MODUŁ 21
(55,12%, **0,0 pp we wszystkich sześciu wydaniach**, zero progów).

**R5. „Pusto” i „nie udało się wczytać” to jedna brakująca konwencja, nie 15 osobnych defektów.**
Bez zmian wobec wydania 5, bo nic się w tej sprawie nie wydarzyło. Wzorzec „awaria wygląda jak
pustka” ma co najmniej **15 niezależnych wystąpień w czterech modułach** (klasa dominująca raportu
modułu 19: 12 wystąpień w jednym module). Odczyt danych w tym repo nie ma jednego, wymuszonego
sposobu rozróżnienia tych dwóch stanów, więc każdy nowy widok odtwarza defekt od zera. Naprawa
jednostkowa piętnastu wystąpień nie zapobiega szesnastemu; naprawa konwencją — tak.

**R6. `page_full_path` — migracja schematu, nadal nietknięta.**
Sprawdzone ponownie na mierzonym HEAD: najnowsza definicja funkcji to wciąż rekurencyjne CTE idące
w górę po `pages.parent_id` **bez predykatu najemcy**, `LANGUAGE sql STABLE` (SECURITY INVOKER),
wołane spod service-role, więc bez RLS nad sobą. `pages.parent_id` ma wyłącznie
`REFERENCES public.pages(id)`, bez `CHECK`-a ani triggera „ten sam najemca”. **Żaden z 99 plików
pgTAP nadal nie wspomina tej funkcji.** Skutek bez zmian: strona z rodzicem u innego najemcy wnosi
JEGO slug do ścieżki kanonicznej publikowanej w sitemapie i RSS-ie.

Nowa okoliczność, która czyni tę pozycję łatwiejszą: repozytorium ma dziś **uprząż replayu migracji**
(cztery sztuki, 1 433 asercje runtime). Ta sama uprząż, która dowodzi ograniczeń `EXCLUDE` modułu
wydarzeń, jest właściwym miejscem na asercję „ścieżka strony nie przekracza granicy najemcy”.

**R7. Zregenerować snapshot autoryzacji — czerwień jest z PROWENIENCJI, nie z zawężenia uprawnień.**
`authzSnapshotParity` jest czerwony trzecie wydanie z rzędu, a rozjazd urósł: snapshot pochodzi ze
starszego skanu migracji, repozytorium ma ich dziś **917**. Naprawa to jedna komenda
(`bun run generate:authz-snapshot` i commit), ale **nie wolno jej wykonać odruchowo** — regeneracja
bez przeczytania raportu wag to mechanizm, którym ta bramka raz już umarła. Raport trzeba przeczytać
i sprawdzić, czy wśród wpisów nie ma ani jednego o **zawężeniu** kręgu uprawnionych; jeżeli są same
`[provenance]`, regeneruj.

**R8. Próg globalny nie drgnął pierwszy raz od trzech wydań.**
Config ma `64/58/62/65` (instrukcje/gałęzie/funkcje/linie), pomiar stoi ~10 pp wyżej. Progi
per-ścieżka rosły dalej (334 → **353**, w tym sześć nowych na ścieżkach wydarzeń), więc nawyk nie
zniknął — cofnął się tylko na poziomie globalnym. Zostawione tak na dłużej oznacza, że **globalna
zapadka przestaje cokolwiek łapać**: żeby ją przekroczyć w dół, repozytorium musiałoby stracić jedną
trzecią dzisiejszego pokrycia. Podnieść do zmierzonego minus ~4 pp, tą samą regułą co poprzednio.

**R9. Największa dziura bezwzględna: MODUŁ 3 i powłoka panelu.**
MODUŁ 3 ma **5 051** niepokrytych linii przy 76,40% (edytor bloków panelu), powłoka panelu admin
**2 763** przy 46,82% i **cztery** progi na 185 plikach. Nowy MODUŁ 22 wchodzi na drugie miejsce
tej listy z **4 087** liniami — ale w jego przypadku mówimy o kodzie, który powstał w tym tygodniu
i ma sześć progów, a nie o zaległości. Kolejność na następne zlecenia: `components/admin/blocks/**`
(reszta modułu 3, metoda znana i sprawdzona trzy razy), potem powłoka panelu jako całość.

**R10. E2E: osiem plików, 62 testy — i pierwszy raz z nową ścieżką sprzętową.**
Warstwa urosła z 7 plików / 54 testów na **8 / 62**, a nowy plik to `e2e/scanner.spec.ts` — odprawa
na miejscu, czyli jedyna ścieżka w tym produkcie, w której błąd zatrzymuje ludzi fizycznie przy
bramce. To właściwy kierunek. Co zostaje: **nadal nie ma pełnej ścieżki end-to-end dla klubów,
buildera, newslettera ani panelu ustawień**. Kolejne zlecenie modułowe powinno mieć e2e w zakresie
od początku, a nie jako etap ostatni.

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
| **wzorowo**       | 99,5 | 11. Newsletter i e-mail                                   | 99,5% |   99,4% |     73 |               6 |     0/148 |
| **wzorowo**       | 99,0 | 2. Edytor wpisów i workflow redakcyjny                    | 99,3% |   98,8% |     21 |               6 |     0/103 |
| **wzorowo**       | 98,8 | 18. CRM                                                   | 99,0% |   98,6% |      1 |               6 |      0/59 |
| **wzorowo**       | 96,1 | 6. Wyszukiwarka                                           | 97,4% |   95,2% |      8 |               5 |      0/25 |
| **wzorowo**       | 96,0 | 8. SEO, feedy, dane strukturalne                          | 96,7% |   95,6% |     20 |               6 |      5/77 |
| **wzorowo**       | 95,7 | 15. Profil i konto                                        | 97,5% |   94,4% |     40 |               7 |      2/94 |
| **wzorowo**       | 94,7 | 5. Strona główna, archiwa, chrome                         | 96,5% |   93,5% |      1 |               5 |      1/62 |
| **wzorowo**       | 91,2 | 19. Ustawienia / integracje / users / multi-tenant / RODO | 93,2% |   89,9% |     36 |               7 |    14/131 |
| **wzorowo**       | 90,3 | 4. Strony, wygląd, motyw, media, import                   | 92,3% |   88,9% |      2 |               6 |     4/133 |
| **dobrze**        | 89,1 | 16. Społeczność: kluby, komentarze, moderacja             | 89,1% |   89,0% |     11 |               8 |    16/306 |
| **dobrze**        | 82,9 | 1. Wpisy: doświadczenie czytelnika                        | 84,4% |   82,0% |     27 |               4 |    13/104 |
| **dobrze**        | 81,3 | 10. Sieć / networking                                     | 82,0% |   80,9% |      2 |               4 |      3/32 |
| **przeciętnie**   | 74,9 | design system (components/ui)                             | 79,9% |   71,5% |      0 |               1 |      4/43 |
| **przeciętnie**   | 73,6 | 3. Silniki treści: bloki + page builder                   | 76,4% |   71,7% |     18 |               7 |    67/458 |
| **przeciętnie**   | 72,8 | słowniki i18n                                             | 93,1% |   59,2% |      0 |               2 |     1/134 |
| **przeciętnie**   | 71,6 | 13. Monetyzacja: checkout / subskrypcje / billing         | 65,6% |   75,6% |     21 |               7 |    35/190 |
| **przeciętnie**   | 70,4 | 20. Platforma / backend / infrastruktura / SSR            | 74,7% |   67,4% |     44 |               7 |    47/199 |
| **przeciętnie**   | 59,9 | 9. Czat / komunikator                                     | 62,8% |   58,0% |      9 |               3 |     14/81 |
| **przeciętnie**   | 56,7 | 22. Wydarzenia: event builder, rejestracja, onsite        | 59,0% |   55,2% |      6 |               7 |   144/362 |
| **źle**           | 50,3 | 21. Rekrutacja / kariera                                  | 55,1% |   47,1% |      0 |               2 |     12/29 |
| **źle**           | 48,3 | 12. Realtime / powiadomienia / web-push                   | 49,5% |   47,5% |      0 |               3 |     12/28 |
| **źle**           | 44,5 | powłoka panelu admin + atomy/molekuły                     | 47,9% |   42,3% |      0 |               4 |    33/183 |
| **źle**           | 39,6 | 7. Typy treści specjalne                                  | 43,9% |   36,7% |      1 |               6 |     37/95 |
| **beznadziejnie** | 30,2 | 17. Analityka i BI                                        | 32,9% |   28,4% |      8 |               3 |     47/86 |
| **beznadziejnie** | 21,9 | 14. Monetyzacja: kupony / darowizny / prezenty / reklamy  | 27,1% |   18,4% |      0 |               2 |     13/39 |

Rozkład: **9** wzorowo · **3** dobrze · **7** przeciętnie · **4** źle · **2** beznadziejnie.

**Ocena całości: PRZECIĘTNIE — przy górnej krawędzi tej oceny, drugie wydanie z rzędu.**
Baza dla całego repo liczona tą samą rubryką: **72,9** — po 53,4 w wydaniu 3, 65,7
w wydaniu 4 i 73,4 w wydaniu 5. Do progu „dobrze” (75) brakuje dwóch punktów, a różnica
wobec poprzedniego wydania jest w całości **kosztem wejścia nowego modułu**. Liczby
są jednoznaczne: mierzonych linii przybyło 10 555, z czego **10 405 to moduł 22** — czyli
cały przyrost kodu w tym tygodniu to w praktyce wydarzenia. Ten kod ma 58,96% pokrycia, więc
średnia musiała drgnąć w dół. **Bez modułu 22 ta sama rubryka daje dziś 74,9 zamiast 72,9**,
czyli poprawę o 1,5 punktu wobec 73,4 z wydania 5, nie spadek. Podaję obie liczby, bo obie są prawdziwe i mierzą
co innego: jedna stan aplikacji dziś, druga to, co zrobiono z powierzchniami, które już były.
Rozbijam to na pięć osobnych ocen, bo jedna liczba tego nie opisuje:

1. **Poziom pokrycia — PIERWSZY warunek „dobrze” spełniony, drugi nie.** 74,94% linii
   i 71,54% funkcji na 3 201 plikach produkcyjnych. W wydaniu 3 postawiłem próg: za „dobrze”
   uznam **75%+ linii przy żadnym module poniżej 60%**. Linie: 74,94% — spełnione. Modułów poniżej
   60% jest 7: M22 (59,0%), M21 (55,1%), M12 (49,5%), powłoka panelu admin + atomy/molekuły (47,9%), M7 (43,9%), M17 (32,9%), M14 (27,1%).
   Dlatego ocena zostaje „przeciętnie”. Warto jednak zobaczyć, jak zmienił się skład tej listy:
   w wydaniu 5 było na niej sześć modułów, dziś jest ich 7 — bo doszedł nowy moduł 22
   (60,02%, czyli tuż nad krawędzią) i nie ubył żaden z poprzednich. **Ani jeden z sześciu
   modułów poniżej 60% z wydania 5 nie przekroczył tej granicy w ciągu tygodnia**, w którym
   powstało 212 nowych plików testowych. Cała praca poszła w newsletter (który był już
   na 81%) i w nowy moduł. To jest treść, nie zarzut: kolejka istnieje i jest przestrzegana,
   ale najsłabsze powierzchnie w niej nie stoją.
2. **Rozkład — pierwszy raz w tej historii wygląda dobrze.** 6 z 25 powierzchni ma ocenę „źle”
   albo „beznadziejnie” — po 12 z 24 w wydaniu 3, 10 w wydaniu 4 i 6 w wydaniu 5. „Beznadziejnie”
   stoi na 2 (MODUŁ 14 i 17, te same co poprzednio), a „wzorowo” urosło do 9 — o jeden,
   bo MODUŁ 11 (newsletter) przeszedł z „dobrze” (82,2) na 99,5, czyli najwyższy wynik w repo.
   Nowy MODUŁ 22 wchodzi od razu jako „przeciętnie” (57,5), co dla modułu w wieku jednego tygodnia
   jest wynikiem lepszym niż start CMS buildera (24%), klubów (25,8%) i modułu 19 (25,2).
   Model „jedno zlecenie = jedna powierzchnia, jawny cel, próg na końcu” zadziałał siódmy raz
   z rzędu, ale **po raz pierwszy zadziałał też PROFILAKTYCZNIE**: moduł 22 nie musiał być
   ratowany, bo testy pisano razem z nim.
3. **Uczciwość pomiaru — dobrze, miejscami wzorowo.** `all: true` na całym `src/`, pliki bez testów
   w mianowniku, zero whitelistu. To repo ma za sobą epizod raportowania **98%** z 38 plików
   z pętlami renderującymi bez asercji — i sam ten epizod usunęło. Gęstość asercji
   2,00 na test, stabilna w każdym rodzaju testu, potwierdza, że dzisiejsze liczby nie są farmione.
4. **Infrastruktura dowodu — wzorowo.** 353 progów per-ścieżka, 35 bramek `check:*`
   (w tym META-bramka „bramka, która istnieje, musi się uruchamiać”), 99 plików pgTAP
   z 1 845 asercjami na RLS i RPC, klasyfikacja testów na jedenaście rodzajów — a w tym wydaniu
   dochodzi **szósta warstwa dowodu**: cztery uprzęże replayu migracji (`check:*-harness`) z 1 433
   asercjami runtime, z czego 1 001 w uprzęży wydarzeń. Ona sprawdza rzecz, której nie sprawdza
   żadna z pozostałych pięciu: czy migracje DAJĄ SIĘ WYKONAĆ na czystej bazie i czy schemat po
   nich zachowuje się tak, jak deklaruje — kolizje sygnatur, funkcje odwołujące się do nieistniejących
   kolumn, triggery, które nie odpalają, `EXCLUDE`, które nic nie wyklucza. Uprząż wydarzeń dobiera
   migracje **po treści, a nie po nazwie pliku**, co jest bezpośrednią odpowiedzią na kształt
   historii migracji w tym repo (prawie każda funkcja ma dwie definicje, a obowiązująca jest
   w pliku z UUID-em). Większość projektów tej wielkości nie ma nawet połowy tego aparatu.
5. **Zabezpieczenie dorobku — POPRAWIONE, ale niedokończone.** Próg globalny stoi
   9,9 pp pod pomiarem na liniach — tyle pokrycia można stracić, nie łamiąc progu globalnego.
   Bez ANI JEDNEGO progu per-ścieżka jest 6 z 25 powierzchni: design system (components/ui) (79,9%), słowniki i18n (93,1%), MODUŁ 21 (55,1%), MODUŁ 12 (49,5%), powłoka panelu admin + atomy/molekuły (47,9%), MODUŁ 14 (27,1%).
   Najgroźniejsza z nich to powłoka panelu admina: 185 plików, 46,82% linii, zero progów —
   jedyna duża powierzchnia, która nigdy nie dostała ani zadania, ani zapadki, i która rośnie
   przy każdej ekstrakcji z tras.
   Druga rzecz jest w tym wydaniu odwrotna niż w poprzednim i warto to wyraźnie powiedzieć:
   **żaden próg nie jest dziś wpisany nad zmierzone.** Bramka wychodzi kodem 1, bo dwie grupy
   progów złapały REGRESJĘ (`components/profile/**` i `components/admin/billing/**`), a nie
   dlatego, że ktoś postawił aspirację zamiast pomiaru. Trzecia: **próg globalny nie drgnął
   pierwszy raz od trzech wydań** i stoi ~10 pp pod pomiarem — czyli globalna zapadka
   przestała cokolwiek łapać, a całą robotę wykonują progi per-ścieżka. Mechanizm w rozdz. 6.1.

**Trajektoria zasługuje na osobne zdanie: super.** 32,71% → 74,94% linii w jedenaście dni, przy suicie
rosnącej z 817 do 1 763 plików i z ~8,3 tys. do 46 409 testów, to nie jest normalne tempo.
Dwanaście modułów przeszło z kilkunastu procent do ponad 80: edytor **+91,0 pp**, CRM +87,0, chrome
+79,8, profil i konto +77,0, **newsletter +72,8**, kluby +71,4, ustawienia i RODO +71,2, wygląd/media
+69,6, wyszukiwarka +64,2, SEO +46,3, bloki i builder +36,4, billing +32,9.

Do tego dochodzi rzecz, której poprzednie wydania nie mogły pokazać, bo nie było czego mierzyć:
**moduł zbudowany od zera przy włączonym reżimie testowym wchodzi na 60%, a nie na 25%.** Wszystkie
wcześniejsze duże powierzchnie tego repozytorium — builder, kluby, ustawienia, platforma —
startowały z przedziału 24–28% i wymagały osobnego, kosztownego zadania ratunkowego. Moduł 22
nie wymagał żadnego. Jeżeli ten dokument ma jedną rekomendację długoterminową, to nie jest nią
żadna z pozycji 8.1, tylko ta obserwacja: **taniej jest utrzymać reżim niż go później odtwarzać.**
Ocena „przeciętnie” dotyczy STANU, nie pracy — i przy tym tempie decyduje już wyłącznie kolejność,
w jakiej bierze się pozostałe powierzchnie. Rozdział 8.1 podaje tę kolejność.

**Zastrzeżenia per moduł — tam, gdzie sama liczba kłamie albo jest niepełna:**

- **MODUŁ 11** (wzorowo, baza 99,5) — WZOROWO I DOMKNIĘTE DO ZERA: 99,53% linii, 99,43% funkcji, **zero plików bez pokrycia ze 147** — pierwszy taki moduł w tym repozytorium. Wejście: 81,47% i 29 plików na zerze. Zadanie było zamówione promptem modułowym, którego pierwszym etapem była warstwa tłumień (`suppression`) — nie dlatego, że miała najniższy procent, tylko dlatego, że maila nie da się wycofać, a martwe tłumienia psują reputację domeny i przestaje dochodzić poczta transakcyjna, w tym reset hasła. Efekt: 65 progów per-ścieżka, najwięcej w repo. To jest dziś wzorzec do kopiowania, a nie moduł 2.
- **MODUŁ 2** (wzorowo, baza 99,0) — wzorowo i UTRWALONE: 21 progów per-ścieżka pilnuje tego poziomu, więc jedna zmiana go nie zdejmie. Wzorzec do kopiowania w pozostałych modułach.
- **MODUŁ 18** (wzorowo, baza 98,8) — wzorowo, ale BEZ ZAPORY: 98,98% linii chroni jeden próg per-ścieżka. Ten poziom powstał w ciągu dwóch dni i jeden PR bez testów może go zdjąć, nie łamiąc żadnej bramki.
- **MODUŁ 6** (wzorowo, baza 96,1) — wzorowo, przy czym ranking i operatory dowodzi pgTAP (9 plików) — to przykład powierzchni, na której wysoki procent jednostkowy i mocna warstwa bazy zgadzają się co do wniosku.
- **MODUŁ 8** (wzorowo, baza 96,0) — +40,6 pp (56,08% → 96,64%), funkcje 53,25% → 95,58%, progi 2 → 20. Zadanie zostało wykonane z CELEM RÓŻNICOWANYM, o który prosiłem: praca poszła w panel SEO admina (7 z 9 plików było na 0–3%), udostępnianie i gałęzie generatorów, a trasy feedów zostały świadomie w spokoju, bo dowodzi ich `e2e/seo.spec.ts`. To jedyny moduł w tej historii, w którym płaski cel 95/93 byłby błędem — i nie został postawiony.
- **MODUŁ 15** (wzorowo, baza 95,7) — wzorowo, ale PIERWSZY W TEJ SERII PRZYPADEK REGRESJI: 97,42% → 96,15% linii, 94,48% → 92,92% funkcji. Nie jest to dylucja — to dziesięć czerwonych testów w jednym pliku (`profileShellRoutes`) mówiących to samo: szuflada profilu renderuje się DWA RAZY. Weszło serią commitów „Changes” / „Work in progress” / „Przeniesiono szufladę profilu”. **I to jest dobra wiadomość o module, nie zła:** próg `src/components/profile/**`, postawiony przy domykaniu w wydaniu 5, złapał regresję w tym samym tygodniu, w którym powstała (linie 91,58% wobec progu 93). Moduł, który rok temu nie miał progu, dziś nie przepuszcza cichego zepsucia. Do naprawy zostaje sam defekt, nie system.
- **MODUŁ 5** (wzorowo, baza 94,7) — wzorowo DZIŚ, bez gwarancji na jutro: ani jednego progu per-ścieżka na powierzchni obecnej na każdej stronie serwisu. Chrome z 96,15% i bez zapory to dorobek pożyczony.
- **MODUŁ 19** (wzorowo, baza 91,2) — NAJWIĘKSZY SKOK POJEDYNCZEGO MODUŁU W CAŁEJ HISTORII TEGO AUDYTU: 27,98% → 93,08% linii (+65,1 pp), funkcje 23,35% → 89,84%, plików na zerze 56 → 15, progi 8 → 36. Trzynaście powierzchni domkniętych do 95%+, 36 defektów zapisanych. Ocena z „beznadziejnie” (25,2) na „wzorowo” (91,1) w jednym zadaniu. To jest dowód, że model „jedno zlecenie = jedna powierzchnia, jawny cel, próg na końcu” działa nawet na powierzchni, która przez cztery wydania stała w miejscu.
- **MODUŁ 4** (wzorowo, baza 90,3) — wzorowo bez zapory (zero progów). Połowa tego pokrycia to czysta matematyka kadrowania i tokenów motywu — najtańszy dowód o największym zasięgu, i najłatwiejszy do utracenia bez progu.
- **MODUŁ 16** (dobrze, baza 89,1) — domknięte w wydaniu 4 i STABILNE: 85,92% linii, 85,79% funkcji, −0,2 pp (dylucja od nowego kodu, nie regresja testów). Kluby właściwe stoją po ~97%, a 22 pozostałe zera to społeczność (`admin.community.qa`, `events`, `polls`, `badges`, bilety) — część, która była poza zakresem tamtego zadania. Mianownik urósł z 252 na 317 plików, bo 28 modułów reguł wyszło z JSX-a.
- **MODUŁ 1** (dobrze, baza 82,9) — dobrze, z zastrzeżeniem rodzaju: reguły paywalla i meteringu mają testy i progi, ale to, co czytelnik widzi, dowodzi się renderem — a 13 z 86 plików nie wykonuje ani jednej linii.
- **MODUŁ 10** (dobrze, baza 81,3) — dobrze i spójnie: warstwa danych jest RPC-only i objęta progiem 95/98, więc moduł nie dryfuje między wydaniami. 3 pliki na zerze z 32 to najlepszy wynik w tej klasie.
- **design system (components/ui)** (przeciętnie, baza 74,9) — procent zaniża wartość tej powierzchni: jeden test kontraktu atomu (rola, etykieta, stan wyłączony) chroni każde jego użycie w repo, a plików na zerze zostało 4 ze 43. Ale wciąż tylko JEDEN rodzaj testu (komponentowy) i ZERO progów per-ścieżka — przy 43 plikach, z których korzysta cała aplikacja.
- **MODUŁ 3** (przeciętnie, baza 73,6) — +23,3 pp (52,34% → 75,66%), funkcje 38,73% → 70,94%, zera 120 → 72 — ale NADAL największa bezwzględna dziura systemu: 5 195 niepokrytych linii. Sześć powierzchni buildera domknięto do 95/93 (panele widgetów 97,34% linii, publiczny render bloków 97,85%, rdzeń silnika 99,41%), więc to, co zostało, jest skoncentrowane i nazwane: **edytor bloków w panelu** (`components/admin/blocks/**` — `BlockCanvas` 218 LOC, `edit/Paragraph` 167, `NestedBlocksEditor` 107, `SortableBlockItem` 93, `edit/Heading` 92, `useBlockClipboard` 77, wszystkie na zerze) oraz DRUGA ścieżka importu WordPressa. Ta druga jest najciekawszym znaleziskiem tego wydania i opisuję ją osobno niżej.
- **słowniki i18n** (przeciętnie, baza 72,8) — TA LICZBA NIE PODLEGA OCENIE PROCENTEM. 92,49% linii przy 55,03% funkcji to artefakt zaimportowania obiektu — słowniki nie mają logiki, więc „pokryta linia” nic tu nie dowodzi. Jedynym sensownym dowodem jest bramka parytetu PL/EN i cztery `check:i18n-*`. Te istnieją i działają, więc powierzchnia jest zabezpieczona DOBRZE, mimo że jej procent jest bez treści.
- **MODUŁ 13** (przeciętnie, baza 71,6) — CZYTAĆ ODWROTNIE, NIŻ WYGLĄDA: funkcje (76,36%) są wyżej niż linie (66,32%), co znaczy, że ścieżka płatność → dostęp ma testy funkcji serwerowych z wysokimi progami, a nietestowana jest powłoka UI. To właściwa kolejność priorytetów — dowód jest tam, gdzie idą pieniądze. Ale rezygnacja i zmiana planu to interfejs: UI może pokazać „anulowano”, gdy żądanie padło, i żaden test serwerowy tego nie zauważy.
- **MODUŁ 20** (przeciętnie, baza 70,4) — +20,3 pp (55,12% → 75,45%), funkcje 42,82% → 68,03%, progi 11 → 43. Raport wdrożenia sam mówi w pierwszym akapicie, że cel modułowy 88/85 NIE został osiągnięty — i to jest właściwe raportowanie, nie porażka: jedenaście powierzchni na celu, trzy pod celem tylko na gałęziach nieosiągalnych, dwie trasy świadomie nietknięte jako „render, nie decyzja”. Zamówiona bramka zakresu najemcy znalazła defekt schematu w SQL-u (`page_full_path`), którego nie widziało 98 plików pgTAP. Zostaje 2 128 niepokrytych linii i 43 z 191 plików na zerze.
- **MODUŁ 9** (przeciętnie, baza 59,9) — przeciętnie, ale to najlepszy przykład skutecznej metody w tym repo: mieszanka testu warstwy danych z atrapą łańcucha PostgREST, testu hooka i testu reguł wątku wyciągnęła moduł z 17% na obecny poziom. Nie liczba testów to zrobiła, a dobór rodzaju.
- **MODUŁ 22** (przeciętnie, baza 56,7) — OCENA OSOBNA, BO TO INNY PRZYPADEK NIŻ WSZYSTKIE POZOSTAŁE. 58,96% linii i 55,25% funkcji daje „przeciętnie” — i ta etykieta jest myląca w obie strony. W GÓRĘ: to moduł, który POWSTAŁ między wydaniem 5 a 6, w rozmiarze 362 plików i 3 935 funkcji, i wszedł z pokryciem wyższym niż CMS builder (24%), kluby (25,8%) czy moduł 19 (27,98%) miały po miesiącach istnienia. Testy pisano RÓWNOLEGLE z kodem: 151 plików testowych, 4 tysiące przypadków, sześć progów per-ścieżka od pierwszego dnia i własna uprząż replayu migracji z 1 001 asercjami runtime — warstwa dowodu, której nie ma żaden inny moduł w tym repo. W DÓŁ: 144 pliki na zerze to najwyższa liczba w repozytorium, a rozkład tych zer jest wymowny. 34 organizmy panelu (1 198 linii) to prawdziwy dług; 66 tras na zerze to tylko 384 linie łącznie, bo trasy studia są celowo cienkie, a czternaście z nich to czyste przekierowania. Najgorsza pojedyncza pozycja: `src/lib/events/useScanner.ts` — 127 linii, 0%, warstwa danych aplikacji skanera przy bramce. CO NAPRAWDĘ NIEPOKOI, to nie procent, a JEDNA konkretna funkcjonalność: rama studia (25,2% linii, 18 z 28 plików na zerze). To jedyne miejsce, w którym stoi bramka roli i bramka modułów dla 38 tras studia — a przegląd zespołu zapisał brak jej testu jako osobne ustalenie. Druga: „analityka, komunikacja, integracje” — cztery pliki, 0,0%, zero funkcji wywołanych. Werdykt: **jak na moduł w tym wieku — bardzo dobrze; jak na moduł obsługujący wejście na teren, cennik i dane osobowe uczestników — jeszcze nie skończone.**
- **MODUŁ 21** (źle, baza 50,3) — źle i bez zapory, przy najczęściej wypełnianym formularzu przez osoby z zewnątrz — i **0,0 pp ruchu we wszystkich pięciu wydaniach**, jedyny taki moduł w repo. 55,12% linii, 47,13% funkcji, 12 z 29 plików na zerze, zero progów. Jedyna pociecha: bramka `check:careers-harness` istnieje, bo złamany CHECK w bazie już raz przeszedł przy zielonym CI.
- **MODUŁ 12** (źle, baza 48,3) — źle i mylące: bez atrapy kanału test dowodzi tylko, że subskrypcja została utworzona, i przechodzi przy PUSTYM handlerze zdarzenia. Na tej powierzchni procent może rosnąć bez wzrostu dowodu — zero progów per-ścieżka tego nie wyłapie.
- **powłoka panelu admin + atomy/molekuły** (źle, baza 44,5) — źle i to jest dług architektoniczny, nie testowy — a teraz także NAJWIĘKSZA duża powierzchnia bez własnego zadania: 41,06% linii, 2 915 niepokrytych linii, 34 z 172 plików na zerze i ZERO progów per-ścieżka. Rośnie przy każdej ekstrakcji z tras, bo catch-all `^src/components/` łapie wszystko, czego nie złapał wcześniejszy wzorzec (w tym wydaniu poprawiłem trzy takie przypisania — rozdz. 9.1). Wartość pracy tutaj mierzy się nie procentem, a tym, ile powtórzeń JSX-a udało się zamknąć w jednym testowanym atomie.
- **MODUŁ 7** (źle, baza 39,6) — źle przy ośmiu różnych typach treści dzielących jeden wzorzec: reguły domenowe mają testy, funkcje serwerowe i loadery nie. Rezerwacja miejsc jest tu przypadkiem skrajnym — baza pilnuje kolejki, aplikacja może nigdy o wolne miejsce nie zapytać.
- **MODUŁ 17** (beznadziejnie, baza 30,2) — beznadziejnie i po tych pięciu dniach RELATYWNIE najgorzej: 33,20% linii, 28,49% funkcji, 46 z 85 plików na zerze, +2,7 pp. Ratuje sens jedna rzecz — warstwa semantyczna analityki jest pokryta w 100% i objęta progiem, a od niej zależy KAŻDA liczba w raporcie zarządczym. Reszta to widoki i wykresy, gdzie brakuje testów a11y: wykres bez alternatywy tekstowej jest dla części odbiorców pustym prostokątem. Drugi w kolejce po module 14.
- **MODUŁ 14** (beznadziejnie, baza 21,9) — BEZNADZIEJNIE, PIĄTE WYDANIE Z RZĘDU: 27,10% linii, 17,93% funkcji (najniższy wymiar funkcyjny w repo), 13 z 38 plików na zerze, ZERO progów per-ścieżka. Od 18 sierpnia +4,5 pp, czyli tempo szumu, podczas gdy pięć innych modułów przeszło w tym czasie z kilkunastu procent na ponad 90. To już nie kwestia kolejki: moduł jest NAJMNIEJSZY z pozostałych (1 009 niepokrytych linii, jedna piąta długu modułu 3), a kupon i darowizna to transakcja — kwota, waluta, limit wykorzystań.

**Jedno zdanie, gdyby trzeba było wybrać jedno.** W wydaniu 5 napisałem, że pytanie nie brzmi już
„czy da się”, tylko „w jakiej kolejności”. To wydanie dokłada do tego drugie pytanie i ono jest
dziś ważniejsze: **czy reżim, który zadziałał przy budowie modułu wydarzeń, obowiązuje też poza
nim.** Bo w tym samym tygodniu, w którym 357 nowych plików weszło z pokryciem 60% i sześcioma
progami, seria commitów nazwanych „Changes” i „Work in progress” zdublowała szufladę profilu
i zostawiła na `main` dziesięć czerwonych testów. Jedno i drugie jest w tym samym repozytorium,
w tym samym tygodniu. Aparat dowodowy jest już zbudowany — brakuje wyłącznie tego, żeby stosował
się wszędzie tak samo.

---

## 9. Załączniki

### 9.1 Reguły mapowania plik → moduł

Mapowanie jest deterministyczne (pierwsze trafienie wygrywa) i w całości oparte na ścieżkach.
Wzorce w kolejności stosowania, per moduł:

**ZMIANA MAPY W TYM WYDANIU: nowy MODUŁ 22 (wydarzenia), wydzielony z 07 i 16.**

Do wydania 5 `src/lib/events/` i `src/components/events/` wpadały do modułu 7 („typy treści
specjalnych”), panel `src/components/admin/events/` nie miał żadnej reguły i lądował
w catch-allu X-shell, a trasa `/scanner` w łapaczu tras modułu 20. Przy 27 plikach to było
do obrony. Przy 357 przestało być: moduł 7 mierzyłby w większości wydarzenia, a nie trackery
i podcasty, a największa powierzchnia panelu w repo byłaby liczona jako „powłoka admina”.

Reguły dodane (przed wszystkimi pozostałymi, bo pierwsze trafienie wygrywa): `src/lib/events/`,
`src/components/events/`, `src/components/admin/events/`, `src/routes/admin.events*`,
`src/routes/events*`, `src/routes/meetings.`, `src/routes/scanner`, `src/routes/profile.events`,
`src/routes/club.$clubSlug.e.`, `src/routes/admin.community.events`, oraz cztery pliki starej
powierzchni „community events”, które nadal obsługują wydarzenia (`EventTicketPurchase`,
`EventTicketCard`, `ticketDocument`, `EventsListSkeleton`) i dwa dialogi prelegentów
(`EventSpeakersManager`, `EventSpeakerCreateDialog`). Z łapacza tras modułu 7 usunąłem człon
`event`. Kontrola: 357 plików produkcyjnych trafia do modułu 22, **zero plików wydarzeń
zostaje poza nim i zero plików spoza wydarzeń wchodzi do środka** (weryfikacja skryptem, nie
przeglądem).

**Skutek dla porównywalności — i co z tym zrobiłem.** Zmiana mapy dotyka DWÓCH wierszy poza
nowym modułem: moduł 7 traci 20 plików, moduł 16 traci 7. Gdyby porównać liczby opublikowane
w wydaniu 5 z dzisiejszymi, moduł 7 „spadłby” o 1,25 pp, a moduł 16 „urósł” o 3,02 pp —
obie liczby byłyby wyłącznie efektem przesunięcia granicy. Dlatego **przeliczyłem cały przebieg
wydania 5 nową mapą** (ten sam `coverage-summary.json`, inne reguły przypisania) i rozdział 2.1
porównuje wydanie 6 z tak przeliczonym wydaniem 5. Po przeliczeniu oba wiersze stoją w miejscu:
moduł 7 43,56% → 43,59%, moduł 16 88,96% → 88,92%. Pozostałe dwadzieścia trzy wiersze są
porównywalne bez zastrzeżeń, bo ich reguł nie tknąłem.

**Skutek uboczny, który wyszedł przy okazji i też go zgłaszam.** Człon `event` w łapaczu tras
modułu 7 ściągał do niego trzy trasy, które wydarzeniami nie są: `api/public/popup-event.ts`
(popup newslettera), `api/public/experiment-event.ts` (eksperymenty A/B) i `api/public/ad-event.ts`
(beacon impresji reklamowych). Po wyjęciu członu spadłyby do łapacza tras modułu 20, czyli
z jednego przypadkowego miejsca do drugiego. Dostały więc reguły własne: **popup → MODUŁ 11,
eksperymenty → MODUŁ 17, beacon reklamowy → MODUŁ 14**. To trzy pliki i ~60 linii, więc na
procenty nie wpływa, ale `ad-event.ts` jest jedynym publicznym punktem wejścia danych
o wyświetleniach reklam i liczenie go w „typach treści specjalnych” było po prostu błędem.

Korekta z wydania 5 (przeniesienie `components/home`, `components/readingList`,
`components/people` z X-shell do modułów 5, 1 i 15) pozostaje w mocy i nie była zmieniana.

| #   | Moduł                                                 | Wzorce ścieżek                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Wpisy: doświadczenie czytelnika                       | `^src\/lib\/access\/`, `^src\/lib\/toc\/`, `^src\/lib\/footnotes`, `^src\/lib\/manualToc`, `^src\/lib\/keyTakeaways\/`, `^src\/lib\/citations\/`, `^src\/lib\/audio\/`, `^src\/lib\/readingTime`, `^src\/lib\/postLayouts`, `^src\/lib\/relatedPosts`, `^src\/lib\/relatedInsights`, `^src\/lib\/relatedClickBeacon`, `^src\/components\/post\/`, `^src\/components\/PostLayoutRenderer`, `^src\/components\/Paywall`, `^src\/components\/author\/`, `^src\/components\/audio\/`, `^src\/components\/molecules\/MeterBanner`, `^src\/components\/atoms\/QuotaMeter`, `^src\/hooks\/(useContentAccess                                                                                                                                                                                                                                              | useUnlockedContent                                           | usePasswordUnlock                                           | useRecordPostView                                   | useSaveArticle                        | useBookmarks                     | useReadingTimeSettings                                                        | usePostLayoutSettings                        | useRecommendedPosts)`, `^src\/components\/readingList\/`, `^src\/routes\/post\.`, `^src\/routes\/preview\.`, `^src\/routes\/admin\.(key-takeaways | toc           | post-layouts | related-posts)`, `^src\/routes\/api\/public\/(post-tts | related-click)`, `^src\/routes\/api\/(tts | stt)` |
| 2   | Edytor wpisów i workflow redakcyjny                   | `^src\/components\/admin\/post-editor\/`, `^src\/components\/admin\/versions\/`, `^src\/components\/admin\/workflows\/`, `^src\/lib\/revisions`, `^src\/lib\/posts-migrate`, `^src\/hooks\/useAutosave`, `^src\/hooks\/useEditPresence`, `^src\/hooks\/useHistory`, `^src\/hooks\/useUnsavedChangesGuard`, `^src\/lib\/unsavedChanges`, `^src\/routes\/admin\.(posts                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | scheduler                                                    | calendar)`, `^src\/routes\/admin\.(versions                 | workflows                                           | redirects                             | import-wordpress                 | contributors)`, `^src\/components\/admin\/(PostEditor                         | PostGeneralOverview)`                        |
| 3   | Silniki treści: bloki + page builder                  | `^src\/lib\/blocks\/`, `^src\/lib\/builder\/`, `^src\/lib\/content\/`, `^src\/lib\/content-model\/`, `^src\/lib\/sidebarBuilder\/`, `^src\/lib\/patterns\/`, `^src\/lib\/wp-import`, `^src\/lib\/wordpress-import`, `^src\/lib\/sanitize`, `^src\/lib\/content\.functions`, `^src\/components\/blocks\/`, `^src\/components\/builder\/`, `^src\/components\/patterns\/`, `^src\/components\/content\/`, `^src\/components\/admin\/blocks\/`, `^src\/components\/admin\/builder\/`, `^src\/components\/admin\/sidebarBuilder\/`                                                                                                                                                                                                                                                                                                                    |
| 4   | Strony, wygląd, motyw, media, import                  | `^src\/lib\/theme\/`, `^src\/lib\/media`, `^src\/lib\/layout\/`, `^src\/lib\/pageTemplates`, `^src\/lib\/archive-layout-settings`, `^src\/lib\/expertLayouts`, `^src\/lib\/cropSizes`, `^src\/lib\/cardImageSizes`, `^src\/lib\/brand`, `^src\/lib\/icons\/`, `^src\/lib\/icon`, `^src\/components\/media\/`, `^src\/components\/theme\/`, `^src\/components\/icons\/`, `^src\/components\/pages\/`, `^src\/components\/admin\/media\/`, `^src\/components\/admin\/theme-design\/`, `^src\/components\/admin\/archiveLayout\/`, `^src\/hooks\/(useGlobalColors                                                                                                                                                                                                                                                                                    | useExpertLayoutSettings)`, `^src\/routes\/admin\.(appearance | media                                                       | pages                                               | theme                                 | categor                          | tags?)`, `^src\/routes\/admin\.(icons                                         | crop-sizes                                   | content-area                                                                                                                                      | custom-meta)` |
| 5   | Strona główna, archiwa, chrome                        | `^src\/components\/header\/`, `^src\/components\/footer\/`, `^src\/components\/menu\/`, `^src\/components\/megaMenu\/`, `^src\/components\/mobile\/`, `^src\/components\/archive\/`, `^src\/components\/home\/`, `^src\/lib\/menus\/`, `^src\/lib\/megaMenu\/`, `^src\/lib\/mobileBottomBar\/`, `^src\/lib\/mobileDrawer`, `^src\/lib\/breadcrumbs`, `^src\/lib\/categoryAreas`, `^src\/components\/admin\/menu\/`, `^src\/routes\/(category                                                                                                                                                                                                                                                                                                                                                                                                      | tag                                                          | blog                                                        | series                                              | publications)\.`                      |
| 6   | Wyszukiwarka                                          | `^src\/lib\/search\/`, `^src\/components\/search\/`, `^src\/hooks\/useSavedSearches`, `^src\/routes\/search`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 7   | Typy treści specjalne                                 | `^src\/lib\/tracker\/`, `^src\/components\/tracker\/`, `^src\/lib\/experts\/`, `^src\/components\/experts\/`, `^src\/components\/admin\/experts\/`, `^src\/lib\/programs\/`, `^src\/components\/programs\/`, `^src\/lib\/podcast\/`, `^src\/components\/podcast\/`, `^src\/components\/admin\/podcasts\/`, `^src\/lib\/web-stories\/`, `^src\/components\/web-stories\/`, `^src\/components\/quiz\/`, `^src\/lib\/files\/`, `^src\/components\/files\/`, `^src\/lib\/maps\/`, `^src\/components\/maps\/`, `^src\/routes\/.*(tracker                                                                                                                                                                                                                                                                                                               | expert                                                       | program                                                     | podcast                                             | web-stor                              | quiz                             | librar                                                                        | glossar                                      | poll                                                                                                                                              | qa            | live)`       |
| 8   | SEO, feedy, dane strukturalne                         | `^src\/lib\/seo\/`, `^src\/components\/seo\/`, `^src\/lib\/social\/`, `^src\/lib\/links\/`, `^src\/lib\/customMeta`, `^src\/components\/share\/`, `^src\/components\/admin\/seo\/`, `^src\/routes\/.*(sitemap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | robots                                                       | rss                                                         | feed                                                | llms                                  | og-                              | seo)`                                                                         |
| 9   | Czat / komunikator                                    | `^src\/lib\/chat\/`, `^src\/components\/chat\/`, `^src\/lib\/composer\/`, `^src\/components\/composer\/`, `^src\/lib\/mentions\/`, `^src\/components\/mentions\/`, `^src\/routes\/.*(chat                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | messages)`                                                   |
| 10  | Sieć / networking                                     | `^src\/lib\/network\/`, `^src\/components\/network\/`, `^src\/hooks\/useFollow`, `^src\/routes\/.*network`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 11  | Newsletter i e-mail                                   | `^src\/routes\/api\/public\/popup-event`, `^src\/lib\/newsletter`, `^src\/components\/newsletter\/`, `^src\/components\/admin\/newsletter\/`, `^src\/lib\/email`, `^src\/lib\/system-emails`, `^src\/lib\/tx-email-preview`, `^src\/lib\/auth-email`, `^src\/hooks\/useMyNewsletterStatus`, `^src\/hooks\/useNewsletterSettings`, `^src\/components\/popups\/`, `^src\/routes\/.*newsletter`, `^src\/routes\/.*email`, `^src\/routes\/(unsubscribe                                                                                                                                                                                                                                                                                                                                                                                                | api\/public\/nl-)`, `^src\/components\/admin\/popups\/`      |
| 12  | Realtime / powiadomienia / web-push                   | `^src\/lib\/realtime\/`, `^src\/lib\/notifications\/`, `^src\/components\/notifications\/`, `^src\/routes\/.*notification`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 13  | Monetyzacja: checkout / subskrypcje / billing         | `^src\/lib\/billing\/`, `^src\/lib\/stripe`, `^src\/lib\/pricing\/`, `^src\/components\/billing\/`, `^src\/components\/checkout\/`, `^src\/components\/pricing\/`, `^src\/components\/membership-join\/`, `^src\/components\/admin\/billing\/`, `^src\/components\/admin\/pricing\/`, `^src\/hooks\/useCheckout`, `^src\/routes\/.*(billing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | checkout                                                     | pricing                                                     | membership                                          | subscription)`, `^src\/routes\/(plans | api\/public\/payments            | api\/public\/fx-rate)`                                                        |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  | `^src\/routes\/api\/public\/ad-event`, `^src\/lib\/gifting`, `^src\/components\/gifting\/`, `^src\/components\/donations\/`, `^src\/lib\/ads\/`, `^src\/components\/ads\/`, `^src\/components\/admin\/coupons\/`, `^src\/hooks\/useValidateCoupon`, `^src\/routes\/.*(gift                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | donat                                                        | coupon                                                      | ads)`                                               |
| 15  | Profil i konto                                        | `^src\/components\/people\/`, `^src\/lib\/profile\/`, `^src\/lib\/account`, `^src\/lib\/auth\/`, `^src\/lib\/authSettings`, `^src\/lib\/interests\/`, `^src\/lib\/retention\/`, `^src\/lib\/onboarding\/`, `^src\/components\/profile\/`, `^src\/components\/auth\/`, `^src\/components\/interests\/`, `^src\/components\/admin\/auth\/`, `^src\/components\/admin\/onboarding\/`, `^src\/hooks\/useAuth`, `^src\/hooks\/useAuthSettings`, `^src\/hooks\/useInterests`, `^src\/routes\/(login                                                                                                                                                                                                                                                                                                                                                     | signup                                                       | account                                                     | profile                                             | auth)`, `^src\/routes\/.*(profile     | account                          | onboarding)`, `^src\/routes\/(reset-password                                  | support                                      | contribute)`                                                                                                                                      |
| 16  | Społeczność: kluby, komentarze, moderacja             | `^src\/lib\/clubs\/`, `^src\/lib\/community\/`, `^src\/lib\/comments\/`, `^src\/components\/clubs\/`, `^src\/components\/community\/`, `^src\/components\/comments\/`, `^src\/components\/admin\/clubs\/`, `^src\/components\/admin\/community\/`, `^src\/routes\/.*(club                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | community                                                    | comment                                                     | badge)`                                             |
| 17  | Analityka i BI                                        | `^src\/routes\/api\/public\/experiment-event`, `^src\/lib\/analytics\/`, `^src\/lib\/observability\/`, `^src\/lib\/charts\/`, `^src\/lib\/counters\/`, `^src\/lib\/views\/`, `^src\/lib\/webVitals`, `^src\/lib\/tracker-admin`, `^src\/components\/charts\/`, `^src\/components\/admin\/analytics\/`, `^src\/components\/admin\/performance\/`, `^src\/routes\/.*(analytics                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | semantic)`, `^src\/routes\/api\/public\/(track               | vitals                                                      | client-errors)`, `^src\/routes\/admin\.(performance | experiments                           | link-monitor)`                   |
| 18  | CRM                                                   | `^src\/lib\/crm`, `^src\/components\/admin\/crm\/`, `^src\/lib\/organizations\/`, `^src\/lib\/csv\/`, `^src\/routes\/.*crm`, `^src\/routes\/admin\.(companies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | contact)`                                                    |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO | `^src\/lib\/authz\/`, `^src\/lib\/consent`, `^src\/lib\/cookieBanner\/`, `^src\/lib\/legal\/`, `^src\/lib\/integrations\/`, `^src\/lib\/tenant`, `^src\/lib\/features\/`, `^src\/lib\/personalization\/`, `^src\/lib\/greetings\/`, `^src\/lib\/admin\/`, `^src\/lib\/adminToasts`, `^src\/lib\/useSiteSetting`, `^src\/lib\/joinUsSync`, `^src\/lib\/contact\.functions`, `^src\/components\/legal\/`, `^src\/components\/consent\/`, `^src\/components\/admin\/permissions\/`, `^src\/components\/admin\/users\/`, `^src\/components\/admin\/settings\/`, `^src\/components\/admin\/cookie-banner\/`, `^src\/components\/admin\/google-source\/`, `^src\/hooks\/(usePersonalizedSettings                                                                                                                                                        | useCheckoutSettings)`, `^src\/routes\/admin\.(settings       | users                                                       | integrations                                        | permissions                           | consent                          | organizations                                                                 | audience)`, `^src\/routes\/admin\.(greetings | names                                                                                                                                             | personalized  | popups)`     |
| 20  | Platforma / backend / infrastruktura / SSR            | `^src\/lib\/ssr`, `^src\/lib\/server\/`, `^src\/lib\/http\/`, `^src\/lib\/supabase`, `^src\/integrations\/`, `^src\/lib\/ci\/`, `^src\/lib\/queries\/`, `^src\/lib\/async`, `^src\/lib\/errors\/`, `^src\/lib\/error`, `^src\/lib\/watchdog\/`, `^src\/lib\/routing\/`, `^src\/lib\/a11y\/`, `^src\/lib\/code\/`, `^src\/lib\/mcp\/`, `^src\/lib\/prerender`, `^src\/lib\/edgeCache`, `^src\/lib\/platform-error-reporting`, `^src\/lib\/cacheBusting`, `^src\/lib\/ai-gateway`, `^src\/lib\/redirects`, `^src\/lib\/text\/`, `^src\/lib\/utils`, `^src\/lib\/deepMerge`, `^src\/lib\/storageKeys`, `^src\/lib\/rafThrottle`, `^src\/lib\/smoothAnchorScroll`, `^src\/lib\/overlayCoordinator`, `^src\/lib\/appDialogs`, `^src\/lib\/loginPopupBus`, `^src\/lib\/toastError`, `^src\/lib\/countries`, `^src\/components\/error\/`, `^src\/(router | server                                                       | start)\.`, `^src\/utils\/`, `^src\/routes\/`, `^src\/lib\/` |
| 21  | Rekrutacja / kariera                                  | `^src\/lib\/careers\/`, `^src\/lib\/jobs\/`, `^src\/components\/careers\/`, `^src\/routes\/.*(career                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | job)`, `^src\/routes\/admin\.hiring`                         |
| 22  | Wydarzenia: event builder, rejestracja, onsite        | `^src\/lib\/events\/`, `^src\/components\/events\/`, `^src\/components\/admin\/events\/`, `^src\/routes\/admin\.events`, `^src\/routes\/events[._]`, `^src\/routes\/events\.tsx$`, `^src\/routes\/meetings\.`, `^src\/routes\/scanner`, `^src\/routes\/profile\.events`, `^src\/routes\/club\.\$clubSlug\.e\.`, `^src\/routes\/admin\.community\.events`, `^src\/components\/community\/Event`, `^src\/components\/community\/ticketDocument`, `^src\/components\/community\/EventsListSkeleton`, `^src\/components\/admin\/community\/EventSpeaker`, `^src\/components\/community\/AddToCalendar`, `^src\/hooks\/useEventSeatsRealtime`, `^src\/hooks\/useBarcodeScanner`, `^src\/components\/profile\/ParticipantTicketsPanel`, `^src\/components\/profile\/events\/`                                                                           |
| —   | PRZEKROJOWE: słowniki i18n                            | `^src\/lib\/i18n-`, `^src\/lib\/i18n\.ts$`, `^src\/lib\/i18n\/`, `^src\/lib\/locale\/`, `^src\/components\/admin\/i18n\/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    | `^src\/components\/(atoms                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | molecules                                                    | forms                                                       | features)\/`, `^src\/components\/admin\/(atoms      | molecules                             | hooks)\/`, `^src\/lib\/(features | hooks)\/`, `^src\/components\/admin\/`, `^src\/components\/`, `^src\/hooks\/` |
| —   | PRZEKROJOWE: design system (components/ui)            | `^src\/components\/ui\/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

Rozbicie liczby plików produkcyjnych:

| #   | Moduł                                                 | Pliki | LOC (surowe) | Pliki testowe | LOC testów |
| --- | ----------------------------------------------------- | ----: | -----------: | ------------: | ---------: |
| 1   | Wpisy: doświadczenie czytelnika                       |   104 |       13 728 |            57 |     13 042 |
| 2   | Edytor wpisów i workflow redakcyjny                   |   103 |       14 771 |            88 |     23 835 |
| 3   | Silniki treści: bloki + page builder                  |   459 |      111 172 |           283 |     67 958 |
| 4   | Strony, wygląd, motyw, media, import                  |   134 |       16 886 |            74 |     15 564 |
| 5   | Strona główna, archiwa, chrome                        |    62 |       10 044 |            29 |      8 022 |
| 6   | Wyszukiwarka                                          |    25 |        4 683 |            21 |      6 119 |
| 7   | Typy treści specjalne                                 |    95 |       23 118 |            46 |     10 923 |
| 8   | SEO, feedy, dane strukturalne                         |    77 |       10 867 |            68 |     20 854 |
| 9   | Czat / komunikator                                    |    81 |       15 602 |            36 |      9 164 |
| 10  | Sieć / networking                                     |    32 |        5 162 |            23 |      5 298 |
| 11  | Newsletter i e-mail                                   |   148 |       29 024 |           118 |     39 965 |
| 12  | Realtime / powiadomienia / web-push                   |    28 |        5 495 |            14 |      1 785 |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |   190 |       27 851 |            94 |     25 039 |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |    39 |        7 978 |            11 |      1 476 |
| 15  | Profil i konto                                        |    94 |       19 834 |            72 |     32 792 |
| 16  | Społeczność: kluby, komentarze, moderacja             |   306 |       58 521 |           194 |     74 365 |
| 17  | Analityka i BI                                        |    86 |       16 628 |            19 |      2 229 |
| 18  | CRM                                                   |    59 |       16 226 |            33 |     10 365 |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |   131 |       24 326 |            51 |     20 847 |
| 20  | Platforma / backend / infrastruktura / SSR            |   200 |       64 995 |           210 |     78 042 |
| 21  | Rekrutacja / kariera                                  |    29 |        5 231 |            11 |      2 202 |
| 22  | Wydarzenia: event builder, rejestracja, onsite        |   362 |       67 364 |           151 |     49 708 |
| —   | PRZEKROJOWE: słowniki i18n                            |   134 |       54 609 |             6 |        528 |
| —   | NIEPRZYPISANE                                         |     0 |            0 |            11 |      2 043 |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    |   183 |       29 455 |            41 |     10 947 |
| —   | PRZEKROJOWE: design system (components/ui)            |    43 |        4 252 |             2 |        195 |

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
bun run test:coverage          # próg globalny + 353 progów per-ścieżka
```

Od wdrożenia R1 z wydania 1 (`coverage.reportOnFailure: true` w configu) raport i progi powstają
TAKŻE na czerwonej suicie, więc powyższe jedno polecenie wystarcza — obejście z wydania 1 nie jest
już potrzebne. Pełny przebieg na tym HEAD: 9 min 10 s, 1 763 plików testowych, 46 409 testów
(1 235 plików / 22 002 testy przeszły, 2 pliki / 50 testów pominięte z braku sekretów Supabase).

Agregacja per moduł / funkcja / funkcjonalność powstała z `coverage/coverage-final.json`
(mapy `statementMap`/`fnMap`/`branchMap` + liczniki `s`/`f`/`b`) oraz `coverage-summary.json`:
moduł = suma po plikach pasujących do reguł z 9.1, funkcjonalność = suma po wzorcach ścieżek,
„funkcja bez wywołania” = wpis `fnMap`, którego licznik `f` wynosi zero.

### 9.4 Dokumenty wdrożeniowe i przeglądowe, na które opiera się to wydanie

Ten audyt weryfikował liczby z tych dokumentów własnym przebiegiem, nie przepisywał ich.

**Nowe w tym wydaniu — moduł wydarzeń:**

- `docs/PROJEKT_MODUL_EVENT_BUILDER_2026-08-23.md` (1 320 wierszy) — specyfikacja żywa modułu,
  etapy E1–E7 z kryteriami odbioru, ryzyka i „dług nazwany wprost”, dziennik wdrożenia w §12.
  To z niej pochodzi podział na podsystemy, którego użyłem do wierszy funkcjonalności.
- `docs/PRZEGLAD_MODUL_EVENT_BUILDER_2026-08-28.md` (578 wierszy) — przegląd piętnastu
  podsystemów: wykonane testy z liczbami, co potwierdzone w kodzie (E4–E7), siedem ustaleń
  krytycznych z propozycją naprawy, rozdział „Dokumentacja wyprzedzona przez kod” i rozdział
  „Stan wobec `main`” sprawdzony ponownie wieczorem tego samego dnia.
- `docs/PRZEGLAD_MODUL_EVENT_BUILDER_2026-08-28_USTALENIA.md` (2 113 wierszy) — załącznik
  z pełną listą **165 ustaleń** (7 krytycznych, 45 wysokich, 80 średnich, 33 niskie), każde
  po **adwersaryjnej weryfikacji**, której zadaniem było ustalenie OBALIĆ; dziewięć obalonych
  jest wypisanych osobno, żeby nie wracały.
- `docs/PROJEKT_FRONT_WYDARZENIA_2026-08-23.md`, `docs/MAPOWANIE_SWAPCARD_EVENT_BUILDER_ZRZUTY.md`,
  `docs/ANALIZA_BRAKUJACYCH_EKRANOW_2026-08-23.md`, `docs/INWENTARZ_ELEMENTOW_UI_SWAPCARD_2026-08-23.md`
  — front publiczny, mapowanie ekran po ekranie na ścieżki w repo i inwentarz braków.

Ten zestaw wprowadza wzorzec, którego wcześniej w repo nie było i który warto zapisać: **przegląd
prowadzony równolegle przez niezależnych recenzentów per podsystem, z osobnym przejściem
adwersaryjnym**, plus rozdzielenie „wagi nadanej przez recenzenta podsystemu” od „triage'u po
ręcznej weryfikacji całości” — z tabelą różnic między jedną a drugą listą. Dokument sam mówi,
że te dwie siódemki nie są tym samym zbiorem, i to jest właśnie ta uczciwość, której szukam
w raportach: liczba bez wyjaśnienia, skąd się wzięła, nie jest sprawdzalna.

**Z poprzednich wydań, nadal aktualne jako dowód:**

- `docs/WDROZENIE_CMS_BUILDER_TESTY_2026-08-20.md` (242 wiersze) — sześć powierzchni buildera
  z przed → po, rozdział „Czego NIE pokryto — z numerami linii”, dwanaście defektów.
- `docs/WDROZENIE_KLUBY_POKRYCIE_95_MODUL_16_2026-08-21.md` (351 wierszy) — 28 czystych modułów
  reguł wyprowadzonych z JSX-a, rozdział „Nie osiągnięto 95% w:”.
- `docs/WDROZENIE_USTAWIENIA_INTEGRACJE_MODUL_19_2026-08-22.md` (413 wierszy) — trzynaście
  powierzchni z 28% na 95%+, 36 defektów w siedmiu klasach.
- `docs/WDROZENIE_PLATFORMA_POKRYCIE_MODUL_20_2026-08-22.md` (400 wierszy) — cel modułowy
  **NIE osiągnięty** i powiedziane to w pierwszym akapicie, 38 defektów, rozdział „Do zgłoszenia
  człowiekowi” i rozdział „Trzy założenia zlecenia, które okazały się nieprawdziwe”.

Wspólny mianownik dokumentów, które uznaję za dowód: **każdy z nich ma rozdział o tym, czego
NIE osiągnął.** Raport wdrożenia wymieniający własne luki jest sprawdzalny; raport podający
same procenty nie jest. Przegląd modułu wydarzeń dokłada do tego trzecią rzecz — listę
własnych ustaleń, które sam obalił.
