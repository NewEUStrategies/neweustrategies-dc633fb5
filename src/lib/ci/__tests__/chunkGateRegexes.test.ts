// @vitest-environment node
//
// Wzorce krawędzi i korzeni bootu w bramkach po buildzie (check:chunks, check:entry-purity,
// check:bundle, check:server-entry-purity) wobec PRAWDZIWEGO wyjścia minifikatora Oxc.
//
// PO CO. Bramki czytają zminifikowany kod tekstem. Vite 8 minifikuje Oxc-iem (klienta z naszego
// `build.minify`, worker przez `minify: true` Nitro), a Oxc drukuje napisy i specyfikatory
// dynamicznych importów jako LITERAŁY SZABLONOWE: ``import(`./x.js`)``,
// ``{entry:`/assets/index-X.js`,...}``. Wzorce pisane pod esbuilda (tylko cudzysłowy) po cichu
// przestały widzieć: korzeń bootu (bramki kończyły się "nie udało się ustalić chunku
// startowego") i krawędzie `import()` w `adminOnlyByGraph` (chunk osiągalny tylko z tras /admin
// tracił importerów i liczył się do budżetu PUBLICZNEGO). Ten plik wyjmuje wzorce ze źródeł
// bramek (bramki są skryptami z efektami ubocznymi na poziomie modułu, nie bibliotekami) i karmi
// je wyjściem prawdziwego `vite build` i `minifySync` - gdyby Oxc zmienił druk albo ktoś
// "uprościł" wzorzec, zapali się tutaj, a nie na runnerze po pełnym buildzie.
//
// i18n: brak treści dla użytkownika - narzędzie CI.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { build, minifySync, type Rolldown } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { staticImportersOfChunk } from "@/lib/ci/serverEntryPurity";

/** Literał wyrażenia regularnego `const NAME = /.../flagi;` ze źródła bramki. */
function regexFrom(file: string, name: string): RegExp {
  const source = readFileSync(file, "utf8");
  const match = new RegExp(`const ${name} =\\s*(\\/.+\\/[a-z]*);\\n`).exec(source);
  if (!match) throw new Error(`${file}: brak \`const ${name} = /.../\``);
  const literal = match[1]!;
  const end = literal.lastIndexOf("/");
  return new RegExp(literal.slice(1, end), literal.slice(end + 1));
}

/** Statyczne krawędzie w stylu bramek: wzorzec z grupą (prefiks, ścieżka), bez `import(`. */
function staticTargets(re: RegExp, code: string): string[] {
  const out = new Set<string>();
  for (const m of code.matchAll(re)) {
    if (m[1]!.trimEnd().endsWith("(")) continue;
    out.add(basename(m[2]!));
  }
  return [...out].sort();
}

const STATIC_EDGE_PATTERNS = [
  ["scripts/check-chunk-graph.ts", "IMPORT_RE"],
  ["scripts/check-entry-purity.ts", "IMPORT_RE"],
  ["scripts/check-bundle-size.ts", "STATIC_EDGE_RE"],
] as const;

const BOOT_ROOT_FILES = ["scripts/check-entry-purity.ts", "scripts/check-bundle-size.ts"] as const;

let workspace = "";

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "nes-chunk-gate-regexes-"));
});

afterAll(() => {
  if (workspace) rmSync(workspace, { recursive: true, force: true });
});

const FILES: Record<string, string> = {
  "node_modules/vendorlib/package.json": JSON.stringify({
    name: "vendorlib",
    type: "module",
    main: "index.js",
    sideEffects: false,
  }),
  "node_modules/vendorlib/index.js": 'export const v = () => "vendor-" + globalThis.__v;\n',
  "src/entry.js":
    'import { v } from "vendorlib";\nglobalThis.__x = [v, () => import("./lazy.js")];\n',
  "src/lazy.js": 'import { v } from "vendorlib";\nexport default () => v() + "-lazy";\n',
};

