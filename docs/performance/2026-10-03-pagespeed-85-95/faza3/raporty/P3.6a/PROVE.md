# P3.6a - dowód, runda 3 (po poprawce 10): build id ze stałej Vite, build w kluczu migawek, nonce rewalidacji

- Worktree: `scratchpad/wt3/P3.6a`, gałąź `perf/w3-P3.6a`, commit `fbbce0d2` (worktree czysty).
- Baza fali: `scratchpad/base-w3` (7c924ae5), zbudowana wcześniej, bez przebudowy.
- Data: 2026-10-08.
- Kroki ciężkie (build, e2e, Lighthouse) szły przez `heavy-bg.sh`, lekkie (bramki, vitest) przez `light.sh`.
- Wejście: `IMPL-fix10.md`, `REVIEW-10.md` (APPROVE, warunki Prove w §5).
- Wyniki poprzednich Prove (r1, fix9) przeniosłem do `r1/prove1/`. `r1/prove2/` jest bez zmian.

## 0. Werdykt w skrócie

- **Wszystkie bramki zielone, a skrypty bramek są bez zmian.** Dwie czerwone z Prove 1 i 2 (`check:bundle`,
  `check:entry-purity`) są teraz zielone, bez łatki `fix9-gates-scan-ssr.patch`. Pozostałe też zielone:
  - `check:chunks`;
  - `check:server-entry-purity`;
  - `test:e2e:artifact` 9/9;
  - waga dokumentu 28/28 (B i baza);
  - vitest pozycji: 38 plików, 706 testów.
- **Układ `.output/server` jak na bazie.** Manifest Start leży na najwyższym poziomie
  (`_tanstack-start-manifest_v-CtYZIb04.mjs`). Pliku `_ssr/bootManifest-*.mjs` nie ma. W `_ssr/` jest 1516 plików
  po obu stronach.
- **Stała `define` dotarła do bundla serwera** (MINOR-2 recenzji wykluczony):
  - `grep __NES_BUILD_ID__` w `.output/server` i `.output/public` nic nie zwraca;
  - w `_ssr/index.mjs` stoi literał `e="tmuzm6tdt"`, czyli `t` + base36 czasu buildu 2026-10-08T14:11:05Z;
  - `nes-edge-cache.internal` nie występuje w `.output/public`.
- **Bundle nie jest gorszy od bazy w żadnej metryce.** Liczby (overall/public/wejście/boot) są o włos lepsze:
  - overall 4751.7 KB wobec 4752.0 KB;
  - boot closure 486.8 KB gz, jak w bazie.

  Jedyna zmiana w kliencie to −98 B w chunku wejścia: z klienta zniknęło martwe IIFE nonce'a (§2.3).

- **Smoke dwóch izolatów z atrapą Cache API (§5): wszystkie warunki spełnione.**
  - Zimny izolat tego samego buildu daje `HIT` z `nes-layer;desc="L2"`, `app;dur=4`. Klucz to
    `/__nes/doc/tmuzm6tdt/0/0/…`.
  - Zimny izolat **nowego** buildu (`tSMOKEb2x`) daje `MISS` i render (290 ms) pod własnym kluczem. Migawki danych
    `edge:tSMOKEb2x:v0.0:…`: 9× MISS, 0× HIT. Dla porównania ten sam build: 4× HIT.
  - Po powrocie do buildu A zimny izolat znów daje `HIT` z L2.
- **Nonce (§5.3).** Odtworzyłem podatność na bazie w atrapie zakresu globalnego workerd. Na P3.6a jej już nie ma.
  - **Baza:** `x-nes-revalidate: nes-0` na świeżym wpisie daje `MISS`, wymuszony render, nowy zapis do L2 i
    `revalidation=true` w logu.
  - **P3.6a:** `nes-0`, `''`, `0` i obcy UUID dają `HIT` z L1, bez renderu i bez zapisu.
  - Przy ewaluacji modułów w zakresie globalnym P3.6a wywołuje losowanie 0 razy, a baza 1 raz.
- **Lighthouse A/B (mobile, n=2, kontrola regresji): brak regresji.**
  - Dokument A i B jest ten sam (330 868 B). Po normalizacji różnią się tylko portem i znacznikami czasu.
  - Żądania i księga zadań są te same, CLS 0.
  - Delty par mieszczą się w MDE(t).
  - Mediana SI Lantern ma +0.09 s, ale obserwowane SI (speedline) to 343 → 337 ms. To szum symulacji przy n=2
    (§4.2).
