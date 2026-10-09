# P3.2b (fala 3): jeden font Red Hat Display w ścieżce krytycznej i krój zastępczy per waga, raport wdrożenia

Gałąź `perf/w3-P3.2b`, worktree `$SCRATCH/wt3/P3.2b`, baza `d5bd11fb`, commit `46e09026`.
`$SCRATCH` = `/tmp/claude-0/-home-user-neweustrategies-dc633fb5/57088803-e7ea-5e89-8c05-954276daf4ba/scratchpad`.
Wszystkie logi i skrypty pomocnicze: `$SCRATCH/phase3/wave3/P3.2b/` (`logs/`, `harness/`, `font/`, `variants/`).

## 1. Co zmieniono i dlaczego (plik po pliku)

| Plik                                                                            | Zmiana                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/assets/fonts/red-hat-display-latin-pl.woff2` (NOWY)                        | Jedyny font ścieżki krytycznej: latin + 18 polskich liter, oś `wght` 400-900 (decyzja właściciela), 24 372 B. Receptura i hashe w §2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `src/assets/fonts/red-hat-display-latin.woff2` (USUNIĘTY)                       | Nic go już nie importuje (`grep` w `src`, `e2e`, `scripts`, `public`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `src/assets/fonts/red-hat-display-latin-ext.woff2`                              | Bez zmian; zostaje jako twarz BEZ preloadu dla innych diakrytyków.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `src/styles.css` (tylko blok `@font-face` RHD + krój zastępczy, dawne `:31-94`) | (a) Twarz latin-ext: `unicode-range` = dawny zakres MINUS wszystko z pliku głównego (PL litery, U+0131, U+0152-0153, U+2020). (b) Twarz główna (`latin-pl`, deklarowana OSTATNIA): dawny zakres latin + polskie litery + U+0300-0301, U+0303 (znaki z cmap pliku; patrz odstępstwo 2). (c) Krój zastępczy: sześć twarzy `"Red Hat Display Fallback"` z ciągłymi zakresami `font-weight` 1-1000, Regular (`local(Arial/Liberation Sans/Arimo/Helvetica)`) do 549, prawdziwy Bold (pełna nazwa + PostScript) od 550, `size-adjust`/`ascent-override`/`descent-override` per waga (tabela §3). Komentarze po polsku z recepturą fontu i metodą. |
| `src/lib/seo/fontPreload.ts`                                                    | API bez języka: `fontPreloadLinks(href)` i `fontPreloadLinkHeaderValues(href)` zwracają dokładnie jeden wpis (ten sam kształt: `rel=preload`, `as=font`, `type=font/woff2`, `crossOrigin`). Usunięty `FontPreloadUrls`.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `src/lib/seo/rootHead.ts`                                                       | `RootAssets { appCss; font }`; `rootDocumentLinks(origin, assets)` i `rootLinkHeaderValues(assets)` bez `lang` (był używany wyłącznie przez fonty; `noUnusedParameters`). Kolejność nagłówka bez zmian: arkusz, preconnect, font.                                                                                                                                                                                                                                                                                                                                                                                                            |
| `src/routes/__root.tsx`                                                         | WYŁĄCZNIE: jeden import `red-hat-display-latin-pl.woff2?url` (zamiast dwóch), `ROOT_ASSETS = { appCss, font: redHatDisplay }`, `rootDocumentLinks(getOrigin(), ROOT_ASSETS)`, `rootLinkHeaderValues(ROOT_ASSETS)` + poprawiony komentarz nad tym wywołaniem (`renderLang` zostaje dla chunku słownika). Regiony P3.6b/P3.8 nietknięte.                                                                                                                                                                                                                                                                                                       |
| `src/lib/theme/themeDesign.ts`                                                  | Nowa eksportowana `withRedHatDisplayFallback(stack)` (regex z planu §7) i użycie w `themeDesignToCss` dla `--td-pt-family` i `--td-pe-family` (dawne `:615`, `:622`). `themeDesignFromRaw` bez zmian (panel pokazuje i zapisuje wybór administratora).                                                                                                                                                                                                                                                                                                                                                                                       |
| `scripts/performance/documentWeight.ts`                                         | `fontPreloadCount` = liczba UNIKALNYCH preloadowanych fontów (`<head>` + `Link`, jak `modulepreloadCount`) + wpis w `GATED_METRICS` obok `inlineCssCommentBytes` (addytywnie).                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `scripts/performance/document-weight-budgets.json`                              | Tylko nowy klucz `fontPreloadCount { max 1, measured 1, target 1 }` + akapit w `_comment` (kronika). Istniejące progi nietknięte (ratchet robi orkiestrator).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/lib/ci/woff2Tables.ts` (NOWY)                                              | Czysty czytnik WOFF2 (nagłówek, katalog tabel, UIntBase128, Brotli z `node:zlib`) + parsery `head`, `hhea`, `OS/2`, `cmap` (format 4/12), `fvar`, `name` id 5, `FeatureList` GSUB/GPOS. Tylko dla testów, nie trafia do bundla.                                                                                                                                                                                                                                                                                                                                                                                                              |
| `src/lib/ci/__tests__/fontGlyphCoverage.test.ts` (NOWY, 17 testów)              | §9.2 planu pkt 1-8 + receptura (cmap ⊆ zestaw kodów receptury, cechy OpenType = cechy dawnego latin) + L8 (U+0102 idzie do latin-ext) + bramka `fontPreloadCount` (1 dla zestawu korzenia liczone `analyzeDocument` na wyjściu `rootDocumentLinks`/`rootLinkHeaderValues`, 2 dla dawnego zestawu).                                                                                                                                                                                                                                                                                                                                           |
| `src/lib/theme/__tests__/themeDesignFontStack.test.ts` (NOWY, 10 testów)        | Przypadki z planu §7 + podgląd na żywo (`themeDesignToStyleVars`) + brak dublowania w stosie domyślnym.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `src/lib/seo/__tests__/fontPreload.test.ts`, `rootHead.test.ts`                 | Nowe API; „preload fontu ZGODNY między zestawami i jest dokładnie jeden”, „PL i EN dostają ten sam font”, kolejność nagłówka z jednym fontem.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `e2e/single-font.boot-home.spec.ts` (NOWY)                                      | Bramka CI jednego fontu w przeglądarce (konfiguracja artefaktu wybiera `*boot-home.spec.ts`, więc jedzie w `ci.yml` na każdym PR): na `/` i `/en` dokument preloaduje dokładnie jeden font `red-hat-display-latin-pl-*.woff2`, nagłówek `Link` zapowiada ten sam plik, jedyne żądanie woff2 z `/assets/` po hydratacji to ten plik, załadowana dokładnie jedna twarz RHD. Kroje z CMS (spoza `/assets/`, bez preloadu) nie są blokowane.                                                                                                                                                                                                     |
| `e2e-performance/font-swap-cls.spec.ts` (NOWY)                                  | Dowód lokalny z wstrzymanym fontem (§9.3 planu): desktop 1350x940 @1 i mobile 412x823 @1,75, PL i EN; strażnik środowiska (krój zastępczy musi się rozwiązać); wiersz `FONT_SWAP_CLS {...}` z pomiarem i źródłami przesunięć (także węzły tekstowe z prostokątami). Asercje: suma przesunięć po zwolnieniu <= 0,001, liczba linii tekstów W WIDOKU bez zmian (odstępstwo 4).                                                                                                                                                                                                                                                                 |

