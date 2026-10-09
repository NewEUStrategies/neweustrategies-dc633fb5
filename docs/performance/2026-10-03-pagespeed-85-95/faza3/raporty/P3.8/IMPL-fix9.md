# P3.8 (fala 3) — runda poprawek po Prove 2: `vendor-sonner` w domknięciu bootu

Data: 2026-10-08. Worktree `$SCRATCH/wt3/P3.8`, gałąź `perf/w3-P3.8`, HEAD bez zmian: `d66fc7fd`.

Wejście:

- ustalenie blokujące z `prove2/PROVE.md`;
- `git status` na starcie czysty, więc przerwana próba tej rundy niczego w drzewie nie zostawiła.

Poprzedni raport o tej nazwie (runda 9, commit `d66fc7fd`) przeniosłem do `IMPL-fix9-d66fc7fd.md`.

## 0. Najkrócej

| Ustalenie                                                                                                                                                                                                                                                                                                                            | Co zrobione                                                                                                                                                                                                                                                                                                                                                                                                                              | Stan                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **Blokujące:** trzy czerwone bramki z jednej przyczyny: `check:entry-purity`, `check:document-weight` (4 metryki) i e2e `on-demand-overlays`. Przyczyna: `vendor-sonner` statycznie osiągalny z wejścia, bo `src/lib/theme/carouselDefaults.ts` (`import { toast } from "sonner"`) trafił przez łączenie małych chunków do `index-*` | Przyczyna leży w pliku **spoza listy P3.8**. Ustalenie samo wskazuje, że trzeba na to zgody orkiestratora, a w zadaniu tej rundy takiej zgody nie ma. Dlatego pliku nie edytowałem w gałęzi P3.8. Przygotowałem gotową łatkę: `fix10/carouselDefaults-notify.patch`. Sprawdziłem ją na kopii roboczej: prettier, eslint, vitest 7 plików / 157 testów i kontrola negatywna. `git apply --check` przechodzi na gałęzi P3.8 i na gałęzi PR | **czeka na zgodę** (`out_of_ownership_needs`) |
| Nieblokujące: kod P3.8 dokłada ok. +214 B gz / +295 B raw do domknięcia bootu                                                                                                                                                                                                                                                        | Bez zmian w tej rundzie (uzasadnienie w §3)                                                                                                                                                                                                                                                                                                                                                                                              | odrzucone na tę rundę                         |
| Nieblokujące: `dehydratedStateBytes` +690 B (bramka zielona)                                                                                                                                                                                                                                                                         | Bez zmian. To dwa wpisy, które są samym mechanizmem #1 i #4a (§3)                                                                                                                                                                                                                                                                                                                                                                        | odrzucone                                     |

W gałęzi P3.8 **nie ma nowego commita**, bo żaden plik z listy P3.8 nie wymagał zmiany. Obejście w zakresie (§2)
byłoby loterią na kolejności scaleń Rollupa: nie da się go sprawdzić bez buildu, którego ten etap zabrania, a scalenie
partii z P3.3 i P3.6b i tak by je rozsypało.

## 1. Poprawka spoza zakresu: `src/lib/theme/carouselDefaults.ts` → `@/lib/notify`

Łatka: `$SCRATCH/phase3/wave3/P3.8/fix10/carouselDefaults-notify.patch` (2 pliki, +12/−5).

- `src/lib/theme/carouselDefaults.ts`:
  - `import { toast } from "sonner"` → `import { notifyError, notifySuccess } from "@/lib/notify"`, z komentarzem
    po polsku: dlaczego moduł nie może importować sonnera;
  - `useSaveCarouselDefaults`: `toast.success(...)` → `notifySuccess(...)`, `toast.error(...)` → `notifyError(...)`;
  - komunikaty i kolejność wywołań bez zmian.
- `src/lib/theme/__tests__/themeRemainder.test.tsx` (`useSaveCarouselDefaults`):
  - asercje sprawdzają most (`notifySuccess` z tekstem komunikatu, `notifyError("brak uprawnień")`);
  - asercje sprawdzają, że sonner nie jest wołany wprost (`toast.success` i `toast.error` nie są wywołane);
  - atrapa `@/lib/notify` była już w pliku.

Zachowanie:

- `lib/notify` to leniwy most, który `check:entry-purity` wskazuje jako właściwą naprawę. Daje tę samą semantykę
  `toast.success` i `toast.error`.
- Wywołania sprzed załadowania sonnera ustawiają się w kolejce FIFO.
- Most ogłasza też „pierwsze użycie”, więc `__root.tsx` montuje leniwy `<Toaster/>` od razu, a nie dopiero po
  bezczynności. Dla zapisu domyślnych ustawień karuzeli w panelu to zmiana co najwyżej na lepsze.
- SSR: no-op, a toast i tak nie ma tam sensu.
- `notify.ts` nie ma importów statycznych, więc nowa krawędź nie tworzy cyklu ani nowego chunku.

Dlaczego to poprawka trwała:

- Moduł bez statycznego importu sonnera może bezpiecznie trafić do wejścia przy dowolnym przyszłym przetasowaniu.
- Dotyczy to też scalenia partii 2 i zmian partii 3–4.
- Alternatywa z PROVE: przypięcie `carouselDefaults` w `manualChunks` obu presetów (`vite.config.ts`
  i `vite.smoke.config.ts`). Wymaga parytetu `viteChunkParity` i `check:chunks`. Jest bardziej krucha, bo
  nazwany chunk wciąga statyczne zależności spoza innych nazwanych chunków; zob. notatkę o `club-thread-kind-icon`
  w `vite.config.ts`.

Sprawdzenie łatki na kopii roboczej:

- kopia: `git archive HEAD` gałęzi P3.8 w `$SCRATCH/p38fix10/verify`, po sprawdzeniu usunięta;
- worktree P3.8 i main checkout nietknięte;
- logi w `fix10/`.

| Krok                                                                                                      | Wynik                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prettier --write` (2 pliki)                                                                              | bez zmian (już sformatowane)                                                                                                                                                                                   |
| `light.sh eslint` (2 pliki)                                                                               | 0 błędów, 0 ostrzeżeń                                                                                                                                                                                          |
| `light.sh vitest run`: `themeRemainder`, `carouselDefaults`, `useThemeDesignDrafts`, `src/lib/notify/**`  | 4 pliki, 72/72 zielone                                                                                                                                                                                         |
| `light.sh vitest run`: pozostali importerzy (`sections`, `ThemeDesignPane`, `sliderResponsiveNavigation`) | 3 pliki, 85/85 zielone                                                                                                                                                                                         |
| Kontrola negatywna: `carouselDefaults.ts` z bazy + nowe asercje                                           | 2 testy `useSaveCarouselDefaults` czerwone, czyli dyskryminują                                                                                                                                                 |
| `git apply --check` na `wt3/P3.8` i na gałęzi PR (main checkout, tylko sprawdzenie)                       | OK / OK                                                                                                                                                                                                        |
| typecheck                                                                                                 | nie uruchamiany. Łatka używa wyłącznie `notifySuccess(message: string)` i `notifyError(message: string)`, a `e.message \|\| "Błąd zapisu"` to `string`. Pełny typecheck należy do rundy, która zastosuje łatkę |

**Po zastosowaniu** przebudować (`env BUNDLE_INVENTORY=1 bun run build:smoke`) i powtórzyć:

- `check:entry-purity`;
- `check:document-weight`: szacunek PROVE dla `bootClosureGzipBytes` to ok. 484,6 / 485,0 KB;
- `check:bundle`;
- `check:chunks`;
- e2e `on-demand-overlays`.

Rozkład scaleń znowu się zmieni, bo `carouselDefaults` ma teraz inny rozmiar i krawędź do `notify.ts` w wejściu.
Dlatego liczby trzeba zmierzyć, a nie przenosić z szacunku.

## 2. Dlaczego nie obejście w plikach P3.8

Rollup 4.60.2 (`node_modules/rollup/dist/es/shared/node-entry.js`):

- `getOptimizedChunks` przy `experimentalMinChunkSize: 2048` zbiera wszystkie chunki < 2048 B jako „małe”, sortuje
  je rosnąco i scala po kolei.
- `findBestMergeTarget` startuje w trybie domyślnym z limitem `Infinity`. Każdy mały chunk bez skutków ubocznych
  trafia więc do celu o najmniejszym koszcie „dodatkowo ładowanego kodu”.
- Dla wejścia ten koszt to po prostu rozmiar małego chunku. `carouselDefaults` ma 1958 B, a jego zależności leżą
  w wejściu albo w chunkach nazwanych.
- W A tańszy był współdzielony `eventBrandingDraft`. W B `eventBrandingDraft` najpierw wchłonął `Logo.tsx`, który
  jest mniejszy, więc przetwarzany wcześniej. Przez to wejście stało się najtańszym celem.

Kaskada A → B z `reports/chunk-inventory.json`. Zdekomponowałem ją, żeby sprawdzić, czy da się ją odwrócić
w zakresie:

- `FooterSlideup.tsx` urósł w P3.8 do 3710 B, czyli powyżej progu. Jest teraz osobnym chunkiem „dużym”, a w A był
  wklejony do `blog.index`. `conversions.ts` przeszedł do niego z `headings`.
- `newsletterSettingsData.ts` (1785 B, nowy) → `newsletter.confirm`. Wypchnął stamtąd `anchorScan` →
  `admin.settings`, a stamtąd wypadł `liveBlogs` → nowy chunk z `billing/catalog`. Chunk `Logo` się rozpadł:
  `Logo.tsx` → `eventBrandingDraft`, przez co `carouselDefaults` → `index`.
- `sinceNavigationStart.ts` (170 B, nowy) + `overlayCoordinator` → `tag._slug`. Wypchnięty `cacheBusting` wziął
  `registrationFields` z `index`.

Każda zmiana rozmiaru albo zestawu małych chunków przestawia tę kaskadę. Rozważone ruchy w zakresie to:

- wklejenie `sinceNavigationStart` do trzech konsumentów;
- złożenie `newsletterSettingsData` z powrotem, co oddałoby ok. 260 B gz do wejścia;
- przycięcie `FooterSlideup` poniżej 2048 B.

Żadnego z nich nie da się sprawdzić bez buildu, a ten etap zabrania buildu. Żaden nie przetrwa też scalenia z P3.3
i P3.6b. Usunięcie statycznej krawędzi do sonnera z małego modułu jest jedyną poprawką odporną na kolejność scaleń.

Ten sam przegląd inwentarza B: wśród modułów aplikacji < 2048 B ze statycznym `import { toast } from "sonner"` jedynym
w chunku wejściowym jest `carouselDefaults`. Pozycje tras `admin.*` w `index` to wyłącznie konfiguracje tras po
podziale TanStacka, bez kodu komponentów. Ta sama klasa ryzyka (mały moduł z sonnerem, importowany z publicznych
chunków leniwych) dotyczy też innych modułów, ale dziś żaden z nich nie siedzi w wejściu:

- `FollowButton`;
- `SyncBillingButton` i `CustomerPortalButton` (`LifetimeAccessCard`);
- `lib/admin/useSettings` (`serp`);
- `EventBookmarkButton`.

Bramka `check:entry-purity` je wyłapie.

## 3. Nieblokujące: odrzucone na tę rundę

1. **+214 B gz / +295 B raw kodu P3.8 w domknięciu bootu.** Rozkład przed minifikacją, moduły chunku wejściowego A → B:
   - `router.tsx` +543 (#5);
   - `interactionOrQuiet.ts` +416 (hak `useInteractionOrQuiet`, wspólny prymityw P3.5, potrzebny bramkom nakładek
     i `ContentAreaStyle`);
   - `useSectionPreload.ts` +250 (B1);
   - `ads/queries.ts` +143 (#7);
   - `ContentAreaStyle.tsx` +91 (#3);
   - `useNewsletterSettings.ts` −1079 (B3).

   Netto bez zamiany `carouselDefaults` ↔ `registrationFields` wychodzi +375 B przed minifikacją. Po łatce z §1
   szacunek PROVE daje zieloną bramkę (ok. 0,4 KB zapasu gz). Każde dalsze cięcie znowu przestawia scalenia małych
   chunków, a skutku nie da się zmierzyć w tym etapie. Lepiej zmierzyć stan po łatce i ciąć dopiero wtedy, gdy
   scalenie partii 2 faktycznie przekroczy próg.

2. **`dehydratedStateBytes` +690 B raw (ok. +60 B gz, próg 64,9 KB zielony).** Na `/` zostają dwa wpisy, które są
   istotą pozycji:
   - prawdziwy wiersz `site_font_scale` z rozgrzewki #1. Bez niego klient wysyła GET + preflight przy hydratacji,
     czyli to, co #1 usuwa;
   - znacznik `builder-popups-active: []` (#4a). To jedyny nośnik sygnału „brak aktywnych popupów” bez zmiany HTML-a
     korzenia.

   Spadek obiecany w IMPL rundy 9 dotyczył wyłącznie zasiewu po anulowaniu, który zniknął. Nie dotyczył tych wpisów.

## 4. Bramki tej rundy

| Bramka                                           | Wynik                                                                                                                                                                 |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| prettier / eslint / vitest łatki (kopia robocza) | zielone (§1)                                                                                                                                                          |
| typecheck, `verify:static`, vitest plików P3.8   | nie powtarzane: drzewo P3.8 bez zmian od `d66fc7fd`, gdzie były zielone (typecheck exit 0, vitest 136 plików / 4089, `verify:static` 15/15 — `IMPL-fix9-d66fc7fd.md`) |
| build, `check:*` artefaktu, e2e, Lighthouse      | nie uruchamiane (etap bez buildu). Po zastosowaniu łatki: lista w §1                                                                                                  |

## 5. Ryzyka i na co patrzeć

- **Orkiestrator:** zgoda na `src/lib/theme/carouselDefaults.ts` i `src/lib/theme/__tests__/themeRemainder.test.tsx`.
  Potem albo `git apply` łatki w gałęzi P3.8 (nowa runda) albo przy scalaniu. Żadna pozycja partii 2–4 nie ma tych
  plików na liście.
- Po łatce rozkład scaleń znowu się zmieni. Na tę samą zmianę rozkładu trzeba patrzeć w `check:document-weight`:
  - `bootClosureGzipBytes` (szacunek 484,6 / 485,0 KB);
  - `bootBurstCount` 26 / 26;
  - `bootBurstGzipBytes`.
- W `chunk-inventory.json` sprawdzić, czy jakiś inny mały moduł z `sonner` nie trafił do `index-*`.
  `check:entry-purity` to pokaże.
- Zachowanie P3.8 bez zmian wobec `d66fc7fd`. Zmiany zachowania opisane w PROVE §5 nadal obowiązują:
  - popup `immediate` po zatrzasku;
  - pasek dolny od `activationStart`;
  - `ContentAreaStyle` i sekcje z SSR czekają na zatrzask.
