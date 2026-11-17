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
//      tabela, kolumny, literały zapisywane do kolumn, cel `onConflict`;
//      także `.select(<parametr>)` w funkcji oddanej pomocnikowi
//      `readPostsWithParentPage` (oba warianty kolumn, które on wyśle)
//      i `select` składany z parametru, którego wartość podają wywołania
//      (także z innego pliku: `postsNarrowedToTaxonomy(kolumny, ...)`),
//      oraz łańcuchy na zmiennej z budowniczym (`const base = ....from("t")`,
//      `let q = ....update(p).eq(...)` przedłużane `q = q.eq(...)`, a dalej
//      `q.select(...)`), a `looseTable(context, "t")` (CRM) liczy się jak
//      `.from("t")`; KAŻDY `select` na budowniczym, który nie dał faktu, jest
//      pozycją zapadki `UNCHECKED_SELECTS_REVIEWED`,
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
//   * `looseClient(źródło)` (CRM, `lib/supabase/looseQuery.ts`) - wprost albo
//     przez `const x = looseClient(źródło)` - jak źródło `looseTable`:
//     `context`/`ctx` - `authenticated`, `{ supabase: X }` - jak odbiorca `X`;
//   * wszystko inne (parametr pomocnika, atrapa) - `unknown`: sprawdzamy
//     istnienie i sygnaturę, ale nie uprawnienia.
// Fałszywy alarm byłby tu gorszy niż luka - bramka, która krzyczy na stan
// zgodny z bazą, zostaje wyłączona pierwszego dnia.
//
// Znany defekt grantu, którego bramka jeszcze nie może czerwienić (kod sprzed
// niej), to wpis `SEAM_FACTS_WITHHELD_REVIEWED`: wstrzymuje uprawnienia
// JEDNEGO faktu (plik, funkcja, tabela, operacja, rola, pełna lista kolumn),
// nigdy pliku ani pomocnika. Dziś lista jest pusta - każdy fakt idzie do
// pgTAP z rolą klienta.
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

/**
 * Fakt operacji na tabeli WSTRZYMANY w przeglądzie (`SEAM_FACTS_WITHHELD_REVIEWED`):
 * kod go wnosi, ale jego uprawnień kontrakt nie sprawdza - to znany defekt
 * grantu z nazwanym właścicielem naprawy. Istnienie relacji i kolumn sprawdza
 * nadal (render z rolą `unknown`).
 */
export interface WithheldFact extends TableSite {
  /** Ścieżka nazwanych funkcji wywołania (jak w kluczu zapadki `select`). */
  readonly fn: string;
  /** Klucz wpisu przeglądu, który go wstrzymał. */
  readonly key: string;
}

export interface SeamFacts {
  readonly rpcs: readonly RpcSite[];
  /** Fakty operacji na tabelach, które idą do pgTAP z rolą klienta. */
  readonly tables: readonly TableSite[];
  /** Fakty wstrzymane wpisem przeglądu - DOKŁADNIE te, nic poza nimi. */
  readonly withheld: readonly WithheldFact[];
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
    /**
     * Pliki z wywołaniem, którego nazwy/tabeli nie da się ustalić statycznie,
     * odczyty `readPostsWithParentPage`, których kolumn nie da się ustalić,
     * oraz `select` z parametru, do którego dociera wartość czasu działania.
     */
    readonly unresolvedSites: readonly string[];
    /**
     * `.select(x)` na tabeli znanej z nazwy, który nie dał ANI faktu, ANI
     * wpisu w `unresolvedSites` (stała lokalna funkcji, `X.join(", ")`,
     * warunek `a ? b : c`, funkcja bez widocznego wołającego...) - kontrakt go
     * nie sprawdza i nikt by o tym nie wiedział. Posortowane, z powtórzeniami.
     */
    readonly uncheckedSelects: readonly string[];
    /**
     * Pliki, których parser kompilatora nie przeczytał bez błędów składni
     * (`plik: N błędów składni, pierwszy: linia L: komunikat`). Drzewo takiego
     * pliku jest po pierwszym błędzie zgadywane, więc jego wywołania mogą nie
     * dać ŻADNEGO faktu - i nikt by o tym nie wiedział. Posortowane.
     */
    readonly parseErrors: readonly string[];
    /**
     * Wpisy `SEAM_FACTS_WITHHELD_REVIEWED` i liczba faktów, które każdy
     * wstrzymał. Przegląd dotyczył JEDNEGO faktu, więc każda inna liczba to
     * problem zasięgu: 0 - wpis nieaktualny (kod już tego nie czyta albo
     * zmienił kolumny), więcej - wpis wstrzymuje coś, czego nikt nie oglądał.
     */
    readonly withheldReviewed: readonly { readonly key: string; readonly matched: number }[];
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

/**
 * Rodzaj skryptu PO ROZSZERZENIU, jak u kompilatora. Plik `.ts` parsowany jako
 * TSX gubi się na pierwszej strzałce generycznej (`async <Row>(...) =>` to
 * w TSX otwarcie znacznika) i resztę pliku czyta jako tekst JSX - do
 * listopada 2026 eksport danych RODO (`profile/export.functions.ts`) dawał
 * przez to 168 błędów składni, zero łańcuchów `.from` i zero `.rpc`, a 33
 * odczyty i 13 wywołań RPC nie były sprawdzane przez nic.
 */
export function scriptKindOf(file: string): ts.ScriptKind {
  return file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function buildScope(file: string, code: string): FileScope {
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, scriptKindOf(file));
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

/**
 * Rola klienta dla odbiorcy `.rpc` / `.from` (`supabase`, `context.supabase`,
 * `looseClient(context)`, nazwa związana z `looseClient(...)`, ...).
 */
export function receiverRole(
  receiver: ts.Expression,
  scope: FileScope,
  known: ReadonlySet<string>,
): ClientRole {
  const node = unwrap(receiver);
  if (ts.isCallExpression(node) && isLooseHelperCall(node, LOOSE_CLIENT, scope, known)) {
    return looseSourceRole(node.arguments[0], scope, known);
  }
  if (ts.isIdentifier(node)) {
    if (scope.adminAliases.has(node.text)) return "service_role";
    if (node.text === "supabase" && (scope.browserClient || scope.authMiddleware))
      return "authenticated";
    const bound = looseClientBinding(node, scope, known);
    return bound === null ? "unknown" : looseSourceRole(bound.arguments[0], scope, known);
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
    const item = selectItemColumn(raw);
    if (item === null) continue;
    if (item === "*") {
      star = true;
      continue;
    }
    if (COLUMN_RE.test(item)) columns.add(item);
  }
  return { columns: [...columns].sort(), star };
}

/**
 * Kolumna elementu listy `select` (bez aliasu, rzutowania i ścieżki json);
 * `null` - zasób osadzony albo rozkład, czyli nie kolumna tej tabeli.
 */
function selectItemColumn(raw: string): string | null {
  if (raw.includes("(") || raw.startsWith("...")) return null;
  let item = raw;
  const alias = item.indexOf(":");
  if (alias !== -1 && item[alias + 1] !== ":") item = item.slice(alias + 1);
  return item.split("::")[0].split("->")[0].trim();
}

// ── Odczyt wpisów przez `readPostsWithParentPage` ───────────────────────────
//
// `readPostsWithParentPage(read, PLAIN)` (`lib/routing/postParentPageRead.ts`)
// woła `read(postColumnsWithParentPage(PLAIN))`, a po błędzie `read(PLAIN)`.
// W łańcuchu `.from("posts").select(columns)` wewnątrz `read` argument
// `select` jest parametrem, więc `resolveString` go nie zna i bez tej reguły
// odczyt nie dawał żadnego faktu: kolumna dopisana do PLAIN bez GRANT-u
// przechodziła CI i padała dopiero w przeglądarce.
//
// REGUŁA JEST WĄSKA CELOWO - jeden kształt, bez zgadywania:
//   * argument `.select` to PIERWSZY parametr NAJBLIŻSZEJ funkcji (strzałka,
//     wyrażenie `function` albo deklaracja), jedyne wiązanie tej nazwy w tej
//     funkcji i nigdzie w niej nie przypisywane - czyli wartość, którą podał
//     pomocnik;
//   * ta funkcja jest pierwszym argumentem wywołania pomocnika wprost albo
//     przez `const`/deklarację funkcji w tym samym pliku (nazwa wiązana raz
//     w swoim bloku i nieprzypisywana), a pomocnik to import z jego modułu;
//   * drugi argument pomocnika rozwiązuje się zwykłym `resolveString`.
// Parametr przekazany DALEJ (`postsQuery(narrowing, columns)`,
// `postsConstrainedByTaxonomy(columns, ...)`) nie jest tym kształtem - tam
// `select` składa inna funkcja; te odczyty widzi reguła przepływu kolumn
// przez parametr (sekcja niżej), dla której pomocnik jest jednym ze źródeł
// wartości parametru.
//
// Oba warianty dają fakty: osadzenie bierzemy ze stałej, której używa sam
// pomocnik (`POST_PARENT_PAGE_EMBED` w `postHref.ts`), nie z kopii literału.
// `parseSelectColumns` pomija zasoby osadzone (także w literałach gdzie
// indziej), więc dziś oba warianty dają te same kolumny `posts`; uprawnienia
// do `pages(slug, parent_id)` z osadzenia bramka nie sprawdza nigdzie.

/** Pomocnik, jego moduł i stała osadzenia, którą dokleja (ścieżki repo). */
export const POST_PARENT_PAGE_READ = {
  helper: "readPostsWithParentPage",
  module: "src/lib/routing/postParentPageRead.ts",
  embedModule: "src/lib/routing/postHref.ts",
  embedConstant: "POST_PARENT_PAGE_EMBED",
} as const;

/**
 * Wariant kolumn z osadzeniem - ten sam napis, który składa
 * `postColumnsWithParentPage` (test pilnuje równości z tamtą funkcją).
 */
export function withPostParentPageEmbed(plainColumns: string, embed: string): string {
  return `${plainColumns}, ${embed}`;
}

type ReadFunction = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration;

/** Najbliższa funkcja zawierająca węzeł (dowolnego rodzaju). */
function enclosingFunction(node: ts.Node): ts.SignatureDeclaration | null {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionLike(current)) return current;
  }
  return null;
}

