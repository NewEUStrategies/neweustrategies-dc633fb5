# Diagnoza: MISS-y dokumentu `/`, zdegradowane rendery, `edge-routing`, rozgrzewka (2026-10-08)

Repo: `/home/user/neweustrategies-dc633fb5` @ `7c924ae5` (tylko odczyt, nic nie zmieniono).
Pomiary: kontener w USA (Cloudflare colo **IAD**), 14 żądań curl do `https://neweuropeanstrategies.com/`
w odstępach ≥ 3 s + próbki użytkownika `w3/prod/d1..d6`. Artefakty: `w3/diag/probe/*.{h,html,w}`,
skrypt `w3/diag/bin/probe.sh`.

Oznaczenia: **[F]** = fakt sprawdzony w kodzie albo w odpowiedzi produkcyjnej; **[H]** = hipoteza
(z uzasadnieniem i sposobem weryfikacji).

---

## 0. Wnioski w skrócie

1. **[F/H] Warstwa L2 (Cache API) w produkcji nic nie robi.** W tej samej kolonii IAD były świeże,
   czyste wpisy (HIT L1 o wieku 4 s, 68 s, 83 s), a kolejne izolaty bez wpisu w L1 **nigdy** nie
   dostały `nes-layer;desc="L2"`, tylko pełny render. Zimne izolaty zawsze płacą `edge-routing`
   270-840 ms, czyli odczyt katalogu tenantów i reguł przekierowań z bazy. Migawki bootstrap
   w Cache API miały ten koszt sprowadzić do zera. Wyjaśnienie zgodne ze wszystkimi objawami
   (to jest **[H]**): aplikacja działa jako Worker w dispatch namespace Workers for Platforms,
   w trybie „untrusted”. Dokumentacja Cloudflare dla tego trybu mówi: „`caches.default` is disabled
   for all Workers in the namespace”, „Each Worker has an isolated cache, when using the Cache API”,
   „The request.cf object is not available”. Drugi objaw tego trybu też widać: w żadnej odpowiedzi
   nie ma `colo;desc=…` w `server-timing`, chociaż `src/server.ts:501-504` go dokleja, gdy zna
   `request.cf.colo` albo `cf-ray`. W efekcie L2 dokumentów, L2 danych (`edgeTtlCache`), migawki
   tenantów i przekierowań oraz cache mediów to no-op. **Każdy izolat jest wyspą.**
2. **[F] Na zimnym izolacie w kolonii daleko od bazy render z konstrukcji wypada „zdegradowany”.**
   Baza siedzi w AWS **eu-west-1 (Dublin)**. Z IAD jedno wywołanie PostgREST kosztuje 146-330 ms.
   Strona główna ma JEDEN wspólny termin danych, 600 ms (`src/lib/ssr/homeSsrBudget.ts:16`),
   a sama treść strony to trzy szeregowe fale. Wszystkie 16 zimnych MISS-ów z dzisiaj
   (6 próbek użytkownika i 10 moich) są `degraded`, czyli `private, no-store`, czyli nie trafiły do cache.
3. **[F] „Zdegradowany” nie znaczy „niekompletny”.** Z 16 MISS-ów:
   - 8 to **typ A** (185 KB): komunikat „Wczytujemy stronę główną”, a treść ładuje się po stronie klienta;
   - 5 to **typ B1**: kompletna treść, brakuje tylko paska „Warte przeczytania”;
   - 3 to **typ B2**: tekst identyczny z czystym HIT-em, a mimo to dokument został odrzucony,
     bo o zapisie decyduje werdykt loadera wydany po ~600 ms.
4. **[F] Klucz cache nie rozdziela wariantów.** Nie zależy od UA, urządzenia, `Accept-Language`,
   `Sec-GPC` ani ciasteczek innych niż `sb-*`. Różnica desktop/mobile to loteria: albo żądanie
   trafi na izolat, który ma wpis w L1, albo nie. PSI (`Chrome-Lighthouse`) ma ten sam klucz.
   Na MISS dostaje render `allReady` (bot według `isbot`), z TTFB 1,7-3,4 s z IAD. W moich
   próbach 4/4 takie rendery były zdegradowane, więc żaden nie został zapisany.
5. **[F] Rozgrzewka w praktyce nie działa.**
   - Krok w `scheduler.yml` loguje „brak WARM_BASE_URL/APP_BASE_URL - pomijam grzanie cache.”
     (przebieg 37743752408, 2026-10-08 07:29Z).
   - Cron `*/5` uruchamia się realnie co 2-6 h (40 przebiegów w 7 dni).
   - P0.7 jest odłożone (`faza2/STAN-FALI-0.md:36`).
   - Nawet działający warmer, przy samym L1 na izolat, rozgrzałby jeden losowy izolat.
6. **Najważniejsza zmiana:** przywrócić L2 przez nazwany cache (`caches.open(...)`), dołożyć do
   kluczy identyfikator buildu i samotest. Dalej, w kolejności:
   - werdykt zapisu wydawany na końcu strumienia, a nie w loaderze;
   - ścieżka krytyczna strony głównej w jednej fali (P7.3) albo z osobnym terminem;
   - routing (tenant + przekierowania) w jednej fali albo lookup cache przed nim (P7.2/SC-4);
   - warmer EU+US dopiero po naprawie L2.

---

## 1. Pomiary (dziś, IAD, `accept: text/html`, `accept-language: pl`)

Czasy to chwila zakończenia żądania (UTC). Rozmiar to zdekodowany HTML (transfer gzip: ~42 KB dla
typu A, ~73-78 KB dla pełnego). W kolumnie „degraded” jest pole `degraded` z zdehydratowanego
`loaderData` trasy `/` (`src/routes/index.tsx:270-288`) — patrz §1.1.

