# P3.5 (fala 3) — runda poprawek 1: bramka ruchu po recenzji i dowodzie

Worktree `$SCRATCH/wt3/P3.5`, gałąź `perf/w3-P3.5`, commit `75c1109a` na `5d667d7e` (bez przepisywania historii).
Źródła: `REVIEW.md` (MAJOR-1, MINOR-1…6), notatki orkiestratora dla rundy poprawek, `PROVE.md` §2–3.
Logi tej rundy: `$SCRATCH/phase3/wave3/P3.5/fix1/`.

## 1. Co zmienione i dlaczego (plik po pliku)

### MAJOR-1 — mapa: łuki narysowane od SSR, pauza w fazie „wszystkie łuki gotowe”

- `src/components/maps/WorldMap.tsx`: w trybie pętli łuki (poświata + rdzeń) i iskry dostają od SSR wspólne ujemne
  opóźnienie `loopDelay = -(drawS - ARC_STAGGER_S/2)` s (`toFixed(3)`, deterministyczne, więc HTML = hydratacja).
  Ostatni łuk jest gotowy w `drawS - ARC_STAGGER_S`, a `resetPct` wypada w `drawS`, więc środek tego okna (0,15 s od
  obu krawędzi, daleko od zaokrągleń procentów klatek) to faza, w której KAŻDY łuk ma `stroke-dashoffset: 0`,
  `opacity: 1`, a KAŻDA iskra `opacity: 0`. Pauza bramki (`data-motion-loop`) trzyma tę klatkę od pierwszego
  malowania; po otwarciu pętla biegnie dalej od niej (wygaszenie, rysowanie od nowa) — bez skoku. Wspólne opóźnienie
  zachowuje harmonogram (wszystkie klatki łuków liczone na tym samym cyklu). `worldMapGeo.ts` nietknięty (poza listą
  plików; wystarczyło `timing.drawS` i `ARC_STAGGER_S`, już importowane). Jednorazowe rysowanie (`loop={false}`) bez
  zmian. Mapa zamontowana po otwarciu (nawigacja SPA) startuje od łuków narysowanych, potem pętla — lepiej niż pusta.
- Test `src/components/maps/__tests__/WorldMap.test.tsx`: 3 łuki; `renderToString` ma 9 jednakowych ujemnych
  `animation-delay` (łuki + iskry), klient ma to samo opóźnienie (parytet), a parser klatek z wyrenderowanego
  `<style>` sprawdza, że faza `-delay/cycle` leży między klatkami z `stroke-dashoffset:0; opacity:1` (łuki) i
  `opacity:0` (iskry). Mutacja `loopDelay = "0s"` → test czerwony.

### MINOR-1 — YouTube: uzgodnienie z odtwarzaczem przed `playVideo`

- `src/components/builder/organisms/widget-view/SimpleWidgets.tsx` (`YouTubeEmbed`): po otwarciu bramki strona,
  jak `iframe_api`, woła `{"event":"listening"}` od razu i co 250 ms do pierwszej odpowiedzi odtwarzacza; wiadomość
  liczy się tylko z originu `https://www.youtube.com` i z TEJ ramki (`event.source === frame.contentWindow`).
  Pierwsza odpowiedź kończy wołanie, a `playVideo` idzie dopiero po `onReady` (raz; potem nasłuch zdjęty).
  Odtwarzacz podłączony już po swoim załadowaniu też odpowiada `onReady`, a ramka ładująca się długo odpowie, gdy
  wstanie — wołanie trwa do tego czasu albo do odmontowania (sprzątanie efektu). Wcześniejsze „`playVideo` od razu
  i przy `load`” usunięte (polecenie do niesłuchającego odtwarzacza przepadało).