/** Ile wiązań nazwy (zmienna, parametr, rozkład, funkcja, klasa, enum) jest w poddrzewie. */
function bindingCount(root: ts.Node, name: string): number {
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      count += 1;
    } else if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isClassDeclaration(node) ||
        ts.isClassExpression(node) ||
        ts.isEnumDeclaration(node)) &&
      node.name?.text === name
    ) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return count;
}

function containsIdentifier(node: ts.Node, name: string): boolean {
  if (ts.isIdentifier(node)) return node.text === name;
  return ts.forEachChild(node, (child) => containsIdentifier(child, name) || undefined) ?? false;
}

/** Czy w poddrzewie coś przypisuje do nazwy (`=`, `+=`, `++`, rozkład, `for (x of ...)`). */
function isAssigned(root: ts.Node, name: string): boolean {
  let assigned = false;
  const isTarget = (target: ts.Expression): boolean => {
    const node = unwrap(target);
    if (ts.isIdentifier(node)) return node.text === name;
    // Przypisanie rozkładające: konserwatywnie - nazwa gdziekolwiek po lewej.
    if (ts.isArrayLiteralExpression(node) || ts.isObjectLiteralExpression(node)) {
      return containsIdentifier(node, name);
    }
    return false;
  };
  const visit = (node: ts.Node): void => {
    if (assigned) return;
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      isTarget(node.left)
    ) {
      assigned = true;
      return;
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken) &&
      isTarget(node.operand)
    ) {
      assigned = true;
      return;
    }
    if (
      (ts.isForOfStatement(node) || ts.isForInStatement(node)) &&
      !ts.isVariableDeclarationList(node.initializer) &&
      isTarget(node.initializer)
    ) {
      assigned = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return assigned;
}

/** Wyrażenie razem z owijkami (nawiasy, `as`, `satisfies`, `!`) nad nim. */
function outermostWrapper(node: ts.Expression): ts.Expression {
  let current: ts.Expression = node;
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

/** Czy wywołanie to `readPostsWithParentPage(...)` z importu modułu pomocnika. */
function isPostParentPageHelperCall(
  call: ts.CallExpression,
  scope: FileScope,
  known: ReadonlySet<string>,
): boolean {
  const callee = unwrap(call.expression);
  if (!ts.isIdentifier(callee)) return false;
  const imported = scope.imports.get(callee.text);
  return (
    imported !== undefined &&
    imported[1] === POST_PARENT_PAGE_READ.helper &&
    resolveModule(scope.file, imported[0], known) === POST_PARENT_PAGE_READ.module
  );
}

/** Wywołania pomocnika, którym funkcja `fn` jest oddana jako pierwszy argument. */
function helperCallsReceiving(
  fn: ReadFunction,
  scope: FileScope,
  known: ReadonlySet<string>,
): ts.CallExpression[] {
  let name: string;
  let container: ts.Node;
  if (ts.isFunctionDeclaration(fn)) {
    if (fn.name === undefined) return [];
    name = fn.name.text;
    container = fn.parent;
  } else {
    const outer = outermostWrapper(fn);
    const parent = outer.parent;
    // Wprost: `readPostsWithParentPage((columns) => ..., COLS)`.
    if (ts.isCallExpression(parent)) {
      return parent.arguments[0] === outer && isPostParentPageHelperCall(parent, scope, known)
        ? [parent]
        : [];
    }
    // Przez stałą: `const read = (columns) => ...; readPostsWithParentPage(read, COLS)`.
    if (
      !ts.isVariableDeclaration(parent) ||
      parent.initializer !== outer ||
      !ts.isIdentifier(parent.name) ||
      !ts.isVariableDeclarationList(parent.parent) ||
      !(parent.parent.flags & ts.NodeFlags.Const) ||
      !ts.isVariableStatement(parent.parent.parent)
    ) {
      return [];
    }
    name = parent.name.text;
    container = parent.parent.parent.parent;
  }
  // Nazwa wiązana RAZ w swoim bloku i nieprzypisywana - każde jej użycie
  // w tym bloku to ta funkcja.
  if (bindingCount(container, name) !== 1 || isAssigned(container, name)) return [];
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isPostParentPageHelperCall(node, scope, known)) {
      const first = node.arguments[0] === undefined ? null : unwrap(node.arguments[0]);
      if (first !== null && ts.isIdentifier(first) && first.text === name) calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(container);
  return calls;
}

/**
 * Napisy `select`, które dostanie `.select(arg)` przez `readPostsWithParentPage`.
 * `null` - to nie ten kształt (wołający rozwiązuje argument jak dotąd);
 * pusta lista - ten kształt, ale kolumn nie da się ustalić (miejsce trafia do
 * `unresolved`, fakt nie powstaje).
 */
function postParentPageSelects(
  arg: ts.Expression,
  selectCall: ts.CallExpression,
  scope: FileScope,
  exportsIndex: ExportIndex,
  known: ReadonlySet<string>,
  out: Collector,
): string[] | null {
  const id = unwrap(arg);
  if (!ts.isIdentifier(id)) return null;
  const fn = enclosingFunction(selectCall);
  if (
    fn === null ||
    !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn) || ts.isFunctionDeclaration(fn))
  ) {
    return null;
  }
  const first = fn.parameters[0];
  if (
    first === undefined ||
    first.dotDotDotToken !== undefined ||
    !ts.isIdentifier(first.name) ||
    first.name.text !== id.text ||
    bindingCount(fn, id.text) !== 1 ||
    isAssigned(fn, id.text)
  ) {
    return null;
  }
  const calls = helperCallsReceiving(fn, scope, known);
  if (calls.length === 0) return null;

  const embed = postParentPageEmbed(exportsIndex, known);
  const selects: string[] = [];
  for (const call of calls) {
    const plainArg = call.arguments[1];
    const plain =
      plainArg === undefined ? null : resolveString(plainArg, scope, exportsIndex, known);
    const site = `${scope.file}: .select(${id.text}) <- ${POST_PARENT_PAGE_READ.helper}`;
    if (plain === null) {
      out.unresolved.push(
        `${site}(…, ${plainArg === undefined ? "" : plainArg.getText(scope.sf).slice(0, 60)})`,
      );
      continue;
    }
    if (embed === null) {
      // Kolumny zwykłego wariantu są pewne; wariantu z osadzeniem - nie.
      out.unresolved.push(
        `${site}: ${POST_PARENT_PAGE_READ.embedConstant} (${POST_PARENT_PAGE_READ.embedModule}) nieczytelne`,
      );
    } else {
      selects.push(withPostParentPageEmbed(plain, embed));
    }
    selects.push(plain);
  }
  return selects;
}

/** Osadzenie, które dokleja pomocnik - wartość PRAWDZIWEJ stałej z `postHref.ts`. */
function postParentPageEmbed(exportsIndex: ExportIndex, known: ReadonlySet<string>): string | null {
  const embedScope = exportsIndex.get(POST_PARENT_PAGE_READ.embedModule);
  return embedScope === undefined
    ? null
    : resolveConstant(POST_PARENT_PAGE_READ.embedConstant, embedScope, exportsIndex, known, 0);
}

// ── Kolumny przekazywane parametrem między funkcjami ────────────────────────
//
// Reguła pomocnika (wyżej) widzi `.select(columns)` tylko wtedy, gdy funkcja
// oddana `readPostsWithParentPage` SAMA woła `.select` na swoim parametrze.
// Sześć odczytów wpisów (mega menu, bloki treści, cztery widgety buildera)
// i archiwum taksonomii przekazuje kolumny DALEJ - do `postsQuery`
// (`blocks.ts`), `postsNarrowedToTaxonomy` albo `postsConstrainedByTaxonomy`
// (`taxonomyPivot.ts`), które składają `select` w innej funkcji, także
// w innym pliku (`${cols}, ${OSADZENIE}`, `[cols, ...osadzenia].join(", ")`).
// Bez tej reguły kolumna dopisana do ich literału bez GRANT-u przechodziła CI.
//
// JAK. `.select(arg)`, którego `arg` zależy od DOKŁADNIE JEDNEGO parametru
// najbliższej funkcji F, dostaje fakty z wartości, jakie ten parametr
// przyjmuje w wywołaniach F:
//   * wywołanie po nazwie w tym samym pliku albo - gdy F jest eksportem
//     najwyższego poziomu (`export function` / `export const`) - przez import
//     nazwany w innym pliku (bez reeksportów i importów przestrzeni nazw);
//   * `readPostsWithParentPage(F, PLAIN)` dla pierwszego parametru: oba
//     warianty, które pomocnik wysyła (z osadzeniem i zapasowy);
//   * argument to literał albo stała - albo znów parametr funkcji wołającej:
//     wtedy krok w górę, najwyżej `COLUMN_FLOW_MAX_DEPTH` skoków.
// Fakt dostaje plik, w którym rozwiązał się literał kolumn (tam się je
// dopisuje), a rolę - odbiorca `.from()` w funkcji składającej `select`.
//
// STRAŻNICY (jak przy pomocniku: fałszywy fakt jest gorszy niż brak faktu):
//   * parametr: identyfikator bez `...` i bez wartości domyślnej, jedyne
//     wiązanie tej nazwy w F, nigdzie nieprzypisywany;
//   * nazwa F wiązana RAZ w swoim bloku i nieprzypisywana; w pliku
//     importującym nazwa lokalna niczym nieprzesłonięta;
//   * wywołanie z rozkładem (`f(...args)`) do pozycji parametru - pomijane;
//   * nazwy w wyrażeniu `select` i w argumentach: parametr, `const`
//     najbliższej funkcji (jedyne wiązanie, w zasięgu użycia), stała modułu
//     albo importu, której nazwy nic w pliku nie przesłania - wartość
//     PRAWDZIWEJ stałej (np. `CATEGORY_PIVOT_EMBED`, `POST_PARENT_PAGE_EMBED`).
//     `let`, wiązanie wielokrotne albo przesłonięte: reguła milczy;
//   * `[...].join(sep)` z rozkładem `xs.map(cb)`: element listy to wynik `cb`
//     z wartościami czasu działania; bez faktu kolumny tylko wtedy, gdy jest
//     zasobem osadzonym (`alias:tabela!inner()`), czyli nie kolumną tej tabeli.
// Wartość czasu działania na miejscu KOLUMNY (argument wyliczany dopiero
// w przeglądarce, rozkład bez `map`, element bez nawiasu) czyni miejsce
// nieczytelnym: znane kolumny dają fakty, a miejsce trafia do
// `unresolvedSites` (zapadka). Funkcja nieznanego wołającego (oddana jako
// wartość, wołana tylko z testów) faktów nie daje - jak dotąd; taki `select`,
// podobnie jak każdy, którego reguła milczy, trafia do `uncheckedSelects`
// (zapadka `UNCHECKED_SELECTS_REVIEWED`).

