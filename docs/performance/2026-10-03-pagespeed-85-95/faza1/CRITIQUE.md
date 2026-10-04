# Krytyka kompletności planu fazy 1C (PSI mobile ≥ 85, desktop ≥ 95)

Data: 2026-10-04. Krytyk kompletności (Opus, maksymalny rygor). Przeczytane: `docs/performance/2026-10-03-pagespeed-85-95/EVIDENCE.md`, `$SCRATCH/phase1/PLAN.md` (+ `PLAN.json`, `plan_build/*`), `ORCHESTRATOR-NOTES.md`, 10 raportów strumieni (`$SCRATCH/phase1/*.md`) i 33 werdykty (`$SCRATCH/phase1/verdicts/*.md`). Arytmetykę przeliczyłem modelem analityka (`$SCRATCH/phase1/lighthouse-analyst/score.py`, odtwarza 14/14 raportów); skrypt: `$SCRATCH/phase1/critique_calc.py`. Kod repo sprawdzałem tylko do odczytu (ścieżki z numerami linii niżej).

`$SCRATCH` = `/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad`.

## 0. Werdykt

**Plan jest dobrze zbudowany warsztatowo** (macierz własności, inwarianty Lantern, bramki fal, uczciwy opis niepewności desktopu), **ale arytmetyka wyniku się nie domyka**:

1. **Mobile 85 opiera się na liczbie, której nie popiera żaden werdykt.** Księga TBT księguje sprzężenie C3↔TBT jako **+200 ms** (+130…+400) na PSI. Werdykty `boot-js:C3` i `lcp-path:LP-3` mówią wprost, że po C3 TBT PSI rośnie z 600 do **1 100–1 300 ms** (czyli +500…+700), a raport boot-js §1.4 mierzy na fixture +530…+770 ms. Sam plan w §0 cytuje „C3 bez programu TBT daje tylko 68-70", a 68-70 odpowiada właśnie TBT 1 100–1 300 ms, nie +200 (przy +200 wyszłoby 73). Z korektą sprzężenia do +500…+600 centralna projekcja spada z **88 → 78-79 po W2** i z **90 → ~81 po W3**. Mobile 85 wymaga TBT ≤ 300–340 ms przy metrykach W2 (FCP 1,8 / LCP 2,85 / SI 3,7), więc przy planowanych cięciach W2 sprzężenie musiałoby wynieść ≤ ~+350 ms.
2. **Desktop 95 nie domyka się nawet w scenariuszu centralnym planu** (89 po W3, ~94 z W5 — plan to przyznaje). Jeśli stosować własną regułę planu „pozycje niezweryfikowane ×0,5" konsekwentnie, wychodzi **~84**. Desktop 95 wymaga TBT PSI ≤ 150 ms przy SI 1,3 s (≤ 135 ms przy SI 1,5 s). Plan dochodzi do ~250 ms. Jedyną dźwignią na brakujące ~100 ms jest warunkowa, niezweryfikowana i najmniej konkretna fala W5. Do tego kubeł „other" (≈101 ms latentnie przy ×4) nie ma właściciela.
3. Do tego dochodzą trzy błędy mechanizmu: P3.2 jest wewnętrznie sprzeczny (drabina srcset bez 640w zabiera efekt LP-7), a projekt `deviceStore` w P1.6 i P2.2 ma ryzyko CLS, bo korekta urządzenia leci przez SyncLane. Są też ukryte konflikty plików w W1 i W2 oraz bramki, których nie da się zaliczyć: SI na fixture jest równe FCP, więc kryterium SI w bramce W1 jest nieosiągalne.

`score_arithmetic_closes = false`. Plan wymaga poprawek przed falą 1: przeliczenia księgi, pomiaru sprzężenia **przed** W2, przesunięcia pakietu parsowania dokumentu na ścieżkę wyniku, konkretnej dźwigni desktop i pozyskania JSON-ów PSI.

## 1. Arytmetyka przeliczona (score.py, krzywe LH 13, CLS 0)

### 1.1 Odtworzenie trajektorii planu (zgodne)

| scenariusz              | FCP / LCP / TBT / SI    | wynik         |
| ----------------------- | ----------------------- | ------------- |
| dziś mobile             | 3,1 / 6,6 / 600 / 4,9   | 53,1 → **53** |
| plan W1 mobile          | 3,1 / 6,6 / 230 / 4,2   | 65,1 → 65     |
| plan W2 mobile (centr.) | 1,8 / 2,85 / 260 / 3,7  | 87,9 → **88** |
| plan W3 mobile (centr.) | 1,8 / 2,7 / 220 / 3,7   | 89,9 → **90** |
| dziś desktop            | 0,6 / 1,1 / 740 / 1,5   | 69,8 → **70** |
| plan W2 desktop         | 0,45 / 0,85 / 300 / 1,3 | 85,9 → 86     |
| plan W3 desktop         | 0,45 / 0,81 / 250 / 1,3 | 89,2 → **89** |
| plan W5 desktop         | 0,45 / 0,81 / 170 / 1,3 | 94,3 → **94** |

Liczby planu są policzone poprawnie **z jego założeń**. Problem leży w założeniach.

### 1.2 Wrażliwość na założenia, których plan nie uzasadnia

