# Audyt pokrycia testami: moduł po module, funkcja po funkcji (2026-08-30)

**Wydanie 7 pomiaru — pierwsze w całości ZIELONE od strony bramek.** Rodowód: wydanie 1
(2026-08-18) musiało wykluczyć 39 plików testowych wiszących w kolekcji; wydanie 2 (19.08)
było pierwszym KOMPLETNYM pomiarem; wydanie 3 (19.08) pierwszym bez czerwonych testów;
wydanie 4 (21.08) zmierzyło skutek domknięcia CMS buildera i klubów; wydanie 5 (22.08) —
modułów 19 i 20; wydanie 6 (29.08) wprowadziło MODUŁ 22 (wydarzenia).
To wydanie mierzy HEAD `d5171bca9` — **134 commity** za wydaniem 6.

**Cały ruch tego wydania pochodzi z jednej powierzchni i jest to powierzchnia, którą zamówiono.**
MODUŁ 22 (wydarzenia) przeszedł z 58,96% na **84,78% linii** i z 55,25% na **84,62% funkcji**
przy powierzchni praktycznie bez zmian (362 → 366 plików). Dziesięć z piętnastu jego
funkcjonalności domknięto, jedna z zera na 100%, a dług w plikach zerowych spadł z 1 198 linii
w organizmach panelu do 142. Zamknięto też opisane w wydaniu 6 znalezisko klasy „pieniądze”:
zapis etapu 4 ma wreszcie drogę do kasy (rozdz. 5.5).

Skala zmiany w liczbach pomiaru: plików produkcyjnych 3 201 → **3 212**, mierzonych linii
104 563 → **105 116**, funkcji 33 844 → **33 933**,
plików testowych 1 763 → **1 863**, progów per-ścieżka 353 → **353**.

Pokrycie globalne: linie 74,94% → **77,66%**, funkcje 71,54% → **75,04%**,
gałęzie 69,20% → **71,64%**, instrukcje 73,91% → **76,54%**.
Suita przeszła w komplecie — **zero czerwonych testów i zero naruszeń progów**, po raz pierwszy
w tej serii jednocześnie. Ocena całości przekroczyła próg „dobrze” (rozdz. 8.2).

**Dwie liczby, które się NIE zmieniły, są w tym wydaniu ważniejsze od tych, które wzrosły.**
Próg globalny stoi na `64/58/62/65` drugie wydanie z rzędu, a liczba progów
per-ścieżka na **353** — mimo 100 nowych plików testowych. Zapadka, która przez pięć wydań
była głównym mechanizmem utrwalania dorobku, przestała się poruszać (rozdz. 1, 8.2).

**Sprostowanie do wydania 6.** Tamten dokument twierdził, że MODUŁ 15 (profil) zregresował
z 97,42% na 96,15% linii, i nazywał to swoją najważniejszą obserwacją. **Liczba była błędna** —
moduł stał wtedy na 97,50%, dziś stoi na 97,64%. Prawdziwe było to, co siedziało pod spodem:
dziesięć czerwonych testów zdublowanej szuflady profilu, których pokrycie modułu NIE pokazało
i pokazać nie mogło. Mechanizm i wniosek — mocniejszy niż tamta teza — w rozdziale 1.
Przy okazji sprostowania zweryfikowałem wszystkie liczby w rozdziale 8.2 wobec tabeli pomiaru.

Plik pozostaje pod tą samą nazwą, bo odwołuje się do niego komentarz przy progu globalnym
w `vitest.config.ts` oraz prompty modułowe. **Mapa modułów w tym wydaniu się nie zmieniła**
(sprawdzenie wszystkich 11 nowych plików produkcyjnych: rozdz. 9.1), więc delty w 2.1 mierzą
wyłącznie pracę testową i nie wymagały przeliczania poprzedniego przebiegu.

Zlecenie: **„ile % pokrycia testami ma każdy moduł, jego funkcje oraz funkcjonalności”**.
Dokument podaje ZMIERZONE liczby (nie oceny), z jawną metodologią i jawnymi ograniczeniami
pomiaru. Taksonomia modułów pochodzi z `docs/OCENA_FUNKCJI_TABELE_2026-08-14.md`; MODUŁ 22
(wydarzenia) dołożyło wydanie 6, bo tamten dokument powstał przed dostawą — pozostałe
21 modułów podłożysz pod tamte tabele ocen bez zmian.

---

## 0. Jak to zmierzono (i czego te liczby NIE znaczą)

| Element pomiaru                    | Wartość                                                                                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Narzędzie                          | `vitest run --coverage` (provider `v8`), konfiguracja repo bez zmian                                                                                      |
| Zakres mierzony                    | całe `src/**/*.{ts,tsx}` (`all: true`) — pliki bez testów WCHODZĄ do mianownika                                                                           |
| Wykluczenia (z `vitest.config.ts`) | `__tests__`, `*.test.*`, artefakty generowane (`routeTree.gen.ts`, `supabase/types.ts`, `lucideIconNodes.generated.ts`), `src/test/**`, `lazyWidgets.tsx` |
| Plików produkcyjnych w mianowniku  | 3 212                                                                                                                                                     |
| Plików testowych zmierzonych       | 1 863 z 1 863 (100,0%)                                                                                                                                    |
| Przypadków testowych wykonanych    | 49 354 (statyczny licznik `it/test` w plikach: 37 517; różnica to rozwinięcia `it.each`)                                                                  |
| Testy poza pomiarem                | brak — żaden plik nie został wykluczony z przebiegu                                                                                                       |
| Testy czerwone w tym przebiegu     | **0 — suita jest w całości zielona** (pierwszy taki przebieg w trzech wydaniach)                                                                          |
| Testy „expected fail”              | 238 przypadków z 226 wywołań `it.fails(` w 129 plikach — zapisane defekty produkcyjne, nie awarie (rozdział 7.2)                                          |
| Testy pominięte                    | 2 pliki / 50 testów — wymagają danych dostępowych do Supabase, których sandboks nie ma (rozdział 9.2)                                                     |
| Wynik bramki pokrycia              | przebieg zakończony kodem **0**: próg globalny i wszystkie 353 progów per-ścieżka PRZESZŁY                                                                |
| Data pomiaru                       | 2026-08-30, HEAD `d5171bca9`                                                                                                                              |

**Cztery zastrzeżenia, bez których te procenty można źle odczytać:**

1. **Pokrycie ≠ poprawność.** Instrukcja „pokryta” to instrukcja, która się WYKONAŁA w trakcie
   testu — nie taka, której wynik ktoś sprawdził asercją. Dlatego obok pokrycia podaję gęstość
   asercji (kolumna „asercje”) — moduł z wysokim pokryciem i niską liczbą asercji to render bez dowodu.
2. **Pokrycie jednostkowe to nie całe pokrycie systemu.** Warstwa danych (RLS, RPC, triggery) jest
   testowana w pgTAP (99 plików, 1 793 asercji), a ścieżki użytkownika w Playwright
   (9 plików, 66 testów). Tych warstw v8 nie widzi — moduł z niskim %
   jednostkowym może mieć realną zaporę w bazie (rozdział 7).
3. **Mapowanie plik → moduł jest MOJE, nie repo.** Repo nie ma manifestu modułów; przypisanie
   3 212 plików do 22 modułów zrobiłem regułami po ścieżkach (rozdział 9.1). Pliki graniczne
   (np. `gifting` — „podaruj artykuł” jest funkcją MODUŁU 1, a kod leży w powierzchni MODUŁU 14)
   zaznaczam w tabelach.
4. **Pomiar jest KOMPLETNY, a suita PO RAZ PIERWSZY W TEJ SERII jest w całości zielona.**
   Ten przebieg: **1 863 plików testowych przeszło, 49 066 testów przeszło, ZERO padło**,
   a bramka pokrycia wyszła **kodem 0**: próg globalny i wszystkie 353 progów per-ścieżka
   przeszły, bez ani jednego naruszenia. W sześciu poprzednich wydaniach zawsze coś było
   czerwone — w wydaniu 6 dwanaście testów w trzech plikach i osiem naruszeń progów.
   Trzy rzeczy z wydania 6 zamknęły się w tym oknie: defekt szuflady profilu
   (`routes/__tests__/profileShellRoutes.test.tsx` jest dziś zielony), rozjazd prowieniencji
   snapshotu autoryzacji i kontrakt JSON-LD landingu quizu.
   Do tego **238 przypadków „expected fail”** — to NIE awarie, tylko zapisane
   defekty produkcyjne (rozdział 7.2); ich liczba wzrosła w tym wydaniu najbardziej w całej serii.
   Poza pomiarem zostały 2 pliki (50 testów) odpytujące hostowaną bazę.

---

## 1. Wynik globalny: całe `src/`

| Metryka    | Pokryte / wszystkich |          % |
| ---------- | -------------------: | ---------: |
| Instrukcje |     91 980 / 120 168 | **76,54%** |
| Gałęzie    |     78 575 / 109 670 | **71,64%** |
| Funkcje    |      25 465 / 33 933 | **75,04%** |
| Linie      |     81 641 / 105 116 | **77,66%** |

Próg globalny w `vitest.config.ts` (ratchet, wolno tylko podnosić): **64% instrukcji /
58% gałęzi / 62% funkcji / 65% linii**. Zmierzony margines nad progiem:
instrukcje 12,54 pp, gałęzie 13,64 pp,
funkcje 13,04 pp, linie 12,66 pp.

**Kontrola wiarygodności pomiaru.** Komentarz przy progu w `vitest.config.ts` dokumentuje ostatni
pomiar zespołu: 68,27% instrukcji / 62,80% gałęzi /
66,25% funkcji / 69,28% linii.
Ten audyt, niezależnym przebiegiem: 76,54% / 71,64% / 75,04% / 77,66%.
Rozjazd urósł do **~8,4 pp na liniach** i nadal jest po stronie KOMENTARZA, nie pomiaru:
wpis w configu pochodzi sprzed domknięcia modułu wydarzeń. W wydaniu 6 ta różnica wynosiła
5,7 pp i pisałem, że jest na granicy wprowadzania w błąd. Granicę przekroczyła: komentarz
opisuje dziś repozytorium o osiem punktów słabsze, niż jest naprawdę, a jest to jedyne
miejsce w kodzie, z którego czytelnik configu dowiaduje się, ile pokrycia repo ma.

**Zapadka stanęła CAŁA — drugie wydanie z rzędu i tym razem także per-ścieżka.** Wydanie 3
zgłaszało progi `33/25/33/28` stojące ~23 pp pod pomiarem; wydanie 4 zmierzyło `58/54/58/52`,
wydanie 5 podniosło do `64/58/62/65`. Config ma dziś **dokładnie te same wartości**,
a pomiar stoi ~12 pp wyżej. W wydaniu 6 pisałem, że nawyk nie zniknął, bo progi per-ścieżka
rosły dalej. W tym wydaniu **nie rosną już i one**: 353 → **353**, liczba bez zmian.
Wartości na ścieżkach wydarzeń owszem poszły w górę za dostawą, ale ani jedna NOWA ścieżka
nie dostała własnego progu, mimo że przybyło 100 plików testowych.
Skutek jest arytmetyczny: żeby dziś przekroczyć globalną zapadkę w dół, repozytorium
musiałoby stracić **jedną szóstą** całego pokrycia. Bramka, która puszcza taki spadek,
nie jest bramką — jest formalnością.

**Rekomendacja R1 z WYDANIA 1 jest wdrożona** (nie mylić z R1 tego wydania w rozdz. 8.1).
`coverage.reportOnFailure: true` stoi w configu
z komentarzem opisującym mechanizm (`checkThresholds` żyje wewnątrz `reportCoverage()`, z którego
vitest wychodził przy pierwszym czerwonym teście). Skutek praktyczny: ten pomiar nie wymagał już
żadnego obejścia — raport i progi powstają także na czerwonej suicie.

**Ta sama flaga ma drugą stronę i wydanie 6 dało na nią dowód — którego wtedy nie odczytałem
poprawnie.** Skoro raport powstaje mimo czerwieni, to linie wykonane przez test, który PADŁ,
wciąż liczą się jako pokryte: test wywraca się na asercji długo po tym, jak przeszedł przez
mierzony kod. W wydaniu 6 dziesięć czerwonych testów w `profileShellRoutes`
kosztowało moduł 15 **0,0 pp** — napisałem wtedy, że moduł zregresował
z 97,42% na 96,15%, i to była nieprawda: przeliczony z danych tamtego przebiegu moduł stał
na 97,50%, czyli 0,1 pp WYŻEJ niż w wydaniu 5. Awarii nie było widać w procencie w ogóle.
Złapał ją wyłącznie **próg per-ścieżka** `src/components/profile/**` — 91,59% linii wobec
progu 93, 85,43% funkcji wobec 87, 83,09% gałęzi wobec 89. Dla porządku: dziś ta sama
ścieżka mierzy **96,37% linii / 90,37% funkcji / 91,38% gałęzi / 95,03% instrukcji**,
czyli stoi z zapasem nad każdym z czterech progów.

**Drugie sprostowanie, przy okazji tego samego wątku.** Napisałem w wydaniu 6, że przyczyną
czerwieni jest defekt produkcyjny: „szuflada profilu renderuje się DWA RAZY”. **Nie jest.**
Dwa pasy to zamierzony kontrakt i istniał już przed tamtym pomiarem (`createPortal`
w `src/routes/profile.tsx` jest obecny na commicie wydania 6): pas desktopowy żyje w drzewie
treści, a mobilny wisi na `<body>`, bo inaczej sticky nagłówek strony przykryłby go
niezależnie od `z-index`. Czerwone było **zapytanie testu**, nie produkt — `getByLabelText`
trafiał w oba pasy naraz. Naprawa w tym oknie nie zmieniła zachowania: produkcja dostała
znaczniki `data-sidebar-lane="desktop"/"mobile"` (afordancja testowalności, nie nowe
zachowanie), testy zawężono do pasa, a jeden test **przypina sam kontrakt duplikacji**:
stan zwinięty ma dokładnie jeden pas, rozwinięty dwa. Próg per-ścieżka zadziałał mimo to
poprawnie — mierzył, że katalog przestał być wykonywany, i to była prawda. Błędna była
moja DIAGNOZA przyczyny, nie sygnał bramki.
Wniosek jest ogólny i wart więcej niż tamta pomyłka: **procent modułu nie jest bramką i nie
wykrywa czerwieni.** Wykrywa ją albo sam wynik suity, albo próg postawiony na tyle wąsko,
żeby jeden zepsuty katalog przebił się przez średnią. To jest najmocniejszy argument tej
serii za progami per-ścieżka — i powód, dla którego stojąca zapadka z akapitu wyżej boli
bardziej, niż wygląda.

