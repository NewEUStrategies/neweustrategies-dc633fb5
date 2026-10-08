# Inwentarz ruchu sterowanego czasem na stronach publicznych (2026-10-08)

Źródło: agent Explore (tylko odczyt), drzewo `7c924ae5`. Ścieżki względem korzenia repo, numery linii z tego drzewa.
Cel: jedna wspólna polityka „bramki ruchu” (pozycja P3.5 w `../PLAN-FALI-3.md`).

## Ustalenia zmieniające plan

1. **Hero strony głównej to główny problem.** W `e2e/fixtures/first-visit.json` slider postów jest w sekcji 0
   (sekcja :1472, slider :1658, `editorial-hero`, `autoplay:true`, `intervalMs:4500` :1744-1747);
   `carousel_defaults` (:1040-1048) też `autoplay:true, 4500`. Sekcja 0 nigdy nie jest wyspą
   (`BuilderRenderer.tsx:581`, wyspy od `docIndex >= 1`), renderuje się na serwerze przez
   `lazySliderRender.tsx:21-28`, więc pierwszy przeskok = montaż + 4,5 s (pasuje do ~8 s w śladzie produkcji).
2. **Ticker nagłówka ma dwie ścieżki ruchu; bramkowana jest tylko dekoracyjna.** `useDecorativeMotion`
   (`TrendingTicker.tsx:102-114`) czeka na interakcję albo ciszę, ale obejmuje tylko płomień, wstęgę i „live ping”
   (komentarz :94-95: ruch treści celowo niebramkowany). Ruch treści to albo JS (`setInterval` paczek), albo
   inline'owa animacja CSS `infinite` obecna w HTML z SSR (startuje przy pierwszym malowaniu, przed hydratacją).
   Wniosek: bramka musi być także atrybutem CSS (jak dzisiejsze `[data-tt-motion]`), nie tylko booleanem w JS.
3. **Ryzyko czasu dla zapasu „długiej ciszy”.** `onQuiescent` odpala ≥ 5 s po `load` i po 5 s ciszy
   (`whenQuiescent.ts:91-95`), z limitem 20 s (także w ukrytej karcie), i ignoruje `img` startujące po `load`
   (:205-207), a Lighthouse ich nie ignoruje. Pierwsza zmiana wizualna = otwarcie bramki + JEDEN PEŁNY interwał;
   samo otwarcie bramki nie może niczego zmieniać wizualnie.
4. **Przewinięcie elementu nie jest interakcją** (`firstInteraction.ts:164-166`, tylko `document`), więc własny
   `scrollTo` karuzeli nie otworzy bramki (test `firstInteraction.test.ts:70`).

## 1. Slidery i karuzele z autoplay (timery JS)

