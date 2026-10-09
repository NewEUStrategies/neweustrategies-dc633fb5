# P3.3 - kotwica w stronie trafia w cel na wolnym telefonie (IMPL)

- Gałąź `fix/w3-p33-anchor` od `4d1e2791` (czubek PR `claude/zen-ritchie-hzur21`), worktree
  `scratchpad/wt3/p33-anchor` (`node_modules` przez symlink). Commit **`470e2a52`** (bez pushu).
- Diagnoza i mechanizm: `REPRO.md` w tym katalogu (porażka CI `content-visibility.boot-home.spec.ts:262`,
  telefon, `top 1239,875`).
- Pliki: `src/components/builder/organisms/BuilderRenderer.tsx` (strażnik `CV_GUARD_SCRIPT` + komentarz
  bloku), `src/components/builder/organisms/__tests__/builderRenderer.contentVisibility.test.tsx`,
  `e2e/content-visibility.boot-home.spec.ts`. Nic więcej (zero JS-a w bundlu klienta, zero CSS).

## TL;DR

1. **Poprawka = opcja (a) z REPRO, zawężona i uszczelniona.** Inline'owy strażnik bloku cv (tylko HTML
   serwera) przy PIERWSZEJ nawigacji do fragmentu w tym samym dokumencie, której cel leży w obszarze cv
   (w opakowaniu `[data-cv]` albo za pierwszym z nich), ustawia istniejący wyłącznik `html[data-cv-off]`
   ZANIM przeglądarka policzy przewinięcie: `click` w fazie capture na oknie (link/`area` do `#id` tego
   dokumentu, bez modyfikatora i `target`), `popstate` (`location.hash`, pasek adresu, wstecz/dalej),
   `hashchange` (siatka). Cel przeglądarka liczy wtedy na prawdziwym układzie - zakotwiczenie przewijania
   przestaje mieć znaczenie, więc działa też w Safari (WebKit nie ma `overflow-anchor`).
2. **WebKit przewija PRZED `popstate`** (`FrameLoader::loadInSameDocument`: przewinięcie, potem
   `statePopped`). Strażnik czyta więc w `popstate` położenie celu jeszcze przy cv: cel już w widoku
   = przeglądarka przewinęła na pasach -> po wyłączeniu cv `scrollIntoView` celu w najbliższej klatce
   (`requestAnimationFrame`, przed jej malowaniem). Klatka, a nie synchronicznie w nasłuchu - bo
   TanStack w swoim `popstate` (po strażniku) zapisuje pozycję wpisu, z którego się wychodzi; wcześniejsze
   przewinięcie psuło powrót „wstecz” do miejsca czytania (wykryte e2e na wersji r1, niżej).
3. **Cele przed obszarem cv nic nie kosztują** (link „przejdź do treści” `#main-content`, kotwice autora -
   sekcja z `advanced.htmlId` nigdy nie ma cv i zamyka ogon, więc ich cele zawsze stoją przed nim).
