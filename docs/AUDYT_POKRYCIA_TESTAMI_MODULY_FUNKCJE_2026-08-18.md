# Audyt pokrycia testami: moduł po module, funkcja po funkcji (2026-08-31)

**Wydanie 8 pomiaru — największy skok w serii i pierwszy, który nie stoi na jednym module.** Rodowód:
wydanie 1 (2026-08-18) musiało wykluczyć 39 plików testowych wiszących w kolekcji; wydanie 2 (19.08)
było pierwszym KOMPLETNYM pomiarem; wydania 3 (19.08) i 4 (21.08) wyszły kodem 0; wydanie 5 (22.08)
miało dwa czerwone testy; wydanie 6 (29.08) wprowadziło MODUŁ 22 i miało dwanaście czerwonych oraz
osiem naruszeń progów; wydanie 7 (30.08) było w komplecie zielone.
To wydanie mierzy HEAD `8e771b983` — **133 commity** za wydaniem 7, w oknie doby i trzech godzin.

**Ruszyły trzy powierzchnie i wszystkie trzy były zamówione promptem.** MODUŁ 14 (kupony, darowizny,
prezenty, reklamy) przeszedł z 27,06% na **92,63% linii** i z 18,42% na **90,12% funkcji** — opuszczając
kategorię „beznadziejnie”, w której siedział pięć wydań z rzędu. MODUŁ 13 (checkout, subskrypcje,
billing): 67,04% → **96,53%**, zera 34 → 3. MODUŁ 3 (bloki i page builder, 460 plików):
76,41% → **94,30%**, zera 68 → **2**. Poza tą trójką i powłoką panelu (+9,39 pp) **czternaście
powierzchni ma dokładnie +0,00 pp**. To pierwsze wydanie, w którym największy przyrost trafił
w moduły pieniędzy, a nie w treść albo w panel.

Skala zmiany w liczbach pomiaru: plików produkcyjnych 3 212 → **3 260**, mierzonych linii
105 116 → **105 556**, funkcji 33 933 → **34 077**,
plików testowych 1 863 → **2 010**, progów per-ścieżka 353 → **373**.

Pokrycie globalne: linie 77,66% → **84,12%**, funkcje 75,04% → **81,49%**,
gałęzie 71,64% → **77,51%**, instrukcje 76,54% → **82,87%**.
**Zero naruszeń progów** — ale suita NIE jest w komplecie zielona: pięć czerwonych testów
w czterech plikach. Trzy z nich mają jedną wspólną przyczynę, a jeden jest dobrą wiadomością
(rozdz. 0 pkt 4 i rozdz. 7.2).

**Znalezisko tego wydania: jeden błąd potoku wdrożeniowego, pięć zapaleń.** Dwie migracje klasy
„tenant scope” wjechały DWA RAZY pod różnymi nazwami. Treść jest identyczna po usunięciu
komentarzy, ale rozmiary nie: 10 643 B i **125 linii uzasadnienia** wobec 2 587 B i **zera**,
oraz 5 826 B i 62 linie wobec 2 012 B i zera. Duplikaty noszą NAJNOWSZE znaczniki czasu, więc
czytający historię w kolejności nazw plików zobaczy jako stan aktualny wersję bez argumentu.
Te dwa pliki to dokładnie różnica między `"migrations":932` w zacommitowanym snapshocie
uprawnień a 934 na dysku — stąd czerwone `migrationReplay` (2 testy), `authzSnapshotParity` (1)
i dwie czerwone bramki. Bazę to przeżyje, bo migracje są idempotentne; historia nie.

**Rejestr defektów po raz pierwszy zadziałał w drugą stronę.** Czwarty czerwony plik zgłasza
`Expect test to fail`: wpis `it.fails` o `page_full_path` zaczął PRZECHODZIĆ, bo opisany w nim
wyciek slugu innego najemcy do adresu kanonicznego w sitemapie i RSS-ie został w tym oknie
zamknięty — złożonym kluczem obcym `(parent_id, tenant_id) → (id, tenant_id)`, z pisemnym
uzasadnieniem, dlaczego CHECK z funkcją byłby NIEPOPRAWNY, a trigger mniej szczelny (rozdz. 7.2).

**Rachunek sumienia tego wydania jest dłuższy niż zwykle i ma osobny rozdział (8.5).**
Pierwszy przebieg wydania 8 dał 32,24% i był bezwartościowy — z winy audytu, nie kodu: mój własny
`npm install` pisał do `node_modules` jeszcze pięć minut po starcie pomiaru, więc 966 z 2 005 plików
padło na zbieraniu z jedną przyczyną. Do tego: mój parser polityk RLS zaniżał (546/579 wobec 620
w bramce repozytorium), czytałem pliki migracji jak stan schematu, zaleciłem lazyfikację na budżet
bundla wbrew wpisowi kroniki, którego nie doczytałem, i użyłem nieuczciwej ramy dla dwóch ścieżek
importu WordPressa. Wszystkie pięć opisane, żadne nie usunięte.

Plik pozostaje pod tą samą nazwą, bo odwołuje się do niego komentarz przy progu globalnym
w `vitest.config.ts` oraz prompty modułowe. **Mapa modułów w tym wydaniu się nie zmieniła**,
więc delty w 2.1 mierzą wyłącznie pracę testową i nie wymagały przeliczania poprzedniego przebiegu.

Zlecenie: **„ile % pokrycia testami ma każdy moduł, jego funkcje oraz funkcjonalności”**.
Dokument podaje ZMIERZONE liczby (nie oceny), z jawną metodologią i jawnymi ograniczeniami
pomiaru. Taksonomia modułów pochodzi z `docs/OCENA_FUNKCJI_TABELE_2026-08-14.md`; MODUŁ 22
(wydarzenia) dołożyło wydanie 6, bo tamten dokument powstał przed dostawą — pozostałe
21 modułów podłożysz pod tamte tabele ocen bez zmian.

---

## 0. Jak to zmierzono (i czego te liczby NIE znaczą)

| Element pomiaru                    | Wartość                                                                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Narzędzie                          | `vitest run --coverage` (provider `v8`), konfiguracja repo bez zmian                                                                                                                                    |
| Zakres mierzony                    | całe `src/**/*.{ts,tsx}` (`all: true`) — pliki bez testów WCHODZĄ do mianownika                                                                                                                         |
| Wykluczenia (z `vitest.config.ts`) | `__tests__`, `*.test.*`, artefakty generowane (`routeTree.gen.ts`, `supabase/types.ts`, `lucideIconNodes.generated.ts`), `src/test/**`, `lazyWidgets.tsx`                                               |
| Plików produkcyjnych w mianowniku  | 3 260                                                                                                                                                                                                   |
| Plików testowych zmierzonych       | 2 010 z 2 010 (100,0%)                                                                                                                                                                                  |
| Przypadków testowych wykonanych    | 54 695 (statyczny licznik `it/test` w plikach: 41 104; różnica to rozwinięcia `it.each`)                                                                                                                |
| Testy poza pomiarem                | brak — żaden plik nie został wykluczony z przebiegu                                                                                                                                                     |
| Testy czerwone w tym przebiegu     | 5 (rozdział 8.1)                                                                                                                                                                                        |
| Testy „expected fail”              | 266 przypadków z 255 wywołań `it.fails(` w 147 plikach — zapisane defekty produkcyjne, nie awarie (rozdział 7.2)                                                                                        |
| Testy pominięte                    | 2 pliki / 50 testów — wymagają danych dostępowych do Supabase, których sandboks nie ma (rozdział 9.2)                                                                                                   |
| Wynik bramki pokrycia              | przebieg zakończony kodem **1**: próg globalny PRZESZEDŁ z zapasem ~10 pp, ale DWIE grupy progów per-ścieżka z 373 nie — `src/components/admin/billing/**` i `src/components/profile/**` (rozdział 6.1) |
| Data pomiaru                       | 2026-08-31, HEAD `8e771b983`                                                                                                                                                                            |

**Pięć zastrzeżeń, bez których te procenty można źle odczytać:**

1. **Pokrycie ≠ poprawność.** Instrukcja „pokryta” to instrukcja, która się WYKONAŁA w trakcie
   testu — nie taka, której wynik ktoś sprawdził asercją. Dlatego obok pokrycia podaję gęstość
   asercji (kolumna „asercje”) — moduł z wysokim pokryciem i niską liczbą asercji to render bez dowodu.
2. **Pokrycie jednostkowe to nie całe pokrycie systemu.** Warstwa danych (RLS, RPC, triggery) jest
   testowana w pgTAP (100 plików, 1 807 asercji), a ścieżki użytkownika w Playwright
   (9 plików, 66 testów). Tych warstw v8 nie widzi — moduł z niskim %
   jednostkowym może mieć realną zaporę w bazie (rozdział 7).
3. **Mapowanie plik → moduł jest MOJE, nie repo.** Repo nie ma manifestu modułów; przypisanie
   3 260 plików do 22 modułów zrobiłem regułami po ścieżkach (rozdział 9.1). Pliki graniczne
   (np. `gifting` — „podaruj artykuł” jest funkcją MODUŁU 1, a kod leży w powierzchni MODUŁU 14)
   zaznaczam w tabelach.
4. **Pomiar jest KOMPLETNY, ale suita NIE jest w komplecie zielona — i to jest treść, nie usterka.**
   Ten przebieg: **2 006 plików testowych przeszło, 54 374 testów przeszło,
   5 padło** w 4 plikach, przy **zerze naruszeń progów**: próg globalny
   i wszystkie 373 progów per-ścieżka przeszły. Pięć czerwonych rozkłada się tak:
   **(a)** `migrationReplay.test.ts` — 2 testy: „nazwy są parsowalne i porządek nazw = porządek
   wersji” oraz „ratchet: lista znanego długu odzwierciedla stan repo”; **(b)**
   `authzSnapshotParity.test.ts` — 1 test, dryf klasy PROVENANCE („ten sam krąg uprawnionych,
   inne miejsce w historii — migrations: 932 → 934”); **(c)** `serviceRoleTenantScope.gate.test.ts`
   — 1 test z komunikatem `Expect test to fail`, czyli **wpis rejestru defektów, który zaczął
   przechodzić, bo defekt naprawiono**; **(d)** `AdminMonetizationLedger.test.tsx` — 1 test,
   brak elementu z tekstem „Bezterminowo” na powierzchni utworzonej w tym samym oknie.
   Pozycje (a) i (b) mają **jedną przyczynę** — dwa duplikaty migracji (rozdz. 7.2).
   Do tego **266 przypadków „expected fail”** — to NIE awarie, tylko zapisane
   defekty produkcyjne (rozdział 7.2).
   Poza pomiarem zostały 2 pliki (50 testów) odpytujące hostowaną bazę; oba pomijają się
   SAME warunkiem `shouldRun ? describe : describe.skip`, nie ręcznym wykluczeniem.
5. **Pierwszy przebieg tego wydania został UNIEWAŻNIONY i nie jest źródłem żadnej liczby tutaj.**
   Dał 32,24% / 27,00% / 26,69% / 32,35% i „968 failed test files”. Przyczyną nie było repozytorium,
   a moje środowisko: `@testing-library/dom` powstał w `node_modules` o 22:03:19, a pomiar startował
   o 21:58 — mój własny `npm install` wciąż pisał. **Wszystkie 966 padniętych suit miały jedną
   przyczynę:** `Cannot find module '@testing-library/dom'` wymagane przez
   `@testing-library/react/dist/pure.js`; dodatkowo 5 plików z `@vitest-environment jsdom`
   nie wystartowało. Sygnatura, która to rozstrzyga w jednym spojrzeniu: **968 padniętych PLIKÓW
   przy 2 czerwonych TESTACH jest niemożliwe dla regresji kodu**, bo plik padający na zbieraniu
   nie zgłasza żadnego czerwonego testu. Gorsze jest to, co ten defekt UKRYŁ: dwa z czterech
   dzisiejszych czerwonych plików były wtedy wśród tych 966 i raportowały „(0 test)”.
   Log unieważnionego przebiegu zachowałem pod nazwą z „UNIEWAŻNIONY”, żeby dało się to odtworzyć.

---

## 1. Wynik globalny: całe `src/`

| Metryka    | Pokryte / wszystkich |          % |
| ---------- | -------------------: | ---------: |
| Instrukcje |    100 014 / 120 683 | **82,87%** |
| Gałęzie    |     85 348 / 110 110 | **77,51%** |
| Funkcje    |      27 772 / 34 077 | **81,49%** |
| Linie      |     88 800 / 105 556 | **84,12%** |

Próg globalny w `vitest.config.ts` (ratchet, wolno tylko podnosić): **64% instrukcji /
58% gałęzi / 62% funkcji / 65% linii**. Zmierzony margines nad progiem:
instrukcje 18,87 pp, gałęzie 19,51 pp,
funkcje 19,49 pp, linie 19,12 pp.

**Kontrola wiarygodności pomiaru.** Komentarz przy progu w `vitest.config.ts` dokumentuje ostatni
pomiar zespołu: 68,27% instrukcji / 62,80% gałęzi /
66,25% funkcji / 69,28% linii.
Ten audyt, niezależnym przebiegiem: 82,87% / 77,51% / 81,49% / 84,12%.
Rozjazd urósł do **14,8 pp na liniach** i nadal jest po stronie KOMENTARZA, nie pomiaru:
wpis w configu pochodzi sprzed trzech kampanii domknięcia. W wydaniu 6 ta różnica wynosiła
5,7 pp i pisałem, że jest na granicy wprowadzania w błąd; w wydaniu 7 — 8,4 pp. Dziś komentarz
opisuje repozytorium o blisko piętnaście punktów słabsze, niż jest naprawdę, a jest to jedyne
miejsce w kodzie, z którego czytelnik configu dowiaduje się, ile pokrycia repo ma.
**To jest do poprawienia jednym commitem i powinno wejść razem z tym wydaniem.**

**Zapadka globalna stoi trzecie wydanie z rzędu — ale per-ścieżka znów się rusza.** Wydanie 3
zgłaszało progi `33/25/33/28` stojące ~23 pp pod pomiarem; wydanie 4 zmierzyło `58/54/58/52`,
wydanie 5 podniosło do `64/58/62/65`. Config ma dziś **dokładnie te same wartości**,
a pomiar stoi **19,1 pp wyżej** na liniach. W wydaniu 7 pisałem, że przestały rosnąć także
progi per-ścieżka. **To się cofnęło i jest to dobra wiadomość:** 353 → **373**, czyli
+20 nowych ścieżek pod zaporą, przy 147 nowych plikach testowych.
Trzy domknięte moduły dostały więc nie tylko procent, ale i zapadkę, która go trzyma.

Skutek arytmetyczny zapadki GLOBALNEJ pozostaje jednak niezmieniony i wart powtórzenia:
żeby dziś przekroczyć ją w dół, repozytorium musiałoby stracić **22,7%** całego pokrycia
— blisko jedną czwartą. Bramka, która puszcza taki spadek, nie jest bramką: jest formalnością.
Im większy ten zapas, tym mocniej obowiązuje wniosek z rozdz. 1 o `reportOnFailure`:
**regresję złapie czerwony test albo próg per-ścieżka, nigdy sam procent modułu.**

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
| 17  | Analityka i BI                                        |          86 |     32,13% |  25,14% |  28,41% | **32,88%** |        47 | 0,221 |    199 |     442 |
| 7   | Typy treści specjalne                                 |          95 |     44,18% |  40,43% |  36,73% | **43,93%** |        37 | 0,484 |    934 |   1 501 |
| 12  | Realtime / powiadomienia / web-push                   |          28 |     46,71% |  31,59% |  47,46% | **49,54%** |        12 | 0,500 |     99 |     233 |
| 21  | Rekrutacja / kariera                                  |          29 |     54,96% |  53,52% |  47,13% | **55,12%** |        12 | 0,379 |    171 |     374 |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    |         221 |     56,02% |  51,39% |  52,16% | **57,34%** |        30 | 0,326 |  1 203 |   2 630 |
| 9   | Czat / komunikator                                    |          81 |     61,33% |  51,74% |  58,02% | **62,83%** |        14 | 0,444 |    607 |   1 123 |
| 20  | Platforma / backend / infrastruktura / SSR            |         202 |     74,73% |  64,93% |  68,65% | **75,83%** |        45 | 1,143 |  5 161 |  11 055 |
| —   | PRZEKROJOWE: design system (components/ui)            |          44 |     79,08% |  69,95% |  74,36% | **81,11%** |         4 | 0,045 |     17 |      37 |
| 10  | Sieć / networking                                     |          32 |     79,85% |  68,71% |  81,85% | **83,65%** |         3 | 0,719 |    349 |     642 |
| 1   | Wpisy: doświadczenie czytelnika                       |         104 |     82,91% |  75,16% |  82,12% | **84,67%** |        13 | 0,558 |  1 015 |   2 132 |
| 22  | Wydarzenia: event builder, rejestracja, onsite        |         366 |     83,36% |  79,87% |  84,62% | **84,78%** |        72 | 0,645 |  5 268 |  10 922 |
| 16  | Społeczność: kluby, komentarze, moderacja             |         306 |     88,68% |  87,27% |  89,02% | **89,12%** |        16 | 0,634 |  4 715 |   9 534 |
| 4   | Strony, wygląd, motyw, media, import                  |         133 |     90,95% |  82,16% |  88,89% | **92,32%** |         4 | 0,552 |  1 245 |   2 154 |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |          44 |     90,74% |  85,67% |  90,12% | **92,63%** |         1 | 0,659 |    557 |   1 089 |
| —   | PRZEKROJOWE: słowniki i18n                            |         135 |     89,49% |  67,38% |  61,62% | **93,17%** |         1 | 0,044 |     60 |     141 |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |         135 |     92,40% |  88,94% |  90,21% | **93,36%** |        14 | 0,407 |  1 390 |   2 685 |
| 3   | Silniki treści: bloki + page builder                  |         460 |     92,61% |  86,87% |  92,61% | **94,30%** |         2 | 0,709 |  5 704 |  10 561 |
| 5   | Strona główna, archiwa, chrome                        |          62 |     94,68% |  82,86% |  93,49% | **96,47%** |         1 | 0,468 |    560 |     945 |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |         190 |     95,51% |  91,31% |  96,28% | **96,53%** |         3 | 0,711 |  2 922 |   5 781 |
| 8   | SEO, feedy, dane strukturalne                         |          78 |     96,26% |  93,22% |  95,65% | **96,67%** |         5 | 0,885 |  1 270 |   2 847 |
| 6   | Wyszukiwarka                                          |          25 |     96,66% |  89,91% |  95,24% | **97,38%** |         0 | 0,840 |    528 |     839 |
| 15  | Profil i konto                                        |          94 |     96,65% |  93,96% |  94,81% | **97,64%** |         2 | 0,766 |  2 011 |   4 099 |
| 18  | CRM                                                   |          59 |     98,10% |  86,27% |  98,60% | **99,03%** |         0 | 0,559 |    703 |   1 231 |
| 2   | Edytor wpisów i workflow redakcyjny                   |         103 |     98,85% |  94,71% |  98,85% | **99,35%** |         0 | 0,854 |  1 576 |   2 928 |
| 11  | Newsletter i e-mail                                   |         148 |     98,89% |  95,05% |  99,43% | **99,53%** |         0 | 0,797 |  2 778 |   5 931 |

### 2.1 Zmiana od wydania 7 — trzy powierzchnie zamówione, trzy domknięte

Poprzedni pomiar (wydanie 7, 2026-08-30, HEAD `d5171bca9`) obejmował 1 863 plików
testowych i 3 212 plików produkcyjnych. Ten obejmuje 2 010 i 3 260.

**Mapa modułów w tym wydaniu SIĘ NIE ZMIENIŁA, więc kolumny „wyd. 7” są przepisane wprost.**
Delty niżej mierzą wyłącznie pracę testową. Reguły mapowania: rozdział 9.1.

Rozkład jest skrajnie dwubiegunowy i to jest najważniejsza informacja tej tabeli.
**Cztery powierzchnie ruszyły, czternaście stoi na dokładnie +0,00 pp.** Ruch nie jest
rozproszony po repozytorium — jest dokładnie tam, gdzie go zamówiono, a dokładność tego
trafienia jest sama w sobie ustaleniem: mechanizm zamawiania pracy listą działa i **skaluje
się do trzech modułów naraz**, czego poprzednie wydania nie pokazały.

Kolumna Δ to różnica w punktach procentowych wobec wydania 7; ostatnia kolumna to
różnica KUMULACYJNA wobec wydania 1 (2026-08-18). Strzałka ↑ znaczy, że modułem ktoś się zajął.

