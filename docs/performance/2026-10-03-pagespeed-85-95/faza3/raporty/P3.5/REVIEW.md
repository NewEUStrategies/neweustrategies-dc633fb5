# P3.5 (fala 3) — recenzja przeciwna: bramka ruchu

Worktree `$SCRATCH/wt3/P3.5`, commit `5d667d7e` (jeden commit na `claude/zen-ritchie-hzur21` @ `c606bfa4`), 48 plików,
+2289/−129. Źródła: `faza3/PLAN-FALI-3.md` §1 i §2 P3.5, `faza3/diagnoza/ruch-inwentarz.md`, notatki orkiestratora,
`IMPL.md`.

**Werdykt: APPROVE** (0 blokujących, 1 poważna, 6 drobnych). Mechanizm zgodny z planem, zakres plików zgodny z listą,
odstępstwa nazwane i uzasadnione, parytet SSR/hydratacji poprawny, testy łapią mechanizm (nie tylko render).

## 1. Bramki uruchomione w recenzji

| Bramka                                                                                                                                                                   | Wynik                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `light.sh bunx eslint` (wszystkie dotknięte `.ts/.tsx`, 46 plików)                                                                                                       | exit 0; 0 błędów, 21 ostrzeżeń `react-refresh/only-export-components` (jak na bazie) — `review/eslint.log` |
| `light.sh bunx vitest run` (23 dotknięte/nowe pliki testów)                                                                                                              | 23/23 plików, 571 passed + 8 expected fail — `review/vitest.log`                                           |
| `light.sh bunx vitest run` (kontrola sąsiednia: `sectionLabelKineticNotch`, `sliderVariantCatalogs`, `sliderResponsiveNavigation`, cały `src/lib/performance/__tests__`) | 11/11 plików, 362 passed + 1 expected fail — `review/vitest-extra.log`                                     |
| `light.sh bun run verify:static`                                                                                                                                         | 15 bramek OK w 269,9 s — `review/verify-static.log`                                                        |
| typecheck, build, Lighthouse, e2e                                                                                                                                        | nie uruchamiane (poza zakresem recenzji)                                                                   |

## 2. Co sprawdziłem i co się obroniło

- **Zakres plików.** Wszystkie pliki produkcyjne są na liście P3.5 (`sliderVariants`, `TrendingTicker`, `NewsTickerView`,
  `TrendingNowView`, `PostListView`, `InteractiveCircleWidget`, oba odliczania widgetów, `SimpleWidgets` — tylko wideo,
  YouTube i ikona w pętli, cztery komponenty `ui/*`, `animatedHeadingVariants`, `sectionLabelVariants` — tylko
  ticker-strip, `RelatedPosts`, `MarketingViews`, `InteractiveViews` — tylko `CountdownView`, `ConversionViews` — tylko
  `VideoHeroView`, `BuilderRenderer` — tylko `SectionBackgroundVideo`, `WorldMap`, `styles.css` — jedna wspólna reguła).
  Nowe testy obok modułów. Spec e2e w `e2e/` z nazwą dopasowaną do `testMatch` zestawu artefaktu (odstępstwo 1,
  uzasadnione: `playwright.artifact.config.ts:103` bierze tylko `boot-(artifact|timing|home)`, a `playwright.config.ts:38`
  ten wzorzec ignoruje; CI `ci.yml:213` uruchamia `test:e2e:artifact`). Kinetic Signal Notch nietknięty (diff
  `sectionLabelVariants.tsx` dotyka wyłącznie `TickerStripPulse`). Brak nowych zależności, brak zbędnych plików,
  komentarze i commit po polsku, stopka commita dokładnie wg wymagań.