/** Najwięcej skoków wywołań między `.select` a literałem kolumn. */
export const COLUMN_FLOW_MAX_DEPTH = 4;

/** Znak spoza składni `select`: część napisu znana dopiero w czasie działania. */
const RUNTIME_PART = "";

/** Kawałek szablonu `select`: tekst albo parametr najbliższej funkcji. */
type FlowPart = string | { readonly param: number };

interface FlowValue {
  /** Napis `select` (z `RUNTIME_PART` w miejscach nieznanych statycznie). */
  readonly text: string;
  /** Plik, w którym rozwiązał się literał kolumn. */
  readonly file: string;
}

interface FlowImport {
  readonly scope: FileScope;
  readonly local: string;
  readonly imported: string;
}

interface FlowEnv {
  readonly scopes: ExportIndex;
  readonly known: ReadonlySet<string>;
  /** Miejsca nieczytelne tej reguły (zbiór: jedno miejsce osiągalne z kilku `select`). */
  readonly unresolved: Set<string>;
  /**
   * Ile razy reguła zgłosiła miejsce nieczytelne (także już znane ze zbioru) -
   * żeby `select` bez faktu, ale ze zgłoszonym miejscem, nie trafił do
   * `uncheckedSelects`.
   */
  flagged: number;
  /** Plik -> importy nazwane z niego; budowane leniwie, raz na ekstrakcję. */
  importers: Map<string, FlowImport[]> | null;
}

interface FlowCtx {
  readonly scope: FileScope;
  /** Najbliższa funkcja wyrażenia - jej parametry to dziury szablonu. */
  readonly fn: ts.SignatureDeclaration | null;
  /** Callbacki `.map(cb)` w trakcie oceny - ich wiązania to wartości czasu działania. */
  readonly lambdas: readonly ts.SignatureDeclaration[];
}

/** Indeks parametru `name` funkcji `fn`; `-1` - to nie parametr; `null` - parametr poza regułą. */
function flowParamIndex(fn: ts.SignatureDeclaration, name: string): number | null {
  const index = fn.parameters.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === name);
  if (index === -1) return -1;
  const param = fn.parameters[index];
  return param.dotDotDotToken === undefined &&
    param.initializer === undefined &&
    bindingCount(fn, name) === 1 &&
    !isAssigned(fn, name)
    ? index
    : null;
}

/**
 * Inicjalizator jedynej deklaracji `const name` w `fn`, w zasięgu `use`.
 * `undefined` - nazwa nie jest w `fn` wiązana; `null` - jest, ale poza regułą
 * (`let`, wiele wiązań, przypisanie, blok nieobejmujący użycia, funkcja
 * zagnieżdżona, parametr rozkładany).
 */
function flowLocalConst(
  fn: ts.SignatureDeclaration,
  name: string,
  use: ts.Node,
): ts.Expression | null | undefined {
  const count = bindingCount(fn, name);
  if (count === 0) return undefined;
  if (count !== 1 || isAssigned(fn, name)) return null;
  const decls: ts.VariableDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      decls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(fn);
  const decl = decls[0];
  if (
    decls.length !== 1 ||
    decl.initializer === undefined ||
    !ts.isVariableDeclarationList(decl.parent) ||
    !(decl.parent.flags & ts.NodeFlags.Const) ||
    !ts.isVariableStatement(decl.parent.parent) ||
    enclosingFunction(decl) !== fn
  ) {
    return null;
  }
  const block = decl.parent.parent.parent;
  for (let node: ts.Node | undefined = use; node; node = node.parent) {
    if (node === block) return decl.initializer;
  }
  return null;
}

function flowIdentifier(
  id: ts.Identifier,
  ctx: FlowCtx,
  env: FlowEnv,
  depth: number,
): FlowPart[] | null {
  const name = id.text;
  if (ctx.lambdas.some((cb) => bindingCount(cb, name) > 0)) return [RUNTIME_PART];
  if (ctx.fn !== null) {
    const index = flowParamIndex(ctx.fn, name);
    if (index === null) return null;
    if (index >= 0) return [{ param: index }];
    const init = flowLocalConst(ctx.fn, name, id);
    if (init === null) return null;
    if (init !== undefined) return flowTemplate(init, ctx, env, depth + 1);
  }
  // Poza najbliższą funkcją: tylko stała modułu albo importu, a nazwy nie
  // wiąże w pliku nic innego (zmienna funkcji zewnętrznej, parametr gdzie
  // indziej) - inaczej wartość z modułu mogłaby nie być tą wysyłaną.
  const { scope } = ctx;
  const topLevel = scope.strings.has(name) || scope.stringExprs.has(name) ? 1 : 0;
  if ((topLevel === 1 || scope.imports.has(name)) && bindingCount(scope.sf, name) === topLevel) {
    const value = resolveConstant(name, scope, env.scopes, env.known, 0);
    if (value !== null) return [value];
  }
  return [RUNTIME_PART];
}

/** Wynik callbacku: ciało-wyrażenie albo blok z jednym `return`. */
function callbackResult(cb: ts.ArrowFunction | ts.FunctionExpression): ts.Expression | null {
  if (!ts.isBlock(cb.body)) return cb.body;
  const [only] = cb.body.statements;
  return cb.body.statements.length === 1 &&
    ts.isReturnStatement(only) &&
    only.expression !== undefined
    ? only.expression
    : null;
}

/** Element rozkładu w `[...].join`: `xs.map(cb)` - jeden reprezentatywny wynik `cb`. */
function flowSpreadItem(
  expr: ts.Expression,
  ctx: FlowCtx,
  env: FlowEnv,
  depth: number,
): FlowPart[] | null {
  const node = unwrap(expr);
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "map" &&
    node.arguments.length >= 1
  ) {
    const cb = unwrap(node.arguments[0]);
    if (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) {
      const result = callbackResult(cb);
      if (result !== null) {
        return flowTemplate(result, { ...ctx, lambdas: [...ctx.lambdas, cb] }, env, depth + 1);
      }
    }
  }
  return [RUNTIME_PART];
}

/** `[a, ...xs.map(cb)].join(sep)`; `undefined` - to nie ten kształt. */
function flowJoin(
  call: ts.CallExpression,
  ctx: FlowCtx,
  env: FlowEnv,
  depth: number,
): FlowPart[] | null | undefined {
  const callee = call.expression;
  if (
    !ts.isPropertyAccessExpression(callee) ||
    callee.name.text !== "join" ||
    call.arguments.length !== 1
  ) {
    return undefined;
  }
  const list = unwrap(callee.expression);
  if (!ts.isArrayLiteralExpression(list)) return undefined;
  const sepParts = flowTemplate(call.arguments[0], ctx, env, depth + 1);
  if (
    sepParts === null ||
    !sepParts.every((p): p is string => typeof p === "string" && !p.includes(RUNTIME_PART))
  ) {
    return null;
  }
  const sep = sepParts.join("");
  const out: FlowPart[] = [];
  for (const [i, el] of list.elements.entries()) {
    const item = ts.isSpreadElement(el)
      ? flowSpreadItem(el.expression, ctx, env, depth + 1)
      : flowTemplate(el, ctx, env, depth + 1);
    if (item === null) return null;
    if (i > 0) out.push(sep);
    out.push(...item);
  }
  return out;
}

/**
 * Szablon napisu: tekst, `RUNTIME_PART` w miejscach znanych dopiero w czasie
 * działania i dziury na parametry najbliższej funkcji. `null` - wyrażenie
 * poza regułą (wiązanie, którego wartości nie da się pewnie ustalić).
 */
function flowTemplate(
  expr: ts.Expression,
  ctx: FlowCtx,
  env: FlowEnv,
  depth: number,
): FlowPart[] | null {
  if (depth > 8) return null;
  const node = unwrap(expr);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isTemplateExpression(node)) {
    const parts: FlowPart[] = [node.head.text];
    for (const span of node.templateSpans) {
      const inner = flowTemplate(span.expression, ctx, env, depth + 1);
      if (inner === null) return null;
      parts.push(...inner, span.literal.text);
    }
    return parts;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = flowTemplate(node.left, ctx, env, depth + 1);
    const right = flowTemplate(node.right, ctx, env, depth + 1);
    return left === null || right === null ? null : [...left, ...right];
  }
  if (ts.isIdentifier(node)) return flowIdentifier(node, ctx, env, depth);
  if (ts.isCallExpression(node)) {
    const joined = flowJoin(node, ctx, env, depth);
    if (joined !== undefined) return joined;
  }
  return [RUNTIME_PART];
}

function flowParams(parts: readonly FlowPart[]): number[] {
  const params = new Set<number>();
  for (const part of parts) if (typeof part !== "string") params.add(part.param);
  return [...params];
}

function flowSubstitute(parts: readonly FlowPart[], value: string): string {
  return parts.map((part) => (typeof part === "string" ? part : value)).join("");
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);
}

/** Wywołania `name(...)` (odbiorca: sam identyfikator) w poddrzewie. */
function callsByName(root: ts.Node, name: string): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      if (ts.isIdentifier(callee) && callee.text === name) calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return calls;
}

