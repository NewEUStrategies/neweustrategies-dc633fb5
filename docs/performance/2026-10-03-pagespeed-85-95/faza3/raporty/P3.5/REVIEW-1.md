# P3.5 (fala 3): recenzja przeciwna rundy poprawek 1

Worktree `$SCRATCH/wt3/P3.5`, gałąź `perf/w3-P3.5`. Recenzowane commity: `75c1109a` (runda poprawek, 14 plików,
+612/−138) na `5d667d7e`, a cały diff `claude/zen-ritchie-hzur21...HEAD` (48 plików) przejrzałem ponownie pod kątem
zakresu. Źródła: `faza3/PLAN-FALI-3.md` §1 i §2 P3.5, `diagnoza/ruch-inwentarz.md`, notatki orkiestratora dla rundy
poprawek, `REVIEW.md` (runda 0), `IMPL-fix1.md`.
Logi tej recenzji są w `$SCRATCH/phase3/wave3/P3.5/review1/`.

**Werdykt: APPROVE.** Nie ma ustaleń blokujących ani poważnych; są 4 drobne. Każdy punkt notatek rundy poprawek jest
zrealizowany albo odrzucony z podanym powodem (MINOR-6). Runda dotyka wyłącznie plików z listy P3.5. Parytet
SSR/hydratacji jest zachowany. Uzgodnienie z YouTube potwierdziła sonda w prawdziwym Chromium z prawdziwym
odtwarzaczem YouTube.

## 1. Bramki uruchomione w recenzji

| Bramka                                                              | Wynik                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `light.sh bunx eslint` (wszystkie 46 dotkniętych plików `.ts/.tsx`) | exit 0: 0 błędów, 21 ostrzeżeń `react-refresh/only-export-components` (te same co na bazie), log `review1/eslint.log`                                                                                                                     |
| `bunx prettier --check` (wszystkie dotknięte pliki)                 | czysto                                                                                                                                                                                                                                    |
| `light.sh bunx vitest run` (23 dotknięte i nowe pliki testów)       | 23/23 plików, 585 passed + 8 expected fail, log `review1/vitest.log`                                                                                                                                                                      |
| `light.sh bun run verify:static`                                    | 15 bramek OK w 260,7 s, log `review1/verify-static.log`                                                                                                                                                                                   |
| `git status` w worktree                                             | czysto, bez zbędnych plików                                                                                                                                                                                                               |
| Stopka commita                                                      | dokładnie `Co-Authored-By: Claude Opus 5.5 …` + `Claude-Session: …/session_018pV9XfFuDnwMxKGJSFfcDg`                                                                                                                                      |
| Sonda YouTube (mutex, `heavy.sh`, Chromium 1194 przez proxy)        | gołe `{"event":"listening"}` dostaje odpowiedzi `initialDelivery` → `onReady` → `infoDelivery`; po `playVideo` odtwarzacz przechodzi w `playerState` −1 → 3 → 1 (gra). Skrypt `review1/ytprobe/probe.cjs`, log `review1/ytprobe/bare.log` |
| typecheck, build, Lighthouse, e2e                                   | nie uruchamiane (poza zakresem recenzji)                                                                                                                                                                                                  |

## 2. Co sprawdziłem i co się obroniło

- **Zakres.** Runda dotyka 14 plików, wszystkie z listy P3.5: `WorldMap`, `SimpleWidgets` (wideo, YouTube),
  `ConversionViews` (VideoHero), `BuilderRenderer` (`SectionBackgroundVideo` i jedna linia importu),
  `TrendingTicker`, `animatedHeadingVariants`, `motionGate` oraz testy obok tych modułów. `worldMapGeo.ts`,
  `lazyWidgets.tsx`, fixture i harness e2e są nietknięte. Nie ma nowych zależności. Komentarze i commit są po polsku.
