# Prompty fali 2 (do uruchomienia po fali 1 i na polecenie właściciela)

Założenia jak w `PROMPTY-FALA-1.md` (repozytorium `WT`, gałąź PR jako baza, `$SCRATCH`, skrypt
`workflow-faza2-wave.js`, wspólne nagłówki implementatora i recenzenta). Plan: `faza2/PLAN-FALE-1-2.md` §3.

## 1. Kroki przed falą (orkiestrator, pod `$SCRATCH/.heavy-lock`)

```bash
cd $WT && git fetch origin main && git merge --no-ff origin/main       # fala 1 scalona
until mkdir $SCRATCH/.heavy-lock 2>/dev/null; do sleep 20; done; trap 'rmdir $SCRATCH/.heavy-lock' EXIT
bun run build:smoke
export LIGHTHOUSE_CLI=$SCRATCH/tools/node_modules/lighthouse/cli/index.js CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
for ua in browser bot; do
  node scripts/performance/lighthouse-local.mjs --root . --runs 5 --forms mobile,desktop4x,desktop5x \
    --client-backend fixture --third-party fake-gtag --save-artifacts --warm-ua $ua --label base-w2-$ua \
    --save-baseline --baseline-out docs/performance/2026-10-03-pagespeed-85-95/lighthouse-local-baseline-w2-$ua.json
done
# baza odniesienia dla pakietu dokumentu i wysp, dopóki P2.1 nie jest scalone: W2 + transformacja C3
node scripts/performance/lighthouse-local.mjs --root . --runs 5 --forms mobile,desktop4x --client-backend fixture \
  --third-party fake-gtag --save-artifacts --html-transform $SCRATCH/phase1/verdicts/boot-js-C3/c3-lcpobs.mjs --label base-w2-c3
node scripts/performance/lighthouse-local.mjs --compare . . --runs 4 --forms mobile,desktop4x --client-backend fixture --third-party fake-gtag --label aa-w2
rmdir $SCRATCH/.heavy-lock
rsync -a --exclude node_modules $WT/ $SCRATCH/base-w2/ && ln -s $WT/node_modules $SCRATCH/base-w2/node_modules
```

## 2. Argumenty dla `workflow-faza2-wave.js`

Pozycje P2.2–P2.6 mierzą się z transformacją C3 po OBU stronach (`lh_flags` zawiera `--html-transform` dla A i
`--html-transform-b` dla B z tym samym plikiem), dopóki P2.1 nie jest scalone; po scaleniu P2.1 flagi transformacji
znikają.

### Partia 1a: P2.5 + P2.6

