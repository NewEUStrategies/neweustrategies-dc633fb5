# P3.7a (fala 3): minifikacja statycznych literałów CSS, reguły paska do arkusza panelu, metryka komentarzy CSS — IMPL

Data: 2026-10-08/09. Gałąź `perf/w3-P3.7a`, commit `186279bc`, worktree `$SCRATCH/wt3/P3.7a`, baza STAŁA `56da8d23`
(diff zawsze względem `56da8d23`). Zakres wiążący: `faza3/plany/P3.7.md` krok S1 (S1a–S1e, BEZ S1g), krok S3,
metryka `inlineCssCommentBytes` (krok 9 w części S1), `faza3/plany/KRYTYKA.md` §6 (P3.7a) i L2/L14,
rozstrzygnięcia `PLAN-FALI-3.md` §3a.

`$SCRATCH` = `/tmp/claude-0/-home-user-neweustrategies-dc633fb5/57088803-e7ea-5e89-8c05-954276daf4ba/scratchpad`,
narzędzia tej pozycji: `$SCRATCH/phase3/wave3/P3.7a/tools/`.

## 1. Co się zmieniło i dlaczego (plik po pliku)

### Nowe

- **`src/lib/css/minifyStaticCss.ts`** — czysta funkcja bez importów (lustro `p37-tools/cssmin.py` planisty, algorytm
  z P3.7 §3.1): tokenizacja znakowa (napisy i ucieczki `\X` dosłownie, komentarz = separator), ciąg białych znaków →
  jedna spacja, zdjęte spacje obok `{`/`}`/`;` (głębokość 0), wokół pierwszego `:` deklaracji i wokół `,`/`>`
  preludium; `;` przed `}` znika. Klasyfikacja segmentu: preludium, gdy pierwszy separator `{;}` poza nawiasami to `{`.
  Wyjątek przy niedomkniętym napisie/komentarzu/nawiasie/klamrze i przy nadmiarowym domknięciu; funkcja idempotentna.
  Dwie poprawki wobec lustra Pythona (bez wpływu na bajty prawdziwych arkuszy): `[`/`]` liczone jak nawiasy (spacje
  w selektorze atrybutu nietknięte) i pusta wartość właściwości `--x: ;` zachowuje spację (starsze silniki odrzucają
  `--x:;`). Kod aplikacji modułu NIE importuje (tylko wtyczka builda), więc nie trafia do bundla.
