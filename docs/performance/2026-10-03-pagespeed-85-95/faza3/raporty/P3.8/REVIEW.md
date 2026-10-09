# P3.8 (fala 3) - recenzja adwersaryjna

Data: 2026-10-08. Worktree `$SCRATCH/wt3/P3.8`, commit `97ae43c1` (1 commit nad `claude/zen-ritchie-hzur21`),
29 plików, +1379/-81. Recenzja tylko do odczytu (bez edycji, typecheck, buildu i Lighthouse'a).

Uwaga o prośbie użytkownika przekazanej przez harness („jeden font - ma to być Red Hat Display”): ta pozycja jej nie
dotyczy. To decyzja właściciela przypisana do P3.2b, a P3.8 nie dotyka `@font-face`, preloadu ani krojów pisma.
`fontScale` z #1 to tabela ROZMIARÓW (`--fs-*`), nie krój, więc nie ma tu konfliktu.

## Werdykt: APPROVE (bez blokad); 1 uwaga major (zalecana poprawka w tej rundzie), 7 minor

Mechanizm jest zgodny z notą orkiestratora. Wszystkie punkty obowiązkowe #1-#4b są zrobione. Warunkowe #5-#7 też są
zrobione, a każde odstępstwo (#6 „zatrzask” zamiast „intencji”, #7 bez zasiewu `inline`, #3 bez wariantu b) ma podany
powód w IMPL §3. Żaden plik nie wychodzi poza listę P3.8. W `__root.tsx` zmieniono tylko rozgrzewkę fali 1 (`fontScale`

- anulowanie + zasiew), jedną linię w fali chrome i zrobiono to jako `createIsomorphicFn`, a także
  `useNoActivePopupsFromSsr` i `useOverlayGates`. `router.tsx` zmienia się tylko w zakresie #5. Commit ma polski opis
  i trailer zgodny z wymaganiem.

## Bramki uruchomione w recenzji

| Bramka                                                                                                                | Wynik                                                                           | Log                        |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------- |
| `light.sh bunx eslint` (29 dotkniętych plików)                                                                        | 0 błędów, 6 ostrzeżeń `react-refresh/only-export-components` (wszystkie z bazy) | `review-eslint.log`        |
| `light.sh bunx vitest run` (14 dotkniętych testów + `lib/performance/__tests__`, `useFontScale`, `dehydratedPayload`) | 24 pliki, 798 passed, 1 expected fail, 0 failed                                 | `review-vitest.log`        |
| `light.sh bun run verify:static`                                                                                      | 15/15 OK (w tym `format:check`)                                                 | `review-verify-static.log` |

Graf chunków (sprawdzony na `base-w3b/reports/chunk-inventory.json`):

- `interactionOrQuiet`, `postInteractionQueue`, `whenQuiescent`, `lib/prerender`, `useFontScale`, `lib/theme/fontScale`,
  `ContentAreaStyle`, `useNewsletterSettings` i `lib/ads/queries` są JUŻ w chunku wejściowym bazy, więc nie powstaje
  żadna nowa krawędź modułu do zamknięcia bootu.
- `lib/builder/popups` zostaje w osobnym chunku: import dynamiczny jest wyłącznie w gałęzi `.server()`
  `createIsomorphicFn`, a dodatkowo stoi za `if (isServer)`.
- Przyrost bajtów dotyczy tylko kodu w `router.tsx`, `__root.tsx`, `ContentAreaStyle` i `queries.ts` (IMPL szacuje
  ~0,3-0,5 KB gz). Przy 0,6 KB zapasu `bootClosureGzipBytes` to **twardy punkt etapu Prove** (`check:document-weight`).

## Ustalenia

### M1 (major) - kotwica „od startu nawigacji” liczy też czas prerenderu (Speculation Rules)

- **Gdzie:**
  - `src/components/NewsletterPopup.tsx:50-54` (`triggerDelayMs`);
  - `src/components/popups/PopupHost.tsx:45-49`;
  - `src/components/ads/FooterSlideup.tsx:58` (`delay_ms - performance.now()`).
- **Dowód:** `lib/seo/speculationRules.ts` prerenderuje linki w treści artykułów (`$.tsx` ma `FooterSlideup`, a korzeń
  ma nakładki). W dokumencie prerenderowanym `performance.now()` liczy od startu prerenderu, a nie od aktywacji. Zatrzask
  słusznie czeka na aktywację (`afterPrerendering`), ale wszystkie trzy kotwice odejmują cały czas spędzony w tle.
- **Skutek:** czytelnik, który kliknie odsyłacz po 20 s od najechania kursorem, dostaje:
  - popup newslettera „delay 15 s” po 1 s od zatrzasku (podłoga), zamiast po około 15 s od wejścia;
  - popup buildera po 400 ms;
  - pasek dolny od razu po danych.

  Nota mówi „opóźnienie liczone od startu nawigacji”, a dla dokumentu prerenderowanego startem nawigacji jest
  `activationStart`.

- **Poprawka:** jedna funkcja pomocnicza (np. lokalnie w każdym pliku albo w `lib/prerender.ts`, jeśli orkiestrator
  dopuści plik spoza listy; inaczej trzy lokalne kopie):

  ```ts
  const nav = performance.getEntriesByType?.("navigation")[0] as
    (PerformanceNavigationTiming & { activationStart?: number }) | undefined;
  const sinceNavigation = performance.now() - (nav?.activationStart ?? 0);
  ```

  Potem użyć `sinceNavigation` zamiast `performance.now()`. Do tego jeden test jednostkowy z atrapą `activationStart`.

### m1 (minor) - `on-demand-overlays`: nowa asercja nie odróżnia starego zachowania od nowego

- **Gdzie:** `e2e-performance/on-demand-overlays.spec.ts:188-210`.
- **Dowód:** klik „Tylko niezbędne” pada zaraz po `__nesAppReady`, czyli zwykle PRZED `load`. Stary montaż
  (`afterPageLoad`, 1-2,5 s po `load`) też startowałby chunki po `beforeFirstInteraction`, więc revert P3.8 nie
  zaczerwieni tej asercji.
- **Ocena:** mechanizm dyskryminuje nowy `e2e/backend-quiet.boot-home.spec.ts` (cisza 3 s po `load`) i
  `rootShellRender.test.tsx`, więc pokrycie jest. Ta asercja jest tylko kontrolą pozytywną.
- **Poprawka:** opisać ją w komentarzu jako kontrolę pozytywną albo dodać wariant bez kliknięcia: odczekać `load` + 3 s
  i dopiero wtedy sprawdzić brak `NewsletterPopup-`/`PopupHost-`.

### m2 (minor) - sygnał popupów w fali chrome tras treści (TTFB zimnego izolatu)

- **Gdzie:** `src/routes/__root.tsx:1067` oraz `:1096-1112` (`await initialChromeWarmup` dla tras poza stroną główną).
- **Dowód:** fala chrome na trasach treści jest **czekana** przez loader (do 500 ms). `builder_popups:presence` nie ma
  L2 (`EDGE_TTL_L2_KEY_PREFIXES`), więc na zimnym izolacie jest to nowy round-trip do bazy, równoległy z menu (które mają
  L2). Może więc stać się najdłuższą nogą fali i podnieść TTFB, maksymalnie do budżetu. W stanie ustalonym (TTL 60 s,
  serve-stale do 5 min) koszt jest zerowy.
- **Poprawka (opcjonalna):** przyjąć i opisać w raporcie Prove albo nie dokładać tej rozgrzewki do zbioru czekanego na
  trasach treści (wpis i tak może dostrumieniować się później). Do zmierzenia w Prove: `db;dur` przy MISS.

### m3 (minor) - zamrożony sygnał „brak popupów” a cache dokumentu

- **Gdzie:** `src/lib/builder/popups.ts:237-253`; zapisy panelu w `usePopupsAdmin` (`:275-316`) robią tylko
  `invalidateQueries` po stronie klienta i nie czyszczą cache'u dokumentu.
- **Dowód:** po aktywacji popupu dokument na brzegu niesie `[]`:
  - do 180 s jako świeży, potem jako STALE z rewalidacją;
  - rewalidacja w oknie serve-stale projekcji (do 5 min) znowu może wypisać `[]`.

  Anonim zobaczy nowy popup po kilku minutach, a przy małym ruchu dopiero po kolejnym wejściu. IMPL §4 to opisuje,
  zespół omija bramkę (`isStaff`), a diagnoza (§3.6) przyjęła ten kompromis.

- **Poprawka:** brak wymaganej. Do rozważenia później: purge dokumentów przy zmianie `status` popupu.

### m4 (minor) - dedup w locie `fetchNewsletterSettings` może oddać dane sprzed zapisu

- **Gdzie:** `src/hooks/useNewsletterSettings.ts:197-202`.
- **Dowód:** inwalidacja po zapisie panelu w trakcie lotu (`cancelRefetch: true` anuluje obserwatora, ale nie obietnicę
  modułu) dołącza do lotu rozpoczętego PRZED zapisem i zapisuje stare ustawienia w cache'u, do kolejnego `staleTime`.
  `fetchSiteDesignTokensRow` ma ten sam wzorzec, a okno jest wąskie (setki ms).
- **Poprawka (opcjonalna):** licznik generacji podbijany przy mutacji albo dedup tylko dla wywołań z tej samej klatki.

### m5 (minor) - nawigacja SPA wywołana PIERWSZĄ interakcją liczy kotwicę od startu dokumentu

- **Gdzie:** `FooterSlideup.tsx:37` (`bootMount`) oraz `triggerDelayMs` w popupach.
- **Dowód:** zatrzask otwiera się po końcu gestu i po klatce (`enqueue`), a router nawiguje synchronicznie w kliknięciu.
  Komponent nowej trasy montuje się więc jeszcze przy zamkniętym zatrzasku (`bootMount = true`). Pasek pokaże się zaraz
  po danych zamiast po `delay_ms` od danych.
- **Ocena:** rzadkie (pierwszą interakcją jest nawigacja) i nieszkodliwe.
- **Poprawka:** brak wymaganej. Można liczyć `bootMount` także z `router.state.resolvedLocation === undefined`, ale to
  wykracza poza potrzebę.

### m6 (minor) - #5 nadrabia przy zatrzasku także zapytania z własnym `staleTime: 0`

- **Gdzie:** `src/router.tsx:93-103`.
- **Dowód:** `refetchQueries({ type: "active", stale: true })` obejmuje każde aktywne nieświeże zapytanie, także takie,
  którego `refetchOnMount` polityka nie wstrzymała. Zapytania ze `staleTime: 0` (`useClubAdmin`, `usePublishReadiness`,
  tylko panel) dostaną jedno dodatkowe pobranie przy pierwszej interakcji.
- **Ocena:** koszt pomijalny, a `cancelRefetch: false` chroni przed duplikatami w locie.
- **Poprawka:** opcjonalnie zbierać klucze wstrzymane w `bootRefetchOnMount` (Set hashy) i nadrabiać tylko je
  (`predicate`).

### m7 (minor) - brak asercji `site_font_scale` w `dehydratedPayload.test.ts`

- Diagnoza §3.1 i §5.4 proponowała dopisać `["site_font_scale"]` (i `["builder-popups-active"]`) do oczekiwanego
  `homeState`. Test przechodzi bez zmian, czyli nie przypina nowych wpisów stanu SSR.
- `rootRoute.test.tsx` pokrywa rozgrzewkę i zasiew, więc ta asercja to tylko uzupełnienie.
- **Poprawka:** dopisać asercję w Prove albo w kolejnej rundzie.

## Sprawdzone, bez zastrzeżeń

- **Hydratacja.**
  - `useOverlayGates` = `useInteractionOrQuiet()` daje `false` w SSR i w renderze hydratacji (`getServerSnapshot`).
  - `useNoActivePopupsFromSsr` czyta stan w `useState` (zamrożony). `PopupHost` i tak nie jest w HTML-u, a brak
    rozjazdu potwierdza `overlaysReady=false`.
  - `bootMount` w `FooterSlideup` jest tylko kliencki.
  - Nowe `--fs-*` w SSR pochodzą z tego samego wpisu, który klient hydratuje, więc skrót `useDeferredStyleCss` się
    zgadza i generator nie ładuje się (usunięty błąd utajony).
- **#5 (`router.tsx`).**
  - Zasiewy `updatedAt: 0` (doktryna `ssr-degradation`, `useDegradedUntilHealed`, `events.$slug`) i wpisy
    `isInvalidated` odświeżają się od razu.
  - Zapytania bez danych idą przez `shouldLoadOnMount`.
  - Serwer `true`. TDZ `refetchOnMount` jest bezpieczny, bo domknięcie woła się dopiero przy montażu.
  - Dane zalogowanych mają klucze z `userId` albo przechodzą przez inwalidację sesji, więc bez regresji.
  - Testy pokrywają wszystkie gałęzie i łączenie z lotem.
- **#4a.**
  - `edgeTtlCache` jest per host najemcy.
  - Projekcja ma ten sam filtr co `useActivePopups` (`status=active`, RLS).
  - Błąd daje brak wpisu, więc host montuje się jak dotąd. Klucz jest poza `chromeQueryKeys`, więc brak sygnału nie
    degraduje cache'u dokumentu.
  - Wpis `[]` ma `updatedAt: 0`, więc zespół pobiera listę od razu.
- **#1.** Ten sam lot `site_design_tokens:row` (single-flight + L2 trwałe chrome), więc 0 podżądań. Klucz jest
  w pętli anulowania `/` i w zasiewie.
- **#7.** Filtr minutowy jest nadzbiorem, a `isWithinEmissionWindow` zawęża okno przy projekcji, więc czytelnik nie
  zobaczy kampanii spoza okna.
- **#6.** Kolejność hooków w `JoinUsForm` jest stała. Tryb `mount` obejmuje `requireInterests` (walidacja wysyłki),
  chipsy, zapisane tematy i kanwę buildera.
- **Zgody i prywatność:** bez zmian (ten sam koordynator nakładek i bramka `marketing`).
- **i18n:** bez nowych kluczy. `/en` przez `interests-catalog` z `lang` i klucze tokenów bez języka.
- **Lantern i SI.** Usunięte są żądania i preflighty po hydratacji oraz 2 chunki nakładek po `load`, czyli praca
  sieciowa i CPU z końca śladu (`NewsletterPopup`/`PopupHost`: parsowanie i render), a nie z okna LCP. Nowa późna zmiana
  wizualna nie powstaje, o ile punkt ciszy (≥ 5 s po `load`) nie zapada przed końcem śladu Lighthouse'a. Jeśli zapadnie,
  przy zatrzasku zbiegną się w jednym zadaniu: chunki nakładek, ~5 GET-ów i nadrabiające odświeżenie z #5. Prove ma to
  rozstrzygnąć: `backend:` = 0 we wszystkich przebiegach B, a `observedLastVisualChange` bez paska ani popupu.

## Do etapu Prove (nie do sprawdzenia w recenzji)

1. `check:document-weight`: `bootClosureGzipBytes` i `bootBurstGzipBytes` (zapas 0,6 KB).
2. `check:bundle`, `check:chunks` i `check:entry-purity`: brak `lib/builder/popups` w bundlu przeglądarki z korzenia,
   czyli wycięcie `.server()` przez kompilator Start.
3. `test:e2e:artifact` (CI-like, z nowym `backend-quiet.boot-home`), `on-demand-overlays`, `popup-first-render` i
   `ssr-degradation`.
4. Lighthouse `--compare` mobile + desktop4x n=5: linia `backend:` = 0, TBT ≤ 0, CLS ≤ 0,001.
