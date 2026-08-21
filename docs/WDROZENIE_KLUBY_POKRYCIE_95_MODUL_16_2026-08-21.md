# Kluby dyskusyjne (MODUŁ 16): z 0–8% na 95%+ na czterech powierzchniach, 12 defektów i zapadka progów (2026-08-21)

Zlecenie: **95% linii i 93% gałęzi na każdej z czterech powierzchni** klubów dyskusyjnych,
dodatkowo instrukcje ≥ 95% i funkcje ≥ 93% — ten drugi warunek jest po to, żeby „95% linii”
nie dało się ugrać renderem bez interakcji. Cel zastąpił wcześniejszą regułę „panel admina
90–95%”.

**Wynik: cztery powierzchnie osiągnięte, warstwa reguł nie.** Poniżej zmierzone liczby,
komendy, którymi je odtworzyć, dwanaście defektów produkcyjnych zgłoszonych bez ruszania
produkcji oraz jawna lista tego, czego **nie** dowieziono (rozdział 6) — bo procent ugrany
wykluczeniem pliku z pomiaru jest bezwartościowy.

| Powierzchnia                           | Linie: przed → po | Gałęzie: po | Cel       |
| -------------------------------------- | ----------------- | ----------- | --------- |
| Trasy publiczne klubu (20 plików)      | **0,0% → 100%**   | 98,41%      | ✅        |
| UI: atomy/molekuły/organizmy (103)     | **5,0% → 99,90%** | 99,34%      | ✅        |
| Panel admina: komponenty (57)          | **0,0% → 100%**   | 97,96%      | ✅        |
| Panel admina: trasy (6)                | **0,0% → 100%**   | 96,82%      | ✅        |
| Zgłoszenia członkowskie (`club.apply`) | **18,6% → 100%**  | 97,50%      | ✅        |
| Warstwa reguł `src/lib/clubs/**` (95)  | 93,95%            | 90,10%      | ❌ (§6.1) |

---

## 1. Stan wyjściowy: liczby z audytu

Punkt odniesienia: `docs/AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md`, rozdział
„MODUŁ 16”. Moduł stał na **17,56% linii / 13,32% funkcji**, a w obrębie klubów rozkład był
skrajnie nierówny:

| Funkcjonalność (audyt §MODUŁ 16)       | Plików | Linie bez pokrycia | Linie | Funkcje |
| -------------------------------------- | -----: | -----------------: | ----: | ------: |
| KLUBY: panel admina                    |     26 |              1 242 |  0,0% |   0/557 |
| KLUBY: trasy publiczne klubu           |     20 |                707 |  0,0% |   0/261 |
| KLUBY: UI (atomy/molekuły/organizmy)   |    103 |              2 241 |  5,0% |  42/945 |
| KLUBY: zgłoszenia członkowskie (apply) |      5 |                183 | 18,6% |    9/61 |

Reguły w `src/lib/clubs/**` były wtedy najmocniejszą warstwą modułu (51 plików testowych),
więc cała zaległość siedziała w **prezentacji, trasach i panelu**.

### 1.1 Dlaczego dopisywanie testów renderujących tego nie dowozi

Z 1 719 niewywołanych funkcji modułu **1 398 to funkcje anonimowe** — inline’owe
`onChange={(e) => …}`, `onClick={() => …}`, `map((x) => …)` wewnątrz JSX-a. Aby v8 zaliczył
taką funkcję, test musi wywołać **dokładnie ten** handler; przy 2 241 niepokrytych liniach UI
test renderujący dochodzi do ~60–70% i staje, bo każdy kolejny punkt procentowy kosztuje
osobny `fireEvent`.

Dlatego dźwignią było **wyprowadzenie logiki z JSX-a**, nie liczba testów: każdy handler,
który robi cokolwiek poza `setState(value)`, przeniesiony do nazwanej czystej funkcji
w `src/lib/clubs/…` i wywołany z jednolinijkowego handlera. Handler zostaje trywialny, reguła
dostaje tabelę przypadków (`it.each` z wartością, `undefined`, `null`, falsy-ale-poprawną
(`0`/`""`) i wartością poza enumem), licznik gałęzi rośnie bez klikania.

