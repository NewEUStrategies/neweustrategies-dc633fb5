# P3.6a — działająca warstwa L2 dokumentu: nazwany cache, samotest, build w kluczu, stały wariant odświeżenia, telemetria

Worktree: `/tmp/claude-0/-home-user-neweustrategies-dc633fb5/57088803-e7ea-5e89-8c05-954276daf4ba/scratchpad/wt3/P3.6a`, gałąź `perf/w3-P3.6a` (od `c606bfa4`), commit `01670c0a`.
Zakres: PLAN-FALI-3 §2 P3.6a + `faza3/diagnoza/cache-dokumentu.md` §8 R1, R6, R7(b, c). R7(a) pominięte (niżej).

## 1. W skrócie

- **R1.** `getColoCache()` zwraca fasadę nad `caches.open("nes-edge-v1")`, otwieraną leniwie (uchwyt zapamiętany raz na
  izolat). Do `caches.default` fasada wraca dopiero, gdy nazwanego cache'u nie da się otworzyć (`open` rzuca, odrzuca
  albo zwraca nie-cache). Wszystkie operacje L2 (dokumenty, wersje, `bumpL2Version`, `l2Delete`, migawki
  `bootstrapCache`/`ssrCacheL2`, cache mediów) idą przez tę jedną fasadę, więc purge trafia w magazyn, z którego się czyta.
  Konsumenci (`bootstrapCache.server.ts`, `ssrCacheL2.server.ts`, `mediaCache.server.ts`) są bez zmian: synchroniczny
  kontrakt `getColoCache()` został.
- **Samotest** raz na izolat pod `runAfterResponse`: `put` wpisu `/__nes/selftest/<nonce>` (max-age 60 s) i `match`
  z porównaniem treści, jedno ponowienie odczytu po 100 ms. Wynik idzie do `l2Stats().verified`, `enabled` zależy od
  niego: nieudany samotest wyłącza L2 w izolacie (`getColoCache()` → `null`, zero kosztu martwych odczytów na MISS-ach).
  Do rozstrzygnięcia fasada działa optymistycznie (pierwsze żądanie zimnego izolatu to właśnie to, które ma skorzystać
  z wpisu kolonii).
- **Build w kluczu dokumentu:** `…/__nes/doc/<build>/<globalVer>/<hostVer>/<klucz planu>`. `<build>` = nazwa pliku wejścia
  klienta z `BOOT_MANIFEST.entry` (np. `index-BsLjjLsH`). Poza buildem stały napis `dev`; build produkcyjny bez mapy bootu
  → L2 dokumentów wyłączone (bezpieczniej niż stały napis).
- **R6:** odświeżenie w tle (`revalidationHeaders` w `src/server.ts`) zawsze z jednym przeglądarkowym UA
  (`Chrome/136`, ten sam napis co `WARM_USER_AGENT` harnessu). Wariant wpisu nie zależy już od tego, kto wyzwolił STALE
  albo zdegradowany MISS (Lighthouse/PSI/Googlebot zasiewały wariant bota `allReady`).
- **R7(b):** `l2Stats()`/migawka karty: `verified`, `store` (`named`/`default`), `build`; jedna linia logu na izolat
  `{"kind":"l2","verified":…,"store":…,"ms":…}`; metryka Server-Timing dokumentów `nes-l2;desc="named"|"default"|"pending"|"off"`
  (ostatnia, tylko gdy izolat ma samotest — sonda `curl`).
- **R7(c) (częściowo):** `degradedAt: "loader" | "handler" | "stream"` w pierścieniu decyzji; degradacja odkryta na
  granicy handlera albo w trakcie strumienia dopisuje się do TEGO SAMEGO wpisu MISS (razem z `degradedRevalidation`).
  Etykiety loaderów (`degradedBy` = `home.page`, chrome…) wymagają plików spoza listy — patrz §4.
- L1, świeżość/SWR, zasady zapisu: bez zmian. Lokalnie (Node, harness, e2e) `globalThis.caches` nie istnieje → L2 jest
  no-opem, nagłówki bajt w bajt jak dotąd (brak `nes-l2`).

## 2. Zmiany plik po pliku

### `src/lib/http/documentCacheL2.server.ts`

