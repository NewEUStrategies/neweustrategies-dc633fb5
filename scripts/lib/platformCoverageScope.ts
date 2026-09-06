import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import auditScope from "../../governance/platform-coverage-scope.json";
import { classifyPath } from "../taxonomy/moduleMap.mjs";

// The same generated artifacts excluded by the repository's existing V8
// configuration. Do not demand counters for files V8 intentionally omits.
const GENERATED = new Set([
  "src/routeTree.gen.ts",
  "src/integrations/supabase/types.ts",
  "src/lib/icons/lucideIconNodes.generated.ts",
]);

/** Preserve every audited file after taxonomy corrections, and automatically
 * add new executable platform files. Tests and generated/type-only code do not
 * contribute executable lines to V8's denominator.
 */
export function platformCoverageFiles(root = process.cwd()): string[] {
  const files = new Set(auditScope.files);
  function walk(dir: string): void {
    for (const item of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${item.name}`;
      if (item.isDirectory()) {
        if (item.name !== "__tests__" && path !== "src/test") walk(path);
        continue;
      }
      if (
        !/\.tsx?$/.test(path) ||
        /\.(test|spec|d)\.tsx?$/.test(path) ||
        GENERATED.has(path) ||
        classifyPath(path).module !== 20 ||
        files.has(path)
      )
        continue;
      const emitted = ts
        .transpileModule(readFileSync(join(root, path), "utf8"), {
          fileName: path,
          compilerOptions: {
            target: ts.ScriptTarget.ESNext,
            module: ts.ModuleKind.ESNext,
            jsx: ts.JsxEmit.ReactJSX,
            removeComments: true,
          },
        })
        .outputText.trim();
      if (emitted && emitted !== "export {};") files.add(path);
    }
  }
  walk("src");
  return [...files].sort();
}
