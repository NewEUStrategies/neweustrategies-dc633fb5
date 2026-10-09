// @vitest-environment node

/**
 * Wtyczka `nes:static-css` (P3.7a, krok S1) i jej siatka bezpieczeństwa w bramce wagi
 * dokumentu (`inlineCssCommentBytes`).
 *
 * LEKCJA `localeChunkPlugin` (nagłówek wtyczki, defekt 2026-09-01): test karmi hook TYM,
 * co dostaje build - surową treścią pliku źródłowego (`enforce: "pre"`) - a nie
 * spreparowanym fragmentem. Dzięki temu znacznik, który zniknie z pliku z listy, albo
 * literał, którego nie da się przepisać, wywraca ten test, a nie dopiero build.
 *
 * i18n: brak treści dla użytkownika - narzędzie builda.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { createBuilder, createLogger, type Logger, type Rollup } from "vite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  STATIC_CSS_MARKER,
  STATIC_CSS_MODULES,
  isStaticCssModule,
  minifyMarkedCssLiterals,
  staticCssPlugin,
} from "../../../../scripts/lib/staticCssPlugin";
import { analyzeDocument, cssCommentBytes } from "../../../../scripts/performance/documentWeight";
import { globalColorsToCss } from "@/lib/builder/globalColors";
import { minifyStaticCss } from "@/lib/css/minifyStaticCss";

const ROOT = process.cwd();
const read = (file: string) => readFileSync(resolve(ROOT, file), "utf8");

interface FakeContext {
  readonly environment: { readonly name: string };
  readonly warn: ReturnType<typeof vi.fn>;
  readonly error: (message: string) => never;
}

/** Wywołuje hook `transform` wtyczki tak jak Vite (kontekst z `warn`/`error`/środowiskiem). */
function runTransform(code: string, id: string, environment = "client") {
  const plugin = staticCssPlugin();
  const ctx: FakeContext = {
    environment: { name: environment },
    warn: vi.fn(),
    error: (message: string) => {
      throw new Error(message);
    },
  };
  const hook = plugin.transform as unknown as (
    this: FakeContext,
    code: string,
    id: string,
  ) => { code: string; map: null } | null;
  return { result: hook.call(ctx, code, id), ctx };
}

/** Treść (surowa) pierwszego oznaczonego literału w kodzie. */
function markedLiteral(code: string): string {
  const at = code.indexOf(STATIC_CSS_MARKER);
  const open = code.indexOf("`", at);
  return code.slice(open + 1, code.indexOf("`", open + 1));
}

describe("konfiguracja wtyczki", () => {
  it("działa tylko w buildzie, przed transpilacją TS", () => {
    const plugin = staticCssPlugin();
    expect(plugin.name).toBe("nes:static-css");
    expect(plugin.apply).toBe("build");
    expect(plugin.enforce).toBe("pre");
  });

  it("rozpoznaje moduły z listy po ścieżce absolutnej, z zapytaniem i w zapisie Windows", () => {
    expect(isStaticCssModule(resolve(ROOT, "src/lib/builder/globalColors.ts"))).toBe(true);
    expect(isStaticCssModule(`${resolve(ROOT, "src/lib/builder/sliderVariants.tsx")}?v=1`)).toBe(
      true,
    );
    expect(isStaticCssModule("C:\\repo\\src\\components\\header\\TrendingTicker.tsx")).toBe(true);
    expect(isStaticCssModule(resolve(ROOT, "src/lib/builder/otherGlobalColors.ts"))).toBe(false);
  });
});

describe.each(STATIC_CSS_MODULES)("prawdziwy moduł %s", (file) => {
  const source = read(file);
  const id = resolve(ROOT, file);

  it("hook podmienia co najmniej jeden literał, bez ostrzeżeń", () => {
    const { result, ctx } = runTransform(source, id);
    expect(result).not.toBeNull();
    expect(minifyMarkedCssLiterals(source).replaced).toBeGreaterThanOrEqual(1);
    expect(ctx.warn).not.toHaveBeenCalled();
  });

  it("wynik jest poprawnym TS-em (transpileModule bez diagnostyki składni)", () => {
    const { result } = runTransform(source, id);
    const out = ts.transpileModule(result!.code, {
      fileName: file,
      reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022 },
    });
    expect(out.diagnostics ?? []).toEqual([]);
  });

  it("literał po podmianie = minifyStaticCss(literał źródłowy) z przywróconymi interpolacjami", () => {
    const { result } = runTransform(source, id);
    const raw = markedLiteral(source);
    const interpolations = raw.match(/\$\{[^}]*\}/g) ?? [];
    let n = 0;
    const withSlots = raw.replace(/\$\{[^}]*\}/g, () => `__SLOT${n++}__`);
    const expected = minifyStaticCss(withSlots).replace(
      /__SLOT(\d+)__/g,
      (_, i: string) => interpolations[Number(i)],
    );
    expect(markedLiteral(result!.code)).toBe(expected);
    // Poza literałem kod jest nietknięty.
    expect(result!.code.replace(markedLiteral(result!.code), "")).toBe(source.replace(raw, ""));
  });

  it("klient i SSR dostają bajtowo ten sam kod (parytet hydratacji z konstrukcji)", () => {
    expect(runTransform(source, id, "client").result!.code).toBe(
      runTransform(source, id, "ssr").result!.code,
    );
  });

  it("drugi przebieg niczego nie zmienia (idempotencja)", () => {
    const once = runTransform(source, id).result!.code;
    expect(runTransform(once, id).result!.code).toBe(once);
  });
});

