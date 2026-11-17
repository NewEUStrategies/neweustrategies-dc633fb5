// @vitest-environment node
//
// Grupy vendorów artefaktu serwera (scripts/lib/serverVendorChunks.ts): `zod` i `unenv` mają
// trafić do własnych chunków `_libs/`, zanim Rolldown dołoży je do chunku SDK MCP. Testy
// pilnują wzorców (co wchodzi do grupy, a co musi zostać przy SDK), założenia o wejściu
// paczki `zod` i kształtu opcji, którą Nitro scala ze swoją. Wynik na artefakcie pilnuje
// `check:server-entry-purity` (reguła domknięcia pierwszego dokumentu).
//
// i18n: brak treści dla użytkownika - narzędzie CI.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  SERVER_BASELINE_VENDOR_GROUPS,
  serverVendorChunking,
  SINGLE_FILE_NITRO_PRESET,
} from "../../../../scripts/lib/serverVendorChunks";

const grupa = (name: string) => {
  const found = SERVER_BASELINE_VENDOR_GROUPS.find((group) => group.name === name);
  if (!found) throw new Error(`test: brak grupy ${name}`);
  return found;
};

describe("serverVendorChunks - paczki bazowe dokumentu poza chunkiem SDK MCP", () => {
  it("grupa `zod` bierze wejście paczki i katalog `v3`, na obu separatorach ścieżek", () => {
    const { test } = grupa("_libs/zod");
    for (const id of [
      "/repo/node_modules/zod/index.js",
      "/repo/node_modules/zod/v3/types.js",
      "/repo/node_modules/zod/v3/helpers/util.js",
      "C:\\repo\\node_modules\\zod\\v3\\ZodError.js",
    ]) {
      expect(test.test(id), id).toBe(true);
    }
  });

  it("`zod/v4`, `zod/v4-mini` i paczki o podobnej nazwie zostają przy SDK MCP", () => {
    // SDK importuje `zod/v4`, `zod/v4-mini` i `zod-to-json-schema`; aplikacja ich nie używa.
    // W grupie bazowej ewaluowałyby się przy każdym pierwszym dokumencie zimnego izolatu.
    const { test } = grupa("_libs/zod");
    for (const id of [
      "/repo/node_modules/zod/v4/core/schemas.js",
      "/repo/node_modules/zod/v4-mini/index.js",
      "/repo/node_modules/zod/v4/index.js",
      "/repo/node_modules/zod-to-json-schema/dist/esm/index.js",
      "/repo/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js",
      "/repo/src/lib/zod/index.js",
    ]) {
      expect(test.test(id), id).toBe(false);
    }
  });

  it("wejście zainstalowanej paczki `zod` eksportuje wyłącznie `./v3/external.js`", () => {
    // Założenie wzorca: `import … from "zod"` w `src/` kończy się w `zod/v3`. Wersja paczki,
    // która przepnie wejście na v4, zapali ten test, zanim grupa zacznie łapać nie ten kod.
    const entry = readFileSync(resolve(process.cwd(), "node_modules/zod/index.js"), "utf8");
    const specifiers = [...entry.matchAll(/from\s*["']([^"']+)["']/g)].map((match) => match[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    expect([...new Set(specifiers)]).toEqual(["./v3/external.js"]);
  });

  it("grupa `unenv` bierze całą paczkę polyfilli, nie paczki o wspólnym przedrostku", () => {
    const { test } = grupa("_libs/unenv");
    expect(test.test("/repo/node_modules/unenv/dist/runtime/polyfill/performance.mjs")).toBe(true);
    expect(test.test("C:\\repo\\node_modules\\unenv\\dist\\runtime\\node\\process.mjs")).toBe(true);
    expect(test.test("/repo/node_modules/unenv-nightly/dist/runtime/node/process.mjs")).toBe(false);
    expect(test.test("/repo/node_modules/@cloudflare/unenv-preset/dist/index.mjs")).toBe(false);
  });

  it("każda grupa ma priorytet wyższy niż grupa Nitro i nazwę w konwencji `_libs/`", () => {
    expect(SERVER_BASELINE_VENDOR_GROUPS.map((group) => group.name)).toEqual([
      "_libs/zod",
      "_libs/unenv",
    ]);
    for (const group of SERVER_BASELINE_VENDOR_GROUPS) {
      // Grupa Nitro (`test: /node_modules/`) nie podaje priorytetu, czyli ma 0.
      expect(group.priority, group.name).toBeGreaterThan(0);
    }
  });

  it("`serverVendorChunking()` oddaje opcję Rolldowna z kopiami grup pod `output.codeSplitting`", () => {
    const config = serverVendorChunking({});
    if (!config) throw new Error("brak opcji dla presetu z podziałem na chunki");
    expect(Object.keys(config)).toEqual(["output"]);
    expect(Object.keys(config.output)).toEqual(["codeSplitting"]);
    expect(config.output.codeSplitting.groups).toEqual([...SERVER_BASELINE_VENDOR_GROUPS]);
    // Nitro scala konfigurację w miejscu (defu) - wspólna tablica między presetami niosłaby
    // zmiany jednego builda do drugiego.
    expect(config.output.codeSplitting.groups[0]).not.toBe(SERVER_BASELINE_VENDOR_GROUPS[0]);
    expect(serverVendorChunking({})?.output.codeSplitting.groups).not.toBe(
      config.output.codeSplitting.groups,
    );
  });

  it("preset jednoplikowy hostingu nie dostaje grup podziału", () => {
    // `lovable-fetch-bundle` buduje serwer z `inlineDynamicImports`: chunków nie ma, więc
    // podział jest bezprzedmiotowy, a kombinacji z grupami nie testuje żaden nasz build.
    expect(
      serverVendorChunking({ LOVABLE_NITRO_PRESET: SINGLE_FILE_NITRO_PRESET }),
    ).toBeUndefined();
    // Każda inna wartość (także nieznana, którą konfiguracja Lovable ignoruje) dzieli jak dotąd.
    expect(serverVendorChunking({ LOVABLE_NITRO_PRESET: "cloudflare-module" })).toBeDefined();
    expect(serverVendorChunking({ LOVABLE_NITRO_PRESET: "cos-innego" })).toBeDefined();
  });
});