| #   | Moduł                                                 | Linie wyd. 7 | Linie teraz |    Δ linie | Funkcje wyd. 7 | Funkcje teraz |  Δ funkcje | Δ linie od wyd. 1 |
| --- | ----------------------------------------------------- | -----------: | ----------: | ---------: | -------------: | ------------: | ---------: | ----------------: |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |       27,06% |  **92,63%** | ↑ +65,6 pp |         18,42% |    **90,12%** | ↑ +71,7 pp |        ↑ +70,1 pp |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |       67,04% |  **96,53%** | ↑ +29,5 pp |         76,62% |    **96,28%** | ↑ +19,7 pp |        ↑ +63,8 pp |
| 3   | Silniki treści: bloki + page builder                  |       76,41% |  **94,30%** | ↑ +17,9 pp |         71,67% |    **92,61%** | ↑ +20,9 pp |        ↑ +54,3 pp |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    |       47,95% |  **57,34%** |  ↑ +9,4 pp |         42,45% |    **52,16%** |  ↑ +9,7 pp |        ↑ +32,9 pp |
| —   | PRZEKROJOWE: design system (components/ui)            |       80,43% |  **81,11%** |  ↑ +0,7 pp |         72,22% |    **74,36%** |  ↑ +2,1 pp |        ↑ +18,0 pp |
| 9   | Czat / komunikator                                    |       62,31% |  **62,83%** |  ↑ +0,5 pp |         57,74% |    **58,02%** |  ↑ +0,3 pp |         ↑ +0,9 pp |
| 1   | Wpisy: doświadczenie czytelnika                       |       84,35% |  **84,67%** |  ↑ +0,3 pp |         81,98% |    **82,12%** |  ↑ +0,1 pp |        ↑ +52,9 pp |
| 20  | Platforma / backend / infrastruktura / SSR            |       75,55% |  **75,83%** |  ↑ +0,3 pp |         68,19% |    **68,65%** |  ↑ +0,5 pp |        ↑ +23,1 pp |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |       93,18% |  **93,36%** |  ↑ +0,2 pp |         89,91% |    **90,21%** |  ↑ +0,3 pp |        ↑ +71,4 pp |
| —   | PRZEKROJOWE: słowniki i18n                            |       93,14% |  **93,17%** |     0,0 pp |         59,24% |    **61,62%** |  ↑ +2,4 pp |         ↑ +1,4 pp |
| 2   | Edytor wpisów i workflow redakcyjny                   |       99,35% |  **99,35%** |     0,0 pp |         98,73% |    **98,85%** |  ↑ +0,1 pp |        ↑ +91,0 pp |
| 4   | Strony, wygląd, motyw, media, import                  |       92,32% |  **92,32%** |     0,0 pp |         88,89% |    **88,89%** |     0,0 pp |        ↑ +69,6 pp |
| 5   | Strona główna, archiwa, chrome                        |       96,47% |  **96,47%** |     0,0 pp |         93,49% |    **93,49%** |     0,0 pp |        ↑ +79,8 pp |
| 6   | Wyszukiwarka                                          |       97,38% |  **97,38%** |     0,0 pp |         95,24% |    **95,24%** |     0,0 pp |        ↑ +64,2 pp |
| 7   | Typy treści specjalne                                 |       43,93% |  **43,93%** |     0,0 pp |         36,73% |    **36,73%** |     0,0 pp |        ↑ +27,5 pp |
| 8   | SEO, feedy, dane strukturalne                         |       96,67% |  **96,67%** |     0,0 pp |         95,65% |    **95,65%** |     0,0 pp |        ↑ +46,4 pp |
| 10  | Sieć / networking                                     |       83,65% |  **83,65%** |     0,0 pp |         81,85% |    **81,85%** |     0,0 pp |         ↑ +2,0 pp |
| 11  | Newsletter i e-mail                                   |       99,53% |  **99,53%** |     0,0 pp |         99,43% |    **99,43%** |     0,0 pp |        ↑ +72,8 pp |
| 12  | Realtime / powiadomienia / web-push                   |       49,54% |  **49,54%** |     0,0 pp |         47,46% |    **47,46%** |     0,0 pp |         ↑ +5,4 pp |
| 15  | Profil i konto                                        |       97,64% |  **97,64%** |     0,0 pp |         94,81% |    **94,81%** |     0,0 pp |        ↑ +78,5 pp |
| 16  | Społeczność: kluby, komentarze, moderacja             |       89,12% |  **89,12%** |     0,0 pp |         89,02% |    **89,02%** |     0,0 pp |        ↑ +71,6 pp |
| 17  | Analityka i BI                                        |       32,88% |  **32,88%** |     0,0 pp |         28,41% |    **28,41%** |     0,0 pp |         ↑ +4,9 pp |
| 18  | CRM                                                   |       99,03% |  **99,03%** |     0,0 pp |         98,60% |    **98,60%** |     0,0 pp |        ↑ +87,0 pp |
| 21  | Rekrutacja / kariera                                  |       55,12% |  **55,12%** |     0,0 pp |         47,13% |    **47,13%** |     0,0 pp |            0,0 pp |
| 22  | Wydarzenia: event builder, rejestracja, onsite        |       84,78% |  **84,78%** |     0,0 pp |         84,62% |    **84,62%** |     0,0 pp |                 — |

Ruszyło 4 powierzchni (powyżej 1 pp), 21 stoi w granicach ±1 pp, 0 spadło o więcej niż 1 pp.
**To wydanie ma jedno źródło ruchu i jest nim jedna powierzchnia.**

**MODUŁ 22 (wydarzenia): 58,96% → 84,78% linii (+25,8 pp), 55,25% → 84,62% funkcji (+29,4 pp),
plików na zerze 144 → 72.** Powierzchnia praktycznie się nie zmieniła (362 → 366 plików), więc
to nie jest dylucja ani dostawa — to jest praca testowa na istniejącym kodzie, wykonana
w ciągu **dwudziestu sześciu godzin** — commity modułu rozpięte są od 29.08 12:45 do 30.08 14:56.
Rozkład po funkcjonalnościach pokazuje, że szła listą, nie losowo:

| funkcjonalność                     | wyd. 7 |      teraz |           Δ |
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
| 17  | Analityka i BI                                        |           880 |        250 | **28,41%** |
| 7   | Typy treści specjalne                                 |         1 522 |        559 | **36,73%** |
| 21  | Rekrutacja / kariera                                  |           348 |        164 | **47,13%** |
| 12  | Realtime / powiadomienia / web-push                   |           394 |        187 | **47,46%** |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    |         1 923 |      1 003 | **52,16%** |
| 9   | Czat / komunikator                                    |         1 060 |        615 | **58,02%** |
| —   | PRZEKROJOWE: słowniki i18n                            |           185 |        114 | **61,62%** |
| 20  | Platforma / backend / infrastruktura / SSR            |         2 083 |      1 430 | **68,65%** |
| —   | PRZEKROJOWE: design system (components/ui)            |           234 |        174 | **74,36%** |
| 10  | Sieć / networking                                     |           303 |        248 | **81,85%** |
| 1   | Wpisy: doświadczenie czytelnika                       |           688 |        565 | **82,12%** |
| 22  | Wydarzenia: event builder, rejestracja, onsite        |         3 946 |      3 339 | **84,62%** |
| 4   | Strony, wygląd, motyw, media, import                  |         1 008 |        896 | **88,89%** |
| 16  | Społeczność: kluby, komentarze, moderacja             |         3 351 |      2 983 | **89,02%** |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |           334 |        301 | **90,12%** |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |         1 502 |      1 355 | **90,21%** |
| 3   | Silniki treści: bloki + page builder                  |         6 886 |      6 377 | **92,61%** |
| 5   | Strona główna, archiwa, chrome                        |           568 |        531 | **93,49%** |
| 15  | Profil i konto                                        |         1 098 |      1 041 | **94,81%** |
| 6   | Wyszukiwarka                                          |           294 |        280 | **95,24%** |
| 8   | SEO, feedy, dane strukturalne                         |           506 |        484 | **95,65%** |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |         1 452 |      1 398 | **96,28%** |
| 18  | CRM                                                   |         1 072 |      1 057 | **98,60%** |
| 2   | Edytor wpisów i workflow redakcyjny                   |           868 |        858 | **98,85%** |
| 11  | Newsletter i e-mail                                   |         1 572 |      1 563 | **99,43%** |

---

## 3. Pokrycie per funkcjonalność (141 funkcjonalności w 22 modułach)

Każdy wiersz to FUNKCJA PRODUKTU, nie katalog: lista plików ją realizujących jest zdefiniowana
wzorcami ścieżek. Kolumna „fn” to funkcje wywołane / wszystkie funkcje w plikach tej funkcjonalności.

### MODUŁ 1 — Wpisy: doświadczenie czytelnika · linie 84,67% · funkcje 82,12%

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

### MODUŁ 3 — Silniki treści: bloki + page builder · linie 94,30% · funkcje 92,61%

**Rodzaje testów:** komponentowy 155 · jednostkowy 139 · hooka 13 · dostępności 5 · parytetu 10 · bramki 3 · funkcji serwerowej 1 · dymny 1.

**Co tu decyduje:** decyduje **test parytetu**: rejestr widgetów, panel właściwości i renderer to trzy artefakty, które muszą mówić to samo, a rozjazd „panel ustawia, renderer ignoruje” łapie wyłącznie porównanie dwóch stron (`check:widget-fidelity`, `settingsFidelity.gate`). Test jednostkowy schematu i test komponentu widgetu są konieczne, ale ani jeden, ani drugi nie zauważy dryfu między nimi.

**Bez tego rodzaju przechodzi taki defekt:** panel zapisuje ustawienie pod kluczem `heightMobile`, renderer czyta `mobileHeight`. Oba pliki mają testy, oba są zielone, a strona na telefonie ignoruje ustawienie — to dokładnie ta klasa defektu, dla której powstała bramka `check:widget-fidelity`.

| Funkcjonalność                                         | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |      Linie | fn (szt.) |
| ------------------------------------------------------ | -----: | ---------: | -----: | ----: | ------: | ---------: | --------: |
| CMS: silnik treści publicznej (contentEngine)          |     20 |        525 |  79,8% | 77,9% |   82,6% |  **81,0%** |   100/121 |
| CMS: zapytania danych widgetów                         |      8 |        459 |  78,3% | 68,8% |   87,9% |  **83,2%** |   123/140 |
| CMS: design tokens / kolory globalne / typografia      |      6 |        257 |  85,5% | 81,6% |   85,0% |  **87,9%** |     34/40 |
| CMS: page builder (typ Elementor) — schemat i operacje |     11 |        650 |  89,5% | 69,8% |   99,7% |  **96,9%** |   294/295 |
| CMS: panele właściwości widgetów                       |    112 |      4 671 |  96,5% | 93,2% |   95,0% |  **97,3%** | 1972/2076 |
| CMS: sanityzacja HTML                                  |      4 |        157 |  93,9% | 88,1% |   90,6% |  **97,5%** |     29/32 |
| CMS: widgety buildera — render publiczny               |     55 |      3 596 |  96,2% | 88,2% |   95,3% |  **97,9%** |   758/795 |
| CMS: render bloków (publiczny)                         |     39 |      1 920 |  97,3% | 94,0% |   96,3% |  **98,1%** |   499/518 |
| CMS: silnik bloków (typ Gutenberg) — rdzeń             |      9 |        359 |  99,0% | 94,1% |  100,0% |  **98,9%** |   148/148 |
| CMS: builder sidebara + wzorce                         |      7 |        238 |  96,1% | 91,7% |  100,0% |  **99,2%** |   132/132 |
| CMS: warstwa content-model (rozdział bloki⇄builder)    |      7 |        150 |  95,7% | 86,7% |  100,0% |  **99,3%** |     32/32 |
| CMS: import z Gutenberga / WordPressa                  |     10 |      1 309 |  98,5% | 94,3% |   99,6% |  **99,8%** |   249/250 |
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

### MODUŁ 13 — Monetyzacja: checkout / subskrypcje / billing · linie 96,53% · funkcje 96,28%

**Rodzaje testów:** warstwy danych 27 · komponentowy 37 · funkcji serwerowej 38 · jednostkowy 27 · dostępności 4 · hooka 1 · parytetu 1.

**Co tu decyduje:** ścieżka płatność → dostęp ma **testy funkcji serwerowych** z wysokimi progami (webhook Stripe, grant) i to jest właściwy rodzaj dowodu dla pieniędzy. Ale rezygnacja, zmiana planu i faktury to **testy komponentowe**: UI może pokazać „anulowano”, gdy żądanie padło, a żaden test serwerowy tego nie zauważy.

**Bez tego rodzaju przechodzi taki defekt:** anulowanie subskrypcji pokazuje „anulowano”, choć żądanie padło. Użytkownik jest przekonany, że nie płaci, i wraca po miesiącu z reklamacją i chargebackiem — a test funkcji serwerowej niczego nie zgłosił, bo funkcja nigdy nie została wywołana.

| Funkcjonalność                              | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ------------------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Webhook płatności                           |      1 |         37 |  65,8% | 63,3% |   20,0% | **64,9%** |       1/5 |
| Checkout (Stripe) + intencja                |     15 |        200 |  73,6% | 66,5% |   72,7% | **77,0%** |     40/55 |
| Dołączenie do członkostwa (membership join) |      9 |         65 |  96,1% | 90,2% |   93,8% | **96,9%** |     30/32 |
| Billing: rekoncyliacja i panel              |    116 |      3 988 |  96,5% | 91,7% |   98,3% | **97,4%** |   815/829 |
| Subskrypcje / plany / cennik                |     33 |        759 |  96,8% | 93,4% |   96,2% | **98,2%** |   353/367 |

### MODUŁ 14 — Monetyzacja: kupony / darowizny / prezenty / reklamy · linie 92,63% · funkcje 90,12%

**Rodzaje testów:** komponentowy 12 · hooka 5 · dostępności 4 · warstwy danych 1 · jednostkowy 6 · parytetu 1.

**Co tu decyduje:** kwoty i kupony to **testy jednostkowe** (waluta, zaokrąglenia, audyt kuponu), a widoczność reklamy i przycisku darowizny to **testy komponentowe**. Rozdział jest tu ważny, bo błąd w kwocie i błąd w widoczności mają różne konsekwencje i różne rodzaje dowodu.

**Bez tego rodzaju przechodzi taki defekt:** zaokrąglenie kuponu procentowego liczy się na liczbach zmiennoprzecinkowych i suma zamówienia rozjeżdża się o grosz z kwotą pobraną przez dostawcę płatności. Księgowość nie domyka miesiąca, a różnicy nie widać w żadnym logu aplikacji.

| Funkcjonalność               | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ---------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Darowizny                    |      3 |        119 |  84,0% | 72,0% |   71,4% | **85,7%** |     15/21 |
| Reklamy / sponsoring         |     15 |        443 |  87,5% | 81,9% |   87,5% | **90,3%** |   105/120 |
| Kupony                       |     12 |        326 |  89,0% | 84,0% |   90,4% | **91,1%** |    94/104 |
| Prezenty artykułów (gifting) |     10 |        232 |  97,8% | 95,2% |   98,4% | **99,6%** |     63/64 |

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
| Wykresy i panel BI                      |     41 |      1 501 |  27,8% | 22,3% |   22,3% | **29,0%** |   114/512 |
| Observability / RUM / web vitals        |     11 |        409 |  54,6% | 48,6% |   61,7% | **54,0%** |     37/60 |
| Analityka: warstwa semantyczna          |      7 |        239 |  70,4% | 60,2% |   69,4% | **71,5%** |     43/62 |

### MODUŁ 17 - kampania 2026-09-01/02: linie 36,07% -> 96,24%, funkcje 31,18% -> 95,96%, plików na zerze 47 -> 0

**Punktem odniesienia tego rozdziału nie jest wyłącznie wydanie 8.** Między pomiarem
wydania 8 (HEAD `8e771b983`) a startem tej kampanii main przyjął **59 commitów**, a
w module 17 przybył m.in. pierwszy test reportera Core Web Vitals
(`src/lib/__tests__/webVitals.test.ts`, 33 przypadki) - czyli plik, który wydanie 8
wymienia jako `webVitals.ts 0/78, 0/14 funkcji`. Liczby wydania 8 nie opisują więc
stanu, od którego ta kampania startowała. Żeby delta była uczciwa, stan WYJŚCIOWY
zmierzyłem sam: pełnym przebiegiem `vitest run --coverage` w osobnym drzewie roboczym
przypiętym do commitu sprzed pierwszej zmiany (`3eb5e92`). Podaję obie liczby i nie
mieszam ich.

**Zastrzeżenie do podziału wewnątrz modułu.** Reguła ścieżkowa MODUŁU 17 jest w tym
dokumencie opublikowana (rozdz. 9.1) i użyłem jej dosłownie, więc liczby CAŁEGO modułu
są porównywalne między wydaniami. Podział na cztery funkcjonalności nie jest
opublikowany jako regexy, a mój (niżej) przypisuje np. cały
`src/components/admin/analytics/semantic/` do warstwy semantycznej - stąd „plików" nie
zgadza się z tabelą wydania 8. Dla funkcjonalności porównywalna jest zatem DELTA W
OBRĘBIE TEJ KAMPANII (ta sama reguła po obu stronach pomiaru), a nie różnica wobec
wydania 8.

Reguła podziału, w kolejności rozstrzygania: (1) **warstwa semantyczna** -
`lib/analytics/semantic/`, `components/admin/analytics/semantic/`, trasy z członem
`semantic`; (2) **observability / RUM** - `lib/observability/`, `lib/webVitals`,
`/api/public/(vitals|client-errors)`, `admin.performance`,
`components/admin/performance/`; (3) **wykresy i panel BI** - `components/charts/`,
`components/admin/analytics/`, `lib/charts/`,
`admin.(analytics|experiments|link-monitor)`; (4) **zbieranie zdarzeń i liczniki** -
reszta modułu.

**Moduł 17 razem.**

| metryka    | wejście (`3eb5e92`) | po kampanii | delta | cel zlecenia |
| ---------- | ------------------: | ----------: | ----: | -----------: |
| linie | 36,07% (1134/3144) | **96,24%** (3099/3220) | +60,17 pp | ≥ 65% |
| instrukcje | 35,31% (1283/3634) | **95,54%** (3556/3722) | +60,23 pp | - |
| gałęzie | 27,30% (917/3359) | **92,17%** (3145/3412) | +64,87 pp | ≥ 52% |
| funkcje | 31,18% (280/898) | **95,96%** (878/915) | +64,78 pp | ≥ 62% |
| plików na zerze | 47 | **0** | -47 | - |

Plików w mianowniku: 89 (wejście) / 89 (po).

**Cztery funkcjonalności.** Ta sama reguła podziału po obu stronach pomiaru.

| Funkcjonalność | Plików | linie wejście | linie po | gałęzie po | funkcje po | cel (linie/fn/gał) |
| -------------- | -----: | ------------: | -------: | ---------: | ---------: | -----------------: |
| Analityka: zbieranie zdarzeń i liczniki | 21 | 15,68% | **85,63%** | 78,15% | 77,56% (121/156) | 70 / 65 / 55 |
| Wykresy i panel BI | 38 | 32,20% | **99,82%** | 95,90% | 100,00% (568/568) | 60 / 55 / 45 |
| Observability / RUM / web vitals | 14 | 64,54% | **97,29%** | 93,48% | 97,78% (88/90) | 85 / 85 / 75 |
| Analityka: warstwa semantyczna | 16 | 56,66% | **99,43%** | 95,79% | 100,00% (101/101) | 92 / 90 / 80 |

#### Rejestr N1-N8: osiem zleceń, osiem rozstrzygnięć

Każdy punkt ma jeden z trzech statusów. Żaden nie wyszedł „odroczony".

**N1 - gubione CLS i INP po pierwszym zrzucie. NAPRAWIONY.**
Jedna wspólna flaga `flushed` zamykała się przy pierwszym zrzucie i była czyszczona
wyłącznie przez nawigację miękką. Skutek jest gorszy, niż mówiło zlecenie: po
pierwszym ukryciu karty ścieżka milkła NA STAŁE - każdy kolejny cykl ukryć i powrotów
oraz `pagehide` były no-opem, a przywrócenie z bfcache dawało całą sesję bez pomiaru.
Zapadka rozbita na stan per metryka. LCP zostaje jednorazowe (jest finalne z
definicji), CLS i INP są wysyłane PONOWNIE, gdy urosły.

