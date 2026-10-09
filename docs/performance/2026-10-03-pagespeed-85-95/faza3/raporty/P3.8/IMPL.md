# P3.8 (fala 3) — implementacja: zero żądań Supabase z bootu anonimowej strony

Data: 2026-10-08. Worktree `$SCRATCH/wt3/P3.8`, gałąź `perf/w3-P3.8`, commit `97ae43c1` na bazie
`claude/zen-ritchie-hzur21` @ `d22cf7d6`. Zakres: `faza3/PLAN-FALI-3.md` §2 P3.8 + `faza3/diagnoza/zapytania-po-boocie.md`
(#1–#7). Wspólny prymityw: `src/lib/performance/interactionOrQuiet.ts` (P3.5) — wyłącznie import, bez zmian.

Uwaga o prośbie użytkownika przekazanej przez harness („jeden font — ma to być Red Hat Display”): nie dotyczy tej
pozycji; w planie fali to P3.2b (commit `d22cf7d6`, partia 3). P3.8 nie dotyka fontów ani `@font-face`.

## 0. Najkrócej

| #   | Żądanie z bootu `/`                                                                            | Co zrobione                                                                                                       | Stan                                                           |
| --- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | `site_design_tokens` (tabela rozmiarów czcionek)                                               | `fontScaleQueryOptions` w fali 1 korzenia + anulowanie (strona główna) + zasiew `EMPTY_FONT_SCALE`/`updatedAt: 0` | zrobione                                                       |
| 2   | `ad_placements` `footer_slideup`                                                               | zapytanie uzbrajane zatrzaskiem; opóźnienie paska z bootu od startu nawigacji                                     | zrobione                                                       |
| 3   | `post_layout_settings`                                                                         | `refetchOnMount: false` w `ContentAreaStyle` + `prefetchQuery` przy zatrzasku                                     | zrobione                                                       |
| 4a  | `builder_popups`                                                                               | projekcja obecności w fali chrome SSR → `[]` (`updatedAt: 0`) → bramka `useNoActivePopupsFromSsr` ożywa           | zrobione                                                       |
| 4b  | `newsletter_settings` + chunki `NewsletterPopup`/`PopupHost`                                   | montaż przy zatrzasku; pierwsze uzbrojenie wyzwalacza od startu nawigacji                                         | zrobione                                                       |
| 5   | odświeżenia „z wieku dokumentu” (`header_banner`, autorzy slidera, `posts`, newsletter inline) | polityka `refetchOnMount` w oknie bootu w `router.tsx` + jedno odświeżenie przy zatrzasku                         | zrobione (warunkowe — uznane za bezpieczne)                    |
| 6   | `categories` + `tags`                                                                          | katalog w trybie `latch` (droplista bez wymagań), `mount` gdzie potrzebny od razu, `off` bez listy                | zrobione w wariancie „zatrzask”, nie „intencja” (odstępstwo 1) |
| 7   | URL reklam z ms, duplikat `newsletter_settings`                                                | okno emisji kwantowane do minuty; dedup w locie `fetchNewsletterSettings`                                         | zrobione (bez zasiewu inline z pełnego — odstępstwo 4)         |

Oczekiwany efekt (do dowodu w Prove): linia `backend:` harnessu na `/` — 0 zapytań w oknie bootu we wszystkich
przebiegach B (A: 7 + 7 preflight, 8–9 przy dokumencie > 50 s, 17 przy 133 s). Warunek: punkt ciszy (≥ 5 s po `load`)
nie zapada przed końcem przebiegu Lighthouse'a — w P3.5 ślad kończył się ~3,5–4,1 s po nawigacji. Dodatkowo −2 chunki
nakładek po `load` (`NewsletterPopup`, `PopupHost`) z okna LH.

## 1. Zmiany plik po pliku

### `src/routes/__root.tsx` (tylko wskazane funkcje: rozgrzewka, sygnał popupów, bramki nakładek)

- **#1 rozgrzewka `fontScale`**: `ensureQueryData(fontScaleQueryOptions)` w `Promise.allSettled` fali 1, klucz w pętli
  anulowania strony głównej (`hasSsrQueryData` → `resilientCacheControl(true)` + `cancelQueries`), zasiew
  `EMPTY_FONT_SCALE` z `updatedAt: 0` obok zasiewów tokenów/kolorów. Zero podżądań serwera: `fetchSiteDesignTokensRow`
  jest single-flight w `edgeTtlCache("site_design_tokens:row")`. Importy `useFontScale.ts` i `lib/theme/fontScale` były
  już w zamknięciu bootu (`DesignTokensStyle`).
- **#4a sygnał „brak aktywnych popupów”**: w fali chrome (poza `chromeQueryKeys`, jak reklama — dekoracja nie degraduje
  cache dokumentu) `if (isServer) chromeWarm.push(() => warmNoActivePopupsOnServer(qc))`. `warmNoActivePopupsOnServer` to
  `createIsomorphicFn()` z dynamicznym importem `lib/builder/popups` w gałęzi `.server()` — kompilator Start wycina ją
  z bundla przeglądarki (ta sama doktryna co `getServerConsentInitScript`), więc moduł popupów nie wchodzi do boot.