- Testy `widgetBehavior.test.tsx` (pomocnik `stubYouTubeFrame`): adres bez `autoplay=1`; do otwarcia zero
  wiadomości; po otwarciu `listening` co 250 ms; obcy origin i obca ramka nie uruchamiają gry; `initialDelivery`
  kończy wołanie, ale nie gra; `onReady` → dokładnie jedno `playVideo`; późna odpowiedź (po 30 s wołania) nadal gra;
  odmontowanie gasi wołanie i nasłuch; bez autoplay — zero rozmowy z ramką i brak `enablejsapi`. Mutacje (bez
  sprawdzenia originu; gra na pierwszej wiadomości) → czerwone.

### MINOR-2 — wideo za bramką: pierwsza klatka zamiast pustego prostokąta na iOS; ujednolicenie

- `src/lib/performance/motionGate.ts`: dwa wspólne pomocniki (jedno wykonanie zamiast trzech kopii):
  - `useGatedVideoAutoplay(ref, enabled, src, inViewOnly?)` — wyciszone `play()` po otwarciu bramki (ponownie przy
    zmianie `src`); `inViewOnly` = dotychczasowe zachowanie wideo tła (IntersectionObserver z marginesem 200 px,
    pauza poza kadrem; bez IO — `play()` wprost i pauza w sprzątaniu). `enabled === false` niczego nie uzbraja.
  - `firstFrameVideoSrc(src, poster?)` — dokleja fragment mediów `#t=0.001`, który wymusza zdekodowanie i namalowanie
    pierwszej klatki w Safari na iOS przy `preload="metadata"` bez `autoplay`. Plakat z CMS-u wygrywa (początkowe
    przewinięcie do `t` zdjęłoby plakat), adres z własnym fragmentem zostaje nietknięty; fragment nie idzie do
    serwera (cache i transfer bez zmian).
- `BuilderRenderer.tsx` (`SectionBackgroundVideo`, tylko ta funkcja): hook z `inViewOnly` + `src` z fragmentem
  (sekcja nie ma pola plakatu w CMS — `BackgroundSettings` ma tylko `videoUrl` i `videoFallbackColor`).
- `ConversionViews.tsx` (`VideoHeroView`): hook + `src` z fragmentem tylko przy `autoplay` i bez plakatu.
- `SimpleWidgets.tsx`: `AutoplayVideo` i gałąź zwykłego `<video>` zlane w `WidgetVideo` (hook z `enabled=autoplay`;
  fragment tylko przy autoplay — wideo bez autoplay nie stoi za bramką, adres nietknięty).
- Testy: `motionGate.test.tsx` (pomocnik: plakat/fragment; hook: gra dopiero po otwarciu, `enabled=false` nie
  uzbraja, `inViewOnly`: obserwator dopiero po otwarciu, gra w kadrze, pauza poza nim); `mediaMotionGate.test.tsx`
  (VideoHero: bez plakatu `#t=0.001`, z plakatem i bez autoplay adres bez fragmentu); `builderRenderer.section`
  (src tła z fragmentem); `widgetBehavior` (src pliku z autoplay z fragmentem, bez autoplay bez).

### MINOR-3 — AnimatedHeading: wznowienie pętli w fazie gałęzi `forwards` (bez skoku przy wczesnym otwarciu)

- `src/lib/builder/animatedHeadingVariants.tsx`: zamiast „zawsze od stanu narysowanego” pętla wznawia się w fazie,
  którą naprawdę ma gałąź `forwards` w chwili otwarcia. Czas od startu tej animacji (z opóźnieniem) czytany jest z
  `getAnimations({subtree: true})` na owijce kształtu (`shapeElapsedMs`, animacja `aHead-*`; animacja zakończona
  trzyma czas końca). Opóźnienie pętli = `delayMs - min(czas, delayMs + czasRysowania)`: narysowany → `-czasRysowania`
  (jak dotąd), w połowie rysowania → rysuje się dalej z tego miejsca, jeszcze w opóźnieniu → dodatnie resztkowe
  opóźnienie. Pierwszy odcinek obu gałęzi jest identyczny (ten sam czas i krzywa rysowania także dla `scribble`, A
  i B), więc klatka nie skacze. Czas montażu (propozycja recenzji) nie wystarcza: animacja startuje przy pierwszym
  malowaniu HTML-a z SSR, a montaż (hydratacja) bywa sekundy później — odczyt z animacji jest dokładny. Fallback bez
  `getAnimations`/bez animacji = „narysowany” (jak dotąd), animacja jeszcze nierozpoczęta = od zera. Pętla do odczytu
  czeka na gałęzi `forwards` (stan `resumeAtMs`), `resumes` z `useState(!motion)` (pierwszy render: hydratacja =
  `false` z `getServerSnapshot`), nagłówek zamontowany po otwarciu rysuje pętlę od zera.
