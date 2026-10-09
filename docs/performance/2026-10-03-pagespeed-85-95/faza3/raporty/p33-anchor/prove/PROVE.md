# P3.3 kotwica: dowód poprawki (PROVE, runda fix1)

- Gałąź `fix/w3-p33-anchor`, worktree `scratchpad/wt3/p33-anchor`. HEAD = **`bd3f8188`**
  (`HEAD.txt`), drzewo czyste przed i po przebiegach.
- Kontrola: artefakt `4d1e2791` w `scratchpad/base-w3f` (`.output` z 02:18). Użyty tylko do odczytu
  przez `NES_ARTIFACT_ROOT`, nieprzebudowany.
- Wszystkie kroki ciężkie szły przez mutex (`heavy-bg.sh`). Serwery Playwrighta zgasły razem
  z runnerem (porty 4181 i 4199 wolne), mutex wolny.

## Werdykt

**Wszystkie bramki są zielone, żadna metryka nie przekracza progu, a test kotwicy przechodzi na
poprawce. `needs_fix = false`.**

| bramka                                                                                                        | wynik                                              |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| build (`BUNDLE_INVENTORY=1 build:smoke`)                                                                      | przebudowany, exit 0                               |
| `check:bundle` / `check:chunks` / `check:entry-purity` / `check:server-entry-purity` / `check:dangerous-html` | wszystkie OK                                       |
| `check-document-weight` (node, 5 próbek)                                                                      | OK, wszystko w progach, progi bez zmian            |
| pełny `test:e2e:artifact` (env jak w CI)                                                                      | **41/41**                                          |
| spec content-visibility `--repeat-each 10`                                                                    | **230/230**, 0 flaky                               |
| kontrola: `-g kotwica --repeat-each 10` na `4d1e2791`                                                         | **36 failed / 140** (pada, zgodnie z oczekiwaniem) |

## 1. Build

**Przebudowany.** Ostatni build implementera (`build-r1.log`) skończył się o 09:11. Plik
`BuilderRenderer.tsx` ma jednak mtime 09:13, a commit `bd3f8188` powstał o 09:37. Nie dało się więc
wykazać, że `.output` odpowiada HEAD.

Przebudowa przez mutex: `BUNDLE_INVENTORY=1 bun run build:smoke`, `prove/build.log`, exit 0,
`.output` z 10:24.

## 2. Bramki statyczne i waga dokumentu

| bramka                      | wynik | log                             |
| --------------------------- | ----- | ------------------------------- |
| `check:bundle`              | OK    | `check:bundle.log`              |
| `check:chunks`              | OK    | `check:chunks.log`              |
| `check:entry-purity`        | OK    | `check:entry-purity.log`        |
| `check:server-entry-purity` | OK    | `check:server-entry-purity.log` |
| `check:dangerous-html`      | OK    | `check:dangerous-html.log`      |

Szczegóły:

- **`check:bundle`:** JS overall 4753,7 / 4772 KB, public 2803,8 / 2877 KB, największy chunk 261,3 /
  286 KB, CSS 95,4 / 96 KB (public 81,2 / 83 KB), domknięcie bootu 487,0 KB gz, próg 579 KB.
  Ostrzeżenia `!` dotyczą składu chunków spoza P3.3, jak na czubku.
- **`check:chunks`:** graf acykliczny, 895 chunków i 6864 krawędzie.
- **`check:entry-purity`:** 10 chunków bootu, `index-BsHml304.js`.
- **`check:server-entry-purity`:** 1816 plików, graf czysty.
- **`check:dangerous-html`:** 79 sinków, w tym 54 sanityzowane, 8 literalnych i 17 zwolnionych. Bez
  zmian wobec czubka, bo strażnik jest dalej literałem w `CvBlock`.

### `node scripts/performance/check-document-weight.ts --json prove/document-weight.json`

Porównanie z `phase3/integ-tip2/document-weight.json` (artefakt `4d1e2791`, ten sam skrypt). Plik
`document-weight-budgets.json` jest bez zmian wobec `4d1e2791`. Pełna tabela 29 metryk:
`metrics-table.md`, bez przekroczeń.

