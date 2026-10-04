# Prompty fali 1 (do uruchomienia na polecenie właściciela)

Wszystkie prompty zakładają repozytorium `/home/user/neweustrategies-dc633fb5` (dalej `WT`), gałąź PR
`perf/pagespeed-mobile85-desktop95-t595d6` jako bazę worktree, katalog roboczy `$SCRATCH` i skrypt
`docs/performance/2026-10-03-pagespeed-85-95/faza2/workflow-faza2-wave.js`, który sam dokłada reguły repo
(`COMMON`), etapy recenzji, poprawek i dowodu oraz stopkę commita. Plan: `faza2/PLAN-FALE-1-2.md` §2.

## 1. Kroki przed falą (orkiestrator, pod `$SCRATCH/.heavy-lock`)

```bash
cd $WT && git fetch origin main && git merge --no-ff origin/main   # baza fali = main + PR #469
until mkdir $SCRATCH/.heavy-lock 2>/dev/null; do sleep 20; done; trap 'rmdir $SCRATCH/.heavy-lock' EXIT
bun run build:smoke
export LIGHTHOUSE_CLI=$SCRATCH/tools/node_modules/lighthouse/cli/index.js CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
node scripts/performance/lighthouse-local.mjs --root . --runs 5 --forms mobile,desktop4x \
  --client-backend fixture --third-party fake-gtag --save-artifacts \
  --save-baseline --baseline-out docs/performance/2026-10-03-pagespeed-85-95/lighthouse-local-baseline-w1.json --label base-w1
node scripts/performance/lighthouse-local.mjs --compare . . --runs 4 --forms mobile,desktop4x \
  --client-backend fixture --third-party fake-gtag --label aa-w1      # A/A: linie AA i PAIRS (σΔ, MDE)
rmdir $SCRATCH/.heavy-lock
rsync -a --exclude node_modules $WT/ $SCRATCH/base-w1/ && ln -s $WT/node_modules $SCRATCH/base-w1/node_modules
```

Zapis do `POMIAR.md`: mediany bazy W1, σΔ i MDE dla TBT mobile i desktop4x (n = 4 pary). Pozycje z `prove: true`
porównują się z `$SCRATCH/base-w1`.

## 2. Argumenty dla `workflow-faza2-wave.js`

Wywołanie (ultracode): `Workflow({scriptPath: "<ścieżka do workflow-faza2-wave.js>", args: <blok JSON>})`. Limit
2 agentów na workflow, więc partia 1 idzie jako dwa workflowy, partia 2 jako dwa (P1.1 + P1.7, potem P1.3).

### Partia 1a: P1.0b + P1.6

```json
{
  "wave": 1,
  "base_ref": "perf/pagespeed-mobile85-desktop95-t595d6",
  "baseline_wt": "/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad/base-w1",
  "items": [
    {
      "id": "P1.0b",
      "prove": false,
      "notes": "Pozycja spoza PLAN.json (pozostałość P0.6, zob. faza2/PLAN-FALE-1-2.md §0). Pliki: src/routes/api/public/vitals.ts, src/routes/api/public/-vitals.test.ts, supabase/migrations/<ts>_web_vitals_edge_inp.sql (nowa), src/integrations/supabase/types.ts (regeneracja narzędziem repo). Zakres: walidacja i zapis edgeCache (HIT|STALE|MISS|BYPASS), edgeLayer (L1|L2|L3|render), colo (^[A-Z]{3}$), inpEvent (pointerdown|pointerup|click|keydown|keyup|other), inpPreHydration (boolean), inpSinceLoad (int, |x| <= 86400000); withoutNavigationContext zrzuca nowe kolumny po PGRST204/42703; komentarz MAX_BODY: 877 na próbkę, 7037 na batch; kolumny edge_cache, edge_layer, colo, inp_event, inp_pre_hydration, inp_since_load_ms z CHECK wg wzorca 20260920121000_web_vitals_navigation_context.sql; test kontraktu Server-Timing: wartość budowana przez src/lib/http/ssrTiming.ts (nes-layer;desc, colo;desc za nes-edge) musi być czytana przez readNavigationContext() z src/lib/webVitals.ts – słownik warstw uzgodnić (P0.4 emituje L1|L2|render). Bramki: vitest -vitals + webVitals, check:ownership (migracja ma właściciela), verify:static, typecheck. Przed migracją załaduj skill anthropic-skills:supabase-postgres-best-practices."
    },
    {
      "id": "P1.6",
      "prove": false,
      "notes": "API P0.3 jako scalone: enqueue(task, {priority, target?, release: 'interaction'|'immediate'}), onQuiescent(task, {priority}), onFirstInteraction(cb); klasy shell→island-target→header→islands→overlays→analytics. Zwolnienie bramki wyspy: enqueue(open, {priority:'islands', target: root}) dla interaction:'any'; release:'immediate' (+ island-target gdy cel = wyspa) dla IO, ownEvents, media, globalKeys; onQuiescent(open, {priority:'islands'}) jako zapas. Bramka otwiera się dopiero po Promise.all(chunks). data-island-state DOKŁADNIE 'pending' i 'hydrated' (kontrakt RUM P0.6, src/lib/webVitals.ts). useViewportDevice = lustro useState + startTransition, NIE useSyncExternalStore. Kontrole negatywne obowiązkowe (wariant uSES ze snapshotem desktop/mobile i leniwym chunkiem, urządzenie przez kontekst) muszą wykryć client-render. Wyłączone w builderze/editorPreview. Tylko nowe pliki w src/lib/performance/."
    }
  ]
}
```

