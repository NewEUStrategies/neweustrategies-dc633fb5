| obs start / czas [ms] | L | klasa | m4: sym · blok opt/pes/śr | m4c3: sym · blok opt/pes/śr | właściciel | oczek. sym. po poprawce |
|---|---|---|---|---|---|---|
| 41 / 30.6 |  | K1 nav | 122 · 0/0/0 | 122 · 0/0/0 | nieprzypisane (platforma) | ~122 ms (bez zmian) |
| 74 / 21.0 |  | K- inne | 84 · 0/0/0 | 84 · 0/0/0 | nieprzypisane | ~84 ms (bez zmian) |
| 220 / 19.2 |  | K2 ParseCSS | 77 · 0/0/0 | 77 · 0/27/14 | P4.1 (higiena), P2.4 HW-2 | ~69 ms (x0,9 (mniej reguł)) |
| 288 / 26.1 | L | K5 pierwsza klatka | 52 · 0/0/0 | 52 · 0/0/0 | P2.5/P2.6; warunkowo P3.3 | ~36 ms (x0,69 (zmierzony pakiet no-JS)) |
| 314 / 32.0 |  | K7 ScriptCatchup | 128 · 0/0/0 | 128 · 47/47/47 | P3.4 (+ objętość P5.1/P5.2) | ~42 ms (x0,33 (podział na 3 grupy)) |
| 346 / 38.0 | L | K6 druga klatka | 76 · 0/0/0 | 76 · 26/26/26 | P2.2 (sectionStreaming) + P3.3 | ~46 ms (x0,6) |
| 399 / 23.1 |  | K9 przebieg korzenia | 92 · 42/42/42 | 92 · 42/42/42 | P1.7 (+ P5.2 trasy) | ~62 ms (x0,67 (reguła planu)) |
| 422 / 28.1 |  | K8 start animacji CSS | 113 · 63/63/63 | 113 · 63/63/63 | P2.4 (g) + P1.2 (styles.css w W1); ticker P2.3 | ~0 ms (0 (zadanie znika)) |
| 452 / 15.5 |  | K10 hydrateStart: createRouter | 62 · 12/12/12 | 62 · 12/12/12 | P5.2 (powłoki tras); P1.7 (router.tsx) | ~43 ms (x0,7) |
| 566 / 73.7 | L | K12 commit hydratacji + efekty pasywne + re-render sync | 147 · 0/97/48 | 147 · 97/97/97 | P2.2 (+ P1.7, P2.3, P2.4) | ~74 ms (x0,5 (wyspy, podział; zachować Layout)) |
| 640 / 28.8 | L | K13 styl nagłówka | 58 · 8/8/8 | 58 · 8/8/8 | P1.2 | ~0 ms (0 (brak zapisu przy montażu)) |
| 1121 / 12.6 |  | K14 plaster Reacta po commicie | 50 · 0/0/0 | 50 · 0/0/0 | P2.2 (+ P2.4 f) | ~25 ms (x0,5) |
| 1159 / 13.1 |  | K14 plaster Reacta po commicie | 52 · 0/2/1 | 52 · 0/2/1 | P2.2 (+ P2.4 f) | ~26 ms (x0,5) |
| 1194 / 32.0 |  | K15 ParseHTML w commicie Reacta | 128 · 0/78/39 | 128 · 3/78/40 | P2.4 (StyleSink per widget, HW-2) | ~51 ms (x0,4) |
| 1227 / 21.4 |  | K16 styl po przełączeniu urządzenia | 86 · 0/0/0 | 86 · 0/36/18 | P2.4 (CSS po data-device) + P2.2 (BuilderRenderer) | ~43 ms (x0,5) |
| **suma = audyt** | | | **214** | **368** | | |
