# Scalenie P3.8 (fala 3) na gałęzi integracyjnej `integ/w3-p38`

- Worktree: `scratchpad/wt3/integ-p38`, gałąź `integ/w3-p38` z `b8bf6c14`. Ten commit to tip PR, czyli 56da8d23 +
  P3.6b 8fdfdf05 + toasty czatu ee8af71d + linki prawne a0463f1b + poprawka komentarza parytetu.
- Scalona gałąź: `perf/w3-P3.8` @ `c2697ba1` (runda 10). Baza scalenia: `d22cf7d6`.
- Commity na `integ/w3-p38`:
  - `c7f0c12d` Scalenie P3.8 (fala 3): zero zapytań Supabase z bootu anonimowej strony (merge `--no-ff`, rodzice
    `b8bf6c14` + `c2697ba1`);
  - `f2085e6c` Integracja P3.8 x P3.6b: test korzenia - zapisy SSR P3.8 nie odbierają stronie głównej zapisu do cache.
    Sam test, bez zmian w kodzie produkcyjnym.
- Repo główne, gałąź PR `claude/zen-ritchie-hzur21` i worktree innych agentów: nietknięte. Serwery z sond zostały
  zamknięte (0 procesów `.output/server/index.mjs`).

## 0. Werdykt

| Pytanie                                                                              | Odpowiedź                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Konflikty tekstowe                                                                   | **brak.** Git złożył wszystko automatycznie. Obie strony ruszały `src/routes/__root.tsx` i `src/routes/__tests__/rootRoute.test.tsx`. Wynik przeczytałem w całości w miejscach styku (§1)                                                                                |
| Czy zapisy SSR z P3.8 blokują zapis strony głównej w NES Edge Cache (predykat P3.6b) | **NIE.** Sprawdzone zapis po zapisie (§2), testem na prawdziwym loaderze korzenia (§3.1) i sondą artefaktu scalonego drzewa: MISS z `store:"stored"`, potem HIT z dokumentu czytelnika, zarówno dla czystego renderu, jak i dla B2 (§3.2)                                |
| Poprawka w kodzie                                                                    | **niepotrzebna.** Ryzyko zamknęła już runda poprawek 1 P3.6b (`builder-popups-active` w `DECORATIVE_QUERY_ROOTS`) i runda 9 P3.8 (usunięty zasiew `site_font_scale` z `updatedAt: 0`). Dołożyłem test strażnika styku, bo dotąd żaden test nie składał obu pozycji naraz |
| Bramki zlecone                                                                       | prettier, eslint, typecheck (×3), vitest (162 pliki), `verify:static`: **zielone** (§4)                                                                                                                                                                                  |
| `bootBurstGzipBytes`                                                                 | **574 829 B**, próg 574 673 B, czyli **+156 B ponad próg**. Baza PR (`base-w3c`): 574 113 B, więc P3.8 w scalonym drzewie dokłada +716 B. Zgodnie z zadaniem tego nie naprawiam: P3.7a (ok. -1,28 KB gz bootu) wchodzi przed tą integracją (§5)                          |

## 1. Scalenie: pliki obu stron i jak się złożyły

Strona P3.8 to 37 plików (+1957/-156). Strona HEAD od bazy scalenia obejmuje P3.6b, toasty czatu, linki prawne i
komentarz parytetu. Wspólne pliki są dwa: `__root.tsx` i `rootRoute.test.tsx`. Linki prawne zmieniały `Footer.tsx`,
którego P3.8 nie dotyka (P3.8 zmienia `FooterSlideup.tsx`, to inny plik). Prettier na 37 plikach: bez zmian.

### `src/routes/__root.tsx` (w scalonym wyniku są wszystkie cztery zachowania)

