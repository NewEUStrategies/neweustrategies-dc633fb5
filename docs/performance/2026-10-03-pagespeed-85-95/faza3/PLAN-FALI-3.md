# Plan fali 3: Speed Index i Core Web Vitals na mobile i desktop (2026-10-08)

Dokument orkiestratora. Jest NADRZĘDNY wobec `faza1/PLAN.md` tam, gdzie się różnią. Pozycje P3.1–P3.4 z planu
głównego zostają z tymi samymi identyfikatorami (z poprawkami poniżej), nowe pozycje dostają numery P3.5–P3.11.
Diagnoza, na której stoi ten plan, jest w `diagnoza/` (pliki wymienione przy pozycjach).

## 0. Stan wejściowy

- Fala 2 (PR #476) jest scalona do `main` (2026-10-06) i wdrożona. Baza fali 3 = `origin/main` `7c924ae5`
  (fala 2 + PR #481–#484). Bramka W2 była niezaliczona (`../faza2/STAN-FALI-2.md` §6); właściciel wdrożył mimo to.
- Pomiar produkcji 2026-10-08 (Lighthouse 13.5 z kontenera, kolonia IAD, ustawienia PSI; `diagnoza/stan-wejsciowy.md`):
  mobile 85–87 przy HIT (FCP 1,9–2,2 s, LCP 3,0–3,25 s, SI 3,0–4,0 s, TBT 190–290 ms), desktop 80–97
  (TTFB 0,9–1,3 s = MISS we wszystkich przebiegach, SI 1,8–2,6 s, LCP do 2,5 s, CLS do 0,016).
- Baza lokalna (fixture, ramię bot, n = 3): mobile 93 (TBT 55–359 ms), desktop 100, desktop4x 81 (TBT 346–475 ms).
  Księga: `ScriptCatchup` 101 / 181 ms, `Script:(dokument)` z wymuszonym Style+Layout (K4i) 146 ms na desktop4x,
  `Style` 70 ms na mobile.
- CrUX nie ma danych dla originu, więc Core Web Vitals ocenia się wyłącznie laboratoryjnie (LCP, CLS, TBT jako
  zastępnik INP).

## 1. Model Speed Index (Lighthouse 13, Lantern) i co z niego wynika

- `SI = max(FCP, a·obsSI + b·layoutSI)`; mobile (RTT 150 ms): a = 1,4, b = 0,4; desktop (RTT 40 ms): a ≈ 0,575,
  b ≈ 0,49. `obsSI` = prawdziwy filmstrip przebiegu (bez dławienia); `layoutSI` = średnia ważona `log2(czas)` KOŃCÓW
  zadań CPU ≥ 10 ms zawierających `Layout` w symulacji.
- Produkcja: mobile layoutSI ≈ 3,55 s, obsSI 1,1–1,85 s; desktop obsSI 2,1–2,3 s (TTFB MISS) i layoutSI 1,1–1,4 s.
- Dźwignie SI w kolejności wpływu:
  1. **Późne zmiany wizualne w filmstripie** (autoplay hero, ticker). Speedline mierzy postęp wobec OSTATNIEJ klatki;
     przeskok slajdu w 8,1 s trzymał postęp na 85% od 1,06 s (`diagnoza/ruch-inwentarz.md`): +0,8 s obsSI ≈ +1,1 s SI.
  2. **TTFB dokumentu** (MISS 0,9–3,9 s) wchodzi do obsSI z wagą 1,4 / 0,575 (`diagnoza/cache-dokumentu.md`).
  3. **Arkusz blokujący** (542 KB raw / 78,8 KB gz, jeden plik) i dokument (500 KB raw) opóźniają pierwszą klatkę.
  4. **Długie zadania z Layout po FCP** (wymuszony układ loadera, pierwsza klatka stylu/układu, hydratacja) — layoutSI.
- Harness lokalny NIE odtwarza kary za autoplay (fixture ładuje się w ~1 s, ślad kończy się ~1 s po ciszy) ani za MISS
  (L1 lokalnie zawsze HIT). Dowody dla P3.5 i P3.6 są strukturalne (testy, e2e, sondy produkcyjne po wdrożeniu).

## 2. Pozycje

Każda pozycja ma LISTĘ PLIKÓW (jedyne pliki, które wolno zmienić; nowe pliki testów obok modułu są dozwolone),
mechanizm, kryteria dowodu i ryzyka. Wspólne reguły: `faza1/PLAN.md` §1.3 (inwarianty Lantern) i §2 (protokół),
AGENTS.md, polski w komentarzach i commitach, zero nowych zależności, parytet SSR/hydratacji.

### P3.4 [MUST] Stopniowany burst bootu + K4i (loader bez wymuszonego układu)

- **Pliki:** `src/lib/boot/bootLoaderScript.ts`, `src/lib/boot/bootSet.server.ts`, `src/lib/boot/__tests__/*`,
  e2e bootu w `e2e/` (istniejące specyfikacje boot-timing/first-visit, jeśli dotyczą).
- **Mechanizm:** (a) K4i: handler DCL `Y` nie mierzy pola kandydata `getBoundingClientRect` (wymusza pełny Style+Layout
  dokumentu w zadaniu DCL: 98 ms obs. na desktop4x). Pole kandydata liczone leniwie w callbacku
  `PerformanceObserver` LCP (układ jest wtedy czysty — po prezentacji klatki) albo w `setTimeout` po pierwszym rAF;
  ścieżka `nocand` (brak kandydata) bez geometrii (sama obecność `img[data-lcp-candidate]`), a „kandydat poza
  ekranem” rozstrzygany w callbacku. Zachować semantykę wyzwalaczy (`now`/`lcp`/`input`/`nocand`/`load`/`cap`) i
  WEJŚCIE PO PARSOWANIU. Sprawdzić też koszt `MutationObserver(subtree)` na całym dokumencie podczas parsowania; jeśli
  zestaw można odczytać bez niego (np. węzeł zestawu przed loaderem albo odczyt przy DCL), usunąć obserwatora.
  (b) P3.4 wg `faza1/PLAN.md`: `modulepreload` w trzech grupach w osobnych zadaniach (`setTimeout(0)` między grupami):
  (1) domknięcie wejścia (vendory + entry), (2) słownik języka + chunk trasy, (3) chunki widgetów nad zgięciem;
  wejście dopiero po zażądaniu ostatniej grupy. Grupy wyznacza serwer w `bootSet.server.ts` (JSON zestawu dostaje
  grupy; format zgodny wstecz dla loadera). Jeśli pomiar pokaże, że dokończenia kompilacji i tak lądują w jednym
  zadaniu, zostaje (a), a (b) jest wycofane z raportem.
- **Dowód:** księga `--compare` mobile, desktop4x, desktop5x, n = 5: `Script:(dokument)` z Style/Layout znika z okna
  albo spada < 50 ms sym. we wszystkich przebiegach B; `ScriptCatchup` dzieli się na zadania < 50 ms sym. (albo
  raport, że nie); FCP/LCP ±0,02 s; CLS ≤ 0,001; kierunek ΔTBT < 0. Testy: kolejność grup, wejście po ostatniej
  grupie i po DCL, tryb `now` bez czekania, brak `getBoundingClientRect` w handlerze DCL.
- **Ryzyko:** martwy boot (wejście przed ogonem dokumentu) — e2e artefaktu (`bun run test:e2e:artifact`) obowiązkowe.

### P3.5 [MUST-SI] Bramka ruchu: autoplay, tickery i animacje treści dopiero po interakcji albo ciszy

- **Diagnoza:** `diagnoza/ruch-inwentarz.md` (wszystkie miejsca z `plik:linia`).
- **Pliki:** nowy `src/lib/performance/interactionOrQuiet.ts` (wspólny zatrzask „pierwsza interakcja ALBO punkt ciszy”,
  uogólnienie `useDecorativeMotion` z `TrendingTicker.tsx:102-114`: `onInteractionOrQuiet(cb)`, hook
  `useInteractionOrQuiet()` — `false` na serwerze i w pierwszym renderze klienta) i nowy
  `src/lib/performance/motionGate.ts` (bramka ruchu na tym zatrzasku: ustawia `data-motion="on"` na `<html>` przy
  otwarciu; hook `useMotionGate()`), ich testy; konsumenci: `src/lib/builder/sliderVariants.tsx`,
  `src/components/header/TrendingTicker.tsx`, `src/components/builder/organisms/widget-view/NewsTickerView.tsx`,
  `TrendingNowView.tsx`, `PostListView.tsx`, `InteractiveCircleWidget.tsx`, `EventCountdownView.tsx`,
  `EventCountdownCardView.tsx`, `SimpleWidgets.tsx` (tylko wideo/YouTube autoplay i ikona `spin`),
  `src/components/ui/circular-carousel.tsx`, `src/components/ui/progressive-carousel.tsx`,
  `src/components/ui/text-rotate.tsx`, `src/components/ui/signup-showcase.tsx`, `src/lib/builder/animatedHeadingVariants.tsx`,
  `src/lib/builder/sectionLabelVariants.tsx` (tylko ticker-strip), `src/components/post/RelatedPosts.tsx`,
  `src/components/blocks/MarketingViews.tsx`, `src/components/blocks/InteractiveViews.tsx` (odliczanie),
  `src/components/blocks/ConversionViews.tsx` (VideoHero), `src/components/builder/organisms/BuilderRenderer.tsx`
  (TYLKO `SectionBackgroundVideo`), `src/components/maps/WorldMap.tsx`, `src/styles.css` (tylko reguły animacji
  ticker-strip i ewentualny wspólny selektor bramki), testy tych modułów.
- **Mechanizm:** jeden zatrzask: otwiera się przy pierwszej interakcji (`onFirstInteraction` przez kolejkę
  `enqueue(..., {priority: "overlays"})`) albo w punkcie ciszy (`onQuiescent`), nigdy w prerenderze. Timery JS
  (slidery, karuzele, tickery, rotatory) startują DOPIERO po otwarciu i odliczają pełny interwał od chwili otwarcia
  (pierwsza zmiana = otwarcie + interwał). Animacje CSS `infinite` treści obecne w HTML z SSR (marquee/karty tickera,
  NewsTicker, TrendingNow, ticker-strip, pętle AnimatedHeading) mają `animation-play-state: paused` (albo gałąź bez
  pętli), dopóki na `<html>` nie ma `data-motion="on"`; samo otwarcie bramki nie zmienia wyglądu klatki.
  Odliczania: do otwarcia tykanie minutowe (cyfra sekund stoi). Wideo autoplay: `play()`/URL z `autoplay=1` po
  otwarciu. `useDecorativeMotion` tickera przechodzi na wspólną bramkę (`[data-tt-motion]` może zostać jako alias,
  jeśli upraszcza CSS). Reduced motion: istniejące zachowania bez zmian; tam, gdzie timer go ignorował
  (SliderRender, AnimatedHeading, InteractiveCircle, RelatedSlider), dodać `prefersReducedMotion()` →
  bez autoplay. Poza zakresem: StoryViewer (`/web-stories/$slug`), Kinetic Signal Notch (nie ma ruchu nieskończonego),
  szkielety ładowania, odliczania 30 s (`useNowMs`).
- **Dowód:** testy jednostkowe (fake timers): przed otwarciem bramki zero przełączeń slidera/tickera przez 30 s;
  po otwarciu pierwsze przełączenie dokładnie po interwale; prerender/serwer = zamknięta; reduced motion = brak
  autoplay. E2E (Playwright, build artefaktu, fixture `first-visit`): `/` bez interakcji przez 12 s → indeks slajdu hero
  i paczka tickera bez zmian, `document.getAnimations()` treści w stanie `paused`; po `wheel`/`pointerdown` slajd
  zmienia się po interwale. Lighthouse `--compare` mobile + desktop4x n = 5: bez regresji (TBT, CLS ≤ 0,001, LCP ±0,02 s);
  speedline B: brak zmian klatek po pierwszym ustaleniu się widoku z powodu autoplay.
- **Ryzyko i zmiana widoczna:** hero nie rotuje, dopóki czytelnik nie wejdzie w interakcję albo strona nie ucichnie
  (punkt ciszy ≥ 5 s po `load`, limit 20 s) — świadoma zmiana zachowania do opisania w PR. Parytet SSR: atrybut
  `data-motion` ustawiany wyłącznie po hydratacji na `<html>` (React nie zarządza tym atrybutem).

### P3.6a [MUST-SI] Cache brzegowy dokumentu: działająca warstwa L2 (nazwany cache), build w kluczu, samotest, stały wariant zapisu, telemetria

- **Diagnoza:** `diagnoza/cache-dokumentu.md` (R1, R6, R7).
- **Pliki:** `src/lib/http/documentCacheL2.server.ts`, `src/server.ts` (tylko odświeżenie w tle: UA, R6),
  `src/lib/http/documentCache.server.ts` (tylko linia logu/telemetria i przekazanie identyfikatora buildu do klucza,
  jeśli klucz powstaje tutaj), `src/lib/http/__tests__/*` dla tych modułów.
- **Mechanizm:** R1: `getColoCache()` zwraca fasadę nad `caches.open("nes-edge-v1")` (otwieraną leniwie raz na izolat),
  do `caches.default` wraca dopiero, gdy nazwany cache jest niedostępny; samotest put+match klucza z nonce raz na
  izolat pod `runAfterResponse`, wynik w `l2Stats().verified`, a `enabled` zależy od samotestu. **Obowiązkowo**
  identyfikator buildu w kluczach dokumentów (stały per build, np. nazwa pliku wejścia klienta z `BOOT_MANIFEST.entry`
  w `src/lib/boot/bootManifest.ts` — tylko import, bez edycji tego pliku; fallback, gdy mapy brak). R6: odświeżenie
  w tle zawsze ze stałym przeglądarkowym UA. R7(b, c): `l2.verified` i przyczyna degradacji (`degradedBy`) w linii
  logu dokumentu; R7(a) (kolonia przez `/cdn-cgi/trace`) tylko jeśli da się to zrobić bez ryzyka i z pamięcią na izolat.
- **Dowód:** testy (atrapa `caches` z `open` → HIT z L2 po „rotacji izolatu” `resetDocumentCacheForTests()`,
  `verified: true`; `open` rzuca → fallback i `verified: false`; klucz zawiera build; odświeżenie w tle ma stały UA);
  pełne testy `src/lib/http/__tests__`; harness lokalny bez regresji (L1). Weryfikacja produkcyjna po wdrożeniu:
  seria curl → `nes-layer;desc="L2"` na zimnych izolatach.
- **Ryzyko:** stary HTML po wdrożeniu (build w kluczu to warunek), purge per kolonia (jak dziś per izolat, zapisane w
  komentarzu modułu).

### P3.6b [MUST-SI] Kompletny dokument przy MISS: werdykt zapisu na końcu strumienia i własny budżet treści strony głównej

- **Diagnoza:** `diagnoza/cache-dokumentu.md` (R2, R3a).
- **Pliki:** `src/routes/index.tsx`, `src/lib/http/documentCache.server.ts`, `src/lib/http/responseHeaders.ts`,
  `src/lib/ssr/chromeWarmup.tsx`, `src/routes/__root.tsx` (tylko gałąź `expired()` chrome i lista celowych zasiewów),
  `src/lib/ssr/homeSsrBudget.ts`, testy (`degradedRenderCachePipeline`, `documentCache.server`, `homeRoute`,
  `platformChromeWarmup`, `resilientLoad`, `homeSsrBudget`, `startPipeline`).
- **Mechanizm:** R2 (a)–(c) z raportu: predykat kompletności rejestrowany przez loader, decyzja zapisu na końcu
  strumienia (`applyDeferredDocumentStore`), świeżość z dyrektywy końcowej, chrome przy wygasłym terminie czeka z
  ograniczonym budżetem zamiast `failed`. R3a: `home.page` i `home.mode` z własnym budżetem ~1200 ms (stała w
  `homeSsrBudget.ts`, bramka `check:ssr-budgets`). Typ A (brak `home-page`) zawsze `no-store`. Sprawdzić też,
  skąd na produkcji `cache-control: no-cache` na HIT `/` (lokalnie `public, s-maxage=900`).
- **Dowód:** testy negatywne predykatu (każde odstępstwo = brak zapisu), testy pozytywne B2/B1; harness bez regresji;
  fixture z opóźnieniem zapytań (jeśli harness to umożliwia) pokazuje zapis po pełnym strumieniu.

### P3.3 [MUST] `content-visibility: auto` dla sekcji ≥ 2

- Wg `faza1/PLAN.md` P3.3 (pliki: `src/components/builder/organisms/BuilderRenderer.tsx`, nowy test, nowy e2e).
  Zadanie pierwszej klatki na produkcji: 138–174 ms obs. (Layout 69–106 ms, 660 obiektów) — `diagnoza/waga-dokumentu.md`.
- Dowód jak w planie głównym + speedline B bez regresji i layoutSI (księga zadań z Layout) w dół.

### P3.8 [MUST-SI] Zero żądań Supabase z bootu anonimowej strony

- **Diagnoza:** `diagnoza/zapytania-po-boocie.md` (#1–#7).
- **Pliki:** `src/routes/__root.tsx` (rozgrzewka `fontScale`, sygnał „brak aktywnych popupów”, bramki nakładek),
  `src/components/ads/FooterSlideup.tsx`, `src/components/ContentAreaStyle.tsx`, `src/lib/builder/popups.ts`,
  `src/components/**/NewsletterPopup.tsx`, `src/components/**/PopupHost.tsx`, `src/hooks/useInterests.ts`,
  `src/components/**/JoinUsForm.tsx`, `src/components/**/NewsletterForm.tsx`, `src/lib/ads/queries.ts`,
  `src/hooks/useNewsletterSettings.ts`, `src/router.tsx` (tylko #5, polityka odświeżania w oknie bootu), testy.
  Wspólny zatrzask z P3.5 (`interactionOrQuiet.ts`) — tylko import.
- **Mechanizm:** #1–#4b obowiązkowo, #5–#7 jeśli bezpieczne (raport).
- **Dowód:** harness: linia `backend:` 0 zapytań w oknie bootu na `/` (było 7 + 7 preflight); e2e zalogowanego i
  popupów (`on-demand-overlays`, `ssr-degradation`) zielone; Lighthouse bez regresji.

### P3.2a [MUST] Bajty obrazów w HTML i ścieżce LCP

- Wg `faza1/PLAN.md` P3.2 (LP-7, HW-4) + P4.2 (względne URL-e TYLKO w `src`/`srcset` renderowanym do HTML, w
  preloadzie `<head>` i w nagłówku `Link`) + logo nagłówka eager. Diagnoza: `diagnoza/waga-dokumentu.md` (pozycje 1,
  3, 10). Pliki z planu głównego (`cropSizes.ts`, `imageSlot.ts`, `sliderSizes.ts`, `widgetImageSizes.ts`,
  `heroImage.ts`, `OptimizedImage.tsx`, `sliderVariants.tsx`) + emitery preloadu/`Link` + testy.
- **Decyzja właściciela (2026-10-08): awatarów NIE zmieniamy** — ani rozmiaru wyświetlania, ani ich `src`/`srcset`
  (pozycja 4 diagnozy i awatary 1x/2x z HW-4 wypadają z zakresu; `TrendingTicker.tsx` poza listą plików P3.2a).
- Dowód: `check-document-weight` (bajty `srcset` w dół, preload = kandydat), żądanie hero 640w na mobile, ΔLCP mobile
  ≤ −0,1 s albo raport.

### P3.2b [MUST] Jeden font w ścieżce krytycznej i dopasowana metryka zastępcza (CLS)

- **Decyzja właściciela (2026-10-08): jedynym fontem w ścieżce krytycznej jest Red Hat Display** (ten sam krój co dziś, podzbiór latin + polskie znaki, oś wag zachowana); żaden inny krój nie dochodzi ani nie zastępuje go w preloadzie.
- Wg `faza1/PLAN.md` P3.2 LP-8 (jeden plik Red Hat Display latin+PL, preload jedynego fontu; dziś preload dwóch:
  latin i latin-ext) + naprawa przesunięcia 0,0163 na desktopie (`div.relative.w-full.h-full`, przyczyna: załadowanie
  `red-hat-display-latin`) przez metrykę zastępczą (`size-adjust`, `ascent/descent-override`). Pliki: `src/styles.css`
  (tylko `@font-face` i fallback), `src/lib/seo/fontPreload.ts`, `src/lib/seo/rootHead.ts`, `src/assets/fonts/*`,
  test pokrycia glifów i metryk. Podzbiór generowany narzędziem z npm uruchomionym przez `npx` POZA repo
  (bez nowej zależności), plik wynikowy w repo.
- Dowód: jedno żądanie fontu w ścieżce LCP, CLS = 0 w 5/5 desktop i mobile, FCP ±0, ΔLCP mobile w dół.

### P3.9 [SHOULD] Higiena grafu chunków `/`

- **Diagnoza:** `diagnoza/martwy-kod.md` §5: `WidgetView` importuje z `formFieldConfig.tsx` tylko `parseCustomFields`,
  a moduł ciągnie kompozytor wiadomości, wzmianki, `LayoutPreview` z admina i `vendor-radix(-select)` (~64 KB transferu
  na `/`); `FooterSlideup` w chunku `/blog` (~15 KB); `vendor-lucide` (19,5 KB) przez obie ścieżki.
- **Pliki:** `src/lib/forms/formFieldConfig.tsx` (lub obecna lokalizacja) + nowy czysty moduł parsera, importerzy
  parsera, `vite.config.ts` + `vite.smoke.config.ts` (jeśli potrzebne przypięcie chunka; parytet obu plików),
  testy.
- Dowód: `bun run report:chunk-inventory` / inwentarz żądań na `/`: brak tych chunków; bajty JS `/` w dół;
  check:chunks, check:entry-purity, check:bundle zielone.

### P3.7 [MUST-ParseHTML] Dieta dokumentu (właściciel porcji ParseHTML)

- **Diagnoza:** `diagnoza/waga-dokumentu.md` (pozycje 2, 7, 11, 12, 13, 14, 15, 16, 17 + metryka skryptu 9,8 KB).
- **Zakres:** minifikacja statycznych literałów CSS w buildzie (`TICKER_CSS`, styl slidera, statyczna część
  brand-tokens), kompaktowanie metadanych zapytań w stanie odwodnionym (z odtworzeniem przed `hydrate`), `heroPreloads`
  poza ładunkiem, `seoSettings` jako ta sama referencja, krótsze wzorce speculation rules, zajawki tylko dla widgetów,
  które je renderują, język w kluczu tickera (przekazanie P2.5), publiczny klucz menu z etykietami jednego języka,
  reguły `[data-sidebar]` do arkusza admina, metryka `document-weight` dla strumieniowanego skryptu stanu.
  Pliki ustala orkiestrator przy starcie partii (po scaleniu P3.2a/P3.5, które dotykają tych samych modułów).
- Dowód: `htmlRawBytes` −≥ 25 KB na fixture, progi document-weight w dół (ratchet), księga: porcje ParseHTML krótsze.

### P3.1 [MUST-desktop] Zadania po boocie w oknie TBT

- Wg `faza1/PLAN.md` P3.1 + lista z księgi po partiach 1–2 (K9 `Script:index`, K16, `Timer:dynamic-icon`, burst
  hydratacji `vendor-react`) + TP-5 w `consent.ts`. Zakres zatwierdza orkiestrator po księdze partii 2.

### P3.10 [HIGIENA] Martwy kod i ujednolicenie duplikatów

- **Diagnoza:** `diagnoza/martwy-kod.md`. Zakres: pliki SAFE, zestawy TEST-ONLY razem z testami (bez
  `newsletter-builder/schema.ts` i `LinkPreviewBlock.tsx` — to zgubione podłączenia, nie martwy kod; bez zasiewów i18n
  F1–F5 — decyzja produktowa), zależności `ai`, `@ai-sdk/openai`, `@ai-sdk/react` (+ `@ai-sdk/openai-compatible` z
  `ai-gateway.server.ts`), 56 martwych eksportów, duplikaty helperów (`prefersReducedMotion` ×5, `escapeHtml`,
  `formatBytes`, `sha256Hex`, `redactEmail`, `originFromRequest`, datetime-local) na jeden kanoniczny moduł.
  Uruchamiana OSTATNIA (po scaleniu pozostałych pozycji), żeby nie kolidować z ich plikami.
- Dowód: typecheck, verify:static, pełny vitest, build, check:bundle (bez wzrostu), e2e artefaktu.

### P3.11 [WARUNKOWO] Podział arkusza blokującego (P4.1)

- 542 KB raw / 78,8 KB gz w jednym pliku; na `/` użyte ~11% reguł utilities. Decyzja po bramce partii 1–3
  (duże ryzyko wizualne, nakład L).

## 3. Partie i własność plików

| Partia | Pozycje (równolegle)                | Uwagi                                                                                                       |
| ------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1      | P3.4, P3.5, P3.6a                   | rozłączne pliki; P3.5 tworzy `interactionOrQuiet.ts` dla P3.8                                               |
| 2      | P3.3, P3.6b, P3.8                   | `__root.tsx`: P3.6b tylko gałąź chrome `expired()`, P3.8 rozgrzewki i nakładki — orkiestrator scala ręcznie |
| 3      | P3.2a, P3.2b, P3.9                  | `sliderVariants.tsx`/`TrendingTicker.tsx` po P3.5; `styles.css` P3.2b tylko `@font-face`                    |
| 4      | P3.7, P3.1                          | po księdze partii 1–3                                                                                       |
| 5      | P3.10 (+ P3.11, jeśli zatwierdzone) | ostatnia                                                                                                    |

Bramka fali 3 po partiach: jak W2 (`faza1/PLAN.md`, fala 3) + SI: speedline bez późnych zmian od autoplay, CLS = 0
(mobile i desktop), `backend: 0` zapytań w oknie bootu. Weryfikacja produkcyjna po wdrożeniu: Lighthouse z kontenera
(skrypt w `diagnoza/stan-wejsciowy.md`), sondy curl cache (L2), a jeśli właściciel ustawi `PSI_API_KEY` — `psi.yml`.

## 4. Działania właściciela (poza kodem)

1. Sekret `PSI_API_KEY` (repo → Settings → Secrets → Actions) — opcjonalny, tylko dla pomiaru: bez niego `psi.yml`
   nie próbkuje PSI, a weryfikacja po wdrożeniu idzie Lighthouse'em z kontenera. Właściciel nie ma dziś klucza
   (2026-10-08); instrukcja w PR #485.
2. ~~Zmienna `vars.APP_BASE_URL`~~ — niepotrzebna dla rozgrzewki: krok `Warm NES Edge Cache` w `scheduler.yml`
   domyślnie grzeje produkcję (2026-10-08). Zmienna jest nadal potrzebna dla ticku doręczeń (razem z sekretem
   `COMMUNITY_CRON_SECRET`), ale to poza zakresem wydajności.
3. Analityka Lovable `~flock.js` — właściciel jej NIE wyłącza (decyzja 2026-10-08); zadanie 59 ms na mobile zostaje
   jako koszt stały poza kodem.
