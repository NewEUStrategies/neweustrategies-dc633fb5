# P3.4 (fala 3) - dowód pomiarowy, runda 2 (po poprawce 9: (b) wycofane, (a) zostaje)

- Zmiana: worktree `scratchpad/wt3/P3.4`, gałąź `perf/w3-P3.4`, commit `0c3db638` (na `c3433c56` ← `c606bfa4`).
  Diff wobec bazy: tylko `src/lib/boot/bootLoaderScript.ts`, jego test i `e2e/boot-home.spec.ts`
  (`bootSet.server.ts` = baza bajt w bajt).
- Baza fali: `scratchpad/base-w3` (`7c924ae5`, `.output` orkiestratora, nieprzebudowywana).
- Build B: `env BUNDLE_INVENTORY=1 bun run build:smoke` przez `heavy-bg.sh` → exit 0 (2 min 7 s), `prove2/build.log`.
- Kroki ciężkie przez mutex (`heavy-bg.sh`), lekkie przez `light.sh`. Dane: `phase3/wave3/P3.4/prove2/`
  (`lh/` = seria A/B z artefaktami i księgami, `*.log`, `document-weight*.json`, `ledsum.txt`, `classsum.txt`,
  `fcpsum.txt`, `speedline.txt`, `burst-tasks.txt`, skrypty `normdiff.py`, `classsum.py`; narzędzia z rundy 1 w `../tools/`).
- Runda 1 dowodu (commit `c3433c56`, (a)+(b)): `../PROVE.md`. Część (a) jest w `0c3db638` identyczna jak w `c3433c56`,
  więc obie serie można łączyć dla (a) (§2.4).

## 0. Werdykt w skrócie

| kryterium (PLAN-FALI-3 §2 P3.4 + notatka orkiestratora)                           | wynik                                                                                                                            |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `Script:(dokument)` z Style/Layout znika z okna albo < 50 ms sym. we wszystkich B | **TAK** - `Script:(dokument)` 0/15 przebiegów B (A: 8/15, w tym 3× z Layout `[Style 78-80%]`, 4× `[Style 23-30%]` 0-18 ms blok.) |
| `ScriptCatchup` dzieli się na zadania < 50 ms sym. albo raport                    | **raport (b) wycofane** - jedno zadanie w 15/15 B (i 15/15 A); seria 26 żądań w jednym zadaniu 15/15 B, jak w bazie              |
| FCP ±0,02 s                                                                       | **TAK** - mobile −0,00, desktop4x −0,02, desktop5x −0,12 s (mediany); para: +0,013 / −0,007 / −0,070 s                           |
| LCP ±0,02 s                                                                       | mobile −0,00, desktop4x +0,01 TAK; **desktop5x +0,03 s** (para +0,022 s, σΔ 0,068, MDE 0,114 → szum)                             |
| CLS ≤ 0,001                                                                       | **TAK** - 0,000 w 30/30                                                                                                          |
| kierunek ΔTBT < 0                                                                 | desktop4x −45 ms (para −27), desktop5x −17 (para +9) TAK/mieszane; **mobile +3 ms** (para +7, MDE 18) - wszystko w szumie        |
| `bun run test:e2e:artifact` (martwy boot = blokujące)                             | **zielone 9/9** (w tym zmieniony `boot-home.spec.ts` pl/en ze strażnikiem kolejności)                                            |
| bramki artefaktu, waga dokumentu                                                  | zielone; **`headRawBytes` −227 B** (28 985 → 28 758 B; zapas do 29 389 B: 404 → 631 B)                                           |

**Ocena: struktura TAK, wielkość efektu NIEROZSTRZYGNIĘTA (w szumie).** Klasa docelowa (wymuszony Style/Layout
w handlerze DCL loadera) zniknęła z księgi we wszystkich 15 przebiegach B; (b) wycofane zgodnie z regułą planu
(przeglądarka linkuje domknięcie wejścia jednym zadaniem). Regresja FCP desktop z rundy 1 (+0,09/+0,10 s) **nie
powtórzyła się**: w tej serii baza miała duży węzeł pierwszej klatki w 10/10 przebiegów desktop, więc oba ramiona
liczą tę samą pracę do FCP; po połączeniu obu serii (n = 10) ΔFCP desktop4x +7 ms, desktop5x +7 ms (§2.4) - czyli
efekt rundy 1 był zależny od kolejności klatka/DCL w danym przebiegu, nie deterministyczny. Wszystkie Δ
TBT/FCP/LCP/SI mieszczą się w MDE. **needs_fix = false.**

