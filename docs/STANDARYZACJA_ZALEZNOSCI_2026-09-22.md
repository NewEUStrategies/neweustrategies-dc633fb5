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
