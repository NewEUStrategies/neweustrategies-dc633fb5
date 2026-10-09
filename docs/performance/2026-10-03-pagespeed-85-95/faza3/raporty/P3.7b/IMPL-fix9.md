# P3.7b (fala 3, partia 4a) - runda poprawek 9: budżet domknięcia bootu

- Worktree: `$SCRATCH/wt3/P3.7b`, gałąź `perf/w3-P3.7b`, baza `64dddffe`.
- Commity: `aaf54740` (IMPL), na nim nowy commit tej rundy `1ceb4bef` (bez przepisywania historii).
- `$SCRATCH` = `/tmp/claude-0/-home-user-neweustrategies-dc633fb5/57088803-e7ea-5e89-8c05-954276daf4ba/scratchpad`.
  Logi rundy: `$SCRATCH/phase3/wave3/P3.7b/fix9/`.
- Wejście: PROVE (`PROVE.md` §2) - jedyny blokujący wynik: domknięcie bootu **+2 018 B raw / +753 B gz**, wszystko
  w chunku wejściowym `index-*`. Limit KRYTYKI dla P3.7b to ≤ +1,0 KB raw, a nota orkiestratora wymaga „nie gorzej
  niż baza”.
- Recepta z PROVE/recenzji (M1/m1), wykonana w całości:
  1. usunąć duplikat `excerptFrameBool`;
  2. przenieść projekcję paska i ścinanie zajawek na serwer (klucze `withExcerpt` i `lang` zostają po obu stronach);
  3. rdzeń rozwijania T1 zostawić do jawnej akceptacji - ten rdzeń dodatkowo odchudziłem.

## 1. Co się zmieniło i dlaczego (plik po pliku)

### Kod produkcyjny

- **`src/lib/builder/postListExcerpt.ts`**
  - Usunięty `excerptFrameBool` (kopia 1:1 `getBool`). Wariant `numbered` czyta przełącznik przez
    `import { getBool } from "@/components/builder/organisms/widget-view/frame"`. `frame.ts` leży już w chunku
    wejściowym (inwentarz bazy i B), więc import nie dodaje krawędzi do domknięcia. Cyklu nie ma: `frame.ts`
    importuje tylko `themed`, `autoInvertColor` i typy.
  - `postListExcerptToggle` to teraz `c.showExcerpt !== "0"`, co jest równoważne `getStr(c, "showExcerpt") !== "0"`
    (`getStr` zwraca napis albo `""`).
  - `postListRendersExcerpt` porównuje surową wartość `variant`. Widok liczy `getStr(c, "variant") || "card"`, więc
    wynik dla `ranked`/`numbered` jest ten sam (tabela 12 wariantów × 14 wartości zielona).
  - `PostListSurface = "list" | WidgetType`. Rejestr prefetchu i preload LCP podają wprost `widget.type`, bez
    trójargumentowego wyrażenia w każdym miejscu wywołania. Zajawkę w każdym wariancie rysuje tylko `carousel`.
  - Nowe `withoutExcerpts(rows)` - jedno wspólne ścinanie dla post-listy i slidera. Woła się je wyłącznie za bramką
    `import.meta.env.SSR`.
- **`src/lib/builder/postListQuery.ts`**
  - `localizePostListRows` wraca do postaci z bazy (2 argumenty, projekcja językowa P2.5 bez zmian).
  - `queryFn` kończy się `import.meta.env.SSR && !withExcerpt ? withoutExcerpts(rows) : rows`. W buildzie klienta
    Vite podmienia `import.meta.env.SSR` na `false`, a Rollup wycina gałąź i samą funkcję.
  - `withExcerpt` zostaje w kluczu po obu stronach: zero refetchu po hydratacji, a widget z zajawką nie trafia we
    wpis widgetu bez zajawki. Komentarz pola poprawiony.
- **`src/lib/builder/sliderPostsQuery.ts`**: to samo dla slidera. `localizeSliderPostRows` jak w bazie, ścinanie
  w `queryFn` za bramką SSR, `sliderShowsExcerpt` bez zmian (jedno źródło widoku i klucza).
- **`src/lib/views/headerTickerQuery.ts`**
  - Projekcja paska działa tylko na serwerze: `import.meta.env.SSR ? projectHeaderTickerPosts(rows, lang) : rows`.
    Obejmuje dietę P2.5 oraz T4a/T4b (jeden tytuł, `slug` tylko bez `href`).
  - Klucz z `lang`, `keepPreviousData` i sprostowany komentarz L4 są bez zmian.
  - Klient trzyma pełny wiersz z server fn. `itemTitle` (`<lang> || <drugi> || ""`) i `itemHref`
    (`href ?? /post/<slug>`) dają z niego ten sam znacznik.
  - Skutek uboczny: z wejścia znika także bazowa projekcja P2.5, więc moduł jest mniejszy niż w bazie.
