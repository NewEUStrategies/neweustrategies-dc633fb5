# P3.3 kotwica - recenzja: parzystość SSR/hydratacji i jakość testów

Zakres: commit `470e2a52` (`wt3/p33-anchor`, gałąź `fix/w3-p33-anchor`) wobec `4d1e2791`.
Soczewka: HTML serwera a hydratacja, strażnik tylko w markupie serwera, testy behawioralne
i deterministyczne (dławienie, brak snów zamiast synchronizacji), e2e pada na `base-w3f`
i przechodzi na poprawce. Recenzja tylko do odczytu; worktree i `base-w3f` nietknięte
(`git status` czyste w obu). Logi i surowe dane: `phase3/p33-anchor/rv-parity/`.

**Werdykt: approve.** Nie znalazłem defektu blokującego. Uwagi poniżej są drobne
i dotyczą odporności testów oraz dokładności raportu.

## 1. Parzystość SSR/hydratacji - potwierdzona pomiarem

| sprawdzenie                                                 | wynik                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.output/public` baza vs poprawka (`diff -rq`)              | **identyczne bajt w bajt**: bundel klienta się nie zmienił, więc hydratacja też nie                                                                                                                                                                                                                                                 |
| strażnik w buildzie                                         | tylko `.output/server/_ssr/router-RphXZ8Nv.mjs`. W `public/assets` nie ma ani nowego kodu strażnika (`compareDocumentPosition(e)&4`), ani starego                                                                                                                                                                                   |
| HTML `/` z serwera (fixture, po 2 pobrania z każdej strony) | stabilny między pobraniami. Po normalizacji portu i znaczników czasu (`dehydratedAt`, `u:`) oraz po podstawieniu starej treści strażnika w miejsce nowej HTML poprawki jest **identyczny z bazą** (`rv-parity/html-diff-result.txt`). Różnica +785 B surowo to wyłącznie treść `<script>` (1026 vs 241 B)                           |
| bezpieczeństwo treści skryptu w HTML                        | brak `</` i `<!--`. Znaki `<` i `&` są w treści surowej `<script>`, więc parser ich nie interpretuje                                                                                                                                                                                                                                |
| mechanizm klienta                                           | `CvBlock` bez zmian: `memo`, `suppressHydrationWarning`, `__html: isServerRender() ? CV_BLOCK_HTML : ""`. Zmieniła się tylko stała. `<html>` ma nadal `suppressHydrationWarning` (`__root.tsx:1258`). Strażnik zmienia wyłącznie atrybut `<html>` (jak dotąd), a poza tym wywołuje tylko `scrollIntoView` i `requestAnimationFrame` |
| testy hydratacji w vitest                                   | `hydratacja: te same opakowania i blok cv bez rozjazdu…` i `hydratacja czyta plan z HTML-u serwera…`: `recoverable = []` i `mismatches = []`. Skrypt pozostaje w DOM po ponownym renderze                                                                                                                                           |
| globalne zmienne                                            | nowy strażnik to IIFE. Stary wyciekał `k` i `w` na `window`, więc to drobna poprawa                                                                                                                                                                                                                                                 |

## 2. vitest `builderRenderer.contentVisibility.test.tsx`

- Na poprawce **54/54** (`rv-parity/vitest.log`).
- Strażnika z HTML-u serwera uruchamiam na kopii scratch ze **starą** stałą `CV_GUARD_SCRIPT` (`rv-parity/vitest-oldguard.log`). Wynik: **7 porażek**, wszystkie z nowego bloku:
  - 3 przypadki kliku: `#cel`, stopka i `/#id`, procent-kodowanie;
  - `popstate` przed przewinięciem;
  - `popstate` po przewinięciu;
  - `hashchange`;
  - „cv wyłączone wcześniej” (pada na warunku wstępnym `kliknij` → `true`).
- Przypadki negatywne i wszystkie stare przypadki przechodzą. IMPL podaje 6 porażek, a faktycznie jest 7. To tylko korekta raportu.
- Test jest behawioralny: wykonuje prawdziwy skrypt z HTML-u serwera przez `new Function("addEventListener", …)`, a nasłuchy zdejmuje w `afterEach`.
  - Atrapy są wąskie: `scrollIntoView`, `requestAnimationFrame` (test sam „maluje” klatkę) i `getBoundingClientRect` celu.
  - `vi.restoreAllMocks()` w globalnym `afterEach` sprząta szpiegi.
  - `history.replaceState(null, "", "/")` przywraca adres.
  - Test jest deterministyczny: nie ma czasu rzeczywistego.
- Kolejność względem nasłuchu routera („w nasłuchu routera nic jeszcze nie przewinięte”) jest sprawdzona realnym drugim nasłuchem `popstate`. Pilnuje regresji r1 opisanej w IMPL.

## 3. e2e `content-visibility.boot-home.spec.ts` - pada na bazie, przechodzi na poprawce

Uruchomione przez `heavy-bg.sh` z env CI (fixture), z `--output` poza worktree.

| przebieg                                                                        | build                                     | wynik                                                                                                            |
| ------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `-g "telefon.*kotwica po wczytaniu" --repeat-each 3` (`rv-parity/e2e-base.log`) | `4d1e2791` (`NES_ARTIFACT_ROOT=base-w3f`) | **6 failed / 12**. Góra dalszej sekcji: `location.hash` 3/3, klik 3/3. Nagłówek w dalszej sekcji (cel z CI): 0/6 |
| `-g kotwica --repeat-each 2`, oba viewporty (`rv-parity/e2e-fix.log`)           | poprawka r2 (`wt3/p33-anchor/.output`)    | **24/24**                                                                                                        |

