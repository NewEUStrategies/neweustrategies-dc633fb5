# Audyt martwego kodu (tylko odczyt)

Repozytorium: `/home/user/neweustrategies-dc633fb5`, HEAD `7c924ae5` (2026-10-08). W repo niczego nie zmieniano.

## Metoda

| Narzędzie                                                        | Jak użyte                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **knip 5.x**, instalacja w scratchu (`w3/diag/knip-tool`)        | Dwa przebiegi przez `light.sh`, konfiguracje poza repo:<br>- `w3/diag/knip.full.json`: wejścia to trasy, `router`/`start`/`server`, `routeTree.gen`, worker arkuszy, `scripts/**`, `e2e*/**`, `integration/**`, konfiguracje vite/vitest/playwright/eslint/drizzle i testy. Wynik w `knip.json`.<br>- `w3/diag/knip.prod.config.json` z `--production`: tylko kod produkcyjny `src/`, bez testów. Wynik w `knip.prod.json`.<br>Do załadowania `playwright.integration.config.ts` potrzebne były zmienne `EVENT_INTEGRATION_ACK`/`EVENT_INTEGRATION_BASE_URL` (tylko odczyt konfiguracji). |
| Własny graf importów (`w3/diag/py/graph.py`, wynik `graph.json`) | 7381 plików, 34 145 krawędzi. Rozwiązuje `@/`, ścieżki względne i `/src/`. Obejmuje `import()`, `vi.mock`, `new URL(..., import.meta.url)`, `.js→.ts`. Służy do ustalenia, kto importuje dany plik.                                                                                                                                                                                                                                                                                                                                                                                       |
| Indeks identyfikatorów (`w3/diag/py/verify.py`)                  | Każdy kandydat na nieużywany eksport sprawdzony słowem w `src`, `scripts`, `e2e*`, `integration`, `supabase`, `.github`, `.lovable` i plikach konfiguracyjnych w korzeniu.                                                                                                                                                                                                                                                                                                                                                                                                                |
| `w3/diag/py/exportsize.cjs` (AST TypeScriptu)                    | Rozmiar deklaracji i liczba odwołań wewnątrz pliku.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Do punktu 5                                                      | Inwentarz chunków buildu HEAD (`scratchpad/base-w3/reports/chunk-inventory.json`, `BUNDLE_INVENTORY=1`, ten sam commit `7c924ae5`). Lista żądań JS z Lighthouse na produkcji, 2026-10-08 08:54 (`w3/prod-lh/mobile-1.json`). Hashe chunków vendor są identyczne z buildem HEAD.                                                                                                                                                                                                                                                                                                           |

Pułapki wyłapane po drodze. Każda z nich wykluczyła kandydata z listy „do usunięcia”:

- **Rejestry po nazwie.** `import * as Icons from "@/lib/lucide-shim"` jest rzutowane na `Record<string, …>`, więc eksporty `lucide-shim` są osiągalne przez napis.
- **Glob w testach.** `import.meta.glob("/src/lib/i18n-*.ts")` w bramkach i18n iteruje `Object.entries(mod)` (`i18nOverlayIntegrity.gate.test.ts:295`), więc eksporty nakładek są „używane”.
- **Alias Vite.** `scripts/lib/officeParserTrim.ts:73-104` podmienia `bluebird`/`xmldom`/`dingbat` w `node_modules` na pliki `src/lib/files/vendor/*` po ścieżce w napisie. Te pliki są w bundlu klienta, chunk `index-CYoM1xgZ.js`.
- **Generatory czytające pliki przez `fs`.** `scripts/generate-icon-chunks.mjs` i `scripts/gen-email-hero-icon.mjs` czytają `lucideIconNodes.generated.ts`.
- **Kolejność rozwiązywania katalogu w Vite.** Domyślne `resolve.extensions` to `.mjs, .js, .mts, .ts…`, więc `./ui/atoms` rozwiązuje się do `index.js`, a nie `index.ts`.

---

## TL;DR

1. **Zero plików, których nie dałoby się osiągnąć z żadnego wejścia.** Jedynym realnym sierotą jest zdublowany `ui/atoms/index.js`.
2. **Około 20 plików produkcyjnych żyje wyłącznie dzięki własnym testom:** ~95 KB źródeł razem z testami. Czat, kluby, przyciski artykułu, AI gateway, `useEventConfirmedMutation` i inne.
3. **`LinkPreviewBlock.tsx` nie jest martwy, tylko niepodłączony.** To defekt opisany w testach. Nie usuwać.
4. **Do usunięcia z `package.json`:** `ai`, `@ai-sdk/openai`, `@ai-sdk/react` (zero importów). Do tego `@ai-sdk/openai-compatible` razem z `ai-gateway.server.ts`. `drizzle-orm`, `postgres` i `@typescript/native-preview` to fałszywe alarmy knipa.
5. **Pozostałości po PR #475.** Wywoływacze usunięto, kod został:
   - `defineBlockEditMatrix` z danymi (~700 linii z 1399 w `blockEditMatrix.shared.tsx`),
   - `analyzeOwnership`/`renderOwnershipReport`,
   - `analyze/render` w `migrationSize`, `migrationLaneParity` i `pgTapPlan`,
   - `scripts/lib/i18nDictionaries.ts` i `scripts/lib/pgTapTests.ts`,
   - zapisy raportów dla usuniętego `deployment-report.ts`.
6. **Wyraźne duplikaty:**

   | Helper                             | Kopie                                           |
   | ---------------------------------- | ----------------------------------------------- |
   | `prefersReducedMotion`             | 5 obok kanonicznego `lib/a11y/reducedMotion.ts` |
   | ISO ↔ `datetime-local`             | 7 nazwanych i 13 wystąpień szablonu             |
   | `escapeHtml`                       | 9 (+`htmlEscape`)                               |
   | `formatBytes`                      | 11                                              |
   | `sha256Hex`                        | 4                                               |
   | `redactEmail`                      | 3                                               |
   | PascalCase→kebab ikon              | 3                                               |
   | pomiar naturalnego rozmiaru obrazu | 4                                               |
   | bramka przesłaniania `public/`     | 2                                               |
   | `stripTsComments`                  | 3                                               |