- **`useNoActivePopupsFromSsr`**: komentarz przepisany (bramka ożywa), plus **omijanie bramki dla zespołu**
  (`useAuth().isStaff`) — odstępstwo/dodatek 3.
- **#4b `useOverlayGates`**: `afterPageLoad(…, 3000)` → `useInteractionOrQuiet()`. Kontrakt w komentarzu („czas montażu
  celowo BEZ ZMIAN”) przepisany świadomie (sekcja „MOMENT MONTAŻU (P3.8)”). `useToasterWanted` (sonner) bez zmian —
  nadal `afterPageLoad`, bo to chunk, nie zapytanie Supabase.
- Komentarze zasiewu `post-layout-settings` poprawione („dociągnie przy zatrzasku, nie w hydratacji”).

### `src/router.tsx` (tylko #5)

`bootRefetchOnMount(queryClient)` jako domyślne `refetchOnMount` klienta (serwer: `true` bez zmian):

- zatrzask otwarty → `true` (zachowanie domyślne);
- `dataUpdatedAt === 0` (zasiewy, doktryna `ssr-degradation`) → `true` (leczenie natychmiast);
- `isInvalidated` (zapisy panelu, zmiana sesji, live-sync) → `true`;
- inaczej `false` + jednorazowe `onInteractionOrQuiet(() => refetchQueries({ type: "active", stale: true },
{ cancelRefetch: false }))` — nadrabia wszystko, co wstrzymano, bez podwójnych żądań z pobraniami w locie.
  Zapytania bez danych (prywatne dane zalogowanego) ładują się przy montażu zawsze (`shouldLoadOnMount` nie czyta
  `refetchOnMount`). Literał `setTimeout(0)` przed hydratacją nietknięty. Zatrzask uzbraja się dopiero przy pierwszym
  wstrzymaniu (nie przy `getRouter`), więc test makrozadań hydratacji się nie zmienia.

### `src/components/ContentAreaStyle.tsx` (#3)

`useQuery({ ...postLayoutSettingsQueryOptions(), refetchOnMount: false })` + efekt
`onInteractionOrQuiet(() => queryClient.prefetchQuery(postLayoutSettingsQueryOptions()))`. Komponent montuje się raz
(korzeń), więc `false` dotyczy wyłącznie hydratacji; `prefetchQuery` pobiera tylko wpis nieświeży (zasiew tak, wiersz
z `$.tsx` nie); brak wpisu pobiera od razu; inwalidacja panelu odświeża niezależnie. Zamiast wariantu z diagnozy
`(q) => q.state.dataUpdatedAt === 0 ? false : true` — `false`, spójnie z #5 (wiersz nieświeży też czeka na zatrzask).

### `src/components/ads/FooterSlideup.tsx` + `src/lib/ads/queries.ts` (#2, #7)

- `useAdPlacements(..., enabled = true)` — nowy, opcjonalny 5. parametr; `FooterSlideup` podaje
  `useInteractionOrQuiet()`. Pozostali wołający bez zmian.
- `bootMount = useState(() => !isInteractionOrQuietOpen())`: pasek zamontowany w bocie liczy `delay_ms` od startu
  nawigacji (`delay - performance.now()`, podłoga 0 jak dotąd) → pokazuje się po max(zatrzask, `delay_ms`); pasek
  zamontowany po zatrzasku (nawigacja SPA) — `delay_ms` od danych, jak dotąd.
