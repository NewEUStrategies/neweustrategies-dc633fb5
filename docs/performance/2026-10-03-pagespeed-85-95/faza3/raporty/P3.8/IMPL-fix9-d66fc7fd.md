# P3.8 (fala 3) — runda poprawek 9: posty z okna bootu, kotwica `activationStart`, bajty bootu

Data: 2026-10-08. Worktree `$SCRATCH/wt3/P3.8`, gałąź `perf/w3-P3.8`. Nowy commit `d66fc7fd` na `97ae43c1`, bez przepisywania
historii. Wejście: trzy ustalenia blokujące z `PROVE.md`. Pierwsze ma zgodę orkiestratora na rozszerzenie zakresu
o `src/lib/builder/useSectionPreload.ts`. Przerwana wcześniejsza próba tej rundy nie zostawiła zmian w drzewie
(`git status` był czysty), więc runda zaczyna się od `97ae43c1`.

## 0. Najkrócej

| Ustalenie (Prove)                                                          | Co zrobione                                                                                                                                                                                                                                 | Stan                                                             |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| B1 `useSectionPreload`: `posts` ×5–8 w oknie bootu przy dokumencie > 120 s | Sekcja, której KAŻDY wpis niesie dane z dokumentu (`dataUpdatedAt > 0`, bez inwalidacji), przy zamkniętym zatrzasku planuje prefetch dopiero po `onInteractionOrQuiet`. Zasiew `updatedAt: 0`, wpis unieważniony i brak danych idą od razu. | zrobione + testy                                                 |
| B2 (M1) kotwica „od startu nawigacji” liczyła czas prerenderu              | Jeden mały moduł `components/popups/sinceNavigationStart.ts`: `performance.now() − activationStart` (0, gdy pola albo wpisu brak). Używają go wszystkie trzy kotwice.                                                                       | zrobione + testy                                                 |
| B3 zamknięcie bootu +297 B gz / +774 B raw                                 | Odzysk w chunku wejściowym (tabela w §2): ciała odczytu i zapisu `newsletter_settings` przeniesione do modułu leniwego, usunięty zbędny zasiew `site_font_scale`, `ContentAreaStyle` bramkowany `enabled`, polityka #5 jako domknięcie      | zrobione; pomiar zostaje dla Prove (build zakazany w tym etapie) |

Przy okazji (tanie, z recenzji):

- **m4** (dedup może oddać dane sprzed zapisu): zamknięte. Zapis z panelu odcina lot sprzed zapisu, a lot porównuje
  tożsamość, więc nie zwalnia cudzego lotu.
- **m1** (`on-demand-overlays`): opisany w e2e jako kontrola pozytywna.

## 1. Zmiany plik po pliku

### `src/lib/builder/useSectionPreload.ts` (B1; rozszerzenie zakresu zatwierdzone przez orkiestratora)

- `isSectionFresh(client, section, lang, ssrAnyAge = false)`. W trybie `ssrAnyAge` funkcja nie sprawdza wieku wpisu.
  Pyta tylko, czy KAŻDY wpis sekcji ma dane z `dataUpdatedAt > 0` i `!isInvalidated`, czyli prawdziwe dane
  z dokumentu, a nie zasiew fallbackowy.
- `schedule()` przy zamkniętym zatrzasku (`!isInteractionOrQuietOpen()`) i spełnionym `ssrAnyAge` zapisuje się
  w `onInteractionOrQuiet`. Po otwarciu zatrzasku woła `schedule()` jeszcze raz. Wtedy działa już zwykła droga:
  `whenIdle` → `run()`, czyli świeżość, rejestr i `prefetchSectionQueries`.
- Uchwyt odwołania zatrzasku siedzi w tym samym `cancelIdle`. Odmontowanie przed zatrzaskiem odwołuje więc odroczony
  prefetch, a cleanup efektu się nie zmienił.
- Prefetch, który rusza przy zatrzasku, łączy się z odświeżeniem #5 z `router.tsx` w locie.
  `fetchQuery` dołącza do trwającego pobrania, więc drugiego żądania nie ma.
- Wariant „sprawdzenie przy planowaniu” jest tańszy w bajtach niż sprawdzenie w `run()`. Moduł jest w chunku
  wejściowym.

### `src/components/popups/sinceNavigationStart.ts` (nowy) + `NewsletterPopup.tsx`, `PopupHost.tsx`, `FooterSlideup.tsx` (B2)

