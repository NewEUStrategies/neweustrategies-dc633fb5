# P3.7a: recenzja adwersaryjna

Data: 2026-10-09. Worktree `$SCRATCH/wt3/P3.7a`, commit `186279bc`, diff względem STAŁEJ bazy `56da8d23`.
Werdykt: **APPROVE**. Nie ma ustaleń blokujących ani poważnych. Jest 6 drobnych (minor), wszystkie do decyzji orkiestratora lub do domknięcia w PROVE.

## 1. Zakres

- 16 plików. Wszystkie są na liście z notatek orkiestratora:
  - nowe: `minifyStaticCss.ts`, `staticCssPlugin.ts` i 3 testy;
  - zmieniane: 11 plików z listy.
- Poza listą nie zmieniono niczego. Nie ma też plików zbłąkanych ani nowych zależności (`typescript` i `vite` to devDependencies).
- `vite.config.ts` i `vite.smoke.config.ts`: wyłącznie import i rejestracja na końcu `plugins`, identycznie w obu plikach.
- Literały w `TrendingTicker.tsx`, `sliderVariants.tsx` i `SearchButtonWidget.tsx` zmieniają się o jeden token (znacznik).
- `globalColors.ts`:
  - stała modułu ze znacznikiem;
  - usunięte 16 reguł `[data-sidebar…]` (14 + 2 `:where(...:hover)`);
  - reszta literału bajtowo bez zmian (diff pokazuje wyłącznie usunięte linie).
- S1g pominięty zgodnie z poleceniem (`ContentAreaStyle.tsx` należy do P3.8).
- Odstępstwa 1–6 w IMPL §5 mają podane powody. Odstępstwo nr 6 (akapit `_comment`) opisuję w ustaleniu M3.
- Napisy `"Red Hat Display"` zostają dosłownie. Pilnuje tego test niezmienności napisów i tokenizer, który przepisuje napisy bez zmian.
- Scalanie:
  - `git merge-tree` z obecnym czubkiem gałęzi PR `b8bf6c14` (P3.6b, toasty czatu, linki prawne) daje czyste drzewo;
  - z czubkiem P3.8 `c2697ba1` też czyste;
  - partia 2 nie dodaje nowych `<style>`, `StyleSink` ani `dangerouslySetInnerHTML`, więc próg `inlineCssCommentBytes` = 517 się nie rozjedzie;
  - P3.8 nie zmienia komentarzy szablonu content-area.
- Commit: opis po polsku, stopka dokładnie `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` + `Claude-Session: …`.

## 2. Mechanizm i poprawność

- **Wtyczka** (`scripts/lib/staticCssPlugin.ts`):
  - zgodna ze specyfikacją P3.7 §3.1 (`apply: "build"`, `enforce: "pre"`, jawna lista, `this.error` z `plik:linia`, `this.warn` dla modułu bez znacznika, `map: null`);
  - żaden z 4 modułów nie zawiera konstrukcji przepisywanych przez kompilator TanStack Start (grep: 0 trafień);
  - `@vitejs/plugin-react` w buildzie bez wtyczek Babel nie przepisuje plików przed nami;
  - znacznik nie występuje w komentarzach dokumentacyjnych tych modułów (test karmi hook surowymi plikami).
- **Parytet SSR/klient:**
  - ta sama czysta funkcja działa na tym samym surowym wejściu;
  - test prawdziwego builda (`createBuilder`, klient → SSR, wykonane bundle) potwierdza bajtową równość;
  - `StyleSink` porównuje napis;
  - `<style href precedence>` slidera React 19 adoptuje po `href`;
  - klucz L2 dokumentu niesie identyfikator buildu, więc stary HTML nie spotka nowego JS-a.
- **Chunki:**
  - kod aplikacji nie importuje `minifyStaticCss`, więc w grafie nie ma nowych krawędzi;
  - `globalColors.ts` importują wyłącznie trasy admina, moduły admina i dynamiczny `designTokensCss`, więc jest poza bootem. Regex przy ewaluacji modułu nie wchodzi do domknięcia bootu.