describe("bramki chunków wobec wyjścia Oxc - bundel klienta", () => {
  let chunks: Rolldown.OutputChunk[] = [];
  let entry: Rolldown.OutputChunk;
  const fileOf = (name: string) => basename(chunks.find((c) => c.name === name)!.fileName);

  beforeAll(async () => {
    const root = join(workspace, "client");
    for (const [file, content] of Object.entries(FILES)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), content);
    }
    const result = await build({
      configFile: false,
      envFile: false,
      root,
      publicDir: false,
      logLevel: "silent",
      build: {
        write: false,
        minify: "oxc",
        rolldownOptions: {
          input: { index: join(root, "src/entry.js") },
          output: {
            codeSplitting: {
              groups: [{ name: "vendor-lib", test: /\/node_modules\/vendorlib\//, priority: 10 }],
            },
          },
        },
      },
    });
    const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
    chunks = outputs
      .flatMap((o) => o.output)
      .filter((o): o is Rolldown.OutputChunk => o.type === "chunk");
    entry = chunks.find((c) => c.isEntry)!;
  });

  it("przesłanka: Oxc drukuje import statyczny w cudzysłowie, a dynamiczny w backtickach", () => {
    expect(entry.code).toContain(`from"./${fileOf("vendor-lib")}"`);
    expect(entry.code).toContain(`import(\`./${fileOf("lazy")}\`)`);
  });

  it.each(STATIC_EDGE_PATTERNS)("%s (%s): wyłącznie krawędź statyczna", (file, name) => {
    expect(staticTargets(regexFrom(file, name), entry.code)).toEqual([fileOf("vendor-lib")]);
  });

  it("check-bundle-size `EDGE_RE` (osiągalność): krawędź statyczna I dynamiczna", () => {
    const re = regexFrom("scripts/check-bundle-size.ts", "EDGE_RE");
    const targets = new Set([...entry.code.matchAll(re)].map((m) => m[1]));
    expect(targets).toEqual(new Set([fileOf("vendor-lib"), fileOf("lazy")]));
  });

  it("goły napis z listy preloadu (`__vite__mapDeps`) nie jest krawędzią", () => {
    // Lista ma pozycję leniwego chunku (JSON, cudzysłowy) - wzorzec osiągalności jej nie liczy.
    const mapDeps = `const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/${fileOf("lazy")}"])))=>i.map(i=>d[i]);`;
    const re = regexFrom("scripts/check-bundle-size.ts", "EDGE_RE");
    expect([...mapDeps.matchAll(re)]).toEqual([]);
  });
});

describe("bramki chunków wobec wyjścia Oxc - korzeń bootu w artefakcie serwera", () => {
  const BOOT = {
    entry: "/assets/index-AbCd1234.js",
    rootPreloads: ["/assets/index-AbCd1234.js", "/assets/vendor-react-Xy_9-8Zz.js"],
    routePreloads: {},
  };
  /** Moduł z `scripts/lib/bootAfterLcpPlugin.ts` przed i po minifikacji workera. */
  const raw = `export const nesBootManifest = ${JSON.stringify(BOOT)};\n`;
  const minified = minifySync("manifest.mjs", raw).code;

  it("przesłanka: Oxc zdejmuje cudzysłowy z kluczy i drukuje wartości w backtickach", () => {
    expect(minified).toContain("entry:`/assets/index-AbCd1234.js`");
  });

  it.each(BOOT_ROOT_FILES)("%s: `bootManifestRe` znajduje wejście w obu kształtach", (file) => {
    const re = regexFrom(file, "bootManifestRe");
    for (const code of [raw, minified]) {
      expect(
        [...code.matchAll(re)].map((m) => m[1]),
        code,
      ).toEqual(["index-AbCd1234.js"]);
    }
  });

  it.each(BOOT_ROOT_FILES)("%s: `scriptRe` (manifest ze skryptem wejścia) też", (file) => {
    const re = regexFrom(file, "scriptRe");
    // Kształt `seroval.serialize()` z modułu manifestu frameworka: klucze bez cudzysłowów.
    const manifest = `export const m = {routes:{__root__:{scripts:[{attrs:{type:"module",src:"${BOOT.entry}"}}]}}};\n`;
    for (const code of [manifest, minifySync("m.mjs", manifest).code]) {
      expect(
        [...code.matchAll(re)].map((m) => m[1]),
        code,
      ).toEqual(["index-AbCd1234.js"]);
    }
  });

  it("check-server-entry-purity: `import()` po minifikacji Oxc nie jest importerem statycznym", () => {
    const lazy = minifySync(
      "stripe.server.mjs",
      'export async function c() { const { default: S } = await import("../_libs/stripe.mjs"); return S; }\n',
    ).code;
    const eager = minifySync(
      "router.mjs",
      'import S from "../_libs/stripe.mjs";\nexport const c = () => S;\n',
    ).code;
    expect(lazy).toContain("import(`../_libs/stripe.mjs`)");
    const chunks = [
      { path: "_libs/stripe.mjs", source: "export default 1;" },
      { path: "_ssr/stripe.server-AAA.mjs", source: lazy },
      { path: "_ssr/router-BBB.mjs", source: eager },
    ];
    expect(staticImportersOfChunk(chunks, "stripe.mjs")).toEqual(["_ssr/router-BBB.mjs"]);
  });
});