| # | Gdzie (timer) | Domyślne / klucze | Istniejące pauzy | SSR nad zgięciem na `/` | Wpięcie bramki |
|---|---|---|---|---|---|
| 1 | **SliderRender** `src/lib/builder/sliderVariants.tsx:985-1000` (`setInterval` :988); konfiguracja :852-863; hover :1160-1161 | `autoplay = asBool(config.autoplay, carouselG.autoplay)` :859; `intervalMs` min 1500 :860; `pauseOnHover` :861; `loop` :862. Globalne `CAROUSEL_DEFAULTS` = autoplay true, 4500 (`src/lib/theme/carouselDefaults.ts:27-34`; ustawienie `carousel_defaults` :57-73). Klucze widgetu nieustawione → globalne: `PostsSliderWidget.tsx:54-55`, `SimpleWidgets.tsx:1181-1182` | `preview`; < 2 elementy; hover przy `pauseOnHover`. **Brak** reduced-motion na timerze (CSS :608-611 zmienia tylko przenikanie), brak focus/visibility/IO | **Tak**, hero, sekcja 0 | warunek w strażniku :986 i w zależnościach :1000 |
| 2 | **PostListCarousel** `src/components/builder/organisms/widget-view/PostListView.tsx:731-861`; efekt :777-781 (`setInterval` :779) | domyślnie wyłączony (`src/lib/builder/postListCarousel.ts:16-41`), 5000 ms | reduced motion :742/:747; hover/focus :811-814; przycisk pauzy :830-836 | tylko gdy włączy redaktor | AND w `running` :747 |
| 3 | **CircularCarousel** `src/components/ui/circular-carousel.tsx:161-167`; widok `CircularCarouselView.tsx:70-81` | `autoPlay` domyślnie **true** (`registry.tsx:1183-1184`), 4000 ms (`circularCarousel.ts:61-70`) | reduced motion :137; hover :135/:207; focus :136/:190-195 | nie w fixture | AND w `rotating` :161 |
| 4 | **ProgressSlider** `src/components/ui/progressive-carousel.tsx:109-147` (pętla rAF + przejście po `duration`); widok `ProgressCarouselView.tsx:42/:64-78` | zawsze auto; 5000 ms (`progressCarousel.ts:80-89`) | `paused` (edytor), reduced motion :81, hover :85, focus :86 | nie w fixture | AND w `autoPlay` :109 (pasek stoi na 0 do otwarcia) |
| 5 | **InteractiveCircleWidget** `.../widget-view/InteractiveCircleWidget.tsx:106-114` | `autoplay === "on"` (domyślnie off) :87; 4000 ms :88 | hover/focus przez `pausedRef` :141-144; **brak** reduced motion | nie w fixture | strażnik efektu :108 (+ ruch CSS, §3) |
| 6 | **RelatedSlider** `src/components/post/RelatedPosts.tsx:327-351` (`setInterval` :333) | `slider_autoplay` false, 5000 ms (`src/lib/relatedPosts/config.ts:66-67`) | **brak** | wpisy, pod artykułem | strażnik :332 |
| 7 | **ImageCarouselView** `src/components/blocks/MarketingViews.tsx:254-261` | `autoplay === true` (off), 5000 ms (`renderer/molecules.tsx:960-961`) | tylko hover :269-270 | treść wpisu | strażnik :255 |
| 8 | StoryViewer `src/components/web-stories/StoryViewer.tsx:52-77` | 6 s na stronę | ręczna pauza | otwiera się sam na `/web-stories/$slug` (pełny ekran) | **poza zakresem** (treść nawigowana świadomie) |
| 9 | SignupShowcase `src/components/ui/signup-showcase.tsx:125-134` | `autoRotate` true | reduced motion, hover, focus | tylko popup zapisu | AND w `rotating` :125 |
| 10 | CareersValues `src/components/careers/organisms/CareersValues.tsx:45-72` | 5 s | IO, ukryta karta, hover, interakcja, reduced motion | `/zatrudniamy` | **wzorzec** wszystkich warunków pauzy |

## 2. Tickery, rotatory, odliczania, „na żywo”

**TrendingTicker** (nagłówek każdej strony publicznej; SSR w `src/routes/__root.tsx:991-995`, montaż poza wyspą
`src/components/Header.tsx:246-267`; domyślne: tryb `scroll`, `intervalSec` 6, układ `classic`, `liveDirection`
pionowy — `src/lib/views/tickerVariants.ts:96-116, 206`; mapowanie silników `headerGeometry.ts:73-103`):

| Ścieżka | Gdzie | Pauzy | Wpięcie |
|---|---|---|---|
| a. silnik pasma (classic/badge, tryb ≠ scroll): `setInterval` paczek | `TrendingTicker.tsx:164-169`; ponowny klucz :329 odtwarza `tt-anim-fade/slide/flip` :905-907 | **brak** | strażnik :165 |
| b. `typewriter` | `TypewriterText` :489-516 | reduced motion :494 | jak a.; mruganie `.tt-caret` (:908) pod atrybut CSS |
| c. marquee szklane (glassMarquee/Ribbon/Tape, glassLive poziomy) | inline `animation: … linear infinite` w HTML z SSR :667 (czas :636-639) | hover :668-673; reduced motion :1203 | `animation-play-state: paused` bez atrybutu bramki |
| d. karty szklane (glassCards/Spotlight, glassLive pionowy - domyślny) | inline `infinite` :734-735, :759 (keyframes :815-834) | hover :760-765; reduced motion :1203 | jak c. |
| e. ruch dekoracyjny (już bramkowany) | `[data-tt-motion]` z `useDecorativeMotion` :102-114 → :930-933, :1004, :1084-1087 | reduced motion :1202-1211 | zastąpić wspólną bramką |

