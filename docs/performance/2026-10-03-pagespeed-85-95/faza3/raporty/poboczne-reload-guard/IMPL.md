# Strażnik przeładowania po błędzie chunku bez sessionStorage: implementacja

Gałąź `feat/w3-reload-guard` (worktree `scratchpad/wt3/reload-guard`), baza `56da8d23`, commit
`24ece2e9`. Zmienione pliki: `src/lib/cacheBusting.ts`, `src/lib/__tests__/cacheBusting.test.ts`.

## 1. Problem

`safeReloadOnce` miał jeden blok `try`, w którym odczyt i zapis strażnika w `sessionStorage` szły
razem. Każdy wyjątek trafiał do `catch` z komentarzem „jedziemy dalej” i kończył się
bezwarunkowym `location.replace(?_v=…)`. Pętla powstawała w dwóch trybach:

- dostęp do magazynu rzuca (zablokowane cookies w Chrome, Firefox i Safari, WebView bez DOM
  storage, ramka sandbox);
- odczyt działa, a zapis rzuca (pełna quota, prywatne Safari <= 10): strażnik nigdy nie powstaje.

Przy trwale niedostępnym chunku (adblock, CSP, proxy) każdy dokument przeładowywał się od nowa.
W Chromium na artefakcie bazowym zmierzyłem 22 przeładowania w 45 s (sekcja 5).

## 2. Projekt i uzasadnienie

Reload wstrzymuje KTÓRYKOLWIEK świeży znacznik. Świeży znaczy wydany `0 <= teraz - ts < 15 s`.
Znacznik z przyszłości, nieczytelny (NaN) albo starszy nie wstrzymuje niczego. Ten sam predykat
`isFresh` obsługuje wszystkie warstwy.

| Warstwa                                                         | Co niesie                                                            | Przed czym chroni                                                                                              |
| --------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| a) zatrzask w pamięci (`lastReload`)                            | reload wydany przez ten dokument                                     | drugi `replace` w jednym dokumencie: para `error` + `unhandledrejection`, bufor wczesnych błędów korzenia      |
| b1) `_v` z `location.href`                                      | znacznik dokładany przez sam reload                                  | pętla bez magazynu; to też fallback dla przeglądarek bez wpisu nawigacji (Safari < 15)                         |
| b2) `_v` z `performance.getEntriesByType("navigation")[0].name` | adres, pod którym załadowano dokument                                | `history.replaceState` bez `_v` w nowym dokumencie (AutoLoadNextPost, ClubHub `finishPostFocus`, `/scanner?t`) |
| c) `sessionStorage["__lov_cb_reload"]`                          | dotychczasowy strażnik: ten sam klucz, format (ms dziesiętnie) i TTL | ścieżka sprzed zmiany; odczyt i zapis są teraz best-effort                                                     |

Kolejność w `safeReloadOnce`: najpierw a, b1 i b2. Wartość `_v` czytamy, ZANIM reload ją
nadpisze. Potem storage: świeży wpis kończy obsługę, inaczej następuje zapis. Wyjątek w tym
bloku oznacza tylko brak warstwy. Dalej `lastReload = now`, nowy `_v = now.toString(36)`
i `replace`. Gdy żaden znacznik nie jest świeży, reload się odbywa, więc pierwszy odzysk po
deployu działa także przy zablokowanym magazynie.

Format `_v` jest ścisły: `/^[0-9a-z]{1,11}$/`, potem `parseInt(raw, 36)`. Bez tego `parseInt`
przeczytałby świeży czas z przedrostka śmieciowej wartości, np. `<ts36>-x`.

### Dlaczego nie `window.name`

Pierwsza wersja miała warstwę `window.name = "__lov_cb_reload:<ts36>"`: tylko w oknie
najwyższego poziomu, tylko przy pustej nazwie, przejmowaną do pamięci i zerowaną w następnym
dokumencie. Pomiar w Chromium na artefakcie (`pw/debug/debug3-reload-guard.spec.ts.txt`,
`pw/debug3.log`) dał trzy wyniki:

- zwykły `location.replace('/en?_v=1')`: nazwa PRZEŻYWA, ale wtedy `_v` też przeżywa, więc
  warstwa jest zbędna;
- `replace` z odpowiedzią 302 zdejmującą `_v`: nazwa WYZEROWANA. Odpowiedź 3xx bez nagłówka
  COOP przełącza grupę kontekstów przeglądania. Własny 302 `/` -> `/en` naszego serwera też nie
  ma COOP (`pw/debug2.log`: `RESP 302 … -`);