```json
{
  "wave": 2,
  "base_ref": "perf/pagespeed-mobile85-desktop95-t595d6",
  "baseline_wt": "/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad/base-w2",
  "items": [
    {
      "id": "P2.5",
      "prove": true,
      "runs": 5,
      "forms": "mobile",
      "lh_flags": "--client-backend fixture --save-artifacts --html-transform $SCRATCH/phase1/verdicts/boot-js-C3/c3-lcpobs.mjs --html-transform-b $SCRATCH/phase1/verdicts/boot-js-C3/c3-lcpobs.mjs",
      "notes": "Projekcje w funkcjach zapytań, NIE w dehydrate (serializeData nie zna klucza; SSR, hydratacja i refetch muszą mieć ten sam kształt). (a) menu: id, parent_id, position, item_type, label(lang), href (+ target/visibility/icon tylko gdy niedomyślne), projekcja z tego samego wpisu edgeTtlCache(menuCacheKey(key)), bez podziału na poziom główny (dzieci zostają: hover, szuflada, mega, hasPanel); (b) wiersze postów na język z fallbackami identycznymi jak PostListView (tytuł PL→EN, excerpt bez fallbacku), PostsSliderWidget, NewsTickerView; klucz tickera z lang + placeholderData: keepPreviousData; (c) projekcja newsletter-settings dla formularza inline (pełny klucz dla popupu, admina, registrationFields). Porzucone (d) i (e) z PLAN.md (werdykty HW-3, H2). Test dehydratedPayload: stan SSR '/' na fixture bez menu_id, domyślnego mega_config, *_en w wierszach PL, popup_* w newsletterze. Księga P0.5: K4 ParseHTML dokumentu (desktop d4 163+65 ms sym., w C3 113+15 blokowania) – współwłasność z P2.6. Dowód: dehydratedStateBytes w dół >= 3 KB gz na fixture; zadania ParseHTML/EvaluateScript dokumentu krótsze w B we wszystkich przebiegach; ΔTBT <= 0; CLS <= 0,001; e2e miękkiej zmiany języka: ticker nie zapada się."
    },
    {
      "id": "P2.6",
      "prove": true,
      "runs": 5,
      "forms": "mobile,desktop4x",
      "lh_flags": "--client-backend fixture --save-artifacts --html-transform $SCRATCH/phase1/verdicts/boot-js-C3/c3-lcpobs.mjs --html-transform-b $SCRATCH/phase1/verdicts/boot-js-C3/c3-lcpobs.mjs",
      "notes": "HW-6: powtarzalne statyczne style='' → klasy Tailwind: ramka widgetu BuilderWidgetNode.tsx (×23), przejście FillImage sliderVariants.tsx (×21), szerokość multi-card (×20); bez edycji styles.css (właściciel P2.4); AuthorByline robi P2.4. C9: kropki paginacji slidera → stały size-2.5 + scale-[.8] dla nieaktywnych + transition-[transform,opacity] (zamiast transition-all + w-2/w-2.5). Katalogi slidera w sliderVariantCatalogs.test.tsx zaktualizowane o klasy; asercja jednego style[data-href='nes-slider-shared-v1'] bez zmian. Parytet SSR/klient (te same klasy). Dowód: htmlRawBytes w dół (check-document-weight), zadania ParseHTML dokumentu krótsze, brak niekompozytorowej animacji kropek w audycie non-composited-animations, ΔTBT <= 0, CLS <= 0,001."
    }
  ]
}
```

### Partia 1b: P2.4 + P2.3

