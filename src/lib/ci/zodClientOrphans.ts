// Zapadka J2: schemat zod, którego bundel przeglądarki nie używa, nie wraca
// do chunków klienta jako gołe wywołanie.
//
// SKĄD KLASA DEFEKTU (roadmapa ładowania, §9.1 J2 i §9.5). Rolldown usuwa
// nieużywaną NAZWĘ, ale nie umie dowieść, że łańcuch `z.object(...)` nie ma
// skutków ubocznych - w chunku zostaje samo wywołanie, razem ze stałymi, które
// tylko ono czyta. Dzieje się tak, gdy po stronie klienta schemat nie ma
// żadnego odczytu WARTOŚCI:
//   * jest czytany tylko w typach (`z.infer<typeof X>`) - typy znikają,
//     wywołanie zostaje;
//   * jest czytany tylko w częściach funkcji serwerowej, które kompilator
//     Start zdejmuje z bundla przeglądarki (`.inputValidator(...)`,
//     `.validator(...)`, `.handler(...)`, `createServerOnlyFn(...)`,
//     `createIsomorphicFn().server(...)`), a deklarację trzyma eksport albo
//     `typeof` w NIEeksportowanym typie (eliminacja martwego kodu kompilatora,
//     `babel-dead-code-elimination`, liczy go jako odczyt; `export type`
//     zdejmuje wcześniej `stripTypeExports`, więc taki typ schematu nie trzyma);
//   * jest czytany tylko w inicjalizatorze innej sieroty (zostaje razem z nią);
//   * nie jest czytany wcale (albo tylko w testach).
// Partia 1 zamieniła takie schematy w typy albo owinęła je w
// `/* @__PURE__ */ (() => schemat)()` - jedno bezargumentowe wywołanie, które
// bundlerowi wolno usunąć w całości (wartość i moment budowy na serwerze bez
// zmian). Nic jednak nie broniło przed NOWYM takim schematem.
//
// JAK. Z kodu produkcyjnego `src/**` (drzewo składniowe TS, bez kompilacji):
//   1. moduły osiągalne z wejścia klienta (`src/router.tsx` z drzewem tras,
//      `src/start.ts`) importami wartości, statycznymi i `import()`, bez
//      modułów `*.server.*` (ochrona importów Start nie wpuszcza ich do
//      klienta) - to nadzbiór bundla klienta: import czytany wyłącznie
//      w zdjętym handlerze też jest krawędzią, więc moduł czysto serwerowy
//      bywa tu „osiągalny" (fałszywy alarm, nie luka; naprawa przez owijkę
//      jest wtedy bez skutku i bez kosztu);
//   2. w tych modułach stałe najwyższego poziomu, których inicjalizator to
//      łańcuch wywołań od importu `zod` albo od innego takiego schematu
//      (`Base.extend(...)`, także z importu);
//   3. odczyty każdego schematu w jego pliku i w osiągalnych plikach, które go
//      importują: w typie, w części zdejmowanej przez Start, wewnątrz innego
//      schematu albo „żywy" (każdy inny odczyt wartości). Schemat czytany
//      w inicjalizatorze innego schematu żyje, gdy żyje tamten (punkt stały).
//      Żywotność liczy się PO NAZWIE, nie po pliku: import przez `export { X }
//      from` / `export *` trafia do deklaracji, a z `import()` i `import * as
//      ns` żyją tylko nazwy przeczytane (`m.x`, rozkład, `.then((m) => m.x)`,
//      `Promise.all`, `lazy` - niżej, „Odczyty przestrzeni nazw"). Przestrzeń
//      nazw, która ucieka (oddana jako wartość, zwrócona, `...rest`), modułu
//      z eksportowanymi schematami musi być na liście przejrzanej
//      `ZOD_NAMESPACE_ESCAPES_REVIEWED` - inaczej nie daje odczytu, a test
//      czerwieni (fail closed; przegląd partii 5: wcześniej każdy eksport
//      celu `import()` i reeksportu uchodził za żywy, 498 z 4417 modułów);
//   4. w plikach kompilatora Start model jego eliminacji martwego kodu
//      (`findRemovableBindings`): nieeksportowany schemat, który miał odczyt,
//      a po zdjęciu części serwerowych nie ma żadnego, znika z klienta - to
//      nie sierota.
// Schemat bez żywego odczytu, nieowinięty w `@__PURE__`, jest sierotą.
//
// SPRAWDZONE NA BUILDZIE (`49fc9375`, chunki klienta): gołe wywołania
// schematów w chunkach to dokładnie trzy sieroty z listy niżej
// (`ContactInput`, `ListInput`, `ManualLifecycleStageSchema`); pozostałe
// siedem to schematy, które trzymają te wywołania. Zdjęcie owijek partii 1
// w pamięci daje 26 z 29 owiniętych stałych jako sieroty (model po nazwie;
// po pliku było 24 - umykał reeksportowany `NewsletterSunsetCopyOverridesSchema`
// i schemat, który on trzyma). Trzy pozostałe: stała spoza zod, odczyt
// w funkcji, schemat trasy kopiowany przez podział kodu - poza modelem, niżej.
//
// POZA ZAKRESEM (świadomie): sieroty inne niż schematy zod (zaślepki funkcji
// serwerowych bez importera - J7, stałe, `new TextEncoder()`), schemat
// czytany tylko w funkcji, którą bundler usuwa jako nieużywaną (model liczy
// każdy odczyt wartości jako żywy), oraz kopie stałych w chunkach podziału
// kodu tras.
// Lista dzisiejszych sierot (`ZOD_CLIENT_ORPHANS_REVIEWED`) może TYLKO maleć -
// test pilnuje obu kierunków, jak zapadka `MAX_UNRESOLVED_SITES`.
//
// Moduł jest CZYSTY (bez fs): test karmi go źródłami z `loadProductionSources`
// albo wycinkami kodu.
import ts from "typescript";

import { resolveImport } from "./moduleImportGraph";

export interface ZodSourceFile {
  readonly file: string;
  readonly code: string;
}

/** Dlaczego schemat nie ma żywego odczytu w kliencie. */
export type ZodOrphanReason = "tylko-typy" | "tylko-serwer" | "w-sierocie" | "brak-odczytu";

export interface ZodClientOrphan {
  readonly file: string;
  readonly name: string;
  readonly reason: ZodOrphanReason;
}

/** Wejście klienta: router (drzewo tras) i konfiguracja Start. */
export const CLIENT_ROOTS: readonly string[] = ["src/router.tsx", "src/start.ts"];