---

## 2. Refaktor: 28 czystych modułów reguł wyprowadzonych z JSX-a

Bez Reacta, bez i18n, bez klienta Supabase. Funkcje zwracają **klucze i18n albo deskryptory**,
nigdy gotowy tekst — dzięki temu ten sam test dowodzi zachowania w PL i EN, a bramki
`check:i18n-*` nie musiały dostać ani jednego nowego klucza (rozdział 5).

| Moduł reguł                 | Co pilnuje                                                                       |
| --------------------------- | -------------------------------------------------------------------------------- |
| `hubCatalog.ts`             | kubełki huba, statystyki „moje kluby”, próg 2 znaków szukania, „pokaż więcej”    |
| `aboutView.ts`              | słownik pojęć strony „o klubie”, akcja wejścia, widoczność zgody na regulamin    |
| `specializationPage.ts`     | filary specjalizacji, kluby pokrewne, pustka, przejście do zgłoszenia            |
| `memberRoster.ts`           | kto widzi i kto zarządza składem, stronicowanie, zapytanie listy                 |
| `newThreadForm.ts`          | granice tytułu i treści wątku, blokada wysyłki, ładunek RPC                      |
| `threadComposer.ts`         | licznik odpowiedzi, próg pokazania licznika, intencja skrótu klawiszowego        |
| `threadPageView.ts`         | etap wątku, uprawnienia, dostępne sortowania, rozwiązanie wątku                  |
| `workspaceForms.ts`         | konwersje daty lokalnej ↔ ISO, tryb „cały dzień”, pola formularzy warsztatu      |
| `activityStrip.ts`          | okno aktywności, wysokość słupka, tydzień odniesienia                            |
| `insightChart.ts`           | serie wykresu, procent słupka, etykieta zakresu                                  |
| `expertiseDraft.ts`         | kompletność i przełączanie szkicu specjalizacji                                  |
| `adminClubEditor.ts`        | zakładki, wersja robocza, wykrycie zmiany, blokada zapisu, ładunek, filtry listy |
| `adminClubFormFields.ts`    | pola tekstowe karty ogólnej, ostrzeżenie o zmianie sluga                         |
| `adminClubAccessPreview.ts` | zdanie podglądu dostępu i łatka minimalnego tieru                                |
| `adminClubCreateForm.ts`    | slug efektywny, konflikt sluga, komunikaty, minimalne długości                   |
| `adminClubsTable.ts`        | statusy i widoczność w tabeli, ostatnia aktywność, adres publiczny               |
| `adminClubStatsView.ts`     | progi zdrowia klubu, tony wskaźników, karty składu                               |
| `adminClubGroupForm.ts`     | daty grupy, nadpisania pól, blokada i ładunek zapisu                             |
| `adminClubGroupsBoard.ts`   | status i widoczność wiersza grupy, tryb tablicy, zmiana kolejności               |
| `adminClubInvites.ts`       | role zapraszalne, prawo do zaproszenia, ładunek i klucz błędu                    |
| `adminClubPermissions.ts`   | macierz zdolności, podglad „jako użytkownik”, wiersze i stan podglądu            |
| `adminMemberRoster.ts`      | role i statusy składu, filtry, stronicowanie, akcje kadencji                     |
| `adminThreadsBoard.ts`      | filtry wątków, minimalne długości, widoczne identyfikatory, akcje masowe         |
| `adminModerationDesk.ts`    | okna logu moderacji, liczniki, minimalne uzasadnienie edycji moderatora          |
| `adminApplicationsInbox.ts` | statusy zgłoszeń, tony, dostępne akcje, filtry skrzynki                          |
| `adminSegment.ts`           | reguła segmentu kampanii, kompletność szkicu, pola i kluby powiązane             |
| `adminTaxonomyCatalog.ts`   | kolejność i kompletność etykiet słowników, blokada usunięcia                     |
| `adminElementsCatalog.ts`   | katalog elementów panelu: karty słowników, źródła kodu, sekcje galerii           |

