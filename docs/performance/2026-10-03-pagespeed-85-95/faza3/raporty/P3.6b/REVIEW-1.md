# Recenzja P3.6b (fala 3, partia 2), stan po rundzie poprawek 1: `37220be7`

Worktree: `scratchpad/wt3/P3.6b` (gałąź `perf/w3-P3.6b`). Diff `claude/zen-ritchie-hzur21...HEAD` obejmuje trzy
commity: `80ce4d2b`, `1d452919` i `37220be7`. Recenzja jest adwersaryjna i niczego nie edytuje. Poprzednie
recenzje: `REVIEW-runda1.md` (APPROVE) i `REVIEW.md` (FIX_REQUIRED, B1 + m1-m6). Ta recenzja dotyczy głównie
commita `37220be7`, ale zakres plików i bramki sprawdziłem dla całego diffu.

**Werdykt: FIX_REQUIRED.** Ustalenia: 0 blokujących, 1 poważne (M1), 4 drobne.

- B1 z poprzedniej recenzji jest naprawione poprawnie.
- m2, m3 i m5 są naprawione poprawnie.
- Poprawka m4 (granica nagłówka puszcza na `ready()`, a reklama dogrzewa się dalej w tle) otwiera nową drogę
  do niezgodności hydratacji i późnego skoku banera o ~90 px. Taki dokument P3.6b dziś zapisuje do NES Edge
  Cache (M1). Najprościej cofnąć samą część m4.

## 1. Zakres plików, commit, scalenia

- **Pliki.** Diff ma te same 20 plików co po rundzie 9. Wszystkie są z listy notatek: źródła `index.tsx`,
  `documentCache.server.ts`, `responseHeaders.ts`, `chromeWarmup.tsx`, `resilientLoad.ts`, `homeSsrBudget.ts`,
  `ssrTiming.ts` (tylko `degradedBy`), `server.ts` (tylko `logDocument`), `__root.tsx`, a do tego testy. Nie ma
  nowych zależności ani zbędnych plików.
- **`__root.tsx`.** Commit `37220be7` zmienia trzy linie poza samą gałęzią `expired()`: warunek w `tickerWarm`,
  typ `chromeWarm` i `push` prefetchu. Implementer to zgłosił (IMPL-fix1 §4). Sprawdziłem równoważność dla
  `warm`:
  - `chromeWarm` ma tylko dwóch użytkowników, `warm` i `warmLate`;
  - `warm` wraca od razu przy `chromeBudget <= 0`;
  - `warmMenus` i fabryka reklamy ignorują argument.

  Zachowanie `warm` jest więc identyczne (zob. m-a).

- **Scalenia.** `git merge-tree --write-tree HEAD` przechodzi bez konfliktów:
  - z P3.8 `d66fc7fd` (aktualny HEAD P3.8) daje `40b4f03c`;
  - z P3.3 `cf0cf8a5` daje `378492b2`.

  W drzewie scalonym wstawka P3.8 `if (isServer) chromeWarm.push(() => warmNoActivePopupsOnServer(...))` typuje
  się do fabryki z budżetem i trafia też do `warmLate`.

- **Commit.** Opis jest po polsku. Trailer jest dokładnie taki, jak wymagany (`Co-Authored-By: Claude Opus 5.5
<noreply@anthropic.com>` oraz `Claude-Session: https://claude.ai/code/session_018pV9XfFuDnwMxKGJSFfcDg`).
  Komentarze są po polsku, prettier przechodzi.

## 2. Weryfikacja poprawek z `REVIEW.md`

### B1: sygnał popupów z P3.8. Naprawione

`DECORATIVE_QUERY_ROOTS` zawiera teraz `WIDGET_QUERY_ROOTS.popupsActive` (`resilientLoad.ts:213-216`).

- Sprawdziłem `warmNoActivePopups` w `wt3/P3.8` (`popups.ts:236-253`). Przy błędzie rzuca, więc nic nie
  zasiewa. Zasiew `[]` z `updatedAt: 0` powstaje tylko wtedy, gdy projekcja obecności faktycznie zwróciła
  „brak”. Wyjątek dla „każdego stanu” tego klucza nie ukrywa więc awarii: błędny odczyt w ogóle nie zostawia
  wpisu.
- Testy są behawioralne:
  - pozytywny: identyczny zapis daje `complete:true`, a przesłanka `status/dataUpdatedAt/fetchStatus` jest
    sprawdzona;
  - kontrola negatywna: ta sama pusta lista pod `global-widgets` daje `seed:`.
