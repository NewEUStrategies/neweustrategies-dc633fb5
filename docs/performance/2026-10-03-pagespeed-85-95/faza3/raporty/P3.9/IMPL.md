# P3.9 (fala 3, partia 3c): higiena grafu chunków `/` — raport wdrożenia

Gałąź `perf/w3-P3.9`, worktree `${S}/wt3/P3.9`, baza `5adde441` (wierzchołek PR po partii 2 + P3.7a + strażnik
przeładowań + P3.8). `${S}` = `/tmp/claude-0/-home-user-neweustrategies-dc633fb5/57088803-e7ea-5e89-8c05-954276daf4ba/scratchpad`.
Commit: **`cf1076b8`** (jeden commit na `5adde441`). Po buildzie zmieniłem już tylko komentarz nagłówka
`customFieldDefs.ts`, więc artefakt odpowiada commitowi. Build, inwentarz i `.output` zostają w worktree.
Porównanie: A = `${S}/base-w3e` (zbudowana baza orkiestratora), B = ten worktree (`BUNDLE_INVENTORY=1 bun run build:smoke`).

## 0. Werdykt

- **Część A (formFieldConfig) wdrożona zgodnie z planem.** `WidgetView` nie importuje już niczego z
  `formFieldConfig`. Czysta logika pól własnych przeszła 1:1 do nowego `customFieldDefs.ts`, który importuje wyłącznie
  `formFieldConfig.tsx` (reeksport). Parsowanie surowej treści wykonuje `JoinUsForm` w swoim leniwym chunku (nowy prop
  `customFieldsSource`). Z domknięcia `WidgetView`, ładowanego na `/`, wypada **9 chunków: 227 413 B raw, 75 310 B
  gzip-9** (osiem z planu oraz `vendor-lucide`).
- **Część B (FooterSlideupSlot) NIE weszła.** Zmierzyłem dwa warianty w buildzie i oba są na bazie `5adde441` gorsze od
  stanu wyjściowego (§3). Przesłanka planu, czyli łańcuch `/blog` na `/`, na tej bazie już nie istnieje: P3.8 powiększył
  `FooterSlideup.tsx` do osobnego chunku. Pliki tras zostają bez zmian.
- Bramka planu `p39-graph-check.py` na końcowym buildzie: **WYNIK: OK, 0 naruszeń** (baza `5adde441`: 12 naruszeń).
  Domknięcie komponentu `/` jest identyczne z bazą (22 chunki, 3 908 995 B), a chunk wejściowy ma bajt w bajt ten sam
  `renderedLength` (1 481 373 B).

## 1. Zmiany plik po pliku