- **Kaskada S3 (L14):**
  - `DesignTokensStyle` stoi w `__root.tsx` PRZED `ContentAreaStyle`, `ThemeOptionsStyle`, `ThemeDesignStyle` i `ThemeFontSizesStyle`. Kolejność przeniesionych reguł względem tych bloków i względem reszty `admin-styles.css` jest więc zachowana;
  - zmienia się tylko kolejność względem reszty mostu. Ta reszta to `:where()` (0) i `@layer utilities` dla `header a/button`. W emiterach `data-sidebar` nie ma `<header>`;
  - emitery `data-sidebar=` są wyłącznie w `src/components/admin/**` (6 plików, w tym podgląd `ThemeOptionsPane`). `AdminShellSkeleton` renderuje `/admin`, który ładuje arkusz w `head()`;
  - podgląd na żywo w `GlobalColorsEditor` i `ThemeBackgroundsPane` dalej działa, bo nadpisuje zmienne `:root`, a reguły w arkuszu je czytają.
- Lantern / SI: zmiana usuwa wyłącznie bajty, czyli krótszy ParseHTML i mniejszy chunk wejściowy. Nie dodaje zadań ani nowej późnej zmiany wizualnej i nie rusza geometrii, więc CLS się nie zmienia.
- SEO, i18n, a11y, zgody: bez wpływu.

## 3. Bramki uruchomione w recenzji

| Bramka                                                                                                                                                 | Wynik                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `light.sh bunx eslint` (14 plików TS/TSX)                                                                                                              | exit 0; 0 błędów, 7 starych ostrzeżeń `react-refresh` w nietkniętych liniach |
| `light.sh bunx vitest run` (5 nowych/zmienionych plików testów)                                                                                        | 124/124                                                                      |
| `light.sh bunx vitest run` (AdminShellSkeleton, GlobalColorsEditor, ThemeBackgroundsPane, TrendingTicker.motion, adminRouteSsr, sliderVariantCatalogs) | 276 passed + 4 expected fail                                                 |
| `light.sh bun run verify:static`                                                                                                                       | 15/15 OK (w tym `format:check`, `check:dangerous-html`, kontrakt TS↔SQL)     |
| Wyrocznia `tools/oracle-s1.ts` na symulowanym `home.html.p37a.html`                                                                                    | 4/4 bloki `true/true`, exit 0 (na HTML-u artefaktu: w PROVE)                 |
| Przypadki brzegowe minifikatora (`review/edge.ts`)                                                                                                     | 15/16 poprawne; `.a/**/.b` → `.a .b` (M1)                                    |

Bez typechecku, builda i Lighthouse (zgodnie z poleceniem). Logi: `review/*.log`.

## 4. Ustalenia

### M1 [minor] Komentarz sklejający tokeny staje się kombinatorem potomka

- **Miejsce:** `src/lib/css/minifyStaticCss.ts:86-91`.
- **Dowód:** komentarz zawsze zamienia się w spację, więc `minifyStaticCss(".a/**/.b{top:0}")` daje `".a .b{top:0}"`. W CSS komentarz nie jest białym znakiem: `.a/**/.b` to selektor złożony `.a.b`, a wynik to selektor potomka. Dzisiejsze 4 literały tego nie mają (wyrocznia lightningcss: równość). Wyrocznia biegnie jednak tylko w PROVE, a nie w CI, więc przyszła edycja literału zmieni semantykę po cichu. Ten sam algorytm ma lustro Pythona planisty.
- **Poprawka:** gdy komentarz nie sąsiaduje z białym znakiem ani z separatorem (`{ } ; , > :`) po żadnej stronie, rzucić błąd „komentarz między tokenami”. Wtyczka zamieni go na błąd builda z `plik:linia`. Do tego dopisać złoty przypadek błędu.

### M2 [minor] Test S3 nie wykryje usunięcia pojedynczej reguły i zawiera asercje na tekście źródła

- **Miejsce:** `src/lib/ci/__tests__/sidebarRulesAdminOnly.test.ts:134-147` i `:110-112`.
- **Dowód (luka):** test „każdy slot ma konsumenta `var(--gc-<slot>`” przechodzi po usunięciu np. `[data-sidebar="separator"]{…}` (zmienną `sidebar-border` czyta też pierwsza reguła) albo `[data-sidebar="sidebar"] svg{…}` (`sidebar-icon` czyta też reguła hover).
- **Dowód (tekst źródła):** asercje regexem na źródle `admin.tsx` oraz `lastIndexOf`/`search` w tekście arkusza to testy tekstu źródła, a reguła sesji brzmi „behavioural tests only”. Specyfikacja P3.7 §3.4 jawnie zamawia jednak „skan źródeł”, a wykonawca opisał odstępstwo nr 5.
- **Poprawka (opcjonalna):** zamiast tego dodać asercję per wartość atrybutu emitowana w panelu (`sidebar`, `menu-button`, `group-label`, `group-subtitle`, `menu-sub-label`, `separator`). Dla każdej musi istnieć selektor w arkuszu, którego blok czyta `--gc-sidebar-*`. Alternatywnie zostawić jak jest i przyjąć, że regresję pojedynczej reguły łapie sonda wizualna.

