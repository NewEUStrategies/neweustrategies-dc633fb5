# Strażnik przeładowania po błędzie chunku: runda poprawek 1

Gałąź `feat/w3-reload-guard` (worktree `scratchpad/wt3/reload-guard`). Runda 0: commit
`24ece2e9`. Ta runda: NOWY commit `d67e1734` na nim, bez przepisywania historii. Zmienione pliki:
`src/lib/cacheBusting.ts` i `src/lib/__tests__/cacheBusting.test.ts`. Przed pracą worktree był
czysty (`git status` bez zmian), więc nie było resztek przerwanej próby.

## 1. Ustalenia recenzji i decyzje

| Ustalenie                                                               | Waga  | Decyzja                                                                                |
| ----------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------- |
| Pętla, gdy błąd trwały przychodzi > 15 s po reloadzie (P1/P2)           | major | **naprawione**: kotwica dokumentu (sekcja 2.1)                                         |
| Brak testu „magazyn działa, ale nie przeżywa przeładowania” (mutant MH) | major | **naprawione**: nowy test oraz późny błąd w 4 trybach magazynu                         |
| Zatrzask w dokumencie trwa tylko 15 s (P3)                              | minor | **naprawione**: zatrzask na cały dokument (sekcja 2.2), bez resetu w `pageshow`        |
| 3xx zdejmujący `_v` przy zablokowanym magazynie (P4)                    | minor | **zaakceptowane jako luka rezydualna**, opis uzupełniony                               |
| Komentarz o `window.name` bez przesłanki COOP                           | minor | **naprawione**: dopisano COOP same-origin naszych dokumentów (`start.ts`)              |
| (nit, recenzja paczki) kruchość grupowania chunków                      | nit   | **naprawione**: zdanie w nagłówku o sprawdzaniu hosta w `reports/chunk-inventory.json` |
| (nit, recenzja testów) granica TTL 15 000 ms nieprzypięta (MF)          | nit   | **naprawione**: test magazynu sprawdza dokładnie 15 000 ms                             |
| (nit, recenzja testów) `sessionStorage === null`                        | nit   | **naprawione**: tryb `null` w teście późnego błędu                                     |
| (nit, recenzja testów) wyjątek z `getEntriesByType`                     | nit   | pokryte pośrednio: wpis `document` idzie tą samą gałęzią `catch`                       |

## 2. Projekt i uzasadnienie

Warstwy strażnika w kolejności sprawdzania (nagłówek modułu używa tych samych liter):

| Warstwa              | Warunek wstrzymania                                                                  | Nowość w tej rundzie                                  |
| -------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| a) zatrzask          | ten dokument wydał już `location.replace`                                            | na cały dokument zamiast 15 s                         |
| b) kotwica dokumentu | `-2 s <= start nawigacji - _v(adres załadowania) < 15 s` ORAZ wiek dokumentu < 5 min | nowa                                                  |
| c) `_v` świeży       | `0 <= teraz - _v < 15 s` w adresie załadowania albo w bieżącym                       | bez wpisu nawigacji adres załadowania = bieżący adres |
| d) `sessionStorage`  | ten sam klucz, format i TTL, best-effort                                             | bez zmian                                             |

### 2.1 Kotwica dokumentu (major 1)

Recenzent pokazał, że świeżość mierzona względem chwili obsługi błędu nie wystarcza.
Jeśli w nowym dokumencie trwały błąd przychodzi później niż 15 s po `replace`, reload idzie
znowu, i tak w kółko. Przykłady: żądanie chunku wiszące do timeoutu proxy (30-60 s) albo
wyspa ładowana w punkcie ciszy na wolnym urządzeniu. Działo się tak przy zablokowanym i przy
działającym magazynie.

Kotwica rozpoznaje dokument urodzony z NASZEGO reloadu po tym, że jego nawigacja ruszyła
w chwili zapisanej w `_v`. `location.replace` zaczyna nawigację od razu, więc start nawigacji
nowego dokumentu to praktycznie `_v`, bez względu na to, jak długo potem trwa odpowiedź
serwera. Taki dokument nie przeładowuje się przez pierwsze 5 min życia. Po 5 min odzysk po
kolejnym deployu wraca, więc nawet świeży `_v` nie blokuje odzysku bez końca.

Szczegóły:

