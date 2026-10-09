# P3.4 (fala 3) - dowód pomiarowy (Prove)

- Zmiana: worktree `scratchpad/wt3/P3.4`, gałąź `perf/w3-P3.4`, commit `c3433c56` (na `c606bfa4`).
- Baza fali: `scratchpad/base-w3` (`7c924ae5`, `.output` z orkiestratora, nieprzebudowywana).
- Build B: `env BUNDLE_INVENTORY=1 bun run build:smoke` przez `heavy-bg.sh` → exit 0 (2 min 6 s), preset `node-server`
  jak w bazie (`build.log`).
- Wszystkie kroki ciężkie przez mutex (`heavy-bg.sh`), lekkie przez `light.sh`. Dane: `phase3/wave3/P3.4/`
  (`lh/` = seria A/B z artefaktami i księgami, `*.log`, `document-weight*.json`, `fcpgraph.txt`, `speedline.txt`,
  `burst-tasks.txt`, `tools/` = skrypty analizy).

## 0. Werdykt w skrócie

| kryterium (PLAN-FALI-3 §2 P3.4 + notatka orkiestratora)                           | wynik                                                                                                           |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `Script:(dokument)` z Style/Layout znika z okna albo < 50 ms sym. we wszystkich B | **TAK** - 0/15 przebiegów B (A: 5/15, blokowanie 0-113 ms)                                                      |
| ... ale czy praca znika                                                           | **NIE** - ten sam Style+Layout ląduje w zadaniu pierwszej klatki (`Style`, 15/15 B), blokowanie bez spadku      |
| `ScriptCatchup` dzieli się na zadania < 50 ms sym.                                | **NIE** - jedno zadanie w 15/15 B (desktop4x 92-180 ms, desktop5x 160-561 ms blok.); przeglądarka scala         |
| FCP ±0,02 s                                                                       | mobile TAK (−0,00 s); **desktop4x +0,09 s, desktop5x +0,10 s (mediana) - NIE** (mechanizm Lantern, §4)          |
| LCP ±0,02 s                                                                       | mobile TAK (±0,00); desktop4x +0,02 s (granica; para Δ +0,012 s przy σΔ 0,007); desktop5x +0,04 s (para +0,008) |
| CLS ≤ 0,001                                                                       | TAK - 0 we wszystkich 30 przebiegach                                                                            |
| kierunek ΔTBT < 0                                                                 | **NIE** - mobile +72 ms (para +36), desktop4x +21 (para +1), desktop5x −22 (para −11); wszystko w szumie        |
| `bun run test:e2e:artifact`                                                       | zielone 9/9 (w tym zmieniony `boot-home.spec.ts`)                                                               |
| bramki artefaktu, waga dokumentu                                                  | zielone; `headRawBytes` −106 B (28 985 → 28 879 B)                                                              |

**Ocena: `partly`.** Struktura (a) zgodna z kryterium literalnie (klasa `Script:(dokument)` zniknęła), ale - jak
prognozował implementer (IMPL §0 pkt 2) - wymuszony Style+Layout nie znika, tylko przechodzi do zadania pierwszej klatki;
TBT bez spadku, a na desktopie Lantern liczy teraz to zadanie do FCP (+~90 ms FCP sym.). (b) nie dzieli
`ScriptCatchup` (reguła orkiestratora: wycofać (b)); (b) dzieli za to zadanie wstawiania serii (`Timer:(dokument)`,
§3.3) - informacja do decyzji. **needs_fix = true** (wycofanie (b) wg reguły + decyzja w sprawie regresji FCP
desktop z (a), §6).

## 1. Bramki