## 1. Bramki

| bramka                               | B (P3.4 `0c3db638`)                                                     | baza W3            | log                                                                                                                              |
| ------------------------------------ | ----------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `build:smoke` (`BUNDLE_INVENTORY=1`) | zielony (2 min 7 s)                                                     | (gotowy `.output`) | `build.log`                                                                                                                      |
| `check:bundle`                       | zielony                                                                 | zielony            | `check-bundle.log`, `../check-bundle-base.log`                                                                                   |
| `check:chunks`                       | zielony (893 chunki, 6845 krawędzi, acykliczny)                         | zielony            | `check-chunks.log`                                                                                                               |
| `check:entry-purity`                 | zielony                                                                 | zielony            | `check-entry-purity.log`                                                                                                         |
| `check:server-entry-purity`          | zielony (1813 plików)                                                   | -                  | `check-server-entry-purity.log`                                                                                                  |
| `test:e2e:artifact` (mutex)          | zielony 9/9 (boot-artifact ×3, boot-home pl/en + `now`, boot-timing ×3) | -                  | `e2e-artifact.log`; własna specyfikacja pozycji (`boot-home.spec.ts`) należy do tej konfiguracji - osobnego przebiegu nie trzeba |
| `check-document-weight` (28 metryk)  | zielony 28/28                                                           | zielony 28/28      | `document-weight.json/.log`, `document-weight-base.json/.log`                                                                    |

### 1.1 `check:bundle`

| metryka            | baza W3                     | B (P3.4)                    | Δ                 |
| ------------------ | --------------------------- | --------------------------- | ----------------- |
| overall            | 4752,0 / 4772 KB            | 4752,6 / 4772 KB            | +0,6 KB           |
| public             | 2801,7 / 2877 KB            | 2802,1 / 2877 KB            | +0,4 KB           |
| admin-only         | 1950,2 KB                   | 1950,4 KB                   | +0,2 KB           |
| największy chunk   | 261,2 / 286 KB (`index`)    | 261,2 / 286 KB (`index`)    | 0                 |
| CSS (all / public) | 95,0 / 81,2 KB              | 95,0 / 81,2 KB              | 0                 |
| boot closure       | 486,8 KB gz / 1596,5 KB raw | 486,9 KB gz / 1596,5 KB raw | +0,1 KB gz, raw 0 |

Linia B: `Boot closure: 486.9 KB gzip / 1596.5 KB raw  (10 chunków statycznie osiągalnych ze SSR-owego <script>; budget ≤ 579 KB)`.
Lista ruchów (względem `b006c2e`) identyczna jak w bazie: `+131.5 spreadsheet.worker (NOWY)`, `−46.8 index`,
`−24.1 lucide-shim.fa`, `+16.5 club._clubSlug.index`, `+7.5 admin.seo (NOWY)`, `+3.0 i18n-club`, `−2.5 category._slug`,
`−2.5 icons-0`, `−2.5 icons-1`, `−2.4 profile.notifications`, `−2.4 icons-3`, `+2.4 SeoPanel`, `znikł i18n-admin-seo-hub`.

**+0,6 KB to nie jest efekt zmiany.** Porównanie treści chunków klienta po normalizacji hashy nazw plików
(`normdiff.py`, `.output/public/assets` A vs B): **848 plików identycznych**, 4 różne (`serp` +3 B gz,
`themeDesignCss` −1, `themeFontSizesCss` +1, `eventBrandingDraft` 0) wyłącznie aliasami importów Rollupa; suma
+3 B gz. Literał loadera jest tylko w `.output/server/_ssr/router-*.mjs`. Hash wejścia zmienił się kaskadowo
(`index-BsLjjLsH` → `index-BLxTOEN-`, ten sam co w rundzie 1), a z nim ~850 nazw plików i odwołań; +0,6 KB to suma
±1 B gzip przez inne ciągi hashy. Zero bajtów logiki klienta - realnie overall/public/entry/boot się nie pogarszają
(zapas overall 19,4 KB).

