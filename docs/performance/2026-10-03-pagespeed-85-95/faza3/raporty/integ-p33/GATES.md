# Bramki scalenia integ-p33 - `0774a93d` (czubek PR `d5bd11fb` + P3.3 `cf0cf8a5`)

- Worktree: `$S/wt3/integ-p33`, gałąź `integ/w3-p33` (bez pushu), `node_modules` przez symlink.
- Scalenie: `git merge --no-ff perf/w3-P3.3` - **czyste, bez konfliktów** (P3.3 dotyka 3 plików: `BuilderRenderer.tsx`,
  nowy test vitest, nowy spec e2e; strona czubka PR od bazy scalenia `d22cf7d6` nie ruszała `BuilderRenderer.tsx`).
  Rodzice: `d5bd11fb` / `cf0cf8a5`. Wiadomość zgodna z poleceniem (tytuł + pusta linia + 2 linie atrybucji).
- Odniesienia: baza fali `$S/w3/base-b/document-weight.json` (artefakt `base-w3b`), czubek PR przed P3.7a
  `$S/phase3/integ-b2/document-weight.json` (+ `-2`), P3.7a osobno `$S/phase3/wave3/P3.7a/document-weight.json`,
  P3.3 osobno `$S/phase3/wave3/P3.3/IMPL.md` (build8) i `document-weight.json`.
- Kroki ciężkie przez mutex (`heavy-bg.sh`), lekkie przez `light.sh`. Żaden mój serwer nie został uruchomiony na stałe.

## Bramki

| #   | Bramka                                                                                                                    | Wynik                                                  | Szczegóły                                                                                                                                                                                                                                                                                                 | Log                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 3a  | typecheck (`typecheck-noinc.sh`: tsgo + tsc skryptów + tsgo e2e, bez incremental)                                         | **OK** (exit 0)                                        | -                                                                                                                                                                                                                                                                                                         | `typecheck.log`                                         |
| 3b  | `vitest run src/components/builder src/lib/builder src/lib/ci src/lib/css src/components/footer src/lib/ssr src/lib/http` | **OK**                                                 | 282 pliki, **5283 passed + 48 expected fail**, 0 failed, 171,7 s. W tym `builderRenderer.contentVisibility` 39/39, `staticCssPlugin` 39/39, `minifyStaticCss` 33/33, `viteChunkParity` 11/11                                                                                                              | `vitest.log`                                            |
| 3c  | `verify:static`                                                                                                           | **OK - 15/15 bramek**                                  | 240,8 s (format:check 212,0 s); kontrakt TS↔SQL: 861 RPC / 1381 operacji                                                                                                                                                                                                                                  | `verify-static.log`                                     |
| 4   | `BUNDLE_INVENTORY=1 build:smoke`                                                                                          | **OK**                                                 | 1 min 57 s                                                                                                                                                                                                                                                                                                | `build.log`                                             |
| 5a  | `check:bundle`                                                                                                            | **OK** (ostrzeżenie zapasu < 2%, jak na czubku)        | JS overall **4753,3 / 4772 KB** (zapas 18,7 KB, 0,39%); public 2802,9 / 2877 KB (74,1 KB); największy chunk `index` 261,1 / 286 KB (24,9 KB); CSS 95,4 / 96 KB (**0,6 KB**, 0,59% - stan po P3.7a); public CSS 81,2 / 83 KB (1,8 KB); domknięcie bootu 486,8 KB gz / 1594,5 KB raw, próg 579 KB (92,2 KB) | `check:bundle.log`                                      |
| 5b  | `check:chunks`                                                                                                            | **OK** - graf acykliczny                               | 895 chunków / 6856 krawędzi (jak integ-b2; P3.3 nie dodaje chunków)                                                                                                                                                                                                                                       | `check:chunks.log`                                      |
| 5c  | `check:entry-purity`                                                                                                      | **OK**                                                 | 10 chunków statycznie osiągalnych z `index-BcNDVkEC.js` (jak czubek)                                                                                                                                                                                                                                      | `check:entry-purity.log`                                |
| 5d  | `check:server-entry-purity`                                                                                               | **OK**                                                 | 1814 plików (jak integ-b2)                                                                                                                                                                                                                                                                                | `check:server-entry-purity.log`                         |
| 5e  | `check:dangerous-html`                                                                                                    | **OK**                                                 | 79 sinków: 54 sanityzowanych, **8 literalnych** (+1 = `CvBlock` P3.3), 17 zwolnionych                                                                                                                                                                                                                     | `check:dangerous-html.log`                              |
| 5f  | `check-document-weight.ts` x3                                                                                             | **OK - wszystkie metryki w progach w 3/3 przebiegach** | tabela niżej; `serverOnlyLeaks` puste                                                                                                                                                                                                                                                                     | `docweight-{1,2,3}.log`, `document-weight-{1,2,3}.json` |
| 6a  | `test:e2e:artifact` (NES_ARTIFACT_FIXTURE=1, placeholdery Supabase jak w CI)                                              | **OK - 28/28**                                         | 1,5 min: boot-artifact 3 + boot-home 3 + boot-timing 3 + motion-gate 3 (= 12 dotychczasowych) + legal-links 5 + content-visibility 11. `pageerror #418` w logu = kontrola negatywna detektora (jak w integ-b2)                                                                                            | `e2e.log`                                               |
| 6b  | `content-visibility.boot-home.spec.ts --repeat-each 3`                                                                    | **OK - 33/33**                                         | 2,8 min, 0 flaky                                                                                                                                                                                                                                                                                          | `e2e-cv-repeat3.log`                                    |
| 7   | Współistnienie P3.7a + P3.3 + listwa prawna (HTML artefaktu `/` i `/en`)                                                  | **OK**                                                 | sekcja niżej                                                                                                                                                                                                                                                                                              | `coexist.log`, `oracle-s1.log`, `html/`                 |