function importersOf(file: string, env: FlowEnv): readonly FlowImport[] {
  if (env.importers === null) {
    const index = new Map<string, FlowImport[]>();
    for (const scope of env.scopes.values()) {
      for (const [local, [spec, imported]] of scope.imports) {
        const target = resolveModule(scope.file, spec, env.known);
        if (target === null) continue;
        const list = index.get(target) ?? [];
        list.push({ scope, local, imported });
        index.set(target, list);
      }
    }
    env.importers = index;
  }
  return env.importers.get(file) ?? [];
}

/** Wywołania funkcji `fn` po nazwie: w jej bloku i (eksport) w plikach importujących. */
function directCallsOf(
  fn: ts.SignatureDeclaration,
  scope: FileScope,
  env: FlowEnv,
): Array<{ readonly call: ts.CallExpression; readonly scope: FileScope }> {
  let name: string;
  let statement: ts.Statement;
  if (ts.isFunctionDeclaration(fn)) {
    if (fn.name === undefined || fn.body === undefined) return [];
    name = fn.name.text;
    statement = fn;
  } else if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) {
    const outer = outermostWrapper(fn);
    const decl = outer.parent;
    if (
      !ts.isVariableDeclaration(decl) ||
      decl.initializer !== outer ||
      !ts.isIdentifier(decl.name) ||
      !ts.isVariableDeclarationList(decl.parent) ||
      !(decl.parent.flags & ts.NodeFlags.Const) ||
      !ts.isVariableStatement(decl.parent.parent)
    ) {
      return [];
    }
    name = decl.name.text;
    statement = decl.parent.parent;
  } else {
    return [];
  }
  const container = statement.parent;
  if (bindingCount(container, name) !== 1 || isAssigned(container, name)) return [];
  const calls = callsByName(container, name).map((call) => ({ call, scope }));
  if (
    ts.isSourceFile(container) &&
    hasModifier(statement, ts.SyntaxKind.ExportKeyword) &&
    !hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
  ) {
    for (const imp of importersOf(scope.file, env)) {
      if (imp.imported !== name) continue;
      if (bindingCount(imp.scope.sf, imp.local) !== 0 || isAssigned(imp.scope.sf, imp.local)) {
        continue;
      }
      for (const call of callsByName(imp.scope.sf, imp.local))
        calls.push({ call, scope: imp.scope });
    }
  }
  return calls;
}

/** Wartości argumentu `arg` wywołania `call` (krok w górę, gdy to parametr wołającego). */
function flowArgumentValues(
  arg: ts.Expression,
  call: ts.CallExpression,
  scope: FileScope,
  env: FlowEnv,
  depth: number,
  stack: Set<string>,
): FlowValue[] {
  const fn = enclosingFunction(call);
  const parts = flowTemplate(arg, { scope, fn, lambdas: [] }, env, 0);
  if (parts === null) return [{ text: RUNTIME_PART, file: scope.file }];
  const params = flowParams(parts);
  if (params.length === 0) return [{ text: flowSubstitute(parts, ""), file: scope.file }];
  if (params.length > 1 || fn === null) return [{ text: RUNTIME_PART, file: scope.file }];
  return flowParamValues(fn, params[0], scope, env, depth + 1, stack).map((v) => ({
    text: flowSubstitute(parts, v.text),
    file: v.file,
  }));
}

/** Zgłoszenie miejsca nieczytelnego reguły przepływu (zbiór + licznik zgłoszeń). */
function flowUnresolved(env: FlowEnv, site: string): void {
  env.unresolved.add(site);
  env.flagged += 1;
}

/** Wartości parametru `index` funkcji `fn` ze wszystkich widocznych wywołań. */
function flowParamValues(
  fn: ts.SignatureDeclaration,
  index: number,
  scope: FileScope,
  env: FlowEnv,
  depth: number,
  stack: Set<string>,
): FlowValue[] {
  const site = `${scope.file}:${fn.getStart(scope.sf)}`;
  if (depth > COLUMN_FLOW_MAX_DEPTH) {
    flowUnresolved(
      env,
      `${site}: przepływ kolumn dłuższy niż ${COLUMN_FLOW_MAX_DEPTH} wywołania (parametr ${index + 1})`,
    );
    return [];
  }
  const key = `${site}:${index}`;
  if (stack.has(key)) return [];
  stack.add(key);
  try {
    const values: FlowValue[] = [];
    if (
      index === 0 &&
      (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn) || ts.isFunctionDeclaration(fn))
    ) {
      for (const call of helperCallsReceiving(fn, scope, env.known)) {
        const plainArg = call.arguments[1];
        if (plainArg === undefined) continue;
        const embed = postParentPageEmbed(env.scopes, env.known);
        if (embed === null) {
          flowUnresolved(
            env,
            `${scope.file}: ${POST_PARENT_PAGE_READ.helper}(…): ${POST_PARENT_PAGE_READ.embedConstant} (${POST_PARENT_PAGE_READ.embedModule}) nieczytelne`,
          );
        }
        for (const plain of flowArgumentValues(plainArg, call, scope, env, depth, stack)) {
          if (embed !== null) {
            values.push({ text: withPostParentPageEmbed(plain.text, embed), file: plain.file });
          }
          values.push(plain);
        }
      }
    }
    for (const { call, scope: callerScope } of directCallsOf(fn, scope, env)) {
      const args = call.arguments;
      if (args.slice(0, index + 1).some((a) => ts.isSpreadElement(a))) continue;
      const arg = args[index];
      if (arg === undefined) continue;
      values.push(...flowArgumentValues(arg, call, callerScope, env, depth, stack));
    }
    return values;
  } finally {
    stack.delete(key);
  }
}

/**
 * Napisy `select` (z plikiem literału kolumn) dla `.select(arg)`, którego
 * argument zależy od jednego parametru najbliższej funkcji. `null` - to nie
 * ten kształt (bez faktu, jak dotąd).
 */
function columnFlowSelects(
  arg: ts.Expression,
  selectCall: ts.CallExpression,
  scope: FileScope,
  env: FlowEnv,
): FlowValue[] | null {
  const fn = enclosingFunction(selectCall);
  if (fn === null) return null;
  const parts = flowTemplate(arg, { scope, fn, lambdas: [] }, env, 0);
  if (parts === null) return null;
  const params = flowParams(parts);
  if (params.length !== 1) return null;
  return flowParamValues(fn, params[0], scope, env, 1, new Set()).map((v) => ({
    text: flowSubstitute(parts, v.text),
    file: v.file,
  }));
}

/** Czy któryś element listy `select` na miejscu kolumny jest wartością czasu działania. */
function hasRuntimeColumn(select: string): boolean {
  return splitTopLevel(select).some(
    (raw) => selectItemColumn(raw)?.includes(RUNTIME_PART) ?? false,
  );
}

/** Nazwa na dnie łańcucha `x.a(...).b(...)` (albo `null`). */
function chainRootName(expr: ts.Expression): string | null {
  let node = unwrap(expr);
  for (;;) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      node = unwrap(node.expression.expression);
    } else if (ts.isPropertyAccessExpression(node)) {
      node = unwrap(node.expression);
    } else {
      return ts.isIdentifier(node) ? node.text : null;
    }
  }
}

/**
 * Czy KAŻDE przypisanie do `name` w poddrzewie to `name = name.<ogniwa>(...)`
 * (także w obu gałęziach warunku) - przedłużenie tego samego budowniczego
 * (filtr, warunek wersji). Inne
 * przypisanie (`q = filtruj(q)`, `+=`, rozkład, `for (q of ...)`) - nie.
 */
function onlySelfExtending(root: ts.Node, name: string): boolean {
  // `q = q.eq(...)` albo `q = warunek ? q.is(...) : q.eq(...)`.
  const extends_ = (expr: ts.Expression): boolean => {
    const node = unwrap(expr);
    return ts.isConditionalExpression(node)
      ? extends_(node.whenTrue) && extends_(node.whenFalse)
      : chainRootName(node) === name;
  };
  let ok = true;
  const visit = (node: ts.Node): void => {
    if (!ok) return;
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      const left = unwrap(node.left);
      if (ts.isIdentifier(left) && left.text === name) {
        if (node.operatorToken.kind !== ts.SyntaxKind.EqualsToken || !extends_(node.right)) {
          ok = false;
          return;
        }
      } else if (
        (ts.isArrayLiteralExpression(left) || ts.isObjectLiteralExpression(left)) &&
        containsIdentifier(left, name)
      ) {
        ok = false;
        return;
      }
    }
    if (
      ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken ||
          node.operator === ts.SyntaxKind.MinusMinusToken) &&
        containsIdentifier(node.operand, name)) ||
      ((ts.isForOfStatement(node) || ts.isForInStatement(node)) &&
        !ts.isVariableDeclarationList(node.initializer) &&
        containsIdentifier(node.initializer, name))
    ) {
      ok = false;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return ok;
}

/**
 * Budowniczy w zmiennej: łańcuch każdego użycia nazwy. `top` to ostatnie
 * ogniwo łańcucha wprost nad `.from()` (albo samo `.from()`):
 *   * `const base = supabase.from("t")`, a dalej `base.select(...)` /
 *     `base.update(...)` - nazwa wiązana raz w swoim bloku i nieprzypisywana;
 *   * `let q = supabase.from("t").update(p).eq("id", id)`, warunkowo
 *     `q = q.eq("updated_at", v)`, a dalej `await q.select("id, updated_at")`
 *     (RETURNING zapisu) - `let` tylko wtedy, gdy KAŻDE przypisanie przedłuża
 *     ten sam budowniczy (`onlySelfExtending`). Inne przypisanie - reguła
 *     milczy, a `select` na tej nazwie trafia do `uncheckedSelects`.
 */