| scenariusz (mobile, W2: FCP 1,8 / LCP 2,85 / SI 3,7)         | TBT PSI | wynik                |
| ------------------------------------------------------------ | ------- | -------------------- |
| sprzężenie jak w planie (+200), cięcia W2 jak w planie       | 210–260 | 88–89                |
| sprzężenie z górnej granicy planu (+400)                     | 410     | **83**               |
| sprzężenie zgodne z werdyktami C3/LP-3 (+500)                | 565     | **79**               |
| sprzężenie +600                                              | 610     | **78**               |
| tylko pozycje zweryfikowane (W2 cięcia = 0), sprzężenie +200 | 430     | 82,5                 |
| tylko zweryfikowane, sprzężenie +500                         | 730     | **75**               |
| W3 z sprzężeniem +500 (reguła ×0,5 konsekwentnie)            | 505     | **81**               |
| W3 centr., ale przebieg PSI na MISS (SI ≈ 5,5 s)             | 220     | 86,9                 |
| maks. TBT dla 85,0 przy W2 / przy F1,9-L3,0-SI4,2            | —       | **≤ 340 / ≤ 280 ms** |

| scenariusz (desktop)                                               | TBT           | SI        | wynik       |
| ------------------------------------------------------------------ | ------------- | --------- | ----------- |
| reguła ×0,5 konsekwentnie (P1.3 −20, P2.2 −57, P2.3 −17, P2.4 −22) | 332           | 1,3       | **84,4**    |
| cel 95 przy SI 1,3 / 1,5                                           | ≤ 150 / ≤ 135 | —         | 95,2 / 95,0 |
| DoD desktop4x ≤ 110 ms, jeśli host PSI ≈ ×4                        | 110           | 1,3       | 97,0        |
| to samo, gdy host PSI ≈ ×5 (werdykt LA-C1: ×4→×5 ≈ ×2 TBT)         | ~200–220      | 1,3       | **91–92**   |
| TBT 110, ale przebieg na MISS (SI 2,0–2,3)                         | 110           | 2,0 / 2,3 | 94,5 / 93,0 |

Wnioski: (a) mobile 85 jest osiągalne **tylko**, jeśli sprzężenie wyjdzie ≤ ~+350 ms albo jeśli zostanie spłacone pozycjami, które w planie są „higieną nieliczoną" (§2, B1). (b) Bramka W2 „fixture TBT ≤ 250 ms" po przełożeniu planu (PSI ≈ fixture × 1,0–1,3 + 25 % DOM) to PSI 310–400 ms, czyli **83–86**: bramka nie gwarantuje celu. (c) Desktop 95 przy DoD „desktop4x ≤ 110" ma zapas tylko wtedy, gdy host PSI desktop zachowuje się jak ×4. Werdykt LA-C1 przypomina, że model analityka stawia go bliżej ×5, a przy ×5 ten sam kod daje ~92. (d) Pojedynczy przebieg na MISS zjada 3,4 pkt mobile i 4,8 pkt desktop, a §8.2 planu ocenia wyłącznie przebiegi HIT.

## 2. Luki BLOKUJĄCE

### B1. Sprzężenie C3↔TBT jest zaniżone, a jego jedyne lekarstwo zdjęto ze ścieżki wyniku

