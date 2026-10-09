# P3.6a - dowód, runda 2 (po poprawce 9): działająca warstwa L2 dokumentu

- Worktree: `scratchpad/wt3/P3.6a`, gałąź `perf/w3-P3.6a`, commit `af98a5a8`.
- Baza fali: `scratchpad/base-w3` (7c924ae5), zbudowana wcześniej, bez przebudowy.
- Data: 2026-10-08.
- Wszystkie kroki ciężkie przez `heavy-bg.sh` (mutex), lekkie przez `light.sh`.
- Wejście: `IMPL-fix9.md`. Implementer nie zastosował łatki bramek `fix9-gates-scan-ssr.patch`, bo jest poza listą
  plików pozycji. Worktree mierzę więc w stanie z commita.

Repo poszło do przodu: `claude/zen-ritchie-hzur21` ma już scalone P3.4 (`b80702e6`). P3.4 nie dotyka plików
P3.6a ani trzech skryptów bramek z łatki. `git merge-tree b80702e6 af98a5a8` przechodzi bez konfliktów, a łatka
bramek nakłada się na skrypty z `main` bez zmian.

## 0. Werdykt w skrócie

- **Bramki: nadal DWIE CZERWONE z powodu tej zmiany.** Chodzi o `check:bundle` i `check:entry-purity`. Przyczyna jest ta
  sama co w Prove 1 §2.1:
  - dynamiczny import zaślepki `bootManifest.ts` przenosi mapę bootu do `.output/server/_ssr/bootManifest-Ce_8UxbM.mjs`;
  - `findBootChunks()` czyta tylko najwyższy poziom `.output/server`.

  Runda 9 świadomie nie zmieniła układu artefaktu. Poprawka leży poza plikami pozycji (IMPL-fix9 §2-3). CI uruchamia
  obie bramki, więc gałąź w obecnej postaci zapali CI → `needs_fix: true`. **Kolejna runda implementera w plikach
  pozycji tego nie naprawi. Potrzebna jest decyzja orkiestratora:** zastosować `fix9-gates-scan-ssr.patch` (wariant A).

- **Łatka A sprawdzona na TYM buildzie** (kopia lustrzana `prove2/gate-mirror`, worktree nietknięty). Obie bramki są
  zielone, a liczby są identyczne jak z `ENTRY_CHUNKS=index-BLxTOEN-.js` (§2.2).
- Reszta bramek zielona:
  - build:smoke;
  - check:chunks;
  - check:server-entry-purity;
  - test:e2e:artifact 9/9;
  - waga dokumentu 28/28 (B i baza);
  - vitest pozycji: 31 plików, 632 testy.
- **Lighthouse A/B n=3 (mobile, desktop4x): brak regresji.**
  - Dokument A i B jest ten sam (330 868 B). Różnią się tylko znacznikami czasu w stanie zdehydrowanym.
  - Nagłówki są te same. Lokalnie nie ma `caches`, więc L2 jest no-opem i nie ma `nes-l2`.
  - Księga zadań ma te same klasy po obu stronach.
  - Wszystkie delty par mieszczą się w szumie (|Δ| < MDE(t)).
- **Dowód strukturalny powtórzony na tym buildzie** (dwa izolaty z plikową atrapą Cache API, §5):
  - zimny izolat 2 podaje `HIT` z `nes-layer;desc="L2"`, `app;dur=5` zamiast renderu 368 ms;
  - klucz `/__nes/doc/index-BLxTOEN-/0/0/…` leży w nazwanym `nes-edge-v1`;
  - samotest daje `verified:true`;
  - wariant `open` rzucający → `verified:false`, `nes-l2;desc="off"`, L1 działa.
- `effect_matches_plan`: **yes dla struktury, inconclusive dla wielkości.** Lokalnie L2 jest z definicji no-opem.
  Harness dowodzi więc tylko braku regresji. Wielkość efektu (TTFB/SI na zimnych izolatach) zmierzy dopiero produkcja
  (§6).

## 1. Build