```json
{
  "wave": 2,
  "base_ref": "perf/pagespeed-mobile85-desktop95-t595d6",
  "baseline_wt": "/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad/base-w2",
  "items": [
    {
      "id": "P2.4",
      "prove": true,
      "runs": 5,
      "forms": "mobile,desktop4x",
      "lh_flags": "--client-backend fixture --save-artifacts --html-transform $SCRATCH/phase1/verdicts/boot-js-C3/c3-lcpobs.mjs --html-transform-b $SCRATCH/phase1/verdicts/boot-js-C3/c3-lcpobs.mjs",
      "notes": "(a) useGlobalWidgetNode tylko w dziecku renderowanym, gdy instanceNode.globalId jest ustawione. (b) HW-2 zawężone do ChromeWidgetView: szablony typografii dopisane NIEWARSTWOWO na końcu publicznego CSS ([data-wt~=\"fs\"][data-w-id][data-w-id] :is(…){font-size:var(--wt-fs)!important}, specyficzność 0,3,0), instancja emituje data-wt='tfs dfs' + style='--wt-tfs-d:16px;…' zamiast bloku <style> ~1,5 KB; urządzenie przez [data-builder-renderer][data-device=…], nie @media; wartości przez whitelistę jak cssLen; joinUs i slider poza zakresem; liveTypography: reguła per id w head na zmiennych. (b') pozostałe arkusze per widget (hover/scoped/kolor) przez StyleSink z P1.2. (d) cn() z ograniczonym cache; (e) DynamicIcon: dla nazw spoza zestawu SVG z DOM SSR zamiast ładowania icons-N; (f) CountryCombobox: lista Intl leniwie. (g) animacje wg księgi P0.5 K8 (start animacji CSS 113 ms sym. mobile, 97/121 desktop, kompozytor): @keyframes enter/exit bez filter, oi-fade-in nie dla obrazów w pierwszym viewporcie, mbb-strok dopiero po html[data-interacted], inne źródła warstw (will-change, backdrop-filter) z atrybucji P0.5; test loadAnimations (animacje przy ładowaniu tylko transform/opacity). (h) HW-6 dla AuthorByline (awatar 163 B ×33). Strażnik w check-entry-purity: generator typografii nie wraca do entry. Weryfikacja na nazwach komponentów z buildu profilującego (raporty/P0.5-robocze, build-prof), nie na zminifikowanych cz/fz/Tn/rD. Dowód: zadania K15 (ParseHTML w commicie, 128 ms sym.), K16 (styl po przełączeniu urządzenia, 86 ms) i K8 skrócone lub zniknięte w B we wszystkich przebiegach; brak icons-N na '/'; sonda parytetu getComputedStyle dla [data-w-id] przy 390/820/1350 px, jasny/ciemny – diff pusty; publicCss zapas zmierzony (~3 KB); inlineStyleCount −~30; ΔTBT <= 0; CLS <= 0,001."
    },
    {
      "id": "P2.3",
      "prove": true,
      "runs": 5,
      "forms": "mobile,desktop4x",
      "lh_flags": "--client-backend fixture --save-artifacts --html-transform $SCRATCH/phase1/verdicts/boot-js-C3/c3-lcpobs.mjs --html-transform-b $SCRATCH/phase1/verdicts/boot-js-C3/c3-lcpobs.mjs",
      "notes": "Wyłącznie API prymitywu P1.6 (bez edycji hydrationIsland.tsx – w fali 2 należy do P2.2). (1) Ukryty nagłówek desktopowy (Header.tsx: div.hidden.lg:block z BuilderRenderer chrome, 37,2 KB HTML, display:none < 1024 px) jako HydrationIsland id='hdr-desktop' trigger={{visible:false, interaction:false, quiescent:false, media:'(min-width: 1024px)', immediateWhen: hasStoredAuthSession}}; HTML identyczny, parytet SSR; reguła lazyWidgets 'nawigacja hydratuje pierwsza' dotyczy WIDOCZNEJ nawigacji (na mobile nagłówek mobilny, 4,1 KB, jak dziś). (2) AccountMenuWidget gościa statycznie (AppLink + ikona logowania, ten sam markup SSR), menu zalogowanego (radix Popover/Avatar, greetings z admin.users, supabase) leniwie przy otwarciu; SearchButtonWidget: useVoiceSearch, facetModel→archives, i18n-search na intencję; oba jako wyspy z ownEvents ['pointerover','focusin','touchstart','keydown'], globalKeys ['/'] (wyszukiwarka), visible:false, immediateWhen: hasStoredAuthSession. (3) TrendingTicker jako wyspa tylko, gdy marquee jest czysto CSS w stanie nieuwodnionym; poprawka warstwy tickera, jeśli P0.5 (K8) wskaże kompozytor. Mega-menu i widoczna nawigacja bez zmian. Dowód: brak vendor-radix, useVoiceSearch, admin.users w network-requests gościa do końca śladu; przebieg korzenia mobile krótszy o część nagłówka desktopowego; e2e header-intent: przy 412 px nagłówek desktopowy bez hydratacji do końca śladu, po resize do 1350 px hydratuje bez przesunięć, pierwsze dotknięcie otwiera wyszukiwarkę i menu konta, z zapisaną sesją awatar w <= 1 s po boocie; ΔTBT <= 0."
    }
  ]
}
```

### Partia 2: P2.2