---

## 2. Pokrycie per moduł — tabela główna

Sortowanie: po pokryciu linii, rosnąco (najsłabsze na górze).
`T/P` = pliki testowe / pliki produkcyjne w module. `0%` = pliki produkcyjne bez ani jednej wykonanej linii.

| #   | Moduł                                                 | Pliki prod. | Instrukcje | Gałęzie | Funkcje |      Linie | Plików 0% |   T/P | Testów | Asercji |
| --- | ----------------------------------------------------- | ----------: | ---------: | ------: | ------: | ---------: | --------: | ----: | -----: | ------: |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |          39 |     26,95% |  30,68% |  18,42% | **27,06%** |        13 | 0,282 |     91 |     263 |
| 17  | Analityka i BI                                        |          86 |     32,13% |  25,08% |  28,41% | **32,88%** |        47 | 0,221 |    199 |     442 |
| 7   | Typy treści specjalne                                 |          95 |     44,18% |  40,43% |  36,73% | **43,93%** |        37 | 0,484 |    934 |   1 501 |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    |         184 |     46,56% |  40,10% |  42,45% | **47,95%** |        33 | 0,234 |    679 |   1 539 |
| 12  | Realtime / powiadomienia / web-push                   |          28 |     46,71% |  31,59% |  47,46% | **49,54%** |        12 | 0,500 |     99 |     233 |
| 21  | Rekrutacja / kariera                                  |          29 |     54,96% |  53,52% |  47,13% | **55,12%** |        12 | 0,379 |    171 |     374 |
| 9   | Czat / komunikator                                    |          81 |     60,88% |  51,46% |  57,74% | **62,31%** |        14 | 0,444 |    607 |   1 123 |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |         190 |     65,60% |  61,35% |  76,62% | **67,04%** |        34 | 0,505 |  1 643 |   3 394 |
| 20  | Platforma / backend / infrastruktura / SSR            |         201 |     74,44% |  64,55% |  68,19% | **75,55%** |        46 | 1,064 |  4 597 |   9 927 |
| 3   | Silniki treści: bloki + page builder                  |         460 |     75,23% |  73,44% |  71,67% | **76,41%** |        68 | 0,623 |  5 007 |   9 159 |
| —   | PRZEKROJOWE: design system (components/ui)            |          44 |     78,34% |  68,50% |  72,22% | **80,43%** |         4 | 0,045 |     17 |      37 |
| 10  | Sieć / networking                                     |          32 |     79,85% |  68,71% |  81,85% | **83,65%** |         3 | 0,719 |    349 |     642 |
| 1   | Wpisy: doświadczenie czytelnika                       |         104 |     82,60% |  74,99% |  81,98% | **84,35%** |        13 | 0,558 |  1 015 |   2 132 |
| 22  | Wydarzenia: event builder, rejestracja, onsite        |         366 |     83,36% |  79,87% |  84,62% | **84,78%** |        72 | 0,645 |  5 268 |  10 922 |
| 16  | Społeczność: kluby, komentarze, moderacja             |         306 |     88,68% |  87,27% |  89,02% | **89,12%** |        16 | 0,634 |  4 715 |   9 534 |
| 4   | Strony, wygląd, motyw, media, import                  |         133 |     90,95% |  82,23% |  88,89% | **92,32%** |         4 | 0,552 |  1 245 |   2 154 |
| —   | PRZEKROJOWE: słowniki i18n                            |         134 |     89,35% |  67,14% |  59,24% | **93,14%** |         1 | 0,045 |     60 |     141 |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |         131 |     92,19% |  88,78% |  89,91% | **93,18%** |        14 | 0,389 |  1 333 |   2 575 |
| 5   | Strona główna, archiwa, chrome                        |          62 |     94,68% |  82,86% |  93,49% | **96,47%** |         1 | 0,468 |    560 |     945 |
| 8   | SEO, feedy, dane strukturalne                         |          78 |     96,26% |  93,22% |  95,65% | **96,67%** |         5 | 0,885 |  1 270 |   2 847 |
| 6   | Wyszukiwarka                                          |          25 |     96,66% |  89,91% |  95,24% | **97,38%** |         0 | 0,840 |    528 |     839 |
| 15  | Profil i konto                                        |          94 |     96,65% |  93,96% |  94,81% | **97,64%** |         2 | 0,766 |  2 011 |   4 099 |
| 18  | CRM                                                   |          59 |     98,10% |  86,24% |  98,60% | **99,03%** |         0 | 0,559 |    703 |   1 231 |
| 2   | Edytor wpisów i workflow redakcyjny                   |         103 |     98,81% |  94,71% |  98,73% | **99,35%** |         0 | 0,854 |  1 576 |   2 928 |
| 11  | Newsletter i e-mail                                   |         148 |     98,89% |  95,05% |  99,43% | **99,53%** |         0 | 0,797 |  2 778 |   5 931 |

### 2.1 Zmiana od wydania 6 — moduł wydarzeń domknięty na zamówienie

Poprzedni pomiar (wydanie 6, 2026-08-29, HEAD `f16c43c06`) obejmował 1 763 plików
testowych i 3 201 plików produkcyjnych. Ten obejmuje 1 863 i 3 212.

**Mapa modułów w tym wydaniu SIĘ NIE ZMIENIŁA, więc kolumny „wyd. 6” są przepisane wprost**
— bez przeliczania, którego wymagało wydanie 6 po wydzieleniu modułu 22. Sprawdziłem wszystkie
11 nowych plików produkcyjnych tego okna: każdy trafia regułami tam, gdzie powinien, i żadna
nowa powierzchnia nie zasługuje na własny moduł. Delty niżej mierzą więc wyłącznie pracę
testową. Reguły mapowania: rozdział 9.1.

Kolumna Δ to różnica w punktach procentowych wobec wydania 6; ostatnia kolumna to
różnica KUMULACYJNA wobec wydania 1 (2026-08-18). Strzałka ↑ znaczy, że modułem ktoś się zajął.

| #   | Moduł                                                 | Linie wyd. 6 | Linie teraz |    Δ linie | Funkcje wyd. 6 | Funkcje teraz |  Δ funkcje | Δ linie od wyd. 1 |
| --- | ----------------------------------------------------- | -----------: | ----------: | ---------: | -------------: | ------------: | ---------: | ----------------: |
| 22  | Wydarzenia: event builder, rejestracja, onsite        |       58,96% |  **84,78%** | ↑ +25,8 pp |         55,25% |    **84,62%** | ↑ +29,4 pp |                 — |
| 10  | Sieć / networking                                     |       81,98% |  **83,65%** |  ↑ +1,7 pp |         80,86% |    **81,85%** |  ↑ +1,0 pp |         ↑ +2,0 pp |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |       65,62% |  **67,04%** |  ↑ +1,4 pp |         75,58% |    **76,62%** |  ↑ +1,0 pp |        ↑ +34,3 pp |
| 20  | Platforma / backend / infrastruktura / SSR            |       74,73% |  **75,55%** |  ↑ +0,8 pp |         67,44% |    **68,19%** |  ↑ +0,7 pp |        ↑ +22,8 pp |
| —   | PRZEKROJOWE: design system (components/ui)            |       79,89% |  **80,43%** |  ↑ +0,5 pp |         71,49% |    **72,22%** |  ↑ +0,7 pp |        ↑ +17,3 pp |
| 15  | Profil i konto                                        |       97,50% |  **97,64%** |  ↑ +0,1 pp |         94,44% |    **94,81%** |  ↑ +0,4 pp |        ↑ +78,5 pp |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    |       47,87% |  **47,95%** |  ↑ +0,1 pp |         42,29% |    **42,45%** |  ↑ +0,2 pp |        ↑ +23,5 pp |
| 8   | SEO, feedy, dane strukturalne                         |       96,65% |  **96,67%** |     0,0 pp |         95,64% |    **95,65%** |     0,0 pp |        ↑ +46,4 pp |
| 3   | Silniki treści: bloki + page builder                  |       76,40% |  **76,41%** |     0,0 pp |         71,70% |    **71,67%** |     0,0 pp |        ↑ +36,4 pp |
| 11  | Newsletter i e-mail                                   |       99,53% |  **99,53%** |     0,0 pp |         99,43% |    **99,43%** |     0,0 pp |        ↑ +72,8 pp |
| 1   | Wpisy: doświadczenie czytelnika                       |       84,35% |  **84,35%** |     0,0 pp |         81,98% |    **81,98%** |     0,0 pp |        ↑ +52,5 pp |
| 2   | Edytor wpisów i workflow redakcyjny                   |       99,35% |  **99,35%** |     0,0 pp |         98,85% |    **98,73%** |  ↓ -0,1 pp |        ↑ +91,0 pp |
| 4   | Strony, wygląd, motyw, media, import                  |       92,32% |  **92,32%** |     0,0 pp |         88,89% |    **88,89%** |     0,0 pp |        ↑ +69,6 pp |
| 5   | Strona główna, archiwa, chrome                        |       96,47% |  **96,47%** |     0,0 pp |         93,49% |    **93,49%** |     0,0 pp |        ↑ +79,8 pp |
| 6   | Wyszukiwarka                                          |       97,38% |  **97,38%** |     0,0 pp |         95,24% |    **95,24%** |     0,0 pp |        ↑ +64,2 pp |
| 7   | Typy treści specjalne                                 |       43,93% |  **43,93%** |     0,0 pp |         36,73% |    **36,73%** |     0,0 pp |        ↑ +27,5 pp |
| 12  | Realtime / powiadomienia / web-push                   |       49,54% |  **49,54%** |     0,0 pp |         47,46% |    **47,46%** |     0,0 pp |         ↑ +5,4 pp |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |       27,06% |  **27,06%** |     0,0 pp |         18,42% |    **18,42%** |     0,0 pp |         ↑ +4,5 pp |
| 16  | Społeczność: kluby, komentarze, moderacja             |       89,12% |  **89,12%** |     0,0 pp |         89,02% |    **89,02%** |     0,0 pp |        ↑ +71,6 pp |
| 17  | Analityka i BI                                        |       32,88% |  **32,88%** |     0,0 pp |         28,41% |    **28,41%** |     0,0 pp |         ↑ +4,9 pp |
| 18  | CRM                                                   |       99,03% |  **99,03%** |     0,0 pp |         98,60% |    **98,60%** |     0,0 pp |        ↑ +87,0 pp |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |       93,18% |  **93,18%** |     0,0 pp |         89,91% |    **89,91%** |     0,0 pp |        ↑ +71,2 pp |
| 21  | Rekrutacja / kariera                                  |       55,12% |  **55,12%** |     0,0 pp |         47,13% |    **47,13%** |     0,0 pp |            0,0 pp |
| —   | PRZEKROJOWE: słowniki i18n                            |       93,14% |  **93,14%** |     0,0 pp |         59,24% |    **59,24%** |     0,0 pp |         ↑ +1,4 pp |
| 9   | Czat / komunikator                                    |       62,83% |  **62,31%** |  ↓ -0,5 pp |         58,02% |    **57,74%** |  ↓ -0,3 pp |         ↑ +0,4 pp |

Ruszyło 3 powierzchni (powyżej 1 pp), 22 stoi w granicach ±1 pp, 0 spadło o więcej niż 1 pp.
**To wydanie ma jedno źródło ruchu i jest nim jedna powierzchnia.**

**MODUŁ 22 (wydarzenia): 58,96% → 84,78% linii (+25,8 pp), 55,25% → 84,62% funkcji (+29,4 pp),
plików na zerze 144 → 72.** Powierzchnia praktycznie się nie zmieniła (362 → 366 plików), więc
to nie jest dylucja ani dostawa — to jest praca testowa na istniejącym kodzie, wykonana
w ciągu **dwudziestu sześciu godzin** — commity modułu rozpięte są od 29.08 12:45 do 30.08 14:56.
Rozkład po funkcjonalnościach pokazuje, że szła listą, nie losowo:

| funkcjonalność                     | wyd. 6 |      teraz |           Δ |
| ---------------------------------- | -----: | ---------: | ----------: |
| Analityka, komunikacja, integracje |   0,0% | **100,0%** | ↑ +100,0 pp |
| Regulaminy, grupy i uprawnienia    |  35,2% |  **95,3%** |  ↑ +60,2 pp |
| Studio wydarzenia: rama, moduły    |  25,2% |  **87,0%** |  ↑ +61,8 pp |
| Sponsorzy i partnerzy              |  36,8% |  **92,1%** |  ↑ +55,3 pp |
| Odprawa na miejscu: skan, leady    |  43,8% |  **93,7%** |  ↑ +49,9 pp |
| Branding, strony i menu            |  49,0% |  **89,4%** |  ↑ +40,5 pp |
| Giełda spotkań 1-1                 |  61,2% |  **91,4%** |  ↑ +30,2 pp |
| Powierzchnia uczestnika            |  64,2% |  **93,9%** |  ↑ +29,7 pp |
| Agenda: sesje, ścieżki, sale       |  71,6% |  **92,5%** |  ↑ +20,9 pp |
| Informacje ogólne, strefa czasowa  |  82,8% |  **93,4%** |  ↑ +10,7 pp |

Cztery funkcjonalności nie ruszyły się i to też jest informacja: **publiczny portal wydarzenia**
(66,5%, +1,3), **bilety i pakiety** (70,1%, +2,9), **katalog wydarzeń** (76,3%, +0,2)
i **rejestracja** (77,1%, +0,8). To są dokładnie cztery ostatnie pozycje zamówionej listy —
praca skończyła się na dziewiątej. Jedna funkcjonalność została nietknięta świadomie
(widgety wydarzeń w builderze, 97,4%) i tak było zamówione.

