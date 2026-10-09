# Recenzja: odporność na pętlę i poprawność strażnika przeładowania

Zakres: `git diff 56da8d23..HEAD` w `wt3/reload-guard` (commit `24ece2e9`), pliki
`src/lib/cacheBusting.ts` i `src/lib/__tests__/cacheBusting.test.ts`. Soczewka: czy da się
jeszcze zbudować pętlę przeładowań i czy nie zepsuto odzysku po deployu.

Werdykt: **approve**. Brak usterek blokujących. Zmiana zamyka obie dziury z zadania
(getter `sessionStorage` rzuca; `getItem` działa, a `setItem` rzuca) i nie psuje
jednorazowego odzysku po deployu. Zostaje jedna istotna luka (pętla o okresie > 15 s),
ale to stan sprzed zmiany, występujący także przy działającym magazynie, i jest opisany
w kodzie. Proponuję ją domknąć osobnym zadaniem (szczegóły w U1).

## Co uruchomiłem

- `vitest run src/lib/__tests__/cacheBusting.test.ts src/routes/__tests__/rootRoute.test.tsx`
  w worktree (przez `light.sh`): 2 pliki, 120/120 zielonych.
- Własne sondy: `review-probes/loop.probe.test.ts` (13 przypadków) na kopii nowego modułu
  (`cb.new.ts`) i starego (`cb.old.ts`, `56da8d23`). Konfiguracja:
  `review-probes/vitest.probe.config.ts`, uruchomienie:
  `PROBE_MOD=./cb.new.ts vitest run --config vitest.probe.config.ts`.
  - nowy kod: 13/13 zgodnie z oczekiwaniem recenzenta (w tym sondy, które celowo
    potwierdzają pozostałe luki: P1, P2, P3, P4, P10);
  - stary kod: 7 czerwonych (P1b, P5, P6, P7, P8, P10, P12), czyli stara ścieżka
    zapętlała się w każdym trybie bez magazynu.
- Przejrzałem raporty implementera: `revert-check.txt` (12 z 13 nowych testów czerwonych na
  starym kodzie; 13. to celowa straż ścieżki bez zmian), `mutation-check.txt` (M1-M7 złapane)
  i `pw/results-after.json` (1 reload we wszystkich trybach poza `blocked-strip`).

## Scenariusze ataku i wynik