```json
{
  "wave": 2,
  "base_ref": "perf/pagespeed-mobile85-desktop95-t595d6",
  "baseline_wt": "/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad/base-w2",
  "items": [
    {
      "id": "P2.2",
      "prove": true,
      "runs": 5,
      "forms": "mobile,desktop4x",
      "lh_flags": "--client-backend fixture --save-artifacts --html-transform $SCRATCH/phase1/verdicts/boot-js-C3/c3-lcpobs.mjs --html-transform-b $SCRATCH/phase1/verdicts/boot-js-C3/c3-lcpobs.mjs",
      "notes": "SectionsList (BuilderRenderer.tsx) opakowuje sekcje o indeksie >= 1 w HydrationIsland wewnątrz StreamingSection (sectionStreaming.tsx; sekcja bez granicy dostaje tę samą granicę na serwerze i kliencie, ~20 B HTML); stopka (Footer.tsx) jedną wyspą. Wyzwalacze: visible (IO, rootMargin '0px 0px 100% 0px'), interaction:'any' (potem pozostałe wyspy po jednej na klatkę przez kolejkę P0.3), ownEvents pointerdown/focusin/keydown, immediateWhen: hasStoredAuthSession (zalogowani i redaktorzy bez odroczenia), zapas onQuiescent. chunks = loadery leniwych widgetów sekcji z rejestru widgetChunkPlugin/lazyWidgets (bramka po chunkach, klasa CLS 0,421). Urządzenie w wyspach z useViewportDevice() (lustro useState + startTransition, NIE uSES); elementy wysp w React.memo z propsami niezależnymi od urządzenia (bailout przed odwodnioną granicą); shouldStreamSection memoizowane per obiekt sekcji (WeakMap). Wyspy wyłączone dla sekcji z widżetem TOC (AGENTS.md: aktywność TOC z geometrii nagłówków w jednym nasłuchu scroll throttlowanym rAF) i w trybie buildera. ThemeProvider.setTheme: najpierw synchronicznie applyTheme na <html>, potem startTransition(setThemeState). Serwer: wyspa nie zawiesza się; test streamingServer: HTML serwera bez fallbacku wysp, kolejność strumienia bez zmian (klasa incydentu PR #423/#431). Księga P0.5: K12 commit hydratacji 147 ms sym. mobile / 210–262 desktop, K14 plastry 50–84 ms. Dowód: commit hydratacji < 50 ms sym. albo rozbity, plastry sekcji >= 1 poza oknem; brak chunków JoinUsForm/TailoredMustReads/WidgetView w network-requests do końca śladu (mobile); CLS <= 0,001 bez przesunięcia > 0,0005; mediana ΔTBT < 0; run-first-visit.mjs --compare: CLS 0, DOM zachowany; e2e z zapisaną sesją: bloki roli poprawne od razu; e2e motywu: przełączenie przed hydratacją wysp stosuje klasę w <= 1 klatkę."
    }
  ]
}
```

### Partia 3: P2.1