- Uwaga poboczna o scaleniu z P3.8: na ścieżce po terminie zasiew `setQueryData` z `warmLate` powstaje po
  dehydratacji. Nie ma obietnicy, więc integracja go nie strumieniuje. Klient montuje `PopupHost` jak w bazie.
  To nieszkodliwe.

### m2: archiwum na terminie treści. Naprawione

- `index.tsx:202-207`: `deadlineAt: contentDeadlineAt`. Na kliencie obie zmienne są `undefined`, więc
  zachowanie SPA się nie zmienia.
- Termin treści liczy ten sam zegar żądania, więc łączny sufit pozostaje 1 200 ms od startu.
- Testy z fałszywym zegarem obejmują listę po 900 ms (prawdziwa, `s-maxage=900`) oraz listę po 5 s (zasiew
  dokładnie w `homeContentDeadline`, `private, no-store`).
- Odstępstwo od tekstu R3a opisuje m-b.

### m3: jedna lista pracy chrome. Naprawione

Odpowiada propozycji. Dryf `warmLate` wobec `warm` jest zamknięty.

### m5: komentarz `queryLabel`. Naprawione

Komentarz opisuje teraz faktyczne zachowanie, a test `public-profile.jan-kowalski` je przypina.

### m4: granica puszcza na `ready()`. Naprawione mechanicznie, ale z regresem (M1 niżej)

## 3. Bramki uruchomione w tej recenzji

Logi są w `phase3/wave3/P3.6b/review3/`.

| bramka                                                                                                       | wynik                                                                                        |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `light.sh bunx eslint` (20 plików diffu)                                                                     | 0 błędów, 4 ostrzeżenia `react-refresh/only-export-components` (te same eksporty co w bazie) |
| `bunx prettier --check` (20 plików)                                                                          | OK                                                                                           |
| `light.sh bunx vitest run` (11 plików testów z diffu + `documentCache.server.test.ts` + `queryKeys.test.ts`) | 13/13 plików, 465/465 testów                                                                 |
| `light.sh bun run verify:static`                                                                             | 15 bramek OK w 216,7 s, exit 0                                                               |
| typecheck, build, bramki artefaktu, e2e, Lighthouse                                                          | nieuruchamiane (zgodnie z zadaniem)                                                          |
| `check:ssr-budgets`, `check:loader-policy`                                                                   | nie istnieją od PR #475, pominięte                                                           |

## 4. Ustalenia

### M1 (major): `lateWarm` puszcza granicę nagłówka przy wiszącej reklamie. Baner strumieniuje się po HTML-u nagłówka, co daje niezgodność hydratacji i skok ~90 px, a dokument trafia do magazynu

- **Miejsce:**
  - `src/lib/ssr/chromeWarmup.tsx:83-96` (`Promise.race([work, ready])`);
  - komentarz `:77-81`;
  - `src/routes/__root.tsx:1082-1095`: usunięte zdanie „reklama jak w `warm`, bo `HeaderSkeleton` rezerwuje jej
    wysokość z tego wpisu”;
  - test, który utrwala to zachowanie: `src/routes/__tests__/rootRoute.test.tsx` („…releases on ready data”,
    asercja `fetchStatus: "fetching"` reklamy po zwolnieniu granicy);
  - test w `platformChromeWarmup.test.tsx` („wolna dekoracja jej nie trzyma”).
- **Dowód (łańcuch):**
  1. Na ścieżce po terminie `warmLate` startuje w trakcie renderu, z bramki, czyli po `dehydrate()`.
     `ensureQueryData(headerAds)` nie jest więc objęte zamiataniem (`postRenderSweep` działa przed renderem).
  2. Po `37220be7` granica puszcza, gdy tylko menu, ticker i widgety nagłówka i stopki są gotowe. Reklama dalej
     leci (`withBudget` ogranicza tylko czas czekania, nie samo zapytanie).
  3. Nagłówek renderuje się na serwerze z `AdZone` → `useAdPlacements` → `useQuery` bez suspense. Danych nie ma,
     więc `return null` (`AdSlot.tsx:181-182`). Baner nie trafia do HTML-a.
  4. `router-ssr-query-core` (`dist/esm/index.js`, subskrypcja `QueryCache` po `isDehydrated()`) strumieniuje
     każde zapytanie z `promise`, które pojawi się po dehydratacji. Reklama jedzie więc do klienta strumieniem
     zapytań i trafia do cache'u klienta przez `router.options.hydrate`.
  5. Na `/` boot rusza po LCP, więc strumień zwykle dochodzi przed `hydrateRoot`. `useQuery` czyta wtedy dane
     także jako `getServerSnapshot` i `AdZone` renderuje baner. HTML serwera go nie ma. React 19 zgłasza
     niezgodność hydratacji w granicy nagłówka i renderuje ją od nowa po stronie klienta. Baner `header_banner`
     wskakuje nad sticky bar i treść: ok. 90 px, ~0,11 CLS. To dokładnie pozycja F26 z audytu 2026-09-20, czyli
     powód, dla którego reklama w ogóle jest w fali chrome.
  6. P3.6b zapisuje taki dokument. Reklama jest w `DECORATIVE_QUERY_ROOTS`, więc predykat zwraca `complete`,
     a nagłówek wyszedł jako `chrome` (`s-maxage=30`). Wpis ma krótką świeżość, ale STALE trwa dobę, a
     odświeżenie w tle przechodzi tę samą ścieżkę. Każdy czytelnik HIT-u dostaje ten sam skok i ten sam błąd
     hydratacji (dodatkowy render nagłówka w oknie TBT).