describe("zysk na arkuszach z chunku wejściowego i slidera", () => {
  // Rząd wielkości z diagnozy (P3.7 §3.1: TICKER_CSS -4 920 B, SHARED_STYLES -2 966 B).
  // Dopisanie sformatowanego CSS-u zysk tylko zwiększa; spadek poniżej progu znaczy, że
  // minifikator przestał zdejmować wcięcia albo komentarze.
  it.each([
    ["src/components/header/TrendingTicker.tsx", 4500],
    ["src/lib/builder/sliderVariants.tsx", 2500],
  ] as const)("%s oszczędza co najmniej %i B", (file, minSaving) => {
    const source = read(file);
    expect(source.length - minifyMarkedCssLiterals(source).code.length).toBeGreaterThanOrEqual(
      minSaving,
    );
  });
});

describe("odmowy i ostrzeżenia", () => {
  const id = resolve(ROOT, "src/lib/builder/globalColors.ts");
  const wrap = (literal: string) => `const A = ${STATIC_CSS_MARKER} \`${literal}\`;\n`;

  it.each([
    ["ukośnik wsteczny", wrap(".a::after { content: '\\\\2014'; }"), /ukośnik wsteczny/],
    ["interpolacja wyrażenia", wrap(".a { width: ${a + 1}px; }"), /nie jest identyfikatorem/],
    ["interpolacja wywołania", wrap(".a { width: ${f()}px; }"), /nie jest identyfikatorem/],
    ["zagnieżdżony backtick", wrap(".a { ${x ? `b` : ``} }"), /zagnieżdżony backtick/],
    ["znacznik bez literału", `const A = ${STATIC_CSS_MARKER} "x";\n`, /bez literału/],
    ["niedomknięty CSS", wrap(".a { top: 0"), /niedomknięta klamra/],
  ])("%s - błąd builda z plikiem i linią", (_, code, message) => {
    expect(() => runTransform(`// linia 1\n${code}`, id)).toThrow(message);
    expect(() => runTransform(`// linia 1\n${code}`, id)).toThrow(/globalColors\.ts:2:/);
  });

  it("interpolacja identyfikatora i ścieżki właściwości przechodzi dosłownie", () => {
    const code = wrap("\n  .a { gap: ${GAP}px; width: ${cfg.width}; }\n");
    expect(minifyMarkedCssLiterals(code).code).toBe(
      `const A = ${STATIC_CSS_MARKER} \`.a{gap:\${GAP}px;width:\${cfg.width}}\`;\n`,
    );
  });

  it("moduł z listy bez znacznika: ostrzeżenie i kod bez zmian", () => {
    const { result, ctx } = runTransform("export const A = `.a { top: 0 }`;\n", id);
    expect(result).toBeNull();
    expect(ctx.warn).toHaveBeenCalledWith(expect.stringContaining("brak oznaczonego literału"));
  });

  it("moduł spoza listy jest nietknięty, nawet ze znacznikiem", () => {
    const { result, ctx } = runTransform(wrap(".a { top: 0 }"), resolve(ROOT, "src/other.ts"));
    expect(result).toBeNull();
    expect(ctx.warn).not.toHaveBeenCalled();
  });
});

describe("bramka wagi dokumentu: inlineCssCommentBytes", () => {
  const doc = (body: string) => `<!doctype html><html><head></head><body>${body}</body></html>`;
  const weigh = (html: string) => analyzeDocument({ html }).inlineCssCommentBytes;

  it("liczy bajty komentarzy w inline <style> (z ogranicznikami)", () => {
    expect(weigh(doc("<style>.a{top:0} /* ab */ .b{top:0}</style><style>/**/</style>"))).toBe(
      "/* ab */".length + "/**/".length,
    );
  });

  it("pomija napisy CSS i skrypty", () => {
    expect(cssCommentBytes('.a::after{content:"/* nie */"}')).toBe(0);
    expect(weigh(doc("<script>/* skrypt */</script><style>.a{top:0}</style>"))).toBe(0);
  });

  it("zminifikowany literał prawdziwego modułu daje 0, surowy - więcej niż 0", () => {
    const raw = markedLiteral(read("src/components/header/TrendingTicker.tsx"));
    expect(cssCommentBytes(raw)).toBeGreaterThan(0);
    expect(cssCommentBytes(minifyStaticCss(raw))).toBe(0);
  });
});

