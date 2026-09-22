# Standaryzacja zależności - ETAP 0 i ETAP A (2026-09-22)

Zakres: porządki (ETAP 0) i skoki minor/patch (ETAP A). Majory NIE są tu ruszane.

## Punkt odniesienia (drzewo nietknięte, zgodne z `bun.lock`)

| bramka                           | wynik                                                                      |
| -------------------------------- | -------------------------------------------------------------------------- |
| `tsc --noEmit`                   | 0 błędów                                                                   |
| `eslint .`                       | 0 błędów, 245 ostrzeżeń (wszystkie `react-refresh/only-export-components`) |
| `sliderVariantCatalogs.test.tsx` | 111 passed, 2 expected fail                                                |
| `platformBuildGuards.test.ts`    | 7/7                                                                        |

Istniejący, niezależny dług: pełna suita pada na progach pokrycia dla
`src/components/admin/billing/**` i `src/components/profile/**` (komentarz przy
jobie `test-shards` w `ci.yml`). Ta czerwień jest SPRZED aktualizacji.

## 0.1 Repoint rejestru utrwalony w locku

384 rozstrzygnięcia wskazywały prywatne lustro
`europe-west*-npm.pkg.dev/lovable-core-prod/sandbox-npm-cache`, pozostałe 884 -
publiczny rejestr. Lock był niespójny sam ze sobą i instalował się wyłącznie w
sandboxie, a CI łatał go `sed`-em w KAŻDYM przebiegu.

Zrobione: wszystkie 384 wpisy przepisane na `https://registry.npmjs.org/`.
Ścieżka po prefiksie jest bajt w bajt identyczna, sumy `sha512` NIETKNIĘTE -
integralność dalej egzekwowana. Usunięte 8 kroków „Repoint lockfile to the
public npm registry" i 8 wystąpień `npm_config_registry` z `ci.yml`, `e2e.yml`,
`lighthouse.yml`; poprawione dwa komentarze opisujące usunięty krok.
Zweryfikowane: `bun install --frozen-lockfile` bez `npm_config_registry`.

## 0.2 Martwy `pnpm.overrides` - USUNIĘTY

`package.json` niósł `"pnpm": { "overrides": { "entities": "4.5.0" } }`. Bun
czyta `overrides`/`resolutions`, NIE `pnpm.overrides`, więc wpis nie zadziałał
ani razu: w drzewie stoją trzy wersje `entities` naraz - 4.5.0 (zależność
bezpośrednia), 7.0.1 (pod `happy-dom`), 8.0.0 (pod `node-html-parser` i
`parse5`).

