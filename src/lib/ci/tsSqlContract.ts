// Kontrakt CI: KAŻDE ZAPYTANIE TYPESCRIPTU DO BAZY JEST SPRAWDZANE NA
// PRAWDZIWYM SCHEMACIE - nie na atrapie i nie na modelu z regexów.
//
// PRZYCZYNA ŹRÓDŁOWA (audyt ed13, październik 2026). Najpoważniejsze defekty
// ostatnich wydań leżały na szwie TypeScript <-> SQL, którego żadna warstwa
// nie widziała w całości:
//   * `onConflict: "user_id,role"` wobec klucza (tenant_id, user_id, role) -
//     42P10 przy KAŻDEJ wysyłce zaproszenia (N-19-1),
//   * akcja `club_updated`, której nie znał CHECK - zapis ustawień klubu
//     padał zawsze na 23514 (N-16-1),
//   * GRANT szerszy niż kod: `validate_b2b_coupon` i `redeem_b2b_coupon` dla
//     `authenticated`, `ad_slots.notes` dla `anon` (N-13-1, D-14-3),
//   * `company_id` brane wprost z ładunku `event_package_purchase`.
// Testy TS zastępują bazę atrapą, która przyjmuje każdy cel konfliktu, każdą
// wartość i każde uprawnienie; pgTAP widzi bazę, ale nie widzi wywołań z TS;
// bramka `check:rpc-contract` sprawdza tylko, czy funkcja istnieje. Stąd
// 98,84% pokrycia przy działającej regresji.
//
// JAK TEN MODUŁ ZAMYKA SZEW. Z kodu produkcyjnego `src/**` (drzewo składniowe
// kompilatora TypeScript, bez kompilacji) zbiera FAKTY SZWU:
//   1. `.rpc("fn", { klucze })` - nazwa, klucze argumentów, rola klienta,
//   2. `.from("t")` z łańcuchem `.select/.insert/.update/.upsert/.delete` -
//      tabela, kolumny, literały zapisywane do kolumn, cel `onConflict`,
//   3. rejestr kolumn publicznych (`PUBLIC_COLUMN_CONTRACTS`) - stałe TS, które
//      deklarują, co z tabeli wolno czytać frontowi,
// i renderuje z nich test pgTAP (`supabase/tests/ts_sql_contract_test.sql`),
// który job `pgtap` uruchamia na bazie po WSZYSTKICH migracjach. Sprawdzenie
// robi katalog Postgresa (`pg_proc`, `has_column_privilege`, `pg_index`,
// `pg_constraint`), a nie kolejny parser SQL - więc nie ma modelu, który
// mógłby się rozjechać z bazą.
//
// ROLA KLIENTA rozstrzygana jest konserwatywnie po odbiorcy wywołania:
//   * `supabaseAdmin` (także alias i `(await import(...)).supabaseAdmin`) -
//     `service_role`;
//   * `supabase` w pliku z klientem przeglądarki
//     (`@/integrations/supabase/client`) albo z `requireSupabaseAuth`, oraz
//     `context.supabase` / `ctx.supabase` - `authenticated`;
//   * wszystko inne (parametr pomocnika, atrapa) - `unknown`: sprawdzamy
//     istnienie i sygnaturę, ale nie uprawnienia.
// Fałszywy alarm byłby tu gorszy niż luka - bramka, która krzyczy na stan
// zgodny z bazą, zostaje wyłączona pierwszego dnia.
//
// Moduł jest CZYSTY (bez fs) - runner `scripts/generate-ts-sql-contract.ts`
// czyta pliki, a test jednostkowy (`__tests__/tsSqlContract.test.ts`) karmi go
// wycinkami kodu.
import ts from "typescript";

// ── Fakty szwu ──────────────────────────────────────────────────────────────

export type ClientRole = "service_role" | "authenticated" | "unknown";

export interface SourceFile {
  readonly file: string;
  readonly code: string;
}

export interface RpcSite {
  readonly name: string;
  /** Klucze obiektu argumentów (posortowane); `null` = nie do ustalenia statycznie. */
  readonly keys: readonly string[] | null;
  readonly role: ClientRole;
  readonly file: string;
}

export type TableOp = "select" | "insert" | "update" | "upsert" | "upsert_ignore" | "delete";

export interface TableSite {
  readonly table: string;
  readonly op: TableOp;
  /** Kolumny wskazane wprost (posortowane, bez duplikatów). */
  readonly columns: readonly string[];
  /** `select("*")`, `select()` i RETURNING bez listy - KAŻDA kolumna. */
  readonly star: boolean;
  readonly role: ClientRole;
  readonly file: string;
}

export interface LiteralWrite {
  readonly table: string;
  readonly column: string;
  readonly value: string;
  readonly file: string;
}

export interface ConflictTarget {
  readonly table: string;
  readonly columns: readonly string[];
  readonly file: string;
}

/**
 * Stała TS deklarująca kolumny tabeli czytelne dla frontu. Kontrakt: role
 * klienta mają SELECT DOKŁADNIE na tych kolumnach - ani mniej (front pada na
 * 42501), ani więcej (kolumna prywatna wycieka przez PostgREST wprost).
 */
export interface PublicColumnContract {
  readonly table: string;
  readonly file: string;
  readonly constant: string;
  readonly roles: readonly ("anon" | "authenticated")[];
}

export interface PublicColumnFact extends PublicColumnContract {
  /** `null` = stałej nie udało się odczytać (to też jest naruszenie). */
  readonly columns: readonly string[] | null;
}

export interface SeamFacts {
  readonly rpcs: readonly RpcSite[];
  readonly tables: readonly TableSite[];
  readonly literals: readonly LiteralWrite[];
  readonly conflicts: readonly ConflictTarget[];
  readonly publicColumns: readonly PublicColumnFact[];
  /** Statystyka zasięgu - ile wywołań bramka widzi, a ilu nie umie odczytać. */
  readonly coverage: {
    readonly files: number;
    readonly rpcCalls: number;
    readonly rpcCallsWithUnknownName: number;
    readonly tableChains: number;
    readonly tableChainsWithUnknownTable: number;
    /** Pliki z wywołaniem, którego nazwy/tabeli nie da się ustalić statycznie. */
    readonly unresolvedSites: readonly string[];
  };
}

/**
 * Rejestr kolumn publicznych. Wpis wiąże stałą TS z grantem kolumnowym
 * w bazie; dopisanie kolumny do stałej bez GRANT-u (albo odwrotnie) czerwieni
 * job `pgtap`.
 */
