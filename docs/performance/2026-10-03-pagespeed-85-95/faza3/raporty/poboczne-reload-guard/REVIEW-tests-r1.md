# Recenzja testów, runda 1 (soczewka: jakość testów)

Zmiana: `56da8d23..d67e1734` w `scratchpad/wt3/reload-guard` (commity `24ece2e9`, `d67e1734`).
Pliki: `src/lib/cacheBusting.ts`, `src/lib/__tests__/cacheBusting.test.ts`. Worktree był tylko
czytany. Wszystkie przebiegi szły w kopii `review-mut/r1/tree` (`git archive HEAD` plus dowiązanie
`node_modules`). Wcześniejsze katalogi `review-mut/*` z rundy 0 zostały nietknięte.

**Werdykt: approve.** Nie ma ustaleń blokujących. Testy są behawioralne, trzymają się konwencji
pliku, pokrywają każdy tryb awarii magazynu i padają na starym kodzie. Zostaje jedna luka
o wadze minor: granice okien czasowych nie są przypięte co do wartości.

## 1. Dowód: testy padają na starym kodzie

| Kod `src/lib/cacheBusting.ts` | Wynik nowego pliku testów | Log                         |
| ----------------------------- | ------------------------- | --------------------------- |
| HEAD `d67e1734`               | 55/55 zielonych           | `review-mut/r1/run-NEW.log` |
| baza `56da8d23` (`git show`)  | **20 czerwonych** / 55    | `review-mut/r1/run-OLD.log` |
| runda 0 `24ece2e9`            | **7 czerwonych** / 55     | `review-mut/r1/run-R0.log`  |

Na bazie padają między innymi wszystkie testy, które opisują istotę zadania:

- `magazyn zablokowany: ten sam błąd po przeładowaniu już nie przeładowuje` (getter rzuca `SecurityError`);
- `odczyt działa, zapis rzuca QuotaExceededError: strażnik i tak działa`;
- cztery tryby `magazyn {działa|zablokowany|pełny|null}: błąd trwały później niż 15 s ...`;
- `magazyn działa, ale jest czyszczony między dokumentami`;
- `para error + unhandledrejection ... jedno location.replace`;
- `znacznik w magazynie z przyszłości ... nie blokuje odzysku`.

Na bazie celowo zostają zielone dwa testy. Oba strzegą zachowania, które nie miało się zmienić:
`zablokowany sessionStorage nie blokuje odzyskania strony` (pierwszy odzysk ma się odbyć)
i `działający magazyn: decyduje dotychczasowy strażnik`. Pierwszy z nich nie jest dowodem
poprawki, tylko strażą przed zbyt szerokim tłumieniem. Zabija go mutant L niżej.

Izolacja: 5 przebiegów z `--sequence.shuffle` (ziarna 1, 7, 42, 1234, 99999) daje 55/55.
`rootRoute.test.tsx` razem z plikiem: 128/128 (`run-root.log`). Prettier `--check` na obu plikach przechodzi.

## 2. Mutacje nowego kodu (moje, niezależne od `fix1-mut/`)

Generator: `review-mut/r1/make-mutants.py`. Mutanty: `review-mut/r1/mutants/`. Logi:
`run-<mutant>.log`, zbiorczo `review-mut/r1/summary.txt`. Źródło przywrócone (`cmp`: RESTORED).