- **`src/lib/ssr/dehydratedQueryEnvelope.ts`** (T1)
  - Ścieżka klienta jest odchudzona:
    - stała bez `Object.freeze`;
    - rozwijanie zapytań bez osłon kształtu (pełne zapytanie przechodzi bez zmiany treści);
    - bez odtwarzania pustej listy `mutations` (query-core 5.101.2: `hydrate` czyta `mutations || []`, sprawdzone
      w `hydration.js`);
    - `expandRouterDehydrated` bez `isReadableLike`: integracja 1.169.1 i tak woła `queryStream.getReader()`
      bezwarunkowo;
    - `mapQueryStream` bierze czytnik od razu, a `pull` jest łańcuchem `read().then(...)`.
  - Mechanizm i kolejność się nie zmieniają: dalej `pull`, bez `TransformStream`, zgodnie z doktryną
    `ssrTiming.ts` po incydencie ok. 61 s. Kompaktowanie biegnie tylko w gałęzi serwera `router.tsx`.
  - Recenzja m4 (tylko kod serwera, 0 B u klienta): `queryHash` znika wyłącznie przy kluczu strukturalnym (prymitywy,
    tablice, obiekty proste). Klucz z instancją klasy zachowuje hash, bo po deserializacji seroval klient
    policzyłby inny.
- **`src/lib/builder/prefetch.ts`**: `postListQueryOptions(widget.content, lang, widget.type)` w obu rejestrach.
  Wewnątrz `if` typ jest zawężony do `post-list`/`carousel`.
- **`src/lib/builder/heroImage.ts`** (T6/T2, P3.2a równolegle): jedna instrukcja w `postListPreload`,
  `postListQueryOptions(c, lang, widget.type)`. Bez zmiennej `surface`, więc diff jest mniejszy niż w `aaf54740`.
  Region drabiny P3.2a jest nietknięty.

### Testy

- **`src/lib/ssr/__tests__/dehydratedQueryEnvelope.test.ts`**
  - Round-trip porównuje z kopertą bez pustych `mutations` i sprawdza, że oryginał miał `[]`.
  - Ładunek bez koperty wraca bez zmiany treści (już nie ta sama referencja).
  - Nowe: anulowanie strumienia wynikowego anuluje źródło.
  - Nowe: klucz z instancją klasy zachowuje `queryHash`, a klucz z obiektem prostym go traci (m4).
- **`src/__tests__/router.test.tsx`**: integracja widzi pełną kopertę bez pustych `mutations`.
- **`src/lib/builder/__tests__/postListExcerpt.test.ts`**
  - Bez testu równoważności kopii, bo kopii już nie ma. Tabela liczy oczekiwanie z prawdziwego `getBool`.
  - Nowe: `widget.type` (`post-list`/`carousel`) daje ten sam predykat co powierzchnia.
  - Nowe: `withoutExcerpts` zdejmuje oba klucze, resztę zostawia i nie mutuje wejścia.
- **`src/lib/builder/__tests__/postListQueryData.test.ts`**: nowy blok „ścinanie wyłącznie na serwerze”. Prawdziwe
  `queryFn` z atrapą Supabase, `vi.stubEnv("SSR", ...)`:
  - serwer: `ranked` bez `excerpt_*`, `card` z zajawką;
  - klient: pełny wiersz;
  - slider: serwer ścina, klient nie.

  Kontrola: odwrócenie bramki w którąkolwiek stronę czerwieni jeden z przypadków.

- **`src/components/builder/organisms/widget-view/__tests__/localizedPostRowsParity.test.tsx`**: kontrakt znacznika
  (10 wariantów × 6 wartości × 2 powierzchnie, plus slider) liczy wiersze zrzutowane przez
  `withoutExcerpts(localize…)`. Komentarz dopisuje, że ten kontrakt czyni ścinanie tylko na serwerze bezpiecznym.
- **`src/lib/views/__tests__/headerTickerQuery.test.ts`**
  - Przypadki, które oczekują projekcji, emulują serwer (`stubEnv("SSR", true)`): loader SSR = klient,
    `latest`, rzut na język klucza.
  - Nowy przypadek: na kliencie `queryFn` oddaje pełny wiersz.
