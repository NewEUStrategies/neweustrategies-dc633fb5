# P3.2a: recenzja adwersaryjna (fala 3, partia 4a)

Worktree `wt3/P3.2a`, commit `017561c0` (1 commit nad `64dddffe`), diff `64dddffe...HEAD`: 25 plików, +1367/−68.
Kontekst: `faza3/plany/P3.2a.md` (§2.1-§2.7, §4, §5), `KRYTYKA.md` L6/L7, `PLAN-FALI-3.md` §3a, `IMPL.md`.

## Werdykt: APPROVE (bez blokad), z dwoma warunkami etapu Prove (M1, M2)

Kod robi to, co mówi plan, mechanizmy się zgadzają (z jawnie opisanymi odstępstwami), a parytet SSR/klient i
preload/`<img>` jest zachowany z konstrukcji. Nie znalazłem błędu, który psułby produkcję. Dwa warunki (pomiar bootu i
e2e artefaktu) to część dowodu, której nie dało się wykonać bez `build:smoke`.

## Bramki uruchomione w recenzji

| Bramka                                                                                                                                             | Wynik                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `light.sh bunx eslint` (22 dotknięte pliki .ts/.tsx/.mjs)                                                                                          | 0 błędów, 1 ostrzeżenie (`sliderVariants.tsx:1406`, `react-refresh/only-export-components`) - jest też na bazie |
| `light.sh bunx vitest run` (9 dotkniętych plików testowych + `popupImages`, `clubDirectoryLayouts`, `clubCoverFrame`, `archive/heroImage` z §4.10) | 13/13 plików, 271/271 testów                                                                                    |
| `light.sh bun run verify:static`                                                                                                                   | 15 bramek OK (333,9 s), w tym `format:check` i kontrakt TS↔SQL                                                  |
| typecheck, build, Lighthouse, e2e                                                                                                                  | nie uruchamiane (zakaz w zadaniu recenzji)                                                                      |

Commit: trailer dokładnie wymagany (`Co-Authored-By: Claude Opus 5.5 …`, `Claude-Session: …`), opis po polsku, drzewo
czyste, brak nowych zależności, brak plików ubocznych.

## Co sprawdziłem i wynik (próby obalenia)

1. **Zakres plików.** Wszystkie pliki z listy MUST §2.7 + SHOULD (`documentWeight.ts`, budżety - tylko nowe klucze,
   `compare-head-meta.mjs`) + testy. Spoza listy: tylko `SpeakersWidget.tsx` (m1). Pliki „bez edycji” (`routes/index.tsx`,
   `$.tsx`, `archivePreload.ts`, `clubCoverPreload.ts`, `BuilderRenderer.tsx`, `lcpCandidate.ts`, `sliderSizes.ts`,
   `vite*.config.ts`, `styles.css`) nietknięte. Istniejące progi document-weight nietknięte (tylko 2 nowe klucze i akapit
   `_comment`).
2. **Względne URL-e tylko w renderze.** `renderedMediaUrl` działa tylko dla `PUBLIC_MEDIA_ORIGIN + /media/` i tylko na
   drabinie domyślnej (porównanie referencji). Sprawdziłem wszystkich wołających `buildImageSrcSet` (13 miejsc): każdy
   z drabiną domyślną to `<img>`, preload w `<head>`, nagłówek `Link` albo `new Image().srcset` (popup) - żaden nie
   karmi og:image, JSON-LD, RSS, sitemap ani e-maili (brak `renderToStaticMarkup` poza testami; web stories nie są
   AMP). og:image/JSON-LD/stemplowanie/kadry serwera/awatary przypina behawioralnie `renderedMediaScope.test.ts`.
3. **Parytet klucza preloadu.** `src` względny tylko obok `srcSet` (odstępstwo 5) - to POPRAWKA planu: dla SVG bez
   `srcset` kluczem React i `documentWeight` (`imageResourceKey`) jest `src`, a trasy preloadują go absolutnie; plan
   rozjechałby klucz. Analogicznie `preloadOf` (`heroImage.ts`) i slider. Trasy z absolutnym `href` + względnym
   `imagesrcset` (`index.tsx`, `$.tsx`, archiwa) trafiają w klucz `srcset\nsizes`. Test parytetu SSR
   (`heroCandidateSelection.test.tsx`) pokazuje jeden `<link rel=preload as=image>`.