**Poza modułem 22 repozytorium stoi.** Osiemnaście z dwudziestu pięciu powierzchni ma deltę
w granicach ±1 pp, a moduły 14, 17 i 21 mają dokładnie 0,0 pp — po raz kolejny. Ruch globalny
(+2,7 pp linii) niemal w całości pochodzi z jednego modułu: bez niego byłoby +0,6 pp.

**Jedyny spadek: MODUŁ 9 (czat / komunikator), 62,83% → 62,31% linii (−0,5 pp).** To dylucja
od nowego kodu, nie czerwień — suita jest w całości zielona.

**Sprostowanie do wydania 6.** Napisałem tam, że MODUŁ 15 (profil) zregresował z 97,42%
na 96,15% i nazwałem to najważniejszą obserwacją tamtego wydania. To była **nieprawda**:
moduł stał wtedy na 97,50%, dziś stoi na 97,64%. Prawdziwe było to, co siedziało pod spodem —
dziesięć czerwonych testów szuflady profilu — ale pokrycie modułu ich nie pokazywało
i pokazać nie mogło (mechanizm: rozdz. 1). Defekt został w tym oknie naprawiony,
plik jest zielony, a moduł urósł o 0,1 pp.

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
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    |         1 722 |        731 | **42,45%** |
| 21  | Rekrutacja / kariera                                  |           348 |        164 | **47,13%** |
| 12  | Realtime / powiadomienia / web-push                   |           394 |        187 | **47,46%** |
| 9   | Czat / komunikator                                    |         1 060 |        612 | **57,74%** |
| —   | PRZEKROJOWE: słowniki i18n                            |           184 |        109 | **59,24%** |
| 20  | Platforma / backend / infrastruktura / SSR            |         2 081 |      1 419 | **68,19%** |
| 3   | Silniki treści: bloki + page builder                  |         6 886 |      4 935 | **71,67%** |
| —   | PRZEKROJOWE: design system (components/ui)            |           234 |        169 | **72,22%** |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |         1 424 |      1 091 | **76,62%** |
| 10  | Sieć / networking                                     |           303 |        248 | **81,85%** |
| 1   | Wpisy: doświadczenie czytelnika                       |           688 |        564 | **81,98%** |
| 22  | Wydarzenia: event builder, rejestracja, onsite        |         3 946 |      3 339 | **84,62%** |
| 4   | Strony, wygląd, motyw, media, import                  |         1 008 |        896 | **88,89%** |
| 16  | Społeczność: kluby, komentarze, moderacja             |         3 351 |      2 983 | **89,02%** |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |         1 457 |      1 310 | **89,91%** |
| 5   | Strona główna, archiwa, chrome                        |           568 |        531 | **93,49%** |
| 15  | Profil i konto                                        |         1 098 |      1 041 | **94,81%** |
| 6   | Wyszukiwarka                                          |           294 |        280 | **95,24%** |
| 8   | SEO, feedy, dane strukturalne                         |           506 |        484 | **95,65%** |
| 18  | CRM                                                   |         1 072 |      1 057 | **98,60%** |
| 2   | Edytor wpisów i workflow redakcyjny                   |           868 |        857 | **98,73%** |
| 11  | Newsletter i e-mail                                   |         1 572 |      1 563 | **99,43%** |

---

## 3. Pokrycie per funkcjonalność (141 funkcjonalności w 22 modułach)

Każdy wiersz to FUNKCJA PRODUKTU, nie katalog: lista plików ją realizujących jest zdefiniowana
wzorcami ścieżek. Kolumna „fn” to funkcje wywołane / wszystkie funkcje w plikach tej funkcjonalności.

### MODUŁ 1 — Wpisy: doświadczenie czytelnika · linie 84,35% · funkcje 81,98%

**Rodzaje testów:** jednostkowy 34 · komponentowy 15 · hooka 8 · dostępności 1.

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

### MODUŁ 3 — Silniki treści: bloki + page builder · linie 76,41% · funkcje 71,67%

**Rodzaje testów:** komponentowy 133 · jednostkowy 127 · hooka 13 · parytetu 8 · bramki 3 · dostępności 2 · dymny 1.

**Co tu decyduje:** decyduje **test parytetu**: rejestr widgetów, panel właściwości i renderer to trzy artefakty, które muszą mówić to samo, a rozjazd „panel ustawia, renderer ignoruje” łapie wyłącznie porównanie dwóch stron (`check:widget-fidelity`, `settingsFidelity.gate`). Test jednostkowy schematu i test komponentu widgetu są konieczne, ale ani jeden, ani drugi nie zauważy dryfu między nimi.

**Bez tego rodzaju przechodzi taki defekt:** panel zapisuje ustawienie pod kluczem `heightMobile`, renderer czyta `mobileHeight`. Oba pliki mają testy, oba są zielone, a strona na telefonie ignoruje ustawienie — to dokładnie ta klasa defektu, dla której powstała bramka `check:widget-fidelity`.

| Funkcjonalność                                         | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |      Linie | fn (szt.) |
| ------------------------------------------------------ | -----: | ---------: | -----: | ----: | ------: | ---------: | --------: |
| CMS: builder sidebara + wzorce                         |      7 |        238 |  73,1% | 66,8% |   69,7% |  **74,4%** |    92/132 |
| CMS: import z Gutenberga / WordPressa                  |     10 |      1 309 |  78,1% | 74,5% |   79,6% |  **79,4%** |   199/250 |
| CMS: silnik treści publicznej (contentEngine)          |     20 |        525 |  79,8% | 77,9% |   82,6% |  **81,0%** |   100/121 |
| CMS: zapytania danych widgetów                         |      8 |        459 |  78,3% | 68,8% |   87,9% |  **83,2%** |   123/140 |
| CMS: design tokens / kolory globalne / typografia      |      6 |        257 |  85,5% | 81,6% |   85,0% |  **87,9%** |     34/40 |
| CMS: widgety buildera — render publiczny               |     55 |      3 596 |  90,3% | 82,6% |   87,0% |  **92,1%** |   692/795 |
| CMS: page builder (typ Elementor) — schemat i operacje |     11 |        650 |  89,4% | 69,6% |   99,7% |  **96,9%** |   294/295 |
| CMS: panele właściwości widgetów                       |    112 |      4 671 |  96,5% | 93,2% |   95,0% |  **97,3%** | 1972/2076 |
| CMS: sanityzacja HTML                                  |      4 |        157 |  93,9% | 88,1% |   90,6% |  **97,5%** |     29/32 |
| CMS: render bloków (publiczny)                         |     39 |      1 920 |  97,3% | 93,8% |   96,1% |  **98,1%** |   498/518 |
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
| Wydarzenia (RSVP, waitlist, ICS) |    199 |      5 973 |  86,3% | 80,4% |   89,0% |  **88,4%** | 1768/1987 |
| Quiz / mapy                      |      5 |        251 |  92,8% | 88,0% |   88,7% |  **94,4%** |     55/62 |
| Huby ekspertów                   |     26 |        820 |  97,0% | 89,4% |   95,7% |  **97,9%** |   244/255 |
| Tracker legislacyjny             |      9 |        235 |  99,3% | 96,1% |  100,0% | **100,0%** |     95/95 |
| Programy badawcze                |      4 |         31 | 100,0% | 96,6% |  100,0% | **100,0%** |     14/14 |
| Web stories                      |      3 |         98 |  99,2% | 96,3% |  100,0% | **100,0%** |     30/30 |
| Biblioteka plików                |      7 |        248 |  99,7% | 91,0% |  100,0% | **100,0%** |     76/76 |

### MODUŁ 8 — SEO, feedy, dane strukturalne · linie 96,67% · funkcje 95,65%

**Rodzaje testów:** jednostkowy 49 · dostępności 8 · funkcji serwerowej 4 · hooka 2 · warstwy danych 1 · komponentowy 5.

**Co tu decyduje:** tu **e2e jest niezastępowalne**: JSON-LD, hreflang i sitemapy dowodzi się bajtami, które wyszły z SSR, a nie wywołaniem funkcji budującej `<head>`. Testy jednostkowe (35 plików) pilnują kształtu danych, `e2e/seo.spec.ts` pilnuje tego, co widzi robot.

**Bez tego rodzaju przechodzi taki defekt:** funkcja budująca `<head>` zwraca poprawny JSON-LD, a SSR go nie emituje albo emituje dwa razy. Test jednostkowy nie widzi bajtów, które wyszły z serwera — a robot widzi wyłącznie je.

| Funkcjonalność               | Plików | LOC mierz. | Instr. |   Gał. | Funkcje |      Linie | fn (szt.) |
| ---------------------------- | -----: | ---------: | -----: | -----: | ------: | ---------: | --------: |
| Feedy i sitemapy             |      8 |        130 |  60,4% |  40,6% |   37,5% |  **61,5%** |      9/24 |
| SEO: meta, JSON-LD, hreflang |     46 |      1 397 |  98,8% |  96,4% |   99,0% |  **99,3%** |   296/299 |
| Udostępnianie / OG           |      5 |        216 |  99,2% |  98,4% |  100,0% | **100,0%** |     65/65 |
| Monitor linków               |      2 |         18 | 100,0% | 100,0% |  100,0% | **100,0%** |       8/8 |

### MODUŁ 9 — Czat / komunikator · linie 62,31% · funkcje 57,74%

**Rodzaje testów:** jednostkowy 16 · hooka 8 · komponentowy 12.

**Co tu decyduje:** wzorcowa mieszanka po refaktorze: **test warstwy danych z atrapą łańcucha PostgREST** (kształt zapytania), **test hooka** (kolejność wiadomości, deduplikacja optymistyczna) i **test jednostkowy reguł wątku**. To ten zestaw, nie sam wzrost liczby testów, wyciągnął moduł z 17% na poziom z progami per plik.

**Bez tego rodzaju przechodzi taki defekt:** zapytanie o wiadomości gubi filtr rozmowy. RLS je odrzuci, więc objawem nie będzie wyciek, ale pusty czat u wszystkich — i wyjdzie to dopiero na produkcji, bo w teście bez atrapy łańcucha nikt nie sprawdził kształtu zapytania.

| Funkcjonalność                                  | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |      Linie | fn (szt.) |
| ----------------------------------------------- | -----: | ---------: | -----: | ----: | ------: | ---------: | --------: |
| Czat: okno rozmowy i atomy UI                   |     35 |      1 507 |  45,2% | 38,7% |   40,7% |  **46,2%** |   212/521 |
| Czat: kompozytor + wzmianki                     |     10 |        229 |  81,6% | 68,8% |   77,2% |  **84,3%** |     44/57 |
| Czat: warstwa danych (rozmowy, wiadomości)      |      3 |        374 |  92,3% | 83,3% |   95,6% |  **97,6%** |   130/136 |
| Czat: reguły wątku (kolejność, separator, skok) |      5 |        159 |  99,5% | 98,5% |   97,5% | **100,0%** |     39/40 |

### MODUŁ 10 — Sieć / networking · linie 83,65% · funkcje 81,85%

**Rodzaje testów:** komponentowy 17 · hooka 3 · jednostkowy 2 · bramki 1.

**Co tu decyduje:** warstwa danych jest RPC-only, więc **test warstwy danych** dowodzi kontraktu czasowników i prywatności odmów zaproszeń — a **test komponentowy** dowodzi, że odmowa nie wycieka do UI. Oba są objęte progiem 95/98, dlatego moduł nie osuwa się między wydaniami.

**Bez tego rodzaju przechodzi taki defekt:** polityka poprawnie odrzuca zaproszenie, a interfejs pokazuje powód odmowy zawierający dane osoby, która odrzuciła. Prywatność łamie się w warstwie, której polityka bazy nie widzi.

| Funkcjonalność                             | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ------------------------------------------ | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Sieć kontaktów (zaproszenia, obserwowanie) |     30 |        712 |  94,1% | 86,5% |   98,0% | **98,5%** |   248/253 |

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
| E-maile systemowe / transakcyjne                   |     38 |      1 014 |  99,5% | 98,7% |   99,6% |  **99,6%** |   264/265 |
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

### MODUŁ 13 — Monetyzacja: checkout / subskrypcje / billing · linie 67,04% · funkcje 76,62%

**Rodzaje testów:** komponentowy 37 · funkcji serwerowej 25 · jednostkowy 26 · warstwy danych 4 · dostępności 2 · hooka 1 · parytetu 1.

**Co tu decyduje:** ścieżka płatność → dostęp ma **testy funkcji serwerowych** z wysokimi progami (webhook Stripe, grant) i to jest właściwy rodzaj dowodu dla pieniędzy. Ale rezygnacja, zmiana planu i faktury to **testy komponentowe**: UI może pokazać „anulowano”, gdy żądanie padło, a żaden test serwerowy tego nie zauważy.

**Bez tego rodzaju przechodzi taki defekt:** anulowanie subskrypcji pokazuje „anulowano”, choć żądanie padło. Użytkownik jest przekonany, że nie płaci, i wraca po miesiącu z reklamacją i chargebackiem — a test funkcji serwerowej niczego nie zgłosił, bo funkcja nigdy nie została wywołana.

| Funkcjonalność                              | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ------------------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Billing: rekoncyliacja i panel              |    116 |      3 866 |  62,8% | 59,5% |   78,4% | **64,4%** |   637/812 |
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

### MODUŁ 15 — Profil i konto · linie 97,64% · funkcje 94,81%

**Rodzaje testów:** komponentowy 29 · dostępności 11 · jednostkowy 17 · hooka 7 · funkcji serwerowej 3 · bramki 4 · warstwy danych 1.

**Co tu decyduje:** konto to **testy inwariantów i bramek** (guard weryfikacji profilu, izolacja tenanta) plus **pgTAP** dla eksportu danych i RODO. Sam procent pokrycia mówi tu mniej niż odpowiedź na pytanie, czy inwariant „profil niezweryfikowany nie widzi X” ma test, który pada przy każdym złamaniu reguły w dowolnym miejscu.

**Bez tego rodzaju przechodzi taki defekt:** jedna nowa trasa zapomina guardu weryfikacji i profil niezweryfikowany widzi dane, których nie powinien. Każda pojedyncza funkcja działa poprawnie — złamana jest reguła, nie funkcja, więc żaden test funkcji tego nie wykryje.