- **Prymityw** (`interactionOrQuiet.ts`): jeden zatrzask na dokument, uzbrajany leniwie i nigdy nie rozbrajany
  (StrictMode/remount nie restartują czekania), `enqueue(fire, {priority: "overlays"})` + `onQuiescent(fire, …)`, drugi
  tor zdejmowany w `fire`, uzbrojenie dopiero po `afterPrerendering`, `openLatch` ignoruje dokument prerenderowany,
  serwer no-op. `useSyncExternalStore` z `getServerSnapshot = false` daje parytet hydratacji także wtedy, gdy zatrzask
  jest już otwarty (późna wyspa) — test hydratacji z `onRecoverableError` to przypina. Odstępstwo 7 (komponent
  zamontowany po otwarciu dostaje `true` od razu) nie łamie parytetu.
- **Bramka** (`motionGate.ts`): `data-motion="on"` ustawiany poza Reactem, w tym samym zadaniu co callbacki React
  (atrybut zapisywany przed `onChange`, test `seen === ["on"]`). Reguła
  `:root:not([data-motion="on"]) [data-motion-loop] { animation-play-state: paused !important }` działa od pierwszego
  malowania (arkusz blokujący), wygrywa ze stylem inline (marquee/NewsTicker `animationPlayState: "running"`), po
  otwarciu przestaje pasować, więc pauza pod kursorem i bloki reduced motion działają jak dotąd. Selektor z prawym
  członem atrybutowym — tania inwalidacja przy zmianie atrybutu `<html>`.
- **Każdy element `data-motion-loop` ma w tym samym komponencie uzbrajający hook** (sprawdzone warunkami:
  `TrendingNowView` `rows.length > 1` ↔ `keyframes`, `InteractiveCircle` `arcCls`/`pulse` ↔ `animation !== "none"`,
  `WorldMap` `animated`, `LoopingIcon`, `TickerStripPulse`, tory tickera). Wyspy nieuwodnione dostają ruch, gdy
  ktokolwiek otworzy bramkę (atrybut jest globalny), a same mają zapas ciszy — brak „wiecznej pauzy”.
- **Timery** startują na `motion === true`, więc pierwsza zmiana = otwarcie + pełny interwał (slider hero, porcje
  tickera, karuzele, rotatory, RelatedSlider, ImageCarousel). `prefersReducedMotion()` dodane w SliderRender, rotacji
  AnimatedHeading, InteractiveCircle i RelatedSlider (wymóg notatek). Przycisk pauzy `PostListCarousel` zależy od
  `userPaused`, nie od `running`, więc klik „pauza” przed otwarciem zostaje respektowany po otwarciu.
- **AnimatedHeading**: do otwarcia gałąź `forwards`, po otwarciu pętla z NOWĄ nazwą klatek i ujemnym opóźnieniem =
  czas rysowania (dla `scribble` `drawDur`, dla reszty `durationMs`), czyli start w fazie „narysowany” — zgodne z
  procentami klatek (`aDrawEnd`/`drawEnd`). Otwarcie nie zmienia klatki.
- **Lantern / Speed Index.** Bramka nie otwiera się w śladzie Lighthouse'a (brak interakcji, punkt ciszy ≥ 5 s po `load`
  i 5 s ciszy, ślad kończy się ~1 s po ciszy sieci), więc znika przeskok hero (produkcja: 8,1 s) i porcje tickera; pętle
  CSS w kadrze stoją od pierwszej klatki, więc speedline ma stabilną ostatnią klatkę. Nic nowego nie zmienia klatki w
  chwili otwarcia. Koszt CPU przy otwarciu (re-render konsumentów) leży poza śladem i w klasie `overlays` kolejki.
- **Graf chunków.** `interactionOrQuiet` importuje wyłącznie `prerender`, `postInteractionQueue`, `whenQuiescent` — moduły
  już w domknięciu bootu (`TrendingTicker` importował dwa ostatnie). Brak cykli, brak ciężkich krawędzi.
- **Zalogowani/redaktorzy/EN.** Brak kluczy i18n, brak zależności od sesji; w edytorze `preview` wyłącza autoplay
  slidera/rotacji jak dotąd, a pętle w kanwie ruszają po pierwszej interakcji redaktora.