| bramka                               | B (P3.4)                                                                   | baza W3       | uwagi                                                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------ |
| `build:smoke` (`BUNDLE_INVENTORY=1`) | zielony                                                                    | -             | `build.log`                                                                                            |
| `check:bundle`                       | zielony                                                                    | zielony       | liczby niżej                                                                                           |
| `check:chunks`                       | zielony (893 chunki, 6845 krawędzi, acykliczny)                            | zielony       | `check-chunks.log`                                                                                     |
| `check:entry-purity`                 | zielony                                                                    | zielony       | `check-entry-purity.log`                                                                               |
| `check:server-entry-purity`          | zielony (1813 plików)                                                      | -             | `check-server-entry-purity.log`                                                                        |
| `test:e2e:artifact` (mutex)          | zielony 9/9 (boot-artifact, boot-timing, boot-home pl/en z asercjami grup) | -             | `e2e-artifact-prove.log`; własna specyfikacja pozycji (`boot-home.spec.ts`) należy do tej konfiguracji |
| `check-document-weight` (28 metryk)  | zielony 28/28                                                              | zielony 28/28 | `document-weight.json`, `document-weight-base.json`                                                    |

### 1.1 `check:bundle` (B vs baza zmierzona tym samym skryptem)

| metryka            | baza W3                     | B (P3.4)                    | Δ                 |
| ------------------ | --------------------------- | --------------------------- | ----------------- |
| overall            | 4752,0 / 4772 KB            | 4752,6 / 4772 KB            | +0,6 KB           |
| public             | 2801,7 / 2877 KB            | 2802,1 / 2877 KB            | +0,4 KB           |
| admin-only         | 1950,2 KB                   | 1950,4 KB                   | +0,2 KB           |
| największy chunk   | 261,2 / 286 KB              | 261,2 / 286 KB              | 0                 |
| CSS (all / public) | 95,0 / 81,2 KB              | 95,0 / 81,2 KB              | 0                 |
| boot closure       | 486,8 KB gz / 1596,5 KB raw | 486,9 KB gz / 1596,5 KB raw | +0,1 KB gz, raw 0 |

Linia B: `Boot closure: 486.9 KB gzip / 1596.5 KB raw  (10 chunków statycznie osiągalnych ze SSR-owego <script>; budget ≤ 579 KB)`.
Lista ruchów (względem `b006c2e`) identyczna jak w bazie: `+131.5 spreadsheet.worker (NOWY)`, `−46.8 index`,
`−24.1 lucide-shim.fa`, `+16.5 club._clubSlug.index`, `+7.5 admin.seo (NOWY)`, `+3.0 i18n-club`, `−2.5 category._slug`,
`−2.5 icons-0`, `−2.5 icons-1`, `−2.4 profile.notifications`, `−2.4 icons-3`, `+2.4 SeoPanel`, `znikł i18n-admin-seo-hub`.

**Skąd +0,6 KB, skoro zmiana jest tylko serwerowa.** Literał loadera jest wyłącznie w `.output/server/_ssr/router-*.mjs`
(grep `function J(){for` w `.output/public/assets` = 0). Porównanie treści chunków klienta po normalizacji hashy nazw
plików: identyczne wszystkie poza 4 (`serp`, `themeDesignCss`, `themeFontSizesCss`, `eventBrandingDraft`), które różnią
się wyłącznie aliasami importów (`import{f as v,a as C,...}` - niedeterminizm nazw eksportów Rollupa) o −1…+3 B gz;
hash wejścia zmienił się kaskadowo (`index-BsLjjLsH` → `index-BLxTOEN-`), a z nim 851 nazw plików i odwołań do nich.
+0,6 KB = suma ±1 B gzip w ~850 plikach przez inne ciągi hashy. Nie jest to efekt zmiany (zero bajtów logiki
klienta), budżety zielone, zapas overall 19,4 KB. Zmiana nie pogarsza realnie overall/public/entry/boot.

### 1.2 Waga dokumentu (`GET /`, fixture, HIT, 5 próbek; B vs baza)

