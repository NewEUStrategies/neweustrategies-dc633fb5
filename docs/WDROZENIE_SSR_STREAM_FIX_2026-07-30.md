# Wdrożenie: naprawa wiszącego strumienia SSR (~61 s) + wzmocnienie ekosystemu SSR - 2026-07-30

**Objaw produkcyjny:** każda strona odpowiadała "kompletnie" dokładnie po ~61 s
(HTML dochodził niemal w całości, bez `</body></html>`, połączenie kończone
błędem `transfer closed with outstanding read data remaining`). Monitory
zewnętrzne (Paddle, health-checki) rozłączały się dużo wcześniej i raportowały
serwis jako **offline**. Wewnętrzni strażnicy SSR (queryTimeout 5 s,
queryStreamGuard <=10 s) nie domykali odpowiedzi.

**Weryfikacja na tej sesji:** pełna reprodukcja na produkcyjnym buildzie
(preset node-server, `vite.smoke.config.ts`): `total=62,49 s` przed poprawką,
`total ~= TTFB ~= 2,5 s` po poprawce; `tsc --noEmit` czysty; testy jednostkowe
dotkniętych obszarów zielone; oba buildy (`vite build`, smoke) zielone.

---

## 1. Diagnoza - łańcuch przyczynowy

Ścieżka dowodowa (sondy w buildzie produkcyjnym + instrumentacja artefaktu):

1. `transformStreamWithRouter` (router-core) po zakończeniu renderu React
   trzyma ogon dokumentu (`</body></html>`) do czasu sygnału "serialization
   finished" od seroval; bez sygnału ubija strumień po twardych
   `DEFAULT_SERIALIZATION_TIMEOUT_MS = 60 000 ms` - stąd stałe ~61 s
   (render ~1-2,5 s + 60 s).
2. Sondy wykazały: `isServer=true`, wrapper dehydrate działa, queryStream
   zamyka się poprawnie (`close(source)`), seroval czyta `done=true`,
   **`onDone` seroval ODPALA** - a mimo to sygnał nie dociera do transformu.
3. Przyczyna: sygnał jest tłumiony przez guard `cleanupStarted` w
   `signalSerializationComplete` - `serverSsr.cleanup()` odpalał się
   PRZEDWCZEŚNIE, w trakcie streamowania.
4. Kto wołał cleanup: egzekutor request-middleware TanStack Start przekazuje
   odpowiedź streamującą SSR jako kopertę
   `{ response, serverSsrCleanup: "stream", dispose }` i na końcu łańcucha
   porównuje **tożsamość obiektu `response.body`** z ciałem koperty. Gdy
   finalne body nie jest tym samym strumieniem, uznaje odpowiedź za
   "podmienioną" i woła `dispose()` -> `serverSsr.cleanup()`.
5. **Root cause:** `documentCacheMiddleware` (NES Edge Cache) na ścieżce MISS
   robił `response.body.tee()` i zwracał NOWY strumień (`toClient`) - łamiąc
   tożsamość body na **każdym renderze dokumentu**. Przebudowy nagłówków
   (`new Response(response.body, ...)` w securityHeaders itd.) tożsamość
   zachowują i były bezpieczne.

Ten sam mechanizm wyjaśnia wcześniejsze incydenty "onRenderFinished silently
drops the listener" (queryStreamGuard, 2026-07): po `cleanup()` router-core
odrzuca rejestracje listenerów. Dotychczasowi strażnicy leczyli objawy tego
jednego błędu.

Dodatkowy czynnik dla botów: `renderRouterToStream` dla `isbot(User-Agent)`
czeka na `stream.allReady` przed pierwszym bajtem - bot Paddle przy wiszącym
potoku nie dostawał NIC do swojego timeoutu.

## 2. Poprawka źródłowa: odroczony zapis NES Edge Cache

- `src/lib/http/documentCache.server.ts`
  - `decorateMissAndDeferStore` (dawniej `passThroughAndMaybeStore`): na MISS
    middleware wyłącznie dekoruje nagłówki (`x-nes-cache`, `Server-Timing`)
    i **rejestruje odroczony zapis** w `WeakMap<ReadableStream, ...>`
    kluczowanej TOŻSAMOŚCIĄ strumienia body - dokładnie tą, którą śledzi
    egzekutor. Zero tee w łańcuchu middleware.
  - `applyDeferredDocumentStore(response)` (nowy eksport): druga połowa
    zapisu, wołana z `src/server.ts` ZA egzekutorem - tam tee jest legalne.
    Czytelnik dostaje streaming bez zmian, kopia zbiera się do L1+L2 pod
    `ctx.waitUntil`. WeakMap = zero wycieków (nieodebrany wpis znika z GC).
- `src/server.ts`: `applyDeferredDocumentStore` wpięty po normalizacji
  odpowiedzi, przed strażnikiem dokumentu.
- Semantyka cache bez zmian: HIT/STALE/single-flight/L2/purge jak dotąd;
  testy L1/L2 zaktualizowane o warstwę `applyDeferredDocumentStore` +
  **test regresyjny tożsamości body** (`documentCache.server.test.ts`).

## 3. Obrona w głębi: strażnik strumienia DOKUMENTU