Do tego **37 nowych molekuł i organizmów** w panelu klubów: zakładki panelu były wcześniej
plikami po 400–900 linii JSX-a, w których jedna zakładka mieszała wiersz tabeli, dialog,
walidację i zapis. Rozbicie trzyma reguły atomic design z repo — `atoms/` bez I/O i bez stanu
serwera, `molecules/` = kompozycja atomów z jedną odpowiedzialnością, `organisms/` = sklejenie
z danymi. Katalog `src/components/admin/clubs/molecules/` urósł z 1 pliku do 37.

---

## 3. Dwanaście defektów produkcyjnych: zgłoszone jako `it.fails`, produkcji nie ruszono

Zasada zadania: _nie zmieniasz zachowania produkcyjnego, żeby test przeszedł_. Test odsłaniający
prawdziwy błąd jest napisany, oznaczony `it.fails` i opisany. **Wszystkie 12 „expected fail”
w całej suicie repo to te przypadki** — nie ma ani jednego `it.skip` ani `it.todo`.

| #   | Test (`it.fails`)                    | Co jest zepsute w produkcji                                                                           |
| --- | ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| 1   | `clubMembersRoute.test.tsx:455`      | członek bez stanowiska **i** bez firmy dostaje pusty akapit — warunek `!== null` na kolumnie NOT NULL |
| 2   | `clubThreadRoute.test.tsx:877`       | `?reply=1` z ręcznie wklejonego adresu nie dociera do widoku — martwy głęboki link                    |
| 3   | `clubSpotlightScreen.test.tsx:335`   | awaria RPC archiwum wygląda identycznie jak puste archiwum                                            |
| 4   | `clubEventForm.test.tsx:633`         | wyjście z trybu „cały dzień” gubi godzinę wydarzenia                                                  |
| 5   | `clubHubOrganisms.test.tsx:1357`     | szyna sekcji przeskakuje z `<h1>` na `<h3>` — kolejność nagłówków dla czytnika ekranu                 |
| 6   | `clubDossierRow.test.tsx:216`        | rodzaj wątku czytany z **prototypu** obiektu (`constructor` staje się rodzajem)                       |
| 7   | `ClubApplicationsInbox.test.tsx:306` | awaria RPC listy zgłoszeń wygląda jak pusta skrzynka                                                  |
| 8   | `ClubGeneralTab.test.tsx:229`        | ostrzeżenie o zmianie sluga używa klucza podpowiedzi pod polem — komunikat nic nie dodaje             |
| 9   | `ClubCreateDialog.test.tsx:285`      | otwarcie dialogu nie czyści wybranego obszaru tematycznego (brak `setTopic` w resecie)                |
| 10  | `ClubElementsCatalog.test.tsx:399`   | trafienie w słowniku ogłasza pustkę w całym katalogu                                                  |
| 11  | `ClubElementsCatalog.test.tsx:454`   | karta słownika bez ani jednego widocznego wiersza nadal renderuje pustą ramkę                         |
| 12  | `adminMemberRoster.test.ts:286`      | kadencja z niepoprawną datą rzuca wyjątkiem, zamiast dać „brak akcji”                                 |

Dodatkowo dwie gałęzie **udokumentowane jako nieosiągalne** (nie defekty): `club.join.$token.tsx:96`
i `return null` w `MemberActions` w `ClubAccessGate` — w obu przypadkach warunek jest już
wykluczony przez typ kolumny RPC albo przez warunek renderu rodzica.

---

## 4. Wynik: przed → po (własny pomiar)

### 4.1 Cztery powierzchnie — komendy 2–6 definicji ukończenia

Każda liczba pochodzi z komendy podanej w zleceniu, uruchomionej na tym HEAD (2026-08-21).
Reporter tekstowy pokazuje w tabelach tylko pliki z jakąkolwiek luką, więc brak pliku
w wykazie = 100% we wszystkich czterech metrykach.

