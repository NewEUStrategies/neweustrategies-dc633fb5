# P3.5 (fala 3) — bramka ruchu: autoplay, tickery i animacje treści dopiero po interakcji albo ciszy

Worktree: `$SCRATCH/wt3/P3.5`, gałąź `perf/w3-P3.5` (baza `claude/zen-ritchie-hzur21` @ `c606bfa4` = `7c924ae5` + dokumenty
fali 3). Źródła wymagań: `faza3/PLAN-FALI-3.md` §2 P3.5, `faza3/diagnoza/ruch-inwentarz.md`, notatki orkiestratora.
Commit: `5d667d7ea177c3442d32b17324184a7502d853c3` (jeden commit na gałęzi).

## 1. Mechanizm w skrócie

- **Jeden zatrzask na dokument** (`src/lib/performance/interactionOrQuiet.ts`): otwiera go pierwsza interakcja
  (kolejka P0.3 `enqueue(open, {priority: "overlays"})` — po końcu gestu i po klatce) albo punkt ciszy
  (`onQuiescent(open, {priority: "overlays"})`), cokolwiek pierwsze; potem zostaje otwarty. Uzbraja się leniwie przy
  pierwszym subskrybencie i nigdy się nie rozbraja (remount/StrictMode nie zaczynają czekania od nowa). W prerenderze
  nic się nie uzbraja (`afterPrerendering`), a otwarcie w dokumencie prerenderowanym jest ignorowane. Serwer: no-op.
  API: `onInteractionOrQuiet(cb) -> cancel` (spóźniony subskrybent dostaje callback w mikrozadaniu),
  `useInteractionOrQuiet(enabled?)` (`useSyncExternalStore`: `false` na serwerze i w renderze hydratacji przez
  `getServerSnapshot`, `true` od otwarcia; komponent zamontowany już po otwarciu dostaje `true` od razu),
  `isInteractionOrQuietOpen()`. To prymityw dla P3.8 (tylko import).
- **Bramka ruchu** (`src/lib/performance/motionGate.ts`) na tym zatrzasku: `useMotionGate(enabled?)` — ten sam stan,
  a subskrypcja (faza commit) raz na dokument dopisuje zapis `data-motion="on"` na `<html>` przy otwarciu (poza
  Reactem: atrybutu nie ma w HTML-u ani w drzewie Reacta, więc hydratacja go nie porównuje). `MOTION_IDLE_TICK_MS`
  (60 s) dla odliczań.
- **CSS**: jedna reguła w `src/styles.css`:
  `:root:not([data-motion="on"]) [data-motion-loop] { animation-play-state: paused !important; }`.
  Element z nieskończoną animacją treści obecną w HTML-u z SSR nosi `data-motion-loop` — stoi w PIERWSZEJ klatce od
  pierwszego malowania (arkusz blokujący), więc samo otwarcie nie zmienia klatki; po otwarciu reguła przestaje pasować,
  a pauza pod kursorem (inline `animationPlayState`) i `prefers-reduced-motion` (`animation: none !important`) działają
  jak dotąd. `!important` wygrywa ze stylem inline (`animation` w atrybucie `style`). Selektor ma prawy człon
  atrybutowy (kubeł atrybutu, bez uniwersalnego `*`), więc nie kosztuje przeliczenia stylu całego dokumentu.
- **Timery JS** zakładają się dopiero na `motion === true`, więc pierwsza zmiana = otwarcie + PEŁNY interwał.
  Każdy konsument woła hook (także te czysto CSS-owe), więc bramka uzbraja się na każdej stronie, na której jest ruch.

## 2. Zmiany plik po pliku

