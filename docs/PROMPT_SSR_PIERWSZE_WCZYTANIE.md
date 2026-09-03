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

**Dwie fale rozgrzewki korzenia są ROZDZIELONE i mają osobne budżety.** Fala 1
(`__root.tsx:373-380`) to `siteSettings`, `designTokens` i `globalColors` pod
`await withBudget(..., ROOT_WARM_BUDGET_MS)`, gdzie `ROOT_WARM_BUDGET_MS = 2_500`
(`__root.tsx:78`, dziś eksportowana). Fala 2 to dekoracja powłoki - ticker, menu, widgety headera
i stopki - pod `await withBudget(Promise.allSettled(chromeWarm), CHROME_WARM_BUDGET_MS)`
(`__root.tsx:508`), gdzie `CHROME_WARM_BUDGET_MS = 500` (`__root.tsx:100`).
**Sufit korzenia to dziś 3 000 ms, nie 5 000 - ale to NIE jest cały budżet przed pierwszym
bajtem, i tę liczbę podałem w pierwszej wersji tego zlecenia błędnie.** Do sufitu korzenia dochodzi
budżet loadera trasy: na stronie głównej `prefetchAboveFoldQueries` z `ABOVE_FOLD_PREFETCH_BUDGET_MS
= 2500` (`src/lib/builder/prefetch.ts:554`, wołane bez jawnego budżetu w `src/routes/index.tsx:215`),
a na trasie treściowej `RESILIENT_LOAD_BUDGET_MS = 4_000` (`src/lib/ssr/resilientLoad.ts:46`).
**Sumy sekwencyjne: `/` = 5 500 ms, trasa odporna = 7 000 ms** - wobec „do 11 s" z wydania 8.

**Drugie sprostowanie do tego akapitu** (dopisane po ręcznym domknięciu wymiaru `bramki`, patrz
§8.7 audytu): 7 000 ms jest poprawne dla RODZINY TRAS ODPORNYCH, ale **nie jest maksimum**.
Trasa łapiąca wszystko - `src/routes/$.tsx`, czyli każda strona CMS-a - niesie w JEDNYM loaderze
trzy budżety szeregowo: `PRIMARY_CONTENT_BUDGET_MS = 5_000` (`:166`, użyta dwa razy - `:239`
i `:360`) plus `SECONDARY_PREFETCH_BUDGET_MS = 3_000` (`:165`, `:353`), czyli
**5 000 + 3 000 + 5 000 = 13 000 ms**. `blog.index.tsx` niesie 4 000 x 2 = 8 000 ms
(`BLOG_LOADER_BUDGET_MS`, `:35`, wołana w `:50` i `:66`). **Pułap pierwszego bajtu dla
dowolnej strony CMS-a to więc 13 000 ms**, i to jest liczba, którą punkt A4 tego zlecenia ma
zabramkować - nie 3 000 ms i nie 7 000 ms.

Fala 1
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
`src/lib/http/cachePolicy.ts:25` zwraca `private, no-store` dla niecache'owalnych odpowiedzi
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

**Dziesięć pozycji, a kolejność nie jest sugestią.** A9 jest **blokująca** i dopisana po ręcznym
domknięciu sześciu wymiarów pomiaru (§8.7 audytu): unieważnia założenie, na którym stoją A4 i B1,
bo najdłuższy odcinek przed pierwszym bajtem nie ma terminu w ogóle. A0 jest defektem poprawności
i wyszła dopiero z pomiaru; A1 odblokowuje pomiar dla B1; A5 i A6 muszą wejść **przed**
jakimkolwiek dalszym skracaniem budżetów, bo dziś nie wiadomo, gdzie te budżety idą.

## A0. Dwa `Date.now()` w ciele renderu wydarzeń - defekt ODBLOKOWANY przez naprawę punktu 4

**To najważniejsza pozycja tego zlecenia i nie było jej na żadnej wcześniejszej liście.**
`src/routes/events.$slug.index.tsx:284` (`const isPast = startsAt.getTime() < Date.now()`)
i `:340` (`const rsvpBeforeOpen = !!rsvpOpensAt && rsvpOpensAt.getTime() > Date.now()`).