- **Co się zmieniło względem rundy 9 i bazy:**
  - W rundzie 9 `lateWarm` czekało na całe `work`, a reklama była w nim ograniczona budżetem 1,2 s. Gdy reklama
    zdążyła w budżecie (typowy przypadek: siedzi za tym samym `edgeTtlCache` co ticker), była w HTML-u.
  - W bazie gałąź po terminie dawała od razu `failed` i `no-store`. Takiego dokumentu nikt nie zapisywał.
  - Teraz okno „reklama wolniejsza od menu i tickera, ale zdąży przed końcem strumienia” daje dokument
    niezgodny i zapisany.
  - Twierdzenie z komentarza („jak na zwykłej ścieżce, gdzie bramka z gotowymi danymi w ogóle nie czeka”) jest
    prawdziwe tylko dla przypadku „gotowe przy pierwszym odczycie”. Tam reklama z loadera jest zamieciona przed
    renderem i nie strumieniuje się, więc niezgodności nie ma. Gdy dane NIE są gotowe przy pierwszym odczycie,
    zwykła ścieżka (`record.warm()`) czeka na całą falę razem z reklamą w budżecie. Doktryna bazy to „bramka
    czeka na reklamę w budżecie fali”.
- **Zakres skutku:** dotyczy najemcy ze sprzedaną emisją `header_banner` na `home` i renderów `/` po wygasłym
  terminie (zimny lub wolny backend, także odświeżenie w tle). Plan R2c obiecuje dla takich renderów „usuwa późne
  wskakiwanie tickera (CLS)”, a ta zmiana dodaje późne wskakiwanie banera.
- **Poprawka (preferowana, tania):** cofnąć tylko część m4.
  - `lateWarm` znów zwraca `record.warmLate(remaining)`. Praca jest ograniczona `withBudget(…, budgetMs)` po
    stronie korzenia, więc granica czeka najwyżej do końca budżetu bramki, jak w rundzie 9.
  - Przywrócić zdanie o reklamie i `HeaderSkeleton` w komentarzu `warmLate`.
  - Wspólne fabryki z m3 zostają.
  - Testy: odwrócić dwa nowe testy na zachowanie oczekiwane. Reklama, która dochodzi w budżecie, jest w cache'u
    w chwili zwolnienia granicy (`status: "success"`). Reklama wisząca dłużej niż budżet nie trzyma granicy
    ponad `HOME_CHROME_LATE_BUDGET_MS`.
- **Alternatywa (jeśli orkiestrator chce zachować wcześniejsze zwolnienie):** po wygraniu wyścigu przez `ready()`
  anulować zapytanie reklamy, które jeszcze leci:
  `client.cancelQueries({ queryKey: headerAds.queryKey }, { revert: true, silent: true })`. Taki wariant wymaga
  przekazania klucza przez `ChromeWarmup`. Daje parytet z przypadkiem „gotowe przy pierwszym odczycie”, czyli
  baner tylko z klienta, bez niezgodności hydratacji. Skok banera po boocie zostaje jednak jak w bazie. Do tego
  test, że reklama nie jest w stanie `fetching` po zwolnieniu granicy.

### m-a (minor): edycja `__root.tsx` wychodzi o trzy linie poza gałąź `expired()`