| Funkcjonalność                                | Plików | LOC mierz. | Instr. |   Gał. | Funkcje |      Linie | fn (szt.) |
| --------------------------------------------- | -----: | ---------: | -----: | -----: | ------: | ---------: | --------: |
| Profil użytkownika                            |     41 |      1 455 |  92,9% |  89,4% |   89,5% |  **94,1%** |   459/513 |
| LOGIN: formularze auth w CMS (bloki + widget) |      3 |        367 |  97,0% |  90,2% |   93,9% |  **98,1%** |     77/82 |
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

### MODUŁ 20 — Platforma / backend / infrastruktura / SSR · linie 75,55% · funkcje 68,19%

**Rodzaje testów:** komponentowy 39 · jednostkowy 125 · warstwy danych 18 · funkcji serwerowej 21 · dostępności 5 · bramki 5 · parytetu 2.

**Co tu decyduje:** platforma utrzymuje **bramki (meta-inwarianty)**: „bramka, która istnieje, musi się uruchamiać”, parytet konfiguracji chunków, kontrakt zmiennych workflow. To rodzaj testu, który skaluje się z repozytorium, nie z liczbą przypadków — jeden taki test pilnuje wszystkich przyszłych plików.

**Bez tego rodzaju przechodzi taki defekt:** bramka istnieje w repozytorium i nie jest wpięta w workflow, więc zdanie „mamy to sprawdzone” jest fałszywe przez wiele miesięcy. Nikt tego nie zauważy, bo brak sygnału nie wygląda jak awaria — i to jest defekt, którego nie wykryje żaden test kodu produkcyjnego.

| Funkcjonalność                          | Plików | LOC mierz. | Instr. |   Gał. | Funkcje |      Linie | fn (szt.) |
| --------------------------------------- | -----: | ---------: | -----: | -----: | ------: | ---------: | --------: |
| Routing / trasy publiczne (powłoka)     |      8 |        423 |  26,6% |  17,2% |   16,0% |  **27,4%** |    17/106 |
| A11y / watchdog / MCP                   |      9 |        164 |  39,6% |  29,9% |   31,0% |  **42,1%** |      9/29 |
| Klient Supabase / zapytania             |     27 |        959 |  69,4% |  64,5% |   73,7% |  **71,7%** |   205/278 |
| Warstwa serwerowa (server fns)          |     19 |        980 |  76,3% |  71,3% |   79,5% |  **76,7%** |   175/220 |
| Obsługa błędów / error boundary         |      7 |        115 |  78,0% |  76,4% |   65,5% |  **77,4%** |     19/29 |
| SSR / hydracja / cache brzegowy         |     32 |      1 160 |  83,2% |  79,3% |   82,4% |  **84,8%** |   183/222 |
| Bramki CI (rejestry, kontrakty)         |     32 |      3 107 |  93,4% |  86,6% |   93,1% |  **94,9%** |   528/567 |
| Podgląd sesji / heartbeat               |      2 |        148 |  98,8% |  95,1% |  100,0% |  **99,3%** |     27/27 |
| Lista lektur / kolekcje (warstwa reguł) |      2 |         10 | 100,0% | 100,0% |  100,0% | **100,0%** |       8/8 |

### MODUŁ 21 — Rekrutacja / kariera · linie 55,12% · funkcje 47,13%

**Rodzaje testów:** jednostkowy 9 · dostępności 2.

**Co tu decyduje:** rekrutacja to **testy jednostkowe** walidacji zgłoszenia plus **testy a11y** formularza (to najczęściej wypełniany formularz przez osoby z zewnątrz) i **harness pgTAP** na ścieżce zapisu — bramka istnieje właśnie dlatego, że złamany CHECK w bazie przeszedł kiedyś przy zielonym CI.

**Bez tego rodzaju przechodzi taki defekt:** złamany CHECK w bazie przechodzi przy zielonym CI i formularz zgłoszenia przestaje przyjmować kandydatów. Błąd wychodzi z produkcji, nie z suity — bramka `check:pg-harness` istnieje dokładnie z tego powodu.

| Funkcjonalność                   | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| -------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Kariera: ogłoszenia i zgłoszenia |     26 |        576 |  80,1% | 80,2% |   73,2% | **81,3%** |   164/224 |

### MODUŁ 22 — Wydarzenia: event builder, rejestracja, onsite · linie 84,78% · funkcje 84,62%

**Rodzaje testów:** dostępności 62 · jednostkowy 85 · komponentowy 52 · hooka 13 · funkcji serwerowej 8 · parytetu 7 · bramki 7 · warstwy danych 2.

**Co tu decyduje:** cała poprawność tego modułu mieszka w BAZIE — 42 tabele z RLS, 212 funkcji SQL, pięć ograniczeń `EXCLUDE` (kolizja sali, miejsce przy stole, uczestnik spotkania, okno dostępności, deduplikacja check-inu). Test jednostkowy frontu nie zobaczy z tego nic, więc decydują trzy rodzaje, których w innych modułach prawie nie ma: **uprząż replayu migracji** (`check:events-harness` — 1 001 asercji runtime w 14 plikach na czystym Postgresie, dobierająca migracje po TREŚCI, nie po nazwie pliku), **bramka parytetu stałych z ograniczeniami CHECK** (kolumny wyliczeniowe są typu `text`, więc kompilator nigdy nie zobaczy, że panel oferuje wartość, której baza nie przyjmie) i **test warstwy danych z atrapą PostgREST** na 115 modułach `lib/events`.

**Bez tego rodzaju przechodzi taki defekt:** panel oferuje wartość, której baza nie przyjmie. To nie jest hipoteza: `PACKAGE_AUDIENCES` w kliencie miało `company / university / delegation / partner`, a `CHECK` w bazie dopuszczał `public / member / academic / ngo / company` — **trzy z czterech opcji dialogu kończyły się naruszeniem ograniczenia**, a przebieg szczęśliwy działał wyłącznie dlatego, że `company` jest wartością domyślną. Obok tego `BADGE_PAPER_FORMATS` oferowało format, którego CHECK nie zna, i ukrywało cztery, które zna. Nad każdą z tych list stał komentarz obiecujący „odwzorowanie jeden do jednego”. Komentarz nie jest bramką.

| Funkcjonalność                                  | Plików | LOC mierz. | Instr. |   Gał. | Funkcje |      Linie | fn (szt.) |
| ----------------------------------------------- | -----: | ---------: | -----: | -----: | ------: | ---------: | --------: |
| Publiczny portal wydarzenia                     |     60 |      1 133 |  65,2% |  62,2% |   60,5% |  **66,5%** |   256/423 |
| Bilety, pakiety, wejściówki (pieniądze)         |     30 |        955 |  67,6% |  65,2% |   75,3% |  **70,1%** |   244/324 |
| Katalog wydarzeń, typy, tworzenie               |     24 |        629 |  77,0% |  82,3% |   73,2% |  **76,3%** |   199/272 |
| Rejestracja: formularz, pola, zgody, decyzje    |     38 |      1 303 |  75,1% |  72,0% |   68,6% |  **77,1%** |   273/398 |
| Studio wydarzenia: rama, moduły, gotowość       |     28 |        569 |  86,9% |  78,9% |   83,9% |  **87,0%** |   177/211 |
| Branding, strony i menu wydarzenia              |     12 |        435 |  89,4% |  86,6% |   83,6% |  **89,4%** |   158/189 |
| Giełda spotkań 1-1                              |     32 |        950 |  88,1% |  85,8% |   93,6% |  **91,4%** |   366/391 |
| Sponsorzy i partnerzy                           |     16 |        595 |  88,8% |  83,1% |   93,9% |  **92,1%** |   248/264 |
| Agenda: sesje, ścieżki, sale, konflikty         |     28 |      1 054 |  90,8% |  85,8% |   94,9% |  **92,5%** |   392/413 |
| Informacje ogólne, strefa czasowa, adres        |     10 |        290 |  92,9% |  93,8% |   95,3% |  **93,4%** |   101/106 |
| Odprawa na miejscu: skan, identyfikatory, leady |     49 |      1 586 |  92,5% |  92,3% |   95,5% |  **93,7%** |   536/561 |
| Powierzchnia uczestnika (moje wydarzenie)       |     21 |        445 |  92,4% |  87,2% |   97,0% |  **93,9%** |   162/167 |
| Regulaminy, grupy i uprawnienia uczestników     |     18 |        492 |  95,0% |  94,7% |   96,9% |  **95,3%** |   219/226 |
| Widgety wydarzeń w builderze stron              |     10 |        547 |  93,3% |  83,9% |   95,0% |  **97,4%** |   170/179 |
| Analityka, komunikacja, integracje wydarzenia   |      4 |         33 | 100,0% | 100,0% |  100,0% | **100,0%** |       9/9 |

---

## 4. Zoom na powierzchnie wskazane w zleceniu

Dla pięciu obszarów wymienionych imiennie (newsletter, popup, CMS builder — Gutenberg i Elementor,
kluby dyskusyjne, login/rejestracja/wylogowanie) rozbicie schodzi do POJEDYNCZYCH FUNKCJI:
wypisuję nazwy funkcji, które nie mają ani jednego wywołania w całej suicie.

### 4.1 Newsletter (MODUŁ 11)

Razem: **3 849 / 3 868 linii = 99,51%**, funkcje **1238/1248 = 99,20%**.

**Newsletter: telemetria (open/click, engagement)** — linie 98,3%, funkcje 28/28 (100,0%), plików 8 (bez pokrycia: 0), LOC 119

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

**Newsletter: doręczalność (SPF/DKIM, bounces)** — linie 98,8%, funkcje 22/23 (95,7%), plików 2 (bez pokrycia: 0), LOC 85

> Bez ani jednego wywołania: **1 funkcji** (0 nazwanych, 1 anonimowych domknięć).

**Newsletter: panel admina** — linie 99,2%, funkcje 710/715 (99,3%), plików 49 (bez pokrycia: 0), LOC 1 563

> Bez ani jednego wywołania: **5 funkcji** (0 nazwanych, 5 anonimowych domknięć).

**E-maile systemowe / transakcyjne** — linie 99,6%, funkcje 264/265 (99,6%), plików 38 (bez pokrycia: 0), LOC 1 014

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

Razem: **13 513 / 14 527 linii = 93,02%**, funkcje **4257/4624 = 92,06%**.

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

**CMS: design tokens / kolory globalne / typografia** — linie 87,9%, funkcje 34/40 (85,0%), plików 6 (bez pokrycia: 0), LOC 257

> Bez ani jednego wywołania: **6 funkcji** (1 nazwanych, 5 anonimowych domknięć). Nazwane:
>
> - `clearAllLiveWidgetTypography @ src/lib/builder/liveTypography.ts:95`

**CMS: widgety buildera — render publiczny** — linie 92,1%, funkcje 692/795 (87,0%), plików 55 (bez pokrycia: 0), LOC 3 596

> Bez ani jednego wywołania: **103 funkcji** (18 nazwanych, 85 anonimowych domknięć). Nazwane, pierwsze 14:
>
> - `resolveSpan @ src/components/builder/organisms/BuilderRenderer.tsx:78`
> - `resolveOrder @ src/components/builder/organisms/BuilderRenderer.tsx:88`
> - `BuilderEmptyPickerProvider @ src/components/builder/organisms/BuilderRenderer.tsx:163`
> - `deviceForWidth @ src/components/builder/organisms/BuilderRenderer.tsx:184`
> - `BuilderRenderer @ src/components/builder/organisms/BuilderRenderer.tsx:204`
> - `BuilderDebugOverlay @ src/components/builder/organisms/BuilderRenderer.tsx:285`
> - `SectionsList2 @ src/components/builder/organisms/BuilderRenderer.tsx:335`
> - `ExperimentSection @ src/components/builder/organisms/BuilderRenderer.tsx:405`
> - `SectionBackgroundVideo @ src/components/builder/organisms/BuilderRenderer.tsx:440`
> - `RenderSection2 @ src/components/builder/organisms/BuilderRenderer.tsx:483`
> - `RenderInner2 @ src/components/builder/organisms/BuilderRenderer.tsx:713`
> - `RenderColumn2 @ src/components/builder/organisms/BuilderRenderer.tsx:779`
> - `shallowEqual @ src/components/builder/organisms/BuilderWidgetNode.tsx:32`
> - `widgetsEqual @ src/components/builder/organisms/BuilderWidgetNode.tsx:46`

**CMS: page builder (typ Elementor) — schemat i operacje** — linie 96,9%, funkcje 294/295 (99,7%), plików 11 (bez pokrycia: 0), LOC 650

> Bez ani jednego wywołania: **1 funkcji** (0 nazwanych, 1 anonimowych domknięć).

**CMS: panele właściwości widgetów** — linie 97,3%, funkcje 1972/2076 (95,0%), plików 112 (bez pokrycia: 0), LOC 4 671

> Bez ani jednego wywołania: **104 funkcji** (0 nazwanych, 104 anonimowych domknięć).

**CMS: sanityzacja HTML** — linie 97,5%, funkcje 29/32 (90,6%), plików 4 (bez pokrycia: 0), LOC 157

> Bez ani jednego wywołania: **3 funkcji** (0 nazwanych, 3 anonimowych domknięć).

**CMS: render bloków (publiczny)** — linie 98,1%, funkcje 498/518 (96,1%), plików 39 (bez pokrycia: 0), LOC 1 920

> Bez ani jednego wywołania: **20 funkcji** (0 nazwanych, 20 anonimowych domknięć).

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

Razem: **1 008 / 1 015 linii = 99,31%**, funkcje **247/253 = 97,63%**.

**LOGIN: formularze auth w CMS (bloki + widget)** — linie 98,1%, funkcje 77/82 (93,9%), plików 3 (bez pokrycia: 0), LOC 367

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
| `src/routes/qa.$slug.tsx`                                      |           82 | M7                                                 |
| `src/lib/billing/donationsAdmin.server.ts`                     |           81 | M13                                                |

Łącznie plików produkcyjnych z pokryciem **0%: 451** z 3 212 (14,04%).

### 5.2 Katalogi bez ANI JEDNEGO pliku testowego

Sygnał niezależny od pokrycia: katalog może mieć pokrycie z testu innego katalogu, ale nie ma
testu WŁASNEGO — czyli nikt nie testuje go wprost. Takich katalogów jest **67**,
obejmują **96 plików / 25 588 linii**.

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