Oba wyrażenia istniały przed oknem, ale komponent wychodził w SSR na `if (!eventQ.data) return null`
(`:258`), bo klucz zapytania był **zimny**. **Od naprawy punktu 4 loader powłoki go grzeje, więc to
poddrzewo renderuje się teraz serwerowo** - czyli naprawa wydajnościowa **uaktywniła** uśpiony
defekt klasy „czas w renderze". Klasa jest ta sama, którą punkt 7 domknął w trzynastu miejscach.

Skala: `isPast` steruje **dziewięcioma gałęziami STRUKTURALNYMI** (`:510`, `:515`, `:622`, `:652`,
`:688`, `:696`, `:706`, `:713`, `:721`), a linia `:652` przekazuje go w dół propem, więc gałęzi
w poddrzewie jest więcej. Serwer zawsze liczy w UTC, dokument wchodzi do cache brzegowego
(`contentCacheControl()` - `PUBLIC_CONTENT_S_MAXAGE` / `PUBLIC_CONTENT_SWR`, `cachePolicy.ts:67-72`),
a React 19 przy rozjeździe **struktury** porzuca serwerowe poddrzewo i przerysowuje je na kliencie.

**Naprawa:** oba wyrażenia przechodzą na `useNowMs` (`src/lib/time/useNowMs.ts:29`,
`useNowMs(intervalMs = 0): number | null` - zwraca `null` w SSR i w pierwszym renderze klienta,
czyli wymusza jawną decyzję, co pokazać, gdy czasu jeszcze nie ma).

**Kryterium odbioru:** nowy przypadek w `ssrRenderSafety.test.tsx` dowodzi przez `renderToString`,
że serwerowy HTML wydarzenia **przeszłego i przyszłego jest identyczny** w części sterowanej
`isPast`; kontrola negatywna: cofnięcie zmiany zapala ten jeden przypadek. Koszt: jeden plik.

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

## A3. Rozbić arkusz - podłoga `css` ma dziś 1,25% zapasu

Zmierzone na zbudowanym artefakcie w `.output/`:

| plik                          |    surowo |  gzip TAK JAK BRAMKA |
| ----------------------------- | --------: | -------------------: |
| `styles-*.css`                | 570 419 B |         **81 518 B** |
| `BlocksRenderer-*.css`        |   5 321 B |              1 402 B |
| **razem**                     |           |        **80,98 KiB** |
| podłoga `css` w bramce bundla |           |           **82 KiB** |
| **zapas**                     |           | **1,02 KiB (1,25%)** |

**Sprostowanie do pierwszej wersji tego zlecenia: podałem tu 2,8 KiB (3,4%) i była to liczba
z niewłaściwego poziomu kompresji.** Bramka liczy `Bun.gzipSync(...)` bez argumentu
(`scripts/check-bundle-size.ts:1447`), czyli **poziomem domyślnym**, a ja zmierzyłem `gzip -9`.
Różnica na samym arkuszu to 1 699 B i **całą wielkość marginesu**: prawdziwy zapas jest
**2,7 raza mniejszy**, niż napisałem. To jest dokładnie ta klasa błędu, którą to zlecenie każe
wykrywać - liczba zmierzona inną metodą niż ta, którą mierzy bramka, jest liczbą o czymś innym.

Arkusz ma **6 739 bloków reguł** (`grep -o "{" | wc -l` na zbudowanym pliku), źródło
`src/styles.css` to 280 137 B w 8 817 wierszach. **To najciaśniejsza podłoga w repozytorium
i przy 1,25% zapasu może zapalić się na własnym szumie:** udokumentowana rozbieżność host ↔ runner
wynosi +0,466%, czyli jedną trzecią dostępnego marginesu. Podłoga `boot` (579 KB) ma jeszcze mniej -
**0,64%**. Obie są zmierzone na **hoście**, nie na runnerze, i obie czekają na przefloorowanie.