### Partia 1b: P1.2 + P1.4

```json
{
  "wave": 1,
  "base_ref": "perf/pagespeed-mobile85-desktop95-t595d6",
  "baseline_wt": "/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad/base-w1",
  "items": [
    {
      "id": "P1.2",
      "prove": true,
      "runs": 5,
      "forms": "mobile,desktop4x",
      "lh_flags": "--client-backend fixture --save-artifacts",
      "notes": "StyleSink porównuje surowy string (React 19 porównuje {__html} po tożsamości obiektu, więc dziś każdy re-render przepisuje 26,6 KB arkusza :root). hardenStyleCss wołane W TYM SAMYM PLIKU co <style dangerouslySetInnerHTML={{__html: hardenStyleCss(css)}}> – bramka check:dangerous-html, zero wpisów allowlisty. Zastosować w DesignTokensStyle, ThemeOptionsStyle, ThemeDesignStyle, ThemeFontSizesStyle, ContentAreaStyle i dwóch blokach <style> nagłówka; data-css-hash zachowany (test parytetu SSR/klient). Header.tsx: bez zapisu --sticky-header-h na <html> przy montażu, gdy |zmierzona − domyślna| < 2 px; domyślne per breakpoint w styles.css = zmierzone (fixture mobile 107 px; produkcja z zapisanego HTML w docs/.../lighthouse/). NIE ruszać measure(), document.fonts.ready ani [id]{scroll-margin-top}. Część font_scale porzucona (werdykt H2). Test z MutationObserver: re-render rodzica z identycznym CSS = 0 mutacji childList w <style>. Dowód: w księdze B brak zadania UpdateLayoutTree+Layout po mutacji data-brand-tokens i brak zadania metryk nagłówka; mediana ΔTBT <= 0."
    },
    {
      "id": "P1.4",
      "prove": true,
      "runs": 3,
      "forms": "mobile",
      "lh_flags": "--client-backend fixture --save-artifacts",
      "notes": "lcpCandidates(doc) czysta (tylko imageSlot + typy; check:entry-purity), maks. 2 kandydatów (największy slot desktopowy w pierwszej sekcji z widgetem obrazowym; pierwszy wg order.mobile), wykluczenia jak heroImage.ts. priority tylko dla kandydata (slider priority={isLcp && i===0}), reszta loading=lazy fetchpriority=auto; img kandydata dostaje data-lcp-candidate. Preload: react-dom preload(href,{as:'image', imageSrcSet, imageSizes, fetchPriority:'high'}) zamiast imagePreloadLink – dokładnie jeden preload obrazu; nagłówek Link karmiony kandydatem. Bramka check-document-weight: imgFetchpriorityHigh <= 2, preload = srcset/sizes kandydata, brak eager poza kandydatem i logo, metryka preLcpTransferBytes; kontrola negatywna w document-weight.test.mjs (7 obrazów high → czerwone). Wiersz w scripts/taxonomy/features.mjs (cms-builder-images); check:feature-taxonomy. Przepisanie testów kontraktu streaming/mediaWidgetsBranches/homeRoute świadome i opisane w IMPL. Dowód: ΔLCP >= −0,02 s, jeden largestContentfulPaint::Candidate = img[data-lcp-candidate] we wszystkich przebiegach, CLS <= 0,001."
    }
  ]
}
```

