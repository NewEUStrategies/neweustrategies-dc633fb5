# Recenzja r1: odporność na pętlę i poprawność strażnika przeładowania

Zakres: `git diff 56da8d23..HEAD` w `wt3/reload-guard` (commity `24ece2e9` i `d67e1734`), pliki
`src/lib/cacheBusting.ts` i `src/lib/__tests__/cacheBusting.test.ts`. Soczewka: czy da się
jeszcze zbudować pętlę przeładowań i czy odzysk po deployu nadal działa. Recenzja tylko do
odczytu, worktree nietknięty (`git status` czysty po przebiegach).

Werdykt: **approve**. Nie znalazłem usterki blokującej. Runda 1 domyka obie luki z poprzedniej
recenzji (U1: powolna pętla przy błędzie > 15 s po reloadzie; U2: zatrzask tylko na 15 s).
Kluczowe założenie kotwicy potwierdziłem w prawdziwym Chromium: `Date.now() - performance.now()`
nowego dokumentu to chwila `location.replace`, także przy wolnym serwerze i przy 302. Zostają
luki rezydualne, wszystkie opisane w nagłówku modułu, oraz drobne uwagi niżej.

## Co uruchomiłem

1. Testy w worktree (`light.sh vitest run` dla `cacheBusting.test.ts` i `rootRoute.test.tsx`):
   2 pliki, **128/128** zielonych (`review-probes/r1/vitest-worktree.txt`).
2. Nowy plik testów na trzech wersjach modułu (`review-probes/r1/rev/`, wynik
   `review-probes/r1/revert-check-r1.txt`):
   - baza `56da8d23`: **20 czerwonych / 55**;
   - runda 0 `24ece2e9`: **7 czerwonych / 55** (zatrzask, 5 min, 4 tryby późnego błędu,
     kotwica bez wpisu);
   - `HEAD`: 55/55.
     Liczby zgadzają się z IMPL-fix1 §4. Zielone na bazie zostają tylko straże zachowania, które
     ma się NIE zmienić (odzysk po deployu, granica TTL magazynu itd.). Żaden nowy test
     dowodzący naprawy pętli nie przechodzi „za darmo” na starym kodzie.
3. Własne sondy jednostkowe `review-probes/r1/r1.probe.test.ts` (11 przypadków, wierny model:
   nowy dokument powstaje tylko po faktycznym `replace`, `performance.now()` liczy od startu
   nawigacji). Wyniki: `review-probes/r1/probe-results-r1.txt` (nowy kod) i
   `review-probes/r1/probe-results.txt` (porównanie ze starym kodem).
4. Sonda przeglądarkowa `review-probes/r1/anchor-browser.probe.mjs` (Chromium 1194 przez
   `heavy-bg.sh`, własny serwer na porcie 4193, zatrzymany): strona robi `location.replace`
   z `?_v=<Date.now() base36>`, serwer odpowiada na adres z `_v` po **20 s**, w drugim
   wariancie najpierw **302** po 10 s, a potem 200 po kolejnych 10 s. Log:
   `review-probes/r1/anchor-browser.log`.

## Kluczowe założenie kotwicy: potwierdzone w Chromium

| Wariant                  | `born = Date.now() - performance.now() - _v` | `performance.timeOrigin - _v` | wiek dokumentu przy pomiarze |
| ------------------------ | -------------------------------------------- | ----------------------------- | ---------------------------- |
| serwer odpowiada po 20 s | **1 ms**                                     | 1 ms                          | 20 018 ms                    |
| 302 (10 s) + 200 (10 s)  | **-0,2 ms**                                  | 0,8 ms                        | 20 023 ms                    |

Start nawigacji, z którego kotwica liczy wiek, to chwila wywołania `replace`, a nie
odpowiedzi serwera, więc zimny SSR (BYPASS przez `_v`) nie przesuwa rozpoznania. Wpis
nawigacji niesie końcowy adres po 302 (z `_v`), `type: "navigate"`. Model z testów
(`openDocument(href, navigationStart)` z `navigationStart` = chwila `replace`) odpowiada
zachowaniu przeglądarki. Firefoksa i WebKitu w środowisku nie ma. Spec HTML (`navigate`
pobiera czas startu na początku algorytmu) wskazuje to samo, ale tego nie zmierzyłem.

## Scenariusze ataku i wynik (kod `HEAD`)

