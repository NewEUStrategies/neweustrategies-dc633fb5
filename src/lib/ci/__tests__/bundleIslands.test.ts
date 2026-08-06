import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import {
  LAZY_ISLANDS,
  findIslandViolations,
  formatViolations,
  parseImports,
  resolveSpecifier,
  type SourceFile,
} from "@/lib/ci/bundleIslands";

const ROOT = resolve(process.cwd());
const SRC = join(ROOT, "src");
const EXTENSIONS = [".ts", ".tsx"];

function collect(dir: string, out: SourceFile[] = []): SourceFile[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      collect(abs, out);
      continue;
    }
    if (!EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;
    out.push({
      path: relative(ROOT, abs).split(sep).join("/"),
      source: readFileSync(abs, "utf8"),
    });
  }
  return out;
}

const FILES = collect(SRC);

describe("parseImports", () => {
  it("liczy importy wartości, side-effectowe i re-eksporty", () => {
    const parsed = parseImports(
      [
        'import { a } from "./a";',
        'import "./side-effect";',
        'export { b } from "./b";',
        'import def from "pkg";',
      ].join("\n"),
    );
    expect(parsed.staticSpecifiers.map((s) => s.specifier)).toEqual([
      "./a",
      "./side-effect",
      "./b",
      "pkg",
    ]);
  });

  it("pomija importy typów - bundler je wymazuje, więc nie są krawędzią", () => {
    const parsed = parseImports(
      [
        'import type { A } from "./a";',
        'export type { B } from "./b";',
        'import { type C, type D } from "./cd";',
      ].join("\n"),
    );
    expect(parsed.staticSpecifiers).toEqual([]);
  });

  it("nie myli `import()` ze statyczną krawędzią", () => {
    const parsed = parseImports('const m = await import("./lazy");');
    expect(parsed.staticSpecifiers).toEqual([]);
    expect(parsed.dynamicSpecifiers).toEqual(["./lazy"]);
  });

  it("łapie mieszaną klauzulę wartość + typ jako krawędź", () => {
    const parsed = parseImports('import { value, type T } from "./mixed";');
    expect(parsed.staticSpecifiers.map((s) => s.specifier)).toEqual(["./mixed"]);
  });

  it("podaje numer linii do komunikatu", () => {
    const parsed = parseImports('\n\nimport { a } from "./a";');
    expect(parsed.staticSpecifiers[0]?.line).toBe(3);
  });
});

describe("resolveSpecifier", () => {
  const exists = (p: string) =>
    ["src/lib/stripe/index.ts", "src/lib/x.ts", "src/components/y.tsx"].includes(p);

  it("rozwiązuje alias @/ do src/", () => {
    expect(resolveSpecifier("src/a.ts", "@/lib/x", exists)).toBe("src/lib/x.ts");
  });

  it("rozwiązuje katalog przez index", () => {
    expect(resolveSpecifier("src/a.ts", "@/lib/stripe", exists)).toBe("src/lib/stripe/index.ts");
  });

  it("rozwiązuje ścieżki względne z wyjściem w górę", () => {
    expect(resolveSpecifier("src/lib/deep/a.ts", "../../components/y", exists)).toBe(
      "src/components/y.tsx",
    );
  });

  it("zwraca null dla pakietu npm", () => {
    expect(resolveSpecifier("src/a.ts", "@stripe/stripe-js", exists)).toBeNull();
  });
});

describe("findIslandViolations", () => {
  const island = [
    {
      name: "test-island",
      modules: ["src/island/sdk.ts"],
      packages: ["@heavy/sdk"],
      reason: "test",
    },
  ];

  it("przepuszcza wyspę importującą własny pakiet", () => {
    const files: SourceFile[] = [
      { path: "src/island/sdk.ts", source: 'import x from "@heavy/sdk";' },
      { path: "src/app.ts", source: 'const m = await import("./island/sdk");' },
    ];
    expect(findIslandViolations(files, island)).toEqual([]);
  });

  it("zgłasza strzeżony pakiet zaimportowany poza wyspą", () => {
    const files: SourceFile[] = [
      { path: "src/app.ts", source: 'import x from "@heavy/sdk/react";' },
    ];
    const violations = findIslandViolations(files, island);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toBe("package-outside-island");
  });

  it("zgłasza statyczne wejście do wyspy z zewnątrz", () => {
    const files: SourceFile[] = [
      { path: "src/island/sdk.ts", source: "export const x = 1;" },
      { path: "src/app.ts", source: 'import { x } from "@/island/sdk";' },
    ];
    const violations = findIslandViolations(files, island);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.kind).toBe("static-entry-into-island");
  });

  it("nie zgłasza importu TYPU z wyspy (bundler go wymazuje)", () => {
    const files: SourceFile[] = [
      { path: "src/island/sdk.ts", source: "export type P = { a: 1 };" },
      { path: "src/app.ts", source: 'import type { P } from "@/island/sdk";' },
    ];
    expect(findIslandViolations(files, island)).toEqual([]);
  });
});

describe("inwariant wysp na prawdziwym drzewie src/", () => {
  it("każda zadeklarowana wyspa istnieje na dysku", () => {
    const present = new Set(FILES.map((f) => f.path));
    for (const island of LAZY_ISLANDS) {
      for (const module of island.modules) {
        expect(present, `wyspa "${island.name}" wskazuje nieistniejący plik ${module}`).toContain(
          module,
        );
      }
    }
  });

  it("żaden moduł spoza wyspy nie wciąga SDK płatności do chunku eager", () => {
    const violations = findIslandViolations(FILES);
    expect(violations.length, `\n${formatViolations(violations)}\n`).toBe(0);
  });
});