| metryka                       | `4d1e2791` | `bd3f8188` |        Δ |     `max` |  zapas |
| ----------------------------- | ---------: | ---------: | -------: | --------: | -----: |
| `htmlRawBytes`                |    328 452 |    329 323 | **+871** |   406 180 | 76 857 |
| `htmlGzipBytes`               |     50 448 |     50 315 | **−133** |    57 710 |  7 395 |
| `inlineScriptBytes`           |     87 551 |     88 422 | **+871** |    98 103 |  9 681 |
| `inlineExecutableScriptBytes` |     80 304 |     81 175 |     +871 |    91 725 | 10 550 |
| `inlineCssCommentBytes`       |        517 |        517 |        0 |       517 |      0 |
| `inlineStyleBytes`            |     71 363 |     71 363 |        0 |   135 546 | 64 183 |
| `bootClosureRawBytes`         |  1 632 978 |  1 632 978 |        0 | 1 637 758 |  4 780 |
| `bootClosureGzipBytes`        |    495 154 |    495 154 |    **0** |   496 679 |  1 525 |
| `bootBurstGzipBytes`          |    572 380 |    572 380 |        0 |   574 673 |  2 293 |
| `renderBlockingCssGzipBytes`  |     80 443 |     80 443 |        0 |    81 399 |    956 |
| `preLcpTransferBytes`         |    175 623 |    175 490 |     −133 |   181 594 |  6 104 |
| `dehydratedStateBytes`        |     61 047 |     61 047 |        0 |    66 486 |  5 439 |

Interpretacja:

- **+871 B surowego HTML to wyłącznie strażnik inline.** Rośnie z 3 linii (`try{…}catch`) do IIFE
  z nasłuchem `click`/`popstate`/`hashchange` i sprawdzeniem `:~:`. Pozostałe składowe dokumentu
  mają tę samą wagę: `<style>`, `<head>`, stan dehydratacji i preloady.
- **Gzip spada o 133 B mimo wzrostu raw.** Implementer zmierzył ten sam efekt na `470e2a52` (50 259 B
  przy tej samej bazie). Kompresja strumienia jest wrażliwa na ułożenie bajtów, więc to nie jest
  zysk do przypisywania poprawce. Ważne jest to, że wynik leży w progu z zapasem 7,4 KB.
- **Domknięcie bootu, CSS i komentarze CSS bez zmian (0 B).** Poprawka nie dotyka bundla klienta
  ani inline CSS. Zapas `bootClosureGzipBytes` (1525 B) i zerowy margines
  `inlineCssCommentBytes` (517/517) są nienaruszone.
- **Zapas `inlineScriptBytes`:** ok. 10,5 KB przed poprawką i 9,7 KB po niej.

## 3. e2e na artefakcie

Środowisko jak w kroku CI (`.github/workflows/ci.yml`, „Boot test and first-load timing…”):
`CI=true NES_ARTIFACT_FIXTURE=1 SUPABASE_URL=https://placeholder.supabase.co
VITE_SUPABASE_URL=https://placeholder.supabase.co SUPABASE_PUBLISHABLE_KEY=placeholder-anon-key
VITE_SUPABASE_PUBLISHABLE_KEY=placeholder-anon-key`. Przebiegi idą przez
`playwright.artifact.config.ts` na 2 workerach. Dławienie CPU (x6 na telefonie, x1 na desktopie)
nakłada sam spec przez CDP.

### 3a. Pełny `bun run test:e2e:artifact` na poprawce: **41/41** (4,6 min)

Log `e2e-full.log`. Rozkład:

| spec                 | testy |
| -------------------- | ----: |
| `boot-artifact`      |     3 |
| `boot-timing`        |     3 |
| `boot-home`          |     3 |
| `backend-quiet`      |     1 |
| `legal-links`        |     5 |
| `motion-gate`        |     3 |
| `content-visibility` |    23 |

### 3b. `content-visibility.boot-home.spec.ts --repeat-each 10` na poprawce: **230/230**

25,3 min, `unexpected 0`, `flaky 0`. Logi: `e2e-cv-repeat10.log`, `.json`.

| test (telefon 412x823, CPU x6)                                                          |                           wynik |
| --------------------------------------------------------------------------------------- | ------------------------------: |
| kotwica po wczytaniu, `location.hash`, nagłówek w dalszej sekcji                        |                           10/10 |
| **kotwica po wczytaniu, `location.hash`, góra dalszej sekcji** (odpowiednik porażki CI) |                       **10/10** |
| kotwica po wczytaniu, klik `#id`, nagłówek w dalszej sekcji                             |                           10/10 |
| kotwica po wczytaniu, klik `#id`, góra dalszej sekcji                                   |                           10/10 |
| wstecz/dalej między fragmentami                                                         | 10/10 (śr. 48,7 s, limit 240 s) |
| wejście z fragmentem `#id`                                                              |                           10/10 |
| wejście z fragmentem tekstowym `#:~:text=`                                              |                           10/10 |
| pozostałe (HTML serwera, kółko do końca bez przesunięć, przeładowanie, wstecz SPA)      |                     10/10 każdy |