export const PUBLIC_COLUMN_CONTRACTS: readonly PublicColumnContract[] = [
  {
    table: "ad_slots",
    file: "src/lib/ads/types.ts",
    constant: "PUBLIC_AD_SLOT_COLUMNS",
    roles: ["anon", "authenticated"],
  },
];

// ── Rozwiązywanie napisów ───────────────────────────────────────────────────

/** Zasięgi wszystkich plików po ścieżce - do rozwiązania stałych z importów. */
type ExportIndex = ReadonlyMap<string, FileScope>;

interface FileScope {
  readonly file: string;
  readonly sf: ts.SourceFile;
  /** Stałe napisowe tego pliku (`const X = "..."`, także eksportowane). */
  readonly strings: Map<string, string>;
  /**
   * Stałe najwyższego poziomu z wyrażeniem napisowym do rozwiązania leniwie
   * (szablon albo `+` z innymi stałymi, np. lista `select` z kolumnami
   * publicznymi wklejonymi w zasób osadzony).
   */
  readonly stringExprs: Map<string, ts.Expression>;
  /** Stałe obiektowe tego pliku (`const X = { ... }`) - jeden skok. */
  readonly objects: Map<string, ts.ObjectLiteralExpression>;
  /** Import nazwy -> [moduł, nazwa w module]. */
  readonly imports: Map<string, readonly [string, string]>;
  /** Aliasy klienta roli serwisowej (`const { supabaseAdmin: admin } = ...`). */
  readonly adminAliases: Set<string>;
  readonly browserClient: boolean;
  readonly authMiddleware: boolean;
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  for (;;) {
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isAwaitExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    return current;
  }
}

function propName(name: ts.PropertyName): string | null {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNoSubstitutionTemplateLiteral(name)
  ) {
    return name.text;
  }
  return null;
}

/** Ścieżka modułu z importu -> plik repo (`@/x` -> `src/x`, ścieżki względne). */
function resolveModule(from: string, spec: string, known: ReadonlySet<string>): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = `src/${spec.slice(2)}`;
  else if (spec.startsWith(".")) {
    const dir = from.split("/").slice(0, -1);
    for (const part of spec.split("/")) {
      if (part === "." || part === "") continue;
      if (part === "..") dir.pop();
      else dir.push(part);
    }
    base = dir.join("/");
  } else return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]) {
    if (known.has(candidate)) return candidate;
  }
  return null;
}

function resolveString(
  expr: ts.Expression,
  scope: FileScope,
  exportsIndex: ExportIndex,
  known: ReadonlySet<string>,
  depth = 0,
): string | null {
  if (depth > 6) return null;
  const node = unwrap(expr);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let out = node.head.text;
    for (const span of node.templateSpans) {
      const part = resolveString(span.expression, scope, exportsIndex, known, depth + 1);
      if (part === null) return null;
      out += part + span.literal.text;
    }
    return out;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = resolveString(node.left, scope, exportsIndex, known, depth + 1);
    const right = resolveString(node.right, scope, exportsIndex, known, depth + 1);
    return left === null || right === null ? null : left + right;
  }
  if (ts.isIdentifier(node))
    return resolveConstant(node.text, scope, exportsIndex, known, depth + 1);
  return null;
}

/** Stała napisowa po nazwie: z tego pliku albo (przez import) z pliku źródłowego. */
function resolveConstant(
  name: string,
  scope: FileScope,
  scopes: ExportIndex,
  known: ReadonlySet<string>,
  depth: number,
): string | null {
  if (depth > 6) return null;
  const local = scope.strings.get(name);
  if (local !== undefined) return local;
  const expr = scope.stringExprs.get(name);
  if (expr !== undefined) return resolveString(expr, scope, scopes, known, depth + 1);
  const imported = scope.imports.get(name);
  if (imported === undefined) return null;
  const target = resolveModule(scope.file, imported[0], known);
  const targetScope = target === null ? undefined : scopes.get(target);
  return targetScope === undefined
    ? null
    : resolveConstant(imported[1], targetScope, scopes, known, depth + 1);
}

function buildScope(file: string, code: string): FileScope {
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const strings = new Map<string, string>();
  const stringExprs = new Map<string, ts.Expression>();
  const objects = new Map<string, ts.ObjectLiteralExpression>();
  const imports = new Map<string, readonly [string, string]>();
  const adminAliases = new Set<string>(["supabaseAdmin"]);

  // Pierwszy przebieg: importy i stałe najwyższego poziomu (bez rozwiązywania
  // importów - to robi drugi przebieg z indeksem eksportów).
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const spec = stmt.moduleSpecifier.text;
      const named = stmt.importClause?.namedBindings;
      if (named && ts.isNamedImports(named)) {
        for (const el of named.elements) {
          imports.set(el.name.text, [spec, (el.propertyName ?? el.name).text]);
        }
      }
    }
    if (ts.isVariableStatement(stmt) && stmt.declarationList.flags & ts.NodeFlags.Const) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        const init = unwrap(decl.initializer);
        if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) {
          strings.set(decl.name.text, init.text);
        } else if (
          ts.isTemplateExpression(init) ||
          (ts.isBinaryExpression(init) && init.operatorToken.kind === ts.SyntaxKind.PlusToken)
        ) {
          stringExprs.set(decl.name.text, init);
        } else if (ts.isObjectLiteralExpression(init)) {
          objects.set(decl.name.text, init);
        }
      }
    }
  }
  // Aliasy klienta roli serwisowej w całym pliku (także wewnątrz funkcji).
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const init = unwrap(node.initializer);
      if (ts.isObjectBindingPattern(node.name)) {
        for (const el of node.name.elements) {
          const source = el.propertyName
            ? propName(el.propertyName)
            : ts.isIdentifier(el.name)
              ? el.name.text
              : null;
          if (source === "supabaseAdmin" && ts.isIdentifier(el.name))
            adminAliases.add(el.name.text);
        }
      } else if (
        ts.isIdentifier(node.name) &&
        ts.isIdentifier(init) &&
        adminAliases.has(init.text)
      ) {
        adminAliases.add(node.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return {
    file,
    sf,
    strings,
    stringExprs,
    objects,
    imports,
    adminAliases,
    browserClient: /["']@\/integrations\/supabase\/client["']/.test(code),
    authMiddleware: code.includes("requireSupabaseAuth"),
  };
}

// ── Rola klienta ────────────────────────────────────────────────────────────

/** Rola klienta dla odbiorcy `.rpc` / `.from` (`supabase`, `context.supabase`, ...). */
export function receiverRole(
  receiver: ts.Expression,
  scope: Pick<FileScope, "adminAliases" | "browserClient" | "authMiddleware">,
): ClientRole {
  const node = unwrap(receiver);
  if (ts.isIdentifier(node)) {
    if (scope.adminAliases.has(node.text)) return "service_role";
    if (node.text === "supabase" && (scope.browserClient || scope.authMiddleware))
      return "authenticated";
    return "unknown";
  }
  if (ts.isPropertyAccessExpression(node)) {
    const name = node.name.text;
    if (name === "supabaseAdmin") return "service_role";
    const base = unwrap(node.expression);
    if (
      name === "supabase" &&
      ts.isIdentifier(base) &&
      (base.text === "context" || base.text === "ctx")
    ) {
      return "authenticated";
    }
  }
  return "unknown";
}

// ── Składnia `select` PostgREST ─────────────────────────────────────────────

const COLUMN_RE = /^[a-z_][a-z0-9_]*$/;

function splitTopLevel(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(current);
      current = "";
    } else current += ch;
  }
  out.push(current);
  return out.map((part) => part.trim()).filter((part) => part.length > 0);
}