| Plik                                                                                                      | Zmiana                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/performance/interactionOrQuiet.ts` (nowy)                                                        | zatrzask (opis wyżej), haki testowe `__openInteractionOrQuietForTests`/`__resetInteractionOrQuietForTests` (konwencja P0.3).                                                                                                                                                                                                                                                                                                                                                             |
| `src/lib/performance/motionGate.ts` (nowy)                                                                | `useMotionGate`, zapis atrybutu, `MOTION_IDLE_TICK_MS`, `__openMotionGateForTests`/`__resetMotionGateForTests`.                                                                                                                                                                                                                                                                                                                                                                          |
| `src/styles.css`                                                                                          | wyłącznie wspólna reguła bramki (z komentarzem); reguły ticker-strip bez zmian (bramkowane atrybutem).                                                                                                                                                                                                                                                                                                                                                                                   |
| `src/lib/builder/sliderVariants.tsx` (**hero, priorytet**)                                                | `SliderRender`: `useMotionGate(autoplayWanted)`; efekt `setInterval` startuje tylko przy `motion` i bez `prefersReducedMotion()` (dodane — timer go ignorował); zależności efektu uproszczone (`autoplayWanted` zamiast `preview/autoplay/items.length`).                                                                                                                                                                                                                                |
| `src/components/header/TrendingTicker.tsx` (**priorytet, ścieżki a–e**)                                   | `useDecorativeMotion` usunięty → `useMotionGate()` (wspólny zatrzask); (a/b) `setInterval` porcji tylko przy `motion`; (b) kursor `typewriter` z `data-motion-loop`; (c) tor marquee i (d) tor kart z `data-motion-loop`; (e) `data-tt-motion` zostaje jako alias bramki (podnosi specyficzność reguł wyłączanych przez blok reduced motion; e2e `header-intent` bez zmian). Komentarz „RUCH PASKA” opisuje ścieżki.                                                                     |
| `NewsTickerView.tsx`                                                                                      | tor pionowy i poziomy oraz „ping” etykiety z `data-motion-loop`; `useMotionGate()` w obu torach (uzbrojenie).                                                                                                                                                                                                                                                                                                                                                                            |
| `TrendingNowView.tsx`                                                                                     | tor z `data-motion-loop` (gdy jest animacja); `useMotionGate(rows.length > 1)` przed wczesnym `return`.                                                                                                                                                                                                                                                                                                                                                                                  |
| `PostListView.tsx`                                                                                        | `PostListCarousel`: `running` także `&& motion`; do otwarcia tor ma `data-autoplay="paused"` (tak samo w SSR — parytet).                                                                                                                                                                                                                                                                                                                                                                 |
| `InteractiveCircleWidget.tsx`                                                                             | autoplay tylko przy `motion` i bez `prefersReducedMotion()` (dodane); obrót/puls łuku SVG i „ping” aktywnej pozycji z `data-motion-loop`.                                                                                                                                                                                                                                                                                                                                                |
| `EventCountdownView.tsx`, `EventCountdownCardView.tsx`, `blocks/InteractiveViews.tsx` (`CountdownView`)   | pierwsze „teraz” po montażu jak dotąd (osobny efekt); takt: do otwarcia `MOTION_IDLE_TICK_MS` (60 s — cyfra sekund stoi, po pełnej minucie ma tę samą wartość), po otwarciu 1 s (albo 30 s bez sekund). Samo otwarcie niczego nie przelicza — pierwszy takt sekundę później.                                                                                                                                                                                                             |
| `SimpleWidgets.tsx`                                                                                       | tylko wideo i ikona: `LoopingIcon` (ikona `spin/pulse/bounce` z `data-motion-loop` + hook); `AutoplayVideo` (plik: bez atrybutu `autoplay`, `muted`, `play()` po otwarciu); `YouTubeEmbed` (patrz odstępstwo 2).                                                                                                                                                                                                                                                                         |
| `ui/circular-carousel.tsx`, `ui/progressive-carousel.tsx`, `ui/text-rotate.tsx`, `ui/signup-showcase.tsx` | warunek rotacji/`autoPlay` `&& motion` (pasek ProgressSlider stoi na 0 do otwarcia; dobieg po kliknięciu działa niezależnie).                                                                                                                                                                                                                                                                                                                                                            |
| `lib/builder/animatedHeadingVariants.tsx`                                                                 | rotacja słów tylko przy `motion` i bez `prefersReducedMotion()` (dodane); pętla kształtu: do otwarcia gałąź `forwards` (rysuje raz i zostaje, także w SSR), po otwarciu pętla z NOWĄ nazwą klatek (`aHead-loop-*`; zmiana samego czasu trwania zachowałaby czas startu animacji z pierwszego malowania i kształt przeskoczyłby w losową fazę) i ujemnym opóźnieniem = czas rysowania, czyli od stanu „narysowany” (`resumeLoop`); nagłówek zamontowany po otwarciu rysuje pętlę od zera. |
| `lib/builder/sectionLabelVariants.tsx`                                                                    | tylko ticker-strip: kropka i halo w `TickerStripPulse` z `data-motion-loop` + hook. Kinetic Signal Notch nietknięty.                                                                                                                                                                                                                                                                                                                                                                     |
| `components/post/RelatedPosts.tsx`                                                                        | `RelatedSlider`: autoplay tylko przy `motion`, bez `prefersReducedMotion()` (dodane), od 2 wpisów.                                                                                                                                                                                                                                                                                                                                                                                       |
| `components/blocks/MarketingViews.tsx`                                                                    | `ImageCarouselView`: autoplay `&& motion`.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `components/blocks/ConversionViews.tsx`                                                                   | `VideoHeroView`: bez atrybutu `autoplay` w HTML-u, wyciszone `play()` po otwarciu (ponownie przy zmianie `src`).                                                                                                                                                                                                                                                                                                                                                                         |
| `builder/organisms/BuilderRenderer.tsx`                                                                   | tylko `SectionBackgroundVideo`: bez `autoplay`, IO zakładany po otwarciu (bez IO — `play()` wprost), `muted` przed `play()`, ponownie przy zmianie `src`.                                                                                                                                                                                                                                                                                                                                |
| `components/maps/WorldMap.tsx`                                                                            | pętla łuków, iskier i puls znaczników z `data-motion-loop` (jednorazowe rysowanie `loop={false}` bez znacznika — skończone, rusza jak dotąd); `useMotionGate(animated)`.                                                                                                                                                                                                                                                                                                                 |
| `e2e/motion-gate.boot-home.spec.ts` (nowy)                                                                | patrz §3 i odstępstwo 1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Testy (zmienione / nowe): `interactionOrQuiet.test.tsx` (14), `motionGate.test.tsx` (4), `sliderDisplaySettings`,
`TrendingTicker.test` + `.motion.test`, `relatedPostsLayouts`, `circularCarousel`, `progressiveCarousel`, `textRotate`,
`signupShowcase` + `Performance`, `postListBylineAndCarousel`, `interactiveCircleWidget`, `builderRenderer.section`,
`widgetBehavior` (wideo/YouTube), `eventWidgets`, `eventCountdownCard`, `dataViews` (NewsTicker/TrendingNow),
`WorldMap.test`, nowe `animatedHeadingMotion`, `sectionLabelTickerStrip`, `blocks/countdownMotionGate`,
`blocks/mediaMotionGate`. Wzorzec: „bramka zamknięta: 30 s bez zmiany (krokami po 0,5–1 s — pojedynczy skok 30 s
wracał po pełnych obrotach pętli na pierwszy slajd i maskował brak bramki), po otwarciu zmiana dokładnie po
interwale”; reduced motion = brak autoplay (slider, koło, RelatedSlider, rotacja nagłówka). Punkt ciszy w testach
konsumentów jest atrapą `vi.mock("@/lib/performance/whenQuiescent")` (prawdziwy detektor otworzyłby bramkę po ~5 s
fałszywego czasu); otwarcie przez `__openMotionGateForTests()`.

## 3. Bramki i wyniki

| Bramka                                                                                                               | Wynik                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bunx prettier --write` / `--check` (48 plików)                                                                      | zielone                                                                                                                                                                                                                                                                                                                                           |
| `bunx eslint` (wszystkie dotknięte)                                                                                  | 0 błędów; 21 ostrzeżeń `react-refresh/only-export-components` — identycznie na bazie                                                                                                                                                                                                                                                              |
| `bun run typecheck`                                                                                                  | zielone, ale uruchomione skryptem `tools/typecheck-noinc.sh` (te same 3 kroki, `tsgo --noEmit --incremental false`) — patrz §5 ryzyko „OOM”; `typecheck-3.log`                                                                                                                                                                                    |
| `bunx vitest run` (153 pliki: wszystkie testy importujące dotknięte moduły + nowe + `src/lib/performance/__tests__`) | 4416 passed, 41 expected fail, 0 failed (`affected-run2.log`); dodatkowo 14 plików z odwołaniami do kolejki/ciszy/autoplay: 464 passed                                                                                                                                                                                                            |
| Kontrole negatywne (mutacje, każda cofnięta, `mutate.py`)                                                            | 22/22 łapane: zdjęcie `motion` z warunku w slider/ticker/circular/progress/textRotate/signup/postList/koło/related/nagłówek/karuzela/VideoHero/3 odliczania/wideo tła/wideo/ticker-strip, zdjęcie reduced motion (koło, related, nagłówek), pętla nagłówka bez bramki, `getServerSnapshot` = stan, otwarcie w prerenderze, YouTube z `autoplay=1` |
| `bun run verify:static`                                                                                              | 15 bramek OK w 251 s (`verify-static-1.log`)                                                                                                                                                                                                                                                                                                      |
| `bun run build:smoke` (mutex)                                                                                        | zielone, 2 min 12 s                                                                                                                                                                                                                                                                                                                               |
| `bun run test:e2e:artifact`                                                                                          | 12/12 (boot-artifact, boot-home pl/en + sesja, boot-timing ×3, nowy `motion-gate.boot-home` ×3) — `e2e-artifact-2.log`                                                                                                                                                                                                                            |
| Kontrola negatywna e2e: ten sam spec na artefakcie bazy (`NES_ARTIFACT_ROOT=base-w3`)                                | 3/3 czerwone, jak trzeba: hero przeskoczył 2× w 12 s, brak `data-motion`, sonda `running` (`e2e-motion-base-negative.log`)                                                                                                                                                                                                                        |
| `e2e-performance/header-intent.spec.ts` (alias `data-tt-motion`, reduced motion paska)                               | 10/10                                                                                                                                                                                                                                                                                                                                             |
| `check:document-weight` (artefakt smoke)                                                                             | 28/28 zielone; wobec bazy: `bootClosureGzipBytes` +859 B (zapas 745 B), `bootBurstGzipBytes` +1060 B (zapas ~957 B), CSS blokujący +31 B gz, HTML gz +7 B, `preLcpTransferBytes` +38 B; `htmlRawBytes`, `headRawBytes`, `inlineStyleBytes` bez zmian                                                                                              |
| `check:bundle`, `check:chunks`, `check:entry-purity`                                                                 | NIE uruchamiane (wymagają `bun run build` — produkcyjnego, poza tym etapem); do etapu Prove                                                                                                                                                                                                                                                       |
| Lighthouse `--compare`                                                                                               | NIE uruchamiany (etap Prove)                                                                                                                                                                                                                                                                                                                      |