Nic nie jest czerwone.

## Waga dokumentu `/` (fixture, 5 próbek HIT na przebieg, 3 przebiegi)

Czubek PR (`d5bd11fb`) nie był mierzony osobno; „czubek (szac.)" = integ-b2 + delta P3.7a wobec bazy (P3.7a mierzone
na tej samej bazie fali). Dla `htmlGzipBytes` / `preLcpTransferBytes` integ-b2 bierze wariant szybki strumienia
(52 852 / 178 027 - wartość deterministyczna według GATES integ-b2), bo scalenie we wszystkich przebiegach ma wariant
szybki (niżej). Delta P3.3 = build8 wobec bazy `52 542` / `177 700` (IMPL).

| Metryka                                                                                                         | Baza fali |  integ-b2 | P3.7a (Δ) | Czubek (szac.) | P3.3 osobno Δ |       Scalenie p1 / p2 / p3 | Δ scalenia wobec czubka | Interakcja | Próg `max` |                    **Zapas** |
| --------------------------------------------------------------------------------------------------------------- | --------: | --------: | --------: | -------------: | ------------: | --------------------------: | ----------------------: | ---------: | ---------: | ---------------------------: |
| htmlRawBytes                                                                                                    |   337 696 |   340 180 |   −13 483 |        326 697 |        +1 062 |                327 759 (x3) |                  +1 062 |      **0** |    406 180 |                   **78 421** |
| htmlGzipBytes                                                                                                   |    52 542 |    52 852 |    −3 619 |         49 233 |          +352 |    49 605 / 49 610 / 49 605 |                +372…377 |     +20…25 |     57 710 |                    **8 100** |
| headRawBytes                                                                                                    |    28 758 |    28 758 |    −2 966 |         25 792 |             0 |                      25 792 |                       0 |          0 |     29 345 |                    **3 553** |
| inlineStyleCount                                                                                                |        25 |        25 |         0 |             25 |            +1 |                          26 |                      +1 |          0 |         50 |                       **24** |
| inlineStyleBytes                                                                                                |    84 717 |    84 717 |   −13 483 |         71 234 |          +129 |                      71 363 |                    +129 |          0 |    135 546 |                   **64 183** |
| **inlineCssCommentBytes**                                                                                       |    5 348* |         - |     → 517 |            517 |             0 |                **517** (x3) |                   **0** |          0 |        517 | **0** (na progu, jak czubek) |
| inlineScriptBytes                                                                                               |    86 617 |    86 617 |         0 |         86 617 |          +241 |                      86 858 |                    +241 |          0 |     98 103 |                   **11 245** |
| inlineExecutableScriptBytes                                                                                     |    79 373 |    79 373 |         0 |         79 373 |          +241 |                      79 614 |                    +241 |          0 |     91 725 |                   **12 111** |
| dehydratedStateBytes                                                                                            |    60 357 |    60 357 |         0 |         60 357 |             0 |                      60 357 |                       0 |          0 |     66 486 |                    **6 129** |
| **bootClosureRawBytes**                                                                                         | 1 636 946 | 1 637 178 |    −4 920 |      1 632 258 |          +550 |              1 632 800 (x3) |                **+542** |         −8 |  1 637 758 |                    **4 958** |
| **bootClosureGzipBytes**                                                                                        |   496 041 |   496 071 |    −1 414 |        494 657 |          +247 |                495 006 (x3) |                **+349** |       +102 |    496 679 |                    **1 673** |
| **bootBurstGzipBytes**                                                                                          |   574 062 |   574 113 |    −2 797 |        571 316 |          +237 |                571 696 (x3) |                **+380** |       +143 |    574 673 |                    **2 977** |
| bootBurstCount                                                                                                  |        26 |        26 |         0 |             26 |             0 |                          26 |                       0 |          0 |         26 |       0 (na progu, jak baza) |
| renderBlockingCssGzipBytes                                                                                      |    80 426 |    80 443 |         0 |         80 443 |             0 |                      80 443 |                       0 |          0 |     81 399 |                      **956** |
| preLcpTransferBytes                                                                                             |   177 700 |   178 027 |    −3 619 |        174 408 |          +352 | 174 780 / 174 785 / 174 780 |                +372…377 |     +20…25 |    181 594 |                    **6 809** |
| modulepreloadCount / preloadedJsCount / preloadedJsGzipBytes                                                    | 0 / 0 / 0 | bez zmian |         0 |              0 |             0 |                   0 / 0 / 0 |                       0 |          0 |  0 / 0 / 0 |                 0 (na progu) |
| linkHeaderEntries / preloadDuplicates / imagePreloadCount                                                       | 5 / 3 / 3 | bez zmian |         0 |      5 / 3 / 3 |             0 |                   5 / 3 / 3 |                       0 |          0 |  5 / 3 / 3 |       0 (na progu, jak baza) |
| documentPreloadDuplicates                                                                                       |         0 |         0 |         0 |              0 |             0 |                           0 |                       0 |          0 |          0 |                            0 |
| imgFetchpriorityHigh / lcpCandidateCount                                                                        |     1 / 1 | bez zmian |         0 |          1 / 1 |             0 |                       1 / 1 |                       0 |          0 |      2 / 2 |                        1 / 1 |
| lcpCandidateMissing / imgEagerNonCandidate / imagePreloadNonCandidate / linkHeaderDisallowed / bootEntryMissing |         0 |         0 |         0 |              0 |             0 |                           0 |                       0 |          0 |          0 |                            0 |