| krok                                         | wynik                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| `env BUNDLE_INVENTORY=1 bun run build:smoke` | exit 0 (`build.log`), Vite 2 min 9 s                                     |
| wejście klienta                              | `index-BLxTOEN-.js` (ten sam hash co w Prove 1: klient bez zmian w r. 9) |
| mapa bootu w artefakcie serwera              | `.output/server/_ssr/bootManifest-Ce_8UxbM.mjs` (baza: najwyższy poziom) |

## 2. Bramki artefaktu

| bramka                                                            | wynik                       | uwagi                                                                                   |
| ----------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------- |
| `check:bundle`                                                    | **RED (ta zmiana)**         | „Nie udalo sie ustalic chunku startowego z manifestu TanStack Start” (`bundle.log`)     |
| `check:bundle` z `ENTRY_CHUNKS=index-BLxTOEN-.js`                 | green                       | `bundle-override.log`                                                                   |
| `check:bundle` z łatką A (lustro)                                 | green                       | `bundle-mirror-patched.log`, wynik identyczny jak z `ENTRY_CHUNKS`                      |
| `check:chunks`                                                    | green                       | 893 chunki, 6845 krawędzi, graf acykliczny                                              |
| `check:entry-purity`                                              | **RED (ta zmiana)**         | ta sama przyczyna (`entry-purity.log`)                                                  |
| `check:entry-purity` z `ENTRY_CHUNKS` / z łatką A                 | green / green               | `index-BLxTOEN-.js` → 10 chunków, ścieżka czysta                                        |
| `check:server-entry-purity`                                       | green                       | 1813 plików, „leniwe wyłącznie: stripe.mjs”, dług `node-html-parser (2)` jak w bazie    |
| `test:e2e:artifact` (mutex)                                       | green 9/9                   | `e2e-artifact.log`; pozycja nie dodała ani nie zmieniła speców e2e                      |
| `check-document-weight.ts` (B / baza)                             | green 28/28 / green 28/28   | §3                                                                                      |
| vitest `src/lib/http/__tests__` + `src/lib/__tests__/ssrCacheL2*` | green 31 plików / 632 testy | `vitest.log`                                                                            |
| typecheck                                                         | nie powtarzany              | zielony u implementera w rundzie 9 (`fix9-typecheck.log`); od tego czasu bez zmian kodu |

### 2.1 Czerwień `check:bundle` / `check:entry-purity`: stan i jedyna droga

Implementer zbadał trzy warianty w plikach pozycji (IMPL-fix9 §2):

- statyczny import daje manifest w chunku wejścia Workera, przy starcie izolatu ~216 KB, a bramki dalej są czerwone;
- import wirtualnego modułu `tanstack-start-manifest:v` psuje transformację 5 plików testów w środowisku `client`;
- innego stałego źródła ID buildu nie ma.

Pozostają dwie drogi, obie poza listą plików:

- **A (zalecana):** `findBootChunks()` w `scripts/check-bundle-size.ts` i `scripts/check-entry-purity.ts` oraz
  `manifestBootRoots()` w `scripts/performance/documentWeight.ts`.
  - Najpierw czytają najwyższy poziom, a gdy nic nie znajdą, `_ssr/`, i to tylko wąskim wzorcem
    `entry:"/assets/*.js",rootPreloads:`.
  - Na bazie wynik się nie zmienia.
  - Nie zmienia progów i nie przywraca usuniętej bramki. Uodparnia istniejącą bramkę na położenie chunku.
- **B:** import wirtualnego modułu plus alias w `vitest.config.ts`. Nie był weryfikowany buildem.

Sprawdzenie A w tym Prove:

- kopia lustrzana `prove2/gate-mirror` (dowiązania do `src`, `node_modules`, `.output` worktree, `scripts/`
  skopiowane i spatchowane przez `patch -p1`);
- obie bramki zielone na buildzie `af98a5a8`;
- `bundle-mirror-patched.log` różni się od `bundle-override.log` wyłącznie linią z nazwą skryptu.