| Mutant                                                                            | Czerwone        | Zabija m.in.                                        |
| --------------------------------------------------------------------------------- | --------------- | --------------------------------------------------- |
| A: bez zapasowego strażnika (usunięte kotwica i `_v`, zostaje magazyn i zatrzask) | 17              | zablokowany, quota, `null`, czyszczony magazyn      |
| B: bez kotwicy                                                                    | 6               | 4 tryby późnego błędu, 5 min                        |
| C: bez warstwy `_v`, sama kotwica                                                 | 1               | wpis nawigacji `document`                           |
| D: `isFresh` bez górnej granicy TTL                                               | 24              | stary `_v`, kolejny deploy, cała ścieżka magazynu   |
| E: `isFresh` bez dolnej granicy                                                   | 2               | `_v` i magazyn z przyszłości                        |
| F: `_v` liczony samą obecnością (bez TTL)                                         | 4               | stary `_v`, kolejny deploy, 5 min                   |
| G: kotwica bez limitu wieku 5 min                                                 | 2               | kolejny deploy, 5 min                               |
| H: kotwica bez górnej granicy `born`                                              | 1               | stary `_v`                                          |
| L: wyjątek magazynu = `return` (brak odzysku bez magazynu)                        | 17              | `zablokowany sessionStorage nie blokuje odzyskania` |
| N: reload bez dopisania `_v`                                                      | 19              |                                                     |
| O: bez zapisu do magazynu                                                         | 2               | ścieżka magazynu, quota (`setItem` wołany)          |
| P: bez zatrzasku                                                                  | 2               | para zdarzeń, nawigacja > 15 s                      |
| Q: `markTime` bez walidacji formatu                                               | 1               | świeży czas z ogonem                                |
| R: bez `_v` z bieżącego adresu                                                    | 1               | wpis `document`                                     |
| S: bez adresu załadowania                                                         | 1               | `replaceState` bez `_v`                             |
| T: TTL magazynu `<=`                                                              | 1               | granica 15 000 ms                                   |
| V: `_v` i kotwica tylko w `catch` magazynu                                        | 2               | tryb „działa”, czyszczony magazyn                   |
| X: limit wieku kotwicy +1 ms                                                      | 1               | 5 min (299 999 / 300 000)                           |
| **I: skew kotwicy 0 ms**                                                          | **0, przeżywa** |                                                     |
| **J: skew kotwicy 30 s**                                                          | **0, przeżywa** |                                                     |
| **K: TTL `_v` 59 s zamiast 15 s**                                                 | **0, przeżywa** |                                                     |
| **W: górna granica kotwicy 59 s zamiast 15 s**                                    | **0, przeżywa** |                                                     |

Obie mutacje wskazane w zleceniu są złapane. Usunięcie fallbacku to mutanty A, B, C, L i N.
Zdjęcie granicy TTL to mutanty D i F (H i G dla kotwicy).

## 3. Ustalenia

### [minor] Granice okien czasowych nie są przypięte co do wartości

Reguła ograniczonego `?_v=` jest pokryta jakościowo. Świeży znacznik (3 s) tłumi reload,
a stary (60 s), z przyszłości (+60 s), śmieciowy, z ogonem i pusty go nie tłumią. Brak TTL
(D) i sama obecność (F) padają. Dokładnych wartości nikt jednak nie przypina:

- TTL warstwy `_v` (15 s) można podnieść do 59 s (K), a górną granicę kotwicy do 59 s (W)
  bez czerwonego testu. Granicę 15 000 ms przypina wyłącznie test ścieżki magazynu (T), a ta
  ma własne wywołanie `isFresh` na `Number(getItem)`;
- tolerancja kotwicy (`RELOAD_ANCHOR_SKEW_MS` = 2 s) przeżywa zarówno 0 ms (I), jak i 30 s (J).
  Każdy test modeluje `born` równe dokładnie 0, bo `reloadInto` ustawia start nawigacji na
  chwilę `replace`. Przypadek, dla którego tolerancja istnieje (zaokrąglanie zegarów, czyli
  `born` lekko ujemne), nie jest nigdzie wykonany. Jeśli ktoś usunie tolerancję, w Firefoksie
  z `resistFingerprinting` kotwica przestanie działać po cichu, a późny błąd (> 15 s) wróci
  do powolnej pętli. Testy tego nie zauważą.

Skutek: to nie jest pętla w obecnym kodzie, tylko brak zabezpieczenia przed regresją przy
przyszłej zmianie stałych. Dlatego minor, a nie blocking.

Poprawka (dwa testy w konwencjach pliku, bez zmian w kodzie):

1. Granica 15 s `_v` bez kotwicy: `blockStorage()`, wpis nawigacji `{ name: "document" }`
   (kotwica wyłączona, decyduje bieżący adres), `openDocument(START_URL + "?_v=" + (NOW - 14_999).toString(36))`
   z podmienionym `getEntriesByType`. Oczekiwane 0 reloadów. To samo z `NOW - 15_000` daje
   1 reload. Zabija K.