\* `inlineCssCommentBytes` nie istniało w bazie; 5 348 B to pomiar skryptu P3.7a na HTML-u bazy (PROVE P3.7a).

Wnioski:

- **Wszystkie metryki w progach w 3/3 przebiegach.** Najciaśniejsze zapasy bajtowe: `bootClosureGzipBytes` **1 673 B**,
  `renderBlockingCssGzipBytes` 956 B (P3.3 nie rusza), `bootBurstGzipBytes` 2 977 B, `bootClosureRawBytes` 4 958 B.
  Przed scaleniem P3.3 miało na bazie fali tylko 262 B zapasu raw - po P3.7a (−4 920 raw) zapas jest bezpieczny.
- **`inlineCssCommentBytes` = 517 B = próg, bez wzrostu.** Całe 517 B to blok `<style data-content-area>` (S1g
  poza zakresem P3.7a); blok cv P3.3 to 122 B bez komentarzy (bajtowo równy `CV_CSS`).
- **HTML addytywny**: raw dokładnie +1 062 (0 B interakcji), `inlineStyle*`/`inlineScript*` dokładnie jak suma.
  Gzip HTML-u +20…25 B ponad sumę - szum kontekstu kompresji; niezależna kontrola: zdjęcie dodatków P3.3 (blok cv
  - 6 opakowań) z HTML-u scalenia daje −1 046 raw / −344 B gzip (`tools/strip-p33.py`), czyli P3.3 kosztuje na czubku
    tyle samo co na bazie (+352).
- **Domknięcie bootu: raw addytywny (−8 B, inne nazwy po manglingu), gzip +102 B ponad sumę - w całości w chunku
  wejściowym `index`** (pozostałe 9 chunków domknięcia: 0…1 B). Eksperyment na artefaktach (`tools/entry-gzip.mjs`,
  zlib Node jak bramka): wstawienie literału tickera P3.7a do wejścia bazy i wejścia P3.3 zmienia deltę P3.3 o **+5 B**
  (247 → 252) - **P3.3 i minifikacja P3.7a nie wchodzą sobie w drogę**. Ten sam kod z innymi hashami nazw chunków
  różni się w wejściu o 54 B gzip; reszta (~+50 B) to kontekst kompresji z kodem partii 2. Seria bootu: +143 B =
  +102 z wejścia + ~+40 B szumu hashy w ~15 małych chunkach serii (+2…+6 B każdy).