### 1.2 Waga dokumentu (`GET /`, fixture, HIT; mediany)

| metryka                          | baza W3        | B (P3.4)       | Δ          | próg               |
| -------------------------------- | -------------- | -------------- | ---------- | ------------------ |
| htmlRawBytes                     | 337 923 B      | 337 696 B      | −227 B     | 396,7 KB           |
| htmlGzipBytes                    | 52 606 B       | 52 545 B       | −61 B      | 56,4 KB            |
| **headRawBytes**                 | 28 985 B       | 28 758 B       | **−227 B** | 28,7 KB (29 389 B) |
| inlineStyleCount / Bytes         | 25 / 84 717 B  | 25 / 84 717 B  | 0          | 50 / 132,4 KB      |
| inlineScriptBytes                | 86 844 B       | 86 617 B       | −227 B     | 95,8 KB            |
| inlineExecutableScriptBytes      | 79 600 B       | 79 373 B       | −227 B     | 89,6 KB            |
| dehydratedStateBytes             | 60 357 B       | 60 357 B       | 0          | 64,9 KB            |
| modulepreloadCount               | 0              | 0              | 0          | 0                  |
| preloadDuplicates / w dokumencie | 3 / 0          | 3 / 0          | 0          | 3 / 0              |
| linkHeaderEntries                | 5              | 5              | 0          | 5                  |
| imgFetchpriorityHigh             | 1              | 1              | 0          | 2                  |
| JS High przy starcie             | 0 plików       | 0 plików       | 0          | 0                  |
| bootClosureRawBytes              | 1 634 852 B    | 1 634 852 B    | 0          | 1599,4 KB          |
| bootClosureGzipBytes             | 495 036 B      | 495 097 B      | +61 B      | 485,0 KB           |
| preLcpTransferBytes              | 177 733 B      | 177 672 B      | −61 B      | 177,3 KB           |
| bootBurstCount / GzipBytes       | 26 / 572 652 B | 26 / 572 716 B | 0 / +64 B  | 26 / 561,2 KB      |
| renderBlockingCssGzipBytes       | 80 395 B       | 80 395 B       | 0          | 79,5 KB            |
| lcpCandidateCount / Missing      | 1 / 0          | 1 / 0          | 0          | 2 / 0              |

Literał loadera 2733 → 2506 B, zestaw bez `g` (identyczny z bazą) → −227 B w `<head>` (zapas `headRawBytes`
0,4 → 0,6 KB). +61/+64 B gz domknięcia/serii = inne ciągi hashy (§1.1). Progów nie ruszano (ratchet w dół należy
do właściciela plików wagi dokumentu).

## 2. Lighthouse A/B (`--compare`, n = 5, fixture, `--third-party fake-gtag`, `--warm-ua bot`, LH 13.5.0)

Seria: `ab.log`, `lh/`. **VALID 5/5** na każdej stronie i formie, `excluded=0`; 3 powtórki po błędzie
`NO_NAVSTART` (A-desktop4x-3, B-desktop4x-5, B-desktop5x-5) - powtórzone, nie liczone. Wariant dokumentu stały
(A 330 868 B, B 330 641 B, `s-maxage=900`), tryb FCP `bez-js` 30/30, pary mieszane 0/15, księga = audyt TBT w
30/30 (`LEDGER ... OK`). Po restarcie serwera: A mobile 1/5, desktop4x 0/5, desktop5x 2/5; B 1/5 w każdej formie.
Obciążenie (loadavg przy przebiegu) 0,8-2,2, wszystkie < 2,4.

### 2.1 Mediany i DELTA B−A