/**
 * Kolumny najwyższego poziomu z listy `select` PostgREST. Zasoby osadzone
 * (`rel(...)`, `alias:rel!fk(...)`, `...rel(...)`) i agregaty są pomijane -
 * to inne relacje albo wyrażenia, nie kolumny tej tabeli.
 */
export function parseSelectColumns(select: string): { columns: string[]; star: boolean } {
  const columns = new Set<string>();
  let star = false;
  for (const raw of splitTopLevel(select)) {
    if (raw.includes("(") || raw.startsWith("...")) continue;
    let item = raw;
    const alias = item.indexOf(":");
    if (alias !== -1 && item[alias + 1] !== ":") item = item.slice(alias + 1);
    item = item.split("::")[0].split("->")[0].trim();
    if (item === "*") {
      star = true;
      continue;
    }
    if (COLUMN_RE.test(item)) columns.add(item);
  }
  return { columns: [...columns].sort(), star };
}

// ── Przebieg po wywołaniach ─────────────────────────────────────────────────

interface Collector {
  rpcs: RpcSite[];
  tables: TableSite[];
  literals: LiteralWrite[];
  conflicts: ConflictTarget[];
  rpcCalls: number;
  rpcCallsWithUnknownName: number;
  tableChains: number;
  tableChainsWithUnknownTable: number;
  unresolved: string[];
}

function callMethod(node: ts.CallExpression): { name: string; receiver: ts.Expression } | null {
  const callee = node.expression;
  if (ts.isPropertyAccessExpression(callee)) {
    return { name: callee.name.text, receiver: callee.expression };
  }
  return null;
}

/** Kolejne ogniwa łańcucha NAD wywołaniem (`.from(x).select().eq()...`). */
function chainAbove(call: ts.CallExpression): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  let current: ts.Node = call;
  for (;;) {
    const parent: ts.Node = current.parent;
    if (parent && ts.isPropertyAccessExpression(parent) && parent.expression === current) {
      const grand: ts.Node = parent.parent;
      if (grand && ts.isCallExpression(grand) && grand.expression === parent) {
        out.push(grand);
        current = grand;
        continue;
      }
    }
    return out;
  }
}

function objectArgument(
  arg: ts.Expression | undefined,
  scope: FileScope,
): ts.ObjectLiteralExpression[] | null {
  if (!arg) return null;
  const node = unwrap(arg);
  if (ts.isObjectLiteralExpression(node)) return [node];
  if (ts.isArrayLiteralExpression(node)) {
    const out: ts.ObjectLiteralExpression[] = [];
    for (const el of node.elements) {
      const inner = unwrap(el as ts.Expression);
      if (ts.isObjectLiteralExpression(inner)) out.push(inner);
      else return null;
    }
    return out;
  }
  if (ts.isIdentifier(node)) {
    const local = scope.objects.get(node.text);
    if (local) return [local];
  }
  return null;
}

interface ObjectShape {
  keys: string[];
  literals: Array<{ column: string; value: string }>;
}

function objectShape(
  objects: readonly ts.ObjectLiteralExpression[],
  scope: FileScope,
  exportsIndex: ExportIndex,
  known: ReadonlySet<string>,
): ObjectShape {
  const keys = new Set<string>();
  const literals: Array<{ column: string; value: string }> = [];
  for (const obj of objects) {
    for (const prop of obj.properties) {
      if (ts.isShorthandPropertyAssignment(prop)) {
        keys.add(prop.name.text);
        continue;
      }
      if (!ts.isPropertyAssignment(prop)) continue;
      const key = propName(prop.name);
      if (key === null) continue;
      keys.add(key);
      const init = unwrap(prop.initializer);
      // Tylko literał WPROST (także przez stałą tego pliku/importu) - wartość
      // obliczona w czasie działania nie jest faktem statycznym.
      if (
        ts.isStringLiteral(init) ||
        ts.isNoSubstitutionTemplateLiteral(init) ||
        (ts.isIdentifier(init) &&
          (scope.strings.has(init.text) ||
            scope.stringExprs.has(init.text) ||
            scope.imports.has(init.text)))
      ) {
        const value = resolveString(init, scope, exportsIndex, known);
        if (value !== null) literals.push({ column: key, value });
      }
    }
  }
  return { keys: [...keys].sort(), literals };
}