**Ale priorytet tej pozycji SPADA i trzeba to powiedzieć wprost, bo inaczej zrobisz pracę za zero.**
Zmierzony element LCP artefaktu to **akapit banera cookie w nakładce `position: fixed`**, nie treść,
a TTFB (≈5 s) dominuje FCP w **91-95%**. Przy dzisiejszym TTFB podział arkusza **nie ruszy ani FCP,
ani LCP w sposób mierzalny.** Ta pozycja ma dwa różne uzasadnienia i tylko jedno z nich jest dziś
prawdziwe: **bramka jest o włos od zapalenia (prawda) i arkusz jest na ścieżce krytycznej
(niesprawdzone i wątpliwe).** Rób ją dla pierwszego powodu, nie dla drugiego - i dopiero po A2.

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

## A4. Bramka na budżety WEWNĘTRZNE - pięć liczb, których nie pilnuje nic

Sprostowanie do rozdz. 8.6, żeby zlecenie stało na prawdzie: **nieprawdą jest, że „nie ma ANI
JEDNEJ bramki na budżety SSR"** - `boot-timing.spec.ts` jest twardą bramką czasu na artefakcie
(A2 ją rozszerza). Prawdą jest twierdzenie węższe: **żaden budżet WEWNĘTRZNY potoku nie ma
zabezpieczenia.** Pięć konkretnie - trzy z pierwszej wersji tego zlecenia i dwie dołożone po
ręcznym domknięciu wymiaru `bramki` (§8.7 audytu):

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
4. **Sufit budżetów loadera TRASY - liczba, której pierwsza wersja tego zlecenia nie miała.**
   Punkt 1 pilnuje korzenia (3 000 ms), ale najdłuższy odcinek jest na trasie: `src/routes/$.tsx`
   niesie **13 000 ms** szeregowo (`PRIMARY_CONTENT_BUDGET_MS = 5_000` dwa razy, `:239` i `:360`,
   plus `SECONDARY_PREFETCH_BUDGET_MS = 3_000`, `:353`), `blog.index.tsx` **8 000 ms**
   (4 000 x 2). Bramka ma liczyć **sumę budżetów per loader**, nie sumę stałych w pliku - ta sama
   stała użyta dwa razy to dwa budżety.
5. **Reguła „loader, który może zdegradować, MUSI zabramkować swój `Cache-Control`" - najtańsza
   pozycja na tej liście.** Doktryna jest w repozytorium napisana wzorowo
   (`src/lib/ssr/resilientLoad.ts:123-138`) i mechanizm istnieje
   (`resilientCacheControl(degraded, cleanPolicy)`, `:140-144`), a **szesnaście z dwudziestu
   dwóch tras** ustawiających `Cache-Control` z niego korzysta. Nie korzystają **dwie**, i obie
   mogą dziś utrwalić render niepełny na 3 minuty świeżości plus dobę okna stale:
   - `src/routes/$.tsx` - nagłówek wychodzi w `:288`, a praca, która może zdegradować, jest
     dopiero w `:303-354` (`Promise.allSettled` pod budżetem 3 000 ms) i `:358-360`. Awaria
     głównej treści jest obsłużona poprawnie (`NO_STORE` na każdej z czterech gałęzi `:242-281`)
     - degraduje po cichu dopiero prefetch wtórny. **To się na tej trasie już raz zdarzyło**:
       komentarz `:344-350` opisuje incydent stron sekcyjnych, których HTML wchodził do edge
       cache na 24 h. Naprawa dodała wtedy prefetch, nie zabramkowała nagłówka;
   - `src/routes/sitemap.tsx` - `setCacheControlHeader(contentCacheControl())` jest **pierwszą
     instrukcją loadera** (`:59`), a trzy zapytania budujące całą treść lecą po nim
     w `Promise.allSettled` **bez budżetu i bez sprawdzenia wyniku** (`:60-64`).

   Kształt bramki: skrypt po `src/routes/**`, który zapala się na pliku importującym
   `withBudget`/`loadResilient` albo wołającym `Promise.allSettled`, a ustawiającym
   `contentCacheControl()` bez `resilientCacheControl`. Dziś zapaliłby się na dwóch plikach.
   `contentCacheControl()` ma dokładnie dwa opt-outy - `personalized` i `preview`
   (`src/lib/http/cachePolicy.ts:66-67`) - **wejścia „zdegradowany" nie ma w ogóle**, więc
   rozważ też trzecią flagę zamiast bramki na wołających. Wtedy uzasadnij, dlaczego, i zostaw
   `resilientCacheControl` jako jedyną drogę.