| forma     | strona | perf | FCP    | LCP    | TBT    | SI     | CLS   | TTI    | mainThread | bootup  | żądania / transfer |
| --------- | ------ | ---- | ------ | ------ | ------ | ------ | ----- | ------ | ---------- | ------- | ------------------ |
| mobile    | A      | 96   | 1,53 s | 2,30 s | 145 ms | 1,66 s | 0,000 | 5,34 s | 3087 ms    | 1357 ms | 70 / 913,5 KB      |
| mobile    | B      | 96   | 1,53 s | 2,30 s | 148 ms | 1,63 s | 0,000 | 5,44 s | 3194 ms    | 1406 ms | 70 / 913,5 KB      |
| mobile    | Δ      | ±0   | −0,00  | −0,00  | +3     | −0,03  | ±0    | +0,10  | +107       | +49     | ±0 / +0,0          |
| desktop4x | A      | 88   | 0,51 s | 0,57 s | 288 ms | 0,66 s | 0,000 | 1,34 s | 3296 ms    | 1682 ms | 75 / 919,2 KB      |
| desktop4x | B      | 91   | 0,49 s | 0,57 s | 243 ms | 0,71 s | 0,000 | 1,42 s | 3269 ms    | 1609 ms | 73 / 918,6 KB      |
| desktop4x | Δ      | +3   | −0,02  | +0,01  | −45    | +0,05  | ±0    | +0,08  | −27        | −73     | −2 / −0,6 (gtag)   |
| desktop5x | A      | 79   | 0,55 s | 0,55 s | 479 ms | 0,81 s | 0,000 | 1,73 s | 4223 ms    | 1983 ms | 73 / 918,5 KB      |
| desktop5x | B      | 80   | 0,43 s | 0,58 s | 462 ms | 0,71 s | 0,000 | 1,46 s | 4066 ms    | 1967 ms | 73 / 918,6 KB      |
| desktop5x | Δ      | +1   | −0,12  | +0,03  | −17    | −0,10  | ±0    | −0,27  | −157       | −16     | ±0 / +0,0          |

### 2.2 Pary (PAIRS, t(df=4) = 3,72)

| forma     | metryka | Δ (para) | σΔ      | MDE(t)  | istotne? |
| --------- | ------- | -------- | ------- | ------- | -------- |
| mobile    | TBT     | +7 ms    | 11 ms   | 18 ms   | nie      |
| mobile    | FCP     | +0,013 s | 0,038 s | 0,063 s | nie      |
| mobile    | LCP     | +0,052 s | 0,077 s | 0,127 s | nie      |
| mobile    | SI      | −0,052 s | 0,116 s | 0,193 s | nie      |
| desktop4x | TBT     | −27 ms   | 75 ms   | 124 ms  | nie      |
| desktop4x | FCP     | −0,007 s | 0,019 s | 0,032 s | nie      |
| desktop4x | LCP     | +0,006 s | 0,021 s | 0,035 s | nie      |
| desktop4x | SI      | +0,016 s | 0,054 s | 0,089 s | nie      |
| desktop5x | TBT     | +9 ms    | 62 ms   | 102 ms  | nie      |
| desktop5x | FCP     | −0,070 s | 0,121 s | 0,201 s | nie      |
| desktop5x | LCP     | +0,022 s | 0,068 s | 0,114 s | nie      |
| desktop5x | SI      | −0,076 s | 0,101 s | 0,168 s | nie      |

Referencja A/A z fali 2: mobile σΔ TBT ≈ 121 ms, MDE(t) ≈ 252 ms. Żadna Δ nie przekracza MDE.

### 2.3 Przebiegi