Skrypty bramek na `main` (`b80702e6`) są identyczne z `c606bfa4`, więc łatka nakłada się bez zmian.

**Po zastosowaniu łatki** (przy scaleniu albo w gałęzi pozycji) wystarczy ponowić `check:bundle` i
`check:entry-purity` na zbudowanym artefakcie. Klient i dokument się nie zmieniają, więc Lighthouse jest zbędny.

### 2.2 Liczby `check:bundle` (z `ENTRY_CHUNKS` = z łatką A) vs baza

| metryka                 | baza W3        | P3.6a          | Δ       | budżet  |
| ----------------------- | -------------- | -------------- | ------- | ------- |
| overall (gz)            | 4752.0 KB      | 4752.6 KB      | +0.6 KB | 4772 KB |
| public (gz)             | 2801.7 KB      | 2802.1 KB      | +0.4 KB | 2877 KB |
| admin-only (gz)         | 1950.2 KB      | 1950.4 KB      | +0.2 KB | -       |
| largest chunk (wejście) | 261.2 KB       | 261.2 KB       | 0       | 286 KB  |
| client CSS / public CSS | 95.0 / 81.2 KB | 95.0 / 81.2 KB | 0       | 96 / 83 |
| liczba plików JS        | 895            | 895            | 0       | -       |
| zapas overall           | 20.0 KB        | 19.4 KB        | -0.6 KB | -       |

Linia boot:
`Boot closure: 486.9 KB gzip / 1596.5 KB raw  (10 chunków statycznie osiągalnych ze SSR-owego <script>; budget ≤ 579 KB)`
(baza: 486.8 KB gz / 1596.5 KB raw).

Ruchy względem baseline'u (b006c2e) są takie same jak w bazie:

- `+131.5 spreadsheet.worker (NOWY)`
- `-46.8 index`
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

**+0.6 KB gz to nie są bajty kodu.** Porównanie `cmp-assets.mjs` (`cmp-assets.txt`) pokazuje:

- 0 chunków o innym rozmiarze surowym;
- multizbiór (prefiks nazwy, rozmiar surowy) wszystkich 902 plików `public/assets` jest identyczny po obu stronach.

Różnicę gzip dają inne hashe w nazwach plików i w importach (entropia), jak w Prove 1. Zmiana jest wyłącznie
serwerowa.

## 3. Waga dokumentu (`document-weight.json` vs `document-weight-base.json`)

Obie strony zielone 28/28. Mediany są identyczne poza czterema metrykami gzip:

| metryka                    | baza       | P3.6a      | Δ     | próg     |
| -------------------------- | ---------- | ---------- | ----- | -------- |
| htmlRawBytes               | 330.0 KB   | 330.0 KB   | 0     | 396.7 KB |
| htmlGzipBytes              | 52 624 B   | 52 616 B   | -8 B  | 56.4 KB  |
| headRawBytes               | 28.3 KB    | 28.3 KB    | 0     | 28.7 KB  |
| inlineStyleBytes / count   | 82.7 KB/25 | 82.7 KB/25 | 0     | 132.4 KB |
| inlineScriptBytes          | 84.8 KB    | 84.8 KB    | 0     | 95.8 KB  |
| dehydratedStateBytes       | 58.9 KB    | 58.9 KB    | 0     | 64.9 KB  |
| modulepreloadCount         | 0          | 0          | 0     | 0        |
| preloadDuplicates          | 3          | 3          | 0     | 3        |
| imgFetchpriorityHigh       | 1          | 1          | 0     | 2        |
| bootClosureRawBytes        | 1596.5 KB  | 1596.5 KB  | 0     | 1599.4   |
| bootClosureGzipBytes       | 495 036 B  | 495 097 B  | +61 B | 485.0 KB |
| preloadedJsCount (High)    | 0          | 0          | 0     | 0        |
| renderBlockingCssGzipBytes | 78.5 KB    | 78.5 KB    | 0     | 79.5 KB  |
| preLcpTransferBytes        | 177 751 B  | 177 743 B  | -8 B  | 177.3 KB |
| bootBurstCount             | 26         | 26         | 0     | 26       |
| bootBurstGzipBytes         | 572 652 B  | 572 716 B  | +64 B | 561.2 KB |

