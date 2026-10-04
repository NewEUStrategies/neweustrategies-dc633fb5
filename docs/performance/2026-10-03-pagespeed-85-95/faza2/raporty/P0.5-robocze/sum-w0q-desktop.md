
### w0q-desktop-1
| obs start / czas [ms] | L | klasa | sym/blok d4 | sym/blok d4c3 | sym/blok d5 | sym/blok d5c3 |
|---|---|---|---|---|---|---|
| 42 / 26.9 |  | nav (commit nawigacji + początek parsowania) | 107/0 | 107/0 | 134/0 | 134/4 |
| 118 / 14.4 |  | ParseCSS (arkusz blokujący) | 58/0 | 58/8 | 72/0 | 72/22 |
| 146 / 29.9 |  | ParseHTML dokumentu (+inline skrypty) | 120/0 | 120/70 | 150/0 | 150/100 |
| 188 / 23.9 |  | ParseHTML dokumentu (+inline skrypty) | 96/0 | 96/46 | 119/0 | 119/69 |
| 216 / 38.5 | L | pierwsza klatka (Style+Layout dokumentu) | 77/0 | 77/27 | 96/41 | 96/46 |
| 255 / 10.3 |  | ParseHTML dokumentu (+inline skrypty) | - | - | 52/2 | 52/2 |
| 293 / 31.7 |  | ScriptCatchup (kompilacja zestawu bootu) | 127/77 | 127/77 | 158/108 | 158/108 |
| 333 / 32.5 |  | start animacji CSS (kompozytor, animationstart) | 130/80 | 130/80 | 163/113 | 163/113 |
| 366 / 18.9 |  | przebieg korzenia (ewaluacja entry po TLA i18n + hydrateRoot) | 76/26 | 76/26 | 95/45 | 95/45 |
| 392 / 12.7 |  | hydrateStart: createRouter (processRouteTree) + hydracja zapytań | 51/1 | 51/1 | 63/13 | 63/13 |
| 406 / 18.8 |  | timer startu (ciało po setTimeout(0) router.tsx:210) | 75/25 | 75/25 | 94/44 | 94/44 |
| 515 / 90.8 | L | commit hydratacji + efekty pasywne + re-render sync | 182/132 | 182/132 | 227/177 | 227/177 |
| 606 / 23.9 | L | inne | - | - | 60/10 | 60/10 |
| 644 / 52.8 | L | styl nagłówka (--sticky-header-h / --hdr-*, Header.tsx:566/472) | 106/56 | 106/56 | 132/82 | 132/82 |
| 712 / 10.8 |  | ScriptCatchup (kompilacja zestawu bootu) | - | - | 54/4 | 54/4 |
| 730 / 13.8 |  | start animacji CSS (kompozytor, animationstart) | 55/5 | 55/2 | 69/19 | 69/10 |
| 794 / 12.6 |  | plaster Reacta po commicie (leniwe granice, efekty) | 50/0 | 50/0 | 63/6 | 63/6 |
| 913 / 13.9 |  | plaster Reacta po commicie (leniwe granice, efekty) | 55/2 | 55/2 | 69/10 | 69/10 |
| 938 / 25.0 |  | plaster Reacta po commicie (leniwe granice, efekty) | 100/25 | 100/25 | 125/38 | 125/38 |
| 1103 / 11.7 |  | ScriptCatchup (kompilacja zestawu bootu) | - | - | 59/4 | 59/4 |
| 1384 / 10.4 |  | plaster Reacta po commicie (leniwe granice, efekty) | - | - | 52/1 | 52/1 |
| 1397 / 28.3 |  | plaster Reacta po commicie (leniwe granice, efekty) | 113/32 | 113/32 | 142/46 | 142/46 |
| 1427 / 12.4 |  | plaster Reacta po commicie (leniwe granice, efekty) | 50/0 | 50/0 | 62/6 | 62/6 |
| **suma** | | | **461** | **610** | **769** | **960** |