Widgety buildera:

| Element | Gdzie | Domyślne | Pauzy | Wpięcie |
|---|---|---|---|---|
| NewsTickerView | `.../widget-view/NewsTickerView.tsx`: pionowy `infinite` :200-205 (keyframes :245-271); poziomy :299-310 / :234-243 | pionowy :39; 40 s :35; `pauseOnHover` :36 | hover; reduced motion :240-242, :267-269 | atrybut CSS (inline `animationPlayState:"running"` :204/:303 → wstrzymane do bramki) |
| TrendingNowView | `.../widget-view/TrendingNowView.tsx:114-120` | 5 s :51 | hover :121-126; reduced motion :42-44 | atrybut CSS |
| TextRotate | `src/components/ui/text-rotate.tsx:159-164` | 2200 ms, `auto`, `loop` (`SimpleWidgets.tsx:1285-1289`) | reduced motion | AND w `rotating` :159 |
| AnimatedHeadingRender | `src/lib/builder/animatedHeadingVariants.tsx`: rotacja `setInterval` :676-680; `loop` (domyślnie true, `SimpleWidgets.tsx:1256`) — nieskończony cykl :462-475 | — | **brak reduced motion w pliku** | strażnik :677; do otwarcia gałąź bez pętli `forwards` (:477-487) |
| Etykieta sekcji „ticker-strip” | `src/lib/builder/sectionLabelVariants.tsx:1117-1157` → `.nes-ticker-dot`/`.nes-ticker-halo` (`src/styles.css:7885-7916`), `infinite` 1,6 s od malowania SSR | — | reduced motion :7932-7939 | CSS pod atrybutem bramki |

Odliczania (sekunda co 1 s = zmiana wizualna co sekundę): `EventCountdownView.tsx:72-78`, `EventCountdownCardView.tsx:115-121`,
`src/components/blocks/InteractiveViews.tsx:222-229`, `src/components/newsletter/NewsletterDocRenderer.tsx:106-110` —
do otwarcia bramki tykanie minutowe (cyfra sekund stoi). `useNowMs` (`src/lib/time/useNowMs.ts:29-38`) — użycia 30 s, bez zmian.

„Na żywo”: `LiveBlogBlock.tsx:189` `animate-pulse`, `src/routes/live.tsx:166` i `NewsTickerView.tsx:190` `animate-ping` — bez reduced motion.

## 3. Animacje CSS `infinite`

Brak globalnej reguły reduced-motion dla `animate-*` Tailwinda w `src/styles.css`.
- Chmura logotypów: `SimpleWidgets.tsx:1443-1473` → `lc-track` (`styles.css:6206-6230`), reduced motion obsłużony.
- Ikona `spin`: `SimpleWidgets.tsx:874-886` (opt-in, bez reduced motion).
- InteractiveCircle: `animate-[spin_18s…infinite]`/`animate-pulse` :131-136, `animate-ping` :246-255.
- WorldMap: łuki `infinite` przy `loop` (`src/components/maps/WorldMap.tsx:261-264, 305-307`), pierścień `world-map.css:44-48`; AND w `animated` (:141).
- **Kinetic Signal Notch** (`sectionLabelVariants.tsx:1191-1329`, `styles.css:7947-8022`): **bez ruchu nieskończonego** — nie ruszać.
- Szkielety (`styles.css:2403-2437`) tylko w stanach ładowania.
- Wideo: `SectionBackgroundVideo` (`BuilderRenderer.tsx:666-707`, autoplay + loop, IO, bez reduced motion),
  `VideoHeroView` (`src/components/blocks/ConversionViews.tsx:302-333`, autoplay domyślnie, `molecules.tsx:1120-1121`),
  widget wideo (`SimpleWidgets.tsx:919-980`, YouTube `autoplay=1` :938-941) — `play()`/URL autoplay dopiero po bramce.