Desktop 1350x940 (CPU x1): wszystkie 11 testów 10/10. Druk: 10/10.

### 3c. Kontrola: ten sam spec `-g kotwica --repeat-each 10` na STARYM artefakcie `4d1e2791`: **36 failed / 140**

16,5 min, logi `e2e-control-base.log`, `.json`. Konfiguracja, środowisko i dławienie są te same,
różni się tylko `NES_ARTIFACT_ROOT=…/base-w3f`.

| test                                                              |  `4d1e2791` |  `bd3f8188` |
| ----------------------------------------------------------------- | ----------: | ----------: |
| telefon, po wczytaniu, `location.hash`, nagłówek w dalszej sekcji |       10/10 |       10/10 |
| **telefon, po wczytaniu, `location.hash`, góra dalszej sekcji**   |    **0/10** |   **10/10** |
| telefon, po wczytaniu, klik `#id`, nagłówek w dalszej sekcji      |       10/10 |       10/10 |
| **telefon, po wczytaniu, klik `#id`, góra dalszej sekcji**        |    **4/10** |   **10/10** |
| telefon, wstecz/dalej                                             |       10/10 |       10/10 |
| telefon, wejście z `#id`                                          |       10/10 |       10/10 |
| **telefon, wejście z `#:~:text=`**                                |    **0/10** |   **10/10** |
| desktop, 6 testów kotwicy z `#id`                                 | 10/10 każdy | 10/10 każdy |
| **desktop, wejście z `#:~:text=`**                                |    **0/10** |   **10/10** |

Komunikaty porażek na `4d1e2791` są tej samej klasy co porażka CI:

- `location.hash -> #e2e-gora-sekcji-celu`: „cel poza miejscem pod nagłówkiem w 10-70 z 87-157
  klatek od 501-2829 ms po nawigacji (render routera 3453-6309 ms)”, czyli cel zepchnięty w dół po
  dorysowaniu sekcji nad nim, jak w CI (`top` 1239,875);
- klik `#id` (góra sekcji): 2-6 złych klatek, 6/10 przebiegów;
- `#:~:text=` na telefonie: „cel poza widokiem w 40-50 z 41-50 klatek”, `cvOff:false`,
  `sectionCv:"auto"`;
- `#:~:text=` na desktopie: klatki z cv bez wyłącznika (`cvOff:false`).

Kontrola **pada deterministycznie** (0/10) w wariancie odpowiadającym porażce CI, a poprawka
przechodzi 10/10. Test rozróżnia więc oba buildy pod tym samym dławieniem, a poprawka usuwa defekt.

## 4. Uwagi (nie blokują)

1. **Reset TanStacka przy fragmencie tekstowym (poza P3.3, opisany w IMPL-fix1 §5) potwierdzony.**
   Adnotacje `text-fragment` z przebiegu 3b:
   - telefon: 10/10 przebiegów kończy na `scrollY 0`;
   - desktop: 8/10 kończy na `scrollY 0`, a 2/10 zostaje na `scrollY 1828` z celem `top 588`
     w widoku.

   Do chwili resetu cel stoi w widoku w każdej klatce, a cv jest wyłączone (`cvOff:true` 20/20).
   Linki z wyszukiwarki z wyróżnieniem tekstu kończą więc zwykle na górze strony, niezależnie od
   cv. To kandydat na osobną pozycję (`src/router.tsx`, `scrollRestoration`), nie powód do
   poprawki tej gałęzi.

2. **Proxy CI.** Dławienie x6 na tej maszynie odtwarza klasę porażki z CI (spychanie celu o ekran
   na telefonie). Runner `ubuntu-latest` jest wolniejszy, więc margines czasowy testów
   wstecz/dalej (śr. 48,7 s przy limicie 240 s) wystarcza z dużym zapasem. Ostatecznym dowodem
   pozostaje zielony przebieg CI po pushu.

## Pliki (`phase3/p33-anchor/prove/`)

- Build i bramki statyczne: `build.log`, `check:*.log`.
- Waga dokumentu: `docweight.log`, `document-weight.json`, `metrics-table.md`.
- Przebiegi e2e i ich wyniki: `e2e-full.log`, `e2e-cv-repeat10.{log,json}`,
  `e2e-control-base.{log,json}`, `test-results-*/`.
- Narzędzia: `summ.py` (agregacja JSON-a Playwrighta), `HEAD.txt`.