| Region                                                                                                                               | Właściciel   | Stan po scaleniu                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| fala 1: `ensureQueryData(fontScaleQueryOptions)` + klucz w pętli anulowania strony głównej, bez zasiewu `site_font_scale`            | P3.8         | jest; komentarz tłumaczy, czemu zasiewu nie ma (runda 9 P3.8)                                                                                                                                                            |
| zasiew `post-layout-settings` + `if (import.meta.env.SSR) markDeliberateSeed(...)`                                                   | P3.6b        | jest, nietknięty. P3.8 zmienił tylko dwa komentarze nad zasiewem: klient dociąga przy zatrzasku, nie w hydratacji                                                                                                        |
| fala chrome: `chromeWarm: Array<(budgetMs) => Promise<unknown>>`, `warmLate` za `import.meta.env.SSR`, `warm` z `work(chromeBudget)` | P3.6b        | jest, nietknięty                                                                                                                                                                                                         |
| `if (isServer) chromeWarm.push(() => warmNoActivePopupsOnServer(context.queryClient))`                                               | P3.8         | jest na **wspólnej** liście fabryk P3.6b. Fabryka bez parametru da się przypisać do `(budgetMs) => …`, więc sygnał grzeje się w `warm` i także w `warmLate` (dokładnie tak, jak przewidziała runda poprawek 1 P3.6b, m3) |
| `warmNoActivePopupsOnServer = createIsomorphicFn().server(import(...)).client(noop)`                                                 | P3.8         | jest, pod definicją `Route`                                                                                                                                                                                              |
| `useOverlayGates` → `useInteractionOrQuiet()`; `useNoActivePopupsFromSsr` z `isStaff`                                                | P3.8         | jest                                                                                                                                                                                                                     |
| komentarze Toastera i `useToasterWanted` (sonner 2.x odtwarza aktywne toasty)                                                        | toasty czatu | są. P3.8 zawęził komentarz `OVERLAY_IDLE_TIMEOUT_MS` do samego Toastera, który nadal jedyny go używa (`afterPageLoad(…, 3000)` w `useToasterWanted`). Treść spójna                                                       |

`afterPageLoad` jest nadal importowany i używany (Toaster), więc nie zostaje martwy import. eslint: 0 błędów.

### `src/routes/__tests__/rootRoute.test.tsx`

Obie strony dołożyły atrapy i testy w rozłącznych miejscach:

- P3.6b: `trackSsrQueryCompleteness`, `HOME_CHROME_LATE_BUDGET_MS`, `h.adsGate`, pomocnicy `loadExpiredHomeWithChromeDocs`
  i `suspendChromeGate`, testy `warmLate`;
- P3.8: atrapy `useFontScale`, `popups`, `useAuth`, liczniki `fontScaleFetches` i `popupWarms`, testy fali 1, sygnału
  i bramki zespołu.

Wynik: 82/82 testy zielone w wersji z commitu scalenia (`vitest-rootRoute-r0.log`, kopia pliku z `c7f0c12d`
uruchomiona obok i usunięta). Po mojej zmianie testów jest 83 (§3.1).

## 2. Interakcja P3.6b × P3.8: zapis po zapisie

**Reguły predykatu** (`src/lib/ssr/resilientLoad.ts`, `trackSsrQueryCompleteness`):

- predykat rejestruje wyłącznie loader `/` (`src/routes/index.tsx:317`, `if (isServer)`). `/en` to ta sama trasa, bo
  rewrite routera zdejmuje prefiks. Wpis, strona buildera (`$.tsx`) i inne trasy predykatu nie mają, więc liczą się
  jako kompletne, a o zapisie decyduje tylko dyrektywa `cache-control` trasy;
- przy `QueryCache.clear()` żądania predykat ocenia **każdy** wpis cache'u, z wyjątkiem korzeni dekoracyjnych
  (`ad_placements`, `builder-popups-active`):
  - `error` daje odstępstwo;
  - `success` z `dataUpdatedAt <= 0` daje odstępstwo, chyba że klucz zgłoszono przez `markDeliberateSeed`;
  - `pending` daje odstępstwo tylko wtedy, gdy wpis był pobierany po uzbrojeniu albo jest w locie. Wpis pobierany
    po uzbrojeniu, którego na końcu brak, też daje odstępstwo (`dropped`);
