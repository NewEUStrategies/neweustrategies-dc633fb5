# P3.2a (fala 3, partia 4a): dowód (Prove). Bajty obrazów w HTML i ścieżce LCP

Data: 2026-10-09. A = baza partii 4a `base-w3g` @ `64dddffe` (zbudowana przez orkiestratora, bez przebudowy).
B = worktree `wt3/P3.2a` @ `017561c0` (gałąź `perf/w3-P3.2a`, drzewo czyste). Build B: `env BUNDLE_INVENTORY=1 bun run
build:smoke` przez mutex, exit 0.

Logi i surowe wyniki leżą w `$SCRATCH/phase3/wave3/P3.2a/`:

- `build.log`;
- `check:*.log` (B) i `check-bundle-base.log` (A);
- `document-weight.json` (B) i `document-weight-base.json` (A);
- `e2e-artifact.log`;
- `ab.log` z `lh/` (A/B 5 × mobile i desktop4x) oraz `ab2.log` z `lh2/` (dodatkowa seria 10 × mobile, §6);
- `html/` (dokumenty `/` z fixture A i B, diff `AB.diff`);
- `lcpgraph.txt` i `lcp-without-data.txt` (Lantern, §5);
- `prove-tools/`.

## 0. Werdykt

| Kryterium (nota orkiestratora i plan P3.2a §5)                                                                               | Wynik                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bramki artefaktu: `check:bundle`, `check:chunks`, `check:entry-purity`, `check:server-entry-purity`, `check-document-weight` | **zielone**, ale z dwoma zastrzeżeniami. (1) `check:bundle` zielone, a mimo to gorsze od bazy: overall +0,8 KB, public +0,5 KB, wejście +0,3 KB, boot +0,3 KB gz. (2) `bootClosureGzipBytes` **+331 B**, a plan §5.1 stawia limit **≤ +300 B** (§2).                                                                          |
| e2e artefaktu (env CI) z własnymi testami pozycji                                                                            | **37/37 zielone**, w tym 6 testów `hero-srcset.boot-home.spec.ts`                                                                                                                                                                                                                                                             |
| Żądanie hero 640w na telefonie (KRYTYKA L6: strona testowa z prawdziwym `srcset`)                                            | **TAK** w prawdziwym Chromium 1194. Przy 412 × 823 @ 1,75 jest dokładnie jedno żądanie `width=640`, a dawne `sizes` dają 768w. Desktop 1350 @ 1 zostaje przy 768w. Na artefakcie hero ma `left` 32 i `width` 348 przy 412 px.                                                                                                 |
| `check-document-weight`: preload = kandydat, `imagePreloadNonCandidate` 0, bajty `srcset` w dół                              | **TAK** dla struktury: `imagePreloadNonCandidate` 0 → 0, `imgEagerNonCandidate` 0 → 0, `imagePreloadCount` 3 → 3, `headRawBytes` Δ 0. Fixture nie ma `srcset`, więc bajty `srcset` to 0 → 0 (nowe metryki 0 / 0). Na d2 (symulacja planu, produkcja) `srcset` spada z 70 785 do 46 879 B, a HTML o −25 665 B raw i −676 B gz. |
| ΔLCP mobile ≤ −0,1 s albo raport                                                                                             | **raport**. Fixture nie ma `srcset`, więc zysku 640w nie da się tu zmierzyć. Wychodzi za to **regresja Lantern mobile LCP o +75 ms** w 13/15 przebiegów B. Jej przyczyną jest żądanie `data:` GIF z `<picture>` logo (część D planu), co potwierdza kontrfakt w §5. Plan zakładał wynik neutralny ±0,02 s.                    |
| CLS 0                                                                                                                        | Desktop 0/0 w 5/5. Mobile: jeden przebieg B ma CLS 0,358. **Ta sama wada wystąpiła na bazie A** (0,126 w serii 10×), więc to wyścig sprzed tej zmiany, a nie skutek P3.2a (§6).                                                                                                                                               |
| Brak wzrostu `ScriptCatchup`/hydratacji                                                                                      | **TAK**. Długość zadania jest bez zmian (obs. mediana 35,0 / 36,3 ms w serii 10×), a różnice blokowania wynikają z położenia zadania wobec FCP sym.                                                                                                                                                                           |

**`effect_matches_plan = partly`.**