/**
 * Sieroty istniejące w dniu wprowadzenia zapadki (`plik:nazwa`), każda
 * z powodem. Lista może TYLKO maleć: nowy schemat bez żywego odczytu
 * w kliencie zamień w typ (`z.infer` -> zwykły typ TS) albo owiń w
 * `/* @__PURE__ *\/ (() => ...)()` (uzasadnienie: `lib/menus/types.ts`).
 */
export const ZOD_CLIENT_ORPHANS_REVIEWED: Readonly<Record<string, string>> = {
  "src/lib/contact.functions.ts:ConsentEntry":
    "w-sierocie: czytany tylko w `ContactInput` (wyżej); moduł formularza kontaktowego i zgód - poza zakresem tej partii.",
  "src/lib/contact.functions.ts:ContactInput":
    "tylko-typy: walidator serwera + `type ContactPayload = z.infer<...>` (nieeksportowany typ trzyma deklarację); gołe `c.extend({...})` w chunku `contact.functions` (590 B surowego).",
  "src/lib/crm.functions.ts:ListInput":
    "tylko-typy: walidatory serwera + `type ListParams = z.infer<...>`; gołe `u.extend({...})` w chunku `leadMutations` (196 B).",
  "src/lib/crm/leadListSpec.ts:LeadLifecycleStageSchema":
    "w-sierocie: czytany tylko przez `LeadListFilterSchema` (trzymany przez `ListInput`).",
  "src/lib/crm/leadListSpec.ts:LeadListFilterSchema":
    "w-sierocie: korzeń `ListInput.extend` w `crm.functions.ts`.",
  "src/lib/crm/leadListSpec.ts:LeadSortDirSchema": "w-sierocie: czytany tylko w `ListInput`.",
  "src/lib/crm/leadListSpec.ts:LeadSortKeySchema": "w-sierocie: czytany tylko w `ListInput`.",
  "src/lib/crm/leadListSpec.ts:LeadSourceSchema":
    "w-sierocie: czytany tylko przez `LeadListFilterSchema`.",
  "src/lib/crm/leadListSpec.ts:LeadSourceTypeSchema":
    "w-sierocie: czytany tylko przez `LeadListFilterSchema`.",
  "src/lib/crm/leadListSpec.ts:ManualLifecycleStageSchema":
    "w-sierocie: czytany tylko w schemacie walidatora usuwanym przez Start; gołe `e(h)` w chunku `leadListSpec` (4 B).",
};

const SERVER_FILE = /\.server\.[cm]?[jt]sx?$/;

/** Metody łańcucha `createServerFn()` / `createMiddleware()`, których argumenty Start zdejmuje z klienta. */
const SERVER_STRIPPED_METHODS = new Set(["handler", "inputValidator", "validator", "server"]);
/** Fabryki, których łańcuch zdejmuje kompilator Start. */
const SERVER_FACTORIES = new Set([
  "createServerFn",
  "createMiddleware",
  "createIsomorphicFn",
  "createServerOnlyFn",
]);

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Korzeń łańcucha `a.b(...).c(...)` - identyfikator albo `null`. */
function chainRoot(expr: ts.Expression): ts.Identifier | null {
  let node = unwrap(expr);
  for (;;) {
    if (ts.isCallExpression(node) || ts.isPropertyAccessExpression(node)) {
      node = unwrap(node.expression);
      continue;
    }
    return ts.isIdentifier(node) ? node : null;
  }
}

