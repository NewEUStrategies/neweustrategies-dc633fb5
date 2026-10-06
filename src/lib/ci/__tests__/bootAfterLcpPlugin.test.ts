// Wtyczka `nes:boot-after-lcp` (P2.1): manifest TanStack Start bez preloadów i skryptu wejścia.
//
// CZEGO TEN PLIK PILNUJE. Wtyczka EWALUUJE kod modułu, który zwraca `load()` frameworka
// (`start-plugin-core/vite/start-manifest-plugin/plugin.js`: szablon
// `export const tsrStartManifest = () => (<seroval>)`), dzieli manifest i emituje nowy moduł.
// Wejście testu odtwarza ten szablon razem z formą seroval, która wyciąga współdzieloną tablicę
// do IIFE (`h=>...`) - tekstowe przepisywanie takiej formy by nie przeżyło. Kontrakt parytetu:
// manifest po przepisaniu NIE MA żadnego `preloads` ani skryptu wejścia, więc `<HeadContent>`,
// `<Scripts>`, kolektor `Link` i odwodniony manifest klienta renderują to samo (nic). Dowód na
// artefakcie (hydratacja, HIT/MISS, bot/przeglądarka): $SCRATCH/phase2/wave2/P2.1/SPIKE.md.
//
// i18n: brak treści dla użytkownika - narzędzie builda.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  BOOT_MANIFEST_MODULE_SUFFIX,
  START_MANIFEST_MODULE_ID,
  bootAfterLcpPlugin,
  evaluateStartManifestModule,
  rewriteBootManifestPlaceholder,
  rewriteStartManifestModule,
  splitStartManifest,
} from "../../../../scripts/lib/bootAfterLcpPlugin";

const ENTRY = "/assets/index-g0tPvd0l.js";

/** Szablon `load()` frameworka z wyjściem w stylu seroval (`!0`, współdzielona tablica w IIFE). */
const FRAMEWORK_MODULE =
  "export const tsrStartManifest = () => (((h)=>({routes:{" +
  '__root__:{filePath:"/repo/src/routes/__root.tsx",children:["/","/$"],' +
  `preloads:["${ENTRY}","/assets/vendor-react-DbdJcebo.js"],` +
  `scripts:[{attrs:{type:"module",async:!0,src:"${ENTRY}"}}]},` +
  '"/":{filePath:"/repo/src/routes/index.tsx",children:void 0,preloads:h},' +
  '"/$":{filePath:"/repo/src/routes/$.tsx",css:["/assets/RichTextView-DK8DYkTM.css"],preloads:h},' +
  '"/admin":{filePath:"/repo/src/routes/admin.tsx"}' +
  '}}))(["/assets/index-BaUlQqLx.js","/assets/blog.index-BM695hGn.js"]))';

/** Ewaluuje wyemitowany moduł tak, jak zrobi to serwer (eksporty jako zwykłe stałe). */
function loadEmitted(code: string): { tsrStartManifest: () => unknown; nesBootManifest: unknown } {
  const body = code.replace(/^export const /gm, "const ");
  const loaded: unknown = new Function(`${body}\nreturn { tsrStartManifest, nesBootManifest };`)();
  return loaded as { tsrStartManifest: () => unknown; nesBootManifest: unknown };
}

/** To, co `getStartManifest()` (start-server-core) przekazuje do renderu i dehydratacji. */
function frameworkView(manifest: unknown): Record<string, Record<string, unknown>> {
  const routes = (manifest as { routes: Record<string, Record<string, unknown[] | undefined>> })
    .routes;
  const out: Record<string, Record<string, unknown>> = {};
  for (const [id, route] of Object.entries(routes)) {
    const kept: Record<string, unknown> = {};
    if (route.preloads?.length) kept.preloads = route.preloads;
    if (route.scripts?.length) kept.scripts = route.scripts;
    if (route.css?.length) kept.css = route.css;
    if (Object.keys(kept).length) out[id] = kept;
  }
  return out;
}

describe("nes:boot-after-lcp - podział manifestu", () => {
  it("przenosi preloady i skrypt wejścia do BOOT_MANIFEST, CSS zostaje", () => {
    const { manifest, boot } = splitStartManifest(evaluateStartManifestModule(FRAMEWORK_MODULE));
    expect(boot).toEqual({
      entry: ENTRY,
      rootPreloads: [ENTRY, "/assets/vendor-react-DbdJcebo.js"],
      routePreloads: {
        "/": ["/assets/index-BaUlQqLx.js", "/assets/blog.index-BM695hGn.js"],
        "/$": ["/assets/index-BaUlQqLx.js", "/assets/blog.index-BM695hGn.js"],
      },
    });
    // Render serwera, kolektor `Link` i odwodniony manifest widzą wyłącznie CSS.
    expect(frameworkView(manifest)).toEqual({
      "/$": { css: ["/assets/RichTextView-DK8DYkTM.css"] },
    });
    // Pola tras, których wtyczka nie dotyczy, zostają bez zmian.
    expect(manifest.routes.__root__).toEqual({
      filePath: "/repo/src/routes/__root.tsx",
      children: ["/", "/$"],
    });
  });

  it("emituje moduł JSON: nowy obiekt przy każdym wywołaniu i mapę dla serwera", () => {
    const { code, boot } = rewriteStartManifestModule(FRAMEWORK_MODULE);
    expect(code).not.toMatch(/preloads/);
    // Mapa jedzie WYŁĄCZNIE eksportem modułu (zaślepka `bootManifest.ts` go reeksportuje),
    // bez globalnego przekazania z czasów spike'u.
    expect(code).not.toMatch(/globalThis/);
    const loaded = loadEmitted(code);
    expect(loaded.nesBootManifest).toEqual(boot);
    const first = loaded.tsrStartManifest();
    expect(first).toEqual(loaded.tsrStartManifest());
    expect(first).not.toBe(loaded.tsrStartManifest());
    expect(frameworkView(first)).toEqual({
      "/$": { css: ["/assets/RichTextView-DK8DYkTM.css"] },
    });
  });

  it("odrzuca nieznane kształty zamiast przepisywać po cichu", () => {
    const routes = (root: unknown) => ({ routes: { __root__: root } });
    const script = { attrs: { type: "module", async: true, src: ENTRY } };
    expect(() => splitStartManifest(null)).toThrow(/routes/);
    expect(() => splitStartManifest({ routes: {} })).toThrow(/korzenia/);
    expect(() => splitStartManifest(routes({ scripts: [] }))).toThrow(/0 modułowych/);
    expect(() => splitStartManifest(routes({ scripts: [script, script] }))).toThrow(/2 modułowych/);
    expect(() =>
      splitStartManifest({ ...routes({ scripts: [script] }), scriptFormat: "iife" }),
    ).toThrow(/scriptFormat/);
    expect(() => splitStartManifest(routes({ scripts: [script], preloads: [ENTRY, 1] }))).toThrow(
      /preloads/,
    );
    expect(() => splitStartManifest(routes({ scripts: [script], when: new Date(0) }))).toThrow(
      /JSON/,
    );
    expect(() => splitStartManifest(routes({ scripts: [script], children: [undefined] }))).toThrow(
      /JSON/,
    );
    expect(() => evaluateStartManifestModule("export default {}")).toThrow(/tsrStartManifest/);
  });
});