- `effect_matches_plan`: **yes dla struktury, inconclusive dla wielkości.**
  - Lokalnie L2 jest no-opem (brak `caches`), więc Lighthouse pokazuje tylko brak regresji.
  - Mechanizm (L2 z buildem w kluczu, unieważnienie przy deployu, nonce) jest dowiedziony na zbudowanym artefakcie.
  - Wielkość efektu (TTFB/SI na zimnych izolatach) zmierzy dopiero produkcja (procedura w `r1/prove2/PROVE.md` §6).
- **`needs_fix: false`.**

## 1. Build

| krok                                         | wynik                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| `env BUNDLE_INVENTORY=1 bun run build:smoke` | exit 0 (`build.log`), Vite „built in 2m 12s”                                          |
| wejście klienta                              | `index-CvxiDCwA.js` (baza: `index-BsLjjLsH.js`; różnica opisana w §2.3)               |
| manifest Start w artefakcie serwera          | `.output/server/_tanstack-start-manifest_v-CtYZIb04.mjs` (najwyższy poziom, jak baza) |
| `_ssr/bootManifest-*.mjs`                    | brak (w Prove 2 był, to przyczyna dawnej czerwieni)                                   |
| build id w bundlu serwera                    | `"tmuzm6tdt"` w `_ssr/index.mjs`, funkcja `l2BuildId` (`St()`)                        |

Fragment artefaktu (`_ssr/index.mjs`):
`function St(){let e="",t=!1;try{t=!0,e="tmuzm6tdt"}catch{}return e.replace(/[^A-Za-z0-9_-]/g,"_").slice(0,Tr)||(t?null:Ar)}`

`ssrCacheL2.server-DArLWS6F.mjs` składa klucz migawki `edge:${n}:v${o}.${r}:${t}::${a}`. Gdy build id jest `null`,
zwraca `null`.

## 2. Bramki artefaktu

| bramka                                                        | wynik                        | uwagi                                                                                |
| ------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------ |
| `check:bundle`                                                | **green**                    | `bundle.log`, liczby w §2.1                                                          |
| `check:chunks`                                                | green                        | 893 chunki, 6845 krawędzi, graf acykliczny                                           |
| `check:entry-purity`                                          | **green**                    | `index-CvxiDCwA.js` → 10 chunków, ścieżka czysta                                     |
| `check:server-entry-purity`                                   | green                        | 1813 plików; „leniwe wyłącznie: stripe.mjs”; dług `node-html-parser (2)` jak w bazie |
| `test:e2e:artifact` (mutex)                                   | green 9/9                    | `e2e-artifact.log`; pozycja nie dodała ani nie zmieniła speców e2e                   |
| `check-document-weight.ts` (B / baza)                         | green 28/28 / green 28/28    | §3                                                                                   |
| vitest pozycji (`light.sh`)                                   | green 38 plików / 706 testów | `vitest.log` (lista plików niżej)                                                    |
| grep `__NES_BUILD_ID__` w `.output/server` i `.output/public` | pusto                        | stała podstawiona                                                                    |
| grep `nes-edge-cache.internal` w `.output/public`             | pusto                        | moduł L2 nie trafił do klienta                                                       |
| typecheck                                                     | nie powtarzany               | zielony u implementera (`fix10/typecheck.log`); od tego czasu bez zmian kodu         |

Zestaw vitest:

- `src/lib/http/__tests__`;
- `src/lib/__tests__/ssrCacheL2.server.test.ts`, `src/lib/__tests__/ssrCacheL2.test.ts`;
- `src/lib/ci/__tests__/viteChunkParity.test.ts`;
- `src/__tests__/serverEntryRequestOptions.test.ts`, `src/__tests__/platformServerFailures.test.ts`.

Obejmuje to `revalidationNonce` (4), `revalidationNonceDriver` (1), `documentCacheGoneEviction` (10),
`documentLogTelemetry` (7) i `documentCacheL2BuildId` (7).

### 2.1 Liczby `check:bundle` vs baza W3