| metryka                        | baza W3          | B (P3.4)         | Δ          | próg               |
| ------------------------------ | ---------------- | ---------------- | ---------- | ------------------ |
| htmlRawBytes                   | 337 923 B        | 337 817 B        | −106 B     | 396,7 KB           |
| htmlGzipBytes                  | 52 611 B         | 52 624 B         | +13 B      | 56,4 KB            |
| **headRawBytes**               | 28 985 B         | 28 879 B         | **−106 B** | 28,7 KB (29 389 B) |
| inlineStyleBytes               | 84 717 B         | 84 717 B         | 0          | 132,4 KB           |
| inlineScriptBytes              | 86 844 B         | 86 738 B         | −106 B     | 95,8 KB            |
| inlineExecutableScriptBytes    | 79 600 B         | 79 482 B         | −118 B     | 89,6 KB            |
| dehydratedStateBytes           | 58,9 KB          | 58,9 KB          | 0          | 64,9 KB            |
| modulepreloadCount / duplikaty | 0 / 3 (0 w dok.) | 0 / 3 (0 w dok.) | 0          | 0 / 3              |
| imgFetchpriorityHigh           | 1                | 1                | 0          | 2                  |
| JS High przy starcie           | 0 plików         | 0 plików         | 0          | 0                  |
| bootClosureGzipBytes (dok.)    | 495 036 B        | 495 097 B        | +61 B      | 485,0 KB           |
| preLcpTransferBytes            | 177 738 B        | 177 751 B        | +13 B      | 177,3 KB           |
| bootBurstCount / Gzip          | 26 / 572 652 B   | 26 / 572 716 B   | 0 / +64 B  | 26 / 561,2 KB      |
| renderBlockingCssGzipBytes     | 78,5 KB          | 78,5 KB          | 0          | 79,5 KB            |

Loader −118 B (2733 → 2615 B), zestaw `,"g":[10,19]` +12 B → netto −106 B w `<head>` (zapas `headRawBytes`
0,4 → 0,5 KB). Progów nie ruszano (ratchet w dół należy do właściciela plików wagi dokumentu). +13 B gzip i +61/+64 B
gz domknięcia = inne ciągi hashy (§1.1).

## 2. Lighthouse A/B (`--compare`, n = 5, fixture, `--third-party fake-gtag`, `--warm-ua bot`, LH 13.5.0)

Seria: `ab.log`, `lh/summary.json`. VALID 5/5 na każdej stronie i formie, `excluded=0`; 2 powtórki po błędzie
`NO_NAVSTART` (B-desktop4x-4, A-desktop5x-4) - przebiegi powtórzone, nie liczone. Wariant dokumentu stały
(A 330 868 B, B 330 762 B, `s-maxage=900`), tryb FCP `bez-js` 30/30, pary mieszane 0. Po restarcie serwera:
A 1/5 każda forma, B mobile 1/5, desktop4x 0/5, desktop5x 2/5. Obciążenie: desktop5x B miało loadavg 1,52-2,38
(A 1,26-1,90) - B-desktop5x-4 (2,25) to odstający przebieg (`ScriptCatchup` 561 ms blok.).

### 2.1 Mediany i DELTA B−A

| forma     | strona | perf | FCP       | LCP    | TBT    | SI     | CLS   | TTI    | mainThread | bootup  |
| --------- | ------ | ---- | --------- | ------ | ------ | ------ | ----- | ------ | ---------- | ------- |
| mobile    | A      | 97   | 1,54 s    | 2,30 s | 98 ms  | 1,64 s | 0,000 | 5,39 s | 3012 ms    | 1315 ms |
| mobile    | B      | 96   | 1,53 s    | 2,30 s | 170 ms | 1,74 s | 0,000 | 5,38 s | 3160 ms    | 1432 ms |
| mobile    | Δ      | −1   | −0,00     | −0,00  | +72    | +0,10  | ±0    |        | +148       | +117    |
| desktop4x | A      | 91   | 0,39 s    | 0,54 s | 245 ms | 0,62 s | 0,000 | 1,33 s | 3289 ms    | 1546 ms |
| desktop4x | B      | 90   | 0,49 s    | 0,56 s | 267 ms | 0,65 s | 0,000 | 1,30 s | 3395 ms    | 1687 ms |
| desktop4x | Δ      | −1   | **+0,09** | +0,02  | +21    | +0,03  | ±0    |        | +107       | +141    |
| desktop5x | A      | 78   | 0,50 s    | 0,58 s | 509 ms | 0,78 s | 0,000 | 1,61 s | 4339 ms    | 2007 ms |
| desktop5x | B      | 79   | 0,60 s    | 0,61 s | 487 ms | 0,74 s | 0,000 | 1,58 s | 4143 ms    | 1982 ms |
| desktop5x | Δ      | +1   | **+0,10** | +0,04  | −22    | −0,04  | ±0    |        | −196       | −25     |

