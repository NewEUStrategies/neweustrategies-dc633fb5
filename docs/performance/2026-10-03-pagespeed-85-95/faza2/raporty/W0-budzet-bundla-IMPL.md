# W0-fix: bramka `check:bundle` na zielono bez zmiany progów

Gałąź `perf/w0fix-bundle` (worktree `scratchpad/wt/fix-bundle`, commit 889c822), baza
`perf/pagespeed-mobile85-desktop95-t595d6` (a8c1a86 = main d466993 + commity dokumentacji).
Żaden próg w `scripts/check-bundle-size.ts` nie został ruszony, nic nie wyłączono z rozliczenia;
w tym pliku doszedł wyłącznie komentarz w kronice (wpis XXII).

## 1. Stan wyjściowy i skład

|                      |    runner (CI, main d466993) |     host (ten worktree, przed) |
| -------------------- | ---------------------------: | -----------------------------: |
| overall              | 4806,9 KB (próg 4772, +34,9) |              4809,9 KB (+37,9) |
| public               |        2865,3 KB (próg 2877) |                      2861,0 KB |
| boot                 |          473,9 KB (próg 579) |                       477,1 KB |
| `spreadsheet.worker` |     157,1 KB (`xlsx` 0.20.3) | 139,8 KB (`xlsx` 0.18.5 z npm) |

Komenda jak w jobie `build` CI: `bun run build` (skrypt ustawia `NODE_OPTIONS=--max-old-space-size=8192`)
z czterema zastępczymi `VITE_*`/`SUPABASE_*`, potem `bun run check:bundle`. Pomiar z `BUNDLE_INVENTORY=1`.

„+157,1 KB spreadsheet.worker (NOWY)” w raporcie ruchów to artefakt baseline’u b006c2e (zmierzony bez procesu
arkuszy), nie wzrost. Proces jest osobnym buildem Rollupa (format IIFE), więc `report:chunk-inventory` go nie
widzi; skład zmierzyłem mikrobuildami tym samym Vite/esbuild (pełny `XLSX.read` + `utils` + `XLSX.write`:
138,4 KB w mikrobuildzie wobec 139,8 w pełnym buildzie - ten sam kod).

Skład procesu arkuszy (host, gzip): sam odczyt ~111 KB; `XLSX.write` dokłada ~27 KB, z czego pisarz xlsx to
~9 KB, a reszta (~18 KB) to pisarze numbers, ods, xlsb, BIFF2-8, xlml, sylk/dbf/prn/rtf/eth/dif - ciągnięci
przez rozdzielacz `writeSync` po `bookType`, choć aplikacja wywołuje wyłącznie xlsx. Codepage (`cpexcel`)
w procesie NIE MA (ESM `xlsx.mjs` go nie bundluje). Największe pozostałe bloki to tablice rekordów
`XLSBRecordEnum`/`XLSRecordEnum`, `CFB`, `parse_xlml`, `WK_`, `DBF` - wszystkie osiągalne z `XLSX.read`
przez rozpoznanie zawartości.

`vendor-jszip` (29,6 KB): w 99,7% sam `jszip`; używa go mammoth (podgląd .docx) i `parsePptx`. Duplikatu
z procesem arkuszy nie ma - to osobny build. Chunk podglądu .docx (mammoth, PUBLICZNY, 100,3 KB): bluebird,
@xmldom/xmldom, dingbat-to-unicode, xmlbuilder, underscore, lop.

Formaty i operacje, które aplikacja przyjmuje (sprawdzone w kodzie):

- podgląd załącznika (`DocumentViewerBody` -> `officeParse.parseSpreadsheet` -> op `preview`): `.xlsx`, `.ods`,
  MIME `spreadsheetml`; `.xls` dostaje komunikat „starszy format” (bez parsowania);
- import danych wykresu/mapy (`charts/importTable.readWorkbook` -> op `rows`): `.xlsx .xlsm .xls .ods`
  (csv/tsv/txt własnym parserem);
- eksport leadów i raportu sponsora (`leadExport`, `sponsorReportExport` -> op `write`): wyłącznie `.xlsx`.

## 2. Wybrane podejście i dlaczego

Jedna zasada: **usunąć kod, który z naszych wywołań jest nieosiągalny**, bez zmiany zachowania.

1. **`XLSX.writeXLSX` zamiast `XLSX.write`** (`src/lib/files/spreadsheetCore.ts`). Wejście SheetJS
   przeznaczone pod tree-shaking (README 0.18.5, dostępne też w 0.20.x, typy w `types/index.d.ts`): ta sama
   ścieżka `write_zip_xlsx` co `write(..., {bookType: "xlsx"})`, bez pozostałych pisarzy. Plik wynikowy
   bajt w bajt identyczny (test). Proces arkuszy -18,3 KB na hoście.