| Scenariusz                                                                                                              | Wynik                                                                                                   | Dowód                                                                               |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| getter `sessionStorage` rzuca (`SecurityError`)                                                                         | 1 reload, potem stop                                                                                    | test „magazyn zablokowany…”, PW `blocked`                                           |
| `getItem` działa, `setItem` rzuca (`QuotaExceededError`)                                                                | 1 reload, potem stop                                                                                    | test „odczyt działa, zapis rzuca…”, PW `quota`                                      |
| magazyn czyszczony przy każdej nawigacji (WebView)                                                                      | stop: decyduje `_v`                                                                                     | równoważne P1b (magazyn nic nie wnosi)                                              |
| `window.name` obcy lub wyzerowany                                                                                       | bez wpływu: warstwy nie ma, nic nie czyta ani nie pisze `window.name`                                   | kod, PW `windowName: ""`                                                            |
| `?_v=` zdjęty przez 3xx przy zablokowanym magazynie                                                                     | **pętla** (udokumentowana luka, w repo brak takiej reguły)                                              | P4, PW `blocked-strip`                                                              |
| `replaceState` bez `_v` w nowym dokumencie (AutoLoadNextPost, ClubHub, /scanner?t)                                      | stop: decyduje wpis nawigacji                                                                           | test „adres zmieniony…”, PW `blocked-replacestate`                                  |
| SPA bez `_v` i brak wpisu nawigacji (Safari < 15)                                                                       | 1 dodatkowy reload, potem stop                                                                          | P7                                                                                  |
| kilka błędów w jednym dokumencie przed nawigacją (para `error` + `unhandledrejection`, bufor wczesnych błędów korzenia) | 1 `replace`                                                                                             | test pary, P5 (5× `handleChunkLoadFailure` + nasłuch)                               |
| nawigacja `replace` wisi > 15 s, a stary dokument dalej sypie błędami                                                   | drugie `replace` (zatrzask wygasa)                                                                      | P3, uwaga U2                                                                        |
| błąd trwały > 15 s po reloadzie (timeout chunku, wolny boot)                                                            | **pętla o okresie > 15 s**, także przy działającym magazynie                                            | P1, P2, uwaga U1                                                                    |
| zegar cofnięty o godzinę między dokumentami                                                                             | 1 dodatkowy reload, potem stop                                                                          | P8                                                                                  |
| `_v` stary / z przyszłości / śmieciowy / pusty / świeży z ogonem                                                        | nie wstrzymuje, zastąpiony świeżym                                                                      | testy `it.each`                                                                     |
| `_v` podwójny (`?_v=abc&_v=<świeży>`)                                                                                   | decyduje pierwszy, reload zostawia jeden `_v`                                                           | P9                                                                                  |
| wpis nawigacji z `name === "document"` (stara wersja NT2)                                                               | wyjątek `new URL` złapany, decyduje `href`                                                              | P6                                                                                  |
| `location.replace` rzuca (ramka sandbox)                                                                                | wyjątek wychodzi raz, kolejne wywołania wstrzymane zatrzaskiem                                          | P12                                                                                 |
| bfcache                                                                                                                 | bez znaczenia: `replace` usuwa wpis; dokument przywrócony po > 15 s ma wygasłe znaczniki, odzysk działa | analiza                                                                             |
| SW `/scanner` offline (stary HTML z cache pod adresem z `_v`)                                                           | stop: `href`/wpis nawigacji niesie `_v`                                                                 | analiza `public/scanner-sw.js:114-126`                                              |
| odzysk po deployu przy zablokowanym magazynie                                                                           | dokładnie 1 reload                                                                                      | test „zablokowany `sessionStorage` nie blokuje odzyskania”, test „po okienku 15 s…” |
| SSR / czysty chunk                                                                                                      | `let lastReload = NaN`, bez dostępu do `window` przy imporcie; boot closure raw +0 B                    | kod, IMPL §5                                                                        |

## Uwagi

### U1 (major, stan sprzed zmiany): pętla o okresie > TTL nadal możliwa

Świeżość znacznika jest liczona względem `Date.now()` w chwili obsługi błędu
(`isFresh(loadedMark(), now)`). Jeżeli w nowym dokumencie trwały błąd chunku dociera do
`safeReloadOnce` później niż 15 s po wydaniu `replace`, reload idzie znowu i tak w kółko. Sonda
P1 (magazyn zablokowany, błąd po 16 s) daje 6 reloadów na 6 dokumentów; P2 to samo przy
działającym magazynie. Realne źródła: żądanie chunku wiszące do timeoutu proxy/sieci (30-60 s,
kończy się „Failed to fetch dynamically imported module”), bardzo wolny boot na słabym
urządzeniu, gdzie wyspa wyszukiwarki ładuje się w punkcie ciszy `islands`. Każdy obieg to zimny
render SSR (`_v` = BYPASS cache dokumentu).

Nie oznaczam jako blokujące, bo: (1) to nie regresja, przy działającym magazynie było tak samo;
(2) zadanie dotyczyło pętli przy zablokowanym magazynie, a ta została sprowadzona do tej samej
klasy co ścieżka z magazynem; (3) luka jest opisana w nagłówku modułu i w IMPL §7.

