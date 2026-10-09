# Recenzja scalenia P3.8: wierność rozwiązania merge'a

Zakres: `integ/w3-p38` w `scratchpad/wt3/integ-p38`, commity `b8bf6c14..f2085e6c`:

- `c7f0c12d`, merge `--no-ff`, rodzice `b8bf6c14` + `c2697ba1`;
- `f2085e6c`, test strażnika styku P3.6b x P3.8.

Patrzyłem przez soczewkę wierności rozwiązania: czy coś z którejś strony zginęło albo się zdublowało, czy komentarze
opisują scalony kod i czy pliki przechodzą lint/format. Tylko odczyt: w worktree integracyjnym nic nie zmieniałem.

## Werdykt: APPROVE

Nie ma ustaleń blokujących. Merge jest czystym automatycznym złożeniem Gita, bez ręcznych poprawek. Zachowania obu
stron są w wyniku. Główne ryzyko, czyli to, że strona główna nigdy nie trafi do cache'u dokumentu, jest wykluczone.
Potwierdzają to kod, test i sonda.

## 1. Mechanika scalenia

- Baza scalenia to `d22cf7d6`. Strona HEAD zmienia 59 plików, strona P3.8 zmienia 37. **Część wspólna to tylko 2
  pliki**: `src/routes/__root.tsx` i `src/routes/__tests__/rootRoute.test.tsx`. `Footer.tsx`, `router.tsx`,
  `popups.ts` ani konfiguracji Vite nie ruszały obie strony naraz:
  - `Footer.tsx` i `vite*.config.ts` zmienia tylko HEAD (linki prawne, chunk `legal-links`, komentarz `vendor-sonner`);
  - `router.tsx` i `popups.ts` zmienia tylko P3.8.
- `git merge-tree --write-tree b8bf6c14 c2697ba1` daje drzewo `f1103bfb`, **identyczne** z drzewem `c7f0c12d`.
  Merge nie zawiera więc żadnej ręcznej zmiany ani „evil merge'a”.
- `git merge-file` dla obu wspólnych plików daje 0 konfliktów, a wynik jest bajt w bajt równy plikom z `c7f0c12d`.
- Względem nowego tipu PR `d5bd11fb` (P3.7a): `git merge-tree` kończy się exit 0. Zbiory plików `b8bf6c14..d5bd11fb`
  i `b8bf6c14..f2085e6c` są rozłączne.

## 2. `src/routes/__root.tsx`, region po regionie

Sprawdziłem `git diff c2697ba1 c7f0c12d`, czyli co wniósł HEAD, i `git diff d22cf7d6 c2697ba1`, czyli co wniósł P3.8.

| Region                                                                                                    | Strona                  | Stan w wyniku                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Importy `fontScaleQueryOptions`, `useInteractionOrQuiet`                                                  | P3.8                    | są                                                                                                                                                                                             |
| Import `markDeliberateSeed`                                                                               | P3.6b                   | jest                                                                                                                                                                                           |
| Komentarz Toastera: sonner 2.x odtwarza aktywne toasty                                                    | toasty czatu            | jest. Komentarz `OVERLAY_IDLE_TIMEOUT_MS`, zawężony przez P3.8 do Toastera, zgadza się z kodem: jedynym użyciem jest `afterPageLoad(…, OVERLAY_IDLE_TIMEOUT_MS)` w `useToasterWanted` (l. 521) |
| `useOverlayGates` → `useInteractionOrQuiet()` i doc „MOMENT MONTAŻU”                                      | P3.8                    | jest. `afterPageLoad` nadal używany, więc import nie jest martwy                                                                                                                               |
| `useNoActivePopupsFromSsr` z `isStaff`                                                                    | P3.8                    | jest                                                                                                                                                                                           |
| Fala 1: `ensureQueryData(fontScaleQueryOptions)` i klucz w pętli anulowania `/`                           | P3.8                    | jest. Zasiewu `site_font_scale` brak (runda 9 P3.8), komentarz to opisuje                                                                                                                      |
| Zasiew `post-layout-settings` i `if (import.meta.env.SSR) markDeliberateSeed(...)`                        | P3.6b + komentarze P3.8 | oba wkłady są, bez kolizji                                                                                                                                                                     |
| `tickerWarm` bez `chromeBudget > 0`, fabryki `(budgetMs) => …`, `warmLate`, `warm` z `work(chromeBudget)` | P3.6b                   | jest, nietknięte                                                                                                                                                                               |
| `if (isServer) chromeWarm.push(() => warmNoActivePopupsOnServer(...))`                                    | P3.8                    | jest na **wspólnej** liście `chromeWarm`. Fabryka bez parametru da się przypisać do `(budgetMs) => Promise`. Sygnał grzeje się w `warm` i w `warmLate`, zgodnie z P3.6b (runda poprawek 1, m3) |
| `warmNoActivePopupsOnServer = createIsomorphicFn()…`                                                      | P3.8                    | jest, pojedynczo                                                                                                                                                                               |