- #7: `fetchPlacementRows` wysyła okno jako NADZBIÓR bieżącej minuty (`starts_at ≤ koniec minuty`,
  `ends_at ≥ początek minuty`); dokładne okno nadal liczy `isWithinEmissionWindow` przy projekcji. URL stały przez minutę
  → preflight (`Access-Control-Max-Age` per URL) i odpowiedź do ponownego użycia w SPA i powrotach. Komentarz
  rozgrzewki (`updatedAt: fetchedAt`) zaktualizowany o #5.

### `src/lib/builder/popups.ts` (#4a)

`warmNoActivePopups(queryClient)`: jeśli wpisu brak, `edgeTtlCache("builder_popups:presence", 60 s)` z
`select("id").eq("status","active").limit(1)`; przy pustym wyniku `setQueryData(["builder-popups-active"], [],
{ updatedAt: 0 })`, przy niepustym nic (host musi dostać pełne wiersze), błąd rzuca (bez fałszywego „brak popupów”).

### `src/components/NewsletterPopup.tsx`, `src/components/popups/PopupHost.tsx` (#4b)

Kotwica opóźnienia: flaga modułu `delayAnchoredToNavigation`; PIERWSZE uzbrojenie wyzwalacza w dokumencie liczy
`max(podłoga, opóźnienie - performance.now())`, kolejne (nawigacja SPA, zmiana ustawień, inny kandydat) — pełne
opóźnienie od siebie, jak dotąd. Podłogi: `NewsletterPopup` 1 s (istniejący kontrakt „popup nie miga przy pierwszym
pikselu”, test „zerowe opóźnienie”), `PopupHost` 400 ms (= `immediate`). Rozgrzewka treści popupu newslettera
(`warmTimer`) liczona od tego samego, zakotwiczonego opóźnienia.

### `src/hooks/useInterests.ts`, `src/components/interests/TopicsDroplist.tsx`, `JoinUsForm.tsx`, `NewsletterForm.tsx` (#6)

- `useInterestCatalog(lang, enabled = true)`; `useInterestGroups(lang, slugs, load: "mount" | "latch" | "off" = "mount")`
  — `latch` przez `useInteractionOrQuiet`, `off` nigdy; wpis już w cache'u czyta się zawsze.
- `JoinUsForm`: `off` gdy `!showInterests`; `mount` dla chipsów, `requireInterests` (walidacja wysyłki bez zmian),
  zapisanych tematów (`useMyInterests` — pigułki) i kanwy buildera; inaczej `latch`. Hooki `useMyInterests`
  i `useBuilderMode` przeniesione przed `useInterestGroups` (kolejność stała między renderami).
- `NewsletterForm`: `off` przy `showInterests: false`, `mount` w builderze, inaczej `latch`.
- `NewsletterSubscribedPanel`, `InterestsCustomizer`, `TargetingEditor` — domyślne `mount`, bez zmian.

### `src/hooks/useNewsletterSettings.ts` (#7)

`fetchNewsletterSettings` z dedupem w locie w przeglądarce (`inflightSettings ??= load().finally(...)`), serwer bez
dedupu (moduł współdzielony przez najemców). Pełny klucz i projekcja inline czytają ten sam lot.

### Testy (behawioralne)

- `src/__tests__/router.test.tsx` — nowa sekcja #5: nieświeży wpis z SSR nie pobiera się przy montażu, zatrzask
  odświeża raz; zasiew `updatedAt: 0` od razu; unieważniony od razu; bez danych od razu; po zatrzasku domyślnie;
  świeży wcale; łączenie z pobraniem w locie (mutacja `cancelRefetch: true` czerwieni test — sprawdzone); serwer `true`.
- `src/routes/__tests__/rootRoute.test.tsx` — atrapy `fontScaleQueryOptions`, `warmNoActivePopups`, `useAuth`
  (`isStaff`); zasiew tabeli rozmiarów (`updatedAt: 0`), rozgrzewka w fali 1, anulowanie na `/`, brak nadpisania;
  sygnał popupów: SSR z chrome'em grzeje, klient nie, bez chrome'u nie; bramka: zespół omija pustą listę.
- `src/routes/__tests__/rootShellRender.test.tsx` — „nakładki marketingowe NIE montują się przed zatrzaskiem”
  (Toaster tak, `NewsletterPopup`/`PopupHost` nie, po zatrzasku tak); zapora `overlayBoundarySettled` otwiera zatrzask
  jawnie (wcześniej czekała na prawdziwy punkt ciszy happy-dom ~4,8 s — wyścig z limitem `findBy*`), reset detektora
  ciszy na test.