Żądania i transfer bez zmian (mobile 70 / 913,5 → 913,6 KB; desktop5x +2 żądania = gtag/pingi w jednym przebiegu).

### 2.2 Pary (PAIRS, t(df=4) = 3,72)

| forma     | metryka | Δ (para) | σΔ      | MDE(t)  | istotne?                                 |
| --------- | ------- | -------- | ------- | ------- | ---------------------------------------- |
| mobile    | TBT     | +36 ms   | 78 ms   | 130 ms  | nie                                      |
| mobile    | FCP     | −0,000 s | 0,054 s | 0,089 s | nie                                      |
| mobile    | LCP     | −0,002 s | 0,105 s | 0,175 s | nie                                      |
| mobile    | SI      | +0,139 s | 0,281 s | 0,467 s | nie                                      |
| desktop4x | TBT     | +1 ms    | 43 ms   | 71 ms   | nie                                      |
| desktop4x | FCP     | +0,047 s | 0,058 s | 0,096 s | nie (ale mechanizm deterministyczny, §4) |
| desktop4x | LCP     | +0,012 s | 0,007 s | 0,011 s | **tak (na granicy)**                     |
| desktop4x | SI      | +0,019 s | 0,049 s | 0,082 s | nie                                      |
| desktop5x | TBT     | −11 ms   | 116 ms  | 194 ms  | nie                                      |
| desktop5x | FCP     | +0,062 s | 0,151 s | 0,251 s | nie                                      |
| desktop5x | LCP     | +0,008 s | 0,098 s | 0,163 s | nie                                      |
| desktop5x | SI      | −0,004 s | 0,084 s | 0,140 s | nie                                      |

Referencja A/A z fali 2: mobile σΔ TBT ≈ 121 ms, MDE(t) ≈ 252 ms. Wszystkie Δ TBT są głęboko w szumie.

### 2.3 Przebiegi

| forma     | strona | perf           | FCP [ms]                 | LCP [ms]                 | TBT [ms]            | SI [ms]                  | loadavg                  |
| --------- | ------ | -------------- | ------------------------ | ------------------------ | ------------------- | ------------------------ | ------------------------ |
| mobile    | A      | 94/97/97/98/95 | 1549/1609/1516/1539/1532 | 2321/2442/2266/2301/2293 | 219/97/98/44/193    | 1884/1643/1572/1640/1545 | 2,30/1,78/1,62/1,57/1,31 |
| mobile    | B      | 94/96/94/96/97 | 1540/1534/1525/1615/1528 | 2303/2298/2275/2453/2285 | 218/170/201/133/109 | 1661/1643/1739/1854/2083 | 1,92/1,79/1,72/1,77/1,15 |
| desktop4x | A      | 92/89/84/91/91 | 463/391/391/392/537      | 565/538/541/535/568      | 231/276/359/239/245 | 608/621/707/633/607      | 1,04/1,18/1,09/1,19/1,33 |
| desktop4x | B      | 92/86/88/93/90 | 544/477/485/402/499      | 573/541/561/547/584      | 232/332/300/223/266 | 638/688/653/630/664      | 1,08/0,99/1,06/0,96/1,75 |
| desktop5x | A      | 78/81/76/77/80 | 499/554/668/468/396      | 576/554/689/575/547      | 509/444/575/579/470 | 769/782/859/813/626      | 1,52/1,26/1,48/1,90/1,80 |
| desktop5x | B      | 79/82/79/73/83 | 606/599/479/612/597      | 606/613/522/626/611      | 488/400/487/769/379 | 809/744/737/811/728      | 1,74/1,52/1,92/2,25/2,38 |

Księga = audyt TBT w 30/30 przebiegach (`LEDGER ... OK`).