- Struktura zgadza się z planem: drabina 5 szerokości, adresy względne tylko w renderze, `sizes` z marginesem 32 px,
  wybór 640w w Chromium, preload = kandydat, nowe metryki i e2e na zielono.
- Dwie rzeczy są sprzeczne z planem i obie dotyczą części D (logo eager w `<picture>`):
  - Lantern mobile LCP rośnie o +75 ms przez dodatkowe żądanie `data:` (plan: neutralnie);
  - boot closure rośnie o +331 B gz (limit planu +300 B).
- Na produkcji zysk 640w szacowano na −60…−80 ms LCP. Ta sama kara Lantern (+75 ms) może go w PSI w całości zjeść.

**`needs_fix = true`.** Żadna bramka nie jest czerwona. Narusza się dwa kryteria planu, oba przez część D. Zalecenie
w §8: wyjąć część D (LP-6) z P3.2a, zgodnie z rezerwą planu §5.1 („w ostateczności odłożyć LP-6 do osobnej
pozycji”), albo zastąpić `<source srcset="data:…">` mechanizmem, który na telefonie nie tworzy żadnego żądania.

## 1. Bramki artefaktu

| Bramka                                                                       | A (`base-w3g`)              | B (P3.2a)                                                      | Wynik                                              |
| ---------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------- | -------------------------------------------------- |
| `build:smoke` (BUNDLE_INVENTORY=1)                                           | —                           | exit 0 (2 min 11 s faza klienta)                               | zielony                                            |
| `check:bundle` overall                                                       | 4752,9 / 4772 KB            | **4753,7 KB (+0,8)**                                           | zielony, gorszy od bazy                            |
| public JS                                                                    | 2803,1 / 2877 KB            | 2803,6 KB (+0,5)                                               | zielony                                            |
| admin-only                                                                   | —                           | 1950,1 KB                                                      | —                                                  |
| largest chunk (`index`, wejście)                                             | 261,2 / 286 KB              | 261,5 KB (+0,3)                                                | zielony                                            |
| CSS all / public                                                             | 95,8 / 81,5 KB              | 95,8 / 81,5 KB                                                 | zielony, CSS bez zmian (zapas 0,2 KB nienaruszony) |
| **Boot closure**                                                             | 486,8 KB gz / 1594,3 KB raw | **487,1 KB gz / 1594,8 KB raw**                                | zielony, +0,3 / +0,5 KB                            |
| `check:chunks`                                                               | —                           | 894 chunki, 6860 krawędzi, acykliczny                          | zielony                                            |
| `check:entry-purity`                                                         | —                           | „Sciezka bootowania czysta”                                    | zielony                                            |
| `check:server-entry-purity`                                                  | —                           | 1822 pliki, czysty (leniwe: stripe; dług: node-html-parser ×2) | zielony                                            |
| `test:e2e:artifact` (env CI: `NES_ARTIFACT_FIXTURE=1` + atrapy `SUPABASE_*`) | —                           | **37/37** w 1,6 min                                            | zielony                                            |
| `check-document-weight` (5 próbek HIT)                                       | zielony                     | zielony                                                        | zielony (§3)                                       |

Linia `Boot closure` (B): `Boot closure: 487.1 KB gzip / 1594.8 KB raw  (10 chunków statycznie osiągalnych ze SSR-owego <script>; budget ≤ 579 KB)`.

Lista ruchów `check:bundle` (B) to te same pozycje co na bazie, względem baseline'u b006c2e. P3.2a nie dodaje do niej
nowej pozycji:

```
+  131.5 KB  spreadsheet.worker (NOWY)  (0.0 -> 131.5)
  -46.5 KB  index  (354.6 -> 308.1)
  -24.1 KB  lucide-shim.fa  (42.0 -> 17.9)
+   16.5 KB  club._clubSlug.index  (23.1 -> 39.6)
+    7.5 KB  admin.seo (NOWY)  (0.0 -> 7.5)
+    3.0 KB  i18n-club  (38.3 -> 41.3)
   -2.5 KB  category._slug / icons-0 / icons-1; -2.4 KB profile.notifications / icons-3; +2.4 KB SeoPanel; znikł i18n-admin-seo-hub
```

`test:e2e:artifact` obejmuje:

- `boot-artifact` ×3, w tym kontrolę negatywną;
- `boot-home` ×3, `backend-quiet`, `boot-timing` ×3, `content-visibility` ×13, `legal-links` ×5, `motion-gate` ×3 i
  `single-font` ×2;