- `src/components/__tests__/contentAreaStyle.test.tsx` (nowy) — zasiew bez sieci przy montażu, zatrzask dociąga raz,
  świeży wiersz wcale, brak wpisu od razu, inwalidacja od razu.
- `src/components/ads/__tests__/footerSlideup.test.tsx` — zatrzask otwarty w `beforeEach` (dotychczasowe kontrakty =
  pasek po SPA); nowa sekcja: przed zatrzaskiem 0 zapytań, zatrzask uzbraja, opóźnienie od startu nawigacji.
- `src/components/__tests__/newsletterPopup.test.tsx`, `src/components/popups/__tests__/PopupHost.test.tsx` — kotwica:
  montaż 10 s po starcie skraca 15 s do 5 s; podłoga; kolejne uzbrojenie pełne (PopupHost: inny kandydat po nawigacji
  — ten sam kandydat nie przeuzbraja się przy zmianie ścieżki, zachowanie sprzed P3.8).
- `src/lib/builder/__tests__/popupsHooks.test.tsx` — `warmNoActivePopups`: projekcja `select=id limit 1`, `[]`
  z `updatedAt: 0`, nic przy aktywnym, błąd rzuca, istniejący wpis bez podżądania.
- `joinUsForm.test.tsx`, `topicsDroplist.test.tsx`, `NewsletterForm.test.tsx`, `useInterests.test.tsx` — tryby
  `latch`/`off`/`mount` katalogu (licznik `supabase.from`).
- `src/hooks/__tests__/useNewsletterSettings.test.tsx` (nowy) — równoległy pełny + inline = 1 GET; dedup tylko w locie.
- `src/lib/ads/__tests__/queries.test.ts` — dwa testy znacznika przepisane na kontrakt minutowy (nadzbiór minuty,
  identyczne filtry w tej samej minucie).
- e2e: `e2e/backend-quiet.boot-home.spec.ts` (nowy, artefakt, tylko wariant fixture): od nawigacji do `load` + 3 s
  ZERO żądań `/rest/v1/`; kółko myszy → `post_layout_settings` i `newsletter_settings` idą (kontrola pozytywna).
  `e2e-performance/on-demand-overlays.spec.ts`: chunki `NewsletterPopup-`/`PopupHost-` nie startują przed pierwszą
  interakcją, `NewsletterPopup-` przychodzi po niej.

## 2. Bramki (ten etap)

| Bramka                                                                                  | Wynik                                                                                                                                        | Log                                          |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `bunx prettier --write` (dotknięte pliki)                                               | OK                                                                                                                                           | —                                            |
| `bunx eslint` (dotknięte pliki)                                                         | 0 błędów, 6 ostrzeżeń `react-refresh/only-export-components` — wszystkie istniały na bazie (nowego eksportu `useOverlayGates` celowo nie ma) | `eslint-2.log`                               |
| typecheck (`typecheck-noinc.sh`: tsgo + scripts + e2e) przez mutex                      | zielony ×2 (runda implementacji i po poprawkach)                                                                                             | `typecheck-1.log`, `typecheck-2.log`         |
| vitest: 94 pliki (testy modułów dotkniętych + nowe + `interactionOrQuiet`/`motionGate`) | 3010 passed, 23 expected fail, 0 failed                                                                                                      | `affected-run3.log`                          |
| `bun run verify:static`                                                                 | 15/15 OK (2×; format:check zielony)                                                                                                          | `verify-static-1.log`, `verify-static-2.log` |

Nie uruchamiane w tym etapie (zostawione dla Prove, zgodnie z instrukcją — wymagają buildu lub są pomiarem):
`build:smoke`, `check:bundle`, `check:chunks`, `check:entry-purity`, `check:server-entry-purity`,
`check:document-weight`, `test:e2e:artifact` (z nowym `backend-quiet.boot-home`), e2e performance
(`on-demand-overlays`, `popup-first-render`), e2e dev (`ssr-degradation`), Lighthouse `--compare`.

Jak uruchomić e2e w Prove (przez mutex):