## 3. Księga Lantern per zadanie (`lh/*.ledger.txt`, `tools/ledsum.py`)

### 3.1 Cel (a): `Script:(dokument)` z Style/Layout (wymuszony układ w handlerze DCL loadera)

Kolumny: `obsStart:blokowanie/simDur` (L = zadanie z Layout). „Style < 400" = samodzielne zadanie Style/Layout przed
bootem (pierwsza klatka).

| przebieg | desktop4x `Script:(dok)` | desktop4x Style<400    | desktop5x `Script:(dok)` | desktop5x Style<400                 | mobile `Script:(dok)` | mobile Style<400      |
| -------- | ------------------------ | ---------------------- | ------------------------ | ----------------------------------- | --------------------- | --------------------- |
| A-1      | -                        | 119:90/140L            | -                        | 167:102/152L                        | -                     | 181:0/133L            |
| A-2      | **149:69/119L**          | -                      | -                        | 138:130/180L                        | -                     | 134:0/111L            |
| A-3      | -                        | 187:104/154L           | -                        | 157:169/219L                        | **129:0/136L**        | -                     |
| A-4      | -                        | 134:20/70L, 190:41/91L | -                        | 154:52/102L, 210:79/129L, 264:11/61 | **132:0/110L**        | -                     |
| A-5      | -                        | 123:27/133L            | **132:113/163L**         | -                                   | **135:0/111L**        | -                     |
| B-1      | -                        | 129:61/139L            | -                        | 161:126/176L, 255:4/54              | -                     | 151:0/114L, 225:1/51L |
| B-2      | -                        | 131:93/143L            | -                        | 135:112/162L                        | -                     | 149:0/141L            |
| B-3      | -                        | 129:105/155L           | -                        | 154:102/152L                        | -                     | 144:0/116L            |
| B-4      | -                        | 139:23/73L, 197:33/83L | -                        | 146:113/163L                        | -                     | 131:0/141L            |
| B-5      | -                        | 152:98/148L            | -                        | 139:107/157L                        | -                     | 121:0/107L            |

- `Script:(dokument)` z Style 80-81%: A 5/15 przebiegów (desktop4x 69 ms, desktop5x 113 ms, mobile 3× 0 ms blok.),
  **B 0/15** - kryterium „znika z okna" spełnione.
- W pozostałych 10/15 przebiegach A pierwsza klatka przychodzi PRZED DCL i ten sam Style+Layout jest już zadaniem
  `Style` - B robi to zawsze. Suma blokowania wczesnego Style+Layout (`Script:(dok)` + Style<400):
  desktop4x A 90/69/104/61/27 (med 69) vs B 61/93/105/56/98 (med 93); desktop5x A 102/130/169/142/113 (med 130) vs
  B 130/112/102/113/107 (med 112); mobile 0 vs 0-1. **Praca nie znika - przenosi się** (zgodnie z modelem K4i
  implementera, IMPL §0 pkt 2). Klasa `Style` per przebieg: desktop4x A med 69 → B med 100, desktop5x 153 → 122,
  mobile 65 → 42.

### 3.2 Cel (b): `ScriptCatchup` (linkowanie domknięcia wejścia)

| przebieg | mobile A              | mobile B    | desktop4x A | desktop4x B | desktop5x A            | desktop5x B             |
| -------- | --------------------- | ----------- | ----------- | ----------- | ---------------------- | ----------------------- |
| 1        | 570:108/164           | 502:148/198 | 532:96/146  | 517:106/156 | 530:217/267            | 571:163/213             |
| 2        | 528:0/233             | 482:90/140  | 553:102/152 | 540:180/230 | 534:121/171            | 226:24/74, 539:136/186  |
| 3        | 510:0/185             | 476:67/223  | 570:103/153 | 502:115/165 | 537:172/222, 706:10/69 | 521:241/291             |
| 4        | 498:0/151             | 535:20/159  | 497:115/165 | 597:100/150 | 569:129/182            | 560:561/611 (load 2,25) |
| 5        | 516:41/153, 970:10/60 | 501:56/169  | 498:122/172 | 523:92/142  | 500:121/171            | 540:204/254             |

