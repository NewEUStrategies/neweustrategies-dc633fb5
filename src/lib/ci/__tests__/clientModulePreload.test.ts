// @vitest-environment node
//
// Listy preloadu `import()` bundla przeglądarki (scripts/lib/clientModulePreload.ts) - trzy
// warstwy dowodu:
// 1. NAZWY BOOTU z oznaczeń `boot(...)` przy definicjach grup, rozłączne z chunkami, które
//    check:entry-purity uznaje za leniwe z definicji;
// 2. REGUŁY `resolveDependencies` na liście w kształcie, w jakim podaje ją Vite (cel + domknięcie
//    statyczne, ścieżki `assets/…`), samotny cel rozstrzygany przez CSS, i równość granicy /admin
//    z `ADMIN_ROOT` bramki check:bundle;
// 3. PRAWDZIWY BUILD Vite 8 z grupami klienta i wtyczką `clientModulePreload().plugin`: każdy
//    chunk zdjęty z listy jest w statycznym domknięciu wejścia (ta sama definicja co
//    `bootClosure()` bramki), cel /admin dostaje `[]`, listy celów publicznych zachowują ich
//    leniwe zależności, a samotny cel zostaje na liście wtedy i tylko wtedy, gdy Vite dokleja do
//    niej CSS. Na artefakcie aplikacji ten sam predykat bootu sprawdza check:entry-purity
//    (`isBootChunkFile`).
//
// i18n: brak treści dla użytkownika - narzędzie CI.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { build, type Rolldown } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  BOOT_CHUNK_NAMES,
  CHUNK_PRIORITY,
  CLIENT_CHUNK_GROUPS,
  ROLLDOWN_RUNTIME_CHUNK,
  clientCodeSplitting,
} from "../../../../scripts/lib/clientChunkGroups";
import {
  ADMIN_ROUTE_CHUNK_RE,
  bundleCssProbe,
  chunkNameOf,
  clientModulePreload,
  isBootChunkFile,
  resolveClientPreloadDependencies,
} from "../../../../scripts/lib/clientModulePreload";

const REPO = process.cwd();
const js = { hostId: "assets/app-initial-AbCd1234.js", hostType: "js" } as const;
const noCss = () => false;
const withCss = () => true;

describe("nazwy chunków bootu - z definicji grup, nie z ręcznej listy", () => {
  const groupNames = CLIENT_CHUNK_GROUPS.map((group) => group.debugName);

  it("każda nazwa to grupa klienta albo runtime Rolldowna, bez duplikatów", () => {
    expect(new Set(BOOT_CHUNK_NAMES).size).toBe(BOOT_CHUNK_NAMES.length);
    for (const name of BOOT_CHUNK_NAMES) {
      expect(name === ROLLDOWN_RUNTIME_CHUNK || groupNames.includes(name), name).toBe(true);
    }
    // Domknięcie bootu artefaktu 75d90e1 (bramka `bootClosure()`, 11 chunków) bez wejścia.
    expect([...BOOT_CHUNK_NAMES].sort()).toEqual(
      [
        "app-initial",
        "rolldown-runtime",
        "vendor-i18n",
        "vendor-lucide-boot",
        "vendor-radix-boot",
        "vendor-react",
        "vendor-supabase",
        "vendor-tanstack",
        "vendor-tw-merge",
        "vendor-zod",
      ].sort(),
    );
  });

  it("grupy z tagiem `$initial` są bootowe, rodziny leniwe i chunki leniwe z definicji - nie", () => {
    for (const group of CLIENT_CHUNK_GROUPS) {
      const name = group.debugName!;
      if (group.tags?.includes("$initial")) expect(BOOT_CHUNK_NAMES, name).toContain(name);
      if ((group.priority ?? 0) < CHUNK_PRIORITY.initial) {
        expect(BOOT_CHUNK_NAMES, name).not.toContain(name);
      }
    }
    // `LAZY_CHUNKS` z scripts/check-entry-purity.ts - w domknięciu wejścia być nie mogą, więc ich
    // zdjęcie z list zrobiłoby kaskadę na każdej stronie, która je ładuje.
    for (const lazy of [
      "vendor-lucide",
      "vendor-radix",
      "vendor-radix-select",
      "vendor-radix-slider",
      "vendor-radix-scroll-area",
      "vendor-radix-menu",
      "vendor-sonner",
      "vendor-jszip",
      "legal-links",
    ]) {
      expect(BOOT_CHUNK_NAMES, lazy).not.toContain(lazy);
      expect(isBootChunkFile(`assets/${lazy}-AbCd_12-.js`), lazy).toBe(false);
    }
  });
});

