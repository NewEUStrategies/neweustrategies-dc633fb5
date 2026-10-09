# Recenzja: jakość testów strażnika przeładowania (soczewka: testy)

Zmiana: `feat/w3-reload-guard`, commit `24ece2e9` na bazie `56da8d23`. Pliki:
`src/lib/cacheBusting.ts`, `src/lib/__tests__/cacheBusting.test.ts`.
Worktree nie był edytowany. Wszystkie przebiegi szły w kopii
`review-mut/tree` (`git archive HEAD` z dowiązanym `node_modules`), przez `light.sh`.

## Werdykt

**request_changes: brakuje jednego testu, w kodzie nie ma błędu.** Testy są behawioralne
i trzymają się konwencji pliku. Na starym kodzie są czerwone (12 z 13 nowych). Łapią
usunięcie fallbacku `_v` i zdjęcie granicy TTL. Jedna dziura: zestaw nie przypina zasady,
że decyduje suma znaczników, gdy magazyn DZIAŁA, ale nie przeżywa przeładowania. Mutant,
który czyta `_v` tylko przy wyjątku magazynu, przechodzi wszystkie 47 testów, a w tym
trybie znów daje pętlę. Wystarczy dopisać jeden test (niżej).

## 1. Dowód: stary kod jest czerwony

`git show 56da8d23:src/lib/cacheBusting.ts` z nowym plikiem testów
(`review-mut/run-OLD.log`) daje `12 failed | 35 passed (47)`. Czerwone są:

- magazyn zablokowany: ten sam błąd po przeładowaniu już nie przeładowuje;
- odczyt działa, zapis rzuca `QuotaExceededError`;
- po okienku 15 s kolejny błąd przeładowuje, raz na okienko;
- para `error` + `unhandledrejection` daje jedno `replace`;
- `replaceState` bez `_v`: decyduje adres załadowania;
- brak wpisu nawigacji: decyduje bieżący adres;
- 5 przypadków `it.each` (stary, z przyszłości, śmieciowy, z ogonem, pusty `_v`);
- znacznik w magazynie z przyszłości.

Na starym kodzie zielone zostają tylko dwa przypadki, oba celowe straże regresji: „działający
magazyn: decyduje dotychczasowy strażnik” i przepisany „zablokowany `sessionStorage` nie
blokuje odzyskania strony” (pierwszy odzysk musi się odbyć). Implementer opisał to w IMPL §4
i §8.4, więc to nie jest wada.

Nowy kod: `47 passed`. Pięć plików, które dotykają modułu (cacheBusting, rootRoute,
rootShellRender, previewSessionRecovery, urlLanguageNavigation), daje `200 passed`.
`prettier --check` na obu plikach: OK.

## 2. Mutacje (moje, niezależne od `mutation-check.txt` implementera)

| Mutant | Opis                                                        | Wynik                                                                   |
| ------ | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| MA     | bez fallbacku `_v` (zostaje tylko zatrzask i storage)       | **czerwony**, 10 testów                                                 |
| MB     | `_v` bez TTL: wystarcza sama obecność (oba odczyty)         | **czerwony**, 3 testy (okienko 15 s, stary, z przyszłości)              |
| MC     | `isFresh` bez górnej granicy (wszystkie warstwy)            | **czerwony**, 20 testów                                                 |
| MD     | zatrzask w pamięci bez TTL                                  | **czerwony** („po wygaśnięciu okienka strażnika przeładowuje ponownie”) |
| ME     | bez `sessionStorage.setItem`                                | **czerwony**, 2 testy                                                   |
| MI     | `_v` czytany tylko przy wyjątku `getItem` (a nie `setItem`) | **czerwony** (test quota)                                               |
| MF     | granica TTL `<=` zamiast `<`                                | zielony: granica nieprzypięta (nit)                                     |
| MH     | `_v` czytany tylko, gdy magazyn rzuca (storage first)       | **zielony: przeżywa** (uwaga 3.1)                                       |
| MG     | (równoważny oryginałowi: no-op w `catch`)                   | zielony, bez znaczenia                                                  |

Pliki: `review-mut/variants/*.ts`, logi `review-mut/run-*.log`, zbiorczo
`review-mut/mutation-summary.txt`. Wynik implementera (M1-M7) potwierdzam co do kierunku.

## 3. Uwagi

### 3.1 [major] Niezapięty tryb „magazyn działa, ale nie przeżywa przeładowania”

Badanie (1c) wymienia ten tryb jako źródło pętli: `getItem` zwraca `null`, `setItem` działa,
ale nowy dokument widzi pusty magazyn. Dotyczy to WebView z nową instancją per nawigacja
i kodu, który czyści magazyn. Nowy kod się przed tym chroni, bo `_v` jest sprawdzany zawsze,
a nie tylko przy wyjątku (IMPL §8.3). Żaden test tego nie wymusza. Mutant MH, czyli wariant
rekomendowany w jednym z raportów badawczych, przechodzi cały zestaw.

Sonda recenzenta (`review-mut/probe-*.log`, test dopisany tylko w kopii):