function boundChains(top: ts.CallExpression): ts.CallExpression[][] {
  const outer = outermostWrapper(top);
  const decl = outer.parent;
  if (
    !ts.isVariableDeclaration(decl) ||
    decl.initializer !== outer ||
    !ts.isIdentifier(decl.name) ||
    !ts.isVariableDeclarationList(decl.parent) ||
    !ts.isVariableStatement(decl.parent.parent)
  ) {
    return [];
  }
  const isConst = (decl.parent.flags & ts.NodeFlags.Const) !== 0;
  const isLet = (decl.parent.flags & ts.NodeFlags.Let) !== 0;
  if (!isConst && !isLet) return [];
  const name = decl.name.text;
  const container = decl.parent.parent.parent;
  if (bindingCount(container, name) !== 1) return [];
  if (isConst ? isAssigned(container, name) : !onlySelfExtending(container, name)) return [];
  const chains: ts.CallExpression[][] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === name && node !== decl.name) {
      const ref = outermostWrapper(node);
      const access = ref.parent;
      if (
        ts.isPropertyAccessExpression(access) &&
        access.expression === ref &&
        ts.isCallExpression(access.parent) &&
        access.parent.expression === access
      ) {
        chains.push([access.parent, ...chainAbove(access.parent)]);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(container);
  return chains;
}

// ── `looseTable(kontekst, "tabela")` ────────────────────────────────────────
//
// Moduły CRM czytają tabele spoza wygenerowanych typów przez
// `looseTable(context, "crm_leads")` (`lib/supabase/looseQuery.ts`), czyli
// `.from()` klienta z kontekstu funkcji serwerowej - w kodzie nie ma wtedy
// `.from(` i 50 odczytów nie dawało faktu ani wpisu w żadnej zapadce.
// Wywołanie pomocnika z TEGO modułu z tabelą rozwiązywalną statycznie jest
// traktowane jak `.from()`; rola - jak odbiorca `context.supabase`
// (`authenticated`), a dla `{ supabase: X }` - jak odbiorca `X`. Tabela
// nieczytelna (`looseTable(context, view)`): bez faktu, a każdy `select` na
// tym budowniczym trafia do `uncheckedSelects` (zapadka listy przejrzanej).
//
// `looseClient(źródło)` z tego samego modułu to klient o tej samej roli co
// źródło - do listopada 2026 odbiorca `looseClient(context).rpc(...)` (albo
// `const client = looseClient(context); client.rpc(...)`) dostawał rolę
// `unknown`, więc EXECUTE `crm_funnel_stats`, `crm_import_leads`,
// `crm_companies_aggregates` i `has_role` oraz uprawnienia odczytów
// `looseClient({ supabase: supabaseAdmin }).from(...)` nie były sprawdzane.
// Nazwa liczy się tylko wtedy, gdy jest `const` związanym z wywołaniem
// pomocnika, jedynym wiązaniem tej nazwy w swoim bloku (bez przesłonięć
// głębiej), nieprzypisywanym, a użycie leży w tym bloku. Inaczej - `unknown`,
// jak dotąd.

/** Pomocnik i jego moduł (ścieżka repo). */
export const LOOSE_TABLE = {
  helper: "looseTable",
  module: "src/lib/supabase/looseQuery.ts",
  arity: 2,
} as const;

/** Klient bez wygenerowanych typów z tego samego modułu. */
export const LOOSE_CLIENT = {
  helper: "looseClient",
  module: LOOSE_TABLE.module,
  arity: 1,
} as const;

/** Czy wywołanie to `helper(...)` z importu modułu pomocnika, z jego liczbą argumentów. */
function isLooseHelperCall(
  call: ts.CallExpression,
  helper: typeof LOOSE_TABLE | typeof LOOSE_CLIENT,
  scope: FileScope,
  known: ReadonlySet<string>,
): boolean {
  const callee = unwrap(call.expression);
  if (!ts.isIdentifier(callee) || call.arguments.length !== helper.arity) return false;
  const imported = scope.imports.get(callee.text);
  return (
    imported !== undefined &&
    imported[1] === helper.helper &&
    resolveModule(scope.file, imported[0], known) === helper.module
  );
}

/** Czy wywołanie to `looseTable(źródło, tabela)` z importu modułu pomocnika. */
function isLooseTableCall(
  call: ts.CallExpression,
  scope: FileScope,
  known: ReadonlySet<string>,
): boolean {
  return isLooseHelperCall(call, LOOSE_TABLE, scope, known);
}

/** Czy `inner` leży w poddrzewie `outer` (albo nim jest). */
function within(inner: ts.Node, outer: ts.Node): boolean {
  for (let node: ts.Node | undefined = inner; node; node = node.parent) {
    if (node === outer) return true;
  }
  return false;
}

/**
 * Wywołanie `looseClient(...)`, z którym związana jest nazwa użyta w `id`:
 * `const id = looseClient(x)` w instrukcji bloku, który obejmuje użycie,
 * jedyne wiązanie tej nazwy w tym bloku (także głębiej - parametr, rozkład,
 * zagnieżdżona funkcja) i nigdzie w nim nieprzypisywane. `null` - nazwa nie
 * jest takim klientem (albo nie na pewno).
 */
function looseClientBinding(
  id: ts.Identifier,
  scope: FileScope,
  known: ReadonlySet<string>,
): ts.CallExpression | null {
  // Bez importu pomocnika nie ma czego szukać (szybka ścieżka dla 99% plików).
  if (![...scope.imports.values()].some(([, imported]) => imported === LOOSE_CLIENT.helper)) {
    return null;
  }
  const name = id.text;
  let found: ts.CallExpression | null = null;
  const visit = (node: ts.Node): void => {
    if (found !== null) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer !== undefined &&
      ts.isVariableDeclarationList(node.parent) &&
      node.parent.flags & ts.NodeFlags.Const &&
      ts.isVariableStatement(node.parent.parent)
    ) {
      const init = unwrap(node.initializer);
      const container = node.parent.parent.parent;
      if (
        ts.isCallExpression(init) &&
        isLooseHelperCall(init, LOOSE_CLIENT, scope, known) &&
        within(id, container) &&
        bindingCount(container, name) === 1 &&
        !isAssigned(container, name)
      ) {
        found = init;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(scope.sf);
  return found;
}

/** Rola klienta źródła `looseTable(źródło, ...)` / `looseClient(źródło)`. */
function looseSourceRole(
  source: ts.Expression,
  scope: FileScope,
  known: ReadonlySet<string>,
): ClientRole {
  const node = unwrap(source);
  if (ts.isIdentifier(node) && (node.text === "context" || node.text === "ctx")) {
    return "authenticated";
  }
  if (ts.isObjectLiteralExpression(node)) {
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop) && propName(prop.name) === "supabase") {
        return receiverRole(prop.initializer, scope, known);
      }
      if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === "supabase") {
        return receiverRole(prop.name, scope, known);
      }
    }
  }
  return "unknown";
}

/** `.from()` tabeli public (nie kubełek Storage, nie inny schemat, nie `Array.from`). */
function isTableFrom(call: ts.CallExpression): boolean {
  const method = callMethod(call);
  if (method?.name !== "from" || call.arguments.length !== 1) return false;
  const recv = unwrap(method.receiver);
  if (ts.isPropertyAccessExpression(recv) && recv.name.text === "storage") return false;
  if (ts.isCallExpression(recv) && callMethod(recv)?.name === "schema") return false;
  // Konstruktory globalne (`Array.from`, `Buffer.from`) - nie klient Supabase.
  return !(ts.isIdentifier(recv) && /^[A-Z]/.test(recv.text));
}

/**
 * Tabela budowniczego Supabase, na którym stoi wyrażenie: łańcuch w dół do
 * `.from(t)` / `looseTable(x, t)` albo do nazwy, którą GDZIEKOLWIEK w pliku
 * wiąże się (albo przypisuje) z takim łańcuchem. `undefined` - to nie
 * budowniczy; `null` - budowniczy, tabela nieczytelna. Celowo szeroko: to
 * wszechświat zapadki, nie źródło faktów.
 */
function builderTable(
  expr: ts.Expression,
  scope: FileScope,
  exportsIndex: ExportIndex,
  known: ReadonlySet<string>,
  seen: Set<string>,
): string | null | undefined {
  const tableOf = (arg: ts.Expression): string | null => {
    const table = resolveString(arg, scope, exportsIndex, known);
    return table !== null && COLUMN_RE.test(table) ? table : null;
  };
  let node = unwrap(expr);
  for (;;) {
    if (ts.isCallExpression(node)) {
      if (isLooseTableCall(node, scope, known)) return tableOf(node.arguments[1]);
      if (isTableFrom(node)) return tableOf(node.arguments[0]);
      const method = callMethod(node);
      if (method === null) return undefined;
      node = unwrap(method.receiver);
      continue;
    }
    // `(warunek ? q.eq(...) : q).select(...)`, `a ?? b`, `a || b` - budowniczy
    // w którejkolwiek gałęzi (pierwsza z tabelą wygrywa).
    if (
      ts.isConditionalExpression(node) ||
      (ts.isBinaryExpression(node) &&
        (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
          node.operatorToken.kind === ts.SyntaxKind.BarBarToken))
    ) {
      const branches = ts.isConditionalExpression(node)
        ? [node.whenTrue, node.whenFalse]
        : [node.left, node.right];
      let found: string | null | undefined;
      for (const branch of branches) {
        const table = builderTable(branch, scope, exportsIndex, known, seen);
        if (table !== undefined && (found === undefined || found === null)) found = table;
      }
      return found;
    }
    if (!ts.isIdentifier(node) || seen.has(node.text)) return undefined;
    const name = node.text;
    seen.add(name);
    let found: string | null | undefined;
    const consider = (value: ts.Expression): void => {
      const table = builderTable(value, scope, exportsIndex, known, seen);
      if (table !== undefined && (found === undefined || found === null)) found = table;
    };
    const visit = (child: ts.Node): void => {
      if (
        ts.isVariableDeclaration(child) &&
        ts.isIdentifier(child.name) &&
        child.name.text === name &&
        child.initializer !== undefined
      ) {
        consider(child.initializer);
      } else if (
        ts.isBinaryExpression(child) &&
        child.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(unwrap(child.left)) &&
        (unwrap(child.left) as ts.Identifier).text === name
      ) {
        consider(child.right);
      }
      ts.forEachChild(child, visit);
    };
    visit(scope.sf);
    return found;
  }
}

// ── Przebieg po wywołaniach ─────────────────────────────────────────────────