| próbka                | UA           | `x-nes-cache`   |  TTFB s | `edge-routing` ms | `ssr` ms | `db` n / Σms    |  HTML B | `degraded` | klasa                     |
| --------------------- | ------------ | --------------- | ------: | ----------------: | -------: | --------------- | ------: | ---------- | ------------------------- |
| lh-1 08:59:42         | Lighthouse m | MISS            |    3,43 |               480 |     1064 | 24 / 4952       | 460 417 | true       | B1                        |
| lh-2 08:59:48         | Lighthouse m | MISS            |    3,11 |               493 |      938 | 23 / 3591       | 499 484 | true       | B2                        |
| lh-3 08:59:54         | Lighthouse m | MISS            |    2,68 |               278 |      874 | 24 / 3510       | 460 337 | true       | B1                        |
| lh-4 08:59:58         | Lighthouse m | MISS            |    1,71 |             **0** |     1071 | 23 / 3480       | 499 484 | true       | B2 (ciepły izolat)        |
| desk-1 09:01:03       | Chrome desk  | **HIT L1** 68 s |    0,70 |                 0 |        – | –               | 500 741 | false      | czysty                    |
| desk-2 09:01:10       | Chrome desk  | MISS            |    3,24 |               697 |  **600** | 10 / 1647       | 507 874 | true       | B2                        |
| desk-3 09:01:16       | Chrome desk  | MISS            |    2,98 |               472 |      600 | 7 / 1482        | 185 841 | true       | **A**                     |
| desk-4 09:01:21       | Chrome desk  | MISS            |    2,35 |               283 |      600 | 13 / 2015       | 468 663 | true       | B1                        |
| mob-1 09:05:26        | Chrome mob   | MISS            |    4,07 |               757 |      600 | 8 / 1231        | 185 841 | true       | **A**                     |
| mob-2 09:05:32        | Chrome mob   | MISS            |    2,45 |               287 |      600 | 7 / 1047        | 467 310 | true       | B1                        |
| mob-3 09:05:36        | Chrome mob   | **HIT L1** 4 s  |    0,30 |                 0 |        – | –               | 507 263 | false      | czysty                    |
| l2chk-1 09:05:49      | Chrome desk  | MISS            |    1,08 |             **0** |      316 | 1 / 316         | 504 998 | **false**  | czysty, ciepły izolat     |
| l2chk-2 09:05:52      | Chrome desk  | HIT L1 3,6 s    |    0,33 |                 0 |        – | –               | 504 998 | false      | ten sam izolat co l2chk-1 |
| l2chk-3 09:05:58      | Chrome desk  | MISS            |    2,37 |               273 |      600 | 9 / 1500        | 467 310 | true       | B1                        |
| user d1/d3/d5, mob ×3 | desk/mob     | MISS            | 2,8-3,9 |           698-836 |      600 | 4-7 / 1231-1709 | ~185 KB | true       | **A** (6/6)               |

Obserwacje **[F]**:

- **`ssr;dur=600.0` co do milisekundy na każdym zdegradowanym MISS-ie przeglądarki.** Zegar Workers
  stoi w czasie pracy CPU, więc 600,0 to odpalenie timera terminu `HOME_SSR_BUDGET_MS`. Loader
  czekał do terminu i oddał sterowanie.
- **`db n` liczy tylko round-tripy zakończone przed zbudowaniem nagłówka**
  (`documentCache.server.ts:860-870`). Na MISS-ie przeglądarki to 4-13 wywołań w 600 ms.
  Bot czeka na `allReady`, więc w nagłówku widać wszystkie 23-24 wywołania.
- **Średni koszt wywołania anon z IAD (Σ/n) to 146-330 ms.**
- **Bazowy narzut sieci z tego kontenera to TTFB HIT 0,30-0,70 s.** Na zimnych izolatach
  TTFB − `app;dur` − baza ≈ 0,8-2,4 s. To czas niewidoczny w `Server-Timing`: start izolatu
  i render na zimnym JIT, którego zamrożony zegar nie liczy. Atrybucja to **[H]**, patrz R8.
- **Test L2.** O 09:05:36 izolat X miał świeży wpis (HIT L1, wiek 4 s). O 09:05:49 izolat Y
  (`edge-routing` 0, ciepły) zrobił lookup L2 przed renderem (`documentCache.server.ts:927`) i nic
  nie znalazł: MISS z renderem. Wpis Y trafił tylko do jego L1 (l2chk-2: HIT L1 z bajtami
  identycznymi jak w l2chk-1). O 09:05:58 izolat Z znowu dał MISS, choć w kolonii były już dwa
  świeże wpisy. `l2Put` wykonuje się po każdym czystym zapisie (`documentCache.server.ts:781-786`),
  więc L2 albo nie zapisuje, albo nie odczytuje. Zastrzeżenie **[H]**: wszystkie `cf-ray` mają
  sufiks IAD, a Cache API jest „per data center”. Hipoteza o kilku niezależnych magazynach
  w obrębie IAD jest mało prawdopodobna, ale niewykluczona.

### 1.1 Zewnętrzny wskaźnik „zapisany / niezapisany” (do monitoringu)

Hosting nadpisuje `cache-control`, więc decyzji magazynu nie widać w nagłówkach. Loader `/` zwraca
jednak `degraded` (`src/routes/index.tsx:287`), a ono jest serializowane do HTML jako
`degraded:!0` (true) albo `degraded:!1` (false). Dla trasy `/`:

- `degraded:!0` oznacza `setCacheControlHeader(private, no-store)` (`index.tsx:270`), więc zapisu
  nie ma (`documentStorePolicy`, `documentCache.ts:256-274`);
- `degraded:!1` oznacza, że czysty render mógł zostać zapisany.

Szybka sonda: `curl … | grep -ao 'degraded:![01]'`.

---

## 2. Pytanie 1: co jest w MISS 185 KB, a co w 500 KB, i dlaczego

### 2.1 Termin i gdzie jest ustawiony [F]

**Wspólny zegar żądania** (`src/lib/ssr/routeSsrDeadline.ts:36-43`) jest kluczowany per
`QueryClient`. Pierwszy wołający go tworzy: loader korzenia (`src/routes/__root.tsx:716`) albo
loader `/` (`src/routes/index.tsx:122`).

| Faza                                                      | Budżet                                                                     | Gdzie                 | Skutek po przekroczeniu                                                                                                                                 |
| --------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Termin całości                                            | `HOME_SSR_BUDGET_MS = 600`                                                 | `homeSsrBudget.ts:16` | —                                                                                                                                                       |
| Fala 1 korzenia (`site_settings`, tokeny, `globalColors`) | `min(termin, +400 ms)` (`HOME_THEME_BUDGET_MS`, `homeSsrBudget.ts:17`)     | `__root.tsx:835-850`  | anulowanie i `no-store` (`__root.tsx:852-863`)                                                                                                          |
| Chrome (ticker, baner, widgety nagłówka/stopki)           | `remainingHomeBudget(termin, 500)`                                         | `__root.tsx:947-950`  | `expired()` → `markDegraded("failed")` i render na fallbackach **bez dalszego czekania** (`__root.tsx:1059-1061`, `src/lib/ssr/chromeWarmup.tsx:58-63`) |
| Trasa `/`: `home.page`, `home.mode`, `home.settings`      | `deadlineAt` przez `loadResilient`                                         | `index.tsx:121-140`   | zasiew fallbacku z `updatedAt: 0` (`resilientLoad.ts:147-153`)                                                                                          |
| Widgety nad zgięciem                                      | `min(reszta, 500 ms)` (`HOME_ABOVE_FOLD_BUDGET_MS`, `homeSsrBudget.ts:18`) | `index.tsx:239-249`   | `degraded                                                                                                                                               |     | =` za każdy brakujący klucz |
| Werdykt                                                   | —                                                                          | `index.tsx:270`       | `resilientCacheControl(degraded)` → `private, no-store` (`resilientLoad.ts:185-190`)                                                                    |

