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
import { describe, expect, it, vi } from "vitest";

import {
  BOOT_MANIFEST_GLOBAL_KEY,
  START_MANIFEST_MODULE_ID,
  bootAfterLcpPlugin,
  evaluateStartManifestModule,
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
    const key = Symbol.for(BOOT_MANIFEST_GLOBAL_KEY);
    try {
      const { code, boot } = rewriteStartManifestModule(FRAMEWORK_MODULE);
      expect(code).not.toMatch(/preloads/);
      const loaded = loadEmitted(code);
      expect(loaded.nesBootManifest).toEqual(boot);
      expect(Reflect.get(globalThis, key)).toEqual(boot);
      const first = loaded.tsrStartManifest();
      expect(first).toEqual(loaded.tsrStartManifest());
      expect(first).not.toBe(loaded.tsrStartManifest());
      expect(frameworkView(first)).toEqual({
        "/$": { css: ["/assets/RichTextView-DK8DYkTM.css"] },
      });
    } finally {
      Reflect.deleteProperty(globalThis, key);
    }
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
    const key = Symbol.for(BOOT_MANIFEST_GLOBAL_KEY);
    try {
      expect(transform(context("ssr", "server"), FRAMEWORK_MODULE, "/repo/src/x.ts")).toBeNull();
      expect(
        transform(context("client", "client"), FRAMEWORK_MODULE, START_MANIFEST_MODULE_ID),
      ).toBeNull();
      const out = transform(context("ssr", "server"), FRAMEWORK_MODULE, START_MANIFEST_MODULE_ID);
      expect(out?.code).toContain("export const nesBootManifest");
      expect(out?.code).not.toMatch(/preloads|"async"/);
    } finally {
      Reflect.deleteProperty(globalThis, key);
    }
  });

  it("nieznany kształt w środowisku serwera przerywa build", () => {
    expect(() =>
      transform(context("ssr", "server"), "export default {}", START_MANIFEST_MODULE_ID),
    ).toThrow(/nieznany kształt manifestu/);
  });
});