- Nagłówek modułu przepisany: dlaczego nazwany cache (WfP untrusted: „`caches.default` is disabled", „each Worker has an
  isolated cache"), samotest, build w kluczu, purge per kolonia.
- Stan izolatu `RuntimeState` per obiekt `globalThis.caches` (inny obiekt = świeży stan; testy podmieniają globalny):
  `cache` (fasada albo `caches.default`), `selfTest`, `store`, `opened`, `verified`, `selfTestScheduled`.
- `openStore()` memoizuje WYŁĄCZNIE wynik (obiekt `Cache`), nie obietnicę: obietnica I/O z kontekstu jednego żądania nie
  może być oczekiwana z innego (workerd potrafi ją zawiesić). Skutek: pierwsza seria równoległych odczytów może zawołać
  `caches.open` kilka razy (tania operacja lokalna); od pierwszego wyniku uchwyt jest jeden na izolat (test to sprawdza).
- `resolveRuntime()`: runtime z `caches.open` → fasada + samotest; runtime bez `open` → `caches.default` wprost, bez
  samotestu (zachowanie sprzed zmiany); dostęp do `caches.default` w `try` (w hostingu bywa zablokowany).
- `runSelfTest()`: nonce z `crypto.randomUUID()` losowany w kontekście żądania (w zasięgu modułu workerd losowania
  zabrania), jedno ponowienie, linia logu `kind:"l2"`, nigdy nie rzuca.
- `documentBuildId()`: DYNAMICZNY import `@/lib/boot/bootManifest` za bramką `import.meta.env.SSR` (statyczny wciągnąłby
  moduł manifestu Start ~215 KB do grafu wejścia Workera `_ssr/index.mjs`, który dziś ładuje go leniwie z handlerem; gdy
  dokument dociera do L2, manifest jest już wczytany). `buildIdFromEntry()` bierze nazwę pliku bez `.js`/`.mjs`,
  sanityzuje do `[A-Za-z0-9_-]`, ≤ 64 znaki. `bootManifest.ts` bez edycji.
- `documentRequest()` dostaje segment buildu; `null` (build PROD bez mapy) → `l2Match` null, `l2Put` no-op, `l2Delete` false.
- `l2Stats()` += `verified`, `store`, `build`; `enabled` = jest magazyn i nie oblał samotestu.
- Nowy eksport `l2SelfTestLabel()` (dla Server-Timing) i typy `L2Store`, `L2SelfTestLabel`.
- `setColoCacheForTests()` zeruje też stan izolatu L2 (fasada, samotest, build) — „rotacja izolatu" w testach.

### `src/lib/http/documentCache.server.ts` (tylko telemetria)

- `withL2SelfTest()`: na końcu Server-Timing (`replay` dla HIT/STALE L1/L2 i `withCacheStatus` dla MISS) dokleja
  `nes-l2;desc="…"`, gdy izolat ma samotest; inaczej napis bez zmian (istniejące testy dokładnych napisów zielone).
- `DocumentCacheL2Snapshot` += opcjonalne `verified`, `store`, `build` (opcjonalne w typie jak `deletes` — atrapy
  w innych testach). Karta `/admin/performance` czyta `l2.enabled`, które teraz mówi prawdę.
- `DocumentCacheDecision.degradedAt` + `markLateDegradation()`: rekord odroczonego zapisu trzyma referencję do wpisu
  pierścienia; odrzucenie na granicy handlera / w strumieniu dopisuje etap i wynik `scheduleDegradedRevalidation`
  (wcześniej wartość była wyrzucana, a MISS w pierścieniu wyglądał na czysty). Zachowanie zapisu bez zmian.
- Komentarze nagłówka (L2 nazwany, samotest, build; `nes-l2` w Server-Timing).
- Klucz planu NIE powstaje tutaj (powstaje w L2 z klucza planu) — build dodany wyłącznie w `documentCacheL2.server.ts`.

### `src/server.ts` (tylko R6)

- Stała `REVALIDATION_USER_AGENT`; `revalidationHeaders()` nie kopiuje `user-agent`, ustawia stałą. Reszta wąskiej listy
  (host, XFH, proto, accept, accept-language, ciasteczko języka) bez zmian. Ścieżka czytelnika nietknięta.

### Testy (nowe, `src/lib/http/__tests__/`)

- `documentCacheL2NamedCache.test.ts` (11): prawdziwy kształt `globalThis.caches = { default, open }`:
  HIT z L2 po rotacji izolatu + `verified: true`/`store: "named"`, `open("nes-edge-v1")`, `caches.default` nietknięte;
  uchwyt i samotest raz na izolat + jedna linia `kind:"l2"`; `nes-l2` `pending` → `named` (bramkowany zapis samotestu);
  purge pełny podbija wersję w nazwanym cache'u; klucz z `/__nes/doc/dev/`; `open` odrzuca / rzuca synchronicznie / zwraca
  nie-cache przy martwym default → `verified: false`, `enabled: false`, `getColoCache() === null`, zero dalszych odwołań do
  martwego magazynu, `nes-l2;desc="off"`, L1 działa (HIT); `open` rzuca + działający default → `store: "default"`, HIT z L2;
  runtime bez `open` → `caches.default` wprost, `verified: null`, brak samotestu i `nes-l2`; brak `caches` → no-op.
- `documentCacheL2BuildId.test.ts` (5, atrapa `@/lib/boot/bootManifest`, `SSR`/`PROD` przez `vi.stubEnv`): segment
  z wejścia klienta; po „deployu" nowy build nie widzi HTML-a poprzedniego, purge ścieżki trafia we własny wpis;
  sanityzacja znaków; PROD bez mapy → L2 dokumentów wyłączone; poza buildem stały `dev` niezależny od zegara.
- `revalidationUserAgent.test.ts` (3, node env, prawdziwy driver z `src/server.ts`): 5 wyzwalaczy (Lighthouse, Googlebot,
  curl, Firefox, brak UA) → jeden UA, `isBotUserAgent=false`, `classifyUserAgent="browser"`; reszta nagłówków i tylko
  ciasteczko języka; żądanie czytelnika nieprzepisane. Kontrola mutacyjna: na bazowym `server.ts` pierwszy test pada.
- `documentCacheDegradationStage.test.ts` (4, node env): czysty MISS bez pól; `loader`; `handler` (ten sam wpis, jeden
  MISS w pierścieniu); `stream` (Suspense, `setCacheControlHeader` w trakcie strumienia).

## 3. Bramki

| bramka                                                                                                                                                                                                                                                                                                                                         | wynik                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bunx prettier --write` (7 plików)                                                                                                                                                                                                                                                                                                             | OK                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `light.sh bunx eslint` (7 plików)                                                                                                                                                                                                                                                                                                              | 0 błędów                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `light.sh bunx vitest run src/lib/http/__tests__ src/lib/__tests__/ssrCacheL2.server.test.ts src/lib/__tests__/ssrCacheL2.test.ts src/lib/__tests__/edgeCacheFunctions.test.ts src/components/admin/performance/__tests__/edgeCacheCard.test.tsx src/__tests__/serverEntryRequestOptions.test.ts src/__tests__/platformServerFailures.test.ts` | 35 plików / 704 testy zielone                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `light.sh bunx vitest run src/__tests__/startPipeline.test.ts src/lib/boot/__tests__/bootSet.server.test.ts`                                                                                                                                                                                                                                   | 2 / 82 zielone                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `light.sh bunx vitest run` testy z atrapą `globalThis.caches` spoza katalogu (`bootstrapRouting`, `mediaProxy`, `scannerServiceWorker`, `redirectsServerSwr`, `tenantResolver`)                                                                                                                                                                | 5 / 81 zielone                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ponownie po poprawce typów: `src/lib/http/__tests__` + `ssrCacheL2*`                                                                                                                                                                                                                                                                           | 31 / 631 zielone; eslint 0; `prettier --check` OK                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `light.sh bun run verify:static`                                                                                                                                                                                                                                                                                                               | 15 bramek OK (format:check, check:dangerous-html, SQL, ts-sql-contract…)                                                                                                                                                                                                                                                                                                                                                                                                                    |
| typecheck (mutex, `heavy-bg.sh`)                                                                                                                                                                                                                                                                                                               | zielony: `tsgo --noEmit --incremental false` + `typecheck:scripts` + `typecheck:e2e` (`tools/typecheck-noinc.sh`, `typecheck.log`). Trzy wcześniejsze próby `bun run typecheck` ubite SIGKILL: `tsBuildInfoFile` leży w `node_modules/.cache`, a `node_modules` worktree to dowiązanie do checkoutu głównego (wspólny cache inkrementalny wszystkich worktree) - ten sam objaw i obejście co w P3.5. Czwarta próba złapała 2× TS7006 w nowym teście (typ szpiega `console.log`), poprawione |

Uwaga dyscypliny maszyny: po poprawce TS7006 jeden raz zawołałem `tsgo --noEmit --incremental false` przez `light.sh`, czyli POZA mutexem (błąd; przebieg krótki, bez kolizji widocznej w logach innych agentów). Obowiązujący wynik to pełny typecheck pod mutexem z wiersza wyżej.

Build, `check:bundle`, `check:server-entry-purity`, `test:e2e:artifact` i Lighthouse `--compare` należą do etapu Prove
(item ma etap Prove; ta zmiana nie dotyka klienta — oczekiwane bajty klienta bez zmian, a w `_ssr/index.mjs` tylko
nowy dynamiczny import modułu mapy bootu).

## 4. Odstępstwa od planu (i dlaczego)

1. **R7(b, c) „w linii logu dokumentu".** Linię `kind:"doc"` buduje `logDocument` w `src/server.ts` (dozwolone tylko R6)
   przez `buildDocumentLogLine` w `src/lib/http/ssrTiming.ts` (poza listą). Zamiast pól w tej linii: (b) jedna linia
   `kind:"l2"` na izolat (korelacja z liniami `doc` po wywołaniu Workers), metryka `nes-l2` w Server-Timing każdego
   dokumentu (widoczna z `curl`) i pola w migawce karty; (c) etap `degradedAt` w pierścieniu. Pełne R7(b, c) w linii
   `doc` → `out_of_ownership_needs`.
2. **`degradedBy` z etykietami loaderów** (`home.page`, `home.mode`, chrome `failed`) wymaga rejestru per żądanie
   w `resilientLoad.ts`/`chromeWarmup.tsx`/`responseHeaders.ts` (wzorzec WeakMap jak `routeCacheDirectives`) — pliki P3.6b
   (partia 2). `degradedAt` to etap, nie etykieta; nazwa celowo inna, żeby się nie pomyliły.
3. **Import mapy bootu dynamiczny, nie statyczny** — patrz §2 (graf wejścia Workera).
4. **Build PROD bez mapy → L2 dokumentów wyłączone** zamiast stałego napisu (stały napis zostaje dla vitest/dev, jak
   chciał orkiestrator). Wtyczka `nes:boot-after-lcp` przerywa build, gdy nie podmieni mapy, więc w praktyce to gałąź
   martwa — ale gdyby ktoś ją wyłączył, wolimy brak L2 niż HTML poprzedniego deployu.
5. **Samotest tylko dla fasady** (runtime z `caches.open`); runtime bez `open` (atrapy, polyfille) = „jak dziś" bez
   samotestu (`verified: null`). Każdy prawdziwy runtime Workers ma `caches.open`.
6. **`caches.open` może być zawołane kilka razy w pierwszej serii równoległych odczytów izolatu** (memo wyniku, nie
   obietnicy — §2). „Raz na izolat" dotyczy uchwytu i samotestu.
7. **R7(a) (kolonia przez `/cdn-cgi/trace`) pominięte:** wymaga zmian w `src/server.ts` poza R6 i dodatkowego `fetch`
   na izolat w runtime, którego zachowania nie da się tu sprawdzić.

## 5. Ryzyka

- **Purge staje się realny per kolonia** (dotąd bump i `delete` były no-opem); inne kolonie doganiają w oknie świeżości
  (≤ 3 min), jak dotąd izolaty — opisane w komentarzu modułu.
- **Migawki danych L2 bez buildu w kluczu (najważniejsze do decyzji).** Działająca fasada ożywia też `ssrCacheL2`
  (`site_settings_public`, tokeny, menu, `trending_posts`, `public:home-*`, `public:resolved:*`) i migawki routingu.
  Ich klucze nie niosą buildu, więc deploy zmieniający kształt projekcji tych kluczy może przez ≤ TTL (~60 s, potem
  odświeżenie w tle) podać nowemu kodowi wartość w starym kształcie, a render z niej trafiłby do L1/L2 pod NOWYM buildem
  na okno świeżości. Poprawka to jedna linia w `src/lib/ssrCacheL2.server.ts` (`snapshotKey`: segment buildu) — plik poza
  listą, zgłoszone w `out_of_ownership_needs`. Migawki tenantów/przekierowań mają stały kształt.
- **Zmiana wyłącznie po stronie serwera** (bez zmian klienta) nie zmienia segmentu buildu: HTML poprzedniego deployu
  (spójny z tym samym klientem — bez martwych chunków) może być podawany do końca świeżości wpisu, potem STALE +
  odświeżenie. Zmiana klienta (JS, CSS: nazwa arkusza jest w chunku wejścia, a hashe kaskadują) zawsze zmienia segment.
- **Fałszywie ujemny samotest** wyłącza L2 w izolacie = stan dzisiejszy (bez regresji); ponowienie po 100 ms zmniejsza
  szansę. Fałszywie dodatni niemożliwy (porównanie treści nonce).
- **R6:** wpis po odświeżeniu to zawsze wariant strumieniowy; linie logu `revalidation: true` mają teraz zawsze
  `uaClass: "browser"` (opisuje wariant renderu, nie wyzwalacz). Harness `--warm-ua bot` w trybie `restore` restartuje
  serwer przy STALE/innym wariancie, więc pomiar wariantu bota się nie zmienia.
- **Hosting może zdejmować Server-Timing** na części odpowiedzi — wtedy `nes-l2` widać tylko w liniach `kind:"l2"`.

## 6. Obserwacje poza zakresem (do decyzji orkiestratora)

- **`REVALIDATE_NONCE` w `documentCache.server.ts` jest liczony w zasięgu modułu.** W workerd losowanie w global scope
  jest zabronione, więc `crypto.randomUUID()` rzuca i wartością zostaje fallback `nes-${Date.now().toString(36)}`, a zegar
  w zasięgu modułu to 0 → `nes-0`, przewidywalny. Dowód pośredni [F]: `GET /api/public/version` na produkcji zwraca
  `{"v":"rt-0"}` (ten sam wzorzec `Date.now()` w zasięgu modułu, 1 żądanie 2026-10-08). Skutek [H]: żądanie z zewnątrz
  z `x-nes-revalidate: nes-0` omija serwowanie z L1/L2 (wymusza render; wzmocnienie kosztu), a linie logu mają fałszywe
  `revalidation: true`. Poprawka: nonce losowany leniwie przy pierwszym użyciu (w kontekście żądania). Nie wchodzi
  w „tylko telemetria" tej pozycji — nie zmieniałem. Do zweryfikowania po wdrożeniu bez ataku: linia logu rewalidacji
  i porównanie z `rt-0`.
- `stats.startedAt` (karta „Aktywna od") z tej samej przyczyny w produkcji pokazuje najpewniej 1970-01-01.

## 7. Weryfikacja produkcyjna po wdrożeniu (do PROVE.md)

Lokalnie L2 jest no-opem (Node bez `caches`), więc harness dowodzi wyłącznie braku regresji. Efekt sprawdza się na
produkcji, ≤ 20 żądań, odstęp ≥ 3 s:

```bash
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
for i in $(seq 1 10); do
  curl -sS -o /dev/null -D - -A "$UA" -H 'accept: text/html' -H 'accept-language: pl' \
    https://neweuropeanstrategies.com/ | grep -i -E '^(x-nes-cache|x-nes-cache-age|server-timing|cf-ray):'
  sleep 3
done
```

Oczekiwane:

1. `nes-l2;desc="named"` (pierwsze żądanie zimnego izolatu może mieć `pending`) — nazwany cache działa. `desc="off"`
   na wielu izolatach = Cache API niedostępne także w nazwanym wariancie → R1′ (KV / Supabase Storage + CDN).
   `desc="default"` = nazwanego cache'u nie ma, działa `caches.default`.
2. Na zimnych izolatach (przed zmianą `edge-routing` 270–840 ms i MISS) pojawia się `x-nes-cache: HIT|STALE`
   z `nes-layer;desc="L2"`, a `edge-routing` spada do ~0 (migawki tenantów/przekierowań z L2).
3. Workers Logs: linie `{"kind":"l2","verified":true,"store":"named"}` (jedna na izolat), udział `layer=L2`
   w liniach `kind:"doc"` > 0; po deployu pierwsze żądania to MISS (nowy segment buildu), nie HTML poprzedniego builda.
4. `/admin/performance` → karta NES Edge Cache: `l2.enabled` zgodne z samotestem, `l2.hits` > 0 przy `l2.stores` > 0.

## 8. Na co ma spojrzeć recenzent

- `openStore()` i decyzja „memo wyniku, nie obietnicy" (bezpieczeństwo kontekstów żądań w workerd).
- Czy wyłączanie L2 po nieudanym samoteście i optymizm przed jego końcem to właściwy kompromis.
- Segment buildu z `BOOT_MANIFEST.entry` (kaskada hashy, CSS w chunku wejścia) i gałąź PROD bez mapy.
- `markLateDegradation()` — zmiana wyłącznie telemetrii; kolejność `scheduleDegradedRevalidation` bez zmian.
- §5 „migawki danych bez buildu" — czy przed wdrożeniem dołożyć jednolinijkową poprawkę w `ssrCacheL2.server.ts`.