- Testy `animatedHeadingMotion.test.tsx`: atrapa `getAnimations` — 700 ms → `-500ms`, 50 ms → `150ms`, 5000 ms →
  `-1600ms`, brak czasu → `200ms`; `scribble`: 700 ms → `-500ms`, 9000 ms → `-1760ms` (przycięte do obu kresek).
  Mutacja (stałe „narysowany”) → 5 czerwonych.

### MINOR-4 — typewriter tickera: pierwsza porcja w całości, także w SSR

- `src/components/header/TrendingTicker.tsx` (`TypewriterText`): `useMotionGate()` + `useState(motion)` z pierwszego
  renderu — na serwerze i w hydratacji `false` (`getServerSnapshot`), więc tytuł zamontowany przed otwarciem (w tym
  pierwsza porcja z HTML-a) stoi w CAŁOŚCI od pierwszego malowania i nie pisze się wcale (także po otwarciu). Piszą
  się wyłącznie tytuły montowane po otwarciu, czyli kolejne porcje (timer porcji rusza po otwarciu, `key` = tytuł).
  Zero zmian wizualnych po hydratacji; parytet zachowany także przy zatrzasku otwartym przed hydratacją wyspy.
- Testy `TrendingTicker.test.tsx`: SSR `renderToString` ma pełny tytuł; montaż przed otwarciem — pełny tytuł i zero
  timerów także po otwarciu; integracja: pierwsza porcja stoi, otwarcie nie zaczyna pisania, porcja po otwarciu
  pisze się znak po znaku. Testy cyklu życia timerów (`liczba`/`obiekt`) montują po otwarciu bramki. Mutacja
  (`useState(true)`) → czerwone.

### MINOR-5 — budżety bootu

Zmierzone na artefakcie smoke tej rundy (`check:document-weight` 28/28 zielone, `fix1/document-weight.log`):

| Metryka                    | baza `7c924ae5` | P3.5 `5d667d7e` | P3.5 + fix1 | Δ fix1 | próg (`max`) | zapas |
| -------------------------- | --------------- | --------------- | ----------- | ------ | ------------ | ----- |
| bootClosureRawBytes        | 1 634 852       | 1 636 742       | 1 637 044   | +302   | 1 637 758    | 714 B |
| bootClosureGzipBytes       | 495 036         | 495 907         | 496 041     | +134   | 496 679      | 638 B |
| bootBurstGzipBytes         | 572 652         | 573 741         | 574 034     | +293   | 574 673      | 639 B |
| renderBlockingCssGzipBytes | 80 395          | 80 426          | 80 426      | 0      | 81 399       | —     |
| preLcpTransferBytes        | 177 735         | 177 766         | 177 764     | −2     | 181 594      | —     |

