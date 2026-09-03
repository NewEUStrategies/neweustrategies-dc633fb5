# ZADANIE: domknąć drogę krytyczną pierwszego wczytania i pokrycie warstwy SSR

Wejście: audyt pokrycia testami, wydanie 9 (`docs/AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md`,
rozdz. 8.6). Ocena obszaru: **72,0 / 100 - „przeciętnie", najbardziej rozjechana ocena w całym
zestawieniu.** Infrastruktura jest powyżej normy tej klasy; drogi krytycznej nie chroni nic.

**Zlecenie jest WĄSKIE i to jest jego najważniejsza cecha.** Jedenastopunktowa lista naprawcza
z wydania 8 została w większości wykonana - siedem punktów jest zamkniętych, dwa rozstrzygnięte
decyzją zapisaną w kodzie. Nie powtarzaj tej pracy. Sekcja 0 mówi, co JEST zrobione, i jest
obowiązkowa do przeczytania: zlecenie powtarzające zrobioną pracę jest gorsze niż jego brak.

---

# 0. Co jest ustalone. Przeczytaj to, zanim cokolwiek zmienisz

**Dwie fale rozgrzewki korzenia są ROZDZIELONE i mają osobne budżety.** Fala 1 (`__root.tsx:373-380`)

- `siteSettings`, `designTokens`, `globalColors` - `await withBudget(..., ROOT_WARM_BUDGET_MS)`,
  gdzie `ROOT_WARM_BUDGET_MS = 2_500` (`__root.tsx:78`, dziś eksportowana). Fala 2, dekoracja powłoki
  (ticker, menu, widgety headera i stopki) - `await withBudget(Promise.allSettled(chromeWarm),
CHROME_WARM_BUDGET_MS)` (`__root.tsx:508`), gdzie `CHROME_WARM_BUDGET_MS = 500` (`__root.tsx:100`).
  **Maksymalny sekwencyjny budżet przed pierwszym bajtem to dziś 3 000 ms, nie „do 11 s".** Fala 1
  zeszła też z trzech równoległych podżądań na dwa (dedup `fetchSiteDesignTokensRow` przez wspólny
  `edgeTtlCache`, opisany w komentarzu `__root.tsx:363-372`). Nie ruszaj tego bez pomiaru.

**Prefetch strony głównej jest ZDJĘTY z drogi krytycznej.** `src/routes/index.tsx:184-198`
dokumentuje, co było wcześniej: serwer wołał tam `prefetchCachedRouteQueries` z budżetem 6 000 ms.
Dziś **nie woła go wcale**, a `HomeBuilderContent` przekazuje prop `stream`, więc powłoka flushuje
się przed rozstrzygnięciem sekcji. Stała `CACHED_ROUTE_PREFETCH_BUDGET_MS` **nie istnieje w repo**;
`prefetchCachedRouteQueries` (`src/lib/builder/prefetch.ts:650-655`) przyjmuje `budgetMs` jako
**wymagany** czwarty argument i ma dziś dokładnie dwóch wołaczy, oba w fali 2 (`__root.tsx:489`,
`:499`), oba z budżetem 500 ms.

**Opt-out `no-store` dla renderów zdegradowanych DZIAŁA i ma własny moduł.**
`src/lib/http/responseHeaders.ts` istnieje po to, żeby decyzja loadera „ten render jest
zdegradowany" przeszła do middleware - komentarz w :27-29 nazwa defekt, który to naprawia
(„pustą powłokę do L1/L2 na 24 h", a czytelnik dostawał `private, no-store`).
`src/lib/http/cachePolicy.ts:25` zwraca `private, no-store` dla nieca­che'owalnych odpowiedzi
i ma test (`cachePolicy.test.ts`). Drugi martwy opt-out zamknął commit `2e3408780`:
opt-out trasy wyprzedza status i typ treści.

**Preload słownika aktywnego języka jest zrobiony - nagłówkiem HTTP, nie węzłem `<head>`.**
`responseLinkHeader` (`src/server.ts:39-40`), a nagłówek `Link` renderu jest **utrwalany w obu
poziomach cache'u** (`src/lib/http/documentCache.server.ts:92`,
`src/lib/http/documentCacheL2.server.ts:42`), więc działa też na HIT.

