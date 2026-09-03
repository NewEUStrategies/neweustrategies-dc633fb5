# Audyt pokrycia testami: moduł po module, funkcja po funkcji (2026-09-03)

**Wydanie 9 pomiaru — pierwsze, w którym infrastruktura dowodu wyprzedziła audyt, i pierwsze
mierzone na CZERWONEJ suicie.** Rodowód: wydanie 1 (2026-08-18) musiało wykluczyć 39 plików
testowych wiszących w kolekcji; wydanie 2 (19.08) było pierwszym KOMPLETNYM pomiarem; wydania 3
(19.08) i 4 (21.08) wyszły kodem 0; wydanie 5 (22.08) miało dwa czerwone testy; wydanie 6 (29.08)
wprowadziło MODUŁ 22 i miało dwanaście czerwonych oraz osiem naruszeń progów; wydanie 7 (30.08)
było w komplecie zielone; wydanie 8 (31.08) miało pięć czerwonych testów w czterech plikach
i znalazło jeden błąd potoku wdrożeniowego zapalający pięć rzeczy.
To wydanie mierzy HEAD `d737e1329` — **222 commity** (194 nie-merge) za wydaniem 8.

**Trzy pierwsze rekomendacje wydania 8 są zamknięte — po raz pierwszy w serii zamknęło się coś
poza kampanią modułową.** Próg globalny podniesiony z `64/58/62/65` na **`79/73/77/80`**
(+15 pp na każdym wymiarze, pierwszy ruch zapadki globalnej od wydania 5). Progi per-ścieżka
**373 → 554** (+181, więcej niż suma przyrostów wydań 1-8). Rozjazd snapshotu uprawnień
z migracjami — **zamknięty**: 935 migracji na dysku i 935 w snapshocie, wobec 932/934
w wydaniu 8.

**I znalezisko, które musi stać przed liczbami: suita nie jest zielona, a `main` stoi czerwony
seriami.** Osiem plików, **272 padnięte testy** — potwierdzone drugim, niezależnym pełnym
przebiegiem na tym samym HEAD, który dał **identyczny** zbiór porażek (8 \| 2 208 \| 2 i
272 \| 60 584 \| 337 \| 51), więc to nie artefakt obciążenia maszyny. Wszystkie padły z tej
samej przyczyny klasowej: **kod produkcyjny zmienił się pod testami, a testu nikt nie ruszył**.
Dwa razy commitami bota o komunikatach „Work in progress" i „Changes", raz commitem kampanii
modułowej — która przy tym miała rację, bo naprawiała dostępność.

Ta przyczyna nie jest domysłem, bo daje się policzyć — i policzyłem ją dwiema niezależnymi
metodami.

**Metoda pierwsza, po commitach:** **25 z 194 commitów nie-merge w tym oknie (12,9%) ruszyło
kod produkcyjny i ani jednego pliku testowego**, razem **2 856 linii**. Jeden commit —
`3d4b684ca`, autorstwa bota, o komunikacie „Work in progress" — odpowiada sam za **62,8%**
tej sumy. Drugi na liście jest commit Claude'a jawnie oznaczony
`WIP: … (NIE stan zweryfikowany)`, czyli deklarujący własną niekompletność.

**Metoda druga, po grafie importów:** z **221 plików produkcyjnych** zmienionych w oknie
(`src/**` bez testów, bez `routeTree.gen.ts` i wygenerowanych typów) census oparty na
statycznym grafie importów 2 236 plików testowych objął 217 i rozłożył je tak: **149**
ma test, który ruszył się w oknie nie wcześniej niż kod; **21** ma test, który **stoi
przed** zmianą; **30** ma test nietknięty; **19 nie ma żadnego testu, który by je
importował**. Poza kategorią bezpieczną zostaje **68 plików i 5 514 linii — 26% całego
ruchu produkcyjnego okna** (rozdz. 12.2).

Praktycznie każdy z ostatnich około dwudziestu przebiegów CI na main to `failure` albo
`cancelled`.

**I tu jest korekta metodologiczna, która jest najważniejszym ustaleniem tego wydania.** Pisałem od
wydania 5, że `coverage.reportOnFailure: true` czyni procent **ślepym na czerwień**, bo linia
wykonana przez padający test nadal liczy się jako pokryta — i że wobec tego porażki „nie obniżają
w tabelach ani jednego procentu". **To zdanie jest zbyt ogólne i w tym wydaniu jest wprost
nieprawdziwe.** Jest prawdą dla testu, który padł na **asercji**: kod się wykonał, więc linie
zaliczyły się mimo porażki. Nie jest prawdą dla testu, który **nigdy nie dojechał do kodu** —
a 188 z 272 dzisiejszych porażek wypaliło pełny budżet `waitFor`, więc linie tras
`admin.settings*` naprawdę się nie wykonały i glob spadł z 97,25% na **59,26%**. Granica przebiega
dokładnie tam: **procent nie widzi padniętej asercji, ale widzi niedotarcie do kodu.** Pełny
rachunek, z kontrfaktycznym pomiarem modułu 19, jest w rozdz. 12.2.

Skala zmiany w liczbach pomiaru: plików produkcyjnych w mianowniku 3 260 → **3 304**,
mierzonych linii 105 556 → **107 051**, funkcji 34 077 → **34 450**, plików testowych
2 010 → **2 218**, progów per-ścieżka 373 → **554**. Dla porządku: wierszy kodu produkcyjnego
na dysku jest dziś **673 158** w 3 307 plikach — z czego trzy pliki wyklucza z pomiaru sama
konfiguracja, stąd 3 304 w mianowniku.

Pokrycie globalne: linie 84,12% → **90,75%**, funkcje 81,49% → **88,22%**,
gałęzie 77,51% → **84,25%**, instrukcje 82,87% → **89,49%**.
**Zapadka globalna po raz pierwszy w serii jest CIASNA — i po raz pierwszy w serii zapadka
per-ścieżka ZAPALIŁA.** Próg globalny podniesiony przez `85af2c6d4` na **79/73/77/80**
(instrukcje/gałęzie/funkcje/linie) stoi dziś **10,5-11,3 pp** pod pomiarem, wobec 19,1 pp
w wydaniu 8 — czyli margines skurczył się o połowę. I przebieg zgłosił **29 naruszeń progów
per-ścieżka na 16 ścieżkach** (wydanie 8: zero).

Rozebrałem wszystkie 29 i **nie są jedną historią, a trzema — z czego tylko jedna jest regresją.**
**23 z 29 wierszy (14 z 16 ścieżek) to progi, których w wydaniu 8 NIE BYŁO**: doszły razem
z 181 nowymi i ustawiono je na 99%, gdy pełna suita mierzy 96-98,9%; mediana braku to **1,44 pp**,
a najmniejsze naruszenie **0,04 pp**. Jedna ścieżka to realna zapaść —
`src/routes/admin.settings*.tsx`, linie **59,26%** przy progu 96 i funkcje **32,54%** przy progu 94,
przy progu NIEZMIENIONYM od wydania 8. Jedna to przyrost kodu bez testu. **Suma braków to
198,83 pp, z czego 153,28 pp (77%) daje ta jedna ścieżka** — czyli liczba „29" sama nie mówi nic
o skali, mówi tylko, że bramka jest czuła aż do czterech setnych punktu (rozdz. 6.1).

**Regres wobec własnego zapisu tego audytu.** Wydania 4-8 raportowały „zero bezwarunkowych
`it.skip`/`it.todo`, dokładnie dwa `describe.skip`, oba warunkowe". To zdanie przestało być
prawdziwe: `src/routes/__tests__/rootShellRender.test.tsx:91` niesie **bezwarunkowe**
`describe.skip` na `RootComponent` — korzeniu całej aplikacji i dokładnie tym pliku, który
wydanie 8 wskazało jako niepokrytego właściciela wszystkich budżetów SSR (rozdz. 12.3).

**Korekta liczby z wydania 8.** Podałem tam „7 tabel poza zasięgiem bramki izolacji tenanta".
Policzone **analizatorem samej bramki** — a nie własnym parserem, co jest wnioskiem z rachunku
sumienia wydania 8 — wychodzi **17**, z czego **14 ma kolumnę `tenant_id`**, o której ich
polityki właścicielskie nie wiedzą. Różnica siedzi w definicji, nie w kodzie; podaję metodę
razem z liczbą (rozdz. 12.5).

Plik pozostaje pod tą samą nazwą, bo odwołuje się do niego komentarz przy progu globalnym
w `vitest.config.ts` oraz prompty modułowe. **Mapa modułów w tym wydaniu się nie zmieniła**,
więc delty w 2.1 mierzą wyłącznie pracę testową i nie wymagały przeliczania poprzedniego
przebiegu. Rozdziały 10 i 11 — pomiary dwóch kampanii międzywydaniowych (moduł 12 i moduł 16)
— zostawiam bez zmian jako zapis tamtej pracy w jej własnym oknie.

Zlecenie: **„ile % pokrycia testami ma każdy moduł, jego funkcje oraz funkcjonalności"**.
Dokument podaje ZMIERZONE liczby (nie oceny), z jawną metodologią i jawnymi ograniczeniami
pomiaru. Taksonomia modułów pochodzi z `docs/OCENA_FUNKCJI_TABELE_2026-08-14.md`; MODUŁ 22
(wydarzenia) dołożyło wydanie 6, bo tamten dokument powstał przed dostawą — pozostałe
21 modułów podłożysz pod tamte tabele ocen bez zmian.

---

## 0. Jak to zmierzono (i czego te liczby NIE znaczą)

| Element pomiaru                    | Wartość                                                                                                                                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Narzędzie                          | `vitest run --coverage` (provider `v8`), konfiguracja repo bez zmian                                                                                                                         |
| Zakres mierzony                    | całe `src/**/*.{ts,tsx}` (`all: true`) — pliki bez testów WCHODZĄ do mianownika                                                                                                              |
| Wykluczenia (z `vitest.config.ts`) | `__tests__`, `*.test.*`, artefakty generowane (`routeTree.gen.ts`, `supabase/types.ts`, `lucideIconNodes.generated.ts`), `src/test/**`, `lazyWidgets.tsx`                                    |
| Plików produkcyjnych w mianowniku  | 3 304                                                                                                                                                                                        |
| Plików testowych zmierzonych       | 2 218 z 2 218 (100,0%)                                                                                                                                                                       |
| Przypadków testowych wykonanych    | 61 244 (statyczny licznik `it/test` w plikach: 47 230; różnica to rozwinięcia `it.each`)                                                                                                     |
| Testy poza pomiarem                | brak — żaden plik nie został wykluczony z przebiegu                                                                                                                                          |
| Testy czerwone w tym przebiegu     | **272 w 8 plikach** — pierwsza taka skala w tej serii, rozebrana w rozdziale 12.2                                                                                                            |
| Testy „expected fail”              | 337 przypadków z 327 wywołań `it.fails(` w 186 plikach — zapisane defekty produkcyjne, nie awarie (rozdział 7.2)                                                                             |
| Testy pominięte                    | 51: 50 w dwóch plikach na warunku środowiskowym + **1 pominięcie BEZWARUNKOWE** (`rootShellRender.test.tsx:91`) — regres wobec zapisu wydania 8 (rozdział 9.2)                               |
| Wynik bramki pokrycia              | przebieg zakończony kodem **1**: próg globalny PRZESZEDŁ z zapasem 10,5–11,3 pp, ale **29 progów per-ścieżka z 554 na 16 ścieżkach NIE** (rozdział 6.1) — w wydaniu 8 naruszeń było **zero** |
| Czas przebiegu                     | 2 216,67 s, z czego **952,40 s (43%) na jednym czerwonym pliku** — rozdział 12.2                                                                                                             |
| Data pomiaru                       | 2026-09-03, HEAD `d737e1329`                                                                                                                                                                 |

**Pięć zastrzeżeń, bez których te procenty można źle odczytać:**

1. **Pokrycie ≠ poprawność.** Instrukcja „pokryta” to instrukcja, która się WYKONAŁA w trakcie
   testu — nie taka, której wynik ktoś sprawdził asercją. Dlatego obok pokrycia podaję gęstość
   asercji (kolumna „asercje”) — moduł z wysokim pokryciem i niską liczbą asercji to render bez
   dowodu. W tym wydaniu doszedł do tego pomiar twardszy: **zero** przypadków bez ani jednej
   asercji w całej suicie (skaner z rozwiązywaniem importów i tranzytywnym domknięciem helperów
   asercyjnych do głębokości 4), ale **73 przypadki**, których jedyną asercją jest
   `expect(...).not.toThrow()` — te dowodzą wyłącznie, że nic nie rzuciło.
2. **Pokrycie jednostkowe to nie całe pokrycie systemu.** Warstwa danych (RLS, RPC, triggery) jest
   testowana w pgTAP (**101 plików, 1 852 asercje** — liczba potwierdzona dwiema niezależnymi
   metodami, `plan(N)` wobec zliczenia wywołań, z zerem rozjazdów w każdym pliku), a ścieżki
   użytkownika w Playwrightcie (**11 plików, 98 testów w DWÓCH konfiguracjach**: 9 plików / 96
   testów przez `playwright.config.ts` i 2 pliki / 2 testy przez `playwright.artifact.config.ts`
   — te drugie jako jedyne jadą po ZBUDOWANYM artefakcie, nie po dev-serwerze). Tych warstw v8 nie
   widzi — moduł z niskim % jednostkowym może mieć realną zaporę w bazie (rozdział 7).
3. **Mapowanie plik → moduł jest MOJE, nie repo.** Repo nie ma manifestu modułów; przypisanie
   3 304 plików do 22 modułów zrobiłem regułami po ścieżkach (rozdział 9.1). Pliki graniczne
   (np. `gifting` — „podaruj artykuł” jest funkcją MODUŁU 1, a kod leży w powierzchni MODUŁU 14)
   zaznaczam w tabelach. **Mapa nie zmieniła się od wydania 8**, więc delty w 2.1 mierzą wyłącznie
   pracę testową, a nie przesunięcie granic.
4. **Pomiar jest KOMPLETNY, ale suita NIE jest zielona — i tym razem to nie przypis, a treść
   wydania.** Ten przebieg: **2 208 plików testowych przeszło, 60 584 testy przeszły, 272 padły
   w 8 plikach**, przy **29 naruszeniach progów per-ścieżka**. Rozkład czerwieni jest skrajnie
   nierówny: jeden plik odpowiada za **188 z 272 padnięć** i za 43% czasu przebiegu, bo wszystkie
   jego helpery montujące kończą się tą samą barierą `waitFor`. **Siedem z ośmiu czerwonych plików
   ma jedną przyczynę klasową** — kod produkcyjny zmienił się pod testem, a testu nikt nie ruszył
   — a ósmy jest **bombą zegarową kalendarzową**, która zapaliła się 2026-09-02 o 12:00 UTC bez
   udziału jakiegokolwiek commitu. Pełny rozbiór, z czterema pod-mechanizmami i dwoma kolejnymi
   bombami, które zapalą się w ciągu 7–12 dni: rozdział 12.2. Do tego **337 przypadków „expected
   fail”** — to NIE awarie, tylko zapisane defekty produkcyjne (rozdział 7.2).
5. **Teza tej serii o `reportOnFailure` wymaga OGRANICZENIA i to jest najważniejsza korekta
   metodologiczna tego wydania.** Pisałem od wydania 6, że skoro raport pokrycia powstaje mimo
   czerwieni, to procent nie widzi awarii. To jest prawdą dla testu, który **padł na asercji** —
   przeszedł przez mierzony kod i wywrócił się dopiero na sprawdzeniu, więc linie zostały
   zaliczone. To jest **nieprawdą** dla testu, który do kodu nigdy nie dotarł: 188 padnięć
   w `adminSettingsRoutes.test.tsx` znaczy, że linie `admin.settings*` **naprawdę się nie wykonały**,
   pokrycie **naprawdę spadło** (97,25% → 59,26% linii), a próg per-ścieżka zapalił się na
   wszystkich czterech wymiarach. Granica przebiega dokładnie tam: **pada asercja — procent kłamie;
   pada dotarcie do kodu — procent mówi prawdę.** Rozdział 12.2 pokazuje to na module 19, jedynym,
   który w tym wydaniu spadł.
   Uwaga dla tego, kto będzie czytał log: **frazy `Timed out in waitFor` nie ma w nim ani razu**
   (`grep -c` = 0). `waitFor` po wyczerpaniu budżetu rzuca OSTATNI błąd asercji, nie komunikat
   o limicie — w logu stoi `expected undefined to be truthy`, 111 razy. Mechanizm jest limitem
   czasu, treść komunikatu nie.

---

## 1. Wynik globalny: całe `src/`

| Metryka    | Pokryte / wszystkich |          % |
| ---------- | -------------------: | ---------: |
| Instrukcje |    109 585 / 122 450 | **89,49%** |
| Gałęzie    |     93 859 / 111 399 | **84,25%** |
| Funkcje    |      30 395 / 34 450 | **88,22%** |
| Linie      |     97 157 / 107 051 | **90,75%** |

**Repozytorium przekroczyło 90% linii — pierwszy raz w tej serii dziewięciu pomiarów.** Przyrost
od wydania 8 jest największy, jaki zanotowałem: instrukcje +6,62 pp, gałęzie +6,74 pp,
funkcje +6,73 pp, linie +6,63 pp. Mianownik przy tym URÓSŁ (105 556 → 107 051 mierzonych linii,
34 077 → 34 450 funkcji, 3 260 → 3 304 plików), więc to nie jest efekt zwężenia zakresu: doszło
1 495 mierzonych linii kodu produkcyjnego i mimo tego procent poszedł w górę o ponad sześć punktów.

Próg globalny w `vitest.config.ts` (ratchet, wolno tylko podnosić): **79% instrukcji / 73% gałęzi /
77% funkcji / 80% linii**. Zmierzony margines nad progiem: instrukcje 10,49 pp, gałęzie 11,25 pp,
funkcje 11,22 pp, linie 10,75 pp.

**Trzy najważniejsze rekomendacje wydania 8 są WDROŻONE — i to jest pierwsze wydanie tej serii,
w którym mogę to napisać.** Zapadka globalna stała trzy wydania z rzędu na `64/58/62/65`; commit
`85af2c6d4` podniósł ją do `79/73/77/80`, stosując regułę `floor(zmierzone − 4)` dosłownie na
pomiarze z 2026-09-01 (83,17 / 77,63 / 81,66 / 84,44). Sprawdziłem tę arytmetykę i zgadza się co do
jedności w czterech przypadkach na cztery. Progi per-ścieżka: 373 → **554** (+181). Rozjazd
migracji, który psuł dwie bramki, jest zamknięty: 935 = 935.

**Skutek jest mierzalny i nie jest kosmetyczny.** Żeby dziś przebić próg globalny w dół,
repozytorium musiałoby stracić **11,85%** swojego pokrycia linii; w wydaniu 8 ta liczba wynosiła
22,73%, czyli blisko jedną czwartą. Zapas zmalał o połowę. Nadal jest za duży — reguła
`floor(zmierzone − 4)` zastosowana do DZISIEJSZEGO pomiaru dałaby `85/80/84/86` — ale bramka
przestała być formalnością.

**Kontrola wiarygodności pomiaru: rozjazd zmalał z 14,8 pp na 6,3 pp.** Komentarz przy progu
w `vitest.config.ts` dokumentował w wydaniu 8 pomiar 68,27 / 62,80 / 66,25 / 69,28 i pisałem, że
opisuje repozytorium o blisko piętnaście punktów słabsze, niż jest naprawdę. Kronika została
uzupełniona: najnowszy wpis (2026-09-01) niesie 83,17% instrukcji (100 824/121 220) / 77,63% gałęzi
/ 81,66% funkcji / 84,44% linii (89 523/106 017), z jawnym uzasadnieniem reguły marginesu i z
uczciwym „czego nie mam" o braku zapisanego pomiaru z runnera CI. Dzisiejszy pomiar stoi 6,31 pp
wyżej na liniach — i ta różnica ma datę: wpis powstał przed kampaniami modułów 7 i 16, które weszły
2026-09-02. **Rozjazd nie jest już usterką dokumentacji, jest normalnym opóźnieniem kroniki wobec
pracy.**

**Przy okazji: mój własny skrypt czytał tę kronikę BŁĘDNIE i naprawiłem go w tym wydaniu.** Wzorzec
wyciągający najnowszy wpis wymagał postaci `X% instrukcji / Y% gałęzi`, a wpis z 2026-09-01 wstawia
między nie liczniki w nawiasach (`83,17% instrukcji (100 824/121 220) / 77,63% gałęzi`) — ukośnik
wewnątrz `100 824/121 220` łamał dopasowanie, więc skrypt cicho cofał się do wpisu o dwa ratchety
starszego i podawał 69,28% jako „to, co dokumentuje config". Gdybym tego nie sprawdził, wydanie 9
powtórzyłoby zarzut z wydania 8 wobec komentarza, który został już poprawiony. **Zapis tego błędu
jest tu celowo: pomiar czytający cudzy tekst jest tak samo omylny jak tekst.**

**Zapadka per-ścieżka zapaliła się PIERWSZY RAZ w tej serii — ale nie z tego powodu, z którego
początkowo napisałem.** W wydaniu 8 naruszeń było **zero**. Dziś jest **29 naruszeń na 16 ścieżkach
z 554**, przy progu globalnym przechodzącym z zapasem ponad dziesięciu punktów. Rozebrałem je
wszystkie (rozdz. 6) i wychodzą z tego **trzy różne historie, z których tylko jedna jest regresją**:

- **23 z 29 wierszy naruszeń (14 z 16 ścieżek) to progi, których w wydaniu 8 NIE BYŁO.** Doszły
  razem z 181 nowymi progami i ustawiono je na 99%, gdy pełna suita mierzy 96–98,9%. Mediana braku
  to **1,44 pp**, dziesięć naruszeń ma brak poniżej 1 pp, a najmniejsze — `src/lib/analytics/ga4.server.ts`
  na instrukcjach — **0,04 pp**. To nie spadek pokrycia; to próg postawiony ponad pomiarem, zapewne
  z przebiegu na podzbiorze plików (opis commitu `d1861e84b` sam podaje: „`npx vitest run` na
  jedenastu plikach").
- **Jedna ścieżka to realna regresja:** `src/routes/admin.settings*.tsx`, próg NIEZMIENIONY od
  wydania 8, a zmierzone runęło **97,25% → 59,26%** linii i **32,54%** na funkcjach wobec progu 94.
- **Jedna to przyrost kodu bez testu:** `src/lib/observability/report.ts`, plik urósł z 88 na 115
  wierszy przy nietkniętym progu.

Ta korekta nie osłabia argumentu za progami per-ścieżka, tylko go przenosi: **suma braków to
198,83 pp, z czego 153,28 pp (77%) daje jedna ścieżka.** Liczba „29 naruszeń" sama nie mówi nic
o skali — mówi tylko, że bramka jest czuła aż do czterech setnych punktu.

**Teza o `reportOnFailure` dostaje w tym wydaniu granicę.** `coverage.reportOnFailure: true` stoi
w configu od wydania 2 i działa: raport i progi powstają także na czerwonej suicie, więc ten pomiar
nie wymagał żadnego obejścia. Pisałem jednak od wydania 6, że skutkiem uboczym jest **ślepota
procentu na czerwień** — bo test wywracający się na asercji zdążył przejść przez mierzony kod, więc
linie zaliczyły się mimo porażki. To rozumowanie było zbyt ogólne. Rozstrzyga je przypadek modułu
19 (jedyny spadek w tym wydaniu: linie 93,36% → 90,22%, funkcje 90,21% → **80,23%**): tam testy
padły **przed** dotarciem do kodu, na pięciosekundowym limicie `waitFor`, więc linie NIE wykonały
się wcale, pokrycie spadło realnie i próg per-ścieżka zapalił się na wszystkich czterech wymiarach.
**Poprawna postać tezy jest więc taka: procent jest ślepy na padniętą ASERCJĘ, ale nie jest ślepy
na niedotarcie do kodu.** Pierwszy przypadek złapie tylko wynik suity, drugi łapie próg. Dowód
liczbowy na module 19: rozdział 12.2.

**Sprostowanie do wydania 8, przy okazji tego samego wątku.** Napisałem tam, że repozytorium ma
zero `as any` i zero `: any` w kodzie pisanym ręcznie, a w tym wydaniu znalazłem `let payload: any`
w `src/routes/platform/email/auth/webhook.ts:115`. Sprawdziłem, czy to regres tego okna: **nie
jest.** `git show 8e771b983:src/routes/platform/email/auth/webhook.ts` pokazuje tę linię pod tym
samym numerem, a plik nie ma w tym oknie ANI JEDNEGO commitu. To była moja pomyłka pomiarowa
w wydaniu 8, nie nowy dług. Dzisiejszy pomiar w **3 305 plikach produkcyjnych** pisanych ręcznie,
z wygaszonymi komentarzami i literałami napisowymi: `as any` **0**, `: any` **1** (ta jedna linia),
`as unknown as` **179** w 115 plikach. Dwa zastrzeżenia do metody, bo bez nich liczba jest fałszywa
w obie strony. **Naiwny grep daje 370 trafień `as any`**, ale wszystkie siedzą
w `routeTree.gen.ts`, którego repo zabrania edytować i który jest wykluczony z pomiaru
w `vitest.config.ts:81`. **A grep po samych plikach ręcznych daje 10 trafień `as any` i 5 `: any` —
i wszystkie oprócz jednego są w KOMENTARZACH**, bo to repozytorium o tych wzorcach pisze (np.
`src/lib/ci/unknownCasts.ts:4`: „…tak samo skutecznie jak `as any`"). Licznik, który nie wygasza
komentarzy, mierzy tu dyscyplinę opisową, nie dług. W plikach testowych `as any` jest **3**,
a `as unknown as` **654** — i to jest zgodne z regułą repo, która dopuszcza `any` wyłącznie
w testach.

---

## 2. Pokrycie per moduł — tabela główna

Sortowanie: po pokryciu linii, rosnąco (najsłabsze na górze).
`T/P` = pliki testowe / pliki produkcyjne w module. `0%` = pliki produkcyjne bez ani jednej wykonanej linii.

| #   | Moduł                                                 | Pliki prod. | Instrukcje | Gałęzie | Funkcje |      Linie | Plików 0% |   T/P | Testów | Asercji |
| --- | ----------------------------------------------------- | ----------: | ---------: | ------: | ------: | ---------: | --------: | ----: | -----: | ------: |
| 21  | Rekrutacja / kariera                                  |          29 |     54,96% |  53,52% |  47,13% | **55,12%** |        12 | 0,379 |    171 |     374 |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    |         221 |     57,06% |  52,13% |  53,20% | **58,39%** |        27 | 0,335 |  1 240 |   2 708 |
| 20  | Platforma / backend / infrastruktura / SSR            |         209 |     78,29% |  67,77% |  72,39% | **79,45%** |        37 | 1,343 |  6 350 |  13 665 |
| —   | PRZEKROJOWE: design system (components/ui)            |          45 |     79,21% |  71,58% |  74,58% | **81,21%** |         4 | 0,044 |     17 |      37 |
| 10  | Sieć / networking                                     |          32 |     79,85% |  68,71% |  81,85% | **83,65%** |         3 | 0,719 |    349 |     642 |
| 1   | Wpisy: doświadczenie czytelnika                       |         104 |     82,89% |  75,13% |  82,10% | **84,65%** |        13 | 0,558 |  1 015 |   2 132 |
| 22  | Wydarzenia: event builder, rejestracja, onsite        |         366 |     85,46% |  81,29% |  86,87% | **86,95%** |        67 | 0,656 |  5 399 |  11 260 |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |         135 |     89,53% |  88,47% |  80,23% | **90,22%** |        14 | 0,407 |  1 390 |   2 685 |
| 4   | Strony, wygląd, motyw, media, import                  |         133 |     91,25% |  82,42% |  89,18% | **92,58%** |         4 | 0,552 |  1 245 |   2 154 |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |          44 |     90,74% |  85,67% |  90,12% | **92,63%** |         1 | 0,659 |    557 |   1 089 |
| 7   | Typy treści specjalne                                 |         105 |     91,73% |  86,57% |  85,75% | **93,02%** |         2 | 0,733 |  1 745 |   3 216 |
| —   | PRZEKROJOWE: słowniki i18n                            |         137 |     90,24% |  72,56% |  67,82% | **93,63%** |         1 | 0,051 |     74 |     169 |
| 17  | Analityka i BI                                        |          95 |     93,30% |  88,76% |  91,12% | **94,14%** |         2 | 0,695 |  1 915 |   4 548 |
| 3   | Silniki treści: bloki + page builder                  |         466 |     92,75% |  86,94% |  92,61% | **94,46%** |         1 | 0,707 |  5 755 |  10 727 |
| 5   | Strona główna, archiwa, chrome                        |          63 |     94,77% |  82,12% |  93,55% | **96,46%** |         0 | 0,476 |    569 |     962 |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |         190 |     95,56% |  91,32% |  96,35% | **96,57%** |         3 | 0,711 |  2 924 |   5 785 |
| 8   | SEO, feedy, dane strukturalne                         |          80 |     96,52% |  93,58% |  95,89% | **96,92%** |         5 | 0,875 |  1 363 |   2 991 |
| 6   | Wyszukiwarka                                          |          25 |     96,66% |  89,91% |  95,24% | **97,38%** |         0 | 0,840 |    528 |     839 |
| 9   | Czat / komunikator                                    |          84 |     95,24% |  88,65% |  95,56% | **97,55%** |         0 | 0,726 |  1 345 |   2 786 |
| 15  | Profil i konto                                        |          94 |     96,65% |  93,96% |  94,81% | **97,64%** |         2 | 0,766 |  2 011 |   4 099 |
| 12  | Realtime / powiadomienia / web-push                   |          31 |     96,96% |  92,19% |  97,13% | **98,04%** |         0 | 1,161 |    591 |   1 211 |
| 18  | CRM                                                   |          59 |     98,10% |  86,29% |  98,60% | **99,03%** |         0 | 0,576 |    723 |   1 271 |
| 2   | Edytor wpisów i workflow redakcyjny                   |         103 |     98,81% |  94,71% |  98,73% | **99,35%** |         0 | 0,854 |  1 576 |   2 928 |
| 11  | Newsletter i e-mail                                   |         148 |     98,89% |  95,05% |  99,43% | **99,53%** |         0 | 0,797 |  2 786 |   5 951 |
| 16  | Społeczność: kluby, komentarze, moderacja             |         306 |     99,39% |  97,74% |  99,82% | **99,84%** |         0 | 0,696 |  5 521 |  11 303 |

### 2.1 Zmiana od wydania 8 — pięć kampanii domkniętych, jeden moduł w dół, jeden nieruchomy od dziewięciu pomiarów

Poprzedni pomiar (wydanie 8, 2026-08-31, HEAD `8e771b983`) obejmował 2 010 plików testowych
i 3 260 plików produkcyjnych. Ten obejmuje **2 218 i 3 304** — czyli w oknie dwóch dni doszło
**208 plików testowych** i 44 pliki produkcyjne. Taka proporcja (4,7 nowego testu na jeden nowy
plik produkcyjny) sama tłumaczy sześciopunktowy skok globalny.

**Mapa modułów w tym wydaniu SIĘ NIE ZMIENIŁA, więc kolumny „wyd. 8” są przepisane wprost.**
Delty niżej mierzą wyłącznie pracę testową. Reguły mapowania: rozdział 9.1.

| #   | Moduł                                                 | Linie wyd. 8 | Linie wyd. 9 |       Δ linie | Funkcje wyd. 8 | Funkcje wyd. 9 | Δ funkcje | Plików 0% |
| --- | ----------------------------------------------------- | -----------: | -----------: | ------------: | -------------: | -------------: | --------: | --------: |
| 17  | Analityka i BI                                        |       32,88% |       94,14% | **+61,26 pp** |         28,41% |         91,12% |    +62,71 |    47 → 2 |
| 7   | Typy treści specjalne                                 |       43,93% |       93,02% | **+49,09 pp** |         36,73% |         85,75% |    +49,02 |    37 → 2 |
| 12  | Realtime / powiadomienia / web-push                   |       49,54% |       98,04% | **+48,51 pp** |         47,46% |         97,13% |    +49,67 |    12 → 0 |
| 9   | Czat / komunikator                                    |       62,83% |       97,55% | **+34,72 pp** |         58,02% |         95,56% |    +37,54 |    14 → 0 |
| 16  | Społeczność: kluby, komentarze, moderacja             |       89,12% |       99,84% | **+10,72 pp** |         89,02% |         99,82% |    +10,80 |    16 → 0 |
| 20  | Platforma / backend / infrastruktura / SSR            |       75,83% |       79,45% |  **+3,62 pp** |         68,65% |         72,39% |     +3,74 |   45 → 37 |
| 22  | Wydarzenia: event builder, rejestracja, onsite        |       84,78% |       86,95% |  **+2,18 pp** |         84,62% |         86,87% |     +2,25 |   72 → 67 |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    |       57,34% |       58,39% |  **+1,05 pp** |         52,16% |         53,20% |     +1,04 |   30 → 27 |
| —   | PRZEKROJOWE: słowniki i18n                            |       93,17% |       93,63% |  **+0,46 pp** |         61,62% |         67,82% |     +6,20 |     1 → 1 |
| 4   | Strony, wygląd, motyw, media, import                  |       92,32% |       92,58% |  **+0,26 pp** |         88,89% |         89,18% |     +0,29 |     4 → 4 |
| 8   | SEO, feedy, dane strukturalne                         |       96,67% |       96,92% |  **+0,25 pp** |         95,65% |         95,89% |     +0,24 |     5 → 5 |
| 3   | Silniki treści: bloki + page builder                  |       94,30% |       94,46% |  **+0,16 pp** |         92,61% |         92,61% |     +0,00 |     2 → 1 |
| —   | PRZEKROJOWE: design system (components/ui)            |       81,11% |       81,21% |  **+0,10 pp** |         74,36% |         74,58% |     +0,22 |     4 → 4 |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |       96,53% |       96,57% |  **+0,04 pp** |         96,28% |         96,35% |     +0,07 |     3 → 3 |
| 18  | CRM                                                   |       99,03% |       99,03% |  **+0,00 pp** |         98,60% |         98,60% |     +0,00 |     0 → 0 |
| 10  | Sieć / networking                                     |       83,65% |       83,65% |  **+0,00 pp** |         81,85% |         81,85% |     +0,00 |     3 → 3 |
| 11  | Newsletter i e-mail                                   |       99,53% |       99,53% |  **+0,00 pp** |         99,43% |         99,43% |     +0,00 |     0 → 0 |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |       92,63% |       92,63% |  **+0,00 pp** |         90,12% |         90,12% |     +0,00 |     1 → 1 |
| 15  | Profil i konto                                        |       97,64% |       97,64% |  **+0,00 pp** |         94,81% |         94,81% |     +0,00 |     2 → 2 |
| 21  | Rekrutacja / kariera                                  |       55,12% |       55,12% |  **+0,00 pp** |         47,13% |         47,13% |     +0,00 |   12 → 12 |
| 2   | Edytor wpisów i workflow redakcyjny                   |       99,35% |       99,35% |  **+0,00 pp** |         98,85% |         98,73% |     −0,12 |     0 → 0 |
| 6   | Wyszukiwarka                                          |       97,38% |       97,38% |  **+0,00 pp** |         95,24% |         95,24% |     +0,00 |     0 → 0 |
| 5   | Strona główna, archiwa, chrome                        |       96,47% |       96,46% |  **−0,00 pp** |         93,49% |         93,55% |     +0,07 |     1 → 0 |
| 1   | Wpisy: doświadczenie czytelnika                       |       84,67% |       84,65% |  **−0,02 pp** |         82,12% |         82,10% |     −0,03 |   13 → 13 |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |       93,36% |       90,22% |  **−3,14 pp** |         90,21% |         80,23% |     −9,99 |   14 → 14 |

**Rozkład ruchu jest skrajnie nierówny i to jest najważniejsza rzecz do odczytania z tej tabeli.**
Czternaście modułów poszło w górę, dziewięć stoi w miejscu z dokładnością do 0,005 pp, dwa spadły.
Ale z sumy +6,63 pp globalnych **pięć modułów odpowiada za praktycznie wszystko**: 17, 7, 12, 9
i 16 dorzuciły od +10,7 do +61,3 pp każdy. Pozostałe dwadzieścia jednostek pomiarowych razem
przesunęły igłę o mniej niż punkt.

**Pięć kampanii, pięć promptów, pięć domknięć — i to nie jest zbieg okoliczności.** Każdy z tych
pięciu modułów dostał w tym oknie imienny prompt modułowy z tego audytu, a każdy prompt zawierał
tę samą klauzulę: nie zmieniasz zachowania produkcyjnego, żeby test przeszedł; defekt idzie do
rejestru `it.fails`; progi wolno wyłącznie podnosić; nie wykluczasz plików z pomiaru. Efekt
liczbowy: **zera w tych pięciu modułach spadły z 126 na 4** (17: 47 → 2, 7: 37 → 2, 12: 12 → 0,
9: 14 → 0, 16: 16 → 0), a globalnie z **338 na 198**. Innymi słowy: 122 ze 140 zamkniętych zer
pochodzi z pięciu zamówionych powierzchni.

**Największa pojedyncza zmiana w całej serii dziewięciu wydań: moduł 17 (analityka i BI),
32,88% → 94,14% linii i 28,41% → 91,12% funkcji.** To moduł, który w wydaniu 8 był
najsłabszy w repozytorium i który przez trzy wydania z rzędu opisywałem jako „powierzchnia,
gdzie test nie dotarł wcale”. Kampania przywiozła 50 nowych plików testowych; T/P skoczyło
z 0,221 na 0,695, a liczba asercji z 442 na 4 548 — dziesięciokrotnie. Podnoszę to osobno,
bo pokazuje, że próg 0,2 T/P nie jest właściwością modułu, tylko stanem, w którym się go zostawiło.

**Jedyny prawdziwy spadek: moduł 19 (ustawienia / integracje / users / multi-tenant / RODO),
93,36% → 90,22% linii i 90,21% → 80,23% funkcji.** Spadek funkcji jest trzykrotnie większy niż
spadek linii i to jest sygnatura, nie szum: render przechodził, interakcje nie. Przyczyna nie leży
w module 19 — leży w `src/components/admin/settings/fields.tsx`, gdzie commit `d1861e84b` zamienił
literały paska zapisu na klucze i18n, przez co 188 testów w `adminSettingsRoutes.test.tsx` czeka
pięć sekund na przycisk, który nigdy nie pojawi się pod starą nazwą. Rozbiór: rozdział 12.2.
Drugi „spadek”, moduł 1 (−0,02 pp), to dylucja mianownika, nie regres — nie komentuję go dalej.

**MODUŁ 21 (rekrutacja / kariera) stoi na 55,12% linii w DZIEWIĄTYM pomiarze z rzędu.** Nie „około
55%” — dokładnie ta sama liczba, od wydania 1 do wydania 9, przez osiem kolejnych okien pracy.
Wszystkie inne moduły ruszyły przynajmniej raz; ten nie ruszył ani o 0,01 pp. Po tym, jak moduł 17
opuścił dno, jest to **najniższy wynik w całym repozytorium** — i jedyny moduł numerowany pod 60%
linii; niżej od 60% stoi jeszcze tylko powierzchnia przekrojowa X-shell (58,39%), a więc wyżej
niż moduł 21. Jest też jedynym, o którym mogę powiedzieć, że jego stan nie wynika z trudności,
tylko z tego, że nikt go nie zamówił — i że nie ma w repozytorium mechanizmu, który by o tym
powiedział. Osiem wydań temu pisałem o nim jedno zdanie; dziś dostaje własny rozbiór
w rozdziale 12.8, bo dziewięć identycznych pomiarów to już nie zaległość, to wzorzec.

**Kontrola, której to wydanie wymagało bardziej niż poprzednie: czy pięć kampanii naraz nie
zepsuło jakości testów.** Odpowiedź jest w rozdziale 8.3 i jest twierdząca w jedną stronę
(gęstość asercji nie spadła, a wzrosła: 95 700 asercji na 47 230 miejsc `it/test`, czyli **2,026**
na przypadek, wobec 81 995 / 41 104 = **1,995** w wydaniu 8) i przecząca w drugą — bo w tym samym oknie **25 z 194 commitów nie-merge
ruszyło kod produkcyjny i ZERO plików testowych**, co dało siedem z ośmiu dzisiejszych czerwieni.
Kampanie nie obniżyły jakości tego, co dopisały. Obniżył ją ruch, który przeszedł obok nich.

**Definicja okna, bo bez niej liczba commitów jest sporna.** „194 commity nie-merge" to zakres
`8e771b983..d737e1329`, czyli dokładnie to, co weszło MIĘDZY dwoma pomiarami. Liczone inaczej —
`git log --no-merges --since=2026-08-31` — wychodzi **302**, i ta liczba też jest poprawna, tylko
odpowiada na inne pytanie: 108 z tych commitów ma datę autora po 2026-08-31, ale jest już
przodkami `8e771b983`, więc **siedzą w pomiarze wydania 8**. Kontrola arytmetyczna: 194 + 108 = 302.
W całym dokumencie używam wyłącznie zakresu między pomiarami; z merge'ami ten zakres liczy 222
commity, a 159 ze 194 nie-merge dotyka `src/`.

### 2.2 Wymiar „funkcje”: ile funkcji w module zostało kiedykolwiek wywołane

To najostrzejsza z czterech metryk: liczy KAŻDĄ funkcję (również strzałkowe callbacki i handlery),
a „pokryta” znaczy „wywołana co najmniej raz”. Moduł z 20% funkcji ma cztery piąte swoich zachowań
nigdy nie uruchomione w teście.

| #   | Moduł                                                 | Funkcji razem | Wywołanych |  % funkcji |
| --- | ----------------------------------------------------- | ------------: | ---------: | ---------: |
| 21  | Rekrutacja / kariera                                  |           348 |        164 | **47,13%** |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    |         1 923 |      1 023 | **53,20%** |
| —   | PRZEKROJOWE: słowniki i18n                            |           202 |        137 | **67,82%** |
| 20  | Platforma / backend / infrastruktura / SSR            |         2 173 |      1 573 | **72,39%** |
| —   | PRZEKROJOWE: design system (components/ui)            |           236 |        176 | **74,58%** |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |         1 502 |      1 205 | **80,23%** |
| 10  | Sieć / networking                                     |           303 |        248 | **81,85%** |
| 1   | Wpisy: doświadczenie czytelnika                       |           687 |        564 | **82,10%** |
| 7   | Typy treści specjalne                                 |         1 607 |      1 378 | **85,75%** |
| 22  | Wydarzenia: event builder, rejestracja, onsite        |         3 945 |      3 427 | **86,87%** |
| 4   | Strony, wygląd, motyw, media, import                  |         1 007 |        898 | **89,18%** |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |           334 |        301 | **90,12%** |
| 17  | Analityka i BI                                        |         1 013 |        923 | **91,12%** |
| 3   | Silniki treści: bloki + page builder                  |         6 901 |      6 391 | **92,61%** |
| 5   | Strona główna, archiwa, chrome                        |           574 |        537 | **93,55%** |
| 15  | Profil i konto                                        |         1 098 |      1 041 | **94,81%** |
| 6   | Wyszukiwarka                                          |           294 |        280 | **95,24%** |
| 9   | Czat / komunikator                                    |         1 082 |      1 034 | **95,56%** |
| 8   | SEO, feedy, dane strukturalne                         |           511 |        490 | **95,89%** |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |         1 452 |      1 399 | **96,35%** |
| 12  | Realtime / powiadomienia / web-push                   |           383 |        372 | **97,13%** |
| 18  | CRM                                                   |         1 073 |      1 058 | **98,60%** |
| 2   | Edytor wpisów i workflow redakcyjny                   |           868 |        857 | **98,73%** |
| 11  | Newsletter i e-mail                                   |         1 572 |      1 563 | **99,43%** |
| 16  | Społeczność: kluby, komentarze, moderacja             |         3 362 |      3 356 | **99,82%** |

---

## 3. Pokrycie per funkcjonalność (141 funkcjonalności w 22 modułach)

Każdy wiersz to FUNKCJA PRODUKTU, nie katalog: lista plików ją realizujących jest zdefiniowana
wzorcami ścieżek. Kolumna „fn” to funkcje wywołane / wszystkie funkcje w plikach tej funkcjonalności.

### MODUŁ 1 — Wpisy: doświadczenie czytelnika · linie 84,65% · funkcje 82,10%

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
| Edytor wpisu (panele)           |     68 |      1 077 |  98,8% |  95,5% |   99,1% |  **99,4%** |   422/426 |
| Workflow draft→review→published |     10 |        214 |  99,1% |  95,6% |   99,0% |  **99,5%** |     96/97 |
| Autozapis wpisu                 |      3 |         85 | 100,0% |  96,0% |  100,0% | **100,0%** |     20/20 |
| Obecność edytorska (presence)   |      2 |          6 | 100,0% | 100,0% |  100,0% | **100,0%** |       3/3 |

### MODUŁ 3 — Silniki treści: bloki + page builder · linie 94,46% · funkcje 92,61%

**Rodzaje testów:** komponentowy 156 · jednostkowy 141 · hooka 13 · dostępności 5 · parytetu 10 · bramki 3 · funkcji serwerowej 1 · dymny 1.

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

### MODUŁ 4 — Strony, wygląd, motyw, media, import · linie 92,58% · funkcje 89,18%

**Rodzaje testów:** komponentowy 31 · jednostkowy 26 · hooka 11 · warstwy danych 4 · funkcji serwerowej 1 · dostępności 1.

**Co tu decyduje:** połowa ryzyka to **czysta matematyka** (kadrowanie obrazu, tokeny motywu, kontrast etykiet) — tam test jednostkowy jest najtańszym dowodem o największym zasięgu; druga połowa to **testy hooków** panelu mediów (mutacje, zaznaczanie, skróty klawiszowe), gdzie liczy się kolejność zdarzeń i wycofanie po błędzie.

**Bez tego rodzaju przechodzi taki defekt:** kadr zapisuje się z zamienionymi osiami i wszystkie miniatury w archiwum są przycięte w złym miejscu. Dla plików już przetworzonych błąd jest nieodwracalny — nie ma z czego odtworzyć oryginalnego kadru.

| Funkcjonalność                  | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |      Linie | fn (szt.) |
| ------------------------------- | -----: | ---------: | -----: | ----: | ------: | ---------: | --------: |
| Ikony / marka                   |      7 |        149 |  79,6% | 72,6% |   73,0% |  **80,5%** |     27/37 |
| Media: upload, crop, biblioteka |     41 |      1 418 |  97,6% | 90,5% |   96,4% |  **99,0%** |   348/361 |
| Motyw / wygląd / global colors  |     52 |        630 |  98,2% | 91,5% |   97,5% |  **99,0%** |   193/198 |
| Szablony stron i archiwów       |      6 |        111 |  99,2% | 93,8% |  100,0% | **100,0%** |     63/63 |

### MODUŁ 5 — Strona główna, archiwa, chrome · linie 96,46% · funkcje 93,55%

**Rodzaje testów:** komponentowy 13 · jednostkowy 12 · warstwy danych 3 · parytetu 1 · dostępności 1.

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

### MODUŁ 7 — Typy treści specjalne · linie 93,02% · funkcje 85,75%

**Rodzaje testów:** dostępności 19 · komponentowy 28 · jednostkowy 22 · hooka 2 · warstwy danych 3 · funkcji serwerowej 1 · dymny 2.

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

### MODUŁ 8 — SEO, feedy, dane strukturalne · linie 96,92% · funkcje 95,89%

**Rodzaje testów:** jednostkowy 50 · dostępności 8 · funkcji serwerowej 4 · hooka 2 · warstwy danych 1 · komponentowy 5.

**Co tu decyduje:** tu **e2e jest niezastępowalne**: JSON-LD, hreflang i sitemapy dowodzi się bajtami, które wyszły z SSR, a nie wywołaniem funkcji budującej `<head>`. Testy jednostkowe (35 plików) pilnują kształtu danych, `e2e/seo.spec.ts` pilnuje tego, co widzi robot.

**Bez tego rodzaju przechodzi taki defekt:** funkcja budująca `<head>` zwraca poprawny JSON-LD, a SSR go nie emituje albo emituje dwa razy. Test jednostkowy nie widzi bajtów, które wyszły z serwera — a robot widzi wyłącznie je.

| Funkcjonalność               | Plików | LOC mierz. | Instr. |   Gał. | Funkcje |      Linie | fn (szt.) |
| ---------------------------- | -----: | ---------: | -----: | -----: | ------: | ---------: | --------: |
| Feedy i sitemapy             |      8 |        130 |  60,4% |  40,6% |   37,5% |  **61,5%** |      9/24 |
| SEO: meta, JSON-LD, hreflang |     46 |      1 397 |  98,8% |  96,4% |   99,0% |  **99,3%** |   296/299 |
| Udostępnianie / OG           |      5 |        216 |  99,2% |  98,4% |  100,0% | **100,0%** |     65/65 |
| Monitor linków               |      2 |         18 | 100,0% | 100,0% |  100,0% | **100,0%** |       8/8 |

### MODUŁ 9 — Czat / komunikator · linie 97,55% · funkcje 95,56%

**Rodzaje testów:** komponentowy 27 · jednostkowy 20 · hooka 12 · dostępności 1 · warstwy danych 1.

**Co tu decyduje:** wzorcowa mieszanka po refaktorze: **test warstwy danych z atrapą łańcucha PostgREST** (kształt zapytania), **test hooka** (kolejność wiadomości, deduplikacja optymistyczna) i **test jednostkowy reguł wątku**. To ten zestaw, nie sam wzrost liczby testów, wyciągnął moduł z 17% na poziom z progami per plik.

**Bez tego rodzaju przechodzi taki defekt:** zapytanie o wiadomości gubi filtr rozmowy. RLS je odrzuci, więc objawem nie będzie wyciek, ale pusty czat u wszystkich — i wyjdzie to dopiero na produkcji, bo w teście bez atrapy łańcucha nikt nie sprawdził kształtu zapytania.

| Funkcjonalność                                  | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |      Linie | fn (szt.) |
| ----------------------------------------------- | -----: | ---------: | -----: | ----: | ------: | ---------: | --------: |
| Czat: okno rozmowy i atomy UI                   |     35 |      1 507 |  45,2% | 38,7% |   40,7% |  **46,2%** |   212/521 |
| Czat: kompozytor + wzmianki                     |     10 |        229 |  81,6% | 68,8% |   77,2% |  **84,3%** |     44/57 |
| Czat: warstwa danych (rozmowy, wiadomości)      |      3 |        374 |  92,3% | 83,3% |   95,6% |  **97,6%** |   130/136 |
| Czat: reguły wątku (kolejność, separator, skok) |      5 |        159 |  99,5% | 98,5% |   97,5% | **100,0%** |     39/40 |

> **ZASTRZEŻENIE DO TABELI (dopisane 2026-09-01, wydanie 9): wiersz „Czat: kompozytor + wzmianki" NIE OPISUJE KOMPOZYTORA CZATU.**
>
> Zakres tego wiersza to `src/lib/composer/`, `src/components/composer/`, `src/lib/mentions/`, `src/components/mentions/` - dziesięć plików, 229 LOC. **Ani jeden z nich nie jest używany przez czat.** Zweryfikowane na tym HEAD:
>
> - `grep -rln "mention" src/components/chat src/lib/chat` nie zwraca nic - czat nie ma wzmianek;
> - `src/components/chat/ChatComposer.tsx` (606 linii źródła) nie importuje niczego z tych czterech katalogów;
> - `ComposerShell.tsx` konsumują `components/comments/CommentComposerShell.tsx` i `components/forms/MessageComposerField.tsx`;
> - `MentionTextarea.tsx` - komentarze (`CommentsSection.tsx`, `CommentComposerShell.tsx`) i dwie trasy klubów;
> - `useMentionAutocomplete` - `components/forms/MessageComposerField.tsx`;
> - `useMentionProfile` - `components/clubs/atoms/ClubInlineText.tsx`.
>
> Wynik 84,3% opisuje więc kompozytor KOMENTARZY, FORMULARZY i KLUBÓW, a nie czatu. Prawdziwy kompozytor czatu to `ChatComposer.tsx`, który w wydaniu 8 stał na **0/160 linii i 0/40 funkcji** - największym pojedynczym zerze całego modułu - i był ukryty w wierszu „okno rozmowy i atomy UI".
>
> **Dlaczego zostawiamy to jako zastrzeżenie, a nie poprawiamy definicji funkcjonalności.** Ujednolicenie kompozytorów (przepisanie czatu na `ComposerShell`, dołożenie wzmianek do czatu) byłoby ZMIANĄ PRODUKTOWĄ pod test, a nie poprawą pomiaru - i jako taka wymaga własnej decyzji, nie commitu w pracy nad pokryciem. Do czasu tej decyzji tabelę czyta się z tym zastrzeżeniem, a wiersz „kompozytor + wzmianki" traktuje jako **infrastrukturę komentarzy i klubów mierzoną wewnątrz modułu 09**.

#### MODUŁ 9 — WYDANIE 9 (2026-09-01) · linie 62,83% → **97,25%** · funkcje 58,02% → **95,47%**

**Rodzaje testów dołożone w tym wydaniu:** komponentowy 14 · jednostkowy 5 · hooka 3 · trasy 2 (pierwsze w module) · bramki 1 · dostępności 1 (pierwszy w module). Razem 26 nowych plików testowych, +14 068 linii, plus rozszerzenie uprzęży wykonawczej RLS z 62 na 126 asercji.

**Pomiar:** `vitest run --coverage` na PEŁNEJ suicie, `all: true`, zakres modułu dokładnie taki, jak w tabeli zakresów niżej. Kolumna „wyd. 8" to liczby z tabeli wyżej.

**MODUŁ 09 RAZEM** - 83 pliki (81 w wydaniu 8; przybyły dwa moduły reguł wyprowadzone z kompozytora), 3 304 mierzone linie:

| Metryka    | Wydanie 8 |  Wydanie 9 |          Δ | Cel zlecenia |    Zapas |
| ---------- | --------: | ---------: | ---------: | -----------: | -------: |
| Linie      |    62,83% | **97,25%** | ↑ +34,4 pp |        ≥ 78% | +19,3 pp |
| Funkcje    |    58,02% | **95,47%** | ↑ +37,5 pp |        ≥ 75% | +20,5 pp |
| Gałęzie    |    51,74% | **88,36%** | ↑ +36,6 pp |        ≥ 65% | +23,4 pp |
| Instrukcje |    61,33% | **94,98%** | ↑ +33,7 pp |            - |        - |

W liczbach bezwzględnych: linie 3 213/3 304, funkcje 1 032/1 081, gałęzie 2 923/3 308. **Zero plików modułu stoi na zerowym pokryciu linii** (w wydaniu 8 było ich szesnaście, w tym dwanaście dialogów i paneli interfejsu oraz obie trasy).

**CZTERY FUNKCJONALNOŚCI** - zakresy plików identyczne, co w tabeli wydania 8 wyżej:

| Funkcjonalność                                  | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |      Linie | fn (szt.) | Linie wyd. 8 |    Δ linie |
| ----------------------------------------------- | -----: | ---------: | -----: | ----: | ------: | ---------: | --------: | -----------: | ---------: |
| Czat: okno rozmowy i atomy UI                   |     35 |      1 490 |  96,9% | 90,8% |   96,7% |  **98,3%** |   502/519 |        46,2% | ↑ +52,1 pp |
| Czat: kompozytor + wzmianki                     |     10 |        229 |  81,6% | 68,8% |   77,2% |  **84,3%** |     44/57 |        84,3% |  bez zmian |
| Czat: warstwa danych (rozmowy, wiadomości)      |      3 |        374 |  92,6% | 83,6% |   95,6% |  **97,6%** |   130/136 |        97,6% |  bez zmian |
| Czat: reguły wątku (kolejność, separator, skok) |      5 |        155 |  99,5% | 98,1% |  100,0% | **100,0%** |     42/42 |       100,0% |  bez zmian |

**Wiersz „kompozytor + wzmianki" stoi w miejscu CELOWO** - i to jest dowód zastrzeżenia z poprzedniej sekcji, a nie przeoczenie. Te dziesięć plików nie ma z czatem nic wspólnego, więc praca nad czatem nie mogła ich ruszyć. Prawdziwy kompozytor czatu siedzi w wierszu „okno rozmowy i atomy UI" i to on odpowiada za +52,1 pp: `ChatComposer.tsx` przeszedł **z 0/160 linii i 0/40 funkcji na 152/155 linii i 38/40 funkcji**.

**Cele szczegółowe zlecenia - wynik:**

| Cel                                 |    Wymóg | Pomiar wydania 9                |
| ----------------------------------- | -------: | ------------------------------- |
| „okno rozmowy i atomy UI" - linie   |    ≥ 75% | **98,3%**                       |
| „okno rozmowy i atomy UI" - funkcje |    ≥ 70% | **96,7%**                       |
| „okno rozmowy i atomy UI" - gałęzie |    ≥ 60% | **90,8%**                       |
| `routes/messages.tsx`               | ≥ 60/55% | **91,8% linii / 85,7% funkcji** |
| `routes/admin.community.chat.tsx`   | ≥ 70/65% | **91,3% linii / 84,0% funkcji** |
| `lib/chat/voice.ts`                 | ≥ 70/70% | **100% linii / 100% funkcji**   |
| `lib/chat/usePeopleDirectory.ts`    | ≥ 70/70% | **100% linii / 100% funkcji**   |
| `lib/chat/useIncomingChatToasts.ts` | ≥ 70/70% | **93,0% linii / 88,9% funkcji** |
| `AttachmentContent.tsx` - gałęzie   |    ≥ 55% | **83,6%**                       |
| `DemoBotChat.tsx` - gałęzie         |    ≥ 65% | **94,3%**                       |
| `ChatWindow.tsx` - funkcje          |    ≥ 85% | **100,0% (73/73)**              |

**Pomiar wykonano na ZIELONEJ suicie w sensie tej pracy:** `vitest run --coverage`, 2 055 plików testowych, 55 456 testów zielonych, 279 `it.fails`, **6 czerwonych testów w 5 plikach - wszystkie zastane, reprodukowane co do jednego na `origin/main`** w osobnym worktree (`router.test.tsx`, `authzSnapshotParity`, `migrationReplay` ×2, `serviceRoleTenantScope`, `AdminMonetizationLedger`). Żaden z nich nie leży w module 09 i żaden nie został naprawiony ani wyciszony - snapshot autoryzacji w szczególności NIE był regenerowany.

**Bramki `check:*` po tej pracy:** trzydzieści zielonych. Cztery czerwone (`check:authz-snapshot`, `check:permissions-parity`, `check:sql-migration-replay`, `check:i18n-parity`) sprowadzają się do tych samych dwóch zastanych plików - same reguły i18n przechodzą w komplecie (48 plików). Dwie (`check:db-contract`, `check:migration-ledger`) wymagają poświadczeń Supabase, niedostępnych w tym środowisku.

**Jedyny ślad tej pracy poza testami - i jest mierzalny.** `check:bundle` jest czerwony NA `origin/main`: całość 4 320,9 KB gzip przy budżecie 4 306 KB, czyli przekroczenie o 14,9 KB pochodzące spoza czatu (`i18n` +129 KB, `EventStudioModuleSections` +65,5 KB, `useEventSessions` +31,1 KB, `scanner` +15,3 KB względem baseline'u z 2026-08-15). Po tej pracy jest 4 321,5 KB, czyli **+0,6 KB gzip** - koszt dwóch modułów reguł przekraczających granicę chunku. Sprawdzone tym samym buildem na obu drzewach. Świadomie nie podnoszę tu budżetu: przekroczenie nie jest tej pracy, a 0,6 KB to cena, którą płaci się za możliwość testowania decyzji kompozytora bez pełnego renderu z atrapą `MediaRecorder`.

**Co zmieniło się względem wydania 8.** Wydanie 8 opisywało moduł jako „wzorcową mieszankę po refaktorze" - i miało rację co do WARSTWY DANYCH (97,6% linii, 130 ze 136 funkcji, jedenaście polityk na `messages`). Całe ryzyko siedziało gdzie indziej: w 35 plikach interfejsu, z których **dwanaście nie zostało nigdy wyrenderowane w teście**, oraz w dwóch trasach na czystym zerze - skrzynce `/messages` (687 linii źródła) i panelu moderacji `/admin/community/chat` z operacjami niszczącymi.

**Co decyduje w wydaniu 9:** trzy rodzaje dowodu, których moduł wcześniej nie miał wcale.

1. **Ekstrakcja reguł przed asercjami.** `ChatComposer.tsx` (606 linii, 0/160 linii pokrycia) nie miał ANI JEDNEJ funkcji modułowej, więc żadnej jego decyzji nie dało się sprawdzić bez pełnego renderu z sesją, tenantem, kanałem realtime i atrapą `MediaRecorder`. Reguły wyprowadzone do `lib/chat/composerRules.ts` i `lib/chat/attachmentPresentation.ts` mają dziś testy jednostkowe, a render dowodzi wyłącznie SKLEJENIA. Ekstrakcja jest wierna co do gałęzi - nie jest zmianą zachowania pod test.
2. **Test trasy** (`@/test/routeHarness`) - pierwszy w module. Dowodzi tego, czego test komponentu nie dotyka: kontraktu adresu (`?c=`, `?view=`), nagłówka (`noindex, nofollow`), `ssr: false` i bramek widoczności (AuthGate, moduł czatu wyłączony przez administratora, zakładka zarezerwowana dla ekspertów).
3. **Bramka kontraktu polityk RLS** (`src/lib/ci/__tests__/chatPolicyContract.test.ts`) - stan końcowy polityk czytany z forward-only migracji przez `extractLatestPolicies` - **oraz jej wykonawczy kontrapunkt**: uprząż `scripts/tenant-isolation-harness` rozszerzona z 62 na 126 asercji, która zakłada polityki płaszczyzny czatu na prawdziwym Postgresie i próbuje przez nie czytać oraz pisać jako trzy różne osoby z dwóch obszarów roboczych. Odpowiadają na trzy pytania, które wydanie 8 zostawiło otwarte (patrz „Trzy ustalenia" niżej) - i rozjazd między nimi wykrył ograniczenie samej analizy statycznej, opisane w ustaleniu 1.

**Bez tego rodzaju przechodzi taki defekt:** dokładnie te, które ta praca znalazła. Jedenaście pozycji zapisanych jako `it.fails` z opisem złamanego i oczekiwanego kontraktu - m.in. **martwa gałąź „Wysyłanie…"** w stopce listy (`lastMine` filtruje `!pending`, a stopka pyta `lastMine?.pending`, więc warunek nigdy nie jest prawdziwy), **martwa pozycja menu „Dodaj reakcję"** w dymku (menu Radiksa zamyka świeżo otwarty popover), **historia mediów** przekazująca do podglądu galerię JEDNOELEMENTOWĄ wbrew własnemu opisowi w nagłówku pliku, **wyszukiwarka rozmówców** myląca ODMOWĘ serwera z brakiem kontaktów, **przycisk kasujący kaskadowo rozmowę bez nazwy dostępnej** w panelu moderacji oraz **potwierdzenia doręczenia niewidoczne dla czytnika ekranu** (`aria-label` na `<span>` bez roli - ARIA tego zabrania, więc etykieta jest ignorowana).

**Trzy ustalenia o politykach RLS** (przypięte bramką, bez zmiany schematu w tej pracy):

1. **Czy prośba ekspercka przecina obszary robocze? NIE - i polityki tego pilnują.** Jedyny pisarz tabeli, `send_expert_request`, czyta tenanta nadawcy i odbiorcy z `profiles` i odmawia, gdy się różnią; `INSERT` jest celowo `WITH CHECK false`, więc RPC jest jedyną drogą. Czytanie i zmiana też wiążą obszar roboczy: każda żywa polityka `expert_inmails` inna niż `INSERT` ma `tenant_id = current_tenant_id()`. **To ustalenie kosztowało jedną korektę własnej bramki i jest tu warte opisania**, bo pokazuje granicę analizy statycznej: `extractLatestPolicies` kluczuje politykę po nazwie tabeli WYCZYTANEJ Z TEKSTU migracji i nie rozumie `ALTER TABLE … RENAME`. Migracja `20260723180000` przemianowała `expert_inmails` na `expert_requests` i założyła tenant-ślepe polityki; `20260806160001` cofnęła nazwę („rename nigdy nie wjechał"), a `20260806185055` skasowała obie stare rodziny i założyła dzisiejsze, tenant-wiążące. DROP-y adresowane do `public.expert_inmails` nie trafiły w klucze założone jako `public.expert_requests`, więc tenant-ślepa rodzina **została w mapie jako duch** - i pierwsza wersja tej bramki wzięła ducha za stan bazy. Rozstrzygnęło wykonanie: rozszerzona uprząż `scripts/tenant-isolation-harness` zakłada te polityki na prawdziwym Postgresie i pokazuje, że wiersz dryfujący do obcego obszaru roboczego jest niewidoczny nawet dla własnego nadawcy. Bramka statyczna asertuje dziś niezmiennik wprost, a duchy przypina OSOBNYM przechodzącym testem opisanym jako ograniczenie parsera. Pułapka zostaje zastawiona na regresję: przywrócenie tenant-ślepych polityk wywala i bramkę, i uprząż.
2. **Czy dwa sposoby wyznaczania tenanta są równoważne? CO DO WARTOŚCI TAK.** `current_tenant_id()` to dosłownie `SELECT tenant_id FROM public.profiles WHERE id = auth.uid()`, czyli ta sama kwerenda, którą `user_blocks` ma wpisaną wprost w `WITH CHECK`. Różnica, która zostaje: funkcja jest SECURITY DEFINER i omija RLS na `profiles`, a podzapytanie biegnie jako wołający. Obie formy rozjadą się dokładnie wtedy, gdy `profiles` przestanie pozwalać czytać własny wiersz - i ten warunek jest teraz przypięty.
3. **Brak polityki INSERT na `conversations` i brak polityk zapisu na `conversation_participants` to DECYZJA**, nie luka: zapis idzie wyłącznie przez `get_or_create_direct_conversation` i `create_group_conversation`. Bramka pilnuje OBU połówek naraz (brak polityki zapisu ORAZ istnienie RPC), żeby nikt później nie „naprawił" tego dopisaniem polityki.

**Progi.** Oba globi modułu zostały zaciśnięte OSOBNYM commitem, przed napisaniem pierwszego testu - luz wynosił 4,8-5,8 pp, czyli przepuszczał regresję o rozmiarze całego pliku bez ani jednego czerwonego testu (`useConversations.ts` to 5,4 pp globu `src/lib/chat/**`). Po dobiciu pokrycia progi podniesiono DRUGI raz, tym razem do podłogi z pomiaru - luz poniżej 1 pp na każdej z czterech metryk:

| Glob                     |   Wydanie 8 | Po commicie 1 |       Wydanie 9 |
| ------------------------ | ----------: | ------------: | --------------: |
| `src/lib/chat/**`        | 74/80/77/67 |   79/85/82/72 | **95/97/98/89** |
| `src/components/chat/**` | 40/36/41/34 |   45/40/46/38 | **96/96/98/90** |

(kolejność: instrukcje / funkcje / linie / gałęzie)

Do tego **32 nowe progi per-plikowe**: szesnaście dla plików zdjętych z zera (dwanaście dialogów i paneli, dwa nowe moduły reguł, obie trasy) i szesnaście dla powierzchni, które audyt wskazał imiennie - atomy wiadomości i załącznika oraz reszta warstwy danych czatu. Liczba progów per-ścieżka w repo rośnie z **376 na 408**. (Wydanie 8 raportowało 373; na `origin/main` jest ich dziś 376 - liczba potwierdzona tytułem commita `85af2c6` „Audyt 376 progów pokrycia". Liczone kluczami obiektu `thresholds` w `vitest.config.ts`, bez duplikatów.) Osobno podniesiony `ChatWindow.tsx`: próg funkcji stał na **60** przy pomiarze 100% (73/73), czyli przepuszczał utratę trzynastu domknięć - menu kontekstowego, dialogów znikania, przekazywania i blokowania - bez ani jednego czerwonego testu.

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

### MODUŁ 12 — Realtime / powiadomienia / web-push · linie 98,04% · funkcje 97,13%

> **AKTUALIZACJA 2026-09-01:** liczby w tej sekcji to migawka wydania 8 i takie zostają.
> Kampania testowa modułu 12 zamknęła go na **98,03% linii / 92,14% gałęzi / 97,11% funkcji**.
> Pełny pomiar, delta i lista tego, czego NIE osiągnięto - rozdział 10 na końcu dokumentu.

**Rodzaje testów:** hooka 8 · jednostkowy 16 · dostępności 4 · funkcji serwerowej 5 · warstwy danych 2 · komponentowy 1.

**Co tu decyduje:** realtime wymaga **atrapy kanału** (`realtimeStub`): bez niej test dowodzi tylko, że subskrypcja została utworzona, a nie że przyjście zdarzenia zmienia stan. Powiadomienia i web-push to dodatkowo **testy funkcji serwerowych** — wysyłka jest efektem ubocznym, nie zwracaną wartością.

**Bez tego rodzaju przechodzi taki defekt:** test dowodzi, że subskrypcja kanału została utworzona, i przechodzi także wtedy, gdy handler zdarzenia jest pusty. Powiadomienia nie przychodzą, a suita jest zielona.

| Funkcjonalność              | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| --------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Powiadomienia + web-push    |     16 |        878 |  42,3% | 29,5% |   32,1% | **44,9%** |    80/249 |
| Realtime (kanały, presence) |     10 |        294 |  61,5% | 44,2% |   76,6% | **65,0%** |   105/137 |

### MODUŁ 13 — Monetyzacja: checkout / subskrypcje / billing · linie 96,57% · funkcje 96,35%

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

### MODUŁ 16 — Społeczność: kluby, komentarze, moderacja · linie 99,84% · funkcje 99,82%

**Rodzaje testów:** komponentowy 94 · jednostkowy 84 · dostępności 12 · hooka 8 · warstwy danych 4 · funkcji serwerowej 7 · bramki 3 · parytetu 1.

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

### MODUŁ 17 — Analityka i BI · linie 94,14% · funkcje 91,12%

**Rodzaje testów:** dostępności 19 · jednostkowy 31 · funkcji serwerowej 4 · warstwy danych 4 · komponentowy 5 · hooka 3.

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

| metryka         | wejście (`3eb5e92`) |            po kampanii |     delta | cel zlecenia |
| --------------- | ------------------: | ---------------------: | --------: | -----------: |
| linie           |  36,07% (1134/3144) | **96,24%** (3099/3220) | +60,17 pp |        ≥ 65% |
| instrukcje      |  35,31% (1283/3634) | **95,54%** (3556/3722) | +60,23 pp |            - |
| gałęzie         |   27,30% (917/3359) | **92,17%** (3145/3412) | +64,87 pp |        ≥ 52% |
| funkcje         |    31,18% (280/898) |   **95,96%** (878/915) | +64,78 pp |        ≥ 62% |
| plików na zerze |                  47 |                  **0** |       -47 |            - |

Plików w mianowniku: 89 (wejście) / 89 (po).

**Delta wobec WYDANIA 8, podana osobno i z zastrzeżeniem.** Zamówienie prosiło
o odniesienie do liczb wydania 8, więc je podaję - ale nie mieszam ich z tabelą
wyżej, bo mierzą inny stan wyjściowy: linie **32,88% -> 96,24% (+63,36 pp)**,
gałęzie **25,14% -> 92,17% (+67,03 pp)**, funkcje **28,41% -> 95,96% (+67,55 pp)**,
plików na zerze **47 -> 0**. Ta delta jest większa od zmierzonej przeze mnie
dokładnie o to, co między wydaniem 8 a startem kampanii dołożyli inni - w tym
pierwszy test reportera Core Web Vitals. Przypisywanie tej różnicy kampanii
byłoby zawyżeniem, dlatego liczbą wiążącą dla oceny TEJ pracy jest delta wobec
`3eb5e92`, a nie wobec wydania 8.

**Zakres zmian w kodzie produkcyjnym: DZIEWIĘĆ plików** w 16 commitach -
`lib/webVitals.ts`, `lib/observability/report.ts`,
`components/admin/analytics/{chartTheme.ts,EChartClient.tsx}`,
`lib/views/postViews.functions.ts`, `routes/api/public/{vitals,client-errors}.ts`,
`scripts/check-entry-purity.ts` i `scripts/lib/unknownCastBaseline.ts`.
`package.json` i `package-lock.json` nietknięte, `echarts` i `echarts-for-react`
ani dodane, ani usunięte. W całej kampanii zero `it.skip`, zero `it.todo`, zero
`any` i zero `as any` - sprawdzone grepem po całym diffie, nie po pamięci.

**Cztery funkcjonalności.** Ta sama reguła podziału po obu stronach pomiaru.

| Funkcjonalność                          | Plików | linie wejście |   linie po | gałęzie po |        funkcje po | cel (linie/fn/gał) |
| --------------------------------------- | -----: | ------------: | ---------: | ---------: | ----------------: | -----------------: |
| Analityka: zbieranie zdarzeń i liczniki |     21 |        15,68% | **85,63%** |     78,15% |  77,56% (121/156) |       70 / 65 / 55 |
| Wykresy i panel BI                      |     38 |        32,20% | **99,82%** |     95,90% | 100,00% (568/568) |       60 / 55 / 45 |
| Observability / RUM / web vitals        |     14 |        64,54% | **97,29%** |     93,48% |    97,78% (88/90) |       85 / 85 / 75 |
| Analityka: warstwa semantyczna          |     16 |        56,66% | **99,43%** |     95,79% | 100,00% (101/101) |       92 / 90 / 80 |

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

| wielkość                 | przed |  po |
| ------------------------ | ----: | --: |
| renderów wykresu         |    20 |  10 |
| rozwiązań motywu         |    20 |   2 |
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

| plik                                                 | wejście    | linie |      funkcje | gałęzie | przypadków |
| ---------------------------------------------------- | ---------- | ----: | -----------: | ------: | ---------: |
| `src/routes/admin.analytics.tsx`                     | 0/54, 0/27 |  100% | 100% (27/27) |  98,42% |         51 |
| `src/routes/admin.link-monitor.tsx`                  | 0/33, 0/7  |  100% |   100% (7/7) |  94,87% |         38 |
| `src/routes/admin.experiments.tsx`                   | 0/26, 0/8  |  100% |   100% (8/8) |    100% |         20 |
| `src/routes/admin.performance.tsx`                   | 0/8, 0/3   |  100% |   100% (3/3) |    100% |         12 |
| `src/components/admin/performance/EdgeCacheCard.tsx` | 0/43, 0/18 |  100% | 100% (18/18) |  94,83% |         21 |
| `src/lib/charts/geoQuery.ts`                         | 0/4, 0/1   |  100% |   100% (2/2) |    100% |         12 |
| `src/lib/tracker-admin.functions.ts`                 | 0/3, 0/1   |  100% |   100% (1/1) |       - |         10 |

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

| plik                                                                       | przypadek                       | przyczyna                                                                                                           | pada w baseline |
| -------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------- |
| `lib/ci/__tests__/migrationReplay.test.ts`                                 | porządek nazw = porządek wersji | `expected true to be false`                                                                                         | TAK             |
| `lib/ci/__tests__/migrationReplay.test.ts`                                 | ratchet bliźniaków treści       | dwie nowe pary bliźniaków z gałęzi Lovable (`page_full_path_tenant_scope`, `owner_plane_tenant_scope_read_history`) | TAK             |
| `lib/authz/__tests__/authzSnapshotParity.test.ts`                          | snapshot vs migracje            | PROVENANCE, `migrations: 932 -> 935`                                                                                | TAK             |
| `lib/server/__tests__/serviceRoleTenantScope.gate.test.ts`                 | `page_full_path` wiąże najemcę  | `it.fails`, który ZACZĄŁ przechodzić - czyli dług naprawiony, przypięcie nieusunięte                                | TAK             |
| `components/admin/monetization/__tests__/AdminMonetizationLedger.test.tsx` | przydział bezterminowy          | brak tekstu „Bezterminowo" po 5 s                                                                                   | TAK             |

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

Uruchomione **28 bramek** `check:*`. Rachunek jest taki: **24 zielone, 4 czerwone,
a te 4 czerwienie mają TRZY przyczyny źródłowe i żadna nie leży w module 17.**
Rozdzielenie „bramek czerwonych" od „przyczyn czerwieni" nie jest tu retoryką -
dwie z tych bramek pokazują czerwień z powodu, który nie ma nic wspólnego z ich
własną nazwą, i to jest ustalenie o samych bramkach, warte zapisania.

**ZIELONE - bramki buildowe (świeży `npm run build`, exit 0):**

`check:entry-purity` - **ZIELONA, Z NOWYM WPISEM.** To jest zamknięcie N4:
`echarts` stoi teraz na liście ciężkich modułów obok `dompurify`, `sonner`,
`lib/builder/sectionLabelVariants` i `lib/legal/content/*`, a ścieżka bootowania
to **9 chunków statycznie osiągalnych z 941**.
`check:chunks` - ZIELONA: **941 chunków, 5455 statycznych krawędzi importu, graf
acykliczny**. `check:chunk-parity` - ZIELONA (3 przypadki).

Liczby chunków są tu z CZYSTEGO buildu i to zastrzeżenie nie jest formalnością -
na katalogu `.output` z dwiema generacjami assetów te same bramki raportowały
1731 chunków i 10 784 krawędzie. Mechanizm i konsekwencje opisuję niżej, przy
`check:bundle`.

**ZIELONE - harnessy bazodanowe (5):** `check:pg-harness` (**369 asercji runtime**),
`check:events-harness` (**107 migracji, 1044 asercje**), `check:careers-harness`
(12 migracji, 6 atrap-celów polityk, zero pominiętych migracji),
`check:programs-harness`, oraz `check:widget-fidelity` (548 przypadków).

`check:tenant-isolation` - **62 asercje RLS**,
w tym cztery, które warto wypisać, bo dotyczą danych wrażliwych: historia czytania
i wynik testu osobowości z obcego najemcy są niewidoczne i niezapisywalne (RODO:
co człowiek czytał, profil psychometryczny), ścieżka kanoniczna strony urywa się na
granicy najemcy także w wariancie WSADOWYM obsługującym sitemapę, i nie da się
przepiąć istniejącej strony pod rodzica z obcego najemcy.

**ZIELONE - bramki statyczne (22):** `check:types-freshness` (304 tabele w typach,
26 znanych kolumn poza typami - baseline 26), `check:stale-never-casts` (3327 plików,
zero rzutowań na nazwy już obecne w typach), `check:unknown-casts` (192 znane
rzutowania w 124 plikach), `check:db-row-casts` (3328 plików, 20 wyjątków),
`check:i18n-hardcoded` (791 znanych wystąpień w 110 plikach),
`check:i18n-default-value` (**zero** zapasowych tekstów przy `t()` w 3296 plikach),
`check:i18n-overlay-imports`, `check:sql-tenant-scope` (1086 funkcji, 5 uzasadnionych
ścieżek publicznych), `check:sql-app-role` (1035 literałów `has_role`),
`check:sql-anon-insert` (620 polityk, 8 tabel intake chronionych),
`check:sql-emit-actor` (935 migracji, 1036 funkcji - aktor szóstym argumentem
w każdym wywołaniu), `check:sql-owner-tenant-scope` (165 polityk właściciela z 620),
`check:sql-policy-tenant-regression` (562 z 620 polityk z wiązaniem najemcy),
`check:rpc-contract` (559 nazw wołanych przez klienta, 1039 funkcji),
`check:content-layering` (bloki -> builder: 0, content-model -> silniki: 0),
`check:editor-autosave`, `check:workflow-env-contract`, `check:public-assets`,
`check:legacy-payment-refs` (5865 plików, zero żywych referencji),
`check:gate-coverage` (**38 bramek, każda wpięta dokładnie raz na job**),
`check:ownership`, `check:codeowners`.

Dwa ustalenia z zieleni, warte zapisania, bo bramka je DRUKUJE, a nikt ich nie czyta:
`check:ownership` przechodzi, ale raportuje **9 z 9 domen rejestru bez obsadzonego
właściciela technicznego** oraz 226 atrybucji słabych (jeden identyfikator). Co
istotniejsze dla tego rozdziału: **modułu 17 nie ma w rejestrze własności jako
osobnej domeny** - analityka i BI nie mają właściciela, do którego trafiłoby
którekolwiek z 96 przypięć niżej.

#### Cztery czerwienie, trzy przyczyny - żadna w module 17

**PRZYCZYNA 1: dryf snapshotu autoryzacji. Zapala DWIE bramki.**

`check:authz-snapshot` - CZERWONA, klasa **PROVENANCE**: `migrations: 932 -> 935`,
czyli „ten sam krąg uprawnionych, inne miejsce w historii". `check:permissions-parity`

- CZERWONA Z TEJ SAMEJ PRZYCZYNY: 234 przypadki przechodzą, 1 oczekiwana porażka,
  a jedyne padnięcie to `authzSnapshotParity.test.ts`, czyli ten sam dryf zapakowany
  w test.

Że to dryf metadanych, a nie regresja uprawnień, jest sprawdzalne, nie deklarowane:
reporter dryfu zwrócił **dokładnie jeden** wpis, kategorii `stats`, o twardo
ustawionej wadze `provenance`. Gdyby zmieniło się `appRoles` albo jakakolwiek bramka
rolowa, przed sekcją PROVENANCE stanęłaby osobna sekcja ZMIANA UPRAWNIEŃ. Nie
stanęła. Z trzech liczb w `stats` rozjechała się **tylko `migrations`**; `functions`
(1086) i `policies` (607) zgadzają się z odtworzeniem z migracji.

Źródło: trzy migracje z gałęzi Lovable z 31.08-01.09, które weszły PO ostatniej
regeneracji snapshotu (`1c4a91e`, 31.08) i PRZED startem gałęzi modułu 17 -
`page_full_path` z unikatem `pages(id, tenant_id)`, polityki właścicielskie na
`user_read_history` i `personality_result_history`, oraz `menu_items.visibility`.
Kampania modułu 17 **nie dodała ani jednej migracji** (`git log --diff-filter=A`
na `supabase/migrations` jest puste). Zlecenie zabrania regenerowania snapshotu dla
zgaszenia czerwieni i nie regenerowałem go.

**PRZYCZYNA 2: bliźniaki treści migracji. Zapala DWIE bramki.**

`check:sql-migration-replay` - CZERWONA: dwie NOWE pary bliźniaków, czyli ta sama
zmiana zapisana dwa razy pod dwiema nazwami -
`20260831160000_page_full_path_tenant_scope.sql` obok
`20260831214637_5b55b33f-….sql` i
`20260831170000_owner_plane_tenant_scope_read_history.sql` obok
`20260831215103_21bb8d7a-….sql`. Komunikat bramki nazywa szkodę precyzyjnie:
odtworzenie bazy przeżyje, bo migracje są idempotentne, ale **historia kłamie
o tym, kiedy zmiana realnie weszła** - a przy spłaszczonej historii commitów to
jedyne narzędzie datowania regresji.

`check:i18n-parity` - CZERWONA Z TEJ SAMEJ PRZYCZYNY I TO JEST USTALENIE O BRAMCE:
**wszystkie 49 plików językowych przechodzą, 815 przypadków zielonych.** Czerwień
wnoszą dwa padnięcia z `src/lib/ci/__tests__/migrationReplay.test.ts`, bo glob tej
bramki obejmuje CAŁY katalog `src/lib/ci/__tests__`, nie tylko testy językowe.
Praktyczny skutek: `check:i18n-parity` da się dziś zapalić zmianą, która nie ma
z językiem nic wspólnego, i odwrotnie - kto zobaczy jej czerwień, pójdzie szukać
rozjazdu słownika, którego nie ma. **REKOMENDACJA: zawęzić glob tej bramki do
plików językowych.**

**PRZYCZYNA 3: budżet bundla.** Osobny akapit niżej, bo wymaga pomiaru po obu
stronach kampanii.

**BEZ WEJŚCIA, nie czerwone:** `check:db-contract` i `check:migration-ledger`
kończą komunikatem „Brak SUPABASE_URL / klucza Supabase - nie mogę zweryfikować".
To nie są porażki, tylko bramki, które w tym środowisku nie mają czego sprawdzić.
Odnotowuję je jawnie, bo pominięcie ich w spisie wyglądałoby jak zieleń.

#### `check:bundle`: pomiar, który najpierw zrobiłem BŁĘDNIE

Zanim podam liczby, muszę opisać własną pomyłkę, bo jest instruktywna i łatwa do
powtórzenia. Pierwszy pomiar dał `public 4205,5 KB` i `overall 7416,4 KB` przy
1733 plikach - czyli przekroczenie budżetu o 1490 KB i 3110 KB, wynik
katastrofalny i, jak się okazało, **nieprawdziwy**.

Przyczyna: pierwszy build został ubity w połowie, ale zdążył zapisać do
`.output/public/assets` 790 plików; drugi build dopisał obok 941 nowych z nowymi
skrótami w nazwach. `check:bundle` gzipuje WSZYSTKO, co znajdzie w katalogu, więc
policzył sumę DWÓCH GENERACJI. Widać to w znacznikach czasu (790 plików z jednej
minuty, 941 z następnej). Bramka nie ma jak tego wykryć - `.output` jest dla niej
prawdą o buildzie, a nie zbiorem, który sama utworzyła. **Wniosek praktyczny:
`check:bundle` wolno czytać wyłącznie po `rm -rf .output && npm run build`;
inkrementalny katalog wyjściowy daje liczby wyglądające jak wynik.** To samo
dotyczy `check:chunks` i `check:entry-purity`, które na brudnym katalogu
raportowały 1731 chunków i 10 784 krawędzie zamiast rzeczywistych 941 i 5455.

Pomiar po obu stronach kampanii, na CZYSTYCH buildach, tym samym instrumentem
(`scripts/check-bundle-size.ts` i `reports/bundle-baseline.json` są bajt w bajt
identyczne w `3eb5e92` i na HEAD, a `vite.config.ts` i `package.json` kampania
nie tknęła):

| pomiar                | wejście (`3eb5e92`) |  po kampanii |              budżet | stan                   |
| --------------------- | ------------------: | -----------: | ------------------: | ---------------------- |
| liczba plików JS      |                 943 |          943 |                   - | -                      |
| PUBLIC                |          2 687,0 KB |   2 687,6 KB |          ≤ 2 715 KB | ZIELONY, zapas 27,4 KB |
| admin-only            |          1 633,4 KB |   1 633,5 KB | bilowane do overall | -                      |
| OVERALL               |          4 320,4 KB |   4 321,1 KB |          ≤ 4 306 KB | CZERWONY               |
| największy chunk      |            274,0 KB |     274,0 KB |            ≤ 280 KB | ZIELONY                |
| CSS klienta           |     81,0 KB / 2 pl. |  81,0 KB / 2 |             ≤ 82 KB | ZIELONY                |
| domknięcie bootowania |    576,7 KB / 9 ch. | 576,7 KB / 9 |            ≤ 579 KB | ZIELONY                |

**Kampania modułu 17 dołożyła +0,7 KB gzip do bundla klienta, z czego +0,6 KB do
wiadra PUBLIC.** Siedem dziesiątych kilobajta. Przekroczenie budżetu OVERALL
wynosi 15,1 KB i **istniało już na wejściu kampanii**: 4 320,4 KB wobec progu
4 306 KB, czyli **14,4 KB ponad próg, zanim kampania cokolwiek zmieniła**. Udział
kampanii w przekroczeniu to 0,7 z 15,1 KB, czyli **4,6%; pozostałe 95,4% jest
odziedziczone.** Wiadra public nigdy nie przekroczono - to była wyłącznie
konsekwencja podwójnego katalogu wyjściowego.

Delta per chunk, policzona przez zgzipowanie i zsumowanie po 809 wiadrach obu
świeżych buildów - to jest dowód, a nie lista ruchów wobec zamrożonego
baseline'u z 15 sierpnia, której świadomie nie cytuję, bo jest pisana STARĄ
konwencją wiader (sama bramka o tym ostrzega):

| chunk          |    delta | co się w nim zmieniło                                             |
| -------------- | -------: | ----------------------------------------------------------------- |
| `EChartClient` | +0,25 KB | wspólny magazyn motywu (N8); niesie zinline'owany `chartTheme.ts` |
| `webVitals`    | +0,15 KB | kolejka i drenaż metryk (N2)                                      |
| `index`        | +0,01 KB | `report.ts` - parametryzacja endpointu                            |
| `i18n`, `_`    | +0,03 KB | poziom zaokrąglenia rehashowania                                  |

Jeden szczegół z tego pomiaru jest dowodem per-plik, nie założeniem: literał
`/api/public/vitals` **przeniósł się** z `webVitals.js` (wejście) do `index.js`
(po kampanii). To dokładnie skutek wydzielenia `INTERNAL_VITALS_ENDPOINT`
w `report.ts` - endpoint przestał być stałą reportera metryk i stał się stałą
warstwy obserwowalności.

Zweryfikowano też - nie założono - że pozostałe pliki kampanii do klienta NIE
wchodzą: `src/lib/views/postViews.functions.ts` (N5) nie ma chunku klienckiego
i jego wkład to 0,00 KB, trasy `api/public/{vitals,client-errors}.ts` nie
zostawiają w kliencie ani jednego literału (`MAX_METRICS`, `MAX_BODY` - zero
plików), a pliki testowe nie wchodzą do bundla wcale.

Progi i baseline bramki są nietknięte (md5 obu plików sprawdzone), a
`--update-baseline` nie było uruchamiane ani razu. Zlecenie zabrania gaszenia
czerwieni przez zmianę progu i przepisanie baseline'u jest właśnie tym.

**Do decyzji poza tą kampanią:** OVERALL przebija próg o 15 KB przy zapasie
27,4 KB na PUBLIC i 2,3 KB na domknięciu bootowania. To dryf odziedziczony,
niesiony przez słowniki i18n, `vendor` i powierzchnie edytora/buildera - w żadnym
z tych wiader kampania nie ruszyła ani kilobajta. Ale próg jest przebity i wymaga
własnej diagnozy.

#### Co znalazły testy, których nikt nie szukał: 100 przypięć `it.fails`

Reguła zlecenia była jednoznaczna: defekt poza listą N1-N8 idzie do rejestru jako
`it.fails` z opisem złamanego kontraktu, a nie do naprawy. Wszystkie niżej są więc
ZAPISANE, nie naprawione - i to jest decyzja zamawiającego, nie mój wniosek o ich
nieważności. Przypięcia leżą w 35 plikach testowych modułu. Cztery klasy zasługują na osobne miejsce.

**KLASA PIERWSZA, NAJPOWAŻNIEJSZA: DZIEWIĘĆ kluczy cache bez identyfikatora warsztatu.**
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

KOREKTA WŁASNEGO ZAPISU: przy pierwszym przeglądzie napisałem „pięć kluczy".
Pełny rejestr niżej pokazuje **dziewięć** - osiem paneli (`gsc-sites`, `ga4-bi`,
`vitals-bi`, `related-insights`, `footer-analytics`, `audience-segments`,
`client-errors`, `semantic-snapshot`) plus `pendingCounterKeys.tenant()`. Dwa
z nich są gorsze od pozostałych, bo rozdzielają warsztaty WYŁĄCZNIE znacznikiem
czasu z `Date.now()` (`client-errors`, `vitals-bi`) - przy zamrożonym zegarze
albo dwóch panelach liczących to samo okno trafiają w ten sam wpis cache.

**I DRUGA KOREKTA, POWAŻNIEJSZA: najgroźniejszy przeciek nie jest w kluczach
cache.** `ga4.server.ts` buduje raport błędu przez `{ ...EMPTY_GA4_REPORT }` -
płytką kopię. `rows`, `totals` i nagłówki KAŻDEGO raportu błędu to więc TE SAME
instancje tablic w całym izolacie workera, współdzielone MIĘDZY ŻĄDANIAMI RÓŻNYCH
NAJEMCÓW. Klucze react-query wymagają jednej sesji przeglądarki widzącej dwa
warsztaty; ten defekt nie wymaga niczego - działa poza sesją, po stronie serwera,
i wiersz dopisany przez warsztat A widzi warsztat B. W kolejce naprawy stoi więc
zaraz za kluczami, a nie w ogonie rejestru, gdzie trafiłby po samej nazwie
(„odporność"). Naprawa: głęboka kopia albo `Object.freeze` na stałej.

Warto być tu precyzyjnym co do zasięgu KLUCZY CACHE, bo od tego zależy ich
pilność: cache react-query
żyje w JEDNEJ sesji przeglądarki, więc wyciek wymaga tej samej sesji widzącej dwa
warsztaty bez pełnego przeładowania. To nie jest wektor dla obcego napastnika - to
jest wektor dla operatora obsługującego kilka instalacji, czyli dokładnie dla roli,
która patrzy na te panele. Naprawa jest mechaniczna: identyfikator warsztatu w kluczu.
Dziewięć przypięć zgaśnie tego samego dnia, w którym ktoś ją wprowadzi.
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
`${Math.round(m.p75)} ${m.p75 >= 1000 ? "" : "ms"}`;
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

#### Rozkład wag i kolejność naprawy

Pełny rejestr 100 przypięć - plik, przypadek, złamany kontrakt - jest w plikach
testowych, przy każdym przypadku, w komentarzu nad nim; tutaj podaję rozkład
i kolejność, bo to one czynią z rejestru listę roboczą, a nie anegdotę.
Klasyfikacja idzie po SKUTKU dla odbiorcy, nie po miejscu w kodzie:

| waga       | przypięć | co znaczy                                                            |
| ---------- | -------: | -------------------------------------------------------------------- |
| izolacja   |       13 | dane albo liczniki jednego obszaru roboczego mogą trafić do drugiego |
| poprawność |       44 | zmienia LICZBĘ albo ZNAK wniosku w raporcie                          |
| dostępność |       33 | odbiera treść części odbiorców                                       |
| odporność  |        8 | nie kłamie, ale wywraca się albo gubi dane na wejściu brzegowym      |

**Ten rozkład mówi jedno: moduł 17 nie jest kruchy, jest NIEWIARYGODNY.** Tylko
8 przypięć opisuje kod, który się wywraca - a 44 opisują kod, który odpowiada
PEWNIE I BŁĘDNIE. Defekt, który wywraca ekran, zgłasza się sam; defekt, który
podaje liczbę, zostanie zauważony dopiero wtedy, gdy ktoś na jej podstawie podejmie
decyzję. Największa pojedyncza rodzina w obrębie „poprawności" - dwadzieścia cztery
przypięcia w jedenastu plikach - to jeden wzorzec: **mieszanie „braku pomiaru"
z „pomiarem równym zero"**. Kafelki KPI w trakcie pobierania, przy padniętym
zapytaniu i przy nieskonfigurowanym GA4 malują zera, jakby to był pomiar, a panele
audytorium i błędów dokładają do tego zieloną kartę „nie znaleziono krytycznych
zagadnień" - czyli zamieniają awarię infrastruktury w dobrą wiadomość o treści.

Kolejność naprawy, pięć pierwszych pozycji, z kosztem:

1. **Identyfikator warsztatu w dziewięciu kluczach react-query.** Pierwsze, bo to
   jedyna klasa, w której dane jednego najemcy pojawiają się na ekranie drugiego,
   a wyciek jest CICHY: nie leci ani jedno żądanie sieciowe, więc nie widać go ani
   w logu, ani w zakładce sieci. Koszt: jedna linia w każdym z dziewięciu plików.
2. **Głęboka kopia `EMPTY_GA4_REPORT`.** Drugie, bo to jedyny przeciek działający
   POZA sesją przeglądarki - przez współdzielone tablice w izolacie workera, czyli
   między żądaniami różnych najemców. Koszt: jeden plik, jedna zmiana.
3. **Arytmetyka „połowy okna" w obu silnikach wniosków** (`ga4Insights`,
   `gscInsights`). Przed rodziną „brak pomiaru", bo to jedyny defekt, który
   ODWRACA ZNAK wniosku: `Math.floor(n/2)` przy nieparzystej liczbie dni daje H1
   krótsze od H2, więc siedem dni po DOKŁADNIE dziesięć sesji raportuje +33,3%
   wzrostu, a pięć dni po dziesięć klików +50% - i ta sama arytmetyka w drugą
   stronę ukryje realny spadek. Koszt: jedna linia w każdym z dwóch plików.
4. **Rozdzielenie „braku pomiaru" od „pomiaru równego zero"** - 24 przypięcia
   w 11 plikach. Niżej niż punkt 3 tylko dlatego, że nie odwraca znaku, a zamienia
   „nie wiemy" na „jest zero". Koszt: wiele powierzchni, ale JEDEN wzorzec - czytać
   `isPending`/`isError` i pole `configured` z odpowiedzi zamiast `?? 0`.
5. **`csv` dla `ChartCard` w czterech panelach plus `aria-label` na przycisku
   „więcej".** Zamyka pięć przypięć o braku alternatywy tekstowej i cztery
   o bezimiennych przyciskach ZA DWIE ZMIANY, bo `ChartDataTable` stoi na 100%
   i mechanizm jest sprawdzony. Najlepszy stosunek zgaszonych przypięć do
   dotkniętego kodu w całym rejestrze.

Dwa przypięcia stoją w tej taksonomii nie na swojej półce i trzeba to powiedzieć:
oba z `footerTracking` dotyczą przekroczenia granicy ZGODY, nie granicy warsztatu -
`window.gtag` przeżywa cofnięcie zgody i aktywny sygnał GPC, bo `removeMarked`
usuwa `<script>`, a nie funkcję. Wpisane do „izolacji" z adnotacją o niepewnej
klasyfikacji, ale w kolejce naprawy należą wyżej, niż wskazuje waga: są jedynym
wątkiem w rejestrze z konsekwencją prawną.

#### Dyscyplina zdejmowania przypięć - warunek, bez którego rejestr sam siebie zniszczy

`it.fails` jest asercją DWUSTRONNĄ: zielony jest tylko dopóki przypadek PADA.
W chwili, w której ktoś naprawi opisany defekt, przypadek zaczyna przechodzić -
i vitest zgłasza `Error: Expect test to fail`, czyli **suita staje się czerwona
z powodu SUKCESU**.

Nie jest to rozważanie teoretyczne. W tym repozytorium dzieje się to DZIŚ:

```
 ❯ src/lib/server/__tests__/serviceRoleTenantScope.gate.test.ts (14 tests | 1 failed)
 FAIL  … page_full_path wiąże najemcę albo pages.parent_id ma ograniczenie tego samego najemcy
Error: Expect test to fail
```

Ten plik pada nie dlatego, że coś się zepsuło, ale dlatego, że dług został
naprawiony, a przypięcie nie zostało zdjęte. Mechanizm ma dwie nieprzyjemne
właściwości. **Pierwsza: naprawa i zdjęcie przypięcia są zwykle w różnych rękach** -
przypięcie pisze kampania testowa, naprawę robi ktoś realizujący własną listę
zadań i nie ma powodu wiedzieć, że jego jedna linia wywraca cudzy plik. **Druga:
w wyjściu CI czerwień od naprawionego przypięcia wygląda DOKŁADNIE tak samo jak
czerwień od regresji** („1 failed") - jedynym rozróżnieniem jest treść komunikatu,
której nikt nie czyta, dopóki nie zacznie diagnozować.

Przy 100 przypięciach w 35 plikach mechanizm skaluje się liniowo: naprawa punktu 1
z kolejności wyżej - dziewięć kluczy cache, jedna linia każdy - zamienia w czerwone
DZIEWIĘĆ plików testowych, jeśli nikt nie usunie z nich `it.fails`. Naprawa
punktu 5 - kolejne dziewięć. Stąd dwie zasady bez wyjątków:

1. **Przypięcie znika w TYM SAMYM commicie, co naprawa** - nie w osobnym,
   porządkowym, bo taki commit nigdy nie powstaje.
2. **Każdy wpis rejestru musi nazywać plik produkcyjny i zmianę do wykonania**,
   żeby osoba naprawiająca wiedziała, którego przypięcia szuka. Komentarze nad
   przypięciami w tej kampanii są pisane właśnie tak i to nie jest gadatliwość -
   to jedyne, co pozwala je zdjąć.

Trzecia zasada wynika z kontrpróbek zrobionych w tej kampanii i warta jest
osobnego zapisania: **przypięcie bez kontrpróbki nie jest dokumentacją defektu.**
Cztery przypięcia dodane na końcu kampania sprawdziła w drugą stronę - przez
chwilowe dołożenie w kodzie produkcyjnym brakującej semantyki i wykazanie, że
przypięcie wtedy PADA z `Expect test to fail`. Bez tego kroku nie da się odróżnić
przypięcia opisującego realny, spełnialny kontrakt od asercji trwale zepsutej,
której nikt nigdy nie zgasi.

### MODUŁ 18 — CRM · linie 99,03% · funkcje 98,60%

**Rodzaje testów:** jednostkowy 19 · warstwy danych 5 · komponentowy 6 · funkcji serwerowej 2 · parytetu 1 · hooka 1.

**Co tu decyduje:** CRM pokazuje, po co jest **test parytetu**: filtr leadów istnieje w dwóch implementacjach (nad wierszami i nad zapytaniem), więc bez porównania obu stron poprawka w jednej zostawia drugą zepsutą. Poza tym **test warstwy danych** dla zapytań i **test jednostkowy** dla mapowania importu danych osobowych.

**Bez tego rodzaju przechodzi taki defekt:** poprawka w filtrze nad wierszami nie trafia do filtra nad zapytaniem. Lista i eksport pokazują różne zbiory leadów, a handlowiec pracuje na tym mniejszym i nie wie o brakujących.

| Funkcjonalność                        | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ------------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| CRM: UI panelu                        |     19 |        569 |  95,1% | 83,4% |   96,5% | **96,0%** |   279/289 |
| CRM: import/eksport CSV + organizacje |      7 |        356 |  98,8% | 92,0% |   96,3% | **99,7%** |     79/82 |
| CRM: kontakty, firmy, lejek, zadania  |     25 |      1 115 |  98,9% | 90,7% |   99,6% | **99,8%** |   275/276 |

### MODUŁ 19 — Ustawienia / integracje / users / multi-tenant / RODO · linie 90,22% · funkcje 80,23%

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

### MODUŁ 20 — Platforma / backend / infrastruktura / SSR · linie 79,45% · funkcje 72,39%

**Rodzaje testów:** komponentowy 56 · jednostkowy 143 · warstwy danych 24 · dostępności 21 · funkcji serwerowej 30 · bramki 5 · parytetu 3.

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

### MODUŁ 22 — Wydarzenia: event builder, rejestracja, onsite · linie 86,95% · funkcje 86,87%

**Rodzaje testów:** dostępności 66 · jednostkowy 85 · komponentowy 52 · hooka 13 · funkcji serwerowej 8 · parytetu 7 · bramki 7 · warstwy danych 2.

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

Dane niewywołanych funkcji pochodzą z `coverage-final.json` DRUGIEGO przebiegu tego wydania
(konfiguracja nie ma reportera `json`, patrz 12.10 i R8); procenty pochodzą z przebiegu
pierwszego, tak jak wszystkie pozostałe liczby w tym dokumencie. Rozjazd między przebiegami to
**≤6 jednostek na 111 399** i dotyczy pięciu plików spoza tych pięciu powierzchni.

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

**Zer jest 198 wobec 338 w wydaniu 8 — 140 zamkniętych, największy spadek w tej serii.** Ale
zanim podam rozkład, muszę zapisać pułapkę pomiarową, w którą to wydanie prawie wpadło, bo bez
niej cała ta liczba jest nieporównywalna.

### 5.1 Największe pliki produkcyjne z pokryciem 0%

#### Pułapka filtra: 240 czy 198

W `coverage-ed9/coverage-summary.json` warunek `lines.pct === 0` daje **240** plików. Prawdziwych
zer jest **198**. Różnicę 42 stanowią pliki **bez ani jednej wykonywalnej linii** (`lines.total === 0`):
29 barreli re-eksportu i 13 modułów samych typów. V8 nie ma tam czego wykonać, więc nie są długiem
testowym — a raport wpisuje im `pct: 0`.

Rzecz, która czyni z tego pułapkę: **w raporcie wydania 8 te SAME 42 pliki mają `pct: 100`.**
Zmierzone na obu katalogach tym samym skryptem:

| warunek                                                  |  wyd. 8 |  wyd. 9 |
| -------------------------------------------------------- | ------: | ------: |
| wpisy plikowe w raporcie                                 |   3 260 |   3 304 |
| `lines.pct === 0`                                        |     338 | **240** |
| `lines.total > 0 && lines.covered === 0` (właściwe zero) | **338** | **198** |
| `lines.total === 0` (brak wykonywalnych linii)           |      42 |      42 |
| `pct` raportowany dla `lines.total === 0`                | **100** |   **0** |

Skrypt liczący zera po `pct === 0` podałby więc „338 → 240, minus 98" zamiast prawdziwego
**338 → 198, minus 140** — i różnica nie byłaby szumem, byłaby o 30% zaniżonym wynikiem pracy
pięciu kampanii. Sprawdziłem, którym filtrem liczy ten audyt: `aggregate.mjs:39` używa
`m.lines.total > 0 && m.lines.covered === 0`, czyli warunku właściwego, i to od pierwszego wydania.
Liczby w tabeli głównej są zatem porównywalne między wydaniami — ale zapisuję to tutaj, bo
**dowiedziałem się o tym przez sprawdzenie, nie przez założenie**, a każdy, kto odtworzy ten
pomiar innym skryptem, wpadnie w tę różnicę.

Przyczyny samego rozjazdu `pct` nie ustaliłem. `istanbul-lib-coverage@3.2.2` (`lib/percent.js`)
zwraca `100.0` dla `total === 0` i tak zachowuje się raport wydania 8; raport wydania 9 zwraca 0.
Zapisuję to jako **zmierzone, ale niewyjaśnione** — i jako regułę operacyjną: filtrem zer musi być
`lines.covered === 0 && lines.total > 0`, nigdy `lines.pct === 0`.

#### Waga 198 zer: 6% plików, 36% niepokrycia

198 plików to **5,99%** plików produkcyjnych, ale **36,5% wszystkich niepokrytych linii**
i **34,7% niepokrytych funkcji** w `src/`. Razem 23 750 LOC z dysku, 3 616 linii wykonywalnych
i 1 408 funkcji, których nie wywołał ani jeden test. Rozkład objętości: min 11 LOC, mediana 57,
p75 122, p90 279, max 1 138.

Klasyfikacja wszystkich 198 według jawnych kryteriów (graf importów po `src/`, `scripts/`, `e2e/`
i konfiguracji, z rozwiązywaniem aliasu `@/`; kategoria „sierota" ma pierwszeństwo nad treścią):

| kategoria            |   pliki |        LOC | linie wykonywalne |   funkcje |
| -------------------- | ------: | ---------: | ----------------: | --------: |
| `sierota`            |   **3** |        324 |                99 |        24 |
| `stała-konfiguracja` |   **4** |         48 |                 4 |         0 |
| `trasa`              | **104** |     11 794 |             1 764 |       706 |
| `komponent`          |  **63** |      9 303 |             1 255 |       563 |
| `logika`             |  **24** |      2 281 |               494 |       115 |
| **razem**            | **198** | **23 750** |         **3 616** | **1 408** |

Kategorie `barrel` i `typy` wychodzą puste i to NIE jest awaria detektora: żaden z 198 plików nie
zawiera ani jednego `export … from` (0/198), a tylko 5 ma zero funkcji. Barrele i moduły typów mają
`lines.total === 0`, więc siedzą w osobnej grupie 42 z 5.1 — i tam je policzyłem.

**„Trasy to cienkie wiązania" przestało być prawdą i to jest zmiana jakościowa wobec wydania 6.**
Ze 104 tras na zerze 24 przekraczają 100 LOC, a **dziesięć przekracza 300**. Cztery największe zera
całego repozytorium to trasy panelu na 725–1 138 linii:

| plik                                          |   LOC | linie wyk. | funkcje | moduł   |
| --------------------------------------------- | ----: | ---------: | ------: | ------- |
| `src/components/admin/TrendingTickerPane.tsx` | 1 138 |        195 |      96 | X-shell |
| `src/routes/admin.paywall.tsx`                | 1 097 |        153 |      68 | 20      |
| `src/routes/admin.hiring.tsx`                 |   901 |        148 |      81 | 21      |
| `src/routes/network.tsx`                      |   820 |        104 |      44 | 10      |
| `src/routes/admin.careers.tsx`                |   814 |        109 |      42 | 21      |
| `src/routes/admin.analytics.index.tsx`        |   725 |         64 |      28 | 17      |

Ostatni wiersz zasługuje na osobne zdanie, bo jest konsekwencją czerwieni opisanej w 12.2: to plik,
do którego commit `3d4b684ca` przeniósł 725 linii z `admin.analytics.tsx`, nie przenosząc testów.
Moduł 17 zamknął w tym oknie 47 starych zer i **przyniósł 2 nowe** — oba to nowe pliki,
nieobecne w raporcie wydania 8. Bilans plik po pliku dla całego repozytorium: **142 zera zamknięte,
2 nowe**; 338 − 142 + 2 = 198. Nie ma ani jednego zera, które byłoby regresem pliku wcześniej
pokrytego.

**Trzy sieroty — do usunięcia, nie do przetestowania.** Weryfikacja trzystopniowa: brak importera
w grafie, brak trafienia w grepie po całym repozytorium poza samym plikiem, brak chunku
w zbudowanym `.output/`.

| plik                                    | LOC | funkcje | dowód martwoty                                                                                                                        |
| --------------------------------------- | --: | ------: | ------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/ai-gateway.server.ts`          | 188 |      18 | jedyne trafienie `ai-gateway` w repo to REGUŁA MAPOWANIA w `scripts/taxonomy/moduleMap.mjs:474` — plik jest klasyfikowany, nie wołany |
| `src/components/ui/download-button.tsx` | 109 |       5 | jedyne trafienie to komentarz w `src/lib/i18n-download-button.ts:3`; realny `CvDownloadButton` żyje w `CvPrintSheet.tsx:82`           |
| `src/components/ui/form-link.tsx`       |  27 |       1 | trafienia `form-link` to wyłącznie KLASA CSS (`src/styles.css:6822`) — zbieżność nazwy, nie import                                    |

Drugi wiersz niesie sygnał wtórny: po usunięciu komponentu słownik `src/lib/i18n-download-button.ts`
też traci konsumenta.

**Najgorszy dług nie jest największy — jest w kategorii `logika`, 24 pliki i 2 281 LOC.** To kod
bez interfejsu, więc nie da się go „przypadkiem pokryć" renderem; jeśli nie ma testu, nie ma nic.
Sześć pozycji z pierwszej dziesiątki tej kategorii to warstwa serwerowa przy sekretach, poczcie,
retencji plików i granicy tenanta:

| #   | plik                                              | LOC | funkcje | co robi                                                                                                       |
| --- | ------------------------------------------------- | --: | ------: | ------------------------------------------------------------------------------------------------------------- |
| 1   | `src/lib/profile/export.functions.ts`             | 403 |      15 | eksport danych osobowych (RODO art. 15/20): ~20 sekcji przez `Promise.allSettled` na kliencie user-scoped     |
| 2   | `src/lib/admin/scheduler.functions.ts`            | 304 |       6 | zdrowie harmonogramu: RPC `job_scheduler_health()` + flagi VAPID/Resend/sekret schedulera                     |
| 3   | `src/lib/server/jobScheduler.server.ts`           | 186 |       6 | heartbeat i samozbrojenie runnera zadań tła na service role                                                   |
| 4   | `src/lib/relatedInsights.functions.ts`            | 121 |       2 | analityka rekomendacji per tenant: RPC `related_posts_signals`                                                |
| 5   | `src/lib/admin/library.ts`                        | 109 |       6 | CRUD `member_resources` + upload do prywatnego bucketu ze ścieżką prefiksowaną `tenant_id` pod RLS            |
| 6   | `src/lib/server/aiTranslate.server.ts`            | 108 |       6 | tłumaczenie PL→EN przez bramkę AI, porcje po 24 tys. znaków                                                   |
| 7   | `src/lib/server/email.server.ts`                  | 100 |       4 | nadawca e-maili przez Resend z higieną listy wykluczeń (odbicia, skargi)                                      |
| 8   | `src/lib/server/careerCvRetention.server.ts`      |  98 |       4 | wykonawcza strona retencji CV: usuwanie obiektów Storage z kolejki `career_cv_gc_scan`                        |
| 9   | `src/integrations/supabase/previewAuthStorage.ts` |  88 |      14 | broker sesji auth dla podglądu, z regexem odcinającym podszywanie się pod cudze `projectId`                   |
| 10  | `src/lib/http/requestHost.server.ts`              |  57 |       4 | odczyt hosta żądania z AsyncLocalStorage i walidacja wobec katalogu tenantów — granica zaufania host → tenant |

Pozycja 1 to eksport danych osobowych bez ani jednego wykonanego testu, pozycja 10 to granica
zaufania między hostem i tenantem. **Obie mają za to bramki statyczne czytające kod źródłowy**
(`exportOwnerScope.gate.test.ts`, `exportManifestParity.gate.test.ts`) — to jest lepsze niż nic
i piszę o tym wprost w 5.8, ale bramka czytająca źródło dowodzi, że kod tak WYGLĄDA, nie że tak
DZIAŁA.

**Sześć plików ma 0% i JEST importowanych przez test — bo test nazywa je tylko po to, żeby je
podmienić.** Sprawdzone w każdym z sześciu przypadków (`vi.mock`): `AddToCartButton.tsx`,
`relatedInsights.functions.ts`, `admin/badges.ts`, `admin/library.ts`, `admin/scheduler.functions.ts`,
`server/jobScheduler.server.ts`. To nie pokrycie, to atrapa — i jest to jedyny znany mi sposób,
w którym „plik ma importera testowego" wprowadza w błąd.

Kolokowanego pliku testowego nie ma **ani jeden** z 198 (sprawdzone `X.test.ts(x)`, `X.spec.ts(x)`,
`__tests__/X.test.ts(x)`).

### 5.2 Katalogi bez ANI JEDNEGO pliku testowego

Sygnał niezależny od pokrycia: katalog może mieć pokrycie z testu innego katalogu, ale nie ma
testu WŁASNEGO — czyli nikt nie testuje go wprost. Takich katalogów jest **62** (wydanie 8: 65)
i obejmują **89 plików / 23 674 linie** (wydanie 8: 94 / 24 954). Ruch jest więc niewielki: trzy
katalogi mniej, pięć plików mniej — bo pięć kampanii tego wydania szło po zerach pokrycia,
a nie po tej liście.

| Katalog                                          | Plików |   LOC |
| ------------------------------------------------ | -----: | ----: |
| `src/lib/locale`                                 |      2 | 4 564 |
| `src/components/admin/ThemeOptionsPane.tsx`      |      1 | 1 898 |
| `src/components/admin/GlobalColorsEditor.tsx`    |      1 | 1 479 |
| `src/components/admin/TrendingTickerPane.tsx`    |      1 | 1 139 |
| `src/components/admin/PostSettingsMetabox.tsx`   |      1 |   878 |
| `src/lib/content-model`                          |      7 |   789 |
| `src/components/admin/settings`                  |      4 |   703 |
| `src/components/author`                          |      2 |   664 |
| `src/components/admin/AdminShell.tsx`            |      1 |   651 |
| `src/components/admin/PostGeneralOverview.tsx`   |      1 |   627 |
| `src/components/admin/ThemeFontSizesPane.tsx`    |      1 |   602 |
| `src/lib/cookieBanner`                           |      2 |   574 |
| `src/components/admin/WordPressImportDialog.tsx` |      1 |   573 |
| `src/components/admin/WxrUploadPanel.tsx`        |      1 |   512 |
| `src/start.ts/(root)`                            |      1 |   465 |
| `src/components/admin/atoms`                     |      7 |   460 |
| `src/utils/(root)`                               |      1 |   444 |
| `src/components/admin/AccessSettingsPane.tsx`    |      1 |   407 |
| `src/components/composer`                        |      1 |   310 |
| `src/components/admin/ThemeBackgroundsPane.tsx`  |      1 |   305 |
| `src/components/cart`                            |      3 |   298 |
| `src/components/admin/ExpertLayoutPreview.tsx`   |      1 |   287 |
| `src/components/admin/AudioPicker.tsx`           |      1 |   282 |
| `src/server.ts/(root)`                           |      1 |   265 |
| `src/components/admin/RelatedLayoutPreview.tsx`  |      1 |   241 |
| `src/components/admin/CoverImagePicker.tsx`      |      1 |   227 |
| `src/lib/mcp`                                    |      5 |   218 |
| `src/components/admin/i18n`                      |      1 |   214 |
| `src/components/admin/AppearanceBuilderPane.tsx` |      1 |   210 |
| `src/router.tsx/(root)`                          |      1 |   207 |

**Pierwsza pozycja wymaga wyjaśnienia, bo bez niego jest myląca.** `src/lib/locale` to dwa pliki
słownikowe (`pl.ts`, `en.ts`) o 4 564 wierszach razem — czyli sam materiał tłumaczeń. Nie ma tam
logiki do przetestowania i nie o taki test tu chodzi; parytet tych słowników pilnują **bramki**
(`check:i18n-parity`, `check:i18n-key-drift`, `check:i18n-default-value`) oraz test parytetu
`lang-parity`, który jest jednym z dwóch plików pominiętych z braku sekretów (rozdz. 9.2). To jest
przykład powierzchni, dla której „brak własnego pliku testowego" jest właściwym stanem, a nie
długiem — ale też przykład tego, że jej faktyczną zaporą jest bramka statyczna, nie test, i że
jedna z tych zapór **nie biegnie w CI**.

**Pozycje od drugiej do dziesiątej są długiem bez wątpliwości** i wszystkie mają tę samą naturę:
to wielkie panele powłoki panelu admina (`ThemeOptionsPane.tsx` 1 898 wierszy,
`GlobalColorsEditor.tsx` 1 479, `TrendingTickerPane.tsx` 1 139, `PostSettingsMetabox.tsx` 878,
`AdminShell.tsx` 651) — czyli dokładnie ta powierzchnia przekrojowa X-shell, która od dziewięciu
wydań siedzi między 24% i 58% linii. Cztery z nich są zarazem na liście zer z 5.1.

**Jedna pozycja z tej listy jest nowym znaleziskiem tego wydania:**
`src/components/admin/settings` — **cztery pliki, 703 wiersze, zero testów własnych i ZERO progów
per-ścieżka** (rozdz. 6). W tym katalogu leży `fields.tsx`, komponent, którego jedna zmiana zgasiła
188 testów i zabrała pokrycie jedenastu plikom produkcyjnym (12.2). Katalog o najwyższej dźwigni
w module 19 nie ma ani własnego testu, ani bramki.

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
**1 próg globalny + 554 progów per-ścieżka** w `vitest.config.ts` (wydanie 8: 373), egzekwowanych
w CI krokiem `Test + coverage gate` (`.github/workflows/ci.yml`). Podział: **110 kluczy zawiera
`*`** (globy), 444 nie zawiera — z tym że dwa z tych 444 to wzorce klamrowe obejmujące po dwa
pliki (`src/components/{NewsletterPopup,PopupSignupForm}.tsx`,
`src/lib/newsletter-{admin,status}.functions.ts`), więc „progów na dokładnie jeden plik" jest 442.
Dwa klucze są niekompletne wymiarowo: jeden nie ma progu `functions`, jeden nie ma `branches`.

| Moduł                                 | Progów per-ścieżka | Mediana progu linii | Najwyższy próg linii |
| ------------------------------------- | -----------------: | ------------------: | -------------------: |
| M17                                   |                 85 |                  99 |                  100 |
| M11                                   |                 73 |                  98 |                  100 |
| M20                                   |                 46 |                  99 |                  100 |
| M9                                    |                 41 |                  98 |                  100 |
| M15                                   |                 40 |                 100 |                  100 |
| M19                                   |                 36 |                 100 |                  100 |
| M12                                   |                 34 |                  98 |                   98 |
| M1                                    |                 27 |                 100 |                  100 |
| M13                                   |                 25 |                  97 |                  100 |
| M3                                    |                 25 |                  98 |                  100 |
| M7                                    |                 24 |                  98 |                  100 |
| M8                                    |                 21 |                  98 |                  100 |
| M2                                    |                 21 |                 100 |                  100 |
| M16                                   |                 20 |                98.5 |                  100 |
| M14                                   |                  8 |                95.5 |                   99 |
| M6                                    |                  8 |                  97 |                  100 |
| M22                                   |                  7 |                  88 |                   99 |
| powłoka panelu admin + atomy/molekuły |                  7 |                  96 |                  100 |
| M10                                   |                  2 |                96.5 |                   98 |
| M4                                    |                  2 |                  99 |                   99 |
| M18                                   |                  1 |                  98 |                   98 |
| M5                                    |                  1 |                  99 |                   99 |

**Suma to 554, a lista ma 22 wiersze na 25 jednostek pomiarowych. Brakujące trzy to MODUŁ 21,
design system (`components/ui`) i słowniki i18n — wszystkie trzy mają ZERO progów.** Moduł 21 przy
55,12% linii i moduł 21 jako jedyny numerowany pod 60% to nie zbieg okoliczności, tylko ten sam
fakt widziany dwa razy (rozdz. 12.8). Cztery kolejne moduły mają po jednym albo dwóch progach
(M5, M18, M4, M10) — czyli pokrycie od 83,65% do 99,03% trzyma tam wyłącznie dobra wola autorów.

Rozkład jest natomiast dużo zdrowszy niż w wydaniu 8: pięć modułów, które dostały kampanię, dostało
też zapadkę (M17: 8 → **85** progów, M9: 9 → **41**, M12: 0 → **34**, M7: 1 → **24**, M16: 11 → **20**).
To jest właściwe zachowanie — procent i bramka razem, nie procent sam.

### 6.1 Dwadzieścia dziewięć naruszeń, trzy różne historie, jedna regresja

Wydanie 8 nie miało ani jednego naruszenia. To wydanie ma **29 wierszy na 16 ścieżkach**. Rozebrane
po przyczynach, z porównaniem do progów z commitu wydania 8 (`git show 573cc9ee2:vitest.config.ts`):

| przyczyna                                                             | ścieżek | wierszy |
| --------------------------------------------------------------------- | ------: | ------: |
| **D** — próg NOWY w wydaniu 9, ustawiony POWYŻEJ pomiaru pełnej suity |       9 |  **14** |
| **A + D** — próg nowy i jednocześnie pokrycie realnie spadło          |       5 |       8 |
| **A** — realna regresja przy progu niezmienionym                      |   **1** |   **4** |
| **B** — kod urósł bez testu przy progu niezmienionym                  |       1 |       3 |
| **C** — plik rozdzielony, testy przy starej ścieżce                   |       0 |       0 |

**Historia pierwsza (23 z 29 wierszy, 14 z 16 ścieżek): progi wyprzedziły pomiar.** Doszły razem
z 181 nowymi progami i postawiono je na 99%, gdy pełna suita mierzy 96–98,9%. Mediana braku
**1,44 pp**, dziesięć naruszeń poniżej 1 pp, najmniejsze — `src/lib/analytics/ga4.server.ts`
na instrukcjach — **0,04 pp**. Prawdopodobne źródło rozjazdu nazywa sam commit `d1861e84b`
w swojej sekcji weryfikacji: „`npx vitest run` na jedenastu plikach". **Próg postawiony
z przebiegu na podzbiorze plików nie jest progiem z pomiaru — jest progiem z próbki**, a te dwie
liczby różnią się o tyle, ile pokrycia wnoszą testy, których w próbce nie było.

**Historia druga (4 wiersze, 1 ścieżka): jedyna realna regresja.**
`src/routes/admin.settings*.tsx` — próg NIEZMIENIONY od wydania 8, zmierzone runęło **97,25% →
59,26%** linii i **95,29% → 32,54%** funkcji. Rozbiór w 12.2.

**Historia trzecia (3 wiersze, 1 ścieżka): przyrost bez testu.**
`src/lib/observability/report.ts` urósł z **88 na 115 wierszy** (commity `570265bc1`, `257053735`)
przy nietkniętym progu; instrukcje 95,65% → 92,59%, gałęzie 90% → 86,95%.

|   # | ścieżka                                                            | wymiar     | zmierzone | próg |   brak pp |
| --: | ------------------------------------------------------------------ | ---------- | --------: | ---: | --------: |
|   1 | `src/routes/admin.settings*.tsx`                                   | funkcje    |    32,54% |  94% | **61,46** |
|   2 | `src/routes/admin.settings*.tsx`                                   | instrukcje |    58,73% |  96% | **37,27** |
|   3 | `src/routes/admin.settings*.tsx`                                   | linie      |    59,26% |  96% | **36,74** |
|   4 | `src/routes/admin.settings*.tsx`                                   | gałęzie    |    74,19% |  93% | **18,81** |
|   5 | `src/components/admin/analytics/FooterAnalyticsPanel.tsx`          | gałęzie    |    90,76% |  99% |      8,24 |
|   6 | `src/lib/analytics/footerTracking.ts`                              | gałęzie    |    93,75% |  99% |      5,25 |
|   7 | `src/lib/counters/usePendingCounters.ts`                           | gałęzie    |    95,83% |  99% |      3,17 |
|   8 | `src/lib/observability/report.ts`                                  | gałęzie    |    86,95% |  90% |      3,05 |
|   9 | `src/components/admin/analytics/ClientErrorsDashboard.tsx`         | gałęzie    |    96,22% |  99% |      2,78 |
|  10 | `src/routes/api/public/client-errors.ts`                           | gałęzie    |    96,55% |  99% |      2,45 |
|  11 | `src/routes/admin.settings.analytics.tsx`                          | gałęzie    |    94,64% |  97% |      2,36 |
|  12 | `.../analytics/semantic/organisms/SemanticReconciliationPanel.tsx` | gałęzie    |    96,66% |  99% |      2,34 |
|  13 | `src/routes/api/public/client-errors.ts`                           | instrukcje |    96,96% |  99% |      2,04 |
|  14 | `src/components/admin/analytics/AudienceSegmentsDashboard.tsx`     | gałęzie    |    97,22% |  99% |      1,78 |
|  15 | `src/lib/analytics/audience.functions.ts`                          | gałęzie    |    97,56% |  99% |      1,44 |
|  16 | `src/lib/counters/usePendingCounters.ts`                           | instrukcje |    97,56% |  99% |      1,44 |
|  17 | `src/lib/observability/report.ts`                                  | instrukcje |    92,59% |  94% |      1,41 |
|  18 | `src/routes/admin.settings.analytics.tsx`                          | instrukcje |    97,64% |  99% |      1,36 |
|  19 | `src/components/admin/analytics/VitalsBiDashboard.tsx`             | gałęzie    |    93,87% |  95% |      1,13 |
|  20 | `src/lib/analytics/footerAnalytics.functions.ts`                   | instrukcje |    98,11% |  99% |      0,89 |
|  21 | `src/lib/analytics/footerAnalytics.functions.ts`                   | gałęzie    |    95,34% |  96% |      0,66 |
|  22 | `src/components/charts/ChoroplethMap.tsx`                          | gałęzie    |    98,48% |  99% |      0,52 |
|  23 | `src/components/admin/analytics/AudienceSegmentsDashboard.tsx`     | instrukcje |    98,50% |  99% |      0,50 |
|  24 | `src/lib/webVitals.ts`                                             | gałęzie    |    93,54% |  94% |      0,46 |
|  25 | `src/lib/analytics/ga4.server.ts`                                  | gałęzie    |    98,64% |  99% |      0,36 |
|  26 | `src/components/charts/ChoroplethMap.tsx`                          | instrukcje |    98,70% |  99% |      0,30 |
|  27 | `src/lib/analytics/audience.functions.ts`                          | instrukcje |    98,71% |  99% |      0,29 |
|  28 | `src/routes/admin.settings.analytics.tsx`                          | linie      |    98,71% |  99% |      0,29 |
|  29 | `src/lib/analytics/ga4.server.ts`                                  | instrukcje |    98,96% |  99% |      0,04 |

Rozkład po wymiarach: gałęzie 16, instrukcje 10, linie 2, funkcje 1. **Suma braków 198,83 pp,
z czego 153,28 pp (77%) daje jedna ścieżka.** Liczba „29 naruszeń" sama więc nic nie mówi o skali —
mówi tylko, że bramka jest czuła aż do czterech setnych punktu. Piętnaście z szesnastu ścieżek to
jeden plik, a deficyt to garść niewykonanych gałęzi (od jednej do dziewięciu). Szesnasta to glob na
piętnastu plikach, w którym dwa pliki — `admin.settings.cookie-banner.tsx` (25,71% linii)
i `admin.settings.mobile-bottom-bar.tsx` (35,18%) — oddają 87 z 178 nieobjętych linii.

**Kontekst, bez którego te 29 naruszeń czyta się na opak: między wydaniami pokrycie WZROSŁO**
(linie 84,12% → 90,75%). Wydanie 9 nie jest wydaniem regresji. Jest wydaniem, w którym dołożono
181 progów szybciej, niż zdążył je potwierdzić pomiar pełnej suity.

### 6.2 Zagnieżdżenia: 167 albo 173, i dwanaście par, w których próg zewnętrzny nie pilnuje niczego

Obie liczby są poprawne i różnią się metodą — i tę różnicę trzeba nazwać, bo w wydaniu 8 podałem
tylko jedną. Metoda **tekstowa** (klucz zewnętrzny kończy się na `/**`, wewnętrzny zaczyna się od
jego prefiksu) daje **167 par**. Metoda **przez zbiory plików** (`files(B)` jest właściwym
niepustym podzbiorem `files(A)` po rozwinięciu globów na 3 304 zmierzonych plikach) daje **173**.
Różnica to dokładnie sześć par, w których glob zewnętrzny nie kończy się na `/**`, więc metoda
tekstowa go nie widzi — m.in. `src/routes/admin.settings*.tsx` ⊃ `admin.settings.analytics.tsx`.
Ta jedna para jest znacząca sama w sobie: **oba jej członki są w tabeli naruszeń**, więc
`admin.settings.analytics.tsx` liczy się w raporcie dwukrotnie — raz przez własny próg, raz przez
glob nadrzędny.

**Zagnieżdżenia SPRZECZNE — próg wewnętrzny wyższy od zewnętrznego o więcej niż 50 pp — to
12 par na czterech katalogach**, i każda z nich znaczy, że próg zewnętrzny nie pilnuje niczego:

| wymiar     |    Δ pp | zewnętrzny (próg → zmierzone)                        | wewnętrzny (próg → zmierzone)          |
| ---------- | ------: | ---------------------------------------------------- | -------------------------------------- |
| linie      | **+93** | `src/components/admin/versions/**` (7% → **96,47%**) | `.../versions/lib/**` (100% → 100%)    |
| instrukcje |     +93 | `src/components/admin/versions/**` (7% → 96,89%)     | `.../versions/lib/**` (100% → 100%)    |
| funkcje    |     +92 | `src/components/admin/versions/**` (8% → 95,58%)     | `.../versions/lib/**` (100% → 100%)    |
| gałęzie    |     +91 | `src/components/admin/versions/**` (9% → 92,30%)     | `.../versions/lib/**` (100% → 100%)    |
| gałęzie    |     +78 | `.../post-editor/molecules/**` (22% → 96,85%)        | `.../organizationDirectory.ts` (100%)  |
| linie      |     +77 | `.../post-editor/molecules/**` (23% → 98,82%)        | `.../organizationDirectory.ts` (100%)  |
| instrukcje |     +77 | `.../post-editor/molecules/**` (23% → 97,90%)        | `.../organizationDirectory.ts` (100%)  |
| funkcje    |     +74 | `.../post-editor/molecules/**` (26% → 97,83%)        | `.../organizationDirectory.ts` (100%)  |
| gałęzie    |     +73 | `src/components/admin/workflows/**` (27% → 95,63%)   | `.../workflows/lib/**` (100% → 100%)   |
| linie      |     +55 | `src/components/admin/workflows/**` (45% → 99,53%)   | `.../workflows/lib/**` (100% → 100%)   |
| instrukcje |     +55 | `src/components/admin/workflows/**` (45% → 99,13%)   | `.../workflows/lib/**` (100% → 100%)   |
| funkcje    |     +52 | `src/components/audio/**` (48% → 89,13%)             | `src/components/audio/atoms/**` (100%) |

**Sprostowanie do mojego zapisu z wydania 8.** Podawałem ten przykład jako
`src/routes/admin/versions/**`. Takiego klucza w konfiguracji **nie ma** — w ogóle nie ma ani
jednego progu pod prefiksem `src/routes/admin/`. Właściwa ścieżka to
`src/components/admin/versions/**`. Diagnoza była poprawna, ścieżka nie.

Te cztery katalogi to zarazem cztery pierwsze pozycje tabeli luzu w 6.4, i to nie przypadek:
**sprzeczne zagnieżdżenie i rozwarta zapadka to ten sam defekt widziany z dwóch stron** —
podkatalog dostał próg 100% po dotestowaniu, a katalog nadrzędny nigdy nie został podniesiony.

### 6.3 Progi zerowe: nie są fikcją, ale jeden jest martwy

Tu hipoteza, z którą wchodziłem w ten pomiar, **się nie potwierdziła** — i to jest ciekawsze niż
potwierdzenie. Spodziewałem się progów zerowych stojących pod plikami, które dziś mają 90%, czyli
zapadki ustawionej poniżej rzeczywistości. Nie ma ani jednego takiego.

| ścieżka                               | próg (L,S,F,B)  | zmierzone dziś (L,S,F,B) | pokryte/wszystkie linii | ocena                |
| ------------------------------------- | --------------- | ------------------------ | ----------------------: | -------------------- |
| `src/routes/sitemap.tsx`              | 0, 0, 0, 0      | **0, 0, 0, 0**           |                    0/24 | próg **uczciwy**     |
| `src/lib/profile/export.functions.ts` | 0, 0, 0, 0      | **0, 0, 0, 0**           |                    0/43 | próg **uczciwy**     |
| `src/routes/robots[.]txt.ts`          | 0, 0, 0, **98** | 0, 0, 0, **100**         |                     0/4 | gałęzie **FIKCYJNE** |

To wszystkie wpisy z co najmniej trzema zerami. Wszystkie trzy pliki mają **dokładnie 0% linii**
(razem 71 nieobjętych wierszy), więc progi zerowe są rzetelnym zapisem trzech nieprzetestowanych
plików — i wszystkie trzy mają w konfiguracji uzasadnienie: dwie pierwsze są dowiedzione
w `e2e/seo.spec.ts`, trzecia ma dwie bramki statyczne czytające kod źródłowy
(`exportOwnerScope.gate.test.ts`, `exportManifestParity.gate.test.ts`). **To nie ukryte zera —
to zera z podpisem.**

**Fikcją jest natomiast `branches: 98` na `src/routes/robots[.]txt.ts`.** Plik ma **zero gałęzi**
(`branches.total = 0`), a istanbul dla zerowego mianownika zwraca `pct = 100`. Ten próg przechodzi
bez ani jednego testu i przechodziłby przy dowolnej wartości do 100 włącznie. Wpis `[0,0,0,98]`
wygląda w konfiguracji jak „prawie pilnujemy gałęzi", a nie pilnuje niczego — bo pilnować nie ma
czego. Jedyny martwy próg w tym zestawie; do usunięcia albo do opisania komentarzem.

### 6.4 Luz zapadki: jest ciasna, poza czterema wyjątkami

Dla każdego z 554 progów policzyłem `zmierzone − próg` na wymiarze linii, gdzie zmierzone to
agregat po plikach objętych globem (suma `covered`/suma `total`).

| przedział luzu |  progów | udział |
| -------------- | ------: | -----: |
| ≥ 20 pp        |   **5** |   0,9% |
| 10–20 pp       |   **4** |   0,7% |
| 0–10 pp        | **543** |  98,0% |
| ujemny         |   **2** |   0,4% |

Przedział 0–10 pp jest zbyt zgrubny, żeby cokolwiek pokazać, więc rozbiłem go dalej: **328 progów
stoi w granicach 0–2 pp od pomiaru**, 210 w 2–5 pp, 5 w 5–10 pp. Czyli **59% wszystkich progów
per-ścieżka jest dociągniętych do dwóch punktów, a 97% do pięciu.** To jest bardzo dobry stan
i jest to zmiana wobec wydania 8, gdzie zapadka globalna stała 19 pp pod pomiarem.

Wniosek praktyczny jest odwrotny do intuicji: **praca nad zapadką to nie 554 pozycje, a 32.** Dla
520 progów reguła `floor(zmierzone − margines)` dałaby wartość równą obecnej albo niższą, a zapadkę
wolno wyłącznie podnosić. **Cztery pierwsze pozycje oddają 252 pp z 293 pp całego dostępnego zysku:**

|   # | ścieżka                                         | typ  | plików | zmierz. linie | próg |     luz pp | propozycja |
| --: | ----------------------------------------------- | ---- | -----: | ------------: | ---: | ---------: | ---------: |
|   1 | `src/components/admin/versions/**`              | glob |      8 |        96,47% |    7 | **+89,47** |     **92** |
|   2 | `src/components/admin/post-editor/molecules/**` | glob |     22 |        98,82% |   23 | **+75,82** |     **94** |
|   3 | `src/components/admin/workflows/**`             | glob |     10 |        99,53% |   45 | **+54,53** |     **95** |
|   4 | `src/components/audio/**`                       | glob |      5 |        96,85% |   64 | **+32,85** |     **92** |
|   5 | `src/routes/news-sitemap[.]xml.ts`              | plik |      1 |       100,00% |   75 |     +25,00 |     **98** |
|   6 | `src/lib/newsletter-campaigns.functions.ts`     | plik |      1 |       100,00% |   86 |     +14,00 |     **98** |
|   7 | `src/components/admin/post-editor/atoms/**`     | glob |      7 |       100,00% |   87 |     +13,00 |     **96** |
|   8 | `src/lib/analytics/track.ts`                    | plik |      1 |        85,93% |   74 |     +11,93 |     **83** |
|   9 | `src/lib/retention/queries.ts`                  | plik |      1 |       100,00% |   90 |     +10,00 |     **98** |
|  10 | `src/routes/__root.tsx`                         | plik |      1 |        52,34% |   46 |      +6,34 |     **50** |

**Dlaczego margines 2 pp dla progu na plik i 4 pp dla globa.** Mediana progu per-plik to **30
wierszy** linii, więc jeden nieobjęty wiersz przesuwa wynik o **3,33 pp** — margines 2 pp jest
mniejszy niż jeden wiersz i nie przepuszcza żadnej realnej regresji; jest wyłącznie zabezpieczeniem
przed zaokrągleniem. Glob agreguje wiele plików (mediana **221 wierszy**, maksimum 4 671) i dochodzą
mu dwa źródła dryfu, których plik nie ma: **dryf składu** — nowy plik wchodzi pod glob i natychmiast
wnosi swoje nieobjęte wiersze do wspólnego mianownika, bez żadnej zmiany w kodzie już objętym —
oraz **dryf harmonogramu** — na testach komponentowych to, które gałęzie zdążyły się wykonać,
zależy od kontencji CPU (dokładnie ten mechanizm opisuje komentarz przy podniesieniu
`asyncUtilTimeout` do 5 s). 4 pp to zresztą ta sama reguła, jaką autorzy konfiguracji zapisali dla
progu globalnego.

### 6.5 Teza rozdziału: próg globalny nie mógł tego wykryć — i strukturalnie nie może

**Nie mógł.** Bufor nad progiem linii to 11 516 pokrytych linii, czyli 10,75 pp. Katastrofa
w `admin.settings*.tsx` — spadek o 36,74 pp lokalnie, 178 nieobjętych linii z 437 — zużyła z tego
buforu **0,16 pp**. Bufor globalny jest **67 razy większy** niż realny wpływ najgorszego naruszenia
w tym wydaniu.

| scenariusz                                                   | linie globalnie | wobec progu 80 |
| ------------------------------------------------------------ | --------------: | -------------: |
| stan zmierzony (wydanie 9)                                   |      **90,75%** |      +10,75 pp |
| gdyby wszystkie 56 plików z regresją ≥5 pp wróciło do wyd. 8 |          90,91% |      +10,91 pp |
| gdyby wrócił tylko glob `admin.settings*.tsx`                |          90,91% |      +10,91 pp |
| gdyby `admin.settings*.tsx` spadł do **0%**                  |          90,52% |      +10,52 pp |

Naprawa wszystkich ośmiu padniętych plików podniosłaby wynik globalny o 0,16 pp na liniach,
0,16 na instrukcjach, 0,47 na funkcjach i 0,05 na gałęziach. **Sygnał jest o dwa rzędy wielkości
mniejszy od szumu, który próg globalny toleruje.**

**I strukturalnie nie może.** Żeby przebić próg globalny linii, trzeba stracić 11 516 pokrytych
linii. **Ani jeden z 554 progów per-ścieżka nie obejmuje tyle** — nawet wyzerowany w całości:

| największe progi per-ścieżka      | pokryte/wszystkie linii | maks. spadek globalu | global spadłby do |
| --------------------------------- | ----------------------: | -------------------: | ----------------: |
| `src/components/admin/builder/**` |           4 546 / 4 671 |              4,25 pp |            86,51% |
| `src/lib/events/**`               |           3 973 / 4 472 |              3,71 pp |            87,05% |
| `src/lib/billing/**`              |           3 226 / 3 303 |              3,01 pp |            87,74% |
| `src/components/admin/events/**`  |           3 198 / 3 449 |              2,99 pp |            87,77% |
| `src/components/admin/blocks/**`  |           3 072 / 3 339 |              2,87 pp |            88,03% |

Największy próg per-ścieżka to **4,36% globalnego mianownika**. Mediana — **39 wierszy, czyli
0,036%**: dla przeciętnego progu przejście z 100% na 0% zmienia wynik globalny o cztery setne
punktu. **Próg globalny z luzem 10,75 pp nie jest bramką na regresję katalogu; jest bramką na
katastrofę całego repozytorium.** Dokładnie tak, jak mówią o jego poprzednich wcieleniach komentarze
w samej konfiguracji — z tą różnicą, że tam odnosiło się to do progu 33%, a dziś odnosi się do progu
80%, bo przy 554 progach per-ścieżka największy z nich nadal nie ma dość masy.

To jest cała wartość zapadki per-ścieżka i cały argument za jej dalszym dokładaniem: **29 naruszeń,
które zobaczyliśmy w tym wydaniu, próg globalny przepuściłby w całości, bez jednego wiersza w logu.**

### 6.6 Trzydzieści dziewięć bramek `check:*` — i jedna z nich jest dziś czerwona

W `package.json` jest **dokładnie 39 skryptów `check:*`** (wydanie 8: 38). Wszystkie 39 są wpięte
w `.github/workflows/ci.yml` **dokładnie raz na job** (28 w `verify`, 3 w `build`, 5 w uprzężach
pg, 2 po wdrożeniu) i **żadna nie ma `continue-on-error`**. Doszła jedna: `check:ci-gates`. Żadna
nie zniknęła. Jedna zmieniła polecenie: `check:i18n-parity` przeszła z globu katalogowego na
dwanaście jawnych ścieżek.

**Historia tej nowej bramki jest warta zapisania, bo to podręcznikowy przykład bramki mierzącej nie
to, co obiecuje.** Do commitu `740a36c33` (2026-09-02) `check:i18n-parity` obejmowała CAŁY katalog
`src/lib/ci/__tests__`, więc bramka **językowa** raportowała defekty SQL, RLS, billingu, własności
i chunków. Zapaliła się na dwóch bliźniaczych migracjach przy **zerowych** defektach i18n. Pomiar
rozjazdu: z 42 plików katalogu **5 jest merytorycznie językowych, 37 należy pod nową bramkę**.
Rozdzielenie zostawiło przy tym glob katalogowy w `check:ci-gates` **świadomie** — nowy test bramki
wchodzi do CI bez dopisywania ścieżki, a krok siedzi w tym samym jobie i pod tą samą klauzulą `if`,
więc żaden z 37 plików nie traci szybkiego sygnału.

**`check:ci-gates` jest CZERWONA na HEAD `d737e1329` przy czystym drzewie roboczym**: 45 plików,
863 testy, **1 padnięcie** — `monolingualUserText.test.ts` → „ratchet trzyma kierunek: ani nowego
pliku z długiem, ani wzrostu". Przyczyna jest jednoznaczna:
`src/routes/admin.analytics.index.tsx:387` zawiera `title="GA4 Looker Studio embed"`, czyli tekst
jednojęzyczny widoczny dla użytkownika, w pliku, którego **nie ma w `MONOLINGUAL_USER_TEXT_BASELINE`**
(baseline zna tylko starszy `admin.analytics.tsx` z jednym wystąpieniem). Kolejność przyczynowa jest
ustalona: bramka powstała w `6c4c1e621`, a plik z nowym długiem doszedł **później**, w `3d4b684ca` —
tym samym commicie, który rozdzielił trasę analityki i zgasił 55 testów (12.2). Na commicie
`740a36c33` ta bramka była 802/802 zielona. **Jeden commit „Work in progress" zapalił czerwień
w trzech niezależnych miejscach: w pokryciu, w suicie i w bramce statycznej.**

Metabramkę pilnującą bramek stanowi `check:gate-coverage` (istnieje od wydania 8) i egzekwuje trzy
rzeczy naraz: **(A)** każda bramka `check:*` z `package.json` ma co najmniej jedno wywołanie
w `.github/workflows/*`; **(B)** żaden krok `run:` nie woła skryptu, którego nie ma
w `package.json`; **(C)** żadna bramka nie jedzie w tym samym jobie więcej niż raz. Oblewa się także
przy `totalGates === 0`, czyli zepsuty skan nie może wyglądać na zielony. Warto przy tym wiedzieć,
czego ta bramka **nie** znaczy: „gate coverage" to nie „bramka ma własny test jednostkowy", a
„bramka jest realnie wpięta i wykonywana przez GitHub Actions". Parser liczy wyłącznie treść
wykonywaną — wartość klucza `run:` — bo wcześniejsza wersja skanowała każdą linię i `# run: bun run
check:foo` liczyło się jako wpięte.

---

## 7. Sześć warstw testów — co która realnie pokrywa

| Warstwa                                         | Rozmiar                                                                               | Co dowodzi                                                                                               | Czego NIE dowodzi                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Jednostkowe / komponentowe (vitest)             | 2 218 plików, 47 230 miejsc `it/test` (61 244 przypadków w przebiegu), 95 700 asercji | logikę w TS/TSX, render komponentów, kontrakty modułów                                                   | zachowania bazy (RLS/RPC/triggery), realnych ścieżek przeglądarki, SSR end-to-end                           |
| Baza (pgTAP)                                    | **101 plików, 1 852 asercje**                                                         | izolację tenanta, polityki RLS, kontrakty RPC, triggery — ale **behawioralnie**, nie strukturalnie       | kodu frontu (v8 tego nie liczy) ani struktury schematu: **zero asercji na indeksach, kluczach obcych i PK** |
| E2E (Playwright)                                | **11 plików, 98 testów w DWÓCH konfiguracjach** (9/96 + 2/2)                          | ścieżki użytkownika, SSR, SEO, checkout; dwa testy jako jedyne na **zbudowanym artefakcie**              | pokrycia jednostkowego (osobny proces); **196 tras panelu i 22 trasy API są poza zasięgiem**                |
| Bramki statyczne (`check:*`)                    | **39 skryptów**, wszystkie wpięte, bez `continue-on-error`; **jedna czerwona**        | kontrakty struktury (SQL, i18n, warstwy, bundle)                                                         | wykonania kodu                                                                                              |
| **Uprząż replayu migracji** (`check:*-harness`) | 5 uprzęży, **1 611 asercji runtime**                                                  | że migracje DAJĄ SIĘ WYKONAĆ na czystym Postgresie i że schemat po nich zachowuje się tak, jak deklaruje | kodu frontu i produkcyjnych danych — powierzchnia poza modułem jest ATRAPĄ                                  |
| Inwarianty na ŻYWEJ bazie (vitest + sekrety)    | 2 pliki, 50 testów                                                                    | zgodność schematu bazy z typami i parytet języków w DANYCH, nie w słownikach                             | **niczego — bo w CI nie biegną ANI RAZU** (job `test` nie ustawia zmiennych, patrz niżej)                   |

To jest źródło pozornej sprzeczności: MODUŁ z ~20% pokrycia jednostkowego może być jednym
z najlepiej zabezpieczonych w systemie, jeśli jego reguły siedzą w bazie i mają pgTAP.

**Trzy korekty do wydania 8, wszystkie na moją niekorzyść.**

**Pierwsza — pgTAP: 100 plików / 1 807 asercji → 101 / 1 852, i naiwna liczba jest zawyżona.**
Poprzednie wydanie podawało 1 904 asercje (suma `plan(N)` liczona grepem). Uczciwa liczba to
**1 852** i potwierdzają ją dwie niezależne metody dające identyczny wynik: suma `plan(N)`
z instrukcji `SELECT plan(...)` oraz zliczenie wywołań funkcji asercyjnych po usunięciu komentarzy
i ciał `$$`. Nadwyżka 52 rozlicza się co do jednostki: **trzy pliki CYTUJĄ w komentarzu nagłówkowym
historyczną, błędną wartość planu** — `plan(14)`, `plan(24)`, `plan(14)` — a naiwny grep dolicza je
do sumy: 1 904 − 14 − 24 − 14 = 1 852. Rozjazdów `plan()` wobec liczby asercji **nie ma ani jednego
na 101 plików**; każdy plik ma `plan()`, każdy ma `finish()`, i w każdym `plan(N)` = liczba asercji.
Inwariant planu ma przy tym nazwany w kodzie ślepy punkt (liczy wystąpienia w tekście, więc asercja
w ciele `$$` nie byłaby policzona) — zmierzone: takich asercji jest **0**, więc ślepy punkt dziś nic
nie ukrywa.

**Druga — ta warstwa jest niemal wyłącznie behawioralna i to jest luka, której nie opisywałem.**
1 810 z 1 852 asercji (**97,7%**) sprawdza zachowanie (`is`/`ok`/`throws_ok`/`lives_ok`/`results_eq`/
`row_eq`), a tylko **42 (2,3%)** to asercje katalogowe pgTAP o strukturze (`has_table`, `has_column`,
`has_function`, `has_trigger`, `has_view`, `col_*`). Zmierzone zera są przy tym całkowite:
**`has_index` i `indexes_are` nie występują ani raz; tak samo `fk_ok`/`has_fk`, `policies_are`/
`policy_cmd_is`/`policy_roles_are`, `table_privs_are`/`function_privs_are`, `has_pk`/`col_is_pk`
i `triggers_are`.** Polityki RLS są sprawdzane nie asercją katalogową, a ręcznym odczytem
`pg_policies`/`pg_policy` — i robi to 18 z 101 plików; uprawnienia roli sprawdza 41 plików przez
`has_table_privilege`/`has_column_privilege`/`has_function_privilege` owinięte w `is()`/`ok()`,
łącznie 184 wystąpienia. **Skutek praktyczny: skasowanie indeksu albo klucza obcego nie zapali
w tym repozytorium ani jednego testu.** Zasięg też trzeba podać wprost: te 1 852 asercje dotykają
**97 z 258 tabel z politykami RLS**.

**Trzecia — Playwright: 9 plików / 96 testów → 11 plików / 98 testów, ale liczba jest mniej ważna
od tego, PO CZYM te testy jadą.** Dziewięć plików (96 testów) jedzie po **dev-serwerze**
(`bun run dev`, port 4173), a nie po zbudowanej aplikacji, i powód jest zapisany w konfiguracji:
build produkcyjny celuje w runtime Cloudflare Workers, z którym `vite preview` jest niekompatybilny.
Dwa nowe pliki — `boot-artifact.spec.ts` i `boot-timing.spec.ts` — jadą jako **jedyne po ZBUDOWANYM
artefakcie** (preset `node-server`, `node .output/server/index.mjs`, port 4181) i mają własną
konfigurację `playwright.artifact.config.ts`, wołaną w CI przez `test:e2e:artifact`. Rozdział obu
konfiguracji jest **wymuszony, nie tylko opisany**: główna ma `testIgnore` na oba specy artefaktowe,
a parytet obu wzorców pilnuje bramka jednostkowa (13 asercji). Komentarz w `playwright.config.ts:20-31`
dokumentuje, że przed dodaniem `testIgnore` oba specy artefaktowe **faktycznie pojechały po
dev-serwerze i padły** (`readyMs` 19 963 ms wobec budżetu 6 000, `staticGraphCount = 0`) — czyli ta
bariera nie jest higieną, a naprawą realnej awarii.

Zasięg tej warstwy pozostaje jej najsłabszym punktem i podaję go bez upiększeń: **36 z 370
zadeklarowanych tras**, w tym **2 z 196 tras panelu** (i to wyłącznie jako asercja bramki
autoryzacji) oraz **0 z 22 tras API**. Jest też jeden plik-sierota: `e2e-ab/bootCompare.spec.ts`
(1 test) nie jest wołany przez żaden workflow — tylko przez ręcznie uruchamiany
`scripts/measure-boot-ab.ts`.

**Czwarta warstwa ma w tym wydaniu status najgorszy z możliwych: jest w tabelach, a nie biegnie
w CI ani razu.** Dwa pliki inwariantów na żywej bazie (`db-schema-invariant`, `lang-parity`, razem
50 testów) pomijają się warunkiem `shouldRun ? describe : describe.skip` na zmiennych `SUPABASE_*`,
których **job `test` w `ci.yml` nie ustawia** (`ci.yml:685`, `:728-730` — krok „Test + coverage gate"
bez bloku `env`, brak `env` na poziomie workflow). Komentarz w `vitest.config.ts:5133-5138` twierdzi
wprost, że te pliki „w CI, z prawdziwymi poświadczeniami, przechodzą" — **i to twierdzenie jest
fałszywe dla joba, który jako jedyny odpala suitę.** Potwierdza to zapisany w repozytorium log CI
(`scripts/vitest/testAccountingReporter.ts:8`, przebieg z 2026-08-27): „50 skipped". Jeden z tych
testów przy tym **nie potrzebuje bazy wcale** — `db-schema-invariant.test.ts:131` to czysta kontrola
wygenerowanych typów, która tylko leży w bramkowanym bloku. To jest najtańsza naprawa w całym
dokumencie: przenieść ten jeden test poza blok.

### 7.1 Rodzaje testów w suicie jednostkowej — i dlaczego rodzaj waży więcej niż liczba

Procent pokrycia odpowiada na pytanie „czy ta linia się wykonała”. Nie odpowiada na pytanie
„co zostało dowiedzione”. Odpowiada na nie RODZAJ testu — i dlatego dwa moduły z identycznym
pokryciem mogą mieć zupełnie inne ryzyko. Klasyfikacja poniżej powstała ze skanu treści
wszystkich plików testowych (sygnały: `renderHook`, `@testing-library/react`, `supabaseFromStub`,
`axe`, `createServerFn`, nazwy `*.gate.*`, `*.invariant.*`, `*Parity*`). Kolumny delt liczone wobec
tabeli wydania 8 opublikowanej w tym dokumencie — plik z tamtym pomiarem nie zachował się, więc
jego liczby są przepisane z poprzedniej wersji tej samej tabeli; suma kontrolna 2 010 plików zgadza
się co do jednego.

| Rodzaj testu                               | Plików | Testów | Asercji | As./test | Δ plików | Δ asercji |
| ------------------------------------------ | -----: | -----: | ------: | -------: | -------: | --------: |
| komponentowy (render + interakcja)         |    742 | 16 898 |  35 250 |     2,09 |      +45 |    +2 677 |
| jednostkowy (czysta reguła)                |    845 | 13 150 |  25 376 |     1,93 |      +50 |    +2 453 |
| dostępności (axe)                          |    200 |  6 151 |  13 128 |     2,13 |      +65 |    +5 272 |
| warstwy danych (atrapa PostgREST)          |    116 |  4 639 |   8 827 |     1,90 |      +11 |      +723 |
| hooka (renderHook)                         |    119 |  2 993 |   6 419 |     2,14 |      +17 |    +1 396 |
| funkcji serwerowej                         |    131 |  2 803 |   5 624 |     2,01 |      +18 |    +1 118 |
| bramki (meta-inwariant CI)                 |     28 |    291 |     493 |     1,69 |       +1 |       +49 |
| parytetu (dwa artefakty muszą się zgadzać) |     29 |    251 |     470 |     1,87 |       +1 |       +17 |
| inwariantu (nie wolno złamać reguły)       |      4 |     39 |      83 |     2,13 |       +0 |        +0 |
| dymny (czy w ogóle stoi)                   |      3 |     13 |      26 |     2,00 |       +0 |        +0 |
| integracyjny (wiele warstw)                |      1 |      2 |       4 |     2,00 |       +0 |        +0 |

**Najmocniejszy przyrost tego wydania to DOSTĘPNOŚĆ, i to nie jest przyrost proporcjonalny.**
Testy `axe` urosły z 135 na **200 plików (+65)** i z 7 856 na **13 128 asercji (+5 272)** — czyli
o **67%** przy 10-procentowym wzroście całej suity. Warstwa dostępności ma dziś najwyższą gęstość
asercji spośród dużych rodzajów (2,13 na przypadek) i jest trzecią co do rozmiaru. Dla produktu
z panelem administracyjnym o 196 trasach to właściwy kierunek — z jednym zastrzeżeniem, które
trzeba postawić obok: **test `axe` dowodzi kontraktu (role, etykiety, kolejność fokusu, brak
naruszeń), nie sensu treści dla czytnika ekranu.** To drugie ocenia człowiek i tego w repozytorium
nie ma.

**Warstwa integracyjna nadal ma JEDEN plik i DWA przypadki — dziewiąte wydanie z rzędu.** I jest to
ten sam plik, o którym rozdz. 9.2 mówi, że jego dwa testy **zawsze wychodzą przez `return` przed
pierwszą asercją**, bo CI nie stawia serwera na `localhost:8080`
(`csrfMiddleware.integration.test.ts:29`, `:44`). Gorzej: plik powołuje się w komentarzu na zapasowe
pokrycie w Playwrightcie — „pełny e2e pokrywa go `/e2e/csrf.spec.ts`" — **a tego pliku nie ma**
(`grep -rn "csrf" e2e/` nie zwraca nic; katalog ma 11 plików, żadnego CSRF). **Reguły CSRF nie
pilnuje w CI nic.** To najostrzejsze pojedyncze znalezisko tego rozdziału i jest gorsze niż zero
testów, bo zero testów widać w tabeli, a fałszywe odwołanie do warstwy, która nie istnieje, wygląda
jak pokrycie.

**Warstwy `inwariantu` (4 pliki), `dymna` (3) i `bramki` (28) stoją w miejscu — i tu stanie jest
właściwe.** Test inwariantu skaluje się z kodem, nie z przypadkiem: cztery pliki i 39 przypadków
pilnują reguły w CAŁYM repozytorium, więc ich liczba nie musi rosnąć razem z suitą. Test bramki
ma najniższą gęstość asercji w całym zestawieniu (1,69) i to również jest poprawne — bramka
sprawdza, że coś istnieje i jest wpięte, a nie co robi.

**Kontrola jakości przyrostu: gęstość asercji nie spadła.** 95 700 asercji na 47 230 miejsc
`it/test` daje **2,026** na przypadek wobec 1,995 w wydaniu 8 i 2,000 w wydaniu 7. Pięć kampanii
naraz nie rozcieńczyło dowodu — argument rozwinięty w 8.3. Dwie liczby psują jednak ten obraz i obie
podaję, bo są z tego samego pomiaru: **zero** przypadków w całej suicie nie ma ani jednej asercji
(skaner z rozwiązywaniem importów i tranzytywnym domknięciem helperów do głębokości 4), ale
**73 przypadki mają jako JEDYNĄ asercję `expect(...).not.toThrow()`** — dowodzą wyłącznie, że nic
nie rzuciło — a **17 169 przypadków (36,4%) ma dokładnie jedną asercję**, czyli łamie własną regułę
repozytorium o dwóch, bo bramka gęstości obejmuje tylko **74 pliki z 2 218**.

### 7.2 Rejestr defektów: 327 wpisów w 186 plikach — przyrost o 28% w dwa dni

Rozdział 7.1 argumentuje, że rodzaj testu waży więcej niż liczba. Ten rozdział pokazuje mechanizm,
który jest najlepszą rzeczą w kulturze testowej tego repozytorium: **defekt produkcyjny nie znika
w komentarzu, tylko dostaje przypięty test, który JEST czerwony i ma być czerwony.**

**Liczby, zmierzone niezależnie od raportów zespołu:** w repo jest dziś **327 wywołań `it.fails(`
w 186 plikach**; przebieg wykonał **337** przypadków „expected fail". Trajektoria: wydanie 4 — 24
wpisy w 20 plikach, wydanie 5 — 151 w 84, wydanie 6 — 171 w 94, wydania 7 i 8 — 255 w 147,
wydanie 9 — **327 w 186**. Przyrost o **72 wpisy (+28%) w oknie dwóch dni** i jest to największy
skok od wydania 5.

**Ten przyrost jest dobrą wiadomością i trzeba to powiedzieć wprost, bo licznik czerwieni sugeruje
odwrotnie.** W wydaniach 7 i 8 liczba wpisów stała w miejscu przy 147 nowych plikach testowych —
pisałem wtedy, że nowe testy powstawały na powierzchniach, gdzie defekty naprawiano od razu. W tym
oknie pięć kampanii weszło w powierzchnie, których nikt wcześniej nie testował (moduły 17, 7, 12, 9,
16 — razem 122 zamknięte zera), i tam defekty **były**. Siedemdziesiąt dwa nowe przypięcia to
siedemdziesiąt dwa defekty, które przedtem nikomu się nie pokazały, bo nie było testu, który by
o nie zapytał.

**Dyscyplina opisowa jest w tym rejestrze zdumiewająco dobra i zmierzyłem ją, zamiast ją założyć.**
Każdy z 327 wpisów ma opis-literał (zero wpisów bez opisu), mediana długości opisu to **68 znaków**,
a wszystkie dziesięć opisów, które same nie wystarczają do zrozumienia problemu, ma nad sobą
komentarz w formacie `DEFEKT / KONSEKWENCJA / OCZEKIWANY KONTRAKT`. Dla rejestru, którego jedyną
wartością jest wiarygodność, to jest właściwy stan.

**Pominięcia: nie „zero", jak pisałem w wydaniach 4-8, a jedno.** To jest regres wobec własnego
zapisu tego audytu i opisuję go osobno w 12.3: `src/routes/__tests__/rootShellRender.test.tsx:91`
niesie **bezwarunkowe** `describe.skip` — jedyne takie miejsce w całym repozytorium i to na
`RootComponent`, korzeniu aplikacji. Pozostałe dwa `describe.skip` są nadal warunkowe
(`const d = shouldRun ? describe : describe.skip` w `db-schema-invariant` i `lang-parity`), ale
w tym wydaniu ustaliłem o nich rzecz gorszą, niż sądziłem: **nie wykonują się także na CI**, bo job
`test` nie ustawia zmiennych `SUPABASE_*` (rozdz. 7 i 9.2). Nie ma natomiast w `src`, `e2e` ani
`e2e-ab` ani jednego `it.only`, `describe.only`, `it.todo`, `xit`, `xdescribe`, `this.skip()` czy
`vi.skip` — sprawdzone jednym wyrażeniem, wynik zero.

**Warunek, bez którego ten rejestr sam siebie zniszczy, obowiązuje dalej i w tym wydaniu dostał
drugi przykład.** Wpis, który przestał opisywać rzeczywistość, psuje rejestr dokładnie tak samo jak
wpis, którego nikt nie naprawił — bo `it.fails` na naprawionym defekcie **pada**. Wydanie 8 złapało
pierwszy taki przypadek (`serviceRoleTenantScope.gate.test.ts`, `Expect test to fail`, defekt
zamknięty migracją `page_full_path`) i został on w tym oknie wycofany, czyli procedura zadziałała.
Reguła jest więc sprawdzona w praktyce: **każde zamknięcie defektu musi zdjąć przypięcie w tym samym
commicie, a nie „przy okazji"** — inaczej rejestr zamienia się w generator fałszywej czerwieni,
a fałszywa czerwień jest jedyną rzeczą, która potrafi zabić prawdziwą.

### 7.3 Izolacja najemcy: co bramki repozytorium widzą, a czego strukturalnie widzieć nie mogą

Stan końcowy polityk odtworzyłem **parserem repozytorium** (`src/lib/ci/rlsPolicies`,
`extractLatestPolicies`), a nie własnym — powód w rozdz. 8.5 wydania 8. Liczby poniżej są
zmierzone na tym HEAD; **rozbiór zasięgu bramki i korekta „7 tabel" z wydania 8 są w rozdz. 12.5**,
a przypadek, w którym izolacja najemcy na plikach CV kandydatów już raz uległa regresji — w 12.8.

| miara                         |         wartość |
| ----------------------------- | --------------: |
| migracji w historii           |         **935** |
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
linii to większa dziura niż 20% na module o 5 tys. **Cała pula niepokrytych linii spadła w tym
oknie z 16 756 na 9 894 (−6 862, czyli −41%)** i to jest właściwa miara tego, co dowiozło pięć
kampanii.

| #   | Moduł                                              | Linii niepokrytych | wyd. 8 | Linie % | Funkcje % | Testów |
| --- | -------------------------------------------------- | -----------------: | -----: | ------: | --------: | -----: |
| —   | powłoka panelu admin + atomy/molekuły              |          **2 305** |  2 361 |  58,39% |    53,20% |  1 240 |
| 20  | Platforma / backend / infrastruktura / SSR         |          **2 021** |  2 246 |  79,45% |    72,39% |  6 350 |
| 22  | Wydarzenia: event builder, rejestracja, onsite     |          **1 369** |  1 595 |  86,95% |    86,87% |  5 399 |
| 3   | Silniki treści: bloki + page builder               |          **1 190** |  1 220 |  94,46% |    92,61% |  5 755 |
| 19  | Ustawienia / integracje / users / multi-tenant / R |            **436** |    296 |  90,22% |    80,23% |  1 390 |
| 1   | Wpisy: doświadczenie czytelnika                    |            **391** |    391 |  84,65% |    82,10% |  1 015 |
| 21  | Rekrutacja / kariera                               |            **381** |    381 |  55,12% |    47,13% |    171 |
| 7   | Typy treści specjalne                              |            **303** |  2 313 |  93,02% |    85,75% |  1 745 |
| 4   | Strony, wygląd, motyw, media, import               |            **251** |    260 |  92,58% |    89,18% |  1 245 |
| 17  | Analityka i BI                                     |            **208** |  2 080 |  94,14% |    91,12% |  1 915 |
| 13  | Monetyzacja: checkout / subskrypcje / billing      |            **190** |    192 |  96,57% |    96,35% |  2 924 |
| —   | design system (components/ui)                      |            **140** |    140 |  81,21% |    74,58% |     17 |

**Czołówka tej listy zmieniła się jakościowo i to jest najważniejsza obserwacja tego rozdziału.**
W wydaniu 8 trzy pierwsze pozycje (moduły 7, 20, 17) to były powierzchnie o **niskim procencie**
— 43,93%, 75,83%, 32,88%. Dziś dwie z nich zniknęły z czołówki, bo dostały kampanię: moduł 7 spadł
z 2 313 na **303** niepokryte linie, moduł 17 z 2 080 na **208**. Na ich miejsce weszły
powierzchnie o **wysokim procencie i wielkiej masie**: moduł 3 ma 94,46% linii i nadal 1 190
niepokrytych, moduł 22 ma 86,95% i 1 369. **Repozytorium przeszło z fazy „są dziury" do fazy
„jest ogon"**, a to wymaga innej taktyki: ogona nie zamyka się kampanią modułową, bo w module o 466
plikach niepokryte 5,5% jest rozsypane po dziesiątkach plików, nie skupione w kilku.

Dwie pozycje wymagają komentarza, bo ich obecność tutaj ma inną przyczynę niż zaległość.
**MODUŁ 19 urósł z 296 na 436 niepokrytych linii i to jest wyłącznie skutek czerwieni** — po
naprawie testu wróci pod 300 (12.2). **Design system (`components/ui`) ma 140 niepokrytych linii
przy SIEDEMNASTU testach na 45 plików** (T/P = 0,044, najniższe w repozytorium) — to nie ogon,
to powierzchnia praktycznie nietestowana, która trzyma 81,21% wyłącznie dzięki temu, że inne moduły
ją renderują.

### 8.1 Rekomendacje — kolejność, nie lista życzeń

Trzy rekomendacje wydania 8 są wdrożone i wypadają z listy: R3 (próg globalny podniesiony do
`79/73/77/80`), R1 (rozjazd migracji zamknięty, 935 = 935) i R2 (wpis `it.fails` o `page_full_path`
wycofany). Poniższa lista jest nowa; kolejność to stosunek zysku do kosztu, nie waga tematu.

**R1. Naprawić `saveButton()` w `adminSettingsRoutes.test.tsx` — dwa miejsca, 188 testów, 43%
czasu przebiegu.** Najtańsza naprawa o największym zasięgu w tym wydaniu i jedyna, która jest
BLOKUJĄCA: dopóki jej nie ma, CI jest czerwone, glob `admin.settings*.tsx` łamie próg na czterech
wymiarach, jedenaście plików produkcyjnych nie ma pokrycia, **dwanaście dalszych testów przechodzi
próżnio**, a przebieg trwa 951 sekund dłużej, niż musi. Naprawa nie tyka produkcji i nie obniża
progu: pomocnik liczy etykiety tą samą funkcją, którą dostaje komponent (`translateKey`
z `@/test/i18nStub`), a asercja stanu zapisu porównuje z `translateKey("admin.saving")`. Wzorzec
jest już w repozytorium w dwóch wariantach (12.9). Koszt: dwa miejsca w jednym pliku.

**R2. Pozostałe siedem czerwonych plików, po kolei rosnącego kosztu.** `labelsEn` i `lazyWidgets`
to jedno brakujące wpisanie do rejestru każde; `monolingualUserText` to jedna pozycja baseline'u
(`admin.analytics.index.tsx`) — i ta sama zmiana gasi zarazem czerwoną bramkę `check:ci-gates`,
czyli **jeden wpis zdejmuje dwa zapalenia**; `headerTickerQuery` wymaga rozstrzygnięcia, czy
kontrakt zmienił się celowo; `pollsRoute` to zmiana czterech zapytań z roli `button` na `radio`
(produkcja ma rację, test jest przestarzały); `adminCommunityIndexRoute` wymaga atrapy kontekstu 2D
dla ECharts w happy-dom — jednej, wspólnej dla całego repozytorium; `adminAnalyticsRoute` wymaga
przeniesienia testów za trasą, którą commit `3d4b684ca` rozdzielił. **Ostatnia pozycja jest
najdroższa i to nie przypadek: to jedyna z ośmiu, w której zmiana produkcyjna była nieodwracalna
dla testu.**

**R3. Dopisać próg na `src/components/admin/settings/**` — katalog o najwyższej dźwigni w repo
nie ma żadnego.** Cztery pliki, 703 wiersze, zero testów własnych, zero progów; `fields.tsx` jest
importowany przez **26 plików produkcyjnych**. Drugi plik tego katalogu (`ConsentAuditSummary.tsx`)
stoi na 0/21 linii i nic tego nie łapie. Po R1 `fields.tsx` wraca na 100/100, więc próg na sam plik
jest tam osiągalny i uzasadniony dźwignią. Koszt: dwa wpisy w konfiguracji.

**R4. Podnieść cztery progi, które nie pilnują niczego — 252 pp z 293 pp całego dostępnego zysku.**
`src/components/admin/versions/**` stoi na progu **7** przy pomiarze **96,47%**;
`post-editor/molecules/**` na 23 przy 98,82%; `workflows/**` na 45 przy 99,53%; `audio/**` na 64
przy 96,85%. Każdy z tych katalogów ma podkatalog z progiem 100, czyli **sprzeczne zagnieżdżenie**:
podkatalog podniesiono po dotestowaniu, nadrzędnego nigdy. Reguła daje 92/94/95/92. Koszt: cztery
liczby. Uwaga porządkowa: **pozostałych 520 progów NIE trzeba ruszać** — 59% stoi w granicach 2 pp
od pomiaru (6.4), więc praca nad zapadką to 32 pozycje, nie 554.

**R5. Powłoka panelu admina jest teraz największą dziurą w repozytorium — 2 305 niepokrytych
linii.** 221 plików, **58,39% linii, 53,20% funkcji**, 27 plików na zerze, siedem progów
per-ścieżka na całą powierzchnię i **zero testów własnych w największych plikach**
(`ThemeOptionsPane.tsx` 1 898 wierszy, `GlobalColorsEditor.tsx` 1 479, `TrendingTickerPane.tsx`
1 139 — wszystkie trzy w tabeli 5.2). W dziewięciu wydaniach ta powierzchnia przeszła z 24,42% na
58,39%, ale **każdy jej przyrost był efektem ubocznym kampanii w innym modułe, nie pracą własną** —
i ona jedna rośnie przy każdej ekstrakcji z tras, czyli każda kolejna kampania ją powiększa.
Wzorzec jest gotowy i sprawdzony pięć razy: ekstrakcja do `atoms/molecules/organisms`, asercje,
na końcu próg.

**R6. Moduł 21 (rekrutacja) — dziewiąty identyczny pomiar, dwa pliki dają +30 pp.** Zero progów na
554, zero commitów w oknie, zero testów tras. Wariant minimalny to dwie trasy panelu i ~27 testów:
55,12% → **85,39% linii**, 47,13% → **82,47% funkcji**. Osobno i niezależnie od pokrycia:
**trzy tabele z danymi osobowymi kandydatów i polityki bucketu CV nie mają ani jednego testu
pgTAP**, a izolacja najemcy na plikach CV już raz uległa regresji i uratowała ją kolejność
alfabetyczna nazw migracji (12.8). **Ta pozycja jest w tej liście najwyżej pod względem ryzyka,
a nie pokrycia.**

**R7. Trzy sieroty do usunięcia, nie do przetestowania.** `src/lib/ai-gateway.server.ts` (188
wierszy, 18 funkcji), `src/components/ui/download-button.tsx` (109), `src/components/ui/form-link.tsx`
(27) — zero importerów w grafie, zero trafień w grepie po repozytorium, zero chunków w zbudowanym
`.output/`. Usunięcie zdejmuje 324 wiersze z mianownika i podnosi wynik bez ani jednego testu;
przy `download-button.tsx` traci konsumenta także słownik `src/lib/i18n-download-button.ts`.

**R8. Dwie naprawy w konfiguracji pomiaru, oba jednowyrazowe.** (a) Dołożyć `"json"` do listy
reporterów pokrycia — bez `coverage-final.json` nie da się odczytać, KTÓRE funkcje nie zostały
wywołane, a rozdz. 4 opiera się na nim w całości; brak tego reportera kosztował w tym audycie
**drugi pełny przebieg suity, 2 151 sekund** (12.10). (b) Wyjąć jeden test z bramkowanego bloku:
`db-schema-invariant.test.ts:131` to czysta kontrola wygenerowanych typów, która nie potrzebuje
bazy wcale, a leży w `describe.skip` warunkowanym sekretami — czyli **nie biegnie w CI ani razu**.

**R9. Reguły CSRF nie pilnuje w CI nic — i wygląda, jakby pilnował.**
`csrfMiddleware.integration.test.ts` ma dwa testy, oba wychodzą przez `return` przed pierwszą
asercją (CI nie stawia serwera na `localhost:8080`), a komentarz w pliku powołuje się na zapasowe
pokrycie w `/e2e/csrf.spec.ts`, **którego nie ma**. Fałszywe odwołanie do warstwy, która nie
istnieje, jest gorsze niż brak testu, bo brak testu widać w tabeli. Minimum: usunąć nieprawdziwe
odwołanie i zamienić ciche `return` na jawne pominięcie, żeby liczba w tabelach zgadzała się
z rzeczywistością.

**R10. Poprawić moją własną mapę modułów w dwóch regułach.** `^src/routes/.*(career|job)` nie
dopasowuje polskiej nazwy trasy, więc publiczna strona kariery (`src/routes/zatrudniamy.tsx`, 0%)
i wykonawcza połowa retencji CV (`src/lib/server/careerCvRetention.server.ts`, 0%) rozliczają się
do modułu 20, gdzie topią się w 209 plikach. Liczony po rzeczywistym obwodzie moduł 21 ma
**51,26%**, nie 55,12% — czyli raportowana liczba jest zawyżona o **3,86 pp**. To błąd mapy, nie
pomiaru: suma globalna się nie zmienia, zmienia się przypisanie. Do wydania 10.

### 8.2 Ocena: dobre, złe, beznadziejne — z argumentem, nie z widzimisię

Rubryka bez zmian od wydania 4, żeby oceny były porównywalne: **baza = 0,4 × linie% + 0,6 ×
funkcje%** (funkcje ważą więcej, bo to metryka ostrzejsza — liczy każdy handler i callback, więc
trudniej ją ugrać renderem bez interakcji). Progi: **wzorowo ≥ 90, dobrze 75–90, przeciętnie 55–75,
źle 35–55, beznadziejnie < 35**.

| Ocena         | wyd. 8 | wyd. 9 |
| ------------- | -----: | -----: |
| wzorowo       |     12 |     15 |
| dobrze        |      5 |      8 |
| przeciętnie   |      3 |      1 |
| źle           |      4 |      1 |
| beznadziejnie |      1 |      0 |

**Kategoria „beznadziejnie" jest po raz pierwszy w tej serii PUSTA.** Zajmował ją moduł 17
(analityka i BI), który w jednym oknie przeszedł z bazy 30,20 na **92,33**, czyli
**„beznadziejnie" → „wzorowo" przez trzy kategorie naraz**. Awansów jest dziewięć:

| MODUŁ 16 | 99,83 | **wzorowo** | 89,06 | dobrze | **dobrze → wzorowo** |
| MODUŁ 12 | 97,49 | **wzorowo** | 48,29 | źle | **źle → wzorowo** |
| MODUŁ 9 | 96,36 | **wzorowo** | 59,95 | przeciętnie | **przeciętnie → wzorowo** |
| MODUŁ 17 | 92,33 | **wzorowo** | 30,20 | beznadziejnie | **beznadziejnie → wzorowo** |
| MODUŁ 7 | 88,66 | **dobrze** | 39,61 | źle | **źle → dobrze** |
| MODUŁ 19 | 84,22 | **dobrze** | 91,47 | wzorowo | **wzorowo → dobrze** |
| słowniki i18n | 78,15 | **dobrze** | 74,24 | przeciętnie | **przeciętnie → dobrze** |
| MODUŁ 20 | 75,21 | **dobrze** | 71,52 | przeciętnie | **przeciętnie → dobrze** |
| powłoka panelu admin + atomy/molekuły | 55,27 | **przeciętnie** | 54,23 | źle | **źle → przeciętnie** |

Jeden ruch jest w dół i jest artefaktem: **moduł 19 spadł z „wzorowo" na „dobrze"** wyłącznie
z powodu 188 padniętych testów — po naprawie wraca (12.2 pokazuje, że kontrfaktycznie stałby
na 93,94% linii i 90,95% funkcji, czyli WYŻEJ niż w wydaniu 8).

**Trzy oceny wymagają zastrzeżenia, bez którego sama liczba wprowadza w błąd:**

- **MODUŁ 11 (newsletter), baza 99,47, „wzorowo" — i najwyżej w repozytorium.** Stoi bez ruchu
  od wydania 6, kiedy domknął go prompt modułowy. **Brak ruchu w module domkniętym jest właściwym
  zachowaniem**, nie zaniedbaniem — 73 progi per-ścieżka trzymają ten poziom, więc jedna zmiana
  go nie zdejmie.
- **Słowniki i18n, baza 78,15, „dobrze" — ale to ocena o innym znaczeniu.** 93,63% linii przy
  **67,82% funkcji** i T/P = 0,051 (siedem plików testowych na 137 produkcyjnych). Wysokie linie
  to artefakt: słownik „wykonuje się" przy każdym imporcie. Realną zaporą tej powierzchni są
  **bramki** (`check:i18n-parity`, `check:i18n-key-drift`, `check:i18n-default-value`), nie testy
  — i jedna z nich, test parytetu `lang-parity`, **nie biegnie w CI**.
- **Design system (`components/ui`), baza 77,23, „dobrze" — najbardziej mylące „dobrze" w tabeli.**
  81,21% linii przy **SIEDEMNASTU testach na 45 plików**. Ta powierzchnia nie jest przetestowana;
  jest renderowana przez cudze testy. Gdyby pozostałe moduły przestały jej używać, jej pokrycie
  spadłoby do zera bez ani jednej zmiany w jej kodzie. **Pokrycie pożyczone to nie pokrycie —
  to brak własnego dowodu przy cudzym.**

### 8.3 Czy pięć kampanii naraz obniżyło jakość testów — sprawdzenie

To pytanie zadaję w każdym wydaniu, w którym praca szła szeroko, i tym razem miało większą wagę:
pięć kampanii, 208 nowych plików testowych i +6,63 pp globalnie w oknie dwóch dni. Odpowiedź jest
**dwuczęściowa i obie części trzeba podać razem.**

**Nie obniżyły — mierzone gęstością dowodu.** 95 700 asercji na 47 230 miejsc `it/test` daje
**2,026** na przypadek, wobec **1,995** w wydaniu 8 i 2,000 w wydaniu 7. Gęstość nie spadła,
a wzrosła. Rozkład po rodzajach też się nie pogorszył: najmocniej urosła warstwa **dostępności**
(+65 plików, +5 272 asercje, gęstość 2,13 — najwyższa spośród dużych rodzajów), a nie warstwa
najtańsza. **Zero** przypadków w całej suicie nie ma ani jednej asercji, co sprawdziłem skanerem
z rozwiązywaniem importów i tranzytywnym domknięciem helperów asercyjnych do głębokości 4.
Nie ma też ani jednego `it.only`, `describe.only`, `it.todo`, `xit` czy `this.skip()` w `src`,
`e2e` i `e2e-ab`.

**Obniżył ją natomiast ruch, który przeszedł OBOK kampanii — i to jest ustalenie tego wydania.**
Dwadzieścia pięć z 194 commitów nie-merge (12,9%) ruszyło kod produkcyjny i **zero plików
testowych**, łącznie 2 856 wierszy, przy czym jeden commit — `3d4b684ca`, tytuł „Work in progress"
— odpowiada za **62,8%** tej masy. Licząc drugą metodą, po plikach: z 221 zmienionych plików
produkcyjnych **68 (5 514 wierszy, 26% całego ruchu produkcyjnego w oknie)** leży poza kategorią
bezpieczną — 21 ma test starszy od zmiany, 30 ma test nietknięty, a **19 nie ma żadnego testu,
który by je importował**. Siedem z ośmiu dzisiejszych czerwieni pochodzi z tej właśnie puli.

**Wniosek jest więc precyzyjniejszy niż w poprzednich wydaniach: kampania modułowa nie rozcieńcza
dowodu, ale też nie chroni przed ruchem, który jej nie dotyczy.** Pięć kampanii dowiozło
+6,63 pp i zamknęło 140 zer; równolegle dwadzieścia pięć commitów bez testów zgasiło 272 testy
i złamało cztery progi. To dwa niezależne procesy w tym samym oknie i **jedyne, co je łączy, to
to, że drugi nie miał żadnej bramki**: przy 42 z 222 commitów o pustych komunikatach („Changes",
„Work in progress" — wszystkie 42 to commity bota, czyli 77,8% jego dorobku w oknie) kolejność
nazw plików i pokrycie per-ścieżka są **jedynymi** narzędziami datowania regresji.

### 8.4 Jeden błąd potoku wdrożeniowego, pięć zapaleń — ZAMKNIĘTE

Wydanie 8 opisywało w tym miejscu jedną przyczynę zapalającą pięć rzeczy naraz: dwie migracje klasy
„tenant scope" wjechały dwa razy pod różnymi nazwami, przez co padały dwa testy w `migrationReplay`,
jeden w `authzSnapshotParity` i dwie bramki `check:*`. Kopie miały **zero wierszy komentarza wobec
125 i 62 w oryginałach** i nosiły NAJNOWSZE znaczniki czasu, czyli zdejmowały z migracji ich własne
uzasadnienie.

**Jest naprawione.** Snapshot autoryzacji i lista migracji zgadzają się dziś co do jednego:
**935 = 935**, a `KNOWN_OPEN_GAPS` jest pusta. Żaden z pięciu wcześniejszych sygnałów nie występuje
w tym przebiegu — osiem dzisiejszych czerwonych plików to inne pliki i inna klasa przyczyn (12.2).

Zostawiam natomiast wniosek ogólny, bo w tym wydaniu okazał się mocniejszy, nie słabszy: **przy
commitach nazwanych „Changes" i „Work in progress" kolejność nazw plików migracji jest jedynym
narzędziem datowania regresji.** Rozdz. 12.8 podaje przypadek, w którym ta kolejność **jako jedyna**
uratowała izolację najemcy na plikach CV kandydatów: migracja psująca polityki bucketu i migracja
je przywracająca powstały trzy godziny po sobie, a stan bazy zdecydował się na tym, że naprawcza
sortuje się później. Gdyby znaczniki czasu wypadły odwrotnie, izolacja byłaby dziś otwarta na
produkcji — i żadna bramka by tego nie powiedziała. W tym oknie **42 z 222 commitów (18,92%) mają
komunikat bez treści informacyjnej, i wszystkie 42 to commity bota, czyli 77,8% jego dorobku.**

### 8.5 Siedem rzeczy, w których TEN audyt się mylił

Ten rozdział jest w dokumencie od wydania 5 i jest jego najważniejszą częścią, bo audyt bez
rejestru własnych pomyłek jest opinią. W tym wydaniu pozycji jest siedem — więcej niż kiedykolwiek,
i to nie przypadek: pierwszy raz puściłem większość pomiarów **równolegle, w kilkunastu niezależnych
wątkach analitycznych**, każdy z instrukcją „sprawdź moją liczbę, a jeśli się nie zgadza, zgłoś
rozbieżność, bo to cenniejsze niż potwierdzenie". Siedem z tych rozbieżności dotyczyło mnie.

**1. Podejrzewałem, że czerwień jest środowiskowa. Nie jest — i zmierzyłem to dwukrotnie.**
Uruchomiłem pomiar równolegle z pracą kilkunastu agentów na czterech rdzeniach i założyłem, że
testy przekraczają limit pod kontencją CPU. Sprawdzenie w izolacji:
`adminAnalyticsRoute.test.tsx` **271,58 s** wobec 270,34 s w pełnym przebiegu (różnica 0,5%),
`adminSettingsRoutes.test.tsx` **952,01 s** wobec 952,40 s (różnica **0,041%**). Przyczyna jest
strukturalna: ten czas to bierne czekanie na timerze, nie praca procesora. **Ostrożność była
słuszna, hipoteza fałszywa** — i dobrze, że sprawdziłem przed napisaniem, a nie po.

**2. Napisałem, że „188 padnięć na timeoucie `waitFor`" — a frazy `Timed out in waitFor` nie ma
w logu ani razu.** `grep -c` = 0. `waitFor` po wyczerpaniu budżetu rzuca **ostatni błąd asercji**,
nie własny komunikat o limicie; w logu stoi `expected undefined to be truthy`, 111 razy. Mechanizm
JEST limitem czasu (188 z 188 padnięć trwało ≥ 5 011 ms), ale treść komunikatu nie. Różnica jest
praktyczna: ktoś szukający w logu słowa „timeout" nie znalazłby niczego.

**3. Napisałem, że „pokrycie modułu 19 spadło realnie". Dla modułu — nie spadło.** To był mój
najpoważniejszy błąd tego wydania, bo pomyliłem dwa poziomy agregacji. Prawdą jest, że jedenaście
plików tras straciło pokrycie i że próg per-ścieżka to złapał. Nieprawdą jest, że moduł zregresował:
na 123 plikach nietkniętych padnięciem moduł 19 poszedł **w górę** (+0,63 pp linii, +0,85 pp
funkcji), a kontrfaktycznie stałby na 93,94% / 90,95%, czyli **wyżej niż w wydaniu 8**. Rachunek
zamyka się co do jednej linii i jednej funkcji (12.2). **Liczba modułowa nie jest fałszywa —
jest myląca, bo miesza szkodę z pracą.**

**4. Zarzuciłem komentarzowi przy progu w `vitest.config.ts`, że jest nieaktualny o 14,8 pp — a
został poprawiony. Mój skrypt czytał go błędnie.** Wzorzec wyciągający najnowszy wpis kroniki
wymagał postaci `X% instrukcji / Y% gałęzi`, a wpis z 2026-09-01 wstawia między nie liczniki
w nawiasach (`83,17% instrukcji (100 824/121 220) / 77,63% gałęzi`) — ukośnik wewnątrz
`100 824/121 220` łamał dopasowanie, więc skrypt cicho cofał się do wpisu o dwa ratchety starszego
i podawał 69,28%. Gdybym nie sprawdził, wydanie 9 powtórzyłoby zarzut wobec tekstu już naprawionego.
**Pomiar czytający cudzy tekst jest tak samo omylny jak tekst.**

**5. Podałem sprzeczne zagnieżdżenie progów pod złą ścieżką.** Pisałem
`src/routes/admin/versions/**` — takiego klucza w konfiguracji **nie ma**, i w ogóle nie ma ani
jednego progu pod prefiksem `src/routes/admin/`. Właściwa ścieżka to
`src/components/admin/versions/**`. Diagnoza (próg 7 przy pomiarze 96,47%, czyli bramka
wyłączona) była poprawna; ścieżka nie. Przy okazji: takich sprzecznych par jest **12 na czterech
katalogach**, a nie jedna.

**6. Wydanie 8 twierdziło, że repozytorium ma zero `: any` w kodzie pisanym ręcznie. Ma jedną —
i nie jest to regres tego okna.** `let payload: any` stoi w
`src/routes/platform/email/auth/webhook.ts:115`. Sprawdziłem, czy doszło w tym oknie:
`git show 8e771b983:…` pokazuje tę linię pod tym samym numerem, a plik nie ma w oknie ANI JEDNEGO
commitu. Czyli to była **moja pomyłka pomiarowa w wydaniu 8**, nie nowy dług. Dzisiejszy pomiar
w 3 305 plikach produkcyjnych pisanych ręcznie, z wygaszonymi komentarzami i literałami:
`as any` **0**, `: any` **1**, `as unknown as` **179** w 115 plikach.

**7. Prawie policzyłem zera złym filtrem — i różnica wyniosłaby 30% wyniku pracy pięciu
kampanii.** Warunek `lines.pct === 0` daje w raporcie wydania 9 **240** plików, a prawdziwych zer
jest **198**; różnicę stanowią 42 pliki bez ani jednej wykonywalnej linii, którym ten raport wpisuje
`pct: 0` — **a raport wydania 8 wpisuje tym samym 42 plikom `pct: 100`**. Skrypt po `pct` podałby
„338 → 240, minus 98" zamiast prawdziwego „338 → 198, minus 140". Sprawdziłem, którym filtrem liczy
ten audyt: `aggregate.mjs:39` używa `lines.total > 0 && lines.covered === 0` od pierwszego wydania,
więc opublikowane liczby są porównywalne. **Ale dowiedziałem się tego przez sprawdzenie, nie przez
założenie** — i przyczyny samego rozjazdu `pct` między dwoma raportami nie ustaliłem, co zapisuję
jako otwarte.

**Ósma pozycja, której nie liczę jako pomyłki, ale która należy do tego samego rejestru: dwie
liczby o commitach w oknie są OBIE poprawne.** „194 commity nie-merge" to zakres
`8e771b983..d737e1329`, czyli to, co weszło między dwoma pomiarami. `git log --since=2026-08-31`
daje **302** — bo 108 commitów ma datę autora po 2026-08-31, ale jest już przodkami `8e771b983`,
czyli siedzi w pomiarze wydania 8. Kontrola: 194 + 108 = 302. W całym dokumencie używam wyłącznie
zakresu między pomiarami i od tego wydania podaję tę definicję wprost, bo bez niej liczba jest
sporna, a spór jest o definicję, nie o fakt.

### 8.6 SSR, hydratacja i pierwsze wczytanie strony

**STATUS ZLECENIA Z WYDANIA 8: WYKONANE, jednym commitem.** Rozdział ten kończył się w wydaniu 8
listą jedenastu punktów, a punkt pierwszy brzmiał: `src/router.tsx` i `src/routes/__root.tsx` — dwa
pliki, przez które przechodzi każde pierwsze wczytanie — **nie były importowane przez ani jeden
test**. Commit `08d4cdbaa` (2026-09-01) to zamknął: oba pliki mają dziś **40 przypadków w trzech
plikach testowych** (`src/__tests__/router.test.tsx` 455 wierszy / 19 przypadków,
`routes/__tests__/rootRoute.test.tsx` 335 / 18, `routes/__tests__/rootShellRender.test.tsx` 105 / 3)
oraz **własne progi per-ścieżka wpisane tym samym commitem**. Osobny commit `20d3d59cd` dołożył
mierzalny spis tras publicznych bez rozgrzanego loadera: **17 z 82**.

Cztery rzeczy trzeba przy tym zapisać, bo trzy z nich są nowe, a jedna jest ostrzeżeniem.

**Doszły dwie stałe budżetowe, których w wydaniu 8 nie było:** `CHROME_WARM_BUDGET_MS = 500`
(twardy sufit DRUGIEJ fali rozgrzewki powłoki) i `HYDRATE_BUDGET_MS = 1500` (budżet hydratacji
wyciągnięty z `router.tsx` do osobnego modułu właśnie po to, żeby przestał być nieobserwowalny).
`ROOT_WARM_BUDGET_MS` nadal ma 2 500 i został **uwyeksportowany** (był stałą lokalną),
`SSR_DB_DEADLINE_MS` nadal ma 8 000 bez zmian.

**Zniknęła stała `CACHED_ROUTE_PREFETCH_BUDGET_MS = 6000`** — i to nie jest usunięcie kosmetyczne:
`prefetchCachedRouteQueries` przyjmuje dziś `budgetMs` jako **wymagany** czwarty argument, a jedyny
produkcyjny wołacz podaje `CHROME_WARM_BUDGET_MS = 500`, czyli budżet **dwunastokrotnie krótszy**.
Zmiana jest w dobrą stronę (budżet stał się jawny w miejscu użycia), ale wielkość skoku wymaga
sprawdzenia na runnerze, którego w repozytorium nie ma.

**Pomiar zapisany w konfiguracji jest STARSZY od dzisiejszego stanu testów i to trzeba czytać
ostrożnie.** Komentarz przy progach mówi o 17 przypadkach w `router.test.tsx` i 19 w parze `root`;
dziś jest 19 i 21. Liczby `100/100/100/100` dla `src/router.tsx` pochodzą więc z drzewa o dwa testy
mniejszego — i są **zapisanym pomiarem, nie progiem**. Dla `__root.tsx` ten sam komentarz podaje
44,20 / 53,33 / **14,58** / 50, czyli funkcje nadal poniżej piętnastu procent, a `rootShellRender.test.tsx`
ma jedyne w repozytorium **bezwarunkowe** `describe.skip` (12.3).

**Sprostowanie do własnego zdania z pierwszej wersji tego akapitu, dopisane po sprawdzeniu.**
Napisałem tu, że „nadal nie ma ANI JEDNEJ bramki na budżety SSR" i że jest to _jedyna_ niedomknięta
pozycja tej listy. **Oba zdania są nieprawdziwe** i jedno jest nieprawdziwe w drugą stronę, niż
sugerowałem. Sprawdzone na dzisiejszym HEAD:

- **Bramka czasu ISTNIEJE i ma twarde asercje.** `e2e/boot-timing.spec.ts` jedzie po zbudowanym
  artefakcie w jobie CI bez `continue-on-error` i oblewa na `expect(...).toBeLessThan(...)`:
  `MAX_TTFB_MS = 8_000` (:105, asercja :379), `MAX_READY_MS = 6_000` (:127, :390),
  `MAX_BOOT_JS_TRANSFER_KB = 3_000` (:171, :403). Istnieje też **pierwszy zapisany pomiar
  z runnera** (:177-190, 2026-09-01, przebieg 33512138238): TTFB 5 030,1 ms, ready 356 ms,
  bootJS 2 562,8 KB, **FCP 5 272,0 ms**.
- **Bramka rozmiaru liczy dziś `.css` i domknięcie startowe.** `FROZEN_BUDGET_KB`
  w `scripts/check-bundle-size.ts:1151` ma pięć podłóg: chunk 280, public 2 715, overall 4 351,
  **css 82**, **boot 579** — czyli punkty 5(a) i 8 z listy wydania 8 są zamknięte.
- **Budżety rozgrzewki spadły z „do 11 s" na 3 000 ms.** Fala 2 dostała własny, dwunastokrotnie
  krótszy budżet (`CHROME_WARM_BUDGET_MS = 500` wobec 2 500), a prefetch strony głównej został
  **zdjęty z drogi krytycznej** — `src/routes/index.tsx:184-198` dokumentuje, że serwer już go
  nie woła, a `HomeBuilderContent` przekazuje `stream`.

**Poprawna wersja zarzutu jest więc WĘŻSZA, a nie łagodniejsza: nie ma bramki na budżety
WEWNĘTRZNE potoku.** Trzy konkretnie: suma budżetów rozgrzewki przed pierwszym bajtem (dziś
3 000 ms, jedna liczba w jednym pliku), liczba równoległych podżądań w loaderze wobec limitu
**6 subrequestów** runtime Workers (który w repozytorium występuje wyłącznie jako komentarz)
oraz rozmiar dehydratowanego stanu. Do tego dochodzi rzecz, której nie widziałem, dopóki nie
przeczytałem zapisanego pomiaru: **FCP 5 272 ms jest jedyną z czterech metryk pierwszego
wczytania, która nie ma progu w ogóle** — w kolumnie „PRÓG" tej kroniki stoi `brak`. A FCP jest
tą, którą czytelnik odczuwa jako „strona się pojawiła".

**Druga rzecz, której nie widziałem: podłoga `css` ma 1,25% zapasu.** Zmierzone na artefakcie
w `.output/`: `styles-*.css` to 570 419 B surowo i **81 513 B gzip**, plus 1 402 B drugiego
arkusza — razem **80,972 KiB wobec podłogi 82 KiB**, czyli **1,028 KiB marginesu** przy 6 739
blokach reguł. Jedna średnia zmiana designu tę podłogę przebije.

**Sprostowanie do powyższego akapitu** (dopisane po ponownym pomiarze): pierwsza wersja tego
zdania mówiła o **3,4% i 2,8 KiB marginesu** i była błędna — nie w kodzie, a w narzędziu pomiaru.
Mierzyłem `gzip -9`, a bramka liczy `Bun.gzipSync(...)` **bez drugiego argumentu**, czyli na
domyślnym poziomie kompresji (`scripts/check-bundle-size.ts:1447`). Ta jedna różnica poziomu to
1 694 B na arkuszu głównym — więcej niż waży cały drugi arkusz. Margines jest więc **2,7 raza
mniejszy**, niż podałem: nie 2,8 KiB, a 1,028 KiB. Punkt 5(b) z wydania 8 — wycięcie panelu
i buildera do osobnego arkusza — jest więc jedyną pozycją tej listy, która przestała być
optymalizacją i stała się terminem.

Zlecenie naprawcze na to, co realnie zostało, jest w `docs/PROMPT_SSR_PIERWSZE_WCZYTANIE.md`.

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

**Jak czytać tę listę.** Jest to lista z **wydania 8**, przedrukowana dla zapisu, a nie dzisiejsze
zadanie — zlecenie z wydania 8 zostało wykonane (patrz nagłówek tego rozdziału) i część punktów
niżej jest już zamknięta w kodzie. Punkt 1 zamknął commit, który dał fali 2 własny,
dwunastokrotnie krótszy budżet (`CHROME_WARM_BUDGET_MS = 500`); punkt 2 — zdjęcie prefetchu strony
głównej z drogi krytycznej (`src/routes/index.tsx:184-198`); punkt 5 przestał być optymalizacją
i **stał się terminem**, bo bramka arkusza ma dziś 1,25% zapasu (patrz sprostowanie wyżej).
**Rozstrzygnięty status każdego z jedenastu punktów, z plikiem i linią, mieszka w sekcji
„0. Co jest ustalone" zlecenia `docs/PROMPT_SSR_PIERWSZE_WCZYTANIE.md`** — nie tutaj; ta lista
zachowuje brzmienie wydania 8, żeby dało się porównać, co się zmieniło. To, co do listy **doszło**
po limicie sesji, jest w rozdz. 8.7 (dwa nowe ustalenia, dwa sprostowania, jedno
przekwalifikowanie).

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
serializacji i dwa incydenty spisane razem z naprawą. I jednocześnie: **13 000 ms budżetów
loadera na trasie łapiącej wszystko** przed pierwszym bajtem (zmierzone w 8.7; korzeń zszedł
do 3 000 ms, trasa nie), arkusz 570 KB z podłogą, która ma 1,25% zapasu, słownik bez preloadu,
zdegradowany render wchodzący do cache na dobę na dwóch trasach, cztery publiczne powierzchnie
oddające błąd przy statusie 200, **zero pokrytych linii w dwóch plikach, które posiadają
wszystkie te budżety** — i płaszczyzna roli serwisowej, która przed routerem robi dwa round-tripy
do bazy **bez żadnego terminu.**

### 8.7 Sześć wymiarów pomiaru SSR domkniętych ręcznie po limicie sesji

Rozdział 8.6 powstał z ośmiu niezależnych ujęć zleconych równolegle. **Dwa wróciły z wynikiem,
sześć padło** na `You've hit your session limit · resets 12:20pm (UTC)` - razem z dwoma etapami
weryfikacji, które miały te wyniki skonfrontować. Ten podrozdział jest domknięciem tych sześciu
wymiarów, zmierzonym ręcznie, bez agentów: `cache`, `degradacja`, `bramki`, `css`, `testy`, `e2e`.
Trzy z nich dodają do listy z 8.6 pozycje, których na niej nie było, a dwa **poprawiają liczbę,
którą ten audyt sam podał** - dlatego są tutaj, a nie w załącznikach.

#### Wymiar `cache`: klucz dokumentu jest najlepiej przetestowanym elementem tej warstwy, a jego wejście - najgorzej

Klucz ma postać `host::pathname?keyedParams` i rodzi się w jednej czystej funkcji
(`src/lib/http/documentCache.ts:152-181`). Skład sprawdziłem wymiar po wymiarze - każdy, który
może zmienić ciało odpowiedzi:

- **najemca**: klucz jest zawsze prefiksowany hostem (`:179-180`), więc wpis rozgrzany dla
  tenanta A jest nieosiągalny na domenie tenanta B; przy braku hosta scope to jawne `no-host`.
  Izolacja z konstrukcji, nie z warunku;
- **język**: nie występuje w kluczu **jawnie i nie musi** - PL żyje na gołej ścieżce, EN pod
  `/en`, więc język JEST częścią `pathname`. `stripLangPrefix` (`:118-121`) służy wyłącznie do
  dopasowania listy zakazanych prefiksów (`:124`), nigdy do budowy klucza;
- **parametry**: biała lista ma dokładnie dwie pozycje - `page` i `sort` (`:115`). Parametry
  kampanijne (`utm_*`, `fbclid`, `gclid`, `msclkid`, `ref`, `mc_cid`, `mc_eid` - `:109-110`) są
  **usuwane**, więc wizyta z linku reklamowego trafia w ten sam wpis co czysta. Każdy inny,
  nieznany parametr to BYPASS z powodem `query` (`:174`) - celowa obrona przed zaśmieceniem
  przestrzeni kluczy (eviction-DoS);
- **sesja**: `Authorization` albo jakiekolwiek ciasteczko `sb-*` to BYPASS z powodem `auth`
  (`:157-162`), mimo że Supabase trzyma sesję w `localStorage`. Fail-safe w stronę BYPASS-u;
- **negocjacja nagłówkowa**: jedyną powierzchnią, na której język jest negocjowany z nagłówków,
  jest goła strona główna (`src/start.ts:118-161`). Ta ścieżka nie może zanieczyścić cache'a
  z dwóch niezależnych powodów: redirect to 302 z `Cache-Control: no-store` i
  `Vary: Cookie, Accept-Language` (`:157-159`), a gałąź bez redirectu renderuje język
  **domyślny** i dokłada tylko `Set-Cookie` (`:135`, `:139-155`).

Ostatni punkt otwiera pytanie, które w tym wymiarze było najgroźniejsze: **czy `Set-Cookie`
dopięty do renderu może zostać odtworzony z cache'a innemu czytelnikowi.** Nie może, i to nie
przez wycięcie, a przez **białą listę czterech nagłówków**: wpis zapamiętuje wyłącznie
`content-type`, `cache-control`, `content-language` i `link`
(`documentCache.server.ts:484-487`), a serwowanie buduje `new Headers({...})` od zera
(`:332-345`). Nagłówek, którego nie ma na liście, nie istnieje dla cache'a - `Set-Cookie`,
`Vary` i cała reszta włącznie.

Domyka to **kolejność middleware** (`start.ts:443-461`): `securityHeadersMiddleware` stoi na
pozycji 2, `documentCacheMiddleware` na 10. Zewnętrzne uruchamia się pierwsze i kończy ostatnie,
więc trafienie w cache **nadal** dostaje CSP, HSTS i świeże ciasteczko poświadczenia najemcy -
bo te powstają ZA cache'em, nie w nim. Symetrycznie `homepageLangMiddleware` (pozycja 7) jest
NA ZEWNĄTRZ cache'a, więc redirect językowy nigdy nie dociera do lookupu.

Pokrycie tej funkcji jest wzorowe: `documentCache.ts` **43/43 linii (100,00%), 9/9 funkcji
(100,00%), 47/49 gałęzi (95,91%)**, dwanaście testów, w tym jeden nazwany wprost
_„scopes keys by tenant host, with a no-host fallback scope"_
(`__tests__/documentCache.test.ts:107`).

**I tu jest ta asymetria.** Wartość `host`, na której cała ta izolacja stoi, pochodzi
z `src/lib/http/requestHost.ts` - **2/20 linii (10,00%), 2/4 funkcji (50,00%)** - a jego
serwerowa połowa `requestHost.server.ts` ma **0/16 linii i 0/4 funkcji, czyli zero**. Pokryte są
dokładnie dwie linie: 28 i 39. Niepokryte funkcje: `currentTenantHost` (`:61`)
i `currentTenantAssertion` (`:91`). Ten sam wzorzec w `tenantAssertionCookie.server.ts`:
**1/16 linii (6,25%), 0/2 funkcji**.

Przyczyna nie jest zaniedbaniem, jest **kształtem środowiska** - i dlatego to nie jest zero
tej samej klasy co inne zera w tym audycie. `vitest.config.ts:7` ustawia
`environment: "happy-dom"`, więc `window` ISTNIEJE, `import.meta.env.SSR` jest fałszywe,
a gałąź serwerowa obu funkcji jest **nieosiągalna z definicji**: `currentTenantHost` wraca
na linii 63 z `window.location.host`, a dynamiczny import `./requestHost.server` nigdy się nie
wykonuje. Naprawa to jeden plik z `// @vitest-environment node` - wzorzec już obecny
w repozytorium **czternaście razy**, w tym dwa razy w tych samych katalogach
(`src/lib/http/__tests__/ssrTiming.server.test.ts:1`,
`src/lib/server/__tests__/publishedContent.server.test.ts:1`).

Do tego dochodzi obserwacja o innym charakterze: **`@/lib/http/requestHost` jest podmieniany na atrapę
w dwudziestu sześciu plikach testowych** w całym repozytorium. To jest szew, który cała platforma
zastępuje atrapą - i jednocześnie jedyny szew tej warstwy, którego nikt nie sprawdza
w prawdziwej postaci.

#### Wymiar `degradacja`: doktryna jest napisana, mechanizm istnieje, szesnaście tras go używa - i trasa łapiąca wszystko nie

Reguła jest w repozytorium sformułowana wzorowo, w docblocku
`src/lib/ssr/resilientLoad.ts:123-138`: _„Render zdegradowany NIE MOŻE trafić do cache'a
wspólnego: brzeg serwowałby pustą powłokę kolejnym czytelnikom przez cały okres świeżości,
długo po tym, jak backend wrócił do zdrowia."_ Mechanizmem jest
`resilientCacheControl(degraded, cleanPolicy)` (`:140-144`), z drugim parametrem dodanym
2026-09-01, żeby `/live` nie tracił swojej świeżości mierzonej w sekundach.

Zliczyłem, kto go używa. **Dwadzieścia dwa pliki tras ustawiają nagłówek `Cache-Control`.**
Z tego:

| stan                                  |   ile | które                                                                                                                                                                  |
| ------------------------------------- | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| bramkuje jawnie na degradacji         |    16 | 14 przez `resilientCacheControl` + `index.tsx` (goła strona główna) + `tracker.index.tsx:105-107`                                                                      |
| emituje wyłącznie `no-store`          |     1 | `post.$slug.tsx:21` (zaślepka przekierowania)                                                                                                                          |
| nie ma ścieżki degradacji             |     1 | `category.$slug.tsx` - ani budżetu, ani `allSettled`: albo są dane, albo 404 z `NO_STORE` (`:60-63`)                                                                   |
| bramkuje ciało, nie `head()`          |     1 | `blog.index.tsx` - brak listy daje `NO_STORE` (`:79`), ale lapsus `withBudget` na ustawieniach serwisu (`:50`) przechodzi po cichu do współdzielonego nagłówka (`:82`) |
| **może utrwalić render zdegradowany** | **2** | **`$.tsx`, `sitemap.tsx`**                                                                                                                                             |

`contentCacheControl()` ma dokładnie dwa opt-outy - `personalized` i `preview`
(`cachePolicy.ts:66-67`). **Wejścia „zdegradowany" nie ma w ogóle**, więc trasa, która nie
przepuści decyzji przez `resilientCacheControl`, emituje na renderze niepełnym dokładnie ten sam
nagłówek co na pełnym: `public, max-age=60, s-maxage=900, stale-while-revalidate=86400`.
`documentStorePolicy` przyjmuje go bez zastrzeżeń (200 + `text/html` + `public` + `s-maxage>0`,
`documentCache.ts:197-212`) i ucina świeżość do 180 s, a okno stale do 24 h (`:47`, `:57`).
Efekt: **niepełny dokument wchodzi do L1 i do L2 kolonii na 3 minuty świeżości plus dobę
serwowania stale.**

W `$.tsx` - trasie łapiącej wszystko, czyli KAŻDEJ stronie CMS-a - dzieje się to w sposób,
którego nie da się naprawić na miejscu jednym warunkiem, bo **nagłówek jest ustawiany przed
pracą, która może zdegradować**. Kolejność w loaderze jest taka:

1. `:237-239` - główna treść w `withBudget(..., PRIMARY_CONTENT_BUDGET_MS = 5 000)`;
2. `:242-281` - brak danych obsłużony **poprawnie**: `setCacheControlHeader(NO_STORE)` na każdej
   z czterech gałęzi (taksonomia, kanoniczny redirect, stary adres wpisu, 404);
3. `:288` - `setCacheControlHeader(contentCacheControl())`;
4. `:303-354` - `withBudget(Promise.allSettled([...]), SECONDARY_PREFETCH_BUDGET_MS = 3 000)`:
   typografia prozy, sekcje nad zgięciem, zapytania bloków, konfiguracja „powiązanych", lista
   dzieci strony sekcyjnej;
5. `:358-360` - ustawienia serwisu w kolejnym `withBudget(..., 5 000)`.

Kroki 4 i 5 degradują **milcząco** (`allSettled` + `.catch(() => undefined)`) na nagłówku, który
wyszedł już w kroku 3.

**I to się w tym repozytorium już raz zdarzyło, na tej samej trasie.** Komentarz w `$.tsx:344-350`
zapisuje incydent dosłownie: strony sekcyjne (`template_type === 'archive_listing'`) ciągnęły
całą swoją treść zwykłym `useQuery`, który na serwerze nie startuje fetcha - _„SSR emitował więc
gałąź przejściową i ten HTML wchodził do NES Edge Cache na do 24 h - a trasy sekcyjne są typowo
najsilniejsze linkowo w całym serwisie."_ Naprawa dodała prefetch **do kroku 4**. Nie
zabramkowała nagłówka. Jeżeli ten prefetch przekroczy budżet 3 000 ms, ten sam pusty HTML wejdzie
do cache'a tą samą drogą.

`sitemap.tsx` jest przypadkiem czystszym i dlatego dobitniejszym: `setCacheControlHeader(
contentCacheControl())` jest **pierwszą instrukcją loadera** (`:59`), a trzy zapytania budujące
całą treść mapy strony lecą zaraz po nim w `Promise.allSettled` **bez budżetu i bez sprawdzenia
wyniku** (`:60-64`). Odrzut któregokolwiek daje ludzką mapę serwisu z brakującą gałęzią,
utrwaloną na dobę.

Kontrprzykład, który dowodzi, że wzorzec jest w zespole znany i opisany:
`tracker.index.tsx:102-107` ma nad wywołaniem komentarz _„ISR-owy nagłówek NA KOŃCU, bramkowany
czystym renderem (wzorzec «/»)"_.

#### Wymiar `bramki`: nie ma bramki na budżety wewnętrzne, a suma budżetów jest większa, niż ten audyt napisał

Zinwentaryzowałem **wszystkie piętnaście stałych budżetowych** w `src/`:

| stała                             | wartość | plik                                                          |
| --------------------------------- | ------: | ------------------------------------------------------------- |
| `PRIMARY_CONTENT_BUDGET_MS`       |   5 000 | `routes/$.tsx:166` (użyta **dwa razy**: `:239`, `:360`)       |
| `RESILIENT_LOAD_BUDGET_MS`        |   4 000 | `lib/ssr/resilientLoad.ts:46`                                 |
| `TRACKER_LOADER_BUDGET_MS`        |   4 000 | `routes/tracker.index.tsx:55`                                 |
| `BLOG_LOADER_BUDGET_MS`           |   4 000 | `routes/blog.index.tsx:35` (użyta **dwa razy**: `:50`, `:66`) |
| `SECONDARY_PREFETCH_BUDGET_MS`    |   3 000 | `routes/$.tsx:165`                                            |
| `ROOT_WARM_BUDGET_MS`             |   2 500 | `routes/__root.tsx:78`                                        |
| `ABOVE_FOLD_PREFETCH_BUDGET_MS`   |   2 500 | `lib/builder/prefetch.ts:554`                                 |
| `SUPPORT_DOC_BUDGET_MS`           |   2 500 | `lib/supportRouteConfig.ts:5`                                 |
| `POSITIONS_BUDGET_MS`             |   2 000 | `routes/tracker.explorer.tsx:51`                              |
| `TIMELINE_BUDGET_MS`              |   2 000 | `routes/tracker.$slug.tsx:45`                                 |
| `DOC_BUDGET_MS`                   |   2 000 | `routes/checkout.success.tsx:31`                              |
| `SERVER_SECTION_STREAM_BUDGET_MS` |   2 000 | `lib/builder/sectionStreaming.tsx:49`                         |
| `HYDRATE_BUDGET_MS`               |   1 500 | `lib/ssr/hydrateBudget.ts:39`                                 |
| `TRACKER_FOLLOWERS_BUDGET_MS`     |   1 500 | `routes/tracker.index.tsx:57`                                 |
| `CHROME_WARM_BUDGET_MS`           |     500 | `routes/__root.tsx:100`                                       |

**Sprostowanie własnego twierdzenia.** Rozdział 8.6 mówi w dwóch miejscach o „do 11 s budżetów
loaderów": raz jako o wielkości, która _„spadła z «do 11 s» na 3 000 ms"_, raz w zdaniu
zamykającym. Obie wersje są prawdziwe **o korzeniu** - obie fale rozgrzewki siedzą w tym samym
loaderze `__root.tsx` (`:373` i `:508`), więc jego pułap to rzeczywiście 2 500 + 500 = 3 000 ms -
i obie **pomijają trasę**. Zmierzone dziś: `$.tsx` niesie w JEDNYM loaderze
5 000 + 3 000 + 5 000 = **13 000 ms** szeregowego budżetu, a `blog.index.tsx` 4 000 × 2 = 8 000 ms.
Pułap pierwszego bajtu dla dowolnej strony CMS-a to więc **13 000 ms**, nie 3 000 i nie 11 000.
Zlecenie `docs/PROMPT_SSR_PIERWSZE_WCZYTANIE.md` podawało dla „trasy treściowej" 7 000 ms - liczba
poprawna dla rodziny tras odpornych (korzeń 3 000 + `RESILIENT_LOAD_BUDGET_MS` 4 000), ale nie dla
trasy łapiącej wszystko.

Bramek `check:*` jest trzydzieści dziewięć. Boot i paczki dotyczą cztery: `check:bundle`,
`check:chunks`, `check:chunk-parity`, `check:entry-purity`. **Zero** bramek pilnuje: sumy budżetów
loadera, liczby równoległych podżądań wobec limitu 6 subrequestów runtime Workers, rozmiaru
dehydratowanego stanu - i, nowa pozycja z tego pomiaru, **reguły „trasa, której loader może
zdegradować, MUSI zabramkować swój `Cache-Control`"**. Ta ostatnia jest najtańszą bramką na całej
liście rozdziału 8.6: skrypt po `src/routes/**`, który zapala się na pliku importującym
`withBudget`/`loadResilient` albo wołającym `Promise.allSettled`, a ustawiającym
`contentCacheControl()` bez `resilientCacheControl`. Dziś zapaliłby się na **dwóch** plikach
i utrwaliłby regułę, którą repozytorium już zna, ale pilnuje wyłącznie recenzją.

#### Wymiar `css`: sprostowanie - margines jest 2,7 razy mniejszy, niż ten audyt podał

Szczegóły i poprawiona liczba są w akapicie „Druga rzecz, której nie widziałem" wyżej w tym
rozdziale: **80,972 KiB wobec podłogi 82 KiB, czyli 1,028 KiB (1,25%) marginesu**, nie 2,8 KiB
i nie 3,4%. Błąd był w narzędziu pomiaru, nie w kodzie: mierzyłem `gzip -9`, a bramka liczy
`Bun.gzipSync(...)` bez drugiego argumentu, czyli na domyślnym poziomie kompresji
(`scripts/check-bundle-size.ts:1447`). Ta jedna różnica poziomu to 1 694 B na arkuszu głównym -
więcej niż cały drugi arkusz.

#### Wymiar `testy`: każda czysta funkcja tej warstwy jest przetestowana, żaden punkt spięcia nie jest

Zmierzone na tym samym przebiegu, sześć grup plików drogi pierwszego wczytania:

| grupa                            | plików |   linie |          % | funkcje |          % | gałęzie |     % |
| -------------------------------- | -----: | ------: | ---------: | ------: | ---------: | ------: | ----: |
| `src/lib/ssr/**`                 |      6 | 149/153 |      97,39 |   39/39 | **100,00** |   83/97 | 85,57 |
| `src/lib/asyncBudget.ts`         |      1 |   12/12 | **100,00** |     3/4 |      75,00 |     6/8 | 75,00 |
| `src/lib/builder/prefetch.ts`    |      1 | 200/216 |      92,59 |   41/46 |      89,13 | 157/188 | 83,51 |
| `src/lib/http/**`                |     23 | 773/907 |      85,23 | 134/162 |      82,72 | 557/699 | 79,69 |
| `src/routes/__root.tsx`          |      1 |  67/128 |      52,34 |    7/48 |  **14,58** |   27/49 | 55,10 |
| `src/start.ts` + `src/server.ts` |      2 |  82/168 |      48,81 |   13/26 |      50,00 |  44/140 | 31,43 |

Układ jest jednoznaczny i mieści się w jednym zdaniu: **wszystko, co jest czystą funkcją, ma
pokrycie bliskie stu procent; wszystko, co jest spięciem, ma pokrycie bliskie połowie albo niżej.**
`documentCache.ts` 100%/100% i `requestHost.server.ts` 0%/0% leżą w tym samym katalogu i różnią
się jedną rzeczą - czy da się je wywołać bez środowiska serwera.

Najostrzejszy pojedynczy wynik tej tabeli to `src/start.ts`: **35/109 linii (32,11%), 3/14 funkcji
(21,42%), 19/93 gałęzi (20,43%)**. Pokryte są trzy: `isPreviewRequest` (`:201`),
`contentSecurityPolicy` (`:209`), `applySecurityHeaders` (`:343`) - czyli czysta część nagłówków
bezpieczeństwa. Niepokrytych jest jedenaście, w tym `isInternalPlatformPath` (`:34`) i **ciała
wszystkich middleware'ów** (`:42`, `:74`, `:118`, `:245`, `:260`, `:285`, `:291`, `:313`, `:407`,
`:410`). Jedenaście z czternastu funkcji korzenia kompozycyjnego całego potoku żądania nigdy nie
zostało uruchomionych przez test.

#### Wymiar `e2e` i ustalenie blokujące: płaszczyzna roli serwisowej nie ma ŻADNEGO terminu

To jest jedyne ustalenie z sześciu wymiarów, którego nie było na liście jedenastu punktów
z rozdziału 8.6, a które oceniam wyżej niż większość tej listy.

Przed routerem - a więc i przed jakimkolwiek budżetem loadera, i przed konsultacją cache'a
dokumentów - biegną **dwa round-tripy do bazy rolą serwisową**:

1. `redirectMiddleware` (pozycja 6 w łańcuchu) → `src/lib/seo/redirects.server.ts:54-75`:
   `await supabaseAdmin.from("redirects").select(...).limit(5000)`;
2. rozwiązanie hosta na najemcę → `src/lib/server/tenant.server.ts:68-85`:
   `await supabaseAdmin.from("tenants").select(...).limit(500)`.

Żaden z nich nie jest owinięty w `withBudget`, żaden nie przekazuje `AbortSignal`,
a `src/integrations/supabase/client.server.ts` - całe 41 linii - **nie konfiguruje ani własnego
`fetch`, ani żadnego timeoutu**. Nie ma więc terminu na tej płaszczyźnie w ogóle, w żadnym
miejscu.

Oba mają `try/catch` z zejściem na przeterminowany cache (`redirects.server.ts:71-75`,
`tenant.server.ts:84-86`) i to jest dobra obrona - **ale przed BŁĘDEM, nie przed powolnością.**
Zawieszone połączenie nie rzuca; ono czeka. A czeka **przed** cache'em dokumentów
(`documentCacheMiddleware` to pozycja 10), więc nawet trafienie w gorący wpis nie ratuje
czytelnika przed tym oczekiwaniem.

Częstotliwość wynika z TTL-i: `REDIRECT_CACHE_TTL_MS = 30_000` (`redirects.server.ts:44`)
i `CACHE_TTL_MS = 60_000` (`tenant.server.ts:40`). Na rozgrzanym izolacie oznacza to, że jedno
żądanie na 30 sekund i jedno na 60 sekund płaci pełny round-trip bez sufitu; na zimnym izolacie
płaci je pierwszy czytelnik.

Pokrycie **nie jest** tu problemem i to jest właśnie sedno: `redirects.server.ts` ma
**63/63 linii (100,00%) i 11/11 funkcji (100,00%)**, `tenant.server.ts` **68/70 (97,14%)
i 17/17 (100,00%)**. Brakuje nie testu, brakuje **terminu**. To jest ustalenie, którego
pokryciem nie da się wykryć - i dlatego zamyka ten rozdział, a nie tabelę.

#### Co sześć wymiarów dodaje do listy z 8.6

Dwie nowe pozycje, dwa sprostowania i jedno przekwalifikowanie:

1. **NOWE, blokujące**: nadać termin płaszczyźnie roli serwisowej (`withBudget` albo
   `AbortSignal` na obu round-tripach przed routerem). Bez tego wszystkie budżety loaderów
   pilnują odcinka, który nie jest najdłuższy.
2. **NOWE, najtańsza bramka na liście**: reguła CI „loader, który może zdegradować, bramkuje
   swój `Cache-Control`" - dziś dwie trasy jej nie spełniają, w tym trasa łapiąca wszystko.
3. **SPROSTOWANIE liczby**: margines podłogi `css` to 1,25%, nie 3,4%.
4. **SPROSTOWANIE twierdzenia**: pułap budżetów przed pierwszym bajtem to 13 000 ms na trasie
   łapiącej wszystko, nie 3 000 ms (korzeń) ani 11 000 ms (wydanie 8).
5. **PRZEKWALIFIKOWANIE**: zero w `requestHost.server.ts` i `tenantAssertionCookie.server.ts` nie
   jest zaniedbaniem, a skutkiem środowiska `happy-dom`. Naprawa to jeden plik z dyrektywą
   `// @vitest-environment node`, której repozytorium używa już czternaście razy. To najtańszy
   punkt tej listy i jednocześnie ten, który domyka szew izolacji najemcy.

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

**UZUPEŁNIENIE 2026-09-02 (kampania modułu 07) - CZWARTY wyjątek łapacza tras, tej samej
klasy co trzy wyjątki z wydania 6.** Odtworzenie mappera przy tej kampanii wykazało, że
`src/routes/admin.newsletter.deliverability.tsx` wpada do **MODUŁU 7**, choć należy do
**MODUŁU 11** (newsletter): łapacz tras modułu 7 zawiera człon `live`, a „de**live**rability"
go zawiera. Łapacz modułu 11 (`^src\/routes\/.*newsletter`) stoi PO nim, więc pierwsze
trafienie oddaje tę trasę modułowi 7. Mechanizm jest identyczny jak przy `popup-event.ts`
i pozostałych dwóch: człon łapacza trafia w środek innego słowa. Rozstrzygnięcie: **ta trasa
należy do modułu 11** i tak jest liczona w rozdziale kampanii na końcu tego dokumentu.

**Trzy pozostałe pliki, których wydanie 8 nie mogło widzieć.** Poza powyższym artefaktem
łapacz modułu 7 objął trzy trasy dopisane na maina **2026-08-29**, czyli jedenaście dni po
tym wydaniu: `admin.community.polls.tsx` (człon `poll`), `admin.community.qa.tsx` (człon
`qa`) i `club.$clubSlug.experts.tsx` (człon `expert`). Wszystkie trzy są w module 7 zgodnie
z regułami - to nie artefakty, tylko nowa powierzchnia produktowa.

**KONSEKWENCJA DLA DELT.** Mianownik modułu 7 wyrósł z **95 na 99 plików bez żadnej pracy
testowej**, wyłącznie przez ruch na mainie. Delta liczona „nowe 99 wobec starych 95"
mierzyłaby przesunięcie granicy, nie pracę - dokładnie ten błąd, przed którym wydanie 6
zabezpieczyło się, przeliczając cały poprzedni przebieg nową mapą po wydzieleniu modułu 22.
Dlatego rozdział kampanii podaje **dwie liczby**: pomiar na dzisiejszym zbiorze plików
i pomiar zawężony do tych 95, które wydanie 8 faktycznie mierzyło. Sprawdzenie wiarygodności
odtworzonego mappera: reprodukuje **biblioteczną połowę modułu 7 co do jednego pliku**
(58 wobec 58 w wydaniu 8), a cała rozbieżność 41 wobec 37 tras rozkłada się na cztery pliki
wymienione wyżej.

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

### 9.2 Pliki testowe wyłączone z pomiaru — ŻADEN, ale pięćdziesiąt jeden nie biegnie

Wydanie 1 musiało wykluczyć 39 plików (464 testy), które wisiały bez końca w fazie kolekcji —
wszystkie z dwóch powierzchni MODUŁU 3: `components/admin/builder/**` i
`components/builder/organisms/widget-view/**`. Przyczyną było zakleszczenie cyklu pod fabryką
`vi.mock` w warstwie leniwych widgetów, nie „za wolne testy”. Zostało naprawione
(`widget-view/lazySuspense.tsx`), a komentarz przy progu globalnym w `vitest.config.ts` datuje
odzysk na 1 026 testów. **Od wydania 2 z pomiaru nie jest wykluczony ani jeden plik testowy i to
się nie zmieniło.**

Zmieniło się natomiast to, co wiem o testach, które **biegną, ale nic nie dowodzą** — i w tym
wydaniu przestaję to opisywać jako przypis, bo dotyczy 52 testów i dwóch bramek bezpieczeństwa.

**Pięćdziesiąt jeden pominiętych, z czego pięćdziesiąt NIE BIEGNIE TAKŻE NA CI.**
`src/__tests__/db-schema-invariant.test.ts` (45) i `src/__tests__/lang-parity.test.ts` (5) startują
tylko przy `VITE_SUPABASE_URL` i kluczu publikowalnym. Pisałem w wydaniach 7 i 8, że „na CI
z sekretami wykonują się". **Sprawdzone i nieprawdziwe:** job `test` w `.github/workflows/ci.yml`
(deklaracja `:685`, krok „Test + coverage gate" `:728-730`) **nie ma bloku `env`**, a workflow nie
ustawia tych zmiennych na swoim poziomie. Potwierdza to log CI zapisany w samym repozytorium
(`scripts/vitest/testAccountingReporter.ts:8`, przebieg z 2026-08-27): „50 skipped" — dokładnie
45 + 5. Komentarz w `vitest.config.ts:5133-5138` twierdzi wprost, że te pliki „w CI, z prawdziwymi
poświadczeniami, przechodzą" — i to twierdzenie jest fałszywe dla joba, który jako jedyny odpala
suitę. **Konsekwencja: inwariant „wygenerowane typy nadal opisują schemat, który baza ma naprawdę"
nie jest w tym repozytorium sprawdzany nigdzie.** Najtańsza naprawa: `db-schema-invariant.test.ts:131`
to czysta kontrola wygenerowanych typów, **która bazy nie potrzebuje wcale** — wystarczy wyjąć ją
z bramkowanego bloku.

**Pięćdziesiąty pierwszy to pominięcie BEZWARUNKOWE i jedyne takie w repozytorium.**
`src/routes/__tests__/rootShellRender.test.tsx:91` — `describe.skip` na `RootComponent`. Regres
wobec zapisu wydań 4-8; rozbiór w 12.3.

**Dwa testy CSRF biegną, ale zawsze wychodzą przed pierwszą asercją.**
`src/__tests__/csrfMiddleware.integration.test.ts:29` i `:44` mają `if (!(await serverReachable())) return;`
przy `BASE = process.env.CSRF_TEST_BASE ?? "http://localhost:8080"`, a w `.github/workflows/` nie ma
ani jednego wystąpienia „8080", „CSRF_TEST_BASE", „vite dev" ani „preview". Plik powołuje się przy
tym w komentarzu na zapasowe pokrycie w `/e2e/csrf.spec.ts` — **którego nie ma**. To jest gorsze niż
brak testu: brak testu widać w tabeli, a fałszywe odwołanie do warstwy, która nie istnieje, wygląda
jak pokrycie (rekomendacja R9).

**Jeden plik e2e nie jest wołany przez żaden workflow.** `e2e-ab/bootCompare.spec.ts` (1 test) jedzie
tylko przez ręcznie uruchamiany `scripts/measure-boot-ab.ts`; `playwright.ab.config.ts` nie występuje
w `.github/` ani w `package.json`.

**Czternaście testów `e2e/user-paths.spec.ts` pomija się w jobie `e2e` — i to NIE jest luka**, bo
biegną w osobnym jobie `e2e-seeded`, który ustawia `E2E_SEEDED=1` i odpala wprost ten plik. Podaję
to dla kompletności, bo naiwny skan pominięć policzyłby je jako dług.

Razem: **testów, które w CI nie biegną nigdy — 52** (50 na warunku środowiskowym + 1 bezwarunkowe
pominięcie + 1 sierocy plik Playwrighta). Konsekwencja dla czytania tabel jest nadal ta sama: żadna
liczba pokrycia w tym dokumencie nie zależy od tych testów, bo mierzą warstwę, której v8 nie liczy —
ale w rachunku ryzyka trzeba je policzyć na MINUS, a nie na plus, jak robiłem w wydaniach 7 i 8.

### 9.3 Odtworzenie pomiaru

```bash
bun install                    # rejestr prywatny Lovable (piny z bun.lock)
# POCZEKAJ na zakończenie instalacji i sprawdź, że się DOMKNĘŁA (patrz niżej)
node -e "['@testing-library/dom','@testing-library/react','happy-dom','jsdom']\
  .forEach(m=>require.resolve(m+'/package.json'))"   # dymny test kompletności
npx vitest run src/components/PostLayoutRenderer.test.tsx   # dymny przebieg 1 pliku
bun run test:coverage          # próg globalny + 554 progi per-ścieżka
# dla rozdz. 4 (nazwy niewywołanych funkcji) potrzebny jest reporter `json`,
# którego konfiguracja NIE ma - patrz rozdz. 12.10 i rekomendacja R8:
npx vitest run --coverage --coverage.reporter=json --coverage.reporter=json-summary
```

**Dwa kroki pośrodku nie są ozdobą — bez nich wydanie 8 opublikowałoby zapaść pokrycia.**
Pierwszy przebieg tamtego wydania wystartował, gdy instalacja zależności jeszcze pisała do
`node_modules`: katalog `@testing-library/dom` powstał o 22:03:19, a pomiar startował o 21:58.
**966 z 2 005 plików testowych padło na zbieraniu z jedną przyczyną**, a wynik globalny spadł
do 32,24%. Sygnatura, która to rozstrzyga w jednym spojrzeniu: **duża liczba padniętych PLIKÓW
przy znikomej liczbie czerwonych TESTÓW jest niemożliwa dla regresji kodu** — plik padający
na zbieraniu nie zgłasza żadnego czerwonego testu.

**To wydanie ma dwa pełne przebiegi na tym samym HEAD i to jest jego dodatkowa wartość
metodologiczna.** Przebieg pierwszy: **2 216,67 s**, 2 218 plików testowych, 61 244 przypadki
(2 208 plików / 60 584 przypadki przeszły, **272 padły w 8 plikach**, 337 „expected fail",
2 pliki / 51 przypadków pominiętych). Przebieg drugi, z dołożonym reporterem `json`:
**2 150,93 s** i **identyczny** wynik testów — te same 8 \| 2 208 \| 2 i te same
272 \| 60 584 \| 337 \| 51. Pokrycie różni się natomiast o **≤6 jednostek na 111 399**
(pięć plików z 3 304), co daje kalibrację szumu własnego pomiaru na poziomie **0,006 pp** —
pełny rachunek w 12.10. **Wszystkie delty w rozdz. 2.1 są nad tym progiem szumu; jedynymi
liczbami, których od szumu nie da się odróżnić, są delty rzędu setnych punktu** (moduł 1 −0,02 pp
i moduł 5 −0,004 pp — i dlatego opisuję je jako „bez ruchu", a nie jako spadki).

Od wdrożenia R1 z wydania 1 (`coverage.reportOnFailure: true` w configu) raport i progi powstają
TAKŻE na czerwonej suicie, więc jedno polecenie wystarcza. **Ta sama flaga ma drugą stronę, którą
to wydanie musiało OGRANICZYĆ** (rozdz. 1 i 12.2): pokrycie jest ślepe na test padający
na **asercji**, bo linia zdążyła się wykonać — ale **nie jest ślepe na test, który do kodu nigdy
nie dojechał**.

Agregacja per moduł / funkcja / funkcjonalność powstała z `coverage-final.json`
(mapy `statementMap`/`fnMap`/`branchMap` + liczniki `s`/`f`/`b`) oraz `coverage-summary.json`:
moduł = suma po plikach pasujących do reguł z 9.1, funkcjonalność = suma po wzorcach ścieżek,
„funkcja bez wywołania” = wpis `fnMap`, którego licznik `f` wynosi zero. **Zera liczone są
warunkiem `lines.total > 0 && lines.covered === 0`, nigdy `lines.pct === 0`** — różnica wynosi
42 pliki i jest wyjaśniona w 5.1.

**Definicja okna, bo w tym wydaniu okazała się sporna.** Wszystkie liczby o commitach dotyczą
zakresu `8e771b983..d737e1329`, czyli tego, co weszło MIĘDZY dwoma pomiarami: **222 commity,
z tego 194 nie-merge, z tego 159 dotyka `src/`**. Liczone datą autora (`git log --since=2026-08-31`)
wychodzi **302** — poprawnie, ale na inne pytanie: 108 z tych commitów jest już przodkami
`8e771b983`, więc siedzi w pomiarze wydania 8. Kontrola: 194 + 108 = 302.

**Kontrola prozy wobec pomiaru.** Każda liczba wpisana w ten dokument ręcznie (nie z szablonu)
jest sprawdzana skryptem porównującym ją z `by-module-ed9.json`, `meta-ed9.json`, `zera-ed9.json`,
oba raporty `coverage-summary.json` i danymi wydań 1-8 — **115 twierdzeń, zero rozjazdów na tym
HEAD**. Skrypt powstał w wydaniu 7, gdzie wyłapał dziesięć błędnych liczb w rozdziale 8.2;
w wydaniu 8 wyłapał trzy liczby kumulacyjne. **W tym wydaniu wyłapał trzynaście — z czego
wszystkie trzynaście były błędami SKRYPTU, nie dokumentu** (mój własny separator tysięcy używał
niełamliwej spacji, a dokument zwykłej), i to też zapisuję, bo narzędzie kontrolne, które zgłasza
fałszywe alarmy, jest tak samo niebezpieczne jak takie, które ich nie zgłasza. Siedem realnych
pomyłek tego wydania — wszystkie znalezione przez równoległe, niezależne sprawdzenia moich własnych
liczb — jest wypisanych w rozdz. 8.5.

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

## 10. AKTUALIZACJA 2026-09-01 - kampania MODUŁU 12 (realtime / powiadomienia / web-push)

Rozdziały 0-9 są migawką **wydania 8** i nie zostały przepisane: nadpisanie ich tabel zatarłoby
punkt odniesienia, wobec którego mierzy się tę pracę. Ten rozdział dokłada pomiar PO kampanii.

### 10.1. Wynik

Pomiar: pełna suita (2 051 plików testowych), `all: true`, ten sam zakres plików co w wydaniu 8
plus trzy moduły powstałe z ekstrakcji (patrz 10.3).

| Powierzchnia                | Pliki |                  Linie |               Gałęzie |              Funkcje | Instrukcje |
| --------------------------- | ----: | ---------------------: | --------------------: | -------------------: | ---------: |
| Powiadomienia + web-push    |    19 |   **97,54%** (834/855) |      91,90% (794/864) |     96,17% (226/235) |     96,27% |
| Realtime (kanały, presence) |    10 |   **99,32%** (292/294) |      93,25% (152/163) |     98,54% (135/137) |     98,79% |
| trasy                       |     2 |    **100,00%** (19/19) |         100,00% (4/4) |        100,00% (8/8) |    100,00% |
| **MODUŁ 12 RAZEM**          |    31 | **98,03%** (1145/1168) | **92,14%** (950/1031) | **97,11%** (369/380) |     96,94% |

Delta wobec wydania 8 (49,54% linii / 31,59% gałęzi / 47,46% funkcji):

| Metryka | wyd. 8 | 2026-09-01 |         delta |
| ------- | -----: | ---------: | ------------: |
| Linie   | 49,54% | **98,03%** | **+48,49 pp** |
| Gałęzie | 31,59% | **92,14%** | **+60,55 pp** |
| Funkcje | 47,46% | **97,11%** | **+49,65 pp** |

**Plików produkcyjnych na 0%: 12 -> 0.** Progi per-ścieżka dla modułu: 0 -> 34 (w repo: 376 -> 410).

O ZMIANIE MIANOWNIKA, wprost: wydanie 8 liczyło 28 plików i 1 191 linii, tu jest 31 plików
i 1 168 linii. To nie jest wykluczenie czegokolwiek z pomiaru - żaden plik nie wypadł. Ekstrakcja
(10.3) przeniosła powtórzone predykaty z trzech komponentów do trzech nowych modułów, więc trzy
kopie tego samego kodu zamieniły się w jedną: 23 linie mniej przy większej liczbie plików.

**POTWIERDZONE NA RUNNERZE** (CI, job `test` = `bun run test:coverage`, commit `1f043eb`,
2 051 plików testowych, 55 530 przypadków, 1 169 s): w logu **ZERO** linii `ERROR: Coverage`,
czyli wszystkie 410 progów per-ścieżka - w tym 34 dopisane tą kampanią - przechodzą na runnerze,
a nie tylko na maszynie autora. Pomiar globalny CI: 83,76% instrukcji / 78,23% gałęzi /
82,26% funkcji / 85,00% linii - zgodny z pomiarem lokalnym co do cyfry.

Katalogi modułu 12, CI wobec pomiaru lokalnego (instr. / gał. / fn / linie):

| Katalog                        | CI                            | lokalnie                      |
| ------------------------------ | ----------------------------- | ----------------------------- |
| `src/lib/notifications`        | 97,30 / 93,65 / 99,31 / 98,18 | 97,30 / 93,65 / 99,31 / 98,19 |
| `src/lib/realtime`             | 98,78 / 93,25 / 98,54 / 99,31 | 98,79 / 93,25 / 98,54 / 99,32 |
| `src/components/notifications` | 93,66 / 88,78 / 90,90 / 95,93 | 93,71 / 89,24 / 91,01 / 95,97 |

Jedyna zauważalna różnica to gałęzie `src/components/notifications`: **0,46 pp niżej na runnerze**.
Próg katalogowy stoi na 86, więc zapas wynosi 2,78 pp - ale to jest konkretna liczba dla każdego,
kto będzie później podnosił progi tej powierzchni: margines 2 pp na plik jest tu dolną granicą
sensu, nie ostrożnością.

Całe `src/` po kampanii: 85,00% linii (90 121/106 018), 83,76% instrukcji, 82,26% funkcji,
78,23% gałęzi - wobec 84,44 / 83,17 / 81,66 / 77,64 zapisanych w kronice `vitest.config.ts`
tego samego dnia przed kampanią. Moduł 12 to 1,1% linii repo, więc +0,56 pp globalnie jest
dokładnie tym, czego należy się spodziewać po przejściu z 49,5% na 98% na takim udziale.

### 10.2. Czego audyt wydania 8 nie wiedział albo napisał nieściśle

Trzy sprostowania. Wszystkie zweryfikowane w kodzie, nie przyjęte na słowo.

1. **„Bez atrapy kanału test realtime jest bezwartościowy" - prawda o testach, nieprawda
   o narzędziach.** `src/test/supabase/realtime.ts` (atrapa `supabase.channel` z obserwowalnym
   refcountem i emiterami zdarzeń) istniała od wydzielenia z fixture'ów czatu i używało jej
   siedem plików w INNYCH modułach. Moduł 12 stał na 49,5% nie z braku narzędzia, tylko dlatego,
   że nikt go tu nie podłączył.
2. **`useNotifications.ts` NIE MA `onMutate`/`onError`.** Audyt wymieniał „ich onMutate/onError
   (optymistyczne aktualizacje i rollback)" wśród niepokrytych ścieżek. W kodzie każda z mutacji
   tego pliku ma wyłącznie `onSuccess` z dwiema inwalidacjami; optymistyka z rollbackiem żyje
   w LOKALNYCH mutacjach `NotificationsCenter.tsx` (`patchNotificationLists` /
   `rollbackNotificationLists`) i tam została otestowana.
3. **`notification_deliveries` i `notification_digests` NIE ISTNIEJĄ.** Audyt pisał o nich
   „w stanie końcowym zero polityk, a grep nie znajduje `ENABLE ROW LEVEL SECURITY`" - brak
   `ENABLE` nie oznaczał tabeli bez RLS, tylko brak tabeli. Zero trafień w migracjach, w `src/`
   i w wygenerowanych typach. Rzeczywiste odpowiedniki: doręczenia to `public.notification_push_queue`
   (RLS włączony, polityka odczytu dla admina tenanta, ZERO grantów dla `authenticated`/`anon`),
   a digest to nie tabela, tylko kolumny `email_digest` / `digest_last_sent_at` na
   `notification_preferences` plus RPC `claim_due_digests`. Konkurencyjny `public.push_outbox`
   został usunięty przez `20260713210000_notifications_pipeline_reconciliation.sql`.

### 10.3. Co realnie odblokowało te liczby

**Ekstrakcja przed asercjami.** Ten sam predykat żył w trzech kopiach wewnątrz komponentów:
`isInternalHref` (Bell, Center, `useActorProfiles`), `isPlainLeftClick` (Bell, Center - identyczne
ciała), `pickTitle`/`pickBody` (dwie kopie zapisane RÓŻNĄ składnią przy tym samym zachowaniu),
`fmtDate`, `relTime`. To nie były funkcje „nieprzetestowane", tylko NIEWYWOŁYWALNE bez renderu
858-linijkowego organizmu. Powstały `notificationLink.ts`, `notificationText.ts`
i `notificationListKeys.ts`. Przy okazji zniknęła czwarta kopia: dzwonek miał własne, znakowo
identyczne zapytanie o profile aktorów - dziś korzysta ze wspólnego hooka, więc dzwonek i skrzynka
budują ten sam klucz cache i po zalogowaniu leci jedno zapytanie zamiast dwóch.

**Podłączenie atrapy kanału.** Refcount jest w tych testach ASERCJĄ, nie dekoracją: każdy test
odmontowania sprawdza `removed === true` i zerowy `activeChannelCount()`, a `tableChannelHub`
NIE jest mockowany - z atrapą huba refcount nie mierzyłby niczego.

### 10.4. Defekty znalezione i PRZYPIĘTE (`it.fails`, bez zmiany produkcji)

Siedem `it.fails`, każdy z opisem złamanego kontraktu i kierunkiem naprawy.

1. **Akcje grupowe skrzynki nie docierają do serwera** (4 x `it.fails`, najpoważniejsze).
   `isNotificationListQuery` uznaje za listę wierszy każdy klucz trzyelementowy, którego trzeci
   człon jest obiektem - a tablica nim jest. Cache profili aktorów
   (`["notifications","actor-profiles", string[]]`) przechodzi więc przez filtr, a
   `patchNotificationLists` robi na nim `cached.pages.map(...)`: pod tym kluczem leży PŁASKA
   tablica, `pages` jest `undefined`, `onMutate` rzuca `TypeError`. React Query przerywa mutację,
   `mutationFn` nigdy nie biegnie, a `onError` dostaje `context === undefined`, więc nie ma czego
   cofnąć. Dotyczy „oznacz całą rozmowę", „oznacz jako nieprzeczytane" i kosza. Warunek
   wystąpienia: choćby jedno powiadomienie z `/messages?c=<uuid>`, czyli każdy, kto dostaje
   wiadomości na czacie. Oczekiwany kontrakt: `false` dla tego kształtu; wykonalność poprawki ma
   osobny, ZIELONY test - `Array.isArray` odróżnia oba trzecie elementy, więc żaden klucz nie musi
   zmienić kształtu.
2. **Równoległe mutacje dzielą jeden ref korelacji.** `useEventConfirmedMutation` przenosi
   `correlationId` z `onMutate` do `mutationFn` przez JEDEN `useRef` na cały hook, a `onMutate`
   jest asynchroniczne. Dwie mutacje wypuszczone bez czekania przeplatają się i OBA żądania idą
   ze stemplem drugiej. Skutek: pierwsza zostaje po timeoucie wycofana z cache mimo poprawnego
   zapisu - czyli dokładnie objaw, któremu ten hook ma zapobiegać. Kierunek: id na kontekście
   mutacji zamiast wspólnego ref-a.
3. **Panel dzwonka to `role="dialog"` bez nazwy** (`aria-dialog-name`).
4. **Wiersz powiadomienia bez `href` zagnieżdża przycisk w przycisku** (`nested-interactive`,
   WCAG 4.1.2). Przy obu naruszeniach a11y stoi ZIELONY test „poza dwoma zgłoszonymi defektami
   panel jest czysty w axe", żeby `it.fails` nie stał się workiem na przyszłe regresje.

### 10.5. Warstwa danych: pgTAP na żywej bazie

`supabase/tests/module12_notifications_rls_test.sql` - 45 asercji, WYKONANE (935 migracji
zaaplikowanych lokalnie), kształt z `pg_catalog` ORAZ skutek realnymi `INSERT`/`UPDATE`/`SELECT`
w sesji z ustawionym `request.jwt.claims`. Sam kształt przechodzi na literówce w nazwie polityki,
sam skutek nie łapie „ktoś dopisał drugą politykę obok".

Ustalenia:

- **`push_subscriptions` - subskrypcja jest PER UŻYTKOWNIK, nie per użytkownik-w-tenancie.**
  Dowody: `UNIQUE (endpoint)` (endpoint należy do przeglądarki), jedno konto = jeden tenant
  w `profiles` z `profiles_pin_tenant_id`, oraz `engagement_overview`, które liczy `push_optin`
  przez `JOIN profiles`, IGNORUJĄC `ps.tenant_id`.
  **DEFEKT (opisany, nie naprawiany):** kolumna `tenant_id NOT NULL` istnieje i dyspozytor
  filtruje po niej (`.in("tenant_id", …).in("user_id", …)`), a RLS jej nie pilnuje - klient wstawia
  wiersz z obcym `tenant_id` i przestawia go `UPDATE`-em (asercje 16-17 to POKAZUJĄ). Gorsze:
  `push.ts` w ogóle nie podaje `tenant_id` w upsercie `onConflict: "endpoint"`, więc po przeniesieniu
  konta wiersz zostaje ze starym tenantem, dyspozytor nie znajduje urządzenia i zadanie umiera
  jako `dead` BEZ ANI JEDNEJ PRÓBY WYSYŁKI. To nie jest wyciek poufności (`enqueue_notification`
  stempluje powiadomienie tenantem odbiorcy, a `notifications_enforce_tenant` tego pilnuje) -
  to integralność kolumny i cicha utrata doręczalności.
- **`user_consents`** - jedna polityka, tylko SELECT; `authenticated` ma wyłącznie grant SELECT.
  Brak polityk zapisu jest POPRAWNY (zapis wyłącznie przez `set_user_consent`) i jest teraz
  BRAMKOWANY: test oblewa przy jakiejkolwiek polityce lub grancie INSERT/UPDATE/DELETE dla
  `authenticated`, żeby nikt tego później nie „naprawił".
- **`notifications`** - trzy polityki z `tenant_id = public.current_tenant_id()`, zero polityki
  INSERT **i zero grantu INSERT**; predykat tenanta jest nośny (wiersz z uidem użytkownika, ale
  tenantem B pozostaje niewidoczny).
- **`notification_preferences` vs `notifications` - dwa sposoby wyznaczania tenanta są równoważne
  co do WARTOŚCI, nierównoważne co do KONTEKSTU BEZPIECZEŃSTWA.** `current_tenant_id()` ma ciało
  dosłownie `SELECT tenant_id FROM public.profiles WHERE id = auth.uid()`, ale jest
  `SECURITY DEFINER`, więc OMIJA RLS na `profiles`; podzapytanie inline w politykach preferencji
  działa w kontekście wołającego. Przy odciętym samoodczycie profilu `notifications` nadal zwraca
  wiersz, a `notification_preferences` odmawia wszystkiego, łącznie z odczytem własnych
  przełączników. Impersonacja rozjazdu nie tworzy (wydawana jest prawdziwa sesja konta docelowego),
  sesja bez profilu też nie (obie fail-closed).
- **Poprawka po pierwszym przebiegu CI (odnotowana, bo zmienia to, CO test mierzy):** trzy
  asercje pytały o GRANTY dla `anon`/`authenticated` i oczekiwały zera. Przechodziły na lokalnym
  harnessie (goły PostgreSQL + same migracje), a oblały na `supabase db start`, bo obraz bazowy
  Supabase nadaje rolom klienckim szeroki grant na schemacie `public` z automatu - i to jest
  NORMALNY stan tej platformy, nie luka. W Supabase bramką nie jest grant, tylko RLS: tabela
  z włączonym RLS i bez polityki dla danej roli nie oddaje jej ani jednego wiersza. Asercje
  pytają teraz o polityki (identyczne w obu środowiskach, bo pochodzą z migracji), o brak
  przywilejów ZAPISU na `user_consents` oraz - dowodowo - o to, że sesja anonimowa nie wyciąga
  ani jednego powiadomienia mimo niepustej tabeli. Przy okazji odnotowane, nie naprawiane:
  `TRUNCATE` dla `authenticated` omija RLS z definicji; przez PostgREST nie da się go wywołać
  (HTTP nie ma takiego czasownika), ale to przywilej platformowy dotyczący KAŻDEJ tabeli
  schematu, nie tylko modułu 12.
- **Dlaczego `check:sql-owner-tenant-scope` tego nie łapie:** bramka jest relacyjna
  i samokalibrująca się - zapala się dopiero, gdy na TEJ SAMEJ tabeli choć jedna klauzula
  właścicielska wiąże tenanta („świadek"). `push_subscriptions` i `user_consents` mają po jednej
  polityce i żadna tenanta nie wiąże, więc bramka strukturalnie nie ma czego porównać. Ten test
  jest dla obu tabel tym brakującym świadkiem.

### 10.6. i18n: SPROSTOWANIE do wcześniejszej wersji tego rozdziału

**Pierwsza wersja tego rozdziału była nieprawdziwa i zostaje wycofana w całości.**

Twierdziła, że siedemnaście z osiemnastu przełączników rodzaju pokazywało w obu językach
surowy slug z bazy, a każda z dziesięciu zgód RODO swój klucz rejestru zamiast nazwy
oświadczenia. To nieprawda. Klucze `notifications.settings.kinds.*`,
`notifications.settings.kindGroups.*`, `notifications.consents.items.*`,
`notifications.consents.categories.*` i `notifications.unread_*` **od dawna są w rdzeniu**
(`src/lib/locale/{pl,en}.ts`) i renderują się poprawnie w obu językach.

Skąd błąd: sprawdziłem NAKŁADKĘ (`src/lib/i18n-notifications.ts`) i zobaczyłem tam brak tych
kluczy. Nakładka jest jednak WARSTWĄ, nie całym słownikiem - a rdzenia nie sprawdziłem.

**Co z tego wynikło.** Dopisałem do nakładki własne brzmienia, a nakładka rejestruje się przez
`addResourceBundle(lang, ns, tree, true, true)`, gdzie ostatnie `true` znaczy NADPISZ. Od chwili
wejścia na trasę powiadomień użytkownik zobaczyłby więc moje napisy zamiast kanonicznych -
w tym opis zgody marketingowej **bez pouczenia „Możesz wycofać zgodę w każdej chwili"**, które
jest w rdzeniu. Ponieważ `CONSENT_CATALOG` zapisuje decyzje z wersją `1.0`, dwa materialnie różne
brzmienia zgody trafiałyby do rejestru RODO pod jedną wersją, a wpisy sprzed podmiany przestałyby
odpowiadać temu, co użytkownik faktycznie przeczytał.

Wychwycił to automatyczny przegląd na PR-ze (uwaga P1), nie ja. Zmiana została **cofnięta
w całości** - nakładka wróciła do stanu sprzed kampanii, co do bajtu.

**Co z tego zostaje jako trwały wynik.** Test `src/lib/__tests__/i18nNotifications.test.ts` mierzył
dotąd wyłącznie nakładkę, czyli odpowiadał na pytanie, którego nikt nie zadaje. Mierzy teraz
SŁOWNIK EFEKTYWNY (rdzeń + nakładka) przez to samo `t`, którego używa aplikacja, a do tego ma trzy
nowe bramki:

- **prawną, bez listy wyjątków**: nakładka nie może podmienić żadnego klucza
  `notifications.consents.items.*` ani `.categories.*`, bo to treść oświadczenia woli - jej zmiana
  należy do rdzenia ORAZ do bumpa wersji w `consentCatalog.ts`;
- **ratchet** na pozostałe rozjazdy nakładka-rdzeń: zastano **24** (wszystkie w EN, żaden w treści
  zgód), lista może tylko maleć;
- **katalogową**: każdy rodzaj z `NOTIFICATION_KINDS`, każda sekcja z `NOTIFICATION_KIND_GROUPS`
  i każda zgoda z `CONSENT_CATALOG` musi renderować się w obu językach i nie być surowym slugiem.
  Ta ostatnia broni przed realnym scenariuszem, którego wcześniej nie łapało nic: dopisaniem
  rodzaju do katalogu bez tłumaczenia.

### 10.7. Czego NIE osiągnięto

Rozdział obowiązkowy - raport bez niego nie jest sprawdzalny.

- **Sześć testów w pięciu plikach jest czerwonych i to stan ODZIEDZICZONY z maina**, nietknięty
  przez tę pracę: `authzSnapshotParity` (nieświeży snapshot autoryzacji - zlecenie WPROST zabrania
  jego regeneracji dla zgaszenia czerwieni), `migrationReplay` (2, bliźniaki treści w katalogu
  migracji), `serviceRoleTenantScope.gate`, `router.test.tsx`, `AdminMonetizationLedger`.
  Zweryfikowane przez przebieg dwunastu shardów całej suity oraz przez uruchomienie tych plików
  osobno. Żaden z nich nie dotyka modułu 12.
- **Trzy bramki `check:*` nie dają się uruchomić w tym środowisku:** `check:db-contract`
  i `check:migration-ledger` wymagają poświadczeń Supabase (`SUPABASE_URL` + klucz), których tu
  nie ma; `check:authz-snapshot` oblewa z powodu wyżej. To ograniczenie środowiska, nie skutek
  tej zmiany - pozostałe 35 bramek przechodzi.
- **Cztery niepokryte fragmenty są NIEOSIĄGALNE z publicznego kontraktu** i zostały tak nazwane,
  zamiast być pokryte podmianą globali: `catch` w `notificationActorId` (parser WHATWG URL nie
  rzuca dla ścieżki od pojedynczego `/` - sprawdzone na 11 kandydatach), fałszywa strona
  `if (index >= 0)` w `runWithCorrelation` (stos nie jest eksportowany), `ciphertext length
mismatch` w `encryptPushPayload` (asekuracja własnego inwariantu długości AES-GCM) i eksmisja
  z cache'u VAPID przy 64 wpisach.
- **`domainEvents.ts` stoi na 66,67% funkcji** i jest jedynym plikiem modułu poniżej 80% na tej
  metryce. Ma własne, wcześniejsze testy i nie był w zakresie tej kampanii; próg zapadkowy został
  mu wpisany na zmierzonym poziomie, żeby nie osunął się dalej.
- **Własny błąd, złapany dopiero w przeglądzie:** nadpisanie kanonicznych treści zgód RODO
  napisami z nakładki (patrz 10.6). Cofnięte w całości, zabezpieczone bramką bez listy wyjątków.
  Zapisuję to tutaj, a nie tylko w historii commitów, bo raport, który przemilcza własną pomyłkę,
  nie jest sprawdzalny.
- **`pickBody` i `pickTitle` traktują PUSTY NAPIS inaczej** (`??` kontra truthiness), więc
  producent zapisujący `""` zamiast NULL-a dostanie w EN pustą treść, a nie polską. Zachowanie
  przeniesiono bez zmiany i przypięto testem WYKONUJĄCYM SIĘ (nie `it.fails`), z akapitem
  w kodzie - to kandydat do ujednolicenia, nie defekt z konsekwencjami dziś.

## 11. AKTUALIZACJA 2026-09-02 - kampania MODUŁU 16 (społeczność, komentarze, zgłoszenia do klubów)

Rozdziały 0-9 są migawką **wydania 8** i nie zostały przepisane; rozdział 10 opisuje kampanię
modułu 12. Ten rozdział dokłada pomiar modułu 16 - i zaczyna od czegoś, czego poprzednie
kampanie nie musiały robić: od **naprawy miary**. Tabela funkcjonalności tego modułu mierzyła
co innego, niż obiecywały nazwy jej wierszy, więc każda delta liczona wobec niej opisywałaby
przesunięcie granicy, a nie pracę.

### 11.1. Taksonomia: co wiersz „Społeczność: odznaki, zaangażowanie, Q&A, ankiety" naprawdę zawierał

Wiersz wydania 8 deklarował 21 plików, 664 LOC i 35,5% linii przy 428 liniach niepokrytych.
Sprawdzenie zawartości, plik po pliku:

- **Q&A: ZERO plików.** Człon nazwy nie miał w wierszu ani jednego odpowiednika.
- **Ankiety: jeden plik** - `components/community/PollCard.tsx`, i to na **100%**.
- **Odznaki: trzy pliki** - `lib/community/reputationBadges.server.ts` (0/4),
  `components/community/ReputationLevelChip.tsx` (0/7), `lib/community/reputation.ts` (44,1%).
- **Bilety i prelegenci wydarzeń: 235 z 428 niepokrytych linii**, czyli **55% całego długu
  wiersza** - `EventSpeakersManager.tsx`, `EventTicketPurchase.tsx`,
  `EventSpeakerCreateDialog.tsx`, `EventTicketCard.tsx`, `AddToCalendar.tsx`,
  `EventsListSkeleton.tsx`, `calendar.ts`, `ticketDocument.ts`.

Za tym stoją trzy defekty mapy, nie trzy pomyłki redakcyjne. Wszystkie trzy są konsekwencją
tego, że mapa istniała **wyłącznie jako tabela w dokumencie**: tabeli nie da się uruchomić,
więc nikt nigdy nie sprawdził, czy reguła, którą opisuje, robi to, co obiecuje.

**Defekt 1 - siedem martwych reguł.** Rozdział 9.1 przypisuje modułowi 22 pięć wzorców
wycinających pliki wydarzeń z katalogów społeczności (`^src/components/community/Event`,
`ticketDocument`, `EventsListSkeleton`, `AddToCalendar`, `^src/components/admin/community/EventSpeaker`)
oraz dwie trasy (`admin.community.events`, `club.$clubSlug.e.`). Przy zadeklarowanej regule
rozstrzygania („pierwsze trafienie wygrywa, moduły rosnąco po numerze") **żaden z tych siedmiu
wzorców nie ma prawa nigdy trafić**: moduł 16 dopada te pliki swoimi wzorcami katalogowymi
(`^src/components/community/`, `^src/routes/.*(club|community|comment|badge)`) sześć wierszy
wcześniej. Intencja rozdziału 9.1 była poprawna; jej wykonanie było niemożliwe.

**Defekt 2 - dwa największe zera modułu leżały poza modułem.** `admin.community.qa.tsx`
(0/122 linii, 0/57 funkcji) i `admin.community.polls.tsx` (0/78, 0/39) trafiały do **MODUŁU 7**
(„Typy treści specjalne"), bo jego łapacz tras
`^src/routes/.*(tracker|expert|program|podcast|web-stor|quiz|librar|glossar|poll|qa|live)`
stoi dziewięć wierszy przed modułem 16 i łapie je na członach `qa` i `poll`. Ta sama klasa
w drugą stronę: `admin.events_.$eventId.onsite.badges.tsx` (identyfikatory uczestników przy
wejściu na wydarzenie, nie odznaki reputacyjne) wpadał do modułu 16 na członie `badge`.

**Defekt 3 - sześć tras panelu poza wszystkimi funkcjonalnościami.** Jedenaście wierszy modułu 16
obejmowało z panelu społeczności wyłącznie `admin.community.clubs*`. Poza nimi zostawało
**344 linie i 189 funkcji na zerze**: `admin.community.qa.tsx` (0/122, 0/57),
`admin.community.polls.tsx` (0/78, 0/39), `admin.community.index.tsx` (0/58, 0/33),
`admin.community.badges.tsx` (0/39, 0/18), `admin.community.contributors.tsx` (0/26, 0/13),
`admin.community.engagement.tsx` (0/21, 0/9). Tabela modułu pokazywała 89,12% i milczała
o największym zerze, jakie w nim stało.

**Naprawa.** Mapa jest od teraz KODEM:

| plik                                | rola                                                                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/taxonomy/moduleMap.mjs`    | mapa plik -> moduł, przepisana z rozdz. 9.1, z wyjątkami o wyższym pierwszeństwie (`CARVE_OUTS`), które wykonują martwe reguły z defektów 1-2 |
| `scripts/taxonomy/features.mjs`     | taksonomia funkcjonalności modułu 16 - 20 wierszy, PARTYCJONUJĄCYCH moduł                                                                     |
| `scripts/taxonomy/report.mjs`       | tabele modułów i funkcjonalności liczone wprost z `coverage/coverage-summary.json`, z licznikiem i mianownikiem                               |
| `scripts/check-feature-taxonomy.ts` | bramka: brak sierot, brak martwych reguł, brak pustych funkcjonalności, brak pustych modułów                                                  |

Wiersz zbiorczy jest rozbity na osiem, których nazwy odpowiadają zawartości: „Społeczność:
sesje Q&A", „Społeczność: ankiety", „Społeczność: odznaki i reputacja", „Społeczność:
zaangażowanie i pulpit", „Społeczność: harmonogram kanałów (cron + panel zdrowia)",
„Społeczność: dopuszczenie do społeczności (domeny, wybór członka)", „Społeczność: publiczna
warstwa odczytu", „Społeczność: włączanie modułów społeczności". Bilety, prelegenci i generator
ICS przechodzą do **modułu 22**, zgodnie z pierwotną - i wreszcie wykonywaną - intencją rozdziału 9.1.

**Weryfikacja mapy wobec wydania 8.** Sześć modułów (6, 10, 13, 18, 19, 21) zgadza się co do
jednego pliku. Reszta różni się o pojedyncze pliki dołożone na maina po pomiarze audytu oraz
o skutek naprawy z defektów 1-2. Suma modułów wobec wydania 8: różnice per moduł mieszczą się
w kilku plikach poza modułem 20, którego łapacz (`^src/lib/`, `^src/routes/`) musiał w kodzie
zostać przesunięty na koniec kolejności - w dosłownym czytaniu tabeli zjadałby moduły 21 i 22
oraz kubełek słowników i18n, a audyt raportuje wszystkie trzy jako niepuste, więc pomiar
wydania 8 też musiał je rozstrzygać wcześniej. To jest zapis faktycznej kolejności, nie zmiana.

**Bramka NIE jest wpięta jako `check:*`.** `check:gate-coverage` wymaga, żeby każdy skrypt
`check:*` z `package.json` miał krok w workflow, a zlecenie zabrania zmian w `package.json`.
Uruchomienie: `bun run scripts/check-feature-taxonomy.ts`. Wpięcie to jeden wiersz w
`package.json` i jeden krok w `.github/workflows` - świadomie zostawione poza tą pracą.

### 11.2. Wynik pomiaru

**Jak zmierzone.** Dwa pełne przebiegi `vitest run --coverage` z `all: true`, tą samą
konfiguracją i tym samym zakresem plików po obu stronach. Stan WYJŚCIOWY zmierzony w OSOBNYM
drzewie roboczym przypiętym do commitu sprzed pierwszej zmiany (`5b5b52f`), a nie przepisany
z tabel wydania 8 - to jest ten sam rygor, który rozdział 10 zastosował dla modułu 12.
Tabele funkcjonalności liczy `scripts/taxonomy/report.mjs` wprost z `coverage-summary.json`,
po naprawionej taksonomii, po obu stronach identycznie.

**Kontrola wiarygodności pomiaru.** Przebieg bazowy w zamrożonym worktree dał dla modułu 16
**89,11% linii / 87,31% gałęzi / 88,84% funkcji przy 17 plikach na zerze**, wobec
89,12% / 87,27% / 89,02% i 16 plików na zerze opublikowanych w wydaniu 8. Zgodność do
0,01-0,18 pp na trzech metrykach - czyli mapa modułów przepisana z rozdziału 9.1 i tabela
funkcjonalności liczą TO SAMO, co liczył audyt. Różnica jednego pliku na zerze to skutek
naprawy taksonomii (rozdz. 11.1): siedem plików wydarzeń wyszło do modułu 22, a dwie trasy
panelu weszły z modułu 7.

**Moduł 16 razem.**

| metryka         | wejście (`5b5b52f`, pełna suita) |            po kampanii |         delta | cel zlecenia |
| --------------- | -------------------------------: | ---------------------: | ------------: | -----------: |
| linie           |               89,11% (7132/8004) | **99,79%** (8446/8463) | **+10,68 pp** |        ≥ 93% |
| gałęzie         |               87,31% (7319/8383) | **97,54%** (8509/8723) | **+10,23 pp** |        ≥ 90% |
| funkcje         |               88,84% (2969/3342) | **99,68%** (3507/3518) | **+10,84 pp** |        ≥ 93% |
| instrukcje      |                                - | **99,36%** (9507/9568) |             - |            - |
| plików na zerze |                           **17** |                  **0** |       **-17** |            - |

Przebieg po kampanii: 333 pliki testowe modułu, **11 408 testów zielonych**, 118 przypiętych
`it.fails`, zero czerwonych.

**UCZCIWIE O DWÓCH ZAKRESACH.** Liczba „po" pochodzi z przejazdu plików testowych modułu 16
przy zakresie pomiaru zawężonym do jego ścieżek, a liczba „przed" z pełnej suity. Pokrycie
jest monotoniczne po zbiorze testów, więc pełna suita da dla modułu 16 wynik **nie niższy**
niż 99,79% - zawężenie zbioru testów może tylko zaniżyć, nigdy zawyżyć. Delta jest zatem
dolnym oszacowaniem, nie górnym. Pełny przebiegowy pomiar globalny repo z tego samego dnia:
86,64% instrukcji / 81,29% gałęzi / 85,14% funkcji / 87,86% linii na commicie bazowym.

**Trzy funkcjonalności zamówione w zleceniu.**

| funkcjonalność                                   |                                wejście |              po kampanii |             cel |
| ------------------------------------------------ | -------------------------------------: | -----------------------: | --------------: |
| Komentarze i moderacja                           | 82,31% linii · 78,10% gał. · 64,76% fn | **100% · 97,17% · 100%** | ≥95 / ≥88 / ≥92 |
| KLUBY: zgłoszenia członkowskie (apply)           |               89,62% · 70,97% · 95,08% | **100% · 97,31% · 100%** | ≥98 / ≥88 / ≥98 |
| Społeczność (dawny wiersz zbiorczy, po rozbiciu) |                            patrz niżej |              patrz niżej | ≥75 / ≥60 / ≥70 |

Dawny wiersz „odznaki, zaangażowanie, Q&A, ankiety" nie ma następcy jeden do jednego, bo mieszał
cztery powierzchnie z dwiema, których w module nie ma (rozdz. 11.1). Osiem wierszy, na które się
rozpadł, po kampanii:

| funkcjonalność                              |         wejście (linie) | po kampanii (linie · gał. · fn) |
| ------------------------------------------- | ----------------------: | ------------------------------: |
| Społeczność: sesje Q&A                      |       **0,00%** (0/122) |    **100%** · 95,06% · **100%** |
| Społeczność: zaangażowanie i pulpit         |        **0,00%** (0/93) |    **100%** · 92,66% · **100%** |
| Społeczność: dopuszczenie do społeczności   |        **0,00%** (0/87) |    **100%** · 95,45% · **100%** |
| Społeczność: odznaki i reputacja            |         13,64% (15/110) |    **100%** · 95,87% · **100%** |
| Społeczność: publiczna warstwa odczytu      | 22,35% · **6,38% gał.** |  **100%** · **100%** · **100%** |
| Społeczność: ankiety                        |         23,53% (24/102) |    **100%** · 98,21% · **100%** |
| Społeczność: harmonogram kanałów            |         30,66% (42/137) |        98,54% · 92,03% · 94,12% |
| Społeczność: włączanie modułów społeczności |            60,00% (3/5) |         **100%** · - · **100%** |

**Sześć tras panelu społeczności, które wydanie 8 miało na dokładnym zerze** (razem 344 linie
i 189 funkcji, niewidoczne w żadnym wierszu tabeli): `admin.community.qa.tsx` 0/122 -> 100%,
`polls` 0/78 -> 100%, `index` 0/58 -> 100%, `badges` 0/39 -> 100%, `contributors` 0/26 -> 100%,
`engagement` 0/21 -> 100% linii. Cel zlecenia dla nich to było 60/55/45.

**Osiem punktów N1-N8** (cele: linkPreview ≥85/85/70, community-cron ≥85/85/75,
publicQueries ≥80/80/65) - wszystkie przekroczone, szczegóły w 11.3.

**Kluby nie zregresowały** - to był warunek twardy zlecenia:

| obszar                    |      wymagane |                            zmierzone po kampanii |
| ------------------------- | ------------: | -----------------------------------------------: |
| `src/components/clubs/**` | ≥ 99,9% linii | **99,91%** (2191/2193), funkcje 99,89% (934/935) |
| `src/lib/clubs/**`        | ≥ 93,8% linii |           **99,69%** (2922/2931), gałęzie 97,37% |

Jedenaście istniejących progów tego obszaru przechodzi. Próg globu `src/lib/clubs/**` został
PODNIESIONY z 92/93/92/89 na 97/98/98/95 - o tym w 11.6.

### 11.3. N1-N8: status każdego punktu zlecenia

Zlecenie wymagało, żeby każdy punkt miał jeden z trzech statusów: naprawiony (z testem czerwonym
bez naprawy), odrzucony (z uzasadnieniem) albo odroczony (`it.fails` z kontrolą dodatnią).
Odroczenie było jawnie wykluczone dla N1 i N2.

| #   | powierzchnia                                |                                             wejście |                                      wyjście (zmierzone) | status                                 |
| --- | ------------------------------------------- | --------------------------------------------------: | -------------------------------------------------------: | -------------------------------------- |
| N1  | `linkPreview.functions.ts`                  |            9,1% linii · 0,0% gałęzi · 0 z 8 funkcji |                               100% linii · 8 z 8 funkcji | **naprawiony** (defekt produkcyjny F1) |
| N2  | `community-cron.ts`                         |                         0/93 linii · 0 z 20 funkcji | 98,54% linii · 94,12% funkcji (pakiet z panelem zdrowia) | **zamknięty**                          |
| N3  | `publicQueries.ts` + `tenant.ts`            | 20,8% linii · **6,7% gałęzi** · 5 z 25 funkcji; 0/6 |            100% linii · 100% gałęzi · 100% funkcji (oba) | **zamknięty** + znalezisko F2          |
| N4  | `CommentsSection.tsx`                       |        68,6% linii · 66,7% gałęzi · 21 z 45 funkcji |              99,27% linii · 97,67% gałęzi · 100% funkcji | **zamknięty**                          |
| N5  | `applicationNotify` + `applyPrefill`        |          36,8% linii · **0,0% gałęzi** · 2 z 4; 0/7 |              100% we wszystkich czterech metrykach (oba) | **zamknięty** + sprostowanie U1        |
| N6  | reputacja i odznaki (3 pliki)               |         44,1% · **21,1% gałęzi** · 4 z 13; 0/4; 0/7 |                    100% linii i funkcji (wszystkie trzy) | **zamknięty** + znalezisko F3          |
| N7  | hooki moderacji + `admin.comments.tsx`      |               60,4% · 67,9% (gałęzie 48,5%) · 74,5% |                    100% linii i funkcji (wszystkie trzy) | **zamknięty** + znaleziska F7-F9       |
| N8  | `clubSemantic.functions.ts` + `coverApi.ts` |                        25,0% (gałęzie 0,0%) · 46,1% |                               100% linii i funkcji (oba) | **zamknięty** + znaleziska F4-F6       |

**Żaden punkt nie został odrzucony ani odroczony.** N1 wymagał zmiany produkcyjnej i ją dostał;
pozostałe siedem dało się domknąć testem bez ruszania produkcji, a znaleziska po drodze poszły
jako `it.fails` z kontrolą dodatnią, bo ich naprawa leży w bazie (polityki RLS, polityka storage)
albo jest decyzją produktową.

Poza N1-N8 zlecenie wymieniało jeszcze pięć pozycji kolejnościowych; wszystkie są zamknięte:
sześć tras panelu społeczności (344 linie i 189 funkcji na zerze -> 100% linii na każdej),
`VerificationDomainsCard.tsx` i `MemberPicker.tsx` (0/51 i 0/36 -> 100% linii i funkcji),
bilety i prelegenci wydarzeń (pięć plików z zera i z 24,5%/52,9% -> 100% linii i funkcji),
dostępność przez `src/test/axe.ts` oraz progi per-ścieżka dla pięciu obszarów, które ich nie miały.

### 11.4. Rejestr znalezisk

Wszystkie pozycje `it.fails` mają KONTROLĘ DODATNIĄ - sąsiedni test dowodzący, że przypadek
poprawny przechodzi - więc żadna z nich nie jest wyłączonym testem, tylko przypiętym kontraktem.
Każda została zweryfikowana czerwienią: chwilowa zamiana `it.fails` na `it` i odczyt komunikatu
asercji, żeby przypięcie mierzyło defekt, a nie literówkę w selektorze.

**NAPRAWIONE W KODZIE PRODUKCYJNYM (3).**

**F1. `linkPreview.functions.ts` - limit `MAX_BYTES` nie ograniczał pamięci.** Warunek
`received >= MAX_BYTES` był sprawdzany PO doklejeniu CAŁEGO kawałka do bufora, więc próg
ograniczał liczbę obrotów pętli, a nie zajętą pamięć: jeden wielki kawałek (rozpakowany gzip
potrafi oddać megabajty naraz) wchodził w całości i był parsowany. To jest dokładnie ta klasa,
którą nagłówek tego pliku obiecuje zamknąć („odpowiedź jest cięta do 256 kB"). Naprawa: do
bufora trafia najwyżej tyle, ile zostało do progu; `received` nadal liczy bajty PRZECZYTANE,
więc decyzja o przerwaniu się nie zmienia. Test bez naprawy czerwony.

**F12. `PollCard.tsx` - brak semantyki wyboru jednokrotnego.** Opcje ankiety były listą
`<button aria-pressed>`, czyli zbiorem niezależnych przełączników; czytnik ekranu nie miał
skąd wiedzieć, że wybór jest jednokrotny i ile opcji jest w grupie. Naprawa minimalna:
`role="radiogroup"` z `aria-labelledby` na pytaniu, `role="none"` na elementach listy,
`role="radio"` + `aria-checked` zamiast `aria-pressed`. Zero zmian w CSS. Czerwień bez naprawy
zmierzona: 13 padających testów.

**F13. `VerificationDomainsCard.tsx` - naruszenie axe `aria-required-parent`.** `ProfileBadge`
niesie `role="listitem"`, a w tej karcie stał samotnie w `<div>` - jedno naruszenie na wiersz.
Naprawa: jednoelementowy pojemnik `role="list"`. Czerwień bez naprawy: dokładnie jeden
padający test.

**PRZYPIĘTE `it.fails` - IZOLACJA NAJEMCY (2, najpoważniejsze).**

**F2. `qa_sessions` jest POZA ZASIĘGIEM bramki `check:sql-owner-tenant-scope`.** Obie polityki
właścicielskie („qa sessions host read" USING, „qa sessions host update" USING+WITH CHECK) stoją
na gołym `host_user_id = auth.uid()` bez tenanta, mimo że `qa_sessions.tenant_id` istnieje,
a rodzeństwo (staff, publiczny odczyt) tenanta pilnuje. Ponieważ ŻADNA klauzula właścicielska
nie wiąże tenanta, `analyzeOwnerTenantScope` nie ma świadka i POMIJA tabelę
(`witnesses.length === 0 -> continue`) - bramka strukturalnie nie może zapalić. Host sesji czyta
i modyfikuje swój wiersz w dowolnym kontekście najemcy, a CI milczy. To jest ta sama klasa
ślepoty, którą rozdział 7.3 opisuje jako „czego bramki repozytorium strukturalnie widzieć nie
mogą" - z tą różnicą, że teraz ma świadka w postaci padającego testu. Kontrola dodatnia: `posts`
(ma świadka, przechodzi) plus osobny test dowodzący samej ślepoty bramki. Naprawa: dopisać
`tenant_id = (select current_tenant_id())` do OBU polityk hosta; po dopisaniu do jednej bramka
sama zapali się na drugiej.

**F7. `comments_own_select` nie ma predykatu najemcy.** Polityki SELECT są OR-owane, a ta brzmi
`USING (user_id = auth.uid())`. Lista panelu moderacji nie filtruje ani po wpisie, ani po
najemcy, więc moderator zobaczy w SWOJEJ kolejce także własne komentarze zostawione u INNEGO
najemcy, a `comments_own_update` pozwoli mu je stamtąd ruszyć. Na publicznej liście to
niewidoczne (`fetchPostComments` filtruje po `post_id`) - kolejka moderacji jest JEDYNĄ
powierzchnią, która to odsłania. Kontrola dodatnia: `comments_staff_select` /
`comments_staff_update` predykat najemcy MAJĄ.

**PRZYPIĘTE `it.fails` - OKŁADKI KLUBU W PUBLICZNYM KUBEŁKU (3).**

**F4. Klucz obiektu nie jest wiązany z najemcą.** `clubCoverObjectPath` produkuje
`club-covers/<clubId>/<losowe>.<ext>` bez segmentu najemcy. Polityka storage (migracja
`20260809182555`) sprawdza WYŁĄCZNIE `(storage.foldername(name))[1] = 'club-covers'` ORAZ
`club_is_any_moderator(auth.uid())` - drugi segment nie jest z niczym konfrontowany, a
`club_is_any_moderator` nie ma zakresu najemcy w ogóle. Prowadzący klub A może więc
INSERT/UPDATE i DELETE na prefiksie okładek klubu B, także w innym tenancie. Chroniony zostaje
ADRES zapisany w bazie (`club_set_cover` ocenia `club_capabilities` dla konkretnego klubu);
niechroniona jest ZAWARTOŚĆ publicznego kubełka.

**F5. `clubId` wchodzi do klucza bez sanityzacji.** Rozszerzenie jest czyszczone starannie
(`[^a-z0-9]` usuwane, przycięcie do 10, fallback `jpg`), `clubId` interpolowany surowo:
`clubCoverObjectPath({ clubId: "../avatars" })` daje `club-covers/../avatars/u1.png`. Pierwszy
segment nadal brzmi `club-covers`, więc polityka przepuszcza, a przeglądarka rozwija `..`
w publicznym adresie. Kontrola dodatnia: wroga NAZWA PLIKU uciec nie potrafi.

**F6. Plik trafia do publicznego kubełka ZANIM ktokolwiek sprawdzi prawa do tego klubu.**
Kolejność w `uploadClubCover` to `upload` -> `club_set_cover`. Kontrola dodatnia: sprzątanie
działa (po odmowie RPC obiekt znika), więc okno się zamyka - ale samo sprzątanie opiera się na
tej samej zbyt szerokiej polityce DELETE.

**PRZYPIĘTE `it.fails` - REGUŁA WSTĘPU I AWARIE CICHE (7).**

- **F3.** `parseBreakdown` przepuszcza klucz spoza katalogu źródeł. Typ deklaruje wyłącznie
  `ReputationSourceKey`, runtime kopiuje każdy klucz z jsonb, a konsument robi
  `t("community.reputation.sources." + key)` - źródło dodane migracją przed tłumaczeniem
  narysuje użytkownikowi SUROWY KLUCZ i18n.
- **F14.** `normalizeDomainInput` nie obcina prefiksu `www.` - obcina protokół i ścieżkę
  (wklejanie URL-a jest wspieraną drogą), ale `www.example.com` przechodzi walidację i nie
  trafi w żaden adres e-mail. Awaria cicha: admin widzi partnera na liście, a konta nie
  dostają ani odznaki, ani planu.
- **F15.** Brak listy blokującej PUBLICZNE domeny pocztowe. `gmail.com`, `wp.pl`,
  `outlook.com` przechodzą jak domena firmowa. W połączeniu z domyślnym planem VIP
  w formularzu jedno kliknięcie nadaje odznakę i bezterminowe członkostwo każdemu posiadaczowi
  takiej skrzynki. Testy pinują stan zastany, więc dołożenie listy blokującej je oblewa -
  zmiana reguły wstępu musi być widoczna w diffie.
- **F8 / F16 / F17.** Trzy powierzchnie, na których ODMOWA ODCZYTU wygląda identycznie jak
  pusta baza: kolejka komentarzy („Brak komentarzy."), katalog zaufanych domen („Brak zaufanych
  domen") i stan ładowania tego katalogu. Sąsiednia trasa (`admin.community.notifications`)
  rozwiązuje to pokazując „-", świadomie nie „0" - i to jest wzorzec, do którego te trzy
  powinny dojść.
- **F18.** Dwa `aria-current="page"` w podnawigacji społeczności. Komponent liczy podświetlenie
  sam (`tab.exact`), ale `aria-current` dokłada `<Link>` z własnego dopasowania, którego
  domyślne `activeOptions` to PREFIKS - a `/admin/community` jest prefiksem każdego adresu
  modułu. Czytnik ekranu ogłasza „Podsumowanie, bieżąca strona" na każdej z ośmiu podstron,
  sprzecznie z tym, co widzi użytkownik myszy. Naprawa to jedna właściwość
  (`activeOptions={{ exact: tab.exact }}`), którą `AdminShell` stosuje już po tej samej lekcji.

**PRZYPIĘTE `it.fails` - WYDARZENIA (3).**

- **F10.** Wydarzenie BEZPŁATNE dostaje przycisk kasy na zero złotych. Dla `priceCents = 0`
  `ticketOffer` zwraca `{kind:"free"}`, ale komponent renderuje „Kup bilet - 0,00 zł"
  prowadzący do `createCheckoutOrder`, a serwer takie zamówienie odrzuca. Połowa reguły jest
  wdrożona - koszyk poprawnie znika.
- **F11.** Termin biletu liczony w strefie PRZEGLĄDARKI (`toLocaleString` bez `timeZone`),
  choć `ticket.timezone` jest w kontrakcie. Dług EB-912 był NAZWANY w
  `timezoneAdoption.gate.test.ts` i niepilnowany. Test niezależny od `TZ` maszyny: dwa bilety
  różniące się WYŁĄCZNIE strefą dają identyczną etykietę.
- **F19.** Anti-anchoring ankiety: `AnimatedCount` renderuje `{pct}% · {n}` bez warunku na
  `visible`, więc przed oddaniem głosu przy każdej opcji stoi „0% · 0" - liczba, i to fałszywa
  („nikt nie zagłosował" o ankiecie z setką głosów). Serwer odmawia rozkładu (`visible: false`)
  właśnie po to, żeby widok nie miał czego pokazać.

**F20. `nested-interactive` w `MemberPicker`** (serious, WCAG 4.1.2): krzyżyk czyszczenia to
`role="button" tabIndex=0` WEWNĄTRZ `<button>` wyzwalacza, więc czytnik ekranu go nie ogłosi
jako akcji. Nienaprawione, bo poprawka wymaga przeniesienia krzyżyka na rodzeństwo wyzwalacza,
czyli zmiany układu wiersza. Kontrola dodatnia asertuje, że lista naruszeń to DOKŁADNIE
`["nested-interactive"]`, więc naprawa oblewa oba testy i wymusi sprzątnięcie.

**F9. Droplista filtra statusu bez nazwy dostępnej** - `SelectTrigger` Radiksa ma
`role="combobox"`, dla której nazwa nie pochodzi z zawartości. To WZORZEC REPO, nie wpadka tej
trasy: z ponad 400 użyć `<SelectTrigger>` `aria-label` niesie kilkadziesiąt. Naprawa wykracza
poza moduł; kontrola dodatnia dowodzi, że to JEDYNE naruszenie axe na tej powierzchni.

### 11.5. Sprostowania do tez zlecenia

Trzy tezy zlecenia okazały się nieprawdziwe i zostały sprawdzone w kodzie, nie przyjęte na słowo.

1. **„Powiadomienie idzie do opiekunów klubu, nie do wszystkich członków."**
   `notifyClubApplicationStatus` wysyła DOKŁADNIE JEDEN mail i DOKŁADNIE DO KANDYDATA: adres to
   kolumna `email` wiersza zgłoszenia, czytana przez `admin_club_application_notify_payload`
   z zakresem `assert_admin_tenant()`. Osobnej ścieżki „powiadom opiekunów o nowym zgłoszeniu"
   w repozytorium NIE MA - sprawdzone w `src/lib`, `src/routes`, migracjach i `tx-copy.ts`.
   Opiekunowie odbierają zgłoszenia PULLEM, skrzynką `ClubApplicationsInbox`. Sensowna wersja
   tamtej intencji jest przypięta asercją „`sendTxEmail` wywołane RÓWNO RAZ" - dopisany kiedyś
   fan-out do opiekunów obali ten test pierwszy.

2. **„Te panele są w module, ale poza wszystkimi jego jedenastu funkcjonalnościami."**
   Dwa z nich nie były nawet w module. `admin.community.qa.tsx` i `admin.community.polls.tsx`
   trafiały regułą rozdziału 9.1 do MODUŁU 7, bo jego łapacz tras łapie je na członach `qa`
   i `poll` dziewięć wierszy przed modułem 16 (rozdz. 11.1, defekt 2). Teza była więc
   łagodniejsza od rzeczywistości.

3. **„`admin.community.notifications.tsx` 0/14 - zrób oba końce łańcucha."**
   Ten plik miał już test (`adminCommunityNotificationsRoute.test.tsx`, 325 linii) z kampanii
   modułu 12, która weszła na maina po pomiarze wydania 8. Zamiast pisać go od nowa,
   kampania DOMKNĘŁA lukę w tamtym pliku: asercja kolejności montowania panelu zdrowia
   przechodziłaby również wtedy, gdyby ktoś podmienił panel na statyczny baner „harmonogram OK",
   bo panel jest tam atrapą. Domknięcie idzie odczytem źródeł - tą samą techniką, którą tamten
   plik stosuje dla bramki uprawnień.

Do tego jedna korekta wobec liczb wydania 8: mianowniki per plik w moim pomiarze różnią się od
podanych w zleceniu (np. `publicQueries.ts` - 79 linii i 31 funkcji zamiast 72 i 25). To inny
ZAKRES POMIARU, nie inny stan pliku; delty w tym rozdziale liczę na jednym zakresie po obu
stronach.

### 11.6. Progi per-ścieżka dopisane tą kampanią

Audyt wydania 8 opisał asymetrię tego modułu jako jego CAŁĄ diagnozę: jedenaście progów
per-ścieżka na 373 w repo - i wszystkie jedenaście stało na klubach. Społeczność, komentarze
i trasy panelu społeczności nie miały ani jednego, więc ich pokrycie było liczbą, a nie bramką.
Ta kampania dokłada **dziewięć** wpisów i **podnosi jeden**.

| ścieżka                              |              próg (instr./fn/linie/gał.) |                     zmierzone | uwaga                                           |
| ------------------------------------ | ---------------------------------------: | ----------------------------: | ----------------------------------------------- |
| `src/lib/comments/**`                |                      98 / 100 / 100 / 88 |     98,68 / 100 / 100 / 89,05 | zapadka na skończonej pracy, zero nowych testów |
| `src/components/comments/**`         |                        97 / 98 / 98 / 95 |     99,28 / 100 / 100 / 97,67 |                                                 |
| `src/lib/community/**`               |                        97 / 98 / 98 / 96 |     99,56 / 100 / 100 / 98,89 |                                                 |
| `src/components/community/**`        |                        98 / 95 / 98 / 96 |     100 / 97,67 / 100 / 98,29 | fn niżej: martwy `.catch()` w react-query v5    |
| `src/components/admin/community/**`  |                        96 / 96 / 97 / 88 | 98,59 / 98,59 / 99,40 / 90,81 |                                                 |
| `src/routes/admin.community.*`       |                        97 / 96 / 97 / 90 | 99,26 / 98,31 / 99,24 / 92,73 | glob łapie też trasę czatu (MODUŁ 9)            |
| `src/lib/clubs/useClubModeration.ts` |                        98 / 98 / 98 / 98 |         100 / 100 / 100 / 100 | per-plik, ścieżka operacji niszczących          |
| `src/lib/clubs/useClubAdmin.ts`      |                        98 / 98 / 98 / 98 |         100 / 100 / 100 / 100 | per-plik, jw.                                   |
| `src/routes/admin.comments.tsx`      |                        96 / 98 / 98 / 93 |     98,33 / 100 / 100 / 95,92 | per-plik, masowa moderacja                      |
| `src/lib/clubs/**`                   | **97 / 98 / 98 / 95** (było 92/93/92/89) | 99,12 / 99,76 / 99,69 / 97,37 | PODNIESIONY, +6 pp na gałęziach                 |

**Trzy progi PER-PLIK, nie katalogowe - i to jest treść, nie kosmetyka.** Hooki moderacji
i kolejka komentarzy to ścieżka, która USUWA CUDZE TREŚCI i wyprasza ludzi z klubu. Przed tą
kampanią `useClubModeration.ts` stał na 60,4% linii, `useClubAdmin.ts` na 67,9% przy 48,5%
gałęzi, a `admin.comments.tsx` na 74,5% - i wszystkie trzy PRZECHODZIŁY, bo glob
`src/lib/clubs/**` liczył je razem z resztą biblioteki stojącej blisko 100%. Średnia globu jest
złym strażnikiem dla ścieżki operacji nieodwracalnych, więc te trzy pliki mają własne progi
i przestały jechać na gapę.

**Liczba progów w repo rośnie z 373 na 382**, a żaden nowy nie leży poniżej wartości już
osiągniętej. Żaden plik nie został wykluczony z pomiaru, żaden istniejący próg nie został
obniżony, snapshot autoryzacji nie był regenerowany.

### 11.7. Czego NIE osiągnięto i co zostaje otwarte

1. **Naprawa dwóch dziur izolacji najemcy leży w BAZIE, nie w kodzie.** F2 (`qa_sessions` bez
   predykatu najemcy w politykach hosta) i F7 (`comments_own_select` bez predykatu najemcy)
   wymagają migracji, a nie testu - i migracji ta kampania nie dopisywała, bo zakresem była
   praca testowa. Oba mają przypięty `it.fails` z kontrolą dodatnią, więc pierwsza migracja,
   która je zamknie, zapali te testy na zielono i wymusi zdjęcie przypięcia.
2. **Polityka storage okładek klubu (F4-F6)** - to samo: naprawa to segment najemcy w kluczu
   obiektu plus zawężenie polityki `club_is_any_moderator`, czyli zmiana w bazie.
3. **`check:feature-taxonomy` nie jest wpięta w workflow.** `check:gate-coverage` wymaga, żeby
   każdy skrypt `check:*` z `package.json` miał krok w workflow, a zlecenie zabraniało zmian
   w `package.json`. Bramka działa i przechodzi (`bun run scripts/check-feature-taxonomy.ts`),
   ale w CI jej nie ma. Wpięcie to jeden wiersz w `package.json` i jeden krok w workflow.
4. **Taksonomia funkcjonalności jest kompletna TYLKO dla modułu 16.** Pozostałe moduły mają
   w rozdziale 3 wiersze, których reguł nikt nie opublikował; przepisywanie ich z pamięci dałoby
   liczby wyglądające na porównywalne i takimi niebędące. Dopisanie kolejnego modułu to jeden
   wpis w `FEATURES` i bramka od razu zacznie go pilnować.
5. **Cztery testy padają na commicie BAZOWYM** (`AdminMonetizationLedger.test.tsx` i trzy inne),
   wszystkie poza modułem 16 - dziedziczone z maina, nie z tej pracy. Zmierzone osobnym
   przebiegiem zamrożonego worktree.
6. **Dwa sufity gałęzi opisane, nie obejście**: `threadDynamics.ts` 84,91% i
   `threadWorkspaceTypes.ts` 96,77% - zapasy `?? …` wymuszone przez `noUncheckedIndexedAccess`
   na indeksach udowodnionych w sąsiednim kodzie. Nie zostały dobite rzutowaniem.
7. **`check:bundle` PADA - i pada tak samo bez tej pracy.** Bramka zgłasza
   `overall total 4321,7 KB > 4306 KB`. Zmierzyłem ją w ZAMROŻONYM worktree na commicie
   bazowym (`5b5b52f`), po pełnym buildzie: tam wynosi **4321,4 KB** i pada z tym samym
   komunikatem. Cały diff tej kampanii dokłada więc **0,3 KB gzip**, a budżet był przekroczony
   o 15,4 KB, zanim ta praca się zaczęła. Powód widać w liście ruchów samej bramki i nie ma
   związku z modułem 16: `i18n` +129,1 KB, nowy `EventStudioModuleSections` +65,5 KB, nowy
   `useEventSessions` +31,1 KB, `vendor` +39,8 KB - wszystko wobec baseline'u z 2026-08-15,
   który bramka sama opisuje jako pisany starą konwencją wiader. Podniesienie budżetu ani
   przepisanie baseline'u NIE należy do tej kampanii: to jedna z trzech zmian produkcyjnych
   w całym diffie (49 dodanych linii w trzech plikach) i żadna z nich nie dotyka grafu chunków.
   Pozostałe bramki buildowe przechodzą: `check:chunks`, `check:entry-purity`,
   `check:chunk-parity`.
8. **Dwie bramki nieuruchamialne w tym środowisku**, obie z braku dostępu do bazy, nie z powodu
   tej pracy: `check:db-contract` i `check:migration-ledger` kończą się „Brak SUPABASE_URL /
   klucza Supabase". Zmierzone identycznie na commicie bazowym.

---

## 12. WYDANIE 9 — pierwszy pomiar na CZERWONEJ suicie i pierwsze wydanie, w którym zapadka wyprzedziła audyt

Rozdziały 0-9 są przepisane na pomiar tego wydania. Rozdziały 10 i 11 zostawiam bez zmian jako
zapis dwóch kampanii międzywydaniowych — one mierzyły swoje moduły w oknie, w którym powstały,
i przepisanie ich tabel zatarłoby punkt odniesienia, wobec którego mierzy się tamtą pracę.

### 12.1. Trzy rzeczy, które zlecenie wydania 8 wykonało

Wydanie 8 skończyło się listą dziewięciu rekomendacji ułożonych po skutku na jednostkę pracy.
Trzy pierwsze pozycje tej listy są dziś **zamknięte** — i to jest najważniejsza wiadomość
tego wydania, bo w ośmiu poprzednich wydaniach zamykały się wyłącznie kampanie modułowe,
nigdy pozycje dotyczące samej infrastruktury dowodu.

**Próg globalny podniesiony o piętnaście punktów na każdym wymiarze.** Wydanie 8 pisało:
„Podnieść próg globalny — stoi 19,1 pp pod pomiarem", przy `64/58/62/65`
(instrukcje / gałęzie / funkcje / linie). Dziś w `vitest.config.ts` stoi
**`79 / 73 / 77 / 80`**. To pierwszy ruch zapadki globalnej od wydania 5 i największy
w całej serii. Konsekwencja jest jakościowa, nie kosmetyczna: przy zapasie 19,1 pp
repozytorium musiałoby stracić blisko jedną czwartą pokrycia, żeby bramka cokolwiek
zauważyła — po podniesieniu ten margines jest wielokrotnie węższy, a to znaczy, że
**procent globalny wreszcie jest bramką, a nie sprawozdaniem**.

**Progi per-ścieżka: 373 → 554.** Sto dziesięć globów i czterysta czterdzieści cztery
wpisy per plik. Przyrost w jednym oknie (+181) jest większy niż suma przyrostów wydań 1-8.

**Błąd potoku wdrożeniowego z wydania 8 — zamknięty.** Wydanie 8 opisało „jeden błąd potoku,
pięć zapaleń": dwie migracje klasy „tenant scope" wjechały dwa razy pod różnymi nazwami,
a `authzSnapshot.generated.ts` niósł `"migrations":932` przy 934 na dysku. Dziś migracji
na dysku jest **935** i w snapshocie **935**. Rozjazd zniknął.

### 12.2. Znalezisko tego wydania: osiem czerwonych plików, jedna przyczyna systemowa i jedna bomba zegarowa

To jest wydanie, w którym trzeba było zacząć od czegoś innego niż liczby. **Suita nie jest
zielona: osiem plików, 272 padnięte testy** przy 60 584 zielonych i 337 „expected fail".

Najpierw korekta mojego własnego podejrzenia, bo ona jest częścią ustalenia. Uruchomiłem
pomiar równolegle z dwunastu agentami analitycznymi na czterech rdzeniach i podejrzewałem,
że czerwień jest **środowiskowa** — że testy przekraczają limit pod kontencją CPU. Było
błędne, i to dwukrotnie zmierzone: `adminAnalyticsRoute.test.tsx` trwa w izolacji
**271,58 s** wobec 270,34 s w pomiarze (różnica 0,5%), a `adminSettingsRoutes.test.tsx`
**952,01 s** wobec 952,40 s (różnica **0,041%**). Powód jest strukturalny: cały ten czas to
bierne czekanie na timerze `waitFor`, nie praca procesora, więc równoległe forki go nie
zmieniają.

Przy okazji rozstrzygnęła się sygnatura „każdy test pada na ~5 000 ms": to **nie**
`testTimeout` (ten ma w `vitest.config.ts:40` wartość **20 000**, świadomie podniesioną
z komentarzem „limit globalny 20 s zostawia margines na kontencję CPU, nie maskując
realnych zawieszeń"), tylko `vitest.setup.ts:22` → `configure({ asyncUtilTimeout: 5000 })`,
czyli budżet `waitFor` / `findBy*` testing-library.

#### Osiem plików, cztery pod-mechanizmy jednej klasy i jeden przypadek osobny

| plik                                                 |          testy | przyczyna                                                    |
| ---------------------------------------------------- | -------------: | ------------------------------------------------------------ |
| `routes/__tests__/adminSettingsRoutes.test.tsx`      | 225 \| **188** | literał zastąpiony kluczem i18n w komponencie współdzielonym |
| `routes/__tests__/adminAnalyticsRoute.test.tsx`      |   55 \| **55** | trasa rozdzielona, 725 linii przeniesionych                  |
| `routes/__tests__/adminCommunityIndexRoute.test.tsx` |   51 \| **21** | ECharts bez kontekstu 2D w happy-dom                         |
| `routes/__tests__/pollsRoute.test.tsx`               |    35 \| **4** | rola ARIA `button` → `radio`                                 |
| `lib/ci/__tests__/monolingualUserText.test.ts`       |        44 \| 1 | nowy plik poza zamrożonym baseline                           |
| `lib/views/__tests__/headerTickerQuery.test.ts`      |        24 \| 1 | **bomba zegarowa — patrz niżej**                             |
| `lib/builder/__tests__/labelsEn.test.ts`             |         8 \| 1 | widget dodany z polską etykietą, wpis EN usunięty            |
| `components/builder/…/__tests__/lazyWidgets.test.ts` |         3 \| 1 | nowy widget nie dopisany do listy eksportów                  |

**Siedem z ośmiu ma jedną przyczynę klasową: kod produkcyjny zmienił się pod testami,
a testu nikt nie ruszył.** Ósmy jest niezależny i opisuję go osobno, bo jest ciekawszy.

**Pierwszy — `adminSettingsRoutes.test.tsx`, 188 z 225 i 952 sekundy, czyli 43% czasu
całego przebiegu na jednym pliku.** Wszystkie 188 porażek trwały 4 800-5 400 ms (suma
951,6 s z 952,4 s, czyli 99,9% czasu pliku), co samo wyklucza wiele przyczyn i wskazuje
jedną. Test szuka paska zapisu **po dokładnej treści** (`adminSettingsRoutes.test.tsx:390`:
`button.textContent === "Zapisz zmiany" || button.textContent === "Zapisywanie…"`),
a commit `d1861e84b` przestawił `SaveBar` w `src/components/admin/settings/fields.tsx`
z literałów na słownik: `{saving ? t("admin.saving") : t("admin.saveSettings")}`. Test
podmienia `react-i18next` na `@/test/i18nStub`, który zwraca **klucz zamiast tłumaczenia**,
więc w DOM stoi `admin.saveSettings`, `saveButton()` zwraca `undefined`, `waitFor` czeka
pełne pięć sekund i test pada. Skala wynika z architektury testu, nie z rozmiaru zmiany:
wszystkie dziewięć helperów montujących kończy się **tą samą** barierą
`await waitFor(() => expect(saveButton()).toBeTruthy())`, a sześć bloków `it.each(PANELS)`
mnoży ją przez dwanaście paneli. Jedna linia jest wąskim gardłem całego pliku.

Trzy rzeczy odróżniają ten przypadek od pozostałych i wszystkie trzy są warte zapisania.
**Zmiana produkcyjna jest poprawna** — dopisany w tym samym commicie komentarz mówi
wprost, dlaczego: „«Zapisz zmiany» i «Zapisywanie…» wpisane w kod, więc na angielskim
panelu…". **Autorem nie jest bot, a commit ruszył testy** — dziesięć innych plików, tylko
nie ten. I **nawet prawdziwa instancja i18n nie uratowałaby tego testu**: `pl.ts:1018`
niesie `saveSettings: "Zapisz ustawienia"`, nie „Zapisz zmiany" (sprawdzone; `en.ts:1011`
to „Save settings"). Test był przypięty do implementacji, nie do roli — i dlatego padł
dwa razy, raz na atrapie i raz na słowniku.

**Drugi — `adminAnalyticsRoute.test.tsx`, 55 z 55, 270 sekund.** Commit `3d4b684ca`
(2026-09-02 19:03, `gpt-engineer-app[bot]`, komunikat „Work in progress") przeniósł
**725 linii** z `src/routes/admin.analytics.tsx` do `src/routes/admin.analytics.index.tsx`
i **nie tknął pliku testowego** — ten był ostatnio zmieniany trzy godziny i dziesięć minut
wcześniej. Trasa `admin.analytics.tsx` ma dziś dwanaście linii i renderuje wyłącznie
`<Outlet />` (sprawdzone). Test czeka na
`getQueryState(["analytics-status"])?.fetchStatus === "idle"`, a ten stan jest `undefined`
**na zawsze**, bo trasa nie montuje niczego; DOM w komunikacie błędu to `<div />`.

Ten jeden commit ma jeszcze jedną właściwość. Utworzył trzy pliki —
`admin.analytics.index.tsx` (725 linii), `AdminBiStrip.tsx` (178) i `admin.analytics.bi.tsx`
(120) — których **żaden plik testowy w repozytorium nie wspomina ani razu tekstowo**
i które **nie mają ani jednego progu per-ścieżka** (sprawdziłem oba twierdzenia grepem).
1 023 nowe linie panelu analityki podlegają więc wyłącznie progowi globalnemu, który jest
sumą katalogową po 3 304 plikach. `AdminBiStrip` wisi przy tym pod `admin.index.tsx`
i `admin.community.index.tsx`, czyli pod pulpitem głównym panelu.

**Trzeci — `adminCommunityIndexRoute.test.tsx`, 21 z 51.** Dziewiętnaście porażek to
ECharts w happy-dom: `getContext("2d")` zwraca `null`, więc
`TypeError: Cannot read properties of null (reading 'clearRect')` z
`zrender/lib/canvas/Layer.js:249` przez `ECharts.dispose()`, plus **1 146 nieobsłużonych
wyjątków** `Cannot set properties of null (setting 'dpr')`. `AdminBiStrip` wszedł do trasy
commitami bota `093c9b0c5` i `6d5e6dac3` (19:04), po ostatniej zmianie testu, a żaden test
w repozytorium nie atrapuje tego komponentu — nie ma więc nawet wzorca do skopiowania.
Pozostałe dwie porażki to rozjechane przypięcia i **jedna z nich jest dobrą wiadomością**:
przypięcie naruszeń axe oczekuje `['button-name', 'heading-order']`, a dostaje
`['button-name']`, bo **`heading-order` zostało w kodzie naprawione**.

**Czwarty — `pollsRoute.test.tsx`, 4 z 35, i to najciekawszy z całej ósemki, bo kod
produkcyjny ma tu rację.** `src/components/community/PollCard.tsx:63` zamienił opcje
z listy `<button aria-pressed>` na `<ul role="radiogroup" aria-labelledby>` z
`<button role="radio" aria-checked>` (linie 79-80). Nagłówek pliku uzasadnia to
**dostępnością**: wcześniej czytnik ekranu ogłaszał przyciski przełącznikowe bez informacji,
do którego pytania należą, i bez pozycji „1 z 3". Jawne `role="radio"` **nadpisuje** jednak
domyślną rolę `button`, więc `getAllByRole("button")` nie widzi już opcji.

Sekwencja, która się tu domknęła, jest warta zapisania w całości. Test **rozpoznał** ten
defekt i **świadomie odmówił** naprawy, z uzasadnieniem wpisanym w plik (linie 529-536):
„NIE NAPRAWIAM TEGO TUTAJ, bo `PollCard` jest WSPÓLNY dla `/polls` i dla bloku ankiety
w treści wpisu (`PollBlockView`) […]. To zmiana zachowania dwóch powierzchni naraz, nie
usunięcie błędu na jednej trasie." Ktoś tę zmianę potem wykonał — poprawnie, na obu
powierzchniach — i **nikt nie wrócił do przypięć**. A przypięcie
`it.fails("DEFEKT: opcje ankiety NIE tworzą grupy opisanej pytaniem")` w linii 537 nadal
„przechodzi", bo szuka roli `group`, a naprawa dała `radiogroup`; dlatego pada cztery
testy, a nie pięć.

To jest **odwrotny tryb awarii rejestru defektów** niż ten, który opisało wydanie 8. Tam
wpis `it.fails` zapalił się na czerwono i sam zgłosił, że defekt zniknął. Tu wpis milczy,
choć defekt zniknął — bo jego asercja była napisana zbyt wąsko, żeby zauważyć własną
naprawę.

**Trzy pozostałe z tej klasy** są jednoliniowe i wszystkie trzy pochodzą z serii commitów
bota z 2026-09-02 wieczorem, o komunikatach „Changes": `labelsEn.test.ts` pada, bo widget
`cover-overlay-card` dostał polską etykietę `"Maksymalna szerokość (px)"`, a wpis EN
zniknął; `lazyWidgets.test.ts` — bo `CoverOverlayCardView.tsx` został wpięty do
`lazyWidgets.tsx`, a lista oczekiwanych eksportów nie; `monolingualUserText.test.ts` — bo
`admin.analytics.index.tsx` (ten sam plik co wyżej) nie istnieje w zamrożonym baseline
bramki jednojęzycznego tekstu.

#### Ósmy plik nie należy do tej rodziny: test zaczerwienił się z KALENDARZA

`src/lib/views/__tests__/headerTickerQuery.test.ts` — jeden test z dwudziestu czterech.
Kod produkcyjny `src/lib/views/headerTickerQuery.ts` ma ostatnią zmianę **2026-08-16**,
czyli **przed** plikiem testowym (2026-09-01). Żaden commit nie jest tu winny.

Mechanizm: test ustawia `TOMORROW = "2026-09-02T12:00:00.000Z"` (linia 46), ale
w **tym jednym** przypadku nie wstrzykuje `now` — a `headerTickerQueryOptions` woła
`resolveTickerSource(cfg)` bez drugiego argumentu (`headerTickerQuery.ts:74`), więc
funkcja bierze prawdziwy zegar z wartości domyślnej. Dziś jest 2026-09-03, więc przypinka
wygasła i źródło schodzi na `"latest"` zamiast `"pinned"`. **Test zaczerwienił się sam,
2026-09-02 o 12:00 UTC, bez udziału jakiegokolwiek commitu.** Ironia jest w nagłówku tego
samego pliku, który deklaruje, że „test podaje `now` jawnie" — w dwudziestu trzech
przypadkach owszem, w tym jednym nie.

Sprawdzenie pięciu innych kandydatów z datami przy dzisiejszej dało wynik czysty, ale
**dwa z nich zaczerwienią się same w ciągu 7-12 dni**, jeśli nikt nie zamrozi im zegara:
`meetingWindowDraft.test.ts` (daty 2026-09-14/15) i `cartStore.test.ts` (2026-09-10/15).
To jest klasa defektu, której żadna bramka w tym repozytorium nie pilnuje: **test poprawny
w dniu napisania i czerwony bez żadnej zmiany kodu.**

#### Przyczyna systemowa policzona dwiema metodami

**Po commitach:** **25 z 194 commitów nie-merge w tym oknie (12,9%) ruszyło kod produkcyjny
i ani jednego pliku testowego**, razem **2 856 linii**. Jeden commit — `3d4b684ca`, bota,
„Work in progress" — odpowiada sam za **62,8%** tej sumy. Drugi na liście to commit
Claude'a jawnie oznaczony `WIP: … (NIE stan zweryfikowany)`, czyli deklarujący własną
niekompletność. Trzeci, czwarty i szósty to znów bot, „Changes".

**Po grafie importów:** z **221 plików produkcyjnych** zmienionych w oknie census oparty na
statycznym grafie importów 2 236 plików testowych rozłożył 217 z nich tak: **149** ma test,
który ruszył się w oknie nie wcześniej niż kod; **21** ma test, który **stoi przed** zmianą;
**30** ma test nietknięty; **19 nie ma żadnego testu, który by je importował**. Poza
kategorią bezpieczną zostaje **68 plików i 5 514 linii — 26% całego ruchu produkcyjnego
okna**.

#### Dwie rzeczy gorsze od czerwieni, które ta sama awaria odsłoniła

**Pierwsza: dwanaście testów w tym pliku przechodzi dziś PRÓŻNIO.** Z 37 zielonych przypadków
`adminSettingsRoutes.test.tsx` grupa `it.each(PANELS)` „odczyt W TOKU pokazuje stan wczytywania,
a nie puste pola" (dwanaście przypadków, linie 458-467) kończy się asercją
`expect(saveButton()).toBeUndefined()`. Skoro `saveButton()` zwraca `undefined` **zawsze**,
ta asercja przechodzi niezależnie od tego, co panel wyrenderował. Dwanaście przypadków, których
zadaniem jest pilnować, że pasek zapisu NIE pojawia się w trakcie odczytu, **straciło moc dowodową
nie oblewając się** — są w kolumnie „passed" i nic nie znaczą. To jest dokładnie ta klasa awarii,
której procent pokrycia nie widzi i której nie widzi też licznik czerwieni: **jedyne, co ją
wykrywa, to przeczytanie testu.** Naprawa z rozdz. 12.2 przywraca im moc automatycznie.

**Druga: dwa testy w repozytorium stoją dziś w logicznej sprzeczności i oba pochodzą z TEGO
SAMEGO commitu.** `d1861e84b` dopisał w `adminSettingsAnalyticsRoute.test.tsx:806-808` bramkę
wymagającą, żeby napis paska zapisu **NIE** był literałem „Zapisz zmiany"
(`expect(saveBar()?.textContent).not.toBe("Zapisz zmiany")`), a `adminSettingsRoutes.test.tsx:392`
wymaga, żeby **BYŁ**. Jeden commit zostawił w suicie dwa wzajemnie wykluczające się kontrakty na
ten sam element interfejsu.

Przyczyna jest proceduralna, nie kodowa, i commit sam ją dokumentuje: jego sekcja WERYFIKACJA
podaje „`npx vitest run` na jedenastu plikach: 481 testów zielonych" — a
`adminSettingsRoutes.test.tsx` **nie było wśród tych jedenastu**. Zmiana w pliku współdzielonym
przez 26 konsumentów została zweryfikowana na próbce, która nie zawierała jego największego
konsumenta. To jest najtańsza możliwa lekcja tego wydania: **przy zmianie pliku współdzielonego
próbką nie jest „jedenaście plików, które mi przyszły do głowy", a lista importerów.**

#### I rzecz, która jest właściwym morałem tego rozdziału

Ten dokument powtarzał od wydania 5, że `coverage.reportOnFailure: true` czyni pomiar
**ślepym na czerwoną suitę**, bo linia wykonana przez padający test wciąż liczy się jako
pokryta. To wydanie pokazuje, że zdanie było **zbyt ogólne**, i podaje granicę.

Pomiar jest ślepy na **padniętą asercję** — kod się wykonał, tylko wynik był inny niż
oczekiwany. Nie jest ślepy na test, który **nigdy nie dojechał do kodu**. Wszystkie 188
porażek w `adminSettingsRoutes.test.tsx` wypaliły pełny budżet `waitFor` (188 z 188 trwały
≥ 5 011 ms, mediana 5 039 ms, suma 951,6 s z 952,4 s czasu pliku), więc panel nigdy nie
doszedł do stanu, w którym test go czyta, i linie tras `admin.settings*` **naprawdę się nie
wykonały**: glob spadł z 97,25% na **59,26%** linii i z 95,29% na **32,54%** funkcji.

**Sprostowanie do mojego własnego pierwszego szkicu tego rozdziału, bo pomyliłem dwa poziomy
pomiaru.** Napisałem, że „pokrycie modułu 19 spadło realnie". Zdanie jest prawdziwe dla
jedenastu plików tras i **fałszywe dla modułu**. Rozstrzyga to rachunek rozłączny na
per-plikowym pomiarze wydania 8, który istnieje w repozytorium:

| wariant                                                         | pliki | linie                    | funkcje                  |
| --------------------------------------------------------------- | ----: | ------------------------ | ------------------------ |
| moduł 19, wydanie 8                                             |   135 | 4 162/4 458 = 93,36%     | 1 355/1 502 = 90,21%     |
| moduł 19, wydanie 9 (raportowane)                               |   135 | 4 023/4 459 = **90,22%** | 1 205/1 502 = **80,23%** |
| **te same 123 pliki BEZ dwunastu dotkniętych, wydanie 8**       |   123 | 3 839/4 124 = 93,09%     | 1 153/1 289 = 89,45%     |
| **te same 123 pliki BEZ dwunastu dotkniętych, wydanie 9**       |   123 | 3 865/4 124 = **93,72%** | 1 164/1 289 = **90,30%** |
| kontrfaktycznie: wydanie 9 z pomiarem wydania 8 za te 12 plików |   135 | 4 188/4 458 = **93,94%** | 1 366/1 502 = **90,95%** |

Czyli: **na 123 plikach nietkniętych padnięciem moduł 19 poszedł W GÓRĘ** (+0,63 pp linii,
+0,85 pp funkcji), a bez awarii wyszedłby na 93,94% / 90,95%, czyli **wyżej niż w wydaniu 8**.
Bilans zamyka się co do jednej linii: −165 (jedenaście tras) +26 (trzy pliki, które realnie
zyskały) = −139 = 4 162 − 4 023; funkcje −161 +11 = −150 = 1 355 − 1 205. **Spadek modułu jest
artefaktem jednego padniętego pliku, nie przyrostem nietestowanego kodu** — do modułu doszła
w tym oknie jedna linia produkcyjna (import `useTranslation` w `fields.tsx`).

Granica tezy przebiega więc dokładnie tam: **procent nie widzi padniętej asercji, ale widzi
niedotarcie do kodu** — i widzi je na tym poziomie agregacji, na którym awaria zaszła.
Na poziomie globu tras liczba mówi prawdę; na poziomie modułu ta sama liczba jest myląca,
bo miesza szkodę z pracą. Dlatego progi per-ścieżka są jedyną bramką, która tu działa,
i dlatego wniosek nadal brzmi tak, jak w wydaniu 8, tylko z ostrzejszym uzasadnieniem.

**Naturalny eksperyment, który przypisuje przyczynę co do pliku.** Test montuje piętnaście
tras `admin.settings.*`. Dwie z nich mają DRUGI plik testowy — i dokładnie te dwie nie
straciły nic: `admin.settings.seo.tsx` (`adminSeoRoutes.test.tsx`) — zero zmiany;
`admin.settings.analytics.tsx` (`adminSettingsAnalyticsRoute.test.tsx`) — minus jedna linia.
Pozostałe **jedenaście tras nie ma alternatywnego testu i wszystkie jedenaście spadło**,
razem −165 linii i −160 funkcji. To jest dokładna, nie szacunkowa miara szkody z jednego
padniętego pliku — i najmocniejszy argument za redundancją testową, jaki ta seria dostarczyła.
Szkoda przy tym **nie propagowała się w głąb**: wszystkie pliki drugiego i trzeciego poziomu
importu bez alternatywnego testu mają Δ = 0, bo test podmienia ciężkie dzieci atrapami.

Zapadka to złapała. Próg `src/routes/admin.settings*.tsx` (instrukcje 96 / funkcje 94 /
linie 96 / gałęzie 93 — kolejność jak w pliku, `vitest.config.ts:4577`) padł na **wszystkich
czterech wymiarach**. Warto przy tym zapisać, jaki miał zapas: w wydaniu 8 mierzył
97,47 / 95,29 / 97,25 / 95,08, czyli stał **1,25–2,08 pp** nad progiem. Ta bramka nie miała
żadnego marginesu na przypadek — i jedno padnięcie ścięło ją o 61 pp.

Próg globalny — 80% linii przy pomiarze 90,75% — nie miał najmniejszych szans tego zobaczyć,
i to też jest policzone, nie oszacowane: cała katastrofa zużyła z buforu globalnego
**0,16 pp** przy dostępnych 10,75 pp. Naprawa wszystkich ośmiu padniętych plików podniosłaby
wynik globalny o 0,16 pp na liniach i 0,47 pp na funkcjach. **Bufor globalny jest 67 razy
większy niż realny wpływ najgorszego naruszenia w tym wydaniu.**

**I zlecenie, które z tego wynika: plik o największej dźwigni w tym module nie ma żadnego
progu.** `src/components/admin/settings/fields.tsx` — ten, którego jedna zmiana zgasiła 188
testów — jest importowany przez **26 plików produkcyjnych** (piętnaście tras ustawień, panel
darowizn, `PanelSaveBar.tsx` i osiem paneli wydarzeń), a w `vitest.config.ts` nie ma ani
klucza `src/components/admin/settings/**`, ani `src/components/admin/**`, ani wpisu na sam
plik (sprawdzone dopasowaniem wszystkich 554 kluczy do ścieżek katalogu). Cały katalog spada
na próg globalny, który lokalnie nie pilnuje niczego — i widać to na drugim pliku z tego
katalogu: `ConsentAuditSummary.tsx` stoi na 0/21 linii i 0/13 funkcji, i nic tego nie łapie.

### 12.3. Regres wobec własnego zapisu audytu: pierwsze bezwarunkowe pominięcie w serii

Wydania 4-8 raportowały to samo zdanie: „zero bezwarunkowych `it.skip` i `it.todo`,
dokładnie dwa `describe.skip`, oba jako warunkowa bramka `shouldRun ? describe : describe.skip`
w suitach wymagających żywej bazy". Zdanie przestało być prawdziwe.

`src/routes/__tests__/rootShellRender.test.tsx:91` niesie
`describe.skip("RootComponent - wymaga prawdziwego RouterProvider z __root jako korzeniem")`
z jednym testem w bloku. Powód pominięcia jest **zapisany** i to go odróżnia od zwykłego
wyciszenia — ale pominięcie jest bezwarunkowe, więc w CI nie wykona się nigdy. Dwa
pozostałe `describe.skip` (`src/__tests__/db-schema-invariant.test.ts:24`
i `src/__tests__/lang-parity.test.ts:21`) są nadal warunkowe.

Waga tego wpisu nie jest w liczbie „jeden test". Pominięty blok dotyczy `RootComponent`
— korzenia całej aplikacji, czyli dokładnie tego pliku, który wydanie 8 wskazało jako
niepokrytego właściciela wszystkich budżetów SSR i hydratacji.

### 12.4. Dyscyplina typów: `as any` zeszło do zera, ale doszła jedna adnotacja `: any`

Metoda ma tu znaczenie większe niż wynik, więc zapisuję ją: liczę **poza komentarzami
i literałami** oraz z rozdzieleniem plików **generowanych** (`*.gen.ts`, `*generated.ts`,
`integrations/supabase/types.ts`) od pisanych ręcznie. Bez tego rozdzielenia zwykły grep
daje **370** trafień `as any` i jest bezwartościowy: cały ten dług siedzi
w `src/routeTree.gen.ts`, który repozytorium samo zabrania edytować („You should NOT make
any changes in this file as it will be overwritten") i który jest **wykluczony z pomiaru
pokrycia** w `vitest.config.ts:81`.

W **3 305** plikach produkcyjnych pisanych ręcznie, licząc po wygaszeniu komentarzy i literałów
napisowych: `as any` = **0** (wydanie 8 podawało sześć), `: any` = **1**,
`as unknown as` = **179** w 115 plikach. Bez wygaszenia komentarzy wychodzi 10 i 5 — i to jest
pouczające, bo dziewięć z tych dziesięciu trafień to zdania o tym, że repo `as any` NIE używa.

**Ta jedna adnotacja nie jest regresem tego okna i tak ją trzeba zapisać.**
`src/routes/platform/email/auth/webhook.ts:115` → `let payload: any;` **istniało już
w bazie pomiaru wydania 8** (sprawdzone: `git show 8e771b983:…` pokazuje tę linię pod tym
samym numerem), a plik w oknie 222 commitów nie został tknięty ani raz. Czyli wydanie 8
zadeklarowało „zero adnotacji `: any`" **przy jednej istniejącej** — to pomyłka mojego
poprzedniego pomiaru, nie nowy dług. Miejsce jest zresztą tym, w którym `any` broni się
najlepiej i najsłabiej naraz: odbiór webhooka ma z definicji nieznany kształt wejścia,
więc `unknown` z walidacją byłoby poprawniejsze przy tym samym koszcie.

W oknie **nie doszło ani jedno realne rzutowanie** — potwierdzone niezależnie na całym
zakresie `8e771b983..HEAD`. Ruch był w przeciwną stronę: commit `b91b5195e` **zdejmuje**
rzutowania `as never` z ingestu RUM i telemetrii błędów (czyli domyka punkt N7 promptu
modułu 17, który wskazywał `web_vitals` zapisywane przez `as never`).

### 12.5. Izolacja tenanta: bramka zielona, zasięg węższy niż podałem w wydaniu 8

Przebieg bramki repozytorium (`scripts/check-sql-owner-tenant-scope.ts`):
**„Inwariant owner-tenant-scope OK (165 polityk właściciela z 620 w stanie końcowym;
2 luk pozornych, 0 pozycji znanego długu)"**. `KNOWN_OPEN_GAPS` jest **pusta** — ostatnie
dwanaście pozycji domknęła migracja `20260814221343`.

Zasięg policzyłem **analizatorem samej bramki** (`src/lib/ci/ownerTenantScope`:
`isOwnerScoped`, `unscopedClauses`), nie własnym parserem — to bezpośrednia konsekwencja
rachunku sumienia wydania 8, w którym mój własny parser polityk zaniżał o czterdzieści
jedną pozycję. Wynik: 620 polityk na 258 tabelach, z tego **165 właścicielskich na 93
tabelach**; **76 tabel ma świadka tenanta**, a **17 nie ma żadnego**, więc bramka
strukturalnie nie może tam zapalić.

**Korekta do wydania 8.** Podałem tam „7 tabel". Liczby 7 nie odtwarzam tą metodą i tego
nie ukrywam: 17 pochodzi z analizatora bramki i liczy tabele, na których polityki
właścicielskie **istnieją**, a żadna z nich nie wiąże tenanta w żadnej klauzuli. Różnica
siedzi w definicji, nie w kodzie — i dlatego podaję metodę razem z liczbą.

Nowe ustalenie tego wydania jest jednak mocniejsze od samej liczby. Sprawdzenie kolumny
`tenant_id` w wygenerowanych typach pokazuje, że **czternaście z tych siedemnastu tabel
ma kolumnę `tenant_id`**: `comments`, `contributor_submissions`, `event_rsvps`,
`event_session_signups`, `meeting_bookings`, `meeting_slots`, `personality_results`,
`poll_votes`, `push_subscriptions`, `qa_sessions`, `resource_downloads`,
`speaker_profiles`, `user_consent_events`, `user_consents`. Nie ma jej
`expert_expertise_areas`, a `expert_requests` i `member_organizations` **nie występują
w wygenerowanych typach wcale** — co samo jest ustaleniem do sprawdzenia wobec
`check:types-freshness`. Czyli: czternaście tabel nosi kolumnę tenanta, a ich polityki
właścicielskie o niej nie wiedzą, i samokalibrująca się bramka nie może tego zobaczyć,
bo potrzebuje rodzeństwa-świadka na tej samej tabeli.

### 12.6. Warstwy testów: dostępność urosła najmocniej, warstwa integracyjna nadal ma jeden plik

| warstwa                        | wydanie 8 |   wydanie 9 |       Δ |
| ------------------------------ | --------: | ----------: | ------: |
| vitest — pliki testowe         |     2 010 |   **2 218** |    +208 |
| vitest — wywołania `it`/`test` |    41 104 |  **47 230** |  +6 126 |
| vitest — wywołania `expect`    |    81 995 |  **95 700** | +13 705 |
| pgTAP — pliki                  |       100 |     **101** |      +1 |
| Playwright — pliki / testy     |    9 / 66 | **11 / 68** | +2 / +2 |
| bramki `check:*`               |        38 |      **39** |      +1 |
| uprzęże replayu migracji       |         5 |       **5** |       0 |

Nowa bramka to `check:ci-gates` — meta-bramka pilnująca bramek.

Rodzaje testów, klasyfikacja ze skanu treści tą samą definicją co w wydaniu 8:

| rodzaj                | wyd. 8 |  wyd. 9 |       Δ |
| --------------------- | -----: | ------: | ------: |
| komponentowy          |    697 | **742** |     +45 |
| **dostępności (axe)** |    135 | **200** | **+65** |
| jednostkowy           |    795 | **845** |     +50 |
| hooka                 |    102 | **119** |     +17 |
| funkcji serwerowej    |    113 | **131** |     +18 |
| warstwy danych        |    105 | **116** |     +11 |
| parytetu              |     28 |  **29** |      +1 |
| bramki                |     27 |  **28** |      +1 |
| inwariantu            |      4 |   **4** |       0 |
| dymny                 |      3 |   **3** |       0 |
| **integracyjny**      |  **1** |   **1** |   **0** |

Dwa wnioski trzeba postawić obok siebie. **Dostępność urosła relatywnie najmocniej**
(+65 plików, +48%) — to jest odpowiedź na zarzut wydania 8, że a11y mierzy się głównie
na komponentach panelu, a nie na przepływach czytelnika. I drugi, którego to wydanie
nie zamyka: **warstwa integracyjna nadal ma jeden plik** przy 2 218 plikach testowych
i 22 modułach z przepływami przechodzącymi przez kilka modułów naraz. Ten zarzut stoi
nietknięty od wydania 7.

### 12.7. Rejestr defektów: 255/147 → 327/186

Siedemdziesiąt dwa nowe wywołania `it.fails` w trzydziestu dziewięciu nowych plikach.
Nadal zero `it.skip` i `it.todo` (poza jednym `describe.skip` z 12.3). Tempo przyrostu
— 24 → 151 → 171 → 255 → 255 → **327** — nie zatrzymało się, a wydanie 8 zapisało już
mechanizm, który to napędza: `it.fails` jest w CI zielony, więc nic nie naciska.
Do tego dokładam obserwację z 12.2: przypięcie `it.fails` w `pollsRoute.test.tsx`
„przechodzi" mimo że opisywany przez nie defekt **został naprawiony** — bo szuka roli
`group`, a naprawa dała `radiogroup`. Rejestr defektów, który przestaje opisywać
rzeczywistość, psuje się w **obie** strony: raz przez wpisy nienaprawione, raz przez
wpisy, które nie zauważyły naprawy.

### 12.8. Moduł 21: dziewięć identycznych pomiarów i mechaniczna przyczyna bezruchu

`55,12%` linii. Nie „około 55" — **ta sama liczba w dziewięciu kolejnych pomiarach**, od wydania 1
do wydania 9, przez osiem okien pracy. Dowód mocniejszy niż `git log`: raporty `coverage-ed8`
i `coverage-ed9` dają dla tego modułu **identyczne liczby surowe** — 468/849 linii i 164/348
funkcji, nie tylko te same procenty. Gdyby ktoś dopisał jedną linię produkcyjną albo jeden `it()`,
ruszyłby się licznik albo mianownik. W oknie 194 commitów moduł dostał **zero** i jest jedynym
bytem taksonomii całkowicie nieobecnym w ruchu tego okna.

**Ten moduł nie jest nieprzetestowany. Jest przetestowany dokładnie tam, gdzie testowanie jest
tanie.** Rozkład po warstwach jest tu całą diagnozą:

| warstwa                                  | plików | linie cov/total |   linie % | funkcje cov/total | funkcje % |
| ---------------------------------------- | -----: | --------------: | --------: | ----------------: | --------: |
| trasy (`src/routes/**`)                  |      3 |       **0/273** |  **0,00** |         **0/124** |  **0,00** |
| komponenty (`src/components/careers/**`) |     15 |         178/278 |     64,03 |            57/112 |     50,89 |
| warstwa reguł i danych (`src/lib/**`)    |     11 |         290/298 | **97,32** |           107/112 | **95,54** |

Warstwa czystych reguł stoi na 97,32% i ma 171 testów z 374 asercjami — to poziom, który
w tabeli głównej dałby ocenę „wzorowo". Trasy stoją na **dokładnie zerze**: żaden z 171 testów nie
wykonuje ani jednej linii żadnej z trzech tras. Dwie trasy panelu to **257 z 381 niepokrytych
linii modułu (67,5%)** i **123 ze 184 niepokrytych funkcji (66,8%)**. To nie jest moduł równo
słaby — to moduł z jedną, bardzo grubą dziurą.

Uporządkowane po funkcjonalnościach produktu (osiem, granice rozłączne, sumują się do 468/849),
wychodzi z tego zdanie, którego nie napisałbym bez tego rozbioru: **moduł jest przetestowany od
strony osoby, która aplikuje, i nieprzetestowany od strony osoby, która zatrudnia.**

| funkcjonalność produktu                    | plików | linie cov/total |    linie % | funkcje % | niepokrytych linii |
| ------------------------------------------ | -----: | --------------: | ---------: | --------: | -----------------: |
| Panel treści rekrutacji (oferty, retencja) |      2 |           9/157 |   **5,73** |      8,99 |            **148** |
| Landing kariery (hero, wartości, proces)   |      8 |           26/75 |      34,67 |     25,00 |                 49 |
| Skrzynka zgłoszeń i pipeline rekrutera     |      3 |          79/188 |      42,02 |     33,33 |            **109** |
| Katalog ofert dla kandydata                |      7 |           54/89 |      60,67 |     58,49 |                 35 |
| Harmonogram zadań tła (tick)               |      2 |           38/54 |      70,37 |     85,71 |                 16 |
| Wysyłka i podpisywanie CV                  |      2 |           34/47 |      72,34 |     63,64 |                 13 |
| Kreator aplikacji kandydata                |      4 |         211/222 |      95,05 |     87,64 |                 11 |
| Retencja / usuwanie CV (RODO)              |      1 |           17/17 | **100,00** |    100,00 |                  0 |

#### Mechaniczna przyczyna: zero progów na 554

Sprawdzone dwiema niezależnymi metodami — dopasowaniem wszystkich globów progowych do 29 plików
modułu oraz wprost grepem po kluczach: **z 554 progów per-ścieżka w `vitest.config.ts` ani jeden
nie obejmuje żadnego pliku modułu 21.** Moduł jest **mierzony** (nie ma go w `coverage.exclude`),
ale nie jest **bramkowany**: jedyne, co go pilnuje, to próg globalny 80% linii, a 849 linii modułu
to **0,12% z 680 622 linii** w `src/` — wpływ w trzecim miejscu po przecinku.

To domyka diagnozę i jest to najważniejsze zdanie tego rozdziału. Każdy commit w moduły 3, 7, 9,
12, 16 czy 17 natychmiast dostaje czerwono, jeśli obniży pokrycie, bo tam stoją progi punktowe na
poziomach 87–100%. **Moduł 21 jest jedyną dużą powierzchnią produktu, którą można dowolnie
rozbudowywać bez testów, a CI tego nie zauważy.** Bezruch przez osiem okien nie jest więc
zaniedbaniem harmonogramu — jest **przewidywalnym skutkiem braku sprzężenia zwrotnego**. Ostatnia
świadoma praca nad modułem to `5b759d79f` z 2026-08-17 (testy) i `dae7090ed` z 2026-08-23 (dwa
kosmetyczne przejazdy bota po jednym pliku).

#### Błąd w MOJEJ mapie modułów, przez który raportowane 55,12% jest optymistyczne

Reguła `^src/routes/.*(career|job)` dopasowuje wyłącznie nazwy angielskie, a publiczna strona
kariery nazywa się po polsku. Skutek zmierzony `moduleOf()`:

| plik                                         | co to jest                                     | mój moduł |  linie % |
| -------------------------------------------- | ---------------------------------------------- | --------: | -------: |
| `src/routes/zatrudniamy.tsx`                 | **publiczna strona kariery**                   |    **20** | **0,00** |
| `src/lib/server/careerCvRetention.server.ts` | **job usuwający pliki CV — połowa wykonawcza** |    **20** | **0,00** |
| `src/lib/i18n-careers.ts`                    | słownik PL/EN całej powierzchni (862 linie)    |    X-i18n |   100,00 |

Dwa pierwsze pliki są funkcjonalnie rdzeniem modułu 21, oba stoją na zerze i oba rozliczają się do
modułu 20, gdzie topią się w 209 plikach o średniej 79,45%. Liczony po **rzeczywistym obwodzie
funkcjonalnym** moduł ma **468/913 = 51,26% linii** i **164/363 = 45,18% funkcji**, czyli
raportowane 55,12% jest zawyżone o **3,86 pp**. Zlecenie na wydanie 10: dopisać
`R("^src/routes/zatrudniamy", "21")` i `R("^src/lib/server/careerCv", "21")`, z odnotowaniem, że
przenosi to 64 niepokryte linie z modułu 20 do 21. Zapisuję to jako **błąd mapy, nie pomiaru** —
suma globalna się nie zmienia, zmienia się przypisanie.

#### Izolacja najemcy: napisana poprawnie, dowiedziona w jednej szóstej

To jest miejsce, w którym spodziewałem się znaleziska „brak izolacji" i **nie znalazłem go**.
Wszystkie sześć tabel `career_*` ma `tenant_id` (w czterech przypadkach `NOT NULL` z kluczem obcym
kaskadowym), ma włączone RLS i ma polityki wiążące najemcę; polityki bucketu `career-cv` wymuszają
tenanta w **pierwszym segmencie ścieżki** obiektu. Napisane starannie.

Znalezisko jest inne i cięższe, bo dotyczy trwałości tej izolacji, nie jej istnienia.

**Pierwsze: ta izolacja już raz uległa regresji i uratowała ją wyłącznie kolejność alfabetyczna
nazw plików migracji.** Przebieg jest zapisany w nagłówku
`supabase/migrations/20260814194500_career_cv_policies_tenant_scope_reassert.sql` (linie 4–23):
migracja `20260814100000` zawęziła trzy polityki bucketu do najemcy, bo `is_staff()` bada
**wyłącznie rolę, nie najemcę** — redaktor najemcy A mógł podpisać i pobrać KAŻDE CV każdego
najemcy. Trzy godziny później platforma zapisała `20260814122512`, który odtworzył tę samą trójkę
w kształcie SPRZED hardeningu, zdejmując wiązanie najemcy z odczytu i usuwania CV. Stan bazy
uratował fakt, że bliźniak `20260814122639` **sortuje się PO pliku psującym** i wtórnie przywrócił
zawężenie. Klasę tego defektu pilnuje dziś bramka `check:sql-policy-tenant-regression` — sprawdziłem,
że istnieje (`package.json:55`) i że biegnie w CI (`.github/workflows/ci.yml:282`). Ryzyko klasy
jest zamknięte; ryzyko zachowania — nie.

**Drugie: trzy tabele z danymi osobowymi kandydatów i polityki bucketu CV nie mają ANI JEDNEGO
testu pgTAP.** Repozytorium ma 101 plików pgTAP, w tym dedykowane testy izolacji najemcy dla czatu,
klubów i nagłówków. Dla `career_*` istnieje **jeden** plik i testuje widoczność sekcji strony, nie
dane kandydatów. Czyli `career_applications`, `career_application_events`, `career_cv_gc_queue`
i polityki `storage.objects` dla `career-cv` — dokładnie te relacje, w których leżą imię, nazwisko,
e-mail, telefon, LinkedIn i plik CV osoby fizycznej — **są chronione wyłącznie tekstem SQL, którego
nic nie weryfikuje**. Po stronie JavaScriptu kształt ścieżki z tenantem jest dowiedziony solidnie
(`cvUpload.test.ts`, 32 testy, 46 asercji), ale test JS dowodzi tylko tego, co robi klient; **nie
dowodzi, że baza odrzuci klienta, który zrobi inaczej.** Ta asymetria jest istotą znaleziska.
Waga jest tym większa, że autoryzacja `/admin/*` jest w tym repo **wyłącznie klientowa**
(`src/routes/admin.tsx` ma `ssr: false` i przekierowuje w `useEffect`), więc realną granicą
bezpieczeństwa jest RLS, a nie trasa.

#### Zlecenie: dwa pliki podnoszą moduł o trzydzieści punktów

Policzone z niepokrytych linii na oszacowaną liczbę testów, oszacowania z przeczytanego kodu:

| #   | pozycja                                                  | dziś linie / funkcje | testów |   linii/test | rodzaj                          |
| --- | -------------------------------------------------------- | -------------------: | -----: | -----------: | ------------------------------- |
| 1   | `src/routes/admin.careers.tsx` (skrzynka rekrutera)      |        0,00% / 0,00% |    ~11 |      **9,9** | komponentowy + atrapa PostgREST |
| 2   | `src/routes/admin.hiring.tsx` (panel treści)             |        0,00% / 0,00% |    ~16 |      **9,2** | komponentowy + jednostkowy      |
| 3   | **pgTAP: izolacja najemcy na danych kandydatów**         |           brak testu |     ~8 | n/d (ryzyko) | pgTAP                           |
| 4   | `CareersValues.tsx` (spotlight zasad, Radix Tabs)        |        0,00% / 0,00% |     ~5 |          5,4 | komponentowy + axe              |
| 5   | `api/public/jobs-tick.ts` (sekret, stały czas, limit)    |        0,00% / 0,00% |     ~4 |          4,0 | funkcji serwerowej              |
| 6   | `CareersRoles.tsx` (filtr działów, `aria-live`)          |        0,00% / 0,00% |     ~4 |          3,2 | komponentowy                    |
| 7   | `CareerStat.tsx` (degradacja bez `IntersectionObserver`) |      38,09% / 40,00% |     ~4 |          3,2 | komponentowy                    |
| 8   | `CareerCvField.tsx` (gałąź pliku, limit 5 MB, MIME)      |      40,90% / 33,33% |     ~5 |          2,6 | komponentowy                    |
| 9   | `CareerRoleDialog.tsx` (popup oferty)                    |        0,00% / 0,00% |     ~3 |          3,0 | komponentowy                    |
| 10  | sześć atomów i molekuł razem                             |        0,00% / 0,00% |     ~8 |          1,8 | komponentowy, jeden plik        |

**Wariant minimalny — tylko dwie trasy panelu, ~27 testów — podnosi moduł z 55,12% na 85,39% linii
i z 47,13% na 82,47% funkcji**, czyli nad próg globalny, jednym zadaniem. Pełne zlecenie bez pgTAP
(63 testy) daje 98,35% linii i 96,26% funkcji.

**Warunek trwałości, bez którego to się cofnie.** Domknięcie testów nie usuwa przyczyny bezruchu.
Po pozycjach 1–2 trzeba dopisać progi per-ścieżka dla `src/lib/careers/**`,
`src/components/careers/**` i `src/routes/admin.{careers,hiring}.tsx`, kilka punktów poniżej
osiągniętego poziomu, zgodnie z konwencją zapadki w tym pliku. Bez tego moduł pozostanie jedyną
dużą powierzchnią produktu bez sprzężenia zwrotnego w CI — a to, nie brak czasu, jest **zmierzoną**
przyczyną dziewięciu identycznych pomiarów.

#### Przypis narzędziowy, który dotyczy każdego przyszłego audytu tego repo

`src/lib/careers/__tests__/cvUpload.test.ts` zawiera w linii 245 bajt NUL (`"cv\x00.pdf"` — celowa
atrapa poison-null-byte, nie uszkodzenie pliku). `grep` bez `-a` traktuje ten plik jako binarny
i **raportuje 0 asercji zamiast 46**. Każdy skrypt liczący asercje grepem po cichu gubi ten plik.
Skrypty tego wydania używają `grep -a`; zapisuję to, bo jest to klasa błędu, która nie daje
żadnego sygnału — po prostu zaniża liczbę.

### 12.9. Inwentarz bomb i18n: ile jeszcze testów zgaśnie przy następnej zmianie słownika

Awaria z 12.2 nie jest wypadkiem jednostkowym — jest **drugą iteracją tej samej klasy**, a repo
ma zapisaną pierwszą. Komentarz nagłówkowy `src/test/i18nReal.ts:11-12` mówi wprost: _„Po zdjęciu
zapasowych tekstów (bramka `check:i18n-default-value`) 47 takich asercji w 9 plikach zgasło naraz
— i to jest miara tego, ile z nich mierzyło słownik: zero."_ Skoro klasa jest znana i już raz
uderzyła, policzyłem, ile ładunku zostało.

**Definicja, bo bez niej liczba nic nie znaczy:** miejsce w pliku `*.test.ts(x)` pod `src/**`,
w którym selektor albo asercja zawiera literał **będący wartością któregoś ze 140 plików
słownikowych** (`src/lib/locale/pl.ts`, `src/lib/i18n-*.ts`, `src/lib/i18n/**` — 26 525 unikalnych
wartości polskich). Ten warunek odsiewa fikstury, których w słownikach nie ma.

| warstwa pomiaru                                                                                  |    miejsc |  plików |
| ------------------------------------------------------------------------------------------------ | --------: | ------: |
| literał = wartość słownika (szeroko)                                                             |     2 742 |     520 |
| **wąsko**: literał = wartość słownika ∧ (diakrytyka lub czasownik akcji) ∧ długość ≥ 4           | **1 068** | **221** |
| z tego podzbiór **najkruchszy**: porównanie DOKŁADNE na `textContent` (`===`, `toBe`, `toEqual`) |    **19** |   **8** |
| wszystkie `textContent … === "…"` w testach, niezależnie od języka literału                      |        21 |      10 |

Rozbicie warstwy wąskiej po rodzaju selektora: `getByRole({ name })` **520**, `getByText` **386**,
`getByLabelText` 92, `textContent).toBe/toContain` 46, `toHaveTextContent` 14,
`getByPlaceholderText` 7, `textContent ===` 3.

Rozkład wagi jest tu ważniejszy od sumy. `getByRole({ name })` i `getByLabelText` są **odporne
w połowie**: pytają o rolę i nazwę dostępną, więc zmiana słownika je zgasi, ale test nie przestaje
mierzyć dostępności. `textContent === "…"` nie ma tej właściwości wcale — pyta o dokładny ciąg
znaków i o nic więcej. **Dziewiętnaście takich miejsc w ośmiu plikach to realny inwentarz bomb tej
samej konstrukcji, która wybuchła w tym wydaniu.**

**Trzy z tych dziewiętnastu stoją w pliku, który już wybuchł** — i jedna z nich jest uzbrojona
przez tę samą kampanię, która zdetonowała pierwszą:

- `adminSettingsRoutes.test.tsx:1665` → `button.textContent === "Podgląd"`. Literał **jest już**
  wartością słownika (m.in. `pl.ts:226, 695, 714`), a w produkcji stoi w co najmniej pięciu
  miejscach jako wpisany na sztywno tekst (`PatternPicker.tsx:192,321`,
  `ThemeFontSizesPane.tsx:355`, `ArchiveLivePreview.tsx:95`, `PropertiesPanel.tsx:144`) — czyli
  jest na liście do i18n-izacji.
- `adminSettingsRoutes.test.tsx:2674` → `button.textContent === "Logo: jasne"`. Ten literał żyje
  **wyłącznie w produkcji**, w `admin.settings.google-source.tsx:134`
  i `admin.settings.cookie-banner.tsx:380` — czyli **w dwóch z jedenastu tras, które właśnie
  spadły** — i nie ma go jeszcze w żadnym słowniku. Następny commit i18n-izujący te dwie trasy
  zgasi ten test dokładnie tym samym mechanizmem, co poprzedni.

Presja jest przy tym stała i mierzalna: `reports/i18n-parity.json` pokazuje **169 nieprzetłumaczonych
kluczy w prefiksach objętych bramkami i 519 w całym repozytorium**, więc program i18n-izacji będzie
dalej zamieniał literały na `t()`. Innymi słowy: **to nie jest ryzyko hipotetyczne, to harmonogram.**

TOP 10 plików w warstwie wąskiej — lista do przejrzenia, nie do przepisania w całości:

|   # | miejsc | plik                                                                                 |
| --: | -----: | ------------------------------------------------------------------------------------ |
|   1 |     43 | `src/routes/__tests__/pricingRoute.test.tsx`                                         |
|   2 |     34 | `src/components/audio/__tests__/audioOrganisms.test.tsx`                             |
|   3 |     30 | `src/routes/__tests__/adminCompaniesRoutes.test.tsx`                                 |
|   4 |     29 | `src/routes/__tests__/adminBillingAuditRoute.test.tsx`                               |
|   5 |     27 | `src/components/admin/menu/__tests__/MenuManager.test.tsx`                           |
|   6 |     25 | `src/components/builder/organisms/widget-view/__tests__/SearchButtonWidget.test.tsx` |
|   7 |     21 | `src/routes/__tests__/searchRoute.test.tsx`                                          |
|   8 |     20 | `src/components/admin/community/__tests__/EventSpeakersManager.test.tsx`             |
|   9 |     20 | `src/components/admin/newsletter/builder/__tests__/NewsletterBuilder.test.tsx`       |
|  10 |     19 | `src/components/admin/pricing/atoms/__tests__/atoms.test.tsx`                        |

#### Naprawa, która jest już w repo — i pułapka „naprawy przez słownik"

Wzorzec odporny **istnieje w tym repozytorium w dwóch wariantach** i naprawa nie wymaga nowej
konwencji, tylko dosunięcia jednego pliku do obowiązującej:

- **wariant kluczowy** (dla plików montujących atrapę i18n): `adminUsersRoutes.test.tsx:936`
  porównuje z `"adminUsers.clear"`, `widgetPropertiesPanel.test.tsx:768,788,1005` z `"builder.hover.bg"`;
- **wariant słownikowy** (dla plików z prawdziwym i18n): `adminSettingsAnalyticsRoute.test.tsx:299-313`
  ma pomocnik `saveBarLabels()`/`saveBar()`, który buduje zbiór etykiet z `realT("pl")` i `realT("en")`.

Minimalna naprawa padniętego pliku to **dwa miejsca, zero zmian w produkcji, zero obniżeń progu**:
pomocnik `saveButton()` (linie 389-394) liczy etykiety tą samą funkcją, którą dostaje komponent
(`translateKey` z `@/test/i18nStub`), a asercja stanu zapisu w linii 514 porównuje
z `translateKey("admin.saving")` zamiast z literałem „Zapisywanie…".

**I pułapka, którą trzeba nazwać, bo jest nieoczywista i kosztowałaby drugi przebieg.** Test
podmienia `react-i18next` na `@/test/i18nStub` (linia 98), a ta atrapa zwraca **klucz zamiast
tłumaczenia** — w DOM stoi dosłownie `admin.saveSettings` (widać to w zrzucie z logu:
`<h2>admin.general.title</h2>`). Z tego wynika rzecz, którą w pierwszym szkicu tego rozdziału
uzasadniłem **poprawnie w konkluzji, ale na błędnej przesłance**: pisałem, że nawet prawdziwe i18n
nie trafiłoby w literał testu, bo `pl.ts:1018` niesie „Zapisz ustawienia", a nie „Zapisz zmiany".
Konkluzja jest słuszna, ale przesłanka nieistotna — **w tym pliku słownik nie ma wpływu na nic**,
bo jest zamockowany. Test nie trafiłby w literał **niezależnie od treści słownika**. Różnica jest
praktyczna: unieważnia „naprawę" polegającą na zmianie wartości w `pl.ts`, i unieważnia też użycie
`realT` w tym konkretnym pliku — porównanie z prawdziwym tłumaczeniem padłoby tak samo jak dziś.

#### Kontrola dodatnia: 951 sekund, które nie powiedziały nic

Zerwanie jednego pomocnika kosztowało **951,6 s, czyli 42,9% czasu ściany całego przebiegu**,
i powtórzyło 188 razy ten sam komunikat `expected undefined to be truthy` — bez wskazania
przyczyny. Jeden przypadek postawiony na początku pliku, w rodzaju „w panelu `general` po montażu
istnieje DOKŁADNIE jeden przycisk o etykiecie z `SAVE_BAR_LABELS`", oblewa się w milisekundach
i mówi, co się stało. Repozytorium samo nazywa ten wzorzec **KONTROLĄ DODATNIĄ** i stosuje go
m.in. w `pollsRoute.test.tsx`. Zapisuję to jako zlecenie, bo dotyczy każdego pliku, w którym
pojedynczy pomocnik jest wąskim gardłem kilkuset przypadków.

### 12.10. Szum własny pomiaru: dwa pełne przebiegi na tym samym HEAD, pięć plików różnicy

Ta seria dziewięciu wydań opierała się na założeniu, którego ani razu nie sprawdziłem: że pomiar
pokrycia jest **deterministyczny**, więc różnica między wydaniami to zawsze praca, nigdy szum.
W tym wydaniu okazja sprawdzenia przyszła sama — pierwszy przebieg nie wypisał `coverage-final.json`
(w konfiguracji nie ma reportera `json`, a bez tego pliku nie da się podać nazw niewywołanych
funkcji), więc odpaliłem **drugi pełny przebieg na tym samym HEAD** z dołożonym reporterem. Dostałem
dzięki temu coś cenniejszego niż nazwy funkcji: **kalibrację szumu własnego pomiaru.**

Zgodność wyniku testów jest **całkowita**, co samo warto zapisać:

|                | przebieg 1                                                                 | przebieg 2         |
| -------------- | -------------------------------------------------------------------------- | ------------------ |
| pliki testowe  | 8 padło \| 2 208 przeszło \| 2 pominięte (2 218)                           | **identycznie**    |
| przypadki      | 272 padło \| 60 584 przeszło \| 337 expected fail \| 51 pominięte (61 244) | **identycznie**    |
| czas przebiegu | 2 216,67 s                                                                 | 2 150,93 s (−3,0%) |

Pokrycie **nie** jest natomiast identyczne — i to jest wynik, który zmienia sposób czytania delt
w tym dokumencie:

| wymiar     | przebieg 1 | przebieg 2 | różnica | udział w mianowniku | procent po zaokrągleniu |
| ---------- | ---------: | ---------: | ------: | ------------------: | ----------------------- |
| linie      |     97 157 |     97 156 |  **−1** |            0,00093% | 90,75% → 90,75%         |
| instrukcje |    109 585 |    109 586 |  **+1** |            0,00082% | 89,49% → 89,49%         |
| funkcje    |     30 395 |     30 397 |  **+2** |            0,00581% | 88,22% → 88,23%         |
| gałęzie    |     93 859 |     93 865 |  **+6** |            0,00539% | 84,25% → 84,26%         |

Mianowniki są **dokładnie te same** we wszystkich czterech wymiarach, więc to nie efekt innego
zbioru plików — to inne wykonanie tego samego zbioru. Rozjazd dotyczy **pięciu plików z 3 304**
i wszystkie pięć jest tego samego rodzaju: kod zależny od czasu, cyklu życia albo dynamicznego
importu.

| plik                                                     |       linie |     funkcje |     gałęzie |
| -------------------------------------------------------- | ----------: | ----------: | ----------: |
| `src/components/blocks/LiveBlogBlock.tsx`                |     51 → 51 | 20 → **21** | 46 → **50** |
| `src/lib/ssrCache.ts`                                    | 49 → **48** |  10 → **9** |     29 → 29 |
| `src/lib/icons/DynamicIconFull.tsx`                      |     12 → 12 |       4 → 4 |   7 → **9** |
| `src/lib/builder/liveTypography.ts`                      |     56 → 56 | 10 → **11** |     28 → 28 |
| `.../post-editor/molecules/OrganizationPickerDialog.tsx` |     38 → 38 | 15 → **16** |     48 → 48 |

**Trzy wnioski, wszystkie operacyjne.**

**Pierwszy: szum jest o dwa rzędy wielkości mniejszy od najmniejszej delty, jaką ten dokument
raportuje.** Największa rozbieżność to sześć gałęzi z 111 399, czyli **0,0054%**. Zaokrąglone do
dwóch miejsc procenty są identyczne na liniach i instrukcjach, a różnią się o **0,01 pp** na
funkcjach i gałęziach. Wszystkie delty modułowe w rozdz. 2.1 (od +0,04 do +61,26 pp) są więc
bezpiecznie nad progiem szumu. **Jedyne miejsce, gdzie szum ma znaczenie, to delty rzędu setnych
punktu** — i dlatego moduł 1 (−0,02 pp) i moduł 5 (−0,004 pp) opisuję jako „bez ruchu", a nie jako
spadki: **nie da się ich odróżnić od szumu pomiaru.**

**Drugi: to jest ilościowe uzasadnienie marginesu w zapadce, którego dotąd nie miałem.** Reguła
`floor(zmierzone − 4)` dla globów i proponowane 2 pp dla progów per-plik były uzasadniane „dryfem
CI" bez liczby. Teraz liczba jest: **dryf wykonania na tym samym HEAD i tej samej maszynie to
≤0,006 pp na wymiarze globalnym**. Margines 2 pp jest zatem **ponad trzystukrotnie** większy niż
zmierzony szum — czyli nie broni przed szumem wykonania, a przed czymś innym: dryfem składu globa
i różnicą host ↔ runner. To rozróżnienie jest ważne, bo margines liczony „na szum" mógłby być
o rząd wielkości mniejszy, a margines liczony „na dryf składu" nie ma z szumem nic wspólnego.

**Trzeci: pięć plików z rozjazdem to gotowa lista testów o niedeterministycznym zasięgu.** Żaden
z nich nie jest dziś czerwony i żaden nie łamie progu, ale każdy z nich znaczy to samo: **test
tego pliku wykonuje różny zbiór gałęzi w różnych przebiegach.** `LiveBlogBlock` (blog na żywo,
odpytywanie w interwale), `ssrCache` (cache z TTL), `DynamicIconFull` (import dynamiczny) — to
klasyka. Nie proponuję ich naprawy jako pilnej, ale zapisuję jako miejsca, w których próg per-plik
postawiony „pod sufit" (99–100) może zapalić się bez żadnej zmiany w kodzie. Trzy z tych pięciu
plików leżą pod globami z progiem ≥95.

**I jedna rzecz do naprawy w konfiguracji, bo to ona wymusiła drugi przebieg za 2 151 sekund:**
lista reporterów w `vitest.config.ts` to `["text-summary", "text", "html", "json-summary"]` — **bez
`json`**, więc `coverage-final.json` nie powstaje. Ten plik jest jedynym źródłem, z którego da się
odczytać, KTÓRE funkcje nie zostały wywołane (rozdz. 4 opiera się na nim w całości). Dołożenie
`"json"` do listy jest zmianą jednowyrazową i oszczędza pełny przebieg suity przy każdym audycie.