function visitFile(
  scope: FileScope,
  exportsIndex: ExportIndex,
  known: ReadonlySet<string>,
  out: Collector,
): void {
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const method = callMethod(node);
      if (method?.name === "rpc" && node.arguments.length >= 1) {
        handleRpc(node, method.receiver, scope, exportsIndex, known, out);
      } else if (method?.name === "from" && node.arguments.length === 1) {
        handleFrom(node, method.receiver, scope, exportsIndex, known, out);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(scope.sf);
}

function handleRpc(
  node: ts.CallExpression,
  receiver: ts.Expression,
  scope: FileScope,
  exportsIndex: ExportIndex,
  known: ReadonlySet<string>,
  out: Collector,
): void {
  out.rpcCalls += 1;
  const name = resolveString(node.arguments[0], scope, exportsIndex, known);
  if (name === null || !COLUMN_RE.test(name)) {
    out.rpcCallsWithUnknownName += 1;
    out.unresolved.push(`${scope.file}: .rpc(${node.arguments[0].getText(scope.sf).slice(0, 60)})`);
    return;
  }
  let keys: string[] | null = [];
  const arg = node.arguments[1];
  if (arg !== undefined) {
    const objects = objectArgument(arg, scope);
    const hasSpread = objects?.some((o) => o.properties.some((p) => ts.isSpreadAssignment(p)));
    keys =
      objects === null || hasSpread ? null : objectShape(objects, scope, exportsIndex, known).keys;
  }
  out.rpcs.push({ name, keys, role: receiverRole(receiver, scope), file: scope.file });
}

function handleFrom(
  node: ts.CallExpression,
  receiver: ts.Expression,
  scope: FileScope,
  exportsIndex: ExportIndex,
  known: ReadonlySet<string>,
  out: Collector,
): void {
  const recv = unwrap(receiver);
  // `supabase.storage.from("bucket")` to kubełek Storage, nie tabela;
  // `.schema("x").from()` - inny schemat niż public.
  if (ts.isPropertyAccessExpression(recv) && recv.name.text === "storage") return;
  if (ts.isCallExpression(recv)) {
    const inner = callMethod(recv);
    if (inner?.name === "schema") return;
  }
  const chain = chainAbove(node);
  const ops = chain.map((c) => callMethod(c)?.name ?? "");
  const QUERY = new Set(["select", "insert", "update", "upsert", "delete"]);
  if (!ops.some((op) => QUERY.has(op))) return; // `Array.from`, `Buffer.from`, ...
  out.tableChains += 1;
  const table = resolveString(node.arguments[0], scope, exportsIndex, known);
  if (table === null || !COLUMN_RE.test(table)) {
    out.tableChainsWithUnknownTable += 1;
    out.unresolved.push(
      `${scope.file}: .from(${node.arguments[0].getText(scope.sf).slice(0, 60)})`,
    );
    return;
  }
  const role = receiverRole(receiver, scope);
  const site = (op: TableOp, columns: readonly string[], star: boolean): void => {
    out.tables.push({ table, op, columns, star, role, file: scope.file });
  };

  for (let i = 0; i < chain.length; i += 1) {
    const call = chain[i];
    const op = ops[i];
    if (op === "select") {
      const arg = call.arguments[0];
      const opts = call.arguments[1] ? unwrap(call.arguments[1]) : null;
      // `head: true` - sama liczba wierszy, PostgREST nie zwraca kolumn.
      const head =
        opts !== null &&
        ts.isObjectLiteralExpression(opts) &&
        opts.properties.some(
          (p) =>
            ts.isPropertyAssignment(p) &&
            propName(p.name) === "head" &&
            p.initializer.kind === ts.SyntaxKind.TrueKeyword,
        );
      if (head) continue;
      if (arg === undefined) {
        site("select", [], true);
        continue;
      }
      const text = resolveString(arg, scope, exportsIndex, known);
      if (text === null) continue;
      const parsed = parseSelectColumns(text);
      if (parsed.star || parsed.columns.length > 0) site("select", parsed.columns, parsed.star);
    } else if (op === "insert" || op === "update" || op === "upsert") {
      const objects = objectArgument(call.arguments[0], scope);
      let kind: TableOp = op;
      let conflict: string | null = null;
      if (op === "upsert") {
        const opts = call.arguments[1] ? unwrap(call.arguments[1]) : null;
        if (opts && ts.isObjectLiteralExpression(opts)) {
          for (const p of opts.properties) {
            if (!ts.isPropertyAssignment(p)) continue;
            const key = propName(p.name);
            if (key === "ignoreDuplicates" && p.initializer.kind === ts.SyntaxKind.TrueKeyword) {
              kind = "upsert_ignore";
            }
            if (key === "onConflict")
              conflict = resolveString(p.initializer, scope, exportsIndex, known);
          }
        }
        if (conflict !== null) {
          const columns = conflict
            .split(",")
            .map((c) => c.trim())
            .filter((c) => c.length > 0);
          if (columns.every((c) => COLUMN_RE.test(c))) {
            out.conflicts.push({ table, columns: [...columns].sort(), file: scope.file });
          }
        }
      }
      if (objects === null) continue;
      const shape = objectShape(objects, scope, exportsIndex, known);
      site(kind, shape.keys, false);
      for (const lit of shape.literals) {
        out.literals.push({ table, column: lit.column, value: lit.value, file: scope.file });
      }
    } else if (op === "delete") {
      site("delete", [], false);
    }
  }
}

function readPublicColumns(
  contract: PublicColumnContract,
  scopes: ExportIndex,
  known: ReadonlySet<string>,
): PublicColumnFact {
  const scope = scopes.get(contract.file);
  const raw =
    scope === undefined ? null : resolveConstant(contract.constant, scope, scopes, known, 0);
  if (raw === null) return { ...contract, columns: null };
  const parsed = parseSelectColumns(raw);
  return { ...contract, columns: parsed.star ? null : parsed.columns };
}

/** Pełna ekstrakcja faktów szwu z kodu produkcyjnego. */
export function extractSeamFacts(
  sources: readonly SourceFile[],
  contracts: readonly PublicColumnContract[] = PUBLIC_COLUMN_CONTRACTS,
): SeamFacts {
  const known = new Set(sources.map((s) => s.file));
  const scopes = new Map<string, FileScope>();
  for (const { file, code } of sources) scopes.set(file, buildScope(file, code));
  const exportsIndex: ExportIndex = scopes;

  const out: Collector = {
    rpcs: [],
    tables: [],
    literals: [],
    conflicts: [],
    rpcCalls: 0,
    rpcCallsWithUnknownName: 0,
    tableChains: 0,
    tableChainsWithUnknownTable: 0,
    unresolved: [],
  };
  for (const scope of scopes.values()) visitFile(scope, exportsIndex, known, out);

  return {
    rpcs: out.rpcs,
    tables: out.tables,
    literals: out.literals,
    conflicts: out.conflicts,
    publicColumns: contracts.map((c) => readPublicColumns(c, scopes, known)),
    coverage: {
      files: sources.length,
      rpcCalls: out.rpcCalls,
      rpcCallsWithUnknownName: out.rpcCallsWithUnknownName,
      tableChains: out.tableChains,
      tableChainsWithUnknownTable: out.tableChainsWithUnknownTable,
      unresolvedSites: [...out.unresolved].sort(),
    },
  };
}

// ── Zasięg ekstrakcji ───────────────────────────────────────────────────────

/**
 * Zapadka: wywołania, których nazwy funkcji albo tabeli NIE da się ustalić
 * statycznie (pomocniki generyczne: sortowanie, wybór linku, bramka
 * analityki). Kontrakt ich nie sprawdza - liczba może TYLKO maleć. Nowe
 * wywołanie z obliczoną nazwą zapala `check:ts-sql-contract`: zamień je na
 * literał (najlepiej) albo świadomie podnieś zapadkę w przeglądzie.
 */
export const MAX_UNRESOLVED_SITES = 13;

/** Problemy zasięgu ekstrakcji - bez bazy, do bramki `check:ts-sql-contract`. */
export function seamCoverageProblems(facts: SeamFacts): string[] {
  const problems: string[] = [];
  for (const p of facts.publicColumns) {
    if (p.columns === null) {
      problems.push(
        `${p.file}: stała ${p.constant} (kolumny publiczne ${p.table}) nie jest literałem listy kolumn`,
      );
    }
  }
  const unresolved = facts.coverage.unresolvedSites;
  if (unresolved.length > MAX_UNRESOLVED_SITES) {
    problems.push(
      `${unresolved.length} wywołań z nazwą nie do ustalenia statycznie (zapadka: ${MAX_UNRESOLVED_SITES}):\n` +
        unresolved.map((site) => `        ${site}`).join("\n"),
    );
  }
  return problems;
}

// ── Wyjątki przejrzane w przeglądzie (lista może TYLKO maleć) ───────────────

/**
 * Funkcje SECURITY DEFINER wykonywalne dla `anon`/`authenticated`, które
 * czytają klucz tożsamości (`tenant_id`, `company_id`, `user_id`, ...)
 * z ładunku jsonb BEZ wywołania bramki redakcji (`assert_*`, `has_role`,
 * `club_capabilities`, ...). Każdy wpis to zdanie, dlaczego ta wartość
 * z żądania jest dopuszczalna. Klasa defektu: `company_id` w
 * `event_package_purchase` (naprawione w 20261007120000).
 */
export const PAYLOAD_IDENTITY_REVIEWED: Readonly<Record<string, string>> = {
  event_my_event_profile_set:
    "company_id to DEKLARACJA WŁASNEJ afiliacji uczestnika (jego profil wydarzenia i profil konta), sprawdzona w najemcy wołającego - nie przypisanie cudzego zasobu.",
  club_thread_milestone_upsert:
    "owner_id to przypisanie kamienia milowego w wątku; zapis przechodzi przez club_thread_access (uprawnienia wątku klubu) - bramka ma inną nazwę niż assert_*.",
};

/**
 * RPC wołane z TS WYŁĄCZNIE rolą serwisową, które ŚWIADOMIE zostają
 * wykonywalne dla klienta. Domyślnie taka funkcja nie powinna mieć EXECUTE
 * dla `anon`/`authenticated` - klasa defektu: `validate_b2b_coupon`
 * (limit prób po adresie żył tylko w TS, PostgREST wprost go omijał).
 */
export const SERVER_ONLY_RPC_REVIEWED: Readonly<Record<string, string>> = {};

// ── Render testu pgTAP ──────────────────────────────────────────────────────

const IDENTITY_KEYS = [
  "tenant_id",
  "company_id",
  "crm_company_id",
  "user_id",
  "buyer_user_id",
  "owner_id",
  "created_by",
  "author_id",
  "organization_id",
  "actor_id",
  "member_id",
  "profile_id",
  "granted_by",
  "moderator_id",
] as const;

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlTextArray(values: readonly string[] | null): string {
  if (values === null) return "NULL::text[]";
  if (values.length === 0) return "'{}'::text[]";
  return `ARRAY[${values.map(sqlString).join(", ")}]::text[]`;
}

function filesOf(files: Iterable<string>): string {
  return sqlString([...new Set(files)].sort().join(", "));
}

interface Grouped<K, V> {
  key: K;
  value: V;
  files: Set<string>;
}

function groupBy<T, K, V>(
  items: readonly T[],
  keyOf: (item: T) => string,
  init: (item: T) => { key: K; value: V },
  merge: (value: V, item: T) => V,
  fileOf: (item: T) => string,
): Grouped<K, V>[] {
  const map = new Map<string, Grouped<K, V>>();
  for (const item of items) {
    const id = keyOf(item);
    const existing = map.get(id);
    if (existing) {
      existing.value = merge(existing.value, item);
      existing.files.add(fileOf(item));
    } else {
      const { key, value } = init(item);
      map.set(id, { key, value, files: new Set([fileOf(item)]) });
    }
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, g]) => g);
}

