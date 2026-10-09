# Recenzja integracji P3.8 x P3.6b: interakcja semantyczna i zachowanie bootu

- Przedmiot: `integ/w3-p38` @ `f2085e6c` (merge `c7f0c12d` + test strażnika), baza `b8bf6c14`.
- Tryb: tylko odczyt worktree. Sondy w `scratchpad/phase3/integ-p38/review-probes/`.
- **Werdykt: approve.** Nie znalazłem defektu blokującego. Strona główna (`/`, `/en`) i strona buildera trafiają do
  NES Edge Cache. Dokumenty zdegradowane (błąd backendu, wyczerpany budżet bramki sekcji, brak strony głównej) nadal
  są odrzucane, także wtedy, gdy obok leżą wszystkie zapisy SSR z P3.8.

## 1. Które zapytania SSR istnieją po scaleniu (wyprowadzone z kodu, niezależnie od MERGE.md)

Zapisy w korzeniu (`src/routes/__root.tsx`) dotyczą każdej trasy z chrome'em:

| Klucz                                                  | Źródło                                                                             | Stan końcowy                                                                                                                                                                                                                                                   | Jak go traktuje predykat (tylko `/`)                                                              |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `site_settings`, `site_design_tokens`, `global_colors` | fala 1 (bez zmian)                                                                 | `success` > 0 albo zasiew `updatedAt: 0` po terminie                                                                                                                                                                                                           | zasiew = `seed:*` (odmowa); na `/` i tak `no-store` z pętli anulowania                            |
| `["site_font_scale"]`                                  | fala 1, **nowe w P3.8** (`ensureQueryData(fontScaleQueryOptions)`)                 | `success`, `dataUpdatedAt > 0`. `queryFn` nie rzuca: `fetchSiteDesignTokensRow` łapie błąd i daje `null`, a `normalizeFontScale` jest totalna. Wspólny lot z tokenami przez `edgeTtlCache("site_design_tokens:row")`, więc nie spóźnia się bardziej niż tokeny | kompletny. Po terminie `/`: anulowanie i `private, no-store` (zamierzona degradacja motywu)       |
| `["post-layout-settings"]`                             | zasiew `updatedAt: 0`                                                              | `success`, 0                                                                                                                                                                                                                                                   | celowy (`markDeliberateSeed`, tylko `import.meta.env.SSR`)                                        |
| `["builder-popups-active"]`                            | **nowe w P3.8**: `warmNoActivePopups` na liście `chromeWarm` (`warm` i `warmLate`) | `[]`, `updatedAt: 0` przy braku aktywnych popupów. Przy aktywnym popupie albo błędzie projekcji nie ma wpisu                                                                                                                                                   | dekoracja (`DECORATIVE_QUERY_ROOTS`)                                                              |
| menu, ticker, sekcje nagłówka i stopki                 | fala chrome (bez zmian)                                                            | `success`                                                                                                                                                                                                                                                      | kompletny; `ready()`/`expired()` liczy tylko `chromeQueryKeys`, sygnał popupów do nich nie należy |
| `ad_placements` (`header_banner`)                      | fala chrome                                                                        | dekoracja                                                                                                                                                                                                                                                      | dekoracja                                                                                         |

Zapisy na trasach:

- **`/` i `/en`**: to jedna trasa, bo rewrite zdejmuje `/en`. Loader `index.tsx` uzbraja predykat na końcu
  (`index.tsx:317`). P3.8 nie zmienia `index.tsx`.
- **Strona buildera i wpis** (`$.tsx`): bez predykatu, więc zapis zależy wyłącznie od dyrektywy `cache-control`.
  P3.8 nie zmienia `$.tsx`. W nowym kodzie P3.8 dyrektywę ustawia tylko pętla anulowania strony głównej, a ta działa
  wyłącznie na `/`.

Obserwatory, które P3.8 zmienia na serwerze, nie pobierają danych w SSR. Mają `enabled: false`, bo
`useInteractionOrQuiet()` daje na serwerze `false`. Dotyczy to `ContentAreaStyle`, `FooterSlideup`, katalogu
zainteresowań w trybie `latch`/`off` i `NewsletterPopup`/`PopupHost` (bramka `overlaysReady`). Żaden z nich nie
używa `useSuspenseQuery`. Predykat pomija je jako `pending` + `idle`, bez zdarzenia `fetch`.

Newsletter (`newsletter-settings`, `inline`): zmieniło się tylko miejsce ciała `queryFn` (leniwy import). Semantyka
błędu jest ta sama (`PGRST116` jest tolerowany, inny błąd rzuca), więc błąd backendu nadal daje
`error:newsletter-settings.inline`. Sprawdzone sondą.

## 2. Dowody

### 2.1 Sonda jednostkowa: predykat w obu kierunkach na złożonych zapisach P3.8