2. Granice kotwicy: `blockStorage()`, dokument otwarty z `navigationStart = _v - 2_000`
   (zegar zaokrąglony), błąd po 20 s, czyli poza oknem `_v`. Oczekiwane 0 reloadów.
   Z `navigationStart = _v - 2_001` oczekiwany 1 reload. Para `born = 14_999` / `15_000`
   (start nawigacji 14,999 s lub 15 s po `_v`, błąd po 20 s) daje odpowiednio 0 i 1. Zabija I, J i W.

### [nit] Warstwa `_v` jest prawie w całości przykryta kotwicą

Mutant C (usunięta warstwa `_v`, została kotwica) zabija tylko jeden test (wpis `document`).
W pozostałych scenariuszach dokument ma wpis nawigacji z `_v`, więc decyduje kotwica.
Warstwa `_v` pracuje sama tylko tam, gdzie kotwica nie działa (wczesne NT2, wyjątek
z `getEntriesByType`, uśpienie albo skok zegara). Pierwszy test z poprzedniego ustalenia
domyka i to.

### [nit, istniejące wcześniej] Nagłówek pliku testów mówi o „jsdom” i o nieosiągalnej gałęzi SSR

Linie 27-28: „Gałąź `typeof window === "undefined"` (SSR) nie jest osiągalna w środowisku
jsdom”. Środowisko to happy-dom, a plik ma test `bez window (render serwera) jest no-opem`,
który tę gałąź wykonuje. Tekst pochodzi z bazy (`56da8d23`, linie 20-21), więc nie wchodzi
do tej zmiany. Można go poprawić przy okazji.

## 4. Konwencje i behawioralność (bez uwag)

- Asercje dotyczą wyłącznie zachowania: liczby i adresów `location.replace`, wartości `_v`,
  zapisu klucza w magazynie oraz tego, czy wołano `setItem`. Nie ma testów tekstu źródła
  ani listy klas.
- Konwencje pliku zostały zachowane: `vi.useFakeTimers` + `setSystemTime`, atrapa `location`
  przez `defineProperty` z przywróceniem deskryptora, szpiedzy `console`, `stop()` w `afterEach`.
  Doszły `loadModule()` (`vi.resetModules` + dynamiczny import, wzorzec z `dockChunks.test.ts`)
  i przywracanie deskryptora `sessionStorage`. Kolejność losowa przechodzi.
- Symulacja przeładowania jest wierna temu, co przeżywa nawigację. Pamięć modułu znika
  (świeży import). Zostają adres z `replace`, wpis nawigacji z adresem załadowania
  i `sessionStorage` (jeśli działa). `performance.now()` liczy wiek nowego dokumentu.
- Wszystkie tryby awarii magazynu są pokryte na DWÓCH dokumentach:
  - dostęp rzuca `SecurityError` (`blockStorage`);
  - odczyt działa, zapis rzuca `QuotaExceededError` (`fullStorage`, z asercją, że `setItem` wołano);
  - `sessionStorage === null` (`nullStorage`, czyli `TypeError` na `getItem`);
  - magazyn sprawny, ale czyszczony między dokumentami;
  - magazyn sprawny.
- Komentarz przy `fullStorage` twierdzi, że szpieg na `Storage.prototype` bywa omijany. Sprawdziłem
  to sondą w happy-dom 20.9.0: po pierwszym `setItem` szpieg na `Storage.prototype.setItem` NIE
  przechwytuje wywołania (0 wywołań, brak wyjątku), a `getItem` przechwytuje. Atrapa całego
  magazynu jest więc uzasadniona.
- Zmiana oczekiwania w teście „ten sam dokument po 15 001 ms” z 2 na 1 to świadoma zmiana
  zachowania (zatrzask na dokument). Uzasadniają ją IMPL-fix1.md §2.2 i nagłówek modułu.
  Intencję „kolejny deploy to nowa sytuacja” przejął test na drugim dokumencie (zabija G i F).
