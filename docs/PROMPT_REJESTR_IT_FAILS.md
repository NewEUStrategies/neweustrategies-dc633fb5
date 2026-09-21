# ZADANIE: dać rejestrowi `it.fails` zapadkę, właściciela i termin - bo rośnie od pięciu wydań i nic go nie naciska

Wejście: audyt pokrycia testami, wydanie 9
(`docs/AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md`, rozdz. 7.2).

**Stan: 327 wywołań `it.fails(` w 186 plikach testowych** (plus 3 `it.fails.each`;
`test.fails` i `describe.fails` - zero). Ścieżka, z liczbą plików, bo ona jest
informacyjna (rozdz. 7.2 audytu): wydanie 4 zapisało zalecenie „zamienić 24 `it.fails`
na naprawy" przy **24 wpisach w 20 plikach**, wydanie 5 zastało **151 w 84**, wydanie 6 -
**171 w 94**, wydania 7 **i 8** - **255 w 147** (dwa wydania z rzędu, licznik STAŁ),
wydanie 9 - **327 w 186**.

Ten jeden płaski odcinek jest ważniejszy niż cała reszta trajektorii: **rejestr potrafi
nie rosnąć.** W wydaniach 7 i 8 nie urósł ani o wpis, mimo 147 plików testowych - a potem
skoczył o 72 w oknie dwóch dni. Czyli to nie jest proces ciągły, któremu trzeba „więcej
dyscypliny". To seria kampanii, z których niektóre wchodzą w powierzchnie bez testów
i **tam** produkują wpisy hurtowo.

**To zlecenie NIE jest prośbą o naprawienie 327 defektów.** Zalecenie „napraw je"
zostało wydane cztery razy i cztery razy nie zadziałało, bo nie miało ani właściciela,
ani terminu, ani mechanizmu. Zadanie jest inne: **zbudować mechanizm, który sprawia, że
zapisanie defektu przestaje być darmowe, a rejestr może się tylko zmniejszać** - i dopiero
potem, w tym mechanizmie, spłacić pierwszą kohortę.

---

# 0. Co jest ustalone. Przeczytaj to, zanim cokolwiek zmienisz

## 0.1 Rejestr ma PIĘTNAŚCIE DNI, a nie pięć wydań

To jest najważniejsza liczba tego zlecenia i zmienia diagnozę. `git blame` po każdej z 327
linii z `it.fails(`:

- **najstarszy wpis: 2026-08-19**, najnowszy: **2026-09-02**;
- **wpisów starszych niż 2026-08-18 (data pierwszego wydania audytu): ZERO**;
- 251 wpisów powstało między 2026-08-18 i 2026-08-31, **76** od 2026-09-01.

Rozkład po dniach nie jest równomierny - to serie:

|  wpisów | dzień      |
| ------: | ---------- |
| **115** | 2026-08-22 |
|      56 | 2026-09-02 |
|      55 | 2026-08-30 |
|      29 | 2026-08-31 |
|      21 | 2026-08-21 |
|      20 | 2026-09-01 |
|      17 | 2026-08-19 |
|      11 | 2026-08-23 |
|       3 | 2026-08-20 |

**Jeden dzień - 2026-08-22 - to 115 wpisów, czyli 35% całego rejestru.** To nie jest
zaniedbanie narastające miesiącami. To rejestr **budowany razem z suitą testów**, w seriach
odpowiadających kampaniom testowym. Potwierdza to mechanizm, który audyt sam opisał:
**test, który po raz pierwszy dotyka gałęzi odmowy, tę odmowę czyta** - kampania pisząca
testy tam, gdzie ich nie było, produkuje serię wpisów tego samego dnia.

Konsekwencja praktyczna: **nie traktuj tych 327 wpisów jak długu technicznego do
spłaty w całości.** Traktuj je jak **wynik pomiaru, który dopiero powstał** - i któremu
brakuje trzech rzeczy: zapadki, właściciela i terminu.

## 0.2 Rejestr JEST samoczyszczący - i to jest już dowiedzione

`it.fails` w vitest **oblewa przebieg, gdy test PRZECHODZI**. Czyli: naprawa defektu zapala
wpis na czerwono i wymusza jego zdjęcie. Rejestr nie jest jednokierunkowy.

Dowód jest w audycie **dwa razy i w dwóch rolach** - i tę różnicę trzeba przeczytać
dokładnie, bo ona rozstrzyga, czy mechanizm działa do końca, czy tylko się zapala.
Wiersz `lib/server/__tests__/serviceRoleTenantScope.gate.test.ts` w tabeli czerwieni
rozdz. 3 (linia 1208): _„`it.fails`, który ZACZĄŁ przechodzić - czyli dług naprawiony,
przypięcie nieusunięte"_. Defekt zamknęła migracja schematu (`page_full_path` z unikatem
`pages(id, tenant_id)`, migracja `20260831160000_page_full_path_tenant_scope.sql`), a wpis
to wykrył **sam**. Złapało go wydanie **8**, a rozdz. 7.2 dopisuje domknięcie: przypięcie
_„został[o] w tym oknie wycofane, czyli procedura zadziałała"_.