- **6 nowych testów P3.2a** (`hero-srcset.boot-home.spec.ts`):
  - strona testowa: 412 @ 1,75 → `["640"]`, dawne `100vw` → `["768"]`, desktop 1350 @ 1 → `["768"]`;
  - artefakt `/` 412 px: hero `left` 32 / `width` 348;
  - logo nagłówka desktopowego na telefonie: `currentSrc` = `data:`, bez żądania;
  - desktop: logo eager, bez `fetchpriority=high`, pobrane przy parsowaniu, `<picture class="contents"><source …>` w HTML-u serwera.

Bramki usunięte w PR #475 (np. `check:ssr-budgets`) nie są odtwarzane. Typecheck, vitest i `verify:static` wykonał
implementer (IMPL §2) i powtórzyła je recenzja. Commit się nie zmienił, więc tu ich nie powtarzam.

## 2. Domknięcie bootu: skąd +331 B gz

`check-document-weight`, pliki domknięcia bootu (A → B):

| plik                   |             raw A → B |    Δ raw |        gzip A → B |     Δ gz |
| ---------------------- | --------------------: | -------: | ----------------: | -------: |
| `index-*.js` (wejście) |     859 185 → 859 714 | **+529** | 265 964 → 266 296 | **+332** |
| `dynamic-icon`         |         5 908 → 5 908 |        0 |     3 104 → 3 103 |       −1 |
| pozostałe 8 (vendor-*) |             bez zmian |        0 |         bez zmian |        0 |
| **razem**              | 1 632 545 → 1 633 074 | **+529** | 494 977 → 495 308 | **+331** |

Limit planu (§5.1) to `bootClosureGzipBytes` Δ ≤ +300 B, więc **przekroczenie wynosi 31 B**. Próg bramki (496 679) nadal ma
zapas 1 371 B, ale ten zapas dzielą P3.7b i P3.1. Moduły chunku wejściowego w inwentarzu (`reports/chunk-inventory.json`, bajty
modułów przed kompresją, A → B):

| moduł                                           |        Δ B | część planu                                                              |
| ----------------------------------------------- | ---------: | ------------------------------------------------------------------------ |
| `src/lib/cropSizes.ts`                          |       +437 | A/B: drabina, `LEGACY_AVATAR_RESPONSIVE_WIDTHS`, `renderedMediaUrl`      |
| `organisms/widget-view/mediaWidgets.tsx`        |       +308 | **D**: `<picture>`, `eager`, kontekst (scalone gałęzie dają część zysku) |
| `src/lib/builder/imageSlot.ts`                  |       +213 | C: `mobileSlotSize`, stała marginesu                                     |
| `src/components/Header.tsx`                     |       +114 | **D**: provider kontekstu; B: `renderedMediaUrl` logo mobilnego          |
| `src/components/atoms/OptimizedImage.tsx`       |       +112 | B + `eager` (**D**) + §2.2.3                                             |
| `src/lib/builder/headerChromeContext.ts` (nowy) |        +62 | **D**                                                                    |
| `src/lib/builder/widgetImageSizes.ts`           |        −23 | C                                                                        |
| `*.css?url`                                     |    +2 / +2 | długość ścieżki worktree, nie kod                                        |
| **razem**                                       | **+1 227** | po minifikacji chunku: +529 raw / +332 gz                                |

Około 400-480 B modułów (mediaWidgets, kontekst i provider w Header) to część D. Bez niej przyrost gzip wraca z dużym
zapasem poniżej +300 B. To szacunek, który trzeba potwierdzić buildem.

## 3. Waga dokumentu (`check-document-weight`, mediany 5 próbek HIT, fixture `/`)