| Scenariusz                                                                                                                      | Wynik                                                                                                                                                              | Dowód                                                          |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| getter `sessionStorage` rzuca                                                                                                   | 1 reload, potem stop                                                                                                                                               | test „magazyn zablokowany…”, 4 tryby późnego błędu             |
| `getItem` działa, `setItem` rzuca                                                                                               | 1 reload, potem stop                                                                                                                                               | test QuotaExceeded, tryb „pełny”                               |
| `sessionStorage === null`                                                                                                       | 1 reload, potem stop                                                                                                                                               | tryb „wyłączony (`null`)”                                      |
| magazyn czyszczony między dokumentami                                                                                           | stop (kotwica / `_v`)                                                                                                                                              | test „czyszczony między dokumentami”                           |
| błąd trwały 16 s, 60 s i 4 min po reloadzie                                                                                     | 1 reload (runda 0: pętla)                                                                                                                                          | 4 tryby `it.each`, mutanty M1 i M12                            |
| kilka błędów w jednym dokumencie (para `error`+`unhandledrejection`, bufor wczesnych błędów korzenia, nawigacja wisząca > 15 s) | 1 `replace` na dokument                                                                                                                                            | test pary, test 15 001 ms, R6 (2× `handleChunkLoadFailure`)    |
| `location.replace` rzuca (sandbox)                                                                                              | wyjątek wychodzi raz, kolejne wywołania wstrzymane                                                                                                                 | R10: 1 wywołanie, 1 wyjątek                                    |
| błąd po nawigacji SPA (`href` bez `_v`) w dokumencie z reloadu                                                                  | wstrzymany przez 5 min, potem odzysk na bieżącej trasie                                                                                                            | R6 (`/inna`, 2. reload po 6 min)                               |
| `replaceState` bez `_v` (AutoLoadNextPost, ClubHub, /scanner?t)                                                                 | stop: adres załadowania z wpisu nawigacji                                                                                                                          | test „adres zmieniony…”                                        |
| zegar cofnięty o 1 h między `replace` a nowym dokumentem                                                                        | 1 dodatkowy reload, potem stop                                                                                                                                     | R3: 2 (stary kod: 4)                                           |
| zegar przesunięty o +1 h                                                                                                        | 1 dodatkowy, potem stop                                                                                                                                            | R4: 2 (stary kod: 3)                                           |
| uśpienie systemu w trakcie ładowania (monotoniczny zegar gubi 60 s)                                                             | 1 dodatkowy, potem stop                                                                                                                                            | R5: 2 (stary kod: 3)                                           |
| `_v` stary / z przyszłości (+60 s) / śmieciowy / pusty / z ogonem / 11 znaków `zzzzzzzzzzz` (> MAX_SAFE)                        | nie wstrzymuje, zastąpiony świeżym; następny dokument stoi                                                                                                         | testy `it.each`, R8                                            |
| świeży link z `_v` (< 15 s) otwarty w nowej karcie                                                                              | brak odzysku przez 5 min (udokumentowane)                                                                                                                          | R11: 0 reloadów po 60 s                                        |
| `beforeunload` (`useUnsavedChangesGuard`) przy `replace`                                                                        | „Zostań”: zatrzask wyłącza dalsze próby w dokumencie (udokumentowane); „Opuść” po > 15 s: najwyżej 1 dodatkowy reload, bo nowy dokument nie ma niezapisanych zmian | analiza                                                        |
| bfcache                                                                                                                         | `replace` usuwa wpis starego dokumentu; dokument z reloadu przywrócony po 5 min ma wygasłą kotwicę (wiek liczony od `timeOrigin`)                                  | analiza                                                        |
| odzysk po deployu przy zablokowanym magazynie                                                                                   | dokładnie 1 reload                                                                                                                                                 | test „zablokowany `sessionStorage` nie blokuje odzyskania”, R6 |
| kolejny deploy po 5 min w dokumencie z reloadu                                                                                  | odzysk wraca (granica 299 999 / 300 000 ms przypięta)                                                                                                              | test „5 min życia”, R6                                         |
| 3xx zdejmujący `_v` przy zablokowanym magazynie                                                                                 | **pętla** (luka rezydualna, w repo brak takiej reguły)                                                                                                             | R2: 6/6                                                        |
| wpis nawigacji z `name === "document"` + błąd > 15 s + zablokowany magazyn                                                      | **pętla** o okresie > 15 s                                                                                                                                         | R1: 6/6, uwaga N1                                              |
| błąd trwały zawsze dopiero po 5 min życia dokumentu                                                                             | 1 reload na 5 min, bez końca                                                                                                                                       | R7: 7 w ~30 min, uwaga M2                                      |
| inne automatyczne reloady po chunk-error w `src`                                                                                | brak (grep `location.reload/replace/assign`); `sessionHeartbeat`/`previewWatchdog` poza zakresem, zgłoszone wcześniej                                              | grep                                                           |

## Uwagi

### M1 (minor): dowód w przeglądarce nie obejmuje rundy 1

