# P3.7b (fala 3, partia 4a) - RECENZJA adwersaryjna

- Worktree: `$SCRATCH/wt3/P3.7b`, commit `aaf54740` (jeden), diff `64dddffe...HEAD`: 36 plików, +1737/−151.
- Kontekst: `faza3/PLAN-FALI-3.md` §2 (P3.7), `faza3/plany/P3.7.md` (T1, T2, X1, T4a/b, T5, T6, krok 9), `faza3/plany/KRYTYKA.md`
  (L4, L5, §3.3 limity Δ raw, §2 własność plików), `faza3/diagnoza/waga-dokumentu.md`, `IMPL.md` pozycji.
- `$SCRATCH` = `/tmp/claude-0/-home-user-neweustrategies-dc633fb5/57088803-e7ea-5e89-8c05-954276daf4ba/scratchpad`.
  Logi recenzji: `$SCRATCH/phase3/wave3/P3.7b/review/`.

## Werdykt

**APPROVE z warunkami dla Prove** - zero błędów blokujących. Mechanizm jest zgodny z planem, a odstępstwa mają podane
powody. Zakres plików się zgadza, testy sprawdzają mechanizm i mają kontrolę negatywną. Bramki lekkie są zielone.
Jedna uwaga **major** (budżet domknięcia bootu policzony niepełnie) wymaga pomiaru w Prove, zanim orkiestrator scali
P3.1. Pozostałe uwagi są drobne.

## Bramki uruchomione w recenzji

| Bramka                                                                                                                   | Wynik                                                                                    | Log                 |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------- |
| `light.sh bunx eslint` (35 dotkniętych `.ts/.tsx`)                                                                       | 0 błędów, 8 ostrzeżeń `react-refresh` sprzed zmiany (`TrendingTicker.tsx`, `router.tsx`) | `review/eslint.log` |
| `light.sh bunx vitest run` (19 dotkniętych testów + `queryStreamGuard`, `rootRoute`, cały `components/header/__tests__`) | **25 plików, 729 zielonych, 1 pominięty** (URLPattern `skipIf` w Node)                   | `review/vitest.log` |
| `light.sh bun run verify:static`                                                                                         | **15 bramek OK** (331 s; m.in. `format:check`, `check:ts-sql-contract`)                  | `review/verify.log` |
| `prettier --check` (36 plików)                                                                                           | czysto                                                                                   | -                   |
| typecheck, build, `check:bundle`, `check:document-weight`, e2e, Lighthouse                                               | nie uruchamiane (zakaz w recenzji; należą do Prove)                                      | -                   |

Commit: polski opis, stopka dokładnie `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` +
`Claude-Session: https://claude.ai/code/session_018pV9XfFuDnwMxKGJSFfcDg`. Worktree czysty. Brak nowych zależności
(`package.json` nietknięty) i brak zbędnych plików.

## Zakres i zgodność z planem

- **Pliki:** wszystkie pliki produkcyjne są na liście P3.7 §4, w części T1/T2/X1/T4/T5/T6 i metryki.
  `vite*.config.ts`, `__root.tsx`, `aboveFold.tsx`, `globalColors.ts` i `ContentAreaStyle.tsx` są nietknięte. T3 nie
  wszedł (zgodnie z notą). `$.tsx` jest objęty zgodą orkiestratora (T6, a T5 to opcja planu).
  - `heroImage.ts` zmienia jedną instrukcję w `postListPreload` (`:181-184`). Region jest rozłączny z drabiną P3.2a.
    Sprawdziłem diff P3.2a: konflikt może być tylko tekstowy, w `heroImage.test.ts`.
  - `documentWeight.ts` i plik progów są zmienione wyłącznie addytywnie. Istniejące progi bez zmian.
  - Testy spoza listy kroków (`heroImage.test`, `localizedQueryKeys.gate`, `postListOrdering`, `uniqueOnPageDedup`,
    `widgetTaxonomyRequestLine`) dostały tylko mechanicznie trzeci argument `surface`. Wymusza go WYMAGANY parametr
    z planu (§3.3), więc to nie jest rozszerzenie zakresu.
