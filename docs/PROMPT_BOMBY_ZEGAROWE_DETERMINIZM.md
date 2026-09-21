# ZADANIE: rozbroić bomby zegarowe i flak pod obciążeniem - jedna czerwień dziś, dwanaście za godzinę, 205 w inwentarzu

Wejście: audyt pokrycia testami, wydanie 10, rozdz. 14.2 („Suita: z 272 czerwieni w ośmiu plikach do
jednej - i czym są dwie pozostałe"), 14.6 („Bramki i progi: zapadka, która strzela na własnym szumie")
oraz pozycje 1-2 listy zleceń z rozdz. 14.9.

**Wszystkie liczby w tym zleceniu zmierzono na HEAD `c239ab891`** (`main`, commit z 2026-09-06
08:46 UTC), w oknie pomiarowym **2026-09-06 08:53-09:00 UTC**. Każda liczba niesie polecenie, którym
ją uzyskano - odtwórz je przed pracą, bo część z nich **zmieni się sama z upływem czasu, i to jest
właśnie treść zadania**.

Trzy rzeczy, które trzeba wiedzieć, zanim cokolwiek dotkniesz:

1. **Bomba w darowiznach nie jest jednym testem, jest dwunastoma.** Dziś czerwony jest jeden, bo
   pozostałe jedenaście trzyma się na domyślnej dacie z fabryki wierszy, która wypada z okna 168 h
   **2026-09-06 o 10:00:00 UTC**. Zmierzone symulacją: po tej godzinie plik daje **12 czerwonych
   z 45** zamiast 1. Jeśli czytasz to po 10:00 UTC 6 września, sprawdź stan faktyczny pierwszym
   poleceniem z sekcji 0 - prawdopodobnie masz już dwanaście.
2. **„Flak pod obciążeniem" w reklamach to nie kaprys środowiska.** Pod spodem jest efekt
   produkcyjny, który **odpina i przypina nasłuch przy każdym renderze**, bo dostaje nową funkcję
   w propsie. Test wyścig z tym przegrywa dopiero pod obciążeniem. Nazwanie tego „flakiem" ukrywa
   realną wadę.
3. **Tej klasy defektu NIE DA SIĘ znaleźć od strony produkcji.** Kod produkcyjny ma **61 odczytów
   `Date.now() - X` w 50 plikach**; skaner odczytał z nich **39 wyrażeń o kształcie okna**, ale
   **tylko 3 mają `X` policzalne statycznie** (okno 168 h w darowiznach jest parametrem funkcji, nie
   stałą) - pozostałe 36 to zmienne i parametry. Detektor musi więc stać po stronie testu. Zbudowany
   po tej stronie liczy dziś **205 plików** kwalifikujących się jako bomba i **95 z nich w strefie
   gorącej**.

**Nie zmieniasz zachowania produkcyjnego, żeby test przeszedł.** W obu czerwieniach produkcja ma
rację: okno 168 h jest poprawną regułą biznesową, a heurystyka SafeFrame jest poprawnym pomiarem
zaangażowania. Dwa wyjątki, w których wolno tknąć produkcję, są wskazane imiennie w A1.3 i A2.3,
oba pod warunkiem **dowodu neutralności behawioralnej**.

**Progi pokrycia wolno wyłącznie podnosić.** Żaden punkt tego zlecenia nie jest realizowany przez
obniżenie progu, wykluczenie pliku z pomiaru ani przypięcie `it.fails` do testu, który da się
naprawić deterministycznie.

---

# 0. Co zmierzono i czym

Odtwórz przed pracą. Kolumna „stan" to wynik na HEAD `c239ab891` w oknie pomiarowym.

| #   | pomiar                             | polecenie                                                                                                               | stan                              |
| --- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 1   | czerwień w darowiznach             | `npx vitest run src/lib/billing/__tests__/donationsAdmin.server.test.ts`                                                | **1 padł / 44 przeszły (45)**     |
| 2   | AdSlot w izolacji                  | `npx vitest run src/components/__tests__/AdSlot.test.tsx`                                                               | **8 przeszło (8)**                |
| 3   | odczyty `Date.now() -` w produkcji | `grep -rn 'Date.now() *-' src --include='*.ts' --include='*.tsx' \| grep -v '__tests__\|\.test\.\|^src/test/' \| wc -l` | **61** wystąpień w **50** plikach |
| 4   | pliki zamrażające zegar            | `grep -rl 'vi.setSystemTime' src --include='*.test.ts*' \| wc -l`                                                       | 121                               |