type TransformResult = { code: string } | null | undefined;
type TransformContext = {
  environment?: { name: string; config: { consumer: string } };
  info: (message: string) => void;
  error: (message: string) => never;
};

function transform(ctx: TransformContext, code: string, id: string): TransformResult {
  const plugin = bootAfterLcpPlugin();
  const hook = plugin.transform as unknown as (
    this: TransformContext,
    code: string,
    id: string,
  ) => TransformResult;
  return hook.call(ctx, code, id);
}

function context(name: string, consumer: "client" | "server"): TransformContext {
  return {
    environment: { name, config: { consumer } },
    info: vi.fn(),
    error: (message: string) => {
      throw new Error(message);
    },
  };
}

describe("nes:boot-after-lcp - hook wtyczki", () => {
  it("działa tylko w buildzie", () => {
    expect(bootAfterLcpPlugin().apply).toBe("build");
  });

  it("przepisuje manifest wyłącznie w środowisku serwera `ssr`", () => {
    expect(transform(context("ssr", "server"), FRAMEWORK_MODULE, "/repo/src/x.ts")).toBeNull();
    expect(
      transform(context("client", "client"), FRAMEWORK_MODULE, START_MANIFEST_MODULE_ID),
    ).toBeNull();
    const out = transform(context("ssr", "server"), FRAMEWORK_MODULE, START_MANIFEST_MODULE_ID);
    expect(out?.code).toContain("export const nesBootManifest");
    expect(out?.code).not.toMatch(/preloads|"async"/);
  });

  it("nieznany kształt w środowisku serwera przerywa build", () => {
    expect(() =>
      transform(context("ssr", "server"), "export default {}", START_MANIFEST_MODULE_ID),
    ).toThrow(/nieznany kształt manifestu/);
  });
});

// ZAŚLEPKA MAPY. Serwer czyta `BOOT_MANIFEST` z `src/lib/boot/bootManifest.ts`; w `ssr`
// wtyczka zamienia deklarację `null` na reeksport `nesBootManifest` z przepisanego manifestu.
// Wejście jak w buildzie: kod PO transpilacji TS (wtyczka biegnie z `enforce: "post"`).
const PLACEHOLDER_ID = `/repo${BOOT_MANIFEST_MODULE_SUFFIX}`;
const TRANSPILED_PLACEHOLDER = "export const BOOT_MANIFEST = null;\n";

describe("nes:boot-after-lcp - zaślepka BOOT_MANIFEST", () => {
  it("zamienia deklarację `null` na reeksport mapy z modułu manifestu", () => {
    const out = rewriteBootManifestPlaceholder(TRANSPILED_PLACEHOLDER);
    expect(out).toBe(
      'export { nesBootManifest as BOOT_MANIFEST } from "tanstack-start-manifest:v";\n',
    );
  });

  it("deklaracja w źródle i w wejściu testu to ten sam kształt (bez cichego rozjazdu)", () => {
    // Źródło ma adnotację typu, którą esbuild zdejmuje; wzorzec ma pasować do wyniku.
    const source = readFileSync("src/lib/boot/bootManifest.ts", "utf8");
    expect(source).toMatch(/export const BOOT_MANIFEST: BootManifest \| null = null;/);
  });

  it("brak deklaracji to `null` (wołający przerywa build), nie cicha podmiana", () => {
    expect(rewriteBootManifestPlaceholder("export const BOOT_MANIFEST = {};")).toBeNull();
  });

  it("w `ssr` hook przepisuje zaślepkę, w kliencie zostawia `null`", () => {
    expect(
      transform(context("ssr", "server"), TRANSPILED_PLACEHOLDER, PLACEHOLDER_ID)?.code,
    ).toContain("nesBootManifest as BOOT_MANIFEST");
    expect(
      transform(context("client", "client"), TRANSPILED_PLACEHOLDER, PLACEHOLDER_ID),
    ).toBeNull();
  });

  it("zaślepka bez deklaracji w `ssr` przerywa build", () => {
    expect(() =>
      transform(context("ssr", "server"), "export const BOOT_MANIFEST = {};", PLACEHOLDER_ID),
    ).toThrow(/brak deklaracji/);
  });
});