function valuesBlock(table: string, columns: string, rows: readonly string[]): string {
  if (rows.length === 0) return `-- ${table}: brak wierszy\n`;
  return `INSERT INTO ${table} (${columns}) VALUES\n${rows.map((r) => `  (${r})`).join(",\n")};\n`;
}

/**
 * Test pgTAP kontraktu. Deterministyczny (posortowany) - dwa przebiegi na tym
 * samym kodzie dają bajt w bajt ten sam plik.
 */
export function renderContractTest(
  facts: SeamFacts,
  reviewed: {
    readonly payloadIdentity?: Readonly<Record<string, string>>;
    readonly serverOnlyRpc?: Readonly<Record<string, string>>;
  } = {},
): string {
  const payloadReviewed = Object.keys(reviewed.payloadIdentity ?? PAYLOAD_IDENTITY_REVIEWED).sort();
  const serverOnlyReviewed = Object.keys(reviewed.serverOnlyRpc ?? SERVER_ONLY_RPC_REVIEWED).sort();

  const rpcRows = groupBy(
    facts.rpcs,
    (r) => `${r.name}|${r.keys === null ? "?" : r.keys.join(",")}|${r.role}`,
    (r) => ({ key: r, value: null }),
    (v) => v,
    (r) => r.file,
  ).map((g) =>
    [sqlString(g.key.name), sqlTextArray(g.key.keys), sqlString(g.key.role), filesOf(g.files)].join(
      ", ",
    ),
  );

  // Grupa = (tabela, operacja, rola, PLIK): naruszenie kolumny ma wskazywać
  // plik, który ją czyta, a nie wszystkie pliki dotykające tej tabeli.
  const tableRows = groupBy(
    facts.tables,
    (t) => `${t.table}|${t.op}|${t.role}|${t.file}`,
    (t) => ({ key: t, value: { columns: new Set(t.columns), star: t.star } }),
    (v, t) => {
      for (const c of t.columns) v.columns.add(c);
      return { columns: v.columns, star: v.star || t.star };
    },
    (t) => t.file,
  ).map((g) =>
    [
      sqlString(g.key.table),
      sqlString(g.key.op),
      sqlString(g.key.role),
      sqlTextArray([...g.value.columns].sort()),
      g.value.star ? "true" : "false",
      filesOf(g.files),
    ].join(", "),
  );

  const literalRows = groupBy(
    facts.literals,
    (l) => `${l.table}|${l.column}|${l.value}`,
    (l) => ({ key: l, value: null }),
    (v) => v,
    (l) => l.file,
  ).map((g) =>
    [
      sqlString(g.key.table),
      sqlString(g.key.column),
      sqlString(g.key.value),
      filesOf(g.files),
    ].join(", "),
  );

  const conflictRows = groupBy(
    facts.conflicts,
    (c) => `${c.table}|${c.columns.join(",")}`,
    (c) => ({ key: c, value: null }),
    (v) => v,
    (c) => c.file,
  ).map((g) => [sqlString(g.key.table), sqlTextArray(g.key.columns), filesOf(g.files)].join(", "));

  const publicRows = facts.publicColumns.flatMap((p) =>
    p.roles.map((role) =>
      [
        sqlString(p.table),
        sqlString(role),
        sqlTextArray(p.columns),
        sqlString(`${p.file}: ${p.constant}`),
      ].join(", "),
    ),
  );

  return `-- ============================================================================
-- WYGENEROWANE - NIE EDYTOWAC. Zrodlo: \`bun run generate:ts-sql-contract\`
-- (src/lib/ci/tsSqlContract.ts, scripts/generate-ts-sql-contract.ts).
--
-- pgTAP: KONTRAKT TypeScript <-> SQL sprawdzany na PRAWDZIWYM schemacie.
-- Fakty pochodza z kodu produkcyjnego src/** (drzewo skladniowe TS):
-- wywolania .rpc(), lancuchy .from().select/insert/update/upsert/delete,
-- literaly zapisywane do kolumn, cele onConflict i rejestr kolumn
-- publicznych. Sprawdza je katalog Postgresa po WSZYSTKICH migracjach - nie
-- atrapa z testow TS i nie model z regexow.
--
-- Zasieg: ${facts.coverage.files} plikow, ${facts.coverage.rpcCalls} wywolan .rpc (nazwa nieczytelna:
-- ${facts.coverage.rpcCallsWithUnknownName}), ${facts.coverage.tableChains} lancuchow .from (tabela nieczytelna: ${facts.coverage.tableChainsWithUnknownTable}).
-- Kazda asercja zwraca LISTE naruszen z plikami TS, ktore je wnosza.
-- ============================================================================
BEGIN;
SELECT plan(9);

CREATE TEMP TABLE ts_rpc (fn text, keys text[], role text, sites text) ON COMMIT DROP;
CREATE TEMP TABLE ts_table (rel text, op text, role text, cols text[], star boolean, sites text) ON COMMIT DROP;
CREATE TEMP TABLE ts_literal (rel text, col text, val text, sites text) ON COMMIT DROP;
CREATE TEMP TABLE ts_conflict (rel text, cols text[], sites text) ON COMMIT DROP;
CREATE TEMP TABLE ts_public_cols (rel text, role text, cols text[], source text) ON COMMIT DROP;

${valuesBlock("ts_rpc", "fn, keys, role, sites", rpcRows)}
${valuesBlock("ts_table", "rel, op, role, cols, star, sites", tableRows)}
${valuesBlock("ts_literal", "rel, col, val, sites", literalRows)}
${valuesBlock("ts_conflict", "rel, cols, sites", conflictRows)}
${valuesBlock("ts_public_cols", "rel, role, cols, source", publicRows)}
-- Przeciazenie, ktore PostgREST wybierze dla tych kluczy: kazdy klucz to
-- nazwany parametr wejsciowy, a kazdy parametr bez DEFAULT jest podany.
-- Jedyny nienazwany parametr json/jsonb przyjmuje dowolne klucze.
CREATE FUNCTION pg_temp.ts_rpc_match(p_fn text, p_keys text[])
RETURNS oid LANGUAGE plpgsql STABLE AS $f$
DECLARE
  r record;
  v_in text[];
  v_req text[];
BEGIN
  FOR r IN
    SELECT p.oid, p.proargnames, p.proargmodes, p.proargtypes, p.pronargs, p.pronargdefaults
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = p_fn
     ORDER BY p.oid
  LOOP
    IF r.pronargs = 1 AND r.proargnames IS NULL
       AND r.proargtypes[0] IN ('json'::regtype, 'jsonb'::regtype) THEN
      RETURN r.oid;
    END IF;
    IF r.proargnames IS NULL THEN
      v_in := '{}';
      CONTINUE WHEN r.pronargs > 0;
    ELSIF r.proargmodes IS NULL THEN
      v_in := r.proargnames[1:r.pronargs];
    ELSE
      SELECT coalesce(array_agg(t.nm ORDER BY t.ord), '{}') INTO v_in
        FROM unnest(r.proargnames, r.proargmodes) WITH ORDINALITY AS t(nm, md, ord)
       WHERE t.md IN ('i', 'b', 'v');
    END IF;
    v_req := v_in[1:(r.pronargs - r.pronargdefaults)];
    IF p_keys <@ v_in AND v_req <@ p_keys THEN
      RETURN r.oid;
    END IF;
  END LOOP;
  RETURN NULL;
END $f$;

-- Czy literal przechodzi typ kolumny (enum, domena) i KAZDY jednokolumnowy
-- CHECK. Wyrazenie CHECK liczone jest na wierszu z ta jedna kolumna, wiec
-- regula jest ta sama, ktora sprawdza INSERT - bez parsowania listy wartosci.
-- NULL = zgoda, napis = powod odmowy.
CREATE FUNCTION pg_temp.ts_literal_refusal(p_rel text, p_col text, p_val text)
RETURNS text LANGUAGE plpgsql VOLATILE AS $f$
DECLARE
  v_rel regclass := to_regclass('public.' || quote_ident(p_rel));
  v_att record;
  v_con record;
  v_ok boolean;
BEGIN
  IF v_rel IS NULL THEN RETURN 'relacja nie istnieje'; END IF;
  SELECT a.attnum, format_type(a.atttypid, a.atttypmod) AS typ, t.typcategory, t.typtype,
         coalesce(bt.typcategory, t.typcategory) AS basecat
    INTO v_att
    FROM pg_attribute a
    JOIN pg_type t ON t.oid = a.atttypid
    LEFT JOIN pg_type bt ON bt.oid = t.typbasetype
   WHERE a.attrelid = v_rel AND a.attname = p_col AND a.attnum > 0 AND NOT a.attisdropped;
  IF NOT FOUND THEN RETURN 'kolumna nie istnieje'; END IF;
  -- Tylko kolumny tekstowe i wyliczeniowe: literal TS do json/uuid/liczby
  -- PostgREST koduje inaczej niz rzutowanie napisu.
  IF v_att.basecat NOT IN ('S', 'E') THEN RETURN NULL; END IF;
  BEGIN
    EXECUTE format('SELECT $1::%s', v_att.typ) USING p_val;
  EXCEPTION WHEN OTHERS THEN
    RETURN 'typ ' || v_att.typ || ': ' || SQLERRM;
  END;
  FOR v_con IN
    SELECT c.conname, pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
     WHERE c.conrelid = v_rel AND c.contype = 'c' AND c.conkey = ARRAY[v_att.attnum]::int2[]
  LOOP
    BEGIN
      EXECUTE format('SELECT (%s) IS NOT FALSE FROM (SELECT $1::%s AS %I) AS _c',
                     regexp_replace(v_con.def, '^CHECK \\((.*)\\)( NOT VALID)?$', '\\1'),
                     v_att.typ, p_col)
        INTO v_ok USING p_val;
    EXCEPTION WHEN OTHERS THEN
      RETURN v_con.conname || ': ' || SQLERRM;
    END;
    IF NOT v_ok THEN RETURN v_con.conname; END IF;
  END LOOP;
  RETURN NULL;
END $f$;

-- 1. RPC: nazwa i komplet kluczy maja przeciazenie (PGRST202 w przegladarce).
SELECT is(
  ARRAY(
    SELECT format('%s(%s) [%s]: brak przeciazenia dla tych kluczy', fn,
                  coalesce(array_to_string(keys, ','), '?'), sites)
      FROM ts_rpc
     WHERE (keys IS NOT NULL AND pg_temp.ts_rpc_match(fn, keys) IS NULL)
        OR (keys IS NULL AND NOT EXISTS (
              SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND p.proname = fn))
     ORDER BY 1),
  ARRAY[]::text[],
  'RPC z TS: kazda nazwa i komplet kluczy ma przeciazenie w public');

-- 2. RPC: rola klienta ma EXECUTE (42501 przy kazdym wywolaniu).
SELECT is(
  ARRAY(
    SELECT format('%s [%s] dla %s: brak EXECUTE', fn, sites, role)
      FROM ts_rpc
     WHERE role IN ('authenticated', 'service_role')
       AND (
         (keys IS NOT NULL AND pg_temp.ts_rpc_match(fn, keys) IS NOT NULL
          AND NOT has_function_privilege(role, pg_temp.ts_rpc_match(fn, keys), 'EXECUTE'))
         OR (keys IS NULL AND EXISTS (
               SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.proname = fn)
             AND NOT EXISTS (
               SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.proname = fn
                  AND has_function_privilege(role, p.oid, 'EXECUTE'))))
     ORDER BY 1),
  ARRAY[]::text[],
  'RPC z TS: rola klienta (authenticated / service_role) ma EXECUTE na wybranym przeciazeniu');

-- 3. RPC wolane z TS WYLACZNIE rola serwisowa: bez EXECUTE dla klienta.
--    Funkcja, ktorej kod nie woluje z przegladarki ani JWT uzytkownika, a ktora
--    ma EXECUTE dla anon/authenticated, jest dostepna PostgREST-em wprost -
--    z pominieciem wszystkiego, co serwer robi przed nia (limit prob, najemca).
--    Pomijamy funkcje uzywane w politykach RLS (tam EXECUTE jest potrzebne).
SELECT is(
  ARRAY(
    SELECT format('%s: wolana z TS tylko rola serwisowa, a %s ma EXECUTE', p.oid::regprocedure,
                  CASE WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'anon' ELSE 'authenticated' END)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         SELECT fn FROM ts_rpc GROUP BY fn HAVING bool_and(role = 'service_role'))
       AND p.proname <> ALL (${sqlTextArray(serverOnlyReviewed)})
       AND (has_function_privilege('anon', p.oid, 'EXECUTE')
            OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
       AND NOT EXISTS (
         SELECT 1 FROM pg_policies pol
          WHERE coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, '') ~ ('\\m' || p.proname || '\\s*\\('))
     ORDER BY 1),
  ARRAY[]::text[],
  'RPC wolane z TS wylacznie rola serwisowa nie sa wykonywalne dla anon/authenticated');

-- 4. Tabele: relacja i kolumny istnieja (PGRST205 / 42703).
SELECT is(
  ARRAY(
    SELECT format('%s.%s [%s] %s: %s', t.rel, coalesce(c.col, '*'), t.sites, t.op,
                  CASE WHEN to_regclass('public.' || quote_ident(t.rel)) IS NULL
                       THEN 'relacja nie istnieje' ELSE 'kolumna nie istnieje' END)
      FROM ts_table t
      LEFT JOIN LATERAL unnest(t.cols) AS c(col) ON true
     WHERE to_regclass('public.' || quote_ident(t.rel)) IS NULL
        OR (c.col IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM pg_attribute a
               WHERE a.attrelid = to_regclass('public.' || quote_ident(t.rel))
                 AND a.attname = c.col AND a.attnum > 0 AND NOT a.attisdropped))
     GROUP BY 1
     ORDER BY 1),
  ARRAY[]::text[],
  'Tabele z TS: relacja i kazda wskazana kolumna istnieja');

-- 5. Tabele: rola klienta ma uprawnienie do operacji na kazdej kolumnie
--    (select('*') = KAZDA kolumna, upsert = INSERT i UPDATE).
SELECT is(
  ARRAY(
    SELECT DISTINCT format('%s.%s [%s] %s dla %s: brak %s', t.rel, col, t.sites, t.op, t.role, priv)
      FROM ts_table t
      CROSS JOIN LATERAL (
        SELECT a.attname::text AS col FROM pg_attribute a
         WHERE a.attrelid = to_regclass('public.' || quote_ident(t.rel))
           AND a.attnum > 0 AND NOT a.attisdropped
           AND (t.star OR a.attname = ANY (t.cols))
      ) cols
      CROSS JOIN LATERAL unnest(CASE t.op
          WHEN 'select' THEN ARRAY['SELECT']
          WHEN 'insert' THEN ARRAY['INSERT']
          WHEN 'update' THEN ARRAY['UPDATE']
          WHEN 'upsert' THEN ARRAY['INSERT', 'UPDATE']
          WHEN 'upsert_ignore' THEN ARRAY['INSERT']
          ELSE ARRAY[]::text[] END) AS priv
     WHERE t.role IN ('authenticated', 'service_role')
       AND to_regclass('public.' || quote_ident(t.rel)) IS NOT NULL
       AND NOT has_column_privilege(t.role, to_regclass('public.' || quote_ident(t.rel)), col, priv)
    UNION
    SELECT format('%s [%s] delete dla %s: brak DELETE', t.rel, t.sites, t.role)
      FROM ts_table t
     WHERE t.op = 'delete' AND t.role IN ('authenticated', 'service_role')
       AND to_regclass('public.' || quote_ident(t.rel)) IS NOT NULL
       AND NOT has_table_privilege(t.role, to_regclass('public.' || quote_ident(t.rel)), 'DELETE')
     ORDER BY 1),
  ARRAY[]::text[],
  'Tabele z TS: rola klienta ma uprawnienie do operacji na kazdej kolumnie (42501)');

-- 6. Literaly zapisywane z TS przechodza typ i CHECK kolumny (23514 / 22P02).
SELECT is(
  ARRAY(
    SELECT format('%s.%s = %L [%s]: %s', rel, col, val, sites, pg_temp.ts_literal_refusal(rel, col, val))
      FROM ts_literal
     WHERE pg_temp.ts_literal_refusal(rel, col, val) IS NOT NULL
     ORDER BY 1),
  ARRAY[]::text[],
  'Literaly z TS: kazda wartosc zapisywana do kolumny przechodzi jej typ i CHECK');

-- 7. onConflict: cel ma arbitra - unikalny indeks DOKLADNIE na tych kolumnach,
--    bez predykatu i bez wyrazen (42P10 przy kazdym upsercie).
SELECT is(
  ARRAY(
    SELECT format('%s(%s) [%s]: brak unikalnego klucza dokladnie na tych kolumnach',
                  rel, array_to_string(cols, ','), sites)
      FROM ts_conflict c
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_index i
        WHERE i.indrelid = to_regclass('public.' || quote_ident(c.rel))
          AND i.indisunique AND i.indpred IS NULL AND i.indexprs IS NULL
          AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
                 FROM pg_attribute a
                WHERE a.attrelid = i.indrelid
                  AND a.attnum = ANY ((i.indkey::int2[])[0:i.indnkeyatts - 1]))
              = (SELECT array_agg(x ORDER BY x) FROM unnest(c.cols) x))
     ORDER BY 1),
  ARRAY[]::text[],
  'onConflict z TS: kazdy cel ma arbitra w schemacie');

-- 8. Kolumny publiczne: SELECT roli klienta == stala TS (ani mniej, ani wiecej).
SELECT is(
  ARRAY(
    SELECT format('%s dla %s [%s]: %s', p.rel, p.role, p.source,
                  CASE WHEN p.cols IS NULL THEN 'stalej TS nie da sie odczytac'
                       ELSE 'grant ' || coalesce(array_to_string(g.cols, ','), '-') ||
                            ' <> stala ' || array_to_string(p.cols, ',') END)
      FROM ts_public_cols p
      LEFT JOIN LATERAL (
        SELECT array_agg(a.attname::text ORDER BY a.attname) AS cols
          FROM pg_attribute a
         WHERE a.attrelid = to_regclass('public.' || quote_ident(p.rel))
           AND a.attnum > 0 AND NOT a.attisdropped
           AND has_column_privilege(p.role, a.attrelid, a.attnum, 'SELECT')
      ) g ON true
     WHERE p.cols IS NULL
        OR g.cols IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(p.cols) x)
     ORDER BY 1),
  ARRAY[]::text[],
  'Kolumny publiczne: grant SELECT dla klienta jest rowny stalej TS');

-- 9. Ladunek: funkcja SECURITY DEFINER dla klienta nie bierze tozsamosci
--    (najemca, firma, konto, autor) z jsonb bez bramki redakcji.
SELECT is(
  ARRAY(
    SELECT format('%s: klucz(e) %s z ladunku bez bramki redakcji', f.oid::regprocedure,
                  string_agg(DISTINCT m.key, ',' ORDER BY m.key))
      FROM pg_proc f
      JOIN pg_namespace n ON n.oid = f.pronamespace
      CROSS JOIN LATERAL (
        SELECT t.nm FROM unnest(f.proargnames, f.proargtypes::oid[]) AS t(nm, typ)
         WHERE t.typ IN ('json'::regtype, 'jsonb'::regtype) AND t.nm IS NOT NULL
      ) arg
      CROSS JOIN LATERAL (
        SELECT (regexp_matches(f.prosrc,
                  '\\m' || arg.nm || '\\s*->>?\\s*''(' || ${sqlString(IDENTITY_KEYS.join("|"))} || ')''', 'g'))[1] AS key
      ) m
     WHERE n.nspname = 'public' AND f.prosecdef
       AND f.prorettype <> 'trigger'::regtype
       AND (has_function_privilege('anon', f.oid, 'EXECUTE')
            OR has_function_privilege('authenticated', f.oid, 'EXECUTE'))
       AND f.prosrc !~* '\\m(assert_[a-z_]+|has_role|is_[a-z_]*admin[a-z_]*|is_tenant_staff|club_capabilities|club_thread_access)\\s*\\('
       AND f.proname <> ALL (${sqlTextArray(payloadReviewed)})
     GROUP BY f.oid
     ORDER BY 1),
  ARRAY[]::text[],
  'Ladunek: SECURITY DEFINER dla klienta nie czyta klucza tozsamosci z jsonb bez bramki redakcji');

SELECT * FROM finish();
ROLLBACK;
`;
}