Chunk wejściowy `index`: 863 382 → 863 684 B raw (+302), 264 827 → 264 924 B gz -9 (+97). Odzyskane w tej rundzie:
trzy kopie efektu `play()` wideo (widget, tło sekcji, hero) → jeden hook w `motionGate`, dwie gałęzie `<video>`
widgetu → jeden `WidgetVideo`, `ConversionViews` −139 B (chunk `RichTextView` −59 B raw); uzgodnienie YouTube
odchudzone (bez licznika prób i nasłuchu `load`; −96 B raw względem pierwszej wersji tej rundy). Netto runda kosztuje
+302 B raw / +134 B gz domknięcia — to cena uzgodnienia YouTube (~+230 B raw) i pełnego tytułu typewritera (~+60 B).
Progów nie ruszałem. Tańszego odzysku w obrębie listy plików nie ma: większy (~1,7 KB raw) wymaga wyniesienia
wideo/YouTube/ikony w pętli z `SimpleWidgets` do leniwego chunku przez `lazyWidgets.tsx` (poza listą, patrz
`out_of_ownership_needs`). Orkiestrator sprawdza `check:document-weight` po scaleniu P3.4 + P3.5.

### MINOR-6 — e2e z prawdziwą animacją infinite z SSR: odrzucone (niewykonalne bez zmiany fixture/harnessu)

HTML artefaktu renderuje serwer z danych `replayFetch.mjs` → `homeFixture.ts` → `e2e/fixtures/first-visit.json`;
wariant (np. `layoutStyle: "glassMarquee"`) dałoby się wstrzyknąć wyłącznie po stronie serwera (zmienna procesu
`NES_PERFORMANCE_CASE` jest jedna na serwer `playwright.artifact.config.ts`, a `page.route` w przeglądarce nie
zmienia SSR — podmiana HTML-u bez stanu odwodnionego dałaby niezgodność hydratacji). Wszystkie te pliki są poza
listą P3.5, a zmiana produkcyjnego fixture jest zakazana. Istniejąca asercja `runningInfiniteAnimations() == []`
obejmuje KAŻDĄ nieskończoną animację w dokumencie, więc złapie zgubiony `data-motion-loop`, gdy tylko fixture będzie
taki element miał; sonda dowodzi samej reguły CSS. Propozycja w `out_of_ownership_needs`.

## 2. Bramki (wszystkie w worktree, logi w `fix1/`)