- **T1:** mechanizm zgodny z §3.2.
  - Kompaktowanie działa ZA `guardQueryStream`. Strażnik dostaje surowy strumień (test z prawdziwym strażnikiem).
  - Wejście nie jest mutowane, więc `sentQueries` integracji jest bezpieczne.
  - `data` zostaje tą samą referencją.
  - `queryHash` jest zdejmowany tylko wtedy, gdy równa się `hashKey(queryKey)`.
  - Ze stanu znikają tylko pola `Object.is`-równe stałej.
  - Klient rozwija kopertę przed `integrationHydrate`.
  - `shouldDehydrateQuery`, polityka `refetchOnMount` P3.8 i literał `setTimeout(0)` są nietknięte.
  - Odstępstwo: `pull` zamiast `TransformStream` (uzasadnione: zgodność Workers) oraz zdjęta pusta lista `mutations`
    (`hydrate` czyta `mutations || []`).
  - Sprawdziłem `@tanstack/router-ssr-query-core` 1.169.1 i `query-core` 5.101.2 (`hydration.js`). Klient czyta strumień
    łańcuchem `reader.read().then(...)`, więc dodatkowa warstwa `pull` dokłada tylko mikrozadania. Porcje dostarczone
    przed bootem lądują w cache przed `setTimeout(0)` - tak samo jak dotąd. Ostateczny dowód: e2e artefaktu w Prove.
- **T2:** predykat `postListRendersExcerpt` porównałem z każdą gałęzią `PostListView`. Zajawkę rysują: `list` `:352`,
  `numbered` `:523` (z `getBool`), `classic` `:573`, `flex-grid` `:612`, `boxed-list` `:689` i `PostCard`
  `:958`/`:992`. `ranked` (`:365-443`) zajawki nie rysuje, a karuzela rysuje ją przez `PostCard` w każdym wariancie.
  - Wszystkie miejsca wywołania liczą powierzchnię tak samo jak `WidgetView` (`case "carousel"` → `carousel`): widok,
    `prefetch.ts` ×2 i `heroImage.ts`.
  - Kontrakt znacznika (10 wariantów × 6 wartości × 2 powierzchnie na pełnych i zrzutowanych wierszach) złapałby
    znikającą zajawkę.
  - Klucz `edgeTtlCache` jest bez `withExcerpt`.
  - Inni czytelnicy wierszy post-listy (JSON-LD, dedup) nie czytają `excerpt_*` (grep).
- **X1:** wzorzec zaczyna się od `/`. Implementer sprawdził macierz konstruktorem napisowym z bazą, czyli tak, jak
  parsuje go Chromium dla `href_matches` (`tools/urlpattern-matrix.mjs`): 551 ścieżek, 0 różnic w Chromium 141.
  To zamyka KRYTYKA L5.
- **T4:**
  - Język stoi w kluczu PO źródle (odstępstwo z powodem: `queryLabel`).
  - Projekcja odtwarza łańcuch `itemTitle`, a `slug` jedzie tylko przy wierszu bez `href`.
  - `keepPreviousData` jest ustawione.
  - Komentarz L4 sprostowany.
  - Parytet klucza SSR i klienta się zgadza:
    - klon i18n żądania ma `lng: currentLang()` (`src/lib/i18n.ts:170`);
    - `languageChanged` woła `setClientLang` (`i18n.ts:218-223`), więc `TrendingTicker` (`i18n.language`), rozgrzewka
      w `__root.tsx:1023-1027` i `peekHeaderTickerPosts` liczą ten sam klucz.
- **T5/T6:** `seoSettings` to surowe `seo` z cache (test tożsamości w `/` i `/$`), a `head()` parsuje je bez zmiany
  wyniku (JSON-LD równy).
  - `heroPreloads` trafia do `WeakMap<QueryClient>` żądania. Nagłówek `Link` i `preload()` zostają.
  - Predykat kompletności P3.6b (`trackSsrQueryCompleteness`, `src/lib/ssr/resilientLoad.ts:271-320`; plików
    `documentCompleteness*` nie ma) czyta wyłącznie cache zapytań. Test pokazuje, że `/` z kandydatem LCP daje
    `{complete: true}`.
- **Metryki:** `streamedStateBytes` i `dehydratedQueryHashCount` są w `DocumentWeight`, `analyzeDocument` i
  `GATED_METRICS`, z testem. Próg `dehydratedQueryHashCount` = 0, a `streamedStateBytes` tymczasowo z pomiaru bazy.
  Propozycja ratchetu jest w IMPL §8.