Uwaga: po buildzie smoke dodałem jeszcze `src` do zależności efektów trzech wideo (VideoHero, wideo widgetu, wideo tła
— ponowne `play()` przy zmianie źródła); prettier, eslint i testy tych modułów zielone po zmianie, typecheck i build
były przed nią (zmiana nie dotyka typów).

## 4. Odstępstwa od planu

1. **Nazwa speca e2e: `e2e/motion-gate.boot-home.spec.ts` zamiast `e2e/motion-gate.spec.ts`.**
   `playwright.artifact.config.ts` bierze wyłącznie `testMatch: /boot-(artifact|timing|home)\.spec\.ts$/`, a
   `playwright.config.ts` (e2e na dev-serverze, CI `e2e.yml`) ignoruje DOKŁADNIE ten wzorzec. Plik `motion-gate.spec.ts`
   nie pojechałby w `test:e2e:artifact`, za to pojechałby na dev-serverze bez artefaktu. Nazwa z sufiksem
   `boot-home.spec.ts` trafia w zestaw artefaktu bez zmiany konfiguracji (poza listą plików). Jeśli orkiestrator woli
   `motion-gate.spec.ts`, trzeba dopisać wzorzec w OBU konfiguracjach (patrz `out_of_ownership_needs`).
2. **Scenariusz „12 s bez interakcji” ma utrzymanie ruchu sieci.** Punkt ciszy zapada ≥ 5 s po `load` (mechanizm planu),
   więc na cichej stronie bramka otwiera się w oknie 12 s i hero przeskakuje ~4,5 s później — dosłowne „12 s bez zmian”
   przeczyłoby mechanizmowi. Scenariusz 1 trzyma więc sieć zajętą (`/favicon.ico?…` co 1 s, wzorzec
   `third-party-quiescence`), a osobny scenariusz 2 sprawdza ciszę naturalną: brak zmian przed otwarciem i pierwszy
   przeskok ≥ otwarcie + 4500 ms − 250 ms. Scenariusz 3: `page.mouse.wheel` → `data-motion="on"` ≤ 2 s, sonda
   `running`, przeskok po interwale.