**Ścieżka krytyczna treści strony głównej** (`src/lib/queries/public.ts:470-541`) to trzy szeregowe
round-tripy:

1. `fetchReadingSettings()` → `fetchAllSiteSettings` (bulk `site_settings`), `public.ts:476`;
2. `pages` select (wiersz strony; w najgorszym razie id, potem slug, potem `home`), `public.ts:497-531`;
3. `rpc/get_entity_content`, `public.ts:538`.

Z IAD daje to 3 × ~200-300 ms ≈ 600-900 ms, czyli przy terminie 600 ms rzut monetą. Potem jest
jeszcze fala widgetów nad zgięciem (`posts` × kilka, zależne od `builder_data`). Fale strony
głównej rozpisuje dokładnie `faza1/raporty/server-cache.md` §3: W1 → W2 → W3 → W4, a W5 idzie
strumieniem.

### 2.2 Trzy klasy zdegradowanego MISS-a [F, z HTML i stanu zdehydratowanego]

| klasa         | rozmiar     | co brakuje / dlaczego                                                                                                                                                                                                                                                                                                                                                                        | czy dokument kompletny dla czytelnika                                        |
| ------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **A** (8/16)  | ~185 KB     | `["public","home-page"]` ma `dataUpdatedAt:0`, czyli fallback z `loadResilient` (label `home.page`). `Index` pokazuje `HomeLoadingNotice` (`index.tsx:435-441`): „Wczytujemy stronę główną. Treść nie dotarła jeszcze z serwera…”. Brak slidera hero (sekcja `e0439441…`), 7 sekcji pod zgięciem, tickera i preloadu LCP: `heroPreloads` jest puste, bo `contentDegraded` (`index.tsx:227`). | **Nie**: tylko nagłówek, komunikat, sekcja przed stopką, stopka i baner zgód |
| **B1** (5/16) | ~460-468 KB | Brak paska „Warte przeczytania” (ticker w nagłówku). Zegar chrome wygasł, więc `readChromeWarmup` od razu oznacza `failed` i renderuje nagłówek na pustym wpisie (`chromeWarmup.tsx:58-63`). Zasłania to też wynik loadera.                                                                                                                                                                  | Prawie: brak tylko tickera                                                   |
| **B2** (3/16) | ~499-508 KB | Tekst identyczny z czystym HIT-em (różnica 0 linii). Sekcje dociągnął `ServerSectionGate` strumieniem (7 bloków `<div hidden id="S:…">`). Mimo to `degraded:true`: dane widgetów nad zgięciem nie leżały w cache w chwili końca loadera (`index.tsx:242-249`). Wniosek przez eliminację, bo `home-page`/`home-mode`/`settings`/tokeny mają w stanie końcowym prawdziwe `dataUpdatedAt`.      | **Tak**                                                                      |

Zasada działania bramki potwierdza B2. Według `src/lib/builder/sectionStreaming.tsx:1-5` zapytania
spóźnione względem terminu loadera „stream real HTML without delaying the shell. This includes the
first fold”. Werdykt cache zapada jednak w loaderze, zanim strumień się skończy.

### 2.3 Co widzi czytelnik i co to robi z LCP/SI/CLS

- **Typ A [F + H].** Pierwsze malowanie to nagłówek i komunikat. Treść i hero pojawiają się dopiero
  po kolejnych krokach:
  1. pobranie i wykonanie bootu JS (od P2.1 boot startuje po LCP, a kandydatem LCP jest tu tekst
     komunikatu);
  2. hydratacja;
  3. refetch `home-page` z przeglądarki, bo zasiew ma `updatedAt: 0` (round-trip do eu-west-1);
  4. zapytania widgetów;
  5. pobranie obrazu.

  Skutki dla realnego czytelnika:
  - LCP to nowy, większy element sekundy po FCP;
  - SI rośnie, bo treść dochodzi późno;
  - **[H]** ryzyko CLS: komunikat zastępują 13 sekcji, a stopka bywa w oknie na desktopie.
    Do potwierdzenia RUM-em P0.6 (stan cache × CLS).

  Bot dostaje typ A tak samo, bo `allReady` nie pomaga: komunikat nie jest granicą Suspense. Dla PSI
  typ A oznaczałby LCP zależne od łańcucha JS i danych, czyli katastrofę wyniku. Dziś PSI widział
  B1/B2, ale przy tym samym terminie typ A jest możliwy.

- **Typ B1 [H].** Ticker dociąga klient po hydratacji. `HeaderSkeleton` czyta ten sam pusty wpis
  (`__root.tsx`, komentarz przy `headerAds`), więc nie rezerwuje miejsca na pasek. Możliwe
  przesunięcie całej strony.
- **Typ B2.** Czytelnik dostaje pełną stronę. Kosztem jest tylko TTFB i brak zapisu, więc następny
  czytelnik na innym izolacie płaci to samo.

---

## 3. Pytanie 2: co to jest `edge-routing` (~270-840 ms na zimno)

### 3.1 Kod w tej fazie [F]

Zegar obejmuje WYŁĄCZNIE `resolveRedirectForRequest` w `redirectMiddleware` (`src/start.ts:341-373`,
pomiar w liniach 357-359). Kolejność jest szeregowa:

1. `resolveTenantForHost(url.hostname)` (`src/lib/seo/redirects.server.ts:383`) →
   `getTenantDirectory` → `loadDirectory`:
   - migawka `readBootstrapSnapshot("tenants")` w Cache API (`src/lib/server/tenant.server.ts:131`);
   - jeśli jej brak, odczyt planem service-role `tenants` z budżetem 1500 ms (`tenant.server.ts:136`);
2. `getIndexForTenant(tenant.id)` (`redirects.server.ts:385`): migawka `redirects:<tenant>`
   (`redirects.server.ts:136-145`), a jeśli jej brak, `redirects` select z budżetem 1500 ms
   (`redirects.server.ts:147-156`).