- **`scripts/lib/staticCssPlugin.ts`** — wtyczka `nes:static-css` (`apply: "build"`, `enforce: "pre"`), jawna lista
  `STATIC_CSS_MODULES` (4 moduły), znacznik `/* @nes-static-css */` tuż przed backtickiem. Skaner literału: interpolacje
  tylko `${a}` / `${a.b}` (znaczniki `__NES_CSS_I<n>__` na czas minifikacji, przywracane dosłownie), odmowa
  (`this.error` z `plik:linia`) przy `\`, zagnieżdżonym backticku, interpolacji wyrażenia, znaczniku bez literału,
  niepoprawnym CSS-ie i gdyby minifikacja utworzyła `${`; moduł z listy bez znacznika → `this.warn`. Czysta funkcja
  `minifyMarkedCssLiterals` (testowalna) + hook. `map: null` jak w `localeChunkPlugin` (build bez sourcemap).
- **Testy:** `src/lib/css/__tests__/minifyStaticCss.test.ts` (21 złotych przypadków z listy P3.7 §3.1, fallback
  `calc(3 * 1.25em)` przed `calc(3lh)` zostaje, idempotencja, 7 przypadków błędów, niezmienność napisów z
  `"Red Hat Display"`), `src/lib/ci/__tests__/staticCssPlugin.test.ts` (hook karmiony SUROWĄ treścią każdego modułu z
  listy: ≥1 podmiana bez ostrzeżeń, wynik przechodzi `ts.transpileModule` bez diagnostyki, literał = minifikat
  z przywróconymi interpolacjami i kod poza literałem nietknięty, klient = SSR, idempotencja; progi zysku TICKER ≥ 4 500 B
  i SHARED_STYLES ≥ 2 500 B; odmowy z `plik:linia`; ostrzeżenie bez znacznika; **prawdziwy build Vite**
  (`createBuilder`, `sharedPlugins: true`, klient → SSR, wzorzec `widgetChunkPluginBuild.test.ts`) dosłownej kopii
  `globalColors.ts` — wykonane bundle obu środowisk zwracają bajtowo ten sam arkusz = bloki zmiennych + minifikat mostu,
  zero komentarzy, zero ostrzeżeń wtyczki; metryka `inlineCssCommentBytes` na krótkim HTML-u),
  `src/lib/ci/__tests__/sidebarRulesAdminOnly.test.ts` (S3, opis niżej).

### Zmienione

- **`src/components/header/TrendingTicker.tsx`** (S1a), **`src/lib/builder/sliderVariants.tsx`** (S1b),
  **`src/components/builder/organisms/widget-view/SearchButtonWidget.tsx`** (S1e) — WYŁĄCZNIE znacznik przed
  backtickiem (diff: jedna linia w każdym pliku). Literały nietknięte, więc dev i vitest mają dzisiejsze bajty.
- **`src/lib/builder/globalColors.ts`** (S1c + S3) — most widgetów wyciągnięty do stałej modułu
  `GLOBAL_COLORS_BRIDGE_CSS = /* znacznik */ \`…\`.replace(/\s+/g, " ").trim()`(pod funkcją, żeby diff funkcji był
jedną linią`parts.push(GLOBAL_COLORS_BRIDGE_CSS)`; regex na ~19 KB napisu biegnie raz przy ewaluacji modułu, a nie
przy każdym wywołaniu) i **usunięte 16 reguł `[data-sidebar…]`** (14 w bloku + 2 `:where([data-sidebar="sidebar"]:hover)`).
Zmienne `--gc-sidebar-*`dalej emituje`globalColorsToCss`.
- **`src/admin-styles.css`** (S3) — 16 reguł dopisanych NA KOŃCU arkusza, dosłownie (te same selektory, deklaracje,
  `!important`, `@layer utilities` i kolejność), sformatowane prettierem, z polskim komentarzem.
  Wyrocznia lightningcss: 16 reguł z mostu == dopisany blok (3 396 = 3 396 B po normalizacji, `equal: true`).
- **`vite.config.ts`, `vite.smoke.config.ts`** — TYLKO import `staticCssPlugin` i rejestracja na końcu listy `plugins`
  (identycznie w obu; zgodnie z poleceniem, żeby scalenie z legal-links/chat-toasts było trywialne).
- **`src/lib/ci/__tests__/viteChunkParity.test.ts`** — przypadek „oba presety minifikują statyczne literały CSS TĄ SAMĄ
  wtyczką (P3.7a)” (import + `plugins: [...staticCssPlugin()]` w obu).
- **`scripts/performance/documentWeight.ts`** — `cssCommentBytes(css)` (pomija napisy i ucieczki), pole
  `inlineCssCommentBytes` w `DocumentWeight`, wyliczenie w `analyzeDocument`, wpis w `GATED_METRICS` (po
  `inlineStyleBytes`). `check-document-weight.ts` (poza listą plików) nie wymaga zmian: tabela bramek jest generyczna.
- **`scripts/performance/document-weight-budgets.json`** — WYŁĄCZNIE nowy klucz `inlineCssCommentBytes`
  `{max: 517, measured: 517, target: 0}` + jeden akapit `_comment` z uzasadnieniem (istniejące progi nietknięte).
- **`src/lib/builder/__tests__/globalColors.test.ts`** — most bez `data-sidebar`, zmienne `--gc-sidebar-*` emitowane
  w `:root,.light` i `.dark`; most stały (ten sam ogon dla różnych wartości użytkownika).

## 2. Pomiary i prognozy (bez buildu w tym etapie)

Wszystko poniżej to symulacja wtyczki na artefaktach bazy `base-w3b` (63a05a32 = app code bazy `56da8d23`);
liczby buildu da PROVE.

| Co                                                                 |             Baza |                                  P3.7a [symulacja] |                   Δ |
| ------------------------------------------------------------------ | ---------------: | -------------------------------------------------: | ------------------: |
| chunk wejściowy `index-c_XR_U82.js` (domknięcie bootu), raw / gzip |                — |                                                  — | **−4 885 / −1 354** |
| `sliderVariants-*.js` raw / gzip                                   |                — |                                                  — |     −2 928 / −1 354 |
| `designTokensCss-*.js` (most, dynamiczny) raw / gzip               |                — |                                                  — |     −5 893 / −1 247 |
| `SearchButtonWidget-*.js` raw / gzip                               |                — |                                                  — |          −271 / −30 |
| fixture `/` `htmlRawBytes` (`w3/base/lh/home.html`)                |          330 868 |                                            317 385 |         **−13 483** |
| fixture `htmlGzipBytes`                                            |           50 902 |                                             47 259 |              −3 643 |
| fixture `headRawBytes` (hoistowany `nes-slider-shared-v1`)         |           28 985 |                                             26 019 |              −2 966 |
| fixture `inlineStyleBytes`                                         |           84 717 |                                             71 234 |             −13 483 |
| fixture `inlineCssCommentBytes` (nowa)                             |  5 348 (4 bloki) | **517** (tylko `data-content-area`, S1g wyłączone) |              −4 831 |
| produkcja `d2.html` `htmlRawBytes` / gzip                          | 500 741 / 75 959 |                                   487 258 / 72 151 |    −13 483 / −3 808 |
| `admin-styles-*.css` gzip (suma `css` w `check:bundle`)            |           14 152 |                                             14 587 |            **+435** |

- `bootClosureRawBytes` ≈ −4,9 KB i `bootClosureGzipBytes` ≈ −1,35 KB (cel P3.7a z KRYTYKI: −4,9 KB / −1,28 KB);
  `bootBurstGzipBytes` dodatkowo −1,35 KB (`sliderVariants`) − 30 B (wyszukiwarka), jeśli te chunki są w serii.
- **L2 (suma `css`):** +435 B gz na `admin-styles` (dwie niezależne metody: dopisanie zminifikowanych reguł do pliku
  artefaktu bazy i pełna emulacja potoku arkusza, oba +435 B). Zapas „css total: zostało 1.0 KB z 96 KB” spada do ok.
  0,58 KB; `publicCss` bez zmian (admin-styles poza `publicCss`; kandydaci Tailwinda: patrz §4).
  `check:bundle` overall: JS −(1 354 + 1 354 + 1 247 + 30) B gz, CSS +435 B gz → ok. −3,5 KB gz w dół.
- **Wyrocznia S1** (`tools/oracle-s1.ts <worktree> <dokument.html>…`): dla każdego oznaczonego bloku sprawdza (1) że
  HTML niesie DOKŁADNIE wynik `minifyStaticCss` literału źródłowego i (2) `lightningcss(minify)` bloku z HTML-u ==
  `lightningcss(minify)` literału źródłowego (most: segment w bloku `data-brand-tokens`). Na symulowanym dokumencie:
  4/4 bloki `true/true`, exit 0; kontrola negatywna na dokumencie bazy: exit 1 (bloki nieminifikowane, most z regułami
  paska). Lustro Pythona planisty a TS: bajtowo równe na 6 blokach (ticker, slider, most, wyszukiwarka, content-area,
  paleta paska), idempotentne, wyrocznia lightningcss `true` dla każdego.

## 3. Bramki uruchomione w tym etapie

| Bramka                                                                                                                                                                                                                                                                                              | Wynik                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `bunx prettier --write` (16 plików)                                                                                                                                                                                                                                                                 | OK                                                                                                                              |
| `bunx eslint` (pliki TS/TSX)                                                                                                                                                                                                                                                                        | 0 błędów (7 starych ostrzeżeń `react-refresh` w nietkniętych liniach TrendingTicker/slidera)                                    |
| vitest — nowe i zmienione testy (5 plików)                                                                                                                                                                                                                                                          | 121/121 (z prawdziwym buildem Vite: 39/39 w `staticCssPlugin.test.ts`, ok. 1,4 s)                                               |
| vitest — istniejące testy dotkniętych modułów i czytelników arkuszy (26 plików: TrendingTicker*, slider*, SearchButtonWidget*, GlobalColorsEditor*, ThemeBackgroundsPane, AdminShellSkeleton, adminRouteSsr, StyleSink, deferredStyleCss, designTokens, platformBuildGuards, widgetChunkPlugin*, …) | 844 passed + 10 expected fail (bez zmian)                                                                                       |
| `bun run verify:static`                                                                                                                                                                                                                                                                             | **15 bramek OK** (w tym `format:check`, `check:dangerous-html`, bramki SQL i kontrakt TS↔SQL)                                   |
| typecheck (`typecheck-noinc.sh`: tsgo + tsconfig.scripts + e2e, przez mutex)                                                                                                                                                                                                                        | **exit 0** (`typecheck.log`)                                                                                                    |
| sonda kaskady paska (Chromium, A/B, przez mutex)                                                                                                                                                                                                                                                    | zrzuty pikselowo identyczne: spoczynek 4/4, hover 336/336; computed style: 4 167 432 wartości, 144 różnice jednego rodzaju (§4) |

Kontrole negatywne: bez `enforce: "pre"` pada test konfiguracji (esbuild Vite zostawia komentarz-znacznik, więc
prawdziwy build i tak by zadziałał — `pre` jest obroną, nie jedyną drogą); dokument bazy oblewa wyrocznię S1.

Bramki artefaktu (`check:bundle`, `check:chunks`, `check:entry-purity`, `check:server-entry-purity`,
`check:document-weight`, `test:e2e:artifact`), wyrocznia S1 na HTML-u artefaktu, sonda wizualna admina i Lighthouse
`--compare` należą do etapu PROVE (build w tym etapie zabroniony).

## 4. L14 (kaskada S3) — analiza i dowody

- Kolejność w dokumencie: `admin-styles.css` to `<link>` w `<head>` (trasa `/admin`, `head().links`), a blok
  `data-brand-tokens` to `<style>` w `<body>` (`__root.tsx`, `DesignTokensStyle`). Dawne reguły paska szły więc PO
  arkuszu panelu — dopisanie na KOŃCU arkusza zachowuje ich wygraną przy równej specyficzności nad regułami
  `[data-sidebar-style=…]` (test `sidebarRulesAdminOnly`: pierwsza reguła kolorów stoi za ostatnią regułą stylu).
- Zmienia się tylko kolejność względem RESZTY mostu (dalej w `<body>`): reguły paska bez warstwy mają specyficzność
  > 0, a reszta mostu to `:where()` (0) — wygrywają niezależnie od kolejności. Trzy reguły w `@layer utilities`
  > (tylko fonty) konkurują wyłącznie z `:where(header a, header button)` (fonty) — pasek panelu nie leży w `<header>`
  > ani go nie zawiera (grep emiterów); typografia `:where(main p…)` stała ZA regułami paska już przed zmianą.
- Potok arkusza (emulacja: `adminCssPlugin` → Tailwind 4.3.3 `compile/build/optimize` → lightningcss, wierna co do
  zestawu reguł z artefaktem bazy): Tailwind przenosi trzy bloki `@layer utilities` na KONIEC warstwy utilities
  arkusza panelu, a 13 reguł bez warstwy ląduje na końcu części bez warstwy (za `.cms-mode-switch…`, przed `@property`);
  lightningcss scala dwie sąsiednie reguły `:where([data-sidebar=sidebar]:hover)` w jedną (semantycznie identyczne)
  i dokłada `-webkit-text-decoration` przed `text-decoration` (jak w całym arkuszu; nieprefiksowana wygrywa).
  Różnica emulowanych arkuszy bazy i P3.7a = wyłącznie te reguły.
- Kandydaci Tailwinda (`adminCssPlugin` i skan całego `src`): bez zmian w realnych utilities (różnice tylko w
  tokenach-słowach: `menu-button`, `bocznego`, nazwy zmiennych `--gc-sidebar-*-hover` z usuniętych linii, identyfikatory
  z nowego kodu) — `publicCss` i utilities panelu nietknięte.
- Sonda Chromium (`tools/probe/`): strona A = `styles.css` artefaktu bazy + emulowany arkusz panelu bazy + bloki
  `<style>` dokumentu bazy, strona B = to samo po P3.7a; DOM paska jak w `AdminShell` (marka, przełącznik, etykiety
  grup, podtytuł, przyciski i linki menu aktywne/zwykłe/akcent, `menu-sub-label`, separator, `.active`), 6 stylów ×
  jasny/ciemny × (kolory domyślne i własne `--gc-sidebar-*`), pełny `getComputedStyle` każdego elementu w spoczynku
  i przy hoverze każdego elementu interaktywnego (84 stany na wariant). Wynik (`probe-final.log`, zrzuty w `shots/`):
  **zrzuty A i B pikselowo identyczne** w spoczynku (4/4) i przy hoverze (336/336); z 4 167 432 porównanych wartości
  `getComputedStyle` różni się 144, wszystkie jednego rodzaju: `background-position: "0% 0%" -> "0px 0px"` na linku
  marki i przełączniku (`a[data-sidebar-brand]`, `button[data-sidebar-toggle]`). Przyczyna: lightningcss w potoku
  arkusza zapisuje `background: transparent !important` jako `background:0 0!important` (ten sam zapis ma dziś
  w artefakcie bazy np. `.block-canvas …{background:0 0!important}`); pozycja zerowa w `%` i `px` to ten sam punkt,
  kolor przezroczysty, brak obrazu - renderowanie identyczne (zrzuty). Dwie wcześniejsze serie sondy miały artefakty
  samej sondy (niedokończone przejścia CSS po zmianie motywu, wskaźnik po `goto` nad elementem) - naprawione
  (`getAnimations().finish()`, wskaźnik parkowany poza paskami); logi `probe-run1-transitions.log`,
  `probe-run2-pointer.log`.

## 5. Odstępstwa od planu

1. **S1g pominięty** (polecenie orkiestratora: `ContentAreaStyle.tsx` zmienia P3.8). Skutek: `inlineCssCommentBytes`
   ma próg 517 B (szablon content-area, stała treść), nie 0; `htmlRawBytes` na fixture −13,5 KB z samego P3.7a
   (kryterium „−≥ 25 KB” dotyczy całego P3.7 z P3.7b).
2. **Stała mostu POD funkcją** `globalColorsToCss`, nie nad nią — wyłącznie dla czytelnego diffu (funkcja zmienia
   jedną linię); stała jest czytana dopiero w wywołaniu, po ewaluacji modułu.
3. **Test metryki** `inlineCssCommentBytes` w `staticCssPlugin.test.ts` (lista plików nie przewiduje osobnego testu
   `documentWeight.ts`, a vitest zbiera tylko `src/**`); metryka jest siatką bezpieczeństwa tej wtyczki.
4. **Prawdziwy build Vite w `staticCssPlugin.test.ts`** — ponad specyfikację (wzorzec `widgetChunkPluginBuild`),
   dlatego plik ma `// @vitest-environment node`.
5. **Test S3 jako kontrakt przepływu danych**, nie lista 16 reguł: każdy slot grupy `sidebar` ma konsumenta
   `var(--gc-<slot>` w `admin-styles.css`, dokument publiczny nie ma ani `data-sidebar`, ani `var(--gc-sidebar-`,
   reguły kolorów stoją za regułami stylów; do tego emitery `data-sidebar` tylko w `src/components/admin/**`
   i odwrotny graf importów: każda trasa, która je importuje, leży pod `/admin` (13 tras, w tym
   `admin.events_.$eventId.tsx`, `admin.events_.new.tsx`).
6. Akapit `_comment` w `document-weight-budgets.json` dla nowego klucza (uzasadnienie progu 517 B ≠ 0). Istniejące
   progi nietknięte; ratchet (`htmlRawBytes`, `htmlGzipBytes`, `headRawBytes`, `inlineStyleBytes`,
   `bootClosure*`, `bootBurstGzipBytes`, `preLcpTransferBytes`) robi orkiestrator po pomiarze PROVE.

## 6. Ryzyka

- **Kolejność wtyczek `pre`:** framework (TanStack Start compiler) przepisuje tylko pliki z `createServerFn` /
  `createIsomorphicFn` / `createServerOnlyFn` / `createClientOnlyFn` / `createMiddleware` / `.handler(` / `ClientOnly`
  — żaden z czterech modułów ich nie ma (grep). Gdyby znacznik nie dotarł: ostrzeżenie builda + czerwona metryka
  `inlineCssCommentBytes` (próg 517 B, bez wtyczki byłoby 5 348 B).
- **Parytet hydratacji:** ta sama czysta funkcja na tym samym surowym pliku w obu środowiskach (test: klient = SSR,
  także na prawdziwym buildzie). `StyleSink` porównuje napis, `hardenStyleCss` nie dotyka tych literałów.
- **S3 / wygląd panelu:** reguły przeniesione dosłownie i na koniec arkusza; dowody w §4. Sonda wizualna prawdziwego
  panelu (5–6 stylów × jasny/ciemny, zrzuty przed/po + `getComputedStyle`) w PROVE wymaga zalogowanej sesji na
  artefakcie.
- **Budżet `css` (L2):** +435 B gz przy zapasie ~1,0 KB; P3.2b dokłada ~+250 B → zostaje ~0,3 KB.
- **P3.10 / knip (L12):** `src/lib/css/minifyStaticCss.ts` i `scripts/lib/staticCssPlugin.ts` są celowo poza
  bundlem aplikacji — muszą być na liście wykluczeń S0/S2 P3.10.
- `inlineCssCommentBytes` = 517 przyjmuje, że nikt nie doda komentarza do szablonu content-area przed S1g; sprawdzone
  gałęzie partii 2 (P3.6b, P3.8, chat-toasts, legal-links, P3.3) nie dodają komentarzy CSS.

## 7. Dla recenzenta / PROVE

1. `minifyStaticCss`: klasyfikacja preludium/deklaracja, pusta wartość `--x: ;`, ucieczki poza napisami.
2. `staticCssPlugin`: odmowy (zwłaszcza `${`), `cursor` przy wielu znacznikach, `this.error` z linią.
3. `globalColors.ts`: most bez 16 reguł; reszta literału bajtowo jak przed zmianą (diff pokazuje tylko usunięte linie).
4. `admin-styles.css`: blok na końcu; prettier złamał długie `var(` — semantyka sprawdzona lightningcss.
5. PROVE: `check:document-weight` (`inlineCssCommentBytes` = 517, `bootClosureRawBytes` ≈ −4,9 KB,
   `bootClosureGzipBytes` ≈ −1,35 KB, `headRawBytes` −2 966 B, `htmlRawBytes` ≈ −13,5 KB), `check:bundle` (overall
   w dół, `publicCss` bez zmian, suma `css` ≈ +0,43 KB w limicie), `check:chunks`, `check:entry-purity`,
   `test:e2e:artifact` (zero błędów hydratacji), wyrocznia S1: `bun run $SCRATCH/phase3/wave3/P3.7a/tools/oracle-s1.ts
<worktree> <HTML z artefaktu>` (exit 0), Lighthouse `--compare` mobile + desktop4x n = 5 (ParseHTML w dół).
   Sonda kaskady na arkuszu Z ARTEFAKTU: podmienić `tools/probe/admin-B.css` na `admin-styles-*.css` z `.output`
   P3.7a, `admin-A.css` na plik `base-w3b`, `node tools/probe/make-pages.mjs <HTML bazy> <HTML P3.7a> tools/probe`
   (pisze `A.html`, `B.html`, `A-custom.html`, `B-custom.html`), potem `heavy.sh node tools/probe/probe.mjs tools/probe`.