Przykładowe komunikaty porażek na bazie są czytelne i diagnostyczne:

- „cel poza miejscem pod nagłówkiem w 44 z 141 klatek od 830 ms po nawigacji (render routera: 5938 ms)”
- „… w 8 z 93 klatek od 351 ms (render routera: 4899 ms)”

### Dławienie

- `Emulation.setCPUThrottlingRate` jest wysyłane przez sesję CDP strony **przed** `goto`, osobno dla drugiej strony w teście wejścia z fragmentem.
- Działa przez całą nawigację. Świadczą o tym czasy testów telefonu (~16–20 s wobec ~4–6 s na desktopie) i `render routera` po 4–8 s.
- Projekt jest wyłącznie `chromium`, więc CDP jest dostępne.

### Synchronizacja

- Na render routera czeka `expect.poll(rendered)`.
- `settle` sprawdza stabilność w 5 odczytach co 100 ms i ma limit odczytów. Ten wzorzec był już w specu, nie jest to sen zamiast synchronizacji.
- Nie ma stałych `waitForTimeout` jako warunku. Wyjątkiem jest pauza w `wheel`, która była już wcześniej.

### Warunek W2 z REPRO

- `measureSkippedSections` czyta `scrollTop` w poddrzewach opakowań przy wczytaniu i w `popstate`.
- To jawny model snapshottera trace'u z CI, opisany w komentarzu. Bez niego baza lokalnie przechodzi.
- Model jest uprawniony, bo ten sam efekt dają realne odczyty geometrii przez widgety i analitykę.

## 4. Uwagi

1. **minor - wykrywanie regresji opiera się tylko na celu syntetycznym.**
   - Cel z CI („nagłówek w dalszej sekcji”) przechodzi na bazie lokalnie (6/6 tutaj, także w IMPL). Wewnętrzny `overflow:hidden` przycina jego `scroll-margin`, więc lokalnie W1 nie zachodzi.
   - Regresję łapie wyłącznie `góra dalszej sekcji` (`id` dopisany przez test elementowi `[data-sec-id]`). W tym przebiegu było to 6/6, w IMPL klik 3/4 i 1/2.
   - To wystarcza, ale warto w komentarzu specu powiedzieć wprost, że przypadek `far` jest lokalnie zielony także na bazie. Inaczej ktoś usunie `sectionTop` jako dublujący.
2. **minor - `settleAfterNavigation` zakłada, że router renderuje się po zmianie samego `#`.**
   - Funkcja wymaga `onRendered` z `__TSR_ROUTER__` po każdej nawigacji (limit 60 s).
   - IMPL §6 sam wskazuje to zachowanie (pełne `router.load` i render przy zmianie `#`) jako pozycję do usunięcia.
   - Po takiej optymalizacji 6 testów kotwicy na każdym viewporcie padnie po 60 s na `expect.poll`. Komunikat nie wyjaśni wtedy przyczyny, choć lądowanie byłoby poprawne.
   - Sugestia: `expect.poll` z komunikatem albo fallback do samego `settle`, gdy routera nie ma w N s.
3. **minor - cel `far` to identyfikator z `useId` (`_R_…-heading`).**
   - IMPL odnotował 1 na ~70 przebiegów przy x6, w którym wyspa sekcji wyrenderowała się po stronie klienta i `id` się zmienił.
   - Wtedy `where()` rzuca `TypeError` na `null` zamiast dać czytelną asercję, a tracker po cichu pomija klatki.
   - Ryzyko było już wcześniej, ale teraz jest wykonywane w 4 testach na viewport pod x6.
   - Sugestia: asercja istnienia celu z komunikatem albo wybór elementu z `id` stabilnym (z treści, nie z `useId`).
4. **nit - uzasadnienie dławienia w komentarzu (`PHONE_CPU_THROTTLE`).**
   - Komentarz mówi, że „runner CI jest wolniejszy”. REPRO pokazał jednak, że samo dławienie błędu nie odtwarza, a wolniejszy CPU go maskuje.
   - Czasy testów z `repro/ci/failed.log` są zbliżone do lokalnych, a nawet krótsze: `przewinięcie kółkiem` 8,5 s w CI i 5,8 s lokalnie, a stara kotwica 3,4 s w CI i 5,2 s lokalnie.
   - Faktyczna rola x6 w teście to wydłużenie okna, zanim `scrollIntoView` routera „uratuje” cel, tak aby próbka per klatka je zobaczyła. Warto to tak opisać.
5. **nit - czas.** Test wstecz/dalej trwa ~46–50 s przy x6, a limit to 120 s. Czasy w CI są zbliżone do lokalnych (pkt 4), więc zapas wystarcza. Cały spec dochodzi do ~2,9 min dla 24 testów kotwicy przy `--repeat-each 2`. Job `build` ma 30 min.
6. **nit - IMPL §3:** porażek nowych przypadków vitest na starym strażniku jest 7, a nie 6 (pkt 2).

## 5. Artefakty recenzji

- `rv-parity/html-diff.sh`, `home-{base,fix}-{1,2}.html`, `html-diff-result.txt`: porównanie HTML serwera.
- `rv-parity/vitest.log` (poprawka) i `rv-parity/vitest-oldguard.log` (stara stała w kopii scratch; kopię źródeł usunięto po przebiegu).
- `rv-parity/e2e-base.log`, `rv-parity/e2e-fix.log`, `rv-parity/tr-base/` (trace porażek bazy).
- Serwery uruchomione w recenzji zatrzymane (`kill` w skrypcie; Playwright gasi własne).