| #   | Powierzchnia                  | Instrukcje         | Gałęzie                | Funkcje          | Linie                  |
| --- | ----------------------------- | ------------------ | ---------------------- | ---------------- | ---------------------- |
| 2   | trasy publiczne klubu (20)    | 99,72% (716/718)   | **98,41%** (558/567)   | 100% (247/247)   | **100%** (678/678)     |
| 3   | UI publiczne (103)            | 99,75% (2446/2452) | **99,34%** (2721/2739) | 99,89% (934/935) | **99,90%** (2191/2193) |
| 4   | panel admina: komponenty (57) | 99,30% (1138/1146) | **97,96%** (578/590)   | 100% (508/508)   | **100%** (1088/1088)   |
| 5   | panel admina: trasy (6)       | 100% (118/118)     | **96,82%** (61/63)     | 100% (34/34)     | **100%** (114/114)     |
| 6   | `club.apply.tsx`              | 100% (137/137)     | **97,50%** (117/120)   | 100% (48/48)     | **100%** (125/125)     |

Rozbicie UI publicznego: atomy 100 / 99,39 / 100 / 100 · molekuły 99,67 / 99,41 / 100 / 100 ·
organizmy 99,76 / 99,27 / 99,79 / 99,81. Rozbicie panelu: atomy i molekuły **100% we wszystkich
czterech metrykach** (3 + 37 plików), organizmy 99,13 / 97,05 / 100 / 100.

### 4.2 Moduł razem (jeden przebieg pełnej suity z pokryciem)

| Zakres                        | Instrukcje | Gałęzie | Funkcje |  Linie |
| ----------------------------- | ---------: | ------: | ------: | -----: |
| kluby razem (281 plików)      |     96,74% |  94,93% |  97,76% | 97,44% |
| w tym `src/lib/clubs/**` (95) |     93,07% |  90,10% |  94,70% | 93,95% |
| całe `src/` (repo)            |     60,94% |  55,16% |  57,11% | 61,98% |

Mianownik modułu urósł w trakcie pracy (28 nowych modułów reguł + 37 nowych komponentów),
więc „97,44% linii” liczy się **na większej ilości kodu** niż 17,56% z audytu — logika
wyprowadzona z JSX-a nie zniknęła, tylko przestała być anonimowa.

### 4.3 Testy

| Katalog                       | Plików testowych przed |     po |
| ----------------------------- | ---------------------: | -----: |
| `src/lib/clubs/`              |                     53 | **81** |
| `src/components/clubs/`       |                      9 | **55** |
| `src/components/admin/clubs/` |                      3 | **39** |
| `src/routes/__tests__/`       |                     32 | **44** |

Razem **+122 pliki testowe**. Przebieg obejmujący te cztery katalogi: **219 plików,
6 916 testów zielonych, 12 „expected fail”** (rozdział 3). Cała suita repo: **1 356 plików
zielonych, 26 607 testów zielonych**, zero błędów progów (jedyny czerwony plik nie należy
do modułu — §6.5).

---

## 5. Dowód, że to nie „render bez asercji”

- **Funkcje ≥ 93% na każdej powierzchni**, a na czterech z pięciu **100%** (247/247, 508/508,
  34/34, 48/48). Pokrycie funkcji anonimowych handlerów wymaga ich wywołania, więc ta kolumna
  jest twardym dowodem interakcji, nie renderu.
- **Zero testów bez asercji** i żadnych pętli renderujących listę komponentów po to, żeby
  podbić procent — każdy plik ma więcej `expect(` niż `it(`.
- **Determinizm**: żadnego `Date.now()`, `new Date()` bez argumentu, `Math.random()` ani
  `setTimeout` w nowych testach; czas pochodzi z `CLUB_BASE_ISO` i `clubIsoOffset()`,
  asynchroniczność z `waitFor`.
- **Zero `any`, zero `as unknown as`, zero `@ts-expect-error`** w nowym kodzie. Tam, gdzie
  atrapa nie dawała się napisać zgodnie z typem, poprawiono **typ**, nie test: `AdminClubDetailRow`
  jest teraz owinięty w `NullableCols` dla dziewięciu kolumn, które w `public.clubs` są
  nullowalne (generator typów Supabase spłaszcza `RETURNS TABLE` do non-null).