### 5.4 Zera modułu wydarzeń: 144 → 72, a dług w nich — 1 198 → 142 linie

W wydaniu 6 ten rozdział argumentował, że 144 zera modułu wydarzeń to nie 144 problemy, bo są
trzech różnych rodzajów i tylko jeden jest długiem. Rok później nie trzeba już argumentować:
**dług został spłacony, a kategorie, które długiem nie były, w większości zostały.**

| Gdzie                                       | Plików 0% wyd. 6 |  teraz | Linii bez pokrycia teraz |
| ------------------------------------------- | ---------------: | -----: | -----------------------: |
| Organizmy panelu (`admin/events/organisms`) |               34 |  **4** |                  **142** |
| Rama studia (`admin/events/studio`)         |                8 |  **2** |                       21 |
| Trasy (cienkie opakowania)                  |               66 |     57 |                      335 |
| Pozostałe                                   |               36 |      9 |                      158 |
| **Razem**                                   |          **144** | **72** |                  **656** |

Cztery organizmy, które zostały, nie są przypadkowe — to dokładnie te dwie funkcjonalności,
na których praca się urwała: `EventPackagesPanel` (59 linii), `EventRegistrationSettingsPanel`
(47), `RegistrationFieldsPanel` (33) i `EventPackagesPanel`-owe sąsiedztwo biletów
(`EventTicketPurchase` 51 linii, `EventTicketCard` 32 — obie w module społeczności, obie
na ścieżce pieniędzy). Pozostałe 57 zer to trasy o łącznej objętości 335 linii, średnio
niecałe sześć linii na plik: `createFileRoute` plus render organizmu, który sam jest pokryty.

**To jest wzorzec do skopiowania w module 14** (rozdz. 8.1): zera w cienkich trasach są tanie
i mało znaczą, dopóki logika siedzi w organizmach. Moduł 14 ma sytuację odwrotną — 221 z 467
jego funkcji siedzi w PIĘCIU plikach tras — i dlatego jego zera są drogie.

---

### 5.5 Dwie ścieżki zapisu na wydarzenie — znalezisko wydania 6, ZAMKNIĘTE

Wydanie 6 opisywało tu defekt klasy „pieniądze”: `event_rsvps` (legacy) i `event_registrations`
(etap 4) żyły obie, stara ścieżka miała działający zakup biletu przez Stripe, a nowa **nie miała
ani jednego odwołania do bramki płatniczej** — płatny bilet kończył się ekranem z kwotą i zdaniem
„nie masz jeszcze wejściówki”, bez linku do kasy. Tydzień wcześniej ta sama ścieżka wydawała
płatny bilet ZA DARMO, z działającym kodem QR, i zostało to domknięte poprawnie — przez
zatrzymanie ścieżki, nie przez wydawanie biletów.

**Na tym HEAD pętla jest domknięta.** Zweryfikowane w kodzie, nie przyjęte z raportu:

| Element                                  | Stan                                                                                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Przejście do kasy z ekranu potwierdzenia | `components/events/registration/molecules/RegistrationPayAction.tsx` — nowy                                                              |
| Kwota liczona po stronie bazy            | `event_ticket_checkout_quote`; klient wysyła wyłącznie identyfikatory                                                                    |
| Dowiązanie wpłaty do zgłoszenia          | `registration_id` w `payment_orders.metadata` (`checkout.functions.ts:408`) i dopasowanie po nim w `payments_apply_event_ticket_outcome` |
| Gość bez konta                           | odmowa `payment_account_required` PRZED powstaniem wiersza, z prawdziwym powodem (do wejściówki należy paragon i zwrot)                  |
| Powrót do niezapłaconego zgłoszenia      | trzy wejścia: ekran potwierdzenia, `/events/<slug>/manage`, panel „Moje zgłoszenia”                                                      |
| Dowód                                    | `e2e/event-paid-registration.spec.ts` + asercja uprzęży `events-harness/runtime_test.d/25_payment_binding.sql`                           |

Domknięcie kosztowało dwie migracje: `20260830090000_event_registration_checkout_binding.sql`
(1 119 linii) i `20260830110000_event_payment_outcome_order_conflict.sql` (362 linie). Druga
powstała dlatego, że samo dowiązanie po `registration_id` ujawniło dwa dalsze defekty klasy P1:
zaksięgowanie wpłaty na zgłoszeniu opłaconym już INNYM zamówieniem (dziś odmowa
`already_settled_by_another_order`) oraz zwrot z cudzego zamówienia (`refund_for_other_order`).
Kod QR powstaje teraz wyłącznie dla wiersza, który naprawdę zostanie wpuszczony.

Dowiązanie po `registration_id` nie jest kosmetyką. Przed nim funkcja księgująca dopasowywała
wpłatę **po osobie**, z `LIMIT 1` po dacie utworzenia — uczestnik z dwoma zgłoszeniami na to samo
wydarzenie dostawał opłacony bilet przypięty do najnowszego wiersza, niekoniecznie tego, za który
zapłacił.

**Jedna rzecz z tego wątku została OTWARTA — świadomie i z dokumentem.** Księgowanie wpłaty
nie sprawdza puli miejsc. Pula **typu wejściówki** i pojemność **całego wydarzenia** to dwa różne
limity, a istniejący `refundIfOversold` pilnuje tylko drugiego: przy wyczerpanej puli i wolnym
wydarzeniu pieniądze zostają pobrane, zgłoszenie zostaje `pending/unpaid` bez kodu QR, zwrotu
nie ma i powiadomienia nie ma. Zarejestrowane jako defekt, nie naprawione po cichu — pełne
rozstrzygnięcie w `docs/DECYZJA_NADSPRZEDAZ_PULI_WEJSCIOWEK_2026-08-30.md`.

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
| M22                                   |                  6 |                  88 |                   96 |
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
| `src/lib/events/**`                               |     82 |   77 |      87 |    85 | M22                                   |
| `src/components/events/**`                        |     82 |   75 |      79 |    83 | M22                                   |
| `src/components/events/packages/**`               |     94 |   90 |      96 |    96 | M22                                   |
| `src/components/admin/events/**`                  |     87 |   85 |      86 |    88 | M22                                   |
| `src/components/admin/events/molecules/**`        |     95 |   92 |      95 |    95 | M22                                   |
| `src/components/admin/events/organisms/**`        |     85 |   85 |      82 |    86 | M22                                   |

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

**W WYDANIU 6 ta sama bramka zadziałała w drugą stronę — i to był jej pierwszy udokumentowany
sukces.** Osiem naruszeń w dwóch grupach ścieżek: `src/components/profile/**` (zdublowana
szuflada profilu — linie 91,59% wobec progu 93, funkcje 85,43% wobec 87, gałęzie 83,09% wobec 89)
i `src/components/admin/billing/**` (`WebhookHealthPanel.tsx` wszedł na `main` bez testu, 25 linii,
0 z 4 funkcji, i sam jeden zbił katalog do 88,3% wobec progu 97).

**W TYM WYDANIU obie sprawy są zamknięte i bramka jest w całości zielona.**
Wątek szuflady profilu okazał się problemem TESTU, nie produktu (rozdz. 1): dwa pasy są
zamierzone, zapytania testów były niejednoznaczne. Plik jest dziś zielony (62 testy),
a panel rozliczeń pokryty nowym
testem zamiast obniżeniem progu — katalog stoi dziś na 97,4 / 88,5 / 98,1 / 98,4.
Cykl zamknął się więc w komplecie i jest to najlepszy dostępny dowód, że mechanizm działa:
**próg złapał regresję, regresja została cofnięta pracą testową, próg został na miejscu.**

Warto zapisać jedną rzecz o kosztach, bo ona nie jest darmowa. Regresja panelu rozliczeń
blokowała bramkę `verify` na **każdym** PR-ze wychodzącym z tego `main`, nie tylko na tym,
który ją wprowadził. Próg per-ścieżka jest bramką współdzieloną: kto go zbije, blokuje wszystkich.
To argument za tym, żeby progi stały gęsto i nisko, a nie rzadko i wysoko.

**Sprostowanie do wydania 6.** Opisując tamte osiem naruszeń napisałem, że MODUŁ 15 zregresował
z 97,42% na 96,15%. Liczba modułowa była błędna — moduł stał na 97,50%. Prawdziwe było
naruszenie progu ŚCIEŻKOWEGO i dziesięć czerwonych testów pod nim. Mechanizm, przez który
procent modułu tego nie pokazał, opisuje rozdział 1; jest to argument NA RZECZ progów
per-ścieżka, a nie przeciw nim.

I nota, którą repo zapisało samo o sobie: re-floor jest odstępstwem od zasady „progi wolno tylko
podnosić”. Commit to przyznaje i dodaje, że powtarzanie go zamiast pracy testowej to już „gaszenie
sygnału”. Ten audyt się z tym zgadza i zapisuje `queries.ts` — gałęzie **80,55%** — jako dług do
spłacenia testami, nie kolejnym re-floorem.

---

## 7. Sześć warstw testów — co która realnie pokrywa

| Warstwa                                         | Rozmiar                                              | Co dowodzi                                                                                                                                                                                                      | Czego NIE dowodzi                                                                                            |
| ----------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Jednostkowe / komponentowe (vitest)             | 1 863 plików, 37 517 testów, 75 051 asercji          | logikę w TS/TSX, render komponentów, kontrakty modułów                                                                                                                                                          | zachowania bazy (RLS/RPC/triggery), realnych ścieżek przeglądarki, SSR end-to-end                            |
| Baza (pgTAP)                                    | 99 plików, 1 793 asercji                             | izolację tenanta, polityki RLS, kontrakty RPC, triggery                                                                                                                                                         | kodu frontu — v8 tego pokrycia NIE liczy                                                                     |
| E2E (Playwright)                                | 9 plików, 96 testów (66 deklaracji + parametryzacje) | ścieżki użytkownika, SSR, SEO, checkout                                                                                                                                                                         | pokrycia jednostkowego (osobny proces, nie wchodzi do %)                                                     |
| Bramki statyczne (`check:*`)                    | 38 skryptów                                          | kontrakty struktury (SQL, i18n, warstwy, bundle)                                                                                                                                                                | wykonania kodu                                                                                               |
| **Uprząż replayu migracji** (`check:*-harness`) | 5 uprzęże, 1 505 asercji runtime                     | że migracje DAJĄ SIĘ WYKONAĆ na czystym Postgresie i że schemat po nich zachowuje się tak, jak deklaruje: kolizje sygnatur, funkcje bez kolumn, triggery, które nie odpalają, `EXCLUDE`, które nic nie wyklucza | kodu frontu i produkcyjnych danych — powierzchnia poza modułem jest ATRAPĄ                                   |
| Inwarianty na ŻYWEJ bazie (vitest + sekrety)    | 2 pliki, 50 testów                                   | zgodność schematu bazy z typami i parytet języków w DANYCH, nie w słownikach                                                                                                                                    | niczego bez sekretów — a ich osłona NIE odróżnia braku poświadczeń od poświadczeń zaślepkowych (patrz niżej) |

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
| komponentowy (render + interakcja)         |    654 | 14 975 |  30 974 |     2,07 | że użytkownik to zobaczy: treść, stan wyłączony, komunikat błędu, reakcja na kliknięcie       | zachowania na prawdziwej przeglądarce i prawdziwych danych z bazy        |
| jednostkowy (czysta reguła)                |    778 | 11 731 |  22 493 |     1,92 | reguły w izolacji: wejście → wyjście, przypadki graniczne, gałęzie warunków                   | że reguła jest w ogóle wywołana przez aplikację (poprawnego okablowania) |
| dostępności (axe)                          |    106 |  3 192 |   6 416 |     2,01 | kontraktu dostępności: role, etykiety, kolejność fokusu, brak naruszeń axe                    | sensu treści dla czytnika ekranu (to ocenia człowiek)                    |
| warstwy danych (atrapa PostgREST)          |     76 |  3 068 |   5 778 |     1,88 | kształtu zapytania: filtry, kolejność ogniw, limit, zachowanie przy błędzie PostgREST         | że polityka RLS na serwerze przepuści to zapytanie                       |
| hooka (renderHook)                         |     96 |  2 242 |   4 710 |     2,10 | cyklu życia i unieważniania cache: kolejność efektów, sprzątanie, ponowne pobranie po mutacji | wyglądu; hook może być poprawny, a widok nadal pokazywać stare dane      |
| funkcji serwerowej                         |     94 |  1 780 |   3 715 |     2,09 | bramek wykonania: tenant, uprawnienia, rate limit, audyt, ścieżka błędu                       | że klient wywoła funkcję w odpowiednim momencie                          |
| bramki (meta-inwariant CI)                 |     26 |    262 |     436 |     1,66 | meta-inwariantu repo: że bramka istnieje, jest wpięta i coś sprawdza                          | zachowania kodu produkcyjnego                                            |
| parytetu (dwa artefakty muszą się zgadzać) |     25 |    213 |     416 |     1,95 | ZGODNOŚCI DWÓCH ARTEFAKTÓW (panel ⇄ renderer, snapshot ⇄ migracje, PL ⇄ EN)                   | poprawności żadnej ze stron osobno — tylko tego, że się nie rozjechały   |
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
polityk i triggerów, **Playwright** (9 plików) ścieżek użytkownika i realnego SSR,
a **bramki skryptowe `check:*`** (38) kontraktów strukturalnych, w których nie ma
kodu do wykonania — na przykład tego, że każda bramka jest wpięta w workflow.

### 7.2 Rejestr defektów: 226 wpisów — i moduł, który w jedną dobę zmienił zdanie

Rozdział 7.1 argumentuje teoretycznie, że rodzaj testu waży więcej niż liczba. Ten rozdział
pokazuje, co się dzieje, gdy powierzchnia dostanie zamówioną pracę testową — i jest to
najczystszy eksperyment, jaki ta seria dała.

**Liczby, zmierzone niezależnie od raportów zespołu:** w repo jest dziś **226 wywołań `it.fails(`
w 129 plikach**, przy zerze `it.skip` i `it.todo`; przebieg wykonał 238 przypadków
„expected fail”. W wydaniu 6 było 171 wpisów w 94 plikach, w wydaniu 5 — 151 w 84, w wydaniu 4 — 24 w 20.
**Przyrost tego wydania (+55 wpisów, +35 plików) jest największy w całej serii.**