Plik `review-probes/interaction.probe.test.ts`, konfiguracja `vitest.probe.config.mjs`, log `probe-run.log`.
Wynik: **8/8**.

Sonda używa prawdziwych modułów:

- `trackSsrQueryCompleteness` i `markDeliberateSeed`;
- `warmNoActivePopups`;
- `fontScaleQueryOptions`, czyli prawdziwy `queryFn`;
- `newsletterInlineSettingsQueryOptions`.

Atrapą jest tylko `edgeTtlCache`, a dokładniej odpowiedzi projekcji obecności i wiersza tokenów. Predykat
uzbrajam przed zapisami korzenia, czyli ostrzej niż w produkcji.

Kierunek pozytywny:

- same zapisy P3.8 i treść dają `{complete: true}`. Sygnał `[]` ma `dataUpdatedAt: 0`, a `font_scale` ma
  `dataUpdatedAt > 0`;
- przy błędzie wiersza tokenów (`null`) `font_scale` dalej jest `success`, a dokument nadal kompletny, więc P3.8
  nie dodaje nowego odstępstwa;
- przy aktywnym popupie albo błędzie projekcji wpisu nie ma, a dokument jest kompletny.

Kierunek negatywny: obok zapisów P3.8 każda degradacja odmawia, a w przyczynach nigdy nie ma kluczy P3.8:

- błąd backendu treści daje `error:public.posts-list`;
- brak strony głównej (typ A, zasiew) daje dokładnie `["seed:public.home-page"]`;
- wyczerpany budżet bramki sekcji (pobranie po uzbrojeniu, anulowanie, usunięcie) daje dokładnie
  `["dropped:builder-section.s1"]`;
- błąd newslettera inline daje `error:newsletter-settings.inline`;
- wyjątek dekoracyjny nie maskuje sąsiednich kluczy: `builder-popups-admin` i zasiew `site_font_scale` dają
  `seed:*`.

### 2.2 Sonda artefaktu: `/`, `/en` i strona buildera, MISS, potem HIT

Skrypt `review-probes/artifact/probe-routes.sh` (przez `heavy-bg.sh`) uruchamia `.output` z worktree
integracyjnego (drzewo `f2085e6c`) z fixture CMS (`replayCmsFetch.mjs`). Serwer został zamknięty: 0 procesów
`.output/server/index.mjs`.

| Ścieżka                | Żądanie 1                                           | `doc`                            | Żądanie 2 |
| ---------------------- | --------------------------------------------------- | -------------------------------- | --------- |
| `/`                    | MISS, `public, max-age=60, s-maxage=900, swr=86400` | `degraded:false, store:"stored"` | HIT (L1)  |
| `/en`                  | MISS, ta sama polityka                              | `degraded:false, store:"stored"` | HIT (L1)  |
| `/cms-builder-text`    | MISS, ta sama polityka                              | `degraded:false, store:"stored"` | HIT (L1)  |
| `/en/cms-builder-text` | MISS, ta sama polityka                              | `degraded:false, store:"stored"` | HIT (L1)  |

Każdy zapisany dokument niesie w stanie odwodnionym wszystkie trzy klucze: `builder-popups-active`,
`site_font_scale` i `post-layout-settings`. Wynik obejmuje więc i zapis, i obecność sygnałów P3.8.

Ograniczenie: fixture nie ma wpisu (posta) ani przypadku błędu backendu. Wpis idzie tą samą trasą `$.tsx` co
strona buildera, bez predykatu. Kierunek negatywny dowodzą sonda jednostkowa (2.1) i testy potoku P3.6b
(`documentCompletenessPipeline`: typ A, sekcja po budżecie).

### 2.3 Testy repo

`light.sh bunx vitest run` na 15 plikach: **15/15, 442/442** (`review-probes/vitest-interaction.log`). Pliki:

- `rootRoute`, `rootShellRender`, `homeRoute`;
- `router`, `useSectionPreload`, `PopupHost`, `popupsHooks`, `contentAreaStyle`;
- `documentCompleteness`, `documentCompletenessPipeline`, `documentCache.server`,
  `degradedRenderCachePipeline`;
- `homeSsrBudget`, `platformChromeWarmup`, `resilientLoad`.

Logi scalającego sprawdziłem na dysku:

- typecheck `f2085e6c`: exit 0;
- vitest: 162 pliki, 4690 passed;
- `rootRoute`: 83/83;
- sonda B2: `store:"stored"`, potem HIT.

## 3. Odroczenia P3.8 a bramka chrome `expired()` i celowe zasiewy P3.6b

- **`expired()` / `warmLate`**:
  - sygnał popupów leży na wspólnej liście `chromeWarm`, ale nie w `chromeQueryKeys`, więc nie wpływa na
    `ready()`;
  - gdy chrome jest gotowy, `readChromeWarmup` i `lateWarm` wracają od razu, więc projekcja popupów nie trzyma
    granicy nagłówka strony głównej;
  - gdy chrome nie jest gotowy, czeka ona razem z resztą, najwyżej `HOME_CHROME_LATE_BUDGET_MS`;
  - błąd projekcji pochłania `allSettled` i nie daje `failed`;
  - zapis `setQueryData` nie jest zdarzeniem `fetch`, więc nie trafia na listę `fetched` predykatu.