| metryka                 | baza W3                     | P3.6a                       | Δ           | budżet  |
| ----------------------- | --------------------------- | --------------------------- | ----------- | ------- |
| overall (gz)            | 4752.0 KB                   | 4751.7 KB                   | −0.3 KB     | 4772 KB |
| public (gz)             | 2801.7 KB                   | 2801.5 KB                   | −0.2 KB     | 2877 KB |
| admin-only (gz)         | 1950.2 KB                   | 1950.2 KB                   | 0           | -       |
| largest chunk (wejście) | 261.2 KB                    | 261.1 KB                    | −0.1 KB     | 286 KB  |
| client CSS / public CSS | 95.0 / 81.2 KB              | 95.0 / 81.2 KB              | 0           | 96 / 83 |
| liczba plików JS        | 895                         | 895                         | 0           | -       |
| boot closure            | 486.8 KB gz / 1596.5 KB raw | 486.8 KB gz / 1596.4 KB raw | 0 / −0.1 KB | 579 KB  |
| zapas overall           | 20.0 KB                     | 20.3 KB                     | +0.3 KB     | -       |

Linia boot (B):
`Boot closure: 486.8 KB gzip / 1596.4 KB raw  (10 chunków statycznie osiągalnych ze SSR-owego <script>; budget ≤ 579 KB)`

Ruchy względem baseline'u (b006c2e) są takie same jak w bazie:

- `+131.5 spreadsheet.worker (NOWY)`
- `-46.9 index`
- `-24.1 lucide-shim.fa`
- `+16.5 club._clubSlug.index`
- `+7.5 admin.seo (NOWY)`
- `+3.0 i18n-club`
- `-2.5 category._slug`
- `-2.5 icons-0`
- `-2.5 icons-1`
- `-2.4 profile.notifications`
- `-2.4 icons-3`
- `+2.4 SeoPanel`
- `znikł i18n-admin-seo-hub`

Ostrzeżenie o zapasie < 2% (overall 0.43%, css 1.06%) występuje także w bazie.

### 2.2 Układ artefaktu serwera

| element                           | baza                                                                                                                      | P3.6a                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| najwyższy poziom `.output/server` | 3× `_-*.mjs`, `_chunks`, `_libs`, `_ssr`, `_tanstack-start-manifest_v-*.mjs`, `index.mjs`, `node_modules`, `package.json` | to samo                                                                              |
| liczba plików w `_ssr/`           | 1516                                                                                                                      | 1516                                                                                 |
| `_ssr/bootManifest-*.mjs`         | brak                                                                                                                      | brak                                                                                 |
| chunk z `nes-edge-cache.internal` | -                                                                                                                         | `_ssr/index.mjs`, `_ssr/ssrCacheL2.server-*.mjs`, `_ssr/bootstrapCache.server-*.mjs` |

### 2.3 Jedyna różnica w kliencie: −98 B martwego IIFE nonce'a w chunku wejścia

Wynik `cmp-assets.mjs` (`cmp-assets.txt`):

- zmieniła się 1 grupa prefiksów, `index`: 1 000 391 → 1 000 293 B raw (−98 B), −37 B gz;
- pozostałe 901 plików `public/assets` mają identyczne rozmiary.

Diff chunku wejścia po normalizacji hashy (`entry-diff/`):

- poza permutacją nazw minifikatora (`T`↔`P`) jedyna zmiana to zniknięcie wyrażenia
  ``(()=>{try{return globalThis.crypto.randomUUID()}catch{return`nes-${Date.now().toString(36)}`}})()``;
- to IIFE `REVALIDATE_NONCE` z bazowego `documentCache.server.ts:243`. Wyciekło do klienta jako efekt uboczny
  w zasięgu modułu: tree-shaking nie mógł go usunąć.

Leniwe `revalidationNonce()` jest tree-shake'owalne. Klient przestaje więc wykonywać zbędne `randomUUID` przy boocie
i nie niesie tych bajtów. Dlatego hash wejścia jest inny niż w Prove 2 (`index-BLxTOEN-`). To nie jest regresja,
tylko 98 B mniej w boot closure.

## 3. Waga dokumentu (`document-weight.json` vs `document-weight-base.json`)

Obie strony zielone 28/28. Mediany:

| metryka                     | baza        | P3.6a       | Δ      | próg      |
| --------------------------- | ----------- | ----------- | ------ | --------- |
| htmlRawBytes                | 337 923 B   | 337 923 B   | 0      | 406 180 B |
| htmlGzipBytes               | 52 793 B    | 52 606 B    | −187 B | 56.4 KB   |
| headRawBytes                | 28 985 B    | 28 985 B    | 0      | 28.7 KB   |
| inlineStyleBytes / count    | 84 717 / 25 | 84 717 / 25 | 0      | 132.4 KB  |
| inlineScriptBytes           | 86 844 B    | 86 844 B    | 0      | 95.8 KB   |
| inlineExecutableScriptBytes | 79 600 B    | 79 600 B    | 0      | -         |
| dehydratedStateBytes        | 60 357 B    | 60 357 B    | 0      | 64.9 KB   |
| modulepreloadCount          | 0           | 0           | 0      | 0         |
| linkHeaderEntries           | 5           | 5           | 0      | -         |
| preloadDuplicates           | 3           | 3           | 0      | 3         |
| imagePreloadCount           | 3           | 3           | 0      | -         |
| imgFetchpriorityHigh        | 1           | 1           | 0      | 2         |
| bootClosureRawBytes         | 1 634 852 B | 1 634 754 B | −98 B  | 1599.4 KB |
| bootClosureGzipBytes        | 495 036 B   | 495 015 B   | −21 B  | 485.0 KB  |
| preloadedJsCount (High)     | 0           | 0           | 0      | 0         |
| renderBlockingCssGzipBytes  | 80 395 B    | 80 395 B    | 0      | 79.5 KB   |
| lcpCandidateCount / Missing | 1 / 0       | 1 / 0       | 0      | -         |
| preLcpTransferBytes         | 177 920 B   | 177 733 B   | −187 B | 177.3 KB  |
| bootBurstCount              | 26          | 26          | 0      | 26        |
| bootBurstGzipBytes          | 572 652 B   | 572 628 B   | −24 B  | 561.2 KB  |
| serverOnlyLeaks             | []          | []          | -      | -         |

Uwagi:

- −187 B gzip HTML to entropia znaczników czasu w stanie zdehydrowanym. Surowy HTML jest identyczny.
- −98 B raw w boot closure to IIFE z §2.3.
- Ratchet bez zmian: pozycja nie jest właścicielem plików wagi dokumentu, a zmiany są poniżej rozdzielczości progów.

## 4. Lighthouse A/B (kontrola regresji)

Komenda z polecenia (`--compare base-w3 wt3/P3.6a --runs 2 --forms mobile --client-backend fixture
--third-party fake-gtag --save-artifacts --warm-ua bot`). Katalog `lh/`, log `ab.log`.

- VALID: A mobile 2/2, B mobile 2/2, excluded 0. Load 0.2-0.7.
- Wariant dokumentu `s-maxage=900, 330868 B` x2 po obu stronach.
- Tryb FCP `bez-js` x2, pary mieszane 0/2.
- Rozgrzewka i przebiegi LH: `x-nes-cache=HIT`, `nes-layer=L1` po obu stronach.
- Lokalnie nie ma `caches`, więc nie ma też `nes-l2`.

### 4.1 Mediany i delty

| strona | perf | FCP    | LCP    | TBT    | SI     | CLS | TTFB  | TTI    | mainThread | bootup  | req | transfer | highBeforeLcpImg |
| ------ | ---- | ------ | ------ | ------ | ------ | --- | ----- | ------ | ---------- | ------- | --- | -------- | ---------------- |
| A      | 95   | 1.54 s | 2.30 s | 165 ms | 1.62 s | 0   | 14 ms | 5.40 s | 3167 ms    | 1380 ms | 71  | 913.8 KB | 112.3 KB         |
| B      | 95   | 1.57 s | 2.37 s | 194 ms | 1.71 s | 0   | 10 ms | 5.36 s | 3348 ms    | 1473 ms | 70  | 913.5 KB | 112.3 KB         |
| B−A    | −1*  | +0.03  | +0.07  | +29 ms | +0.09  | 0   | −4    | −0.04  | +181       | +93     | −1  | −0.3 KB  | 0                |

\* Delta score z logu harnessu. Mediana obu stron to 95.

`req` 71 vs 70 to przebiegi, w których po LCP fixture dostał dodatkowe `ad_placements`/`newsletter_settings` albo
fałszywy gtag się doładował (A-mobile-1: 1 skrypt gtag, B-mobile-1: 0). Nie zależy to od strony. W przebiegach
z dumpem audytów jest 70 żądań po obu stronach.