- **Start nawigacji = `Date.now() - performance.now()`, wiek = `performance.now()`.** Recenzent
  proponował `performance.timeOrigin`. Odrzuciłem go z dwóch powodów. Nie ma go w Safari < 16.
  W Chromium jest liczony z zegara monotonicznego przeliczonego na czas ścienny i potrafi
  rozjechać się z `Date.now()` po uśpieniu systemu. Różnica dwóch odczytów z tej samej chwili
  jest dokładna, dopóki dokument jest młody, a tylko taki nas interesuje (< 5 min). Wiek
  z zegara monotonicznego nie cofa się, gdy użytkownik albo NTP przestawi zegar, więc okno
  5 min jest ograniczone także wtedy. Uśpienie albo skok zegara w czasie ładowania psuje
  rozpoznanie w bezpieczną stronę: kotwica nie zadziała, zostają warstwy 15 s, a skutkiem
  jest najwyżej jeden dodatkowy reload.
- **Tolerancja -2 s** pochłania zaokrąglanie zegarów (Firefox z `resistFingerprinting`
  i przeglądarki z ograniczoną precyzją czasu zaokrąglają oba odczyty). Górna granica 15 s to ten sam TTL co reszta strażnika.
  Kotwica nie zależy od tego, kiedy dokładnie przeglądarka ustawia początek czasu dokumentu.
- **5 min** proponował recenzent. Pokrywa realne opóźnienia (timeout proxy, wolny boot)
  z dużym zapasem i ogranicza koszt (sekcja 6).
- **Adres załadowania** pochodzi z wpisu nawigacji, a bez wpisu (Safari < 15) z bieżącego
  adresu. Dzięki temu kotwica działa też w starszym Safari.
- Koszt w paczce: +63 B raw względem rundy 0 (sekcja 5).

### 2.2 Zatrzask na cały dokument (minor P3)

`let reloadIssued = false` zastępuje `let lastReload = NaN` z TTL 15 s. Ustawiamy go tuż
przed `replace`, a sprawdzamy na samym początku `safeReloadOnce`. Dokument, który wydał
`replace`, czeka na nawigację i nie wydaje drugiego. Wcześniej po 15 s (zimny SSR BYPASS na
wolnej sieci) każdy kolejny błąd chunku przerywał nawigację i zaczynał ją od nowa.

Nie dodałem resetu w `pageshow` z `persisted`. Po `replace` stary wpis historii znika, więc
taki dokument wraca z bfcache tylko wtedy, gdy nawigację anulowano (204, pobranie pliku,
odmowa w `beforeunload`), a użytkownik potem przeszedł dalej i wrócił. Taki przypadek nie
uzasadnia dodatkowego nasłuchu. Skutek to brak automatycznego odzysku w tym dokumencie, a nie
pętla.

### 2.3 Co się nie zmieniło

- Ścieżka magazynu: klucz `__lov_cb_reload`, format (ms dziesiętnie), TTL 15 s i zapis przy
  reloadzie są bez zmian. Wyjątek magazynu nadal oznacza tylko brak warstwy.
- `looksLikeChunkLoadError`, `handleChunkLoadFailure`, `startCacheBusting`, polling i API
  eksportów są bez zmian, więc parytet z `EARLY_CHUNK_LOAD_ERROR` w `__root.tsx` trzyma się
  (test parytetu w `rootRoute.test.tsx` zielony). `__root.tsx` jest nietknięty.
- Brak dostępu do `window`, magazynu i `performance` przy imporcie. Nowy stan na najwyższym
  poziomie to wyłącznie `let reloadIssued = false`.
- `window.name` nadal nie jest używane (uzasadnienie w IMPL.md §2).

## 3. Zmiany per plik

### `src/lib/cacheBusting.ts`

- Nagłówek (po polsku): warstwy a-d z kotwicą i zatrzaskiem na dokument. Uzupełnione „Czego
  strażnik NIE chroni”: punkt o 3xx ma teraz przesłankę COOP (nasze dokumenty: COOP
  same-origin w `start.ts`, odpowiedź 3xx bez niego, więc polityki się różnią), a nowe punkty
  opisują koszt kotwicy. Usunięty punkt o błędzie po 15 s (już chroniony). Doszła uwaga
  o sprawdzaniu hosta chunku po zmianach kodu.
- Nowe stałe: `RELOAD_ANCHOR_MS = 5 min` i `RELOAD_ANCHOR_SKEW_MS = 2 s`.
- `loadedMark(href)`: bez wpisu nawigacji czyta `_v` z bieżącego adresu.
- `safeReloadOnce`: najpierw zatrzask na dokument, potem kotwica, świeży `_v` (adres
  załadowania i bieżący), na końcu magazyn.

### `src/lib/__tests__/cacheBusting.test.ts`