W stanie ustalonym oba katalogi żyją w pamięci izolatu (SWR: tenants 60 s, przekierowania 30 s,
odświeżanie w tle), więc `edge-routing` = 0. Ten sam katalog obsługuje `trustedPublicHost` w cache
dokumentów (`documentCache.server.ts:815`). Pozostałe middleware są czyste i nie dotykają bazy:
`homepageLangMiddleware` (`start.ts:135-183`, sama negocjacja cookie/`Accept-Language`),
`legacyLangQueryMiddleware`, `gpcMiddleware` i `tenantAssertionMiddleware` (po `next()`).

### 3.2 Dlaczego zimny izolat płaci 270-840 ms [F/H]

Migawki bootstrap przetrwałyby dobę (`bootstrapCache.server.ts:42-56`), więc na zimnym izolacie
w kolonii z ruchem `edge-routing` powinien wynosić ~0. Zmierzone wartości, 270-290 ms przy jednej
fali i 470-840 ms przy dwóch, oznaczają, że migawka nie wróciła z Cache API. To ten sam objaw co
martwe L2 z §0.1 **[H]**. Jeden odczyt service-role z IAD do eu-west-1 kosztuje ~140-420 ms,
z czego część to nowe połączenie świeżego izolatu.

### 3.3 Czy da się to zcache'ować albo wyeliminować

Tak, w kolejności opłacalności:

1. Działające L2 (R1): migawki tenantów i przekierowań z doby, więc ~0 ms na zimnym izolacie
   w kolonii, która miała ruch.
2. Jedna fala zamiast dwóch (R4a): przekierowania filtrowane po domenie hosta w jednym zapytaniu,
   na przykład embed `tenants!inner(domain)` w PostgREST, albo jedno RPC
   `routing_bootstrap(host)` z wynikiem tenant + reguły.
3. Lookup NES cache przed `redirectMiddleware` (P7.2/SC-4, R4b) dla `GET text/html` na kluczach
   cache'owalnych. HIT omija routing w ogóle.

---

## 4. Pytanie 3: dlaczego mobile ciągle MISS, a desktop raz HIT, raz MISS

### 4.1 Klucz [F]

Klucz ma postać `${host}::${pathname}?page=…&sort=…` (`src/lib/http/documentCache.ts:196-225`).
Czego w nim nie ma:

- **UA i urządzenia**: SSR nigdzie nie czyta UA ani `sec-ch-ua-mobile` (grep `src/`);
- **języka z nagłówka**: PL to `/`, EN to `/en`, a `Accept-Language` decyduje wyłącznie o 302
  w `homepageLangMiddleware` (`start.ts:135-183`), który stoi PRZED cache;
- **`Sec-GPC`**: `gpcMiddleware` stoi nad `documentCacheMiddleware` i dokleja `Vary: Sec-GPC` oraz
  ciasteczko po odtworzeniu wpisu (`start.ts:528-531, 561-563`);
- **ciasteczek innych niż `sb-*`**: tylko `sb-*` i `Authorization` dają BYPASS (`documentCache.ts:201-206`).

`nes_lang` i `__cf_bm` są ignorowane. Przy `accept: text/html` odpowiedź niesie dodatkowo
`Set-Cookie: nes_lang=pl` i `Vary: Sec-GPC, Accept-Language` z `homepageLangMiddleware`. To dzieje
się poza wpisem cache i niczego nie rozdziela.

### 4.2 Mechanizm serii MISS-ów [F/H]

1. L1 to mapa w pamięci izolatu. L2 nie działa (§0.1, **[H]**).
2. Każde nowe połączenie TCP trafia w IAD na inną maszynę, czyli inny izolat. HIT jest tylko wtedy,
   gdy trafi na izolat, który już ma wpis.
3. Zimny izolat renderuje z bazy w eu-west-1, przekracza 600 ms i wychodzi `degraded`
   (`private, no-store`). Nic się nie zapisuje (`documentCache.server.ts:628-631, 640-653`).
4. Po zdegradowanym MISS-ie startuje odświeżenie w tle (`scheduleDegradedRevalidation`,
   `documentCache.server.ts:359-389`). Biegnie już z rozgrzanym `edgeTtlCache`, zwykle oddaje czysty
   dokument i zapisuje go do L1 **tego jednego izolatu**. Tak powstały wpisy HIT o wieku 4 s
   (po mob-2) i 3,6 s (po l2chk-1).
5. Wpis w L1 żyje 180 s jako HIT, a potem do 24 h jako STALE: podawany od razu, z odświeżeniem
   w tle (`documentCache.ts:47,57`). Izolat, który raz złapał wpis, odpowiada szybko do końca
   życia. Pozostałe nie.

### 4.3 Limit prób odświeżenia po degradacji [F]

Limit to 2 próby na klucz na 10 min (`documentCache.server.ts:340-389`), ale **na izolat**.
W reżimie „każde żądanie to nowy izolat” pierwsza próba zawsze się odpala. Limit nie blokuje
zasiewu. Blokuje go to, że zasiew zostaje w jednym izolacie.

### 4.4 Jaki wariant dostaje PSI

PSI: `Chrome-Lighthouse`, `Accept-Language: pl` (`locale=pl`), bez ciasteczek.

- **Klucz [F]:** ten sam co przeglądarki, `neweuropeanstrategies.com::/`.
- **Na HIT/STALE [F]:** dostaje wariant, który izolat zapisał. To albo render przeglądarki
  (strumieniowy), albo render bota, bo odświeżenie w tle kopiuje UA żądania wyzwalającego
  (`src/server.ts:161-182`, `"user-agent"` w linii 169).
- **Na MISS [F]:** `isbot` zwraca true (sprawdzone na `isbot@5.1.39`), więc TanStack czeka na
  `stream.allReady` przed pierwszym bajtem
  (`node_modules/@tanstack/react-router/dist/esm/ssr/renderRouterToStream.js:31`). Dokument
  wychodzi pełny (W5 włącznie), z TTFB 1,7-3,4 s z IAD.
- **Czy jest zapisywany [F]:** w 4/4 próbach `degraded:true`, więc nie. Zapisuje się dopiero
  odświeżenie w tle, z UA PSI, czyli wariant bota, i tylko w L1 izolatu, który obsłużył PSI.
- **Kolonia PSI [H]:** pagespeed.web.dev otwarte z Polski najpewniej mierzy z europe-west, czyli
  kolonii AMS/FRA, gdzie RTT do Dublina to ~15-25 ms i rendery rzadziej się degradują. PSI z CI
  (`.github/workflows/psi.yml`, runner GitHuba w USA) może mierzyć z USA, gdzie obowiązuje obraz
  z tego raportu. Kolonii PSI nie da się dziś odczytać z telemetrii, bo `colo` jest puste (§0.1).

### 4.5 Czy L2 jest zapisywane i czytane [F w kodzie, H w produkcji]