### Partia 2a: P1.1 + P1.7

```json
{
  "wave": 1,
  "base_ref": "perf/pagespeed-mobile85-desktop95-t595d6",
  "baseline_wt": "/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad/base-w1",
  "items": [
    {
      "id": "P1.1",
      "prove": true,
      "runs": 5,
      "forms": "mobile,desktop4x",
      "lh_flags": "--third-party fake-gtag --client-backend fixture --save-artifacts",
      "notes": "Konsument prymitywów P0.3 (src/lib/performance/): sygnał (c) w gtagLoadPolicy.ts → onQuiescent(fire, {priority:'analytics'}); sygnał interakcji → enqueue(fire, {priority:'analytics'}); sygnał zapisanej decyzji → enqueue(fire, {priority:'analytics', release:'immediate'}); fire idempotentne; własne URL-e gtag przez registerOwnedRequest. Test negatywny: programowy scroll elementu (autoodtwarzana karuzela) NIE jest interakcją. TP-2 najpierw: ga4SsrSnippet(measurementId, adsId) bez gtag('config', AW), Consent Mode default z wait_for_update:500 bajt w bajt; ga4ConfigureAds(adsId) idempotentne (flaga modułu + skan window.dataLayer na ['config', adsId]) wołane po ga4ConsentUpdate w tym samym efekcie ConsentScriptInjector, tylko gdy categories.marketing === true. Nagłówek modułu: kompromis + uzasadnienie Lantern + zgoda właściciela (ORCHESTRATOR-NOTES). Dowód: księga B bez zadań i żądań googletagmanager/google-analytics we wszystkich przebiegach; mediana ΔTBT < 0 (n=5, MDE z A/A); FCP/LCP ±0,02 s; e2e: brak gtag przed load+5 s+okno, page.mouse.down() ładuje gtag jako ostatni element kolejki w <= 1 s, brak config AW- w dataLayer przed zgodą marketingową."
    },
    {
      "id": "P1.7",
      "prove": true,
      "runs": 5,
      "forms": "mobile,desktop4x",
      "lh_flags": "--client-backend fixture --save-artifacts",
      "notes": "Lista zadań P0.5 (faza2/PLAN-FALE-1-2.md §1, raporty/P0.5-robocze/rep-mobile.md): K9 przebieg korzenia 92 ms sym. (TLA słownika i18n + hydrateRoot), K10 createRouter 62 ms, zadanie timera (ciało setTimeout(0) przed hydrate w src/router.tsx). Doktryna setTimeout(0) zostaje (literał pilnowany przez router.test.tsx i check:ssr-budgets) – zmienia się ciało: router i store'y w pierwszym makrozadaniu, hydrateRoot w zagnieżdżonym setTimeout(0); bez scheduler.postTask na ścieżce krytycznej (Safari). Jeśli przebieg korzenia to TLA słownika (src/lib/i18n.ts) – słownik ładowany przed hydrate w osobnym zadaniu; zapisy store'ów w trakcie hydratacji → efekt pasywny lub startTransition. TP-5 bez consent.ts: useAuth nie dotyka supabase gdy !hasStoredAuthSession() && !urlHasAuthParams() (?code=, #access_token, refresh_token, type=recovery|magiclink, error_description); onSupabaseClientCreated(cb) w client.ts podpina onAuthStateChange przy utworzeniu klienta; nasłuch storage dla sb-*-auth-token. sessionHint.ts: hasStoredAuthSession(), STORED_SESSION_KEY_RE, STORED_SESSION_EXPR (fragment tekstu dla skryptów inline, używa go P2.1) przeniesione z useAuth.tsx bez zmiany zachowania. Dowód: zadania z listy znikają albo dzielą się na kawałki < 12,5 ms obs w B; mediana ΔTBT <= 0; e2e: anonim na / bez żądań /auth/v1, zalogowany reload rozwiązuje sesję i role, magic-link loguje."
    }
  ]
}
```