Zadanie: dołożyć **jedną** bramkę statyczną, która pilnuje wszystkich pięciu naraz - czyta źródła,
a nie zbudowany artefakt, więc jest tania i biegnie w jobie `verify`.

Wzorzec bierz z bramek, które już to robią dobrze: `scripts/check-bundle-size.ts` (zamrożone
podłogi + ignorowanie nadpisań w CI) i którakolwiek z bramek katalogu `src/lib/ci/__tests__`.
Nowa bramka musi mieć:

- **zamrożoną podłogę w kodzie**, nie w zmiennej środowiskowej;
- **własny test jednostkowy z KONTROLĄ NEGATYWNĄ** - test dowodzący, że bramka **oblewa** na
  zepsutym wejściu. Bramka bez kontroli negatywnej to bramka, o której nie wiadomo, czy działa;
- wpis w `package.json` i krok w `.github/workflows/ci.yml` **bez** `continue-on-error`;
- komunikat, który mówi, **co** przekroczono i **o ile**, nie „budżet przekroczony".

**Kryterium odbioru:** `bun run check:<nazwa>` zielony na tym HEAD **po zabramkowaniu obu tras
z punktu 5** i czerwony w trzech niezależnych próbach: po podniesieniu `ROOT_WARM_BUDGET_MS`
o 1 ms, po podniesieniu `SECONDARY_PREFETCH_BUDGET_MS` o 1 ms i po cofnięciu bramki
`Cache-Control` w `sitemap.tsx` (pokaż wszystkie cztery przebiegi w PR);
`check:gate-coverage` zielony, czyli bramka jest realnie wpięta; test kontroli negatywnej
w suicie.

---

## A5. Pomiar A/B na trasie z ŻYWYMI danymi - bo dziś nie ma liczby na pytanie „po co to było"

**Repozytorium ma pierwszy w swojej historii pomiar porównawczy i jego wynik jest najważniejszą
liczbą całego okna:** `docs/POMIAR_PIERWSZEGO_WCZYTANIA_AB_2026-09-01.md`, baza → main, trasa
`/cookies`:

| pomiar                 |       baza |       main |           zmiana | ocena    |
| ---------------------- | ---------: | ---------: | ---------------: | -------- |
| TTFB dokumentu         |   5 068 ms |   5 064 ms |    −4 ms (−0,1%) | **szum** |
| First Contentful Paint |   5 312 ms |   5 272 ms |   −40 ms (−0,8%) | **szum** |
| dokument SSR           |   76 860 B |   77 414 B |   +554 B (+0,7%) | **szum** |
| treść tekstowa w SSR   |  2 298 zn. |  2 298 zn. |                0 | **szum** |
| JS bootu razem         | 2 580,6 KB | 2 591,6 KB | +11,0 KB (+0,4%) | **szum** |

**Czyli: dziewięć zamkniętych punktów nie przyspieszyło pierwszego wczytania o nic mierzalnego.**
Raport sam nazywa ograniczenie: artefakt gada z **zaślepką Supabase**, więc główny zysk prefetchu
SSR jest na tej trasie **niemierzalny**. Narzędzie już istnieje: `bun run measure:boot-ab <rewizja> <trasa>`.

**Kryterium odbioru:** zapisany w repozytorium pomiar `measure:boot-ab` na trasie **z osiągalnym
backendem** (albo z atrapą PostgREST oddającą wiersze) - `/` i jedna trasa treściowa - z rozbiciem
TTFB / FCP / „treść tekstowa w SSR", i **jawne zdanie, czy punkty 1 i 2 przyspieszyły stronę
główną, czy nie.** Bez tego cała ta warstwa nie ma liczby na pytanie, po co była praca.