- `openDocument(href, navigationStart)` stubuje też `performance.now()` jako wiek dokumentu
  od startu jego nawigacji. `reloadInto` przyjmuje, że nawigacja rusza w chwili wywołania
  (tuż po `replace`), i trafił na poziom pliku razem z `lastReload`. Doszedł `nullStorage()`.
- Nagłówek pliku opisuje nowe warstwy i model drugiego dokumentu.

## 4. Testy

55 przypadków w pliku (runda 0: 47). Konwencje bez zmian: `vi.useFakeTimers` +
`setSystemTime`, atrapa `location.replace`, asercje wyłącznie na zachowaniu.

Nowe przypadki (8):

1. `kolejny deploy po wygaśnięciu strażnika znów przeładowuje`: kwadrans po reloadzie
   dokument z `_v` znów odzyskuje stronę (straż przed nadmiernym wstrzymaniem);
   2-5. `magazyn {działa | zablokowany | pełny | null}: błąd trwały później niż 15 s po
reloadzie nie daje powolnej pętli`: błędy w wieku 16 s, 60 s i 4 min dają jeden reload
   (regresja sond P1/P2 recenzenta);
2. `magazyn działa, ale jest czyszczony między dokumentami` (major 2, dokładnie test
   z recenzji);
3. `wpis nawigacji bez adresu (document)`: decyduje `_v` z bieżącego adresu (zabija mutację
   usuwającą ten odczyt);
4. `bez wpisu nawigacji kotwica czyta _v z bieżącego adresu (błąd po 15 s)`.

Celowo zmienione (4):

- `po wygaśnięciu okienka strażnika przeładowuje ponownie` (ten sam dokument, 15 001 ms,
  oczekiwane 2) zmienił się w `ten sam dokument przeładowuje najwyżej raz, także gdy nawigacja
wisi dłużej niż okienko` (oczekiwane 1). To zatrzask z minor P3. Intencję „kolejny deploy to
  nowa sytuacja” niesie nowy przypadek 1 na drugim dokumencie.
- `po okienku 15 s kolejny błąd znów przeładowuje` zmienił się w `dokument z naszego reloadu
nie przeładowuje się przez 5 min życia, potem odzysk wraca`. Przypina granicę 5 min:
  299 999 ms daje stop, 300 000 ms reload. Recenzent zapowiedział tę świadomą zmianę.
- `_v` „z przyszłości (cudzy zegar)” to teraz +60 s zamiast +1 s. +1 s mieści się
  w tolerancji kotwicy (2 s) i byłby wzięty za nasz reload. +60 s nadal przypina dolną
  granicę: bez warunku `0 <=` w `isFresh` albo bez dolnej granicy kotwicy test pada.
- Test ścieżki magazynu sprawdza dokładnie 15 000 ms zamiast 15 001 ms. Przypina `<` (nit
  MF).

`bez wpisu nawigacji w Performance API (Safari < 15)` przeszedł do `it.each` z przypadkiem 7.
Asercje się nie zmieniły.

### Sprawdzenie na starym kodzie

Pliki w `fix1-mut/`, logi w `fix1-mut/run-*.log`, zbiorczo w `fix1-mut/summary.txt`. Źródło
podmieniane na czas przebiegu i przywrócone (`cmp` z `fix1-mut/new.ts`: RESTORED).

| Kod                | Wynik              | Uwagi                                                                                                  |
| ------------------ | ------------------ | ------------------------------------------------------------------------------------------------------ |
| baza `56da8d23`    | 20 czerwonych / 55 | czerwone: wszystkie nowe poza przypadkiem 1, z celowo zmienionych zatrzask, 5 min i `_v` z przyszłości |
| runda 0 `24ece2e9` | 7 czerwonych / 55  | zatrzask, 5 min, 4 tryby późnego błędu, kotwica bez wpisu                                              |
| nowy kod           | 55 / 55 zielonych  |                                                                                                        |

Na bazie zielone zostają celowo: przypadek 1 i granica 15 000 ms magazynu. Oba to straże
zachowania, które MA się nie zmienić: odzysk wraca po wygaśnięciu strażnika, a ścieżka
magazynu ma tę samą granicę. Przypadki 6 i 7 są zielone na rundzie 0, bo domykają luki
w testach, a nie w kodzie. Przypadek 6 zabija mutant MH recenzenta (M11 niżej).

### Mutacje nowego kodu (każda złapana)

