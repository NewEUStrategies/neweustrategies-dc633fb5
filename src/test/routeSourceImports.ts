// Pomocnik testów: zależności pliku trasy pogrupowane według CHWILI, w której
// się ładują - pomiar na ŹRÓDLE dla granicy „pakiet dopiero w czasie żądania".
//
// PO CO. Drzewo tras SSR importuje KAŻDY plik trasy przy każdym żądaniu, więc
// statyczny import opcjonalnego pakietu (SDK MCP) wciąga go do grafu całej
// witryny: awaria jego inicjalizacji kładzie także strony niezwiązane z trasą.
// W runtime testu tej różnicy nie widać - atrapa `vi.mock` odpowiada
// identycznie przy imporcie górnym i dynamicznym - więc granicę da się
// sprawdzić tylko na źródle.
//
// DLACZEGO PARSER, A NIE REGEX. Regex `^import\s[\s\S]*?from\s+"..."` nie
// widział gołego `import "pakiet";` (leniwe dopasowanie sięgało do `from`
// NASTĘPNEGO importu i zgłaszało tylko jego specyfikator) ani `export ... from`
// - obie formy wciągają pakiet do grafu SSR tak samo jak import z nazwami,
// a test był zielony. Parser TypeScriptu widzi każdą deklarację wprost.
//
// WSPÓLNY, bo tę samą granicę pilnują `src/routes/[.mcp]/-mcpRouteHandlers.test.ts`
// i `src/routes/__tests__/mcpEntryRoutes.test.ts` - dwie kopie pomiaru już raz
// się rozjechały (jedna dostała parser, druga została przy dziurawym regexie).
import ts from "typescript";

/** Zależności pliku trasy pogrupowane według CHWILI, w której się ładują. */
export interface ZaleznosciTrasy {
  /** Statyczny graf modułu - ładuje się razem z drzewem tras SSR. */
  readonly statyczne: string[];
  /** `import(...)` wewnątrz handlera `ANY` - ładuje się dopiero w czasie żądania. */
  readonly wHandlerze: string[];
  /** `import(...)` poza handlerem (np. `await import` w zasięgu modułu) - też przy imporcie. */
  readonly pozaHandlerem: string[];
}

/** Nazwa właściwości obiektu albo metody; `undefined` dla nazw liczonych. */
function nazwa(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

/**
 * Czy węzeł leży w ciele handlera `ANY` (`ANY: async () => ...`, `ANY() {...}`).
 * Handler podany referencją do funkcji z zasięgu modułu (`ANY: obsluz`) się nie
 * liczy - jego `import(...)` trafia do `pozaHandlerem`, więc pomiar myli się
 * w stronę porażki, nie fałszywej zieleni.
 */
function wHandlerzeAny(node: ts.Node): boolean {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isMethodDeclaration(n) && nazwa(n.name) === "ANY") return true;
    if (ts.isFunctionLike(n) && ts.isPropertyAssignment(n.parent) && nazwa(n.parent.name) === "ANY")
      return true;
  }
  return false;
}

/**
 * Rozbiera źródło pliku trasy na trzy grupy zależności. `plik` służy tylko
 * parserowi; źródło czyta wołający, bo i tak sprawdza na nim adres trasy.
 */
export function zaleznosciTrasy(plik: string, source: string): ZaleznosciTrasy {
  const sf = ts.createSourceFile(plik, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  // Specyfikator niebędący literałem (np. zmienna) zostaje widoczny w porażce.
  const specyfikator = (node: ts.Node | undefined): string =>
    node && ts.isStringLiteralLike(node) ? node.text : `<wyrażenie: ${node?.getText(sf)}>`;
  const statyczne: string[] = [];
  const wHandlerze: string[] = [];
  const pozaHandlerem: string[] = [];

  for (const st of sf.statements) {
    // `import type` / `export type` kompilator wymazuje w całości - do grafu nie trafiają.
    if (ts.isImportDeclaration(st)) {
      if (!st.importClause?.isTypeOnly) statyczne.push(specyfikator(st.moduleSpecifier));
    } else if (ts.isExportDeclaration(st)) {
      if (st.moduleSpecifier && !st.isTypeOnly) statyczne.push(specyfikator(st.moduleSpecifier));
    } else if (
      ts.isImportEqualsDeclaration(st) &&
      ts.isExternalModuleReference(st.moduleReference)
    ) {
      if (!st.isTypeOnly) statyczne.push(specyfikator(st.moduleReference.expression));
    }
  }

  const odwiedz = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      (wHandlerzeAny(node) ? wHandlerze : pozaHandlerem).push(specyfikator(node.arguments[0]));
    }
    ts.forEachChild(node, odwiedz);
  };
  odwiedz(sf);

  return { statyczne, wHandlerze, pozaHandlerem };
}