- `replace` na `/api/public/version`: nazwa wyzerowana (odpowiedź bez COOP same-origin).

Warstwa nie działała więc dokładnie w scenariuszu, dla którego ją dodano (edge zdejmuje
query przekierowaniem). W pełnym dowodzie tryb `blocked-strip` z `window.name` nadal się
zapętlał (`pw/results-after-r0-windowname.json`: 17 reloadów). Jedyną realną korzyść, czyli
odporność na `replaceState` w nowym dokumencie, daje warstwa b2: bez globalnego stanu, bez
wyjątków dla ramek i bez ryzyka nadpisania cudzej nazwy. Usunięcie warstwy przywróciło też
dotychczasowy podział chunków (sekcja 4).

## 3. Zmiany per plik

### `src/lib/cacheBusting.ts`

- Nagłówek modułu (po polsku) opisuje warstwy a-c, regułę świeżości i to, czego strażnik nie
  chroni. Poprawiony też nieaktualny opis pollingu: teraz miękkie `router.invalidate`, a nie
  flaga z reloadem przy nawigacji.
- Nowe funkcje prywatne: `markTime(href)`, `isFresh(t, now)` i `loadedMark()`. Nowy stan
  modułu: `let lastReload = NaN` (inicjalizator bez efektów ubocznych, chunk zostaje czysty).
- `safeReloadOnce`: warstwy jak w sekcji 2. Storage jest odczytywany i zapisywany w `try` bez
  wpływu na decyzję, gdy rzuca.
- Bez zmian: `looksLikeChunkLoadError` (parytet z `EARLY_CHUNK_LOAD_ERROR` w `__root.tsx`),
  `handleChunkLoadFailure`, `startCacheBusting`, polling i API eksportów. Moduł nie dotyka
  `window` ani magazynu przy imporcie. `__root.tsx` jest nietknięty, więc do bootu nie trafia
  żaden bajt.

### `src/lib/__tests__/cacheBusting.test.ts`

- Każdy test dostaje świeżą instancję modułu (`vi.resetModules()` + dynamiczny import
  w `beforeEach`), bo moduł ma teraz pamięć per dokument. Treść istniejących testów się nie
  zmieniła.
- Helpery: `openDocument(href)` ustawia `location` i stub wpisu nawigacji. `blockStorage()`
  ustawia getter `sessionStorage` rzucający `SecurityError`. `fullStorage()` to atrapa
  z działającym `getItem` i `setItem` rzucającym `QuotaExceededError`. `reloadInto(href,
afterMs)` symuluje nowy dokument: świeży import, nowy adres i upływ czasu.
- Istniejący test „zablokowany `sessionStorage` nie blokuje odzyskania strony” używa teraz
  `blockStorage()`. Szpieg na `Storage.prototype` bywał omijany, bo happy-dom przypina metody
  do instancji przy pierwszym użyciu. Potwierdziłem to dla `setItem` w pełnym przebiegu pliku.
  Ten test przechodził więc niezależnie od tego, czy magazyn rzucał.
- Nowy `describe("strażnik bez magazynu: przeładowanie najwyżej raz na okienko")`: 13
  przypadków.

## 4. Testy, sprawdzenie na starym kodzie i mutacje

Nowe przypadki, każdy na dwóch dokumentach tam, gdzie chodzi o pętlę:

1. magazyn zablokowany: ten sam błąd po przeładowaniu już nie przeładowuje;
2. odczyt działa, zapis rzuca `QuotaExceededError`: strażnik i tak działa;
3. po okienku 15 s kolejny błąd znów przeładowuje, raz na okienko (polityka po TTL);
4. para `error` + `unhandledrejection` w jednym dokumencie daje jedno `location.replace`;
5. adres zmieniony w nowym dokumencie bez `_v` (`replaceState`): decyduje adres załadowania;
6. bez wpisu nawigacji (Safari < 15) decyduje bieżący adres;
   7-11. `_v` stary, z przyszłości, śmieciowy, ze świeżym przedrostkiem i ogonem albo pusty nie
   wstrzymuje odzysku i zostaje zastąpiony świeżym. Ten świeży zatrzymuje następny reload;
7. znacznik w magazynie z przyszłości (cofnięty zegar) nie blokuje odzysku;
8. działający magazyn: decyduje dotychczasowy strażnik (klucz, format ms i TTL bez zmian).

