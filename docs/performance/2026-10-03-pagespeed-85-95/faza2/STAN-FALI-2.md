# Stan fali 2 (w toku, 2026-10-05)

Fala 2 programu PSI 85/95 według `PLAN-FALE-1-2.md` §3 i §6 oraz `PROMPTY-FALA-2.md`. Dokument jest aktualizowany po
każdej scalonej partii; werdykt bramki fali dopisze orkiestrator po partii 3.

## 1. Baza W2

- **W2 = `78356a7a`**: `main` z falami 0 i 1 (PR #469, #472) oraz PR #475 (CI tylko z bramkami chroniącymi produkcję).
  Worktree bazy zbudowany `BUNDLE_INVENTORY=1 bun run build:smoke` (2 min 12 s).
- Bramki na bazie:

| Bramka                               | Wynik                        | Liczby                                                                                                                                                                                 |
| ------------------------------------ | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check:bundle`                       | czerwone (tak jak na `main`) | overall 4790,9 KB > 4772; public 2841,9 / 2877; CSS 95,4 / 96 KB gz; public CSS 81,1 / 83; boot 477,3 KB gz / 1570,7 KB raw                                                            |
| `check:chunks`, `check:entry-purity` | zielone                      |                                                                                                                                                                                        |
| `check:document-weight`              | zielone 25/25                | `htmlRawBytes` 391,5 / 396,7 KB; `htmlGzipBytes` 55,5 / 56,4; `headRawBytes` 25,3 / 26,0; `inlineStyleCount` 50 / 50; `dehydratedStateBytes` 63,7 / 64,9; `modulepreloadCount` 25 / 25 |
| `format:check`                       | zielone                      |                                                                                                                                                                                        |

- Zapasy, które ograniczają falę: CSS klienta ok. 0,6 KB gz (P2.4, P2.6), `headRawBytes` ok. 0,7 KB (P2.1),
  `inlineStyleCount` 0.

## 2. A/A bazy z transformacją C3 (szum dla dowodów P2.2–P2.6)

`lighthouse-local.mjs --compare base base --runs 4 --forms mobile,desktop4x --client-backend fixture --html-transform
c3-lcpobs.mjs --html-transform-b c3-lcpobs.mjs`; 16/16 przebiegów ważnych.

| Forma     | TBT A / B (mediana) | FCP           | LCP    | SI            | perf    | CLS           |
| --------- | ------------------- | ------------- | ------ | ------------- | ------- | ------------- |
| mobile    | 366 / 410 ms        | 1,54 s        | 2,30 s | 1,65 / 1,61 s | 89 / 88 | 0,000         |
| desktop4x | 442 / 420 ms        | 0,44 / 0,41 s | 0,54 s | 0,62 / 0,68 s | 81 / 82 | 0,006 / 0,004 |

- Pary mobile: TBT σΔ 121 ms, MDE(t) 252 ms, MDE(z) 169 ms; FCP σΔ 0,042 s; SI σΔ 0,032 s. Efekty TBT pojedynczych
  pozycji poniżej ok. 170 ms rozstrzyga księga zadań, nie mediana.
- desktop4x: przebieg B-2 odstaje (TBT 1749 ms), stąd σΔ 630 ms; |ΔFCP| A/A 0,029 s (ponad próg 0,02 s).
- Przebieg A mobile-3 ma LCP 4,78 s przy 2,26–2,30 s w pozostałych: do obejrzenia przy wyzwalaczu P2.1.
- CLS desktop 0,004–0,006 jest na bazie (nagłówek i sekcja `…0029`, `STAN-FALI-1.md` §7 pkt 9) i przypisany do P2.3.

## 3. Pozycje

| Id                                   | Partia | Stan                                               | Raporty                 |
| ------------------------------------ | ------ | -------------------------------------------------- | ----------------------- |
| P2.5 dieta dehydratacji              | 1a     | w toku (implementacja, recenzja, dowód)            | –                       |
| P2.6 dieta znaczników                | 1a     | w toku                                             | –                       |
| P2.4 hydratacja per widget, animacje | 1b     | w toku                                             | –                       |
| P2.3 nagłówek w oknie                | 1b     | w toku                                             | –                       |
| P2.2 wyspy sekcji i stopki           | 2      | po partii 1                                        | –                       |
| P2.1 boot po LCP                     | 3      | spike (krok 0) zielony, plan A; reszta po partii 2 | `raporty/P2.1-SPIKE.md` |

## 4. Spike P2.1 (krok 0): parytet zielony, plan A

Commit `fe6ccfce` na gałęzi roboczej `perf/w2-P2.1`, jeszcze nie w gałęzi PR. Szczegóły: `raporty/P2.1-SPIKE.md`.

- `scripts/lib/bootAfterLcpPlugin.ts` (tylko build, środowisko `ssr`) przepisuje `tanstack-start-manifest:v`: puste
  `preloads` tras i korzenia, skrypt wejścia przeniesiony do serwerowego manifestu bootu. `<HeadContent>/<Scripts>`,
  kolektor `Link` i odwodniony manifest klienta renderują to samo.
- Sonda Playwright na artefakcie: `/`, `/en`, strona buildera `/$` (dwa fixture), `/welcome` (`ssr: false`) × UA
  przeglądarki i bota `Chrome-Lighthouse` (ścieżka `allReady`) × MISS i HIT × mobile i desktop: 36/36 z hydratacją,
  0 błędów hydratacji, `console.error` identyczne z bazą, markup SSR identyczny po normalizacji.
- 0 `modulepreload` w `<head>`, w `Link` z frameworka i w manifeście klienta (baza 11–62).
- Plan B (transformacja strumienia w `src/server.ts`) niepotrzebny i gorszy: renumeracja grafu `$R[n]` seroval w
  locie, łańcuch wrażliwy na tożsamość odpowiedzi albo koszt CPU workera przy każdym HIT.
- **Decyzje orkiestratora:** wykrywanie chunku wejścia w `scripts/check-entry-purity.ts` i
  `scripts/check-bundle-size.ts` (dziś regex na `scripts` manifestu, po spike'u czerwone) przechodzi do P2.1 jako
  uzupełnienie zakresu, bo P2.4 będzie wtedy scalone; rusztowanie spike'u w `__root.tsx` zastępuje `bootManifest.ts`
  - `bootSet.server.ts` (wstrzyknięcie w wrapperze `router.options.dehydrate`) + `BOOT_LOADER_SCRIPT` w `<head>`.
- Do P3.4: zestaw bootu `/$` ma 62 URL-e (sama trasa 53 preloady, w tym chunk komponentu błędu).

## 5. Zmiany procesu względem dokumentów fali

- `workflow-faza2-wave.js` czyta dla fali 2 `PROMPTY-FALA-2.md`, §3 planu fal i `STAN-FALI-1.md` §7; środowisko z
  `args`; kroki ciężkie przez `heavy-bg.sh` bez opakowań `bash -c`.
- Agenci nie odtwarzają bramek i testów usuniętych w PR #475 (decyzja właściciela); testy z list własności, których
  już nie ma, zastępują skupione testy zachowania.
- Zamiast osobnych baz W2 w dwóch ramionach rozgrzewki (`--warm-ua browser` i `bot`) przed falą: A/A z C3 (§2);
  baza w obu ramionach zostanie zmierzona w porównaniu bramki fali (A = W2-baza, B = W2-koniec).
- Uzupełnienia zakresu przypisane przed startem: P2.5 – `carouselDefaults.ts` (`queryFn` z `safeParse` idącym
  ścieżką błędu); P2.3 – CLS desktop nagłówka i sekcji `…0029` oraz F9–F11 (ticker).