- **`src/components/header/__tests__/TrendingTicker.langSwitch.test.tsx`**
  - Wpis PL powstaje jak z dokumentu (`SSR` = prawda w chwili rozstrzygnięcia `queryFn`, czyli tylko `title_pl`).
  - Stan pośredni: pasek stoi z tytułem PL, bez rezerwy.
  - Po odpowiedzi EN: „Post a”, a wpis EN na kliencie jest pełnym wierszem.
  - Kontrola `keepPreviousData` działa jak dotąd.
- `src/lib/ci/__tests__/dehydratedPayload.test.ts` (środowisko `node`, `import.meta.env.SSR` = prawda) bez zmian
  i zielony: stan `/` dalej bez `excerpt_*` w 7 zapytaniach i z paskiem z jednym tytułem.

## 2. Bajty klienta: szacunek (build, `check:bundle` i `check:document-weight` są w Prove)

W tym etapie nie wolno budować aplikacji, więc liczyłem moduły osobno.

- Metoda: `bun build --minify`, `import.meta.env.SSR=false`, zależności zewnętrzne, tylko eksporty czytane przez
  klienta. Skrypt: `fix9/est/run.sh`, wersje A = `64dddffe`, B = `aaf54740`, C = ta runda.
- Liczby niosą narzut estymatora (linie `import`, mapa przestrzeni nazw, `globalThis.x`), więc różnice B−A są
  zawyżone względem buildu o ok. 300 B.

| Moduł (szacunek, raw / gz)                           |              A | B (`aaf54740`) |     C (runda 9) |             C − A |
| ---------------------------------------------------- | -------------: | -------------: | --------------: | ----------------: |
| `dehydratedQueryEnvelope` (`expandRouterDehydrated`) |              - |    1 064 / 603 |       724 / 479 |       +724 / +479 |
| `postListExcerpt` (toggle + predykat)                |              - |      573 / 332 |       275 / 253 |       +275 / +253 |
| `postListQuery` (cały moduł)                         |  5 312 / 2 433 |  5 521 / 2 498 |   5 447 / 2 486 |        +135 / +53 |
| `sliderPostsQuery` (cały moduł)                      |  2 279 / 1 219 |  2 480 / 1 292 |   2 444 / 1 283 |        +165 / +64 |
| `headerTickerQuery` (opcje, peek, źródło)            |    1 299 / 673 |    1 498 / 763 | **1 219 / 644** |     **−80 / −29** |
| `prefetch` (cały moduł)                              |  8 986 / 2 671 |  9 062 / 2 685 |   9 000 / 2 677 |          +14 / +6 |
| **Razem**                                            | 17 876 / 6 996 | 20 198 / 8 173 |  19 109 / 7 822 | **+1 233 / +826** |

- Kalibracja na pomiarze B z PROVE:
  - estymator: B − A = +2 322 raw, a build zmierzył **+2 018 B raw / +753 B gz**;
  - runda zdejmuje (B − C) 1 089 B raw estymatora, do tego `heroImage` ok. 35 B (bez `const surface = …`);
  - **oczekiwane domknięcie bootu C − A ≈ +0,9 KB raw (przedział ok. 0,85-1,05 KB) i ok. +0,5 KB gz**;
  - z tego rdzeń T1 (rozwijanie koperty) to ok. 0,65 KB raw - mniej niż 0,9 KB z noty orkiestratora.
- Dla porównania limit KRYTYKI P3.7b to ≤ +1,0 KB raw, a zapas progów bazy wynosi 5 213 B raw i 1 702 B gz.
  Dokładne liczby da `check:bundle`/`check:document-weight` w Prove.
- Czego już nie ma w chunku wejściowym (sprawdzone w wyjściu estymatora):
  - `excerptFrameBool`;
  - `withoutExcerpts` i obie gałęzie ścinania;
  - `projectHeaderTickerPosts` (także bazowa projekcja P2.5);
  - `isRecord`/`hasQueries`/`isReadableLike` po stronie klienta;
  - `Object.freeze`, odtwarzanie `mutations`, trójargumentowe `surface` w `prefetch`/`heroImage`.
- Bez zmian względem `aaf54740`: bajty dokumentu, czyli bariera, porcje, zajawki, pasek, speculation rules i T5/T6.
  Kształt stanu odwodnionego SSR jest identyczny (test `dehydratedPayload` zielony), więc `htmlRawBytes`
  −12 883 B, `dehydratedQueryHashCount` 0 i `streamedStateBytes` 6 878 powinny się powtórzyć. Wyjątek: przy kluczu
  z instancją klasy hash zostaje - na `/` takiego klucza nie ma.