- Bootowy `ScriptCatchup` jest **jednym zadaniem w 15/15 przebiegach B** (blokowanie ≥ 20 ms, na desktopie zawsze
  > 50 ms sym.). Seria grupami NIE dzieli linkowania domknięcia wejścia - potwierdza sondę implementera (IMPL §3).
  > (Wczesne `ScriptCatchup` 226:24 w B-desktop5x-2 to inne zadanie, przed serią.)
- Grupy działają mechanicznie (`burst-tasks.txt`, `tools/groups.py` na śladach): w B żądania serii powstają w
  **3 osobnych zadaniach 10 / 9 / 7** w 15/15 przebiegach B, od startu pierwszej do startu ostatniej grupy 4-16 ms obs.; w A jedno zadanie z 26 żądaniami.
- Mobile: blokowanie `ScriptCatchup` A med 0 (108/0/0/0/41; klasa z drugim zadaniem: 108/0/0/0/51) vs B med 67 (148/90/67/20/56). To efekt
  okna TBT, nie dłuższego zadania (obs. dur. A 38-58 ms, B 35-56 ms): start symulowany `ScriptCatchup` w B jest
  później (A 1330-1543, med 1416 ms; B 1418-1619, med 1526 ms), więc mniejsza część zadania wypada przed oknem
  [FCP 1,53 s, TTI]. W grafie TTI węzeł zależy tylko od dokumentu; przesuwa go kolejka CPU przed nim (w B-mobile-4
  m.in. zadanie pierwszej klatki z Layout 70,7 ms obs.) - przypisanie do (a) albo (b) nierozstrzygnięte
  (`tools/beforecatchup.mjs`).

### 3.3 Uboczny efekt (b): zadanie wstawiania serii (`Timer:(dokument)`)

Czas zadań, w których powstają żądania serii (`burst-tasks.txt`, obs. ms):

| forma     | A: jedno zadanie (26 żądań)    | B: trzy zadania (10/9/7), max per przebieg |
| --------- | ------------------------------ | ------------------------------------------ |
| mobile    | 5,5 / 9,9 / 8,7 / 5,3 / 9,1    | 6,0 / 3,7 / 3,7 / 3,6 / 4,2                |
| desktop4x | 9,8 / 6,2 / 5,9 / 8,5 / 9,8    | 3,9 / 11,2 / 11,0 / 10,5 / 4,2             |
| desktop5x | 13,6 / 25,9 / 9,7 / 27,3 / 4,6 | 6,2 / 2,9 / 6,5 / 5,8 / 4,2                |

W księdze desktop5x A ma to zadanie jako `Timer:(dokument)` > 50 ms sym. w 3/5 przebiegów (blokowanie 18 / 80 / 86 ms,
klasa: A 18/80/0/86/0, B 0/0/0/0/0). Na desktop4x i mobile (×4) zadanie A ma < 12,5 ms obs., czyli < 50 ms sym. -
tam (b) nic nie zmienia w TBT. Czyli (b) dzieli zadanie WSTAWIANIA serii (nie kompilacji); zysk tylko przy dławieniu
≥ ×5 i tylko, gdy wstawianie trwa > 10 ms obs. Koszt: wejście wstawione 4-16 ms obs. później (A: w tym samym zadaniu
co seria).

## 4. Dlaczego FCP desktop rośnie o ~0,09 s (graf FCP Lantern, `fcpgraph.txt`, `tools/fcpsum.mjs`)

Lantern buduje graf FCP z: dokumentu, arkusza blokującego, pierwszego ParseHTML, **pierwszego zadania z Layout i
pierwszego zadania z Paint** (`getRenderBlockingNodeData`). Gdy handler DCL wymusza układ (A), zadanie z pierwszym
Paint jest małe (układ już czysty) i FCP sym. = koniec arkusza. Gdy układ robi klatka (B zawsze, A gdy klatka
przed DCL), zadanie pierwszego Paint niesie pełny Style+Layout i wchodzi do FCP:

| przebieg         | FCP sym.            | węzeł pierwszego Paint (obs.@start dur → sim) | koniec CSS (sim) |
| ---------------- | ------------------- | --------------------------------------------- | ---------------- |
| A-desktop4x-1    | 463                 | 119: 70,1 → 140                               | 394              |
| A-desktop4x-2    | 391                 | 128: 2,0 → 4                                  | 391              |
| A-desktop4x-3    | 391                 | 147: 3,1 → 6                                  | 391              |
| A-desktop4x-4    | 392                 | 134: 35,1 → 70                                | 389              |
| A-desktop4x-5    | 537                 | 123: 66,7 → 133                               | 396              |
| B-desktop4x-1    | 544                 | 129: 69,4 → 139                               | 398              |
| B-desktop4x-2    | 477                 | 131: 71,7 → 143                               | 405              |
| B-desktop4x-3    | 485                 | 129: 77,4 → 155                               | 394              |
| B-desktop4x-4    | 402                 | 139: 36,5 → 73                                | 396              |
| B-desktop4x-5    | 499                 | 152: 74,0 → 148                               | 408              |
| A-desktop5x-1..5 | 499/554/668/468/396 | 60,8 / 72,2 / 87,4 / 40,7 / **2,3** ms obs.   | 354-415          |
| B-desktop5x-1..5 | 606/599/479/612/597 | 70,5 / 64,8 / 60,8 / 65,2 / 62,9 ms obs.      | 391-422          |

- Duży węzeł pierwszego Paint: A 6/10 przebiegów desktop, **B 10/10**. Mediana FCP sym. desktop4x 392 → 485 ms,
  desktop5x 499 → 599 ms. LCP (bez-js) dziedziczy część przesunięcia (desktop4x LCP opt/pes A med ~541, B ~561).
- Obserwowane FCP prawie bez zmian (desktop4x obs. med A 253 → B 262 ms; mobile 236 → 229 ms) - to skutek modelu
  Lantern, nie wolniejszego malowania. Na mobile FCP wyznacza arkusz (koniec CSS ≈ FCP), więc węzeł klatki się nie
  liczy (Δ FCP mobile 0).
- Produkcja: w zapisanym LHR desktop z produkcji (`lighthouse/prod-desktop.json.gz`, 2026-10-03) obs. FCP 3690 ms <
  obs. DCL 3706 ms - pierwsza klatka przychodzi PRZED DCL (dokument strumieniowany z prawdziwym TTFB), czyli w
  produkcji układ i tak robi klatka i K4i prawdopodobnie jest tam obojętne dla FCP sym. To pojedynczy, starszy LHR
  (sprzed fali 2) - wskazówka, nie dowód.

## 5. Speed Index obserwowany (speedline, `speedline.txt`)

| forma     | A (5 przebiegów)    | med A | B (5 przebiegów)    | med B | Δ med  |
| --------- | ------------------- | ----- | ------------------- | ----- | ------ |
| mobile    | 382/306/275/285/316 | 306   | 345/348/319/332/481 | 345   | +39 ms |
| desktop4x | 351/321/426/293/326 | 326   | 349/353/370/349/377 | 353   | +27 ms |
| desktop5x | 405/397/391/362/287 | 391   | 393/340/370/352/362 | 362   | −29 ms |

Rozrzut przebiegów (±50-100 ms) większy niż różnice; kierunek niespójny między formami - bez efektu ponad szum.
SI Lantern: mobile +0,10 s (para +0,139, MDE 0,467), desktop4x +0,03 (para +0,019, MDE 0,082), desktop5x −0,04.

## 6. Ocena wobec kryteriów i co dalej (runda poprawek)