- **i18n bez długu**: reguły zwracają klucze, nie tekst, więc powstało **zero nowych kluczy**
  i żaden plik słownika nie był ruszany — cztery bramki i18n przechodzą bez wyjątków.
  Testy asercjonują na kluczach przez `reactI18nextStub()`.
- Bramka autorytetu `adminRouteAuthority.gate.test.ts` została **rozszerzona**, nie zdublowana:
  sześć tras panelu klubów podlega teraz tym samym ośmiu regułom (każda trasa sama sprawdza
  `isAdmin`, odmawia treści zamiast ukrywać przyciski, odmowa idzie kluczem i18n, `useAdminClub`
  dostaje `undefined` bez uprawnień, powłoki tras nie niosą mutacji, pokrycie pgTAP nadal istnieje).

---

## 6. Nie osiągnięto 95% w:

### 6.1 `src/lib/clubs/**` — 93,95% linii, 90,10% gałęzi (cel: 95/93)

Warstwa reguł jako **całość** jest pod celem, mimo że wszystkie 28 modułów wyprowadzonych w tej
pracy stoi na 100%. Powód jest strukturalny: ten katalog niesie także hooki React Query, klienty
RPC i moduły serwerowe, których zadanie nie dotyczyło. Pliki, które ciągną wynik w dół:

| Plik                        | Instr. |   Gał. |  Linie | Co to jest                             |
| --------------------------- | -----: | -----: | -----: | -------------------------------------- |
| `clubReview.functions.ts`   |  7,57% |     0% |  9,09% | funkcja serwerowa (recenzja/moderacja) |
| `clubRpc.functions.ts`      | 21,42% |     0% | 25,00% | funkcja serwerowa (wywołania RPC)      |
| `clubTaxonomy.functions.ts` | 30,43% |     0% | 36,84% | funkcja serwerowa (taksonomie)         |
| `coverApi.ts`               | 43,33% | 45,00% | 46,15% | klient uploadu okładki                 |
| `clubModeration.ts`         | 60,37% | 75,00% | 60,37% | klient moderacji                       |
| `useClubAdmin.ts`           | 67,92% | 48,48% | 67,92% | hook panelu (React Query)              |
| `useClubThreadsData.ts`     | 72,00% | 75,86% | 72,00% | hook listy wątków                      |
| `postTypes.ts`              | 79,31% | 64,58% | 91,48% | słownik rodzajów wpisów                |
| `visibilityMatrix.ts`       | 80,00% | 16,66% | 84,61% | macierz widoczności                    |
| `clubLinkPreview.ts`        | 80,00% | 80,00% |   100% | podgląd linku                          |
| `clubMatch.ts`              | 86,00% | 78,37% | 92,30% | dobór klubów                           |
| `clubReactions.ts`          | 88,23% | 61,11% | 87,87% | reakcje                                |

Podniesienie tej warstwy to osobna praca (hooki wymagają atrap React Query, funkcje serwerowe —
harnessu `createServerFn`), a nie regresja tej. Próg w `vitest.config.ts` stoi na **92/93/92/89**,
czyli 1–2 pp pod pomiarem, więc zapadka pilnuje stanu faktycznego zamiast udawać cel.

### 6.2 Trzy pliki UI poniżej 93% gałęzi — gałęzie nieosiągalne

| Plik / linie                     | Gałęzie | Dlaczego niewywoływalne                                                                                                                     |
| -------------------------------- | ------: | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `ClubAuthorAvatar.tsx:23-24`     |  88,23% | prawe ramiona `?? ""` po `.split(/\s+/).filter(Boolean)` — niepusty człon zawsze ma indeks 0                                                |
| `ClubCoverEditor.tsx:37,66`      |  87,50% | dwa `if (busy) return;`, a oba przyciski niosą `disabled={busy}` — React połyka zdarzenia myszy na wyszarzonym elemencie formularza         |
| `ClubInvitationInbox.tsx:70,116` |  87,50% | `inv.message` puste vs `null` (kolumna NOT NULL) i `if (declining !== null)` w dialogu, który otwiera się wyłącznie z wybranym zaproszeniem |