4. **e2e deterministyczny pod wolnym CPU**: telefon z CDP `Emulation.setCPUThrottlingRate` x6 (desktop
   bez dławienia), tryby `location.hash` i prawdziwy klik w `<a href="#id">`, cel z CI (nagłówek)
   i cel na samej górze sekcji, pomiar geometrii w pominiętych sekcjach (warunek W2 z REPRO - tak robi
   snapshotter trace'u w CI), próbka położenia celu po KAŻDEJ klatce od nawigacji do spoczynku. Plus
   wstecz/dalej między fragmentami z powrotem do miejsca czytania i wejście z fragmentem.
   **Na `4d1e2791` spec pada w każdym przebiegu** (telefon, góra sekcji: `location.hash` 4/4 + 2/2,
   klik 3/4 + 1/2; cel ląduje dokładnie na `top 1239,6-1239,9` jak w CI), **na poprawce 105/105
   (`--repeat-each 5`)**.
5. **Koszt**: INP pierwszego kliku w kotwicę do obszaru cv wraca do poziomu sprzed P3.3 (ta sama strona
   z cv zdjętym przy wczytaniu); oszczędność P3.3 przy wczytaniu zostaje (styl+układ do kliku 512 vs
   854 ms przy x4). Waga dokumentu: +785 B inline skryptu (+419 B gzip HTML), domknięcie bootu 0 B.

## 1. Co było źle (skrót REPRO)

Nawigacja do fragmentu z cv włączonym liczy przewinięcie na pasach z szacunku (telefon: w4 632/839,
w5 532/1527 px). Gdy cel stoi blisko góry swojej sekcji (W1), sekcja nad nim wchodzi w obszar wyboru
kotwicy przewijania; gdy jej poddrzewo było już ułożone (W2 - ktoś czytał w nim geometrię, w CI
snapshotter trace'u Playwrighta), Chromium bierze kotwicę W tej pominiętej sekcji. Odsłonięcie sekcji
~200 ms później kompensuje tylko wzrost nad kotwicą (+207), a wzrost pod nią (+995) spycha cel w dół
(`244,9 + 995 = 1239,9`). Ratunkiem bywa wyłącznie `scrollIntoView` TanStacka po renderze, wyścigowo.
Safari zakotwiczenia nie ma wcale - tam każdy wzrost nad celem go przesuwa.

## 2. Poprawka

`CV_GUARD_SCRIPT` (ES5, jedno IIFE, bez zmiennych globalnych - stara wersja przeciekała `k` i `w` na
`window`), 1026 B zamiast 241 B. Pomocnicze:

- `f(fragment)` - element o tym `id` (najpierw dosłownie, potem po `decodeURIComponent`, jak algorytm
  „indicated part”) leżący w obszarze cv: `pierwszeOpakowanie.compareDocumentPosition(cel) & 4`
  (FOLLOWING obejmuje też potomków), inaczej `null`;
- `o(cel)` - ustawia `data-cv-off` raz i mówi, czy to zrobił;
- `g()` (`popstate`, `hashchange`) - `t` = `top` celu przy jeszcze włączonym cv, `o(cel)`, a gdy to `g`
  wyłączyło cv i `0 <= t < innerHeight` (przeglądarka już przewinęła - WebKit, albo cel był w widoku) -
  `requestAnimationFrame(() => cel.scrollIntoView())`;
- `click` capture na oknie: `a[href],area[href]`, bez Ctrl/Meta/Shift/Alt, `target` pusty albo `_self`,
  `href` bez fragmentu równy `location.href` bez fragmentu -> `o(f(a.hash))`. Okno jest przed
  dokumentem (korzeń Reacta), więc działa też dla linków routera (`AppLink` z `/#id`, `<Link hash>`),
  zanim ich handler zrobi `preventDefault`.
  Wejście w połowie strony (wpis przywracania TanStacka, fragment w adresie) - bez zmian semantyki.
  Raz wyłączone cv zostaje wyłączone do końca życia dokumentu (wstecz/dalej liczy już na prawdziwym
  układzie).

Kolejność zdarzeń w Chromium (zmierzona w REPRO i tu - log `diag/fix-d3.log`): klik (strażnik: cv off)
-> `popstate` (cv już off, `g` nic nie robi) -> przewinięcie przeglądarki na prawdziwym układzie
(`y 4942`, cel `243,6` od pierwszej klatki) -> `hashchange`. Dla `location.hash`: `popstate` (cel
poza widokiem -> tylko cv off) -> przewinięcie przeglądarki -> TanStack.

### Dlaczego (a), a nie inna opcja

- **(e) `overflow-anchor:none` na pominiętych opakowaniach** - tańsze (INP bez zmian), ale nic nie daje
  w Safari i opiera się na kolejności zadań Chromium (zdarzenie `contentvisibilityautostatechange`
  sekcji celu musi przyjść przed odsłonięciem sekcji nad nią - inaczej w obszarze wyboru nie ma żadnej
  kotwicy i wzrost +1202 idzie w całości na cel). Nie da się tego przypiąć testem jako kontraktu.
- **(c) odsłonięcie tylko sekcji wokół celu** - na tym fixture odsłania i tak 4-5 z 6 sekcji ogona
  (koszt jak (a), REPRO: 792 vs 776 ms), a pozostałe pasy nad celem w Safari dalej przesuwają treść.
- **(b) wyrównywanie co klatkę** - widoczny skok i walka z użytkownikiem, zależne od CPU.
- **(a) bez zawężenia** (każdy `#id`) - płaciłby za link „przejdź do treści” i kotwice autora, które
  nigdy nie leżą w obszarze cv.
  Własny pomiar nie dał lepszej opcji: koszt (a) to dokładnie poziom sprzed P3.3 (niżej), a (c) na
  fixture kosztuje tyle samo.

### Poprawki w trakcie (wersje buildu)

- **r0** (`build-r0.log`): `popstate` tylko wyłączał cv, `hashchange` przewijał ponownie, gdy cv wyłączył
  `popstate` tej nawigacji. Przy x6 `hashchange` przychodził ~900 ms po `popstate` (`diag/fix-d3.log`) -
  przewinięcie po takim czasie mogło cofnąć przewijanie użytkownika. Odrzucone.
- **r1** (`build-r1.log`): `popstate`, który wyłączał cv, od razu `scrollIntoView`. e2e 105/105, ale
  w Chromium to przewinięcie szło PRZED nasłuchem `popstate` TanStacka, który zapisuje pozycję wpisu,
  z którego się wychodzi - powrót „wstecz” trafiałby w cel zamiast w miejsce czytania (doszedł krok
  e2e, który to pilnuje). Odrzucone.
- **r2** (`build-r2.log`, ostateczna): odczyt położenia celu przy cv + przewinięcie w `requestAnimationFrame`
  tylko wtedy, gdy przeglądarka już przewinęła (WebKit). W Chromium strażnik w tej ścieżce nie przewija
  wcale. Źródło w commicie = źródło buildu r2 (bez zmian po buildzie).

## 3. Testy

### e2e `e2e/content-visibility.boot-home.spec.ts` (artefakt, fixture)

Nowe pomocniki: `throttleCpu` (CDP x6 na telefonie, od wczytania), `anchorTargets` (cel z CI = `id`
w najdalszej sekcji; `id` dopisany elementowi tej sekcji = cel na samej górze sekcji, jak nagłówek
z kotwicą na początku rich-textu; `id` drugiej sekcji z cv do wstecz/dalej), `measureSkippedSections`
(odczyt `scrollTop` każdego elementu w opakowaniach teraz i przy każdym `popstate` - jak snapshotter
trace'u w CI; wymusza ułożenie poddrzew bez renderowania = W2), `installTargetTracker` (położenie celu
po KAŻDEJ klatce od `popstate`, odczyt po klatce: rAF -> `setTimeout 0`; pierwszy `onRendered` routera),
`settleAfterNavigation` (czeka na render routera - jego `scrollIntoView` przychodzi pod x6 po kilku
sekundach - potem na stabilny `scrollY`), `expectStaysOnTarget` (cel pod nagłówkiem w każdej klatce:
dla nawigacji do fragmentu od pierwszej klatki, dla wstecz/dalej od pierwszej klatki na miejscu).

Scenariusz 3 (dawny jeden test) to teraz na każdy viewport:

- 4 testy `kotwica po wczytaniu ({location.hash | klik w link #id}, {nagłówek w dalszej sekcji | góra
dalszej sekcji}, CPU x6/x1)` - każdy na świeżej stronie z cv włączonym; dla `location.hash` + nagłówek
  dalej przewinięcie kółkiem w górę o 300 px przesuwa cel dokładnie o 300 px;
- `wstecz/dalej między fragmentami`: przewinięcie o 400 px, `location.hash` -> wcześniejsza sekcja, klik
  -> dalsza, wstecz, dalej (każdy cel pod nagłówkiem), `history.go(-2)` -> router wraca dokładnie do
  miejsca czytania (±2 px);
- `wejście z fragmentem w adresie` (strażnik przy parsowaniu: `cvOff`, `visible`, cel pod nagłówkiem).
  Asercje o stanie wewnętrznym (`cvOff === false` po nawigacji w stronie) usunięte - kontraktem jest
  lądowanie; `cvOff`/`visible` zostają tylko dla wejścia z fragmentem (to JEST kontrakt strażnika).
  `<Link hash>`: na stronach publicznych tylko między trasami (`MyEventsPanel` -> `/events/$slug#tickets`,
  `ClubAccessGate` -> `/pricing#plans`) - nawigacja SPA renderuje stronę po stronie klienta, bez cv;
  na tej samej stronie router z `defaultHashScrollIntoView: false` w ogóle nie przewija (REPRO: `router`
  0/32 także bez cv) - poza zakresem, a klik w taki link i tak wyłącza cv (vitest).

| przebieg                                                            | build                                        | wynik                                                                                                                                                   |
| ------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-g kotwica --repeat-each 4` (`e2e-base-r4.log`)                    | `4d1e2791` (`base-w3f`, `NES_ARTIFACT_ROOT`) | **7 failed** / 48: telefon, góra sekcji - `location.hash` 4/4, klik 3/4 (np. „cel poza miejscem pod nagłówkiem w 84 z 176 klatek”, próbki `top 1239,6`) |
| pełny spec `--repeat-each 2` (`e2e-base-r5.log`, wersja ostateczna) | `4d1e2791`                                   | **3 failed** / 42: `location.hash` + góra sekcji 2/2, klik + góra sekcji 1/2                                                                            |
| pełny spec `--repeat-each 5` (`e2e-cv-repeat5-r2.log`)              | poprawka r2                                  | **105/105**, 11,1 min                                                                                                                                   |
| pełny spec `--repeat-each 5` (r0 / r1)                              | r0 / r1                                      | 105/105 / 105/105                                                                                                                                       |

Na bazie cel z CI (nagłówek H3) lokalnie przechodzi - jego `scroll-margin` przycina wewnętrzny
`overflow:hidden` (REPRO §3.4), więc W1 lokalnie nie zachodzi; cel na górze sekcji ma W1 zawsze.
Porażka kliku na bazie nie jest 100%: w części przebiegów strona przed skokiem jest w innym stanie
(klik = pierwsza interakcja; `y` w chwili skoku 2445 zamiast 3739, `diag/base-d1.log`) i kotwica
wypada w sekcji celu - wtedy Chromium kompensuje całość. Spec jako całość pada w każdym przebiegu.
Czas: +10 testów (21 zamiast 11), ~2,2 min na przebieg specu (było ~1 min).

### vitest `builderRenderer.contentVisibility.test.tsx` (strażnik wykonany jak przy parsowaniu)

`uruchomStraznika` wykonuje skrypt z HTML-u serwera z podstawionym `addEventListener` (nasłuchy
zdejmowane po teście). Nowy blok „strażnik: nawigacja do fragmentu po wczytaniu” (14 przypadków):
klik w `#id` w ogonie wyłącza cv, zanim klik dotrze do linku; stopka (za obszarem) i `/#id` (link
routera) też; `id` z kodowaniem procentowym; cv zostaje dla: celu nad ogonem, fragmentu bez elementu,
`#`, innego dokumentu, modyfikatora, `target=_blank`; `popstate` przed przewinięciem (cel daleko) - cv
off, zero przewinięć; `popstate` po przewinięciu (cel w widoku) - przewinięcie dopiero w klatce, a w
nasłuchu routera za strażnikiem jeszcze nic nie jest przewinięte; `hashchange` przy włączonym cv; cv
wyłączone wcześniej - nic; dokument bez opakowań (render kliencki) - nic. Na starym strażniku pada
6 z nowych przypadków (sprawdzone podmianą stałej), negatywne przechodzą.

## 4. Pomiary

### INP kliku w link `#id` (telefon 412x823, mediana z 5, `cost/` - kopia `repro/anchor-cost.spec.ts`)

Klik z góry strony po 2,5 s spoczynku w nagłówek formularza; „sprzed P3.3” = ta sama strona otwarta
z `/#__ax_none` (strażnik zdejmuje cv przy parsowaniu). Pomiary w parach (ten sam build i sesja), bo
maszyna jest współdzielona i bezwzględny poziom pływa między seriami o ±150 ms.

| seria   | build      |             x4: cv / sprzed P3.3 |                                   x6: cv / sprzed P3.3 |
| ------- | ---------- | -------------------------------: | -----------------------------------------------------: |
| `base`  | `4d1e2791` |    544 (520-592) / 864 (816-888) |                       840 (656-936) / 1288 (1048-1440) |
| `base2` | `4d1e2791` |                                - |                                    1036 (864-1200) / - |
| `fix`   | r0         |   896 (832-928) / 872 (792-1080) |                    1600 (1136-1744) / 1496 (1200-1544) |
| `fix2`  | r1         | 1016 (760-1088) / 848 (808-1032) |                    1512 (1280-2296) / 1208 (1024-1264) |
| `fix3`  | r2         |   944 (896-1136) / 936 (808-984) | 1304 (n=1, seria przerwana - niżej) / 1416 (1312-1656) |
| `fix4`  | r2         |                                - |                    1168 (1096-1368) / 1176 (1128-1472) |

Ścieżka kliku jest identyczna w r0, r1 i r2 (cv wyłącza nasłuch `click`, `popstate` już nic nie robi).
Wniosek: INP pierwszego kliku w kotwicę do obszaru cv = poziom sprzed P3.3 (różnica w parach: x4 +8,
+24, +168 ms; x6 -8, +104, +304 ms - w szumie), czyli +350-470 ms wobec `4d1e2791`, które było tanie tylko dlatego, że przewijało na pasach
(i trafiało źle). Czysty koszt odsłonięcia (REPRO, bez routera): styl+układ 78 ms x4 / 182 ms x6.
Większość INP kliku to obsługa zmiany `#` przez TanStacka (pełne `router.load` + render, view
transition) - także bez cv (pozycja poza P3.3). Każdy kolejny klik w kotwicę i link „przejdź do
treści” kosztują tyle co dziś.

Koszt wczytania (trace do kliku, styl+układ, mediany): poprawka 512 ms (x4) / 813 ms (x6) vs sprzed
P3.3 854 / 1340 ms - oszczędność P3.3 przy wczytaniu zostaje w całości.

Uwaga z pomiaru: w 1 z ~70 przebiegów kosztu przy x6 (`fix3`, cv x6 #1) nagłówek celu stracił `id`
(id z `useId` - wyspa sekcji wyrenderowała się po stronie klienta po kliku); kopia specu kosztu
odnotowuje to teraz jako `LOST` zamiast przerywać serię. W e2e (ponad 200 przebiegów testów kotwicy na
poprawce) się nie zdarzyło; w serii `fix4` (r2, x6) też nie. Zjawisko dotyczy identyfikatorów generowanych (nikt nie linkuje do `_R_…-heading`),
niezależne od strażnika - do obserwacji przy wyspach, nie blokuje.

### Waga dokumentu `/` (`check-document-weight.ts`, fixture, 5 próbek; baza zmierzona tym samym skryptem na `base-w3f`)

| metryka                       | `4d1e2791` | poprawka r2 |    Δ | próg `max` |  zapas |
| ----------------------------- | ---------: | ----------: | ---: | ---------: | -----: |
| `htmlRawBytes`                |    328 452 |     329 237 | +785 |    406 180 | 76 943 |
| `htmlGzipBytes`               |     49 840 |      50 259 | +419 |     57 710 |  7 451 |
| `inlineScriptBytes`           |     87 551 |      88 336 | +785 |     98 103 |  9 767 |
| `inlineExecutableScriptBytes` |     80 304 |      81 089 | +785 |     91 725 | 10 636 |
| `inlineCssCommentBytes`       |        517 |         517 |    0 |        517 |      0 |
| `bootClosureRawBytes`         |  1 632 978 |   1 632 978 |    0 |  1 637 758 |  4 780 |
| `bootClosureGzipBytes`        |    495 154 |     495 154 |    0 |    496 679 |  1 525 |
| `bootBurstGzipBytes`          |    572 380 |     572 380 |    0 |    574 673 |  2 293 |
| `preLcpTransferBytes`         |    175 015 |     175 434 | +419 |    181 594 |  6 160 |

Progi bez zmian. Strażnik tylko w bundlu serwera (`.output/server/_ssr/router-*.mjs`); żaden plik
`.output/public/assets` nie zawiera `data-cv-off`. Parzystość SSR/hydratacji bez zmian (klient
renderuje blok cv z pustym `__html`; testy hydratacji w pliku vitest bez rozjazdu).

## 5. Bramki (worktree `wt3/p33-anchor`)

| bramka                                                           | wynik                                                                                         | log                                                                                    |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `prettier --write/--check` (3 pliki)                             | OK                                                                                            | -                                                                                      |
| `light.sh bunx eslint` (3 pliki)                                 | OK, 0 uwag                                                                                    | -                                                                                      |
| typecheck (`typecheck-noinc.sh`: tsgo + tsc skryptów + tsgo e2e) | OK (exit 0)                                                                                   | `typecheck-r0.log` (r0: exit 0), `typecheck-r1.log`                                    |
| `vitest run src/components/builder/organisms`                    | OK: 82 pliki, 1158 passed + 4 expected fail (w tym `builderRenderer.contentVisibility` 54/54) | `vitest-r1.log` (r0: 82 pliki, 1158 + 4 expected fail)                                 |
| `verify:static`                                                  | OK - 15/15 bramek (263,8 s)                                                                   | `verify-static-r1.log` (r0: 15/15 OK; `check:dangerous-html` 79 sinków, 8 literalnych) |
| `BUNDLE_INVENTORY=1 build:smoke`                                 | OK (r0, r1, r2; 2 min 7 s)                                                                    | `build-r0.log`, `build-r1.log`, `build-r2.log`                                         |
| `check-document-weight.ts`                                       | OK, wszystkie metryki w progach                                                               | `docweight-r2.log`, `document-weight-r2.json`                                          |
| content-visibility `--repeat-each 5` (env jak w CI)              | **105/105**                                                                                   | `e2e-cv-repeat5-r2.log`                                                                |
| ten sam spec na `4d1e2791`                                       | **pada** (3/42 i 7/48)                                                                        | `e2e-base-r5.log`, `e2e-base-r4.log`                                                   |

## 6. Poza zakresem (osobne pozycje)

- Zmiana samego `#` w tym samym dokumencie uruchamia w TanStacku pełne `router.load` + render (+ view
  transition): największy składnik INP kliku w kotwicę, także bez cv. Jego `scrollIntoView` po renderze
  przychodzi pod x6 po 2-6 s (`renderedAfter` w e2e) i przestawia cel o różnicę kurczenia nagłówka
  (41 px) - albo cofa przewijanie, które użytkownik zdążył zacząć. Dotyczy też stron bez cv.
- `defaultHashScrollIntoView: false`: `<Link hash>`/`AppLink` z `/#id` na tej samej stronie w ogóle nie
  przewija (REPRO §1, `router` 0/32).
- Safari (brak WebKita w piaskownicy) - ścieżka `popstate` po przewinięciu sprawdzona testem
  jednostkowym i kodem źródłowym WebKitu, nie na urządzeniu. Szacunki `contain-intrinsic-size` na
  telefonie dalej 1,3-3x za niskie (opcja (d) z REPRO) - przy przewijaniu w górę w Safari pasy nad
  widokiem nadal mogą przesuwać treść (to nie nawigacja do fragmentu).
- Snapshotter trace'u Playwrighta wymusza układ pominiętych poddrzew przy każdej akcji - CI mierzy
  geometrię cv inaczej niż przeglądarka użytkownika (dlatego spec sam modeluje W2).

## 7. Artefakty

`e2e-*.log` (bazowe i poprawki), `test-results-*` (trace porażek bazy), `diag/` (spec diagnostyczny
z osią położenia celu i logiem zdarzeń, `base-d1.log`, `fix-d1..3.log`, `heights-fix.log`), `cost/`
(spec i wyniki INP, `out/*.jsonl`), `document-weight*.json`, `guard-expr.js` (kontrola składni
strażnika). Serwery uruchamiane przez Playwrighta zgasły razem z runnerem; `base-w3f` nietknięty
(`find -newer` pusty, `git status` czysty).