Nie zmieniałem: `package.json` (zero nowych zależności), konfiguracji Vite, fixture, danych CMS.

## 2. Plik fontu: komendy, wersje, hashe (odtwarzalne)

Katalog roboczy poza repo: `$SCRATCH/phase3/wave3/P3.2b/font/` (`dl/` = pobrany plik w osobnym katalogu).

```bash
F=$SCRATCH/phase3/wave3/P3.2b/font
curl -sSL -o $F/dl/RHD-gf.ttf \
  "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/redhatdisplay/RedHatDisplay%5Bwght%5D.ttf"
sha256sum $F/dl/RHD-gf.ttf   # 46c9d4c4a2415e7e72020b318f5cda2bcbc9018d78b1a67e480a76d8d6e4b379, 98 360 B (Version 1.030)
FT='uvx --python 3.11 --from fonttools==4.66.1 --with brotli==1.2.0'   # uvx 0.8.17, Python 3.11.15
export SOURCE_DATE_EPOCH=1731673512   # = head.modified źródła; bez tego instancer stempluje czas i hash zmienia się co przebieg
U="U+000D,U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0300-0301,U+0303-0304,U+0308,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD,U+0104-0107,U+0118-0119,U+0141-0144,U+015A-015B,U+0179-017C"
FEAT="calt,ccmp,dnom,frac,liga,locl,numr,pnum,tnum,kern,mark,mkmk"
$FT fonttools varLib.instancer $F/dl/RHD-gf.ttf wght=400:900 -q -o $F/out/RHD-400-900.r1.ttf
$FT pyftsubset $F/out/RHD-400-900.r1.ttf --unicodes="$U" --layout-features="$FEAT" \
  --flavor=woff2 --output-file=$F/out/red-hat-display-latin-pl.r1.woff2
```