## A6. Około dwóch sekund ścieżki krytycznej, których nikt nie przypisał

Sufit budżetów loaderów na `/cookies` - trasie **bez loadera trasy** - to **3 000 ms**, a
`withBudget` (`src/lib/asyncBudget.ts`) **ściga i rozstrzyga na budżecie**, więc loader korzenia
fizycznie nie może trzymać dłużej. Zmierzone TTFB na tej trasie: **5 030-5 195 ms**.
Raport przypisuje różnicę `SSR_QUERY_TIMEOUT_MS = 5000`, ale **nie pokazuje ogniwa, które na nią
czeka**. Około **2 s ścieżki krytycznej jest dziś nieprzypisane**.

**To najprawdopodobniej powód, dla którego A/B nie widzi zysku** - i dlatego ta pozycja stoi przed
podziałem arkusza i przed jakimkolwiek dalszym skracaniem budżetów. **Dopóki tych 2 s nie ma
adresu, każde dalsze skracanie budżetów loaderów jest hipotezą**, bo dowodnie nie ruszają TTFB.

**Kryterium odbioru:** log serwera artefaktu ze znacznikami czasu na czterech granicach - powrót
loadera korzenia, wejście w `dehydrate`, wynik `sweepQueryCacheForSerialization`, `onShellReady` -
z jednym zdaniem „te X ms to Y". Jeśli winowajcą okaże się budżet, dołóż test, który go przypina.
Koszt: niski. Zysk: największy z całej listy.

## A7. Preload słownika działa, ale nic go nie pilnia - a raz już umarł

Punkt 6 z wydania 8 jest **zrobiony bez zapadki**. Mechanizm jest lepszy od rekomendacji audytu -
wyłącznie nagłówek HTTP `Link` (`rel="modulepreload"`), nie węzeł w `<head>`, bo nazwa chunku
powstaje przy podziale i bundel klienta jej nie zna. Ale gdy hint umrze - **a umarł już raz**,
commit `6700e74cb` „hint słownika był MARTWY w artefakcie" - jedynym śladem jest `this.warn`
w `scripts/lib/localeChunkPlugin.ts`, które **nie wywraca builda**. Rdzeń słownika wpadający do
wspólnego chunku albo cicha zmiana kształtu `LOCALE_CHUNK_URLS` przechodzą na zielono.
Dwa istniejące testy (`rootHead.test.ts`, `localeChunkPlugin.test.ts`) są **na atrapach** i nie
sprawdzają artefaktu.

**Kryterium odbioru:** jedna asercja w `e2e/boot-timing.spec.ts` na nagłówku `Link` odpowiedzi
nawigacyjnej - dokładnie jeden `rel="modulepreload"`, cel pasujący do
`/assets/(pl|en)-[A-Za-z0-9_-]{8}\.js` - przez **istniejący** parser `modulepreloadTargets`
ze `scripts/lib/bootAbReport.ts`, nie własny. Kontrola negatywna: podmiana `LOCALE_CHUNK_URLS`
na `{pl:null,en:null}` oblewa ten przypadek. Koszt: ~10 linii.

## A8. Ogon punktu 4: siedemnaście tras z zimnymi kluczami, dwanaście w cache

Punkt 4 jest zamknięty - wszystkie cztery wskazane powierzchnie mają loader - ale ma **zmierzony
ogon**: z 370 tras → 82 publiczne strony SSR → **11 bez loadera w łańcuchu + 6 z loaderem, który
tych kluczy nie grzeje = 17**, z czego **12 wchodzi do NES Edge Cache** (`/club`, `/club/apply`,
`/club/specialization/$slug`, `/donate`, `/publications`, `/quiz`, `/search`, `/regulamin`,
`/polityka-prywatnosci`, `/zwroty-i-reklamacje`, `/zatrudniamy`, `/club/join/$token`).