- Nakładki opóźnione (popupy, slideup) są za bramką zgód (`src/lib/overlayCoordinator.ts`), więc w pierwszej wizycie PSI się nie otwierają.

## 4. Prymitywy do ponownego użycia

- `src/lib/performance/whenQuiescent.ts`: `onQuiescent(task, { priority })` (:393), `getQuiescence()` (:427),
  `registerOwnedRequest()` (:417), stałe :91-99.
- `src/lib/performance/postInteractionQueue.ts`: `enqueue(task, { priority, target?, release? })` (:441), priorytety (:105).
- `src/lib/performance/firstInteraction.ts`: `onFirstInteraction(cb)` (:221), `getFirstInteraction()` (:241).
- `src/lib/performance/afterPageLoad.ts:8`, `src/lib/ads/idle.ts:31`, `src/lib/prerender.ts:10, 20`.
- Reduced motion: `prefersReducedMotion()` (`src/lib/a11y/reducedMotion.ts:11`), `usePrefersReducedMotion()`
  (`src/hooks/usePrefersReducedMotion.ts:15`); kopie lokalne: `CareersValues.tsx:47`, `CounterWidget.tsx:49-51`.
- Widoczność: jedyny hook reaktywny `useDocumentVisible()` w `src/lib/chat/useAutoMarkRead.ts:29`.
- **Wzorzec do uogólnienia:** `TrendingTicker.tsx:102-114` (`enqueue(allow, {priority:"overlays"})` + `onQuiescent(allow, ...)`,
  boolean `false` na serwerze, atrybut danych jako prefiks selektorów CSS).

## 5. Testy

Slider: `src/lib/builder/__tests__/sliderDisplaySettings.test.tsx` (:465-482, :491-509, :970-1000),
`sliderVariantCatalogs.test.tsx`, `sliderResponsiveNavigation.test.tsx:62`, `src/lib/theme/__tests__/carouselDefaults.test.ts`.
PostList: `src/lib/builder/__tests__/postListCarouselContract.test.ts`, `.../widget-view/__tests__/postListBylineAndCarousel.test.tsx:142-260`.
Karuzele: `src/components/ui/__tests__/circularCarousel.test.tsx:324-370`, `CircularCarouselView.test.tsx`,
`progressiveCarousel.test.tsx:102-220`, `ProgressCarouselView.test.tsx`; `interactiveCircleWidget.test.tsx:86-176`;
`src/components/post/__tests__/relatedPostsLayouts.test.tsx:348-380`.
Ticker: `src/components/header/__tests__/TrendingTicker.test.tsx` (:254-289, :402-630), `TrendingTicker.motion.test.tsx:90-150`.
Tickery buildera: `.../widget-view/__tests__/dataViews.test.tsx:256-295, 503-520`. Tekst: `src/components/ui/__tests__/textRotate.test.tsx:129-186`,
`src/lib/builder/__tests__/sectionLabelKineticNotch.test.tsx`. Odliczania: `eventWidgets.test.tsx`, `eventCountdownCard.test.tsx`,
`src/lib/events/__tests__/countdown.test.ts`, `src/components/blocks/__tests__/liveBlogBlock.test.tsx`.
Prymitywy: `whenQuiescent.test.ts` (:284, :300), `firstInteraction.test.ts:70`, `postInteractionQueue.test.ts:185`.
Fixture PSI/e2e: `e2e/fixtures/first-visit.json` (hero :1744-1747, `carousel_defaults` :1040-1048, ticker :56/:88).