- **Dowód:** `verdicts/boot-js--C3.md` (tabela „PSI projection": „C3 corrected, TBT with coupling 1100-1300 → 68-70"), `verdicts/lcp-path--LP-3.md` („takes TBT from 600 to 1100-1300 ms"), `boot-js.md` §1.4 (fixture: przy FCP 1,4 s TBT 813–1 441 ms wobec 199–616, „+530…+770"). Plan §1.2 (wiersz 3) i §1.5 księgują „PSI +130…+400 (szacunek)". Jedyna podstawa to „prod: 98/51/96/89 ms sym. → do +134 ms", a te zadania zmierzono na **M3 Pro**, nie na hoście PSI (M3 mobile TBT 200 vs PSI 600).
- **Co spłaca sprzężenie:** wchodzą do okna zadania parsowania dokumentu (569 KB HTML, 133 KB inline `<style>`, 107 KB `$tsr`). Jedyny zmierzony lek to pakiet dokumentu (`html-weight.md` §0/§7: no-JS na HTML produkcyjnym TBT mobile 138–192 → 0–80 ms, mediana −130 ms; „that is when −130 ms TBT counts, roughly +3–5 mobile points"). W planie: P4.2/P4.3 to W4 „nie liczona", a HW-2 (inline style → szablon) jest odroczony. Pozycje W2 (P2.2–P2.4) tną zadania hydratacji, które **już są** w oknie, więc nie dotykają nowo wciągniętych zadań parsowania. Wcześniejszy szkic planisty (`plan_build/items_w2_w7.py:46`) miał falę „Lekarstwo na sprzężenie C3 … warunkowo MUST" i ta fala zniknęła z planu końcowego bez uzasadnienia.
- **Naprawa:** (1) przeliczyć księgę ze sprzężeniem **+500 (+350…+700)** mobile; (2) **zmierzyć sprzężenie przed W2**: transformacja `verdicts/boot-js-C3/c3-lcpobs.mjs` przez `--html-transform-b` na drzewie W1 z flagami P0.1 (`--client-backend fixture --third-party fake-gtag`, ≥5 przebiegów, `lanternTasks`). To nie wymaga builda i daje prognozę bramki W2 przed zainwestowaniem w P2.1; (3) dodać do W2/W3 liczoną pozycję „lek na sprzężenie": P4.2 (dieta `$tsr`) + P4.3 (HW-6) + HW-2 w wariancie z werdyktu (tylko `ChromeWidgetView`, zmienne kluczowane `data-device`) z bramką `lanternTasks`: brak zadania ParseHTML/EvaluateScript (inline) ≥ 50 ms sym. w [FCP, TTI]; (4) zastrzeżenie orkiestratora „dokument i CSS to higiena" dotyczyło reżimu sprzed C3. Ten punkt trzeba odnotować jako świadomą zmianę, a nie cichą dewiację.

### B2. Desktop 95: arytmetyka się nie domyka, a brakujące ~100 ms nie ma właściciela

- **Dowód:** §5 planu (centralnie 89 po W3, ~94 z W5; P(≥95) 30–45 %). Przy konsekwentnym ×0,5 wychodzi 84. Analityk §4b (desktop ×4, latentnie 501 ms): hydratacja 268, zgody/radix/sonner 111, **other 101** (commit/raster, timery, GC). Kubełek „other" nie ma żadnej pozycji, a to 2/3 budżetu ≤ 150. Werdykt LA-C1: „≤110 on the proxy is reached only if non-React tasks are capped as well"; „Production adds about 300 ms that LA-C1 does not touch".
- **W5** (jedyna rezerwa) jest warunkowa (D11), ma pozycje XL i wysokiego ryzyka, bez werdyktu i z mechanizmem na poziomie hasła („SimpleWidgets per typ", „opcja (b) fabryki"). Tymczasem projekcja planu mówi, że W5 będzie potrzebna prawie na pewno.
- **Naprawa:** albo właściciel jawnie przyjmuje desktop 95 jako stretch (zapis w §7 jako D12, z kryterium akceptacji „desktop ≥ 90"), albo plan dostaje konkretne liczone dźwignie przed W5: (a) poprawki P1.5 (commit 95,6 ms z Layout i root pass 34 ms, razem ~141 + 87 ms latentnie wg werdyktu LA-C1) przeniesione **przed** wyspy, a nie do W3; (b) wyspa ukrytego nagłówka desktop/mobile (B-M10b niżej); (c) właściciel kubła „other" (atrybucja `lanternTasks` po W1, potem cięcie); (d) bramka desktop5x obok desktop4x. Bez tego desktop 95 jest celem bez planu.

## 3. Luki ISTOTNE

### M1. Księga TBT sumuje liniowo, łamie własną regułę ×0,5 i liczy te same zadania dwa razy

- Reguła §1.5 „pozycje niezweryfikowane ×0,5" nie jest stosowana: P2.2 −150…−250 → połowa środka = −100, plan bierze −120; P2.3 −30…−80 → −27, plan −40; P2.4 −60…−120 → −45, plan −60; P1.3 −50…−120 → −42, plan −50 (desktop analogicznie). Σ zawyżenia ≈ 55 ms mobile i ≈ 95 ms desktop.
- Podwójne liczenie: „rozbicie commita hydratacji 95,6 ms" przypisane jest i P2.2 („commit … rozbity na mniejsze"), i P3.1 („przebieg hydratacji dzielony"). Przepisywanie identycznych `<style>` jest i w P1.2, i w P2.4 (b′). Obcięcie „na nakładanie się" (W1: −50, W2: ~+50) nie ma podanej metody. TBT jest progowe (Σ max(0, d−50)), więc dwie pozycje skracające to samo zadanie nie sumują się.
- **Naprawa:** księga per zadanie, nie per pozycja: tabela `lanternTasks` z bazy W0 (zadanie → właściciel → oczekiwany czas sym. po zmianie), a TBT liczony przez `whatif.py` na zapisanych artefaktach z kombinacją zmian (deterministycznie, bez szumu). To samo narzędzie, którym analityk pokazał nieaddytywność LCP (1,8 s sumy vs 1,43 s łącznie).

### M2. Bramki fal, których nie da się zaliczyć albo które nie gwarantują celu

- **SI na fixture = FCP** (`lighthouse-local-baseline.json`: si 4063,154 = fcp 4063,154; analityk §5.4: „SI is therefore unmeasurable on the fixture"). Bramka W1 „SI mobile ≤ baza − 0,1 s" i weryfikacja P1.3 „SI mobile −0,1…−0,2 s" są przed C3 nieosiągalne konstrukcyjnie: SI_sim = max(FCP, …), a FCP się nie rusza. Naprawa: mierzyć `observedSpeedIndex` / histogram filmstripu (narzędzie `lcp-path/si/thumbs.cjs`) albo Lantern SI na drzewie W1 + transformacja C3.
- **CLS „0,000 we wszystkich przebiegach"**: baseline ma max CLS 0,00042. Bramka ścisła oblewa się na szumie. Lepiej: ≤ 0,001 i brak pojedynczego przesunięcia > 0,0005 z atrybucją elementu.
- **W2 „fixture TBT ≤ 250"** daje po przełożeniu PSI 310–400 ms → 83–86 (§1.2). Wdrożenie przy zielonej bramce może dać < 85. Bramka W2 powinna być ≤ 200 (jak DoD) albo wyrażona w projekcji `score.py` ≥ 87 po przełożeniu.

### M3. Weryfikacja TBT bez mocy statystycznej, a znane źródło szumu nie zostało usunięte

- Pozycje mają „ΔTBT < 0 w każdej parze" (P1.1, P1.2, P2.2, P3.1, P5.1) przy szumie A/A do ±464 ms i efektach rzędu −20…−60 ms (P2.3, P2.4, P1.3). To przepis na odrzucanie dobrych zmian albo na powtarzanie pomiaru do skutku.
- Werdykt **M1 #1**: dokument w cache przechodzi w STALE w trakcie serii (świeżość 3 min), rewalidator renderuje SSR **w tym samym procesie Node, który serwuje assety**, w trakcie przebiegów LH; naprawa „fetchDocument z wybranym UA przed każdym `runLighthouseWithRetry`" **nie trafiła do P0.1**. To prawdopodobnie część „szumu" ±464 ms.
- **Naprawa:** do P0.1 dodać ponowne rozgrzanie przed każdym przebiegiem i log `x-nes-cache` per przebieg (odrzucać przebiegi STALE); roszczenia TBT oceniać przede wszystkim deterministycznie (`whatif.py` na zapisanych artefaktach, zadanie zniknęło/skróciło się); A/B z LH jako potwierdzenie kierunku z podanym n i minimalnym wykrywalnym efektem z A/A.

### M4. Ukryte konflikty i nieprzypisane pliki w falach (punkt 3 zlecenia)

`plan_build/check.py` sprawdza tylko zadeklarowane listy. Mechanizmy wymagają jednak plików spoza nich:

- **W1, `scripts/taxonomy/features.mjs`:** nowe `src/lib/builder/lcpCandidate.ts` (P1.4) oraz `hydrationIsland.tsx` i `deviceStore.ts` (P1.6) trafiają do modułu 3 z taksonomią i nie mają funkcjonalności. Sprawdziłem `classifyPath`/`featureForPath`: `feature=null`, czyli sieroty. `check:feature-taxonomy` biegnie w CI (`.github/workflows/ci.yml:257`). Obie pozycje muszą edytować ten sam plik, a nie ma go w G-std ani w macierzy.
- **W1, `scripts/lib/dangerousHtmlAllowlist.ts` (właściciel P1.3):** P1.2 definiuje `StyleSink` jako `dangerouslySetInnerHTML={{ __html: css }}`, gdzie `css` jest propsem. Bramka `check:dangerous-html` akceptuje dla `<style>` wyłącznie `hardenStyleCss` z dowodem **w tym samym pliku** (`src/lib/ci/dangerousHtml.ts:18`, wzór `DesignTokensStyle.tsx:65-68`). Albo `hardenStyleCss(css)` wewnątrz `StyleSink` (werdykt H2 tak to zapisał), albo wpis allowlisty w pliku P1.3.
- **W1, `src/routes/__root.tsx` i `rootRoute.test.tsx` (właściciel P1.3):** P1.2 (2) zmienia kształt `designTokensQueryOptions` (dokłada `fontScale`), a seed `EMPTY_TOKENS` siedzi w `__root.tsx:676-677`, mock w `rootRoute.test.tsx:136`. Nieprzypisane testy: `src/lib/builder/__tests__/designTokens.test.tsx`, `src/hooks/__tests__/useFontScale.test.tsx`, `src/components/theme/__tests__/deferredStyleCss.test.tsx`, `src/lib/builder/__tests__/localizedQueryKeys.gate.test.ts`. Werdykt H2 zaleca tę część **porzucić** (0 pkt; sam memo-liść usuwa przepisanie), co rozwiązuje konflikt.
- **W2, `src/lib/builder/hydrationIsland.tsx` (właściciel P2.2):** P2.3 potrzebuje wyzwalaczy `pointerover`, `touchstart`, globalnego `keydown('/')` i konfiguracji **bez** IO. API z P1.6 ma IO na `[data-sec-id]`, onFirstInteraction, `pointerdown/focusin/keydown` na korzeniu i whenQuiescent. Widget nagłówka jest w viewporcie, więc IO by go od razu uwodnił. P2.3 musi edytować plik P2.2 albo P1.6 musi od razu dostarczyć pełne API wyzwalaczy. Może też dojść `ChromeWidgetView.tsx` (P2.4), jeśli opakowanie w wyspę robi dyspozytor.
- **W3→W5:** P3.1 „poprawki wymagające plików spoza listy (np. `__root.tsx`) przechodzą do W5". W5 nie ma takiej pozycji, jest warunkowa, a `__root.tsx` w W5 ma już P5.1.
- **Naprawa:** rozszerzyć `check.py` o skan ścieżek w polach `mechanism`/`gates` i o pliki „kolateralne" bramek (taksonomia, allowlista, testy kształtu zapytań); rozstrzygnąć te 5 przypadków w macierzy.

### M5. `deviceStore` przez `useSyncExternalStore` wnosi ryzyko CLS i nieliczony TBT (P1.6/P2.2)

- Wyspa hydratuje z `getServerSnapshot()==='desktop'`, a potem „zaraz re-renderuje się z klasą urządzenia klienta". W React 19 niezgodność snapshotu po hydratacji wymusza **synchroniczny** re-render (SyncLane, `forceStoreRerender`), bez dzielenia na kawałki.
- P2.2 celowo ładuje chunki leniwych widgetów wysp **dopiero po otwarciu bramki**. Synchroniczna aktualizacja propsów dochodzi więc do zagnieżdżonych, jeszcze odwodnionych granic `lazy` bez chunku. To klasa „received an update before it finished hydrating → client render" (`lazyWidgets.tsx:19-23`), którą boot-js zmierzył jako CLS 0,421 (`boot-js.md` §1.3). Werdykt H6 #4 zauważa, że dzisiejsze przełączenie jest _transition_, czyli bezpieczne dla odwodnionych granic. Projekt planu zamienia je na wariant niebezpieczny.
- Koszt tej korekty (commit z 25 podmianami `<style>`, ~90 ms sym. przy ×4 per renderer wg H6) nie jest wliczony do efektu P2.2.
- **Naprawa:** korekta urządzenia w wyspie przez lustro `useState` + `startTransition` w subskrypcji (nie uSES) albo otwarcie bramki dopiero po `Promise.all` preloadów zagnieżdżonych chunków; test w `hydrationIsland.test.tsx` z zagnieżdżonym `lazy` bez chunku i mobilnym snapshotem (kontrola negatywna: wariant uSES → client-render).

### M6. P3.2 jest wewnętrznie sprzeczny: drabina HW-4 usuwa 640w, na którym stoi LP-7

- P3.2 zmienia `RESPONSIVE_WIDTHS` (dziś `[320, 480, 640, 768, 1024, 1280, 1536, 1920, 2400]`, `src/lib/cropSizes.ts:209`) na `[480, 768, 1280, 1920]`, a równocześnie liczy zysk z wyboru **640w** (25,1 KB zamiast 37,9 KB).
- What-ify lcp-path (`lcp-path.md` §3.2): po C3 sam hero −34 % (T1) daje **0 ms**, sam font (T3) daje **0 ms**, tylko razem (E6) −150 ms, bo LCP_sim to maksimum końców równoległych żądań. Bez 640w efekt P3.2 spada do ~0 i bramka W3 „ΔLCP ≤ −0,1 s" oblewa.
- 640w jest wybierane tylko przy gutterze ~32 px (412 − 64 = 348 px × 1,75 = 609 px). Przy 16 px potrzeba 665 px, więc i tak 768w.
- **Naprawa:** drabina hero z 640 (np. `[480, 640, 768, 1280, 1920]`), test wyboru kandydata dla 412×823 @1,75 i 1350×940 @1 na rzeczywistych paddingach sekcji fixture i produkcji.

### M7. Powłoka zgód (P1.3) a wyzwalacz bootu (P2.1): możliwa zmiana elementu LCP

- `__root.tsx:214-221`: akapit banera „bywał elementem LCP w laboratorium, bo wskakiwał jako duży blok tekstu w nakładce `position: fixed`" (F30). Po P1.3 powłoka maluje się **z FCP** przy każdej pierwszej wizycie, a PSI zawsze jest pierwszą wizytą. Jeśli jej blok tekstu jest większy niż hero (fixture: 68 121 px² mobile), LCP przestaje być `img[data-lcp-candidate]`. Wyzwalacz P2.1 przyjmuje wyłącznie wpis kandydata, więc boot spada na zapas `load`+500 ms / DCL+3 s. Gorzej, gdy większy kandydat (powłoka, ticker, podmiana fontu) pojawi się **po** burście: wtedy cały JS ląduje w zbiorze LCP.
- Bramka W1 nie sprawdza tożsamości elementu LCP. P1.4 sprawdza ją tylko na własnym drzewie, bez powłoki.
- **Naprawa:** w P1.3 test geometrii (pole tekstu powłoki < pole kandydata przy 412×823 i 1350×940); w bramce W1 `lcpElement == img[data-lcp-candidate]` we wszystkich przebiegach; w P2.1 weryfikacja „start burstu po obs LCP" na drzewie z powłoką i z treścią, w której leady mają różne okładki.

### M8. Wariant dokumentu, który dostaje PSI, cache i kalibracja hosta są poza ścieżką wyniku

- **Wariant bota:** `isbot` łapie „Chrome-Lighthouse", więc PSI na MISS dostaje buforowany wariant allReady (werdykty M1 #2, M3 #3). Plan mierzy zmiany kształtu dokumentu (P1.4, P2.1, P4.2, P4.3) tylko z rozgrzewką przeglądarkową. DoD wymaga od wariantu bota jedynie „brak regresji" (3 przebiegi, tylko mobile). Wariant bota musi spełniać **te same progi**, a P2.1 musi mieć test, że `injectHtml` z `#nes-boot-set` działa na ścieżce allReady.
- **HIT/MISS:** §8.2 każe oceniać „medianę przebiegów HIT". Kontrakt to jednak PSI uruchamiane przez użytkownika, a MISS kosztuje −3,4 / −4,8 pkt. P7.1 (rozgrzewka EU+US, S, niskie ryzyko; SC-5: „MISS probability in warmed colos ~0") jest w W7 jako „dodatek". Powinien wejść na ścieżkę wyniku (W0/W1), a DoD powinno raportować oczekiwany wynik dla mieszanki HIT/MISS z danych P0.4.
- **Kalibracja desktop:** cel ≤ 110 ms na desktop4x zakłada host PSI ≈ ×4. Werdykt LA-C1: model analityka daje ≈ ×5, a przy ×5 TBT rośnie ~2× (444 → 765 bazowo; 150 → 297 po cięciach). Naprawa: bramka desktop5x (raportowa → twarda przy DoD), a w W0 porównanie bazy fixture **z flagami** z PSI 600/740 i korekta mnożnika, jeśli rozjazd > 20 %.

### M9. Brak JSON-ów PSI: kluczowe anomalie produkcji pozostają niewyjaśnione (punkt 6 zlecenia)

- **Luka FCP→LCP na PSI mobile (3,1 → 6,6 s; M3 3,5 → 5,4; fixture 4,06 → 4,81):** hipoteza analityka („LCP obserwowane po DCL, ~930 KB w zbiorze") jest niezweryfikowana. Werdykt LP-3 kalibruje wyraz wolny na 1,64 s zamiast 0,9 s, więc **~0,74 s PSI-only** wchodzi do projekcji LCP 2,7–3,0 s jako stała. Jeśli to koszt CPU parsowania 178 KB HTML przed hero (nagłówek 103 KB z ukrytym mega-menu i 14 blokami `<style>` = 48,7 KB) w pesymistycznym grafie LCP, C3 tego nie usuwa. Zajmowało się tym LA-C5, odroczone z niesprawdzonym uzasadnieniem „zamyka się konstrukcyjnie przez P2.1".
- **Desktop TBT 740 ms:** podział (hydratacja ≈ 50 %, gtag+zgody ≈ 35 %, inne ≈ 15 %) to model, nie pomiar. Diagnostyka PSI: desktop main-thread 5,0 s przy ×1 wobec mobile 4,2 s, czyli ~1,05 s obserwowanego przy ×4. Desktopowy przebieg miał więc ~5× więcej obserwowanej pracy. To przeciążony host albo praca tylko-desktopowa (sekcje 2–3 i mega-menu hydratują od razu). Dzień wcześniej było 450 ms. Jedna próbka nie wystarcza do kalibracji W3/W5.
- Także: „99 user-timing marks" tylko na PSI (lokalnie 0) i obecność gtag w śladzie PSI (LA-C2: „unverified").
- **Naprawa:** warunek wejścia do W1, a najpóźniej do W2. Człowiek eksportuje ≥ 3 JSON-y PSI na formę z `hl=pl` (pagespeed.web.dev → JSON, bez czekania na `PSI_API_KEY`/D8). Potem `analyze.py` + `lanternTasks` i re-baseline księgi: sprawdzić `observedLargestContentfulPaint` wobec `observedDomContentLoaded`, element LCP, bajty i CPU w grafie LCP, `benchmarkIndex` i listę `long-tasks` desktop.

### M10. Kubły bajtów i ms bez właściciela (punkt 1 zlecenia)

- **(a) „other/unattributed" TBT** (commit/raster, timery, GC): 112 ms mobile i 101 ms desktop ×4 latentnie (analityk §4b). Nie ma pozycji ani jawnego odrzucenia (B2).
- **(b) Ukryty nagłówek desktop na mobile:** 37,2 KB `hidden lg:block` jest „display:none on mobile but still parsed **and hydrated**" (`html-weight.md` §5). Wyspa z wyzwalaczem `matchMedia('(min-width:1024px)')` byłaby niewidoczna dla użytkownika i zachowuje parytet HTML. Reguła „nawigacja hydratuje pierwsza" dotyczy widocznej nawigacji: na mobile to nagłówek mobilny 4,1 KB. Dźwignia TBT mobile (część „stałej pracy nagłówka", którą raport hydratacji wskazuje jako dominującą) nie ma właściciela. R5 dotyczy tylko bajtów.
- **(c) Zadania parsowania po C3:** B1.
- **(d) Jawne zamknięcia nieodnotowane w planie:** speculation rules (`moderate`, prior-art D8), TTL awatarów i `/~flock.js` (kosmetyczne wg analityka §6), `vendor-zod` 54 KB w boot (16 importerów; po C3 poza zbiorem LCP — warto to napisać).

### M11. Kumulacja pracy przy pierwszej interakcji (INP pola) i kaskada `whenQuiescent`

- Na `onFirstInteraction` startują naraz: gtag (≈300 ms CPU na średnim telefonie z AW, ≈120 ms bez; werdykt TP-1 #2), interaktywny `ConsentBanner` (+ radix/sonner), wszystkie wyspy (P2.2, po jednej w rIC), widgety nagłówka (P2.3) i `NewsletterPopup.prepare()`. Plan liczy laboratorium, ale INP to Core Web Vital w CrUX (ranking). Brakuje kolejności i budżetu tej pracy oraz monitoringu INP: P7.4 dokłada do RUM tylko stan cache.
- Kaskada ciszy: kilku konsumentów `whenQuiescent` (gtag, zapas banera, import `cacheBusting`, zapas wysp) wywołuje żądania, które wzajemnie przesuwają swoje 5-sekundowe okna. Autoodtwarzanie slidera (4,5–5,5 s; kolejne slajdy dociągają obraz przy pierwszym pokazie) i pierwszy poll `cacheBusting` (~+8 s) resetują ciszę zasobów. gtag będzie więc często strzelał dopiero na cap 20 s, a utrata `page_view` jest większa niż opisana („odbicia przed ~load+10 s").
- **Naprawa:** jedna kolejka „po pierwszej interakcji" z priorytetami (powłoka → wyspa pod palcem → nagłówek → reszta wysp → gtag na końcu, `postTask('background')`, jedno zadanie na klatkę); `whenQuiescent` z listą ignorowanych zasobów (obrazy slajdów, własne żądania konsumentów); INP i `page_view`-rate w RUM (P7.4) jako warunek wdrożenia P1.1/P1.3/P2.2.

### M12. Zalogowani w P2.3: wyspa nagłówka pokaże ikonę logowania zamiast awatara

HTML w cache jest anonimowy. AccountMenu jako wyspa „na intencję" nie przyjmie aktualizacji auth przed hydratacją, więc zalogowany zobaczy ikonę „Zaloguj" do pierwszego najechania lub dotknięcia. Tę widoczną regresję łamie decyzja właściciela („nie psuje działania"). **Naprawa:** wyspy nagłówka hydratują natychmiast, gdy `hasStoredAuthSession()` (to samo wyrażenie co tryb `immediate` w P2.1), plus e2e z zapisaną sesją.

### M13. P4.3 (HW-5): względne URL-e przez `publicUrl.ts` grożą e-mailom, OG i danym w bazie

`src/lib/media/publicUrl.ts` używają m.in. `src/lib/media/upload.ts` (stemplowanie `public_url` w bazie), `src/components/admin/newsletter/builder/PropertiesPanel.tsx` (e-maile), `src/lib/wordpress-import.functions.ts`, `src/lib/server/wp-media.server.ts`. Mechanizm „ścieżki względne … `publicUrl.ts`" nie ogranicza zakresu. **Naprawa:** względne wyłącznie w `srcset`/`src` renderowanym do HTML (`cropSizes.ts` w renderze), nigdy w funkcjach stemplujących, w OG/JSON-LD/RSS/sitemap ani w e-mailach; test bajtowej równości meta/JSON-LD.

### M14. P4.1 a reguła AGENTS.md o zminimalizowanych czatach

P4.1 przenosi `chat.css` i `dock.css` do CSS modułów ładowanych leniwie. Dock jest obecny na stronach publicznych (`DOCK_RESERVE_INIT_SCRIPT` rezerwuje krawędź przed pierwszym malowaniem), a zminimalizowane czaty odtwarzane ze wspólnego store'a sesji (maks. 3 bańki na mobile, pigułki na desktopie) mogłyby przez chwilę renderować się bez stylów lub z przesunięciem. **Naprawa:** style stanu zminimalizowanego (bańki i pigułki) zostają w rdzeniu albo ładują się w tym samym chunku co dock; e2e odtworzenia z sessionStorage na 412 px i 1350 px (CLS 0, liczba baniek ≤ 3).

### M15. Wykonanie: brak rytmu rebase na `origin/main` i planu B dla P2.1

- Bot Lovable zrobił 78 commitów na main od 10-02 (prior-art §4), w tym zmiany w `styles.css`, widgetach, `ga4Client.ts` i `tagIds.ts`. Plan nie określa rebase'u bazy fali na `origin/main` ani ponownego pomiaru bazy po rebase. Grozi to konfliktami z P1.1, P1.2 i P4.1 oraz zestarzeniem baseline'u W0.
- P2.1 stoi na spike'u „przepisanie wirtualnego modułu manifestu TanStack (≤ 0,5 dnia)". Plan nie ma ścieżki zapasowej, jeśli spike się nie uda, a mobile 85 nie ma bez P2.1 żadnej alternatywy. **Naprawa:** zapisać plan B, np. transformację strumienia dokumentu w `server.ts` plus dowód parytetu odwodnionego manifestu z `router-core ssr-client.js:40-41`, z kryterium porzucenia.

### M16. P3.1 jest niekonkretny i źle umieszczony w kolejności

Mechanizm zależy od wyników P1.5, lista plików jest zgadywana (`router.tsx`, `useAuth.tsx`…), a budżet −60/−50 przypisano nieznanym poprawkom. Werdykt LA-C1 zaleca to jako **tani pierwszy krok** („find what forces Layout in the 95.6 ms commit and the 34 ms root pass … before building a general yielding framework"), a plan umieszcza poprawki **po** wyspach. Bramka W2 jest więc oceniana bez największej pojedynczej poprawki zadania. **Naprawa:** P1.5 w W1 z raportem w formie listy poprawek (plik:linia, właściciel). Poprawki niezależne od C3 trafiają do fali W1b, a w W3 zostają tylko te zależne od C3. Z kolei P5.1 i P5.2 (rezerwa, od której zależy desktop 95) potrzebują mechanizmu na poziomie plików i funkcji, nie haseł.

## 4. Luki DROBNE

- **m1. Zmiany odradzane w werdyktach weszły do planu bez odpowiedzi:** P1.2 (2) projekcja font-scale (H2: „Keep … only as an optional follow-up"); P4.2 H2(c) rozgrzanie `post_layout_settings` („Drop the post_layout warm", odwrócenie PR #314; dokłada podzapytanie SSR na każdej trasie chrome); resztka `css:C6` w P4.1 (C6 obalone: wykonalność i efekt). Warunek „tylko jeśli mieści się w budżetach" to nie jest odpowiedź na argument werdyktu.
- **m2. P2.4: weryfikacja na zminifikowanych nazwach** `cz/fz/Tn/rD`, które zmieniają się z każdym buildem. Trzeba je zastąpić nazwami komponentów (build profilujący z P1.5) albo atrybucją pliku źródłowego przez sourcemapę.
- **m3. G-std nie zawiera bramek uruchamianych w CI:** `check:feature-taxonomy` (ci.yml:257), `check:dangerous-html` (jest tylko w części pozycji), `check:clock-freeze` (testy timerów `whenQuiescent`), `check:unknown-casts`. Lepiej odesłać do `verify:static` i `ci.yml`, niż wyliczać bramki ręcznie.
- **m4. Powłoka zgód:** (a) SEO: `data-nosnippet` na powłoce, bo tekst cookies staje się częścią HTML każdej strony; (b) a11y: zachowanie fokusu przy podmianie powłoka → baner (dziś fokus na przycisku powłoki zginie) oraz ta sama rola/etykiety ARIA co baner; (c) klik w powłoce zapisuje tylko `window.__nesConsentIntent`. Przy C3 boot jest później, więc nawigacja MPA przed bootem gubi decyzję i baner wraca. Decyzję trzeba utrwalać od razu tym samym wyrażeniem (cookie/`consent:v2`), które czyta `CONSENT_INIT_SCRIPT`.
- **m5. Nowe granice `<Suspense>` na serwerze** (sekcje bez granicy i stopka w P2.2): jakiekolwiek zawieszenie po stronie serwera w środku zmienia kolejność strumienia. To ta sama klasa co incydent PR #423/#431 (bimodalne LCP, CLS 0,0168) i ostrzeżenie werdyktu LA-C1 o nagłówku i stopce. Potrzebny test w `builderRenderer.streamingServer.test.tsx`: brak fallbacku w HTML serwera dla wysp.
- **m6. Motyw i język przy wyspach:** `ThemeProvider.tsx:78,101` używa `startTransition`, a przejście „czeka na wyspy bez górnej granicy" (ryzyko P1.6). Przełącznik trybu ciemnego może opóźniać się o sekundy. Potrzebny e2e: przełączenie motywu przed hydratacją wysp i jego czas.
- **m7. `lanternTasks` „z LHR"** nie rozpozna zadań z Layout (mnożnik ×mult/2), bo do tego potrzebny jest ślad. Harness musi zapisywać artefakty (`-G`/`-A`) i liczyć z trace, jak `tasks.py`.
- **m8. P6.2:** konwencja repo wymaga linku z `docs/performance/README.md`, z ominięciem linii edytowanej przez PR #466. Pliku nie ma na liście.
- **m9. P3.2 font:** test pokrycia glifów jest, ale brakuje asercji, że podzbiór zachowuje metryki pionowe (OS/2/hhea) identyczne z dzisiejszymi. Inaczej podmiana fontu wnosi CLS przy `swap`.
- **m10. Wyspy u zalogowanych i redaktorów na stronach publicznych:** bloki zależne od roli (np. przyciski edycji, treści członkowskie) w sekcjach ≥ 1 pokazują wariant anonimowy do wyzwolenia wyspy. Do odnotowania i testu e2e.
- **m11. `scriptBytesEndedBeforeObsLcp = 0` w DoD** nie uwzględnia `/~flock.js` (P2.1 to robi, DoD nie). Trzeba ujednolicić definicję (wykluczenie hosta flock jawnie w metryce).

## 5. Kontrola ośmiu punktów zlecenia

| #   | pytanie                                                       | ocena                                                                                                                                 | gdzie                   |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 1   | każdy kubeł bajtów/ms ma właściciela lub jawne odrzucenie     | **nie** — „other" TBT, parsowanie po C3 (de facto nieliczone), ukryty nagłówek desktop na mobile, kilka zamknięć nieodnotowanych      | B1, B2, M10             |
| 2   | arytmetyka domyka się z zapasem (wolny host desktop, Lantern) | **nie** — mobile 78–83 przy sprzężeniu z werdyktów, desktop 84–89 (94 z W5) wobec 95; brak zapasu na MISS i host ×5                   | §1, B1, B2, M8          |
| 3   | brak wspólnych plików w fali                                  | **częściowo** — listy rozłączne, ale 5 ukrytych kolizji (taksonomia, allowlista, `__root` seed, `hydrationIsland`, nadmiar P3.1→W5)   | M4                      |
| 4   | mierzalna weryfikacja każdej pozycji                          | **częściowo** — SI na fixture nieosiągalne, CLS 0,000 ścisłe przy szumie, ΔTBT „w każdej parze" bez mocy, zminifikowane nazwy         | M2, M3, m2              |
| 5   | ryzyka: zalogowani, redaktorzy, SEO, i18n, CLS, a11y          | **częściowo** — luki: zalogowani w P2.3, CLS przez uSES, e-maile/OG w P4.3, czaty AGENTS.md w P4.1, INP pola, fokus/nosnippet powłoki | M5, M11–M14, m4–m6, m10 |
| 6   | anomalie produkcji wyjaśnione                                 | **nie** — luka FCP→LCP PSI (0,74 s w wyrazie wolnym), desktop 740 (5,0 s main-thread przy ×1), gtag w śladzie PSI — brak JSON-ów PSI  | M9                      |
| 7   | mechanizmy konkretne dla agenta                               | **w większości tak**; niekonkretne: P3.1, P5.1, P5.2, warunkowe części P2.3 i P4.1 (dwie alternatywy, glob własności)                 | M16                     |
| 8   | obalone zmiany nie wróciły bez odpowiedzi                     | **w większości tak**; wyjątki: H2 font-scale, rozgrzanie post_layout, resztka C6, LA-C5 odroczone z niezweryfikowanym argumentem      | m1, M9                  |

## 6. Minimalny zestaw poprawek przed startem fali 1 (w kolejności)

1. Przeliczyć §1.5 i §5 ze sprzężeniem +500 (+350…+700), regułą ×0,5 stosowaną konsekwentnie i księgą per zadanie (`whatif.py`). Zapisać, przy jakim sprzężeniu mobile 85 jeszcze przechodzi (≤ ~+350 ms przy cięciach W2).
2. W0: (a) poprawka STALE z werdyktu M1 do P0.1; (b) JSON-y PSI od człowieka (≥ 3 na formę, `hl=pl`); (c) A/A z flagami; (d) kalibracja desktop4x/desktop5x wobec PSI; (e) P7.1 przeniesione na ścieżkę wyniku.
3. Koniec W1: pomiar „drzewo W1 + transformacja C3" (`c3-lcpobs.mjs`) jako prognoza bramki W2. Jeśli TBT mobile > 250 ms fixture, W2 dostaje pakiet parsowania dokumentu jako MUST.
4. Naprawić mechanizmy: P3.2 (640w w drabinie hero), P1.6/P2.2 (korekta urządzenia przez transition albo bramka po chunkach), P1.2 (`hardenStyleCss` w `StyleSink`, porzucić część (2)), P2.3 (natychmiast przy zapisanej sesji; pełne API wyzwalaczy dostarczone w P1.6).
5. Bramki: SI przez `observedSpeedIndex`/filmstrip, CLS ≤ 0,001, W2 TBT ≤ 200 fixture lub projekcja ≥ 87, tożsamość elementu LCP w W1, wariant bota z tymi samymi progami, desktop5x.
6. Desktop: decyzja D12 (stretch czy MUST). Jeśli MUST: poprawki P1.5 przed wyspami, wyspa ukrytego nagłówka, właściciel kubła „other", konkretne P5.1 i P5.2 jako niewarunkowe.
