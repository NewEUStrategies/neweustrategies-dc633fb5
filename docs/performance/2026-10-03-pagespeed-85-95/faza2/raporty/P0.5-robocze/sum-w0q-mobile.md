
### w0q-mobile-1
| obs start / czas [ms] | L | klasa | sym/blok m4 | sym/blok m4c3 |
|---|---|---|---|---|
| 60 / 40.2 |  | nav (commit nawigacji + początek parsowania) | 161/0 | 161/0 |
| 158 / 19.3 |  | ParseCSS (arkusz blokujący) | 77/27 | 77/14 |
| 211 / 17.4 |  | ParseHTML dokumentu (+inline skrypty) | 70/0 | 70/0 |
| 230 / 21.8 |  | ParseHTML dokumentu (+inline skrypty) | 87/0 | 87/0 |
| 252 / 128.4 | L | pierwsza klatka (Style+Layout dokumentu) | 257/23 | 257/173 |
| 401 / 37.1 | L | druga klatka (odsłonięcie sekcji strumieniowanych $RV) | 74/24 | 74/24 |
| 445 / 47.1 |  | ScriptCatchup (kompilacja zestawu bootu) | 188/138 | 188/138 |
| 515 / 24.0 |  | przebieg korzenia (ewaluacja entry po TLA i18n + hydrateRoot) | 96/46 | 96/46 |
| 542 / 13.7 |  | hydrateStart: createRouter (processRouteTree) + hydracja zapytań | 55/5 | 55/5 |
| 597 / 24.4 |  | inne | 97/47 | 97/47 |
| 680 / 77.2 | L | commit hydratacji + efekty pasywne + re-render sync | 154/52 | 154/104 |
| 757 / 25.3 | L | start animacji CSS (kompozytor, animationstart) | 51/1 | 51/1 |
| 834 / 17.7 |  | ScriptCatchup (kompilacja zestawu bootu) | 71/21 | 71/10 |
| 894 / 13.1 |  | plaster Reacta po commicie (leniwe granice, efekty) | 52/1 | 52/1 |
| 1367 / 12.6 |  | plaster Reacta po commicie (leniwe granice, efekty) | 51/0 | 51/0 |
| 1402 / 20.8 |  | ParseHTML w commicie Reacta (innerHTML arkuszy) | 83/16 | 83/16 |
| 1423 / 24.5 |  | styl nagłówka (--sticky-header-h / --hdr-*, Header.tsx:566/472) | 98/48 | 98/24 |
| **suma** | | | **450** | **604** |

### w0q-mobile-2
| obs start / czas [ms] | L | klasa | sym/blok m4 | sym/blok m4c3 |
|---|---|---|---|---|
| 41 / 30.6 |  | nav (commit nawigacji + początek parsowania) | 122/0 | 122/0 |
| 74 / 21.0 |  | inne | 84/0 | 84/0 |
| 220 / 19.2 |  | ParseCSS (arkusz blokujący) | 77/0 | 77/14 |
| 288 / 26.1 | L | pierwsza klatka (Style+Layout dokumentu) | 52/0 | 52/0 |
| 314 / 32.0 |  | ScriptCatchup (kompilacja zestawu bootu) | 128/0 | 128/47 |
| 346 / 38.0 | L | druga klatka (odsłonięcie sekcji strumieniowanych $RV) | 76/0 | 76/26 |
| 399 / 23.1 |  | przebieg korzenia (ewaluacja entry po TLA i18n + hydrateRoot) | 92/42 | 92/42 |
| 422 / 28.1 |  | start animacji CSS (kompozytor, animationstart) | 113/63 | 113/63 |
| 452 / 15.5 |  | hydrateStart: createRouter (processRouteTree) + hydracja zapytań | 62/12 | 62/12 |
| 566 / 73.7 | L | commit hydratacji + efekty pasywne + re-render sync | 147/48 | 147/97 |
| 640 / 28.8 | L | styl nagłówka (--sticky-header-h / --hdr-*, Header.tsx:566/472) | 58/8 | 58/8 |
| 1121 / 12.6 |  | plaster Reacta po commicie (leniwe granice, efekty) | 50/0 | 50/0 |
| 1159 / 13.1 |  | plaster Reacta po commicie (leniwe granice, efekty) | 52/1 | 52/1 |
| 1194 / 32.0 |  | ParseHTML w commicie Reacta (innerHTML arkuszy) | 128/39 | 128/40 |
| 1227 / 21.4 |  | styl po przełączeniu urządzenia (data-device + style kolumn) | 86/0 | 86/18 |
| **suma** | | | **214** | **368** |