W kodzie tak. Zapis: `applyDeferredDocumentStore`, a w nim `l2Put` (`documentCache.server.ts:786`).
Odczyt: `l2Match` przed renderem (`documentCache.server.ts:927`). W produkcji nie zaobserwowano ani
jednego `nes-layer;desc="L2"`, a dowody z §1 i §3.2 wskazują, że Cache API jest wyłączone.
`getColoCache()` (`documentCacheL2.server.ts:92-100`) uznaje `caches.default` za dostępne, jeśli
obiekt ma metody `match`/`put`. Błędy połyka (`documentCacheL2.server.ts:204-206, 243-245`),
a `l2Stats().enabled` (`:281`) najpewniej melduje `true`. Karta `/admin/performance` może więc
pokazywać „L2 włączone” przy martwej warstwie. Do sprawdzenia: `l2.hits` = 0 przy `l2.stores` > 0
albo `stores` = 0.

---

## 5. Pytanie 4: rozgrzewka (P0.7)

| element                                                                                                                    | stan [F]                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0.7 (pg_cron + pg_net, monitor wieloregionowy, UA Chrome)                                                                 | **nie wdrożone**: „odłożone (cron rozgrzewania; decyzja później)” (`faza2/STAN-FALI-0.md:36`), „plan zakłada brak cronu” (`faza2/PLAN-FALE-1-2.md:26`). Nie ma migracji `*_edge_warm_cron.sql`.          |
| Stary warmer: krok „Warm NES Edge Cache” w `.github/workflows/scheduler.yml:166-176`, skrypt `scripts/warm-edge-cache.mjs` | **No-op**: `vars.APP_BASE_URL` nie jest ustawione, a log przebiegu 37743752408 (2026-10-08 07:29Z) mówi „[warm] brak WARM_BASE_URL/APP_BASE_URL - pomijam grzanie cache.” (`warm-edge-cache.mjs:31,74`). |
| Częstotliwość                                                                                                              | `cron: "*/5 * * * *"` (`scheduler.yml:33`), ale GitHub dławi harmonogram: 40 przebiegów od 2026-10-01 14:49 do 2026-10-08 07:29, co ~2-6 h.                                                              |
| Kolonie                                                                                                                    | Runner GitHuba (USA), więc najwyżej jedna kolonia w USA.                                                                                                                                                 |
| UA                                                                                                                         | `NES-EdgeWarmer/1 (+github-actions)` (`warm-edge-cache.mjs:58`). Dla `isbot` to przeglądarka, więc wariant strumieniowy.                                                                                 |
| ścieżki                                                                                                                    | `/,/en,/blog,/en/blog`                                                                                                                                                                                   |

**Dlaczego nie utrzyma HIT-u PSI nawet po skonfigurowaniu [F/H].** Przy samym L1 jedno żądanie
warmera trafia jeden losowy izolat jednej kolonii, a PSI trafi w inny izolat, a zwykle także
w inną kolonię. Warmer ma sens dopiero przy działającym L2, i wtedy wystarcza jedno czyste
renderowanie na kolonię na dobę: przez 24 h wpis jest podawany jako STALE od ręki. Pg_cron z bazy
w eu-west-1 grzałby kolonię najbliższą Dublinowi (DUB/LHR), a nie AMS/FRA, z których mierzy PSI.

---

## 6. Pytanie 5: region Supabase, round-tripy, P7.2/P7.3

- **Region [F]:** rekord AAAA `db.unnltowbgszpdzwpawdu.supabase.co` to
  `2a05:d018:8eb:2f02:a376:769b:5fec:4bad`. Adres należy do prefiksu `2a05:d018::/35`, który według
  oficjalnego `ip-ranges.json` AWS to **eu-west-1, EC2 (Dublin)**. Endpoint REST
  (`unnltowbgszpdzwpawdu.supabase.co` → 104.18.38.10) stoi za Cloudflare Supabase, więc Worker idzie
  do brzegu Cloudflare, a stamtąd do eu-west-1.
- **Koszt z IAD [F]:** 146-330 ms na wywołanie PostgREST (Σ/n z `server-timing`).
- **Koszt z kolonii EU [H, ogólna wiedza o RTT]:** AMS/FRA/LHR ↔ DUB ~15-25 ms, WAW ↔ DUB ~35-45 ms,
  czyli rząd 40-120 ms na wywołanie.
- **Round-tripy zimnego MISS-a `/` [F]:**
  - 2 service-role, szeregowo (`edge-routing`);
  - 23-24 anon w 4 szeregowych falach przed powłoką i jednej strumieniowej (pełny render bota
    z dzisiaj). Struktura fal w `faza1/raporty/server-cache.md` §3.
  - Z tego ścieżka krytyczna treści to W1 → W2 → W3 (§2.1), a W4 (widgety nad zgięciem) zależy od
    `builder_data`.
- **P7.3 [plan, `faza1/PLAN.md:634-643`]:** `get_homepage_bundle(_lang)` zwija ustawienia czytania,
  wiersz strony i bramkowane ciało w jedno wywołanie. Ścieżka krytyczna spada z 3 fal do 1, a cały
  zimny MISS z 4 fal do 2. Z IAD treść jest gotowa po ~200-330 ms zamiast 600-900 ms, czyli
  w terminie, więc znika typ A. Z EU zysk jest mniejszy.
- **P7.2 [plan, `PLAN.md:623-632`]:** SC-2 to prefiksy `builder:`/`ad_placements:`/`ticker_posts:`
  w L2 danych, SC-3 mark-stale, SC-4 lookup przed przekierowaniem, SC-7 brotli, M4 deterministyczny
  wariant. **Uwaga [F/H]:** SC-2 i SC-3, a także już „wykonane” punkty audytu
  `AUDYT_CWV_ZIMNE_OTWARCIE_2026-09-20.md` (1.3 L2 danych, F01 przeżycie migawek, 1.5 `l2Delete`),
  stoją na tym samym Cache API. Bez R1 dają produkcyjnie zero.
- **Macierz własności (fala 7, `PLAN.md:1029-1047`):**
  - P7.2 ma `documentCache.server.ts`, `documentCache.ts`, `documentCacheL2.server.ts`,
    `ssrCache.ts`, `ssrCacheL2.server.ts`, `start.ts` i `audit.server.ts`;
  - P7.3 ma `queries/public.ts`, `routes/__root.tsx`, `routes/index.tsx` i migrację
    `get_homepage_bundle`;
  - **poza macierzą** (wymaga zgody orkiestratora): `bootstrapCache.server.ts`,
    `mediaCache.server.ts`, `responseHeaders.ts`, `chromeWarmup.tsx`, `homeSsrBudget.ts`,
    `redirects.server.ts`, `tenant.server.ts`, `src/server.ts` (właściciel W0: P0.4) i
    `scheduler.yml`/`warm-edge-cache.mjs` (właściciel W0: P0.7).