Do tego jedna funkcja w `ClubElementsGallery.tsx:225`: `onChange={() => undefined}` przekazany
do **wyłączonej** kontrolki w galerii elementów — handler nie ma jak się wykonać (stąd 90% funkcji
w tym pliku). Wszystkie te miejsca są opisane w nagłówkach swoich plików testowych; żadne nie
zostało „naprawione” zmianą produkcji tylko po to, żeby dobić procent.

### 6.3 Pojedyncze gałęzie w trasach — typy kolumn RPC i obrony przed wyścigiem

`club.$clubSlug.members.tsx:281`, `club.$clubSlug.new.tsx:280,399`, `club.$clubSlug.t.$threadSlug.tsx:219`,
`club.index.tsx:118`, `club.join.$token.tsx:96`, `club.apply.tsx:171,414`,
`admin.community.clubs.$clubId.tsx:208-216` (fałszywe ramiona `setGeneral`/`setAccess`, gdzie
`prev === null` nie zachodzi, dopóki zakładka jest wyrenderowana). Razem dziewięć gałęzi na 567
w trasach publicznych i dwie na 63 w trasach panelu.

### 6.4 Zakres świadomie nietknięty

Zgodnie ze zleceniem **nie ruszano**: `lazyWidgets.test.ts` (defekt modułu 11) oraz dziesięciu
czerwonych progów w `src/lib/billing/*` i `src/lib/retention/queries.ts`. Nie ruszano też
`package.json` ani `package-lock.json` — środowisko stawiane jest instalacją opisaną w rozdziale 9.

### 6.5 Jeden czerwony plik POZA modułem: `adminImportWordpressRoute.test.tsx`

Plik nie należy do klubów, nie był modyfikowany na tej gałęzi (ostatnia zmiana `6f2c6f9`,
2026-08-19) i **flakuje pod obciążeniem**: w trzech przebiegach zbiorczych padły **trzy różne**
przypadki (`angielskie warianty pozostałych stanów zadania`, `trwający podgląd blokuje przycisk
i pokazuje kręciołek`, `trwające anulowanie blokuje przycisk`), za każdym razem na `waitFor`
sprawdzającym `toBeDisabled()`/`not.toBeDisabled()` na przycisku w trakcie mutacji. W izolacji
plik przechodzi **5/5** (44 testy). Domyślny limit `waitFor` to 1 s, a przebieg pełnej suity
z pokryciem na 4 rdzeniach nie zdąża wypchnąć przerenderowania w tym czasie.

Nie zmieniano tego pliku: podniesienie limitu ukryłoby ewentualny prawdziwy wyścig w tej trasie
(wszystkie trzy przypadki dowodzą blokady podwójnej wysyłki), a to nie jest decyzja tego zadania.
Zgłoszenie zostaje dla właściciela modułu.

---

## 7. Zapadka: progi per-ścieżka w `vitest.config.ts`

Plik miał ponad 200 progów per-ścieżka i **ani jednego dla klubów**. Doszło jedenaście wpisów,
wszystkie floorowane 1–2 pp pod pomiarem, każdy z jednozdaniowym komentarzem: wartość zmierzona,
data i powód, jeśli próg jest niższy niż na sąsiedniej powierzchni.

| Ścieżka                                   | instr. | funkcje | linie | gałęzie |
| ----------------------------------------- | -----: | ------: | ----: | ------: |
| `src/routes/club*.tsx`                    |     98 |      99 |    99 |      97 |
| `src/routes/club.apply.tsx`               |     99 |      99 |    99 |      96 |
| `src/routes/admin.community.clubs*.tsx`   |     99 |      99 |    99 |      95 |
| `src/components/clubs/atoms/**`           |     99 |      99 |    99 |      98 |
| `src/components/clubs/molecules/**`       |     98 |      99 |    99 |      98 |
| `src/components/clubs/organisms/**`       |     98 |      98 |    98 |      98 |
| `src/components/admin/clubs/**`           |     98 |      99 |    99 |      96 |
| `src/components/admin/clubs/atoms/**`     |    100 |     100 |   100 |      99 |
| `src/components/admin/clubs/molecules/**` |     99 |     100 |   100 |      99 |
| `src/components/admin/clubs/organisms/**` |     98 |      99 |    99 |      96 |
| `src/lib/clubs/**`                        |     92 |      93 |    92 |      89 |