- artefakt: `env NES_ARTIFACT_FIXTURE=1 SUPABASE_URL=https://placeholder.supabase.co VITE_SUPABASE_URL=https://placeholder.supabase.co SUPABASE_PUBLISHABLE_KEY=placeholder-anon-key VITE_SUPABASE_PUBLISHABLE_KEY=placeholder-anon-key bun run test:e2e:artifact`;
- nakładki: `env NES_PERFORMANCE_ARTIFACT_ROOT=<worktree> NES_PERFORMANCE_CASE=on-demand-overlays bunx playwright test --config playwright.performance.config.ts e2e-performance/on-demand-overlays.spec.ts` (analogicznie `popup-first-render` z `NES_PERFORMANCE_CASE=popup-first-render`);
- degradacja: `bunx playwright test --config playwright.config.ts e2e/ssr-degradation.spec.ts` (dev-server, poświadczenia zastępcze).

## 3. Odstępstwa od planu (i dlaczego)

1. **#6 — wariant „zatrzask” zamiast „intencji”.** Diagnoza proponowała pobieranie katalogu przy `pointerenter`/`focusin`
   na przycisku listy i renderowanie przycisku w SSR zawsze. To zmienia HTML wyspy (nowy blok w SSR), wprowadza stan
   pustej listy przy otwarciu przed danymi (dotyk: `pointerenter` tuż przed kliknięciem) i przepływ walidacji
   `requireInterests`. Wariant „zatrzask” zdejmuje oba GET-y z okna bootu (także przy otwarciu wyspy przez widoczność,
   np. pełnoekranowy zrzut Lighthouse'a) przy zerowej zmianie UX: czytelnik, który przewinie do formularza, otwiera
   wyspę i zatrzask tym samym gestem. Nie zdejmuje żądań u czytelnika, który przewinie, ale listy nie otworzy, ani
   późnego pojawienia się listy w wyspie (jak dziś). Wariant „intencja” zostaje jako możliwa kontynuacja.
2. **#4b — podłoga `NewsletterPopup` 1 s, nie 400 ms.** Istniejący kontrakt (test „zerowe opóźnienie z panelu nie
   zamienia popupu w błysk przy pierwszym pikselu”); `PopupHost` 400 ms jak w diagnozie.
3. **#4a — dodatki do diagnozy:** (a) zespół redakcji (`isStaff`) omija bramkę, żeby popup aktywowany w panelu dało się
   obejrzeć od razu (inaczej zamrożony sygnał z dokumentu ukrywałby go minutami — regresja dla edytora); (b) wpis `[]`
   rodzi się z `updatedAt: 0`, bo dla zespołu (host montowany mimo sygnału) świeże `[]` z dokumentu byłoby zaufane przez
   5 min (`staleTime`) i host i tak nie pobrałby listy; (c) `createIsomorphicFn` zamiast gołego `isServer` dla pewności
   wycięcia importu z bundla przeglądarki.
4. **#7 — bez zasiewu `["newsletter-settings","inline"]` z pełnego odczytu.** Zaimplementowany i usunięty: chunk
   wejściowy (`useNewsletterSettings.ts` jest w nim przez `prefetch.ts`) ma 0,6 KB zapasu w `bootClosureGzipBytes`,
   a zysk dotyczy wyłącznie sytuacji po zatrzasku (dedup w locie łączy jednoczesne odczyty). Także bez „taniego
   odcięcia powracających” (zapis `popup_frequency_days` przy odmowie) — poza notą orkiestratora, ryzyko przy zmianie
   częstotliwości w panelu.
5. **#2 — kotwica tylko dla montażu w bocie** (`bootMount`), nie „pierwszy montaż w dokumencie”: dzięki temu pasek po
   nawigacji SPA zachowuje dawną semantykę, a testy jednostkowe nie zależą od `performance.now()` procesu.
6. **#3 — bez wariantu (b)** (rozgrzewka `post_layout_settings` w rejestrze prefetchu dla `RichTextView`/`TeamMember*`
   i tras z `ContentRenderer`): poza listą plików P3.8 (`lib/builder/prefetch.ts`). Skutek opisany w ryzykach.

## 4. Zmiany zachowania i ryzyka

- **Popup `immediate`** (PopupHost) pojawia się ~400 ms po otwarciu zatrzasku (pierwsza interakcja albo cisza ≥ 5 s po
  `load`), a nie ~400 ms po `load` + bezczynności. Popupy `delay` z opóźnieniem dłuższym niż czas do zatrzasku — jak
  dotąd (kotwica w starcie nawigacji); krótsze — przy zatrzasku + podłoga. Zdarzenie `impression` popupu newslettera
  liczy się przy zatrzasku (odwiedzający, który wyjdzie przed interakcją i ciszą, nie da wyświetlenia — popupu i tak by
  nie zobaczył).