- **Dwa warianty kolejności strumienia SSR (integ-b2) - tu nie wystąpiły**: 15 próbek w 3 przebiegach ma
  `htmlGzipBytes` 49 605-49 610 (rozrzut 5 B = cyfry portu), a 3 zrzuty `/` są identyczne po normalizacji portu
  i wszystkie w wariancie szybkim (1 skrypt `$R[…].next()` przed segmentem `S:c`, wolny ma 4; `stream-variant.log`).
  Przebiegi szły przez mutex (bez równoległego buildu innego agenta), więc wariant wolny pod obciążeniem nie jest tu
  wykluczony - ratchet `htmlGzipBytes` / `preLcpTransferBytes` dalej warto brać z kilku przebiegów (zapas na wariant
  wolny: ~180 B przy zapasie 8 100 / 6 809 B).

### `check:bundle` wobec sumy delt

Overall 4 753,3 KB; suma delt (integ-b2 4 756,7 − P3.7a 5,2 + P3.3 0,5) = 4 752,0 KB → +1,3 KB „nieaddytywności".
To artefakt księgowania hashy, nie nowy kod (`tools/js-gzip.mjs`, `tools/js-hash-noise.mjs`): 767 chunków różni się
od bazy WYŁĄCZNIE hashami importowanych nazw (ten sam raw); w nich każda gałąź osobno „zyskuje" na losowych hashach
(integ-b2 −295 B, P3.7a −1 157 B, P3.3 −791 B), a scalenie tylko −175 B - suma delt liczy ten szum trzy razy
(2 068 B z 2 371 B całej interakcji). Jedyny chunk z interakcją > 20 B to `index` (+98 B, opisane wyżej).

## Krok 7 - współistnienie P3.7a i P3.3, listwa prawna (`html/M{1,2,3}-{home,_en}.html`)

- **Blok cv dokładnie raz**: `CV_CSS` 1x, `<style>` z `[data-cv]` 1x (122 B, 0 B komentarzy, bajtowo `CV_CSS`),
  strażnik `data-cv-off` 1x, w ukrytym `<div hidden>` przed pierwszym opakowaniem - na `/` i `/en`.
- **Opakowania**: 6x `[data-cv]` z `content-visibility:auto` (indeksy sekcji 2-7, rezerwy 468/532/632/532/280/280 px),
  każde bezpośrednim dzieckiem jedynego `[data-lcp-root]`.
- **Bloki P3.7a zminifikowane**: ticker 10 332 B, slider 8 218 B, wyszukiwarka 2 225 B, `data-brand-tokens`
  21 406 B (most 13 740 B) - 0 B komentarzy i 0 znaków nowej linii w każdym. Wyrocznia S1 P3.7a (`oracle-s1.log`)
  **exit 0**: na `/` i `/en` 4/4 bloki bajtowo = wynik `minifyStaticCss` i lightningcss(HTML) == lightningcss(źródło).
  Jedyne komentarze CSS w dokumencie: `<style data-content-area>` (517 B).
- **Listwa prawna stopki - poza obszarem cv**: `<footer data-site-footer>` jest dzieckiem `div[data-site-shell]`,
  bez przodka `[data-cv]`, bez `[data-cv]` w środku, poza `[data-lcp-root]`, za ostatnim opakowaniem w kolejności
  dokumentu. `<nav aria-label="Informacje prawne">` (EN: „Legal information") ma 8 linków w HTML-u SSR (`/regulamin`,
  `/polityka-prywatnosci`, `/zwroty-i-reklamacje`, `/cookies`, `/wytyczne-dotyczace-reklam`,
  `/regulamin-subskrypcji-i-zakupow`, `/rodo`, `/moderacja-komentarzy`; EN z prefiksem `/en`).
  content-visibility jej nie dotyczy; spec `legal-links` 5/5 przechodzi z cv w drzewie (także „Wróć na górę" na
  telefonie po przewinięciu do końca).

## Pliki

- Logi: `typecheck.log`, `vitest.log`, `verify-static.log`, `build.log`, `check:*.log`, `docweight-{1,2,3}.log`,
  `e2e.log`, `e2e-cv-repeat3.log`, `coexist.log`, `oracle-s1.log`, `stream-variant.log`, `entry-gzip.log`, `js-gzip.log`.
- Dane: `document-weight-{1,2,3}.json`, `cmp.tsv`, `html/` (zrzuty `/` i `/en` x3, `M1-home.stripped.html`).
- Narzędzia: `tools/` (`dump-html.ts`, `oracle-s1.ts` - kopie z P3.7a; `coexist.mjs`, `strip-p33.py`,
  `entry-gzip.mjs`, `js-gzip.mjs`, `js-hash-noise.mjs`), `cmp.py`, `chunks.py`, `burst.py`.