/** `/* @__PURE__ *\/ (() => ...)()` - wywołanie, które bundler może usunąć w całości. */
function isPureIife(init: ts.Expression, sf: ts.SourceFile): boolean {
  const node = unwrap(init);
  if (!ts.isCallExpression(node) || node.arguments.length !== 0) return false;
  const callee = unwrap(node.expression);
  if (!ts.isArrowFunction(callee) && !ts.isFunctionExpression(callee)) return false;
  // Adnotacja stoi przed wywołaniem (trivia inicjalizatora).
  const trivia = sf.text.slice(init.pos, node.getStart(sf));
  return /[@#]__PURE__/.test(trivia);
}

/** Ciało-wyrażenie owijki `(() => ...)()`; `null` - ciało w bloku albo inny kształt. */
function pureIifeBody(init: ts.Expression): ts.Expression | null {
  const call = unwrap(init);
  if (!ts.isCallExpression(call)) return null;
  const fn = unwrap(call.expression);
  if (!ts.isArrowFunction(fn) || ts.isBlock(fn.body)) return null;
  return fn.body;
}

interface SchemaDecl {
  readonly file: string;
  readonly name: string;
  readonly init: ts.Expression;
  readonly pure: boolean;
  readonly exported: boolean;
}

interface ImportBinding {
  /** Moduł repo albo `null` (pakiet, plik spoza zbioru). */
  readonly target: string | null;
  readonly spec: string;
  /** Nazwa w module docelowym; `default`; `*` - import przestrzeni nazw. */
  readonly imported: string;
  readonly typeOnly: boolean;
  /** Identyfikator wiązania w deklaracji importu. */
  readonly node: ts.Identifier;
}

interface ParsedFile {
  readonly file: string;
  readonly sf: ts.SourceFile;
  /** Nazwa lokalna -> wiązanie importu. */
  readonly imports: Map<string, ImportBinding>;
  /** Eksporty lokalne: nazwa eksportu -> nazwa lokalna (`export const X`, `export { a as b }`, `export default X`). */
  readonly localExports: ReadonlyMap<string, string>;
  /** `export { a as b } from "./m"` (b -> m:a) i `export * as ns from "./m"` (ns -> m:*). */
  readonly namedReexports: ReadonlyMap<
    string,
    { readonly target: string | null; readonly imported: string }
  >;
  /** `export * from "./m"` - moduły docelowe. */
  readonly starReexports: readonly string[];
  /** Plik przechodzi przez kompilator Start (importuje jego fabrykę). */
  readonly startCompiled: boolean;
  /** Pliki repo importowane jako wartość: `import`, `export … from`, `import()`. */
  readonly valueDeps: readonly string[];
  /** Wywołania `import()` modułów repo. */
  readonly dynamicImports: ReadonlyArray<{
    readonly target: string;
    readonly call: ts.CallExpression;
  }>;
  /** Nazwy LOKALNE eksportowane (wartości `localExports`). */
  readonly exportedNames: ReadonlySet<string>;
}

function parse(file: string, code: string, known: ReadonlySet<string>): ParsedFile {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, kind);
  const imports: ParsedFile["imports"] = new Map();
  const localExports = new Map<string, string>();
  const namedReexports = new Map<string, { target: string | null; imported: string }>();
  const starReexports: string[] = [];
  const valueDeps: string[] = [];
  const dynamicImports: Array<{ target: string; call: ts.CallExpression }> = [];
  const exists = (path: string): boolean => known.has(path);
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const spec = stmt.moduleSpecifier.text;
      const target = resolveImport(file, spec, exists);
      const clause = stmt.importClause;
      // Import wartości (jak `valueImports` w `moduleImportGraph.ts`): także
      // `import "x"`; `import type` i same `{ type A }` - nie.
      const typeOnly =
        clause !== undefined &&
        (clause.isTypeOnly ||
          (clause.name === undefined &&
            clause.namedBindings !== undefined &&
            ts.isNamedImports(clause.namedBindings) &&
            clause.namedBindings.elements.length > 0 &&
            clause.namedBindings.elements.every((el) => el.isTypeOnly)));
      if (target !== null && !typeOnly) valueDeps.push(target);
      if (!clause) continue;
      if (clause.name) {
        imports.set(clause.name.text, {
          target,
          spec,
          imported: "default",
          typeOnly: clause.isTypeOnly,
          node: clause.name,
        });
      }
      const named = clause.namedBindings;
      if (named && ts.isNamespaceImport(named)) {
        imports.set(named.name.text, {
          target,
          spec,
          imported: "*",
          typeOnly: clause.isTypeOnly,
          node: named.name,
        });
      } else if (named && ts.isNamedImports(named)) {
        for (const el of named.elements) {
          imports.set(el.name.text, {
            target,
            spec,
            imported: (el.propertyName ?? el.name).text,
            typeOnly: clause.isTypeOnly || el.isTypeOnly,
            node: el.name,
          });
        }
      }
    } else if (
      ts.isExportDeclaration(stmt) &&
      stmt.moduleSpecifier &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      !stmt.isTypeOnly
    ) {
      const target = resolveImport(file, stmt.moduleSpecifier.text, exists);
      if (target !== null) valueDeps.push(target);
      const clause = stmt.exportClause;
      if (clause === undefined) {
        if (target !== null) starReexports.push(target);
      } else if (ts.isNamespaceExport(clause)) {
        namedReexports.set(clause.name.text, { target, imported: "*" });
      } else {
        for (const el of clause.elements) {
          if (el.isTypeOnly) continue;
          namedReexports.set(el.name.text, { target, imported: (el.propertyName ?? el.name).text });
        }
      }
    } else if (
      ts.isExportDeclaration(stmt) &&
      stmt.moduleSpecifier === undefined &&
      stmt.exportClause !== undefined &&
      ts.isNamedExports(stmt.exportClause) &&
      !stmt.isTypeOnly
    ) {
      for (const el of stmt.exportClause.elements) {
        if (!el.isTypeOnly) localExports.set(el.name.text, (el.propertyName ?? el.name).text);
      }
    } else if (ts.isExportAssignment(stmt) && ts.isIdentifier(stmt.expression)) {
      localExports.set("default", stmt.expression.text);
    } else if (ts.isVariableStatement(stmt) && hasExport(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) localExports.set(decl.name.text, decl.name.text);
      }
    }
  }
  if (code.includes("import(")) {
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] !== undefined &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        const target = resolveImport(file, node.arguments[0].text, exists);
        if (target !== null) {
          valueDeps.push(target);
          dynamicImports.push({ target, call: node });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  const startCompiled = [...imports.entries()].some(
    ([, imp]) => imp.spec.startsWith("@tanstack/") && SERVER_FACTORIES.has(imp.imported),
  );
  return {
    file,
    sf,
    imports,
    localExports,
    namedReexports,
    starReexports,
    startCompiled,
    valueDeps,
    dynamicImports,
    exportedNames: new Set(localExports.values()),
  };
}

function hasExport(stmt: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(stmt) &&
    (ts.getModifiers(stmt) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

/** Czy identyfikator stoi w pozycji typu (`typeof X` w typie, adnotacja). */
function inTypePosition(node: ts.Node): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isTypeNode(current)) return true;
    if (ts.isStatement(current) || ts.isSourceFile(current)) return false;
  }
  return false;
}

/** Czy węzeł leży w eksportowanej deklaracji typu (`export type X = ...`, `export interface`). */
function inExportedType(node: ts.Node): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isTypeAliasDeclaration(current) || ts.isInterfaceDeclaration(current)) {
      return hasExport(current);
    }
    if (ts.isSourceFile(current)) return false;
  }
  return false;
}

/** Czy łańcuch, w którym stoi wywołanie, zaczyna się od fabryki Start (`createServerFn()` ...). */
function rootedAtServerFactory(call: ts.CallExpression): boolean {
  const root = chainRoot(call);
  return root !== null && SERVER_FACTORIES.has(root.text);
}

/** Czy odczyt leży w argumencie, który kompilator Start zdejmuje z bundla klienta. */
function inServerStrippedPart(node: ts.Node): boolean {
  for (let current: ts.Node = node; current.parent; current = current.parent) {
    const parent = current.parent;
    if (ts.isCallExpression(parent) && parent.arguments.includes(current as ts.Expression)) {
      const callee = unwrap(parent.expression);
      if (
        ts.isPropertyAccessExpression(callee) &&
        SERVER_STRIPPED_METHODS.has(callee.name.text) &&
        rootedAtServerFactory(parent)
      ) {
        return true;
      }
      if (ts.isIdentifier(callee) && callee.text === "createServerOnlyFn") return true;
    }
  }
  return false;
}

/** Odczyt identyfikatora `name` (nie deklaracja, nie nazwa właściwości, nie specyfikator). */
function isReference(id: ts.Identifier, name: string): boolean {
  if (id.text !== name) return false;
  const parent = id.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === id) return false;
  if (ts.isQualifiedName(parent) && parent.right === id) return false;
  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent) ||
      ts.isEnumMember(parent)) &&
    parent.name === id
  ) {
    return false;
  }
  if (
    (ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent)) &&
    parent.name === id
  ) {
    return false;
  }
  if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) {
    return false;
  }
  if (ts.isExportSpecifier(parent)) return false;
  if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return false;
  return true;
}

type UseKind = "type" | "server" | "value";

interface Use {
  readonly kind: UseKind;
  /**
   * Odczyt w typie eksportowanym (`export type`, `export interface`). Kompilator
   * Start zdejmuje takie deklaracje PRZED eliminacją martwego kodu
   * (`stripTypeExports` w `@tanstack/router-utils`), więc nie trzymają schematu.
   */
  readonly inExportedType: boolean;
  /** Schemat, w którego inicjalizatorze stoi odczyt (`null` - poza schematami). */
  readonly inside: SchemaDecl | null;
}