**Drugi argument `handler.fetch` jest rozstrzygnięty decyzją, nie zapomniany.**
`src/server.ts:121-156` opisuje kontrakt czterech pól (`context` / `inlineCss` / `onEarlyHints` /
`responseLinkHeader`) i uzasadnia, dlaczego `inlineCss` jest w tym buildzie no-opem
(`server.build.inlineCss` domyślnie `false`, zbudowany manifest nie ma ani jednego wpisu).
Jeśli chcesz to zmienić, musisz najpierw obalić ten zapis pomiarem.

**Bramka rozmiaru liczy dziś `.css` i domknięcie startowe.** `scripts/check-bundle-size.ts`
ma pięć zamrożonych podłóg (`FROZEN_BUDGET_KB`, :1151): `chunk: 280`, `public: 2715`,
`overall: 4351`, **`css: 82`**, **`boot: 579`**. Nadpisania środowiskowe są w CI **IGNOROWANE**
(`budget()`, :1231-1248) - „bramka, którą wolno rozluźnić jedną zmienną w workflow, nie jest
bramką". Komentarz :790 zapisuje starą wadę: `walkJs()` zbierał wyłącznie `.js`, więc arkusz
nie wchodził do żadnego budżetu.

**Czas w renderze ma wymuszoną strefę.** `src/lib/i18n/format.ts:89` wstrzykuje
`timeZone: SITE_TIME_ZONE`, gdy wywołujący jej nie podał - czyli klasa „inny wynik na serwerze
i na kliencie" jest domknięta w miejscu, przez które przechodzi każda data z godziną.

**Boot-test na artefakcie produkcyjnym BIEGNIE W CI I MA TWARDE ASERCJE.** Dwa specy -
`e2e/boot-artifact.spec.ts` (czy artefakt żyje po hydratacji) i `e2e/boot-timing.spec.ts`
(ile to kosztuje) - jadą przez `playwright.artifact.config.ts` po **zbudowanym** artefakcie
(preset `node-server`, `node .output/server/index.mjs`), wołane krokiem `bun run test:e2e:artifact`
w `.github/workflows/ci.yml:921`, bez `continue-on-error`. Progi są **twardymi** `expect`:
`MAX_TTFB_MS = 8_000` (:105, asercja :379), `MAX_READY_MS = 6_000` (:127, asercja :390),
`MAX_BOOT_JS_TRANSFER_KB = 3_000` (:171, asercja :403).

**Istnieje PIERWSZY ZAPISANY POMIAR Z RUNNERA** (`boot-timing.spec.ts:177-190`, 2026-09-01,
przebieg 33512138238, job `build`, head `71b5dc8`):

```
[boot-timing] TTFB=5030.1ms ready=356ms (exact=true)
              bootJS=2562.8KB/66 (statyczne 1982.3KB/12 + dynamiczne 580.5KB/54)
              decoded=2543.5KB (x0.99) FCP=5272.0ms
```

Komentarz notuje też wniosek, którego nie da się zgadnąć: **runner jest SZYBSZY od hosta**
(ready 356 ms wobec 461-616 ms), i właśnie dlatego transfer bootu wyszedł wyżej - szybsza
maszyna zdąża dociągnąć więcej leniwych chunków przed flagą gotowości, więc ta metryka rośnie
ze **szybkością maszyny**, nie z wagą artefaktu. Nie zacieśniaj `MAX_BOOT_JS_TRANSFER_KB`;
wagi artefaktu pilnuje podłoga `boot` w bramce bundla.

**Pokrycie dwóch plików, które posiadają wszystkie budżety, ruszyło z zera.** `src/router.tsx`:
**32/32 linii i 11/11 funkcji** (było 0 z 38 i zero importujących testów). `src/routes/__root.tsx`:
**67/128 linii (52,34%) i 7/48 funkcji (14,58%)**. Razem 40 przypadków w trzech plikach:
`src/__tests__/router.test.tsx`, `src/routes/__tests__/rootRoute.test.tsx`,
`src/routes/__tests__/rootShellRender.test.tsx`. Oba pliki mają własne progi per-ścieżka.