**Sprawdziłem to na dzisiejszym HEAD, zamiast wierzyć zapisowi:**
`grep -c 'it\.fails' src/lib/server/__tests__/serviceRoleTenantScope.gate.test.ts` daje
**zero**. Przypięcia w tym pliku już nie ma, a plik dalej biegnie. Pętla domknęła się
faktycznie, nie tylko w opisie.

To jest zatem pełna pętla, nie połowa: naprawa → wpis na czerwono → zdjęcie przypięcia.
Przeszła przez dwa wydania i przez ręce człowieka, ale przeszła. Rejestr **nie** jest
jednokierunkowy - i to jedyny twardy argument, jaki to zlecenie ma na poparcie tezy, że
zapadka na nim ma sens: mechanizm, który sam sygnalizuje spłatę, wolno zamrozić liczbą.

**Ale ta właściwość działa tylko tam, gdzie test się WYKONUJE.** Dziś nie wykonuje się
w trzech miejscach:

1. **osiem czerwonych plików (272 testy)** - opisane w rozdz. 12.2 i w
   `docs/PROMPT_OSIEM_CZERWIENI.md`; wpisy w plikach, które padają wcześniej, nie
   dochodzą do swojej asercji;
2. **dwa pliki / 50 testów, które pomijają się SAME** z braku sekretów Supabase
   (`db-schema-invariant`, `lang-parity`) - i, co rozdz. 9.2 audytu ustaliło,
   **nie wykonują się także na CI**;
3. **jedno bezwarunkowe `describe.skip`** - `src/routes/__tests__/rootShellRender.test.tsx:91`.

To jest realna luka mechanizmu, a nie hipoteza: dopóki te trzy miejsca istnieją, rejestr
nie może się wyczyścić w tej części, w której naprawa już nastąpiła.

## 0.3 Repozytorium MA już cztery zapadki na dług - i żadnej na własny rejestr defektów

To jest argument, od którego zaczyna się część A, i najmocniejsze zdanie tego zlecenia.

**Nie istnieje ani jedna bramka, żaden skrypt i żaden baseline, który liczyłby `it.fails`.**
Sprawdzone: `grep` po `scripts/`, `src/lib/ci/` i `package.json` - zero trafień poza jednym
komentarzem w harnessie SQL. Trzydzieści dziewięć bramek `check:*` i żadna nie widzi rejestru.

A jednocześnie ten sam repozytorium **ma dokładnie taki mechanizm, napisany, przetestowany
i wpięty w CI - cztery razy**:

| moduł                               | baseline                                   | wpisów w baseline | co pilnuje                 |
| ----------------------------------- | ------------------------------------------ | ----------------: | -------------------------- |
| `src/lib/ci/hardcodedLanguage.ts`   | `scripts/lib/i18nHardcodedBaseline.ts`     |           **110** | dwujęzyczny tekst w kodzie |
| `src/lib/ci/unknownCasts.ts`        | `scripts/lib/unknownCastBaseline.ts`       |           **124** | rzutowania `as unknown as` |
| `src/lib/ci/i18nOverlayImports.ts`  | `scripts/lib/i18nOverlayImportBaseline.ts` |            **76** | importy nakładek i18n      |
| `src/lib/ci/monolingualUserText.ts` | (ratchet w module)                         |                 - | tekst jednojęzyczny        |

Każdy z nich ma tę samą, gotową trójkę funkcji: `compareWithRatchet(hits, baseline)` →
`{ fresh, grown, improved, total }`, `ratchetFailed(report)` i `renderRatchetReport(...)`.
Semantyka `ratchetFailed` (`hardcodedLanguage.ts:180-182`, z komentarzem `:174-179`) jest
dokładnie ta, której rejestr potrzebuje: **bramka pada na NOWYM długu i na WZROŚCIE, a
poprawa NIE oblewa** - bo inaczej ścięcie kilku wystąpień wymuszałoby edycję baseline'u
w tym samym commicie i zniechęcało do drobnych porządków.

Jednym zdaniem: **platforma pilnuje zapadką 124 rzutowań `as unknown as` i 110 napisów
w kodzie, a nie pilnuje 327 zarejestrowanych defektów produkcyjnych.**

## 0.4 Opisy są dobre. Brakuje odpowiedzialności

Zmierzone na 198 wpisach, które mają tytuł w cudzysłowie prostym w tej samej linii
(pozostałe 129 buduje tytuł szablonem, `it.fails.each` albo łamie go na następną linię -
mój skaner ich nie czyta, i tę granicę pomiaru trzeba znać):