interface Collector {
  rpcs: RpcSite[];
  tables: TableSite[];
  /** Wpisy przeglądu faktów wstrzymanych (wejście) i to, co wstrzymały. */
  withheldReviewed: readonly WithheldFactReviewed[];
  withheld: WithheldFact[];
  literals: LiteralWrite[];
  conflicts: ConflictTarget[];
  rpcCalls: number;
  rpcCallsWithUnknownName: number;
  tableChains: number;
  tableChainsWithUnknownTable: number;
  unresolved: string[];
  uncheckedSelects: string[];
  /**
   * Wywołania `.select`, które ekstrakcja OBEJRZAŁA (fakt, miejsce
   * nieczytelne, `head: true` albo wpis w `uncheckedSelects`). Reszta
   * `select` na budowniczym Supabase trafia do `uncheckedSelects`.
   */
  visitedSelects: Set<ts.CallExpression>;
}

/**
 * Nazwa funkcji do klucza listy przejrzanej: nazwa deklaracji, a funkcji
 * anonimowej - wiązanie albo właściwość, do której trafia (także przez łańcuch
 * wywołań: `export const f = createServerFn().handler(async () => ...)` - `f`).
 * `null` - callback bez nazwy (`xs.map(...)` w wyrażeniu), pomijany w ścieżce.
 */
function functionName(fn: ts.SignatureDeclaration): string | null {
  if (
    (ts.isFunctionDeclaration(fn) ||
      ts.isFunctionExpression(fn) ||
      ts.isMethodDeclaration(fn) ||
      ts.isGetAccessorDeclaration(fn) ||
      ts.isSetAccessorDeclaration(fn)) &&
    fn.name !== undefined
  ) {
    return propName(fn.name as ts.PropertyName) ?? fn.name.getText();
  }
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return null;
  let current: ts.Node = outermostWrapper(fn);
  for (;;) {
    const parent: ts.Node = current.parent;
    if (
      (ts.isCallExpression(parent) &&
        (parent.expression === current || parent.arguments.some((a) => a === current))) ||
      (ts.isPropertyAccessExpression(parent) && parent.expression === current)
    ) {
      current = outermostWrapper(parent as ts.Expression);
      continue;
    }
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
    if (ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) {
      return propName(parent.name);
    }
    return null;
  }
}

/** Ścieżka nazwanych funkcji nad węzłem (`zewn.wewn`); `<moduł>` - poza funkcją. */
function enclosingFunctionPath(node: ts.Node): string {
  const names: string[] = [];
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionLike(current)) {
      const name = functionName(current);
      if (name !== null) names.push(name);
    }
  }
  return names.length === 0 ? "<moduł>" : names.reverse().join(".");
}

/**
 * Klucz `select` bez faktu i bez miejsca nieczytelnego: plik, ścieżka
 * funkcji, tabela i tekst argumentu - BEZ numeru linii, więc lista przejrzana
 * nie zmienia się od edycji w innym miejscu pliku. Funkcja i tabela są
 * w kluczu, żeby naprawa jednego miejsca i dopisanie TEGO SAMEGO tekstu
 * w innej funkcji albo na innej tabeli nie wymieniły się po cichu. Tekst
 * argumentu jest PEŁNY (białe znaki zwinięte do spacji): do listopada 2026
 * klucz obcinał go do 80 znaków, więc kolumna dopisana za 80. znakiem
 * przejrzanego `select` zostawiała ten sam klucz i przechodziła CI.
 */
