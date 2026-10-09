# P3.3 (fala 3) - dowód pomiarowy (Prove): `content-visibility` ogona sekcji buildera

- Zmiana: worktree `scratchpad/wt3/P3.3`, gałąź `perf/w3-P3.3`, commit `cf0cf8a5` (jedyny nad `d22cf7d6`), drzewo czyste.
- Baza partii 2 fali 3: `scratchpad/base-w3b` (`63a05a32`, `.output` orkiestratora, nieprzebudowywana).
- Build B: **nieprzebudowywany w tym etapie** - `.output` w worktree to build8 implementera
  (`r8/build.log`, `env BUNDLE_INVENTORY=1 bun run build:smoke`, exit 0, koniec 20:55:26), uruchomiony PO ostatniej
  edycji źródeł (`BuilderRenderer.tsx` 20:46:40; żaden śledzony plik poza `reports/*.json` nie jest nowszy), a commit
  21:05 nie zmienił treści (`git status` czyste). Artefakt = kod commitu, więc kolejny build byłby powtórzeniem
  (zgodnie z notatką wznowienia: nie powtarzać pomiarów bez zmiany kodu).
- Kroki ciężkie przez `heavy-bg.sh`, lekkie przez `light.sh`. Dane: `phase3/wave3/P3.3/` (`lh/` = seria A/B
  z artefaktami i księgami, `ab.log`, `document-weight*.json`, `prove/` = logi bramek, `ledsum.txt`, `frames.txt`,
  `lantern-si.txt`, `speedline.txt`, `shifts.txt`, `ledger-diff-*.txt`, `prove/tools/` = skrypty analizy).

## 0. Werdykt w skrócie