| metryka                                       |           A |           B |        Δ |        próg | uwagi                                                                                                                      |
| --------------------------------------------- | ----------: | ----------: | -------: | ----------: | -------------------------------------------------------------------------------------------------------------------------- |
| htmlRawBytes                                  |     328 326 |     327 780 | **−546** |     406 180 | plan +175. §2.2.3 (bez `sizes` przy obrazach bez `srcset`): 13 → 2 atrybuty, −732 B. `<picture>` + `<source>` logo +~186 B |
| htmlGzipBytes                                 |      49 834 |      49 764 |      −70 |           — |                                                                                                                            |
| headRawBytes                                  |      25 669 |      25 669 |    **0** |           — | zgodnie z planem                                                                                                           |
| inlineStyleCount / Bytes                      | 26 / 71 363 | 26 / 71 363 |        0 |           — |                                                                                                                            |
| inlineCssCommentBytes                         |         517 |         517 |        0 | 517 (= cap) |                                                                                                                            |
| inlineScriptBytes                             |      87 551 |      87 564 |      +13 |           — |                                                                                                                            |
| inlineExecutableScriptBytes                   |      80 304 |      80 317 |      +13 |           — |                                                                                                                            |
| dehydratedStateBytes                          |      61 047 |      61 060 |      +13 |           — | `heroPreloads[].imageSizes`: `100vw` → `calc(100vw - 64px)` w ładunku routera                                              |
| modulepreloadCount                            |           0 |           0 |        0 |           — |                                                                                                                            |
| linkHeaderEntries                             |           4 |           4 |        0 |           — | nagłówek `Link` bajt w bajt (różnią się tylko `date` i `server-timing`)                                                    |
| preloadDuplicates / documentPreloadDuplicates |       2 / 0 |       2 / 0 |        0 |           — |                                                                                                                            |
| imagePreloadCount                             |           3 |           3 |    **0** |           3 | `<picture>` tłumi auto-preload React                                                                                       |
| imgFetchpriorityHigh                          |           1 |           1 |        0 |           2 |                                                                                                                            |
| fontPreloadCount                              |           1 |           1 |        0 |           1 |                                                                                                                            |
| bootClosureRawBytes                           |   1 632 545 |   1 633 074 |     +529 |   1 637 758 |                                                                                                                            |
| **bootClosureGzipBytes**                      |     494 977 |     495 308 | **+331** |     496 679 | plan ≤ +300 (§2)                                                                                                           |
| preloadedJsCount / GzipBytes                  |       0 / 0 |       0 / 0 |        0 |           — |                                                                                                                            |
| renderBlockingCssGzipBytes                    |      80 765 |      80 765 |        0 |           — |                                                                                                                            |
| lcpCandidateCount / Missing                   |       1 / 0 |       1 / 0 |        0 |           — |                                                                                                                            |
| imgEagerNonCandidate                          |           0 |           0 |    **0** |           0 | logo eager jest w `<header data-site-header>`                                                                              |
| imagePreloadNonCandidate                      |           0 |           0 |    **0** |           0 |                                                                                                                            |
| linkHeaderDisallowed                          |           0 |           0 |        0 |           0 |                                                                                                                            |
| preLcpTransferBytes                           |     154 971 |     154 901 |      −70 |           — |                                                                                                                            |
| srcsetCandidatesMax (nowa)                    |           — |           0 |        — |           5 | fixture nie ma `srcset`                                                                                                    |
| absoluteCanonicalMediaInRenderedSrcset (nowa) |           — |           0 |        — |           0 |                                                                                                                            |
| bootEntryMissing                              |           0 |           0 |        0 |           — |                                                                                                                            |
| bootBurstCount                                |          26 |          26 |        0 |  26 (= cap) |                                                                                                                            |
| bootBurstGzipBytes                            |     572 197 |     572 550 |     +353 |     574 673 |                                                                                                                            |

Mediany bazy zgadzają się co do bajtu ze stanem bazy podanym przez orkiestratora (`document-weight-2.json`).
`check-document-weight` B jest zielony. Progów nie ratchetowałem: nowe klucze mają `srcsetCandidatesMax` 5 i
`absoluteCanonicalMediaInRenderedSrcset` 0, a stare progi są nietknięte.

Diff dokumentu `/` (fixture, origin i hashe znormalizowane, `html/AB.diff`):

- logo `site-logo-img` w nagłówku desktopowym: `<img loading="lazy" sizes=…>` → `<picture class="contents"><source
media="(max-width: 1023px)" srcSet="data:image/gif;base64,…"/><img loading="eager" fetchPriority="auto" …></picture>`;
- `sizes` znika z 11 obrazów bez `srcset` (§2.2.3; 762 → 30 B atrybutów `sizes`);
- `heroPreloads.imageSizes` w ładunku routera dostaje `calc(100vw - 64px)`;
- `<img data-lcp-candidate>` hero, `<link rel=preload as=image>` ×2 i nagłówek `Link` bez zmian. Fixture `cover.jpg` jest
  na hoście spoza `/media/` i bez `srcset`, więc A i B dają tu 0 B.