3. **YouTube: `playVideo` przez `postMessage`, nie „URL z `autoplay=1` po otwarciu”.** Zmiana `src` po otwarciu
   przeładowałaby ramkę i zrestartowała film, który czytelnik sam włączył wewnątrz ramki (kliknięcie w ramkę innego
   originu nie dociera do bramki, więc bramka mogła otworzyć się później ciszą). Adres od początku ma `enablejsapi=1` i
   `mute=1` (bez `autoplay=1`); po otwarciu strona wysyła odtwarzaczowi `{"event":"command","func":"playVideo"}` od
   razu i ponownie przy `load` ramki (ramka mogła się załadować przed hydratacją). Ryzyko: polecenie wysłane, zanim
   odtwarzacz je przyjmie, przepada — wtedy czytelnik widzi zwykły odtwarzacz z przyciskiem (łagodna awaria).
4. **WorldMap: pauza w pierwszej klatce zamiast „AND w `animated`”** (diagnoza). Wyłączenie `animated` do otwarcia
   rysowałoby łuki statycznie, a otwarcie startowałoby animację od klatki 0% (łuk ukryty) — skok w chwili otwarcia.
   Pauza pętli w pierwszej klatce spełnia „samo otwarcie nie zmienia klatki”. Koszt: przy pętli łuki są do otwarcia
   niewidoczne (klatka 0% = przed rysowaniem); kropki lądu i znaczniki są widoczne. Jednorazowe rysowanie
   (`loop={false}`) nie jest bramkowane.