**I cała ta zmiana pochodzi z jednego modułu.** W wydaniu 6 zapisałem tu kontrapunkt: moduł 22
miał ZERO wpisów `it.fails` przy 151 plikach testowych i przeglądzie, który wypisał 165 ustaleń.
Interpretowałem to jako inną decyzję — defekty naprawiane u źródła, nie rejestrowane. Wydanie 7
pokazuje, że nie była to decyzja modułu, tylko **brak pracy, która by je znalazła**:
powierzchnia wydarzeń ma dziś **52 wpisy w 32 plikach**, gdzie miała zero — czyli blisko
połowa całego przyrostu rejestru w tym wydaniu.

Nie znalazły się dlatego, że ktoś zmienił zdanie o konwencji. Znalazły się dlatego, że ktoś
napisał testy tam, gdzie ich nie było — a test, który po raz pierwszy dotyka gałęzi odmowy,
odmowę tę czyta. Kilka z tych wpisów to defekty, których żaden przegląd czytający kod nie
wyłapał: `validateSearch` trasy skanera nie chroni komponentu, bo router **scala** parametry
z wynikiem walidatora zamiast go zastępować (wolontariusz z uciętym linkiem ląduje na odmowie
zamiast na wznowionej sesji); `agendaKeys.trackSpeakers` nie pasuje do żadnego wzorca
unieważniania, więc obsada pasma **nigdy** nie jest odświeżana; zapis w jednym wydarzeniu
wietrzy szczegóły przypięć innego, bo klucz szczegółu nie niesie identyfikatora wydarzenia.

**Wniosek jest mocniejszy niż ten z wydania 6 i częściowo go odwraca.** Napisałem wtedy, że
repozytorium ma dwie konwencje postępowania z defektem — rejestr `it.fails` i naprawę u źródła —
i że druga jest lepsza wszędzie, gdzie naprawa jest wykonalna. To nadal jest prawda, ale
kolejność jest inna, niż sugerowałem: **najpierw trzeba defekt ZNALEŹĆ, a znajdują go testy,
nie przeglądy.** Przegląd modułu wydarzeń z 28.08 przeczytał kod i wypisał 165 ustaleń; praca
testowa z 30.08 dorzuciła 64 takie, których tamten nie zobaczył — bo nie da się przeczytać
z kodu, że router scala obiekty, dopóki się go nie uruchomi.

Dla porządku: siedem ustaleń krytycznych tamtego przeglądu sprawdziłem w wydaniu 6 i wszystkie
były zamknięte, trzy z nich bramką, nie łatką. To się nie zmieniło.

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
tłem”. Wydanie 5 zastało 151, to wydanie 226. Przyrost zwolnił, ale kierunek się nie odwrócił,
a między wydaniami nie ubyło żadnego wpisu z pierwotnej dwudziestki czwórki.
Mechanizm jest przewidywalny i nie wymaga niczyjej złej woli:

1. `it.fails` przechodzi, dopóki defekt istnieje. Nic w CI nie naciska na naprawę.
2. Zapisanie defektu jest tanie i satysfakcjonujące, naprawa jest droga i wymaga decyzji.
3. Im więcej wpisów, tym mniejsza waga każdego — 226 pozycji to już nie lista, to tło.

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
| 3   | Silniki treści: bloki + page builder                 |          **5 054** |  76,41% |    71,67% |  5 007 |
| 7   | Typy treści specjalne                                |          **2 313** |  43,93% |    36,73% |    934 |
| 20  | Platforma / backend / infrastruktura / SSR           |          **2 271** |  75,55% |    68,19% |  4 597 |
| 17  | Analityka i BI                                       |          **2 080** |  32,88% |    28,41% |    199 |
| 13  | Monetyzacja: checkout / subskrypcje / billing        |          **1 776** |  67,04% |    76,62% |  1 643 |
| 22  | Wydarzenia: event builder, rejestracja, onsite       |          **1 595** |  84,78% |    84,62% |  5 268 |
| 9   | Czat / komunikator                                   |          **1 226** |  62,31% |    57,74% |    607 |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy |          **1 043** |  27,06% |    18,42% |     91 |
| 16  | Społeczność: kluby, komentarze, moderacja            |            **878** |  89,12% |    89,02% |  4 715 |
| 12  | Realtime / powiadomienia / web-push                  |            **601** |  49,54% |    47,46% |     99 |

### 8.1 Rekomendacje — kolejność, nie lista życzeń

**R1. MODUŁ 22 udowodnił mechanizm. MODUŁ 14 jest następny — i tym razem wiadomo, dlaczego stoi.**
Wydarzenia poszły w **dwadzieścia sześć godzin** z 58,96% na **84,78% linii** i z 55,25% na **84,62% funkcji**,
przy powierzchni praktycznie bez zmian (362 → 366 plików). Dziesięć z piętnastu funkcjonalności
domknięto, jedna z zera na 100%. To nie jest anomalia ani wysiłek nadzwyczajny — to jest efekt
zamówienia pracy listą, w kolejności, z regułami.

Moduł 14 (kupony / darowizny / prezenty / reklamy) stoi **siódme wydanie z rzędu na dnie**:
27,06% linii, 18,42% funkcji (najniższy wymiar funkcyjny w repo), 13 z 39 plików na zerze,
**zero progów per-ścieżka i zero wpisów `it.fails`**, 1 043 niepokryte linie, ruch od wydania 6
dokładnie **0,0 pp**. Wydanie 6 pisało, że „nikt go nie wziął". To było za łagodne. Powód jest
strukturalny i policzalny:

- **221 z 467 funkcji modułu (47%) siedzi w pięciu plikach tras, wszystkich na 0%**:
  `admin.ads.tsx` (807 linii pliku, 71 funkcji), `admin.coupons.index.tsx` (579),
  `admin.gifting.tsx` (755 linii i **ani jednego importu z `@/components/`**),
  `admin.coupons.campaigns.tsx` (551), `admin.donations.tsx` (314).
- Czysta warstwa jest **już zrobiona**: `gifting/model.ts` 97,9%, `ads/pageType.ts`,
  `dimensions.ts`, `idle.ts`, `admin-model.ts` po 100%.
- Wszystko, co dotyka bazy albo ekranu, leży: `gifting/hooks.ts` 6,0% (0 z 17 funkcji),
  `ads/queries.ts` 6,7%, `ads/consent.ts` 26,9% (9 z 53 funkcji).

Czyli: łatwa praca się skończyła, a to, co zostało, **nie ma szwów, za które można chwycić**.
Kto zacznie od testów, napisze pięć testów montujących po 800 linii naraz. Najpierw ekstrakcja
do atoms/molecules/organisms — wzorzec stoi gotowy w `src/components/admin/events/` — potem asercje.
Kontrast z modułem 22 jest tu pouczający: tam 57 z 72 zer to cienkie trasy po ~6 linii, bo logika
siedzi w organizmach (rozdz. 5.4). Tu jest odwrotnie i dlatego zera są drogie.

Dwa miejsca w tym module zasługują na pokrycie niezależnie od procentu.
`src/routes/api/public/ad-event.ts` (31 linii, **0%**, 0 z 2 funkcji) niesie sześć decyzji
bezpieczeństwa — limiter po IP, limit ciała żądania, białą listę rodzajów zdarzeń, odrzucenie
nierozpoznanego najemcy zamiast wpadania do domyślnego, weryfikację własności slotu przeciw
podszywaniu cross-tenant i weryfikację placementu — a **każda ścieżka zwraca 204 i połyka
wyjątki**. Zapis, odrzucenie i awaria wyglądają dla świata identycznie, więc regresja nie da
sygnału poza spadkiem metryk, którego nikt nie odróżni od spadku ruchu.
`src/lib/ads/consent.ts` (193 linie, 26,9%, 9 z 53 funkcji, 30% gałęzi) jest jedynym wejściem
bramki zgody reklamowej: `AdSlot.tsx:38` decyduje jednym wyrażeniem
`blocked = slot.requires_consent && !granted`, a `granted` pochodzi stąd. Logika GPC i rejestr
RODO mają siedem plików testowych w `src/lib/consent/` — warstwa CMP, która te decyzje podaje
reklamom, nie ma ani jednego.

**R2. Skok modułu 22 ominął warstwę egzekwowania — i ominął plik, o który w tym oknie chodziło.**
Przyrost 2 748 pokrytych linii rozłożył się tak: **72,5% komponenty, 18,5% reszta biblioteki,
7,2% API i funkcje serwerowe, 1,8% trasy**. Pokrycie urosło tam, gdzie zachowanie jest rysowane,
a nie tam, gdzie jest egzekwowane. Dodatkowo **68 z 82 nowych plików testowych (83%) atrapuje
własną warstwę danych** (`vi.mock` na `@/lib`, `@/components`, `@/hooks`), więc panel zdaje
egzamin wobec atrapy tego, co sam woła.

Najostrzejszy pojedynczy przypadek: commit „Domknął kasę na ścieżce zapisu etapu 4 (część A)"
zmienił `src/lib/events/publicRegistrationApi.ts`, który przeszedł z **92,10% (35 z 38 linii)
na 72,91% (35 z 48)** — przybyło dziesięć linii ścieżki pieniędzy i **ani jedna nie jest
wykonywana przez żaden test**. Liczba pokrytych linii jest identyczna co do sztuki.

Ścieżka ma dowód w innych warstwach (e2e i 40 asercji runtime w `25_payment_binding.sql`),
więc to nie jest dziura w kasie — to jest dziura w rozkładzie pracy testowej. Domknięcie warstwy
API i funkcji serwerowych modułu 22 jest tańsze niż cokolwiek innego na tej liście i powinno pójść
przed czwórką z R9.

**R3. Zapadka stanęła CAŁA — drugie wydanie z rzędu, i tym razem także per-ścieżka.**
Próg globalny stoi na `64/62/65/58` od wydania 5, przy pomiarze `76,54/71,64/75,04/77,66` —
margines urósł do ~12 pp. W wydaniu 6 pisałem, że nawyk nie zniknął, bo progi per-ścieżka rosły
dalej. **W tym wydaniu nie rosną i one: 353 → 353, liczba bez zmian**, mimo że przybyło 100 plików
testowych i mimo że dziesięć funkcjonalności modułu 22 przeskoczyło o 20–100 pp. Wartości na
ścieżkach wydarzeń podniesiono za dostawą, ale ani jedna NOWA ścieżka nie dostała własnego progu.

Żeby dziś przekroczyć zapadkę globalną w dół, repozytorium musiałoby stracić **jedną szóstą**
całego pokrycia. Bramka, która puszcza taki spadek, nie jest bramką.

To nie jest uwaga formalna i wydanie 6 dostarczyło na to dowód — który wtedy odczytałem błędnie
i prostuję w rozdz. 1 i 6.1. Dziesięć czerwonych testów szuflady profilu kosztowało moduł 15
**0,0 pp** pokrycia, bo przy `reportOnFailure: true` linie wykonane przez padający test wciąż się
liczą. Awarii nie było widać w procencie w ogóle — złapał ją wyłącznie **próg per-ścieżka**
`src/components/profile/**`. Procent modułu nie jest bramką i czerwieni nie wykrywa. Wykrywa ją
próg postawiony na tyle wąsko, żeby jeden zepsuty katalog przebił się przez średnią.

**R4. MODUŁ 21 — siódme wydanie z rzędu z ruchem 0,00 pp. To już nie jest zaległość, to wzorzec.**
55,12% linii, 47,13% funkcji, 12 z 29 plików na zerze, zero progów per-ścieżka — te same liczby
co w wydaniach 1, 2, 3, 4, 5 i 6, co do drugiego miejsca po przecinku. Najczęściej wypełniany
formularz przez osoby z zewnątrz nie zmienił pokrycia ani razu w ciągu całej serii.
Zaraz za nim MODUŁ 17 (32,88%, **0,0 pp od wydania 5**, 47 z 86 plików na zerze).

**R5. Nadsprzedaż puli wejściówek — zarejestrowana, nie naprawiona, i to jest pieniądze klienta.**
Księgowanie wpłaty nie sprawdza puli **typu wejściówki**; istniejący `refundIfOversold` pilnuje
wyłącznie pojemności całego wydarzenia. Przy wyczerpanej puli i wolnym wydarzeniu: pieniądze
pobrane, zgłoszenie zostaje `pending/unpaid` bez kodu QR, zwrotu nie ma, powiadomienia nie ma.
Rozstrzygnięcie opisano w `docs/DECYZJA_NADSPRZEDAZ_PULI_WEJSCIOWEK_2026-08-30.md` i jest to
właściwe postępowanie — decyzja o rezerwacji miejsca, świadomej nadsprzedaży albo automatycznym
zwrocie jest produktowa, nie refaktorem. Ale pozostaje **otwarta**, a stan „wzięliśmy pieniądze
i milczymy" jest najgorszym z możliwych.

**R6. `page_full_path` — siódme wydanie, nadal nietknięte, a od tego wydania nie ma już wymówki.**
Sprawdzone ponownie na mierzonym HEAD: żadna z 134 migracji tego okna nie dotyka tej funkcji
i **żaden z 99 plików pgTAP nadal jej nie wspomina**. Rekurencyjne CTE idące w górę po
`pages.parent_id` bez predykatu najemcy, `LANGUAGE sql STABLE`, wołane spod service-role.
Skutek bez zmian: strona z rodzicem u innego najemcy wnosi JEGO slug do ścieżki kanonicznej
publikowanej w sitemapie i RSS-ie.

Nowa okoliczność: repozytorium ma dziś **piątą uprząż** — `tenant-isolation-harness` — postawioną
dokładnie na tę klasę defektu. Powstała, bo audyt z 29.08 pokazał, że polityki właścicielskie
`media_mentions`, `saved_searches` i `user_follows` bramkowały wyłącznie `user_id = auth.uid()`,
mimo `NOT NULL tenant_id`: wiersz z jednego obszaru roboczego był czytelny i edytowalny z innego,
a `WITH CHECK` pozwalał **zapisać** wiersz do cudzego. Naprawione migracją `20260829091010`.
Skoro uprząż na granicę najemcy istnieje i działa, `page_full_path` należy do niej.