Historia gita nie zapisuje powodu (jedyny commit dotykający tego wpisu to
squash „Work in progress"), więc nie ma czego chronić. Wpis usunięty, a NIE
przeniesiony na klucz `overrides`, bo aktywacja wymusiłaby 4.5.0 na zakresach
`^7` (`happy-dom`) i `^8` (`parse5`, `node-html-parser`) - to downgrade przez
dwa majory u cudzych zależności, czyli zmiana ryzykowna i poza zakresem tego
zlecenia. Zależność bezpośrednia `entities` zostaje na 4.5.0 (major - ETAP B).

## 0.3 Martwy `@vitest/coverage-v8` - USUNIĘTY

Potwierdzone przed usunięciem: jedyny `provider` pokrycia w repo to
`istanbul` (`vitest.config.ts:47`), a napis `coverage-v8` występował w całym
repo dokładnie raz - we wpisie `devDependencies`. Żaden config vitesta ani
`ci.yml` go nie referencjonuje.

Zysk: oba pakiety pokrycia pinują `vitest` co do wersji (`"vitest": "4.1.7"`),
więc przyszły skok vitesta wymagał ruszenia trójki. Zostaje para.

## RAPORT KOŃCOWY (ETAP 0 + ETAP A)

### Punkt odniesienia (stan nietknięty)

| bramka | przed | po |
| --- | --- | --- |
| `tsc` (tsgo --noEmit) | 0 błędów | 0 błędów |
| `eslint` | 0 błędów, 245 ostrzeżeń (wszystkie `react-refresh/only-export-components`) | 0 błędów, 245 ostrzeżeń |
| `prettier --check .` | zielone | zielone |
| `check:bundle` (overall) | **4607,3 KB > 4572 KB - CZERWONA JUŻ PRZED ZMIANAMI** | 4589,6 KB > 4572 KB (czerwona, ale o 17,7 KB mniej) |
| `check:*` (i18n-overlay-imports, i18n-hardcoded, i18n-default-value, rpc-contract, unknown-casts, clock-freeze, ssr-budgets, authz-snapshot, menu-icons, gate-coverage, dangerous-html, types-freshness) | zielone | zielone |
| suita (6 shardów) | 1 plik czerwony: `migrationLaneParity` (dług PR #385) | wszystkie shardy zielone; rejestr pasów naprawiony |

`src/routeTree.gen.ts` NIE został przepisany (żaden skok tanstacka nie ruszył
generatora). FLOORY BUNDLA NIETKNIĘTE: chunk 286, public 2826, overall 4572,
css 96, publicCss 83, boot 579. Progi pokrycia nietknięte.

### ETAP 0

| pozycja | wynik |
| --- | --- |
| 0.1 lockfile na publiczny rejestr | 384 wpisy przepisane, `sha512` nietknięte; usunięto 8 kroków „Repoint lockfile" i 8 wystąpień `npm_config_registry` z `ci.yml`/`e2e.yml`/`lighthouse.yml`; `bun install --frozen-lockfile` przechodzi bez zmiennej |
| 0.2 `pnpm.overrides.entities` | usunięte (bun tej sekcji nie czyta; w drzewie żyją 4.5.0/7.0.1/8.0.0 u cudzych zależności, więc `overrides` byłoby downgradem) |
| 0.3 `@vitest/coverage-v8` | usunięty z `devDependencies` (jedyne pokrycie to istanbul); w locku zostaje jako opcjonalny peer |
| 0.4 przypięcia | odmrożone: stripe ^22.6.2, @stripe/stripe-js ^9.16.0, @stripe/react-stripe-js ^6.10.0, axe-core ^4.13.0, prettier 3.9.8. ZOSTAJĄ: `dompurify 3.4.7` (>=3.4.8 czyta `nodeName` getterem z `Node.prototype`, w happy-dom pusty string - `<script>` przeżywa sanityzację), `@tailwindcss/oxide 4.3.3` i `nitro` (binarki/peer), `xlsx 0.20.3` (tarball CDN SheetJS), `eslint-plugin-react-refresh ^0.4.26` (0.5.7 daje 779 nowych ostrzeżeń) |

Stripe 22.6.2 wymusił dwie zmiany w kodzie: `apiVersion: "2026-08-26.dahlia"`
(`src/lib/stripe.server.ts`) i literalną unię `"payment" | "subscription"` dla
`mode` (`src/lib/billing/adhocCheckout.server.ts`) - nowy SDK typuje `mode` jako
`string & Record<never, never>`, więc `NonNullable<...>` przestało zawężać.

### ETAP A

| paczka | przed | po | uwaga |
| --- | --- | --- | --- |
| tailwindcss / @tailwindcss/vite / @tailwindcss/oxide | 4.2.x | 4.3.3 | jeden skok, build zielony |
| @tanstack/react-router | 1.170.18 | **1.170.18 (bez zmiany)** | 1.170.38 + react-start 1.168.57 = 17 błędów typów (`errorComponent` → `LazyExoticComponent`, `error: unknown`, inferencja loaderów → `never`) |
| @tanstack/react-start | 1.168.28 | **1.168.28 (bez zmiany)** | jak wyżej - para musi iść razem |
| @tanstack/react-query | 5.101.2 | **5.101.2 (cofnięte z 5.103.1)** | 5.103.1 rozbija 3 testy `src/__tests__/router.test.tsx` (kolejność `hydrate` vs `done` w strumieniu SSR) |
| @tanstack/react-router-ssr-query | 1.167.1 | **1.167.1 (cofnięte)** | cofnięte razem z react-query |
| 14 × @radix-ui/* | patrz `package.json` | podniesione | accordion 1.2.20, alert-dialog/dialog… |
| @radix-ui/react-dialog | 1.1.15 | **1.1.15 (cofnięte z 1.1.23)** | 1.1.23 przestaje zamykać okno kliknięciem w tło w happy-dom (`chartDrillDialog`) |
| @radix-ui/react-select | 2.2.6 | **2.2.6 (cofnięte z 2.3.7)** | 2.3.7 rozbija przemapowanie kolumn (`ImportCsvDialog`) i zapis profilu CRM |
| happy-dom | 20.9.0 | **20.9.0 (cofnięte z 20.14.5)** | 20.14 zmienia parsowanie stylów inline (`border: 1px solid var(--border, …)` gubi wartość, `background` z `var()` przechodzi tam, gdzie miało zniknąć) i startuje obrazy z `complete === true` przy `naturalWidth === 0`; łącznie 7 testów w 3 plikach mierzyłoby silnik DOM, nie kod |
| 50 paczek z A5 (@ai-sdk/*, ai, @supabase/supabase-js, date-fns, i18next, react-i18next, sonner, zod ^3.25.76, eslint 9.39.5, vite 7.3.6, @types/node 22.20.4…) | - | podniesione w zakresie semver | wymagało `overrides: { "prosemirror-model": "1.25.11" }` - dwie kopie w drzewie dawały 2 błędy typów |

Hartowania z A4 ZOSTAJĄ, mimo cofnięcia silnika: osłona `defineProperty` na
`navigator.sendBeacon` (`vitest.setup.ts`), asercja założenia łatki obrazów
(`sliderVariantCatalogs.test.tsx`) i jawne ustawianie stanu wczytanej okładki w
`sliderDisplaySettings.test.tsx` (`withLoadedImages`). Dzięki nim te trzy pliki
przejdą kolejny skok happy-dom bez zgadywania.

### Dług domknięty po drodze

`src/lib/ci/migrationLaneParity.ts` - dopisane wpisy `0034_mention_targets_rpc`
i `0035_user_invitations_pin_all_non_acceptance_columns` jako `drizzleOnly`:
scalenie PR #385 wstawiło na pas drizzle drugie kopie plików, które już tam
stały (0034 jest bajt w bajt tożsamy z 0033, 0035 różni się od 0031 wyłącznie
komentarzami nagłówka). Bliźniaków w pasie kanonicznym pilnują wpisy 0031/0033.

### Czego nie ruszono

majory (zod 4, lucide-react, react-day-picker, entities, eslint 10, vite 8,
vitest, @types/node 24, @testing-library/jest-dom 7, @vitejs/plugin-react 6),
`xlsx`, TypeScript poza 5.x, progi pokrycia, floory bundla,
`minimumReleaseAgeExcludes`.
