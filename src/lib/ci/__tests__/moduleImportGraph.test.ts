// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildImportGraph, resolveImport, valueImports } from "../moduleImportGraph";

describe("valueImports", () => {
  const specs = (source: string, path = "src/a.ts"): string[] =>
    valueImports(path, source).map((item) => `${item.dynamic ? "dyn:" : ""}${item.specifier}`);

  it("import typu kompilator wymazuje - nie jest zależnością wartości", () => {
    expect(
      specs(`
        import type { A } from "@/lib/a";
        import { type B, type C } from "@/lib/b";
        export type { D } from "@/lib/d";
        export { type E } from "@/lib/e";
      `),
    ).toEqual([]);
  });

  it("import mieszany, domyślny, przestrzeń nazw, efekt uboczny i reeksport to wartości", () => {
    expect(
      specs(`
        import { type A, b } from "@/lib/mixed";
        import Def from "@/lib/def";
        import * as ns from "@/lib/ns";
        import "@/lib/side";
        export { x } from "@/lib/reexport";
        export * from "@/lib/star";
      `),
    ).toEqual([
      "@/lib/mixed",
      "@/lib/def",
      "@/lib/ns",
      "@/lib/side",
      "@/lib/reexport",
      "@/lib/star",
    ]);
  });

  it("import() jest leniwy, a import w komentarzu i w literale nie istnieje", () => {
    expect(
      specs(
        `// import { x } from "@/lib/comment";
         const s = 'import y from "@/lib/string"';
         export const C = () => import("@/lib/lazy");`,
        "src/c.tsx",
      ),
    ).toEqual(["dyn:@/lib/lazy"]);
  });
});

describe("resolveImport", () => {
  const files = new Set(["src/lib/a.ts", "src/lib/b/index.ts", "src/components/C.tsx"]);
  const exists = (path: string): boolean => files.has(path);

  it("alias @/, ścieżka względna, katalog z index, pakiet", () => {
    expect(resolveImport("src/x.ts", "@/lib/a", exists)).toBe("src/lib/a.ts");
    expect(resolveImport("src/lib/deep/x.ts", "../b", exists)).toBe("src/lib/b/index.ts");
    expect(resolveImport("src/components/D.tsx", "./C", exists)).toBe("src/components/C.tsx");
    expect(resolveImport("src/x.ts", "react", exists)).toBeNull();
    expect(resolveImport("src/x.ts", "@/lib/missing", exists)).toBeNull();
  });
});

describe("buildImportGraph", () => {
  it("krawędzie tylko między plikami ze zbioru, bez pętli własnych", () => {
    const sources: Record<string, string> = {
      "src/a.ts": `import { b } from "./b"; import "react"; import { a } from "./a";`,
      "src/b.ts": `export const b = () => import("@/a");`,
    };
    expect(buildImportGraph(Object.keys(sources), (path) => sources[path]!)).toEqual([
      { from: "src/a.ts", to: "src/b.ts", dynamic: false },
      { from: "src/b.ts", to: "src/a.ts", dynamic: true },
    ]);
  });
});