Ratchet bez zmian. Pozycja nie jest właścicielem plików wagi dokumentu, a żadna metryka realnie nie spadła.

## 4. Lighthouse A/B (`--compare`, n=3, mobile + desktop4x, fixture, fake-gtag, `--warm-ua bot`)

Katalog `prove2/lh/`, log `ab.log`.

- VALID: A mobile 3/3, A desktop4x 3/3, B mobile 3/3, B desktop4x 3/3, excluded 0.
- Jeden przebieg B-desktop4x-2 padł z `NO_NAVSTART` i został automatycznie powtórzony.
- Wariant dokumentu `s-maxage=900, 330868 B` x3 po obu stronach.
- Tryb FCP `bez-js` x3, pary mieszane 0/3.
- Restart serwera przed przebiegiem: 1/3 na formę po obu stronach.
- Rozgrzewka: A i B `x-nes-cache=HIT`, gzip 49 947 / 49 957 B.

### 4.1 Mediany i delty

| forma     | strona | perf | FCP    | LCP    | TBT    | SI     | CLS | TTFB  | TTI    | mainThread | bootup  | req | transfer |
| --------- | ------ | ---- | ------ | ------ | ------ | ------ | --- | ----- | ------ | ---------- | ------- | --- | -------- |
| mobile    | A      | 92   | 1.55 s | 2.31 s | 286 ms | 1.71 s | 0   | 16 ms | 5.54 s | 3740 ms    | 1596 ms | 70  | 913.5 KB |
| mobile    | B      | 91   | 1.53 s | 2.29 s | 323 ms | 1.61 s | 0   | 15 ms | 5.26 s | 3541 ms    | 1674 ms | 70  | 913.6 KB |
| mobile    | B-A    | -1   | -0.01  | -0.03  | +37 ms | -0.09  | 0   | -1    | -      | -198       | +78     | 0   | +0.1 KB  |
| desktop4x | A      | 91   | 0.45 s | 0.56 s | 247 ms | 0.64 s | 0   | 9 ms  | 1.31 s | 3298 ms    | 1518 ms | 73  | 918.5 KB |
| desktop4x | B      | 90   | 0.45 s | 0.54 s | 257 ms | 0.58 s | 0   | 7 ms  | 1.24 s | 3179 ms    | 1526 ms | 73  | 918.6 KB |
| desktop4x | B-A    | -1   | +0.00  | -0.01  | +11 ms | -0.06  | 0   | -2    | -      | -120       | +8      | 0   | +0.1 KB  |

### 4.2 Pary (σΔ, MDE)

| forma     | metryka | Δ par    | σΔ      | MDE(t)  | w szumie? |
| --------- | ------- | -------- | ------- | ------- | --------- |
| mobile    | score   | 0.0      | 9.8     | 30.5    | tak       |
| mobile    | FCP     | -0.034 s | 0.047 s | 0.146 s | tak       |
| mobile    | LCP     | -0.059 s | 0.077 s | 0.237 s | tak       |
| mobile    | TBT     | 0 ms     | 330 ms  | 1023 ms | tak       |
| mobile    | SI      | -0.058 s | 0.047 s | 0.146 s | tak       |
| mobile    | TTI     | -0.259 s | 0.114 s | 0.353 s | tak       |
| desktop4x | score   | 0.0      | 2.6     | 8.2     | tak       |
| desktop4x | FCP     | -0.022 s | 0.063 s | 0.195 s | tak       |
| desktop4x | LCP     | -0.008 s | 0.012 s | 0.037 s | tak       |
| desktop4x | TBT     | -1 ms    | 39 ms   | 119 ms  | tak       |
| desktop4x | SI      | -0.043 s | 0.038 s | 0.117 s | tak       |
| desktop4x | TTI     | -0.068 s | 0.050 s | 0.155 s | tak       |

