# P3.2a (fala 3, partia 4a): runda poprawek 9. Część D (LP-6) wyjęta z pozycji

Data: 2026-10-09. Worktree `wt3/P3.2a`, gałąź `perf/w3-P3.2a`. Nowy commit `34612379` na `017561c0`, bez przepisywania historii.
Diff zawsze względem `64dddffe`.

## 0. Co i dlaczego

Prove (`PROVE.md` §0, §2, §5, §8) zgłosił jedno ustalenie blokujące. Wszystkie bramki były zielone, ale część D planu
(logo nagłówka chrome eager w `<picture>` z `<source media="(max-width: 1023px)" srcset="data:…">`) łamie dwa kryteria
planu:

1. **Lantern mobile LCP +75 ms w 13/15 przebiegów B.** Żądanie `data:` GIF wchodzi do grafu pesymistycznego i
   przesuwa `cover.jpg` o jeden RTT. Kontrfakt z `lcp-without-data.txt` (usunięcie tylko tego wpisu z `devtoolsLog`)
   przywraca LCP co do milisekundy. Plan zakładał wynik neutralny. Na produkcji ta kara mogłaby w PSI zjeść cały
   szacowany zysk hero 640w (−60…−80 ms).
2. **`bootClosureGzipBytes` +331 B** przy limicie planu §5.1 wynoszącym +300 B. Około 430 B modułów pochodziło z D:
   `mediaWidgets` +308, `headerChromeContext` +62, część `Header` +114.

Zastosowałem rezerwę samego planu §5.1 („w ostateczności odłożyć LP-6 do osobnej pozycji”), czyli wariant (a) z
`PROVE.md` §8. **Część D wychodzi z P3.2a w całości.** Części A, B i C zostają bez zmian: drabina 5 szerokości, adresy
względne w renderze, preloadzie i `Link`, `sizes` z marginesem kolumny 32 px, strażnik awatarów, nowe metryki
document-weight i `compare-head-meta.mjs`.

## 1. Zmiany plik po pliku (commit rundy 9 względem `017561c0`)