| kryterium (PLAN-FALI-3 §2 P3.3 + faza1/PLAN.md P3.3 + notatki orkiestratora)           | wynik                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| zadanie pierwszej klatki Style/Layout (klasa `Style`, flaga L) krótsze we wszystkich B | **TAK, 10/10** - mobile obs. 51-64 → 23-32 ms (sym. 102-128 → <50-63), desktop4x obs. 58-83 → 40-55 ms (blok. 66-116 → 29-59 ms); każde B krótsze od swojej pary i od każdego A                                                            |
| layoutSI (zadania z Layout, Lantern pes.) w dół                                        | **TAK** - mobile mediana 3454 → 2923 ms (−15 %, 5/5 B poniżej min A), desktop4x 1002 → 907 ms (4/5 par w dół)                                                                                                                              |
| CLS ≤ 0,001 i brak pojedynczego przesunięcia > 0,0005 w 10/10                          | **TAK** - CLS 0 i **0 zdarzeń `LayoutShift`** w śladzie w 20/20 przebiegach (A i B)                                                                                                                                                        |
| speedline B bez regresji                                                               | **TAK** - obsSI (speedline Lighthouse'a od navigationStart) mobile mediana 222 → 210 ms, desktop4x 258 → 256 ms; kształt filmstripu ten sam                                                                                                |
| kierunek ΔTBT ≤ 0                                                                      | **TAK (kierunek)** - mobile para −57 ms (MDE(t) 148), desktop4x −49 ms (MDE(t) 134): w szumie                                                                                                                                              |
| e2e: przewinięcie do końca bez przesunięć, kotwica `#id`, przywrócenie przewinięcia    | **TAK** - `test:e2e:artifact` 23/23 (CI-like), w tym 11 testów cv; kotwica `--repeat-each 10` 20/20 i spec cv x3 33/33 z implementacji (ten sam artefakt); „powrót" pokryty asercją dla przeładowania, dla „wstecz" SPA tylko brak cv (§5) |
| `check:document-weight` zielone                                                        | **TAK** 28/28 (B i baza)                                                                                                                                                                                                                   |
| bramki artefaktu                                                                       | zielone; boot +0,3 KB gz / +0,5 KB raw, entry +0,2 KB gz (koszt zmiany, §1.1)                                                                                                                                                              |

**Ocena: `yes`.** Struktura zgodna z planem w każdym przebiegu (pierwsza klatka −45…−59 % obs. na mobile, −6…−46 %
na desktop4x; klasa `Style` znika z TBT mobile w 5/5), a dodatkowo **Speed Index mobile spada istotnie**: para
Δ −0,124 s przy MDE(t) 0,082 s (SI = FCP w 4/5 B; TTI mobile −0,128 s przy MDE(t) 0,112 s). TBT: kierunek zgodny,
wielkość w szumie (inconclusive dla rozmiaru TBT). Plan zakładał −20…−40 % pierwszej klatki i −20…−45 ms
blokowania mobile x4 - zmierzone: pierwsza klatka −50 % obs. (mobile), klasa `Style` w TBT mobile −28…−58 ms
(mediana A 50 → B 0). **needs_fix = false** (uwagi do decyzji orkiestratora w §7: zapas bajtów bootu partii 2,
tanie poprawki m1/m2 z review).

## 1. Bramki

| bramka                                                             | B (P3.3)                                                                          | baza `base-w3b`   | log                                                     |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------- |
| `build:smoke` (`BUNDLE_INVENTORY=1`)                               | zielony (build8 = kod commitu)                                                    | -                 | `r8/build.log`                                          |
| `check:bundle`                                                     | zielony                                                                           | zielony           | `prove/check:bundle.log`, `prove/check-bundle-base.log` |
| `check:chunks`                                                     | zielony (graf acykliczny)                                                         | -                 | `prove/check:chunks.log`                                |
| `check:entry-purity`                                               | zielony (10 chunków bootu z 893)                                                  | -                 | `prove/check:entry-purity.log`                          |
| `check:server-entry-purity`                                        | zielony (1813 plików)                                                             | -                 | `prove/check:server-entry-purity.log`                   |
| `test:e2e:artifact` (CI-like env, `NES_ARTIFACT_FIXTURE=1`, mutex) | **23/23** (12 dotychczasowych + 11 nowych `content-visibility.boot-home.spec.ts`) | 12/12 (stan bazy) | `prove/e2e-artifact.log`                                |
| spec cv `--repeat-each 3` / kotwica `--repeat-each 10`             | 33/33 / 20/20 (implementer, build8 - ten sam artefakt)                            | -                 | `r8/e2e.log`                                            |
| `check-document-weight` (28 metryk)                                | zielony 28/28                                                                     | zielony 28/28     | `document-weight.json`, `document-weight-base.json`     |
| `verify:static`                                                    | zielony, 15 bramek (review, ten sam commit)                                       | -                 | `review-probe/verify-static.log`                        |
| typecheck (`typecheck-noinc.sh`)                                   | zielony (implementer, kod commitu)                                                | -                 | `typecheck2.log`                                        |

### 1.1 `check:bundle` (B vs baza, ten sam skrypt, ta sama maszyna)

| metryka                            | baza                        | B (P3.3)                    | Δ                            |
| ---------------------------------- | --------------------------- | --------------------------- | ---------------------------- |
| overall                            | 4754,4 / 4772 KB            | 4753,7 / 4772 KB            | −0,7 KB                      |
| public                             | 2804,0 / 2877 KB            | 2803,7 / 2877 KB            | −0,3 KB                      |
| admin-only                         | 1950,4 KB                   | 1950,1 KB                   | −0,3 KB                      |
| największy chunk (entry `index-*`) | 262,2 / 286 KB              | 262,4 / 286 KB              | **+0,2 KB**                  |
| CSS (all / public)                 | 95,0 / 81,2 KB              | 95,0 / 81,2 KB              | 0                            |
| boot closure                       | 487,8 KB gz / 1598,6 KB raw | 488,1 KB gz / 1599,1 KB raw | **+0,3 KB gz / +0,5 KB raw** |

Linia B: `Boot closure: 488.1 KB gzip / 1599.1 KB raw  (10 chunków statycznie osiągalnych ze SSR-owego <script>; budget ≤ 579 KB)`.
Lista ruchów (względem `b006c2e`) identyczna jak w bazie poza wejściem: `+131.5 spreadsheet.worker (NOWY)`,
`−45.6 index (354.6 -> 309.0)` (baza `−45.8 … -> 308.8`), `−24.1 lucide-shim.fa`, `+16.5 club._clubSlug.index`,
`+7.5 admin.seo (NOWY)`, `+3.0 i18n-club`, `−2.5 category._slug`, `−2.5 icons-0`, `−2.5 icons-1`,
`−2.4 profile.notifications`, `−2.4 icons-3`, `+2.4 SeoPanel`, `znikł i18n-admin-seo-hub`.

Overall/public spadają (szum nazw hashy, jak w P3.4), ale **entry i boot rosną realnie** - to kod klienta pozycji
(odczyt planu z DOM-u `m4`, pusty `CvBlock` `f4` z `memo`, opakowanie sekcji z inline stylem; sprawdzone w
`.output/public/assets/index-zmkK7Wte.js`: serwerowe `planServerCv`, `CV_SAFE_WIDGET_TYPES`, `CV_CSS`,
`CV_GUARD_SCRIPT` i `isServerRender` są nieobecne w kliencie). Budżety zielone.

### 1.2 Waga dokumentu (`GET /`, fixture, HIT, 5 próbek, mediany; B vs baza)

| metryka                                 |              baza |          B (P3.3) |                      Δ |                         próg |
| --------------------------------------- | ----------------: | ----------------: | ---------------------: | ---------------------------: |
| htmlRawBytes                            |         337 696 B |         338 758 B |               +1 062 B |                     396,7 KB |
| htmlGzipBytes                           |          52 724 B |          52 897 B |                 +173 B |                      56,4 KB |
| headRawBytes                            |           28,1 KB |           28,1 KB |                      0 |                      28,7 KB |
| inlineStyleCount / Bytes                |     25 / 84 717 B |     26 / 84 846 B |            +1 / +129 B |                50 / 132,4 KB |
| inlineScriptBytes (wykonywalne)         | 86 617 (79 373) B | 86 858 (79 614) B |                 +241 B |               95,8 (89,6) KB |
| dehydratedStateBytes                    |           58,9 KB |           58,9 KB |                      0 |                      64,9 KB |
| elementy DOM (próbka)                   |             1 224 |             1 233 | +9 (opakowania + blok) |                            - |
| modulepreloadCount / duplikaty (w dok.) |         0 / 3 (0) |         0 / 3 (0) |                      0 |                        0 / 3 |
| imgFetchpriorityHigh                    |                 1 |                 1 |                      0 |                            2 |
| JS High przy starcie                    |          0 plików |          0 plików |                      0 |                            0 |
| **bootClosureRawBytes**                 |       1 636 946 B |       1 637 496 B |             **+550 B** |    1 637 758 B (zapas 262 B) |
| **bootClosureGzipBytes**                |         496 041 B |         496 288 B |             **+247 B** |      496 679 B (zapas 391 B) |
| bootBurstCount / GzipBytes              |    26 / 574 062 B |    26 / 574 299 B |             0 / +237 B | 26 / 574 673 B (zapas 374 B) |
| renderBlockingCssGzipBytes              |           78,5 KB |           78,5 KB |                      0 |                      79,5 KB |
| preLcpTransferBytes                     |         177 882 B |         178 055 B |                 +173 B |    181 594 B (zapas 3 539 B) |

Progów nie ruszano. HTML +1 062 B raw = ukryty blok (`<style>` druku i wyłącznika + skrypt strażnika) + 6 opakowań
`<div data-cv data-cv-i style=…>`; gzip +173 B.

## 2. Lighthouse A/B (`--compare`, n = 5, fixture, `--third-party fake-gtag`, `--warm-ua bot`, LH 13.5.0)

Seria: `ab.log`, `lh/`. VALID 5/5 na każdej stronie i formie, `excluded=0`; jedna powtórka po `NO_NAVSTART`
(A-desktop4x-4, niewliczona). Wariant dokumentu stały (A 330 641 B, B 331 703 B, `s-maxage=900`), tryb FCP `bez-js`
20/20, pary mieszane 0/5. Po restarcie serwera: A mobile 1/5, desktop4x 0/5; B mobile 1/5, desktop4x 1/5.
Obciążenie przy starcie przebiegów 0,9-2,2 (harness: < 2,4). Księga = audyt TBT w 20/20 (`LEDGER … OK`).

### 2.1 Mediany i DELTA B−A

| forma     | strona | perf | FCP    | LCP    | TBT     | SI        | CLS   | TTI    | mainThread | bootup  | żądania / transfer |
| --------- | ------ | ---- | ------ | ------ | ------- | --------- | ----- | ------ | ---------- | ------- | ------------------ |
| mobile    | A      | 97   | 1,54 s | 2,30 s | 130 ms  | 1,69 s    | 0,000 | 5,45 s | 2922 ms    | 1350 ms | 72 / 915,2 KB      |
| mobile    | B      | 97   | 1,53 s | 2,29 s | 46 ms   | 1,54 s    | 0,000 | 5,35 s | 2657 ms    | 1287 ms | 70 / 915,0 KB      |
| mobile    | Δ      | ±0   | −0,00  | −0,01  | **−84** | **−0,15** | ±0    | −0,10  | −265       | −63     | −2 / −0,2 KB       |
| desktop4x | A      | 90   | 0,46 s | 0,56 s | 257 ms  | 0,64 s    | 0,000 | 1,30 s | 3115 ms    | 1421 ms | 73 / 919,6 KB      |
| desktop4x | B      | 95   | 0,46 s | 0,54 s | 187 ms  | 0,59 s    | 0,000 | 1,24 s | 3224 ms    | 1497 ms | 75 / 920,6 KB      |
| desktop4x | Δ      | +5   | +0,00  | −0,02  | −69     | −0,05     | ±0    | −0,06  | +109       | +76     | +2 / +1,0 KB       |

(Różnice liczby żądań = gtag/pingi i zapytania fixture po boocie w poszczególnych przebiegach; JS bez zmian ±0,2 KB.)

### 2.2 Pary (PAIRS, t(df=4) = 3,72)

| forma     | metryka | Δ (para)     | σΔ      | MDE(t)  | istotne?              |
| --------- | ------- | ------------ | ------- | ------- | --------------------- |
| mobile    | score   | +1,0         | 1,9     | 3,1     | nie                   |
| mobile    | FCP     | −0,018 s     | 0,039 s | 0,065 s | nie                   |
| mobile    | LCP     | −0,034 s     | 0,075 s | 0,125 s | nie                   |
| mobile    | TBT     | −57 ms       | 89 ms   | 148 ms  | nie (kierunek zgodny) |
| mobile    | **SI**  | **−0,124 s** | 0,049 s | 0,082 s | **tak**               |
| mobile    | **TTI** | **−0,128 s** | 0,067 s | 0,112 s | **tak**               |
| desktop4x | score   | +3,4         | 4,9     | 8,1     | nie                   |
| desktop4x | FCP     | −0,027 s     | 0,044 s | 0,074 s | nie                   |
| desktop4x | LCP     | −0,017 s     | 0,027 s | 0,044 s | nie                   |
| desktop4x | TBT     | −49 ms       | 81 ms   | 134 ms  | nie (kierunek zgodny) |
| desktop4x | SI      | −0,041 s     | 0,066 s | 0,109 s | nie                   |
| desktop4x | TTI     | +0,044 s     | 0,217 s | 0,361 s | nie                   |

Odniesienie bazy fali (A/A orkiestratora): mobile σΔ TBT ~120 ms; tu σΔ 89 ms - Δ TBT −57 ms leży w szumie.

### 2.3 Przebiegi

| forma     | strona | perf           | FCP [s]                  | LCP [s]                  | TBT [ms]            | SI [s]                   | load                |
| --------- | ------ | -------------- | ------------------------ | ------------------------ | ------------------- | ------------------------ | ------------------- |
| mobile    | A      | 98/97/95/97/94 | 1,53/1,54/1,60/1,61/1,53 | 2,29/2,30/2,44/2,45/2,29 | 50/130/173/74/204   | 1,67/1,69/1,73/1,61/1,69 | 2,1/1,4/1,9/1,4/2,2 |
| mobile    | B      | 96/98/97/98/97 | 1,54/1,53/1,59/1,52/1,53 | 2,32/2,29/2,42/2,28/2,29 | 145/46/45/20/95     | 1,54/1,53/1,59/1,57/1,53 | 1,9/1,7/1,5/1,6/1,8 |
| desktop4x | A      | 87/90/94/89/93 | 0,45/0,55/0,46/0,55/0,42 | 0,60/0,56/0,55/0,57/0,55 | 309/257/194/273/210 | 0,69/0,64/0,60/0,65/0,56 | 1,4/1,4/1,3/1,0/1,6 |
| desktop4x | B      | 96/96/90/93/95 | 0,42/0,46/0,48/0,50/0,43 | 0,53/0,57/0,53/0,57/0,54 | 160/168/262/221/187 | 0,57/0,56/0,59/0,61/0,61 | 1,1/1,6/1,1/0,9/1,4 |

B-mobile-1 (TBT 145) to jedyny przebieg z `ScriptCatchup` 98 ms blok. - to zadanie i jego rozrzut (A 0/13/86/0/89)
nie zależą od P3.3 (§3.2).

## 3. Księga Lantern per zadanie (`lh/*.ledger.txt`, `prove/ledsum.txt`, `prove/ledger-diff-*.txt`)

### 3.1 Cel: zadanie pierwszej klatki (`Style`, flaga L, obs. < 400 ms)

`obsStart:obsDur/simDur bBlokowanie`; „-" = zadanie < 50 ms sym. (poza listą księgi). Obok: zadania Style z L
w pierwszych 400 ms obs. poza pierwszą klatką.

| przebieg | mobile A        | mobile B                 | desktop4x A       | desktop4x B      | desktop4x B: kolejne klatki z L |
| -------- | --------------- | ------------------------ | ----------------- | ---------------- | ------------------------------- |
| 1        | 132:51,2/102 b0 | 169:26,1/52 b0           | 160:82,8/166 b116 | 134:44,5/89 b39  | 191:27,6/55 b5                  |
| 2        | 129:63,9/128 b0 | 119:26,3/53 b0           | 124:61,6/123 b73  | 112:39,6/79 b29  | 152:28,0/56 b6, 182:26,0/52 b2  |
| 3        | 130:61,0/122 b0 | - (23,4 obs., < 50 sym.) | 103:72,1/144 b94  | 134:43,9/88 b38  | -                               |
| 4        | 125:57,3/115 b0 | 156:31,5/63 b0           | 132:68,6/137 b87  | 138:42,8/86 b36  | 181:24,9/50 b0                  |
| 5        | 126:58,9/118 b0 | 126:27,0/54 b0           | 143:58,1/116 b66  | 128:54,6/109 b59 | -                               |

- **Krótsze we wszystkich B (10/10)**, także względem każdego przebiegu A: mobile max B 63 ms sym. < min A 102 ms;
  desktop4x max B 109 ms sym. (blok. 59) < min A 116 ms sym. (blok. 66).
- Na mobile pierwsza klatka przychodzi przed FCP sym. (blokowanie 0 po obu stronach) - zysk TBT na mobile pochodzi
  z późniejszych zadań (§3.2). Na desktop4x pierwsza klatka jest w oknie TBT: blokowanie mediana A 87 → B 38 ms
  (−49 ms). Część pracy przechodzi do 1-2 kolejnych krótkich klatek (sekcje z cv tuż pod zgięciem desktopu
  renderowane w następnej klatce po ustaleniu bliskości), blokowanie tych klatek 0-8 ms; suma wczesnych Style z L:
  A 116/73/94/87/66 → B 44/37/38/36/59 ms.

Ślad (obserwowane, `prove/frames.txt`, `tools/frames.cjs`): pierwsza pełna klatka i suma pracy układu.

| forma     | strona | pierwsza klatka obs. [ms]                      | w tym UpdateLayoutTree / Layout [ms] | elementy stylu / obiekty układu | suma Layout [ms]            | suma UpdateLayoutTree [ms]  |
| --------- | ------ | ---------------------------------------------- | ------------------------------------ | ------------------------------- | --------------------------- | --------------------------- |
| mobile    | A      | 51,2/63,9/61,0/57,3/58,9 (med 58,9)            | ~21-29 / 19-23                       | 526-561 / 587-847               | 21,1-24,7 (med 23,5)        | 76,9-91,3 (med 85,1)        |
| mobile    | B      | 26,1/26,3/23,4/31,5/27,0 (med 26,3, **−55 %**) | ~13-19 / 6-9                         | 262-368 / 256-405               | 12,1-16,6 (med 14,9, −37 %) | 48,2-62,7 (med 50,6, −41 %) |
| desktop4x | A      | 82,8/61,6/72,1/68,6/58,1 (med 68,6)            | ~23-29 / 22-31                       | 635-672 / 653-699               | 24,3-31,9 (med 24,8)        | 63,2-78,6 (med 70,5)        |
| desktop4x | B      | 44,5/39,6/43,9/42,8/54,6 (med 43,9, **−36 %**) | ~19-24 / 12-18                       | 489-492 / 479-482               | 22,8-32,1 (med 26,1, ±0)    | 62,3-70,0 (med 66,8, −5 %)  |

Audyt `mainthread-work-breakdown`, grupa Style & Layout (per przebieg): mobile A 431/434/418/400/464 (med 431) →
B 269/252/277/254/312 (med 269, **−38 %**); desktop4x A 442/379/351/405/362 (med 379) → B 373/368/358/354/408
(med 368, −3 %). Na desktopie praca układu nie znika, tylko dzieli się na klatki (widok 1350x940 obejmuje więcej
sekcji; review: pominięte są tam tylko sekcje 6-7) - zgodne z uwagą m4 review.

### 3.2 Blokowanie per klasa (TBT, ms, przebiegi 1-5)

| forma     | klasa               | A                        | B                           |
| --------- | ------------------- | ------------------------ | --------------------------- |
| mobile    | **Style**           | 28/50/58/33/53 (med 50)  | **0/0/0/0/0**               |
| mobile    | ScriptCatchup       | 0/13/86/0/89             | 98/19/0/0/0                 |
| mobile    | Script:vendor-react | 17/18/9/7/37 (med 17)    | 24/23/23/20/75 (med 23)     |
| mobile    | Timer               | 5/45/0/0/26              | 17/0/0/0/2                  |
| mobile    | ParseHTML           | 0/0/21/28/0              | 0/0/22/0/0                  |
| desktop4x | **Style**           | 123/79/95/96/75 (med 95) | **46/39/46/39/60 (med 46)** |
| desktop4x | ScriptCatchup       | 107/128/84/154/96        | 85/103/149/86/92            |
| desktop4x | Script:vendor-react | 23/42/10/22/26           | 24/15/26/43/35              |
| desktop4x | ParseHTML           | 20/0/5/0/0               | 0/11/31/41/0                |

- Mobile: zadania `Style` po boocie (obs. ~660-960 ms, przeliczenia stylu całej strony po hydratacji, 19-39 ms obs.)
  **znikają z księgi w 5/5 B** (`ledger-diff-mobile.txt`: status „zniknęło"), bo pominięte poddrzewa nie są
  przeliczane. To jest właściwy zysk TBT pozycji na mobile (−28…−58 ms per przebieg).
- m5 z review (koszt przeniesiony do zadań wysp/hydratacji): `Script:vendor-react` mobile mediana 17 → 23 ms
  (B-5: 75 ms, z czego jedno zadanie 604:23,8 obs. blok. 45); wzrost o ~6 ms mediany jest mniejszy niż spadek
  klasy `Style` (−50 ms mediany) - netto zysk. Na desktop4x bez trendu.
- `ScriptCatchup` (kompilacja/link bootu) i `ParseHTML` - rozrzut po obu stronach bez związku z mechanizmem
  (P3.3 nie zmienia skryptów; HTML +1 KB). ParseHTML desktop4x B 0/11/31/41/0 vs A 20/0/5/0/0: chunkowanie
  parsera zależy od tego, kiedy wypada pierwsza klatka; suma Style + ParseHTML A 143/79/100/96/75 → B
  46/50/77/80/60 - niższa w 5/5.

### 3.3 layoutSI i rozkład Lantern SI (`prove/lantern-si.txt`, `tools/lantern-si.mjs`; SI = max(FCP, a·obsSI + b·layoutSI))

| forma     | strona | SI                       | obsSI (opt.)                  | layoutSI (pes.)                                | FCP pes.  | węzły z Layout |
| --------- | ------ | ------------------------ | ----------------------------- | ---------------------------------------------- | --------- | -------------- |
| mobile    | A      | 1668/1695/1726/1611/1691 | 204/206/230/228/225 (med 222) | 3454/3518/3508/3230/3441 (**med 3454**)        | 1530-1609 | 4-5            |
| mobile    | B      | 1544/1532/1590/1571/1535 | 238/197/182/211/210 (med 210) | 2971/2923/2859/3190/2797 (**med 2923, −15 %**) | 1524-1590 | 6-7            |
| desktop4x | A      | 695/641/596/646/558      | 292/258/237/265/228 (med 258) | 1071/1002/934/1003/868 (**med 1002**)          | 416-551   | 4-6            |
| desktop4x | B      | 571/560/587/609/605      | 268/229/245/266/256 (med 256) | 847/871/908/927/932 (**med 907, −9 %**)        | 417-504   | 6              |

- Mobile: każdy B ma layoutSI niższy niż każdy A (max B 3190 < min A 3230). SI B = FCP w 4/5 (1,4·obsSI + 0,4·layoutSI
  < FCP), stąd istotny spadek SI w parach (−0,124 s).
- Mechanizm spadku (listy węzłów, `LIST=1`): (1) późne zadania z Layout (hydratacja ~4,4 s sym.) są krótsze
  (np. A-mobile-1 78 → B-mobile-1 30 ms sym.), więc mają mniejszą wagę log2 - to realnie mniej pracy;
  (2) pierwsza klatka dzieli się na 2-3 wczesne węzły ≥ 10 ms (kończące się ~1,4-1,5 s sym.), co dodaje wagi
  wczesnym końcom - to efekt ważenia Lantern, nie mniej pracy. Oba działają w tę samą stronę. Uwaga z P3.5
  (wczesna klatka < 10 ms wypada z grafu i podnosi layoutSI) tu nie zachodzi: w B wczesne węzły mają 25-89 ms sym.
- Desktop4x: 4/5 par w dół (1071→847, 1002→871, 934→908, 1003→927), para 5: 868 → 932 (+64). SI desktop para
  −0,041 s - w szumie.

## 4. Speed Index obserwowany (speedline)

obsSI z Lantern = speedline Lighthouse'a liczony od navigationStart (tabela §3.3): mobile mediana 222 → 210 ms
(−12), desktop4x 258 → 256 ms (−2). **Bez regresji.**

Pomocniczy `w3/tools/speedline.cjs` (speedline-core z początkiem = pierwsze zdarzenie śladu, więc z przesunięciem
startu nagrywania; `prove/speedline.txt`):

| forma     | A (SI per przebieg) | med A | B                   | med B | Δ med  |
| --------- | ------------------- | ----- | ------------------- | ----- | ------ |
| mobile    | 271/288/312/317/298 | 298   | 304/263/248/281/278 | 278   | −20 ms |
| desktop4x | 365/339/297/320/282 | 320   | 342/292/329/368/347 | 342   | +22 ms |

Desktop +22 ms w tej mierze jest w rozrzucie przebiegów (282-368) i znika w mierze od navigationStart (obsSI
258 → 256); kształt filmstripu jest ten sam po obu stronach (pierwsza klatka ~67 % → 99 % w 20-45 ms, ostatnia
zmiana ~830-900 ms - ten sam znacznik po boocie). Obserwowane FCP z księgi: mobile mediana 218 → 175 ms,
desktop4x 252 → 230 ms (B wcześniej; pierwsza klatka jest krótsza). Brak nowej późnej zmiany wizualnej w widoku
(sekcja z cv na zgięciu desktopu rysuje się w tej samej sekwencji klatek przed bootem).

## 5. CLS i e2e

- **CLS**: audyt 0,000 w 20/20; **zero zdarzeń `LayoutShift` w śladach** 20/20 (`prove/shifts.txt`) - kryterium
  „≤ 0,001 i brak pojedynczego przesunięcia > 0,0005 w 10/10" spełnione z zapasem (także na A).
- **e2e** (`prove/e2e-artifact.log`, CI-like env, pełna konfiguracja `test:e2e:artifact`, 23/23):
  - HTML serwera: sekcje 0-1 bez cv, ≥ 3 opakowania z `auto`, sekcje w widoku wyrenderowane, na telefonie część
    naprawdę pominięta (telefon i desktop);
  - **przewinięcie kółkiem do końca strony: zero `layout-shift` w obszarze cv** (PerformanceObserver; po fazie
    kurczenia nagłówka zero wpisów w ogóle) - telefon i desktop;
  - **kotwica `#id` w dalszej sekcji trafia w cel**: po wczytaniu (cv włączone; cel tuż pod nagłówkiem, przewinięcie
    o 300 px przesuwa cel o 300 ± 2 px) i przy wejściu z `/#id` (strażnik `html[data-cv-off]`);
  - **przeładowanie w połowie strony**: strażnik zdejmuje cv, przywrócenie przewinięcia trafia w ten sam punkt ± 40 px;
  - powrót „wstecz" po nawigacji SPA: render kliencki bez cv (zero opakowań) - pozycja przywrócenia tylko
    w adnotacji, bo baza na fixture też nie trafia w zapisaną pozycję (problem bazy 3 w IMPL.md; review m3).
    **Kryterium „scroll restoration po powrocie" jest więc twardo pokryte przeładowaniem**, a dla „wstecz"
    dowodem jest brak cv w renderze klienckim (zachowanie identyczne z bazą);
  - druk (`emulateMedia print`): wszystkie opakowania `visible`.
- Powtarzalność (implementer, ten sam artefakt build8): kotwica `--repeat-each 10` 20/20, spec cv `--repeat-each 3`
  33/33, przewinięcie x10 na B i bazie 20/20 i 20/20 (build7).

## 6. Audyty jednego przebiegu mobile (A-mobile-1 vs B-mobile-1, `lh/*-mobile-1.audits.txt`)

| pole                                                              | A                          | B                                                                              |
| ----------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------ |
| element LCP                                                       | `img.eh-img` (`cover.jpg`) | `img.eh-img` (`cover.jpg`) - ten sam we wszystkich 20 przebiegach              |
| LCP: TTFB / opóźnienie ładowania / ładowanie / opóźnienie renderu | 25 / 24 / 30 / 145 ms      | 21 / 23 / 16 / 207 ms                                                          |
| obs. FCP / LCP                                                    | 223 / 223 ms               | 166 / 267 ms (jedyny przebieg z LCP po FCP; mediany obs. LCP A 218 / B 179 ms) |
| CLS                                                               | 0                          | 0                                                                              |
| żądania / transfer                                                | 70 / 914,6 KB              | 70 / 915,0 KB                                                                  |
| High / VeryHigh / Low                                             | 67 (801,8 KB) / 2 / 1      | 67 (802,1 KB) / 2 / 1                                                          |
| High przed obrazem LCP                                            | 112,4 KB                   | 112,4 KB                                                                       |
| arkusz blokujący                                                  | 68,5 KB, „wasted" 458 ms   | 68,5 KB, 462 ms                                                                |
| Style & Layout (mainthread)                                       | 431 ms                     | 269 ms                                                                         |
| Parse HTML & CSS                                                  | 105 ms                     | 164 ms (A 2-5 nie w dumpie; rozrzut parsera, §3.2)                             |

## 7. Ocena wobec kryteriów i uwagi dla orkiestratora

1. **Efekt zgodny z planem co do kierunku i rzędu wielkości struktury**: pierwsza klatka −55 % obs. mobile /
   −36 % desktop (plan: −20…−40 %), klasa `Style` w TBT mobile znika w 5/5 (−28…−58 ms; plan: −20…−45 ms
   blokowania mobile x4). layoutSI w dół (mobile −15 %, 5/5 rozłącznie). Ponad plan: SI mobile −0,124 s istotnie
   (para, MDE 0,082 s), TTI mobile −0,128 s istotnie. TBT: kierunek ≤ 0 na obu formach, wielkość w szumie
   (inconclusive dla rozmiaru TBT). Desktop: zysk ograniczony do pierwszej klatki (suma układu bez zmian) - zgodne
   z review m4; nie jest to regresja.
2. **Bajty bootu partii 2** (decyzja przy scaleniu, nie blokuje pozycji): P3.3 zużywa +550 B raw / +247 B gzip
   domknięcia bootu (entry +0,2 KB gz w `check:bundle`), czyli ~68 % wspólnego zapasu raw (~812 B) i ~39 % gzip
   (~638 B) dzielonego z P3.8 i linkami prawnymi. Po P3.3 zostaje 262 B raw / 391 B gz do progów
   `bootClosureRawBytes` / `bootClosureGzipBytes` (seria bootu 374 B). Implementer odzyskał już 74 B raw / 67 B gz
   (część serwerowa całkowicie poza klientem - potwierdzone w chunku `index-zmkK7Wte.js`); dalsze tanie cięcie po
   stronie klienta jest małe (~37 B raw w symulacji, odrzucone przez implementera z powodu kruchości). Jeśli
   scalenie partii przekroczy próg, droga bez klienckiego kodu (reguły per sekcja w bloku serwera zamiast
   opakowań) wymaga atrybutu na szkielecie strumienia w `sectionStreaming.tsx` - poza listą plików P3.3 (review m6).
3. Tanie poprawki z review do ewentualnej rundy (nie wpływają na wynik pomiaru): m1 - `contain-intrinsic-size: auto
948px` ustawia też szerokość wewnętrzną (pułapka dla przyszłych powłok `grid 1fr`/flex-row; poprawka
   `auto none auto Npx`, kilka bajtów klienta); m2 - sekcje z testem A/B powinny przerywać ogon (tylko serwer, 0 B
   klienta).
4. Bez czerwonych bramek; nic nie jest `red_on_main_too`.