### w0q-desktop-2
| obs start / czas [ms] | L | klasa | sym/blok d4 | sym/blok d4c3 | sym/blok d5 | sym/blok d5c3 |
|---|---|---|---|---|---|---|
| 32 / 40.5 |  | nav (commit nawigacji + początek parsowania) | 162/0 | 162/0 | 202/0 | 202/7 |
| 124 / 26.5 |  | ParseCSS (arkusz blokujący) | 106/0 | 106/56 | 133/0 | 133/83 |
| 167 / 10.8 |  | ParseHTML dokumentu (+inline skrypty) | - | - | 54/0 | 54/4 |
| 180 / 10.2 |  | ParseHTML dokumentu (+inline skrypty) | - | - | 51/0 | 51/1 |
| 190 / 42.7 | L | pierwsza klatka (Style+Layout dokumentu) | 85/0 | 85/35 | 107/0 | 107/57 |
| 235 / 11.4 |  | ParseHTML dokumentu (+inline skrypty) | - | - | 57/0 | 57/7 |
| 256 / 10.3 |  | ParseHTML dokumentu (+inline skrypty) | - | - | 51/1 | 51/1 |
| 270 / 39.7 |  | ScriptCatchup (kompilacja zestawu bootu) | 159/101 | 159/109 | 199/149 | 199/149 |
| 316 / 40.5 |  | start animacji CSS (kompozytor, animationstart) | 162/112 | 162/112 | 202/152 | 202/152 |
| 357 / 16.9 |  | inne | 68/18 | 68/18 | 85/35 | 85/35 |
| 378 / 34.6 |  | przebieg korzenia (ewaluacja entry po TLA i18n + hydrateRoot) | 138/88 | 138/88 | 173/123 | 173/123 |
| 416 / 13.3 |  | hydrateStart: createRouter (processRouteTree) + hydracja zapytań | 53/3 | 53/3 | 67/17 | 67/17 |
| 554 / 96.6 | L | commit hydratacji + efekty pasywne + re-render sync | 193/72 | 193/72 | 242/96 | 242/96 |
| 653 / 53.9 | L | plaster Reacta po commicie (leniwe granice, efekty) | 108/29 | 108/29 | 135/42 | 135/42 |
| 756 / 14.7 |  | plaster Reacta po commicie (leniwe granice, efekty) | 59/4 | 59/4 | 74/12 | 74/12 |
| 899 / 15.8 |  | plaster Reacta po commicie (leniwe granice, efekty) | 63/6 | 63/6 | 79/14 | 79/14 |
| 1334 / 14.8 |  | plaster Reacta po commicie (leniwe granice, efekty) | 59/4 | 59/4 | 74/12 | 74/12 |
| 1396 / 17.5 |  | plaster Reacta po commicie (leniwe granice, efekty) | 70/10 | 70/10 | 88/19 | 88/19 |
| 1444 / 10.1 |  | plaster Reacta po commicie (leniwe granice, efekty) | - | - | 50/0 | 50/0 |
| **suma** | | | **448** | **547** | **673** | **832** |