- **Testy a mutacje.** Odwrócenie `!motion` w slider/ticker/karuzelach/odliczaniach/wideo łapią testy 30 s + „dokładnie
  interwał”; `getServerSnapshot = open` łapie test hydratacji; e2e na artefakcie bazy jest czerwone 3/3 (IMPL §3).

## 3. Ustalenia

### MAJOR-1 — `WorldMap`: łuki w trybie pętli są NIEWIDOCZNE do otwarcia bramki

- `src/components/maps/WorldMap.tsx:266-272, 289, 300` + `src/lib/maps/worldMapGeo.ts:149-154`.
- Dowód: pętla ma `animationDelay: "0s"`, a klatka `0%` to `stroke-dashoffset: 1` (łuk niewidoczny). Pauza w pierwszej
  klatce (`data-motion-loop`) zatrzymuje więc łuki w stanie „nienarysowane” — mapa pokazuje tylko kropki i znaczniki
  aż do interakcji albo ciszy (na desktopie bez interakcji ≥ 5–10 s, limit 20 s). Na bazie łuki rysowały się w ciągu
  pierwszych sekund. IMPL odstępstwo 4 przyznaje koszt; to widoczna regresja treści widgetu (trasy to sens mapy), a da
  się jej uniknąć bez łamania „otwarcie nie zmienia klatki”.
- Poprawka: w trybie pętli ustawić od SSR ujemne opóźnienie, które ląduje w fazie „wszystkie łuki narysowane” (między
  `end` ostatniego łuku a `reset` pierwszego, np. `animationDelay: -${timing.drawS}s` dla łuków; iskra w fazie z
  `opacity: 0`). Pauza od pierwszej klatki trzyma wtedy łuki narysowane, a po otwarciu pętla biegnie dalej od tej fazy
  (bez skoku). Test: przy pętli `animationDelay` łuku < 0 i wskazuje fazę z `dashoffset: 0` (np. przez `arcKeyframes`).

### MINOR-1 — YouTube: `playVideo` przez `postMessage` bez uzgodnienia z odtwarzaczem

- `src/components/builder/organisms/widget-view/SimpleWidgets.tsx:173-195`.
- Dowód: polecenie idzie raz przy otwarciu i raz na `load` ramki; jeśli bramka otworzy się wcześnie (szybka interakcja),
  a odtwarzacz w ramce nie nasłuchuje jeszcze poleceń, autoplay po cichu nie nastąpi (IMPL §4.3 to przyznaje). Brak
  dowodu w prawdziwej przeglądarce (test jednostkowy sprawdza tylko wywołanie `postMessage`).
- Poprawka: po otwarciu wysłać `{"event":"listening"}` i zagrać dopiero po wiadomości z originu YouTube
  (`onReady`/`initialDelivery`/`infoDelivery`), albo ponawiać `playVideo` kilka razy z krokiem ~500 ms do pierwszego
  `infoDelivery` z `playerState === 1`. Odstępstwo od „URL z `autoplay=1` po otwarciu” jest uzasadnione — zostawić.

### MINOR-2 — wideo bez `autoplay` i z `preload="metadata"`: pusta klatka na iOS przed otwarciem

- `src/components/builder/organisms/BuilderRenderer.tsx:702-718` (`SectionBackgroundVideo`, bez plakatu);
  pośrednio `AutoplayVideo` w `SimpleWidgets.tsx` i `VideoHeroView` bez `poster`.
- Dowód: Safari iOS przy `preload="metadata"` bez `autoplay` i bez plakatu nie maluje pierwszej klatki — tło sekcji jest
  puste aż do otwarcia bramki (wcześniej `autoplay` od razu grało). Chrome maluje pierwszą klatkę, więc Lighthouse tego
  nie zobaczy.
- Poprawka: fragment `#t=0.001` w `src` wideo tła (wymusza dekodowanie pierwszej klatki) albo `poster` z CMS, jeśli jest.