1. **(b) - wycofać wg reguły orkiestratora** („jeśli (b) nie dzieli `ScriptCatchup`, zostaw (a) i wycofaj (b)"):
   `ScriptCatchup` jedno zadanie w 15/15 B; przeglądarka linkuje domknięcie wejścia jednym zadaniem niezależnie od
   podziału żądań. Wycofanie wg IMPL §0 pkt 1: przestać emitować `g` w `composeBootSet` (`bootSet.server.ts`);
   kod `J` w loaderze bez `g` robi jedną grupę (może zostać albo zniknąć: −~90 B `<head>`).
   **Informacja do decyzji:** (b) ma jeden zmierzony zysk uboczny - usuwa `Timer:(dokument)` (wstawianie 26
   `modulepreload` + wejścia) z księgi desktop5x (A 3/5 przebiegów, 18/80/86 ms blok.; B 0/5); przy ×4 bez znaczenia.
   Jeśli orkiestrator uzna to za wartość, (b) można zostawić w obecnym kształcie (koszt: wejście 4-16 ms obs.
   później, +12 B zestawu).
2. **(a) - spełnia literę kryterium, nie spełnia celu.** `Script:(dokument)` z Style/Layout 0/15 w B, ale Style+Layout
   ląduje w zadaniu pierwszej klatki; TBT bez spadku (kierunek ΔTBT nie jest < 0 na mobile i desktop4x), a na
   desktopie Lantern dolicza to zadanie do FCP: **FCP desktop4x +0,09 s, desktop5x +0,10 s (mediana) - kryterium
   FCP ±0,02 s niezaliczone; LCP desktop4x +0,02 s (para +0,012 s, istotne na granicy MDE)**. Mechanizm w §4 jest
   deterministyczny (zależy od kolejności klatka/DCL), więc nie zniknie przy większym n. W produkcji (klatka przed
   DCL) efekt jest prawdopodobnie zerowy w obie strony. Decyzja orkiestratora: (i) przyjąć (a) jako porządkowe
   (mniej bajtów, brak wymuszonego układu w handlerze, brak `MutationObserver`) z udokumentowanym kosztem FCP sym. w
   harnessie desktop; albo (ii) przywrócić pomiar pola w handlerze DCL (stan bazy) i zostawić tylko usunięcie
   `MutationObserver` oraz oszczędność bajtów. Wariantu z mniejszym zadaniem klatki nie da się uzyskać w loaderze -
   koszt Style+Layout to rozmiar dokumentu/CSS (P3.3, P5.x).
3. Bez regresji: CLS 0 (30/30), żądania/transfer bez zmian, `test:e2e:artifact` 9/9, bramki statyczne zielone,
   `headRawBytes` −106 B.

## 7. Komendy

```sh
S=/tmp/claude-0/-home-user-neweustrategies-dc633fb5/57088803-e7ea-5e89-8c05-954276daf4ba/scratchpad; P=$S/phase3/wave3/P3.4
cd $S/wt3/P3.4 && $S/heavy-bg.sh $P/build.log env BUNDLE_INVENTORY=1 bun run build:smoke
for g in check:bundle check:chunks check:entry-purity check:server-entry-purity; do $S/light.sh bun run $g; done
cd $S/base-w3 && $S/light.sh bun run check:bundle                      # porównanie bazy tym samym skryptem
cd $S/wt3/P3.4 && $S/heavy-bg.sh $P/e2e-artifact-prove.log bun run test:e2e:artifact
node scripts/performance/check-document-weight.ts --json $P/document-weight.json        # w wt3/P3.4 i base-w3
cd $S/base-w3 && $S/heavy-bg.sh $P/ab.log env LIGHTHOUSE_CLI=… CHROME_PATH=… node scripts/performance/lighthouse-local.mjs \
  --compare $S/base-w3 $S/wt3/P3.4 --runs 5 --forms mobile,desktop4x,desktop5x --label w3-P3.4 --out $P/lh \
  --client-backend fixture --third-party fake-gtag --save-artifacts --warm-ua bot
python3 $P/tools/ledsum.py $P/lh                                           # tabele §3.1-3.2
LHCORE=$S/tools/node_modules/lighthouse/core node $P/tools/fcpsum.mjs $P/lh/[AB]-*.artifacts   # §4
python3 $P/tools/groups.py $P/lh/*/trace.json                              # §3.3
SL=… node $S/w3/tools/speedline.cjs <trace.json>                           # §5
```