- **MAJOR-1 (WorldMap) jest naprawiony poprawnie.** Ostatni łuk (`i = n−1`) kończy rysowanie w
  `(n−1)·0,3 + d = drawS − 0,3`, a `resetPct` wypada w `drawS`. Opóźnienie `−(drawS − 0,15)` trafia więc w środek
  okna, w którym klatki łuków mają `dashoffset: 0; opacity: 1`, a klatki iskier mają `opacity: 0` (iskra `n−1` gaśnie
  na `end`). Opóźnienie jest wspólne dla łuków i iskier (harmonogram cyklu się nie zmienia) i deterministyczne
  (`toFixed(3)`), więc HTML jest zgodny z hydratacją. Pauza `data-motion-loop` od pierwszego malowania trzyma mapę z
  trasami. Odstępstwo od propozycji recenzji (`−(drawS − 0,15)` zamiast `−drawS`) jest uzasadnione: `−drawS` to
  granica wygaszania. Test parsuje klatki z wyrenderowanego `<style>` i sprawdza fazę dla 9 ścieżek oraz parytet SSR i
  klienta. Po mentalnym cofnięciu zmiany (`"0s"`) test robi się czerwony: `expect(Number(...)).toBeLessThan(0)`, a faza 0
  leży między klatkami z `dashoffset: 1`.
- **MINOR-1 (YouTube) jest naprawiony, a protokół sprawdziłem na żywo.** Kod `www-widgetapi.js` (pobrany do
  `review1/yt/`) wysyła `listening` z `id` i `channel: "widget"`. Sonda pokazuje, że odtwarzacz odpowiada także na
  gołe `{"event":"listening"}`, a `onReady` przychodzi jako `{"event":"onReady","info":null,"channel":"widget"}`, czyli
  pasuje do warunku `includes('"event":"onReady"')`. Kod sprawdza origin `https://www.youtube.com` i
  `event.source === frame.contentWindow`. Sprzątanie efektu zdejmuje interwał i nasłuch. Adres SSR jest
  deterministyczny, a `enablejsapi=1` pojawia się tylko przy autoplay. Testy sprawdzają mechanizm: obcy origin, obca
  ramka, `initialDelivery` bez gry i dokładnie jedno `playVideo`.
- **MINOR-2 (wideo).** `useGatedVideoAutoplay` dokładnie zastępuje trzy usunięte kopie. Wariant `inViewOnly` zachowuje
  IO z marginesem 200 px. Bez IO wideo gra wprost i pauzuje w sprzątaniu; wcześniej w tym przypadku działał atrybut
  `autoplay`, więc wideo też grało. Fragment `#t=0.001` jest deterministyczny (parytet), nie trafia do serwera i
  ustępuje plakatowi z CMS-u albo własnemu `#` adresu. Natywna pętla `loop` wraca do 0. `BackgroundSettings` nie ma
  pola plakatu, więc dla tła sekcji fragment to jedyna droga.
- **MINOR-3 (AnimatedHeading).** Pierwszy odcinek gałęzi `forwards` i gałęzi pętli jest identyczny: dla zwykłych
  kształtów `0→drawEnd%` z `ease-in-out` trwa `durationMs`, a dla `scribble` A i B mają odcinki `halfDur` z `ease-out`.
  Wzór `delayMs − min(t, delayMs + draw)` daje więc tę samą klatkę. Animacja CSS zakończona z
  `fill: forwards` zostaje w `getAnimations()` i ma `currentTime` równe końcowi efektu, a `min` i tak przycina wynik.
  Stan pośredni (bramka otwarta, `resumeAtMs === null`) zostawia gałąź `forwards` z tą samą nazwą i tym samym
  tekstem CSS, więc animacja się nie restartuje. `useState(!motion)` daje `true` w hydratacji (`getServerSnapshot`)
  i przy montażu SPA przed otwarciem, a `false` przy montażu po otwarciu (pętla od zera). Odstępstwo od propozycji
  (odczyt fazy z animacji zamiast z czasu montażu) jest trafne: animacja startuje przy pierwszym malowaniu HTML-a z
  SSR, a hydratacja przychodzi później.