7. **Strona główna: martwego kodu w ścisłym sensie jest tam praktycznie 0 B.** Nieużywane eksporty wypadają przy tree-shakingu, bo `sideEffects` jest zawężone. Ale `/` pobiera **około 98 KB (transfer, mobile) żywego kodu, którego `/` nie wykonuje**, z powodu współdzielenia modułów w chunkach:
   - `WidgetView` → `formFieldConfig.tsx` ciągnie kompozytor, wzmianki, Radix i `AdminSelect`: ~64 KB,
   - `FooterSlideup` leży w chunku `blog.index`, który ciągnie `FriendlyErrorPage`, locale `date-fns` i `Breadcrumbs`: ~15 KB,
   - `vendor-lucide` (19,5 KB) dociera obiema ścieżkami.

   Szczegóły w punkcie 5.

---

## 1. Nieużywane pliki

knip w pełnym trybie zgłosił 7 plików. W trybie produkcyjnym zgłosił 74; 47 z nich to legalne wejścia skryptów albo bramek vitest (`src/lib/ci/*`, `src/lib/builder/migrate/*`, `src/lib/i18n/widgetTranslationFill.ts`). Klasyfikacja poniżej. Rozmiary w bajtach.

### 1a. SAFE: brak odwołań w kodzie, testach, skryptach i CI

| Plik                                             | Rozmiar | Dowód                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------ | ------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/admin/builder/ui/atoms/index.js` |     543 | Treść identyczna z `index.ts` (sprawdzone `diff`). Vite rozwiązuje `./ui/atoms` najpierw do `.js`, więc to `.js` trafia dziś do bundla. Po usunięciu Vite weźmie identyczny `index.ts`. Żadnych odwołań poza `docs/ANALIZA_MODULOW_DOGLEBNA_2026-08-12.md:1023-1025`, które same zalecają usunięcie. **Uwaga:** knip zgłasza odwrotnie `index.ts`. To fałszywy alarm, a `index.ts` musi zostać, bo `tsconfig` nie ma `allowJs`. |
| `scripts/lib/pgTapTests.ts`                      |     294 | `PGTAP_TESTS_DIR` bez importerów. Jedyny konsument, `scripts/check-pgtap-plan.ts`, zniknął w #475.                                                                                                                                                                                                                                                                                                                              |
| `scripts/lib/i18nDictionaries.ts`                |   3 210 | `loadDictionaries` bez importerów. Konsumenci, skrypty `check-i18n-*`, zniknęli w #475. Wzmianka tylko w `docs/WDROZENIE_WARSTWA_JEZYKOWA_I_TYPY_2026-08-15.md`.                                                                                                                                                                                                                                                                |
| `scripts/test-picker.mjs`                        |     387 | Jednorazowy skrypt debugujący (`insertContainerAt` i `console.log`). Brak odwołań.                                                                                                                                                                                                                                                                                                                                              |
| `scripts/taxonomy/features.d.mts`                |     493 | Deklaracje typów dla `.mjs`. Ostatni importer z TS (`check-feature-taxonomy.ts`) zniknął w #475. Wzorzec `scripts/**/*.ts` w `tsconfig.scripts.json` nie obejmuje `.d.mts`. Same `features.mjs`, `moduleMap.mjs` i `report.mjs` żyją: używa ich `scripts/audit/verify-edition-*.mjs`, a ręczne CLI `report.mjs` jest opisane w docs.                                                                                            |
| `scripts/taxonomy/moduleMap.d.mts`               |     495 | j.w.                                                                                                                                                                                                                                                                                                                                                                                                                            |

### 1b. TEST-ONLY: kod produkcyjny osiągalny wyłącznie z własnych testów

Kandydaci do usunięcia razem z testem. Zweryfikowane grafem importów i grepem nazwy w całym repo:

- brak rejestrów po napisie,
- brak `lazy()` z napisem,
- brak dynamicznych importów z szablonem (`grep 'import(\`'`daje 0 w`src/`),
- tylko wzmianki w komentarzach.

| Plik produkcyjny (rozmiar)                                                                                                                                                            | Importerzy (wyłącznie testy)                                                                                                                                   | Uwagi                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/chat/ChatBell.tsx` (10 983)                                                                                                                                           | `chat/__tests__/ChatBell.test.tsx` (8 588)                                                                                                                     | Do tego martwy `vi.mock("@/components/chat/ChatBell")` w `widget-view/__tests__/accountMenuWidget.test.tsx:44`. `AccountMenuWidget` już go nie importuje, więc mock trzeba zdjąć.                                             |
| `src/components/chat/ChatDock.tsx` (6 478)                                                                                                                                            | `chat/__tests__/ChatDock.test.tsx` (10 312)                                                                                                                    | Zastąpiony przez `WorkspaceDock`. Nagłówek pliku („Mounted once in SiteChrome”) jest nieaktualny.                                                                                                                             |
| `src/components/clubs/molecules/ClubThreadPulse.tsx` (4 274) i `src/lib/clubs/threadDynamics.ts` (4 728)                                                                              | `clubs/__tests__/clubPresentationPulse.test.tsx` (11 544, testuje tylko tę parę i ClubActivityStrip) oraz `lib/clubs/__tests__/threadDynamics.test.ts` (7 541) | —                                                                                                                                                                                                                             |
| `src/components/clubs/molecules/ClubActivityStrip.tsx` (2 493) i `src/lib/clubs/activityStrip.ts` (3 598)                                                                             | `clubPresentationPulse.test.tsx` (j.w.) oraz `lib/clubs/__tests__/activityStrip.test.ts` (5 705)                                                               | —                                                                                                                                                                                                                             |
| `src/components/clubs/atoms/ClubRegimeMark.tsx` (2 723)                                                                                                                               | `clubs/__tests__/clubAtomChips.test.tsx`, test współdzielony z 7 innymi atomami                                                                                | Usunąć tylko sekcję testu.                                                                                                                                                                                                    |
| `src/components/clubs/molecules/ClubSpecializationSelect.tsx` (2 685)                                                                                                                 | `clubs/__tests__/clubSelects.test.tsx`, test współdzielony                                                                                                     | j.w.                                                                                                                                                                                                                          |
| `src/components/footer/CopyrightBar.tsx` (1 905)                                                                                                                                      | `footer/__tests__/footerChrome.test.tsx` (współdzielony, `describe("CopyrightBar")`)                                                                           | `footerLinksByGroup()` (`lib/seo/footerNavigation.ts:99`) ma jedynego konsumenta w tym pliku. Przed usunięciem potwierdzić, że linki prawne („wymóg operatora płatności”) renderuje obecny `Footer.tsx` przez `FOOTER_LINKS`. |
| Łańcuch `src/components/post/MobileArticleActions.tsx` (2 847) → `src/components/audio/ArticleListenButton.tsx` (3 949) → `src/components/post/atoms/ArticleActionButton.tsx` (2 335) | `post/__tests__/postPresentational.test.tsx`, `audio/__tests__/audioOrganisms.test.tsx`, `post/atoms/__tests__/postAtoms.test.tsx` (wszystkie współdzielone)   | Cały łańcuch nieosiągalny z tras.                                                                                                                                                                                             |
| `src/components/admin/pricing/TierFeatureTogglesEditor.tsx` (3 364)                                                                                                                   | `admin/pricing/__tests__/pricingEditors.test.tsx` (współdzielony)                                                                                              | —                                                                                                                                                                                                                             |
| `src/lib/ai-gateway.server.ts` (6 866)                                                                                                                                                | `lib/__tests__/platformAiGateway.test.ts` (9 852)                                                                                                              | Scaffold Lovable („Lovable AI gateway”). Po usunięciu zwalnia `@ai-sdk/openai-compatible` (punkt 2). Lovable może go odtworzyć przy włączaniu AI.                                                                             |
| `src/lib/brandIconRegistry.ts` (1 249) i `src/lib/icons/iconNames.ts` (1 716)                                                                                                         | `lib/__tests__/brandIcons.test.ts` (7 239)                                                                                                                     | Nagłówek `iconNames.ts` opisuje, że poprzednik (`DynamicIconFull.tsx`) usunięto z tego samego powodu: jedynym klientem był test. `LucideIconPicker` importuje bezpośrednio `iconNames.generated.json`.                        |
| `src/lib/clubs/membershipSignals.ts` (3 325)                                                                                                                                          | `lib/clubs/__tests__/membershipSignals.test.ts` (3 705)                                                                                                        | Wzmianka w regexie `scripts/taxonomy/features.mjs:58` jest kosmetyczna.                                                                                                                                                       |
| `src/lib/events/speakerCardMotion.ts` (8 351)                                                                                                                                         | `lib/events/__tests__/speakerCardMotion.test.ts` (15 909)                                                                                                      | FLIP karty prelegenta, nigdy niepodpięty. `SpeakerProfileCard` go nie importuje.                                                                                                                                              |
| `src/lib/realtime/useEventConfirmedMutation.ts` (4 746)                                                                                                                               | `useEventConfirmedMutation.test.tsx` (4 863) i `useEventConfirmedMutationBranches.test.tsx` (17 416)                                                           | Infrastruktura optymistycznych mutacji bez żadnego użycia.                                                                                                                                                                    |
| `src/lib/newsletter-builder/schema.ts` (6 244)                                                                                                                                        | 4 testy w `lib/newsletter-builder/__tests__/` (współdzielone)                                                                                                  | **Sprawdzić przed usunięciem.** Nagłówek mówi „Used server-side to validate saves”, a takiej walidacji w kodzie nie ma. Albo martwe, albo zgubione podłączenie (jak `LinkPreviewBlock`).                                      |