Narzędzie, które to liczy, mówi o sobie wprost, że **jest narzędziem pomiarowym, nie bramką**
(`src/lib/ci/publicRouteLoaders.ts:1`), a jego 34 testy sprawdzają **analizator na atrapach**,
nie liczbę w repozytorium. **Jedna nowa trasa bez loadera nie zapali dziś niczego.**

**Kryterium odbioru:** ratchet w `src/lib/ci/__tests__/publicRouteLoaders.test.ts` - asercje
`cold.length <= 17` i `cachedCold.length <= 12` na **prawdziwym drzewie tras**, z komentarzem,
że progi wolno wyłącznie obniżać; kontrola negatywna: atrapowa trasa z `useQuery` bez loadera
oblewa ratchet. **Dopiero potem** sensownie zlecać naprawy poszczególnych tras. Koszt: niski.

---

## A9. Płaszczyzna roli serwisowej nie ma ŻADNEGO terminu - pozycja BLOKUJĄCA

**To jest ustalenie, którego nie było w pierwszej wersji tego zlecenia ani na liście jedenastu
punktów rozdz. 8.6.** Wyszło z ręcznego domknięcia wymiaru `e2e` po limicie sesji (§8.7 audytu)
i stawiam je wyżej niż większość tej listy, bo unieważnia założenie, na którym stoją punkty
A4 i B1: że budżety loaderów pilnują najdłuższego odcinka przed pierwszym bajtem. Nie pilnują.

Przed routerem - a więc przed jakimkolwiek budżetem loadera i **przed konsultacją cache'u
dokumentów** - biegną dwa round-tripy do bazy rolą serwisową:

1. `redirectMiddleware` (pozycja **6** w `requestMiddleware`, `src/start.ts:443-461`) →
   `src/lib/seo/redirects.server.ts:54-75`:
   `await supabaseAdmin.from("redirects").select(...).limit(5000)`;
2. rozwiązanie hosta na najemcę → `src/lib/server/tenant.server.ts:68-85`:
   `await supabaseAdmin.from("tenants").select(...).limit(500)`.

Żaden nie jest owinięty w `withBudget`, żaden nie przekazuje `AbortSignal`,
a `src/integrations/supabase/client.server.ts` - całe 41 linii - **nie konfiguruje ani własnego
`fetch`, ani żadnego timeoutu**. Nie ma więc terminu na tej płaszczyźnie w żadnym miejscu.

Oba mają `try/catch` z zejściem na przeterminowany cache (`redirects.server.ts:71-75`,
`tenant.server.ts:84-86`) i to jest dobra obrona - **ale przed BŁĘDEM, nie przed powolnością.**
Zawieszone połączenie nie rzuca; ono czeka. A czeka **przed** `documentCacheMiddleware`
(pozycja **10**), więc nawet trafienie w gorący wpis nie ratuje czytelnika przed tym czekaniem -
co przewraca całą logikę „HIT to mikrosekundy".

Częstotliwość wynika z TTL-i: `REDIRECT_CACHE_TTL_MS = 30_000` (`redirects.server.ts:44`)
i `CACHE_TTL_MS = 60_000` (`tenant.server.ts:40`). Na rozgrzanym izolacie jedno żądanie na 30 s
i jedno na 60 s płaci pełny round-trip bez sufitu; na zimnym - pierwszy czytelnik.

**Pokrycie NIE jest tu problemem i to jest sedno tej pozycji**: `redirects.server.ts` ma
**63/63 linii (100,00%) i 11/11 funkcji (100,00%)**, `tenant.server.ts` **68/70 (97,14%)
i 17/17 (100,00%)**. Brakuje nie testu - brakuje terminu. To jest ustalenie, którego pokryciem
nie da się wykryć, więc nie licz na to, że wyjdzie z rozdz. 12 audytu.

Zadanie:

1. **Nadać termin obu round-tripom.** Wzorzec jest w repo: `withBudget` (`src/lib/asyncBudget.ts`,
   **12/12 linii, 100%**). Budżet ma być stałą w kodzie, nie w zmiennej środowiskowej, i ma być
   **krótki** - to zapytania po indeksie na kilkuset wierszach, nie raport. Zejście po
   przekroczeniu terminu jest już napisane: ta sama gałąź, co dla błędu (przeterminowany cache
   albo `EMPTY_DIRECTORY`).
2. **Odróżnić w telemetrii lapsus terminu od błędu.** Dziś oba kończą się tym samym
   `console.warn`. Po zmianie `[redirects] index load failed` i `[tenant] directory load failed`
   muszą rozróżniać przyczynę, inaczej pierwsza produkcyjna awaria będzie nieodróżnialna od
   dwudziestu poprzednich.
3. **Test na to, że termin DZIAŁA** - z kontrolą negatywną: atrapa `supabaseAdmin`, która nigdy
   nie rozstrzyga, i asercja, że funkcja wraca w oknie budżetu z wartością zejścia. Bez tego
   testu zmiana jest hipotezą.
4. **Rozstrzygnąć, czy `limit(5000)` na przekierowaniach jest właściwą liczbą** i podać wynik.
   Pięć tysięcy wierszy na każdym zimnym izolacie to nie jest darmowe, a indeks buduje się
   w pamięci (`buildRedirectIndex`).

**Czego NIE robić:** nie przenosić tych round-tripów za `documentCacheMiddleware`. Kolejność
jest poprawna z powodów bezpieczeństwa - klucz cache'u jest prefiksowany hostem ZWALIDOWANYM
względem `tenants.domain`, więc rozwiązanie najemcy MUSI poprzedzać lookup. Zadanie to termin,
nie zmiana kolejności.

**Kryterium odbioru:** oba wywołania mają termin ze stałą w kodzie; test z atrapą, która nie
rozstrzyga, przechodzi i oblewa po zdjęciu terminu (pokaż oba przebiegi); telemetria rozróżnia
lapsus terminu od błędu; pokrycie obu plików nie spada.

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

## B4. Zero w `requestHost.server.ts` to kształt środowiska, nie zaniedbanie - jeden plik zamyka szew izolacji najemcy

Ten punkt jest tu, bo jest **najtańszy w całym zleceniu**, a domyka jedyny nieprzetestowany szew
warstwy, na którym stoi izolacja najemcy.

Klucz cache'u dokumentów jest prefiksowany hostem (`src/lib/http/documentCache.ts:179-180`)
i to jest cała jego izolacja między tenantami. Sama funkcja klucza jest przetestowana wzorowo:
**43/43 linii (100,00%), 9/9 funkcji (100,00%), 47/49 gałęzi (95,91%)**, dwanaście testów, w tym
jeden nazwany wprost _„scopes keys by tenant host, with a no-host fallback scope"_
(`src/lib/http/__tests__/documentCache.test.ts:107`). **Wartość `host`** pochodzi natomiast
z `src/lib/http/requestHost.ts` - **2/20 linii (10,00%), 2/4 funkcji (50,00%)** - a jego
serwerowa połowa `requestHost.server.ts` ma **0/16 linii i 0/4 funkcji**. Pokryte są dokładnie
linie 28 i 39. Bez wywołania: `currentTenantHost` (`:61`) i `currentTenantAssertion` (`:91`).
Ten sam wzorzec w `tenantAssertionCookie.server.ts`: **1/16 linii (6,25%), 0/2 funkcji**.

**Przyczyna jest jedna i nie jest nią lenistwo.** `vitest.config.ts:7` ustawia
`environment: "happy-dom"`, więc `window` ISTNIEJE, `import.meta.env.SSR` jest fałszywe,
a gałąź serwerowa obu funkcji jest **nieosiągalna z definicji**: `currentTenantHost` wraca
na linii 63 z `window.location.host` i dynamiczny import `./requestHost.server` nigdy się
nie wykonuje.

Do tego: **`@/lib/http/requestHost` jest podmieniany na atrapę w 26 plikach testowych** w całym
repozytorium. To szew, który cała platforma zastępuje stubem - i jednocześnie jedyny szew tej
warstwy, którego nikt nie sprawdza w prawdziwej postaci.