Sprawdzenie na starym kodzie (`revert-check.txt`): `git show HEAD:src/lib/cacheBusting.ts`
z nowymi testami daje 12 z 13 nowych przypadków czerwonych. Zielony zostaje tylko nr 13, czyli
celowa straż regresji ścieżki bez zmian, która MUSI przechodzić także na starym kodzie.
Uwaga do 7-11: stary kod przy zablokowanym magazynie przeładowuje zawsze, więc pierwsza połowa
asercji (zły `_v` nie wstrzymuje) jest na nim trywialnie prawdziwa. Przypadki padają na drugiej
połowie, bo świeży `_v` nie zatrzymuje kolejnego dokumentu. Źródło zostało przywrócone
(`cmp` z `cacheBusting.new.ts`).

Mutacje kodu docelowego (`mutation-check.txt`), każda złapana:

| Mutacja                                   | Czerwone testy                    |
| ----------------------------------------- | --------------------------------- |
| M1 bez `_v` z bieżącego adresu            | 1 (nr 6)                          |
| M2 bez `_v` z adresu załadowania          | 1 (nr 5)                          |
| M3 bez zatrzasku w pamięci                | 1 (nr 4)                          |
| M4 bez warunku `0 <= różnica`             | 2 (z przyszłości: `_v` i storage) |
| M5 bez ścisłego formatu `_v`              | 1 (ogon)                          |
| M6 wyjątek magazynu = bezwarunkowy reload | 11                                |
| M7 TTL 30 s zamiast 15 s                  | 3                                 |

## 5. Bramki

| Bramka                                                                                                                                                            | Wynik               | Log                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------- |
| `bunx prettier --write/--check` (2 pliki)                                                                                                                         | OK                  | -                                                                             |
| `light.sh bunx eslint` (2 pliki)                                                                                                                                  | exit 0              | `eslint-r1.log`                                                               |
| typecheck przez mutex (`typecheck-noinc.sh`: tsgo + scripts + e2e)                                                                                                | exit 0, kod końcowy | `typecheck-r0.log` (pierwsza wersja: `typecheck-r0-first-version.log`, też 0) |
| `light.sh bunx vitest run` cacheBusting + rootRoute + rootShellRender + previewSessionRecovery + urlLanguageNavigation (wszystkie pliki odwołujące się do modułu) | 5/5 plików, 200/200 | `vitest-final.log`                                                            |
| `light.sh bun run verify:static`                                                                                                                                  | 15/15 bramek OK     | `verify-static-r1.log`                                                        |
| `BUNDLE_INVENTORY=1 bun run build:smoke`                                                                                                                          | exit 0              | `build-r1.log`                                                                |
| `check-document-weight --samples 5`                                                                                                                               | 30/30 w progach     | `docweight-r1.log`, `document-weight.json`                                    |

Szum `ECONNREFUSED 127.0.0.1:3000` w przebiegu `cacheBusting.test.ts` istnieje już na bazie
(2 wystąpienia w obu wersjach). To nie efekt tej zmiany.

### Paczka (smoke build, porównanie z `base-w3b`)

- `cacheBusting.ts` zostaje w `tag._slug-*.js` z tymi samymi trzema modułami (46 B i 60 B
  współlokatorów nie przeniesiono). Chunk ma 2095 -> 2367 B raw (+272) i 1018 -> 1145 B gzip
  (+127). Ładuje się w punkcie ciszy, poza zamknięciem bootu.
- Wejście `index-*.js`: raw 863 586 -> 863 586 B (0), gzip +32 B (inny hash w nazwach).
- Mediany wagi dokumentu: `bootClosureRawBytes` 1 636 946 -> 1 636 946 (0, zapas 812 B bez
  zmian), `bootClosureGzipBytes` 496 041 -> 496 071 (+30, zapas 638 -> 608 B),
  `preLcpTransferBytes` +5 B, `bootBurstGzipBytes` +35 B.
- Pierwsza wersja z `window.name` (+0,5 KB kodu) przesunęła moduł do `admin.users-*.js` razem
  z komponentem `admin.users` i statycznymi importami vendorów. Wersja końcowa tego nie robi.

## 6. Dowód w przeglądarce (Chromium, artefakt smoke, fixture)