Duplikatów nie ma. Każdy symbol występuje raz, a gałąź `isServer` z wypchnięciem sygnału **nie trafia** do chunku
wejściowego klienta. Sprawdziłem to w `.output/public/assets/index-DKE29euy.js`: po `push` reklamy od razu stoi pętla
nagłówek/stopka. Linia nie dokłada więc bajtów do bootu.

## 3. `src/routes/__tests__/rootRoute.test.tsx`

- Każdy `vi.mock(...)` występuje dokładnie raz. Pola atrap P3.6b (`adsGate`) i P3.8 (`fontScaleFetches`,
  `fontScaleHangs`, `popupWarms`, `staff`) leżą w jednym `vi.hoisted`. Wszystkie są zerowane w `beforeEach`, także
  nowe `popupsPresence` i `themeRow` z `f2085e6c`.
- Test `f2085e6c` woła prawdziwe `warmNoActivePopups`. Atrapą jest tylko `edgeTtlCache` dla klucza
  `builder_popups:presence`, a mutacja C z MERGE.md to potwierdza. Do tego idą prawdziwy loader `/` w SSR
  (`vi.stubEnv("SSR", true)`) i prawdziwy `trackSsrQueryCompleteness`. Wynik to `{ complete: true, reasons: [] }`.
- Mój przebieg: `light.sh bunx vitest run` na 6 plikach, **6/6 plików, 208/208 testów**. Pliki:
  - `rootRoute`;
  - `rootShellRender`;
  - `documentCompletenessPipeline`;
  - `documentCompleteness`;
  - `popupsHooks`;
  - `src/__tests__/router.test.tsx`.

## 4. Interakcje semantyczne poza wspólnymi plikami

Każdą sprawdziłem w kodzie:

- **Predykat P3.6b a zapisy P3.8.**
  - `DECORATIVE_QUERY_ROOTS` w `src/lib/ssr/resilientLoad.ts` zawiera `WIDGET_QUERY_ROOTS.popupsActive`.
  - `warmNoActivePopups` zapisuje dokładnie `[WIDGET_QUERY_ROOTS.popupsActive]` z `updatedAt: 0`, a przy aktywnym
    popupie albo błędzie nie zapisuje nic.
  - `fontScaleQueryOptions.queryFn` nie rzuca, bo `fetchSiteDesignTokensRow` ma `.catch(() => null)`. Na serwerze
    współdzieli lot `edgeTtlCache("site_design_tokens:row")` z tokenami, więc nie spóźnia się sam.
  - `post-layout-settings` ma `markDeliberateSeed`.
- **Sonda artefaktu.** `probe/server-*.log`, `h-*.txt`: `/` dostaje MISS z `"store":"stored"`, `degraded:false`,
  a potem HIT (L1). Tak jest dla czystego renderu i dla B2. Dokumenty 1 i 2 są identyczne (`cmp`).
- **`lib/notify.ts`.** HEAD zmienił w nim tylko komentarz. `carouselDefaults.ts` (P3.8) używa
  `notifySuccess`/`notifyError`, które istnieją w scalonym `notify.ts`. Komentarz P3.8 o `vendor-sonner` zgadza się z
  `vite.config.ts` z HEAD. W kodzie nie zostało twierdzenie „sonner nie odtwarza historii”.