4. **Hydratacja.** `PUBLIC_MEDIA_ORIGIN` pochodzi z `import.meta.env` (inline'owany identycznie w SSR i kliencie; ta
   sama stała już dziś steruje `isSupabaseStorageUrl`). `HeaderChromeContext` nie zależy od motywu ani urządzenia. Test
   hydratacji `mediaWidgetsHeaderLogo` bez rozjazdu. React 19 emituje `srcSet` w SSR jako `srcSet="…"` (sprawdzone
   `renderToString`), więc regex e2e (3) jest poprawny.
5. **`<picture>` logo.** `hoverEffect` dla logo jest zawsze `"none"` (`mediaWidgets.tsx`), więc `<img>` jest
   bezpośrednim dzieckiem `<picture>` (wrapper `oi-wrap` złamałby wybór `<source>`). React nie emituje auto-preloadu w
   zakresie `<picture>` (test z kontrolą pozytywną). `.contents{display:contents}` jest w publicznym arkuszu bazy
   (`styles-B1UDMYdv.css`) - 0 B CSS. Brak selektorów `> img` dla logo w `styles.css` (jedyny `figure > *` trafia w
   wrapper `ResizableImageWrap`, nie w `<picture>`). `.dark .gc-img-light` dalej ukrywa jasne logo (świadomy koszt O).
   Scalone gałęzie pojedynczego obrazu: klasy i style 1:1 z bazą.
6. **Fixture artefaktu.** Nagłówek `/` fixture ma logo `site-logo-img` (`https://fixture.invalid/image.svg`, dziś
   `loading="lazy"`), więc e2e (3) ma na czym działać; kandydat LCP fixture to `eh-img` slidera (bez `srcset`).
7. **`sizes` (LP-7).** `imageSlotSizes` zmienia tylko gałąź ze slotem i `mobileColumns === 1`; bez slotu bajt w bajt.
   `imageWidgetSizes` bez `.replace` daje bez slotu wynik identyczny z bazą (test). Uboczny, spójny skutek:
   `sliderMultiCardSizes` dla 1 karty też dostaje `calc(100vw - 64px)` (lazy, `auto,` - bez wpływu na LCP).
   Kierunek błędu przy wewnętrznych sekcjach (L7): margines 32 px to dolna granica, więc `sizes` szacuje z góry.
8. **Testy - czy złapią regresję.** Cofnięcie `mobileSlotSize` → czerwony test 640w (implementer wykonał mutację);
   cofnięcie drabiny lub `renderedMediaUrl` → rozjazd z próbką `heroSrcsetSample.ts`; usunięcie `<picture>` → 3 testy
   czerwone; strażnik awatarów: literały `buildAvatarSrc`/`buildAvatarSrcSet` i dawnej drabiny. Referencyjny Blink
   zgodny z `SelectionLogic` i potwierdzony w prawdziwym Chromium (e2e część 1, 3/3 u implementera).
9. **Graf chunków.** Nowy moduł `headerChromeContext.ts` importuje tylko `react`; importują go `Header.tsx` i
   `mediaWidgets.tsx` (oba w wejściu). `Header.tsx` dostaje krawędź do `cropSizes.ts`, który już jest w domknięciu bootu
   przez `OptimizedImage`. Brak cykli. Bajty - patrz M1.
10. **Lantern / SI.** Mobile na fixture: neutralnie (brak `srcset`; logo desktopowe poniżej `lg` bierze GIF `data:` -
    zero żądań). Zysk mobile (−12,9 KB na żądaniu hero) istnieje tylko na produkcji. Desktop: logo żądane przy
    parsowaniu, nie po layoucie - wcześniejsza zmiana wizualna nagłówka, bez nowej późnej zmiany. CLS: `<picture>`
    z `display: contents` nie tworzy pudełka.

## Ustalenia