**TBT mobile jest w tym przebiegu wyjątkowo zaszumione:** σΔ 330 ms wobec ≈121 ms w A/A fali 2.

- Skrajne przebiegi to A-mobile-2 (589 ms) i B-mobile-1 (656 ms).
- B-mobile-1 ma `benchmarkIndex` 1586, B-mobile-2 ma 1626, a reszta mieści się w 1876-2160. To wolniejsza maszyna
  współdzielona z innymi agentami.
- Delta par TBT wynosi 0 ms.
- Mediana +37 ms jest daleko w szumie.

Pozycja nie zmienia ani bajtu klienta ani dokumentu (§2.2, §4.6). Różnice SI/TTI na minus to szum, nie efekt. Lokalnie
oba serwery podają dokument z L1.

### 4.3 Przebiegi

| przebieg      | perf | FCP  | LCP  | TBT | SI   | CLS | TTFB | bench | uwagi                     |
| ------------- | ---- | ---- | ---- | --- | ---- | --- | ---- | ----- | ------------------------- |
| A-mobile-1    | 92   | 1.55 | 2.31 | 286 | 1.72 | 0   | 18   | 1876  |                           |
| A-mobile-2    | 83   | 1.53 | 2.29 | 589 | 1.62 | 0   | 16   | 1927  |                           |
| A-mobile-3    | 94   | 1.63 | 2.45 | 189 | 1.71 | 0   | 12   | 2160  | restart serwera           |
| B-mobile-1    | 81   | 1.53 | 2.29 | 656 | 1.61 | 0   | 15   | 1586  |                           |
| B-mobile-2    | 91   | 1.53 | 2.28 | 323 | 1.56 | 0   | 16   | 1626  |                           |
| B-mobile-3    | 97   | 1.54 | 2.31 | 85  | 1.70 | 0   | 8    | 2095  | restart serwera           |
| A-desktop4x-1 | 89   | 0.53 | 0.57 | 280 | 0.66 | 0   | 11   | 2151  |                           |
| A-desktop4x-2 | 92   | 0.40 | 0.55 | 228 | 0.64 | 0   | 6    | 2099  |                           |
| A-desktop4x-3 | 91   | 0.45 | 0.56 | 247 | 0.63 | 0   | 9    | 2081  | restart serwera           |
| B-desktop4x-1 | 92   | 0.45 | 0.58 | 236 | 0.66 | 0   | 10   | 2105  |                           |
| B-desktop4x-2 | 90   | 0.45 | 0.54 | 257 | 0.58 | 0   | 7    | 2069  | po powtórce (NO_NAVSTART) |
| B-desktop4x-3 | 90   | 0.41 | 0.54 | 259 | 0.57 | 0   | 7    | 2043  | restart serwera           |

LCP to zawsze `img.eh-img` (`/cover.jpg`). Liczba żądań: mobile 70, desktop4x 73, po obu stronach.

### 4.4 Księga zadań (blokowanie Lantern per klasa, ms)

| przebieg      | TBT   | klasy (blocking)                                                                                                                     |
| ------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------ |
| A-mobile-1    | 286.0 | ScriptCatchup 147, Style 50, vendor-react 31, GC 29, ParseCSS 13, Timer:index 13, Timer:(dokument) 3                                 |
| A-mobile-2    | 589.0 | Style 187, ScriptCatchup 128, vendor-react 115, Timer:dynamic-icon 61, Timer:(dokument) 50, Other 41, Script:pl 7                    |
| A-mobile-3    | 189.3 | vendor-react 65, Style 64, ParseHTML 40, ScriptCatchup 17, Timer:index 3                                                             |
| B-mobile-1    | 656.0 | ScriptCatchup 194, Style 123, vendor-react 117, Timer:dynamic-icon 90, Timer:(dokument) 40, Timer:index 38, Layerize 36, ParseCSS 18 |
| B-mobile-2    | 323.0 | ScriptCatchup 132, Timer:dynamic-icon 49, vendor-react 46, Style 40, Timer:index 32, Script 21, Timer:(dokument) 4                   |
| B-mobile-3    | 85.5  | Style 37, ScriptCatchup 32, vendor-react 14, Timer:index 2                                                                           |
| A-desktop4x-1 | 279.5 | ScriptCatchup 95, Style 87, Script 48, vendor-react 31, ParseHTML 19                                                                 |
| A-desktop4x-2 | 227.5 | ScriptCatchup 93, Script:(dokument) 83, vendor-react 25, Style 15, Timer:index 12                                                    |
| A-desktop4x-3 | 247.0 | ScriptCatchup 103, Style 88, vendor-react 53, Timer:index 4                                                                          |
| B-desktop4x-1 | 235.5 | ScriptCatchup 101, Style 84, vendor-react 34, Timer:index 17                                                                         |
| B-desktop4x-2 | 257.5 | ScriptCatchup 104, Style 97, vendor-react 36, Timer:index 17, Other 4                                                                |
| B-desktop4x-3 | 258.5 | ScriptCatchup 113, Script:(dokument) 72, vendor-react 45, Style 11, Script 7, Timer:index 7, GC 4                                    |