- **Nowo aktywowany popup buildera** widzi anonim dopiero z dokumentem/projekcją młodszymi niż aktywacja (świeżość
  dokumentu na brzegu ≤ 180 s, potem STALE z rewalidacją, plus TTL projekcji 60 s / serve-stale do 5 min). Zespół —
  od razu. Popup aktywowany w trakcie wizyty nie zamontuje hosta do następnego wejścia (zamrożenie istniało wcześniej).
- **Pasek dolny** pokazuje się po max(zatrzask, `delay_ms`) zamiast hydratacja + fetch + `delay_ms`.
- **Typografia treści (#3)** na trasach z treścią BEZ własnej rozgrzewki (support, checkout.success, moduły wydarzeń,
  builderowe `RichText` z blokami): wartości najemcy z `post_layout_settings` dochodzą przy zatrzasku zamiast zaraz po
  hydratacji — jeśli różnią się od domyślnych, zmiana stylu jest późniejsza. Na `/` i wpisach (`$.tsx` grzeje klucz) —
  bez efektu.
- **#5**: treść z bardzo starego dokumentu (STALE) odświeża się przy pierwszej interakcji/ciszy, a nie w hydratacji;
  przy pierwszej interakcji może przyjść paczka odświeżeń (wcześniej w oknie LCP/SI). Zapytania z własnym
  `refetchOnMount` w opcjach — bez zmian. SPA przed zatrzaskiem: montaż nie odświeża, zatrzask (klik) nadrabia klatkę
  później.
- **Zamknięcie bootu**: dotknięte moduły w chunku wejściowym `index`: `router.tsx`, `__root.tsx`, `ContentAreaStyle.tsx`,
  `lib/ads/queries.ts`, `useNewsletterSettings.ts` (`FooterSlideup` jest w chunku `blog.index`, poza statycznym
  domknięciem `/`). Szacunek esbuild per plik (z liniami importu, górna granica): +1,2 KB raw / ≤ +0,49 KB gz; realnie
  ~+0,3–0,4 KB gz. Zapas `bootClosureGzipBytes` = 0,6 KB — **do zmierzenia w Prove** (`check:document-weight`).
- Dokument SSR: `/` niesie dwa nowe małe wpisy (`site_font_scale` — na produkcji `{}`; `builder-popups-active` `[]`,
  gdy rozgrzewka zmieści się przed snapshotem/strumieniem) — kilkadziesiąt bajtów `dehydratedStateBytes`.
- Serwer: +1 podżądanie `builder_popups?select=id&status=eq.active&limit=1` na izolat na TTL 60 s (serve-stale do
  5 min) w fali chrome; na stronie głównej w budżecie chrome (nieczekane przez loader).

## 5. Na co patrzeć w recenzji

1. `router.tsx` `bootRefetchOnMount`: wywołanie w fazie renderu (`getOptimisticResult`) subskrybuje zatrzask —
   idempotentne (flaga), bez skutków poza jednym zapisem. Czy lista wyjątków (`updatedAt: 0`, `isInvalidated`) jest
   kompletna dla zalogowanych/admina.
2. `__root.tsx`: edycje lokalne w rozgrzewce fali 1 (+ zasiew `fontScale` obok zasiewów — region, który P3.6b też może
   ruszać: „lista celowych zasiewów”), w fali chrome (jedna linia `chromeWarm.push`) i w bramkach nakładek —
   do ręcznego scalenia z P3.6b (`expired()` w `registerChromeWarmup`).
3. Semantyka kotwicy opóźnień (flaga modułu, „pierwsze uzbrojenie”) w `NewsletterPopup`/`PopupHost` i `bootMount`
   w `FooterSlideup`.
4. Czy wariant „zatrzask” dla #6 jest akceptowalny jako zamknięcie pozycji (odstępstwo 1).
5. Prove: `backend:` = 0 we wszystkich przebiegach B; jeśli nie — sprawdzić, czy w przebiegu zapada punkt ciszy
   (wtedy żądania przesunięte na zatrzask pojawią się w liczniku, ale poza śladem).