| Plik                                                                                      | Zmiana                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/builder/customFieldDefs.ts` (nowy)                                               | Typy `CustomFieldType`/`CustomFieldOption`/`CustomFieldDef`, `isCustomFieldDef` (prywatny), `parseCustomFields`, `pickI18n`, `resolveCustomFieldLabel`/`Placeholder`, `validateCustomFields`. Kod przeniesiony **bajt w bajt** (`diff` dawnych linii 19–133 z nowym plikiem jest pusty). Bez Reacta i bez importów wartości. Nagłówek PL opisuje granicę chunków: importuje go wyłącznie `formFieldConfig.tsx`, nie wolno go importować z wejścia ani z dyspozytora widgetów. |
| `src/lib/builder/formFieldConfig.tsx`                                                     | Czysta część zastąpiona reeksportem (`export { parseCustomFields, pickI18n, … } from "./customFieldDefs"` i `export type { … }`). Renderer bierze `resolveCustomFieldLabel`/`Placeholder` i `CustomFieldDef` z `./customFieldDefs`. Publiczne API bez zmian, a `formFieldConfig.test.tsx` przechodzi bez edycji. Nagłówek uzupełniony o akapit PL.                                                                                                                            |
| `src/components/interests/JoinUsForm.tsx` (plik P3.8, kotwice na kodzie)                  | `useMemo` w imporcie React, `parseCustomFields` w imporcie z `formFieldConfig` i nowy prop `customFieldsSource?: unknown` (komentarz PL). `cfList = useMemo(() => customFields ?? parseCustomFields(customFieldsSource), [customFields, customFieldsSource])`. `customFields` ma pierwszeństwo, a `parseCustomFields(undefined)` daje `[]`. Bramki zapytań P3.8 nietknięte. Hook stoi przed pierwszym `return`.                                                               |
| `src/components/builder/organisms/WidgetView.tsx`                                         | Usunięty import `parseCustomFields` i `const customFields = …`. Zamiast tego `customFieldsSource={c.customFields}` z komentarzem PL: dyspozytor jest na `/`, `formFieldConfig` ciągnął Radix Select, kompozytor i wzmianki.                                                                                                                                                                                                                                                   |
| `src/components/interests/__tests__/joinUsForm.test.tsx`                                  | Nowy blok `pola własne z surowej treści widgetu (P3.9)`. Sprawdza: linia `stringArray` renderuje pole, a wartość trafia do payloadu; wymagalność z surowej treści blokuje wysyłkę; `customFields` ma pierwszeństwo; wadliwa linia i obiekt bez typu są pomijane; brak i pusta treść nie dodają pól.                                                                                                                                                                           |
| `src/components/builder/organisms/__tests__/widgetViewJoinUsCustomFields.test.tsx` (nowy) | Test grafu ŁADOWANIA (nie tekstu źródła): fabryka `vi.mock` liczy wykonania `formFieldConfig`. (1) Import dyspozytora go nie wykonuje. (2) Widget `join-us` z surowym `customFields` (linia JSON + wadliwa linia) renderuje pole przez prawdziwy leniwy `JoinUsForm`, a moduł pól wykonuje się wtedy dokładnie raz.                                                                                                                                                           |

Pliki tras (`index.tsx`, `blog.index.tsx`, `search.tsx`, `$.tsx`, `ArchiveBody.tsx`), `FooterSlideup.tsx`, testy tras,
`vite*.config.ts` i `i18n.ts`: **bez zmian**.

## 2. Dowód (build `smoke` worktree, bez Lighthouse)

### 2.1 Bramka grafu (`${S}/phase3/plan345/p39/p39-graph-check.py`)

- Baza `5adde441`: 12 naruszeń, wszystkie w domknięciu `WidgetView` (`formFieldConfig`, `euCountries`/`FormSelect`,
  `AdminSelect`, `vendor-radix-select`, `@radix-ui/react-select`, `vendor-radix`, `MessageComposerField`/`ComposerShell`,
  `LayoutPreview`, `useMentionAutocomplete`, `vendor-lucide`). Komponentu `/blog`, `FriendlyErrorPage`, `Breadcrumbs`
  ani locale `date-fns` na tej bazie już nie ma: po P3.8 `FooterSlideup` ma własny chunk.
- P3.9 (końcowy build): **0 naruszeń, exit 0**. Wynik w `${S}/phase3/wave3/P3.9/graph-check-final.txt`, inwentarz w
  `${S}/phase3/wave3/P3.9/chunk-inventory-final.json`.
  - `customFieldDefs.ts` i `formFieldConfig.tsx` są w `JoinUsForm-*.js` (dynamiczny, jeden importer statyczny, czyli
    `club.apply`).
  - `WidgetView-*` importuje już tylko `vendor-react`, wejście i `vendor-tanstack`.
- Różnica domknięcia `WidgetView` poza domknięciem komponentu `/` (pliki z `.output/public/assets`, gzip-9;
  `${S}/phase3/wave3/P3.9/widgetview-diff.txt`):

| usunięty chunk             |         raw |     gzip-9 |
| -------------------------- | ----------: | ---------: |
| `vendor-radix`             |     112 017 |     36 752 |
| `vendor-lucide` (nie-boot) |      63 342 |     18 587 |
| `vendor-radix-select`      |      18 628 |      6 601 |
| `useMentionAutocomplete`   |      11 781 |      4 703 |
| `MessageComposerField`     |       7 414 |      3 020 |
| `LayoutPreview`            |       4 470 |      1 582 |
| `AdminSelect`              |       4 018 |      1 583 |
| `formFieldConfig`          |       3 139 |      1 275 |
| `euCountries`              |       2 604 |      1 207 |
| **razem (9 żądań)**        | **227 413** | **75 310** |

`WidgetView` sam: 10 729 → 10 674 B raw. Komponent `/` bez zmian (4 055 B).

- Na liście żądań JS `/` z planowania (`base-m1-js.txt`, fixture mobile) żaden inny pobierany chunk nie importuje
  `vendor-radix(-select)` ani `vendor-lucide` (`who.py` na inwentarzu B). Prognoza dla Lighthouse na fixture:
  **−9 żądań JS, ok. −71 KB transferu** (suma transferów tych 9 plików w `base-m1-js.txt`). Na produkcji wg diagnozy
  ok. −64 KB (A) i −19,5 KB (`vendor-lucide`). Kod jest ładowany po hydratacji przez leniwy `WidgetView`, więc zysk
  dotyczy bajtów, żądań i parsowania/kompilacji w oknie TBT, nie LCP. Potwierdzenie należy do etapu Prove.

### 2.2 Bramki artefaktu (build B)

| bramka                      | wynik                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `check:chunks`              | ✓ 894 chunki (A: 895), acykliczny, ścieżka bootowania czysta                                                                                                       |
| `check:entry-purity`        | ✓                                                                                                                                                                  |
| `check:server-entry-purity` | ✓                                                                                                                                                                  |
| `check:bundle`              | ✓ overall 4753,2 / 4772 KB (A: 4753,7). CSS 95,4 / 96 KB i public CSS 81,2 / 83 KB bez zmian. Boot closure 486,7 KB gz / **1594,0 KB raw** (A: 1594,2), 10 chunków |
| `check:document-weight`     | ✓ wszystkie progi (`${S}/phase3/wave3/P3.9/document-weight.json`)                                                                                                  |

`check:document-weight`, A (`${S}/phase3/integ-tip/document-weight.json`) → B:

| metryka                |         A |         B |                                            Δ |
| ---------------------- | --------: | --------: | -------------------------------------------: |
| `bootClosureRawBytes`  | 1 632 431 | 1 632 290 |                                     **−141** |
| `bootClosureGzipBytes` |   494 925 |   494 891 |                                      **−34** |
| `bootBurstGzipBytes`   |   572 156 |   572 124 |                                          −32 |
| `bootBurstCount`       |        26 |        26 |                                   0 (= próg) |
| `htmlRawBytes`         |   327 390 |   327 390 |                                            0 |
| `htmlGzipBytes`        |    49 528 |    49 535 | +7 (inne hasze nazw plików w zestawie bootu) |
| `preLcpTransferBytes`  |   174 703 |   174 710 |                                     +7 (jw.) |

Pozostałe 24 metryki są identyczne. Spadek domknięcia bootu bierze się z krótszej mapy zależności (`__vite__mapDeps`)
w wejściu, bo `WidgetView` ma mniej zależności do wstępnego ładowania. Kod wejścia jest ten sam.

### 2.3 Testy i bramki szybkie

- `bunx prettier --write` na dotkniętych plikach: bez zmian formatu.
- `bunx eslint` na dotkniętych plikach: 0 błędów. Ostrzeżenia `react-refresh/only-export-components` dotyczą tych samych
  eksportów funkcji co na bazie (w `formFieldConfig.tsx` przeszły z `export function` na reeksport).
- Typecheck (`typecheck-noinc.sh` przez mutex: `tsgo --noEmit`, `tsc -p tsconfig.scripts.json`, `tsgo -p tsconfig.e2e.json`):
  **exit 0**.
- `bunx vitest run` dla `formFieldConfig.test.tsx` (bez edycji), `joinUsForm.test.tsx`,
  `widgetViewJoinUsCustomFields.test.tsx`, `joinUsWidgetSizes.test.tsx` i `joinUsLegacyContent.test.tsx`:
  **5 plików, 171 passed + 4 expected fail** (oczekiwane porażki są już w `formFieldConfig.test.tsx`).
- Dodatkowo istniejące zestawy renderujące `join-us` przez `WidgetView` albo rejestr leniwych widgetów:
  `hydrationIsland.test.tsx`, `fidelityGateFindings.test.tsx`, `inlineSizeToolbar.test.tsx`,
  `widgetPropertiesPanel.test.tsx` i `eagerWidgetChunks.test.ts`: **5 plików, 523 passed**.
- **Kontrola negatywna:** z `WidgetView.tsx` i `JoinUsForm.tsx` z bazy padają 4 nowe testy: import dyspozytora wykonuje
  moduł pól, a trzy testy `customFieldsSource` nie widzą pola. Z plikami P3.9 wszystkie przechodzą.
- `bun run verify:static`: **15 bramek OK** (format:check, check:dangerous-html, bramki SQL, kontrakt TS↔SQL, …).
- `test:e2e:artifact` (środowisko jak w CI, mutex): **18 passed** (szczegóły w §6).

## 3. Część B: dlaczego nie weszła (pomiar, nie prognoza)

1. **Wariant z planu (wspólny `FooterSlideupSlot.tsx`)**, build 1, inwentarz w `reports/` tamtego przebiegu (log
   `${S}/phase3/wave3/P3.9/build1.log`): **22 naruszenia**. `FooterSlideupSlot.tsx` ma dokładnie te same wejścia co
   `useInFeedAds.tsx`, czyli pięć tras. Ten mały atom (683 + 675 B) Rollup (`experimentalMinChunkSize`) skleił z
   komponentem `/blog` w `blog.index-*.js`. Komponent `/` importował go statycznie i wróciły `events._slug_.cfp-submit`
   (`FriendlyErrorPage`), `Breadcrumbs`, `pl` (locale `date-fns`, 42 KB) i `vendor-lucide`. To dokładnie ten łańcuch, który
   plan miał usunąć, a na bazie go nie było. Wariant 1 z §7 planu miał tę samą przyczynę, a §7.2 każe go nie łatać pinem.
2. **Wariant 1 z §7 (bez wspólnego modułu: `lazy` + `ClientOnly` + `RenderErrorBoundary` lokalnie w pięciu
   miejscach)**, build 2, `${S}/phase3/wave3/P3.9/chunk-inventory-variant1.json`, diff w
   `${S}/phase3/wave3/P3.9/variant1-callsites.diff`: bramka grafu **OK**, ale **zero zysku na `/`**.
   - `FooterSlideup.tsx` jest wejściem dynamicznym, a Rollup dokleja do jego chunku `src/lib/analytics/conversions.ts`.
   - `conversions.ts` importują statycznie `PostListCard` (na `/` przez `PaginatedPostGrid`), `ContactFormView` i
     `MarketingContactFormView`.
   - Chunk paska (z koordynatorem nakładek w `sinceNavigationStart-*`) zostaje więc w statycznym domknięciu `/`.
     Domknięcie ma te same 22 chunki co baza, a komponent `/` rośnie o 630 B (7 172 → 7 802 B) przez lokalne opakowanie.
   - Maksymalny zysk B przy innym ułożeniu `conversions.ts` to 2 żądania, ok. 2,6 KB gzip (`FooterSlideup-*` 2 250 B /
     1 215 gz, `sinceNavigationStart-*` 2 786 B / 1 417 gz). Wymaga to zmiany poza listą plików (§5).
3. **Build 3 (sama część A)** = wynik końcowy z §2.

## 4. Odstępstwa od planu

1. **Część B pominięta** (§3). Pliki tras, `ArchiveBody.tsx` i atrapy w testach tras bez zmian. Plan §5.4 (przestawienie
   atrap) i §5.1 (`footerSlideupSlot.test.tsx`) odpadają razem z modułem.
2. **Gate `homeChunkBoundaries.gate.test.ts` (czytanie źródeł `readFileSync`) nie powstał.** Reguła repo w tej fali
   dopuszcza wyłącznie testy zachowania, bez testów tekstu źródła. Zastępuje go test grafu ładowania modułów
   (`widgetViewJoinUsCustomFields.test.tsx`) i bramka buildu `p39-graph-check.py`, która jako jedyna widzi scalanie
   Rollupa.
3. **Build `smoke` w etapie wdrożenia** (3×, przez mutex). Plan §6 i §7 wymagają rozstrzygnięcia wariantu na
   inwentarzu. Bez buildu wdrożyłbym wariant, który psuje `/` (§3.1). Lighthouse nie był uruchamiany.
4. Przewidywany zysk jest większy niż w planie dla samej części A (9 zamiast 8 chunków), bo `vendor-lucide` na bazie
   `5adde441` miał już tylko drogę przez `MessageComposerField`/`useMentionAutocomplete`.

## 5. Ryzyka

- **Typ `customFieldsSource: unknown`** jest słabszy. `customFields?: CustomFieldDef[]` zostaje i ma pierwszeństwo, a
  testy pilnują obu ścieżek. Na serwerze i kliencie parsuje ten sam kod w tym samym komponencie, więc HTML/hydratacja
  bez różnic (pole renderuje się z tej samej treści).
- **Tożsamość `cfList`**: wcześniej nowa tablica w każdym renderze `WidgetView`, teraz `useMemo` po referencji surowej
  treści. `cfList` nie jest zależnością żadnego efektu (tylko walidacja przy wysyłce, pętla payloadu i renderer), więc
  zachowanie się nie zmienia.
- **Kruchość scalania Rollupa**: wynik grafu zależy od rozmiarów modułów. P3.10 S0 (KRYTYKA) i tak ma powtórzyć
  `p39-graph-check.py`. Część A jest odporna, bo `customFieldDefs.ts` ma te same wejścia co renderer i siedzi w jego
  atomie, bez scalania.
- `scripts/taxonomy/features.mjs:612` wymienia `formFieldConfig` we wzorcu `cms-builder-fields`. Plik nie jest używany
  przez żaden skrypt ani bramkę (taksonomia zdjęta w PR #475), więc nowego `customFieldDefs.ts` tam nie dopisałem (poza
  listą plików).
- Komentarze w `formFieldConfig.test.tsx` wskazują numery linii dawnego `formFieldConfig.tsx`. Są nieaktualne, ale
  plan każe zostawić test bez edycji jako dowód zgodności API. Do sprzątnięcia w P3.10.

## 6. Do sprawdzenia przez recenzenta

- `customFieldDefs.ts`: przeniesienie 1:1 (porównać z `git show 5adde441:src/lib/builder/formFieldConfig.tsx`, linie
  19–133). Reeksport w `formFieldConfig.tsx` obejmuje cały dawny publiczny zestaw, także martwy `pickI18n` (decyzja
  P3.10).
- `JoinUsForm.tsx`: `useMemo` przed pierwszym `return`, kolejność hooków bez zmian. Pierwszeństwo `customFields`.
- `WidgetView.tsx`: komentarz JSX między atrybutami (`//` w liście atrybutów, poprawny TSX, prettier go zachowuje).
- Inwentarz końcowy: `-- src/lib/builder/customFieldDefs.ts: assets/JoinUsForm-*.js` i brak naruszeń.
- Etap Prove: Lighthouse fixture mobile/desktop4x (−9 żądań JS, `vendor-radix`/`vendor-lucide`/`formFieldConfig` nieobecne
  w `network-requests`, FCP/LCP ±0,02 s, kierunek ΔTBT ≤ 0) oraz e2e formularza „Dołącz do nas”, jeśli jest
  specyfikacja z polami własnymi (w `e2e/` takiej nie znalazłem).

### Wynik e2e artefaktu

`test:e2e:artifact` na buildzie B (końcowym, sama część A), środowisko jak w CI (`NES_ARTIFACT_FIXTURE=1`, atrapy
`SUPABASE_*`), przez mutex: **18 passed** (`${S}/phase3/wave3/P3.9/e2e-artifact.log`). W zestawie są: `boot-artifact`
(hydratacja bez niezgodności i kontrola negatywna), `boot-home` pl/en i sesja, `backend-quiet.boot-home` (zero żądań
Supabase w boocie), `boot-timing`, `legal-links.boot-home` i `motion-gate.boot-home`. Strona główna fixture ma widget
`join-us`, więc przebieg obejmuje nową ścieżkę `customFieldsSource` (bez pól własnych w treści). Specyfikacji e2e
formularza „Dołącz do nas” z polami własnymi w repo nie ma. Pola własne z surowej treści sprawdzają testy jednostkowe
(§2.3). Specyfikacji nakładek i stopki (`on-demand-overlays`, `ssr-degradation`) nie uruchamiałem: część B nie weszła,
więc pasek stopki i nakładki są bez zmian.