**R7. Osłona testów na żywej bazie myli brak poświadczeń z poświadczeniami zaślepkowymi.**
`src/__tests__/db-schema-invariant.test.ts` i `src/__tests__/lang-parity.test.ts` celowo odpytują
hostowaną bazę. Osłona brzmi `const shouldRun = Boolean(SUPABASE_URL && SUPABASE_KEY)` — i przechodzi
dla **zaślepki**. Deweloper z `.env` ustawionym na `placeholder.supabase.co`, czyli z konfiguracją,
którą repozytorium samo daje, nie dostaje „pominięto, brak poświadczeń", tylko 49 czerwonych testów
wyglądających na zepsute. Osłona ma odrzucać host zaślepkowy, a nie sprawdzać obecność zmiennej.
Jednolinijkowa zmiana warunku; dziś działa jak strzelba na własnym progu.

**R8. „Pusto" i „nie udało się wczytać" to jedna brakująca konwencja, nie 15 osobnych defektów.**
Bez zmian wobec wydań 5 i 6, bo nic się w tej sprawie nie wydarzyło — a wydanie 7 dokłada do
wzorca kolejne przypadki z modułu wydarzeń: `EventMePanel` na odmowę `event_my_agenda` mówi
o **pustej** agendzie i nie ma ani jednej gałęzi `isError`; `AgendaConflictsPanel` odcina brakujące
kolumny przez `row.x === ""`, a baza oddaje `null`; `useValidateCoupon` w module 14 mapuje **każdy**
błąd na `not_found`, więc zerwane połączenie mówi użytkownikowi, że jego kupon jest nieprawidłowy.
Naprawa jednostkowa kolejnych wystąpień nie zapobiega następnemu; naprawa konwencją — tak.

**R9. Komentarz pomiaru w `vitest.config.ts` przekroczył granicę wprowadzania w błąd.**
Config dokumentuje `68,27 / 62,80 / 66,25 / 69,28`; pomiar niezależny daje
`76,54 / 71,64 / 75,04 / 77,66`. Rozjazd urósł z 5,7 pp (wydanie 6) do **8,4 pp na liniach**.
Pisałem wtedy, że jest na granicy. Granica przekroczona: to jedyne miejsce w kodzie, z którego
czytelnik configu dowiaduje się, ile pokrycia repo ma, i mówi mu o repozytorium osiem punktów
słabszym, niż jest.

**R10. Cztery ostatnie funkcjonalności modułu 22 — praca urwała się na dziewiątej pozycji listy.**
Publiczny portal wydarzenia (66,5%, +1,3 pp, 11 z 60 plików na zerze), bilety i pakiety
(70,1%, +2,9), katalog wydarzeń (76,3%, +0,2) i rejestracja (77,1%, +0,8). Bilety to powierzchnia
pieniędzy i `EventPackagesPanel` (59 linii), `EventTicketPurchase` (51) oraz `EventTicketCard` (32)
stoją na zerze. Domknięcie tej czwórki jest tanie w porównaniu z tym, co już zrobiono, i kończy
moduł.

**R11. Sprawdzić, czy naprawa izolacji najemcy była kompletna.**
Migracja `20260829091010` naprawiła trzy tabele. Wzorzec defektu — polityka właścicielska
bramkująca wyłącznie `user_id = auth.uid()` na tabeli z `NOT NULL tenant_id` — jest mechaniczny
i da się go przeszukać. Uprząż `tenant-isolation-harness` już stoi i przyjmie kolejne asercje bez
budowania czegokolwiek od nowa. To najtańsza możliwa praca bezpieczeństwa w tym repozytorium:
zapytanie po `pg_policies`, lista kandydatów, asercja na każdego.

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
| **wzorowo**       | 99,0 | 2. Edytor wpisów i workflow redakcyjny                    | 99,3% |   98,7% |     21 |               6 |     0/103 |
| **wzorowo**       | 98,8 | 18. CRM                                                   | 99,0% |   98,6% |      1 |               6 |      0/59 |
| **wzorowo**       | 96,1 | 6. Wyszukiwarka                                           | 97,4% |   95,2% |      8 |               5 |      0/25 |
| **wzorowo**       | 96,1 | 8. SEO, feedy, dane strukturalne                          | 96,7% |   95,7% |     20 |               6 |      5/78 |
| **wzorowo**       | 95,9 | 15. Profil i konto                                        | 97,6% |   94,8% |     40 |               7 |      2/94 |
| **wzorowo**       | 94,7 | 5. Strona główna, archiwa, chrome                         | 96,5% |   93,5% |      1 |               5 |      1/62 |
| **wzorowo**       | 91,2 | 19. Ustawienia / integracje / users / multi-tenant / RODO | 93,2% |   89,9% |     36 |               7 |    14/131 |
| **wzorowo**       | 90,3 | 4. Strony, wygląd, motyw, media, import                   | 92,3% |   88,9% |      2 |               6 |     4/133 |
| **dobrze**        | 89,1 | 16. Społeczność: kluby, komentarze, moderacja             | 89,1% |   89,0% |     11 |               8 |    16/306 |
| **dobrze**        | 84,7 | 22. Wydarzenia: event builder, rejestracja, onsite        | 84,8% |   84,6% |      6 |               8 |    72/366 |
| **dobrze**        | 82,9 | 1. Wpisy: doświadczenie czytelnika                        | 84,4% |   82,0% |     27 |               4 |    13/104 |
| **dobrze**        | 82,6 | 10. Sieć / networking                                     | 83,7% |   81,8% |      2 |               4 |      3/32 |
| **dobrze**        | 75,5 | design system (components/ui)                             | 80,4% |   72,2% |      0 |               1 |      4/44 |
| **przeciętnie**   | 73,6 | 3. Silniki treści: bloki + page builder                   | 76,4% |   71,7% |     18 |               7 |    68/460 |
| **przeciętnie**   | 72,8 | słowniki i18n                                             | 93,1% |   59,2% |      0 |               2 |     1/134 |
| **przeciętnie**   | 72,8 | 13. Monetyzacja: checkout / subskrypcje / billing         | 67,0% |   76,6% |     21 |               7 |    34/190 |
| **przeciętnie**   | 71,1 | 20. Platforma / backend / infrastruktura / SSR            | 75,6% |   68,2% |     44 |               7 |    46/201 |
| **przeciętnie**   | 59,6 | 9. Czat / komunikator                                     | 62,3% |   57,7% |      9 |               3 |     14/81 |
| **źle**           | 50,3 | 21. Rekrutacja / kariera                                  | 55,1% |   47,1% |      0 |               2 |     12/29 |
| **źle**           | 48,3 | 12. Realtime / powiadomienia / web-push                   | 49,5% |   47,5% |      0 |               3 |     12/28 |
| **źle**           | 44,6 | powłoka panelu admin + atomy/molekuły                     | 47,9% |   42,5% |      0 |               4 |    33/184 |
| **źle**           | 39,6 | 7. Typy treści specjalne                                  | 43,9% |   36,7% |      1 |               6 |     37/95 |
| **beznadziejnie** | 30,2 | 17. Analityka i BI                                        | 32,9% |   28,4% |      8 |               3 |     47/86 |
| **beznadziejnie** | 21,9 | 14. Monetyzacja: kupony / darowizny / prezenty / reklamy  | 27,1% |   18,4% |      0 |               2 |     13/39 |

Rozkład: **9** wzorowo · **5** dobrze · **5** przeciętnie · **4** źle · **2** beznadziejnie.

**Ocena całości: DOBRZE — i to jest przekroczenie progu, pierwsze od wydania 3.**
Baza dla całego repo liczona tą samą rubryką: **76,1** — po 53,4 w wydaniu 3, 65,7
w wydaniu 4, 73,4 w wydaniu 5 i 72,9 w wydaniu 6. Granica „dobrze” leży na 75 i została
przekroczona. Warto od razu powiedzieć, skąd ten skok: **niemal w całości z jednego modułu.**
Wydarzenia poszły z 58,96% na 84,78% linii, a ponieważ to 366 plików i ponad 10 tysięcy linii,
ruch tej wielkości przesuwa średnią całego repozytorium. Bez modułu 22 ta sama rubryka daje
dziś ~74,7, czyli o włos poniżej progu. Podaję obie liczby, bo obie są prawdziwe: pierwsza
mówi, w jakim stanie jest aplikacja, druga — ile zrobiono na powierzchniach, które nie były
przedmiotem zamówienia. Odpowiedź na to drugie brzmi: prawie nic.
Rozbijam to na pięć osobnych ocen, bo jedna liczba tego nie opisuje:

1. **Poziom pokrycia — PIERWSZY warunek „dobrze” spełniony, drugi nie.** 77,66% linii
   i 75,04% funkcji na 3 212 plikach produkcyjnych. W wydaniu 3 postawiłem próg: za „dobrze”
   uznam **75%+ linii przy żadnym module poniżej 60%**. Linie: 77,66% — spełnione. Modułów poniżej
   60% jest 6: M21 (55,1%), M12 (49,5%), powłoka panelu admin + atomy/molekuły (47,9%), M7 (43,9%), M17 (32,9%), M14 (27,1%).
   Warunku drugiego nie spełnia więc nadal ANI JEDNO wydanie tej serii — i skład tej listy
   jest najważniejszą informacją tego rozdziału. W wydaniu 6 było na niej siedem modułów
   (sześć starych plus nowy moduł 22). Dziś jest ich sześć: **ubył wyłącznie moduł 22**,
   ten jeden, który dostał zamówienie. **Żaden z sześciu pozostałych nie ruszył się o więcej
   niż 0,1 pp** — moduły 14, 17, 21, 7 i 12 mają dokładnie 0,0 pp, a powłoka admina +0,1.
   To jest ten sam wniosek co w wydaniu 6, tylko mocniejszy o kolejną dobę dowodu:
   kolejka istnieje i jest przestrzegana co do joty, ale najsłabsze powierzchnie w niej
   nie stoją. Powierzchnia rusza się wtedy i tylko wtedy, kiedy ktoś ją zamówi.
2. **Rozkład — najlepszy w tej serii.** 6 z 25 powierzchni ma ocenę „źle”
   albo „beznadziejnie” — po 12 z 24 w wydaniu 3, 10 w wydaniu 4, 6 w wydaniu 5 i 6 w wydaniu 6.
   „Beznadziejnie” stoi na 2 (MODUŁ 14 i 17, te same co w czterech poprzednich wydaniach),
   „wzorowo” na 9, a „dobrze” urosło z 3 na 5 — bo MODUŁ 22 przeszedł z „przeciętnie”
   (57,5) na 84,7, czyli o 27 punktów bazy w jedną dobę.
   Model „jedno zlecenie = jedna powierzchnia, jawny cel, próg na końcu” zadziałał ósmy raz
   z rzędu i nie zawiódł ani razu w całej serii. Wydanie 6 pisało, że zadziałał po raz pierwszy
   PROFILAKTYCZNIE, bo moduł 22 wchodził z 58,96% zamiast z 25%. Wydanie 7 pokazuje drugą połowę
   tej samej obserwacji: **wejście z 59% nie zastąpiło zamówienia, tylko je potaniło** — moduł
   i tak stał w miejscu do momentu, w którym pracę spisano listą.
3. **Uczciwość pomiaru — dobrze, miejscami wzorowo.** `all: true` na całym `src/`, pliki bez testów
   w mianowniku, zero whitelistu. To repo ma za sobą epizod raportowania **98%** z 38 plików
   z pętlami renderującymi bez asercji — i sam ten epizod usunęło. Gęstość asercji
   2,00 na test, stabilna w każdym rodzaju testu, potwierdza, że dzisiejsze liczby nie są farmione.
4. **Infrastruktura dowodu — wzorowo.** 353 progów per-ścieżka, 38 bramek `check:*`
   (w tym META-bramka „bramka, która istnieje, musi się uruchamiać”), 99 plików pgTAP
   z 1 793 asercjami na RLS i RPC, klasyfikacja testów na jedenaście rodzajów — a w tym wydaniu
   szósta warstwa dowodu urosła: **5 uprzęży** replayu migracji z 1 505
   asercjami runtime, z czego 1 050 w uprzęży wydarzeń. Piąta jest nowa w tym wydaniu
   (`tenant-isolation-harness`) i powstała, bo polityki właścicielskie trzech tabel bramkowały
   wyłącznie `user_id`, mimo `NOT NULL tenant_id` — wiersz z jednego obszaru roboczego był
   czytelny i edytowalny z innego, a `WITH CHECK` pozwalał ZAPISAĆ wiersz do cudzego.
   Ta warstwa sprawdza rzecz, której nie sprawdza
   żadna z pozostałych pięciu: czy migracje DAJĄ SIĘ WYKONAĆ na czystej bazie i czy schemat po
   nich zachowuje się tak, jak deklaruje — kolizje sygnatur, funkcje odwołujące się do nieistniejących
   kolumn, triggery, które nie odpalają, `EXCLUDE`, które nic nie wyklucza. Uprząż wydarzeń dobiera
   migracje **po treści, a nie po nazwie pliku**, co jest bezpośrednią odpowiedzią na kształt
   historii migracji w tym repo (prawie każda funkcja ma dwie definicje, a obowiązująca jest
   w pliku z UUID-em). Większość projektów tej wielkości nie ma nawet połowy tego aparatu.
5. **Zabezpieczenie dorobku — POPRAWIONE, ale niedokończone.** Próg globalny stoi
   12,7 pp pod pomiarem na liniach — tyle pokrycia można stracić, nie łamiąc progu globalnego.
   Bez ANI JEDNEGO progu per-ścieżka jest 6 z 25 powierzchni: design system (components/ui) (80,4%), słowniki i18n (93,1%), MODUŁ 21 (55,1%), MODUŁ 12 (49,5%), powłoka panelu admin + atomy/molekuły (47,9%), MODUŁ 14 (27,1%).
   Najgroźniejsza z nich to powłoka panelu admina: 185 plików, 46,82% linii, zero progów —
   jedyna duża powierzchnia, która nigdy nie dostała ani zadania, ani zapadki, i która rośnie
   przy każdej ekstrakcji z tras.
   Druga rzecz: **żaden próg nie jest dziś wpisany nad zmierzone i bramka wychodzi kodem 0.**
   Obie regresje, które w wydaniu 6 zapaliły osiem naruszeń, zostały cofnięte pracą testową,
   a nie obniżeniem progu — i to jest pełny, domknięty cykl działania tego mechanizmu.
   Trzecia i najgorsza: **zapadka stanęła CAŁA.** Próg globalny nie drgnął drugie wydanie
   z rzędu i stoi 12,7 pp pod pomiarem, a w tym wydaniu **przestały rosnąć także progi
   per-ścieżka: 353 → 353, liczba bez zmian**, mimo 100 nowych plików testowych
   i mimo dziesięciu funkcjonalności, które skoczyły o 20–100 pp. Wartości na ścieżkach wydarzeń
   podniesiono, ale ani jedna NOWA ścieżka nie dostała własnego progu. W wydaniu 6 pisałem,
   że nawyk nie zniknął, bo per-ścieżka rosło dalej; to zdanie przestało być prawdziwe.