Wynik: 24 372 B, sha256 `efaa4dc4bd8f71147656ff6a6509c2ee06f3266e955f53182c9c6b7c9a6a75c7` (dwa niezależne
przebiegi r1/r2: identyczny hash; plik pośredni TTF `506955094df2…` w obu). Tabele: 292 glify, cmap 252 kody,
`wght` 400/400/900, 6 instancji, GSUB `calt ccmp dnom frac liga locl numr pnum tnum`, GPOS `kern mark`,
upm 1000, hhea 1018/−305/0, typo 1018/−305/0, win 1018/305, `fsSelection` 0b11000000, xH 501, capH 700.

Weryfikacja offline (skrypty planisty `$SCRATCH/p32b/*.py` + moje `compare2.py`, venv planisty z tymi samymi
wersjami fonttools/brotli/uharfbuzz 0.56.3, `python -I`):

| Sprawdzenie                                                                                     | Wynik                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compare2.py latin latin-ext nowy` (wagi 400-900, szerokość + kontury każdego wspólnego znaku)  | 1548 par, **0 różnic szerokości**, 0 różnic struktury konturów, maks. odchyłka punktu 0,5 jednostki/1000 em (zaokrąglenie instancera, przewidziane w planie §14), metryki pionowe identyczne w każdej wadze |
| `shapecmp.py` (HarfBuzz, 3020 linii korpusu w całości w dawnym latin, wagi 400/600/700/800/900) | **0 linii z innym kształtowaniem**                                                                                                                                                                          |
| `cover.py` (widoczny tekst produkcji `d2.html`, `d4.html`, bazy `home.html`)                    | produkcja: brak braków; fixture: tylko `→` (U+2192, nie ma go w całej rodzinie)                                                                                                                             |
| `cover2.py` (`src/lib/locale/*.ts`, `src/lib/i18n*.ts`, 165 plików)                             | tylko symbole spoza rodziny `→ ⌘ ≥ ≤ ✓ ← ↩ ↔ ≈ ✗ ⇄`, wszystkie `inFull=False`, `inLatinExt=False`                                                                                                           |
| `overrides.py` (korpus 49 385 znaków)                                                           | wartości planu §6.2 odtworzone co do setnej                                                                                                                                                                 |

## 3. Krój zastępczy: wartości

| Twarz `font-weight` | `src`   | `size-adjust` | `ascent-override` | `descent-override` | źródło                                                    |
| ------------------- | ------- | ------------- | ----------------- | ------------------ | --------------------------------------------------------- |
| 1 449               | Regular | 97,72%        | 104,18%           | 31,21%             | plan (asc. zaokrąglone poprawnie: 101,8/0,9772 = 104,175) |
| 450 549             | Regular | 99,22%        | 102,6%            | 30,74%             | plan                                                      |
| 550 649             | Bold    | 93,4%         | 108,99%           | 32,66%             | plan                                                      |
| 650 749             | Bold    | 95,34%        | 106,78%           | 31,99%             | plan                                                      |
| **750 849**         | Bold    | **99,71%**    | **102,1%**        | **30,59%**         | **zmienione, odstępstwo 1** (plan: 97,75 / 104,14 / 31,2) |
| 850 1000            | Bold    | 100,63%       | 101,16%           | 30,31%             | plan                                                      |

Iloczyn override × size-adjust = 101,8% / 30,5% (±0,005 pp) w każdej twarzy — pilnuje test.

## 4. Bramki uruchomione (szybkie, w worktree)

| Bramka                                                                                                                                                                                                                                                                                                                                                            | Wynik                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bunx prettier --write` / `--check` na wszystkich dotkniętych plikach                                                                                                                                                                                                                                                                                             | zielone                                                                                                                                                                                                                                                              |
| `light.sh bunx eslint` (11 plików TS)                                                                                                                                                                                                                                                                                                                             | 0 błędów (2 ostrzeżenia `react-refresh` w `__root.tsx` istnieją na bazie, poza moimi liniami)                                                                                                                                                                        |
| typecheck (`typecheck-noinc.sh` przez mutex: `tsgo --noEmit`, `tsc -p tsconfig.scripts.json`, `tsgo -p tsconfig.e2e.json`)                                                                                                                                                                                                                                        | zielony dwa razy (po implementacji i po rundzie dowodów: zmienił się spec e2e i test) — `logs/typecheck.log`, `logs/typecheck2.log`                                                                                                                                  |
| `light.sh bunx vitest run` — 15 plików: `fontGlyphCoverage`, `themeDesignFontStack`, `fontPreload`, `rootHead`, `themeDesignModel`, `themeRemainder`, `themeDesignParts`, `platformPreloads`, `documentCache.server`, `serverEntryRequestOptions`, `rootRoute`, `rootShellRender`, `rootRouterMount`, `router`, `staticCssPlugin` (importuje `documentWeight.ts`) | **412 testów zielonych + 1 expected fail** (istniejący `it.fails` o originie Supabase) — `logs/vitest.log`                                                                                                                                                           |
| `light.sh bun run verify:static`                                                                                                                                                                                                                                                                                                                                  | **15 bramek zielonych** (format:check, SQL, kontrakt TS↔SQL, …), dwa razy — `logs/verify-static.log`, `logs/verify-static2.log`                                                                                                                                      |
| Kontrole negatywne testu pokrycia (do raportu, nie do commita)                                                                                                                                                                                                                                                                                                    | dawny `latin.woff2` jako główny: **5/15 czerwonych** (18 liter, zakres, słowniki, L8, rozmiar); dawny blok CSS (jedna twarz zastępcza): **5/15 czerwonych** (zakresy wag, tabela size-adjust, litery w latin-ext) — `neg/neg-a-oldlatin.log`, `neg/neg-b-oldcss.log` |
| `check:bundle`, `check:document-weight`, build, Lighthouse, e2e na buildzie kandydata                                                                                                                                                                                                                                                                             | **NIE uruchamiane** (zakaz buildu w tym etapie) — zostają dla Prove, §6                                                                                                                                                                                              |

## 5. Dowody bez buildu (żeby Prove nie trafiło w ciemno)

Wszystkie kroki przez mutex (`heavy-bg.sh`), na artefakcie bazy `base-w3d` (build orkiestratora, `exit 0`).

### 5.1 Emulacja kandydata na kopii artefaktu bazy (`harness/make-emu.mjs`)

Kopia `base-w3d/.output` z podmienionym: blokiem `@font-face` w `styles-URDC8Vwd.css` (blok z worktree,
zminifikowany lightningcss z repo), nowym plikiem fontu, nazwą fontu w kodzie serwera i chunku wejściowym,
normalizacją stosu Theme Design w SSR i chunku `themeDesignCss` (ta sama regex co `withRedHatDisplayFallback`)
oraz rozmiarami w manifeście zasobów Nitro. To NIE jest build: preload latin-ext na PL zostaje (kod `rootHead`
bazy), więc emulacja nie dowodzi jednego żądania — to robi `single-font` na buildzie.

`e2e-performance/font-swap-cls.spec.ts` (`logs/final-swap-*.log`), suma przesunięć po zwolnieniu fontu:

| Przypadek  | Baza `d5bd11fb`                                             | Kandydat (emulacja) | Linie w widoku (kandydat)                  |
| ---------- | ----------------------------------------------------------- | ------------------- | ------------------------------------------ |
| desktop PL | **0,002061** (✘), 3 tytuły kart 3→4 linie (poniżej zgięcia) | **0,000285** (✓)    | bez zmian                                  |
| mobile PL  | 0,000572 (✓)                                                | 0,000617 (✓)        | bez zmian                                  |
| desktop EN | **0,021224** (✘), 2 etykiety sekcji 1→2, 3 tytuły 5→6       | **0,000325** (✓)    | bez zmian                                  |
| mobile EN  | 0,000286 (✓)                                                | 0,000605 (✓)        | bez zmian (1 nagłówek poniżej zgięcia 1→2) |

Kandydat 4/4 zielony, baza 2/4 czerwona (kontrola negatywna: spec mierzy mechanizm). Źródła reszt kandydata:
desktop — cyfry dekoracyjnej listy numerowanej (`post-list-numbered-index`, 800, tabular: RHD ma cyfry o 7,9%
szersze niż Arial Bold) i rząd tickera; mobile — przełamanie tytułu hero fixture wewnątrz tego samego prostokąta
(3 linie przed i po).

### 5.2 Podmiana fontu na PRAWDZIWYM HTML-u produkcji (`harness/prod-swap.mjs`)

Dokument `$SCRATCH/w3/prod/d2.html` (produkcja `/`, 2026-10-08) + produkcyjny arkusz `styles-CQ2SRHxh.css`
(pobrany raz), skrypty usunięte (stan SSR), woff2 wstrzymane, layout-shift po zwolnieniu (`logs/final.log`):

| Wariant                                       | desktop 1350                                         | mobile 412   |
| --------------------------------------------- | ---------------------------------------------------- | ------------ |
| produkcja dziś (arkusz i stos CMS jak są)     | **0,394349**                                         | **0,005910** |
| P3.2b (blok z worktree + znormalizowany stos) | **0,000053** (tylko cyfry listy numerowanej, 4-5 px) | **0,000000** |

To jest najmocniejszy dowód mechanizmu z §2 planu (tytuły kart w `system-ui` + jedna twarz Regular). Wartość
0,394 jest większa niż 0,0163 z Lighthouse produkcji, bo tu podmiana następuje zawsze po pierwszym malowaniu
i bez JS-a (cały dokument w kroju zastępczym); kierunek i węzły (tytuły kart, `div.min-w-0`, ticker 208→213)
są te same co w śladzie desktop-3.

### 5.3 Wybór `size-adjust` dla wagi 800 (`harness/usage-sa.mjs`, `harness/run-variants.sh`)

Pomiar ważony użyciem (obliczone style SSR, `text-transform` zastosowany, szerokości canvas RHD vs Liberation)
potwierdza tabelę planu dla 400/500/600/700 (produkcja w widoku: 97,6-98,4 / 98,9-99,2 / 93,5-93,7 / 95,5-95,9),
ale wagi 800 na stronach publicznych używają wyłącznie etykiety WIELKIMI literami (ticker, etykiety sekcji;
bez dekoracyjnych cyfr: 51 znaków, wszystkie uppercase) i stosunek wynosi **99,71%** (korpus mieszanej wielkości
liter: 97,75%). Warianty 800 sprawdzone na emulacji fixture i symulacji produkcji:

| size-adjust(800)                | produkcja desktop | produkcja mobile | fixture desktop EN                         | uwagi                                               |
| ------------------------------- | ----------------- | ---------------- | ------------------------------------------ | --------------------------------------------------- |
| 97,75 (plan)                    | 0,000065          | 0                | **0,006312** ✘ (etykieta sekcji 1→2 linie) | marża fixture 0,5 px                                |
| 98,49 (korpus uppercase)        | 0,000060          | 0                | **0,006312** ✘                             | za mało                                             |
| **99,71 (użycie na produkcji)** | **0,000053**      | **0**            | **0,000325** ✓                             | wybrane                                             |
| 101,0                           | 0,000044          | 0                | 0,000325 ✓                                 |                                                     |
| 104,2 (z cyframi)               | 0,000162          | 0                | 0,000265 ✓                                 | ticker przesuwa się o 6 px w drugą stronę           |
| 99,71 + 900 = 101,39            | 0,000053          | 0                | 0,000325 ✓                                 | 900 bez mierzalnego efektu → zostaje 100,63 z planu |

### 5.4 Bramka jednego fontu na bazie (kontrola negatywna)

`e2e/single-font.boot-home.spec.ts` na `base-w3d` (konfiguracja artefaktu, env jak w CI): **2/2 czerwone** —
PL: dwa preloady (`latin-BX-N26TK`, `latin-ext-Do32GAgg`), EN: preload pliku spoza wzorca `latin-pl`
(`logs/final-single-base.log`). Uwaga: na bazie strona EN też pobierała latin-ext (znaki PL w treści EN fixture
trafiały w zakres latin-ext); w emulacji kandydata EN pobiera wyłącznie `latin-pl`.

### 5.5 Rozmiar arkusza (KRYTYKA L2)

Emulacja (ten sam minifikator co build, lightningcss): `styles-*.css` 542 016 → 543 829 B raw (**+1 813 B**),
gzip (domyślny poziom, jak `check-bundle-size.ts`) 80 443 → 80 699 (**+256 B**), gzip -9 +252 B, Brotli +118 B.
Przy zapasie sumy CSS ~0,6 KB zostaje ~0,35 KB (P3.3/P3.8 według zapowiedzi nie dokładają CSS). Domknięcie bootu:
`themeDesign.ts` jest wyłącznie w chunku `themeDesignCss-*` (inwentarz `base-w3d/reports/chunk-inventory.json`),
więc funkcja normalizacji nie wchodzi do wejścia; `rootHead`/`fontPreload` w wejściu tracą kod (mniej gałęzi) —
oczekiwane Δ `bootClosureRawBytes` ≤ 0. Do potwierdzenia w Prove.

## 6. Co zostaje dla Prove (na buildzie worktree)

1. `BUNDLE_INVENTORY=1 bun run build:smoke` worktree → `check-document-weight` A = `base-w3d`, B = worktree:
   oczekiwane `fontPreloadCount` 2 → **1** (próg 1), `linkHeaderEntries` 5 → 4, `preloadDuplicates` 3 → 2,
   `preLcpTransferBytes` −20 360 B (44 732 → 24 372 B fontów), `headRawBytes` ok. −120 B,
   `renderBlockingCssGzipBytes` ok. +256 B, `bootClosure*` bez wzrostu.
2. `check:bundle`: suma CSS (+~0,26 KB gz przy zapasie ~0,6 KB), public CSS, overall.
3. `test:e2e:artifact` z env CI (obejmuje nowy `e2e/single-font.boot-home.spec.ts`) — musi być zielony na PL i EN.
4. `NES_PERFORMANCE_ARTIFACT_ROOT=<worktree> PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test --config playwright.performance.config.ts e2e-performance/font-swap-cls.spec.ts`
   — oczekiwane wartości jak w §5.1 (kandydat); kontrola negatywna na `base-w3d` już zrobiona (§5.1).
5. Lighthouse `--compare base-w3d <worktree> --runs 5 --forms mobile,desktop`: jedno żądanie woff2 (PL), brak
   latin-ext, CLS 0 w 5/5, ΔFCP ≈ 0, ΔLCP mobile ≤ 0. Lokalnie CLS = 0 także na bazie (fonty przed pierwszym
   malowaniem), więc dowodem CLS jest §5.1-5.2, nie Lighthouse lokalny.
6. `--ratchet` progów `linkHeaderEntries`/`preloadDuplicates`/`preLcpTransferBytes` — orkiestrator.

## 7. Odstępstwa od planu (z uzasadnieniem)

1. **`size-adjust(800)` = 99,71% zamiast 97,75%** (ascent 102,1%, descent 30,59%). Zmierzone (§5.3): waga 800
   na stronach publicznych to wyłącznie etykiety wielkimi literami, które korpus mieszanej wielkości liter zaniżał
   o ~2%; z 97,75% etykieta sekcji fixture EN łamała się dopiero po podmianie (0,0063 CLS w widoku). Produkcja
   też zyskuje (0,000065 → 0,000053). Pozostałe pięć wag = tabela planu (400: ascent 104,18% zamiast 104,17% —
   poprawne zaokrąglenie 104,175; oba w tolerancji testu).
2. **`unicode-range` twarzy głównej + `U+0300-0301, U+0303`**. Plik ma te znaki w cmap (receptura planu), a test
   §9.2 pkt 2 wymaga, by każdy znak z cmap mieścił się w zakresie twarzy; bez nich kombinujące akcenty szły do
   fontu systemowego. Zakres latin-ext ich nie obejmuje, więc nie ma drugiego pobrania.
3. **Plik 24 372 B zamiast „ok. 24 316 B”** i `SOURCE_DATE_EPOCH`. `varLib.instancer` stempluje `head.modified`
   czasem uruchomienia (plik planisty różnił się wyłącznie tą tabelą), więc Brotli daje ±60 B i hash zmienia się
   co przebieg. Ustawienie `SOURCE_DATE_EPOCH` na `head.modified` źródła czyni wynik deterministycznym.
4. **Asercje `font-swap-cls`**: (a) bez progu „pojedyncze przesunięcie ≤ 0,0005” — na mobile tytuł hero fixture
   (3 linie przed i po) przełamuje się wewnątrz tego samego prostokąta i daje 0,0006 (baza ma 0,0006 z innego
   węzła; produkcja w symulacji 0); zostaje kryterium akceptacji planu §11.2: suma ≤ 0,001. (b) Liczba linii
   sprawdzana dla tekstów w widoku (tylko tam przesunięcie wchodzi do CLS); zmiany poniżej zgięcia raportowane
   w `belowFold`. Kontrola negatywna: baza na desktopie 0,0021 (PL) i 0,0212 (EN) — PL poniżej oczekiwanego
   w planie „> 0,005”, ale > 0,001, więc spec ją odrzuca.
5. **`fontPreloadCount` liczy unikalne pliki** (dawniej każdy wpis `<link>` i `Link` osobno, czyli 2 dla jednego
   fontu). Tylko tak próg 1 z decyzji „jeden font” jest wyrażalny; ta sama semantyka co `modulepreloadCount`.
6. **Nowy plik `e2e/single-font.boot-home.spec.ts`** (poza listą §3 planu, nowy plik testu). Decyzja W
   „test jednego żądania woff2” jako bramka CI: `test:e2e:performance` jedzie tylko po scaleniu do main i tylko
   z listą zestawów w `run-first-visit.mjs` (nie mój plik), a konfiguracja artefaktu wybiera `*boot-home.spec.ts`
   sama i jedzie w `ci.yml` na każdym PR.
7. `withRedHatDisplayFallback` = kod z planu §7 (dopasowuje RHD na dowolnej pozycji stosu, nie tylko pierwszej,
   jak sugerowała tabela ryzyk §12). Wstawienie kroju zastępczego zaraz za RHD jest poprawne niezależnie od
   pozycji (to on renderuje się do czasu RHD); stosy bez RHD wracają bez zmian.

## 8. Ryzyka

- **Kroje systemowe**: krój zastępczy powstaje tylko z Arial/Liberation/Arimo/Helvetica (Regular i Bold).
  Android bez nich (Roboto) dalej widzi podmianę `system-ui` — bez zmian wobec dziś; kontynuacja poza P3.2b.
  Spec ma strażnika (skip z komunikatem).
- **Rozrzut per napis**: `size-adjust` to średnia ważona; krótkie napisy odbiegają o ±1-4% (np. „EXAMPLE CONTENT”
  −3,7% przy 97,75%). Przełamanie na granicy jest możliwe dla innych treści CMS; produkcja `/` w symulacji: 0.
- **Odchylenie wagi 800 dla akapitów mieszanej wielkości liter** (2 widżety produkcji z opisem w wadze 800, poza
  widokiem): krój zastępczy ~2% szerszy niż RHD dla takiego tekstu.
- **Suma CSS w `check:bundle`**: +~0,26 KB przy zapasie ~0,6 KB — jeśli P3.3/P3.8 dołożą CSS, suma może się zbliżyć do progu.
- **NES Edge Cache**: stare dokumenty wskazują usunięty `latin-*.woff2`; klucze cache zawierają build od P3.6a —
  potwierdzić sondą `x-nes-cache` po wdrożeniu (plan §12).
- **Scalanie `__root.tsx`**: zmienione wyłącznie importy fontu, `ROOT_ASSETS`, dwa wywołania i komentarz nad
  `rootLinkHeaderValues` — rozłączne z P3.8 (rozgrzewki, nakładki) i P3.6b (`expired()`).

## 9. Na co patrzeć w recenzji

1. `src/styles.css`: kolejność twarzy RHD (latin-ext pierwsza, główna ostatnia), zakresy `unicode-range`
   (brak liter PL w latin-ext), nazwy `local()` Bold, wartości 800 (odstępstwo 1).
2. `documentWeight.ts`: zmiana semantyki `fontPreloadCount` na unikalne (odstępstwo 5).
3. `font-swap-cls.spec.ts`: czy rezygnacja z progu 0,0005 i ograniczenie linii do widoku są akceptowalne
   (odstępstwo 4) — liczby w §5.1.
4. `single-font.boot-home.spec.ts`: wejdzie do `test:e2e:artifact` (CI na PR) automatycznie.
5. `woff2Tables.ts`: moduł tylko testowy — P3.10 (knip) musi go wykluczyć (KRYTYKA L12).

## 10. Potrzeby poza moją listą plików

- (opcjonalnie) `scripts/performance/run-first-visit.mjs`: dopisać `font-swap-cls` do zestawów kandydata, jeśli
  dowód podmiany fontu ma jechać także w `first-visit.yml` (dziś spec uruchamia się ręcznie / w Prove).
- (opcjonalnie, decyzja produktowa) normalizacja `--brand-font-*` (`designTokens.ts:224-225`) i `--gc-*-font`
  (`globalColors.ts:856`) tą samą funkcją — plan i KRYTYKA L9 przesuwają to do fali 4.