5. **Ticker: `data-tt-motion` zostaje jako alias** (plan na to pozwala) — sterowany wspólną bramką; reguły ozdobne w
   `TICKER_CSS` bez zmian, więc `header-intent` i bloki reduced motion działają bez przepisywania.
6. **Pętla `AnimatedHeading`**: oprócz „gałęzi bez pętli do otwarcia” (plan) — wznowienie pętli od stanu „narysowany”
   z nową nazwą klatek (inaczej otwarcie zmieniałoby klatkę).
7. **`useInteractionOrQuiet` daje `true` od pierwszego renderu komponentu montowanego PO otwarciu** (poza hydratacją).
   Plan mówi „false w pierwszym renderze klienta” — w sensie parytetu hydratacji to jest spełnione
   (`getServerSnapshot`), a późniejsze montowanie (nawigacja SPA) nie czeka drugi raz na fakt dokumentu.

## 5. Ryzyka i zmiany widoczne

- **Zmiana zachowania (do opisania w PR):** hero, karuzele, tickery, rotatory, pętle kształtów, mapa, wideo z
  autoplay i sekundnik odliczań nie ruszają, dopóki czytelnik czegoś nie dotknie (dotyk, klik, klawisz, kółko,
  przewinięcie dokumentu) albo strona się nie uspokoi (≥ 5 s po `load` i 5 s ciszy, limit 20 s). Pierwszy krok
  pełny interwał po otwarciu. Bez JS (lub gdy boot padnie) pętle CSS stoją w pierwszej klatce.