describe("resolveClientPreloadDependencies", () => {
  it("nazwa chunku = `[name]` bez 8-znakowego hasha (także z `-`/`_` w haszu)", () => {
    expect(chunkNameOf("assets/vendor-radix-boot-CqWjIn_c.js")).toBe("vendor-radix-boot");
    expect(chunkNameOf("assets/vendor-radix-CAqjQrzz.js")).toBe("vendor-radix");
    expect(chunkNameOf("assets/admin.pages--uiFAKkd.js")).toBe("admin.pages");
    expect(chunkNameOf("assets/app-initial-DJrN5h1u.js")).toBe("app-initial");
    expect(chunkNameOf("assets/push-sw.js")).toBeNull();
    expect(isBootChunkFile("assets/vendor-radix-boot-CqWjIn_c.js")).toBe(true);
    expect(isBootChunkFile("assets/vendor-radix-CAqjQrzz.js")).toBe(false);
    expect(isBootChunkFile("assets/index-CjMrqMdM.js")).toBe(false);
  });

  it("cel w korzeniu /admin (trasa i layout) - pusta lista; publiczny `admin*` bez kropki/myślnika - nie", () => {
    const deps = ["assets/admin.posts._slug-DV-GY-ku.js", "assets/Builder-AbCd1234.js"];
    expect(resolveClientPreloadDependencies(deps[0]!, deps, js, noCss)).toEqual([]);
    expect(
      resolveClientPreloadDependencies(
        "assets/admin-CjLOw7lv.js",
        ["assets/admin-CjLOw7lv.js", "assets/AdminShellSkeleton-AbCd1234.js"],
        js,
        noCss,
      ),
    ).toEqual([]);
    const pageHead = ["assets/adminPageHead-AbCd1234.js", "assets/shared-EfGh5678.js"];
    expect(resolveClientPreloadDependencies(pageHead[0]!, pageHead, js, noCss)).toEqual(pageHead);
    // Import /admin z CSS: sam cel zostaje, inaczej jego JS czekałby na arkusz.
    expect(resolveClientPreloadDependencies(deps[0]!, deps, js, withCss)).toEqual([deps[0]]);
  });

  it("zdejmuje chunki bootu, zachowuje cel i leniwe zależności w kolejności Vite", () => {
    const target = "assets/club._clubSlug.index-AbCd1234.js";
    const deps = [
      target,
      "assets/vendor-react-4Olbrvfa.js",
      "assets/post-card-EfGh5678.js",
      "assets/app-initial-DJrN5h1u.js",
      "assets/rolldown-runtime-BCiCTKAo.js",
      "assets/vendor-radix-CAqjQrzz.js",
      "assets/vendor-radix-boot-CqWjIn_c.js",
    ];
    expect(resolveClientPreloadDependencies(target, deps, js)).toEqual([
      target,
      "assets/post-card-EfGh5678.js",
      "assets/vendor-radix-CAqjQrzz.js",
    ]);
  });

  it("sam cel bez zależności spoza bootu - `[cel]` tylko z CSS (Vite dokleja go po tej funkcji)", () => {
    // Pusta lista + doklejony arkusz = `__vitePreload` czeka na CSS, zanim zażąda JS celu.
    const target = "assets/Lightbox-AbCd1234.js";
    const deps = [target, "assets/rolldown-runtime-BCiCTKAo.js", "assets/vendor-react-4Olbrvfa.js"];
    const probed: (readonly string[])[] = [];
    const probe = (files: readonly string[]) => (probed.push(files), true);
    expect(resolveClientPreloadDependencies(target, deps, js, probe)).toEqual([target]);
    // CSS całego domknięcia - Vite dokleja arkusze celu i każdego chunku, który on importuje.
    expect(probed).toEqual([deps]);
    // Bez CSS - pusta lista, jak u Vite dla celu bez zależności.
    expect(resolveClientPreloadDependencies(target, deps, js, noCss)).toEqual([]);
    // Bez wglądu w bundle (wtyczka niepodpięta) - bezpiecznie: cel zostaje.
    expect(resolveClientPreloadDependencies(target, deps, js)).toEqual([target]);
    // Cel spoza listy Vite (chunk czysto-CSS-owy zastąpiony `Promise.resolve({})`) - nie wraca.
    expect(resolveClientPreloadDependencies(target, [], js, withCss)).toEqual([]);
  });

  it("lista HTML-owa (preload wejścia) przechodzi bez zmian", () => {
    const deps = ["assets/vendor-react-4Olbrvfa.js", "assets/app-initial-DJrN5h1u.js"];
    expect(
      resolveClientPreloadDependencies("assets/index-CjMrqMdM.js", deps, {
        hostId: "index.html",
        hostType: "html",
      }),
    ).toBe(deps);
  });

  it("granica /admin = `ADMIN_ROOT` bramki check:bundle (ta sama klasyfikacja korzeni)", () => {
    const gate = readFileSync(join(REPO, "scripts/check-bundle-size.ts"), "utf8");
    const declared = /const ADMIN_ROOT = \/(.+)\/;/.exec(gate)?.[1];
    expect(declared).toBe(ADMIN_ROUTE_CHUNK_RE.source);
    expect(ADMIN_ROUTE_CHUNK_RE.flags).toBe("");
  });

  it("`bundleCssProbe` czyta bundle w chwili wywołania; bez bundla zakłada CSS", () => {
    const plugin: { bundle?: Rolldown.OutputBundle } = {};
    const probe = bundleCssProbe(() => plugin.bundle);
    expect(probe(["assets/a-AbCd1234.js"])).toBe(true);
    const chunk = (importedCss: string[]) =>
      ({ type: "chunk", viteMetadata: { importedCss: new Set(importedCss) } }) as never;
    const bundle: Rolldown.OutputBundle = {
      "assets/a-AbCd1234.js": chunk([]),
      "assets/b-AbCd1234.js": chunk([]),
    };
    plugin.bundle = bundle;
    expect(probe(["assets/a-AbCd1234.js", "assets/b-AbCd1234.js", "assets/x-AbCd1234.js"])).toBe(
      false,
    );
    // Vite scala CSS chunków czysto-CSS-owych do importerów w swoim `generateBundle` - po
    // wzięciu bundla przez wtyczkę; sonda widzi stan z chwili wywołania.
    bundle["assets/b-AbCd1234.js"] = chunk(["assets/b-EfGh5678.css"]);
    expect(probe(["assets/a-AbCd1234.js", "assets/b-AbCd1234.js"])).toBe(true);
  });

  it("`clientModulePreload()` - świeży obiekt; wtyczka tylko w buildzie klienta, przed Vite", () => {
    const first = clientModulePreload();
    expect(first).not.toBe(clientModulePreload());
    expect(Object.keys(first.modulePreload)).toEqual(["resolveDependencies"]);
    expect(first.plugin).toMatchObject({ name: "nes:client-module-preload", apply: "build" });
    expect(first.plugin.generateBundle).toMatchObject({ order: "pre" });
    const applies = first.plugin.applyToEnvironment as (env: unknown) => boolean;
    expect(applies({ config: { consumer: "client" } })).toBe(true);
    expect(applies({ config: { consumer: "server" } })).toBe(false);
  });
});