| Mutant                                                         | Czerwone                                          |
| -------------------------------------------------------------- | ------------------------------------------------- |
| M1 bez kotwicy                                                 | 6 (5 min, 4 tryby, kotwica bez wpisu)             |
| M2 kotwica bez limitu wieku 5 min                              | 2 (kolejny deploy, 5 min)                         |
| M3 kotwica bez górnej granicy 15 s                             | 1 (stary `_v`)                                    |
| M4 kotwica bez dolnej granicy -2 s                             | 1 (`_v` z przyszłości)                            |
| M5 `loadedMark` bez fallbacku na bieżący adres                 | 1 (kotwica bez wpisu)                             |
| M6 bez odczytu `_v` z bieżącego adresu                         | 1 (wpis `document`)                               |
| M7 zatrzask z TTL 15 s (jak w rundzie 0)                       | 1 (zatrzask)                                      |
| M8 bez zatrzasku                                               | 2 (zatrzask, para `error` + `unhandledrejection`) |
| M9 TTL magazynu `<=` (MF recenzenta)                           | 1 (granica 15 000 ms)                             |
| M10 wyjątek magazynu = reload bez innych warstw                | 15                                                |
| M11 kotwica i `_v` tylko przy wyjątku magazynu (MH recenzenta) | 2 (tryb „działa”, magazyn czyszczony)             |
| M12 wiek liczony od `_v`, a nie od startu nawigacji            | 6                                                 |

### Sondy recenzenta

Kopia w `fix1-probes/` (oryginał w `review-probes/` nietknięty). Jedyna zmiana w sondach
recenzenta: `openDoc` stubuje `performance.now()` od startu nawigacji dokumentu, tak jak
przeglądarka. Wyniki: `fix1-probes/probe-results.txt`.

- P3 (zatrzask po 15 s) daje 1 zamiast 2. Sonda celowo asertowała lukę, więc teraz „pada”,
  co jest zamierzone.
- P1 i P2 dosłownie dają po 3 reloady, a nie po 1 (wcześniej 6). Powód: sonda otwiera nowy
  dokument pod `last()` także wtedy, gdy moduł NIE wydał `replace`. To model F5 użytkownika co 16 s, a nie pętli. Taki
  dokument nie jest urodzony z naszego reloadu (start nawigacji 16 s po `_v`), więc dostaje
  jeden odzysk, a jego następca znów stoi. Wychodzi najwyżej jeden reload na odświeżenie
  wykonane przez użytkownika. Wierne warianty, w których nowy dokument powstaje tylko po
  faktycznym `replace`:
  - P1' (magazyn zablokowany, błąd po 16 s): **1** (runda 0: 6);
  - P2' (magazyn działa, to samo): **1** (runda 0: 6);
  - P1'' (magazyn zablokowany, błąd po 60 s): **1** (runda 0: 5);
  - P1-dosłownie z F5 co 16 s: 1 reload na F5, potem stop.
- P1b, P4-P12 bez zmian wyniku, w tym P4 (3xx zdejmujący `_v`): pętla, luka rezydualna.

## 5. Bramki

| Bramka                                                                                                                                                            | Wynik               | Log                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------- |
| `bunx prettier --write` (2 pliki)                                                                                                                                 | bez zmian formatu   | -                                                 |
| `light.sh bunx eslint` (2 pliki)                                                                                                                                  | exit 0              | `eslint-fix1.log`                                 |
| typecheck przez mutex (`typecheck-noinc.sh`: tsgo + scripts + e2e)                                                                                                | exit 0, pusty log   | `typecheck-r1.log`                                |
| `light.sh bunx vitest run` cacheBusting + rootRoute + rootShellRender + previewSessionRecovery + urlLanguageNavigation (wszystkie pliki odwołujące się do modułu) | 5/5 plików, 208/208 | `vitest-fix1.log`                                 |
| `light.sh bun run verify:static`                                                                                                                                  | 15/15 bramek OK     | `verify-static-fix1.log`                          |
| `BUNDLE_INVENTORY=1 bun run build:smoke` (mutex)                                                                                                                  | exit 0              | `build-fix1.log`                                  |
| `node scripts/performance/check-document-weight.ts --samples 5` (mutex)                                                                                           | 30/30 w progach     | `docweight-fix1.log`, `document-weight-fix1.json` |

Uwaga do wagi dokumentu. Pierwszy przebieg uruchomiłem przez `bun run scripts/...`
(`docweight-fix1-bun-runtime.log`) i wyszedł ponad progiem: `bootClosureGzipBytes` +3,5 KB.
To artefakt środowiska, nie kodu. Pliki o identycznym hashu i rozmiarze raw (np.
`vendor-react-DbdJcebo.js`, 195 480 B) miały pod Bunem inny rozmiar gzip, a SSR dał
dokument o 313 B dłuższy. Skrypt pakietu (`check:document-weight`) uruchamia narzędzie przez
`node`. Pod Node wynik jest w progach, a liczby pokrywają się z rundą 0 i bazą (niżej).