Produkcja d2 (symulacja planu `sim.py`, uruchomiona ponownie w tym dowodzie i zgodna z IMPL):

| wariant                       |        HTML raw |     gz | `<head>` | `Link` |
| ----------------------------- | --------------: | -----: | -------: | -----: |
| baza d2                       |         500 741 | 73 603 |   31 792 |  2 138 |
| A+B+C (P3.2a)                 |         475 076 | 72 927 |   30 934 |  1 279 |
| A+B+C + logo mobilne względne |         475 010 | 72 925 |   30 901 |  1 279 |
| bajty `srcSet`                | 70 785 → 46 879 |        |          |        |

To jest symulacja planu, a nie render kodu B na danych produkcji (dokumentu produkcji nie da się wyrenderować offline).
Zgodność kodu z symulacją pokazuje test parytetu SSR `heroCandidateSelection.test.tsx` z IMPL.

## 4. Lighthouse A/B (5 × mobile, 5 × desktop4x, przeplot, fixture, h2)

`VALID`: A i B po 5/5 w obu formach, excluded 0. Wariant dokumentu: A `s-maxage=900, 321271 B`, B `320725 B` (×5,
HIT). Tryb FCP „bez-js” ×5 we wszystkich seriach.

### 4.1 Mediany i DELTA B−A

| forma     | strona | perf |    FCP |       LCP |    TBT |     SI |   CLS |    TTI | mainThread | bootup |                  req | transfer |       js |
| --------- | ------ | ---: | -----: | --------: | -----: | -----: | ----: | -----: | ---------: | -----: | -------------------: | -------: | -------: |
| mobile    | A      |   99 | 1,41 s |    2,01 s |  76 ms | 1,41 s | 0,000 | 4,31 s |       2606 |   1257 |                   41 | 792,3 KB | 545,6 KB |
| mobile    | B      |   97 | 1,39 s |    2,06 s | 133 ms | 1,42 s | 0,000 | 4,28 s |       2676 |   1225 |               **42** | 793,0 KB | 546,2 KB |
| mobile    | Δ      |   −2 |  −0,02 | **+0,06** |    +57 |  +0,01 |    ±0 |      — |        +70 |    −31 | **+1** (`data:` GIF) |  +0,6 KB |  +0,6 KB |
| desktop4x | A      |   91 | 0,40 s |    0,49 s | 250 ms | 0,62 s | 0,000 | 1,27 s |       2993 |   1445 |                   43 | 797,2 KB | 550,4 KB |
| desktop4x | B      |   94 | 0,44 s |    0,51 s | 201 ms | 0,61 s | 0,000 | 1,17 s |       2889 |   1343 |                   43 | 797,8 KB | 551,0 KB |
| desktop4x | Δ      |   +3 |  +0,04 |     +0,02 |    −49 |  −0,02 |    ±0 |      — |       −104 |   −102 |                    0 |  +0,6 KB |  +0,6 KB |

`highPriorityBytesBeforeLcpImage` 92,7 KB → 92,7 KB w obu formach.

### 4.2 Pary (n = 5, t(df 4) = 3,72)

| forma     | metryka |        Δ̄ par |    σΔ | MDE(t) | ocena                                                 |
| --------- | ------- | -----------: | ----: | -----: | ----------------------------------------------------- |
| mobile    | FCP     |     −0,024 s | 0,017 |  0,028 | w MDE                                                 |
| mobile    | LCP     | **+0,040 s** | 0,043 |  0,071 | w MDE, ale 4/5 par dodatnie. Strukturalnie +75 ms, §5 |
| mobile    | TBT     |       +45 ms |    47 |     78 | w MDE (szum A/A σΔ ~110 ms)                           |
| mobile    | SI      |     +0,027 s | 0,078 |  0,130 | w MDE                                                 |
| mobile    | TTI     |     −0,035 s | 0,011 |  0,018 | poza MDE, bez znaczenia praktycznego                  |
| desktop4x | FCP     |     −0,006 s | 0,087 |  0,145 | w MDE                                                 |
| desktop4x | LCP     |     −0,004 s | 0,045 |  0,075 | w MDE                                                 |
| desktop4x | TBT     |       −48 ms |    64 |    106 | w MDE                                                 |
| desktop4x | SI      |     −0,009 s | 0,065 |  0,108 | w MDE                                                 |
| desktop4x | TTI     |     −0,069 s | 0,162 |  0,270 | w MDE                                                 |