// ── PRAWDZIWY BUILD ──────────────────────────────────────────────────────────────────────────

const pkgJson = (name: string, main: string) =>
  JSON.stringify({ name, version: "0.0.0", main, module: main });

/**
 * Wejście -> kod bootu (`app-initial`) -> React (CJS, więc też `rolldown-runtime`); kod bootu
 * importuje leniwie trasę publiczną i trasę /admin, obie zależne od Reacta i wspólnego modułu
 * leniwego, oraz dwa moduły bez zależności spoza bootu: z własnym arkuszem (kształt Lightboxa
 * z GalleryBlock) i bez niego.
 */
const FILES: Record<string, string> = {
  "node_modules/react/package.json": pkgJson("react", "index.js"),
  "node_modules/react/index.js":
    '"use strict";\nexports.createElement = function (t, p) { return { t, p }; };\n' +
    'exports.version = "fixture-" + globalThis.__v;\n',
  // Pakiet CJS spoza grup, importowany wyłącznie leniwie: interop potrzebują wtedy i chunk bootu
  // (React), i chunk leniwy, więc Rolldown wydziela swój runtime do `rolldown-runtime`, jak
  // w aplikacji (komentarz grupy vendor-react).
  "node_modules/legacy-lib/package.json": pkgJson("legacy-lib", "index.js"),
  "node_modules/legacy-lib/index.js":
    '"use strict";\nexports.legacy = function () { return "legacy-" + globalThis.__l; };\n',
  "src/entry.js": 'import { start } from "./app.js";\nstart();\n',
  "src/app.js":
    'import { createElement } from "react";\n' +
    "export function start() {\n" +
    '  globalThis.__fixture = [createElement("boot"),\n' +
    '    () => import("./routes/public.js"),\n' +
    '    () => import("./routes/admin.secret.js"),\n' +
    '    () => import("./lib/styled.js"),\n' +
    '    () => import("./lib/plain.js")];\n' +
    "}\n",
  "src/lib/shared.js":
    'import { legacy } from "legacy-lib";\nexport const shared = "shared-" + legacy();\n',
  "src/routes/public.js":
    'import { createElement } from "react";\nimport { shared } from "../lib/shared.js";\n' +
    'export default () => [createElement("public"), shared];\n',
  "src/lib/styled.css": ".styled { color: red; }\n",
  "src/lib/styled.js":
    'import "./styled.css";\nimport { createElement } from "react";\n' +
    'export default () => createElement("styled");\n',
  "src/lib/plain.js":
    'import { createElement } from "react";\nexport default () => createElement("plain");\n',
  "src/routes/admin.secret.js":
    'import { createElement } from "react";\nimport { shared } from "../lib/shared.js";\n' +
    'export default () => [createElement("admin"), shared, "admin-secret"];\n',
};