```ts
it("magazyn działa, ale jest czyszczony między dokumentami: brak pętli", async () => {
  handleChunkLoadFailure(CHUNK_ERROR);
  expect(reloadedTo()).toHaveLength(1);
  sessionStorage.clear();
  await reloadInto(lastReload());
  handleChunkLoadFailure(CHUNK_ERROR);
  expect(reloadedTo()).toHaveLength(1);
});
```

Wynik: nowy kod zielony, stary kod czerwony, MH czerwony. **Poprawka:** dopisać ten przypadek
do `describe("strażnik bez magazynu…")`.

### 3.2 [nit] Granica TTL nieprzypięta

Testy używają 14 000 i 15 001 ms, więc `<=` zamiast `<` (MF) przechodzi. Sonda „dokładnie
15 000 ms po reloadzie znów przeładowuje” jest zielona na nowym i starym kodzie, a czerwona
na MF. Opcjonalnie: dopisać.

### 3.3 [nit] `sessionStorage === null`

Firefox z `dom.storage.enabled=false` i część WebView zwracają `null`, a potem `getItem`
rzuca `TypeError`. W nowym kodzie to ta sama ścieżka `catch` co rzucający getter. Sonda
z `value: null` jest zielona na nowym kodzie i czerwona na starym. Osobny test jest
opcjonalny. Można też rozszerzyć `blockStorage` o wariant `null` przez `it.each`.

### 3.4 [ok] Przepisanie starego testu blokady jest uzasadnione

Sprawdziłem twierdzenie z IMPL §3 sondami P4 i P5. W happy-dom po wcześniejszym użyciu
magazynu `vi.spyOn(Storage.prototype, "getItem" | "setItem")` NIE przechwytuje wywołań
na `sessionStorage`: wywołanie nie rzuca, a szpieg ma 0 wywołań. Stary test „zablokowany
`sessionStorage`…” sprawdzał więc magazyn, który wcale nie był zablokowany. Getter rzucający
`SecurityError` (`blockStorage`) i atrapa `fullStorage` to poprawny model. Uwaga na
przyszłość: w notatce badawczej było twierdzenie odwrotne („spy does take effect”). Jest
ono prawdziwe tylko przed pierwszym użyciem instancji.

### 3.5 [ok] Konwencje i izolacja

- `vi.useFakeTimers` + `setSystemTime`, `replace = vi.fn()` i `reloadedTo()` zostały bez
  zmian. Doszły `openDocument` (location i wpis nawigacji) oraz `loadModule`
  (`vi.resetModules` + dynamiczny import), zgodnie ze wzorcem `dockChunks.test.ts`.
- Deskryptor `sessionStorage` jest zapisywany i przywracany w `afterEach`. Testy po
  `blockStorage` korzystają z prawdziwego magazynu i przechodzą, więc wycieku nie ma.
  Szpieg `performance.getEntriesByType` zdejmuje `restoreAllMocks`.
- Pętla jest pokazana na dwóch dokumentach (świeży import, adres z `replace`, upływ czasu),
  a nie na jednym. Asercje dotyczą wyłącznie zachowania (`location.replace`, `_v`
  w adresie, wartość w magazynie). Testów tekstu źródła brak.
- Odczyt z bieżącego adresu i z wpisu nawigacji mają osobne testy, które się wzajemnie
  wykluczają (M1/M2 implementera: każdy pada dokładnie na swoim teście).
- Ograniczona reguła `?_v=` jest pokryta z obu stron: świeży `_v` zatrzymuje, a stary,
  z przyszłości, śmieciowy, z ogonem albo pusty nie zatrzymuje i zostaje zastąpiony świeżym.
  Do tego okienko 15 s w adresie, który dalej niesie `_v`.

### 3.6 [nit] Drobiazgi

- Wyjątek z `performance.getEntriesByType` (gałąź `catch` w `loadedMark`) nie ma testu.
  Ryzyko niskie.
- Szum `ECONNREFUSED 127.0.0.1:3000` w przebiegu występuje też na bazie.

## 4. Podsumowanie

| Kryterium                                              | Stan                                      |
| ------------------------------------------------------ | ----------------------------------------- |
| Testy behawioralne, bez tekstu źródła                  | tak                                       |
| Konwencje pliku                                        | tak                                       |
| Czerwone na starym kodzie                              | tak, 12 z 13 nowych (13. to celowa straż) |
| Zablokowany getter (`SecurityError`)                   | pokryty                                   |
| `getItem` działa, `setItem` rzuca                      | pokryty                                   |
| Magazyn działa, ale jest czyszczony między dokumentami | **niepokryty** (3.1)                      |
| `sessionStorage === null`                              | niepokryty, ta sama ścieżka (3.3)         |
| Ograniczona reguła `_v` (TTL, przyszłość, format)      | pokryta; brak granicy 15 000 (3.2)        |
| Mutacja „bez fallbacku”                                | czerwona                                  |
| Mutacja „bez granicy TTL”                              | czerwona                                  |