Klasy zadań są te same po obu stronach: ScriptCatchup, Style, vendor-react, Timer:index, Timer:dynamic-icon,
Script:(dokument). W B nie ma żadnej nowej klasy. Księga zgadza się z audytem TBT w 12/12 przebiegów. Pozycja nie
celuje w zadania głównego wątku, więc księga potwierdza brak regresji, a nie efekt.

### 4.5 Speedline (obserwowane klatki, `w3/tools/speedline.cjs`, ms)

| przebieg      | SI obs | pSI | ostatnia zmiana |
| ------------- | ------ | --- | --------------- |
| A-mobile-1    | 468    | 493 | 692             |
| B-mobile-1    | 466    | 494 | 684             |
| A-mobile-2    | 409    | 461 | 675             |
| B-mobile-2    | 349    | 360 | 606             |
| A-mobile-3    | 315    | 325 | 614             |
| B-mobile-3    | 321    | 338 | 646             |
| A-desktop4x-1 | 376    | 380 | 532             |
| B-desktop4x-1 | 323    | 326 | 526             |
| A-desktop4x-2 | 313    | 327 | 707             |
| B-desktop4x-2 | 352    | 358 | 540             |
| A-desktop4x-3 | 390    | 392 | 554             |
| B-desktop4x-3 | 283    | 320 | 661             |

Kształt krzywej jest ten sam po obu stronach. Mediana SI obs wynosi mobile 409 → 349, desktop4x 376 → 323. Rozrzut
między przebiegami tej samej strony sięga ±80 ms, więc to szum. Dokument i zasoby są identyczne.

### 4.6 Dokument i audyty

`lh/home-A.html` i `lh/home-B.html` mają po 330 868 B. Po normalizacji hashy różnią się wyłącznie znacznikami czasu
w stanie zdehydrowanym (`u:`, `dehydratedAt`, `dataUpdatedAt`).

Nagłówki różnią się tylko `date` i `nes-age`/`app`. `server-timing` nie ma `nes-l2` po obu stronach, bo lokalnie
`globalThis.caches` nie istnieje i L2 jest no-opem.

`A-mobile-1.audits.txt` vs `B-mobile-1.audits.txt`:

| pole                   | A                           | B             |
| ---------------------- | --------------------------- | ------------- |
| element LCP            | `img.eh-img` (`/cover.jpg`) | ten sam       |
| TTFB (rozbicie LCP)    | 31 ms                       | 26 ms         |
| load delay             | 61 ms                       | 40 ms         |
| load duration          | 24 ms                       | 37 ms         |
| render delay           | 233 ms                      | 233 ms        |
| żądania / transfer     | 70 / 913.5 KB               | 70 / 913.6 KB |
| High przed obrazem LCP | 112.3 KB                    | 112.3 KB      |
| render-blocking CSS    | 68.5 KB                     | 68.5 KB       |
| CLS                    | 0                           | 0             |