```json
{
  "wave": 2,
  "base_ref": "perf/pagespeed-mobile85-desktop95-t595d6",
  "baseline_wt": "/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad/base-w2",
  "items": [
    {
      "id": "P2.1",
      "prove": true,
      "runs": 5,
      "forms": "mobile,desktop,desktop4x,desktop5x",
      "lh_flags": "--client-backend fixture --third-party fake-gtag --save-artifacts",
      "notes": "KOLEJNOŚĆ: (0) spike <= 0,5 dnia: bootAfterLcpPlugin (identycznie w vite.config.ts i vite.smoke.config.ts – check:chunk-parity; tylko build) przepisuje wirtualny manifest TanStack Start (start-manifest-plugin, środowisko serwera): puste preloads korzenia i tras, scripts entry przeniesione do serwerowego BOOT_MANIFEST (URL entry, preloady per trasa, URL słownika per język z localeChunkPlugin, mapa chunków widgetów z widgetChunkPlugin); dowód parytetu: hydratacja z 0 console.error na '/', '/en', stronie buildera, wariant bota i przeglądarki, HIT i MISS – BEZ dowodu nie idź dalej, zgłoś. (1) bootSet.server.ts: per żądanie entry + słownik aktywnego języka + chunk komponentu trasy (+ bezpośrednie importy) + chunki widgetów nad zgięciem (widgetPreloadHeaders(doc, ABOVE_FOLD_SECTION_COUNT)) i nagłówka z root loadera; wstrzyknięcie <script type='application/json' id='nes-boot-set'> ('<' → '\\u003c') przez router.serverSsr.injectHtml, TAKŻE na ścieżce allReady (wariant bota, który PSI dostaje na MISS; isbot łapie 'Chrome-Lighthouse'); tryb afterLcp tylko dla publicznych tras SSR z kandydatem ('/', '/en', '/$'), wszędzie indziej immediate. (2) BOOT_LOADER_SCRIPT (statyczny literał w <head>, wpis allowlisty): immediate, gdy tryb serwera immediate, zapisana sesja (STORED_SESSION_EXPR z sessionHint.ts P1.7), ramka, document.prerendering lub brak PerformanceObserver; w afterLcp PerformanceObserver({type:'largest-contentful-paint', buffered:true}) przyjmuje wpis, gdy entry.element ma data-lcp-candidate albo entry.url === candidate.currentSrc, albo entry.size >= widoczne pole kandydata zmierzone przy DCL; mniejsze wpisy (tekst przy font-display: swap) ignorowane; potem setTimeout(boot, 50); load czeka jeszcze 500 ms; pierwsze pointerdown/keydown/touchstart/focusin (capture) → boot natychmiast; brak kandydata przy DCL albo error obrazu → rAF+setTimeout(0); twardy limit DCL+3 s. boot() wstawia <link rel=modulepreload> całej listy i <script type=module src=entry>; setTimeout(0) przed hydrate w router.tsx zostaje. (3) Link: frameworkPreloads.server.ts nie kopiuje modulepreload; rootHead.ts, __root.tsx, widgetPreloads.ts, index.tsx nie emitują JS dla dokumentów afterLcp (zostają CSS, fonty, obraz kandydata). (4) bootProbeScript: watchdog __nesBootDead (15 s) od startu bootu. (5) Testy e2e boot-home i boot-timing przepisane na zestaw bootu i brak modulepreload w Link; documentWeight.ts czyta domknięcie z #nes-boot-set; budżety modulepreloadCount, preloadedJs*, linkHeaderEntries w dół. PLAN B: transformacja strumienia dokumentu w src/server.ts (po applyDeferredDocumentStore/guardDocumentResponse): usunięcie modulepreload i <script type=module src=/assets/index-*> z głowy oraz modulepreload z Link, wstrzyknięcie bootstrapu i zestawu PLUS deterministyczne przepisanie listy preloadów/skryptów w odwodnionym manifeście ($tsr). KRYTERIUM PORZUCENIA: plan B bez zielonego dowodu parytetu po 1 dniu → P2.1 odroczone i zgłoszone orkiestratorowi (nie zgaduj dalej). Dowód: DWA ramiona rozgrzewki (--warm-ua browser i --warm-ua bot, te same progi): mobile FCP <= 1,6 s, LCP <= 2,4 s, scriptBytesEndedBeforeObsLcp = 0 (bez /~flock.js), start burstu po observedLargestContentfulPaint we wszystkich przebiegach, CLS <= 0,001; dodatkowo fixture z widoczną powłoką zgód (pierwsza wizyta) i wariant z różnymi okładkami leadów (P1.4); desktop FCP <= 0,45 s; curl -sI na artefakcie: Link bez modulepreload; test:e2e:artifact zielone; e2e user-paths: zalogowany i edytor bootują natychmiast. TBT: wzrost = sprzężenie, rozliczane bramką fali (PLAN-FALE-1-2.md §3.3 pkt 5)."
    }
  ]
}
```