/** Identyfikatory pliku po nazwie, ze schematem, w którego inicjalizatorze stoją. */
type IdentifierIndex = Map<
  string,
  Array<{ readonly id: ts.Identifier; readonly inside: SchemaDecl | null }>
>;

function indexIdentifiers(
  parsed: ParsedFile,
  schemasOfFile: ReadonlyMap<ts.Expression, SchemaDecl>,
): IdentifierIndex {
  const index: IdentifierIndex = new Map();
  const visit = (node: ts.Node, inside: SchemaDecl | null): void => {
    const owner = ts.isExpression(node) ? (schemasOfFile.get(node) ?? inside) : inside;
    if (ts.isIdentifier(node)) {
      const list = index.get(node.text) ?? [];
      list.push({ id: node, inside: owner });
      index.set(node.text, list);
    }
    ts.forEachChild(node, (child) => visit(child, owner));
  };
  visit(parsed.sf, null);
  return index;
}

/** Odczyty nazwy `name` w pliku, z klasyfikacją. */
function usesIn(index: IdentifierIndex, name: string): Use[] {
  const uses: Use[] = [];
  for (const { id, inside } of index.get(name) ?? []) {
    if (!isReference(id, name)) continue;
    // Część zdejmowana przez Start znika razem z typami w niej.
    const kind: UseKind = inServerStrippedPart(id)
      ? "server"
      : inTypePosition(id)
        ? "type"
        : "value";
    uses.push({ kind, inside, inExportedType: kind === "type" && inExportedType(id) });
  }
  return uses;
}

/** Odczyt użycia w węźle `node` pliku (rodzaj z pozycji, schemat-kontener z indeksu inicjalizatorów). */
function classifyReadAt(node: ts.Node, schemasOfFile: ReadonlyMap<ts.Expression, SchemaDecl>): Use {
  let inside: SchemaDecl | null = null;
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    const schema = ts.isExpression(current) ? schemasOfFile.get(current) : undefined;
    if (schema !== undefined) {
      inside = schema;
      break;
    }
  }
  const kind: UseKind = inServerStrippedPart(node)
    ? "server"
    : inTypePosition(node)
      ? "type"
      : "value";
  return { kind, inside, inExportedType: kind === "type" && inExportedType(node) };
}

// ── Odczyty przestrzeni nazw (`import()`, `import * as ns`) PO NAZWIE ──────
//
// `import()` daje obiekt przestrzeni nazw modułu; bundler zostawia z modułu
// eksporty, które ktoś z tego obiektu CZYTA. Żywe są więc tylko nazwy
// przeczytane: `m.x` / `m["x"]`, `const { x } = await import(...)`,
// `.then((m) => m.x)` / `.then(({ x }) => ...)`, element `Promise.all([...])`
// rozłożony do wiązania, `lazy(() => import(...))` (`default`). Samo
// załadowanie (`void import(...)`) nie czyta nic. Każde inne użycie obiektu
// (oddany jako wartość, zwrócony z funkcji, rozkład `...rest`, nazwa
// przesłonięta) to UCIECZKA: nazw nie znamy, więc moduł nie zgaduje - miejsce
// musi być na liście przejrzanej `ZOD_NAMESPACE_ESCAPES_REVIEWED` (wtedy
// wszystkie eksportowane schematy celu żyją), inaczej test czerwieni.

interface NamespaceUse {
  /** Nazwy czytane z przestrzeni, z węzłem odczytu (rodzaj użycia z pozycji). */
  readonly reads: Array<{ readonly name: string; readonly node: ts.Node }>;
  /** Miejsca ucieczki (`linia: tekst`). */
  readonly escapes: string[];
}

/** Wyrażenie razem z nawiasami, `as`, `!`, `satisfies` nad nim. */
function outermost(node: ts.Expression): ts.Expression {
  let current = node;
  for (;;) {
    const parent = current.parent;
    if (
      (ts.isParenthesizedExpression(parent) ||
        ts.isAsExpression(parent) ||
        ts.isSatisfiesExpression(parent) ||
        ts.isNonNullExpression(parent) ||
        ts.isTypeAssertionExpression(parent)) &&
      parent.expression === current
    ) {
      current = parent;
      continue;
    }
    return current;
  }
}

function escapeAt(node: ts.Node, use: NamespaceUse): void {
  const sf = node.getSourceFile();
  const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  use.escapes.push(`${line}: ${node.getText(sf).replace(/\s+/g, " ").slice(0, 70)}`);
}

/** Wiązania nazwy w poddrzewie (zmienna, parametr, rozkład, import, funkcja, klasa, enum). */
function countBindings(root: ts.Node, name: string): number {
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isBindingElement(node) ||
        ts.isImportClause(node) ||
        ts.isNamespaceImport(node) ||
        ts.isImportSpecifier(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isClassDeclaration(node) ||
        ts.isClassExpression(node) ||
        ts.isEnumDeclaration(node)) &&
      node.name !== undefined &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return count;
}

/** Czy w poddrzewie coś przypisuje do nazwy (`=`, `+=`, `++`, rozkład, `for (x of ...)`). */
function isWritten(root: ts.Node, name: string): boolean {
  const targets = (target: ts.Expression): boolean => {
    const node = unwrap(target);
    if (ts.isIdentifier(node)) return node.text === name;
    if (ts.isArrayLiteralExpression(node) || ts.isObjectLiteralExpression(node)) {
      let found = false;
      const visit = (child: ts.Node): void => {
        if (ts.isIdentifier(child) && child.text === name) found = true;
        else ts.forEachChild(child, visit);
      };
      visit(node);
      return found;
    }
    return false;
  };
  let written = false;
  const visit = (node: ts.Node): void => {
    if (written) return;
    if (
      (ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
        targets(node.left)) ||
      ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken ||
          node.operator === ts.SyntaxKind.MinusMinusToken) &&
        targets(node.operand)) ||
      ((ts.isForOfStatement(node) || ts.isForInStatement(node)) &&
        !ts.isVariableDeclarationList(node.initializer) &&
        targets(node.initializer))
    ) {
      written = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return written;
}

/** Klucz właściwości w rozkładzie (`{ a }`, `{ a: b }`, `{ "a": b }`); `null` - wyliczany. */
function propertyKey(name: ts.PropertyName): string | null {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : null;
}