- długość tytułu: **min 26 znaków, mediana 62, maks 78**;
- **poniżej 25 znaków: ZERO** - nie ma wpisów-śmieci typu „nie działa";
- **76 zaczyna się od `DEFEKT:`**, 10 od `POWINN…`, 131 zawiera słowo pisane wielkimi
  literami dla nacisku - czyli konwencja opisowa istnieje, nawet jeśli nie jest zapisana;
- **wpisów wskazujących właściciela: ZERO** - sprawdzone po `@ktoś`, `owner:`,
  `właściciel:`, `zespół:` i `TODO(...)` na wszystkich 327 liniach;
- **wpisów z terminem naprawy: ZERO.** Słowo „termin" pada w całym rejestrze **raz**
  (`EventTicketCard.test.tsx:403`) i dotyczy strefy czasowej wydarzenia, nie daty naprawy.

Uwaga o rozbieżności z audytem, żeby nikt nie tracił czasu na jej odtwarzanie: rozdz. 7.2
podaje **medianę 68 znaków** dla wszystkich 327 wpisów, ja podaję **62** dla 198 tytułów
czytelnych regexem. To nie sprzeczność, to inna populacja - tytuły szablonowe są dłuższe.
Bierz **68** jako liczbę o rejestrze, **62** jako liczbę o tej próbce.

Diagnoza jest więc precyzyjna: **rejestr ma dobre opisy i zero metadanych rozliczeniowych.**
Wiadomo, CO jest zepsute. Nie wiadomo, KTO to naprawi i DO KIEDY - i to jest dokładnie ta
para, której brak sprawia, że zalecenie z wydania 4 nie zadziałało cztery razy z rzędu.
Zero właścicieli i zero terminów na 327 wpisach to nie zaniedbanie pojedynczych autorów:
**nie ma gdzie tego wpisać.** Formularz nie istnieje, więc pola są puste.

## 0.5 Gdzie rejestr siedzi

Rozkład policzony **kanonicznym mapowaniem ścieżek na moduły** - tym samym, którym liczy
cały audyt - a nie po nazwach katalogów. Suma kolumny to dokładnie 327, i to jest jedyny
sposób sprawdzenia, że mapowanie nikogo nie zgubiło:

|  wpisów | moduł                                                      |
| ------: | ---------------------------------------------------------- |
| **115** | 20 - Platforma / backend / infrastruktura / SSR            |
|      52 | 22 - Wydarzenia: event builder, rejestracja, onsite        |
|      31 | 16 - Społeczność: kluby, komentarze, moderacja             |
|      29 | 03 - Silniki treści: bloki + page builder                  |
|      27 | 08 - SEO, feedy, dane strukturalne                         |
|      19 | 15 - Profil i konto                                        |
|       9 | 07 - Typy treści specjalne                                 |
|       9 | 09 - Czat / komunikator                                    |
|       9 | X-shell - powłoka panelu admin + atomy/molekuły            |
|       8 | 19 - Ustawienia / integracje / users / multi-tenant / RODO |
|       7 | 12 - Realtime / powiadomienia / web-push                   |
|       6 | 11 - Newsletter i e-mail                                   |
|       3 | 13 - Monetyzacja: checkout / subskrypcje / billing         |
|       1 | 04 - Strony, wygląd, motyw, media, import                  |
|       1 | 05 - Strona główna, archiwa, chrome                        |
|       1 | X-other - nieprzypisane (`src/__tests__/router.test.tsx`)  |
| **327** | **suma**                                                   |

**Trzydzieści pięć procent rejestru siedzi w module 20**, a pierwsze cztery moduły to
227 wpisów, czyli 69%.

**Zbieżność, o którą łatwo się potknąć: „115" pada w tym zleceniu dwa razy** - 115 wpisów
powstało 2026-08-22 (§0.1) i 115 wpisów siedzi w module 20. **To NIE są te same wpisy** -
przekrój wynosi 63. Sprawdziłem to właśnie dlatego, że wniosek „jedna kampania, jeden
moduł, jeden dzień" byłby wygodny i fałszywy:

- dzień **2026-08-22** rozkłada się na **osiem modułów** (20: 63, 15: 19, 08: 18, 19: 7,
  X-shell: 3, 11: 2, 13: 2, 05: 1) - to była szeroka kampania, nie jeden obszar;
- moduł **20** rozkłada się na **siedem dni** (63 · 28 · 8 · 6 · 5 · 3 · 2) - to obszar
  dotykany wielokrotnie, nie jednorazowy zrzut.

Praktyczny wniosek dla A2: klasyfikacja **po module** i klasyfikacja **po kampanii** dają
inne kohorty, więc adnotacja musi nieść klasę defektu, a nie tylko lokalizację - moduł już
znamy ze ścieżki pliku i sam z siebie nie mówi, kto ma to naprawić. Modułów **14, 17, 18, 21, X-ui i X-i18n w rejestrze NIE MA ANI
RAZU** - i to nie jest dobra wiadomość: moduł 21 ma w audycie dziewięć identycznych
pomiarów z rzędu (rozdz. 12.8), więc zero wpisów znaczy tam „nikt nie zaglądał", nie
„nic nie znaleziono".