### Partia 2b: P1.3

```json
{
  "wave": 1,
  "base_ref": "perf/pagespeed-mobile85-desktop95-t595d6",
  "baseline_wt": "/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad/base-w1",
  "items": [
    {
      "id": "P1.3",
      "prove": true,
      "runs": 5,
      "forms": "mobile,desktop",
      "lh_flags": "--client-backend fixture --save-artifacts",
      "notes": "Kolejka P0.3 zwalnia się na pointerdown, więc zadanie 'shell' może podmienić powłokę przed pointerup/click tego samego dotknięcia (recenzja P0.3, ustalenie 1): decyzję utrwala delegowany click na [data-consent-action] niezależnie od podmiany, a baner montowany z kolejki podmienia drzewo dopiero po pointerup (lub w następnej klatce po click). CONSENT_INIT_SCRIPT zaraz po THEME_INIT_SCRIPT (statyczny literał, wpis w dangerousHtmlAllowlist.ts): html[data-consent-decided] z localStorage['consent:v2'] (version === CONSENT_VERSION) lub cookie nes_cookie_consent; wyrażenie ważności i serializator eksportowane z src/lib/ads/consent.ts jako fragmenty tekstu (wzorzec themeChoice.ts). ConsentShell w SSR i pierwszym renderze: te same klasy i geometria, teksty z odwodnionych ustawień privacy + i18n, inline SVG, ukrywanie wariantem Tailwind [html[data-consent-decided]_&]:hidden (bez :has(), bez edycji styles.css), data-nosnippet, te same role i etykiety ARIA, przeniesienie fokusu przy podmianie. Interaktywny ConsentBanner przez enqueue(mount, {priority:'shell'}), natychmiast przy kliknięciu 'ustawienia', w ostateczności onQuiescent. Geometria vs LCP: test e2e przy 412×823@1,75 i 1350×940@1 – pole największego bloku tekstu powłoki < widoczne pole img[data-lcp-candidate]. TP-4 tylko części niewidoczne: NewsletterPopup.prepare() na pierwszy scroll/pointermove/touchstart, import cacheBusting przez onQuiescent(…, {priority:'overlays'}), PopupHost bez montażu gdy SSR mówi 'brak aktywnych popupów' bez nowego zapisu dehydratacji; Toaster bez zmian; TP-5 w consent.ts → P3.1. +2–3 KB HTML osobnym commitem z pomiarem check-document-weight. Dowód: cookie decyzji → powłoka display:none na zrzucie przy FCP; klik w powłoce przed hydratacją → rekord zapisany natychmiast (bajt w bajt jak baner, poza znacznikiem czasu), nawigacja MPA przed bootem → baner nie wraca; observedSpeedIndex mobile −0,1…−0,3 s albo baner w pierwszej klatce treści histogramu filmstripu; element LCP = img[data-lcp-candidate]; brak chunków ConsentBanner/vendor-lucide/NewsletterDocRenderer/JoinUsForm w network-requests do końca śladu; CLS <= 0,001."
    }
  ]
}
```

## 3. Prompty samodzielne (bez skryptu fali)

Każdy prompt implementatora poprzedza wspólny nagłówek:

> Jesteś starszym inżynierem (Opus) wdrażającym JEDNĄ pozycję planu wydajności pod nadzorem orkiestratora
> Fable 5.1 w platformie TanStack Start + React 19 + Vite 7 + Nitro (Cloudflare Workers) + Supabase. Cel całości:
> Lighthouse/PSI mobile ≥ 85, desktop ≥ 95 dla https://neweuropeanstrategies.com/. Przeczytaj w tej kolejności:
> swoją pozycję w `faza1/PLAN.json` i `faza1/PLAN.md` (§1.3, §2, §4), `faza2/PLAN-FALE-1-2.md` (§0–§2),
> `faza1/ORCHESTRATOR-NOTES.md`, `EVIDENCE.md` §0-cloud, raport strumienia i werdykty, które cytuje pozycja,
> raporty IMPL fali 0 w `faza2/raporty/`. Zasady repo: polski w komentarzach, dokumentach i commitach (tryb
> rozkazujący), TypeScript strict, bez nowych zależności, prettier, parytet SSR/hydratacji bajt w bajt, doktryna
> grafu chunków (`scripts/lib/bootVendorSplit.ts`), `setTimeout(0)` przed hydrate w `src/router.tsx` zostaje,
> i18n tylko przez słowniki, każda zmiana zachowania ma test vitest, AGENTS.md obowiązuje. Dotykasz WYŁĄCZNIE
> plików swojej pozycji; potrzeba innego pliku = wpis `out_of_ownership_needs`, nie edycja. Maszyna: 4 CPU, 15 GB;
> `typecheck` raz na rundę pod `$SCRATCH/.heavy-lock`, build i Lighthouse tylko pod mutexem i przy load ≤ 4.
> Worktree: `git -C $WT worktree add -B perf/w1-<id> $SCRATCH/wt/<id> perf/pagespeed-mobile85-desktop95-t595d6`
> i `ln -s $WT/node_modules $SCRATCH/wt/<id>/node_modules`. Commit z polskim komunikatem i dosłowną stopką
> `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` / `Claude-Session:
https://claude.ai/code/session_01M84vURVZ4xnvk1AVmdDF5B`. Na koniec `$SCRATCH/phase2/wave1/<id>/IMPL.md`.

Każdy prompt recenzenta poprzedza wspólny nagłówek:

> Jesteś recenzentem kontradyktoryjnym (Opus). Spróbuj OBALIĆ, że pozycja `<id>` w worktree `$SCRATCH/wt/<id>`
> (commit podany przez implementatora, raport IMPL.md) jest poprawna, kompletna i bezpieczna. Soczewki:
> zgodność z mechanizmem z `PLAN.json` i `PLAN-FALE-1-2.md`; parytet SSR/hydratacji; doktryna chunków i bramki
> (`verify:static`, `check:chunks`, `check:entry-purity`, `check:ssr-budgets`, `check:loader-policy`,
> `check:dangerous-html`, `noHasSelectors`); regresje dla zalogowanych, redaktorów, i18n, SEO, CLS, a11y,
> prywatności; jakość testów (czy test naprawdę ćwiczy zachowanie; kontrole negatywne); realizm efektu w modelu
> Lantern. Uruchamiaj testy pozycji i lekkie komendy; bez typecheck i buildu. Każde ustalenie: waga
> (blokujące/istotne/drobne), `plik:linia`, dowód, poprawka. Zapisz `$SCRATCH/phase2/wave1/<id>/REVIEW.md`.

### P1.0b – API web-vitals i migracja

Implementator: wykonaj zakres z bloku `notes` partii 1a. Dodatkowo: przed migracją załaduj skill
`anthropic-skills:supabase-postgres-best-practices`; kolumny opcjonalne, `CHECK` na słowniki, bez indeksów (tabela
append-only); nie zmieniaj kształtu istniejących kolumn; `MAX_BODY` bez zmian (8 000). Testy: odrzucenie wartości
spoza słownika z czytelnym kodem, zapis kompletnej próbki, retry `withoutNavigationContext` bez nowych kolumn.
Recenzent: sprawdź zgodność słowników z `src/lib/webVitals.ts` i `src/lib/http/ssrTiming.ts` (L3?), brak
identyfikatorów, że migracja jest idempotentna (`IF NOT EXISTS`) i ma właściciela (`check:ownership`).

### P1.1 – gtag poza śladem

Implementator: zakres z bloku `notes` partii 2a; kolejność prac: (1) TP-2 (snippet SSR bez `config AW`,
`ga4ConfigureAds`), (2) TP-1 (prymitywy P0.3), (3) e2e `third-party-quiescence.spec.ts` ze stubem gtag, (4) dowód
A/B z `--third-party fake-gtag`. Nie zmieniaj sygnatury `ga4SsrSnippet` ani `__root.tsx`. Recenzent: zweryfikuj
kolejność komend w kolejce gtag (config AW po consent update), skan `dataLayer` na podwójny config z HTML-a w cache,
że nic nie ładuje gtag przed punktem ciszy w śladzie (księga B), negatywny test scroll elementu, GPC → marketing
false.