| plik                                                                                     | zmiana                                                                                                                                                                                                                                                                                 | dlaczego                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/builder/headerChromeContext.ts`                                                 | **usunięty**                                                                                                                                                                                                                                                                           | kontekst istniał tylko dla D                                                                                                                                                                                                                                                                                                                                           |
| `src/components/Header.tsx`                                                              | usunięty import i `<HeaderChromeContext.Provider>` wokół `BuilderRenderer`. **Zostaje** `src={renderedMediaUrl(mobileLogo)}` logo mobilnego paska                                                                                                                                      | provider należał do D. Względny `src` logo mobilnego to część B (adres względny w renderze, plan §2.5.4) i nie tworzy nowego żądania. Pobieranie jest takie samo jak w bazie (eager, auto-preload React z adresem względnym)                                                                                                                                           |
| `src/components/builder/organisms/widget-view/mediaWidgets.tsx`                          | usunięte `BLANK_GIF`, `desktopOnlyPicture`, `useContext(HeaderChromeContext)`, `eagerLogo`/`logoFrame` i propsy `eager`. Para light/dark wraca bajt w bajt do bazy. **Zostaje** scalenie dwóch gałęzi pojedynczego obrazu (kadr i bez kadru) w jedną z `className`/`style` warunkowymi | D wycofane. Scalenie gałęzi daje znacznik 1:1 z bazą (te same klasy i style, ten sam typ elementu w tym samym miejscu drzewa, więc rekoncyliacja się nie zmienia) i odejmuje bajty od chunku wejściowego (szacunek esbuild −156 B raw modułu względem bazy). Pokrywa je `mediaWidgetsLcpCandidate.test.tsx` (obraz z kadrem `img.widget-media-fg`, kandydat bez kadru) |
| `src/components/atoms/OptimizedImage.tsx`                                                | usunięty prop `eager` (zostaje `loading={priority ? "eager" : "lazy"}` i `auto,` w `sizes` jak w bazie)                                                                                                                                                                                | prop nie ma innego konsumenta (grep: `eager={` tylko w `LcpEagerSection`, czyli w innym komponencie). **Zostają** względny `src` obok `srcSet` domyślnej drabiny (§2.2.1) i `sizes` tylko razem z `srcSet` (§2.2.3)                                                                                                                                                    |
| `src/components/builder/organisms/widget-view/__tests__/mediaWidgetsHeaderLogo.test.tsx` | **usunięty** (6 testów)                                                                                                                                                                                                                                                                | testował wyłącznie D                                                                                                                                                                                                                                                                                                                                                   |
| `e2e/hero-srcset.boot-home.spec.ts`                                                      | usunięta część 3 (2 testy logo: telefon `data:`, desktop eager w `<picture>`) i jej opis w nagłówku                                                                                                                                                                                    | testy D. Części 1 (wybór 640w na stronie testowej, 3 testy) i 2 (margines kolumny 32 px na artefakcie) bez zmian                                                                                                                                                                                                                                                       |
| `src/lib/ci/__tests__/documentWeightSrcset.test.tsx`                                     | test parsera przemianowany: „adres `data:` w `srcset` (przecinek w base64) nie rozcina się na kandydatów `w`”, bez odwołania do logo nagłówka i bez `class="contents"`                                                                                                                 | test pilnuje odporności `widthCandidateSets` na przecinek w `data:…;base64,`. Ta właściwość metryki zostaje potrzebna niezależnie od D                                                                                                                                                                                                                                 |

Pliki partii bez zmian w tej rundzie: `cropSizes.ts`, `imageSlot.ts`, `widgetImageSizes.ts`, `heroImage.ts`,
`sliderVariants.tsx`, `PostContextViews.tsx`, `SpeakersWidget.tsx`, `documentWeight.ts`, `document-weight-budgets.json`
(komentarz P3.2a nie wspominał o logo), `compare-head-meta.mjs` i testy A, B i C.

Pełny ślad pozycji względem `64dddffe` po rundzie: 23 pliki, +1098 / −45. Plików D już nie ma
(`headerChromeContext.ts` i `mediaWidgetsHeaderLogo.test.tsx` nie istnieją w drzewie).

## 2. Oczekiwany efekt (do potwierdzenia w Prove)

### 2.1 Domknięcie bootu (szacunek esbuild, tym samym skryptem co IMPL, `est-fix9/est.mjs`)

Moduły chunku wejściowego, minifikacja per moduł. Skrypt jest pesymistyczny, bo liczy też linie importów, które w
bundlu znikają.

| moduł                    | Δ raw (rnd 1, z D) | Δ raw (rnd 9, bez D) |
| ------------------------ | -----------------: | -------------------: |
| `Header.tsx`             |               +164 |              **+56** |
| `OptimizedImage.tsx`     |                +59 |              **+41** |
| `mediaWidgets.tsx`       |               +203 |             **−156** |
| `headerChromeContext.ts` |                +86 |         **0** (brak) |
| `imageSlot.ts`           |               +136 |                 +136 |
| `widgetImageSizes.ts`    |                −29 |                  −29 |
| `cropSizes.ts`           |               +275 |                 +275 |
| **razem raw / gz**       |    **+894 / +428** |      **+323 / +194** |

Kalibracja na pomiarze Prove: rnd 1 dał w szacunku +894 / +428, a w pomiarze `check-document-weight` +529 raw / +331 gz
(gz ≈ 0,78 × szacunek). Dla rundy 9 wychodzi więc **≈ +190 raw / ≈ +150 gz** domknięcia bootu, poniżej limitu planu
+300 B gz z zapasem ok. 150 B. Zapas progu bramki (496 679) rośnie dla P3.7b i P3.1 do ok. 1,5 KB gz. To nadal szacunek.
Pomiar należy do Prove (`build:smoke` i `check-document-weight`, których ten etap nie uruchamia).

Dalszy możliwy krok, gdyby pomiar przekroczył +300 B gz (nie jest potrzebny według szacunku): uproszczenie
`renderedMediaUrl` do samego prefiksu, bez `new URL` (REVIEW M1, ok. −60 B gz). Nie robię go teraz, bo parser chroni
przed `..` i `\` w ścieżce.

### 2.2 Dokument `/` (fixture) wobec bazy A

- Logo desktopowego nagłówka wraca do znacznika bazy (`<img loading="lazy">` bez `<picture>`/`<source>`), z jedną
  różnicą: nie ma już atrybutu `sizes`, bo SVG nie ma `srcset` (§2.2.3).
- Oczekiwane `htmlRawBytes` ≈ A −730 B. Prove dla rundy 1 zmierzył −546 B, a po zdjęciu `<picture>` dochodzi jeszcze
  ok. −186 B.
- `headRawBytes` Δ 0.
- `imagePreloadCount` 3: logo leniwe, React go nie preloaduje, tak jak w bazie.
- `imgEagerNonCandidate` 0, `imagePreloadNonCandidate` 0, nowe metryki 0 / 0.
- `dehydratedStateBytes` +13 (`imageSizes` z marginesem, część C, bez zmian).

### 2.3 Lighthouse (fixture)

- Mobile: brak żądania `data:` GIF, więc `req` 41 jak w A. Graf pesymistyczny Lantern jest taki sam jak w A, a
  oczekiwane LCP sym. − FCP sym. wynosi 600 ms jak w A, a nie 675 ms. Kontrfakt Prove §5 pokazał dokładnie tę różnicę
  (−75 ms w 13/15).
- Desktop: logo wraca do pobrania po layoucie, tak jak w bazie. W Prove rundy 1 ΔLCP desktopu par wyniosło −0,004 s,
  w MDE, więc zysku D i tak nie było widać.

### 2.4 Produkcja d2 (symulacja planu)

Liczby `PROVE.md` §3 bez D: HTML 500 741 → 475 076 B, bajty `srcset` 70 785 → 46 879, `Link` 2 138 → 1 279 B. D
dokładało tu ok. +162 B (`<picture>` logo), więc po rundzie 9 HTML d2 jest jeszcze o tyle mniejszy. Szacowany zysk hero
640w na mobile (−12,9 KB na żądaniu LCP, ok. −60…−80 ms) przestaje być zjadany przez karę `data:` z Lantern.

## 3. Bramki uruchomione w tej rundzie (worktree `wt3/P3.2a`)

| bramka                                                                                                      | wynik                                                                                                                                                                                                                                   | log                                 |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `bunx prettier --write` (5 dotkniętych plików)                                                              | zielona. Prettier sformatował tylko e2e (pusta linia po usuniętym teście), reszta bez zmian                                                                                                                                             | —                                   |
| `light.sh bunx eslint` (5 dotkniętych plików)                                                               | **zielona**, exit 0, 0 uwag                                                                                                                                                                                                             | `eslint-fix9.log`                   |
| typecheck (`typecheck-noinc.sh`: `tsgo` app, `tsc` scripts, `tsgo` e2e) przez `heavy-bg.sh`                 | **zielona**: exit 0, pusty log (app + scripts + e2e)                                                                                                                                                                                    | `typecheck-fix9.log`                |
| `light.sh bunx vitest run` (74 pliki: lista IMPL `final-tests.txt` minus usunięty `mediaWidgetsHeaderLogo`) | **zielona**: 74/74 plików, 2278 testów + 13 expected fail. Rnd 1 miał 2284, a różnica to dokładnie 6 usuniętych testów D                                                                                                                | `vitest-fix9.log`, `fix9-tests.txt` |
| `light.sh bun run verify:static`                                                                            | **zielona**: 15 bramek OK w 292,8 s, w tym `format:check`, `check:dangerous-html`, `check:ts-sql-contract` i bramki SQL                                                                                                                 | `verify-static-fix9.log`            |
| `test:e2e:artifact` (env CI)                                                                                | **nieuruchomione w tym etapie**, bo wymaga `build:smoke` worktree. Zostawiam je Prove razem z `check-document-weight` i A/B mobile, zgodnie z listą re-prove z `PROVE.md` §8. Spec straciła tylko testy D, a części 1 i 2 są nietknięte | —                                   |

Logi leżą w `$SCRATCH/phase3/wave3/P3.2a/`. Bramek usuniętych w PR #475 nie odtwarzam.

## 4. Odstępstwa od planu

1. **LP-6 (plan §2.5.1-3, §4 pkt 6 testy logo, e2e 3) odłożone do osobnej pozycji.** To rezerwa samego planu §5.1,
   wybrana na podstawie pomiaru Prove (Lantern +75 ms z żądania `data:` i boot +331 B gz).
   - Z §2.5 zostaje tylko pkt 4: względny `src` logo mobilnego paska, czyli część B.
   - Decyzja (O) z PLAN-FALI-3 §3a („logo nagłówka eager tylko w wariancie jasnym”) traci w tej pozycji przedmiot. Logo
     desktopowe, oba warianty, jest leniwe jak w bazie.
2. **Scalenie gałęzi pojedynczego obrazu w `mediaWidgets.tsx` zostaje**, choć wprowadzono je razem z D. To czysta
   unifikacja ze znacznikiem 1:1 i mniejszą liczbą bajtów wejścia, zgodna z prośbą właściciela (optymalizować,
   ujednolicać). Gdyby orkiestrator wolał zerowy diff tego pliku, można ją cofnąć (+156 B raw modułu w szacunku). Plik
   nie jest współdzielony z P3.7b ani P3.1.
3. Odstępstwa z IMPL rundy 1 bez zmian: `SpeakersWidget.tsx` przypięty do starej drabiny (REVIEW m1, nadrzędne (W/O) z
   §3a) i §2.2.3 (`sizes` tylko z `srcset`).

## 5. Ustalenia niebędące blokadą: decyzje

- **REVIEW m2** (szczelina breakpointu `<source media>` przy ułamkowej szerokości). Nieaktualne, bo nie ma już
  `<source>`.
- **REVIEW m5** (logo eager konkuruje o łącze przy parsowaniu). Nieaktualne, bo logo wraca do leniwego.
- **REVIEW m3** (nowe metryki to na fixture pusta bramka). Bez zmian i opisane w `_comment` budżetu. Ratchet i fixture
  z prawdziwym `srcset` należą do orkiestratora.
- **REVIEW m4** (podglądy z innym magazynem muszą ustawić `VITE_PUBLIC_MEDIA_ORIGIN`). Ryzyko bez zmian (§6).
- **CLS 0,13-0,36 w ok. 1/15 przebiegów mobile na A i na B** (`PROVE.md` §6). To wada bazy: kolejność DOM (post-lista
  przed kolumną hero) różni się od kolejności wizualnej na telefonie (`order`), więc pierwsza klatka w przerwie parsera
  potrafi pokazać post-listę w miejscu hero. Poza zakresem i plikami P3.2a. Rekomenduję osobną pozycję (kolumna hero
  przed post-listą w DOM albo rezerwacja wysokości).

## 6. Ryzyka

- **LP-6 nie jest zrealizowane.** Desktopowe logo nadal startuje po pierwszym layoucie, tak jak w bazie i na produkcji:
  start 1908-2155 ms przy hero 1391-1496 ms (plan §1.5). To kosmetyka pierwszej klatki desktopu, a nie LCP. Kierunek
  dla osobnej pozycji to mechanizm, który na telefonie **nie tworzy żadnego wpisu w logu sieci**:
  - Żadnego `data:` w `srcset`/`src`, bo Lantern wlicza go do grafu pesymistycznego.
  - Wariant: `<link rel=preload as=image media="(min-width: 1024px)">`. Wymaga jednak decyzji o progu
    `imagePreloadCount` (cap 3 = pomiar) i bajtach `<head>`.
  - Wariant: wcześniejszy start leniwego obrazu przez geometrię (rezerwacja miejsca nagłówka jest już w P3.3).
  - Każdy wariant trzeba sprawdzić kontrfaktem Lantern jak w `PROVE.md` §5.
- Ryzyka A, B i C bez zmian (IMPL §5, REVIEW m4): podglądy z własnym magazynem bez `VITE_PUBLIC_MEDIA_ORIGIN` dostają
  `/media/x` ze swojego hosta. Na aliasie `www` jest inny klucz cache CDN.
- Budżet bootu jest w tej rundzie oparty na szacunku (§2.1). Pomiar daje Prove.

## 7. Na co ma spojrzeć recenzent / Prove

1. `mediaWidgets.tsx` względem `64dddffe`: diff ma tylko scalenie gałęzi pojedynczego obrazu (−15 linii), a para
   light/dark jest bajt w bajt z bazą. Nie ma importów `react` poza typami (`CSSProperties`, `SyntheticEvent`).
2. `Header.tsx` względem `64dddffe`: tylko import `renderedMediaUrl` i względny `src` logo mobilnego. `BuilderRenderer`
   nagłówka bez opakowania.
3. `OptimizedImage.tsx` względem `64dddffe`: tylko względny `finalSrc` obok `srcSet` domyślnej drabiny oraz `sizes`
   wyłącznie z `srcSet`. Bez propa `eager`.
4. Re-prove z `PROVE.md` §8:
   - `check-document-weight`: `bootClosureGzipBytes` Δ ≤ +300 (szacunek ≈ +150);
   - A/B mobile: `req` 41, brak żądania `data:`, LCP sym. − FCP sym. = 600 ms jak w A;
   - `test:e2e:artifact` w env CI: spec P3.2a ma teraz 4 testy zamiast 6.