- **Miejsce:** `src/routes/__root.tsx:1001`, `:1035`, `:1064-1066`.
- **Dowód:** notatki pozwalają P3.6b zmieniać tylko ścieżkę chrome po terminie i listę celowych zasiewów. Zmiany
  są równoważne dla `warm` (sekcja 1), zgłoszone w IMPL-fix1 §4, a `merge-tree` z P3.8 i P3.3 jest czysty.
- **Poprawka:** bez zmian w kodzie. Orkiestrator potwierdza przy scaleniu. Gdyby cofał hunk, musi dopisać
  `warmNoActivePopupsOnServer` także do `warmLate`.

### m-b (minor): archiwum na terminie treści wychodzi poza literę R3a

- **Miejsce:** `src/routes/index.tsx:199-207`.
- **Dowód:** R3a (`cache-dokumentu.md` §R3a) wymienia `home.page` i `home.mode` i mówi „widgety i chrome zostają
  przy 600 ms”. O archiwum nie wspomina. Zmianę zaproponował recenzent rundy 9 (m2) i jest ona uzasadniona w
  komentarzu: w trybie „najnowsze wpisy” archiwum jest treścią. Koszt to zimny MISS w tym trybie z TTFB do
  +0,6 s przy spóźnionej liście. Produkcja jest dziś w trybie strony statycznej.
- **Poprawka:** bez zmian w kodzie. Wpisać jako nazwane odstępstwo w raporcie partii.

### m-c (minor): bajty bootu po rundzie 9 i po `37220be7` nadal niezmierzone

- **Miejsce:**
  - `src/lib/ssr/resilientLoad.ts:60` i `:213-216`: nowy import `WIDGET_QUERY_ROOTS` do modułu z chunku
    wejściowego. `Set` znika tylko wtedy, gdy Rollup uzna `WIDGET_QUERY_ROOTS.popupsActive` za odczyt bez
    efektów ubocznych;
  - `__root.tsx` (parametr fabryki).
- **Dowód:** `queryKeys.ts` już jest w `index-c_XR_U82.js` bazy, co sprawdziłem w `base-w3b/.output`. Koszt
  najgorszego przypadku to kilkadziesiąt bajtów. Zapas `bootClosureGzipBytes` i `bootBurstGzipBytes` wynosi
  jednak ok. 0,6 KB.
- **Poprawka:** w re-Prove sprawdzić `check:document-weight` i linię `Boot closure` w `check:bundle` (cel: baza
  1 636 946 B raw / 496 041 B gz, ± kilkadziesiąt B). Dodatkowo sprawdzić, że `ad_placements` w chunku wejściowym
  występuje tyle samo razy co w bazie.

### m-d (minor): komentarz `lateWarm` opisuje zwykłą ścieżkę nieprecyzyjnie

- **Miejsce:** `src/lib/ssr/chromeWarmup.tsx:77-81`.
- **Dowód:** zob. M1. Zwykła ścieżka z niegotowymi danymi czeka na całą falę razem z reklamą.
- **Poprawka:** znika razem z poprawką M1. W wariancie alternatywnym trzeba poprawić treść komentarza.

## 5. Hydratacja, SEO, a11y, CLS, Lantern, użytkownicy

- **Hydratacja:** poza M1 bez zmian względem rundy 9. `warmLate` i predykat są tylko serwerowe.
- **CLS:** M1 to jedyna nowa późna zmiana wizualna. Ticker i menu dostrumieniowują się przed hydratacją, tak jak
  w rundzie 9.
- **Lantern i SI:** kod klienta jest bez zmian, więc zysk jest produkcyjny (zapis MISS-ów B1/B2 do L1/L2). W
  laboratorium (HIT L1) nie ma różnicy.
- **SEO:** bez zmian. Boty dostają `allReady`, linki i meta są nietknięte.
- **Zalogowani i redakcja:** BYPASS, predykat nieczytany. Bez zmian.
- **`/en`:** ta sama ścieżka co `/` po rewricie. Bez zmian.
- **Prywatność:** etykiety `degradedBy` z zamkniętego alfabetu. `queryLabel` udokumentowane (m5).

## 6. Przed scaleniem

1. M1: cofnąć część m4 (`lateWarm` czeka na `work` ograniczone budżetem) i odwrócić dwa testy. Alternatywnie
   anulować reklamę po wyścigu i dodać test.
2. Re-Prove: `check:document-weight`, `check:bundle` (m-c), smoke B1/B2 i typ A na artefakcie.
3. Po scaleniu partii 2: sonda `base-probe/probe.sh artifact-boot` (MISS z pełną polityką, potem HIT z przebiegu
   czytelnika) i `slow-first-fold` (B2 zapisany).