/** Wartość `expr` to obiekt przestrzeni nazw modułu - co z niego czytamy. */
function readsOfNamespaceValue(expr: ts.Expression, use: NamespaceUse): void {
  const outer = outermost(expr);
  const parent = outer.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === outer) {
    use.reads.push({ name: parent.name.text, node: parent });
  } else if (
    ts.isElementAccessExpression(parent) &&
    parent.expression === outer &&
    ts.isStringLiteralLike(parent.argumentExpression)
  ) {
    use.reads.push({ name: parent.argumentExpression.text, node: parent });
  } else if (
    ts.isVariableDeclaration(parent) &&
    parent.initializer === outer &&
    !(ts.isVariableStatement(parent.parent.parent) && hasExport(parent.parent.parent))
  ) {
    readsOfBinding(parent.name, use);
  } else if (ts.isAwaitExpression(parent)) {
    readsOfNamespaceValue(parent, use);
  } else {
    escapeAt(outer, use);
  }
}

/** Wiązanie, do którego trafia obiekt przestrzeni nazw (nazwa albo rozkład obiektu). */
function readsOfBinding(name: ts.BindingName, use: NamespaceUse): void {
  if (ts.isIdentifier(name)) {
    readsOfIdentifier(name, use);
  } else if (ts.isObjectBindingPattern(name)) {
    for (const el of name.elements) {
      const key =
        el.dotDotDotToken !== undefined
          ? null
          : el.propertyName !== undefined
            ? propertyKey(el.propertyName)
            : ts.isIdentifier(el.name)
              ? el.name.text
              : null;
      if (key === null) escapeAt(el, use);
      else use.reads.push({ name: key, node: el });
    }
  } else {
    escapeAt(name, use);
  }
}

/** Najbliższa funkcja albo plik nad węzłem. */
function functionScope(node: ts.Node): ts.Node {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionLike(current) || ts.isSourceFile(current)) return current;
  }
  return node.getSourceFile();
}

/**
 * Zasięg LEKSYKALNY wiązania `id` - węzeł, w którym nazwa oznacza to wiązanie:
 * blok `let`/`const` (także pętla `for` i klauzula `catch`), funkcja dla
 * parametru i `var`, plik dla importu. Odczyty liczymy wyłącznie w nim.
 *
 * Dawniej zasięgiem była zawsze najbliższa funkcja: przy
 * `if (a) { const m = await import("./a"); m.x(); } return m.T;` - gdzie
 * zewnętrzne `m` jest wiązane POZA funkcją (import, parametr funkcji
 * zewnętrznej) - funkcja miała jedno wiązanie `m`, więc `m.T` spoza bloku
 * uchodził za odczyt `./a` i schemat `T` był fałszywie żywy.
 */
function bindingScope(id: ts.Identifier): ts.Node {
  let decl: ts.Node = id.parent;
  while (
    ts.isBindingElement(decl) ||
    ts.isObjectBindingPattern(decl) ||
    ts.isArrayBindingPattern(decl)
  ) {
    decl = decl.parent;
  }
  if (ts.isParameter(decl)) return decl.parent;
  if (ts.isCatchClause(decl.parent) && decl.parent.variableDeclaration === decl) {
    return decl.parent;
  }
  if (ts.isVariableDeclaration(decl) && ts.isVariableDeclarationList(decl.parent)) {
    const list = decl.parent;
    if (!(list.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const))) return functionScope(list);
    const owner = list.parent;
    // `for (const m of ...)` - pętla; `const m = ...;` - blok, plik albo `case`.
    if (ts.isForStatement(owner) || ts.isForOfStatement(owner) || ts.isForInStatement(owner)) {
      return owner;
    }
    for (let current: ts.Node = owner.parent; current; current = current.parent) {
      if (
        ts.isBlock(current) ||
        ts.isSourceFile(current) ||
        ts.isCaseBlock(current) ||
        ts.isModuleBlock(current) ||
        ts.isFunctionLike(current)
      ) {
        return current;
      }
    }
  }
  return functionScope(id);
}