interface Call {
  readonly filename: string;
  readonly deps: readonly string[];
  readonly result: readonly string[];
}

interface Built {
  readonly chunks: Rolldown.OutputChunk[];
  readonly calls: Call[];
  readonly byName: (name: string) => Rolldown.OutputChunk;
  /** Pliki statycznego domknięcia wejścia (`imports` od chunku wejściowego). */
  readonly boot: ReadonlySet<string>;
}

let workspace = "";
let runs = 0;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "nes-client-module-preload-"));
});

afterAll(() => {
  if (workspace) rmSync(workspace, { recursive: true, force: true });
});

async function buildFixture(withPolicy: boolean): Promise<Built> {
  const root = join(workspace, `app-${++runs}`);
  for (const [file, content] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  const calls: Call[] = [];
  // Ten sam obiekt co w presetach: wtyczka w `plugins`, reguły w `modulePreload` (tu z zapisem
  // wywołań, żeby test widział wejście i wynik reguł).
  const preload = clientModulePreload();
  const resolve = preload.modulePreload.resolveDependencies!;
  const result = await build({
    configFile: false,
    envFile: false,
    root,
    publicDir: false,
    logLevel: "silent",
    plugins: withPolicy ? [preload.plugin] : [],
    build: {
      write: false,
      minify: "oxc",
      modulePreload: withPolicy
        ? {
            resolveDependencies: (filename, deps, context) => {
              const resolved = resolve(filename, deps, context);
              calls.push({ filename, deps: [...deps], result: [...resolved] });
              return resolved;
            },
          }
        : true,
      rolldownOptions: {
        input: { index: join(root, "src/entry.js") },
        output: { hoistTransitiveImports: false, codeSplitting: clientCodeSplitting() },
      },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
  const chunks = outputs
    .flatMap((o) => o.output)
    .filter((o): o is Rolldown.OutputChunk => o.type === "chunk");
  const entry = chunks.find((chunk) => chunk.isEntry);
  if (!entry) throw new Error("build bez chunku wejściowego");
  const boot = new Set<string>();
  const stack = [entry.fileName];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (boot.has(file)) continue;
    boot.add(file);
    stack.push(...(chunks.find((chunk) => chunk.fileName === file)?.imports ?? []));
  }
  const byName = (name: string) => {
    const found = chunks.filter((chunk) => chunk.name === name);
    expect(found, `chunk ${name}`).toHaveLength(1);
    return found[0]!;
  };
  return { chunks, calls, byName, boot };
}

/** Tablica nazw plików `m.f` (`__vite__mapDeps`) chunku - to są bajty list w artefakcie. */
function mapDepsFiles(chunk: Rolldown.OutputChunk): string[] {
  const table = /m\.f=(\[[^\]]*\])/.exec(chunk.code)?.[1];
  return table ? (JSON.parse(table.replaceAll("`", '"')) as string[]) : [];
}

describe("clientModulePreload - prawdziwy build Vite 8 / Rolldown z grupami klienta", () => {
  let built: Built;
  let control: Built;

  beforeAll(async () => {
    [built, control] = await Promise.all([buildFixture(true), buildFixture(false)]);
  });

  it("fikstura ma kształt aplikacji: wejście, `app-initial`, vendor-react i runtime w bocie", () => {
    const bootNames = [...built.boot].map(chunkNameOf);
    expect(bootNames).toEqual(
      expect.arrayContaining(["index", "app-initial", "vendor-react", ROLLDOWN_RUNTIME_CHUNK]),
    );
    expect(built.byName("app-initial").dynamicImports).toHaveLength(4);
    // Bez polityki lista trasy publicznej wymienia chunki bootu - to te bajty zdejmujemy.
    expect(mapDepsFiles(control.byName("app-initial")).filter(isBootChunkFile)).not.toEqual([]);
  });

  it("KAŻDY chunk zdjęty z listy jest w statycznym domknięciu wejścia", () => {
    expect(built.calls.length).toBeGreaterThanOrEqual(2);
    let dropped = 0;
    for (const call of built.calls) {
      // Cel /admin traci listę świadomie (kaskada przy pierwszej nawigacji) - nie jest bootem.
      if (ADMIN_ROUTE_CHUNK_RE.test(call.filename.replace(/^assets\//, ""))) continue;
      for (const dep of call.deps) {
        if (call.result.includes(dep) || dep === call.filename) continue;
        dropped++;
        expect(built.boot.has(dep), `${dep} zdjęty z listy ${call.filename}`).toBe(true);
      }
    }
    expect(dropped).toBeGreaterThan(0);
  });

  it("trasa /admin dostaje `[]`, trasa publiczna - cel i wspólny chunk leniwy, bez bootu", () => {
    const admin = built.byName("admin.secret");
    const publicRoute = built.byName("public");
    const shared = built.byName("shared");
    const adminCall = built.calls.find((call) => call.filename === admin.fileName);
    expect(adminCall?.deps).toContain(shared.fileName);
    expect(adminCall?.result).toEqual([]);
    const publicCall = built.calls.find((call) => call.filename === publicRoute.fileName);
    expect(publicCall?.result).toEqual([publicRoute.fileName, shared.fileName]);
    // Artefakt: tablica `m.f` chunku bootu nie zna ani chunków bootu, ani trasy /admin.
    const styled = built.byName("styled");
    const styledCss = [...styled.viteMetadata!.importedCss];
    expect(styledCss).toHaveLength(1);
    const table = mapDepsFiles(built.byName("app-initial"));
    expect(table.sort()).toEqual(
      [publicRoute.fileName, shared.fileName, styled.fileName, ...styledCss].sort(),
    );
    expect(built.byName("app-initial").code).toContain(
      `import(\`./${admin.fileName.slice(7)}\`),[])`,
    );
  });

  it("cel z własnym CSS i samymi zależnościami bootu - lista ma JS celu obok arkusza", () => {
    // `__vitePreload` czeka na `load` arkusza, zanim wywoła `import()`: lista z samym CSS
    // oznaczałaby, że JS celu rusza dopiero po arkuszu (+1 runda), a nie równolegle z nim.
    const styled = built.byName("styled");
    const styledCall = built.calls.find((call) => call.filename === styled.fileName);
    expect(styledCall?.deps.filter((dep) => dep !== styled.fileName).every(isBootChunkFile)).toBe(
      true,
    );
    expect(styledCall?.result).toEqual([styled.fileName]);
    const app = built.byName("app-initial");
    const table = mapDepsFiles(app);
    const call = new RegExp(
      `import\\(\`\\./${styled.fileName.slice(7).replace(/[.]/g, "\\.")}\`\\),__vite__mapDeps\\(\\[([0-9,]+)\\]\\)`,
    ).exec(app.code);
    const listed = (call?.[1] ?? "").split(",").map((index) => table[Number(index)]);
    expect(listed.sort()).toEqual([styled.fileName, ...styled.viteMetadata!.importedCss].sort());
  });

  it("cel bez CSS i z samymi zależnościami bootu - pusta lista, jak u Vite", () => {
    const plain = built.byName("plain");
    expect(plain.viteMetadata!.importedCss.size).toBe(0);
    const plainCall = built.calls.find((call) => call.filename === plain.fileName);
    expect(plainCall?.deps).toContain(plain.fileName);
    expect(plainCall?.deps.filter((dep) => dep !== plain.fileName).every(isBootChunkFile)).toBe(
      true,
    );
    expect(plainCall?.result).toEqual([]);
    expect(built.byName("app-initial").code).toContain(
      `import(\`./${plain.fileName.slice(7)}\`),[])`,
    );
  });
});