Pliki z największą gęstością: `src/lib/events/__tests__/sponsorEnumParity.test.ts` (10),
`src/routes/__tests__/adminAudienceRoutes.test.tsx` (8),
`src/routes/__tests__/adminCommunityInsightRoutes.test.tsx` (7),
`src/components/admin/blocks/edit/__tests__/blockEditCoercionDefects.test.tsx` (7).

I jedna liczba, która mówi o higienie rejestru więcej niż rozkład: **żaden ze 186 plików nie
zawiera WYŁĄCZNIE `it.fails`** - każdy ma też zwykłe `it()`. Rejestr jest wpleciony w żywe
suity, nie zaparkowany w kwarantannie. To dobra wiadomość: wpisy biegną razem z testami,
które przechodzą, więc samoczyszczenie z §0.2 ma gdzie działać.

## 0.6 Czego NIE robić - to jest najważniejszy akapit tego zlecenia

**Trzy „naprawy", które wyglądają na rozwiązanie i są gorsze od problemu:**

1. **NIE zamieniaj `it.fails` na `it.skip`.** To zabija właściwość z §0.2: pominięty test
   nigdy nie zapali się na zielono, więc naprawiony defekt zostaje zamaskowany na zawsze.
   Rejestr przestaje być rejestrem, a staje się cmentarzem. Jeśli w PR-ze pojawi się choć
   jedna taka zamiana, całe zlecenie jest do odrzucenia.
2. **NIE usuwaj wpisów, żeby zmniejszyć licznik.** Zdjęcie `it.fails` bez naprawy defektu to
   ukrycie defektu. Licznik ma spadać **wyłącznie** przez: naprawę produkcji + zamianę
   `it.fails` na `it`, albo przez wykazanie, że wpis opisuje nieistniejący defekt (i wtedy
   z uzasadnieniem w PR).
3. **NIE naprawiaj produkcji, zostawiając przypięcie.** Naprawa zapala wpis na czerwono -
   to jest cecha, nie usterka. Poprawna kolejność: napraw defekt → zamień `it.fails` na
   `it` → zaktualizuj baseline w TYM SAMYM commicie.

---

# CZĘŚĆ A - MECHANIZM (P1). Bez tego reszta jest kolejnym zaleceniem bez skutku

## A1. Zapadka na rejestr - `check:it-fails-ratchet`

**To jest pozycja blokująca. Wszystko inne w tym zleceniu jest bez niej bezwartościowe.**

Zbuduj bramkę, która liczy `it.fails(` per plik testowy i porównuje z zamrożonym
baseline'em. **Nie wymyślaj mechanizmu - skopiuj istniejący.** Wzorzec, którego masz użyć,
jest w `src/lib/ci/unknownCasts.ts` + `scripts/lib/unknownCastBaseline.ts` +
`scripts/check-unknown-casts.ts` (124 wpisy, ta sama klasa problemu: policzalny dług per
plik, który ma tylko maleć). Podaj w PR, z którego z czterech wariantów wziąłeś kod.

Wymagania, każde z powodem:

1. **Skan liczy `it.fails(`, `it.fails.each` i - na przyszłość - `test.fails(` oraz
   `describe.fails(`.** Dziś dwie ostatnie formy mają zero wystąpień, ale bramka bez nich
   ma darmową furtkę.
2. **Komentarze i literały maskowane PRZED skanem** - `maskComments` z istniejących modułów.
   Bez tego bramka policzy własną dokumentację i ten dokument. To nie hipoteza: ten sam
   błąd jest w audycie zmierzony na pomiarze `as any` (rozdz. 12.4) - bez wygaszenia
   komentarzy wychodzi 10 trafień, **z których dziewięć to zdania o tym, że repo `as any`
   NIE używa**. Dziewięćdziesiąt procent szumu z jednego brakującego kroku.
3. **Baseline per PLIK, nie globalna liczba.** Globalna suma pozwala dodać pięć wpisów
   w jednym miejscu i zdjąć pięć w innym - a to jest ruch, który wygląda jak postęp
   i nim nie jest.
4. **`ratchetFailed` dokładnie jak w istniejących modułach**: pada na `fresh` (nowy plik
   w rejestrze) i na `grown` (wzrost w pliku), **nie pada na `improved`**. Ten wybór jest
   już w repozytorium uzasadniony komentarzem (`hardcodedLanguage.ts:174-179`) i tu
   obowiązuje z tego samego powodu.
5. **Komunikat bramki musi mówić, CO ZROBIĆ.** Wzoruj się na
   `renderRatchetReport` z `hardcodedLanguage.ts:184+`: nowy wpis → „defekt zarejestrowany
   to defekt do naprawy, nie do zapisania na stałe; dopisz go do baseline'u w tym samym
   commicie i podaj właściciela oraz termin (A2)".