| forma     | strona | perf           | FCP [ms]                 | LCP [ms]                 | TBT [ms]            | SI [ms]                  | loadavg             |
| --------- | ------ | -------------- | ------------------------ | ------------------------ | ------------------- | ------------------------ | ------------------- |
| mobile    | A      | 97/98/95/96/96 | 1531/1535/1528/1539/1636 | 2289/2296/2281/2300/2319 | 132/61/174/152/145  | 1657/1689/1858/1544/1636 | 1,8/1,2/1,5/1,0/0,8 |
| mobile    | B      | 96/97/96/96/95 | 1534/1521/1528/1618/1630 | 2295/2275/2286/2439/2451 | 146/83/170/148/151  | 1626/1614/1626/1628/1630 | 1,6/1,3/1,4/1,1/1,0 |
| desktop4x | A      | 95/88/84/88/90 | 506/576/479/512/479      | 561/576/533/566/582      | 183/299/366/288/268 | 630/748/735/624/659      | 0,9/1,4/1,9/1,8/1,6 |
| desktop4x | B      | 89/91/89/92/92 | 473/568/460/526/488      | 572/580/572/551/573      | 283/243/272/236/235 | 714/713/734/684/630      | 0,9/0,8/2,2/1,8/1,5 |
| desktop5x | A      | 82/79/79/78/88 | 530/596/548/502/555      | 555/614/567/532/555      | 416/478/485/524/297 | 810/831/757/812/737      | 1,2/1,2/1,1/1,6/2,2 |
| desktop5x | B      | 80/82/79/79/83 | 432/495/687/391/379      | 582/583/702/542/522      | 462/417/472/501/392 | 655/708/838/780/584      | 1,1/1,4/1,2/1,4/1,6 |

### 2.4 Obie serie razem dla (a) (runda 1 `c3433c56` + runda 2 `0c3db638`; A = ta sama baza; n = 10 na stronę)

Część (a) loadera jest w obu commitach identyczna; runda 1 miała dodatkowo (b), które nie zmieniało FCP/LCP
(seria i wejście 4-16 ms obs. później, po FCP). Mediany z 10 przebiegów (niesparowane):

| forma     | FCP A → B (Δ)       | LCP A → B (Δ)       | TBT A → B (Δ)      | SI A → B (Δ)        |
| --------- | ------------------- | ------------------- | ------------------ | ------------------- |
| mobile    | 1537 → 1534 (−2 ms) | 2298 → 2297 (−1 ms) | 139 → 150 (+11 ms) | 1642 → 1637 (−5 ms) |
| desktop4x | 479 → 486 (+7 ms)   | 563 → 572 (+9 ms)   | 272 → 255 (−17 ms) | 631 → 674 (+43 ms)  |
| desktop5x | 539 → 546 (+7 ms)   | 561 → 595 (+34 ms)  | 482 → 467 (−15 ms) | 796 → 740 (−56 ms)  |

- FCP: regresja desktop z rundy 1 (+0,09/+0,10 s) po połączeniu serii znika (+7 ms) - zgodnie z mechanizmem z
  `../PROVE.md` §4 zależy od tego, czy w danym przebiegu bazy pierwsza klatka przyszła przed DCL; w tej serii tak
  było w 10/10 przebiegów desktop bazy (duży węzeł pierwszego Paint w grafie FCP Lantern: A 10/10, B 7/10,
  `fcpsum.txt`), w rundzie 1 w 6/10. Produkcja ma pierwszą klatkę przed DCL w 6/6 śladach (IMPL-fix9 §2).
- LCP desktop5x: +0,03 s w obu seriach (mediany +35 / +27 ms), ale sparowane Δ z 10 par: średnia +14,5 ms,
  mediana +28,5 ms, SD ≈ 80 ms (t ≈ 0,57) - nieistotne; rozrzut pojedynczych przebiegów 478-717 ms. W B przy małym
  węźle pierwszego Paint (B-desktop5x-1/4/5, FCP 379-432 ms) LCP pes. dolicza dużą klatkę Style (opt/pes 478/565,
  517/567, 560/603) - ta sama praca, inne położenie w grafie. Desktop4x (×4) +9 ms - w kryterium.

## 3. Księga Lantern per zadanie (`lh/*.ledger.txt`, `ledsum.txt`, `classsum.txt`)

### 3.1 Cel (a): `Script:(dokument)` (handler DCL loadera z odczytem geometrii)

Kolumny: `obsStart:blokowanie/simDur` (L = zadanie z Layout); „Style<400” = zadanie pierwszej klatki (Style+Layout).