- **Linki prawne a `backend-quiet.boot-home.spec.ts` (P3.8).** `LegalLinks.tsx` i `CopyrightBar.tsx` niczego nie
  pobierają z Supabase, więc nie łamią kontraktu „zero `/rest/v1/` z bootu”.
- **Toasty czatu a polityka `refetchOnMount` (`router.tsx`, P3.8).** Zapytania czatu i preferencji nie mają wpisów SSR
  ani zasiewów ze stemplem. Działa więc ścieżka „brak danych → pobierz przy montażu”. Kolizji nie ma.
- **P3.7a (`d5bd11fb`).** Plików nie dzieli. Trzeba ponownie zmierzyć wagę dokumentu (pkt 5).

## 5. Lint i format

- `light.sh bunx prettier --check`: OK, „All matched files use Prettier code style”. Pliki:
  - `__root.tsx`, `rootRoute.test.tsx`;
  - `router.tsx`, `popups.ts`;
  - `Footer.tsx`, `FooterSlideup.tsx`;
  - `resilientLoad.ts`, `carouselDefaults.ts`, `notify.ts`.
- `light.sh bunx eslint` na tych samych plikach: **0 błędów**, 4 ostrzeżenia `react-refresh/only-export-components`
  (`router.tsx` ×2, `__root.tsx` ×2). Są takie same jak w bazie i w MERGE.md.

## 6. Ustalenia

| #   | Waga                    | Ustalenie                                                                                                                                                                                                                                                                                                                                                            | Propozycja                                                                                                                             |
| --- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | minor (znane, przyjęte) | `bootBurstGzipBytes` wynosi 574 829 B przy progu 574 673 B, czyli **+156 B**. Nadwyżka urosła z +52 B (sam P3.8) o bajty P3.6b, linków prawnych i toastów czatu. Przyczyna to Rollup, który łączy `i18n-sponsored` z `useInFeedAds`. Obejmuje ją założenie zlecenia: P3.7a wchodzi wcześniej                                                                         | Po scaleniu z `d5bd11fb` powtórzyć `check:document-weight` z progami **z nowego tipu**. Progów nie podnosić                            |
| 2   | nit                     | Komentarz przy `chromeWarm.push(... warmNoActivePopupsOnServer ...)` (`__root.tsx` ok. l. 1073) uzasadnia dekoracyjność tylko listą `chromeQueryKeys`. Nie wspomina, że zapis `[]` z `updatedAt: 0` nie psuje zapisu do cache'u wyłącznie dzięki `DECORATIVE_QUERY_ROOTS` w `resilientLoad.ts`. Odsyłacz jest tylko w jedną stronę: z `resilientLoad.ts` do korzenia | Dopisać jedno zdanie z odsyłaczem do `DECORATIVE_QUERY_ROOTS`. Przed regresją i tak chroni test z `f2085e6c` (mutacja A daje czerwony) |
| 3   | nit (sprzed scalenia)   | W `__root.tsx:853` i `:1086` zostały odwołania do `check:ssr-budgets`, bramki usuniętej w PR #475. Były w bazie `d22cf7d6` i nie powstały przy tym scaleniu (P3.8 usunął trzecie, w docu `useNoActivePopupsFromSsr`)                                                                                                                                                 | Osobna drobna poprawka komentarzy, poza tą integracją. Bramki nie odtwarzać                                                            |
| 4   | nit                     | Test strażnika obejmuje zwykłą ścieżkę `warm`. Nie ma przypadku z wygasłą stroną główną (`warmLate`), w którym sygnał popupów i predykat działają razem. Ryzyko jest małe, bo wyjątek predykatu zależy od klucza, a nie od ścieżki                                                                                                                                   | Opcjonalnie dodać wariant z `h.settingsHangs`/`adsGate` po terminie i prawdziwym `popupsPresence: false`                               |

## 7. Podsumowanie

Merge jest wierny. Nic nie zginęło i nic się nie zdublowało. Komentarze w scalonych regionach opisują scalony kod.
Lint i format przechodzą, testy są zielone. Na ryzyko główne, czyli brak zapisu strony głównej do cache'u przez
sygnał P3.8, odpowiadają trzy rzeczy: wyjątek w predykacie, test z kontrolą mutacyjną i sonda MISS→`stored`→HIT.