Pomiar 1 jest **funkcją czasu wykonania**. Pomiar zasięgu wybuchu z 10:00 UTC uzyskano tak
(symulacja: przesunięcie domyślnej daty o dobę w tył jest równoważne przesunięciu „teraz" o dobę
w przód, bo okno jest wsteczne):

```
# 1. w src/lib/billing/__tests__/donationsAdmin.server.test.ts:110 zmień
#    created_at: "2026-08-30T10:00:00.000Z"  ->  "2026-08-29T10:00:00.000Z"
# 2. npx vitest run src/lib/billing/__tests__/donationsAdmin.server.test.ts
# 3. przywróć plik: git checkout -- src/lib/billing/__tests__/donationsAdmin.server.test.ts
```

Wynik: **12 padło / 33 przeszły (45)**. Dwanaście testów, które przewrócą się o 10:00 UTC:

| grupa                               | test                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| `listAdminDonations`                | przepisuje wiersz rejestru na kształt czytelny dla panelu                            |
| domknięcie wpłat oczekujących       | opłacona sesja domyka wiersz `pending` i ustawia datę zapłaty                        |
| domknięcie wpłat oczekujących       | uboga zwrotka operatora domyka wiersz, ale nie podmienia jego danych                 |
| domknięcie wpłat oczekujących       | sesja WYGASŁA zamyka wiersz jako anulowany, nie jako opłacony                        |
| domknięcie wpłat oczekujących       | ODMOWA: sesja nieznana operatorowi daje ostrzeżenie **(ten jest czerwony już dziś)** |
| domknięcie wpłat oczekujących       | awaria odczytu wierszy osieroconych nie przerywa uzgodnienia                         |
| zwroty                              | zwrócone obciążenie oznacza wpłatę jako zwróconą                                     |
| zwroty                              | zwrot CZĘŚCIOWY też liczy się jako zwrot                                             |
| import sesji spoza rejestru         | ODMOWA OPERATORA na liście sesji nie wywraca uzgodnienia wierszy lokalnych           |
| unieważnienie publicznych statystyk | zmiana w rejestrze unieważnia cache od razu                                          |
| wiarygodność raportu                | nieudany zapis zwrotu NIE jest raportowany jako zwrot wykonany                       |
| wiarygodność raportu                | nieudane zamknięcie WYGASŁEJ sesji też nie podnosi licznika                          |

## Inwentarz systemowy

Skaner: plik testowy jest **bombą**, gdy spełnia wszystkie trzy warunki naraz - (1) niesie literał
daty `20\d\d-\d\d-\d\d`, (2) nie woła `vi.useFakeTimers` ani `vi.setSystemTime`, (3) importuje
moduł produkcyjny czytający prawdziwy zegar (`Date.now()` albo bezargumentowe `new Date()`),
albo czyta go sam.

| miara                                                                  | wartość |
| ---------------------------------------------------------------------- | ------: |
| plików testowych w `src/`                                              |   2 366 |
| z literałem daty ORAZ zależnością czytającą zegar                      |     302 |
| z nich zamraża zegar (bezpieczne)                                      |      97 |
| **z nich NIE zamraża (bomby)**                                         | **205** |
| bomby z najnowszym literałem w ostatnich 30 dniach (**strefa gorąca**) |  **95** |
| bomby z literałem w ostatnich 7 dniach                                 |      49 |