### 4.2 Pary (σΔ, MDE)

| metryka | Δ par    | σΔ      | MDE(t), n=2 | MDE(z)  | w szumie (t)?        |
| ------- | -------- | ------- | ----------- | ------- | -------------------- |
| score   | −0.5     | 2.1     | 21.1        | 4.2     | tak                  |
| FCP     | +0.034 s | 0.050 s | 0.497 s     | 0.099 s | tak                  |
| LCP     | +0.067 s | 0.100 s | 0.993 s     | 0.197 s | tak                  |
| TBT     | +29 ms   | 57 ms   | 572 ms      | 114 ms  | tak                  |
| SI      | +0.090 s | 0.030 s | 0.296 s     | 0.059 s | tak (powyżej MDE(z)) |
| TTI     | −0.039 s | 0.146 s | 1.455 s     | 0.289 s | tak                  |

**Δ SI +0.09 s to szum symulacji Lantern, a nie efekt.** Uzasadnienie:

1. **Dokument i zasoby są identyczne.** Dokument jest ten sam bajt w bajt poza portem i znacznikami czasu. Lista
   żądań i priorytetów jest ta sama. Klient różni się o 98 B martwego kodu mniej.
2. **Obserwowane SI (speedline, §4.4): mediana A 343 ms, B 337 ms.** Krzywe postępu są tej samej postaci.
3. **Przyczyna różnicy w symulacji: wolniejsza maszyna w przebiegu B-mobile-1.**
   - `benchmarkIndex` wynosił 1904, wobec 2009 w parze A-mobile-1.
   - Zadania zmierzone na wolniejszej maszynie są dłuższe po przemnożeniu przez cpuMult 4. Przykład: Navigation obs
     48.6 ms wobec 30.9 ms.
   - Stąd FCPsim 1617 wobec 1548 i SI 1.62 wobec 1.55.
   - Druga para (B2 1.80 / A2 1.69) wynika z dłuższego ScriptCatchup i vendor-react w B2 (TBT 230 ms). Te zadania
     nie mają związku z kodem serwerowym.
4. **W Prove 2 (ten sam stan klienta) znak był odwrotny:** SI mobile −0.058 s par przy σΔ 0.047 s (n=3).

Przy n=2 rozstrzyga t (df=1), a według t wszystkie delty mieszczą się w szumie.

### 4.3 Przebiegi

| przebieg   | perf | FCP  | LCP  | TBT | SI   | CLS | TTFB | bench | uwagi             |
| ---------- | ---- | ---- | ---- | --- | ---- | --- | ---- | ----- | ----------------- |
| A-mobile-1 | 97   | 1.55 | 2.30 | 89  | 1.55 | 0   | 16   | 2009  | gtag 1 skrypt     |
| B-mobile-1 | 95   | 1.62 | 2.44 | 158 | 1.62 | 0   | 12   | 1904  | gtag 0            |
| B-mobile-2 | 94   | 1.53 | 2.29 | 230 | 1.80 | 0   | 8    | 2052  | backend 8 zapytań |
| A-mobile-2 | 93   | 1.53 | 2.29 | 242 | 1.69 | 0   | 11   | 2044  | backend 9 zapytań |

LCP to zawsze `img.eh-img` (`/cover.jpg`).

### 4.4 Księga zadań (blokowanie Lantern per klasa, ms) i speedline

| przebieg   | TBT (księga = audyt) | klasy (blocking)                                                                    | SI obs | pSI obs |
| ---------- | -------------------- | ----------------------------------------------------------------------------------- | ------ | ------- |
| A-mobile-1 | 88.7                 | Style 33, vendor-react 22, Timer:index 19, ScriptCatchup 15                         | 337    | 375     |
| A-mobile-2 | 242.0                | ScriptCatchup 141, Style 67, vendor-react 21, ParseCSS 13                           | 349    | 360     |
| B-mobile-1 | 158.4                | Style 58, ParseHTML 37, vendor-react 34, ScriptCatchup 16, Timer:index 11, Script 2 | 345    | 366     |
| B-mobile-2 | 230.5                | vendor-react 72, ScriptCatchup 70, Style 65, ParseCSS 13, Timer:index 10            | 329    | 348     |

