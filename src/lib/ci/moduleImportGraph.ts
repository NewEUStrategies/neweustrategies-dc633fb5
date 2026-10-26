// Graf importów plików produkcyjnych `src/` - wejście dla granic warstw
// taksonomii (`scripts/taxonomy/moduleMap.mjs`, audyt ED14).
//
// DLACZEGO PARSER, A NIE REGEX. Graf audytu ED14 liczony regexem miał krawędź
// i parę obustronną, które istniały wyłącznie w komentarzu
// (`lazySuspense.tsx:10`); parser TypeScriptu dał 383 krawędzie zamiast 384.
// Import typu (`import type`, `import { type A }`, `export type … from`)
// kompilator wymazuje - nie jest zależnością w czasie wykonania i nie liczy
// się jako import wartości.
//
// Moduł nie czyta dysku: źródła i istnienie plików wchodzą parametrami.
import ts from "typescript";

export interface ImportEdge {
  readonly from: string;
  readonly to: string;
  /** `import(...)` - ładuje się leniwie, nie należy do statycznego grafu. */
  readonly dynamic: boolean;
}

interface RawImport {
  readonly specifier: string;
  readonly dynamic: boolean;
}

function isTypeOnlyImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return false; // `import "x"` - efekt uboczny, wartość.
  if (clause.isTypeOnly) return true;
  if (clause.name) return false;
  const bindings = clause.namedBindings;
  return (
    bindings !== undefined &&
    ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 &&
    bindings.elements.every((element) => element.isTypeOnly)
  );
}

function isTypeOnlyExport(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;
  const clause = node.exportClause;
  return (
    clause !== undefined &&
    ts.isNamedExports(clause) &&
    clause.elements.length > 0 &&
    clause.elements.every((element) => element.isTypeOnly)
  );
}

/** Moduły JavaScript w `src/` (np. `lib/icons/iconChunkIndex.js`) też są w grafie. */
const SCRIPT_KINDS: Readonly<Record<string, ts.ScriptKind>> = {
  ".ts": ts.ScriptKind.TS,
  ".tsx": ts.ScriptKind.TSX,
  ".js": ts.ScriptKind.JS,
  ".jsx": ts.ScriptKind.JSX,
  ".mjs": ts.ScriptKind.JS,
  ".cjs": ts.ScriptKind.JS,
};

/** Importy WARTOŚCI pliku: statyczne (`import`, `export … from`) i `import(...)`. */
export function valueImports(path: string, source: string): RawImport[] {
  const kind = SCRIPT_KINDS[path.slice(path.lastIndexOf("."))] ?? ts.ScriptKind.TS;
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false, kind);
  const found: RawImport[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!isTypeOnlyImport(node))
        found.push({ specifier: node.moduleSpecifier.text, dynamic: false });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      if (!isTypeOnlyExport(node))
        found.push({ specifier: node.moduleSpecifier.text, dynamic: false });
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      found.push({ specifier: node.arguments[0].text, dynamic: true });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

const EXTENSIONS = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  "/index.ts",
  "/index.tsx",
  "/index.js",
] as const;

/** Specyfikator ESM `./x.js` wskazuje w TypeScripcie także `x.ts` / `x.tsx`. */
const JS_SPECIFIER = /\.(m?js|jsx)$/;

/** Plik repo, na który wskazuje specyfikator (`@/…` albo względny), albo `null` (pakiet). */
export function resolveImport(
  from: string,
  specifier: string,
  exists: (path: string) => boolean,
): string | null {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = `src/${specifier.slice(2)}`;
  } else if (specifier.startsWith(".")) {
    const parts = from.split("/").slice(0, -1);
    for (const segment of specifier.split("/")) {
      if (segment === "..") parts.pop();
      else if (segment !== ".") parts.push(segment);
    }
    base = parts.join("/");
  } else {
    return null;
  }
  for (const extension of EXTENSIONS) {
    if (exists(base + extension)) return base + extension;
  }
  if (JS_SPECIFIER.test(base)) {
    const stem = base.replace(JS_SPECIFIER, "");
    for (const extension of [".ts", ".tsx"]) {
      if (exists(stem + extension)) return stem + extension;
    }
  }
  return null;
}

/** Krawędzie importów wartości między plikami ze zbioru `files`. */
export function buildImportGraph(
  files: readonly string[],
  read: (path: string) => string,
): ImportEdge[] {
  const known = new Set(files);
  const edges: ImportEdge[] = [];
  for (const from of files) {
    for (const raw of valueImports(from, read(from))) {
      const to = resolveImport(from, raw.specifier, (path) => known.has(path));
      if (to !== null && to !== from) edges.push({ from, to, dynamic: raw.dynamic });
    }
  }
  return edges;
}