**Trajektoria zasługuje na osobne zdanie: super.** 32,71% → 77,66% linii w dwanaście dni, przy suicie
rosnącej z 817 do 1 863 plików i z ~8,3 tys. do 49 354 testów, to nie jest normalne tempo.
Trzynaście modułów przeszło z kilkunastu procent do ponad 80: edytor **+91,0 pp**, CRM +87,0, chrome
+79,8, profil i konto +78,5, **newsletter +72,8**, kluby +71,6, ustawienia i RODO +71,2, wygląd/media
+69,6, wyszukiwarka +64,2, wpisy +52,5, SEO +46,4, bloki i builder +36,4, billing +34,3.
Do tej listy dochodzi w tym wydaniu **moduł 22 z +25,8 pp w dwadzieścia sześć godzin** — najszybszy pojedynczy
skok dużej powierzchni w całej serii.

Wydanie 6 zapisało tu obserwację, że **moduł zbudowany od zera przy włączonym reżimie testowym
wchodzi na 60%, a nie na 25%** — wszystkie wcześniejsze duże powierzchnie tego repozytorium
startowały z 24–28% i wymagały kosztownego zadania ratunkowego. Wydanie 7 dokłada do tego
drugą połowę i jest ona mniej pocieszająca: **wejście z 59% nie sprawiło, że moduł domknął się
sam.** Stał w miejscu, dopóki nie dostał zamówienia — a kiedy je dostał, zamknął dziesięć
funkcjonalności w dobę. Reżim obniża koszt pracy, ale jej nie zastępuje.

**Jedno zdanie, gdyby trzeba było wybrać jedno.** W wydaniu 6 napisałem, że pytanie nie brzmi
już „czy da się”, tylko „w jakiej kolejności”. Wydanie 7 odpowiada na to twardym dowodem
i jednocześnie zawęża pytanie: kolejność działa bezbłędnie — ósma powierzchnia z rzędu
domknięta na zamówienie — ale **poza kolejką nie dzieje się nic**. Sześć modułów poniżej 60%
ma dziś dokładnie takie same liczby jak wczoraj, a trzy z nich mają je takie same
od siedmiu wydań. To nie jest problem zdolności ani tempa. To jest problem tego, czy ktoś
wpisze moduł 14 na listę.

---

### 8.3 Czy ten wynik jest „dramatyczny” — sprawdzenie własnego słowa

Pisząc ten dokument nazwałem wynik modułu 22 dramatycznym. Słowo padło, zanim je sprawdziłem,
więc sprawdzam je tutaj — pięcioma niezależnymi ujęciami i trzema próbami jego obalenia.
Odpowiedź jest podzielona i to jest jej treść: **dramatyczna jest KONCENTRACJA i KOMPRESJA,
nie wielkość skoku.**

**Co słowa NIE broni.** Skok +25,82 pp to dopiero **15. miejsce na 145** par moduł×okno w całej
serii; czołówka to +91,08 pp (moduł 2), +86,95 (18), +79,44 (5), +65,09 (19). Korekta na niską
bazę, która miała ten wynik uratować, nie ratuje go: moduł skonsumował 62,91% dostępnego zapasu,
co daje **13. miejsce na 145** — powyżej stoi dwanaście par, z czego pięć powyżej 95%.
W ujęciu bezwzględnym jest w ścisłej czołówce, ale też nie na szczycie: 2 748 nowo pokrytych
linii to 4. wynik serii, 1 165 funkcji — 3., spadek plików zerowych o 72 — 3.
Gorzej: to **dwunasta „kampania domknięcia” w tej serii i najsłabsza z dwunastu** — najniższy skok
punktowy przy najwygodniejszej bazie startowej. A sam moduł 22 dostał w POPRZEDNIM oknie
2,2 razy więcej pokrytych linii niż w tym, które nazwałem dramatycznym.

**Czego słowo broni, i to rekordowo.** Moduł 22 wchłonął **83,9% całego przyrostu pokrytych linii
tego okna** (2 748 z 3 274). To rekord koncentracji w całej serii — poprzednie maksimum wynosiło
56,4%, a w oknie wydania 1→2 największy moduł odpowiadał za 11,9%. Indeks koncentracji HHI
wynosi 0,711 wobec poprzedniego rekordu 0,481, a przewaga nad drugą powierzchnią jest
**7,2-krotna** wobec poprzedniego rekordu 2,3.

Druga rzecz to zegar. Okno trwało **1,47 doby**, nie tydzień, jak najpierw napisałem —
i to jest błąd działający **na niekorzyść** własnej tezy: przy siedmiu dniach tempo wyniosłoby
393 linie na dobę i 22. miejsce, przy prawdziwym oknie wynosi 1 873 i 10. miejsce.
Ostrzej: **jedenaście commitów niosących w temacie etykiety zamówionej listy (A5, B1–B9) mieści
się w czterech godzinach i dwunastu minutach** 30 sierpnia, między 10:52 a 15:02. W tym czasie
zamknięto dziesięć funkcjonalności, w tym jedną z zera na 100%.

**Trzecia rzecz — i najważniejsza dla oceny, bo to zarzut, nie pochwała.** Sprawdziłem, czy skok
nie jest wyfarmiony, tym samym testem, którym to repozytorium raz już zawyżyło wynik
(98% z warstwy renderów bez asercji). **Nie jest**, i to dość jednoznacznie: zero przypadków bez
`expect`, zero pętli renderujących bez asercji, zero snapshotów, zero atrapowania jednostki
testowanej; gęstość 3,81 asercji na przypadek wobec 3,85 średniej repo; **34,5% nazw przypadków
nazywa błąd, odmowę albo limit** wobec 26,7% w repo; 61 z 82 nowych plików uruchamia `axe`,
gdy przedtem cały moduł miał jeden taki plik; doszło pięć nowych bramek parytetu stałych z bazą.
Koszt jednostkowy jest przy tym **najwyższy w całym zestawieniu** — 15,6 linii kodu testowego
na jedną nowo pokrytą linię produkcyjną — a farmienie pokrycia nie produkuje najdroższych testów.

---

### 8.4 Gdzie ten skok NIE dotarł — i dlaczego to jest najważniejsza linijka wydania

Sprawdzanie własnego słowa wywołało znalezisko, którego nie szukałem. **Przyrost 2 748 linii
rozłożył się bardzo nierówno po warstwach:**

| Warstwa                                                        | Nowo pokrytych linii |    Udział |
| -------------------------------------------------------------- | -------------------: | --------: |
| komponenty (render, panele, dialogi)                           |                1 993 | **72,5%** |
| pozostała biblioteka domenowa                                  |                  509 |     18,5% |
| API i funkcje serwerowe (`*Api.ts`, `.server.`, `.functions.`) |                  198 |  **7,2%** |
| trasy                                                          |                   49 |      1,8% |

Pokrycie urosło tam, gdzie zachowanie jest RYSOWANE, a nie tam, gdzie jest EGZEKWOWANE.
Dodatkowo **68 z 82 nowych plików testowych (83%) atrapuje własną warstwę danych** —
`vi.mock` na `@/lib`, `@/components` albo `@/hooks`. Panel zdaje egzamin wobec atrapy tego,
co sam woła; sama wołana warstwa może pozostać nieprzetestowana i część z niej pozostała.

**A teraz najostrzejsze.** Nagłówkowym osiągnięciem tego okna jest domknięcie ścieżki płatniczej
(rozdz. 5.5). Commit, który to zrobił, nosi temat „Domknął kasę na ścieżce zapisu etapu 4
(część A)”. Plik, który przy tym zmienił — `src/lib/events/publicRegistrationApi.ts` — stoi tak:

|                 | wydanie 6 |   wydanie 7 |
| --------------- | --------: | ----------: |
| pokrycie linii  |    92,10% |  **72,91%** |
| linii pokrytych |   35 z 38 | **35 z 48** |

Przybyło dziesięć linii ścieżki pieniędzy i **ani jedna z nich nie jest wykonywana przez żaden
test**. Liczba linii pokrytych jest identyczna co do sztuki: 35 przed, 35 po. Procent tego pliku
spadł o 19,2 pp w oknie, które w skali modułu wygląda na +25,8.

To nie unieważnia dostawy — ścieżka płatnicza ma dowód w innych warstwach: test
`e2e/event-paid-registration.spec.ts` i 40 asercji runtime w nowym pliku uprzęży
`25_payment_binding.sql`. Ale jest to dokładnie ta sytuacja, przed którą ostrzega rozdział 7:
**procent modułu może rosnąć o dwadzieścia sześć punktów i jednocześnie nie dotknąć tego
jednego pliku, o który w tym oknie chodziło najbardziej.** Średnia modułu nie jest bramką —
tak samo, jak nie była nią przy szufladzie profilu w wydaniu 6 (rozdz. 1).

---

## 9. Załączniki

### 9.1 Reguły mapowania plik → moduł

Mapowanie jest deterministyczne (pierwsze trafienie wygrywa) i w całości oparte na ścieżkach.
Wzorce w kolejności stosowania, per moduł:

**MAPA W TYM WYDANIU SIĘ NIE ZMIENIŁA — i to jest świadome sprawdzenie, nie zaniechanie.**

Wydanie 6 wydzieliło MODUŁ 22 (wydarzenia) z modułów 7 i 16 i wymagało przez to przeliczenia
całego poprzedniego przebiegu nową mapą, żeby delty mierzyły pracę, a nie przesunięcie granicy.
W tym wydaniu takiej operacji nie ma, bo nie było czego przesuwać. Sprawdziłem wszystkie
**11 nowych plików produkcyjnych** tego okna po kolei i każdy trafia regułami tam, gdzie
powinien: trzy nowe molekuły i atomy zapisu na wydarzenie oraz `lib/events/amountDue.ts`
do modułu 22, widget trasy podróży i jego model do modułu 3, `lib/ci/ownership.ts`
i `lib/http/resolveReturnUrl.ts` do modułu 20, `lib/social/nesProfiles.ts` do modułu 8,
`components/ui/travel-route-card.tsx` do design systemu, `components/common/brandTile.ts`
do powłoki. Jedyny nowy katalog (`src/components/common/`) zawiera jeden plik.

**Żadna nowa powierzchnia produktowa nie zasługuje w tym wydaniu na własny moduł.** Dlatego
kolumny „wyd. 6” w rozdziale 2.1 są przepisane wprost, bez przeliczania, a delty mierzą
wyłącznie pracę testową.

Rozstrzygnięcia z wydania 6 pozostają w mocy i nie były zmieniane: wydzielenie modułu 22
z 7 i 16 wraz z przeliczeniem tamtego przebiegu, oraz reguły dla trzech tras, które
wydarzeniami nie są, a wpadały do modułu 7 przez człon `event` w łapaczu
(`popup-event.ts` → MODUŁ 11, `experiment-event.ts` → MODUŁ 17, `ad-event.ts` → MODUŁ 14).

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
| 1   | Wpisy: doświadczenie czytelnika                       |   104 |       13 728 |            58 |     13 071 |
| 2   | Edytor wpisów i workflow redakcyjny                   |   103 |       14 771 |            88 |     23 835 |
| 3   | Silniki treści: bloki + page builder                  |   461 |      111 616 |           287 |     68 494 |
| 4   | Strony, wygląd, motyw, media, import                  |   134 |       16 886 |            74 |     15 564 |
| 5   | Strona główna, archiwa, chrome                        |    62 |       10 044 |            29 |      8 022 |
| 6   | Wyszukiwarka                                          |    25 |        4 683 |            21 |      6 119 |
| 7   | Typy treści specjalne                                 |    95 |       23 117 |            46 |     10 923 |
| 8   | SEO, feedy, dane strukturalne                         |    78 |       10 937 |            69 |     21 038 |
| 9   | Czat / komunikator                                    |    81 |       15 602 |            36 |      9 164 |
| 10  | Sieć / networking                                     |    32 |        5 162 |            23 |      5 298 |
| 11  | Newsletter i e-mail                                   |   148 |       29 049 |           118 |     39 965 |
| 12  | Realtime / powiadomienia / web-push                   |    28 |        5 495 |            14 |      1 785 |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |   190 |       27 892 |            96 |     25 711 |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |    39 |        7 978 |            11 |      1 476 |
| 15  | Profil i konto                                        |    94 |       19 874 |            72 |     32 847 |
| 16  | Społeczność: kluby, komentarze, moderacja             |   306 |       58 521 |           194 |     74 365 |
| 17  | Analityka i BI                                        |    86 |       16 628 |            19 |      2 229 |
| 18  | CRM                                                   |    59 |       16 226 |            33 |     10 365 |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |   131 |       24 326 |            51 |     20 847 |
| 20  | Platforma / backend / infrastruktura / SSR            |   202 |       66 325 |           215 |     79 689 |
| 21  | Rekrutacja / kariera                                  |    29 |        5 231 |            11 |      2 202 |
| 22  | Wydarzenia: event builder, rejestracja, onsite        |   366 |       67 947 |           236 |     93 643 |
| —   | PRZEKROJOWE: słowniki i18n                            |   134 |       54 695 |             6 |        528 |
| —   | NIEPRZYPISANE                                         |     0 |            0 |            11 |      2 043 |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    |   184 |       29 533 |            43 |     11 365 |
| —   | PRZEKROJOWE: design system (components/ui)            |    44 |        4 559 |             2 |        195 |

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
już potrzebne. Pełny przebieg na tym HEAD: 9 min 10 s, 1 863 plików testowych, 49 354 testów
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