- Klasy zadań są te same po obu stronach: Style, ScriptCatchup, vendor-react, Timer:index, ParseCSS/ParseHTML.
- W B nie ma nowej klasy.
- Księga zgadza się z audytem TBT w 4/4 przebiegach.
- Pozycja nie celuje w zadania głównego wątku, więc księga potwierdza brak regresji, a nie efekt.

Kształt krzywej speedline jest ten sam. Kroki postępu w obu stronach:

- ~220-330 ms: 14-61%, zależnie od przebiegu;
- ~350 ms: 71%;
- ~365-392 ms: 99%;
- pełne 100% przy 877-943 ms.

### 4.5 Dokument i audyty (`A-mobile-1.audits.txt` vs `B-mobile-1.audits.txt`)

| pole                   | A                               | B             |
| ---------------------- | ------------------------------- | ------------- |
| element LCP            | `img.eh-img` (`/cover.jpg`)     | ten sam       |
| TTFB (rozbicie LCP)    | 22 ms                           | 21 ms         |
| load delay             | 31 ms                           | 25 ms         |
| load duration          | 34 ms                           | 16 ms         |
| render delay           | 173 ms                          | 208 ms        |
| żądania / transfer     | 70 / 913.5 KB                   | 70 / 913.5 KB |
| VeryHigh / High / Low  | 2 / 67 / 1                      | 2 / 67 / 1    |
| High przed obrazem LCP | 112.3 KB                        | 112.3 KB      |
| render-blocking CSS    | 68.5 KB (`styles-CQ2SRHxh.css`) | to samo       |
| CLS                    | 0                               | 0             |

Porównanie `lh/home-A.html` z `lh/home-B.html` (po 330 868 B) po normalizacji hashy i portu: różnią się tylko
znacznikami czasu stanu zdehydrowanego (`u:`, `dehydratedAt`, `dataUpdatedAt`).

Nagłówki różnią się tylko polami `date`, `nes-age` i `app`.

## 5. Dowód strukturalny na zbudowanym artefakcie (smoke, `smoke/`)

Na każdym procesie uruchamiany jest `.output/server/index.mjs` z fixture (`replayFetch.mjs`) i plikową atrapą
`globalThis.caches` wspólną dla procesów (`smoke/caches-mock.mjs`, kopia z Prove 2). Procesy grają izolaty jednej
kolonii. Runner: `smoke/run.mjs`.

### 5.1 HIT z L2 pod kluczem z build id i brak HIT po zmianie build id (`smoke/build-change.log`)

- Build A to artefakt worktree (`tmuzm6tdt`).
- Build B to kopia `.output` z jednym podmienionym literałem w `_ssr/index.mjs`: `"tmuzm6tdt"` → `"tSMOKEb2x"`.
  Ta sama długość, jedno wystąpienie. Kopię po teście usunąłem.

| izolat                 | żądanie      | x-nes-cache | nes-layer  | nes-l2 | app        |
| ---------------------- | ------------ | ----------- | ---------- | ------ | ---------- |
| 1 (build A)            | bot (seed)   | MISS        | render     | named  | 345 ms     |
| 1                      | bot          | HIT         | L1         | named  | 2 ms       |
| 1                      | przeglądarka | HIT         | L1         | named  | 2 ms       |
| 2 (build A, zimny)     | przeglądarka | **HIT**     | **L2**     | named  | **4 ms**   |
| 2                      | przeglądarka | HIT         | L1         | named  | 3 ms       |
| 3 (**build B**, zimny) | przeglądarka | **MISS**    | **render** | named  | **290 ms** |
| 3                      | przeglądarka | HIT         | L1         | named  | 2 ms       |
| 4 (build A, zimny)     | przeglądarka | **HIT**     | **L2**     | named  | 5 ms       |

Operacje na magazynie dokumentów (`ops.log`):

- izolat 1: `put nes-edge-v1 …/__nes/doc/tmuzm6tdt/0/0/127.0.0.1%3A%3A%2F 330868B`;
- izolat 2: `match … HIT` tego samego klucza;
- izolat 3: `match …/__nes/doc/tSMOKEb2x/0/0/… MISS` i `put` pod kluczem nowego buildu (336 411 B);
- izolat 4: `match …/__nes/doc/tmuzm6tdt/… HIT`.