### w0q-desktop-3
| obs start / czas [ms] | L | klasa | sym/blok d4 | sym/blok d4c3 | sym/blok d5 | sym/blok d5c3 |
|---|---|---|---|---|---|---|
| 35 / 48.7 |  | nav (commit nawigacji + początek parsowania) | 195/0 | 195/65 | 243/0 | 243/113 |
| 98 / 13.0 |  | ParseCSS (arkusz blokujący) | 52/0 | 52/2 | 65/0 | 65/15 |
| 114 / 10.1 |  | ParseHTML dokumentu (+inline skrypty) | - | - | 51/0 | 51/1 |
| 130 / 12.5 |  | inne | 50/0 | 50/0 | 63/0 | 63/13 |
| 142 / 21.0 | L | nav (commit nawigacji + początek parsowania) | - | - | 52/0 | 52/2 |
| 163 / 28.5 |  | ParseHTML dokumentu (+inline skrypty) | 114/0 | 114/64 | 142/0 | 142/92 |
| 192 / 23.7 | L | start animacji CSS (kompozytor, animationstart) | - | - | 59/7 | 59/9 |
| 218 / 11.5 |  | ParseHTML dokumentu (+inline skrypty) | - | - | 57/7 | 57/7 |
| 234 / 75.1 | L | pierwsza klatka (Style+Layout dokumentu) | 150/100 | 150/100 | 188/138 | 188/138 |
| 312 / 10.8 |  | ParseHTML dokumentu (+inline skrypty) | - | - | 54/4 | 54/4 |
| 354 / 33.4 |  | ScriptCatchup (kompilacja zestawu bootu) | 134/84 | 134/84 | 167/117 | 167/117 |
| 400 / 19.9 |  | przebieg korzenia (ewaluacja entry po TLA i18n + hydrateRoot) | 79/29 | 79/29 | 99/49 | 99/49 |
| 423 / 13.0 |  | hydrateStart: createRouter (processRouteTree) + hydracja zapytań | 52/1 | 52/1 | 65/15 | 65/15 |
| 531 / 82.7 | L | commit hydratacji + efekty pasywne + re-render sync | 165/58 | 165/58 | 207/157 | 207/78 |
| 614 / 20.5 | L | styl nagłówka (--sticky-header-h / --hdr-*, Header.tsx:566/472) | - | - | 51/0 | 51/0 |
| 659 / 55.2 | L | styl nagłówka (--sticky-header-h / --hdr-*, Header.tsx:566/472) | 110/30 | 110/30 | 138/44 | 138/44 |
| 732 / 10.8 |  | plaster Reacta po commicie (leniwe granice, efekty) | - | - | 54/2 | 54/2 |
| 884 / 15.4 |  | plaster Reacta po commicie (leniwe granice, efekty) | 62/6 | 62/6 | 77/14 | 77/14 |
| 1346 / 13.9 |  | plaster Reacta po commicie (leniwe granice, efekty) | 56/3 | 56/3 | 70/10 | 70/10 |
| 1464 / 11.5 |  | plaster Reacta po commicie (leniwe granice, efekty) | - | - | 58/4 | 58/4 |
| **suma** | | | **310** | **442** | **568** | **728** |

### w0q-desktop-4
| obs start / czas [ms] | L | klasa | sym/blok d4 | sym/blok d4c3 | sym/blok d5 | sym/blok d5c3 |
|---|---|---|---|---|---|---|
| 117 / 48.0 | L | nav (commit nawigacji + początek parsowania) | 96/0 | 96/0 | 120/0 | 120/4 |
| 166 / 18.6 |  | ParseCSS (arkusz blokujący) | 74/4 | 74/24 | 93/0 | 93/43 |
| 191 / 12.2 |  | ParseHTML dokumentu (+inline skrypty) | - | - | 61/0 | 61/11 |
| 213 / 13.1 |  | ParseHTML dokumentu (+inline skrypty) | 52/0 | 52/2 | 65/0 | 65/15 |
| 235 / 32.1 | L | pierwsza klatka (Style+Layout dokumentu) | 64/0 | 64/14 | 80/0 | 80/30 |
| 269 / 42.3 | L | druga klatka (odsłonięcie sekcji strumieniowanych $RV) | 85/0 | 85/35 | 106/0 | 106/56 |
| 313 / 34.6 |  | ScriptCatchup (kompilacja zestawu bootu) | 138/0 | 138/88 | 173/123 | 173/123 |
| 357 / 19.8 |  | przebieg korzenia (ewaluacja entry po TLA i18n + hydrateRoot) | 79/29 | 79/29 | 99/49 | 99/49 |
| 378 / 32.6 |  | start animacji CSS (kompozytor, animationstart) | 131/81 | 131/81 | 163/113 | 163/113 |
| 411 / 13.5 |  | hydrateStart: createRouter (processRouteTree) + hydracja zapytań | 54/2 | 54/2 | 68/18 | 68/11 |
| 512 / 66.7 | L | commit hydratacji + efekty pasywne + re-render sync | 133/42 | 133/42 | 167/96 | 167/58 |
| 579 / 27.1 | L | styl nagłówka (--sticky-header-h / --hdr-*, Header.tsx:566/472) | 54/4 | 54/2 | 68/18 | 68/9 |
| 644 / 10.9 |  | plaster Reacta po commicie (leniwe granice, efekty) | - | - | 55/2 | 55/2 |
| 790 / 17.0 |  | plaster Reacta po commicie (leniwe granice, efekty) | 68/9 | 68/9 | 85/18 | 85/18 |
| 886 / 19.6 |  | plaster Reacta po commicie (leniwe granice, efekty) | 78/14 | 78/14 | 98/24 | 98/24 |
| 906 / 15.1 |  | timer startu (ciało po setTimeout(0) router.tsx:210) | 60/5 | 60/5 | 75/12 | 75/12 |
| 960 / 10.3 |  | plaster Reacta po commicie (leniwe granice, efekty) | - | - | 51/0 | 51/0 |
| **suma** | | | **190** | **346** | **474** | **580** |