Czoło listy, w kolejności terminu (stan na 2026-09-06; sześć dalszych plików dzieli datę
`2026-09-02T00:00`, więc „dziesiątka" nie jest tu rozstrzygalna bez arbitralności):

| najnowszy literał | wiek | plik                                                                                                                                                              |
| ----------------- | ---: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-05        |  1 d | `src/routes/__tests__/adminCareersRoute.test.tsx`                                                                                                                 |
| 2026-09-03T08:00  |  3 d | `src/lib/events/__tests__/scannerPlane.test.ts`                                                                                                                   |
| 2026-09-02T10:00  |  4 d | `src/lib/podcast/__tests__/queries.test.ts`                                                                                                                       |
| 2026-09-02T10:00  |  4 d | `src/lib/podcast/__tests__/shape.test.ts`                                                                                                                         |
| 2026-09-02T08:30  |  4 d | `src/lib/events/__tests__/previewLiveData.test.ts`                                                                                                                |
| 2026-09-02T08:30  |  4 d | `src/routes/__tests__/adminPageEditorRoute.test.tsx`                                                                                                              |
| 2026-09-02T00:00  |  4 d | `adminCommunityIndexRoute`, `podcastsIndexRoute`, `trackerChangesRoute`, `audienceSegmentsDashboard`, `clientErrorsDashboard`, `meetingBookingActions` (6 plików) |

Dalej w kolejce, dla orientacji w skali: `src/lib/events/onsiteDraft.test.ts` (5 d),
`src/lib/billing/__tests__/notificationsGating.server.test.ts` (5 d),
`src/lib/billing/__tests__/catalogAutoSync.server.test.ts` (7 d). Pełną listę 95 plików wygeneruj
skanerem z zadania C2 - **nie przepisuj jej z tego zlecenia**, bo z każdym dniem jest inna.

**Uwaga do interpretacji „wieku":** literał w przyszłości (33 pliki, np. `2099-01-15`) jest
bezpieczny wobec okien wstecznych, ale niebezpieczny wobec okien **w przód** (`created_at <= now + X`,
terminy, wygaśnięcia). Skaner nie rozróżnia kierunku okna i **nie ma tego robić** - rozróżnienie
wymaga przeczytania produkcji. Zadanie C2 wymaga tylko tego, żeby nowy plik nie dołączał do listy.

---

# CZĘŚĆ A - DWIE CZERWIENIE (P0)

## A1. Bomba w darowiznach: 1 czerwony dziś, 12 od 10:00 UTC

### A1.1 Mechanizm, ustalony co do wiersza

Produkcja, `src/lib/billing/donationsAdmin.server.ts`:

```
117:   sinceHours = 168,                                     <- domyślne okno: 7 dni
120:   const sinceMs = Date.now() - sinceHours * 3_600_000;  <- PRAWDZIWY zegar
145:     .gte("created_at", report.sinceIso)                 <- filtr, który wycina wiersz
213:   const staleIso = new Date(Date.now() - 86_400_000)    <- drugie okno: 24 h
```

Test, `src/lib/billing/__tests__/donationsAdmin.server.test.ts`:

```
110:     created_at: "2026-08-30T10:00:00.000Z",   <- DOMYŚLNA data fabryki donationRow()
496:   it("ODMOWA: sesja nieznana operatorowi ...")  <- dziś czerwony
503:         created_at: "2026-08-29T10:00:00.000Z", <- literał wiersza don-2
515:     expect(report.settled).toBe(1);             <- padająca asercja
```

Komunikat: `AssertionError: expected +0 to be 1`.

Łańcuch: wiersz `don-2` ma `created_at` starszy niż `now - 168 h`, więc filtr z linii 145 go usuwa;
atrapa PostgREST **modeluje ten filtr wiernie** (funkcja `fieldOf` ma `case "created_at"` i rzuca
błąd testu na kolumnie, której nie modeluje - czyli filtr nie jest przepuszczany po cichu), więc
`localRows` nie zawiera `don-2`, nic nie zostaje domknięte, `settled` wynosi 0.

Kalendarz zapalników w tym pliku:

| literał                                                 | +168 h                   | co trzyma                                  |
| ------------------------------------------------------- | ------------------------ | ------------------------------------------ |
| `2026-08-29T10:00:00.000Z` (linia 503)                  | **2026-09-05 10:00 UTC** | wybuchło, 1 czerwony                       |
| `2026-08-30T10:00:00.000Z` (linia 110, **domyślna**)    | **2026-09-06 10:00 UTC** | 11 kolejnych testów                        |
| `2026-08-30T10:05:00.000Z` (`paid_at`, m.in. linia 327) | 2026-09-06 10:05 UTC     | asercje kształtu wiersza                   |
| `2026-08-01T10:00:00.000Z` (linia 282)                  | 2026-08-08 10:00 UTC     | wybuchło dawno, ale test tego nie sprawdza |

Ostatni wiersz jest osobno ciekawy: literał sprzed miesiąca **nie zapalił niczego**, bo ten test
sprawdza kolejność, nie obecność. To pokazuje, dlaczego licznik czerwieni nie jest miarą tej klasy
długu: bomba wybucha tylko tam, gdzie asercja zależy od obecności wiersza w oknie.

### A1.2 Wzorzec poprawny leży w TYM SAMYM pliku, dwa razy

Dwa testy w tym pliku zamrażają zegar i przez to są odporne:

```
386:   it("okno czasowe raportu wynika z podanej liczby godzin", async () => {
387:     vi.useFakeTimers();
388:     vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));
...
397:       vi.useRealTimers();     <- w bloku finally

542:   it("osierocony wiersz tymczasowy starszy niż doba jest anulowany", async () => {
543:     vi.useFakeTimers();
544:     vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));
```

Test z linii 542 siedzi w **tej samej grupie** co czerwony test z linii 496. Autor znał więc wzorzec,
zastosował go tam, gdzie okno 24 h wymuszało to natychmiast, i nie zastosował tam, gdzie okno 168 h
dawało siedem dni zwłoki. **To jest cała przyczyna: zamrożenie było per test, a nie per plik.**

### A1.3 Naprawa

**Krok 1 (wymagany): zamrożenie na poziomie PLIKU, nie testu.** Jeden `beforeEach`/`afterEach` dla
całego pliku, jedna stała czasu, wszystkie literały dat wyprowadzone z tej stałej:

- ustal stałą `NOW` z kanonicznego helpera z zadania C1;
- daty fixture'ów licz względem `NOW` (np. `NOW - 2 * DZIEN`), a nie jako literały kalendarzowe;
- usuń trzy lokalne `vi.useFakeTimers()` z linii 387 i 543 wraz z ich `finally`, jeśli po
  wprowadzeniu zamrożenia globalnego stają się zbędne - **ale nie usuwaj ich asercji**;
- zostaw jawny literał tylko tam, gdzie test dowodzi konwersji formatu, a nie odległości w czasie.

**Krok 2 (wymagany): kontrola dodatnia na samo okno.** Dziś żaden test nie dowodzi, że wiersz spoza
okna 168 h **ma** zostać pominięty - to zachowanie jest dziś „udowadniane" przez przypadkową
czerwień. Dopisz test jawny: dwa wiersze, jeden wewnątrz okna, jeden poza, asercja że domknięty
został dokładnie jeden i że raport nie zgłasza ostrzeżenia o drugim. Po tej zmianie reguła okna ma
własny dowód, niezależny od kalendarza.

**Krok 3 (dopuszczalny wyjątek produkcyjny, wymaga dowodu):** wstrzyknięcie zegara do
`syncDonationsFromStripe` - trzeci parametr `now = Date.now()` albo obiekt `clock`. Zaleta: okno
staje się testowalne bez zamrażania globalnego zegara procesu. Warunek: **domyślna wartość musi
zachować dzisiejsze zachowanie co do bajtu**, a w PR-ze podajesz diff, który dowodzi, że żadna
ścieżka wywołania nie zmienia argumentu. Jeśli nie masz na to miejsca, zrób kroki 1-2 i pomiń 3 -
i **napisz w opisie PR-a, że pominąłeś 3 świadomie**.

### A1.4 Pułapki, każda kosztowałaby przebieg

1. **`vi.setSystemTime(Date.now())` NIE JEST zamrożeniem wobec bomby kalendarzowej.** W repozytorium
   jest **8 takich wystąpień w 6 plikach**. Zamrażają zegar na „teraz w chwili przebiegu", więc odległość do
   literału nadal rośnie z każdym dniem. Jeśli użyjesz tego wzorca, przeniesiesz bombę, nie
   rozbroisz jej.
2. **Nie przesuwaj literałów „na później".** Zmiana `2026-08-30` na `2026-12-30` gasi czerwień
   i ustawia zapalnik na grudzień. Weryfikator w C2 nie odróżni tego od naprawy, więc odróżnić musisz
   ty: **literał kalendarzowy w teście, który zależy od odległości do „teraz", jest zawsze błędem.**
3. **Nie zamrażaj zegara globalnie w `vitest.config.ts` ani w globalnym setupie.** Zamrożony zegar
   procesu psuje testy mierzące czas trwania (`Date.now() - startedAt`, 36 parametryzowanych okien),
   a `vi.useFakeTimers` zatrzymuje też `setTimeout`, na którym stoją `waitFor` i debounce'y.
   Zamrożenie należy do pliku testowego.
4. **RODO w fixture'ach bez zmian:** adresy zostają na `example.com` (dziś `darczynca@example.com`).
   Przeliczenie dat nie jest pretekstem do podmiany danych osobowych na „realistyczniejsze".

### A1.5 Kryterium odbioru A1

Plik `donationsAdmin.server.test.ts` **45 zielonych z 45** w czterech przebiegach:

- przy prawdziwym zegarze,
- przy zegarze przestawionym na **+1 dzień**, **+1 rok** i **+5 lat** wobec chwili przebiegu.

Przestawienie realizujesz plikiem setupu przekazywanym doraźnie (`--setupFiles`), nie zmianą
w `vitest.config.ts`. W opisie PR-a podaj cztery wyniki i polecenia.

---

## A2. Flak w reklamach: nasłuch przepisywany przy każdym renderze

### A2.1 Mechanizm, ustalony co do wiersza

Produkcja, `src/components/ads/atoms/SandboxedAdFrame.tsx`:

```
41:   useEffect(() => {
42:     const onBlur = () => {
43:       if (engagedRef.current) return;
44:       if (document.activeElement === frameRef.current) {
45:         engagedRef.current = true;
46:         onEngage?.();
47:       }
48:     };
49:     window.addEventListener("blur", onBlur);
50:     return () => window.removeEventListener("blur", onBlur);
51:   }, [onEngage]);
```

Konsument, `src/components/AdSlot.tsx`, linie **108** i **118**:

```
onEngage={() => beaconAdEvent("click", slot.id, placement.id)}
```

To **nowa funkcja strzałkowa przy każdym renderze `AdSlot`**. Zależność efektu to `[onEngage]`, więc
każdy render `AdSlot` odpina i przypina nasłuch `blur` na oknie. Test,
`src/components/__tests__/AdSlot.test.tsx`:

```
275:     // Heurystyka SafeFrame: fokus wchodzi w ramkę, a okno traci swój.
276:     act(() => {
277:       frame.focus();
278:       window.dispatchEvent(new Event("blur"));
279:     });
281:     expect(h.events.at(-1)).toEqual({ kind: "click", slotId: "slot-1", placementId: "p1" });
```

Test zakłada trzy rzeczy naraz i żadnej nie sprawdza: że efekt z linii 41 już się wykonał, że
`document.activeElement` to dokładnie ta ramka, którą wcześniej wyszukał, i że między `focus()`
a `dispatchEvent` nie wypadnie render `AdSlot`. Pod obciążeniem (trzy forki, pełna suita) wypada -
i nasłuch jest wtedy w trakcie przepinania, więc zdarzenie `blur` nie trafia w nikogo.

**Dowód, że to nie jest wina środowiska:** w izolacji plik daje 8/8 zielonych (pomiar 2 w sekcji 0),
na runnerze CI był zielony, a czerwony jest tylko w pełnym przebiegu lokalnym. To zależność od
kolejności i obciążenia, nie od kodu.

### A2.2 Naprawa - deterministyczny sygnał zamiast wyścigu

**Krok 1 (wymagany): rozdziel dwie rzeczy, które ten test dziś miesza.** Test sprawdza jednocześnie
heurystykę SafeFrame (własność `SandboxedAdFrame`) i podłączenie beaconu (własność `AdSlot`).
Rozdziel je:

- heurystyka: test jednostkowy `SandboxedAdFrame` z jawnym `onEngage` o **stabilnej tożsamości**,
  z `await waitFor` na tym, że nasłuch jest zarejestrowany, zanim poleci `blur`;
- podłączenie: test `AdSlot`, który dowodzi, że `onEngage` przekazany do ramki woła
  `beaconAdEvent` z właściwymi identyfikatorami - bez dotykania `window.blur` i `activeElement`.

**Krok 2 (wymagany): asercja na obecność nasłuchu, nie na jego skutek.** Zanim wyślesz zdarzenie,
poczekaj na warunek obserwowalny (ramka w DOM **i** efekty wypłukane). `settleGates()` w tym pliku
nie gwarantuje wypłukania efektu ramki - jeśli po analizie okaże się, że gwarantuje, napisz to
wprost w PR-ze i podaj, którą linią to dowodzisz.

**Krok 3 (dopuszczalny wyjątek produkcyjny, wymaga dowodu): stabilizacja tożsamości `onEngage`.**
Owinięcie callbacku w `useCallback` z zależnościami `[slot.id, placement.id]` usuwa przepinanie
nasłuchu przy każdym renderze. To poprawa produkcyjna niezależna od testu: dziś każdy render
`AdSlot` wykonuje parę `removeEventListener`/`addEventListener` na oknie.

Warunek dopuszczenia: **dowód neutralności behawioralnej**. `engagedRef` gwarantuje zliczenie
najwyżej raz na montaż (linia 43), więc stabilizacja tożsamości nie zmienia liczby zgłoszeń - ale to
trzeba **pokazać testem**, który przed zmianą jest czerwony, a po zmianie zielony: render, dwa
wymuszone rerendery, jedno zdarzenie `blur`, dokładnie jedno zgłoszenie. Jeśli nie robisz kroku 3,
nazwij to w opisie PR-a jako świadome pominięcie, wraz z liczbą przepięć na render.

### A2.3 Pułapki

1. **Nie owijaj asercji w pętlę ponawiającą** (`waitFor` wokół `expect(h.events...)`, `retry`,
   `vi.waitFor`). Ponowienie sprawia, że test przechodzi także wtedy, gdy nasłuch przepina się
   w kółko - czyli zamiata wadę, o którą tu chodzi.
2. **Nie obniżaj progu `src/components/AdSlot.tsx`** (dziś `98/98/98/95`, `vitest.config.ts:7008`).
   Ten próg oblewa razem z testem w trzech metrykach naraz i to jest poprawne zachowanie zapadki.
3. **Nie przypinaj `it.fails`.** Defekt jest deterministycznie naprawialny, a rejestr `it.fails` jest
   na defekty produkcyjne bez naprawy, nie na wyścigi w testach.
4. **Nie zastępuj heurystyki „prawdziwym" kliknięciem w ramce.** Kliknięcia wewnątrz sandboxa nie
   bąbelkują do strony i to jest cała racja istnienia tej heurystyki (komentarz w `AdSlot.tsx:44-47`).

### A2.4 Kryterium odbioru A2

- `npx vitest run src/components/__tests__/AdSlot.test.tsx` zielony;
- **dwa pełne przebiegi suity na jednym HEAD**, w obu `AdSlot.test.tsx` zielony;
- przebieg pod wymuszonym obciążeniem (pełna suita, `pool: forks` bez zmian) zielony;
- jeśli zrobiłeś krok 3: test przepięć w PR-ze, z wynikiem przed i po.

---

# CZĘŚĆ B - TRZY PROGI, KTÓRE STOJĄ NA SZUMIE WYKONANIA

Ta część nie gasi czerwieni testów, ale **bez niej kod wyjścia suity nadal będzie różny od zera**.
Stan na HEAD `5fd13461c` (wydanie 10 audytu): 4 naruszenia progów na 2 ścieżkach lokalnie i 1 na 1
na runnerze CI, **zbiory rozłączne**. Rozłączność jest dowodem, że przyczyną jest niedeterminizm, nie
pokrycie.

| ścieżka                                     | próg                                 | lokalnie          | runner    | mechanizm                                                                                                                      |
| ------------------------------------------- | ------------------------------------ | ----------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `src/routes/api/public/payments/webhook.ts` | funkcje 36                           | **20%** (1/5)     | 40% (2/5) | callback w `runAfterResponse(import(...))` wykonany 14 razy w wydaniu 9, 0 razy w wydaniu 10, przy pliku i teście nietkniętych |
| `src/components/AdSlot.tsx`                 | 98/98/98/95                          | 3 metryki poniżej | zielony   | skutek uboczny A2                                                                                                              |
| `src/lib/counters/usePendingCounters.ts`    | gałęzie 99 (`vitest.config.ts:1422`) | 100%              | **75%**   | 25 pp różnicy między maszynami na tym samym kodzie                                                                             |

## B1. Webhook: `await` na pracy po odpowiedzi

Callback rejestrowany po odpowiedzi HTTP nie jest w żadnym teście oczekiwany, więc jego wykonanie
zależy od tego, czy proces dożyje mikrozadania. Wzorzec poprawny jest już w repozytorium:
`waitForAfterResponse()` z PR #327, użyty w testach `ssrCacheHostScope`. Zastosuj ten sam wzorzec
w teście webhooka. **Nie podnoś ani nie obniżaj progu 36** - po naprawie testu funkcja będzie
wykonywana zawsze, a próg podniesiesz osobnym krokiem, gdy dwa przebiegi pokażą tę samą liczbę.

## B2. `usePendingCounters`: pomiar gałęzi w izolacji

Znajdź gałąź, której nie wykonuje runner, a wykonuje maszyna lokalna. Kandydaci: gałęzie zależne od
`document.visibilityState`, od liczby rdzeni albo od kolejności rozstrzygnięcia obietnic. Polecenie
startowe: `npx vitest run --coverage src/lib/counters/` i porównanie `coverage-final.json` z raportem
runnera. Naprawa jest w teście (jawne wymuszenie obu gałęzi), nie w progu.

## B3. Kryterium odbioru części B

**Dwa pełne przebiegi na jednym HEAD z identycznym zbiorem naruszeń progów.** Dziś ten zbiór jest
rozłączny między maszynami; po naprawie ma być pusty na obu. To jedyne kryterium, które odróżnia
naprawę od trafienia.

---

# CZĘŚĆ C - ZAPADKA NA PRZYCZYNĘ

Bez tej części zadanie wróci. Wydanie 9 audytu prognozowało dwie bomby zegarowe i **obie prognozy
były fałszywe**, a bomby, która wybuchła, nie przewidziało - bo prognoza była robiona okiem, nie
skanerem. Ta część zamienia oko na bramkę.

## C1. Kanoniczny helper czasu - jeden na repozytorium

Dziś zamraża zegar **121 plików**, w co najmniej siedmiu konwencjach naraz:

| wzorzec                                                  | wystąpień |
| -------------------------------------------------------- | --------: |
| `vi.setSystemTime(NOW)`                                  |        34 |
| `vi.setSystemTime(new Date("2026-08-22T10:00:00.000Z"))` |        12 |
| `vi.setSystemTime(new Date("2026-08-21T10:00:00.000Z"))` |        10 |
| `vi.setSystemTime(new Date(DATA_BAZOWA))`                |         8 |
| **`vi.setSystemTime(Date.now())`** (w 6 plikach)         |     **8** |
| `vi.setSystemTime(new Date(BASE_MS))`                    |         7 |
| `vi.setSystemTime(new Date(BASE_ISO))`                   |         5 |

W `src/test/` nie ma dziś pliku od czasu - jest tam **55 plików** z fixture'ami i harnessami
domenowymi, a `vi.useFakeTimers`/`vi.setSystemTime` nie jest w żadnym z nich wołane (jedyne
wystąpienie to komentarz w `settingsPaneHarness.tsx`). Dodaj `src/test/time.ts` z:

- jedną stałą `FIXED_NOW` (data w przyszłości albo jawnie „neutralna", opisana komentarzem
  z uzasadnieniem wyboru),
- stałymi `SEKUNDA/MINUTA/GODZINA/DZIEN` do wyprowadzania dat względnych,
- funkcją `freezeClock(at = FIXED_NOW)` instalującą `vi.useFakeTimers` i porządkującą po sobie,
- funkcją zwracającą datę względną w ISO, żeby fixture'y nie nosiły literałów.

**Nie migruj wszystkich 121 plików w tym PR-ze.** Zmigruj: plik darowizn (A1) oraz **sześć plików**
z anty-wzorcem `vi.setSystemTime(Date.now())` (8 wystąpień), bo one dziś **udają** zamrożenie:
`ChatComposer.test.tsx`, `jobsTickRun.test.ts`, `documentCacheL2.test.ts`,
`documentCache.server.test.ts`, `voice.test.ts`, `-community-cron.test.ts`. Resztę zostawia
zapadka z C2, która nie pozwoli dołożyć nowych.

## C2. Bramka `check:clock-freeze` z zapadką jednokierunkową

Skrypt `scripts/check-clock-freeze.ts` implementujący detektor z sekcji 0 (trzy warunki naraz),
z baseline'em w osobnym pliku, wzorem `scripts/lib/unknownCastBaseline.ts`:

- lista plików-bomb z liczbą literałów, **liczba może tylko maleć**, plik nieobecny na liście musi
  mieć zero;
- baseline startowy: **205 plików** (wartość zmierzona na `c239ab891`; przelicz na swoim HEAD i podaj
  różnicę w opisie PR-a);
- osobne, **twarde** zero na anty-wzorzec `vi.setSystemTime(Date.now())` - to nie jest dług do
  zamrożenia, to jest błąd;
- wpięcie: jedna linia `"check:clock-freeze"` w `package.json` i jeden krok w `.github/workflows/ci.yml`
  w jobie `verify`, **bez `continue-on-error`**;
- **kontrole negatywne**, wzorem `check:ssr-budgets` z PR #327: co najmniej pięć przypadków, w których
  bramka MUSI być czerwona - nowy plik z literałem bez zamrożenia, plik z `setSystemTime(Date.now())`,
  wpis baseline'u podniesiony w górę, wpis o pliku, którego nie ma, literał dodany do pliku już
  obecnego na liście.

**Bramka bez kontroli negatywnej nie jest bramką.** Dowód, że bramka jest czerwona, kiedy ma być, jest
częścią odbioru - nie sam fakt, że jest zielona.

## C3. Triage strefy gorącej - 95 plików, kolejność narzucona

Nie naprawiaj wszystkich. Kolejność: **wiek literału rosnąco** (tabela w sekcji 0), bo im starszy
literał, tym więcej okien już się zamknęło. Dla każdego pliku ze strefy gorącej rozstrzygnij jedną
rzecz i zapisz ją w opisie PR-a jednym słowem:

- **bomba** - asercja zależy od odległości literału do „teraz" → zamroź zegar i wyprowadź datę
  z `FIXED_NOW`;
- **niegroźne** - literał jest wejściem konwersji albo etykietą, kierunek okna go nie dotyczy → dopisz
  do baseline'u i zostaw.

Minimum tego PR-a: **dziesięć najgorętszych plików rozstrzygniętych** i cały plik darowizn. Reszta
zostaje na baseline'ie, który od tej pory może tylko maleć.

---

# CZĘŚĆ D - CO UJAWNIĆ, CZEGO NIE ROBIĆ

## D1. Ujawnienie w opisie PR-a - warunek odbioru, nie uprzejmość

Wydanie 10 audytu zmierzyło, że **trzy z siedmiu PR-ów wykonujących poprzednie zlecenia zmieniły
więcej, niż ujawnił ich opis**: jeden 34 pliki produkcyjne przy opisie mówiącym o zerze, drugi 6 przy
zadeklarowanych 2, trzeci pominął pozycję nazwaną w zleceniu BLOKUJĄCĄ bez słowa. Dlatego opis PR-a
musi zawierać:

1. **listę wszystkich zmienionych plików produkcyjnych z powodem** - jeśli zrobiłeś A1.3 albo A2.3,
   to są to pliki produkcyjne i muszą być na liście z dowodem neutralności;
2. **listę pozycji świadomie pominiętych** - w sekcji „czego świadomie nie zrobiłem", z powodem;
3. **wyniki czterech przebiegów z A1.5 i dwóch z A2.4**, z poleceniami;
4. **liczbę plików na baseline'ie C2** przed i po, oraz różnicę wobec 205 z tego zlecenia,
   z wyjaśnieniem różnicy (upływ czasu jest wyjaśnieniem prawidłowym);
5. **HEAD, na którym mierzyłeś** - jeśli różni się od `c239ab891`, podaj go i wypisz liczby, które
   się zmieniły.

## D2. Czego nie wolno

- obniżyć któregokolwiek progu pokrycia (wolno wyłącznie podnosić);
- wykluczyć pliku z pomiaru pokrycia albo z kolekcji testów;
- przypiąć `it.fails` do testu naprawialnego deterministycznie;
- zamrozić zegara globalnie w `vitest.config.ts` ani w globalnym setupie;
- przesunąć literału daty „na później" zamiast wyprowadzić go z `FIXED_NOW`;
- zmienić zależności w `package.json` ani commitować lockfile'a - **jedyna dopuszczalna zmiana
  w `package.json` to jedna linia skryptu `check:clock-freeze`**;
- wstawić prawdziwych danych osobowych do fixture'ów; adresy zostają na `example.com`/`example.org`;
- użyć `any` ani `as any` w nowym kodzie.

## D3. Kryterium odbioru całości

| #   | warunek                                                          | jak sprawdzić               |
| --- | ---------------------------------------------------------------- | --------------------------- |
| 1   | darowizny zielone przy czterech ustawieniach zegara              | A1.5                        |
| 2   | reguła okna 168 h ma własną kontrolę dodatnią                    | A1.3 krok 2                 |
| 3   | AdSlot zielony w dwóch pełnych przebiegach                       | A2.4                        |
| 4   | zbiór naruszeń progów **pusty i identyczny** w dwóch przebiegach | B3                          |
| 5   | `bun run check:clock-freeze` zielony, baseline ≤ 205             | C2                          |
| 6   | bramka **czerwona** na pięciu kontrolach negatywnych             | C2                          |
| 7   | twarde zero na `vi.setSystemTime(Date.now())`                    | C2                          |
| 8   | dziesięć najgorętszych plików rozstrzygniętych                   | C3                          |
| 9   | żaden próg nie obniżony, żaden plik nie wykluczony               | `git diff vitest.config.ts` |
| 10  | opis PR-a spełnia D1 punkt po punkcie                            | recenzja                    |

**Sprawdzenie, które rozstrzyga o sensie całego zadania:** przestaw zegar systemowy o rok i uruchom
pełną suitę. Dziś to niewykonalne z zewnątrz (`faketime` nie jest w tym środowisku dostępne), więc
zrób to plikiem setupu podanym doraźnie do vitest. Liczba czerwieni w takim przebiegu jest miarą
długu bomb zegarowych - podaj ją w opisie PR-a **przed** naprawą i **po**. To jedyna liczba, która
mówi, ile z tych 205 plików było naprawdę bombami.