- **`refetchOnMount` w oknie bootu** (`router.tsx`):
  - zasiewy (`dataUpdatedAt === 0`) i wpisy unieważnione odświeżają się od razu. Doktryna leczenia degradacji SSR
    i celowy zasiew `post-layout-settings` zostają nietknięte;
  - zasiew `post-layout-settings` odświeża `ContentAreaStyle` przy zatrzasku;
  - sygnał popupów odświeża host zespołu od razu, bo `dataUpdatedAt === 0`.
- **`useSectionPreload`**: `isSectionFresh(…, true)` uznaje sekcję za „z dokumentu” tylko przy
  `dataUpdatedAt > 0` bez inwalidacji. Sekcje, którym P3.6b usunęło dane po budżecie bramki, nie mają wpisu, więc
  prefetch rusza od razu, jak przed P3.8. Samoleczenie B2 i A działa.
- **Strona serwera** jest bez zmian: `refetchOnMount: isServer || …` daje `true`, a zatrzask to no-op.

## 4. Zalogowani, administrator i redakcja

- **Dane prywatne** (brak wpisu) ładują się przy montażu zawsze. Zmiana sesji to inwalidacja, a ta pobiera aktywne
  zapytania od razu, niezależnie od `refetchOnMount`.
- **Zespół** (`isStaff` = admin, editor albo author) omija bramkę „brak popupów”. `isStaff` jest reaktywne, więc
  host montuje się po wczytaniu ról, a `[]` z `updatedAt: 0` pobiera się od razu. Popup aktywowany w panelu jest
  widoczny od razu.
- **Panel i dokumenty client-only**: zasiewy z `updatedAt: 0` odświeżają się przy montażu. Po pierwszej interakcji
  zatrzask jest otwarty do końca życia dokumentu, więc zapisy panelu i inwalidacje działają jak dotąd.
- **Dane publiczne starsze niż `staleTime`** odświeżają się dopiero przy pierwszej interakcji albo w punkcie ciszy.
  Punkt ciszy wypada co najmniej 5 s po `load`, najpóźniej po 20 s, a w ukrytej karcie dopiero po jej pokazaniu.
  Wcześniej działo się to w hydratacji. Zmiana jest świadoma (P3.8 #5). Redakcja dostaje świeże dane przy pierwszym
  kliknięciu.

## 5. Uwagi nieblokujące

1. **minor**: na trasach innych niż `/` loader korzenia czeka na `initialChromeWarmup`, a `warm()` czeka na całą
   listę `chromeWarm`, także na projekcję popupów, nawet gdy menu są gotowe. Na zimnym izolacie (TTL 60 s,
   serve-stale 5 min) może to dołożyć do TTFB wpisu lub strony buildera, najwyżej `CHROME_WARM_BUDGET_MS`.
   Projekcja biegnie równolegle z menu i tickerem, więc w praktyce to ogon jednego `select id limit 1`. Do
   obserwacji w Workers Logs. Ewentualna poprawka: wypchnąć sygnał z `warm()` na trasach z
   `homeDeadline === undefined` albo nie czekać na niego w `warm`.
2. **nit**: P3.6b zapisuje teraz więcej dokumentów, a P3.8 odracza odświeżanie danych z dokumentu do zatrzasku.
   Anonimowy czytelnik dokumentu STALE (do 24 h, z rewalidacją w tle) widzi stare listy przez 5-20 s albo do
   pierwszej interakcji. Wcześniej dane odświeżały się w hydratacji. Kompromis jest świadomy. Warto go zapisać
   w STAN-FALI-3 obok zamrożonego sygnału popupów (MERGE §6.2).
3. **nit**: wyjątek dekoracyjny działa po korzeniu klucza (`queryKey[0]`). Dziś pod `builder-popups-active` jest
   jeden klucz bez parametrów. Gdyby ktoś dodał pod ten korzeń zapytanie z treścią, predykat też by je pominął.
   Komentarz przy `DECORATIVE_QUERY_ROOTS` mógłby to zastrzec.
4. Seria bootu (`bootBurstGzipBytes` +156 B ponad próg) jest poza tą soczewką. Zamknięcie zależy od P3.7a (MERGE §5
   i §8).

## 6. Pliki

`scratchpad/phase3/integ-p38/review-probes/`:

- `interaction.probe.test.ts`, `vitest.probe.config.mjs`, `probe-run.log`;
- `vitest-interaction.log`;
- `artifact/probe-routes.sh`, `artifact/run.log`, `artifact/server-artifact-boot.log`, `artifact/h-*`,
  `artifact/b-*`.