6. **`--print-baseline`** jak w `check-i18n-hardcoded.ts:46-50` - żeby odświeżenie listy
   po naprawie było jednym poleceniem, a nie ręcznym liczeniem.
7. **Wpis w `package.json` i krok w `.github/workflows/ci.yml` BEZ `continue-on-error`**,
   plus **własny test bramki z KONTROLĄ NEGATYWNĄ**: test dowodzący, że bramka **oblewa**
   na dorzuconym wpisie i **przechodzi** po jego zdjęciu. Bramka bez kontroli negatywnej to
   bramka, o której nie wiadomo, czy działa.

**Kryterium odbioru:** `bun run check:it-fails-ratchet` zielony na tym HEAD z baseline'em
327 wpisów w 186 plikach; czerwony po dorzuceniu jednego `it.fails` w dowolnym pliku
(pokaż oba przebiegi w PR); `check:gate-coverage` zielony, czyli bramka jest realnie wpięta;
test kontroli negatywnej w suicie.

---

## A2. Właściciel i termin jako WYMAGANE metadane, parsowane przez bramkę

Dziś: **0 z 327 wpisów wskazuje właściciela i 0 podaje termin naprawy** (§0.4 - zmierzone,
nie oszacowane). Dopóki tak jest, „naprawcie to" nie ma adresata i zalecenie umiera piąty raz.