Lista zasobów i ich priorytety są takie same, poza drobnymi różnicami kolejności startu w obrębie tej samej
milisekundy. Dokument różni się o 1 B transferu (gzip znaczników czasu).

## 5. Dowód strukturalny na zbudowanym artefakcie (powtórzony na `af98a5a8`)

Uruchamiany jest `.output/server/index.mjs` z fixture (`replayFetch.mjs`) i plikową atrapą `globalThis.caches` wspólną
dla procesów (`prove2/smoke/run.mjs`, `caches-mock.mjs`, kopie z Prove 1). Procesy grają rolę izolatów jednej kolonii.

- Proces 1: 2x bot i 1x przeglądarka, potem stop.
- Proces 2 (pusty L1): 2x przeglądarka.

Tryb `named` (`smoke/named.log`):

| izolat              | żądanie      | x-nes-cache | nes-layer | nes-l2 | app      |
| ------------------- | ------------ | ----------- | --------- | ------ | -------- |
| 1                   | bot          | MISS        | render    | named  | 368 ms   |
| 1                   | bot          | HIT         | L1        | named  | 2 ms     |
| 1                   | przeglądarka | HIT         | L1        | named  | 2 ms     |
| 2 (zimny, pusty L1) | przeglądarka | **HIT**     | **L2**    | named  | **5 ms** |
| 2                   | przeglądarka | HIT         | L1        | named  | 3 ms     |

Operacje na magazynie:

- `open nes-edge-v1`; nie ma `caches.default`.
- Samotest `put`+`match /__nes/selftest/<uuid>` raz na izolat. Linie logu: `{"kind":"l2","verified":true,"store":"named","ms":8}`
  i dla izolatu 2 `ms":6`.
- Izolat 1 robi `put nes-edge-v1 …/__nes/doc/index-BLxTOEN-/0/0/127.0.0.1%3A%3A%2F 330868B`.
- Izolat 2 robi `match … HIT` tego samego klucza.
- Segment buildu to nazwa wejścia klienta z `BOOT_MANIFEST.entry`. Ścieżka `import()` z rundy 9 (bez zapamiętania
  błędu) rozwiązuje się poprawnie na artefakcie.

Tryb `open-throws` z martwym `caches.default` (`smoke/open-throws.log`):

- `nes-l2;desc="off"` na każdej odpowiedzi;
- `{"kind":"l2","verified":false,"store":"default"}`;
- poza dwoma `open` na izolat nie ma operacji na magazynie;
- L1 działa (HIT `L1`), a zimny izolat 2 renderuje (MISS).

To zachowanie dzisiejszej produkcji, więc nie ma regresji.

Telemetria R7(b,c):

- `verified`/`store`/`build` i `degradedAt` trafiają do pierścienia decyzji (karta admina) i do linii `kind:"l2"`.
- Linia `kind:"doc"` w logach e2e ich nie niesie, bo powstaje w `ssrTiming.ts`, który jest poza listą (MINOR-3
  recenzji, bez zmian).

R6 (stały UA odświeżenia w tle) pokrywa `revalidationUserAgent.test.ts` w zielonym zestawie vitest.

## 6. Weryfikacja produkcyjna po wdrożeniu (procedura)

Stan PRZED (produkcja, 2026-10-08 11:48 UTC, Prove 1, 3 żądania co 4 s, kolonia IAD). W tym Prove nie wysyłałem
żądań do produkcji.

| #   | x-nes-cache | nes-layer | edge-routing | db          | app     | nes-l2 |
| --- | ----------- | --------- | ------------ | ----------- | ------- | ------ |
| 1   | MISS        | render    | 693 ms       | 1420 ms n=5 | 1293 ms | brak   |
| 2   | MISS        | render    | 0 ms         | 308 ms n=1  | 308 ms  | brak   |
| 3   | MISS        | render    | 767 ms       | 2073 ms n=8 | 1367 ms | brak   |

Procedura PO wdrożeniu (≤ 20 żądań, odstęp ≥ 3 s, bez obciążania produkcji):