---

## 7. Przyczyny źródłowe (ranking wpływu)

| #   | przyczyna                                                                                                                           | status                                                  | plik:linia                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Cache API (`caches.default`) wyłączone w runtime hostingu, więc martwe są L2 dokumentów, L2 danych, migawki routingu i cache mediów | H (silna: 3 objawy + dokumentacja CF dla WfP untrusted) | `documentCacheL2.server.ts:92-100`; konsumenci `bootstrapCache.server.ts:72-121`, `ssrCacheL2.server.ts:111,148`, `mediaCache.server.ts:17` |
| P2  | Wspólny termin 600 ms na stronie głównej przy 3 szeregowych falach do eu-west-1                                                     | F                                                       | `homeSsrBudget.ts:16-18`, `index.tsx:121-140`, `public.ts:474-541`                                                                          |
| P3  | Werdykt zapisu zapada w loaderze (~600 ms), a nie po strumieniu, więc dokumenty kompletne (B2) i prawie kompletne (B1) są odrzucane | F                                                       | `index.tsx:242-249,270`; `chromeWarmup.tsx:58-63`; `__root.tsx:1059-1061`; `documentCache.server.ts:628-653`                                |
| P4  | `edge-routing`: 2 szeregowe odczyty service-role przed cache dokumentów                                                             | F (koszt), H (dlaczego migawki nie działają, patrz P1)  | `start.ts:341-373`, `redirects.server.ts:375-394`, `tenant.server.ts:118-166`                                                               |
| P5  | Brak rozgrzewki: zmienna nieskonfigurowana, harmonogram GitHuba co 2-6 h, P0.7 odłożone                                             | F                                                       | `scheduler.yml:33,166-176`, `warm-edge-cache.mjs:31,74`                                                                                     |
| P6  | Wariant zapisany zależy od UA, które wyzwoliło render albo rewalidację; bot czeka `allReady` na MISS                                | F                                                       | `server.ts:161-182`; `renderRouterToStream.js:31`                                                                                           |
| P7  | Telemetria ślepa na kolonię i L2: `colo` puste, `l2Stats.enabled` mierzy obecność obiektu, nie działanie                            | F (objaw), H (przyczyna: brak `request.cf`)             | `server.ts:386-390,501-504`; `ssrTiming.ts:148-159,197-204`; `documentCacheL2.server.ts:281`                                                |
| P8  | Start zimnego izolatu i render na zimnym JIT: 0,8-2,4 s poza `app;dur`                                                              | H                                                       | — (zamrożony zegar; `server.ts:306-317`)                                                                                                    |

---

## 8. Zmiany: ranking według wpływ/ryzyko

### R1. Przywrócić L2 przez nazwany cache, dodać samotest i build id w kluczach

Wpływ: **największy** (PSI i realni użytkownicy). Ryzyko: niskie-średnie. Nakład: S-M.

- **Pliki:** `src/lib/http/documentCacheL2.server.ts` (P7.2). Celowo tylko ten plik: fasada zachowuje
  synchroniczny kontrakt `getColoCache()`, więc `bootstrapCache.server.ts`, `ssrCacheL2.server.ts`
  i `mediaCache.server.ts` działają bez zmian.
- **Mechanizm:**
  - `getColoCache()` zwraca fasadę nad `caches.open("nes-edge-v1")` otwartym leniwie, raz na izolat:
    `match`/`put`/`delete` czekają na `opened`. Dopiero gdy nazwany cache jest niedostępny, kod
    wraca do `caches.default`.
  - Samotest raz na izolat, pod `runAfterResponse`: `put` i potem `match` klucza z nonce. Wynik idzie
    do `l2Stats().verified` i do linii logu dokumentu, a `enabled` zależy od niego, nie od obecności
    obiektu.
  - **Obowiązkowo** identyfikator buildu w ścieżce kluczy dokumentu (`DOC_PATH/<build>/<globalVer>/<hostVer>/…`).
    Dziś L1 znika z każdym deployem, bo nowe izolaty startują puste. Działające L2 z oknem STALE
    24 h podawałoby HTML wskazujący chunki poprzedniego deployu. Build id musi być stały per build:
    stała z `define` w Vite albo URL chunka wejścia. Fallback `rt-<Date.now()>` z
    `routes/api/public/version.ts:14-16` jest per izolat i się nie nadaje.
- **Dlaczego to powinno działać [H]:** dokumentacja CF dla dispatch namespace w trybie untrusted
  mówi, że `caches.default` jest wyłączone, ale „Each Worker has an isolated cache, when using the
  Cache API”. Nazwany cache jest więc izolowany per skrypt, ale wspólny dla jego izolatów w kolonii.
  To dokładnie semantyka, której potrzebujemy. Dowodem będzie dopiero samotest w produkcji.
- **Efekt:**
  - na zimnym izolacie z wpisem w kolonii L2 HIT/STALE kosztuje kilka ms zamiast 0,9-1,5 s
    `app;dur` z IAD; TTFB to transport plus start izolatu (P8);
  - `edge-routing` na zimnym izolacie spada do ~0 (migawki z doby);
  - L2 danych (`site_settings_public`, tokeny, menu, `public:home-*`) skraca W1-W3 przy MISS-ie
    dokumentu, np. po purge, więc typów A jest dużo mniej.
  - **PSI:** P(MISS) w kolonii, która w ciągu 24 h podała `/` choć raz czysto, spada do ~0, bo STALE
    jest podawane od ręki z odświeżeniem w tle. Każdy uniknięty MISS to według modelu planu
    +3,4 pkt mobile / +4,8 pkt desktop przez SI (`PLAN.md:40`).
- **Ryzyko i mitygacja:**
  - skew deployu: build id;
  - purge staje się realny per kolonia (dotąd bump i `delete` były no-op), a inne kolonie doganiają
    w oknie świeżości jak dziś izolaty (decyzja D2);
  - koszt odczytu ~500 KB z Cache API na zimnym izolacie jest pomijalny;
  - gdy `caches.open` też jest wyłączone, samotest zgłasza `false` i zachowanie zostaje jak dziś
    (wtedy R1′: L3 przez Supabase Storage + CDN albo KV, SC-6 z `faza1/raporty/server-cache.md` §4b).