## 3. PB2: ustalenie PROVE i co z nim zrobiłem

- **Teza „PB2 krótsze” nie jest dowiedziona i tego nie podtrzymuję.** T1 przenosi pracę: parsowanie
  i ewaluacja `$tsr` (bariera −8,3 KB) maleją, ale klient liczy `hashKey(queryKey)` dla każdego zapytania przed
  `hydrate`. W A hashe przychodziły z serwera.
  - PROVE zmierzył ok. 5-6 ms przy 4× CPU (ok. 1,3-1,5 ms bez dławienia) w makrozadaniu hydratacji.
  - Część tego to pierwsza kompilacja `hashKey`, którą A płacił później, w `useQuery` podczas hydratacji drzewa.
- Ta runda zmniejsza alokacje rozwijania (bez osłon per zapytanie, bez nowej tablicy `mutations`, jedna warstwa
  obiektu). Kosztu `hashKey` nie da się usunąć bez oddania bajtów: hash jest potrzebny `queryCache.get(queryHash)`
  dla porcji przychodzącej po zamontowaniu obserwatora (kontrola negatywna w teście).
- Zysk T1 jest po stronie dokumentu: ParseHTML na mobile 5/5 par w dół, EvaluateScript skryptów inline −4 ms,
  `bootup-time` dokumentu na desktopie −33 ms (istotne).
- Propozycja dla orkiestratora: kryterium „PB2 krótsze” zamienić na „suma PB2 + makrozadanie `router-hydrate`
  nie rośnie” (recenzja m3).
- Gdyby PB2 miało realnie spaść, opcja na później (poza tą pozycją): serwer wysyła klucze z posortowanymi polami,
  a klient liczy hash zwykłym `JSON.stringify` (szybka ścieżka V8, bez zastępnika). Nie wdrażałem - dokłada
  subtelny kontrakt.

## 4. Bramki tej rundy

| Bramka                                                                                                                                                                                                   | Wynik                                                                                                                 | Log                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `bunx prettier --write` (14 plików rundy) + `--check`                                                                                                                                                    | czysto                                                                                                                | -                        |
| `light.sh bunx eslint` (35 plików `.ts/.tsx` pozycji)                                                                                                                                                    | 0 błędów, 8 ostrzeżeń `react-refresh` sprzed zmiany (`TrendingTicker.tsx`, `router.tsx`)                              | `fix9/eslint.log`        |
| typecheck (`heavy-bg.sh` + `typecheck-noinc.sh`: tsgo + tsc scripts + tsgo e2e)                                                                                                                          | **zielony** (exit 0, jeden przebieg w rundzie)                                                                        | `fix9/typecheck.log`     |
| `light.sh bunx vitest run` - 48 plików zależnych od zmienionych modułów (lista `fix9/tests-all.txt`) + `documentWeightState`, `speculationRules`, `homeRoute`, `publicCatchAllRoute`, `queryStreamGuard` | **53 pliki, 1 320 zielonych** (+5 expected fail, 1 skip URLPattern)                                                   | `fix9/vt5.log`           |
| `light.sh bun run verify:static`                                                                                                                                                                         | **zielony** - 15 bramek OK (295 s; m.in. `format:check`, `check:ts-sql-contract`, `check:dangerous-html`, bramki SQL) | `fix9/verify-static.log` |
| build, `check:bundle`, `check:document-weight`, e2e artefaktu, Lighthouse                                                                                                                                | nie uruchamiane (zakaz w tym etapie) - do Prove                                                                       | -                        |

Bramek usuniętych w PR #475 nie odtwarzałem.

## 5. Odstępstwa od planu i recepty

1. **Wiersz klienta jest pełny** (zajawki i pasek). Plan T2/T4 zakładał projekcję w `queryFn` po obu stronach
   („SSR, hydratacja i refetch mają ten sam kształt”). Recepta PROVE każe przenieść ją na serwer, żeby kod zszedł
   z wejścia.
   - Bezpieczeństwo daje kontrakt znacznika: dla `withExcerpt === false` pełny wiersz nie rysuje `.cms-post-excerpt`,
     a pasek liczy tytuł i adres z łańcucha `itemTitle`/`itemHref`.
   - Refetch klienta (po 2/5 min świeżości albo przy miękkiej zmianie języka) trzyma kilka pól więcej w pamięci, ale
     w dokumencie nic nie przybywa.