### P1.2 – StyleSink i nagłówek

Implementator: zakres z bloku `notes` partii 1b. Zacznij od `StyleSink.tsx` z testem MutationObserver, potem
migruj pięć arkuszy korzenia, potem `Header.tsx` (progi 2 px, wartości domyślne w `styles.css`). Recenzent:
`check:dangerous-html` bez wpisów allowlisty, `data-css-hash` identyczny SSR/klient, brak zmian w `measure()`,
kotwice `[id]` nie przesuwają się o więcej niż 2 px (test Header), księga B bez zadania metryk nagłówka.

### P1.3 – powłoka zgód z SSR

Implementator: zakres z bloku `notes` partii 2b; kolejność: (1) `consentInitScript.ts` + testy happy-dom
(decided/undecided/zły JSON/zła wersja/cookie/GPC), (2) `ConsentShell` + parytet + a11y, (3) delegowany `click`
utrwalający decyzję (rekord bajt w bajt jak baner), (4) montaż banera z kolejki `shell` i podmiana po
`pointerup`, (5) TP-4, (6) e2e geometrii, (7) osobny commit na +2–3 KB HTML z pomiarem `check-document-weight`.
Recenzent: równoważność prawna zapisu (ten sam JSON, wersja, kategorie, Consent Mode update), odwiedzający z
decyzją nigdy nie widzi powłoki, brak `:has()`, `data-nosnippet`, fokus po podmianie, INP pierwszej interakcji,
brak nowego zapisu dehydratacji (`check:ssr-budgets`), LCP nadal `img[data-lcp-candidate]`.

### P1.4 – jeden kandydat LCP

Implementator: zakres z bloku `notes` partii 1b; kolejność: (1) `lcpCandidate.ts` + testy czystej funkcji,
(2) przewleczenie `lcpWidgetIds` przez `AboveFoldProvider` i `priority` w rendererach, (3) preload react-dom w
trasach, (4) bramka w `documentWeight.ts`/`check-document-weight.ts` z kontrolą negatywną, (5) taksonomia.
Recenzent: `check:entry-purity` (moduł bez importów zapytań), strona bez obrazu w sekcji 0, kolejność kolumn na
mobile (drugi kandydat wg `order.mobile`), parytet SSR, że preload i `<img>` mają identyczny `srcset\nsizes`
(dokładnie jeden preload), `imgFetchpriorityHigh ≤ 2` na fixture i na zapisanym HTML produkcji.

### P1.6 – prymityw wysp

Implementator: zakres z bloku `notes` partii 1a; test wzorowany na `src/hooks/__tests__/authHydration.test.tsx`
(HTML SSR zachowany przy aktualizacjach auth, motywu, i18n, zapytań i urządzenia w transition; po otwarciu bramki
hydratacja bez mismatch; 0 `console.error`). Recenzent: spróbuj doprowadzić do client-renderu wyspy (aktualizacja
Default/Sync z providera nad wyspą, uSES, zagnieżdżony `lazy` bez chunku); sprawdź, że obie kontrole negatywne
naprawdę wykrywają client-render, że `data-island-state` ma tylko dwie wartości i że żaden wyzwalacz nie otwiera
bramki synchronicznie w handlerze zdarzenia.

### P1.7 – poprawki korzenia i szybka ścieżka auth

Implementator: zakres z bloku `notes` partii 2a; lista zadań zatwierdzona przez orkiestratora = §1
`PLAN-FALE-1-2.md` (K9, K10, timer). Zmierz każdą poprawkę osobno w księdze (`--save-artifacts`) i raportuj
zadania przed/po. Recenzent: literał `setTimeout(0)` zostaje, mismatch hydratacji (test authHydration, AuthGate),
magic-link/OAuth/recovery ładują SDK natychmiast, cross-tab (`storage`), `STORED_SESSION_EXPR` bezpieczny jako
fragment skryptu inline (bez interpolacji danych), księga B bez zadania timera > 12,5 ms obs.