/** Odczyty przez nazwę `id` (parametr, stała, import przestrzeni) w zasięgu jej wiązania. */
function readsOfIdentifier(id: ts.Identifier, use: NamespaceUse): void {
  const scope = bindingScope(id);
  // Nazwa przesłonięta albo przypisywana: nie wiadomo, który obiekt czyta odczyt.
  if (countBindings(scope, id.text) !== 1 || isWritten(scope, id.text)) {
    escapeAt(id, use);
    return;
  }
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node !== id && node.text === id.text) {
      if (ts.isExportSpecifier(node.parent)) {
        escapeAt(node.parent, use);
      } else if (isReference(node, id.text)) {
        if (!inTypePosition(node)) readsOfNamespaceValue(node, use);
        else if (ts.isQualifiedName(node.parent) && node.parent.left === node) {
          // `typeof ns.X` w typie - odczyt typu X (sam `typeof ns` nie czyta nazwy).
          use.reads.push({ name: node.parent.right.text, node: node.parent });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
}

/** Pierwszy argument `.then(cb)`: parametr `cb` to obiekt przestrzeni nazw. */
function readsOfCallback(cb: ts.Expression | undefined, at: ts.Node, use: NamespaceUse): void {
  const fn = cb === undefined ? undefined : unwrap(cb);
  if (fn === undefined || !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
    escapeAt(at, use);
    return;
  }
  const param = fn.parameters[0];
  if (param === undefined) return; // przestrzeń nieczytana
  if (param.dotDotDotToken !== undefined) escapeAt(param, use);
  else readsOfBinding(param.name, use);
}

function isPromiseCombinator(expr: ts.Expression, names: readonly string[]): boolean {
  const callee = unwrap(expr);
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "Promise" &&
    names.includes(callee.name.text)
  );
}

/** `import()` jako element `Promise.all([...])`: wiązanie elementu w rozkładzie wyniku. */
function readsOfPromiseAllElement(
  list: ts.ArrayLiteralExpression,
  element: ts.Expression,
  use: NamespaceUse,
): void {
  const index = list.elements.indexOf(element);
  const listOuter = outermost(list);
  const call = listOuter.parent;
  if (
    !ts.isCallExpression(call) ||
    call.arguments[0] !== listOuter ||
    !isPromiseCombinator(call.expression, ["all", "allSettled"])
  ) {
    escapeAt(element, use);
    return;
  }
  const callOuter = outermost(call);
  const parent = callOuter.parent;
  if (ts.isExpressionStatement(parent) || ts.isVoidExpression(parent)) return; // samo ładowanie
  let pattern: ts.BindingName | undefined;
  if (isPromiseCombinator(call.expression, ["all"])) {
    if (ts.isAwaitExpression(parent)) {
      const awaited = outermost(parent);
      const decl = awaited.parent;
      if (ts.isVariableDeclaration(decl) && decl.initializer === awaited) pattern = decl.name;
    } else if (
      ts.isPropertyAccessExpression(parent) &&
      parent.name.text === "then" &&
      ts.isCallExpression(parent.parent) &&
      parent.parent.expression === parent
    ) {
      const cb =
        parent.parent.arguments[0] === undefined ? null : unwrap(parent.parent.arguments[0]);
      if (cb !== null && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) {
        const first = cb.parameters[0];
        if (first === undefined) return;
        if (first.dotDotDotToken === undefined) pattern = first.name;
      }
    }
  }
  if (pattern === undefined || !ts.isArrayBindingPattern(pattern)) {
    escapeAt(element, use);
    return;
  }
  const rest = pattern.elements.findIndex((el) => ts.isBindingElement(el) && el.dotDotDotToken);
  if (rest !== -1 && rest <= index) {
    escapeAt(pattern, use);
    return;
  }
  const el = pattern.elements[index];
  if (el === undefined || ts.isOmittedExpression(el)) return; // element nieczytany
  readsOfBinding(el.name, use);
}

/** `lazy(() => import(...))` z Reacta - czyta `default`. */
function isReactLazyArrow(arrow: ts.ArrowFunction, imports: ParsedFile["imports"]): boolean {
  const outer = outermost(arrow);
  const call = outer.parent;
  if (!ts.isCallExpression(call) || call.arguments[0] !== outer) return false;
  const callee = unwrap(call.expression);
  if (ts.isIdentifier(callee)) {
    const imp = imports.get(callee.text);
    return imp !== undefined && imp.spec === "react" && imp.imported === "lazy";
  }
  if (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === "lazy" &&
    ts.isIdentifier(callee.expression)
  ) {
    const imp = imports.get(callee.expression.text);
    return (
      imp !== undefined &&
      imp.spec === "react" &&
      (imp.imported === "default" || imp.imported === "*")
    );
  }
  return false;
}

/** Co z modułu czyta wywołanie `import(...)`. */
function readsOfImportCall(call: ts.CallExpression, imports: ParsedFile["imports"]): NamespaceUse {
  const use: NamespaceUse = { reads: [], escapes: [] };
  const outer = outermost(call);
  const parent = outer.parent;
  if (ts.isAwaitExpression(parent)) {
    readsOfNamespaceValue(parent, use);
  } else if (ts.isExpressionStatement(parent) || ts.isVoidExpression(parent)) {
    // samo załadowanie (rozgrzewka chunku) - nic nie czyta
  } else if (
    ts.isPropertyAccessExpression(parent) &&
    parent.expression === outer &&
    parent.name.text === "then" &&
    ts.isCallExpression(parent.parent) &&
    parent.parent.expression === parent
  ) {
    readsOfCallback(parent.parent.arguments[0], parent.parent, use);
  } else if (ts.isArrayLiteralExpression(parent)) {
    readsOfPromiseAllElement(parent, outer, use);
  } else if (
    ts.isArrowFunction(parent) &&
    parent.body === outer &&
    isReactLazyArrow(parent, imports)
  ) {
    use.reads.push({ name: "default", node: outer });
  } else {
    escapeAt(outer, use);
  }
  return use;
}

/** Odczyty przez wiązanie importu przestrzeni nazw (`import * as ns`, `import { ns }` z `export * as ns`). */
function readsOfImportBinding(binding: ImportBinding): NamespaceUse {
  const use: NamespaceUse = { reads: [], escapes: [] };
  readsOfIdentifier(binding.node, use);
  return use;
}

/** Pochodzenie eksportu: deklaracja w module albo cała przestrzeń nazw modułu. */
type ExportOrigin =
  | { readonly file: string; readonly local: string }
  | { readonly file: string; readonly namespace: true };

/** Nazwa `name` eksportowana przez `file` - przez `export {…} from`, `export *` i import-eksport. */
function resolveExport(
  parsed: ReadonlyMap<string, ParsedFile>,
  file: string,
  name: string,
  seen: Set<string> = new Set(),
): ExportOrigin[] {
  const key = `${file}:${name}`;
  if (seen.has(key)) return [];
  seen.add(key);
  const p = parsed.get(file);
  if (p === undefined) return [];
  const local = p.localExports.get(name);
  if (local !== undefined) {
    const imp = p.imports.get(local);
    if (imp === undefined || imp.typeOnly) return [{ file, local }];
    if (imp.target === null) return [];
    return imp.imported === "*"
      ? [{ file: imp.target, namespace: true }]
      : resolveExport(parsed, imp.target, imp.imported, seen);
  }
  const re = p.namedReexports.get(name);
  if (re !== undefined) {
    if (re.target === null) return [];
    return re.imported === "*"
      ? [{ file: re.target, namespace: true }]
      : resolveExport(parsed, re.target, re.imported, seen);
  }
  if (name === "default") return []; // `export *` nie przenosi `default`
  return p.starReexports.flatMap((target) => resolveExport(parsed, target, name, seen));
}

/** Wszystkie nazwy eksportowane przez moduł (z reeksportami). */
function exportNamesOf(
  parsed: ReadonlyMap<string, ParsedFile>,
  file: string,
  seen: Set<string> = new Set(),
): Set<string> {
  const names = new Set<string>();
  const p = parsed.get(file);
  if (p === undefined || seen.has(file)) return names;
  seen.add(file);
  for (const name of p.localExports.keys()) names.add(name);
  for (const name of p.namedReexports.keys()) names.add(name);
  for (const target of p.starReexports) {
    for (const name of exportNamesOf(parsed, target, seen)) if (name !== "default") names.add(name);
  }
  return names;
}

/** Ucieczka przestrzeni nazw modułu z eksportowanymi schematami. */
export interface ZodNamespaceEscape {
  /** `importer -> moduł` - klucz listy przejrzanej. */
  readonly key: string;
  /** Miejsca ucieczki w imporcie (`linia: tekst`). */
  readonly sites: readonly string[];
  /** Eksportowane schematy, które przestrzeń może czytać (`plik:nazwa`). */
  readonly schemas: readonly string[];
  /** Na liście przejrzanej - schematy liczą się wtedy jako żywe. */
  readonly reviewed: boolean;
}

/**
 * Ucieczki przestrzeni nazw modułu ZE schematami eksportowanymi, przejrzane
 * (`importer -> moduł`, z powodem). Dopisz tylko wtedy, gdy obiektu nie da
 * się czytać po nazwie (`m.x`, `const { x } = await import(...)`) - wtedy
 * wszystkie eksportowane schematy modułu liczą się jako żywe. Lista może
 * TYLKO maleć; test pilnuje obu kierunków.
 */
export const ZOD_NAMESPACE_ESCAPES_REVIEWED: Readonly<Record<string, string>> = {};

interface Analysis {
  readonly parsed: ReadonlyMap<string, ParsedFile>;
  readonly reachable: ReadonlySet<string>;
}

/** Jedno parsowanie wszystkich plików i moduły osiągalne z `roots` (bez `*.server.*`). */
function analyze(sources: readonly ZodSourceFile[], roots: readonly string[]): Analysis {
  const known = new Set(sources.map((s) => s.file));
  const parsed = new Map<string, ParsedFile>();
  for (const s of sources) parsed.set(s.file, parse(s.file, s.code, known));
  const reachable = new Set<string>();
  const stack = roots.filter((r) => parsed.has(r));
  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (reachable.has(file) || SERVER_FILE.test(file)) continue;
    reachable.add(file);
    for (const to of (parsed.get(file) as ParsedFile).valueDeps) stack.push(to);
  }
  return { parsed, reachable };
}