Scratch poza repo: `pw/reload-guard.config.ts` i `pw/reload-guard.spec.ts`, port 4187, przez
mutex. Chunk `SearchButtonWidget-*.js` jest odcinany (`route.abort`). Wyspa importuje go na
intencję, dlatego w KAŻDYM nowym dokumencie po załadowaniu spec naciska „/”. To model chunku
potrzebnego przy każdym wejściu. Wcześniej `<link rel=modulepreload>` tego chunku pada po cichu
i reloadu nie wywołuje (zbadane w `pw/debug-before.log`). Liczymy żądania nawigacji głównej
ramki z `_v` w oknie do 45 s.

| Tryb                                                        | Baza (`base-w3b`)          | Po zmianie                                           |
| ----------------------------------------------------------- | -------------------------- | ---------------------------------------------------- |
| control (magazyn działa)                                    | 1 reload, 2 błędy chunku   | 1 reload, 2 błędy chunku                             |
| blocked (getter `sessionStorage` rzuca)                     | 22 reloady w 46 s (pętla)  | 1 reload, 2 błędy chunku                             |
| quota (`setItem` rzuca)                                     | 16 reloadów w 41 s (pętla) | 1 reload, 2 błędy chunku                             |
| blocked-replacestate (`replaceState` bez `_v` przed błędem) | 21 reloadów w 45 s (pętla) | 1 reload, 2 błędy chunku, końcowy URL `/en` bez `_v` |
| blocked-strip (302 zdejmuje `_v`)                           | 17 reloadów                | 20 reloadów: udokumentowana luka, bez asercji        |

Dwa błędy chunku przy jednym reloadzie oznaczają, że drugi dokument trafił na ten sam błąd
i strażnik go stłumił. W żadnym trybie nie było innych błędów strony, a `window.name` zostaje
puste. Wyniki: `pw/results-before.json`, `pw/results-before-replacestate.json`,
`pw/results-after.json`. Logi: `pw/run-*.log`. Serwery uruchamiał i zatrzymywał Playwright.

## 7. Co zostaje niechronione

- **Błąd trwały później niż 15 s po reloadzie.** Przy bardzo wolnym boocie to powolna pętla
  z okresem > TTL, tak samo jak dotąd przy działającym magazynie. Chunk ładowany na interakcję
  daje najwyżej jeden reload na interakcję. Kotwica `performance.timeOrigin` mogłaby to zamknąć
  kosztem odzysku po kolejnym deployu w długo żyjącej karcie. To decyzja do podjęcia osobno.
- **Przekierowanie 3xx zdejmujące `_v` przy zablokowanym magazynie** (np. reguła brzegowa).
  W repo takiej reguły nie ma, a własne przekierowania serwera zachowują query. Pętla zostaje,
  co potwierdza tryb `blocked-strip`.
- **Świeży link z `_v` otwarty w nowej karcie w ciągu 15 s.** Kosztuje jeden pominięty odzysk
  (Error Boundary zamiast reloadu), także przy działającym magazynie, bo decyduje suma znaczników.
- **Niedostępny chunk samego modułu.** Wtedy nie ma ani pętli, ani odzysku. Stan sprzed zmiany.
- **Błędy chunku sprzed efektu `RootComponent`** nie są obsługiwane. Stan sprzed zmiany.

## 8. Odstępstwa od zadania

1. Warstwa `window.name` (w zadaniu „expected … and/or”) została zaimplementowana, zmierzona
   i usunięta. Zamiast niej `_v` jest czytany także z wpisu nawigacji. Uzasadnienie w sekcji 2.
2. Predykat `0 <= różnica < TTL` obejmuje też storage. Wpis z przyszłości (cofnięty zegar) nie
   wstrzymuje już odzysku. Wcześniej wstrzymywał go, dopóki zegar nie dogonił wartości. Klucz,
   format i TTL są bez zmian.
3. Świeży `_v` wstrzymuje reload także przy działającym magazynie, bo decyduje suma
   znaczników. Dla adresów, które stworzył sam reload, wynik jest identyczny jak dotąd. Różni
   się tylko dla świeżego linku z `_v` otwartego w nowej karcie (sekcja 7).
4. Nie każdy nowy test pada na starym kodzie: nr 13 to celowa straż ścieżki bez zmian.
5. Poza zakresem, do osobnego zadania: `src/lib/preview/sessionHeartbeat.ts` (licznik reloadów
   w sessionStorage, przy blokadzie zawsze 0) i `src/lib/watchdog/previewWatchdog.ts` mają tę
   samą klasę dziury, ale działają tylko w ramce podglądu.