2. **`PostListSurface` przyjmuje też `widget.type`**: `"list" | WidgetType`, a `carousel` to jedyna powierzchnia
   z zajawką w każdym wariancie.
   - Plan miał wymagany parametr powierzchni. Parametr zostaje wymagany w `postListQueryOptions` i dalej jest
     unią zamkniętą, więc literówka jest błędem typu.
   - Szersza unia oszczędza wyrażenie przeliczające w `prefetch` ×2 i `heroImage`.
3. **T1: pusta lista `mutations` nie jest odtwarzana na kliencie.** Wcześniej ją odtwarzałem. `hydrate` czyta
   `mutations || []`.
4. **m4 z recenzji wdrożone** (warunek klucza strukturalnego, kod tylko serwerowy). Recenzja dopuszczała też samą
   notę w nagłówku.
5. **PB2**: kryterium planu nie jest spełnione. Opis i propozycja zmiany kryterium w §3.

## 6. Ryzyka

- **Szacunek bajtów, nie pomiar.** Środek przedziału ok. +0,9 KB raw mieści się w limicie ≤ +1,0 KB, ale górna
  granica (ok. 1,05 KB) już nie. Rozstrzyga `check:bundle`/`check:document-weight` w Prove. Gdyby zabrakło kilkudziesięciu
  bajtów, pozostałe kandydatury są drobne:
  - `fetchStatus` ze stałej, bo `hydrate` go nadpisuje albo pomija (ok. 20 B);
  - `sliderShowsExcerpt` inline (ok. 30 B, kosztem jednego źródła widoku i klucza).
- **Bramka `import.meta.env.SSR`** jest tym samym mechanizmem, którym repo wycina kod serwerowy z klienta
  (`Footer`, `LegalLinks`, `HomeBuilderContent`, `documentCache.server`). W vitest `node` ma ją prawdziwą,
  a `happy-dom` fałszywą. Testy ustawiają ją jawnie (`vi.stubEnv`).
- **Kształt wiersza po refetchu klienta różni się od SSR** (pełny zamiast zrzutowanego). Znacznik jest ten sam
  (kontrakt), więc hydratacja tego nie dotyczy: dane hydratowane pochodzą z SSR. Strukturalne współdzielenie przy
  refetchu daje nowy obiekt i jeden render, jak przy każdej nowej odpowiedzi.
- **Miękka zmiana języka paska**: stan pośredni jak w PROVE (tytuł PL z wpisu SSR, pasek stoi). Po odpowiedzi wpis
  EN jest pełny, więc kolejna zmiana języka pokazuje od razu tytuł właściwego języka - drobna poprawa wobec m7.
- **Scalanie z P3.2a:**
  - `heroImage.ts`: ta sama jedna instrukcja w `postListPreload`, krótsza niż w `aaf54740`;
  - `heroImage.test.ts`: bez zmian w tej rundzie;
  - `documentWeight.ts` i budżety: bez zmian w tej rundzie.

## 7. Co sprawdzić (recenzja / Prove)

1. Prove na nowym commicie: `check:bundle` (overall/public/entry/boot vs A), `check:document-weight`.
   Oczekiwane: `bootClosureRawBytes` ok. +0,9 KB względem A (limit +1,0 KB) i gz ok. +0,5 KB. Metryki dokumentu jak
   w PROVE: `htmlRawBytes` −12,9 KB, `dehydratedQueryHashCount` 0, `streamedStateBytes` ok. 6,9 KB,
   `imagePreloadNonCandidate` 0, `documentPreloadDuplicates` 0.
2. W chunku wejściowym B′ nie ma: `excerpt_pl` w gałęzi ścinania, `projectHeaderTickerPosts`
   (`title_en||n.title_pl||""` z obiektem `author_display_name`), `excerptFrameBool` (jedno wystąpienie
   `r==="true"||r==="1"||r==="yes"` zamiast dwóch).
3. `test:e2e:artifact` w środowisku jak w CI (zero refetchów, zero błędów hydratacji) i sonda miękkiej zmiany języka
   (pasek bez zapadania, CLS 0). Zmienił się kod klienta rozwijania strumienia (`pull` jako łańcuch `then`) i pasek
   na kliencie (pełny wiersz).
4. `postListRendersExcerpt` z `widget.type` w `prefetch`/`heroImage` daje ten sam klucz co widok (`sectionPrefetch`,
   `heroImage` zielone).
5. Decyzja orkiestratora: akceptacja rdzenia T1 (ok. 0,65 KB raw) w ramach limitu pozycji i zmiana kryterium PB2 (§3).