describe("prawdziwy build Vite (klient i SSR, wspólna instancja wtyczki)", () => {
  // Wzorzec `widgetChunkPluginBuild.test.ts`: maleńka aplikacja z DOSŁOWNĄ kopią
  // `globalColors.ts` (ten sam sufiks ścieżki co na liście wtyczki), zbudowana
  // `createBuilder`-em w obu środowiskach, a potem WYKONANA. Dowodzi tego, czego wywołanie
  // hooka ręcznie dać nie może: że Vite podaje wtyczce surowy TS ze znacznikiem przed
  // transpilacją (`enforce: "pre"`) i że oba bundle niosą bajtowo ten sam napis.
  const FILES: Record<string, string> = {
    "src/lib/builder/globalColors.ts": read("src/lib/builder/globalColors.ts"),
    "src/lib/builder/globalColorsValue.ts": read("src/lib/builder/globalColorsValue.ts"),
    "src/client.ts":
      'import { globalColorsToCss } from "./lib/builder/globalColors";\n' +
      "globalThis.__nesStaticCss = globalColorsToCss({});\n",
    "src/server.ts": 'export { globalColorsToCss } from "./lib/builder/globalColors";\n',
  };
  let workspace = "";
  const warnings: string[] = [];
  let clientCss = "";
  let serverCss = "";

  function capturingLogger(): Logger {
    const base = createLogger("silent");
    return {
      ...base,
      warn: (msg) => void warnings.push(msg),
      warnOnce: (msg) => void warnings.push(msg),
    };
  }

  const entryOf = (output: unknown): Rollup.OutputChunk => {
    const outputs = (Array.isArray(output) ? output : [output]) as Rollup.RollupOutput[];
    const entry = outputs
      .flatMap((o) => o.output)
      .find((o): o is Rollup.OutputChunk => o.type === "chunk" && o.isEntry);
    if (!entry) throw new Error("bundel bez chunku wejściowego");
    return entry;
  };

  beforeAll(async () => {
    workspace = mkdtempSync(join(tmpdir(), "nes-static-css-"));
    for (const [file, content] of Object.entries(FILES)) {
      mkdirSync(dirname(join(workspace, file)), { recursive: true });
      writeFileSync(join(workspace, file), content);
    }
    const builder = await createBuilder({
      configFile: false,
      envFile: false,
      root: workspace,
      publicDir: false,
      logLevel: "warn",
      customLogger: capturingLogger(),
      plugins: [staticCssPlugin()],
      builder: { sharedPlugins: true },
      environments: {
        client: {
          build: {
            outDir: join(workspace, ".output/public"),
            minify: false,
            rollupOptions: { input: join(workspace, "src/client.ts") },
          },
        },
        ssr: {
          build: {
            outDir: join(workspace, ".output/server"),
            minify: false,
            rollupOptions: { input: join(workspace, "src/server.ts") },
          },
        },
      },
    });
    const client = entryOf(await builder.build(builder.environments.client));
    const server = entryOf(await builder.build(builder.environments.ssr));
    await import(
      /* @vite-ignore */ pathToFileURL(join(workspace, ".output/public", client.fileName)).href
    );
    clientCss = (globalThis as { __nesStaticCss?: string }).__nesStaticCss ?? "";
    const serverModule = (await import(
      /* @vite-ignore */ pathToFileURL(join(workspace, ".output/server", server.fileName)).href
    )) as { globalColorsToCss: typeof globalColorsToCss };
    serverCss = serverModule.globalColorsToCss({});
  }, 60_000);

  afterAll(() => {
    if (workspace) rmSync(workspace, { recursive: true, force: true });
  });

  it("most w obu bundlach = minifyStaticCss(literał źródłowy), bez komentarzy", () => {
    const bridge = minifyStaticCss(markedLiteral(read("src/lib/builder/globalColors.ts")));
    expect(serverCss.endsWith(bridge)).toBe(true);
    expect(cssCommentBytes(serverCss)).toBe(0);
    // Bloki zmiennych (dane) są takie jak w źródle - zmienia się wyłącznie most.
    const source = globalColorsToCss({});
    const variables = source.slice(0, source.indexOf(":where("));
    expect(serverCss).toBe(variables + bridge);
    expect(cssCommentBytes(source)).toBeGreaterThan(0);
  });

  it("klient i SSR wykonują bajtowo ten sam arkusz (parytet hydratacji)", () => {
    expect(clientCss.length).toBeGreaterThan(0);
    expect(clientCss).toBe(serverCss);
  });

  it("build bez ostrzeżeń wtyczki (znacznik dotarł do hooka)", () => {
    expect(warnings.filter((w) => w.includes("nes:static-css"))).toEqual([]);
  });
});