| Bramka                                                                                                                                                                                | Wynik                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bunx prettier --write` / `--check` (14 plików)                                                                                                                                       | zielone                                                                                                                                                                                    |
| `light.sh bunx eslint` (dotknięte `.ts/.tsx`)                                                                                                                                         | 0 błędów, 10 ostrzeżeń `react-refresh/only-export-components` (istniejące eksporty, jak na bazie) — `eslint.log`                                                                           |
| typecheck (mutex; `tools/typecheck-noinc.sh` = te same 3 kroki `bun run typecheck`, `tsgo --incremental false` z powodu wspólnego `tsbuildinfo` w dowiązanym `node_modules`, IMPL §5) | zielone ×2: przebieg 1 po głównych zmianach (`typecheck-1.log`), przebieg 2 po odchudzeniu YouTube (`typecheck.log`; tsgo ~2 min, mutex wolny)                                             |
| `light.sh bunx vitest run` (88 plików: wszystkie testy importujące dotknięte moduły + `src/lib/performance/__tests__` + `animatedHeadingMotion`)                                      | 88/88, 2551 passed + 17 expected fail — `vitest-affected.log` (stan końcowy)                                                                                                               |
| Mutacje (każda cofnięta)                                                                                                                                                              | WorldMap `loopDelay` 0 s / -0 s → czerwone; YouTube bez originu / gra na 1. wiadomości → czerwone; typewriter `useState(true)` → czerwone; AnimatedHeading bez odczytu fazy → 5 czerwonych |
| `light.sh bun run verify:static`                                                                                                                                                      | 15 bramek OK (`verify-static.log`, stan końcowy)                                                                                                                                           |
| `BUNDLE_INVENTORY=1 bun run build:smoke` (mutex)                                                                                                                                      | zielone (`build-smoke.log`; pierwszy build `build-smoke-1.log`)                                                                                                                            |
| `bun run test:e2e:artifact` (mutex)                                                                                                                                                   | 12/12 na buildzie końcowym (`e2e-artifact.log`; także 12/12 na pierwszym, `e2e-artifact-1.log`), w tym `motion-gate.boot-home` ×3                                                          |
| `check:document-weight` (artefakt smoke)                                                                                                                                              | 28/28 zielone (tabela §1 MINOR-5)                                                                                                                                                          |
| `check:bundle`, `check:chunks`, Lighthouse                                                                                                                                            | nie uruchamiane (build produkcyjny/pomiar — etap Prove/orkiestrator); zmiana grafu chunków żadna (nowe importy tylko z `motionGate`, już w bocie)                                          |

## 3. Odstępstwa od planu i od propozycji recenzji

1. **MAJOR-1:** opóźnienie liczone w `WorldMap.tsx` z `timing.drawS` i `ARC_STAGGER_S` (środek okna „wszystko
   narysowane”), a nie dokładnie `-drawS` (to granica `resetPct`, gdzie zaczyna się wygaszanie — po otwarciu łuki
   gasłyby natychmiast, a zaokrąglenie procentów mogłoby wpaść w wygaszanie). `worldMapGeo.ts` nietknięty.
2. **MINOR-1:** wariant „listening + gra po `onReady`” (nie ponawianie `playVideo` do `playerState 1`): ponawianie
   polecenia walczyłoby z czytelnikiem, który zdąży zatrzymać film. Wołanie bez limitu czasu do pierwszej odpowiedzi
   (jak `iframe_api`) zamiast limitu 10 s + `load` — prościej i bez ślepej plamy dla ramek ładujących się > 10 s.
3. **MINOR-3:** faza z `getAnimations()` zamiast czasu od montażu (montaż ≠ start animacji z SSR — patrz wyżej).
4. **MINOR-6:** odrzucone (§1).
5. **Typecheck dwa razy** w tej rundzie (drugi po ostatniej zmianie kodu, tsgo, mutex wolny) — zamiast reguły „raz”,
   żeby commit był sprawdzony w stanie końcowym.

## 4. Ryzyka

- **YouTube:** po `listening` odtwarzacz wysyła stronie strumień `infoDelivery` w trakcie odtwarzania (standardowy
  koszt `iframe_api`; nasłuch strony jest już zdjęty, więc to tylko zdarzenia `message` bez naszego handlera).
  Gdy ramka nigdy nie odpowie (blokada, offline), strona woła co 250 ms do odmontowania — postMessage do ramki
  innego originu, koszt pomijalny. Bez dowodu w prawdziwej przeglądarce z prawdziwym YouTube (sandbox bez sieci do
  YouTube); protokół zgodny z `www-widgetapi` (event `listening`, odpowiedzi `initialDelivery`/`onReady`).
- **`#t=0.001`:** Chrome maluje pierwszą klatkę i tak; fragment nie zmienia żądania. Pętla `loop` po końcu wraca do
  0 (fragment ustawia tylko pozycję początkową). Adres z własnym `#` zostaje nietknięty.
- **AnimatedHeading:** stan pośredni (jeden render z otwartą bramką, zanim efekt odczyta fazę) trzyma gałąź
  `forwards` — bez zmiany klatki; odczyt i przełączenie w tym samym zadaniu (sync lane `useSyncExternalStore`).
- **Budżety bootu:** zapas po rundzie 638–714 B (§1 MINOR-5); P3.4 w tym samym batchu — sprawdzić razem.

## 5. Na co patrzeć w recenzji

1. `WorldMap.tsx` `loopDelay` i test parsujący klatki (`keyframeStateAt`).
2. `YouTubeEmbed` — warunek originu/ramki, `onReady`, sprzątanie efektu.
3. `useGatedVideoAutoplay` vs trzy usunięte kopie (zachowanie wideo tła bez IO i z IO bez zmian; test „brak
   IntersectionObserver nie wywraca renderu” w `builderRenderer.section` zielony).
4. `animatedHeadingVariants.tsx` — `loopDelayFor`, `shapeElapsedMs`, warunek `loop` z `resumeAtMs`.
5. `TypewriterText` — `useState(motion)` i parytet SSR/hydratacji.
