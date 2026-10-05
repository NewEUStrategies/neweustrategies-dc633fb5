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

| Id                                   | Partia | Stan                                                              | Raporty                 |
| ------------------------------------ | ------ | ----------------------------------------------------------------- | ----------------------- |
| P2.5 dieta dehydratacji              | 1a     | **scalone** (`9652d965`); dowód: struktura tak, rozmiar częściowo | `raporty/P2.5-*.md`     |
| P2.6 dieta znaczników                | 1a     | **scalone** (`afcf927c`); dowód: struktura tak, czas w szumie     | `raporty/P2.6-*.md`     |
| P2.4 hydratacja per widget, animacje | 1b     | recenzja i dowód w toku (implementacja `afa0421f`)                | –                       |
| P2.3 nagłówek w oknie                | 1b     | implementacja wznowiona po przerwie                               | –                       |
| P2.2 wyspy sekcji i stopki           | 2      | po partii 1                                                       | –                       |
| P2.1 boot po LCP                     | 3      | spike (krok 0) zielony, plan A; reszta po partii 2                | `raporty/P2.1-SPIKE.md` |

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
  uzupełnienie zakresu, bo P2.4 będzie wtedy scalone; rusztowanie spike'u w `__root.tsx` zastąpią: `bootManifest.ts`,
  `bootSet.server.ts` (wstrzyknięcie w wrapperze `router.options.dehydrate`) i `BOOT_LOADER_SCRIPT` w `<head>`.
- Do P3.4: zestaw bootu `/$` ma 62 URL-e (sama trasa 53 preloady, w tym chunk komponentu błędu).

## 4a. Partia 1a (P2.5, P2.6): scalona

Obie pozycje przeszły implementację, recenzję kontradyktoryjną (P2.5: trzy rundy, P2.6: dwie), rundy poprawek i dowód
A/B wobec bazy W2 z transformacją C3 po obu stronach (n = 5). Liczby: `raporty/P2.5-PROVE.md`, `raporty/P2.6-PROVE.md`.

| Miara (fixture `/`)                     |                  Baza |                                   P2.5 |                                                  P2.6 |
| --------------------------------------- | --------------------: | -------------------------------------: | ----------------------------------------------------: |
| `htmlRawBytes`                          |             400 880 B |                    389 642 B (−11 238) |                                    392 282 B (−8 598) |
| `htmlGzipBytes`                         |              57 039 B |                      54 983 B (−2 056) |                                       56 618 B (−232) |
| `dehydratedStateBytes` (bariera `$tsr`) |              65 199 B |     61 115 B (−4 084 raw, −0,12 KB gz) |                                             bez zmian |
| TBT mobile, mediana A → B               |                     – | 371 → 263 ms (pary −53 ms, MDE(t) 380) |                323 → 396 ms (pary +56 ms, MDE(t) 173) |
| TBT desktop4x, mediana A → B            |                     – |      nie mierzone (forma tylko mobile) |                525 → 419 ms (pary −71 ms, MDE(t) 311) |
| boot closure (gz)                       |              477,3 KB |                        478,2 KB (+0,9) |                                       477,6 KB (+0,3) |
| CLS                                     | 0,000 / 0,006 desktop |                                  0,000 | 0,000 / 0,006 desktop (to samo przesunięcie co w A/A) |

- P2.5: klucze `popup_*` znikają ze stanu SSR `/` (48 → 0); formularze inline (newsletter, join-us) i prefetch czytają
  projekcję, popup, admin i `registrationFields` zostają na pełnym kluczu; `carouselDefaults` nie idzie już ścieżką
  błędu dla poprawnych danych; ticker nie zapada się przy miękkiej zmianie języka (e2e 2/2). Estymata produkcyjna
  −3,5…−3,8 KB gz (plan: −8,4) przez przyjęte odchylenia: menu zachowuje oba języki etykiet i `ref_id` (MenuManager
  zapisuje całe drzewo z tego samego klucza), ticker bez języka w kluczu.
