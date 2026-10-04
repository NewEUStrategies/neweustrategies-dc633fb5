| obs start / czas [ms] | L | klasa | d4: sym · blok opt/pes/śr | d4c3: sym · blok opt/pes/śr | d5: sym · blok opt/pes/śr | d5c3: sym · blok opt/pes/śr | właściciel | oczek. sym. po poprawce |
|---|---|---|---|---|---|---|---|---|
| 37 / 30.5 |  | K1 nav | 122 · 0/0/0 | 122 · 0/0/0 | 153 · 0/0/0 | 153 · 0/0/0 | nieprzypisane (platforma) | ~153 ms (bez zmian) |
| 93 / 40.8 |  | K4 ParseHTML dokumentu | 163 · 0/0/0 | 163 · 113/113/113 | 204 · 0/0/0 | 204 · 154/154/154 | P2.5 + P2.6 (pakiet dokumentu) | ~122 ms (x0,6 (reguła planu)) |
| 165 / 16.3 |  | K4 ParseHTML dokumentu | 65 · 0/0/0 | 65 · 15/15/15 | 82 · 0/0/0 | 82 · 32/32/32 | P2.5 + P2.6 (pakiet dokumentu) | ~49 ms (x0,6 (reguła planu)) |
| 196 / 33.4 | L | K5 pierwsza klatka | 67 · 0/0/0 | 67 · 17/17/17 | 83 · 0/0/0 | 83 · 33/33/33 | P2.5/P2.6; warunkowo P3.3 | ~57 ms (x0,69 (zmierzony pakiet no-JS)) |
| 241 / 42.5 | L | K6 druga klatka | 85 · 0/0/0 | 85 · 35/35/35 | 106 · 56/56/56 | 106 · 56/56/56 | P2.2 (sectionStreaming) + P3.3 | ~64 ms (x0,6) |
| 289 / 32.9 |  | K7 ScriptCatchup | 131 · 81/81/81 | 131 · 81/81/81 | 164 · 114/114/114 | 164 · 114/114/114 | P3.4 (+ objętość P5.1/P5.2) | ~54 ms (x0,33 (podział na 3 grupy)) |
| 332 / 24.3 |  | K8 start animacji CSS | 97 · 47/47/47 | 97 · 47/47/47 | 121 · 71/71/71 | 121 · 71/71/71 | P2.4 (g) + P1.2 (styles.css w W1); ticker P2.3 | ~0 ms (0 (zadanie znika)) |
| 356 / 20.6 |  | K9 przebieg korzenia | 83 · 33/33/33 | 83 · 33/33/33 | 103 · 53/53/53 | 103 · 53/53/53 | P1.7 (+ P5.2 trasy) | ~69 ms (x0,67 (reguła planu)) |
| 384 / 13.8 |  | K10 hydrateStart: createRouter | 55 · 5/5/5 | 55 · 5/5/5 | 69 · 19/19/19 | 69 · 19/19/19 | P5.2 (powłoki tras); P1.7 (router.tsx) | ~48 ms (x0,7) |
| 502 / 105.0 | L | K12 commit hydratacji + efekty pasywne + re-render sync | 210 · 160/160/160 | 210 · 160/160/160 | 262 · 212/212/212 | 262 · 212/212/212 | P2.2 (+ P1.7, P2.3, P2.4) | ~131 ms (x0,5 (wyspy, podział; zachować Layout)) |
| 607 / 34.4 | L | K13 styl nagłówka | 69 · 19/19/19 | 69 · 19/19/19 | 86 · 36/36/36 | 86 · 36/36/36 | P1.2 | ~0 ms (0 (brak zapisu przy montażu)) |
| 717 / 10.1 |  | K14 plaster Reacta po commicie | - | - | 51 · 1/1/1 | 51 · 1/1/1 | P2.2 (+ P2.4 f) | ~26 ms (x0,5) |
| 840 / 16.9 |  | K14 plaster Reacta po commicie | 67 · 0/17/8 | 67 · 0/17/8 | 84 · 0/34/17 | 84 · 0/34/17 | P2.2 (+ P2.4 f) | ~42 ms (x0,5) |
| 914 / 12.3 |  | K14 plaster Reacta po commicie | - | - | 62 · 0/12/6 | 62 · 0/12/6 | P2.2 (+ P2.4 f) | ~31 ms (x0,5) |
| 929 / 13.8 |  | K14 plaster Reacta po commicie | 55 · 0/5/2 | 55 · 0/5/2 | 69 · 0/19/10 | 69 · 0/19/10 | P2.2 (+ P2.4 f) | ~34 ms (x0,5) |
| 949 / 11.5 |  | K11 timer startu | - | - | 58 · 0/8/4 | 58 · 0/8/4 | P1.7 (+ P9.1/P5.2 mapDeps) | ~29 ms (x0,5 (podział ciała)) |
| 990 / 11.5 |  | K14 plaster Reacta po commicie | - | - | 58 · 0/8/4 | 58 · 0/8/4 | P2.2 (+ P2.4 f) | ~29 ms (x0,5) |
| 1004 / 11.0 |  | K14 plaster Reacta po commicie | - | - | 55 · 0/5/2 | 55 · 0/5/2 | P2.2 (+ P2.4 f) | ~28 ms (x0,5) |
| 1350 / 14.0 |  | K14 plaster Reacta po commicie | 56 · 0/6/3 | 56 · 0/6/3 | 70 · 0/20/10 | 70 · 0/20/10 | P2.2 (+ P2.4 f) | ~35 ms (x0,5) |
| **suma = audyt** | | | **359** | **539** | **615** | **834** | | |