## Uwagi

### M1 [major] Budżet domknięcia bootu policzony niepełnie (limit KRYTYKI P3.7b ≤ +1,0 KB raw)

- **Gdzie:**
  - `IMPL.md` §4: szacunek „ok. +1,0-1,2 KB raw / +0,3-0,45 KB gz” obejmuje sam moduł rozwijania
    (`tools/est-entry.ts`: tylko `expandRouterDehydrated`, 1 062 B);
  - `src/lib/builder/postListExcerpt.ts:29-69`;
  - `src/lib/builder/heroPreloadStore.ts`;
  - `src/lib/builder/postListQuery.ts:189-224,463-517`;
  - `src/lib/builder/sliderPostsQuery.ts:74-95,174-220`;
  - `src/lib/views/headerTickerQuery.ts:107-182`.
- **Dowód:** inwentarz bazy (`base-w3g/reports/chunk-inventory.json`) umieszcza w chunku wejściowym
  `index-C0hznT0T.js` (`isEntry: true`) moduły `postListQuery`, `sliderPostsQuery`, `headerTickerQuery`, `prefetch.ts`,
  `routes/index.tsx`, `routes/$.tsx` (część bez `component`) i `widget-view/frame.ts`.
  - Do wejścia trafiają więc także: nowy `postListExcerpt.ts` (`bun build --minify`: 573 B raw / 315 B gz, recenzja
    `review/est2.ts`), `heroPreloadStore.ts`, gałęzie `withExcerpt` i projekcja paska.
  - Realny przyrost to raczej ok. +1,8-2,2 KB raw, nie +1,0-1,2.
  - Zapas bazy `bootClosureRawBytes` wynosi 5 213 B (1 637 758 − 1 632 545). P3.2a ma limit ≤ +1,2 KB, P3.1 ≤ +1,0 KB.
    Suma jest na granicy zapasu.
- **Naprawa:**
  1. W Prove zmierzyć `bootClosureRawBytes`/`GzipBytes` i `bootBurstGzipBytes` artefaktu B wobec `base-w3g` i podać
     Δ raw w raporcie.
  2. Jeśli Δ raw przekracza +1,0 KB, zdjąć najpierw duplikat `excerptFrameBool` (m1).
  3. Jeśli i to nie wystarczy, orkiestrator jawnie akceptuje przekroczenie przed startem P3.1.

### m1 [minor] `excerptFrameBool` dubluje `getBool` w tym samym chunku wejściowym

- **Gdzie:** `src/lib/builder/postListExcerpt.ts:29-42`.
- **Dowód:** uzasadnienie „moduł `lib` nie importuje z `components`” nie jest regułą repo (12 importów `@/components`
  w `src/lib` poza testami). `frame.ts` już leży w chunku wejściowym, więc import nie dodaje krawędzi do domknięcia
  bootu. Kopia to ok. 250 B raw powtórzonego kodu w wejściu. Test równoważności łagodzi ryzyko rozjazdu, ale nie usuwa
  bajtów.
- **Naprawa:** `import { getBool } from "@/components/builder/organisms/widget-view/frame"` w `postListExcerpt.ts`
  (bez edycji `frame.ts`), usunąć `excerptFrameBool` i jego test równoważności. Albo zostawić i opisać w raporcie
  bajtów (M1).

### m2 [minor] Edytor: przełącznik zajawki i zmiana wariantu przebudowują klucz (mignięcie szkieletu na kanwie)

- **Gdzie:** `src/lib/builder/postListQuery.ts:223` (`withExcerpt` w kluczu), `src/lib/builder/sliderPostsQuery.ts:95`.
- **Dowód:** przed zmianą przełączenie „Pokaż zajawkę” (albo wariantu na `ranked` lub z `ranked`, `numbered` +
  `showExcerpt`) w panelu buildera trzymało ten sam wpis cache. Teraz daje nowy klucz bez danych: `isPending` →
  szkielet plus fetch kliencki (`edgeTtlCache` działa tylko w izolacie serwera). Strony publicznej to nie dotyczy,
  bo treść widgetu jest tam stała.