function uncheckedSelectSite(
  call: ts.CallExpression,
  table: string | null,
  scope: FileScope,
): string {
  const arg = call.arguments[0];
  const text = arg === undefined ? "" : arg.getText(scope.sf).replace(/\s+/g, " ");
  return `${scope.file}: ${enclosingFunctionPath(call)}: .from(${table ?? "?"}).select(${text})`;
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
  flow: FlowEnv,
): void {
  const selects: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const method = callMethod(node);
      if (method?.name === "rpc" && node.arguments.length >= 1) {
        handleRpc(node, method.receiver, scope, exportsIndex, known, out);
      } else if (method?.name === "from" && node.arguments.length === 1) {
        handleFrom(node, method.receiver, scope, exportsIndex, known, out, flow);
      } else if (isLooseTableCall(node, scope, known)) {
        const role = looseSourceRole(node.arguments[0], scope, known);
        handleBuilder(node, node.arguments[1], role, false, scope, exportsIndex, known, out, flow);
      } else if (method?.name === "select") {
        selects.push(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(scope.sf);
  // Wszechświat zapadki: KAŻDY `.select` na budowniczym Supabase, którego
  // przebieg wyżej nie obejrzał (budowniczy w `let` przypisywanym inaczej niż
  // przedłużeniem, `looseTable` z tabelą nieczytelną, nazwa związana
  // z budowniczym w innej funkcji...), trafia do `uncheckedSelects`.
  for (const call of selects) {
    if (out.visitedSelects.has(call)) continue;
    const receiver = (call.expression as ts.PropertyAccessExpression).expression;
    const table = builderTable(receiver, scope, exportsIndex, known, new Set());
    if (table !== undefined) out.uncheckedSelects.push(uncheckedSelectSite(call, table, scope));
  }
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
  out.rpcs.push({ name, keys, role: receiverRole(receiver, scope, known), file: scope.file });
}

function handleFrom(
  node: ts.CallExpression,
  receiver: ts.Expression,
  scope: FileScope,
  exportsIndex: ExportIndex,
  known: ReadonlySet<string>,
  out: Collector,
  flow: FlowEnv,
): void {
  const recv = unwrap(receiver);
  // `supabase.storage.from("bucket")` to kubełek Storage, nie tabela;
  // `.schema("x").from()` - inny schemat niż public.
  if (ts.isPropertyAccessExpression(recv) && recv.name.text === "storage") return;
  if (ts.isCallExpression(recv)) {
    const inner = callMethod(recv);
    if (inner?.name === "schema") return;
  }
  const role = receiverRole(receiver, scope, known);
  handleBuilder(node, node.arguments[0], role, true, scope, exportsIndex, known, out, flow);
}

/**
 * Łańcuchy budowniczego `node` (`.from(t)` albo `looseTable(x, t)`): fakty
 * operacji, miejsca nieczytelne i `select` bez faktu. `unresolvedIsSite` -
 * tabela nieczytelna to wpis w `unresolvedSites` (`.from(nazwa)`); bez tego
 * (`looseTable`) budowniczy jest pomijany, a jego `select` trafiają do
 * `uncheckedSelects` przez wszechświat w `visitFile`.
 */
function handleBuilder(
  node: ts.CallExpression,
  tableArg: ts.Expression,
  role: ClientRole,
  unresolvedIsSite: boolean,
  scope: FileScope,
  exportsIndex: ExportIndex,
  known: ReadonlySet<string>,
  out: Collector,
  flow: FlowEnv,
): void {
  // Łańcuch wprost nad budowniczym oraz - gdy budowniczy (także po ogniwach)
  // trafia do zmiennej - łańcuch każdego jej użycia (`boundChains`).
  const direct = chainAbove(node);
  const top = direct.length > 0 ? direct[direct.length - 1] : node;
  const chains = [...(direct.length > 0 ? [direct] : []), ...boundChains(top)];
  const QUERY = new Set(["select", "insert", "update", "upsert", "delete"]);
  const opsOf = (chain: readonly ts.CallExpression[]): string[] =>
    chain.map((c) => callMethod(c)?.name ?? "");
  // `Array.from`, `Buffer.from`, ...
  if (!chains.some((chain) => opsOf(chain).some((op) => QUERY.has(op)))) return;
  const table = resolveString(tableArg, scope, exportsIndex, known);
  if (table === null || !COLUMN_RE.test(table)) {
    if (!unresolvedIsSite) return;
    out.tableChains += 1;
    out.tableChainsWithUnknownTable += 1;
    out.unresolved.push(`${scope.file}: .from(${tableArg.getText(scope.sf).slice(0, 60)})`);
    // Zgłoszone miejsce obejmuje każdy `select` tego budowniczego.
    for (const chain of chains) {
      for (const call of chain)
        if (callMethod(call)?.name === "select") out.visitedSelects.add(call);
    }
    return;
  }
  out.tableChains += 1;
  const site = (
    call: ts.CallExpression,
    op: TableOp,
    columns: readonly string[],
    star: boolean,
  ): void => {
    pushTableFact(out, { table, op, columns, star, role, file: scope.file }, call, scope);
  };

  for (const chain of chains) {
    const ops = opsOf(chain);
    for (let i = 0; i < chain.length; i += 1) {
      const call = chain[i];
      const op = ops[i];
      if (op === "select") {
        out.visitedSelects.add(call);
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
          site(call, "select", [], true);
          continue;
        }
        const flaggedBefore = flow.flagged;
        // Parametr funkcji oddanej `readPostsWithParentPage` PRZED rozwiązaniem
        // po nazwie: parametr przesłania stałą modułu o tej samej nazwie.
        const viaHelper = postParentPageSelects(arg, call, scope, exportsIndex, known, out);
        // Kolumny z parametru przekazanego przez wywołania (reguła przepływu),
        // także PRZED rozwiązaniem po nazwie - z tego samego powodu. Fakt
        // dostaje plik literału kolumn, rolę - odbiorca tego `.from()`.
        const flowed = viaHelper === null ? columnFlowSelects(arg, call, scope, flow) : null;
        const text =
          viaHelper === null && flowed === null
            ? resolveString(arg, scope, exportsIndex, known)
            : null;
        for (const value of flowed ?? []) {
          const parsed = parseSelectColumns(value.text);
          if (parsed.star || parsed.columns.length > 0) {
            pushTableFact(
              out,
              {
                table,
                op: "select",
                columns: parsed.columns,
                star: parsed.star,
                role,
                file: value.file,
              },
              call,
              scope,
            );
          }
          if (hasRuntimeColumn(value.text)) {
            flow.unresolved.add(
              `${scope.file}: .select(${arg.getText(scope.sf).slice(0, 60)}) <- ${value.file}: kolumna z wartości czasu działania`,
            );
          }
        }
        for (const select of viaHelper ?? (text === null ? [] : [text])) {
          const parsed = parseSelectColumns(select);
          if (parsed.star || parsed.columns.length > 0) {
            site(call, "select", parsed.columns, parsed.star);
          }
        }
        // Ani napisu `select`, ani zgłoszonego miejsca nieczytelnego: kontrakt
        // tego odczytu nie widzi (zapadka `UNCHECKED_SELECTS_REVIEWED`).
        // Pomocnik bez napisu zawsze zgłasza miejsce, więc tu go nie ma.
        const unchecked =
          viaHelper === null &&
          (flowed === null ? text === null : flowed.length === 0 && flow.flagged === flaggedBefore);
        if (unchecked) out.uncheckedSelects.push(uncheckedSelectSite(call, table, scope));
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
        site(call, kind, shape.keys, false);
        for (const lit of shape.literals) {
          out.literals.push({ table, column: lit.column, value: lit.value, file: scope.file });
        }
      } else if (op === "delete") {
        site(call, "delete", [], false);
      }
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

/**
 * Błędy składni każdego pliku - publicznym API kompilatora
 * (`Program.getSyntacticDiagnostics`) na TYCH SAMYCH drzewach, z których
 * ekstrakcja czyta fakty. Program jest pamięciowy: bez `lib`, bez rozwiązywania
 * importów i bez systemu plików (moduł zostaje czysty).
 */
function parseErrorsOf(scopes: ReadonlyMap<string, FileScope>): string[] {
  const host: ts.CompilerHost = {
    getSourceFile: (name) => scopes.get(name)?.sf,
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => undefined,
    getCurrentDirectory: () => "",
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (name) => scopes.has(name),
    readFile: () => undefined,
  };
  const program = ts.createProgram({
    rootNames: [...scopes.keys()],
    options: { noLib: true, noResolve: true, types: [] },
    host,
  });
  const out: string[] = [];
  for (const scope of scopes.values()) {
    const sf = program.getSourceFile(scope.file);
    // Program, który nie oddał NASZEGO drzewa, sprawdzałby inny tekst - to
    // błąd bramki, nie pliku, więc nie może przejść w ciszy.
    if (sf !== scope.sf) {
      out.push(`${scope.file}: kompilator nie przyjął drzewa ekstrakcji`);
      continue;
    }
    const diagnostics = program.getSyntacticDiagnostics(sf);
    if (diagnostics.length === 0) continue;
    const first = diagnostics[0];
    const line =
      first.start === undefined ? "?" : sf.getLineAndCharacterOfPosition(first.start).line + 1;
    out.push(
      `${scope.file}: ${diagnostics.length} błędów składni, pierwszy: linia ${line}: ${ts.flattenDiagnosticMessageText(first.messageText, " ")}`,
    );
  }
  return out.sort();
}

// ── Fakty wstrzymane w przeglądzie (lista może TYLKO maleć) ─────────────────
//
// Reguła ekstrakcji czasem odsłania odczyt, którego schemat po migracjach nie
// przepuszcza (sprawdzone lokalnie: `has_column_privilege`, zapytanie roli).
// To defekt dla właściciela - faktu nie dopisujemy do pgTAP (CI czerwieniłoby
// się na kodzie sprzed zmiany bramki), ale też NIE wyłączamy pliku: do
// listopada 2026 wyłączenie całego pliku (`profile/export.functions.ts`)
// i wszystkich `looseTable` dwóch plików CRM zdejmowało z kontraktu 32 odczyty,
// 13 RPC i 25 wierszy (także zapisy z literałami), a nieistniejąca kolumna
// dopisana do sąsiedniego odczytu, RPC o zmyślonej nazwie albo zapis
// `crm_leads.stage = 'not_a_stage'` przechodziły CI.
//
// Wpis wstrzymuje DOKŁADNIE JEDEN fakt: plik, funkcja, tabela, operacja, rola
// i PEŁNA lista kolumn. Wszystko inne w pliku - jak każdy kod: fakty do pgTAP,
// `select` bez faktu do zapadki. Kolumna dopisana do wstrzymanego odczytu to
// inny fakt (idzie do pgTAP z rolą klienta), a wpis, który nie trafia
// w dokładnie jeden fakt, czerwieni `check:ts-sql-contract`. Wstrzymany fakt
// renderuje się z rolą `unknown` - istnienie relacji i kolumn sprawdza pgTAP
// dalej, wstrzymane są wyłącznie uprawnienia. Literały i cele onConflict
// wstrzymanego zapisu - jak dotąd (osobne fakty).
//
// Lista jest dziś PUSTA. Trzy wpisy z przeglądu (listopad 2026) zeszły razem
// z naprawami: sekcja `user_reports_filed` eksportu RODO woła SECURITY DEFINER
// `user_reports_export_my_data` (20261116211500), a awatar karty leada
// (`lookupLeadAvatars`) i członkowie karty firmy (`companyMembers`) czytają
// `profiles` spod `service_role` z najemcą z sesji. Mechanizm zostaje: nowy
// znany defekt grantu w kodzie sprzed bramki dostaje wpis tu, nie wyłączenie
// pliku.

/** Wpis przeglądu: jeden fakt, którego uprawnień kontrakt świadomie nie sprawdza. */
export interface WithheldFactReviewed {
  readonly file: string;
  /** Ścieżka nazwanych funkcji wywołania (`enclosingFunctionPath`, jak w kluczu zapadki). */
  readonly fn: string;
  readonly table: string;
  readonly op: TableOp;
  readonly role: ClientRole;
  /** Kolumny faktu DOKŁADNIE (posortowane, bez `*`). */
  readonly columns: readonly string[];
  /** Defekt, właściwa naprawa i warunek zdjęcia wpisu - to czyta właściciel. */
  readonly reason: string;
}

export function withheldKey(entry: Omit<WithheldFactReviewed, "reason">): string {
  return `${entry.file}: ${entry.fn}: ${entry.op} ${entry.table} dla ${entry.role} [${entry.columns.join(",")}]`;
}

export const SEAM_FACTS_WITHHELD_REVIEWED: readonly WithheldFactReviewed[] = [];

/** Kolumny wpisu i faktu są tą samą listą. */
function sameColumns(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((c, i) => c === b[i]);
}

/**
 * Fakt operacji na tabeli: do `tables` albo - gdy pasuje DOKŁADNIE do wpisu
 * przeglądu (plik wywołania i literału ten sam) - do `withheld`.
 */
function pushTableFact(
  out: Collector,
  fact: TableSite,
  call: ts.CallExpression,
  scope: FileScope,
): void {
  if (fact.file === scope.file && !fact.star) {
    const candidates = out.withheldReviewed.filter(
      (e) =>
        e.file === fact.file &&
        e.table === fact.table &&
        e.op === fact.op &&
        e.role === fact.role &&
        sameColumns(e.columns, fact.columns),
    );
    if (candidates.length > 0) {
      const fn = enclosingFunctionPath(call);
      const entry = candidates.find((e) => e.fn === fn);
      if (entry !== undefined) {
        out.withheld.push({ ...fact, fn, key: withheldKey(entry) });
        return;
      }
    }
  }
  out.tables.push(fact);
}

/** Pełna ekstrakcja faktów szwu z kodu produkcyjnego. */
export function extractSeamFacts(
  sources: readonly SourceFile[],
  contracts: readonly PublicColumnContract[] = PUBLIC_COLUMN_CONTRACTS,
  withheldReviewed: readonly WithheldFactReviewed[] = SEAM_FACTS_WITHHELD_REVIEWED,
): SeamFacts {
  const known = new Set(sources.map((s) => s.file));
  const scopes = new Map<string, FileScope>();
  for (const { file, code } of sources) scopes.set(file, buildScope(file, code));
  const exportsIndex: ExportIndex = scopes;

  const out: Collector = {
    rpcs: [],
    tables: [],
    withheldReviewed,
    withheld: [],
    literals: [],
    conflicts: [],
    rpcCalls: 0,
    rpcCallsWithUnknownName: 0,
    tableChains: 0,
    tableChainsWithUnknownTable: 0,
    unresolved: [],
    uncheckedSelects: [],
    visitedSelects: new Set(),
  };
  const flow: FlowEnv = { scopes, known, unresolved: new Set(), flagged: 0, importers: null };
  for (const scope of scopes.values()) {
    visitFile(scope, exportsIndex, known, out, flow);
  }
  out.unresolved.push(...flow.unresolved);
  const matched = new Map<string, number>();
  for (const w of out.withheld) matched.set(w.key, (matched.get(w.key) ?? 0) + 1);

  return {
    rpcs: out.rpcs,
    tables: out.tables,
    withheld: out.withheld,
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
      uncheckedSelects: [...out.uncheckedSelects].sort(),
      parseErrors: parseErrorsOf(scopes),
      withheldReviewed: withheldReviewed.map((entry) => {
        const key = withheldKey(entry);
        return { key, matched: matched.get(key) ?? 0 };
      }),
    },
  };
}

// ── Zasięg ekstrakcji ───────────────────────────────────────────────────────

/**
 * Zapadka: wywołania, których nazwy funkcji albo tabeli NIE da się ustalić
 * statycznie (pomocniki generyczne: sortowanie, wybór linku, bramka
 * analityki), odczyty `readPostsWithParentPage` z kolumnami nie do
 * ustalenia i kolumny z parametru, do którego dociera wartość czasu działania
 * (reguła przepływu kolumn). Kontrakt ich nie sprawdza - liczba może TYLKO maleć. Nowe
 * wywołanie z obliczoną nazwą (albo listą kolumn) zapala
 * `check:ts-sql-contract`: zamień je na literał (najlepiej) albo świadomie
 * podnieś zapadkę w przeglądzie.
 */
export const MAX_UNRESOLVED_SITES = 13;

const LOCAL_CONST =
  "stała `const` WEWNĄTRZ funkcji z literałem kolumn - generator czyta stałe modułu i importów, nie funkcji";
const ENTITY_COLS_PROPERTY =
  "właściwość stałej obiektowej `ENTITY_SELECT_COLS` (wprost, przez stałą lokalną albo w szablonie `POST_RESOLVE_SELECT`) - generator czyta tylko stałe napisowe";
const TERNARY = 'warunek `a ? "…" : "…"` z dwoma literałami - generator nie rozgałęzia';

const LOOSE_VIEW =
  "`looseTable(context, view)` z tabelą z warunku (`crm_leads` / `crm_leads_all`) - generator nie rozgałęzia";
const VIA_CONDITIONAL =
  "RETURNING zapisu na budowniczym przez warunek (`c ? q.is(...) : q.gt(...)`, `(c ? q.eq(...) : q).select(...)`) - generator nie prowadzi łańcucha przez warunek";

/**
 * Zapadka zasięgu `select`: KAŻDY `select` na budowniczym Supabase
 * (`.from()`, `looseTable()`, zmienna z takim łańcuchem), który NIE daje
 * faktu ani wpisu w `unresolvedSites` (`coverage.uncheckedSelects`) - kontrakt
 * go nie sprawdza, więc kolumna dopisana tam bez GRANT-u przechodzi CI.
 * Klucz: plik, ścieżka funkcji, tabela i tekst argumentu (bez numeru linii) -
 * naprawa w jednej funkcji i ten sam tekst w innej (albo na innej tabeli) to
 * nowy klucz, nie zamiana. Wartość: ile takich miejsc i dlaczego. Lista może
 * TYLKO maleć: nowy taki `select` czerwieni `check:ts-sql-contract`. Naprawa:
 * kolumny w literale albo w stałej modułu (`const X = "a, b"`, także szablon
 * z innymi stałymi napisowymi); dopiero gdy się nie da - wpis tutaj, z powodem,
 * w przeglądzie.
 */
export const UNCHECKED_SELECTS_REVIEWED: Readonly<
  Record<string, readonly [count: number, reason: string]>
> = {
  "src/lib/billing/donations.server.ts: findDonationAnchor: .from(donations).select(columns)": [
    2,
    LOCAL_CONST,
  ],
  'src/lib/billing/legacyNonPaymentReconcile.server.ts: applyLegacyPlan: .from(user_subscriptions).select("id")':
    [1, VIA_CONDITIONAL],
  'src/lib/billing/oneTimeFulfilment.server.ts: settleOrder.flipToPaid: .from(payment_orders).select("id")':
    [1, VIA_CONDITIONAL],
  'src/lib/billing/oneTimeFulfilment.server.ts: settleSubscriptionCheckoutOrder: .from(payment_orders).select("id")':
    [1, VIA_CONDITIONAL],
  'src/lib/billing/reconcile.server.ts: collectOwnedRefValues: .from(payment_orders).select(ORDER_REF_COLUMNS.join(", "))':
    [
      1,
      '`ORDER_REF_COLUMNS.join(", ")` - napis składany z tablicy `as const`; generator nie składa tablic',
    ],
  'src/lib/billing/reconcile.server.ts: collectOwnedRefValues: .from(subscriptions).select(SUBSCRIPTION_REF_COLUMNS.join(", "))':
    [1, '`SUBSCRIPTION_REF_COLUMNS.join(", ")` - jak wyżej'],
  "src/lib/crm.functions.ts: buildLeadTimeline: .from(crm_consent_log).select(CONSENT_LOG_TIMELINE_SELECT)":
    [
      1,
      '`CONSENT_LOG_TIMELINE_COLUMNS.join(", ")` (`crm/consentLog.ts`) - napis składany z tablicy; generator nie składa tablic',
    ],
  'src/lib/crm.functions.ts: exportCrmLeadsCsv: .from(?).select("*")': [1, LOOSE_VIEW],
  'src/lib/crm.functions.ts: listCrmLeads: .from(?).select("*")': [1, LOOSE_VIEW],
  "src/lib/crm.functions.ts: listStaffUsers: .from(profiles).select(cols)": [1, LOCAL_CONST],
  "src/lib/experts/queries.ts: fetchExpertHubLegacy: .from(profiles_public).select(PROFILE_COLS)": [
    2,
    LOCAL_CONST,
  ],
  "src/lib/experts/queries.ts: fetchMaterials: .from(events).select(EVENT_COLS)": [2, LOCAL_CONST],
  "src/lib/experts/queries.ts: fetchMaterials: .from(podcasts).select(PODCAST_COLS)": [
    1,
    LOCAL_CONST,
  ],
  "src/lib/experts/queries.ts: fetchMaterials: .from(posts).select(POST_COLS)": [2, LOCAL_CONST],
  'src/lib/newsletter-campaigns.functions.ts: countCampaignAudience: .from(newsletter_subscribers).select(data.segment ? "email, meta" : "email")':
    [1, TERNARY],
  'src/lib/newsletter-campaigns.functions.ts: runCampaignSend: .from(newsletter_subscribers).select(filter.segment ? "id, email, first_name, last_name, language, unsubscribe_token, meta" : "id, email, first_name, last_name, language, unsubscribe_token")':
    [1, TERNARY],
  "src/lib/notifications/preferencesQuery.ts: useNotificationPreferences.queryFn: .from(notification_preferences).select(NOTIFICATION_PREFERENCE_SELECT)":
    [
      1,
      '`NOTIFICATION_PREFERENCE_COLUMNS.join(", ")` (`preferences.ts`) - lista wyprowadzana z obiektu domyślnego w czasie działania',
    ],
  "src/lib/queries/public.ts: homePageQueryOptions.queryFn: .from(pages).select(cols)": [
    3,
    ENTITY_COLS_PROPERTY,
  ],
  "src/lib/queries/public.ts: postRowById: .from(posts).select(POST_RESOLVE_SELECT)": [
    1,
    ENTITY_COLS_PROPERTY,
  ],
  "src/lib/queries/public.ts: resolveContentForSegments: .from(pages).select(ENTITY_SELECT_COLS.page)":
    [1, ENTITY_COLS_PROPERTY],
  "src/lib/queries/public.ts: speculativePostRows: .from(posts).select(POST_RESOLVE_SELECT)": [
    1,
    ENTITY_COLS_PROPERTY,
  ],
};

/**
 * Rozjazd `coverage.uncheckedSelects` z listą przejrzaną: `fresh` - miejsca
 * nowe albo liczniejsze niż w przeglądzie; `stale` - wpisy, których jest już
 * mniej (naprawione - zdejmij z listy).
 */
export function uncheckedSelectDrift(
  facts: SeamFacts,
  reviewed: Readonly<Record<string, readonly [number, string]>> = UNCHECKED_SELECTS_REVIEWED,
): { fresh: string[]; stale: string[] } {
  const counts = new Map<string, number>();
  for (const site of facts.coverage.uncheckedSelects) counts.set(site, (counts.get(site) ?? 0) + 1);
  const fresh: string[] = [];
  const stale: string[] = [];
  for (const [site, count] of counts) {
    const allowed = reviewed[site]?.[0] ?? 0;
    if (count > allowed) fresh.push(`${site} (${count}, przejrzanych: ${allowed})`);
  }
  for (const [site, [allowed]] of Object.entries(reviewed)) {
    const count = counts.get(site) ?? 0;
    if (count < allowed) stale.push(`${site} (${count}, przejrzanych: ${allowed})`);
  }
  return { fresh: fresh.sort(), stale: stale.sort() };
}

/** Problemy zasięgu ekstrakcji - bez bazy, do bramki `check:ts-sql-contract`. */
export function seamCoverageProblems(
  facts: SeamFacts,
  reviewedUnchecked: Readonly<
    Record<string, readonly [number, string]>
  > = UNCHECKED_SELECTS_REVIEWED,
): string[] {
  const problems: string[] = [];
  // Bez wyjątków: drzewo pliku z błędem składni jest od pierwszego błędu
  // zgadywane, więc kontrakt może nie widzieć ani jednego jego zapytania.
  const { parseErrors } = facts.coverage;
  if (parseErrors.length > 0) {
    problems.push(
      `${parseErrors.length} plików z błędami składni - ich zapytań kontrakt nie widzi:\n` +
        parseErrors.map((entry) => `        ${entry}`).join("\n"),
    );
  }
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
      `${unresolved.length} wywołań z nazwą (albo kolumnami odczytu) nie do ustalenia statycznie (zapadka: ${MAX_UNRESOLVED_SITES}):\n` +
        unresolved.map((site) => `        ${site}`).join("\n"),
    );
  }
  // Wpis faktu wstrzymanego trafia w DOKŁADNIE jeden fakt: zero - kod już tak
  // nie czyta (zdejmij wpis; dopisana kolumna to inny fakt, który i tak idzie
  // do pgTAP), więcej - wpis wstrzymuje fakt, którego nikt nie oglądał.
  const offTarget = facts.coverage.withheldReviewed.filter((entry) => entry.matched !== 1);
  if (offTarget.length > 0) {
    problems.push(
      `${offTarget.length} wpisów SEAM_FACTS_WITHHELD_REVIEWED nie trafia w dokładnie jeden fakt (0 - nieaktualny, zdejmij; więcej - wstrzymuje fakt spoza przeglądu):\n` +
        offTarget.map((entry) => `        ${entry.key} (faktów: ${entry.matched})`).join("\n"),
    );
  }
  const { fresh } = uncheckedSelectDrift(facts, reviewedUnchecked);
  if (fresh.length > 0) {
    problems.push(
      `${fresh.length} odczytów \`select\` bez faktu kontraktu i bez miejsca nieczytelnego - kolumn nikt nie sprawdza (zapadka UNCHECKED_SELECTS_REVIEWED; kolumny w literał albo stałą modułu):\n` +
        fresh.map((site) => `        ${site}`).join("\n"),
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
  // Fakt wstrzymany idzie z rolą `unknown`: istnienie relacji i kolumn
  // sprawdzamy, uprawnień (znany defekt z wpisu przeglądu) - nie.
  const tableRows = groupBy(
    [
      ...facts.tables,
      ...facts.withheld.map((w): TableSite => ({
        table: w.table,
        op: w.op,
        columns: w.columns,
        star: w.star,
        role: "unknown",
        file: w.file,
      })),
    ],
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