```bash
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
for i in $(seq 1 10); do
  date -u +%T
  curl -sS -o /dev/null -D - -A "$UA" -H 'accept: text/html' -H 'accept-language: pl' \
    https://neweuropeanstrategies.com/ | grep -i -E '^(x-nes-cache|x-nes-cache-age|server-timing|cf-ray):'
  sleep 3
done
```

Kryteria:

1. **Nagłówek `nes-l2`.** `server-timing` niesie `nes-l2;desc="named"`. Pierwsze żądanie zimnego izolatu może mieć
   `pending`.
   - `desc="off"` na wielu izolatach oznacza, że Cache API nie działa także w wariancie nazwanym. Wtedy R1′ (KV lub
     Supabase Storage + CDN), decyzja właściciela.
   - `desc="default"` oznacza, że działa tylko `caches.default`.
2. **Zimne izolaty.** Zimny izolat to taki, który przed zmianą miał `edge-routing` > 0.
   - `edge-routing` spada do ~0, bo migawki tenantów i przekierowań przychodzą z L2.
   - Gdy kolonia ma kompletny wpis dokumentu, odpowiedź to `x-nes-cache: HIT|STALE` z `nes-layer;desc="L2"` i
     `app;dur` rzędu ms zamiast 0.3-1.4 s.
   - Dziś `/` wraca jako MISS nawet na ciepłym izolacie (diagnoza R2). Pełny efekt HIT/L2 dla dokumentu zależy więc
     od P3.6b. Sama P3.6a musi dać co najmniej punkt 1 i spadek `edge-routing`.
3. **Workers Logs.**
   - Jedna linia `{"kind":"l2","verified":true,"store":"named",…}` na izolat.
   - Linie `kind:"doc"` mają udział `layer=L2` > 0.
   - Tuż po deployu pierwsze żądania to MISS (nowy segment buildu), a nie HTML poprzedniego buildu. W odpowiedzi HIT
     `#nes-boot-set` musi wskazywać `index-*.js` bieżącego deployu.
4. **Panel.** `/admin/performance` → karta NES Edge Cache: `l2.enabled` zgodne z samotestem, `l2.hits` > 0 przy
   `l2.stores` > 0.
5. **Po tygodniu.** Lighthouse z kontenera (skrypt w `faza3/diagnoza/stan-wejsciowy.md`): odsetek przebiegów z MISS
   na `/` oraz SI mobile i desktop w porównaniu z pomiarem wejściowym.

## 7. Uwagi dla orkiestratora

- **Jedyny bloker scalenia:** §2.1. Trzeba zastosować `fix9-gates-scan-ssr.patch` (sprawdzona tutaj na buildzie
  `af98a5a8`, nakłada się na `main`). Druga opcja to wariant B. Po łatce wystarczy `check:bundle` i
  `check:entry-purity` na artefakcie.
- Przed wdrożeniem nadal obowiązuje warunek z recenzji MAJOR-1: segment buildu w `snapshotKey` w
  `src/lib/ssrCacheL2.server.ts` (poza listą). Działająca fasada ożywia też migawki danych w `nes-edge-v1`; widać je
  w dymnym teście.
- Scalenie z `b80702e6` (P3.4) jest bezkonfliktowe. Klient P3.4 zmienia boot, więc po scaleniu hash wejścia będzie
  inny. Segment buildu w kluczu L2 podąży za nim automatycznie.

Pliki w `prove2/`:

- build: `build.log`;
- bramki: `bundle.log`, `bundle-override.log`, `bundle-mirror-patched.log`, `chunks.log`, `entry-purity.log`,
  `entry-purity-override.log`, `entry-purity-mirror-patched.log`, `server-entry-purity.log`, `e2e-artifact.log`;
- waga dokumentu: `document-weight(.json|.log)`, `document-weight-base(.json|.log)`;
- porównanie zasobów: `cmp-assets.txt`;
- testy: `vitest.log`;
- Lighthouse: `ab.log`, `lh/`;
- dymny test: `smoke/`;
- kopia lustrzana bramek: `gate-mirror/`.