### Paczka (build smoke, porównanie z `base-w3b` i rundą 0)

| Metryka                             | Baza                                                                    | Runda 0   | Runda 1   |
| ----------------------------------- | ----------------------------------------------------------------------- | --------- | --------- |
| `tag._slug-*.js` (host modułu), raw | 2095 B                                                                  | 2367 B    | 2430 B    |
| ten sam chunk, zlib poziom 6        | 1011 B                                                                  | 1138 B    | 1174 B    |
| współlokatorzy chunku               | `web-stories.$slug?tsr-shared`, `tag.$slug?tsr-split=notFoundComponent` | te same   | te same   |
| wejście `index-*.js`, raw           | 863 586 B                                                               | 863 586 B | 863 586 B |
| `bootClosureRawBytes` (mediana)     | 1 636 946                                                               | 1 636 946 | 1 636 946 |
| `bootClosureGzipBytes` (mediana)    | 496 041                                                                 | 496 071   | 496 060   |
| `preLcpTransferBytes`               | 177 700                                                                 | 177 705   | 177 708   |
| `bootBurstGzipBytes`                | 574 062                                                                 | 574 097   | 574 090   |

Host modułu i jego sąsiedzi się nie zmienili (`reports/chunk-inventory.json` artefaktu).
Moduł nie przeszedł do wejścia ani do zamknięcia bootu. Różnice gzip w zamknięciu bootu
(+19 B do bazy) to wyłącznie entropia hashy w nazwach plików, bo raw jest identyczne bajt
w bajt. Zminifikowany kod w chunku zawiera kotwicę
(`a=e-r-o;if(a>=-2e3&&a<p&&r<h||…)`) i zatrzask (`let g=!1`).

## 6. Co zostaje niechronione

- **3xx zdejmujący `_v` przy zablokowanym magazynie** (reguła brzegowa). Kotwica też czyta
  `_v`, więc pętla zostaje (sonda P4). W kodzie aplikacji takiego przekierowania nie ma
  (`start.ts:102-104,179`, `canonicalRedirect.ts:27` zachowują query). Warstwy hostingu nie da
  się sprawdzić z repo. `window.name` by nie pomogło, bo przy 3xx bez COOP przeglądarka je
  zeruje.
- **Błąd trwały po 5 min życia dokumentu z reloadu** (chunk dociągany dopiero po
  interakcji): najwyżej jeden reload na 5 min, czyli nie pętla.
- **Kolejny deploy w pierwszych 5 min życia dokumentu z reloadu**: zamiast drugiego odzysku
  zostaje Error Boundary. To cena kotwicy. Przed rundą to okno miało 15 s.
- **Świeży link z `_v` otwarty w nowej karcie w ciągu 15 s** wygląda jak dokument z reloadu.
  Odzysk wraca w nim dopiero po 5 min (wcześniej po 15 s).
- **Anulowana nawigacja `replace`** (204, pobranie, `beforeunload`) wyłącza dalsze próby
  w tym dokumencie. Zatrzask nie jest zerowany przy powrocie z bfcache.
- **Uśpienie systemu albo skok zegara w trakcie ładowania dokumentu z reloadu** może
  wyłączyć kotwicę (rozpoznanie zawodzi w bezpieczną stronę): najwyżej jeden dodatkowy
  reload.
- **Przeglądarki bez wpisu nawigacji z adresem** (wczesne NT2 z `name: "document"`): kotwica
  nie działa, zostaje `_v` z bieżącego adresu z oknem 15 s.
- **Niedostępny chunk samego modułu**: ani pętli, ani odzysku. Stan sprzed zmian.

## 7. Odstępstwa

1. Kotwica liczy start nawigacji jako `Date.now() - performance.now()` zamiast
   `performance.timeOrigin`, a limit wieku jako `performance.now() < 5 min` zamiast
   `now - t < 5 min`. Uzasadnienie w sekcji 2.1. Działa to tak samo, ale także w Safari < 16
   i nie zależy od przestawiania zegara.
2. Sondy P1 i P2 w dosłownym brzmieniu dają 3, a nie 1 (sekcja 4). Wierne warianty dają 1.
3. Nie każdy nowy albo zmieniony test pada na kodzie bazy. Zielone zostają dwa celowe
   straże: przypadek 1 i granica 15 000 ms magazynu (sekcja 4).
4. Wartość `_v` z przyszłości w teście to +60 s zamiast +1 s (sekcja 4).
5. Bez resetu zatrzasku w `pageshow` (opcjonalne w recenzji, sekcja 2.2).