- **MINOR-4 (typewriter).** `useState(motion)` z pierwszego renderu daje `false` na serwerze i w hydratacji, więc
  pierwsza porcja stoi w całości (`renderToString` ma pełny tytuł), także gdy zatrzask otworzył się przed hydratacją
  wyspy. Porcje montowane po otwarciu (`key` = tytuł) piszą się znak po znaku. Mrugający kursor ma
  `data-motion-loop`. Po hydratacji nie zmienia się nic widocznego, więc nie ma nowej późnej klatki w filmstripie.
  `truncate` / `max-w` chronią układ, więc CLS się nie zmienia.
- **MINOR-5 (budżety).** Progi `document-weight` są nietknięte. Netto runda kosztuje +134 B gz domknięcia bootu, a
  zapas wynosi 638 do 714 B. Odzysk z trzech kopii efektu wideo jest zrobiony. Większy odzysk wymaga
  `lazyWidgets.tsx`, który jest poza listą. Ocenę „tanio” przyjmuję.
- **MINOR-6 (e2e z prawdziwą animacją infinite z SSR) jest odrzucony z powodem.** Sprawdziłem `e2e/fixtures/first-visit.json`:
  fixture nie ma marquee ani kart szklanych, NewsTickera, TrendingNow, mapy, ticker-strip, kręgu ani wideo.
  Wariant SSR wymaga zmiany `homeFixture.ts` albo `replayFetch.mjs`, a oba pliki są poza listą. Powód przyjmuję.
- **Lantern / Speed Index.** Runda usuwa dwie widoczne zmiany w oknie śladu: pisanie tytułu po hydratacji i (od P3.5)
  mapę bez tras. Nie dodaje żadnej nowej późnej zmiany wizualnej. Sonda fazy AnimatedHeading (`getAnimations` wymusza
  przeliczenie stylu) i podmiana `<style>` idą w zadaniu otwarcia bramki, czyli poza śladem.
- **Graf chunków.** Nowe importy prowadzą wyłącznie do `motionGate` (już w domknięciu bootu) i
  `@/lib/a11y/reducedMotion`. Nie ma nowych krawędzi do ciężkich modułów ani cykli.
- **Zalogowani, redaktorzy, EN.** Runda nie dodaje kluczy i18n ani zależności od sesji. W edytorze zmiana adresu
  YouTube po otwarciu nie uruchamia ponownie autoplay (efekt zależy od `[autoplay, motion]`). Dla kanwy to bez
  znaczenia.
- **Proces.** Typecheck był uruchomiony 2 razy zamiast raz (IMPL-fix1 §3.5, ujawnione, mutex był wolny). Nie zgłaszam
  tego jako ustalenia.

## 3. Ustalenia

### MINOR-1: YouTube woła `listening` co 250 ms bez końca, gdy ramka nigdy nie odpowie

- `src/components/builder/organisms/widget-view/SimpleWidgets.tsx:203-221`.
- Dowód: interwał kończy dopiero pierwsza wiadomość z ramki albo odmontowanie. Ramka zablokowana przez rozszerzenie
  prywatności, CSP sieci firmowej albo pracę offline nie odpowiada nigdy. Strona budzi wtedy wątek 4 razy na sekundę
  przez całe życie strony (bateria, licznik zadań w tle). Test „późna odpowiedź po 30 s nadal gra” utrwala ten brak
  limitu.
- Poprawka: limit prób (np. 120 × 250 ms = 30 s) i jedno ponowienie `listening` na zdarzenie `load` ramki. To pokrywa
  ramkę ładującą się długo bez wiecznego timera. Test: po limicie `postMessage` milknie, a `load` wysyła jeszcze raz.

### MINOR-2: `playVideo` po `onReady` nie patrzy na stan odtwarzacza i może wznowić film, który czytelnik sam zatrzymał