| przebieg | mobile `Script:(dok)`      | mobile Style<400     | desktop4x `Script:(dok)` | desktop4x Style<400    | desktop5x `Script:(dok)`  | desktop5x Style<400    |
| -------- | -------------------------- | -------------------- | ------------------------ | ---------------------- | ------------------------- | ---------------------- |
| A-1      | **158:0/104L** [Style 79%] | -                    | -                        | 137:48/173L            | **255:12/62** [Style 30%] | 139:128/178L           |
| A-2      | **132:0/102L** [Style 78%] | -                    | **243:0/50** [Style 28%] | 135:121/171L           | -                         | 133:126/176L           |
| A-3      | -                          | 131:0/122L           | -                        | 151:89/139L            | -                         | 136:140/190L, 247:7/57 |
| A-4      | **141:0/101L** [Style 80%] | -                    | -                        | 114:80/130L            | **227:18/68** [Style 23%] | 132:122/172L           |
| A-5      | **237:0/53** [Style 25%]   | 140:0/86L, 199:0/76L | -                        | 132:76/126L            | **210:5/55** [Style 28%]  | 123:113/163L           |
| B-1      | -                          | 160:0/122L           | -                        | 146:88/138L            | -                         | 128:111/161L           |
| B-2      | -                          | 117:0/103L           | -                        | 139:88/138L            | -                         | 141:113/163L           |
| B-3      | -                          | 135:0/111L           | -                        | 150:84/134L            | -                         | 151:146/196L           |
| B-4      | -                          | 133:0/130L           | -                        | 129:84/134L            | -                         | 159:139/189L           |
| B-5      | -                          | 160:0/137L           | -                        | 142:33/83L, 198:13/63L | -                         | 145:110/160L           |

- **`Script:(dokument)`: A 8/15 przebiegów, B 0/15** (we wszystkich formach). W A: 3× pełny wymuszony układ
  (`L`, Style 78-80%, 101-104 ms sym.; na mobile przed FCP, więc 0 ms blokowania) i 5× sam przeliczony styl treści
  sparsowanej po pierwszej klatce (Style 23-30%, 50-68 ms sym., blokowanie 0/0/12/18/5 ms). Kryterium „znika z okna”
  spełnione w 15/15 B.
- Praca pierwszej klatki (Style<400) zostaje - to koszt rozmiaru dokumentu i CSS, nie loadera. Suma wczesnego
  Style+Layout (`Script:(dok)` + Style<400), blokowanie: desktop4x A 48/121/89/80/76 (med 80) vs B 88/88/84/84/46
  (med 84); desktop5x A 140/126/147/140/118 (med 140) vs B 111/113/146/139/110 (med 113); mobile 0 vs 0.

### 3.2 Blokowanie per klasa (mediany z 5 przebiegów; pełne wartości w `classsum.txt`)

| klasa               | mobile A → B               | desktop4x A → B                     | desktop5x A → B                        |
| ------------------- | -------------------------- | ----------------------------------- | -------------------------------------- |
| ScriptCatchup       | 38 → 19                    | 99 → 103                            | 138 → 147                              |
| Style               | 50 → 38                    | 83 → 94                             | 138 → 138                              |
| Script:vendor-react | 23 → 24                    | 43 → 36                             | 65 → 63                                |
| Timer:index         | 11 → 15                    | 7 → 0                               | 8 → 18                                 |
| Script:(dokument)   | 0 → 0 (A 4/5 obecne, 0 ms) | 0 → 0 (A 1/5)                       | **5 → 0** (A 12/0/0/18/5, B 0/0/0/0/0) |
| Timer:(dokument)    | 0 → 0                      | 0 → 0 (A 0/0/14/0/21, B 1/0/0/26/0) | 0 → 0 (A 30/6/0/0/0, B 0/0/0/2/0)      |

### 3.3 `ScriptCatchup` i seria `modulepreload` (po wycofaniu (b))

| przebieg | mobile A   | mobile B              | desktop4x A           | desktop4x B          | desktop5x A             | desktop5x B |
| -------- | ---------- | --------------------- | --------------------- | -------------------- | ----------------------- | ----------- |
| 1        | 564:38/180 | 505:30/133, 948:24/74 | 539:82/132            | 571:130/180          | 601:123/173, 1071:15/79 | 518:149/199 |
| 2        | 458:0/136  | 414:19/149            | 573:95/145            | 553:87/137, 993:5/59 | 542:218/268, 1004:0/50  | 569:139/189 |
| 3        | 461:86/155 | 516:26/155            | 607:120/170           | 555:118/168          | 525:118/173             | 571:223/273 |
| 4        | 523:46/189 | 534:7/137             | 457:99/149, 630:38/97 | 509:87/137           | 524:236/286             | 573:125/175 |
| 5        | 560:2/134  | 512:14/150            | 511:99/149            | 502:103/153          | 507:109/187             | 526:147/197 |