### 4.3 Przebiegi

| przebieg    | A: perf / FCP / LCP / TBT / SI / CLS | B: perf / FCP / LCP / TBT / SI / CLS          |
| ----------- | ------------------------------------ | --------------------------------------------- |
| mobile-1    | 95 / 1,41 / 2,01 / 219 / 1,41 / 0    | 96 / 1,39 / 2,06 / 182 / 1,51 / 0             |
| mobile-2    | 99 / 1,41 / 2,01 / 27 / 1,41 / 0     | **81** / 1,38 / 2,06 / 109 / 1,38 / **0,358** |
| mobile-3    | 98 / 1,47 / 2,13 / 76 / 1,47 / 0     | 98 / 1,42 / 2,10 / 133 / 1,42 / 0             |
| mobile-4    | 99 / 1,42 / 2,02 / 82 / 1,42 / 0     | 97 / 1,41 / 2,09 / 152 / 1,54 / 0             |
| mobile-5    | 99 / 1,38 / 1,98 / 57 / 1,38 / 0     | 98 / 1,37 / 2,05 / 108 / 1,37 / 0             |
| desktop4x-1 | 88 / 0,54 / 0,58 / 298 / 0,69 / 0    | 94 / 0,48 / 0,52 / 201 / 0,61 / 0             |
| desktop4x-2 | 98 / 0,37 / 0,47 / 131 / 0,53 / 0    | 97 / 0,46 / 0,50 / 149 / 0,60 / 0             |
| desktop4x-3 | 91 / 0,40 / 0,49 / 250 / 0,67 / 0    | 93 / 0,43 / 0,51 / 216 / 0,61 / 0             |
| desktop4x-4 | 83 / 0,40 / 0,47 / 384 / 0,62 / 0    | 90 / 0,44 / 0,51 / 255 / 0,66 / 0             |
| desktop4x-5 | 95 / 0,48 / 0,52 / 189 / 0,61 / 0    | 94 / 0,35 / 0,47 / 193 / 0,61 / 0             |

Obciążenie przy każdym przebiegu wynosiło < 2,4 (harness), więc żaden ślad nie jest odrzucony.

### 4.4 Księga Lantern (blokowanie per klasa, wartości per przebieg)

| seria                | TBT med | ScriptCatchup                         | Script:vendor-react | Timer:index      | inne                                         |
| -------------------- | ------: | ------------------------------------- | ------------------- | ---------------- | -------------------------------------------- |
| A mobile (5)         |      76 | 172, 0, 0, 39, 0                      | 27, 18, 25, 40, 33  | 14, 9, 10, 3, 24 | ParseHTML 41 (1×), Script 6 (1×)             |
| B mobile (5)         |     133 | 156, 74, 69, 101, 79                  | 16, 15, 19, 24, 29  | 0, 0, 4, 10, 0   | ParseCSS 19/38/8 (3×)                        |
| A mobile (10, `lh2`) |      57 | 87, 0, 0, 90, 123, 0, 50, 0, 0, 109   | med 18              | med 4            | Timer:(dokument) 94/185/4, ParseCSS 12/41/10 |
| B mobile (10, `lh2`) |      96 | 0, 99, 54, 154, 120, 96, 0, 0, 24, 74 | med 18              | med 7            | drobne                                       |
| A desktop4x (5)      |     250 | 135, 78, 126, 93, 95                  | med 19              | med 10           | Style 64/45/80/148/49                        |
| B desktop4x (5)      |     200 | 93, 41, 105, 136, 70                  | med 22              | med 3            | Style 50/67/67/92/49                         |

- Pozycja nie celuje w żadną klasę zadań, bo dotyczy bajtów obrazów, i żadna klasa nie znika.
- Długość zadania `ScriptCatchup` nie rośnie. W serii 10× obs. mediana wynosi A 35,0 ms i B 36,3 ms, w serii 5× A 52,8 i
  B 37,6 ms.
- Różnice w blokowaniu `ScriptCatchup` biorą się z położenia zadania wobec FCP sym., bo blokowanie liczy się dopiero od
  FCP. W serii 10× zadanie blokuje w 5/10 przebiegów A i 7/10 B. ΔTBT w parach serii 10× wynosi −12 ms (σΔ 104).
  Hydratacja nagłówka nie rośnie.

## 5. Mobile LCP: +75 ms w Lantern z żądania `data:` (część D)