### w0q-mobile-3
| obs start / czas [ms] | L | klasa | sym/blok m4 | sym/blok m4c3 |
|---|---|---|---|---|
| 256 / 39.9 | L | pierwsza klatka (Style+Layout dokumentu) | 80/0 | 80/0 |
| 296 / 57.3 | L | druga klatka (odsłonięcie sekcji strumieniowanych $RV) | 115/0 | 115/0 |
| 354 / 40.7 |  | ScriptCatchup (kompilacja zestawu bootu) | 163/0 | 163/6 |
| 408 / 30.2 |  | start animacji CSS (kompozytor, animationstart) | 121/0 | 121/71 |
| 440 / 23.2 |  | przebieg korzenia (ewaluacja entry po TLA i18n + hydrateRoot) | 93/43 | 93/43 |
| 468 / 21.7 |  | hydrateStart: createRouter (processRouteTree) + hydracja zapytań | 87/37 | 87/37 |
| 490 / 14.5 |  | timer startu (ciało po setTimeout(0) router.tsx:210) | 58/4 | 58/8 |
| 636 / 98.8 | L | commit hydratacji + efekty pasywne + re-render sync | 198/74 | 198/148 |
| 734 / 39.1 | L | styl nagłówka (--sticky-header-h / --hdr-*, Header.tsx:566/472) | 78/28 | 78/28 |
| 1345 / 31.9 |  | ParseHTML w commicie Reacta (innerHTML arkuszy) | 128/78 | 128/39 |
| 1380 / 28.1 |  | styl po przełączeniu urządzenia (data-device + style kolumn) | 112/0 | 112/31 |
| **suma** | | | **264** | **411** |

### w0q-mobile-4
| obs start / czas [ms] | L | klasa | sym/blok m4 | sym/blok m4c3 |
|---|---|---|---|---|
| 38 / 23.4 |  | nav (commit nawigacji + początek parsowania) | 94/0 | 94/0 |
| 176 / 21.3 |  | ParseCSS (arkusz blokujący) | 85/0 | 85/35 |
| 222 / 13.2 |  | ParseHTML dokumentu (+inline skrypty) | 53/0 | 53/0 |
| 246 / 29.4 | L | pierwsza klatka (Style+Layout dokumentu) | 59/0 | 59/0 |
| 277 / 36.8 |  | ScriptCatchup (kompilacja zestawu bootu) | 147/0 | 147/0 |
| 314 / 42.8 | L | druga klatka (odsłonięcie sekcji strumieniowanych $RV) | 86/0 | 86/0 |
| 367 / 22.6 |  | przebieg korzenia (ewaluacja entry po TLA i18n + hydrateRoot) | 90/40 | 90/40 |
| 390 / 30.4 |  | start animacji CSS (kompozytor, animationstart) | 121/71 | 121/71 |
| 420 / 12.8 |  | hydrateStart: createRouter (processRouteTree) + hydracja zapytań | 51/1 | 51/1 |
| 436 / 13.4 |  | timer startu (ciało po setTimeout(0) router.tsx:210) | 53/3 | 53/3 |
| 524 / 72.5 | L | commit hydratacji + efekty pasywne + re-render sync | 145/48 | 145/95 |
| 596 / 30.6 | L | styl nagłówka (--sticky-header-h / --hdr-*, Header.tsx:566/472) | 61/11 | 61/11 |
| 1100 / 22.1 |  | ParseHTML w commicie Reacta (innerHTML arkuszy) | 88/38 | 88/38 |
| 1122 / 22.1 |  | styl po przełączeniu urządzenia (data-device + style kolumn) | 88/0 | 88/38 |
| **suma** | | | **212** | **332** |