Zadanie: jeden plik testowy z dyrektywą `// @vitest-environment node` w pierwszej linii - wzorzec
obecny w repozytorium **14 razy**, w tym dwa razy w tych samych katalogach
(`src/lib/http/__tests__/ssrTiming.server.test.ts:1`,
`src/lib/server/__tests__/publishedContent.server.test.ts:1`). Pokryj w nim:

1. `currentTenantHost` na ścieżce serwerowej - z atrapą `getRequest` i atrapą
   `resolveTrustedRequestHost`, oraz **gałąź `catch` → `null`** (brak kontekstu żądania);
2. `currentServerAssertion` / `assertionForRequest` - w tym `null` przy braku hosta
   (`requestHost.server.ts:32`, `:43`) i `null` przy rzucie `mintTenantHostAssertion`;
3. `trustedPublicHost` na ścieżce SSR - **oraz jej zejście**: gdy dynamiczny import padnie,
   funkcja MUSI wrócić `requestPublicHost(request)` (`requestHost.ts:47-51`). To jest gałąź,
   która w produkcji decyduje, czy nieznany host dostanie `null` („brak wskazówki tenanta"),
   czy surowy nagłówek - więc jest to gałąź o konsekwencji bezpieczeństwa, dziś niesprawdzona;
4. `tenantAssertionCookie.server.ts` tą samą drogą.

**Czego NIE robić:** nie zmieniaj `environment` w `vitest.config.ts` na `node` - 2 218 plików
testowych zakłada DOM. Dyrektywa per plik jest jedyną poprawną drogą.

**Kryterium odbioru:** `requestHost.server.ts` i `tenantAssertionCookie.server.ts` **powyżej
zera na funkcjach**, `requestHost.ts` z pokrytą gałęzią zejścia z punktu 3, nowy próg
per-ścieżka w `vitest.config.ts` z komentarzem podającym pomiar i datę.

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
5. Jedna nowa bramka pilnuje **pięciu** budżetów wewnętrznych (w tym sufitu budżetów loadera
   trasy i reguły „loader, który może zdegradować, bramkuje `Cache-Control`"), ma **kontrolę
   negatywną** i jest wpięta w `ci.yml` bez `continue-on-error`; `check:gate-coverage` zielony.
6. `src/lib/ssrCache.ts` daje **identyczne** pokrycie w dwóch kolejnych przebiegach.
7. Rozstrzygnięta obecność detektora **niezgodności** hydratacji; przy braku - dołożony,
   z testem dowodzącym, że łapie wstrzykniętą niezgodność.
8. **Oba round-tripy roli serwisowej przed routerem mają termin** ze stałą w kodzie, a test
   z atrapą, która nigdy nie rozstrzyga, przechodzi i oblewa po zdjęciu terminu (A9).
9. `requestHost.server.ts` i `tenantAssertionCookie.server.ts` **powyżej zera na funkcjach**,
   a gałąź zejścia `trustedPublicHost` pokryta (B4).
10. `src/routes/$.tsx` i `src/routes/sitemap.tsx` **nie mogą już utrwalić renderu
    zdegradowanego** w cache'u dokumentów - każda z osobnym testem dowodzącym, że nagłówek na
    renderze niepełnym to `private, no-store`.
11. `bun run check:*` w komplecie zielone **poza** `check:ci-gates`, która była czerwona
    przed twoją pracą i nie należy do tego zlecenia.

**Na koniec zdaj raport:** co zmierzyłeś przed i po (liczba za liczbą, tą samą metodą), które
defekty zarejestrowałeś jako `it.fails` i dlaczego, czego świadomie nie zrobiłeś, oraz - osobno -
**które liczby z tego zlecenia okazały się nieaktualne**. Ta ostatnia lista jest dla audytu
najcenniejsza: wydanie 9 znalazło siedem własnych pomyłek i wszystkie przez sprawdzenie liczby,
nie przez jej przepisanie.