Propozycja (osobne zadanie lub dopisek tutaj, ~100 B kodu, poza zamknięciem bootu): kotwica
w dokumencie. Dokument jest „wynikiem naszego reloadu”, gdy znacznik z wpisu nawigacji spełnia
`-2_000 <= performance.timeOrigin - t < TTL` (tolerancja na rozjazd `timeOrigin`/`Date.now`).
Taki dokument nie przeładowuje się przez ograniczony czas życia, np. `now - t < 5 min`, a po tym
oknie odzysk wraca. Zamyka to pętlę niezależnie od długości bootu i czasu timeoutu, a kosztuje
tylko brak automatycznego odzysku po KOLEJNYM deployu w pierwszych minutach życia karty
wyprodukowanej przez reload. Test: sonda P1 powinna wtedy dać 1 reload.

### U2 (minor): zatrzask w dokumencie ma TTL 15 s zamiast „raz na dokument”

`lastReload` wstrzymuje drugi `replace` tylko przez 15 s (P3). Gdy nawigacja z `replace` trwa
dłużej (zimny SSR BYPASS + wolna sieć), a stary dokument dalej generuje błędy chunku (np.
kolejne wyspy, kliknięcia), każdy błąd po 15 s wydaje nowe `replace`, które przerywa poprzednie
ładowanie i startuje od zera. Przy serwerze odpowiadającym > 15 s strona może nie przeładować się
wcale. To nie pętla przeładowań, ale degradacja odzysku. Poprawka: zatrzask na cały dokument
(`let reloadIssued = false` → `true` przed `replace`), ewentualnie zerowany w `pageshow`
z `persisted`. Koszt: anulowana nawigacja (204, pobranie pliku, odmowa w `beforeunload`) wyłącza
dalsze próby w tym dokumencie, co jest akceptowalne.

### U3 (minor, udokumentowane): 3xx zdejmujący `_v` przy zablokowanym magazynie

Pętla zostaje (P4, PW `blocked-strip`: 20 reloadów). W kodzie aplikacji takiego przekierowania
nie ma (`start.ts:102-104,179`, `canonicalRedirect.ts:27`, reguły z `redirects.ts` dotyczą
tylko adresów-źródeł, na których klient nie zostaje). Warstwy hostingu nie da się sprawdzić
z repo. Kotwica z U1 by tu nie pomogła; pomógłby tylko nośnik niezależny od URL-a, a
implementer zmierzył, że `window.name` przy 3xx bez COOP jest zerowany. Akceptuję jako lukę
rezydualną.

### U4 (nit): zmiana zachowania przy działającym magazynie

Świeży `_v` w adresie wstrzymuje reload także wtedy, gdy magazyn działa i nie ma świeżego
wpisu (P10). Dotyczy wyłącznie świeżego (< 15 s) linku z `_v` otwartego w nowej karcie.
Opisane w IMPL §8.3. Bez zmian.

### U5 (nit): dowód w przeglądarce nie pokrywa ścieżki bez interakcji ani błędu > 15 s

Spec naciska „/” ok. 1,5 s po `load`, więc błąd zawsze przychodzi szybko i po interakcji.
Ścieżki automatycznej (punkt ciszy) i późnego błędu (U1) dowód nie obejmuje; pokrywają je
testy jednostkowe i sondy. Nie wymaga zmian w tej gałęzi.

## Jakość testów

- Nowe testy są behawioralne, symulują dwa dokumenty (świeży import modułu, nowy `href`, stub
  wpisu nawigacji) i padają na starym kodzie (12/13; 13. to celowa straż ścieżki bez zmian).
  Żaden nowy test nie przechodzi „za darmo” na starym kodzie poza tym jednym, opisanym.
- Przywracanie stanu globalnego jest poprawne: `sessionStorage` i `location` są w happy-dom
  własnymi właściwościami `window`, więc deskryptory zapisane w `beforeEach` przywracają je
  w `afterEach`; szpieg `performance.getEntriesByType` znika w `restoreAllMocks`.
- Polityka „po 15 s znowu reload” jest przypięta testem „po okienku 15 s…”. Jeśli wejdzie U1,
  ten test trzeba będzie świadomie zmienić.