- `sinceNavigationStart()` = `performance.now() − (navigationEntry.activationStart ?? 0)`. Dokument z prerenderu
  liczy od aktywacji. Zwykły dokument i przeglądarka bez pola albo bez `getEntriesByType` liczą od początku dokumentu.
- `triggerDelayMs` w obu popupach i `delay` paska z bootu w `FooterSlideup` używają tej funkcji zamiast gołego
  `performance.now()`. Semantyka podłóg (1 s / 400 ms) i „pierwszego uzbrojenia” bez zmian.
- Moduł jest osobny (finding: „one small shared helper … or a new tiny module next to them”). Importują go tylko trzy
  chunki spoza bootu, więc łączenie małych chunków powinno go dokleić do najmniejszego chunku ładowanego razem z nimi
  (`useInFeedAds`, czyli koordynator nakładek), a nie do wejścia. To do potwierdzenia w Prove.

### `src/hooks/useNewsletterSettings.ts` + nowy `src/hooks/newsletterSettingsData.ts` (B3, główny odzysk)

- `useNewsletterSettings.ts` jedzie w chunku wejściowym przez rejestr prefetchu widgetów (`lib/builder/prefetch.ts`).
  Leżały w nim:
  - pełne ciało odczytu (scalenie z domyślnymi);
  - dedup lotu z P3.8;
  - ciało zapisu z panelu (`useSaveNewsletterSettings`).
- Wszystkie trzy przeniesione do `newsletterSettingsData.ts`, ładowanego importem dynamicznym w `queryFn` i `mutationFn`
  (`const settingsData = () => import("./newsletterSettingsData")`).