`pw/results-after.json` powstał o 00:00, przed commitem `d67e1734` (01:07) i przed buildem
`build-fix1` (00:48). IMPL-fix1 §5 nie wymienia przebiegu Playwright. Kotwica i zatrzask
na cały dokument nie mają więc dowodu na zbudowanym artefakcie aplikacji. Ryzyko jest małe:
moja sonda Chromium potwierdza założenie czasowe w izolacji, a testy jednostkowe modelują je
wiernie. Mimo to warto powtórzyć istniejący spec (`pw/reload-guard.spec.ts`) na buildzie fix1
i dodać tryb **późnego błędu**: `page.route` dla `SearchButtonWidget-*.js` odpowiadający
abortem dopiero po ~20 s. Oczekiwane: 1 reload z `_v` w trybach control/blocked/quota, także
z opóźnieniem. Na rundzie 0 tryb opóźniony dałby pętlę, więc to wprost dowód naprawy U1.

### M2 (minor, udokumentowane): błąd trwały, który przychodzi dopiero po 5 min życia

R7: jeśli trwały błąd chunku pojawia się w każdym dokumencie dopiero po 5 min (chunk
dociągany po interakcji albo w późnym punkcie ciszy), mamy 1 reload na 5 min bez końca. To
nie pętla w sensie zadania, bo wymaga późnego wyzwolenia w każdym dokumencie, i jest opisane
w nagłówku („najwyżej jeden reload na 5 min”). Bez zmian w tej gałęzi.

### N1 (nit): kotwica nie korzysta z bieżącego adresu, gdy wpis nawigacji ma `name: "document"`

`loadedMark` dla wpisu `"document"` rzuca w `new URL(...)` i zwraca `NaN`, zamiast wrócić do
`href`. Przy wpisie bez adresu działa więc tylko warstwa c (15 s), a błąd > 15 s po reloadzie
przy zablokowanym magazynie wraca do powolnej pętli (R1). W praktyce nie ma to znaczenia:
build nie ustawia `build.target`, więc obowiązuje domyślne `baseline-widely-available` Vite 7
(Chrome 107, Firefox 104, Safari 16), a te przeglądarki podają adres w `name`. Jeśli autor
chce, żeby nagłówek („bez wpisu - z bieżącego adresu”) był prawdziwy także dla tego wariantu:
`try { return markTime(entry ? entry.name : href) } catch { return markTime(href) }` (kilka
bajtów w leniwym chunku). Test `wpis nawigacji bez adresu` przypina dziś tylko warstwę c.

### N2 (nit): uzasadnienia „Safari < 15 / < 16” są nieaktualne wobec celu builda

Nagłówek tłumaczy fallback na bieżący adres i rezygnację z `performance.timeOrigin`
przeglądarkami Safari < 15 i < 16, które przy domyślnym celu Vite 7 nie uruchomią bundla.
Sam wybór `Date.now() - performance.now()` jest dobry (sonda: identyczny wynik jak
`timeOrigin` z dokładnością do 1 ms). Fallback na bieżący adres może mieć sens w trybach
prywatności, które wyłączają Navigation Timing, ale tego nie weryfikowałem. Wystarczy
zmienić uzasadnienie przy najbliższej okazji.

### N3 (nit): `performance.now()` poza `try`

Gdyby `performance.now` rzucał albo nie istniał, `safeReloadOnce` rzuci przed decyzją i nie
przeładuje (R9). Nie daje to pętli, a w docelowych przeglądarkach nie występuje. Bez zmian.

### Luka rezydualna (udokumentowana): 3xx zdejmujący `_v` przy zablokowanym magazynie

R2: pętla 6/6. Kotwica czyta `_v`, więc tu nie pomoże. W kodzie aplikacji takiego
przekierowania nie ma (`start.ts:102-104,179`, `canonicalRedirect.ts:27`). Akceptuję tak jak
w recenzji r0.

## Jakość testów

- Nowe przypadki są behawioralne i symulują dwa dokumenty. Bez asercji na tekst źródła.
  Model `performance.now()` odpowiada pomiarowi w Chromium (sekcja wyżej).
- Celowo zmienione testy (zatrzask 15 001 ms → 1 reload, granica 5 min, `_v` +60 s) świadomie
  zmieniają politykę zapowiedzianą w r0 i są przypięte z obu stron granicy.
- Przywracanie stanu globalnego jest poprawne (`location`/`sessionStorage` przez deskryptory,
  szpiedzy `performance` w `restoreAllMocks`). Worktree po przebiegach czysty.

## Pliki

- `review-probes/r1/r1.probe.test.ts`, `vitest.probe.config.ts`, `cb.r1.ts` (kopia `HEAD`),
  `cb.old.ts` (`56da8d23`), `probe-results-r1.txt`, `probe-results.txt`
- `review-probes/r1/anchor-browser.probe.mjs`, `anchor-browser.log`
- `review-probes/r1/rev/` (nowy plik testów na 3 wersjach modułu), `revert-check-r1.txt`
- `review-probes/r1/vitest-worktree.txt`