Nowy moduł `src/lib/http/documentStreamGuard.server.ts` + wpięcie w
`src/server.ts` (produkcyjny entry): każda odpowiedź `text/html` z body ma
zagwarantowane domknięcie strumienia, niezależnie od przyszłych regresji
w frameworku:

- sentinel `</html>` (skan bajtowy, case-insensitive, bez kopii, z 6-bajtowym
  przeniesieniem między chunkami) -> po krótkiej łasce (250 ms) zamykamy sami;
- cisza między chunkami (idle, 12 s - uzbrajana po pierwszym bajcie) ->
  dosztukowanie parsowalnego ogona `</body></html>` + zamknięcie;
- twardy sufit (20 s) -> zamknięcie bezwarunkowe;
- wymuszone zamknięcie anuluje czytnik źródła (upstream sprząta przez własny
  `cancel` -> `serverSsr.cleanup`) i zapisuje incydent w pierścieniu
  diagnostycznym (host tenanta + ścieżka) - `getDocumentGuardSnapshot()`;
- nastawy: `SSR_DOC_GUARD=off` (kill-switch), `SSR_DOC_GUARD_GRACE_MS`,
  `SSR_DOC_GUARD_IDLE_MS`, `SSR_DOC_GUARD_MAX_MS`.

## 4. Wzmocnienia potoku zapytań SSR

- **Deadline round-tripu DB (SSR):** `fetchWithTenantHost`
  (`src/integrations/supabase/tenant-host-fetch.ts`) uzbraja
  `AbortSignal.timeout(8 s)` (kompozycja z sygnałem wywołującego przez
  `AbortSignal.any`). `queryTimeout` (5 s) anuluje ZAPYTANIE, ale nie ubijał
  samego fetcha - a na Workers niedomknięty fetch trzyma slot połączenia
  (limit 6 równoległych subrequestów) i głodzi kolejne zapytania renderu.
  Nastawa: `SSR_DB_DEADLINE_MS` (0/off wyłącza). Defensywnie: starszy runtime
  bez `AbortSignal.timeout/any` po prostu nie dostaje deadline'u.
- **Utylizacja watchdog-a zapytań:** disposer `installSsrQueryTimeout` wpięty
  w cykl życia `serverSsr` (`router.serverSsrLifecycle.onServerSsrAttach` ->
  `serverSsr.onCleanup`) - żaden timer nie przeżywa żądania.

Drabinka budżetów SSR (spójna, każda warstwa ma szansę zadziałać pierwsza):

```
queryTimeout 5 s  <  SSR_DB_DEADLINE 8 s  <  queryStreamGuard.maxMs 10 s
  <  DOC_GUARD_IDLE 12 s  <  DOC_GUARD_MAX 20 s  <<  framework 60 s
```

## 5. Parytet smoke builda (wykryte przy okazji dryfy)

- `vite.smoke.config.ts` nie ustawiał `tanstackStart.server.entry: "server"` -
  smoke-test omijał cały produkcyjny wrapper SSR (normalizacja h3-500,
  a od dziś strażnik dokumentu i odroczony zapis cache). Dodane.
- Dynamiczny import `cloudflare:workers` (waitUntil.server.ts) wywracał build
  nitro na presecie node-server (esbuild po minifikacji inline'uje zmienną
  specyfikatora i `@vite-ignore` znika). Dodane
  `rollupOptions.external: [/^cloudflare:/]` - na Node import rzuca, moduł
  łapie wyjątek i degraduje do fire-and-forget, zgodnie z kontraktem.

## 6. Pomiary (produkcyjny build, node-server, zimny izolat)

| Scenariusz              | Przed                       | Po                        |
| ----------------------- | --------------------------- | ------------------------- |
| `GET /` total           | 62,49 s (błąd transferu)    | ~2,5 s (czyste EOF)       |
| `GET /` TTFB            | 2,48 s                      | ~2,5 s (bez zmian)        |
| Kompletność HTML        | ucięty ogon, brak `</html>` | kompletny dokument        |
| Drugie żądanie (HIT)    | 62 s (każdy render osobno)  | milisekundy (replay L1)   |
| Bot (isbot -> allReady) | 0 bajtów do timeoutu bota   | pełny dokument po całości |

## 7. Testy

- `src/lib/http/__tests__/documentStreamGuard.server.test.ts` (13):
  skaner sentinela (w tym rozcięcie granicą chunków, case-insensitive),
  happy path bajt w bajt, zamknięcia sentinel/idle/timeout, ogon awaryjny,
  gating odpowiedzi (HTML/body/metody), kill-switch, etykieta tenant+path.
- `src/lib/http/__tests__/documentCache.server.test.ts`: cykl przez
  `applyDeferredDocumentStore` + regresja tożsamości body.
- `src/lib/http/__tests__/documentCacheL2.test.ts`: ścieżki MISS przez
  warstwę odroczonego zapisu.
- `src/integrations/supabase/__tests__/tenantHostFetch.test.ts` (+4):
  uzbrojenie deadline'u, przerwanie wiszącego fetcha (TimeoutError),
  współistnienie z sygnałem wywołującego, kill-switch.