Próg globalny podniesiony **33/25/33/28 → 56/53/57/51** przy pomiarze całego `src/` na
60,94 / 55,16 / 57,11 / 61,98 (margines ~4 pp na dryf CI). Stary próg był ~28 pp pod stanem
faktycznym, czyli nie pilnował już niczego. Progi wolno wyłącznie **podnosić**.

---

## 8. Wzorce wzięte z repo, nie wymyślone

- `src/test/routeHarness.tsx` — `renderRoute()`, `routeMeta()`, `routeServerHandlers()`; dopisany
  `routeSearchValidator()` czyta `validateSearch` przez **guard**, nie przez rzutowanie.
- `src/test/clubs/fixtures.ts`, `apiMock.ts`, `workspaceApiMock.ts`, `src/test/supabaseChain.ts`,
  `i18nStub.ts`, `routerLinkStub.tsx`, `renderWithQueryClient.tsx`, `axe.ts` — atrapy i wiersze RPC
  brane z istniejących fabryk, żadnych literałów rzutowanych na typ wiersza.
- `vi.mock` zawsze z fabryką, stan przez `vi.hoisted()` (cykliczny `vi.mock` zakleszczał kiedyś
  kolekcję 39 plików — rozdział 9.2 audytu).
- Radix (Select/Tabs/Dialog/Switch/Checkbox) zastępowane natywnymi odpowiednikami, bo happy-dom
  nie ma pełnego API wskaźnika.
- Każdy nowy plik testowy ma nagłówek w formacie repo: **co dowodzi** i **czego świadomie nie
  dubluje** (wzorzec: `adminRouteAuthority.gate.test.ts`).

---

## 9. Jak zweryfikować

```bash
# środowisko (rejestr prywatny wymaga obu kroków; bez drugiego ~250 plików nie startuje)
npm install --no-audit --no-fund --legacy-peer-deps
npm install --no-save --legacy-peer-deps @testing-library/dom jsdom

# 1. cała suita
npx vitest run

# 2-6. powierzchnie (liczby w §4.1)
npx vitest run src/routes/__tests__ src/lib/clubs \
  --coverage --coverage.include='src/routes/club*' --coverage.reporter=text
npx vitest run src/components/clubs src/lib/clubs \
  --coverage --coverage.include='src/components/clubs/**' --coverage.reporter=text
npx vitest run src/components/admin/clubs src/lib/clubs \
  --coverage --coverage.include='src/components/admin/clubs/**' --coverage.reporter=text
npx vitest run src/routes/__tests__ \
  --coverage --coverage.include='src/routes/admin.community.clubs*' --coverage.reporter=text
npx vitest run src/routes/__tests__ src/lib/clubs \
  --coverage --coverage.include='src/routes/club.apply.tsx' --coverage.reporter=text

# 7. progi z globalnej konfiguracji (przechodzą; zero błędów progów)
npx vitest run --coverage

# 8. bramki - wszystkie zielone
npm run check:gate-coverage && npm run check:pg-harness \
  && npm run check:i18n-parity && npm run check:i18n-hardcoded \
  && npm run check:i18n-default-value && npm run check:i18n-overlay-imports \
  && npm run check:permissions-parity && npm run check:authz-snapshot

# 9. typy i lint
npx tsc --noEmit && npm run lint
```

Zmierzone wyniki bramek na tym HEAD: `check:pg-harness` 369 asercji, `check:i18n-parity`
39 plików / 613 testów, `check:permissions-parity` 4 pliki / 98 testów, pozostałe cztery skrypty
bez uwag. `npx tsc --noEmit` — **0 błędów**. `npm run lint` — **0 błędów** (186 ostrzeżeń, z czego
183 zastane w repo i 3 z wygenerowanego katalogu `coverage/`; w plikach klubowych wyłącznie
`react-refresh/only-export-components`, reguła obowiązująca w repo jako ostrzeżenie).
