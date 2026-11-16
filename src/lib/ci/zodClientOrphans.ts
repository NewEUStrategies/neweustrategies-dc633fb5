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
//      Reeksport (`export { X } from`, `export *`), import przestrzeni nazw
//      i `import()` modułu liczą się jako odczyt żywy - dalej moduł nie śledzi,
//      więc może przeoczyć, ale nie zgłosi fałszywie;
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
// w pamięci daje 24 z 29 owiniętych stałych jako sieroty (pięć pozostałych:
// stała spoza zod, reeksport, odczyt w funkcji, schemat trasy kopiowany przez
// podział kodu - poza modelem, niżej).
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

interface ParsedFile {
  readonly file: string;
  readonly sf: ts.SourceFile;
  /** Nazwa lokalna -> [moduł repo albo pakiet, nazwa w module, import tylko typu]. */
  readonly imports: Map<
    string,
    {
      readonly target: string | null;
      readonly spec: string;
      readonly imported: string;
      readonly typeOnly: boolean;
    }
  >;
  /** Reeksporty nazwane (`export { X } from "./m"`) i `export *` - moduły docelowe. */
  readonly reexportsFrom: Set<string>;
  /** Plik przechodzi przez kompilator Start (importuje jego fabrykę). */
  readonly startCompiled: boolean;
  /** Pliki repo importowane jako wartość: `import`, `export … from`, `import()`. */
  readonly valueDeps: readonly string[];
  /** Pliki repo ładowane przez `import()` - ich eksportów dalej nie śledzimy. */
  readonly dynamicDeps: readonly string[];
  /** Nazwy eksportowane lokalnie: modyfikator `export`, `export { X }`, `export default X`. */
  readonly exportedNames: ReadonlySet<string>;
}

function parse(file: string, code: string, known: ReadonlySet<string>): ParsedFile {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, kind);
  const imports: ParsedFile["imports"] = new Map();
  const reexportsFrom = new Set<string>();
  const valueDeps: string[] = [];
  const dynamicDeps: string[] = [];
  const exportedNames = new Set<string>();
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
        });
      }
      const named = clause.namedBindings;
      if (named && ts.isNamespaceImport(named)) {
        imports.set(named.name.text, { target, spec, imported: "*", typeOnly: clause.isTypeOnly });
      } else if (named && ts.isNamedImports(named)) {
        for (const el of named.elements) {
          imports.set(el.name.text, {
            target,
            spec,
            imported: (el.propertyName ?? el.name).text,
            typeOnly: clause.isTypeOnly || el.isTypeOnly,
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
      if (target !== null) {
        reexportsFrom.add(target);
        valueDeps.push(target);
      }
    } else if (
      ts.isExportDeclaration(stmt) &&
      stmt.moduleSpecifier === undefined &&
      stmt.exportClause !== undefined &&
      ts.isNamedExports(stmt.exportClause) &&
      !stmt.isTypeOnly
    ) {
      for (const el of stmt.exportClause.elements) {
        if (!el.isTypeOnly) exportedNames.add((el.propertyName ?? el.name).text);
      }
    } else if (ts.isExportAssignment(stmt) && ts.isIdentifier(stmt.expression)) {
      exportedNames.add(stmt.expression.text);
    } else if (ts.isVariableStatement(stmt) && hasExport(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) exportedNames.add(decl.name.text);
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
          dynamicDeps.push(target);
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
    reexportsFrom,
    startCompiled,
    valueDeps,
    dynamicDeps,
    exportedNames,
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
): ZodClientOrphan[] {
  return zodClientReport(sources, roots).orphans;
}

/** Sieroty i moduły osiągalne z wejścia klienta - z jednego parsowania. */
export function zodClientReport(
  sources: readonly ZodSourceFile[],
  roots: readonly string[] = CLIENT_ROOTS,
): { readonly reachable: ReadonlySet<string>; readonly orphans: ZodClientOrphan[] } {
  const analysis = analyze(sources, roots);
  return { reachable: analysis.reachable, orphans: orphansOf(analysis) };
}

function orphansOf(analysis: Analysis): ZodClientOrphan[] {
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

  // Odczyty: w pliku schematu i w osiągalnych plikach importujących go wprost.
  const importersOf = new Map<
    string,
    Array<{ parsed: ParsedFile; local: string; imported: string }>
  >();
  // Pliki, z których ktoś reeksportuje albo które ktoś ładuje przez `import()`.
  const reexported = new Set<string>();
  for (const p of parsed.values()) {
    for (const target of p.dynamicDeps) reexported.add(target);
    for (const [local, imp] of p.imports) {
      if (imp.target === null || imp.typeOnly) continue;
      const list = importersOf.get(imp.target) ?? [];
      list.push({ parsed: p, local, imported: imp.imported });
      importersOf.set(imp.target, list);
    }
    for (const target of p.reexportsFrom) reexported.add(target);
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
  const liveByReexport = new Set<string>();
  for (const [key, schema] of schemas) {
    const own = parsed.get(schema.file) as ParsedFile;
    const uses = usesIn(indexOf(own), schema.name);
    for (const imp of importersOf.get(schema.file) ?? []) {
      if (imp.imported === "*") {
        liveByReexport.add(key); // przestrzeń nazw: dalej nie śledzimy
        continue;
      }
      if (imp.imported !== schema.name) continue;
      uses.push(...usesIn(indexOf(imp.parsed), imp.local));
    }
    // `export { X } from` / `export *` z tego pliku albo `import()` tego pliku.
    if (schema.exported && reexported.has(schema.file)) liveByReexport.add(key);
    usesOf.set(key, uses);
  }

  // Punkt stały: żywy odczyt poza schematami albo w inicjalizatorze żywego schematu.
  const live = new Set<string>(liveByReexport);
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
  return orphans.sort((a, b) =>
    a.file === b.file ? a.name.localeCompare(b.name) : a.file.localeCompare(b.file),
  );
}
