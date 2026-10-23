# Speed Index strony głównej: 11,0 s (mobile) i 2,9 s (desktop) — przyczyny, naprawy i co musi zrobić właściciel (2026-10-22)

Cel zlecenia: **Speed Index ≤ 2,5 s na mobile i ~1,6 s na desktopie** dla
`https://neweuropeanstrategies.com/` w PageSpeed Insights (`hl=pl`).

**Wniosek w jednym zdaniu.** Kod przeglądarkowy już mieści się w celu
(ten sam build z dokumentem podanym z cache: SI mobile 1,39 s, desktop
0,38 s), a 85 % wyniku PSI to **realny czas odpowiedzi serwera** na hostingu
Lovable: każde żądanie trafia tam w zimny izolat Workera, cache dokumentów
współdzielony między izolatami nie działa, więc każdy render płaci ~5–6 s.
W kodzie naprawiono to, co da się naprawić bez zmiany hostingu (§4:
szacunek −1,1…−2,0 s mobile, −0,45…−0,85 s desktop), ale **celów 2,5 s /
1,6 s nie da się osiągnąć bez kroku infrastrukturalnego po stronie
właściciela** (§5) - po nim szacunek to ~1,4–2,2 s mobile i ~0,5–0,9 s
desktop.

## 0. Punkt wyjścia: raporty PSI z 22 października 2026, 21:31 CEST (Lighthouse 13.5.0)

| Metryka                  |     Mobile |   Desktop |
| ------------------------ | ---------: | --------: |
| Performance              |     **72** |    **93** |
| First Contentful Paint   |      1,7 s |     0,4 s |
| Largest Contentful Paint |      5,0 s |     0,4 s |
| Total Blocking Time      |       0 ms |      0 ms |
| Speed Index              | **11,0 s** | **2,9 s** |
| Cumulative Layout Shift  |          0 |         0 |

FCP, LCP desktop, TBT i CLS są zielone - czerwony jest prawie wyłącznie
Speed Index (i LCP mobile, z tej samej przyczyny co SI, patrz §2.4).

## 1. Jak Lighthouse liczy Speed Index - i dlaczego tylko on jest czerwony

PSI symuluje throttling (Lantern). Dla Speed Indexu (kod:
`@paulirish/trace_engine/.../lantern/metrics/SpeedIndex.js` w Lighthouse 13.5):

```
SI = cO · observedSpeedIndex + cP · layoutBasedSI        (potem max(SI, FCP))
mobile (rtt 150 ms):  cO = 1,4    cP = 0,4
desktop (rtt 40 ms):  cO = 0,575  cP = 0,492
```

- `observedSpeedIndex` to Speed Index **prawdziwego, niedławionego wczytania
  na maszynie PSI**, liczony od startu nawigacji - **zawiera więc realny TTFB
  dokumentu**. FCP i LCP w Lantern realnego TTFB nie widzą (symulują serwer
  z mediany opóźnień), dlatego FCP wygląda dobrze, a SI fatalnie.
- `layoutBasedSI` to średnia ważona (log2 czasu trwania) symulowanych końców
  zadań głównego wątku zawierających Layout, przycięta od dołu do FCP.

Rozkład zmierzony Lighthouse 13.5 na **żywej** stronie (artefakty w
`scratchpad/lh`, narzędzie `si-breakdown.mjs`):

| Przebieg |        SI | = cO × observedSI           | + cP × layoutSI |
| -------- | --------: | --------------------------- | --------------- |
| mobile 1 | 10 681 ms | 1,4 × 6 803 (TTFB 5 883 ms) | 0,4 × 2 895     |
| mobile 2 | 10 854 ms | 1,4 × 6 869 (TTFB 6 305 ms) | 0,4 × 3 094     |
| desktop  |  3 609 ms | 0,575 × 5 802 (TTFB 5 137)  | 0,492 × 555     |

**Budżet celu.** Mobile ≤ 2,5 s ⇔ TTFB widziany przez PSI ≲ 0,65 s (przy
layoutSI ≈ 2,9 s) albo ≲ 0,9 s po naprawach z §4.3. Desktop ≤ 1,6 s ⇔
TTFB ≲ 2 s. Każda sekunda TTFB to **+1,4 s SI na mobile**.