### M3 [minor] Akapit `_comment` w progach poza literą polecenia

- **Miejsce:** `scripts/performance/document-weight-budgets.json:34-36`.
- **Dowód:** polecenie brzmiało „WYŁĄCZNIE nowy klucz `inlineCssCommentBytes`”. Wykonawca dopisał też akapit `_comment` i przez to zmienił ostatnią istniejącą linię tablicy (przecinek). Specyfikacja P3.7 §3.9 o ten akapit prosi, a progi nie są ruszone. Skutek to pewny konflikt tekstowy z każdą pozycją partii 3 dopisującą akapit na końcu `_comment` (np. P3.2b, `fontPreloadCount`). Konflikt jest trywialny.
- **Poprawka:** bez zmian w kodzie. Orkiestrator rozwiązuje konflikt przy scaleniu albo przenosi akapit do commitu ratchetu.

### M4 [minor] Próg `inlineCssCommentBytes` = 517 bez zapasu, zmierzony na wariancie LH, a nie bramki

- **Miejsce:** `document-weight-budgets.json` (`inlineCssCommentBytes.max = 517`).
- **Dowód:** IMPL §2 liczy 517 B na `w3/base/lh/home.html`, a `check:document-weight` mierzy wariant przeglądarkowy strumieniowy (5 próbek). Szablon content-area jest stały, więc wartość powinna być ta sama, ale tego nie zmierzono.
- **Poprawka:** w PROVE potwierdzić medianę 517 na wyjściu bramki. Jeśli wyjdzie inaczej, próg ustawić z pomiaru bramki, nigdy powyżej pomiaru.

### M5 [minor] Stała mostu zadeklarowana pod funkcją, która jej używa

- **Miejsce:** `src/lib/builder/globalColors.ts:871` i `:899`.
- **Dowód:** dziś to bezpieczne, bo nic nie woła `globalColorsToCss` w trakcie ewaluacji modułu. Każde przyszłe wywołanie na najwyższym poziomie modułu, nad stałą, skończy się `ReferenceError` (TDZ). Czytelny diff, czyli powód z odstępstwa nr 2, to słabe uzasadnienie wobec tego ryzyka.
- **Poprawka:** przenieść `GLOBAL_COLORS_BRIDGE_CSS` nad `globalColorsToCss` albo zostawić z jednym zdaniem komentarza o TDZ.

### M6 [minor, do PROVE] Suma `css` w `check:bundle` (KRYTYKA L2)

- **Dowód:** S3 dokłada ok. +435 B gzip do `admin-styles` przy zapasie ok. 1,0 KB. Zostaje ok. 0,58 KB, a po P3.2b (+250 B) ok. 0,3 KB. To prognoza z emulacji potoku.
- **Poprawka:** PROVE mierzy sumę `css` na artefakcie. Jeśli zapas spadnie poniżej ok. 0,3 KB, orkiestrator rozważa przed P3.2b, czy da się odzyskać bajty w `admin-styles`.

## 5. Do PROVE (bez zmian w kodzie)

- `check:document-weight`:
  - `bootClosureRawBytes` ≈ −4,9 KB;
  - `bootClosureGzipBytes` ≈ −1,28…−1,35 KB;
  - `htmlRawBytes` w dół;
  - `inlineCssCommentBytes` = 517 (M4).
- `check:bundle`: overall w dół, `publicCss` bez zmian, suma `css` w limicie (M6).
- `check:chunks`, `check:entry-purity`.
- Wyrocznia S1 na HTML-u artefaktu.
- `test:e2e:artifact` (zero błędów hydratacji).
- Sonda admina na prawdziwym arkuszu z `.output`: 5–6 stylów × jasny i ciemny, zrzuty i `getComputedStyle` (L14).
- Lighthouse `--compare` mobile i desktop4x, n = 5.