**Cztery powierzchnie publiczne, które w SSR nie oddawały treści, mają dowód wykonawczy.**
`src/routes/__tests__/publicSurfacesSsrContent.test.tsx` - 8 przypadków przez `renderToString`,
z nagłówkiem, który prostuje mechanikę: `isLoading` jest w SSR `false` **wyłącznie** dla zapytania
z `enabled: false`; przy `enabled: true` wychodzi gałąź ładowania. Klasa defektu jest w obu
wariantach ta sama (HTML bez treści wchodzi do cache brzegowego na do 24 h), więc plik mierzy
jedyne, co ma znaczenie: **czy w wyjściu serwera JEST TREŚĆ**.

---

# CZĘŚĆ A - DROGA KRYTYCZNA (P1)

Cztery pozycje. Kolejność nie jest sugestią: pozycja A1 odblokowuje pomiar dla A2, a A3 musi
wejść przed jakimkolwiek dalszym skracaniem budżetów.

## A1. Odpiąć bezwarunkowe `describe.skip` na `RootComponent`

**To jedyne bezwarunkowe pominięcie w całym repozytorium** i regres wobec zapisu wydań 4-8
(„zero bezwarunkowych pominięć"). Siedzi w
`src/routes/__tests__/rootShellRender.test.tsx:91`, na `RootComponent` - czyli na korzeniu
całej aplikacji.

**Dzisiejsza cena tego jednego wiersza, zmierzona z `coverage-ed9-final/coverage-final.json`:**
`__root.tsx` ma **41 z 48 funkcji bez ani jednego wywołania**, a wśród nich wszystkie funkcje
korzenia od `RootComponent` (:582) w dół - siedemnaście domknięć renderu (:591, :597, :598,
:602, :609, :616, :633, :641, :642, :651, :660, :661, :673, :674, :679, :692) - plus
`ErrorComponent` (:178), `RouteLoadingSkeleton` (:187) i `GlobalAudioBarGate` (:163).

Zadanie:

1. Przeczytaj komentarz przy pominięciu i komunikat commitu `08d4cdbaa`. Ustal, **co dokładnie**
   blokuje uruchomienie tego bloku. Nie zgaduj - jeśli powód jest zapisany, zacytuj go w PR.
2. Odpiąć **bez zmiany kodu produkcyjnego**. Jeśli to niemożliwe, zatrzymaj się i zgłoś, co
   konkretnie i dlaczego - z propozycją najmniejszej zmiany produkcyjnej i jej ceną. Nie
   przepisuj korzenia, żeby test przeszedł.
3. Wzorzec masz w tym samym pliku: `shellComponent` z `Route.options` renderowany przez
   `renderToStaticMarkup` - **ta sama droga, którą idzie SSR** - z asercją, że wychodzi pełny
   dokument (`<html lang=`, `<head>`, `<body>`).

**Kryterium odbioru:** zero bezwarunkowych `describe.skip`/`it.skip`/`it.todo` w `src`, `e2e`
i `e2e-ab` (sprawdzalne jednym wyrażeniem); `__root.tsx` na **co najmniej 80% funkcji**
(dziś 14,58%) i **85% linii** (dziś 52,34%); próg per-ścieżka na `src/routes/__root.tsx`
podniesiony do „zmierzone minus 2 pp" z komentarzem podającym pomiar i datę.

## A2. Postawić próg na FCP - jedyna metryka pierwszego wczytania bez sufitu

Pomiar z runnera podaje **FCP 5 272,0 ms**, a w kolumnie „PRÓG" stoi **`brak`**
(`e2e/boot-timing.spec.ts:189`). To metryka, którą czytelnik odczuwa jako „strona się pojawiła",
i jedyna z czterech, która nie ma asercji.

Zadanie:

1. Dołożyć `MAX_FCP_MS` obok trzech istniejących progów, z **twardą** asercją w tym samym
   kształcie co `MAX_TTFB_MS` (`:379`) - komunikat błędu ma podawać zmierzoną wartość i próg.
2. Wartość ustawić regułą tego pliku, nie „na oko": progi tu wolno **wyłącznie obniżać** po
   pomiarze na runnerze, a podniesienie wymaga wpisu w kronice komentarza. Przy pomiarze
   5 272 ms i krotnościach zapasu, jakie plik stosuje dla pozostałych metryk (1,17x-16,9x),
   uzasadnij wybraną liczbę arytmetycznie w komentarzu.
3. Przy okazji rozstrzygnij **TTFB**: 5 030,1 ms przy progu 8 000 to zapas 1,59x, ale sama
   wartość bezwzględna jest wysoka dla dokumentu, którego cache brzegowy powinien oddawać
   z HIT-a. Zmierz TTFB **osobno na HIT i na MISS** (spec dziś tego nie rozdziela) i podaj
   obie liczby. Jeśli HIT jest o rząd niższy, próg zbiorczy 8 000 mierzy wyłącznie MISS i to
   trzeba nazwać w komentarzu; jeśli HIT jest podobny, cache dokumentów nie działa tak, jak
   opisuje go `documentCache.ts`, i to jest znalezisko wagi blokującej.

**Kryterium odbioru:** `boot-timing.spec.ts` ma cztery twarde progi zamiast trzech; kronika
komentarza ma wpis z datą, zmierzoną wartością FCP i uzasadnieniem progu; TTFB podany rozdzielnie
dla HIT i MISS, z liczbami w komentarzu.

## A3. Rozbić arkusz - podłoga `css` ma dziś 3,4% zapasu

Zmierzone na zbudowanym artefakcie w `.output/`:

| plik                          |    surowo |            gzip -9 |
| ----------------------------- | --------: | -----------------: |
| `styles-*.css`                | 570 419 B |       **79 819 B** |
| `BlocksRenderer-*.css`        |   5 321 B |            1 431 B |
| **razem**                     |           |       **79,2 KiB** |
| podłoga `css` w bramce bundla |           |         **82 KiB** |
| **zapas**                     |           | **2,8 KiB (3,4%)** |

Arkusz ma **6 739 bloków reguł** (`grep -o "{" | wc -l` na zbudowanym pliku), źródło
`src/styles.css` to 280 137 B w 8 817 wierszach. **To najciaśniejsza podłoga w repozytorium:
jedna średnia zmiana designu ją przebije** - i wtedy albo bramka zapala się na czerwono, albo
ktoś podniesie próg, co jest wprost zakazane.

Zadanie, w kolejności taniości:

1. **Zmierz, co jest w arkuszu.** Podaj rozkład bajtów po źródłach `@source` - ile wnosi
   powierzchnia publiczna, ile panel admina, ile builder. Bez tej liczby cięcie jest zgadywaniem.
2. **Wyciąć panel i buildera do osobnego arkusza**, ładowanego tylko na trasach panelu. To punkt
   5(b) z wydania 8, jedyny z tego punktu, który został. Powierzchnia publiczna nie ma prawa
   pobierać CSS-a panelu, którego nigdy nie zobaczy.
3. **Nie ruszaj podłogi `css` w górę.** Po cięciu podłogę **obniż** do „zmierzone plus ~2 KiB",
   z komentarzem podającym pomiar - tak jak robią to istniejące wpisy w `FROZEN_BUDGET_KB`.
4. Jeśli cięcie jest niewykonalne bez zmiany architektury stylów, **zatrzymaj się i zgłoś to
   z liczbami** zamiast obniżać ambicję. Rozstrzygnięcie „nie da się" też jest wynikiem, ale
   musi być poparte rozkładem z punktu 1.

**Kryterium odbioru:** powierzchnia publiczna pobiera arkusz mniejszy o **co najmniej 25% gzip**
niż dziś; podłoga `css` **obniżona**, nie podniesiona; `bun run check:bundle` zielony;
test bramki potwierdza, że nowy arkusz panelu **nie** wchodzi do domknięcia publicznego.

## A4. Bramka na budżety WEWNĘTRZNE - trzy liczby, których nie pilnuje nic

Sprostowanie do rozdz. 8.6, żeby zlecenie stało na prawdzie: **nieprawdą jest, że „nie ma ANI
JEDNEJ bramki na budżety SSR"** - `boot-timing.spec.ts` jest twardą bramką czasu na artefakcie
(A2 ją rozszerza). Prawdą jest twierdzenie węższe: **żaden budżet WEWNĘTRZNY potoku nie ma
zabezpieczenia.** Trzy konkretnie:

1. **Suma budżetów rozgrzewki przed pierwszym bajtem.** Dziś 3 000 ms
   (`ROOT_WARM_BUDGET_MS` 2 500 + `CHROME_WARM_BUDGET_MS` 500). Nic nie broni przed tym, żeby
   ktoś dołożył trzecią falę albo podniósł stałą - a to jedna liczba w jednym pliku.
2. **Liczba równoległych podżądań w loaderze.** Runtime Cloudflare Workers ma limit **6
   równoległych subrequestów na żądanie**, a audyt wydania 9 ustalił, że w repozytorium ta liczba
   występuje **wyłącznie jako komentarz** - żadnego limitera, semafora ani batcha.
   **Sprawdź to samodzielnie i podaj wynik**; jeśli się potwierdzi, policz też, ile tras
   przekracza 6 zapytań w loaderze.
3. **Rozmiar dehydratowanego stanu.** Wstrzykiwany do HTML-a przy każdym renderze; nigdzie
   nie mierzony ani nie ograniczany.

Zadanie: dołożyć **jedną** bramkę statyczną, która pilnuje wszystkich trzech naraz - czyta źródła,
a nie zbudowany artefakt, więc jest tania i biegnie w jobie `verify`.

Wzorzec bierz z bramek, które już to robią dobrze: `scripts/check-bundle-size.ts` (zamrożone
podłogi + ignorowanie nadpisań w CI) i którakolwiek z bramek katalogu `src/lib/ci/__tests__`.
Nowa bramka musi mieć:

- **zamrożoną podłogę w kodzie**, nie w zmiennej środowiskowej;
- **własny test jednostkowy z KONTROLĄ NEGATYWNĄ** - test dowodzący, że bramka **oblewa** na
  zepsutym wejściu. Bramka bez kontroli negatywnej to bramka, o której nie wiadomo, czy działa;
- wpis w `package.json` i krok w `.github/workflows/ci.yml` **bez** `continue-on-error`;
- komunikat, który mówi, **co** przekroczono i **o ile**, nie „budżet przekroczony".

**Kryterium odbioru:** `bun run check:<nazwa>` zielony na tym HEAD i czerwony po sztucznym
podniesieniu `ROOT_WARM_BUDGET_MS` o 1 ms (pokaż oba przebiegi w PR); `check:gate-coverage`
zielony, czyli bramka jest realnie wpięta; test kontroli negatywnej w suicie.

---

# CZĘŚĆ B - POKRYCIE WARSTWY

## B1. `src/routes/__root.tsx` - 41 z 48 funkcji bez wywołania

Zamyka się w większości przez A1. Po odpięciu pominięcia zmierz ponownie i dołóż testy na to,
co zostanie. Wymagana **nazwana lista** w PR: która funkcja z których wierszy została i dlaczego.

## B2. Trzy pliki, których pokrycie jest NIEDETERMINISTYCZNE

Wydanie 9 zmierzyło szum własny pomiaru na dwóch pełnych przebiegach tego samego HEAD i pięć
plików z 3 304 dało różny wynik. **Trzy z nich są w tej warstwie:**

| plik                                      | linie    | funkcje  | gałęzie  |
| ----------------------------------------- | -------- | -------- | -------- |
| `src/lib/ssrCache.ts`                     | 49 -> 48 | 10 -> 9  | 29 -> 29 |
| `src/lib/icons/DynamicIconFull.tsx`       | 12 -> 12 | 4 -> 4   | 7 -> 9   |
| `src/components/blocks/LiveBlogBlock.tsx` | 51 -> 51 | 20 -> 21 | 46 -> 50 |

Każdy z nich znaczy to samo: **test tego pliku wykonuje różny zbiór gałęzi w różnych przebiegach**
(cache z TTL, import dynamiczny, odpytywanie w interwale). Żaden nie jest dziś czerwony i żaden
nie łamie progu, ale każdy jest kandydatem na próg, który zapali się bez żadnej zmiany w kodzie.

Zadanie: dla `src/lib/ssrCache.ts` (jedyny z tych trzech na drodze krytycznej) **usunąć
niedeterminizm z testu** - wstrzyknąć zegar zamiast czekać na TTL. Dla dwóch pozostałych
wystarczy zarejestrować ustalenie komentarzem przy progu, żeby następna osoba nie ścigała
fantoma.

**Kryterium odbioru:** `src/lib/ssrCache.ts` daje identyczne liczby pokrycia w dwóch kolejnych
przebiegach samego swojego pliku testowego (pokaż oba w PR).

## B3. Detektor niezgodności hydratacji - rozstrzygnij, nie przemilcz

Commit `2fa8eb826` nazywa się „Boot-test na artefakcie produkcyjnym i **detekcja martwej
hydratacji**". Audyt wydania 8 twierdzi natomiast, że detektora **niezgodności** hydratacji
(mismatch) nie ma w repozytorium wcale. **To dwie różne rzeczy:** martwa hydratacja to „strona
się nie uruchomiła", niezgodność to „uruchomiła się, ale React przerysował HTML z serwera".

Zadanie: ustal, który z tych dwóch detektorów istnieje. Jeśli brakuje detektora niezgodności -
dołóż najmniejszy możliwy: nasłuch `onRecoverableError` albo `console.error` w specu artefaktowym,
z asercją na zero wystąpień. `boot-artifact.spec.ts:422` ma już wzorzec
(`expect(errors, errors.join(" | ")).toHaveLength(0)`) - użyj go, nie pisz własnego.

**Kryterium odbioru:** jednoznaczna odpowiedź w PR („istnieje / nie istnieje", z plikiem i linią),
a przy braku - detektor z asercją i jeden test dowodzący, że **łapie** wstrzykniętą niezgodność.

---

# JAK MIERZYĆ - bez tego żadne kryterium odbioru nie jest sprawdzalne

**Czas i waga: WYŁĄCZNIE na zbudowanym artefakcie.** Dev-server do tego nie służy i pomiar z niego
nie ma prawa wejść do progu.

```bash
bun run build:smoke          # artefakt presetu node-server (vite.smoke.config.ts)
bun run test:e2e:artifact    # boot-artifact + boot-timing, port 4181, twarde progi
bun run check:bundle         # pięć podłóg: chunk / public / overall / css / boot
```

**Pokrycie: pojedyncze pliki, nie cała suita.** Pełny przebieg trwa ~36 minut. Reporter `json`
nie jest w konfiguracji, więc nazwy niewywołanych funkcji wymagają dołożenia go z wiersza poleceń:

```bash
npx vitest run src/routes/__tests__/rootShellRender.test.tsx src/routes/__tests__/rootRoute.test.tsx src/__tests__/router.test.tsx
npx vitest run --coverage --coverage.reporter=json --coverage.reporter=json-summary <pliki>
```

**Pomiar wyjściowy jest już w repozytorium i nie trzeba go powtarzać:**
`coverage-ed9/coverage-summary.json` (per plik) i `coverage-ed9-final/coverage-final.json`
(mapy `fnMap` i liczniki `f`, czyli nazwy funkcji bez wywołania).

**Stan wyjściowy CI, który MUSISZ znać przed startem:** na tym HEAD bramka `check:ci-gates`
jest **czerwona** - 45 plików, 863 testy, jedno padnięcie na ratchecie tekstu jednojęzycznego
(`src/routes/admin.analytics.index.tsx:387`, `title="GA4 Looker Studio embed"`). **To nie jest
twoja czerwień i nie masz jej naprawiać**, ale musisz ją odróżnić od własnej. Suita jest też
czerwona w ośmiu plikach (272 testy) z przyczyn opisanych w rozdz. 12.2 audytu - żaden z tych
plików nie należy do tej warstwy.

---

# ZASADY - obowiązują w całości i nie podlegają negocjacji

**Pomiar przed zmianą i po zmianie**

- Każdy punkt ma w nagłówku DZISIEJSZĄ liczbę. Zanim ruszysz punkt, odtwórz ją u siebie.
  Jeśli się nie zgadza - **zatrzymaj się i zgłoś rozbieżność**, nie „popraw pod nią kodu".
  Liczba z audytu może być nieaktualna; wtedy wartościowsze od naprawy jest ustalenie, co ją
  zmieniło.
- Po zmianie podaj tę samą liczbę tą samą metodą. „Powinno być szybciej" nie jest wynikiem odbioru.

**Testy**

- Progi w `vitest.config.ts` wolno **wyłącznie podnosić**: do „zmierzone minus ~2 pp" dla progu
  na jeden plik i „zmierzone minus ~4 pp" dla globa, z komentarzem podającym pomiar i datę -
  tak jak istniejące wpisy. Progi w `boot-timing.spec.ts` wolno **wyłącznie obniżać**, i tylko
  po pomiarze z runnera.
- **Nie wykluczaj plików z pomiaru.** Nie dodawaj `exclude`, nie zmieniaj `all: true`.
- **Nie zmieniaj zachowania produkcyjnego, żeby test przeszedł.** Defekt → `it.fails` z opisem,
  co jest złe i dlaczego. W repozytorium jest dziś 327 takich wpisów w 186 plikach i to jest
  rejestr, nie wstyd. Wyjątkiem są wyłącznie punkty A2, A3 i A4, które jawnie zlecają zmianę.
- **Zamknięcie defektu zdejmuje jego `it.fails` w tym samym commicie.** Wpis, który przestał
  opisywać rzeczywistość, pada - a fałszywa czerwień jest jedyną rzeczą, która potrafi zabić
  prawdziwą.
- Nie regenerujesz snapshotu autoryzacji, żeby zgasić czerwień.
- Żaden test nie wychodzi do sieci i nie zawiera prawdziwego sekretu.
- **Każdy skrypt liczący cokolwiek grepem: `grep -a`.** W repozytorium jest plik testowy z bajtem
  NUL (celowa atrapa poison-null-byte), przez który `grep` bez `-a` uznaje plik za binarny
  i **po cichu zgłasza zero trafień**. To klasa błędu, która nie daje żadnego sygnału.
- **Skrypty liczące wzorce w kodzie muszą wygaszać komentarze i literały napisowe.** Naiwny grep
  po `as any` w plikach ręcznych daje 10 trafień, z których 9 to zdania o tym, że repo `as any`
  nie używa.
- **Nie przypinaj testu do polskiego literału z interfejsu.** W tym oknie taka asercja zgasiła
  188 testów w jednym pliku, kiedy commit zamienił literał paska zapisu na klucz i18n. Pytaj
  o rolę, etykietę dostępną albo klucz - nie o ciąg znaków. Wzorce odporne:
  `adminUsersRoutes.test.tsx:936` (porównanie z kluczem) i
  `adminSettingsAnalyticsRoute.test.tsx:299-313` (zbiór etykiet z `realT("pl")` i `realT("en")`).

**Kod**

- Ekstrakcja zgodnie z atomic design: atoms / molecules / organisms.
- i18n jest częścią definicji ukończenia: każdy nowy napis widoczny dla użytkownika ma klucz
  w PL i EN. `check:i18n-parity`, `check:i18n-key-drift` i `check:i18n-default-value` mają
  zostać zielone.
- **Nie stosuj `any` ani `as any`.** Dziś w 3 305 plikach produkcyjnych jest **zero** `as any`
  i **jedna** adnotacja `: any` - nie dokładaj drugiej. `as unknown as` jest policzone
  (179 w 115 plikach) i objęte progiem; jeśli musisz go użyć, uzasadnij komentarzem, że
  rzutowanie siedzi na realnej granicy.
- **`tenant_id`**: klucz cache'u SSR **musi** zawierać hosta najemcy. Jeśli dotykasz klucza,
  dołóż test, że dwa różne hosty **nie** dzielą wpisu - obszar roboczy jednej firmy nie może
  zaczytać dokumentu wyrenderowanego dla innej. To najcięższa możliwa awaria tej warstwy.
- Zamiast „—" stosuj „-".
- **Nie commituj `package-lock.json`.** `package.json` wolno zmienić wyłącznie o wpis nowej
  bramki z A4. Nie dodawaj zależności.

**Pomocniki, których należy użyć zamiast pisać własne**
`src/test/routeHarness.tsx`, `src/test/renderWithQueryClient.tsx`, `src/test/serverFn*.ts`,
`src/test/axe.ts`, `src/test/i18nReal.ts` (prawdziwe słowniki) i `src/test/i18nStub.ts`
(atrapa zwracająca klucz). Do dowodu wyjścia serwera - `renderToString` /
`renderToStaticMarkup`, tak jak `publicSurfacesSsrContent.test.tsx` i `rootShellRender.test.tsx`;
`render()` z testing-library **tego nie pokaże**, bo efekty montowania wykonują się przed
powrotem z `render`.

---

# CZEGO NIE ROBIĆ - trzy pułapki, każda już raz kosztowała

1. **Nie skracaj budżetu, nie sprawdziwszy najpierw ścieżki degradacji.** Krótszy budżet =
   więcej renderów zdegradowanych. Ten mechanizm jest dziś naprawiony
   (`src/lib/http/responseHeaders.ts`), ale każda zmiana budżetu wymaga potwierdzenia, że
   zdegradowany render **nadal** nie wchodzi do cache'u. Bez tego skrócenie budżetu
   **zwiększa** promień rażenia awarii bazy zamiast go zmniejszać.
2. **Nie mierz czasu na dev-serwerze i nie nazywaj tego pomiarem.** Repozytorium ma na to
   osobną konfigurację (`playwright.artifact.config.ts`) i osobny krok w CI. Historia tej
   warstwy zawiera przypadek, w którym oba specy artefaktowe **pojechały po dev-serwerze
   i padły** (`readyMs` 19 963 ms wobec budżetu 6 000, `staticGraphCount = 0`) - dlatego
   główna konfiguracja ma dziś `testIgnore` na oba, a parytet obu wzorców pilnuje bramka
   jednostkowa.
3. **Nie zamykaj punktu samą stałą.** Stała, której nikt nie woła, albo budżet, którego
   przekroczenie nic nie robi, to nie zabezpieczenie, a napis. Punkt jest zamknięty, gdy
   przekroczenie ma SKUTEK: rzuca, degraduje albo oblewa job. Kontrola negatywna z A4 jest
   po to, żeby to udowodnić.

---

# DEFINICJA UKOŃCZENIA

1. **Zero bezwarunkowych pominięć** w `src`, `e2e`, `e2e-ab` - sprawdzalne jednym wyrażeniem.
2. `src/routes/__root.tsx` na **≥ 80% funkcji i ≥ 85% linii**, z podniesionym progiem
   per-ścieżka i komentarzem podającym pomiar.
3. `boot-timing.spec.ts` ma **cztery** twarde progi (dochodzi FCP), a TTFB jest podany
   rozdzielnie dla HIT i MISS.
4. Powierzchnia publiczna pobiera arkusz **mniejszy o ≥ 25% gzip**, a podłoga `css`
   w `check-bundle-size.ts` jest **obniżona**, nie podniesiona.
5. Jedna nowa bramka pilnuje trzech budżetów wewnętrznych, ma **kontrolę negatywną** i jest
   wpięta w `ci.yml` bez `continue-on-error`; `check:gate-coverage` zielony.
6. `src/lib/ssrCache.ts` daje **identyczne** pokrycie w dwóch kolejnych przebiegach.
7. Rozstrzygnięta obecność detektora **niezgodności** hydratacji; przy braku - dołożony,
   z testem dowodzącym, że łapie wstrzykniętą niezgodność.
8. `bun run check:*` w komplecie zielone **poza** `check:ci-gates`, która była czerwona
   przed twoją pracą i nie należy do tego zlecenia.

**Na koniec zdaj raport:** co zmierzyłeś przed i po (liczba za liczbą, tą samą metodą), które
defekty zarejestrowałeś jako `it.fails` i dlaczego, czego świadomie nie zrobiłeś, oraz - osobno -
**które liczby z tego zlecenia okazały się nieaktualne**. Ta ostatnia lista jest dla audytu
najcenniejsza: wydanie 9 znalazło siedem własnych pomyłek i wszystkie przez sprawdzenie liczby,
nie przez jej przepisanie.