## 2. Pomiary - skąd bierze się 5–6 s TTFB

### 2.1. Kod klienta już spełnia cel

`node scripts/performance/lighthouse-local.mjs` na buildzie HEAD (fixture,
dokument z cache = HIT, TTFB ≈ 10 ms):

| Forma   | Perf |    FCP |    LCP |   TBT |     **SI** |
| ------- | ---: | -----: | -----: | ----: | ---------: |
| mobile  |   99 | 1,39 s | 1,99 s | 13 ms | **1,39 s** |
| desktop |  100 | 0,37 s | 0,47 s |  0 ms | **0,38 s** |

### 2.2. Hosting: produkcja nadal stoi na Lovable (Workers for Platforms)

- DNS jest w Cloudflare właściciela (NS `maciej`/`marlowe.ns.cloudflare.com`),
  ale rekord A apex i `www` to **DNS-only → 185.158.133.1**
  (`lovable-app-cd-1-4.p.l5e.io`). Ustawienia strefy właściciela (cache,
  Brotli, Early Hints, Workers) **nie dotyczą ruchu**, bo ruch jej nie przechodzi.
- Odpowiedzi niosą `x-deployment-id: psr2.*`, wstrzyknięte przez Lovable
  `/~flock.js` i `/__l5e/events.*.js`, wymuszone `cache-control: no-cache`.

### 2.3. Każde żądanie: zimny izolat, cache martwy

Nagłówek `server-timing` z produkcji (GET `/`, `Accept-Language: pl`):

```
nes-edge;desc="MISS", ssr;dur=1411, db;dur=7058;desc="n=27", edge-routing;dur=1291,
nes-layer;desc="render", nes-l2;desc="off"   |   server-init;dur=0, app;dur=2703
```

- **15 z 15** zmierzonych żądań trafiło w zimny izolat (`edge-routing > 0`,
  ciepły izolat ma tam 0) i było MISS-em. L1 (pamięć izolatu) nie jest więc
  nigdy czytany drugi raz.
- **L2 (Cache API kolonii) jest martwe** na tym runtime (`nes-l2;desc="off"`
  w każdej odpowiedzi) - razem z nim migawki routingu i cache mediów.
- Zimny izolat najpierw ewaluuje **8,97 MB chunku routera serwera**
  (`_chunks/router.mjs`, z kodem panelu, billingu itd.; zimny import w Node
  0,83–0,92 s), dopiero potem rusza jakiekolwiek middleware - także cache.
- Potem dwa szeregowe odczyty planu service-role (katalog tenantów, reguły
  przekierowań: `edge-routing` 0,46–1,29 s) i **5 szeregowych fal zapytań
  anon** do Supabase w **AWS eu-west-1** (z IAD 110–360 ms na zapytanie,
  limit 6 równoczesnych połączeń Workera).
- Zegar Workers stoi w czasie pracy CPU, więc `app;dur` nie widzi ewaluacji
  ani renderu: TTFB minus `app;dur` to 2,8–5,4 s.

### 2.4. PSI dostawał inny dokument niż czytelnik

PSI dopisuje do UA token `Chrome-Lighthouse`, a `isbot` uznaje go za
automat. TanStack (`renderRouterToStream`) **czeka wtedy na `allReady`**:
pierwszy bajt dla PSI powstawał dopiero po wyrenderowaniu wszystkich sekcji
spod zgięcia (db `n=27` zamiast `n=13` powłoki). Lighthouse CLI 13 tego
tokenu nie dopisuje - stąd lokalne pomiary go nie widziały.

### 2.5. Laboratorium MISS (lokalnie, opóźnienie 100–250 ms na zapytanie)

Artefakt z wyłączonym cache dokumentów i backendem-fixture z opóźnieniem
(skrypty w `scratchpad/misslab`): zimny render `/` = 19 zapytań w 5 falach,
TTFB 0,79 s przy 100 ms/zapytanie.

## 3. Co NIE jest przyczyną