Samotest na każdym izolacie: `put`+`match /__nes/selftest/<uuid>` HIT i `{"kind":"l2","verified":true,"store":"named","ms":8}`.

Migawki danych (MAJOR-1, `smoke/build-change-snapshots.txt`). Klucze mają postać
`edge:<build>:v0.0:127.0.0.1::<klucz>`.

| izolat             | match HIT | match MISS | put |
| ------------------ | --------- | ---------- | --- |
| 1 (build A)        | 0         | 9          | 6   |
| 2 (build A, zimny) | **4**     | 3          | 0   |
| 3 (build B, zimny) | **0**     | 9          | 6   |
| 4 (build A, zimny) | **4**     | 3          | 0   |

Migawki poprzedniego deployu są więc nieosiągalne dla nowego buildu, a ten sam build po rotacji izolatu je widzi.

### 5.2 Telemetria R7(b,c) w linii `kind:"doc"` (`smoke/nonce-B.log`)

- Linie `doc` niosą `l2Verified=true` po samoteście.
- Pierwszy render z zimnymi migawkami ma `degradedAt=loader` (MISS po degradacji loadera w fixture).
- Odświeżenie w tle z prawdziwym nonce'em ma `revalidation=true` i także `degradedAt=loader`.
- HIT-y są bez `degradedAt`.

Na bazie pól `l2Verified` i `degradedAt` w tej linii nie ma.

### 5.3 Nonce rewalidacji: atrapa zakresu globalnego workerd (`smoke/nonce-A.log`, `smoke/nonce-B.log`)

`smoke/workerd-scope.mjs` (`--import`) importuje `.output/server/_ssr/index.mjs` ZACHŁANNIE, jak jeden skrypt
Workera:

- w trakcie importu `crypto.randomUUID` i `crypto.getRandomValues` rzucają „Disallowed operation called within
  global scope”, a `Date.now()` = 0;
- potem przywraca normalny zakres „żądania”;
- w presecie Node moduł SSR ładuje się leniwie przy pierwszym żądaniu, więc bez atrapy podatność byłaby niewidoczna.

Scenariusz na jednym izolacie (bot, świeży wpis s-maxage=900):

| żądanie                                                  | baza (7c924ae5)                                                                | P3.6a (fbbce0d2)        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------- |
| losowanie w zakresie globalnym                           | **1 wywołanie** (IIFE → fallback `nes-0`)                                      | **0 wywołań**           |
| seed                                                     | MISS, render                                                                   | MISS, render            |
| zwykłe                                                   | HIT L1                                                                         | HIT L1                  |
| `x-nes-revalidate: nes-0`                                | **MISS, render (95 ms), nowy zapis, log `revalidation=true`**                  | **HIT L1, 3 ms**        |
| `x-nes-revalidate: ''`                                   | HIT L1                                                                         | HIT L1                  |
| `x-nes-revalidate: 0`                                    | HIT L1                                                                         | HIT L1                  |
| `x-nes-revalidate: <obcy UUID>`                          | HIT L1                                                                         | HIT L1                  |
| przeglądarka                                             | HIT L1, z wariantem wymuszonym przez atakującego (329 866 B zamiast 329 786 B) | HIT L1, oryginalny wpis |
| zapisy dokumentu do magazynu po żądaniach ze znacznikiem | **1**                                                                          | **0**                   |

Wnioski:

- Na bazie zewnętrzne `nes-0` omija odczyt L1/L2, wymusza render, nadpisuje wpis dla wszystkich czytelników i
  fałszuje telemetrię. Jest to dokładnie scenariusz z IMPL-fix10 §2.
- Na P3.6a znacznik jest ignorowany.
- Na P3.6a wewnętrzne odświeżenie w tle (po degradacji seeda) nadal działa: linia `revalidation=true`. Nonce
  wylosował się leniwie w zakresie żądania.
- Testy jednostkowe `revalidationNonce.test.ts` i `revalidationNonceDriver.test.ts` są zielone (§2).

### 5.4 Czego smoke nie sprawdza