- W boocie przeglądarka ich nie potrzebuje:
  - formularz inline przychodzi z danymi z SSR;
  - odświeżenie zachodzi przy zatrzasku (#5);
  - popup montuje się przy zatrzasku;
  - zapis jest tylko w panelu.
- Publiczny interfejs bez zmian: te same klucze, fabryki, hooki i eksporty (`defaultNewsletterSettings`,
  `projectNewsletterInlineSettings`, `NEWSLETTER_INLINE_LABEL_KEYS`). Testy spoza listy importują je stąd.
- Import statyczny działa tylko z modułu leniwego do `useNewsletterSettings`. Odwrotna krawędź statyczna wciągnęłaby
  moduł z powrotem do wejścia.
- Domyślne (`defaultNewsletterSettings`) i projekcja zostają w boocie, bo importują je wprost panel i testy spoza
  listy plików.
- **m4:** `saveNewsletterSettings` po udanym zapisie ustawia `inflight = null`. Odświeżenie po inwalidacji zaczyna
  więc NOWY lot. Lot kończy się warunkowo (`if (inflight === flight)`), więc spóźniony lot sprzed zapisu nie zwalnia
  lotu po zapisie. Serwer nadal bez dedupu.
- Koszt: pierwsze pobranie w przeglądarce (zatrzask, popup, nawigacja SPA) dociąga mały chunk przed GET-em.
  To jedno żądanie zasobu niezmiennego, poza oknem bootu.

### `src/routes/__root.tsx` (B3; tylko rozgrzewka `fontScale`)

- Usunięty zasiew `EMPTY_FONT_SCALE`/`updatedAt: 0` dla `site_font_scale`, razem z importem `EMPTY_FONT_SCALE`.
- Zasiew niczego nie zmieniał:
  - `DesignTokensStyle` i tak czyta brak danych jako `EMPTY_FONT_SCALE`, więc SSR i hydratacja dają ten sam arkusz
    i ten sam skrót `useDeferredStyleCss`;
  - klient bez wpisu pobiera tabelę przy montażu dokładnie tak jak przy zasiewie z `updatedAt: 0`, bo #5 przepuszcza
    zasiewy.
- Zasiew kosztował ~100 B w chunku wejściowym. Na stronie głównej po anulowaniu dokładał też wpis (~300 B surowo)
  do stanu SSR.
- Rozgrzewka fali 1 (`ensureQueryData(fontScaleQueryOptions)`) i klucz w pętli anulowania zostają. To mechanizm „zero
  żądań”: prawdziwy wpis z serwera.
- Komentarz przy rozgrzewce opisuje brak zasiewu.
- Żadna inna funkcja korzenia nie jest ruszana (fala chrome, `expired()` P3.6b, bramki: bez zmian).

### `src/components/ContentAreaStyle.tsx` (B3, prostsze #3)

- Było: `useQueryClient` + `refetchOnMount: false` + efekt z `onInteractionOrQuiet(prefetchQuery)`.
- Jest: `useQuery({ ...postLayoutSettingsQueryOptions(), enabled: useInteractionOrQuiet() })`.
- Do otwarcia zatrzasku obserwator czyta wpis bez sieci (zasiew albo wiersz z `$.tsx`). Włączenie pobiera wyłącznie
  wpis nieświeży: `shouldFetchOptionally` przy zmianie `enabled`.
- Hak `useInteractionOrQuiet` i tak jest w boocie (`useOverlayGates`), więc nie dokłada maszynerii.
- Dwie świadome różnice wobec poprzedniej rundy (testy przepisane):
  - brak wpisu też czeka na zatrzask, bo korzeń zawsze zasiewa ten klucz, na serwerze i w dokumencie bez SSR;
  - inwalidacja PRZED zatrzaskiem czeka na zatrzask, bo zapytanie wyłączone nie jest „aktywne”.
- W panelu zapis zawsze następuje po interakcji, czyli przy otwartym zatrzasku. Tam inwalidacja odświeża od razu
  (test).

### `src/router.tsx` (B3, tylko #5)

- `bootRefetchOnMount` (fabryka + flaga) zamieniona na domknięcie w `getRouter`: `refetchOnMount: isServer || ((query) => …)`
  i `bootCatchUp ??= onInteractionOrQuiet(…)`.
- Zachowanie identyczne: zatrzask otwarty, `!dataUpdatedAt` i `isInvalidated` dają `true`; w pozostałych przypadkach
  jedno nadrobienie przy zatrzasku z `cancelRefetch: false`.
- Kod jest krótszy w chunku wejściowym: bez fabryki, wywołania i owijki.
- `isServer` z `@tanstack/router-core/isServer` w buildzie klienta zwija się do stałej, co widać w diffie zbudowanego
  wejścia (gałąź serwerowa znika). Literał `setTimeout(0)` nietknięty.

### Testy

- `src/lib/builder/__tests__/useSectionPreload.test.tsx`:
  - nowa sekcja „okno bootu (P3.8)”:
    - dane z SSR starsze niż `staleTime` czekają na zatrzask, a zatrzask prefetchuje raz;
    - zasiew `updatedAt: 0` idzie od razu;
    - wpis unieważniony idzie od razu;
    - brak danych idzie od razu;
    - odmontowanie przed zatrzaskiem odwołuje prefetch;
  - test jednostkowy `isSectionFresh(..., true)`;
  - dotychczasowy „nieświeże RAZ” działa po otwarciu zatrzasku;
  - reset zatrzasku na test, atrapa `onQuiescent`.
- `src/components/popups/__tests__/sinceNavigationStart.test.ts` (nowy): zwykła nawigacja, prerender
  (`activationStart` 9 000 → 3 000), brak pola i brak wpisu.
- `newsletterPopup.test.tsx`, `PopupHost.test.tsx`, `footerSlideup.test.tsx`: po jednym przypadku z atrapą wpisu
  nawigacji `activationStart > 0`. Opóźnienie liczy się od aktywacji, a nie od startu dokumentu.
- **Sprawdzone, że dyskryminują.** Po cofnięciu poprawki (kotwica bez `activationStart`, odroczenie wyłączone)
  czerwienieje 5 nowych testów, potem stan przywrócony.
- `src/hooks/__tests__/newsletterSettingsData.test.ts` (nowy):
  - równoległy pełny + inline daje 1 GET;
  - m4: zapis odcina lot sprzed zapisu, a spóźniony stary lot nie zwalnia nowego.
- `src/hooks/__tests__/useNewsletterSettings.test.tsx`: jawny import atrapy klienta (fabryki nie importują go już
  statycznie). Asercje bez zmian.
- `src/components/__tests__/contentAreaStyle.test.tsx`: kontrakt `enabled` od zatrzasku. Brak wpisu czeka.
  Inwalidacja przed zatrzaskiem czeka, a po zatrzasku odświeża od razu.
- `src/routes/__tests__/rootRoute.test.tsx`: brak zasiewu `font-scale`. Anulowanie na `/` nie zostawia wpisu
  w stanie SSR. Prawdziwa tabela zostaje.
- `e2e-performance/on-demand-overlays.spec.ts`: tylko komentarz (m1).

## 2. Bajty zamknięcia bootu: skąd odzysk (szacunek, NIE pomiar)

Buildu w tym etapie nie było (instrukcja etapu). Liczby to szacunek, który powinien potwierdzić Prove:

- delta między zbudowanym wejściem bazy `base-w3b` a B z `97ae43c1` (`index-*.js` sformatowany prettierem,
  identyfikatory znormalizowane);
- minifikacja esbuild pojedynczych modułów (`$SCRATCH/p38fix9/est/`).

| Kawałek chunku wejściowego                                                                                                                                       | Δ wobec bazy w `97ae43c1` (zbudowane) |                                                Ta runda (szac.) |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------: | --------------------------------------------------------------: |
| `useNewsletterSettings` (ciało odczytu, dedup, zapis → moduł leniwy; + `__vitePreload` i wpis `mapDeps`)                                                         |                           +98 (dedup) |                                          ok. −740 raw / −260 gz |
| `__root.tsx`: zasiew `site_font_scale`                                                                                                                           |                                  +102 |                                           −102 raw / ok. −40 gz |
| `ContentAreaStyle` (`enabled` zamiast efektu i `prefetchQuery`)                                                                                                  |                                  +101 |                                            ok. −85 raw / −30 gz |
| `router.tsx` #5 (domknięcie)                                                                                                                                     |                                  +243 |                                            ok. −50 raw / −20 gz |
| `useSectionPreload` (odroczenie B1)                                                                                                                              |                                     0 |                                           ok. +130 raw / +55 gz |
| `sinceNavigationStart`                                                                                                                                           |                                     — |  0 (jeśli trafi do `useInFeedAds`); najgorzej +110 raw / +90 gz |
| reszta P3.8 bez zmian w tej rundzie (hak `useInteractionOrQuiet` +191 z eksportami, `useOverlayGates` −72, `isStaff` +27, reklamy +93, `fontScale` w fali 1 +33) |                                     — |                                                               0 |
| **Razem wobec bazy**                                                                                                                                             |                **+774 raw / +297 gz** | **ok. −70 raw / ok. 0 gz** (najgorzej ok. +40 raw / ok. +90 gz) |

`dehydratedStateBytes` na `/` (fixture):

- wpis `site_font_scale` zostaje, ale wyłącznie jako prawdziwe dane z fali 1. Bez niego klient wysyła GET + preflight
  przy hydratacji, czyli właśnie to, co #1 usuwa;
- znika zasiew po anulowaniu na stronie głównej;
- `builder-popups-active: []` zostaje. To jest sam znacznik (#4a), a mniejszego nośnika nie ma bez zmiany HTML-a
  korzenia.

Oczekiwany ruch stanu SSR jest więc zerowy albo w dół wobec Prove (+690 B raw / +58 B gz wobec bazy).

## 3. Bramki (ten etap)

| Bramka                                                                                                                                                                                   | Wynik                                                                                               | Log                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `bunx prettier --write` (20 dotkniętych plików)                                                                                                                                          | OK                                                                                                  | —                                    |
| `light.sh bunx eslint` (20 plików)                                                                                                                                                       | 0 błędów; 4 ostrzeżenia `react-refresh/only-export-components` w `router.tsx`/`__root.tsx` (z bazy) | `$SCRATCH/p38fix9/eslint.log`        |
| typecheck (`typecheck-noinc.sh`: tsgo + scripts + e2e) przez `heavy-bg.sh`                                                                                                               | exit 0, bez błędów                                                                                  | `$SCRATCH/p38fix9/typecheck.log`     |
| vitest: 136 plików (zestaw dotknięty z rundy 1 + wszystkie testy importujące zmienione moduły, w tym `BuilderRenderer`, `prefetch`, `NewsletterForm`, `JoinUsForm` i panele newslettera) | 4089 passed, 27 expected fail, 0 failed                                                             | `$SCRATCH/p38fix9/affected-run1.log` |
| `light.sh bun run verify:static`                                                                                                                                                         | 15/15 OK (w tym `format:check`, `check:dangerous-html`, `check:ts-sql-contract`, bramki SQL)        | `$SCRATCH/p38fix9/verify-static.log` |

Nie uruchamiane, zostawione dla Prove:

- `build:smoke`, `check:bundle`, `check:document-weight`, `check:chunks`, `check:entry-purity`,
  `check:server-entry-purity`;
- e2e: `test:e2e:artifact`, `on-demand-overlays`, `popup-first-render`, `ssr-degradation`;
- Lighthouse.

W tej rundzie e2e nie dostały nowych asercji, tylko komentarz w `on-demand-overlays`.

## 4. Odstępstwa i odrzucone uwagi

1. **B3, cel „≤ +100 B” spełniony odzyskiem kodu poza bootem, a nie cięciem P3.8.** Odzysk obejmuje kod sprzed P3.8:
   ciało odczytu `newsletter_settings` i zapis z panelu. Tak każe ustalenie: „move what is not needed at boot out of
   the entry (lazy import …)”. Kwantyzacja okna reklam (#7, nadzbiór minuty) i hak `useInteractionOrQuiet` zostają
   bez zmian. Pierwsze zaakceptowała recenzja, drugie to wspólny prymityw P3.5.
2. **Nowe pliki:**
   - `src/components/popups/sinceNavigationStart.ts` (wprost dopuszczony w ustaleniu B2);
   - `src/hooks/newsletterSettingsData.ts` (moduł leniwy wskazany przez B3: „lazy import”);
   - ich testy.

   Żaden plik spoza listy P3.8 i zatwierdzonego `useSectionPreload.ts` nie jest zmieniony.

3. **m6** (nadrobienie #5 obejmuje też zapytania ze `staleTime: 0`): bez zmian. Koszt pomijalny (panel), a zbieranie
   kluczy kosztowałoby bajty w boocie.
4. **m7** (asercja `site_font_scale` w `dehydratedPayload.test.ts`): bez zmian. Plik jest spoza listy, a wpis jest dziś
   prawdziwymi danymi fali 1, a nie zasiewem. Pokrycie zapewnia `rootRoute.test.tsx`.
5. **m2, m3, m5**: bez zmian (opis w `REVIEW.md`; kompromisy przyjęte).

## 5. Ryzyka

- **`isSectionFresh(..., true)` przy sekcji bez wpisów danych zwraca `true`.** Taka sekcja też zapisuje się
  w zatrzasku i po nim kończy na świeżości (no-op). Kosztuje jeden wpis w zbiorze subskrybentów na sekcję, bez sieci.
- **Pierwsze pobranie ustawień newslettera w przeglądarce** (zatrzask, popup, nawigacja SPA, zapis w panelu) czeka na
  mały chunk `newsletterSettingsData-*`. To dodatkowe żądanie poza oknem bootu. Popup ma podłogę ≥ 1 s, więc efekt
  nie jest widoczny. SSR ładuje ten sam moduł (`import()` w workerze, jak `lib/menus/queries` w korzeniu).
- **`ContentAreaStyle`:** realtime-inwalidacja `post_layout_settings` przed pierwszą interakcją i ciszą jest dociągana
  dopiero przy zatrzasku (wcześniej od razu). Dotyczy wyłącznie zmian z innej karty w pierwszych sekundach wizyty.
- **Miejsce `sinceNavigationStart` w grafie chunków:** Rollup (`experimentalMinChunkSize`) dokleja mały czysty chunk
  do celu o najmniejszym koszcie. Wejście i `useInFeedAds` mają równy koszt, a przy remisie wygrywa mniejszy chunk
  (`useInFeedAds`), bo Rollup przegląda kandydatów rosnąco po rozmiarze. Jeśli moduł jednak trafi do wejścia, budżet nadal mieści się w szacunku z §2 (najgorszy wariant).

## 6. Na co patrzeć (recenzja / Prove)

1. Prove:
   - `check:document-weight`: `bootClosureGzipBytes` i `bootBurstGzipBytes` wobec bazy (cel Δ ≤ +100 B raw i gz);
   - `check:bundle`: boot closure i `index`;
   - w `chunk-inventory.json`: osobny chunk `newsletterSettingsData-*` (wejście dynamiczne) i chunk z
     `sinceNavigationStart`.
2. Prove:
   - okno bootu w przebiegach z dokumentem > 120 s: zero `posts` (B1);
   - `test:e2e:artifact` z `backend-quiet.boot-home`: kontrola pozytywna `newsletter_settings` po kółku myszy idzie
     teraz przez chunk leniwy.
3. Recenzja:
   - czy `enabled: useInteractionOrQuiet()` w `ContentAreaStyle` to akceptowalna zmiana kontraktu (brak wpisu
     i inwalidacja przed zatrzaskiem czekają);
   - kolejność importów w `newsletterSettingsData.ts`: tylko jedna krawędź statyczna, do `useNewsletterSettings`.
