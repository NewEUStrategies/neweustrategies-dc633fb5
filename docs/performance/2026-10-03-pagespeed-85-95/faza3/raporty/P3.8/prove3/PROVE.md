# P3.8 (fala 3), dowód (Prove), runda 3: commit `c2697ba1` (runda 10: toasty karuzeli przez leniwy most)

Data: 2026-10-08/09.

- **A** = baza partii 2 `base-w3b` @ `63a05a32` (bez przebudowy; liczby wagi dokumentu z `$SCRATCH/w3/base-b/document-weight.json`).
- **B** = worktree `wt3/P3.8` @ `c2697ba1` (gałąź `perf/w3-P3.8`, rodzic `d66fc7fd` = Prove rundy 2).
- **B₂** = build Prove rundy 2 (`d66fc7fd`). Przed przebudową zachowałem jego inwentarz i domknięcie bootu w `prove3/prove2-snapshot/`.
- Build B: `env BUNDLE_INVENTORY=1 bun run build:smoke`, exit 0.
- Logi i surowe wyniki: `$SCRATCH/phase3/wave3/P3.8/prove3/`. Narzędzia są w `prove3/tools/`: `layout-diff.cjs`, `burst-diff.cjs`, `chunk-mods.cjs`, `e2e-item.sh`. Skaner `sonner` to `prove3/sonner-scan.cjs`.

## 0. Werdykt

| Kryterium                                                          | Wynik                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Przyczyna z rundy 2 (`vendor-sonner` statycznie w boocie) usunięta | **TAK.** Wejście `index-tP3paLN6.js` ma 9 statycznych importów (bez `vendor-sonner`). Domknięcie bootu: 10 chunków (B₂: 11). Odwołania do `vendor-sonner` w wejściu to wyłącznie `import()` (most `notify` i leniwy `Toaster`)                                                                                                                     |
| `check:entry-purity`                                               | **zielony** (B₂: czerwony)                                                                                                                                                                                                                                                                                                                         |
| e2e `on-demand-overlays`                                           | **zielony 1/1** (B₂: 0/1)                                                                                                                                                                                                                                                                                                                          |
| e2e `popup-first-render`                                           | zielony 2/2                                                                                                                                                                                                                                                                                                                                        |
| `test:e2e:artifact` (env CI)                                       | zielony 13/13, w tym `backend-quiet.boot-home`                                                                                                                                                                                                                                                                                                     |
| `check:bundle`, `check:chunks`, `check:server-entry-purity`        | zielone                                                                                                                                                                                                                                                                                                                                            |
| `check:document-weight`                                            | **CZERWONY, 1 metryka:** `bootBurstGzipBytes` 574 725 B > próg 574 673 B (**+52 B ponad próg**; +663 B wobec A). Trzy pozostałe metryki z rundy 2 (`bootClosureRaw/GzipBytes`, `bootBurstCount`) są zielone. Przyczyna nie leży w łatce, tylko w przetasowaniu chunków serii bootu przez P3.8 (§4.1). W B₂ była ta sama, zasłonięta przez `sonner` |
| Inny moduł w `index-*` ze statycznym `sonner` (ta sama pułapka)    | **NIE MA** (§2)                                                                                                                                                                                                                                                                                                                                    |
| Lighthouse                                                         | **nie powtarzany.** Układ chunków B = B₂ z dokładnością do jednej krawędzi `index → vendor-sonner` (§5). Lighthouse z rundy 2 zostaje w mocy                                                                                                                                                                                                       |

**`effect_matches_plan = partly`, `needs_fix = true`.** Do zamknięcia zostaje jedna metryka (`bootBurstGzipBytes`, 52 B
ponad próg). Decyzja o sposobie poprawki należy do orkiestratora (§6).

## 1. Łatka (`fix10/carouselDefaults-notify.patch`): przegląd i bramki przed commitem

Zakres: `src/lib/theme/carouselDefaults.ts` i `src/lib/theme/__tests__/themeRemainder.test.tsx`, za zgodą orkiestratora.
`git apply` przeszedł czysto, a treść jest identyczna z łatką.