### M1 (major, warunek Prove) - budżet domknięcia bootu niezmierzony, szacunek przekracza limit spec

- Gdzie: `src/lib/cropSizes.ts:239` (`renderedMediaUrl`), `mediaWidgets.tsx:38-54`, `OptimizedImage.tsx:83-89`,
  `Header.tsx:10-11`, nowy `headerChromeContext.ts`.
- Dowód: IMPL §4 szacuje +894 B raw / ≤ +428 B gz; spec §5.1 ma limit **Δ ≤ +300 B gz** (KRYTYKA: ≤ +1,2 KB raw).
  Zapas bazy: raw 5 213 B, gz 1 702 B, wspólny z P3.7b i P3.1. Pomiar nie istnieje (brak `build:smoke`).
- Naprawa: w Prove zmierzyć `bootClosureGzipBytes`/`bootClosureRawBytes` A=`base-w3g` vs B. Jeśli gz > +300 B: kolejność
  cięć z IMPL/spec (uproszczenie `renderedMediaUrl` do samego prefiksu bez `new URL` - parser jest i tak zbędny, bo
  `buildScaledImageUrl` normalizuje ścieżkę; potem §2.2.3; potem plan §5.1). Progów nie podnosić.

### M2 (major, warunek Prove) - e2e artefaktu (2) i (3) nieuruchomione

- Gdzie: `e2e/hero-srcset.boot-home.spec.ts:105-170`.
- Dowód: IMPL §2 i §3 pkt 10. To jedyny dowód geometrii marginesu (L7: `left 32 / width 348`), bo test
  „pochodzenia stałej” w vitest (`imageSlot.test.ts:63`) sprawdza tylko warstwę inline sekcji i mnoży ją ×4 - trzy
  warstwy z `!important` w `styles.css` nie są tam weryfikowane. Także jedyny dowód „GIF na telefonie / pobrane logo na
  desktopie” w prawdziwym dokumencie.
- Naprawa: w Prove `NES_ARTIFACT_FIXTURE=1 … bun run test:e2e:artifact` (spec pasuje do `testMatch`
  `boot-home\.spec\.ts$`, a `playwright.config.ts` ma ten sam wzorzec w `testIgnore`). Plus `check-document-weight`:
  `imagePreloadCount` 3, `imagePreloadNonCandidate` 0, `imgEagerNonCandidate` 0, `headRawBytes` Δ 0, nowe metryki 0/0.

### m1 (minor) - plik spoza listy §2.7: `SpeakersWidget.tsx`

- Gdzie: `src/components/builder/organisms/widget-view/SpeakersWidget.tsx:31,652-654`.
- Dowód: lista zamknięta §2.7 go nie zawiera, ale nadrzędne rozstrzygnięcie O (`PLAN-FALI-3.md` §3a) i notatka
  orkiestratora wprost każą zostawić zdjęcia prelegentów na starej drabinie i adresie absolutnym - bez edycji pliku to
  niewykonalne (zmiana drabiny domyślnej objęłaby je automatycznie). Odstępstwo opisane (IMPL §3.1), 1 import + 1 prop,
  żadna inna pozycja partii 4 nie dotyka pliku (grep `faza3/plany`), więc konfliktu scalenia nie ma.
- Naprawa: akceptacja orkiestratora (rekomenduję przyjąć). Alternatywa: cofnąć 4 linie, jeśli orkiestrator uzna
  zdjęcia prelegentów za obraz redakcyjny.

### m2 (minor) - szczelina breakpointu `<source media>` przy ułamkowej szerokości viewportu

- Gdzie: `mediaWidgets.tsx:51` (`media="(max-width: 1023px)"`) wobec `hidden lg:block` = `@media(min-width:64rem)`
  (sprawdzone w zbudowanym arkuszu bazy).
- Dowód: przy szerokości CSS z przedziału (1023, 1024) - np. zoom przeglądarki/skalowanie systemu - żaden warunek nie
  pasuje: nagłówek ma `display: none`, a `<img>` eager pobiera prawdziwe logo. Koszt pomijalny (jedno logo), ale to
  dokładnie przypadek, którego `<picture>` miał uniknąć.