- **Naprawa:** akceptacja z notą w raporcie. Opcjonalnie `placeholderData` (poprzednie wiersze) wyłącznie w kanwie
  edytora. Nie dodawać `keepPreviousData` do zapytań publicznych: przy miękkiej zmianie języka pokazałyby wiersze
  drugiego języka.

### m3 [minor] T1 przenosi część pracy do makrozadania hydratacji

- **Gdzie:** `src/router.tsx:338`, `src/lib/ssr/dehydratedQueryEnvelope.ts:88-94`.
- **Dowód:** rozwinięcie liczy `hashKey` (JSON z sortowaniem kluczy; klucz post-listy ma 18 pól) i rozkłada obiekty
  dla każdego zapytania bariery i porcji (fixture: 21 zapytań). Dzieje się to w makrozadaniu 1 haka `hydrate`, a nie
  w zadaniu PB2 (`StartClient` + `$_TSR`). Koszt jest rzędu ułamka ms na prawdziwym CPU, ale to PRZENIESIENIE: PB2
  krótszy o parsowanie ok. 6 KB, makrozadanie 1 dłuższe o rozwijanie.
- **Naprawa:** w Prove (`--compare`, mobile + desktop4x) zestawić osobno PB2 i zadanie z `router-hydrate`
  (makrozadanie 1) dla A i B. Kryterium: suma obu nie rośnie, a żadne z nich nie przekracza 50 ms sym.

### m4 [minor] Warunek zdjęcia `queryHash` nie chroni kluczy z obiektami nieprostymi

- **Gdzie:** `src/lib/ssr/dehydratedQueryEnvelope.ts:84` (serwer), `:91` (klient).
- **Dowód:** serwer porównuje `queryHash` z `hashKey(queryKey)` na kluczu ORYGINALNYM. Klient liczy `hashKey` na kluczu
  po deserializacji seroval. `hashKey` sortuje pola wyłącznie obiektów prostych (`isPlainObject`).
  - Zapytanie z kluczem zawierającym instancję klasy (pola niesortowane na serwerze) po deserializacji staje się
    obiektem prostym (pola sortowane).
  - Hash klienta byłby wtedy inny niż hash `useQuery`, które buduje klucz z tą samą klasą. Skutek: hydratacja pod obcym
    hashem i refetch.
  - Dziś żaden klucz tego nie robi: klucze to literały, tablice i obiekty proste, a `Date` daje ten sam napis po obu
    stronach. To ryzyko na przyszłość, nie błąd.
- **Naprawa:** zdejmować `queryHash` tylko wtedy, gdy klucz składa się z prymitywów, tablic i obiektów prostych
  (rekurencyjny predykat). Albo dopisać w nagłówku modułu, że klucze muszą być strukturalnie serializowalne, i dodać
  przypadek testowy z instancją klasy (hash zostaje w przesyłce).

### m5 [minor] Margines celu `htmlRawBytes` jest cienki i policzony na innym wariancie dokumentu

- **Gdzie:** `IMPL.md` §4 (symulacja −12 345 B na `home-B.html`, wariant LH).
- **Dowód:** cel P3.7b to ≥ −11,5 KB, więc zapas wynosi ok. 0,8 KB. Bramka `check:document-weight` mierzy wariant
  przeglądarkowy strumieniowy (plan §1: 337 923 B na P3.6a), a symulacja liczyła wariant z przebiegu LH. Do tego
  `withExcerpt` dodaje do każdego klucza post-listy i slidera, a język do klucza paska.
- **Naprawa:** w Prove liczyć Δ `htmlRawBytes` na medianach `check:document-weight` artefaktu B wobec
  `integ-tip3/document-weight-2.json` (328 326 B). Przy wyniku < 11,5 KB raport zgodnie z notą. Przy okazji
  potwierdzić `dehydratedQueryHashCount = 0`, `imagePreloadNonCandidate = 0` i `documentPreloadDuplicates = 0`.

### m6 [minor] `dehydratedQueryHashCount.measured` = 21 przy `max` 0

- **Gdzie:** `scripts/performance/document-weight-budgets.json:103`.
- **Dowód:** pole `measured` pozostałych wpisów opisuje stan, dla którego ustalono próg. Tu jest wartość bazy przed
  zmianą (opisana w `_comment`), która z progiem 0 czyta się jak przekroczenie.