| Aspekt                    | `sonner` wprost (przed)                                  | most `@/lib/notify` (po)                                                                 | Zgodne?                                       |
| ------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------- |
| Komunikat sukcesu         | `toast.success("Zapisano domyślne ustawienia karuzeli")` | `notifySuccess("Zapisano domyślne ustawienia karuzeli")` → `t.success(message)`          | tak, identyczny                               |
| Komunikat błędu           | `toast.error(e.message \|\| "Błąd zapisu")`              | `notifyError(e.message \|\| "Błąd zapisu")` → `t.error(message)`                         | tak, fallback „Błąd zapisu” zachowany         |
| Wartość zwrotna `onError` | id toasta (ignorowany przez `useMutation`)               | `void`                                                                                   | bez znaczenia                                 |
| Czas wyświetlenia         | synchronicznie                                           | synchronicznie po pierwszym załadowaniu `sonner`. Wcześniej jest kolejka FIFO (limit 20) | tak (panel admina ma `sonner` już załadowany) |
| Montaż `<Toaster/>`       | tylko wyzwalacz bezczynności w `__root.tsx`              | dodatkowo `onFirstToast`, czyli natychmiast                                              | po zmianie lepiej                             |
| SSR                       | —                                                        | no-op (callbacki mutacji i tak nie biegną na serwerze)                                   | tak                                           |

Ten sam most obsługuje już `designTokens`, `globalColors`, `themeDesign`, `fontSizes` i `customFonts`, czyli sąsiednie
sekcje tego samego panelu motywu.

| Bramka                                                                                                                                                                                | Wynik                                                                                                                                                                                                                                                   | Log (`fix10/`)                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `prettier --check` (2 pliki)                                                                                                                                                          | OK                                                                                                                                                                                                                                                      | —                                                                 |
| `eslint` (2 pliki)                                                                                                                                                                    | 0 błędów, 0 ostrzeżeń                                                                                                                                                                                                                                   | `eslint.log`                                                      |
| typecheck (`typecheck-noinc.sh`: tsgo + scripts + e2e, przez mutex)                                                                                                                   | exit 0                                                                                                                                                                                                                                                  | `typecheck.log`                                                   |
| vitest: `themeRemainder` + importerzy `carouselDefaults` (`carouselDefaults`, `useThemeDesignDrafts`, `sections`, `ThemeDesignPane`, `sliderResponsiveNavigation`) + `src/lib/notify` | 7 plików, 157/157                                                                                                                                                                                                                                       | `vitest-theme.log`                                                |
| vitest: zestaw P3.8 z IMPL (136 plików, `p38fix9/affected.txt`)                                                                                                                       | przebieg 1: 135/136, czyli 1 niestabilny test `NewsletterBuilder › przesuwanie jest zablokowane na krańcach` (`getAllByLabelText("W dol")[1]` = undefined pod obciążeniem). Osobno 3/3 zielone. **Przebieg 2: 136/136, 4089 passed + 27 expected fail** | `vitest-p38.log`, `vitest-nlb-{1,2,3}.log`, `vitest-p38-run2.log` |
| `verify:static`                                                                                                                                                                       | 15/15 OK                                                                                                                                                                                                                                                | `verify-static.log`                                               |

Commit: `c2697ba1` „Wydajność PSI 85/95, fala 3: P3.8 runda 10 - toasty karuzeli przez leniwy most, sonner poza bootem”.

## 2. Czy inny moduł w `index-*` niesie tę samą pułapkę

Skaner `sonner-scan.cjs` przejrzał moduły chunku wejściowego z inwentarza B₂: 832 moduły, w tym 812 plików `src/`.
Szukał statycznego, nie-typowego `import`/`export … from "sonner"`.