### w0q-desktop-5
| obs start / czas [ms] | L | klasa | sym/blok d4 | sym/blok d4c3 | sym/blok d5 | sym/blok d5c3 |
|---|---|---|---|---|---|---|
| 37 / 30.5 |  | nav (commit nawigacji + początek parsowania) | 122/0 | 122/0 | 153/0 | 153/0 |
| 93 / 40.8 |  | ParseHTML dokumentu (+inline skrypty) | 163/0 | 163/113 | 204/0 | 204/154 |
| 165 / 16.3 |  | ParseHTML dokumentu (+inline skrypty) | 65/0 | 65/15 | 82/0 | 82/32 |
| 196 / 33.4 | L | pierwsza klatka (Style+Layout dokumentu) | 67/0 | 67/17 | 83/0 | 83/33 |
| 241 / 42.5 | L | druga klatka (odsłonięcie sekcji strumieniowanych $RV) | 85/0 | 85/35 | 106/56 | 106/56 |
| 289 / 32.9 |  | ScriptCatchup (kompilacja zestawu bootu) | 131/81 | 131/81 | 164/114 | 164/114 |
| 332 / 24.3 |  | start animacji CSS (kompozytor, animationstart) | 97/47 | 97/47 | 121/71 | 121/71 |
| 356 / 20.6 |  | przebieg korzenia (ewaluacja entry po TLA i18n + hydrateRoot) | 83/33 | 83/33 | 103/53 | 103/53 |
| 384 / 13.8 |  | hydrateStart: createRouter (processRouteTree) + hydracja zapytań | 55/5 | 55/5 | 69/19 | 69/19 |
| 502 / 105.0 | L | commit hydratacji + efekty pasywne + re-render sync | 210/160 | 210/160 | 262/212 | 262/212 |
| 607 / 34.4 | L | styl nagłówka (--sticky-header-h / --hdr-*, Header.tsx:566/472) | 69/19 | 69/19 | 86/36 | 86/36 |
| 717 / 10.1 |  | plaster Reacta po commicie (leniwe granice, efekty) | - | - | 51/1 | 51/1 |
| 840 / 16.9 |  | plaster Reacta po commicie (leniwe granice, efekty) | 67/8 | 67/8 | 84/17 | 84/17 |
| 914 / 12.3 |  | plaster Reacta po commicie (leniwe granice, efekty) | - | - | 62/6 | 62/6 |
| 929 / 13.8 |  | plaster Reacta po commicie (leniwe granice, efekty) | 55/2 | 55/2 | 69/10 | 69/10 |
| 949 / 11.5 |  | timer startu (ciało po setTimeout(0) router.tsx:210) | - | - | 58/4 | 58/4 |
| 990 / 11.5 |  | plaster Reacta po commicie (leniwe granice, efekty) | - | - | 58/4 | 58/4 |
| 1004 / 11.0 |  | plaster Reacta po commicie (leniwe granice, efekty) | - | - | 55/2 | 55/2 |
| 1350 / 14.0 |  | plaster Reacta po commicie (leniwe granice, efekty) | 56/3 | 56/3 | 70/10 | 70/10 |
| **suma** | | | **359** | **539** | **615** | **834** |