Zadanie: **wprowadź jedną, maszynowo czytelną adnotację** i wymuś ją bramką z A1 - dla
**NOWYCH** wpisów, nie wstecz. Kształt zostawiam Ci do rozstrzygnięcia (komentarz nad
wpisem, sufiks w tytule, wpis w baseline'u obok liczby), ale musi spełniać cztery warunki:

1. **parsowalna bez AST** - grep/regex wystarczy, bo bramka ma być tania i biegać w `verify`;
2. **właściciel** - identyfikator zespołu albo obszaru (nie imię, bo ludzie się zmieniają
   szybciej niż moduły);
3. **termin** - data, po której bramka **eskaluje** (patrz punkt 4);
4. **klasa defektu** - z listy zamkniętej. **Nie wymyślaj jej**: taksonomia już istnieje
   i jest sprawdzona na 36 defektach jednego modułu, w
   `docs/WDROZENIE_USTAWIENIA_INTEGRACJE_MODUL_19_2026-08-22.md` §3.1-3.7. Siedem klas,
   z liczbami z tamtego wdrożenia: `awaria odczytu udaje pustkę albo stan domyślny` (12),
   `cicha utrata danych i cisza po odmowie` (9), `reguły tekstu, sluga i wyszukiwania` (7),
   `komunikaty i i18n` (4), `rola i dostęp` (3), `izolacja najemcy i zakres operacji` (2),
   `kontrakt wyniku` (1). Jeśli któryś z 327 wpisów nie mieści się w żadnej - dopisz klasę
   i **powiedz w PR, że lista została rozszerzona**, bo cicho rosnąca lista klas to ten sam
   defekt co cicho rosnący rejestr. (Kandydaci, których tamta lista nie ma, a rejestr ma:
   `a11y` i `schemat SQL` - ale to moja propozycja, nie ustalenie audytu.)

   Klasa jest tym, co pozwala naprawiać wpisy **hurtem** zamiast po jednym. To nie teoria:
   §3.1 tamtego dokumentu kończy się zdaniem _„W rodzinie organizacji ta klasa występuje
   **cztery** razy; zgłoszone są dwa wystąpienia (oba na karcie), bo dwóch odczytów listy
   zadanie nie obejmowało - nagłówek pliku testowego mówi to wprost, żeby naprawa objęła
   wszystkie cztery."_ Klasa widzi wystąpienia, których zlecenie nie objęło. Lista pojedynczych
   wpisów ich nie widzi.

**Eskalacja terminu - rozstrzygnij i uzasadnij w PR.** Dwie opcje, obie mają wadę:
(a) bramka oblewa po terminie - twarde, ale zamienia rejestr w generator czerwieni, której
nikt nie zamawiał w tym tygodniu; (b) bramka **raportuje** przeterminowane wpisy w logu
i oblewa dopiero, gdy ich liczba **rośnie** - miękkie, ale zgodne z semantyką zapadki
z A1 punkt 4. **Rekomendacja: (b)**, bo to ten sam wzorzec, który w tym repozytorium już
działa na trzech innych długach. Jeśli wybierzesz (a), podaj, jak unikasz zablokowania
niezwiązanych PR-ów.

**Kryterium odbioru:** nowy wpis `it.fails` bez kompletnej adnotacji **oblewa** bramkę
z A1; wpis z adnotacją przechodzi; raport bramki wypisuje listę wpisów po terminie
z właścicielem i klasą; 327 istniejących wpisów **nie wymaga adnotacji wstecz** (to byłaby
praca na dwa dni bez żadnej naprawy defektu).

---

## A3. Odblokować samoczyszczenie - trzy miejsca, w których rejestr jest niewidzący

Właściwość z §0.2 jest realna i już raz zadziałała, ale ma trzy martwe pola (§0.2 punkty
1-3). Dopóki istnieją, część rejestru opisuje defekty, których być może już nie ma - i nikt
się o tym nie dowie.

Zadanie: **zmierz i podaj liczbę** - ile z 327 wpisów siedzi w plikach, które w pełnym
przebiegu **nie dochodzą do swojej asercji**:

1. w ośmiu czerwonych plikach (`docs/PROMPT_OSIEM_CZERWIENI.md` opisuje przyczyny; jeden
   z nich, `src/routes/__tests__/adminSettingsRoutes.test.tsx`, ma 1 wpis - policz
   pozostałe siedem);
2. w dwóch plikach pomijających się same z braku sekretów (rozdz. 9.2: te 50 testów
   **nie biegnie także na CI**);
3. pod bezwarunkowym `describe.skip` w `rootShellRender.test.tsx:91`.

**Nie naprawiaj tych ośmiu plików w tym PR-ze** - mają własne zlecenie. Zadanie tutaj to
**pomiar i widoczność**: bramka z A1 ma w raporcie osobną sekcję „wpisy, które nie mogą się
wykonać", bo taki wpis jest gorszy niż brak wpisu - daje fałszywe poczucie, że defekt jest
pilnowany.

**Kryterium odbioru:** liczba podana w PR, rozbita na trzy przyczyny; sekcja w raporcie
bramki; jeśli liczba wyjdzie zero - też dobrze, ale musi wyjść z pomiaru, nie z założenia.

---

# CZĘŚĆ B - SPŁATA PIERWSZEJ KOHORTY

## B1. Klasa, nie lista: napraw jedną konwencją to, co powtarza się wielokrotnie

Klasą dominującą jest **„awaria odczytu udaje pustkę albo stan domyślny"** - nazwana
i rozpisana w `docs/WDROZENIE_USTAWIENIA_INTEGRACJE_MODUL_19_2026-08-22.md` §3.1, gdzie
w jednym module ma **12 wystąpień** (10 zgłoszonych).

Zmierzyłem, ile ma w CAŁYM rejestrze, i liczba jest lepszym argumentem niż tamten opis:
**24 wpisy w czterech modułach** - 15 w module 20, 4 w 15, 4 w 16, 1 w 19 - licząc po
wąskiej sygnaturze („awaria/odmowa/błąd odczytu jest nieodróżnialna od pustki, stanu
domyślnego albo ciszy"). Przy szerszej sygnaturze, dopuszczającej „brak danych" i „milczy",
wychodzi **31 wpisów w siedmiu modułach**. Obie liczby są DOLNYM oszacowaniem, bo liczą
tylko po 198 tytułach czytelnych regexem (§0.4), a nie po 327 wpisach.

**Dwadzieścia cztery.** Dokładnie tyle, ile liczył CAŁY rejestr, gdy wydanie 4 zapisało
„zamienić 24 `it.fails` na naprawy". Jedna klasa defektu jest dziś tak duża, jak cały dług
w chwili, w której zalecenie powstało pierwszy raz.

Zadanie: **wybierz JEDNĄ klasę i zamknij ją konwencją**, nie dwudziestoma czterema
poprawkami. Rekomendacja: właśnie ta, bo (a) jest największa i zmierzona, (b) jej skutek
jest zawsze cichy - użytkownik widzi „nic tu nie ma" zamiast „nie udało się wczytać", więc
nie ponawia i nie zgłasza, (c) konwencja jest tania: jeden typ wyniku, który **nie pozwala**
pomylić pustki z awarią, plus bramka statyczna na jego użycie. Piętnaście z tych wpisów jest
w jednym module, więc konwencja ma gdzie się opłacić od pierwszego dnia.

Zakres do wyboru, jeśli tamta klasa okaże się za duża na jeden PR: **27 wpisów modułu 08
(SEO, feedy, dane strukturalne)** - powierzchnia jest zamknięta i ma **96,92% pokrycia linii
oraz 95,89% funkcji** (rozdz. 2 audytu), więc naprawy nie trzeba poprzedzać pisaniem testów,
a skutek defektu jest indeksowany przez wyszukiwarki, czyli **przeżywa własną naprawę o cykl
indeksowania**.

**Kryterium odbioru:** licznik rejestru spada z 327 do **≤ 300**, i to spadkiem
**dowiedzionym**: dla każdego zdjętego wpisu w PR jest commit naprawiający produkcję
i zamiana `it.fails` → `it` w tym samym commicie; baseline z A1 zaktualizowany; **żaden wpis
nie zniknął przez `it.skip` ani przez usunięcie testu** (bramka z A1 to wykaże, ale napisz
to też w raporcie).

## B2. Raport stanu rejestru jednym poleceniem

Dziś stan rejestru mierzy się grepem, a liczby w audycie (327 / 186) powstają za każdym
wydaniem od nowa. To jest ta sama klasa problemu, która w wydaniu 9 spowodowała
najpoważniejszą pomyłkę serii: **liczba, której nikt nie weryfikuje skryptem, starzeje się
w ciszy** (rozdz. 8.5, pozycja 8 - cała tabela funkcjonalności opisywała jedno wydanie,
a niosła liczby poprzedniego).

Zadanie: `bun run report:it-fails` (albo tryb `--report` bramki z A1) wypisujący:
liczbę wpisów i plików, rozkład per moduł (wg `docs/` mapowania), rozkład per klasa
defektu (z A2), listę wpisów po terminie, listę wpisów, które nie mogą się wykonać (A3),
oraz **deltę wobec baseline'u**. Wynik ma być czytelny w logu CI bez otwierania artefaktu.

**Kryterium odbioru:** polecenie działa, jego wyjście jest w PR, a liczby zgadzają się
z tymi z §0.1 i §0.5 tego zlecenia **albo rozbieżność jest zgłoszona** (patrz ZASADY).

---

# JAK MIERZYĆ

Trzy polecenia, którymi powstały wszystkie liczby tego zlecenia - odtwórz je, zanim ruszysz
którykolwiek punkt:

```bash
# liczba wpisów i plików
grep -rho 'it\.fails(' src/ | wc -l          # 327
grep -rl  'it\.fails(' src/ | wc -l          # 186

# wiek każdego wpisu (git blame po linii)
grep -rn "it\.fails(" src/ | cut -d: -f1,2 | while IFS=: read -r f l; do
  git blame -L "$l,$l" --porcelain -- "$f" | awk '/^author-time /{print $2}'
done

# rozkład per plik
grep -rn "it\.fails(" src/ | cut -d: -f1 | sort | uniq -c | sort -rn

# metadane rozliczeniowe: właściciel i termin (oczekiwane: 0 i 0)
grep -rhn 'it\.fails(' src/ | grep -cE '@[a-z0-9_.-]+|owner:|właściciel:|zespół:|TODO\('
grep -rhn 'it\.fails(' src/ | grep -ciE '[0-9]{4}-[0-9]{2}-[0-9]{2}|termin|deadline'
```

Rozkład per moduł z §0.5 **nie** powstaje grepem po nazwach katalogów - powstaje kanonicznym
mapowaniem ścieżek na moduły (audyt, rozdz. 9 - załącznik z wzorcami ścieżek per moduł). Jeśli policzysz go
inaczej, dostaniesz inne liczby i będą one Twoje, nie audytu; kontrolą jest suma **327**.

**Uwaga na pułapkę pomiaru, w którą audyt sam wpadł:** `grep -o 'it\.fails'` **bez nawiasu**
daje **593 trafienia w 228 plikach**, bo liczy też wzmianki w komentarzach i w tym
dokumencie. Właściwy licznik to `it\.fails(` - **327 w 186 plikach**. Bramka z A1 musi
maskować komentarze (A1 punkt 2), inaczej powtórzy ten błąd.

**Stan wyjściowy CI:** `check:ci-gates` jest **czerwona** (ratchet tekstu jednojęzycznego,
`src/routes/admin.analytics.index.tsx:387`) - **to nie jest twoja czerwień**. Suita jest
czerwona w **ośmiu plikach (272 testy)** - to kontekst punktu A3, nie Twoje zadanie.

---

# ZASADY

**Pomiar przed i po.** Każdy punkt ma dzisiejszą liczbę. Odtwórz ją, zanim ruszysz punkt.
Jeśli się nie zgadza - **zatrzymaj się i zgłoś rozbieżność**, nie „popraw pod nią kodu".
Liczba z audytu może być nieaktualna; wtedy wartościowsze od naprawy jest ustalenie, co ją
zmieniło.

**Bramki.** Progi i baseline'y wolno **wyłącznie zacieśniać**. Nowa bramka ma zamrożony
baseline w kodzie, nie w zmiennej środowiskowej; ma kontrolę negatywną; jest wpięta
w `ci.yml` bez `continue-on-error`.

**Testy.** **Nie wykluczaj plików z pomiaru** - żadnego `exclude`, `all: true` zostaje.
**Nie zmieniaj zachowania produkcyjnego, żeby test przeszedł** - a jeśli naprawiasz defekt,
to naprawiasz go w produkcji i **zdejmujesz przypięcie**, nie odwrotnie. **Nie regenerujesz
snapshotu autoryzacji, żeby zgasić czerwień.**

**Dane i bezpieczeństwo.** Żaden test nie wychodzi do sieci i nie zawiera prawdziwego
sekretu. RODO: żadnych prawdziwych danych osobowych w fixture'ach; jeśli kod hashuje IP,
test sprawdza, że wynik **nie** zawiera oryginału. **`tenant_id` jest warunkiem, nie
ozdobą** - a rejestr ma dziś **pięć** wpisów dotykających izolacji najemcy (m.in. „zapis bez
tenanta kończy się CISZĄ", „klauzule właścicielskie `qa_sessions` nie wiążą najemcy",
„polityka `comments_own_select` powinna też być zawężona do najemcy"), więc jeśli
którykolwiek naprawiasz, dowód idzie testem na zakres najemcy, nie samą naprawą.

**Kod.** Bez `any` i `as any`. Zamiast „—" stosuj „-". i18n: PL i EN. Atomic design: nowe
komponenty w istniejącą hierarchię.

---

# CZEGO NIE ROBIĆ - pięć pułapek

1. **`it.fails` → `it.skip`: NIGDY.** Zabija samoczyszczenie (§0.2, §0.6 punkt 1). Jedna taka
   zamiana w PR-ze dyskwalifikuje całe zlecenie.
2. **Nie dopisuj adnotacji z A2 do 327 istniejących wpisów.** To dwa dni pracy bez naprawy
   ani jednego defektu. Adnotacja obowiązuje **nowe** wpisy - i to jest cały jej sens:
   podnosi cenę zapisania, nie cenę utrzymania.
3. **Nie rób globalnego licznika w baseline'ie** (A1 punkt 3). Suma pozwala zamienić pięć
   wpisów na pięć innych i nazwać to postępem.
4. **Nie naprawiaj ośmiu czerwonych plików w tym PR-ze** (A3). Mają własne zlecenie;
   tutaj potrzebna jest tylko ich liczba wpisów.
5. **Nie licz sukcesu spadkiem licznika.** 327 → 300 przez usunięcie wpisów to regres
   udający postęp. Liczy się **liczba commitów naprawiających produkcję**, a spadek licznika
   jest ich skutkiem, nie celem.

---

# DEFINICJA UKOŃCZENIA

1. **`check:it-fails-ratchet` istnieje**, ma zamrożony baseline **327 wpisów w 186 plikach**,
   maskuje komentarze, liczy cztery formy wywołania, jest wpięty w `ci.yml` bez
   `continue-on-error` i ma **test kontroli negatywnej** (A1).
2. **Bramka jest czerwona po dorzuceniu jednego `it.fails`** i zielona po jego zdjęciu -
   oba przebiegi pokazane w PR (A1).
3. **Nowy wpis bez adnotacji właściciel + termin + klasa oblewa bramkę**; istniejące 327
   wpisów nie wymaga adnotacji wstecz; sposób eskalacji terminu rozstrzygnięty
   i uzasadniony w PR (A2).
4. **Podana liczba wpisów, które nie mogą się wykonać**, rozbita na trzy przyczyny, i osobna
   sekcja w raporcie bramki (A3).
5. **Licznik rejestru z 327 na ≤ 300**, i dla każdego zdjętego wpisu w PR jest commit
   naprawiający produkcję plus zamiana `it.fails` → `it` w tym samym commicie (B1).
6. **Jedna klasa defektu zamknięta konwencją**, nie serią poprawek jednostkowych - z opisem,
   co ta konwencja uniemożliwia na przyszłość (B1).
7. **`bun run report:it-fails` działa** i jego wyjście jest w PR; liczby zgodne z §0.1
   i §0.5 albo rozbieżność zgłoszona (B2).
8. **Zero zamian `it.fails` na `it.skip`** i zero wpisów usuniętych bez naprawy - oświadczone
   w raporcie i sprawdzalne diffem.
9. **`bun run check:*` w komplecie zielone poza `check:ci-gates`**, która była czerwona przed
   Twoją pracą; suita czerwona w dokładnie ośmiu plikach, tych samych co przed startem.

**Na koniec zdaj raport:** co zmierzyłeś przed i po (liczba za liczbą, tą samą metodą), ile
defektów naprawiłeś i w jakiej klasie, czego świadomie nie zrobiłeś, oraz - osobno -
**które liczby z tego zlecenia okazały się nieaktualne**. Ta ostatnia lista jest dla audytu
najcenniejsza: wydanie 9 znalazło osiem własnych pomyłek i wszystkie przez sprawdzenie
liczby, nie przez jej przepisanie.

**I jedna prośba ponad kryteria odbioru.** Jeśli w trakcie pracy dojdziesz do wniosku, że
zapadka na rejestr jest złym pomysłem - że lepszy jest limit twardy, kwarantanna, osobny
plik rejestru albo cokolwiek innego - **napisz to i uzasadnij liczbą**. Cztery poprzednie
wydania powtarzały to samo zalecenie i cztery razy nic z niego nie wyszło; piąte powtórzenie
bez zmiany mechanizmu byłoby dokładnie tym samym błędem, tylko z lepszym opisem.