W przebiegach mobile B różnica LCP sym. − FCP sym. wynosi **675 ms w 13/15**, a w A 600 ms (9/15) albo około 670 ms.
Graf LCP Lantern (`prove-tools/lcpgraph.mjs`, `lcpgraph.txt`) pokazuje, że w B wydłuża się tylko estymacja pesymistyczna:

- A-mobile-1: opt 2009, pes 2009, `cover.jpg` 1559→2009 (450 ms);
- B-mobile-1: opt 1990, **pes 2140**, `cover.jpg` 1540→**2140** (600 ms, +1 RTT 150 ms);
- LCP = (opt + pes) / 2, więc wychodzi +75 ms.

Graf pesymistyczny zawiera wszystkie żądania (`treatNodeAsRenderBlocking: _ => true`), w tym żądanie
`data:image/gif` (Low, Image), które w B powstaje z `<source media="(max-width: 1023px)" srcSet="data:…">` logo nagłówka
desktopowego.

**Kontrfakt** (`prove-tools/lcp-without-data.mjs`): te same artefakty B przeliczone przez Lantern po usunięciu z
`devtoolsLog` tylko tego jednego żądania `data:`.

| przebieg B                          | LCP oryginał (opt / pes) | LCP bez `data:` (opt / pes) |         Δ |
| ----------------------------------- | ------------------------ | --------------------------- | --------: |
| lh/mobile-1                         | 2065 (1990 / 2140)       | 1990 (1990 / 1990)          |       −75 |
| lh/mobile-2                         | 2059 (1984 / 2134)       | 1984                        |       −75 |
| lh/mobile-3                         | 2096 (2021 / 2171)       | 2021                        |       −75 |
| lh/mobile-4                         | 2086 (2011 / 2161)       | 2011                        |       −75 |
| lh/mobile-5                         | 2045 (1970 / 2120)       | 1970                        |       −75 |
| lh2/mobile-1, 2, 5, 6, 7, 8, 9, 10  | 2042-2101                | o 75 mniej                  | −75 (8/8) |
| lh2/mobile-3, 4                     | 2166 / 2153 (opt = pes)  | bez zmian                   |         0 |
| A-mobile-1 (kontrola, brak `data:`) | 2009                     | 2009                        |         0 |

FCP jest identyczny w obu wariantach we wszystkich przebiegach. Wniosek: **samo żądanie `data:` z `<picture>` logo
podnosi Lantern mobile LCP o 75 ms w 13/15 przebiegów**. To nie jest szum, tylko deterministyczny skutek grafu
pesymistycznego. Desktop nie ma tego żądania, bo `(max-width: 1023px)` nie pasuje, i ma ΔLCP −0,004 s w parach.
Wewnętrzny mechanizm symulatora (współdzielenie przepustowości lub stanu połączenia h2 w trakcie, gdy węzeł `data:`
jest „w locie”) nie jest rozpisany do końca. Kontrfakt wystarcza do przypisania przyczyny.

Skutek dla produkcji jest ryzykiem, a nie pomiarem. Na stronach z logo w nagłówku desktopowym PSI mobile policzy to
samo żądanie `data:`. Jeśli zadziała tak samo jak w fixture, zje szacowany zysk 640w (−60…−80 ms) w całości. Realnego
LCP użytkowników (CrUX) to nie dotyczy, bo dekodowanie `data:` trwa około 2 ms.

## 6. CLS 0,358 w B-mobile-2: wyścig sprzed zmiany, nie P3.2a

- Jedno przesunięcie w 212,9 ms dotyczy węzła `div[data-col-id=…01b]`, kolumny post-listy (`order: 2` na telefonie,
  w DOM przed kolumną hero). Węzeł przesuwa się z y 149 na y 539, czyli o +390 px.
- Pierwsza klatka (FP 192 ms) powstała w przerwie parsera (ParseHTML do 193 ms, kolejny fragment w 217,8 ms) i
  pokazała post-listę pod nagłówkiem, zanim parser doszedł do kolumny hero.
- Klatki filmstripu z 196 i 233 ms pokazują post-listę na górze, a klatka z 261 ms pokazuje hero na górze.
- **Seria kontrolna `lh2` (10 × mobile, przeplot): A-mobile-1 ma CLS 0,126 na tym samym węźle** (y 345 → 539, hero
  częściowo wyrenderowany). B ma w tej serii 0/10.