### MINOR-3 — AnimatedHeading: wczesne otwarcie przeskakuje niedokończone rysowanie

- `src/lib/builder/animatedHeadingVariants.tsx:705, 783`.
- Dowód: `resumeLoop` zakłada, że kształt jest już narysowany. Gdy bramka otworzy się przed końcem `delayMs + durationMs`
  od pierwszego malowania (interakcja w pierwszej ~1–2 s, albo świeży montaż po nawigacji SPA przed otwarciem), pętla
  startuje w fazie „narysowany” i kreska skacze do pełnej długości.
- Poprawka: zapamiętać `performance.now()` montażu i przy wznowieniu ustawić opóźnienie
  `-min(drawEnd, elapsed - delayMs)` (albo przełączać na pętlę dopiero po `animationend` gałęzi `forwards`).

### MINOR-4 — `TypewriterText`: pierwsza porcja pisze się bez bramki

- `src/components/header/TrendingTicker.tsx:477-512`.
- Dowód: SSR renderuje `n = 0` (pusty tytuł + kursor), a po hydratacji timer wpisuje znaki — zmiana wizualna w oknie
  śladu w trybie `typewriter` (nie jest domyślny; zachowanie sprzed P3.5, diagnoza mówi „jak a.”). Bramka wstrzymuje
  tylko kolejne porcje i mruganie kursora.
- Poprawka (kolejna pozycja albo tutaj): do otwarcia bramki pełny tytuł (`n = text.length`, także w SSR), pisanie tylko
  dla porcji po otwarciu.

### MINOR-5 — zapas budżetów po P3.5 jest bardzo mały; `check:bundle` nieuruchomiony

- IMPL §3: `bootClosureGzipBytes` +859 B (zapas 745 B), `bootBurstGzipBytes` +1060 B (zapas ~957 B);
  `check:bundle`/`check:chunks`/`check:entry-purity` czekają na Prove (OVERALL zapas 20 KB).
- Ryzyko: P3.4 (ten sam batch) zmienia loader i zestaw bootu — suma może przekroczyć `document-weight`.
- Poprawka (proces): `check:document-weight` i `check:bundle` po scaleniu P3.4 + P3.5 razem, nie osobno.

### MINOR-6 — dowód pauzy treści w e2e opiera się na sondzie; czas CI

- `e2e/motion-gate.boot-home.spec.ts:123-181`.
- Dowód: na fixture `/` pasek ma tryb `flip` (ścieżka JS), więc w dokumencie nie ma prawdziwej nieskończonej animacji z
  SSR — `runningInfiniteAnimations() == []` jest spełnione trywialnie, a regułę CSS dowodzi wstrzyknięta sonda (dobra
  kontrola dodatnia, ale nie treść). Scenariusz 2 dokłada do joba CI do ~40 s oczekiwania na ciszę. Testy jednostkowe
  `data-motion-loop` (ticker, NewsTicker, TrendingNow, mapa, ticker-strip) sprawdzają obecność znacznika, nie zachowanie.
- Poprawka (opcjonalna): w scenariuszu 1 dodać asercję `getAnimations()` dla prawdziwego elementu treści (np. przez
  `page.route` fixture z `layoutStyle: "glassMarquee"` albo osobny przypadek z sekcją ticker-strip), żeby e2e
  wykrywało zgubienie `data-motion-loop` w komponencie.

## 4. Ryzyka do opisu w PR (bez zmian w kodzie)

- Zmiana widoczna: hero, karuzele, tickery, rotatory, pętle, mapa, wideo i sekundnik odliczań ruszają po interakcji albo
  ciszy (≥ 5 s po `load`, limit 20 s); odliczanie przed otwarciem tyka co minutę (minuty mogą być do 59 s nieświeże).
- Harness lokalny nie odtwarza kary za autoplay (plan §1); dowód SI jest strukturalny (e2e + kontrola negatywna na
  bazie) i produkcyjny po wdrożeniu.