2. **Martwy kod podglądu .docx** - wtyczka `scripts/lib/officeParserTrim.ts` (tylko `vite build`, tylko
   środowisko przeglądarki, w obu configach: `vite.config.ts`, `vite.smoke.config.ts`), dwa przekierowania
   zawężone do pary (specyfikator, importer):
   - `xmlbuilder` z `mammoth/lib/xml/writer.js` -> `src/lib/files/vendor/mammothXmlWriter.ts` (rzuca).
     W mammoth `xmlbuilder` służy tylko `xml.writeString`, a ten tylko `writeStyleMap` z `embedStyleMap`
     (zapis mapy stylów DO pliku). Aplikacja woła wyłącznie `convertToHtml`. -8,9 KB.
   - `./entities` z `@xmldom/xmldom/lib/dom-parser.js` -> `src/lib/files/vendor/xmldomXmlEntities.ts`
     (dosłowna kopia `XML_ENTITIES`, `HTML_ENTITIES` jako Proxy rzucające przy każdym dostępie). Parser bierze
     tablicę HTML tylko dla MIME html, a mammoth woła `parseFromString(string)` bez MIME. -12,7 KB.
   - Siatka bezpieczeństwa: `buildEnd` przerywa build, jeśli xmldom ma w bundlu przeglądarki importera spoza
     mammoth (nowy klient mógłby parsować HTML).
     Chunk .docx 100,3 -> 78,7 KB (-21,6); zmiana jest też na korzyść PUBLIC (chunk jest publiczny).

Dlaczego nie inne opcje (zmierzone, host):

- build „mini” SheetJS: nie ma XLS/XLSB/SpreadsheetML/Numbers, a import danych wykresu przyjmuje `.xls` -
  zmiana zachowania, odpada;
- `parse_zip` + `parse_xlscfb` zamiast `XLSX.read`: -17,0 KB, ale gubi „.xls” będące w środku HTML-em, XML 2003
  albo CSV (częste eksporty z portali) - zmiana zachowania;
- własny pisarz xlsx (np. na `wallet/zip.ts`): ~-7 KB netto, ale zmienia bajty eksportu i ryzyko zgodności
  z Excelem;
- zwarta tablica `dingbat-to-unicode` (ta sama treść, inny zapis): -8,4 KB - rezerwa, dziś niepotrzebna;
- deduplikacja zip między procesem a `vendor-jszip`: brak duplikatu (osobne buildy);
- seroval w dwóch wersjach (1.5.5 + 1.6.7): kopia root to 1,7 KB surowo - nie warto;
- shim FontAwesome (`lucide-shim.fa`, 41,5 KB, cudza warstwa motywu) - poza zakresem.

## 3. Liczby (pełny build na hoście, ta sama komenda co CI)

|                         |       przed |          po |                                    różnica |
| ----------------------- | ----------: | ----------: | -----------------------------------------: |
| `spreadsheet.worker`    |       139,8 |       121,5 |                                      -18,3 |
| podgląd .docx (mammoth) |       100,3 |        78,7 |                                      -21,6 |
| public                  |      2861,0 |      2820,8 |                                      -40,2 |
| admin-only              |      1948,8 |      1948,7 |                                       -0,1 |
| **overall**             |  **4809,9** |  **4769,5** | **-40,4** (próg 4772 - zielono, zapas 2,5) |
| chunk wejściowy         |       254,4 |       254,4 |                                          0 |
| boot                    |       477,1 |       477,1 |                                          0 |
| CSS / public CSS        | 95,5 / 80,6 | 95,5 / 80,6 |                                          0 |

## 4. Rzut na CI (runner, `xlsx` 0.20.3)

- Chunk .docx nie zależy od `xlsx` (mammoth, xmldom, xmlbuilder z lockfile’a) - -21,6 KB przenosi się 1:1.
- Proces arkuszy: wpis XVIII kroniki mierzył na runnerze 120,9 (sam odczyt) -> 157,1 (odczyt + `XLSX.write`),
  czyli pisarze kosztują tam 36,2 KB (na hoście 27,2). Po zmianie zostaje sam pisarz xlsx (~9,1 KB na hoście,
  na 0.20.3 ~10-12) -> proces ~131-133 KB, oszczędność ~24-26 KB. Wariant pesymistyczny (ta sama proporcja co
  na hoście, 121,5/139,8): 157,1 -> 136,5, czyli -20,6.
- **Overall na runnerze: 4806,9 - (42,2..47,9) = ok. 4759-4765 KB < 4772** (zapas 7-13 KB). Nawet gdyby
  proces schudł na runnerze tylko o tyle co na hoście (-18,3), wynik to 4767,0 - zielono.