- Bootowy `ScriptCatchup` (linkowanie domknięcia wejścia) jest **jednym zadaniem w 15/15 B i 15/15 A** (drugie,
  późne `ScriptCatchup` ≥ 948 ms to inne moduły, po boocie). Przeglądarka scala - zgodnie z regułą planu (b) jest
  wycofane, raport w rundzie 1 (`../PROVE.md` §3.2) i IMPL-fix9 §0.
- Seria (`burst-tasks.txt`): **26 żądań `modulepreload` + wejście w jednym zadaniu w 15/15 B** (jak w 15/15 A),
  czas zadania B 4,7-19,1 ms obs. vs A 5,7-17,8 ms; start serii (obs., med) mobile 304 → 290 ms, desktop4x 329 → 315,
  desktop5x 316 → 327 - szum. Wycofanie (b) potwierdzone w śladach.

## 4. Speed Index obserwowany (speedline, `speedline.txt`)

| forma     | A (5 przebiegów)    | med A | B (5 przebiegów)    | med B | Δ med |
| --------- | ------------------- | ----- | ------------------- | ----- | ----- |
| mobile    | 335/289/331/314/304 | 314   | 308/296/323/316/339 | 316   | +2    |
| desktop4x | 381/356/366/330/355 | 356   | 391/364/368/355/359 | 364   | +8    |
| desktop5x | 388/386/385/330/331 | 385   | 297/403/389/383/307 | 383   | −2    |

obsSI bez zmiany ponad rozrzut (±30-50 ms). SI Lantern: mobile −0,03 s, desktop4x +0,05 s, desktop5x −0,10 s
(pary −0,052 / +0,016 / −0,076, wszystkie < MDE); kierunek niespójny - (a) nie jest dźwignią SI w harnessie.

## 5. Audyty jednego przebiegu mobile (`lh/A-mobile-1.audits.txt`, `lh/B-mobile-1.audits.txt`)

| pozycja                                 | A-mobile-1                                         | B-mobile-1                              |
| --------------------------------------- | -------------------------------------------------- | --------------------------------------- |
| żądania / transfer                      | 70 / 913,5 KB                                      | 70 / 913,5 KB                           |
| High przed obrazem LCP                  | 112,3 KB                                           | 112,3 KB                                |
| element LCP                             | `img.eh-img` (`/cover.jpg`), priorityHinted, eager | to samo                                 |
| TTFB / load delay / load / render delay | 22 / 31 / 12 / 184 ms                              | 19 / 29 / 12 / 196 ms                   |
| render-blocking                         | `styles-*.css` 68,5 KB, wasted 458 ms              | to samo, 459 ms                         |
| bootup total / `vendor-react` / `/`     | 1357 / 1245 / 811 ms                               | 1406 / 1334 / 868 ms                    |
| najdłuższe zadania                      | 180 (Unattr.), 137, 104 (`/`), 104 (`/`)           | 133 (Unattr.), 122 (`/`), 120, 76 (`/`) |
| CLS                                     | 0,000                                              | 0,000                                   |

Lista żądań identyczna co do kolejności i priorytetów (różnice tylko w hashach nazw plików).

## 6. Ocena wobec kryteriów

1. **(a) K4i - struktura spełniona.** Handler DCL bez geometrii: klasa `Script:(dokument)` 0/15 w B (A 8/15).
   Wymuszony Style+Layout nie jest już wykonywany w zadaniu loadera; ta sama praca pierwszej klatki zostaje w
   zadaniu `Style` (koszt dokumentu/CSS - dźwignia to P3.3/P5.x, nie loader). Wielkość efektu na TBT/SI
   nierozstrzygnięta: desktop5x `Script:(dokument)` 5 → 0 ms blokowania (mediana), suma wczesnego Style+Layout
   desktop5x 140 → 113 ms, desktop4x 80 → 84 ms; ΔTBT desktop4x −45 / desktop5x −17 / mobile +3 ms - wszystko
   w szumie.