/** Schematy zod bez żywego odczytu w kliencie, nieowinięte w `@__PURE__`. */
export function findZodClientOrphans(
  sources: readonly ZodSourceFile[],
  roots: readonly string[] = CLIENT_ROOTS,
  reviewedEscapes: Readonly<Record<string, string>> = ZOD_NAMESPACE_ESCAPES_REVIEWED,
): ZodClientOrphan[] {
  return zodClientReport(sources, roots, reviewedEscapes).orphans;
}

export interface ZodClientReport {
  readonly reachable: ReadonlySet<string>;
  readonly orphans: ZodClientOrphan[];
  /** Ucieczki przestrzeni nazw modułów z eksportowanymi schematami (posortowane po kluczu). */
  readonly escapes: ZodNamespaceEscape[];
}

/** Sieroty, ucieczki i moduły osiągalne z wejścia klienta - z jednego parsowania. */
export function zodClientReport(
  sources: readonly ZodSourceFile[],
  roots: readonly string[] = CLIENT_ROOTS,
  reviewedEscapes: Readonly<Record<string, string>> = ZOD_NAMESPACE_ESCAPES_REVIEWED,
): ZodClientReport {
  const analysis = analyze(sources, roots);
  return { reachable: analysis.reachable, ...orphansOf(analysis, reviewedEscapes) };
}

