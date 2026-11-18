// Podział vendorów ARTEFAKTU SERWERA (środowisko Nitro): paczki, których potrzebuje każdy
// dokument, we własnych chunkach - poza chunkiem SDK MCP.
//
// PO CO. Nitro grupuje `node_modules` po nazwie paczki (`_libs/<paczka>.mjs`), ale Rolldown
// dokłada do grupy także ZALEŻNOŚCI jej modułów (`includeDependenciesRecursively`, domyślnie
// włączone - chroni przed cyklami chunków). O tym, która grupa zabierze paczkę współdzieloną,
// decyduje kolejność przetwarzania grup, nie graf aplikacji. Na artefakcie z 2026-11-14 grupa
// `@lovable.dev/mcp-js` zabrała `zod` (schematy tras i funkcji serwerowych - 183 importy
// w `src/`) i polyfill `performance` z `unenv`. Skutek: chunk
// `_libs/@lovable.dev/mcp-js+[...].mjs` (554 kB: SDK Model Context Protocol, ajv, jose,
// zod v4) miał 20 statycznych importerów w domknięciu routera i ewaluował się przy KAŻDYM
// pierwszym dokumencie zimnego izolatu, choć `routes/mcp.ts` ładuje SDK przez `import()`.
// Pomiar (lokalny workerd, świeży proces, 12 przebiegów na przemian): sam import tego chunku
// to +39-40 ms CPU, a `zod` osobno mieści się w szumie (0-1 ms); w profilu Node jego ewaluacja
// najwyższego poziomu (43 ms) była największa ze wszystkich modułów domknięcia. Liczby
// i metoda: docs/performance/2026-11-15-zimny-start-c2.md.
//
// CO ROBI. Dwie grupy z priorytetem wyższym niż grupa Nitro (0): Rolldown przydziela im moduły
// PIERWSZYM, więc grupa SDK MCP nie ma już czego zabrać. `zod` zawężony do wejścia paczki
// i tego, co ono ciągnie: od zod 4 `zod/index.js` eksportuje `./v4/classic/external.js`,
// a ten moduł sięga do `v4/core` i `v4/locales` (do 3.x było to `./v3/external.js`).
// `zod/v4/index.js`, `zod/v4-mini`, `zod/v4/mini` i `zod/v3` importuje wyłącznie SDK MCP
// i zostają przy nim. Ta sama funkcja w obu presetach (parytet:
// src/lib/ci/__tests__/viteChunkParity.test.ts).
//
// CZEGO NIE ZMIENIA. Zestaw modułów w artefakcie i ich kod są te same - zmienia się tylko to,
// w którym pliku `_libs/` leżą. Bundel przeglądarki i środowisko `ssr` nie są dotykane
// (opcja trafia wyłącznie do builda Nitro), a `vite dev` Nitro w ogóle nie uruchamia.
//
// STRAŻNIK. `check:server-entry-purity` (src/lib/ci/serverEntryPurity.ts, reguła domknięcia
// dokumentu): chunk SDK MCP nie może być statycznie osiągalny z loadera wejść TanStack Start.
// Zmiana kolejności grup w Rolldownie albo nowa paczka współdzielona z SDK obleje bramkę
// zamiast po cichu wrócić do ewaluacji SDK przy każdym zimnym starcie.

/** Jedna grupa `codeSplitting` Rolldowna (podzbiór pól, których tu używamy). */
export interface ServerVendorGroup {
  /** Nazwa chunku, w konwencji Nitro `_libs/<paczka>`. */
  readonly name: string;
  readonly test: RegExp;
  /** Wyższy niż 0 (grupa Nitro) = przydział przed nią. */
  readonly priority: number;
}

/**
 * Paczki bazowe każdego dokumentu, przydzielane przed grupą Nitro. `[\\/]` zamiast `/` -
 * identyfikatory modułów mają separatory systemu plików.
 */
export const SERVER_BASELINE_VENDOR_GROUPS: readonly ServerVendorGroup[] = [
  {
    name: "_libs/zod",
    test: /[\\/]node_modules[\\/]zod[\\/](?:index\.js$|v4[\\/](?:classic|core|locales)[\\/])/,
    priority: 10,
  },
  {
    name: "_libs/unenv",
    test: /[\\/]node_modules[\\/]unenv[\\/]/,
    priority: 10,
  },
];

/** Kształt opcji `rolldownConfig`, którą budujemy. */
export interface ServerVendorChunking {
  output: { codeSplitting: { groups: ServerVendorGroup[] } };
}

/**
 * Preset hostingu Lovable, który składa serwer w JEDEN plik (`inlineDynamicImports`,
 * `lovableFetchBundlePreset` w `@lovable.dev/vite-tanstack-config`). Wybiera go zmienna
 * `LOVABLE_NITRO_PRESET` w środowisku builda hostingu, nie ten plik.
 */
export const SINGLE_FILE_NITRO_PRESET = "lovable-fetch-bundle";

/**
 * Wartość opcji `rolldownConfig` Nitro. Nitro scala ją (defu) z własną konfiguracją, a tablice
 * skleja: jego grupa `node_modules` zostaje pierwsza, nasze dochodzą za nią i wygrywają
 * priorytetem, nie pozycją.
 *
 * PRESET JEDNOPLIKOWY: `undefined`. Tam nie ma chunków, więc podział niczego nie zmienia,
 * a grupy `codeSplitting` obok `inlineDynamicImports` to kombinacja, której ten build nigdy
 * nie przechodził - nie sprawdzamy jej na buildzie wdrożeniowym. Dla Nitro `undefined` to
 * brak opcji.
 */
export function serverVendorChunking(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ServerVendorChunking | undefined {
  if (env.LOVABLE_NITRO_PRESET === SINGLE_FILE_NITRO_PRESET) return undefined;
  return {
    output: { codeSplitting: { groups: SERVER_BASELINE_VENDOR_GROUPS.map((g) => ({ ...g })) } },
  };
}