- **Test lokalny:**
  - `bunx vitest run src/lib/http/__tests__/documentCacheL2.test.ts src/lib/http/__tests__/documentCache.server.test.ts src/lib/http/__tests__/platformCacheLifecycle.test.ts src/lib/http/__tests__/bootstrapCache.server.test.ts src/lib/__tests__/ssrCacheL2.server.test.ts src/lib/http/__tests__/mediaCache.server.test.ts`;
  - nowy test podstawia `globalThis.caches = { default: <atrapa no-op>, open: async () => <Map-cache> }`
    i sprawdza HIT z L2 po `resetDocumentCacheForTests()`, czyli „rotacji izolatu”, oraz
    `l2Stats().verified`;
  - drugi przypadek: `open` rzuca, więc fallback i `verified:false`.
- **Weryfikacja produkcyjna:**
  - seria 10 curl co 3 s: na zimnych izolatach (`edge-routing` > 0 przed zmianą) ma pojawić się
    `nes-layer;desc="L2"`, a `edge-routing` ma spaść do ~0;
  - w Workers Logs `layer=L2` > 0.

### R2. Werdykt zapisu na końcu strumienia: przechowywać kompletne dokumenty B2, domknąć B1

Wpływ: wysoki. Ryzyko: średnie. Nakład: M.

- **Pliki:**
  - `src/routes/index.tsx:239-249,270` (P7.3);
  - `src/lib/http/documentCache.server.ts:705-767` (P7.2);
  - poza macierzą: `src/lib/http/responseHeaders.ts` (nowy rejestr), `src/lib/ssr/chromeWarmup.tsx:52-77`;
  - `src/routes/__root.tsx:1059-1061` (P7.3).
- **Mechanizm:**
  - (a) Spóźnione dane widgetów nad zgięciem nie ustawiają już `no-store`. Loader rejestruje
    predykat kompletności `registerDocumentCompletenessCheck(request, fn)` (WeakMap po `Request`,
    wzorzec `routeCacheDirectives` z `responseHeaders.ts:41-83`). `fn` sprawdza, czy na końcu
    strumienia każde zapytanie w `QueryClient` żądania ma `status==="success"` i
    `dataUpdatedAt>0`. Wyjątkiem jest jawna lista celowych zasiewów, dziś
    `["post-layout-settings"]` (`__root.tsx`). Do tego żaden rekord `ServerSectionGate` nie może
    mieć `exhausted`.
  - (b) `applyDeferredDocumentStore` na końcu strumienia (`documentCache.server.ts:760`) wywołuje
    predykat. Gdy wynik to `false`, dokument dostaje `degraded` i rusza obecne odświeżenie w tle.
    Gdy `true`, dokument jest zapisywany. Świeżość trzeba liczyć z dyrektywy końcowej: dziś rekord
    ma `freshMs/swrMs` z chwili rejestracji (`:641-652`).
  - (c) Chrome przy `expired()` (B1): zamiast natychmiastowego `failed` z renderem na fallbackach,
    `ChromeDataGate` zawiesza granicę nagłówka z ograniczonym budżetem, jak `ServerSectionGate`
    (np. 1-1,5 s), i oznacza `chrome`. Ticker dostrumieniowuje się, a predykat (a) decyduje o zapisie.
  - Typ A (zasiew `home-page`) zawsze zostaje `no-store`: predykat go wykrywa, bo `dataUpdatedAt:0`.
- **Efekt:**
  - z 16 dzisiejszych zimnych MISS-ów 3 (B2) byłyby zapisane od razu, a 5 (B1) po (c);
  - pierwszy czytelnik zasiewa L1 (a z R1 także L2), zamiast liczyć na odświeżenie w tle;
  - PSI: jego render `allReady` jest kompletny z konstrukcji, więc jego własny MISS zasiewa izolat
    i kolonię dla kolejnych przebiegów (zob. R6, decyzja o wariancie);
  - dla czytelnika (c) usuwa późne wskakiwanie tickera (**[H]** CLS).
- **Ryzyko:** zbyt luźny predykat zamroziłby niekompletny dokument na 180 s plus do 24 h STALE.
  Mitygacja: predykat konserwatywny (każde odstępstwo oznacza brak zapisu) i testy negatywne.
- **Testy:**
  - `src/lib/http/__tests__/degradedRenderCachePipeline.test.ts`, `documentCache.server.test.ts`;
  - `src/routes/__tests__/homeRoute.test.tsx`;
  - `src/lib/ssr/__tests__/platformChromeWarmup.test.tsx`, `resilientLoad.test.ts`, `homeSsrBudget.test.ts`;
  - `src/__tests__/startPipeline.test.ts`;
  - `check:ssr-budgets`, `check:loader-policy`.

### R3. Ścieżka krytyczna treści strony głównej (typ A)

Wpływ: wysoki dla kolonii dalekich od Dublina (USA, Googlebot, PSI z CI). Ryzyko: (a) niskie,
(b) średnie. Nakład: (a) S, (b) M.

- **(a) Wariant przejściowy.** `home.page` i `home.mode` dostają własny budżet, np. 1 200 ms,
  niezależny od wspólnych 600 ms. Widgety i chrome zostają przy 600 ms.
  - Pliki: `src/routes/index.tsx:121-135` (P7.3), nowa stała w `src/lib/ssr/homeSsrBudget.ts`
    (poza macierzą; bramka `check:ssr-budgets` czyta stałe po nazwie).
  - Efekt: typ A znika, gdy łańcuch 3 fal mieści się w 1,2 s (z IAD 0,6-0,9 s). Taki MISS ma TTFB
    wyższy o ≤0,6 s, ale jest kompletny i, z R2, zapisany.
- **(b) Docelowo P7.3.** `get_homepage_bundle(_lang)` zasila TE SAME klucze react-query
  (`["public","home-page"]`, `["public","home-mode"]`) z tymi samymi projekcjami. Ścieżka krytyczna
  to 1 round-trip: ~200-330 ms z IAD, ~40-100 ms z EU.
  - Pliki: `src/lib/queries/public.ts:450-541`, `routes/index.tsx`, `routes/__root.tsx`, migracja.
  - Ryzyko: RLS i bramkowane ciało (`get_entity_content` jest SECURITY DEFINER), parytet kluczy
    SSR/hydratacja.
  - Testy: `homeRoute.test.tsx`, pgTAP, `check:rpc-contract`, `check:ssr-budgets`,
    `check:loader-policy`, fixture z opóźnieniem 200 ms/zapytanie (`faza1/raporty/server-cache.md` §0.3).
- **Efekt na PSI:** zero w laboratorium przy HIT. Na MISS z kolonii dalekiej usuwa ryzyko typu A,
  czyli katastrofy LCP.