### klasy (mediana [min-max] po przebiegach; czas obs, blokowanie per reżim)
| klasa | przebiegi | start obs | czas obs | blok d4 | blok d4c3 | blok d5 | blok d5c3 |
|---|---|---|---|---|---|---|---|
| commit hydratacji + efekty pasywne + re-render sync | 5/5 | 515 [502-554] | 91 [67-105] | 72 [42-160] | 72 [42-160] | 157 [96-212] | 96 [58-212] |
| ScriptCatchup (kompilacja zestawu bootu) | 5/5 | 313 [270-1103] | 33 [11-40] | 81 [0-101] | 84 [77-109] | 117 [114-149] | 117 [114-149] |
| start animacji CSS (kompozytor, animationstart) | 5/5 | 332 [192-730] | 28 [14-40] | 81 [0-112] | 81 [0-112] | 113 [7-152] | 113 [9-152] |
| przebieg korzenia (ewaluacja entry po TLA i18n + hydrateRoot) | 5/5 | 366 [356-400] | 20 [19-35] | 29 [26-88] | 29 [26-88] | 49 [45-123] | 49 [45-123] |
| plaster Reacta po commicie (leniwe granice, efekty) | 5/5 | 929 [644-1464] | 14 [10-54] | 23 [9-59] | 23 [9-59] | 50 [30-106] | 50 [30-106] |
| ParseHTML dokumentu (+inline skrypty) | 5/5 | 188 [93-312] | 12 [10-41] | 0 [0-0] | 64 [0-128] | 1 [0-11] | 104 [13-186] |
| pierwsza klatka (Style+Layout dokumentu) | 5/5 | 216 [190-235] | 38 [32-75] | 0 [0-100] | 27 [14-100] | 0 [0-138] | 46 [30-138] |
| styl nagłówka (--sticky-header-h / --hdr-*, Header.tsx:566/472) | 4/5 | 614 [579-659] | 34 [20-55] | 19 [0-56] | 19 [0-56] | 36 [0-82] | 36 [0-82] |
| ParseCSS (arkusz blokujący) | 4/5 | 121 [98-166] | 16 [13-26] | 0 [0-4] | 8 [0-56] | 0 [0-0] | 22 [0-83] |
| druga klatka (odsłonięcie sekcji strumieniowanych $RV) | 2/5 | 255 [241-269] | 42 [42-42] | 0 [0-0] | 0 [0-35] | 0 [0-56] | 0 [0-56] |
| nav (commit nawigacji + początek parsowania) | 5/5 | 40 [32-142] | 36 [21-49] | 0 [0-0] | 0 [0-65] | 0 [0-0] | 4 [0-115] |
| timer startu (ciało po setTimeout(0) router.tsx:210) | 3/5 | 906 [406-949] | 15 [12-19] | 0 [0-25] | 0 [0-25] | 4 [0-44] | 4 [0-44] |
| inne | 3/5 | 357 [130-606] | 17 [12-24] | 0 [0-18] | 0 [0-18] | 0 [0-35] | 10 [0-35] |
| hydrateStart: createRouter (processRouteTree) + hydracja zapytań | 5/5 | 411 [384-423] | 13 [13-14] | 2 [1-5] | 2 [1-5] | 17 [13-19] | 15 [11-19] |