| Znalezisko                                                                 | Liczba | Ocena                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------- | -----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/theme/carouselDefaults.ts`                                        |      1 | **jedyny realny konsument** (naprawiony w `c2697ba1`)                                                                                                                                                                                                    |
| Moduły tras `src/routes/*.tsx` z `import { toast } from "sonner"` w źródle |     90 | **fałszywe trafienia.** W wejściu siedzą tylko referencyjne części tras po code-splitterze TanStack (konfiguracja, loader, `?tsr-split=notFoundComponent/errorComponent`). Komponenty z `toast` są w osobnych chunkach, a nieużywany import jest usuwany |
| `src/lib/notify.ts`                                                        |      1 | dynamiczny `import("sonner")`, czyli zamierzony most                                                                                                                                                                                                     |

Dowód z emitowanego kodu B₂:

- w `index-CZS5h1Yt.js` binding `Ud` z `vendor-sonner` występuje dokładnie 3 razy: import, `Ud.success("Zapisano domyślne ustawienia karuzeli")` i `Ud.error(…"Błąd zapisu")`;
- wszystkie trzy wystąpienia pochodzą z `carouselDefaults`;
- innego statycznego konsumenta `sonner` w wejściu nie było.

W B ten sam skan daje 0 realnych konsumentów. `carouselDefaults` nadal jest w wejściu, ale woła już `xa(…)`/`yn(…)`,
czyli most. Wejście nie importuje `vendor-sonner` statycznie. Poprawek podobnego typu nie było potrzeba.

## 3. Bramki artefaktu

| Bramka                                                                | A (baza)                                | B₂ (`d66fc7fd`)     | **B (`c2697ba1`)**                                                                           | Wynik B                        |
| --------------------------------------------------------------------- | --------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------- | ------------------------------ |
| `build:smoke` (BUNDLE_INVENTORY=1)                                    | —                                       | exit 0              | exit 0                                                                                       | zielony                        |
| `check:bundle` overall                                                | 4754,4 / 4772 KB                        | 4755,4              | **4754,5** (+0,1 wobec A)                                                                    | zielony (zapas 17,5 KB, 0,37%) |
| public JS                                                             | 2804,0 / 2877 KB                        | 2805,2              | **2804,5** (+0,5)                                                                            | zielony                        |
| admin-only                                                            | 1950,4                                  | 1950,2              | 1950,0                                                                                       | —                              |
| largest chunk (`index`)                                               | 262,2 / 286 KB                          | 262,4               | **262,3** (+0,1)                                                                             | zielony                        |
| CSS all / public                                                      | 95,0 / 81,2                             | 95,0 / 81,2         | 95,0 / 81,2                                                                                  | zielony                        |
| Boot closure (`check:bundle`)                                         | 487,8 KB gz / 1598,6 KB raw, 10 chunków | 497,9 / 1633,5, 11  | **488,0 / 1598,8, 10**                                                                       | zielony (budżet 579)           |
| `check:chunks`                                                        | —                                       | 893 / 6854 krawędzi | 893 / **6853** (−1: `index → vendor-sonner`)                                                 | zielony, acykliczny            |
| `check:entry-purity`                                                  | zielony                                 | **✗ `sonner`**      | **✓ „Sciezka bootowania czysta”** (10 chunków)                                               | **zielony**                    |
| `check:server-entry-purity`                                           | —                                       | czysty              | czysty, 1815 plików (leniwe: stripe; dług: node-html-parser ×2)                              | zielony                        |
| `test:e2e:artifact` (`NES_ARTIFACT_FIXTURE=1` + placeholdery)         | 12/12                                   | 13/13               | **13/13** (w tym `backend-quiet.boot-home`: „boot anonimowej `/` nie wysyła żądań Supabase”) | zielony                        |
| `on-demand-overlays` (`playwright.performance.config.ts`, artefakt B) | —                                       | **0/1**             | **1/1**                                                                                      | **zielony**                    |
| `popup-first-render` (jw.)                                            | —                                       | 2/2                 | 2/2 (1440 px, 390 px)                                                                        | zielony                        |
| `check:document-weight`                                               | zielony                                 | ✗ 4 metryki         | **✗ 1 metryka** (`bootBurstGzipBytes`, +52 B ponad próg)                                     | **CZERWONY**                   |

Komendy e2e pozycji są te same co w rundzie 2: `prove3/tools/e2e-item.sh`, czyli `NES_PERFORMANCE_ARTIFACT_ROOT=<wt>`,
`NES_PERFORMANCE_BASELINE=0`, `NES_PERFORMANCE_CASE=<case>`, Chromium 1194 i `--config playwright.performance.config.ts`.
`ssr-degradation` (dev-server) nie był powtarzany. Łatka dotyka tylko callbacków mutacji admina, a w rundzie 2 wynik
był 26/26.

## 4. Waga dokumentu (`check-document-weight --json`, GET `/`, fixture, HIT, 5 próbek; wszystkie próbki identyczne)

| Metryka                                                                   |          A (baza) |        B₂ |         **B** |                                              **Δ B−A** |            Próg (max) | B             |
| ------------------------------------------------------------------------- | ----------------: | --------: | ------------: | -----------------------------------------------------: | --------------------: | ------------- |
| **htmlRawBytes**                                                          |           337 696 |   338 425 |   **338 389** |                                               **+693** |               406 180 | ✓             |
| htmlGzipBytes                                                             |            52 542 |    52 746 |        52 766 |                                                   +224 |                57 710 | ✓             |
| headRawBytes                                                              |            28 758 |    28 797 |        28 761 | +3 (B₂ miał +39: URL `vendor-sonner` w zestawie bootu) |                29 345 | ✓             |
| inlineScriptBytes                                                         |            86 617 |    87 346 |        87 310 |                                                   +693 |                98 103 | ✓             |
| inlineExecutableScriptBytes                                               |            79 373 |    80 063 |        80 063 |                                                   +690 |                91 725 | ✓             |
| **dehydratedStateBytes**                                                  |            60 357 |    61 047 |    **61 047** |                                               **+690** |                66 486 | ✓             |
| **bootClosureRawBytes**                                                   |         1 636 946 | 1 672 711 | **1 637 144** |                                               **+198** | 1 637 758 (zapas 614) | ✓             |
| **bootClosureGzipBytes**                                                  |           496 041 |   506 347 |   **496 159** |                                               **+118** |   496 679 (zapas 520) | ✓             |
| **bootBurstCount**                                                        |                26 |        27 |        **26** |                                                 **±0** |                    26 | ✓             |
| **bootBurstGzipBytes**                                                    |           574 062 |   584 943 |   **574 725** |                                               **+663** |               574 673 | **✗ (+52 B)** |
| preLcpTransferBytes                                                       |           177 700 |   177 904 |       177 924 |                                                   +224 |               181 594 | ✓             |
| renderBlockingCssGzipBytes                                                |            80 426 |    80 426 |        80 426 |                                                      0 |                81 399 | ✓             |
| modulepreload / linkHeader / preloadDup / imgPreload / fetchpriority=high | 0 / 5 / 3 / 3 / 1 |       jw. |           jw. |                                                      0 |     0 / 5 / 3 / 3 / 2 | ✓             |

Domknięcie bootu per plik (B−A): tylko `index` rośnie o +198 B raw i +118 B gz. Dziewięć chunków `vendor-*` i
`dynamic-icon` ma identyczne bajty. Kod P3.8 w wejściu kosztuje więc netto +118 B gz. Prove rundy 2 szacował
+214 B, a mniej wyszło dzięki krótszym wywołaniom mostu i braku importu `sonner`.

`dehydratedStateBytes` +690 B jest bez zmian wobec rundy 2: dwa wpisy SSR (`site_font_scale`, `builder-popups-active: []`).

### 4.1. Dlaczego `bootBurstGzipBytes` jest nadal czerwony (+52 B ponad próg)

Seria bootu (tryb `lcp`) to domknięcie wejścia plus chunki z zestawu bootu dokumentu. Różnica per plik
(`tools/burst-diff.cjs`, gzip domyślny jak w bramce):

| Chunk serii            |        A gz |        B gz |     Δ gz | Co się zmieniło                                                                                     |
| ---------------------- | ----------: | ----------: | -------: | --------------------------------------------------------------------------------------------------- |
| `index` (wejście)      |     267 028 |     267 146 | **+118** | kod P3.8 w wejściu                                                                                  |
| `useInFeedAds`         |       1 003 |       1 831 | **+828** | A: `overlayCoordinator` + `useInFeedAds.tsx`. B: **`i18n-sponsored`** (4638 B) + `useInFeedAds.tsx` |
| `headings`             |         762 |         837 |      +75 | A: `headings` + `conversions`. B: `headings` + **`SponsoredBadge.tsx`**                             |
| `blog.index`           |       1 541 |           — |   −1 541 | w A seria ładowała `blog.index` z `FooterSlideup` w środku                                          |
| `FooterSlideup`        |           — |       1 212 |   +1 212 | w B `FooterSlideup` + `conversions` jako osobny chunk                                               |
| pozostałe 22 (wspólne) |           — |           — |      −29 | szum hashy i nazw (np. `sliderVariants` −23)                                                        |
| **Suma**               | **574 062** | **574 725** | **+663** | próg 574 673                                                                                        |

Mechanizm jest ten sam co w rundzie 2: łączenie małych chunków Rollupa (`experimentalMinChunkSize: 2048`).

1. P3.8 przeniósł `overlayCoordinator` (3514 B) z `useInFeedAds-*` do `tag._slug-*`, razem z nowym `sinceNavigationStart`. Ten chunk jest poza serią, więc to akurat dobrze.
2. Bez niego `useInFeedAds.tsx` (675 B) zostaje małym chunkiem, który Rollup dokleja do chunku `i18n-sponsored`.
3. Chunk `SponsoredBadge-*` z A (`SponsoredBadge.tsx` + `i18n-sponsored`) rozpada się. `i18n-sponsored` trafia do `useInFeedAds-*`, które jest w serii, a `SponsoredBadge.tsx` do `headings-*`, też w serii.
4. W A te bajty i tak szły na `/`: `SponsoredBadge` był w liście żądań A mobile-1 z rundy 2. Szły jednak poza serią bootu.

Realny koszt sieciowy jest więc bliski zeru, ale bramka liczy serię. B₂ miał ten sam układ: 0 przeniesionych
modułów (§5), więc te +663 B były w rundzie 2 zasłonięte przez `vendor-sonner` (+10 092 B gz).

## 5. Układ chunków B kontra B₂ (Prove rundy 2): czy powtarzać Lighthouse

`tools/layout-diff.cjs` porównał oba inwentarze (`chunk-inventory.json`):

| Porównanie               | Wynik                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| Liczba chunków           | 892 = 892. Każdy chunk B₂ ma w B chunk o identycznym zbiorze modułów (0 niedopasowanych) |
| Moduły                   | 5604 = 5604, **0 przeniesionych** między chunkami, 0 zmian rozmiaru renderowanego modułu |
| Zmiany poza samym hashem | **dokładnie jedna:** `index` traci statyczny import `vendor-sonner`                      |
| Zmiany tylko hasha       | 850 chunków (kaskada nowego hasha wejścia), 41 bez zmian                                 |
| `carouselDefaults.ts`    | **nie przeniósł się**, nadal jest w wejściu, ale bez `sonner`                            |
| Domknięcie bootu         | B₂: 11 chunków (z `vendor-sonner`). B: 10 chunków, ten sam zbiór co A                    |

**Lighthouse nie był powtarzany.** Jedyna różnica układu to wyjście `vendor-sonner` z bootu. Wyniki A/B z rundy 2
(`prove2/PROVE.md` §4) zostają w mocy:

- 0 REST w oknie bootu w 10/10 przebiegów B;
- mediany ΔTBT: −5 ms mobile, −29 ms desktop4x;
- ΔCLS = 0;
- TTI −0,63 s / −0,19 s, istotne.

Są to wyniki raczej zachowawcze. B₂ parsował jeszcze `vendor-sonner` w boocie (`Script:vendor-sonner` 3–11 ms w 3/5
przebiegów mobile), a B już tego nie robi. Kryterium „backend: 0 w oknie bootu” na artefakcie B potwierdza e2e
`backend-quiet.boot-home` (zielony).

## 6. Co zostało czerwone i opcje (do decyzji orkiestratora)

Czerwony jest tylko `check:document-weight` → `bootBurstGzipBytes` 574 725 B > 574 673 B, czyli **52 B ponad próg**
i +663 B wobec A. Progi wolno wyłącznie obniżać, więc trzeba to naprawić w kodzie albo w układzie chunków. Możliwości
(niewykonane, poza zakresem tej rundy):

1. **Przywrócić rozdział `SponsoredBadge`/`i18n-sponsored`**, żeby `i18n-sponsored` nie doklejał się do `useInFeedAds-*`.
   - Sposób: przypięcie w `manualChunks` albo zmiana grafu importów `useInFeedAds`.
   - Usuwa ok. +900 B gz z serii (`useInFeedAds` +828, `headings` +75).
   - Wymaga `vite.config.ts` lub plików spoza listy.
2. **Odchudzić kod P3.8 w wejściu** o co najmniej 52 B gz (dziś +118 B gz).
   - Zapas byłby wtedy rzędu kilkudziesięciu bajtów, więc to kruche rozwiązanie.
3. Kombinacja obu.
   - Po każdej z nich trzeba ponownie zmierzyć `check:document-weight` i `check:bundle`.
   - Lighthouse trzeba powtórzyć tylko wtedy, gdy przesunie się więcej niż wskazane chunki.

Bez zmian w zachowaniu wobec rundy 2: popup `immediate` co najmniej ok. 400 ms po zatrzasku, pasek dolny po
max(zatrzask, `delay_ms`) od `activationStart`, a sekcje z danymi z SSR odświeżają się przy zatrzasku.