### R4. `edge-routing` w jednej fali albo poza ścieżką HIT

Wpływ: średni (−0,3…−0,8 s na zimnym izolacie w USA, −0,05…−0,15 s w EU). Po R1 w dużej części
zbędne.

- **(a) Jedna fala, ryzyko niskie.** Przekierowania dobierane po domenie hosta jednym zapytaniem
  (embed `tenants!inner(domain)` albo RPC service-role `routing_bootstrap(_host)` z wynikiem tenant
  - reguły), równolegle z katalogiem albo zamiast niego.
  * Pliki: `src/lib/seo/redirects.server.ts:375-394`, `src/lib/server/tenant.server.ts` (poza macierzą).
  * Testy: istniejące testy przekierowań i tenantów (`src/lib/seo/__tests__`,
    `src/lib/server/__tests__`), `platformRequestHost.test.ts`.
- **(b) P7.2/SC-4, ryzyko średnie.** Lookup L1/L2 przed `redirectMiddleware` dla `GET`+`text/html`
  na kluczu cache'owalnym (`src/start.ts:546-565`, P7.2). Klucz z hosta surowego jest bezpieczny,
  bo wpisy powstają wyłącznie pod hostem zaufanym, a obcy host po prostu chybia. Uwaga: nowa
  reguła 301 dla ścieżki z wpisem działałaby dopiero po purge, a rewalidacja STALE takiej ścieżki
  dostałaby 301, więc wpis zostałby STALE na 24 h. Zapis reguły musi purge'ować jej `source_path`
  (`documentPaths` w `recordAudit` w `src/lib/redirects.functions.ts:97-204`).
  - Testy: `startPipeline.test.ts`, `documentCache.server.test.ts`.

### R5. Rozgrzewka, która rzeczywiście grzeje (po R1)

Wpływ: wysoki dla PSI po R1, ~0 przed R1. Ryzyko: niskie. Nakład: S.

- **Natychmiast (człowiek):** ustawić `vars.APP_BASE_URL` (dziś krok jest no-opem).
- **Właściwie (P0.7):** zewnętrzny monitor wieloregionowy (Amsterdam, Frankfurt, Warszawa,
  US-East) co 60-120 s z UA Chrome, `accept: text/html`, `accept-language: pl/en` na `/`, `/en`
  (+ `/blog`). Cron GitHuba jest za rzadki (2-6 h). Pg_cron z eu-west-1 grzeje tylko DUB.
- **Logowanie:** `x-nes-cache`, `nes-layer`, wiek wpisu, `cf-ray` i `degraded:![01]` z HTML (§1.1).
- **Efekt po R1:** HIT w koloniach PSI. Przed R1: tylko izolat, który akurat obsłużył warmer.

### R6. Deterministyczny wariant zapisu (M4)

Ryzyko: niskie. Nakład: S.

- **Pliki:** `src/server.ts:161-182` (W0/P0.4, poza macierzą W7).
- **Mechanizm:** odświeżenie w tle zawsze ze stałym, przeglądarkowym UA zamiast kopii UA
  wyzwalającego. Opcjonalnie, decyzja człowieka: rendery `isbot` niezapisywane, a po MISS-ie bota
  od razu odświeżenie z UA przeglądarki. Kolejny przebieg PSI trafi wtedy w wariant strumieniowy,
  ten sam, który mierzy harness (`--warm-ua browser`).
- **Efekt:** porównywalność przebiegów PSI. TTFB i SI się nie zmieniają.
- **Testy:** `startPipeline.test.ts`, `platformDeferredCache.test.ts`, `ssrTiming.server.test.ts`.

### R7. Telemetria, bez której nie da się potwierdzić R1-R5

Ryzyko: niskie. Nakład: S.

- **(a) Kolonia.** `request.cf` i `cf-ray` nie docierają do aplikacji: `colo` jest puste
  w `server-timing`. Opcja **[H]**: raz na izolat `fetch("/cdn-cgi/trace")` pod `waitUntil` i memo
  `colo=`. Wymaga sprawdzenia w runtime hostingu.
- **(b) L2.** `l2Stats().enabled/verified` z samotestu (R1).
- **(c) Przyczyna degradacji.** Etykiety `loadResilient` i chrome w linii logu (`degradedBy`,
  SC-1). Dziś widać tylko `degraded`.
- **Zapytania Workers Logs, które rozstrzygną hipotezy:**
  - udział `layer=L2`;
  - `degraded=true` per `uaClass` (`lighthouse`/`browser`/`bot`);
  - `isoReq==1` vs `wallTimeMs`/`cpuTimeMs` (P8);
  - `streamEnd`.

### R8. Start zimnego izolatu (poza zakresem P7)

- **[H]:** 0,8-2,4 s TTFB poza `app;dur` na zimnych izolatach to start skryptu (~13 MB) plus render
  na zimnym JIT, którego zamrożony zegar nie widzi.
- **Weryfikacja:** Workers Logs, `wallTimeMs` dla `isoReq==1`.
- **Dlaczego to ważne:** R1 nie usuwa tego kosztu. HIT L2 na zimnym izolacie wciąż płaci start.
  Dźwignia: mniejszy bundle serwera i leniwe moduły tras.

### Kolejność wdrożenia

1. R1 z samotestem.
2. R5: zmienna od ręki, monitor po R1.
3. R2.
4. R3a, potem R3b.
5. R4a.
6. R6, R7 równolegle.
7. R4b, R8.

---

## 9. Otwarte pytania i jak je zamknąć

1. **Czy hosting to WfP w trybie untrusted i czy `caches.open` działa?** Samotest z R1 (linia logu),
   ewentualnie odpowiedź od dostawcy hostingu. Przed zmianą warto sprawdzić `/admin/performance`:
   `l2.enabled`, `l2.stores`, `l2.hits` na jednym izolacie (karta pokazuje stan izolatu, który
   obsłużył żądanie).
2. **Z której kolonii mierzy PSI** (web UI z Polski i API z CI)? Dziś telemetria tego nie powie
   (R7a). Tymczasem: `psi-sample.mjs` klasyfikuje przebieg po `server-response-time`.
3. **Udział typów A/B1/B2 w koloniach EU** (WAW/FRA/AMS). Z IAD 100 % zimnych MISS-ów jest
   zdegradowanych. Dla EU potrzebne są Workers Logs (`degraded`) albo sonda Globalping
   (`POMIAR.md:268-286`) z kontrolą `degraded:![01]` w HTML.
4. **Typ A dla bota (PSI):** dziś 0/4, ale przy tym samym terminie jest możliwy (§2.3). Po R3
   znika jako ryzyko.
