// Zapadka D4 (roadmapa ładowania §9.1): żaden moduł aplikacji nie importuje
// ikon jako przestrzeni nazw (`import * as X from "@/lib/lucide-shim"` albo
// `from "lucide-react"`, także `export * as`).
//
// DLACZEGO. Rolldown buduje obiekt przestrzeni nazw w chunku modułu, którego
// dotyczy - shim i `lucide-react` są w chunku startowym - i obiekt ten trzyma
// referencję do KAŻDEJ ikony, więc żadna nie może opuścić domknięcia startu.
// Do 16.11.2026 sześć modułów publicznych tak importowało shim (wybór ikony
// nazwą z treści CMS); teraz robi to `shimIconByName`, a pełna mapa nazw żyje
// w leniwym `shimIconMap.ts`. `DynamicIcon.tsx` opisuje tę samą regresję dla
// `lucide-react` (cała biblioteka w chunku wejściowym).
//
// Pomiar na źródle parserem TypeScriptu (jak `src/test/routeSourceImports.ts`),
// nie regexem: wzmianka w komentarzu nie jest importem. Testy są poza zakresem
// (nie trafiają do bundla; porównują z przestrzenią nazw celowo).
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");
const ICON_MODULES = new Set(["@/lib/lucide-shim", "lucide-react"]);

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      yield* sourceFiles(path);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
      yield path;
    }
  }
}

/** Czy specyfikator wskazuje moduł ikon (alias albo ścieżka względna do shimu). */
function isIconModule(specifier: string): boolean {
  return ICON_MODULES.has(specifier) || /(^|\/)lucide-shim(\.tsx?)?$/.test(specifier);
}

function namespaceImportsOf(path: string, text: string): string[] {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  const found: string[] = [];
  for (const stmt of file.statements) {
    const spec =
      (ts.isImportDeclaration(stmt) || ts.isExportDeclaration(stmt)) &&
      stmt.moduleSpecifier &&
      ts.isStringLiteral(stmt.moduleSpecifier)
        ? stmt.moduleSpecifier.text
        : undefined;
    if (!spec || !isIconModule(spec)) continue;
    const ns = ts.isImportDeclaration(stmt)
      ? stmt.importClause?.namedBindings && ts.isNamespaceImport(stmt.importClause.namedBindings)
      : ts.isExportDeclaration(stmt) &&
        (stmt.exportClause === undefined || ts.isNamespaceExport(stmt.exportClause));
    if (ns) {
      const line = file.getLineAndCharacterOfPosition(stmt.getStart(file)).line + 1;
      found.push(`${relative(process.cwd(), path)}:${line} (${spec})`);
    }
  }
  return found;
}

describe("ikony: zakaz importu przestrzeni nazw shimu i lucide-react w kodzie aplikacji", () => {
  it("żaden plik źródłowy nie importuje ikon przez `* as`", () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const path of sourceFiles(SRC)) {
      const text = readFileSync(path, "utf8");
      if (!text.includes("lucide") || !text.includes("*")) continue;
      scanned += 1;
      offenders.push(...namespaceImportsOf(path, text));
    }
    expect(scanned).toBeGreaterThan(10);
    expect(offenders).toEqual([]);
  });

  it("rozpoznaje import i reeksport przestrzeni nazw, ale nie wzmiankę w komentarzu", () => {
    const sample = [
      '// import * as Icons from "@/lib/lucide-shim";',
      'import * as Icons from "@/lib/lucide-shim";',
      'import * as L from "lucide-react";',
      'import * as Shim from "../../lib/lucide-shim";',
      'export * from "@/lib/lucide-shim";',
      'import { Star } from "@/lib/lucide-shim";',
      'export { Star } from "lucide-react";',
    ].join("\n");
    expect(namespaceImportsOf("probka.tsx", sample).map((s) => s.replace(/^.*:/, ""))).toEqual([
      "2 (@/lib/lucide-shim)",
      "3 (lucide-react)",
      "4 (../../lib/lucide-shim)",
      "5 (@/lib/lucide-shim)",
    ]);
  });
});