- **Martwy kod** - strona główna płaci za niego ~0 B (tree-shaking działa);
  what-if Lantern: −25 KB app-initial = 0…−25 ms SI. Lista do sprzątania: §6.
- **CSS / dokument** - `styles-*.css` (561 KB raw, 81 KB gz) i HTML
  (483 KB raw, 74 KB gz) kosztują ~2 ms SI mobile na KB gz na ścieżce
  krytycznej; blok `style media="not all"` to arkusz późnej granicy Reacta
  (nie martwy), bloki `data-wt-css` nie są duplikatami.
- **Obraz LCP** - ma `fetchpriority=high`, preload z `imagesrcset`,
  poprawne `sizes`.

## 4. Co zmieniono w kodzie (gałąź `claude/funny-goodall-fxqf21`)

### 4.1. Czas odpowiedzi serwera (składnik observedSI, ×1,4 na mobile)

| Zmiana                                                                                                                                                                                                                                                                                                                                                                  | Plik(i)                                                                                                                                                       | Efekt                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Lighthouse/PSI renderuje się strumieniem przeglądarki**, nie wariantem automatu: decyzja strumień/`allReady` zapada na UA emulowanej przeglądarki (crawlery bez zmian, log nadal widzi klasę `lighthouse`)                                                                                                                                                            | `src/lib/ssr/serverEntry.tsx`, `src/lib/http/lighthouseStreaming.ts`, `src/server.ts`                                                                         | laboratorium MISS, UA Lighthouse'a: pierwszy bajt **1,34–1,40 s → 0,93–0,94 s** na zimno, 0,38 → 0,10–0,21 s na ciepło; szacunek PSI mobile −0,45…−0,7 s SI                                      |
| **Reguły przekierowań równolegle z katalogiem tenantów** na zimnym izolacie: jeden odczyt włączonych reguł (z `tenant_id`) startuje razem z `resolveTenantForHost`; do indeksu, matchera i migawki trafiają wyłącznie reguły tenanta rozstrzygniętego ze zwalidowanego hosta; wynik na limicie 5 000, błąd i `data: null` schodzą do dotychczasowego odczytu per tenant | `src/lib/seo/redirects.server.ts`                                                                                                                             | `edge-routing` (0,46–1,29 s, dwa szeregowe odczyty do eu-west-1) spada do max(katalog, reguły): −1 podróż do bazy na każde zimne żądanie, szacunek −0,15…−0,5 s TTFB ⇒ **−0,2…−0,7 s SI mobile** |
| **Jeden odczyt najnowszych wpisów dla wszystkich widgetów** „najnowsze opublikowane" (post-listy, hero-slider, okładki-fallbacki, autorzy slajdów): 20 wierszy z sumą kolumn + jeden odczyt profili autorów; wycinek tylko na serwerze, tylko bez filtrów i przy oknie ≤ 20, wynik bajt w bajt jak dotychczasowe zapytanie widgetu                                      | `src/lib/builder/latestPostsSuperset.ts`, `postListQuery.ts`, `sliderPostsQuery.ts`, `sliderFallbackQuery.ts`, `sliderAuthorsQuery.ts`, `src/lib/ssrCache.ts` | render `/`: `posts` 8 → 1, `profiles_public` 5 → 1 (limit 6 połączeń Workera przestaje kolejkować falę widgetów)                                                                                 |
| **Ten odczyt startuje w pierwszej fali** loadera strony głównej (zaraz po trybie strony, nie po treści kanwy; poza trybem „najnowsze wpisy", za odpowiedzią przez `runAfterResponse`); korzeń czeka na rozgrzewkę chrome'u w tym samym terminie, więc nagłówek zostaje w powłoce                                                                                        | `src/routes/index.tsx`, `src/routes/__root.tsx`                                                                                                               | dane nad zgięciem w terminie loadera częściej: sekcja z hero w powłoce, **preload okładki hero w `<head>`** zamiast na ~90 % dokumentu                                                           |
| Samotest L2 ponawia odczyt (100/500/2000 ms) i podaje krok porażki (`nes-l2-fail;desc="put\|read\|miss\|mismatch\|error"`)                                                                                                                                                                                                                                              | `src/lib/http/documentCacheL2.server.ts`, `documentCache.server.ts`                                                                                           | magazyn z opóźnieniem > 100 ms nie jest już wyłączany jak martwy; jedno `curl` mówi, czy L2 da się naprawić                                                                                      |
| Odczyt migawek routingu (tenanci, przekierowania) z terminem 100 ms                                                                                                                                                                                                                                                                                                     | `src/lib/http/bootstrapCache.server.ts`                                                                                                                       | zimny izolat nie czeka na nieodpowiadający magazyn przed cache dokumentów                                                                                                                        |
| `nes-iso;desc="req=N cold=0\|1"` w Server-Timing                                                                                                                                                                                                                                                                                                                        | `src/lib/http/ssrTiming.ts`, `src/server.ts`                                                                                                                  | zimne izolaty widoczne w `curl` (dotąd tylko w Workers Logs)                                                                                                                                     |
| BYPASS cache dokumentów przed walidacją hosta; `/media` poza regułami przekierowań                                                                                                                                                                                                                                                                                      | `documentCache.server.ts`, `src/lib/seo/redirects.ts`                                                                                                         | zimne żądania obrazów i API bez odczytu katalogu tenantów i reguł (dla samego PSI ~0: jego obrazy idą przez już ciepły izolat)                                                                   |
| Beacony `/~api/*` (wstrzyknięty `/~flock.js`) bez renderu SSR                                                                                                                                                                                                                                                                                                           | `src/lib/http/hostReservedPath.ts`, `src/server.ts`                                                                                                           | każda odsłona przestaje kosztować dodatkowy render 404 (218 KB) i zapis `record_seo_404`                                                                                                         |

**Laboratorium zimnego renderu** (artefakt `build:smoke`, backend-fixture
z opóźnieniem 150 ms na zapytanie, pierwszy dokument świeżego procesu, 3×
na wariant; baza `2b28a3bb` vs gałąź):

| UA                 | TTFB baza   | TTFB gałąź  | cały dokument baza | cały dokument gałąź | zapytania | preload hero w `<head>` |
| ------------------ | ----------- | ----------- | ------------------ | ------------------- | --------- | ----------------------- |
| Lighthouse/PSI     | 0,97–1,00 s | 0,66–0,73 s | 0,97–1,00 s        | 0,84–0,88 s         | 19 → 12   | nie → tak               |
| Chrome (czytelnik) | 0,76–0,81 s | 0,67–0,68 s | 0,96–1,02 s        | 0,85–0,87 s         | 19 → 12   | nie → tak               |

Laboratorium nie ma limitu 6 połączeń ani odległości do eu-west-1, więc
zaniża zysk z mniejszej liczby zapytań; pokazuje natomiast, że ścieżka
krytyczna skróciła się o całą falę.

### 4.2. Część „layout" (składnik layoutSI, ×0,4 na mobile)

| Zmiana                                                                                                                                                            | Plik(i)                                          | Efekt                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Pomiar wymiarów zwijania nagłówka leniwie (pierwszy scroll albo zatrzask „interakcja albo cisza"), nie w zadaniu hydratacji; `fonts.ready` czytane przed pomiarem | `src/components/Header.tsx`                      | jedyny Layout w zadaniu hydratacji znika; what-if na śladach produkcji: layoutSI 2 895 → 2 435 ms (mobile), 555 → 417 ms (desktop) |
| `useConsent` nie tworzy klienta Supabase w efekcie hydratacji (plan P3.1 B)                                                                                       | `src/lib/ads/consent.ts`                         | zadanie hydratacji gościa nie czeka na `vendor-supabase` (−56…−68 ms layoutSI, gdy to zadanie niesie Layout)                       |
| Bloki stylu sekcji buildera przez `StyleSink`                                                                                                                     | `BuilderRenderer.tsx`                            | higiena: re-render sekcji nie parsuje identycznego CSS-u od nowa; HTML serwera bajt w bajt bez zmian; SI ~0                        |
| `import.meta.env` czytany jednym kluczem                                                                                                                          | `src/lib/observability/report.ts`                | −~600 B w chunku bootu każdej strony                                                                                               |
| Tło `/quiz` importuje z manifestów obrazów tylko `url`                                                                                                            | `quizBackgroundPreload.ts`, `QuizBackground.tsx` | metadane czterech manifestów (r2_key, project_id, rozmiary) znikają z chunku bootu: `app-initial` −1,3 KB raw / −0,3 KB gz         |

Kompromis świadomy: zadanie hydratacji bez Layoutu Lantern symuluje
z pełnym mnożnikiem CPU - TBT mobile może wzrosnąć o kilkadziesiąt ms
(PSI ma dziś 0 ms).

**Pomiar A/B** (`scripts/performance/lighthouse-local.mjs --compare`, ten sam
backend-fixture, dokument z cache; 3 przebiegi na formę z przeplotem, A = baza
`2b28a3bb`, B = gałąź (ostatni build); rozkład SI narzędziem `si-breakdown.mjs`):

| Forma   | SI A (3×)                | SI B (3×)                | layoutSI A               | layoutSI B                           |
| ------- | ------------------------ | ------------------------ | ------------------------ | ------------------------------------ |
| mobile  | 1 411 / 1 436 / 1 383 ms | 1 391 / 1 392 / 1 400 ms | 2 664 / 2 460 / 2 755 ms | **= FCP** (1 391 / 1 392 / 1 400 ms) |
| desktop | 409 / 376 / 379 ms       | 432 / 365 / 363 ms       | 551 / 480 / 480 ms       | **≈ FCP** (434 / 372 / 380 ms)       |

Na fiksturze dokument przychodzi z cache, więc SI = FCP i różnica w samym
SI jest mała (mobile −0,02 s, desktop w szumie; TBT mobile +24 ms - koszt
z §4.2). Liczy się kolumna layoutSI:
po zmianach **żadne zadanie z Layoutem nie kończy się istotnie po FCP** i nie
pojawił się nowy późny węzeł Layoutu (sprawdzenie „migracji" Layoutu do
późniejszych zadań aplikacji). Na śladach produkcji zostają węzły, których
fikstura nie ma (klatka po commicie przełączenia urządzenia, skrypty
wstrzykiwane przez Lovable), więc tam what-if daje −0,16…−0,18 s SI mobile
i −0,07 s desktop - mniej niż zmiana TTFB, ale niezależnie od hostingu.

### 4.3. Szacunek po wdrożeniu (hosting bez zmian)

| Składnik                                                | Mobile (×1,4 / ×0,4)      | Desktop (×0,575 / ×0,492)        |
| ------------------------------------------------------- | ------------------------- | -------------------------------- |
| Strumień przeglądarki dla PSI (TTFB −0,4…−0,5 s)        | −0,55…−0,7 s              | −0,25…−0,3 s                     |
| Reguły przekierowań równolegle (TTFB −0,15…−0,5 s)      | −0,2…−0,7 s               | −0,1…−0,3 s                      |
| Wspólny odczyt wpisów w pierwszej fali, hero w `<head>` | −0,15…−0,4 s              | −0,05…−0,15 s                    |
| Layout (nagłówek, zgoda)                                | −0,16…−0,18 s             | −0,07 s                          |
| **Razem**                                               | **−1,1…−2,0 s ⇒ ~9–10 s** | **−0,45…−0,85 s ⇒ ~2,05–2,45 s** |

TTFB nadal płaci zimny izolat, ewaluację 9 MB routera i fale zapytań do
eu-west-1, a jego rozrzut między przebiegami PSI to sekundy - **celów 2,5 s
/ 1,6 s ten zestaw sam nie osiągnie**. Zmierzyć PSI po wdrożeniu (kilka
przebiegów, mediana).

## 5. Kroki właściciela - bez nich celu nie będzie

Kolejność wg wpływu na SI:

1. **Przenieść produkcję z runtime'u Lovable na Workera we własnym koncie
   Cloudflare** (zgodnie z „hostingiem zajmuje się jedynie Cloudflare"):
   wdrożyć istniejący build `cloudflare-module` (wygenerowany
   `.output/server/wrangler.json` z `assets.run_worker_first`) z tymi samymi
   sekretami, podpiąć **Custom Domain** dla apex i `www`, przełączyć DNS.
   Wtedy działa Cache API (L2 dokumentów, migawki routingu, cache mediów
   ożywają bez zmian w kodzie), znikają wstrzyknięte skrypty Lovable, a na
   strefie można włączyć poniższe. Szacunek: TTFB na HIT ~0,05–0,3 s ⇒
   SI mobile ~1,4–2,2 s, desktop ~0,5–0,9 s.
   **Warunek konieczny:** Worker musi dostać `LOVABLE_API_KEY` i klucze
   połączeń, bo przez bramy Lovable (`connector-gateway.lovable.dev`,
   `ai.gateway.lovable.dev`) idą: **płatności Stripe**
   (`src/lib/stripe.server.ts`), e-mail (`email.server.ts`,
   `email/provider.server.ts`), GSC (`analytics/gsc.functions.ts`), tłumaczenia
   AI, embeddingi, dyktowanie (`routes/api/stt.ts`) i import WordPressa - bez
   klucza checkout przestaje działać. Przed przełączeniem przenieść 13 obrazów
   `/__l5e/assets-v1/` (tła `/quiz`, odznaka Google) na własny origin - po
   wyjściu z runtime'u Lovable te adresy przestaną odpowiadać (§6).
2. **Smart Placement** dla Workera (`placement: { mode: "smart" }` w
   konfiguracji wrangler) - render blisko Supabase w eu-west-1; dziś
   każde z ~27 zapytań leci przez Atlantyk, jeśli izolat jest w USA.
3. **Brotli** (Rules → Compression: Brotli/Zstd dla HTML/CSS/JS) i **Early
   Hints** (103 z istniejącego nagłówka `Link`: CSS, font, obraz LCP).
4. Alternatywa dla 1, jeśli produkcja ma zostać na Lovable: strefa
   właściciela przed Lovable (O2O) - wymaga CNAME do celu Lovable (O2O nie
   działa z rekordem A), potwierdzenia u Lovable, reguł Cache Rules z
   pominięciem dla `sb-*`, `Authorization`, `Sec-GPC: 1`, języka EN na `/`.
   Ryzyko certyfikatu/DCV - tylko po potwierdzeniu u Lovable.
5. Rozważyć wyłączenie analityki hostingu Lovable (`/~flock.js`) - z powodu
   zgody, nie Speed Indexu: skrypt ustawia cookie `session-id` przed zgodą
   i wysyła `page_hit` przy każdej nawigacji SPA. Na SI samo wyłączenie
   `flock` nie wpływa (what-if: 0 ms) - zysk ~−0,1 s mobile daje dopiero
   zniknięcie obu skryptów Lovable (`/~flock.js` i `/__l5e/events.*.js`),
   czyli krok 1. Decyzja z 2026-10-08 (PLAN-FALI-3) była „zostaje".
6. Ustawić `PSI_API_KEY` dla `psi.yml` - dzienny limit współdzielonego API
   jest wyczerpany, a pomiar PSI to jedyny pomiar tej liczby.

**Weryfikacja po kroku 1:** `curl -sI https://neweuropeanstrategies.com/`
ma pokazać `nes-l2;desc="named"` (nie `off`), `x-nes-cache: HIT` przy drugim
żądaniu, `content-encoding: br`, `colo;desc=...` w Server-Timing.

## 6. Martwy kod - co usunąć

Martwy kod **nie jest przyczyną** złego Speed Indexu: tree-shaking usuwa go
z bundla `/`, a what-if Lantern dla −25 KB chunku `app-initial` daje 0…−25 ms.
Każdą pozycję niżej sprawdził niezależny weryfikator (graf importów, ślady,
build produkcyjny).

**Usunięte w tym zestawie zmian:**

| Pozycja                                            | Co                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Dowód                                                                                                                                                |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zestawy TEST-ONLY (plan P3.10 S2)                  | 18 plików produkcyjnych (~77 KB, 1 973 linie: `ChatBell`, `ChatDock`, `ClubThreadPulse`, `ClubActivityStrip`, `ClubRegimeMark`, `ClubSpecializationSelect`, `MobileArticleActions` → `ArticleListenButton` → `ArticleActionButton`, `TierFeatureTogglesEditor`, `ai-gateway.server`, `brandIconRegistry`, `icons/iconNames`, `threadDynamics`, `activityStrip`, `membershipSignals`, `speakerCardMotion`, `useEventConfirmedMutation`) i 10 testów tylko tych modułów; razem −5,4 tys. linii | 0 importerów produkcyjnych w `src`, `scripts`, `e2e`, `integration` (sprawdzone na HEAD po symbolach i ścieżkach)                                    |
| Zależności AI (P3.10 S3)                           | `ai`, `@ai-sdk/openai`, `@ai-sdk/react`, `@ai-sdk/openai-compatible` + 15 osieroconych wpisów `bun.lock` (975 → 960)                                                                                                                                                                                                                                                                                                                                                                         | 0 importów poza usuniętym `ai-gateway.server.ts`; `bun@1.2.23 install --frozen-lockfile` (wersja z CI) przechodzi, kontrola negatywna zgłasza zmianę |
| Cały `import.meta.env` w chunku bootu              | `report.ts` czyta jeden klucz                                                                                                                                                                                                                                                                                                                                                                                                                                                                | build: obiekt env (z `pk_live` Stripe) zniknął z `app-initial`                                                                                       |
| Metadane manifestów obrazów `/quiz` w chunku bootu | import nazwany `url`                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `r2_key` ×4 w `app-initial`                                                                                                                          |
| Render SSR 404 dla beaconów `/~api/*`              | odpowiedź 204/404 bez wejścia w aplikację                                                                                                                                                                                                                                                                                                                                                                                                                                                    | każda odsłona i nawigacja SPA kosztowała render 404 i zapis `record_seo_404`                                                                         |

**Do decyzji właściciela (bez wpływu na SI):**

- **34 manifesty `src/assets/events/ggm-2021/*.asset.json`** i
  `quiz-fans-bg.png.asset.json` - 0 importów w kodzie. Przed usunięciem
  sprawdzić w bazie, czy treści nie odwołują się do ich adresów
  `/__l5e/assets-v1/…` (manifest wskazuje plik w magazynie Lovable).
- **Zestaw ikon Font Awesome** (`iconPack`, chunk `lucide-shim.fa`): strona
  działa na `lucide`, wariant FA nie jest pobierany w żadnym przebiegu. Usunąć
  albo zostawić jako opcję panelu - od tej decyzji zależy odchudzenie
  rejestru ikon (niżej).
- **Moduł hubu I9 (przychody/e-mail)**: `dto`, `parse`, `queries`,
  `emailHealth.functions` importują tylko siebie nawzajem; podobnie
  `defectMap`, `consistency`, `i18n-admin-revenue-email`, `retention/coupon`.
  Usunąć, jeśli funkcja nie wraca.

**Kolejne zadania (higiena bundla bootu, efekt SI w pojedynczych ms):**

- Moduły mieszane boot/admin trzymają w `app-initial` eksporty używane
  tylko przez chunki leniwe (ustawienia newslettera, eksperymenty, globalne
  widgety, fonty, billing): rozdzielić na liście z `$initial` (≤ 15–20 KB
  gz). Uwaga: `src/lib/newsletter/settingsQueries.ts` już istnieje jako
  moduł admina - nowy liść potrzebuje innej nazwy.
- Rejestry ikon przez `import * as` (6 miejsc) zamienić na `DynamicIcon`
  (≤ 4 KB gz), po decyzji o Font Awesome.

## 7. Dalsza droga (poza tym zestawem zmian)

- **Obraz LCP w `<head>` także na najwolniejszym zimnym renderze.** Na
  produkcji pierwsza sekcja (slider z okładką - element LCP) nie mieściła
  się w terminie loadera, szła strumieniem za powłoką (`ServerSectionGate`,
  granica na ~90 % dokumentu) razem ze swoim preloadem, a żądanie okładki
  startowało 0,5–0,7 s po pierwszym bajcie. Odczyt wpisów w pierwszej fali
  (§4.1) usuwa z tej ścieżki całą falę; jeśli na izolacie dalekim od
  eu-west-1 nawet on nie zdąży przed terminem 600 ms, zostaje podpowiedź
  LCP zapisywana przy publikacji strony (adres znany przed wysłaniem
  powłoki).
- **Nagłówek na zimnym izolacie** bywa dostrumieniowany (szkielet w
  pierwszym malowaniu; widoczne w dokumencie produkcji): dane chrome'u
  (menu, pasek „Na czasie", reklama) nie mieszczą się we wspólnym terminie
  600 ms. Po kroku 1 z §5 (cache brzegowy, ciepłe izolaty) problem znika.
- **CSS blokujący render** (`styles-*.css`, 82 KB gz) przychodzi z Lovable
  po 0,12–0,66 s czekania na serwer i wstrzymuje pierwsze malowanie (na
  śladzie: CSS gotowy 6,58 s, pierwsza klatka 6,64 s). Po kroku 1 i Early
  Hints (§5) idzie z cache brzegowego; wcześniej jedyną dźwignią byłby
  krytyczny CSS inline.
- **Limit 5 000 reguł w odczycie zimnego izolatu.** Jeśli wszystkie
  włączone przekierowania wszystkich tenantów przekroczą 5 000 (import
  WordPressa), odczyt równoległy po cichu schodzi do szeregowego. Sprawdzić
  `select count(*) from redirects where is_enabled` i w razie potrzeby
  zawęzić odczyt (np. do tenantów z niepustym zestawem reguł).

- **„Front door"** - podanie dokumentu z cache w `src/server.ts` PRZED
  importem 9 MB routera (jedno RPC zamiast łańcucha routingu). Bez tego,
  nawet z działającym cache, zimny izolat płaci ~1 s ewaluacji.
- **Podział serwerowego chunku routera** (trasy panelu/billingu leniwie
  także na serwerze).
- **RPC `get_public_homepage()`** (ustawienia + strona + treść w jednym
  zapytaniu; migracja) - −1…−2 fale.
- **Odroczona rewalidacja STALE** - gdy cache zacznie działać, natychmiastowy
  render w tle na tym samym izolacie może opóźniać `/media` (obraz LCP).

## 8. Weryfikacja zestawu zmian

- **Testy jednostkowe:** pełny `vitest run` na gałęzi - 3 901 plików, 96 617 testów zielonych, 0 porażek (194 oczekiwane porażki i 51 pominiętych jak na bazie).
- **Typecheck:** `tsc --noEmit -p tsconfig.json` - jeden błąd, istniejący
  już na bazie (`src/components/blocks/GalleryBlock.tsx`, różnica TS 5/7);
  `tsconfig.scripts.json` - 0 błędów.
- **Bramki:** `check:bundle` (5 370,5 → 5 368,9 KB), `check:chunks`,
  `check:entry-purity`, `check:server-entry-purity`, `check:document-weight`,
  `check:ts-sql-contract`, `check:sql-tenant-scope`, `check:module-singletons`,
  `check:dangerous-html` - zielone; frozen-lockfile dla `bun.lock` sprawdzony
  wersją Bun z CI (1.2.23).
- **Przeglądy adwersaryjne** (niezależni recenzenci + po dwóch weryfikatorów
  na znalezisko): wspólny odczyt najnowszych wpisów - izolacja tenantów, RLS
  i równoważność wyniku bez zastrzeżeń, jedna potwierdzona regresja
  (sumowanie nieświeżości dwóch warstw cache) naprawiona opcją
  `serveStale: false`; rozgrzewka w pierwszej fali i czekanie korzenia -
  trzy potwierdzone poprawki (rejestracja za odpowiedzią, pominięcie trybu
  „najnowsze wpisy" i odczytu profili, testy przypinające zachowanie);
  zmiana harmonogramu bylinów autora została odrzucona przez weryfikację
  jako dźwignia SI i wycofana.