Łącznie TEST-ONLY: ~95 KB plików produkcyjnych i dedykowanych testów, bez testów współdzielonych.

**Zasiewy i18n F1-F5.** Osiągalne tylko przez `import.meta.glob` w bramkach i18n, więc to raczej decyzja produktowa niż czyste SAFE:

- pliki: `src/lib/i18n-event-plan.ts`, `i18n-event-calendar.ts`, `i18n-event-ticket-actions.ts`, `i18n-event-follow-up.ts`, `i18n-admin-event-offers.ts`, `i18n-admin-event-follow-up.ts`,
- rozmiar: 6 plików, 8 170 B, każdy z jednym kluczem `title`,
- kontrakt zasiewu pilnował `participantOverlays.test.ts`, usunięty w #475; od tamtej pory nikt ich nie czyta.

Usunięcie wymaga zdjęcia wpisów w dwóch miejscach:

- `F1_F5_SEED_ROOTS` w `src/lib/__tests__/overlayReaders.test.ts:49`,
- markerów w `scripts/check-entry-purity.ts:184-225`. Brak markera bramki nie wywraca, ale wpis zostałby martwy.

### 1c. RISKY albo „nie usuwać”: osiągalność przez napis, rejestr lub fs, albo celowy stan

| Plik                                                                                                                     | Dlaczego knip widzi go jako nieużywany                                                           | Werdykt                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/admin/blocks/edit/LinkPreviewBlock.tsx` (5 056)                                                          | `BlockEditRenderer` nie ma `case "link-preview"`                                                 | **NIE usuwać.** Udokumentowane brakujące podłączenie: `blockEditorRegistryParity.test.ts:18-33` (z `it.fails`) i `blockEditContracts.test.ts:122-131` (oczekuje `["LinkPreviewBlock"]`). Naprawa to jeden `case`. |
| `src/lib/files/vendor/{dingbatToUnicode,mammothPromises,mammothXmlWriter,xmldomXmlEntities}.ts` (~14 KB)                 | Podpinane aliasem w `scripts/lib/officeParserTrim.ts:73-104`                                     | Żywe, w bundlu klienta (`index-CYoM1xgZ.js`). Ich „nieużywane” eksporty (np. `nfcall`) woła kod `mammoth` z `node_modules`.                                                                                       |
| `src/lib/icons/lucideIconNodes.generated.ts` (484 790)                                                                   | Czytany przez `fs` w `scripts/generate-icon-chunks.mjs:6` i `scripts/gen-email-hero-icon.mjs:6`  | Źródło generatorów. Nie jest w bundlu. Zostaje.                                                                                                                                                                   |
| `src/lib/ci/*` (47 plików), `src/lib/builder/ci/*`, `src/lib/builder/migrate/*`, `src/lib/i18n/widgetTranslationFill.ts` | Importowane przez `scripts/check-*.ts`, `split-migration.ts`, `generate-*.ts` albo bramki vitest | Żywe narzędzia CI. Wyjątek: `staticAssetShadowing.ts` duplikuje `publicAssetShadowing.ts` (punkt 4).                                                                                                              |
| `src/assets/events/ggm-2021/*.asset.json` (34 pliki, 16 486 B) i `src/assets/quiz-fans-bg.png.asset.json`                | Wskaźniki assetów Lovable (R2, `/__l5e/assets-v1/...`), nieimportowane z kodu                    | Adresy mogą siedzieć w treściach CMS w bazie, a usunięcie wskaźnika może pozwolić platformie zebrać obiekt. Nie usuwać bez sprawdzenia bazy.                                                                      |

### 1d. Skrypty bez odwołań w `package.json` i CI (narzędzia ręczne, opisane w docs)

Zostawić; to jednorazowe narzędzia, nie martwy kod:

- `scripts/audit/verify-edition-12.mjs`, `verify-edition-13.mjs`,
- `scripts/deploy-order-proof.sh`, `scripts/migrate-with-preflight.sh`,
- `scripts/gen-email-hero-icon.mjs`, `scripts/gen-lucide-icon-nodes.mjs`, `scripts/generate-dotted-world.ts`,
- `scripts/measure-cms-chunks.py`, `scripts/measure-home-ssr.ts`,
- `scripts/migrate-cv-to-private.ts`,
- `scripts/performance/whatif/{c3-lcpobs,js-low-priority,js-no-preload-low}.mjs`: eksperymenty z `docs/performance/2026-10-03-*`, najsłabsi kandydaci do zachowania.

### 1e. Martwe artefakty i odwołania po #475 (nie pliki kodu)

- **Zapis raportu `reports/widget-fidelity.json`** w `src/components/admin/builder/__tests__/settingsFidelity.gate.test.tsx:465-515`. Komentarz mówi „JSON leci ZAWSZE - konsumuje go `scripts/deployment-report.ts`”, a ten skrypt usunięto w #475.
- **Zapis `reports/i18n-parity.json`** w `src/__tests__/i18nParity.gate.test.ts:10,350` z tym samym uzasadnieniem. Plik `reports/i18n-parity.json` (8 557 B) jest commitowany, ale nikt go nie czyta: brak odwołań w `.github` i `scripts`.
- **Nieaktualne komentarze** odsyłające do nieistniejących skryptów: `check:widget-fidelity`, `check:ci-gates` (`vitest.setup.ts:36`, `widgetPanelValues.ts:13`), `scripts/check-editor-autosave.ts` (`Editable.test.tsx:707`).
- **Repozytoryjny `knip.json` jest niepełny.** Nie ma wejść `src/server.ts`, `scripts/**`, workera ani `vite.config.ts`, a `project` pomija `e2e-*` i `integration`. Uruchomiony z nim knip zgłaszałby fałszywe sieroty. Wzór poprawnej konfiguracji: `w3/diag/knip.full.json`.

---

## 2. Zależności w `package.json`

Każdą pozycję sprawdzono grepem w `src`, `scripts`, `e2e*`, `integration`, konfiguracjach w korzeniu, `.github/workflows`, `.lovable` i `supabase`. Sprawdzono też, czy któryś zainstalowany pakiet nie deklaruje jej jako peer (`@lovable.dev/*`).

| Pakiet                                     | Sekcja          | Werdykt                      | Dowód                                                                                                                                                                                                                                          |
| ------------------------------------------ | --------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai`                                       | dependencies    | **SAFE do usunięcia**        | 0 importów i 0 wzmianek poza `bun.lock`. Żaden zainstalowany pakiet go nie wymaga.                                                                                                                                                             |
| `@ai-sdk/openai`                           | dependencies    | **SAFE**                     | 0 importów. Jedyna wzmianka to komentarz w `ai-gateway.server.ts:5` („nie używaj `createOpenAI`”).                                                                                                                                             |
| `@ai-sdk/react`                            | dependencies    | **SAFE**                     | 0 wzmianek.                                                                                                                                                                                                                                    |
| `@ai-sdk/openai-compatible`                | dependencies    | **TEST-ONLY**                | Używa go tylko `src/lib/ai-gateway.server.ts:8` (sam TEST-ONLY) i mock w `platformAiGateway.test.ts:4`. Usuwać razem.                                                                                                                          |
| `drizzle-orm`, `postgres`                  | devDependencies | Fałszywy alarm, **zostawić** | Runtime'owe zależności CLI `drizzle-kit`: `node_modules/drizzle-kit/bin.cjs` ma `import("postgres")` i 11× `require("drizzle-orm")`. Pas migracji Lovable: `drizzle.config.ts`, `LOVABLE_DB_MIGRATION_URL`, 179 plików w `drizzle/migrations`. |
| `@typescript/native-preview`               | devDependencies | Fałszywy alarm               | Dostarcza binarkę `tsgo` (`typecheck:tsc`, `typecheck:e2e`); knip nie mapuje binarki na pakiet.                                                                                                                                                |
| `tailwindcss`, `tw-animate-css`            | dependencies    | Fałszywy alarm               | `@import` w `src/styles.css:1,16`.                                                                                                                                                                                                             |
| `@tailwindcss/vite`, `vite-tsconfig-paths` | dependencies    | Używane                      | Peer `@lovable.dev/vite-tanstack-config`; `vite-tsconfig-paths` także w `vitest.config.ts:2`. Można je ewentualnie przenieść do `devDependencies`; na bundel Workera to nie wpływa.                                                            |
| `entities`                                 | dependencies    | Używane                      | Alias przypinający 4.5.0 w `vite.config.ts` (`resolve.alias`).                                                                                                                                                                                 |

**Problem odwrotny: pakiety niezadeklarowane.** Działają dziś dzięki hoistingowi, ale mogą się wywrócić przy aktualizacji zależności. Kandydaci do jawnego dopisania:

- `@tanstack/router-core`: `src/routes/__root.tsx`, `src/routes/$.tsx`, `src/routes/index.tsx`, `src/router.tsx`, `src/components/atoms/AppLink.tsx`, `src/lib/builder/aboveFold.tsx`, `widget-view/RichHtmlView.tsx`,
- `@tiptap/core`: `admin/blocks/edit/Heading.tsx`, `Paragraph.tsx`, `inlineEntities/InlineEntityExtension.ts`,
- `@tanstack/router-generator`: `scripts/gen-routes.mjs`,
- tylko w testach: `esbuild`, `rollup`, `bluebird`, `@xmldom/xmldom`, `dingbat-to-unicode`, `@testing-library/dom`, `@tanstack/router-ssr-query-core`, `@tanstack/query-core`.

---

## 3. Nieużywane eksporty w używanych modułach

knip w pełnym trybie (testy liczą się jako użycie) zgłosił 635 eksportów wartości i 1855 typów.

Wykluczone jako RISKY: `src/lib/i18n-*.ts` (glob z iteracją eksportów), `lucide-shim.tsx` (namespace rzutowany na rekord) i `files/vendor/*` (alias).

Po wykluczeniach:

- **56 eksportów całkowicie martwych:** 0 odwołań w innych plikach i 0 odwołań w swoim pliku. Każdy sprawdzony indeksem słów; kluczowe dodatkowo `grep -rnw`.
- **354 eksporty „tylko słowo `export”`:** symbol używany w swoim pliku, więc wystarczy zdjąć `export`. Lista w `w3/diag/exports.exportonly.json`.
- **1563 typy** bez odwołań na zewnątrz. Nie wymieniam, niska wartość.

Top 50 martwych (rozmiar deklaracji w bajtach, liczba linii):

|   # | Symbol                         | Miejsce                                                                      | B / linie    | Kontekst                                                                                                                                                                                                                                                                                                                                                                      |
| --: | ------------------------------ | ---------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | `defineBlockEditMatrix`        | `src/components/admin/blocks/edit/__tests__/blockEditMatrix.shared.tsx:1157` | 11 231 / 243 | Pozostałość #475: wywoływały go `blockEditMatrix.part1-6.test.tsx`. Kaskada: po usunięciu martwe są też `editorsOf` (:1142), `EXTREME_DATA` (:501), `RICH_DATA` (:621), `ALT_DATA` (:736), `INVALID_DATA` (:848), `PREVIEW_ONLY` (:365) i `COERCION_DEFECTS` (:384). Razem ok. 700 z 1399 linii. Zostają `ALL_EDITORS`, `ALL_EDITOR_NAMES`, `MATRIX_SLICES` i `renderEditor`. |
|   2 | `renderOwnershipReport`        | `src/lib/ci/ownership.ts:1009`                                               | 6 740 / 158  | Pozostałość #475 (`check-ownership.ts`). `generate-codeowners.ts` używa tylko `parseRegistry` i `renderCodeowners`.                                                                                                                                                                                                                                                           |
|   3 | `analyzeOwnership`             | `src/lib/ci/ownership.ts:858`                                                | 5 043 / 130  | j.w. Kaskada: `attributeMigrations` (:742), `attributeRoutes` (:370), `matchIdentifier` (:688).                                                                                                                                                                                                                                                                               |
|   4 | `analyzeMigrationSizes`        | `src/lib/ci/migrationSize.ts:81`                                             | 2 940 / 76   | Pozostałość #475 (`migrationSize.gate.test.ts`).                                                                                                                                                                                                                                                                                                                              |
|   5 | `analyzeMigrationLanes`        | `src/lib/ci/migrationLaneParity.ts:1133`                                     | 2 865 / 83   | Pozostałość #475 (`migrationLaneParity.test.ts`).                                                                                                                                                                                                                                                                                                                             |
|   6 | `renderLaneReport`             | `src/lib/ci/migrationLaneParity.ts:1221`                                     | 795 / 11     | j.w.                                                                                                                                                                                                                                                                                                                                                                          |
|   7 | `renderPgTapPlanReport`        | `src/lib/ci/pgTapPlan.ts:273`                                                | 783 / 17     | Pozostałość #475 (`check-pgtap-plan.ts`).                                                                                                                                                                                                                                                                                                                                     |
|   8 | `HANDLED_EVENT_TYPES`          | `src/lib/billing/webhookDispatch.server.ts:540`                              | 510 / 20     | —                                                                                                                                                                                                                                                                                                                                                                             |
|   9 | `collectMigrationSizes`        | `src/lib/ci/migrationSize.ts:188`                                            | 424 / 12     | #475                                                                                                                                                                                                                                                                                                                                                                          |
|  10 | `renderSizeReport`             | `src/lib/ci/migrationSize.ts:158`                                            | 406 / 9      | #475                                                                                                                                                                                                                                                                                                                                                                          |
|  11 | `editorsOf`                    | `blockEditMatrix.shared.tsx:1142`                                            | 338 / 10     | #475                                                                                                                                                                                                                                                                                                                                                                          |
|  12 | `analyzePgTapPlans`            | `src/lib/ci/pgTapPlan.ts:235`                                                | 309 / 8      | #475                                                                                                                                                                                                                                                                                                                                                                          |
|  13 | `maTresc`                      | `src/lib/ci/i18nForms.ts:36`                                                 | 263 / 5      | —                                                                                                                                                                                                                                                                                                                                                                             |
|  14 | `catalogEntry`                 | `src/test/billing/fixtures.ts:182`                                           | 246 / 10     | Fikstura testowa.                                                                                                                                                                                                                                                                                                                                                             |
|  15 | `seriesTextColors`             | `src/lib/charts/palette.ts:905`                                              | 228 / 5      | —                                                                                                                                                                                                                                                                                                                                                                             |
|  16 | `seriesColors`                 | `src/lib/charts/palette.ts:898`                                              | 216 / 5      | —                                                                                                                                                                                                                                                                                                                                                                             |
|  17 | `kluczeFormy`                  | `src/lib/ci/i18nForms.ts:51`                                                 | 215 / 4      | —                                                                                                                                                                                                                                                                                                                                                                             |
|  18 | `isActionApplicable`           | `src/lib/clubs/types.ts:1190`                                                | 183 / 6      | —                                                                                                                                                                                                                                                                                                                                                                             |
|  19 | `safeExternalFetch`            | `src/lib/http/egressGuard.server.ts:108`                                     | 183 / 4      | Wszyscy konsumenci wołają `assertPublicHttpUrl` bezpośrednio.                                                                                                                                                                                                                                                                                                                 |
|  20 | `featureGatesFor`              | `src/lib/ci/authzGates.ts:387`                                               | 181 / 3      | —                                                                                                                                                                                                                                                                                                                                                                             |
|  21 | `routesGuestViewOnly`          | `src/lib/ci/publicRouteLoaders.ts:1133`                                      | 177 / 3      | —                                                                                                                                                                                                                                                                                                                                                                             |
|  22 | `EVENT_LOCATION_FIELDS`        | `src/lib/events/eventGeneralDraft.ts:100`                                    | 173 / 8      | —                                                                                                                                                                                                                                                                                                                                                                             |
|  23 | `SAMPLE_POST_NUMBERS`          | `src/lib/builder/ci/sampleTokens.ts:79`                                      | 166 / 4      | —                                                                                                                                                                                                                                                                                                                                                                             |
|  24 | `isKnownDomainEventType`       | `src/lib/realtime/domainEvents.ts:177`                                       | 151 / 3      | —                                                                                                                                                                                                                                                                                                                                                                             |
|  25 | `toClubAttributionMode`        | `src/lib/clubs/types.ts:367`                                                 | 146 / 3      | Druga wzmianka to komentarz w :372.                                                                                                                                                                                                                                                                                                                                           |
|  26 | `ga4ViewItem`                  | `src/lib/analytics/ga4Ecommerce.ts:40`                                       | 145 / 3      | —                                                                                                                                                                                                                                                                                                                                                                             |
|  27 | `NES_LOGO_LIGHT`               | `src/lib/email-templates/nes-layout.tsx:21`                                  | 141 / 2      | —                                                                                                                                                                                                                                                                                                                                                                             |
|  28 | `isEmptyLinkPreview`           | `src/lib/blocks/linkPreview.ts:166`                                          | 127 / 3      | —                                                                                                                                                                                                                                                                                                                                                                             |
|  29 | `ADAPTER_KINDS`                | `src/lib/integrations/formats.ts:28`                                         | 111 / 5      | —                                                                                                                                                                                                                                                                                                                                                                             |
|  30 | `pgTapPlanFailed`              | `src/lib/ci/pgTapPlan.ts:244`                                                | 106 / 3      | #475                                                                                                                                                                                                                                                                                                                                                                          |
|  31 | `laneParityFailed`             | `src/lib/ci/migrationLaneParity.ts:1217`                                     | 104 / 3      | #475                                                                                                                                                                                                                                                                                                                                                                          |
|  32 | `datePickerSink`               | `src/test/ticker/tickerPaneStubs.ts:122`                                     | 100 / 3      | Fikstura testowa.                                                                                                                                                                                                                                                                                                                                                             |
|  33 | `RELATED_POSTS_BOUNDS`         | `src/lib/relatedPosts/panelRules.ts:13`                                      | 97 / 1       | —                                                                                                                                                                                                                                                                                                                                                                             |
|  34 | `tickerPreviewSink`            | `src/test/ticker/tickerPaneStubs.ts:44`                                      | 95 / 3       | Fikstura testowa.                                                                                                                                                                                                                                                                                                                                                             |
|  35 | `EMPTY_AGENDA_FILTER`          | `src/lib/events/agendaSurface.ts:450`                                        | 95 / 1       | —                                                                                                                                                                                                                                                                                                                                                                             |
|  36 | `flipFadeKeyframes`            | `src/lib/events/speakerCardMotion.ts:171`                                    | 94 / 3       | Plik i tak TEST-ONLY.                                                                                                                                                                                                                                                                                                                                                         |
|  37 | `setClubAuthUser`              | `src/test/clubs/fixtures.ts:80`                                              | 93 / 3       | Fikstura testowa.                                                                                                                                                                                                                                                                                                                                                             |
|  38 | `SUPPRESSING_KINDS`            | `src/lib/email/deliveryEvents.ts:56`                                         | 89 / 1       | —                                                                                                                                                                                                                                                                                                                                                                             |
|  39 | `DEFAULT_CLUB_MIN_TIER_RANK`   | `src/lib/clubs/planTiers.ts:47`                                              | 86 / 1       | —                                                                                                                                                                                                                                                                                                                                                                             |
|  40 | `LEGAL_ENTITY_FORM`            | `src/lib/legal/registration.ts:23`                                           | 79 / 1       | —                                                                                                                                                                                                                                                                                                                                                                             |
|  41 | `PAYMENT_PROVIDER_SUPPORT_URL` | `src/lib/legal/entity.ts:31`                                                 | 76 / 1       | —                                                                                                                                                                                                                                                                                                                                                                             |
|  42 | `GLOBAL_SOCIALS_SETTINGS_PATH` | `src/lib/social/globalSocialLinks.ts:23`                                     | 75 / 1       | —                                                                                                                                                                                                                                                                                                                                                                             |
|  43 | `SCORE_BANDS`                  | `src/lib/crm/scoring.ts:85`                                                  | 72 / 1       | —                                                                                                                                                                                                                                                                                                                                                                             |
|  44 | `SPEAKER_CARD_SETTLE`          | `src/lib/events/speakerCardMotion.ts:45`                                     | 64 / 1       | —                                                                                                                                                                                                                                                                                                                                                                             |
|  45 | `LEGAL_ICON_NAMES`             | `src/lib/legal/icons.ts:108`                                                 | 64 / 1       | —                                                                                                                                                                                                                                                                                                                                                                             |
|  46 | `GLOBAL_SOCIALS_ADMIN_HREF`    | `src/lib/social/globalSocialLinks.ts:26`                                     | 64 / 1       | —                                                                                                                                                                                                                                                                                                                                                                             |
|  47 | `EMPTY_AGENDA`                 | `src/lib/events/agendaSurface.ts:129`                                        | 57 / 1       | —                                                                                                                                                                                                                                                                                                                                                                             |
|  48 | `SPEAKER_CARD_LARGE_PX`        | `src/components/events/public/molecules/SpeakerProfileCard.tsx:27`           | 53 / 1       | —                                                                                                                                                                                                                                                                                                                                                                             |
|  49 | `toNetworkDegree`              | `src/lib/network/degree.ts:104`                                              | 47 / 1       | Alias `normalizeDegree`.                                                                                                                                                                                                                                                                                                                                                      |
|  50 | `__txCopyForTests`             | `src/lib/email/transactional.server.ts:490`                                  | 39 / 1       | Hak testowy, z którego nie korzysta żaden test.                                                                                                                                                                                                                                                                                                                               |

Pozostałe 6 to drobne stałe: `CLUB_NOTICE_*` (`clubs/networkTypes.ts:44-47`), `EVENT_GENERAL_MAX_SLUG`/`_URL` (`eventGeneralDraft.ts:44,48`), `TERMS_MAX_DESCRIPTION`. Lista w `w3/diag/exports.dead.json`.

Największe pozycje „tylko słowo `export`” (do zdjęcia słowa `export`; bez zysku w bundlu):

- `relatedAffinityQueryOptions` (`lib/queries/relatedPosts.ts:214`),
- `OrganizationPersonCard` (`components/organizations/OrganizationPeople.tsx:35`),
- `TogglePreview` (`admin/ThemeOptionsPane.tsx:2032`),
- `useCvPrint` (`author/CvPrintSheet.tsx:32`),
- `buildNewsletterFieldLabels` (`newsletter/newsletterFieldLabels.ts:93`),
- `renderAuthEmailPreview` (`email/auth-preview.server.ts:90`).

---

## 4. Zduplikowane implementacje (tylko oczywiste przypadki)

1. **`prefersReducedMotion`.** Kanon: `src/lib/a11y/reducedMotion.ts:11`; nagłówek mówi „JEDNO miejsce odczytu”, kanon ma też `try/catch`. Lokalne kopie bez `try/catch`:
   - `src/components/careers/atoms/CareerStat.tsx:14`,
   - `src/components/careers/organisms/CareersValues.tsx:47`,
   - `src/components/clubs/organisms/ClubHub.tsx:134`,
   - `src/components/footer/BackToTop.tsx:10`,
   - `src/components/molecules/PostListCard.tsx:90` (chunk strony głównej).
2. **ISO ↔ wartość `<input type="datetime-local">`.** Ten sam szablon `${getFullYear()}-${pad(getMonth()+1)}-…T${pad(getHours())}:${pad(getMinutes())}`:
   - nazwane, ISO → wartość pola: `src/lib/content/workflow.ts:94` (eksport, z odwrotnością `localInputToIso` w :103), `src/components/admin/builder/ui/organisms/widget-properties/EventCountdownEditor.tsx:26`, `src/lib/events/meetingWindowDraft.ts:47`, `src/routes/admin.newsletter.campaigns.$id.tsx:76`, `src/lib/events/meetingsSettingsDraft.ts:81`, `src/lib/events/sessionDraft.ts:89`, `src/lib/events/ticketDraft.ts:140`,
   - odwrotności, wartość pola → ISO: `meetingWindowDraft.ts:58`, `admin.newsletter.campaigns.$id.tsx:85`, `meetingsSettingsDraft.ts:90`, `sessionDraft.ts:101`, `ticketDraft.ts:152`, `onsiteDraft.ts:79`,
   - inline: `AdminDatePicker.tsx`, `coupons/DatePickerField.tsx`, `newsletter/builder/PropertiesPanel.tsx`, `clubs/adminClubGroupForm.ts`, `clubs/workspaceForms.ts` (razem 13 wystąpień szablonu).
3. **`escapeHtml`.** Dwa warianty semantyczne; nadzbiór z `'` jest bezpieczny w każdym kontekście:
   - bez `'`: `src/components/community/ticketDocument.ts:39`, `src/lib/billing/exportHistory.ts:25`, `src/lib/blocks/wordPaste.ts:309`, `src/lib/events/badgePrintDocument.ts:34`, `src/lib/manualToc.ts:100`,
   - z `'`: `src/lib/citations/format.ts:179`, `src/lib/crm/leadTimeline.ts:94`, `src/lib/events/seatPlanPrintDocument.ts:31`, `src/lib/organizations/inviteEmail.ts:20` i `htmlEscape` w `src/lib/seo/ampStory.ts:31`,
   - pokrewne: `escapeAttr` ×4 (`blocks/inlineEntities/expand.ts:55`, `content/enhanceImages.ts:65`, `footnotes.ts:224`, `ssrSanitizeHtml.ts:198`).
4. **`formatBytes`.** 11 kopii z drobnymi różnicami (wielkość „kB”, pusta wartość, locale). Para identyczna algorytmicznie: `src/components/clubs/molecules/ClubDocumentRow.tsx:19` (już eksportowana) i `src/components/clubs/organisms/ClubDocumentLibrary.tsx:70`. Pozostałe:
   - `admin/media/lib/mediaFormat.ts:7`,
   - `admin/performance/EdgeCacheCard.tsx:26`,
   - `admin/post-editor/molecules/TtsVoiceCard.tsx:25`,
   - `clubs/organisms/ClubPostCard.tsx:90`,
   - `profile/sections/ProfileExtraSections.tsx:1037`,
   - `lib/chat/attachments.ts:72`,
   - `lib/crm/profileSyncView.ts:10`,
   - `routes/admin.library.tsx:74`,
   - `routes/library.tsx:93`.
5. **`sha256Hex`.** Kanon `src/lib/events/scannerHash.ts:23` (eksport, z fallbackiem `@noble/hashes`). Kopie: `src/lib/billing/catalogAutoSync.server.ts:40`, `src/lib/content/feedback.functions.ts:10`, `src/lib/wordpress-import.functions.ts:285` (wariant `ArrayBuffer`).
6. **`redactEmail`.** 3 identyczne: `src/routes/platform/email/auth/webhook.ts:58`, `src/routes/platform/email/suppression.ts:41`, `src/routes/platform/email/transactional/send.ts:31`.
7. **`originFromRequest`.** Identyczne: `src/lib/contact.functions.ts:115` i `src/lib/newsletter.functions.ts:79`. Asynchroniczny wariant: `src/lib/newsletter-campaigns.functions.ts:193`. Inna semantyka, z nagłówków: `routes/api/public/community-cron.ts:96`.
8. **Normalizacja nazw ikon.**
   - PascalCase→kebab, ten sam łańcuch 3 regexów: `src/lib/icons/iconNames.ts:25` (`pascalToKebabIconName`, TEST-ONLY), `src/lib/icons/lazyNamedIcon.ts:25` (inline), `src/lib/icons/curatedIconNames.ts:180` (w `normalizeIconName`). Komentarz w `iconNames.ts:20-24` sam przyznaje duplikację.
   - kebab→Pascal: `src/lib/icons/DynamicIcon.tsx:312` (`toPascalKey`) i `curatedIconNames.ts:172`. Uwaga przy unifikacji: `DynamicIcon` ma własny chunk `dynamic-icon` w `manualChunks`.
9. **Pomiar naturalnego rozmiaru obrazu.** Te same `new Image()`, `onload` i flaga anulowania:
   - `src/components/admin/media/hooks/useImageNaturalSize.ts:10` (hook, związany z `MediaRow`),
   - `src/components/admin/builder/ui/organisms/widget-properties/ImageSlot.tsx:114-132`,
   - `src/routes/admin.seo.social.tsx:106-125`,
   - wersja z obietnicą: `src/lib/media/imageCrop.ts:102` (`getImageDimensions`).
10. **Bramka „plik z `public/` przesłania trasę”, dwie implementacje tego samego inwariantu.** `src/lib/ci/publicAssetShadowing.ts` (skrypt `check:public-assets`) i `src/lib/ci/staticAssetShadowing.ts` (vitest: `describe("repository invariant")` w `src/lib/ci/__tests__/staticAssetShadowing.test.ts:122`).
11. **`stripTsComments`, 3 parsery:**
    - `scripts/lib/stripComments.ts:17`: bramka SQL, `ci/publicRouteLoaders.ts`, `ci/telemetryRedaction.ts`,
    - `scripts/lib/sqlMigrations.ts:139`: `check-sql-rpc-contract.ts`,
    - `scripts/lib/stripTsComments.ts:35`: jedyny konsument to `checkout/__tests__/embeddedCheckoutLazyBoundary.test.tsx`; tylko ta wersja obsługuje literały regexów.

---

## 5. Strona główna: co z martwego (i zbędnego) kodu trafia do bundla klienta

**Martwy kod w ścisłym sensie: praktycznie 0 B.**

- **Pliki.** Żaden z 74 plików nieosiągalnych produkcyjnie nie występuje w inwentarzu chunków. Wyjątkiem są `files/vendor/*`, które są żywe przez alias.
- **Eksporty.** W domknięciu bootu i komponentu `/` jest 57 nieużywanych eksportów wartości. Rollup je wycina, bo `package.json` ma `"sideEffects"` zawężone do CSS i `i18n*.ts`, a `bytes` w inwentarzu to `renderedLength` po tree-shakingu. Całkowicie martwe są tam tylko 3 stałe tekstowe (`PAYMENT_PROVIDER_SUPPORT_URL`, `GLOBAL_SOCIALS_*`), również wycinane.
- **Nakładki i18n.** Są `sideEffects`, więc jadą w całości. W wejściu są `i18n-public`, `i18n-event-head`, `i18n-mobile-drawer` i `i18n-event-sponsor-report-head` (~9 KB przed minifikacją). Używają ich `head()` tras i to nie jest martwy kod.
- **`manualChunks`** w `vite.config.ts`: wszystkie 3 reguły plikowe (`ui/sonner.tsx`, `icons/DynamicIcon.tsx`, `clubs/atoms/ClubThreadKindIcon.tsx`) wskazują istniejące pliki i dają realne chunki. Martwych reguł brak.

**Zbędny dla `/` żywy kod pobierany na `/`.** Pomiar: Lighthouse mobile na produkcji, 2026-10-08, lista żądań w `w3/prod-lh/mobile-1.json`. Przyczyny potwierdzone w inwentarzu HEAD.

### A. Moduł mieszany `src/lib/builder/formFieldConfig.tsx`: ~64 KB transferu

`WidgetView.tsx:14` importuje stamtąd tylko czysty parser `parseCustomFields`. Ten sam moduł eksportuje jednak `CustomFieldsRenderer` (dla `JoinUsForm`), który statycznie importuje:

- `FormSelect` → `euCountries` → `AdminSelect` → `ui/select` → `vendor-radix-select`,
- `MessageComposerField` → `ComposerShell` (tooltip, czyli chunk `LayoutPreview` z adminowym `LayoutPreview.tsx`, i `vendor-radix`) oraz `useMentionAutocomplete`.

Na `/` pobrane (transfer, mobile):

| Chunk                    |     Transfer |
| ------------------------ | -----------: |
| `vendor-radix`           |       37 718 |
| `vendor-radix-select`    |        7 510 |
| `useMentionAutocomplete` |        5 613 |
| `MessageComposerField`   |        3 930 |
| `LayoutPreview`          |        2 492 |
| `AdminSelect`            |        2 489 |
| `formFieldConfig`        |        2 183 |
| `euCountries`            |        2 115 |
| **Razem**                | **64 050 B** |

Na `/` nie ma innego konsumenta `vendor-radix`: brak `RichTextView`, `CommandPalette` i tras klubu. Naprawa: wydzielić `parseCustomFields` i resztę czystej logiki do osobnego modułu `.ts` bez komponentów.

### B. `FooterSlideup` współdzielony z chunkiem `blog.index`: ~15 KB, plus udział w `vendor-lucide`

Komponent `/` (`index-DSR9IWtx.js`) potrzebuje z `blog.index-D0HZqT4-.js` tylko `FooterSlideup`. Chunk niesie jednak cały komponent `/blog` i jego statyczne zależności:

- `events._slug_.cfp-submit-*.js` (`FriendlyErrorPage` 12,8 KB, `AuthGate`, `programs/visual`, ~25 stubów `tsr-shared`),
- chunk z locale `date-fns` pl+en-US (`pl-BSzh2kC4.js` w HEAD, na produkcji `pl-Ry-nquQH.js`: 6 553 B),
- `Breadcrumbs` (1 631).

Transfer: `blog.index` 2 452 + `cfp-submit` 4 194 + `date-fns` 6 553 + `Breadcrumbs` 1 631 = **14 830 B**.

### C. `vendor-lucide` (19 497 B transferu)

Na `/` docierają tylko ikony spoza `vendor-lucide-boot`, i to dwiema drogami: z `FriendlyErrorPage` (B) oraz z `MessageComposerField`/`useMentionAutocomplete` (A). Zniknie dopiero po przecięciu obu.

### D. Mniejsze „pasażery” scalania małych chunków (`experimentalMinChunkSize: 2048`)

- `sponsorReportLabels.ts` dociąga się z `gtagLoadPolicy` (import dynamiczny z wejścia),
- `eventBrandingDraft.ts` (studio wydarzeń) z `carouselDefaults` dla `sliderVariants`,
- `require-staff.ts` z `parseCsv` przez `PopupImage`,
- w samym wejściu `index-*.js` są adminowe `AdminFormSection`, `AdminCatalogListState`, `logFilters`, `useTenantAuthors`, `postRouteParams` i `CrmEventActivityLink` (~3,9 KB przed minifikacją), mimo że importują je wyłącznie leniwe chunki admina.

### E. Obserwacja, nie martwy kod

W chunku wejściowym siedzi 226 modułów opcji tras `src/routes/admin*` (96 KB przed minifikacją, z 333 KB wszystkich tras i 62 KB `routeTree.gen.ts`). To konsekwencja podziału tras (`scripts/lib/routeCodeSplitting.ts`), a nie nieużywany kod; warto zmierzyć, ile z `head`/`beforeLoad`/`validateSearch` da się przenieść do części dzielonej.

Łączny potencjał A + B + C: **około 98 KB transferu na mobile**, bez usuwania funkcji. Kody leżą głównie poza ścieżką LCP (zestaw bootu w trybie `lcp`), więc zysk dotyczy przede wszystkim TBT i liczby bajtów, a nie samego LCP. Potwierdzić pomiarem.

---

## Artefakty (scratch, poza repo)

Wszystkie w `/tmp/claude-0/-home-user-neweustrategies-dc633fb5/57088803-e7ea-5e89-8c05-954276daf4ba/scratchpad/w3/diag/`:

| Plik                                      | Zawartość                                                   |
| ----------------------------------------- | ----------------------------------------------------------- |
| `knip.full.json`, `knip.prod.config.json` | Konfiguracje knipa                                          |
| `knip.json`, `knip.prod.json`             | Surowe wyniki                                               |
| `graph.json`                              | Graf importów (`edges` i `importers`)                       |
| `exports.verified.json`                   | Wszystkie zgłoszenia z rozmiarem i listą plików ze wzmianką |
| `exports.dead.json`                       | 56 całkowicie martwych eksportów                            |
| `exports.exportonly.json`                 | 354 eksporty do zdjęcia słowa `export`                      |
| `boot-modules.txt`                        | Moduły `src` w domknięciu bootu i komponentu `/` z bajtami  |
| `py/`                                     | Skrypty analizy                                             |