- P2.6: ramka widgetu, przejście obrazów slidera i szerokość kart multi-card bez powtarzanego `style=""`; kropki
  paginacji animują tylko `transform`/`opacity` (sonda CDP: A – szerokość, wysokość i kolor; B – tylko kompozytor);
  sonda `getComputedStyle` 390/820/1350 px, jasny i ciemny: 0 różnic dla 48 ramek, 25 obrazów i 20 kart. Efekt
  rozmiaru ok. 1/4 planu (pozycja obejmuje 3 z 19 powtarzalnych wartości `style`).
- Zadania ParseHTML/EvaluateScript dokumentu: kryterium „krótsze we wszystkich przebiegach” niespełnione w obu
  pozycjach; oczekiwany efekt (1–2 ms sym.) jest poniżej rozrzutu przebiegów. Rozliczenie pakietu dokumentu łącznie
  (P2.4 + P2.5 + P2.6) w bramce fali.
- Na scalonej głowie: vitest zmienionych testów 11 plików, 345 zielonych + 2 oczekiwane porażki; `typecheck` (tsc + scripts) zielony.

**Decyzje orkiestratora (partia 1a):**

1. P2.5: rozszerzenie własności o `NewsletterForm.tsx`, `JoinUsForm.tsx`, `prefetch.ts`, `NewsletterDocRenderer.tsx`
   (typ propsa), `newsletterFieldLabels.ts` i pięć plików testów – przyjęte (żadna inna pozycja fali ich nie dotyka).
2. Reguła „`check:bundle` nie gorzej niż baza”: przyjęte +0,9 KB gz bootu (P2.5, projekcje w `queryFn` są wymagane, by
   SSR, hydratacja i refetch miały jeden kształt) i +0,3 KB gz (P2.6, tabela klas ramki); progi bez zmian, overall
   czerwony jak na bazie.
3. P2.5: dodatkowe żądanie pełnych ustawień newslettera przez popup po `overlaysReady` (poza ścieżką LCP) – przyjęte.
4. P2.6: nowy test `builderWidgetNodeFrame.test.tsx` poza listą i reguła `prefers-reduced-motion` z 700 ms
   przenikaniem `opacity` (bez zmiany widocznej) – przyjęte.
5. Przekazania: ticker z językiem w kluczu i `keepPreviousData` (wymaga języka żądania w `__root.tsx`, P2.1 lub
   później); fixture bez menu (`homeFixture.ts` ignoruje embed `menus→menu_items`, więc pomiary fixture nie widzą menu
   nagłówka) – poprawka uprzęży po fali 2, żeby nie psuć porównywalności A/B w trakcie fali.

## 4b. Przerwa i wznowienie

Limit użycia sesji przerwał oba workflowy partii 1 (ok. 16:07–19:44 UTC). Wznowienie od miejsca przerwania: P2.4 od
recenzji (implementacja była zacommitowana; orkiestrator nałożył przygotowaną poprawkę testu `joinUsWidgetSizes` spoza
listy), P2.3 od przerwanej implementacji, P2.5 od rundy poprawek, P2.6 od dokończenia dowodu bez powtarzania buildu i
A/B na tym samym commicie. `main` (39 commitów Lovable) scalony do gałęzi PR bez konfliktów (`e129ca33`).

## 5. Zmiany procesu względem dokumentów fali

- `workflow-faza2-wave.js` czyta dla fali 2 `PROMPTY-FALA-2.md`, §3 planu fal i `STAN-FALI-1.md` §7; środowisko z
  `args`; kroki ciężkie przez `heavy-bg.sh` bez opakowań `bash -c`.
- Agenci nie odtwarzają bramek i testów usuniętych w PR #475 (decyzja właściciela); testy z list własności, których
  już nie ma, zastępują skupione testy zachowania.
- Zamiast osobnych baz W2 w dwóch ramionach rozgrzewki (`--warm-ua browser` i `bot`) przed falą: A/A z C3 (§2);
  baza w obu ramionach zostanie zmierzona w porównaniu bramki fali (A = W2-baza, B = W2-koniec).
- Uzupełnienia zakresu przypisane przed startem: P2.5 – `carouselDefaults.ts` (`queryFn` z `safeParse` idącym
  ścieżką błędu); P2.3 – CLS desktop nagłówka i sekcji `…0029` oraz F9–F11 (ticker).