function orphansOf(
  analysis: Analysis,
  reviewedEscapes: Readonly<Record<string, string>>,
): { orphans: ZodClientOrphan[]; escapes: ZodNamespaceEscape[] } {
  const parsed = new Map([...analysis.parsed].filter(([file]) => analysis.reachable.has(file)));

  // Schematy: łańcuch od importu `zod` albo od innego schematu (punkt stały -
  // `Base.extend(...)` także przez import z innego pliku).
  const schemas = new Map<string, SchemaDecl>(); // `plik:nazwa`
  const byInit = new Map<string, Map<ts.Expression, SchemaDecl>>();
  for (let changed = true; changed;) {
    changed = false;
    for (const p of parsed.values()) {
      for (const stmt of p.sf.statements) {
        if (!ts.isVariableStatement(stmt) || !(stmt.declarationList.flags & ts.NodeFlags.Const)) {
          continue;
        }
        for (const decl of stmt.declarationList.declarations) {
          if (!ts.isIdentifier(decl.name) || decl.initializer === undefined) continue;
          const key = `${p.file}:${decl.name.text}`;
          if (schemas.has(key)) continue;
          // Owinięty schemat też wchodzi do zbioru (trzyma schematy ze swojego
          // ciała), ale sierotą nie bywa - bundler usuwa go w całości.
          const pure = isPureIife(decl.initializer, p.sf);
          const chain = pure ? pureIifeBody(decl.initializer) : decl.initializer;
          if (chain === null) continue;
          const node = unwrap(chain);
          if (!ts.isCallExpression(node)) continue;
          const root = chainRoot(node);
          if (root === null) continue;
          const imported = p.imports.get(root.text);
          const isZod =
            imported !== undefined &&
            !imported.typeOnly &&
            (imported.spec === "zod" || imported.spec.startsWith("zod/"));
          const isLocalSchema = schemas.has(`${p.file}:${root.text}`);
          const isImportedSchema =
            imported !== undefined &&
            imported.target !== null &&
            schemas.has(`${imported.target}:${imported.imported}`);
          if (!isZod && !isLocalSchema && !isImportedSchema) continue;
          const schema: SchemaDecl = {
            file: p.file,
            name: decl.name.text,
            init: decl.initializer,
            pure,
            exported: p.exportedNames.has(decl.name.text),
          };
          schemas.set(key, schema);
          const map = byInit.get(p.file) ?? new Map<ts.Expression, SchemaDecl>();
          map.set(decl.initializer, schema);
          byInit.set(p.file, map);
          changed = true;
        }
      }
    }
  }

  // Odczyty: w pliku schematu, w osiągalnych plikach importujących go po
  // nazwie (także przez `export {…} from` i `export *` - do deklaracji) oraz
  // nazwy czytane z przestrzeni nazw (`import()`, `import * as ns`).
  const importersOf = new Map<
    string,
    Array<{ parsed: ParsedFile; local: string; imported: string }>
  >();
  const namespaceUses = new Map<string, Use[]>(); // `plik:nazwa` schematu
  const escapeSites = new Map<string, { target: string; sites: string[] }>(); // `importer -> cel`
  const noteEscape = (importer: string, target: string, sites: readonly string[]): void => {
    if (sites.length === 0) return;
    const key = `${importer} -> ${target}`;
    const entry = escapeSites.get(key) ?? { target, sites: [] };
    entry.sites.push(...sites);
    escapeSites.set(key, entry);
  };
  const readNamespace = (p: ParsedFile, target: string, use: NamespaceUse): void => {
    noteEscape(p.file, target, use.escapes);
    for (const read of use.reads) {
      for (const origin of resolveExport(analysis.parsed, target, read.name)) {
        if ("namespace" in origin) {
          // `m.ns` z `export * as ns` - przestrzeń w przestrzeni, dalej nie śledzimy.
          const nested: NamespaceUse = { reads: [], escapes: [] };
          escapeAt(read.node, nested);
          noteEscape(p.file, origin.file, nested.escapes);
          continue;
        }
        const key = `${origin.file}:${origin.local}`;
        if (!schemas.has(key)) continue;
        const list = namespaceUses.get(key) ?? [];
        list.push(classifyReadAt(read.node, byInit.get(p.file) ?? new Map()));
        namespaceUses.set(key, list);
      }
    }
  };
  for (const p of parsed.values()) {
    for (const [local, imp] of p.imports) {
      if (imp.target === null || imp.typeOnly) continue;
      if (imp.imported === "*") {
        readNamespace(p, imp.target, readsOfImportBinding(imp));
        continue;
      }
      for (const origin of resolveExport(analysis.parsed, imp.target, imp.imported)) {
        if ("namespace" in origin) {
          readNamespace(p, origin.file, readsOfImportBinding(imp));
          continue;
        }
        const list = importersOf.get(origin.file) ?? [];
        list.push({ parsed: p, local, imported: origin.local });
        importersOf.set(origin.file, list);
      }
    }
    for (const { target, call } of p.dynamicImports) {
      readNamespace(p, target, readsOfImportCall(call, p.imports));
    }
  }

  // Ucieczki: liczą się tylko te, przez które przestrzeń mogłaby czytać
  // eksportowany schemat. Przejrzana - schematy żyją; nieprzejrzana - nie
  // daje odczytu, a test stanu repozytorium ją pokazuje (fail closed).
  const escapedSchemas = (target: string, seen: Set<string>): string[] => {
    if (seen.has(target)) return [];
    seen.add(target);
    const out: string[] = [];
    for (const name of exportNamesOf(analysis.parsed, target)) {
      for (const origin of resolveExport(analysis.parsed, target, name)) {
        if ("namespace" in origin) out.push(...escapedSchemas(origin.file, seen));
        else if (schemas.has(`${origin.file}:${origin.local}`)) {
          out.push(`${origin.file}:${origin.local}`);
        }
      }
    }
    return out;
  };
  const escapes: ZodNamespaceEscape[] = [];
  const liveByEscape = new Set<string>();
  for (const [key, { target, sites }] of [...escapeSites].sort(([a], [b]) => a.localeCompare(b))) {
    const affected = [...new Set(escapedSchemas(target, new Set()))].sort();
    if (affected.length === 0) continue;
    const reviewed = Object.hasOwn(reviewedEscapes, key);
    if (reviewed) for (const schema of affected) liveByEscape.add(schema);
    escapes.push({ key, sites: [...new Set(sites)], schemas: affected, reviewed });
  }

  const indexes = new Map<string, IdentifierIndex>();
  const indexOf = (p: ParsedFile): IdentifierIndex => {
    let index = indexes.get(p.file);
    if (index === undefined) {
      index = indexIdentifiers(p, byInit.get(p.file) ?? new Map());
      indexes.set(p.file, index);
    }
    return index;
  };
  const usesOf = new Map<string, Use[]>();
  for (const [key, schema] of schemas) {
    const own = parsed.get(schema.file) as ParsedFile;
    const uses = usesIn(indexOf(own), schema.name);
    for (const imp of importersOf.get(schema.file) ?? []) {
      if (imp.imported !== schema.name) continue;
      uses.push(...usesIn(indexOf(imp.parsed), imp.local));
    }
    uses.push(...(namespaceUses.get(key) ?? []));
    usesOf.set(key, uses);
  }

  // Punkt stały: żywy odczyt poza schematami albo w inicjalizatorze żywego schematu.
  const live = new Set<string>(liveByEscape);
  for (let changed = true; changed;) {
    changed = false;
    for (const [key, uses] of usesOf) {
      if (live.has(key)) continue;
      const isLive = uses.some(
        (u) =>
          u.kind === "value" &&
          (u.inside === null || live.has(`${u.inside.file}:${u.inside.name}`)),
      );
      if (isLive) {
        live.add(key);
        changed = true;
      }
    }
  }

  // Kompilator Start (Babel) po zdjęciu części serwerowych usuwa deklaracje,
  // które PRZED zdjęciem miały odczyt, a po nim nie mają żadnego - ani
  // wartości, ani `typeof` w typie (Babel liczy go jako odczyt; typy
  // eksportowane zdejmuje wcześniej `stripTypeExports`) - i nie są eksportem.
  // Taki schemat nie trafia do klienta wcale, więc nie jest sierotą.
  // Punkt stały: usunięty schemat nie trzyma schematów ze swojego inicjalizatora.
  // Jak `findRemovableBindings` z `babel-dead-code-elimination`: kandydat
  // zostaje, gdy trzyma go odczyt spoza kandydatów albo z kandydata, który
  // został; samoodwołanie (`z.lazy(() => X)`) i cykl między kandydatami nie
  // trzymają.
  const candidates = new Set<string>();
  for (const [key, schema] of schemas) {
    if (schema.exported || !(parsed.get(schema.file) as ParsedFile).startCompiled) continue;
    if ((usesOf.get(key) ?? []).length === 0) continue; // bez odczytu przed zdjęciem - Babel go nie rusza
    candidates.add(key);
  }
  const keptByStart = new Set<string>();
  for (let changed = true; changed;) {
    changed = false;
    for (const key of candidates) {
      if (keptByStart.has(key)) continue;
      const held = (usesOf.get(key) ?? []).some((u) => {
        if (u.kind === "server" || u.inExportedType) return false;
        if (u.inside === null) return true;
        const container = `${u.inside.file}:${u.inside.name}`;
        return !candidates.has(container) || keptByStart.has(container);
      });
      if (held) {
        keptByStart.add(key);
        changed = true;
      }
    }
  }
  const removedByStart = new Set([...candidates].filter((key) => !keptByStart.has(key)));

  const orphans: ZodClientOrphan[] = [];
  for (const [key, schema] of schemas) {
    if (schema.pure || live.has(key) || removedByStart.has(key)) continue;
    const uses = usesOf.get(key) ?? [];
    const reason: ZodOrphanReason = uses.some((u) => u.kind === "value")
      ? "w-sierocie"
      : uses.some((u) => u.kind === "type")
        ? "tylko-typy"
        : uses.some((u) => u.kind === "server")
          ? "tylko-serwer"
          : "brak-odczytu";
    orphans.push({ file: schema.file, name: schema.name, reason });
  }
  orphans.sort((a, b) =>
    a.file === b.file ? a.name.localeCompare(b.name) : a.file.localeCompare(b.file),
  );
  return { orphans, escapes };
}