- **Naprawa:** po pomiarze artefaktu orkiestrator wpisuje w ratchecie `measured` = pomiar B (0). Bez zmiany progu.

### m7 [minor, UX, zaakceptowane w planie] Miękka zmiana języka paska

- **Gdzie:** `src/lib/views/headerTickerQuery.ts:175-180`.
- **Dowód:** do odpowiedzi EN pasek pokazuje tytuły PL pod `<html lang="en">` (zejście `itemTitle`) i robi jedno
  dodatkowe wywołanie server fn na każdą zmianę języka. Wysokość jest utrzymana (`keepPreviousData`, test
  `TrendingTicker.langSwitch`, mutacja bez `keepPreviousData` czerwieni test).
- **Naprawa:** w Prove uruchomić e2e P2.5 miękkiej zmiany języka (`/` → `en` i `/en` → `pl`): brak zapadnięcia
  i CLS 0. Innej zmiany kodu nie trzeba.

## Co sprawdziłem i nie znalazłem problemu

- Parytet SSR i klienta T2/T4: klucze liczy ta sama funkcja po obu stronach, a rejestr prefetchu daje ten sam klucz co
  widok (`sectionPrefetch.test`). `heroImage.ts` czyta wpis spod tej samej powierzchni.
- Tożsamość cache dokumentu: klucz z URL-a nie zmienia się, a predykat kompletności nie czyta danych loadera ani
  etykiet zależnych od `withExcerpt` lub języka paska (etykieta `header_ticker.<źródło>`, korzeń
  `builder-post-list`).
- Graf chunków: nowe moduły nie mają cykli. `dehydratedQueryEnvelope` importuje tylko `@tanstack/react-query`, które
  już jest w wejściu. Gałąź serwera `router.tsx` jest wycinana flagą `isServer` (IMPL: `guardQueryStream` nie
  występuje w chunkach klienta bazy). Do potwierdzenia w `check:chunks` i `check:entry-purity` w Prove.
- Zalogowani, redaktorzy i admin: ścieżki publiczne są wspólne. Zmiana dotyczy tylko kanwy edytora (m2).
- EN (`/en`): projekcje paska i post-listy są testowane dla PL i EN (`dehydratedPayload.test`).
- SEO: JSON-LD `/` i `twitter:site` `/$` są bez zmian (testy). Preload LCP i nagłówek `Link` są bez zmian (testy
  magazynu). Speculation rules są semantycznie równoważne.
- Zgoda i prywatność: bez wpływu.
- Testy i mechanizm (myślowe cofnięcie zmiany):
  - cofnięcie kompaktowania na serwerze albo rozwinięcia na kliencie czerwieni `router.test.tsx`, a kontrola
    negatywna w `dehydratedQueryEnvelope.test.ts` pokazuje, że bez rozwinięcia dane giną;
  - usunięcie `keepPreviousData` czerwieni `TrendingTicker.langSwitch`;
  - zła powierzchnia albo pominięta gałąź czerwieni tabelę `postListExcerpt.test` i kontrakt znacznika.
- AGENTS.md: bez nowych wywołań Supabase. Kinetic Signal Notch i TOC są nietknięte. CSS nie przybywa (zapas sumy CSS
  0,2 KB jest bezpieczny).

## Warunki Prove (przed scaleniem P3.1)

1. `check:document-weight` na artefakcie B:
   - `htmlRawBytes` ≥ −11,5 KB wobec 328 326 B (m5);
   - `dehydratedQueryHashCount` = 0;
   - zmierzone `streamedStateBytes`;
   - `imagePreloadNonCandidate` = 0 i `documentPreloadDuplicates` = 0;
   - Δ `bootClosure*`/`bootBurstGzipBytes` w raporcie (M1).
2. `check:bundle`, `check:chunks`, `check:entry-purity`.
3. `test:e2e:artifact` w środowisku jak w CI: zero refetchów na `/` po hydratacji i zero błędów hydratacji.
4. e2e P2.5 miękkiej zmiany języka (m7).
5. Lighthouse `--compare` mobile + desktop4x:
   - ParseHTML i PB2 krótsze, przy osobnym liczeniu makrozadania 1 (m3);
   - FCP/LCP ±0,02 s;
   - CLS ≤ 0,001;
   - TBT bez regresji.