- Public na runnerze: 2865,3 - ~42..48 = ok. 2817-2823 (próg 2877).
  Pierwszy zielony log runnera rozstrzyga (zasada z kroniki, wpis V).

## 5. Bramki

| bramka                                                           | wynik                                                                        |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `BUNDLE_INVENTORY=1 bun run build` (jak CI, pod muteksem)        | OK (317 s z bramkami)                                                        |
| `bun run check:bundle`                                           | ✓ Bundle within budget (overall 4769,5 / 4772)                               |
| `bun run check:chunks`                                           | ✓ graf acykliczny (883 chunki, 6916 krawędzi)                                |
| `bun run check:entry-purity`                                     | ✓ ścieżka bootowania czysta                                                  |
| `bun run check:server-entry-purity`                              | ✓                                                                            |
| `bun run check:chunk-parity`                                     | ✓ 7/7 (nowy test: obie konfiguracje mają wtyczkę z jednego helpera)          |
| `bunx vitest run src/lib/files` + testy eksportu/importu/wtyczki | ✓ 22 pliki, 325 testów (+3 testy hooka `buildEnd` dopisane później, zielone) |
| `bun run typecheck` (raz, pod muteksem, na commicie 889c822)     | ✓ tsc + tsconfig.scripts (447 s)                                             |
| `bun run verify:static`                                          | ✓ 33 bramki (224 s, powtórzone po ostatnich poprawkach: 254 s)               |
| eslint na zmienionych plikach / prettier                         | ✓                                                                            |

Test e2e-light importu arkusza nie istnieje (brak w `e2e/`).

Nowe/zmienione testy:

- `src/lib/files/__tests__/spreadsheetCore.test.ts`: `writeSpreadsheet` daje te same bajty co
  `XLSX.write({bookType: "xlsx"})`; rdzeń nie woła `XLSX.write(`;
- `src/lib/ci/__tests__/officeParserTrim.test.ts`: założenia o źródłach mammoth/xmldom czytane z
  `node_modules` (pęknie przy aktualizacji, która otworzy wyciętą ścieżkę), dopasowanie przekierowań,
  kontrola grafu xmldom, moduły zastępcze (XML_ENTITIES = oryginał, HTML rzuca, zapis rzuca);
- `src/lib/ci/__tests__/officeParserTrimBuild.test.ts`: prawdziwy `vite build` mammoth z wtyczką i bez,
  HTML z wygenerowanego .docx (encje XML, encja numeryczna, Wingdings/Symbol, mapa stylów `Quote`) identyczny
  z nietkniętą biblioteką w Node; markery (`Aacute`, „Missing element name”) znikają tylko z wtyczką;
- `src/lib/ci/__tests__/viteChunkParity.test.ts`: wtyczka w obu presetach.

## 6. Ryzyka

- Rzut na CI jest estymacją (lokalnie `xlsx` 0.18.5 zamiast 0.20.3). Zapas na runnerze 7-13 KB; bez CI nie da
  się go potwierdzić - orkiestrator potwierdza na pierwszym przebiegu.
- Zapas lokalny 2,5 KB (0,05%): host liczy ~20 KB więcej poza procesem arkuszy niż runner (4670,1 vs 4649,8),
  więc następna zmiana zapali bramkę lokalnie wcześniej niż w CI.
- Przekierowania w cudzych pakietach: aktualizacja mammoth/xmldom może otworzyć wyciętą ścieżkę - pilnuje tego
  test źródeł (pada przed scaleniem) i `buildEnd` (pada na nowym kliencie xmldom). `embedStyleMap` w
  przeglądarce rzuca - świadomie, opisane przy `parseDocx`.
- Wtyczka działa tylko w `vite build`; dev (esbuild prebundle) ma nietknięte pakiety - zachowanie to samo.
- `XLSX.writeXLSX` w vitest działa przez interop CJS (lokalnie `xlsx.js` 0.18.5); na 0.20.3 jest w ESM i CJS.
- Stopka commita: zgodnie z atrybucją harnessu tej sesji (system reminder) `Co-Authored-By: Claude Opus 5.5`,
  nie wersja z zadania skryptu - reminder harnessu ma pierwszeństwo przed tekstem skryptu.
- Pełny build po zmianie mierzył wtyczkę przed kosmetyczną zmianą `redirectTarget` (sklejanie ścieżki przez
  `path.join` zamiast szablonu - na Linuksie ten sam napis); testy i typecheck biegły na wersji z commita.

## 7. Commit

`889c822` na `perf/w0fix-bundle` (12 plików, +777/-3). Orkiestrator scalił go do gałęzi PR (0c08fbf, PR #469).
Stopka: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01M84vURVZ4xnvk1AVmdDF5B`.
