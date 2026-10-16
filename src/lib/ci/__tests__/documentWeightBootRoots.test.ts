// @vitest-environment node
//
// `manifestBootRoots()` (scripts/performance/documentWeight.ts) - fallback `check:document-weight`
// na korzenie bootu z artefaktu serwera, gdy dokument nie ma ani `<script type="module" src>`,
// ani zestawu bootu. Ten sam kontrakt co `findBootChunks()` w `check-bundle-size.ts`
// i `check-entry-purity.ts` (tamte wzorce sprawdza `chunkGateRegexes.test.ts`).
//
// PO CO. Na Vite 8 worker minifikuje Oxc (przez Nitro), który drukuje wartości napisów jako
// literały szablonowe (entry:`/assets/index-X.js`), a Nitro na Rolldownie kładzie moduł
// manifestu w podkatalogu chunków (`_ssr/...`). Wersja z cudzysłowami i przeglądem tylko
// katalogu głównego nie widziała żadnego korzenia. Tu: prawdziwe wyjście `minifySync` w
// zagnieżdżonym module, wabik w `node_modules` (kopia zależności runtime'u Nitro, nie nasze
// chunki) i zwykły moduł bez manifestu w katalogu głównym.
//
// i18n: brak treści dla użytkownika - narzędzie CI.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { minifySync } from "vite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { manifestBootRoots } from "../../../../scripts/performance/documentWeight";

const BOOT = {
  entry: "/assets/index-AbCd1234.js",
  rootPreloads: ["/assets/index-AbCd1234.js", "/assets/vendor-react-Xy_9-8Zz.js"],
  routePreloads: {},
};
const DECOY = { ...BOOT, entry: "/assets/decoy-ZzZz0000.js" };

/** Moduł z `scripts/lib/bootAfterLcpPlugin.ts` po minifikacji workera (Oxc). */
const bootModule = (boot: typeof BOOT) =>
  minifySync("manifest.mjs", `export const nesBootManifest = ${JSON.stringify(boot)};\n`).code;

let serverDir = "";

function put(path: string, content: string): void {
  const full = join(serverDir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

beforeEach(() => {
  serverDir = mkdtempSync(join(tmpdir(), "nes-document-weight-boot-"));
});

afterEach(() => {
  if (serverDir) rmSync(serverDir, { recursive: true, force: true });
});

describe("manifestBootRoots: artefakt serwera Vite 8 / Nitro na Rolldownie", () => {
  it("przesłanka: Oxc drukuje wartość `entry` w backtickach", () => {
    expect(bootModule(BOOT)).toContain("entry:`/assets/index-AbCd1234.js`");
  });

  it("znajduje wejście w zagnieżdżonym `_ssr/` (backtick), pomija wabik w `node_modules`", () => {
    put("index.mjs", 'export default { fetch: () => new Response("ok") };\n');
    put("_ssr/nes-boot-manifest-Q1w2E3r4.mjs", bootModule(BOOT));
    put("node_modules/decoy/index.mjs", bootModule(DECOY));
    expect(manifestBootRoots(serverDir)).toEqual(["index-AbCd1234.js"]);
  });

  it("manifest ze skryptem wejścia (`scripts:[{attrs:{src}}]`) po minifikacji, też w głębi", () => {
    const manifest = `export const m = {routes:{__root__:{scripts:[{attrs:{type:"module",src:"${BOOT.entry}"}}]}}};\n`;
    put("_ssr/_chunks/start-manifest-T5y6U7i8.mjs", minifySync("m.mjs", manifest).code);
    expect(manifestBootRoots(serverDir)).toEqual(["index-AbCd1234.js"]);
  });

  it("brak katalogu albo brak manifestu: pusta lista (bez wyjątku)", () => {
    expect(manifestBootRoots(join(serverDir, "nie-ma"))).toEqual([]);
    put("_ssr/router-A1b2C3d4.mjs", "export const r = 1;\n");
    expect(manifestBootRoots(serverDir)).toEqual([]);
  });
});