## 3. Prompty samodzielne (bez skryptu fali)

Wspólne nagłówki implementatora i recenzenta jak w `PROMPTY-FALA-1.md` §3 (z `perf/w2-<id>` i
`$SCRATCH/phase2/wave2/<id>/`). Każdy prompt implementatora = nagłówek + blok `notes` pozycji z §2 + poniższe
uzupełnienia; każdy prompt recenzenta = nagłówek + poniższe soczewki dodatkowe.

### P2.1 – boot po LCP

Implementator: zacznij od spike'u parytetu (pkt 0) i zapisz jego wynik w IMPL.md zanim dotkniesz czegokolwiek
poza `scripts/lib/bootAfterLcpPlugin.ts` i testem `viteChunkParity`; każdy z punktów 1–5 osobnym commitem; pomiar w
dwóch ramionach rozgrzewki; nie zmieniaj doktryny `setTimeout(0)`. Recenzent: wariant bota ma `#nes-boot-set` i
boot po LCP tak samo jak przeglądarka; zalogowany/edytor/ramka podglądu bootują natychmiast; wyścig z tekstem jako
pierwszym wpisem LCP; `/~flock.js` wykluczony jawnie z metryki; CLS przez leniwe granice bez chunku (chunki
widgetów nad zgięciem w tym samym burście); watchdog; budżety `document-weight` tylko w dół.

### P2.2 – wyspy sekcji i stopki

Implementator: najpierw audyt providerów nad wyspą (ThemeProvider, I18nextProvider, AccessContext,
AboveFoldProvider, builder mode, device) pod kątem aktualizacji Default/Sync – wynik w IMPL.md; potem sekcje ≥ 1,
potem stopka, potem motyw. Recenzent: spróbuj wywołać client-render wyspy (przełączenie motywu, języka, urządzenia,
auth przed hydratacją); nieuwodnione kliknięcia; sekcja z TOC bez wyspy; HTML serwera bez fallbacków; INP
pierwszej interakcji (jedno zadanie na klatkę).

### P2.3 – nagłówek w oknie

Implementator: bez edycji prymitywu; parytet SSR nagłówka (doktryna chrome); e2e `header-intent`. Recenzent:
resize 412 → 1350 px w trakcie ładowania, dostępność (focus wyzwala hydratację, klawisz `/`), zalogowany widzi
awatar po boocie, brak `vendor-radix` u gościa przed interakcją.

### P2.4 – hydratacja per widget i animacje

Implementator: kolejność (b) HW-2 z sondą parytetu, (b') StyleSink per widget, (g) animacje wg atrybucji P0.5,
potem (a), (d), (e), (f), (h). Recenzent: kaskada niewarstwowa vs warstwowe `!important`, zagnieżdżone renderery z
różnym urządzeniem, wartości autora przez whitelistę (`unset` przez `var()`), pamięć cache `cn`, ikony spoza
zestawu, sonda `getComputedStyle` pusta w trybie jasnym i ciemnym.

### P2.5 – dieta dehydratacji

Implementator: projekcje w funkcjach zapytań, konsumenci bez zmian kształtu widocznego; test `dehydratedPayload`;
`keepPreviousData` dla tickera. Recenzent: SSR, hydratacja i refetch z tym samym kształtem; testy
`menu-with-items` (SiteMenu, MenuManager, ssrCacheL2, sectionPrefetch); miękka zmiana języka; `check:ssr-budgets`
i `check:loader-policy`.

### P2.6 – dieta znaczników

Implementator: klasy zamiast inline style w trzech miejscach, kropki slidera kompozytorowo, katalogi testów.
Recenzent: kaskada klas tam, gdzie inline wygrywał (sonda parytetu z P2.4 obejmuje te elementy), parytet SSR,
`htmlRawBytes` w dół, audyt `non-composited-animations` bez kropek.