Zlecenie mówiło „zrzuć deltę". Odstąpiłem od tego świadomie i wysyłam wartość
SKUMULOWANĄ, bo delta w tym ingeście jest gorsza niż defekt, który miała naprawić:
wiersz `web_vitals` niesie WŁASNĄ ocenę good/needs-improvement/poor, a
`aggregateVitals` liczy p75 po surowych wierszach i tej ocenie ufa. Strona o realnym
CLS 0,4 („poor") rozbita na cztery przyrosty po 0,1 dałaby cztery wiersze „good"
i zero „poor", a prawdziwa wartość nie pojawiłaby się w populacji p75 ani razu -
zniknąłby dokładnie ten ogon rozkładu, dla którego p75 się liczy. Warunek „tylko gdy
urosło" nie pozwala serii ukryć zalać ingestu identycznymi wierszami. Koszt przyjęty
świadomie: odsłona z dwoma zrzutami zostawia dwa wiersze CLS, więc `count` zawyża
liczbę odsłon.

Dowód: `src/lib/__tests__/webVitals.test.ts`, blok „kumulacja po pierwszym zrzucie
(N1)" - cztery przypadki, z których DWA są czerwone na kodzie sprzed naprawy
(zweryfikowane przez chwilowe przywrócenie starej wersji `flushCurrent`, nie przez
rozumowanie). Pozostałe dwa to strażnicy regresji: seria ukryć bez nowych pomiarów
nie dubluje wierszy, a nawigacja miękka nadal zeruje akumulatory.

**N2 - brak batchowania metryk RUM. NAPRAWIONY.**
Klient buforuje i zrzuca JEDNYM beaconem na każdej granicy (nawigacja miękka,
`visibilitychange` -> hidden, `pagehide`), endpoint przyjmuje `{metrics:[...]}` i robi
JEDEN wielowierszowy insert. Pierwsze wczytanie kosztuje jedno żądanie zamiast pięciu.

Korekta do zlecenia: komentarz w endpoincie mówił „a page load emits ~6 vitals" i to
było zawyżone. `VALID_METRICS` dopuszcza FID, ale unia typów klienta nie umie go
wyprodukować; realne wczytanie bez interakcji emituje CZTERY metryki (FCP, TTFB, LCP,
CLS), bo INP wymaga zdarzenia z `interactionId` i `duration > 40`.

Bufor nie jest oknem batchowania i to jest cała jego konstrukcja: każda granica
zrzutu drenuje kolejkę SYNCHRONICZNIE, a timer istnieje wyłącznie dlatego, że FCP
i TTFB są kolejkowane przy inicjalizacji, która własnej granicy nie ma - stąd ma
zerowe opóźnienie. Karty w tle mają timery dławione do ~1/min, więc gwarancją są
listenery ukrycia, nigdy timer. Cofnięcie zgody PORZUCA to, co zostało w buforze.

Zgodność wsteczna jest obowiązkowa i przetestowana: strona zbuforowana przed zmianą
- albo otwarta w karcie w tle od wczoraj - nadal wysyła pojedynczy obiekt
`{name,value,...}` i nadal jest zapisywana. Endpoint normalizuje trzy kształty ciała
do listy.

Limiter przeliczony: 60/1 -> 20/0,2. Budżet jest liczony w WIERSZACH, nie w żądaniach,
bo żądanie, które wstawiało jeden wiersz, wstawia teraz do ośmiu: 12 żądań/min razy
MAX_METRICS = 8 daje ~96 wierszy/min, ten sam rząd wielkości co 60 wierszy/min przy
starej nastawie.

**N3 - dwie ścieżki beaconu do tego samego zadania. NAPRAWIONY.**
`webVitals.ts` woła teraz `sendBeaconPayload` i `vitalsEndpoint()` zamiast własnego
`navigator.sendBeacon` z surowym napisem i drugiego, inline'owego odczytu zmiennej
środowiskowej.

Pułapka, którą trzeba było ominąć: `observabilityEndpoint()` miała fallback na
`/api/public/client-errors`, a `webVitals.ts` - na `/api/public/vitals`. Naiwne
podstawienie wspólnej funkcji wysłałoby WSZYSTKIE metryki RUM do ingestu błędów, który
wymaga pola `message`, więc odpowiedziałby 204 i nie zapisał ani jednego wiersza -
cicha, całkowita utrata danych bez jednego czerwonego żądania, po którym można by to
zauważyć. Dlatego fallback jest PARAMETREM, a nie stałą.

Dowód: test, że ingest przyjmuje OBA kształty ciała - napis (stary transport) i Blob
`application/json` (nowy) - po obu stronach: w teście klienta i w teście endpointu.

**N4 - niezmienność „ECharts nigdy w grafie SSR" bez bramki. NAPRAWIONY, ale nie tak,
jak zakładało zlecenie.**
Zlecenie mówiło: dopisz echarts do `HEAVY_MODULES` w `check-entry-purity.ts`.
Dopisałem - i to za mało, bo TA BRAMKA TEJ KRAWĘDZI NIE ŁAPIE. `check-entry-purity`
liczy domknięcie ŚCIEŻKI BOOTOWANIA KLIENTA: startuje od chunków wstrzykiwanych przez
SSR jako `<script type="module">` i idzie po statycznych krawędziach chunk -> chunk.
Niezmienność z nagłówka `EChart.tsx` dotyczy natomiast grafu SSR (OOM V8 wywalał
renderer chunków Rollupa na przebiegu Cloudflare/Nitro). Prześledzone: wszyscy
importerzy `EChart` siedzą na powierzchniach tras LENIWYCH (`ChartCard`, `KpiTile`,
cztery panele BI, `ClubInsights`, `admin.coupons.analytics`), a `manualChunks`
w `vite.config.ts` nie ma kubełka na echarts ani łapacza końcowego - statyczny import
wylądowałby więc w chunku osiągalnym wyłącznie z chunków leniwych, POZA domknięciem
bootu. Bramka chunkowa zostałaby zielona przy padającym buildzie.

Stąd DRUGA bramka, źródłowa: `src/lib/ci/__tests__/echartsStaticEdge.test.ts`. Czyta
importy w `src/`, nie chunki - jest tańsza (nie wymaga builda), wcześniejsza (zapala
się w PR) i wskazuje plik. Dowodzi czterech rzeczy: wartościowo ECharts importuje
DOKŁADNIE JEDEN plik, `EChart.tsx` nie importuje modułu wykresu statycznie ale NADAL
wciąga go przez `import()`, nikt nie omija mostu sięgając po `EChartClient` wprost,
a sam moduł wykresu nadal używa modularnej rejestracji zamiast `import "echarts"`.
`import type` jest dozwolone i to nie jest furtka - importy typów są kasowane przy
kompilacji, a dziesięć plików panelu bierze z `echarts/core` wyłącznie typy. Piąty
przypadek jest sondą samego wykrywacza: gdyby mylił typ z wartością, pierwsza reguła
zapalałaby się na tych dziesięciu plikach i ktoś rozbroiłby ją, żeby uciszyć fałszywy
alarm. Sprawdzone, że bramka nie jest martwa: po chwilowym dopisaniu zakazanego
importu dwa przypadki padają.

Wybór markerów dla bramki chunkowej miał własną pułapkę, wartą zapisania, bo
kosztowała pierwszy wybór: prawie wszystkie czytelne komunikaty ECharts („There is
a chart instance already initialized on the dom.", „Initialize failed: invalid dom.",
„ECharts#one is deprecated.") siedzą w `process.env.NODE_ENV !== 'production'` i w
`echarts.min.js` ICH NIE MA. Sonda po nich dałaby bramkę, która nigdy się nie zapala.
Markery finalne (`_echarts_instance_` z `lib/core/echarts.js` i treść `throw new Error`
z `lib/util/clazz.js`) występują w wydaniu produkcyjnym i pochodzą z dwóch niezależnych
modułów rdzenia. Pilnuje tego trzecia bramka -
`src/lib/ci/__tests__/entryPurityEchartsMarkers.test.ts` - która sprawdza, że każdy
marker faktycznie jest w `echarts.min.js`, że żaden nie trafia we własny kod (fałszywy
alarm rozbroiłby zaufanie do bramki równie skutecznie jak jej brak) i że nie wróciły
markery wycięte z wydania produkcyjnego.

**N5 - klient Supabase tworzony na każde wywołanie. NAPRAWIONY, z korektą uzasadnienia.**
`postViews.functions.ts` tworzy teraz klienta raz na izolat, leniwie. Bezpieczne
w izolacie wielotenantowym, bo w kliencie nie ma NIC związanego z żądaniem:
`x-tenant-host` i `x-tenant-assert` rozstrzyga `fetchWithTenantHost` per wywołanie
z kontekstu żądania, a `persistSession: false` daje storage pamięciowy, do którego ten
moduł nie pisze. Leniwie, nie `const` na poziomie modułu, bo `createClient` rzuca przy
braku `SUPABASE_URL` i przy inicjalizacji modułu wywróciłby cały chunk strony wpisu
zamiast jednego wywołania server function.

DWIE KOREKTY DO ZLECENIA, obie istotne dla tego, jak tę zmianę opisywać.
Po pierwsze: to jest oszczędność CPU, nie latencji. Około 110 us i 16 kB na
konstrukcję wobec round-tripu Supabase rzędu 20-150 ms to 0,1-0,5% czasu ściany. Sam
„gorący plik" tego nie uzasadnia. Uzasadnia to model rozliczeniowy Workers, w którym
czas CPU jest zasobem BILOWANYM i limitowanym.
Po drugie: pytanie zlecenia o budżet SSR nie ma tu zastosowania. `/admin` ma
`ssr: false` (`src/routes/admin.tsx:11`), więc `admin.analytics.tsx` nie jest
renderowana serwerowo wcale, a na wejściu odpala DWA zapytania server-fn, i to
SEKWENCYJNIE (`getVitalsSummary` żyje w panelu montowanym dopiero po odpowiedzi
statusu). Szczyt równoległości z tej trasy to 1. Ani limit 6 subrequestów, ani
`SSR_DB_DEADLINE_MS` nie są w grze. Sześć ciężkich pulpitów siedzi za
niezamontowanymi zakładkami.

**N6 - `ga4.server.ts` na zerze, w tym podpisywanie JWT. NAPRAWIONY.**
0/71 linii i 0/17 funkcji -> 100% linii, funkcji, instrukcji i gałęzi. Wzorzec
skopiowany z `webpush.test.ts`: klucz RSA generowany W TEŚCIE, `fetch` podmieniony,
zero sieci i zero sekretów. Podpis weryfikuje się kluczem publicznym i NIE weryfikuje
obcym; klucz z literalnymi `\n` jest odescape'owany przed podpisaniem; token w oknie
ważności jest reużywany, wygasający - podpisywany na nowo.

Korekta do zlecenia: hipoteza o wycieku tokenu jest NEGATYWNA. Żadna ścieżka błędu
w `ga4.server.ts` nie umieszcza podpisanej asercji ani bearera w komunikacie.
Te przypadki są więc strażnikami regresji, nie znaleziskami.

**N7 - `as never` na zapisie `web_vitals`. NAPRAWIONY - i przyczyna była inna, niż
mówiło zlecenie.**
Zlecenie kazało zregenerować typy albo zapisać, dlaczego rzutowanie musi zostać.
Trzecia możliwość okazała się prawdziwa: typy JUŻ SĄ zregenerowane. `web_vitals`
(migracja 20260626210000) i `client_errors` (20260626230000) są w
`src/integrations/supabase/types.ts`. Komentarz „tabela z migracji, której nie ma
jeszcze w wygenerowanych typach" przestał być prawdziwy i nikt tego nie zauważył, więc
rzutowanie było już tylko wyłączeniem kontroli kształtu wiersza - na DWÓCH ścieżkach
zapisu osiągalnych publicznie, bez sesji i bez podpisu. Oba wiersze mają teraz
`TablesInsert<"web_vitals">` i `TablesInsert<"client_errors">`.

Dlaczego `check:stale-never-casts` tego nie złapał: bramka rozpoznaje rzutowanie
zapisane INLINE przy nazwie tabeli, a po zbatchowaniu ingestu cast przeniósł się na
zmienną (`insert(payload as never)`). Poszerzenie skanera to osobna zmiana, dotykająca
charteru bramki; tutaj usunąłem przyczynę.

**N8 - dodatkowy render na każdy wykres. NAPRAWIONY, z pomiarem przed i po.**
`useEffect(() => setTick(v => v + 1), [])` zastąpiony jedną wspólną subskrypcją motywu.
Powód, dla którego efekt istniał, jest PRAWDZIWY i został zachowany: `DesignTokensStyle`
wstrzykuje paletę tenanta z bazy przez zapytanie react-query, więc `--primary` czy
`--foreground` mogą dojechać po pierwszym malowaniu wykresu. Zmieniło się narzędzie:
motyw jest rozwiązywany raz, porównywany z poprzednim i rozgłaszany WYŁĄCZNIE gdy się
różni. Do tego `resolveChartTheme` pobiera migawkę stylu RAZ zamiast raz na token
(dziesięć tokenów to było dziesięć wymuszeń przeliczenia stylu).

ZMIERZONE, panel dziesięciu wykresów (`__tests__/EChartClient.test.tsx`):

| wielkość                | przed | po  |
| ----------------------- | ----: | --: |
| renderów wykresu        |    20 |  10 |
| rozwiązań motywu        |    20 |   2 |
| wywołań getComputedStyle |   200 |   2 |

Test „tokeny, które dojechały PO pierwszym malowaniu, trafiają do wykresu" pilnuje,
żeby oszczędność nie została kupiona za poprawność. Osobna subtelność, znaleziona
pomiarem: porzucenie migawki przy zniknięciu ostatniego subskrybenta rodziło NOWY
obiekt dla identycznych kolorów, a `useSyncExternalStore` porównuje migawki przez
`Object.is` - czyli przełączenie zakładki panelu na wczytane dane dawało wymuszony
drugi render mimo całej zmiany. Migawka jest więc znaczona jako podejrzana, nie
wyrzucana.

#### Trasy panelu: cztery ekrany z zera do stu

Krok 13 zlecenia wymieniał pięć powierzchni panelu stojących na zerze. Wszystkie
wyszły z zera, cztery z nich na 100% linii i 100% funkcji:

| plik                            | wejście   | linie |   funkcje |  gałęzie | przypadków |
| ------------------------------- | --------- | ----: | --------: | -------: | ---------: |
| `src/routes/admin.analytics.tsx`      | 0/54, 0/27 | 100% | 100% (27/27) | 98,42% |  51 |
| `src/routes/admin.link-monitor.tsx`   | 0/33, 0/7  | 100% | 100% (7/7)   | 94,87% |  38 |
| `src/routes/admin.experiments.tsx`    | 0/26, 0/8  | 100% | 100% (8/8)   |   100% |  20 |
| `src/routes/admin.performance.tsx`    | 0/8, 0/3   | 100% | 100% (3/3)   |   100% |  12 |
| `src/components/admin/performance/EdgeCacheCard.tsx` | 0/43, 0/18 | 100% | 100% (18/18) | 94,83% | 21 |
| `src/lib/charts/geoQuery.ts`          | 0/4, 0/1   | 100% | 100% (2/2)   |   100% |  12 |
| `src/lib/tracker-admin.functions.ts`  | 0/3, 0/1   | 100% | 100% (1/1)   |      - |  10 |

**Dlaczego to nie jest pokrycie „na sam render".** W tych plikach SKLEJENIE JEST
LOGIKĄ, a nie detalem implementacji:

`/admin/performance` trzyma aktywną zakładkę W ADRESIE (`?tab=errors`), więc zakładka
jest linkowalna - i właśnie dlatego `validateSearch` musi ZERWAĆ każdą nieznaną
wartość do `undefined`. Parametr przepuszczony wprost do `Tabs value=` daje panel bez
ŻADNEJ widocznej zakładki, czyli podrzucony `?tab=cokolwiek` wywraca stronę. Testowane
są też dwie własności, których sam render nie dotyka: powrót na zakładkę DOMYŚLNĄ
czyści parametr (jeden widok = jeden adres, inaczej historia mnoży wpisy przy każdym
przełączeniu), a nawigacja jest `replace`.

`/admin/analytics` NIE trzyma zakładki w adresie i test to przypina - nie jako
zalecenie, ale jako stan faktyczny, żeby ewentualne przejście na zakładki linkowalne
było zmianą jawną. Ważniejsze: w tej trasie STATUS DECYDUJE, CO SIĘ RENDERUJE.
Nieskonfigurowany GA4 dostaje instrukcję konfiguracji, a NIE pulpit odpytujący Data
API bez kluczy; zakładka GSC bez danych statusu renderuje `null`, a nie pulpit
z `configured: undefined`. Stanów GA4 jest TRZY, nie dwa: „podłączony", „jest service
account, brak `GA4_PROPERTY_ID`" i „nic nie ma" - zlepienie środkowego ze skrajnym
kosztuje administratora godzinę, bo albo szuka klucza, który już wgrał, albo czeka na
dane, które nie przyjdą. Przycisk testowego eventu Measurement Protocol ma cztery
rozłączne wyjścia, w tym WCZESNE wyjście przy `configured: false` (bez `return`
panel dokładał drugi komunikat o odpowiedzi, której nie było). Osadzony raport Looker
Studio wymaga flagi ORAZ adresu - flaga bez adresu dawałaby pustą ramkę 720 px
udającą raport.

`/admin/link-monitor` opiera się na jednym ogniwie zapytania: `.eq("ok", false)`. Bez
niego tabela pokazuje wszystkie sprawdzone linki, w większości działające, a tytuł
panelu zaczyna kłamać - przy czym PUSTY panel przy zdrowej witrynie jest wynikiem
POPRAWNYM, więc test musi rozróżniać „nie ma zepsutych" od „zapytanie nie filtruje".
Próg alertu asertowany jest po IMPORTOWANEJ stałej `BROKEN_LINK_ALERT_THRESHOLD`, a
nie po wpisanej w test dziesiątce: skaner wysyła powiadomienie od tego samego progu,
więc zmiana polityki musi przestawić panel i powiadomienie naraz albo oblać test.
Sugestia zamiany ma ZAWSZE adres - konkretną migawkę, gdy skaner ją znalazł, albo
uniwersalny `web/2/`; wiersz bez linku odsyłałby redaktora do ręcznego wklejania
adresów do Wayback Machine, czyli do stanu przed tym panelem.

`/admin/experiments` liczy werdykt PRAWDZIWYM `zScore` i `conversionRate` (atrapowane
są tylko dwa hooki danych), bo atrapa w tym miejscu zamieniłaby test w sprawdzanie
własnych liczb. Dwie asercje warte wymienienia: zero ekspozycji daje „brak danych", a
nie „różnica nieistotna" - przy zerowym ruchu `zScore` zwraca 0, więc naiwny render
ogłaszałby brak istotności na próbce, której nie ma; a zwycięzcą jest wariant o
wyższej KONWERSJI, nie o wyższej liczbie konwersji - wariant A z 5/100 bije B z
10/1000, choć liczba bezwzględna „wygląda lepiej". Pomyłka w tym miejscu przestawia
treść strony na gorszą i nikt tego nie zauważy.

`lib/tracker-admin.functions.ts` to trzy linie, w których dwie decyzje są decyzjami
bezpieczeństwa: handler bierze klienta SERVICE ROLE (tick musi zadziałać ponad RLS, bo
drenuje kolejki pocztowe i push wszystkich najemców - podmiana na `context.supabase`
uciszyłaby połowę jobów bez jednego błędu w logu, bo RLS po prostu nie oddałby
wierszy), a funkcja NIE MA walidatora, więc nie da się z zewnątrz podać ani najemcy,
ani operatora, ani zakresu jobów.

`lib/charts/geoQuery.ts` ma cztery linie i jedną własność, którą łatwo zepsuć
„porządkując" klucze cache: `["public", "geo", region]` NIE nosi identyfikatora
najemcy ani języka - i to jest poprawne, bo zasób to wersjonowany plik statyczny
(`/geo/europe-50m.v1.json`) identyczny dla każdego obszaru roboczego. Dorzucenie
czegokolwiek zmiennego zwielokrotniłoby pobrania setek kilobajtów geometrii raz na
najemcę i raz na język. `staleTime: Infinity` jest wnioskiem z wersji w NAZWIE PLIKU,
nie optymizmem.

**Higiena tych testów.** Żaden nie wychodzi w sieć: ramka Looker Studio biegnie
z `disableIframePageLoading` (happy-dom NAPRAWDĘ nawiguje `<iframe src>`; ten sam
wzorzec i to samo uzasadnienie co w `LazyQuizIframe.test.tsx`), a zasoby geometrii
mają atrapę `fetch`. Adresy e-mail wyłącznie na `example.com`. Oczekiwanie idzie na
STAN CACHE'U react-query, nie na liczbę mikrotasków - asercja po dwóch
`await Promise.resolve()` mierzy PIERWSZĄ KLATKĘ i przechodzi także wtedy, gdy
zapytanie nie zwróciło danych (sprawdzone: w pierwszej wersji testu monitora linków
19 z 35 przypadków „przechodziło" właśnie na pustej tabeli). Dostępność obu dużych
tras sprawdza `axe-core` przez `src/test/axe.ts` na drzewie Z DANYMI, bo pusty widok
nie ma czego naruszyć.

**Czego te testy NIE dowodzą.** Uprawnień. Żadna z tych tras nie ma własnego
middleware - rolę sztabową wymuszają funkcje serwerowe (`requireAdmin`,
`requireStaff`) i RLS, a nie render; w teście nie ma sesji, więc „użytkownik bez roli
sztabowej nie widzi panelu" nie jest tu rozstrzygalne i pilnuje tego bramka
`check:authz-snapshot`. Izolacji najemcy również nie dowodzą na poziomie tras, i to
jest wniosek z lektury, nie skrót: zapytanie monitora linków ŚWIADOMIE nie ma
`.eq("tenant_id", …)`, bo `outbound_link_checks` stoi pod RLS
`tenant_id = public.current_tenant_id() AND public.is_staff()` (migracja
20260720135000), a `useExperimentsAdmin` filtruje `tenant_id` i skaluje klucz cache
po tenancie już poza trasą. Powtarzanie tych warunków w atrapie klienta dowodziłoby
wyłącznie treści atrapy - dowód mieszka w `check:tenant-isolation`.

#### Czy suita jest zielona: warunek, bez którego procenty nie znaczą nic

`coverage.reportOnFailure: true` w `vitest.config.ts` jest w tym repozytorium
świadomą decyzją (raport i progi muszą powstać także na czerwonej suicie), ale ma
skutek uboczny, który trzeba wypowiedzieć: **linia wykonana przez PADAJĄCY test
nadal liczy się jako pokryta.** Wzrost procentu na czerwonej suicie może więc być
wzrostem pozornym. Dlatego liczby wyżej podaję razem z rachunkiem przebiegu, a nie
zamiast niego.

Pełny przebieg `vitest run --coverage` na tym HEAD: **2 084 pliki testowe, 2 077
zielonych, 2 pominięte, 5 czerwonych; 56 880 przypadków, z tego 56 461 zielonych,
361 oczekiwanych porażek (`it.fails`), 51 pominiętych, 7 padnięć.**

Wszystkie 5 czerwonych plików leży POZA modułem 17 i wszystkie 5 padało już przed
kampanią. To nie jest wniosek z lektury, to pomiar: te same cztery pliki uruchomiłem
w worktree przypiętym do commitu wyjściowego `3eb5e92` i w drzewie końcowym -
**baseline 5 failed / 69 passed, drzewo końcowe 5 failed / 69 passed**, bloki
padnięć identyczne poza prefiksem ścieżki w stack trace. Wszystkie cztery pliki
testowe są bajt-identyczne w obu drzewach (te same sumy MD5), a kampania nie dotknęła
katalogu `supabase/` ani jednym plikiem.

| plik | przypadek | przyczyna | pada w baseline |
| ---- | --------- | --------- | --------------- |
| `lib/ci/__tests__/migrationReplay.test.ts` | porządek nazw = porządek wersji | `expected true to be false` | TAK |
| `lib/ci/__tests__/migrationReplay.test.ts` | ratchet bliźniaków treści | dwie nowe pary bliźniaków z gałęzi Lovable (`page_full_path_tenant_scope`, `owner_plane_tenant_scope_read_history`) | TAK |
| `lib/authz/__tests__/authzSnapshotParity.test.ts` | snapshot vs migracje | PROVENANCE, `migrations: 932 -> 935` | TAK |
| `lib/server/__tests__/serviceRoleTenantScope.gate.test.ts` | `page_full_path` wiąże najemcę | `it.fails`, który ZACZĄŁ przechodzić - czyli dług naprawiony, przypięcie nieusunięte | TAK |
| `components/admin/monetization/__tests__/AdminMonetizationLedger.test.tsx` | przydział bezterminowy | brak tekstu „Bezterminowo" po 5 s | TAK |

Czwarty wiersz zasługuje na komentarz, bo jest lustrem tej kampanii: `it.fails`
przestaje być dokumentacją długu w chwili, w której dług zniknie, a wtedy zaczyna
blokować suitę. Przypięcia z tego rozdziału trzeba będzie zdejmować tak samo -
zgaśnięcie przypięcia jest sygnałem do jego usunięcia, nie do zignorowania.

Jedyny plik modułu 17, który w tym przebiegu był czerwony, to
`routes/__tests__/adminAnalyticsRoute.test.tsx` - dwa padnięcia asercji `axe-core`
dopisane w trakcie przebiegu. Naruszenie jest realne (`heading-order`, jeden węzeł),
zostało przypięte jako defekt i plik jest zielony (52 przypadki + 3 przypięcia).
Pokrycie tego pliku nie zależało od tych dwóch asercji: 100% linii i 27/27 funkcji
zmierzone osobno przed i po ich dopisaniu.

#### Progi per-ścieżka: 376 -> 455

Dopisane **79 progów** dla plików modułu 17, które wyszły z zera. Reguła jest jedna i
mechaniczna: próg = ZMIERZONA wartość zaokrąglona w dół, minus 1 pp. Margines nie jest
tam po to, żeby ukryć spadek - na pliku czterdziestolinijkowym 1 pp to mniej niż jedna
linia - tylko po to, żeby inny podział na forki nie zapalał bramki. Trzy ograniczenia
zlecenia są spełnione dosłownie:

- **żaden istniejący próg nie został obniżony ani usunięty** - generator pomija pliki,
  które próg już mają, więc nowy nie ma jak leżeć niżej niż stary;
- **żaden plik nie został wyłączony z pomiaru** - `all: true` i zakres
  `src/**/*.{ts,tsx}` nietknięte;
- **progu nie stawia się nad powierzchnią niedomkniętą** - bar wejścia to 70% linii,
  więc plik z pokryciem 40% zostaje bez progu zamiast dostać próg 39%, który
  usankcjonowałby stan.

#### Bramki: stan zmierzony na tym HEAD

`check:entry-purity` - **ZIELONA, z nowym wpisem**. Świeży `npm run build`, ścieżka
bootowania to 9 chunków statycznie osiągalnych z 941; lista ciężkich modułów zawiera
teraz `echarts`. `check:chunks` - ZIELONA (941 chunków, 5455 krawędzi, graf acykliczny).
`check:chunk-parity`, `check:i18n-parity`, `check:i18n-hardcoded`,
`check:i18n-default-value`, `check:i18n-overlay-imports`, `check:types-freshness`,
`check:stale-never-casts`, `check:db-row-casts`, `check:unknown-casts`,
`check:gate-coverage`, `check:tenant-isolation` (62 asercje RLS) - ZIELONE.
`check:db-contract` i `check:migration-ledger` wymagają poświadczeń do bazy i w tym
środowisku nie mają czego zweryfikować - nie są to porażki, tylko brak wejścia.

`check:authz-snapshot` - **CZERWONA, i czerwona BAJT W BAJT tak samo przed kampanią**
(sprawdzone w drzewie wyjściowym): `migrations: 932 -> 935`, klasa PROVENANCE, czyli
„ten sam krąg uprawnionych, inne miejsce w historii". Wydanie 8 audytu notuje ten sam
dryf przy 932 -> 934. Zlecenie zabrania regenerowania snapshotu dla zgaszenia
czerwieni i nie regenerowałem go - kampania nie dodała ani jednej migracji, więc nie
ma tu nic mojego do naprawienia.

`check:bundle` - **CZERWONA, i była czerwona PRZED tą kampanią**. To jest jedyna
bramka, która nie przechodzi, więc podaję pomiar z obu stron, z osobnego drzewa
roboczego przypiętego do commitu wyjściowego:

| pomiar                | wejście (`3eb5e92`) | po kampanii | budżet   |
| --------------------- | ------------------: | ----------: | -------: |
| PUBLIC                |          2 687,1 KB |  2 687,3 KB | ≤ 2 715 |
| OVERALL               |          4 320,5 KB |  4 320,6 KB | ≤ 4 306 |
| domknięcie bootowania |            576,7 KB |    576,8 KB |   ≤ 579 |
| największy chunk      |            274,0 KB |    274,1 KB |   ≤ 280 |

Delta tej kampanii to **+0,1 KB gzip na OVERALL i +0,2 KB na PUBLIC** - dziesiąte
części kilobajta, czyli tyle, ile waży bufor beaconu i wspólny magazyn motywu.
Przekroczenie budżetu OVERALL wynosi 14,5 KB i pochodzi spoza tego modułu: rozjazd
wobec zamrożonego baseline'u wskazuje `i18n` (+129,1 KB),
`EventStudioModuleSections` (+65,5 KB, NOWY), `useEventSessions` (+31,1 KB, NOWY)
i `scanner` (+15,3 KB, NOWY). Batchowanie metryk i zdjęcie efektu z `EChartClient`
nie zmieniły kilobajtów w żadnym mierzalnym stopniu - zmieniły liczbę żądań i liczbę
renderów, a te nie są mierzone przez tę bramkę.

#### Co znalazły testy, których nikt nie szukał: 96 przypięć `it.fails`

Reguła zlecenia była jednoznaczna: defekt poza listą N1-N8 idzie do rejestru jako
`it.fails` z opisem złamanego kontraktu, a nie do naprawy. Wszystkie niżej są więc
ZAPISANE, nie naprawione - i to jest decyzja zamawiającego, nie mój wniosek o ich
nieważności. Przypięcia leżą w 35 plikach testowych modułu. Cztery klasy zasługują na osobne miejsce.

**KLASA PIERWSZA, NAJPOWAŻNIEJSZA: pięć kluczy cache bez identyfikatora warsztatu.**
To nie są trzy przypadki, to jeden wzorzec powtórzony w całym module. `queryKey:
["gsc-sites"]` jest STAŁY - nie ma w nim ani tenanta, ani użytkownika. Przy kliencie
react-query przeżywającym zmianę warsztatu panel dostaje z cache listę właściwości
POPRZEDNIEGO warsztatu, `preferredSite` wskazuje cudzą właściwość, a wpisy
`["gsc-bi", <cudza właściwość>, …]` są jeszcze świeże (`staleTime: 60_000`) - więc
PIERWSZA KLATKA panelu warsztatu B pokazuje zapytania warsztatu A. Żadne żądanie
sieciowe przy tym nie leci, co czyni wyciek CICHYM: widać go wyłącznie na ekranie,
nie w logu i nie w zakładce sieci. Ten sam kształt mają panele GA4 i powiązanych
wpisów oraz - poza panelami - `usePendingCounters`, gdzie klucz kolejek nie niesie
przestrzeni roboczej, więc liczniki tenanta A trafiają do sesji tenanta B.

Warto być tu precyzyjnym co do zasięgu, bo od tego zależy pilność: cache react-query
żyje w JEDNEJ sesji przeglądarki, więc wyciek wymaga tej samej sesji widzącej dwa
warsztaty bez pełnego przeładowania. To nie jest wektor dla obcego napastnika - to
jest wektor dla operatora obsługującego kilka instalacji, czyli dokładnie dla roli,
która patrzy na te panele. Naprawa jest mechaniczna: identyfikator warsztatu w kluczu.
Pięć przypięć zgaśnie tego samego dnia, w którym ktoś ją wprowadzi.
**REKOMENDACJA: to powinna być następna zmiana w tym module, przed dalszym pokryciem.**

**KLASA DRUGA: brak alternatywy tekstowej dla wykresów.** Wydanie 8 audytu
PRZEWIDZIAŁO ten defekt dla tego modułu („wykres bez alternatywy tekstowej jest dla
części odbiorców pustym prostokątem") i przewidziało poprawnie: pięć z siedmiu
wykresów panelu GSC i wszystkie sześć wykresów panelu GA4 nie ma żadnej.
`ChartDataTable.tsx` stoi na 100% - mechanizm ISTNIEJE i jest przetestowany, tylko
panele go nie wołają. Do tego dziewięć przycisków panelu GSC bez dostępnej nazwy.
ECharts maluje do kanwy, która dla czytnika ekranu jest pustym prostokątem, więc dla
tej części odbiorców raport zarządczy nie ma treści - przy pokryciu warstwy
semantycznej bliskim 100%.

**KLASA TRZECIA: kolory wykresów BI, których przeglądarka nie sparsuje.**
`chartTheme.readVar` rozpoznaje tylko `#hex`, `rgb` i `hsl`, a wszystko inne owija
w `hsl(...)`. Repozytorium definiuje `--foreground`, `--muted-foreground`, `--border`
i `--background` w OKLCH (`src/styles.css`), więc te cztery tokeny wracają z
`resolveChartTheme` jako `hsl(oklch(0.18 0 0))` - wartość bez sensu składniowego.
Nie jest to hipoteza o przyszłym formacie tokenów, to obecny format tokenów tego
repozytorium.

**KLASA CZWARTA, ZNALEZIONA NA KOŃCU KAMPANII: jednojęzyczny panel, którego nie
widzi żadna bramka i18n.** `admin.analytics.tsx` przepuszcza przez słownik DWA
napisy (`admin.nav.analytics`, `admin.nav.analyticsReconciliation`) z
kilkudziesięciu. Nazwy siedmiu zakładek, opisy trzech pastylek statusu, cztery
karty trybów GA4 wraz z instrukcjami krok po kroku, wszystkie tytuły,
interpretacje i kroki naprawcze wniosków - to literały polskie wpisane w JSX.
Anglojęzyczny administrator widzi ten panel po polsku.

Istotniejsze od samego długu jest to, DLACZEGO żadna bramka go nie widzi - to
jest luka w POMIARZE, nie tylko w pliku:

- `check:i18n-parity` porównuje KLUCZE między PL i EN. Tych napisów nie ma w
  żadnym słowniku, więc nie ma czego porównać: parytet jest zielony dokładnie
  dlatego, że tekst istnieje wyłącznie w kodzie.
- `check:i18n-hardcoded` (ratchet per plik) mierzy ROZGAŁĘZIENIE po języku:
  `isPl ? "Zapisz" : "Save"`, `lang === "pl" ? … : …`, bliźniaki
  `l("Zapisz","Save")`. Tekst JEDNOJĘZYCZNY się nie rozgałęzia, więc nie jest
  trafieniem - plik ma w bazie ratchetu zero i to zero jest PRAWDZIWE dla tego,
  co bramka mierzy.
- `check:i18n-default-value` szuka `t(key, { defaultValue })`, a tu nie ma nawet
  wywołania `t`.

Trzy zielone bramki i jednojęzyczny panel nie są sprzecznością - są granicą
pomiaru. **REKOMENDACJA: dołożyć bramkę mierzącą JEDNOJĘZYCZNY tekst widoczny dla
użytkownika** (literał zdaniowy w JSX poza `t()`), bo bez niej każdy kolejny panel
może wejść do repozytorium w jednym języku i przejść wszystkie trzy istniejące
bramki. Do czasu jej powstania defekt jest przypięty asercją na DRZEWIE
RENDEROWANYM: przy atrapie i18n zwracającej klucz każdy widoczny napis zdaniowy
musi być echem klucza.

Pozostałe przypięcia dotyczą arytmetyki interpretacji i rozróżniania stanów. Dwa
warte wymienienia, bo powtarzają się w OBU silnikach wniosków niezależnie:
podział okna na „połowy" przy nieparzystej liczbie dni (`Math.floor(n/2)` daje H1
krótsze od H2, więc siedem dni po DOKŁADNIE dziesięć sesji raportuje +33,3% wzrostu
na ruchu, w którym nic nie urosło - i ta sama arytmetyka w drugą stronę ukryje realny
spadek), oraz mieszanie „braku pomiaru" z „pomiarem równym zero": kafelki KPI
w trakcie pobierania, przy padniętym zapytaniu i przy nieskonfigurowanym GA4 malują
zera, jakby to był pomiar. Pierwszy z tych błędów zmienia znak wniosku, drugi zmienia
raport „nie wiemy" na raport „jest zero".

**Dwa przypięcia jednostkowe warte wymienienia poza klasami.**

Pierwsze - kafelek RUM w przeglądzie analityki gubi jednostkę dokładnie tam, gdzie
jest najpotrzebniejsza:

```ts
`${Math.round(m.p75)} ${m.p75 >= 1000 ? "" : "ms"}`
```

Warunek jest odwrócony względem intencji. Dla wartości POWYŻEJ sekundy - czyli dla
każdego złego LCP - kafelek pokazuje samą liczbę („2400 ", ze spacją na końcu), a
jednostkę dokłada tylko wartościom dobrym. Czytający nie ma jak odróżnić 2400 ms od
2400 s ani od wskaźnika bezwymiarowego, i to na tym jednym kafelku, który ma
zaalarmować. Intencją była zamiana na sekundy („2,4 s"), nie usunięcie jednostki.

Drugie - ślad audytowy ręcznego ticku z `/admin/tracker` gubi najemcę. Kontrakt jest
zapisany w samym kodzie, więc nie jest wnioskiem interpretacyjnym; `JobsTickMeta`
w `lib/server/jobsTick.server.ts`:

```ts
/** Tylko tick ręczny z panelu: ślad audytowy (tenant + operator). */
tenantId?: string | null;
actorId?: string | null;
```

`runTrackerTickNow` podaje `actorId`, a `tenantId` pomija, więc `recordJobRun`
odkłada w `job_runner_runs` wiersz z `tenant_id: null`. BLIŹNIACZA funkcja
`/admin/scheduler` rozwiązuje najemcę z profilu operatora i podaje oba pola -
identyczne działanie z dwóch paneli zapisuje się więc RÓŻNIE. Log przebiegów jest
odczytywany globalnie (RPC zdrowia harmonogramu nie filtruje po najemcy), bo tick
jest globalny - i właśnie dlatego kolumna `tenant_id` jest jedynym miejscem, w
którym widać, CZYJ operator wypchnął alerty ponad RLS wszystkich najemców.
W instalacji z wieloma zespołami sztabowymi ręczny tick z `/admin/tracker` jest
przypisywalny do osoby, ale nie do obszaru roboczego, a rekonstrukcja po `actorId`
wymaga sięgnięcia do profilu, który w tym czasie mógł już zmienić najemcę. Naprawa
jest mechaniczna i wzorowa istnieje obok (`scheduler.functions.ts`).

### MODUŁ 18 — CRM · linie 99,03% · funkcje 98,60%

**Rodzaje testów:** jednostkowy 18 · warstwy danych 5 · komponentowy 6 · funkcji serwerowej 2 · parytetu 1 · hooka 1.

**Co tu decyduje:** CRM pokazuje, po co jest **test parytetu**: filtr leadów istnieje w dwóch implementacjach (nad wierszami i nad zapytaniem), więc bez porównania obu stron poprawka w jednej zostawia drugą zepsutą. Poza tym **test warstwy danych** dla zapytań i **test jednostkowy** dla mapowania importu danych osobowych.

**Bez tego rodzaju przechodzi taki defekt:** poprawka w filtrze nad wierszami nie trafia do filtra nad zapytaniem. Lista i eksport pokazują różne zbiory leadów, a handlowiec pracuje na tym mniejszym i nie wie o brakujących.

| Funkcjonalność                        | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ------------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| CRM: UI panelu                        |     19 |        569 |  95,1% | 83,4% |   96,5% | **96,0%** |   279/289 |
| CRM: import/eksport CSV + organizacje |      7 |        356 |  98,8% | 92,0% |   96,3% | **99,7%** |     79/82 |
| CRM: kontakty, firmy, lejek, zadania  |     25 |      1 115 |  98,9% | 90,7% |   99,6% | **99,8%** |   275/276 |

### MODUŁ 19 — Ustawienia / integracje / users / multi-tenant / RODO · linie 93,36% · funkcje 90,21%

**Rodzaje testów:** jednostkowy 32 · warstwy danych 9 · funkcji serwerowej 6 · hooka 3 · komponentowy 3 · parytetu 1 · bramki 1.

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

### MODUŁ 20 — Platforma / backend / infrastruktura / SSR · linie 75,83% · funkcje 68,65%

**Rodzaje testów:** komponentowy 42 · jednostkowy 125 · warstwy danych 23 · funkcji serwerowej 24 · dostępności 11 · bramki 5 · parytetu 2.

**Co tu decyduje:** platforma utrzymuje **bramki (meta-inwarianty)**: „bramka, która istnieje, musi się uruchamiać”, parytet konfiguracji chunków, kontrakt zmiennych workflow. To rodzaj testu, który skaluje się z repozytorium, nie z liczbą przypadków — jeden taki test pilnuje wszystkich przyszłych plików.

**Bez tego rodzaju przechodzi taki defekt:** bramka istnieje w repozytorium i nie jest wpięta w workflow, więc zdanie „mamy to sprawdzone” jest fałszywe przez wiele miesięcy. Nikt tego nie zauważy, bo brak sygnału nie wygląda jak awaria — i to jest defekt, którego nie wykryje żaden test kodu produkcyjnego.

| Funkcjonalność                          | Plików | LOC mierz. | Instr. |   Gał. | Funkcje |      Linie | fn (szt.) |
| --------------------------------------- | -----: | ---------: | -----: | -----: | ------: | ---------: | --------: |
| Routing / trasy publiczne (powłoka)     |      8 |        423 |  26,6% |  17,2% |   16,0% |  **27,4%** |    17/106 |
| A11y / watchdog / MCP                   |      9 |        164 |  39,6% |  29,9% |   31,0% |  **42,1%** |      9/29 |
| Klient Supabase / zapytania             |     27 |        959 |  69,4% |  64,5% |   73,7% |  **71,7%** |   205/278 |
| Warstwa serwerowa (server fns)          |     19 |        980 |  78,1% |  73,6% |   81,8% |  **78,7%** |   180/220 |
| Obsługa błędów / error boundary         |      7 |        115 |  79,5% |  79,3% |   69,0% |  **79,1%** |     20/29 |
| SSR / hydracja / cache brzegowy         |     32 |      1 160 |  83,6% |  79,7% |   83,3% |  **85,1%** |   185/222 |
| Bramki CI (rejestry, kontrakty)         |     32 |      3 107 |  93,5% |  86,6% |   93,3% |  **94,9%** |   529/567 |
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

Razem: **14 048 / 14 527 linii = 96,70%**, funkcje **4415/4624 = 95,48%**.

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

**CMS: page builder (typ Elementor) — schemat i operacje** — linie 96,9%, funkcje 294/295 (99,7%), plików 11 (bez pokrycia: 0), LOC 650

> Bez ani jednego wywołania: **1 funkcji** (0 nazwanych, 1 anonimowych domknięć).

**CMS: panele właściwości widgetów** — linie 97,3%, funkcje 1972/2076 (95,0%), plików 112 (bez pokrycia: 0), LOC 4 671

> Bez ani jednego wywołania: **104 funkcji** (0 nazwanych, 104 anonimowych domknięć).

**CMS: sanityzacja HTML** — linie 97,5%, funkcje 29/32 (90,6%), plików 4 (bez pokrycia: 0), LOC 157

> Bez ani jednego wywołania: **3 funkcji** (0 nazwanych, 3 anonimowych domknięć).

**CMS: widgety buildera — render publiczny** — linie 97,9%, funkcje 758/795 (95,3%), plików 55 (bez pokrycia: 0), LOC 3 596

> Bez ani jednego wywołania: **37 funkcji** (2 nazwanych, 35 anonimowych domknięć). Nazwane:
>
> - `luminance @ src/components/builder/organisms/widget-view/socialHover.ts:146`
> - `readableOn @ src/components/builder/organisms/widget-view/socialHover.ts:162`

**CMS: render bloków (publiczny)** — linie 98,1%, funkcje 499/518 (96,3%), plików 39 (bez pokrycia: 0), LOC 1 920

> Bez ani jednego wywołania: **19 funkcji** (0 nazwanych, 19 anonimowych domknięć).

**CMS: silnik bloków (typ Gutenberg) — rdzeń** — linie 98,9%, funkcje 148/148 (100,0%), plików 9 (bez pokrycia: 0), LOC 359

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

**CMS: builder sidebara + wzorce** — linie 99,2%, funkcje 132/132 (100,0%), plików 7 (bez pokrycia: 0), LOC 238

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

**CMS: warstwa content-model (rozdział bloki⇄builder)** — linie 99,3%, funkcje 32/32 (100,0%), plików 7 (bez pokrycia: 0), LOC 150

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

**CMS: import z Gutenberga / WordPressa** — linie 99,8%, funkcje 249/250 (99,6%), plików 10 (bez pokrycia: 0), LOC 1 309

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

| Plik                                                       | LOC mierzone | Moduł                                              |
| ---------------------------------------------------------- | -----------: | -------------------------------------------------- |
| `src/routes/admin.podcasts.tsx`                            |          337 | M7                                                 |
| `src/routes/admin.research-programs.tsx`                   |          249 | M7                                                 |
| `src/components/admin/TrendingTickerPane.tsx`              |          195 | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły |
| `src/routes/admin.tracker.tsx`                             |          188 | M7                                                 |
| `src/components/admin/analytics/GscBiDashboard.tsx`        |          163 | M17                                                |
| `src/components/chat/ChatComposer.tsx`                     |          160 | M9                                                 |
| `src/routes/admin.paywall.tsx`                             |          153 | M20                                                |
| `src/routes/admin.hiring.tsx`                              |          148 | M21                                                |
| `src/components/notifications/NotificationsCenter.tsx`     |          146 | M12                                                |
| `src/routes/__root.tsx`                                    |          124 | M20                                                |
| `src/routes/admin.community.qa.tsx`                        |          122 | M16                                                |
| `src/routes/admin.programs.tsx`                            |          122 | M7                                                 |
| `src/components/admin/analytics/Ga4BiDashboard.tsx`        |          116 | M17                                                |
| `src/components/admin/analytics/RelatedPostsAnalytics.tsx` |          111 | M17                                                |
| `src/routes/admin.live-blog.tsx`                           |          110 | M7                                                 |
| `src/routes/admin.careers.tsx`                             |          109 | M21                                                |
| `src/routes/network.tsx`                                   |          104 | M10                                                |
| `src/routes/admin.web-stories.tsx`                         |           98 | M7                                                 |
| `src/routes/messages.tsx`                                  |           97 | M9                                                 |
| `src/routes/api/public/community-cron.ts`                  |           93 | M16                                                |
| `src/components/admin/analytics/VitalsBiDashboard.tsx`     |           86 | M17                                                |
| `src/routes/admin.super.mobile-drawer.tsx`                 |           83 | M20                                                |
| `src/components/ConsentScriptInjector.tsx`                 |           83 | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły |
| `src/routes/podcast.$slug.tsx`                             |           82 | M7                                                 |
| `src/routes/qa.$slug.tsx`                                  |           82 | M7                                                 |
| `src/routes/admin.community.polls.tsx`                     |           78 | M16                                                |
| `src/lib/webVitals.ts`                                     |           78 | M17                                                |
| `src/components/chat/GroupInfoDialog.tsx`                  |           77 | M9                                                 |
| `src/routes/tracker.index.tsx`                             |           75 | M7                                                 |
| `src/routes/programs.$slug.tsx`                            |           73 | M7                                                 |
| `src/routes/podcasts.$show.tsx`                            |           72 | M7                                                 |
| `src/components/admin/analytics/ga4Insights.ts`            |           71 | M17                                                |
| `src/lib/analytics/ga4.server.ts`                          |           71 | M17                                                |
| `src/lib/ai-gateway.server.ts`                             |           71 | M20                                                |
| `src/components/chat/ExpertRequestDialog.tsx`              |           71 | M9                                                 |
| `src/components/admin/analytics/gscInsights.ts`            |           69 | M17                                                |
| `src/routes/admin.expert-layouts.tsx`                      |           68 | M7                                                 |
| `src/components/admin/AccessSettingsPane.tsx`              |           67 | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły |
| `src/lib/analytics/semantic/snapshot.functions.ts`         |           66 | M17                                                |
| `src/lib/analytics/audience.functions.ts`                  |           65 | M17                                                |

Łącznie plików produkcyjnych z pokryciem **0%: 338** z 3 260 (10,37%).

### 5.2 Katalogi bez ANI JEDNEGO pliku testowego

Sygnał niezależny od pokrycia: katalog może mieć pokrycie z testu innego katalogu, ale nie ma
testu WŁASNEGO — czyli nikt nie testuje go wprost. Takich katalogów jest **65**,
obejmują **94 plików / 24 954 linii**.

| Katalog                                          | Plików |   LOC |
| ------------------------------------------------ | -----: | ----: |
| `src/lib/locale`                                 |      2 | 4 562 |
| `src/components/admin/ThemeOptionsPane.tsx`      |      1 | 1 898 |
| `src/components/admin/GlobalColorsEditor.tsx`    |      1 | 1 479 |
| `src/components/admin/TrendingTickerPane.tsx`    |      1 | 1 139 |
| `src/components/admin/PostSettingsMetabox.tsx`   |      1 |   878 |
| `src/lib/content-model`                          |      7 |   789 |
| `src/components/admin/settings`                  |      4 |   686 |
| `src/components/author`                          |      2 |   664 |
| `src/components/admin/AdminShell.tsx`            |      1 |   651 |
| `src/components/admin/PostGeneralOverview.tsx`   |      1 |   627 |
| `src/components/admin/ThemeFontSizesPane.tsx`    |      1 |   602 |
| `src/lib/cookieBanner`                           |      2 |   574 |
| `src/components/admin/WordPressImportDialog.tsx` |      1 |   573 |
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
| `src/server.ts/(root)`                           |      1 |   223 |

### 5.3 Dwie ścieżki importu WordPressa — wpisy i strony, przetestowana jedna

**Sprostowanie ramy z wydania 7.** Pisałem tam o „DWÓCH niezależnych implementacjach importu
z WordPressa o łudząco podobnych nazwach”, co sugeruje zbędne dublowanie i martwy kod.
Sprawdzone w nagłówkach obu plików — to nieprawda i rama była nieuczciwa:

- `src/lib/wordpress-import.functions.ts` (949 linii) importuje **WPISY** przez konektor WP.com:
  `listWpComSites`, `previewWpComPosts`, `createWpImportJob`, `runWpImportJob`, `getWpImportJob`,
  `cancelWpImportJob`. Zadania śledzone w bazie, postęp strumieniowany, import mediów, kontrakt
  „jedno zadanie = jeden język”.
- `src/lib/wp-import.functions.ts` (688 linii) to v2 importu **STRON**: `wpListPages`,
  `wpPreviewPage`, `listExistingPages`, `wpImportPages`, `wpImportFromWxr`. Konwersja HTML
  na `BuilderDocument`, parowanie wersji PL/EN (dwa `wpId` → jedna strona), ścieżka WXR.

**To są dwie ścieżki dla dwóch różnych typów treści i żadna nie jest martwa.** Obserwacja
o POKRYCIU stoi jednak bez zmian i to ona jest treścią tego rozdziału:

| Plik                                    |      Linie |   Funkcje | LOC mierz. | Kto tego używa                                            |
| --------------------------------------- | ---------: | --------: | ---------: | --------------------------------------------------------- |
| `src/lib/wordpress-import.functions.ts` | **99,28%** |  **100%** |        280 | `routes/admin.import-wordpress.tsx`                       |
| `src/lib/wp-import.functions.ts`        |     **0%** |    **0%** |        137 | `WordPressImportDialog.tsx`, `WordPressPreviewDialog.tsx` |
| `src/lib/wp-import/wxr.ts`              |     **0%** |    **0%** |        105 | `WxrUploadPanel.tsx` (parser pliku WXR)                   |
| `src/lib/wp-import/elementor.ts`        |  **3,28%** | **2,43%** |        152 | konwersja treści WP → widgety buildera                    |
| `src/lib/wp-import/buildPage.ts`        |     62,50% |      100% |         24 | budowa strony docelowej                                   |
| `src/lib/wp-import/convert.ts`          |     75,00% |    75,00% |         28 | konwersja bloków                                          |
| `src/lib/wp-import/localizedMerge.ts`   |       100% |      100% |         42 | scalanie wersji językowych                                |

Ścieżka **wpisów** jest domknięta, ścieżka **stron** leży: 394 zmierzone linie w trzech plikach
na 0–3,3%, i to ta druga jest wpięta w DIALOGI panelu, czyli w to, co administrator faktycznie
klika — wgranie pliku WXR, parsowanie, konwersja na widgety Elementora.

Ryzyko jest tej samej klasy, co defekt `slugify` z rozdz. 7.2: import uruchamia się raz, na dużej
ilości treści, i nikt nie weryfikuje wyniku ręcznie wpis po wpisie. Błąd w parserze WXR albo
w konwersji do Elementora jest cichy i masowy. `elementor.ts` na 3,28% to nadal najgorszy
pojedynczy plik tej klasy w repo.

**Wniosek metodologiczny zostaje w mocy i jest niezależny od poprawki ramy:** zakres zadania
testowego nie może być listą nazw plików — musi być listą ŚCIEŻEK UŻYTKOWNIKA. „Import
z WordPressa” obejmuje i wpisy, i strony, a nazwa pliku o tym nie mówi. Mój prompt wskazał
jedną ścieżkę z nazwy i nie sprawdził, czy istnieje druga; to była wada zakresu, nie wykonania.

---

### 5.4 Zera modułu wydarzeń: 144 → 72, a dług w nich — 1 198 → 142 linie

W wydaniu 6 ten rozdział argumentował, że 144 zera modułu wydarzeń to nie 144 problemy, bo są
trzech różnych rodzajów i tylko jeden jest długiem. Rok później nie trzeba już argumentować:
**dług został spłacony, a kategorie, które długiem nie były, w większości zostały.**

| Gdzie                                       | Plików 0% wyd. 7 |  teraz | Linii bez pokrycia teraz |
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
**1 próg globalny + 373 progów per-ścieżka** w `vitest.config.ts`, egzekwowanych w CI krokiem
`Test + coverage gate` (`.github/workflows/ci.yml`).

| Moduł                                 | Progów per-ścieżka | Mediana progu linii | Najwyższy próg linii |
| ------------------------------------- | -----------------: | ------------------: | -------------------: |
| M11                                   |                 73 |                  98 |                  100 |
| M20                                   |                 44 |                  99 |                  100 |
| M15                                   |                 40 |                 100 |                  100 |
| M19                                   |                 36 |                 100 |                  100 |
| M1                                    |                 27 |                 100 |                  100 |
| M3                                    |                 25 |                  98 |                  100 |
| M13                                   |                 24 |                 100 |                  100 |
| M2                                    |                 21 |                 100 |                  100 |
| M8                                    |                 20 |                  98 |                  100 |
| M16                                   |                 11 |                  99 |                  100 |
| M9                                    |                  9 |                  96 |                  100 |
| M17                                   |                  8 |                 100 |                  100 |
| M6                                    |                  8 |                 100 |                  100 |
| powłoka panelu admin + atomy/molekuły |                  7 |                  96 |                  100 |
| M14                                   |                  7 |                  95 |                   96 |
| M22                                   |                  6 |                  88 |                   96 |
| M10                                   |                  2 |                  98 |                   98 |
| M4                                    |                  2 |                  99 |                   99 |
| M7                                    |                  1 |                 100 |                  100 |
| M18                                   |                  1 |                  98 |                   98 |
| M5                                    |                  1 |                  99 |                   99 |

Z tego **94 progów obejmuje CAŁE POWIERZCHNIE** (wzorzec `/**`), a nie pojedyncze pliki —
to one decydują, czy nowy plik dołożony do katalogu automatycznie podlega bramce:

| Powierzchnia                                      | Instr. | Gał. | Funkcje | Linie | Moduł                                 |
| ------------------------------------------------- | -----: | ---: | ------: | ----: | ------------------------------------- |
| `src/components/builder/organisms/widget-view/**` |     95 |   87 |      94 |    97 | M3                                    |
| `src/components/admin/builder/**`                 |     94 |   91 |      93 |    95 | M3                                    |
| `src/lib/blocks/**`                               |     96 |   91 |      97 |    97 | M3                                    |
| `src/components/blocks/**`                        |     95 |   91 |      92 |    96 | M3                                    |
| `src/lib/wp-import/**`                            |     96 |   92 |      98 |    97 | M3                                    |
| `src/components/admin/blocks/edit/**`             |     94 |   82 |      94 |    95 | M3                                    |
| `src/components/admin/blocks/**`                  |     87 |   75 |      85 |    88 | M3                                    |
| `src/components/patterns/**`                      |     97 |   90 |      98 |    97 | M3                                    |
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
| `src/lib/billing/**`                              |     92 |   88 |      95 |    93 | M13                                   |
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
| `src/lib/ads/**`                                  |     78 |   73 |      80 |    81 | M14                                   |
| `src/components/ads/**`                           |     93 |   87 |      92 |    96 | M14                                   |
| `src/lib/gifting/**`                              |     93 |   91 |      96 |    95 | M14                                   |
| `src/components/gifting/**`                       |     92 |   90 |      90 |    96 | M14                                   |
| `src/components/donations/**`                     |     80 |   68 |      67 |    81 | M14                                   |
| `src/components/admin/ads/**`                     |     89 |   84 |      79 |    88 | powłoka panelu admin + atomy/molekuły |
| `src/components/admin/coupons/**`                 |     87 |   83 |      86 |    89 | M14                                   |
| `src/components/admin/gifting/**`                 |     96 |   94 |      96 |    96 | powłoka panelu admin + atomy/molekuły |
| `src/components/admin/donations/**`               |     96 |   87 |      96 |    96 | powłoka panelu admin + atomy/molekuły |

**Czego bramka NIE pilnuje** — moduły bez ani jednego progu per-ścieżka:

- **MODUŁ 12 — Realtime / powiadomienia / web-push**: linie 49,54%, funkcje 47,46%, plików 0%: 12/28
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
| Jednostkowe / komponentowe (vitest)             | 2 010 plików, 41 104 testów, 81 995 asercji          | logikę w TS/TSX, render komponentów, kontrakty modułów                                                                                                                                                          | zachowania bazy (RLS/RPC/triggery), realnych ścieżek przeglądarki, SSR end-to-end                            |
| Baza (pgTAP)                                    | 100 plików, 1 807 asercji                            | izolację tenanta, polityki RLS, kontrakty RPC, triggery                                                                                                                                                         | kodu frontu — v8 tego pokrycia NIE liczy                                                                     |
| E2E (Playwright)                                | 9 plików, 96 testów (66 deklaracji + parametryzacje) | ścieżki użytkownika, SSR, SEO, checkout                                                                                                                                                                         | pokrycia jednostkowego (osobny proces, nie wchodzi do %)                                                     |
| Bramki statyczne (`check:*`)                    | 38 skryptów                                          | kontrakty struktury (SQL, i18n, warstwy, bundle)                                                                                                                                                                | wykonania kodu                                                                                               |
| **Uprząż replayu migracji** (`check:*-harness`) | 5 uprzęże, 1 547 asercji runtime                     | że migracje DAJĄ SIĘ WYKONAĆ na czystym Postgresie i że schemat po nich zachowuje się tak, jak deklaruje: kolizje sygnatur, funkcje bez kolumn, triggery, które nie odpalają, `EXCLUDE`, które nic nie wyklucza | kodu frontu i produkcyjnych danych — powierzchnia poza modułem jest ATRAPĄ                                   |
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
| komponentowy (render + interakcja)         |    697 | 15 781 |  32 573 |     2,06 | że użytkownik to zobaczy: treść, stan wyłączony, komunikat błędu, reakcja na kliknięcie       | zachowania na prawdziwej przeglądarce i prawdziwych danych z bazy        |
| jednostkowy (czysta reguła)                |    795 | 11 922 |  22 923 |     1,92 | reguły w izolacji: wejście → wyjście, przypadki graniczne, gałęzie warunków                   | że reguła jest w ogóle wywołana przez aplikację (poprawnego okablowania) |
| warstwy danych (atrapa PostgREST)          |    105 |  4 284 |   8 104 |     1,89 | kształtu zapytania: filtry, kolejność ogniw, limit, zachowanie przy błędzie PostgREST         | że polityka RLS na serwerze przepuści to zapytanie                       |
| dostępności (axe)                          |    135 |  3 909 |   7 856 |     2,01 | kontraktu dostępności: role, etykiety, kolejność fokusu, brak naruszeń axe                    | sensu treści dla czytnika ekranu (to ocenia człowiek)                    |
| hooka (renderHook)                         |    102 |  2 410 |   5 023 |     2,08 | cyklu życia i unieważniania cache: kolejność efektów, sprzątanie, ponowne pobranie po mutacji | wyglądu; hook może być poprawny, a widok nadal pokazywać stare dane      |
| funkcji serwerowej                         |    113 |  2 238 |   4 506 |     2,01 | bramek wykonania: tenant, uprawnienia, rate limit, audyt, ścieżka błędu                       | że klient wywoła funkcję w odpowiednim momencie                          |
| bramki (meta-inwariant CI)                 |     27 |    268 |     444 |     1,66 | meta-inwariantu repo: że bramka istnieje, jest wpięta i coś sprawdza                          | zachowania kodu produkcyjnego                                            |
| parytetu (dwa artefakty muszą się zgadzać) |     28 |    238 |     453 |     1,90 | ZGODNOŚCI DWÓCH ARTEFAKTÓW (panel ⇄ renderer, snapshot ⇄ migracje, PL ⇄ EN)                   | poprawności żadnej ze stron osobno — tylko tego, że się nie rozjechały   |
| inwariantu (nie wolno złamać reguły)       |      4 |     39 |      83 |     2,13 | że reguła nie została złamana NIGDZIE w repo — skaluje się z kodem, nie z przypadkiem         | poprawności pojedynczej ścieżki użytkownika                              |
| dymny (czy w ogóle stoi)                   |      3 |     13 |      26 |     2,00 | że powierzchnia wstaje i nie rzuca przy montażu                                               | niczego o zachowaniu — to detektor katastrofy, nie dowód                 |
| integracyjny (wiele warstw)                |      1 |      2 |       4 |     2,00 | współpracy kilku warstw naraz na jednym scenariuszu                                           | izolowanej przyczyny awarii — po padnięciu trzeba szukać dalej           |

**Profil atrapowania — miara, której procent pokrycia nie pokazuje, a która decyduje o tym,
co te testy dowodzą.** Policzone skanem wszystkich 2 010 plików testowych:

|                                                                                      |    plików | udział suity |
| ------------------------------------------------------------------------------------ | --------: | -----------: |
| **bez ANI JEDNEGO `vi.mock`** — jadą po prawdziwym grafie modułów                    | **1 009** |    **50,2%** |
| atrapują granicę bazy (klient Supabase) — atrapa uzasadniona                         |       478 |        23,8% |
| atrapują wewnętrzny moduł biznesowy (`@/lib`, `@/components`, `@/hooks`, `@/routes`) |       771 |        38,4% |
| **z tego BEZ atrapowania granicy bazy**                                              |   **430** |    **21,4%** |

Wywołań `vi.mock` jest razem 4 348. Pierwsza liczba jest mocna: **połowa suity nie atrapuje
niczego**, czyli testuje realny graf zależności, a nie własną wyobrażoną wersję systemu.
Ostatnia jest słaba i to jest właściwe miejsce, żeby ją nazwać: **co piąty plik testowy podmienia
moduł biznesowy, nie dotykając przy tym granicy wejścia/wyjścia** — czyli sprawdza, czy komponent
poprawnie reaguje na odpowiedź, którą sam sobie napisał. Taki test łapie regresję w komponencie
i nie łapie żadnej regresji w kontrakcie między komponentem a resztą aplikacji.

**W tym oknie ta proporcja poprawiła się wyraźnie** — porównanie na identycznej metryce
dla obu okien jest w rozdz. 8.3: klasa wątpliwa spadła z 52,0% nowych plików w wydaniu 7
na 19,0% w wydaniu 8, a atrapowanie samej granicy bazy wzrosło z 28,0% na 48,3%.

**Rozkład wysiłku po warstwach** (dominujący rodzaj na plik, 2 010 plików): komponenty i a11y
to **832 pliki (41,4%)**, logika (unit, data-layer, server-fn, hook) — **1 115 (55,5%)**,
testy strukturalne (parity, gate, invariant) — 59 (2,9%). Osobno warto wyciągnąć jedną liczbę:
**113 plików (5,6%) dotyczy funkcji serwerowych**, przy 95 plikach produkcyjnych z `createServerFn`.
To jest warstwa, w której mieszkają pieniądze i granica najemcy. Do tego **jeden** plik oznaczony
jako integracyjny i **9** plików e2e — najcieńsza warstwa całej piramidy, przy 22 modułach
z przepływami przechodzącymi przez kilka modułów naraz (wydarzenie → rejestracja → płatność
→ członkostwo → newsletter).
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

Do tego dochodzą rodzaje, których v8 nie widzi wcale: **pgTAP** (100 plików) dowodzi
polityk i triggerów, **Playwright** (9 plików) ścieżek użytkownika i realnego SSR,
a **bramki skryptowe `check:*`** (38) kontraktów strukturalnych, w których nie ma
kodu do wykonania — na przykład tego, że każda bramka jest wpięta w workflow.

### 7.2 Rejestr defektów: 255 wpisów — i pierwszy, który rejestr oddał z powrotem

Rozdział 7.1 argumentuje, że rodzaj testu waży więcej niż liczba. Ten rozdział pokazuje
mechanizm, który w tym wydaniu po raz pierwszy zadziałał w OBIE strony.

**Liczby, zmierzone niezależnie od raportów zespołu:** w repo jest dziś **255 wywołań `it.fails(`
w 147 plikach**; przebieg wykonał 266 przypadków „expected fail”.
W wydaniu 7 było 255 wpisów w 147 plikach, w wydaniu 6 — 171 w 94, w wydaniu 5 — 151 w 84,
w wydaniu 4 — 24 w 20. **Liczba wywołań nie zmieniła się wobec wydania 7**, mimo trzech
kampanii i 147 nowych plików testowych — co samo w sobie jest informacją: nowe testy tego okna
pisano na powierzchniach, gdzie defekty naprawiano od razu, zamiast je rejestrować.

**Pominięcia: nadal zero, i warto to podać precyzyjnie.** W całym repozytorium nie ma ani jednego
bezwarunkowego `it.skip`, `test.skip` ani `it.todo`. Są dokładnie **dwa** `describe.skip`,
oba w tej samej postaci — `const d = shouldRun ? describe : describe.skip` — w suitach
`db-schema-invariant` i `lang-parity`, czyli tych, które wymagają żywej bazy. To jest warunkowa
bramka środowiskowa, nie wyciszenie czerwieni; na CI z sekretami obie się wykonują.

**Najważniejsza rzecz tego wydania: wpis rejestru zapalił się na CZERWONO, bo defekt naprawiono.**
`src/lib/server/__tests__/serviceRoleTenantScope.gate.test.ts` zgłasza `Error: Expect test to fail`
na przypadku „page_full_path wiąże najemcę albo pages.parent_id ma ograniczenie tego samego
najemcy”. To nie jest awaria — to jest **rejestr informujący, że można go wycofać**.

Co ten wpis rejestrował (cytat z jego własnego opisu w kodzie): `fetchPagePaths`
(`publishedContent.server.ts:59`) filtruje `pages` po najemcy poprawnie, ale pełną ścieżkę
składał RPC `public.page_full_path(_page_id uuid)` — rekurencyjne CTE idące w GÓRĘ
po `pages.parent_id`, **bez predykatu najemcy**, `LANGUAGE sql STABLE` czyli SECURITY INVOKER,
a wołane spod service-role nie ma nad sobą RLS. Schematu to nie domykało: `pages.parent_id` miał
wyłącznie `REFERENCES public.pages(id) ON DELETE RESTRICT`, bez `CHECK`-a ani triggera „ten sam
najemca”, a `uniq_pages_tenant_parent_slug` pilnuje unikalności slugu, nie zgodności najemcy.
Żaden plik pgTAP nie wspominał `page_full_path`. **Konsekwencja:** strona z `parent_id`
wskazującym stronę INNEGO najemcy wnosiła JEGO slug do ścieżki kanonicznej publikowanej
w sitemapie i RSS-ie. Wpis wprost tłumaczył, czemu jest `it.fails`: „naprawa to migracja schematu
— decyzja dla człowieka, nie dla testu, dlatego `it.fails` z opisem zamiast zmiany zachowania
produkcyjnego”.

**Decyzja zapadła w tym oknie i jest to najlepszy zapis decyzyjny całego wydania.** Migracja
`20260831160000_page_full_path_tenant_scope.sql` (215 linii, z czego 125 to uzasadnienie):

1. `page_full_path` **i** `page_full_paths` niosą teraz `tenant_id` w CTE i łączą przez
   `p.tenant_id = c.tenant_id` — rodzic musi być w tym samym najemcy co DZIECKO, a kotwica bierze
   najemcę z wiersza startowego. Świadomie NIE `current_tenant_id()`, z argumentem.
2. Gwarancję schematową daje **złożony klucz obcy `(parent_id, tenant_id) → (id, tenant_id)`**,
   podparty dodaniem `UNIQUE (id, tenant_id)` na `pages`.
3. Migracja **uzasadnia wybór mechanizmu** wobec dwóch alternatyw, które sugerowało zadanie:
   - **„CHECK Z FUNKCJĄ JEST NIEPOPRAWNY, nie tylko słabszy”** — Postgres wymaga od wyrażenia
     `CHECK` immutable-ości i sprawdza je WYŁĄCZNIE przy zapisie tego wiersza; gdy zmieni się
     `tenant_id` RODZICA, nikt go nie przelicza i „dziura wraca cicho”. `pg_dump`/`pg_restore`
     dokładają drugi problem.
   - **„TRIGGER jest poprawny, ale droższy i mniej szczelny”** — trzeba go napisać na OBU
     kierunkach, sam nie chroni przed wyścigiem i **daje się wyłączyć**
     (`ALTER TABLE … DISABLE TRIGGER`), „co ta baza REALNIE robi w testach pgTAP”.
   - Klucz złożony pokrywa zarówno zapis dziecka, jak i zmianę `tenant_id` rodzica.

**Puenta, która wiąże to z rozdziałem 8.4:** to jest DOKŁADNIE ta migracja, którą potok
wdrożeniowy wyemitował ponownie pod nazwą UUID — a kopia ma **0 linii komentarza wobec 125
w oryginale**. Najlepszy zapis decyzyjny tego okna dostał najnowszy znacznik czasu na wersji
bez argumentu. Do zrobienia zostaje jedno i jest tanie: **zamienić `it.fails` na `it`**, bo
defekt jest zamknięty, a wpis, który przestał opisywać rzeczywistość, psuje rejestr tak samo
jak wpis, którego nikt nie naprawił.

**Mechanizm nadal ma swoją wadę i nie chcę jej przykryć dobrą wiadomością.** `it.fails` jest
w CI zielony, dopóki defekt istnieje, więc nic nie naciska na naprawę; zapisanie jest tanie,
naprawa droga; im więcej wpisów, tym mniejsza waga każdego. Rejestr wciąż rośnie **bez terminu
i bez właściciela**. To wydanie pokazuje jednak, że nie jest jednokierunkowy — potrzebuje tylko
przebiegu, żeby to ujawnić, a przebieg musi być w sprawnym środowisku (rozdz. 8.5 pkt 2).

---

### 7.3 Izolacja najemcy: co bramki repozytorium widzą, a czego strukturalnie widzieć nie mogą

Stan końcowy polityk odtworzyłem **parserem repozytorium** (`src/lib/ci/rlsPolicies`,
`extractLatestPolicies`), a nie własnym — powód w rozdz. 8.5 pkt 3.

| miara                         |         wartość |
| ----------------------------- | --------------: |
| migracji w historii           |             934 |
| polityk RLS w stanie końcowym |         **620** |
| z wiązaniem najemcy           | **562 (90,6%)** |
| polityk właścicielskich       |             165 |
| tabel z politykami            |             258 |
| tabel z kolumną `tenant_id`   |             265 |

**Obie bramki najemcy są zielone.** `check:sql-owner-tenant-scope` raportuje 2 luki POZORNE
(obie na `profiles`, z pisemnym argumentem tautologii: `current_tenant_id()` JEST tenantem tego
wiersza, więc dla `id = auth.uid()` warunek jest tautologią) oraz **`KNOWN_OPEN_GAPS` PUSTĄ** —
dług zastany z chwili wprowadzenia bramki został spłacony do zera migracją 20260814221343.
`check:sql-policy-tenant-regression` też jest zielona i dodatkowo raportuje 11 cofnięć
ZALECZONYCH później — jako raport, nie blokadę.

**Ustalenie własne dotyczy ZASIĘGU tej bramki, nie luki w niej.** Inwariant jest **relacyjny**
i jest tak zaprojektowany świadomie: „jeśli NA DANEJ TABELI choć jedna klauzula właścicielska
wiąże wiersz z tenantem, to KAŻDA klauzula właścicielska na tej tabeli musi go wiązać”.
Bramka jest samokalibrująca — nie ma ręcznej listy tabel, intencję deklaruje sam schemat.
Konsekwencja jest jednak taka, że **tabela, na której ŻADNA polityka nie wiąże najemcy, nie ma
świadka — więc bramka strukturalnie milczy**, niezależnie od tego, czy tabela ma `tenant_id`.

Takich tabel jest **7**, każda ma dokładnie jedną politykę:

| tabela                | polityka                       | FOR    | ekspozycja     |
| --------------------- | ------------------------------ | ------ | -------------- |
| `personality_results` | owner manages own personality  | ALL    | odczyt + zapis |
| `push_subscriptions`  | push subs owner all            | ALL    | odczyt + zapis |
| `poll_votes`          | poll votes own read            | SELECT | odczyt         |
| `speaker_profiles`    | speaker_profiles owner read    | SELECT | odczyt         |
| `meeting_bookings`    | meeting_bookings parties read  | SELECT | odczyt         |
| `user_consents`       | user_consents_select_own       | SELECT | odczyt         |
| `user_consent_events` | user_consent_events_select_own | SELECT | odczyt         |

**Czego to NIE dowodzi, i mówię to wprost:** to nie jest dowód, że obszar roboczy firmy A czyta
dane firmy B. Przedmiotem jest **własny wiersz tego samego użytkownika**, widziany w innym
obszarze roboczym. Ryzyko materializuje się przy dryfie danych — wiersz powstał u najemcy A,
profil przepięto do B — czyli w dokładnie tym scenariuszu, który nagłówek bramki sam opisuje
jako swoją przyczynę źródłową (`author_profiles`, audyt 2026-08-03). Przy politykach SELECT-only
zapis przez RLS jest w ogóle niemożliwy (domyślna odmowa), więc zapisy idą przez funkcje
SECURITY DEFINER — to inna powierzchnia, nie ta luka.

**Do rozważenia, nie do zrobienia w ciemno:** dwie tabele z `FOR ALL` (`personality_results`,
`push_subscriptions`) są jedynymi, gdzie ekspozycja obejmuje zapis. Jeśli któraś z tych
płaszczyzn ma sens per-najemca, dopisanie tam wiązania najemcy **włączy** bramkę dla całej
tabeli na przyszłość — bo od tego momentu tabela będzie miała świadka.

---

## 8. Wnioski: gdzie ryzyko jest największe

Ryzyko liczę jako BEZWZGLĘDNĄ liczbę niepokrytych linii, nie procent — 20% na module o 50 tys.
linii to większa dziura niż 20% na module o 5 tys.

| #   | Moduł                                          | Linii niepokrytych | Linie % | Funkcje % | Testów |
| --- | ---------------------------------------------- | -----------------: | ------: | --------: | -----: |
| 7   | Typy treści specjalne                          |          **2 313** |  43,93% |    36,73% |    934 |
| 20  | Platforma / backend / infrastruktura / SSR     |          **2 246** |  75,83% |    68,65% |  5 161 |
| 17  | Analityka i BI                                 |          **2 080** |  32,88% |    28,41% |    199 |
| 22  | Wydarzenia: event builder, rejestracja, onsite |          **1 595** |  84,78% |    84,62% |  5 268 |
| 3   | Silniki treści: bloki + page builder           |          **1 220** |  94,30% |    92,61% |  5 704 |
| 9   | Czat / komunikator                             |          **1 209** |  62,83% |    58,02% |    607 |
| 16  | Społeczność: kluby, komentarze, moderacja      |            **878** |  89,12% |    89,02% |  4 715 |
| 12  | Realtime / powiadomienia / web-push            |            **601** |  49,54% |    47,46% |     99 |
| 1   | Wpisy: doświadczenie czytelnika                |            **391** |  84,67% |    82,12% |  1 015 |
| 21  | Rekrutacja / kariera                           |            **381** |  55,12% |    47,13% |    171 |

### 8.1 Rekomendacje — kolejność, nie lista życzeń

**R1. Naprawić potok wdrożeniowy, który duplikuje migracje i zdejmuje z nich uzasadnienie.**
Najtańsza naprawa o największym zasięgu w tym wydaniu: **jedna przyczyna zapala pięć rzeczy**
(dwa testy w `migrationReplay`, jeden w `authzSnapshotParity`, dwie bramki `check:*`). Dwie
migracje klasy „tenant scope" wjechały dwa razy pod różnymi nazwami, a kopie mają **0 linii
komentarza wobec 125 i 62 w oryginałach** i noszą NAJNOWSZE znaczniki czasu. Naprawa jest opisana
w komunikacie samej bramki: zostawić plik z PR-a, usunąć wygenerowany duplikat przed wdrożeniem,
a jeśli obie wersje są już zastosowane — dopisać wpis do `KNOWN_CONTENT_TWINS` z dowodem
zastosowania. Potem `bun run generate:authz-snapshot` i commit wyniku. **Efekt: pięć zapaleń
gaśnie, suita wraca do zieleni poza jednym testem monetyzacji.** Koszt: jeden commit.
Rzecz ważniejsza od samych zapaleń: przy commitach nazwanych „Changes" i „Work in progress"
kolejność nazw plików migracji jest **jedynym** narzędziem datowania regresji.

**R2. Wycofać wpis `it.fails` o `page_full_path` — defekt jest zamknięty.**
`serviceRoleTenantScope.gate.test.ts` zgłasza `Expect test to fail`, bo migracja
`20260831160000_page_full_path_tenant_scope.sql` domknęła wyciek slugu innego najemcy do adresu
kanonicznego w sitemapie i RSS-ie. Zamienić `it.fails` na `it`. Wpis, który przestał opisywać
rzeczywistość, psuje rejestr dokładnie tak samo jak wpis, którego nikt nie naprawił — a ten
rejestr ma dziś **255 pozycji** i jego wiarygodność jest jego jedyną wartością.

**R3. Podnieść próg globalny — stoi 19,1 pp pod pomiarem.**
`64/58/62/65` przy zmierzonych `82,87 / 77,51 / 81,49 / 84,12`. Repozytorium musiałoby stracić
**22,7% całego pokrycia**, żeby bramka globalna cokolwiek zauważyła. Dotychczasowe uzasadnienie
(„progi per-ścieżka i tak padają") zniknęło: **przebieg nie zgłosił ani jednego naruszenia progu**,
a kod wyjścia 1 pochodzi wyłącznie z czerwonych testów. Wpisać wartości ~5 pp pod pomiarem
i **przy okazji odświeżyć komentarz w `vitest.config.ts`**, który notuje 68,27 / 62,80 / 66,25 /
69,28 — czyli jest nieaktualny o **14,8 pp na liniach** i jest jedynym miejscem, z którego
czytający config dowiaduje się, ile pokrycia repo ma.

**R4. Powłoka panelu admina: 2 361 niepokrytych linii — największa pojedyncza dziura w repo.**
221 plików, **57,34% linii, 52,16% funkcji**, 30 plików na zerze, siedem progów per-ścieżka na całą
powierzchnię. To jedyna duża powierzchnia, która **nigdy nie dostała ani zadania, ani zapadki**,
a rośnie przy każdej ekstrakcji z tras — czyli każda kampania w innym module ją powiększa.
W tym oknie drgnęła o +9,39 pp jako efekt uboczny modułów 13, 14 i 3, nie jako praca własna.
Wzorzec jest gotowy i sprawdzony trzy razy: ekstrakcja do `atoms/molecules/organisms`, potem
asercje, na końcu próg.

**R5. Analityka i BI: jedyne „beznadziejnie", 32,88% linii i 47 z 86 plików na zerze.**
Ostatnia powierzchnia w tej kategorii po odejściu modułu 14. Od wydania 1 urosła o **+4,9 pp**
— czyli praktycznie o nic w trzynaście dni, w których repozytorium urosło o ponad 50 pp.
2 080 niepokrytych linii przy ośmiu progach, które trzymają stan, ale go nie poprawiają.
To jest naturalny kandydat na następne zamówienie, dokładnie w modelu, który zadziałał
jedenaście razy z rzędu.

**R6. `publicRegistrationApi.ts`: 13 niepokrytych linii ścieżki pieniędzy, wskazane imiennie
w wydaniu 7 i nietknięte.** Plik stoi na **35 z 48 linii (72,91%) — dokładnie tyle samo co przed
oknem**. Dziesięć linii dopisanych commitem „Domknął kasę na ścieżce zapisu etapu 4" nadal nie jest
wykonywanych przez żaden test. Ścieżka ma dowód gdzie indziej (e2e, asercje uprzęży), więc to nie
jest dziura w kasie — to jest dziura w rozkładzie pracy, i jedyna pozycja tej listy, która przeszła
przez dwa wydania bez ruchu. Koszt: jeden plik testowy.

**R7. Dwie powierzchnie bez ANI JEDNEGO progu: realtime/web-push (49,54%) i kariera (55,12%).**
Zero progów per-ścieżka znaczy, że nawet dzisiejszy stan nie jest chroniony przed cofnięciem.
Tanie domknięcie: nie kampania, tylko wpisanie progów na aktualnym poziomie, żeby dorobek
przestał być pożyczony.

**R8. Ustalić kolejność w generatorze `routeTree.gen.ts` albo wyjąć plik z gita.**
Sam przebieg suity brudzi drzewo robocze: 4 078 wstawień i 4 078 usunięć, **8 115 linii przed
i po**, hasz posortowanej treści identyczny — czyli zero zmian treści, wyłącznie przestawienie.
Skutek praktyczny: każda bramka i każdy hook typu „brak niezacommitowanych zmian" fałszywie zapala
się po każdym `vitest run`, a autor za każdym razem musi odróżnić szum od zmiany. Plik sam mówi
„You should NOT make any changes in this file as it will be overwritten".

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
| **wzorowo**       | 96,4 | 13. Monetyzacja: checkout / subskrypcje / billing         | 96,5% |   96,3% |     24 |               7 |     3/190 |
| **wzorowo**       | 96,1 | 6. Wyszukiwarka                                           | 97,4% |   95,2% |      8 |               5 |      0/25 |
| **wzorowo**       | 96,1 | 8. SEO, feedy, dane strukturalne                          | 96,7% |   95,7% |     20 |               6 |      5/78 |
| **wzorowo**       | 95,9 | 15. Profil i konto                                        | 97,6% |   94,8% |     40 |               7 |      2/94 |
| **wzorowo**       | 94,7 | 5. Strona główna, archiwa, chrome                         | 96,5% |   93,5% |      1 |               5 |      1/62 |
| **wzorowo**       | 93,3 | 3. Silniki treści: bloki + page builder                   | 94,3% |   92,6% |     25 |               8 |     2/460 |
| **wzorowo**       | 91,5 | 19. Ustawienia / integracje / users / multi-tenant / RODO | 93,4% |   90,2% |     36 |               7 |    14/135 |
| **wzorowo**       | 91,1 | 14. Monetyzacja: kupony / darowizny / prezenty / reklamy  | 92,6% |   90,1% |      7 |               6 |      1/44 |
| **wzorowo**       | 90,3 | 4. Strony, wygląd, motyw, media, import                   | 92,3% |   88,9% |      2 |               6 |     4/133 |
| **dobrze**        | 89,1 | 16. Społeczność: kluby, komentarze, moderacja             | 89,1% |   89,0% |     11 |               8 |    16/306 |
| **dobrze**        | 84,7 | 22. Wydarzenia: event builder, rejestracja, onsite        | 84,8% |   84,6% |      6 |               8 |    72/366 |
| **dobrze**        | 83,1 | 1. Wpisy: doświadczenie czytelnika                        | 84,7% |   82,1% |     27 |               4 |    13/104 |
| **dobrze**        | 82,6 | 10. Sieć / networking                                     | 83,7% |   81,8% |      2 |               4 |      3/32 |
| **dobrze**        | 77,1 | design system (components/ui)                             | 81,1% |   74,4% |      0 |               1 |      4/44 |
| **przeciętnie**   | 74,2 | słowniki i18n                                             | 93,2% |   61,6% |      0 |               2 |     1/135 |
| **przeciętnie**   | 71,5 | 20. Platforma / backend / infrastruktura / SSR            | 75,8% |   68,7% |     44 |               7 |    45/202 |
| **przeciętnie**   | 59,9 | 9. Czat / komunikator                                     | 62,8% |   58,0% |      9 |               3 |     14/81 |
| **źle**           | 54,2 | powłoka panelu admin + atomy/molekuły                     | 57,3% |   52,2% |      0 |               5 |    30/221 |
| **źle**           | 50,3 | 21. Rekrutacja / kariera                                  | 55,1% |   47,1% |      0 |               2 |     12/29 |
| **źle**           | 48,3 | 12. Realtime / powiadomienia / web-push                   | 49,5% |   47,5% |      0 |               3 |     12/28 |
| **źle**           | 39,6 | 7. Typy treści specjalne                                  | 43,9% |   36,7% |      1 |               6 |     37/95 |
| **beznadziejnie** | 30,2 | 17. Analityka i BI                                        | 32,9% |   28,4% |      8 |               3 |     47/86 |

Rozkład: **12** wzorowo · **5** dobrze · **3** przeciętnie · **4** źle · **1** beznadziejnie.

**Ocena całości: DOBRZE — i pierwszy raz bez ratowania się jednym modułem.**
Baza dla całego repo liczona tą samą rubryką: **82,5** — po 53,4 w wydaniu 3, 65,7
w wydaniu 4, 73,4 w wydaniu 5, 72,9 w wydaniu 6 i 76,1 w wydaniu 7. Granica „dobrze” leży na 75:
wydanie 7 przeszło ją o 1,1 punktu, to wydanie o 7,5. Różnica jakościowa jest jednak gdzie indziej.
W wydaniu 7 musiałem od razu podać drugą liczbę, bo **bez modułu wydarzeń** ta sama rubryka
dawała ~74,7, czyli poniżej progu — cały wynik stał na jednej powierzchni. **W tym wydaniu
takiej dyskwalifikacji nie ma:** ruch pochodzi z trzech niezależnych modułów, więc usunięcie
dowolnego z nich nie zdejmuje repozytorium poniżej progu. To pierwszy raz w serii.
Rozbijam to na pięć osobnych ocen, bo jedna liczba tego nie opisuje:

1. **Poziom pokrycia — PIERWSZY warunek „dobrze” spełniony z dużym zapasem, drugi nie.** 84,12% linii
   i 81,49% funkcji na 3 260 plikach produkcyjnych. W wydaniu 3 postawiłem próg: za „dobrze”
   uznam **75%+ linii przy żadnym module poniżej 60%**. Linie: 84,12% — spełnione z zapasem 9 pp.
   Powierzchni poniżej 60% jest 5: powłoka panelu admin + atomy/molekuły (57,3%), M21 (55,1%), M12 (49,5%), M7 (43,9%), M17 (32,9%).
   Warunku drugiego nie spełnia więc nadal ANI JEDNO wydanie tej serii — ale **lista skróciła się
   z sześciu powierzchni na pięć, i to nie przez zaokrąglenie**: moduł 14 zszedł z niej z hukiem,
   z 27,06% na 92,63%. Skład reszty jest niezmienny od wielu wydań: analityka i BI (32,88%),
   typy treści specjalne (43,93%), realtime i web-push (49,54%), kariera (55,12%) oraz powłoka
   panelu (57,34%, jedyna z tej piątki, która w tym oknie drgnęła — o 9,39 pp).
   Wniosek z wydania 7 zostaje w mocy, tylko z inną liczbą: **powierzchnia rusza się wtedy
   i tylko wtedy, kiedy ktoś ją zamówi** — czternaście powierzchni ma dziś dokładnie +0,00 pp.
2. **Rozkład — najlepszy w serii, i pierwszy raz „beznadziejnie” jest tylko jedno.** 5 z 25 powierzchni
   ma ocenę „źle” albo „beznadziejnie” — po 12 z 24 w wydaniu 3, 10 w wydaniu 4, 6 w wydaniu 5,
   6 w wydaniu 6 i 6 w wydaniu 7.
   „Beznadziejnie” spadło z 2 na 1: **MODUŁ 14 opuścił tę kategorię po pięciu wydaniach
   z rzędu** i stoi dziś na 91,1 bazy, czyli „wzorowo”. Została w niej wyłącznie analityka i BI.
   „Wzorowo” urosło z 9 na 12 — weszły moduły 13, 3 i 14, dokładnie te trzy, które ruszyły.
   Model „jedno zlecenie = jedna powierzchnia, jawny cel, próg na końcu” zadziałał dziewiąty,
   dziesiąty i jedenasty raz z rzędu i nie zawiódł ani razu w całej serii. **Wydanie 8 dokłada
   do tego rzecz nową: model wytrzymał trzy zamówienia RÓWNOLEGLE**, w jednym oknie, bez
   pogorszenia jakości nowych testów — przeciwnie (rozdz. 7.1).
3. **Uczciwość pomiaru — dobrze, miejscami wzorowo.** `all: true` na całym `src/`, pliki bez testów
   w mianowniku, zero whitelistu. To repo ma za sobą epizod raportowania **98%** z 38 plików
   z pętlami renderującymi bez asercji — i sam ten epizod usunęło. Gęstość asercji
   1,99 na test, stabilna w każdym rodzaju testu, potwierdza, że dzisiejsze liczby nie są farmione.
4. **Infrastruktura dowodu — wzorowo.** 373 progów per-ścieżka, 38 bramek `check:*`
   (w tym META-bramka „bramka, która istnieje, musi się uruchamiać”), 100 plików pgTAP
   z 1 807 asercjami na RLS i RPC, klasyfikacja testów na jedenaście rodzajów — a w tym wydaniu
   szósta warstwa dowodu urosła: **5 uprzęży** replayu migracji z 1 547
   asercjami runtime, z czego 1 050 w uprzęży wydarzeń. Piąta powstała w wydaniu 7
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
5. **Zabezpieczenie dorobku — nadal najsłabsza ocena, ale pierwszy ruch od dwóch wydań.** Próg globalny stoi
   19,1 pp pod pomiarem na liniach — tyle pokrycia można stracić, nie łamiąc progu globalnego,
   czyli **22,7% całego dorobku**.
   Bez ANI JEDNEGO progu per-ścieżka jest 5 z 25 powierzchni: design system (components/ui) (81,1%), słowniki i18n (93,2%), powłoka panelu admin + atomy/molekuły (57,3%), MODUŁ 21 (55,1%), MODUŁ 12 (49,5%).
   Najgroźniejsza z nich to powłoka panelu admina: 221 plików, 57,34% linii,
   **2 361 niepokrytych linii — największa pojedyncza dziura w liniach w całym repozytorium**,
   i jedyna duża powierzchnia, która nigdy nie dostała ani zadania, ani zapadki. Rośnie
   przy każdej ekstrakcji z tras, więc każda kampania w innym module ją powiększa.
   Druga rzecz, na plus: **żaden próg nie jest dziś wpisany nad zmierzone i bramka pokrycia
   nie zgłosiła ani jednego naruszenia.** Kod wyjścia 1 pochodzi wyłącznie z pięciu czerwonych
   testów, a nie z progów — i to jest właściwe zachowanie: progi mają trzymać dorobek,
   a czerwień ma zgłaszać defekt.
   Trzecia, i pierwsza dobra wiadomość w tej ocenie od dwóch wydań: **progi per-ścieżka znów rosną:
   353 → 373**, czyli +20 nowych ścieżek pod zaporą. W wydaniu 7 pisałem,
   że zapadka stanęła CAŁA; to zdanie przestało być prawdziwe w połowie. Globalna nadal stoi,
   ale trzy domknięte moduły dostały nie tylko procent, lecz i próg, który go trzyma.
   Zostaje jedna rzecz do zrobienia jednym commitem: **podnieść próg globalny.** Przy zapasie
   19 pp bramka globalna nie chroni już niczego, co dałoby się realnie utracić.

**Trajektoria zasługuje na osobne zdanie: super.** 32,71% → 84,12% linii w **trzynaście dni**, przy suicie
rosnącej z 817 do 2 010 plików i z ~8,3 tys. do 54 695 testów, to nie jest normalne tempo.
**Dziewięć modułów przeszło z poniżej 30% na ponad 89% linii:** edytor 8,34 → 99,35 (**+91,0 pp**),
CRM 12,04 → 99,03 (+87,0), chrome 16,71 → 96,47 (+79,8), profil 19,12 → 97,64 (+78,5),
newsletter 26,70 → 99,53 (+72,8), kluby 17,56 → 89,12 (+71,6), ustawienia i RODO 22,00 → 93,36
(+71,4), **monetyzacja kuponów 22,55 → 92,63 (+70,1)** i wygląd/media 22,76 → 92,32 (+69,6).
Do tego wyszukiwarka +64,2, **checkout i billing +63,8**, **bloki i builder +54,3**, wpisy +52,9
i SEO +46,4. Dziś **18 z 25 powierzchni stoi na 80% linii lub wyżej**.

Modułu wydarzeń nie ma na tej liście, bo w wydaniu 1 nie istniał jeszcze jako osobna powierzchnia
w taksonomii — jego +25,8 pp to przyrost wydania 7, nie liczba kumulacyjna, a mieszanie tych
dwóch rzeczy byłoby zawyżaniem.

**Jedno zdanie, gdyby trzeba było wybrać jedno.** Wydanie 7 kończyłem zdaniem: „kolejność działa
bezbłędnie, ale poza kolejką nie dzieje się nic — to jest problem tego, czy ktoś wpisze moduł 14
na listę”. **Ktoś wpisał.** Moduł 14 poszedł z 27,06% na 92,63% linii i opuścił kategorię
„beznadziejnie”, w której siedział pięć wydań z rzędu. Wydanie 8 potwierdza więc jedno
i podważa drugie: mechanizm zamawiania działa **i skaluje się do trzech powierzchni naraz**,
ale diagnoza „poza kolejką nic” nadal stoi w mocy — czternaście powierzchni ma dokładnie
+0,00 pp. Zmienia się natomiast OSTRZEŻENIE. Przy zapasie 19 pp nad zapadnią globalną
i przy `reportOnFailure: true` jedyną rzeczą, która realnie złapie regresję, jest **czerwony
test albo próg per-ścieżka** — a to wydanie pokazuje oba w akcji: pięć zapaleń z jednej
przyczyny wdrożeniowej i jeden wpis rejestru, który sam zgłosił, że defekt zniknął.

---

### 8.3 Czy trzy kampanie naraz obniżyły jakość testów — sprawdzenie

Wydanie 7 postawiło zarzut, który trzeba sprawdzić za każdym razem, gdy pokrycie skacze:
**czy przyrost jest dowodem, czy tylko liczbą.** Tamten dokument twierdził dwie rzeczy —
że przyrost omija warstwę egzekwowania i że nowe testy atrapują własną warstwę danych.
Obie sprawdziłem tą samą metodą co wtedy, a wynik jest niejednoznaczny i to jest jego treść.

**Gdzie trafił przyrost.** 7 159 nowo pokrytych linii rozłożyło się tak:

| warstwa                                          | przyrost linii |    udział | plików z przyrostem | Δ LOC mierzonych |
| ------------------------------------------------ | -------------: | --------: | ------------------: | ---------------: |
| komponenty                                       |          3 992 |     55,8% |                 151 |             +674 |
| **funkcje serwerowe (`.server` / `.functions`)** |      **2 032** | **28,4%** |                  48 |             +147 |
| biblioteka i hooki                               |            686 |      9,6% |                  30 |              +91 |
| trasy (poza API)                                 |            337 |      4,7% |                  13 |             −475 |
| API (`routes/api.*`)                             |            112 |      1,6% |                   3 |               +3 |

Wydanie 7 miało w warstwie egzekwowania (API plus funkcje serwerowe) **7,2%**; to wydanie
ma **30,0%**. To poprawa czterokrotna na dokładnie tej osi, którą tamten dokument nazwał swoim
najważniejszym zarzutem. Komponenty nadal biorą większość, ale nie przytłaczającą.
Ujemna delta LOC w trasach nie jest błędem: to efekt ekstrakcji logiki z plików tras
do organizmów, czyli tego samego wzorca, który zamawiały prompty modułów 13, 14 i 3.

**Ale jest jeden fakt, który tę poprawę przycina — i jest ważniejszy niż udział warstwy.**
Wydanie 7 wskazało PALCEM jeden plik: `publicRegistrationApi.ts`, do którego commit domykający
kasę dopisał dziesięć linii ścieżki pieniędzy, nie pokrywając ani jednej. Ten plik stoi dziś
na **35 z 48 linii (72,91%) — dokładnie tyle samo co przed oknem**. Jest to spójne z tym,
że moduł wydarzeń ma w tym oknie +0,00 pp, ale prowadzi do wniosku metodologicznego:
**udział warstwy jest słabszym dowodem niż nazwa pliku.** Zarzut wydania 7 został zamknięty
statystycznie, a nie w miejscu, które wskazano.

**Czy nowe testy dowodzą czegokolwiek.** Metrykę policzyłem IDENTYCZNIE dla obu okien, żeby
porównanie nie stało na cytacie z poprzedniego wydania. Klasa wątpliwa to plik, który podmienia
wewnętrzny moduł biznesowy (`vi.mock` na `@/lib`, `@/components`, `@/hooks`, `@/routes`)
i **nie** atrapuje przy tym granicy bazy — czyli test dowodzący, że komponent poprawnie reaguje
na odpowiedź, którą sam sobie napisał.

|                                     |      wydanie 7 |      wydanie 8 |
| ----------------------------------- | -------------: | -------------: |
| nowych plików testowych w oknie     |            100 |            147 |
| bez ani jednego `vi.mock`           |     17 (17,0%) | **38 (25,9%)** |
| atrapuje granicę bazy (uzasadnione) |     28 (28,0%) | **71 (48,3%)** |
| atrapuje moduł biznesowy            |     75 (75,0%) |     83 (56,5%) |
| **z tego BEZ granicy bazy**         | **52 (52,0%)** | **28 (19,0%)** |

Nowe testy tego okna to 3 582 przypadki statyczne i 6 928 asercji, czyli 1,9 asercji
na przypadek. **Jakość wzrosła realnie i na tej samej osi, na której wydanie 7 zgłaszało zarzut.**

**Sprostowanie metryki wobec wydania 7.** Tamten dokument pisał „68 z 82 nowych plików testowych
(83%) atrapuje własną warstwę danych”. Tej liczby NIE odtwarzam dzisiejszą definicją: to samo okno
daje 100 nowych plików testowych, z czego 75 (75,0%) atrapuje wewnętrzny moduł biznesowy,
a 52 (52,0%) robi to bez atrapowania granicy bazy. Różnica siedzi w definicji i w zbiorze plików,
nie w kodzie — i dlatego porównanie wydań podaję wyłącznie na jednej, jawnie opisanej metryce.

---

### 8.4 Jeden błąd potoku wdrożeniowego, pięć zapaleń — i skasowane uzasadnienie

Bramka `check:sql-migration-replay` jest czerwona na tym HEAD i mówi wprost: **ta sama migracja
wjechała DWA RAZY pod różnymi nazwami.** Dwie pary, obie z okna tego wydania, obie z klasy
„tenant scope”:

| oryginał z PR-a                                            | duplikat wygenerowany           |  bajty | linie komentarza |
| ---------------------------------------------------------- | ------------------------------- | -----: | ---------------: |
| `20260831160000_page_full_path_tenant_scope.sql`           |                                 | 10 643 |          **125** |
|                                                            | `20260831214637_5b55b33f-….sql` |  2 587 |            **0** |
| `20260831170000_owner_plane_tenant_scope_read_history.sql` |                                 |  5 826 |           **62** |
|                                                            | `20260831215103_21bb8d7a-….sql` |  2 012 |            **0** |

Treść SQL jest identyczna po usunięciu komentarzy — sprawdzone haszem znormalizowanej treści.
Duplikaty dodały commity „Work in progress” (21:50:45) i „Changes” (21:51:17), a HEAD nazywa się
„Wdrożył migracje PR #312” (21:53:03). Potok wdrożeniowy wyemitował więc migracje PR-a ponownie,
**zdejmując z nich 187 linii udokumentowanego uzasadnienia** — i to te pozbawione argumentu kopie
noszą NAJNOWSZE znaczniki czasu, więc czytający historię w kolejności nazw plików zobaczy
jako stan aktualny wersję bez argumentu.

`src/lib/authz/authzSnapshot.generated.ts` niesie `"migrations":932`. Migracji jest 934.
**Różnica to dokładnie te dwa duplikaty.** Stąd łańcuch pięciu zapaleń z jednej przyczyny:

1. `migrationReplay.test.ts` — „nazwy są parsowalne i porządek nazw = porządek wersji” (czerwony);
2. `migrationReplay.test.ts` — „ratchet: lista znanego długu odzwierciedla stan repo” (czerwony);
3. `authzSnapshotParity.test.ts` — dryf klasy PROVENANCE, „ten sam krąg uprawnionych, inne miejsce
   w historii — migrations: 932 → 934” (czerwony);
4. bramka `check:sql-migration-replay` (czerwona);
5. bramka `check:authz-snapshot` (czerwona).

Warto docenić, co ten test **rozróżnia**: klasyfikuje dryf jako PROVENANCE, czyli „ten sam krąg
uprawnionych, inne miejsce w historii”, i sam podpowiada naprawę (`bun run generate:authz-snapshot`).
Gdyby zmienił się rzeczywisty zbiór uprawnionych ról, komunikat byłby innej klasy. Bramka nie
krzyczy „coś się zmieniło” — mówi, CO się zmieniło i czy to groźne.

Bazę to przeżyje, bo migracje są idempotentne. Historia nie: przy commitach nazwanych „Changes”
i „Work in progress” kolejność nazw plików migracji jest **jedynym** narzędziem datowania regresji.
Naprawa jest tania i jest opisana w komunikacie samej bramki: zostawić plik z PR-a, usunąć
wygenerowany duplikat przed wdrożeniem, a jeśli obie wersje są już zastosowane — dopisać wpis
do `KNOWN_CONTENT_TWINS` z dowodem zastosowania. Rejestr może tylko maleć.

---

### 8.5 Pięć rzeczy, w których TEN audyt się mylił

Ta seria ma zapadkę na progach pokrycia i rejestr defektów w `it.fails`. Nie ma zapadki
na pomyłki audytora, więc trzymam ją tutaj: jawną listę, która może tylko rosnąć.

**1. Pierwszy przebieg wydania 8 dał 32,24% i był bezwartościowy — z mojej winy.**
Pomiar wystartował o 21:58, a mój własny `npm install` pisał do `node_modules` jeszcze o 22:03:19.
**966 z 2 005 plików testowych padło na zbieraniu**, wszystkie z jedną przyczyną:
`Cannot find module '@testing-library/dom'` wymagane przez `@testing-library/react/dist/pure.js`;
dodatkowo 5 plików z `@vitest-environment jsdom` nie wystartowało. Gdybym opublikował te liczby,
raport ogłosiłby zapaść z 76% na 32%. Rozpoznanie było możliwe dzięki jednej sygnaturze:
**968 padniętych PLIKÓW przy 2 czerwonych TESTACH jest niemożliwe dla regresji kodu**, bo plik
padający na zbieraniu nie zgłasza żadnego czerwonego testu. Poprawka do metody: przed pomiarem
potwierdzić, że instalacja zakończyła się PRZED startem, i puścić dymny przebieg trzech plików
komponentowych. Log unieważnionego przebiegu zachowałem, nie skasowałem.

**2. Zepsute środowisko UKRYŁO realne defekty.** W unieważnionym przebiegu `migrationReplay.test.ts`
i `serviceRoleTenantScope.gate.test.ts` nie były czerwone — bo były wśród tych 966 i raportowały
„(0 test)”. W przebiegu właściwym mają razem trzy czerwone testy. **Zielona suita w zepsutym
środowisku jest gorsza niż czerwona w dobrym:** nie tylko kłamie o wyniku, ale kasuje sygnał.

**3. Moje ustalenie „546 polityk RLS, 2 podatne tabele” było artefaktem własnego parsera.**
Napisałem własny odtwarzacz stanu schematu z 934 migracji. Dawał 546, po poprawce 579 polityk.
Parser repozytorium (`src/lib/ci/rlsPolicies`) widzi **620**. Różnica nie jest kosmetyczna:
inwariant `check:sql-owner-tenant-scope` jest **relacyjny** („jeśli choć jedna klauzula
właścicielska na tabeli wiąże najemcę, to KAŻDA musi”), więc zgubione rodzeństwo polityki zmienia
werdykt o całej tabeli. Po przejściu na parser repozytorium wynik jest inny i węższy: obie bramki
najemcy są **zielone**, `KNOWN_OPEN_GAPS` jest **pusta** (dług zastany spłacony do zera migracją
20260814221343), a realne ustalenie dotyczy ZASIĘGU bramki, nie luki — patrz rozdz. 7.3.
Zasada, którą z tego biorę: **jeśli repozytorium ma własny parser tego, co chcę zmierzyć,
mierzę jego parserem.**

**4. Czytałem pliki migracji jak stan schematu.** Cztery liczby w moim prompcie modułu 3 były
błędne, a dwie z nich miały tę jedną przyczynę. Migracja jest **zdarzeniem, nie stanem**:
`ALTER` albo `DROP` w późniejszym pliku unieważnia to, co widzę we wcześniejszym. Ta sama pomyłka
wygenerowała moje nieprawdziwe zdanie o `payment_webhook_events` oraz „35 wystąpień”, które
w rzeczywistości było liczbą **plików** migracji, nie polityk.

**5. Zaleciłem lazyfikację jako środek na budżet bundla — a odpowiedź była już napisana w pliku,
którego nie doczytałem.** Kronika `scripts/check-bundle-size.ts` niesie wpis
„`lazy()` NIE ZDEJMUJE KRAWĘDZI”: `lazy()` zdejmuje moduł ze ścieżki startowej, ale krawędź
w grafie zostaje, a budżet PUBLIC liczy każdy chunk **osiągalny** z publicznej trasy, nie tylko
pierwszego wczytania. Jedyne, co realnie zeszło z budżetu, to **odwrócenie zależności**: kanwa
buildera (kod adminowy) podaje komponent przez kontekst, a publiczny renderer zna wyłącznie
kształt propsów. Zmierzone: PUBLIC 2 701,8 → 2 669,7 KB (−32,1), ADMIN 1 596,6 → 1 629,0 KB
(„te same bajty, inne wiadro”), OVERALL bez zmian — „bo niczego nie skasowano”.

**Korekta ramy w rozdz. 5.3.** Pisałem o „DWÓCH niezależnych implementacjach importu WordPressa
o łudząco podobnych nazwach”, co sugeruje zbędne dublowanie. Sprawdzone w nagłówkach obu plików:
`wordpress-import.functions.ts` (949 linii) importuje **wpisy** przez konektor WP.com — zadania
w bazie, postęp, media, kontrakt jednego języka; `wp-import.functions.ts` (688 linii) to v2 importu
**stron** — konwersja HTML na `BuilderDocument`, parowanie PL/EN, ścieżka WXR. To dwie ścieżki
dla dwóch typów treści i **żadna nie jest martwa**. Obserwacja o pokryciu (jedna przetestowana,
druga na 0–3,3%) i wniosek metodologiczny zostają; rama „jedna zbędna” była nieuczciwa.

---

### 8.6 SSR, hydratacja i pierwsze wczytanie strony

Ten rozdział powstał na osobne pytanie: **czy pierwsze wczytanie strony dzieje się sprawnie,
precyzyjnie i szybko.** Odpowiedź jest asymetryczna i to jest jej treść: **infrastruktura jest
klasy, której w tej klasie produktu się nie spotyka, a droga krytyczna nie jest tą infrastrukturą
chroniona.** Ustalenia zebrano dziewięcioma niezależnymi ujęciami i przepuszczono przez trzy
adwersarialne soczewki (czy prawdziwe / czy dotyczy pierwszego wczytania / czy już pilnowane):
54 ustalenia, **zero obalonych, 29 z poprawką** — czyli soczewki nie przystemplowały, tylko
doprecyzowały ponad połowę. Każde twierdzenie niżej sprawdziłem osobiście w kodzie albo
w artefakcie builda; te, których nie dało się potwierdzić, są wymienione jako niepotwierdzone.

#### Skala warstwy

`src/lib/ssr/` (580 linii w 5 plikach) plus `src/lib/http/` (3 422 linie w 24 plikach) to
**4 002 linie kodu poświęconego wyłącznie potokowi SSR, cache'owi i nagłówkom.** To nie jest
aplikacja, w której SSR „po prostu jest".

#### Co jest zrobione powyżej normy

**Własny dwupoziomowy cache dokumentów SSR.** L1 to mapa w pamięci izolatu, L2 to Cloudflare
Cache API per-colo z kluczem wersjonowanym przy purge, współdzielona między izolatami kolonii,
a poza Workers degradująca do no-op. HIT znaczy „zero SSR, zero odczytów bazy"; L1 miss próbuje
L2 i przy trafieniu zasiewa L1, więc świeży izolat grzeje się jednym odczytem z kolonii zamiast
pełnym renderem. STALE serwuje natychmiast, a odświeżenie biegnie ZA odpowiedzią pod
`ctx.waitUntil`, single-flight per klucz — nieudane odświeżenie zostawia wpis nietknięty, więc
stale działa też jako bezpiecznik na czkawkę bazy. Klucz jest prefiksowany hostem najemcy
walidowanym wobec `tenants.domain` („by construction, multi-tenant safe").

**Warianty cache są rozdzielone poprawnie.** Sesja Supabase siedzi w `localStorage`, dokument
publiczny jest anonimową skorupą, a BYPASS dotyczy tylko żądań z `Authorization` albo ciasteczkiem
`sb-*`. Wszystkie trzy middleware ustawiające `Set-Cookie` (GPC, asercja najemcy, negocjacja
języka) siedzą POWYŻEJ `documentCacheMiddleware`, więc cudze ciasteczko nie ma jak wejść
do zapisanego wpisu.

**Dwa incydenty zapisane razem z naprawą, nie tylko z komentarzem.** Pierwszy: wisząca
serializacja seroval trzymała strumień otwarty do wewnętrznego limitu frameworka — cytat
z nagłówka `src/server.ts`: „każda strona »odpowiada« po ~61 s, a monitory (np. operatora
płatności) raportują serwis jako offline"; dziś pilnuje tego `documentStreamGuard.server.ts`
(414 linii, budżet idle 12 s / max 20 s). Drugi: `tee` strumienia w środku łańcucha middleware
łamał tożsamość body koperty SSR i framework ubijał serwerowy cykl życia renderu w trakcie
streamowania — dlatego zapis do cache jest ODROCZONY i wykonywany w `server.ts` za egzekutorem.

**Najostrzejszy inwariant serializacji jest ustawiony poprawnie i z uzasadnieniem.**
`dehydrate.shouldDehydrateQuery` przepuszcza wyłącznie `status === "success"`, bo zapytanie
w stanie _pending_ serializuje obietnicę w locie i seroval blokuje wtedy CAŁY dokument
do jej rozwiązania — co przy anulowanym fetchu nie następuje nigdy.

**Fonty i obraz LCP są zrobione wzorowo.** Self-hosting zamiast Google Fonts, dwa podziały
unicode, `font-display: swap`, metrycznie dopasowany fallback capsize (`size-adjust: 96,03%`),
preload per język z obowiązkowym `crossOrigin` powtórzony jako nagłówek HTTP `Link`; odcisk palca
pliku fontu w preloadzie jest identyczny z tym w arkuszu, więc preload nie jest drugim pobraniem.
Obraz LCP jest wyznaczany na SERWERZE i emitowany jako `preload as=image fetchpriority=high`
z `imagesrcset`/`imagesizes` bajtowo zgodnymi z malowanym `<img>`; przy parze light/dark moduł
jawnie ODMAWIA zgadywania i zwraca `null` — właściwa asymetria, bo zły preload kosztuje zawsze.

**Rozstrzyganie języka jest w całości serwerowe.** Język z prefiksu ścieżki, cookie tylko
dla ścieżek nielokalizowalnych, `Accept-Language` wyłącznie jako 302 dla gołego `/`. Nie ma
schematu „najpierw domyślny, potem podmiana", czyli nie ma migania tekstu.

**Bramka acykliczności grafu chunków jest prawdziwa.** `check:chunks` (parser statycznych importów
zbudowanych chunków plus Tarjan SCC) uruchomiona na obecnym artefakcie: **942 chunki, 5 456
statycznych krawędzi importu, graf acykliczny.** To jedyne zabezpieczenie klasy „martwa hydratacja",
które nie jest deklaracją — i powstało po realnym incydencie z 20.07.

#### Co realnie opóźnia pierwsze wczytanie, po skutku malejąco

Najpierw jedna rzecz strukturalna, bo bez niej reszta się nie układa: **framework awaituje
WSZYSTKIE loadery przed renderem.** Do tego momentu nie leci ani jeden bajt HTML, a `Suspense`
przy `Outlet` nie ma czego pokazać. Strumieniowanie jest realne, ale zaczyna się dopiero po
rozstrzygnięciu loaderów. **Strażnik strumienia dokumentu mierzy wyłącznie fazę strumieniowania
— faza loaderów nie ma ŻADNEGO globalnego sufitu.** To jest najważniejsze zdanie tego rozdziału.

**1. Do 5 s bez jednego bajtu HTML: dwie sekwencyjne fale rozgrzewki w loaderze korzenia.**
Fala 1 (ustawienia, tokeny, kolory, layout wpisów) jest awaitowana z budżetem
`ROOT_WARM_BUDGET_MS = 2 500`. Fala 2 (ticker, widgety headera i stopki) startuje dopiero po jej
rozstrzygnięciu, bo potrzebuje ustawień — i ma ten sam budżet. Sam korzeń może więc utrzymać
dokument 5 s, na KAŻDEJ trasie publicznej. Zweryfikowane w `src/routes/__root.tsx:70`, `:296-303`,
`:398`.

**2. Kolejne do 6 s na stronie głównej: prefetch całego dokumentu buildera.**
`src/routes/index.tsx:200-201` woła na serwerze `prefetchCachedRouteQueries` dla **całego**
dokumentu, nie tylko sekcji nad zgięciem, z budżetem 6 000 ms. Cała strona czeka więc
na najwolniejsze zapytanie spod zgięcia. **Do tego dwa komentarze obiecują mechanizm, którego
tam nie ma:** `index.tsx:192-193` („Anything past the budget still streams via the
ServerSectionGate as before") i `sectionStreaming.tsx:219-223`. Zweryfikowane:
`HomeBuilderContent.tsx:32` renderuje `<BuilderRenderer doc={doc} lang={lang} />` **bez propa
`stream`**, a domyślna wartość to `stream = false` (`BuilderRenderer.tsx:208`). Zapytanie widgetu,
które nie zmieści się w 6 s, ląduje w HTML jako pusty widget — bez szkieletu i bez dociągnięcia.

**3. Bariera między pierwszym bajtem a pierwszym widocznym tekstem: jeden arkusz 570 KB.**
`rootHead.ts:61` emituje goły `{ rel: "stylesheet", href: assets.appCss }` — bez `media`,
bez `onload`, bez krytycznego CSS inline. Pomiar artefaktu: **570 419 B surowo, 81 256 B po gzip,
około 6 700 bloków reguł.** Gzip sprowadza transfer do 81 KB, ale **koszt budowy CSSOM dla
6 700 bloków nie kompresuje się wcale**. To jedyna bariera, której NIE skraca edge cache:
nawet przy TTFB bliskim zeru czytelnik czeka na arkusz.

**4. Jeden szeregowy round-trip przed hydratacją: chunk słownika bez preloadu.**
Rdzeń słownika jest dociągany **top-level awaitem w tym samym chunku, w którym stoi**
`hydrateRoot` (`src/lib/i18n.ts:108-109`). Chunki `pl-*.js` (25,4 KB gzip) i `en-*.js` (22,2 KB)
nie występują w 9 preloadach manifestu korzenia. Przeglądarka pobiera 573,4 KB gzip preloadów,
zaczyna wykonywać entry, **dopiero wtedy odkrywa import słownika** i płaci pełny kolejny hop.

**5. Dla botów, monitorów i Lighthouse strumieniowanie jest WYŁĄCZONE.** Gdy
`isbot(User-Agent)`, framework czeka na `stream.allReady`, czyli buforuje cały dokument i TTFB
równa się pełnemu czasowi renderu. Zweryfikowane w instalowanej bibliotece
(`renderRouterToStream.tsx`, gałąź `isbot`). Praktyczny skutek: **każdy zewnętrzny monitor
i każdy pomiar Lighthouse widzi najgorszy możliwy TTFB**, a ścieżka strumieniowa, na której stoi
cała optymalizacja shella, nie jest mierzona przez nic.

**6. Early Hints i `modulepreload` z manifestu są nieosiągalne.** Framework czyta `onEarlyHints`,
`responseLinkHeader` i `inlineCss` z DRUGIEGO argumentu `fetch`, a `src/server.ts:197` woła
`handler.fetch(request, env, ctx)` — więc w tym miejscu ląduje obiekt `env` Cloudflare
i wszystkie te pola są `undefined`. Ręcznie budowany nagłówek `Link` nie zawiera więc
`modulepreload` chunków klienta, które framework zna z manifestu.

**7. Zdegradowany render jest cacheowany i serwowany kolejnym czytelnikom.** Nagłówek ustawiony
przez trasę fizycznie nie dociera do decyzji o zapisie: loadery ustawiają go na nagłówkach
zdarzenia h3, a te scalają się z odpowiedzią dopiero za całym łańcuchem middleware. Skutek jest
pełnym rozjazdem: **klient na MISS dostaje `private, no-store`, a do L1/L2 zapisuje się
`s-maxage=900, stale-while-revalidate=86400`.** Jedna czkawka bazy w momencie zimnego MISS-a
zamraża pustą powłokę archiwum bloga **na 24 h**. Kontrola jest tylko po statusie (wymagane 200),
więc `throw notFound()` jest bezpieczny, a ścieżki degradacji zwracające 200 — nie.

**8. Cztery powierzchnie publiczne emitują komunikat błędu przy HTTP 200.** To nie opóźnienie,
to brak treści. Mechanika jest wszędzie ta sama: `useQuery` na serwerze nie startuje fetcha,
a `isLoading` jest w SSR **false**, więc komponent renderuje nie szkielet, tylko swoją gałąź
„brak danych". Dotyczy: całego modułu `/events/$slug` i 7 podstron (akapit `loadError`, `<Outlet />`
nie renderowany, `head()` zahardkodowany, **zero JSON-LD `schema.org/Event`**), stron sekcyjnych
`archive_listing` („Brak opublikowanych wpisów w tej sekcji" zamiast listy do 60 wpisów),
`/series/$slug` (pełny ekran 404 przy statusie 200) i `/glossary` (brak węzła JSON-LD).
Trasy sekcyjne są typowo najsilniejsze linkowo, a HTML z tym błędem wchodzi do cache na 24 h.

#### Poprawność hydratacji — klasa cicha

React 19 przy rozjeździe tekstu **porzuca serwerowe poddrzewo i renderuje je od zera na kliencie**,
więc objawem nie jest błąd, tylko utrata dokładnie tego HTML-a, który SSR miał dostarczyć.
Wszystkie potwierdzone defekty należą do jednej rodziny: **czas i język czytane w renderze**,
przy HTML-u cacheowanym na brzegu do 24 h i serwerze zawsze w UTC. Sprawdziłem każdy osobiście:

| #   | Miejsce                                                                                                                                                         | Co robi                                                                                                                                | Wzorzec poprawny w tym samym repo                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | `blocks/InteractiveViews.tsx:198`                                                                                                                               | `useState<number>(() => Date.now())` i sekundy renderowane do HTML                                                                     | `EventCountdownView.tsx:71-73`: `useState<number \| null>(null)` z komentarzem „SSR i pierwszy render klienta są identyczne" |
| 2   | `blocks/CodeBlockView.tsx:24-25`                                                                                                                                | czyta `document.documentElement.lang` w ciele renderu; SSR zawsze emituje „Kopiuj kod", klient EN chce „Copy code"                     | `lang` jest w sygnaturze `BlockRenderer`                                                                                     |
| 3   | cztery miejsca z `Date.now()` w renderze (`ContextBlockViews.tsx:17`, `DynamicTagWidgets.tsx:85`, `LiveBlogBlock.tsx:89`, rok w stopce `SimpleWidgets.tsx:855`) | etykiety względne; rozjazd nie o sekundy, o godziny albo dni                                                                           | jw.                                                                                                                          |
| 4   | `lib/i18n/format.ts:38`                                                                                                                                         | `new Intl.DateTimeFormat(uiLocale(lang), opts)` **bez `timeZone`**; `formatDateTime` z godziną rozjeżdża się o 1-2 h przy KAŻDEJ dacie | `PostChangelog.tsx:29` (`timeZone: "UTC"`) — jedyny precedens w całym `src/`                                                 |
| 5   | `Header.tsx:93-95`, `atoms/BrandIcon.tsx:96-97`                                                                                                                 | logo mobilne wybiera `src` z `useTheme()`; to nie rozjazd, ale FOUC z drugą pobierką na elemencie nad zgięciem i kandydacie na LCP     | widget obrazu buildera trzyma oba warianty w DOM i chowa jeden CSS-em                                                        |

Pozycja 4 zasługuje na osobne zdanie, bo jest największa: **ten sam plik nazywa tę klasę błędu
dla locale** („SSR i klient renderują różny tekst") **i nie domyka jej dla strefy czasowej**.
Dotyczy każdej daty z godziną na całej powierzchni publicznej.

#### Czym to jest pilnowane, a czym NIE

Pilnowane realnie: kompletność strumienia SSR na 4 trasach i hydratacja PL/EN
(`e2e/ssr-completeness.spec.ts`), brak 5xx i soft-200 przy martwym backendzie na 12 trasach
(`e2e/ssr-degradation.spec.ts`), mechanika strażników i budżetów (5 plików testowych, m.in.
`queryStreamGuard.test.ts` — 500 linii i 30 przypadków, z progami per plik), acykliczność grafu
chunków, czystość ścieżki bootowania, budżety bajtów JS, parytet `<link>` i nagłówka `Link`,
oraz dwa historyczne rozjazdy hydratacji przez `renderToString` — **to jedyne dwa pliki testowe
w `src/`, które używają `renderToString`.**

Niepilnowane, mimo istniejącej deklaracji — i to jest sedno:

- **Rozmiar tego, co pobiera PIERWSZE wczytanie, nie ma żadnego progu.** Skrypt mówi to o sobie
  wprost: „PUBLIC liczy KAŻDY chunk osiągalny z publicznego URL-a, nie pierwsze wczytanie".
  Symetrycznie: dołożenie 100 KB do chunku startowego przechodzi, dopóki mieści się w progu
  280 KB na największy chunk. Dziś zapas na chunk to 9,5 KB, a przyrost rozłożony na 8 vendorów
  ścieżki bootowania nie zapali floora ani o bajt.
- **Arkusz CSS nie ma bramki w ogóle.** Bramka rozmiaru bierze wyłącznie `.js`. Render-blokujący
  arkusz może rosnąć dowolnie bez czerwonego CI.
- **Boot-test przeglądarkowy na artefakcie produkcyjnym nie istnieje.** `vite.config.ts:327-329`
  obiecuje, że klasę awarii z 20.07 pilnują dwie rzeczy: `check-chunk-graph.ts` **oraz** boot-test
  na buildzie `vite.smoke.config.ts`. Drugi nie jest uruchamiany nigdzie — Playwright startuje
  aplikację przez `bun run dev`, gdzie chunków nie ma z definicji. Pilnowany jest więc parytet
  konfiguracji smoke'a, którego nikt nie uruchamia.
- **Niezgodność hydratacji nie ma żadnego detektora.** Zero wystąpień `hydrateRoot` w suicie
  testowej, zero nasłuchu `console.error` w e2e (sześć trafień `page.on(` i wszystkie to
  `pageerror`). Jedyny ślad przekroczenia budżetu hydratacji to `console.warn`, którego nikt
  nie zbiera. Powtórka incydentu z 20.07 zostałaby zgłoszona nagraniem użytkownika, nie alarmem.
- **Trzy mechanizmy chroniące przed martwą hydratacją mają ZERO pokrytych linii.** Zweryfikowane
  w `coverage-ed8/coverage-summary.json`: `src/router.tsx` **0 z 38 linii i 0 z 13 funkcji**,
  `src/routes/__root.tsx` **0 z 124 linii i 0 z 48 funkcji**. `src/router.tsx` nie jest importowany
  przez żaden plik testowy. To najostrzejsza pojedyncza obserwacja całego wydania: **pliki, które
  posiadają wszystkie budżety SSR i hydratacji, są niepokryte w repozytorium mierzącym 84,12%** —
  i próg globalny tego nie widzi, bo jest agregatem.
- **Jedyny pomiar czasu w CI jest nieblokujący i mierzy serwer deweloperski.** `lighthouserc.json`
  startuje `bun run dev`, wszystkie asercje mają poziom `warn`. Zapisany artefakt
  `.lighthouseci/assertion-results.json`: **LCP 31 215 ms przy budżecie 2 500** i TBT 1 985 przy 300,
  oba na poziomie `warn`. Liczby są nieprzenoszalne na produkcję, ale sam fakt jest przenoszalny:
  **nie ma dziś ani jednego blokującego progu czasu.** Jedyna wiarygodna niezależnie od trybu:
  `cumulative-layout-shift = 0`.

**Stan bramek zależnych od builda, uruchomiony na obecnym artefakcie:** `check:chunks` zielona
(942 chunki, graf acykliczny), `check:entry-purity` zielona („ścieżka bootowania czysta"),
**`check:bundle` CZERWONA na `overall`: 4 318,3 KB przy florze 4 306 KB**, przy PUBLIC 2 684,8
z 2 715 i największym chunku 270,5 z 280. Największe ruchy: `+65,5 KB EventStudioModuleSections`
(nowy), `+40,1 KB vendor`, `+31,1 KB useEventSessions` (nowy).

#### Czego NIE potwierdziłem

Zapisuję to, bo audyt bez tej listy udaje kompletność. **(1)** Liczby „59 tras publicznych z SSR
i bez loadera" — w repo nie ma skryptu, który to mierzy; potwierdzona jest próbka z tabeli wyżej
plus `/publications` i `/tracker/changes`. **(2)** Czy `vendor-radix` jest statycznie osiągalny
z entry. **(3)** Udziału obrazów bez `width`/`height` — brak podanej metody zliczania, a CLS
mierzony na artefakcie wynosi 0. **(4)** Czy Supabase negocjuje AVIF/WebP — transformacje idą
bez jawnego `format`. **(5)** Zachowania zewnętrznego CDN wobec `Vary: Sec-GPC`. **(6)** Czy
zmienna `LHCI_URL` jest ustawiona, czyli czy blokujący tryb Lighthouse kiedykolwiek się włącza.
Dodatkowo **krytyk kompletności tego badania padł na limicie sesji**, więc lista „czego brakuje"
nie została napisana przez niezależnego agenta — to jest znana luka tego rozdziału.

#### Kolejność naprawy — jedenaście punktów, każdy z efektem i kosztem

1. **Zdjąć drugą falę rozgrzewki korzenia z drogi krytycznej** (`__root.tsx:398`). Fala 2 nie jest
   potrzebna do wyrenderowania treści: przenieść za `Suspense` albo obniżyć budżet do 300-500 ms
   i nie awaitować. Efekt: **do 2,5 s, a w najgorszym razie do 5 s, z czasu do pierwszego bajtu
   na KAŻDEJ trasie publicznej.** Koszt: niski, jeden plik.
2. **Zawęzić prefetch strony głównej do sekcji nad zgięciem** i włączyć `stream`
   w `HomeBuilderContent`. Efekt: do 6 s na MISS strony głównej; przywraca sens budżetu
   `SERVER_SECTION_STREAM_BUDGET_MS = 2 000`. Jeśli decyzja będzie odwrotna — poprawić dwa
   komentarze, żeby nie kłamały. Koszt: średni.
3. **Naprawić martwy opt-out `no-store` dla renderów zdegradowanych.** Bez tego punkty 1 i 2
   ZWIĘKSZAJĄ ryzyko: krótsze budżety oznaczają więcej renderów zdegradowanych, a te dziś
   wchodzą do cache na 24 h. Koszt: średni, dotyka granicy middleware/handler.
4. **Dodać loader czterem powierzchniom publicznym, które w SSR emitują komunikat błędu.**
   To nie przyspieszenie, to naprawa poprawności: dziś crawler i użytkownik bez JS dostają stronę
   błędu albo „404" przy HTTP 200 i pełnym cache. Koszt: niski na trasę.
5. **Rozbić render-blokujący arkusz i postawić na niego bramkę**, w kolejności taniości:
   (a) dodać `.css` do bramki rozmiaru; (b) wyciąć panel i buildera z `@source` do osobnego
   arkusza; (c) rozważyć `server.build.inlineCss` frameworka (dziś nieużyte). Efekt: FCP i LCP
   każdej trasy publicznej — jedyna bariera, której nie skraca edge cache.
6. **Preloadować chunk słownika aktywnego języka.** Zdejmuje jeden szeregowy round-trip
   (25,4 KB PL / 22,2 KB EN) z okna przed `hydrateRoot`. Koszt: niski, test parytetu już istnieje.
7. **Domknąć rodzinę „czas i język w renderze"** — dziewięć niezależnych zmian, wzorce są
   już w repo, każdą da się domknąć testem `renderToString`. Największy pojedynczy zysk:
   `formatDateTime` bez strefy dotyczy każdej daty z godziną.
8. **Postawić próg na rozmiar domknięcia startowego** i naprawić `stableChunkName`, który zwija
   10 chunków `vendor-*` do jednego wiadra, więc raport ruchów nie wskazuje biblioteki.
9. **Odblokować drugi argument `handler.fetch`** — otwiera `responseLinkHeader` (modulepreload
   z manifestu), `onEarlyHints` (103) i `inlineCss` z punktu 5c. Zysk realny na MISS i na HIT,
   bo nagłówek `Link` jest utrwalany w cache.
10. **Uruchomić boot-test przeglądarkowy na artefakcie produkcyjnym** — zamyka jedyną klasę
    awarii, która w tym repozytorium WYSTĄPIŁA i miała pełny promień rażenia, a której obecne
    bramki łapią tylko jedną przyczynę (cykle).
11. **Zacząć mierzyć czas na czymkolwiek produkcyjnym.** Dziś jedyny zapisany pomiar to LCP
    31 215 ms na serwerze deweloperskim, na poziomie `warn`. Wszystkie punkty 1-9 są dziś
    **nieweryfikowalne liczbą** — i to jest najpoważniejszy brak tego obszaru, bo bez pomiaru
    każda z tych napraw jest hipotezą.

**Ocena tego obszaru: dobrze na infrastrukturze, przeciętnie na drodze krytycznej.** Repozytorium
ma dwupoziomowy cache brzegowy z kluczem per najemca, strażniki strumienia, trzy bezpieczniki
serializacji i dwa incydenty spisane razem z naprawą. I jednocześnie: do 11 s budżetów loaderów
przed pierwszym bajtem, arkusz 570 KB bez bramki, słownik bez preloadu, zdegradowany render
wchodzący do cache na dobę, cztery publiczne powierzchnie oddające błąd przy statusie 200
i **zero pokrytych linii w dwóch plikach, które posiadają wszystkie te budżety.**

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
| 1   | Wpisy: doświadczenie czytelnika                       |   104 |       13 732 |            58 |     13 071 |
| 2   | Edytor wpisów i workflow redakcyjny                   |   103 |       14 771 |            88 |     23 835 |
| 3   | Silniki treści: bloki + page builder                  |   461 |      111 659 |           327 |     79 584 |
| 4   | Strony, wygląd, motyw, media, import                  |   134 |       16 886 |            74 |     15 564 |
| 5   | Strona główna, archiwa, chrome                        |    62 |       10 044 |            29 |      8 022 |
| 6   | Wyszukiwarka                                          |    25 |        4 683 |            21 |      6 119 |
| 7   | Typy treści specjalne                                 |    95 |       23 117 |            46 |     10 923 |
| 8   | SEO, feedy, dane strukturalne                         |    78 |       10 940 |            69 |     21 038 |
| 9   | Czat / komunikator                                    |    81 |       15 602 |            36 |      9 164 |
| 10  | Sieć / networking                                     |    32 |        5 162 |            23 |      5 298 |
| 11  | Newsletter i e-mail                                   |   148 |       29 049 |           118 |     39 965 |
| 12  | Realtime / powiadomienia / web-push                   |    28 |        5 495 |            14 |      1 785 |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |   190 |       28 842 |           135 |     49 776 |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |    44 |        6 384 |            29 |      9 452 |
| 15  | Profil i konto                                        |    94 |       19 874 |            72 |     32 847 |
| 16  | Społeczność: kluby, komentarze, moderacja             |   306 |       58 521 |           194 |     74 365 |
| 17  | Analityka i BI                                        |    86 |       16 628 |            19 |      2 229 |
| 18  | CRM                                                   |    59 |       16 226 |            33 |     10 365 |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |   135 |       24 887 |            55 |     21 544 |
| 20  | Platforma / backend / infrastruktura / SSR            |   203 |       66 357 |           232 |     90 339 |
| 21  | Rekrutacja / kariera                                  |    29 |        5 231 |            11 |      2 202 |
| 22  | Wydarzenia: event builder, rejestracja, onsite        |   366 |       67 947 |           236 |     93 643 |
| —   | PRZEKROJOWE: słowniki i18n                            |   135 |       55 290 |             6 |        528 |
| —   | NIEPRZYPISANE                                         |     0 |            0 |            11 |      2 043 |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    |   221 |       32 817 |            72 |     20 907 |
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
# POCZEKAJ na zakończenie instalacji i sprawdź, że się DOMKNĘŁA (patrz niżej)
node -e "['@testing-library/dom','@testing-library/react','happy-dom','jsdom']\
  .forEach(m=>require.resolve(m+'/package.json'))"   # dymny test kompletności
npx vitest run src/components/PostLayoutRenderer.test.tsx   # dymny przebieg 1 pliku
bun run test:coverage          # próg globalny + 373 progów per-ścieżka
```

**Dwa kroki pośrodku nie są ozdobą — bez nich to wydanie opublikowałoby zapaść pokrycia.**
Pierwszy przebieg wydania 8 wystartował, gdy instalacja zależności jeszcze pisała do
`node_modules`: katalog `@testing-library/dom` powstał o 22:03:19, a pomiar startował o 21:58.
**966 z 2 005 plików testowych padło na zbieraniu z jedną przyczyną**, a wynik globalny spadł
do 32,24%. Sygnatura, która to rozstrzyga w jednym spojrzeniu: **duża liczba padniętych PLIKÓW
przy znikomej liczbie czerwonych TESTÓW jest niemożliwa dla regresji kodu** — plik padający
na zbieraniu nie zgłasza żadnego czerwonego testu. Szczegóły w rozdz. 8.5 pkt 1.

Od wdrożenia R1 z wydania 1 (`coverage.reportOnFailure: true` w configu) raport i progi powstają
TAKŻE na czerwonej suicie, więc jedno polecenie wystarcza — obejście z wydania 1 nie jest
już potrzebne. Pełny przebieg na tym HEAD: **35 min 34 s** (2 134 s), 2 010 plików testowych,
54 695 testów (2 006 plików / 54 374 testów przeszło, 5 testów padło
w 4 plikach, 266 „expected fail”, 2 pliki / 50 testów pominięte —
odpytują hostowaną bazę i pomijają się SAME warunkiem `shouldRun ? describe : describe.skip`).
Ta sama flaga `reportOnFailure` ma jednak drugą stronę, opisaną w rozdz. 1: **pokrycie jest
ślepe na czerwone testy**, bo linia wykonana przez padający test wciąż liczy się jako pokryta.

Agregacja per moduł / funkcja / funkcjonalność powstała z `coverage-final.json`
(mapy `statementMap`/`fnMap`/`branchMap` + liczniki `s`/`f`/`b`) oraz `coverage-summary.json`:
moduł = suma po plikach pasujących do reguł z 9.1, funkcjonalność = suma po wzorcach ścieżek,
„funkcja bez wywołania” = wpis `fnMap`, którego licznik `f` wynosi zero.

**Kontrola prozy wobec pomiaru.** Każda liczba wpisana w ten dokument ręcznie (nie z szablonu)
jest sprawdzana skryptem porównującym ją z `by-module-ed8.json`, `meta.json` i danymi wydania 7 —
77 twierdzeń, zero rozjazdów na tym HEAD. Skrypt powstał w wydaniu 7, gdzie wyłapał dziesięć
błędnych liczb w rozdziale 8.2, i od tamtej pory jest uruchamiany przed każdą publikacją.
W tym wydaniu wyłapał trzy: trzy z moich liczb kumulacyjnych w „Trajektorii” były błędne
(moduł 14 miał +79,9 zamiast +70,1, sieć +30,4 zamiast +2,0, ustawienia +71,2 zamiast +71,4).

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