2. **(b) wycofane** zgodnie z regułą planu i notatki orkiestratora; ślady potwierdzają jedno zadanie serii i jedno
   `ScriptCatchup` (jak w bazie). Bez martwego kodu grup w `<head>`.
3. **FCP ±0,02 s - spełnione w tej serii** (mobile −0,00, desktop4x −0,02, desktop5x −0,12 s); połączone serie:
   +7 ms na obu formach desktop. Problem z rundy 1 był zależny od kolejności klatka/DCL w przebiegu bazy.
4. **LCP**: mobile i desktop4x w ±0,02 s; desktop5x +0,03 s (mediana; para +0,022 s przy MDE 0,114; obie serie
   razem: sparowana średnia +14,5 ms, t ≈ 0,57) - w szumie, do odnotowania przy bramce fali.
5. **CLS 0** w 30/30; żądania, transfer, priorytety, element LCP bez zmian.
6. **Bramki**: wszystkie zielone; `check:bundle` +0,6 KB to hash-szum (848/852 chunki identyczne po normalizacji,
   +3 B gz realnej różnicy z aliasów Rollupa); `headRawBytes` −227 B; e2e artefaktu 9/9.

Werdykt: `effect_matches_plan = yes` dla struktury (klasa docelowa znikła we wszystkich przebiegach B, (b) wycofane
wg reguły), wielkość efektu (TBT/FCP/LCP/SI) **nierozstrzygnięta - w szumie**. `needs_fix = false`.

## 7. Komendy

```sh
S=/tmp/claude-0/-home-user-neweustrategies-dc633fb5/57088803-e7ea-5e89-8c05-954276daf4ba/scratchpad; Q=$S/phase3/wave3/P3.4/prove2
cd $S/wt3/P3.4 && $S/heavy-bg.sh $Q/build.log env BUNDLE_INVENTORY=1 bun run build:smoke
cd $S/wt3/P3.4 && $S/heavy-bg.sh $Q/e2e-artifact.log bun run test:e2e:artifact
for g in check:bundle check:chunks check:entry-purity check:server-entry-purity; do $S/light.sh bun run $g > $Q/$(echo $g|tr : -).log 2>&1; done
cd $S/wt3/P3.4 && $S/light.sh node scripts/performance/check-document-weight.ts --json $Q/document-weight.json
cd $S/base-w3  && $S/light.sh node scripts/performance/check-document-weight.ts --json $Q/document-weight-base.json
python3 -I $Q/normdiff.py $S/base-w3/.output/public/assets $S/wt3/P3.4/.output/public/assets      # §1.1
cd $S/base-w3 && $S/heavy-bg.sh $Q/ab.log env LIGHTHOUSE_CLI=$S/tools/node_modules/lighthouse/cli/index.js \
  CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node scripts/performance/lighthouse-local.mjs \
  --compare $S/base-w3 $S/wt3/P3.4 --runs 5 --forms mobile,desktop4x,desktop5x --label w3-P3.4 --out $Q/lh \
  --client-backend fixture --third-party fake-gtag --save-artifacts --warm-ua bot
python3 -I $S/phase3/wave3/P3.4/tools/ledsum.py $Q/lh > $Q/ledsum.txt                               # §3.1, §3.3
python3 -I $Q/classsum.py $Q/lh > $Q/classsum.txt                                                  # §3.2
LHCORE=$S/tools/node_modules/lighthouse/core node $S/phase3/wave3/P3.4/tools/fcpsum.mjs $Q/lh/[AB]-*.artifacts   # §2.4
python3 -I $S/phase3/wave3/P3.4/tools/groups.py $Q/lh/*/trace.json > $Q/burst-tasks.txt            # §3.3
cd $S/tools && SL=$S/tools/node_modules/speedline-core node $S/w3/tools/speedline.cjs <trace.json>  # §4
```