- Naprawa: `media="(max-width: 1023.98px)"` (albo `(width < 64rem)`); test DOM i regex e2e zaktualizować razem.

### m3 (minor) - nowe metryki document-weight są na fixture bramką pustą

- Gdzie: `scripts/performance/document-weight-budgets.json:181-190`, `documentWeight.ts` (`widthCandidateSets`).
- Dowód: fixture `/` nie ma żadnego `srcset` - przed i po P3.2a obie metryki = 0, więc CI-owa bramka nie wykryje powrotu
  długiej drabiny ani absolutnych adresów; realną ochronę daje tylko `documentWeightSrcset.test.tsx`/`cropSizes.test.ts`.
  Dodatkowo `--ratchet` zbiłby `srcsetCandidatesMax` do 0 (opisane w `_comment`).
- Naprawa: brak blokady. Do zanotowania orkiestratorowi przy ratchecie; docelowo fixture z jednym kanonicznym
  `/media/…` (wariant z L6) albo przebieg `--html` na zapisanym HIT produkcji w dowodzie.

### m4 (minor) - środowiska podglądu/stagingu z domyślnym originem i innym projektem Supabase

- Gdzie: `src/lib/cropSizes.ts:239-250`, `Header.tsx:305`.
- Dowód: wdrożenie bez `VITE_PUBLIC_MEDIA_ORIGIN` ma `PUBLIC_MEDIA_ORIGIN` = domena NES. Jeśli takie wdrożenie (podgląd,
  staging z kopią danych) ma WŁASNY magazyn, adresy `https://neweuropeanstrategies.com/media/x` z bazy stają się
  `/media/x` i trasa `/media/$` szuka pliku w obcym magazynie (404), choć dotąd obraz szedł z produkcji. Produkcja i
  wdrożenia z tym samym projektem - bez zmian (trasa nie zależy od hosta, CSP `img-src 'self'`).
- Naprawa: brak zmian kodu; dopisać do ryzyk w raporcie/kronice („podglądy z innym magazynem muszą ustawić
  `VITE_PUBLIC_MEDIA_ORIGIN`”).

### m5 (minor) - desktopowe logo eager konkuruje o łącze przy parsowaniu (niezmierzone)

- Gdzie: `mediaWidgets.tsx:131-135` (`eagerLogo`).
- Dowód: na produkcji logo (6,3 KB, priorytet Low/Medium) startuje teraz obok hero (High, preload `Link`). W ciemnym
  motywie jasne logo pobiera się na darmo (świadome O). Wpływ na LCP desktopu powinien być w szumie, ale nie był mierzony.
- Naprawa: w Prove (desktop, 5 przebiegów) potwierdzić brak regresji LCP/FCP desktopu poza MDE i wcześniejsze żądanie
  logo w trace.

## Odstępstwa od planu - ocena

| Odstępstwo (IMPL §3)                                 | Ocena                                                                            |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1. `SpeakersWidget.tsx`                              | m1 - uzasadnione rozstrzygnięciem O, do akceptacji                               |
| 2. §2.3.4 SHOULD pominięte                           | OK - SHOULD, powód podany (stałe bez slotu, 0 B na d2, mniej sprzężenia z P3.7b) |
| 3. test pochodzenia stałej bez czytania `styles.css` | OK z regułą sesji (tylko testy behawioralne), ale dowód przenosi się na e2e (M2) |
| 4. skan importerów → test behawioralny               | OK, mocniejszy                                                                   |
| 5. `src` względny tylko obok `srcSet`                | OK - poprawia błąd planu (rozjazd klucza preloadu SVG)                           |
| 6. `imageWidgetSizes` bez `.replace`                 | OK, wynik identyczny, bez cichej regresji                                        |
| 7. metryki bez wyjątku dla dawnej drabiny            | OK, świadome i opisane                                                           |
| 8. `renderToString` zamiast strumienia               | OK (ten sam Fizz, kontrola pozytywna)                                            |
| 9. `compare-head-meta` na pliki/URL                  | OK                                                                               |
| 10. e2e (2)/(3) nieuruchomione                       | M2                                                                               |