### w0q-mobile-5
| obs start / czas [ms] | L | klasa | sym/blok m4 | sym/blok m4c3 |
|---|---|---|---|---|
| 34 / 39.2 |  | nav (commit nawigacji + początek parsowania) | 157/0 | 157/0 |
| 163 / 51.1 | L | pierwsza klatka (Style+Layout dokumentu) | 102/0 | 102/0 |
| 214 / 21.9 |  | ParseHTML dokumentu (+inline skrypty) | 88/0 | 88/0 |
| 246 / 64.4 | L | druga klatka (odsłonięcie sekcji strumieniowanych $RV) | 129/0 | 129/77 |
| 354 / 34.6 |  | ScriptCatchup (kompilacja zestawu bootu) | 138/0 | 138/88 |
| 400 / 18.2 |  | przebieg korzenia (ewaluacja entry po TLA i18n + hydrateRoot) | 73/23 | 73/23 |
| 421 / 12.6 |  | hydrateStart: createRouter (processRouteTree) + hydracja zapytań | 50/0 | 50/0 |
| 520 / 72.3 | L | commit hydratacji + efekty pasywne + re-render sync | 145/95 | 145/95 |
| 660 / 44.8 | L | styl nagłówka (--sticky-header-h / --hdr-*, Header.tsx:566/472) | 90/0 | 90/40 |
| 1109 / 18.1 |  | plaster Reacta po commicie (leniwe granice, efekty) | 73/12 | 73/12 |
| 1147 / 27.5 |  | ParseHTML w commicie Reacta (innerHTML arkuszy) | 110/60 | 110/60 |
| 1179 / 32.7 | L | styl po przełączeniu urządzenia (data-device + style kolumn) | 65/8 | 65/8 |
| **suma** | | | **197** | **402** |

### klasy (mediana [min-max] po przebiegach; czas obs, blokowanie per reżim)
| klasa | przebiegi | start obs | czas obs | blok m4 | blok m4c3 |
|---|---|---|---|---|---|
| commit hydratacji + efekty pasywne + re-render sync | 5/5 | 566 [520-680] | 74 [72-99] | 52 [48-95] | 97 [95-148] |
| ScriptCatchup (kompilacja zestawu bootu) | 5/5 | 354 [277-834] | 36 [18-47] | 0 [0-159] | 47 [0-148] |
| ParseHTML w commicie Reacta (innerHTML arkuszy) | 5/5 | 1194 [1100-1402] | 28 [21-32] | 39 [16-78] | 39 [16-60] |
| przebieg korzenia (ewaluacja entry po TLA i18n + hydrateRoot) | 5/5 | 400 [367-515] | 23 [18-24] | 42 [23-46] | 42 [23-46] |
| start animacji CSS (kompozytor, animationstart) | 4/5 | 415 [390-757] | 29 [25-30] | 1 [0-71] | 63 [0-71] |
| styl nagłówka (--sticky-header-h / --hdr-*, Header.tsx:566/472) | 5/5 | 660 [596-1423] | 31 [24-45] | 11 [0-48] | 24 [8-40] |
| pierwsza klatka (Style+Layout dokumentu) | 5/5 | 252 [163-288] | 40 [26-128] | 0 [0-23] | 0 [0-173] |
| druga klatka (odsłonięcie sekcji strumieniowanych $RV) | 5/5 | 314 [246-401] | 43 [37-64] | 0 [0-24] | 24 [0-77] |
| hydrateStart: createRouter (processRouteTree) + hydracja zapytań | 5/5 | 452 [420-542] | 14 [13-22] | 5 [0-37] | 5 [0-37] |
| styl po przełączeniu urządzenia (data-device + style kolumn) | 4/5 | 1203 [1122-1380] | 25 [21-33] | 0 [0-8] | 18 [0-38] |
| inne | 2/5 | 336 [74-597] | 23 [21-24] | 0 [0-47] | 0 [0-47] |
| ParseCSS (arkusz blokujący) | 3/5 | 176 [158-220] | 19 [19-21] | 0 [0-27] | 14 [0-35] |
| plaster Reacta po commicie (leniwe granice, efekty) | 3/5 | 1121 [894-1367] | 13 [13-18] | 1 [0-12] | 1 [0-12] |
| timer startu (ciało po setTimeout(0) router.tsx:210) | 2/5 | 463 [436-490] | 14 [13-14] | 0 [0-4] | 0 [0-8] |
| nav (commit nawigacji + początek parsowania) | 4/5 | 40 [34-60] | 35 [23-40] | 0 [0-0] | 0 [0-0] |
| ParseHTML dokumentu (+inline skrypty) | 3/5 | 218 [211-230] | 20 [13-22] | 0 [0-0] | 0 [0-0] |