- Łącznie: A 1/15, B 1/15. Wada jest w bazie: kolejność DOM (post-lista przed hero) różni się od kolejności wizualnej
  na telefonie (`order`), więc częściowe malowanie w trakcie parsowania może pokazać post-listę na miejscu hero.
- Odsetek przebiegów z FP przed końcem parsowania jest podobny w A i B we wcześniejszych dowodach fali 3 (40-80 % mobile).
  P3.2a go nie zmienia.

Zgłaszam to orkiestratorowi jako osobną sprawę poza zakresem P3.2a, z kierunkiem naprawy: kolumna hero przed
post-listą w DOM albo rezerwacja wysokości. Kryterium planu „CLS ≤ 0,001 w 5/5” jest formalnie niespełnione w serii 5×
(4/5), ale przyczyna nie leży w tej zmianie.

## 7. Seria kontrolna mobile 10 × (`ab2.log`, `lh2/`)

|                                     |            perf |                     FCP |                     LCP |               TBT |                      SI |   CLS | req |
| ----------------------------------- | --------------: | ----------------------: | ----------------------: | ----------------: | ----------------------: | ----: | --: |
| A mediana (n = 10)                  |              98 |                  1,43 s |                  2,07 s |             57 ms |                  1,45 s | 0,000 |  41 |
| B mediana (n = 10)                  |              98 |                  1,39 s |                  2,07 s |             96 ms |                  1,41 s | 0,000 |  42 |
| pary Δ̄ (σΔ, MDE(t), t(df 9) = 3,15) | +1,3 (2,9; 2,9) | −0,022 s (0,074; 0,074) | +0,014 s (0,097; 0,096) | −12 ms (104; 104) | −0,021 s (0,072; 0,072) |     — |  +1 |

W tej serii A ma 5/10 przebiegów z LCP − FCP ≈ 670 ms z innego powodu (inne węzły grafu), więc średnia różnica par
rozmywa się do +0,014 s. Kontrfakt z §5 izoluje wkład `data:` niezależnie od tego.

## 8. Co poprawić (jedna runda)

1. **Część D (LP-6, logo eager) bez żądania `data:` na telefonie albo poza P3.2a.** Zalecany jest wariant (a),
   bo naprawia oba naruszenia (LCP +75 ms i boot +331 B) bez ruszania A, B i C.
   - (a) Wycofać D z P3.2a zgodnie z rezerwą planu §5.1: `headerChromeContext.ts`, provider w `Header.tsx`, gałąź
     `eagerLogo`/`<picture>` w `mediaWidgets.tsx`, prop `eager` w `OptimizedImage.tsx` (jeśli nie ma innego konsumenta),
     testy `mediaWidgetsHeaderLogo.test.tsx` i e2e (3). LP-6 przejdzie do osobnej pozycji z mechanizmem bez żądania
     na telefonie.
   - (b) Jeśli D ma zostać, potrzebny jest mechanizm, który na telefonie nie tworzy żadnego wpisu w logu sieci. Żadne
     `<source srcset>` z `data:` się nie nadaje, a `imagePreloadCount` ma cap 3 = pomiar, więc preload z `media` też
     odpada bez zmiany progu. Po zmianie trzeba powtórzyć kontrfakt z §5.
2. **Boot closure ≤ +300 B gz.** Po (a) przyrost powinien spaść o około 100-150 B gz (szacunek z bajtów modułów §2),
   co trzeba potwierdzić buildem. Bez (a) trzeba ciąć według IMPL: najpierw uprościć `renderedMediaUrl` do samego
   prefiksu (około −60 B gz).
3. Bez zmian: drabina 5 szerokości, adresy względne (src, srcset, preload, `Link`), `sizes` z marginesem 32 px, strażnik
   awatarów, nowe metryki document-weight, `compare-head-meta.mjs`. Ich dowód strukturalny jest zielony.

Po poprawce w tym samym dowodzie trzeba sprawdzić:

- `check-document-weight` (`bootClosureGzipBytes` Δ ≤ +300);
- A/B mobile (LCP sym. − FCP sym. = 600 jak w A, brak żądania `data:`, `req` 41);
- `test:e2e:artifact`.

Dowód produkcyjny (§5.4 planu) zostaje po wdrożeniu: żądanie `…?width=640` hero w PSI mobile, brak `?width=768` tej okładki,
`Link` z `</media/…>` i 5 kandydatami, `compare-head-meta` d2 ↔ HIT równe.