- `src/components/builder/organisms/widget-view/SimpleWidgets.tsx:208-214`.
- Dowód: kliknięcie w ramkę innego originu nie otwiera bramki. Czytelnik może więc w ciągu pierwszych 5 do 20 s
  włączyć film w ramce i go zatrzymać. Punkt ciszy otwiera potem bramkę, uzgodnienie dostaje `onReady` i `playVideo`
  wznawia film wbrew czytelnikowi. Przypadek jest rzadki, ale łatwo go wykluczyć: `initialDelivery` niesie
  `info.playerState` (sonda: −1 dla nieruszonego filmu).
- Poprawka: zapamiętać `playerState` z `initialDelivery` i wysłać `playVideo` tylko przy −1 (nierozpoczęty) albo
  5 (wczytany). Przy 1, 2 i 3 nie wysyłać nic. Test: `initialDelivery` z `playerState: 2` i `onReady` → zero `playVideo`.

### MINOR-3: zapas budżetów bootu po scaleniu z P3.4 jest niesprawdzony

- `IMPL-fix1.md` §1 MINOR-5: `bootClosureGzipBytes` 496 041 / 496 679 (zapas 638 B), `bootBurstGzipBytes`
  574 034 / 574 673 (zapas 639 B). Pomiar jest zrobiony na gałęzi bez P3.4, a gałąź PR ma już P3.4 (`b80702e6`,
  loader bootu).
- Ryzyko: suma P3.4 + P3.5 może przekroczyć próg `check:document-weight` albo `check:bundle`. Każda pozycja osobno
  jest zielona.
- Poprawka (proces, orkiestrator): po scaleniu `perf/w3-P3.5` uruchomić `check:document-weight` i `check:bundle` na
  buildzie scalonej gałęzi. Przy przekroczeniu w pierwszej kolejności wynieść wideo, YouTube i `LoopingIcon` z
  `SimpleWidgets` do leniwego chunku (`lazyWidgets.tsx`). Daje to ok. 1,7 KB raw według `IMPL-fix1.md`, a progów nie
  trzeba podnosić.

### MINOR-4: AnimatedHeading uzbraja bramkę i wymusza przeliczenie stylu także dla kształtów bez animacji

- `src/lib/builder/animatedHeadingVariants.tsx:722-735` (`shapeLoops = mode !== "rotate" && loop`).
- Dowód: tryby `hover-underline` i `hover-allsides` oraz kształt `none` nie rysują `ShapeSvg` (`return null`), a mimo
  to przy `loop: true` mają `useMotionGate(true)`. Przy otwarciu bramki odpalają `getAnimations({subtree:true})`, co
  wymusza przeliczenie stylu, i robią jeden zbędny re-render. Tak wygląda nagłówek z fixture `/`
  (`mode: "hover-allsides"`, `loop: true`). Koszt jest mały i leży poza śladem, ale jest zbędny.
- Poprawka: `shapeLoops = mode !== "rotate" && loop && shape !== "none" && !shape.startsWith("hover-")`. To ten sam
  warunek co wczesne `return null` w `ShapeSvg`. Test: `hover-allsides` z `loop` → po otwarciu `getAnimations` nie
  jest wołane.

## 4. Uwagi do opisu PR (bez zmian w kodzie)

- Mapa w trybie pętli stoi od pierwszego malowania z narysowanymi trasami. Po otwarciu bramki trasy po ok. 0,15 s
  gasną i rysują się od nowa, czyli biegnie zwykły cykl pętli.
- Tytuł `typewriter` z pierwszej porcji już się nie pisze. Piszą się tylko porcje, które przychodzą po interakcji
  albo ciszy.
- Autoplay YouTube idzie przez uzgodnienie `iframe_api` (`listening` → `onReady` → `playVideo`), potwierdzone sondą
  w Chromium. Safari nie było sprawdzane.