- **Lighthouse/PSI:** w śladzie bramka zostaje zamknięta (brak interakcji, cisza zapada po końcu śladu), więc znika
  przeskok hero w ~4,5–8 s (diagnoza: ~+0,8 s obsSI ≈ +1,1 s SI mobile na produkcji). Harness lokalny tej kary nie
  odtwarza (plan §1) — dowód strukturalny: e2e + kontrola negatywna na bazie.
- **Budżety:** `bootClosureGzipBytes` i `bootBurstGzipBytes` zostały z zapasem ~0,75 / ~0,96 KB gz — kolejne pozycje
  fali powinny to widzieć. `check:bundle` (zapas OVERALL 20 KB) do sprawdzenia w Prove.
- **OOM `tsgo`:** `node_modules` w worktree to dowiązanie do checkoutu głównego, a `tsconfig.json` trzyma
  `tsBuildInfoFile` w `node_modules/.cache` — WSPÓLNY dla wszystkich worktree. Dwa przebiegi `bun run typecheck`
  zabił cgroup OOM (`tsgo` 13,4 / 13,9 GB RSS; `dmesg`) przy cache'u zapisanym przez inny worktree (P3.4). Z
  `--incremental false` przeszło. Zalecenie dla orkiestratora: w kolejnych agentach `tsgo --incremental false` albo
  osobny `--tsBuildInfoFile` w scratchpadzie.
- **Ticker-strip, ikona `spin`, mapa, NewsTicker w wyspie sekcji:** stoją do hydratacji wyspy, jeśli nic innego nie
  uzbroiło bramki (atrybut na `<html>` jest wspólny, więc gdy jakikolwiek konsument ją otworzy, ruszają też pętle w
  nieuwodnionych wyspach).
- Poza zakresem (zgodnie z planem/listą plików): StoryViewer, `useNowMs`, szkielety, `LiveBlogBlock` `animate-pulse`,
  `routes/live.tsx` `animate-ping`, chmura logotypów `lc-track` w `SimpleWidgets` (lista pozwala tam tylko na wideo i
  ikonę), `NewsletterDocRenderer` (odliczanie), `CareersValues`. Chmura logotypów i `animate-ping` w `live.tsx` to
  nieskończony ruch w HTML-u z SSR — kandydaci na dopisanie `data-motion-loop` w kolejnej pozycji.

## 6. Na co patrzeć w recenzji

1. `interactionOrQuiet.ts`: kolejność „uzbrojenie po aktywacji prerenderu”, `fire` zdejmujący drugi tor, brak
   rozbrajania, mikrozadanie dla spóźnionych subskrybentów.
2. `useSyncExternalStore` w `useMotionGate`: `getServerSnapshot` = `false` (test hydratacji przy otwartym zatrzasku
   bez `onRecoverableError`).
3. Reguła CSS i `!important` wobec stylu inline / hover / reduced motion (e2e: sonda `paused` → `running`).
4. `AnimatedHeading` — nazwy klatek `aHead-draw-*` vs `aHead-loop-*` i ujemne opóźnienie.
5. YouTube `postMessage` (odstępstwo 3) i wideo bez `autoplay` w SSR.
6. Nazwa speca e2e (odstępstwo 1).