- Usuwania zdjętego wpisu (MAJOR-2, opcjonalne w notatkach). Fixture nie pozwala zdjąć treści w trakcie przebiegu.
  Pokrywa to `documentCacheGoneEviction.test.ts` (10 testów, prawdziwy potok `src/server.ts` nad funkcjonalnym
  nazwanym cache'em, zielone). Mutacja `evicted=false` wywraca 5 z nich (`fix10/mutation.log`).
- Zachowania prawdziwego workerd i Cache API kolonii. To weryfikacja produkcyjna po wdrożeniu, według procedury
  w `r1/prove2/PROVE.md` §6. Dodatkowo:
  - świeży wpis nie reaguje na `x-nes-revalidate: nes-0` (najwyżej 1-2 żądania);
  - w Workers Logs linie `doc` niosą `l2Verified`.

## 6. Ocena względem kryteriów dowodu

| kryterium (notatki orkiestratora / PLAN §2 P3.6a)                                                | stan                                                |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| build, `check:bundle`, `check:chunks`, `check:entry-purity`, `check:server-entry-purity` zielone | tak, ze skryptami bramek bez zmian                  |
| `test:e2e:artifact`, document-weight zielone                                                     | tak (9/9, 28/28)                                    |
| layout `.output/server` jak na bazie                                                             | tak                                                 |
| bundle nie gorszy od bazy (overall/public/entry/boot)                                            | tak (−0.3 / −0.2 / −0.1 KB / 0)                     |
| smoke dwóch izolatów: HIT z L2 pod kluczem z build id                                            | tak (`/__nes/doc/tmuzm6tdt/…`, 4-5 ms)              |
| brak HIT po zmianie build id (dokument i migawki)                                                | tak (MISS + render, migawki 0 HIT)                  |
| test nonce'a                                                                                     | tak: smoke A/B w atrapie workerd + vitest           |
| LH bez regresji                                                                                  | tak, wszystkie delty par w MDE(t); SI obs bez zmian |

`effect_matches_plan`: struktura **yes**, wielkość **inconclusive**. Lokalny harness nie ma L2, a efekt (TTFB i SI na
zimnych izolatach, odporność na deploy) jest produkcyjny.

## 7. Uwagi dla orkiestratora

- **Pozycja jest gotowa do scalenia.** Dawny bloker (czerwone bramki z przeniesienia manifestu) zniknął bez zmian
  w skryptach bramek. `fix9-gates-scan-ssr.patch` nie jest potrzebny.
- Po scaleniu z P3.4 hash wejścia klienta się zmieni. Nie ma to wpływu na klucz L2: build id pochodzi teraz ze
  stałej `define`, nie z nazwy wejścia.
- **Każdy deploy, także ponowiony, zaczyna z pustym L2 kolonii**, bo build id to czas buildu, chyba że hosting poda
  `LOVABLE_BUILD_ID`. To świadome (IMPL-fix10 §5).
- **Otwarte obserwacje recenzji (nie blokują):**
  - MINOR-1: `goneEvictions` liczone przy odświeżeniu po zdegradowanym MISS-ie;
  - MINOR-2b: `build` w linii `kind:"l2"`. Ten Prove potwierdził, że stała dociera do bundla Node. Dla presetu
    Workera (`lovable-fetch-bundle`) dopisek ułatwiłby weryfikację produkcyjną;
  - MINOR-3: memo obietnicy `readVersion`.
- **Bezpieczeństwo:** baza (czyli dzisiejsza produkcja) przyjmuje `x-nes-revalidate: nes-0` z zewnątrz, co
  potwierdza §5.3 w atrapie zakresu globalnego. Do czasu wdrożenia P3.6a ryzyko pozostaje na produkcji.

## 8. Pliki

W `scratchpad/phase3/wave3/P3.6a/`:

- build: `build.log`;
- bramki: `bundle.log`, `chunks.log`, `entry-purity.log`, `server-entry-purity.log`, `e2e-artifact.log`;
- waga dokumentu: `document-weight(.json|.log)`, `document-weight-base(.json|.log)`;
- klient: `cmp-assets.txt`, `entry-diff/` (diff chunku wejścia);
- testy: `vitest.log`;
- Lighthouse: `ab.log`, `lh/` (JSON, artefakty, księgi, audyty, `home-A/B.html`, nagłówki, `summary.json`);
- smoke: `smoke/` (`run.mjs`, `caches-mock.mjs`, `workerd-scope.mjs`, `build-change.log`,
  `build-change-snapshots.txt`, `nonce-A.log`, `nonce-B.log`, katalogi magazynu `l2-*`).