- niezależnie od predykatu dyrektywa `no-store` z loadera blokuje zapis przez `canStillStore()`. Dzieje się to już
  na etapie `stream`.

Każdy zapis i każde pobranie, które P3.8 dodaje albo zmienia w SSR:

| #   | Klucz / zapis                                                                                                                                                     | Kto i gdzie (P3.8)                                                                                                                | Trasy                                                      | Stan na końcu strumienia                                                                                                                                                           | Werdykt predykatu `/`                                                                                                                                                                       | Inne trasy                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1   | `["site_font_scale"]` przez `ensureQueryData(fontScaleQueryOptions)`                                                                                              | korzeń, fala 1 (#1)                                                                                                               | wszystkie                                                  | `success`, `dataUpdatedAt > 0`. `queryFn` nie rzuca: `fetchSiteDesignTokensRow` łapie błąd i daje `null`, wtedy wynikiem jest `EMPTY_FONT_SCALE`, a `normalizeFontScale` nie rzuca | **kompletny**                                                                                                                                                                               | bez predykatu; dyrektywa bez zmian                              |
| 1a  | ten sam klucz po terminie fali 1 na `/`                                                                                                                           | pętla anulowania strony głównej (#1)                                                                                              | `/`                                                        | `pending` + `idle` po anulowaniu. Pobranie startowało przed uzbrojeniem, więc predykat go nie liczy                                                                                | nie dotyczy: korzeń ustawia `private, no-store`, co blokuje zapis jak przy tokenach. Tak ma być, bo motyw jest wtedy zdegradowany. Ten sam wiersz i lot co tokeny, więc nie spóźnia się sam | —                                                               |
| 1b  | zasiew `EMPTY_FONT_SCALE` z `updatedAt: 0`                                                                                                                        | **usunięty** w rundzie 9 P3.8                                                                                                     | —                                                          | brak wpisu                                                                                                                                                                         | nie dotyczy (przed rundą 9 dałby `seed:site_font_scale`)                                                                                                                                    | —                                                               |
| 2   | `["builder-popups-active"] = []` z `updatedAt: 0` (`warmNoActivePopups`)                                                                                          | fala chrome, tylko serwer (#4a); `warm` i `warmLate`                                                                              | trasy z chrome'em, w tym `/`, `/en`, wpis, strona buildera | `success`, `dataUpdatedAt: 0` (bez aktywnych popupów). Przy aktywnym popupie albo błędzie projekcji brak wpisu                                                                     | **dekoracja**: `DECORATIVE_QUERY_ROOTS` (P3.6b, runda poprawek 1). Brak wyjątku dałby `seed:builder-popups-active` na każdym `/` u najemcy bez popupów, czyli zero zapisów strony głównej   | bez predykatu; błąd pochłania `allSettled`, dyrektywa bez zmian |
| 3   | `["post-layout-settings"]`, zasiew domyślnych z `updatedAt: 0`                                                                                                    | korzeń; P3.8 zmienił tylko komentarz, a obserwator `ContentAreaStyle` dostał `enabled: useInteractionOrQuiet()` (serwer: `false`) | wszystkie                                                  | `success`, `dataUpdatedAt: 0`                                                                                                                                                      | **celowy zasiew** (`markDeliberateSeed`, P3.6b)                                                                                                                                             | bez predykatu                                                   |
| 4   | `["newsletter-settings","inline"]` (i pełny klucz)                                                                                                                | prefetch widgetu z rejestru (bez zmian); P3.8 przeniósł ciało `queryFn` do leniwego `newsletterSettingsData.ts`                   | trasy z sekcją newslettera / join-us                       | `success`, `dataUpdatedAt > 0`. Semantyka błędu ta sama co w bazie: `PGRST116` toleruje, inny błąd rzuca. Na serwerze bez dedupu                                                   | kompletny (błąd backendu: `error:newsletter-settings.inline`, tak samo jak przed P3.8)                                                                                                      | bez predykatu                                                   |
| 5   | `ad_placements` (`header_banner` w fali chrome; `footer_slideup` w `FooterSlideup` z `enabled` od zatrzasku, czyli na serwerze wyłączony)                         | P3.8 zmienił okno emisji w URL (nadzbiór minuty), klucz bez zmian                                                                 | strony z banerem / paskiem                                 | dekoracja                                                                                                                                                                          | **dekoracja**                                                                                                                                                                               | —                                                               |
| 6   | obserwatory z `enabled: false` na serwerze: katalog zainteresowań (`latch`/`off`), `ContentAreaStyle`, pasek dolny                                                | P3.8 (#3, #2, #6)                                                                                                                 | formularze, korzeń                                         | `pending` + `idle` bez pobrania (albo wpis zasiany)                                                                                                                                | pomijane (obserwatory renderu bez pobrania). Żaden z nich nie jest `useSuspenseQuery`                                                                                                       | —                                                               |
| 7   | `refetchOnMount` w oknie bootu (`router.tsx`), odroczony prefetch sekcji (`useSectionPreload`), kotwica `sinceNavigationStart`, `carouselDefaults` przez `notify` | P3.8                                                                                                                              | klient                                                     | na serwerze `refetchOnMount: isServer \|\| …` = `true` (bez zmian); reszta to efekty klienta i mutacje panelu                                                                      | nie dotyczy                                                                                                                                                                                 | nie dotyczy                                                     |

Wniosek: na `/` i `/en` każdy zapis P3.8 jest kompletny (1, 4), dekoracyjny (2, 5) albo celowy (3). Na wpisie i
stronie buildera predykatu nie ma, a P3.8 nie zmienia tam dyrektywy `cache-control`. Odmowy zapisu z powodu P3.8
nie ma. Jedyny przypadek `no-store` (1a) to zamierzona degradacja motywu, ta sama klasa co tokeny.

## 3. Dowód

### 3.1 Test strażnika na prawdziwym loaderze korzenia (`f2085e6c`)

`rootRoute.test.tsx`, przypadek „strona główna: zapisy SSR korzenia z P3.8 nie odbierają kompletnemu dokumentowi
zapisu”:

- prawdziwy `Route.options.loader` na `/` w SSR (`h.server`, `vi.stubEnv("SSR", true)`, czyli działają też
  `markDeliberateSeed` i `warmLate`);
- prawdziwe `warmNoActivePopups` z P3.8. Atrapą jest tylko odpowiedź projekcji obecności: `edgeTtlCache` dla klucza
  `builder_popups:presence`, pozostałe klucze idą prawdziwą funkcją;
- prawdziwy `trackSsrQueryCompleteness`, uzbrojony przed korzeniem, czyli ostrzej niż w produkcji, gdzie uzbraja
  koniec loadera `/`;
- zamrożenie sprzątaniem integracji (`cancelQueries()` + `clear()`).

Przesłanki sprawdzane jawnie:

- sygnał to `[]` z `dataUpdatedAt: 0`;
- `font-scale` to `success` z `dataUpdatedAt > 0`;
- `post-layout-settings` ma `dataUpdatedAt: 0`;
- brak `private, no-store`.

Wynik: `{ complete: true, reasons: [] }`.

Zmiany w atrapach są celowo wąskie:

- flaga `h.themeRow`: prawdziwe `queryFn` tokenów i kolorów nigdy nie oddaje `null`, a domyślna atrapa oddaje `null`,
  na czym stoją testy zasiewów;
- flaga `h.popupsPresence`: domyślnie `null`, czyli dawna uproszczona atrapa.

Pozostałe 82 testy nie zmieniły zachowania.

Kontrola mutacyjna (`mut/`, pliki przywrócone z kopii, `git status` czysty):

| Mutacja                                                                  | Wynik testu                                                                                                                  |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| A: `WIDGET_QUERY_ROOTS.popupsActive` usunięty z `DECORATIVE_QUERY_ROOTS` | **czerwony**: `reasons: ["seed:builder-popups-active"]` (`vitest-mut-A.log`)                                                 |
| B: usunięte `markDeliberateSeed(…, postLayoutKey)` w korzeniu            | **czerwony**: `seed:post-layout-settings` (`vitest-mut-B.log`)                                                               |
| C: `warmNoActivePopups` zapisuje sygnał bez `updatedAt: 0`               | **czerwony** na przesłance `dataUpdatedAt: 0`. Dowód, że test woła prawdziwą funkcję P3.8, a nie atrapę (`vitest-mut-C.log`) |

### 3.2 Sonda artefaktu scalonego drzewa

Build: `env BUNDLE_INVENTORY=1 bun run build:smoke`, exit 0. Skrypt to kopia `P3.6b/base-probe/probe.sh` z
`ARTIFACT_ROOT` = worktree integracyjny, w katalogu `probe/`. Fixture `builder_popups` jest pusty, więc sygnał `[]`
powstaje naprawdę.

| Przypadek                             | Żądanie 1                                                              | Linia `doc` żądania 1                                     | Żądanie 2                                  |
| ------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------ |
| `artifact-boot` (czysty render)       | MISS, `public, max-age=60, s-maxage=900, stale-while-revalidate=86400` | `degraded:false, store:"stored"`, bez `revalidation:true` | **HIT** (`layer:"L1"`, z wpisu czytelnika) |
| `slow-first-fold` (B2: posty +900 ms) | MISS, `public, max-age=0, s-maxage=30, stale-while-revalidate=300`     | `degraded:false, store:"stored"`                          | **HIT**                                    |

Zapisany dokument (`b-integ-artifact-boot-1.html` = `-2.html`, bajt w bajt) niesie w stanie odwodnionym:

- `["builder-popups-active"]`: `data:[]`, `dataUpdatedAt:0`, `status:"success"`;
- `["site_font_scale"]`: `dataUpdatedAt:1791508058542`, `status:"success"`;
- `["post-layout-settings"]`.

Dokument B2 niesie ten sam sygnał `[]`/`updatedAt: 0`. Wynik B2 jest taki sam jak w Prove P3.6b. Ponieważ
`check:document-weight` mierzy wyłącznie HIT (5 próbek, „x-nes-cache HIT”), jego przebieg jest trzecim
potwierdzeniem zapisu strony głównej.

## 4. Bramki (worktree `wt3/integ-p38`)

| Bramka                                                                                                                  | Wynik                                                                                                                                                                       | Log                                                                           |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `prettier --check` (37 scalonych plików + zmieniony test)                                                               | OK                                                                                                                                                                          | `prettier.log`                                                                |
| `light.sh bunx eslint` (te same pliki)                                                                                  | 0 błędów; 6 ostrzeżeń `react-refresh/only-export-components` (`JoinUsForm`, `TopicsDroplist`, `router.tsx` ×2, `__root.tsx` ×2), te same co w raportach P3.8 i P3.6b        | `eslint.log`                                                                  |
| typecheck (`heavy-bg.sh` + `typecheck-noinc.sh`: tsgo app + `tsconfig.scripts.json` + e2e)                              | exit 0 na merge'u (`typecheck-r0.log`), na teście (`typecheck-r1.log`) i na ostatecznym `f2085e6c` (`typecheck-r2.log`)                                                     | j.w.                                                                          |
| `light.sh bunx vitest run`, 162 pliki                                                                                   | **162/162, 4690 passed + 27 expected fail**, 171 s. Przebieg na `95fff57a`; ostatnia poprawka testu (limit `waitFor` 5 s, `f2085e6c`) ma osobny przebieg `rootRoute`: 83/83 | `vitest-r1.log`, `vitest-rootRoute-2.log`, lista: `vitest-files.txt`          |
| `light.sh bun run verify:static`                                                                                        | **15 bramek OK** w 242 s (w tym `format:check`, `check:ts-sql-contract`)                                                                                                    | `verify-static.log`                                                           |
| poza zleceniem, dla ryzyka głównego i liczby serii: `build:smoke`, `check:bundle`, `check:entry-purity`, `check:chunks` | zielone. Boot closure 488,0 KB gz / 1599,0 KB raw, 10 chunków; overall 4757,4 / 4772 KB; wejście czyste; graf 895 chunków, acykliczny                                       | `build.log`, `check-bundle.log`, `check-entry-purity.log`, `check-chunks.log` |
| `check:document-weight`                                                                                                 | **czerwony, 1 metryka**: `bootBurstGzipBytes` (§5). Reszta zielona                                                                                                          | `document-weight.log`, `document-weight.json`                                 |

Skład vitest (162 pliki):

- zestaw P3.8 z rundy 9: 136 plików, `p38fix9/affected.txt`;
- runda 10 P3.8: `themeRemainder`, `carouselDefaults`, `useThemeDesignDrafts`, `sections`, `ThemeDesignPane`,
  `sliderResponsiveNavigation`, `src/lib/notify/__tests__`;
- P3.6b: `documentCompleteness`, `documentCompletenessPipeline`, `documentCache*` (7), `homeSsrBudget`,
  `platformChromeWarmup`, `degradedRenderCachePipeline`, `documentLogTelemetry`, `resilientLoad`,
  `ssrTiming.server`, `archiveLoaderResilience`, `homeRoute`, `rootRoute`, `rootShellRender`;
- `src/lib/ci/__tests__/viteChunkParity.test.ts`;
- nowe testy P3.8: `sinceNavigationStart`, `newsletterSettingsData`.

`check:ssr-budgets` i `check:loader-policy` nie istnieją od PR #475 i nie zostały odtworzone.

## 5. Waga dokumentu (GET `/`, fixture, HIT, 5 próbek)

| Metryka                | A (`base-w3b`) |     P3.6b |  P3.8 sam | baza PR (`base-w3c`, `integ-b2`) | **integracja** |                                    Δ wobec bazy PR |                     Próg |
| ---------------------- | -------------: | --------: | --------: | -------------------------------: | -------------: | -------------------------------------------------: | -----------------------: |
| `bootBurstGzipBytes`   |        574 062 |   574 105 |   574 725 |                          574 113 |    **574 829** |                                           **+716** | 574 673 (**+156 ponad**) |
| `bootClosureGzipBytes` |        496 041 |   496 084 |   496 159 |                          496 071 |        496 227 |                                               +156 |      496 679 (zapas 452) |
| `bootClosureRawBytes`  |      1 636 946 | 1 636 990 | 1 637 144 |                                — |      1 637 356 |                                                  — |    1 637 758 (zapas 402) |
| `bootBurstCount`       |             26 |        26 |        26 |                                — |             26 |                                                  0 |                       26 |
| `htmlRawBytes`         |        337 696 |   337 696 |   338 389 |                          340 180 |        340 873 |                                               +693 |                  406 180 |
| `dehydratedStateBytes` |         60 357 |    60 357 |    61 047 |                           60 357 |         61 047 | +690 (`site_font_scale` + `builder-popups-active`) |                   66 486 |

Przekroczenie serii bootu ma tę samą przyczynę co w Prove 3 P3.8 (§4.1): łączenie małych chunków Rollupa przenosi
`i18n-sponsored` do `useInFeedAds-*` (w serii). P3.6b (+43 B) i linki prawne/toasty czatu dokładają do tego swoje
bajty, więc nadwyżka rośnie z +52 B do +156 B. Zgodnie z zadaniem: bez naprawy, bez ruszania progów. P3.7a
(ok. -1,28 KB gz bootu) ma wejść przed tą integracją. Po rebase na P3.7a trzeba zmierzyć ponownie.

## 6. Obserwacje (nieblokujące, bez zmian w kodzie)

1. **Sygnał popupów na wspólnej liście chrome'u trzyma granicę nagłówka.** Dzieje się tak na `/` po terminie
   (`warmLate`, najwyżej `HOME_CHROME_LATE_BUDGET_MS` = 1,2 s) i w zwykłym `warm` (na trasach innych niż `/` loader
   korzenia czeka `initialChromeWarmup`, najwyżej `CHROME_WARM_BUDGET_MS`). Projekcja `builder_popups:presence` leży
   za `edgeTtlCache` (60 s TTL, serve-stale do 5 min), więc kosztuje tylko na zimnym izolacie i biegnie równolegle z
   menu i tickerem. Tak to zaprojektowano: runda poprawek 1 P3.6b (m3) wprost chciała sygnału w `warmLate`, a
   runda 2 kazała granicy czekać na całą pracę. Jeśli Workers Logs pokażą długi ogon tej projekcji, można ją wyjąć
   z listy granicy i puścić w tle. Sygnał to dekoracja: brak wpisu oznacza, że host montuje się jak dotąd.
2. **Sygnał w dokumencie z cache'u jest zamrożony** na świeżość wpisu (≤ 180 s, B2: 30 s) plus STALE z rewalidacją.
   P3.6b zapisuje teraz więcej dokumentów (B1/B2), ale klasa ryzyka jest ta sama, którą przyjął P3.8 („nowo
   aktywowany popup widzi anonim z dokumentem młodszym niż aktywacja”). Zespół (`isStaff`) omija bramkę.
3. **Kompletność motywu** (sprzed P3.8, dziedziczy ją `site_font_scale`): `fetchSiteDesignTokensRow` zamienia błąd
   bazy na `null`, a zapytania motywu kończą się wtedy `success` z pustymi wartościami i `dataUpdatedAt > 0`. Przy
   błędzie (nie przy timeoucie) wiersza `site_design_tokens` predykat uzna stronę główną za kompletną. Tak było już
   dla tokenów i kolorów przed P3.8, więc to nie jest skutek tego scalenia. Kandydat na osobną pozycję, jeśli
   orkiestrator uzna to za istotne.
4. **Do bramki partii** (poza zleceniem tego etapu, nie uruchamiane): `test:e2e:artifact` z
   `backend-quiet.boot-home` (`NES_ARTIFACT_FIXTURE=1`) oraz e2e `on-demand-overlays` i `popup-first-render` na
   artefakcie po rebase na P3.7a. `.output` w `wt3/integ-p38` zbudowano z drzewa `f2085e6c`. Kod aplikacji jest identyczny z
   `c7f0c12d`, różni się tylko test.

## 7. Pliki

- `scratchpad/phase3/integ-p38/`:
  - `MERGE.md` (ten raport);
  - `commit-msg-merge.txt`, `commit-msg-test.txt`;
  - `merged-files.txt`, `vitest-files.txt`;
  - logi bramek z §4;
  - `mut/` (logi mutacji i kopie przywróconych plików);
  - `probe/` (skrypt, nagłówki, dokumenty, log serwera);
  - `probe-artifact-boot.log`, `probe-slow-first-fold.log`.

## 8. Uwaga o tipie PR

W trakcie tej pracy gałąź PR przesunęła się na `d5bd11fb` („Scalenie P3.7a (fala 3)…”). `integ/w3-p38` stoi, zgodnie
ze zleceniem, na `b8bf6c14`. Przed wylądowaniem trzeba ją scalić z nowym tipem albo przenieść na niego, a potem
powtórzyć `check:document-weight`, bo od tego zależy zamknięcie `bootBurstGzipBytes` (§5). Sprawdzone:
`git merge-tree --write-tree f2085e6c d5bd11fb` przechodzi bez konfliktów (exit 0). P3.7a zmienia między innymi
`vite.config.ts`, `vite.smoke.config.ts` i `scripts/performance/document-weight-budgets.json`. Progi mogły więc
zostać obniżone, a pomiar serii po scaleniu trzeba porównać z progami z nowego tipu.
